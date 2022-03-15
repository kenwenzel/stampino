import { Quad, Store } from 'n3'
import { Graph } from 'sparql-engine'

// Format a triple pattern according to N3 API:
// SPARQL variables must be replaced by `null` values
function formatTriplePattern (triple : any) : Quad {
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
  return new Quad(subject, predicate, object)
}

export class N3Graph extends Graph {
    _store : Store

  constructor () {
    super()
    this._store = new Store()
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
    const quads = this._store.getQuads(subject, predicate, object, null).map((quad: Quad) => {
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