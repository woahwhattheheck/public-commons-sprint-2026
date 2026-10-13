// MIT. Portable working reviews and the complete original offline review editor.
import { inspectOperatingPlanReturn, compareOperatingPlanReturn,
  OPERATING_RETURN_PLAN_MAX_BYTES } from './operating-plan-return.mjs';

export const OPERATING_RETURN_WORKING_SCHEMA = 'stellar-forge.operating-plan-return-working.v1';
export const OPERATING_RETURN_WORKBOOK_SCHEMA = 'stellar-forge.operating-plan-return-workbook.v1';
export const OPERATING_RETURN_WORKING_MAX_BYTES = 192 * 1024 * 1024;
export const OPERATING_RETURN_WORKBOOK_MAX_BYTES = 256 * 1024 * 1024;
const WORKING_SCHEMA = OPERATING_RETURN_WORKING_SCHEMA;
const clone = value => JSON.parse(JSON.stringify(value));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const utf8Size = value => new TextEncoder().encode(value).byteLength;
function selectedWorking(value) {
  if (value?.schema !== WORKING_SCHEMA) return { review: inspectOperatingPlanReturn(value), buffers: {} };
  if (Object.keys(value).some(key => !['schema', 'review', 'details', 'buffers'].includes(key)))
    throw new TypeError('This working review contains unsupported fields.');
  const review = inspectOperatingPlanReturn(value.review), keys = new Set(compareOperatingPlanReturn(review).rows.map(row => row.key));
  if (!value.details || Object.keys(value.details).some(key => !['reviewer', 'notes'].includes(key)) ||
    typeof value.details.reviewer !== 'string' || value.details.reviewer.length > 1000 ||
    typeof value.details.notes !== 'string' || value.details.notes.length > 32000 ||
    !value.buffers || typeof value.buffers !== 'object' || Array.isArray(value.buffers))
    throw new TypeError('Keep the complete review details and pending choice editors.');
  for (const [key, buffer] of Object.entries(value.buffers)) {
    if (!keys.has(key) || !buffer || typeof buffer !== 'object' || Array.isArray(buffer) ||
      Object.keys(buffer).some(field => !['take', 'custom', 'note'].includes(field)) ||
      !['automatic', 'current', 'incoming', 'base', 'custom'].includes(buffer.take) ||
      typeof buffer.note !== 'string' || buffer.note.length > 32000 ||
      typeof buffer.custom !== 'string' || buffer.custom.length > OPERATING_RETURN_PLAN_MAX_BYTES)
      throw new TypeError('A pending choice does not belong to the retained source comparison.');
  }
  if (review.completion && (Object.keys(value.buffers).length || !same(value.details, { reviewer: review.reviewer, notes: review.notes })))
    throw new TypeError('A completed review must keep its recorded details and choices.');
  return { review, buffers: clone(value.buffers), details: clone(value.details) };
}

export function inspectOperatingReturnWorking(value) {
  if (utf8Size(JSON.stringify(value)) > OPERATING_RETURN_WORKING_MAX_BYTES)
    throw new TypeError('The complete working review exceeds 192 MiB.');
  const selected = selectedWorking(value);
  return { schema: WORKING_SCHEMA, review: selected.review,
    details: selected.details ?? { reviewer: selected.review.reviewer, notes: selected.review.notes },
    buffers: selected.buffers };
}
export const OPERATING_RETURN_WORKBOOK_ASSETS = Object.freeze([
  { key: 'catalog', route: '/operating-return-core/catalog.mjs', file: 'catalog.mjs' },
  { key: 'plan', route: '/operating-return-core/operating-plan.mjs', file: 'operating-plan.mjs' },
  { key: 'review', route: '/operating-return-core/operating-plan-return.mjs', file: 'operating-plan-return.mjs' },
  { key: 'workbook', route: '/operating-return-core/operating-plan-return-workbook.mjs', file: 'operating-plan-return-workbook.mjs' },
  { key: 'editor', route: '/operating-plan-return.mjs', file: 'public/operating-plan-return.mjs' },
  { key: 'html', route: '/operating-plan-return.html', file: 'public/operating-plan-return.html' },
  { key: 'css', route: '/operating-plan-return.css', file: 'public/operating-plan-return.css' },
  { key: 'guide', route: '/operating-plan-returns.md', file: 'OPERATING_PLAN_RETURNS.md' },
].map(row => Object.freeze(row)));
const sourceKeys = OPERATING_RETURN_WORKBOOK_ASSETS.map(row => row.key);
function checkedSources(sources) {
  if (!sources || typeof sources !== 'object' || Array.isArray(sources) ||
    Object.keys(sources).length !== sourceKeys.length ||
    !sourceKeys.every(key => typeof sources[key] === 'string' && sources[key].length > 0 &&
      utf8Size(sources[key]) <= 4 * 1024 * 1024))
    throw new TypeError('Keep the complete eight original workbook application sources.');
  return Object.fromEntries(sourceKeys.map(key => [key, sources[key]]));
}
const scriptJSON = value => JSON.stringify(value).replace(/</g, '\\u003c')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
function replaceOnce(body, before, after) {
  if (body.split(before).length !== 2) throw new TypeError('The original workbook page source changed: ' + before);
  return body.replace(before, () => after);
}
// This function is serialized into the exported document. All dependencies are carried in that document.
function launchWorkbook() {
  const status = document.getElementById('return-status'), failure = document.getElementById('return-error');
  try {
    const packet = JSON.parse(document.getElementById('operating-return-workbook').textContent);
    const sources = packet.sources, urls = {}, held = [];
    const module = (key, dependencies) => {
      let source = sources[key];
      for (const [specifier, target] of Object.entries(dependencies)) {
        const pattern = new RegExp("(from\\s+)(['\\\"])" + specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "\\2", 'g');
        let replaced = 0;
        source = source.replace(pattern, (_all, prefix, quote) => {
          replaced++; return prefix + quote + urls[target] + quote;
        });
        if (replaced !== 1) throw new Error('The complete original ' + key + ' module requires its ' + specifier + ' dependency.');
      }
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      held.push(url); urls[key] = url;
    };
    module('catalog', {});
    module('plan', { './catalog.mjs': 'catalog' });
    module('review', { './operating-plan.mjs': 'plan' });
    module('workbook', { './operating-plan-return.mjs': 'review' });
    module('editor', {
      '/operating-return-core/operating-plan.mjs': 'plan',
      '/operating-return-core/operating-plan-return.mjs': 'review',
      '/operating-return-core/operating-plan-return-workbook.mjs': 'workbook',
    });
    const style = document.createElement('style'); style.textContent = sources.css; document.head.append(style);
    document.getElementById('offline-guide-text').textContent = sources.guide;
    Object.defineProperty(globalThis, '__operatingReturnWorkbook', { value: packet, writable: false });
    import(urls.editor).catch(error => {
      failure.hidden = false; failure.textContent = error.message;
      status.textContent = 'The workbook could not open. The complete embedded review remains available below.';
    });
    window.addEventListener('pagehide', event => { if (!event.persisted) held.forEach(url => URL.revokeObjectURL(url)); }, { once: true });
    document.getElementById('recover-embedded-working').addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(packet.working, null, 2) + '\n'], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = packet.working.review.id + '-embedded-working.json';
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    });
  } catch (error) { failure.hidden = false; failure.textContent = error.message; status.textContent = 'The embedded workbook could not be opened.'; }
}
/** Package trusted maintained application source with a complete review or working-review document. */
export function renderOperatingReturnWorkbook(value, sources, { id = globalThis.crypto.randomUUID() } = {}) {
  const working = inspectOperatingReturnWorking(value), selected = checkedSources(sources);
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id))
    throw new TypeError('Use a stable workbook identity of at most 128 letters, digits, underscores or hyphens.');
  const packet = { schema: OPERATING_RETURN_WORKBOOK_SCHEMA, id, working, sources: selected };
  let html = selected.html;
  html = replaceOnce(html, '<meta charset="utf-8">', '<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' blob:; style-src \'unsafe-inline\'; img-src data: blob:; connect-src \'none\'; base-uri \'none\'; form-action \'none\'">');
  html = replaceOnce(html, '<link rel="stylesheet" href="/operating-plan-return.css">', '');
  html = replaceOnce(html, '<script type="module" src="/operating-plan-return.mjs"></script>', '');
  const nav = html.match(/<nav aria-label="Workspace">[\s\S]*?<\/nav>/);
  if (!nav) throw new TypeError('Keep the original review page navigation.');
  html = replaceOnce(html, nav[0], '<nav aria-label="Workbook"><a href="#offline-instructions">Workbook help</a><a href="#offline-guide">Complete procedure guide</a></nav>');
  html = replaceOnce(html, '<main>', '<main>\n<section id="offline-instructions" class="panel"><h2>Offline review workbook</h2><p>This file contains the complete review editor, both original histories and their attached files. Changes are saved in this browser when storage is available. Use <strong>Download editable workbook</strong> to keep the latest working copy as a new HTML file; this opened file is never overwritten.</p><p>Complete the review and return <strong>Complete editable review JSON</strong> to the original operator. They receive it against their current saved procedure. Working review JSON also keeps unfinished choice text and notes.</p><button type="button" id="recover-embedded-working">Download the original embedded working review</button></section>');
  html = replaceOnce(html, '</main>', '<details id="offline-guide" class="panel"><summary>Complete included procedure guide</summary><pre id="offline-guide-text" class="text"></pre></details>\n</main>');
  html = replaceOnce(html, '</body>', '<script type="application/json" id="operating-return-workbook">' +
    scriptJSON(packet) + '</script>\n<script>(' + launchWorkbook.toString() + ')();</script>\n</body>');
  if (utf8Size(html) > OPERATING_RETURN_WORKBOOK_MAX_BYTES)
    throw new TypeError('The complete offline workbook exceeds 256 MiB. Keep the original Working review JSON.');
  return html;
}
