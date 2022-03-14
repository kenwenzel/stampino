import n3 from 'n3'
import { HashMapDataset, Graph, PlanBuilder, PipelineStage } from 'sparql-engine'

// Format a triple pattern according to N3 API:
// SPARQL variables must be replaced by `null` values
function formatTriplePattern (triple : any) : n3.Quad {
  let subject = null
  let predicate = null
  let object = null
  if (!triple.subject.startsWith('?')) {
    subject = triple.subject
  }
  if (!triple.predicate.startsWith('?')) {
    predicate = triple.predicate
  }
  if (!triple.object.startsWith('?')) {
    object = triple.object
  }
  return new n3.Quad(subject, predicate, object)
}

class N3Graph extends Graph {
    _store : n3.Store

  constructor () {
    super()
    this._store = new n3.Store()
  }

  insert (triple : any) : Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this._store.addQuad(triple.subject, triple.predicate, triple.object)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  }

  delete (triple : any) : Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this._store.removeQuad(triple.subject, triple.predicate, triple.object)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  }

  find (triple: any) : Iterable<any> {
    console.log("Find:", triple)
    const { subject, predicate, object } = formatTriplePattern(triple)
    const quads = this._store.getQuads(subject, predicate, object, null).map((quad: n3.Quad) => {
      console.log("Quad:", quad)
      return { subject: quad.subject, predicate : quad.predicate, object : quad.object }
    })
    return quads
  }

  estimateCardinality (triple : any) : Promise<number> {
    const { subject, predicate, object } = formatTriplePattern(triple)
    return Promise.resolve(this._store.countQuads(subject, predicate, object, null))
  }

  clear(): Promise<void> {
    return Promise.resolve(this._store.removeMatches() as any)
  }
}

const graph = new N3Graph()
const dataset = new HashMapDataset('http://example.org#default', graph)

// Load some RDF data into the graph
const parser = new n3.Parser()
parser.parse(`
  @prefix foaf: <http://xmlns.com/foaf/0.1/> .
  @prefix : <http://example.org#> .
  :a foaf:name "a" .
  :b foaf:name "b" .
`).forEach(t => {
  graph._store.addQuad(t)
})

const query = `
  PREFIX foaf: <http://xmlns.com/foaf/0.1/>
  SELECT ?s ?name
  WHERE {
    ?s foaf:name ?name .
  }`

// Creates a plan builder for the RDF dataset
const builder = new PlanBuilder(dataset)

// Get an iterator to evaluate the query
const iterator = builder.build(query);

// Read results
(iterator as PipelineStage<any>).subscribe((bindings : any) => {
  console.log('Find solutions:', bindings.toObject())
}, (err : any) => {
  console.error('error', err)
}, () => {
  console.log('Query evaluation complete!')
})