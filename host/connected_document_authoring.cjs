'use strict';

// Author the already authorized original Doc with a complete source packet.
// The maintained connected_document_delivery module owns Library receiving.
// No alternate provider, account switch, sharing mutation or automatic retry.
const SCHEMA = 'commons.connected_document_authoring/v1';
const BINDINGS = Object.freeze({
  profile: 'mcp__codex_apps__google_drive_get_profile',
  metadata: 'mcp__codex_apps__google_drive_get_file_metadata',
  document: 'mcp__codex_apps__google_drive_get_document_text',
  fullDocument: 'mcp__codex_apps__google_drive_get_document',
  writeDocument: 'mcp__codex_apps__google_drive_batch_update_document'
});
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const copy = x => JSON.parse(JSON.stringify(x));
const digest = x => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x);
const cleanMessage = x => String(x).replace(/https?:\/\/[^\s"'<>]+/g, '[provider URL]');
function failure(code, message, extra) {
  return Object.assign(new Error(message), {name:'DocumentAuthoringError', code, ...(extra || {})});
}
function data(result) {
  if (!object(result)) throw failure('NATIVE_RESPONSE', 'Expected a native result object');
  let value = object(result.structuredContent) ? result.structuredContent : result;
  if (value === result && Array.isArray(result.content)) {
    const candidates = result.content.filter(x => x?.type === 'text' && typeof x.text === 'string')
      .flatMap(x => { try { const v=JSON.parse(x.text); return object(v)?[v]:[]; } catch (_) { return []; } });
    if (candidates.length === 1) value = candidates[0];
  }
  if (result.isError === true || value.isError === true || value.error || value.error_code) {
    const message = cleanMessage(value.error || value.error_code ||
      result.content?.find(x => x?.type === 'text')?.text || 'Native operation failed');
    const retry = Number(value.retry_after_seconds ?? value.retry_after ?? value.error_data?.retry_after);
    throw failure('NATIVE_ERROR', message, {native_response:result,
      ...(Number.isFinite(retry) && retry>0 ? {retry_after_seconds:retry} : {})});
  }
  return value;
}
function token(x, name) {
  if (typeof x !== 'string' || !x || /[\0\r\n]/.test(x)) throw new TypeError(name+' requires its exact original ID');
  return x;
}
function packetText(value) {
  // A single ASCII JSON source envelope has unambiguous native UTF-16 indices.
  // Original Unicode/binary bodies belong in the existing base64 source packet.
  if (typeof value !== 'string' || !value.length || value.length>900000 || /[^\x20-\x7e]/.test(value))
    throw new TypeError('Supply one complete single-line ASCII JSON packet, at most 900000 characters');
  const parsed=JSON.parse(value);
  if (!object(parsed)) throw new TypeError('Source packet must be a complete JSON object');
  return parsed;
}
function prepare(input, sha256Utf8) {
  if (!object(input)) throw new TypeError('Supply an explicit source and owned destination');
  packetText(input.text);
  const actor=token(input.actor_email,'actor_email').toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(actor)) throw new TypeError('actor_email must be one exact email');
  if (!digest(input.document_preimage_sha256)) throw new TypeError('Retain the original Doc text SHA-256');
  const source=sha256Utf8(input.text);
  if (!object(source)||!digest(source.sha256)||source.bytes!==input.text.length)
    throw new TypeError('Supply maintained sha256Utf8 returning complete bytes and SHA-256');
  const plan={operation_id:token(input.operation_id,'operation_id'),actor_email:actor,
    document_id:token(input.document_id,'document_id'),
    document_preimage_sha256:input.document_preimage_sha256,source};
  return {...plan,plan_sha256:sha256Utf8(JSON.stringify(plan)).sha256};
}
function createDocumentAuthoring(nativeTools, options = {}) {
  const sha256Utf8=options.sha256Utf8;
  const validate=options.validateSource;
  if (!object(nativeTools)||typeof sha256Utf8!=='function'||typeof validate!=='function')
    throw new TypeError('Supply native tools, maintained sha256Utf8 and complete source-packet validator');
  const bindings={...BINDINGS,...(options.bindings||{})},now=options.now||Date.now;
  const save=options.onState;
  if(typeof save!=='function')throw new TypeError('Supply the original durable onState receiver');
  let state=options.state?copy(options.state):null,running=false,closed=false,job=null;
  const schedule=options.setTimeout||globalThis.setTimeout,unschedule=options.clearTimeout||globalThis.clearTimeout;
  const snapshot=()=>state?copy(state):null;
  async function retain(){ await save(snapshot()); }
  async function call(name,args){
    const fn=nativeTools[bindings[name]];
    if(typeof fn!=='function')throw failure('MISSING_TOOL','Discover the native '+name+' action');
    state.native_calls++;
    return data(await fn.call(nativeTools,args));
  }
  async function initialize(input){
    const plan=prepare(input,sha256Utf8);
    const validation=await validate(packetText(input.text),input.text);
    if(validation===false)throw failure('SOURCE_VALIDATION','Complete source-packet validation failed');
    if(state){
      if(state.schema!==SCHEMA||state.plan_sha256!==plan.plan_sha256)
        throw failure('SOURCE_CHANGED','Continue the exact original source/Doc operation');
    }else state={schema:SCHEMA,...plan,status:'PREPARED',native_calls:0,
      document:{status:'NOT_WRITTEN'}};
    if(state.last_failure?.retry_at_ms>now())
      throw failure('PROVIDER_RETRY_AT','The original provider retry interval remains active');
    await retain();
    return plan;
  }
  async function identity(plan){
    const result=await Promise.allSettled([
      call('profile',{}),
      call('metadata',{fileId:plan.document_id,
        fields:'id,mimeType,capabilities(canEdit),owners(emailAddress)'})
    ]);
    for(const r of result)if(r.status==='rejected')throw r.reason;
    const actor=result[0].value,doc=result[1].value;
    if(typeof actor.id!=='string'||!actor.id||String(actor.email||'').toLowerCase()!==plan.actor_email||
       (state.actor?.id&&state.actor.id!==actor.id))
      throw failure('ACTOR_CHANGED','The connected Drive actor differs from the original operation');
    if(doc.id!==plan.document_id||(doc.mime_type||doc.mimeType)!=='application/vnd.google-apps.document'||
       doc.capabilities?.canEdit===false)
      throw failure('DOCUMENT_CHANGED','Select the same editable original native Doc');
    state.actor={email:plan.actor_email,id:actor.id||null};
    await retain();
  }
  async function emptyDocument(plan,flattened){
    // The native flattened reader omits a new Doc's empty final paragraph.
    // Admit it only from the complete original body at the SAME revision.
    const full=await call('fullDocument',{document_id:plan.document_id});
    const invalid=()=>{throw failure('DOCUMENT_LAYOUT','Use the complete original single-tab empty Doc with no side content or suggestions');};
    if(full.documentId!==plan.document_id||full.revisionId!==flattened.revisionId)invalid();
    function plain(container){
      if(!object(container))invalid();
      for(const name of ['footnotes','inlineObjects','positionedObjects','headers','footers'])
        if(container[name]!=null&&Object.keys(container[name]).length)invalid();
    }
    function suggestions(value){
      if(value==null||typeof value!=='object')return;
      for(const [name,item] of Object.entries(value)){
        if(name==='suggestionsViewMode'){
          if(item!=='SUGGESTIONS_INLINE')invalid();
          continue;
        }
        if((/suggest/i.test(name)||name==='positionedObjectIds')&&
          item!=null&&(typeof item!=='object'||Object.keys(item).length))invalid();
        suggestions(item);
      }
    }
    plain(full);suggestions(full);
    let body,tabId=null;
    if(full.tabs!=null&&!Array.isArray(full.tabs))invalid();
    if(full.tabs?.length){
      if(full.tabs.length!==1||full.body!=null)invalid();
      const tab=full.tabs[0];
      if(!object(tab)||tab.parentTabId!=null||tab.tabProperties?.parentTabId!=null||
        (tab.childTabs!=null&&(!Array.isArray(tab.childTabs)||tab.childTabs.length)))invalid();
      const ids=[tab.tabId,tab.tabProperties?.tabId].filter(value=>value!=null);
      if(!ids.length||ids.some(value=>typeof value!=='string'||!value||/[\0\r\n]/.test(value))||
        ids.some(value=>value!==ids[0]))invalid();
      tabId=ids[0];
      plain(tab);
      const content=tab.documentTab??tab;
      plain(content);
      body=content.body;
    }else body=full.body;
    if(!object(body)||!Array.isArray(body.content))invalid();
    const items=body.content;
    if(items.length!==2||!object(items[0].sectionBreak)||
      items[0].endIndex!==1||(items[0].startIndex!=null&&items[0].startIndex!==0)||
      Object.keys(items[0]).some(name=>!['startIndex','endIndex','sectionBreak'].includes(name)))invalid();
    const item=items[1],paragraph=item.paragraph;
    if(item.startIndex!==1||item.endIndex!==2||!object(paragraph)||
      Object.keys(item).some(name=>!['startIndex','endIndex','paragraph'].includes(name))||
      paragraph.bullet!=null||!Array.isArray(paragraph.elements)||paragraph.elements.length!==1)invalid();
    const element=paragraph.elements[0];
    if(element.startIndex!==1||element.endIndex!==2||!object(element.textRun)||
      element.textRun.content!=='\n'||Object.keys(element.textRun.textStyle||{}).length||
      Object.keys(element).some(name=>!['startIndex','endIndex','textRun'].includes(name)))invalid();
    return {text:'',revision:full.revisionId,start:1,end:1,tabId};
  }
  async function originalDocument(plan){
    const doc=await call('document',{document_id:plan.document_id});
    if(doc.documentId!==plan.document_id||typeof doc.revisionId!=='string'||!doc.revisionId||
       !Array.isArray(doc.paragraphs)||doc.paragraphs.length>1)
      throw failure('DOCUMENT_LAYOUT','This receiving Doc must contain one original plain JSON paragraph');
    if(doc.paragraphs.length===0)return emptyDocument(plan,doc);
    const p=doc.paragraphs[0];
    if(typeof p.text!=='string'||p.startIndex!==1||
       p.endIndex-p.startIndex!==p.text.length||
       (p.tabId!=null&&(typeof p.tabId!=='string'||!p.tabId||/[\0\r\n]/.test(p.tabId))))
      throw failure('DOCUMENT_LAYOUT','Native paragraph text and exact writable indices must agree');
    // A final paragraph newline, when returned, remains the Doc's own terminator.
    const tail=p.text.endsWith('\n')?1:0;
    const text=tail?p.text.slice(0,-1):p.text;
    if(/[^\x20-\x7e]/.test(text))
      throw failure('DOCUMENT_LAYOUT','Original receiving Doc has non-ASCII or multiline content');
    return {text,revision:doc.revisionId,start:p.startIndex,end:p.endIndex-tail,tabId:p.tabId||null};
  }
  function writeRequest(plan,text,original){
    const requests=[],tab=original.tabId?{tabId:original.tabId}:{};
    if(original.end>original.start)requests.push({deleteContentRange:{range:{
      startIndex:original.start,endIndex:original.end,...tab}}});
    requests.push({insertText:{location:{index:1,...tab},text}});
    return {document_id:plan.document_id,write_control:{requiredRevisionId:original.revision},requests};
  }
  function frozenWrite(plan,text){
    const frozen=state.document.write;
    if(!frozen)return null;
    const invalid=()=>{throw failure('WRITE_IDENTITY','Preserve the exact original Doc write, revision, tab and attempt history');};
    if(!object(frozen)||frozen.schema!=='commons.connected_document_write/v1'||
      !object(frozen.preimage)||frozen.preimage.sha256!==plan.document_preimage_sha256||
      !Number.isSafeInteger(frozen.preimage.bytes)||frozen.preimage.bytes<0||
      typeof frozen.revision!=='string'||!frozen.revision||
      (frozen.tab_id!==null&&(typeof frozen.tab_id!=='string'||!frozen.tab_id||/[\0\r\n]/.test(frozen.tab_id)))||
      !digest(frozen.request_sha256)||!Number.isSafeInteger(frozen.attempt)||frozen.attempt<1||
      !Array.isArray(frozen.attempts)||frozen.attempts.length!==frozen.attempt)invalid();
    const expected=writeRequest(plan,text,{revision:frozen.revision,tabId:frozen.tab_id,
      start:1,end:1+frozen.preimage.bytes});
    if(JSON.stringify(frozen.request)!==JSON.stringify(expected)||
      sha256Utf8(JSON.stringify(expected)).sha256!==frozen.request_sha256)invalid();
    for(let i=0;i<frozen.attempts.length;i++){
      const row=frozen.attempts[i];
      if(!object(row)||row.attempt!==i+1||typeof row.at!=='string'||!Number.isFinite(Date.parse(row.at))||
        !['STARTED','ACCEPTED','UNCERTAIN'].includes(row.status))invalid();
    }
    return frozen;
  }
  function createWrite(plan,text,original,{legacy=false}={}){
    const request=writeRequest(plan,text,original);
    return {schema:'commons.connected_document_write/v1',request,
      request_sha256:sha256Utf8(JSON.stringify(request)).sha256,
      revision:original.revision,tab_id:original.tabId,preimage:sha256Utf8(original.text),
      attempt:1,attempts:[{attempt:1,at:new Date(now()).toISOString(),
        status:legacy?'UNCERTAIN':'STARTED',...(legacy?{recovered_legacy:true}:{})}]};
  }
  async function verified(plan,original){
    state.document={...state.document,status:'VERIFIED',revision:original.revision,
      tab_id:original.tabId,source:plan.source};
    await retain();
  }
  function selectedContinuation(value){
    if(!object(value)||Object.keys(value).some(key=>!['expected_write_sha256','after_attempt'].includes(key))||
      !digest(value.expected_write_sha256)||!Number.isSafeInteger(value.after_attempt)||value.after_attempt<1)
      throw failure('CONTINUATION_SELECTION','Select the retained original write SHA-256 and its exact current attempt');
    return copy(value);
  }
  function checkContinuation(plan,text,selection){
    const frozen=frozenWrite(plan,text);
    if(!frozen||selection.expected_write_sha256!==frozen.request_sha256||selection.after_attempt!==frozen.attempt)
      throw failure('CONTINUATION_CHANGED','Read the same original operation and select its current retained write and attempt');
  }
  async function documentReady(plan,text,{mode='run',continuation=null}={}){
    let frozen=frozenWrite(plan,text);
    const original=await originalDocument(plan);
    if(original.text===text){
      if(frozen&&original.tabId!==frozen.tab_id)
        throw failure('DOCUMENT_CHANGED','The selected source is in a different tab; preserve the original write');
      await verified(plan,original);return true;
    }
    if(mode==='inspect')throw failure('DOCUMENT_BYTES','Original Doc differs from the complete selected source packet');
    const pending=['WRITE_STARTED','WRITE_ACCEPTED'].includes(state.document.status);
    if(!frozen&&pending){
      // Legacy state did not retain the full request. Reconstruct only from the
      // SAME original revision, whose native paragraph/tab is unchanged.
      if(original.revision!==state.document.revision||
        sha256Utf8(original.text).sha256!==plan.document_preimage_sha256||
        state.document.preimage?.sha256!==plan.document_preimage_sha256)
        throw failure('RECONCILE_DOCUMENT','The legacy write has no recoverable original revision; preserve it');
      state.document.write=createWrite(plan,text,original,{legacy:true});
      frozen=frozenWrite(plan,text);await retain();
    }
    if(frozen){
      if(original.revision!==frozen.revision||original.tabId!==frozen.tab_id||
        sha256Utf8(original.text).sha256!==frozen.preimage.sha256||
        sha256Utf8(original.text).bytes!==frozen.preimage.bytes)
        throw failure('DOCUMENT_REVISION_CHANGED','The original write revision has changed; no rebasing or repeated mutation is allowed');
      if(mode==='reconcile'){
        state.status='CONTINUATION_AVAILABLE';await retain();return false;
      }
      if(mode!=='continue')
        throw failure('RECONCILE_DOCUMENT','Use read-only reconcile, then explicitly continue the exact retained write and attempt');
      checkContinuation(plan,text,continuation);
      frozen.attempt++;
      frozen.attempts.push({attempt:frozen.attempt,at:new Date(now()).toISOString(),status:'STARTED'});
    }else{
      if(state.document.status==='VERIFIED')
        throw failure('DOCUMENT_REVISION_CHANGED','The previously verified source has changed; preserve the later Doc');
      if(sha256Utf8(original.text).sha256!==plan.document_preimage_sha256)
        throw failure('DOCUMENT_PREIMAGE','The original receiving Doc has changed');
      if(mode==='reconcile'){
        state.status='PREPARED';await retain();return false;
      }
      if(mode==='continue')throw failure('CONTINUATION_CHANGED','Reconcile this original operation before selecting a continuation');
      frozen=createWrite(plan,text,original);
    }
    state.document={...state.document,status:'WRITE_STARTED',revision:frozen.revision,
      preimage:copy(frozen.preimage),write:frozen};
    state.status='WRITE_PENDING';
    await retain(); // Complete exact CAS request and attempt precede dispatch.
    let written;
    try{
      if(closed)throw failure('CLOSED','The original owner closed before dispatch; keep its frozen request for reconciliation');
      written=await call('writeDocument',copy(frozen.request));
      if(written.documentId!==plan.document_id)
        throw failure('RECONCILE_DOCUMENT','Native write did not return the selected Doc identity');
    }catch(error){
      frozen.attempts[frozen.attempt-1].status='UNCERTAIN';
      frozen.attempts[frozen.attempt-1].code=String(error.code||error.name||'NATIVE_ERROR').slice(0,160);
      await retain();throw error;
    }
    const revision=written.revisionId||written.writeControl?.requiredRevisionId||null;
    Object.assign(frozen.attempts[frozen.attempt-1],{status:'ACCEPTED',accepted_revision:revision});
    state.document={...state.document,status:'WRITE_ACCEPTED',accepted_revision:revision};
    await retain();
    const after=await originalDocument(plan);
    if(after.text!==text||after.tabId!==frozen.tab_id)
      throw failure('DOCUMENT_BYTES','Full original Doc readback differs from the complete source packet');
    await verified(plan,after);return true;
  }
  async function execute(request,mode,continuation){
    try{
      const plan=await initialize(request);
      if(continuation)checkContinuation(plan,request.text,continuation);
      await identity(plan);
      const ready=await documentReady(plan,request.text,{mode,continuation});
      if(!ready)return {state:snapshot(),pending:state.document.write?{
        expected_write_sha256:state.document.write.request_sha256,
        after_attempt:state.document.write.attempt}:null};
      state.status='DOCUMENT_READY';
      delete state.last_failure;
      await retain();
      return {state:snapshot(),document:{
        document_id:plan.document_id,document_revision_id:state.document.revision,
        document_tab_id:state.document.tab_id,
        payload_sha256:plan.source.sha256,payload_bytes:plan.source.bytes
      }};
    }catch(error){
      if(state){
        // Local refusal/validation must not erase an active original provider interval.
        const observed=now(),previous=state.last_failure;
        const priorDeadline=previous?.retry_at_ms>observed?previous.retry_at_ms:0;
        const nextDeadline=error.retry_after_seconds?observed+error.retry_after_seconds*1000:0;
        const retryDeadline=Math.max(priorDeadline,nextDeadline);
        state.last_failure={code:error.code||error.name,message:cleanMessage(error.message),
          at:new Date(observed).toISOString(),
          ...(retryDeadline>observed?{
            retry_after_seconds:nextDeadline>=priorDeadline?error.retry_after_seconds:previous.retry_after_seconds,
            retry_at_ms:retryDeadline}:{})};
        await retain();
      }
      throw error;
    }finally{running=false;}
  }
  function begin(input,mode,continuation){
    if(closed)throw failure('CLOSED','This original authoring owner is closed');
    if(running)throw failure('RUNNING','Continue waiting for the same in-flight operation');
    // Snapshot complete caller input before validators, state writes or tools.
    const request=copy(input),selected=continuation?selectedContinuation(continuation):null;
    prepare(request,sha256Utf8);
    running=true;
    const current={settled:false,result:null,error:null,promise:null,completion:null};
    job=current;
    current.promise=Promise.resolve().then(()=>execute(request,mode,selected));
    // Always observe the original promise. Waiting never cancels or duplicates it.
    current.completion=current.promise.then(result=>{current.settled=true;current.result=result;},
      error=>{current.settled=true;current.error=error;});
    return current;
  }
  async function wait({timeout_ms=10000}={}){
    if(!Number.isSafeInteger(timeout_ms)||timeout_ms<0||timeout_ms>60000)
      throw new TypeError('timeout_ms must be an integer between 0 and 60000');
    const current=job;
    if(!current)throw failure('NOT_STARTED','Start or continue the same original operation first');
    if(!current.settled&&timeout_ms>0){
      if(typeof schedule!=='function'||typeof unschedule!=='function')
        throw failure('WAIT_TIMER_REQUIRED','Supply the runtime timers for bounded cooperative waiting');
      let timer;
      try{await Promise.race([current.completion,new Promise(resolve=>{timer=schedule(resolve,timeout_ms);})]);}
      finally{if(timer!==undefined)unschedule(timer);}
    }
    if(!current.settled)return {status:'PENDING',state:snapshot()};
    if(current.error)throw current.error;
    return {status:'SETTLED',result:copy(current.result)};
  }
  async function close(){
    closed=true;
    const current=job;
    if(current)await current.completion;
    return snapshot();
  }
  return Object.freeze({
    run:async input=>await begin(input,'run',null).promise,
    inspect:async input=>await begin(input,'inspect',null).promise,
    reconcile:async input=>await begin(input,'reconcile',null).promise,
    continue:async (input,selection)=>await begin(input,'continue',selection).promise,
    start:input=>{begin(input,'run',null);return {status:'PENDING',state:snapshot()};},
    startContinuation:(input,selection)=>{begin(input,'continue',selection);return {status:'PENDING',state:snapshot()};},
    wait,close,snapshot
  });
}
module.exports={SCHEMA,BINDINGS,prepare,createDocumentAuthoring};
