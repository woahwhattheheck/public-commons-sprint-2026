'use strict';

// Author the already authorized original Doc with a complete source packet.
// The maintained connected_document_delivery module owns Library receiving.
// No alternate provider, account switch, sharing mutation or automatic retry.
const SCHEMA = 'commons.connected_document_authoring/v1';
const BINDINGS = Object.freeze({
  profile: 'mcp__codex_apps__google_drive_get_profile',
  metadata: 'mcp__codex_apps__google_drive_get_file_metadata',
  document: 'mcp__codex_apps__google_drive_get_document_text',
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
  let state=options.state?copy(options.state):null,running=false;
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
  async function originalDocument(plan){
    const doc=await call('document',{document_id:plan.document_id});
    if(doc.documentId!==plan.document_id||typeof doc.revisionId!=='string'||!doc.revisionId||
       !Array.isArray(doc.paragraphs)||doc.paragraphs.length!==1)
      throw failure('DOCUMENT_LAYOUT','This receiving Doc must contain one original plain JSON paragraph');
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
  async function documentReady(plan,text){
    const original=await originalDocument(plan);
    if(original.text===text){
      state.document={status:'VERIFIED',revision:original.revision,tab_id:original.tabId,source:plan.source};
      await retain();return;
    }
    if(['WRITE_STARTED','WRITE_ACCEPTED'].includes(state.document.status))
      throw failure('RECONCILE_DOCUMENT','The original write is retained; reconcile its actual content before another write');
    if(sha256Utf8(original.text).sha256!==plan.document_preimage_sha256)
      throw failure('DOCUMENT_PREIMAGE','The original receiving Doc has changed');
    const requests=[],tab=original.tabId?{tabId:original.tabId}:{};
    if(original.end>original.start)requests.push({deleteContentRange:{range:{startIndex:original.start,endIndex:original.end,...tab}}});
    requests.push({insertText:{location:{index:1,...tab},text}});
    state.document={status:'WRITE_STARTED',revision:original.revision,preimage:sha256Utf8(original.text)};
    await retain();
    const written=await call('writeDocument',{document_id:plan.document_id,
      write_control:{requiredRevisionId:original.revision},requests});
    if(written.documentId!==plan.document_id)
      throw failure('RECONCILE_DOCUMENT','Native write did not return the selected Doc identity');
    state.document={...state.document,status:'WRITE_ACCEPTED',
      accepted_revision:written.revisionId||written.writeControl?.requiredRevisionId||null};
    await retain();
    const after=await originalDocument(plan);
    if(after.text!==text||after.tabId!==original.tabId)throw failure('DOCUMENT_BYTES','Full original Doc readback differs from the complete source packet');
    state.document={status:'VERIFIED',revision:after.revision,tab_id:after.tabId,source:plan.source};await retain();
  }
  async function execute(input,inspectOnly=false){
    if(running)throw failure('RUNNING','Continue the existing in-flight operation');
    running=true;
    try{
      // Snapshot the complete caller-owned request before any awaited callback.
      const request=copy(input);
      const plan=await initialize(request);
      await identity(plan);
      if(inspectOnly){
        const original=await originalDocument(plan);
        if(original.text!==request.text)
          throw failure('DOCUMENT_BYTES','Original Doc differs from the complete selected source packet');
        state.document={status:'VERIFIED',revision:original.revision,tab_id:original.tabId,source:plan.source};
      }else await documentReady(plan,request.text);
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
        state.last_failure={code:error.code||error.name,message:cleanMessage(error.message),
          at:new Date(now()).toISOString(),
          ...(error.retry_after_seconds?{retry_after_seconds:error.retry_after_seconds,
            retry_at_ms:now()+error.retry_after_seconds*1000}:{})};
        await retain();
      }
      throw error;
    }finally{running=false;}
  }
  return Object.freeze({
    run:input=>execute(input,false),
    inspect:input=>execute(input,true),
    snapshot
  });
}
module.exports={SCHEMA,BINDINGS,prepare,createDocumentAuthoring};
