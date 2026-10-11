#!/usr/bin/env node
// MIT. Private browser controller for the maintained DuckDB merchant workflow.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDuckdbWorkbench } from './model.mjs';

const assets = new Map([['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']], ['/style.css', ['style.css', 'text/css; charset=utf-8']]]);
const fault = (code, status = 400) => Object.assign(new Error(code), { code, status });
async function requestBody(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw fault('JSON_REQUIRED', 415);
  const chunks = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 1048576) throw fault('REQUEST_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw fault('JSON_INVALID'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fault('JSON_OBJECT_REQUIRED');
  return value;
}
const explanations = {
  PRIVATE_WORKSPACE_REQUIRED: 'Choose a private directory with mode 0700.',
  DRAFT_REVISION_CHANGED: 'This draft was saved in another tab. Reload the saved draft before saving again.',
  CATALOG_SOURCE_CHANGED: 'The source data or declaration changed. Refresh metadata and review the selected query.',
  SOURCE_SCHEMA_CHANGED: 'The selected relation changed. Select its current columns again.',
  SOURCE_RELATION_RESELECT_REQUIRED: 'Load this relation from the current metadata catalog before continuing.',
  DATASET_CHANGED: 'The source changed during this operation. Finish writing the dataset, then refresh metadata.',
  FLEET_STATE_ALREADY_OWNED: 'Another workbench owns this directory. Reuse that process or close it first.',
  STOP_CURRENT_SELLER_FIRST: 'Stop the running package before starting another one.',
  EEXIST: 'That package name already exists. Choose a new name to retain both versions.',
  EACCES: 'The operator account cannot access the selected directory or file.',
  DUCKDB_NOT_INSTALLED: 'Choose a Python environment containing the supplied DuckDB dependency.',
  DUCKDB_QUERY_UNAVAILABLE: 'DuckDB could not run this query. Check the selected fields and filter value formats.',
  PACKAGE_NAME_INVALID: 'Use 1–64 letters, digits, hyphens or underscores for the package name.',
  ADD_A_QUERY_FIRST: 'Add at least one query to the merchant draft.',
  SELECT_1_TO_64_PUBLIC_COLUMNS: 'Select between one and 64 public columns.',
  SELECT_1_TO_4_SCALAR_ORDER_COLUMNS: 'Select one to four scalar columns for consistent result ordering.',
  INVALID_FILTER: 'Check each filter column, parameter name and comparison.',
  FILTER_TYPE_NOT_SUPPORTED: 'Choose a comparison supported by this column type.',
  QUERY_NAMES_MUST_BE_UNIQUE: 'Give every query a distinct name.',
};
function errorMessage(issue) {
  const code = issue.code ?? issue.message;
  if (explanations[code]) return explanations[code];
  if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,100}$/.test(code)) return code.replaceAll('_', ' ').toLowerCase();
  // Native merchant compiler messages contain operator-entered public fields,
  // not data rows. Render only as text; native worker errors remain constant codes.
  return issue instanceof TypeError || issue instanceof RangeError ? String(issue.message).slice(0,400) : 'The operation could not complete.';
}
export async function startDuckdbWorkbench({ port = 0, ...options } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw fault('PORT_INVALID');
  const model = await openDuckdbWorkbench(options);
  const token = randomBytes(32).toString('hex'), expected = Buffer.from('Bearer ' + token);
  const pending = new Set(), requests = new Set();
  let origin, closing;
  const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  };
  function reply(res, status, value, type = 'application/json; charset=utf-8', extra = {}) {
    res.writeHead(status, { ...headers, 'content-type': type, ...extra });
    res.end(type.startsWith('application/json') && !Buffer.isBuffer(value) ? JSON.stringify(value) : value);
  }
  const server = createServer((req, res) => {
    requests.add(req);
    const task = (async () => {
      if (closing) throw fault('WORKBENCH_CLOSED', 503);
      if (req.headers.host !== new URL(origin).host || req.headers.origin && req.headers.origin !== origin ||
          req.headers['sec-fetch-site'] === 'cross-site') throw fault('USE_WORKBENCH_ORIGIN', 403);
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && assets.has(url.pathname)) {
        const [file, type] = assets.get(url.pathname);
        return reply(res, 200, await readFile(new URL('./public/' + file, import.meta.url)), type);
      }
      const actual = Buffer.from(req.headers.authorization ?? '');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
        throw fault('OPEN_PRIVATE_LAUNCH_URL', 401);
      if (req.method === 'GET' && url.pathname === '/api/state') return reply(res, 200, await model.state());
      if (req.method === 'GET' && url.pathname === '/api/export') {
        const result = await model.exportedFile(url.searchParams.get('package'), url.searchParams.get('file'));
        return reply(res, 200, result.bytes, 'application/octet-stream',
          { 'content-disposition': 'attachment; filename="' + result.name.replaceAll('"', '') + '"' });
      }
      if (req.method !== 'POST') throw fault('ENDPOINT_NOT_FOUND', 404);
      const data = await requestBody(req);
      const controller = new AbortController(), cancel = () => { if (!res.writableEnded) controller.abort(); };
      res.once('close', cancel);
      try {
        let result;
        switch (url.pathname) {
          case '/api/catalog': result = await model.catalog({ cursor: data.cursor, signal: controller.signal }); break;
          case '/api/save': result = await model.save(data.draft, data.revision); break;
          case '/api/review': result = await model.review(data.draft); break;
          case '/api/preview': result = await model.preview(data.query, data.input, { signal: controller.signal }); break;
          case '/api/prepare': result = await model.prepare(data.name, data.revision); break;
          case '/api/package': result = await model.inspectPackage(data.name); break;
          case '/api/start': result = await model.start(data.name, { port: data.port, operationsPort: data.operationsPort }); break;
          case '/api/stop': result = await model.stop(); break;
          default: throw fault('ENDPOINT_NOT_FOUND', 404);
        }
        if (!res.destroyed) reply(res, 200, result);
      } finally { res.removeListener('close', cancel); }
    })().catch(issue => {
      if (!res.destroyed && !res.writableEnded) reply(res, Number.isInteger(issue.status) ? issue.status : 422,
        { error: issue.code ?? 'WORKBENCH_OPERATION_FAILED', message: errorMessage(issue) });
    });
    pending.add(task); task.finally(() => { pending.delete(task); requests.delete(req); });
  });
  server.requestTimeout = 90000; server.headersTimeout = 10000; server.keepAliveTimeout = 2000;
  try {
    await new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done); });
    origin = 'http://127.0.0.1:' + server.address().port;
  } catch (issue) { await model.close(); throw issue; }
  const close = () => closing ??= (async () => {
    const stopped = new Promise((done, fail) => server.close(issue => issue ? fail(issue) : done()));
    server.closeIdleConnections();
    // An unfinished JSON upload must not retain the workspace lease during
    // shutdown. Already admitted native commands drain normally.
    for (const req of requests) if (!req.complete) req.destroy();
    try { await Promise.all([...pending, stopped]); }
    finally { await model.close(); }
  })();
  return { origin, token, url: origin + '/#' + token, model, server, close };
}

const HELP = 'node duckdb/workbench/server.mjs --workspace PRIVATE_DIRECTORY\n' +
  '  [--source EXISTING_SOURCE.json | --data-dir DIRECTORY --database FILE.duckdb --parquet FILE.parquet ...]\n' +
  '  [--python /private/venv/bin/python] [--port 0]\n' +
  '  [--facilitator HTTPS_URL] [--allow-local-facilitator]\n' +
  'Reopen a saved workspace with --workspace and the same Python environment.';
export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { console.log(HELP); return; }
  const flags = new Map(), parquetFiles = [];
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--allow-local-facilitator') { flags.set(key, true); continue; }
    if (!['--workspace', '--source', '--data-dir', '--database', '--parquet', '--python', '--port', '--facilitator'].includes(key) ||
        !args[i + 1] || args[i + 1].startsWith('--') || key !== '--parquet' && flags.has(key)) throw fault(HELP);
    const value = args[++i];
    if (key === '--parquet') parquetFiles.push(value); else flags.set(key, value);
  }
  if (!flags.has('--workspace') || flags.has('--source') && (flags.has('--data-dir') || flags.has('--database') || parquetFiles.length) ||
      (flags.has('--database') || parquetFiles.length) && !flags.has('--data-dir') ||
      flags.has('--allow-local-facilitator') && !flags.has('--facilitator')) throw fault(HELP);
  let nativeFactory = null;
  if (flags.has('--facilitator')) {
    const url = new URL(flags.get('--facilitator'));
    const local = flags.has('--allow-local-facilitator') && url.protocol === 'http:' && url.hostname === '127.0.0.1';
    if (!local && url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
      throw fault('DUCKDB_FACILITATOR_URL_INVALID');
    const [{ HTTPFacilitatorClient }, { createNativeSellerServer }] = await Promise.all([
      import('@x402/core/server'), import('../../native-factory.mjs'),
    ]);
    nativeFactory = compiled => createNativeSellerServer(compiled,
      { facilitatorClient: new HTTPFacilitatorClient({ url: url.href.replace(/\/$/, '') }) });
  }
  const session = await startDuckdbWorkbench({ workspace: flags.get('--workspace'), sourceFile: flags.get('--source'),
    dataDirectory: flags.get('--data-dir'), database: flags.get('--database'), parquetFiles,
    python: flags.get('--python') ?? 'python3', port: Number(flags.get('--port') ?? 0), nativeFactory });
  console.log('DuckDB merchant workbench: ' + session.url);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => session.close().catch(issue => {
    console.error(errorMessage(issue)); process.exitCode = 1;
  }));
  return session;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(issue => { console.error(issue.message); process.exitCode = 1; });
