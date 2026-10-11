// MIT. Offline industrial review; source text is inert, external network is disabled.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inspectCapture } from './project.mjs';
import { createFile } from '../postgres/publisher/files.mjs';
const hash = content => createHash('sha256').update(content).digest('base64');
export async function writeReview(directory, out) {
  const inspection = await inspectCapture(directory);
  const script = await readFile(new URL('./review.js', import.meta.url), 'utf8');
  const style = await readFile(new URL('./review.css', import.meta.url), 'utf8');
  const data = JSON.stringify(inspection).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${hash(script)}'; style-src 'sha256-${hash(style)}'; connect-src 'none'; img-src 'none'; base-uri 'none'; form-action 'none'">
<title>Starforge · Geospatial source review</title><style>${style}</style>
<header><span>STARFORGE / DATASET MERCHANT</span><h1>Geospatial source review</h1><p id="source-title"></p></header>
<main><section aria-labelledby="source-heading"><h2 id="source-heading">01 / Captured source</h2><dl id="source"></dl><p id="coverage"></p><details><summary>Original source identity and geometry</summary><pre id="identity"></pre></details></section>
<section aria-labelledby="columns-heading"><h2 id="columns-heading">02 / Choose published fields</h2><p>Select the source properties to expose. String preserves exact identifiers and decimal text. Number uses the native IEEE-754 numeric type; JSON preserves structured geometry and original numeric tokens.</p>
<div class="controls"><label>Dataset name<input id="name" maxlength="128"></label><label>Rows per page<input id="defaultLimit" type="number" min="1" max="1000" value="50"></label><label>Maximum page<input id="maxLimit" type="number" min="1" max="1000" value="250"></label><label>Cell character limit<input id="maxCellChars" type="number" min="1" max="1048576" value="65536"></label><label>Find property<input id="filter" type="search" placeholder="Name or JSON pointer"></label></div>
<div class="table-scroll" tabindex="0" aria-label="Source field mapping; scroll horizontally"><table><thead><tr><th>Use</th><th>Source property / observations</th><th>Published column</th><th>Native type</th><th>Format</th><th>Nullable</th><th>Filter</th><th>Range</th><th>Sort</th></tr></thead><tbody id="fields"></tbody></table></div>
<p id="selection" role="status"></p><label class="agreement"><input id="null-policy" type="checkbox">I reviewed the native nullable CSV rule: an empty string, a missing value and null become null in a nullable column. Use a non-nullable string to retain empty text when the source is always present.</label>
<label>Operator notes<textarea id="notes" rows="3" maxlength="8000" placeholder="Intended use, licensed source and field decisions"></textarea></label>
<div class="controls"><button id="save">Save reviewed plan</button><label class="file">Reopen plan<input id="import" type="file" accept="application/json,.json"></label><button id="clear">Clear selection</button></div><p id="status" role="status" aria-live="polite"></p></section>
<section aria-labelledby="sample-heading"><h2 id="sample-heading">03 / Inspect original features</h2><p>These are the first retained source records, before projection. Exact numbers remain text in this view. No source is fetched when this file opens.</p><div class="controls"><button id="previous">Earlier</button><span id="sample-index"></span><button id="next">Later</button></div><pre id="sample"></pre></section>
<section><h2>04 / Build and open the existing merchant</h2><p>Export the saved plan with the source CLI, then open its dataset in the original query workspace. The export contains all captured rows, the reviewed plan and every original source page.</p><pre>node ogc/cli.mjs export --state /private/capture --plan /private/reviewed-plan.json --out /private/dataset-edition
node dataset-workspace.mjs --dataset /private/dataset-edition/dataset.json</pre><p>For seller configuration, add <code>--payment /private/public-terms.json --origin https://your-api.example</code> to export. The existing SF30 service, facilitator and customer tools remain the payment and delivery path.</p></section></main>
<footer>Local source review · Original capture retained · Explicit publication choices</footer><script id="inspection" type="application/json">${data}</script><script>${script}</script></html>`;
  await createFile(out, Buffer.from(html));
  return { file: out, sourceId: inspection.sourceId, rows: inspection.rows, properties: inspection.properties.length };
}
