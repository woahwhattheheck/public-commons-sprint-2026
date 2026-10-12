// MIT. One loopback HTTP owner for the original Datasette workspace and browser operator.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { openDatasetteWorkspace, datasetteJsonReplacer } from './workspace.mjs';
import { readBrowserAssets } from '../../distribution/browser-assets.mjs';

const MAX_BODY = 1024 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message, status = 400) => Object.assign(new Error(message), {code, status});
const decimal = value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value);

function oneHeader(request, name) {
  const values = request.headersDistinct?.[name];
  if (values?.length > 1) throw fail('DATASETTE_HTTP_HEADER_INVALID', 'Send one ' + name + ' header.');
  return request.headers[name];
}
function readQuery(url, names) {
  const input = {};
  for (const [name, value] of url.searchParams) {
    if (!names.includes(name) || Object.hasOwn(input, name))
      throw fail('DATASETTE_HTTP_QUERY_INVALID', 'Use the declared query fields once.');
    input[name] = value;
  }
  return input;
}
function requireMethod(request, response, methods) {
  if (!methods.includes(request.method)) {
    response.setHeader('Allow', methods.join(', '));
    throw fail('DATASETTE_HTTP_METHOD_INVALID', 'Use ' + methods.join(' or ') + ' for this route.', 405);
  }
}
async function readJsonBody(request) {
  const encoding = oneHeader(request, 'content-encoding');
  if (encoding !== undefined && encoding !== 'identity')
    throw fail('DATASETTE_HTTP_ENCODING_INVALID', 'Send uncompressed JSON.', 415);
  const type = oneHeader(request, 'content-type');
  if (typeof type !== 'string' || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(type))
    throw fail('DATASETTE_HTTP_CONTENT_TYPE_INVALID', 'Send application/json encoded as UTF-8.', 415);
  const advertised = oneHeader(request, 'content-length');
  if (advertised !== undefined && (!decimal(advertised) || Number(advertised) > MAX_BODY))
    throw fail('DATASETTE_INPUT_TOO_LARGE', 'Operation input must fit in 1 MiB.', 413);
  const chunks = [];
  let length = 0;
  for await (const part of request) {
    length += part.length;
    if (length > MAX_BODY) throw fail('DATASETTE_INPUT_TOO_LARGE', 'Operation input must fit in 1 MiB.', 413);
    chunks.push(part);
  }
  let text, value;
  try {
    text = new TextDecoder('utf-8', {fatal:true}).decode(Buffer.concat(chunks, length));
    value = JSON.parse(text);
  } catch {
    throw fail('DATASETTE_INPUT_INVALID', 'Send one complete UTF-8 JSON operation.');
  }
  if (!object(value) || Object.keys(value).some(key => !['operation', 'input'].includes(key)) ||
      typeof value.operation !== 'string' || !object(value.input))
    throw fail('DATASETTE_INPUT_INVALID', 'Send an operation name and its input object.');
  return value;
}
function json(response, status, value, head = false) {
  const body = Buffer.from(JSON.stringify(value, datasetteJsonReplacer) + '\n');
  response.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Content-Length':body.length});
  response.end(head ? undefined : body);
}
function identityFor(input) {
  return input?.requestId ?? input?.operationId ?? input?.runId ?? input?.uploadId ?? input?.id ?? null;
}
function errorResult(error, context) {
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status
    : error?.code === 'ENOENT' ? 404 : error?.code === 'EACCES' ? 403 : 500;
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,128}$/.test(error.code)
    ? error.code : 'DATASETTE_SERVER_FAILURE';
  return {status, value:{
    error:code,
    message:typeof error?.message === 'string' ? error.message : 'The selected Datasette request did not complete.',
    ...(context.operation ? {operation:context.operation, operationId:identityFor(context.input)} : {}),
    ...(context.started ? {uncertain:error?.uncertain === true || status >= 500} : {}),
    ...(typeof error?.directory === 'string' ? {directory:error.directory} : {}),
    ...(object(error?.details) ? {details:error.details} : {}),
    ...(typeof error?.requestId === 'string' ? {requestId:error.requestId} : {}),
    ...(typeof error?.requestHash === 'string' ? {requestHash:error.requestHash} : {}),
    ...(typeof error?.requestState === 'string' ? {requestState:error.requestState} : {}),
  }};
}
function attachment(name) {
  const ascii = name.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 160) || 'datasette-file';
  const encoded = encodeURIComponent(name).replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase());
  return 'attachment; filename="' + ascii + '"; filename*=UTF-8' + "''" + encoded;
}

/**
 * A supplied workspace remains owned by its caller. Otherwise this server opens
 * and closes exactly one native workspace. HTTP disconnection never replays or
 * silently cancels an admitted source, publication or receiving operation.
 */
export async function startDatasetteServer({
  workspace, directory, create = false, port = 0, host = '127.0.0.1',
  browserAssets = new URL('./browser-assets.json', import.meta.url),
} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535 ||
      !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host))
    throw fail('DATASETTE_SERVER_ADDRESS_INVALID', 'Choose a loopback host and an available port from 0 to 65535.');
  host = host === 'localhost' ? '127.0.0.1' : host === '[::1]' ? '::1' : host;
  const ownsWorkspace = workspace === undefined;
  if (ownsWorkspace) workspace = await openDatasetteWorkspace({directory, create});
  else if (!workspace || typeof workspace.workspaceId !== 'string' ||
      typeof workspace.directory !== 'string' || typeof workspace.status !== 'function' ||
      typeof workspace.operations !== 'function' || typeof workspace.dispatch !== 'function' ||
      directory !== undefined && directory !== workspace.directory)
    throw fail('DATASETTE_SERVER_WORKSPACE_INVALID', 'Supply the original open Datasette workspace.');
  const instanceId = randomUUID();
  let url, permittedOrigins, assets, stopping = false, closing;
  const requests = new Set();
  const server = createServer({maxHeaderSize:16384}, (request, response) => {
    const pending = handle(request, response);
    requests.add(pending);
    void pending.then(() => requests.delete(pending), error => {
      requests.delete(pending); response.destroy(error);
    });
  });
  server.requestTimeout = 0;
  server.headersTimeout = 30000;
  server.keepAliveTimeout = 5000;
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    else socket.destroy();
  });

  async function download(request, response, selected) {
    const meta = await workspace.dispatch('files.inspect', selected);
    // Read and verify every byte through the same retained-file authority.
    // Each chunk retains the original SHA and descriptor/path identity.
    response.writeHead(200, {
      'Content-Type':'application/octet-stream',
      'Content-Length':meta.bytes,
      'Content-Disposition':attachment(meta.name),
      'ETag':'"' + meta.sha256 + '"',
      'X-Datasette-SHA256':meta.sha256,
    });
    if (request.method === 'HEAD') {response.end(); return;}
    let offset = '0';
    while (true) {
      if (response.destroyed) return;
      const part = await workspace.dispatch('files.read', {
        path:meta.path, sha256:meta.sha256, offset, limit:262144,
      });
      if (part.offset !== offset || part.sha256 !== meta.sha256 || part.bytes !== meta.bytes ||
          part.encoding !== 'base64' || !decimal(part.length))
        throw fail('DATASETTE_DOWNLOAD_CHANGED', 'Reopen the original retained file before continuing.', 409);
      const buffer = Buffer.from(part.data, 'base64');
      if (String(buffer.length) !== part.length)
        throw fail('DATASETTE_DOWNLOAD_INVALID', 'The retained file returned an incomplete byte range.', 500);
      if (buffer.length) await new Promise((done, reject) =>
        response.write(buffer, error => error ? reject(error) : done()));
      if (part.complete) {
        if (BigInt(offset) + BigInt(part.length) !== BigInt(meta.bytes))
          throw fail('DATASETTE_DOWNLOAD_INVALID', 'The retained file ended before its original length.', 500);
        break;
      }
      if (!decimal(part.nextOffset) || BigInt(part.nextOffset) !== BigInt(offset) + BigInt(part.length) ||
          BigInt(part.nextOffset) <= BigInt(offset))
        throw fail('DATASETTE_DOWNLOAD_INVALID', 'The retained byte cursor did not advance.', 500);
      offset = part.nextOffset;
    }
    response.end();
  }
  async function handle(request, response) {
    const context = {};
    try {
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'");
      if (stopping) throw fail('DATASETTE_SERVER_CLOSING', 'Reopen this original workspace after shutdown completes.', 503);
      const authority = oneHeader(request, 'host');
      if (typeof authority !== 'string' || !permittedOrigins.has('http://' + authority))
        throw fail('DATASETTE_HTTP_HOST_INVALID', 'Use the loopback origin printed by this workspace.', 403);
      const origin = oneHeader(request, 'origin');
      if (origin !== undefined && !permittedOrigins.has(origin))
        throw fail('DATASETTE_HTTP_ORIGIN_INVALID', 'Open this operator on its original loopback origin.', 403);
      if (typeof request.url !== 'string' || request.url.length > 16384 ||
          !request.url.startsWith('/') || request.url.startsWith('//') ||
          /[\\#\u0000-\u0020\u007f]/.test(request.url))
        throw fail('DATASETTE_HTTP_URL_INVALID', 'Use a declared local workspace route.');
      const target = new URL(request.url, url);
      if (target.pathname === '/api/health') {
        requireMethod(request, response, ['GET', 'HEAD']); readQuery(target, []);
        json(response, 200, {schema:'stellar-forge.datasette-workspace-health.v1',
          workspaceId:workspace.workspaceId, instanceId, directory:workspace.directory,
          url, pid:process.pid}, request.method === 'HEAD');
        return;
      }
      if (target.pathname.startsWith('/api/')) {
        if (oneHeader(request, 'x-datasette-workspace-id') !== workspace.workspaceId)
          throw fail('DATASETTE_WORKSPACE_CHANGED', 'Use the original workspace identity returned by health.', 409);
        if (target.pathname === '/api/status') {
          requireMethod(request, response, ['GET', 'HEAD']); readQuery(target, []);
          json(response, 200, await workspace.status(), request.method === 'HEAD'); return;
        }
        if (target.pathname === '/api/operations') {
          requireMethod(request, response, ['GET', 'HEAD']); readQuery(target, []);
          json(response, 200, await workspace.operations(), request.method === 'HEAD'); return;
        }
        if (target.pathname === '/api/operation') {
          requireMethod(request, response, ['POST']); readQuery(target, []);
          const body = await readJsonBody(request);
          context.operation = body.operation; context.input = body.input; context.started = true;
          json(response, 200, await workspace.dispatch(body.operation, body.input)); return;
        }
        if (target.pathname === '/api/upload') {
          requireMethod(request, response, ['GET', 'POST']);
          if (request.method === 'GET') {
            const input = readQuery(target, ['uploadId']);
            json(response, 200, await workspace.uploadStatus(input)); return;
          }
          const input = readQuery(target, ['uploadId', 'name', 'bytes', 'sha256', 'offset', 'length']);
          context.operation = 'files.upload'; context.input = input;
          if (oneHeader(request, 'content-type') !== 'application/octet-stream' ||
              oneHeader(request, 'content-encoding') !== undefined)
            throw fail('DATASETTE_UPLOAD_CONTENT_TYPE_INVALID', 'Send the original uncompressed application/octet-stream bytes.', 415);
          const declared = oneHeader(request, 'content-length');
          if (!decimal(input.length) || Number(input.length) > 8 * 1024 * 1024 ||
              declared !== undefined && declared !== input.length)
            throw fail('DATASETTE_UPLOAD_RANGE_INVALID', 'Send one original range of at most 8 MiB with its exact declared length.');
          context.started = true;
          const result = await workspace.receiveUpload(input, request);
          if (!request.complete) response.setHeader('Connection', 'close');
          json(response, 200, result); return;
        }
        if (target.pathname === '/api/file') {
          requireMethod(request, response, ['GET', 'HEAD']);
          const input = readQuery(target, ['path', 'sha256', 'offset', 'limit']);
          json(response, 200, await workspace.dispatch('files.read', input), request.method === 'HEAD'); return;
        }
        if (target.pathname === '/api/download') {
          requireMethod(request, response, ['GET', 'HEAD']);
          if (request.headers.range !== undefined)
            throw fail('DATASETTE_HTTP_RANGE_INVALID', 'Use the pinned /api/file byte cursor for resumable transfers.', 416);
          const input = readQuery(target, ['path', 'sha256']);
          if (!/^[a-f0-9]{64}$/.test(input.sha256 ?? ''))
            throw fail('DATASETTE_FILE_HASH_REQUIRED', 'Select the SHA-256 of this original retained file.');
          await download(request, response, input); return;
        }
        throw fail('DATASETTE_HTTP_ROUTE_NOT_FOUND', 'Select a declared Datasette API route.', 404);
      }
      requireMethod(request, response, ['GET', 'HEAD']); readQuery(target, []);
      assets ??= await readBrowserAssets(browserAssets);
      const asset = assets.get(target.pathname);
      if (!asset) throw fail('DATASETTE_HTTP_ROUTE_NOT_FOUND', 'Select a declared Datasette operator page.', 404);
      const body = await readFile(asset.url);
      response.writeHead(200, {'Content-Type':asset.type, 'Content-Length':body.length});
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch (error) {
      if (response.headersSent) {response.destroy(error); return;}
      if (response.destroyed) return;
      const failure = errorResult(error, context);
      // Keep malformed or oversized bodies out of a subsequent keep-alive request.
      if (!request.complete) response.setHeader('Connection', 'close');
      json(response, failure.status, failure.value, request.method === 'HEAD');
    }
  }
  try {
    await new Promise((done, reject) => {
      const failed = error => {server.removeListener('listening', ready); reject(error);};
      const ready = () => {server.removeListener('error', failed); done();};
      server.once('error', failed); server.once('listening', ready); server.listen(port, host);
    });
    const address = server.address(), authority = (host === '::1' ? '[::1]' : host) + ':' + address.port;
    url = new URL('http://' + authority).origin;
    permittedOrigins = new Set(['127.0.0.1', 'localhost', '[::1]'].flatMap(name => {
      const explicit = 'http://' + name + ':' + address.port;
      return [explicit, new URL(explicit).origin];
    }));
    return Object.freeze({url, workspaceId:workspace.workspaceId, instanceId, directory:workspace.directory,
      close() {
        if (closing) return closing;
        stopping = true;
        closing = (async () => {
          const httpClosed = new Promise((done, reject) =>
            server.close(error => error ? reject(error) : done()));
          server.closeIdleConnections?.();
          const ownerClosed = ownsWorkspace ? workspace.close() : Promise.resolve();
          const results = await Promise.allSettled([httpClosed, ownerClosed]);
          await Promise.allSettled([...requests]);
          const failed = results.find(result => result.status === 'rejected');
          if (failed) throw failed.reason;
        })();
        return closing;
      },
    });
  } catch (error) {
    if (server.listening) await new Promise(done => server.close(done));
    if (ownsWorkspace) await workspace.close();
    throw error;
  }
}
