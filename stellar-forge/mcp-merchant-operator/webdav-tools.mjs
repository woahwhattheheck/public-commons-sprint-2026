// MIT. Merchant agents operate the original WebDAV workspace, browser and publisher.
import { constants } from 'node:fs';
import { open, realpath, lstat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { exact, failure, identifier, line, plain, privateSupportDirectory } from './config.mjs';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';

export const WEBDAV_CONNECTION_SCHEMA = 'stellar-forge.webdav-workspace-connection.v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const uuid = { type: 'string', pattern: UUID.source };
const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const hash = { type: 'string', pattern: SHA256.source };
const object = { type: 'object', additionalProperties: true };
const shortText = { type: 'string', minLength: 1, maxLength: 200 };
const readOnly = { readOnly: true, idempotent: true };
const mutation = { operationId: uuid, expectedRevision: { type: 'integer', minimum: 0 } };
const SOURCE_KINDS = ['source', 'listing', 'capture', 'edition', 'export', 'packet'];
const PUBLISHER_KINDS = ['draft-csv', 'draft-review', 'buyer-config', 'session-manifest', 'session-csv', 'session-jsonl', 'session-review'];
const PUBLISHER_ACTIONS = [
  'publisher.status', 'publisher.preview', 'publisher.reviewDraft', 'publisher.publish',
  'publisher.activateSnapshot', 'publisher.collect', 'publisher.release.stage',
  'publisher.release.inspect', 'publisher.release.activate', 'publisher.release.rollback',
  'publisher.release.start', 'publisher.release.stop', 'publisher.buyer.review',
  'publisher.buyer.prepare', 'publisher.buyer.session', 'publisher.buyer.run',
  'publisher.buyer.recover', 'publisher.buyer.account', 'publisher.buyer.export',
];
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

export function webDavWorkspaceTools(tool) {
  const scoped = properties => ({ workspace: alias, ...properties });
  const changed = properties => scoped({ ...mutation, ...properties });
  const required = ['workspace', 'operationId', 'expectedRevision'];
  const chunk = { expectedSha256: hash, readId: uuid, offset: { type: 'integer', minimum: 0 },
    limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } };
  return [
    tool('merchant_webdav_status', 'List host-declared source, merchant, buyer and receiving profiles, or page the exact opened WebDAV workspace. Returned pagination covers all retained arrays; original operations expose the newest 100 records and remain readable by UUID.',
      scoped({ offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }), [], readOnly),
    tool('merchant_webdav_open', 'Open the original WebDAV workspace and its native industrial browser in one owned instance. Reopening retains original sources, captures, mappings, editions, publisher and customer operation IDs.',
      scoped({}), ['workspace'], { idempotent: true }),
    tool('merchant_webdav_close', 'Close the exact MCP-owned WebDAV instance, cancel source work, drain original publishers and releases, close file reads and release its native lease.',
      scoped({ instanceId: uuid }), ['workspace', 'instanceId'], { destructive: true }),
    tool('merchant_webdav_source', 'Save a selected host-declared source profile as an original retained revision. The source configuration contains environment reference names; credentials remain in the host process.',
      changed({ profile: alias }), [...required, 'profile']),
    tool('merchant_webdav_catalogue', 'Capture the configured WebDAV collection through the original PROPFIND implementation. Retains the response and individual property outcomes. Use merchant_webdav_listing to page these same saved bytes.',
      changed({ href: { type: 'string', maxLength: 8192 }, depth: { enum: [0, 1] }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 1000 } }), required, { openWorld: true }),
    tool('merchant_webdav_listing', 'Page an already retained original WebDAV listing without another provider request. Keep its sourceId, listing id, original href, ETag and size for file selection.',
      scoped({ sourceId: uuid, id: uuid, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 1000 } }), ['workspace', 'sourceId', 'id'], readOnly),
    tool('merchant_webdav_capture', 'Start, resume or sample the original conditional file capture. Start takes the exact original selection; resume keeps captureId and verified prefix. Sample retains the complete source record count and chosen sample.',
      changed({ action: { enum: ['start', 'resume', 'sample'] }, selection: object, captureId: uuid,
        format: { enum: ['csv', 'json', 'ndjson'] }, recordsPointer: { type: 'string', maxLength: 2048 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }), [...required, 'action'], { openWorld: true }),
    tool('merchant_webdav_mapping', 'Save the complete reviewed native projection against its original capture SHA256. Original SFTP scalar/null/pointer rules and dataset validation remain authoritative.',
      changed({ captureId: uuid, expectedCaptureSha256: hash, projection: object }), [...required, 'captureId', 'expectedCaptureSha256', 'projection']),
    tool('merchant_webdav_edition', 'Build a complete native CSV edition from a saved mapping and explicit dataset contract, or export a reviewed edition with its original merchant terms. Original files and snapshot IDs remain retained.',
      changed({ action: { enum: ['build', 'export'] }, mappingId: uuid, dataset: object, review: object,
        editionId: uuid, merchantId: uuid, reviewer: shortText, note: { type: 'string', maxLength: 4000 } }), [...required, 'action']),
    tool('merchant_webdav_preview', 'Query the exact original retained dataset edition. Large complete results are available through merchant_webdav_file with kind result and the returned read key.',
      scoped({ editionId: uuid, query: { type: 'string', maxLength: 8192 } }), ['workspace', 'editionId'], readOnly),
    tool('merchant_webdav_merchant', 'Save a selected host-declared merchant profile for an exact edition through the original native seller compiler. Retains the public origin, route, full payment terms and reviewer.',
      changed({ editionId: uuid, profile: alias, reviewer: shortText, note: { type: 'string', maxLength: 4000 } }), [...required, 'editionId', 'profile', 'reviewer']),
    tool('merchant_webdav_publisher', 'Prepare an original publisher from a retained export or invoke its native release/customer workflow. Uses host-selected runtime and buyer directory aliases. Keep the original review, page attempt, policy and ledger identities during recovery.',
      changed({ action: { enum: ['publisher.prepare', ...PUBLISHER_ACTIONS] }, productId: uuid, payload: object }), [...required, 'action'], { openWorld: true }),
    tool('merchant_webdav_operation', 'Read an original operation, capture, mapping or publisher by its retained UUID while source work is running. Complete large operation results use the result-file selector returned by this tool.',
      scoped({ kind: { enum: ['operation', 'capture', 'mapping', 'publisher'] }, id: uuid }), ['workspace', 'kind', 'id'], readOnly),
    tool('merchant_webdav_cancel', 'Request cancellation of this original active operation immediately. Inspect its native outcome and retain the same capture or publisher identity.',
      scoped({ operationId: uuid }), ['workspace', 'operationId'], { idempotent: true }),
    tool('merchant_webdav_packet', 'Create the original portable WebDAV source packet. The original source engine retains exact files, IDs and source metadata; receiving prepares its own native publisher on the destination host.',
      changed({}), required),
    tool('merchant_webdav_receive', 'Inspect or receive a host-declared SHA256-pinned original source packet into its declared closed workspace. Completed same-packet receiving is read back; an incomplete original destination remains available for inspection.',
      scoped({ action: { enum: ['inspect', 'receive'] }, packet: alias, expectedSha256: hash,
        offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }), ['workspace', 'action', 'packet', 'expectedSha256']),
    tool('merchant_webdav_file', 'Read complete original source, listing, capture, edition, merchant export, source packet, native publisher file or retained result in verified chunks. Continue with readId, expectedSha256 and nextOffset. Restart resumes the same retained native source with expectedSha256 and offset.',
      scoped({ kind: { enum: [...SOURCE_KINDS, 'publisher', 'result'] }, id: { type: 'string', minLength: 1, maxLength: 200 },
        filename: { type: 'string', maxLength: 160 }, sourceId: uuid, productId: uuid,
        publisherKind: { enum: PUBLISHER_KINDS }, ...chunk }), ['workspace', 'kind', 'id'], readOnly),
    tool('merchant_webdav_file_release', 'Release an unfinished transport read. The original native source, packet, result or customer file remains retained.',
      scoped({ readId: uuid }), ['workspace', 'readId'], { idempotent: true }),
  ];
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

/** Retain native read-only file handles, so large source packets need no duplicate snapshot. */
class SourceFileReads {
  #reads = new Map(); #opening = Promise.resolve(); #closing = false;
  summary(scope) { return [...this.#reads.values()].filter(row => scope === undefined || row.scope === scope)
    .map(row => ({ readId: row.id, file: row.metadata, expiresAt: row.expiresAt })); }
  #touch(row) {
    clearTimeout(row.timer); row.expiresAt = new Date(Date.now() + 120000).toISOString();
    row.timer = setTimeout(() => { void this.release(row.scope, row.id).catch(() => {}); }, 120000); row.timer.unref();
  }
  async #dispose(row) {
    if (row.disposal) return row.disposal;
    row.closed = true; clearTimeout(row.timer);
    row.disposal = row.handle.close().finally(() => this.#reads.delete(row.id));
    return row.disposal;
  }
  async release(scope, id) {
    const row = this.#reads.get(id); if (!row) return false;
    if (row.scope !== scope) throw failure('WEBDAV_READ_CONFLICT', 'Select a read from this workspace.');
    row.releasing = true; clearTimeout(row.timer); await row.tail.catch(() => {}); await this.#dispose(row); return true;
  }
  async closeScope(scope) {
    await this.#opening.catch(() => {});
    await Promise.all([...this.#reads.values()].filter(row => row.scope === scope).map(row => this.release(scope, row.id)));
  }
  async close() { this.#closing = true; await this.#opening.catch(() => {}); await Promise.all([...this.#reads.values()].map(row => this.release(row.scope, row.id))); }
  async read({ scope, key, load, readId, expectedSha256, offset = 0, limit = 65536 }) {
    if (this.#closing) throw failure('WEBDAV_READ_CLOSING', 'File delivery is closing.');
    count(offset, 'Byte offset'); count(limit, 'Chunk size', 1, MAX_RETAINED_CHUNK_BYTES);
    if (expectedSha256 !== undefined && !SHA256.test(expectedSha256) || (offset > 0 || readId) && !expectedSha256)
      throw failure('WEBDAV_INVALID_CHUNK', 'Use the original SHA256 for every continued or resumed read.');
    let row = readId ? this.#reads.get(readId) : null;
    if (!readId) {
      const pending = this.#opening.then(async () => {
        if (this.#closing || this.#reads.size >= 4) throw failure('WEBDAV_READ_CAPACITY', 'Finish or release an existing native file read.');
        const original = await load();
        try {
          const before = await original.handle.stat({ bigint: true });
          if (!before.isFile() || before.size !== BigInt(original.size) || !SHA256.test(original.sha256 ?? '') ||
              expectedSha256 && original.sha256 !== expectedSha256)
            throw failure('WEBDAV_FILE_CHANGED', 'The original retained file differs from the selected identity.');
          const selected = { id: randomUUID(), scope, key, handle: original.handle, stamp: fileStamp(before),
            metadata: { name: original.filename, contentType: original.contentType, bytes: original.size, sha256: original.sha256 },
            tail: Promise.resolve(), closed: false, releasing: false };
          this.#reads.set(selected.id, selected); this.#touch(selected); return selected;
        } catch (error) { await original.handle.close(); throw error; }
      });
      this.#opening = pending.then(() => {}, () => {}); row = await pending;
    }
    if (!row || row.closed || row.releasing) throw failure('WEBDAV_READ_NOT_FOUND', 'Resume the original file with the same SHA256 and byte offset, omitting the expired readId.');
    if (row.scope !== scope || row.key !== key || expectedSha256 && row.metadata.sha256 !== expectedSha256)
      throw failure('WEBDAV_READ_CONFLICT', 'This read belongs to another original file selection.');
    if (offset > row.metadata.bytes) { if (!readId) await this.release(scope, row.id); throw failure('WEBDAV_INVALID_CHUNK', 'The offset exceeds the original file.'); }
    const pending = row.tail.then(async () => {
      try {
        if (row.closed || fileStamp(await row.handle.stat({ bigint: true })) !== row.stamp)
          throw failure('WEBDAV_FILE_CHANGED', 'The original file changed during delivery.');
        this.#touch(row);
        const wanted = Math.min(limit, row.metadata.bytes - offset), bytes = Buffer.alloc(wanted); let used = 0;
        while (used < wanted) {
          const part = await row.handle.read(bytes, used, wanted - used, offset + used);
          if (!part.bytesRead) throw failure('WEBDAV_FILE_CHANGED', 'The original file ended during delivery.'); used += part.bytesRead;
        }
        if (fileStamp(await row.handle.stat({ bigint: true })) !== row.stamp) throw failure('WEBDAV_FILE_CHANGED', 'The original file changed during delivery.');
        const next = offset + used, result = { readId: row.id, file: row.metadata, offset, bytesRead: used,
          nextOffset: next < row.metadata.bytes ? next : null, encoding: 'base64', data: bytes.toString('base64') };
        if (next === row.metadata.bytes) await this.#dispose(row); return result;
      } catch (error) { await this.#dispose(row); throw error; }
    });
    row.tail = pending.then(() => {}, () => {}); return pending;
  }
}

export class MerchantWebDavWorkspaces {
  #config; #handles = new Map(); #receiving = new Map(); #pending = new Set(); #closing = false; #close;
  #files = new SourceFileReads(); #results = new RetainedFileReads({ errorPrefix: 'WEBDAV' });
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
      buyerWorkspaces: Object.entries(entry.buyerWorkspaces).map(([buyerWorkspace, value]) => ({ buyerWorkspace, label: value.label })),
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
