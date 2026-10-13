// MIT. Attach the complete companion reader to the original application composition.
export const COMPANION_ROUTES = [
  ['/grant-companion-editions.mjs',['grant-companion-editions.mjs','text/javascript; charset=utf-8']],
  ['/grant-companion-reading.mjs',['grant-companion-reading.mjs','text/javascript; charset=utf-8']],
  ['/grant-companion-returns.mjs',['grant-companion-returns.mjs','text/javascript; charset=utf-8']],
  ['/grant-companion.html',['grant-companion.html','text/html; charset=utf-8']],
  ['/grant-companion.css',['grant-companion.css','text/css; charset=utf-8']],
  ['/grant-companion-core.mjs',['grant-companion-core.mjs','text/javascript; charset=utf-8']],
  ['/grant-companion-workspace.mjs',['grant-companion-workspace.mjs','text/javascript; charset=utf-8']],
];

/** Current navigation follows this application's companion; historical citations retain their source URLs. */
export function currentGrantCompanionLinks(markdown) {
  const labels = new Set([
    'detailed customer and commercial plan',
    'architecture and ecosystem comparison',
    'detailed product and finance companion',
    'product and finance companion',
    'product and financing companion',
  ]);
  return String(markdown).replace(
    /\[([^\]\r\n]+)\]\(https:\/\/github\.com\/woahwhattheheck\/tjlabs-stellar-merchant-workspace\/blob\/(?:main|[a-f0-9]{40})\/stellar-forge\/developer-site\/dist\/grant-data\/product-and-finance\.md(#[^\s)]*)?\)/g,
    (original, label, fragment = '') => labels.has(label.trim().toLowerCase().replace(/\s+/g, ' ')) ?
      '[' + label + '](./product-and-finance.md' + fragment + ')' : original
  );
}

/** Preserve the four original reader outputs and their existing source selections. */
export function attachGrantCompanion({templateHtml,sourceIndex}) {
  if(typeof templateHtml!=='string'||!templateHtml.includes('<nav aria-label="Primary">'))throw new Error('Retain the complete original application navigation.');
  if(sourceIndex?.schema!=='stellar-forge.grant-reviewer-source-index.v1'||!/^[a-f0-9]{64}$/.test(sourceIndex.product_and_finance?.sha256||''))throw new Error('Retain the original complete product and finance source selection.');
  const link='<a data-grant-companion="v1" href="./grant-companion.html">Product and financing</a>';
  let html=templateHtml.replace(/<a data-grant-companion="v1"[^>]*>[\s\S]*?<\/a>/g,'');
  html=html.replace('<nav aria-label="Primary">','<nav aria-label="Primary">'+link);
  html=html.replace(/<a\b([^>]*\bhref=")\.\/grant-data\/product-and-finance\.md(#[^"]*)?"([^>]*)>/g,
    (original, before, fragment = '', after) => /\bdownload(?:\s|=|$)/.test(before + after) ? original :
      '<a' + before + './grant-companion.html' + fragment + '"' + after + '>');
  return {
    templateHtml:html,
    sourceIndex:{...sourceIndex,companion_reader:{
      schema:'stellar-forge.grant-companion-reader.v1',
      route:'/grant-companion.html',
      source:'/grant-data/product-and-finance.md',
      source_index:'/grant-data/source-index.json',
      source_sha256:sourceIndex.product_and_finance.sha256,
      source_bytes:sourceIndex.product_and_finance.bytes,
      assets:COMPANION_ROUTES.map(([path])=>path),
      behavior:'Complete original companion, retained source editions, chapter comparison and reading notes, reviewed collaborator returns, full workspace downloads, printing and a self-contained offline workspace.',
    }},
  };
}
