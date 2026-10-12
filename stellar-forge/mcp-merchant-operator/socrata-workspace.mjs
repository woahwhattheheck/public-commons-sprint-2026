import { socrataWorkspaceTools, alias, hash, uuid, read, object, text, publisherActions } from './catalog/socrata-workspace.mjs';
export { socrataWorkspaceTools } from './catalog/socrata-workspace.mjs';
// MIT. Agent and browser operation of the original Socrata workspace and publisher.
import { constants } from 'node:fs';
import { open, realpath, lstat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { exact, failure, identifier, line, plain, privateSupportDirectory, fileBytes } from './config.mjs';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { publicDomain } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/socrata/source.mjs';

export const SOCRATA_WORKSPACE_CONNECTION_SCHEMA = 'stellar-forge.socrata-workspace-connection.v1';







function hostPath(value, base) {
  if (typeof value !== 'string' || !value || /[\x00-\x1f\x7f]/.test(value))
    throw failure('CONFIGURATION_ERROR', 'Socrata host paths belong in the private connection file.');
  return resolve(base, value);
}
function count(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw failure('INVALID_PARAMS', label + ' must be an integer from ' + minimum + ' to ' + maximum + '.');
  return value;
}
async function connectionJSON(path) {
  if (await realpath(path) !== resolve(path)) throw failure('CONFIGURATION_ERROR', 'Use the canonical private connection file.');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 1024 * 1024 || process.platform !== 'win32' &&
        ((info.mode & 0o077) || process.getuid && info.uid !== process.getuid()))
      throw failure('CONFIGURATION_ERROR', 'Use an owned private Socrata connection JSON file, at most one MiB.');
    const bytes = await file.readFile();
    if (bytes.length > 1024 * 1024) throw failure('CONFIGURATION_ERROR', 'The connection file exceeds one MiB.');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { await file.close(); }
}
function entries(value, label) {
  if (value === undefined) return [];
  if (!plain(value) || Object.keys(value).length > 32)
    throw failure('CONFIGURATION_ERROR', 'Use up to 32 named ' + label + '.');
  return Object.entries(value).map(([name, entry]) => [identifier(name, label + ' alias'), entry]);
}
function runtime(raw = {}) {
  exact(raw, ['port', 'facilitator', 'allowLocalFacilitator']);
  count(raw.port ?? 0, 'Seller port', 0, 65535);
  if (raw.allowLocalFacilitator !== undefined && typeof raw.allowLocalFacilitator !== 'boolean')
    throw failure('CONFIGURATION_ERROR', 'allowLocalFacilitator must be a Boolean.');
  if (raw.facilitator !== undefined) {
    const url = new URL(raw.facilitator);
    if (url.username || url.password || url.search || url.hash ||
        url.protocol !== 'https:' && !(raw.allowLocalFacilitator === true && url.protocol === 'http:' && url.hostname === '127.0.0.1'))
      throw failure('CONFIGURATION_ERROR', 'Use the original configured HTTPS or explicit loopback facilitator.');
  }
  return { ...raw, port: raw.port ?? 0 };
}
/** Configuration resolves authorized host inputs; it opens no workspace or provider connection. */
export async function readSocrataWorkspaceConfiguration(path) {
  path = resolve(path);
  const raw = await connectionJSON(path);
  exact(raw, ['schema', 'workspaces'], ['schema', 'workspaces']);
  if (raw.schema !== SOCRATA_WORKSPACE_CONNECTION_SCHEMA || !plain(raw.workspaces) ||
      !Object.keys(raw.workspaces).length || Object.keys(raw.workspaces).length > 32)
    throw failure('CONFIGURATION_ERROR', 'Declare 1–32 original Socrata workspaces.');
  const base = dirname(path), workspaces = Object.create(null), seen = new Set();
  for (const [name, input] of Object.entries(raw.workspaces)) {
    identifier(name, 'Socrata workspace alias');
    exact(input, ['label', 'directory', 'domains', 'appTokenEnv', 'imports', 'merchants', 'buyerWorkspaces', 'runtime'],
      ['directory', 'domains']);
    const directory = await realpath(hostPath(input.directory, base));
    await privateSupportDirectory(directory);
    if (seen.has(directory)) throw failure('CONFIGURATION_ERROR', 'Give each original Socrata directory one alias.');
    seen.add(directory);
    if (!Array.isArray(input.domains) || !input.domains.length || input.domains.length > 32)
      throw failure('CONFIGURATION_ERROR', 'Declare the public provider domains for this workspace.');
    const domains = [...new Set(input.domains.map(publicDomain))];
    if (input.appTokenEnv !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.appTokenEnv))
      throw failure('CONFIGURATION_ERROR', 'Use a startup environment-variable name for the provider token.');
    const imports = Object.create(null), merchants = Object.create(null), buyers = Object.create(null);
    for (const [key, item] of entries(input.imports, 'retained imports')) {
      exact(item, ['label', 'kind', 'file'], ['kind', 'file']);
      if (!['capture', 'package'].includes(item.kind)) throw failure('CONFIGURATION_ERROR', 'An import is an original capture or portable package.');
      const file = await realpath(hostPath(item.file, base)), info = await lstat(file);
      if (!info.isFile()) throw failure('CONFIGURATION_ERROR', 'Declare a regular original import file.');
      imports[key] = { label: line(item.label ?? key), kind: item.kind, file };
    }
    for (const [key, item] of entries(input.merchants, 'merchant profiles')) {
      exact(item, ['label', 'origin', 'path', 'payment'], ['origin', 'path', 'payment']);
      if (!plain(item.payment) || typeof item.origin !== 'string' || typeof item.path !== 'string')
        throw failure('CONFIGURATION_ERROR', 'Merchant profiles contain the original public origin, route and payment terms.');
      merchants[key] = { label: line(item.label ?? key), origin: item.origin, path: item.path, payment: item.payment };
    }
    for (const [key, item] of entries(input.buyerWorkspaces, 'buyer workspaces')) {
      exact(item, ['label', 'directory'], ['directory']);
      const buyerDirectory = await realpath(hostPath(item.directory, base));
      await privateSupportDirectory(buyerDirectory);
      buyers[key] = { label: line(item.label ?? key), directory: buyerDirectory };
    }
    workspaces[name] = { label: line(input.label ?? name), directory, domains,
      appTokenEnv: input.appTokenEnv ?? 'SOCRATA_APP_TOKEN', tokenRequired: input.appTokenEnv !== undefined,
      imports, merchants, buyerWorkspaces: buyers, runtime: runtime(input.runtime) };
  }
  return { workspaces };
}

function pageRows(rows, offset, limit) {
  const values = rows.slice(offset, offset + limit);
  return { values, page: { offset, limit, total: rows.length, nextOffset: offset + values.length < rows.length ? offset + values.length : null } };
}
function sourceView(state, offset = 0, limit = 50) {
  const result = { ...state, capture: state.capture ? { ...state.capture } : null, pages: {} };
  if (result.capture) delete result.capture.pages;
  for (const key of ['captures', 'editions', 'exports']) {
    const { values, page } = pageRows(state[key] ?? [], offset, limit);
    result[key] = key === 'exports' ? values.map(({ directory, packageFile, ...item }) => item) : values;
    result.pages[key] = page;
  }
  return result;
}
function originalId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/.test(value))
    throw failure('INVALID_PARAMS', 'Use the exact retained native record ID.');
  return value;
}
function only(raw, keys) { exact(raw, keys); return raw; }
export class MerchantSocrataWorkspaces {
  #config; #handles = new Map(); #pending = new Set(); #closing = false; #close;
  #reads = new RetainedFileReads({ errorPrefix: 'SOCRATA' });
  constructor(config) { this.#config = config; }
  get summary() { return { configured: Boolean(this.#config.socrataWorkspaces),
    opened: [...this.#handles.keys()], pending: this.#pending.size, closing: this.#closing, ...this.#reads.summary }; }
  #declared(name) {
    identifier(name, 'Socrata workspace alias');
    const entry = this.#config.socrataWorkspaces?.workspaces?.[name];
    if (!entry) throw failure('SOCRATA_WORKSPACE_NOT_CONFIGURED', 'Choose an alias from merchant_socrata_status.');
    return entry;
  }
  #domain(entry, value) {
    const domain = publicDomain(value);
    if (!entry.domains.includes(domain)) throw failure('SOCRATA_DOMAIN_NOT_CONFIGURED', 'Choose a provider domain declared for this workspace.');
    return domain;
  }
  async #open(name) {
    const configuration = this.#declared(name);
    if (!this.#handles.has(name)) {
      const opening = (async () => {
        const appToken = process.env[configuration.appTokenEnv];
        if (configuration.tokenRequired && !appToken) throw failure('SOCRATA_TOKEN_UNAVAILABLE', 'The declared provider token environment variable is empty.');
        const { openSocrataOperator } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/socrata/server.mjs');
        const operator = await openSocrataOperator({ directory: configuration.directory, appToken });
        return { configuration, operator, instanceId: randomUUID(), browser: null, tail: Promise.resolve(), closing: false };
      })();
      this.#handles.set(name, opening);
      try { await opening; } catch (error) { if (this.#handles.get(name) === opening) this.#handles.delete(name); throw error; }
    }
    return this.#status(name);
  }
  async #status(name, offset = 0, limit = 50) {
    count(offset, 'History offset'); count(limit, 'History page size', 1, 100);
    if (name === undefined) return { ...this.summary,
      workspaces: Object.entries(this.#config.socrataWorkspaces?.workspaces ?? {}).map(([workspace, entry]) => ({
        workspace, label: entry.label, domains: entry.domains, state: this.#handles.has(workspace) ? 'OPEN' : 'CLOSED',
        imports: Object.entries(entry.imports).map(([sourceImport, item]) => ({ sourceImport, label: item.label, kind: item.kind })),
        merchants: Object.entries(entry.merchants).map(([profile, item]) => ({ profile, label: item.label, origin: item.origin, path: item.path, payment: item.payment })),
        buyerWorkspaces: Object.entries(entry.buyerWorkspaces).map(([buyerWorkspace, item]) => ({ buyerWorkspace, label: item.label }))
      })) };
    const configuration = this.#declared(name), pending = this.#handles.get(name);
    if (!pending) return { workspace: name, label: configuration.label, state: 'CLOSED' };
    const handle = await pending;
    return { workspace: name, instanceId: handle.instanceId, state: handle.closing ? 'CLOSING' : 'OPEN',
      native: sourceView(await handle.operator.state(), offset, limit), browser: { open: Boolean(handle.browser) },
      fileReads: this.#reads.status(name) };
  }
  async #stop(name, handle) {
    handle.closing = true;
    await handle.tail.catch(() => {});
    if (handle.browser) { await handle.browser.close(); handle.browser = null; }
    await this.#reads.closeScope(name);
    await handle.operator.close();
    this.#handles.delete(name);
    return { workspace: name, instanceId: handle.instanceId, state: 'CLOSED' };
  }
  async #file(name, handle, args) {
    originalId(args.id);
    if (args.expectedSha256 !== undefined && !/^[a-f0-9]{64}$/.test(args.expectedSha256)) throw failure('INVALID_PARAMS', 'Choose the exact original file SHA-256.');
    const key = args.kind + ':' + args.id + ':' + (args.filename ?? '');
    return this.#reads.read({ scope: name, key, kind: args.kind, directory: this.#config.exportsDirectory,
      expectedSha256: args.expectedSha256, readId: args.readId, offset: args.offset, limit: args.limit,
      load: async () => {
        if (args.kind === 'source-export') {
          if (typeof args.filename !== 'string') throw failure('INVALID_PARAMS', 'Choose an original filename from this export.');
          const file = await handle.operator.readExport(args.id, args.filename);
          return { bytes: await fileBytes(file.path, 256_000_000), name: args.filename, type: file.contentType };
        }
        if (!['draft-csv', 'draft-review', 'buyer-config', 'session-manifest', 'session-csv', 'session-jsonl', 'session-review'].includes(args.kind))
          throw failure('INVALID_PARAMS', 'Choose a supported original publisher file kind.');
        const file = await handle.operator.readPublisherExport(args.kind, args.id);
        return { bytes: file.bytes, name: file.filename, type: file.contentType };
      } });
  }
  async #execute(name, handle, args) {
    const entry = handle.configuration, original = handle.operator;
    const call = async (action, payload = {}) => {
      const result = await original.act(action, payload);
      return { ...result, state: sourceView(result.state) };
    };
    switch (name) {
      case 'merchant_socrata_source': {
        if (args.action === 'configure') {
          const source = only(args.source, ['domain','datasetId','protocol','where','order','pageSize','maxRows','maxBytes','timeoutMs']);
          this.#domain(entry, source.domain); return call('source.configure', source);
        }
        if (args.action === 'search') return call('source.search', { query: args.query ?? '',
          domain: this.#domain(entry, args.domain ?? (await original.state()).source?.domain ?? entry.domains[0]),
          ...(args.offset === undefined ? {} : { offset: args.offset }), ...(args.limit === undefined ? {} : { limit: args.limit }) });
        if (args.action !== 'inspect') throw failure('INVALID_PARAMS', 'Choose configure, inspect or search.');
        this.#domain(entry, (await original.state()).source?.domain); return call('source.inspect');
      }
      case 'merchant_socrata_capture': {
        if (args.action === 'import') {
          const source = entry.imports[identifier(args.sourceImport, 'Source import')];
          if (!source || source.kind !== 'capture') throw failure('SOCRATA_IMPORT_NOT_CONFIGURED', 'Choose a declared capture manifest.');
          const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await fileBytes(source.file, 16 * 1024 * 1024)));
          this.#domain(entry, manifest.source?.domain);
          return call('capture.import', { manifestPath: source.file });
        }
        if (!['start','advance','pause','resume'].includes(args.action)) throw failure('INVALID_PARAMS', 'Choose an original capture action.');
        const state = await original.state();
        this.#domain(entry, (args.action === 'start' ? state.source : state.capture?.source)?.domain);
        return call('capture.' + args.action, args.action === 'advance' ? { pages: args.pages ?? 1 } : {});
      }
      case 'merchant_socrata_mapping': return call('mapping.save', args.mapping);
      case 'merchant_socrata_edition':
        if (args.action === 'build') return call('edition.build');
        if (args.action === 'activate') return call('edition.activate', { editionId: originalId(args.editionId) });
        throw failure('INVALID_PARAMS', 'Choose build or activate.');
      case 'merchant_socrata_query': return call('dataset.query', { query: args.query });
      case 'merchant_socrata_merchant': {
        const profile = entry.merchants[identifier(args.profile, 'Merchant profile')];
        if (!profile) throw failure('SOCRATA_MERCHANT_NOT_CONFIGURED', 'Choose a declared public merchant profile.');
        const { label, ...terms } = profile; return call('merchant.configure', terms);
      }
      case 'merchant_socrata_export': return call('package.export');
      case 'merchant_socrata_restore': {
        const source = entry.imports[identifier(args.sourceImport, 'Source import')];
        if (!source || source.kind !== 'package') throw failure('SOCRATA_IMPORT_NOT_CONFIGURED', 'Choose a declared portable package.');
        return call('package.import', { packagePath: source.file });
      }
      case 'merchant_socrata_file': return this.#file(args.workspace, handle, args);
      case 'merchant_socrata_file_release':
        await this.#reads.release(args.workspace, args.readId); return { workspace: args.workspace, readId: args.readId, released: true };
      case 'merchant_socrata_publisher': {
        if (!publisherActions.has(args.action)) throw failure('INVALID_PARAMS', 'Choose an original publisher action.');
        const payload = { ...(args.payload ?? {}) };
        if (!plain(args.payload ?? {})) throw failure('INVALID_PARAMS', 'Use an object publisher payload.');
        if (args.action === 'publisher.prepare') {
          only(payload, ['exportId']);
          const selected = (await original.state()).exports.find(item => item.id === payload.exportId);
          if (!selected) throw failure('SOCRATA_EXPORT_NOT_FOUND', 'Choose an original export ID from this source workspace.');
          return call(args.action, { exportDirectory: selected.directory });
        }
        if (args.action === 'publisher.release.stage') {
          only(payload, ['draftId', 'id', 'label']);
          return call(args.action, { ...payload, runtime: entry.runtime });
        }
        if (args.action === 'publisher.buyer.session') {
          only(payload, ['buyerId','buyerWorkspace','maxPages','maxTotalAtomic','maxRows','maxPageBytes']);
          const buyer = entry.buyerWorkspaces[identifier(payload.buyerWorkspace, 'Buyer workspace')];
          if (!buyer) throw failure('SOCRATA_BUYER_NOT_CONFIGURED', 'Choose a host-declared original buyer workspace.');
          const { buyerWorkspace, ...selected } = payload;
          return call(args.action, { ...selected, workspaceDirectory: buyer.directory });
        }
        // Original action schemas validate all other draft/release/session inputs.
        return call(args.action, payload);
      }
      case 'merchant_socrata_browser': {
        if (args.action === 'close') {
          if (handle.browser) { await handle.browser.close(); handle.browser = null; }
          return { workspace: args.workspace, browser: 'CLOSED', instanceId: handle.instanceId };
        }
        if (args.action !== 'open') throw failure('INVALID_PARAMS', 'Choose open or close.');
        if (!handle.browser) {
          const { startSocrataWorkspace } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/socrata/server.mjs');
          handle.browser = await startSocrataWorkspace({ directory: entry.directory, operator: original,
            port: count(args.port ?? 0, 'Browser port', 0, 65535) });
        }
        return { workspace: args.workspace, instanceId: handle.instanceId, url: handle.browser.url, browser: 'OPEN' };
      }
      default: throw failure('TOOL_NOT_FOUND', 'Unknown Socrata workspace operation.');
    }
  }
  async #dispatch(name, args) {
    if (name === 'merchant_socrata_status') return this.#status(args.workspace, args.offset ?? 0, args.limit ?? 50);
    if (name === 'merchant_socrata_open') return this.#open(args.workspace);
    this.#declared(args.workspace);
    const opening = this.#handles.get(args.workspace);
    if (!opening) throw failure('SOCRATA_WORKSPACE_CLOSED', 'Open this original workspace with merchant_socrata_open.');
    const handle = await opening;
    if (handle.closing) throw failure('SOCRATA_WORKSPACE_CLOSING', 'The original workspace is closing.');
    if (name === 'merchant_socrata_close') {
      if (args.instanceId !== handle.instanceId) throw failure('INSTANCE_CONFLICT', 'Use this process-owned instance ID from status.');
      return this.#stop(args.workspace, handle);
    }
    const operation = handle.tail.then(() => this.#execute(name, handle, args));
    handle.tail = operation.then(() => {}, () => {});
    return operation;
  }
  async call(name, args) {
    if (this.#closing) throw failure('OPERATOR_CLOSING', 'The Socrata adapter is closing.');
    const operation = this.#dispatch(name, args);
    this.#pending.add(operation);
    try { return await operation; } finally { this.#pending.delete(operation); }
  }
  close() {
    if (this.#close) return this.#close;
    this.#closing = true;
    this.#close = (async () => {
      await Promise.allSettled([...this.#pending]);
      const outcomes = await Promise.allSettled([...this.#handles].map(async ([name, pending]) => this.#stop(name, await pending)));
      await this.#reads.close();
      if (outcomes.some(item => item.status === 'rejected')) throw failure('SOCRATA_CLOSE_FAILED', 'An original Socrata operator reported incomplete shutdown.');
    })();
    return this.#close;
  }
}
