import { webDavWorkspaceTools, webDavBindingSelection, alias, mutation, hash, uuid, readOnly, object, shortText, PUBLISHER_ACTIONS, SOURCE_KINDS, PUBLISHER_KINDS, SHA256, UUID } from './catalog/webdav-tools.mjs';
export { webDavWorkspaceTools } from './catalog/webdav-tools.mjs';
// MIT. Merchant agents operate the original WebDAV workspace, browser and publisher.
import { constants } from 'node:fs';
import { open, realpath, lstat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { identity as nativeWebDavIdentity } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/webdav/config.mjs';
import { exact, failure, identifier, line, plain, privateSupportDirectory } from './config.mjs';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { RetainedSourceFileReads as SourceFileReads } from './retained-source-files.mjs';

export const WEBDAV_CONNECTION_SCHEMA = 'stellar-forge.webdav-workspace-connection.v1';












const count = (value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw failure('INVALID_PARAMS', `${label} must be an integer from ${minimum} to ${maximum}.`);
  return value;
};
const originalId = value => {
  if (typeof value !== 'string' || !UUID.test(value)) throw failure('INVALID_PARAMS', 'Use the original UUID from this workspace.');
  return value;
};
const copy = value => structuredClone(value);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fileStamp = stat => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');

async function privateJson(path, maximum = 1048576) {
  if (await realpath(path) !== resolve(path)) throw failure('CONFIGURATION_ERROR', 'Select a canonical private connection file.');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > maximum || process.platform !== 'win32' &&
        ((info.mode & 0o077) || process.getuid && info.uid !== process.getuid()))
      throw failure('CONFIGURATION_ERROR', 'Select an owned private JSON file within its native size limit.');
    const bytes = await file.readFile();
    if (bytes.length > maximum) throw failure('CONFIGURATION_ERROR', 'The selected private JSON exceeds its size limit.');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { await file.close(); }
}
function hostPath(value, base) {
  if (typeof value !== 'string' || !value || /[\x00-\x1f\x7f]/.test(value))
    throw failure('CONFIGURATION_ERROR', 'Host paths belong in the private connection file.');
  const path = resolve(base, value);
  if (path === '/') throw failure('CONFIGURATION_ERROR', 'Choose an application directory.');
  return path;
}
async function workspacePath(value, base) {
  const path = hostPath(value, base);
  try {
    if (await realpath(path) !== path) throw failure('CONFIGURATION_ERROR', 'Choose a canonical workspace directory.');
    await privateSupportDirectory(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = dirname(path);
    if (await realpath(parent) !== parent) throw failure('CONFIGURATION_ERROR', 'Choose a canonical existing workspace parent.');
    await privateSupportDirectory(parent);
  }
  return path;
}
function named(value, label) {
  if (value === undefined) return [];
  if (!plain(value) || Object.keys(value).length > 32) throw failure('CONFIGURATION_ERROR', `Declare up to 32 ${label}.`);
  return Object.entries(value).map(([name, item]) => [identifier(name, `${label} alias`), item]);
}
function runtime(input = {}) {
  exact(input, ['port', 'facilitator', 'allowLocalFacilitator']);
  const selected = { ...input, port: count(input.port ?? 0, 'Merchant port', 0, 65535) };
  if (input.allowLocalFacilitator !== undefined && typeof input.allowLocalFacilitator !== 'boolean')
    throw failure('CONFIGURATION_ERROR', 'allowLocalFacilitator must be a Boolean.');
  if (input.facilitator !== undefined) {
    const url = new URL(input.facilitator);
    if (url.username || url.password || url.search || url.hash || url.protocol !== 'https:' &&
        !(input.allowLocalFacilitator === true && url.protocol === 'http:' && url.hostname === '127.0.0.1'))
      throw failure('CONFIGURATION_ERROR', 'Use the declared original HTTPS or explicit loopback facilitator.');
  }
  return selected;
}

/** Resolve host inputs without opening a source account or application workspace. */
export async function readWebDavWorkspaceConfiguration(path) {
  path = resolve(path);
  const raw = await privateJson(path);
  exact(raw, ['schema', 'workspaces'], ['schema', 'workspaces']);
  if (raw.schema !== WEBDAV_CONNECTION_SCHEMA || !plain(raw.workspaces) ||
      !Object.keys(raw.workspaces).length || Object.keys(raw.workspaces).length > 32)
    throw failure('CONFIGURATION_ERROR', 'Declare 1–32 original WebDAV workspaces.');
  const { validateSource } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/webdav/config.mjs');
  const { compileHttpSellerOffer } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/seller.mjs');
  const base = dirname(path), workspaces = Object.create(null), seen = new Set();
  for (const [name, input] of Object.entries(raw.workspaces)) {
    identifier(name, 'WebDAV workspace alias');
    exact(input, ['label', 'directory', 'python', 'browserPort', 'sourceProfiles', 'merchantProfiles', 'buyerWorkspaces', 'sourcePackets', 'runtime'], ['directory']);
    const directory = await workspacePath(input.directory, base);
    if (seen.has(directory)) throw failure('CONFIGURATION_ERROR', 'Give an original WebDAV directory one alias.');
    seen.add(directory);
    const python = input.python ?? 'python3';
    if (typeof python !== 'string' || !python || /[\x00-\x1f\x7f]/.test(python))
      throw failure('CONFIGURATION_ERROR', 'Declare the installed Python interpreter.');
    const sourceProfiles = Object.create(null), merchantProfiles = Object.create(null);
    const buyerWorkspaces = Object.create(null), sourcePackets = Object.create(null);
    for (const [key, profile] of named(input.sourceProfiles, 'source profiles')) {
      exact(profile, ['label', 'source'], ['source']);
      sourceProfiles[key] = { label: line(profile.label ?? key), source: copy(validateSource(profile.source)) };
    }
    for (const [key, profile] of named(input.merchantProfiles, 'merchant profiles')) {
      exact(profile, ['label', 'origin', 'path', 'payment'], ['origin', 'path', 'payment']);
      const origin = new URL(profile.origin);
      if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' ||
          typeof profile.path !== 'string' || !profile.path.startsWith('/') || new URL(profile.path, origin).origin !== origin.origin ||
          new URL(profile.path, origin).pathname !== profile.path)
        throw failure('CONFIGURATION_ERROR', 'Use one public HTTPS merchant origin and canonical route.');
      compileHttpSellerOffer({ method: 'GET', url: origin.origin + profile.path, description: 'WebDAV dataset', payment: profile.payment });
      merchantProfiles[key] = { label: line(profile.label ?? key), origin: origin.origin, path: profile.path, payment: copy(profile.payment) };
    }
    for (const [key, entry] of named(input.buyerWorkspaces, 'buyer workspaces')) {
      exact(entry, ['label', 'directory'], ['directory']);
      const selected = hostPath(entry.directory, base);
      if (await realpath(selected) !== selected) throw failure('CONFIGURATION_ERROR', 'Use a canonical original buyer directory.');
      await privateSupportDirectory(selected);
      buyerWorkspaces[key] = { label: line(entry.label ?? key), directory: selected };
    }
    for (const [key, entry] of named(input.sourcePackets, 'source packets')) {
      exact(entry, ['label', 'file', 'sha256'], ['file', 'sha256']);
      const file = hostPath(entry.file, base);
      if (!SHA256.test(entry.sha256 ?? '') || await realpath(file) !== file || !(await lstat(file)).isFile())
        throw failure('CONFIGURATION_ERROR', 'Declare an original regular source packet and its exact SHA256.');
      sourcePackets[key] = { label: line(entry.label ?? key), file, sha256: entry.sha256 };
    }
    workspaces[name] = { label: line(input.label ?? name), directory, python,
      browserPort: count(input.browserPort ?? 0, 'Browser port', 0, 65535),
      sourceProfiles, merchantProfiles, buyerWorkspaces, sourcePackets, runtime: runtime(input.runtime) };
  }
  return { workspaces };
}



function statePage(input, offset = 0, limit = 50) {
  const { directory, ...state } = input;
  const pages = {};
  for (const key of ['sources', 'captures', 'mappings', 'editions', 'merchants', 'exports', 'products', 'operations']) {
    const rows = state[key] ?? [];
    state[key] = rows.slice(offset, offset + limit);
    pages[key] = { offset, limit, total: rows.length, nextOffset: offset + limit < rows.length ? offset + limit : null,
      ...(key === 'operations' ? { originalWindow: 'NEWEST_100', olderByOperationId: true } : {}) };
  }
  return { ...state, pages };
}

export class MerchantWebDavWorkspaces {
  #config; #handles = new Map(); #receiving = new Map(); #pending = new Set(); #closing = false; #close;
  #files = new SourceFileReads({ errorPrefix: 'WEBDAV' }); #results = new RetainedFileReads({ errorPrefix: 'WEBDAV' });
  constructor(config) { this.#config = config; }
  get summary() { return { configured: Boolean(this.#config.webdavWorkspaces), opened: [...this.#handles.keys()],
    receiving: [...this.#receiving].map(([workspace, row]) => ({ workspace, packet: row.packet, action: row.action })),
    pending: this.#pending.size, closing: this.#closing, sourceFileReads: this.#files.summary().length, ...this.#results.summary }; }
  #declared(name) {
    identifier(name, 'WebDAV workspace alias');
    const entry = this.#config.webdavWorkspaces?.workspaces?.[name];
    if (!entry) throw failure('WEBDAV_WORKSPACE_NOT_CONFIGURED', 'Choose a workspace from merchant_webdav_status.'); return entry;
  }
  async #status(name, offset = 0, limit = 50) {
    count(offset, 'History offset'); count(limit, 'History page size', 1, 100);
    if (name === undefined) return { ...this.summary, workspaces: Object.entries(this.#config.webdavWorkspaces?.workspaces ?? {}).map(([workspace, entry]) => ({
      workspace, label: entry.label, state: this.#handles.has(workspace) ? 'OPEN' : 'CLOSED',
      sourceProfiles: Object.entries(entry.sourceProfiles).map(([profile, value]) => ({ profile, label: value.label, source: value.source })),
      merchantProfiles: Object.entries(entry.merchantProfiles).map(([profile, value]) => ({ profile, ...value })),
      runtime: copy(entry.runtime),
      buyerWorkspaces: Object.entries(entry.buyerWorkspaces).map(([buyerWorkspace, value]) => ({ buyerWorkspace, label: value.label,
        directorySha256: digest(Buffer.from(value.directory)) })),
      sourcePackets: Object.entries(entry.sourcePackets).map(([packet, value]) => ({ packet, label: value.label, sha256: value.sha256 })),
    })) };
    const entry = this.#declared(name), opening = this.#handles.get(name);
    if (!opening) return { workspace: name, label: entry.label, state: 'CLOSED' };
    const handle = await opening;
    return { workspace: name, instanceId: handle.instanceId, state: handle.closing ? 'CLOSING' : 'OPEN',
      browser: { url: handle.server.url }, native: statePage(await handle.server.workspace.inspect(), offset, limit),
      fileReads: this.#files.summary(name), resultReads: this.#results.status(name) };
  }
  async #open(name) {
    const entry = this.#declared(name);
    if (this.#receiving.has(name)) throw failure('WEBDAV_RECEIVING_ACTIVE', 'Read the same source receiving operation before opening its destination.');
    if (!this.#handles.has(name)) {
      const opening = (async () => {
        const { start } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/webdav/server.mjs');
        const server = await start({ directory: entry.directory, python: entry.python, port: entry.browserPort, environment: process.env });
        return { server, entry, instanceId: randomUUID(), closing: false, pending: new Set(), results: new Map() };
      })();
      this.#handles.set(name, opening);
      try { await opening; } catch (error) { if (this.#handles.get(name) === opening) this.#handles.delete(name); throw error; }
    }
    return this.#status(name);
  }
  async #stop(name, handle) {
    if (handle.stop) return handle.stop;
    handle.closing = true;
    handle.stop = (async () => {
      // Native close starts cancellation before waiting for outstanding capture calls.
      const nativeClosing = Promise.allSettled([handle.server.close()]);
      await Promise.allSettled([...handle.pending]);
      // Accepted download loaders may create their transport snapshot while draining.
      const results = [...await nativeClosing, ...await Promise.allSettled([
        this.#files.closeScope(name), this.#results.closeScope(name)])];
      const failed = results.find(row => row.status === 'rejected');
      if (failed) throw failed.reason;
      this.#handles.delete(name); return { workspace: name, instanceId: handle.instanceId, state: 'CLOSED' };
    })(); return handle.stop;
  }
  async #present(name, handle, value, resultId) {
    const { state, ...response } = value;
    if (Buffer.byteLength(JSON.stringify(response)) <= 49152) return { ...response, ...(state ? { state: statePage(state) } : {}) };
    // Read the same completed native record for act(), operation() and restart.
    // Its saved input is part of the full downloadable intent/result, unlike live state.
    const durable = Boolean(resultId && value.operation?.status === 'COMPLETE');
    const id = durable ? resultId : randomUUID();
    const record = durable ? await handle.server.workspace.operation(resultId) : null;
    const complete = durable ? { operation: record.operation, result: record.result } : response;
    const bytes = Buffer.from(JSON.stringify(complete));
    handle.results.set(id, { value: complete });
    while (handle.results.size > 8) handle.results.delete(handle.results.keys().next().value);
    return { completeResult: { kind: 'result', id, bytes: bytes.length, sha256: digest(bytes),
      content: durable ? 'original-operation-record' : 'complete-response', durableOperation: durable },
      ...(value.operation ? { operation: Object.fromEntries(Object.entries(value.operation).filter(([key]) => key !== 'input')) } : {}),
      ...(state ? { state: statePage(state) } : {}) };
  }
  async #act(name, handle, action, args, input) {
    originalId(args.operationId); count(args.expectedRevision, 'Saved revision');
    const value = await handle.server.workspace.act(action, { operationId: args.operationId, expectedRevision: args.expectedRevision, input });
    return this.#present(name, handle, value, args.operationId);
  }
  async #file(name, handle, args) {
    const key = JSON.stringify([args.kind, args.id, args.filename ?? null, args.sourceId ?? null, args.productId ?? null, args.publisherKind ?? null]);
    if (SOURCE_KINDS.includes(args.kind)) {
      originalId(args.id);
      return this.#files.read({ scope: name, key, ...args,
        load: () => handle.server.workspace.download(args.kind, args.id, args.filename, args.sourceId) });
    }
    if (!['publisher', 'result'].includes(args.kind)) throw failure('INVALID_PARAMS', 'Choose an original WebDAV file kind.');
    return this.#results.read({ scope: name, key, kind: args.kind, directory: this.#config.exportsDirectory,
      readId: args.readId, expectedSha256: args.expectedSha256, offset: args.offset, limit: args.limit,
      load: async () => {
        if (args.kind === 'publisher') {
          originalId(args.productId);
          if (!PUBLISHER_KINDS.includes(args.publisherKind)) throw failure('INVALID_PARAMS', 'Choose an original publisher download kind.');
          const value = await handle.server.workspace.publisherDownload(args.productId, args.publisherKind, args.id);
          return { bytes: value.bytes, name: value.filename, type: value.contentType };
        }
        let retained = handle.results.get(args.id);
        if (!retained) {
          originalId(args.id); const native = await handle.server.workspace.operation(args.id);
          if (native.operation.status !== 'COMPLETE') throw failure('WEBDAV_RESULT_PENDING', 'This original operation has no completed result yet.');
          retained = { value: { operation: native.operation, result: native.result } };
        }
        return { bytes: Buffer.from(JSON.stringify(retained.value)), name: 'webdav-result-' + args.id + '.json', type: 'application/json' };
      } });
  }
  async #receive(name, args) {
    const entry = this.#declared(name), packet = entry.sourcePackets[identifier(args.packet, 'Source packet alias')];
    if (!packet || args.expectedSha256 !== packet.sha256) throw failure('WEBDAV_PACKET_NOT_CONFIGURED', 'Select the declared source packet and its original SHA256.');
    if (!['inspect', 'receive'].includes(args.action)) throw failure('INVALID_PARAMS', 'Choose inspect or receive.');
    count(args.offset ?? 0, 'Manifest offset'); count(args.limit ?? 50, 'Manifest page size', 1, 100);
    const identity = JSON.stringify([args.action, args.packet, args.expectedSha256, args.offset ?? 0, args.limit ?? 50]);
    const existing = this.#receiving.get(name);
    if (existing) {
      if (existing.identity !== identity) throw failure('WEBDAV_RECEIVING_ACTIVE', 'Finish the current original source packet inspection or receiving first.');
      return existing.pending;
    }
    if (args.action === 'receive' && this.#handles.has(name)) throw failure('WEBDAV_WORKSPACE_OPEN', 'Close this original workspace before receiving.');
    const controller = new AbortController();
    const pending = this.#receivePacket(name, args, entry, packet, controller.signal);
    this.#receiving.set(name, { identity, pending, controller, packet: args.packet, action: args.action });
    try { return await pending; } finally { this.#receiving.delete(name); }
  }
  async #receivePacket(name, args, entry, packet, signal) {
    const { inspectSourcePacket, importSourcePacket } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/webdav/packet.mjs');
    const inspected = await inspectSourcePacket({ input: packet.file, python: entry.python, signal });
    if (inspected.source.sha256 !== packet.sha256) throw failure('WEBDAV_PACKET_CHANGED', 'The declared source packet changed.');
    if (args.action === 'inspect') {
      const offset = args.offset ?? 0, limit = args.limit ?? 50, files = inspected.manifest.files;
      return { workspace: name, packet: args.packet, ...inspected,
        manifest: { ...inspected.manifest, files: files.slice(offset, offset + limit) },
        page: { offset, limit, total: files.length, nextOffset: offset + limit < files.length ? offset + limit : null } };
    }
    const receiptPath = resolve(entry.directory, 'source-packet-import.json');
    try {
      const receipt = await privateJson(receiptPath, 16777216);
      if (receipt.source?.sha256 !== packet.sha256 || receipt.source?.bytes !== inspected.source.bytes)
        throw failure('WEBDAV_RECEIVING_CONFLICT', 'This destination retains a different original source packet.');
      const incomplete = await lstat(resolve(entry.directory, 'source-packet-import-incomplete.json')).then(() => true, error => {
        if (error.code === 'ENOENT') return false; throw error;
      });
      if (incomplete) throw failure('WEBDAV_RECEIVING_INCOMPLETE', 'This original destination retains an incomplete receiving operation. Inspect its retained source state.');
      const state = await privateJson(resolve(entry.directory, 'workspace.json'), 16777216);
      if (state.id !== receipt.workspaceId || state.sourcePacket?.sha256 !== packet.sha256 || state.sourcePacket?.bytes !== inspected.source.bytes)
        throw failure('WEBDAV_RECEIVING_CONFLICT', 'The original receiving receipt and destination workspace differ.');
      return { workspace: name, packet: args.packet, ...receipt, revision: state.revision, replayed: true };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const result = await importSourcePacket({ input: packet.file, directory: entry.directory, python: entry.python, signal });
    if (result.source?.sha256 !== packet.sha256) throw failure('WEBDAV_PACKET_CHANGED', 'The original receiving result selected a changed packet.');
    return { workspace: name, packet: args.packet, ...result };
  }
  async #execute(name, handle, args) {
    const native = handle.server.workspace, entry = handle.entry, call = (action, input) => this.#act(args.workspace, handle, action, args, input);
    if (args.expectedProfileSha256 !== undefined) {
      const selected = webDavBindingSelection(name, args);
      let value;
      if (selected?.kind === 'source') value = entry.sourceProfiles[selected.profile]?.source;
      else if (selected?.kind === 'merchant') {
        const profile = entry.merchantProfiles[selected.profile];
        if (profile) value = { origin: profile.origin, path: profile.path, payment: profile.payment };
      } else if (selected?.kind === 'runtime') value = entry.runtime;
      else if (selected?.kind === 'buyer') {
        const buyer = entry.buyerWorkspaces[selected.profile];
        if (buyer) value = { directorySha256: digest(Buffer.from(buyer.directory)) };
      }
      if (!SHA256.test(args.expectedProfileSha256) || !value || nativeWebDavIdentity(value) !== args.expectedProfileSha256)
        throw failure('WEBDAV_PROFILE_CHANGED', 'The selected source, merchant, release runtime or buyer workspace differs from the reviewed profile.');
    }
    switch (name) {
      case 'merchant_webdav_source': {
        const profile = entry.sourceProfiles[identifier(args.profile, 'Source profile')];
        if (!profile) throw failure('WEBDAV_SOURCE_NOT_CONFIGURED', 'Choose a declared source profile.');
        return call('source.save', { source: copy(profile.source) });
      }
      case 'merchant_webdav_catalogue': return call('source.catalogue', Object.fromEntries(['href', 'depth', 'offset', 'limit'].filter(key => args[key] !== undefined).map(key => [key, args[key]])));
      case 'merchant_webdav_listing': return native.listing({ sourceId: originalId(args.sourceId), id: originalId(args.id), offset: args.offset, limit: args.limit });
      case 'merchant_webdav_capture': {
        if (args.action === 'start') return call('capture.start', { selection: args.selection });
        if (args.action === 'resume') return call('capture.resume', { captureId: originalId(args.captureId) });
        if (args.action === 'sample') return call('capture.sample', Object.fromEntries(['captureId', 'format', 'recordsPointer', 'limit'].filter(key => args[key] !== undefined).map(key => [key, args[key]])));
        throw failure('INVALID_PARAMS', 'Choose start, resume or sample.');
      }
      case 'merchant_webdav_mapping': return call('mapping.save', { captureId: originalId(args.captureId), expectedCaptureSha256: args.expectedCaptureSha256, projection: args.projection });
      case 'merchant_webdav_edition':
        if (args.action === 'build') return call('edition.build', { mappingId: originalId(args.mappingId), dataset: args.dataset, review: args.review });
        if (args.action === 'export') return call('edition.export', { editionId: originalId(args.editionId), merchantId: originalId(args.merchantId), reviewer: args.reviewer, note: args.note ?? '' });
        throw failure('INVALID_PARAMS', 'Choose build or export.');
      case 'merchant_webdav_preview': return this.#present(args.workspace, handle, await native.preview({ editionId: originalId(args.editionId), query: args.query ?? '' }));
      case 'merchant_webdav_merchant': {
        const profile = entry.merchantProfiles[identifier(args.profile, 'Merchant profile')];
        if (!profile) throw failure('WEBDAV_MERCHANT_NOT_CONFIGURED', 'Choose a declared merchant profile.');
        const { label, ...terms } = profile;
        return call('merchant.save', { ...copy(terms), editionId: originalId(args.editionId), reviewer: args.reviewer, note: args.note ?? '' });
      }
      case 'merchant_webdav_packet': return call('source.packet', {});
      case 'merchant_webdav_publisher': {
        if (!plain(args.payload ?? {})) throw failure('INVALID_PARAMS', 'Supply the original publisher input object.');
        const input = copy(args.payload ?? {});
        if (args.action === 'publisher.prepare') {
          exact(input, ['exportId', 'productId', 'title'], ['exportId']); originalId(input.exportId);
          return call('publisher.prepare', input);
        }
        if (!PUBLISHER_ACTIONS.includes(args.action)) throw failure('INVALID_PARAMS', 'Choose an original publisher action.');
        originalId(args.productId);
        if (args.action === 'publisher.release.stage') {
          exact(input, ['draftId', 'id', 'label']); input.runtime = copy(entry.runtime);
        }
        if (args.action === 'publisher.buyer.session') {
          exact(input, ['buyerId', 'buyerWorkspace', 'maxPages', 'maxTotalAtomic', 'maxRows', 'maxPageBytes']);
          const buyer = entry.buyerWorkspaces[identifier(input.buyerWorkspace, 'Buyer workspace')];
          if (!buyer) throw failure('WEBDAV_BUYER_NOT_CONFIGURED', 'Choose an original host-declared buyer workspace.');
          delete input.buyerWorkspace; input.workspaceDirectory = buyer.directory;
        }
        return call('publisher.act', { productId: args.productId, action: args.action, input });
      }
      case 'merchant_webdav_operation': {
        originalId(args.id);
        if (args.kind === 'operation') return this.#present(args.workspace, handle, await native.operation(args.id), args.id);
        if (args.kind === 'capture') return this.#present(args.workspace, handle, await native.capture(args.id));
        if (args.kind === 'mapping') return this.#present(args.workspace, handle, await native.mapping(args.id));
        if (args.kind === 'publisher') return this.#present(args.workspace, handle, await native.publisherState(args.id));
        throw failure('INVALID_PARAMS', 'Choose operation, capture, mapping or publisher.');
      }
      case 'merchant_webdav_cancel': return native.cancel(originalId(args.operationId));
      case 'merchant_webdav_file': return this.#file(args.workspace, handle, args);
      case 'merchant_webdav_file_release':
        await Promise.all([this.#files.release(args.workspace, originalId(args.readId)), this.#results.release(args.workspace, args.readId)]);
        return { workspace: args.workspace, readId: args.readId, released: true };
      default: throw failure('TOOL_NOT_FOUND', 'Unknown WebDAV workspace operation.');
    }
  }
  async #dispatch(name, args) {
    if (name === 'merchant_webdav_status') return this.#status(args.workspace, args.offset ?? 0, args.limit ?? 50);
    if (name === 'merchant_webdav_open') return this.#open(args.workspace);
    if (name === 'merchant_webdav_receive') return this.#receive(args.workspace, args);
    this.#declared(args.workspace);
    const opening = this.#handles.get(args.workspace);
    if (!opening) throw failure('WEBDAV_WORKSPACE_CLOSED', 'Open the original workspace with merchant_webdav_open.');
    const handle = await opening;
    if (handle.closing) throw failure('WEBDAV_WORKSPACE_CLOSING', 'The original workspace is closing.');
    if (name === 'merchant_webdav_close') {
      if (args.instanceId !== handle.instanceId) throw failure('INSTANCE_CONFLICT', 'Use this original process-owned instance ID from status.');
      return this.#stop(args.workspace, handle);
    }
    const pending = this.#execute(name, handle, args); handle.pending.add(pending);
    try { return await pending; } finally { handle.pending.delete(pending); }
  }
  async call(name, args) {
    if (this.#closing) throw failure('OPERATOR_CLOSING', 'The WebDAV merchant adapter is closing.');
    const pending = this.#dispatch(name, args); this.#pending.add(pending);
    try { return await pending; } finally { this.#pending.delete(pending); }
  }
  close() {
    if (this.#close) return this.#close;
    this.#closing = true;
    for (const row of this.#receiving.values()) row.controller.abort();
    this.#close = (async () => {
      const results = await Promise.allSettled([...this.#handles].map(async ([name, pending]) => this.#stop(name, await pending)));
      await Promise.allSettled([...this.#pending]); await Promise.all([this.#files.close(), this.#results.close()]);
      if (results.some(row => row.status === 'rejected')) throw failure('WEBDAV_CLOSE_FAILED', 'An original WebDav instance reported incomplete shutdown.');
    })(); return this.#close;
  }
}
