import {
  NamedNode,
  Literal,
  Variable,
  Term,
  Quad,
  Quad_Object,
  Quad_Predicate,
  Quad_Subject,
} from '@rdfjs/types';
import * as rdf from './rdf';

/**
 * There is perhaps a more general notion of CURIE, but this captures
 * only the RDFa-specific notion.
 */
class CurieSupport {
  readonly parts = /^(?:([^:]*)?:)?(.*)$/;
  readonly safeCurie = /^\[(.*)\]$/;
  readonly variable = /^[?$]+(.*)$/;

  /**
   * expand one safe curie or URI reference
   */
  ref1(
    e: Element,
    attr: string,
    base: string,
    s: rdf.Scope
  ): [Element, NamedNode | Variable | undefined] {
    const attrValue = e.getAttribute(attr);
    if (attrValue) {
      const result = this.safeCurie.exec(attrValue);
      var curieOrIri: string;
      if (result) {
        curieOrIri = result[1];
      } else {
        curieOrIri = attrValue;
      }
      const [ref, expanded] = this.expandCurie(e, curieOrIri, s);
      if (ref && expanded) {
        return [this.setExpandedReference(e, attr, ref), ref];
      } else {
        return [e, ref];
      }
    }
    return [e, undefined];
  }

  setExpandedReference(e: Element, attr: string, ref: Term): Element {
    return e;
  }

  // 9.3. @rel/@rev attribute values
  readonly reserved: Array<string> = [
    'alternate',
    'appendix',
    'bookmark',
    'cite',
    'chapter',
    'first',
    'glossary',
    'help',
    'icon',
    'index',
    'last',
    'license',
    'meta',
    'next',
    'p3pv1',
    'prev',
    'role',
    'section',
    'stylesheet',
    'subsection',
    'start',
    'top',
    'up',
  ];

  readonly xhv = 'http://www.w3.org/1999/xhtml/vocab#';

  expandCurie(
    e: Element,
    curieOrIri: string,
    s: rdf.Scope
  ): [NamedNode | Variable | undefined, boolean] {
    if (!curieOrIri) {
      return [undefined, false];
    }

    // support for SPARQL variables
    var result = this.variable.exec(curieOrIri);
    if (result) {
      var v = result[1];
      if (v == '?' || v == '$') {
        // anonymous variables must be expanded
        return [this.createVariable(v, s), true];
      } else {
        return [this.createVariable(v, s), false];
      }
    }

    result = this.parts.exec(curieOrIri);
    if (result) {
      const [_, p, l] = result;
      if (p == '_') {
        if (l == '') {
          return [s.byName('_'), false];
        } else {
          return [s.byName(l), false];
        }
      } else {
        try {
          const exandedRef = this.expand(p, l, e, s);
          return [rdf.factory.namedNode(exandedRef), true];
        } catch (e) {
          // prefix is unknown
        }

        // this is the case if token is an absolute IRI
        return [rdf.factory.namedNode(curieOrIri), false];
      }
    }

    return [undefined, false];
  }

  refN(
    e: Element,
    attr: string,
    bare: boolean,
    s: rdf.Scope
  ): [Element, Array<NamedNode | Variable>] {
    var expanded: boolean = false;
    const attrValue = e.getAttribute(attr);
    if (attrValue) {
      const refs: Array<NamedNode | Variable> = attrValue
        .split(/\s+/)
        .flatMap((token) => {
          if (bare && this.reserved.includes(token.toLowerCase())) {
            return [rdf.factory.namedNode(this.xhv + token.toLowerCase)];
          } else {
            const [ref, refExpanded] = this.expandCurie(e, token, s);
            expanded = expanded || refExpanded;
            return ref ? [ref] : [];
          }
        });
      if (expanded) {
        return [this.setExpandedReferences(e, attr, refs), refs];
      } else {
        return [e, refs];
      }
    }
    return [e, []];
  }

  setExpandedReferences(
    e: Element,
    attr: string,
    refs: Array<NamedNode | Variable>
  ): Element {
    return e;
  }

  createVariable(name: string, s: rdf.Scope): Variable {
    return name == '?' || name == '$' ? s.fresh('v') : s.byName(name);
  }

  expand(p: string, l: string, e: Element, s: rdf.Scope): string {
    var ns: string | undefined = s.namespace(p);

    if (!ns) {
      throw new Error('unknown prefix ' + p + ' for element ' + e);
    }

    return ns + l;
  }
}

/**
 * Simple RDFa parser.
 *
 * @See: <a href="http://www.w3.org/TR/rdfa-syntax/">RDFa in XHTML: Syntax and Processing</a>
 * W3C Recommendation 14 October 2008
 *
 */
export class RDFaParser extends CurieSupport {
  /**
   * Returns the namespaces declared in the scope of the element.
   */
  getNamespaces(e: Element): Map<string, string> {
    const ns = new Map<string, string>();

    if (e.attributes) {
      for (var i = 0; i < e.attributes.length; i++) {
        const a = e.attributes[i];
        const result = /^xmlns(:(.+))?$/.exec(a.nodeName);
        if (result) {
          const prefix = result[2] || '';
          const value = a.nodeValue || '';
          if (value !== '') {
            ns.set(prefix, value);
          }
        }
      }
    }

    // RDFa 1.1 prefix attribute
    var prefixes = e.getAttribute('prefix');
    if (prefixes) {
      var prefixRegex = /([^\s:]+):\s+([\S]+)/g;
      var result;
      while ((result = prefixRegex.exec(prefixes)) !== null) {
        ns.set(result[1], result[2]);
      }
    }

    return ns;
  }

  getStatements(e: Element, base: string): Array<Quad> {
    return this.walk(
      e,
      base,
      rdf.factory.namedNode(base),
      undefined,
      [],
      [],
      undefined,
      new rdf.Scope(base)
    )[1];
  }

  /**
   * Walk element recursively, finding quads.
   *
   * based on section <a href="http://www.w3.org/TR/rdfa-syntax/#sec_5.5.">5.5. Sequence</a>
   *
   * @param subj1: [parent subject] from step 1
   * @param obj1: [parent object] from step 1
   * @param pending1f: properties of [list of incomplete triples]
   *                   from evaluation context, forward direction
   * @param pending1r: properties of [list of incomplete triples]
   *                   from evaluation context, reverse direction
   * @param lang1: [language] from step 1
   *
   */
  walk(
    e: Element,
    base: string,
    subj: Quad_Subject,
    obj: Term | undefined,
    pendingRel: Array<NamedNode | Variable>,
    pendingRev: Array<NamedNode | Variable>,
    lang1: string | undefined,
    s: rdf.Scope
  ): [Element, Array<Quad>] {
    // step 2., URI mappings
    const namespaces = this.getNamespaces(e);
    if (namespaces.size) {
      s.namespaces.push(namespaces);
    }

    // step 3. [current language]
    const lang2 = e.getAttribute('lang');
    const lang = lang2 ? lang2 : lang1;

    // steps 4 and 5, refactored
    const [e01, relterms] = this.refN(e, 'rel', true, s);
    const [e02, revterms] = this.refN(e01, 'rev', true, s);
    const [e03, types] = this.refN(e02, 'typeof', false, s);
    const [e04, props] = this.refN(e03, 'property', false, s);
    const norel = relterms.length == 0 && revterms.length == 0;
    const [e1, newSubj, newObj, skip] = this.subjectObject(
      obj,
      e04,
      base,
      norel,
      types,
      props,
      s
    );

    // step 6. typeof
    const target = newObj ? newObj : newSubj;
    const typeQuads: Array<Quad> = target
      ? types.map((t) =>
          rdf.factory.quad(
            target as Quad_Subject,
            rdf.factory.namedNode(rdf.vocab.rdf.type),
            t
          )
        )
      : [];

    // step 7 rel/rev triples
    const quadSubj = newSubj ? newSubj : subj;
    const relRevQuads: Array<Quad> =
      newObj && quadSubj
        ? ([
            ...relterms.map((p) => rdf.factory.quad(quadSubj, p, newObj)),
            ...revterms.map((p) =>
              rdf.factory.quad(newObj as Quad_Subject, p, quadSubj)
            ),
          ] as Array<Quad>)
        : [];

    // step 8 incomplete triples.
    const [newObj2, pending8f, pending8r] =
      !newObj && !norel ? [undefined, relterms, revterms] : [newObj, [], []];

    // step 9 literal object
    const [[e2, propertyQuads, xmlobj], isLiteral] = props.length
      ? [this.literalObject(quadSubj, props, lang, e1, s), true]
      : [[e1, [], false], false];

    // step 10 complete incomplete triples.
    const completedQuads: Array<Quad> =
      !skip && newSubj
        ? ([
            ...pendingRel.map((p) => rdf.factory.quad(subj, p, newSubj)),
            ...pendingRev.map((p) => rdf.factory.quad(newSubj, p, subj)),
          ] as Array<Quad>)
        : [];

    // step 11. recur
    var newE = e2;
    const quads = this.handleQuads(
      newE,
      [...typeQuads, ...relRevQuads, ...propertyQuads, ...completedQuads],
      isLiteral
    );

    var childArcs: Array<Quad> = [];
    if (!xmlobj) {
      const newChildren: Array<Element> = [];
      var changedChild = false;
      childArcs = this.walkChildren(newE, (c) => {
        const [newC, quads] = skip
          ? this.walk(c, base, subj, obj, pendingRel, pendingRev, lang, s)
          : this.walk(
              c,
              base,
              quadSubj,
              newObj2 ? newObj2 : quadSubj,
              pending8f,
              pending8r,
              lang,
              s
            );

        changedChild = changedChild || newC !== c;
        newChildren.push(newC);
        return quads;
      });

      if (changedChild) {
        const cloned = <Element>newE.cloneNode(false);
        for (var i = 0; i < newE.children.length; i++) {
          const oldChild = newE.children[i];
          const newChild = newChildren[i];
          if (oldChild === newChild) {
            // old node needs to be cloned
            cloned.appendChild(oldChild.cloneNode(true));
          } else {
            cloned.appendChild(newChild);
          }
        }
      }
    }

    if (namespaces.size) {
      s.namespaces.pop;
    }

    return [newE, [...quads, ...childArcs]];
  }

  walkChildren(parent: Element, f: (e: Element) => Array<Quad>): Array<Quad> {
    const quads: Array<Quad> = [];
    for (var i = 0; i < parent.children.length; i++) {
      quads.push(...f(parent.children[i]));
    }
    return quads;
  }

  /**
   * steps 4 and 5, refactored
   * @return: new subject, new object skip flag
   */
  subjectObject(
    obj: Term | undefined,
    e: Element,
    base: string,
    norel: boolean,
    types: Array<Term>,
    props: Array<Term>,
    s: rdf.Scope
  ): [Element, Quad_Subject | undefined, Quad_Object | undefined, boolean] {
    const [e1, about] = this.ref1(e, 'about', base, s);
    const [e2, resource] = this.ref1(e1, 'resource', base, s);

    var newSubj: Quad_Subject | undefined = undefined;
    if (about) {
      newSubj = about;
    } else {
      const src = e.getAttribute('src');
      if (src) {
        newSubj = rdf.factory.namedNode(Uris.combine(base, src));
      } else if (norel && resource) {
        newSubj = resource;
      } else if (norel && e.getAttribute('href')) {
        newSubj = rdf.factory.namedNode(
          Uris.combine(base, e.getAttribute('href')!)
        );
      } else if (e.tagName == 'HEAD' || e.tagName == 'BODY') {
        newSubj = rdf.factory.namedNode(Uris.combine(base, ''));
      } else if (types.length && !resource && !e.getAttribute('href')) {
        newSubj = s.fresh('x4');
      }
    }

    var newObj: Term | undefined = undefined;
    if (resource) {
      newObj = resource;
    } else if (e.getAttribute('href')) {
      newObj = rdf.factory.namedNode(
        Uris.combine(base, e.getAttribute('href')!)
      );
    } else {
      newObj = undefined;
    }

    const skip: boolean = norel && !newSubj && props.length == 0;

    return [e2, newSubj as Quad_Subject, newObj, skip];
  }

  handleQuads(e: Element, quads: Array<Quad>, isLiteral: boolean): Array<Quad> {
    return quads;
  }

  transformLiteral(
    e: Element,
    content: any,
    literal: Literal,
    s: rdf.Scope
  ): [Element, Quad_Object] {
    return [e, literal];
  }

  /**
   * step 9 literal object
   * @return: (quads, xmllit) where xmllit is true iff object is XMLLiteral
   */
  literalObject(
    subj: Quad_Subject,
    props: Array<Quad_Predicate>,
    lang: string | undefined,
    e: Element,
    s: rdf.Scope
  ): [Element, Array<Quad>, boolean] {
    const content = e.getAttribute('content');
    const datatype = e.getAttribute('datatype');

    const [e1, literal1, xmlobj] = this.createLiteral(
      e,
      lang,
      datatype,
      content,
      s
    );
    const [e2, literal2] = literal1
      ? this.transformLiteral(e1, content, literal1, s)
      : [e1, undefined];
    return [
      e2,
      literal2 ? props.map((p) => rdf.factory.quad(subj, p, literal2)) : [],
      xmlobj,
    ];
  }

  createLiteral(
    e: Element,
    lang: string | undefined,
    datatype: string | null,
    content: string | null,
    s: rdf.Scope
  ): [Element, Literal | undefined, boolean] {
    const lex = content && content.length > 0 ? content : e.textContent;
    if (!datatype || datatype.length == 0) {
      // literals without @datatype are always handled as plain literals
      return [e, rdf.factory.literal(lex || '', lang), false];
    } else {
      const [result, _] = this.expandCurie(e, datatype, s);
      if (result) {
        return result.value == rdf.vocab.rdf.XMLLiteral
          ? [
              e,
              rdf.factory.literal(
                e.innerHTML,
                rdf.factory.namedNode(rdf.vocab.rdf.XMLLiteral)
              ),
              true,
            ]
          : [e, rdf.factory.literal(lex || '', result as NamedNode), false];
      }
      return [e, undefined, false];
    }
  }
}
