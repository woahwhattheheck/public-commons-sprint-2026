// SPDX-License-Identifier: MIT
// The public reader and installed Atlas use the same retained source and selection format.
export const GRANT_CATALOG_SOURCE = Object.freeze({
  page: './grant-data/catalog-source-vellar-20261012.json',
  pageSha256: '7d088b72500e47da56170296de80aad2321bc5f707d8e074755d9059f4e4eebf',
  bytes: 45753,
  rows: 27,
  capturedAt: '2026-10-12T21:44:51.728Z',
  sourceUrl: 'https://vellar-facilitator-testnet-production.up.railway.app/discovery/resources?network=stellar%3Atestnet&limit=100&offset=0'
});
const JS = 'text/javascript; charset=utf-8';
export const GRANT_CATALOG_ASSETS = Object.freeze([
  ['/grant-catalog.mjs', '../grant-catalog.mjs', JS],
  ['/grant-catalog-browser.mjs', 'grant-catalog-browser.mjs', JS],
  ['/grant-catalog.css', 'grant-catalog.css', 'text/css; charset=utf-8'],
  ['/grant-catalog-guide.md', '../GRANT_CATALOG.md', 'text/markdown; charset=utf-8'],
  ['/grant-data/catalog-source-vellar-20261012.json', 'grant-data/catalog-source-vellar-20261012.json', 'application/json; charset=utf-8'],
  ['/stellar/scf-starforge-20261009/sf61-bazaar-explorer/catalog-review.mjs', '../../../stellar/scf-starforge-20261009/sf61-bazaar-explorer/catalog-review.mjs', JS],
  ['/stellar/scf-starforge-20261009/sf61-bazaar-explorer/capture-search.mjs', '../../../stellar/scf-starforge-20261009/sf61-bazaar-explorer/capture-search.mjs', JS],
  ['/scf46-stellar-bazaar/src/entry-identity.mjs', '../../../scf46-stellar-bazaar/src/entry-identity.mjs', JS],
  ['/scf46-stellar-bazaar/src/query-index.mjs', '../../../scf46-stellar-bazaar/src/query-index.mjs', JS],
  ['/scf46-stellar-bazaar/src/ranking.mjs', '../../../scf46-stellar-bazaar/src/ranking.mjs', JS],
  ['/stellar-forge/route-identity/identity.mjs', '../../../stellar-forge/route-identity/identity.mjs', JS]
]);
const START = '<!-- grant-catalog-review:start -->', END = '<!-- grant-catalog-review:end -->';
const STYLE = '<link rel="stylesheet" href="./grant-catalog.css">';
const SCRIPT = '<script type="module" src="./grant-catalog-browser.mjs"></script>';
function need(value, message) { if (!value) throw new TypeError(message); }

/** Static opening. Untrusted catalog text is rendered only by the browser's text nodes. */
export function catalogReviewPanel() {
  return START + '\n' + "<section class=\"grant-entry-operate grant-catalog\" id=\"review-catalog\" aria-labelledby=\"grant-catalog-title\">\n<header><p class=\"eyebrow\">CATALOG TO REQUEST</p><h3 id=\"grant-catalog-title\">Find a resource and carry its exact selection into Atlas.</h3>\n<p>Search the complete catalog page retained on October 12, 2026: 27 advertised resources, with their original input schemas and payment alternatives. Inspect a useful operation, then save its complete source and selected terms for the installed request editor.</p></header>\n<div class=\"grant-entry-actions\"><button type=\"button\" class=\"button\" id=\"grant-catalog-load\">Load the retained catalog</button><button type=\"button\" class=\"button\" id=\"grant-catalog-load-cancel\" hidden>Cancel loading</button><a href=\"./grant-catalog-guide.md\">Catalog review and receiving guide</a></div>\n<p class=\"grant-entry-status\" id=\"grant-catalog-source-status\" role=\"status\" aria-live=\"polite\">The retained page opens from this application. Its full source digest is checked before search.</p>\n<details><summary>Original source and coverage</summary><dl class=\"grant-entry-facts\" id=\"grant-catalog-source-facts\"><div><dt>Captured</dt><dd>October 12, 2026 at 21:44:51.728 UTC</dd></div><div><dt>Source</dt><dd>Vellar testnet discovery, limit 100 and offset 0</dd></div><div><dt>Bytes</dt><dd>45,753 original UTF-8 bytes</dd></div><div><dt>SHA-256</dt><dd><code>7d088b72500e47da56170296de80aad2321bc5f707d8e074755d9059f4e4eebf</code></dd></div></dl></details>\n<div id=\"grant-catalog-desk\" hidden>\n<form id=\"grant-catalog-search\" autocomplete=\"off\"><fieldset id=\"grant-catalog-search-fields\" disabled><legend>Find an operation</legend>\n<label>Search descriptions and declared inputs<input name=\"query\" type=\"search\" maxlength=\"1024\" placeholder=\"Try topic, mode, original or address\"></label>\n<p class=\"grant-entry-help\">Input names come from the published schema. An empty query lists the original source rows in their saved order.</p>\n<div class=\"grant-catalog-filters\">\n<label>Resource type<select name=\"type\"><option value=\"\">All types</option></select></label>\n<label>Network<select name=\"network\"><option value=\"\">All networks</option></select></label>\n<label>Asset<select name=\"asset\"><option value=\"\">All assets</option></select></label>\n<label>Recipient<select name=\"payTo\"><option value=\"\">All recipients</option></select></label>\n<label>Payment scheme<select name=\"scheme\"><option value=\"\">All schemes</option></select></label>\n<label>Extension<select name=\"extensions\"><option value=\"\">All extensions</option></select></label>\n<label>Rows per page<select name=\"pageSize\"><option value=\"5\">5</option><option value=\"10\" selected>10</option><option value=\"25\">25</option></select></label>\n</div><div class=\"grant-entry-actions\"><button type=\"submit\" class=\"button\">Apply search</button><button type=\"button\" class=\"button\" id=\"grant-catalog-reset\">Show the original page</button></div></fieldset></form>\n<p class=\"grant-entry-status\" id=\"grant-catalog-search-status\" role=\"status\" aria-live=\"polite\"></p>\n<ol class=\"grant-catalog-results\" id=\"grant-catalog-results\" aria-label=\"Catalog resources\"></ol>\n<div class=\"grant-entry-actions\"><button type=\"button\" class=\"button\" id=\"grant-catalog-previous\" disabled>Previous page</button><span id=\"grant-catalog-page\"></span><button type=\"button\" class=\"button\" id=\"grant-catalog-next\" disabled>Next page</button></div>\n<section id=\"grant-catalog-selection\" class=\"grant-catalog-selection\" aria-labelledby=\"grant-catalog-selection-title\"><h4 id=\"grant-catalog-selection-title\">Inspect and save a resource</h4><p>Choose Inspect on a result to read its full original declaration and payment alternatives.</p></section>\n</div>\n<section class=\"grant-entry-journey\" aria-labelledby=\"grant-catalog-receive-title\"><h4 id=\"grant-catalog-receive-title\">Continue in the installed Atlas workspace</h4>\n<ol class=\"grant-entry-steps\"><li><strong>Save the complete selection.</strong> The downloaded JSON contains the complete original page, its SHA-256, your search and the exact original row and payment alternative.</li>\n<li><strong>Receive in Atlas.</strong> In Applications, open the existing Atlas workspace. Expand <strong>Receive a catalog review</strong>, choose the file, inspect its terms, then choose <strong>Receive and open this request</strong>. Atlas retains the source and opens its original request editor.</li>\n<li><strong>Prepare the request.</strong> Enter the explicit path, query, method or body required by the original service. Atlas's existing preparation and handoff retain that concrete request and selected payment terms. The configured buyer supplies its own authority and approval.</li>\n<li><strong>Reopen and hand over.</strong> The saved request keeps the original review download. A complete Atlas export carries the capture, review and request through its existing transfer and receiving workflow.</li></ol>\n<p>Local source review and request preparation keep their own saved state. The operated testnet purchase in the film above remains available in the Grant purchase reviewer.</p>\n<p><a href=\"./grant-catalog-guide.md\">Open the CLI, typed API and complete receiving instructions</a></p></section>\n<noscript><p>The complete retained source can be downloaded from <a href=\"./grant-data/catalog-source-vellar-20261012.json\">the original catalog page</a>. The installed Atlas CLI can receive and search that original page using the catalog review guide.</p></noscript>\n</section>" + '\n' + END;
}

/** Add only the catalog opening; preserve all other existing reviewer sections. */
export function attachGrantCatalogReview(source) {
  need(typeof source === 'string', 'Use the complete original grant HTML.');
  let html = source;
  const start = html.indexOf(START), end = html.indexOf(END);
  need((start < 0) === (end < 0), 'Retain the complete catalog review opening.');
  if (start >= 0) {
    need(end > start && html.indexOf(START, start + START.length) < 0 &&
      html.indexOf(END, end + END.length) < 0, 'Keep one catalog review opening.');
    let after = end + END.length; if (html[after] === '\n') after++;
    html = html.slice(0, start) + html.slice(after);
  }
  const anchor = '<section class="grant-entry-operate" id="review-operate"';
  const at = html.indexOf(anchor);
  need(at >= 0 && html.indexOf(anchor, at + 1) < 0 &&
    html.lastIndexOf('<!-- grant-reviewer-entry:start -->', at) >= 0 &&
    html.indexOf('<!-- grant-reviewer-entry:end -->', at) > at,
  'Keep the existing grant reviewer and its original purchase opening.');
  html = html.slice(0, at) + catalogReviewPanel() + '\n' + html.slice(at);
  const jump = '<a href="#review-catalog">Search the catalog</a>';
  const before = '<a href="#review-operate">Operate the reviewer</a>';
  if (!html.includes(jump)) {
    need(html.includes(before), 'Keep the original reviewer navigation.');
    html = html.replace(before, jump + before);
  }
  for (const [asset, anchor] of [[STYLE, '</head>'], [SCRIPT, '</body>']]) if (!html.includes(asset)) {
    need(html.includes(anchor), 'Keep the complete grant document.');
    html = html.replace(anchor, asset + '\n' + anchor);
  }
  return html;
}
