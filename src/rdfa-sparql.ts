import {RDFaParser} from './rdfa';
import {
  NamedNode,
  BlankNode,
  Literal,
  Variable,
  DefaultGraph,
  Term,
  Quad,
  Quad_Graph,
  Quad_Object,
  Quad_Predicate,
  Quad_Subject,
  DataFactory,
  BaseQuad,
} from '@rdfjs/types';
import * as rdf from './rdf';

export class RDFaToSparqlParser extends RDFaParser {
  sparql: Array<string> = [];
  selectVars: Array<Variable> = [];
  orderBy: Array<string> = [];
  bindings: Map<string, Quad_Object> = new Map<string, Quad_Object>();
  seen: Set<string> = new Set<string>();

  initialIndentation: number = 1;
  initialStrictness: boolean = false;

  indentation = this.initialIndentation;

  indent() {
    this.indentation = this.indentation + 1;
  }
  dedent() {
    this.indentation = this.indentation - 1;
  }

  strict = this.initialStrictness;
  withinFilter = 0;

  readonly e: Element;
  readonly base: string;
  resultElem: Element | undefined;
  resultQuery: string | undefined;
  resultQuads: Array<Quad> = [];

  constructor(e: Element, base: string) {
    super();
    this.e = e;
    this.base = base;
    this.init();
  }

  projection(): string {
    return this.selectVars.map((v) => '?' + v.value).join(' ');
  }

  init() {
    const [e1, quads] = this.walk(
      this.e,
      this.base,
      rdf.factory.namedNode(this.base),
      undefined,
      [],
      [],
      undefined,
      new rdf.Scope(this.base)
    );
    var query = new Array<string>();

    this.addPrefixDecls(query, this.e);

    query.push(
      'select distinct ' + this.projection() + ' where {\n',
      ...this.patterns(),
      '}\n'
    );

    this.modifiers(this.e, query);
    this.resultQuery = query.join('');
    this.resultElem = e1;
    this.resultQuads = quads;
  }

  addPrefixDecls(query: Array<string>, e: Element) {
    const namespaces = this.getNamespaces(e);
    namespaces.forEach((value, prefix) => {
      query.push('prefix ', prefix, ': <', value, '>\n');
    });
  }

  addLine(s: string, pos: number = this.sparql.length) {
    const line = new Array<string>(this.indentation).fill('\t');
    line.push(s, '\n');
    this.sparql.splice(pos, 0, line.join(''));
  }

  getQuery(): string {
    return this.resultQuery ? this.resultQuery : '';
  }

  getQueryVariables(): Array<Variable> {
    return this.selectVars;
  }

  getElement() {
    return this.resultElem;
  }

  patterns(): Array<string> {
    if (this.sparql.length == 0) {
      // replace empty graph pattern {} with bind statements
      return this.selectVars.map(
        (v) => '\tbind (' + v.value + ' as ' + v.value + ')\n'
      );
    } else {
      return this.sparql;
    }
  }

  getQueryForBinding(
    bindingName: string,
    offset: any,
    limit: any,
    isSubQuery: boolean = false
  ) {
    var result = new Array<string>();
    if (!isSubQuery)
      this.resultElem && this.addPrefixDecls(result, this.resultElem);
    result.push('select distinct ?', bindingName, ' where {\n');
    result.push(...this.patterns());
    result.push('}\n');
    this.modifiers(this.e, result, false);
    result.push('offset ', offset, '\n');
    result.push('limit ', limit, '\n');
    return result.join('');
  }

  getPaginatedQuery(bindingName: string, offset: any, limit: any) {
    var result = new Array<string>();
    this.resultElem && this.addPrefixDecls(result, this.resultElem);
    result.push(
      'select distinct ',
      this.selectVars.map((v) => '?' + v.value).join(' '),
      ' where {\n'
    );

    // subquery to limit the solutions for given binding name
    result.push(
      '{ ',
      this.getQueryForBinding(bindingName, offset, limit, true),
      '}\n'
    );
    // end of subquery

    // use sparql instead of patterns here since
    // bindings are already generated by sub-query
    result.push(...this.sparql);
    result.push('}\n');
    this.modifiers(this.e, result);
    return result.join('');
  }

  getCountQuery(bindingName: string) {
    var result = new Array<string>();
    this.resultElem && this.addPrefixDecls(result, this.resultElem);
    result.push(
      'select (count(distinct ?',
      bindingName,
      ') as ?count) where {\n'
    );
    result.push(...this.patterns());
    result.push('}\n');
    return result.join('');
  }

  modifiers(
    e: Element,
    query: Array<string>,
    includeLimitOffset: boolean = true
  ) {
    if (this.orderBy.length > 0) {
      query.push('order by ', this.orderBy.join(' '), '\n');
    }

    if (includeLimitOffset) {
      this.nonempty(e, 'data-offset').forEach((v) => {
        query.push('offset ', v, '\n');
      });
      this.nonempty(e, 'data-limit').forEach((v) => {
        query.push('limit ', v, '\n');
      });
    }
  }

  nonempty(e: Element, name: string) {
    const value = e.getAttribute(name);
    return value ? [value] : [];
  }

  hasCssClass(e: Element, cssClass: string): boolean {
    return e.classList.contains(cssClass);
  }

  doMaybeStrict(e: Element, block: () => [Element, Array<Quad>]) {
    const strictAttribute: string | null = e.getAttribute('data-strict');
    const current =
      strictAttribute === null
        ? this.strict
        : strictAttribute.toLocaleLowerCase() != 'false';

    const old = this.strict;
    this.strict = current;
    const result = block();
    this.strict = old;
    return result;
  }

  override walk(
    e: Element,
    base: string,
    subj1: Quad_Subject,
    obj1: Term | undefined,
    pending1f: Array<NamedNode | Variable>,
    pending1r: Array<NamedNode | Variable>,
    lang1: string | undefined,
    s: rdf.Scope
  ): [Element, Array<Quad>] {
    if (this.nonempty(e, 'data-ignore').length) {
      // ignore elements that are annotated with data-ignore
      return [e, []];
    } else if (e.getAttribute('data-select')) {
      // remove data-select to prevent endless recursion

      const e1: Element = <Element>e.cloneNode(true);
      e1.removeAttribute('data-select');

      // create sub select
      this.indent();
      const subSelectParser = new SubSelectRDFaToSparqlParser(
        e1,
        base,
        e.getAttribute('data-select') || undefined,
        this.indentation,
        this.strict
      );
      subSelectParser.initSubSelectParser(
        subj1,
        obj1,
        pending1f,
        pending1r,
        lang1,
        s
      );
      const innerQuery = subSelectParser.getQuery();
      this.sparql.push('{\n' + innerQuery + '}\n');
      this.dedent();

      return [e1, []];
    } else {
      const self = this;
      return this.doMaybeStrict(e, () => {
        var close = 0;
        var closeFilter = 0;

        function addBlock(block: string) {
          self.addLine(block + '{');
          self.indent;
          close += 1;
        }
        function addFilter(block: string) {
          addBlock(block);
          self.withinFilter += 1;
          closeFilter += 1;
        }

        if (self.hasCssClass(e, 'group')) addBlock('');
        if (self.hasCssClass(e, 'optional')) addBlock('optional ');
        if (self.hasCssClass(e, 'exists')) addFilter('filter exists ');
        if (self.hasCssClass(e, 'not-exists')) addFilter('filter not exists ');

        self.nonempty(e, 'data-pattern').forEach((p) => {
          var pTrimmed = p.trim();
          // allow references to current subject node
          pTrimmed = pTrimmed.replace('?_', subj1.value);
          if (pTrimmed.endsWith('.') || pTrimmed.endsWith('}')) {
            self.addLine(p);
          } else {
            self.addLine(p + ' . ');
          }
        });
        self
          .nonempty(e, 'data-bind')
          .forEach((bind) => self.addLine('bind (' + bind + ')'));
        const result = super.walk(
          e,
          base,
          subj1,
          obj1,
          pending1f,
          pending1r,
          lang1,
          s
        );
        self
          .nonempty(e, 'data-filter')
          .forEach((filter) => self.addLine('filter (' + filter + ')'));
        while (close > 0) {
          self.dedent();
          self.addLine('}');
          close -= 1;
        }
        this.withinFilter -= closeFilter;

        return result;
      });
    }
  }

  override walkChildren(
    parent: Element,
    f: (e: Element) => Array<Quad>
  ): Array<Quad> {
    const isUnion = this.hasCssClass(parent, 'union');
    var prependUnion = false;
    const quads: Array<Quad> = [];
    for (var i = 0; i < parent.children.length; i++) {
      const start = this.sparql.length;
      quads.push(...f(parent.children[i]));

      if (isUnion && this.sparql.length > start) {
        this.addLine(prependUnion ? 'union {' : '{', start);
        this.addLine('}');
        prependUnion = true;
      }
    }
    return quads;
  }

  override handleQuads(
    e: Element,
    quads: Array<Quad>,
    isLiteral: boolean
  ): Array<Quad> {
    const self = this;
    quads
      .filter((q) => {
        const key = JSON.stringify(q);
        if (self.seen.has(key)) {
          return false;
        } else {
          self.seen.add(key);
          return true;
        }
      })
      .forEach((q) => {
        this.addLine(
          this.tostring(q.subject) +
            ' ' +
            this.tostring(q.predicate) +
            ' ' +
            this.tostring(q.object) +
            ' . '
        );
        if (this.strict) {
          if (isLiteral) {
            this.addLine(
              'FILTER ( isLiteral(' + this.tostring(q.object) + ') ) '
            );
          } else {
            this.addLine(
              'FILTER ( !isLiteral(' + this.tostring(q.object) + ') ) '
            );
          }
        }
      });
    return quads;
  }

  tostring(n: Quad_Object): string {
    switch (n.termType) {
      case 'BlankNode':
        return '_:' + n.value;
      case 'NamedNode':
        return '<' + n.value + '>';
      case 'Literal':
        const l = <Literal>n;
        const label = '"' + l.value + '"';
        if (l.language) {
          return label + '@' + l.language;
        } else {
          return label + '^^' + this.tostring(l.datatype);
        }
      case 'Variable':
        return '?' + n.value;
    }
    // should not happen
    return '';
  }

  override subjectObject(
    obj1: Term | undefined,
    e: Element,
    base: string,
    norel: boolean,
    types: Array<Term>,
    props: Array<Term>,
    s: rdf.Scope
  ): [Element, Quad_Subject | undefined, Quad_Object | undefined, boolean] {
    const [e1, subj, obj, skip] = super.subjectObject(
      obj1,
      e,
      base,
      norel,
      types,
      props,
      s
    );

    if (!skip && props.length == 0) {
      if (obj && obj.termType == 'Variable') {
        this.addToOrderBy(e1, <Variable>obj);
      } else if (subj && subj.termType == 'Variable') {
        this.addToOrderBy(e1, <Variable>subj);
      }
    }

    return [e1, subj, obj, skip];
  }

  /** Adds orderBy modifier for the given variable */
  addToOrderBy(e: Element, variable: Variable) {
    if (this.hasCssClass(e, 'asc')) {
      this.orderBy.push(this.tostring(variable));
    } else if (this.hasCssClass(e, 'desc')) {
      this.orderBy.push('desc(' + this.tostring(variable) + ')');
    }
  }

  override transformLiteral(
    e: Element,
    content: any,
    literal: Literal,
    s: rdf.Scope
  ): [Element, Quad_Object] {
    var [e1, literal1] = super.transformLiteral(e, content, literal, s);
    if ((content === null || content === undefined) && !e.textContent) {
      literal1 = this.select(s.fresh('l_'));
      e1 = <Element>e1.cloneNode(true);
      e1.setAttribute('data-clear-content', '');
    } else {
      // content="?someVar"
      if (this.variable.exec(literal1.value)) {
        const varName = literal1.value.replace(/^[?$]+/, '');
        literal1 = this.createVariable(varName, s);
        if (varName.length == 0) {
          e1 = <Element>e1.cloneNode(true);
          // TODO keep optional marker
          e1.setAttribute('content', '?' + literal1.value);
        }
      }
    }

    if (literal1.termType == 'Variable') {
      this.addToOrderBy(e1, <Variable>literal1);
    }

    return [e1, literal1];
  }

  override createVariable(name: string, s: rdf.Scope): Variable {
    if (!name) {
      return this.select(s.fresh('v'));
    } else {
      return this.select(rdf.factory.variable(name));
    }
  }

  select(v: Variable): Variable {
    // only select variable if we are not in a "filter exists" or "filter not exists" block
    if (this.withinFilter == 0) {
      if (
        this.selectVars.findIndex((selected) => selected.value == v.value) == -1
      ) {
        this.selectVars.push(v);
      }
    }
    return v;
  }
}

class SubSelectRDFaToSparqlParser extends RDFaToSparqlParser {
  readonly explicitProjection: string | undefined;

  constructor(
    e: Element,
    base: string,
    explicitProjection: string | undefined,
    initialIndentation: number,
    initialStrictness: boolean
  ) {
    super(e, base);
    this.initialIndentation = initialIndentation;
    this.initialStrictness = initialStrictness;
    this.explicitProjection = explicitProjection;
  }

  override init() {
    // do nothing
  }

  initSubSelectParser(
    subj1: Quad_Subject,
    obj1: Term | undefined,
    pending1f: Array<NamedNode | Variable>,
    pending1r: Array<NamedNode | Variable>,
    lang1: string | undefined,
    s: rdf.Scope
  ) {
    const [e1, _] = this.walk(
      this.e,
      this.base,
      subj1,
      obj1,
      pending1f,
      pending1r,
      lang1,
      s
    );
    var query = new Array<string>();

    this.addPrefixDecls(query, this.e);

    query.push(
      'select distinct ' + this.projection() + ' where {\n',
      ...this.patterns(),
      '}\n'
    );

    this.modifiers(this.e, query);
    this.resultQuery = query.join('');
    this.resultElem = e1;
  }

  override projection(): string {
    return this.explicitProjection
      ? this.explicitProjection
      : super.projection();
  }

  override addPrefixDecls(query: Array<string>, e: Element) {
    // do not add any prefixes
  }
}