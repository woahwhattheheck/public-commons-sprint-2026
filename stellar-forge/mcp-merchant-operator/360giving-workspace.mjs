// MIT. Merchant access to the original saved 360Giving publisher and complete handoffs.
import { constants } from 'node:fs';
import { open, lstat, mkdir, readdir, realpath, link, unlink } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { connect360GivingPublisher } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/360giving/operator/client.mjs';
import { acquireStateLease } from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import { RetainedFileReads } from './retained-file-reads.mjs';
import { publisher360GivingTools } from './catalog/360giving-workspace.mjs';
import { PUBLISHER_CONNECTION_SCHEMA, PUBLISHER_MANIFEST_NAME, PUBLISHER_MANIFEST_SCHEMA, PUBLISHER_MAX_FILE,
  PUBLISHER_MAX_MANIFEST, PUBLISHER_SHA, PUBLISHER_ALIAS, PUBLISHER_KEY, PUBLISHER_UUID,
  plain, exact, check, counter, encode, digest, failure, sourceSelection, publisherExportId,
  publisherManifest, parsePublisherManifest } from './360giving-contract.mjs';

export { publisher360GivingTools } from './catalog/360giving-workspace.mjs';
const stamp = value => [value.dev,value.ino,value.size,value.mtimeNs,value.ctimeNs,value.nlink].join(':');
const decoded = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const FILE_KINDS = new Set(['source','registry','capture','transport','decisions','handoff']);
const definitions = new Map(publisher360GivingTools((name, description, properties, required) =>
  ({ name, description, properties, required })).map(value => [value.name, value]));
function text(value, label, maximum = 240) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\x00-\x1f\x7f]/.test(value))
    throw failure('INVALID_PARAMS', label + ' must be nonempty single-line text.');
  return value;
}
function hostPath(value, base) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw failure('CONFIGURATION', 'Declare an original host file path.');
  return resolve(base, value);
}
async function directory(path, create = false) {
  if (create) await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) ||
      typeof process.getuid === 'function' && info.uid !== process.getuid() || await realpath(path) !== resolve(path))
    throw failure('PRIVATE_DIRECTORY', 'Use the original private directory without symlink aliases.');
  return path;
}
async function openedFile(path, maximum, privateFile = false) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await handle.stat({ bigint: true });
    if (!info.isFile() || info.size < 0n || info.size > BigInt(maximum) ||
        privateFile && ((info.mode & 0o077n) !== 0n || typeof process.getuid === 'function' && info.uid !== BigInt(process.getuid())))
      throw failure('FILE_INVALID', 'Select a complete regular file within its declared privacy and size limits.');
    return { handle, info };
  } catch (error) { await handle.close(); throw error; }
}
async function unchanged(path, handle, before) {
  const after = await handle.stat({ bigint: true }), current = await lstat(path, { bigint: true });
  if (stamp(before) !== stamp(after) || stamp(after) !== stamp(current) || current.isSymbolicLink())
    throw failure('FILE_CHANGED', 'The original selected file changed during its complete read.');
}
async function bytesAt(path, maximum = PUBLISHER_MAX_MANIFEST, privateFile = true) {
  const { handle, info } = await openedFile(path, maximum, privateFile);
  try {
    const bytes = Buffer.alloc(Number(info.size)); let offset = 0;
    while (offset < bytes.length) {
      const part = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!part.bytesRead) throw failure('FILE_CHANGED', 'The original file ended before its complete byte count.');
      offset += part.bytesRead;
    }
    if ((await handle.read(Buffer.alloc(1), 0, 1, offset)).bytesRead) throw failure('FILE_CHANGED', 'The selected file grew during reading.');
    await unchanged(path, handle, info); return bytes;
  } finally { await handle.close(); }
}
async function fileIdentity(path) {
  const { handle, info } = await openedFile(path, PUBLISHER_MAX_FILE, true);
  try {
    const hash = createHash('sha256'); let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) {
      bytes += chunk.length;
      if (bytes > PUBLISHER_MAX_FILE) throw failure('FILE_CHANGED', 'The selected file grew beyond its complete-file limit.');
      hash.update(chunk);
    }
    await unchanged(path, handle, info);
    if (bytes !== Number(info.size)) throw failure('FILE_CHANGED', 'The complete file byte count changed.');
    return { bytes, sha256: hash.digest('hex') };
  } finally { await handle.close(); }
}
async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
  try { await handle.sync(); } finally { await handle.close(); }
}
async function immutable(path, bytes) {
  try {
    if (!(await bytesAt(path, PUBLISHER_MAX_MANIFEST)).equals(bytes))
      throw failure('DELIVERY_CHANGED', 'The retained delivery already contains different original metadata.');
    return;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = join(dirname(path), '.publisher-' + randomUUID()), handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(bytes); await handle.sync();
    try { await link(temporary, path); await syncDirectory(dirname(path)); }
    catch (error) {
      if (error.code !== 'EEXIST' || !(await bytesAt(path, PUBLISHER_MAX_MANIFEST)).equals(bytes)) throw error;
    }
  } finally { await handle.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
function validateValue(value, definition) {
  if (definition.type === 'string' && (typeof value !== 'string' ||
      definition.pattern && !new RegExp(definition.pattern).test(value) ||
      definition.minLength !== undefined && value.length < definition.minLength ||
      definition.maxLength !== undefined && value.length > definition.maxLength))
    throw failure('INVALID_PARAMS', 'A text or identity field differs from the declared tool contract.');
  if (definition.type === 'integer' && (!Number.isSafeInteger(value) ||
      definition.minimum !== undefined && value < definition.minimum || definition.maximum !== undefined && value > definition.maximum))
    throw failure('INVALID_PARAMS', 'A page or byte count differs from the declared tool contract.');
  if (definition.enum && !definition.enum.includes(value)) throw failure('INVALID_PARAMS', 'Choose a declared original operation or kind.');
  if (definition.type === 'object') {
    if (!plain(value)) throw failure('INVALID_PARAMS', 'Supply an original object selection.');
    if (definition.additionalProperties) for (const item of Object.values(value)) validateValue(item, definition.additionalProperties);
  }
}
function page(items, input) {
  const offset = counter(input.offset ?? 0), limit = counter(input.limit ?? 50, 'Page limit', 250);
  if (!limit || offset > items.length) throw failure('INVALID_PARAMS', 'Choose a page within the original complete inventory.');
  const snapshot = digest(encode(items));
  if (input.expectedSnapshot !== undefined && input.expectedSnapshot !== snapshot)
    throw failure('INVENTORY_CHANGED', 'The original inventory changed; continue a new page-zero snapshot.');
  if (offset && !input.expectedSnapshot) throw failure('SNAPSHOT_REQUIRED', 'Repeat the original inventory snapshot for every later page.');
  return { total: items.length, snapshot, offset, items: items.slice(offset, offset + limit),
    nextOffset: offset + limit < items.length ? offset + limit : null };
}

/** Read only host-declared console and file references. No tool argument selects a local path. */
export async function read360GivingWorkspaceConfiguration(path) {
  path = resolve(path);
  const raw = JSON.parse(decoded(await bytesAt(path, 4 * 1024 * 1024)));
  exact(raw, ['schema','workspaces'], ['schema','workspaces']);
  if (raw.schema !== PUBLISHER_CONNECTION_SCHEMA || !plain(raw.workspaces) ||
      Object.keys(raw.workspaces).length < 1 || Object.keys(raw.workspaces).length > 32)
    throw failure('CONFIGURATION', 'Declare 1–32 original saved publisher workspaces.');
  const base = dirname(path), workspaces = Object.create(null);
  for (const [alias, input] of Object.entries(raw.workspaces)) {
    check(alias, PUBLISHER_ALIAS, 'workspace alias');
    exact(input, ['label','connectionFile','expectedWorkspaceId','files'], ['connectionFile']);
    if (input.files !== undefined && (!plain(input.files) || Object.keys(input.files).length > 256))
      throw failure('CONFIGURATION', 'Declare up to 256 complete source-file handles per publisher.');
    const files = Object.create(null);
    for (const [name, file] of Object.entries(input.files ?? {})) {
      check(name, PUBLISHER_ALIAS, 'source-file handle');
      exact(file, ['path','kind','sha256'], ['path','kind']);
      if (!FILE_KINDS.has(file.kind)) throw failure('CONFIGURATION', 'Choose an original package, registry, capture, transport, decision or handoff file.');
      files[name] = { path: hostPath(file.path, base), kind: file.kind,
        ...(file.sha256 === undefined ? {} : { sha256: check(file.sha256, PUBLISHER_SHA, 'source-file SHA256') }) };
    }
    workspaces[alias] = { label: text(input.label ?? alias, 'Publisher label'),
      connectionFile: hostPath(input.connectionFile, base), files,
      ...(input.expectedWorkspaceId === undefined ? {} :
        { expectedWorkspaceId: check(input.expectedWorkspaceId, PUBLISHER_UUID, 'original publisher UUID') }) };
  }
  return { schema: PUBLISHER_CONNECTION_SCHEMA, workspaces };
}

export class Merchant360GivingWorkspaces {
  #config; #clients = new Map(); #opening = new Map(); #retaining = new Map(); #pending = new Set();
  #reads = new RetainedFileReads({ errorPrefix: 'PUBLISHER360' });
  #closing = false; #close = null; #timeout;
  constructor(config, { timeoutMs = 240000 } = {}) {
    if (!plain(config) || !plain(config.publisher360Giving?.workspaces) || typeof config.exportsDirectory !== 'string')
      throw failure('CONFIGURATION', 'Open the declared saved-publisher merchant configuration.');
    this.#config = config; this.#timeout = counter(timeoutMs, 'Request timeout', 900000);
    if (!this.#timeout) throw failure('CONFIGURATION', 'Use a positive original request timeout.');
  }
  #definition(alias) {
    check(alias, PUBLISHER_ALIAS, 'workspace alias');
    const value = this.#config.publisher360Giving.workspaces[alias];
    if (!value) throw failure('WORKSPACE_NOT_CONFIGURED', 'Choose a publisher from merchant_360giving_workspaces.');
    return value;
  }
  get summary() {
    return { configured: true, workspaces: Object.entries(this.#config.publisher360Giving.workspaces).map(([workspace, value]) =>
      ({ workspace, label: value.label, expectedWorkspaceId: value.expectedWorkspaceId ?? null,
        files: Object.entries(value.files).map(([file, item]) => ({ file, kind: item.kind, sha256: item.sha256 ?? null })) })),
      connected: [...this.#clients.keys()], closing: this.#closing, retainedReads: this.#reads.summary };
  }
  async #client(alias) {
    if (this.#closing) throw failure('CLOSING', 'The original merchant owner is closing.');
    if (this.#clients.has(alias)) return this.#clients.get(alias);
    if (!this.#opening.has(alias)) {
      const value = this.#definition(alias);
      const pending = connect360GivingPublisher({ connectionFile: value.connectionFile,
        expectedWorkspaceId: value.expectedWorkspaceId, timeoutMs: this.#timeout }).then(async client => {
        if (this.#closing) { await client.close(); throw failure('CLOSING', 'The original merchant owner is closing.'); }
        this.#clients.set(alias, client); return client;
      }).finally(() => this.#opening.delete(alias));
      this.#opening.set(alias, pending);
    }
    return this.#opening.get(alias);
  }
  async #aliasDirectory(alias, create = false) {
    this.#definition(alias);
    const exportsRoot = await directory(resolve(this.#config.exportsDirectory));
    const root = await directory(join(exportsRoot, 'publisher-360giving'), create);
    return directory(join(root, alias), create);
  }
  async #layout(alias, workspaceId, exportId) {
    check(workspaceId, PUBLISHER_UUID, 'original publisher UUID'); check(exportId, PUBLISHER_SHA, 'retained export ID');
    const root = await this.#aliasDirectory(alias, true);
    return directory(join(await directory(join(root, workspaceId), true), exportId), true);
  }
  async #manifestAt(alias, workspaceId, exportId) {
    const root = await this.#aliasDirectory(alias);
    const folder = await directory(join(await directory(join(root, workspaceId)), exportId));
    const bytes = await bytesAt(join(folder, PUBLISHER_MANIFEST_NAME));
    const manifest = parsePublisherManifest(bytes, exportId);
    if (manifest.workspace.alias !== alias || manifest.workspace.id !== workspaceId)
      throw failure('DELIVERY_CHANGED', 'The retained manifest belongs to a different original publisher.');
    return { folder, bytes, manifest, manifestSha256: digest(bytes) };
  }
  async #findExport(alias, exportId) {
    this.#definition(alias); check(exportId, PUBLISHER_SHA, 'retained export ID');
    let root;
    try { root = await this.#aliasDirectory(alias); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (root) for (const id of (await readdir(root)).filter(value => PUBLISHER_UUID.test(value)).sort()) {
      try { return await this.#manifestAt(alias, id, exportId); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    throw failure('EXPORT_NOT_FOUND', 'Retain this complete native export through its original saved request.');
  }
  #descriptor(value) {
    const { manifest, bytes, manifestSha256 } = value;
    return { state: 'FILES_RETAINED', exportId: manifest.exportId, workspace: manifest.workspace.alias,
      workspaceId: manifest.workspace.id, kind: manifest.kind, selection: manifest.selection,
      files: manifest.files, manifestSha256,
      manifestFile: { name: PUBLISHER_MANIFEST_NAME, bytes: bytes.length, sha256: manifestSha256, contentType: 'application/json' } };
  }
  async #exports(alias) {
    let root;
    try { root = await this.#aliasDirectory(alias); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!root) return [];
    const results = [];
    for (const id of (await readdir(root)).filter(value => PUBLISHER_UUID.test(value)).sort()) {
      const sourceRoot = await directory(join(root, id));
      for (const exportId of (await readdir(sourceRoot)).filter(value => PUBLISHER_SHA.test(value)).sort()) {
        try { results.push(this.#descriptor(await this.#manifestAt(alias, id, exportId))); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
    return results.sort((a, b) => a.exportId.localeCompare(b.exportId));
  }
  async #retain(alias, client, kind, original, selected) {
    const workspaceId = kind === 'handoff' ? original.workspaceId : (await client.state()).id;
    check(workspaceId, PUBLISHER_UUID, 'original publisher UUID');
    const selection = sourceSelection(kind, selected), workspace = { alias, id: workspaceId };
    const exportId = publisherExportId(workspace, kind, selection), key = alias + '/' + exportId;
    if (this.#retaining.has(key)) return this.#retaining.get(key);
    const pending = (async () => {
      const folder = await this.#layout(alias, workspaceId, exportId);
      const lease = await acquireStateLease(folder); let operationError;
      try {
        const name = kind === 'handoff' ? '360giving-complete-handoff.zip' : '360giving-complete-changes.jsonl';
        const output = join(folder, name);
        let completed;
        if (kind === 'handoff') completed = await client.downloadExport(selection.requestId, { output });
        else completed = await client.downloadChanges({ ...selection, output });
        lease.assertHeld();
        const info = await fileIdentity(output);
        if (completed.path !== output || completed.bytes !== info.bytes || completed.sha256 !== info.sha256)
          throw failure('DELIVERY_CHANGED', 'The complete original file differs from its native export.');
        const manifest = publisherManifest({ schema: PUBLISHER_MANIFEST_SCHEMA, exportId, workspace, kind, selection,
          original, files: [{ name, ...info, contentType: kind === 'handoff' ? 'application/zip' : 'application/x-ndjson' }] });
        const bytes = encode(manifest);
        if (bytes.length > PUBLISHER_MAX_MANIFEST) throw failure('MANIFEST_LIMIT', 'The complete native delivery metadata exceeds its original limit.');
        await immutable(join(folder, PUBLISHER_MANIFEST_NAME), bytes);
        lease.assertHeld();
        return this.#descriptor({ folder, manifest, bytes, manifestSha256: digest(bytes) });
      } catch (error) { operationError = error; throw error; }
      finally {
        try { await lease.close(); } catch (error) {
          const primary = operationError ?? error; primary.close = () => lease.close();
          if (operationError) primary.closeError = error;
          throw primary;
        }
      }
    })().finally(() => this.#retaining.delete(key));
    this.#retaining.set(key, pending); return pending;
  }
  async #submit(alias, action, requestId, input) {
    const client = await this.#client(alias), record = await client.submit({ id: requestId, action, input });
    const result = { workspace: alias, workspaceId: record.workspaceId, request: record };
    if (action === 'export' && record.status === 'complete') result.delivery = await this.#retain(alias, client, 'handoff', record,
      { requestId, edition: input.edition, decision: input.decision ?? null, candidate: input.candidate ?? null });
    return result;
  }
  async #execute(name, input) {
    if (name === 'merchant_360giving_workspaces') return this.summary;
    const alias = input.workspace, definition = this.#definition(alias);
    if (name === 'merchant_360giving_exports') return { workspace: alias, ...page(await this.#exports(alias), input) };
    if (['merchant_360giving_manifest','merchant_360giving_file','merchant_360giving_file_release'].includes(name)) {
      const found = await this.#findExport(alias, input.exportId);
      if (name === 'merchant_360giving_manifest') return { ...this.#descriptor(found), state: 'MANIFEST_RETAINED' };
      const scope = alias + '/' + input.exportId;
      if (name === 'merchant_360giving_file_release') {
        await this.#reads.release(scope, input.readId);
        return { workspace: alias, exportId: input.exportId, readId: input.readId, state: 'RELEASED' };
      }
      if (input.expectedManifestSha256 !== found.manifestSha256) throw failure('MANIFEST_CHANGED', 'Repeat this export’s original complete manifest SHA256.');
      const file = input.file === PUBLISHER_MANIFEST_NAME
        ? this.#descriptor(found).manifestFile : found.manifest.files.find(item => item.name === input.file);
      if (!file || input.expectedSha256 !== file.sha256) throw failure('FILE_CHANGED', 'Select an original file from this exact delivery manifest.');
      const result = await this.#reads.read({ scope, key: input.exportId + '/' + file.name, kind: '360giving-' + found.manifest.kind,
        directory: found.folder, expectedSha256: file.sha256, readId: input.readId, offset: input.offset, limit: input.limit,
        load: async () => {
          const { handle, info } = await openedFile(join(found.folder, file.name), file.name === PUBLISHER_MANIFEST_NAME ? PUBLISHER_MAX_MANIFEST : PUBLISHER_MAX_FILE, true);
          if (Number(info.size) !== file.bytes) { await handle.close(); throw failure('FILE_CHANGED', 'The complete retained file byte count changed.'); }
          return { readonlyFileHandle: handle, bytes: file.bytes, sha256: file.sha256, name: file.name, type: file.contentType };
        } });
      return { workspace: alias, exportId: input.exportId, manifestSha256: found.manifestSha256, ...result };
    }
    const client = await this.#client(alias);
    if (name === 'merchant_360giving_status') {
      const state = await client.state();
      return { workspace: alias, workspaceId: state.id, schema: state.schema, label: definition.label,
        counts: Object.fromEntries(['datasets','editions','decisions','candidates','requests'].map(kind => [kind, state[kind].length])),
        numericEncoding: 'original-json-number-tokens-as-strings' };
    }
    if (name === 'merchant_360giving_inventory') {
      const native = input.kind.startsWith('native-');
      if (native !== (input.dataset !== undefined)) throw failure('INVALID_PARAMS', 'Select a dataset only for original native builds or comparisons.');
      const state = native ? await client.nativeState(input.dataset) : await client.state();
      const key = native ? input.kind.slice(7) : input.kind;
      if (!Array.isArray(state[key])) throw failure('WORKSPACE_CHANGED', 'The original inventory has a different source contract.');
      return { workspace: alias, kind: input.kind, ...(native ? { dataset: input.dataset } : {}), ...page(state[key], input) };
    }
    if (name === 'merchant_360giving_review') return { workspace: alias, result: await client.review({ edition: input.edition, decision: input.decision }) };
    if (name === 'merchant_360giving_upload') {
      const file = definition.files[input.file];
      if (!file) throw failure('FILE_NOT_CONFIGURED', 'Select a declared complete source-file handle.');
      return { workspace: alias, file: input.file, kind: file.kind, result: await client.upload(file.path, { expectedSha256: file.sha256 }) };
    }
    if (name === 'merchant_360giving_upload_text') return { workspace: alias, result: await client.uploadText(input.text) };
    if (name === 'merchant_360giving_request') return { workspace: alias, request: await client.request(input.requestId) };
    if (name === 'merchant_360giving_resume') return { workspace: alias, request: await client.resume(input.requestId) };
    if (name === 'merchant_360giving_query') return { workspace: alias, result: await client.query({ dataset: input.dataset, build: input.build, query: input.query ?? {} }) };
    if (name === 'merchant_360giving_changes') return { workspace: alias, result: await client.changes({
      dataset: input.dataset, comparison: input.comparison, offset: input.offset, limit: input.limit }) };
    if (name === 'merchant_360giving_changes_export') {
      const state = await client.nativeState(input.dataset), original = state.comparisons.find(item => item.id === input.comparison);
      if (!original) throw failure('COMPARISON_NOT_FOUND', 'Select a retained native comparison for this dataset.');
      return this.#retain(alias, client, 'changes', original, { dataset: input.dataset, comparison: input.comparison });
    }
    if (name === 'merchant_360giving_receive') {
      if ((input.file === undefined) === (input.exportId === undefined))
        throw failure('INVALID_PARAMS', 'Choose exactly one declared handoff file or retained complete export.');
      let path, sha256;
      if (input.file !== undefined) {
        if (input.fromWorkspace !== undefined) throw failure('INVALID_PARAMS', 'fromWorkspace selects a retained export.');
        const file = definition.files[input.file];
        if (!file || file.kind !== 'handoff') throw failure('FILE_NOT_CONFIGURED', 'Select a declared complete publisher handoff.');
        path = file.path; sha256 = file.sha256;
      } else {
        const original = await this.#findExport(input.fromWorkspace ?? alias, input.exportId);
        if (original.manifest.kind !== 'handoff') throw failure('INVALID_PARAMS', 'Receive the complete publisher handoff ZIP.');
        path = join(original.folder, original.manifest.files[0].name); sha256 = original.manifest.files[0].sha256;
      }
      const uploaded = await client.upload(path, { expectedSha256: sha256 });
      return this.#submit(alias, 'receive', input.requestId, { object: uploaded.id });
    }
    const action = name.slice('merchant_360giving_'.length);
    const bodies = {
      intake: () => ({ dataset: input.dataset, label: input.label, sourceUrl: input.sourceUrl, source: input.source,
        registry: input.registry, capture: input.capture ?? null, transport: input.transport ?? null }),
      decisions: () => ({ edition: input.edition, object: input.object }),
      candidate: () => ({ edition: input.edition, decision: input.decision }),
      build: () => ({ edition: input.edition, candidate: input.candidate ?? null }),
      compare: () => ({ dataset: input.dataset, before: input.before, after: input.after }),
      export: () => ({ edition: input.edition, decision: input.decision ?? null, candidate: input.candidate ?? null })
    };
    if (!bodies[action]) throw failure('TOOL_NOT_FOUND', 'Choose an original saved-publisher tool.');
    return this.#submit(alias, action, input.requestId, bodies[action]());
  }
  async call(name, args = {}) {
    if (this.#closing) throw failure('CLOSING', 'The original merchant owner is closing.');
    const definition = definitions.get(name);
    if (!definition) throw failure('TOOL_NOT_FOUND', 'Choose an original saved-publisher tool.');
    exact(args, Object.keys(definition.properties), definition.required);
    for (const [key, value] of Object.entries(args)) validateValue(value, definition.properties[key]);
    if (Buffer.byteLength(JSON.stringify(args)) > 128 * 1024) throw failure('REQUEST_LIMIT', 'Use complete configured files for original source beyond 128 KiB.');
    const pending = Promise.resolve().then(() => this.#execute(name, args)); this.#pending.add(pending);
    try { return await pending; } finally { this.#pending.delete(pending); }
  }
  requestClose() { this.#closing = true; }
  close() {
    this.#closing = true;
    if (!this.#close) this.#close = (async () => {
      await Promise.allSettled([...this.#pending, ...this.#opening.values()]);
      await Promise.all([...this.#clients.values()].map(client => client.close()));
      await this.#reads.close();
    })().catch(error => { this.#close = null; throw error; });
    return this.#close;
  }
}
