// MIT. Agent operations over the original retained SF101 receiving workspace.
import { constants } from 'node:fs';
import { open, lstat, realpath, mkdtemp, link, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { exact, failure, identifier, line, plain, writePrivate, privateSupportDirectory } from './config.mjs';

export const RECEIVING_CONNECTION_SCHEMA = 'stellar-forge.merchant-receiving-connection.v1';
const MIB = 1024 * 1024;
const MAX_EXPORT = 144 * MIB;
const ID_PATTERN = '^[a-z0-9]{8,13}-[a-f0-9]{16}$';
const idSchema = { type: 'string', pattern: ID_PATTERN };
const aliasSchema = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const digestSchema = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const pageSchema = { after: idSchema, limit: { type: 'integer', minimum: 1, maximum: 50 } };
const offsetSchema = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 50 } };
const hash = value => createHash('sha256').update(value).digest('hex');
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function parse(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw failure('RECEIVING_JSON_INVALID', 'The selected receiving source is not valid UTF-8 JSON.'); }
}
function originalId(value) {
  if (typeof value !== 'string' || !new RegExp(ID_PATTERN).test(value))
    throw failure('INVALID_PARAMS', 'Use an original receiving workspace ID, or a new ID in the documented format.');
  return value;
}
function digest(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    throw failure('INVALID_PARAMS', 'Supply the exact inspected SHA-256.');
  return value;
}
function hostPath(value, base) {
  if (typeof value !== 'string' || !value || value.includes('\0'))
    throw failure('CONFIGURATION_ERROR', 'Receiving paths must be nonempty host configuration values.');
  return resolve(base, value);
}
async function privateBytes(path, maximum) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maximum || stat.mode & 0o077 ||
        process.getuid && stat.uid !== process.getuid())
      throw failure('RECEIVING_PRIVATE_SOURCE_REQUIRED', 'Use an owned private regular file within the documented size limit.');
    const bytes = await handle.readFile();
    if (bytes.length > maximum) throw failure('RECEIVING_SOURCE_TOO_LARGE', 'Receiving source exceeds its size limit.');
    return bytes;
  } finally { await handle.close(); }
}
function settings(raw = {}) {
  exact(raw, ['origin', 'proxyEnv', 'timeoutMs', 'feeOperations']);
  const value = { timeoutMs: raw.timeoutMs ?? 12000, feeOperations: raw.feeOperations ?? 0 };
  if (!Number.isInteger(value.timeoutMs) || value.timeoutMs < 1000 || value.timeoutMs > 30000 ||
      !Number.isSafeInteger(value.feeOperations) || value.feeOperations < 0 || value.feeOperations > 100000)
    throw failure('CONFIGURATION_ERROR', 'Use timeoutMs 1000–30000 and feeOperations 0–100000.');
  if (raw.origin !== undefined) {
    if (typeof raw.origin !== 'string' || !raw.origin || raw.origin.length > 2048)
      throw failure('CONFIGURATION_ERROR', 'Receiving origin must be the original public merchant origin.');
    value.origin = raw.origin;
  }
  if (raw.proxyEnv !== undefined) {
    if (typeof raw.proxyEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(raw.proxyEnv))
      throw failure('CONFIGURATION_ERROR', 'Receiving proxyEnv names an existing environment variable.');
    value.proxyEnv = raw.proxyEnv;
  }
  return value;
}
/** Paths and optional proxy selection are supplied by the host, never tool arguments. */
export async function readReceivingConfiguration(path) {
  path = resolve(path);
  const raw = parse(await privateBytes(path, MIB));
  exact(raw, ['schema', 'directory', 'profiles', 'imports'], ['schema', 'directory']);
  if (raw.schema !== RECEIVING_CONNECTION_SCHEMA)
    throw failure('CONFIGURATION_ERROR', 'Expected a merchant receiving connection.');
  const base = dirname(path), profiles = Object.create(null), imports = Object.create(null);
  for (const kind of ['profiles', 'imports']) {
    const source = raw[kind] ?? {};
    if (!plain(source) || Object.keys(source).length > 32)
      throw failure('CONFIGURATION_ERROR', 'Configure up to 32 receiving sources of each kind.');
    for (const [alias, input] of Object.entries(source)) {
      identifier(alias, 'Receiving source alias');
      exact(input, kind === 'profiles' ? ['label', 'seller', 'assets', 'rpc', 'options'] : ['label', 'file'],
        kind === 'profiles' ? ['seller'] : ['file']);
      const label = line(input.label ?? alias, 'Receiving source label');
      if (label.length > 120) throw failure('CONFIGURATION_ERROR', 'Receiving labels use at most 120 characters.');
      if (kind === 'profiles') {
        const value = { label, options: settings(input.options) };
        for (const key of ['seller', 'assets', 'rpc']) if (input[key] !== undefined) value[key] = hostPath(input[key], base);
        profiles[alias] = value;
      } else imports[alias] = { label, file: hostPath(input.file, base) };
    }
  }
  return { directory: hostPath(raw.directory, base), profiles, imports };
}
export function receivingTools(tool) {
  const read = { readOnly: true, idempotent: true };
  return [
    tool('merchant_receiving_status', 'Inspect configured receiving sources and this process-owned workspace, active review and queued work. Does not open the workspace.', {}, [], read),
    tool('merchant_receiving_sources', 'List host-selected seller profiles and captured-review imports, or inspect exact source bytes and digests before preparing/importing. Credential values and file paths stay on the host.',
      { kind: { enum: ['profile', 'import'] }, source: aliasSchema }, [], read),
    tool('merchant_receiving_open', 'Open the original private receiving workspace and resume its retained queued reviews. Uses its original exclusive lease. Close a standalone browser/CLI owner first.', {}, [], { idempotent: true, openWorld: true }),
    tool('merchant_receiving_close', 'Drain this process-owned receiving workspace and release its original lease so the same saved work can open in the original browser or CLI. Other merchant runtimes remain available.', {}, [], { idempotent: true }),
    tool('merchant_receiving_prepare', 'Freeze an inspected host seller source as an original saved profile with compiled native payment choices. Use a caller-retained ID and exact source digest; an equal retry returns the same profile.',
      { id: idSchema, source: aliasSchema, expectedSourceSha256: digestSchema }, ['id', 'source', 'expectedSourceSha256'], { idempotent: true }),
    tool('merchant_receiving_profiles', 'List saved original profiles, or inspect one profile and its paged original payment choices. Reuses the currently opened workspace.',
      { id: idSchema, ...pageSchema, offset: offsetSchema.offset }, [], read),
    tool('merchant_receiving_start', 'Queue an original native live receiving review or replay a retained capture. Uses exact saved profile and plan digest. Retain id across retries; optional previousReviewId adds the original comparison. Live mode performs network reads.',
      { id: idSchema, profileId: idSchema, expectedPlanDigest: digestSchema, mode: { enum: ['live', 'replay'] },
        captureReviewId: idSchema, previousReviewId: idSchema }, ['id', 'profileId', 'expectedPlanDigest', 'mode'], { idempotent: true, openWorld: true }),
    tool('merchant_receiving_reviews', 'List saved review jobs or read an exact review, original summary, paged account findings and corrective actions. Captured source bytes remain in the original private bundle.',
      { id: idSchema, profileId: idSchema, ...pageSchema, offset: offsetSchema.offset }, [], read),
    tool('merchant_receiving_cancel', 'Cancel an original queued review or request interruption of its active reads. Completed results keep their original state. Inspect reviews for the terminal result.',
      { id: idSchema }, ['id'], { idempotent: true }),
    tool('merchant_receiving_compare', 'Compare two completed original reviews using complete payment identity. Returns paged added, changed, unchanged and removed options.',
      { previousId: idSchema, currentId: idSchema, ...offsetSchema }, ['previousId', 'currentId'], read),
    tool('merchant_receiving_import', 'Import a host-selected complete original receiving export using its inspected byte digest and a caller-retained review ID. The original controller validates and retains source, profile, capture and report together.',
      { id: idSchema, source: aliasSchema, expectedSourceSha256: digestSchema }, ['id', 'source', 'expectedSourceSha256'], { idempotent: true }),
    tool('merchant_receiving_export', 'Publish the exact complete original receiving export as a private named JSON file under the configured customer export directory. An equal retry reuses the same completed file.',
      { id: idSchema, exportId: aliasSchema }, ['id', 'exportId'], { idempotent: true }),
    tool('merchant_receiving_export_status', 'Read a named receiving export, verify every embedded file and its original retained manifest, and return the exact file digest and native review identity.',
      { exportId: aliasSchema }, ['exportId'], read),
  ];
}
function profileView(record) {
  return { id: record.id, label: record.label, createdAt: record.createdAt, planDigest: record.planDigest,
    configurationSha256: record.configurationSha256, options: record.options,
    files: record.files.map(({ name, originalName, bytes, sha256 }) => ({ name, originalName, bytes, sha256 })),
    routes: record.plan.routes.length, paymentOptions: record.plan.routes.reduce((n, row) => n + row.accepts.length, 0) };
}
function page(items, args, base = {}) {
  const offset = args.offset ?? 0, limit = args.limit ?? 20;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 50)
    throw failure('INVALID_PARAMS', 'Use a nonnegative offset and limit 1–50.');
  const rows = [];
  for (const row of items.slice(offset, offset + limit)) {
    if (Buffer.byteLength(JSON.stringify({ ...base, rows: [...rows, row] })) > 90 * 1024) {
      if (!rows.length) throw failure('RECEIVING_ROW_TOO_LARGE', 'Use the complete private export to read this original large record.');
      break;
    }
    rows.push(row);
  }
  return { ...base, rows, total: items.length, offset, nextOffset: offset + rows.length < items.length ? offset + rows.length : null };
}
function cursorArgs(args) {
  if (args.after !== undefined) originalId(args.after);
  const limit = args.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw failure('INVALID_PARAMS', 'Use limit 1–50.');
  return { after: args.after, limit };
}

function cursorPage(result, view = value => value) {
  const rows = [];
  for (const record of result.rows) {
    const row = view(record);
    if (Buffer.byteLength(JSON.stringify({ rows: [...rows, row], nextCursor: record.id })) > 90 * 1024) break;
    rows.push(row);
  }
  if (!rows.length && result.rows.length)
    throw failure('RECEIVING_ROW_TOO_LARGE', 'Inspect the selected original record or its complete private export.');
  return { rows, nextCursor: rows.length < result.rows.length ? rows.at(-1).id : result.nextCursor };
}

export class MerchantReceiving {
  #config; #workspace = null; #opening = null; #closing = null; #retired = false;
  constructor(config) { this.#config = config; }
  get summary() { return { configured: Boolean(this.#config.receiving), opened: Boolean(this.#workspace),
    opening: Boolean(this.#opening), closing: Boolean(this.#closing) }; }
  #connection() {
    if (!this.#config.receiving) throw failure('RECEIVING_NOT_CONFIGURED', 'The host must select a receivingConnection in merchant-mcp.json.');
    return this.#config.receiving;
  }
  #current() {
    this.#connection();
    if (!this.#workspace || this.#closing) throw failure('RECEIVING_NOT_OPEN', 'Open the original receiving workspace before using its saved work.');
    return this.#workspace;
  }
  async #open() {
    if (this.#retired) throw failure('OPERATOR_CLOSING', 'Merchant operator is closing.');
    if (this.#closing) throw failure('RECEIVING_CLOSING', 'Receiving workspace is draining.');
    if (this.#workspace) return this.#workspace.status();
    if (!this.#opening) {
      const connection = this.#connection();
      this.#opening = (async () => {
        const { openReceivingWorkspace } = await import('../../stellar/scf-starforge-20261009/sf101-merchant-account-readiness/workspace/controller.mjs');
        this.#workspace = await openReceivingWorkspace({ directory: connection.directory });
        return this.#workspace.status();
      })().finally(() => { this.#opening = null; });
    }
    return this.#opening;
  }
  async #closeWorkspace() {
    if (this.#closing) return this.#closing;
    this.#closing = (async () => {
      if (this.#opening) await this.#opening;
      if (this.#workspace) {
        const selected = this.#workspace;
        try { await selected.close(); }
        finally { if (this.#workspace === selected) this.#workspace = null; }
      }
      return { configured: Boolean(this.#config.receiving), opened: false };
    })().finally(() => { this.#closing = null; });
    return this.#closing;
  }
  async #source(kind, alias) {
    const connection = this.#connection();
    if (!['profile', 'import'].includes(kind)) throw failure('INVALID_PARAMS', 'Select profile or import source kind.');
    identifier(alias, 'Receiving source alias');
    const selected = connection[kind === 'profile' ? 'profiles' : 'imports'][alias];
    if (!selected) throw failure('RECEIVING_SOURCE_NOT_FOUND', 'Select a host-configured receiving source alias.');
    if (kind === 'import') {
      const bytes = await privateBytes(selected.file, MAX_EXPORT);
      return { input: bytes, view: { kind, source: alias, label: selected.label, bytes: bytes.length, sha256: hash(bytes) } };
    }
    const input = { label: selected.label, options: selected.options }, files = [];
    for (const role of ['seller', 'assets', 'rpc']) if (selected[role]) {
      const bytes = await privateBytes(selected[role], MIB);
      parse(bytes);
      const file = { name: basename(selected[role]), bytes: bytes.length, sha256: hash(bytes) };
      input[role] = { ...file, base64: bytes.toString('base64') }; files.push({ role, ...file });
    }
    const view = { kind, source: alias, label: selected.label, options: selected.options, files };
    return { input, view: { ...view, sha256: hash(jsonBytes(view)) } };
  }
  #exportPath(exportId) { return join(this.#config.exportsDirectory, 'receiving-' + identifier(exportId, 'Export ID') + '.json'); }
  async #exportStatus(exportId) {
    const bytes = await privateBytes(this.#exportPath(exportId), MAX_EXPORT), value = parse(bytes);
    if (value.schema !== 'stellar-forge.receiving-workspace-export.v1' || !Array.isArray(value.bundle) || value.bundle.length !== 7)
      throw failure('RECEIVING_EXPORT_INVALID', 'Expected a complete original receiving export.');
    const original = await this.#current().getReview(originalId(value.review?.id));
    if (!original.report || JSON.stringify(original.record) !== JSON.stringify(value.review))
      throw failure('RECEIVING_EXPORT_CONFLICT', 'The export does not match the retained original review.');
    const profile = await this.#current().getProfile(original.record.profileId);
    const checked = new Map();
    for (const row of value.bundle) {
      if (!plain(row) || typeof row.name !== 'string' || checked.has(row.name) || typeof row.base64 !== 'string')
        throw failure('RECEIVING_EXPORT_INVALID', 'Original bundle members must be unique.');
      const data = Buffer.from(row.base64, 'base64');
      if (data.toString('base64') !== row.base64 || data.length !== row.bytes || hash(data) !== row.sha256)
        throw failure('RECEIVING_EXPORT_DIGEST_MISMATCH', 'An embedded original file changed.');
      checked.set(row.name, { data, bytes: data.length, sha256: row.sha256 });
    }
    const manifest = checked.get('manifest.json');
    let originalManifestSha256 = original.record.manifestSha256;
    if (!originalManifestSha256) {
      // A legacy recovered completion may predate the retained manifest digest.
      // Read the original validated export rather than inventing a second authority.
      const retained = parse(await this.#current().exportReview(original.record.id));
      originalManifestSha256 = retained.bundle.find(row => row.name === 'manifest.json')?.sha256;
    }
    if (!manifest || !originalManifestSha256 || manifest.sha256 !== originalManifestSha256)
      throw failure('RECEIVING_EXPORT_DIGEST_MISMATCH', 'The export differs from the retained review manifest.');
    const declared = parse(manifest.data);
    if (declared.schema !== 'stellar-forge.merchant-readiness-manifest.v1' || declared.planDigest !== original.record.planDigest ||
        !Array.isArray(declared.files) || declared.files.length !== 6 || new Set(declared.files.map(row => row.name)).size !== 6)
      throw failure('RECEIVING_EXPORT_INVALID', 'The original manifest is invalid.');
    for (const row of declared.files) {
      const data = checked.get(row.name);
      if (row.name === 'manifest.json' || !data || data.bytes !== row.bytes || data.sha256 !== row.sha256)
        throw failure('RECEIVING_EXPORT_DIGEST_MISMATCH', 'An original manifest member changed.');
    }
    if (!Array.isArray(value.profile?.files) || value.profile.files.length !== profile.files.length ||
        value.profile.label !== profile.label || JSON.stringify(value.profile.options) !== JSON.stringify(profile.options))
      throw failure('RECEIVING_EXPORT_INVALID', 'Original profile files are incomplete.');
    for (const row of profile.files) {
      const matches = value.profile.files.filter(file => file.name === row.name);
      const data = matches.length === 1 && typeof matches[0].base64 === 'string' ? Buffer.from(matches[0].base64, 'base64') : null;
      if (!data || data.toString('base64') !== matches[0].base64 || data.length !== row.bytes || hash(data) !== row.sha256 ||
          matches[0].bytes !== row.bytes || matches[0].sha256 !== row.sha256 || matches[0].originalName !== row.originalName)
        throw failure('RECEIVING_EXPORT_DIGEST_MISMATCH', 'An original seller source changed.');
    }
    return { exportId, filename: basename(this.#exportPath(exportId)), bytes: bytes.length, sha256: hash(bytes),
      reviewId: original.record.id, profileId: original.record.profileId, planDigest: original.record.planDigest,
      files: [...checked].map(([name, file]) => ({ name, bytes: file.bytes, sha256: file.sha256 })) };
  }
  async #export(args) {
    const workspace = this.#current(), id = originalId(args.id), target = this.#exportPath(args.exportId);
    const existing = async () => {
      const record = await this.#exportStatus(args.exportId);
      if (record.reviewId !== id) throw failure('RECEIVING_EXPORT_CONFLICT', 'This export ID already belongs to another review.');
      return { ...record, reused: true };
    };
    try { await lstat(target); return await existing(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const directory = await privateSupportDirectory(this.#config.exportsDirectory);
    if (await realpath(directory) !== directory) throw failure('RECEIVING_EXPORT_ROOT_INVALID', 'Use a canonical private export directory.');
    const bytes = await workspace.exportReview(id);
    if (bytes.length > MAX_EXPORT) throw failure('RECEIVING_EXPORT_TOO_LARGE', 'Original export exceeds the configured transfer limit.');
    const stage = await mkdtemp(join(directory, '.receiving-'));
    try {
      const source = join(stage, 'receiving.json'); await writePrivate(source, bytes);
      try { await link(source, target); }
      catch (error) { if (error.code === 'EEXIST') return await existing(); throw error; }
      const handle = await open(directory, 'r');
      try { await handle.sync(); } finally { await handle.close(); }
      return { ...await this.#exportStatus(args.exportId), reused: false };
    } finally { await rm(stage, { recursive: true, force: true }); }
  }
  async call(name, args) {
    try {
      if (name === 'merchant_receiving_status') return { ...this.summary,
        workspace: this.#workspace && !this.#closing ? await this.#workspace.status() : null };
      if (name === 'merchant_receiving_open') return await this.#open();
      if (name === 'merchant_receiving_close') return await this.#closeWorkspace();
      if (name === 'merchant_receiving_sources') {
        const connection = this.#connection();
        if (args.source !== undefined) return (await this.#source(args.kind, args.source)).view;
        if (args.kind !== undefined && !['profile', 'import'].includes(args.kind)) throw failure('INVALID_PARAMS', 'Select profile or import.');
        return { sources: ['profile', 'import'].filter(kind => !args.kind || kind === args.kind).flatMap(kind =>
          Object.entries(connection[kind === 'profile' ? 'profiles' : 'imports']).map(([source, item]) => ({ kind, source, label: item.label }))) };
      }
      const workspace = this.#current();
      switch (name) {
        case 'merchant_receiving_prepare': case 'merchant_receiving_import': {
          originalId(args.id); digest(args.expectedSourceSha256);
          const input = await this.#source(name.endsWith('_prepare') ? 'profile' : 'import', args.source);
          if (input.view.sha256 !== args.expectedSourceSha256) throw failure('RECEIVING_SOURCE_CONFLICT', 'The host source changed after inspection. Inspect it again.');
          if (name.endsWith('_prepare')) return { source: args.source, sourceSha256: input.view.sha256,
            profile: profileView(await workspace.createProfile(input.input, { id: args.id })) };
          const result = await workspace.importReview(parse(input.input), { id: args.id });
          return { source: args.source, sourceSha256: input.view.sha256, profile: profileView(result.profile), review: result.review };
        }
        case 'merchant_receiving_profiles': {
          if (args.id === undefined) {
            if (args.offset !== undefined) throw failure('INVALID_PARAMS', 'Use after for saved-profile lists.');
            const result = await workspace.listProfiles(cursorArgs(args));
            return cursorPage(result, profileView);
          }
          if (args.after !== undefined) throw failure('INVALID_PARAMS', 'Use offset for a selected profile.');
          const profile = await workspace.getProfile(originalId(args.id));
          const offers = profile.plan.routes.flatMap(route => route.accepts.map((terms, optionIndex) =>
            ({ routeId: route.id, method: route.method, path: route.path, url: route.url, resource: route.resource, optionIndex, terms })));
          return page(offers, args, { profile: profileView(profile) });
        }
        case 'merchant_receiving_start': {
          const profile = await workspace.getProfile(originalId(args.profileId));
          if (profile.planDigest !== digest(args.expectedPlanDigest)) throw failure('RECEIVING_PLAN_CONFLICT', 'Inspect the original saved payment choices before starting this review.');
          const { expectedPlanDigest, ...request } = args;
          return await workspace.startReview(request);
        }
        case 'merchant_receiving_reviews': {
          if (args.id === undefined) {
            if (args.offset !== undefined) throw failure('INVALID_PARAMS', 'Use after for saved-review lists.');
            return cursorPage(await workspace.listReviews({ ...cursorArgs(args), ...(args.profileId ? { profileId: originalId(args.profileId) } : {}) }));
          }
          if (args.after !== undefined || args.profileId !== undefined) throw failure('INVALID_PARAMS', 'A selected review uses only id, offset and limit.');
          const value = await workspace.getReview(originalId(args.id));
          if (!value.report) return value;
          const { options, configuration, comparison, ...report } = value.report;
          const { path, ...source } = configuration ?? {};
          const actions = new Map(value.actions.map(row => [row.optionId, row.actions]));
          return page(options.map(row => ({ ...row, actions: actions.get(row.optionId) ?? [] })), args,
            { record: value.record, report: { ...report, configuration: source }, comparisonAvailable: Boolean(comparison) });
        }
        case 'merchant_receiving_cancel': return await workspace.cancelReview(originalId(args.id));
        case 'merchant_receiving_compare': {
          const { options, ...result } = await workspace.compare({ previousId: originalId(args.previousId), currentId: originalId(args.currentId) });
          return page(options, args, result);
        }
        case 'merchant_receiving_export': return await this.#export(args);
        case 'merchant_receiving_export_status': return await this.#exportStatus(args.exportId);
        default: throw failure('TOOL_NOT_FOUND', 'Unknown receiving operation.');
      }
    } catch (error) {
      if (error.path || error.syscall) throw failure('RECEIVING_STORAGE_UNAVAILABLE', 'Original private receiving storage could not complete. Inspect retained work before retrying.');
      if (!error.code || !/^[A-Z][A-Z0-9_]{1,100}$/.test(error.code))
        throw failure('RECEIVING_OPERATION_FAILED', 'The original receiving operation could not complete. Inspect retained status.');
      throw error;
    }
  }
  close() { this.#retired = true; return this.#closeWorkspace(); }
}
