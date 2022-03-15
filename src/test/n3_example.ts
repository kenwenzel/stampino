import n3 from 'n3'
import { N3Graph } from './utils.js'
import { HashMapDataset, PlanBuilder, PipelineStage } from 'sparql-engine'

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