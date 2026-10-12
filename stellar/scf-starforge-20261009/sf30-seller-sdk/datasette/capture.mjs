// MIT. Durable Datasette HTTP page capture and adoption of original responses.
import { open, mkdir, readdir, lstat, rename, unlink } from 'node:fs/promises';
import { join, dirname, resolve, posix } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { object, bytes, digest, identity, stamp, fault, privateDirectory, readPrivate,
  readJson, createFile, atomicJson, syncDirectory, acquireWorkspace } from '../postgres/publisher/files.mjs';
import { parseExactJson, isJsonNumber, exactJson } from './json.mjs';

const CAPTURE = 'stellar-forge.datasette-capture.v1';
const OPERATION = 'stellar-forge.datasette-operation.v1';
const PAGE = 'stellar-forge.datasette-page.v1';
const MAX_META = 16777216;
const MAX_PAGE = 67108864;
const MAX_TOTAL = 536870912;
const HASH = /^[a-f0-9]{64}$/;
const exists = async file => { try { await lstat(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
const same = (a, b) => identity(a) === identity(b);
const pageName = index => 'page-' + String(index).padStart(8, '0') + '.json';
const cleanUrl = value => {
  let parsed;
  try { parsed = new URL(value); } catch { throw fault('DATASETTE_URL_INVALID'); }
  if (parsed.username || parsed.password || parsed.hash) throw fault('DATASETTE_URL_CREDENTIALS_OR_FRAGMENT');
  if (![...parsed.searchParams.keys()].every(key => !/^(?:access_token|api_key|apikey|token|auth|_auth_token)$/i.test(key)))
    throw fault('DATASETTE_AUTHENTICATION_USE_RUNTIME_HEADERS');
  return parsed;
};

export function normalizeDatasetteSelection(input) {
  if (!object(input) || typeof input.url !== 'string') throw fault('DATASETTE_SELECTION_REQUIRED');
  const selection = structuredClone(input), url = cleanUrl(selection.url);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && selection.allowHttp === true))
    throw fault('DATASETTE_HTTPS_REQUIRED');
  selection.url = url.href;
  selection.kind ??= 'table';
  if (!['table', 'query'].includes(selection.kind)) throw fault('DATASETTE_SELECTION_KIND_INVALID');
  if (selection.kind === 'query' && selection.readOnly !== true)
    throw fault('DATASETTE_READ_ONLY_QUERY_REQUIRED', 'Choose a read-only query and retain its readOnly selection.');
  for (const key of ['database', 'table', 'query', 'account'])
    if (selection[key] !== undefined && (typeof selection[key] !== 'string' || !selection[key] || selection[key].length > 4096))
      throw fault('DATASETTE_SELECTOR_INVALID', key);
  if (selection.authentication !== undefined && (!object(selection.authentication) ||
      Object.keys(selection.authentication).some(key => !['plugin', 'selector'].includes(key)) ||
      Object.values(selection.authentication).some(value => typeof value !== 'string' || !value)))
    throw fault('DATASETTE_AUTHENTICATION_SELECTOR_INVALID');
  if (['headers', 'password', 'secret', 'token', 'credentials', 'authorization', 'cookie'].some(key => Object.hasOwn(selection, key)))
    throw fault('DATASETTE_AUTHENTICATION_USE_RUNTIME_HEADERS');
  selection.continuation ??= 'auto';
  if (!['auto', 'next_url', 'link'].includes(selection.continuation)) throw fault('DATASETTE_CONTINUATION_KIND_INVALID');
  if (selection.columns !== undefined) columnNames(selection.columns);
  selection.approvedOrigins ??= [url.origin];
  if (!Array.isArray(selection.approvedOrigins) || !selection.approvedOrigins.includes(url.origin) ||
      selection.approvedOrigins.some(origin => {
        const parsed = cleanUrl(origin);
        return parsed.origin !== origin || parsed.pathname !== '/' ||
          (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && selection.allowHttp === true));
      })) throw fault('DATASETTE_APPROVED_ORIGINS_INVALID');
  return selection;
}

function columnNames(value) {
  if (!Array.isArray(value) || !value.length || value.length > 10000 ||
      value.some(name => typeof name !== 'string' || !name || name.includes('\0') || name.length > 4096) ||
      new Set(value).size !== value.length) throw fault('DATASETTE_COLUMNS_INVALID');
  return value;
}
function selectedParameters(url) {
  return [...url.searchParams.entries()].filter(([key]) => key !== '_next')
    .sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv));
}
function continuationUrl(advertised, base, selection) {
  if (typeof advertised !== 'string' || !advertised) throw fault('DATASETTE_CONTINUATION_INVALID');
  const initial = cleanUrl(selection.url), url = cleanUrl(new URL(advertised, base).href);
  let transportUpgrade = false;
  // Some Datasette reverse proxies advertise http even when their real selected
  // endpoint was HTTPS. Keep that original URL and request its HTTPS equivalent.
  if (initial.protocol === 'https:' && url.protocol === 'http:' &&
      url.hostname === initial.hostname && (!url.port || url.port === '80')) {
    url.protocol = 'https:'; url.port = initial.port; transportUpgrade = true;
  }
  if (!selection.approvedOrigins.includes(url.origin)) throw fault('DATASETTE_CONTINUATION_ORIGIN_CHANGED');
  if (url.pathname !== initial.pathname || !same(selectedParameters(url), selectedParameters(initial)))
    throw fault('DATASETTE_SELECTION_CHANGED', 'A continuation changed the saved path or selected query parameters.');
  return { advertisedUrl: advertised, url: url.href, transportUpgrade };
}

function headerPairs(input) {
  const pairs = input?.entries && !Array.isArray(input) ? [...input.entries()] :
    Array.isArray(input) ? input : object(input) ? Object.entries(input).flatMap(([key, value]) =>
      Array.isArray(value) ? value.map(item => [key, item]) : [[key, value]]) : [];
  if (pairs.some(pair => !Array.isArray(pair) || pair.length !== 2 ||
      pair.some(value => typeof value !== 'string'))) throw fault('DATASETTE_HEADERS_INVALID');
  return pairs;
}
function retainHeaders(input) {
  const all = headerPairs(input);
  const secret = /^(?:set-cookie|authorization|proxy-authorization|www-authenticate|authentication-info)$/i;
  return { headers: all.filter(([name]) => !secret.test(name)),
    omittedSensitiveHeaders: [...new Set(all.filter(([name]) => secret.test(name)).map(([name]) => name.toLowerCase()))] };
}
const header = (pairs, name) => pairs.filter(([key]) => key.toLowerCase() === name).map(([, value]) => value).join(', ') || null;
function linkNext(pairs) {
  const text = header(pairs, 'link');
  if (!text) return null;
  const links = [];
  const matcher = /<([^>]*)>\s*((?:;\s*[^,]*)?)/g;
  let match;
  while ((match = matcher.exec(text))) {
    const rel = /;\s*rel\s*=\s*(?:"([^"]*)"|([^;\s,]+))/i.exec(match[2]);
    if ((rel?.[1] ?? rel?.[2] ?? '').split(/\s+/).includes('next')) links.push(match[1]);
  }
  if (links.length > 1) throw fault('DATASETTE_MULTIPLE_NEXT_LINKS');
  return links[0] ?? null;
}
function parsePage(body, receipt, selection, expectedColumns, expectedMode) {
  const document = parseExactJson(body);
  if (!object(document) || !Array.isArray(document.rows)) throw fault('DATASETTE_ARRAYS_ENVELOPE_REQUIRED');
  if (document.ok === false || document.error) throw fault('DATASETTE_SOURCE_ERROR', 'The retained response declares a source error.');
  for (const key of ['database', 'table'])
    if (document[key] !== undefined && selection[key] !== undefined && document[key] !== selection[key])
      throw fault('DATASETTE_SOURCE_IDENTITY_CHANGED', key);
  const columns = columnNames(document.columns ?? expectedColumns ?? selection.columns);
  if ((selection.columns && !same(columns, selection.columns)) || (expectedColumns && !same(columns, expectedColumns)))
    throw fault('DATASETTE_SCHEMA_CHANGED');
  const rows = document.rows.map(row => {
    if (Array.isArray(row)) {
      if (row.length !== columns.length) throw fault('DATASETTE_ROW_WIDTH_CHANGED');
      return row;
    }
    if (object(row) && columns.length === Object.keys(row).length && columns.every(name => Object.hasOwn(row, name)))
      return columns.map(name => row[name]);
    throw fault('DATASETTE_ROW_SHAPE_CHANGED');
  });
  let mode = selection.continuation === 'auto' ?
    (Object.hasOwn(document, 'next_url') ? 'next_url' : 'link') : selection.continuation;
  if (expectedMode && mode !== expectedMode) throw fault('DATASETTE_CONTINUATION_REPRESENTATION_CHANGED');
  const viaLink = linkNext(receipt.headers), viaBody = document.next_url ?? null;
  if (viaBody !== null && typeof viaBody !== 'string') throw fault('DATASETTE_CONTINUATION_INVALID');
  const advertised = mode === 'next_url' ? viaBody : viaLink;
  let next = advertised ? continuationUrl(advertised, receipt.responseUrl, selection) : null;
  if (viaBody && viaLink && continuationUrl(viaBody, receipt.responseUrl, selection).url !==
      continuationUrl(viaLink, receipt.responseUrl, selection).url)
    throw fault('DATASETTE_CONTINUATION_DISAGREEMENT');
  if (!next && (document.truncated === true || (document.next !== undefined && document.next !== null && document.next !== '')))
    throw fault('DATASETTE_TRUNCATED_WITHOUT_CONTINUATION', 'The source response is incomplete and has no usable continuation.');
  if (!next && mode === 'next_url' && viaLink) throw fault('DATASETTE_CONTINUATION_DISAGREEMENT');
  let sourceVersion = null;
  for (const key of ['database_hash', 'database_version'])
    if (document[key] !== undefined) sourceVersion = { field: key, value: exactJson(document[key]) };
  let immutableIdentity = null;
  const selectedIdentity = selection.immutableIdentity;
  if (selectedIdentity?.header) {
    const observed = header(receipt.headers, String(selectedIdentity.header).toLowerCase());
    if (!observed || observed !== selectedIdentity.value) throw fault('DATASETTE_IMMUTABLE_IDENTITY_CHANGED');
    immutableIdentity = { header: selectedIdentity.header, value: observed, evidence: selectedIdentity.evidence ?? null };
  }
  return { columns, rows, next, continuation: mode, sourceVersion, immutableIdentity,
    truncated: document.truncated === true, declaredColumns: Object.hasOwn(document, 'columns') };
}

export function datasetteMember(name) {
  if (typeof name !== 'string' || !name || name.length > 1024 || name.includes('\\') || name.includes('\0') ||
      posix.isAbsolute(name) || posix.normalize(name) !== name ||
      name.split('/').some(part => !part || part === '.' || part === '..'))
    throw fault('DATASETTE_CAPTURE_MEMBER_INVALID');
  return name;
}
async function immutableFile(directory, file, content) {
  const path = join(directory, datasetteMember(file));
  const parent = dirname(path); await privateDirectory(parent, true);
  const receipt = { file, sha256: digest(content), bytes: content.length };
  if (await exists(path)) {
    if (!(await readPrivate(path, Math.max(content.length, MAX_META))).equals(content))
      throw fault('DATASETTE_IMMUTABLE_FILE_CONFLICT', file);
    return receipt;
  }
  // The caller owns this operation's workspace lease. Publish a fully synced
  // temporary file atomically, so interruption cannot expose partial page JSON.
  const temporary = join(parent, '.pending-' + randomUUID());
  try {
    await createFile(temporary, content);
    if (await exists(path)) {
      if (!(await readPrivate(path, Math.max(content.length, MAX_META))).equals(content))
        throw fault('DATASETTE_IMMUTABLE_FILE_CONFLICT', file);
    } else await rename(temporary, path);
    await syncDirectory(parent);
  } finally { try { await unlink(temporary); } catch (issue) { if (issue.code !== 'ENOENT') throw issue; } }
  return receipt;
}
async function initialize(directory, operationId, input) {
  directory = resolve(directory);
  await privateDirectory(directory, true);
  if (typeof operationId !== 'string' || !operationId || operationId.length > 256 || operationId.includes('\0'))
    throw fault('DATASETTE_OPERATION_ID_REQUIRED');
  const selection = normalizeDatasetteSelection(input), file = join(directory, 'operation.json');
  let operation;
  if (await exists(file)) {
    operation = await readJson(file, MAX_META);
    if (operation.schema !== OPERATION || operation.operationId !== operationId ||
        !same(operation.selection, selection) || operation.selectionHash !== identity(selection))
      throw fault('DATASETTE_OPERATION_SELECTION_CONFLICT', 'Resume the original operation or choose a new capture directory.');
  } else {
    operation = { schema: OPERATION, operationId, selection, selectionHash: identity(selection), createdAt: stamp() };
    await immutableFile(directory, 'operation.json', bytes(operation));
  }
  await privateDirectory(join(directory, 'pages'), true);
  await privateDirectory(join(directory, 'attempts'), true);
  return operation;
}
async function pageState(directory, operation) {
  const entries = (await readdir(join(directory, 'pages'))).filter(name => /^page-[0-9]{8}\.json$/.test(name)).sort();
  const state = { pages: [], rows: [], columns: operation.selection.columns ?? null, continuation: null,
    next: { url: operation.selection.url, advertisedUrl: operation.selection.url, transportUpgrade: false },
    seen: new Set(), sourceVersion: undefined, immutableIdentity: null, totalBytes: 0 };
  for (let index = 0; index < entries.length; index++) {
    if (entries[index] !== pageName(index + 1)) throw fault('DATASETTE_PAGE_CHAIN_GAP');
    const receipt = await readJson(join(directory, 'pages', entries[index]), MAX_META);
    await acceptPage(directory, operation, state, receipt, index + 1);
  }
  return state;
}
async function acceptPage(directory, operation, state, receipt, index) {
  if (receipt.schema !== PAGE || receipt.index !== index || receipt.operationId !== operation.operationId ||
      receipt.selectionHash !== operation.selectionHash || !state.next || !sameRequest(receipt.requestedUrl, state.next.url, operation.selection) ||
      state.seen.has(normalizedRequest(receipt.requestedUrl, operation.selection))) throw fault('DATASETTE_PAGE_CHAIN_CHANGED');
  validateResponseMetadata(receipt, operation.selection);
  if (!HASH.test(receipt.body?.sha256 ?? '') || !Number.isSafeInteger(receipt.body.bytes) ||
      receipt.body.bytes < 0 || receipt.body.bytes > MAX_PAGE) throw fault('DATASETTE_BODY_RECEIPT_INVALID');
  const body = await readPrivate(join(directory, datasetteMember(receipt.body.file)), MAX_PAGE);
  if (digest(body) !== receipt.body.sha256 || body.length !== receipt.body.bytes) throw fault('DATASETTE_PAGE_BODY_CHANGED');
  const parsed = parsePage(body, receipt, operation.selection, state.columns, state.continuation);
  if (!same(receipt.columns, parsed.columns) || !same(receipt.next, parsed.next) ||
      receipt.rowCount !== parsed.rows.length || receipt.continuation !== parsed.continuation ||
      !same(receipt.sourceVersion, parsed.sourceVersion) || !same(receipt.immutableIdentity, parsed.immutableIdentity))
    throw fault('DATASETTE_PAGE_RECEIPT_BINDING_CHANGED');
  if (state.sourceVersion !== undefined && !same(state.sourceVersion, parsed.sourceVersion))
    throw fault('DATASETTE_SOURCE_VERSION_CHANGED');
  if (parsed.next && (state.seen.has(normalizedRequest(parsed.next.url, operation.selection)) || sameRequest(parsed.next.url, receipt.requestedUrl, operation.selection)))
    throw fault('DATASETTE_REPEATED_CONTINUATION');
  state.seen.add(normalizedRequest(receipt.requestedUrl, operation.selection)); state.pages.push(receipt); for (const row of parsed.rows) state.rows.push(row);
  state.columns = parsed.columns; state.continuation = parsed.continuation; state.next = parsed.next;
  state.sourceVersion = parsed.sourceVersion; state.immutableIdentity = parsed.immutableIdentity;
  state.totalBytes += body.length;
  if (state.totalBytes > MAX_TOTAL || state.rows.length > 1000000) throw fault('DATASETTE_CAPTURE_LIMIT_EXCEEDED');
}
function providerImportComplete(receipt) {
  const provider = receipt.providerReceipt;
  return object(provider) && ['uploaded', 'complete', 'completed'].includes(provider.status) &&
    typeof provider.provider === 'string' && !!provider.provider &&
    [provider.file_upload_id, provider.fileUploadId, provider.id].some(value => typeof value === 'string' && !!value);
}
function normalizedRequest(url, selection) {
  return continuationUrl(url, selection.url, selection).url;
}
function sameRequest(left, right, selection) {
  return normalizedRequest(left, selection) === normalizedRequest(right, selection);
}
function nullableTime(value) {
  return value === null || value === undefined || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
}
function observedWindow(pages) {
  const lower = [], upper = [];
  for (const page of pages) {
    const window = page.retrievalWindow;
    const before = window?.notBefore ?? window?.not_before ?? null;
    const after = window?.notAfter ?? window?.not_after ?? null;
    if (page.startedAt) lower.push(page.startedAt);
    if (page.completedAt) upper.push(page.completedAt);
    if (page.retrievedAt) { lower.push(page.retrievedAt); upper.push(page.retrievedAt); }
    if (before) lower.push(before); if (after) upper.push(after);
  }
  lower.sort((a, b) => Date.parse(a) - Date.parse(b));
  upper.sort((a, b) => Date.parse(a) - Date.parse(b));
  return { notBefore: lower[0] ?? null, notAfter: upper.at(-1) ?? null,
    basis: 'retained-retrieval-observations',
    exactStartKnown: pages.every(page => !!page.startedAt),
    exactEndKnown: pages.every(page => !!page.completedAt) };
}
function validateResponseMetadata(receipt, selection) {
  const knownStatus = receipt.status !== null && receipt.status !== undefined;
  if (knownStatus && (!Number.isInteger(receipt.status) || receipt.status < 200 || receipt.status >= 300))
    throw fault('DATASETTE_HTTP_STATUS', 'The retained response status is ' + receipt.status + '.');
  if (!knownStatus && !providerImportComplete(receipt))
    throw fault('DATASETTE_IMPORT_COMPLETION_REQUIRED', 'Retain the successful file-import provider receipt with the source body.');
  for (const field of ['startedAt', 'completedAt', 'retrievedAt'])
    if (!nullableTime(receipt[field])) throw fault('DATASETTE_RETRIEVAL_TIMES_INVALID');
  if (receipt.startedAt && receipt.completedAt && Date.parse(receipt.completedAt) < Date.parse(receipt.startedAt))
    throw fault('DATASETTE_RETRIEVAL_TIMES_INVALID');
  const window = receipt.retrievalWindow;
  if (window !== undefined && window !== null) {
    if (!object(window)) throw fault('DATASETTE_RETRIEVAL_WINDOW_INVALID');
    const before = window.notBefore ?? window.not_before, after = window.notAfter ?? window.not_after;
    if (typeof before !== 'string' || typeof after !== 'string' || !nullableTime(before) || !nullableTime(after) ||
        Date.parse(after) < Date.parse(before)) throw fault('DATASETTE_RETRIEVAL_WINDOW_INVALID');
  }
  headerPairs(receipt.headers);
  if (!Array.isArray(receipt.redirects)) throw fault('DATASETTE_REDIRECT_RECEIPT_INVALID');
  const requested = normalizedRequest(receipt.requestedUrl, selection);
  const final = normalizedRequest(receipt.responseUrl, selection);
  if (requested !== final) throw fault('DATASETTE_RESPONSE_SELECTION_CHANGED');
  if (final !== receipt.responseUrl) throw fault('DATASETTE_RESPONSE_TRANSPORT_CHANGED');
  let target = receipt.requestedUrl;
  for (const redirect of receipt.redirects) {
    if (redirect.url !== target || ![301, 302, 303, 307, 308].includes(redirect.status))
      throw fault('DATASETTE_REDIRECT_RECEIPT_INVALID');
    const next = continuationUrl(redirect.location, redirect.url, selection);
    if (next.url !== redirect.nextUrl || !sameRequest(next.url, receipt.requestedUrl, selection))
      throw fault('DATASETTE_REDIRECT_RECEIPT_INVALID');
    target = next.url;
  }
  if (receipt.redirects.length && receipt.responseUrl !== target)
    throw fault('DATASETTE_REDIRECT_CHAIN_CHANGED');
  if (providerImportComplete(receipt)) {
    const provider = receipt.providerReceipt, sourceUrl = provider.source_url ?? provider.sourceUrl;
    if (typeof sourceUrl !== 'string' || !sameRequest(sourceUrl, receipt.responseUrl, selection))
      throw fault('DATASETTE_IMPORT_SOURCE_CHANGED');
    const length = provider.content_length ?? provider.contentLength;
    if (length !== undefined && length !== receipt.body.bytes) throw fault('DATASETTE_IMPORT_LENGTH_CHANGED');
  }
}

async function commitAttempt(directory, operation, state, attempt) {
  if (attempt.state !== 'COMPLETE' || !state.next || !sameRequest(attempt.requestedUrl, state.next.url, operation.selection) ||
      attempt.operationId !== operation.operationId || attempt.selectionHash !== operation.selectionHash ||
      attempt.index !== state.pages.length + 1) throw fault('DATASETTE_ATTEMPT_BINDING_CHANGED');
  validateResponseMetadata(attempt, operation.selection);
  const body = await readPrivate(join(directory, datasetteMember(attempt.body.file)), MAX_PAGE);
  if (digest(body) !== attempt.body.sha256 || body.length !== attempt.body.bytes) throw fault('DATASETTE_PAGE_BODY_CHANGED');
  const parsed = parsePage(body, attempt, operation.selection, state.columns, state.continuation);
  const receipt = { schema: PAGE, operationId: operation.operationId, selectionHash: operation.selectionHash,
    index: attempt.index, requestedUrl: attempt.requestedUrl, advertisedUrl: state.next.advertisedUrl,
    transportUpgrade: state.next.transportUpgrade, responseUrl: attempt.responseUrl, status: attempt.status,
    headers: attempt.headers, omittedSensitiveHeaders: attempt.omittedSensitiveHeaders ?? [], redirects: attempt.redirects,
    startedAt: attempt.startedAt ?? null, completedAt: attempt.completedAt ?? null,
    retrievedAt: attempt.retrievedAt ?? null, retrievalWindow: attempt.retrievalWindow ?? null,
    providerReceipt: attempt.providerReceipt ?? null, responseUrlBasis: attempt.responseUrlBasis ?? null,
    redirectObservability: attempt.redirects.length || attempt.requestedUrl === attempt.responseUrl ? 'complete' : 'endpoints-only',
    originalReceipt: attempt.originalReceipt ?? null, recovery: attempt.recovery ?? null, acquisition: attempt.acquisition,
    importedAt: attempt.importedAt ?? null, body: attempt.body, attemptFile: attempt.file,
    columns: parsed.columns, columnsDeclaredByResponse: parsed.declaredColumns, rowCount: parsed.rows.length,
    continuation: parsed.continuation, next: parsed.next, truncated: parsed.truncated,
    sourceVersion: parsed.sourceVersion, immutableIdentity: parsed.immutableIdentity };
  // Validate against the entire original chain before this page becomes committed.
  await acceptPage(directory, operation, state, receipt, receipt.index);
  await immutableFile(directory, 'pages/' + pageName(receipt.index), bytes(receipt));
  return receipt;
}
async function completeAttempts(directory, state, selection) {
  const names = (await readdir(join(directory, 'attempts'))).filter(name => name.endsWith('.json')).sort();
  const results = [];
  for (const name of names) {
    const value = await readJson(join(directory, 'attempts', name), MAX_META);
    if (value.state === 'COMPLETE' && ((value.status >= 200 && value.status < 300) || providerImportComplete(value)) &&
        value.index === state.pages.length + 1 && state.next && sameRequest(value.requestedUrl, state.next.url, selection))
      results.push(value);
  }
  return results.sort((a, b) => String(a.completedAt ?? a.retrievedAt ?? a.importedAt).localeCompare(String(b.completedAt ?? b.retrievedAt ?? b.importedAt)) || a.file.localeCompare(b.file));
}
async function collectMembers(directory, current = '', result = []) {
  for (const name of (await readdir(join(directory, current))).sort()) {
    if (!current && ['capture.json', 'status.json', 'publisher.lock'].includes(name)) continue;
    if (name.startsWith('.pending-')) continue;
    const relative = current ? current + '/' + name : name;
    const path = join(directory, datasetteMember(relative)), stat = await lstat(path);
    if (stat.isSymbolicLink()) throw fault('DATASETTE_CAPTURE_SYMLINK');
    if (stat.isDirectory()) { await privateDirectory(path); await collectMembers(directory, relative, result); }
    else {
      const content = await readPrivate(path, MAX_PAGE);
      result.push({ file: relative, sha256: digest(content), bytes: content.length });
    }
  }
  return result;
}
async function status(directory, operation, state) {
  const value = { schema: 'stellar-forge.datasette-capture-status.v1', state: state.next ? 'INCOMPLETE' : 'COMPLETE',
    directory, operationId: operation.operationId, selectionHash: operation.selectionHash,
    rowCount: state.rows.length, pageCount: state.pages.length, nextUrl: state.next?.url ?? null,
    columns: state.columns, updatedAt: stamp() };
  await atomicJson(directory, 'status.json', value);
  return value;
}
async function finish(directory, operation, state) {
  if (state.next || !state.pages.length) return status(directory, operation, state);
  const files = await collectMembers(directory);
  const first = state.pages[0], last = state.pages.at(-1), observationWindow = observedWindow(state.pages);
  const capture = { schema: CAPTURE, state: 'COMPLETE', operationId: operation.operationId,
    selection: operation.selection, selectionHash: operation.selectionHash,
    startedAt: first.startedAt ?? null, completedAt: last.completedAt ?? null, observationWindow, committedAt: stamp(),
    columns: state.columns, columnSource: operation.selection.columnSource ??
      (first.columnsDeclaredByResponse ? { kind: 'first-page-envelope', bodySha256: first.body.sha256 } : { kind: 'explicit-selection' }),
    rowCount: state.rows.length, pageCount: state.pages.length, continuation: state.continuation,
    sourceVersion: state.sourceVersion ?? null,
    consistency: state.immutableIdentity ? { kind: 'immutable-database', identity: state.immutableIdentity,
      startedAt: first.startedAt ?? null, completedAt: last.completedAt ?? null, observationWindow } :
      { kind: 'observation-window', startedAt: first.startedAt ?? null, completedAt: last.completedAt ?? null, observationWindow,
        note: 'The remote service did not provide a verified immutable database identity spanning these pages.' },
    pages: state.pages, files };
  const content = bytes(capture);
  await immutableFile(directory, 'capture.json', content);
  await status(directory, operation, state);
  return { state: 'COMPLETE', directory, operationId: operation.operationId,
    captureFile: join(directory, 'capture.json'), captureSha256: digest(content),
    rowCount: capture.rowCount, pageCount: capture.pageCount, nextUrl: null, capture };
}

async function fetchAttempt(directory, operation, state, options) {
  const id = randomUUID(), file = 'attempts/' + id + '.json', bodyFile = 'attempts/' + id + '.body';
  const requestedUrl = state.next.url;
  const attempt = { schema: 'stellar-forge.datasette-response-attempt.v1', file,
    operationId: operation.operationId, selectionHash: operation.selectionHash, index: state.pages.length + 1,
    requestedUrl, state: 'REQUESTING', startedAt: stamp(), acquisition: 'http-response', redirects: [] };
  await immutableFile(directory, file, bytes(attempt));
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 60000);
  timer.unref?.();
  const hash = createHash('sha256'); let total = 0, handle;
  try {
    let target = requestedUrl, response;
    for (let redirects = 0; redirects <= 8; redirects++) {
      response = await (options.fetchImpl ?? fetch)(target, { method: 'GET', redirect: 'manual',
        headers: { Accept: 'application/json', 'Accept-Encoding': 'identity', ...options.headers }, signal: controller.signal });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      const next = continuationUrl(location, target, operation.selection);
      attempt.redirects.push({ url: target, status: response.status, ...retainHeaders(response.headers),
        location, nextUrl: next.url, transportUpgrade: next.transportUpgrade });
      await response.body?.cancel();
      if (redirects === 8) throw fault('DATASETTE_REDIRECT_LIMIT');
      target = next.url;
    }
    if (!response) throw fault('DATASETTE_RESPONSE_MISSING');
    if (response.url && response.url !== target) throw fault('DATASETTE_UNOBSERVED_REDIRECT');
    attempt.responseUrl = target; attempt.status = response.status;
    Object.assign(attempt, retainHeaders(response.headers));
    attempt.state = 'RECEIVING'; attempt.body = { file: bodyFile, bytes: 0, complete: false };
    await atomicJson(join(directory, 'attempts'), id + '.json', attempt);
    handle = await open(join(directory, bodyFile), 'wx', 0o600);
    if (response.body) for await (const chunk of response.body) {
      if (controller.signal.aborted) throw fault('DATASETTE_CAPTURE_CANCELLED');
      const value = Buffer.from(chunk);
      total += value.length;
      if (total > MAX_PAGE) throw fault('DATASETTE_PAGE_BYTE_LIMIT');
      hash.update(value); await handle.writeFile(value);
    }
    await handle.sync(); await handle.close(); handle = null;
    await syncDirectory(join(directory, 'attempts'));
    attempt.completedAt = stamp(); attempt.state = 'COMPLETE';
    attempt.body = { file: bodyFile, sha256: hash.digest('hex'), bytes: total, complete: true,
      encoding: 'fetch-decoded-response-body', contentEncoding: header(attempt.headers, 'content-encoding') };
    // This durable COMPLETE marker is written before the cursor receipt. Recovery
    // adopts this original response even if the process dies before page commit.
    await atomicJson(join(directory, 'attempts'), id + '.json', attempt);
    return attempt;
  } catch (issue) {
    if (handle) { try { await handle.sync(); } finally { await handle.close(); } }
    attempt.state = 'INCOMPLETE'; attempt.interruptedAt = stamp();
    attempt.error = typeof issue.code === 'string' ? issue.code : controller.signal.aborted ? 'DATASETTE_CAPTURE_CANCELLED' : 'DATASETTE_REQUEST_FAILED';
    if (await exists(join(directory, bodyFile))) {
      const partial = await readPrivate(join(directory, bodyFile), MAX_PAGE);
      attempt.body = { file: bodyFile, sha256: digest(partial), bytes: partial.length, complete: false };
    }
    await atomicJson(join(directory, 'attempts'), id + '.json', attempt);
    throw issue;
  } finally {
    clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
  }
}

export async function captureDatasette(options) {
  const directory = resolve(options.directory);
  await privateDirectory(directory, true);
  const release = await acquireWorkspace(directory);
  try {
    const operation = await initialize(directory, options.operationId, options.selection);
    if (await exists(join(directory, 'capture.json'))) {
      const result = await readDatasetteCapture(join(directory, 'capture.json'));
      return { state: 'COMPLETE', directory, operationId: operation.operationId, ...result,
        rowCount: result.capture.rowCount, pageCount: result.capture.pageCount, nextUrl: null };
    }
    const state = await pageState(directory, operation);
    const pageLimit = options.pageLimit ?? Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(pageLimit) || pageLimit < 1) throw fault('DATASETTE_PAGE_LIMIT_INVALID');
    let fetched = 0;
    while (state.next) {
      const adopted = (await completeAttempts(directory, state, operation.selection))[0];
      if (adopted) { await commitAttempt(directory, operation, state, adopted); continue; }
      if (fetched >= pageLimit) break;
      if (options.signal?.aborted) throw fault('DATASETTE_CAPTURE_CANCELLED');
      const attempt = await fetchAttempt(directory, operation, state, options);
      await commitAttempt(directory, operation, state, attempt); fetched++;
      await status(directory, operation, state);
    }
    return finish(directory, operation, state);
  } finally { await release(); }
}

function importedBytes(page) {
  if (typeof page.body === 'string') {
    if (page.bodyEncoding && !['utf8', 'utf-8', 'base64'].includes(page.bodyEncoding))
      throw fault('DATASETTE_IMPORTED_BODY_ENCODING');
    return Buffer.from(page.body, page.bodyEncoding === 'base64' ? 'base64' : 'utf8');
  }
  if (page.body instanceof Uint8Array) return Buffer.from(page.body);
  throw fault('DATASETTE_IMPORTED_RAW_BODY_REQUIRED', 'Adopt the original HTTP body bytes, not a parsed or re-serialized page.');
}
export async function adoptDatasettePages({ directory, operationId, selection, pages }) {
  directory = resolve(directory);
  if (!Array.isArray(pages)) throw fault('DATASETTE_IMPORTED_PAGES_REQUIRED');
  await privateDirectory(directory, true);
  const release = await acquireWorkspace(directory);
  try {
    const operation = await initialize(directory, operationId, selection);
    const state = await pageState(directory, operation);
    for (const input of pages) {
      const providerReceipt = input.providerReceipt ?? input.provider_receipt ?? null;
      const original = {
        ...input, requestedUrl: input.requestedUrl ?? input.requested_url,
        responseUrl: input.responseUrl ?? input.final_url, status: input.status ?? null,
        startedAt: input.startedAt ?? input.started_at ?? null, completedAt: input.completedAt ?? input.completed_at ?? null,
        retrievedAt: input.retrievedAt ?? input.retrieved_at ?? null,
        retrievalWindow: input.retrievalWindow ?? input.retrieval_window ?? providerReceipt?.retrieval_window ?? null,
        responseUrlBasis: input.responseUrlBasis ?? input.final_url_basis ?? null,
        providerReceipt, originalReceipt: input.originalReceipt ?? null,
      };
      const body = importedBytes(original);
      if (body.length > MAX_PAGE) throw fault('DATASETTE_PAGE_BYTE_LIMIT');
      if (original.sha256 && original.sha256 !== digest(body)) throw fault('DATASETTE_IMPORTED_BODY_HASH_MISMATCH');
      const retained = state.pages.find(page => sameRequest(page.requestedUrl, original.requestedUrl, operation.selection));
      if (retained) {
        const incomingHeaders = retainHeaders(original.headers);
        if (retained.body.sha256 !== digest(body) || retained.requestedUrl !== original.requestedUrl ||
            retained.responseUrl !== original.responseUrl || retained.status !== original.status ||
            (retained.startedAt ?? null) !== original.startedAt || (retained.completedAt ?? null) !== original.completedAt ||
            (retained.retrievedAt ?? null) !== original.retrievedAt ||
            !same(retained.retrievalWindow ?? null, original.retrievalWindow) ||
            !same(retained.providerReceipt ?? null, original.providerReceipt) ||
            !same(retained.headers, incomingHeaders.headers) || !same(retained.redirects, original.redirects ?? []))
          throw fault('DATASETTE_ORIGINAL_PAGE_CONFLICT');
        continue;
      }
      if (!state.next || !sameRequest(original.requestedUrl, state.next.url, operation.selection))
        throw fault('DATASETTE_IMPORTED_PAGE_OUT_OF_ORDER');
      const pending = (await completeAttempts(directory, state, operation.selection))[0];
      if (pending) {
        if (pending.body.sha256 !== digest(body)) throw fault('DATASETTE_ORIGINAL_PAGE_CONFLICT');
        await commitAttempt(directory, operation, state, pending); continue;
      }
      const id = identity({ operationId, index: state.pages.length + 1, requestedUrl: original.requestedUrl,
        bodySha256: digest(body), startedAt: original.startedAt, completedAt: original.completedAt,
        retrievedAt: original.retrievedAt, retrievalWindow: original.retrievalWindow, providerReceipt });
      const file = 'attempts/import-' + id + '.json';
      const bodyReceipt = await immutableFile(directory, 'attempts/import-' + id + '.body', body);
      const attempt = { schema: 'stellar-forge.datasette-response-attempt.v1', file,
        operationId, selectionHash: operation.selectionHash, state: 'COMPLETE', index: state.pages.length + 1,
        requestedUrl: original.requestedUrl, responseUrl: original.responseUrl, status: original.status,
        ...retainHeaders(original.headers), redirects: original.redirects ?? [],
        startedAt: original.startedAt, completedAt: original.completedAt, retrievedAt: original.retrievedAt,
        retrievalWindow: original.retrievalWindow, providerReceipt,
        originalReceipt: original.originalReceipt, responseUrlBasis: original.responseUrlBasis,
        recovery: original.recovery ?? null,
        acquisition: providerImportComplete(original) ? 'adopted-provider-file-import' : 'adopted-original-http-response',
        importedAt: stamp(),
        body: { ...bodyReceipt, complete: true, encoding: original.bodyRepresentation ?? 'retained-source-response-body' } };
      validateResponseMetadata(attempt, operation.selection);
      await immutableFile(directory, file, bytes(attempt));
      await commitAttempt(directory, operation, state, attempt);
    }
    if (await exists(join(directory, 'capture.json'))) {
      const result = await readDatasetteCapture(join(directory, 'capture.json'));
      return { state: 'COMPLETE', directory, operationId, ...result,
        rowCount: result.capture.rowCount, pageCount: result.capture.pageCount, nextUrl: null };
    }
    return finish(directory, operation, state);
  } finally { await release(); }
}

export async function readDatasetteCapture(captureFile, { expectedSha256 } = {}) {
  captureFile = resolve(captureFile);
  const directory = dirname(captureFile); await privateDirectory(directory);
  const original = await readPrivate(captureFile, MAX_META), captureSha256 = digest(original);
  if (expectedSha256 !== undefined && expectedSha256 !== captureSha256) throw fault('DATASETTE_CAPTURE_CHANGED');
  const capture = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(original));
  if (capture.schema !== CAPTURE || capture.state !== 'COMPLETE' || !Array.isArray(capture.files) ||
      !capture.files.length || capture.files.length > 20000) throw fault('DATASETTE_CAPTURE_INVALID');
  const declared = new Map(); let total = 0;
  for (const item of capture.files) {
    const name = datasetteMember(item.file);
    if (name === 'capture.json' || declared.has(name) || !HASH.test(item.sha256 ?? '') ||
        !Number.isSafeInteger(item.bytes) || item.bytes < 0 || item.bytes > MAX_PAGE) throw fault('DATASETTE_CAPTURE_FILES_INVALID');
    await privateDirectory(dirname(join(directory, name)));
    const content = await readPrivate(join(directory, name), MAX_PAGE);
    if (content.length !== item.bytes || digest(content) !== item.sha256) throw fault('DATASETTE_CAPTURE_MEMBER_CHANGED', name);
    total += content.length; if (total > MAX_TOTAL * 2) throw fault('DATASETTE_CAPTURE_LIMIT_EXCEEDED');
    declared.set(name, item);
  }
  if (!declared.has('operation.json')) throw fault('DATASETTE_OPERATION_MISSING');
  const operation = await readJson(join(directory, 'operation.json'), MAX_META);
  if (operation.schema !== OPERATION || operation.operationId !== capture.operationId ||
      operation.selectionHash !== identity(normalizeDatasetteSelection(operation.selection)) || operation.selectionHash !== capture.selectionHash ||
      !same(operation.selection, capture.selection)) throw fault('DATASETTE_CAPTURE_SELECTION_CHANGED');
  const state = await pageState(directory, operation);
  if (state.next || !state.pages.length || state.pages.length !== capture.pageCount ||
      state.rows.length !== capture.rowCount || !same(state.columns, capture.columns) ||
      !same(state.pages, capture.pages) || capture.startedAt !== (state.pages[0].startedAt ?? null) ||
      capture.completedAt !== (state.pages.at(-1).completedAt ?? null) ||
      (capture.observationWindow && !same(capture.observationWindow, observedWindow(state.pages))) || !same(capture.sourceVersion, state.sourceVersion ?? null) ||
      capture.consistency?.kind !== (state.immutableIdentity ? 'immutable-database' : 'observation-window') ||
      (state.immutableIdentity && !same(capture.consistency.identity, state.immutableIdentity)) || state.pages.some(page =>
        !declared.has('pages/' + pageName(page.index)) || !declared.has(page.body.file) ||
        !declared.has(page.attemptFile))) throw fault('DATASETTE_CAPTURE_CHAIN_CHANGED');
  return { captureFile, captureSha256, hash: captureSha256, capture,
    columns: state.columns, rows: state.rows, pages: state.pages };
}
export async function inspectDatasetteOperation(directory) {
  directory = resolve(directory); await privateDirectory(directory);
  if (await exists(join(directory, 'capture.json'))) {
    const result = await readDatasetteCapture(join(directory, 'capture.json'));
    return { state: 'COMPLETE', operationId: result.capture.operationId, captureFile: result.captureFile,
      captureSha256: result.captureSha256, rowCount: result.rows.length, pageCount: result.pages.length,
      columns: result.columns, nextUrl: null, selection: result.capture.selection };
  }
  const operation = await readJson(join(directory, 'operation.json'), MAX_META);
  const state = await pageState(directory, operation);
  return { state: 'INCOMPLETE', operationId: operation.operationId, selection: operation.selection,
    rowCount: state.rows.length, pageCount: state.pages.length, columns: state.columns, nextUrl: state.next?.url ?? null };
}
export async function retainDatasetteCapture(captureFile, target, expectedSha256) {
  const selected = await readDatasetteCapture(captureFile, { expectedSha256 });
  target = resolve(target); await privateDirectory(target, true);
  for (const item of selected.capture.files) {
    const raw = await readPrivate(join(dirname(captureFile), datasetteMember(item.file)), MAX_PAGE);
    await immutableFile(target, item.file, raw);
  }
  await immutableFile(target, 'capture.json', await readPrivate(captureFile, MAX_META));
  return readDatasetteCapture(join(target, 'capture.json'), { expectedSha256: selected.captureSha256 });
}
