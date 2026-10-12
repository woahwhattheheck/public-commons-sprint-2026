// SPDX-License-Identifier: MIT
// Retained Atlas observations and requests. The original SF88 modules own
// catalog validation, offer preparation and operation handoff semantics.
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, lstat, realpath, readdir, rename, link, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { lockPrivateDirectory } from '../sf88-operator-buyer-cli/private-directory-lock.mjs';
import { prepareReview } from '../sf88-operator-buyer-cli/prepare.mjs';
import { acquireCatalog } from '../sf88-operator-buyer-cli/catalog-session.mjs';
import { createOperationHandoff } from '../sf88-operator-buyer-cli/operation-handoff.mjs';
import { MAX_REQUEST_BODY_BYTES, requestBodyPin } from '../sf88-operator-buyer-cli/request-body.mjs';
import { parseOperationTicketBytes, operationTicketView } from '../sf88-operator-buyer-cli/operation-ticket.mjs';
import { InputError, need } from '../sf88-operator-buyer-cli/config.mjs';

export const ATLAS_WORKSPACE_SCHEMA = 'stellar-forge.sf61.workspace.v1';
const CATALOG_SCHEMA = 'stellar-forge.sf88.catalog-acquisition.v1';
const PAGE_BYTES = 1048576, MANIFEST_BYTES = 8 * 1048576;
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const copy = value => structuredClone(value);
const now = () => new Date().toISOString();
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const idOK = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(value);
const pageOK = value => typeof value === 'string' && /^page-[0-9]{6}\.json$/.test(value);
const digestOK = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  return plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
}
const identity = value => hash(Buffer.from(JSON.stringify(canonical(value))));
function decode(bytes, code = 'ATLAS_JSON_INVALID') {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new InputError(code); }
}
function textBytes(text, limit, code) {
  need(typeof text === 'string', code);
  const bytes = Buffer.from(text, 'utf8');
  need(bytes.length <= limit, code);
  return bytes;
}
function relative(value) {
  need(typeof value === 'string' && value.length <= 1024 && !value.includes('\\') &&
    !value.includes('\0') && !isAbsolute(value) && value.split('/').every(part => part && part !== '.' && part !== '..'),
  'ATLAS_RELATIVE_PATH_INVALID');
  return value;
}
function label(value) {
  need(typeof value === 'string' && value.trim().length > 0 && value.length <= 240 && !/[\x00-\x1f\x7f]/.test(value), 'ATLAS_NAME_REQUIRED');
  return value.trim();
}
function rowsOf(page) {
  let rows;
  if (page?.mode === 'ORIGINAL_UNSIGNED_CATALOG') {
    need(['resources', 'items'].includes(page.sourceEnvelope) && typeof page.source === 'string' &&
      !Object.hasOwn(page, 'items') && !Object.hasOwn(page, 'resources'), 'ATLAS_SOURCE_PAGE_INVALID');
    rows = page.originalListings;
  } else if (page?.schema === 'scf61-observed-native-page-v1') {
    need(page.readOnly === true && page.paidOrSettled === false, 'ATLAS_SOURCE_PAGE_INVALID');
    rows = page.nativeProviderRows;
  } else {
    need(plain(page) && Object.hasOwn(page, 'resources') !== Object.hasOwn(page, 'items') &&
      !Object.hasOwn(page, 'originalListings'), 'ATLAS_SOURCE_PAGE_INVALID');
    rows = page.resources ?? page.items;
  }
  need(Array.isArray(rows) && rows.every(plain), 'ATLAS_SOURCE_PAGE_INVALID');
  return rows;
}
function captureInputs(sessionText, manifestText) {
  const sessionBytes = textBytes(sessionText, PAGE_BYTES, 'ATLAS_SESSION_TOO_LARGE');
  const manifestBytes = textBytes(manifestText, MANIFEST_BYTES, 'ATLAS_MANIFEST_TOO_LARGE');
  const session = decode(sessionBytes), manifest = decode(manifestBytes);
  need(session?.schema === CATALOG_SCHEMA && manifest?.schema === CATALOG_SCHEMA &&
    plain(session.request) && typeof session.allPages === 'boolean' &&
    Array.isArray(manifest.pages) && manifest.pages.length <= 10000 && digestOK(manifest.requestSha256),
  'ATLAS_NATIVE_CAPTURE_REQUIRED');
  for (const [i, page] of manifest.pages.entries()) {
    need(page?.file === `page-${String(i).padStart(6, '0')}.json` && digestOK(page.sha256) &&
      Number.isSafeInteger(page.rows) && page.rows >= 0 && Number.isSafeInteger(page.offset) && page.offset >= 0,
    'ATLAS_NATIVE_MANIFEST_INVALID');
  }
  return { session, manifest, sessionBytes, manifestBytes };
}
async function lock(root) {
  return lockPrivateDirectory({ directory: root, filename: '.atlas-writer.lock', namespace: 'sf61-atlas',
    busyCode: 'ATLAS_WORKSPACE_ALREADY_OPEN', unavailableCode: 'ATLAS_WORKSPACE_LOCK_UNAVAILABLE' });
}

/** A host-selected, private local workspace. Browser inputs never select files
 * to read from outside this directory. Reopening imports no executable code. */
export async function openAtlasWorkspace({ directory, create = true }) {
  need(typeof directory === 'string' && isAbsolute(directory) && resolve(directory) === directory &&
    !directory.includes('\0') && typeof create === 'boolean', 'ATLAS_ABSOLUTE_DIRECTORY_REQUIRED');
  if (create) await mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const rootInfo = await lstat(directory);
  need(rootInfo.isDirectory() && !rootInfo.isSymbolicLink() && await realpath(directory) === directory &&
    (process.platform === 'win32' || (rootInfo.mode & 0o077) === 0 && rootInfo.uid === process.getuid()), 'ATLAS_PRIVATE_DIRECTORY_REQUIRED');
  const release = await lock(directory);
  let closed = false, queue = Promise.resolve();
  const path = rel => join(directory, relative(rel));
  async function sync(dir) {
    if (process.platform === 'win32') return;
    const file = await open(dir, constants.O_RDONLY);
    try { await file.sync(); } finally { await file.close(); }
  }
  async function ensureDir(rel) {
    let current = directory;
    for (const part of relative(rel).split('/')) {
      current = join(current, part);
      await mkdir(current, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
      const info = await lstat(current);
      need(info.isDirectory() && !info.isSymbolicLink() &&
        (process.platform === 'win32' || (info.mode & 0o077) === 0 && info.uid === process.getuid()), 'ATLAS_PRIVATE_DIRECTORY_REQUIRED');
    }
  }
  async function read(rel, limit = MANIFEST_BYTES, optional = false) {
    let file;
    try {
      const filename = path(rel);
      need(await realpath(filename) === filename, 'ATLAS_FILE_SYMLINK_REFUSED');
      file = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const info = await file.stat();
      need(info.isFile() && info.size <= limit &&
        (process.platform === 'win32' || (info.mode & 0o077) === 0 && info.uid === process.getuid()), 'ATLAS_PRIVATE_FILE_REQUIRED');
      const bytes = await file.readFile();
      need(bytes.length <= limit, 'ATLAS_FILE_TOO_LARGE');
      return bytes;
    } catch (error) {
      if (optional && error.code === 'ENOENT') return null;
      throw error;
    } finally { await file?.close(); }
  }
  async function write(rel, bytes, exclusive = false) {
    bytes = Buffer.from(bytes);
    const destination = path(rel), parent = dirname(destination);
    need(await realpath(parent) === parent, 'ATLAS_PARENT_SYMLINK_REFUSED');
    if (exclusive) {
      const prior = await read(rel, Math.max(bytes.length, 1), true);
      if (prior) { need(prior.equals(bytes), 'ATLAS_RETAINED_FILE_CONFLICT'); return; }
    }
    const temporary = join(parent, `.atlas-write-${randomUUID()}`);
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(bytes); await file.sync(); await file.close();
      if (exclusive) {
        try { await link(temporary, destination); }
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          need((await read(rel, Math.max(bytes.length, 1))).equals(bytes), 'ATLAS_RETAINED_FILE_CONFLICT');
        }
      } else await rename(temporary, destination);
      await sync(parent);
    } finally {
      await file.close().catch(() => {});
      await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  async function state() {
    const result = decode(await read('workspace.json'));
    need(result?.schema === ATLAS_WORKSPACE_SCHEMA && idOK(result.id) &&
      plain(result.captures) && plain(result.selections) &&
      Object.keys(result.captures).every(idOK) && Object.keys(result.selections).every(idOK), 'ATLAS_WORKSPACE_INVALID');
    return result;
  }
  const mutate = fn => {
    need(!closed, 'ATLAS_WORKSPACE_CLOSED');
    const pending = queue.then(fn);
    queue = pending.catch(() => {});
    return pending;
  };
  const saveState = async value => { value.updatedAt = now(); await write('workspace.json', json(value)); };
  async function entry(captureId, current) {
    need(idOK(captureId), 'ATLAS_CAPTURE_ID_INVALID');
    const item = (current ?? await state()).captures[captureId];
    need(item && item.id === captureId, 'ATLAS_CAPTURE_NOT_FOUND');
    return item;
  }
  async function sourcePage(item, file) {
    need(pageOK(file), 'ATLAS_PAGE_NAME_INVALID');
    const page = item.files.find(page => page.file === file);
    need(page, 'ATLAS_CAPTURE_PAGE_NOT_FOUND');
    const bytes = await read(`captures/${item.id}/native/${file}`, PAGE_BYTES);
    need(hash(bytes) === page.sha256, 'ATLAS_SOURCE_PAGE_CHANGED');
    const value = decode(bytes), rows = rowsOf(value);
    need(rows.length === page.rows, 'ATLAS_SOURCE_ROW_COUNT_CHANGED');
    return { bytes, value, rows };
  }
  async function record(selectionId, current) {
    need(idOK(selectionId), 'ATLAS_SELECTION_ID_INVALID');
    const info = (current ?? await state()).selections[selectionId];
    need(info && Number.isSafeInteger(info.revision) && info.revision >= 0, 'ATLAS_SELECTION_NOT_FOUND');
    const selectedPath = info.path ?? `selections/${selectionId}/versions/${String(info.revision).padStart(6, '0')}/record.json`;
    need(selectedPath.startsWith(`selections/${selectionId}/versions/`) && selectedPath.endsWith('/record.json'), 'ATLAS_SELECTION_RECORD_PATH_INVALID');
    const value = decode(await read(selectedPath));
    need(value.id === selectionId && value.revision === info.revision && digestOK(info.sha256) &&
      hash(json(value)) === info.sha256, 'ATLAS_SELECTION_RECORD_CHANGED');
    return value;
  }
  async function inputBytes(input, limit) {
    if (!input) return null;
    const bytes = await read(input.path, limit);
    need(bytes.length === input.bytes && hash(bytes) === input.sha256, 'ATLAS_REQUEST_INPUT_CHANGED');
    return bytes;
  }
  async function prepared(value) {
    const item = await entry(value.captureId), page = await sourcePage(item, value.pageFile);
    need(page.rows[value.row] && page.rows[value.row].accepts?.[value.accept], 'ATLAS_SELECTION_SOURCE_CHANGED');
    const body = await inputBytes(value.inputs?.body, MAX_REQUEST_BODY_BYTES);
    const ticket = await inputBytes(value.inputs?.ticket, 16384);
    const request = copy(value.request);
    const result = prepareReview(page.bytes, { ...request, rowIndex: value.row, acceptIndex: value.accept,
      ...(body === null ? {} : { bodyFile: path(value.inputs.body.path), ...requestBodyPin(body) }),
      ...(ticket === null ? {} : { ticketFile: path(value.inputs.ticket.path) }) });
    let ticketView = null;
    if (ticket !== null) ticketView = operationTicketView(parseOperationTicketBytes(ticket, result.draft.operation, { requireCurrent: false }));
    return { ...result, body, ticket, ticketView, discovery: page.bytes };
  }
  async function selectionView(value) {
    const item = await entry(value.captureId), page = await sourcePage(item, value.pageFile);
    const listing = page.rows[value.row];
    need(listing?.accepts?.[value.accept], 'ATLAS_SELECTION_SOURCE_CHANGED');
    const view = { ...copy(value), selectionId: value.id, listing, acceptedTerms: copy(listing.accepts[value.accept]),
      resource: typeof listing.resource === 'string' ? listing.resource : listing.resource?.url,
      inputs: { bodyPresent: Boolean(value.inputs?.body), bodyBytes: value.inputs?.body?.bytes ?? 0,
        bodySha256: value.inputs?.body?.sha256 ?? null, ticketPresent: Boolean(value.inputs?.ticket) } };
    if (value.request) {
      const native = await prepared(value);
      view.prepared = { config: native.draft, configText: native.data.toString('utf8'), configSha256: native.configSha256,
        sourceFileSha256: native.draft.preparedFrom.discoveryFileSha256, ticket: native.ticketView,
        originalConfigSha256: value.prepared?.sha256 ?? null,
        configPath: value.prepared && native.configSha256 === value.prepared.sha256 ? path(value.prepared.path) : null };
    }
    if (value.handoff) {
      const bytes = await read(value.handoff.path, 4 * Math.ceil(MAX_REQUEST_BODY_BYTES / 3) + 2 * 1048576);
      need(hash(bytes) === value.handoff.sha256, 'ATLAS_HANDOFF_CHANGED');
      view.handoff = { ...value.handoff, path: path(value.handoff.path), value: decode(bytes), text: bytes.toString('utf8') };
    }
    delete view.inputSha256;
    return view;
  }
  async function version(current, prior, action, input) {
    const digest = identity({ action, input });
    if (prior.revision === input.revision + 1 && prior.parentRevision === input.revision && prior.inputSha256 === digest)
      return { replay: prior };
    need(prior.revision === input.revision, 'ATLAS_SELECTION_REVISION_CHANGED');
    // Each attempted input owns immutable files. A corrected draft can use the
    // same visible parent revision after a validation or I/O failure without
    // overwriting the failed attempt or stranding the selected offer.
    const number = prior.revision + 1, root = `selections/${prior.id}/versions/${String(number).padStart(6, '0')}-${digest.slice(0, 20)}`;
    await ensureDir(root);
    const existing = await read(`${root}/operation.json`, PAGE_BYTES, true);
    const operation = existing ? decode(existing) : { action, inputSha256: digest, createdAt: now() };
    need(operation.action === action && operation.inputSha256 === digest, 'ATLAS_PENDING_REVISION_CONFLICT');
    if (!existing) await write(`${root}/operation.json`, json(operation), true);
    const completed = await read(`${root}/record.json`, MANIFEST_BYTES, true);
    if (completed) {
      const recovered = decode(completed);
      need(recovered.inputSha256 === digest && recovered.id === prior.id && recovered.revision === number, 'ATLAS_PENDING_REVISION_CONFLICT');
      current.selections[prior.id] = { revision: number, path: `${root}/record.json`, sha256: hash(completed) };
      await saveState(current);
      return { replay: recovered };
    }
    return { root, value: { ...copy(prior), revision: number, parentRevision: prior.revision,
      action, inputSha256: digest, updatedAt: operation.createdAt } };
  }
  async function commit(current, root, value) {
    const bytes = json(value);
    await write(`${root}/record.json`, bytes, true);
    current.selections[value.id] = { revision: value.revision, path: `${root}/record.json`, sha256: hash(bytes) };
    await saveState(current);
    return selectionView(value);
  }
  try {
    const existing = await read('workspace.json', MANIFEST_BYTES, true);
    if (!existing) {
      need(create, 'ATLAS_WORKSPACE_NOT_INITIALIZED');
      const other = (await readdir(directory)).filter(name => !name.startsWith('.atlas-'));
      need(other.length === 0, 'ATLAS_WORKSPACE_DIRECTORY_NOT_EMPTY');
      await write('workspace.json', json({ schema: ATLAS_WORKSPACE_SCHEMA, id: randomUUID(), createdAt: now(),
        originalDirectory: directory, captures: {}, selections: {} }), true);
    }
    await state();
  } catch (error) { await release(); throw error; }

  const api = {
    directory,
    async summary() {
      need(!closed, 'ATLAS_WORKSPACE_CLOSED');
      await queue;
      const current = await state(), selections = [];
      for (const id of Object.keys(current.selections)) {
        const item = await record(id, current);
        selections.push({ id, selectionId: id, label: item.label, revision: item.revision, stage: item.stage,
          captureId: item.captureId, resource: item.resource, intentId: item.request?.intentId ?? null, updatedAt: item.updatedAt });
      }
      return { schema: ATLAS_WORKSPACE_SCHEMA, id: current.id, directory, createdAt: current.createdAt,
        relocated: current.originalDirectory !== directory,
        captures: Object.values(current.captures).map(({ files, ...item }) => ({ ...item, pages: files.length })), selections };
    },
    beginCapture(input) { return mutate(async () => {
      const name = label(input.name), parsed = captureInputs(input.sessionText, input.manifestText);
      const id = `capture-${hash(Buffer.concat([parsed.sessionBytes, Buffer.from([0]), parsed.manifestBytes])).slice(0, 40)}`;
      const current = await state(), previous = current.captures[id];
      await ensureDir(`captures/${id}/native`);
      await write(`captures/${id}/source-session.json`, parsed.sessionBytes, true);
      await write(`captures/${id}/source-manifest.json`, parsed.manifestBytes, true);
      await write(`captures/${id}/native/session.json`, parsed.sessionBytes, true);
      if (!previous) {
        current.captures[id] = { id, captureId: id, name, kind: 'NATIVE_CAPTURE', status: 'RECEIVING',
          originalStatus: parsed.manifest.status, source: parsed.session.request.origin,
          rows: parsed.manifest.pages.reduce((n, page) => n + page.rows, 0),
          files: copy(parsed.manifest.pages), sessionSha256: hash(parsed.sessionBytes), manifestSha256: hash(parsed.manifestBytes),
          updatedAt: now(), receivedAt: now() };
        await saveState(current);
      }
      const missingPages = [];
      for (const file of parsed.manifest.pages) {
        const saved = await read(`captures/${id}/native/${file.file}`, PAGE_BYTES, true);
        if (!saved) missingPages.push(file.file);
        else need(hash(saved) === file.sha256, 'ATLAS_SOURCE_PAGE_CHANGED');
      }
      return { captureId: id, id, status: current.captures[id].status, missingPages, pages: parsed.manifest.pages.length };
    }); },
    putCapturePage({ captureId, file, text }) { return mutate(async () => {
      const item = await entry(captureId);
      need(item.kind === 'NATIVE_CAPTURE' && pageOK(file), 'ATLAS_NATIVE_PAGE_REQUIRED');
      const expected = item.files.find(page => page.file === file);
      need(expected, 'ATLAS_CAPTURE_PAGE_NOT_FOUND');
      const bytes = textBytes(text, PAGE_BYTES, 'ATLAS_PAGE_TOO_LARGE');
      need(hash(bytes) === expected.sha256 && rowsOf(decode(bytes)).length === expected.rows, 'ATLAS_SOURCE_PAGE_CHANGED');
      await write(`captures/${captureId}/native/${file}`, bytes, true);
      return { captureId, file, sha256: expected.sha256, status: 'RECEIVED' };
    }); },
    finishCapture({ captureId }) { return mutate(async () => {
      const current = await state(), item = await entry(captureId, current);
      if (item.status === 'READY') return { ...item, captureId, pages: item.files.length };
      need(item.kind === 'NATIVE_CAPTURE' && item.files.length > 0, 'ATLAS_CAPTURE_HAS_NO_PAGES');
      const sessionBytes = await read(`captures/${captureId}/source-session.json`, PAGE_BYTES);
      const manifestBytes = await read(`captures/${captureId}/source-manifest.json`, MANIFEST_BYTES);
      need(hash(sessionBytes) === item.sessionSha256 && hash(manifestBytes) === item.manifestSha256, 'ATLAS_CAPTURE_SOURCE_CHANGED');
      const { session, manifest } = captureInputs(sessionBytes.toString('utf8'), manifestBytes.toString('utf8'));
      for (const file of item.files) await sourcePage(item, file.file);
      // The native engine checks query identity, pagination, chain and original
      // page hashes. Its request seam cannot acquire any additional page here.
      const nativeManifest = `captures/${captureId}/native/manifest.json`;
      if (!await read(nativeManifest, MANIFEST_BYTES, true)) await write(nativeManifest, manifestBytes, true);
      const result = await acquireCatalog({ captureDir: path(`captures/${captureId}/native`), request: session.request,
        allPages: session.allPages, maxPages: item.files.length, proxy: null },
      async () => { throw new InputError('ATLAS_IMPORT_CANNOT_FETCH_SOURCE'); });
      need(result.pages === item.files.length && result.observedRows === item.rows, 'ATLAS_CAPTURE_IMPORT_MISMATCH');
      item.status = 'READY'; item.nativeStatus = result.status; item.reportedTotal = manifest.total;
      item.updatedAt = now(); await saveState(current);
      return { ...item, captureId, pages: item.files.length };
    }); },
    receivePage({ name, pageText }) { return mutate(async () => {
      name = label(name);
      const bytes = textBytes(pageText, PAGE_BYTES, 'ATLAS_PAGE_TOO_LARGE'), value = decode(bytes), rows = rowsOf(value);
      const digest = hash(bytes), id = `page-${digest.slice(0, 40)}`, current = await state();
      if (!current.captures[id]) {
        await ensureDir(`captures/${id}/native`);
        await write(`captures/${id}/native/page-000000.json`, bytes, true);
        current.captures[id] = { id, captureId: id, name, kind: 'SINGLE_PAGE', status: 'READY', nativeStatus: 'SINGLE_PAGE',
          source: value.source ?? value.sourceUrl ?? null, rows: rows.length, reportedTotal: value.pagination?.total ?? null,
          observedAt: value.observedAt ?? value.capture?.capturedAt ?? null, receivedAt: now(), updatedAt: now(),
          files: [{ file: 'page-000000.json', sha256: digest, rows: rows.length, offset: value.pagination?.offset ?? null }] };
        await saveState(current);
      }
      return { ...current.captures[id], captureId: id, pages: 1 };
    }); },
    async capture({ captureId, query = '', page = 0, pageSize = 50 }) {
      need(!closed, 'ATLAS_WORKSPACE_CLOSED'); await queue;
      need(typeof query === 'string' && query.length <= 512 && Number.isSafeInteger(page) && page >= 0 &&
        Number.isSafeInteger(pageSize) && pageSize >= 1 && pageSize <= 200, 'ATLAS_QUERY_INVALID');
      const item = await entry(captureId), matches = [], start = page * pageSize;
      need(Number.isSafeInteger(start), 'ATLAS_QUERY_INVALID');
      let total = 0;
      const tokens = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
      for (const file of item.files) {
        const saved = await read(`captures/${captureId}/native/${file.file}`, PAGE_BYTES, true);
        if (!saved && item.status === 'RECEIVING') continue;
        need(saved && hash(saved) === file.sha256, 'ATLAS_SOURCE_PAGE_CHANGED');
        for (const [row, listing] of rowsOf(decode(saved)).entries()) {
          const searchable = JSON.stringify(listing).toLocaleLowerCase();
          if (!tokens.every(token => searchable.includes(token))) continue;
          if (total >= start && matches.length < pageSize) matches.push({ pageFile: file.file, row, listing });
          total++;
        }
      }
      return { capture: { ...item, pages: item.files.length }, offers: matches,
        pagination: { page, pageSize, total, nextPage: start + matches.length < total ? page + 1 : null } };
    },
    saveSelection(input) { return mutate(async () => {
      const current = await state(), item = await entry(input.captureId, current);
      const page = await sourcePage(item, input.pageFile);
      need(Number.isSafeInteger(input.row) && input.row >= 0 && Number.isSafeInteger(input.accept) && input.accept >= 0 &&
        plain(page.rows[input.row]?.accepts?.[input.accept]), 'ATLAS_EXPLICIT_OFFER_REQUIRED');
      const name = label(input.label), binding = { captureId: item.id, pageFile: input.pageFile, row: input.row, accept: input.accept, label: name };
      const id = input.selectionId ?? `selection-${identity(binding).slice(0, 36)}`;
      need(idOK(id), 'ATLAS_SELECTION_ID_INVALID');
      if (current.selections[id]) {
        const existing = await record(id, current);
        need(identity(Object.fromEntries(Object.keys(binding).map(key => [key, existing[key]]))) === identity(binding), 'ATLAS_SELECTION_ID_CONFLICT');
        return selectionView(existing);
      }
      const root = `selections/${id}/versions/000000`; await ensureDir(root);
      const old = await read(`${root}/record.json`, MANIFEST_BYTES, true);
      const listing = page.rows[input.row], resource = typeof listing.resource === 'string' ? listing.resource : listing.resource?.url;
      const value = old ? decode(old) : { id, ...binding, resource, revision: 0, stage: 'SELECTED',
        updatedAt: now(), request: null, inputs: { body: null, ticket: null }, prepared: null, handoff: null };
      need(identity(Object.fromEntries(Object.keys(binding).map(key => [key, value[key]]))) === identity(binding), 'ATLAS_SELECTION_ID_CONFLICT');
      return commit(current, root, value);
    }); },
    async selection({ selectionId }) { need(!closed, 'ATLAS_WORKSPACE_CLOSED'); await queue; return selectionView(await record(selectionId)); },
    prepareSelection(input) { return mutate(async () => {
      need(plain(input.request) && Object.keys(input.request).every(key =>
        ['intentId', 'url', 'method', 'headers', 'responseOut', 'ticketHeader'].includes(key)), 'ATLAS_EXPLICIT_REQUEST_REQUIRED');
      need(Number.isSafeInteger(input.revision) && input.revision >= 0, 'ATLAS_SELECTION_REVISION_REQUIRED');
      for (const key of ['bodyText', 'ticketText']) need(input[key] === undefined || input[key] === null || typeof input[key] === 'string', 'ATLAS_REQUEST_INPUT_INVALID');
      const current = await state(), prior = await record(input.selectionId, current), stage = await version(current, prior, 'prepare', input);
      if (stage.replay) return selectionView(stage.replay);
      const { root, value } = stage;
      value.request = copy(input.request); value.inputs = { body: null, ticket: null }; value.handoff = null;
      for (const [kind, field, limit, name] of [['body', 'bodyText', MAX_REQUEST_BODY_BYTES, 'request.body'], ['ticket', 'ticketText', 16384, 'operation-ticket.json']]) {
        const bytes = input[field] === undefined ? await inputBytes(prior.inputs?.[kind], limit)
          : input[field] === null ? null : textBytes(input[field], limit, 'ATLAS_REQUEST_INPUT_TOO_LARGE');
        if (bytes !== null) {
          const rel = `${root}/${name}`; await write(rel, bytes, true);
          value.inputs[kind] = { path: rel, bytes: bytes.length, sha256: hash(bytes) };
        }
      }
      if (!value.inputs.ticket) delete value.request.ticketHeader;
      const native = await prepared(value);
      if (native.ticket) parseOperationTicketBytes(native.ticket, native.draft.operation, { requireCurrent: true });
      const rel = `${root}/review.json`; await write(rel, native.data, true);
      value.prepared = { path: rel, bytes: native.data.length, sha256: native.configSha256 };
      value.stage = 'PREPARED';
      return commit(current, root, value);
    }); },
    createHandoff(input) { return mutate(async () => {
      need(Number.isSafeInteger(input.revision) && input.revision >= 0, 'ATLAS_SELECTION_REVISION_REQUIRED');
      const current = await state(), prior = await record(input.selectionId, current);
      need(prior.request, 'ATLAS_PREPARED_REQUEST_REQUIRED');
      const stage = await version(current, prior, 'handoff', input);
      if (stage.replay) return selectionView(stage.replay);
      const { root, value } = stage, native = await prepared(prior);
      const handoff = createOperationHandoff({ draft: native.draft, discoveryBytes: native.discovery,
        bodyBytes: native.body, ticketBytes: native.ticket, directory: path(root) });
      const bytes = json(handoff), rel = `${root}/handoff.json`;
      await write(rel, bytes, true);
      value.handoff = { path: rel, bytes: bytes.length, sha256: hash(bytes), acceptIndex: prior.accept,
        intentId: native.draft.operation.intentId };
      value.stage = 'HANDOFF'; return commit(current, root, value);
    }); },
    async *snapshotFiles() {
      need(!closed, 'ATLAS_WORKSPACE_CLOSED'); await queue;
      const snapshot = await read('workspace.json'), current = decode(snapshot);
      const roots = [...Object.keys(current.captures).map(id => `captures/${id}`), ...Object.keys(current.selections).map(id => `selections/${id}`)];
      const visit = async function* (rel) {
        for (const child of (await readdir(path(rel), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
          if (child.name.startsWith('.')) continue;
          need(!child.isSymbolicLink(), 'ATLAS_SNAPSHOT_SYMLINK_REFUSED');
          const selected = `${rel}/${child.name}`;
          if (child.isDirectory()) yield* visit(selected);
          else { need(child.isFile(), 'ATLAS_SNAPSHOT_FILE_INVALID'); yield { path: selected, bytes: await read(selected, Math.max(MANIFEST_BYTES, 4 * Math.ceil(MAX_REQUEST_BODY_BYTES / 3) + 2 * PAGE_BYTES)) }; }
        }
      };
      for (const root of roots) yield* visit(root);
      need((await read('workspace.json')).equals(snapshot), 'ATLAS_SNAPSHOT_CHANGED_RETRY');
      yield { path: 'workspace.json', bytes: snapshot };
    },
    async close() { if (!closed) { closed = true; await queue; await release(); } },
  };
  return api;
}
