// MIT. Read-only WebDAV HTTP transport with bounded native XML parsing.
import http from 'node:http';
import https from 'node:https';
import { spawn } from 'node:child_process';
import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { privateDirectory, createFile, syncDirectory } from '../postgres/publisher/files.mjs';
import { WebDavError, fail, validateSource, resourceUrl, relativeHref, opaqueEtag, integer, sha256, jsonBytes, now } from './config.mjs';

const PROPFIND = Buffer.from('<?xml version="1.0" encoding="utf-8"?>\n' +
  '<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">' +
  '<d:prop><d:displayname/><d:resourcetype/><d:getcontentlength/><d:getcontenttype/>' +
  '<d:getetag/><d:getlastmodified/><oc:fileid/><oc:id/><nc:metadata_etag/></d:prop></d:propfind>');
const DAV = '{DAV:}', OC = '{http://owncloud.org/ns}';
const retainedHeaders = ['etag', 'last-modified', 'content-length', 'content-type', 'content-range', 'content-encoding', 'date', 'dav'];
export const safeHeaders = headers => Object.fromEntries(retainedHeaders.filter(name => typeof headers[name] === 'string').map(name => [name, headers[name]]));
export function httpFailure(response, method) {
  const status = response.statusCode; response.destroy();
  return new WebDavError('WEBDAV_HTTP_' + status, method + ' returned HTTP ' + status + '.', status === 401 || status === 403 ? 403 : status === 412 ? 409 : 502, { httpStatus: status, method });
}
export async function consume(response, limit) {
  const parts = []; let length = 0;
  try {
    for await (const part of response) {
      length += part.length;
      if (length > limit) fail('WEBDAV_RESPONSE_LIMIT', 'The response exceeds its configured byte limit.', 413);
      parts.push(part);
    }
    if (!response.complete) fail('WEBDAV_RESPONSE_INTERRUPTED', 'The original HTTP response did not complete.', 502);
    return Buffer.concat(parts, length);
  } catch (error) { response.destroy(); throw error; }
}
async function credentialHeaders(config, environment) {
  const auth = config.connection.auth;
  const value = name => {
    const selected = environment[name];
    if (typeof selected !== 'string' || !selected.length) fail('WEBDAV_ENV_MISSING', 'Provide environment reference ' + name + ' on this host.', 400, { name });
    return selected;
  };
  if (auth.type === 'none') return {};
  if (auth.type === 'basic') {
    const username = value(auth.usernameEnv), password = value(auth.passwordEnv);
    if (username.includes(':') || /[\r\n\0]/.test(username + password))
      fail('WEBDAV_BASIC_CREDENTIAL', 'The configured Basic credentials contain unsupported characters.');
    return { authorization: 'Basic ' + Buffer.from(username + ':' + password, 'utf8').toString('base64') };
  }
  const token = value(auth.tokenEnv);
  if (!/^[\x21-\x7e]+$/.test(token)) fail('WEBDAV_BEARER_CREDENTIAL', 'The configured Bearer token is not a valid HTTP credential.');
  return { authorization: 'Bearer ' + token };
}
async function certificate(config, environment) {
  const name = config.connection.caFileEnv;
  if (!name) return undefined;
  const path = environment[name];
  if (typeof path !== 'string' || !isAbsolute(path)) fail('WEBDAV_CA_FILE', 'Provide an absolute CA file through ' + name + '.');
  const selected = await realpath(path), handle = await open(selected, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > 1048576n) fail('WEBDAV_CA_FILE', 'The CA file must be a regular file of at most 1 MiB.');
    const content = await handle.readFile(), after = await handle.stat({ bigint: true });
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || BigInt(content.length) !== before.size)
      fail('WEBDAV_CA_CHANGED', 'The configured CA file changed during the read.', 409);
    return content;
  } finally { await handle.close(); }
}
export function createHttpTransport(declaration, { environment = process.env } = {}) {
  const config = validateSource(declaration), active = new Set();
  let closed = false;
  async function once(method, href, headers, body, { signal, deadline } = {}) {
    if (closed) fail('WEBDAV_CLOSED', 'Reopen the source.', 409);
    if (signal?.aborted) fail('WEBDAV_CANCELLED', 'The source operation was cancelled.', 409);
    const auth = await credentialHeaders(config, environment), ca = await certificate(config, environment);
    if (closed || signal?.aborted) fail('WEBDAV_CANCELLED', 'The source operation was cancelled.', 409);
    const selected = new URL(resourceUrl(config.connection.rootUrl, href));
    return new Promise((resolve, reject) => {
      let response, reported = false, totalTimer;
      const request = (selected.protocol === 'https:' ? https : http).request(selected, {
        method, agent: false, ...(ca ? { ca } : {}), rejectUnauthorized: true,
        headers: { 'user-agent': 'StellarForge-WebDAV/1', 'accept-encoding': 'identity', ...auth,
          ...(body ? { 'content-length': body.length } : {}), ...headers },
      });
      const operation = { request, get response() { return response; } }; active.add(operation);
      const cancelled = () => request.destroy(new WebDavError('WEBDAV_CANCELLED', 'The source operation was cancelled.', 409));
      const cleanup = () => { clearTimeout(totalTimer); signal?.removeEventListener('abort', cancelled); active.delete(operation); };
      request.setTimeout(config.limits.timeoutMs, () => request.destroy(new WebDavError('WEBDAV_TIMEOUT', 'The original WebDAV connection timed out.', 504)));
      totalTimer = setTimeout(() => request.destroy(new WebDavError('WEBDAV_TIMEOUT', 'The source operation reached its duration limit.', 504)),
        Math.max(1, (deadline ?? Date.now() + config.limits.maxCaptureMs) - Date.now()));
      signal?.addEventListener('abort', cancelled, { once: true });
      request.once('error', error => {
        cleanup();
        const safe = error instanceof WebDavError ? error : new WebDavError('WEBDAV_CONNECTION_FAILED', 'The original WebDAV connection failed.', 502, { nativeCode: typeof error.code === 'string' ? error.code : null });
        if (response) response.destroy(safe);
        if (!reported) { reported = true; reject(safe); }
      });
      request.once('response', incoming => {
        response = incoming;
        // Filesystem checkpoints may await before the consumer attaches its iterator.
        // Retain stream errors during that interval; the iterator observes .errored.
        incoming.on('error', () => {});
        incoming.once('close', cleanup);
        incoming.once('end', cleanup);
        if (!reported) { reported = true; resolve(incoming); }
      });
      if (body) request.write(body);
      request.end();
    });
  }
  async function request(method, href, headers = {}, body = null, options = {}) {
    if (!['GET', 'PROPFIND'].includes(method)) fail('WEBDAV_READ_ONLY', 'This source performs only GET and PROPFIND.');
    let selected = resourceUrl(config.connection.rootUrl, href);
    const redirects = [], deadline = options.deadline ?? Date.now() + config.limits.maxCaptureMs;
    for (let count = 0; count <= 4; count++) {
      const response = await once(method, selected, headers, body, { ...options, deadline });
      if (![301, 302, 307, 308].includes(response.statusCode)) return { response, href: selected, redirects };
      const location = response.headers.location; response.destroy();
      if (count === 4 || typeof location !== 'string') fail('WEBDAV_REDIRECT', 'The original WebDAV redirect could not be followed safely.', 502);
      const next = resourceUrl(config.connection.rootUrl, new URL(location, selected).href);
      if (next === selected || redirects.some(item => item.from === next)) fail('WEBDAV_REDIRECT_LOOP', 'The original WebDAV server returned a redirect loop.', 502);
      redirects.push({ from: selected, to: next, status: response.statusCode }); selected = next;
    }
  }
  async function close() {
    if (closed) return;
    closed = true;
    for (const item of active) item.request.destroy(new WebDavError('WEBDAV_CANCELLED', 'The source was closed.', 409));
  }
  return { config, request, close };
}
export async function parseMultistatus(bytes, config, { python = 'python3', signal } = {}) {
  if (typeof python !== 'string' || !python || python.includes('\0')) fail('WEBDAV_PYTHON', 'Select the original Python runtime.');
  if (bytes.length > config.limits.maxListingBytes) fail('WEBDAV_LISTING_LIMIT', 'The collection listing exceeds its byte limit.', 413);
  return new Promise((resolve, reject) => {
    const child = spawn(python, [fileURLToPath(new URL('./multistatus.py', import.meta.url)),
      '--max-entries', String(config.limits.maxEntries), '--max-bytes', String(config.limits.maxListingBytes)],
      { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    const parts = []; let length = 0, failure = null, stderrLength = 0;
    const cancel = () => { failure ??= new WebDavError('WEBDAV_CANCELLED', 'The collection read was cancelled.', 409); child.kill('SIGTERM'); };
    const timer = setTimeout(() => { failure ??= new WebDavError('WEBDAV_XML_TIMEOUT', 'The original XML parser did not complete.', 504); child.kill('SIGKILL'); }, 30000);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    child.stdin.on('error', () => {});
    child.stderr.on('data', part => { stderrLength += part.length; if (stderrLength > 65536) { failure ??= new WebDavError('WEBDAV_XML_RUNTIME', 'The original XML parser failed.'); child.kill('SIGKILL'); } });
    child.stdout.on('data', part => {
      length += part.length;
      if (length > config.limits.maxListingBytes * 4 + 1048576) {
        failure ??= new WebDavError('WEBDAV_XML_OUTPUT_LIMIT', 'The parsed collection exceeds its limit.'); child.kill('SIGKILL');
      } else parts.push(part);
    });
    child.once('error', () => { failure ??= new WebDavError('WEBDAV_PYTHON_UNAVAILABLE', 'Start with Python and the maintained original XML component installed.'); });
    child.once('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      if (failure) return reject(failure);
      let result;
      try { result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts, length))); }
      catch { return reject(new WebDavError('WEBDAV_XML_RUNTIME', 'The original XML parser did not return its native result.')); }
      if (code !== 0 || result.error || result.schema !== 'stellar-forge.webdav-multistatus.v1')
        return reject(new WebDavError('WEBDAV_XML_INVALID', result.error?.message ?? 'The original WebDAV XML could not be read.'));
      resolve(result);
    });
    child.stdin.end(bytes);
  });
}
function normalizeResponse(row, root) {
  const issues = [], propertyStatus = {}, properties = {};
  let href = null;
  if (row.hrefs.length === 1) {
    try { href = resourceUrl(root, row.hrefs[0]); } catch (error) { issues.push({ code: error.code, message: error.message }); }
  } else issues.push({ code: 'WEBDAV_RESPONSE_HREF', message: 'A response must identify exactly one resource.' });
  if (row.statusLine !== null && (row.status === null || row.status < 200 || row.status >= 300))
    issues.push({ code: 'WEBDAV_RESOURCE_STATUS', message: 'The resource response is not successful.', status: row.status });
  for (const group of row.propstats) for (const prop of group.properties) {
    if (Object.hasOwn(propertyStatus, prop.name)) {
      issues.push({ code: 'WEBDAV_DUPLICATE_PROPERTY', message: 'The resource repeats a property.', property: prop.name }); continue;
    }
    propertyStatus[prop.name] = group.status;
    if (group.status >= 200 && group.status < 300) properties[prop.name] = { text: prop.text, children: prop.children };
  }
  const get = name => properties[name]?.text ?? null, types = properties[DAV + 'resourcetype']?.children;
  const kind = !types ? 'unknown' : types.includes(DAV + 'collection') ? 'collection' : 'file';
  const lengthText = get(DAV + 'getcontentlength')?.trim() ?? null;
  let contentLength = null;
  if (lengthText !== null && /^\d+$/.test(lengthText)) {
    const n = BigInt(lengthText); if (n <= BigInt(Number.MAX_SAFE_INTEGER)) contentLength = Number(n);
  } else if (lengthText !== null) issues.push({ code: 'WEBDAV_CONTENT_LENGTH', message: 'The reported length is not an integer.' });
  const reportedEtag = get(DAV + 'getetag'), propertyEtag = reportedEtag?.trim();
  let etag = null, etagEncoding = null;
  try {
    // WsgiDAV's DAV property is the bare opaque value; its HTTP header quotes it.
    // Keep the reported property unchanged and require the response to match.
    const bare = typeof propertyEtag === 'string' && propertyEtag.length > 0 &&
      !propertyEtag.startsWith('W/') && /^[\x21\x23-\x7e\x80-\xff]+$/.test(propertyEtag);
    etag = opaqueEtag(bare ? '"' + propertyEtag + '"' : propertyEtag);
    if (etag !== null) etagEncoding = bare ? 'quoted-bare-property' : 'quoted-property';
  } catch (error) { issues.push({ code: error.code, message: error.message }); }
  const name = get(DAV + 'displayname') ?? (href ? decodeURIComponent(new URL(href).pathname.replace(/\/$/, '').split('/').at(-1) ?? '') : '');
  return { href, originalHref: row.hrefs[0] ?? null, relativeHref: href ? relativeHref(root, href) : null,
    name, kind, etag, reportedEtag, etagEncoding, contentLength, contentLengthText: lengthText,
    lastModified: get(DAV + 'getlastmodified')?.trim() ?? null, contentType: get(DAV + 'getcontenttype'),
    fileId: get(OC + 'fileid'), instanceFileId: get(OC + 'id'), propertyStatus, properties, issues,
    accessible: href !== null && issues.length === 0 && (row.status === null || row.status >= 200 && row.status < 300) };
}
export async function readCollection(transport, directory, { href = '', depth = 1, limit = 200, offset = 0, signal, python } = {}) {
  if (![0, 1].includes(depth)) fail('WEBDAV_DEPTH', 'Choose depth 0 or 1.');
  integer(limit, 1, 1000, 'displayed listing entries'); integer(offset, 0, 20000, 'listing offset');
  const config = transport.config, selected = resourceUrl(config.connection.rootUrl, href);
  await privateDirectory(directory, true);
  const id = randomUUID(), requestedAt = now();
  const received = await transport.request('PROPFIND', selected, { depth: String(depth), 'content-type': 'application/xml; charset=utf-8', accept: 'application/xml, text/xml' }, PROPFIND, { signal });
  if (received.response.statusCode !== 207) throw httpFailure(received.response, 'PROPFIND');
  const headers = safeHeaders(received.response.headers);
  if (headers['content-encoding'] && headers['content-encoding'].toLowerCase() !== 'identity') {
    received.response.destroy(); fail('WEBDAV_ENCODING', 'The server ignored identity content encoding.', 502);
  }
  const body = await consume(received.response, config.limits.maxListingBytes);
  await createFile(join(directory, id + '.xml'), body);
  const capture = { id, schema: 'stellar-forge.webdav-listing.v1', requestedAt, capturedAt: now(), href: selected,
    finalHref: received.href, depth, status: 207, headers, redirects: received.redirects, bytes: body.length, sha256: sha256(body), originalFile: id + '.xml' };
  let parsed;
  try { parsed = await parseMultistatus(body, config, { python, signal }); }
  catch (error) {
    await createFile(join(directory, id + '.json'), jsonBytes({ ...capture, error: { code: error.code ?? 'WEBDAV_XML_INVALID', message: error.message } }));
    await syncDirectory(directory); throw error;
  }
  const entries = parsed.responses.map(row => normalizeResponse(row, config.connection.rootUrl));
  const duplicate = new Map();
  for (const item of entries) if (item.href) {
    if (duplicate.has(item.href)) {
      for (const repeated of [duplicate.get(item.href), item]) {
        repeated.accessible = false;
        if (!repeated.issues.some(issue => issue.code === 'WEBDAV_DUPLICATE_HREF'))
          repeated.issues.push({ code: 'WEBDAV_DUPLICATE_HREF', message: 'The listing repeats this resource.' });
      }
    } else duplicate.set(item.href, item);
  }
  const result = { ...capture, entries, total: entries.length };
  await createFile(join(directory, id + '.json'), jsonBytes(result)); await syncDirectory(directory);
  return { ...capture, total: entries.length, offset, limit, entries: entries.slice(offset, offset + limit),
    nextOffset: offset + limit < entries.length ? offset + limit : null };
}
