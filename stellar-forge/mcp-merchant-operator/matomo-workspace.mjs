// MIT. Typed agent and browser work over the one original retained Matomo workspace.
import {constants} from 'node:fs';
import {open,realpath,access,readdir,rename,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {dirname,isAbsolute,resolve,join,relative,sep} from 'node:path';
import {exact,failure,identifier,line,plain} from './host-files.mjs';
import {RetainedFileReads,MAX_RETAINED_IMMUTABLE_FILE_BYTES} from './retained-file-reads.mjs';
import {MATOMO_MUTATIONS,MATOMO_ARTIFACTS} from './catalog/matomo-workspace.mjs';
import {inspectMatomoWorkspace} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/matomo/launch.mjs';
import {identifier as nativeId} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/matomo/contract.mjs';
import {hashPrivate,privateDirectory,acquireWorkspace,syncDirectory,bytes} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/files.mjs';
export {matomoWorkspaceTools} from './catalog/matomo-workspace.mjs';

export const MATOMO_WORKSPACE_CONNECTION_SCHEMA='stellar-forge.matomo-workspace-connection.v1';
const HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
function hostPath(value,base) {
  if(typeof value!=='string'||!value||value.length>8192||/[\x00-\x1f\x7f]/.test(value))
    throw failure('CONFIGURATION_ERROR','Declare a nonempty host path without control characters.');
  return isAbsolute(value)?resolve(value):resolve(base,value);
}
function sameFile(a,b) {
  return ['dev','ino','size','mtimeNs','ctimeNs'].every(key=>a[key]===b[key]);
}
async function privateJson(path,expectedSha256) {
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const before=await handle.stat({bigint:true});
    if(!before.isFile()||before.nlink!==1n||before.mode&0o077n||before.size<1n||before.size>1048576n)
      throw failure('CONFIGURATION_ERROR','Select an existing private regular JSON configuration no larger than 1 MiB.');
    const raw=await handle.readFile();
    const after=await handle.stat({bigint:true});
    if(!sameFile(before,after)||BigInt(raw.length)!==after.size)
      throw failure('MATOMO_CONFIGURATION_CHANGED','The original configuration changed while it was read.');
    const sha256=createHash('sha256').update(raw).digest('hex');
    if(expectedSha256!==undefined&&sha256!==expectedSha256)
      throw failure('MATOMO_CONFIGURATION_CHANGED','The original host configuration differs from its retained hash.');
    let value;
    try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
    catch{throw failure('CONFIGURATION_ERROR','Use one valid UTF-8 JSON configuration.');}
    return {value,sha256};
  } finally {await handle.close();}
}
function environmentValues(value) {
  if(!plain(value)||Object.keys(value).length>256||Object.entries(value).some(([key,item])=>
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)||typeof item!=='string'||item.length>65536||item.includes('\0')))
    throw failure('CONFIGURATION_ERROR','The host environment file must contain only bounded environment-name/string pairs.');
  return value;
}
/** Host configuration selects existing native workspaces; tool callers supply aliases only. */
export async function readMatomoWorkspaceConfiguration(path) {
  path=resolve(path);
  const input=(await privateJson(path)).value;
  exact(input,['schema','workspaces'],['schema','workspaces']);
  if(input.schema!==MATOMO_WORKSPACE_CONNECTION_SCHEMA||!plain(input.workspaces)||
    Object.keys(input.workspaces).length<1||Object.keys(input.workspaces).length>32)
    throw failure('CONFIGURATION_ERROR','Declare between 1 and 32 existing original Matomo workspaces.');
  const base=dirname(path),directories=new Set(),workspaces=Object.create(null);
  for(const [alias,entry] of Object.entries(input.workspaces)) {
    identifier(alias,'Matomo workspace alias');
    exact(entry,['label','directory','python','environmentFile','allowLoopbackSource'],['directory']);
    if(entry.allowLoopbackSource!==undefined&&typeof entry.allowLoopbackSource!=='boolean')
      throw failure('CONFIGURATION_ERROR','allowLoopbackSource must be an explicit host boolean.');
    const directory=hostPath(entry.directory,base);
    if(await realpath(directory)!==directory||directories.has(directory))
      throw failure('CONFIGURATION_ERROR','Give each original canonical Matomo directory one configured alias.');
    const inspected=await inspectMatomoWorkspace(directory,{allowLoopback:entry.allowLoopbackSource===true});
    directories.add(directory);
    let python,environmentFile,environmentSha256;
    if(entry.python!==undefined){python=hostPath(entry.python,base);await access(python,constants.X_OK);}
    if(entry.environmentFile!==undefined) {
      environmentFile=hostPath(entry.environmentFile,base);
      const retained=await privateJson(environmentFile);
      environmentValues(retained.value);environmentSha256=retained.sha256;
    }
    workspaces[alias]={label:entry.label===undefined?alias:line(entry.label,'Matomo workspace label'),
      directory,workspaceId:inspected.workspaceId,identity:inspected.sha256,python,
      environmentFile,environmentSha256,allowLoopbackSource:entry.allowLoopbackSource===true};
  }
  return {schema:MATOMO_WORKSPACE_CONNECTION_SCHEMA,workspaces};
}

/** Set up the shared host against the selected original Matomo release store. */
export async function initializeMatomoWorkspaceMerchant(options) {
  exact(options,['directory','connection','workspace','name'],['directory','connection']);
  const root=hostPath(options.directory,process.cwd()),connection=hostPath(options.connection,process.cwd());
  const name=line(options.name??'Starforge Matomo operator','Merchant name');
  const selection=await readMatomoWorkspaceConfiguration(connection),aliases=Object.keys(selection.workspaces);
  const selected=options.workspace??(aliases.length===1?aliases[0]:undefined);
  if(typeof selected!=='string'||!Object.hasOwn(selection.workspaces,selected))
    throw failure('CONFIGURATION_ERROR','Choose workspace from the declared aliases when the connection contains more than one.');
  identifier(selected,'Matomo workspace alias');
  for(const definition of Object.values(selection.workspaces)) {
    const within=relative(definition.directory,root);
    if(!within||!isAbsolute(within)&&within!=='..'&&!within.startsWith('..'+sep))
      throw failure('CONFIGURATION_ERROR','Keep the MCP host directory outside every original Matomo workspace.');
  }
  const definition=selection.workspaces[selected],releaseStore=join(definition.directory,'merchant','releases');
  const configuration=join(root,'merchant-mcp.json');
  const raw={schema:'stellar-forge.merchant-mcp.v1',name,releaseStore,
    exportsDirectory:'./customer-exports',sources:{},matomoWorkspaceConnection:connection};
  const binding={schema:'stellar-forge.matomo-host-setup.v1',configuration:raw,workspace:selected,
    workspaces:Object.fromEntries(Object.entries(selection.workspaces).map(([alias,value])=>
      [alias,{directory:value.directory,workspaceId:value.workspaceId,identity:value.identity,
        label:value.label,python:value.python??null,environmentFile:value.environmentFile??null,
        environmentSha256:value.environmentSha256??null,allowLoopbackSource:value.allowLoopbackSource}]))};
  await privateDirectory(root,true);
  const releaseHost=await acquireWorkspace(root);
  try {
    const {writeNew,readRetained}=await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/matomo/store.mjs');
    const allowed=new Set(['publisher.lock','matomo-host-setup.json','matomo-host-setup.json.matomo-pending',
      'merchant-mcp.json','merchant-mcp.json.matomo-pending','customer-exports']);
    if((await readdir(root)).some(item=>!allowed.has(item)))
      throw failure('MATOMO_HOST_NOT_EMPTY','Use a new private host directory or reopen this exact retained Matomo setup.');
    await writeNew(join(root,'matomo-host-setup.json'),bytes(binding));
    let retained;
    try{retained=await readRetained(configuration,1048576);}catch(issue){if(issue.code!=='ENOENT')throw issue;}
    const expected=Buffer.from(JSON.stringify(raw,null,2)+'\n');
    if(retained&&!retained.equals(expected))
      throw failure('MATOMO_HOST_CONFIGURATION_CONFLICT','The retained host configuration differs from this original setup.');
    if(!retained) {
      // Use the same native workspace lease as the report model, and the
      // original SF82 initializer. No report or provider request is involved.
      const releaseOriginal=await acquireWorkspace(definition.directory);
      try {
        await inspectMatomoWorkspace(definition.directory,{expectedIdentity:definition.identity,
          allowLoopback:definition.allowLoopbackSource});
        const {readReleaseState,initReleaseStore}=await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs');
        let missing=false;
        try{await access(releaseStore);}catch(issue){if(issue.code!=='ENOENT')throw issue;missing=true;}
        if(missing) {
          const parent=join(definition.directory,'merchant');
          await privateDirectory(parent,true);
          const staging=join(parent,'.matomo-host-release-'+randomUUID());
          let published=false;
          try {
            // Build the original empty SF82 store completely before its
            // canonical directory appears. A short write is not a saved store.
            await initReleaseStore(staging);
            await readReleaseState(staging);
            try {
              await access(releaseStore);
              throw failure('MATOMO_RELEASE_STORE_APPEARED','The original release store appeared during setup; inspect it before continuing.');
            } catch(issue) {if(issue.code!=='ENOENT')throw issue;}
            await rename(staging,releaseStore);published=true;
            await syncDirectory(parent);
          } finally {
            if(!published)await rm(staging,{recursive:true,force:true});
          }
        }
        await readReleaseState(releaseStore);
      } finally {await releaseOriginal();}
      await privateDirectory(join(root,'customer-exports'),true);
      await writeNew(configuration,expected);
    }
    const configured=await (await import('./config.mjs')).readMerchantConfig(configuration);
    if(!configured.matomoWorkspaces)
      throw failure('MATOMO_PROVIDER_NOT_INSTALLED','Use the maintained merchant host with this source contribution selected.');
    const current=await readMatomoWorkspaceConfiguration(connection);
    if(JSON.stringify(current)!==JSON.stringify(selection))
      throw failure('MATOMO_CONFIGURATION_CHANGED','The original connection changed during host setup; inspect its retained configuration.');
    return {schema:raw.schema,state:retained?'REOPENED':'INITIALIZED',configuration,
      matomoWorkspacesConfigured:true,workspace:selected,releaseStore,
      ownership:'ORIGINAL_MATOMO_WORKSPACE',workspaces:Object.entries(selection.workspaces).map(([workspace,value])=>
        ({workspace,label:value.label,workspaceId:value.workspaceId,workspaceIdentity:value.identity}))};
  } finally {await releaseHost();}
}

function view(value,root) {
  if(Array.isArray(value))return value.map(item=>view(item,root));
  if(typeof value==='string')return value===root||value.startsWith(root+'/')?'[private workspace]'+value.slice(root.length):value;
  if(!plain(value))return value;
  if(value.schema==='stellar-forge.matomo-source.v1') {
    const {authorization,...publicSource}=value;
    return {...view(publicSource,root),authorizationConfigured:Boolean(authorization)};
  }
  return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,view(item,root)]));
}
function safeIssue(issue) {
  const code=/^[A-Z][A-Z0-9_]{0,95}$/.test(issue?.code??'')?issue.code:'MATOMO_WORKSPACE_OPERATION_FAILED';
  return failure(code,'Original Matomo operation: '+code+'. Inspect its retained action and current workspace before choosing a native recovery.');
}
function integer(value,defaultValue,maximum=Number.MAX_SAFE_INTEGER) {
  value??=defaultValue;
  if(!Number.isSafeInteger(value)||value<0||value>maximum)
    throw failure('INVALID_PARAMS','Use a nonnegative integer within the native bound.');
  return value;
}
function paging(input,maximum=250) {
  const offset=integer(input.offset,0),limit=integer(input.limit,25,maximum);
  if(limit===0)throw failure('INVALID_PARAMS','Page size must be positive.');
  return {offset,limit};
}
function digest(value) {
  if(typeof value!=='string'||!HASH.test(value))throw failure('INVALID_PARAMS','Use the exact inspected SHA-256.');
  return value;
}
function instance(value) {
  if(typeof value!=='string'||!UUID.test(value))throw failure('INVALID_PARAMS','Use the exact current workspace instance UUID.');
  return value;
}

export class MerchantMatomoWorkspaces {
  #config;#entries=new Map();#opening=new Map();#closing=false;#closePromise=null;
  #reads=new RetainedFileReads({errorPrefix:'MATOMO_ARTIFACT'});
  constructor(config){this.#config=config;}
  get summary() {
    return {configured:Boolean(this.#config.matomoWorkspaces),closing:this.#closing,...this.#reads.summary,
      workspaces:Object.entries(this.#config.matomoWorkspaces?.workspaces??{}).map(([workspace,definition])=>{
        const entry=this.#entries.get(workspace);
        return {workspace,label:definition.label,workspaceId:definition.workspaceId,workspaceIdentity:definition.identity,
          open:Boolean(entry),opening:this.#opening.has(workspace),closing:Boolean(entry?.closing||entry?.closeRequested),
          instanceId:entry?.instanceId??null,browserUrl:entry?.service.url??null};
      })};
  }
  #definition(alias) {
    identifier(alias,'Matomo workspace alias');
    const value=this.#config.matomoWorkspaces?.workspaces[alias];
    if(!value)throw failure('MATOMO_WORKSPACE_NOT_CONFIGURED','Choose a host-declared alias from merchant_matomo_workspaces.');
    return value;
  }
  #entry(alias,{allowClosing=false}={}) {
    this.#definition(alias);const entry=this.#entries.get(alias);
    if(!entry)throw failure('MATOMO_WORKSPACE_NOT_OPEN','Explicitly open this original Matomo workspace first.');
    if((entry.closing||entry.closeRequested)&&!allowClosing)throw failure('MATOMO_WORKSPACE_CLOSING','This original workspace instance is closing.');
    return entry;
  }
  #scope(entry){return 'matomo:'+entry.alias+':'+this.#definition(entry.alias).directory;}
  #current(entry,value) {
    if(instance(value)!==entry.instanceId)
      throw failure('MATOMO_INSTANCE_CONFLICT','Use the current Matomo workspace instance returned by open/status.');
  }
  #state(entry) {
    return {workspace:entry.alias,instanceId:entry.instanceId,browserUrl:entry.service.url,
      workspaceIdentity:this.#definition(entry.alias).identity,
      native:view(entry.model.state(),this.#definition(entry.alias).directory),
      artifactReads:this.#reads.status(this.#scope(entry))};
  }
  async #open(alias) {
    const definition=this.#definition(alias);
    if(this.#entries.has(alias))return this.#state(this.#entry(alias));
    if(this.#opening.has(alias))return this.#opening.get(alias);
    const pending=(async()=>{
      await inspectMatomoWorkspace(definition.directory,{expectedIdentity:definition.identity,allowLoopback:definition.allowLoopbackSource});
      let environment=process.env;
      if(definition.environmentFile) {
        const retained=await privateJson(definition.environmentFile,definition.environmentSha256);
        environment={...process.env,...environmentValues(retained.value)};
      }
      const {startMatomoWorkspace}=await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/matomo/server.mjs');
      let service,entry;
      try {
        service=await startMatomoWorkspace({directory:definition.directory,environment,
          allowLoopback:definition.allowLoopbackSource,port:0,...(definition.python?{python:definition.python}:{})});
        entry={alias,service,model:service.model,instanceId:service.instanceId,pending:new Set(),closing:null,closeRequested:false};
        this.#entries.set(alias,entry);
        await inspectMatomoWorkspace(definition.directory,{expectedIdentity:definition.identity,allowLoopback:definition.allowLoopbackSource});
        if(this.#closing)throw failure('MATOMO_WORKSPACE_CLOSING','The merchant operator is closing.');
        return this.#state(entry);
      } catch(issue) {
        if(entry)await this.#closeEntry(entry);
        else if(service)await service.close();
        throw issue;
      }
    })();
    this.#opening.set(alias,pending);
    try{return await pending;}finally{this.#opening.delete(alias);}
  }
  async #closeEntry(entry) {
    entry.closeRequested=true;
    if(!entry.closing) {
      const pending=(async()=>{
        // Ask the original owner to abort/drain first. Waiting on active calls
        // before this request would deadlock a slow native capture on shutdown.
        const serviceClose=Promise.resolve().then(()=>entry.service.close());
        const readsClose=this.#reads.closeScope(this.#scope(entry));
        const [serviceResult,readsResult]=await Promise.allSettled([
          serviceClose,readsClose,Promise.allSettled([...entry.pending])
        ]);
        if(serviceResult.status==='rejected')throw serviceResult.reason;
        if(readsResult.status==='rejected')throw readsResult.reason;
        if(this.#entries.get(entry.alias)===entry)this.#entries.delete(entry.alias);
        return {workspace:entry.alias,instanceId:entry.instanceId,state:'CLOSED'};
      })();
      entry.closing=pending;
      void pending.catch(()=>{if(entry.closing===pending)entry.closing=null;});
    }
    return entry.closing;
  }
  async #artifact(entry,input) {
    if(!MATOMO_ARTIFACTS.includes(input.artifact))throw failure('INVALID_PARAMS','Choose a declared Matomo artifact kind.');
    nativeId(input.id);
    if(input.kind!==undefined&&!['csv','config','manifest','archive','scan'].includes(input.kind))
      throw failure('INVALID_PARAMS','Choose an original artifact variant.');
    if(input.expectedSha256!==undefined)digest(input.expectedSha256);
    const definition=this.#definition(entry.alias),key=JSON.stringify([input.artifact,input.id,input.kind??null]);
    return this.#reads.read({scope:this.#scope(entry),key,kind:'matomo-original-artifact',
      directory:definition.directory,readId:input.readId,expectedSha256:input.expectedSha256,
      offset:input.offset,limit:input.limit,
      load:async()=>{
        const value=await entry.model.artifact(input.artifact,input.id,{kind:input.kind});
        if(value.content!==undefined)return {bytes:Buffer.from(value.content),name:value.name,type:value.mediaType};
        if(!value.path)throw failure('MATOMO_ARTIFACT_NOT_RETAINED','Read native findings with the paged comparison or original browser export.');
        const sha256=value.sha256??(await hashPrivate(value.path,MAX_RETAINED_IMMUTABLE_FILE_BYTES)).hash;
        const handle=await open(value.path,constants.O_RDONLY|constants.O_NOFOLLOW);
        try {
          const stat=await handle.stat();
          if(!stat.isFile()||stat.nlink!==1||stat.mode&0o077||!Number.isSafeInteger(stat.size)||
            stat.size>MAX_RETAINED_IMMUTABLE_FILE_BYTES)
            throw failure('MATOMO_ARTIFACT_CHANGED','The original private artifact no longer matches its native file contract.');
          // Transfer this read-only descriptor to the maintained reader. It
          // hashes the same open file and owns its lifetime and byte ranges.
          return {readonlyFileHandle:handle,bytes:stat.size,sha256,name:value.name,type:value.mediaType};
        } catch(issue){await handle.close();throw issue;}
      }});
  }
  async #execute(entry,name,args) {
    const {workspace,...input}=args,root=this.#definition(entry.alias).directory;
    const suffix=name.startsWith('merchant_matomo_')?name.slice('merchant_matomo_'.length):'';
    if(Object.hasOwn(MATOMO_MUTATIONS,suffix)) {
      const operation=MATOMO_MUTATIONS[suffix];
      exact(input,['workspaceInstanceId','operationId','expectedRevision',...Object.keys(operation.properties)],
        ['workspaceInstanceId','operationId','expectedRevision',...operation.required]);
      this.#current(entry,input.workspaceInstanceId);nativeId(input.operationId);
      integer(input.expectedRevision,undefined);
      const {workspaceInstanceId,...nativeInput}=input;
      const result=await entry.model.perform(operation.native,JSON.parse(JSON.stringify(nativeInput)));
      return {workspace,instanceId:entry.instanceId,result:view(result,root),revision:entry.model.store.revision()};
    }
    switch(name) {
      case 'merchant_matomo_original_records':
        exact(input,['table','offset','limit']);
        if(!entry.model.origin)throw failure('MATOMO_PRODUCT_ORIGINAL_REQUIRED','Choose a received editable source workspace.');
        return {workspace,origin:entry.model.origin.summary(),page:view(await entry.model.origin.page({table:input.table??'history',...paging(input,50)}),root)};
      case 'merchant_matomo_original_files':
        exact(input,['offset','limit']);
        if(!entry.model.origin)throw failure('MATOMO_PRODUCT_ORIGINAL_REQUIRED','Choose a received editable source workspace.');
        return {workspace,files:entry.model.origin.files(paging(input,50))};
      case 'merchant_matomo_original_merchant':
        exact(input,['originalMerchantId'],['originalMerchantId']);
        if(!entry.model.origin)throw failure('MATOMO_PRODUCT_ORIGINAL_REQUIRED','Choose a received editable source workspace.');
        return view(await entry.model.origin.merchant(nativeId(input.originalMerchantId)),root);
      case 'merchant_matomo_status':
        exact(input,[]);return this.#state(entry);
      case 'merchant_matomo_operation': {
        exact(input,['operationId'],['operationId']);
        const action=entry.model.store.action(nativeId(input.operationId));
        return {workspace,instanceId:entry.instanceId,action:view(action,root),
          active:view(entry.model.state().active,root),revision:entry.model.store.revision()};
      }
      case 'merchant_matomo_cancel':
        exact(input,['operationId','workspaceInstanceId'],['operationId','workspaceInstanceId']);
        this.#current(entry,input.workspaceInstanceId);return entry.model.store.cancel(nativeId(input.operationId));
      case 'merchant_matomo_catalog': {
        exact(input,['catalogId','part','offset','limit'],['catalogId']);
        const catalog=entry.model.captures.catalog(nativeId(input.catalogId)),part=input.part??'summary';
        if(!['summary','reports','segments'].includes(part))throw failure('INVALID_PARAMS','Choose summary, reports or segments.');
        const reports=catalog.data.reports??[],segments=catalog.data.outcomes?.segments?.value??[];
        const {reports:omittedReports,outcomes,...data}=catalog.data;
        const context={...outcomes};
        if(context.segments)context.segments={...context.segments,value:undefined};
        const summary={...catalog,data:{...data,outcomes:context},reportCount:reports.length,
          segmentCount:Array.isArray(segments)?segments.length:null};
        if(part==='summary')return {workspace,catalog:view(summary,root)};
        const rows=part==='reports'?reports:segments;
        if(!Array.isArray(rows))throw failure('MATOMO_CATALOG_SHAPE','The retained native catalog part is not a row array.');
        const {offset,limit}=paging(input),selected=rows.slice(offset,offset+limit);
        return {workspace,catalog:view(summary,root),part,rows:selected,page:{offset,limit,total:rows.length,
          next:offset+selected.length<rows.length?offset+selected.length:null}};
      }
      case 'merchant_matomo_capture':
        exact(input,['captureId'],['captureId']);nativeId(input.captureId);
        return {workspace,capture:view(entry.model.captures.capture(input.captureId),root),tables:view(entry.model.captures.tables(input.captureId),root)};
      case 'merchant_matomo_rows':
        exact(input,['captureId','tableId','offset','limit'],['captureId']);nativeId(input.captureId);
        if(input.tableId!==undefined)digest(input.tableId);
        return entry.model.captures.rows(input.captureId,{...paging(input),tableId:input.tableId});
      case 'merchant_matomo_edition': {
        exact(input,['editionId'],['editionId']);
        const value=await entry.model.editions.manifest(nativeId(input.editionId));
        return {workspace,edition:view(value.edition,root),manifest:value.value};
      }
      case 'merchant_matomo_edition_rows':
        exact(input,['editionId','tableId','offset','limit'],['editionId']);nativeId(input.editionId);
        if(input.tableId!==undefined)digest(input.tableId);
        return entry.model.editions.sample(input.editionId,{...paging(input),tableId:input.tableId});
      case 'merchant_matomo_comparison':
        exact(input,['comparisonId','kind','offset','limit'],['comparisonId']);nativeId(input.comparisonId);
        return view(await entry.model.comparisons.page(input.comparisonId,{...paging(input),kind:input.kind}),root);
      case 'merchant_matomo_merchant':
        exact(input,['merchantId'],['merchantId']);return view(await entry.model.merchant.state(nativeId(input.merchantId)),root);
      case 'merchant_matomo_preview':
        exact(input,['merchantId','draftRevision','query','input'],['merchantId','draftRevision','query']);
        nativeId(input.merchantId);digest(input.draftRevision);
        return entry.model.merchant.preview(input);
      case 'merchant_matomo_releases':
        exact(input,[]);return view(await entry.model.merchant.releases(),root);
      case 'merchant_matomo_release_diff':
        exact(input,['before','after'],['after']);nativeId(input.after);
        if(input.before!==undefined&&input.before!==null)nativeId(input.before);
        return view(await entry.model.merchant.diff(input.before??null,input.after),root);
      case 'merchant_matomo_delivery':
        exact(input,['deliveryId','query'],['deliveryId']);
        return view(await entry.model.merchant.inspectDelivery(nativeId(input.deliveryId),input.query),root);
      case 'merchant_matomo_handover':
        exact(input,['handoverId'],['handoverId']);return view(entry.model.handover.handover(nativeId(input.handoverId)),root);
      case 'merchant_matomo_receiving':
        exact(input,['receivingId'],['receivingId']);return view(entry.model.handover.receiving(nativeId(input.receivingId)),root);
      case 'merchant_matomo_receiving_rows':
        exact(input,['receivingId','offset','limit'],['receivingId']);
        return entry.model.handover.receivedRows(nativeId(input.receivingId),paging(input,100));
      case 'merchant_matomo_source_read':
        exact(input,['sourceRequestId'],['sourceRequestId']);
        return view(await entry.model.sourceRead(nativeId(input.sourceRequestId)),root);
      case 'merchant_matomo_artifact_read':
        exact(input,['artifact','id','kind','readId','expectedSha256','offset','limit'],['artifact','id']);
        return this.#artifact(entry,input);
      case 'merchant_matomo_artifact_release':
        exact(input,['readId'],['readId']);instance(input.readId);
        await this.#reads.release(this.#scope(entry),input.readId);
        return {workspace,released:input.readId};
      default:throw failure('TOOL_NOT_FOUND','Unknown original Matomo workspace operation.');
    }
  }
  async call(name,args={}) {
    try {
      if(!plain(args))throw failure('INVALID_PARAMS','Supply one argument object.');
      if(name==='merchant_matomo_workspaces'){exact(args,[]);return this.summary;}
      if(name==='merchant_matomo_close') {
        exact(args,['workspace','instanceId'],['workspace','instanceId']);
        const entry=this.#entry(args.workspace,{allowClosing:true});this.#current(entry,args.instanceId);
        return await this.#closeEntry(entry);
      }
      if(this.#closing)throw failure('MATOMO_WORKSPACE_CLOSING','The merchant operator is closing.');
      if(name==='merchant_matomo_open'){exact(args,['workspace'],['workspace']);return await this.#open(args.workspace);}
      const entry=this.#entry(args.workspace),pending=Promise.resolve().then(()=>this.#execute(entry,name,args));
      entry.pending.add(pending);
      try{return await pending;}finally{entry.pending.delete(pending);}
    } catch(issue){throw safeIssue(issue);}
  }
  close() {
    if(!this.#closePromise) {
      this.#closing=true;
      const pending=(async()=>{
        await Promise.allSettled([...this.#opening.values()]);
        const results=await Promise.allSettled([...this.#entries.values()].map(entry=>this.#closeEntry(entry)));
        const failed=results.find(result=>result.status==='rejected');
        if(failed)throw failed.reason;
        await this.#reads.close();
      })();
      this.#closePromise=pending;
      void pending.catch(()=>{if(this.#closePromise===pending)this.#closePromise=null;});
    }
    return this.#closePromise;
  }
}
