// MIT. One BIM workspace, complete local history, original HTTP attempts and explicit wallet handoff.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {uuid,hash,bytes,clone,need,object,keys,canonical,identity,text,sha,decode64} from './value.mjs';
import {directory,lease,writeExact,fileDescriptor,confined,syncDirectory} from './files.mjs';
import {EDITION,stamp,frozen,normalizeConfig,registry,errorRecord,methodEnvelope} from './protocol.mjs';
import {originalHTTP,requestSelection,decodeResponse} from './http.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const PORTABLE_SCHEMA='bim.workspace.v1';
export const MAX_PACKET=768*1024*1024,MAX_OBJECT=128*1024*1024,MAX_OBJECTS=512*1024*1024;
const badSecret=/^(secret|secretKey|apiKey|api_key|accessToken|sessionToken|refreshToken|privateKey|authorization|password|cookie)$/i;
function publicValue(v){canonical(v);if(v&&typeof v==='object')for(const [k,x]of Object.entries(v)){need(!badSecret.test(k),'PRIVATE_CAPABILITY_IN_PUBLIC_RESULT',{field:k});publicValue(x);}return v;}
function addOnce(rows,row){if(!rows.some(x=>x.id===row.id))rows.push(row);}
function selectedEvidence(state,files,sessions,ids=[]){need(Array.isArray(ids)&&new Set(ids).size===ids.length,'EVIDENCE_IDS');return ids.map(id=>{text(id,300);const row=[...state.queries,...state.plans,...state.submissions,...state.operations,...state.notes,...state.sessionEvents,...[...new Map((state.walletEvents??[]).map(e=>[e.operationId,e.operation])).values()],...files,...sessions].find(x=>x.id===id);need(row,'EVIDENCE_NOT_FOUND',{id});return clone(row);});}
export async function openWorkspace({directory:root,name='BIM workspace',sourceDirectory=ROOT,adapters,fetch:fetcher=globalThis.fetch,credentialResolver=null}){
 const [major,minor]=process.versions.node.split('.').map(Number);need(major>22||(major===22&&minor>=16),'NODE_22_16_REQUIRED');need(process.platform==='linux','LINUX_OPERATOR_REQUIRED');need(typeof fetcher==='function','FETCH_REQUIRED');
 const providers=registry(adapters),application=await applicationSelection(sourceDirectory);await directory(root);const guard=await lease(root,'workspace');let db;
 try{
  const file=path.join(root,'bim.sqlite');try{const st=await fs.lstat(file);need(st.isFile()&&!st.isSymbolicLink(),'ORDINARY_DATABASE_REQUIRED');}catch(e){if(e.code!=='ENOENT')throw e;}
  db=new DatabaseSync(file);db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  db.exec('CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL);CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,intent TEXT NOT NULL,body TEXT NOT NULL);CREATE TABLE IF NOT EXISTS objects(id TEXT PRIMARY KEY,descriptor TEXT NOT NULL,data BLOB NOT NULL);CREATE TABLE IF NOT EXISTS exchanges(id TEXT PRIMARY KEY,body TEXT NOT NULL);CREATE TABLE IF NOT EXISTS private_objects(id TEXT PRIMARY KEY,sha256 TEXT NOT NULL,data BLOB NOT NULL);CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,body TEXT NOT NULL);');
  if(!db.prepare('SELECT 1 FROM state').get())db.prepare('INSERT INTO state VALUES(1,?)').run(canonical({workspace:{id:uuid(),name,revision:0,createdAt:stamp()},edition:EDITION,registrySha256:providers.sha256,applicationSha256:application.sha256,catalogue:clone(providers.catalogue),config:normalizeConfig({name}),initialConfig:normalizeConfig({name}),retirements:[],walletEvents:[],queries:[],plans:[],submissions:[],operations:[],notes:[],sessionEvents:[],history:[],receivedFrom:null}));
  const s=JSON.parse(db.prepare('SELECT body FROM state WHERE id=1').get().body);need(s.edition===EDITION&&s.registrySha256===providers.sha256&&s.applicationSha256===application.sha256,'PROVIDER_SOURCE_EDITION_CHANGED');
  await syncDirectory(root);return new Workspace(root,db,guard,sourceDirectory,providers,fetcher,credentialResolver);
 }catch(error){if(db)db.close();await guard.release();throw error;}
}
class Workspace{
 constructor(root,db,guard,sourceDirectory,providers,fetcher,credentialResolver){Object.assign(this,{directory:root,db,guard,sourceDirectory,providers,fetch:fetcher,credentialResolver});this.tail=Promise.resolve();this.closing=false;this.abort=new AbortController();}
 serial(fn){need(!this.closing,'WORKSPACE_CLOSING');const work=this.tail.then(fn,fn);this.tail=work.catch(()=>{});return work;}
 read(){return JSON.parse(this.db.prepare('SELECT body FROM state WHERE id=1').get().body);}
 rows(table='requests'){need(['requests','exchanges','sessions'].includes(table),'TABLE');return this.db.prepare('SELECT body FROM '+table+' ORDER BY rowid').all().map(r=>JSON.parse(r.body));}
 files(){return this.db.prepare('SELECT descriptor FROM objects ORDER BY rowid').all().map(r=>JSON.parse(r.descriptor));}
 state(){const s=this.read();s.requests=this.rows();s.exchanges=this.rows('exchanges');s.sessions=this.rows('sessions').map(x=>({...this.getSession(x.id),privateAvailable:!!this.db.prepare('SELECT 1 FROM private_objects WHERE id=?').get('session:'+x.id)}));s.files=this.files();s.walletOperations=[...new Map(s.walletEvents.map(e=>[e.operationId,e.operation])).values()];s.activity=s.history.map(h=>({...h,status:'COMPLETE'}));return s;}
 bootstrap(){const s=this.read();return{workspace:s.workspace,config:s.config,catalogue:clone(this.providers.catalogue),capabilities:{portable:true,sourceImport:true,edition:EDITION,registrySha256:this.providers.sha256,clientWalletSigning:true,serverWalletSigning:false,requestReplay:true,privateSessionExport:false,executionEnabled:s.config.executionEnabled===true}};}
 request(id){const r=this.db.prepare('SELECT body FROM requests WHERE id=?').get(id);need(r,'REQUEST_NOT_FOUND');return JSON.parse(r.body);}
 object(id){const r=this.db.prepare('SELECT descriptor,data FROM objects WHERE id=?').get(id);need(r,'FILE_NOT_FOUND');const descriptor=JSON.parse(r.descriptor),data=Buffer.from(r.data);need(data.length===descriptor.bytes&&hash(data)===descriptor.sha256,'OBJECT_CHANGED');return{descriptor,data};}
 insertObject(name,type,data){const b=Buffer.from(data);need(b.length<=MAX_OBJECT,'OBJECT_TOO_LARGE');const digest=hash(b),id='file-'+digest,old=this.db.prepare('SELECT descriptor,data FROM objects WHERE id=?').get(id);if(old){need(hash(Buffer.from(old.data))===digest,'OBJECT_CHANGED');return JSON.parse(old.descriptor);}const n=Number(this.db.prepare('SELECT coalesce(sum(length(data)),0) AS n FROM objects').get().n);need(n+b.length<=MAX_OBJECTS,'WORKSPACE_OBJECT_CAPACITY');const d={id,name:text(name,1000),type:text(type||'application/octet-stream',200),bytes:b.length,sha256:digest,createdAt:stamp()};this.db.prepare('INSERT INTO objects VALUES(?,?,?)').run(id,canonical(d),b);return d;}
 savePrivate(id,value){const b=Buffer.isBuffer(value)?value:bytes(value),digest=hash(b),old=this.db.prepare('SELECT sha256 FROM private_objects WHERE id=?').get(id);need(b.length<=MAX_OBJECT,'PRIVATE_OBJECT_TOO_LARGE');if(old){need(old.sha256===digest,'PRIVATE_ORIGINAL_CONFLICT');return digest;}const n=Number(this.db.prepare('SELECT coalesce(sum(length(data)),0) AS n FROM private_objects').get().n);need(n+b.length<=MAX_OBJECTS,'PRIVATE_OBJECT_CAPACITY');this.db.prepare('INSERT INTO private_objects VALUES(?,?,?)').run(id,digest,b);return digest;}
 privateObject(id){const r=this.db.prepare('SELECT sha256,data FROM private_objects WHERE id=?').get(id);need(r,'PRIVATE_ORIGINAL_UNAVAILABLE');const b=Buffer.from(r.data);need(hash(b)===r.sha256,'PRIVATE_ORIGINAL_CHANGED');return b;}
 exchange(id){const r=this.db.prepare('SELECT body FROM exchanges WHERE id=?').get(id);return r?JSON.parse(r.body):null;}
 saveExchange(row){this.db.prepare('INSERT INTO exchanges VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(row.id,canonical(row));}
 finishExchange(row,data,complete){
  this.db.exec('BEGIN IMMEDIATE');try{
   const privateBody=row.response?.private??row.selection.privateResponse;let file=null;
   if(privateBody)this.savePrivate(row.id+'-body',data);else file=this.insertObject(row.id+(complete?'-response':'-partial-response'),'application/octet-stream',data);
   row.response={...(row.response??{status:null,statusText:null,headers:{},observedAt:stamp()}),private:privateBody,bodyComplete:complete,bytes:data.length,sha256:hash(data),bodyFileId:file?.id??null,privateBodyUnavailable:privateBody};
   this.saveExchange(row);this.db.exec('COMMIT');return row;
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 exchangeBytes(row){return row.response.private?this.privateObject(row.id+'-body'):this.object(row.response.bodyFileId).data;}
 getSession(id){const row=this.db.prepare('SELECT body FROM sessions WHERE id=?').get(id);need(row,'SESSION_NOT_FOUND');const session=JSON.parse(row.body),events=this.read().sessionEvents.filter(e=>e.sessionId===id),transactionIds=[...new Set(events.map(e=>e.event.transactionId).filter(v=>typeof v==='string'))],mgiTransactionIds=[...new Set(events.map(e=>e.event.mgiTransactionId).filter(v=>typeof v==='string'))];return{...session,transactionIds,mgiTransactionIds,events};}
 wallet(id){const event=this.read().walletEvents.filter(e=>e.operationId===id).at(-1);need(event,'WALLET_OPERATION_NOT_FOUND');return clone(event.operation);}
 session(id){const selected=this.getSession(id);need(Date.parse(selected.expiresAt)>Date.now(),'SESSION_EXPIRED');const secret=JSON.parse(this.privateObject('session:'+id).toString('utf8'));need(hash(bytes(secret))===selected.sha256,'PRIVATE_SESSION_CHANGED');return{session:selected,secret};}
 async resolveCredential(alias,request,url){
  if(alias.startsWith('session:')){const {session:selected,secret}=this.session(alias.slice(8));need(selected.public?.apiOrigin===new URL(url).origin,'SESSION_ORIGIN_BINDING_REQUIRED');text(secret.sessionToken,16384);return{origins:[selected.public.apiOrigin],headers:{authorization:'Bearer '+secret.sessionToken}};}
  need(typeof this.credentialResolver==='function','SERVER_CREDENTIAL_UNAVAILABLE');return await this.credentialResolver(alias,{requestId:request.id,url});
 }
 context(request,configuration,descriptor,evidence,{replayOnly=false,allowWrite=false}={}){
  const owner=this,exchangeIds=[],sessionIds=[],pending=new Set(),lanes=new Map();let sealed=false;
  const selected=frozen(evidence),config=frozen(configuration),envelope=frozen(request.envelope);
  const track=promise=>{pending.add(promise);promise.then(()=>pending.delete(promise),()=>pending.delete(promise));return promise;};
  const make=lane=>{
   if(lanes.has(lane))return lanes.get(lane);let index=0,sessionIndex=0;
   const ctx=Object.freeze({lane,now:request.createdAt,request:envelope,config,configuration:config,evidence:selected,signal:owner.abort.signal,
    fork(label){need(!sealed&&typeof label==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(label)&&lane.split('/').length<=8,'HTTP_LANE_REQUIRED');return make(lane?lane+'/'+label:label);},
    getResult(id){const row=selected.find(v=>v.id===id);need(row,'SELECTED_EVIDENCE_REQUIRED',{id});return row;},
    http(spec){need(!sealed,'PROVIDER_CONTEXT_CLOSED');need(spec.semantics!=='write'||allowWrite,'EXPLICIT_EXTERNAL_ACTION_REQUIRED');const n=index++,id='exchange-'+identity({requestId:request.id,lane,index:n});exchangeIds.push(id);return track(originalHTTP({owner,request,lane,index:n,spec,configuration,descriptor,signal:owner.abort.signal,replayOnly}));},
    async exposeSession(input){
     need(!sealed,'PROVIDER_CONTEXT_CLOSED');keys(input,['kind','expiresAt','public','secret']);text(input.kind,100);need(Number.isFinite(Date.parse(input.expiresAt))&&Date.parse(input.expiresAt)>Date.parse(request.createdAt),'SESSION_EXPIRY_REQUIRED');publicValue(input.public);need(object(input.secret),'SESSION_SECRET_REQUIRED');
     const n=sessionIndex++,id='session-'+identity({requestId:request.id,lane,index:n}),row={id,requestId:request.id,lane,index:n,kind:input.kind,expiresAt:input.expiresAt,createdAt:request.createdAt,public:clone(input.public),sha256:hash(bytes(input.secret))};sessionIds.push(id);
     const existing=owner.db.prepare('SELECT body FROM sessions WHERE id=?').get(id);if(existing){need(identity(JSON.parse(existing.body))===identity(row),'SESSION_ORIGINAL_CONFLICT');return clone(row);}
     need(!replayOnly,'RETAINED_SESSION_MISSING');owner.db.exec('BEGIN IMMEDIATE');try{owner.savePrivate('session:'+id,input.secret);owner.db.prepare('INSERT INTO sessions VALUES(?,?)').run(id,canonical(row));owner.db.exec('COMMIT');}catch(e){owner.db.exec('ROLLBACK');throw e;}return clone(row);
    },
    getSession(id){return frozen(owner.getSession(id));}
   });lanes.set(lane,ctx);return ctx;
  };
  return{exchangeIds,sessionIds,ctx:make(''),sourceStatus(){return exchangeIds.every(id=>owner.exchange(id)?.status==='COMPLETE')?'COMPLETE':'INCOMPLETE';},
   async run(fn){let result,failure;try{result=await fn();}catch(error){failure=error;}finally{while(pending.size)await Promise.allSettled([...pending]);sealed=true;exchangeIds.sort();sessionIds.sort();}if(failure)throw failure;return result;}
  };
 }
 commit(request,state,result){
  need(this.read().workspace.revision===request.envelope.expectedRevision,'REVISION_CONFLICT');publicValue(result);this.noPrivateLeak(result);state.workspace.revision++;state.workspace.name=state.config.name;
  const response={workspaceId:state.workspace.id,requestId:request.id,revision:state.workspace.revision,result:clone(result)},final={...request,status:'COMPLETE',response,completedAt:stamp(),error:null};
  const event={requestId:request.id,method:request.envelope.method,revision:state.workspace.revision,intentSha256:request.intentSha256,resultSha256:identity(result),previous:state.history.at(-1)?.sha256??null};event.sha256=identity(event);state.history.push(event);
  this.db.prepare('UPDATE state SET body=? WHERE id=1').run(canonical(state));this.db.prepare('UPDATE requests SET body=? WHERE id=?').run(canonical(final),request.id);return response;
 }
 noPrivateLeak(value){const encoded=canonical(value);for(const row of this.db.prepare("SELECT data FROM private_objects WHERE id LIKE 'session:%'").all()){const secret=JSON.parse(Buffer.from(row.data).toString('utf8'));for(const v of Object.values(secret))if(typeof v==='string'&&v.length>=12)need(!encoded.includes(v),'PRIVATE_CAPABILITY_IN_PUBLIC_RESULT');}}
 publicError(error,exchangeIds=[]){
  const secrets=[];const walk=value=>{if(typeof value==='string'&&value.length>=4)secrets.push(value);else if(value&&typeof value==='object')for(const v of Object.values(value))walk(v);};
  for(const row of this.db.prepare('SELECT data FROM private_objects').all())try{walk(JSON.parse(Buffer.from(row.data).toString('utf8')));}catch{}
  const redact=value=>{let s=String(value);for(const secret of secrets.sort((a,b)=>b.length-a.length))s=s.split(secret).join('[private value]');return s;};
  return errorRecord(error,{redact,exchangeIds});
 }
 async commandWithMeta(envelope){const e=JSON.parse(canonical(envelope));methodEnvelope(e);return this.serial(async()=>{const replayed=!!this.db.prepare('SELECT 1 FROM requests WHERE id=?').get(e.requestId);const response=await this.perform(e);return{response,replayed};});}
 async command(envelope){return(await this.commandWithMeta(envelope)).response;}
 async prepare(state,args,request,{replayOnly=false}={}){
  keys(args,['actionId','input','evidenceIds'],['actionId','input']);need(object(args.input),'ACTION_INPUT_REQUIRED');const {adapter,descriptor}=this.providers.get(args.actionId);need(['prepare','external-write'].includes(descriptor.mode),'PREPARE_ACTION_REQUIRED');
  const evidence=selectedEvidence(state,this.files(),this.rows('sessions'),args.evidenceIds??[]),c=this.context(request,state.config,descriptor,evidence,{replayOnly});
  let value=await c.run(()=>descriptor.mode==='external-write'?adapter.prepare(args.actionId,frozen(args.input),c.ctx):adapter.execute(args.actionId,frozen(args.input),c.ctx));publicValue(value);
  const sourceStatus=c.sourceStatus(),selectedSourceStatus=planSourceStatus(value,c.exchangeIds,id=>this.exchange(id));if(selectedSourceStatus==='INCOMPLETE')value={...clone(value),status:'NEEDS_REVIEW',sourceIncomplete:true};
  need(object(value)&&['PREPARED','NEEDS_REVIEW'].includes(value.status),'PLAN_STATUS_REQUIRED');
  if(value.execute){keys(value.execute,['actionId','input']);need(descriptor.mode==='external-write'&&this.providers.get(value.execute.actionId).descriptor.mode==='external-write'&&object(value.execute.input),'EXTERNAL_PLAN_ACTION_REQUIRED');}
  return{id:'plan-'+request.id,actionId:args.actionId,input:clone(args.input),evidenceIds:clone(args.evidenceIds??[]),evidenceSha256:identity(evidence),configuration:clone(state.config),registrySha256:this.providers.sha256,createdAt:request.createdAt,status:value.status,value:clone(value),unsignedPayload:clone(value.unsignedPayload??null),selection:clone(value.selection??null),execute:clone(value.execute??null),expiresAt:value.expiresAt??null,sourceStatus,selectedSourceStatus,exchangeIds:c.exchangeIds,sessionIds:c.sessionIds};
 }
 async perform(e){
  const intent=identity(e),old=this.db.prepare('SELECT intent,body FROM requests WHERE id=?').get(e.requestId);let request;
  if(old){need(old.intent===intent,'REQUEST_ID_CONFLICT');request=JSON.parse(old.body);if(request.status==='COMPLETE')return request.response;if(request.status==='FAILED')throw Object.assign(new Error(request.error.message),request.error,{publicMessage:request.error.message});need(!request.receivedPending,'ORIGINAL_EXTERNAL_OWNER_REQUIRED');}
  const state=this.read();if(request)need(!state.retirements.some(r=>r.originalRequestId===request.id),'ORIGINAL_REQUEST_RETIRED');if(!request){need(state.workspace.revision===e.expectedRevision,'REVISION_CONFLICT',{expected:e.expectedRevision,current:state.workspace.revision});const pending=this.rows().find(r=>['RUNNING','UNCERTAIN'].includes(r.status)&&!state.retirements.some(x=>x.originalRequestId===r.id));need(!pending||e.method==='request.retire','ORIGINAL_REQUEST_UNRESOLVED',{requestId:pending?.id});request={id:e.requestId,intentSha256:intent,envelope:e,status:'RUNNING',createdAt:stamp(),response:null,error:null};this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(request.id,intent,canonical(request));}
  try{
   let result,collection=null,localResult=false;
   if(e.method==='workspace.receive'){keys(e.args,['packet']);const checked=inspectPacket(e.args.packet),relative='received/workspace-'+identity({requestId:request.id,packetSHA256:checked.sha256}),destination=await confined(this.directory,relative,true);const received=await receiveWorkspace({packet:e.args.packet,directory:destination,requestId:request.id,adapters:this.providers.adapters,sourceDirectory:this.sourceDirectory,fetch:this.fetch,credentialResolver:this.credentialResolver});result={schema:'bim.workspace-receiving.v1',requestId:request.id,packetSHA256:checked.sha256,workspace:received.workspace,receivedFrom:received.receivedFrom,relativeDirectory:relative,privateCapabilitiesAvailable:false,executionEnabled:false};localResult=true;}
   else if(e.method==='plan.prepare'){result=await this.prepare(state,e.args,request);collection='plans';}
   else if(['query.run','submission.refresh','operation.execute'].includes(e.method)){
    let actionId,input,evidenceIds,planId=null,submissionId=null;
    if(e.method==='operation.execute'){
     keys(e.args,['planId']);const plan=state.plans.find(p=>p.id===e.args.planId);need(plan,'PLAN_NOT_FOUND');const original=this.request(plan.id.slice(5));need(original.status==='COMPLETE'&&original.envelope.method==='plan.prepare'&&identity(original.response.result)===identity(plan),'ORIGINAL_PLAN_CHANGED');
     need(plan.status==='PREPARED'&&plan.execute&&state.config.executionEnabled===true&&identity(plan.configuration)===identity(state.config),'EXPLICIT_CURRENT_EXECUTION_CONFIGURATION_REQUIRED');need(!plan.expiresAt||Date.parse(plan.expiresAt)>Date.now(),'PLAN_EXPIRED');
     need(!this.rows().some(r=>r.id!==request.id&&r.envelope.method==='operation.execute'&&r.envelope.args.planId===plan.id),'PLAN_ALREADY_EXECUTED');
     const reconstructed=await this.prepare({...state,config:plan.configuration},original.envelope.args,original,{replayOnly:true});need(identity(reconstructed)===identity(plan),'PLAN_RECONSTRUCTION_CHANGED');
     ({actionId,input}=plan.execute);evidenceIds=[...plan.evidenceIds,plan.id];planId=plan.id;collection='operations';
    }else{
     keys(e.args,e.method==='query.run'?['actionId','input','evidenceIds']:['submissionId','actionId','input','evidenceIds'],e.method==='query.run'?['actionId','input']:['submissionId','actionId','input']);({actionId,input}=e.args);evidenceIds=clone(e.args.evidenceIds??[]);
     if(e.method==='submission.refresh'){const selected=state.submissions.find(s=>s.id===e.args.submissionId);need(selected,'SUBMISSION_NOT_FOUND');submissionId=selected.id;if(!evidenceIds.includes(selected.id))evidenceIds.push(selected.id);if(!evidenceIds.includes(selected.planId))evidenceIds.push(selected.planId);}
     collection='queries';
    }
    need(object(input),'ACTION_INPUT_REQUIRED');const {adapter,descriptor}=this.providers.get(actionId);need(e.method==='operation.execute'?descriptor.mode==='external-write':['read','local'].includes(descriptor.mode),'ACTION_MODE_CONFLICT');
    const evidence=selectedEvidence(state,this.files(),this.rows('sessions'),evidenceIds),c=this.context(request,state.config,descriptor,evidence,{allowWrite:e.method==='operation.execute'});
    const value=await c.run(()=>adapter.execute(actionId,frozen(input),c.ctx));publicValue(value);const sourceStatus=c.sourceStatus();need(e.method!=='operation.execute'||sourceStatus==='COMPLETE','EXTERNAL_ATTEMPT_UNRESOLVED');
    result={id:(collection==='operations'?'operation-':'query-')+request.id,actionId,input:clone(input),evidenceIds,evidenceSha256:identity(evidence),configuration:clone(state.config),registrySha256:this.providers.sha256,createdAt:request.createdAt,value:clone(value),sourceStatus,exchangeIds:c.exchangeIds,sessionIds:c.sessionIds};
    if(planId)result.planId=planId;if(submissionId)result.submissionId=submissionId;
   }
   this.db.exec('BEGIN IMMEDIATE');try{
    if(collection)state[collection].push(result);
    else if(e.method==='config.save'){keys(e.args,['config']);state.config=normalizeConfig(e.args.config);result={config:state.config};}
    else if(e.method==='request.retire'){keys(e.args,['originalRequestId','reason']);const original=this.request(e.args.originalRequestId);need(original.id!==request.id&&['RUNNING','UNCERTAIN'].includes(original.status)&&!state.retirements.some(r=>r.originalRequestId===original.id),'UNRESOLVED_ORIGINAL_REQUIRED');result={id:'retirement-'+request.id,originalRequestId:original.id,intentSha256:original.intentSha256,originalStatus:original.status,reason:text(e.args.reason,10000),classification:'OUTCOME_REMAINS_UNKNOWN',createdAt:request.createdAt};state.retirements.push(result);}
    else if(e.method==='source.import'){keys(e.args,['name','type','contentBase64','bytes','sha256']);need(Number.isSafeInteger(e.args.bytes)&&e.args.bytes>=0&&e.args.bytes<=MAX_OBJECT,'SOURCE_SIZE');const data=decode64(e.args.contentBase64);need(data.length===e.args.bytes&&hash(data)===sha(e.args.sha256),'SOURCE_IDENTITY_MISMATCH');result=this.insertObject(e.args.name,e.args.type,data);}
    else if(e.method==='submission.record'){
     keys(e.args,['planId','submission']);const plan=state.plans.find(p=>p.id===e.args.planId);need(plan&&plan.status==='PREPARED'&&!plan.execute,'WALLET_PLAN_REQUIRED');need(object(e.args.submission)&&typeof e.args.submission.transactionHash==='string','ORIGINAL_TRANSACTION_HASH_REQUIRED');text(e.args.submission.transactionHash,1000);publicValue(e.args.submission);
     result={id:'submission-'+request.id,planId:plan.id,configuration:clone(plan.configuration),selection:clone(plan.selection),submission:clone(e.args.submission),classification:'CLIENT_REPORTED_SUBMISSION',createdAt:request.createdAt};state.submissions.push(result);
    }else if(e.method.startsWith('wallet.')){result=walletTransition(state.walletEvents,e.method,e.args,request,{getPlan:id=>state.plans.find(p=>p.id===id),getSession:id=>this.getSession(id),configuration:state.config});state.walletEvents.push(result);result=result.operation;}
    else if(e.method==='session.event'){
     keys(e.args,['sessionId','event','sourceEventId'],['sessionId','event']);const session=this.getSession(e.args.sessionId);let event=clone(e.args.event);need(object(event),'ORIGINAL_WIDGET_EVENT_REQUIRED');if(e.args.sourceEventId){const prior=state.sessionEvents.find(v=>v.id===e.args.sourceEventId);need(prior,'ORIGINAL_WIDGET_EVENT_NOT_FOUND');const origin=this.getSession(prior.sessionId);for(const field of ['environment','walletAddress','flow'])need(origin.public[field]===session.public[field],'SESSION_ASSOCIATION_CHANGED');event={...event,transactionId:prior.event.transactionId??null,mgiTransactionId:prior.event.mgiTransactionId??null};}need([event.transactionId,event.mgiTransactionId].some(v=>typeof v==='string'&&v.length),'ORIGINAL_WIDGET_TRANSACTION_REQUIRED');publicValue(event);
     result={id:'session-event-'+request.id,sessionId:session.id,event,sourceEventId:e.args.sourceEventId??null,classification:'CLIENT_WIDGET_OBSERVATION',createdAt:request.createdAt};state.sessionEvents.push(result);
    }else if(e.method==='note.save'){keys(e.args,['subjectId','title','body']);result={id:'note-'+request.id,subjectId:text(e.args.subjectId),title:text(e.args.title,500),body:text(e.args.body,1024*1024),createdAt:request.createdAt};state.notes.push(result);}
    else if(e.method==='workspace.inspect'){keys(e.args,['packet']);result=inspectPacket(e.args.packet);}
    else if(!collection&&!localResult)throw Object.assign(new Error('UNKNOWN_COMMAND'),{code:'UNKNOWN_COMMAND'});
    const response=this.commit(request,state,result);this.db.exec('COMMIT');return response;
   }catch(error){this.db.exec('ROLLBACK');throw error;}
  }catch(error){
   const saved=this.request(request.id);if(saved.status==='COMPLETE')return saved.response;
   const attempts=this.rows('exchanges').filter(x=>x.requestId===request.id),hasAttempt=attempts.some(x=>x.selection.semantics==='write')||this.rows('sessions').some(x=>x.requestId===request.id);
   request={...request,status:hasAttempt?'UNCERTAIN':'FAILED',error:this.publicError(error,attempts.map(x=>x.id)),observedAt:stamp()};this.db.prepare('UPDATE requests SET body=? WHERE id=?').run(canonical(request),request.id);throw Object.assign(new Error(request.error.message),request.error,{publicMessage:request.error.message});
  }
 }
 async portable(){return this.serial(async()=>{
  const application=[];const manifest=JSON.parse(await fs.readFile(path.join(this.sourceDirectory,'source-files.json'),'utf8'));for(const m of [...manifest.files,{path:'source-files.json'}]){const file=await confined(this.sourceDirectory,m.path),data=await fs.readFile(file);if(m.sha256)need(hash(data)===m.sha256&&data.length===m.bytes,'APPLICATION_SOURCE_CHANGED');application.push({path:m.path,bytes:data.length,sha256:hash(data),contentBase64:data.toString('base64')});}
  const body={edition:EDITION,workspace:this.read(),requests:this.rows(),exchanges:this.rows('exchanges'),sessions:this.rows('sessions'),objects:this.db.prepare('SELECT descriptor,data FROM objects ORDER BY id').all().map(r=>({descriptor:JSON.parse(r.descriptor),contentBase64:Buffer.from(r.data).toString('base64')})),application,createdAt:stamp(),privateCustody:{included:false,description:'Private provider bodies, credentials and live session capabilities remain only with their original server owner.'}};
  const packet={schema:PORTABLE_SCHEMA,sha256:identity(body),body};need(bytes(packet).length<=MAX_PACKET,'PORTABLE_CAPACITY');inspectPacket(packet);return packet;
 });}
 async close(){if(this.closed)return;this.closing=true;this.abort.abort();await this.tail;if(this.db){this.db.close();this.db=null;}await this.guard.release();this.closed=true;}
}

export async function applicationSelection(root){
 const manifestFile=await confined(root,'source-files.json'),raw=await fs.readFile(manifestFile),manifest=JSON.parse(raw);
 need(Array.isArray(manifest.files)&&new Set(manifest.files.map(f=>f.path)).size===manifest.files.length&&!manifest.files.some(f=>f.path==='source-files.json'),'APPLICATION_MANIFEST');
 for(const member of manifest.files){const file=await confined(root,member.path),data=await fs.readFile(file);need(data.length===member.bytes&&hash(data)===member.sha256,'APPLICATION_SOURCE_CHANGED',{path:member.path});}
 return{sha256:hash(raw),bytes:raw.length,files:manifest.files};
}
function sameConfiguration(value,selected,received){const disabled=clone(selected);disabled.executionEnabled=false;need(identity(value)===identity(selected)||(received&&identity(value)===identity(disabled)),'CONFIGURATION_HISTORY_CHANGED');}
export function inspectPacket(packet){
 keys(packet,['schema','sha256','body']);need(packet.schema===PORTABLE_SCHEMA&&packet.sha256===identity(packet.body)&&bytes(packet).length<=MAX_PACKET,'PORTABLE_IDENTITY');const p=packet.body;
 keys(p,['edition','workspace','requests','exchanges','sessions','objects','application','createdAt','privateCustody']);need(p.edition===EDITION&&p.privateCustody?.included===false,'PORTABLE_EDITION');const w=p.workspace;
 need(w.edition===EDITION&&w.registrySha256===identity(w.catalogue)&&Array.isArray(w.history)&&Number.isSafeInteger(w.workspace.revision)&&w.workspace.revision>=0,'WORKSPACE_IDENTITY');
 const records=new Map(),objects=new Map(),exchanges=new Map(),sessions=new Map();let total=0;
 for(const row of p.requests){need(!records.has(row.id),'DUPLICATE_REQUEST');methodEnvelope(row.envelope);need(row.id===row.envelope.requestId&&row.intentSha256===identity(row.envelope)&&['RUNNING','UNCERTAIN','FAILED','COMPLETE'].includes(row.status),'REQUEST_IDENTITY');records.set(row.id,row);}
 for(const o of p.objects){const f=o.descriptor,b=decode64(o.contentBase64);need(!objects.has(f.id)&&f.id==='file-'+f.sha256&&b.length===f.bytes&&b.length<=MAX_OBJECT&&hash(b)===f.sha256,'OBJECT_IDENTITY');total+=b.length;need(total<=MAX_OBJECTS,'WORKSPACE_OBJECT_CAPACITY');objects.set(f.id,{descriptor:f,data:b});}
 const catalogue=new Map(w.catalogue.map(a=>[a.id,a]));need(catalogue.size===w.catalogue.length,'DUPLICATE_ACTION');
 const referencedObjects=new Set();
 for(const row of p.exchanges){
  need(!exchanges.has(row.id)&&records.has(row.requestId)&&Number.isSafeInteger(row.index)&&row.index>=0&&typeof row.lane==='string'&&/^(?:[a-zA-Z0-9_-]{1,64}(?:\/[a-zA-Z0-9_-]{1,64}){0,8})?$/.test(row.lane)&&row.id==='exchange-'+identity({requestId:row.requestId,lane:row.lane,index:row.index}),'EXCHANGE_IDENTITY');
  const selected={requestId:row.requestId,lane:row.lane,index:row.index,actionId:row.actionId,configurationSha256:row.configurationSha256,selection:row.selection};need(row.bindingSha256===identity(selected)&&catalogue.has(row.actionId)&&['RESERVED','READING','UNCERTAIN','COMPLETE'].includes(row.status),'EXCHANGE_BINDING');
  if(row.response?.sha256){sha(row.response.sha256);need(Number.isSafeInteger(row.response.bytes)&&row.response.bytes>=0,'EXCHANGE_BODY_IDENTITY');if(row.response.private){need(row.response.bodyFileId===null&&row.response.privateBodyUnavailable===true,'PRIVATE_EXCHANGE_EXPORT');}else{const o=objects.get(row.response.bodyFileId);need(o&&o.descriptor.sha256===row.response.sha256&&o.descriptor.bytes===row.response.bytes,'EXCHANGE_BODY_IDENTITY');referencedObjects.add(row.response.bodyFileId);}}
  if(row.status==='COMPLETE')need(row.response?.bodyComplete===true&&typeof row.response.sha256==='string'&&Number.isInteger(row.response.status),'COMPLETE_EXCHANGE_REQUIRED');
  exchanges.set(row.id,row);
 }
 for(const session of p.sessions){need(!sessions.has(session.id)&&records.has(session.requestId)&&typeof session.id==='string'&&session.id.startsWith('session-')&&Number.isFinite(Date.parse(session.expiresAt)),'SESSION_IDENTITY');sha(session.sha256);publicValue(session.public);sessions.set(session.id,session);}
 let previous=null,config=normalizeConfig(w.initialConfig);const expected={retirements:[],walletEvents:[],queries:[],plans:[],submissions:[],operations:[],notes:[],sessionEvents:[]};
 const sourceRows=p.objects.map(o=>o.descriptor);
 const evidenceFor=ids=>selectedEvidence(expected,sourceRows,p.sessions,ids);
 for(let i=0;i<w.history.length;i++){
  const event=w.history[i],r=records.get(event.requestId),{sha256,...unsigned}=event;
  need(event.revision===i+1&&event.previous===previous&&sha256===identity(unsigned)&&r?.status==='COMPLETE'&&r.response?.workspaceId===w.workspace.id&&r.response.requestId===r.id&&r.response.revision===i+1&&r.envelope.expectedRevision===i&&r.intentSha256===event.intentSha256&&event.method===r.envelope.method&&identity(r.response.result)===event.resultSha256,'HISTORY_IDENTITY');previous=sha256;
  const result=r.response.result,args=r.envelope.args,method=r.envelope.method;
  publicValue(result);
  if(method==='config.save'){keys(args,['config']);config=normalizeConfig(args.config);need(identity(result.config)===identity(config),'CONFIGURATION_RESULT_CHANGED');}
  else if(method==='request.retire'){const original=records.get(args.originalRequestId);need(original&&['RUNNING','UNCERTAIN'].includes(original.status)&&result.id==='retirement-'+r.id&&result.originalRequestId===original.id&&result.intentSha256===original.intentSha256&&result.originalStatus===original.status&&result.reason===args.reason&&result.classification==='OUTCOME_REMAINS_UNKNOWN'&&!expected.retirements.some(x=>x.originalRequestId===original.id),'RETIREMENT_CHANGED');expected.retirements.push(result);}
  else if(method==='source.import'){const b=decode64(args.contentBase64),o=objects.get(result.id);need(o&&result.id==='file-'+args.sha256&&b.length===args.bytes&&hash(b)===args.sha256&&identity(result)===identity(o.descriptor),'SOURCE_RESULT_CHANGED');referencedObjects.add(result.id);}
  else if(['query.run','plan.prepare','submission.refresh','operation.execute'].includes(method)){
   const list=method==='plan.prepare'?'plans':method==='operation.execute'?'operations':'queries',prefix=list==='plans'?'plan-':list==='operations'?'operation-':'query-';
   need(result.id===prefix+r.id&&result.registrySha256===w.registrySha256&&result.createdAt===r.createdAt,'ACTION_RESULT_CHANGED');sameConfiguration(result.configuration,config,!!w.receivedFrom);
   let actionId=args.actionId,input=args.input,ids=clone(args.evidenceIds??[]);
   if(method==='operation.execute'){const plan=expected.plans.find(x=>x.id===args.planId);need(plan&&plan.status==='PREPARED'&&plan.execute&&result.planId===plan.id&&result.configuration.executionEnabled===true,'OPERATION_PLAN_CHANGED');need(!expected.operations.some(x=>x.planId===plan.id),'DUPLICATE_PLAN_EXECUTION');({actionId,input}=plan.execute);ids=[...plan.evidenceIds,plan.id];need(identity(plan.configuration)===identity(result.configuration),'OPERATION_CONFIGURATION_CHANGED');}
   if(method==='submission.refresh'){const submission=expected.submissions.find(x=>x.id===args.submissionId);need(submission&&result.submissionId===submission.id,'SUBMISSION_RESULT_CHANGED');if(!ids.includes(submission.id))ids.push(submission.id);if(!ids.includes(submission.planId))ids.push(submission.planId);}
   const descriptor=catalogue.get(actionId);need(descriptor&&result.actionId===actionId&&identity(result.input)===identity(input)&&identity(result.evidenceIds)===identity(ids)&&result.evidenceSha256===identity(evidenceFor(ids)),'ACTION_INPUT_CHANGED');
   need(method==='plan.prepare'?['prepare','external-write'].includes(descriptor.mode):method==='operation.execute'?descriptor.mode==='external-write':['read','local'].includes(descriptor.mode),'ACTION_MODE_CHANGED');
   need(Array.isArray(result.exchangeIds)&&new Set(result.exchangeIds).size===result.exchangeIds.length&&Array.isArray(result.sessionIds)&&new Set(result.sessionIds).size===result.sessionIds.length,'ACTION_SOURCE_ROSTER');
   need(identity(result.exchangeIds)===identity([...result.exchangeIds].sort())&&identity(result.sessionIds)===identity([...result.sessionIds].sort()),'ACTION_SOURCE_ORDER');const laneIndices=new Map();
   for(const id of result.exchangeIds){const exchange=exchanges.get(id);need(exchange&&exchange.requestId===r.id&&exchange.actionId===actionId&&exchange.configurationSha256===identity(result.configuration),'ACTION_EXCHANGE_CHANGED');const indices=laneIndices.get(exchange.lane)??[];indices.push(exchange.index);laneIndices.set(exchange.lane,indices);need(identity(requestSelection({...exchange.selection,bodyBase64:exchange.selection.bodyBase64??undefined},result.configuration,descriptor))===identity(exchange.selection),'ACTION_HTTP_CHANGED');need(method==='operation.execute'||exchange.selection.semantics!=='write','READ_COMMAND_WRITE');}
   for(const indices of laneIndices.values())need(indices.sort((a,b)=>a-b).every((v,i)=>v===i),'HTTP_LANE_SEQUENCE');
   const sourceStatus=result.exchangeIds.every(id=>exchanges.get(id).status==='COMPLETE')?'COMPLETE':'INCOMPLETE';need(result.sourceStatus===sourceStatus&&(method!=='operation.execute'||sourceStatus==='COMPLETE'),'ACTION_SOURCE_STATUS');
   need(p.exchanges.filter(x=>x.requestId===r.id).length===result.exchangeIds.length,'UNBOUND_ACTION_EXCHANGE');
   for(const id of result.sessionIds)need(sessions.get(id)?.requestId===r.id,'ACTION_SESSION_CHANGED');
   if(method==='plan.prepare'){const selectedSourceStatus=planSourceStatus(result.value,result.exchangeIds,id=>exchanges.get(id));need(result.selectedSourceStatus===selectedSourceStatus&&(selectedSourceStatus==='COMPLETE'||result.status==='NEEDS_REVIEW'&&result.value.sourceIncomplete===true),'PLAN_SELECTED_SOURCE_STATUS');need(result.status===result.value.status&&['PREPARED','NEEDS_REVIEW'].includes(result.status)&&identity(result.unsignedPayload)===identity(result.value.unsignedPayload??null)&&identity(result.selection)===identity(result.value.selection??null)&&identity(result.execute)===identity(result.value.execute??null)&&result.expiresAt===(result.value.expiresAt??null),'PLAN_PROJECTION_CHANGED');if(result.execute)need(descriptor.mode==='external-write'&&catalogue.get(result.execute.actionId)?.mode==='external-write','PLAN_EXECUTE_CHANGED');}
   expected[list].push(result);
  }else if(method==='submission.record'){
   const plan=expected.plans.find(x=>x.id===args.planId);need(plan&&plan.status==='PREPARED'&&!plan.execute&&result.id==='submission-'+r.id&&result.planId===plan.id&&identity(result.submission)===identity(args.submission)&&identity(result.configuration)===identity(plan.configuration)&&identity(result.selection)===identity(plan.selection)&&result.classification==='CLIENT_REPORTED_SUBMISSION','SUBMISSION_RESULT_CHANGED');expected.submissions.push(result);
  }else if(method.startsWith('wallet.')){const event=walletTransition(expected.walletEvents,method,args,r,{configuration:config,getPlan:id=>expected.plans.find(p=>p.id===id),getSession:id=>{const session=sessions.get(id);need(session,'SESSION_NOT_FOUND');return{...session,transactionIds:[...new Set(expected.sessionEvents.filter(e=>e.sessionId===id).map(e=>e.event.transactionId).filter(x=>typeof x==='string'))]};}});need(identity(event.operation)===identity(result),'WALLET_RESULT_CHANGED');expected.walletEvents.push(event);}
  else if(method==='session.event'){let event=clone(args.event);if(args.sourceEventId){const prior=expected.sessionEvents.find(x=>x.id===args.sourceEventId);need(prior,'ORIGINAL_WIDGET_EVENT_NOT_FOUND');const a=sessions.get(prior.sessionId),b=sessions.get(args.sessionId);need(a&&b,'SESSION_NOT_FOUND');for(const field of ['environment','walletAddress','flow'])need(a.public[field]===b.public[field],'SESSION_ASSOCIATION_CHANGED');event={...event,transactionId:prior.event.transactionId??null,mgiTransactionId:prior.event.mgiTransactionId??null};}need(sessions.has(args.sessionId)&&result.id==='session-event-'+r.id&&result.sessionId===args.sessionId&&identity(result.event)===identity(event)&&result.sourceEventId===(args.sourceEventId??null)&&result.classification==='CLIENT_WIDGET_OBSERVATION','SESSION_EVENT_CHANGED');expected.sessionEvents.push(result);}
  else if(method==='note.save'){need(result.id==='note-'+r.id&&result.subjectId===args.subjectId&&result.title===args.title&&result.body===args.body,'NOTE_RESULT_CHANGED');expected.notes.push(result);}
  else if(method==='workspace.receive'){const received=inspectPacket(args.packet);need(result.schema==='bim.workspace-receiving.v1'&&result.requestId===r.id&&result.packetSHA256===received.sha256&&identity(result.workspace)===identity(args.packet.body.workspace.workspace)&&identity(result.receivedFrom)===identity({requestId:r.id,sha256:received.sha256})&&result.relativeDirectory==='received/workspace-'+identity({requestId:r.id,packetSHA256:received.sha256})&&result.privateCapabilitiesAvailable===false&&result.executionEnabled===false,'RECEIVING_RESULT_CHANGED');}
  else if(method==='workspace.inspect')need(identity(result)===identity(inspectPacket(args.packet)),'INSPECTION_RESULT_CHANGED');
  else need(false,'HISTORY_METHOD_UNKNOWN');
 }
 need(w.history.length===w.workspace.revision,'HISTORY_REVISION');for(const [name,rows]of Object.entries(expected))need(identity(w[name])===identity(rows),'SAVED_RESULT_CHANGED',{name});
 sameConfiguration(w.config,config,!!w.receivedFrom);
 for(const r of records.values())if(r.status==='COMPLETE')need(w.history.some(h=>h.requestId===r.id),'UNBOUND_COMPLETED_REQUEST');
 need(objects.size===referencedObjects.size,'UNREFERENCED_PUBLIC_OBJECT');
 for(const row of p.exchanges){const r=records.get(row.requestId);if(r.status!=='COMPLETE'){need(r.envelope.expectedRevision<=w.workspace.revision,'PENDING_REVISION');const prior=w.history.slice(0,r.envelope.expectedRevision).map(h=>records.get(h.requestId)).filter(x=>x.envelope.method==='config.save').at(-1);const c=prior?normalizeConfig(prior.envelope.args.config):normalizeConfig(w.initialConfig);const disabled=clone(c);disabled.executionEnabled=false;need(row.configurationSha256===identity(c)||(w.receivedFrom&&row.configurationSha256===identity(disabled)),'PENDING_CONFIGURATION_CHANGED');}}
 const names=new Map();for(const f of p.application){need(typeof f.path==='string'&&!path.isAbsolute(f.path)&&f.path.split('/').every(v=>v&&v!=='.'&&v!=='..')&&!f.path.includes('\\')&&!names.has(f.path),'APPLICATION_PATH');const b=decode64(f.contentBase64);need(b.length===f.bytes&&hash(b)===f.sha256,'APPLICATION_IDENTITY');names.set(f.path,{...f,data:b});}
 const manifest=names.get('source-files.json');need(manifest&&hash(manifest.data)===w.applicationSha256,'APPLICATION_SOURCE_BINDING');const selected=JSON.parse(manifest.data.toString('utf8'));need(Array.isArray(selected.files)&&selected.files.length+1===names.size&&new Set(selected.files.map(f=>f.path)).size===selected.files.length,'APPLICATION_INCOMPLETE');for(const f of selected.files){const actual=names.get(f.path);need(f.path!=='source-files.json'&&actual&&actual.bytes===f.bytes&&actual.sha256===f.sha256,'APPLICATION_IDENTITY');}
 return{schema:PORTABLE_SCHEMA,sha256:packet.sha256,workspace:clone(w.workspace),files:objects.size,requests:records.size,exchanges:exchanges.size,sessions:sessions.size,privateBodies:p.exchanges.filter(x=>x.response?.private).length,privateCapabilitiesAvailable:false,application:names.size,bytes:total};
}
export async function receiveWorkspace({packet,directory:root,requestId,adapters,sourceDirectory=ROOT,...options}){
 inspectPacket(packet);const selected=await applicationSelection(sourceDirectory),providers=registry(adapters);need(selected.sha256===packet.body.workspace.applicationSha256&&providers.sha256===packet.body.workspace.registrySha256,'APPLICATION_SOURCE_EDITION_CHANGED');text(requestId,200);await directory(root);
 const intent={requestId,sha256:packet.sha256};await writeExact(path.join(root,'receiving-intent.json'),bytes(intent));const w=await openWorkspace({directory:root,name:packet.body.workspace.workspace.name,adapters,sourceDirectory,...options});
 try{
  const state=w.read(),replayed=!!state.receivedFrom;if(replayed)need(identity(state.receivedFrom)===identity(intent),'RECEIVING_CONFLICT');else need(state.workspace.revision===0&&w.rows().length===0&&w.rows('exchanges').length===0,'EMPTY_RECEIVING_WORKSPACE_REQUIRED');
  if(!replayed){w.db.exec('BEGIN IMMEDIATE');try{
   const body=packet.body,received=clone(body.workspace);received.receivedFrom=intent;received.config.executionEnabled=false;
   for(const o of body.objects)w.db.prepare('INSERT INTO objects VALUES(?,?,?)').run(o.descriptor.id,canonical(o.descriptor),decode64(o.contentBase64));
   for(const request of body.requests){const r=clone(request);if(['RUNNING','UNCERTAIN'].includes(r.status))r.receivedPending=true;w.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(r.id,r.intentSha256,canonical(r));}
   for(const e of body.exchanges)w.db.prepare('INSERT INTO exchanges VALUES(?,?)').run(e.id,canonical(e));
   for(const s of body.sessions)w.db.prepare('INSERT INTO sessions VALUES(?,?)').run(s.id,canonical(s));
   w.db.prepare('UPDATE state SET body=? WHERE id=1').run(canonical(received));w.db.exec('COMMIT');
  }catch(error){w.db.exec('ROLLBACK');throw error;}}
  const app=path.join(root,'received-application');await directory(app);for(const f of packet.body.application)await writeExact(await confined(app,f.path,true),decode64(f.contentBase64),0o644);await writeExact(path.join(root,'original-workspace.json'),bytes(packet));return{workspace:w.read().workspace,receivedFrom:intent,application:app,replayed,privateCapabilitiesAvailable:false};
 }finally{await w.close();}
}

function sameWalletConfiguration(a,b){const x=clone(a),y=clone(b);x.executionEnabled=false;y.executionEnabled=false;need(identity(x)===identity(y),'WALLET_CURRENT_SELECTION_CHANGED');}
function planSourceStatus(value,ids,getExchange){
 const rows=ids.map(id=>getExchange(id));need(rows.every(Boolean),'PLAN_SOURCE_MISSING');let selected=rows;
 if(value.selectedSourceLane!==undefined||value.selectedExchangeIds!==undefined){
  const lane=value.selectedSourceLane;need(typeof lane==='string'&&/^[a-zA-Z0-9_-]{1,64}(?:\/[a-zA-Z0-9_-]{1,64}){0,8}$/.test(lane),'PLAN_SOURCE_LANE');
  selected=rows.filter(r=>r.lane===lane||r.lane.startsWith(lane+'/'));need(selected.length>0&&Array.isArray(value.selectedExchangeIds)&&new Set(value.selectedExchangeIds).size===value.selectedExchangeIds.length&&identity([...value.selectedExchangeIds].sort())===identity(selected.map(r=>r.id).sort()),'PLAN_SELECTED_LANE_INCOMPLETE');
 }
 return selected.every(r=>r.status==='COMPLETE')&&!rows.some(r=>r.selection.semantics==='write'&&r.status!=='COMPLETE')?'COMPLETE':'INCOMPLETE';
}
// Local wallet-side record transition. This records client evidence; it never signs or broadcasts.
export function walletTransition(events,method,args,request,{getPlan,getSession,configuration}){
 const old=events.filter(e=>e.operation.id===args.id).at(-1)?.operation??null;let operation;
 if(method==='wallet.reserve'){
  keys(args,['id','networkPassphrase','address','unsignedXdr','unsignedHash','intent']);need(/^[a-zA-Z0-9._:-]{1,200}$/.test(args.id),'WALLET_OPERATION_ID');text(args.networkPassphrase,1000);text(args.address,500);sha(args.unsignedHash);need(decode64(args.unsignedXdr).length<=4*1024*1024&&object(args.intent),'UNSIGNED_ENVELOPE_REQUIRED');publicValue(args.intent);
  const original={id:args.id,networkPassphrase:args.networkPassphrase,address:args.address,unsignedXdr:args.unsignedXdr,unsignedHash:args.unsignedHash,intent:clone(args.intent)};
  need(!old,'WALLET_OPERATION_ALREADY_RESERVED');
  if(args.intent.planId){const p=getPlan(args.intent.planId);need(p&&p.status==='PREPARED'&&!p.execute&&p.configuration.network?.passphrase===args.networkPassphrase&&(!p.configuration.wallet?.address||p.configuration.wallet.address===args.address),'WALLET_PLAN_BINDING');const payload=p.unsignedPayload;need(payload?.kind==='stellar-xdr'&&payload.xdr===args.unsignedXdr&&payload.transactionHash===args.unsignedHash&&payload.source===args.address&&payload.networkPassphrase===args.networkPassphrase,'WALLET_UNSIGNED_PLAN_CHANGED');sameWalletConfiguration(configuration,p.configuration);}
  if(args.intent.sessionId){const session=getSession(args.intent.sessionId);need(session.public.walletAddress===args.address&&session.transactionIds.includes(args.intent.transactionId),'WALLET_SESSION_BINDING');}
  need(args.intent.planId||args.intent.sessionId,'WALLET_SOURCE_SELECTION_REQUIRED');
  need(configuration.network?.passphrase===args.networkPassphrase&&configuration.wallet?.address===args.address,'WALLET_CURRENT_SELECTION_CHANGED');operation={...original,configuration:clone(configuration),state:'RESERVED',createdAt:request.createdAt,originalRequestId:request.id,observations:[],classification:'CLIENT_WALLET_OPERATION'};
 }else{
  need(old,'WALLET_OPERATION_NOT_FOUND');operation=clone(old);
  if(method==='wallet.signed'){
   keys(args,['id','signedXdr','hash','signatureReceipt']);need(old.state==='RESERVED'&&!old.signedXdr,'WALLET_ALREADY_SIGNED');need(decode64(args.signedXdr).length<=4*1024*1024&&sha(args.hash)===old.unsignedHash,'SIGNED_ORIGINAL_BODY_REQUIRED');publicValue(args.signatureReceipt);
   Object.assign(operation,{state:'SIGNED',signedXdr:args.signedXdr,hash:args.hash,signatureReceipt:clone(args.signatureReceipt),signedAt:request.createdAt});
  }else if(method==='wallet.submitting'){
   keys(args,['id']);need(old.state==='SIGNED','WALLET_SUBMISSION_ALREADY_ADMITTED');need(configuration.executionEnabled===true,'EXPLICIT_WALLET_EXECUTION_REQUIRED');sameWalletConfiguration(configuration,old.configuration);
   if(old.intent.planId){const p=getPlan(old.intent.planId);need(!p.expiresAt||Date.parse(p.expiresAt)>Date.parse(request.createdAt),'PLAN_EXPIRED');}
   Object.assign(operation,{state:'SUBMITTING',submittingAt:request.createdAt,submissionRequestId:request.id});
  }else{
   keys(args,['id','originalHTTP','projection']);need(method==='wallet.observed'&&object(args.projection),'WALLET_OBSERVATION_REQUIRED');publicValue(args.originalHTTP);publicValue(args.projection);
   const p=args.projection;need(['NETWORK_PROOF','TRANSACTION_SUBMISSION','TRANSACTION_STATUS'].includes(p.kind)&&p.source==='CLIENT_BROWSER_OBSERVATION','WALLET_OBSERVATION_KIND');
   if(p.networkPassphrase!==undefined)need(p.networkPassphrase===old.networkPassphrase,'WALLET_NETWORK_CHANGED');
   if(p.kind!=='NETWORK_PROOF'){need(old.hash&&p.hash===old.hash,'WALLET_TRANSACTION_CHANGED');need(['SUBMITTING','SUBMITTED','UNCERTAIN','CONFIRMED','FAILED'].includes(old.state),'WALLET_SUBMISSION_NOT_ADMITTED');
    if(p.kind==='TRANSACTION_SUBMISSION'){need(['SUBMITTED','UNCERTAIN'].includes(p.status),'WALLET_SUBMISSION_STATUS');if(!['CONFIRMED','FAILED'].includes(old.state))operation.state=p.status;}
    else{need(['CONFIRMED','FAILED','UNRESOLVED'].includes(p.status),'WALLET_TRANSACTION_STATUS');if(p.status!=='UNRESOLVED'){if(['CONFIRMED','FAILED'].includes(old.state)&&old.state!==p.status)operation.terminalConflict=true;else operation.state=p.status;}else if(!['CONFIRMED','FAILED'].includes(old.state))operation.state='UNCERTAIN';}
   }
   operation.observations.push({requestId:request.id,createdAt:request.createdAt,originalHTTP:clone(args.originalHTTP),projection:clone(p)});
  }
 }
 return{id:'wallet-event-'+request.id,operationId:args.id,method,previousEventId:events.filter(e=>e.operationId===args.id).at(-1)?.id??null,createdAt:request.createdAt,operation};
}
