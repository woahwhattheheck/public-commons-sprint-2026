'use strict';
// Prepare and receive exact original state. This module never initializes a
// coordinator, creates a Git ref/file, selects a different account, or sends mail.
const crypto=require('node:crypto');
const KIND='commons.connected-contact-local-state/v1';
const SCHEMA='commons.connected-contact-adoption-preparation/v1';
const MAX=256*1024*1024;
const ACCOUNT_REPOSITORY='woahwhattheheck/commons-ship-enforcer';
const ACCOUNT_PATH='state/gmail-account.json';
const CONTACT_REPOSITORY='woahwhattheheck/commons';
const clone=x=>JSON.parse(JSON.stringify(x));
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':
 x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
const sha=x=>crypto.createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x),'utf8').digest('hex');
const git=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const iso=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString()===x;
function need(ok,message){if(!ok)throw new TypeError(message);}
function printable(value,label,max=4096){
 need(typeof value==='string'&&value.length>0&&Buffer.byteLength(value,'utf8')<=max&&!/[\x00-\x1f\x7f]/.test(value),label+' must be retained nonempty text.');
 return value;
}
function bytes(value){return Buffer.byteLength(value,'utf8');}
function gitBlob(text){
 const data=Buffer.from(text,'utf8');
 return crypto.createHash('sha1').update(Buffer.from('blob '+data.length+'\0','utf8')).update(data).digest('hex');
}
function repository(value){
 need(typeof value==='string'&&/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)&&
  value.split('/').every(x=>x!=='.'&&x!=='..'),'Select the original source repository.');
 return value;
}
function sourceSelection(value,path){
 need(value&&typeof value==='object','Retain each complete original immutable source selection.');
 repository(value.repository);printable(value.branch,'Original branch');
 need(!value.branch.includes('..')&&!value.branch.includes('//')&&!value.branch.endsWith('/')&&
  !/[\s~^:?*\[\\]/.test(value.branch),'Original branch must be a complete Git ref name.');
 need(git(value.commit_sha)&&git(value.blob_sha),'Pin the actual original commit and blob before preparation.');
 need(value.path===path,'The selected original path differs from its native identity.');
 return clone(value);
}
function accountKey(account){
 need(account&&/^\d+$/.test(String(account.id))&&typeof account.email==='string'&&account.email.includes('@')&&
  typeof account.link_id==='string'&&account.link_id,'Supply the original private mailbox configuration.');
 return sha({provider:'gmail',profile_id:String(account.id),activity:'Mail sending'});
}
function storageSelection(storage){
 need(storage?.kind===KIND&&typeof storage.coordinatorId==='string'&&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(storage.coordinatorId)&&
  typeof storage.verify==='function'&&typeof storage.receiveBatch==='function',
  'Select the one existing fleet coordinator and its explicit receiving interface.');
}
function authority(value,storage){
 need(value?.kind===KIND&&value.coordinator_id===storage.coordinatorId&&
  typeof value.authority?.scope_id==='string'&&value.authority.scope_id&&Array.isArray(value.authority.accounts),
  'Receive the original shared coordinator authority.');
 return clone(value.authority);
}
function modulesSelected(modules){
 need(typeof modules?.admission?.validateConnectedMailboxAccountState==='function'&&
  typeof modules?.gateway?.recipientClaimPath==='function'&&typeof modules?.intent?.fingerprint==='function'&&
  typeof modules?.checkpoint?.prepareConnectedContactCheckpointAdoption==='function',
  'Use the complete paired original admission, gateway, intent and checkpoint modules.');
 return modules;
}
function handoff(value){
 need(value&&value.controllers_quiesced===true&&iso(value.recorded_at),
  'Retain the actual original-owner handoff and quiesced-controller declaration.');
 printable(value.reference,'Original owner handoff reference');
 printable(value.recorded_by,'Original owner identity');
 return clone(value);
}
function checkPrepared(prepared){
 need(prepared?.schema===SCHEMA&&prepared.coordinator?.kind===KIND&&
  typeof prepared.coordinator.coordinator_id==='string'&&hex(prepared.coordinator.authority_sha256)&&
  iso(prepared.prepared_at)&&Array.isArray(prepared.request?.entries)&&prepared.request.entries.length>0&&
  prepared.request.operation_id===prepared.operation_id&&
  prepared.request_sha256===sha(prepared.request)&&
  prepared.coordinator.authority_sha256===sha(canonical(prepared.coordinator.authority)),
  'The complete frozen receiving request changed.');
 const {preparation_sha256,...body}=prepared;
 need(hex(preparation_sha256)&&preparation_sha256===sha(canonical(body)),
  'The complete prepared receiving record changed.');
 printable(prepared.operation_id,'Original receiving operation ID',900);handoff(prepared.handoff);
 need(bytes(JSON.stringify(prepared))<=MAX&&bytes(JSON.stringify(prepared.request))<=MAX,
  'The complete portable preparation or batch exceeds the coordinator request bound.');
 const keys=new Set();
 for(const entry of prepared.request.entries){
  need(['account','recipient','intent','checkpoint'].includes(entry.namespace)&&typeof entry.key==='string'&&
   typeof entry.content==='string'&&entry.origin&&entry.expected_sha256===null,
   'Keep the complete original create-only receiving entry.');
  const key=entry.namespace+'\0'+entry.key;need(!keys.has(key),'Duplicate receiving entry.');keys.add(key);
  const state=JSON.parse(entry.content);need(state&&typeof state==='object'&&!Array.isArray(state),'Complete original JSON object required.');
  need(entry.origin.sha256===sha(entry.content),'Original entry bytes changed.');
  if(entry.origin.kind==='git-original-readback')
   need(git(entry.origin.commit_sha)&&git(entry.origin.blob_sha)&&gitBlob(entry.content)===entry.origin.blob_sha,
    'Original file bytes differ from their actual Git blob.');
 }
 return prepared;
}
async function prepareConnectedContactAdoption(options){
 const {tools,storage,factory,modules:given,sha256Utf8,classifyReturnedGmailRateLimit,classifyReturnedSendRateLimit,
  operationId,accounts=[],contacts=[],checkpoints=[],originalJournals=[],ownerHandoff,observedAt=new Date().toISOString(),
  githubRefAction='github_fetch_commit',githubActorAction,record}=options||{};
 storageSelection(storage);const modules=modulesSelected(given);
 printable(operationId,'Original receiving operation ID',900);need(iso(observedAt),'Retain the first preparation timestamp.');
 need(typeof record==='function'&&typeof sha256Utf8==='function'&&typeof classifyReturnedGmailRateLimit==='function',
  'Retain the original hash/classifier and durable preparation journal.');
 need(['github_fetch','github_fetch_commit'].includes(githubRefAction),'Select one original ref read binding before invocation.');
 need(typeof tools?.['mcp__codex_apps__'+githubRefAction]==='function'&&
  typeof tools?.mcp__codex_apps__github_fetch_file==='function','Original read-only Git bindings are required.');
 need(Array.isArray(accounts)&&Array.isArray(contacts)&&Array.isArray(checkpoints)&&Array.isArray(originalJournals)&&
  accounts.length+contacts.length+checkpoints.length+originalJournals.length>0,
  'Select a nonempty original account, contact, checkpoint or session-journal batch explicitly.');
 if(originalJournals.length)need(typeof factory?.createConnectedFirstContact==='function'&&
  typeof modules.checkpoint.prepareConnectedContactJournalAdoption==='function',
  'Use the complete original factory and checkpoint session receiver; draft inputs require the maintained draft wrapper.');
 const selectedAuthority=authority(await storage.verify(),storage),owner=handoff(ownerHandoff),entries=[],observations=[],heads=new Map();
 let sequence=0;
 async function invoke(name,args){
  const binding='mcp__codex_apps__'+name,call_id=sha({operation_id:operationId,binding,args,observed_at:observedAt,sequence:++sequence});
  await record({phase:'invoking',binding,args:clone(args),call_id,observed_at:new Date().toISOString()});
  let raw;try{raw=await tools[binding](clone(args));}catch(error){
   await record({phase:'failed',binding,call_id,observed_at:new Date().toISOString(),message:'Original source read failed; keep the same source selection.'});throw error;
  }
  await record({phase:'returned',binding,call_id,raw:clone(raw),observed_at:new Date().toISOString()});
  need(raw?.isError!==true&&raw?.structuredContent&&typeof raw.structuredContent==='object','Original source read did not return complete native content.');
  const observation={binding,args:clone(args),raw:clone(raw),call_id,observed_at:new Date().toISOString()};observations.push(observation);
  return {value:raw.structuredContent,observation};
 }
 async function readHead(repo,branch){
  repository(repo);printable(branch,'Original source branch');
  const received=await invoke(githubRefAction,githubRefAction==='github_fetch_commit'
   ?{repo_full_name:repo,commit_sha:'refs/heads/'+branch}
   :{url:'https://api.github.com/repos/'+repo+'/git/ref/heads/'+branch});
  let id;
  if(githubRefAction==='github_fetch_commit'){
   const value=received.value,commit=value.commit;id=commit?.sha;
   need(git(id)&&commit.repository_full_name===repo&&commit.url==='https://api.github.com/repos/'+repo+'/commits/'+id&&
    commit.html_url==='https://github.com/'+repo+'/commit/'+id&&value.url===commit.html_url,
    'The original native commit response belongs to another source selection.');
  }else{
   need(typeof received.value.content==='string','Complete original Git ref content required.');
   const value=JSON.parse(received.value.content);id=value.object?.sha;
   need(value.ref==='refs/heads/'+branch&&value.object?.type==='commit'&&git(id),'The original branch response changed identity.');
  }
  return {sha:id,observation:received.observation};
 }
 async function pinHead(repo,branch,expected){
  const identity=repo+'\0'+branch,old=heads.get(identity);
  if(old){need(old.sha===expected,'One source branch has inconsistent selected commits.');return old;}
  const current=await readHead(repo,branch);need(current.sha===expected,'The original branch advanced; prepare again from the actual owner selection before any receiving.');
  heads.set(identity,{repository:repo,branch,sha:expected,observation:current.observation});return current;
 }
 async function readFile(selection){
  await pinHead(selection.repository,selection.branch,selection.commit_sha);
  const received=await invoke('github_fetch_file',{repository_full_name:selection.repository,path:selection.path,ref:selection.commit_sha});
  const value=received.value;
  need(typeof value.content==='string'&&value.sha===selection.blob_sha&&
   (value.encoding==null||['utf-8','utf8','text'].includes(value.encoding))&&gitBlob(value.content)===value.sha,
   'Receive the complete exact original file at its selected immutable commit.');
  need(sha256Utf8(value.content)?.sha256===sha(value.content),'The original SHA-256 implementation disagrees on source bytes.');
  return {content:value.content,origin:{kind:'git-original-readback',repository:selection.repository,path:selection.path,
   commit_sha:selection.commit_sha,blob_sha:value.sha,sha256:sha(value.content),observed_at:received.observation.observed_at,
   receipt:received.observation}};
 }
 const accountKeys=new Set();
 for(const selected of accounts){
  const key=accountKey(selected.account);need(!accountKeys.has(key),'Duplicate original account selection.');accountKeys.add(key);
  need(selectedAuthority.accounts.some(a=>a.account_key===key&&a.profile_id===String(selected.account.id)),
   'The original account belongs to another shared coordinator.');
  const selection=sourceSelection(selected.source,ACCOUNT_PATH);
  need(selection.repository===ACCOUNT_REPOSITORY&&selection.branch==='mailbox-admission/v1/'+key,
   'Keep the original account repository and exact branch.');
  const read=await readFile(selection),checked=modules.admission.validateConnectedMailboxAccountState({
   account:selected.account,content:read.content,sha256Utf8,classifyReturnedGmailRateLimit,classifyReturnedSendRateLimit});
  need(checked.account_key===key&&checked.content_sha256===sha(read.content),'Original account validation changed identity.');
  entries.push({namespace:'account',key,...read,expected_sha256:null});
 }
 // A company-only receiving batch does not import or replace shared accounts.
 // Every explicitly selected account was checked against the unchanged whole
 // coordinator authority above; missing accounts remain unavailable for sends.
 for(const selected of contacts){
  const input=selected.reviewedInput;need(input&&typeof input==='object','Retain the complete original reviewed contact input.');
  const recipient=modules.gateway.recipientClaimPath(input.to),fingerprint=modules.intent.fingerprint(input);
  need(typeof recipient?.path==='string'&&typeof fingerprint?.branch==='string','Original contact identity modules are required.');
  const selection=sourceSelection(selected.recipient,recipient.path);
  need(selection.repository===CONTACT_REPOSITORY&&selection.branch==='main',
   'Keep the original recipient claim in the native Commons main source.');
  const read=await readFile(selection);
  entries.push({namespace:'recipient',key:recipient.path,...read,expected_sha256:null});
  const intent=selected.intent;
  repository(intent?.repository);need(intent.repository===CONTACT_REPOSITORY&&intent.branch===fingerprint.branch&&git(intent.ref_sha),
   'Pin the actual original native Commons intent reference.');
  const current=await pinHead(intent.repository,intent.branch,intent.ref_sha);
  const receipt={...clone(fingerprint),repo:intent.repository,status:'ALREADY_RESERVED',ref_sha:current.sha,
   url:'https://github.com/'+intent.repository+'/tree/'+intent.branch,native_readback:clone(current.observation)};
  const text=JSON.stringify({schema:'commons.local-contact-intent/v1',branch:intent.branch,reference:current.sha,
   original_reference:{repository:intent.repository,branch:intent.branch,ref_sha:current.sha}})+'\n';
  entries.push({namespace:'intent',key:intent.branch,content:text,expected_sha256:null,
   origin:{kind:'git-original-ref-readback',repository:intent.repository,branch:intent.branch,ref_sha:current.sha,
    sha256:sha(text),observed_at:observedAt,receipt}});
 }
 const checkpointKeys=new Set();
 for(const selected of checkpoints){
  need(selected&&hex(selected.input_sha256)&&typeof selected.lease==='string'&&selected.lease,'Retain the checkpoint original input hash and unchanged lease.');
  const operationKey=sha({input_sha256:selected.input_sha256,lease:selected.lease});
  if(selected.operationKey!==undefined)need(selected.operationKey===operationKey,'The original checkpoint operation identity changed.');
  need(!checkpointKeys.has(operationKey),'Duplicate checkpoint selection.');checkpointKeys.add(operationKey);
  const entry=await modules.checkpoint.prepareConnectedContactCheckpointAdoption({
   tools,sha256Utf8,operationKey,chunkCache:selected.chunkCache,githubRefAction,observedAt});
  need(entry?.namespace==='checkpoint'&&entry.key===operationKey&&typeof entry.content==='string'&&
   entry.origin?.kind==='git-original-checkpoint-readback'&&entry.origin.sha256===sha(entry.content),
   'Receive the complete original checkpoint and its original payload binding.');
  const retained=JSON.parse(entry.content),location=retained.original_location;
  need(location?.repository===ACCOUNT_REPOSITORY&&location.branch==='contact-checkpoint/v1/'+operationKey&&
   location.path==='state/contact-checkpoint.json'&&git(location.commit)&&git(location.blob_sha)&&
   entry.origin.repository===location.repository&&entry.origin.path===location.path&&
   entry.origin.commit_sha===location.commit&&entry.origin.blob_sha===location.blob_sha,
   'Keep the complete checkpoint at its actual original native location.');
  const headKey=location.repository+'\0'+location.branch,prior=heads.get(headKey);
  need(!prior||prior.sha===location.commit,'The checkpoint source branch has inconsistent selections.');
  // The original preparer already read this head before its immutable pointer.
  // Join that exact observation to the final all-source head recheck below.
  if(!prior)heads.set(headKey,{repository:location.repository,branch:location.branch,sha:location.commit});
  entries.push({...clone(entry),expected_sha256:null});
 }
 for(const selected of originalJournals){
  need(selected&&typeof selected.runtimeInputText==='string'&&typeof selected.journalText==='string',
   'Retain the complete original session input and journal text.');
  const entry=await modules.checkpoint.prepareConnectedContactJournalAdoption({
   tools,factory,modules,runtimeInputText:selected.runtimeInputText,journalText:selected.journalText,
   stateKey:selected.stateKey,lease:selected.lease,source:selected.source,
   observedAt,githubActorAction,githubRefAction});
  const origin=entry?.origin;
  need(entry?.namespace==='checkpoint'&&hex(entry.key)&&typeof entry.content==='string'&&
   origin?.kind==='original-session-journal-readback'&&origin.sha256===sha(entry.content)&&
   origin.runtime_input_content===selected.runtimeInputText&&origin.journal_content===selected.journalText&&
   origin.state_key===selected.stateKey&&origin.operation_lease===selected.lease&&
   canonical(origin.source)===canonical(selected.source)&&origin.observed_at===observedAt&&
   hex(origin.input_sha256)&&entry.key===sha({input_sha256:origin.input_sha256,lease:selected.lease}),
   'Keep the exact original session bytes, operation identity and truthful source custody.');
  if(selected.operationKey!==undefined)need(selected.operationKey===entry.key,
   'The original session operation identity changed.');
  need(!checkpointKeys.has(entry.key),'Duplicate checkpoint selection.');checkpointKeys.add(entry.key);
  entries.push({...clone(entry),expected_sha256:null});
 }
 // These rereads detect a changed original source selection during preparation.
 // They do not replace the required original-controller handoff.
 for(const source of heads.values()){
  const received=await readHead(source.repository,source.branch);
  need(received.sha===source.sha,'An original branch advanced during preparation; no batch was received.');
 }
 const request={operation_id:operationId,entries};
 need(bytes(JSON.stringify(request))<=MAX,'The whole original batch exceeds the coordinator request limit.');
 const prepared={schema:SCHEMA,operation_id:operationId,prepared_at:observedAt,
  coordinator:{kind:KIND,coordinator_id:storage.coordinatorId,authority:clone(selectedAuthority),authority_sha256:sha(canonical(selectedAuthority))},
  handoff:owner,request,request_sha256:sha(request),source_observations:observations,
  selection_counts:{accounts:accounts.length,contacts:contacts.length,checkpoints:checkpoints.length,original_journals:originalJournals.length}};
 prepared.preparation_sha256=sha(canonical(prepared));checkPrepared(prepared);
 await record({phase:'original-local-batch-prepared',operation_id:operationId,preparation_sha256:prepared.preparation_sha256,
  request_sha256:prepared.request_sha256,observed_at:new Date().toISOString()});
 return prepared;
}
async function receivePreparedConnectedContactAdoption({prepared,storage,record}={}){
 checkPrepared(prepared);storageSelection(storage);need(typeof record==='function','Persist the original receiving invocation and exact return.');
 need(storage.coordinatorId===prepared.coordinator.coordinator_id,'Use the original selected fleet coordinator.');
 const current=authority(await storage.verify(),storage);
 need(sha(canonical(current))===prepared.coordinator.authority_sha256,'The original fleet authority changed.');
 const request=clone(prepared.request),binding='commons.local-state.receiveBatch';
 const call_id=sha({operation_id:prepared.operation_id,request_sha256:prepared.request_sha256,observed_at:new Date().toISOString()});
 await record({phase:'invoking',binding,call_id,args:clone(request),preparation_sha256:prepared.preparation_sha256,observed_at:new Date().toISOString()});
 let raw;try{raw=await storage.receiveBatch(request);}catch(error){
  await record({phase:'failed',binding,call_id,code:typeof error?.code==='string'?error.code:null,
   status:Number(error?.status||0),message:'Original receiving did not return a confirmed result; retain this exact prepared batch.',
   observed_at:new Date().toISOString()});throw error;
 }
 await record({phase:'returned',binding,call_id,raw:clone(raw),observed_at:new Date().toISOString()});
 need(raw?.status==='ORIGINAL_STATE_RECEIVED'&&raw.coordinator_id===storage.coordinatorId&&
  raw.operation_id===prepared.operation_id&&Array.isArray(raw.records)&&raw.records.length===request.entries.length,
  'Receive the complete original batch result.');
 raw.records.forEach((snapshot,index)=>{
  const entry=request.entries[index],receipt=snapshot?.receipt;
  need(snapshot?.kind==='commons.connected-contact-local-snapshot/v1'&&snapshot.coordinator_id===storage.coordinatorId&&
   snapshot.namespace===entry.namespace&&snapshot.key===entry.key&&snapshot.revision===1&&
   snapshot.content===entry.content&&snapshot.sha256===sha(entry.content)&&
   receipt?.schema==='commons.connected-contact-local-receipt/v1'&&receipt.coordinator_id===storage.coordinatorId&&
   receipt.namespace===entry.namespace&&receipt.key===entry.key&&receipt.revision===1&&receipt.sha256===snapshot.sha256&&
   receipt.previous_sha256===null&&receipt.bytes===bytes(entry.content)&&iso(receipt.created_at)&&
   receipt.operation_id===prepared.operation_id+':'+index&&receipt.action==='receive'&&
   canonical(receipt.origin)===canonical(entry.origin),'The original batch receipt changed its exact source selection.');
 });
 return {schema:'commons.connected-contact-adoption-receipt/v1',operation_id:prepared.operation_id,
  preparation_sha256:prepared.preparation_sha256,request_sha256:prepared.request_sha256,
  coordinator_id:storage.coordinatorId,status:'ORIGINAL_STATE_RECEIVED',result:clone(raw)};
}
module.exports={prepareConnectedContactAdoption,receivePreparedConnectedContactAdoption,checkPrepared,SCHEMA};
