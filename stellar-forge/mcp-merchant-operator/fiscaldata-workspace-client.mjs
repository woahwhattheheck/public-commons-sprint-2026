// MIT. Typed operator client over the original Merchant MCP transport and Fiscal tools.
import { openMerchantFileClient } from './retained-download.mjs';
import { fiscalDataWorkspaceTools, alias } from './catalog/fiscaldata-workspace.mjs';

export const FISCALDATA_CLIENT_SCHEMA = 'stellar-forge.fiscaldata-client.v1';
export const FISCALDATA_MODEL_SCHEMA = 'stellar-forge.fiscaldata-workspace.v1';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ALIAS = new RegExp(alias.pattern);
const sections = new Set(['sources','captures','editions','comparisons','exports','refreshPlans','refreshRuns']);
const toolNames = new Set(fiscalDataWorkspaceTools(name => ({name})).map(value => value.name));
const problem = (code, message) => Object.assign(new Error(message), {code:'FISCALDATA_CLIENT_' + code});
const clone = value => structuredClone(value);
function object(value, label) {
  if (!plain(value)) throw problem('INPUT', label + ' must be a JSON object.');
  return value;
}
function bounded(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw problem('INPUT', label + ' is outside its explicit integer bounds.');
  return value;
}
function actionRoute(action, payload, options) {
  const matched = /^(sources|captures|editions|comparisons)\.(save|probe|start|get|rows|pause|resume|cancel|create|review|build)$/.exec(action);
  if (matched) {
    const owner = {sources:'source',captures:'capture',editions:'edition',comparisons:'comparison'}[matched[1]];
    return ['merchant_fiscaldata_' + owner, {action:matched[2],payload,
      ...(owner === 'capture' ? {offset:options.offset ?? 0,limit:options.limit ?? 50} : {})}];
  }
  if (action === 'catalog.refresh') {
    if (Object.keys(payload).length) throw problem('INPUT','The original catalog refresh takes an empty model payload.');
    return ['merchant_fiscaldata_catalog',{action:'refresh',offset:options.offset ?? 0,limit:options.limit ?? 50}];
  }
  if (action === 'editions.query') return ['merchant_fiscaldata_query',payload];
  if (action === 'exports.create') return ['merchant_fiscaldata_export',{payload}];
  if (action === 'briefings.create') return ['merchant_fiscaldata_briefing',{payload}];
  if (action === 'merchant.configure') return ['merchant_fiscaldata_merchant',payload];
  if (action.startsWith('publisher.')) return ['merchant_fiscaldata_publisher',{action,payload}];
  if (action === 'refresh.baseline.promote') return ['merchant_fiscaldata_refresh_plan',{action:'promote',payload}];
  const refresh = /^refresh\.(plans|runs)\.(list|get|save|preview|start|pause|resume|cancel|review)$/.exec(action);
  if (refresh) return ['merchant_fiscaldata_refresh_' + (refresh[1] === 'plans' ? 'plan' : 'run'),{action:refresh[2],payload}];
  throw problem('ACTION', 'Choose an original Fiscal model action or an explicit workspace lifecycle method.');
}

/**
 * A connection owns its local requests/read leases, not the remote workspace.
 * dispose() never closes a borrowed remote model or browser. closeWorkspace()
 * requires the explicit original instance ID returned by status/open.
 */
export class FiscalWorkspaceClient {
  #transport; #workspace; #expectedId; #identity = null; #controller = new AbortController();
  #pending = new Set(); #reads = new Set(); #disposed = false; #disposing; #signal; #timeout;
  constructor(transport, {workspace,expectedWorkspaceId,signal,timeoutMs = 120000} = {}) {
    if (!plain(transport) || typeof transport.endpoint !== 'string' || !transport.endpoint ||
        typeof transport.call !== 'function') throw problem('TRANSPORT','Use the original connected Merchant MCP client.');
    if (!ALIAS.test(workspace ?? '')) throw problem('WORKSPACE','Select one host-declared workspace alias.');
    if (expectedWorkspaceId !== undefined && !UUID.test(expectedWorkspaceId))
      throw problem('WORKSPACE','Use the original workspace UUID.');
    this.#timeout = bounded(timeoutMs,1,2147483647,'Request timeout in milliseconds');
    this.#transport = transport; this.#workspace = workspace; this.#expectedId = expectedWorkspaceId;
    this.#signal = signal;
  }
  get endpoint() { return this.#transport.endpoint; }
  get workspace() { return this.#workspace; }
  get expectedWorkspaceId() { return this.#expectedId ?? null; }
  get identity() { return this.#identity ? clone(this.#identity) : null; }
  #observed(value) {
    if (!plain(value) || value.workspace !== this.#workspace) throw problem('WORKSPACE','The original host returned a different workspace alias.');
    if (value.workspaceId !== undefined) {
      if (!UUID.test(value.workspaceId)) throw problem('REPLY','The host returned an invalid workspace identity.');
      if (this.#expectedId && value.workspaceId !== this.#expectedId)
        throw problem('WORKSPACE_CHANGED','This alias now names another workspace. Keep the original selection and inspect the host.');
      this.#expectedId ??= value.workspaceId;
      this.#identity = {workspace:this.#workspace,workspaceId:value.workspaceId,
        instanceId:value.instanceId ?? null,operator:value.operator ?? this.#identity?.operator ?? null};
    }
    return value;
  }
  #request(name, args, options = {}, internal = false) {
    if (!internal && this.#disposed) return Promise.reject(problem('CLOSED','This local client has been disposed.'));
    if (!toolNames.has(name)) return Promise.reject(problem('TOOL_UNAVAILABLE','This installed Fiscal catalog does not declare ' + name + '.'));
    object(args,'Tool arguments');
    const selected = clone(args);
    const requestSignal = own(options,'requestSignal') ? options.requestSignal : options.signal ?? this.#signal;
    const signals = internal ? (requestSignal ? [requestSignal] : []) :
      [this.#controller.signal,...(requestSignal ? [requestSignal] : [])];
    const signal = signals.length ? AbortSignal.any(signals) : null;
    const timeoutMs = bounded(options.timeoutMs ?? this.#timeout,1,2147483647,'Request timeout in milliseconds');
    const task = Promise.resolve().then(() => this.#transport.call(name,selected,{requestSignal:signal,timeoutMs}));
    this.#pending.add(task);
    task.then(() => this.#pending.delete(task),() => this.#pending.delete(task));
    return task;
  }
  #scoped(name, args = {}, options, internal = false) {
    object(args,'Tool arguments');
    if (own(args,'workspace') && args.workspace !== this.#workspace)
      throw problem('WORKSPACE','Use this client’s selected workspace alias.');
    return this.#request(name,{...args,workspace:this.#workspace},options,internal);
  }
  async status({section = 'overview',offset = 0,limit = 50} = {}, options) {
    const result = await this.#scoped('merchant_fiscaldata_status',{section,offset,limit},options);
    return this.#observed(result);
  }
  hostStatus(options) { return this.#request('merchant_fiscaldata_status',{},options); }
  async open(options) { return this.#observed(await this.#scoped('merchant_fiscaldata_open',{},options)); }
  async assertOpen(options) {
    const status = await this.status({},options);
    if (status.state !== 'OPEN' || !status.workspaceId || !plain(status.native))
      throw problem('WORKSPACE_NOT_OPEN','Open the original workspace explicitly and wait for its current lifecycle to finish.');
    return status;
  }
  async closeWorkspace(instanceId, options) {
    if (!UUID.test(instanceId ?? '')) throw problem('INSTANCE','Supply the original instance ID from status/open.');
    const result = await this.#scoped('merchant_fiscaldata_close',{instanceId},options);
    this.#reads.clear();
    return result;
  }
  async catalog(action = 'get', {offset = 0,limit = 50} = {}, options) {
    await this.assertOpen(options);
    const result = await this.#scoped('merchant_fiscaldata_catalog',{action,offset,limit},options);
    return action === 'refresh' ? this.#envelope(result) : result;
  }
  #envelope(value) {
    if (!plain(value) || !own(value,'result') || !plain(value.state) || value.state.schema !== FISCALDATA_MODEL_SCHEMA)
      throw problem('REPLY','The original Fiscal action did not return its result and workspace state.');
    return value;
  }
  async action(action, payload = {}, options = {}) {
    if (typeof action !== 'string') throw problem('ACTION','Choose an original Fiscal action.');
    object(payload,'Action payload');
    await this.assertOpen(options);
    const [name,args] = actionRoute(action,clone(payload),options);
    return this.#envelope(await this.#scoped(name,args,options));
  }
  async value(action, payload = {}, options) { return (await this.action(action,payload,options)).result; }
  query(id, query = 'limit=50', options) { return this.action('editions.query',{id,query},options); }
  async checkpoint(operationId, options) {
    await this.assertOpen(options);
    const result = await this.#scoped('merchant_fiscaldata_checkpoint',{operationId},options);
    if (!plain(result.workspace) || result.workspace.id !== this.#expectedId)
      throw problem('WORKSPACE_CHANGED','The portable package names a different original workspace.');
    return result;
  }
  async restore(input, options) {
    object(input,'Original package receiving input');
    const status = await this.status({},options);
    if (status.state !== 'CLOSED') throw problem('WORKSPACE_OPEN','Close the exact destination instance before receiving its source package.');
    const result = await this.#scoped('merchant_fiscaldata_restore',input,options);
    const id = result.receiving?.workspace?.id ?? result.receiving?.workspaceId;
    if (id && this.#expectedId && id !== this.#expectedId)
      throw problem('WORKSPACE_CHANGED','The received source belongs to a different expected workspace.');
    return result;
  }
  async browser(action, {port} = {}, options) {
    await this.assertOpen(options);
    return this.#scoped('merchant_fiscaldata_browser',{action,...(port === undefined ? {} : {port})},options);
  }
  async history({offset = 0,limit = 50} = {}, options) {
    await this.assertOpen(options);
    return this.#scoped('merchant_fiscaldata_history',{offset,limit},options);
  }
  file(input, options) {
    object(input,'Original file selection');
    const task = (async () => {
      const result = await this.#scoped('merchant_fiscaldata_file',input,options);
      if (typeof result.readId === 'string') {
        if (result.nextOffset === null) this.#reads.delete(result.readId);
        else this.#reads.add(result.readId);
      }
      return result;
    })();
    // Include read-lease registration in the local drain, after the HTTP reply.
    this.#pending.add(task);
    task.then(() => this.#pending.delete(task),() => this.#pending.delete(task));
    return task;
  }
  async releaseFile(readId, options) {
    const result = await this.#scoped('merchant_fiscaldata_file_release',{readId},options);
    this.#reads.delete(readId); return result;
  }
  /** A stable revision census. A concurrent model save fails explicitly; no rows are silently skipped. */
  async list(section, {limit = 100,maximumItems = 100000} = {}, options) {
    if (!sections.has(section)) throw problem('SECTION','Choose an original record collection.');
    bounded(limit,1,100,'Page size'); bounded(maximumItems,1,1000000,'Record limit');
    const items = []; let offset = 0,revision,operator,total;
    do {
      const state = await this.status({section:'overview',offset,limit},options);
      if (state.state !== 'OPEN' || !plain(state.native)) throw problem('WORKSPACE_NOT_OPEN','Open the original workspace before listing its records.');
      const page = state.native[section];
      if (!plain(page) || !Array.isArray(page.items) || page.offset !== offset || !Number.isSafeInteger(page.total))
        throw problem('REPLY','This installed source does not expose the selected collection.');
      if (revision !== undefined && (revision !== state.native.revision || total !== page.total))
        throw problem('REVISION_CHANGED','The workspace changed during pagination. Repeat this read against its current revision.');
      revision ??= state.native.revision; total ??= page.total; operator ??= state.operator;
      if (page.total > maximumItems) throw problem('LIMIT','The complete collection exceeds the explicitly selected record limit.');
      items.push(...page.items);
      if (page.nextOffset !== null && (!Number.isSafeInteger(page.nextOffset) || page.nextOffset !== offset + page.items.length || page.nextOffset <= offset))
        throw problem('REPLY','The original collection returned a non-advancing offset.');
      offset = page.nextOffset;
    } while (offset !== null);
    if (items.length !== total) throw problem('REPLY','The original collection is incomplete.');
    return {workspace:this.#workspace,workspaceId:this.#expectedId,revision,operator,items,total};
  }
  async find(section, id, options) {
    const collection = await this.list(section,{},options);
    const item = collection.items.find(item => item.id === id);
    if (!item) throw problem('NOT_FOUND','The original workspace has no selected ' + section + ' record.');
    return {item,workspaceId:collection.workspaceId,operator:collection.operator,revision:collection.revision};
  }
  async package(packageId, options) {
    const items = []; let offset = 0,total;
    do {
      const result = await this.status({section:'packages',offset,limit:100},options), page = result.packages;
      if (!plain(page) || !Array.isArray(page.items) || page.offset !== offset || !Number.isSafeInteger(page.total))
        throw problem('REPLY','The host returned an invalid original package list.');
      if (total !== undefined && total !== page.total) throw problem('REVISION_CHANGED','The retained package list changed; repeat this selection.');
      total ??= page.total;
      if (total > 100000) throw problem('LIMIT','Select from a bounded original package catalogue.');
      items.push(...page.items);
      if (page.nextOffset !== null && (!Number.isSafeInteger(page.nextOffset) || page.nextOffset !== offset + page.items.length || page.nextOffset <= offset))
        throw problem('REPLY','The package list returned a non-advancing offset.');
      offset = page.nextOffset;
    } while (offset !== null);
    if (items.length !== total) throw problem('REPLY','The original package catalogue is incomplete.');
    const item = items.find(item => item.packageId === packageId);
    if (!item || !UUID.test(item.workspace?.id ?? '')) throw problem('NOT_FOUND','Choose a sealed original workspace package.');
    if (this.#expectedId && item.workspace.id !== this.#expectedId)
      throw problem('WORKSPACE_CHANGED','The retained package belongs to a different original workspace.');
    this.#expectedId ??= item.workspace.id;
    const host = await this.hostStatus(options);
    return {item,workspaceId:item.workspace.id,operator:host.operator};
  }
  dispose() {
    if (this.#disposing) return this.#disposing;
    this.#disposed = true; this.#controller.abort(problem('CLOSED','The local Fiscal client is closing.'));
    this.#disposing = (async () => {
      await Promise.allSettled([...this.#pending]);
      const outcomes = await Promise.allSettled([...this.#reads].map(async readId => {
        await this.#scoped('merchant_fiscaldata_file_release',{readId},{requestSignal:null,timeoutMs:5000},true);
        this.#reads.delete(readId);
      }));
      const failed = outcomes.filter(result => result.status === 'rejected');
      if (failed.length) {
        this.#disposing = null;
        throw problem('CLOSE_INCOMPLETE','Some original file reads could not be released; retry dispose on this same local client.');
      }
    })();
    return this.#disposing;
  }
}

/** Initializes the maintained MCP transport only. Opening a source workspace is explicit. */
export async function connectFiscalWorkspace({transport,url,tokenEnv,environment,workspace,expectedWorkspaceId,signal,timeoutMs} = {}) {
  if (transport !== undefined && url !== undefined) throw problem('TRANSPORT','Choose one original transport or MCP URL.');
  const connected = transport ?? await openMerchantFileClient({url,tokenEnv,environment,signal,
    errorPrefix:'FISCALDATA',clientName:'starforge-fiscaldata-workspace-client'});
  return new FiscalWorkspaceClient(connected,{workspace,expectedWorkspaceId,signal,timeoutMs});
}
