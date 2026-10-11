// MIT. Local operator boundary, matching the original seller release console.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { inspectRelease } from '../../../sf82-seller-pilot/releases.mjs';
import { openWorkspace } from './model.mjs';

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const BODY_LIMIT = 48 * 1024 * 1024;
const failure = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
const safeFilename = name => name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200);
async function body(req) {
  if ((req.headers['content-type'] ?? '').split(';')[0].trim() !== 'application/json') throw failure('JSON_REQUIRED', 'Send a JSON object body.', 415);
  const length = Number(req.headers['content-length']);
  if (Number.isFinite(length) && length > BODY_LIMIT) throw failure('REQUEST_LIMIT', 'The source change request exceeds 48 MiB.', 413);
  const chunks = []; let total = 0;
  for await (const chunk of req) { total += chunk.length; if (total > BODY_LIMIT) throw failure('REQUEST_LIMIT', 'The source change request exceeds 48 MiB.', 413); chunks.push(chunk); }
  let input;
  try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw failure('INVALID_JSON', 'The request body is not valid JSON.'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw failure('INVALID_INPUT', 'Send a JSON object.');
  return input;
}
function parameters(target, names, required = names) {
  for (const key of target.searchParams.keys()) if (!names.includes(key) || target.searchParams.getAll(key).length !== 1) throw failure('INVALID_PARAMETER', 'Unknown or repeated URL parameter: ' + key);
  for (const key of required) if (!target.searchParams.get(key)) throw failure('PARAMETER_REQUIRED', 'Supply the ' + key + ' URL parameter.');
  return Object.fromEntries(names.map(key => [key, target.searchParams.get(key)]));
}
function fields(input, allowed) {
  const unknown = Object.keys(input).filter(key => !allowed.includes(key));
  if (unknown.length) throw failure('INVALID_FIELD', 'Unknown action field: ' + unknown.join(', '));
}

export async function startPythonWorkspace(root, { port = 8431 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Workspace port must be 0–65535.');
  const workspace = typeof root === 'string' ? await openWorkspace(root) : root;
  if (!workspace?.state || !workspace?.close) throw new TypeError('Supply a saved Python workspace directory or its opened model.');
  const token = randomBytes(32).toString('hex'), tokenBytes = Buffer.from(token);
  const assets = new Map();
  try {
    for (const [path, file, type] of [
      ['/', 'index.html', 'text/html; charset=utf-8'],
      ['/browser.mjs', 'browser.mjs', 'text/javascript; charset=utf-8'],
      ['/local-draft-store.mjs', 'local-draft-store.mjs', 'text/javascript; charset=utf-8'],
      ['/release-panel.mjs', 'release-panel.mjs', 'text/javascript; charset=utf-8'],
      ['/style.css', 'style.css', 'text/css; charset=utf-8'],
    ]) assets.set(path, { bytes: await readFile(new URL('./' + file, import.meta.url)), type });
  } catch (error) { await workspace.close(); throw error; }
  let hosts = new Set(), origins = new Set(), url, busy = false, stopping = false, lastError = null;
  let actionDone = Promise.resolve(), resolveClosed, rejectClosed;
  const closed = new Promise((done, fail) => { resolveClosed = done; rejectClosed = fail; }); closed.catch(() => {});
  const status = async () => ({ ...await workspace.state(), operator: { busy, stopping, lastError } });
  const mutations = new Map([
    ['/api/revisions', [['expectedHead', 'baseRevision', 'note', 'entry', 'declarationText', 'files', 'remove'], input => workspace.save(input)]],
    ['/api/restore', [['expectedHead', 'revisionId', 'note'], input => workspace.restore(input)]],
    ['/api/refresh-source', [['expectedHead', 'note'], input => workspace.refreshSource(input)]],
    ['/api/preview', [['revisionId', 'function', 'input', 'operationId'], input => workspace.preview(input)]],
    ['/api/preview/cancel', [['id'], input => workspace.cancelPreview(input)]],
    ['/api/stage', [['revisionId', 'id', 'label', 'runtime'], input => workspace.stage(input)]],
    ['/api/activate', [['id', 'expectedGeneration', 'reason'], input => workspace.activate(input)]],
    ['/api/rollback', [['to', 'expectedGeneration', 'reason'], input => workspace.rollback(input)]],
    ['/api/run', [['expectedGeneration'], input => workspace.run(input)]],
    ['/api/stop', [['instanceId'], input => workspace.stop(input)]],
    ['/api/restart', [['instanceId', 'expectedGeneration'], input => workspace.restart(input)]],
    ['/api/customer-export', [['id', 'instanceId'], input => workspace.exportCustomer(input)]],
  ]);
  const server = createServer(async (req, res) => {
    const reply = (code, contentType, bytes, extra = {}) => {
      if (res.destroyed) return;
      bytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      res.writeHead(code, { 'content-type': contentType, 'content-length': String(bytes.length), 'cache-control': 'no-store',
        'x-content-type-options': 'nosniff', 'content-security-policy': CSP, 'referrer-policy': 'no-referrer',
        'cross-origin-resource-policy': 'same-origin', ...extra });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    };
    const send = (code, value) => reply(code, 'application/json; charset=utf-8', JSON.stringify(value));
    const download = (record, filename) => reply(200,
      typeof record.contentType === 'string' && !/[\r\n]/.test(record.contentType) ? record.contentType : 'application/octet-stream', record.bytes,
      { 'content-disposition': 'attachment; filename="' + safeFilename(filename) + '"', 'x-content-sha256': record.sha256 });
    try {
      if (!hosts.has(req.headers.host) || req.headers.origin && !origins.has(req.headers.origin) ||
          ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) throw failure('OPERATOR_ORIGIN_REQUIRED', 'Use the local workspace origin printed by the serve command.', 403);
      if (!req.url?.startsWith('/') || req.url.startsWith('//')) throw failure('INVALID_TARGET', 'Invalid request target.');
      const target = new URL(req.url, url);
      if (target.hash) throw failure('INVALID_TARGET', 'URL fragments are not API parameters.');
      if (['GET', 'HEAD'].includes(req.method) && assets.has(target.pathname) && !target.search) {
        const asset = assets.get(target.pathname); reply(200, asset.type, asset.bytes); return;
      }
      const supplied = Buffer.from(typeof req.headers['x-python-workspace-token'] === 'string' ? req.headers['x-python-workspace-token'] : '');
      if (supplied.length !== tokenBytes.length || !timingSafeEqual(supplied, tokenBytes)) throw failure('WORKSPACE_TOKEN_REQUIRED', 'Reopen the operator URL printed by the current workspace serve command.', 401);
      if (stopping) throw failure('WORKSPACE_CLOSING', 'The workspace is closing its owned preview and seller processes.', 409);
      if (req.method === 'GET') {
        switch (target.pathname) {
          case '/api/state': parameters(target, []); send(200, await status()); return;
          case '/api/revision': { const { id } = parameters(target, ['id']); send(200, workspace.revision(id)); return; }
          case '/api/file': { const { revision, path } = parameters(target, ['revision', 'path']); send(200, await workspace.file(revision, path)); return; }
          case '/api/preview': { const { id } = parameters(target, ['id']); send(200, await workspace.previewDetail(id)); return; }
          case '/api/preview-output': {
            const { id } = parameters(target, ['id']), output = await workspace.previewOutput(id);
            const suffix = output.contentType?.includes('json') ? '.json' : output.contentType?.includes('csv') ? '.csv' : output.contentType?.startsWith('text/') ? '.txt' : '.bin';
            download(output, id + suffix); return;
          }
          case '/api/release': { const { id } = parameters(target, ['id']); send(200, await inspectRelease(workspace.releaseRoot, id)); return; }
          case '/api/diff': { const { from, to } = parameters(target, ['from', 'to'], ['to']); send(200, await workspace.diff(from || null, to)); return; }
          case '/api/customer-file': { const { id, file } = parameters(target, ['id', 'file']); download(await workspace.customerFile(id, file), file); return; }
          case '/api/export': { parameters(target, []); const result = await workspace.exportBundle(); download({ ...result, contentType: 'application/json' }, result.filename); return; }
          default: throw failure('NOT_FOUND', 'Unknown workspace route.', 404);
        }
      }
      if (req.method !== 'POST' || !mutations.has(target.pathname) || target.search) throw failure('NOT_FOUND', 'Unknown workspace action.', 404);
      if (!req.headers.origin || !origins.has(req.headers.origin)) throw failure('OPERATOR_ORIGIN_REQUIRED', 'Workspace changes require the current local operator origin.', 403);
      if (busy) throw failure('WORKSPACE_BUSY', 'Another workspace action is running. Refresh its saved outcome when it completes.', 409);
      const input = await body(req), [allowed, action] = mutations.get(target.pathname); fields(input, allowed);
      if (busy || stopping) throw failure('WORKSPACE_BUSY', 'Another workspace action started while this request was arriving. Refresh and retry.', 409);
      busy = true; lastError = null; let finishAction;
      actionDone = new Promise(done => { finishAction = done; });
      try {
        const result = await action(input); busy = false;
        send(target.pathname === '/api/preview' && ['QUEUED', 'RUNNING'].includes(result.status) ? 202 : 200, result);
      } catch (error) { lastError = { code: error.code ?? 'WORKSPACE_ERROR', message: error.message, action: target.pathname, at: new Date().toISOString() }; throw error; }
      finally { busy = false; finishAction(); }
    } catch (error) {
      const conflict = ['RELEASE_BUSY', 'RELEASE_CONFLICT', 'SQLITE_BUSY', 'ERR_SQLITE_BUSY'].includes(error.code);
      const status = error.status ?? (conflict ? 409 : error.code === 'ENOENT' ? 404 : 400);
      send(status, { error: error.code ?? 'WORKSPACE_ERROR', message: error.message,
        ...(Number.isSafeInteger(error.generation) ? { generation: error.generation } : {}),
        action: req.url?.split('?')[0] ?? null, busy, retryable: status === 409 && conflict });
    }
  });
  server.requestTimeout = 150000; server.headersTimeout = 10000; server.keepAliveTimeout = 2000;
  try { await new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done); }); }
  catch (error) { await workspace.close(); throw error; }
  const assigned = server.address().port;
  hosts = new Set(['127.0.0.1:' + assigned, 'localhost:' + assigned]); origins = new Set([...hosts].map(host => 'http://' + host));
  url = 'http://127.0.0.1:' + assigned;
  let closing;
  const close = () => {
    if (closing) return closing; stopping = true;
    closing = (async () => {
      let failure;
      await actionDone;
      try { await workspace.close(); } catch (error) { failure = error; }
      try { await new Promise((done, fail) => { server.close(error => error ? fail(error) : done()); server.closeIdleConnections?.(); }); }
      catch (error) { failure ??= error; }
      if (failure) { rejectClosed(failure); throw failure; }
      resolveClosed();
    })();
    return closing;
  };
  return { server, workspace, url, token, operatorUrl: url + '/#' + token, close, closed };
}

export const startWorkspaceServer = startPythonWorkspace;
export const startPythonWorkspaceConsole = startPythonWorkspace;
