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

/**
 * RDF abstract syntax per <cite><a
 * href="http://www.w3.org/TR/2004/REC-rdf-concepts-20040210/"
 * >Resource Description Framework (RDF):
 * Concepts and Abstract Syntax</a></cite>
 * W3C Recommendation 10 February 2004
 */
export class LiteralImpl implements Literal {
  readonly termType = 'Literal';
  value: string;
  language: string;
  datatype: NamedNode<string>;

  constructor(value: string, language: string, datatype: NamedNode<string>) {
    this.value = value;
    this.language = language;
    this.datatype = datatype;
  }

  equals(other: Term | null | undefined): boolean {
    return (
      !!other &&
      other.termType === this.termType &&
      other.value === this.value &&
      other.language === this.language &&
      other.datatype.equals(this.datatype)
    );
  }

  toString(): string {
    const label = '"' + this.value + '"';
    if (this.language) {
      return label + '@' + this.language;
    } else {
      return label + '^^' + this.datatype.toString();
    }
  }
}

export class VariableImpl implements Variable {
  readonly termType = 'Variable';
  value: string;

  baseName: string;
  qual?: number;

  constructor(baseName: string, qual?: number) {
    this.baseName = baseName;
    this.qual = qual;
    this.value = qual === undefined ? baseName : baseName + '_' + qual;
  }

  equals(other: Term | null | undefined): boolean {
    return (
      !!other && other.termType === this.termType && other.value === this.value
    );
  }

  toString() {
    return '?' + this.value;
  }
}

export class NamedNodeImpl implements NamedNode<string> {
  readonly termType = 'NamedNode';
  value: string;

  constructor(value: string) {
    this.value = value;
  }

  equals(other: Term | null | undefined): boolean {
    return (
      !!other && other.termType === this.termType && other.value === this.value
    );
  }

  toString() {
    return '<' + this.value + '>';
  }
}

export class BlankNodeImpl implements BlankNode {
  readonly termType = 'BlankNode';
  value: string;

  constructor(id: string) {
    this.value = id;
  }

  equals(other: Term | null | undefined): boolean {
    return (
      !!other && other.termType === this.termType && other.value === this.value
    );
  }

  toString() {
    return '_:' + this.value;
  }
}

export class DefaultGraphImpl implements DefaultGraph {
  readonly termType = 'DefaultGraph';
  readonly value = '';

  equals(other: Term | null | undefined): boolean {
    return (
      !!other && other.termType === this.termType && other.value === this.value
    );
  }
}

export class QuadImpl implements Quad {
  subject: Quad_Subject;
  predicate: Quad_Predicate;
  object: Quad_Object;
  graph: Quad_Graph;

  readonly termType = 'Quad';
  readonly value = '';

  constructor(
    subject: Quad_Subject,
    predicate: Quad_Predicate,
    object: Quad_Object,
    graph: Quad_Graph
  ) {
    this.subject = subject;
    this.predicate = predicate;
    this.object = object;
    this.graph = graph;
  }

  equals(other: Term | null | undefined): boolean {
    return (
      !!other &&
      other.termType === 'Quad' &&
      other.subject.equals(this.subject) &&
      other.predicate.equals(this.predicate) &&
      other.object.equals(this.object) &&
      other.graph.equals(this.graph)
    );
  }

  toString(): string {
    return this.subject + ' ' + this.predicate + ' ' + this.object;
  }
}

export interface Factory<
  OutQuad extends BaseQuad = Quad,
  InQuad extends BaseQuad = OutQuad
> extends DataFactory<OutQuad, InQuad> {
  variable(value: string): Variable;
}

class FactoryImpl implements Factory {
  readonly defaultGraphInstance = new DefaultGraphImpl();
  blankNodeId: number = 1;

  namedNode(value: string): NamedNode<any> {
    return new NamedNodeImpl(value);
  }

  blankNode(value?: string): BlankNode {
    return new BlankNodeImpl(value || 'n' + this.blankNodeId++);
  }

  literal(
    value: string,
    languageOrDatatype?: string | NamedNode<string>
  ): Literal {
    if (typeof languageOrDatatype == 'string') {
      return new LiteralImpl(
        value,
        languageOrDatatype as string,
        this.namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#langString')
      );
    } else {
      return new LiteralImpl(
        value,
        '',
        languageOrDatatype
          ? (languageOrDatatype as NamedNode<string>)
          : this.namedNode('http://www.w3.org/2001/XMLSchema#string')
      );
    }
  }

  defaultGraph(): DefaultGraph {
    return this.defaultGraphInstance;
  }

  quad(
    subject: Quad_Subject,
    predicate: Quad_Predicate,
    object: Quad_Object,
    graph?: Quad_Graph
  ): Quad {
    return new QuadImpl(
      subject,
      predicate,
      object,
      graph || this.defaultGraphInstance
    );
  }

  variable(value: string): Variable {
    return new VariableImpl(value);
  }
}

export const factory: Factory = new FactoryImpl();

export namespace vocab {
  export namespace rdf {
    const ns = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
    export const type = ns + 'type';
    export const nil = ns + 'nil';
    export const first = ns + 'first';
    export const rest = ns + 'rest';
    export const XMLLiteral = ns + 'XMLLiteral';
  }

  export namespace xsd {
    export const ns = 'http://www.w3.org/2001/XMLSchema#';
    export const integer = ns + 'integer';
    export const double = ns + 'double';
    export const decimal = ns + 'decimal';
    export const boolean = ns + 'boolean';
  }
}

export class Scope {
  readonly vars: Array<Variable> = [];
  readonly baseNamespace: string;
  namespaces: Array<Map<string, string>> = [];

  constructor(baseNamespace: string, vars: Array<Variable> = []) {
    this.baseNamespace = baseNamespace;
    this.vars.push(...vars);
  }

  /* baseName is a name that does *not* follow the xyx.123 pattern */
  safeName(name: string): string {
    const lastChar = name.substring(name.length - 1);
    if ('0123456789'.includes(lastChar) && name.includes('.')) {
      return name + '_';
    } else {
      return name;
    }
  }

  /**
   * Return a variable for this name, creating one if necessary.
   * @return: the same variable given the same name.
   */
  byName(name: string): Variable {
    const safe = this.safeName(name);
    const existing = this.vars.find((v) => v.value == safe);
    return existing ? existing : this.fresh(safe);
  }

  /**
   * @param suggestedName: an variable name
   * @return an variable name unique to this scope
   */
  fresh(suggestedName: string): Variable {
    const baseName = this.safeName(suggestedName);
    const exists = this.vars.find((v) => v.value == baseName) !== undefined;
    if (exists) {
      return new VariableImpl(baseName, this.vars.length);
    } else {
      return new VariableImpl(baseName);
    }
  }

  namespace(prefix: string): string | undefined {
    if (!prefix || this.namespaces.length == 0) {
      return this.baseNamespace;
    }
    for (var i = this.namespaces.length - 1; i >= 0; i--) {
      // search within known namespaces
      const ns = this.namespaces[this.namespaces.length - 1].get(prefix);
      if (ns !== undefined) {
        return ns;
      }
    }
    return undefined;
  }
}
