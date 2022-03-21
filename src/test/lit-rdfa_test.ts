import { html } from 'lit-html';
import {rdfa, toHtml} from '../lit-rdfa'
import { RDFaToSparqlParser } from '../rdfa-sparql';

suite('lit-rdfa', () => {
  let container: HTMLDivElement;

  setup(() => {
    container = document.createElement('div');
  });

  test('Basic', () => {
    const template = rdfa`<div prefix="dc: http://purl.org/dc/elements/1.1/">
        ${rdfa`<p>This photo was taken by <span class=${"author"} about="photo1.jpg" property="dc:creator" content="?creator"></span>.</p>`}
    </div>`
    const templateHtml = toHtml(template)
    const el = document.createElement("template")
    el.innerHTML = templateHtml[0] as unknown as string

    const p = new RDFaToSparqlParser(el.content.firstElementChild || document.createElement("div"), 'http://example.org/')
    const quads = p.resultQuads
    
    console.log(templateHtml[0])

    const result = html`<p a=${1} ?b=${true}>${1}</p>`
    console.log(toHtml(result))
   });
});