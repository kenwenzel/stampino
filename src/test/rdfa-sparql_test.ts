import {assert} from '@esm-bundle/chai';
import {RDFaToSparqlParser} from '../rdfa-sparql';
import {factory as f} from '../rdf';

suite('rdfa-sparql', () => {
  let container: HTMLDivElement;

  setup(() => {
    container = document.createElement('div');
  });

  test('Simple property with var', () => {
    const div = document.createElement('div');
    div.innerHTML = `<div prefix="dc: http://purl.org/dc/elements/1.1/">
       <p>This photo was taken by <span class="author" about="photo1.jpg" property="dc:creator" content="?creator"></span>.</p>
    </div>`;

    const p = new RDFaToSparqlParser(div, 'http://example.org/');
    const quads = p.resultQuads;
    console.log(quads.map((q) => q.toString()));

    assert.isTrue(
      [
        f.quad(
          f.namedNode('http://example.org/photo1.jpg'),
          f.namedNode('http://purl.org/dc/elements/1.1/creator'),
          f.variable('creator')
        ),
      ].every((q1) => quads.findIndex((q2) => q1.equals(q2)) >= 0)
    );
  });
});

test('Complex', () => {
  const div = document.createElement('div');
  div.innerHTML = `<div prefix="
  rdf: http://www.w3.org/1999/02/22-rdf-syntax-ns#
  rdfs: http://www.w3.org/2000/01/rdf-schema#
  vocab: http://example.org/vocab/
  obj: http://example.org/objects/">
    <p about="?s" rel="vocab:rel1">
      <i rel="rdf:type" resource="vocab:someThing-type"></i>

      <span about="?o1" typeof="vocab:o1-type" rel="vocab:rel2">
        <span resource="obj:o3"></span>
        <span><span resource="obj:o4"></span></span>
        <span class="union">
          <span property="vocab:index" datatype="vocab:number">1</span>
          <span property="vocab:index" datatype="vocab:number" content="2">some other text</span>
          <span property="vocab:index" datatype="http://example.org/vocab/number">3</span>
          <span property="vocab:index" datatype="vocab:number" content="?index"></span>
        </span>
      </span>
      <span about="obj:o2"></span>

      <span property="?prop" content="some label"></span>
    </p>
  </div>`;

  const p = new RDFaToSparqlParser(div, 'http://example.org/');
  const quads = p.resultQuads;

  const expected = [
    '?s <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://example.org/vocab/someThing-type>',
    '?o1 <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://example.org/vocab/o1-type>',
    '?s <http://example.org/vocab/rel1> ?o1',
    '?o1 <http://example.org/vocab/rel2> <http://example.org/objects/o3>',
    '?o1 <http://example.org/vocab/rel2> <http://example.org/objects/o4>',
    '?o1 <http://example.org/vocab/index> "1"^^<http://example.org/vocab/number>',
    '?o1 <http://example.org/vocab/index> "2"^^<http://example.org/vocab/number>',
    '?o1 <http://example.org/vocab/index> "3"^^<http://example.org/vocab/number>',
    '?o1 <http://example.org/vocab/index> ?index',
    '?s <http://example.org/vocab/rel1> <http://example.org/objects/o2>',
    '?s ?prop "some label"^^<http://www.w3.org/2001/XMLSchema#string>',
  ];

  assert.sameMembers(
    quads.map((q) => q.toString()),
    expected
  );

  console.log(p.getQuery());
});
