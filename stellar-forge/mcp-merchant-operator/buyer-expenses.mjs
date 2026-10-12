// MIT. Programmatic operation of the original SF36 expense workspace.
import { constants } from 'node:fs';
import { open, readFile, lstat, mkdir, realpath, readdir, rename, unlink, link, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { exact, failure, identifier, privateSupportDirectory, writePrivate } from './config.mjs';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { BUYER_EXPENSE_ACTIONS, validateBuyerExpenseArguments } from './buyer-expense-protocol.mjs';
export { buyerExpenseTools } from './buyer-expense-protocol.mjs';
import { acquireStateLease } from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';

export const BUYER_EXPENSE_CONNECTION_SCHEMA = 'stellar-forge.buyer-expense-connection.v1';
export const BUYER_EXPENSE_EXPORT_SCHEMA = 'stellar-forge.buyer-expense-mcp-export.v1';
export const BUYER_EXPENSE_MANIFEST = 'buyer-expense-export.json';
const SERVER = fileURLToPath(new URL('../../stellar/scf-starforge-20261009/sf36-spend-governor/expense-workspace/server.py', import.meta.url));
const MAX_BYTES = 256_000_000;
const PREFIX = 'merchant_buyer_expense_';
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const record = {pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'};
const request = {pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'};
const sha = {pattern:'^[0-9a-f]{64}$'};
function fail(code, message) { return failure('BUYER_EXPENSE_' + code, message); }
function checkId(value) {
  if (typeof value !== 'string' || !new RegExp(record.pattern).test(value)) throw fail('ID', 'Choose an exact retained original ID.');
  return value;
}
const part = value => encodeURIComponent(checkId(value));
function page(values, offset=0, limit=50) {
  if (!Number.isSafeInteger(offset) || offset<0 || !Number.isSafeInteger(limit) || limit<1 || limit>200) throw fail('PAGE', 'Use a nonnegative offset and 1–200 rows.');
  return { items: values.slice(offset,offset+limit), total: values.length, offset, next: offset+limit<values.length ? offset+limit : null };
}
function parse(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); }
  catch { throw fail('JSON', 'The original retained source is not complete UTF-8 JSON.'); }
}
async function privateBytes(path, maximum=MAX_BYTES) {
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const value=await handle.stat();
    if (!value.isFile() || value.size>maximum || value.mode&0o077 || process.getuid && value.uid!==process.getuid()) throw fail('PRIVATE_FILE','Use an owned private regular file within its limit.');
    const bytes=await handle.readFile();
    if(bytes.length>maximum)throw fail('FILE_SIZE','The file exceeds its original size limit.');
    return bytes;
  } finally { await handle.close(); }
}
function hostPath(value, base) {
  if(typeof value!=='string'||!value||value.includes('\0'))throw fail('CONFIGURATION','Select original host file paths in the private connection.');
  return resolve(base,value);
}
export async function readBuyerExpenseConfiguration(path) {
  path=resolve(path);const raw=parse(await privateBytes(path,65536));
  exact(raw,['schema','workspaces'],['schema','workspaces']);
  if(raw.schema!==BUYER_EXPENSE_CONNECTION_SCHEMA)throw fail('CONFIGURATION','Use the original buyer expense connection schema.');
  exact(raw.workspaces,Object.keys(raw.workspaces ?? {}));
  if(!Object.keys(raw.workspaces).length)throw fail('CONFIGURATION','Declare at least one original expense workspace.');
  const workspaces={};
  for(const [name,value] of Object.entries(raw.workspaces)) {
    identifier(name);exact(value,['directory','python','ledgers'],['directory']);
    const directory=hostPath(value.directory,dirname(path));
    const python=value.python ?? 'python3';
    if(typeof python!=='string'||python.includes('\0')||(python!=='python3'&&!isAbsolute(python)))throw fail('CONFIGURATION','Select python3 or a host-declared absolute Python interpreter path.');
    const ledgers={};exact(value.ledgers ?? {},Object.keys(value.ledgers ?? {}));
    for(const [key,source] of Object.entries(value.ledgers ?? {})) {
      identifier(key);exact(source,['path','name','provenance'],['path','name','provenance']);
      if(typeof source.name!=='string'||!source.name.trim()||source.name.length>160||typeof source.provenance!=='string'||source.provenance.length>6000)throw fail('CONFIGURATION','Declare the original ledger name and source provenance.');
      ledgers[key]={path:hostPath(source.path,dirname(path)),name:source.name,provenance:source.provenance};
    }
    workspaces[name]={directory,python,ledgers};
  }
  if(new Set(Object.values(workspaces).map(v=>v.directory)).size!==Object.keys(workspaces).length)throw fail('CONFIGURATION','Use one alias for each original expense directory.');
  return {schema:BUYER_EXPENSE_CONNECTION_SCHEMA,workspaces};
}
function compactResponse(value) {
  return value?.result?.snapshot ? {...value,result:{...value.result,snapshot:compactReport(value.result.snapshot)}} : value;
}
function compactReport(value,view='summary',offset=0,limit=50) {
  const arrays=Object.fromEntries(Object.entries(value).filter(([,v])=>Array.isArray(v)));
  const summary=Object.fromEntries(Object.entries(value).filter(([,v])=>!Array.isArray(v)));
  // Full native captures are delivered as their original files, never copied into every tool reply.
  delete summary.snapshot;
  return { ...summary, counts:Object.fromEntries(Object.entries(arrays).map(([k,v])=>[k,v.length])),
    ...(view==='summary'?{}:{view,rows:page(arrays[view] ?? [],offset,limit)}) };
}
export function parseBuyerExpenseExport(bytes,exportId) {
  const v=parse(bytes);
  if(v.schema!==BUYER_EXPENSE_EXPORT_SCHEMA||v.exportId!==exportId||!Array.isArray(v.files)||v.files.length!==1||
     typeof v.workspaceId!=='string'||!Number.isSafeInteger(v.revision)||!['project','accountant','capture','issued-json','issued-html'].includes(v.kind))
    throw fail('MANIFEST','Use a complete original buyer expense export manifest.');
  const f=v.files[0];
  if(!['buyer-expense-project.zip','accountant-edition.zip','original-capture.json','issued-edition.json','issued-edition.html'].includes(f.name)||
     !Number.isSafeInteger(f.bytes)||f.bytes<1||f.bytes>MAX_BYTES||!new RegExp(sha.pattern).test(f.sha256))
    throw fail('MANIFEST','The retained export file identity is invalid.');
  return v;
}
async function syncDirectory(path){const h=await open(path,'r');try{await h.sync();}finally{await h.close();}}
async function publish(path,bytes) {
  const temporary=path+'.'+randomUUID()+'.pending';
  try {await writePrivate(temporary,bytes);await link(temporary,path);await unlink(temporary);await syncDirectory(dirname(path));}
  catch(error){await unlink(temporary).catch(()=>{});throw error;}
}
function exited(child){return new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)resolve({code:child.exitCode,signal:child.signalCode});else child.once('exit',(code,signal)=>resolve({code,signal}));});}
async function awaitExit(session,timeout=35000) {
  let timer;try{return await Promise.race([session.exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail('SHUTDOWN_PENDING','The original server is still completing its owned shutdown.')),timeout);})]);}
  finally{clearTimeout(timer);}
}
export class MerchantBuyerExpenses {
  #config;#root;#sessions=new Map();#lanes=new Map();#active=new Set();#closing=false;#close;#reads=new RetainedFileReads({errorPrefix:'BUYER_EXPENSE'});
  constructor(config){this.#config=config.buyerExpenses;this.#root=join(config.exportsDirectory,'buyer-expenses');}
  get summary(){return {configured:Boolean(this.#config),workspaces:Object.keys(this.#config?.workspaces ?? {}),open:[...this.#sessions].map(([workspace,s])=>({workspace,instanceId:s.instanceId,workspaceId:s.workspaceId,closing:s.closing})),...this.#reads.summary};}
  #selection(name){identifier(name);const value=this.#config?.workspaces[name];if(!value)throw fail('WORKSPACE','Choose a host-declared expense workspace alias.');return value;}
  #session(name){this.#selection(name);const s=this.#sessions.get(name);if(!s||s.closing||s.child.exitCode!==null||s.child.signalCode!==null)throw fail('NOT_OPEN','Explicitly open this original expense workspace before operating it.');return s;}
  async #bytes(s,path,body) {
    if(s.closing)throw fail('CLOSING','The original expense instance is closing.');
    const task=(async()=>{
      const response=await fetch(s.origin+path,{method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(120000),
        headers:{authorization:'Bearer '+s.token,origin:s.origin,...(body===undefined?{}:{'content-type':'application/json'})},
        ...(body===undefined?{}:{body:JSON.stringify(body)})});
      const pieces=[];let size=0;
      for await(const chunk of response.body){size+=chunk.length;if(size>MAX_BYTES)throw fail('REPLY_SIZE','Export the original retained data within the 256 MB source limit.');pieces.push(chunk);}
      const bytes=Buffer.concat(pieces,size);
      if(!response.ok){const error=parse(bytes)?.error;throw failure(typeof error?.code==='string'?error.code:'BUYER_EXPENSE_HTTP_'+response.status,typeof error?.message==='string'?error.message:'The original expense operation failed.');}
      return bytes;
    })();s.active.add(task);try{return await task;}finally{s.active.delete(task);}
  }
  async #get(s,path){return parse(await this.#bytes(s,path));}
  async #open(name) {
    const selection=this.#selection(name);let existing=this.#sessions.get(name);
    if(existing?.closing){await this.#closeOne(name,existing.instanceId);existing=this.#sessions.get(name);}
    if(existing&&existing.child.exitCode===null&&existing.child.signalCode===null)return {workspace:name,instanceId:existing.instanceId,workspaceId:existing.workspaceId,...compactReport(await this.#get(existing,'/api/state'))};
    if(existing)this.#sessions.delete(name);
    const child=spawn(selection.python,['-B',SERVER,'--state',selection.directory,'--port','0'],{stdio:['ignore','pipe','pipe'],shell:false});
    const session={child,exited:exited(child),instanceId:randomUUID(),active:new Set(),closing:false};
    child.stderr.on('data',()=>{});let output='',timer;
    try {
      const ready=await new Promise((resolveReady,reject)=>{
        timer=setTimeout(()=>reject(fail('START_TIMEOUT','The original expense server did not publish its ready address.')),30000);
        child.once('error',()=>reject(fail('START_FAILED','The configured Python interpreter could not start the original expense application.')));
        child.once('exit',()=>reject(fail('START_FAILED','The original expense application exited before readiness. Check its retained directory and lease.')));
        child.stdout.on('data',chunk=>{
          output+=chunk.toString('utf8');
          if(output.length>16384){reject(fail('START_PROTOCOL','The original expense server returned an oversized readiness record.'));return;}
          const end=output.indexOf('\n');
          if(end>=0){try{resolveReady(JSON.parse(output.slice(0,end)));}catch{reject(fail('START_PROTOCOL','The original expense server returned invalid readiness JSON.'));}}
        });
      });
      const url=new URL(ready.url);
      if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.username||url.password||url.search||url.pathname!=='/'||url.hash.length<25||ready.state!==await realpath(selection.directory))
        throw fail('START_PROTOCOL','The original ready address does not match this selected private expense directory.');
      session.origin=url.origin;session.token=url.hash.slice(1);
      const state=await this.#get(session,'/api/state');session.workspaceId=state.id;
      await this.#get(session,'/api/requests?limit=1');
      this.#sessions.set(name,session);
      return {workspace:name,instanceId:session.instanceId,workspaceId:state.id,revision:state.revision,opened:true};
    }catch(error){child.kill('SIGTERM');await awaitExit(session,5000).catch(()=>{child.kill('SIGKILL');});throw error;}
    finally{clearTimeout(timer);}
  }
  async #closeOne(name,instanceId) {
    const s=this.#sessions.get(name);
    if(!s||s.instanceId!==instanceId)throw fail('INSTANCE','Select the exact expense-server instance owned by this MCP host.');
    // Calls for this alias reach close only after all previously admitted chains.
    // A timed-out close remains tracked; the same close/open can await its real exit.
    const firstClose=!s.closing;s.closing=true;await Promise.allSettled([...s.active]);
    if(firstClose)s.child.kill('SIGTERM');const outcome=await awaitExit(s);this.#sessions.delete(name);
    if(outcome.code!==0)throw fail('SHUTDOWN_FAILED','The original expense server did not complete a normal shutdown.');
    return {workspace:name,instanceId,closed:true};
  }
  async #sourceAllowed(s,selection,sourceId) {
    const source=(await this.#get(s,'/api/state')).sources.find(v=>v.id===sourceId);
    if(!source||!Object.values(selection.ledgers).some(v=>v.path===source.path))throw fail('LEDGER_NOT_DECLARED','The host must declare this registered original ledger before a new capture.');
  }
  async #mutate(s,args,path,payload={}) {
    if(!new RegExp(request.pattern).test(args.requestId)||!Number.isSafeInteger(args.expectedRevision)||args.expectedRevision<0)throw fail('REQUEST','Retain the exact requestId and reviewed whole revision.');
    return compactResponse(parse(await this.#bytes(s,path,{request_id:args.requestId,expected_revision:args.expectedRevision,payload})));
  }
  async #rootReady(){try{await mkdir(this.#root,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}await privateSupportDirectory(this.#root);return this.#root;}
  async #exportStatus(id) {
    identifier(id);const directory=join(await this.#rootReady(),id);
    await privateSupportDirectory(directory);
    const request=parse(await privateBytes(join(directory,'request.json'),65536));
    let bytes;try{bytes=await privateBytes(join(directory,BUYER_EXPENSE_MANIFEST),65536);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(!bytes)return {exportId:id,state:'PREPARING',request};
    const manifest=parseBuyerExpenseExport(bytes,id);
    return {exportId:id,state:'COMPLETE',request,manifest,manifestSha256:hash(bytes),manifestFile:{name:BUYER_EXPENSE_MANIFEST,bytes:bytes.length,sha256:hash(bytes)}};
  }
  async #export(args,s) {
    const state=await this.#get(s,'/api/state'),id=identifier(args.exportId);
    if(args.kind==='project'&&(!Number.isSafeInteger(args.expectedRevision)||args.expectedRevision<0))throw fail('REVISION','A complete project requires its reviewed native workspace revision.');
    if(args.kind!=='project')checkId(args.recordId);
    const req={workspace:args.workspace,workspaceId:state.id,kind:args.kind,recordId:args.recordId ?? null,expectedRevision:args.expectedRevision ?? null};
    const directory=join(await this.#rootReady(),id);
    try{await mkdir(directory,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
    await privateSupportDirectory(directory);const lease=await acquireStateLease(directory);
    try {
      let saved;try{saved=parse(await privateBytes(join(directory,'request.json'),65536));}catch(error){if(error.code!=='ENOENT')throw error;}
      if(saved&&hash(json(saved))!==hash(json(req)))throw fail('EXPORT_CONFLICT','This exportId names a different original selection. Inspect it before preparing another.');
      if(!saved)await publish(join(directory,'request.json'),json(req));
      let status=await this.#exportStatus(id);if(status.state==='COMPLETE')return status;
      const payloadDirectory=join(directory,'payload');
      let descriptor;
      try{descriptor=parse(await privateBytes(join(payloadDirectory,'file.json'),65536));}catch(error){if(error.code!=='ENOENT')throw error;}
      if(!descriptor){
        const recordPath=args.kind==='project'?'unused':part(args.recordId);
        const routes={project:['/api/complete-project?expected_revision='+args.expectedRevision,'buyer-expense-project.zip','application/zip'],
          accountant:['/api/closes/'+recordPath+'/packet','accountant-edition.zip','application/zip'],
          capture:['/api/captures/'+recordPath+'/original','original-capture.json','application/json'],
          'issued-json':['/api/closes/'+recordPath,'issued-edition.json','application/json'],
          'issued-html':['/api/closes/'+recordPath+'/html','issued-edition.html','text/html']};
        const chosen=routes[args.kind];if(!chosen)throw fail('EXPORT_KIND','Select one of the original export forms.');
        const bytes=await this.#bytes(s,chosen[0]);descriptor={name:chosen[1],contentType:chosen[2],bytes:bytes.length,sha256:hash(bytes),revision:args.kind==='project'?args.expectedRevision:state.revision,createdAt:new Date().toISOString()};
        const stage=join(directory,'payload-'+randomUUID()+'.pending');await mkdir(stage,{mode:0o700});
        try{await writePrivate(join(stage,descriptor.name),bytes);await writePrivate(join(stage,'file.json'),descriptor);await syncDirectory(stage);lease.assertHeld();await rename(stage,payloadDirectory);await syncDirectory(directory);}
        catch(error){await rm(stage,{recursive:true,force:true});throw error;}
      }
      const manifest={schema:BUYER_EXPENSE_EXPORT_SCHEMA,exportId:id,workspace:args.workspace,workspaceId:state.id,kind:args.kind,recordId:req.recordId,revision:descriptor.revision,createdAt:descriptor.createdAt,files:[{name:descriptor.name,bytes:descriptor.bytes,sha256:descriptor.sha256,contentType:descriptor.contentType}]};
      const bytes=json(manifest);parseBuyerExpenseExport(bytes,id);lease.assertHeld();await publish(join(directory,BUYER_EXPENSE_MANIFEST),bytes);
      return this.#exportStatus(id);
    }finally{await lease.close();}
  }
  async #file(args) {
    const status=await this.#exportStatus(args.exportId);
    if(status.state!=='COMPLETE'||status.manifestSha256!==args.expectedManifestSha256)throw fail('EXPORT_CHANGED','Use the exact completed export manifest SHA256.');
    const manifestFile=args.file===BUYER_EXPENSE_MANIFEST;
    const metadata=manifestFile?status.manifestFile:status.manifest.files.find(v=>v.name===args.file);
    if(!metadata)throw fail('FILE','Select an original file from the completed manifest.');
    const directory=join(this.#root,args.exportId),path=manifestFile?join(directory,BUYER_EXPENSE_MANIFEST):join(directory,'payload',metadata.name);
    const result=await this.#reads.read({scope:args.exportId,key:args.file,kind:'buyer-expense-export',directory,
      readId:args.readId,expectedSha256:args.expectedSha256,offset:args.offset,limit:args.limit,
      load:async()=>{const bytes=await privateBytes(path);if(bytes.length!==metadata.bytes||hash(bytes)!==metadata.sha256)throw fail('FILE_CHANGED','The retained original export file changed.');return {bytes,name:metadata.name,type:metadata.contentType};}});
    return {exportId:args.exportId,manifestSha256:status.manifestSha256,...result};
  }
  async #execute(name,args) {
    const action=name.slice(PREFIX.length);
    if(action==='workspaces')return {workspaces:Object.entries(this.#config?.workspaces ?? {}).map(([workspace,s])=>({workspace,ledgers:Object.entries(s.ledgers).map(([alias,v])=>({alias,name:v.name,provenance:v.provenance})),open:this.#sessions.has(workspace)})),...this.summary};
    if(action==='exports'){const root=await this.#rootReady(),names=(await readdir(root)).filter(v=>/^[a-z0-9][a-z0-9_-]{0,63}$/.test(v)).sort();const selected=page(names,args.offset,args.limit);return {...selected,items:await Promise.all(selected.items.map(id=>this.#exportStatus(id)))};}
    if(action==='export_status')return this.#exportStatus(args.exportId);
    if(action==='manifest'){const s=await this.#exportStatus(args.exportId);if(s.state!=='COMPLETE')throw fail('EXPORT_PENDING','Resume the retained original export request.');return {exportId:args.exportId,state:'MANIFEST_RETAINED',manifestFile:s.manifestFile};}
    if(action==='file')return this.#file(args);
    if(action==='file_release'){await this.#reads.release(args.exportId,args.readId);return {exportId:args.exportId,readId:args.readId,released:true};}
    if(action==='open')return this.#open(args.workspace);
    if(action==='close')return this.#closeOne(args.workspace,args.instanceId);
    const selection=this.#selection(args.workspace),s=this.#session(args.workspace),query=new URLSearchParams();
    for(const key of ['offset','limit'])if(args[key]!==undefined)query.set(key,String(args[key]));
    const suffix=query.size?'?'+query:'';
    const get=path=>this.#get(s,path);
    switch(action){
      case 'state':{const value=await get('/api/state'),view=args.view??'summary';return {workspace:args.workspace,instanceId:s.instanceId,...compactReport(value,view,args.offset,args.limit)};}
      case 'items':if(args.query!==undefined)query.set('q',args.query);if(args.sourceId)query.set('source',args.sourceId);if(args.status)query.set('status',args.status);return get('/api/expenses?'+query);
      case 'item':{const value=await get('/api/items/'+part(args.id));const history=value.coding_history;delete value.coding_history;return args.view==='history'?{id:value.id,basis:value.basis,history:page(history,args.offset,args.limit)}:{...value,coding_editions:history.length};}
      case 'captures':return get('/api/sources/'+part(args.sourceId)+'/captures'+suffix);
      case 'capture_status':return get('/api/captures/'+part(args.id)+suffix);
      case 'ledger_register':{const ledger=selection.ledgers[identifier(args.ledger)];if(!ledger)throw fail('LEDGER_NOT_DECLARED','Select a host-declared original ledger.');return this.#mutate(s,args,'/api/sources',{path:ledger.path,name:args.name??ledger.name,provenance:args.provenance??ledger.provenance});}
      case 'capture':await this.#sourceAllowed(s,selection,args.sourceId);return this.#mutate(s,args,'/api/sources/'+part(args.sourceId)+'/capture');
      case 'source_rebind':{const ledger=selection.ledgers[identifier(args.ledger)];if(!ledger)throw fail('LEDGER_NOT_DECLARED','Select a host-declared original ledger.');return this.#mutate(s,args,'/api/sources/'+part(args.sourceId)+'/rebind',{path:ledger.path,operator:args.operator,reason:args.reason});}
      case 'capture_review':return this.#mutate(s,args,'/api/captures/'+part(args.id)+'/decision',{decision:args.decision,operator:args.operator,reason:args.reason});
      case 'center_save':return this.#mutate(s,args,'/api/centers',args.payload);
      case 'labels_save':return this.#mutate(s,args,'/api/labels',args.payload);
      case 'period_save':return this.#mutate(s,args,'/api/periods',args.payload);
      case 'coding_save':return this.#mutate(s,args,'/api/items/'+part(args.id)+'/coding',args.payload);
      case 'disposition':return this.#mutate(s,args,'/api/periods/'+part(args.periodId)+'/disposition',args.payload);
      case 'period_report':return compactReport(await get('/api/periods/'+part(args.id)+'/report'),args.view,args.offset,args.limit);
      case 'period_review':return this.#mutate(s,args,'/api/periods/'+part(args.id)+'/review',{reviewer:args.reviewer,role:args.role,notes:args.notes});
      case 'period_close':return this.#mutate(s,args,'/api/periods/'+part(args.id)+'/close',{review_id:args.reviewId});
      case 'period_reopen':return this.#mutate(s,args,'/api/periods/'+part(args.id)+'/reopen',{operator:args.operator,reason:args.reason});
      case 'history':return get((args.kind==='period'?'/api/periods/'+part(args.periodId)+'/history':args.kind==='requests'?'/api/requests':'/api/activity')+suffix);
      case 'review':{const v=await get('/api/reviews/'+part(args.id));return {...v,snapshot:compactReport(v.snapshot,args.view,args.offset,args.limit)};}
      case 'issued':return compactReport(await get('/api/closes/'+part(args.id)),args.view,args.offset,args.limit);
      case 'request':{const value=await get('/api/requests/'+part(args.requestId));return {...value,response:compactResponse(value.response)};}
      case 'export':return this.#export(args,s);
      default:throw fail('TOOL','Choose an original buyer expense operation.');
    }
  }
  async call(name,args={}) {
    if(this.#closing)throw fail('CLOSING','The buyer expense provider is closing.');
    const action=name.slice(PREFIX.length),definition=BUYER_EXPENSE_ACTIONS[action];
    if(!name.startsWith(PREFIX)||!definition)throw fail('TOOL','Choose an original buyer expense operation.');
    validateBuyerExpenseArguments(action,args);
    // Serialize the complete native call chain for each workspace, including
    // startup, source checks, export commits and shutdown. Other aliases and
    // immutable export reads remain independent.
    const alias=args.workspace;
    const task=alias===undefined?Promise.resolve().then(()=>this.#execute(name,args))
      :(this.#lanes.get(alias)??Promise.resolve()).catch(()=>{}).then(()=>this.#execute(name,args));
    if(alias!==undefined)this.#lanes.set(alias,task);
    this.#active.add(task);
    try{return await task;}finally{this.#active.delete(task);if(alias!==undefined&&this.#lanes.get(alias)===task)this.#lanes.delete(alias);}
  }
  close() {
    if(!this.#close){this.#closing=true;this.#close=(async()=>{await Promise.allSettled([...this.#active]);
      const results=await Promise.allSettled([...this.#sessions].map(([name,s])=>this.#closeOne(name,s.instanceId)));
      await this.#reads.close();if(results.some(v=>v.status==='rejected'))throw fail('SHUTDOWN_FAILED','One original expense workspace did not complete shutdown.');})();}
    return this.#close;
  }
}
