// MIT. Merchant operations compose the original Snowflake browser and native writer.
import { lstat, realpath } from 'node:fs/promises';
import { dirname, basename, resolve, isAbsolute } from 'node:path';
import { boundedFile } from '../../../sf46-release/release-core.mjs';
import { inspectSnowflakeWorkspace } from '../managed.mjs';
import { startSnowflakeWorkspace } from '../server.mjs';
import { snowflakeAction } from './catalog.mjs';
import { SnowflakeRetainedExports, alias, fail } from './files.mjs';

export const SNOWFLAKE_WORKSPACE_CONNECTION_SCHEMA = 'stellar-forge.snowflake-merchant-connection.v1';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function exact(value, allowed, required = []) {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key)) ||
      required.some(key => !Object.hasOwn(value, key))) throw fail('CONFIGURATION_INVALID');
}
function label(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 240 || /[\x00-\x1f\x7f]/.test(value))
    throw fail('CONFIGURATION_INVALID', 'Use a nonempty single-line workspace label.');
  return value.trim();
}
/** Inspect the existing native UUID read-only. Configuration opens no writer or listener. */
export async function readSnowflakeWorkspaceConfiguration(path) {
  if (typeof path !== 'string' || !path || path.includes('\0')) throw fail('CONFIGURATION_INVALID');
  path = resolve(path);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077 ||
      process.getuid && stat.uid !== process.getuid() || await realpath(path) !== path)
    throw fail('CONFIGURATION_INVALID', 'Use the canonical owned private Snowflake connection JSON file.');
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
    await boundedFile(dirname(path), basename(path), 1048576)));
  exact(value, ['schema','workspaces'], ['schema','workspaces']);
  if (value.schema !== SNOWFLAKE_WORKSPACE_CONNECTION_SCHEMA || !plain(value.workspaces) ||
      Object.keys(value.workspaces).length < 1 || Object.keys(value.workspaces).length > 32)
    throw fail('CONFIGURATION_INVALID', 'Declare 1–32 original Snowflake workspaces.');
  const workspaces = Object.create(null), directories = new Set();
  for (const [name, input] of Object.entries(value.workspaces)) {
    alias(name); exact(input, ['label','directory','workspaceId'], ['directory','workspaceId']);
    if (typeof input.directory !== 'string' || !input.directory || input.directory.includes('\0') ||
        typeof input.workspaceId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(input.workspaceId))
      throw fail('CONFIGURATION_INVALID', 'Bind each alias to its original native directory and workspace UUID.');
    const directory = isAbsolute(input.directory) ? resolve(input.directory) : resolve(dirname(path), input.directory);
    const original = await inspectSnowflakeWorkspace(directory, { expectedId: input.workspaceId });
    if (directories.has(original.directory)) throw fail('CONFIGURATION_INVALID', 'Each original directory has one alias.');
    directories.add(original.directory);
    workspaces[name] = Object.freeze({ label: label(input.label ?? name), directory: original.directory, workspaceId: original.id });
  }
  return { workspaces: Object.freeze(workspaces) };
}
const page = args => ({ offset: args.offset ?? 0, pageSize: args.limit ?? 50 });
function publicationView(value) {
  if (!value) throw fail('PUBLICATION_UNKNOWN', 'The saved original publication does not exist.');
  const { directory, releaseRoot, links, release, ...saved } = value;
  return saved;
}
function chunkBytes(data) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data))
    throw fail('CHUNK_INVALID', 'Use canonical base64 for the exact original chunk.');
  const bytes = Buffer.from(data, 'base64');
  if (!bytes.length || bytes.length > 196608 || bytes.toString('base64') !== data) throw fail('CHUNK_INVALID');
  return bytes;
}

export class MerchantSnowflakeWorkspaces {
  #definitions; #environment; #transport; #handles = new Map(); #files;
  #pending = new Set(); #closing = false; #closeTask = null;
  constructor(config, { environment = process.env, transport = {} } = {}) {
    this.#definitions = config.snowflakeWorkspaces?.workspaces ?? Object.create(null);
    this.#environment = environment; this.#transport = transport;
    this.#files = new SnowflakeRetainedExports(config.exportsDirectory, this.#definitions);
  }
  #definition(name) {
    alias(name);
    if (!Object.hasOwn(this.#definitions, name)) throw fail('WORKSPACE_UNKNOWN', 'Choose a configured original Snowflake workspace.');
    return this.#definitions[name];
  }
  async #open(name) {
    const definition = this.#definition(name);
    if (!this.#handles.has(name)) {
      const opening = (async () => {
        await inspectSnowflakeWorkspace(definition.directory, { expectedId: definition.workspaceId });
        const native = await startSnowflakeWorkspace({ directory: definition.directory, env: this.#environment, transport: this.#transport });
        try {
          const state = await native.workspace.state();
          if (state.id !== definition.workspaceId) throw fail('WORKSPACE_CHANGED', 'The original configured workspace UUID changed.');
          return { native, name, tail: Promise.resolve(), closing: false, stopping: null };
        } catch (error) { await native.close(); throw error; }
      })();
      this.#handles.set(name, opening);
      opening.catch(() => { if (this.#handles.get(name) === opening) this.#handles.delete(name); });
    }
    const handle = await this.#handles.get(name);
    if (handle.closing) throw fail('WORKSPACE_CLOSING', 'The original workspace is draining its accepted operations.');
    return handle;
  }
  async #use(name, action) {
    const handle = await this.#open(name);
    if (handle.closing) throw fail('WORKSPACE_CLOSING');
    const task = handle.tail.then(() => action(handle.native));
    handle.tail = task.catch(() => {});
    return task;
  }
  async #stop(name, instanceId) {
    const opening = this.#handles.get(name);
    if (!opening) throw fail('INSTANCE_NOT_ACTIVE', 'This provider does not own an active process for the selected workspace.');
    const handle = await opening;
    if (handle.native.instanceId !== instanceId) throw fail('INSTANCE_CHANGED', 'Close the exact original instance returned by open.');
    if (!handle.stopping) {
      handle.closing = true;
      handle.stopping = (async () => {
        await handle.tail;
        try {
          await handle.native.close();
          if (this.#handles.get(name) === opening) this.#handles.delete(name);
          return { workspace: name, workspaceId: this.#definition(name).workspaceId, instanceId, state: 'CLOSED' };
        } catch (error) { handle.stopping = null; throw error; }
      })();
    }
    return handle.stopping;
  }
  call(name, args = {}) {
    if (this.#closing) return Promise.reject(fail('PROVIDER_CLOSING'));
    let selected;
    try { selected = snowflakeAction(name, args); }
    catch (error) { return Promise.reject(error); }
    const task = this.#execute(selected.action, args).finally(() => this.#pending.delete(task));
    this.#pending.add(task); return task;
  }
  async #execute(action, args) {
    if (action === 'workspaces') {
      const items = [];
      for (const [workspace, definition] of Object.entries(this.#definitions)) {
        const handle = await this.#handles.get(workspace)?.catch(() => null);
        items.push({ workspace, label: definition.label, workspaceId: definition.workspaceId,
          open: Boolean(handle), instanceId: handle?.native.instanceId ?? null,
          url: handle?.native.url ?? null, closing: handle?.closing ?? false });
      }
      return { workspaces: items };
    }
    if (action === 'manifest') return this.#files.manifest(args.exportId);
    if (action === 'file') return this.#files.file(args);
    if (action === 'file_release') return this.#files.release(args.exportId, args.readId);
    if (action === 'exports') {
      if (args.workspace !== undefined) this.#definition(args.workspace);
      return this.#files.list(args);
    }
    const definition = this.#definition(args.workspace);
    if (action === 'close') return this.#stop(args.workspace, args.instanceId);
    return this.#use(args.workspace, async native => {
      const workspace = native.workspace, store = workspace.store, context = {
        workspace: args.workspace, workspaceId: definition.workspaceId, instanceId: native.instanceId
      };
      switch (action) {
        case 'open': return { ...context, url: native.url, state: await workspace.state() };
        case 'state': return { ...context, state: await workspace.state() };
        case 'sources': return { ...context, ...store.list('sources', page(args)) };
        case 'source': return { ...context, source: store.source(args.sourceId) };
        case 'save_source': return { ...context, source: workspace.saveSource(args.config, args.expectedRevision) };
        case 'operations': return { ...context, ...store.list('operations', page(args)) };
        case 'operation': return { ...context, operation: store.operation(args.operationId) };
        case 'observations': return { ...context, ...store.observations(args.operationId, page(args)) };
        case 'capture': {
          const { workspace: selected, ...input } = args;
          return { ...context, operation: workspace.begin(input, { background: true }) };
        }
        case 'resume': {
          workspace.continueOperation(args.operationId).catch(() => {});
          return { ...context, operation: store.operation(args.operationId) };
        }
        case 'cancel': return { ...context, operation: await workspace.cancel(args.operationId) };
        case 'editions': return { ...context, ...store.list('editions', page(args)) };
        case 'edition': return { ...context, edition: store.edition(args.editionId), review: store.latestReview(args.editionId) };
        case 'rows': return { ...context, ...await workspace.page(args.editionId, { offset: args.offset ?? 0, limit: args.limit ?? 50 }) };
        case 'compare': return { ...context, comparison: await workspace.compare(args.beforeId, args.afterId, { limit: args.sampleLimit ?? 50 }) };
        case 'review': {
          const { workspace: selected, editionId, ...input } = args;
          return { ...context, review: await workspace.review(editionId, input) };
        }
        case 'receive_begin': return { ...context, transfer: await native.transfers.begin(args.manifest) };
        case 'receive_status': return { ...context, transfer: await native.transfers.status(args.transferId) };
        case 'receive_chunk': return { ...context, transfer: await native.transfers.append(args.transferId, args.partition,
          { offset: args.offset, bytes: chunkBytes(args.data), chunkSha256: args.chunkSha256 }) };
        case 'receive_repair': return { ...context, transfer: await native.transfers.repair(args.transferId, args.partition) };
        case 'receive_commit': return { ...context, transfer: await native.transfers.commit(args.transferId) };
        case 'publications': {
          const result = store.list('publications', page(args));
          return { ...context, ...result, items: result.items.map(publicationView) };
        }
        case 'publication': return { ...context, publication: publicationView(store.getPublication(args.publicationId)) };
        case 'prepare': {
          const { workspace: selected, ...input } = args;
          return { ...context, publication: publicationView(await workspace.prepareMerchant(input)) };
        }
        case 'resume_publication': return { ...context, publication: publicationView(await workspace.resumeMerchant(args.publicationId)) };
        case 'release_console': return { ...context, ...await workspace.openReleaseConsole() };
        case 'export': {
          const { workspace: selected, ...selection } = args;
          return this.#files.retain(args.workspace, workspace, selection);
        }
        default: throw fail('TOOL_NOT_FOUND');
      }
    });
  }
  requestClose() { this.#closing = true; }
  close() {
    if (this.#closeTask) return this.#closeTask;
    this.#closing = true;
    this.#closeTask = (async () => {
      await Promise.allSettled([...this.#pending]);
      const failures = [];
      for (const [name, opening] of [...this.#handles]) {
        try { const handle = await opening; await this.#stop(name, handle.native.instanceId); }
        catch (error) { failures.push(error); }
      }
      try { await this.#files.close(); } catch (error) { failures.push(error); }
      if (failures.length) throw new AggregateError(failures, 'Original Snowflake resources could not all close.');
    })().catch(error => { this.#closeTask = null; throw error; });
    return this.#closeTask;
  }
}
