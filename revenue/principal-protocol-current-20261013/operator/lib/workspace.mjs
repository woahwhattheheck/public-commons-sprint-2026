// MIT. One durable Principal workspace; exact local commands precede native work.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {uuid,hash,bytes,clone,need,object,keys,canonical,identity,text,address,sha,decode64,jsonInput} from './value.mjs';
import {directory,lease,writeExact,fileDescriptor,confined,syncDirectory} from './files.mjs';
import {catalogue,makeCatalogue,API,API_SHA256,action,parameters,invocation} from './catalogue.mjs';
import {parseSourceJSON} from './source-json.mjs';
import {runNative} from './native.mjs';
import {captureEvents,eventIndex,eventSelection,validateEventCapture} from './rpc-events.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const PORTABLE_SCHEMA='principal.current-workspace.v1';
export const MAX_PACKET=768*1024*1024,MAX_OBJECT=128*1024*1024,MAX_OBJECTS=512*1024*1024;
const stamp=()=>new Date().toISOString();
function normalizeConfig(input){
 need(object(input),'CONFIG_REQUIRED');const c=clone(input);
 const allowed=['name','network','sourceAccount','stellar','contracts','executionEnabled'];keys(c,allowed,[]);
 c.name=c.name??'Principal workspace';text(c.name,500);c.executionEnabled=c.executionEnabled===true;
 if(c.network){keys(c.network,['rpcUrl','passphrase'],[]);if(c.network.rpcUrl){const u=new URL(c.network.rpcUrl);need(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.hash,'RPC_URL_REQUIRED');}if(c.network.passphrase)text(c.network.passphrase);}
 if(c.sourceAccount){keys(c.sourceAccount,['alias','address'],[]);if(c.sourceAccount.alias)need(/^[a-zA-Z0-9_-]{1,100}$/.test(c.sourceAccount.alias),'SIGNER_ALIAS_REQUIRED');if(c.sourceAccount.address)address(c.sourceAccount.address);}
 if(c.stellar){keys(c.stellar,['executable','sha256','version','configDirectory','python'],[]);for(const k of ['executable','configDirectory','python'])if(c.stellar[k])need(path.isAbsolute(c.stellar[k])&&!c.stellar[k].includes('\0'),'ABSOLUTE_RUNTIME_PATH_REQUIRED');if(c.stellar.sha256)sha(c.stellar.sha256);if(c.stellar.version)text(c.stellar.version,500);}
 if(c.contracts){keys(c.contracts,Object.keys(API.contracts),[]);for(const v of Object.values(c.contracts)){keys(v,['id','wasmSha256'],[]);if(v.id){address(v.id);need(v.id.startsWith('C'),'CONTRACT_ADDRESS_REQUIRED');}if(v.wasmSha256)sha(v.wasmSha256);}}
 return c;
}
function validateEnvelope(e){keys(e,['requestId','expectedRevision','method','args']);need(typeof e.requestId==='string'&&/^[a-zA-Z0-9._:-]{1,200}$/.test(e.requestId),'REQUEST_ID_REQUIRED');need(Number.isSafeInteger(e.expectedRevision)&&e.expectedRevision>=0,'REVISION_REQUIRED');text(e.method,100);need(object(e.args),'ARGS_REQUIRED');canonical(e);return e;}
function publicFailure(error){return{code:error.code??'OPERATION_FAILED',message:String(error.message??error),details:object(error.details)?error.details:{}};}
export async function openWorkspace({directory:root,name='Principal workspace',sourceDirectory=ROOT}){
 const [nodeMajor,nodeMinor]=process.versions.node.split('.').map(Number);need(nodeMajor>22||(nodeMajor===22&&nodeMinor>=16),'NODE_22_16_REQUIRED');need(process.platform==='linux','LINUX_OPERATOR_REQUIRED');await directory(root);
 const guard=await lease(root,'workspace');let db;
 try{
  const database=path.join(root,'principal.sqlite');try{const st=await fs.lstat(database);need(st.isFile()&&!st.isSymbolicLink(),'ORDINARY_DATABASE_REQUIRED');}catch(e){if(e.code!=='ENOENT')throw e;}
  db=new DatabaseSync(path.join(root,'principal.sqlite'));db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  db.exec('CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL);CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,intent TEXT NOT NULL,body TEXT NOT NULL);CREATE TABLE IF NOT EXISTS objects(id TEXT PRIMARY KEY,descriptor TEXT NOT NULL,data BLOB NOT NULL);');
  if(!db.prepare('SELECT 1 FROM state').get())db.prepare('INSERT INTO state VALUES(1,?)').run(canonical({workspace:{id:uuid(),name,revision:0,createdAt:stamp()},config:{name,executionEnabled:false},catalogue:clone(catalogue),apiSha256:API_SHA256,observations:[],eventPages:[],plans:[],notes:[],files:[],exports:[],history:[],receivedFrom:null}));
  need(JSON.parse(db.prepare('SELECT body FROM state WHERE id=1').get().body).apiSha256===API_SHA256,'CONTRACT_SOURCE_EDITION_CHANGED');
  await syncDirectory(root);return new Workspace(root,db,guard,sourceDirectory);
 }catch(e){if(db)db.close();await guard.release();throw e;}
}
class Workspace{
 constructor(root,db,guard,sourceDirectory){this.directory=root;this.db=db;this.guard=guard;this.sourceDirectory=sourceDirectory;this.tail=Promise.resolve();this.closing=false;this.abort=new AbortController();}
 serial(fn){need(!this.closing,'WORKSPACE_CLOSING');const work=this.tail.then(fn,fn);this.tail=work.catch(()=>{});return work;}
 read(){return JSON.parse(this.db.prepare('SELECT body FROM state WHERE id=1').get().body);}
 rows(){return this.db.prepare('SELECT body FROM requests ORDER BY rowid').all().map(r=>JSON.parse(r.body));}
 state(){const s=this.read();s.requests=this.rows();s.events=eventIndex(s.eventPages);for(const p of s.plans){const runs=s.requests.filter(r=>r.envelope.method==='plan.execute'&&r.envelope.args.planId===p.id);p.status=runs.length?(runs.at(-1).status==='COMPLETE'?runs.at(-1).response.result.status:runs.at(-1).status):'PREPARED';}return s;}
 bootstrap(){const s=this.read();return{workspace:s.workspace,config:s.config,catalogue:clone(catalogue),capabilities:{portable:true,sourceImport:true,eventCapture:true,eventCoverage:'SELECTED_RPC_PAGE',sourceEdition:API.edition,simulation:true,executionEnabled:s.config.executionEnabled===true,requestReplay:true,apiSha256:API_SHA256}};}
 request(id){const r=this.db.prepare('SELECT body FROM requests WHERE id=?').get(id);need(r,'REQUEST_NOT_FOUND');return JSON.parse(r.body);}
 object(id){const r=this.db.prepare('SELECT descriptor,data FROM objects WHERE id=?').get(id);need(r,'FILE_NOT_FOUND');const d=JSON.parse(r.descriptor),b=Buffer.from(r.data);need(hash(b)===d.sha256&&b.length===d.bytes,'OBJECT_CHANGED');return{descriptor:d,data:b};}
 insertObject(name,type,data){
  const b=Buffer.from(data);need(b.length<=MAX_OBJECT,'OBJECT_TOO_LARGE');const digest=hash(b),id='file-'+digest;
  const old=this.db.prepare('SELECT descriptor FROM objects WHERE id=?').get(id);if(old)return JSON.parse(old.descriptor);
  const total=Number(this.db.prepare('SELECT coalesce(sum(length(data)),0) AS n FROM objects').get().n);need(total+b.length<=MAX_OBJECTS,'WORKSPACE_OBJECT_CAPACITY');
  const descriptor={id,name:text(name,1000),type:text(type||'application/octet-stream',200),bytes:b.length,sha256:digest,createdAt:stamp()};
  this.db.prepare('INSERT INTO objects VALUES(?,?,?)').run(id,canonical(descriptor),b);return descriptor;
 }
 commit(request,state,result){
  need(this.read().workspace.revision===request.envelope.expectedRevision,'REVISION_CONFLICT',{expected:request.envelope.expectedRevision,current:this.read().workspace.revision});
  state.workspace.revision++;state.workspace.name=state.config.name??state.workspace.name;
  const response={workspaceId:state.workspace.id,requestId:request.id,revision:state.workspace.revision,result:clone(result)};
  const final={...request,status:'COMPLETE',completedAt:stamp(),response,error:null};
  state.history.push({requestId:request.id,method:request.envelope.method,revision:state.workspace.revision,intentSha256:request.intentSha256,resultSha256:identity(result),previous:state.history.at(-1)?.sha256??null});
  const h=state.history.at(-1);h.sha256=identity(h);
  this.db.prepare('UPDATE state SET body=? WHERE id=1').run(canonical(state));
  this.db.prepare('UPDATE requests SET body=? WHERE id=?').run(canonical(final),request.id);
  return response;
 }
 async command(envelope){const frozen=JSON.parse(canonical(envelope));validateEnvelope(frozen);return this.serial(()=>this.perform(frozen));}
 async perform(e){
  const intent=identity(e),existing=this.db.prepare('SELECT intent,body FROM requests WHERE id=?').get(e.requestId);
  let request;if(existing){need(existing.intent===intent,'REQUEST_ID_CONFLICT');request=JSON.parse(existing.body);if(request.status==='COMPLETE')return request.response;if(request.status==='FAILED')throw Object.assign(new Error(request.error.message),request.error);need(!request.receivedPending,'ORIGINAL_NATIVE_OWNER_REQUIRED',{requestId:request.id});}
  const state=this.read();need(state.apiSha256===API_SHA256,'CONTRACT_SOURCE_EDITION_CHANGED');
  if(!request){
   need(state.workspace.revision===e.expectedRevision,'REVISION_CONFLICT',{expected:e.expectedRevision,current:state.workspace.revision});
   const pending=this.rows().find(r=>['RUNNING','UNCERTAIN'].includes(r.status));need(!pending,'ORIGINAL_REQUEST_UNRESOLVED',{requestId:pending?.id});
   request={id:e.requestId,intentSha256:intent,envelope:e,status:'RUNNING',createdAt:stamp(),response:null,error:null};
   this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(e.requestId,intent,canonical(request));
  }
  let nativeStarted=false;
  try{
   let native=null,plan=null,eventCapture=null;
   if(e.method==='event.capture'){
    // An admitted HTTP attempt is recovered by its original immutable receipt;
    // interruption never transparently repeats a source read.
    eventSelection(state.config,e.args,state.eventPages.find(p=>p.id===e.args.previousPageId));
    nativeStarted=true;eventCapture=await captureEvents(this.directory,request.id,state.config,e.args,state.eventPages.find(p=>p.id===e.args.previousPageId),{signal:this.abort.signal});
   }
   if(['plan.simulate','plan.execute','observation.capture'].includes(e.method)){
    if(e.method==='observation.capture'){
     keys(e.args,['actionId','parameters']);need(action(e.args.actionId).readOnly,'READ_ONLY_ACTION_REQUIRED');
     plan=this.prepare(state,e.args,request.id);
    }else{keys(e.args,['planId']);plan=state.plans.find(p=>p.id===e.args.planId);need(plan,'PLAN_NOT_FOUND');const accepted=this.request(plan.id.slice(5));need(accepted.status==='COMPLETE'&&accepted.envelope.method==='plan.prepare'&&identity(accepted.response.result)===identity(plan),'ORIGINAL_PLAN_CHANGED');checkPlan(plan,accepted,API);}
    if(e.method==='plan.execute'){
     need(!plan.selection.action.readOnly,'READ_ONLY_USE_CAPTURE');
     need(state.config.executionEnabled===true&&identity(state.config)===identity(plan.config),'EXPLICIT_CURRENT_EXECUTION_CONFIGURATION_REQUIRED');
     need(!this.rows().some(r=>r.id!==e.requestId&&r.envelope.method==='plan.execute'&&r.envelope.args.planId===plan.id),'PLAN_ALREADY_INVOKED');
    }
    nativeStarted=true;native=await runNative(this.directory,request.id,plan,e.method==='plan.execute'?'execute':'simulate',plan.config,{signal:this.abort.signal});
   }
   this.db.exec('BEGIN IMMEDIATE');
   try{
    let result;
    if(eventCapture){
     const sources=eventCapture.files.map(f=>({path:f.path,descriptor:this.insertObject(f.path,'application/octet-stream',f.data)}));
     for(const {descriptor:f}of sources)if(!state.files.some(old=>old.id===f.id))state.files.push(f);
     const page={...eventCapture.page,configuration:clone(state.config),apiSha256:API_SHA256,sourceFiles:sources.map(({path,descriptor:f})=>({path,id:f.id,bytes:f.bytes,sha256:f.sha256})),sourceFileIds:[...new Set(sources.map(s=>s.descriptor.id))]};
     state.eventPages.push(page);result=page;
    }else if(native){
     const sources=native.files.map(f=>this.insertObject(f.path,'application/octet-stream',f.data));
     for(const f of sources)if(!state.files.some(old=>old.id===f.id))state.files.push(f);
     const stdout=native.files.find(f=>f.path===native.result.invocation.stdout),stderr=native.files.find(f=>f.path===native.result.invocation.stderr);
     let value=null,numberTokens={},parseError=null;if(stdout)try{const parsed=parseSourceJSON(stdout.data,{maxBytes:MAX_OBJECT});value=parsed.value;numberTokens=parsed.numberTokens;}catch(error){parseError=publicFailure(error);}
     const observation={id:'observation-'+request.id,actionId:plan.actionId,contractId:plan.selection.contract.id,createdAt:stamp(),mode:e.method==='plan.execute'?'invocation':'simulation',planId:plan.id,parameters:plan.parameters,configuration:plan.config,binding:{network:clone(plan.config.network),contractId:plan.selection.contract.id,contractKey:plan.selection.action.contract,wasmSha256:plan.selection.contract.wasmSha256,apiSha256:API_SHA256},apiSha256:API_SHA256,
      status:native.result.invocation.returncode===0?'CLI_EXIT_0':native.result.invocation.started?(native.result.invocation.returncode===null?'UNKNOWN':'CLI_NONZERO'):'NOT_INVOKED',
      value,numberTokens,parseError,sourceFiles:native.files.map((f,i)=>({path:f.path,id:sources[i].id,bytes:f.bytes,sha256:f.sha256})),sourceFileIds:sources.map(f=>f.id),stdoutFileId:stdout?sources.find(s=>s.sha256===stdout.sha256)?.id:null,stderrFileId:stderr?sources.find(s=>s.sha256===stderr.sha256)?.id:null,native:parseSourceJSON(bytes(native.result),{maxBytes:MAX_OBJECT}).value};
     state.observations.push(observation);result=observation;
    }else if(e.method==='config.save'){keys(e.args,['config']);state.config=normalizeConfig(e.args.config);result={config:state.config};}
    else if(e.method==='source.import'){
     keys(e.args,['name','type','contentBase64','bytes','sha256']);need(Number.isSafeInteger(e.args.bytes)&&e.args.bytes>=0&&e.args.bytes<=32*1024*1024,'SOURCE_SIZE');const data=decode64(e.args.contentBase64);need(data.length===e.args.bytes&&hash(data)===sha(e.args.sha256),'SOURCE_IDENTITY_MISMATCH');
     const f=this.insertObject(e.args.name,e.args.type,data);if(!state.files.some(old=>old.id===f.id))state.files.push(f);result=f;
    }else if(e.method==='plan.prepare'){keys(e.args,['actionId','parameters']);const p=this.prepare(state,e.args,request.id);state.plans.push(p);result=p;}
    else if(e.method==='note.save'){keys(e.args,['subjectId','title','body']);const note={id:'note-'+request.id,subjectId:text(e.args.subjectId),title:text(e.args.title,500),body:text(e.args.body,1024*1024),createdAt:stamp()};state.notes.push(note);result=note;}
    else if(e.method==='workspace.inspect'){keys(e.args,['packet']);result=inspectPacket(e.args.packet);}
    else throw Object.assign(new Error('UNKNOWN_COMMAND'),{code:'UNKNOWN_COMMAND'});
    const response=this.commit(request,state,result);this.db.exec('COMMIT');return response;
   }catch(error){this.db.exec('ROLLBACK');throw error;}
  }catch(error){
   const accepted=this.db.prepare('SELECT body FROM requests WHERE id=?').get(request.id);if(accepted){const row=JSON.parse(accepted.body);if(row.status==='COMPLETE')return row.response;}
   const unresolved=nativeStarted||error.code==='NATIVE_OUTCOME_UNRESOLVED';request={...request,status:unresolved?'UNCERTAIN':'FAILED',error:publicFailure(error),observedAt:stamp()};
   this.db.prepare('UPDATE requests SET body=? WHERE id=?').run(canonical(request),request.id);throw error;
  }
 }
 prepare(state,args,requestId){
  const config=normalizeConfig(state.config);need(config.stellar?.executable&&config.stellar.sha256&&config.stellar.version&&config.stellar.python,'STELLAR_RUNTIME_BINDING_REQUIRED');
  const selected=invocation(config,args.actionId,args.parameters,false),send=invocation(config,args.actionId,args.parameters,true);
  return{id:'plan-'+requestId,actionId:args.actionId,contractId:selected.contract.id,parameters:parameters(args.actionId,args.parameters),config:clone(config),selection:selected,executeArgv:send.argv,status:'PREPARED',createdAt:stamp(),sourceSha256:identity({config,selected,executeArgv:send.argv})};
 }
 async portable(){return this.serial(async()=>{
  const state=this.read(),requests=this.rows(),objects=this.db.prepare('SELECT descriptor,data FROM objects ORDER BY id').all().map(r=>({descriptor:JSON.parse(r.descriptor),contentBase64:Buffer.from(r.data).toString('base64')}));
  const manifest=JSON.parse(await fs.readFile(path.join(this.sourceDirectory,'source-files.json'),'utf8'));
  const application=[];for(const member of [...manifest.files,{path:'source-files.json'}]){
   const file=await confined(this.sourceDirectory,member.path),data=await fs.readFile(file);if(member.sha256)need(hash(data)===member.sha256&&data.length===member.bytes,'APPLICATION_SOURCE_CHANGED');
   application.push({path:member.path,bytes:data.length,sha256:hash(data),contentBase64:data.toString('base64')});
  }
  const body={workspace:state,requests,objects,application,api:API,createdAt:stamp()};
  const packet={schema:PORTABLE_SCHEMA,sha256:identity(body),body};need(bytes(packet).length<=MAX_PACKET,'PORTABLE_CAPACITY');inspectPacket(packet);return packet;
 });}
 async close(){if(this.closed)return;this.closing=true;this.abort.abort();await this.tail;if(this.db){this.db.close();this.db=null;}await this.guard.release();this.closed=true;}
}

export function checkPlan(plan,request,api=API){
 need(plan.id==='plan-'+request.id&&plan.actionId===request.envelope.args.actionId&&identity(plan.parameters)===identity(request.envelope.args.parameters),'PLAN_REQUEST_CHANGED');
 const selected=invocation(plan.config,plan.actionId,plan.parameters,false,api),send=invocation(plan.config,plan.actionId,plan.parameters,true,api);
 need(identity(plan.selection)===identity(selected)&&identity(plan.executeArgv)===identity(send.argv)&&plan.contractId===selected.contract.id&&plan.status==='PREPARED'&&plan.sourceSha256===identity({config:plan.config,selected,executeArgv:send.argv}),'PLAN_BINDING_CHANGED');
}

export function checkObservation(result,request,selected,objects,api=API){
 const method=request.envelope.method,mode=method==='plan.execute'?'execute':'simulate';
 need(result.mode===(mode==='execute'?'invocation':'simulation')&&(method!=='observation.capture'||result.planId==='plan-'+request.id),'OBSERVATION_MODE_CHANGED');
 need(Array.isArray(result.sourceFiles)&&new Set(result.sourceFiles.map(f=>f.path)).size===result.sourceFiles.length,'OBSERVATION_SOURCE_ROSTER');
 const files=new Map();for(const f of result.sourceFiles){const row=objects.find(o=>o.descriptor.id===f.id);need(row&&row.descriptor.sha256===f.sha256&&row.descriptor.bytes===f.bytes&&typeof f.path==='string'&&!f.path.includes('/')&&!f.path.includes('\\'),'OBSERVATION_SOURCE_CHANGED');files.set(f.path,{...f,data:decode64(row.contentBase64)});}
 need(identity(result.sourceFileIds)===identity(result.sourceFiles.map(f=>f.id)),'OBSERVATION_SOURCE_SELECTION');
 const original=name=>{const f=files.get(name);need(f,'OBSERVATION_SOURCE_MISSING',{name});return f;};
 const terminal=original('result.json'),input=original('input.json'),native=parseSourceJSON(terminal.data,{maxBytes:MAX_OBJECT}).value,spec=jsonInput(new TextDecoder('utf8',{fatal:true}).decode(input.data));
 const originalTerminal=JSON.parse(terminal.data.toString('utf8'));need(typeof originalTerminal.invocation.started==='boolean'&&(originalTerminal.invocation.returncode===null||Number.isSafeInteger(originalTerminal.invocation.returncode)),'OBSERVATION_PROCESS_STATUS_CHANGED');
 need(identity(native)===identity(result.native)&&native.schema==='principal.native-result.v1'&&native.requestId===request.id&&native.planId===result.planId&&native.mode===mode&&native.lifetimes==='CLOSED'&&native.inputSha256===hash(input.data),'OBSERVATION_TERMINAL_CHANGED');
 need(spec.schema==='principal.native-attempt.v1'&&spec.requestId===request.id&&spec.planId===result.planId&&spec.mode===mode&&identity(spec.argv)===identity(selected.argv)&&identity(spec.network)===identity(result.configuration.network)&&identity(spec.contract)===identity(selected.contract)&&identity(spec.sourceAccount)===identity(result.configuration.sourceAccount)&&spec.configDirectory===result.configuration.stellar.configDirectory&&spec.executable===result.configuration.stellar.executable&&spec.executableSha256===result.configuration.stellar.sha256&&spec.expectedVersion===result.configuration.stellar.version,'OBSERVATION_INPUT_CHANGED');
 for(const [name,descriptor]of [['owner-source.py',spec.owner],['attempt-source.py',spec.script]]){const f=original(name);need(f.bytes===descriptor.bytes&&f.sha256===descriptor.sha256,'OBSERVATION_EXECUTING_SOURCE_CHANGED');}
 need(Array.isArray(native.files)&&new Set(native.files.map(f=>f.path)).size===native.files.length,'OBSERVATION_NATIVE_ROSTER');
 for(const f of native.files){const actual=original(f.path);need(actual.bytes===Number(f.bytes)&&actual.sha256===f.sha256,'OBSERVATION_NATIVE_FILE_CHANGED');}
 const allowed=new Set([...native.files.map(f=>f.path),'input.json','result.json','owner-source.py','attempt-source.py','controller-stderr.bin']);need([...files.keys()].every(p=>allowed.has(p)),'OBSERVATION_UNBOUND_FILE');
 need(identity(native.invocation.argv)===identity(selected.argv),'OBSERVATION_ARGV_CHANGED');
 const stdout=native.invocation.stdout?original(native.invocation.stdout):null,stderr=native.invocation.stderr?original(native.invocation.stderr):null;
 let value=null,numberTokens={},parseError=null;if(stdout)try{const parsed=parseSourceJSON(stdout.data,{maxBytes:MAX_OBJECT});value=parsed.value;numberTokens=parsed.numberTokens;}catch(error){parseError=publicFailure(error);}
 const status=native.invocation.returncode==='0'?'CLI_EXIT_0':native.invocation.started?(native.invocation.returncode===null?'UNKNOWN':'CLI_NONZERO'):'NOT_INVOKED';
 need(result.status===status&&identity(result.value)===identity(value)&&identity(result.numberTokens)===identity(numberTokens)&&identity(result.parseError)===identity(parseError)&&result.stdoutFileId===(stdout?.id??null)&&result.stderrFileId===(stderr?.id??null),'OBSERVATION_PROJECTION_CHANGED');
}

// API object keys may be canonically reordered in a retained command. Match the
// complete named catalogue without rewriting the original UI/argument order.
function catalogueIdentity(rows){
 need(Array.isArray(rows),'API_IDENTITY');const ids=new Set();
 const ordered=rows.map(row=>{
  need(object(row)&&typeof row.id==='string'&&!ids.has(row.id)&&Array.isArray(row.fields),'API_IDENTITY');ids.add(row.id);const names=new Set();
  const fields=row.fields.map(field=>{need(object(field)&&typeof field.name==='string'&&!names.has(field.name),'API_IDENTITY');names.add(field.name);return field;});
  fields.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);return{...row,fields};
 });
 ordered.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);return identity(ordered);
}

export function inspectPacket(packet){
 keys(packet,['schema','sha256','body']);need(packet.schema===PORTABLE_SCHEMA&&identity(packet.body)===packet.sha256,'PORTABLE_IDENTITY');const p=packet.body;keys(p,['workspace','requests','objects','application','api','createdAt']);
 need(object(p.workspace)&&object(p.workspace.workspace)&&Number.isSafeInteger(p.workspace.workspace.revision)&&p.workspace.workspace.revision>=0,'WORKSPACE_SHAPE');
 need(identity(p.api)===p.workspace.apiSha256&&catalogueIdentity(p.workspace.catalogue)===catalogueIdentity(makeCatalogue(p.api)),'API_IDENTITY');for(const k of ['plans','observations','eventPages','notes','files','exports','history'])need(Array.isArray(p.workspace[k]),'WORKSPACE_SHAPE',{k});
 need(Array.isArray(p.requests)&&Array.isArray(p.objects)&&Array.isArray(p.application),'PORTABLE_SHAPE');
 const objects=new Map();let total=0;for(const row of p.objects){keys(row,['descriptor','contentBase64']);const d=row.descriptor,b=decode64(row.contentBase64);need(d.id==='file-'+hash(b)&&d.sha256===hash(b)&&d.bytes===b.length&&b.length<=MAX_OBJECT&&!objects.has(d.id),'OBJECT_IDENTITY');objects.set(d.id,d);total+=b.length;}need(total<=MAX_OBJECTS,'WORKSPACE_OBJECT_CAPACITY');
 for(const f of p.workspace.files)need(objects.has(f.id)&&identity(objects.get(f.id))===identity(f),'FILE_REFERENCE_CHANGED');
 const ids=new Set();for(const r of p.requests){validateEnvelope(r.envelope);need(r.id===r.envelope.requestId&&r.intentSha256===identity(r.envelope)&&!ids.has(r.id),'REQUEST_IDENTITY');ids.add(r.id);need(['RUNNING','UNCERTAIN','FAILED','COMPLETE'].includes(r.status),'REQUEST_STATE');if(r.status==='COMPLETE')need(r.response?.workspaceId===p.workspace.workspace.id&&r.response.requestId===r.id&&Number.isSafeInteger(r.response.revision),'REQUEST_RESPONSE_IDENTITY');}
 const names=new Set();for(const f of p.application){need(typeof f.path==='string'&&!path.isAbsolute(f.path)&&f.path.split('/').every(v=>v&&v!=='.'&&v!=='..')&&!f.path.includes('\\')&&!names.has(f.path),'APPLICATION_PATH');names.add(f.path);const b=decode64(f.contentBase64);need(b.length===f.bytes&&hash(b)===f.sha256,'APPLICATION_IDENTITY');}
 need(names.has('source-files.json')&&names.has('CONTRACT_API.json')&&names.has('server.mjs')&&names.has('lib/workspace.mjs'),'APPLICATION_INCOMPLETE');
 const manifest=JSON.parse(decode64(p.application.find(f=>f.path==='source-files.json').contentBase64));need(Array.isArray(manifest.files)&&manifest.files.length+1===names.size&&new Set(manifest.files.map(f=>f.path)).size===manifest.files.length&&!manifest.files.some(f=>f.path==='source-files.json'),'APPLICATION_INCOMPLETE');const originalAPI=JSON.parse(decode64(p.application.find(f=>f.path==='CONTRACT_API.json').contentBase64));need(identity(originalAPI)===identity(p.api),'APPLICATION_API_CHANGED');for(const f of manifest.files){const actual=p.application.find(a=>a.path===f.path);need(actual&&actual.bytes===f.bytes&&actual.sha256===f.sha256,'APPLICATION_IDENTITY');}
 let previous=null;for(let i=0;i<p.workspace.history.length;i++){const row=p.workspace.history[i],{sha256,...selected}=row;const request=p.requests.find(r=>r.id===row.requestId);need(row.revision===i+1&&row.previous===previous&&identity(selected)===sha256&&request?.status==='COMPLETE'&&request.response.revision===row.revision&&identity(request.response.result)===row.resultSha256&&request.envelope.method===row.method&&request.intentSha256===row.intentSha256,'HISTORY_IDENTITY');previous=sha256;}need(p.workspace.history.length===p.workspace.workspace.revision,'HISTORY_REVISION');

 const historyConfig=(configuration,selected)=>{need(selected,'CONFIGURATION_HISTORY_REQUIRED');const received=clone(selected);received.executionEnabled=false;need(identity(configuration)===identity(selected)||(p.workspace.receivedFrom&&identity(configuration)===identity(received)),'CONFIGURATION_HISTORY_CHANGED');};
 const expected={plans:[],observations:[],eventPages:[],notes:[],files:[]};let selectedConfig=null;
 const addFile=id=>{const f=objects.get(id);need(f,'OBSERVATION_FILE_MISSING');if(!expected.files.some(old=>old.id===id))expected.files.push(f);};
 for(const event of p.workspace.history){
  const request=p.requests.find(r=>r.id===event.requestId),result=request.response.result,method=request.envelope.method;
  if(method==='event.capture'){
   need(result.id==='event-page-'+request.id&&result.apiSha256===p.workspace.apiSha256&&Array.isArray(result.sourceFiles)&&Array.isArray(result.sourceFileIds),'EVENT_REQUEST_CHANGED');
   const {configuration,apiSha256,sourceFiles,sourceFileIds,...page}=result;
   historyConfig(configuration,selectedConfig);
   const source=sourceFiles.map(f=>{const row=p.objects.find(o=>o.descriptor.id===f.id);need(row&&row.descriptor.bytes===f.bytes&&row.descriptor.sha256===f.sha256,'EVENT_OBJECT_CHANGED');addFile(f.id);return{path:f.path,bytes:f.bytes,sha256:f.sha256,data:decode64(row.contentBase64)};});
   need(identity(sourceFileIds)===identity([...new Set(sourceFiles.map(f=>f.id))]),'EVENT_FILE_SELECTION_CHANGED');
   validateEventCapture(page,request.id,configuration,request.envelope.args,expected.eventPages.find(v=>v.id===request.envelope.args.previousPageId),source,originalAPI);expected.eventPages.push(result);
  }else if(method==='plan.prepare'){historyConfig(result.config,selectedConfig);checkPlan(result,request,originalAPI);expected.plans.push(result);}
  else if(['plan.simulate','plan.execute','observation.capture'].includes(method)){
   need(result.id==='observation-'+request.id&&Array.isArray(result.sourceFileIds)&&result.apiSha256===p.workspace.apiSha256&&result.native?.requestId===request.id&&result.native?.planId===result.planId,'OBSERVATION_BINDING_CHANGED');
   const selected=invocation(result.configuration,result.actionId,result.parameters,method==='plan.execute',originalAPI);
   need(result.contractId===selected.contract.id&&identity(result.binding)===identity({network:result.configuration.network,contractId:selected.contract.id,contractKey:selected.action.contract,wasmSha256:selected.contract.wasmSha256,apiSha256:p.workspace.apiSha256})&&identity(result.native?.invocation?.argv)===identity(selected.argv),'OBSERVATION_BINDING_CHANGED');
   if(method==='observation.capture'){historyConfig(result.configuration,selectedConfig);need(selected.action.readOnly&&request.envelope.args.actionId===result.actionId&&identity(request.envelope.args.parameters)===identity(result.parameters),'OBSERVATION_REQUEST_CHANGED');}
   else{const plan=expected.plans.find(q=>q.id===request.envelope.args.planId);need(plan&&plan.id===result.planId&&plan.actionId===result.actionId&&identity(plan.parameters)===identity(result.parameters)&&identity(plan.config)===identity(result.configuration),'OBSERVATION_PLAN_CHANGED');}
   for(const id of result.sourceFileIds)addFile(id);
   for(const f of result.native.files){const actual=objects.get('file-'+f.sha256);need(actual&&actual.bytes===Number(f.bytes)&&result.sourceFileIds.includes(actual.id),'OBSERVATION_FILE_CHANGED');}
   if(method==='plan.execute')need(selectedConfig?.executionEnabled===true&&identity(result.configuration)===identity(selectedConfig),'INVOCATION_CONFIGURATION_HISTORY_CHANGED');
   checkObservation(result,request,selected,p.objects,originalAPI);
   expected.observations.push(result);
  }else if(method==='source.import'){
   need(hash(decode64(request.envelope.args.contentBase64))===request.envelope.args.sha256&&result.id==='file-'+request.envelope.args.sha256&&result.bytes===request.envelope.args.bytes&&result.sha256===request.envelope.args.sha256,'SOURCE_REQUEST_CHANGED');addFile(result.id);
  }else if(method==='note.save'){need(result.id==='note-'+request.id&&result.subjectId===request.envelope.args.subjectId&&result.title===request.envelope.args.title&&result.body===request.envelope.args.body,'NOTE_REQUEST_CHANGED');expected.notes.push(result);}
  else if(method==='config.save'){selectedConfig=normalizeConfig(request.envelope.args.config);need(identity(result.config)===identity(selectedConfig),'CONFIGURATION_REQUEST_CHANGED');}
  else need(method==='workspace.inspect','HISTORY_METHOD_UNKNOWN');
 }
 for(const [name,rows]of Object.entries(expected))need(identity(p.workspace[name])===identity(rows),'SAVED_RESULT_CHANGED',{name});
 need(p.workspace.exports.length===0&&objects.size===expected.files.length,'UNREFERENCED_OBJECT_OR_EXPORT');
 if(selectedConfig){const received=clone(selectedConfig);received.executionEnabled=false;need(identity(p.workspace.config)===identity(selectedConfig)||(p.workspace.receivedFrom&&identity(p.workspace.config)===identity(received)),'SAVED_CONFIGURATION_CHANGED');}
 for(const request of p.requests.filter(r=>r.status==='COMPLETE'))need(p.workspace.history.some(h=>h.requestId===request.id),'UNBOUND_COMPLETE_REQUEST');


 return{schema:PORTABLE_SCHEMA,sha256:packet.sha256,workspace:clone(p.workspace.workspace),requests:p.requests.length,files:p.objects.length,bytes:total,application:p.application.length};
}
export async function receiveWorkspace({packet,directory:root,requestId}){
 inspectPacket(packet);need(identity(packet.body.api)===API_SHA256,'CONTRACT_SOURCE_EDITION_CHANGED');text(requestId,200);await directory(root);const intent={requestId,sha256:packet.sha256},marker=path.join(root,'receiving-intent.json');
 await writeExact(marker,bytes(intent));const w=await openWorkspace({directory:root,name:packet.body.workspace.workspace.name});
 try{
  const s=w.read(),replayed=!!s.receivedFrom;if(replayed)need(identity(s.receivedFrom)===identity(intent),'RECEIVING_CONFLICT');
  if(!replayed)need(s.workspace.revision===0&&w.rows().length===0,'EMPTY_RECEIVING_WORKSPACE_REQUIRED');
  const source=packet.body;if(!replayed){w.db.exec('BEGIN IMMEDIATE');try{
   const received=clone(source.workspace);received.originalWorkspaceId=received.workspace.id;
   // Keep the original state and request identity together; a local receive never
   // rewrites requests to a different network or source-account binding.
   received.receivedFrom=intent;received.config.executionEnabled=false;
   for(const o of source.objects)w.db.prepare('INSERT INTO objects VALUES(?,?,?)').run(o.descriptor.id,canonical(o.descriptor),decode64(o.contentBase64));
   for(const r of source.requests){const retained=clone(r);if(['RUNNING','UNCERTAIN'].includes(r.status))retained.receivedPending=true;w.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(r.id,r.intentSha256,canonical(retained));}
   w.db.prepare('UPDATE state SET body=? WHERE id=1').run(canonical(received));w.db.exec('COMMIT');
  }catch(error){w.db.exec('ROLLBACK');throw error;}}
  const app=path.join(root,'received-application');await directory(app);for(const f of source.application)await writeExact(await confined(app,f.path,true),decode64(f.contentBase64),0o644);
  await writeExact(path.join(root,'original-workspace.json'),bytes(packet));return{workspace:w.read().workspace,receivedFrom:intent,application:app,replayed};
 }finally{await w.close();}
}
