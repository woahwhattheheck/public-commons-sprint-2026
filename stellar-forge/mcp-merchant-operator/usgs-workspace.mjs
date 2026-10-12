import { usgsWorkspaceTools, read, selection, page, id, chunk, analysis, analysisDetail, digest, edition, alias, mapping, dss, DSS_KINDS, UUID, ID, ANALYSIS_VIEWS, SHA, ALIAS } from './catalog/usgs-workspace.mjs';
export { usgsWorkspaceTools } from './catalog/usgs-workspace.mjs';
// MIT. The original Water console, native DSS operations and complete agent receiving.
import { constants } from 'node:fs';
import { open, lstat, realpath, mkdir, readdir, rename, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { acquireStateLease } from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import { openUSGSHandoverStream } from './usgs-handover-stream.mjs';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { USGS_DELIVERY_SCHEMA, USGS_DELIVERY_MANIFEST, USGS_MAX_HANDOVER_BYTES, parseUSGSDeliveryManifest } from './usgs-delivery.mjs';

export const USGS_WORKSPACE_CONNECTION_SCHEMA = 'stellar-forge.usgs-workspace-connection.v1';




const MAX_JSON = 2 * 1024 * 1024;
const MAX_NATIVE_FILE = 256 * 1024 * 1024;


const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const fail = (code, message) => Object.assign(new Error(message), { code });
function exact(value, keys, required = []) {
  if (!plain(value) || Object.keys(value).some(key => !keys.includes(key)) || required.some(key => !Object.hasOwn(value, key)))
    throw fail('INVALID_PARAMS', 'Supply only declared fields and every required field.');
}
function checked(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) throw fail('INVALID_PARAMS', 'Use a valid ' + label + '.');
  return value;
}
function integer(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw fail('INVALID_PARAMS', 'Use an integer within its declared range.');
  return value;
}
function text(value, maximum = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\x00-\x1f\x7f]/.test(value))
    throw fail('INVALID_PARAMS', 'Use nonempty single-line text within its declared length.');
  return value.trim();
}
function object(value, label) {
  if (!plain(value) || Buffer.byteLength(JSON.stringify(value)) > MAX_JSON)
    throw fail('INVALID_PARAMS', 'Supply the complete original ' + label + ' within the native 2 MiB request limit.');
  return value;
}
function hostPath(value, base) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw fail('CONFIGURATION_ERROR', 'Declare an original host path.');
  return resolve(base, value);
}
async function directory(path, create = false) {
  if (create) await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || process.platform !== 'win32' && (info.mode & 0o077) || await realpath(path) !== path)
    throw fail('USGS_PRIVATE_DIRECTORY_REQUIRED', 'Use an existing canonical private directory (0700).');
  return path;
}
async function regular(path, maximum) {
  if (await realpath(dirname(path)) !== dirname(path)) throw fail('USGS_FILE_CHANGED', 'The selected original file parent changed.');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await handle.stat({ bigint: true });
    if (!info.isFile() || info.size > BigInt(maximum) || info.nlink !== 1n ||
        process.platform !== 'win32' && (info.mode & 0o077n))
      throw fail('USGS_PRIVATE_FILE_REQUIRED', 'Use a private original regular file within its native size limit.');
    return { handle, info };
  } catch (error) { await handle.close(); throw error; }
}
function unchanged(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
async function privateBytes(path, maximum = MAX_JSON, expectedSha256) {
  const { handle, info } = await regular(path, maximum);
  try {
    const bytes = await handle.readFile();
    if (bytes.length !== Number(info.size) || !unchanged(info, await handle.stat({ bigint: true })) ||
        expectedSha256 !== undefined && hash(bytes) !== expectedSha256)
      throw fail('USGS_FILE_CHANGED', 'The selected original file changed.');
    return bytes;
  } finally { await handle.close(); }
}
async function fileDescription(path, maximum, expectedSha256) {
  const { handle, info } = await regular(path, maximum), h = createHash('sha256');
  try {
    for await (const chunk of handle.createReadStream({ start: 0, autoClose: false })) h.update(chunk);
    const sha256 = h.digest('hex');
    if (!unchanged(info, await handle.stat({ bigint: true })) || expectedSha256 !== undefined && expectedSha256 !== sha256)
      throw fail('USGS_FILE_CHANGED', 'The selected original file differs from its retained hash.');
    return { bytes: Number(info.size), sha256 };
  } finally { await handle.close(); }
}
async function immutableJson(path, value) {
  const bytes = encode(value), parent = await directory(dirname(path), true);
  const lease = await acquireStateLease(parent), temporary = join(parent, '.manifest.next');
  try {
    try {
      const retained = await privateBytes(path, 65000);
      if (!retained.equals(bytes)) throw fail('USGS_DELIVERY_CONFLICT', 'This delivery ID already retains a different original handover.');
      return retained;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    lease.assertHeld(); await rename(temporary, path);
    const folder = await open(parent, constants.O_RDONLY);
    try { await folder.sync(); } finally { await folder.close(); }
    return bytes;
  } finally { await lease.close(); }
}

function publicValue(value) {
  if (Array.isArray(value)) return value.map(publicValue);
  if (!plain(value)) return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (['token','directory','root','promise','buyerConfig','privateKey','secretKey','environment'].includes(key)) continue;
    result[key] = publicValue(item);
  }
  return result;
}
function paged(items, input) {
  const offset = integer(input.offset ?? 0), limit = integer(input.limit ?? 50, 1, 250);
  const identity = createHash('sha256'); identity.update('[');
  for (let i = 0; i < items.length; i++) { if (i) identity.update(','); identity.update(JSON.stringify(items[i])); }
  identity.update(']'); const snapshot = identity.digest('hex');
  if (input.expectedSnapshot !== undefined && checked(input.expectedSnapshot, SHA, 'inventory hash') !== snapshot)
    throw fail('USGS_INVENTORY_CHANGED', 'Read page zero again; the original inventory changed.');
  if (offset > 0 && input.expectedSnapshot === undefined) throw fail('USGS_SNAPSHOT_REQUIRED', 'Repeat the returned inventory hash when paging.');
  if (offset > items.length) throw fail('INVALID_PARAMS', 'Offset exceeds the original inventory.');
  const selected = []; let bytes = 0;
  for (let i = offset; i < Math.min(offset + limit, items.length); i++) {
    const size = Buffer.byteLength(JSON.stringify(items[i]));
    if (bytes + size > 400000) {
      if (!selected.length) throw fail('USGS_PAGE_ITEM_TOO_LARGE', 'Use the complete retained review, source page or native plan file for this unusually large record.');
      break;
    }
    selected.push(items[i]); bytes += size;
  }
  return { total: items.length, snapshot, offset, items: selected, nextOffset: offset + selected.length < items.length ? offset + selected.length : null };
}
function kind(value, choices) {
  if (!choices.includes(value)) throw fail('INVALID_PARAMS', 'Choose a declared original file or inventory kind.');
  return value;
}


function analysisPage(value, input) {
  const view = kind(input.view ?? 'series', ANALYSIS_VIEWS), analysis = value.analysis;
  const observations = ['observations','baseline-observations'].includes(view);
  const records = ['conflict-records','unresolved-previous','unresolved-current'].includes(view);
  if (observations !== (input.seriesKey !== undefined) || records !== (input.featureKey !== undefined))
    throw fail('INVALID_PARAMS', 'Select seriesKey for an observation view, or featureKey for a conflict-record view.');
  const count = rows => ({ total: rows?.length ?? 0 });
  const summary = value => {
    if (value === null) return null;
    const { observationsByTime = [], ...rest } = value;
    return { ...rest, observationsByTime: count(observationsByTime) };
  };
  const compactSeries = analysis.series.map(row => ({ ...row, current: summary(row.current), baseline: summary(row.baseline) }));
  const result = { ...value, view, analysis: { ...analysis, source: { ...analysis.source, pages: count(analysis.source.pages) },
    series: count(analysis.series), conflicts: count(analysis.conflicts) }, comparison: value.comparison ? { ...value.comparison } : null };
  if (result.comparison) for (const key of ['added','removed','changed','unresolved']) result.comparison[key] = count(value.comparison[key]);
  if (view === 'series') result.analysis.series = paged(compactSeries, input);
  else if (view === 'source-pages') result.analysis.source.pages = paged(analysis.source.pages, input);
  else if (observations) {
    const selected = analysis.series.find(row => row.key === input.seriesKey);
    if (!selected) throw fail('INVALID_PARAMS', 'Choose a complete original series key from the series view.');
    const rows = (view === 'observations' ? selected.current : selected.baseline)?.observationsByTime ?? [];
    result.analysis.observations = { seriesKey: selected.key, window: view, ...paged(rows, input) };
  } else if (view === 'conflicts') result.analysis.conflicts = paged(analysis.conflicts.map(({ records, ...row }) => ({ ...row, records: count(records) })), input);
  else if (view === 'conflict-records') {
    const conflict = analysis.conflicts.find(row => row.identityKey === input.featureKey);
    if (!conflict) throw fail('INVALID_PARAMS', 'Choose an original feature identity from the conflicts view.');
    result.analysis.conflict = { identityKey: conflict.identityKey, records: paged(conflict.records, input) };
  } else {
    if (!value.comparison) throw fail('INVALID_PARAMS', 'Select an original comparison capture before reading its change records.');
    if (view === 'unresolved') result.comparison.unresolved = paged(value.comparison.unresolved.map(({ previous, current, ...row }) =>
      ({ ...row, previous: count(previous), current: count(current) })), input);
    else if (records) {
      const conflict = value.comparison.unresolved.find(row => row.identityKey === input.featureKey);
      if (!conflict) throw fail('INVALID_PARAMS', 'Choose an original feature identity from the unresolved view.');
      result.comparison.conflict = { identityKey: conflict.identityKey, side: view,
        records: paged(view === 'unresolved-previous' ? conflict.previous : conflict.current, input) };
    } else result.comparison[view] = paged(value.comparison[view], input);
  }
  return result;
}
function planPage(value, input) {
  const { mapping, series = [], ...metadata } = value;
  const selected = series.map((row, i) => {
    const { excluded = [], ...rest } = row;
    return { ...rest, excluded: { total: excluded.length }, ...(mapping ? { mapping: mapping.series[i] } : {}) };
  });
  return { ...metadata, ...(mapping ? { mapping: { schema: mapping.schema, title: mapping.title,
    selectedSeriesCount: mapping.series.length, excludedSeriesCount: mapping.excludedSeries.length } } : {}),
    series: paged(selected, input) };
}

/** Configured references are selected by the operator, never supplied as MCP paths. */
export async function readUSGSWorkspaceConfiguration(path) {
  path = resolve(path);
  const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await privateBytes(path, 1024 * 1024)));
  exact(raw, ['schema','workspaces'], ['schema','workspaces']);
  if (raw.schema !== USGS_WORKSPACE_CONNECTION_SCHEMA || !plain(raw.workspaces) || Object.keys(raw.workspaces).length < 1 || Object.keys(raw.workspaces).length > 32)
    throw fail('CONFIGURATION_ERROR', 'Declare 1–32 original Water project workspaces.');
  const base = dirname(path), workspaces = Object.create(null), directories = new Set();
  for (const [workspace, input] of Object.entries(raw.workspaces)) {
    checked(workspace, ALIAS, 'workspace alias');
    exact(input, ['label','directory','files'], ['directory']);
    const selected = await directory(hostPath(input.directory, base));
    if (directories.has(selected)) throw fail('CONFIGURATION_ERROR', 'Declare each original project directory once.');
    directories.add(selected);
    if (input.files !== undefined && (!plain(input.files) || Object.keys(input.files).length > 128))
      throw fail('CONFIGURATION_ERROR', 'Declare up to 128 original mapping or handover file handles.');
    const files = Object.create(null);
    for (const [name, file] of Object.entries(input.files ?? {})) {
      checked(name, ALIAS, 'file handle'); exact(file, ['path','kind','sha256'], ['path','kind']);
      files[name] = { path: hostPath(file.path, base), kind: kind(file.kind, ['mapping','handover']),
        ...(file.sha256 === undefined ? {} : { sha256: checked(file.sha256, SHA, 'configured file hash') }) };
    }
    workspaces[workspace] = { label: text(input.label ?? workspace), directory: selected, files };
  }
  return { schema: USGS_WORKSPACE_CONNECTION_SCHEMA, workspaces };
}










const definitions = new Map(usgsWorkspaceTools((name, description, properties, required) => ({ name, properties, required })).map(value => [value.name, value]));

export class MerchantUSGSWorkspaces {
  #config; #sessions = new Map(); #opening = new Map(); #stopping = new Map(); #pending = new Set(); #workspaceCalls = new Map(); #epochs = new Map(); #requests = new Set(); #closing = false; #close;
  #reads = new RetainedFileReads({ errorPrefix: 'USGS' });
  constructor(config) { this.#config = config; }
  get summary() {
    return { configured: Boolean(this.#config.usgsWorkspaces), ...this.#reads.summary,
      workspaces: Object.entries(this.#config.usgsWorkspaces?.workspaces ?? {}).map(([workspace, value]) => ({
        workspace, label: value.label, opened: this.#sessions.has(workspace), opening: this.#opening.has(workspace), stopping: this.#stopping.has(workspace),
        files: Object.entries(value.files).map(([file, input]) => ({ file, kind: input.kind, sha256: input.sha256 ?? null })),
        fileReads: this.#reads.status(workspace), ownership: 'ORIGINAL_WATER_WORKSPACE' })) };
  }
  #definition(workspace) {
    checked(workspace, ALIAS, 'workspace alias');
    const value = this.#config.usgsWorkspaces?.workspaces[workspace];
    if (!value) throw fail('USGS_WORKSPACE_NOT_CONFIGURED', 'Choose a declared original Water project from merchant_usgs_workspaces.');
    return value;
  }
  #session(workspace) {
    this.#definition(workspace);
    const value = this.#sessions.get(workspace);
    if (!value || this.#stopping.has(workspace)) throw fail('USGS_WORKSPACE_NOT_OPEN', 'Open or reopen this original Water workspace before operating it.');
    return value;
  }
  async #open(workspace) {
    const definition = this.#definition(workspace);
    if (this.#closing || this.#stopping.has(workspace)) throw fail('USGS_WORKSPACE_CLOSING', 'The selected original workspace is closing.');
    if (this.#sessions.has(workspace)) return { workspace, state: 'OPEN', url: this.#sessions.get(workspace).url, reopened: true };
    let pending = this.#opening.get(workspace);
    if (!pending) {
      pending = (async () => {
        await directory(definition.directory);
        const { startWaterWorkspace } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/usgs-water/workspace.mjs');
        const session = await startWaterWorkspace({ directory: definition.directory });
        if (this.#closing || this.#stopping.has(workspace)) { await session.close(); throw fail('USGS_WORKSPACE_CLOSING', 'The workspace closed during its original opening.'); }
        this.#sessions.set(workspace, session); return session;
      })();
      this.#opening.set(workspace, pending);
      pending.finally(() => this.#opening.delete(workspace)).catch(() => {});
    }
    const session = await pending;
    return { workspace, state: 'OPEN', url: session.url, reopened: false };
  }
  #admitted(workspace, epoch) {
    if (this.#closing || this.#stopping.has(workspace) || epoch !== (this.#epochs.get(workspace) ?? 0))
      throw fail('USGS_WORKSPACE_CLOSING', 'This original workspace admission ended. Reopen the saved project before continuing.');
  }
  #closeWorkspace(workspace) {
    this.#definition(workspace);
    if (this.#stopping.has(workspace)) return this.#stopping.get(workspace);
    this.#epochs.set(workspace, (this.#epochs.get(workspace) ?? 0) + 1);
    const admitted = [...(this.#workspaceCalls.get(workspace) ?? [])];
    const pending = (async () => {
      for (const entry of this.#requests) if (entry.workspace === workspace) entry.controller.abort();
      await this.#opening.get(workspace)?.catch(() => {});
      const session = this.#sessions.get(workspace);
      const outcomes = await Promise.allSettled([
        Promise.resolve().then(() => session?.close()),
        this.#reads.closeScope(workspace),
        Promise.allSettled(admitted),
      ]);
      const rejected = outcomes.find(value => value.status === 'rejected');
      if (rejected) throw rejected.reason;
      if (this.#sessions.get(workspace) === session) this.#sessions.delete(workspace);
      return { workspace, state: 'CLOSED', savedWorkRetained: true };
    })();
    this.#stopping.set(workspace, pending);
    pending.finally(() => this.#stopping.delete(workspace)).catch(() => {});
    return pending;
  }
  async #post(workspace, route, input) {
    const session = this.#session(workspace);
    const controller = new AbortController(), active = { workspace, controller }; this.#requests.add(active);
    try {
      const token = (await session.view()).token;
      controller.signal.throwIfAborted();
      const bytes = encode(input);
      if (bytes.length > MAX_JSON) throw fail('INVALID_PARAMS', 'Native request exceeds 2 MiB.');
      const response = await fetch(session.url + route, { method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'content-type': 'application/json', 'x-workspace-token': token }, body: bytes });
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > (route === '/api/reviews' ? 64 * 1024 * 1024 : MAX_JSON)) {
          await response.body.cancel?.().catch(() => {});
          throw fail('USGS_NATIVE_REPLY_TOO_LARGE', 'Reopen the saved original operation and its retained files.');
        }
        chunks.push(chunk);
      }
      const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
      if (!response.ok) throw fail(result.error?.code ?? 'USGS_NATIVE_REJECTED', result.error?.message ?? 'The original Water operation was rejected.');
      return publicValue(result);
    } catch (error) {
      if (controller.signal.aborted) throw fail('USGS_OPERATION_INTERRUPTED', 'This original workspace closed. Reopen its saved operation or source pages.');
      throw error;
    } finally { this.#requests.delete(active); }
  }
  async #mapping(workspace, input) {
    if ((input.mapping === undefined) === (input.mappingFile === undefined))
      throw fail('INVALID_PARAMS', 'Select exactly one complete mapping object or declared mapping file.');
    if (input.mapping !== undefined) {
      if (input.expectedMappingFileSha256 !== undefined) throw fail('INVALID_PARAMS', 'A file hash selects a declared mapping file.');
      return object(input.mapping, 'DSS mapping');
    }
    const file = this.#configured(workspace, input.mappingFile, 'mapping');
    const expected = checked(input.expectedMappingFileSha256, SHA, 'reviewed mapping-file hash');
    if (file.sha256 && file.sha256 !== expected) throw fail('USGS_FILE_CHANGED', 'The requested mapping differs from its configured original file.');
    return object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await privateBytes(file.path, MAX_JSON, expected))), 'DSS mapping');
  }
  #configured(workspace, name, expectedKind) {
    const input = this.#definition(workspace).files[checked(name, ALIAS, 'configured file handle')];
    if (!input || expectedKind && input.kind !== expectedKind) throw fail('INVALID_PARAMS', 'Choose a declared original file of the required kind.');
    return input;
  }
  async #readDirectory(workspace) {
    const base = await directory(join(this.#config.exportsDirectory, 'usgs-file-reads'), true);
    return directory(join(base, workspace), true);
  }
  async #nativeDssFile(workspace, dssId, selectedKind) {
    const configured = this.#definition(workspace);
    checked(dssId, ID, 'native DSS ID'); kind(selectedKind, DSS_KINDS);
    const native = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/usgs-water/dss.mjs');
    if (selectedKind === 'plan') {
      const directory = join(configured.directory, 'dss-exports');
      const operation = await native.readDssOperation({ directory, exportId: dssId });
      const expected = operation.plan ? hash(encode(operation.plan)) : operation.files?.find(file => file.path === 'plan.json')?.sha256;
      const path = join(directory, dssId, 'plan.json');
      const file = await fileDescription(path, MAX_NATIVE_FILE, checked(expected, SHA, 'original native plan file hash'));
      return { path, ...file, filename: dssId + '-plan.json', mime: 'application/json' };
    }
    return (selectedKind === 'handover' ? native.dssHandoverDownload : native.dssDownload)({
      directory: join(configured.directory, 'dss-exports'), exportId: dssId, kind: selectedKind });
  }
  async #descriptor(file) {
    const { handle, info } = await regular(file.path, USGS_MAX_HANDOVER_BYTES);
    if (Number(info.size) !== file.bytes) { await handle.close(); throw fail('USGS_FILE_CHANGED', 'The original native file size changed.'); }
    return { readonlyFileHandle: handle, bytes: file.bytes, sha256: file.sha256, name: file.filename, type: file.mime };
  }
  async #fileRead(workspace, key, fileKind, input, load) {
    const epoch = this.#epochs.get(workspace) ?? 0;
    this.#admitted(workspace, epoch);
    if (input.readId !== undefined) checked(input.readId, UUID, 'original file read ID');
    const directory = await this.#readDirectory(workspace);
    this.#admitted(workspace, epoch);
    return { workspace, ...await this.#reads.read({ scope: workspace, key, kind: fileKind,
      directory, readId: input.readId, expectedSha256: input.expectedSha256,
      offset: input.offset, limit: input.limit, load }) };
  }
  async #receive(workspace, input) {
    const session = this.#session(workspace);
    const expectedSha256 = checked(input.expectedSha256, SHA, 'selected handover hash');
    const controller = new AbortController(), entry = { workspace, controller }; this.#requests.add(entry);
    let selected;
    try {
      let file;
      if (input.file !== undefined) {
        if (input.fromWorkspace !== undefined || input.dssId !== undefined) throw fail('INVALID_PARAMS', 'Choose a configured handover file or one original source workspace/export, not both.');
        const configured = this.#configured(workspace, input.file, 'handover');
        if (configured.sha256 && configured.sha256 !== expectedSha256) throw fail('USGS_FILE_CHANGED', 'The selected handover differs from its configured hash.');
        file = { path: configured.path, sha256: expectedSha256 };
      } else {
        if (input.fromWorkspace === undefined || input.dssId === undefined) throw fail('INVALID_PARAMS', 'Choose a declared source workspace and original DSS ID.');
        file = await this.#nativeDssFile(input.fromWorkspace, input.dssId, 'handover');
        if (file.sha256 !== expectedSha256) throw fail('USGS_FILE_CHANGED', 'The selected handover differs from the original export.');
      }
      controller.signal.throwIfAborted();
      selected = await openUSGSHandoverStream(file.path, { sha256: expectedSha256, bytes: file.bytes, signal: controller.signal });
      return { workspace, ...publicValue(await session.project.receiveDssUpload(selected.stream)) };
    } finally { controller.abort(); await selected?.close(); this.#requests.delete(entry); }
  }

  async #deliveryDirectory() { return directory(join(this.#config.exportsDirectory, 'usgs-deliveries'), true); }
  async #delivery(exportId) {
    checked(exportId, ALIAS, 'customer delivery ID');
    const path = join(await this.#deliveryDirectory(), exportId + '.json');
    const bytes = await privateBytes(path, 65000), manifest = parseUSGSDeliveryManifest(bytes, exportId);
    this.#definition(manifest.workspace);
    return { path, bytes, manifest, sha256: hash(bytes) };
  }
  async #deliveryPrepare(workspace, dssId, exportId) {
    checked(exportId, ALIAS, 'customer delivery ID');
    const native = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/usgs-water/dss.mjs');
    const saved = await native.readDssExport({ directory: join(this.#definition(workspace).directory, 'dss-exports'), exportId: checked(dssId, ID, 'native DSS ID') });
    const file = await this.#nativeDssFile(workspace, dssId, 'handover');
    const value = { schema: USGS_DELIVERY_SCHEMA, exportId, workspace, dssId, nativeExportSha256: saved.exportSha256,
      planSha256: saved.planSha256, source: publicValue(saved.source), totals: saved.totals,
      files: [{ name: exportId + '-HEC-DSS-handover.zip', kind: 'handover', bytes: file.bytes, sha256: file.sha256, contentType: 'application/zip' }] };
    const bytes = encode(value); parseUSGSDeliveryManifest(bytes, exportId);
    await immutableJson(join(await this.#deliveryDirectory(), exportId + '.json'), value);
    return { state: 'MANIFEST_RETAINED', exportId, workspace, dssId, manifestSha256: hash(bytes),
      manifestFile: { name: USGS_DELIVERY_MANIFEST, bytes: bytes.length, sha256: hash(bytes) }, native: value };
  }
  async #deliveryFile(input) {
    const delivery = await this.#delivery(input.exportId);
    if (delivery.sha256 !== input.expectedManifestSha256) throw fail('USGS_DELIVERY_CHANGED', 'Repeat this delivery’s retained manifest hash.');
    const file = input.file === USGS_DELIVERY_MANIFEST
      ? { name: USGS_DELIVERY_MANIFEST, bytes: delivery.bytes.length, sha256: delivery.sha256, contentType: 'application/json' }
      : delivery.manifest.files.find(file => file.name === input.file);
    if (!file || file.sha256 !== input.expectedSha256) throw fail('USGS_FILE_CHANGED', 'Select an exact file from the original customer manifest.');
    const scope = 'delivery-' + input.exportId;
    const result = await this.#reads.read({ scope, key: input.exportId + '/' + file.name, kind: 'usgs-customer-delivery',
      directory: await this.#deliveryDirectory(), readId: input.readId, expectedSha256: input.expectedSha256, offset: input.offset, limit: input.limit,
      load: async () => {
        if (file.name === USGS_DELIVERY_MANIFEST) return { bytes: delivery.bytes, name: file.name, type: file.contentType };
        const native = await this.#nativeDssFile(delivery.manifest.workspace, delivery.manifest.dssId, 'handover');
        if (native.sha256 !== file.sha256 || native.bytes !== file.bytes) throw fail('USGS_FILE_CHANGED', 'The original complete handover differs from this customer delivery.');
        return this.#descriptor({ ...native, filename: file.name });
      } });
    return { exportId: input.exportId, manifestSha256: delivery.sha256, ...result };
  }
  async #execute(name, args) {
    if (name === 'merchant_usgs_workspaces') return this.summary;
    if (name === 'merchant_usgs_delivery_manifest') {
      const value = await this.#delivery(args.exportId);
      return { state: 'MANIFEST_RETAINED', exportId: args.exportId, manifestFile: { name: USGS_DELIVERY_MANIFEST, bytes: value.bytes.length, sha256: value.sha256 }, native: value.manifest };
    }
    if (name === 'merchant_usgs_delivery_file') return this.#deliveryFile(args);
    if (name === 'merchant_usgs_delivery_file_release') {
      checked(args.exportId, ALIAS, 'customer delivery ID'); checked(args.readId, UUID, 'original read ID');
      await this.#reads.release('delivery-' + args.exportId, args.readId); return { exportId: args.exportId, readId: args.readId, state: 'RELEASED' };
    }
    if (name === 'merchant_usgs_deliveries') {
      const entries = (await readdir(await this.#deliveryDirectory())).filter(name => /^[a-z0-9][a-z0-9_-]{0,63}\.json$/.test(name));
      const values = [];
      for (const entry of entries.sort()) values.push((await this.#delivery(entry.slice(0, -5))).manifest);
      return paged(values, args);
    }
    const { workspace, ...input } = args; this.#definition(workspace);
    for (const field of ['captureId','comparisonCaptureId','reviewId','editionId','dssId','previousDssId'])
      if (input[field] !== undefined) checked(input[field], ID, 'original ' + field);
    const result = native => ({ workspace, native: publicValue(native) });
    if (name === 'merchant_usgs_open') return this.#open(workspace);
    if (name === 'merchant_usgs_close') return this.#closeWorkspace(workspace);
    if (name === 'merchant_usgs_configured_file') {
      const file = this.#configured(workspace, input.file);
      return { workspace, file: input.file, kind: file.kind, ...await fileDescription(file.path, file.kind === 'mapping' ? MAX_JSON : USGS_MAX_HANDOVER_BYTES, file.sha256) };
    }
    if (name === 'merchant_usgs_dss_file') {
      const file = await this.#nativeDssFile(workspace, input.dssId, input.kind);
      return { workspace, dssId: input.dssId, kind: input.kind, file: { name: file.filename, bytes: file.bytes, sha256: file.sha256, contentType: file.mime } };
    }
    if (name === 'merchant_usgs_dss_file_read')
      return this.#fileRead(workspace, 'dss/' + input.dssId + '/' + kind(input.kind, DSS_KINDS), 'usgs-dss-' + input.kind, input,
        async () => this.#descriptor(await this.#nativeDssFile(workspace, input.dssId, input.kind)));
    if (name === 'merchant_usgs_file_release') {
      await this.#reads.release(workspace, checked(input.readId, UUID, 'original file read ID'));
      return { workspace, readId: input.readId, state: 'RELEASED' };
    }
    if (name === 'merchant_usgs_delivery_prepare') return this.#deliveryPrepare(workspace, input.dssId, input.exportId);
    const session = this.#session(workspace), project = session.project;
    switch (name) {
      case 'merchant_usgs_status': {
        const view = await session.view();
        return result({ project: view.project, counts: Object.fromEntries(['captures','reviews','editions','dssExports','jobs'].map(key => [key, view[key].length])),
          runtime: view.runtime, jobs: view.jobs.map(({ result, ...job }) => ({ ...job, resultStatus: result?.status ?? null })),
          fileReads: this.#reads.status(workspace) });
      }
      case 'merchant_usgs_inventory': {
        kind(input.kind, ['captures','reviews','editions','dssExports','jobs','history']);
        const items = input.kind === 'history' ? await project.history() : (await session.view())[input.kind];
        return result({ kind: input.kind, ...paged(publicValue(items), input) });
      }
      case 'merchant_usgs_project_save':
        return result(await this.#post(workspace, '/api/project', { title: text(input.title), selection: object(input.selection, 'USGS selection'), expectedRevision: integer(input.expectedRevision) }));
      case 'merchant_usgs_capture_start':
        return result(await this.#post(workspace, '/api/captures', { operationId: input.captureId, expectedRevision: integer(input.expectedRevision, 1) }));
      case 'merchant_usgs_capture_cancel':
        return result(await this.#post(workspace, '/api/captures/' + input.captureId + '/cancel', {}));
      case 'merchant_usgs_capture': {
        const { pages = [], ...capture } = await project.capture(input.captureId);
        return result({ ...capture, pageCount: pages.length });
      }
      case 'merchant_usgs_capture_pages':
        return result(paged(publicValue((await project.capture(input.captureId)).pages ?? []), input));
      case 'merchant_usgs_capture_file_read':
        integer(input.pageIndex);
        return this.#fileRead(workspace, 'capture/' + input.captureId + '/' + input.pageIndex, 'usgs-original-page', input, async () => {
          const capture = await project.capture(input.captureId), selected = capture.pages?.[input.pageIndex];
          if (!selected || typeof selected.bodyFile !== 'string' || selected.bodyFile.split(/[\\/]/).some(part => !part || part === '..' || part === '.'))
            throw fail('USGS_SOURCE_PAGE_NOT_FOUND', 'Select an original response page from this capture.');
          const path = join(capture.directory, selected.bodyFile), sha256 = checked(selected.sha256 ?? selected.bodySha256, SHA, 'original page hash');
          const info = await fileDescription(path, MAX_NATIVE_FILE, sha256);
          return this.#descriptor({ path, ...info, mime: 'application/geo+json', filename: input.captureId + '-page-' + input.pageIndex + '.geojson' });
        });
      case 'merchant_usgs_analysis': {
        if (input.options !== undefined) object(input.options, 'analysis options');
        const value = await project.analyze({ captureId: input.captureId, options: input.options ?? {}, comparisonCaptureId: input.comparisonCaptureId });
        return result(analysisPage(value, input));
      }
      case 'merchant_usgs_review_save': {
        checked(input.expectedCaptureSha256, SHA, 'original capture hash');
        const value = await this.#post(workspace, '/api/reviews', { reviewId: input.reviewId, captureId: input.captureId,
          options: object(input.options ?? {}, 'analysis options'), note: input.note ?? '', comparisonCaptureId: input.comparisonCaptureId,
          expectedCaptureSha256: input.expectedCaptureSha256 });
        return result(analysisPage(value, { limit: 25 }));
      }
      case 'merchant_usgs_review': {
        const value = await project.readReview(input.reviewId);
        return result(analysisPage(value, input));
      }
      case 'merchant_usgs_review_file_read':
        kind(input.format, ['html','json','csv','geojson']);
        return this.#fileRead(workspace, 'review/' + input.reviewId + '/' + input.format, 'usgs-review-' + input.format, input, async () => {
          const file = await project.exportReview({ reviewId: input.reviewId, format: input.format });
          return { bytes: file.bytes, name: file.filename, type: file.mime };
        });
      case 'merchant_usgs_edition_prepare':
        return result(await this.#post(workspace, '/api/editions', { editionId: input.editionId, reviewId: input.reviewId }));
      case 'merchant_usgs_edition': {
        const value = await project.readEdition(input.editionId);
        return result({ ...value, files: paged(value.files, input) });
      }
      case 'merchant_usgs_edition_file_read':
        if (typeof input.member !== 'string' || input.member.length > 1024) throw fail('INVALID_PARAMS', 'Choose an exact original manifest member.');
        return this.#fileRead(workspace, 'edition/' + input.editionId + '/' + input.member, 'usgs-edition-member', input, async () => {
          const value = await project.readEdition(input.editionId), file = value.files.find(file => file.path === input.member);
          if (!file || file.path.split(/[\\/]/).some(part => !part || part === '.' || part === '..'))
            throw fail('USGS_EDITION_MEMBER_NOT_FOUND', 'Select an exact original member from the native edition manifest.');
          return this.#descriptor({ path: join(value.directory, file.path), bytes: file.bytes, sha256: file.sha256,
            filename: input.editionId + '-' + file.path.split('/').at(-1), mime: 'application/octet-stream' });
        });
      case 'merchant_usgs_dss_source': {
        const value = await project.inspectDssEdition(input.editionId);
        return result({ ...value, series: paged(value.series, input) });
      }
      case 'merchant_usgs_dss_preview': {
        const selectedMapping = await this.#mapping(workspace, input);
        const value = await project.previewDssExport({ editionId: input.editionId, mapping: selectedMapping, previousExportId: input.previousDssId });
        return result(planPage(value, input));
      }
      case 'merchant_usgs_dss_start':
        checked(input.expectedPlanSha256, SHA, 'reviewed native plan hash');
        return result(await this.#post(workspace, '/api/dss/exports', { exportId: input.dssId, editionId: input.editionId,
          mapping: await this.#mapping(workspace, input), expectedPlanSha256: input.expectedPlanSha256, previousExportId: input.previousDssId }));
      case 'merchant_usgs_dss_operation': {
        const value = await project.readDssOperation(input.dssId);
        return result(value.plan ? { ...value, plan: planPage(value.plan, input) } : planPage(value, input));
      }
      case 'merchant_usgs_dss_runtime': return result(await this.#post(workspace, '/api/dss/runtime', {}));
      case 'merchant_usgs_dss_verify': return result(await this.#post(workspace, '/api/dss/' + input.dssId + '/verify', {}));
      case 'merchant_usgs_dss_handover': return result(await this.#post(workspace, '/api/dss/' + input.dssId + '/handover', {}));
      case 'merchant_usgs_dss_receive': return this.#receive(workspace, input);
      default: throw fail('TOOL_NOT_FOUND', 'Unknown original Water workspace operation.');
    }
  }
  async call(name, args = {}) {
    if (this.#closing) throw fail('USGS_WORKSPACE_CLOSING', 'The Water workspace provider is closing.');
    const definition = definitions.get(name);
    if (!definition) throw fail('TOOL_NOT_FOUND', 'Unknown original Water workspace operation.');
    exact(args, Object.keys(definition.properties), definition.required);
    const workspace = args.workspace, scoped = workspace !== undefined && name !== 'merchant_usgs_close';
    const epoch = scoped ? this.#epochs.get(workspace) ?? 0 : null;
    if (scoped) this.#admitted(workspace, epoch);
    const pending = Promise.resolve().then(() => {
      if (scoped) this.#admitted(workspace, epoch);
      return this.#execute(name, args);
    });
    this.#pending.add(pending);
    let calls;
    if (scoped) {
      calls = this.#workspaceCalls.get(workspace) ?? new Set();
      this.#workspaceCalls.set(workspace, calls); calls.add(pending);
    }
    try { return await pending; }
    finally {
      this.#pending.delete(pending); calls?.delete(pending);
      if (calls && !calls.size && this.#workspaceCalls.get(workspace) === calls) this.#workspaceCalls.delete(workspace);
    }
  }
  close() {
    if (!this.#close) {
      this.#closing = true;
      for (const entry of this.#requests) entry.controller.abort();
      this.#close = (async () => {
        const workspaces = new Set([...this.#sessions.keys(), ...this.#opening.keys(), ...this.#stopping.keys()]);
        const stopping = [...workspaces].map(workspace => this.#closeWorkspace(workspace));
        const reads = this.#reads.close();
        await Promise.allSettled([...this.#pending]);
        const outcomes = await Promise.allSettled([...stopping, reads]);
        if (outcomes.some(value => value.status === 'rejected')) throw fail('USGS_SHUTDOWN_INCOMPLETE', 'An original Water workspace or file descriptor did not finish closing.');
      })().catch(error => { this.#close = null; throw error; });
    }
    return this.#close;
  }
}
