// MIT. Typed MCP attachment to the original Applications-owned SAM.gov writer.
import {lstat, realpath} from 'node:fs/promises';
import {resolve, dirname, join} from 'node:path';
import {SAM_MUTATION_TOOLS, samgovWorkspaceTools} from './mcp-catalog.mjs';
import {SamRetainedFiles} from './mcp-files.mjs';
import {SAM_CONNECTION_FILENAME, SAM_HASH, SAM_MAX_RESPONSE_BYTES, samNeed, samPlain, samExact,
  samAbsolute, samPrivateDirectory, samReadPrivateJson, samReadPrivateFile, samParseJson,
  samFailure, readSamConnection, samConnectionView, samRequest, inspectSamListener} from './connection.mjs';

export const SAM_MCP_CONNECTION_SCHEMA = 'stellar-forge.samgov-workspace-connection.v1';
const ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const COLLECTIONS = ['queries','captures','editions','selections','sources','reviews','changes','handoffs','publications','history'];
const toolSchemas = new Map(samgovWorkspaceTools((name,description,properties,required) =>
  ({name,properties,required})).map(value => [value.name,value]));
function alias(value) {
  samNeed(typeof value === 'string' && ALIAS.test(value), 'SAM_WORKSPACE_ALIAS_INVALID', 'Choose a declared SAM workspace or input alias.');
  return value;
}
function label(value, fallback) {
  const result = value ?? fallback;
  samNeed(typeof result === 'string' && result.trim() === result && result.length >= 1 && result.length <= 240 &&
    !/[\x00-\x1f\x7f]/.test(result), 'SAM_CONFIGURATION_INVALID', 'Use a readable SAM label of 1–240 characters.');
  return result;
}
function page(value, offset = 0, limit = 50) {
  samNeed(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 1000,
    'SAM_PAGE_INVALID', 'Choose a nonnegative offset and a page size from 1 to 1000.');
  const result = {...value,pages:{}};
  for (const key of COLLECTIONS) {
    if (!Array.isArray(value[key])) continue;
    result[key] = value[key].slice(offset,offset+limit);
    result.pages[key] = {offset,limit,total:value[key].length,
      nextOffset:offset+limit<value[key].length?offset+limit:null};
  }
  return result;
}
function responseView(value) {
  return value?.workspace?.schema === 'stellar-forge.samgov-workspace.v1' ? {...value,workspace:page(value.workspace)} : value;
}
async function declaredFile(value, base) {
  samExact(value,['label','kind','file','sha256'],['kind','file','sha256']);
  samNeed(['action','packet'].includes(value.kind) && SAM_HASH.test(value.sha256 ?? ''),
    'SAM_INPUT_INVALID', 'Declare an original action or complete packet file with its SHA-256.');
  samNeed(typeof value.file === 'string' && value.file.length > 0, 'SAM_INPUT_INVALID', 'Declare the original source file path.');
  const path = samAbsolute(resolve(base,value.file)), info = await lstat(path);
  samNeed(await realpath(path) === path && info.isFile() && !info.isSymbolicLink() &&
    info.size <= SAM_MAX_RESPONSE_BYTES &&
    (process.platform === 'win32' || !(info.mode & 0o077) && (!process.getuid || info.uid === process.getuid())),
  'SAM_INPUT_INVALID', 'Declare an owned private original source file within 512 MiB.');
  return {label:label(value.label,'Retained original source'),kind:value.kind,file:path,sha256:value.sha256,bytes:info.size};
}
/** Read host-selected aliases only. Loading configuration starts no listener or acquisition. */
export async function readSamWorkspaceConfiguration(path) {
  const source = await samReadPrivateJson(samAbsolute(path));
  const raw = source.value;
  samExact(raw,['schema','workspaces'],['schema','workspaces']);
  samNeed(raw.schema === SAM_MCP_CONNECTION_SCHEMA && samPlain(raw.workspaces) &&
    Object.keys(raw.workspaces).length >= 1 && Object.keys(raw.workspaces).length <= 32,
  'SAM_CONFIGURATION_INVALID', 'Declare 1–32 original SAM workspace aliases.');
  const base = dirname(source.path), workspaces = Object.create(null), directories = new Set();
  for (const [name,input] of Object.entries(raw.workspaces)) {
    alias(name);
    samExact(input,['label','directory','workspaceId','inputs','merchants'],['directory']);
    samNeed(typeof input.directory === 'string' && input.directory.length > 0,
      'SAM_CONFIGURATION_INVALID', 'Declare the original private workspace directory.');
    const directory = (await samPrivateDirectory(resolve(base,input.directory))).path;
    samNeed(!directories.has(directory),'SAM_CONFIGURATION_DUPLICATE','Give the original SAM workspace one alias.');
    directories.add(directory);
    samNeed(input.workspaceId === undefined || /^sam_[a-f0-9-]{36}$/.test(input.workspaceId),
      'SAM_WORKSPACE_ID_INVALID','Choose the original workspace ID when binding it explicitly.');
    const inputs = Object.create(null), merchants = Object.create(null);
    samNeed(input.inputs === undefined || samPlain(input.inputs) && Object.keys(input.inputs).length <= 256,
      'SAM_INPUT_INVALID','Use up to 256 named original source inputs.');
    for (const [key,value] of Object.entries(input.inputs || {})) inputs[alias(key)] = await declaredFile(value,base);
    samNeed(input.merchants === undefined || samPlain(input.merchants) && Object.keys(input.merchants).length <= 32,
      'SAM_MERCHANT_INVALID','Use up to 32 reviewed merchant profiles.');
    for (const [key,value] of Object.entries(input.merchants || {})) {
      alias(key);
      samExact(value,['label','origin','path','payment','defaultLimit','maxLimit'],['origin','path','payment']);
      samNeed(typeof value.origin === 'string' && typeof value.path === 'string' && samPlain(value.payment),
        'SAM_MERCHANT_INVALID','A merchant profile supplies its original origin, path and payment terms.');
      merchants[key] = {...value,label:label(value.label,key)};
    }
    workspaces[name] = {label:label(input.label,name),directory,
      connectionFile:join(directory,SAM_CONNECTION_FILENAME),
      workspaceId:input.workspaceId || null,inputs,merchants};
  }
  return {workspaces,configuration:source.path,sha256:source.sha256};
}
export class MerchantSamWorkspaces {
  #config; #connections = new Map(); #pending = new Set(); #closing = false; #closePromise; #files;
  constructor(config) {
    this.#config = config;
    this.#files = new SamRetainedFiles(config.exportsDirectory);
  }
  get summary() {
    return {configured:Boolean(this.#config.samgovWorkspaces),connected:[...this.#connections.keys()],
      pending:this.#pending.size,closing:this.#closing,...this.#files.summary};
  }
  #scope(name) {
    alias(name);
    const entry = this.#config.samgovWorkspaces?.workspaces?.[name];
    samNeed(entry,'SAM_WORKSPACE_NOT_CONFIGURED','Choose a host alias from merchant_samgov_status.',404);
    return {...entry,alias:name};
  }
  async #connect(scope,expectedInstanceId) {
    const connection = await readSamConnection(scope.connectionFile,{directory:scope.directory});
    samNeed(!expectedInstanceId || connection.value.instanceId === expectedInstanceId,
      'SAM_INSTANCE_CHANGED','The original application instance differs from the selected one.',409);
    const live = await inspectSamListener(connection);
    samNeed(!scope.workspaceId || live.workspace.id === scope.workspaceId,
      'SAM_WORKSPACE_CHANGED','The live original workspace ID differs from this host configuration.',409);
    const old = this.#connections.get(scope.alias);
    if (old && old.sha256 !== connection.sha256) await this.#files.disconnect(scope);
    this.#connections.set(scope.alias,connection);
    return {workspace:scope.alias,state:'CONNECTED',...samConnectionView(connection),
      native:page(live.workspace),tasks:live.tasks,merchantHosts:live.merchantHosts};
  }
  async #connection(scope) {
    const connection = this.#connections.get(scope.alias);
    samNeed(connection,'SAM_WORKSPACE_DISCONNECTED','Connect this original Application before its source operation.',409);
    let current;
    try { current = await readSamConnection(scope.connectionFile,{directory:scope.directory}); }
    catch (error) {
      if (error.code === 'ENOENT') throw samFailure('SAM_APPLICATION_STOPPED',
        'The original SAM application has stopped. Reopen its saved Applications operation and connect again.',409);
      throw error;
    }
    samNeed(current.sha256 === connection.sha256 && current.value.instanceId === connection.value.instanceId,
      'SAM_CONNECTION_CHANGED','The original SAM application restarted. Inspect and reconnect to its current instance before continuing.',409);
    return connection;
  }
  async #input(scope,name,expectedSha256,kind) {
    const input = scope.inputs[alias(name)];
    samNeed(input && input.kind === kind && input.sha256 === expectedSha256,
      'SAM_INPUT_SELECTION_CHANGED','Choose the declared original input and its reviewed SHA-256.',409);
    const source = await samReadPrivateFile(input.file,SAM_MAX_RESPONSE_BYTES);
    samNeed(source.sha256 === input.sha256 && source.bytes.length === input.bytes,
      'SAM_INPUT_CHANGED','The declared original file changed. Review its following source edition.',409);
    return samParseJson(source.bytes);
  }
  async #status(args) {
    if (args.workspace === undefined) return {...this.summary,
      workspaces:Object.entries(this.#config.samgovWorkspaces?.workspaces || {}).map(([workspace,entry]) => ({
        workspace,label:entry.label,workspaceId:entry.workspaceId,
        state:this.#connections.has(workspace)?'CONNECTED':'DISCONNECTED',
        inputs:Object.entries(entry.inputs).map(([sourceImport,input]) => ({
          sourceImport,label:input.label,kind:input.kind,sha256:input.sha256,bytes:input.bytes})),
        merchants:Object.entries(entry.merchants).map(([profile,value]) => ({profile,...value})),
      }))};
    const scope = this.#scope(args.workspace);
    if (!this.#connections.has(scope.alias)) return {workspace:scope.alias,label:scope.label,state:'DISCONNECTED'};
    const connection = await this.#connection(scope), live = await inspectSamListener(connection);
    return {workspace:scope.alias,state:'CONNECTED',...samConnectionView(connection),
      native:page(live.workspace,args.offset ?? 0,args.limit ?? 50),
      tasks:live.tasks,merchantHosts:live.merchantHosts};
  }
  async #dispatch(name,args) {
    const schema = toolSchemas.get(name);
    samNeed(schema,'SAM_TOOL_UNKNOWN','Choose a declared SAM workspace tool.');
    samExact(args,Object.keys(schema.properties),schema.required);
    if (name === 'merchant_samgov_status') return this.#status(args);
    const scope = this.#scope(args.workspace);
    if (name === 'merchant_samgov_connect') return this.#connect(scope,args.expectedInstanceId);
    if (name === 'merchant_samgov_disconnect') {
      const connected = this.#connections.get(scope.alias);
      samNeed(!connected || connected.value.instanceId === args.instanceId,
        'SAM_INSTANCE_CHANGED','Use the current connected instance ID.',409);
      await this.#files.disconnect(scope); this.#connections.delete(scope.alias);
      return {workspace:scope.alias,instanceId:args.instanceId,state:'DISCONNECTED'};
    }
    if (name === 'merchant_samgov_exports') return this.#files.list(scope,args.offset,args.limit);
    if (name === 'merchant_samgov_file_release') {
      await this.#files.release(scope,args.readId); return {workspace:scope.alias,readId:args.readId,released:true};
    }
    if (name === 'merchant_samgov_file' && args.kind === 'export') return this.#files.file(scope,null,args);
    if (name === 'merchant_samgov_export') {
      const original = await this.#files.findExport(scope,args); if (original) return original;
    }
    const connection = await this.#connection(scope);
    const read = (action,payload) => samRequest(connection,'/api/read',{method:'POST',body:{action,payload},maximum:64*1024*1024});
    const mutate = (action,payload) => samRequest(connection,'/api/dispatch',{method:'POST',body:{action,payload},maximum:64*1024*1024});
    if (Object.hasOwn(SAM_MUTATION_TOOLS,name)) {
      const {workspace,...payload} = args;
      return responseView(await mutate(SAM_MUTATION_TOOLS[name].action,payload));
    }
    switch(name) {
      case 'merchant_samgov_browser': {
        await inspectSamListener(connection);
        return {workspace:scope.alias,instanceId:connection.value.instanceId,url:connection.value.url};
      }
      case 'merchant_samgov_record': {
        const search = new URLSearchParams();
        for (const key of ['offset','limit','search']) if (args[key] !== undefined) search.set(key,String(args[key]));
        return samRequest(connection,'/api/records/' + encodeURIComponent(args.id) + '?' + search.toString(),{maximum:64*1024*1024});
      }
      case 'merchant_samgov_notice': return read('notice',{editionId:args.editionId,noticeId:args.noticeId});
      case 'merchant_samgov_compare': return read('compare',{beforeEditionId:args.beforeEditionId,afterEditionId:args.afterEditionId});
      case 'merchant_samgov_capture_run': return samRequest(connection,'/api/captures/' + encodeURIComponent(args.captureId) + '/run',{method:'POST',body:{}});
      case 'merchant_samgov_capture_status': return samRequest(connection,'/api/captures/' + encodeURIComponent(args.captureId) + '/run',{maximum:64*1024*1024});
      case 'merchant_samgov_capture_pause': return samRequest(connection,'/api/captures/' + encodeURIComponent(args.captureId) + '/cancel',{method:'POST',body:{}});
      case 'merchant_samgov_import': {
        const input = await this.#input(scope,args.sourceImport,args.expectedSourceSha256,'action');
        samExact(input,['action','payload'],['action','payload']);
        samNeed(['import_notice','import_capture','retain_resource'].includes(input.action) && samPlain(input.payload) &&
          !Object.hasOwn(input.payload,'requestId') && !Object.hasOwn(input.payload,'expectedRevision'),
        'SAM_SOURCE_ACTION_INVALID','Use a declared original source action; the reviewed mutation supplies its revision and request ID.');
        return responseView(await mutate(input.action,{...input.payload,expectedRevision:args.expectedRevision,requestId:args.requestId}));
      }
      case 'merchant_samgov_receive': {
        const packet = await this.#input(scope,args.sourceImport,args.expectedSourceSha256,'packet');
        return responseView(await samRequest(connection,'/api/receive',{method:'POST',body:{packet},maximum:64*1024*1024}));
      }
      case 'merchant_samgov_prepare_merchant': {
        const profile = scope.merchants[alias(args.profile)];
        samNeed(profile,'SAM_MERCHANT_NOT_CONFIGURED','Choose a declared reviewed merchant profile.');
        const {label,...terms} = profile;
        return responseView(await mutate('prepare_merchant',{...terms,selectionId:args.selectionId,
          expectedRevision:args.expectedRevision,requestId:args.requestId}));
      }
      case 'merchant_samgov_merchant_start': return samRequest(connection,'/api/publications/' +
        encodeURIComponent(args.publicationId) + '/serve',{method:'POST',body:{port:args.port ?? 0}});
      case 'merchant_samgov_merchant_stop': return samRequest(connection,'/api/publications/' +
        encodeURIComponent(args.publicationId) + '/close',{method:'POST',body:{}});
      case 'merchant_samgov_export': return this.#files.export(scope,connection,args);
      case 'merchant_samgov_file': return this.#files.file(scope,connection,args);
      default: throw samFailure('SAM_TOOL_UNKNOWN','Choose a declared SAM workspace tool.');
    }
  }
  async call(name,args = {}) {
    samNeed(!this.#closing,'SAM_MCP_CLOSING','The SAM MCP attachment is closing.',409);
    const operation = this.#dispatch(name,args);
    this.#pending.add(operation);
    try { return await operation; } finally { this.#pending.delete(operation); }
  }
  close() {
    if (this.#closePromise) return this.#closePromise;
    this.#closing = true;
    this.#closePromise = (async () => {
      await Promise.allSettled([...this.#pending]);
      await this.#files.close(); this.#connections.clear();
    })().catch(error => {this.#closePromise = null;throw error;});
    return this.#closePromise;
  }
}
export {samgovWorkspaceTools} from './mcp-catalog.mjs';
