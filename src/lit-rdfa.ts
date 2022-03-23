import { render as renderLit, nothing, TemplateResult, html } from 'lit-html';
import { CompiledTemplate, CompiledTemplateResult } from 'lit-html';
import { _$LH, Template } from 'lit-html/private-ssr-support.js';

import { parse, Parser, EvalAstFactory } from 'jexpr';
import type { Expression, Scope } from 'jexpr/lib/eval';

const getTemplateHtml = _$LH.getTemplateHtml

const marker = getTemplateHtml(html`<p a=${1}>`.strings, 1)[0].toString().replace(/^.*=/, "").replace(/>.*$/, "")
const nodeMarker = "?" + marker

const RDFA_RESULT = 3;

export function rdfa(strings: TemplateStringsArray, ...values: unknown[]): TemplateResult<any> {
    const result = {
        ['_$litType$']: 1,
        ['_$isRdfa$']: true,
        strings,
        values,
    }
    return result
}

export function toHtml(template: TemplateResult<any>, newValues: Array<any> = []) {
    const newStrings = new Array<string>();
    // required dummy to make getTemplateHtml work
    (newStrings as any).raw = [""]
    expandTemplates(template, newStrings, newValues)
    return getTemplateHtml(newStrings as any as TemplateStringsArray, 1)
}

function expandTemplates(template: TemplateResult<any>, newStrings: Array<string>, newValues: Array<any>) {
    var appendNext = false
    for (var i = 0; i < template.strings.length; i++) {
        const str = template.strings[i]
        // directly append the next string part to ensure that lit doesn't insert a value marker
        // TODO it is maybe necessary to check if appending is allowed here, e.g. in the case of
        // attribute expressions
        if ((i == 0 || appendNext) && newStrings.length > 0) {
            newStrings[newStrings.length - 1] += str
        } else {
            newStrings.push(str)
        }
        appendNext = false
        if (i < template.values.length) {
            const value: any = template.values[i]
            if (value.hasOwnProperty('_$isRdfa$')) {
                expandTemplates(value as TemplateResult, newStrings, newValues)
                appendNext = true
            } else {
                newValues.push(value)
            }
        }
    }
}

const { AttributePart, PropertyPart, BooleanAttributePart, EventPart } = _$LH;

const astFactory = new EvalAstFactory();
const expressionCache = new Map<string, Expression | undefined>();

const toCamelCase = (s: string) =>
    s.replace(/-(-|\w)/g, (_, p1: string) => p1.toUpperCase());

/**
 * Gets the value from a string that contains a delimted expression: {{ ... }}
 */
const getSingleValue = (s: string, model: any) => {
    let ast = expressionCache.get(s);
    if (ast === undefined) {
        if (expressionCache.has(s)) {
            return undefined;
        }
        s = s.trim();
        if (s.startsWith('{{') && s.endsWith('}}')) {
            const expression = s.substring(2, s.length - 2).trim();
            ast = new Parser(expression, astFactory).parse();
            expressionCache.set(s, ast);
        }
    }
    return ast?.evaluate(model);
};

export interface TemplateFunction {
    (model: object): unknown;
}

/**
 * A Renderer is responsible for rendering a block call, like
 * <template name="foo">
 */
// TODO: rename to BlockRenderer?
export interface Renderer {
    (model: any, handlers: TemplateHandlers, renderers: Renderers): unknown;
}

export interface Renderers {
    [name: string]: Renderer;
}

/**
 * A TemplateHandlers is responsible for rendering control flow like
 * <template type="if" if="{{x}}">
 */
export type TemplateHandler = (
    template: Element,
    model: object,
    handlers: TemplateHandlers,
    renderers: Renderers,
    values?: Array<unknown>,
    valueIndex?: number
) => unknown;

export interface TemplateHandlers {
    [name: string]: TemplateHandler;
}

export const ifHandler: TemplateHandler = (
    template: Element,
    model: object,
    handlers: TemplateHandlers,
    renderers: Renderers,
    values: Array<unknown> = [],
    valueIndex: number = -1
) => {
    const ifAttribute = template.getAttribute('if');
    if (ifAttribute !== null && getSingleValue(ifAttribute, model)) {
        return evaluateTemplate(template, model, handlers, renderers);
    }
    return undefined;
};

/**
 * Groups elements of an array by a given key function.
 * 
 * @param array The array with the elements
 * @param keyFunc The key function
 * @returns map of grouped elements
 */
const groupBy = function <E>(array: E[], keyFunc: (e: E) => string | undefined): Map<string, E[]> {
    return array.reduce((grouped, x) => {
        const key = keyFunc(x);
        if (key !== undefined) {
            let list = grouped.get(key)
            if (!list) {
                list = []
                grouped.set(key, list)
            }
            list?.push(x)
        }
        return grouped;
    }, new Map<string, E[]>());
}

type BindingInfo = {
    optional: boolean
    attributes: string[]
}

const findTemplateVars = (template: Element): Map<string, BindingInfo> => {
    const attributeNames = template.getAttributeNames();
    const bindings = attributeNames.reduce((prev, name) => {
        const value = template.getAttribute(name)!
        if (value.startsWith("?") || value.startsWith("$")) {
            // this is an attribute that needs a binding
            const optional = value.startsWith("??") || value?.startsWith("?$")
            const varName = value.replace(/^[?]?[?$]/, "")
            const bindingInfo: BindingInfo = prev.get(varName) || { optional: false, attributes: [] }
            bindingInfo.optional = optional
            bindingInfo.attributes.push(name)
            prev.set(varName, bindingInfo)
        }
        return prev
    }, new Map<string, BindingInfo>());
    return bindings
}

const bindHandler: TemplateHandler = (
    template: Element,
    model: object,
    handlers: TemplateHandlers,
    renderers: Renderers,
    values: Array<unknown> = [],
    valueIndex: number = -1
) => {
    const templateVars = findTemplateVars(template)
    // group results by binding combinations
    // {
    //   "s": { "type": "uri" , "value": "http://example.org/someThing" } ,
    //   "label": { "type": "literal" , "value": "Thing 1" }
    // }
    const groupedBindings = groupBy(model['bindings'] as object[] || [], (e: object) => {
        let key = ""
        for (const [varName, bindingInfo] of templateVars) {
            const value = e[varName]
            if (!value && !bindingInfo.optional) {
                // do not add to a group if required binding is missing
                return undefined
            }
            key += JSON.stringify(value)
        }
        return key
    })

    const litTemplate = getLitTemplate(template, valueIndex);

    let index = -1;
    const result = [];
    for (const [key, bindings] of groupedBindings) {
        index++;
        const itemModel = Object.create(model);
        itemModel.bindings = bindings;
        itemModel.index = index;
        itemModel['this'] = model['this'] ?? model;

        const resultValues: Array<unknown> = [];
        litTemplate.parts.map((part) => {
            const value = part.update(itemModel, handlers, renderers);
            if (part.type === 1) {
                resultValues.push(...(value as Iterable<unknown>));
            } else {
                resultValues.push(value);
            }
        });
        const templateResult: CompiledTemplateResult = {
            _$litType$: litTemplate,
            values: resultValues,
        };
        result.push(templateResult);
    }
    return result.length > 0 ? result : nothing;
};

export const repeatHandler: TemplateHandler = (
    template: Element,
    model: object,
    handlers: TemplateHandlers,
    renderers: Renderers,
    values: Array<unknown> = [],
    valueIndex: number = -1
) => {
    const repeatAttribute = template.getAttribute('repeat');
    if (repeatAttribute !== null) {
        const items = getSingleValue(repeatAttribute, model);
        if (!items[Symbol.iterator]) {
            return nothing;
        }
        const litTemplate = getLitTemplate(template, valueIndex);

        let index = -1;
        const result = [];
        for (const item of items) {
            index++;
            const itemModel = Object.create(model);
            itemModel.item = item;
            itemModel.index = index;
            itemModel['this'] = model['this'] ?? model;

            const values = litTemplate.parts.map((part) =>
                part.update(itemModel, handlers, renderers)
            );
            const templateResult: CompiledTemplateResult = {
                _$litType$: litTemplate,
                values,
            };
            result.push(templateResult);
        }
        return result;
    }
    return undefined;
};

export const defaultHandlers = <TemplateHandlers>{
    if: ifHandler,
    repeat: repeatHandler,
};

/**
 * @returns {Function} a template function of the form (model) => TemplateResult
 */
export const prepareTemplate = (
    template: HTMLTemplateElement,
    handlers: TemplateHandlers = defaultHandlers,
    renderers: Renderers = {},
    superTemplate?: HTMLTemplateElement
): TemplateFunction => {
    const litTemplate = getLitTemplate(template, -1);
    const templateRenderers = litTemplate.renderers;
    if (superTemplate) {
        // TODO how to combine values and super template?
        const superLitTemplate = getLitTemplate(superTemplate);
        const superRenderers = superLitTemplate.renderers;
        const superCallRenderer = templateRenderers['super'];

        if (superCallRenderer !== undefined) {
            // Explicit super call

            // render the sub template with:
            renderers = {
                // sub template's own renderes
                ...templateRenderers,
                // passed-in renderers
                ...renderers,
                // a super call renderer
                super: (model, handlers, renderers) => {
                    // This renderer delegates to the super block in the sub template,
                    // which in turn delegates back to the super renderer below, but with
                    // the inner blocks of the super call.
                    // when the super call goes, render with:
                    renderers = {
                        // super template's own blocks
                        ...superRenderers,
                        // passed-in renderers
                        ...renderers,
                        // sub template's overrides will be added by the inner super call
                        super: (model, handlers, renderers) => {
                            return evaluateTemplate(
                                superTemplate,
                                model,
                                handlers,
                                renderers
                            );
                        },
                    };
                    return superCallRenderer(model, handlers, renderers);
                },
            };
        } else {
            // Implicit super call

            // Wrap the whole template in an implicit super call by rendering the
            // super template first, but using the block renderers from this template.
            // Render the super template with:
            renderers = {
                // super template's own blocks
                ...superRenderers,
                // sub template's overrides
                ...templateRenderers,
                // passed-in renderers
                ...renderers,
            };
            template = superTemplate;
        }
    } else {
        // No super call
        renderers = {
            ...renderers,
            ...templateRenderers,
        };
    }
    return (model) => evaluateTemplate(template, model, handlers, renderers);
};

export interface RenderOptions {
    renderers?: Renderers;
    extends?: HTMLTemplateElement;
}

/**
 * Renders a template element containing a Stampino template.
 *
 * This is a convenience function wrapper around:
 *
 * ```
 * import {render} from 'lit';
 * const templateFn = prepareTemplate(templateEl);
 * render(templateFn(model), container);
 * ```
 */
export const render = (
    template: HTMLTemplateElement,
    container: HTMLElement,
    model: any,
    handlers: TemplateHandlers = defaultHandlers
) => {
    const litTemplate = prepareTemplate(template, handlers);
    renderLit(litTemplate(model), container);
};

/**
 * Evaluates the given template and returns its result
 *
 * @param template
 * @param model
 * @param handlers
 * @param renderers
 * @returns
 */
export const evaluateTemplate = (
    template: Element,
    model: any,
    handlers: TemplateHandlers = defaultHandlers,
    renderers: Renderers = {},
    values: Array<unknown> = [],
    valueIndex: number = -1
) => {
    const litTemplate = getLitTemplate(template, valueIndex);
    const resultValues: Array<unknown> = [];
    for (const part of litTemplate.parts) {
        const value = part.update(model, handlers, renderers);
        if (part.type === 1) {
            resultValues.push(...(value as Iterable<unknown>));
        } else {
            resultValues.push(value);
        }
    }
    const templateResult: CompiledTemplateResult = {
        _$litType$: litTemplate,
        values: resultValues,
    };
    return templateResult;
};

type TemplatePart = Template['parts'][0];

type StampinoTemplatePart = TemplatePart & {
    update: PartUpdater;
};

type PartUpdater = (
    model: object,
    handlers: TemplateHandlers,
    blocks: Renderers
) => unknown;

interface StampinoTemplate extends CompiledTemplate {
    parts: Array<StampinoTemplatePart>;
    renderers: Renderers;
}

const litTemplateCache = new Map<Element, StampinoTemplate>();

export const getLitTemplate = (
    template: Element,
    valueIndex: number = -1
): StampinoTemplate => {
    let litTemplate = litTemplateCache.get(template);
    if (litTemplate === undefined) {
        litTemplateCache.set(template, (litTemplate = makeLitTemplate(template, valueIndex)));
    }
    return litTemplate;
};

const createAttributeBinder = (attributeName: string, value: string): PartUpdater => {
    // this is an attribute that needs a binding
    const optional = value.startsWith("??") || value?.startsWith("?$")
    const varName = value.replace(/^[?]?[?$]/, "")
    return (model: object, _handlers: TemplateHandlers, _renderers: Renderers) => {
        return model['bindings']?.[0]?.[varName]?.value
    }
}

const makeLitTemplate = (
    template: Element,
    valueIndex: number = -1
): StampinoTemplate => {
    var templateElement = template.cloneNode(true) as Element
    if (templateElement.tagName != "TEMPLATE") {
        // wrap element in template tag
        const wrapper = document.createElement("template") as HTMLTemplateElement
        wrapper.content.appendChild(templateElement)
        templateElement = wrapper
    }
    const litTemplate: StampinoTemplate = {
        h: undefined as unknown as TrustedHTML,
        el: templateElement as HTMLTemplateElement,
        parts: [],
        renderers: {},
    };
    const walker = document.createTreeWalker(
        litTemplate.el!.content,
        NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT
    );
    let node: Node | null = walker.currentNode;
    let nodeIndex = -1;
    const elementsToRemove = [];

    while ((node = walker.nextNode()) !== null) {
        if (node.nodeType === Node.ELEMENT_NODE) {
            nodeIndex++;
            const element = node as Element;
            const attributeNames = element.getAttributeNames();
            let ignoreHandler = !!element.getAttribute("ignoreHandler")
            if (ignoreHandler) {
                element.removeAttribute("ignoreHandler")
            }

            if (!ignoreHandler && attributeNames.find(name => {
                if (name.endsWith("$lit$")) {
                    // ignore attributes bound by expressions
                    return false
                } else {
                    const value = element.getAttribute(name)
                    return value?.startsWith("?") || value?.startsWith("$")
                }
            }) !== undefined) {
                element.parentNode!.insertBefore(document.createComment(''), element);
                elementsToRemove.push(element);
                // ensure that bind handler is not created in next recursive invocation
                element.setAttribute("ignoreHandler", "true")

                // this node requires bindings
                let update = (model: any, handlers: TemplateHandlers, renderers: Renderers) => {
                    return bindHandler(
                        element as HTMLElement,
                        model,
                        handlers,
                        renderers,
                        (model as any).values,
                        valueIndex
                    );
                };
                litTemplate.parts.push({
                    type: 2, // text binding
                    index: nodeIndex,
                    update,
                });
            } else if (element.tagName === 'TEMPLATE') {
                const type = element.getAttribute('type');
                const name = element.getAttribute('name');

                if (type !== null || name !== null) {
                    element.parentNode!.insertBefore(document.createComment(''), element);
                    elementsToRemove.push(element);
                    let update: PartUpdater;
                    if (type !== null) {
                        // This is a control-flow call, like if/repeat
                        update = (
                            model: object,
                            handlers: TemplateHandlers,
                            renderers: Renderers
                        ) => {
                            const handler = handlers[type];
                            return handler?.(
                                element as HTMLTemplateElement,
                                model,
                                handlers,
                                renderers,
                                (model as any).values,
                                valueIndex
                            );
                        };
                    } else {
                        // This is a named block
                        if (name === 'super') {
                            litTemplate.renderers['super'] = (
                                model: any,
                                handlers: TemplateHandlers,
                                renderers: Renderers
                            ) => {
                                // Instead of rendering this block, delegate to a passed in
                                // 'super' renderer which will actually render the late-bound
                                // super template. We pass that renderer the child blocks from
                                // this block for block overrides.
                                const superRenderer = renderers['super'];
                                const superCallTemplate = getLitTemplate(
                                    element as HTMLTemplateElement
                                );
                                renderers = {
                                    ...renderers,
                                    ...superCallTemplate.renderers,
                                };
                                return superRenderer(model, handlers, renderers);
                            };
                        } else {
                            // The renderer renders the contents of the named block
                            litTemplate.renderers[name!] = (
                                model: any,
                                handlers: TemplateHandlers,
                                renderers: Renderers
                            ) => {
                                return evaluateTemplate(
                                    element as HTMLTemplateElement,
                                    model,
                                    handlers,
                                    renderers
                                );
                            };
                        }
                        // The updater runs when the template is evaluated and functions as
                        // a template _call_. It looks for a named renderer, which might be
                        // the renderer function above if the block is not overridden.
                        update = (
                            model: object,
                            handlers: TemplateHandlers,
                            renderers: Renderers
                        ) => {
                            const renderer = renderers[name!];
                            return renderer?.(model, handlers, renderers);
                        };
                    }
                    litTemplate.parts.push({
                        type: 2, // text binding
                        index: nodeIndex,
                        update,
                    });
                }
            } else {
                const attributeNames = element.getAttributeNames();
                for (const attributeName of attributeNames) {
                    let update: PartUpdater;
                    let strings: Array<string>;

                    let name = attributeName;
                    const attributeValue = element.getAttribute(attributeName)!;
                    if (attributeName.endsWith("$lit$")) {
                        // this attribute has a lit marker and an associated value
                        name = attributeName.replace(/[$]lit[$]$/, "")

                        strings = attributeValue.split(marker)
                        let startIndex = ++valueIndex
                        let endIndex = valueIndex + strings.length - 2
                        valueIndex = endIndex

                        update = (model: object, _handlers: TemplateHandlers, _renderers: Renderers) => {
                            // endIndex is exclusive
                            return (model as any).values.slice(startIndex, endIndex + 1)
                        }
                    } else {
                        if (attributeValue.startsWith("?")) {
                            strings = ['', '']
                            update = createAttributeBinder(attributeName, attributeValue)
                        } else {
                            // TODO: use alternative to negative lookbehind
                            // (but it's so convenient!)
                            const splitValue = attributeValue.split(
                                /(?<!\\){{(.*?)(?:(?<!\\)}})/g
                            );
                            if (splitValue.length === 1) {
                                continue;
                            }

                            strings = [splitValue[0]];
                            const exprs: Array<Expression> = [];
                            for (let i = 1; i < splitValue.length; i += 2) {
                                const exprText = splitValue[i];
                                exprs.push(parse(exprText, astFactory) as Expression);
                                strings.push(splitValue[i + 1]);
                            }
                            update = (
                                model: object,
                                _handlers: TemplateHandlers,
                                _renderers: Renderers
                            ) => {
                                return exprs.map((expr) => expr.evaluate(model));
                            }
                        }
                    }

                    element.removeAttribute(attributeName);

                    let ctor = AttributePart;
                    const prefix = attributeName[0];
                    if (prefix === '.') {
                        name = toCamelCase(attributeName.substring(1));
                        ctor = PropertyPart;
                    } else if (prefix === '?') {
                        name = attributeName.substring(1);
                        ctor = BooleanAttributePart;
                    } else if (prefix === '@') {
                        name = toCamelCase(attributeName.substring(1));
                        ctor = EventPart;
                    }

                    litTemplate.parts.push({
                        type: 1, // attribute binding
                        index: nodeIndex,
                        name,
                        strings,
                        ctor,
                        update,
                    });
                }
            }
        } else if (node.nodeType === Node.COMMENT_NODE) {
            const text = (node as CharacterData).textContent!
            if (text.startsWith(nodeMarker)) {
                let theIndex = ++valueIndex
                litTemplate.parts.push({
                    type: 2,
                    index: ++nodeIndex,
                    update: (model: unknown, _handlers: TemplateHandlers) => {
                        return (model as any).values[theIndex]
                    }
                });
            }
        } else if (node.nodeType === Node.TEXT_NODE) {
            const textNode = node as Text;
            const text = textNode.textContent!;
            const strings = text.split(/(?<!\\){{(.*?)(?:(?<!\\)}})/g);
            if (strings.length > 1) {
                textNode.textContent = strings[0].replace('\\{{', '{{');
            } else {
                // TODO: do this better
                textNode.textContent = text.replace('\\{{', '{{');
            }
            for (let i = 1; i < strings.length; i += 2) {
                const exprText = strings[i];
                const expr = parse(exprText, astFactory) as Expression;
                litTemplate.parts.push({
                    type: 2,
                    index: ++nodeIndex,
                    update: (model: unknown, _handlers: TemplateHandlers) => expr.evaluate(model as Scope),
                });
                const newTextNode = new Text(strings[i + 1].replace('\\{{', '{{'));
                textNode.parentNode!.insertBefore(newTextNode, textNode.nextSibling);
                textNode.parentNode!.insertBefore(
                    document.createComment(''),
                    textNode.nextSibling
                );
                // This TreeWalker isn't configured to walk comment nodes, but this
                // node will be returned next time through the loop. This is the easiest
                // way to get the walker to proceed to the next successor after the
                // marker, even when the marker doesn't have a nextSibling
                walker.currentNode = newTextNode;
            }
        }
    }
    for (const e of elementsToRemove) {
        e.remove();
    }
    return litTemplate;
};
