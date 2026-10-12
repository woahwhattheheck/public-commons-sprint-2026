// SPDX-License-Identifier: MIT
// One retained local-data handoff; original publisher, SF100 and DuckDB own data semantics.
import {mkdir,readdir,rm,lstat,open,link} from 'node:fs/promises';
import {join,dirname,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import {privateDirectory,readJson,readPrivate,hashPrivate,atomicJson,createFile,syncDirectory,identity,digest,bytes,object,fault,stamp,absolute} from '../postgres/publisher/files.mjs';
import {init,appendMany,scan,finalize,checkPage,MAX_DATASET_PAGES,retainDeliveryFile,publishDeliveryFile} from '../../sf100-buyer-dataset-delivery/deliver.mjs';
import {runFrictionlessCommand} from '../frictionless/source.mjs';
import {createNativeDuckDB,parseNativeDuckDBJSON} from '../../../../stellar-forge/mcp-paid-agent/native-duckdb.mjs';
import {nativeDuckDBOperations} from '../../../../stellar-forge/mcp-paid-agent/native-duckdb-schema.mjs';
import {exportLocalDatasetPackage} from './package.mjs';

export const LOCAL_DATASET_SCHEMA='stellar-forge.local-dataset-customer.v1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,HASH=/^[0-9a-f]{64}$/,ID=/^[0-9a-f]{32}$/;
const READS=new Set(['state','sources','inspect-source','views','reviews','review-read','editions','edition','queries','saved-query','exports','export-read','handoffs','operations','operation','file']);
const WRITES=new Set(['review','import','activate','save-query','query','compare','export','source-handoff','handoff','resume']);
const need=(yes,code,message=code,status=400)=>{if(!yes)throw fault(code,message,status);};
const uuid=x=>{need(typeof x==='string'&&UUID.test(x),'LOCAL_REQUEST_ID_REQUIRED');return x;};
const hash=x=>{need(typeof x==='string'&&HASH.test(x),'LOCAL_DIGEST_REQUIRED');return x;};
const errorOf=e=>({code:e.code??e.name??'LOCAL_OPERATION_FAILED',message:String(e.message??e).slice(0,4096)});
const alias=id=>'delivery_'+id.replaceAll('-','');
const fileName=x=>{need(typeof x==='string'&&x.length<=1024&&x.split('/').every(s=>s&&s!=='.'&&s!=='..')&&!/[\\\0]/.test(x),'LOCAL_FILE_NAME_INVALID');return x;};
async function exists(path){try{await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function immutable(directory,name,content){const path=join(directory,name);await retainDeliveryFile(directory,path,content);return path;}

function publicOperation(v){return {id:v.id,kind:v.kind,state:v.state,createdAt:v.createdAt,updatedAt:v.updatedAt,...(v.result===undefined?{}:{result:v.result}),...(v.error?{error:v.error}:{}),deliveryId:v.deliveryId??null};}

/** The caller supplies its already-owned publisher. This function never opens a second publisher/warehouse. */
export async function openLocalDatasetReceiving({publisher,customer,environment=process.env}={}){
 need(publisher&&typeof publisher.candidate==='function'&&publisher.sourceName==='Frictionless Data Package','LOCAL_ORIGINAL_FRICTIONLESS_PUBLISHER_REQUIRED');
 need(object(customer)&&/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(customer.name??'')&&ID.test(customer.workspaceId??''),'LOCAL_ORIGINAL_CUSTOMER_REQUIRED');
 absolute(customer.database);await privateDirectory(customer.database);
 const directory=join(publisher.directory,'local-dataset-receiving');
 await privateDirectory(directory,true);
 for(const name of ['records','requests','native-customer'])await privateDirectory(join(directory,name),true);
 const binding={publisherDirectory:publisher.directory,customer:{name:customer.name,database:customer.database,workspaceId:customer.workspaceId}};
 let settings;
 if(await exists(join(directory,'workspace.json'))){settings=await readJson(join(directory,'workspace.json'));need(settings.schema===LOCAL_DATASET_SCHEMA&&identity(settings.binding)===identity(binding),'LOCAL_WORKSPACE_BINDING_CHANGED','Reopen the original publisher and customer workspace.',409);}
 else{settings={schema:LOCAL_DATASET_SCHEMA,workspaceId:randomUUID(),createdAt:stamp(),binding};await atomicJson(directory,'workspace.json',settings);}
 const client=createNativeDuckDB({manifest:{directory:join(directory,'native-customer')}});
 let closed=false,closing,active=null,admission=Promise.resolve();const pending=new Set(),registered=new Set();
 const check=()=>need(!closed,'LOCAL_WORKSPACE_CLOSED','This original host is closing.',409);
 const rd=id=>join(directory,'records',uuid(id));
 const opPath=id=>join(directory,'requests',uuid(id)+'.json');
 async function operation(id){return publicOperation(await internalOperation(id));}
 async function internalOperation(id){
  try{return await readJson(opPath(id),8*1024*1024);}
  catch(e){
   if(e.code!=='ENOENT')throw e;
   await privateDirectory(join(directory,'requests'));
   throw fault('LOCAL_REQUEST_NOT_FOUND','No request is retained under this original ID.',404);
  }
 }
 async function record(id){return readJson(join(rd(id),'record.json'),16*1024*1024);}
 async function saveRecord(r){r.updatedAt=stamp();await atomicJson(rd(r.id),'record.json',r);return r;}
 async function history(id,op){
  if(!id||!await exists(join(rd(id),'record.json')))return;
  const r=await record(id),item={id:op.id,kind:op.kind,state:op.state,updatedAt:op.updatedAt},i=r.history.findIndex(x=>x.id===op.id);
  if(i<0)r.history.push(item);else r.history[i]=item;
  await saveRecord(r);
 }
 // Reopening only records that the previous owner ended. It never repeats a request.
 for(const name of await readdir(join(directory,'requests'))){
  if(!/^[a-f0-9-]{36}\.json$/.test(name))continue;
  const op=await readJson(join(directory,'requests',name),8*1024*1024);
  if(op.state==='RUNNING'){op.state='INTERRUPTED';op.updatedAt=stamp();op.error={code:'LOCAL_OWNER_ENDED',message:'Inspect retained state, then explicitly resume this exact request.'};await atomicJson(join(directory,'requests'),name,op);await history(op.deliveryId,op);}
 }
 async function original(id,signal){
  const r=await record(id);
  need(r.delivery&&HASH.test(r.delivery.reportSha256),'LOCAL_DELIVERY_NOT_COMPLETE','Receive all original pages first.',409);
  if(!registered.has(id)){
   const result=await client.register({name:alias(id),database:customer.database,sources:[{name:'delivery',reportPath:join(rd(id),'SF100-Read-Result.json'),sha256:r.delivery.reportSha256}]},{expectedWorkspaceId:customer.workspaceId});
   need(result.workspaceId===customer.workspaceId,'LOCAL_CUSTOMER_ID_CHANGED',undefined,409);registered.add(id);
  }
  return {r,call:async(op,args={})=>(await client.call({action:'duckdb',duckdbWorkspace:alias(id),duckdbOperation:op,duckdbRequest:args},{signal})).result};
 }
 function serial(work){check();const p=admission.then(()=>{check();return work();});admission=p.catch(()=>{});return p;}
 function tracked(work){check();const p=Promise.resolve().then(work);pending.add(p);p.finally(()=>pending.delete(p)).catch(()=>{});return p;}
 async function customerRead(id,op,args={},signal){
  check();need(READS.has(op),'LOCAL_READ_OPERATION_INVALID');
  const {call}=await original(id,signal);return call(op,args);
 }
 async function customerBrowser(){
  const result=await client.inspectRegistration({name:customer.name,database:customer.database,sources:[]});
  need(result.workspaceId===customer.workspaceId,'LOCAL_CUSTOMER_ID_CHANGED',undefined,409);
  return {url:result.browserUrl,workspaceId:result.workspaceId};
 }
 async function status({offset=0,limit=25}={}){
  check();need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=100,'LOCAL_PAGE_INVALID');
  const names=(await readdir(join(directory,'records'))).filter(x=>UUID.test(x)).sort();
  const all=[];for(const id of names)if(await exists(join(rd(id),'record.json')))all.push(await record(id));
  all.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));
  return {schema:LOCAL_DATASET_SCHEMA,workspaceId:settings.workspaceId,customer:{name:customer.name,workspaceId:customer.workspaceId},
   active:active?{id:active.id,kind:active.kind}:null,
   records:all.slice(offset,offset+limit).map(r=>({id:r.id,state:r.state,createdAt:r.createdAt,updatedAt:r.updatedAt,runId:r.input.runId,
    dataset:r.binding.dataset,snapshot:r.binding.snapshot,rows:r.progress.rows,total:r.progress.total,pages:r.progress.pages,customerEditionId:r.customer?.edition?.edition_id??null})),
   page:{offset,limit,total:all.length,next:offset+limit<all.length?offset+limit:null}};
 }
 async function resolveCandidate(r){
  const saved=publisher.run(r.input.runId),p=publisher.plan(saved.plan);
  need(saved.data.review?.id===r.input.reviewId&&saved.data.review.candidateDigest===r.input.candidateDigest,'LOCAL_ORIGINAL_REVIEW_CHANGED','Select the current original candidate review before another delivery.',409);
  const candidate=await publisher.candidate(saved.id);
  need(candidate.manifest.candidateDigest===r.input.candidateDigest&&candidate.manifest.planDigest===r.binding.planDigest&&candidate.manifest.dataset.snapshot===r.binding.snapshot,'LOCAL_ORIGINAL_CANDIDATE_CHANGED',undefined,409);
  return {saved,p,...candidate};
 }
 async function prepare(input,op,signal){
  need(typeof input.query==='string'&&input.query.length<=65536&&!new URLSearchParams(input.query).has('cursor'),'LOCAL_QUERY_INVALID','Review an original query without a continuation cursor.');
  need(typeof input.reviewer==='string'&&input.reviewer.trim()&&input.reviewer.length<=240&&typeof input.note==='string'&&input.note.length<=4096,'LOCAL_REVIEW_REQUIRED');
  const saved=publisher.run(uuid(input.runId)),p=publisher.plan(saved.plan);
  need(['REVIEWED','PUBLISHED','PUBLICATION_UNKNOWN'].includes(saved.state)&&saved.data.review?.id===uuid(input.reviewId)&&saved.data.review.candidateDigest===hash(input.candidateDigest),'LOCAL_ORIGINAL_REVIEW_REQUIRED','Use the original publication review for this retained candidate.',409);
  const candidate=await publisher.candidate(saved.id);
  need(candidate.manifest.candidateDigest===input.candidateDigest,'LOCAL_ORIGINAL_CANDIDATE_CHANGED',undefined,409);
  const response=await candidate.dataset.handle({query:new URLSearchParams(input.query)});
  need(response.status===200,'LOCAL_NATIVE_QUERY_REJECTED',response.body?.error??'The original dataset rejected this query.');
  const scope=checkPage(response.body);
  need(scope.snapshot===candidate.manifest.dataset.snapshot,'LOCAL_SNAPSHOT_CHANGED',undefined,409);
  await privateDirectory(rd(op.id),true);await privateDirectory(join(rd(op.id),'pages'),true);
  await immutable(rd(op.id),'preview.json',bytes(response.body));
  await immutable(rd(op.id),'publisher-plan.json',bytes(p.data));
  await immutable(rd(op.id),'candidate.json',bytes(candidate.manifest));
  await immutable(rd(op.id),'original-source.json',await readPrivate(join(publisher.directory,'plans',p.folder,'original-source.json')));
  const r={schema:LOCAL_DATASET_SCHEMA,workspaceId:settings.workspaceId,id:op.id,createdAt:op.createdAt,updatedAt:stamp(),state:'PREPARED',
   input:{runId:saved.id,reviewId:input.reviewId,candidateDigest:input.candidateDigest,query:input.query,reviewer:input.reviewer,note:input.note},
   binding:{planId:p.id,planDigest:p.data.digest,sourceHash:p.data.sourceHash,runtimeSourceHash:p.data.runtimeSourceHash,queryHash:candidate.manifest.queryHash,
    dataset:scope.name,snapshot:scope.snapshot,datasetRows:candidate.manifest.dataset.rowCount,captureSha256:candidate.manifest.extraction.captureSha256},
   scope:{...scope,preview:response.body},progress:{rows:0,pages:0,total:scope.total},customer:{workspaceId:customer.workspaceId,source:'delivery'},
   history:[],exports:[],authorization:{kind:'REVIEWED_LOCAL_OPERATOR_DELIVERY',reviewer:input.reviewer,note:input.note,payment:'NOT_A_PURCHASE_OR_SIGNED_PAYMENT'}};
  if(await exists(join(rd(op.id),'record.json'))){const old=await record(op.id);need(identity(old.input)===identity(r.input)&&identity(old.binding)===identity(r.binding),'LOCAL_PREPARED_BINDING_CHANGED',undefined,409);return {deliveryId:old.id};}
  await saveRecord(r);return {deliveryId:r.id,scope:r.scope};
 }
 async function ensureSource(r,signal){
  const root=rd(r.id);
  if(r.sourceBundle){const got=await hashPrivate(join(root,r.sourceBundle.name),256*1024*1024);need(got.hash===r.sourceBundle.sha256&&got.bytes===r.sourceBundle.bytes,'LOCAL_ORIGINAL_SOURCE_BUNDLE_CHANGED',undefined,409);return;}
  const {p}=await resolveCandidate(r),tmp=join(root,'.sf100-Frictionless-Source.tgz-'+randomUUID());
  try{
   const result=await runFrictionlessCommand(['source-export','--source',join(publisher.directory,'plans',p.folder,'source.json'),'--output',tmp],{env:environment,stdout:null,signal});
   need(result.captureSha256===r.binding.captureSha256,'LOCAL_SOURCE_CAPTURE_CHANGED',undefined,409);
   const actual=await hashPrivate(tmp,256*1024*1024);need(actual.hash===result.sha256&&actual.bytes===result.bytes,'LOCAL_SOURCE_EXPORT_CHANGED');
   const target=join(root,'Frictionless-Source.tgz');
   await publishDeliveryFile(root,tmp,target);
   r=await record(r.id);r.sourceBundle={name:'Frictionless-Source.tgz',bytes:actual.bytes,sha256:actual.hash,captureSha256:result.captureSha256};await saveRecord(r);
  }finally{await rm(tmp,{force:true});}
 }
 async function continueDelivery(input,op,signal){
  let r=await record(uuid(input.deliveryId));
  if(r.delivery){await original(r.id,signal);return {deliveryId:r.id,state:r.state,delivery:r.delivery};}
  await resolveCandidate(r);await ensureSource(r,signal);r=await record(r.id);
  const out=join(rd(r.id),'sf100');await init(out);
  let current=await scan(out,{retainPayload:false});
  const {dataset}=await resolveCandidate(r);
  r.state='DELIVERING';await saveRecord(r);
  // Reconcile every accepted native prefix with its original standalone response/evidence.
  for(const page of current.pages){
   const stem=String(page.index).padStart(5,'0'),raw=await readPrivate(join(rd(r.id),'pages',stem+'.json'),2*1024*1024);
   const evidence=await readPrivate(join(rd(r.id),'pages',stem+'.evidence.json'),2*1024*1024);
   need(page.intent==='local-'+r.id+'-'+stem&&page.sourceSha256===digest(raw)&&page.evidenceSha256===digest(evidence)&&page.signature===r.scope.signature,'LOCAL_ACCEPTED_PREFIX_CHANGED',undefined,409);
  }
  while(!current.pages.length||current.nextCursor!==null){
   if(signal.aborted)throw fault('LOCAL_DELIVERY_PAUSED','The accepted original page prefix is retained.');
   const batch=[];let cursor=current.nextCursor,retainedBytes=0;
   do{
    need(current.pages.length+batch.length<MAX_DATASET_PAGES,'LOCAL_PAGE_LIMIT_REACHED');
    const n=current.pages.length+batch.length,stem=String(n).padStart(5,'0'),query=new URLSearchParams(r.input.query);
    if(n)query.set('cursor',cursor);
    let payload;
    const pagePath=join(rd(r.id),'pages',stem+'.json');
    if(await exists(pagePath))payload=JSON.parse((await readPrivate(pagePath,2*1024*1024)).toString('utf8'));
    else{
     const response=await dataset.handle({query});need(response.status===200,'LOCAL_NATIVE_PAGE_REJECTED',response.body?.error);
     payload=response.body;need(checkPage(payload).signature===r.scope.signature,'LOCAL_PAGE_SCOPE_CHANGED',undefined,409);
     await immutable(join(rd(r.id),'pages'),stem+'.json',bytes(payload));
    }
    const evidence={schema:'stellar-forge.local-dataset-page-authorization.v1',deliveryId:r.id,workspaceId:settings.workspaceId,runId:r.input.runId,
     reviewId:r.input.reviewId,candidateDigest:r.input.candidateDigest,signature:r.scope.signature,index:n,requestCursor:n?cursor:null,
     originalQuery:r.input.query,authorization:r.authorization};
    const evidencePath=await immutable(join(rd(r.id),'pages'),stem+'.evidence.json',bytes(evidence));
    batch.push({page:pagePath,intent:'local-'+r.id+'-'+stem,...(n?{cursor}:{}),evidence:evidencePath});
    retainedBytes+=bytes(payload).length;cursor=payload.page.nextCursor;
    if(signal.aborted)break;
   }while(cursor!==null&&batch.length<32&&retainedBytes<4*1024*1024);
   // One original append validates the whole bounded batch. If it accepts only a
   // prefix before an error, the next explicit continuation reconciles native scan.
   await appendMany(out,batch);
   current=await scan(out,{retainPayload:false});
   r=await record(r.id);r.progress={rows:current.count,pages:current.pages.length,total:current.total};await saveRecord(r);
  }
  if(signal.aborted)throw fault('LOCAL_DELIVERY_PAUSED','All original pages are retained; finalize on explicit resume.');
  await finalize(out);
  current=await scan(out,{retainPayload:false}); // Original complete object, not a synthesized receipt or CLI summary.
  const report=bytes(current);await immutable(rd(r.id),'SF100-Read-Result.json',report);
  const manifestRaw=await readPrivate(join(out,'manifest.json'),8*1024*1024),manifest=JSON.parse(manifestRaw.toString('utf8'));
  const files=[];
  async function collect(path,prefix=''){
   for(const name of (await readdir(path)).sort()){
    if(name.startsWith('.'))continue;
    const file=join(path,name),s=await lstat(file);
    if(s.isDirectory())await collect(file,prefix+name+'/');
    else if(s.isFile()){const v=await hashPrivate(file,512*1024*1024);files.push({name:prefix+name,bytes:v.bytes,sha256:v.hash});}
    else throw fault('LOCAL_DELIVERY_FILE_INVALID');
   }
  }
  await collect(out,'sf100/');
  for(const name of ['SF100-Read-Result.json','Frictionless-Source.tgz','original-source.json','publisher-plan.json','candidate.json','preview.json']){
   const v=await hashPrivate(join(rd(r.id),name),256*1024*1024);files.push({name,bytes:v.bytes,sha256:v.hash});
  }
  await collect(join(rd(r.id),'pages'),'pages/');
  r=await record(r.id);r.delivery={reportSha256:digest(report),manifestSha256:digest(manifestRaw),chain:current.chain,files};r.state='DELIVERED';
  await saveRecord(r);await original(r.id,signal); // Full original Python validator binds every native archive and typed row.
  return {deliveryId:r.id,state:r.state,rows:current.count,pages:current.pages.length,manifestSha256:r.delivery.manifestSha256};
 }
 async function allViews(call){let offset=0,rows=[];for(;;){const p=await call('views',{offset,limit:100});rows.push(...p.views);if(p.next_offset===null)return rows;need(p.next_offset>offset,'LOCAL_CUSTOMER_PAGE_INVALID');offset=p.next_offset;}}
 async function customerAction(input,op,signal,resuming){
  const id=uuid(input.deliveryId),operation=input.operation,args=structuredClone(input.arguments??{});
  need(WRITES.has(operation)&&object(args),'LOCAL_CUSTOMER_OPERATION_INVALID');
  const {r,call}=await original(id,signal);
  if(['export','source-handoff','handoff'].includes(operation))need(args.request_id===op.id.replaceAll('-',''),'LOCAL_NATIVE_REQUEST_ID_CHANGED','Keep the local request UUID, without hyphens, for its native export.');
  if(operation==='review'){need(args.source==='delivery'&&args.source_sha256===r.delivery.reportSha256,'LOCAL_MAPPING_SOURCE_CHANGED');}
  if(operation==='import'){
   const review=await call('review-read',{review_id:hash(args.review_id)});
   need(review.manifest_sha256===r.delivery.manifestSha256,'LOCAL_MAPPING_FROM_ANOTHER_DELIVERY',undefined,409);
  }
  if(operation==='activate'||operation==='source-handoff'){
   const edition=await call('edition',{edition_id:hash(args.edition_id)});
   need(edition.manifest_sha256===r.delivery.manifestSha256,'LOCAL_EDITION_FROM_ANOTHER_DELIVERY',undefined,409);
  }
  if(resuming&&['activate','save-query'].includes(operation)){
   if(operation==='activate'){
    const current=(await allViews(call)).find(x=>x.name.toLowerCase()===args.name.toLowerCase());
    if(current&&current.edition_id===args.edition_id&&current.revision===args.expected_revision+1)return {...current,activation_status:'RECONCILED'};
    need(!current&&args.expected_revision===0||current?.revision===args.expected_revision,'LOCAL_CUSTOMER_CAS_CHANGED','Read the current selection and review a new request.',409);
   }else{
    const queryId=digest(args.name.toLowerCase()),current=await call('saved-query',{query_id:queryId}).catch(e=>{if(/NOT_FOUND/.test(e.code??''))return null;throw e;});
    if(current&&current.revision===args.expected_revision+1&&current.sql===args.sql.trim().replace(/;$/,'').trimEnd()&&identity(current.parameters)===identity(parseNativeDuckDBJSON(Buffer.from(args.parameters_text??'[]'))))return current;
    need(!current&&args.expected_revision===0||current?.revision===args.expected_revision,'LOCAL_CUSTOMER_CAS_CHANGED','Read the current saved recipe and review a new request.',409);
   }
  }
  let value;
  if(resuming&&['export','source-handoff','handoff'].includes(operation)){
   const old=await call('operation',{request_id:args.request_id}).catch(e=>{if(/NOT_FOUND/.test(e.code??''))return null;throw e;});
   if(old?.state==='COMPLETE')value=await call('export-read',{export_id:old.export_id});
   else if(old?.state==='INTERRUPTED')value=await call('resume',{request_id:args.request_id});
   else if(old?.state==='RUNNING')throw fault('LOCAL_NATIVE_REQUEST_RUNNING','The original customer request is still running. Read that request before resuming.',409);
  }
  value??=await call(operation,args);
  const next=await record(id);
  if(operation==='review')next.customer.review=value;
  if(operation==='import'){next.customer.edition=value;next.state='IMPORTED';}
  if(value.export_id&&!next.exports.includes(value.export_id))next.exports.push(value.export_id);
  await saveRecord(next);return value;
 }
 async function perform(op,signal,resuming=false){
  if(op.kind==='prepare')return prepare(op.input,op,signal);
  if(op.kind==='continue')return continueDelivery(op.input,op,signal);
  if(op.kind==='customer')return customerAction(op.input,op,signal,resuming);
  if(op.kind==='package')return exportLocalDatasetPackage({directory:rd(op.deliveryId),record:await record(op.deliveryId),requestId:op.id,input:op.input,
   customerRead:(name,args)=>customerRead(op.deliveryId,name,args,signal),signal,environment});
  throw fault('LOCAL_OPERATION_NOT_FOUND');
 }
 async function launch(op,resuming=false){
  need(!active,'LOCAL_WORKSPACE_BUSY','Continue the current retained operation first.',409);check();
  const controller=new AbortController();op.state='RUNNING';op.updatedAt=stamp();delete op.error;
  let readyResolve,readyReject;const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const current={id:op.id,kind:op.kind,controller,promise:null};active=current;
  current.promise=(async()=>{
   try{
    await atomicJson(join(directory,'requests'),op.id+'.json',op);readyResolve();
    op.result=await perform(op,controller.signal,resuming);op.state='COMPLETE';
   }catch(e){readyReject(e);op.state=controller.signal.aborted||/UNKNOWN|TIMEOUT|NETWORK|OWNER|UNAVAILABLE|RUNNING|PAUSED|ABORT|ECONN/.test(e.code??e.name??'')?'INTERRUPTED':'FAILED';op.error=errorOf(e);
    if(op.kind==='continue'&&op.deliveryId&&await exists(join(rd(op.deliveryId),'record.json'))){const r=await record(op.deliveryId);if(!r.delivery){r.state='PAUSED';await saveRecord(r);}}
   }finally{op.updatedAt=stamp();try{await atomicJson(join(directory,'requests'),op.id+'.json',op);await history(op.deliveryId,op);}finally{if(active===current)active=null;}}
  })();current.promise.catch(()=>{});
  await ready;return {operation:publicOperation(op)};
 }
 async function start(kind,input){
  check();need(object(input)&&input.workspaceId===settings.workspaceId,'LOCAL_WORKSPACE_ID_CHANGED','Review this original workspace before submitting.',409);
  const id=uuid(input.requestId);need(['prepare','continue','customer','package'].includes(kind),'LOCAL_OPERATION_INVALID');
  const deliveryId=kind==='prepare'?id:uuid(input.deliveryId);
  if(await exists(opPath(id))){const old=await internalOperation(id);need(old.kind===kind&&identity(old.input)===identity(input),'LOCAL_REQUEST_INPUT_CHANGED','Keep this request unchanged; use a new ID for different reviewed input.',409);return {operation:publicOperation(old),...(await exists(join(rd(deliveryId),'record.json'))?{record:await record(deliveryId)}:{})};}
  need(!active,'LOCAL_WORKSPACE_BUSY','Continue the current retained operation first.',409);
  const op={schema:LOCAL_DATASET_SCHEMA+'.request',id,deliveryId,kind,input:structuredClone(input),state:'PREPARED',createdAt:stamp(),updatedAt:stamp()};
  await atomicJson(join(directory,'requests'),id+'.json',op);return launch(op);
 }
 async function resume(input){
  need(input.workspaceId===settings.workspaceId,'LOCAL_WORKSPACE_ID_CHANGED',undefined,409);
  const op=await internalOperation(uuid(input.requestId));
  if(op.state==='COMPLETE')return {operation:publicOperation(op)};
  need(['INTERRUPTED','FAILED','PREPARED'].includes(op.state),'LOCAL_REQUEST_RUNNING',undefined,409);return launch(op,true);
 }
 async function cancel(input){
  check();need(input.workspaceId===settings.workspaceId,'LOCAL_WORKSPACE_ID_CHANGED',undefined,409);uuid(input.requestId);uuid(input.operationId);
  if(await exists(opPath(input.requestId))){const op=await internalOperation(input.requestId);need(op.kind==='cancel'&&identity(op.input)===identity(input),'LOCAL_REQUEST_INPUT_CHANGED',undefined,409);return {operation:publicOperation(op)};}
  need(active?.id===input.operationId&&active.kind==='continue','LOCAL_ACTIVE_DELIVERY_REQUIRED','Only the current local page delivery can be paused.',409);
  const op={schema:LOCAL_DATASET_SCHEMA+'.request',id:input.requestId,kind:'cancel',input:structuredClone(input),state:'COMPLETE',createdAt:stamp(),updatedAt:stamp(),result:{operationId:input.operationId,pauseRequested:true}};
  await atomicJson(join(directory,'requests'),op.id+'.json',op);active.controller.abort();return {operation:publicOperation(op)};
 }
 async function file(id,name){
  const r=await record(uuid(id));fileName(name);const selected=r.delivery?.files.find(x=>x.name===name);need(selected,'LOCAL_FILE_NOT_DECLARED',undefined,404);
  let parent=dirname(join(rd(id),name));while(parent!==rd(id)){await privateDirectory(parent);parent=dirname(parent);}
  const actual=await hashPrivate(join(rd(id),name),512*1024*1024);need(actual.hash===selected.sha256&&actual.bytes===selected.bytes,'LOCAL_FILE_CHANGED',undefined,409);
  return {...selected,path:join(rd(id),name)};
 }
 async function packageFile(id,name){
  fileName(name);const op=await internalOperation(uuid(id));need(op.kind==='package'&&op.state==='COMPLETE','LOCAL_PACKAGE_NOT_COMPLETE',undefined,409);
  const selected=op.result.files.find(x=>x.name===name);need(selected,'LOCAL_FILE_NOT_DECLARED',undefined,404);
  const path=join(rd(op.deliveryId),'packages',op.id,name),actual=await hashPrivate(path,16*1024*1024*1024);
  need(actual.hash===selected.sha256&&actual.bytes===selected.bytes,'LOCAL_FILE_CHANGED',undefined,409);return {...selected,path};
 }
 const api={directory,workspaceId:settings.workspaceId,publisher,customer:binding.customer,status,record,operation,customerBrowser,
  customerRead:(...args)=>tracked(()=>customerRead(...args)),file,packageFile,start:(...args)=>serial(()=>start(...args)),resume:(...args)=>serial(()=>resume(...args)),cancel:(...args)=>serial(()=>cancel(...args)),
  async wait(id){const current=active;if(current?.id===id)await current.promise;return operation(id);},
  close(){if(closing)return closing;closed=true;if(active)active.controller.abort();closing=(async()=>{await admission;await active?.promise;await Promise.allSettled([...pending]);await client.close();})();return closing;}};
 return Object.freeze(api);
}
