#!/usr/bin/env node
// MIT. Complete Linkup customer stages over the original native Node Buyer.
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Buyer } from '../index.mjs';
import { readBytes } from '../store.mjs';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (value, code) => { if (!value) throw Object.assign(new Error(code), { code }); };
const hash = value => createHash('sha256').update(value).digest('hex');
const views = Object.freeze({
  search: { operation: 'linkup-search', path: '/research/linkup/search', outputType: 'searchResults' },
  answer: { operation: 'linkup-answer', path: '/research/linkup/answer', outputType: 'sourcedAnswer' },
});
const help = [
  'Original Linkup merchant customer',
  '',
  'prepare --runtime SF88_DIR --state PRIVATE_APP --client TRUSTED_SELLER_CLIENT.mjs',
  '  --profile OPERATOR_PROFILE.json | --workspace EXISTING_OPERATOR',
  '  --request-file QUERY_AND_FILTERS.json --view search|answer --intent STABLE_ID',
  '  --max-atomic CAP --accept INDEX [--request-timeout-ms 90000]',
  'review|inspect --runtime SF88_DIR --state PRIVATE_APP --intent STABLE_ID',
  'execute|recover --runtime SF88_DIR --state PRIVATE_APP --intent STABLE_ID',
  '  [--out NEW_REPORT.json] [--raw NEW_RESPONSE.json] [--html NEW_REPORT.html]',
  '',
  'prepare saves one immutable request; review opens that same request.',
  'execute enters original terminal approval and attempts that intent once.',
  'recover opens the retained attempt and original response without purchasing.',
  'The selected merchant fixes standard depth and searchResults or sourcedAnswer.',
  'Linkup credentials belong to the merchant. The customer supplies query/filters.',
].join('\n');

/** Interpret the exact parsed provider object without rewriting fields or citations. */
export function parseLinkupPayload(payload, { view } = {}) {
  need(Object.hasOwn(views, view), 'LINKUP_VIEW_REQUIRED');
  need(plain(payload), 'LINKUP_RESPONSE_OBJECT_REQUIRED');
  const text = (value, fields) => plain(value) && fields.every(field => typeof value[field] === 'string') &&
    (value.favicon === undefined || typeof value.favicon === 'string');
  if (view === 'search') {
    need(Array.isArray(payload.results) && payload.results.every(value =>
      text(value, ['name', 'url', 'content']) && value.type === 'text'), 'LINKUP_SEARCH_RESULTS_INVALID');
  } else {
    need(typeof payload.answer === 'string' && Array.isArray(payload.sources) &&
      payload.sources.every(value => text(value, ['name', 'url', 'snippet'])), 'LINKUP_SOURCED_ANSWER_INVALID');
  }
  // Keep source order, inline citation text, snippets, favicon and unknown fields.
  // Citation numbers are provider output; this reader never renumbers or invents them.
  return { view, outputType: views[view].outputType, payload };
}

/** Complete native saved bytes are checked by BuyerResult before JSON is exposed. */
export async function readLinkupResponse(result, { view, signal } = {}) {
  need(result.native.httpStatus === 200 && result.delivery.status === 'SAVED', 'LINKUP_RESPONSE_NOT_SAVED');
  return parseLinkupPayload(await result.json({ limit: 1048576, signal }), { view });
}

const escape = value => String(value ?? '').replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
function sourceLink(source) {
  let valid = false;
  try { const url = new URL(source.url); valid = ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; } catch {}
  return valid ? '<a href="' + escape(source.url) + '" rel="noreferrer noopener">' + escape(source.name) + '</a>' :
    '<span>' + escape(source.name) + '</span>';
}

/** A private portable reading view of the SAME saved result. No remote assets. */
export function renderLinkupReport(report) {
  const result = report.search, payload = result?.payload;
  const sources = result?.view === 'answer' ? payload.sources : payload?.results ?? [];
  const capture = report.native.responseFile ?? {};
  const rows = sources.map((source, index) => '<article class="source"><div class="source-head"><span class="index">' +
    (index + 1) + '</span><h2>' + sourceLink(source) + '</h2></div><p class="url">' + escape(source.url) +
    '</p><p class="excerpt">' + escape(source.snippet ?? source.content) + '</p></article>').join('\n');
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">' +
    '<title>Linkup saved research</title><style>' +
    '*{box-sizing:border-box}body{margin:0;background:#f5f5f4;color:#202020;font:15px/1.55 system-ui,sans-serif}' +
    'main{max-width:1060px;margin:0 auto;padding:30px 24px}header{border-bottom:2px solid #353535;padding-bottom:20px;margin-bottom:24px}' +
    'h1{font-size:25px;margin:0 0 8px}h2{font-size:16px;margin:0}p{margin:8px 0}.muted,.url{color:#555}' +
    '.facts{display:grid;grid-template-columns:160px minmax(0,1fr);gap:5px 16px;margin:16px 0}.facts dt{font-weight:600}.facts dd{margin:0;overflow-wrap:anywhere}' +
    '.answer,.source,details{background:#fff;border:1px solid #c8c8c6;padding:18px;margin:14px 0}.answer,.excerpt{white-space:pre-wrap;overflow-wrap:anywhere}' +
    '.source-head{display:flex;gap:12px;align-items:baseline}.index{font:13px ui-monospace,monospace;min-width:20px;color:#666}' +
    'a{color:#242424;text-decoration-thickness:1px;text-underline-offset:3px}.url{font:12px/1.5 ui-monospace,monospace;overflow-wrap:anywhere}' +
    'label{display:block;font-weight:600;margin:20px 0 5px}input{width:100%;padding:11px;border:1px solid #888;background:#fff;font:inherit}' +
    'pre{font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:420px;overflow:auto}' +
    'summary{cursor:pointer;font-weight:600}[hidden]{display:none!important}@media(max-width:580px){main{padding:18px 14px}.facts{grid-template-columns:1fr;gap:1px}.facts dd{margin-bottom:8px}.source,.answer{padding:13px}}' +
    '</style></head><body><main><header><p class="muted">Saved research</p><h1>' +
    (result?.view === 'answer' ? 'Linkup sourced answer' : 'Linkup search results') +
    '</h1><p>Read the original purchased response and its retained sources.</p></header><dl class="facts">' +
    '<dt>Original intent</dt><dd>' + escape(report.intentId) + '</dd><dt>Merchant route</dt><dd>' +
    escape(report.selection.url) + '</dd><dt>Native execution</dt><dd>' + escape(report.native.status) +
    '</dd><dt>Response capture</dt><dd>' + escape(capture.status ?? 'NOT_REQUESTED') +
    '</dd><dt>Saved bytes</dt><dd>' + escape(capture.bytes ?? '') + '</dd><dt>SHA-256</dt><dd>' +
    escape(capture.sha256 ?? '') + '</dd></dl>' +
    (result?.view === 'answer' ? '<section aria-label="Original answer" class="answer">' + escape(payload.answer) + '</section>' : '') +
    '<label for="filter">Filter retained sources</label><input id="filter" type="search" autocomplete="off" placeholder="Title, URL or excerpt">' +
    '<p id="count" class="muted">' + sources.length + ' sources</p><section aria-label="Retained sources">' + rows +
    '</section><details><summary>Original native result and payment observation</summary><pre>' +
    escape(JSON.stringify(report.native, null, 2)) + '</pre></details>' +
    '<p class="muted">This reading view uses the retained response. Its JSON report preserves every original provider field.</p>' +
    '</main><script>const input=document.getElementById("filter");const rows=[...document.querySelectorAll(".source")];' +
    'input.addEventListener("input",()=>{const query=input.value.toLocaleLowerCase();let count=0;for(const row of rows){row.hidden=!row.textContent.toLocaleLowerCase().includes(query);if(!row.hidden)count++;}document.getElementById("count").textContent=count+" of "+rows.length+" sources";});</script></body></html>\n';
}

function argumentsFor(mode, args) {
  const allowed = new Set(['runtime', 'state', 'intent', ...(mode === 'prepare'
    ? ['profile', 'workspace', 'client', 'request-file', 'view', 'max-atomic', 'accept', 'request-timeout-ms']
    : ['execute', 'recover'].includes(mode) ? ['out', 'raw', 'html'] : [])]);
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const token = args[index], key = token?.slice(2), value = args[index + 1];
    need(token?.startsWith('--') && allowed.has(key) && !Object.hasOwn(values, key) &&
      typeof value === 'string' && value.length > 0 && !value.startsWith('--'), 'LINKUP_ARGUMENTS_INVALID');
    values[key] = value;
  }
  const required = name => { need(values[name], 'LINKUP_REQUIRED_' + name.toUpperCase().replaceAll('-', '_')); return values[name]; };
  const integer = (name, fallback, min, max) => {
    const value = values[name] ?? String(fallback);
    need(/^(0|[1-9][0-9]*)$/.test(value) && Number.isSafeInteger(Number(value)) &&
      Number(value) >= min && Number(value) <= max, 'LINKUP_INTEGER_ARGUMENT_INVALID');
    return Number(value);
  };
  return { values, required, integer };
}

async function selection(operation, expectedHash) {
  // The native operation already bound this configuration during review/recovery.
  // Bind this additional view to those SAME exact bytes before choosing a parser.
  const raw = await readBytes(operation.configPath, 65536);
  need(raw.length <= 65536 && hash(raw) === expectedHash, 'LINKUP_ORIGINAL_CONFIGURATION_CHANGED');
  const config = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  const request = config.operation;
  need(request?.method === 'POST' && typeof request.url === 'string', 'LINKUP_ORIGINAL_ROUTE_REQUIRED');
  const url = new URL(request.url);
  const entry = Object.entries(views).find(([, item]) => item.path === url.pathname);
  need(entry && url.search === '' && request.expect?.paymentFlow === 'authorization', 'LINKUP_ORIGINAL_ROUTE_MISMATCH');
  return { view: entry[0], outputType: entry[1].outputType, method: request.method, url: request.url, expect: request.expect };
}

export async function main([mode, ...args] = process.argv.slice(2)) {
  if (!mode || mode === '--help') { console.log(help); return; }
  need(['prepare', 'review', 'inspect', 'execute', 'recover'].includes(mode), 'LINKUP_MODE_INVALID');
  const { values, required, integer } = argumentsFor(mode, args);
  if (mode === 'prepare') need(Boolean(values.profile) !== Boolean(values.workspace), 'LINKUP_SELECT_PROFILE_OR_WORKSPACE');
  const buyer = new Buyer({
    runtimeDirectory: resolve(required('runtime')), stateDirectory: resolve(required('state')),
    ...(mode === 'prepare' && values.profile ? { operatorProfile: resolve(values.profile) } : {}),
  });
  const intentId = required('intent');
  const controller = new AbortController(), stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    if (mode === 'prepare') {
      const view = required('view');
      need(Object.hasOwn(views, view), 'LINKUP_VIEW_REQUIRED');
      const raw = await readBytes(resolve(required('request-file')), 65536);
      need(raw.length > 0 && raw.length <= 65536, 'LINKUP_INPUT_BYTE_LIMIT');
      const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
      need(plain(body) && typeof body.query === 'string' && body.query.trim() &&
        Buffer.byteLength(body.query, 'utf8') <= 8000, 'LINKUP_QUERY_REQUIRED');
      const client = await import(pathToFileURL(resolve(required('client'))).href);
      need(typeof client.createSellerClient === 'function', 'ORIGINAL_SELLER_CLIENT_REQUIRED');
      const api = client.createSellerClient({ buyer });
      const request = api.request(views[view].operation, { body }, {
        intentId, maxAtomic: required('max-atomic'), acceptIndex: integer('accept', required('accept'), 0, 15),
        paymentFlow: 'authorization', signal: controller.signal,
      });
      need(request.method === 'POST' && new URL(request.url).pathname === views[view].path &&
        new URL(request.url).search === '', 'LINKUP_MERCHANT_OPERATION_MISMATCH');
      const options = { requestTimeoutMs: integer('request-timeout-ms', 90000, 1, 300000),
        responseFile: { maxBytes: 1048576, timeoutMs: 70000, expectedContentType: 'application/json' } };
      let operation;
      if (values.workspace) {
        const { body: requestBody, signal: requestSignal, ...fields } = request;
        operation = await buyer.fromWorkspace(resolve(values.workspace), {
          ...options, configuration: { operation: fields }, body: requestBody, signal: requestSignal,
        });
      } else operation = await buyer.fromRequest(request, options);
      const review = await operation.review();
      console.log(JSON.stringify({ intentId, selection: await selection(operation, review.configSha256), review }, null, 2));
      return;
    }
    const operation = buyer.operation(intentId);
    if (mode === 'inspect') { console.log(JSON.stringify(await operation.inspect(), null, 2)); return; }
    if (mode === 'review') {
      const review = await operation.review();
      console.log(JSON.stringify({ intentId, selection: await selection(operation, review.configSha256), review }, null, 2));
      return;
    }
    const result = mode === 'execute'
      ? await operation.execute({ review: await operation.review(), signal: controller.signal })
      : await operation.recover();
    if (result === null) {
      console.log(JSON.stringify({ intentId, status: 'ORIGINAL_RESULT_NOT_RECORDED', operation: await operation.inspect() }, null, 2));
      process.exitCode = 2; return;
    }
    const chosen = await selection(operation, result.record.configSha256);
    const report = { intentId, selection: chosen, native: result.native,
      process: { exitCode: result.record.exitCode, exitSignal: result.record.exitSignal,
        runtimeError: result.record.runtimeError, recovered: result.record.recovered } };
    if (result.native.httpStatus === 200 && result.delivery.status === 'SAVED')
      report.search = await readLinkupResponse(result, { view: chosen.view, signal: controller.signal });
    if (values.raw) await result.saveAs(resolve(values.raw), { signal: controller.signal });
    if (values.out) await writeFile(resolve(values.out), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    if (values.html) await writeFile(resolve(values.html), renderLinkupReport(report), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify(report, null, 2));
    if (!result.ok || result.delivery.status !== 'SAVED') process.exitCode = 2;
    return report;
  } finally {
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { console.error(JSON.stringify({ error: error?.code ?? 'LINKUP_CUSTOMER_OPERATION_FAILED' })); process.exitCode = 1; });
