'use strict';

// Source-cohort orchestration only. Provider and checkpoint operations remain
// the original sender's and original checkpoint's explicit public methods.
const SCHEMA='commons.connected-contact-source-selection/v1';
const RECORD='commons.connected-contact-source-activation/v1';
const MAX_SOURCE=16*1024*1024, MAX_SELECTION=64*1024*1024;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const clone=v=>JSON.parse(JSON.stringify(v));
const json=v=>JSON.stringify(v);
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':plain(v)?
 '{'+Object.keys(v).sort().map(k=>json(k)+':'+canonical(v[k])).join(',')+'}':json(v);
function fail(code,message){throw Object.assign(new Error(message||code),{code});}
function requireValue(ok,code,message){if(!ok)fail(code,message);}
function freeze(v){if(v&&typeof v==='object'&&!Object.isFrozen(v)){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;}
function measure(hash,text){
 requireValue(typeof text==='string','CONTACT_SOURCE_TEXT_REQUIRED');
 const result=hash(text);
 requireValue(plain(result)&&hex(result.sha256)&&Number.isSafeInteger(result.bytes)&&result.bytes>=0,'CONTACT_SOURCE_HASH_REQUIRED');
 return {bytes:result.bytes,sha256:result.sha256};
}
function selectedEnvelope(value,hash){
 requireValue(plain(value)&&typeof value.raw==='string'&&hex(value.sha256)&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&value.bytes<=MAX_SOURCE,'CONTACT_SOURCE_COMPLETE_CAPSULE_REQUIRED');
 const actual=measure(hash,value.raw);
 requireValue(actual.bytes===value.bytes&&actual.sha256===value.sha256,'CONTACT_SOURCE_CAPSULE_CHANGED');
 return freeze({raw:value.raw,...actual});
}
function loadEnvelope(envelope,hash){
 // The externally selected complete packet hash is checked before any of its
 // reviewed JavaScript is evaluated. This is not a sandbox for unknown code.
 const packet=JSON.parse(envelope.raw);
 requireValue(packet.schema==='commons.connected-contact-required-source-closure.v1'&&
  ['woahwhattheheck/commons','woahwhattheheck/public-commons-sprint-2026'].includes(packet.repository)&&typeof packet.loader?.content==='string','CONTACT_SOURCE_ORIGINAL_LOADER_REQUIRED');
 const actual=measure(hash,packet.loader.content);
 requireValue(actual.bytes===packet.loader.bytes&&actual.sha256===packet.loader.sha256,'CONTACT_SOURCE_LOADER_CHANGED');
 const receiver={exports:{}};
 new Function('module','exports',packet.loader.content)(receiver,receiver.exports);
 requireValue(typeof receiver.exports.loadCurrentContactClosure==='function','CONTACT_SOURCE_ORIGINAL_LOADER_REQUIRED');
 const cohort=receiver.exports.loadCurrentContactClosure(packet);
 requireValue(typeof cohort.factory?.createConnectedFirstContact==='function'&&
  typeof cohort.checkpoint?.openConnectedContactCheckpoint==='function'&&
  typeof cohort.modules?.sha256Utf8==='function','CONTACT_SOURCE_COMPLETE_COHORT_REQUIRED');
 return cohort;
}
function contextValue(context){
 const {input,stateKey,lease,organizationQuery,organizationDomains,githubActorAction,githubRefAction}=context;
 return {input,stateKey,lease,...(organizationQuery===undefined?{}:{organizationQuery}),
  ...(organizationDomains===undefined?{}:{organizationDomains}),
  ...(githubActorAction===undefined?{}:{githubActorAction}),
  ...(githubRefAction===undefined?{}:{githubRefAction})};
}
function createContactSourceActivation(options){
 const {context,load,store,selectionKey,initial,sha256Utf8}=options||{};
 requireValue(plain(context)&&plain(context.input)&&typeof context.stateKey==='string'&&context.stateKey&&
  typeof context.lease==='string'&&context.lease&&typeof load==='function'&&typeof store==='function'&&
  typeof selectionKey==='string'&&selectionKey&&selectionKey!==context.stateKey&&typeof sha256Utf8==='function',
  'CONTACT_SOURCE_ORIGINAL_CONTEXT_REQUIRED');
 requireValue(!context.nativeDraft&&!context.input.native_draft,'CONTACT_SOURCE_DRAFT_RECEIVER_REQUIRED',
  'Keep a native Gmail draft in its original maintained draft receiver.');
 requireValue(context.tools&&typeof context.tools==='object','CONTACT_SOURCE_ORIGINAL_TOOLS_REQUIRED');
 const contextRaw=json(contextValue(context)),fixed=freeze(clone(contextValue(context)));
 const boundTools=context.tools,toolBindings=new Map(),boundStorage=context.storage;
 const privateMailboxes=context.mailboxes===undefined?null:freeze(clone(context.mailboxes));
 const privateMailboxText=json(privateMailboxes);
 const inspectStorage=boundStorage?new Proxy(boundStorage,{get(target,key){const value=target[key];return typeof value==='function'?()=>fail('CONTACT_SOURCE_STORAGE_CALL_PROHIBITED'):value;}}):undefined;
 const callbacks={beforeSend:context.beforeSend,beforeNativeSend:context.beforeNativeSend};
 for(const value of Object.values(callbacks))requireValue(value===undefined||typeof value==='function','CONTACT_SOURCE_ORIGINAL_CALLBACK_REQUIRED');
 const hash=text=>measure(sha256Utf8,text),initialSource=selectedEnvelope(initial,sha256Utf8);
 const loaded=new Map(),prepared=new WeakMap();
 let busy=false,selectionCache=null;
 const cohort=source=>{
  if(!loaded.has(source.sha256))loaded.set(source.sha256,loadEnvelope(source,sha256Utf8));
  const result=loaded.get(source.sha256);return privateMailboxes?{...result,modules:Object.freeze({...result.modules,mailboxes:privateMailboxes})}:result;
 };
 const checkContext=()=>{
  requireValue(context.tools===boundTools&&context.storage===boundStorage&&json(context.mailboxes===undefined?null:context.mailboxes)===privateMailboxText&&json(contextValue(context))===contextRaw&&context.beforeSend===callbacks.beforeSend&&
   context.beforeNativeSend===callbacks.beforeNativeSend,'CONTACT_SOURCE_CONTEXT_CHANGED');
  for(const [key,value] of toolBindings)requireValue(boundTools[key]===value,'CONTACT_SOURCE_TOOL_BINDING_CHANGED');
 };
 const toolValue=key=>{const value=boundTools[key];
  if(toolBindings.has(key))requireValue(value===toolBindings.get(key),'CONTACT_SOURCE_TOOL_BINDING_CHANGED');
  else if(typeof value==='function')toolBindings.set(key,value);
  return value;};
 const readJournal=()=>{
  checkContext();const value=load(fixed.stateKey);
  requireValue(plain(value)&&value.schema==='commons.connected-first-contact/v1'&&Array.isArray(value.events)&&
   value.lease===fixed.lease&&hex(value.input_sha256),'CONTACT_SOURCE_EXISTING_JOURNAL_REQUIRED');
  const raw=json(value);return {value:JSON.parse(raw),raw,...hash(raw)};
 };
 function readSelection(){
  const value=load(selectionKey);
  if(value===undefined||value===null)return null;
  requireValue(plain(value)&&value.schema===SCHEMA&&value.context_sha256===hash(contextRaw).sha256&&
   Number.isSafeInteger(value.revision)&&value.revision>=1&&Array.isArray(value.sources)&&
   Array.isArray(value.activations)&&value.activations.length===value.revision&&hex(value.active_sha256),
   'CONTACT_SOURCE_SELECTION_CHANGED');
  const raw=json(value);if(selectionCache?.raw===raw)return selectionCache;
  requireValue(hash(raw).bytes<=MAX_SELECTION,'CONTACT_SOURCE_SELECTION_TOO_LARGE');
  const sources=new Map();
  for(const row of value.sources){const source=selectedEnvelope(row,sha256Utf8);
   requireValue(!sources.has(source.sha256),'CONTACT_SOURCE_DUPLICATE_CAPSULE');sources.set(source.sha256,source);}
  let prior=null;
  for(let i=0;i<value.activations.length;i++){
   const a=value.activations[i];
   requireValue(plain(a)&&a.revision===i+1&&sources.has(a.previous_sha256)&&sources.has(a.selected_sha256)&&
    (i===0||a.previous_sha256===prior)&&hex(a.journal_sha256)&&Number.isSafeInteger(a.journal_bytes)&&
    a.journal_bytes>0&&Number.isSafeInteger(a.event_count)&&a.event_count>=0&&hex(a.proof_sha256),
    'CONTACT_SOURCE_ACTIVATION_HISTORY_CHANGED');
   prior=a.selected_sha256;
  }
  requireValue(prior===value.active_sha256,'CONTACT_SOURCE_SELECTION_CHANGED');
  selectionCache={value:JSON.parse(raw),raw,sources};return selectionCache;
 }
 const selectedSource=selection=>selection?selection.sources.get(selection.value.active_sha256):initialSource;
 function isolated(source,journal){
  let retained=journal.raw,providerCalls=0,callbackCalls=0;
  const unavailable=()=>{providerCalls++;fail('CONTACT_SOURCE_PROVIDER_CALL_PROHIBITED');};
  const tools=new Proxy(boundTools,{get(target,key){const value=toolValue(key);return typeof value==='function'?unavailable:value;}});
  const blocked=()=>{callbackCalls++;fail('CONTACT_SOURCE_CALLBACK_CALL_PROHIBITED');};
  const loadedSource=cohort(source);
  const handle=loadedSource.factory.createConnectedFirstContact({...fixed,tools,storage:inspectStorage,modules:loadedSource.modules,
   ...Object.fromEntries(Object.entries(callbacks).map(([key,value])=>[key,value===undefined?undefined:blocked])),
   load:key=>key===fixed.stateKey?JSON.parse(retained):undefined,
   store:(key,value)=>{requireValue(key===fixed.stateKey&&json(value)===journal.raw,'CONTACT_SOURCE_JOURNAL_MUTATION_PROHIBITED');retained=json(value);}});
  const result={plan:handle.plan(),status:handle.status()};
  requireValue(typeof loadedSource.modules.mailboxAdmission?.inspectConnectedMailboxHistory==='function','CONTACT_SOURCE_ACCOUNT_HISTORY_REQUIRED');
  result.account_history=loadedSource.modules.mailboxAdmission.inspectConnectedMailboxHistory({
   storage:inspectStorage,account:result.plan.sender,events:journal.value.events.filter(event=>event.phase==='account-admission').map(event=>event.event),
   sha256Utf8:loadedSource.modules.sha256Utf8,
   classifyReturnedGmailRateLimit:loadedSource.factory.classifyReturnedGmailRateLimit,
   classifyReturnedSendRateLimit:loadedSource.factory.classifyReturnedSendRateLimit});
  requireValue(!result.account_history?.then,'CONTACT_SOURCE_PURE_INSPECTION_REQUIRED');
  requireValue(!result.plan?.then&&!result.status?.then,'CONTACT_SOURCE_PURE_INSPECTION_REQUIRED');
  try{result.rate={value:handle.rateLimitContinuation()};}
  catch(error){if(providerCalls||callbackCalls)throw error;result.rate={error:{name:error.name,message:error.message,code:error.code||null}};}
  requireValue(!result.rate.value?.then&&providerCalls===0&&callbackCalls===0&&retained===journal.raw,'CONTACT_SOURCE_PURE_INSPECTION_REQUIRED');
  requireValue(result.plan.input_sha256===journal.value.input_sha256&&result.plan.state_key===fixed.stateKey,
   'CONTACT_SOURCE_OPERATION_CHANGED');
  return clone(result);
 }
 function prepare(next){
  requireValue(!busy,'CONTACT_SOURCE_OPERATION_ACTIVE');
  const before=readSelection(),journal=readJournal(),previous=selectedSource(before);
  const candidate=selectedEnvelope(next,sha256Utf8);
  const priorProof=isolated(previous,journal),nextProof=isolated(candidate,journal);
  requireValue(canonical(priorProof)===canonical(nextProof),'CONTACT_SOURCE_COMPATIBILITY_CHANGED',
   'The candidate changes the original plan, status, full account history or retained rate evidence. Review the complete difference before adopting another source.');
  requireValue(readJournal().raw===journal.raw&&(readSelection()?.raw||null)===(before?.raw||null),'CONTACT_SOURCE_STALE_PREPARATION');
  const proof={context_sha256:hash(contextRaw).sha256,journal_sha256:journal.sha256,journal_bytes:journal.bytes,
   event_count:journal.value.events.length,previous_sha256:previous.sha256,selected_sha256:candidate.sha256,
   plan:priorProof.plan,status:priorProof.status,rate:priorProof.rate,account_history:priorProof.account_history};
  const publicPlan=freeze({schema:'commons.connected-contact-source-preparation/v1',...proof,proof_sha256:hash(json(proof)).sha256});
  prepared.set(publicPlan,{before:before?.raw||null,journal,previous,candidate,proof:publicPlan});
  return publicPlan;
 }
 function activate(plan){
  requireValue(!busy,'CONTACT_SOURCE_OPERATION_ACTIVE');const p=prepared.get(plan);
  requireValue(p,'CONTACT_SOURCE_OWN_PREPARATION_REQUIRED');
  const before=readSelection();
  requireValue((before?.raw||null)===p.before&&readJournal().raw===p.journal.raw,'CONTACT_SOURCE_STALE_PREPARATION');
  const sources=new Map(before?before.sources:[[p.previous.sha256,p.previous]]);
  sources.set(p.candidate.sha256,p.candidate);
  const revision=(before?.value.revision||0)+1;
  const activation={revision,previous_sha256:p.previous.sha256,selected_sha256:p.candidate.sha256,
   journal_sha256:p.journal.sha256,journal_bytes:p.journal.bytes,event_count:p.journal.value.events.length,
   proof_sha256:p.proof.proof_sha256};
  const next={schema:SCHEMA,context_sha256:hash(contextRaw).sha256,revision,active_sha256:p.candidate.sha256,
   sources:[...sources.values()].map(clone),activations:[...(before?.value.activations||[]),activation]};
  const raw=json(next);requireValue(hash(raw).bytes<=MAX_SELECTION,'CONTACT_SOURCE_SELECTION_TOO_LARGE');
  // There is no awaited work between the final guards and this single local
  // selection write. The live journal and all commercial state stay untouched.
  let writeError;
  try{store(selectionKey,clone(next));}catch(error){writeError=error;}
  const observed=readSelection();
  if(observed?.raw!==raw){
   if(writeError)throw writeError;
   fail('CONTACT_SOURCE_ACTIVATION_UNCONFIRMED');
  }
  prepared.delete(plan);
  return freeze({...activation,selection_sha256:hash(raw).sha256,recovered_write:Boolean(writeError)});
 }
 function preparePrevious(){
  const selection=readSelection();requireValue(selection,'CONTACT_SOURCE_SELECTION_REQUIRED');
  const last=selection.value.activations.at(-1),journal=readJournal();
  requireValue(journal.sha256===last.journal_sha256&&journal.bytes===last.journal_bytes,
   'CONTACT_SOURCE_PREVIOUS_REQUIRES_UNCHANGED_JOURNAL',
   'The operation advanced after source activation. Reopen its current original checkpoint; do not restore an older journal or silently downgrade source.');
  return prepare(selection.sources.get(last.previous_sha256));
 }
 async function invoke(name,...args){
  requireValue(['plan','status','rateLimitContinuation'].includes(name),'CONTACT_SOURCE_CHECKPOINT_METHOD_REQUIRED',
   'Use the original opened checkpoint handle for provider operations and transport recovery.');
  requireValue(!busy,'CONTACT_SOURCE_OPERATION_ACTIVE');checkContext();busy=true;
  try{
   const selection=readSelection(),selectionRaw=selection?.raw||null,source=selectedSource(selection),loadedSource=cohort(source);
   let expected=readJournal().raw;
   const guard=()=>{checkContext();requireValue((readSelection()?.raw||null)===selectionRaw&&readJournal().raw===expected,'CONTACT_SOURCE_LIVE_STATE_CHANGED');};
   const tools=new Proxy(boundTools,{get(target,key){const value=toolValue(key);return typeof value==='function'?
    (...arguments_)=>{guard();requireValue(toolValue(key)===value,'CONTACT_SOURCE_TOOL_BINDING_CHANGED');
     fail('CONTACT_SOURCE_INSPECTION_PROVIDER_CALL_PROHIBITED');}:value;}});
   const handle=loadedSource.factory.createConnectedFirstContact({...fixed,...callbacks,tools,storage:inspectStorage,modules:loadedSource.modules,
    load:key=>key===fixed.stateKey?JSON.parse(expected):undefined,
    store:(key,value)=>{guard();requireValue(key===fixed.stateKey,'CONTACT_SOURCE_STATE_KEY_CHANGED');
     const raw=json(value);store(key,JSON.parse(raw));
     requireValue(json(load(key))===raw,'CONTACT_SOURCE_JOURNAL_WRITE_UNCONFIRMED');expected=raw;}});
   requireValue(typeof name==='string'&&Object.hasOwn(handle,name)&&typeof handle[name]==='function','CONTACT_SOURCE_ORIGINAL_METHOD_REQUIRED');
   const result=await handle[name](...args);guard();return result;
  }finally{busy=false;}
 }
 function checkpointRecord(){
  requireValue(!busy,'CONTACT_SOURCE_OPERATION_ACTIVE');
  const selection=readSelection();requireValue(selection,'CONTACT_SOURCE_SELECTION_REQUIRED');
  const journal=readJournal(),loadedSource=cohort(selectedSource(selection)),proof=isolated(selectedSource(selection),journal);
  return {schema:RECORD,selection_json:selection.raw,selection_sha256:hash(selection.raw).sha256,
   selection_bytes:hash(selection.raw).bytes,input_sha256:journal.value.input_sha256,
   operation_key:hash(json({input_sha256:journal.value.input_sha256,lease:fixed.lease})).sha256,
   state_key:fixed.stateKey,lease:fixed.lease,journal_sha256:journal.sha256,journal_bytes:journal.bytes,
   event_count:journal.value.events.length,events_sha256:hash(json(journal.value.events)).sha256,
   source_commit:loadedSource.sourceCommit,active_sha256:selection.value.active_sha256,
   context_sha256:hash(contextRaw).sha256,plan_sha256:hash(json(proof.plan)).sha256};
 }
 async function retainCheckpoint(handle){
  const record=checkpointRecord();
  requireValue(typeof handle?.retainSourceActivation==='function'&&typeof handle?.snapshot==='function',
   'CONTACT_SOURCE_CURRENT_CHECKPOINT_REQUIRED');
  requireValue(json(handle.snapshot().journal)===readJournal().raw,'CONTACT_SOURCE_CHECKPOINT_JOURNAL_CHANGED');
  busy=true;
  try{return await handle.retainSourceActivation(record);}
  finally{busy=false;}
 }
 return Object.freeze({prepare,activate,preparePrevious,invoke,checkpointRecord,retainCheckpoint,
  selection:()=>clone(readSelection()?.value||null),
  snapshot:()=>({selection:clone(readSelection()?.value||null),journal:readJournal().value}),
  interfaces:()=>{const s=selectedSource(readSelection()),c=cohort(s);
   return Object.freeze({factory:c.factory,modules:c.modules,checkpoint:c.checkpoint,sourceCommit:c.sourceCommit,
    capsule_sha256:s.sha256});}});
}
function receiveContactSourceSelection({payload,context,load,store,selectionKey,sha256Utf8}){
 // Original readConnectedContactCheckpoint supplied this complete payload.
 // Installation never replaces a newer local journal.
 const record=payload?.contact_source_activation,journal=payload?.journal;
 requireValue(record?.schema===RECORD&&plain(journal)&&record.input_sha256===journal.input_sha256&&
  record.lease===journal.lease&&record.state_key===context?.stateKey&&record.lease===context?.lease,
  'CONTACT_SOURCE_ORIGINAL_CHECKPOINT_REQUIRED');
 const actual=measure(sha256Utf8,record.selection_json);
 requireValue(actual.sha256===record.selection_sha256&&actual.bytes===record.selection_bytes,'CONTACT_SOURCE_SELECTION_CHANGED');
 const selection=JSON.parse(record.selection_json),source=selection.sources?.find(x=>x.sha256===selection.active_sha256);
 requireValue(source&&selection.active_sha256===record.active_sha256&&journal.events.length>=record.event_count&&
  measure(sha256Utf8,json(journal.events.slice(0,record.event_count))).sha256===record.events_sha256,
  'CONTACT_SOURCE_CHECKPOINT_HISTORY_CHANGED');
 const current=load(context.stateKey);
 requireValue(plain(current)&&json(current)===json(journal),'CONTACT_SOURCE_CURRENT_JOURNAL_REQUIRED',
  'Receive the original complete checkpoint journal through its existing operation before selecting source.');
 const old=load(selectionKey);
 requireValue(old===undefined||old===null||json(old)===record.selection_json,'CONTACT_SOURCE_LOCAL_SELECTION_CHANGED');
 const memory=new Map([[context.stateKey,clone(journal)],[selectionKey,selection]]);
 const pure=createContactSourceActivation({context,load:key=>memory.get(key),store:(key,value)=>memory.set(key,value),
  selectionKey,initial:source,sha256Utf8});
 const proof=pure.prepare(source),cohort=pure.interfaces();
 requireValue(typeof cohort.checkpoint.validateContactSourceActivation==='function','CONTACT_SOURCE_CURRENT_CHECKPOINT_REQUIRED');
 const operationKey=measure(sha256Utf8,json({input_sha256:journal.input_sha256,lease:context.lease})).sha256;
 cohort.checkpoint.validateContactSourceActivation(record,{journal,stateKey:context.stateKey,
  lease:context.lease,operationKey,sha256Utf8});
 requireValue(record.source_commit===cohort.sourceCommit&&record.context_sha256===selection.context_sha256&&
  record.plan_sha256===measure(sha256Utf8,json(proof.plan)).sha256,'CONTACT_SOURCE_CHECKPOINT_BINDING_CHANGED');
 if(old===undefined||old===null)store(selectionKey,clone(selection));
 requireValue(json(load(selectionKey))===record.selection_json,'CONTACT_SOURCE_SELECTION_WRITE_UNCONFIRMED');
 return createContactSourceActivation({context,load,store,selectionKey,initial:source,sha256Utf8});
}
module.exports={createContactSourceActivation,receiveContactSourceSelection};
