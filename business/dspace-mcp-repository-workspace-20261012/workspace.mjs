import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Store} from './store.mjs';
import {NativeBridge,extractObjects,validateProfile,cleanError} from './bridge.mjs';
import {clone,digest,json,fail,requireText,applyPatch,fieldChanges,checkChanges,inverseOperations,simpleMetadata,metadataContains,at} from './patch.mjs';

const READ=new Set(['dspace_auth_status','dspace_search','dspace_get_item','dspace_list_communities','dspace_list_collections','dspace_get_item_fulltext','dspace_get_bitstream_content','dspace_list_workspace_items']);
const WRITE=new Set(['dspace_update_item_metadata','dspace_move_item','dspace_upload_bitstream','dspace_create_workspace_item','dspace_update_workspace_item','dspace_create_item']);
const LIMITS={selection_items:500,plan_steps:100,asset_bytes:20*1024*1024};
const now=()=>new Date().toISOString(),id=prefix=>prefix+'-'+randomUUID();
const objectId=o=>String(o.uuid??o.id);
const title=o=>o.name??o.metadata?.['dc.title']?.[0]?.value??o.sections?.traditionalpageone?.['dc.title']?.[0]?.value??objectId(o);
const statusOf=steps=>steps.every(s=>['APPLIED','RECOVERED'].includes(s.status))?'APPLIED':steps.some(s=>s.status==='CONFLICT')?'CONFLICT':steps.some(s=>['UNCERTAIN','RUNNING'].includes(s.status))?'UNCERTAIN':steps.some(s=>['APPLIED','RECOVERED'].includes(s.status))?'PARTIAL':'FAILED';
const createdId=(requests,type)=>requests.find(r=>r.method==='POST'&&r.status>=200&&r.status<300&&r.body?.type===type)?.body;
const failedFinalResponses=requests=>[...new Map(requests.filter(r=>!authPathForStep(r.url)).map(r=>[r.method+' '+r.url,r])).values()].some(r=>r.status>=400||r.error);
function base64(value){if(typeof value!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))fail('INVALID_FILE','Use base64-encoded original file bytes.');return Buffer.from(value,'base64');}

export class RepositoryWorkspace{
 constructor({directory,upstreamRoot}){
  this.store=new Store(directory);this.directory=this.store.directory;this.upstreamRoot=upstreamRoot;
  this.bridges=new Map();this.tail=Promise.resolve();
  this.upstream={repository:'4Science/dspace-mcp',commit:'ee503ba97910f592867c897c1fa938f9e029d03c',tree:'6386328dd49282b98840b4dd41340b9c8a110b78',license:'AGPL-3.0'};
 }
 put(kind,value){
  let summary;
  if(kind==='captures')summary=Object.fromEntries(['id','label','profile_id','tool','args','created_at','principal','object_count','request_count','is_error','source_mode'].map(k=>[k,value[k]]));
  else if(kind==='plans')summary=Object.fromEntries(['id','name','profile_id','created_at','previous_plan_id','step_count','status','review','latest_execution_id'].map(k=>[k,value[k]]));
  else if(kind==='executions')summary=Object.fromEntries(['id','plan_id','profile_id','principal','status','created_at','updated_at','step_count'].map(k=>[k,value[k]]));
  else if(kind==='requests')summary={id:value.id,method:value.method,url:value.url,status:value.status,body_sha256:value.body_sha256,started_at:value.started_at};
  else summary=value;
  this.store.put(kind,value.id,value,summary);return value;
 }
 save(kind,value){return this.store.tx(()=>this.put(kind,value));}
 state(){return {schema:'dspace-repository-workspace/v1',revision:this.store.revision(),upstream:this.upstream,selected_profile_id:this.store.meta('selected_profile_id'),profiles:this.store.list('profiles'),captures:this.store.list('captures'),selections:this.store.list('selections'),plans:this.store.list('plans'),executions:this.store.list('executions'),assets:this.store.list('assets'),tools:this.store.meta('tools')??[],limits:LIMITS};}
 profile(profileId){return this.store.get('profiles',profileId||this.store.meta('selected_profile_id')||'');}
 requests(ids){return ids.map(v=>this.store.get('requests',typeof v==='string'?v:v.id));}
 read(kind,recordId,{offset=0,limit=50}={}){
  const doc=this.store.get(kind,recordId);
  if(kind==='captures'){
   doc.requests=this.requests(doc.requests);const rows=doc.objects;
   offset=Math.max(0,Number(offset)||0);limit=Math.max(1,Math.min(100,Number(limit)||50));
   return {...doc,rows:rows.slice(offset,offset+limit),total:rows.length,offset,limit};
  }
  if(kind==='selections'){
   const rows=doc.members.map(m=>({...m,object:this.sourceObject(m.capture_id,m.uuid,m.type)}));
   offset=Math.max(0,Number(offset)||0);limit=Math.max(1,Math.min(100,Number(limit)||50));
   return {...doc,rows:rows.slice(offset,offset+limit),total:rows.length,offset,limit};
  }
  if(kind==='executions'){for(const s of doc.steps)s.requests=this.requests(s.requests||[]);}
  return doc;
 }
 sourceObject(captureId,uuid,type){const capture=this.store.get('captures',captureId),object=capture.objects.find(o=>objectId(o)===String(uuid)&&(!type||o.type===type));if(!object)fail('SOURCE_NOT_FOUND','The selected original object is absent from its source capture.');return clone(object);}
 bridge(profile,observer){
  let b=this.bridges.get(profile.id);if(!b){b=new NativeBridge(profile,{upstreamRoot:this.upstreamRoot});this.bridges.set(profile.id,b);}b.observe=observer??(()=>{});return b;
 }
 observer(ids,onRecord=()=>{}){
  return event=>{
   const prior=this.store.maybe('requests',event.id)??{};
   const {body_bytes,phase,...rest}=event;
   this.store.tx(()=>{
    const record={...prior,...rest};
    if(body_bytes!==undefined&&body_bytes!==null){const file=this.store.blob(body_bytes);record.body_sha256=file.sha256;record.body_bytes=file.bytes;}
    this.put('requests',record);
    if(!ids.includes(record.id))ids.push(record.id);
    onRecord(record);
   });
  };
 }
 async collect(profile,fn,{onRecord}={}){
  const requestIds=[],bridge=this.bridge(profile,this.observer(requestIds,onRecord));
  let result,error;
  try{result=await fn(bridge);}catch(e){error=e;}
  finally{bridge.observe=()=>{};}
  return {result,error,requestIds,requests:this.requests(requestIds)};
 }
 async status(profile){
  const collection=await this.collect(profile,b=>b.status());
  if(collection.error)throw collection.error;
  const updated={...profile,connection:collection.result};this.save('profiles',updated);
  const bridge=this.bridges.get(profile.id);this.store.tx(()=>this.store.meta('tools',bridge.tools));
  return collection.result;
 }
 dispatch(action,input){const task=this.tail.then(()=>this.perform(action,input));this.tail=task.catch(()=>{});return task;}
 async perform(action,input){
  requireText(input?.actor,'Staff actor',160);requireText(input?.operationId,'Operation ID',200);
  if(!Number.isInteger(input.revision))fail('INVALID_REVISION','Include the current workspace revision.');
  const reservation=this.store.begin(action,input);
  if(reservation.existing){
   const op=reservation.existing;
   if(op.status==='COMPLETE')return {...op.result,revision:this.store.revision(),replayed:true};
   if(op.status==='FAILED')fail(op.error.code,op.error.message,op.error.status);
   if(action==='execute-plan'&&this.store.maybe('executions',input.operationId))return {execution_id:input.operationId,status:this.store.get('executions',input.operationId).status,revision:this.store.revision(),replayed:true};
   fail('OPERATION_RUNNING','Inspect this original operation before changing or repeating it.',409);
  }
  try{
   let result;
   if(action==='save-profile')result=this.saveProfile(input);
   else if(action==='select-profile'){this.profile(input.profile_id);this.store.tx(()=>this.store.meta('selected_profile_id',input.profile_id));result={profile_id:input.profile_id};}
   else if(action==='connect'){const p=this.profile(input.profile_id);const old=this.bridges.get(p.id);if(old){await old.close();this.bridges.delete(p.id);}result={profile_id:p.id,...await this.status(p),tools:this.store.meta('tools')};}
   else if(action==='capture')result=await this.capture(input);
   else if(action==='import-capture')result=this.importCapture(input);
   else if(action==='save-selection')result=this.selection(input);
   else if(action==='upload-asset')result=this.upload(input);
   else if(action==='prepare-plan')result=await this.prepare(input);
   else if(action==='review-plan')result=this.review(input);
   else if(action==='execute-plan')result=await this.execute(input);
   else if(action==='recover-execution')result=await this.recover(input);
   else if(action==='prepare-reversal')result=await this.reversal(input);
   else if(action==='restore'){const savedOp=this.store.get('operations',input.operationId);result=this.store.restore(base64(input.content_b64));this.store.tx(()=>this.put('operations',savedOp));}
   else fail('UNKNOWN_ACTION','Unknown repository workspace action.',404);
   this.store.finish(input.operationId,result);return {...result,revision:this.store.revision()};
  }catch(error){
   const safe=Object.assign(new Error(cleanError(error)),{code:error.code??'ACTION_FAILED',status:error.status??500,current_revision:error.current_revision});
   this.store.finish(input.operationId,null,safe);throw safe;
  }
 }
 saveProfile(input){
  const auth_env=input.auth_env??{token:'DSPACE_TOKEN',user:'DSPACE_USER',password:'DSPACE_PASSWORD'};
  const p={id:id('profile'),name:requireText(input.name,'Repository name',160),base_url:input.base_url,auth_env,created_at:now(),previous_profile_id:input.previous_profile_id??null,connection:null};
  p.base_url=validateProfile(p);if(p.previous_profile_id)this.profile(p.previous_profile_id);
  this.store.tx(()=>{this.put('profiles',p);this.store.meta('selected_profile_id',p.id);});return {profile_id:p.id};
 }
 async capture(input){
  const p=this.profile(input.profile_id),tool=requireText(input.tool,'Original read tool',100),args=clone(input.args??{});
  if(!READ.has(tool))fail('READ_TOOL_REQUIRED','Use one of the original discovery/content tools.');
  if(args.outputPath||args.filePath)fail('INVALID_FILE_PATH','The workspace assigns local receiving paths.');
  const captureId=id('capture'),assets=[];
  let outputPath;
  if(tool==='dspace_get_bitstream_content'){outputPath=path.join(this.directory,'receiving-'+captureId);args.outputPath=outputPath;}
  const native=await this.collect(p,async b=>{
   const principal=await b.status();const result=await b.call(tool,args);
   if(tool==='dspace_get_item'&&!result.isError)await b.owner(args.uuid);
   return {principal:principal.principal,result};
  });
  if(outputPath&&fs.existsSync(outputPath)){
   const bytes=fs.readFileSync(outputPath);
   try{
    if(bytes.length>LIMITS.asset_bytes)fail('FILE_TOO_LARGE','Original content exceeds the receiving limit.',413);
    const response=native.requests.findLast(r=>r.url.includes('/bitstreams/'+args.bitstreamUuid+'/content')&&r.status<400);
    const asset=this.asset(bytes,'bitstream-'+args.bitstreamUuid,response?.content_type||'application/octet-stream',{profile_id:p.id,bitstream_uuid:args.bitstreamUuid});assets.push(asset.id);
   }finally{fs.unlinkSync(outputPath);}
  }
  const storedArgs=clone(input.args??{});
  const record={id:captureId,label:input.label||tool,profile_id:p.id,tool,args:storedArgs,created_at:now(),principal:native.result?.principal??null,result:native.result?.result??{isError:true,content:[{type:'text',text:cleanError(native.error)}]},requests:native.requestIds,objects:extractObjects(native.requests),assets,source_mode:'native-mcp'};
  record.object_count=record.objects.length;record.request_count=record.requests.length;record.is_error=!!native.error||!!record.result?.isError||failedFinalResponses(native.requests);
  this.save('captures',record);
  return {capture_id:record.id,is_error:record.is_error,object_count:record.object_count,asset_ids:assets};
 }
 importCapture(input){
  const sourceBytes=base64(input.content_b64),source=JSON.parse(sourceBytes.toString('utf8'));
  if(source.schema!=='dspace-source-capture/v1'||!Array.isArray(source.requests))fail('INVALID_CAPTURE','Use a dspace-source-capture/v1 source bundle.');
  const url=validateProfile({base_url:source.base_url,auth_env:{}});
  let p=this.store.list('profiles').find(p=>p.base_url===url);
  if(!p){const r=this.saveProfile({name:source.name||'Imported repository',base_url:url,auth_env:{token:'',user:'',password:''}});p=this.profile(r.profile_id);}
  const requestIds=[];
  for(const r of source.requests){
   const u=new URL(r.url);if(!u.href.startsWith(url+'/'))fail('SOURCE_TARGET_MISMATCH','Every imported response must belong to the exact repository.');
   let bytes;
   if(r.body_base64!==undefined)bytes=base64(r.body_base64);
   else if(typeof r.body_text==='string')bytes=Buffer.from(r.body_text);
   else if(r.body!==undefined)bytes=Buffer.from(JSON.stringify(r.body));
   else fail('SOURCE_BODY_REQUIRED','Bundle original response bytes or a labeled native response object.');
   const sha=digest(bytes);if(r.body_sha256&&sha!==r.body_sha256)fail('SOURCE_DIGEST_MISMATCH','Original response digest differs.');
   let body=r.body;try{body=JSON.parse(bytes.toString('utf8'));}catch{body=bytes.toString('utf8');}
   if(r.status!==undefined&&r.status!==null&&(!Number.isInteger(r.status)||r.status<100||r.status>599))fail('INVALID_CAPTURE','An observed HTTP status must be an integer from 100 through 599, or null when unknown.');
   const req={id:id('source'),source_request_id:r.id??null,method:r.method||'GET',url:r.url,status:r.status??null,received_at:r.received_at??null,started_at:r.received_at??null,content_type:r.content_type??null,body,body_sha256:sha,body_bytes:bytes.length,source_mode:r.source_mode||source.source_mode||(r.body_base64||r.body_text?'retained-response-bytes':'retained-native-object')};
   this.store.tx(()=>{this.store.blob(bytes);this.put('requests',req);});requestIds.push(req.id);
  }
  const sourceContext=Object.fromEntries(Object.entries(source).filter(([key])=>!['requests','files'].includes(key)));
  const sourceBundle=this.store.tx(()=>this.store.blob(sourceBytes));
  const requests=this.requests(requestIds),capture={id:id('capture'),label:source.name||input.filename||'Imported repository source',profile_id:p.id,tool:'source-import',args:{},created_at:now(),principal:null,result:{content:[{type:'text',text:'Retained original repository source imported.'}]},requests:requestIds,objects:extractObjects(requests),assets:[],source_mode:source.source_mode||'source-import',source_context:sourceContext,source_bundle:{...sourceBundle,name:path.basename(input.filename||'repository-source.json')}};
  for(const f of source.files||[]){if(!f.content_b64)continue;const bytes=base64(f.content_b64);if(f.sha256&&digest(bytes)!==f.sha256)fail('SOURCE_DIGEST_MISMATCH','Original file digest differs.');capture.assets.push(this.asset(bytes,f.name||f.path,f.content_type||'application/octet-stream',{profile_id:p.id,bitstream_uuid:f.bitstream_uuid}).id);}
  capture.object_count=capture.objects.length;capture.request_count=requestIds.length;capture.is_error=requests.some(r=>r.status>=400);this.save('captures',capture);
  return {capture_id:capture.id,profile_id:p.id,object_count:capture.object_count};
 }
 selection(input){
  const p=this.profile(input.profile_id);requireText(input.name,'Selection name',160);
  if(!Array.isArray(input.members)||!input.members.length||input.members.length>LIMITS.selection_items)fail('INVALID_SELECTION','Select 1–500 original records.');
  const seen=new Set(),members=[];
  for(const member of input.members){
   const capture=this.store.get('captures',member.capture_id);if(this.profile(capture.profile_id).base_url!==p.base_url)fail('SOURCE_TARGET_MISMATCH','Selection records belong to another repository.');
   const object=this.sourceObject(member.capture_id,member.uuid,member.type);const key=object.type+':'+objectId(object);if(seen.has(key))continue;seen.add(key);
   members.push({capture_id:capture.id,uuid:objectId(object),type:object.type,name:title(object)});
  }
  if(input.previous_selection_id)this.store.get('selections',input.previous_selection_id);
  const record={id:id('selection'),name:input.name,profile_id:p.id,members,created_at:now(),previous_selection_id:input.previous_selection_id??null};this.save('selections',record);return {selection_id:record.id};
 }
 asset(bytes,name,media_type,extra={}){
  if(bytes.length>LIMITS.asset_bytes)fail('FILE_TOO_LARGE','One received file may be at most20MiB.',413);
  const safeName=path.basename(requireText(name,'File name',240));const record={id:id('asset'),name:safeName,media_type:media_type||'application/octet-stream',bytes:bytes.length,sha256:digest(bytes),created_at:now(),...extra};
  this.store.tx(()=>{this.store.blob(bytes);this.put('assets',record);});return record;
 }
 upload(input){const a=this.asset(base64(input.content_b64),input.name,input.media_type);return {asset_id:a.id,sha256:a.sha256,bytes:a.bytes};}
 async prepare(input){
  const p=this.profile(input.profile_id);requireText(input.name,'Plan name',160);
  if(!Array.isArray(input.steps)||!input.steps.length||input.steps.length>LIMITS.plan_steps)fail('INVALID_PLAN','Provide 1–100 exact native action steps.');
  const steps=[];
  for(const [index,original]of input.steps.entries()){
   if(!WRITE.has(original.tool))fail('INVALID_TOOL','Choose an implemented metadata, file, move or creation action.');
   const step={id:'step-'+(index+1),tool:original.tool,args:clone(original.args??{}),source_capture_id:original.source_capture_id??null,subject_id:original.subject_id??null,asset_id:original.asset_id??null,requests:[],changes:[],before:null,after:null,preconditions:{}};
   if(step.args.filePath||step.args.outputPath)fail('INVALID_FILE_PATH','Use a retained file asset.');
   const create=['dspace_create_item','dspace_create_workspace_item'].includes(step.tool);
   if(!create){
    const subject=String(step.args.uuid??step.args.itemUuid??step.args.id??step.subject_id??'');
    if(!step.source_capture_id)fail('SOURCE_REQUIRED','Choose the retained original source for each existing object.');
    const capture=this.store.get('captures',step.source_capture_id);
    if(this.profile(capture.profile_id).base_url!==p.base_url)fail('SOURCE_TARGET_MISMATCH','The selected source belongs to another repository.');
    step.before=this.sourceObject(capture.id,subject,step.tool==='dspace_update_workspace_item'?'workspaceitem':'item');step.subject_id=subject;
   }
   if(step.tool==='dspace_update_item_metadata'||step.tool==='dspace_update_workspace_item'){
    const root=step.tool==='dspace_update_item_metadata'?'metadata':'sections';
    step.after=applyPatch(step.before,step.args.operations,{root});step.changes=fieldChanges(step.before,step.after,step.args.operations,root);
    for(const change of step.changes){
     if(change.path.split('/').some(part=>part.startsWith('relation.')))fail('GENERATED_METADATA_READ_ONLY','DSpace generates relation.* fields. Edit the original linked entity or relationship workflow.',409);
     const virtual=entry=>(Array.isArray(entry.value)?entry.value:[]).filter(v=>typeof v?.authority==='string'&&v.authority.startsWith('virtual::')).map(value=>clone(value));
     if(json(virtual(change.before))!==json(virtual(change.after)))fail('GENERATED_METADATA_READ_ONLY','Generated virtual metadata belongs to its linked entity. Preserve these values and edit the original linked record.',409);
    }
    step.preconditions={root,fields:step.changes.map(c=>({path:c.path,...c.before}))};
   }else if(step.tool==='dspace_move_item'){
    const native=await this.collect(p,async b=>({owner:await b.owner(step.subject_id),target:await b.collection(requireText(step.args.targetCollectionUuid,'Target collection UUID',100))}));
    if(native.error)throw native.error;step.requests=native.requestIds;step.preconditions={owner_uuid:native.result.owner.uuid,target_collection:native.result.target};
    step.after={owningCollection:native.result.target};step.changes=[{path:'/owningCollection',before:{present:true,value:native.result.owner},after:{present:true,value:native.result.target}}];
   }else if(step.tool==='dspace_upload_bitstream'){
    const asset=this.store.get('assets',requireText(step.asset_id,'File asset ID',100));step.asset=asset;
    const native=await this.collect(p,async b=>{const bundle=(await b.bundles(step.subject_id)).find(v=>v.name===(step.args.bundleName||'ORIGINAL'));return {bundle:bundle??null,bitstreams:bundle?await b.bitstreams(bundle.uuid):[]};});
    if(native.error)throw native.error;step.requests=native.requestIds;step.preconditions={bundle_uuid:native.result.bundle?.uuid??null,bitstream_ids:native.result.bitstreams.map(x=>x.uuid)};step.after={file:asset,bundle:step.args.bundleName||'ORIGINAL'};
   }else{
    requireText(step.args.owningCollectionUuid,'Explicit owning collection UUID',100);
    const native=await this.collect(p,b=>b.collection(step.args.owningCollectionUuid));if(native.error)throw native.error;step.requests=native.requestIds;step.before={collection:native.result};
    step.after={metadata:simpleMetadata(step.args.metadata??{}),collection_uuid:step.args.owningCollectionUuid,workflow:step.tool==='dspace_create_item'?'Archived immediately':'Draft workspace submission'};
    if(step.tool==='dspace_create_item'&&!step.after.metadata['dc.title']?.length)fail('TITLE_REQUIRED','New archived items need an explicit title.');
   }
   steps.push(step);
  }
  if(input.previous_plan_id)this.store.get('plans',input.previous_plan_id);
  const plan={id:id('plan'),name:input.name,profile_id:p.id,created_at:now(),previous_plan_id:input.previous_plan_id??null,steps,step_count:steps.length,status:'PREPARED',review:null,latest_execution_id:null,expected_principal:p.connection?.authenticated?p.connection.principal:null};
  this.save('plans',plan);return {plan_id:plan.id};
 }
 review(input){
  const plan=this.store.get('plans',input.plan_id);if(!['PREPARED','CHANGES_REQUESTED','APPROVED'].includes(plan.status))fail('PLAN_ALREADY_EXECUTED','Create a corrected successor plan for an executed source.',409);
  if(!['APPROVED','CHANGES_REQUESTED'].includes(input.decision))fail('INVALID_REVIEW','Choose approve or request changes.');
  plan.review={actor:input.actor,decision:input.decision,note:requireText(input.note,'Review note',6000),at:now()};plan.status=input.decision==='APPROVED'?'APPROVED':'CHANGES_REQUESTED';this.save('plans',plan);return {plan_id:plan.id,status:plan.status};
 }
 async subject(bridge,step){return step.tool==='dspace_update_workspace_item'?bridge.workspace(step.subject_id):bridge.item(step.subject_id);}
 progress(execution,step,record){
  if(record&&!step.requests.includes(record.id))step.requests.push(record.id);
  execution.updated_at=now();this.put('executions',execution);
 }
 async execute(input){
  const plan=this.store.get('plans',input.plan_id);if(plan.status!=='APPROVED'||plan.review?.decision!=='APPROVED')fail('PLAN_REVIEW_REQUIRED','Save the reviewed exact source plan before applying it.',409);
  const p=this.profile(plan.profile_id),connection=await this.status(p);
  if(!connection.authenticated||!connection.principal?.uuid)fail('AUTHENTICATION_REQUIRED','Connect the intended DSpace staff account before applying repository changes.',401);
  if(plan.expected_principal&&plan.expected_principal.uuid!==connection.principal.uuid)fail('PRINCIPAL_CHANGED','The original plan was prepared with another DSpace staff principal.',409);
  const execution={id:input.operationId,plan_id:plan.id,profile_id:p.id,principal:connection.principal,actor:input.actor,created_at:now(),updated_at:now(),status:'RUNNING',step_count:plan.steps.length,steps:plan.steps.map(s=>({...clone(s),status:'PENDING',requests:[],result:null,error:null,observed_subject_id:null}))};
  plan.status='RUNNING';plan.latest_execution_id=execution.id;this.store.tx(()=>{this.put('executions',execution);this.put('plans',plan);});
  return this.runExecution(execution,plan,p);
 }
 async runExecution(execution,plan,p){
  for(const step of execution.steps){
   if(step.status!=='PENDING')continue;
   const requestIds=step.requests,bridge=this.bridge(p,this.observer(requestIds,r=>this.progress(execution,step,r)));
   let localPath;
   try{
    const status=await bridge.status();if(status.principal?.uuid!==execution.principal.uuid)fail('PRINCIPAL_CHANGED','The saved execution principal differs from the current native session.',409);
    if(step.changes.length&&['dspace_update_item_metadata','dspace_update_workspace_item'].includes(step.tool)){
     const current=await this.subject(bridge,step),conflicts=checkChanges(current,step.changes);
     step.preflight=current;if(conflicts.length)fail('SOURCE_CONFLICT','Staff changed a planned field. Capture it and create a corrected plan.',409,{conflicts});
    }else if(step.tool==='dspace_move_item'){
     const owner=await bridge.owner(step.subject_id);step.preflight={owner};
     if(owner.uuid!==step.preconditions.owner_uuid)fail('SOURCE_CONFLICT','The original owning collection changed after review.',409);
    }else if(step.tool==='dspace_upload_bitstream'){
     const bundle=(await bridge.bundles(step.subject_id)).find(v=>v.name===(step.args.bundleName||'ORIGINAL'));
     const files=bundle?await bridge.bitstreams(bundle.uuid):[];
     step.pre_dispatch={bundle_uuid:bundle?.uuid??null,bitstream_ids:files.map(v=>v.uuid),recorded_at:now()};
    }else if(step.tool==='dspace_create_workspace_item')step.existing_workspace_ids=(await bridge.workspaceList()).map(x=>String(x.id));
    step.status='RUNNING';step.started_at=now();this.save('executions',execution);
    const args=clone(step.args);
    if(step.tool==='dspace_upload_bitstream'){
     const asset=this.store.get('assets',step.asset_id),raw=this.store.bytes(asset.sha256);
     localPath=path.join(this.directory,'upload-'+execution.id.replace(/[^a-zA-Z0-9_-]/g,'')+'-'+step.id+'-'+asset.name);
     fs.writeFileSync(localPath,raw,{mode:0o600,flag:'wx'});args.filePath=localPath;
    }
    const response=await bridge.call(step.tool,args);step.result=response;
    if(response.isError)fail('NATIVE_ACTION_FAILED',response.content?.filter(x=>x.type==='text').map(x=>x.text).join('\n')||'Original MCP action failed.',502);
    await this.inspectApplied(bridge,step);
    step.status='APPLIED';step.completed_at=now();this.retainOutcome(execution,step);this.save('executions',execution);
   }catch(error){
    step.error={code:error.code||'NATIVE_ACTION_FAILED',message:cleanError(error),conflicts:error.conflicts};
    const writeRequests=this.requests(requestIds).filter(r=>!['GET','HEAD'].includes(r.method)&&!authPathForStep(r.url));
    step.status=error.code==='SOURCE_CONFLICT'||error.code==='PRINCIPAL_CHANGED'?'CONFLICT':writeRequests.some(r=>r.status==null||r.status<400||r.status>=500||r.status===408)?'UNCERTAIN':'FAILED';
    this.save('executions',execution);break;
   }finally{bridge.observe=()=>{};if(localPath&&fs.existsSync(localPath))fs.unlinkSync(localPath);}
  }
  execution.status=statusOf(execution.steps);execution.updated_at=now();plan.status=execution.status;this.store.tx(()=>{this.put('executions',execution);this.put('plans',plan);});
  return {execution_id:execution.id,plan_id:plan.id,status:execution.status};
 }
 async inspectApplied(bridge,step,resolvedSubject){
  const requests=this.requests(step.requests),createdType=step.tool==='dspace_create_workspace_item'?'workspaceitem':step.tool==='dspace_upload_bitstream'?'bitstream':'item';
  const created=createdId(requests,createdType);
  if(step.tool==='dspace_update_item_metadata'||step.tool==='dspace_update_workspace_item'){
   const current=await this.subject(bridge,step);step.after_observed=current;
   if(checkChanges(current,step.changes,'after').length)fail('POSTCONDITION_MISMATCH','The native record differs from the reviewed expected fields.',409);
   step.observed_subject_id=step.subject_id;return;
  }
  if(step.tool==='dspace_move_item'){
   const owner=await bridge.owner(step.subject_id);step.after_observed={owner};if(owner.uuid!==step.args.targetCollectionUuid)fail('POSTCONDITION_MISMATCH','The native owning collection differs from the selected destination.',409);step.observed_subject_id=step.subject_id;return;
  }
  const subject=String(resolvedSubject??created?.uuid??created?.id??step.observed_subject_id??'');
  if(!subject)fail('SUBJECT_UNRESOLVED','Inspect the original native response or choose its observed created subject.',409);
  if(created&&subject!==String(created.uuid??created.id))fail('SOURCE_TARGET_MISMATCH','The supplied subject differs from the original successful create response.',409);
  if(step.tool==='dspace_create_workspace_item'){
   const current=await bridge.workspace(subject);step.after_observed=current;
   const embedded=current._embedded?.item,section=current.sections?.traditionalpageone??{};
   const md=embedded?.metadata??section;
   if(!metadataContains({metadata:md},step.after.metadata))fail('POSTCONDITION_MISMATCH','The created draft does not yet contain the planned metadata.',409);
   const collection=current._embedded?.collection??await bridge.workspaceCollection(subject);
   if(collection?.uuid!==step.args.owningCollectionUuid)fail('SOURCE_TARGET_MISMATCH','The observed draft belongs to another collection.',409);
   if((step.existing_workspace_ids||[]).includes(subject))fail('SOURCE_TARGET_MISMATCH','The selected draft existed before this creation.',409);
  }else if(step.tool==='dspace_create_item'){
   const current=await bridge.item(subject),owner=await bridge.owner(subject);step.after_observed=current;
   if(owner.uuid!==step.args.owningCollectionUuid||!current.inArchive||!metadataContains(current,step.after.metadata))fail('POSTCONDITION_MISMATCH','The observed archived item does not match the original plan.',409);
  }else{
   if((step.pre_dispatch?.bitstream_ids??step.preconditions.bitstream_ids??[]).includes(subject))fail('SOURCE_TARGET_MISMATCH','The selected file existed before this upload. Recover its newly created native file instead.',409);
   const bundles=await bridge.bundles(step.subject_id),bundle=bundles.find(b=>b.name===(step.args.bundleName||'ORIGINAL'));
   if(!bundle)fail('POSTCONDITION_MISMATCH','The intended file bundle is absent.',409);
   const files=await bridge.bitstreams(bundle.uuid),file=files.find(x=>x.uuid===subject);if(!file)fail('SOURCE_TARGET_MISMATCH','The observed file is not in the original item bundle.',409);
   const downloaded=await bridge.download(subject),asset=this.store.get('assets',step.asset_id);
   if(digest(Buffer.from(downloaded.data))!==asset.sha256)fail('POSTCONDITION_MISMATCH','The uploaded native file bytes differ from the retained asset.',409);
   step.after_observed=file;
  }
  step.observed_subject_id=subject;
 }
 retainOutcome(execution,step){
  if(step.result_capture_id)return;
  const objects=extractObjects(this.requests(step.requests));
  if(step.after_observed?.type){const current=step.after_observed,key=objectId(current),index=objects.findIndex(o=>o.type===current.type&&objectId(o)===key);if(index>=0)objects[index]=clone(current);else objects.push(clone(current));}
  const capture={id:id('capture'),label:'Saved result: '+step.tool+' '+(step.observed_subject_id||step.subject_id||''),profile_id:execution.profile_id,tool:step.tool,args:clone(step.args),created_at:now(),principal:execution.principal,result:step.result??step.recovery_result??{content:[]},requests:[...step.requests],objects,assets:step.asset_id?[step.asset_id]:[],source_mode:'native-operation-result',object_count:objects.length,request_count:step.requests.length,is_error:false,execution_id:execution.id,step_id:step.id};
  this.save('captures',capture);step.result_capture_id=capture.id;
 }
 async recover(input){
  const execution=this.store.get('executions',input.execution_id),plan=this.store.get('plans',execution.plan_id),p=this.profile(execution.profile_id);
  for(const step of execution.steps){
   if(['APPLIED','RECOVERED','PENDING','FAILED','CONFLICT'].includes(step.status))continue;
   const bridge=this.bridge(p,this.observer(step.requests,r=>this.progress(execution,step,r)));
   try{
    const status=await bridge.status();if(status.principal?.uuid!==execution.principal.uuid)fail('PRINCIPAL_CHANGED','Reconnect the original execution principal.',409);
    const resolution=(input.resolutions||[]).find(r=>r.step_id===step.id);
    await this.completeKnownDraft(bridge,execution,step,resolution?.subject_id);
    await this.inspectApplied(bridge,step,resolution?.subject_id);step.status='RECOVERED';step.error=null;step.completed_at=now();this.retainOutcome(execution,step);
   }catch(error){step.error={code:error.code||'RECOVERY_PENDING',message:cleanError(error)};step.status=error.code==='PRINCIPAL_CHANGED'?'CONFLICT':'UNCERTAIN';}
   finally{bridge.observe=()=>{};this.save('executions',execution);}
  }
  if(execution.steps.every(s=>['APPLIED','RECOVERED','PENDING'].includes(s.status))&&execution.steps.some(s=>s.status==='PENDING'))return this.runExecution(execution,plan,p);
  execution.status=statusOf(execution.steps);execution.updated_at=now();plan.status=execution.status;
  this.store.tx(()=>{this.put('executions',execution);this.put('plans',plan);});
  return {execution_id:execution.id,status:execution.status};
 }
 async completeKnownDraft(bridge,execution,step,resolvedSubject){
  if(step.tool!=='dspace_create_workspace_item')return;
  const created=createdId(this.requests(step.requests),'workspaceitem');
  const subject=String(resolvedSubject??created?.id??step.observed_subject_id??'');
  if(!subject)return;
  const current=await bridge.workspace(subject),metadata=current._embedded?.item?.metadata??current.sections?.traditionalpageone??{};
  if(metadataContains({metadata},step.after.metadata))return;
  if(!created||String(created.id)!==subject)fail('RECOVERY_SOURCE_REQUIRED','The original successful create response is needed before completing draft metadata.',409);
  const initial=created._embedded?.item?.metadata??created.sections?.traditionalpageone??{};
  const operations=[];
  for(const [field,expected] of Object.entries(step.after.metadata)){
   const values=(metadata[field]??[]).map(v=>v.value),before=(initial[field]??[]).map(v=>v.value),after=expected.map(v=>v.value);
   if(json(values)===json(after))continue;
   if(json(values)!==json(before))fail('SOURCE_CONFLICT','Staff changed a draft field after creation. Review the current draft before completing it.',409);
   const path='/sections/traditionalpageone/'+field.replace(/~/g,'~0').replace(/\//g,'~1');
   operations.push({op:'add',path,value:expected.map(({place,...v})=>v)});
  }
  if(!operations.length)return;
  step.observed_subject_id=subject;step.recovery_intent={tool:'dspace_update_workspace_item',args:{id:Number(subject),operations},original_create_response_id:created.id,recorded_at:now()};
  this.save('executions',execution);
  const result=await bridge.call(step.recovery_intent.tool,step.recovery_intent.args);step.recovery_result=result;
  if(result.isError)fail('NATIVE_ACTION_FAILED',result.content?.map(c=>c.text||'').join('\n')||'Original draft repair failed.',502);
 }
 async reversal(input){
  const execution=this.store.get('executions',input.execution_id),p=this.profile(execution.profile_id),steps=[];
  for(const step of [...execution.steps].reverse()){
   if(!['APPLIED','RECOVERED'].includes(step.status))continue;
   if(!['dspace_update_item_metadata','dspace_update_workspace_item','dspace_move_item'].includes(step.tool))continue;
   const native=await this.collect(p,async b=>step.tool==='dspace_move_item'?{item:await b.item(step.subject_id),owner:await b.owner(step.subject_id)}:await this.subject(b,step));
   if(native.error)throw native.error;
   const object=step.tool==='dspace_move_item'?native.result.item:native.result;
   if(step.tool==='dspace_move_item'&&native.result.owner.uuid!==step.args.targetCollectionUuid)fail('SOURCE_CONFLICT','Staff moved the record again. Review its current collection before reversal.',409);
   if(step.tool!=='dspace_move_item'&&checkChanges(object,step.changes,'after').length)fail('SOURCE_CONFLICT','Staff changed a touched field after the saved result. Review that value before reversal.',409);
   const cap={id:id('capture'),label:'Reversal source for '+step.subject_id,profile_id:p.id,tool:'reversal-native-source',args:{},created_at:now(),principal:execution.principal,result:{content:[]},requests:native.requestIds,objects:[object],assets:[],object_count:1,request_count:native.requestIds.length,is_error:false,source_mode:'native-client'};
   this.save('captures',cap);
   steps.push({tool:step.tool,args:step.tool==='dspace_move_item'?{itemUuid:step.subject_id,targetCollectionUuid:step.preconditions.owner_uuid}:{...(step.tool==='dspace_update_item_metadata'?{uuid:step.subject_id}:{id:Number(step.subject_id)}),operations:inverseOperations(object,step.changes)},source_capture_id:cap.id,subject_id:step.subject_id});
  }
  if(!steps.length)fail('NO_REVERSIBLE_EDITS','This execution contains no metadata or collection edits to reverse.');
  return this.prepare({...input,profile_id:p.id,steps});
 }
 file(kind,recordId){
  if(['handoff','backup'].includes(kind))return {bytes:this.store.snapshot(),filename:'DSpace_Repository_Workspace.'+kind+'.json.gz',contentType:'application/gzip'};
  if(kind==='assets'){const a=this.store.get('assets',recordId);return {bytes:this.store.bytes(a.sha256),filename:a.name,contentType:a.media_type};}
  if(kind==='responses'){const r=this.store.get('requests',recordId);if(!r.body_sha256)fail('NO_BODY','This authentication exchange has no saved body.',404);return {bytes:this.store.bytes(r.body_sha256),filename:'DSpace_Response_'+recordId+'.'+(/json/.test(r.content_type)?'json':'bin'),contentType:r.content_type};}
  if(kind==='source-bundles'){const capture=this.store.get('captures',recordId),source=capture.source_bundle;if(!source)fail('NO_SOURCE_BUNDLE','This capture was received through the original MCP session.',404);return {bytes:this.store.bytes(source.sha256),filename:source.name,contentType:'application/json'};}
  const record=this.read(kind,recordId,{offset:0,limit:100});return {bytes:Buffer.from(JSON.stringify(record,null,2)+'\n'),filename:'DSpace_'+kind+'_'+recordId+'.json',contentType:'application/json'};
 }
 exportFile(kind,recordId){
  if(!['handoff','backup'].includes(kind))return Promise.resolve(this.file(kind,recordId));
  const task=this.tail.then(()=>this.store.nativeFile());this.tail=task.catch(()=>{});return task;
 }
 async previewFile(receivedPath){
  const absolute=path.resolve(receivedPath),fd=fs.openSync(absolute,'r'),signature=Buffer.alloc(16);try{fs.readSync(fd,signature,0,16,0);}finally{fs.closeSync(fd);}
  const hash=createHash('sha256');let bytes=0;for await(const chunk of fs.createReadStream(absolute)){hash.update(chunk);bytes+=chunk.length;}
  const report=signature.equals(Buffer.from('SQLite format 3\0'))?this.store.inspectNative(absolute):this.store.previewLegacy(fs.readFileSync(absolute));
  return {...report,sha256:hash.digest('hex'),bytes};
 }
 restoreFile(input,receivedPath){
  const task=this.tail.then(async()=>{
   requireText(input?.actor,'Staff actor',160);requireText(input?.operationId,'Operation ID',200);
   if(!Number.isInteger(input.revision))fail('INVALID_REVISION','Include the current workspace revision.');
   const absolute=path.resolve(receivedPath);if(absolute===this.store.filename)fail('INVALID_ARCHIVE','Use the received handover file, not the active workspace database.');
   let sha256=input.source_sha256;
   if(sha256!==undefined&&!/^[a-f0-9]{64}$/.test(sha256))fail('INVALID_ARCHIVE','Use the original receiving receipt SHA256.');
   if(!sha256){const hash=createHash('sha256');for await(const chunk of fs.createReadStream(absolute))hash.update(chunk);sha256=hash.digest('hex');}
   const payload={actor:input.actor,operationId:input.operationId,revision:input.revision,filename:path.basename(input.filename||absolute),source_sha256:sha256};
   const reservation=this.store.begin('restore-file',payload);
   if(reservation.existing){const old=reservation.existing;if(old.status==='COMPLETE')return {...old.result,revision:this.store.revision(),replayed:true};if(old.status==='FAILED')fail(old.error.code,old.error.message,old.error.status);if(old.receiving_result){this.store.finish(input.operationId,old.receiving_result);return {...old.receiving_result,revision:this.store.revision(),replayed:true};}fail('OPERATION_RUNNING','Inspect the original receiving operation before repeating it.',409);}
   try{
    const hash=createHash('sha256');let bytes=0;for await(const chunk of fs.createReadStream(absolute)){hash.update(chunk);bytes+=chunk.length;}if(hash.digest('hex')!==sha256)fail('SOURCE_DIGEST_MISMATCH','The received archive differs from its original preview receipt.',409);
    const original={...this.store.get('operations',input.operationId),archive:{sha256,bytes}},fd=fs.openSync(absolute,'r'),signature=Buffer.alloc(16);try{fs.readSync(fd,signature,0,16,0);}finally{fs.closeSync(fd);}
    let result;
    if(signature.equals(Buffer.from('SQLite format 3\0')))result=this.store.restoreNative(absolute,original);
    else {result=this.store.restore(fs.readFileSync(absolute));this.store.tx(()=>this.put('operations',original));result.format='legacy-gzip-json';}
    result={...result,sha256,bytes};this.store.finish(input.operationId,result);return {...result,revision:this.store.revision()};
   }catch(error){const safe=Object.assign(new Error(cleanError(error)),{code:error.code||'RECEIVING_FAILED',status:error.status||500});this.store.finish(input.operationId,null,safe);throw safe;}
  });this.tail=task.catch(()=>{});return task;
 }
 async close(){await this.tail;await Promise.allSettled([...this.bridges.values()].map(b=>b.close()));this.store.close();}
}
const authPathForStep=url=>/\/api\/(?:authn\/(?:login|logout)|security\/csrf)(?:[/?]|$)/.test(url);
export async function openWorkspace(options){return new RepositoryWorkspace(options);}

