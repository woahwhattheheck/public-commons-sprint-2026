// MIT. Original merchant operations over the same Open311 SQLite workspace.
import { RetainedFileReads } from '../../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import { failure, plain, exact } from '../../../../stellar-forge/mcp-merchant-operator/host-files.mjs';
import { canonicalJson } from './domain.mjs';
import { openWorkspace } from './workspace.mjs';
import { readOpen311HostInput, readOpen311WorkspaceConfiguration } from './mcp-client.mjs';
import { open311WorkspaceTools, open311FileSelection } from './mcp-tools.mjs';
export { open311WorkspaceTools, readOpen311WorkspaceConfiguration };
export async function initializeOpen311MerchantWorkspace(options) {
  return (await import('./mcp-setup.mjs')).initializeOpen311MerchantWorkspace(options);
}

const definitions = new Map(open311WorkspaceTools((name, description, properties, required) =>
  ({ name, description, properties, required })).map(item => [item.name, item]));
const need = (value, message, code = 'INVALID_PARAMS') => { if (!value) throw failure(code, message); };
const clone = value => JSON.parse(canonicalJson(value));
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
function validate(value, schema, name) {
  if (schema.type === 'string') need(typeof value === 'string' &&
    value.length >= (schema.minLength ?? 0) && value.length <= (schema.maxLength ?? Number.MAX_SAFE_INTEGER) &&
    (!schema.pattern || new RegExp(schema.pattern).test(value)), 'Use the declared ' + name + '.');
  if (schema.type === 'integer') need(Number.isSafeInteger(value) && value >= (schema.minimum ?? 0) &&
    value <= (schema.maximum ?? Number.MAX_SAFE_INTEGER), 'Use the supported integer ' + name + '.');
  if (schema.type === 'boolean') need(typeof value === 'boolean', 'Use a boolean ' + name + '.');
  if (schema.enum) need(schema.enum.includes(value), 'Choose a declared ' + name + '.');
  if (schema.type === 'object') {
    need(plain(value), 'Use a complete JSON ' + name + ' object.');
    if (schema.properties) {
      if (schema.additionalProperties === false) exact(value, Object.keys(schema.properties), schema.required ?? []);
      for (const [key, child] of Object.entries(value)) if (schema.properties[key])
        validate(child, schema.properties[key], name + '.' + key);
    }
  }
}
function small(value) {
  need(Buffer.byteLength(JSON.stringify(value)) <= 2 * 1024 * 1024,
    'Choose a smaller record page or read the complete original file through retained chunks.', 'OPEN311_VIEW_TOO_LARGE');
  return value;
}
function page(values, { offset = 0, limit = 25 } = {}) {
  need(offset <= values.length, 'Select an offset within the complete stored collection.');
  const items = values.slice(offset, offset + limit), next = offset + items.length;
  return { items, total: values.length, offset, limit, returned: items.length,
    nextOffset: next < values.length ? next : null };
}
function byteManifest(raw) {
  if (!raw) return null;
  const { body, ...manifest } = raw;
  return manifest;
}
function operationView(operation) {
  if (!operation.error?.raw) return operation;
  return { ...operation, error: { ...operation.error, raw: byteManifest(operation.error.raw) } };
}
function selection(input) {
  const chosen = pick(input, Object.keys(open311FileSelection)), kind = chosen.kind;
  const selected = kind === 'workspace' ? [] : kind === 'operation' ? ['operationId']
    : kind === 'comparison' ? ['before', 'after'] : ['capture'];
  exact(chosen, ['kind', 'expectedRevision', ...selected], ['kind', ...selected]);
  if (['workspace', 'json', 'csv', 'report'].includes(kind))
    need(Number.isSafeInteger(chosen.expectedRevision), 'Pin the observed workspace revision for this derived file.');
  return chosen;
}
export class MerchantOpen311Workspaces {
  #config; #exports; #workspaces = new Map(); #tasks = new Set(); #closing = false; #close;
  #reads = new RetainedFileReads({ errorPrefix: 'OPEN311', maxSnapshotBytes: 256000000 });
  constructor(config) { this.#config = config.open311Workspaces; this.#exports = config.exportsDirectory; }
  get summary() {
    return { configured: Boolean(this.#config), workspaces: Object.keys(this.#config?.workspaces ?? {}),
      openWorkspaces: this.#workspaces.size, ...this.#reads.summary };
  }
  #entry(alias) {
    const entry = this.#config?.workspaces?.[alias];
    need(entry, 'Choose a configured municipal workspace.', 'OPEN311_WORKSPACE_UNKNOWN');
    return entry;
  }
  #store(alias) {
    const entry = this.#entry(alias);
    if (!this.#workspaces.has(alias)) this.#workspaces.set(alias, openWorkspace(entry.directory));
    return this.#workspaces.get(alias);
  }
  #aliases(alias) {
    const entry = this.#entry(alias);
    return { workspace: alias, label: entry.label,
      inputs: Object.entries(entry.inputs).map(([input, item]) =>
        ({ input, label: item.label, sha256: item.sha256, kind: 'workspace' })),
      connectionProfiles: Object.entries(entry.connectionProfiles).map(([profile, item]) =>
        ({ profile, connectionId: item.id, name: item.name, baseUrl: item.baseUrl,
          jurisdictionId: item.jurisdictionId ?? '', statusValues: item.statusValues ?? ['open', 'closed'],
          responseLimit: item.responseLimit ?? 1000, pagination: item.pagination === true,
          extendedAttributes: item.extendedAttributes === true, queryExtensions: item.queryExtensions ?? [],
          attribution: item.attribution ?? null })) };
  }
  #atRevision(store, expectedRevision, work) {
    const before = store.state();
    if (expectedRevision !== undefined) need(before.revision === expectedRevision,
      'The workspace revision changed. Read its current state before selecting another view.', 'OPEN311_REVISION_CONFLICT');
    const result = work();
    const after = store.state();
    need(after.workspaceId === before.workspaceId && after.revision === before.revision,
      'The workspace changed while this view was read. Reopen it at one revision.', 'OPEN311_REVISION_CONFLICT');
    return { revision: before.revision, workspaceId: before.workspaceId, result };
  }
  async #call(name, args) {
    if (name === 'merchant_open311_workspaces')
      return { ...this.summary, workspaces: Object.keys(this.#config?.workspaces ?? {}).map(alias => this.#aliases(alias)) };
    const alias = args.workspace, entry = this.#entry(alias), store = this.#store(alias);
    if (name === 'merchant_open311_status') {
      const state = store.state(), { connections, captures, reviews, operations, ...metadata } = state;
      return { ...metadata, workspace: alias, label: entry.label,
        counts: { connections: connections.length, captures: captures.length, reviews: reviews.length },
        recentOperations: operations, ...this.#reads.status(alias) };
    }
    if (name === 'merchant_open311_records') {
      const state = store.state();
      need(state.revision === args.expectedRevision, 'The workspace revision changed before this collection page.', 'OPEN311_REVISION_CONFLICT');
      return { workspaceId: state.workspaceId, revision: state.revision, kind: args.kind, ...page(state[args.kind], args) };
    }
    if (name === 'merchant_open311_connection_put') {
      const connection = entry.connectionProfiles[args.profile];
      need(connection, 'Choose a complete host-selected source profile.', 'OPEN311_PROFILE_UNKNOWN');
      return store.putConnection({ requestId: args.requestId, expectedRevision: args.expectedRevision, connection: clone(connection) });
    }
    if (name === 'merchant_open311_capture')
      return store.capture(pick(args, ['requestId', 'expectedRevision', 'connectionId', 'kind', 'query', 'resourceId']));
    if (name === 'merchant_open311_capture_info') {
      const result = store.captureInfo({ id: args.id });
      return { capture: result.capture, receipt: result.receipt, raw: byteManifest(result.raw),
        itemCount: result.items.length, completeFiles: { source: 'source', records: 'json' } };
    }
    if (name === 'merchant_open311_services') {
      const read = this.#atRevision(store, args.expectedRevision, () => store.services({ connection: args.connection }));
      return { workspaceId: read.workspaceId, revision: read.revision, capture: read.result.capture,
        ...page(read.result.items, args) };
    }
    if (name === 'merchant_open311_requests') {
      const read = this.#atRevision(store, args.expectedRevision,
        () => store.requests({ ...pick(args, ['capture', 'status', 'service', 'q', 'offset', 'sort', 'order']), limit: args.limit ?? 25 }));
      const result = read.result, next = result.offset + result.items.length;
      return { workspaceId: read.workspaceId, revision: read.revision, capture: args.capture, ...result,
        returned: result.items.length, nextOffset: next < result.total ? next : null };
    }
    if (name === 'merchant_open311_request') {
      need(Boolean(args.capture) !== Boolean(args.connection), 'Select exactly one capture or connection for this case.');
      const read = this.#atRevision(store, args.expectedRevision,
        () => store.request(pick(args, ['id', 'capture', 'connection'])));
      return { workspaceId: read.workspaceId, revision: read.revision, ...read.result };
    }
    if (name === 'merchant_open311_diff') {
      const diff = store.diff({ before: args.before, after: args.after }), section = args.section ?? 'changed';
      return { before: diff.before, after: diff.after, scopeComparable: diff.scopeComparable, section,
        counts: Object.fromEntries(['added', 'changed', 'unchanged', 'missingFromCapture'].map(key => [key, diff[key].length])),
        ...page(diff[section], args) };
    }
    if (name === 'merchant_open311_review_put')
      return store.putReview(pick(args, ['requestId', 'expectedRevision', 'connectionId', 'serviceRequestId', 'review']));
    if (name === 'merchant_open311_operation') return operationView(store.operation(args.requestId));
    if (name === 'merchant_open311_input') {
      const found = await readOpen311HostInput(entry, args.input);
      return { workspace: alias, input: args.input, name: found.name, bytes: found.bytes.length,
        sha256: found.sha256, schema: found.value.schema,
        sourceWorkspace: found.value.payload.workspace, manifest: found.value.manifest };
    }
    if (name === 'merchant_open311_receive') {
      const found = await readOpen311HostInput(entry, args.input, args.expectedSha256);
      return store.receive({ requestId: args.requestId, expectedRevision: args.expectedRevision, bundle: found.value });
    }
    if (name === 'merchant_open311_file_release') {
      await this.#reads.release(alias, args.readId);
      return { workspace: alias, readId: args.readId, state: 'RELEASED' };
    }
    if (name === 'merchant_open311_file_read') {
      const chosen = selection(args);
      return this.#reads.read({ scope: alias, key: canonicalJson(chosen), kind: 'open311-' + chosen.kind,
        directory: this.#exports, readId: args.readId, expectedSha256: args.expectedSha256,
        offset: args.offset, limit: args.limit,
        load: () => this.#atRevision(store, chosen.expectedRevision, () => {
          let exported;
          if (chosen.kind === 'comparison') exported = {
            filename: 'open311-comparison-' + chosen.before + '-' + chosen.after + '.json',
            contentType: 'application/json; charset=utf-8',
            body: canonicalJson({ schema: 'commons.open311.comparison-export.v1',
              ...store.diff({ before: chosen.before, after: chosen.after }) }) + '\n',
          };
          else if (chosen.kind === 'operation') exported = {
            filename: 'open311-operation-' + chosen.operationId + '.json',
            contentType: 'application/json; charset=utf-8',
            body: canonicalJson({ schema: 'commons.open311.operation-export.v1',
              operation: store.operation(chosen.operationId) }) + '\n',
          };
          else exported = store.export(pick(chosen, ['kind', 'capture']));
          return { name: exported.filename, type: exported.contentType,
            bytes: Buffer.isBuffer(exported.body) ? exported.body : Buffer.from(exported.body, 'utf8') };
        }).result,
      });
    }
    throw failure('INVALID_PARAMS', 'Unknown municipal workspace tool.');
  }
  call(name, args = {}) {
    need(!this.#closing, 'The municipal workspace provider is closing.', 'OPEN311_MCP_CLOSED');
    const definition = definitions.get(name);
    need(definition && plain(args), 'Choose a declared municipal workspace tool.');
    exact(args, Object.keys(definition.properties), definition.required);
    for (const [key, value] of Object.entries(args)) validate(value, definition.properties[key], key);
    const snapshot = clone(args);
    const task = Promise.resolve().then(() => this.#call(name, snapshot)).then(small);
    this.#tasks.add(task); task.finally(() => this.#tasks.delete(task)).catch(() => {});
    return task;
  }
  close() {
    if (!this.#close) {
      this.#closing = true;
      this.#close = (async () => {
        await Promise.allSettled([...this.#tasks]);
        await this.#reads.close();
        for (const store of this.#workspaces.values()) store.close();
        this.#workspaces.clear();
      })().catch(error => { this.#close = null; throw error; });
    }
    return this.#close;
  }
}
