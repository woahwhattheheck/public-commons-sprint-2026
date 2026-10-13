// MIT. Persistent custody around the unchanged Oak case and curriculum engines.
import {constants} from 'node:fs';
import {open,mkdir,lstat,realpath,rename,unlink} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import * as Model from './app/model.mjs';
import * as Curriculum from './app/curriculum-migration.mjs';
import {generateSdk} from './app/generate-sdk.mjs';
import {operationLease,privateDirectory} from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';

export const STORE_SCHEMA='stellar-forge.curriculum-migration-store.v1';
const HEAD_SCHEMA='stellar-forge.curriculum-migration-store-head.v1',BRANCH_SCHEMA='curriculum-browser-branch.v1';
const MAX_WORKSPACE=128*1024*1024,MAX_OBJECT=160*1024*1024,MAX_HEAD=24*1024*1024,MAX_REQUESTS=20000,MAX_BRANCHES=256;
const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
const copy=v=>JSON.parse(Model.canonical(v));
const digest=v=>createHash('sha256').update(v).digest('hex');
const jsonHash=v=>digest(typeof v==='string'?v:Model.canonical(v));
export function failure(code,message,status=400){return Object.assign(new Error(message),{code,status});}
function need(ok,code,message,status){if(!ok)throw failure(code,message,status);}
function text(v,label,max=240){need(typeof v==='string'&&v.trim()&&v.length<=max&&!/[\u0000-\u001f]/.test(v),'INVALID',label+' must be bounded text.');return v;}
function key(v,label='Identifier'){text(v,label,180);need(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(v),'INVALID',label+' contains unsupported characters.');return v;}
function hash(v){need(typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),'INVALID','A complete SHA-256 is required.');return v;}
function iso(v){need(typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v,'INVALID','A canonical UTC timestamp is required.');return v;}
function exact(v,fields){need(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('\0')===fields.slice().sort().join('\0'),'INVALID','Expected fields: '+fields.join(', '));}
function expectedValue(v){exact(v,['workspaceId','revision','snapshotSha256']);text(v.workspaceId,'Workspace ID',160);need(Number.isSafeInteger(v.revision)&&v.revision>=0,'INVALID','A valid reviewed revision is required.');hash(v.snapshotSha256);return v;}
function matches(row,v){return row.workspaceId===v.workspaceId&&row.revision===v.revision&&row.snapshotSha256===v.snapshotSha256;}
function requireExpected(row,v){expectedValue(v);need(matches(row,v),'CONFLICT','This physical branch has advanced. Retain the draft and review its current saved edition.',409);}
function branchSummary(row){const {snapshotObject,...rest}=row;return copy(rest);}
function portable(snapshot){return {format:'curriculum-workspace-export.v1',sha256:jsonHash(Model.canonical(snapshot)),workspace:snapshot};}
function normalizeSnapshot(value){
 if(value?.format==='curriculum-workspace-export.v1'){
  exact(value,['format','sha256','workspace']);hash(value.sha256);
  need(jsonHash(Model.canonical(value.workspace))===value.sha256,'HASH','Portable checksum differs.');
  value=value.workspace;
 }
 const raw=encoded(value,MAX_WORKSPACE),workspace=Curriculum.receiveCurriculumWorkspace(value);
 need(Model.canonical(value)===Model.canonical(workspace),'HASH','Original receiver changed the complete workspace.');
 const selection={workspace,snapshot:workspace,workspaceId:workspace.id,revision:workspace.revision,snapshotSha256:digest(raw)};
 expectedValue({workspaceId:selection.workspaceId,revision:selection.revision,snapshotSha256:selection.snapshotSha256});return selection;
}
async function syncDirectory(path){const f=await open(path,constants.O_RDONLY|constants.O_DIRECTORY);try{await f.sync();}finally{await f.close();}}
async function bytes(path,max=MAX_OBJECT,optional=false){
 let f;try{f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);}catch(e){if(optional&&e.code==='ENOENT')return null;throw e;}
 try{
  const a=await f.stat();need(a.isFile()&&a.nlink===1&&!(a.mode&0o077)&&(process.getuid===undefined||a.uid===process.getuid())&&a.size<=max,'FILE_INVALID','Expected an owned private bounded regular file.');
  const out=await f.readFile(),b=await f.stat(),named=await lstat(path);
  need(a.dev===named.dev&&a.ino===named.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs&&out.length===a.size,'FILE_CHANGED','The retained file changed during reading.');
  return out;
 }finally{await f.close();}
}
function parse(data){try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));}catch{throw failure('JSON_INVALID','Retained JSON is not complete UTF-8 JSON.');}}
async function jsonFile(path,max=MAX_HEAD,optional=false){const b=await bytes(path,max,optional);return b===null?null:parse(b);}
async function atomic(path,data,{immutable=false}={}){
 const body=Buffer.isBuffer(data)?data:Buffer.from(data);
 if(immutable){const old=await bytes(path,Math.max(MAX_OBJECT,body.length),true);if(old){need(old.equals(body),'IMMUTABLE_CONFLICT','An immutable retained file differs.',409);return;}}
 const temporary=path+'.pending-'+randomUUID();let f=null,made=false;
 try{
  f=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);made=true;
  await f.writeFile(body);await f.sync();await f.close();f=null;
  // The maintained lifetime lease serializes every writer of these paths.
  await rename(temporary,path);made=false;await syncDirectory(dirname(path));
 }finally{if(f)await f.close();if(made){await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});await syncDirectory(dirname(path));}}
}
function encoded(value,max=MAX_OBJECT){const raw=Buffer.from(Model.canonical(value));need(raw.length<=max,'CAPACITY','Complete retained JSON exceeds its documented capacity.');return raw;}
async function writeObject(root,value){const body=encoded(value),sha256=digest(body);await atomic(join(root,'objects',sha256+'.json'),body,{immutable:true});return {sha256,bytes:body.length};}
async function readObject(root,ref){exact(ref,['sha256','bytes']);hash(ref.sha256);need(Number.isSafeInteger(ref.bytes)&&ref.bytes>=0&&ref.bytes<=MAX_OBJECT,'OBJECT_INVALID','Invalid retained object size.');const b=await bytes(join(root,'objects',ref.sha256+'.json'));need(b.length===ref.bytes&&digest(b)===ref.sha256,'HASH','Retained object bytes/hash differ.');return parse(b);}
function headHash(head){const {sha256,...body}=head;return digest(encoded(body,MAX_HEAD));}
function headCheck(head,identity){
 need(head?.schema===HEAD_SCHEMA&&head.storeId===identity.id&&head.directory===identity.directory&&head.sha256===headHash(head),'HEAD_INVALID','Store head identity or complete hash differs.');
 need(Number.isSafeInteger(head.sequence)&&head.sequence>=0&&head.branches&&head.seeds&&head.requests&&typeof head.branches==='object'&&!Array.isArray(head.branches)&&Object.keys(head.branches).length<=MAX_BRANCHES&&Object.keys(head.requests).length<=MAX_REQUESTS,'HEAD_INVALID','Store indexes exceed their retained contract.');
 need(own(head.branches,head.defaultBranchId),'HEAD_INVALID','Original default branch is absent.');
 for(const [id,row] of Object.entries(head.branches)){
  key(id);need(row?.id===id&&row.schema===BRANCH_SCHEMA&&row.storeId===identity.id,'BRANCH_INVALID','Branch metadata identity differs.');
  text(row.label,'Branch label');iso(row.createdAt);iso(row.updatedAt);expectedValue({workspaceId:row.workspaceId,revision:row.revision,snapshotSha256:row.snapshotSha256});hash(row.creationSha256);
  exact(row.snapshotObject,['sha256','bytes']);hash(row.snapshotObject.sha256);
 }
 for(const [id,row] of Object.entries(head.requests)){key(id,'Request ID');need(row?.requestId===id&&row.inputSha256===row.inputObject?.sha256&&Number.isSafeInteger(row.sequence)&&row.sequence>0&&row.sequence<=head.sequence,'REQUEST_INVALID','Retained request index differs.');exact(row.inputObject,['sha256','bytes']);hash(row.inputObject.sha256);exact(row.resultObject,['sha256','bytes']);hash(row.resultObject.sha256);}
 return head;
}
function record(identity,id,label,selection,origin,at,creationSha256,snapshotObject){
 key(id,'Branch ID');text(label,'Branch label');iso(at);
 return {schema:BRANCH_SCHEMA,id,label,storeId:identity.id,workspaceId:selection.workspaceId,revision:selection.revision,snapshotSha256:selection.snapshotSha256,snapshotObject,createdAt:at,updatedAt:at,origin:copy(origin),creationSha256};
}
async function ownedDirectory(path){try{await mkdir(path,{mode:0o700});await syncDirectory(dirname(path));}catch(e){if(e.code!=='EEXIST')throw e;}return privateDirectory(path);}
function absolute(path){need(typeof path==='string'&&path===resolve(path)&&!path.includes('\0'),'PATH_INVALID','Select an absolute normalized real directory.');return path;}

export async function createStore(input){
 const args=copy(input);absolute(args.directory);text(args.title,'Store title',200);iso(args.createdAt);
 need(typeof args.id==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(args.id),'INVALID','Physical store ID must be a canonical UUID.');
 need(own(args,'initialSnapshot'),'BASELINE_REQUIRED','Select the complete original baseline or received workspace explicitly.');
 const selected=normalizeSnapshot(args.initialSnapshot);
 const root=args.directory,parent=dirname(root);need(await realpath(parent)===parent,'PATH_INVALID','Store parent must be a real directory.');
 const inputRecord={schema:'stellar-forge.curriculum-store-create.v1',id:args.id,title:args.title,createdAt:args.createdAt,directory:root,initialSnapshotSha256:selected.snapshotSha256};
 const creationInputHash=jsonHash(inputRecord),defaultBranchId='branch-'+args.id;
 const identity={schema:STORE_SCHEMA,id:args.id,title:args.title,createdAt:args.createdAt,directory:root,defaultBranchId,creationInputHash};
 const creationStem=join(parent,'.curriculum-create-'+digest(root));
 const guard=await operationLease(creationStem+'.lock');
 try{
  let existed=true;try{await lstat(root);}catch(e){if(e.code==='ENOENT')existed=false;else throw e;}
  const outerIntent=await jsonFile(creationStem+'.json',MAX_HEAD,true);
  if(outerIntent)need(Model.canonical(outerIntent)===Model.canonical(inputRecord),'CREATE_CONFLICT','The original directory creation is bound to different inputs.',409);
  else{
   need(!existed,'CREATE_CONFLICT','An existing directory without its original creation intent cannot be adopted.',409);
   await atomic(creationStem+'.json',encoded(inputRecord),{immutable:true});
  }
  if(!existed)await ownedDirectory(root);else await privateDirectory(root);
  await atomic(join(root,'creation-input.json'),encoded(inputRecord),{immutable:true});
  const prior=await jsonFile(join(root,'creation.json'),MAX_HEAD,true);
  if(prior){need(Model.canonical(prior)===Model.canonical(identity),'CREATE_CONFLICT','Store identity differs from the original creation request.',409);}
  else{
   await ownedDirectory(join(root,'objects'));
   const snapshotObject=await writeObject(root,selected.snapshot);
   const branch=record(identity,defaultBranchId,'Original curriculum workspace',selected,{kind:'ISSUED_BASELINE',snapshotSha256:selected.snapshotSha256},args.createdAt,jsonHash({snapshotSha256:selected.snapshotSha256,storeId:args.id}),snapshotObject);
   const head={schema:HEAD_SCHEMA,storeId:args.id,directory:root,sequence:0,defaultBranchId,branches:{[defaultBranchId]:branch},seeds:{['baseline:'+selected.snapshotSha256]:{branchId:defaultBranchId,inputSha256:jsonHash({snapshotSha256:selected.snapshotSha256,origin:branch.origin})}},requests:{},sha256:''};
   head.sha256=headHash(head);
   await atomic(join(root,'state.json'),encoded(head,MAX_HEAD),{immutable:true});
   await atomic(join(root,'creation.json'),encoded(identity),{immutable:true});
  }
 }finally{await guard.close();}
 return copy(identity);
}
export async function openStore({directory}){
 const root=absolute(directory);await privateDirectory(root);
 const guard=await operationLease(join(root,'service.lock'));let closed=false,closing=false,poisoned=false,tail=Promise.resolve();
 try{
  const identity=await jsonFile(join(root,'creation.json'));
  need(identity?.schema===STORE_SCHEMA&&identity.directory===root&&typeof identity.id==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(identity.id),'IDENTITY_INVALID','Store creation identity does not match this physical directory.');
  text(identity.title,'Store title',200);iso(identity.createdAt);key(identity.defaultBranchId);hash(identity.creationInputHash);
  const originalInput=await jsonFile(join(root,'creation-input.json'));
  need(jsonHash(originalInput)===identity.creationInputHash&&originalInput.id===identity.id&&originalInput.directory===root,'IDENTITY_INVALID','Original store creation input differs.');
  await privateDirectory(join(root,'objects'));
  let head=headCheck(await jsonFile(join(root,'state.json')),identity);
  need(head.defaultBranchId===identity.defaultBranchId,'IDENTITY_INVALID','Original default branch changed.');
  const workspaces=new Map();
  const serial=fn=>{
   if(closing||closed)return Promise.reject(failure('CLOSED','The curriculum store is closing.',409));
   const pending=tail.then(()=>{need(!poisoned,'STORE_REOPEN_REQUIRED','A filesystem commit has an uncertain outcome. Close and reopen this original store before continuing.',409);return fn();});
   tail=pending.catch(()=>{});return pending;
  };
  async function selection(row){
   const cached=workspaces.get(row.snapshotSha256);if(cached)return cached;
   const s=normalizeSnapshot(await readObject(root,row.snapshotObject));
   need(matches(row,s),'HASH','Saved branch snapshot differs from its retained identity.');
   workspaces.set(row.snapshotSha256,s);while(workspaces.size>2)workspaces.delete(workspaces.keys().next().value);
   return s;
  }
  function rowFor(id){key(id,'Branch ID');need(own(head.branches,id),'MISSING','The selected physical branch does not exist.',404);return head.branches[id];}
  async function hydrated(row){const s=await selection(row);return {...branchSummary(row),snapshot:copy(s.snapshot)};}
  async function response(stored){
   if(stored.shape==='branch')return hydrated(stored.branch);
   if(stored.shape==='command')return {branch:await hydrated(stored.branch),result:copy(stored.result),replayed:stored.replayed};
   throw failure('RECEIPT_INVALID','Unknown retained result shape.');
  }
  async function priorResult(requestId,inputSha256){
   const prior=own(head.requests,requestId)?head.requests[requestId]:null;
   if(!prior)return null;
   need(prior.inputSha256===inputSha256,'REQUEST_REUSED','This original request ID belongs to different arguments.',409);
   const originalInput=await readObject(root,prior.inputObject);need(jsonHash(originalInput)===prior.inputSha256,'HASH','Retained request input differs.');
   return response(await readObject(root,prior.resultObject));
  }
  function mutation(kind,args,normalize,work){
   // Capture all original caller bytes before queue admission, including received snapshots.
   const frozen=copy(args);key(frozen.requestId,'Request ID');
   const bound={kind,input:frozen},inputSha256=jsonHash(bound),requestId=frozen.requestId;
   return serial(async()=>{
    const previous=await priorResult(requestId,inputSha256);if(previous!==null)return previous;
    let next=copy(head),stored;
    try{
     const normalized=normalize(frozen);
     need(Object.keys(next.requests).length<MAX_REQUESTS,'CAPACITY','Store request capacity reached.');
     stored=await work(frozen,next,normalized);
     const resultObject=await writeObject(root,stored),inputObject=await writeObject(root,bound);
     next.sequence++;next.requests[requestId]={requestId,inputObject,inputSha256,sequence:next.sequence,resultObject};
     next.sha256=headHash(next);const body=encoded(next,MAX_HEAD);
     try{await atomic(join(root,'state.json'),body);}catch(e){poisoned=true;e.requestId=requestId;e.notCommitted=false;throw e;}
     head=next;
    }catch(e){
     e.requestId??=requestId;
     if(!poisoned)e.notCommitted=true;
     throw e;
    }
    return response(stored);
   });
  }
  async function install(next,row,selected){
   const snapshotObject=await writeObject(root,selected.snapshot);
   const updated={...row,workspaceId:selected.workspaceId,revision:selected.revision,snapshotSha256:selected.snapshotSha256,snapshotObject,updatedAt:new Date().toISOString()};
   next.branches[row.id]=updated;
   workspaces.set(selected.snapshotSha256,selected);while(workspaces.size>2)workspaces.delete(workspaces.keys().next().value);
   return updated;
  }

  function operation(workspace,command){
   exact(command,['kind','actor','at','body']);
   text(command.actor,'Operating engineer',240);need(typeof command.at==='string'&&Number.isFinite(Date.parse(command.at)),'INVALID','Use an actual operation timestamp.');
   const body=command.body,context={actor:command.actor,at:command.at};let result;
   const required={
    addEdition:['edition'],addCase:['case'],updateCase:['caseId','patch'],saveResponse:['caseId','lane','response'],compareCase:['caseId'],
    decide:['caseId','decision'],addAsset:['asset'],planCurriculumCase:['caseId','options'],decideCurriculumPlan:['caseId','decision']
   };
   need(own(required,command.kind),'COMMAND_INVALID','Select an original workspace operation.');exact(body,required[command.kind]);
   try{
    switch(command.kind){
     case 'addEdition':result=Model.addEdition(workspace,body.edition,context);break;
     case 'addCase':result=Model.addCase(workspace,body.case,context);break;
     case 'updateCase':result=Model.updateCase(workspace,body.caseId,body.patch,context);break;
     case 'saveResponse':result=Model.saveResponse(workspace,body.caseId,body.lane,body.response,context);break;
     case 'compareCase':result=Model.compareCase(workspace,body.caseId,context);break;
     case 'decide':result=Model.decide(workspace,body.caseId,body.decision,context);break;
     case 'addAsset':result=Model.addAsset(workspace,body.asset,context);break;
     case 'planCurriculumCase':result=Curriculum.planCurriculumCase(workspace,body.caseId,body.options,context);break;
     case 'decideCurriculumPlan':result=Curriculum.decideCurriculumPlan(workspace,body.caseId,body.decision,context);break;
    }
   }catch(e){if(!e.code){e.code='MODEL_INVALID';e.status=400;}throw e;}
   const selected=normalizeSnapshot(result),summary={kind:command.kind,revision:result.revision};
   if(body.caseId)summary.caseId=body.caseId;
   if(command.kind==='addCase')summary.caseId=body.case.id;
   if(command.kind==='addEdition')summary.editionId=body.edition.id;
   if(command.kind==='addAsset')summary.assetId=body.asset.id;
   const c=result.cases.find(c=>c.id===body.caseId);
   if(command.kind==='compareCase')summary.runId=c.runs.at(-1).id;
   if(command.kind==='planCurriculumCase')summary.planId=c.curriculumPlans.at(-1).id;
   return {selected,summary};
  }
  function selectedCase(w,id){const c=w.cases.find(c=>c.id===id);need(c,'MISSING','Selected original case is absent.',404);return c;}
  function selectedEdition(w,id){const e=w.editions.find(e=>e.id===id);need(e,'MISSING','Selected complete edition is absent.',404);return e;}
  function reportValue(w,kind,o={}){
   let result;
   switch(kind){
    case 'portfolio':result=Model.portfolio(w);break;
    case 'curriculumPortfolio':result=Curriculum.curriculumPortfolio(w);break;
    case 'case':result=selectedCase(w,o.caseId);break;
    case 'sourceInventory':result=Model.sourceInventory(selectedEdition(w,o.editionId));break;
    case 'curriculumPlan':
    case 'curriculumReviewRows':{
     const c=selectedCase(w,o.caseId),p=c.curriculumPlans?.find(p=>p.id===o.planId);
     need(p,'MISSING','Selected retained curriculum plan is absent.',404);
     result=kind==='curriculumPlan'?p:Curriculum.curriculumReviewRows(p);break;
    }
    case 'sdk':{
     const e=selectedEdition(w,o.editionId),sdk=generateSdk(e);
     result={...sdk,editionId:e.id,descriptors:sdk.files.map(f=>({path:f.path,bytes:Buffer.byteLength(f.content),sha256:digest(f.content)}))};break;
    }
    default:throw failure('REPORT_INVALID','Select an original workspace report.');
   }
   return copy(result);
  }
  const api={
   directory:root,identity:Object.freeze(copy(identity)),
   read(id){const frozen=copy(id);return serial(()=>hydrated(rowFor(frozen)));},
   list(){return serial(()=>Object.values(head.branches).map(branchSummary).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id)));},
   create(args){return mutation('create',args,a=>{
    exact(a,['requestId','id','label','snapshot','origin']);key(a.id,'Branch ID');text(a.label,'Branch label');
    const s=normalizeSnapshot(a.snapshot);
    return {id:a.id,label:a.label,snapshotSha256:s.snapshotSha256,origin:a.origin};
   },async(a,next,input)=>{
    const creationSha256=jsonHash(input),s=normalizeSnapshot(a.snapshot);
    need(!own(next.branches,a.id),'CREATE_CONFLICT','Use a new physical branch ID; receiving never overwrites an existing branch.',409);
    need(Object.keys(next.branches).length<MAX_BRANCHES,'CAPACITY','Store branch capacity reached.');
    const row=record(identity,a.id,a.label,s,a.origin,new Date().toISOString(),creationSha256,await writeObject(root,s.snapshot));
    next.branches[row.id]=row;return {shape:'branch',branch:row};
   });},
   command(args){return mutation('command',args,a=>{
    exact(a,['requestId','id','expected','command']);key(a.id,'Branch ID');expectedValue(a.expected);
    return {id:a.id,expected:a.expected,command:a.command};
   },async(a,next)=>{
    const old=rowFor(a.id);requireExpected(old,a.expected);const original=await selection(old);
    const applied=operation(original.workspace,a.command),s=applied.selected;
    const row=s.snapshotSha256===old.snapshotSha256?old:await install(next,old,s);
    return {shape:'command',branch:row,result:applied.summary,replayed:false};
   });},
   request(requestId){const id=copy(requestId);key(id,'Request ID');return serial(async()=>{
    if(!own(head.requests,id))return null;
    const entry=head.requests[id],input=await readObject(root,entry.inputObject);need(jsonHash(input)===entry.inputSha256,'HASH','Original request bytes differ.');
    return {...copy(entry),input,result:await response(await readObject(root,entry.resultObject))};
   });},
   history(args){const a=copy(args);return serial(async()=>{
    const row=rowFor(a.id);requireExpected(row,a.expected);
    const offset=a.offset??0,limit=a.limit??100;
    need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=200,'INVALID','History offset/limit are outside bounds.');
    const {workspace}=await selection(row),total=workspace.history.length;need(offset<=total,'INVALID','History offset exceeds the frozen total.');
    return {id:row.id,workspaceId:row.workspaceId,revision:row.revision,snapshotSha256:row.snapshotSha256,total,offset,nextOffset:offset+limit<total?offset+limit:null,items:copy(workspace.history.slice(offset,offset+limit))};
   });},
   report(args){const a=copy(args);return serial(async()=>{
    const row=rowFor(a.id);requireExpected(row,a.expected);const {workspace}=await selection(row);
    return {branch:branchSummary(row),kind:a.kind,result:reportValue(workspace,a.kind,a.options??{})};
   });},
   exportBranch(args){const a=copy(args);return serial(async()=>{
    const row=rowFor(a.id);requireExpected(row,a.expected);return portable(copy((await selection(row)).snapshot));
   });},
   source(args){const a=copy(args);return serial(async()=>{
    const row=rowFor(a.id);requireExpected(row,a.expected);const w=(await selection(row)).workspace;
    const asset=w.assets.find(x=>x.id===a.assetId);need(asset,'MISSING','Original retained asset is absent.',404);
    const body=Buffer.from(asset.content,'utf8');
    return {branch:branchSummary(row),descriptor:{id:asset.id,name:asset.name,kind:asset.kind,bytes:body.length,sha256:digest(body)},bytes:body};
   });},
   download(args){const a=copy(args);return serial(async()=>{
    const row=rowFor(a.id);requireExpected(row,a.expected);const w=(await selection(row)).workspace,o=a.options??{};
    let value,filename,body,mediaType='application/json; charset=utf-8';
    switch(a.kind){
     case 'workspace':value=portable(w);filename='curriculum-workspace.json';break;
     case 'report':value=reportValue(w,o.kind,o.options??{});filename='curriculum-'+String(o.kind).replace(/[^A-Za-z0-9-]/g,'_')+'.json';break;
     case 'sourceEdition':value=selectedEdition(w,o.editionId);filename='source-edition.json';break;
     case 'case':value=selectedCase(w,o.caseId);filename='migration-case.json';break;
     case 'response':{
      need(['original','candidate'].includes(o.lane),'INVALID','Select original or candidate response.');
      value=selectedCase(w,o.caseId).responses[o.lane];need(value,'MISSING','Response is not yet retained.',404);filename=o.lane+'-response.json';break;
     }
     case 'sdkFile':{
      need(['client.ts','types.ts','inventory.json'].includes(o.path),'INVALID','Select a complete generated SDK file.');
      const sdk=generateSdk(selectedEdition(w,o.editionId)),f=sdk.files.find(f=>f.path===o.path);need(f,'MISSING','Generated SDK file is absent.',404);
      body=Buffer.from(f.content);filename=f.path;mediaType=f.path.endsWith('.ts')?'text/plain; charset=utf-8':mediaType;break;
     }
     default:throw failure('DOWNLOAD_INVALID','Select an original complete output.');
    }
    body??=Buffer.from(Model.canonical(value)+'\n');
    need(body.length<=MAX_OBJECT,'CAPACITY','Complete output exceeds the selected object capacity.');
    return {branch:branchSummary(row),descriptor:{name:filename,mediaType,bytes:body.length,sha256:digest(body)},bytes:body};
   });},
   close(){if(closed)return Promise.resolve();if(closing)return tail;closing=true;tail=tail.then(async()=>{closed=true;workspaces.clear();await guard.close();});return tail;}
  };
  // The unchanged receiver recomputes saved curriculum plans and checks its original structural history.
  for(const row of Object.values(head.branches))await selection(row);
  return Object.freeze(api);
 }catch(e){await guard.close();throw e;}
}
