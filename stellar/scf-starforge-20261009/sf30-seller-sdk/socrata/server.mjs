// MIT. Local Socrata operator transport over the original workspace.
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {readFile, stat} from 'node:fs/promises';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {resolve, join} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {openSocrataWorkspace} from './workspace.mjs';

const actions = new Set([
  'source.configure', 'source.inspect', 'source.search',
  'capture.start', 'capture.advance', 'capture.pause', 'capture.resume', 'capture.import',
  'mapping.save', 'edition.build', 'edition.activate', 'dataset.query',
  'merchant.configure', 'package.export', 'package.import',
  'publisher.status',
  'publisher.prepare',
  'publisher.preview',
  'publisher.reviewDraft',
  'publisher.publish',
  'publisher.activateSnapshot',
  'publisher.collect',
  'publisher.release.stage',
  'publisher.release.inspect',
  'publisher.release.activate',
  'publisher.release.rollback',
  'publisher.release.start',
  'publisher.release.stop',
  'publisher.buyer.review',
  'publisher.buyer.prepare',
  'publisher.buyer.session',
  'publisher.buyer.run',
  'publisher.buyer.recover',
  'publisher.buyer.account',
  'publisher.buyer.export'
]);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const policy = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const commonHeaders = {
  'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer', 'content-security-policy': policy,
  'cross-origin-resource-policy': 'same-origin'
};

async function readJson(request) {
  if ((request.headers['content-type'] ?? '').split(';', 1)[0].trim() !== 'application/json')
    throw Object.assign(new Error('Send JSON with Content-Type application/json.'), {status: 415, code: 'JSON_REQUIRED'});
  const chunks = []; let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 524288)
      throw Object.assign(new Error('The request exceeds 512 KiB.'), {status: 413, code: 'REQUEST_TOO_LARGE'});
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks))); }
  catch { throw Object.assign(new Error('The request body is not valid UTF-8 JSON.'), {status: 400, code: 'INVALID_JSON'}); }
}

function requireModel(value, name, methods) {
  if (!object(value) || methods.some(method => typeof value[method] !== 'function'))
    throw new TypeError(name + ' must expose ' + methods.join(', ') + '.');
}

/** Compose original models once. Supplied models are borrowed; only owned models close. */
export async function openSocrataOperator({directory, workspace: suppliedWorkspace,
  publisher: suppliedPublisher, appToken = process.env.SOCRATA_APP_TOKEN, ...backendOptions} = {}) {
  if (typeof directory !== 'string' || !directory.trim()) throw new TypeError('A workspace directory is required.');
  if (suppliedWorkspace !== undefined)
    requireModel(suppliedWorkspace, 'workspace', ['state', 'act', 'readExport', 'close']);
  if (suppliedPublisher !== undefined)
    requireModel(suppliedPublisher, 'publisher', ['state', 'act', 'readExport', 'close']);
  const base = suppliedWorkspace ?? await openSocrataWorkspace({...backendOptions, directory: resolve(directory), appToken});
  const ownsWorkspace = suppliedWorkspace === undefined, ownsPublisher = suppliedPublisher === undefined;
  let publisher = suppliedPublisher, openingPublisher, closing;
  const pending = new Set();
  const run = operation => {
    if (closing) return Promise.reject(Object.assign(new Error('The operator is closing.'), {code: 'OPERATOR_CLOSING', status: 409}));
    const job = Promise.resolve().then(operation);
    pending.add(job); job.then(() => pending.delete(job), () => pending.delete(job));
    return job;
  };
  const getPublisher = async () => {
    if (publisher) return publisher;
    if (!openingPublisher) openingPublisher = import('./publisher.mjs')
      .then(({openSocrataPublisher}) => openSocrataPublisher({directory: join(resolve(directory), 'publisher')}))
      .then(value => { publisher = value; return value; })
      .catch(error => { openingPublisher = undefined; throw error; });
    return openingPublisher;
  };
  const view = async () => ({...await base.state(), publisher: publisher ? await publisher.state() : null});
  return {
    state: () => run(view),
    act: (action, payload = {}) => run(async () => {
      if (!actions.has(action) || !object(payload))
        throw Object.assign(new TypeError('Choose a supported operator action and an object payload.'), {code: 'INVALID_ACTION'});
      if (action.startsWith('publisher.')) {
        const model = await getPublisher(), response = await model.act(action, payload);
        return {...response, state: {...await base.state(), publisher: response.state ?? await model.state()}};
      }
      const response = await base.act(action, payload);
      return {...response, state: {...response.state, publisher: publisher ? await publisher.state() : null}};
    }),
    readExport: (exportId, filename) => run(() => base.readExport(exportId, filename)),
    readPublisherExport: (kind, id) => run(async () => {
      if (!['draft-csv', 'draft-review', 'buyer-config', 'session-manifest', 'session-csv', 'session-jsonl', 'session-review'].includes(kind))
        throw Object.assign(new TypeError('Choose an original publisher export kind.'), {code: 'INVALID_DOWNLOAD'});
      return (await getPublisher()).readExport(kind, id);
    }),
    close() {
      if (!closing) closing = (async () => {
        await Promise.allSettled([...pending]);
        let originalError;
        if (publisher && ownsPublisher) try { await publisher.close(); } catch (error) { originalError = error; }
        if (ownsWorkspace) try { await base.close(); } catch (error) { if (!originalError) originalError = error; }
        if (originalError) throw originalError;
      })();
      return closing;
    }
  };
}

/** One local listener over an owned or borrowed original operator. */
export async function startSocrataWorkspace({directory, port = 0, operator: suppliedOperator,
  workspace: suppliedWorkspace, publisher: suppliedPublisher,
  appToken = process.env.SOCRATA_APP_TOKEN, ...backendOptions} = {}) {
  if (typeof directory !== 'string' || !directory.trim()) throw new TypeError('A workspace directory is required.');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Port must be between 0 and 65535.');
  if (suppliedOperator !== undefined) {
    requireModel(suppliedOperator, 'operator', ['state', 'act', 'readExport', 'readPublisherExport', 'close']);
    if (suppliedWorkspace !== undefined || suppliedPublisher !== undefined)
      throw new TypeError('Supply either an operator or its original models.');
  }
  const ownsOperator = suppliedOperator === undefined;
  const workspace = suppliedOperator ?? await openSocrataOperator({...backendOptions, directory: resolve(directory), appToken,
    workspace: suppliedWorkspace, publisher: suppliedPublisher});
  let assets;
  try {
    assets = await Promise.all(['index.html', 'app.mjs', 'style.css', 'publisher.mjs'].map(name => readFile(new URL('./public/' + name, import.meta.url))));
  } catch (error) {
    try { if (ownsOperator) await workspace.close(); } catch {}
    throw error;
  }
  const token = randomBytes(32).toString('base64url');
  const expected = Buffer.from('Bearer ' + token);
  let origin, closing;
  const server = createServer({maxHeaderSize: 16384, requestTimeout: 30000, headersTimeout: 15000,
    keepAliveTimeout: 1000}, async (request, response) => {
    const reply = (status, value, contentType = 'application/json; charset=utf-8') => {
      if (response.destroyed) return;
      response.writeHead(status, {...commonHeaders, 'content-type': contentType});
      response.end(contentType.startsWith('application/json') ? JSON.stringify(value) : value);
    };
    try {
      if (request.headers.host !== new URL(origin).host ||
          (request.headers.origin && request.headers.origin !== origin) ||
          request.headers['sec-fetch-site'] === 'cross-site')
        return reply(403, {error: 'LOCAL_ORIGIN_REQUIRED', message: 'Open this workspace on its printed local session URL.'});
      if (request.method === 'GET') {
        if (request.url === '/') return reply(200, assets[0], 'text/html; charset=utf-8');
        if (request.url === '/app.mjs') return reply(200, assets[1], 'text/javascript; charset=utf-8');
        if (request.url === '/style.css') return reply(200, assets[2], 'text/css; charset=utf-8');
        if (request.url === '/publisher.mjs') return reply(200, assets[3], 'text/javascript; charset=utf-8');
        if (request.url === '/favicon.ico') return reply(204, '');
      }
      const supplied = Buffer.from(request.headers.authorization ?? '');
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
        return reply(401, {error: 'SESSION_REQUIRED', message: 'Reopen the session URL printed by the workspace command.'});
      if (request.method === 'GET' && request.url === '/api/state')
        return reply(200, await workspace.state());
      const publisherDownload = /^\/api\/publisher\/exports\/([^/?]+)\/([^/?]+)$/.exec(request.url ?? '');
      if (request.method === 'GET' && publisherDownload) {
        let kind, id;
        try { kind = decodeURIComponent(publisherDownload[1]); id = decodeURIComponent(publisherDownload[2]); }
        catch { return reply(400, {error: 'INVALID_DOWNLOAD', message: 'Invalid publisher file identifier.'}); }
        const file = await workspace.readPublisherExport(kind, id);
        if (!Buffer.isBuffer(file.bytes) || typeof file.filename !== 'string')
          throw new TypeError('The publisher export returned an invalid file.');
        response.writeHead(200, {...commonHeaders,
          'content-type': file.contentType || 'application/octet-stream',
          'content-length': file.bytes.length,
          'content-disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(file.filename).replaceAll("'", '%27')
        });
        response.end(file.bytes); return;
      }
      const download = /^\/api\/exports\/([^/?]+)\/([^/?]+)$/.exec(request.url ?? '');
      if (request.method === 'GET' && download) {
        let exportId, filename;
        try { exportId = decodeURIComponent(download[1]); filename = decodeURIComponent(download[2]); }
        catch { return reply(400, {error: 'INVALID_DOWNLOAD', message: 'Invalid export file identifier.'}); }
        const file = await workspace.readExport(exportId, filename);
        const info = await stat(file.path);
        if (!info.isFile()) return reply(404, {error: 'EXPORT_FILE_UNAVAILABLE'});
        response.writeHead(200, {...commonHeaders,
          'content-type': file.contentType || 'application/octet-stream',
          'content-length': info.size,
          'content-disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(filename).replaceAll("'", '%27')
        });
        await pipeline(createReadStream(file.path), response);
        return;
      }
      if (request.url !== '/api/action') return reply(404, {error: 'NOT_FOUND'});
      if (request.method !== 'POST') return reply(405, {error: 'POST_REQUIRED'});
      const input = await readJson(request);
      if (!object(input) || !actions.has(input.action) || !object(input.payload ?? {}) ||
          Object.keys(input).some(key => !['action', 'payload'].includes(key)))
        return reply(400, {error: 'INVALID_ACTION', message: 'Choose a supported workspace action and an object payload.'});
      // Do not abort or replay an accepted mutation when the browser disconnects.
      const result = await workspace.act(input.action, input.payload ?? {});
      return reply(200, result);
    } catch (error) {
      if (response.headersSent || response.destroyed) {
        if (!response.writableEnded) response.end();
        return;
      }
      const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ?
        error.status : error instanceof TypeError || error instanceof SyntaxError ? 400 : 500;
      return reply(status, {error: typeof error.code === 'string' ? error.code : 'WORKSPACE_REQUEST_FAILED',
        message: error.message || 'The workspace could not complete this request.'});
    }
  });
  server.maxRequestsPerSocket = 100;
  server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
  try {
    await new Promise((yes, no) => {
      server.once('error', no);
      server.listen(port, '127.0.0.1', () => { server.off('error', no); yes(); });
    });
    origin = 'http://127.0.0.1:' + server.address().port;
  } catch (error) {
    try { if (ownsOperator) await workspace.close(); } catch {}
    throw error;
  }
  return {origin, url: origin + '/#' + token, token,
    close() {
      if (!closing) closing = (async () => {
        let serverError;
        try {
          await new Promise((yes, no) => {
            server.close(error => error ? no(error) : yes());
            server.closeIdleConnections?.();
          });
        } catch (error) { serverError = error; }
        try { if (ownsOperator) await workspace.close(); } catch (error) { if (!serverError) throw error; }
        if (serverError) throw serverError;
      })();
      return closing;
    }
  };
}
