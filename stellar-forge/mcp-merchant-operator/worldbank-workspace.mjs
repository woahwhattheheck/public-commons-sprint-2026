import { worldbankWorkspaceTools, alias, integer, hash, uuid, read, id, object, text, publisherActions, fileKinds } from './catalog/worldbank-workspace.mjs';
export { worldbankWorkspaceTools } from './catalog/worldbank-workspace.mjs';
// MIT. World Bank source, release and customer operations in the original MCP host.
import { constants } from 'node:fs';
import { open, realpath, lstat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { exact, failure, identifier, line, plain, privateSupportDirectory } from './config.mjs';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { WORLDBANK_DOWNLOAD_MANIFEST, WORLDBANK_MAX_FILE_BYTES, worldbankId,
  worldbankDownloadManifest } from './worldbank-download-manifest.mjs';

export const WORLDBANK_WORKSPACE_CONNECTION_SCHEMA = 'stellar-forge.worldbank-workspace-connection.v1';








const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const parse = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));


const count = (value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw failure('INVALID_PARAMS', label + ' must be an integer from ' + minimum + ' to ' + maximum + '.');
  return value;
};
function hostPath(value, base) {
  if (typeof value !== 'string' || !value || /[\x00-\x1f\x7f]/.test(value))
    throw failure('CONFIGURATION_ERROR', 'Declare original paths in the private World Bank connection file.');
  return resolve(base, value);
}
async function originalBytes(path, maximum, privateFile = false) {
  if (await realpath(path) !== resolve(path))
    throw failure('WORLDBANK_SOURCE_PATH', 'Use the original canonical regular file.');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(maximum) || privateFile && process.platform !== 'win32' &&
        ((before.mode & 0o077n) !== 0n || process.getuid && before.uid !== BigInt(process.getuid())))
      throw failure('WORLDBANK_SOURCE_FILE', 'Use an owned private connection file, or a regular declared source within its size limit.');
    const bytes = await file.readFile(), after = await file.stat({ bigint: true });
    if (bytes.length > maximum || before.size !== after.size || before.ino !== after.ino ||
        before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs)
      throw failure('WORLDBANK_SOURCE_CHANGED', 'The original file changed during this read.');
    return bytes;
  } finally { await file.close(); }
}
function entries(value, label) {
  if (value === undefined) return [];
  if (!plain(value) || Object.keys(value).length > 32)
    throw failure('CONFIGURATION_ERROR', 'Declare up to 32 named ' + label + '.');
  return Object.entries(value).map(([name,item]) => [identifier(name, label + ' alias'), item]);
}
function runtime(raw = {}) {
  exact(raw, ['port','facilitator','allowLocalFacilitator']);
  count(raw.port ?? 0, 'Seller port', 0, 65535);
  if (raw.allowLocalFacilitator !== undefined && typeof raw.allowLocalFacilitator !== 'boolean')
    throw failure('CONFIGURATION_ERROR', 'allowLocalFacilitator must be a Boolean.');
  if (raw.facilitator !== undefined) {
    const url = new URL(raw.facilitator);
    if (url.username || url.password || url.search || url.hash || url.protocol !== 'https:' &&
        !(raw.allowLocalFacilitator === true && url.protocol === 'http:' && url.hostname === '127.0.0.1'))
      throw failure('CONFIGURATION_ERROR', 'Declare the original HTTPS or explicit loopback facilitator.');
  }
  return { ...raw, port: raw.port ?? 0 };
}
/** Resolve host authorizations without starting a workspace or contacting World Bank. */
export async function readWorldBankWorkspaceConfiguration(path) {
  path = resolve(path);
  const raw = parse(await originalBytes(path, 1024 * 1024, true));
  exact(raw, ['schema','workspaces'], ['schema','workspaces']);
  if (raw.schema !== WORLDBANK_WORKSPACE_CONNECTION_SCHEMA || !plain(raw.workspaces) ||
      !Object.keys(raw.workspaces).length || Object.keys(raw.workspaces).length > 32)
    throw failure('CONFIGURATION_ERROR', 'Declare 1–32 original World Bank workspaces.');
  const base = dirname(path), workspaces = Object.create(null), seen = new Set();
  for (const [name,input] of Object.entries(raw.workspaces)) {
    identifier(name, 'World Bank workspace alias');
    exact(input, ['label','directory','python','imports','merchants','buyerWorkspaces','runtime'], ['directory']);
    const directory = await realpath(hostPath(input.directory, base));
    await privateSupportDirectory(directory);
    if (seen.has(directory)) throw failure('CONFIGURATION_ERROR', 'Give each original World Bank directory one alias.');
    seen.add(directory);
    let python;
    if (input.python !== undefined) {
      python = await realpath(hostPath(input.python, base));
      if (!(await lstat(python)).isFile()) throw failure('CONFIGURATION_ERROR', 'Declare the existing Python 3 executable.');
    }
    const imports = Object.create(null), merchants = Object.create(null), buyers = Object.create(null);
    for (const [key,item] of entries(input.imports, 'source imports')) {
      exact(item, ['label','kind','file','sha256'], ['kind','file']);
      if (!['pages','package'].includes(item.kind) || item.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(item.sha256))
        throw failure('CONFIGURATION_ERROR', 'An import is original page receipts or a handover ZIP, with an optional pinned SHA256.');
      const file = await realpath(hostPath(item.file, base));
      if (!(await lstat(file)).isFile()) throw failure('CONFIGURATION_ERROR', 'Declare a regular original source file.');
      imports[key] = { label: line(item.label ?? key), kind: item.kind, file, sha256: item.sha256 };
    }
    for (const [key,item] of entries(input.merchants, 'merchant profiles')) {
      exact(item, ['label','origin','path','payment'], ['origin','path','payment']);
      if (typeof item.origin !== 'string' || typeof item.path !== 'string' || !plain(item.payment))
        throw failure('CONFIGURATION_ERROR', 'Declare the original public origin, route and exact payment terms.');
      merchants[key] = { label: line(item.label ?? key), origin: item.origin, path: item.path, payment: item.payment };
    }
    for (const [key,item] of entries(input.buyerWorkspaces, 'buyer workspaces')) {
      exact(item, ['label','directory'], ['directory']);
      const selected = await realpath(hostPath(item.directory, base));
      await privateSupportDirectory(selected);
      buyers[key] = { label: line(item.label ?? key), directory: selected };
    }
    workspaces[name] = { label: line(input.label ?? name), directory, python,
      imports, merchants, buyerWorkspaces: buyers, runtime: runtime(input.runtime) };
  }
  return { workspaces };
}

const definitions = new Map(worldbankWorkspaceTools((name,description,properties,required=[]) =>
  ({name,properties,required})).map(value => [value.name,value]));
function pageRows(values, offset, limit) {
  const items = values.slice(offset, offset + limit);
  return { items, page:{offset,limit,total:values.length,nextOffset:offset + items.length < values.length ? offset + items.length : null} };
}
function paged(value, keys, offset=0, limit=20) {
  const result = {...value}, pages = {...value?.pages};
  for (const key of keys) if (Array.isArray(result[key])) {
    const selected = pageRows(result[key],offset,limit); result[key]=selected.items; pages[key]=selected.page;
  }
  if (Object.keys(pages).length) result.pages=pages;
  return result;
}
function reviewView(value, offset, limit) {
  const result = paged(value,['excludedKeys','history'],offset,limit);
  if (plain(value.choices)) {
    const selected = pageRows(Object.entries(value.choices),offset,limit);
    result.choices=Object.fromEntries(selected.items); result.pages={...result.pages,choices:selected.page};
  }
  return result;
}
function stateView(value, offset=0, limit=20) {
  if (!value) return value;
  const result=paged(value,['selections','captures','reviews','exports','catalogs','jobs'],offset,limit);
  result.reviews=(result.reviews??[]).map(({note,choices,excludedKeys,...review}) =>
    ({...review,noteAvailable:Boolean(note),choiceCount:Object.keys(choices??{}).length,excludedCount:excludedKeys?.length??0}));
  result.jobs=(result.jobs??[]).map(({result:completion,...job}) => ({...job,
    ...(completion ? {result:{id:completion.id,status:completion.status,captureSha256:completion.captureSha256}} : {})}));
  if (result.publisher) {
    const publisher={...result.publisher};
    if(Array.isArray(publisher.sessions)){
      const selected=pageRows(publisher.sessions,offset,limit);publisher.sessions=selected.items;
      publisher.pages={...publisher.pages,sessions:selected.page};
    }
    if (publisher.drafts) publisher.drafts=paged(publisher.drafts,['candidates','buyers'],offset,limit);
    if (publisher.target?.versions) publisher.target={...publisher.target,versions:paged(publisher.target.versions,['versions'],offset,limit)};
    if (publisher.releases) publisher.releases=paged(publisher.releases,['releases'],offset,limit);
    result.publisher=publisher;
  }
  return result;
}
export class MerchantWorldBankWorkspaces {
  #config; #handles=new Map(); #pending=new Set(); #closing=false; #close;
  #reads=new RetainedFileReads({errorPrefix:'WORLDBANK'});
  constructor(config) { this.#config=config; }
  get summary() { return {configured:Boolean(this.#config.worldbankWorkspaces),opened:[...this.#handles.keys()],
    pending:this.#pending.size,closing:this.#closing,...this.#reads.summary}; }
  #declared(name) {
    identifier(name,'World Bank workspace alias');
    const entry=this.#config.worldbankWorkspaces?.workspaces?.[name];
    if (!entry) throw failure('WORLDBANK_WORKSPACE_NOT_CONFIGURED','Choose an alias from merchant_worldbank_status.');
    return entry;
  }
  #visible(entry,value) {
    const paths=[entry.directory,this.#config.exportsDirectory,...Object.values(entry.buyerWorkspaces).map(item=>item.directory)];
    const walk=input => typeof input==='string' ? paths.reduce((text,path)=>text===path || text.startsWith(path+'/') ? '[workspace]'+text.slice(path.length) : text,input)
      : Array.isArray(input) ? input.map(walk)
      : plain(input) ? Object.fromEntries(Object.entries(input).map(([key,item])=>[key,walk(item)])) : input;
    return walk(value);
  }
  async #open(name) {
    const configuration=this.#declared(name);
    if (!this.#handles.has(name)) {
      const opening=(async()=>{
        const {openWorldBankOperator}=await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/worldbank/native.mjs');
        const operator=await openWorldBankOperator({directory:configuration.directory,python:configuration.python});
        try { await operator.state(); }
        catch(error) { await operator.close(); throw error; }
        return {configuration,operator,instanceId:randomUUID(),browser:null,tail:Promise.resolve(),closing:false,close:null,
          manifests:new Map(),downloadScopes:new Set()};
      })();
      this.#handles.set(name,opening);
      try { await opening; }
      catch(error) { if(this.#handles.get(name)===opening)this.#handles.delete(name); throw error; }
    }
    return this.#status(name);
  }
  async #status(name,offset=0,limit=20) {
    count(offset,'History offset');count(limit,'History page size',1,100);
    if(name===undefined)return {...this.summary,workspaces:Object.entries(this.#config.worldbankWorkspaces?.workspaces??{}).map(([workspace,entry])=>({
      workspace,label:entry.label,state:this.#handles.has(workspace)?'OPEN':'CLOSED',
      imports:Object.entries(entry.imports).map(([sourceImport,item])=>({sourceImport,label:item.label,kind:item.kind,sha256:item.sha256})),
      merchants:Object.entries(entry.merchants).map(([profile,item])=>({profile,...item})),
      buyerWorkspaces:Object.entries(entry.buyerWorkspaces).map(([buyerWorkspace,item])=>({buyerWorkspace,label:item.label}))
    }))};
    const entry=this.#declared(name),opening=this.#handles.get(name);
    if(!opening)return {workspace:name,label:entry.label,state:'CLOSED'};
    const handle=await opening;
    return {workspace:name,instanceId:handle.instanceId,state:handle.closing?'CLOSING':'OPEN',
      native:this.#visible(entry,stateView(await handle.operator.state(),offset,limit)),
      browser:{open:Boolean(handle.browser)},fileReads:{source:this.#reads.status(name),
        downloads:[...handle.downloadScopes].map(scope=>this.#reads.status(scope))}};
  }
  async #stop(name,handle) {
    if(handle.close)return handle.close;
    handle.closing=true;
    handle.close=(async()=>{
      await handle.tail.catch(()=>{});
      const resources=[
        async()=>{if(handle.browser)await handle.browser.close();},
        ()=>this.#reads.closeScope(name),
        ...[...handle.downloadScopes].map(scope=>()=>this.#reads.closeScope(scope))
      ];
      const outcomes=await Promise.allSettled(resources.map(close=>Promise.resolve().then(close)));
      const native=await Promise.allSettled([Promise.resolve().then(()=>handle.operator.close())]);
      handle.browser=null;
      handle.downloadScopes.clear();
      handle.manifests.clear();
      this.#handles.delete(name);
      const errors=[...outcomes,...native].filter(result=>result.status==='rejected').map(result=>result.reason);
      if(errors.length){
        const error=new AggregateError(errors,'World Bank shutdown attempted every owned resource; one or more resources reported an error.');
        error.code='WORLDBANK_CLOSE_FAILED';
        throw error;
      }
      return {workspace:name,instanceId:handle.instanceId,state:'CLOSED'};
    })();
    return handle.close;
  }
  async #input(entry,sourceImport) {
    const source=entry.imports[identifier(sourceImport,'Source import')];
    if(!source)throw failure('WORLDBANK_IMPORT_NOT_CONFIGURED','Choose an original host-declared source import.');
    const bytes=await originalBytes(source.file,WORLDBANK_MAX_FILE_BYTES);
    const digest=sha(bytes);
    if(source.sha256 && source.sha256!==digest)throw failure('WORLDBANK_SOURCE_CHANGED','The declared original source differs from its configured SHA256.');
    return {source,bytes,sha256:digest};
  }
  async #file(handle,args) {
    worldbankId(args.id);
    if(!fileKinds.includes(args.kind))throw failure('INVALID_PARAMS','Choose an original World Bank or publisher file kind.');
    const key=args.kind+':'+args.id+':'+(args.filename??'');
    return this.#reads.read({scope:args.workspace,key,kind:args.kind,directory:this.#config.exportsDirectory,
      expectedSha256:args.expectedSha256,readId:args.readId,offset:args.offset,limit:args.limit,
      load:async()=>{
        const file=args.kind==='source-export' ? await handle.operator.readExport(args.id,args.filename)
          : await handle.operator.readPublisherExport(args.kind,args.id);
        return {bytes:file.bytes,name:file.filename,type:file.contentType};
      }});
  }
  async #manifest(handle,workspace,exportId) {
    worldbankId(exportId);
    if(!handle.manifests.has(exportId)){
      const opening=handle.operator.act('export-read',{id:exportId})
        .then(response=>worldbankDownloadManifest(workspace,response.result));
      handle.manifests.set(exportId,opening);
      try { await opening; }
      catch(error){handle.manifests.delete(exportId);throw error;}
      if(handle.manifests.size>32)handle.manifests.delete(handle.manifests.keys().next().value);
    }
    return handle.manifests.get(exportId);
  }
  async #downloadFile(handle,args) {
    const manifest=await this.#manifest(handle,args.workspace,args.exportId);
    if(args.expectedManifestSha256!==manifest.sha256)
      throw failure('WORLDBANK_DOWNLOAD_EXPORT_CHANGED','Use the selected original receiving manifest SHA256.');
    const descriptor=args.file===WORLDBANK_DOWNLOAD_MANIFEST ? manifest.file : manifest.value.files.find(item=>item.name===args.file);
    if(!descriptor || args.expectedSha256!==descriptor.sha256)
      throw failure('WORLDBANK_DOWNLOAD_FILE_CHANGED','Choose a file and exact hash from this original receiving manifest.');
    const scope=args.workspace+':download:'+args.exportId;handle.downloadScopes.add(scope);
    const result=await this.#reads.read({scope,
      key:args.file,kind:'worldbank-download',directory:this.#config.exportsDirectory,
      expectedSha256:args.expectedSha256,readId:args.readId,offset:args.offset,limit:args.limit,
      load:async()=>args.file===WORLDBANK_DOWNLOAD_MANIFEST
        ? {bytes:manifest.bytes,name:WORLDBANK_DOWNLOAD_MANIFEST,type:'application/json; charset=utf-8'}
        : await (async()=>{
          const file=await handle.operator.readExport(args.exportId,args.file);
          return {bytes:file.bytes,name:args.file,type:file.contentType};
        })()});
    if(result.nextOffset===null && !this.#reads.status(scope).sessions.length)handle.downloadScopes.delete(scope);
    return {exportId:args.exportId,manifestSha256:manifest.sha256,...result};
  }
  async #execute(name,handle,args) {
    const entry=handle.configuration,original=handle.operator;
    const call=async(action,payload={})=>{
      const response=await original.act(action,payload);
      return {workspace:args.workspace,instanceId:handle.instanceId,...response,
        result:this.#visible(entry,response.result),state:this.#visible(entry,stateView(response.state))};
    };
    const payload=(keys)=>Object.fromEntries(keys.filter(key=>args[key]!==undefined).map(key=>[key,args[key]]));
    switch(name) {
      case 'merchant_worldbank_selection':
        return call('save-selection',payload(['id','title','expectedRevision','spec']));
      case 'merchant_worldbank_catalog':
        return call('catalog',payload(['kind','sourceId','search','refresh','offset','limit']));
      case 'merchant_worldbank_capture': {
        worldbankId(args.id);
        if(args.action==='cancel')return call('capture-cancel',{id:args.id});
        if(args.action==='start'||args.action==='resume'){
          worldbankId(args.selectionId);return call('capture',{id:args.id,selectionId:args.selectionId});
        }
        if(args.action!=='inspect')throw failure('INVALID_PARAMS','Choose start, resume, inspect or cancel.');
        const response=await call('capture-detail',{id:args.id});
        const selected=pageRows(response.result.pages??[],args.offset??0,args.limit??20);
        response.result={...response.result,pages:selected.items,page:selected.page};
        return response;
      }
      case 'merchant_worldbank_inputs': {
        const names=args.sourceImport===undefined?Object.keys(entry.imports):[args.sourceImport],inputs=[];
        for(const sourceImport of names){
          const result=await this.#input(entry,sourceImport);
          inputs.push({sourceImport,label:result.source.label,kind:result.source.kind,
            bytes:result.bytes.length,sha256:result.sha256});
        }
        return {workspace:args.workspace,inputs};
      }
      case 'merchant_worldbank_import': {
        const selected=await this.#input(entry,args.sourceImport);
        if(args.expectedSha256!==selected.sha256)throw failure('WORLDBANK_SOURCE_CHANGED','Use the inspected exact source file SHA256.');
        worldbankId(args.id);
        if(selected.source.kind==='pages'){
          worldbankId(args.selectionId);
          const value=parse(selected.bytes);
          if(!plain(value)||!Array.isArray(value.pages))throw failure('WORLDBANK_IMPORT_INVALID','The original page capture must contain its complete pages and receipts.');
          return call('import-pages',{id:args.id,selectionId:args.selectionId,pages:value.pages});
        }
        return call('import-package',{...payload(['id','selectionId','reviewId']),archiveBase64:selected.bytes.toString('base64')});
      }
      case 'merchant_worldbank_observations':return call('observations',payload(['captureId','search','offset','limit']));
      case 'merchant_worldbank_compare':return call('compare',payload(['captureId','baselineId','offset','limit']));
      case 'merchant_worldbank_review': {
        const response=await call('review',payload(['id','captureId','baselineId','title','note','excludedKeys','choices','columns','expectedRevision']));
        response.result=reviewView(response.result,0,20);return response;
      }
      case 'merchant_worldbank_review_read': {
        const response=await call('review-read',{id:args.id});
        response.result=reviewView(response.result,args.offset??0,args.limit??20);return response;
      }
      case 'merchant_worldbank_export': {
        const response=await call('export',payload(['id','reviewId','expectedRevision']));
        response.result.manifest=paged(response.result.manifest,['files'],0,20);return response;
      }
      case 'merchant_worldbank_export_read': {
        const response=await call('export-read',{id:args.id});
        response.result.manifest=paged(response.result.manifest,['files'],args.offset??0,args.limit??20);return response;
      }
      case 'merchant_worldbank_merchant': {
        const profile=entry.merchants[identifier(args.profile,'Merchant profile')];
        if(!profile)throw failure('WORLDBANK_MERCHANT_NOT_CONFIGURED','Choose a host-declared merchant profile.');
        const {label,...terms}=profile;return call('merchant-prepare',{exportId:worldbankId(args.exportId),...terms});
      }
      case 'merchant_worldbank_publisher': {
        if(!publisherActions.has(args.action))throw failure('INVALID_PARAMS','Choose an original publisher action.');
        const selected=args.payload??{};
        if(!plain(selected))throw failure('INVALID_PARAMS','Supply an original object publisher payload.');
        if(args.action==='publisher.release.stage'){
          exact(selected,['draftId','id','label'],['draftId','id']);
          return call(args.action,{...selected,runtime:entry.runtime});
        }
        if(args.action==='publisher.buyer.session'){
          exact(selected,['buyerId','buyerWorkspace','maxPages','maxTotalAtomic','maxRows','maxPageBytes'],['buyerId','buyerWorkspace']);
          const buyer=entry.buyerWorkspaces[identifier(selected.buyerWorkspace,'Buyer workspace')];
          if(!buyer)throw failure('WORLDBANK_BUYER_NOT_CONFIGURED','Choose a host-declared original buyer workspace.');
          const {buyerWorkspace,...terms}=selected;
          return call(args.action,{...terms,workspaceDirectory:buyer.directory});
        }
        return call(args.action,selected);
      }
      case 'merchant_worldbank_browser': {
        if(args.action==='close'){
          if(handle.browser){await handle.browser.close();handle.browser=null;}
          return {workspace:args.workspace,instanceId:handle.instanceId,browser:'CLOSED'};
        }
        if(args.action!=='open')throw failure('INVALID_PARAMS','Choose open or close.');
        if(!handle.browser){
          const {startWorldBankWorkspace}=await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/worldbank/native.mjs');
          handle.browser=await startWorldBankWorkspace({directory:entry.directory,operator:original,
            port:count(args.port??0,'Browser port',0,65535)});
        }
        return {workspace:args.workspace,instanceId:handle.instanceId,browser:'OPEN',url:handle.browser.url};
      }
      case 'merchant_worldbank_file':return this.#file(handle,args);
      case 'merchant_worldbank_file_release':
        await this.#reads.release(args.workspace,args.readId);return {workspace:args.workspace,readId:args.readId,released:true};
      case 'merchant_worldbank_download_manifest': {
        const manifest=await this.#manifest(handle,args.workspace,args.exportId);
        return {state:'MANIFEST_RETAINED',workspace:args.workspace,exportId:args.exportId,manifestFile:manifest.file,
          sourceManifestSha256:manifest.value.sourceManifestSha256};
      }
      case 'merchant_worldbank_download_file':return this.#downloadFile(handle,args);
      case 'merchant_worldbank_download_file_release': {
        worldbankId(args.exportId);const scope=args.workspace+':download:'+args.exportId;
        await this.#reads.release(scope,args.readId);
        if(!this.#reads.status(scope).sessions.length)handle.downloadScopes.delete(scope);
        return {workspace:args.workspace,exportId:args.exportId,readId:args.readId,released:true};
      }
      default:throw failure('TOOL_NOT_FOUND','Unknown World Bank workspace operation.');
    }
  }
  async #dispatch(name,args) {
    if(args.offset!==undefined)count(args.offset,'Offset');
    if(args.limit!==undefined)count(args.limit,'Page/chunk size',1,name.endsWith('_file')?MAX_RETAINED_CHUNK_BYTES:100);
    if(name==='merchant_worldbank_status')return this.#status(args.workspace,args.offset??0,args.limit??20);
    if(name==='merchant_worldbank_open')return this.#open(args.workspace);
    this.#declared(args.workspace);
    const opening=this.#handles.get(args.workspace);
    if(!opening)throw failure('WORLDBANK_WORKSPACE_CLOSED','Open the original model with merchant_worldbank_open.');
    const handle=await opening;
    if(handle.closing)throw failure('WORLDBANK_WORKSPACE_CLOSING','The original World Bank model is closing.');
    if(name==='merchant_worldbank_close'){
      if(args.instanceId!==handle.instanceId)throw failure('INSTANCE_CONFLICT','Use the original instance ID from this process status.');
      return this.#stop(args.workspace,handle);
    }
    const operation=handle.tail.then(()=>this.#execute(name,handle,args));
    handle.tail=operation.then(()=>{},()=>{});return operation;
  }
  async call(name,args={}) {
    if(this.#closing)throw failure('OPERATOR_CLOSING','The World Bank adapter is closing.');
    const definition=definitions.get(name);
    if(!definition)throw failure('TOOL_NOT_FOUND','Unknown World Bank workspace operation.');
    exact(args,Object.keys(definition.properties),definition.required);
    const operation=this.#dispatch(name,args);this.#pending.add(operation);
    try{return await operation;}finally{this.#pending.delete(operation);}
  }
  close() {
    if(this.#close)return this.#close;
    this.#closing=true;
    this.#close=(async()=>{
      await Promise.allSettled([...this.#pending]);
      const outcomes=await Promise.allSettled([...this.#handles].map(async([name,opening])=>this.#stop(name,await opening)));
      outcomes.push(...await Promise.allSettled([Promise.resolve().then(()=>this.#reads.close())]));
      const errors=outcomes.filter(result=>result.status==='rejected').map(result=>result.reason);
      if(errors.length){
        const error=new AggregateError(errors,'World Bank shutdown attempted all models and file reads; one or more resources reported an error.');
        error.code='WORLDBANK_CLOSE_FAILED';
        throw error;
      }
    })();
    return this.#close;
  }
}
