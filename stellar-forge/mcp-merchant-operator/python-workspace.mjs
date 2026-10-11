// MIT. Agent authoring over the original saved Python merchant workspace.
import { constants } from 'node:fs';
import { open, lstat, mkdtemp, rename, rm, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { exact, failure, identifier, line, plain, writePrivate, privateSupportDirectory, pythonSourceView } from './config.mjs';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';

export const PYTHON_WORKSPACE_CONNECTION_SCHEMA = 'stellar-forge.python-workspace-connection.v1';
export const PYTHON_EXPORT_SCHEMA = 'stellar-forge.python-mcp-export.v1';
const MAX_EXPORT = 256_000_000;
const hash = value => createHash('sha256').update(value).digest('hex');
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const ID_PATTERN = '^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$';
const idSchema = { type: 'string', pattern: ID_PATTERN };
const aliasSchema = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const shaSchema = { type: 'string', pattern: '^[0-9a-f]{64}$' };
const generationSchema = { type: 'integer', minimum: 0 };
const reasonSchema = { type: 'string', minLength: 1, maxLength: 240 };
const noteSchema = { type: 'string', maxLength: 2000 };
const fileSchema = { type: 'string', minLength: 1, maxLength: 4096 };
const rangeSchema = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 50 } };
const KINDS = ['revisions', 'previews', 'stages', 'customers'];
function originalId(value) {
  if (typeof value !== 'string' || !new RegExp(ID_PATTERN).test(value))
    throw failure('INVALID_PARAMS', 'Use an original saved record ID or the documented preview operation ID.');
  return value;
}
function digest(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value))
    throw failure('INVALID_PARAMS', 'Use the exact inspected SHA-256 digest.');
  return value;
}
function generation(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw failure('INVALID_PARAMS', 'Use the current nonnegative release generation.');
  return value;
}
function sourceFile(value) {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\\\u0000-\u001f\u007f]/.test(value) ||
      value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..'))
    throw failure('INVALID_PARAMS', 'Select a relative file from the original saved record.');
  return value;
}
function hostPath(value, base) {
  if (typeof value !== 'string' || !value || value.includes('\0'))
    throw failure('CONFIGURATION_ERROR', 'Python workspace paths are host configuration values.');
  return resolve(base, value);
}
async function privateBytes(path, maximum) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maximum || process.platform !== 'win32' &&
        ((stat.mode & 0o077) || process.getuid && stat.uid !== process.getuid()))
      throw failure('PYTHON_PRIVATE_FILE_REQUIRED', 'Use an owned private regular file within the documented limit.');
    const bytes = await handle.readFile();
    if (bytes.length > maximum) throw failure('PYTHON_FILE_TOO_LARGE', 'The selected original file exceeds its transfer limit.');
    return bytes;
  } finally { await handle.close(); }
}
function parse(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw failure('PYTHON_JSON_INVALID', 'The selected private file must be valid UTF-8 JSON.'); }
}
function runtimeOptions(raw = {}) {
  exact(raw, ['port', 'facilitator', 'allowLocalFacilitator']);
  const runtime = { port: raw.port ?? 8423 };
  if (!Number.isInteger(runtime.port) || runtime.port < 0 || runtime.port > 65535)
    throw failure('CONFIGURATION_ERROR', 'Python release port must be 0–65535.');
  if (raw.facilitator !== undefined) {
    let url;
    try { url = new URL(raw.facilitator); } catch { throw failure('CONFIGURATION_ERROR', 'Use a complete facilitator URL.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
      throw failure('CONFIGURATION_ERROR', 'Use an HTTP(S) facilitator origin without credentials, query or fragment.');
    runtime.facilitator = url.href.replace(/\/$/, '');
  }
  if (raw.allowLocalFacilitator !== undefined && typeof raw.allowLocalFacilitator !== 'boolean')
    throw failure('CONFIGURATION_ERROR', 'allowLocalFacilitator must be a boolean.');
  if (raw.allowLocalFacilitator === true) runtime.allowLocalFacilitator = true;
  return runtime;
}
/** Existing directories and launch settings are selected by the host, not tool paths. */
export async function readPythonWorkspaceConfiguration(path) {
  path = resolve(path);
  const raw = parse(await privateBytes(path, 1024 * 1024));
  exact(raw, ['schema', 'workspaces'], ['schema', 'workspaces']);
  if (raw.schema !== PYTHON_WORKSPACE_CONNECTION_SCHEMA || !plain(raw.workspaces) ||
      !Object.keys(raw.workspaces).length || Object.keys(raw.workspaces).length > 32)
    throw failure('CONFIGURATION_ERROR', 'Declare 1–32 existing Python workspaces in the original connection schema.');
  const base = dirname(path), workspaces = Object.create(null), seen = new Set();
  for (const [alias, item] of Object.entries(raw.workspaces)) {
    identifier(alias, 'Python workspace alias');
    exact(item, ['label', 'directory', 'runtime'], ['directory']);
    const directory = await realpath(hostPath(item.directory, base));
    await privateSupportDirectory(directory);
    const database = await lstat(join(directory, 'workspace.sqlite3'));
    if (!database.isFile() || database.isSymbolicLink())
      throw failure('CONFIGURATION_ERROR', 'Select an existing original Python workspace directory.');
    if (seen.has(directory)) throw failure('CONFIGURATION_ERROR', 'Give each original Python directory one alias in this connection.');
    seen.add(directory);
    workspaces[alias] = { label: line(item.label ?? alias, 'Python workspace label'), directory, runtime: runtimeOptions(item.runtime) };
  }
  return { workspaces };
}

export function pythonWorkspaceTools(tool) {
  const read = { readOnly: true, idempotent: true };
  const withWorkspace = (properties = {}) => ({ workspace: aliasSchema, ...properties });
  return [
    tool('merchant_python_status', 'List host-declared original Python workspaces, or inspect an opened workspace, current authoring head, native release selection, owned processes and record counts. Does not open or execute Python.',
      { workspace: aliasSchema }, [], read),
    tool('merchant_python_open', 'Open the same saved Python authoring model. Reuses revisions, preview outcomes, native releases and customer exports; does not start Python or a seller.',
      withWorkspace(), ['workspace'], { idempotent: true }),
    tool('merchant_python_close', 'Cancel and drain only this model handle’s previews, stop its owned seller, release its file reads and close its database. Other handles keep their own work.',
      withWorkspace(), ['workspace'], { idempotent: true }),
    tool('merchant_python_revision', 'Inspect a saved revision and its original compiled public functions/payment choices, with a page of file identities. Read exact declaration or source bytes with merchant_python_read.',
      withWorkspace({ id: idSchema, ...rangeSchema }), ['workspace'], read),
    tool('merchant_python_save', 'Save source/helper-file edits, removals, entry selection and/or declaration text as one original immutable authoring revision. Requires the current head; native declaration/source synchronization and revision conflict checks apply. No Python executes.',
      withWorkspace({ baseRevision: idSchema, expectedHead: idSchema, entry: fileSchema, declarationText: { type: 'string', maxLength: 1048576 },
        files: { type: 'array', maxItems: 512, items: { type: 'object', properties: { path: fileSchema, text: { type: 'string' }, base64: { type: 'string' } }, required: ['path'], additionalProperties: false } },
        remove: { type: 'array', maxItems: 512, items: fileSchema }, note: noteSchema }), ['workspace', 'baseRevision', 'expectedHead']),
    tool('merchant_python_restore', 'Restore one retained source revision as a new head with its original ancestry; keeps later revisions and original results available.',
      withWorkspace({ revisionId: idSchema, expectedHead: idSchema, note: noteSchema }), ['workspace', 'revisionId', 'expectedHead']),
    tool('merchant_python_refresh', 'Capture the workspace’s originally selected host declaration and helper directory as a new revision. Imported portable workspaces keep their retained source and do not invent a new host source location.',
      withWorkspace({ expectedHead: idSchema, note: noteSchema }), ['workspace', 'expectedHead']),
    tool('merchant_python_history', 'Page original revisions, previews, stages or customer exports; supply an exact id to inspect its retained record. Source, preview output and customer files use the same chunk reader.',
      withWorkspace({ kind: { enum: KINDS }, id: idSchema, ...rangeSchema }), ['workspace', 'kind'], read),
    tool('merchant_python_preview', 'Run a declared function against an immutable saved revision through the original native Python source. Retain operationId before calling: an equal retry returns the same original job and never repeats execution.',
      withWorkspace({ operationId: idSchema, revisionId: idSchema, function: { type: 'string', minLength: 1, maxLength: 160 },
        input: { type: 'object', additionalProperties: true } }), ['workspace', 'operationId', 'revisionId', 'function', 'input'], { idempotent: true, openWorld: true }),
    tool('merchant_python_cancel', 'Cancel this model handle’s original preview and drain its workers. Completed jobs remain completed; other handles’ workers cannot be cancelled here.',
      withWorkspace({ id: idSchema }), ['workspace', 'id'], { idempotent: true }),
    tool('merchant_python_stage', 'Stage an exact saved revision through the original Python/SF82 release implementation, using only host-declared runtime settings. Retain the release id across an interrupted reply.',
      withWorkspace({ revisionId: idSchema, id: aliasSchema, label: noteSchema }), ['workspace', 'revisionId', 'id'], { idempotent: true }),
    tool('merchant_python_release_review', 'Inspect the exact native candidate, complete terms and original changes against the active or named release; returns the current generation and candidate digest.',
      withWorkspace({ id: aliasSchema, from: { anyOf: [aliasSchema, { type: 'null' }] } }), ['workspace', 'id'], read),
    tool('merchant_python_activate', 'Select the reviewed original release using its exact digest and current selection generation. A currently running seller keeps its old version until explicit restart.',
      withWorkspace({ id: aliasSchema, expectedDigest: shaSchema, expectedGeneration: generationSchema, reason: reasonSchema }),
      ['workspace', 'id', 'expectedDigest', 'expectedGeneration', 'reason']),
    tool('merchant_python_rollback', 'Select a specific retained original release with its inspected digest and current generation; records the original rollback history without discarding later source.',
      withWorkspace({ to: aliasSchema, expectedDigest: shaSchema, expectedGeneration: generationSchema, reason: reasonSchema }),
      ['workspace', 'to', 'expectedDigest', 'expectedGeneration', 'reason']),
    tool('merchant_python_start', 'Start the selected original Python/SF82 seller after checking its exact digest and generation. No paid endpoint is requested.',
      withWorkspace({ expectedDigest: shaSchema, expectedGeneration: generationSchema }), ['workspace', 'expectedDigest', 'expectedGeneration'], { openWorld: true }),
    tool('merchant_python_stop', 'Gracefully stop only the original seller instance owned by this Python model handle.',
      withWorkspace({ instanceId: { type: 'string', minLength: 1, maxLength: 64 } }), ['workspace', 'instanceId'], { destructive: true }),
    tool('merchant_python_restart', 'Check the reviewed selection and owned instance, drain the old original seller, then start the selected original release.',
      withWorkspace({ instanceId: { type: 'string', minLength: 1, maxLength: 64 }, expectedDigest: shaSchema, expectedGeneration: generationSchema }),
      ['workspace', 'instanceId', 'expectedDigest', 'expectedGeneration'], { destructive: true, openWorld: true }),
    tool('merchant_python_customer_export', 'Create the original five-file JavaScript/TypeScript/OpenAPI customer export from this owned running seller. Retain the export id; reopening reads the same original files.',
      withWorkspace({ id: aliasSchema, instanceId: { type: 'string', minLength: 1, maxLength: 64 } }), ['workspace', 'id', 'instanceId'], { idempotent: true }),
    tool('merchant_python_export', 'Publish one complete original portable authoring export with its native release history and customer clients. Requires the expected head/generation. The same export id reopens the already-published exact archive even after later edits.',
      withWorkspace({ id: aliasSchema, expectedHead: idSchema, expectedGeneration: generationSchema }), ['workspace', 'id', 'expectedHead', 'expectedGeneration'], { idempotent: true }),
    tool('merchant_python_export_status', 'Read and verify a named original portable export and its exact download metadata. Does not rebuild it or require the Python model to be open.',
      withWorkspace({ id: aliasSchema }), ['workspace', 'id'], read),
    tool('merchant_python_read', 'Read exact retained source, declaration, preview input/output, customer client or portable export bytes through the original verified chunk reader. Resume after restart with the same SHA256 and offset; it never reruns a preview or purchase.',
      withWorkspace({ kind: { enum: ['source', 'declaration', 'preview', 'preview-input', 'customer', 'export'] }, id: idSchema, file: fileSchema,
        readId: { type: 'string', minLength: 1, maxLength: 64 }, expectedSha256: shaSchema,
        offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } }),
      ['workspace', 'kind', 'id'], read),
    tool('merchant_python_read_release', 'Release a verified file snapshot owned by this Python workspace alias. Completed and expired reads need no release.',
      withWorkspace({ readId: { type: 'string', minLength: 1, maxLength: 64 } }), ['workspace', 'readId'], { idempotent: true }),
  ];
}
function page(rows, args) {
  const offset = args.offset ?? 0, limit = args.limit ?? 20;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50)
    throw failure('INVALID_PARAMS', 'Use a nonnegative offset and a limit from 1 to 50.');
  return { total: rows.length, offset, nextOffset: offset + limit < rows.length ? offset + limit : null, items: rows.slice(offset, offset + limit) };
}
function revisionSummary(row) {
  return { id: row.id, parent: row.parent, createdAt: row.createdAt, note: row.note, entry: row.entry,
    files: row.files.length, bytes: row.files.reduce((sum, item) => sum + item.bytes, 0), digest: row.digest,
    ...(row.restoredFrom ? { restoredFrom: row.restoredFrom } : {}), ...(row.basedOn ? { basedOn: row.basedOn } : {}) };
}
function recordView(kind, record) {
  if (kind === 'revisions') return revisionSummary(record);
  const { owner, fingerprint, directory, expected, release, input, ...rest } = record;
  if (kind === 'previews') return { ...rest, input: { bytes: jsonBytes(input).length, sha256: hash(jsonBytes(input)) } };
  return rest;
}
function releaseView(value) {
  if (!value) return null;
  const { handlerEntry, runtime = {}, ...rest } = value;
  const { handlers, ...options } = runtime;
  return { ...rest, ...(rest.python ? { python: pythonSourceView(rest.python) } : {}),
    runtime: { ...options, applicationConfigured: Boolean(handlers || value.python) },
    handlerEntry: handlerEntry ? { sha256: handlerEntry.sha256, bytes: handlerEntry.bytes, scope: handlerEntry.scope } : null };
}
function runtimeView(value) {
  const observed = value.observed;
  return { state: value.state, message: value.message ?? null, managerAlive: value.managerAlive ?? null,
    childAlive: value.childAlive ?? null, observed: observed ? Object.fromEntries(
      ['instanceId', 'releaseId', 'releaseDigest', 'selectionGeneration', 'listener', 'operations', 'mode', 'phase',
        'startedAt', 'readyAt', 'endedAt', 'exitCode', 'exitSignal'].filter(key => Object.hasOwn(observed, key)).map(key => [key, observed[key]])) : null };
}

export class MerchantPythonWorkspaces {
  #config; #models = new Map(); #openings = new Map(); #closings = new Map(); #retired = false; #close;
  #reads = new RetainedFileReads({ errorPrefix: 'PYTHON' });
  constructor(config) { this.#config = config; }
  get summary() {
    return { configured: Boolean(this.#config.pythonWorkspaces), opened: [...this.#models.keys()],
      opening: [...this.#openings.keys()], closing: [...this.#closings.keys()], ...this.#reads.summary };
  }
  #selection(alias) {
    identifier(alias, 'Python workspace alias');
    const selected = this.#config.pythonWorkspaces?.workspaces[alias];
    if (!selected) throw failure('PYTHON_WORKSPACE_NOT_CONFIGURED', 'Choose one of the host-declared Python workspace aliases.');
    return selected;
  }
  #model(alias) {
    this.#selection(alias);
    const model = this.#models.get(alias);
    if (!model || this.#closings.has(alias)) throw failure('PYTHON_WORKSPACE_NOT_OPEN', 'Open this original Python workspace before operating its retained model.');
    return model;
  }
  async #open(alias) {
    if (this.#retired) throw failure('PYTHON_CLOSING', 'Python workspace operations are closing.');
    const selected = this.#selection(alias);
    if (this.#closings.has(alias)) throw failure('PYTHON_CLOSING', 'This original workspace is draining.');
    if (this.#models.has(alias)) return this.#status(alias);
    if (!this.#openings.has(alias)) {
      const pending = (async () => {
        const { openWorkspace } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/python/workspace/model.mjs');
        const model = await openWorkspace(selected.directory);
        this.#models.set(alias, model);
        return this.#status(alias);
      })().finally(() => this.#openings.delete(alias));
      this.#openings.set(alias, pending);
    }
    return this.#openings.get(alias);
  }
  #closeWorkspace(alias) {
    this.#selection(alias);
    if (this.#closings.has(alias)) return this.#closings.get(alias);
    const closing = (async () => {
      if (this.#openings.has(alias)) await this.#openings.get(alias);
      const model = this.#models.get(alias);
      const results = await Promise.allSettled([this.#reads.closeScope(alias), model?.close()]);
      this.#models.delete(alias);
      const error = results.find(result => result.status === 'rejected')?.reason;
      if (error) throw error;
      return { workspace: alias, opened: false };
    })().finally(() => this.#closings.delete(alias));
    this.#closings.set(alias, closing);
    return closing;
  }
  async #status(alias) {
    if (alias === undefined) return { ...this.summary, workspaces: Object.entries(this.#config.pythonWorkspaces?.workspaces ?? {})
      .map(([workspace, value]) => ({ workspace, label: value.label, opened: this.#models.has(workspace), runtime: value.runtime })) };
    const selected = this.#selection(alias), model = this.#models.get(alias);
    if (!model || this.#closings.has(alias)) return { workspace: alias, label: selected.label, opened: false,
      opening: this.#openings.has(alias), closing: this.#closings.has(alias), runtime: selected.runtime };
    const state = await model.state(), metadata = state.workspace;
    return { workspace: alias, label: selected.label, opened: true,
      identity: { id: metadata.id, label: metadata.label, head: metadata.head, createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt ?? null, importedAt: metadata.importedAt ?? null, refreshAvailable: metadata.origin.refreshAvailable === true },
      revision: revisionSummary(model.row('revisions', metadata.head)),
      records: Object.fromEntries(KINDS.map(kind => [kind, model.rows(kind).length])),
      release: { state: state.release.state, runtime: runtimeView(state.release.runtime), managed: state.release.managed,
        errors: state.release.errors, lastError: state.release.lastError,
        releases: state.release.releases.map(item => ({ id: item.id, label: item.label, digest: item.digest, sourceKind: item.source?.kind })) },
      reads: this.#reads.status(alias) };
  }
  #revision(model, args) {
    const id = args.id === undefined ? model.metadata().head : originalId(args.id), record = model.revision(id);
    const { declarationText, files, ...revision } = record, bytes = Buffer.from(declarationText);
    return { workspace: args.workspace, head: model.metadata().head, revision,
      declaration: { bytes: bytes.length, sha256: hash(bytes), kind: 'declaration' }, files: page(files, args) };
  }
  async #selectionReview(model, args, target) {
    const { readReleaseState, inspectRelease } = await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs');
    const state = await readReleaseState(model.releaseRoot);
    if (state.generation !== generation(args.expectedGeneration))
      throw failure('RELEASE_CONFLICT', 'The original selection changed. Refresh Python status and review the candidate.');
    const id = target ?? state.active;
    if (!id) throw failure('RELEASE_NOT_SELECTED', 'Select an inspected original release before starting.');
    const release = await inspectRelease(model.releaseRoot, identifier(id));
    if (release.digest !== digest(args.expectedDigest))
      throw failure('RELEASE_CONFLICT', 'The original candidate differs from the inspected release digest.');
    return { state, release };
  }
  #exportDirectory(alias, id) {
    this.#selection(alias); identifier(id, 'Export ID');
    return join(this.#config.exportsDirectory, 'python-workspace-' + alias + '-' + id);
  }
  async #exportStatus(alias, id, includeBytes = false) {
    const directory = this.#exportDirectory(alias, id);
    await privateSupportDirectory(directory);
    const descriptor = parse(await privateBytes(join(directory, 'manifest.json'), 65536));
    if (descriptor.schema !== PYTHON_EXPORT_SCHEMA || descriptor.workspace !== alias || descriptor.id !== id ||
        typeof descriptor.workspaceId !== 'string' || typeof descriptor.head !== 'string' ||
        !Number.isSafeInteger(descriptor.generation) || descriptor.generation < 0 ||
        descriptor.file?.name !== 'workspace.python-workspace.json' || !Number.isSafeInteger(descriptor.file.bytes) ||
        descriptor.file.bytes < 1 || descriptor.file.bytes > MAX_EXPORT || !/^[0-9a-f]{64}$/.test(descriptor.file.sha256))
      throw failure('PYTHON_EXPORT_INVALID', 'The retained export descriptor is incomplete or belongs to another operation.');
    const bytes = await privateBytes(join(directory, descriptor.file.name), MAX_EXPORT);
    if (bytes.length !== descriptor.file.bytes || hash(bytes) !== descriptor.file.sha256)
      throw failure('PYTHON_EXPORT_CHANGED', 'The original portable export bytes differ from their retained manifest.');
    return includeBytes ? { descriptor, bytes } : descriptor;
  }
  async #export(args) {
    const directory = this.#exportDirectory(args.workspace, args.id);
    originalId(args.expectedHead); generation(args.expectedGeneration);
    let exists = false;
    try { await lstat(directory); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const checkRequest = descriptor => {
      if (descriptor.head !== args.expectedHead || descriptor.generation !== args.expectedGeneration)
        throw failure('PYTHON_EXPORT_CONFLICT', 'This export ID already belongs to another saved head or release generation.');
      return descriptor;
    };
    if (exists) return checkRequest(await this.#exportStatus(args.workspace, args.id));
    const model = this.#model(args.workspace), state = await model.state();
    if (state.workspace.head !== args.expectedHead || state.release.state.generation !== args.expectedGeneration)
      throw failure('PYTHON_EXPORT_CONFLICT', 'The current saved source or native release selection changed. Refresh before exporting.');
    const bundle = await model.exportBundle();
    if (bundle.bytes.length > MAX_EXPORT) throw failure('PYTHON_EXPORT_TOO_LARGE', 'This portable export exceeds the original 256 MB MCP reader budget; retain it through the native workspace exporter.');
    const payload = parse(bundle.bytes);
    if (payload.workspace.metadata.head !== args.expectedHead || payload.releaseStore.state.generation !== args.expectedGeneration)
      throw failure('PYTHON_EXPORT_CONFLICT', 'The source or selection changed while the original archive was assembled. Inspect retained status before another export.');
    const descriptor = { schema: PYTHON_EXPORT_SCHEMA, workspace: args.workspace, workspaceId: payload.workspace.metadata.id,
      id: args.id, head: args.expectedHead, generation: args.expectedGeneration, createdAt: payload.createdAt,
      file: { name: 'workspace.python-workspace.json', bytes: bundle.bytes.length, sha256: bundle.sha256 } };
    await privateSupportDirectory(this.#config.exportsDirectory);
    const temporary = await mkdtemp(join(this.#config.exportsDirectory, '.python-export-'));
    try {
      await writePrivate(join(temporary, descriptor.file.name), bundle.bytes);
      await writePrivate(join(temporary, 'manifest.json'), descriptor);
      const sourceHandle = await open(temporary, 'r');
      try { await sourceHandle.sync(); } finally { await sourceHandle.close(); }
      try { await rename(temporary, directory); }
      catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
        return checkRequest(await this.#exportStatus(args.workspace, args.id));
      }
      const parent = await open(this.#config.exportsDirectory, 'r');
      try { await parent.sync(); } finally { await parent.close(); }
      return descriptor;
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
  async #read(args) {
    this.#selection(args.workspace); originalId(args.id);
    const kinds = ['source', 'declaration', 'preview', 'preview-input', 'customer', 'export'];
    if (!kinds.includes(args.kind)) throw failure('INVALID_PARAMS', 'Choose a declared original file kind.');
    if (['source', 'customer'].includes(args.kind)) sourceFile(args.file);
    else if (args.file !== undefined) throw failure('INVALID_PARAMS', 'Only source and customer reads select a retained file name.');
    const key = JSON.stringify([args.kind, args.id, args.file ?? null]);
    return this.#reads.read({ scope: args.workspace, key, kind: args.kind, directory: this.#config.exportsDirectory,
      readId: args.readId, expectedSha256: args.expectedSha256, offset: args.offset, limit: args.limit,
      load: async () => {
        if (args.kind === 'export') {
          const value = await this.#exportStatus(args.workspace, args.id, true);
          return { bytes: value.bytes, name: value.descriptor.file.name, type: 'application/json' };
        }
        const model = this.#model(args.workspace);
        if (args.kind === 'customer') {
          const value = await model.customerFile(args.id, args.file);
          return { ...value, name: args.file, type: value.contentType };
        }
        if (args.kind === 'preview') {
          const value = await model.previewOutput(args.id);
          return { ...value, name: args.id + '.output', type: value.contentType };
        }
        if (args.kind === 'preview-input') return { bytes: jsonBytes(model.row('previews', args.id).input),
          name: args.id + '.input.json', type: 'application/json' };
        if (args.kind === 'declaration') return { bytes: Buffer.from(model.row('revisions', args.id).declarationText),
          name: args.id + '.merchant.json', type: 'application/json' };
        const value = await model.file(args.id, args.file);
        return { bytes: value.encoding === 'utf8' ? Buffer.from(value.text) : Buffer.from(value.base64, 'base64'),
          name: args.file, type: value.encoding === 'utf8' ? 'text/plain; charset=utf-8' : 'application/octet-stream' };
      } });
  }
  async call(name, args) {
    if (this.#retired) throw failure('PYTHON_CLOSING', 'Python workspace operations are closing.');
    try {
      if (name === 'merchant_python_status') return await this.#status(args.workspace);
      this.#selection(args.workspace);
      if (name === 'merchant_python_open') return await this.#open(args.workspace);
      if (name === 'merchant_python_close') return await this.#closeWorkspace(args.workspace);
      if (name === 'merchant_python_export') return await this.#export(args);
      if (name === 'merchant_python_export_status') return await this.#exportStatus(args.workspace, args.id);
      if (name === 'merchant_python_read') return await this.#read(args);
      if (name === 'merchant_python_read_release') {
        if (typeof args.readId !== 'string' || args.readId.length > 64 || !args.readId)
          throw failure('INVALID_PARAMS', 'Use the original retained read ID.');
        await this.#reads.release(args.workspace, args.readId);
        return { workspace: args.workspace, released: args.readId };
      }
      const model = this.#model(args.workspace);
      switch (name) {
        case 'merchant_python_revision': return this.#revision(model, args);
        case 'merchant_python_history': {
          if (!KINDS.includes(args.kind)) throw failure('INVALID_PARAMS', 'Choose revisions, previews, stages or customers.');
          const head = model.metadata().head;
          if (args.id !== undefined) return { workspace: args.workspace, kind: args.kind, head,
            record: recordView(args.kind, model.row(args.kind, originalId(args.id))) };
          return { workspace: args.workspace, kind: args.kind, head,
            ...page(model.rows(args.kind).map(row => recordView(args.kind, row)), args) };
        }
        case 'merchant_python_save': case 'merchant_python_restore': case 'merchant_python_refresh': {
          const { workspace, ...input } = args;
          originalId(input.expectedHead);
          const record = name === 'merchant_python_save' ? await model.save(input)
            : name === 'merchant_python_restore' ? await model.restore(input) : await model.refreshSource(input);
          return { workspace, revision: revisionSummary(record), validation: record.validation, head: model.metadata().head };
        }
        case 'merchant_python_preview': {
          const { workspace, ...input } = args;
          await model.preview(input);
          const id = 'p-' + hash(input.operationId);
          return { workspace, kind: 'previews', record: recordView('previews', model.row('previews', id)) };
        }
        case 'merchant_python_cancel': {
          await model.cancelPreview({ id: originalId(args.id) });
          return { workspace: args.workspace, kind: 'previews', record: recordView('previews', model.row('previews', args.id)) };
        }
        case 'merchant_python_stage': {
          const selected = this.#selection(args.workspace);
          const record = await model.stage({ id: identifier(args.id), revisionId: originalId(args.revisionId),
            ...(args.label === undefined ? {} : { label: args.label }), runtime: selected.runtime });
          return { workspace: args.workspace, kind: 'stages', record: recordView('stages', record) };
        }
        case 'merchant_python_release_review': {
          const { readReleaseState } = await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs');
          const state = await readReleaseState(model.releaseRoot), from = args.from === undefined ? state.active : args.from;
          const comparison = await model.diff(from === null ? null : identifier(from), identifier(args.id));
          return { workspace: args.workspace, generation: state.generation, candidate: releaseView(comparison.after),
            comparison: { ...comparison, before: releaseView(comparison.before), after: releaseView(comparison.after),
              runtimeChanges: comparison.runtimeChanges.map(change => change.field === 'python'
                ? { ...change, before: pythonSourceView(change.before), after: pythonSourceView(change.after) } : change) } };
        }
        case 'merchant_python_activate': case 'merchant_python_rollback': {
          const target = identifier(name === 'merchant_python_activate' ? args.id : args.to);
          await this.#selectionReview(model, args, target);
          const input = { expectedGeneration: args.expectedGeneration, reason: line(args.reason, 'Selection reason') };
          if (name === 'merchant_python_activate') await model.activate({ ...input, id: target });
          else await model.rollback({ ...input, to: target });
          return await this.#status(args.workspace);
        }
        case 'merchant_python_start': case 'merchant_python_restart': {
          await this.#selectionReview(model, args);
          if (name === 'merchant_python_start') await model.run({ expectedGeneration: args.expectedGeneration });
          else await model.restart({ instanceId: args.instanceId, expectedGeneration: args.expectedGeneration });
          return await this.#status(args.workspace);
        }
        case 'merchant_python_stop': await model.stop({ instanceId: args.instanceId }); return await this.#status(args.workspace);
        case 'merchant_python_customer_export': {
          const record = await model.exportCustomer({ id: identifier(args.id), instanceId: args.instanceId });
          return { workspace: args.workspace, kind: 'customers', record: recordView('customers', record) };
        }
        default: throw failure('TOOL_NOT_FOUND', 'Unknown original Python workspace operation.');
      }
    } catch (error) {
      if (error.path || error.syscall) throw failure('PYTHON_STORAGE_UNAVAILABLE', 'Original private Python storage could not complete. Inspect retained status before retrying.');
      throw error;
    }
  }
  close() {
    if (!this.#close) {
      this.#retired = true;
      this.#close = (async () => {
        await Promise.allSettled([...this.#openings.values()]);
        const outcomes = await Promise.allSettled([...this.#models.keys()].map(alias => this.#closeWorkspace(alias)));
        await this.#reads.close();
        const error = outcomes.find(result => result.status === 'rejected')?.reason;
        if (error) throw error;
      })();
    }
    return this.#close;
  }
}
