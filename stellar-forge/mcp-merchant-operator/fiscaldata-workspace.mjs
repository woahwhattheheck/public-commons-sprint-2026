// MIT. Original Fiscal model, retained operator identity and native publisher through Merchant MCP.
import { constants } from 'node:fs';
import { open, realpath, lstat, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { exact, failure, identifier, line, plain, privateSupportDirectory, fileBytes } from './config.mjs';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { privateDirectory, readJson, createFile, bytes, identity, digest } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/files.mjs';

export const FISCALDATA_WORKSPACE_CONNECTION_SCHEMA='stellar-forge.fiscaldata-workspace-connection.v1';
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const uuid={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'};
const hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const payload={type:'object',additionalProperties:true};
const operationId={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'};
const read={readOnly:true,idempotent:true};
const publisherActions=new Set([
  'publisher.status','publisher.prepare','publisher.preview','publisher.reviewDraft','publisher.publish',
  'publisher.activateSnapshot','publisher.collect','publisher.release.stage','publisher.release.inspect',
  'publisher.release.activate','publisher.release.rollback','publisher.release.start','publisher.release.stop',
  'publisher.buyer.review','publisher.buyer.prepare','publisher.buyer.session','publisher.buyer.run',
  'publisher.buyer.recover','publisher.buyer.account','publisher.buyer.export'
]);
const readActions=new Set(['captures.get','captures.rows','editions.get','editions.rows','editions.query',
  'comparisons.get','publisher.status','publisher.preview','publisher.release.inspect','publisher.buyer.account']);
function count(value,label,min=0,max=Number.MAX_SAFE_INTEGER) {
  if(!Number.isSafeInteger(value)||value<min||value>max)throw failure('INVALID_PARAMS',label+' must be an integer from '+min+' to '+max+'.');
  return value;
}
function hostPath(value,base){
  if(typeof value!=='string'||!value||/[\x00-\x1f\x7f]/.test(value))throw failure('CONFIGURATION_ERROR','Declare canonical Fiscal host paths in the private connection file.');
  return resolve(base,value);
}
async function privateJSON(path){
  if(await realpath(path)!==path)throw failure('CONFIGURATION_ERROR','Use the original canonical private connection file.');
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const stat=await handle.stat();
    if(!stat.isFile()||stat.nlink!==1||stat.size>1024**2||process.platform!=='win32'&&
      ((stat.mode&0o077)||process.getuid&&stat.uid!==process.getuid()))throw failure('CONFIGURATION_ERROR','Use an owned0600 connection file, at most one MiB.');
    const value=await handle.readFile();
    if(value.length>1024**2)throw failure('CONFIGURATION_ERROR','The connection file exceeds one MiB.');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(value));
  }finally{await handle.close();}
}
function entries(value,label){
  if(value===undefined)return[];
  if(!plain(value)||Object.keys(value).length>32)throw failure('CONFIGURATION_ERROR','Declare up to32 named '+label+'.');
  return Object.entries(value).map(([key,item])=>[identifier(key,label+' alias'),item]);
}
function runtime(value={}){
  exact(value,['port','facilitator','allowLocalFacilitator']);count(value.port??0,'Seller port',0,65535);
  if(value.allowLocalFacilitator!==undefined&&typeof value.allowLocalFacilitator!=='boolean')throw failure('CONFIGURATION_ERROR','allowLocalFacilitator must be Boolean.');
  if(value.facilitator!==undefined){
    const url=new URL(value.facilitator);
    if(url.username||url.password||url.search||url.hash||url.protocol!=='https:'&&
      !(value.allowLocalFacilitator===true&&url.protocol==='http:'&&url.hostname==='127.0.0.1'))
      throw failure('CONFIGURATION_ERROR','Use the configured HTTPS or explicitly local facilitator.');
  }
  return {...value,port:value.port??0};
}
/** Host configuration contains identity and bindings. Reading it opens no native workspace. */
export async function readFiscalDataWorkspaceConfiguration(path){
  path=resolve(path);const raw=await privateJSON(path),base=dirname(path);
  exact(raw,['schema','operator','workspaces'],['schema','operator','workspaces']);
  exact(raw.operator,['id','label'],['id','label']);
  if(raw.schema!==FISCALDATA_WORKSPACE_CONNECTION_SCHEMA||!plain(raw.workspaces)||
    !Object.keys(raw.workspaces).length||Object.keys(raw.workspaces).length>32||
    !/^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,159}$/.test(raw.operator.id??''))
    throw failure('CONFIGURATION_ERROR','Declare the named operator and1–32 original Fiscal workspaces.');
  const operator={id:raw.operator.id,label:line(raw.operator.label,'Operator label')},workspaces=Object.create(null),seen=new Set();
  for(const [name,input] of Object.entries(raw.workspaces)){
    identifier(name,'Fiscal workspace alias');
    exact(input,['label','directory','imports','merchants','buyerWorkspaces','runtime','limits'],['directory']);
    const directory=await realpath(hostPath(input.directory,base));await privateSupportDirectory(directory);
    if(seen.has(directory))throw failure('CONFIGURATION_ERROR','Give each original directory one workspace alias.');seen.add(directory);
    const imports=Object.create(null),merchants=Object.create(null),buyers=Object.create(null);
    for(const[key,item]of entries(input.imports,'source-workspace packages')){
      exact(item,['label','file','sha256'],['file','sha256']);
      const file=await realpath(hostPath(item.file,base));
      if(!(await lstat(file)).isFile()||!/^[a-f0-9]{64}$/.test(item.sha256??''))throw failure('CONFIGURATION_ERROR','Pin each regular package file by its full SHA-256.');
      imports[key]={label:line(item.label??key),file,sha256:item.sha256};
    }
    for(const[key,item]of entries(input.merchants,'merchant profiles')){
      exact(item,['label','origin','path','payment'],['origin','path','payment']);
      if(!plain(item.payment)||typeof item.origin!=='string'||typeof item.path!=='string')throw failure('CONFIGURATION_ERROR','Declare original public merchant terms.');
      merchants[key]={label:line(item.label??key),origin:item.origin,path:item.path,payment:item.payment};
    }
    for(const[key,item]of entries(input.buyerWorkspaces,'buyer workspaces')){
      exact(item,['label','directory'],['directory']);
      const target=await realpath(hostPath(item.directory,base));await privateSupportDirectory(target);
      buyers[key]={label:line(item.label??key),directory:target};
    }
    if(input.limits!==undefined&&!plain(input.limits))throw failure('CONFIGURATION_ERROR','Use an object of original Fiscal model limits.');
    workspaces[name]={label:line(input.label??name),directory,imports,merchants,buyerWorkspaces:buyers,
      runtime:runtime(input.runtime),limits:input.limits??{}};
  }
  return {operator,workspaces};
}
export function fiscalDataWorkspaceTools(tool){
  const scope=p=>({workspace:alias,...p});
  const window={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}};
  const chunk={expectedSha256:hash,readId:uuid,offset:{type:'integer',minimum:0},
    limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES}};
  return [
    tool('merchant_fiscaldata_status','List host-declared Fiscal workspaces and operator identity, or page a section of the original opened workspace. Every history and endpoint list returns its real total and next offset.',scope({section:{enum:['overview','catalog','sources','captures','editions','comparisons','exports','packages']},...window}),[],read),
    tool('merchant_fiscaldata_open','Open the original Fiscal model under its kernel lease. Repeated calls reuse this process-owned instance. Existing captures remain idle until an explicit start or resume.',scope({}),['workspace'],{idempotent:true}),
    tool('merchant_fiscaldata_close','Drain and close this exact model and borrowed browser, retaining all originals and received customer data.',scope({instanceId:uuid}),['workspace','instanceId'],{destructive:true}),
    tool('merchant_fiscaldata_catalog','Refresh actual Treasury metadata or read the retained catalogue. Refresh makes a dated original observation.',scope({action:{enum:['refresh','get']},...window}),['workspace','action'],{openWorld:true}),
    tool('merchant_fiscaldata_source','Save a source revision or probe its actual Treasury fields. Uses the original source schema and exact revision guards.',scope({action:{enum:['save','probe']},payload}),['workspace','action','payload'],{openWorld:true}),
    tool('merchant_fiscaldata_capture','Create, read, page, pause, resume or cancel an original paged Treasury capture. Reuse requestId for creation and preserve the original source ID/revision/SHA.',scope({action:{enum:['start','get','rows','pause','resume','cancel']},payload,...window}),['workspace','action','payload'],{openWorld:true}),
    tool('merchant_fiscaldata_edition','Create, inspect, review, build or page a native Fiscal CSV edition. Decimal values and scales stay strings. The original model validates units, null markers, key fields and field review revisions.',scope({action:{enum:['create','get','review','build','rows']},payload}),['workspace','action','payload'],{}),
    tool('merchant_fiscaldata_query','Query an original READY native CSV edition with its declared query grammar and exact retained response.',scope({id:uuid,query:{type:'string',maxLength:8192}}),['workspace','id','query'],read),
    tool('merchant_fiscaldata_comparison','Create or page an original exact-decimal cohort comparison, including source units, participating rows and first/last dated stock observations.',scope({action:{enum:['create','get']},payload}),['workspace','action','payload'],{}),
    tool('merchant_fiscaldata_export','Create the original complete capture, edition or comparison delivery and immutable archive.',scope({payload}),['workspace','payload'],{}),
    tool('merchant_fiscaldata_merchant','Prepare the original edition merchant export using a declared public merchant profile, including its exact raw sourceFiles closure.',scope({editionId:uuid,profile:alias,requestId:operationId}),['workspace','editionId','profile','requestId'],{}),
    tool('merchant_fiscaldata_publisher','Operate the original publisher, SF82 release and SF88 buyer. Runtime and buyer directories come from host bindings; native purchase approval and exact retained offer/revision guards remain in the original engines.',scope({action:{enum:[...publisherActions]},payload}),['workspace','action','payload'],{openWorld:true}),
    tool('merchant_fiscaldata_checkpoint','Drain the owned model and browser, then stream its full original source/review workspace into a hashed portable package under the original lease. Reopens the same workspace with unfinished captures paused; use a stable operationId for retry.',scope({operationId}),['workspace','operationId'],{}),
    tool('merchant_fiscaldata_restore','Receive a reviewed package into an empty CLOSED declared workspace. Choose either a pinned host sourceImport or one package produced by a declared sourceWorkspace. Retains source IDs, original records, acquired delivery files and receiving lineage; unfinished captures are paused.',scope({sourceImport:alias,sourceWorkspace:alias,packageId:hash,expectedSha256:hash,operationId}),['workspace','expectedSha256','operationId'],{}),
    tool('merchant_fiscaldata_file','Read a hash-pinned original model or portable-package file through the existing bounded retained chunk reader. Continue using readId and expectedSha256 until nextOffset is null.',scope({kind:{enum:['capture','edition','comparison','export','publisher','package']},id:{type:'string'},filename:{type:'string',minLength:1,maxLength:180},...chunk}),['workspace','kind','id','filename'],read),
    tool('merchant_fiscaldata_file_release','Release an unfinished process-owned retained file read.',scope({readId:uuid}),['workspace','readId'],{idempotent:true}),
    tool('merchant_fiscaldata_browser','Open or close the original industrial browser on loopback, borrowing this same model and recording writes under the declared operator. The native HTTP cookie, origin and CSRF controls remain active.',scope({action:{enum:['open','close']},port:{type:'integer',minimum:0,maximum:65535}}),['workspace','action'],{}),
    tool('merchant_fiscaldata_history','Read retained original operator action intents and observed outcomes, including interrupted actions without a completion record.',scope({...window}),['workspace'],read)
  ];
}
function page(values,offset=0,limit=50){count(offset,'Offset');count(limit,'Page size',1,100);return{items:values.slice(offset,offset+limit),offset,limit,total:values.length,nextOffset:offset+limit<values.length?offset+limit:null};}
function stateView(state,section='overview',offset=0,limit=50){
  if(section==='catalog')return{...state.catalog,endpoints:page(state.catalog.endpoints,offset,limit)};
  if(['sources','captures','editions','comparisons','exports'].includes(section))return page(state[section],offset,limit);
  const result={...state,catalog:{...state.catalog,endpoints:page(state.catalog.endpoints,0,20)}};
  for(const key of ['sources','captures','editions','comparisons','exports'])result[key]=page(state[key],offset,limit);
  return result;
}
export class MerchantFiscalDataWorkspaces{
  #config;#handles=new Map();#receiving=new Set();#pending=new Set();#closing=false;#close;
  #reads=new RetainedFileReads({errorPrefix:'FISCALDATA'});
  constructor(config){this.#config=config;}
  get summary(){return{configured:Boolean(this.#config.fiscalDataWorkspaces),operator:this.#config.fiscalDataWorkspaces?.operator??null,
    opened:[...this.#handles.keys()],receiving:[...this.#receiving],pending:this.#pending.size,closing:this.#closing,...this.#reads.summary};}
  #declared(name){identifier(name,'Fiscal workspace alias');const entry=this.#config.fiscalDataWorkspaces?.workspaces?.[name];
    if(!entry)throw failure('FISCALDATA_WORKSPACE_NOT_CONFIGURED','Choose an alias from merchant_fiscaldata_status.');return entry;}
  #packageDirectory(name){this.#declared(name);return join(this.#config.exportsDirectory,'fiscaldata-packages',name);}
  async #model(entry){
    const{openFiscalWorkspace}=await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/fiscaldata/workspace-model.mjs');
    return openFiscalWorkspace({directory:entry.directory,limits:entry.limits,
      buyerWorkspaces:Object.entries(entry.buyerWorkspaces).map(([id,item])=>({id,...item}))});
  }
  async #open(name){
    const entry=this.#declared(name);
    if(this.#receiving.has(name))throw failure('FISCALDATA_WORKSPACE_RECEIVING','The original package is still being received into this alias.');
    if(!this.#handles.has(name)){
      const opening=(async()=>{
        const model=await this.#model(entry);
        try{
          const header=await readJson(join(entry.directory,'workspace.json'),1024**2);
          return{entry,model,workspaceId:header.id,instanceId:randomUUID(),browser:null,tail:Promise.resolve(),closing:false,suspended:false,lifecycle:null};
        }catch(error){await model.close();throw error;}
      })();
      this.#handles.set(name,opening);
      try{await opening;}catch(error){if(this.#handles.get(name)===opening)this.#handles.delete(name);throw error;}
    }
    return this.#status(name);
  }
  async #packages(name,offset,limit){
    const directory=this.#packageDirectory(name);let names;
    try{names=await readdir(directory);}catch(error){if(error.code==='ENOENT')return page([],offset,limit);throw error;}
    const items=[];
    for(const id of names.filter(x=>/^[a-f0-9]{64}$/.test(x)).sort()){
      try{const record=await readJson(join(directory,id,'sealed.json'),1024**2);items.push({packageId:id,
        operationId:record.operationId,workspace:record.workspace,createdAt:record.createdAt,files:record.files});}
      catch(error){if(error.code!=='ENOENT')throw error;}
    }
    return page(items,offset,limit);
  }
  async #status(name,section='overview',offset=0,limit=50){
    count(offset,'History offset');count(limit,'History page size',1,100);
    if(name===undefined)return{...this.summary,workspaces:Object.entries(this.#config.fiscalDataWorkspaces?.workspaces??{}).map(([workspace,entry])=>({
      workspace,label:entry.label,state:this.#receiving.has(workspace)?'RECEIVING':this.#handles.has(workspace)?'OPEN':'CLOSED',
      imports:Object.entries(entry.imports).map(([sourceImport,item])=>({sourceImport,label:item.label,sha256:item.sha256})),
      merchants:Object.entries(entry.merchants).map(([profile,item])=>({profile,...item})),
      buyerWorkspaces:Object.entries(entry.buyerWorkspaces).map(([id,item])=>({id,label:item.label}))}))};
    const entry=this.#declared(name);
    if(section==='packages')return{workspace:name,packages:await this.#packages(name,offset,limit)};
    const pending=this.#handles.get(name);if(!pending)return{workspace:name,label:entry.label,state:this.#receiving.has(name)?'RECEIVING':'CLOSED'};
    const handle=await pending;
    return{workspace:name,workspaceId:handle.workspaceId,instanceId:handle.instanceId,
      state:handle.closing?'CLOSING':handle.lifecycle?.state??(handle.model?'OPEN':'CLOSED'),
      lifecycle:handle.lifecycle,
      operator:this.#config.fiscalDataWorkspaces.operator,native:handle.model&&!handle.lifecycle&&!handle.closing?stateView(await handle.model.snapshot(),section,offset,limit):null,
      browser:{open:Boolean(handle.browser)},fileReads:this.#reads.status(name)};
  }
  async #audit(handle,action,input,origin,perform){
    if(readActions.has(action))return perform();
    const id=randomUUID(),root=join(handle.entry.directory,'operator-history',id);
    await privateDirectory(root,true);
    const intent={schema:'stellar-forge.fiscaldata-operator-action.v1',id,workspaceId:handle.workspaceId,
      operator:this.#config.fiscalDataWorkspaces.operator,instanceId:handle.instanceId,origin,action,
      input:structuredClone(input),inputSha256:identity(input),startedAt:new Date().toISOString()};
    await createFile(join(root,'intent.json'),bytes(intent));
    let result;
    try{result=await perform();}
    catch(error){
      await createFile(join(root,'outcome.json'),bytes({id,state:'FAILED',endedAt:new Date().toISOString(),
        error:{code:error.code??'FISCALDATA_OPERATION_FAILED',message:String(error.message)}})).catch(()=>{});
      error.operatorActionId=id;throw error;
    }
    const outcome={id,state:'COMPLETED',endedAt:new Date().toISOString(),resultSha256:identity(result.result??result),
      revision:result.state?.revision??null};
    try{await createFile(join(root,'outcome.json'),bytes(outcome));}
    catch(error){return{...result,operatorAction:{id,operator:intent.operator,recordingWarning:error.code??'OUTCOME_WRITE_INTERRUPTED'}};}
    return{...result,operatorAction:{id,operator:intent.operator,state:'COMPLETED'}};
  }
  async #native(handle,action,input={},origin='mcp'){
    if(!plain(input))throw failure('INVALID_PARAMS','Use an object action payload.');
    const selected={...input},entry=handle.entry;
    if(action==='merchant.configure'){
      const found=Object.values(entry.merchants).some(profile=>profile.origin===selected.origin&&profile.path===selected.path&&identity(profile.payment)===identity(selected.payment));
      if(!found)throw failure('FISCALDATA_MERCHANT_NOT_CONFIGURED','Choose the exact public merchant terms declared by this host.');
    }
    if(action==='publisher.release.stage'){
      exact(selected,['draftId','id','label','runtime']);
      if(selected.runtime!==undefined&&identity(runtime(selected.runtime))!==identity(entry.runtime))
        throw failure('FISCALDATA_RUNTIME_NOT_CONFIGURED','Use the host-declared native seller runtime.');
      selected.runtime=entry.runtime;
    }
    if(action==='publisher.buyer.session'&&!Object.hasOwn(entry.buyerWorkspaces,selected.workspaceId))
      throw failure('FISCALDATA_BUYER_NOT_CONFIGURED','Choose the declared original buyer workspace ID.');
    if(action.startsWith('publisher.')&&!publisherActions.has(action))throw failure('INVALID_PARAMS','Choose an original declared publisher action.');
    return this.#audit(handle,action,selected,origin,async()=>{
      const result=await handle.model.dispatch(action,selected);
      if(['captures.start','captures.resume'].includes(action))await handle.model.startWorker();
      return result;
    });
  }
  #enqueue(handle,perform){
    if(handle.closing)throw failure('FISCALDATA_WORKSPACE_CLOSING','The original workspace is closing.');
    if(handle.lifecycle)throw failure('FISCALDATA_WORKSPACE_DRAINING','The original workspace is draining for '+handle.lifecycle.state.toLowerCase()+'. Retry after its lifecycle completes.');
    const task=handle.tail.then(perform);handle.tail=task.then(()=>{},()=>{});return task;
  }
  async #transition(handle,state,perform){
    if(handle.closing)throw failure('FISCALDATA_WORKSPACE_CLOSING','The original workspace is closing.');
    if(handle.lifecycle)throw failure('FISCALDATA_WORKSPACE_DRAINING','The original workspace already has an active lifecycle transition.');
    // Reserve admission synchronously, before either browser or queued native work can yield.
    handle.lifecycle={state,startedAt:new Date().toISOString()};
    const closeBrowser=async()=>{const browser=handle.browser;handle.browser=null;if(browser)await browser.close();};
    try{
      await closeBrowser();
      await handle.tail.catch(()=>{});
      // A browser-open accepted before the reservation may have completed in the old tail.
      // Its requests cannot enter #enqueue while reserved; drain it outside that tail too.
      await closeBrowser();
      return await perform();
    }finally{handle.lifecycle=null;}
  }
  async #history(handle,offset,limit){
    let names=[];try{names=await readdir(join(handle.entry.directory,'operator-history'));}catch(error){if(error.code!=='ENOENT')throw error;}
    const records=[];
    for(const id of names.filter(x=>/^[a-f0-9-]{36}$/.test(x))){
      const root=join(handle.entry.directory,'operator-history',id),intent=await readJson(join(root,'intent.json'),16*1024**2);
      let outcome=null;try{outcome=await readJson(join(root,'outcome.json'),1024**2);}catch(error){if(error.code!=='ENOENT')throw error;}
      records.push({...intent,outcome});
    }
    records.sort((a,b)=>a.startedAt.localeCompare(b.startedAt));return page(records,offset,limit);
  }
  async #file(name,handle,args){
    const key=args.kind+':'+args.id+':'+args.filename;
    return this.#reads.read({scope:name,key,kind:args.kind,directory:this.#config.exportsDirectory,
      expectedSha256:args.expectedSha256,readId:args.readId,offset:args.offset,limit:args.limit,load:async()=>{
        let file;
        if(args.kind==='package'){
          const{fiscalSourcePackageFile}=await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/fiscaldata/portable.mjs');
          file=await fiscalSourcePackageFile({outputDirectory:this.#packageDirectory(name),packageId:args.id,filename:args.filename});
        }else{
          if(!handle?.model)throw failure('FISCALDATA_WORKSPACE_CLOSED','Open the original workspace before its file read.');
          file=await handle.model.file(args.kind,args.id,args.filename);
        }
        const data=await fileBytes(file.path,256_000_000);
        if(data.length!==file.size||digest(data)!==file.sha256)throw failure('FISCALDATA_FILE_CHANGED','The original file changed before its retained read.');
        return{bytes:data,name:file.name,type:file.mime};
      }});
  }
  async #borrowBrowser(name,handle,port){
    if(handle.browser)return handle.browser;
    const{createFiscalWorkspaceHandler}=await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/fiscaldata/workspace-server.mjs');
    let handler,closing=false;const requests=new Set(),sockets=new Set();
    const server=createServer((req,res)=>{
      if(closing||!handler||handle.lifecycle||handle.closing){res.writeHead(503);res.end('Workspace is starting or draining.');return;}
      const task=Promise.resolve(handler(req,res)).catch(error=>{if(!res.headersSent)res.writeHead(500);res.end('Workspace request failed.');});
      requests.add(task);task.finally(()=>requests.delete(task));
    });
    server.requestTimeout=30000;server.headersTimeout=10000;server.keepAliveTimeout=2000;
    server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(count(port??0,'Browser port',0,65535),'127.0.0.1',resolve);});
    const origin='http://127.0.0.1:'+server.address().port,token=randomBytes(32).toString('hex');
    try{
      handler=await createFiscalWorkspaceHandler({origins:[origin],token,model:{
        snapshot:()=>handle.model.snapshot(),file:(...args)=>handle.model.file(...args),
        dispatch:(action,input)=>this.#enqueue(handle,()=>this.#native(handle,action,input,'browser'))
      }});
    }catch(error){await new Promise(resolve=>server.close(resolve));throw error;}
    return{url:origin+'/',async close(){
      if(closing)return;closing=true;handler.close();server.closeIdleConnections?.();
      const stopped=new Promise(resolve=>server.close(resolve));
      await Promise.allSettled([...requests]);for(const socket of sockets)socket.destroy();await stopped;
    }};
  }
  async #checkpoint(name,handle,operationId){
    await this.#reads.closeScope(name);handle.suspended=true;
    let result;
    try{
      const before=await handle.model.snapshot();
      await handle.model.close();handle.model=null;
      const{createFiscalSourcePackage}=await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/fiscaldata/portable.mjs');
      result=await createFiscalSourcePackage({directory:handle.entry.directory,outputDirectory:this.#packageDirectory(name),
        operationId,actor:this.#config.fiscalDataWorkspaces.operator,
        publication:{merchantEditions:before.editions.filter(e=>e.merchant).map(e=>({id:e.id,sha256:e.sha256,merchant:e.merchant})),
          acquisitions:before.exports.filter(e=>e.exportKind==='acquisition').map(e=>({id:e.id,createdAt:e.createdAt}))}});
    }finally{
      try{if(!handle.model)handle.model=await this.#model(handle.entry);}
      catch(error){handle.closing=true;this.#handles.delete(name);throw error;}
      finally{handle.suspended=false;}
    }
    return{workspace:name,instanceId:handle.instanceId,...result,state:stateView(await handle.model.snapshot())};
  }
  async #restore(name,args){
    const entry=this.#declared(name);
    if(this.#handles.has(name))throw failure('FISCALDATA_RESTORE_OPEN','Close this exact destination instance before receiving its source package.');
    if(this.#receiving.has(name))throw failure('FISCALDATA_WORKSPACE_RECEIVING','This alias already has an original receiving operation.');
    this.#receiving.add(name);
    try{
    let file;
    if(args.sourceImport!==undefined){
      if(args.sourceWorkspace!==undefined||args.packageId!==undefined)throw failure('INVALID_PARAMS','Choose one original package source.');
      const selected=entry.imports[identifier(args.sourceImport,'Source import')];
      if(!selected||selected.sha256!==args.expectedSha256)throw failure('FISCALDATA_IMPORT_NOT_CONFIGURED','Select the exact host-declared package digest.');
      file=selected.file;
    }else{
      this.#declared(args.sourceWorkspace);
      const{fiscalSourcePackageFile}=await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/fiscaldata/portable.mjs');
      const selected=await fiscalSourcePackageFile({outputDirectory:this.#packageDirectory(args.sourceWorkspace),packageId:args.packageId,filename:'workspace.fiscal.gz'});
      if(selected.sha256!==args.expectedSha256)throw failure('FISCALDATA_PACKAGE_CHANGED','Choose the original complete package SHA-256.');file=selected.path;
    }
    const{receiveFiscalSourcePackage}=await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/fiscaldata/portable.mjs');
    const result=await receiveFiscalSourcePackage({directory:entry.directory,packagePath:file,expectedSha256:args.expectedSha256,
      operationId:args.operationId,actor:this.#config.fiscalDataWorkspaces.operator});
    return{workspace:name,state:'CLOSED',receiving:result};
    }finally{this.#receiving.delete(name);}
  }
  async #execute(name,handle,args){
    const call=async(action,input={})=>{
      const response=await this.#native(handle,action,input);
      if(action==='catalog.refresh')response.result={...response.result,endpoints:page(response.result.endpoints,args.offset,args.limit)};
      if(action==='captures.get')response.result={...response.result,pageRecords:page(response.result.pageRecords,args.offset,args.limit),
        attempts:page(response.result.attempts,args.offset,args.limit)};
      return{...response,state:stateView(response.state)};
    };
    switch(name){
      case'merchant_fiscaldata_catalog':
        if(args.action==='get')return stateView(await handle.model.snapshot(),'catalog',args.offset,args.limit);
        if(args.action==='refresh')return call('catalog.refresh');break;
      case'merchant_fiscaldata_source':if(['save','probe'].includes(args.action))return call('sources.'+args.action,args.payload);break;
      case'merchant_fiscaldata_capture':if(['start','get','rows','pause','resume','cancel'].includes(args.action))return call('captures.'+args.action,args.payload);break;
      case'merchant_fiscaldata_edition':if(['create','get','review','build','rows'].includes(args.action))return call('editions.'+args.action,args.payload);break;
      case'merchant_fiscaldata_query':return call('editions.query',{id:args.id,query:args.query});
      case'merchant_fiscaldata_comparison':if(['create','get'].includes(args.action))return call('comparisons.'+args.action,args.payload);break;
      case'merchant_fiscaldata_export':return call('exports.create',args.payload);
      case'merchant_fiscaldata_merchant':{
        const selected=handle.entry.merchants[identifier(args.profile,'Merchant profile')];
        if(!selected)throw failure('FISCALDATA_MERCHANT_NOT_CONFIGURED','Choose a host-declared public merchant profile.');
        const{label,...terms}=selected;return call('merchant.configure',{...terms,editionId:args.editionId,requestId:args.requestId});
      }
      case'merchant_fiscaldata_publisher':if(publisherActions.has(args.action))return call(args.action,args.payload);break;
      case'merchant_fiscaldata_file':return this.#file(args.workspace,handle,args);
      case'merchant_fiscaldata_history':return this.#history(handle,args.offset??0,args.limit??50);
      case'merchant_fiscaldata_browser':
        if(args.action==='open'){handle.browser=await this.#borrowBrowser(args.workspace,handle,args.port);return{workspace:args.workspace,
          instanceId:handle.instanceId,browser:'OPEN',url:handle.browser.url};}break;
    }
    throw failure('INVALID_PARAMS','Choose an original Fiscal workspace operation.');
  }
  async #stop(name,handle){
    handle.closing=true;
    if(handle.browser){await handle.browser.close();handle.browser=null;}
    await handle.tail.catch(()=>{});await this.#reads.closeScope(name);
    await handle.model?.close();handle.model=null;this.#handles.delete(name);
    return{workspace:name,instanceId:handle.instanceId,state:'CLOSED'};
  }
  async #dispatch(name,args){
    if(name==='merchant_fiscaldata_status')return this.#status(args.workspace,args.section,args.offset,args.limit);
    if(name==='merchant_fiscaldata_open')return this.#open(args.workspace);
    this.#declared(args.workspace);
    if(name==='merchant_fiscaldata_restore')return this.#restore(args.workspace,args);
    if(name==='merchant_fiscaldata_file_release'){await this.#reads.release(args.workspace,args.readId);return{released:true,readId:args.readId};}
    if(name==='merchant_fiscaldata_file'&&args.kind==='package')return this.#file(args.workspace,null,args);
    const pending=this.#handles.get(args.workspace);if(!pending)throw failure('FISCALDATA_WORKSPACE_CLOSED','Open the original workspace first.');
    const handle=await pending;
    if(name==='merchant_fiscaldata_checkpoint')
      return this.#transition(handle,'CHECKPOINTING',()=>this.#checkpoint(args.workspace,handle,args.operationId));
    if(name==='merchant_fiscaldata_browser'&&args.action==='close')
      return this.#transition(handle,'BROWSER_CLOSING',async()=>({workspace:args.workspace,browser:'CLOSED'}));
    if(name==='merchant_fiscaldata_close'){
      if(args.instanceId!==handle.instanceId)throw failure('INSTANCE_CONFLICT','Use the exact process-owned instance ID from status.');
      return this.#transition(handle,'CLOSING',()=>this.#stop(args.workspace,handle));
    }
    return this.#enqueue(handle,()=>this.#execute(name,handle,args));
  }
  async call(name,args){
    if(this.#closing)throw failure('OPERATOR_CLOSING','The Fiscal adapter is closing.');
    const task=this.#dispatch(name,args);this.#pending.add(task);
    try{return await task;}finally{this.#pending.delete(task);}
  }
  close(){
    if(this.#close)return this.#close;this.#closing=true;
    this.#close=(async()=>{
      await Promise.allSettled([...this.#pending]);
      const outcomes=await Promise.allSettled([...this.#handles].map(async([name,pending])=>this.#stop(name,await pending)));
      await this.#reads.close();
      if(outcomes.some(value=>value.status==='rejected'))throw failure('FISCALDATA_CLOSE_FAILED','An original Fiscal workspace could not finish draining.');
    })();return this.#close;
  }
}
