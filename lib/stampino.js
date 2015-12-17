import * as idom from 'incremental-dom';
import { Parser } from 'polymer-expressions/parser';
import { EvalAstFactory } from 'polymer-expressions/eval';

let astFactory = new EvalAstFactory();

const toCamelCase = (s) => s.replace(/-(\w)/, (m) => m.p1.toUppercase());

idom.attributes.__default = function(element, name, value) {
  if (name.endsWith('$')) {
    name = name.substring(0, name.length - 1);
    element.setAttribute(name, value);
  } else {
    element[toCamelCase(name)] = value;
  }
};

export function getValue(value, model) {
  if (value.startsWith('{{') && value.endsWith('}}')) {
    let expression = value.substring(2, value.length - 2);
    let ast = new Parser(expression, astFactory).parse();
    return ast.evaluate(model);
  }
  if (value.startsWith('\\{{')) {
    return value.substring(1);
  }
  return value;
}

const defaultHandlers = {
  'if': function(template, model, renderers, handlers, attributeHandler) {
    let ifAttribute = template.getAttribute('if');
    if (ifAttribute && getValue(ifAttribute, model)) {
      renderNode(template.content, model, renderers, handlers, attributeHandler);
    }
  },

  'repeat': function(template, model, renderers, handlers, attributeHandler) {
    let repeatAttribute = template.getAttribute('repeat');

    if (repeatAttribute) {
      let items = getValue(repeatAttribute, model);
      for (let item of items) {
        // TODO: provide keys to incremental-dom
        let itemModel = Object.create(model);
        itemModel.item = item;
        renderNode(template.content, itemModel, renderers, handlers, attributeHandler);
      }
    }
  },
};

function getRenderers(template) {
  let blocks = template.content.querySelectorAll('[name]');
  let renderers = {};
  for (let i = 0; i < blocks.length; i++) {
    let block = blocks[i];
    let name = block.getAttribute('name');
    if (name !== 'super') {
      renderers[name] = (model, renderers, handlers, attributeHandler) =>
          renderNode(block.content, model, renderers, handlers, attributeHandler);
    }
  }
  return renderers;
}

/**
 * @returns {Function} a render function that can be passed to incremental-dom's
 * patch() function.
 */
export function prepareTemplate(template, renderers, handlers, attributeHandler,
    superTemplate) {
  handlers = handlers || defaultHandlers;
  renderers = renderers || {};

  if (superTemplate) {
    let superNode = template.content.querySelector('[name=super]');
    if (superNode) {
      let superRenderers = getRenderers(superNode);
      renderers = {
        'super': (model, renderers, handlers, attributeHandler) => {
          renderNode(superTemplate.content, model, superRenderers, handlers,
              attributeHandler);
        },
      };
    } else {
      // Wrap the whole template in an implicit super call: immediately render
      // the super template, with all renderers from this template
      let templateRenderers = getRenderers(template);
      Object.assign(templateRenderers, renderers);
      renderers = templateRenderers;
      template = superTemplate;
    }
  }

  return (model) => renderNode(template.content, model, renderers, handlers,
      attributeHandler);
}

/**
 * Renders a template element containing a Stampino template.
 *
 * This version interprets the template by walking its content and invoking
 * incremental-dom calls for each node, and evaluating Polymer expressions
 * contained within {{ }} blocks.
 *
 * As an optimization we can compile templates into a list of objects that
 * directly translate to incremental-dom calls, and includes pre-parsed
 * expressions. We won't optimize until we have benchmarks in place however.
 */
export function render(template, container, model, opts) {
  console.log('stampino.render', opts.attributeHandler);
  let _render = prepareTemplate(template, opts.renderers, opts.handlers,
      opts.attributeHandler, opts.extends);
  idom.patch(container, _render, model);
}

export function renderNode(node, model, renderers, handlers, attributeHandler) {
  switch (node.nodeType) {
    // We encounter DocumentFragments when we recurse into a nested template
    case Node.DOCUMENT_FRAGMENT_NODE:
      let children = node.childNodes;
      for (let i = 0; i < children.length; i++) {
        renderNode(children[i], model, renderers, handlers, attributeHandler);
      }
      break;
    case Node.ELEMENT_NODE:
      if (node.tagName.toLowerCase() === 'template') {
        // Handle template types, like: 'if' and 'repeat'
        let typeAttribute = node.getAttribute('type');
        if (typeAttribute) {
          let handler = handlers[typeAttribute];
          if (handler) {
            handler(node, model, renderers, handlers, attributeHandler);
          } else {
            console.warn('No handler for template type', typeAttribute);
            return;
          }
        }
        // Handle named holes
        let nameAttribute = node.getAttribute('name');
        if (nameAttribute) {
          if (renderers) {
            let renderer = renderers[nameAttribute];
            if (renderer) {
              renderer(node, model, renderers, handlers, attributeHandler);
              return;
            }
          }
          // if there's no named renderer, render the default content
          renderNode(node.content, model, renderers, handlers, attributeHandler);
          return;
        }
        // by default, templates are not rendered
      } else {
        // elementOpen has a weird API. It takes varargs, so we need to build
        // up the arguments array to pass to Function.apply :(
        let args = [node.tagName, null, null];
        let attributes = node.attributes;
        let handledAttributes = [];
        for (let i = 0; i < attributes.length; i++) {
          let attr = attributes[i];
          if (attributeHandler && attributeHandler.matches(attr.name)) {
            handledAttributes.push(attr);
          } else {
            // TODO: if attribute is a literal, add it to statics instead
            args.push(attr.name);
            args.push(getValue(attr.value, model));
          }
        }
        let el = idom.elementOpen.apply(null, args);

        for (let i = 0; i < handledAttributes.length; i++) {
          let attr = handledAttributes[i];
          attributeHandler.handle(el, attr.name, attr.value, model);
        }

        let children = node.childNodes;
        for (let i = 0; i < children.length; i++) {
          renderNode(children[i], model, renderers, handlers, attributeHandler);
        }
        idom.elementClose(node.tagName);
      }
      break;
    case Node.TEXT_NODE:
      let value = getValue(node.nodeValue, model);
      idom.text(value);
      break;
    default:
      console.warn('unhandled node type', node.nodeType);
  }
}