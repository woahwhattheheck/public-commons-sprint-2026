'use strict';

// Durable storage for the existing connected sender. This module never replaces
// the original intent, recipient, mailbox admission or Gmail reconciliation.
const REPOSITORY = 'woahwhattheheck/commons-ship-enforcer';
const PATH = 'state/contact-checkpoint.json';
const SCHEMA = 'commons.connected-contact-checkpoint/v1';
const HISTORY = 'commons.connected-contact-received-rate-history/v1';
const LIMIT = 256 * 1024 * 1024;
const LEASE_MS = 600000;
const CHUNK_CHARS = 32768;
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const git = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const clone = value => JSON.parse(JSON.stringify(value));
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const canonical = value => Array.isArray(value) ? '['+value.map(canonical).join(',')+']'
  : plain(value) ? '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}'
  : JSON.stringify(value);
function fail(code, message, data) {
  throw Object.assign(new Error(message || code), {code, ...(data || {})});
}
function hash(fn, value) {
  const r = fn(typeof value === 'string' ? value : JSON.stringify(value));
  if (!hex(r?.sha256) || !Number.isSafeInteger(r.bytes) || r.bytes < 0)
    fail('CONTACT_CHECKPOINT_HASH_REQUIRED');
  return r;
}
function parse(text) {
  if (typeof text !== 'string') fail('CONTACT_CHECKPOINT_COMPLETE_JSON_REQUIRED');
  let value; try { value=JSON.parse(text); } catch { fail('CONTACT_CHECKPOINT_COMPLETE_JSON_REQUIRED'); }
  return value;
}
function nativeError(raw) {
  const n=raw?.structuredContent;
  return Object.assign(new Error(n?.error || 'Original checkpoint provider operation failed'), {
    code:n?.error_code || 'CONTACT_CHECKPOINT_PROVIDER_FAILED',
    status:Number(n?.error_data?.status ?? n?.error_data?.code ??
      n?.error_data?.response?.status ?? n?.status ?? 0), native:raw
  });
}
function sourceContent(raw) {
  if (raw?.isError) throw nativeError(raw);
  const value=raw?.structuredContent;
  if (!plain(value)) fail('CONTACT_CHECKPOINT_NATIVE_RESPONSE_REQUIRED');
  return value;
}
function snapshotSourceFieldsMatch(snapshot,savedSource={}) {
  if(!plain(snapshot)||!plain(savedSource))return false;
  const fields=['journal','pending_pointer','transports'];
  for(const key of ['input_revision_source','session_input_revision_source']){
    if(savedSource[key]!==undefined)fields.push(key);
    if(canonical(snapshot[key]??null)!==canonical(savedSource[key]??null))return false;
  }
  return canonical(Object.keys(snapshot).sort())===canonical(fields.sort());
}

function validateReceivedReturnedAccountTail({savedState,snapshot,reviewed,account,lease,intent,path,operationKey,sha256Utf8}) {
 const bad=()=>fail('CONTACT_CHECKPOINT_RETURNED_ACCOUNT_TAIL_INVALID');
 const saved=savedState?.journal,complete=snapshot?.journal,old=savedState?.transports,transports=snapshot?.transports;
 const digest=v=>hash(sha256Utf8,v).sha256,without=(v,keys)=>Object.fromEntries(Object.entries(v).filter(([k])=>!keys.includes(k)));
 if(!plain(savedState)||!plain(snapshot)||snapshot.pending_pointer!==null||
  !snapshotSourceFieldsMatch(snapshot,savedState)||
  !plain(saved)||!plain(complete)||!Array.isArray(saved.events)||!Array.isArray(complete.events)||
  !Array.isArray(old)||!Array.isArray(transports)||old.length!==transports.length||!old.length||
  !plain(account)||!hex(operationKey)||typeof sha256Utf8!=='function'||
  saved.schema!=='commons.connected-first-contact/v1'||saved.lease!==lease||
  saved.input_sha256!==digest(JSON.stringify(reviewed))||canonical(saved.input)!==canonical(reviewed)||
  digest({input_sha256:saved.input_sha256,lease})!==operationKey||
  complete.events.length!==saved.events.length+8||
  canonical(without(saved,['events','outcome','account_deferred']))!==canonical(without(complete,['events','outcome','account_deferred'])))bad();
 for(let i=0;i<saved.events.length;i++)if(canonical(saved.events[i])!==canonical(complete.events[i]))bad();
 const pending=old.filter(t=>t.state!=='RETURNED');
 if(pending.length!==1||pending[0].state!=='INVOKING')bad();
 const before=pending[0],t=transports.find(v=>v.id===before.id),index=before.event_index;
 for(let i=0;i<old.length;i++)if(old[i].id!==before.id&&canonical(old[i])!==canonical(transports[i]))bad();
 if(!plain(t)||t.state!=='RETURNED'||t.nested!==true||index!==saved.events.length-1||
  canonical(without(t,['state','raw','returned_at','return_sha256']))!==canonical(without(before,['state']))||
  !plain(t.raw)||t.raw.isError||!iso(t.returned_at)||digest(JSON.stringify(t.raw))!==t.return_sha256)bad();
 const outer=saved.events[index],call=outer?.event,binding='mcp__codex_apps__github_update_file',write=call?.args;
 if(outer?.phase!=='account-admission'||call?.phase!=='invoking'||call.binding!==binding||
  t.binding!==binding||!hex(call.call_id)||!plain(write)||!iso(call.observed_at)||
  digest(JSON.stringify(write))!==t.args_sha256||
  digest({operationKey,index,binding,args:write})!==t.id||
  Date.parse(t.returned_at)<Date.parse(call.observed_at))bad();
 const accountKey=digest({provider:'gmail',profile_id:account.id,activity:'Mail sending'});
 const branch='mailbox-admission/v1/'+accountKey;
 if(write.repository_full_name!==REPOSITORY||write.branch!==branch||write.path!=='state/gmail-account.json'||
  write.message!=='Coordinate native Gmail account state [skip ci]'||!git(write.sha)||typeof write.content!=='string')bad();
 const returned=sourceContent(t.raw);
 if(!git(returned.commit_sha)||!git(returned.content_sha))bad();
 const priorReturn=saved.events.findLast(row=>row.phase==='account-admission'&&row.event?.phase==='returned'&&
  row.event.binding==='mcp__codex_apps__github_fetch_file'&&!row.event.raw?.isError&&sourceContent(row.event.raw).sha===write.sha);
 if(!priorReturn)bad();
 const priorCall=saved.events.find(row=>row.phase==='account-admission'&&row.event?.phase==='invoking'&&row.event.call_id===priorReturn.event.call_id)?.event;
 if(priorCall?.args?.repository_full_name!==REPOSITORY||priorCall.args.path!==write.path||!git(priorCall.args.ref))bad();
 let a,b;try{a=parse(sourceContent(priorReturn.event.raw).content);b=parse(write.content);}catch{bad();}
 if(a?.schema!=='commons.gmail-account-admission/v1'||b.schema!==a.schema||
  a.account_key!==accountKey||b.account_key!==accountKey||String(a.profile_id)!==String(account.id)||
  a.provider!=='gmail'||a.activity!=='Mail sending'||a.active!==null||b.active!==null||
  !Number.isSafeInteger(a.revision)||b.revision!==a.revision+1||
  canonical(without(a,['revision','updated_at','admission_queue']))!==canonical(without(b,['revision','updated_at','admission_queue']))||
  !iso(b.updated_at)||Date.parse(b.updated_at)>Date.parse(call.observed_at))bad();
 const aq=a.admission_queue,bq=b.admission_queue;
 if(aq?.schema!=='commons.gmail-account-turns/v1'||bq?.schema!==aq.schema||
  !Array.isArray(aq.waiting)||!Array.isArray(bq.waiting)||aq.turn!==null||bq.turn!==null||
  bq.last_change?.kind!=='QUEUED'||canonical(bq.last_change.operation_keys)!==canonical([operationKey])||
  bq.next_sequence!==aq.next_sequence+1||
  canonical(without(aq,['waiting','last_change','next_sequence']))!==canonical(without(bq,['waiting','last_change','next_sequence']))||
  aq.waiting.some(x=>x.operation_key===operationKey)||!iso(bq.last_change.at)||
  aq.waiting.some(x=>!iso(x.expires_at))||
  canonical(bq.waiting.slice(0,-1))!==canonical(aq.waiting.filter(x=>Date.parse(x.expires_at)>Date.parse(bq.last_change.at))))bad();
 const queued=bq.waiting.at(-1);
 if(queued.operation_key!==operationKey||queued.operation_lease!==lease||
  queued.send_binding!=='mcp__codex_apps__gmail_send_email'||queued.sequence!==aq.next_sequence||
  !iso(queued.queued_at)||queued.renewed_at!==queued.queued_at||
  !iso(queued.expires_at)||Date.parse(queued.expires_at)-Date.parse(queued.queued_at)!==1800000||
  bq.last_change.at!==queued.queued_at||Date.parse(queued.queued_at)>Date.parse(b.updated_at))bad();
 const tail=complete.events.slice(saved.events.length),[failedOuter,unfinished,readCall,readReturn,readFailed,releaseFailed,ended,operationEnded]=tail;
 const failure='CONTACT_CHECKPOINT_RETURN_SAVE_FAILED:'+t.id;
 const prepared=saved.events.findLast(x=>x.phase==='account-attempt-prepared'&&x.operation_key===operationKey);
 const expectedAccount={status:'ACCOUNT_ADMISSION_UNAVAILABLE',operation_key:operationKey,attempt_key:prepared?.attempt_key};
 if(!prepared||!hex(prepared.attempt_key)||failedOuter.phase!=='account-admission'||
  failedOuter.event?.phase!=='failed'||failedOuter.event.binding!==binding||
  failedOuter.event.call_id!==call.call_id||failedOuter.event.message!==failure||
  unfinished.phase!=='account-acquire-unfinished'||unfinished.operation_key!==operationKey||
  unfinished.attempt_key!==prepared.attempt_key||unfinished.message!==failure)bad();
 const readIndex=index+3,readBinding='mcp__codex_apps__github_fetch_file';
 const readArgs={repository_full_name:'woahwhattheheck/commons',path,ref:'main',encoding:'utf-8'};
 const readArgsSha=digest(canonical(readArgs));
 if(readCall.phase!=='invoking'||readCall.binding!==readBinding||canonical(readCall.args)!==canonical(readArgs)||
  readCall.invocation_event!==readIndex||readCall.args_sha256!==readArgsSha||
  readCall.call_id!==digest(canonical({operation_key:operationKey,binding:readBinding,invocation_event:readIndex,args_sha256:readArgsSha}))||
  readReturn.phase!=='returned'||readReturn.binding!==readBinding||readReturn.invocation_event!==readIndex||
  readReturn.call_id!==readCall.call_id||readReturn.args_sha256!==readArgsSha||readReturn.raw?.isError!==true||
  readFailed.phase!=='failed'||readFailed.binding!==readBinding||readFailed.call_id!==readCall.call_id||
  readFailed.invocation_event!==readIndex||readFailed.returned_event!==readIndex+1||readFailed.args_sha256!==readArgsSha||
  readFailed.status!==403||!/API rate limit exceeded/i.test(readFailed.message||'')||
  !JSON.stringify(readReturn.raw).includes('API rate limit exceeded')||
  releaseFailed.phase!=='rate-attempt-release-failed'||releaseFailed.message!==readFailed.message||
  !hex(releaseFailed.retry_id)||!hex(releaseFailed.claim_nonce))bad();
 const acquired=saved.events.findLast(x=>x.retry_id===releaseFailed.retry_id&&x.claim_nonce===releaseFailed.claim_nonce);
 if(!acquired)bad();
 const sends=events=>events.filter(x=>x.phase==='invoking'&&/^mcp__codex_apps__gmail_send_(?:email|draft)$/.test(x.binding||'')).length;
 const count=sends(saved.events);
 if(sends(complete.events)!==count||ended.phase!=='account-attempt-deferred-ended'||
  ended.operation_key!==operationKey||ended.attempt_key!==prepared.attempt_key||
  ended.input_sha256!==saved.input_sha256||ended.operation_lease!==lease||ended.gmail_invocations!==count||
  canonical(ended.account)!==canonical(expectedAccount)||operationEnded.phase!=='operation-account-deferred-ended'||
  operationEnded.operation_key!==operationKey||operationEnded.attempt_key!==prepared.attempt_key||
  operationEnded.input_sha256!==saved.input_sha256||operationEnded.operation_lease!==lease||
  operationEnded.event_end!==complete.events.length-1||!Number.isSafeInteger(operationEnded.event_start)||
  operationEnded.event_start<0||operationEnded.event_start>=index||!iso(operationEnded.started_at)||
  operationEnded.gmail_invocations_before!==count||operationEnded.gmail_invocations_after!==count||
  canonical(operationEnded.account)!==canonical(expectedAccount))bad();
 const outcome=complete.outcome,deferred=complete.account_deferred;
 if(outcome?.status!=='ACCOUNT_DEFERRED'||outcome.intent_branch!==intent.branch||
  outcome.recipient_claim_path!==path||outcome.recheck_at!==null||canonical(outcome.account)!==canonical(expectedAccount)||
  !plain(deferred)||deferred.gmail_invocations!==count||(!iso(deferred.observed_at)||Date.parse(deferred.observed_at)<Date.parse(unfinished.observed_at)||Date.parse(deferred.observed_at)>Date.parse(ended.observed_at))||
  canonical(deferred.outcome)!==canonical(outcome))bad();
 let time=Date.parse(t.returned_at);
 for(const row of tail){if(!iso(row.observed_at)||Date.parse(row.observed_at)<time||
  row.event&&(!iso(row.event.observed_at)||Date.parse(row.event.observed_at)>Date.parse(row.observed_at)))bad();time=Date.parse(row.observed_at);}
 const identity=hash(sha256Utf8,JSON.stringify(snapshot));
 return {schema:'commons.contact-checkpoint-returned-account-tail/v1',operation_key:operationKey,
  input_sha256:saved.input_sha256,operation_lease:lease,snapshot_sha256:identity.sha256,snapshot_bytes:identity.bytes,
  retained_prefix_events:saved.events.length,event_count:complete.events.length,transport_count:transports.length,
  account_write_event:index,transport_id:t.id,return_sha256:t.return_sha256,returned_at:t.returned_at,
  account_commit_sha:returned.commit_sha,account_blob_sha:returned.content_sha,
  account_postimage_sha256:digest(write.content),account_source_blob_sha:write.sha,
  queued_sequence:queued.sequence,provider_not_before:b.not_before,additional_gmail_invocations:0,
  original_tail:clone(tail),input_revision_source_sha256:snapshot.input_revision_source?digest(JSON.stringify(snapshot.input_revision_source)):null};
}

function checkpointGitReaders(tools,requestedAction) {
  const choices=['github_fetch','github_fetch_commit'];
  if(requestedAction!==undefined&&!choices.includes(requestedAction))
    fail('CONTACT_CHECKPOINT_REF_SELECTION_REQUIRED');
  const refAction=requestedAction===undefined
    ? choices.find(name=>typeof tools?.['mcp__codex_apps__'+name]==='function') : requestedAction;
  if(!refAction||typeof tools?.['mcp__codex_apps__'+refAction]!=='function')
    fail('CONTACT_CHECKPOINT_BINDING_REQUIRED','selected native GitHub ref reader');
  const repositoryAction=typeof tools?.mcp__codex_apps__github_get_repo==='function'
    ? 'github_get_repo' : 'github_fetch';
  const comparisonAction=typeof tools?.mcp__codex_apps__github_compare_commits==='function'
    ? 'github_compare_commits' : 'github_fetch';
  async function repository(call,write=false) {
    const repo=await call(repositoryAction,repositoryAction==='github_get_repo'
      ? {repository_full_name:REPOSITORY} : {url:'https://api.github.com/repos/'+REPOSITORY});
    const names=[repo.full_name,repo.repository_full_name].filter(value=>value!=null);
    if(!names.length||names.some(value=>value!==REPOSITORY)||
       !(repo.private===true||repo.visibility==='private')||repo.private===false||
       (repo.visibility!=null&&repo.visibility!=='private')||repo.archived===true||
       (write&&repo.permissions?.push===false))
      fail('CONTACT_CHECKPOINT_PRIVATE_REPOSITORY_REQUIRED');
    return repo;
  }
  async function head(call,name,repositoryName=REPOSITORY) {
    if(refAction==='github_fetch') {
      const value=await call(refAction,{url:'https://api.github.com/repos/'+repositoryName+'/git/ref/heads/'+name});
      if(value.ref!=='refs/heads/'+name||value.object?.type!=='commit'||!git(value.object.sha))
        fail('CONTACT_CHECKPOINT_REF_CHANGED');
      return value.object.sha;
    }
    const value=await call(refAction,{repo_full_name:repositoryName,commit_sha:'refs/heads/'+name});
    const commit=value?.commit,sha=commit?.sha;
    if(!git(sha)||commit.repository_full_name!==repositoryName||
       commit.url!=='https://api.github.com/repos/'+repositoryName+'/commits/'+sha||
       commit.html_url!=='https://github.com/'+repositoryName+'/commit/'+sha||
       value.url!==commit.html_url)
      fail('CONTACT_CHECKPOINT_REF_CHANGED');
    return sha;
  }
  function absentHead(error,name) {
    if(error.status===404)return true;
    const value=error.native?.structuredContent,data=value?.error_data;
    return refAction==='github_fetch_commit'&&error.status===422&&
      value?.error_code==='INVALID_ARGUMENT'&&value.commit===undefined&&
      data?.message==='No commit found for SHA: refs/heads/'+name&&
      data.documentation_url==='https://docs.github.com/rest/commits/commits#get-a-commit';
  }
  async function compare(call,base,head) {
    const value=await call(comparisonAction,comparisonAction==='github_compare_commits'
      ? {repo_full_name:REPOSITORY,base,head}
      : {url:'https://api.github.com/repos/'+REPOSITORY+'/compare/'+base+'...'+head+'?per_page=1&page=1'});
    if(value.base_commit?.sha!==base||comparisonAction==='github_compare_commits'&&
       (value.repository_full_name!==REPOSITORY||value.base!==base||value.head!==head))
      fail('CONTACT_CHECKPOINT_ACCOUNT_SOURCE_NOT_RETAINED');
    return value;
  }
  return {refAction,repositoryAction,comparisonAction,repository,head,absentHead,compare};
}
function reviewedInput(input, modules) {
  const accounts=modules?.mailboxes;
  if(!Array.isArray(accounts)||accounts.length!==2)fail('CONTACT_CHECKPOINT_PRIVATE_MAILBOX_CONFIGURATION_REQUIRED');
  const account=accounts.find(row=>row.link_id===input?.link_id);
  if (!account) fail('CONTACT_CHECKPOINT_ORIGINAL_ACCOUNT_REQUIRED');
  const {recipient,path}=modules.gateway.recipientClaimPath(input.to);
  const delivery=input.attachments?.length ? modules.attachments?.prepare(input) : null;
  if (input.attachments?.length && !delivery) fail('CONTACT_CHECKPOINT_ATTACHMENT_SOURCE_REQUIRED');
  const nativeArguments=modules.gateway.originalNativeFirstContactArguments
    ? modules.gateway.originalNativeFirstContactArguments(input,account,modules.attachments) : null;
  if(input.native_arguments !== undefined && !nativeArguments)
    fail('CONTACT_CHECKPOINT_NATIVE_ENVELOPE_SOURCE_REQUIRED');
  const reviewed={
    prospect_org:input.prospect_org,opportunity_id:input.opportunity_id,touchpoint:input.touchpoint,
    to:recipient,subject:input.subject,body:input.body,link_id:input.link_id,
    ...(nativeArguments ? {body_type:input.body_type,native_arguments:clone(nativeArguments)} : {}),
    ...(input.native_draft ? {native_draft:clone(input.native_draft)} : {}),
    ...(delivery ? {attachments:delivery.attachments} : {}),
    ...(input.document_archives != null ? {document_archives:clone(input.document_archives)} : {})
  };
  for (const field of ['prospect_org','opportunity_id','touchpoint','subject','body'])
    if (typeof reviewed[field]!=='string' || !reviewed[field].trim()) fail('CONTACT_CHECKPOINT_REVIEW_REQUIRED');
  if (/[\r\n]/.test(reviewed.subject)) fail('CONTACT_CHECKPOINT_REVIEW_REQUIRED');
  const body={mime_type:'text/html',charset:'UTF-8',
    body:{content:modules.gateway.renderFirstContactTextHtml(reviewed.body)}};
  const args=input.native_draft ? {link_id:account.link_id,draft_id:input.native_draft.draft_id} : nativeArguments || {link_id:account.link_id,from_address:account.email,to:recipient,subject:reviewed.subject,
    payload:delivery ? modules.attachments.payload(delivery,body) : body};
  return {reviewed,args,account,path,intent:modules.intent.fingerprint(reviewed),
    identity:hash(modules.sha256Utf8,JSON.stringify(reviewed)).sha256};
}

/**
 * Keep the append-only original journal ahead of mutable transport results.
 * All original keys and bytes survive JSON round-trip; existing payloads reopen
 * unchanged and use this layout only on their next ordinary pointer save.
 */
function serializeCheckpointPayload(value) {
  const {schema,runtime_input,journal,transports,...retained}=value;
  return JSON.stringify({schema,runtime_input,journal,transports,...retained});
}

/** Join only actual retained returns; preserve original indices and failed storage events. */
function receiveReturnedTransports({journal,transports,sha256Utf8}) {
  const digest=value=>hash(sha256Utf8,value).sha256;
  for(const t of transports) {
    if(!plain(t) || !Number.isSafeInteger(t.event_index) || t.event_index<0 ||
       typeof t.binding!=='string' || !hex(t.args_sha256) ||
       !['INVOKING','RETURNED','THREW','NOT_DISPATCHED'].includes(t.state))fail('CONTACT_CHECKPOINT_TRANSPORT_INVALID');
    const outer=journal.events[t.event_index], prior=t.nested?outer?.event:outer;
    if(!['invoking','checkpoint-not-dispatched'].includes(prior?.phase) || prior.binding!==t.binding ||
       digest(JSON.stringify(prior.args))!==t.args_sha256)fail('CONTACT_CHECKPOINT_INVOCATION_CHANGED');
    if(t.state==='NOT_DISPATCHED' && (prior.phase!=='checkpoint-not-dispatched' ||
        prior.checkpoint_transport_id!==t.id || prior.original_phase!=='invoking' ||
        !iso(t.not_dispatched_at))) fail('CONTACT_CHECKPOINT_UNDISPATCHED_CHANGED');
    if(t.state!=='NOT_DISPATCHED' && prior.phase!=='invoking')
      fail('CONTACT_CHECKPOINT_INVOCATION_CHANGED');
    if(t.state==='RETURNED') {
      if(!iso(t.returned_at) || !plain(t.raw) || digest(JSON.stringify(t.raw))!==t.return_sha256)
        fail('CONTACT_CHECKPOINT_RETURN_CHANGED');
      let laterIndex=-1;
      for(let i=t.event_index+1;i<journal.events.length;i++) {
        const candidate=t.nested ? journal.events[i]?.event : journal.events[i];
        if(candidate?.binding===t.binding && ['returned','failed','invoking'].includes(candidate.phase)) {
          laterIndex=i;break;
        }
      }
      const laterOuter=laterIndex<0?null:journal.events[laterIndex];
      const later=t.nested?laterOuter?.event:laterOuter;
      const event={phase:'returned',binding:t.binding,
        ...(prior.call_id!==undefined?{call_id:prior.call_id}:{}),
        ...(prior.invocation_event!==undefined?{invocation_event:prior.invocation_event}:{}),
        ...(prior.args_sha256!==undefined?{args_sha256:prior.args_sha256}:{}),
        raw:t.raw,observed_at:t.returned_at,recovered_from_checkpoint_transport:t.id};
      if(!later) journal.events.push(t.nested ? {...outer,event,observed_at:t.returned_at} : event);
      else if(later.phase==='failed' &&
          later.message==='CONTACT_CHECKPOINT_RETURN_SAVE_FAILED:'+t.id) {
        // Keep every existing index stable. The actual provider return replaces
        // only this adapter's own storage-failure slot; retain that failure too.
        journal.events[laterIndex]=t.nested ? {...laterOuter,event} : event;
        journal.events.push({phase:'checkpoint-storage-failure-received',
          observed_at:new Date().toISOString(),transport_id:t.id,
          original_event_index:laterIndex,original_event:clone(laterOuter)});
      } else if(later.phase!=='returned' || canonical(later.raw)!==canonical(t.raw))
        fail('CONTACT_CHECKPOINT_RETURN_RECONCILIATION_REQUIRED');
    }
  }
}

/**
 * Receive an original local dispatch cancellation from the complete checkpoint.
 * The durable transport and original journal event must name the same call.
 */
function validateUndispatchedNativeCall({journal,transports,operationKey,eventIndex,binding,sha256Utf8}) {
  if(!plain(journal)||!Array.isArray(journal.events)||!Array.isArray(transports)||
     !hex(journal.input_sha256)||typeof journal.lease!=='string'||!journal.lease||
     !hex(operationKey)||!Number.isSafeInteger(eventIndex)||eventIndex<0||
     typeof binding!=='string'||typeof sha256Utf8!=='function'||
     hash(sha256Utf8,{input_sha256:journal.input_sha256,lease:journal.lease}).sha256!==operationKey)
    fail('CONTACT_CHECKPOINT_UNDISPATCHED_CONTEXT_REQUIRED');
  const event=journal.events[eventIndex];
  const matches=transports.filter(t=>t?.event_index===eventIndex&&t.nested===false);
  if(matches.length!==1)fail('CONTACT_CHECKPOINT_UNDISPATCHED_TRANSPORT_REQUIRED');
  const t=matches[0];
  if(t.binding!==binding||t.state!=='NOT_DISPATCHED'||
     event?.phase!=='checkpoint-not-dispatched'||event.original_phase!=='invoking'||
     event.binding!==binding||!plain(event.args)||!hex(t.id)||!hex(t.args_sha256)||
     event.checkpoint_transport_id!==t.id||!iso(t.not_dispatched_at)||
     event.not_dispatched_at!==t.not_dispatched_at||
     t.raw!==undefined||t.return_sha256!==undefined||t.returned_at!==undefined||
     hash(sha256Utf8,JSON.stringify(event.args)).sha256!==t.args_sha256||
     hash(sha256Utf8,{operationKey,index:eventIndex,binding,args:event.args}).sha256!==t.id)
    fail('CONTACT_CHECKPOINT_UNDISPATCHED_CHANGED');
  // Older journals predate native call IDs. Receive their original event
  // unchanged; when call IDs exist, retain their complete current binding.
  if(event.call_id!==undefined||event.invocation_event!==undefined||event.args_sha256!==undefined) {
    const argsSha=hash(sha256Utf8,canonical(event.args)).sha256;
    if(event.invocation_event!==eventIndex||event.args_sha256!==argsSha||
       event.call_id!==hash(sha256Utf8,canonical({operation_key:operationKey,binding,
         invocation_event:eventIndex,args_sha256:argsSha})).sha256)
      fail('CONTACT_CHECKPOINT_UNDISPATCHED_CALL_CHANGED');
  }
  return {schema:'commons.contact-checkpoint-undispatched-call/v1',status:'NOT_DISPATCHED',
    operation_key:operationKey,input_sha256:journal.input_sha256,operation_lease:journal.lease,
    transport_id:t.id,event_index:eventIndex,binding,args_sha256:t.args_sha256,
    not_dispatched_at:t.not_dispatched_at};
}

/**
 * Select one original positive native Gmail return, without any provider call.
 * The message is not SENT_VERIFIED until the original full-MIME reconciler runs.
 */
function validateRetainedSentReturn({journal,transports,args,operationKey,sha256Utf8}) {
  if(!plain(journal)||!Array.isArray(journal.events)||!Array.isArray(transports)||
     !plain(args)||!hex(operationKey)||typeof sha256Utf8!=='function')
    fail('CONTACT_CHECKPOINT_RETURN_CONTEXT_REQUIRED');
  const binding=args.draft_id ? 'mcp__codex_apps__gmail_send_draft' : 'mcp__codex_apps__gmail_send_email';
  const candidates=transports.filter(t=>t?.binding===binding&&t.state==='RETURNED'&&
    !t.raw?.isError&&typeof t.raw?.structuredContent?.id==='string');
  if(!candidates.length)return null;
  if(candidates.length!==1)fail('CONTACT_CHECKPOINT_MULTIPLE_SENT_RETURNS',
    'Reconcile the original returned Gmail identities; no sending continuation was invoked.');
  const t=candidates[0],call=journal.events[t.event_index],id=t.raw.structuredContent.id;
  if(!Number.isSafeInteger(t.event_index)||t.event_index<0||t.nested!==false||
     call?.phase!=='invoking'||call.binding!==binding||canonical(call.args)!==canonical(args)||
     !/^[a-zA-Z0-9_-]{1,128}$/.test(id)||!iso(t.returned_at)||!plain(t.raw)||
     t.raw.structuredContent.error||t.raw.structuredContent.error_code||
     hash(sha256Utf8,JSON.stringify(call.args)).sha256!==t.args_sha256||
     hash(sha256Utf8,JSON.stringify(t.raw)).sha256!==t.return_sha256||
     hash(sha256Utf8,{operationKey,index:t.event_index,binding,args:call.args}).sha256!==t.id)
    fail('CONTACT_CHECKPOINT_SENT_RETURN_CHANGED');
  if(journal.receipt?.message_id&&journal.receipt.message_id!==id||
     journal.outcome?.status==='SENT_VERIFIED'&&journal.outcome.message_id!==id)
    fail('CONTACT_CHECKPOINT_SENT_IDENTITY_CHANGED');
  return {transport_id:t.id,event_index:t.event_index,provider_message_id:id,
    args_sha256:t.args_sha256,return_sha256:t.return_sha256,returned_at:t.returned_at};
}

/** Receive the original successful caller tail after only its final save failed. */
function validateReceivedCompletion({savedJournal,completedJournal,transports,
  reviewed,args,lease,intent,path,sha256Utf8}) {
  const bad=()=>fail('CONTACT_CHECKPOINT_COMPLETION_INVALID');
  const saved=savedJournal,complete=completedJournal,receipt=saved?.receipt;
  if(!plain(saved)||!plain(complete)||!Array.isArray(saved.events)||
     !Array.isArray(complete.events)||complete.events.length<saved.events.length||
     !Array.isArray(transports)||!plain(receipt)||!receipt.message_id||
     saved.input_sha256!==hash(sha256Utf8,JSON.stringify(reviewed)).sha256||
     saved.lease!==lease||canonical(saved.input)!==canonical(reviewed)||
     canonical(receipt)!==canonical(complete.receipt))bad();
  const withoutOutcome=value=>Object.fromEntries(Object.entries(value)
    .filter(([key])=>key!=='events'&&key!=='outcome'));
  if(canonical(withoutOutcome(saved))!==canonical(withoutOutcome(complete)))bad();
  for(let i=0;i<saved.events.length;i++)
    if(canonical(saved.events[i])!==canonical(complete.events[i]))bad();
  const outcome=complete.outcome;
  if(outcome?.status!=='SENT_VERIFIED'||outcome.completion!=='RECORDED'||
     outcome.message_id!==receipt.message_id||outcome.intent_branch!==intent.branch||
     outcome.recipient_claim_path!==path)bad();
  const sent=transports.find(t=>!t.nested&&t.binding===(args.draft_id ? 'mcp__codex_apps__gmail_send_draft' : 'mcp__codex_apps__gmail_send_email')&&
    t.state==='RETURNED'&&!t.raw?.isError&&
    t.raw?.structuredContent?.id===receipt.message_id);
  const invocation=sent&&saved.events[sent.event_index];
  if(!sent||invocation?.phase!=='invoking'||invocation.binding!==sent.binding||
     canonical(invocation.args)!==canonical(args)||
     hash(sha256Utf8,JSON.stringify(invocation.args)).sha256!==sent.args_sha256||
     hash(sha256Utf8,JSON.stringify(sent.raw)).sha256!==sent.return_sha256)bad();

  const reads=new Set(['github_fetch','github_fetch_file','github_fetch_blob',
    'github_fetch_commit','github_compare_commits','github_get_profile','github_get_user_login','github_get_repo',
    'gmail_get_profile','gmail_search_email_ids','gmail_read_email']
    .map(name=>'mcp__codex_apps__'+name));
  for(let i=saved.events.length;i<complete.events.length;i++) {
    const event=complete.events[i];
    if(!plain(event)||!iso(event.observed_at))bad();
    if(event.phase==='returned') {
      // The last mutation returned and was durably saved before the factory
      // appended this exact ordinary returned record.
      const t=transports.find(t=>!t.nested&&t.event_index===i-1&&
        t.binding===event.binding&&t.state==='RETURNED');
      if(!t||i-1>=saved.events.length||canonical(event.raw)!==canonical(t.raw))bad();
    } else if(event.phase==='invoking'&&reads.has(event.binding)) {
      const returned=complete.events[++i];
      if(!plain(event.args)||returned?.phase!=='returned'||
         returned.binding!==event.binding||!iso(returned.observed_at)||
         !plain(returned.raw)||returned.raw.isError)bad();
    } else bad();
  }
  let recipientRead=-1;
  for(let i=0;i+1<complete.events.length;i++) {
    const call=complete.events[i],returned=complete.events[i+1];
    if(call.phase!=='invoking'||call.binding!=='mcp__codex_apps__github_fetch_file'||
       call.args?.repository_full_name!=='woahwhattheheck/commons'||call.args.path!==path||
       returned.phase!=='returned'||returned.binding!==call.binding||returned.raw?.isError)continue;
    let record;try{record=parse(sourceContent(returned.raw).content);}catch{continue;}
    if(record.status==='sent'&&record.case===reviewed.opportunity_id&&
       record.lease===lease&&record.provider_message_id===receipt.message_id)recipientRead=i;
  }
  if(recipientRead<sent.event_index)bad();
  const measured=hash(sha256Utf8,JSON.stringify(complete));
  return {schema:'commons.contact-checkpoint-received-completion/v1',
    journal_sha256:measured.sha256,journal_bytes:measured.bytes,
    event_count:complete.events.length,retained_prefix_events:saved.events.length,
    message_id:receipt.message_id,recipient_read_event:recipientRead};
}


/**
 * Receive a complete local account-acquisition tail which this checkpoint
 * proved was never dispatched. Any actual or uncertain native mutation remains
 * on its existing returned/uncertain recovery path.
 */
function validateReceivedWaitingRenewalTail({savedJournal,savedTransports,snapshot,savedSource={},
  reviewed,account,lease,intent,path,operationKey,sha256Utf8}) {
  const bad=()=>fail('CONTACT_CHECKPOINT_WAITING_RENEWAL_TAIL_INVALID');
  const saved=savedJournal,complete=snapshot?.journal,transports=snapshot?.transports;
  if(!plain(snapshot)||!snapshotSourceFieldsMatch(snapshot,savedSource)||snapshot.pending_pointer!==null||
     !plain(saved)||!plain(complete)||!Array.isArray(saved.events)||!Array.isArray(complete.events)||
     complete.events.length<=saved.events.length||!Array.isArray(savedTransports)||
     !Array.isArray(transports)||transports.length!==savedTransports.length+1||
     !plain(account)||!hex(operationKey)||typeof sha256Utf8!=='function'||
     saved.schema!=='commons.connected-first-contact/v1'||
     saved.input_sha256!==hash(sha256Utf8,JSON.stringify(reviewed)).sha256||
     saved.lease!==lease||canonical(saved.input)!==canonical(reviewed)||
     hash(sha256Utf8,{input_sha256:saved.input_sha256,lease}).sha256!==operationKey)bad();
  const without=(value,keys)=>Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)));
  if(canonical(without(saved,['events','outcome','account_deferred']))!==
     canonical(without(complete,['events','outcome','account_deferred'])))bad();
  for(let i=0;i<saved.events.length;i++)if(canonical(saved.events[i])!==canonical(complete.events[i]))bad();
  for(let i=0;i<savedTransports.length;i++)
    if(savedTransports[i].state!=='RETURNED'||canonical(savedTransports[i])!==canonical(transports[i]))bad();
  const t=transports.at(-1),index=t?.event_index,outer=complete.events[index],call=outer?.event;
  const binding='mcp__codex_apps__github_update_file';
  if(!plain(t)||!Number.isSafeInteger(index)||index<saved.events.length||
     index!==complete.events.length-5||t.nested!==true||t.binding!==binding||
     t.state!=='NOT_DISPATCHED'||outer?.phase!=='account-admission'||
     call?.phase!=='checkpoint-not-dispatched'||call.original_phase!=='invoking'||
     call.binding!==binding||!plain(call.args)||!hex(call.call_id)||
     call.invocation_event!==undefined||call.args_sha256!==undefined||
     !hex(t.id)||!hex(t.args_sha256)||call.checkpoint_transport_id!==t.id||
     !iso(t.not_dispatched_at)||call.not_dispatched_at!==t.not_dispatched_at||
     !plain(t.error)||typeof t.error.message!=='string'||t.raw!==undefined||
     t.return_sha256!==undefined||t.returned_at!==undefined||
     hash(sha256Utf8,JSON.stringify(call.args)).sha256!==t.args_sha256||
     hash(sha256Utf8,{operationKey,index,binding,args:call.args}).sha256!==t.id)bad();
  // Account-native call IDs are opaque paired IDs made by the original admission
  // module. They do not use the outer sender's invocation_event hash formula.
  const accountKey=hash(sha256Utf8,{provider:'gmail',profile_id:account.id,activity:'Mail sending'}).sha256;
  const branch='mailbox-admission/v1/'+accountKey,accountPath='state/gmail-account.json',write=call.args;
  if(write.repository_full_name!==REPOSITORY||write.branch!==branch||write.path!==accountPath||
     !git(write.sha)||typeof write.content!=='string'||
     write.message!=='Coordinate native Gmail account state [skip ci]')bad();
  const pending=new Map(),seen=new Set(),reads=[],heads=new Set();
  const originalNested=saved.events.filter(e=>e.phase==='account-admission').map(e=>e.event);
  const priorActor=saved.events.findLast(e=>e.phase==='returned'&&
    ['mcp__codex_apps__github_get_profile','mcp__codex_apps__github_get_user_login'].includes(e.binding)&&
    !e.raw?.isError)?.raw?.structuredContent;
  const scope={operation_key:operationKey,input_sha256:saved.input_sha256,operation_lease:lease};
  const readValue=e=>{const v=sourceContent(e.raw);return e.binding==='mcp__codex_apps__github_fetch'?parse(v.content):v;};
  function originalReceipt(receipt,kind) {
    if(!plain(receipt)||!Number.isSafeInteger(receipt.invocation_index)||
       !Number.isSafeInteger(receipt.return_index)||receipt.invocation_index<0||
       receipt.return_index<=receipt.invocation_index)bad();
    const a=originalNested[receipt.invocation_index],b=originalNested[receipt.return_index];
    if(a?.phase!=='invoking'||b?.phase!=='returned'||a.binding!==receipt.binding||
       b.binding!==a.binding||!hex(a.call_id)||b.call_id!==a.call_id||receipt.call_id!==a.call_id||
       receipt.invoked_at!==a.observed_at||receipt.verified_at!==b.observed_at||
       receipt.args_sha256!==hash(sha256Utf8,a.args).sha256||
       receipt.return_sha256!==hash(sha256Utf8,b.raw).sha256||b.raw?.isError)bad();
    const v=readValue(b);
    if(kind==='repository'){
      if(!((a.binding==='mcp__codex_apps__github_get_repo'&&
            canonical(a.args)===canonical({repository_full_name:REPOSITORY}))||
           (a.binding==='mcp__codex_apps__github_fetch'&&
            canonical(a.args)===canonical({url:'https://api.github.com/repos/'+REPOSITORY})))||
         ![v.full_name,v.repository_full_name].includes(REPOSITORY)||
         !(v.private===true||v.visibility==='private')||v.archived===true||v.permissions?.push!==true)bad();
    }else if(a.binding!=='mcp__codex_apps__gmail_get_profile'||
        canonical(a.args)!==canonical({link_id:account.link_id})||
        String(v.id)!==String(account.id)||String(v.email).toLowerCase()!==account.email.toLowerCase())bad();
    return v;
  }
  let prepared=null,restored=false,lastTime=saved.events.length?Date.parse(saved.events.at(-1).observed_at):0;
  for(let i=saved.events.length;i<index;i++){
    const row=complete.events[i],nested=row?.phase==='account-admission',e=nested?row.event:row;
    if(!plain(row)||!plain(e)||!iso(row.observed_at)||!iso(e.observed_at)||
       Date.parse(row.observed_at)<lastTime||Date.parse(e.observed_at)>Date.parse(row.observed_at))bad();
    lastTime=Date.parse(row.observed_at);
    const key=(nested?'account:':'contact:')+e.call_id;
    if(e.phase==='invoking'){
      if(!plain(e.args)||!hex(e.call_id)||seen.has(key)||pending.has(key))bad();
      if(!nested){
        if(!['mcp__codex_apps__github_get_profile','mcp__codex_apps__github_get_user_login'].includes(e.binding)||
           canonical(e.args)!=='{}'||e.invocation_event!==i||
           e.args_sha256!==hash(sha256Utf8,canonical(e.args)).sha256||
           e.call_id!==hash(sha256Utf8,canonical({operation_key:operationKey,binding:e.binding,
             invocation_event:i,args_sha256:e.args_sha256})).sha256)bad();
      }else if(e.binding==='mcp__codex_apps__gmail_get_profile'){
        if(canonical(e.args)!==canonical({link_id:account.link_id}))bad();
      }else if(e.binding==='mcp__codex_apps__github_get_repo'){
        if(canonical(e.args)!==canonical({repository_full_name:REPOSITORY}))bad();
      }else if(e.binding==='mcp__codex_apps__github_fetch'){
        if(canonical(e.args)!==canonical({url:'https://api.github.com/repos/'+REPOSITORY+'/git/ref/heads/'+branch}))bad();
      }else if(e.binding==='mcp__codex_apps__github_fetch_commit'){
        if(canonical(e.args)!==canonical({repo_full_name:REPOSITORY,commit_sha:'refs/heads/'+branch}))bad();
      }else if(e.binding==='mcp__codex_apps__github_fetch_file'){
        if(e.args.repository_full_name!==REPOSITORY||e.args.path!==accountPath||
           !heads.has(e.args.ref)||(e.args.encoding!==undefined&&e.args.encoding!=='utf-8')||
           Object.keys(e.args).some(k=>!['repository_full_name','path','ref','encoding'].includes(k)))bad();
      }else if(e.binding==='mcp__codex_apps__github_compare_commits'){
        const known=saved.outcome?.account?.commit_sha;
        if(e.args.repo_full_name!==REPOSITORY||e.args.base!==known||!git(known)||
           !heads.has(e.args.head)||Object.keys(e.args).length!==3)bad();
      }else bad();
      pending.set(key,{event:e,index:i,nested});seen.add(key);
    }else if(e.phase==='returned'){
      const p=pending.get(key);
      if(!p||p.event.binding!==e.binding||!plain(e.raw)||e.raw.isError||
         Date.parse(e.observed_at)<Date.parse(p.event.observed_at))bad();
      if(!nested&&(e.invocation_event!==p.index||e.args_sha256!==p.event.args_sha256))bad();
      const v=readValue(e);
      if(!nested){if(priorActor?.id==null||String(v.id)!==String(priorActor.id))bad();}
      else if(e.binding==='mcp__codex_apps__gmail_get_profile'){
        if(String(v.id)!==String(account.id)||String(v.email).toLowerCase()!==account.email.toLowerCase())bad();
      }else if(e.binding==='mcp__codex_apps__github_get_repo'){
        if(![v.full_name,v.repository_full_name].includes(REPOSITORY)||
           !(v.private===true||v.visibility==='private')||v.archived===true||v.permissions?.push!==true)bad();
      }else if(e.binding==='mcp__codex_apps__github_fetch'){
        if(v.ref!=='refs/heads/'+branch||v.object?.type!=='commit'||!git(v.object.sha))bad();heads.add(v.object.sha);
      }else if(e.binding==='mcp__codex_apps__github_fetch_commit'){
        if(!git(v.commit?.sha)||v.commit.repository_full_name!==REPOSITORY)bad();heads.add(v.commit.sha);
      }else if(e.binding==='mcp__codex_apps__github_compare_commits'){
        if(v.repository_full_name!==REPOSITORY||v.base!==p.event.args.base||v.head!==p.event.args.head||
           v.base_commit?.sha!==p.event.args.base||v.merge_base_commit?.sha!==p.event.args.base||
           !['ahead','identical'].includes(v.status))bad();
      }
      reads.push({...p,returned:e,returned_index:i,value:v});pending.delete(key);
    }else if(nested&&e.phase==='original-repository-verification-restored'){
      if(restored||e.repository!==REPOSITORY||e.account_key!==accountKey||
         String(e.profile_id)!==String(account.id)||canonical(e.scope)!==canonical(scope))bad();
      const repo=originalReceipt(e.repository_receipt,'repository');originalReceipt(e.profile_receipt,'profile');
      if(String(e.repository_id)!==String(repo.id)||e.original_verified_at!==e.repository_receipt.verified_at)bad();
      restored=true;
    }else if(nested&&e.phase==='immutable-account-read-reused'){
      const prior=reads.findLast(r=>r.nested&&r.event.binding==='mcp__codex_apps__github_fetch_file'&&
        r.event.args.ref===e.commit_sha);
      if(!prior||e.repository!==REPOSITORY||e.path!==accountPath||e.account_key!==accountKey||
         !heads.has(e.commit_sha)||e.content_sha!==prior.value.sha||
         e.content_sha256!==hash(sha256Utf8,prior.value.content).sha256)bad();
    }else if(!nested&&row.phase==='account-attempt-prepared'){
      if(prepared||row.operation_key!==operationKey||!hex(row.attempt_key)||
         row.scope!=='RETAINED_RECIPIENT_WAIT'||pending.size)bad();prepared={event:row,index:i};
    }else bad();
  }
  if(pending.size||!prepared||!iso(call.observed_at)||!iso(outer.observed_at)||
     Date.parse(call.observed_at)<lastTime||Date.parse(outer.observed_at)<Date.parse(call.observed_at)||
     Date.parse(t.not_dispatched_at)<Date.parse(outer.observed_at))bad();
  const failedOuter=complete.events[index+1],failed=failedOuter?.event,
    unfinished=complete.events[index+2],ended=complete.events[index+3],operationEnded=complete.events[index+4];
  if(failedOuter?.phase!=='account-admission'||failed?.phase!=='failed'||failed.binding!==binding||
     failed.call_id!==call.call_id||failed.message!==t.error.message||
     unfinished?.phase!=='account-acquire-unfinished'||unfinished.operation_key!==operationKey||
     unfinished.attempt_key!==prepared.event.attempt_key||unfinished.message!==t.error.message||
     ended?.phase!=='account-attempt-deferred-ended'||ended.operation_key!==operationKey||
     ended.attempt_key!==prepared.event.attempt_key||ended.input_sha256!==saved.input_sha256||
     ended.operation_lease!==lease)bad();
  const expectedAccount={status:'ACCOUNT_ADMISSION_UNAVAILABLE',operation_key:operationKey,
    attempt_key:prepared.event.attempt_key};
  const sends=new Set(['mcp__codex_apps__gmail_send_email','mcp__codex_apps__gmail_send_draft']);
  const gmailBefore=saved.events.filter(e=>e.phase==='invoking'&&sends.has(e.binding)).length;
  const oldOutcome=saved.outcome,outcome=complete.outcome,oldDeferred=saved.account_deferred,deferred=complete.account_deferred;
  if(oldOutcome?.status!=='ACCOUNT_DEFERRED'||outcome?.status!=='ACCOUNT_DEFERRED'||
     canonical(without(oldOutcome,['account','recheck_at']))!==canonical(without(outcome,['account','recheck_at']))||
     outcome.intent_branch!==intent.branch||outcome.recipient_claim_path!==path||outcome.recheck_at!==null||
     canonical(outcome.account)!==canonical(expectedAccount)||canonical(ended.account)!==canonical(expectedAccount)||
     ended.gmail_invocations!==gmailBefore||!plain(oldDeferred)||!plain(deferred)||
     oldDeferred.gmail_invocations!==gmailBefore||
     canonical(without(oldDeferred,['observed_at','outcome']))!==canonical(without(deferred,['observed_at','outcome']))||
     deferred.observed_at!==ended.observed_at||canonical(deferred.outcome)!==canonical(outcome)||
     operationEnded?.phase!=='operation-account-deferred-ended'||operationEnded.operation_key!==operationKey||
     operationEnded.input_sha256!==saved.input_sha256||operationEnded.operation_lease!==lease||
     operationEnded.attempt_key!==prepared.event.attempt_key||!iso(operationEnded.started_at)||
     !Number.isSafeInteger(operationEnded.event_start)||operationEnded.event_start<saved.events.length||
     operationEnded.event_start>prepared.index||operationEnded.event_end!==index+4||
     operationEnded.gmail_invocations_before!==gmailBefore||operationEnded.gmail_invocations_after!==gmailBefore||
     canonical(operationEnded.account)!==canonical(expectedAccount))bad();
  lastTime=Date.parse(t.not_dispatched_at);
  for(const row of complete.events.slice(index+1)){
    if(!iso(row.observed_at)||Date.parse(row.observed_at)<lastTime||
       row.event&&(!iso(row.event.observed_at)||Date.parse(row.event.observed_at)>Date.parse(row.observed_at)))bad();
    lastTime=Date.parse(row.observed_at);
  }
  const prior=reads.findLast(r=>r.nested&&r.event.binding==='mcp__codex_apps__github_fetch_file'&&r.value.sha===write.sha);
  let before,after;try{before=parse(prior?.value.content);after=parse(write.content);}catch{bad();}
  if(before?.schema!=='commons.gmail-account-admission/v1'||after.schema!==before.schema||
     before.provider!=='gmail'||String(before.profile_id)!==String(account.id)||before.activity!=='Mail sending'||
     before.account_key!==accountKey||!Number.isSafeInteger(before.revision)||after.revision!==before.revision+1||
     canonical(without(before,['revision','updated_at','admission_queue']))!==
       canonical(without(after,['revision','updated_at','admission_queue']))||
     !iso(after.updated_at)||Date.parse(after.updated_at)>Date.parse(call.observed_at)||
     before.active?.operation_key===operationKey)bad();
  const a=before.admission_queue,b=after.admission_queue;
  if(a?.schema!=='commons.gmail-account-turns/v1'||b?.schema!==a.schema||
     !Array.isArray(a.waiting)||!Array.isArray(b.waiting)||a.waiting.length!==b.waiting.length||
     canonical(without(a,['waiting','last_change']))!==canonical(without(b,['waiting','last_change'])))bad();
  const positions=a.waiting.flatMap((v,i)=>v.operation_key===operationKey?[i]:[]);
  if(positions.length!==1)bad();
  const position=positions[0],old=a.waiting[position],renewed=b.waiting[position];
  for(let i=0;i<a.waiting.length;i++)if(i!==position&&canonical(a.waiting[i])!==canonical(b.waiting[i]))bad();
  if(old.operation_lease!==lease||canonical(without(old,['renewed_at','expires_at']))!==
       canonical(without(renewed,['renewed_at','expires_at']))||
     !iso(old.expires_at)||!iso(old.renewed_at)||!iso(renewed.renewed_at)||!iso(renewed.expires_at)||
     Date.parse(renewed.renewed_at)<Date.parse(prepared.event.observed_at)||
     Date.parse(renewed.renewed_at)<Date.parse(old.renewed_at)||
     Date.parse(renewed.renewed_at)>Date.parse(after.updated_at)||
     Date.parse(old.expires_at)<=Date.parse(renewed.renewed_at)||
     Date.parse(old.expires_at)-Date.parse(renewed.renewed_at)>900000||
     Date.parse(renewed.expires_at)-Date.parse(renewed.renewed_at)!==1800000||
     canonical(b.last_change)!==canonical({kind:'RENEWED',operation_keys:[operationKey],at:renewed.renewed_at}))bad();
  const measured=hash(sha256Utf8,JSON.stringify(snapshot));
  return {schema:'commons.contact-checkpoint-received-undispatched-tail/v1',
    operation_key:operationKey,input_sha256:saved.input_sha256,operation_lease:lease,
    snapshot_sha256:measured.sha256,snapshot_bytes:measured.bytes,
    journal_sha256:hash(sha256Utf8,JSON.stringify(complete)).sha256,
    journal_bytes:hash(sha256Utf8,JSON.stringify(complete)).bytes,
    retained_prefix_events:saved.events.length,event_count:complete.events.length,
    retained_prefix_transports:savedTransports.length,transport_count:transports.length,
    attempt_key:prepared.event.attempt_key,transport_id:t.id,event_index:index,
    binding,args_sha256:t.args_sha256,not_dispatched_at:t.not_dispatched_at,additional_gmail_invocations:0,
    account_source_blob_sha:prior.value.sha,account_source_revision:before.revision,
    proposed_change:'ORIGINAL_WAITING_RENEWAL_NOT_DISPATCHED',
    waiting_sequence:old.sequence,waiting_expires_at:old.expires_at,
    proposed_waiting_expires_at:renewed.expires_at};
}

function validateReceivedUndispatchedTail({savedJournal,savedTransports,snapshot,savedSource={},
  reviewed,account,lease,intent,path,operationKey,sha256Utf8}) {
  if(snapshot?.journal?.events?.at(-1)?.phase==='operation-account-deferred-ended')
    return validateReceivedWaitingRenewalTail({savedJournal,savedTransports,snapshot,savedSource,
      reviewed,account,lease,intent,path,operationKey,sha256Utf8});
  const bad=()=>fail('CONTACT_CHECKPOINT_UNDISPATCHED_TAIL_INVALID');
  const saved=savedJournal,complete=snapshot?.journal,transports=snapshot?.transports;
  if(!plain(saved)||!plain(complete)||!plain(snapshot)||snapshot.pending_pointer!==null||
     !snapshotSourceFieldsMatch(snapshot,savedSource)||
     !Array.isArray(saved.events)||!Array.isArray(complete.events)||
     complete.events.length<=saved.events.length||!Array.isArray(savedTransports)||
     !Array.isArray(transports)||transports.length!==savedTransports.length+1||
     !plain(account)||!hex(operationKey)||typeof sha256Utf8!=='function'||
     saved.schema!=='commons.connected-first-contact/v1'||
     saved.input_sha256!==hash(sha256Utf8,JSON.stringify(reviewed)).sha256||
     saved.lease!==lease||canonical(saved.input)!==canonical(reviewed)||
     hash(sha256Utf8,{input_sha256:saved.input_sha256,lease}).sha256!==operationKey)bad();
  const stableJournal=value=>Object.fromEntries(Object.entries(value)
    .filter(([key])=>!['events','outcome','account_deferred'].includes(key)));
  if(canonical(stableJournal(saved))!==canonical(stableJournal(complete)))bad();
  for(let i=0;i<saved.events.length;i++)
    if(canonical(saved.events[i])!==canonical(complete.events[i]))bad();
  for(let i=0;i<savedTransports.length;i++)
    if(canonical(savedTransports[i])!==canonical(transports[i]))bad();

  const t=transports[savedTransports.length],eventIndex=t?.event_index;
  const outer=complete.events[eventIndex],call=outer?.event;
  const binding='mcp__codex_apps__github_update_file';
  if(!plain(t)||!Number.isSafeInteger(eventIndex)||eventIndex<saved.events.length||
     eventIndex>=complete.events.length||t.nested!==true||t.binding!==binding||
     t.state!=='NOT_DISPATCHED'||outer?.phase!=='account-admission'||
     call?.phase!=='checkpoint-not-dispatched'||call.original_phase!=='invoking'||
     call.binding!==binding||!plain(call.args)||!hex(t.id)||!hex(t.args_sha256)||
     call.checkpoint_transport_id!==t.id||!iso(t.not_dispatched_at)||
     call.not_dispatched_at!==t.not_dispatched_at||!plain(t.error)||
     typeof t.error.message!=='string'||t.raw!==undefined||
     t.return_sha256!==undefined||t.returned_at!==undefined||
     hash(sha256Utf8,JSON.stringify(call.args)).sha256!==t.args_sha256||
     hash(sha256Utf8,{operationKey,index:eventIndex,binding,args:call.args}).sha256!==t.id)bad();
  if(call.call_id!==undefined||call.invocation_event!==undefined||call.args_sha256!==undefined) {
    const argsSha=hash(sha256Utf8,canonical(call.args)).sha256;
    if(call.invocation_event!==eventIndex||call.args_sha256!==argsSha||
       call.call_id!==hash(sha256Utf8,canonical({operation_key:operationKey,binding,
         invocation_event:eventIndex,args_sha256:argsSha})).sha256)bad();
  }
  const accountKey=hash(sha256Utf8,{provider:'gmail',profile_id:account.id,activity:'Mail sending'}).sha256;
  const accountBranch='mailbox-admission/v1/'+accountKey,accountPath='state/gmail-account.json';
  const write=call.args;
  if(write.repository_full_name!==REPOSITORY||write.branch!==accountBranch||
     write.path!==accountPath||!git(write.sha)||typeof write.content!=='string')bad();
  const pending=new Map(),reads=[];
  let prepared=null,unfinished=null,ended=null,failed=null;
  for(let i=saved.events.length;i<complete.events.length;i++) {
    const row=complete.events[i];
    if(!plain(row)||!iso(row.observed_at))bad();
    if(row.phase==='account-admission') {
      const e=row.event;
      if(!plain(e)||!iso(e.observed_at)||row.observed_at!==e.observed_at)bad();
      if(e.phase==='invoking') {
        if(!plain(e.args)||pending.has(e.binding))bad();
        if(e.binding==='mcp__codex_apps__github_get_repo') {
          if(e.args.repository_full_name!==REPOSITORY)bad();
        } else if(e.binding==='mcp__codex_apps__gmail_get_profile') {
          if(e.args.link_id!==account.link_id)bad();
        } else if(e.binding==='mcp__codex_apps__github_fetch_file') {
          if(e.args.repository_full_name!==REPOSITORY||e.args.path!==accountPath||
             e.args.ref!==accountBranch||e.args.encoding!=='utf-8')bad();
        } else bad();
        pending.set(e.binding,{event:e,index:i});
      } else if(e.phase==='returned') {
        const prior=pending.get(e.binding);
        if(!prior||!plain(e.raw)||e.raw.isError||
           Date.parse(e.observed_at)<Date.parse(prior.event.observed_at))bad();
        reads.push({...prior,returned:e,returned_index:i});pending.delete(e.binding);
      } else if(e.phase==='checkpoint-not-dispatched') {
        if(i!==eventIndex||canonical(e)!==canonical(call)||pending.size||
           !prepared||Date.parse(t.not_dispatched_at)<Date.parse(e.observed_at))bad();
      } else if(e.phase==='failed') {
        if(i<=eventIndex||failed||e.binding!==binding||e.message!==t.error.message||
           Date.parse(e.observed_at)<Date.parse(t.not_dispatched_at))bad();
        failed={event:e,index:i};
      } else bad();
    } else if(row.phase==='account-attempt-prepared') {
      if(prepared||i>=eventIndex||row.operation_key!==operationKey||
         !hex(row.attempt_key)||typeof row.scope!=='string'||!row.scope)bad();
      prepared={event:row,index:i};
    } else if(row.phase==='account-acquire-unfinished') {
      if(unfinished||!failed||i<=failed.index||row.operation_key!==operationKey||
         row.attempt_key!==prepared?.event.attempt_key||row.message!==t.error.message)bad();
      unfinished={event:row,index:i};
    } else if(row.phase==='account-attempt-deferred-ended') {
      if(ended||!unfinished||i!==complete.events.length-1||i<=unfinished.index||
         row.operation_key!==operationKey||row.attempt_key!==prepared?.event.attempt_key||
         row.input_sha256!==saved.input_sha256||row.operation_lease!==lease)bad();
      ended=row;
    } else bad();
  }
  if(pending.size||!prepared||!failed||!unfinished||!ended)bad();
  const expectedAccount={status:'ACCOUNT_ADMISSION_UNAVAILABLE',operation_key:operationKey,
    attempt_key:prepared.event.attempt_key};
  const oldOutcome=saved.outcome,outcome=complete.outcome,oldDeferred=saved.account_deferred,
    deferred=complete.account_deferred;
  const without=(value,keys)=>Object.fromEntries(Object.entries(value).filter(([k])=>!keys.includes(k)));
  if(oldOutcome?.status!=='ACCOUNT_DEFERRED'||outcome?.status!=='ACCOUNT_DEFERRED'||
     outcome.intent_branch!==intent.branch||outcome.recipient_claim_path!==path||
     canonical(without(oldOutcome,['account']))!==canonical(without(outcome,['account']))||
     canonical(outcome.account)!==canonical(expectedAccount)||
     canonical(ended.account)!==canonical(expectedAccount)||
     !plain(oldDeferred)||!plain(deferred)||
     !Number.isSafeInteger(oldDeferred.gmail_invocations)||oldDeferred.gmail_invocations<0||
     ended.gmail_invocations!==oldDeferred.gmail_invocations||
     canonical(without(oldDeferred,['observed_at','outcome']))!==
       canonical(without(deferred,['observed_at','outcome']))||
     deferred.input_sha256!==saved.input_sha256||deferred.operation_lease!==lease||
     deferred.observed_at!==ended.observed_at||canonical(deferred.outcome)!==canonical(outcome))bad();

  // Bind the unchanged mailbox identity and the unused proposed lease to the
  // complete native preimage which the original acquisition actually read.
  const priorReads=reads.filter(r=>r.event.binding==='mcp__codex_apps__github_fetch_file'&&
    r.returned_index<eventIndex);
  const prior=priorReads[priorReads.length-1];
  let returned,before,after;
  try {
    returned=sourceContent(prior?.returned.raw);
    before=parse(returned.content);after=parse(write.content);
  } catch {bad();}
  if(returned.sha!==write.sha||before.schema!=='commons.gmail-account-admission/v1'||
     after.schema!==before.schema||before.provider!=='gmail'||before.profile_id!==account.id||
     before.activity!=='Mail sending'||before.account_key!==accountKey||
     !Number.isSafeInteger(before.revision)||after.revision!==before.revision+1||
     canonical(without(before,['revision','updated_at','active']))!==
       canonical(without(after,['revision','updated_at','active']))||
     !iso(after.updated_at)||!plain(after.active)||
     after.active.operation_key!==operationKey||after.active.attempt_key!==prepared.event.attempt_key||
     !hex(after.active.token)||!iso(after.active.acquired_at)||!iso(after.active.expires_at)||
     Date.parse(after.active.expires_at)<=Date.parse(after.active.acquired_at))bad();
  const measured=hash(sha256Utf8,JSON.stringify(snapshot));
  const journalMeasured=hash(sha256Utf8,JSON.stringify(complete));
  return {schema:'commons.contact-checkpoint-received-undispatched-tail/v1',
    operation_key:operationKey,input_sha256:saved.input_sha256,operation_lease:lease,
    snapshot_sha256:measured.sha256,snapshot_bytes:measured.bytes,
    journal_sha256:journalMeasured.sha256,journal_bytes:journalMeasured.bytes,
    retained_prefix_events:saved.events.length,event_count:complete.events.length,
    retained_prefix_transports:savedTransports.length,transport_count:transports.length,
    attempt_key:prepared.event.attempt_key,transport_id:t.id,event_index:eventIndex,
    binding,args_sha256:t.args_sha256,not_dispatched_at:t.not_dispatched_at,
    additional_gmail_invocations:0,account_source_blob_sha:returned.sha,
    account_source_revision:before.revision};
}


/**
 * Receive this wrapper's completed cancellation after its pointer CAS was
 * returned or remained uncertain. Both the exact prepared payload and the
 * complete local tail survive; no provider result is inferred from a read error.
 */
/**
 * Receive the original recipient-reservation preflight cancellation after its
 * checkpoint pointer was committed or uncertain. The provider write was never
 * dispatched; its complete original request, failed storage boundary, and
 * optional failed read-only waiting withdrawal remain in the same journal.
 */

/** Receive the complete original local tail after a checkpoint save cancelled
 * Gmail before dispatch and the ended caller could not retain its account
 * release. The selected native call and every later mutation must have the
 * wrapper's exact NOT_DISPATCHED transport; original history is append-only. */
function validateReceivedPreflightTail({savedJournal,savedTransports,snapshot,savedSource={},
  reviewed,args,account,lease,intent,path,operationKey,sha256Utf8}) {
  const bad=()=>fail('CONTACT_CHECKPOINT_PREFLIGHT_TAIL_INVALID');
  const saved=savedJournal,complete=snapshot?.journal,transports=snapshot?.transports;
  if(!plain(snapshot)||!snapshotSourceFieldsMatch(snapshot,savedSource)||snapshot.pending_pointer!==null||
     !plain(saved)||!plain(complete)||!Array.isArray(saved.events)||!saved.events.length||
     !Array.isArray(complete.events)||complete.events.length<saved.events.length+15||
     !Array.isArray(savedTransports)||!savedTransports.length||!Array.isArray(transports)||
     transports.length!==savedTransports.length+1||!plain(account)||!plain(args)||
     !hex(operationKey)||typeof sha256Utf8!=='function'||
     saved.schema!=='commons.connected-first-contact/v1'||
     saved.input_sha256!==hash(sha256Utf8,JSON.stringify(reviewed)).sha256||
     saved.lease!==lease||canonical(saved.input)!==canonical(reviewed)||
     hash(sha256Utf8,{input_sha256:saved.input_sha256,lease}).sha256!==operationKey)bad();
  const stable=value=>Object.fromEntries(Object.entries(value).filter(
    ([key])=>!['events','outcome'].includes(key)));
  if(canonical(stable(saved))!==canonical(stable(complete))||
     saved.receipt||saved.native_receipt||complete.receipt||complete.native_receipt)bad();
  const start=saved.events.length;
  for(let i=0;i<start;i++)if(canonical(saved.events[i])!==canonical(complete.events[i]))bad();
  for(let i=0;i<savedTransports.length;i++)
    if(savedTransports[i].state!=='RETURNED'||
       canonical(savedTransports[i])!==canonical(transports[i]))bad();
  // The saved pointer already owns this successful account-write return. No
  // provider write, acquired token or inferred return may be supplied anew.
  const priorCall=saved.events.at(-1),acquireCall=priorCall?.event,
    retained=savedTransports.at(-1),binding='mcp__codex_apps__github_update_file';
  if(priorCall?.phase!=='account-admission'||acquireCall?.phase!=='invoking'||
     acquireCall.binding!==binding||!plain(acquireCall.args)||!hex(acquireCall.call_id)||
     retained.event_index!==start-1||retained.nested!==true||retained.binding!==binding||
     !plain(retained.raw)||retained.raw.isError||
     retained.return_sha256!==hash(sha256Utf8,JSON.stringify(retained.raw)).sha256||
     retained.args_sha256!==hash(sha256Utf8,JSON.stringify(acquireCall.args)).sha256||
     retained.id!==hash(sha256Utf8,{operationKey,index:start-1,binding,args:acquireCall.args}).sha256||
     !iso(retained.returned_at))bad();
  const accepted=sourceContent(retained.raw);
  if(!git(accepted.commit_sha)||!git(accepted.content_sha))bad();
  const accountKey=hash(sha256Utf8,{provider:'gmail',profile_id:account.id,activity:'Mail sending'}).sha256;
  const branch='mailbox-admission/v1/'+accountKey,writeArgs=acquireCall.args;
  if(writeArgs.repository_full_name!==REPOSITORY||writeArgs.branch!==branch||
     writeArgs.path!=='state/gmail-account.json'||!git(writeArgs.sha)||
     typeof writeArgs.content!=='string'||
     writeArgs.message!=='Coordinate native Gmail account state [skip ci]')bad();
  let post;try{post=parse(writeArgs.content);}catch{bad();}
  const accountLease=post?.active,attemptKey=accountLease?.attempt_key;
  if(post?.schema!=='commons.gmail-account-admission/v1'||post.account_key!==accountKey||
     post.provider!=='gmail'||post.profile_id!==account.id||post.activity!=='Mail sending'||
     !Number.isSafeInteger(post.revision)||post.revision<1||
     accountLease?.operation_key!==operationKey||!hex(attemptKey)||!hex(accountLease.token)||
     accountLease.send_binding!==(args.draft_id?'mcp__codex_apps__gmail_send_draft':'mcp__codex_apps__gmail_send_email')||
     !iso(accountLease.acquired_at)||!iso(accountLease.expires_at)||
     Date.parse(accountLease.expires_at)-Date.parse(accountLease.acquired_at)!==LEASE_MS)bad();
  const writeReceipt={schema:'commons.gmail-account-write/v1',repository:REPOSITORY,
    branch,path:'state/gmail-account.json',account_key:accountKey,revision:post.revision,
    previous_sha:writeArgs.sha,commit_sha:accepted.commit_sha,content_sha:accepted.content_sha,
    content_sha256:hash(sha256Utf8,writeArgs.content).sha256};
  let previousTime=Date.parse(priorCall.observed_at);
  for(let i=start;i<complete.events.length;i++){
    const row=complete.events[i];
    if(!plain(row)||!iso(row.observed_at)||Date.parse(row.observed_at)<previousTime)bad();
    previousTime=Date.parse(row.observed_at);
    if(row.phase==='account-admission'&&(!plain(row.event)||
       row.event.observed_at!==row.observed_at))bad();
  }
  const nested=(offset,phase)=>{
    const outer=complete.events[start+offset],event=outer?.event;
    if(outer?.phase!=='account-admission'||event?.phase!==phase)bad();
    return event;
  };
  const returned=nested(0,'returned');
  if(returned.binding!==binding||returned.call_id!==acquireCall.call_id||
     canonical(returned.raw)!==canonical(retained.raw)||
     Date.parse(returned.observed_at)<Date.parse(retained.returned_at))bad();
  if(canonical(nested(1,'write-accepted').write)!==canonical(writeReceipt))bad();
  const read=nested(2,'invoking'),readReturn=nested(3,'returned');
  if(read.binding!=='mcp__codex_apps__github_fetch_file'||!hex(read.call_id)||
     canonical(read.args)!==canonical({repository_full_name:REPOSITORY,
       path:'state/gmail-account.json',ref:accepted.commit_sha})||
     readReturn.binding!==read.binding||readReturn.call_id!==read.call_id||
     !plain(readReturn.raw)||readReturn.raw.isError)bad();
  const readback=sourceContent(readReturn.raw);
  if(readback.sha!==accepted.content_sha||readback.content!==writeArgs.content||
     canonical(nested(4,'accepted-write-readback').write)!==canonical(writeReceipt))bad();
  const head=nested(5,'invoking'),headReturn=nested(6,'returned');
  if(head.binding!=='mcp__codex_apps__github_fetch_commit'||!hex(head.call_id)||
     canonical(head.args)!==canonical({repo_full_name:REPOSITORY,commit_sha:'refs/heads/'+branch})||
     headReturn.binding!==head.binding||headReturn.call_id!==head.call_id||
     !plain(headReturn.raw)||headReturn.raw.isError||
     sourceContent(headReturn.raw).commit?.sha!==accepted.commit_sha)bad();
  const reused=nested(7,'immutable-account-read-reused');
  if(reused.repository!==REPOSITORY||reused.path!==writeReceipt.path||
     reused.account_key!==accountKey||reused.commit_sha!==accepted.commit_sha||
     reused.content_sha!==accepted.content_sha||reused.content_sha256!==writeReceipt.content_sha256)bad();
  const acquired=complete.events[start+8];
  if(acquired?.phase!=='account-attempt-acquired'||acquired.operation_key!==operationKey||
     acquired.attempt_key!==attemptKey||canonical(acquired.lease)!==canonical(accountLease)||
     acquired.scope!=='PREPARED_ORIGINAL_CONTACT'||
     canonical(acquired.accepted_write)!==canonical(writeReceipt)||
     acquired.state_sha!==accepted.content_sha||acquired.commit_sha!==accepted.commit_sha||
     acquired.revision!==post.revision)bad();

  const transport=transports.at(-1),index=transport?.event_index,call=complete.events[index];
  if(transport.nested!==false||transport.binding!==binding||index<start+9||
     index!==complete.events.length-6||!plain(transport.error)||
     typeof transport.error.message!=='string'||!iso(call?.observed_at))bad();
  const undispatched=validateUndispatchedNativeCall({journal:complete,transports,
    operationKey,eventIndex:index,binding,sha256Utf8});
  // Only complete original intent and recipient reads may intervene. Match every
  // returned result to its exact original call; an unfinished read is not adopted.
  const reads=new Map();
  for(let i=start+9;i<index;i++){
    const event=complete.events[i];
    if(event.phase==='invoking'){
      const commit=event.binding==='mcp__codex_apps__github_fetch_commit'&&
        canonical(event.args)===canonical({repo_full_name:'woahwhattheheck/commons',
          commit_sha:'refs/heads/'+intent.branch});
      const recipient=event.binding==='mcp__codex_apps__github_fetch_file'&&
        canonical(event.args)===canonical({repository_full_name:'woahwhattheheck/commons',
          path,ref:'main',encoding:'utf-8'});
      if(!(commit||recipient)||!hex(event.call_id)||reads.has(event.call_id)||
         event.invocation_event!==i||
         event.args_sha256!==hash(sha256Utf8,canonical(event.args)).sha256||
         event.call_id!==hash(sha256Utf8,canonical({operation_key:operationKey,
           binding:event.binding,invocation_event:i,args_sha256:event.args_sha256})).sha256)bad();
      reads.set(event.call_id,event);
    }else if(event.phase==='returned'){
      const original=reads.get(event.call_id);
      if(!original||event.binding!==original.binding||event.invocation_event!==original.invocation_event||
         event.args_sha256!==original.args_sha256||!plain(event.raw)||event.raw.isError)bad();
      reads.delete(event.call_id);
    }else bad();
  }
  if(reads.size)bad();
  // Receive only this original gateway's same-recipient reservation extension.
  const write=call.args;
  if(write.repository_full_name!=='woahwhattheheck/commons'||write.branch!=='main'||
     write.path!==path||!git(write.sha)||typeof write.content!=='string'||
     write.message!=='revenue: first-contact recipient reservation [skip ci]')bad();
  let originalSource=null;
  for(let i=index-1;i>=0;i--) {
    const row=complete.events[i];
    if(row?.phase!=='returned'||row.binding!=='mcp__codex_apps__github_fetch_file'||row.raw?.isError)continue;
    let value;try{value=sourceContent(row.raw);}catch{continue;}
    if(value.sha!==write.sha||typeof value.content!=='string')continue;
    const opened=complete.events.slice(0,i).findLast(item=>item?.phase==='invoking'&&
      item.binding===row.binding&&(row.call_id===undefined||item.call_id===row.call_id));
    if(opened?.args?.repository_full_name!==write.repository_full_name||
       opened.args.path!==path||opened.args.ref!=='main'||opened.args.encoding!=='utf-8')bad();
    originalSource=value;break;
  }
  let before,after;try{before=parse(originalSource?.content);after=parse(write.content);}catch{bad();}
  const withoutExpiry=value=>Object.fromEntries(Object.entries(value).filter(([key])=>key!=='send_expires_at'));
  if(!plain(before)||!plain(after)||before.protocol!=='commons-first-contact-v1'||
     before.status!=='reserved'||before.case!==reviewed.opportunity_id||before.lease!==lease||
     canonical(withoutExpiry(before))!==canonical(withoutExpiry(after))||
     !iso(before.reserved_at)||!iso(before.send_expires_at)||!iso(after.send_expires_at)||
     Date.parse(after.send_expires_at)<=Date.parse(call.observed_at)||
     Date.parse(after.send_expires_at)-Date.parse(call.observed_at)>LEASE_MS||
     Date.parse(after.send_expires_at)<Date.parse(before.send_expires_at))bad();

  const failed=complete.events[index+1],ended=complete.events[index+2];
  if(failed?.phase!=='failed'||failed.binding!==binding||
     failed.invocation_event!==index||failed.call_id!==call.call_id||
     failed.args_sha256!==call.args_sha256||failed.returned_event!==null||
     failed.message!==transport.error.message||!iso(failed.observed_at)||
     Date.parse(failed.observed_at)<Date.parse(transport.not_dispatched_at)||
     !plain(failed.native_failure))bad();
  const nativeFailure={binding,invocation_event:index,args_sha256:call.args_sha256,
    call_id:call.call_id,returned_event:null,name:failed.native_failure.name,
    message:failed.message,status:failed.status};
  if(typeof nativeFailure.name!=='string'||
     !(nativeFailure.status===null||Number.isSafeInteger(nativeFailure.status))||
     canonical(failed.native_failure)!==canonical(nativeFailure))bad();
  const failure={name:nativeFailure.name,message:nativeFailure.message,
    status:nativeFailure.status,native_failure:nativeFailure};
  if(ended?.phase!=='operation-preflight-ended'||
     ended.input_sha256!==saved.input_sha256||ended.operation_lease!==lease||
     ended.operation_key!==operationKey||
     !(ended.attempt_key===null||hex(ended.attempt_key))||
     !iso(ended.started_at)||!iso(ended.observed_at)||
     Date.parse(ended.started_at)>Date.parse(call.observed_at)||
     Date.parse(ended.observed_at)<Date.parse(failed.observed_at)||
     !Number.isSafeInteger(ended.event_start)||ended.event_start<0||ended.event_start>index||
     ended.event_end!==index+2||canonical(ended.previous_outcome)!==canonical(saved.outcome||null)||
     canonical(ended.failure)!==canonical(failure))bad();
  const sends=new Set(['mcp__codex_apps__gmail_send_email','mcp__codex_apps__gmail_send_draft']);
  const gmailBefore=complete.events.slice(0,ended.event_start)
    .filter(row=>row.phase==='invoking'&&sends.has(row.binding)).length;
  const gmailAfter=complete.events.slice(0,index+2)
    .filter(row=>row.phase==='invoking'&&sends.has(row.binding)).length;
  const failedEvents=complete.events.slice(ended.event_start,index+2)
    .flatMap((row,offset)=>row.phase==='failed'?[ended.event_start+offset]:[]);
  const nativeFailures=failedEvents.map(i=>complete.events[i].native_failure).filter(Boolean);
  if(gmailBefore!==gmailAfter||ended.gmail_invocations_before!==gmailBefore||
     ended.gmail_invocations_after!==gmailAfter||
     canonical(ended.failed_events)!==canonical(failedEvents)||
     canonical(ended.native_failures)!==canonical(nativeFailures))bad();
  const outcome={status:'PREFLIGHT_FAILED',stage:'BEFORE_GMAIL_INVOCATION',
    error:failure,operation_key:operationKey,attempt_key:ended.attempt_key,
    observed_at:ended.observed_at,event_start:ended.event_start,event_end:index+2,
    failed_events:failedEvents,native_failures:nativeFailures,ended_event:index+2,
    gmail_invocations_before:gmailBefore,gmail_invocations_after:gmailAfter,
    intent_branch:intent.branch,recipient_claim_path:path,
    ...(saved.receipt?.message_id?{message_id:saved.receipt.message_id}:{}),
    action:'Continue the same original operation after receiving its failed preflight'};
  if(canonical(complete.outcome)!==canonical(outcome))bad();

  if(ended.attempt_key!==attemptKey||ended.event_start>=start||
     complete.events.some(row=>/^mcp__codex_apps__gmail_send_(?:email|draft)$/.test(row.binding||'')&&
       ['invoking','returned'].includes(row.phase)))bad();
  // The finalizer only attempted to READ the original account. Keep the actual
  // failure; receiving it neither claims a release nor creates send permission.
  const releaseStart=complete.events[index+3],releaseReturn=complete.events[index+4],
    releaseFailed=complete.events[index+5],releaseCall=releaseStart?.event,
    releaseResult=releaseReturn?.event;
  if(releaseStart?.phase!=='account-admission'||releaseReturn?.phase!=='account-admission'||
     releaseCall?.phase!=='invoking'||releaseCall.binding!=='mcp__codex_apps__github_fetch_commit'||
     !hex(releaseCall.call_id)||
     canonical(releaseCall.args)!==canonical({repo_full_name:REPOSITORY,commit_sha:'refs/heads/'+branch})||
     releaseResult?.phase!=='returned'||releaseResult.binding!==releaseCall.binding||
     releaseResult.call_id!==releaseCall.call_id||releaseResult.raw?.isError!==true||
     releaseFailed?.phase!=='account-attempt-release-failed'||
     releaseFailed.operation_key!==operationKey||releaseFailed.attempt_key!==attemptKey||
     releaseFailed.invoked!==false||releaseFailed.returned!==false||releaseFailed.terminated!==false)bad();
  let releaseError;try{sourceContent(releaseResult.raw);}catch(error){releaseError=error;}
  if(!releaseError||releaseError.message!==releaseFailed.message)bad();
  const measured=hash(sha256Utf8,JSON.stringify(snapshot));
  return {schema:'commons.contact-checkpoint-received-preflight-tail/v1',
    operation_key:operationKey,input_sha256:saved.input_sha256,operation_lease:lease,
    snapshot_sha256:measured.sha256,snapshot_bytes:measured.bytes,
    journal_sha256:hash(sha256Utf8,JSON.stringify(complete)).sha256,
    retained_prefix_events:start,event_count:complete.events.length,
    retained_prefix_transports:savedTransports.length,transport_count:transports.length,
    accepted_account_write:writeReceipt,account_attempt_key:attemptKey,
    account_acquired_event:start+8,undispatched,failed_preflight_event:index+2,
    recipient_source_blob_sha:originalSource.sha,
    recipient_source_sha256:hash(sha256Utf8,originalSource.content).sha256,
    unused_account_release:{status:'READ_FAILED',event_start:index+3,event_end:index+5,
      binding:releaseCall.binding,call_id:releaseCall.call_id,
      returned_sha256:hash(sha256Utf8,JSON.stringify(releaseResult.raw)).sha256},
    additional_gmail_invocations:0,
    meaning:'Exact ended preflight retained. Original account ownership still requires reconciliation; fresh admission and recipient checks remain mandatory.'};
}

function validateReceivedCancelledSendTail({savedJournal,savedTransports,snapshot,savedSource={},
  reviewed,args,account,lease,intent,path,operationKey,sha256Utf8}) {
  const bad=()=>fail('CONTACT_CHECKPOINT_CANCELLED_SEND_TAIL_INVALID');
  const saved=savedJournal,complete=snapshot?.journal,transports=snapshot?.transports;
  if(!plain(snapshot)||!snapshotSourceFieldsMatch(snapshot,savedSource)||snapshot.pending_pointer!==null||
     !plain(saved)||!plain(complete)||!Array.isArray(saved.events)||
     !Array.isArray(complete.events)||complete.events.length<=saved.events.length||
     !Array.isArray(savedTransports)||!Array.isArray(transports)||
     transports.length!==savedTransports.length+2||!plain(account)||!plain(args)||
     !hex(operationKey)||typeof sha256Utf8!=='function'||
     saved.schema!=='commons.connected-first-contact/v1'||
     saved.input_sha256!==hash(sha256Utf8,JSON.stringify(reviewed)).sha256||
     saved.lease!==lease||canonical(saved.input)!==canonical(reviewed)||
     hash(sha256Utf8,{input_sha256:saved.input_sha256,lease}).sha256!==operationKey)bad();
  const stable=value=>Object.fromEntries(Object.entries(value).filter(
    ([key])=>!['events','outcome'].includes(key)));
  if(canonical(stable(saved))!==canonical(stable(complete))||
     saved.receipt||saved.native_receipt||complete.receipt||complete.native_receipt)bad();
  for(let i=0;i<saved.events.length;i++)
    if(canonical(saved.events[i])!==canonical(complete.events[i]))bad();
  for(let i=0;i<savedTransports.length;i++)
    if(savedTransports[i].state!=='RETURNED'||
       canonical(savedTransports[i])!==canonical(transports[i]))bad();

  const added=transports.slice(savedTransports.length);
  const nativeBinding=args.draft_id?'mcp__codex_apps__gmail_send_draft':'mcp__codex_apps__gmail_send_email';
  const native=added.find(row=>row.nested===false&&row.binding===nativeBinding);
  if(!native||native.event_index<saved.events.length)bad();
  const proof=validateUndispatchedNativeCall({journal:complete,transports,
    operationKey,eventIndex:native.event_index,binding:nativeBinding,sha256Utf8});
  const cancelled=complete.events[native.event_index];
  if(canonical(cancelled.args)!==canonical(args)||!plain(native.error)||
     typeof native.error.message!=='string'||!iso(cancelled.observed_at))bad();
  const acquiredIndex=complete.events.findLastIndex((row,index)=>index<native.event_index&&
    row.phase==='account-attempt-acquired'&&row.operation_key===operationKey);
  const acquired=complete.events[acquiredIndex],attemptKey=acquired?.attempt_key,accountLease=acquired?.lease;
  if(acquiredIndex<0||!hex(attemptKey)||accountLease?.operation_key!==operationKey||
     accountLease.attempt_key!==attemptKey||!hex(accountLease.token)||
     !iso(acquired.observed_at)||Date.parse(acquired.observed_at)>Date.parse(cancelled.observed_at)||
     cancelled.account_operation_key!==operationKey||cancelled.account_attempt_key!==attemptKey)bad();
  if(complete.events.some(row=>/^mcp__codex_apps__gmail_send_(?:email|draft)$/.test(row.binding||'')&&
      ['invoking','returned'].includes(row.phase)))bad();
  if(complete.events.slice(acquiredIndex+1).some(row=>row.operation_key===operationKey&&
      ['account-attempt-prepared','account-attempt-acquired'].includes(row.phase)))bad();
  const failed=complete.events[native.event_index+1];
  if(failed?.phase!=='failed'||failed.binding!==nativeBinding||
     failed.invocation_event!==native.event_index||failed.call_id!==cancelled.call_id||
     failed.args_sha256!==cancelled.args_sha256||failed.returned_event!==null||
     failed.message!==native.error.message||!iso(failed.observed_at)||
     Date.parse(failed.observed_at)<Date.parse(proof.not_dispatched_at))bad();

  const release=added.find(row=>row.nested===true);
  const outer=complete.events[release?.event_index],call=outer?.event;
  if(!release||release.event_index<=native.event_index||release.state!=='NOT_DISPATCHED'||
     release.binding!=='mcp__codex_apps__github_update_file'||outer.phase!=='account-admission'||
     call?.phase!=='checkpoint-not-dispatched'||call.original_phase!=='invoking'||
     call.binding!==release.binding||!plain(call.args)||!hex(release.id)||
     !hex(release.args_sha256)||call.checkpoint_transport_id!==release.id||
     !iso(release.not_dispatched_at)||call.not_dispatched_at!==release.not_dispatched_at||
     release.raw!==undefined||release.return_sha256!==undefined||release.returned_at!==undefined||
     !plain(release.error)||typeof release.error.message!=='string'||
     hash(sha256Utf8,JSON.stringify(call.args)).sha256!==release.args_sha256||
     hash(sha256Utf8,{operationKey,index:release.event_index,binding:release.binding,args:call.args}).sha256!==release.id)bad();
  const accountKey=hash(sha256Utf8,{provider:'gmail',profile_id:account.id,activity:'Mail sending'}).sha256;
  const write=call.args;
  if(write.repository_full_name!==REPOSITORY||write.path!=='state/gmail-account.json'||
     write.branch!=='mailbox-admission/v1/'+accountKey||!git(write.sha)||
     typeof write.content!=='string')bad();
  let post;try{post=parse(write.content);}catch{bad();}
  if(post.schema!=='commons.gmail-account-admission/v1'||post.account_key!==accountKey||
     post.profile_id!==account.id||post.provider!=='gmail'||post.activity!=='Mail sending'||
     post.active!==null||post.last_release?.operation_key!==operationKey||
     post.last_release.attempt_key!==attemptKey||post.last_release.token!==accountLease.token)bad();
  const releaseFailed=complete.events[release.event_index+1];
  const ended=complete.events.at(-1);
  if(releaseFailed?.phase!=='account-admission'||releaseFailed.event?.phase!=='failed'||
     releaseFailed.event.binding!==release.binding||releaseFailed.event.call_id!==call.call_id||
     releaseFailed.event.message!==release.error.message||
     ended?.phase!=='account-attempt-release-failed'||ended.operation_key!==operationKey||
     ended.attempt_key!==attemptKey||ended.invoked!==true||ended.returned!==false||
     ended.terminated!==true||ended.message!==release.error.message||
     !iso(ended.observed_at)||Date.parse(ended.observed_at)<Date.parse(release.not_dispatched_at))bad();

  const readonly=/^mcp__codex_apps__(?:github_(?:fetch(?:_file|_blob|_commit)?|get_(?:profile|user_login|repo)|compare_commits)|gmail_(?:get_profile|search_email_ids|search_emails|read_email|read_thread|read_attachment))$/;
  const bookkeeping=new Set(['account-attempt-acquired','mailbox-identities-reused',
    'relationship','organization-census','account-attempt-release-failed']);
  const nestedBookkeeping=new Set(['write-accepted','accepted-write-readback','immutable-account-read-reused']);
  const calls=new Map(),finished=new Map();
  for(let index=0;index<complete.events.length;index++){
    const row=complete.events[index],nested=row.phase==='account-admission',event=nested?row.event:row;
    if(!plain(row)||!plain(event)||!iso(row.observed_at))bad();
    const key=(nested?'account:':'contact:')+(event.call_id||event.binding);
    if(event.phase==='invoking'){
      if(!plain(event.args)||calls.has(key))bad();
      if(index>=saved.events.length&&!readonly.test(event.binding||''))bad();
      calls.set(key,{event,index});
    }else if(event.phase==='returned'){
      const original=calls.get(key);
      if(!original||original.event.binding!==event.binding||!plain(event.raw))bad();
      if(index>=saved.events.length&&!readonly.test(event.binding||'')){
        const retained=savedTransports.find(t=>t.event_index===original.index&&t.nested===nested);
        if(!retained||retained.state!=='RETURNED'||canonical(retained.raw)!==canonical(event.raw))bad();
      }
      calls.delete(key);finished.set(key,event);
    }else if(event.phase==='checkpoint-not-dispatched'){
      const expected=nested?release:native;
      if(index!==expected.event_index||event.binding!==expected.binding||calls.has(key))bad();
      finished.set(key,event);
    }else if(event.phase==='failed'){
      if(index<saved.events.length){calls.delete(key);finished.set(key,event);continue;}
      const previous=finished.get(key);
      if(!previous||previous.phase!=='checkpoint-not-dispatched')bad();
    }else if(index>=saved.events.length&&!(nested?nestedBookkeeping:bookkeeping).has(event.phase))bad();
  }
  if(calls.size)bad();
  const outcome=complete.outcome;
  if(!plain(outcome)||canonical(Object.keys(outcome).sort())!==canonical(
       ['status','intent_branch','recipient_claim_path','action'].sort())||
     outcome.status!=='SEND_OUTCOME_UNKNOWN'||outcome.intent_branch!==intent.branch||
     outcome.recipient_claim_path!==path||typeof outcome.action!=='string')bad();
  const measured=hash(sha256Utf8,JSON.stringify(snapshot));
  return {schema:'commons.contact-checkpoint-received-cancelled-send-tail/v1',
    operation_key:operationKey,input_sha256:saved.input_sha256,operation_lease:lease,
    snapshot_sha256:measured.sha256,snapshot_bytes:measured.bytes,
    retained_prefix_events:saved.events.length,event_count:complete.events.length,
    retained_prefix_transports:savedTransports.length,transport_count:transports.length,
    native_call:proof,account_release_transport_id:release.id,
    account_attempt_key:attemptKey,additional_gmail_invocations:0};
}

function validateReceivedPendingPreflightTail({preparedPayload,snapshot,reviewed,
  account,lease,intent,path,operationKey,sha256Utf8}) {
  const bad=()=>fail('CONTACT_CHECKPOINT_PENDING_PREFLIGHT_TAIL_INVALID');
  const pending=snapshot?.pending_pointer,saved=preparedPayload?.journal,
    complete=snapshot?.journal,priorTransports=preparedPayload?.transports,
    transports=snapshot?.transports;
  if(!plain(snapshot)||!snapshotSourceFieldsMatch(snapshot,preparedPayload)||
     !plain(pending)||!plain(pending.next)||!plain(saved)||!plain(complete)||
     !Array.isArray(saved.events)||!saved.events.length||!Array.isArray(complete.events)||
     ![saved.events.length+2,saved.events.length+5].includes(complete.events.length)||
     !Array.isArray(priorTransports)||!priorTransports.length||!Array.isArray(transports)||
     transports.length!==priorTransports.length||!plain(account)||!hex(operationKey)||
     typeof sha256Utf8!=='function')bad();
  const prepared=hash(sha256Utf8,serializeCheckpointPayload(preparedPayload));
  if(prepared.sha256!==pending.next.payload?.sha256||
     prepared.bytes!==pending.next.payload?.bytes||
     saved.schema!=='commons.connected-first-contact/v1'||
     saved.input_sha256!==hash(sha256Utf8,JSON.stringify(reviewed)).sha256||
     saved.lease!==lease||canonical(saved.input)!==canonical(reviewed)||
     hash(sha256Utf8,{input_sha256:saved.input_sha256,lease}).sha256!==operationKey)bad();
  const stable=value=>Object.fromEntries(Object.entries(value)
    .filter(([key])=>!['events','outcome'].includes(key)));
  if(canonical(stable(saved))!==canonical(stable(complete)))bad();
  const index=saved.events.length-1,call=saved.events[index],
    cancelled=complete.events[index],prior=priorTransports.at(-1),
    transport=transports.at(-1),binding='mcp__codex_apps__github_update_file';
  for(let i=0;i<index;i++)if(canonical(saved.events[i])!==canonical(complete.events[i]))bad();
  for(let i=0;i<priorTransports.length-1;i++)
    if(canonical(priorTransports[i])!==canonical(transports[i]))bad();
  if(call?.phase!=='invoking'||call.binding!==binding||!plain(call.args)||
     !iso(call.observed_at)||!plain(prior)||prior.nested!==false||
     prior.event_index!==index||prior.binding!==binding||prior.state!=='INVOKING'||
     canonical(Object.keys(prior).sort())!==canonical(
       ['args_sha256','binding','event_index','id','nested','state'])||
     !plain(transport)||!iso(transport.not_dispatched_at)||!plain(transport.error)||
     typeof transport.error.code!=='string'||typeof transport.error.message!=='string'||
     Date.parse(transport.not_dispatched_at)<Date.parse(call.observed_at)||
     canonical(transport)!==canonical({...prior,state:'NOT_DISPATCHED',
       not_dispatched_at:transport.not_dispatched_at,error:transport.error})||
     canonical(cancelled)!==canonical({...call,original_phase:'invoking',
       phase:'checkpoint-not-dispatched',checkpoint_transport_id:prior.id,
       not_dispatched_at:transport.not_dispatched_at}))bad();
  const undispatched=validateUndispatchedNativeCall({journal:complete,transports,
    operationKey,eventIndex:index,binding,sha256Utf8});

  // Receive only this original gateway's same-recipient reservation extension.
  const write=call.args;
  if(write.repository_full_name!=='woahwhattheheck/commons'||write.branch!=='main'||
     write.path!==path||!git(write.sha)||typeof write.content!=='string'||
     write.message!=='revenue: first-contact recipient reservation [skip ci]')bad();
  let originalSource=null;
  for(let i=index-1;i>=0;i--) {
    const row=saved.events[i];
    if(row?.phase!=='returned'||row.binding!=='mcp__codex_apps__github_fetch_file'||row.raw?.isError)continue;
    let value;try{value=sourceContent(row.raw);}catch{continue;}
    if(value.sha!==write.sha||typeof value.content!=='string')continue;
    const opened=saved.events.slice(0,i).findLast(item=>item?.phase==='invoking'&&
      item.binding===row.binding&&(row.call_id===undefined||item.call_id===row.call_id));
    if(opened?.args?.repository_full_name!==write.repository_full_name||
       opened.args.path!==path||opened.args.ref!=='main'||opened.args.encoding!=='utf-8')bad();
    originalSource=value;break;
  }
  let before,after;try{before=parse(originalSource?.content);after=parse(write.content);}catch{bad();}
  const withoutExpiry=value=>Object.fromEntries(Object.entries(value).filter(([key])=>key!=='send_expires_at'));
  if(!plain(before)||!plain(after)||before.protocol!=='commons-first-contact-v1'||
     before.status!=='reserved'||before.case!==reviewed.opportunity_id||before.lease!==lease||
     canonical(withoutExpiry(before))!==canonical(withoutExpiry(after))||
     !iso(before.reserved_at)||!iso(before.send_expires_at)||!iso(after.send_expires_at)||
     Date.parse(after.send_expires_at)<=Date.parse(call.observed_at)||
     Date.parse(after.send_expires_at)-Date.parse(call.observed_at)>LEASE_MS||
     Date.parse(after.send_expires_at)<Date.parse(before.send_expires_at))bad();

  const failed=complete.events[index+1],ended=complete.events[index+2];
  if(failed?.phase!=='failed'||failed.binding!==binding||
     failed.invocation_event!==index||failed.call_id!==call.call_id||
     failed.args_sha256!==call.args_sha256||failed.returned_event!==null||
     failed.message!==transport.error.message||!iso(failed.observed_at)||
     Date.parse(failed.observed_at)<Date.parse(transport.not_dispatched_at)||
     !plain(failed.native_failure))bad();
  const nativeFailure={binding,invocation_event:index,args_sha256:call.args_sha256,
    call_id:call.call_id,returned_event:null,name:failed.native_failure.name,
    message:failed.message,status:failed.status};
  if(typeof nativeFailure.name!=='string'||
     !(nativeFailure.status===null||Number.isSafeInteger(nativeFailure.status))||
     canonical(failed.native_failure)!==canonical(nativeFailure))bad();
  const failure={name:nativeFailure.name,message:nativeFailure.message,
    status:nativeFailure.status,native_failure:nativeFailure};
  if(ended?.phase!=='operation-preflight-ended'||
     ended.input_sha256!==saved.input_sha256||ended.operation_lease!==lease||
     ended.operation_key!==operationKey||
     !(ended.attempt_key===null||hex(ended.attempt_key))||
     !iso(ended.started_at)||!iso(ended.observed_at)||
     Date.parse(ended.started_at)>Date.parse(call.observed_at)||
     Date.parse(ended.observed_at)<Date.parse(failed.observed_at)||
     !Number.isSafeInteger(ended.event_start)||ended.event_start<0||ended.event_start>index||
     ended.event_end!==index+2||canonical(ended.previous_outcome)!==canonical(saved.outcome||null)||
     canonical(ended.failure)!==canonical(failure))bad();
  const sends=new Set(['mcp__codex_apps__gmail_send_email','mcp__codex_apps__gmail_send_draft']);
  const gmailBefore=complete.events.slice(0,ended.event_start)
    .filter(row=>row.phase==='invoking'&&sends.has(row.binding)).length;
  const gmailAfter=complete.events.slice(0,index+2)
    .filter(row=>row.phase==='invoking'&&sends.has(row.binding)).length;
  const failedEvents=complete.events.slice(ended.event_start,index+2)
    .flatMap((row,offset)=>row.phase==='failed'?[ended.event_start+offset]:[]);
  const nativeFailures=failedEvents.map(i=>complete.events[i].native_failure).filter(Boolean);
  if(gmailBefore!==gmailAfter||ended.gmail_invocations_before!==gmailBefore||
     ended.gmail_invocations_after!==gmailAfter||
     canonical(ended.failed_events)!==canonical(failedEvents)||
     canonical(ended.native_failures)!==canonical(nativeFailures))bad();
  const outcome={status:'PREFLIGHT_FAILED',stage:'BEFORE_GMAIL_INVOCATION',
    error:failure,operation_key:operationKey,attempt_key:ended.attempt_key,
    observed_at:ended.observed_at,event_start:ended.event_start,event_end:index+2,
    failed_events:failedEvents,native_failures:nativeFailures,ended_event:index+2,
    gmail_invocations_before:gmailBefore,gmail_invocations_after:gmailAfter,
    intent_branch:intent.branch,recipient_claim_path:path,
    ...(saved.receipt?.message_id?{message_id:saved.receipt.message_id}:{}),
    action:'Continue the same original operation after receiving its failed preflight'};
  if(canonical(complete.outcome)!==canonical(outcome))bad();

  // An optional finalizer contains one failed read of this original account.
  // It has no mutation, send, deadline override, or new lease.
  let withdrawal=null;
  if(complete.events.length===saved.events.length+5) {
    const start=complete.events[index+3],returned=complete.events[index+4],
      unfinished=complete.events[index+5],invocation=start?.event,result=returned?.event;
    const accountKey=hash(sha256Utf8,{provider:'gmail',profile_id:String(account.id),
      activity:'Mail sending'}).sha256;
    const url='https://api.github.com/repos/'+REPOSITORY+
      '/git/ref/heads/mailbox-admission/v1/'+accountKey;
    if(start?.phase!=='account-admission'||returned?.phase!=='account-admission'||
       invocation?.phase!=='invoking'||invocation.binding!=='mcp__codex_apps__github_fetch'||
       canonical(invocation.args)!==canonical({url})||!hex(invocation.call_id)||
       result?.phase!=='returned'||result.binding!==invocation.binding||
       result.call_id!==invocation.call_id||!plain(result.raw)||result.raw.isError!==true||
       !iso(start.observed_at)||start.observed_at!==invocation.observed_at||
       !iso(returned.observed_at)||returned.observed_at!==result.observed_at||
       Date.parse(start.observed_at)<Date.parse(ended.observed_at)||
       Date.parse(returned.observed_at)<Date.parse(start.observed_at)||
       unfinished?.phase!=='account-wait-withdrawal-unfinished'||
       unfinished.operation_key!==operationKey||unfinished.input_sha256!==saved.input_sha256||
       unfinished.operation_lease!==lease||unfinished.reason!=='ORIGINAL_PREFLIGHT_FINISHED'||
       typeof unfinished.message!=='string'||!iso(unfinished.observed_at)||
       Date.parse(unfinished.observed_at)<Date.parse(returned.observed_at))bad();
    let observedError;try{sourceContent(result.raw);}catch(error){observedError=error;}
    if(!observedError||observedError.message!==unfinished.message)bad();
    withdrawal={event_start:index+3,event_end:index+5,
      binding:invocation.binding,call_id:invocation.call_id,
      returned_sha256:hash(sha256Utf8,JSON.stringify(result.raw)).sha256,
      status:'READ_FAILED',meaning:'No account withdrawal or provider send was performed by this finalizer.'};
  }
  const measured=hash(sha256Utf8,JSON.stringify(snapshot));
  return {schema:'commons.contact-checkpoint-received-pending-preflight-tail/v1',
    operation_key:operationKey,input_sha256:saved.input_sha256,operation_lease:lease,
    snapshot_sha256:measured.sha256,snapshot_bytes:measured.bytes,
    prepared_payload_sha256:prepared.sha256,prepared_payload_bytes:prepared.bytes,
    journal_sha256:hash(sha256Utf8,JSON.stringify(complete)).sha256,
    event_count:complete.events.length,prepared_event_count:saved.events.length,
    transport_count:transports.length,undispatched,
    recipient_source_blob_sha:originalSource.sha,
    recipient_source_sha256:hash(sha256Utf8,originalSource.content).sha256,
    failed_preflight_event:index+2,additional_gmail_invocations:0,
    ...(withdrawal?{withdrawal}:{}),
    meaning:'The existing pointer and exact local cancellation are received; the original maintained sender still owns fresh checks, account admission and any later send.'};
}

function validateReceivedPendingAccountTail({preparedPayload,snapshot,reviewed,
  account,lease,intent,path,operationKey,sha256Utf8}) {
  const bad=()=>fail('CONTACT_CHECKPOINT_PENDING_ACCOUNT_TAIL_INVALID');
  const pending=snapshot?.pending_pointer,saved=preparedPayload?.journal,
    complete=snapshot?.journal,savedTransports=preparedPayload?.transports,
    transports=snapshot?.transports;
  if(!plain(snapshot)||!snapshotSourceFieldsMatch(snapshot,preparedPayload)||
     !plain(pending)||!plain(pending.next)||!plain(saved)||!plain(complete)||
     !Array.isArray(saved.events)||!saved.events.length||
     !Array.isArray(complete.events)||complete.events.length!==saved.events.length+3||
     !Array.isArray(savedTransports)||!savedTransports.length||
     !Array.isArray(transports)||transports.length!==savedTransports.length||
     !plain(account)||!hex(operationKey)||typeof sha256Utf8!=='function')bad();
  const prepared=hash(sha256Utf8,serializeCheckpointPayload(preparedPayload));
  if(prepared.sha256!==pending.next.payload?.sha256||
     prepared.bytes!==pending.next.payload?.bytes||
     saved.schema!=='commons.connected-first-contact/v1'||
     saved.input_sha256!==hash(sha256Utf8,JSON.stringify(reviewed)).sha256||
     saved.lease!==lease||canonical(saved.input)!==canonical(reviewed)||
     hash(sha256Utf8,{input_sha256:saved.input_sha256,lease}).sha256!==operationKey)bad();
  const stable=value=>Object.fromEntries(Object.entries(value)
    .filter(([key])=>!['events','outcome','account_deferred'].includes(key)));
  if(canonical(stable(saved))!==canonical(stable(complete)))bad();
  const index=saved.events.length-1,original=saved.events[index],cancelled=complete.events[index],
    call=original?.event,event=cancelled?.event,prior=savedTransports.at(-1),
    transport=transports.at(-1),binding='mcp__codex_apps__github_update_file';
  for(let i=0;i<index;i++)if(canonical(saved.events[i])!==canonical(complete.events[i]))bad();
  for(let i=0;i<savedTransports.length-1;i++)
    if(canonical(savedTransports[i])!==canonical(transports[i]))bad();
  if(original?.phase!=='account-admission'||cancelled?.phase!==original.phase||
     call?.phase!=='invoking'||call.binding!==binding||!plain(call.args)||
     !iso(original.observed_at)||original.observed_at!==call.observed_at||
     !plain(prior)||prior.nested!==true||prior.event_index!==index||
     prior.binding!==binding||prior.state!=='INVOKING'||
     canonical(Object.keys(prior).sort())!==canonical(
       ['args_sha256','binding','event_index','id','nested','state'])||
     !hex(prior.id)||!hex(prior.args_sha256)||
     prior.id!==hash(sha256Utf8,{operationKey,index,binding,args:call.args}).sha256||
     prior.args_sha256!==hash(sha256Utf8,JSON.stringify(call.args)).sha256||
     !plain(transport)||!iso(transport.not_dispatched_at)||!plain(transport.error)||
     typeof transport.error.message!=='string'||typeof transport.error.code!=='string'||
     Date.parse(transport.not_dispatched_at)<Date.parse(call.observed_at)||
     canonical(transport)!==canonical({...prior,state:'NOT_DISPATCHED',
       not_dispatched_at:transport.not_dispatched_at,error:transport.error})||
     canonical(cancelled)!==canonical({...original,event:{...call,
       original_phase:'invoking',phase:'checkpoint-not-dispatched',
       checkpoint_transport_id:prior.id,not_dispatched_at:transport.not_dispatched_at}}))bad();
  const attempt=saved.events.findLast(row=>row.phase==='account-attempt-prepared');
  if(!attempt||attempt.operation_key!==operationKey||!hex(attempt.attempt_key)||
     typeof attempt.scope!=='string'||!attempt.scope||!iso(attempt.observed_at)||
     Date.parse(attempt.observed_at)>Date.parse(call.observed_at))bad();
  const failed=complete.events[index+1],unfinished=complete.events[index+2],
    ended=complete.events[index+3],expectedAccount={status:'ACCOUNT_ADMISSION_UNAVAILABLE',
      operation_key:operationKey,attempt_key:attempt.attempt_key};
  if(failed?.phase!=='account-admission'||failed.event?.phase!=='failed'||
     failed.event.binding!==binding||failed.event.call_id!==call.call_id||
     failed.event.message!==transport.error.message||
     !iso(failed.observed_at)||failed.observed_at!==failed.event.observed_at||
     Date.parse(failed.observed_at)<Date.parse(transport.not_dispatched_at)||
     unfinished?.phase!=='account-acquire-unfinished'||
     unfinished.operation_key!==operationKey||unfinished.attempt_key!==attempt.attempt_key||
     unfinished.message!==transport.error.message||!iso(unfinished.observed_at)||
     Date.parse(unfinished.observed_at)<Date.parse(failed.observed_at)||
     ended?.phase!=='account-attempt-deferred-ended'||!iso(ended.observed_at)||
     Date.parse(ended.observed_at)<Date.parse(unfinished.observed_at)||
     ended.operation_key!==operationKey||ended.attempt_key!==attempt.attempt_key||
     ended.input_sha256!==saved.input_sha256||ended.operation_lease!==lease||
     canonical(ended.account)!==canonical(expectedAccount))bad();
  const gmailInvocations=saved.events.filter(row=>row.phase==='invoking'&&
    ['mcp__codex_apps__gmail_send_email','mcp__codex_apps__gmail_send_draft'].includes(row.binding)).length;
  const outcome={status:'ACCOUNT_DEFERRED',account:expectedAccount,
    intent_branch:intent.branch,recipient_claim_path:path,
    action:'Continue this same original operation after account admission'};
  if(ended.gmail_invocations!==gmailInvocations||canonical(complete.outcome)!==canonical(outcome)||
     canonical(complete.account_deferred)!==canonical({input_sha256:saved.input_sha256,
       operation_lease:lease,gmail_invocations:gmailInvocations,
       observed_at:ended.observed_at,outcome}))bad();

  // The original native preimage remains authoritative for the unused lease.
  const accountKey=hash(sha256Utf8,{provider:'gmail',profile_id:String(account.id),
    activity:'Mail sending'}).sha256,write=call.args;
  if(write.repository_full_name!==REPOSITORY||
     write.branch!=='mailbox-admission/v1/'+accountKey||
     write.path!=='state/gmail-account.json'||!git(write.sha)||typeof write.content!=='string')bad();
  let source;
  for(let i=index-1;i>=0;i--) {
    const row=saved.events[i],e=row.phase==='account-admission'?row.event:null;
    if(e?.phase!=='returned'||e.binding!=='mcp__codex_apps__github_fetch_file'||e.raw?.isError)continue;
    let value;try{value=sourceContent(e.raw);}catch{continue;}
    if(value.sha!==write.sha||typeof value.content!=='string')continue;
    const invocation=saved.events.slice(0,i).findLast(item=>item.phase==='account-admission'&&
      item.event?.phase==='invoking'&&item.event.binding===e.binding&&
      (e.call_id===undefined||item.event.call_id===e.call_id));
    if(invocation?.event.args?.repository_full_name!==REPOSITORY||
       invocation.event.args.path!==write.path)bad();
    source=value;break;
  }
  let before,after;try{before=parse(source?.content);after=parse(write.content);}catch{bad();}
  const without=(value,keys)=>Object.fromEntries(Object.entries(value).filter(([k])=>!keys.includes(k)));
  if(before.schema!=='commons.gmail-account-admission/v1'||after.schema!==before.schema||
     before.provider!=='gmail'||String(before.profile_id)!==String(account.id)||
     before.activity!=='Mail sending'||before.account_key!==accountKey||
     !Number.isSafeInteger(before.revision)||after.revision!==before.revision+1||
     canonical(without(before,['revision','updated_at','active']))!==
       canonical(without(after,['revision','updated_at','active']))||
     !iso(after.updated_at)||!plain(after.active)||
     after.active.operation_key!==operationKey||after.active.attempt_key!==attempt.attempt_key||
     !hex(after.active.token)||!iso(after.active.acquired_at)||!iso(after.active.expires_at)||
     Date.parse(after.active.expires_at)-Date.parse(after.active.acquired_at)!==LEASE_MS)bad();
  const measured=hash(sha256Utf8,JSON.stringify(snapshot));
  return {schema:'commons.contact-checkpoint-received-pending-account-tail/v1',
    operation_key:operationKey,input_sha256:saved.input_sha256,operation_lease:lease,
    snapshot_sha256:measured.sha256,snapshot_bytes:measured.bytes,
    prepared_payload_sha256:prepared.sha256,prepared_payload_bytes:prepared.bytes,
    journal_sha256:hash(sha256Utf8,JSON.stringify(complete)).sha256,
    event_count:complete.events.length,prepared_event_count:saved.events.length,
    transport_count:transports.length,transport_id:prior.id,event_index:index,
    attempt_key:attempt.attempt_key,binding,args_sha256:prior.args_sha256,
    not_dispatched_at:transport.not_dispatched_at,additional_gmail_invocations:0,
    account_source_blob_sha:source.sha,account_source_revision:before.revision};
}

/** Pure validation; the opener independently rereads every immutable Git source. */
function validateReceivedRateHistory({history,reviewed,args,lease,intent,path,sha256Utf8,classifyReturnedGmailRateLimit}) {
  const bad=()=>fail('CONTACT_CHECKPOINT_RETAINED_REJECTION_INVALID');
  if (history?.schema!==HISTORY || !hex(history.sha256) || !plain(history.body)) bad();
  const b=history.body;
  if (hash(sha256Utf8,canonical(b)).sha256!==history.sha256 ||
      b.input_sha256!==hash(sha256Utf8,JSON.stringify(reviewed)).sha256 ||
      b.operation_lease!==lease || b.intent_branch!==intent.branch || b.recipient_claim_path!==path ||
      canonical(b.input)!==canonical(reviewed) || canonical(b.args)!==canonical(args) ||
      !iso(b.received_at) || b.retained_send_invocations!==1 ||
      !hex(b.missing_journal_sha256) || !Number.isSafeInteger(b.missing_event_count) ||
      b.missing_event_count<1 || !git(b.intent_ref_sha)) bad();
  const source=b.account_source, claim=b.recipient_source;
  if (source?.repository!==REPOSITORY || source.path!=='state/gmail-account.json' ||
      !git(source.commit) || !git(source.blob_sha) || typeof source.content!=='string' ||
      hash(sha256Utf8,source.content).sha256!==source.sha256 ||
      claim?.repository!=='woahwhattheheck/commons' || claim.path!==path ||
      !git(claim.blob_sha) || typeof claim.content!=='string' ||
      hash(sha256Utf8,claim.content).sha256!==claim.sha256) bad();
  const state=parse(source.content), record=parse(claim.content), proof=state.deadline_source;
  const account=b.account;
  if (!account || account.link_id!==reviewed.link_id ||
      (args.from_address !== undefined && account.email!==args.from_address) ||
      !/^\d+$/.test(account.id) || args.link_id!==account.link_id ||
      state.schema!=='commons.gmail-account-admission/v1' || state.provider!=='gmail' ||
      state.profile_id!==account.id || state.activity!=='Mail sending' ||
      state.account_key!==hash(sha256Utf8,{provider:'gmail',profile_id:account.id,activity:'Mail sending'}).sha256 ||
      !Number.isSafeInteger(state.revision) || state.revision<1 ||
      !iso(state.updated_at) || !iso(proof?.observed_at) || proof.profile_id!==account.id ||
      proof.operation_key!==hash(sha256Utf8,{input_sha256:b.input_sha256,lease}).sha256 ||
      proof.invocation_sha256!==hash(sha256Utf8,JSON.stringify(args)).sha256 ||
      proof.return_sha256!==hash(sha256Utf8,JSON.stringify(proof.raw)).sha256) bad();
  const classified=classifyReturnedGmailRateLimit(proof.raw, proof.observed_at);
  if (!classified || classified.retry_after!==state.not_before ||
      Date.parse(classified.retry_after)<Date.parse(proof.observed_at) ||
      Date.parse(proof.observed_at)>Date.parse(b.received_at) ||
      record.protocol!=='commons-first-contact-v1' || record.status!=='reserved' ||
      record.case!==reviewed.opportunity_id || record.lease!==lease ||
      !iso(record.reserved_at) || !iso(record.send_expires_at) ||
      Date.parse(record.reserved_at)>Date.parse(proof.observed_at) ||
      Date.parse(record.send_expires_at)<Date.parse(proof.observed_at) ||
      record.gmail_rate_retry!==undefined || record.provider_message_id!==undefined) bad();
  if (classified.provider_service==='connector') {
    const legacy=proof.binding===undefined && proof.scope===undefined &&
      proof.source_account===undefined;
    const binding=args.draft_id ? 'mcp__codex_apps__gmail_send_draft' : 'mcp__codex_apps__gmail_send_email';
    if (classified.scope?.binding!==binding || legacy && args.draft_id || !legacy &&
        (proof.binding!==binding ||
         canonical(proof.scope)!==canonical(classified.scope) ||
         proof.source_account?.id!==account.id ||
         proof.source_account.email!==account.email ||
         proof.source_account.link_id!==account.link_id)) bad();
  } else if (proof.binding!==undefined || proof.scope!==undefined ||
      proof.source_account!==undefined) bad();
  const proofBody={schema:'commons.contact-received-rate-rejection/v1',
    input_sha256:b.input_sha256,lease,args,raw:proof.raw,returned_at:proof.observed_at,
    account_source:{repository:source.repository,commit:source.commit,path:source.path,blob_sha:source.blob_sha},
    invocation_sha256:proof.invocation_sha256,return_sha256:proof.return_sha256};
  const proofSha=hash(sha256Utf8,canonical(proofBody)).sha256;
  const rejected={...classified,invocation_event:null,returned_event:null,invocation_retry_id:null,
    ...(classified.provider_service==='connector'
      ? {source_account:{id:account.id,email:account.email,link_id:account.link_id}} : {}),
    proof_sha256:proofSha,source:'RETAINED_ACCOUNT_ADMISSION_RETURN',
    returned_at:proof.observed_at,checkpoint_history_sha256:history.sha256};
  return {
    count:1,history_sha256:history.sha256,rejected:[rejected],
    plan:{schema:'commons.gmail-rate-continuation/v1',input_sha256:b.input_sha256,
      case_id:reviewed.opportunity_id,intent_branch:intent.branch,intent_ref_sha:b.intent_ref_sha,
      recipient_claim_path:path,lease,intent_readback_event:null,recipient_readback_event:null,
      rejected_invocations:1,rejected:[rejected],proof_sha256:proofSha,previous_retry_id:null,
      retry_id:hash(sha256Utf8,'commons.gmail-rate-continuation/v1\0'+proofSha).sha256,
      retry_after:classified.retry_after,provider_eligible:Date.now()>=Date.parse(classified.retry_after),
      received_history_sha256:history.sha256}
  };
}

function chunks(text) {
  const result=[];
  for (let offset=0;offset<text.length;) {
    let end=Math.min(offset+CHUNK_CHARS,text.length);
    if (end<text.length && /[\uD800-\uDBFF]/.test(text[end-1])) end--;
    result.push(text.slice(offset,end));offset=end;
  }
  return result;
}

/**
 * Keep complete JSON while anchoring immutable groups to original record indices.
 * A new event never moves every later transport through a fixed-position stream.
 * Readers still concatenate ordinary v1 chunks; no alternate pointer is created.
 */
function payloadChunks(text) {
  const value=parse(text),result=[];
  const add=part=>{for(const piece of chunks(part))result.push(piece);};
  function array(prefix,rows,pageSize) {
    if(!rows.length){add(prefix+'[]');return;}
    for(let offset=0;offset<rows.length;offset+=pageSize) {
      const page=rows.slice(offset,offset+pageSize).map(row=>JSON.stringify(row)).join(',');
      add((offset===0?prefix+'[':',')+page);
    }
    add(']');
  }
  const root=Object.entries(value);
  for(let index=0;index<root.length;index++) {
    const [key,row]=root[index],prefix=(index?',':'{')+JSON.stringify(key)+':';
    if(key==='journal'&&plain(row)) {
      const members=Object.entries(row);
      if(!members.length){add(prefix+'{}');continue;}
      for(let item=0;item<members.length;item++) {
        const [name,entry]=members[item];
        const lead=(item?',':prefix+'{')+JSON.stringify(name)+':';
        if(name==='events'&&Array.isArray(entry))array(lead,entry,8);
        else add(lead+JSON.stringify(entry));
      }
      add('}');
    } else if(key==='transports'&&Array.isArray(row))array(prefix,row,1);
    else add(prefix+JSON.stringify(row));
  }
  add(root.length?'}':'{}');
  if(result.join('')!==text)fail('CONTACT_CHECKPOINT_SERIALIZATION_CHANGED');
  return result;
}

/** Immutable payload I/O is independent; settle every admitted call before return. */
async function mapChunks(rows,work) {
  const result=new Array(rows.length);let next=0,failed=false;
  const worker=async()=>{
    while(!failed&&next<rows.length) {
      const index=next++;
      try{result[index]=await work(rows[index],index);}
      catch(error){failed=true;throw error;}
    }
  };
  const settled=await Promise.allSettled(Array.from({length:Math.min(4,rows.length)},worker));
  const failure=settled.find(row=>row.status==='rejected');
  if(failure)throw failure.reason;
  return result;
}

/** A caller cache supplies bytes only; the fresh original pointer remains authority. */
function copyChunkCache(value,sha256Utf8) {
  const cache=new Map();
  if(value===undefined)return cache;
  if(!Array.isArray(value))fail('CONTACT_CHECKPOINT_CACHE_INVALID');
  let bytes=0;
  for(const row of value) {
    if(!plain(row)||!git(row.blob_sha)||!hex(row.sha256)||
       !Number.isSafeInteger(row.bytes)||row.bytes<1||row.bytes>CHUNK_CHARS*4||
       typeof row.content!=='string')fail('CONTACT_CHECKPOINT_CACHE_INVALID');
    const measured=hash(sha256Utf8,row.content);
    if(measured.bytes!==row.bytes||measured.sha256!==row.sha256)
      fail('CONTACT_CHECKPOINT_CACHE_CHANGED');
    const prior=cache.get(row.blob_sha);
    if(prior&&canonical(prior)!==canonical(row))fail('CONTACT_CHECKPOINT_CACHE_CHANGED');
    if(!prior) {
      bytes+=measured.bytes;if(bytes>LIMIT)fail('CONTACT_CHECKPOINT_TOO_LARGE');
      cache.set(row.blob_sha,{blob_sha:row.blob_sha,bytes:row.bytes,sha256:row.sha256,content:row.content});
    }
  }
  return cache;
}

async function readPayloadChunks(parts,call,sha256Utf8,cache) {
  if(!Array.isArray(parts)||!parts.length)fail('CONTACT_CHECKPOINT_CHUNK_INVALID');
  let bytes=0;
  for(const part of parts) {
    if(!plain(part)||!git(part.blob_sha)||!hex(part.sha256)||!Number.isSafeInteger(part.bytes)||
       part.bytes<1||part.bytes>CHUNK_CHARS*4)fail('CONTACT_CHECKPOINT_CHUNK_INVALID');
    bytes+=part.bytes;if(bytes>LIMIT)fail('CONTACT_CHECKPOINT_TOO_LARGE');
  }
  const pending=new Map();
  return await mapChunks(parts,async part=>{
    const cached=cache.get(part.blob_sha);
    if(cached&&cached.bytes===part.bytes&&cached.sha256===part.sha256)return cached;
    let request=pending.get(part.blob_sha);
    if(!request) {
      request=call('github_fetch_blob',{repository_full_name:REPOSITORY,blob_sha:part.blob_sha});
      pending.set(part.blob_sha,request);
    }
    const blob=await request,measured=hash(sha256Utf8,blob.content);
    if(measured.bytes!==part.bytes||measured.sha256!==part.sha256)
      fail('CONTACT_CHECKPOINT_CHUNK_CHANGED');
    const record={blob_sha:part.blob_sha,bytes:part.bytes,sha256:part.sha256,content:blob.content};
    cache.set(part.blob_sha,record);return record;
  });
}


/**
 * mode:'reopen' (default), 'adopt' with the complete original journal, or
 * 'receive-rejected' with an original account commit and missing-checkpoint pin,
 * 'receive-completed' with the exact successful original caller journal, or
 * 'receive-undispatched' with a pinned complete original account-acquisition snapshot, or
 * 'receive-preflight' with an exact-prefix ended recipient preflight and retained account return.
 * All public original methods remain explicit. Opening and receiving never send.
 */
/**
 * Select an original account-deferred contact after its completed Git work.
 * The same received checkpoint supplies both the reviewed input and any
 * already-created intent/recipient reservation.
 */
function readUndispatchedContactContinuation({operationKey,metadata,payload,modules}) {
  if(!hex(operationKey)||!modules?.sha256Utf8||!modules?.gateway||
     metadata?.schema!==SCHEMA||metadata.operation_key!==operationKey||metadata.active!==null||
     payload?.schema!=='commons.connected-contact-checkpoint-payload/v1'||
     !plain(payload.runtime_input)||!plain(payload.journal)||
     !Array.isArray(payload.transports)||!Array.isArray(payload.journal.events))
    fail('CONTACT_CHECKPOINT_UNDISPATCHED_CONTEXT_REQUIRED');
  const fixed=reviewedInput(payload.runtime_input,modules),journal=payload.journal;
  const digest=value=>hash(modules.sha256Utf8,value).sha256;
  if(journal.input_sha256!==fixed.identity||metadata.input_sha256!==fixed.identity||
     journal.lease!==metadata.operation_lease||
     digest(journal.input)!==fixed.identity||canonical(journal.input)!==canonical(fixed.reviewed)||
     digest({input_sha256:fixed.identity,lease:metadata.operation_lease})!==operationKey||
     journal.outcome?.status!=='ACCOUNT_DEFERRED'||journal.receipt!=null||
     journal.account_deferred?.gmail_invocations!==0||
     journal.account_deferred.input_sha256!==fixed.identity||
     journal.account_deferred.operation_lease!==metadata.operation_lease)
    fail('CONTACT_CHECKPOINT_ORIGINAL_UNDISPATCHED_REQUIRED');
  const sends=new Set(['mcp__codex_apps__gmail_send_email','mcp__codex_apps__gmail_send_draft',
    'gmail.users.messages.send']);
  for(const outer of journal.events) {
    const event=outer?.phase==='account-admission'?outer.event:outer;
    if(sends.has(event?.binding))
      fail('CONTACT_CHECKPOINT_ORIGINAL_SEND_RECONCILIATION_REQUIRED');
  }
  const gitCalls=new Set(['mcp__codex_apps__github_create_branch',
    'mcp__codex_apps__github_create_file','mcp__codex_apps__github_update_file']);
  for(const transport of payload.transports) {
    if(!plain(transport)||!gitCalls.has(transport.binding)||transport.state!=='RETURNED'||
       typeof transport.nested!=='boolean'||!Number.isSafeInteger(transport.event_index)||
       transport.event_index<0)
      fail('CONTACT_CHECKPOINT_COMPLETED_GIT_TRANSPORT_REQUIRED');
    const outer=journal.events[transport.event_index];
    const call=transport.nested?outer?.event:outer;
    if(digest({operationKey,index:transport.event_index,binding:transport.binding,args:call?.args})!==transport.id)
      fail('CONTACT_CHECKPOINT_ORIGINAL_GIT_TRANSPORT_CHANGED');
  }
  const received=clone(journal);
  receiveReturnedTransports({journal:received,transports:payload.transports,sha256Utf8:modules.sha256Utf8});
  if(canonical(received)!==canonical(journal))
    fail('CONTACT_CHECKPOINT_ORIGINAL_GIT_RETURN_RECEIVE_REQUIRED');
  let resumeReservation;
  const prepared=journal.prepared_account_reservation;
  if(prepared!==undefined) {
    if(!plain(prepared)||prepared.input_sha256!==fixed.identity||
       prepared.intent_branch!==fixed.intent.branch||prepared.recipient_claim_path!==fixed.path||
       prepared.operation_lease!==metadata.operation_lease||!git(prepared.intent_ref_sha)||
       (prepared.recipient_pending===true?prepared.lease!==undefined:prepared.lease!==metadata.operation_lease))
      fail('CONTACT_CHECKPOINT_ORIGINAL_RESERVATION_CHANGED');
    resumeReservation={intent_ref_sha:prepared.intent_ref_sha,
      ...(prepared.recipient_pending===true?{recipient_pending:true}:{lease:prepared.lease})};
  }
  return {input:clone(payload.runtime_input),resumeReservation,
    input_sha256:fixed.identity,received_git_transports:payload.transports.length};
}


/**
 * Select a durable account-acquisition interruption. This is not a Gmail
 * result: the checkpoint's next writer must first own its CAS-fenced lease,
 * then reconcile the exact retained account token through the original owner.
 */
function validateInterruptedAccountAttempt({journal,transports,operationKey,
  preparedIndex,attemptKey,location,sha256Utf8}) {
  if (!plain(journal) || !Array.isArray(journal.events) || !Array.isArray(transports) ||
      !hex(operationKey) || !Number.isSafeInteger(preparedIndex) || !hex(attemptKey) ||
      !plain(location)) fail('CONTACT_CHECKPOINT_INTERRUPTION_CONTEXT_REQUIRED');
  const prepared=journal.events[preparedIndex];
  if (prepared?.phase!=='account-attempt-prepared' ||
      prepared.operation_key!==operationKey || prepared.attempt_key!==attemptKey ||
      !iso(prepared.observed_at)) return null;
  const events=journal.events;
  if (journal.receipt || journal.native_receipt || events.some(outer=>{
    const event=outer.phase==='account-admission'?outer.event:outer;
    return /^mcp__codex_apps__gmail_send_(?:email|draft)$/.test(event?.binding || '') &&
      ['invoking','returned','failed','checkpoint-not-dispatched'].includes(event.phase);
  })) fail('CONTACT_CHECKPOINT_INTERRUPTION_HAS_PROVIDER_SEND');
  if (events.slice(preparedIndex+1).some(event=>
      ['account-attempt-prepared','account-attempt-acquired'].includes(event.phase) &&
      event.operation_key===operationKey)) return null;
  const incomplete=transports.filter(row=>row.state!=='RETURNED');
  if (incomplete.length!==1 || incomplete[0].state!=='INVOKING') return null;
  const transport=incomplete[0],index=transport.event_index;
  const outer=events[index],event=outer?.phase==='account-admission'?outer.event:null;
  const args=event?.args,local=location.storage_kind==='commons.connected-contact-local-state/v1'&&
    event?.binding==='commons.local-state.compareAndSwap';
  if (!Number.isSafeInteger(index) || index<=preparedIndex || transport.nested!==true ||
      event?.phase!=='invoking' || !iso(event.observed_at) ||
      (!local&&event.binding!=='mcp__codex_apps__github_update_file')||
      transport.binding!==event.binding||!plain(args)||
      (local?args.namespace!=='account'||args.key!==location.account_key||!hex(args.expected_sha256)||
        typeof args.operation_id!=='string':
        args.repository_full_name!==location.repository||args.branch!==location.branch||args.path!==location.path||!git(args.sha))||
      typeof args.content!=='string'||
      transport.id!==hash(sha256Utf8,{operationKey,index,binding:event.binding,args}).sha256 ||
      transport.args_sha256!==hash(sha256Utf8,JSON.stringify(args)).sha256)
    fail('CONTACT_CHECKPOINT_INTERRUPTION_TRANSPORT_CHANGED');
  if (events.slice(index+1).some(item=>item.phase==='account-admission' &&
      item.event?.call_id===event.call_id && ['returned','failed'].includes(item.event.phase)))
    fail('CONTACT_CHECKPOINT_INTERRUPTION_ALREADY_RETURNED');
  const postimage=parse(args.content),accountLease=postimage.active;
  if (!['commons.gmail-account-admission/v1','commons.gmail-account-admission/v2'].includes(postimage.schema) ||
      postimage.account_key!==location.account_key || postimage.provider!=='gmail' ||
      postimage.activity!=='Mail sending' || !Number.isSafeInteger(postimage.revision) ||
      postimage.revision<1 || !plain(accountLease) ||
      accountLease.operation_key!==operationKey || accountLease.attempt_key!==attemptKey ||
      !hex(accountLease.token) || !iso(accountLease.acquired_at) || !iso(accountLease.expires_at) ||
      Date.parse(accountLease.expires_at)-Date.parse(accountLease.acquired_at)!==LEASE_MS)
    fail('CONTACT_CHECKPOINT_INTERRUPTION_ACCOUNT_CHANGED');
  // After the interrupted write only completed read-only observations can
  // follow. A second mutation belongs to its own original receiving operation.
  const readonly=/^mcp__codex_apps__(?:github_(?:fetch(?:_file|_blob|_commit)?|get_(?:profile|user_login|repo)|compare_commits)|gmail_(?:get_profile|search_email_ids|search_emails|read_email|read_thread|read_attachment))$/;
  const pending=new Map();
  for (let at=index+1;at<events.length;at++) {
    const item=events[at],nested=item.phase==='account-admission',row=nested?item.event:item;
    if (!row || !['invoking','returned','failed'].includes(row.phase) ||
        !(readonly.test(row.binding||'')||local&&/^commons\.local-state\.(read|history|verify)$/.test(row.binding||''))||!iso(item.observed_at))
      fail('CONTACT_CHECKPOINT_INTERRUPTION_LATER_OPERATION');
    const key=(nested?'account:':'contact:')+(row.call_id || row.binding);
    if(row.phase==='invoking') {
      if(pending.has(key))fail('CONTACT_CHECKPOINT_INTERRUPTION_READ_PENDING');
      pending.set(key,row);
    } else {
      if(!pending.has(key))fail('CONTACT_CHECKPOINT_INTERRUPTION_READ_CHANGED');
      pending.delete(key);
    }
  }
  if(pending.size)fail('CONTACT_CHECKPOINT_INTERRUPTION_READ_PENDING');
  return {schema:'commons.contact-checkpoint-account-interruption/v1',
    operation_key:operationKey,input_sha256:journal.input_sha256,operation_lease:journal.lease,
    attempt_key:attemptKey,prepared_event:preparedIndex,account_write_event:index,
    transport_id:transport.id,original_event_count:events.length,
    original_journal_sha256:hash(sha256Utf8,JSON.stringify(journal)).sha256,
    original_snapshot_sha256:hash(sha256Utf8,JSON.stringify({journal,transports})).sha256,
    postimage_sha256:hash(sha256Utf8,args.content).sha256,
    account_lease:clone(accountLease),gmail_invocations:0};
}

/**
 * Validate a returned-rejection draft successor using the original sender's
 * complete pure history validator. No provider or account action is invoked.
 */
function validateReturnedDraftRevision({source,record,modules,factory,tools}) {
  if(!plain(source)||source.schema!=='commons.connected-contact-checkpoint-payload/v1'||
     !plain(source.runtime_input)||!plain(source.journal)||!Array.isArray(source.transports)||
     !plain(record)||record.schema!=='commons.contact-checkpoint-reviewed-input-revision/v1'||
     !plain(record.runtime_input)||!plain(record.journal)||!hex(record.selection_id))
    fail('CONTACT_CHECKPOINT_INPUT_REVISION_INVALID');
  const before=reviewedInput(source.runtime_input,modules),after=reviewedInput(record.runtime_input,modules);
  const old=source.journal,next=record.journal,digest=value=>hash(modules.sha256Utf8,value).sha256;
  const mutable=new Set(['subject','body','body_type','native_arguments','attachments','attachment_data','document_archives']);
  const retained=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!mutable.has(key)));
  if(before.identity===after.identity||record.previous_input_sha256!==before.identity||
     record.input_sha256!==after.identity||record.operation_lease!==old.lease||
     old.input_sha256!==before.identity||canonical(old.input)!==canonical(before.reviewed)||
     next.schema!=='commons.connected-first-contact/v1'||next.input_sha256!==after.identity||
     next.lease!==old.lease||canonical(next.input)!==canonical(after.reviewed)||
     canonical(next.runtime_input)!==canonical(record.runtime_input)||
     canonical(retained(source.runtime_input))!==canonical(retained(record.runtime_input))||
     before.account.id!==after.account.id||before.path!==after.path||before.intent.branch!==after.intent.branch||
     old.receipt||old.native_receipt||next.receipt||next.native_receipt||
     source.runtime_input.native_draft||record.runtime_input.native_draft||
     old.recovered_rate_history||next.recovered_rate_history||
     !Array.isArray(old.events)||!Array.isArray(next.events)||next.events.length!==old.events.length+1||
     old.events.some((row,i)=>canonical(row)!==canonical(next.events[i])))
    fail('CONTACT_CHECKPOINT_INPUT_REVISION_CHANGED');
  const selected=next.returned_mailbox_revision,event=next.events.at(-1);
  if(selected?.schema!=='commons.returned-rate-input-revision/v1'||selected.revision_kind!=='draft'||
     selected.selection_id!==record.selection_id||selected.previous_input_sha256!==before.identity||
     selected.input_sha256!==after.identity||selected.operation_lease!==old.lease||
     event?.phase!=='returned-rate-input-selected'||canonical(event.selection)!==canonical(selected)||
     typeof selected.reason!=='string'||!selected.reason.trim()||
     next.outcome?.status!=='DRAFT_REVISED_AFTER_REJECTION')
    fail('CONTACT_CHECKPOINT_INPUT_REVISION_SELECTION_CHANGED');
  const oldKey=digest({input_sha256:before.identity,lease:old.lease});
  for(const t of source.transports) {
    const outer=old.events[t.event_index],call=t.nested?outer?.event:outer;
    if(!plain(t)||typeof t.nested!=='boolean'||!Number.isSafeInteger(t.event_index)||
       !call||call.binding!==t.binding||digest({operationKey:oldKey,index:t.event_index,binding:t.binding,args:call.args})!==t.id||
       digest(JSON.stringify(call.args))!==t.args_sha256)
      fail('CONTACT_CHECKPOINT_INPUT_REVISION_TRANSPORT_CHANGED');
    if(t.state==='RETURNED'&&(!iso(t.returned_at)||digest(JSON.stringify(t.raw))!==t.return_sha256))
      fail('CONTACT_CHECKPOINT_INPUT_REVISION_RETURN_CHANGED');
  }
  const pure=(input,journal)=>{
    let value=clone(journal);
    const handle=factory.createConnectedFirstContact({tools,modules,input,
      lease:journal.lease,stateKey:'retained-input-revision-validation',
      load:()=>value,store:(key,row)=>{value=row;}});
    return handle.rateLimitContinuation();
  };
  const priorPlan=pure(source.runtime_input,old),nextPlan=pure(record.runtime_input,next);
  if(!priorPlan.rejected_invocations||selected.previous_rate_plan.proof_sha256!==priorPlan.proof_sha256||
     canonical(selected.previous_rate_plan.rejected)!==canonical(priorPlan.rejected)||
     nextPlan.input_sha256!==after.identity||nextPlan.lease!==old.lease||
     nextPlan.intent_branch!==before.intent.branch||nextPlan.recipient_claim_path!==before.path||
     nextPlan.proof_sha256!==priorPlan.proof_sha256||nextPlan.rejected_invocations!==0||
     nextPlan.historical_rejected_invocations!==selected.closed_calls.length||
     Date.parse(nextPlan.retry_after)<Date.parse(priorPlan.retry_after))
    fail('CONTACT_CHECKPOINT_INPUT_REVISION_HISTORY_CHANGED');
  return {input_sha256:after.identity,operation_key:digest({input_sha256:after.identity,lease:old.lease}),
    selection_id:record.selection_id,provider_retry_after:nextPlan.retry_after};
}

function validateContactSourceActivation(record,{journal,stateKey,lease,operationKey,sha256Utf8,current=false}) {
  const bad=()=>fail('CONTACT_CHECKPOINT_SOURCE_ACTIVATION_CHANGED');
  if(!plain(record)||record.schema!=='commons.connected-contact-source-activation/v1'||
     typeof record.selection_json!=='string'||!hex(record.selection_sha256)||
     !Number.isSafeInteger(record.selection_bytes)||record.selection_bytes<2||record.selection_bytes>64*1024*1024||
     record.input_sha256!==journal.input_sha256||record.lease!==lease||record.state_key!==stateKey||
     record.operation_key!==operationKey||!hex(record.journal_sha256)||
     !Number.isSafeInteger(record.journal_bytes)||record.journal_bytes<2||
     !Number.isSafeInteger(record.event_count)||record.event_count<0||record.event_count>journal.events.length||
     !hex(record.events_sha256)||!hex(record.context_sha256)||!hex(record.plan_sha256)||
     !hex(record.active_sha256)||!git(record.source_commit))bad();
  const measured=hash(sha256Utf8,record.selection_json);
  if(measured.sha256!==record.selection_sha256||measured.bytes!==record.selection_bytes||
     hash(sha256Utf8,JSON.stringify(journal.events.slice(0,record.event_count))).sha256!==record.events_sha256)bad();
  if(current) {
    const actual=hash(sha256Utf8,JSON.stringify(journal));
    if(actual.sha256!==record.journal_sha256||actual.bytes!==record.journal_bytes||
       record.event_count!==journal.events.length)bad();
  }
  const selection=parse(record.selection_json);
  if(selection.schema!=='commons.connected-contact-source-selection/v1'||
     selection.context_sha256!==record.context_sha256||selection.active_sha256!==record.active_sha256||
     !Array.isArray(selection.sources)||!Array.isArray(selection.activations)||
     !Number.isSafeInteger(selection.revision)||selection.revision<1||
     selection.activations.length!==selection.revision)bad();
  const rows=new Map();
  for(const row of selection.sources) {
    if(!plain(row)||!hex(row.sha256)||rows.has(row.sha256)||typeof row.raw!=='string'||
       !Number.isSafeInteger(row.bytes)||row.bytes<2||row.bytes>16*1024*1024)bad();
    const actual=hash(sha256Utf8,row.raw);
    if(actual.sha256!==row.sha256||actual.bytes!==row.bytes)bad();
    rows.set(row.sha256,row);
  }
  let prior=null;
  for(let i=0;i<selection.activations.length;i++) {
    const row=selection.activations[i];
    if(!plain(row)||row.revision!==i+1||!rows.has(row.previous_sha256)||!rows.has(row.selected_sha256)||
       i>0&&row.previous_sha256!==prior||!hex(row.proof_sha256)||!hex(row.journal_sha256)||
       !Number.isSafeInteger(row.journal_bytes)||row.journal_bytes<2||
       !Number.isSafeInteger(row.event_count)||row.event_count<0)bad();
    prior=row.selected_sha256;
  }
  if(prior!==record.active_sha256||parse(rows.get(prior).raw).source_commit!==record.source_commit)bad();
  return selection;
}

function originalSessionRevision({origin,runtimeInput,journal,stateKey,lease,operationKey,modules,factory,tools}) {
  if(!plain(origin)||origin.kind!=='original-session-journal-readback'||
     origin.operation_key!==operationKey||origin.state_key!==stateKey||origin.operation_lease!==lease||
     typeof origin.runtime_input_content!=='string'||typeof origin.journal_content!=='string'||
     !plain(origin.source)||!iso(origin.observed_at))
    fail('CONTACT_SESSION_ORIGINAL_SOURCE_REQUIRED');
  const originalInput=parse(origin.runtime_input_content),originalJournal=parse(origin.journal_content);
  const measuredInput=hash(modules.sha256Utf8,origin.runtime_input_content),measuredJournal=hash(modules.sha256Utf8,origin.journal_content);
  if(canonical(origin.runtime_input)!==canonical(measuredInput)||canonical(origin.journal)!==canonical(measuredJournal)||
     canonical(originalInput)!==canonical(runtimeInput)||originalJournal.input_sha256!==origin.input_sha256||
     originalJournal.lease!==lease||!Array.isArray(originalJournal.events)||!Array.isArray(journal.events)||
     journal.events.length<originalJournal.events.length||
     originalJournal.events.some((row,i)=>canonical(row)!==canonical(journal.events[i]))||
     canonical(journal.returned_mailbox_revision??null)!==canonical(originalJournal.returned_mailbox_revision??null)||
     canonical(journal.input_revisions??null)!==canonical(originalJournal.input_revisions??null))
    fail('CONTACT_SESSION_ORIGINAL_SOURCE_CHANGED');
  const memory=new Map([[stateKey,clone(originalJournal)]]);
  const original=factory.createConnectedFirstContact({tools,input:originalInput,modules,lease,stateKey,
    load:key=>memory.get(key),store:(key,value)=>memory.set(key,value)});
  if(typeof original.validateOriginalJournalRevision!=='function')
    fail('CONTACT_SESSION_ORIGINAL_VALIDATOR_REQUIRED');
  const selected=original.validateOriginalJournalRevision();
  if(canonical(memory.get(stateKey))!==canonical(originalJournal))
    fail('CONTACT_SESSION_ORIGINAL_JOURNAL_CHANGED');
  return selected?.revision_kind==='draft'?{
    schema:'commons.contact-checkpoint-session-input-revision-source/v1',
    operation_key:operationKey,input_sha256:origin.input_sha256,operation_lease:lease,state_key:stateKey,
    source:clone(origin.source),runtime_input:measuredInput,journal:measuredJournal,
    original_event_count:originalJournal.events.length,selection_sha256:hash(modules.sha256Utf8,canonical(selected)).sha256
  }:null;
}

async function openConnectedContactCheckpoint(options) {
  const {tools,factory,modules,input,lease,stateKey,owner,beforeSend,beforeNativeSend,organizationQuery,organizationDomains,githubActorAction,githubRefAction,
    mode='reopen',journal:providedJournal,snapshot:providedSnapshot,recovery,chunkCache:providedChunkCache,storage,originalSessionSource}=options || {};
  if(storage&&(storage.kind!=='commons.connected-contact-local-state/v1'||typeof storage.read!=='function'||typeof storage.compareAndSwap!=='function'))fail('CONTACT_LOCAL_STORAGE_REQUIRED');
  if (!factory?.createConnectedFirstContact || !factory?.classifyReturnedGmailRateLimit ||
      !modules?.gateway || !modules?.intent || !modules?.sha256Utf8 ||
      typeof stateKey!=='string' || !stateKey || typeof lease!=='string' || !lease ||
      typeof owner!=='string' || !owner || owner.length>240)
    fail('CONTACT_CHECKPOINT_ORIGINAL_CONTEXT_REQUIRED');
  if (githubActorAction !== undefined) {
    if (typeof factory.selectConnectedGitActor !== 'function')
      fail('CONTACT_CHECKPOINT_ACTOR_SELECTION_REQUIRES_CURRENT_FACTORY');
    factory.selectConnectedGitActor(tools,githubActorAction);
  }
  if (githubRefAction !== undefined) {
    if (typeof factory.selectConnectedGitRef !== 'function')
      fail('CONTACT_CHECKPOINT_REF_SELECTION_REQUIRES_CURRENT_FACTORY');
    factory.selectConnectedGitRef(tools,githubRefAction);
  }
  const fixed=reviewedInput(input,modules),digest=value=>hash(modules.sha256Utf8,value).sha256;
  const suppliedChunks=copyChunkCache(providedChunkCache,modules.sha256Utf8);
  const operationKey=digest({input_sha256:fixed.identity,lease});
  const branch='contact-checkpoint/v1/'+operationKey;
  const readers=checkpointGitReaders(tools,githubRefAction);
  const required=[readers.refAction,readers.repositoryAction,'github_fetch_file','github_fetch_blob'];
  for (const name of required) if (typeof tools?.['mcp__codex_apps__'+name]!=='function')
    fail('CONTACT_CHECKPOINT_BINDING_REQUIRED',name);
  const call=async(name,args)=>{
    const raw=await tools['mcp__codex_apps__'+name](args);
    const value=sourceContent(raw);
    return name==='github_fetch' ? parse(value.content) : value;
  };
  if(storage)await storage.verify();else await readers.repository(call);
  // The branch head is read on every current() call. Only complete bytes at the
  // same immutable commit can be reused; callers receive a fresh parsed object.
  let lastPointerFile=null;
  async function fileAt(ref) {
    if(git(ref) && lastPointerFile?.ref===ref) {
      const cached=lastPointerFile;
      return {sha:cached.sha,text:cached.text,value:parse(cached.text)};
    }
    const value=await call('github_fetch_file',{repository_full_name:REPOSITORY,path:PATH,ref,encoding:'utf-8'});
    if (!git(value.sha) || typeof value.content!=='string') fail('CONTACT_CHECKPOINT_COMPLETE_FILE_REQUIRED');
    const parsed=parse(value.content);
    if(git(ref))lastPointerFile={ref,sha:value.sha,text:value.content};
    return {sha:value.sha,text:value.content,value:parsed};
  }
  function validateRoot(value) {
    if (value?.schema!==SCHEMA || value.operation_key!==operationKey ||
        value.input_sha256!==fixed.identity || value.operation_lease!==lease ||
        value.state_key!==stateKey || !Number.isSafeInteger(value.revision) || value.revision<1 ||
        !iso(value.updated_at) || !plain(value.payload) || !hex(value.payload.sha256) ||
        !Number.isSafeInteger(value.payload.bytes) || value.payload.bytes<2 || value.payload.bytes>LIMIT ||
        !Array.isArray(value.payload.chunks) || !value.payload.chunks.length)
      fail('CONTACT_CHECKPOINT_IDENTITY_CHANGED');
    if (value.active!==null && (!plain(value.active) || !hex(value.active.token) ||
        typeof value.active.owner!=='string' || !iso(value.active.acquired_at) ||
        !iso(value.active.expires_at) || Date.parse(value.active.expires_at)-Date.parse(value.active.acquired_at)!==LEASE_MS))
      fail('CONTACT_CHECKPOINT_LEASE_INVALID');
    return value;
  }
  async function current() {
    if(storage){
      const selected=await storage.read({namespace:'checkpoint',key:operationKey});
      if(!selected)return null;
      if(selected.kind!=='commons.connected-contact-local-snapshot/v1'||selected.coordinator_id!==storage.coordinatorId||
         selected.namespace!=='checkpoint'||selected.key!==operationKey||digest(selected.content)!==selected.sha256)
        fail('CONTACT_LOCAL_CHECKPOINT_CHANGED');
      const body=parse(selected.content),value=validateRoot(body.metadata);
      if(typeof body.payload_text!=='string'||hash(modules.sha256Utf8,body.payload_text).sha256!==value.payload.sha256||
         hash(modules.sha256Utf8,body.payload_text).bytes!==value.payload.bytes)
        fail('CONTACT_CHECKPOINT_PAYLOAD_CHANGED');
      return {sha:selected.sha256,commit:null,text:selected.content,value,local:selected,
        local_payload:parse(body.payload_text),original_location:body.original_location||null};
    }
    let commit;
    try {commit=await readers.head(call,branch);}
    catch(error){if(readers.absentHead(error,branch))return null;throw error;}
    try {const file=await fileAt(commit);return {...file,commit,value:validateRoot(file.value)};}
    catch(error){if(error.status===404)return {empty:true,commit};throw error;}
  }
  function checkpointIdentity(row){
    if(!row||row.empty)return null;
    return storage?{kind:'commons.connected-contact-local-checkpoint/v1',
      coordinator_id:storage.coordinatorId,operation_key:operationKey,sha256:row.sha,
      storage_receipt:clone(row.local.receipt),original_location:clone(row.original_location),
      revision:row.value.revision,payload_sha256:row.value.payload.sha256}:
      {commit:row.commit,blob_sha:row.sha,revision:row.value.revision,payload_sha256:row.value.payload.sha256};
  }
  let remote=await current(), state, savedRevision=0, token=null, active=null, pendingPointer=null;
  const blobCache=new Map();
  async function hydrate(row) {
    if(storage)return clone(row.local_payload);
    const records=await readPayloadChunks(row.value.payload.chunks,call,modules.sha256Utf8,suppliedChunks);
    const text=records.map(part=>part.content).join('');
    const measured=hash(modules.sha256Utf8,text);
    if(measured.bytes!==row.value.payload.bytes||measured.sha256!==row.value.payload.sha256)
      fail('CONTACT_CHECKPOINT_PAYLOAD_CHANGED');
    for(const part of records)blobCache.set(part.sha256,part.blob_sha);
    return parse(text);
  }
  async function verifyHistory(history) {
    const h=validateReceivedRateHistory({history,reviewed:fixed.reviewed,args:fixed.args,
      lease,intent:fixed.intent,path:fixed.path,sha256Utf8:modules.sha256Utf8,
      classifyReturnedGmailRateLimit:factory.classifyReturnedSendRateLimit || factory.classifyReturnedGmailRateLimit});
    const s=history.body.account_source;
    const observed=await call('github_fetch_file',{repository_full_name:REPOSITORY,
      path:s.path,ref:s.commit,encoding:'utf-8'});
    if (observed.sha!==s.blob_sha || observed.content!==s.content)
      fail('CONTACT_CHECKPOINT_ORIGINAL_SOURCE_CHANGED');
    return h;
  }
  function validateState(value) {
    const j=value?.journal;
    if(value?.schema!=='commons.connected-contact-checkpoint-payload/v1' ||
       !j || j.schema!=='commons.connected-first-contact/v1' || j.input_sha256!==fixed.identity ||
       j.lease!==lease || canonical(j.input)!==canonical(fixed.reviewed) || !Array.isArray(j.events) ||
       !Array.isArray(value.transports) || canonical(value.runtime_input)!==canonical(input)) fail('CONTACT_CHECKPOINT_JOURNAL_CHANGED');
    if(value.reviewed_input_revision)
      validateReturnedDraftRevision({source:value,record:value.reviewed_input_revision,modules,factory,tools});
    if(value.input_revision_source) {
      const origin=value.input_revision_source,record=origin.payload?.reviewed_input_revision;
      if(origin.schema!=='commons.contact-checkpoint-revised-input-source/v1'||!plain(origin.location)||
         !plain(origin.metadata)||origin.metadata.active!==null||
         !(storage&&origin.location.kind==='commons.connected-contact-local-checkpoint/v1'?
           origin.location.coordinator_id===storage.coordinatorId&&hex(origin.location.sha256)&&
           origin.location.storage_receipt?.coordinator_id===storage.coordinatorId&&
           origin.location.storage_receipt.namespace==='checkpoint'&&
           origin.location.storage_receipt.key===origin.metadata.operation_key&&
           origin.location.storage_receipt.sha256===origin.location.sha256:
           git(origin.location.commit)&&git(origin.location.blob_sha)&&
           origin.location.repository===REPOSITORY&&origin.location.path===PATH&&
           origin.location.branch==='contact-checkpoint/v1/'+origin.metadata.operation_key)||
         !hex(origin.metadata.operation_key)||
         origin.metadata.schema!==SCHEMA||!Number.isSafeInteger(origin.metadata.revision)||
         origin.metadata.revision<1||!iso(origin.metadata.updated_at)||!plain(origin.metadata.payload)||
         !hex(origin.metadata.payload.sha256)||!Number.isSafeInteger(origin.metadata.payload.bytes)||
         origin.metadata.payload.bytes<2||origin.metadata.payload.bytes>LIMIT||
         !Array.isArray(origin.metadata.payload.chunks)||!origin.metadata.payload.chunks.length)
        fail('CONTACT_CHECKPOINT_INPUT_REVISION_SOURCE_CHANGED');
      const originalBytes=hash(modules.sha256Utf8,serializeCheckpointPayload(origin.payload));
      if(originalBytes.sha256!==origin.metadata.payload.sha256||originalBytes.bytes!==origin.metadata.payload.bytes)
        fail('CONTACT_CHECKPOINT_INPUT_REVISION_SOURCE_CHANGED');
      const received=validateReturnedDraftRevision({source:origin.payload,record,modules,factory,tools});
      if(received.input_sha256!==fixed.identity||received.operation_key!==operationKey||
         origin.metadata.input_sha256!==record.previous_input_sha256||
         origin.metadata.operation_lease!==lease||origin.metadata.state_key!==stateKey||
         hash(modules.sha256Utf8,{input_sha256:record.previous_input_sha256,lease}).sha256!==origin.metadata.operation_key||
         j.events.length<record.journal.events.length||
         record.journal.events.some((row,i)=>canonical(row)!==canonical(j.events[i]))||
         value.transports.some(t=>t.event_index<record.journal.events.length))
        fail('CONTACT_CHECKPOINT_INPUT_REVISION_SOURCE_CHANGED');
    }
    if(value.session_input_revision_source){
      const origin=remote?.local?.receipt?.origin||(mode==='adopt'?originalSessionSource:null);
      const expected=originalSessionRevision({origin,runtimeInput:value.runtime_input,journal:j,
        stateKey,lease,operationKey,modules,factory,tools});
      if(!expected||canonical(expected)!==canonical(value.session_input_revision_source))
        fail('CONTACT_CHECKPOINT_SESSION_REVISION_SOURCE_CHANGED');
    }
    if(j.returned_mailbox_revision?.revision_kind==='draft'&&!value.input_revision_source&&!value.session_input_revision_source)
      fail('CONTACT_CHECKPOINT_INPUT_REVISION_SOURCE_REQUIRED');
    if(j.recovered_rate_history) validateReceivedRateHistory({history:j.recovered_rate_history,
      reviewed:fixed.reviewed,args:fixed.args,lease,intent:fixed.intent,path:fixed.path,
      sha256Utf8:modules.sha256Utf8,classifyReturnedGmailRateLimit:factory.classifyReturnedSendRateLimit || factory.classifyReturnedGmailRateLimit});
    if(value.contact_source_activation)validateContactSourceActivation(value.contact_source_activation,
      {journal:j,stateKey,lease,operationKey,sha256Utf8:modules.sha256Utf8});
    return value;
  }
  async function verifyInputRevisionSource(value) {
    const seen=new Set();
    for(let cursor=value;cursor.input_revision_source;cursor=cursor.input_revision_source.payload) {
      const origin=cursor.input_revision_source,key=origin.location.kind==='commons.connected-contact-local-checkpoint/v1'?
        origin.location.coordinator_id+':'+origin.location.storage_receipt.key+':'+origin.location.storage_receipt.revision:
        origin.location.commit;
      if(seen.has(key))fail('CONTACT_CHECKPOINT_INPUT_REVISION_SOURCE_CYCLE');
      seen.add(key);
      if(origin.location.kind==='commons.connected-contact-local-checkpoint/v1'){
        if(!storage||origin.location.coordinator_id!==storage.coordinatorId||typeof storage.history!=='function')
          fail('CONTACT_CHECKPOINT_INPUT_REVISION_SOURCE_CHANGED');
        const receipt=origin.location.storage_receipt;
        const page=await storage.history({namespace:'checkpoint',key:receipt.key,after_revision:receipt.revision-1,limit:1});
        const observed=page.records?.[0],body=observed?parse(observed.content):null;
        if(!observed||canonical(observed.receipt)!==canonical(receipt)||observed.sha256!==origin.location.sha256||
           canonical(body.metadata)!==canonical(origin.metadata)||canonical(parse(body.payload_text))!==canonical(origin.payload))
          fail('CONTACT_CHECKPOINT_INPUT_REVISION_SOURCE_CHANGED');
      }else{
        const observed=await call('github_fetch_file',{repository_full_name:REPOSITORY,path:PATH,ref:key,encoding:'utf-8'});
        if(observed.sha!==origin.location.blob_sha||canonical(parse(observed.content))!==canonical(origin.metadata))
          fail('CONTACT_CHECKPOINT_INPUT_REVISION_SOURCE_CHANGED');
      }
      const originalBytes=hash(modules.sha256Utf8,serializeCheckpointPayload(origin.payload));
      if(originalBytes.sha256!==origin.metadata.payload.sha256||originalBytes.bytes!==origin.metadata.payload.bytes)
        fail('CONTACT_CHECKPOINT_INPUT_REVISION_SOURCE_CHANGED');
    }
  }
  async function receiveRejected() {
    if (!git(recovery?.account_commit) || !git(recovery.expected_account_blob_sha) ||
        !hex(recovery.missing_journal_sha256) || !Number.isSafeInteger(recovery.missing_event_count) ||
        recovery.missing_event_count<1 || recovery.expected_input_sha256!==fixed.identity ||
        !git(recovery.expected_recipient_blob_sha)) fail('CONTACT_CHECKPOINT_RECOVERY_SELECTION_REQUIRED');
    const accountKey=digest({provider:'gmail',profile_id:fixed.account.id,activity:'Mail sending'});
    const accountBranch='mailbox-admission/v1/'+accountKey;
    const accountHead=await readers.head(call,accountBranch);
    const comparison=await readers.compare(call,recovery.account_commit,accountHead);
    if (!['ahead','identical'].includes(comparison.status) ||
        comparison.merge_base_commit?.sha!==recovery.account_commit)
      fail('CONTACT_CHECKPOINT_ACCOUNT_SOURCE_NOT_RETAINED');
    const accountFile=await call('github_fetch_file',{repository_full_name:REPOSITORY,
      path:'state/gmail-account.json',ref:recovery.account_commit,encoding:'utf-8'});
    if(accountFile.sha!==recovery.expected_account_blob_sha)fail('CONTACT_CHECKPOINT_ACCOUNT_SOURCE_CHANGED');
    const intentHead=await readers.head(call,fixed.intent.branch,'woahwhattheheck/commons');
    const claim=await call('github_fetch_file',{repository_full_name:'woahwhattheheck/commons',
      path:fixed.path,ref:'main',encoding:'utf-8'});
    if(claim.sha!==recovery.expected_recipient_blob_sha)fail('CONTACT_CHECKPOINT_RECIPIENT_CHANGED');
    const body={
      input:fixed.reviewed,args:fixed.args,input_sha256:fixed.identity,operation_lease:lease,
      account:fixed.account,intent_branch:fixed.intent.branch,intent_ref_sha:intentHead,
      recipient_claim_path:fixed.path,received_at:new Date().toISOString(),retained_send_invocations:1,
      missing_journal_sha256:recovery.missing_journal_sha256,missing_event_count:recovery.missing_event_count,
      account_source:{repository:REPOSITORY,path:'state/gmail-account.json',commit:recovery.account_commit,
        branch:accountBranch,verified_head_commit:accountHead,blob_sha:accountFile.sha,content:accountFile.content,sha256:digest(accountFile.content)},
      recipient_source:{repository:'woahwhattheheck/commons',path:fixed.path,blob_sha:claim.sha,
        content:claim.content,sha256:digest(claim.content)}
    };
    const history={schema:HISTORY,body,sha256:digest(canonical(body))};
    validateReceivedRateHistory({history,reviewed:fixed.reviewed,args:fixed.args,lease,
      intent:fixed.intent,path:fixed.path,sha256Utf8:modules.sha256Utf8,
      classifyReturnedGmailRateLimit:factory.classifyReturnedSendRateLimit || factory.classifyReturnedGmailRateLimit});
    return {schema:'commons.connected-contact-checkpoint-payload/v1',runtime_input:clone(input),transports:[],
      journal:{schema:'commons.connected-first-contact/v1',input_sha256:fixed.identity,
        input:fixed.reviewed,lease,events:[{phase:'checkpoint-history-received',
          observed_at:body.received_at,history_sha256:history.sha256}],
        recovered_rate_history:history,outcome:{status:'RETURNED_REJECTION_RECEIVED',
          original_returned_at:parse(accountFile.content).deadline_source.observed_at,
          history_sha256:history.sha256}}};
  }
  async function receiveRevisedInput() {
    const local=storage&&recovery?.storage_receipt?.schema==='commons.connected-contact-local-receipt/v1';
    if(!plain(recovery)||!hex(recovery.original_operation_key)||
       (local?recovery.storage_receipt.coordinator_id!==storage.coordinatorId||
          recovery.storage_receipt.namespace!=='checkpoint'||recovery.storage_receipt.key!==recovery.original_operation_key:
          !git(recovery.expected_commit)||!git(recovery.expected_blob_sha))||
       !Number.isSafeInteger(recovery.expected_revision)||!hex(recovery.expected_payload_sha256))
      fail('CONTACT_CHECKPOINT_INPUT_REVISION_SOURCE_REQUIRED');
    const received=await readConnectedContactCheckpoint({tools,sha256Utf8:modules.sha256Utf8,
      operationKey:recovery.original_operation_key,githubRefAction:readers.refAction,...(local?{storage}:{})});
    const {location,metadata,payload}=received;
    if(metadata.active!==null||(local?canonical(location.storage_receipt)!==canonical(recovery.storage_receipt):
       location.commit!==recovery.expected_commit||location.blob_sha!==recovery.expected_blob_sha)||
       metadata.revision!==recovery.expected_revision||
       metadata.payload.sha256!==recovery.expected_payload_sha256||metadata.state_key!==stateKey||
       metadata.operation_lease!==lease)
      fail('CONTACT_CHECKPOINT_INPUT_REVISION_SOURCE_CHANGED');
    const record=payload.reviewed_input_revision;
    const selected=validateReturnedDraftRevision({source:payload,record,modules,factory,tools});
    if(selected.operation_key!==operationKey||selected.input_sha256!==fixed.identity||
       canonical(record.runtime_input)!==canonical(input))
      fail('CONTACT_CHECKPOINT_INPUT_REVISION_TARGET_CHANGED');
    return {schema:'commons.connected-contact-checkpoint-payload/v1',
      runtime_input:clone(input),journal:clone(record.journal),transports:[],
      input_revision_source:{schema:'commons.contact-checkpoint-revised-input-source/v1',
        location:clone(location),metadata:clone(metadata),payload:clone(payload)}};
  }
  if(remote && !remote.empty) {
    state=validateState(await hydrate(remote));savedRevision=remote.value.revision;
    if(state.journal.recovered_rate_history)await verifyHistory(state.journal.recovered_rate_history);
    if(state.input_revision_source)await verifyInputRevisionSource(state);
    if(mode==='adopt' && providedJournal && canonical(providedJournal)!==canonical(state.journal))
      fail('CONTACT_CHECKPOINT_EXISTING_JOURNAL_DIFFERS');


    if(mode==='receive-pending-undispatched'||mode==='receive-pending-preflight') {
      const measured=hash(modules.sha256Utf8,JSON.stringify(providedSnapshot));
      if(!plain(recovery)||recovery.snapshot_sha256!==measured.sha256)
        fail('CONTACT_CHECKPOINT_PENDING_SNAPSHOT_PIN_REQUIRED');
      const existing=remote.value.active;
      if(existing&&Date.parse(existing.expires_at)>Date.now())
        fail('CONTACT_CHECKPOINT_ACTIVE','The same original checkpoint has a live dispatcher.',
          {owner:existing.owner,expires_at:existing.expires_at});
      const tailCollection=mode==='receive-pending-preflight'?'received_pending_preflight_tails':'received_pending_account_tails';
      const prior=state[tailCollection]?.find(row=>row.snapshot_sha256===measured.sha256);
      if(!prior) {
        const expected=recovery.expected_checkpoint,pending=providedSnapshot?.pending_pointer;
        if(!plain(expected)||expected.commit!==remote.commit||expected.blob_sha!==remote.sha||
           expected.revision!==remote.value.revision||expected.payload_sha256!==remote.value.payload.sha256)
          fail('CONTACT_CHECKPOINT_REMOTE_CHANGED');
        if(!plain(pending)||!plain(pending.preimage)||pending.preimage.empty!==false||
           !git(pending.preimage.commit)||!git(pending.preimage.sha)||!plain(pending.invocation)||
           !iso(pending.invocation.observed_at)||!plain(pending.next)||
           Object.keys(pending).some(key=>!['preimage','next','invocation','returned','error'].includes(key)))
          fail('CONTACT_CHECKPOINT_PENDING_POINTER_INVALID');
        const next=validateRoot(pending.next),invocation=pending.invocation,write=invocation.args;
        if(invocation.binding!=='mcp__codex_apps__github_update_file'||!plain(write)||
           write.repository_full_name!==REPOSITORY||write.branch!==branch||write.path!==PATH||
           write.sha!==pending.preimage.sha||write.content!==JSON.stringify(next,null,2)+'\n'||
           write.message!=='Retain original contact checkpoint '+operationKey+' [skip ci]')
          fail('CONTACT_CHECKPOINT_PENDING_POINTER_CHANGED');
        const predecessor=await fileAt(pending.preimage.commit);
        validateRoot(predecessor.value);
        if(predecessor.sha!==pending.preimage.sha||next.revision!==predecessor.value.revision+1||
           Date.parse(next.updated_at)<Date.parse(predecessor.value.updated_at))
          fail('CONTACT_CHECKPOINT_PENDING_PREIMAGE_CHANGED');
        const committed=canonical(remote.value)===canonical(next);
        const unchanged=remote.commit===pending.preimage.commit&&remote.sha===pending.preimage.sha;
        if(!committed&&!unchanged)fail('CONTACT_CHECKPOINT_REMOTE_CHANGED');
        let returned=null;
        if(pending.returned) {
          if(!plain(pending.returned)||!plain(pending.returned.raw)||!iso(pending.returned.observed_at)||
             Date.parse(pending.returned.observed_at)<Date.parse(invocation.observed_at))
            fail('CONTACT_CHECKPOINT_PENDING_RETURN_CHANGED');
          if(!pending.returned.raw.isError) {
            returned=sourceContent(pending.returned.raw);
            if(!git(returned.commit_sha)||!git(returned.content_sha))
              fail('CONTACT_CHECKPOINT_PENDING_RETURN_CHANGED');
            const postimage=returned.commit_sha===remote.commit?remote:await fileAt(returned.commit_sha);
            if(postimage.sha!==returned.content_sha||canonical(postimage.value)!==canonical(next))
              fail('CONTACT_CHECKPOINT_PENDING_RETURN_CHANGED');
            if(!committed)fail('CONTACT_CHECKPOINT_RETURNED_POINTER_NOT_CURRENT');
          }
        }
        const preparedPayload=committed?state:validateState(await hydrate({value:next}));
        const validator=mode==='receive-pending-preflight'?validateReceivedPendingPreflightTail:validateReceivedPendingAccountTail;
        const received=validator({preparedPayload,snapshot:providedSnapshot,
          reviewed:fixed.reviewed,account:fixed.account,lease,intent:fixed.intent,path:fixed.path,
          operationKey,sha256Utf8:modules.sha256Utf8});
        if(!committed) {
          if(state.journal.events.length>preparedPayload.journal.events.length||
             state.transports.length>preparedPayload.transports.length||
             state.journal.events.some((event,i)=>canonical(event)!==canonical(preparedPayload.journal.events[i]))||
             state.transports.some((row,i)=>canonical(row)!==canonical(preparedPayload.transports[i])))
            fail('CONTACT_CHECKPOINT_PENDING_SOURCE_PREFIX_CHANGED');
        }
        state=validateState({...preparedPayload,journal:clone(providedSnapshot.journal),
          transports:clone(providedSnapshot.transports),
          [tailCollection]:[...(preparedPayload[tailCollection]||[]),{
            ...received,received_at:new Date().toISOString(),pointer_state:committed?'COMMITTED':'UNCHANGED',
            source:checkpointIdentity(remote),
            original_pending_pointer:clone(pending)}]});
      }
    }

    if(mode==='receive-returned-account') {
      const measured=hash(modules.sha256Utf8,JSON.stringify(providedSnapshot));
      if(!plain(recovery)||recovery.snapshot_sha256!==measured.sha256)
        fail('CONTACT_CHECKPOINT_RETURNED_ACCOUNT_SNAPSHOT_PIN_REQUIRED');
      const existing=remote.value.active;
      if(existing&&Date.parse(existing.expires_at)>Date.now())
        fail('CONTACT_CHECKPOINT_ACTIVE','The original checkpoint has a live dispatcher.',
          {owner:existing.owner,expires_at:existing.expires_at});
      const prior=state.received_returned_account_tails?.find(row=>row.snapshot_sha256===measured.sha256);
      if(prior) {
        if(prior.schema!=='commons.contact-checkpoint-returned-account-tail/v1'||
           prior.operation_key!==operationKey||prior.input_sha256!==fixed.identity||
           prior.operation_lease!==lease||prior.snapshot_bytes!==measured.bytes||
           !Number.isSafeInteger(prior.received_event_count)||!hex(prior.received_events_sha256)||
           state.journal.events.length<prior.received_event_count||
           digest(JSON.stringify(state.journal.events.slice(0,prior.received_event_count)))!==prior.received_events_sha256||
           canonical(state.transports.slice(0,prior.transport_count))!==canonical(providedSnapshot.transports)||
           canonical(state.input_revision_source??null)!==canonical(providedSnapshot.input_revision_source??null)||
           canonical(state.session_input_revision_source??null)!==canonical(providedSnapshot.session_input_revision_source??null))
          fail('CONTACT_CHECKPOINT_RETURNED_ACCOUNT_TAIL_INVALID');
        // This exact original receipt cannot replace later sender progress.
      } else {
        const expected=recovery.expected_checkpoint;
        if(!plain(expected)||expected.commit!==remote.commit||expected.blob_sha!==remote.sha||
           expected.revision!==remote.value.revision||expected.payload_sha256!==remote.value.payload.sha256)
          fail('CONTACT_CHECKPOINT_REMOTE_CHANGED');
        const received=validateReceivedReturnedAccountTail({savedState:state,snapshot:providedSnapshot,
          reviewed:fixed.reviewed,account:fixed.account,lease,intent:fixed.intent,path:fixed.path,
          operationKey,sha256Utf8:modules.sha256Utf8});
        const originalCall=state.journal.events[received.account_write_event].event;
        const observed=await call('github_fetch_file',{repository_full_name:REPOSITORY,
          path:originalCall.args.path,ref:received.account_commit_sha,encoding:'utf-8'});
        if(observed.sha!==received.account_blob_sha||observed.content!==originalCall.args.content)
          fail('CONTACT_CHECKPOINT_RETURNED_ACCOUNT_SOURCE_CHANGED');
        const receivedJournal=clone(providedSnapshot.journal);
        receiveReturnedTransports({journal:receivedJournal,transports:providedSnapshot.transports,
          sha256Utf8:modules.sha256Utf8});
        state=validateState({...state,journal:receivedJournal,transports:clone(providedSnapshot.transports),
          received_returned_account_tails:[...(state.received_returned_account_tails||[]),{
            ...received,received_at:new Date().toISOString(),
            received_event_count:receivedJournal.events.length,
            received_events_sha256:digest(JSON.stringify(receivedJournal.events)),
            source:checkpointIdentity(remote)}]});
      }
    }

    if(mode==='receive-undispatched') {
      const measured=hash(modules.sha256Utf8,JSON.stringify(providedSnapshot));
      if(!plain(recovery)||recovery.snapshot_sha256!==measured.sha256)
        fail('CONTACT_CHECKPOINT_UNDISPATCHED_SNAPSHOT_PIN_REQUIRED');
      const existing=remote.value.active;
      if(existing&&Date.parse(existing.expires_at)>Date.now())
        fail('CONTACT_CHECKPOINT_ACTIVE','The same original checkpoint has a live dispatcher.',
          {owner:existing.owner,expires_at:existing.expires_at});
      const prior=state.received_undispatched_tails?.find(row=>row.snapshot_sha256===measured.sha256);
      if(prior) {
        if(prior.schema!=='commons.contact-checkpoint-received-undispatched-tail/v1'||
           prior.operation_key!==operationKey||prior.input_sha256!==fixed.identity||
           prior.operation_lease!==lease||!Array.isArray(providedSnapshot?.journal?.events)||
           !Array.isArray(providedSnapshot?.transports)||providedSnapshot.pending_pointer!==null||
           prior.event_count!==providedSnapshot.journal.events.length||
           prior.transport_count!==providedSnapshot.transports.length||
           canonical(state.journal.events.slice(0,prior.event_count))!==canonical(providedSnapshot.journal.events)||
           canonical(state.transports.slice(0,prior.transport_count))!==canonical(providedSnapshot.transports))
          fail('CONTACT_CHECKPOINT_UNDISPATCHED_TAIL_INVALID');
        // A repeated receipt retains all subsequent original sender progress.
      } else {
        const expected=recovery.expected_checkpoint;
        if(!plain(expected)||expected.commit!==remote.commit||expected.blob_sha!==remote.sha||
           expected.revision!==remote.value.revision||expected.payload_sha256!==remote.value.payload.sha256)
          fail('CONTACT_CHECKPOINT_REMOTE_CHANGED');
        const received=validateReceivedUndispatchedTail({savedSource:state,savedJournal:state.journal,
          savedTransports:state.transports,snapshot:providedSnapshot,reviewed:fixed.reviewed,
          account:fixed.account,lease,intent:fixed.intent,path:fixed.path,operationKey,
          sha256Utf8:modules.sha256Utf8});
        state=validateState({...state,journal:clone(providedSnapshot.journal),
          transports:clone(providedSnapshot.transports),
          received_undispatched_tails:[...(state.received_undispatched_tails||[]),{
            ...received,received_at:new Date().toISOString(),source:checkpointIdentity(remote)}]});
      }
    }
    if(mode==='receive-preflight') {
      const measured=hash(modules.sha256Utf8,JSON.stringify(providedSnapshot));
      if(!plain(recovery)||recovery.snapshot_sha256!==measured.sha256)
        fail('CONTACT_CHECKPOINT_PREFLIGHT_SNAPSHOT_PIN_REQUIRED');
      const existing=remote.value.active;
      if(existing&&Date.parse(existing.expires_at)>Date.now())
        fail('CONTACT_CHECKPOINT_ACTIVE','The original checkpoint has a live dispatcher.',
          {owner:existing.owner,expires_at:existing.expires_at});
      const prior=state.received_preflight_tails?.find(row=>row.snapshot_sha256===measured.sha256);
      if(prior) {
        const receivedJournal=providedSnapshot?.journal,receivedTransports=providedSnapshot?.transports;
        if(prior.schema!=='commons.contact-checkpoint-received-preflight-tail/v1'||
           prior.operation_key!==operationKey||prior.input_sha256!==fixed.identity||
           prior.operation_lease!==lease||!plain(receivedJournal)||
           !Array.isArray(receivedJournal.events)||!Array.isArray(receivedTransports)||
           providedSnapshot.pending_pointer!==null||
           prior.event_count!==receivedJournal.events.length||
           prior.transport_count!==receivedTransports.length||
           canonical(state.journal.events.slice(0,prior.event_count))!==
             canonical(receivedJournal.events)||
           canonical(state.transports.slice(0,prior.transport_count))!==
             canonical(receivedTransports))
          fail('CONTACT_CHECKPOINT_PREFLIGHT_TAIL_INVALID');
        // Keep later original sender progress when this same snapshot is received again.
      } else {
        const expected=recovery.expected_checkpoint;
        if(!plain(expected)||expected.commit!==remote.commit||expected.blob_sha!==remote.sha||
           expected.revision!==remote.value.revision||expected.payload_sha256!==remote.value.payload.sha256)
          fail('CONTACT_CHECKPOINT_REMOTE_CHANGED');
        const received=validateReceivedPreflightTail({savedSource:state,savedJournal:state.journal,
          savedTransports:state.transports,snapshot:providedSnapshot,reviewed:fixed.reviewed,
          args:fixed.args,account:fixed.account,lease,intent:fixed.intent,path:fixed.path,
          operationKey,sha256Utf8:modules.sha256Utf8});
        state=validateState({...state,journal:clone(providedSnapshot.journal),
          transports:clone(providedSnapshot.transports),
          received_preflight_tails:[...(state.received_preflight_tails||[]),{
            ...received,received_at:new Date().toISOString(),source:checkpointIdentity(remote)}]});
      }
    }
    if(mode==='receive-cancelled-send') {
      const measured=hash(modules.sha256Utf8,JSON.stringify(providedSnapshot));
      if(!plain(recovery)||recovery.snapshot_sha256!==measured.sha256)
        fail('CONTACT_CHECKPOINT_CANCELLED_SEND_SNAPSHOT_PIN_REQUIRED');
      const existing=remote.value.active;
      if(existing&&Date.parse(existing.expires_at)>Date.now())
        fail('CONTACT_CHECKPOINT_ACTIVE','The original checkpoint has a live dispatcher.',
          {owner:existing.owner,expires_at:existing.expires_at});
      const prior=state.received_cancelled_send_tails?.find(row=>row.snapshot_sha256===measured.sha256);
      if(prior) {
        const receivedJournal=providedSnapshot?.journal,receivedTransports=providedSnapshot?.transports;
        if(prior.schema!=='commons.contact-checkpoint-received-cancelled-send-tail/v1'||
           prior.operation_key!==operationKey||prior.input_sha256!==fixed.identity||
           prior.operation_lease!==lease||!plain(receivedJournal)||
           !Array.isArray(receivedJournal.events)||!Array.isArray(receivedTransports)||
           providedSnapshot.pending_pointer!==null||
           prior.event_count!==receivedJournal.events.length||
           prior.transport_count!==receivedTransports.length||
           canonical(state.journal.events.slice(0,prior.event_count))!==
             canonical(receivedJournal.events)||
           canonical(state.transports.slice(0,prior.transport_count))!==
             canonical(receivedTransports))
          fail('CONTACT_CHECKPOINT_CANCELLED_SEND_TAIL_INVALID');
        // Keep later original sender progress when this same snapshot is received again.
      } else {
        const expected=recovery.expected_checkpoint;
        if(!plain(expected)||expected.commit!==remote.commit||expected.blob_sha!==remote.sha||
           expected.revision!==remote.value.revision||expected.payload_sha256!==remote.value.payload.sha256)
          fail('CONTACT_CHECKPOINT_REMOTE_CHANGED');
        const received=validateReceivedCancelledSendTail({savedSource:state,savedJournal:state.journal,
          savedTransports:state.transports,snapshot:providedSnapshot,reviewed:fixed.reviewed,
          args:fixed.args,account:fixed.account,lease,intent:fixed.intent,path:fixed.path,
          operationKey,sha256Utf8:modules.sha256Utf8});
        state=validateState({...state,journal:clone(providedSnapshot.journal),
          transports:clone(providedSnapshot.transports),
          received_cancelled_send_tails:[...(state.received_cancelled_send_tails||[]),{
            ...received,received_at:new Date().toISOString(),source:checkpointIdentity(remote)}]});
      }
    }
    if(mode==='receive-completed') {
      const completion=validateReceivedCompletion({savedJournal:state.journal,
        completedJournal:providedJournal,transports:state.transports,
        reviewed:fixed.reviewed,args:fixed.args,lease,intent:fixed.intent,path:fixed.path,
        sha256Utf8:modules.sha256Utf8});
      if(state.received_completions?.some(row=>row.journal_sha256===completion.journal_sha256)) {
        if(canonical(state.journal)!==canonical(providedJournal))
          fail('CONTACT_CHECKPOINT_COMPLETION_INVALID');
      } else {
        state.received_completions=[...(state.received_completions||[]),{
          ...completion,received_at:new Date().toISOString(),
          source:checkpointIdentity(remote)}];
      }
      state=validateState({...state,journal:clone(providedJournal)});
    }
  } else if(mode==='receive-revised') state=validateState(await receiveRevisedInput());
  else if(mode==='adopt') {
    const sessionRevision=originalSessionSource?originalSessionRevision({origin:originalSessionSource,
      runtimeInput:input,journal:providedJournal,stateKey,lease,operationKey,modules,factory,tools}):null;
    state=validateState({schema:'commons.connected-contact-checkpoint-payload/v1',
      runtime_input:clone(input),transports:[],journal:clone(providedJournal),
      ...(sessionRevision?{session_input_revision_source:sessionRevision}:{})});
  } else if(mode==='receive-rejected') state=validateState(await receiveRejected());
  else fail('CONTACT_CHECKPOINT_NOT_FOUND','Reopen an existing checkpoint or receive the original complete journal/provider record.');

  if(mode==='receive-revised'&&state.input_revision_source)await verifyInputRevisionSource(state);
  receiveReturnedTransports({journal:state.journal,transports:state.transports,sha256Utf8:modules.sha256Utf8});
  const openedCheckpoint=checkpointIdentity(remote);
  const openedAccountSnapshot=clone({journal:state.journal,transports:state.transports});
  let journal=state.journal, busy=false, closed=false, storageFault=false, recoveringReturn=false, queue=Promise.resolve();
  const enqueue=fn=>{const run=queue.then(fn,fn);queue=run.catch(()=>{});return run;};
  async function ensureBranch() {
    if(storage){if(!remote)fail('CONTACT_LOCAL_ORIGINAL_CHECKPOINT_REQUIRED','Receive the complete original checkpoint before its continuation.');return;}
    if(remote)return;
    const base=await readers.head(call,'main');
    try{await call('github_create_branch',{repository_full_name:REPOSITORY,branch_name:branch,sha:base});}
    catch(error){if(![409,422].includes(error.status))throw error;}
    remote=await current();
    if(!remote)fail('CONTACT_CHECKPOINT_BRANCH_UNCONFIRMED');
    if(!remote.empty)fail('CONTACT_CHECKPOINT_ALREADY_CREATED');
  }
  async function persistLocal({release=false}={}) {
    return enqueue(async()=>{
      if(!storage)fail('CONTACT_LOCAL_STORAGE_REQUIRED','Select the original private coordinator; private Git writes are not used.');
      let before=await current();
      if((!before||!remote)&&!pendingPointer&&!(mode==='receive-revised'&&!before&&!remote&&state.input_revision_source))fail('CONTACT_LOCAL_ORIGINAL_CHECKPOINT_REQUIRED');
      if(pendingPointer?.kind==='commons.local-checkpoint-pending/v1'){
        const request=pendingPointer.request;
        if((before?.sha||null)!==request.expected_sha256&&before?.local.receipt.operation_id!==request.operation_id)
          fail('CONTACT_CHECKPOINT_REMOTE_CHANGED');
        const accepted=await storage.compareAndSwap(request);
        if(accepted.content!==request.content||accepted.receipt.operation_id!==request.operation_id)
          fail('CONTACT_LOCAL_CHECKPOINT_CHANGED');
        before=await current();
        if(before?.sha!==accepted.sha256)fail('CONTACT_CHECKPOINT_REMOTE_CHANGED');
        remote=before;savedRevision=before.value.revision;pendingPointer=null;
      }
      if((before?.sha||null)!==(remote?.sha||null))fail('CONTACT_CHECKPOINT_REMOTE_CHANGED');
      const existing=before?.value.active||null,now=Date.now();
      if(existing&&existing.token!==token&&Date.parse(existing.expires_at)>now)
        fail('CONTACT_CHECKPOINT_ACTIVE','The original checkpoint has another live dispatcher.',
          {owner:existing.owner,expires_at:existing.expires_at});
      if(existing?.token===token&&Date.parse(existing.expires_at)<=now)fail('CONTACT_CHECKPOINT_LEASE_EXPIRED');
      if(!token)token=digest({operationKey,owner,at:new Date().toISOString(),nonce:Math.random()});
      const payload_text=serializeCheckpointPayload(validateState({...state,journal}));
      const measured=hash(modules.sha256Utf8,payload_text);
      if(measured.bytes>LIMIT)fail('CONTACT_CHECKPOINT_TOO_LARGE');
      const retained=!release&&existing?.token===token&&Date.parse(existing.expires_at)-now>LEASE_MS/2;
      if(before&&before.value.payload.sha256===measured.sha256&&before.value.payload.bytes===measured.bytes&&
         (release&&existing===null||retained)){
        storageFault=false;remote=before;savedRevision=before.value.revision;
        return {kind:'commons.connected-contact-local-checkpoint/v1',storage_receipt:clone(before.local.receipt),
          operation_key:operationKey,revision:savedRevision,...measured,unchanged:true};
      }
      const acquired_at=new Date().toISOString();
      active=release?null:{owner,token,acquired_at,expires_at:new Date(Date.parse(acquired_at)+LEASE_MS).toISOString()};
      const metadata={schema:SCHEMA,operation_key:operationKey,input_sha256:fixed.identity,operation_lease:lease,
        state_key:stateKey,revision:(before?.value.revision||0)+1,updated_at:acquired_at,active,
        payload:{...measured,chunks:[{kind:'local-inline',...measured}]}};
      const content=JSON.stringify({metadata,payload_text,original_location:before?.original_location||state.input_revision_source?.location});
      const previous=before?.sha||null;
      const request={namespace:'checkpoint',key:operationKey,expected_sha256:previous,
        operation_id:'checkpoint:'+digest({coordinator_id:storage.coordinatorId,operationKey,previous,content}),content};
      pendingPointer={kind:'commons.local-checkpoint-pending/v1',request:clone(request)};
      const accepted=await storage.compareAndSwap(request);
      if(accepted.content!==content||accepted.receipt.operation_id!==request.operation_id)fail('CONTACT_LOCAL_CHECKPOINT_CHANGED');
      const after=await current();
      if(after?.sha!==accepted.sha256)fail('CONTACT_CHECKPOINT_REMOTE_CHANGED');
      remote=after;savedRevision=metadata.revision;storageFault=false;pendingPointer=null;
      if(!release&&Date.parse(active.expires_at)<=Date.now())fail('CONTACT_CHECKPOINT_LEASE_EXPIRED');
      return {kind:'commons.connected-contact-local-checkpoint/v1',storage_receipt:clone(accepted.receipt),
        operation_key:operationKey,revision:savedRevision,...measured};
    });
  }

  async function persist({release=false}={}) {
    if(storage)return persistLocal({release});
    fail('CONTACT_LOCAL_STORAGE_REQUIRED','Select the original private coordinator; private Git state mutations are disabled.');
    return enqueue(async()=>{
      await ensureBranch();
      const before=await current();
      if(pendingPointer) {
        const ownCommit=before && !before.empty &&
          canonical(before.value)===canonical(pendingPointer.next);
        const unchanged=before && Boolean(before.empty)===pendingPointer.preimage.empty &&
          (before.empty ? before.commit===pendingPointer.preimage.commit
            : before.sha===pendingPointer.preimage.sha);
        if(!ownCommit && !unchanged)fail('CONTACT_CHECKPOINT_REMOTE_CHANGED');
        if(ownCommit) {
          remote=before;savedRevision=before.value.revision;
          state.pointer_recoveries=state.pointer_recoveries||[];
          state.pointer_recoveries.push({schema:'commons.contact-checkpoint-pointer-recovery/v1',
            recovered_at:new Date().toISOString(),commit:before.commit,blob_sha:before.sha,
            preimage:pendingPointer.preimage,next:pendingPointer.next,
            invocation:pendingPointer.invocation,
            ...(pendingPointer.returned?{returned:pendingPointer.returned}:{}),
            ...(pendingPointer.error?{error:pendingPointer.error}:{})});
        }
        pendingPointer=null;
      }
      if(!before || before.empty!==remote.empty || (!before.empty && before.sha!==remote.sha))
        fail('CONTACT_CHECKPOINT_REMOTE_CHANGED');
      const now=Date.now(),existing=before.empty?null:before.value.active;
      if(existing && existing.token!==token && Date.parse(existing.expires_at)>now)
        fail('CONTACT_CHECKPOINT_ACTIVE','The same original checkpoint has another live dispatcher.',
          {owner:existing.owner,expires_at:existing.expires_at});
      if(existing?.token===token && Date.parse(existing.expires_at)<=now)
        fail('CONTACT_CHECKPOINT_LEASE_EXPIRED');
      if(!token)token=digest({operationKey,owner,at:new Date().toISOString(),nonce:Math.random()});
      const text=serializeCheckpointPayload(validateState({...state,journal})),measured=hash(modules.sha256Utf8,text);
      const samePayload=!before.empty && before.value.payload.sha256===measured.sha256 &&
        before.value.payload.bytes===measured.bytes;
      const retainedLease=!release && existing?.token===token &&
        Date.parse(existing.expires_at)-now>LEASE_MS/2;
      if(samePayload && (release && before.value.active===null || retainedLease)) {
        remote=before;savedRevision=before.value.revision;storageFault=false;
        retainCurrentChunks();
        return {repository:REPOSITORY,branch,path:PATH,commit:before.commit,blob_sha:before.sha,
          revision:savedRevision,sha256:measured.sha256,bytes:measured.bytes,unchanged:true};
      }
      if(measured.bytes>LIMIT)fail('CONTACT_CHECKPOINT_TOO_LARGE');
      const pendingBlobs=new Map();
      const parts=await mapChunks(payloadChunks(text),async part=>{
        const h=hash(modules.sha256Utf8,part);let sha=blobCache.get(h.sha256);
        if(!sha) {
          let request=pendingBlobs.get(h.sha256);
          if(!request) {
            request=(async()=>{
              const created=await call('github_create_blob',{repository_full_name:REPOSITORY,content:part,encoding:'utf-8'});
              if(!git(created.sha))fail('CONTACT_CHECKPOINT_BLOB_UNCONFIRMED');
              const back=await call('github_fetch_blob',{repository_full_name:REPOSITORY,blob_sha:created.sha});
              if(back.content!==part)fail('CONTACT_CHECKPOINT_BLOB_CHANGED');
              blobCache.set(h.sha256,created.sha);
              suppliedChunks.set(created.sha,{blob_sha:created.sha,bytes:h.bytes,
                sha256:h.sha256,content:back.content});
              return created.sha;
            })();
            pendingBlobs.set(h.sha256,request);
          }
          sha=await request;
        }
        // A reused hash-to-blob entry was already verified on its original readback.
        if(!suppliedChunks.has(sha))suppliedChunks.set(sha,{blob_sha:sha,bytes:h.bytes,
          sha256:h.sha256,content:part});
        return {blob_sha:sha,bytes:h.bytes,sha256:h.sha256};
      });
      // Establish this lease's interval after its immutable payload is saved.
      // The pointer CAS still fences a writer that moved during blob upload.
      const acquired_at=new Date().toISOString();
      active=release?null:{owner,token,acquired_at,expires_at:new Date(Date.parse(acquired_at)+LEASE_MS).toISOString()};
      const next={schema:SCHEMA,operation_key:operationKey,input_sha256:fixed.identity,
        operation_lease:lease,state_key:stateKey,revision:(before.empty?0:before.value.revision)+1,
        updated_at:new Date().toISOString(),active,
        payload:{sha256:measured.sha256,bytes:measured.bytes,chunks:parts}};
      const writeName=before.empty?'github_create_file':'github_update_file';
      const writeArgs={repository_full_name:REPOSITORY,branch,path:PATH,
        content:JSON.stringify(next,null,2)+'\n',
        message:'Retain original contact checkpoint '+operationKey+' [skip ci]',
        ...(!before.empty?{sha:before.sha}:{})};
      pendingPointer={preimage:{empty:Boolean(before.empty),commit:before.commit,
        sha:before.empty?null:before.sha},next,
        invocation:{binding:'mcp__codex_apps__'+writeName,args:writeArgs,observed_at:new Date().toISOString()}};
      let error;
      try{
        const raw=await tools['mcp__codex_apps__'+writeName](writeArgs);
        pendingPointer.returned={raw:clone(raw),observed_at:new Date().toISOString()};
        sourceContent(raw);
      }catch(e){
        error=e;pendingPointer.error={name:String(e?.name||'Error'),code:String(e?.code||''),
          message:String(e?.message||e)};
      }
      const after=await current();
      if(!after || after.empty || canonical(after.value)!==canonical(next))
        throw error || Object.assign(new Error('Original checkpoint write remains unconfirmed'),{code:'CONTACT_CHECKPOINT_WRITE_UNCONFIRMED'});
      remote=after;savedRevision=next.revision;storageFault=false;pendingPointer=null;
      retainCurrentChunks();
      if(!release && Date.parse(next.active.expires_at)<=Date.now())
        fail('CONTACT_CHECKPOINT_LEASE_EXPIRED');
      return {repository:REPOSITORY,branch,path:PATH,commit:after.commit,blob_sha:after.sha,
        revision:savedRevision,sha256:measured.sha256,bytes:measured.bytes};
    });
  }
  const mutating=new Set(['github_create_branch','github_create_file','github_update_file',
    'gmail_send_email','gmail_send_draft'].map(name=>'mcp__codex_apps__'+name));
  const wrapped=Object.create(null);
  for(const name of Object.keys(tools))wrapped[name]=tools[name];
  // The runtime tools object need not enumerate its methods.
  for(const name of required.concat(['gmail_get_profile','gmail_search_email_ids','gmail_batch_read_email',
      'gmail_send_email','gmail_send_draft','gmail_list_drafts','gmail_read_email','github_get_profile','github_get_user_login',
      'github_get_repo','github_fetch','github_fetch_commit','github_compare_commits','slack_slack_search_public']).map(n=>'mcp__codex_apps__'+n))
    if(typeof tools[name]==='function')wrapped[name]=tools[name];
  for(const binding of mutating) {
    if(typeof tools[binding]!=='function')continue;
    wrapped[binding]=async args=>{
      if(closed)fail('CONTACT_CHECKPOINT_REOPEN_REQUIRED');
      if(recoveringReturn&&['mcp__codex_apps__gmail_send_email','mcp__codex_apps__gmail_send_draft'].includes(binding))
        fail('CONTACT_CHECKPOINT_RECOVERY_SEND_FORBIDDEN');
      let index=-1,nested=false;
      for(let i=journal.events.length-1;i>=0;i--) {
        const outer=journal.events[i],event=outer.phase==='account-admission'?outer.event:outer;
        if(event?.phase==='invoking' && event.binding===binding && canonical(event.args)===canonical(args)) {
          index=i;nested=outer!==event;break;
        }
      }
      if(index<0)fail('CONTACT_CHECKPOINT_ORIGINAL_INVOCATION_REQUIRED');
      const t={id:digest({operationKey,index,binding,args}),event_index:index,nested,binding,
        args_sha256:digest(JSON.stringify(args)),state:'INVOKING'};
      if(state.transports.some(row=>row.id===t.id))fail('CONTACT_CHECKPOINT_INVOCATION_ALREADY_RETAINED');
      state.transports.push(t);
      try{
        if(storageFault)fail('CONTACT_CHECKPOINT_REOPEN_REQUIRED');
        await persist();
      }catch(error){
        // This adapter has not called the provider. Preserve that exact local
        // outcome so the original unused-dispatch cancellation can continue.
        t.state='NOT_DISPATCHED';t.not_dispatched_at=new Date().toISOString();
        const outer=journal.events[index],event=nested?outer.event:outer;
        event.original_phase='invoking';event.phase='checkpoint-not-dispatched';
        event.checkpoint_transport_id=t.id;event.not_dispatched_at=t.not_dispatched_at;
        t.error={code:String(error.code||'CONTACT_CHECKPOINT_SAVE_FAILED'),message:String(error.message||error)};
        storageFault=true;
        throw error;
      }
      let raw;
      try{raw=await tools[binding](args);}
      catch(error) {
        t.state='THREW';t.returned_at=new Date().toISOString();
        t.error={name:String(error?.name||'Error'),message:String(error?.message||error)};
        try{await persist();}catch{storageFault=true;}
        throw error;
      }
      t.state='RETURNED';t.raw=clone(raw);t.returned_at=new Date().toISOString();
      t.return_sha256=digest(JSON.stringify(t.raw));
      try{await persist();}catch(error){
        storageFault=true;
        throw Object.assign(new Error('CONTACT_CHECKPOINT_RETURN_SAVE_FAILED:'+t.id),
          {code:'CONTACT_CHECKPOINT_RETURN_SAVE_FAILED',checkpoint_transport_id:t.id,
           native_result_retained_in_memory:true,cause:error});
      }
      return raw;
    };
  }
  async function receiveInterruptedAccountAttempt(selection) {
    if(mode!=='reopen' || providedJournal || providedSnapshot || !openedCheckpoint) return null;
    const retained=state.account_interruption_source;
    const source=retained?.snapshot || openedAccountSnapshot;
    const proof=validateInterruptedAccountAttempt({...source,
      operationKey,...selection,sha256Utf8:modules.sha256Utf8});
    if(!proof)return null;
    if(retained && (retained.proof.original_snapshot_sha256!==proof.original_snapshot_sha256 ||
        retained.proof.attempt_key!==proof.attempt_key))
      fail('CONTACT_CHECKPOINT_INTERRUPTION_RETAINED_SOURCE_CHANGED');
    if(!busy || closed || storageFault || pendingPointer || !token || !active ||
        active.token!==token || Date.parse(active.expires_at)<=Date.now())
      fail('CONTACT_CHECKPOINT_INTERRUPTION_WRITER_REQUIRED');
    if(journal.events.length<proof.original_event_count ||
        canonical(journal.events.slice(0,proof.original_event_count))!==canonical(source.journal.events) ||
        journal.input_sha256!==proof.input_sha256 || journal.lease!==proof.operation_lease ||
        journal.receipt || journal.native_receipt)
      fail('CONTACT_CHECKPOINT_INTERRUPTION_PREFIX_CHANGED');
    const read=/^mcp__codex_apps__(?:github_(?:fetch(?:_file|_blob|_commit)?|get_(?:profile|user_login|repo)|compare_commits)|gmail_(?:get_profile|search_email_ids|search_emails|read_email|read_thread|read_attachment))$/;
    for(const outer of journal.events.slice(proof.original_event_count)) {
      const nested=outer.phase==='account-admission',event=nested?outer.event:outer;
      if(!event || /^mcp__codex_apps__gmail_send_/.test(event.binding || '') ||
          ['account-attempt-prepared','account-attempt-acquired'].includes(outer.phase))
        fail('CONTACT_CHECKPOINT_INTERRUPTION_LATER_DISPATCH');
      if(event.phase==='invoking' && !read.test(event.binding || '')&&!(storage&&/^commons\.local-state\.(read|history|verify)$/.test(event.binding||''))) {
        const args=event.args,postimage=typeof args?.content==='string'?parse(args.content):null;
        const local=storage&&event.binding==='commons.local-state.compareAndSwap';
        if(!nested||(!local&&event.binding!=='mcp__codex_apps__github_update_file')||
            (local?args.namespace!=='account'||args.key!==selection.location.account_key||
              selection.location.coordinator_id!==storage.coordinatorId:
              args.repository_full_name!==selection.location.repository||
              args.branch!==selection.location.branch||args.path!==selection.location.path)||
            postimage?.active!==null ||
            postimage.last_release?.operation_key!==operationKey ||
            postimage.last_release.attempt_key!==selection.attemptKey ||
            postimage.last_release.token!==proof.account_lease.token)
          fail('CONTACT_CHECKPOINT_INTERRUPTION_LATER_MUTATION');
      }
      if(!nested && !['invoking','returned','failed','account-acquisition-release-received'].includes(event.phase))
        fail('CONTACT_CHECKPOINT_INTERRUPTION_LATER_OPERATION');
    }
    const observed=await current();
    if(!observed || observed.empty || observed.sha!==remote.sha ||
        observed.value.active?.token!==token ||
        Date.parse(observed.value.active.expires_at)<=Date.now())
      fail('CONTACT_CHECKPOINT_INTERRUPTION_WRITER_CHANGED');
    const received={...proof,original_checkpoint:retained?.proof.original_checkpoint || openedCheckpoint,
      receiving_checkpoint:{...checkpointIdentity(observed),
        ...(!storage?{repository:REPOSITORY,branch,path:PATH}:{}),
        owner:observed.value.active.owner,token:observed.value.active.token,
        expires_at:observed.value.active.expires_at}};
    if(!retained) {
      state.account_interruption_source={proof:received,snapshot:clone(source)};
      // Retain the complete selected source before confirm/release so a lost
      // provider return resumes this same receiving operation after reopening.
      await persist();
    }
    return received;
  }
  const wrappedStorage=storage?Object.freeze({...storage,
    compareAndSwap:args=>retainLocalTransport('compareAndSwap',args),
    receive:args=>retainLocalTransport('receive',args)}):undefined;
  async function retainLocalTransport(action,args){
    const binding='commons.local-state.'+action;
    if(closed||storageFault)fail('CONTACT_CHECKPOINT_REOPEN_REQUIRED');
    let index=-1,nested=false;
    for(let i=journal.events.length-1;i>=0;i--){
      const outer=journal.events[i],event=outer.phase==='account-admission'?outer.event:outer;
      if(event?.phase==='invoking'&&event.binding===binding&&canonical(event.args)===canonical(args)){
        index=i;nested=outer!==event;break;
      }
    }
    if(index<0)fail('CONTACT_CHECKPOINT_ORIGINAL_INVOCATION_REQUIRED');
    const t={id:digest({operationKey,index,binding,args}),event_index:index,nested,binding,
      args_sha256:digest(JSON.stringify(args)),state:'INVOKING'};
    if(state.transports.some(row=>row.id===t.id))fail('CONTACT_CHECKPOINT_INVOCATION_ALREADY_RETAINED');
    state.transports.push(t);
    try{await persist();}
    catch(error){t.state='NOT_DISPATCHED';t.not_dispatched_at=new Date().toISOString();
      const outer=journal.events[index],event=nested?outer.event:outer;
      event.original_phase='invoking';event.phase='checkpoint-not-dispatched';event.checkpoint_transport_id=t.id;
      event.not_dispatched_at=t.not_dispatched_at;storageFault=true;throw error;}
    let raw;
    try{raw=await storage[action](args);}
    catch(error){t.state='THREW';t.returned_at=new Date().toISOString();t.error={code:String(error.code||''),status:Number(error.status)||0,message:String(error.message||error)};
      try{await persist();}catch{storageFault=true;}throw error;}
    t.state='RETURNED';t.raw=clone(raw);t.returned_at=new Date().toISOString();t.return_sha256=digest(JSON.stringify(raw));
    try{await persist();}catch(error){storageFault=true;throw Object.assign(new Error('CONTACT_CHECKPOINT_RETURN_SAVE_FAILED:'+t.id),
      {code:'CONTACT_CHECKPOINT_RETURN_SAVE_FAILED',checkpoint_transport_id:t.id,cause:error});}
    return raw;
  }

  const composed={...modules,checkpoints:{validateReceivedRateHistory,
    receiveInterruptedAccountAttempt,
    receiveUndispatchedNativeCall:({eventIndex,binding})=>validateUndispatchedNativeCall({
      journal,transports:state.transports,operationKey,eventIndex,binding,
      sha256Utf8:modules.sha256Utf8})}};
  let revisingInput=false,selectedRevisionJournal=null;
  const original=factory.createConnectedFirstContact({tools:wrapped,input,storage:wrappedStorage,modules:composed,
    load:key=>key===stateKey?(selectedRevisionJournal||journal):undefined,
    store:(key,value)=>{
      if(key!==stateKey)fail('CONTACT_CHECKPOINT_STATE_KEY_CHANGED');
      if(value.input_sha256!==fixed.identity) {
        if(!revisingInput)fail('CONTACT_CHECKPOINT_FIXED_REVIEW');
        const record={schema:'commons.contact-checkpoint-reviewed-input-revision/v1',
          previous_input_sha256:fixed.identity,input_sha256:value.input_sha256,operation_lease:lease,
          selection_id:value.returned_mailbox_revision?.selection_id,
          runtime_input:clone(value.runtime_input),journal:clone(value)};
        validateReturnedDraftRevision({source:{...state,journal},record,modules,factory,tools});
        if(state.reviewed_input_revision&&canonical(state.reviewed_input_revision)!==canonical(record))
          fail('CONTACT_CHECKPOINT_INPUT_REVISION_CHANGED');
        state.reviewed_input_revision=record;selectedRevisionJournal=value;return;
      }
      journal=value;state.journal=journal;
    },
    stateKey,lease,beforeSend,beforeNativeSend,organizationQuery,organizationDomains,githubActorAction,githubRefAction:readers.refAction});
  const sendingMethods=new Set(['run','resumeRecipient','resumeConsole','resumeRateLimited']);
  const completedContact=(outcome,proof)=>outcome?.status==='SENT_VERIFIED'&&
    outcome.completion==='RECORDED'&&outcome.message_id===proof.provider_message_id&&
    outcome.intent_branch===fixed.intent.branch&&outcome.recipient_claim_path===fixed.path;
  const settledAccount=result=>['ACCOUNT_RECONCILED','NO_RETAINED_ACCOUNT_ATTEMPT'].includes(result?.status);
  function retainedReturn() {
    return validateRetainedSentReturn({journal,transports:state.transports,args:fixed.args,
      operationKey,sha256Utf8:modules.sha256Utf8});
  }
  function recoveryRecord(proof) {
    const row=state.send_return_recovery;
    if(row===undefined)return null;
    if(!proof||!plain(row)||row.schema!=='commons.contact-checkpoint-send-return-recovery/v1'||
       canonical(row.proof)!==canonical(proof)||!iso(row.started_at)||
       !['PENDING','CONTACT_PENDING','ACCOUNT_PENDING','COMPLETE'].includes(row.status)||
       row.status==='COMPLETE'&&(!iso(row.completed_at)||!completedContact(row.contact_outcome,proof)||
         !completedContact(journal.outcome,proof)||!settledAccount(row.account_reconciliation)))
      fail('CONTACT_CHECKPOINT_RETURN_RECOVERY_CHANGED');
    return row;
  }
  function needsReturnRecovery(proof) {
    const row=recoveryRecord(proof);
    return !!proof&&(row ? row.status!=='COMPLETE' : storageFault||!completedContact(journal.outcome,proof));
  }
  async function recoverRetainedSend(proof) {
    if(typeof original.reconcile!=='function'||typeof original.reconcileAccountAdmission!=='function')
      fail('CONTACT_CHECKPOINT_RECONCILIATION_METHOD_REQUIRED',
        'Load the original sender with full-MIME and account-admission reconciliation.');
    receiveReturnedTransports({journal,transports:state.transports,sha256Utf8:modules.sha256Utf8});
    const currentProof=retainedReturn();
    if(canonical(currentProof)!==canonical(proof))fail('CONTACT_CHECKPOINT_SENT_RETURN_CHANGED');
    let row=recoveryRecord(proof);
    if(!row)row=state.send_return_recovery={
      schema:'commons.contact-checkpoint-send-return-recovery/v1',proof:clone(proof),
      started_at:new Date().toISOString(),status:'PENDING'};
    // The exact repaired original journal and proof must be durable, under the
    // original pointer/lease fence, before any recipient or account mutation.
    await persist();
    recoveringReturn=true;
    try {
      const outcome=await original.reconcile(proof.provider_message_id);
      if(outcome?.status!=='SENT_VERIFIED'||outcome.message_id!==proof.provider_message_id||
         outcome.intent_branch!==fixed.intent.branch||outcome.recipient_claim_path!==fixed.path)
        fail('CONTACT_CHECKPOINT_SENT_RECONCILIATION_REQUIRED');
      row.contact_outcome=clone(outcome);
      row.status=outcome.completion==='RECORDED'?'ACCOUNT_PENDING':'CONTACT_PENDING';
      await persist();
      const account=await original.reconcileAccountAdmission();
      // Original detailed native account events remain in the journal; this
      // compact progress marker contains no admission token or duplicate body.
      row.account_reconciliation=Object.fromEntries(
        ['status','operation_key','attempt_key','provider_outcome']
          .filter(key=>account?.[key]!==undefined).map(key=>[key,account[key]]));
      if(!settledAccount(account)) {
        row.status='ACCOUNT_PENDING';
        fail('CONTACT_CHECKPOINT_ACCOUNT_RECONCILIATION_REQUIRED',
          'The original message is verified; continue its retained account reconciliation.',
          {account_reconciliation:clone(row.account_reconciliation)});
      }
      if(completedContact(outcome,proof)) {
        row.status='COMPLETE';row.completed_at=new Date().toISOString();
      } else row.status='CONTACT_PENDING';
      return outcome;
    } finally {recoveringReturn=false;}
  }
  async function receiveLocalPendingTransports(){
    if(!storage)return;
    for(const t of state.transports){
      if(!['commons.local-state.compareAndSwap','commons.local-state.receive'].includes(t.binding)||
         !['INVOKING','THREW'].includes(t.state))continue;
      const outer=journal.events[t.event_index],event=t.nested?outer?.event:outer;
      if(event?.phase!=='invoking'||event.binding!==t.binding||digest(JSON.stringify(event.args))!==t.args_sha256)
        fail('CONTACT_CHECKPOINT_INVOCATION_CHANGED');
      if(t.state==='THREW'&&t.error?.status===409){
        const terminals=journal.events.slice(t.event_index+1).map(x=>t.nested?x?.event:x)
          .filter(x=>x?.binding===t.binding&&x.call_id===event.call_id&&['returned','failed'].includes(x.phase));
        if(terminals.some(x=>x.phase!=='failed'||x.status!==409||x.code!==t.error.code))fail('CONTACT_CHECKPOINT_RETURN_CHANGED');
        if(!terminals.length){
          const failed={phase:'failed',binding:t.binding,call_id:event.call_id,status:409,
            code:t.error.code,message:t.error.message,observed_at:t.returned_at||new Date().toISOString(),
            recovered_from_checkpoint_transport:t.id};
          journal.events.push(t.nested?{phase:'account-admission',event:failed,observed_at:failed.observed_at}:failed);
          await persist();
        }
        if(t.error.code!=='LOCAL_STATE_CONFLICT')throw Object.assign(new Error(t.error.message),{code:t.error.code,status:409});
        continue;
      }
      // Only an idempotent state operation is received here. A Gmail call is
      // never retried by checkpoint restoration.
      let raw;
      try{raw=await storage[t.binding.slice('commons.local-state.'.length)](event.args);}
      catch(error){
        if(error.status!==409)throw error;
        t.state='THREW';t.error={code:String(error.code||''),status:409,message:String(error.message||error)};
        const later=journal.events.slice(t.event_index+1).find(x=>{
          const e=t.nested?x?.event:x;return e?.binding===t.binding&&e.call_id===event.call_id&&['returned','failed'].includes(e.phase);});
        if(!later){const failed={phase:'failed',binding:t.binding,call_id:event.call_id,status:409,code:t.error.code,
          message:t.error.message,observed_at:new Date().toISOString(),recovered_from_checkpoint_transport:t.id};
          journal.events.push(t.nested?{phase:'account-admission',event:failed,observed_at:failed.observed_at}:failed);}
        await persist();
        if(t.error.code!=='LOCAL_STATE_CONFLICT')throw Object.assign(new Error(t.error.message),{code:t.error.code,status:409});
        continue;
      }
      t.state='RETURNED';t.raw=clone(raw);t.returned_at=new Date().toISOString();t.return_sha256=digest(JSON.stringify(raw));
      const recovered={phase:'returned',binding:t.binding,call_id:event.call_id,raw:clone(raw),
        observed_at:t.returned_at,recovered_from_checkpoint_transport:t.id};
      let found=-1;
      for(let i=t.event_index+1;i<journal.events.length;i++){
        const candidate=t.nested?journal.events[i]?.event:journal.events[i];
        if(candidate?.binding===t.binding&&candidate.call_id===event.call_id&&['returned','failed'].includes(candidate.phase)){found=i;break;}
      }
      if(found>=0){
        const prior=clone(journal.events[found]),priorEvent=t.nested?prior.event:prior;
        if(priorEvent.phase==='returned'&&canonical(priorEvent.raw)!==canonical(raw))fail('CONTACT_CHECKPOINT_RETURN_CHANGED');
        if(priorEvent.phase==='failed'){journal.events[found]=t.nested?{...prior,event:recovered}:recovered;
          journal.events.push({phase:'local-state-failure-received',original_event_index:found,original_event:prior,
            transport_id:t.id,observed_at:t.returned_at});}
      }else journal.events.push(t.nested?{phase:'account-admission',event:recovered,observed_at:t.returned_at}:recovered);
      await persist();
    }
  }

  const methods={};
  for(const name of Object.keys(original)) methods[name]=async(...args)=>{
    const sending=sendingMethods.has(name),revising=name==='reviseReturnedRateDraft';
    if(state.reviewed_input_revision)fail('CONTACT_CHECKPOINT_INPUT_REVISED',
      'Receive the explicit reviewed-input successor; this original checkpoint retains its rejected history.');
    if(revising&&typeof beforeSend!=='function')fail('CONTACT_CHECKPOINT_RELATIONSHIP_READER_REQUIRED');
    if(sending&&typeof beforeSend!=='function')
      fail('CONTACT_CHECKPOINT_RELATIONSHIP_READER_REQUIRED','Reopen with the original current company relationship reader before delivery.');
    if(['adoptMailbox','reviseDraft'].includes(name))
      fail('CONTACT_CHECKPOINT_FIXED_REVIEW','This checkpoint retains its exact original reviewed input. Receive an explicit original input revision into its own checkpoint before continuing it.');
    if(closed||busy)fail('CONTACT_CHECKPOINT_OPERATION_ACTIVE');
    const initialProof=sending?retainedReturn():null;
    if(storageFault&&(!sending||!initialProof))fail('CONTACT_CHECKPOINT_REOPEN_REQUIRED');
    busy=true;
    let result,error,enteredOriginal=false,recoveryAttempted=false;
    try {
      // Only the original run's fully ended zero-send wait can avoid a new
      // checkpoint lease. No pending pointer, transport, repaired payload or
      // returned-send recovery may enter this read-only branch.
      if(name==='run' && !storageFault && !pendingPointer && !initialProof &&
          !state.send_return_recovery && remote && !remote.empty && remote.value.active===null &&
          state.transports.every(row=>['RETURNED','NOT_DISPATCHED'].includes(row.state)) &&
          typeof original.inspectAccountWait==='function') {
        const payload=hash(modules.sha256Utf8,serializeCheckpointPayload(validateState({...state,journal})));
        if(payload.sha256===remote.value.payload.sha256 && payload.bytes===remote.value.payload.bytes) {
          const observed=await original.inspectAccountWait();
          if(observed) {
            const after=await current();
            if(!after || after.empty || after.commit!==remote.commit || after.sha!==remote.sha || after.value.active!==null)
              fail('CONTACT_CHECKPOINT_REMOTE_CHANGED');
            return observed;
          }
        }
      }
      try {
        await persist();await receiveLocalPendingTransports();
        if(sending&&needsReturnRecovery(initialProof)) {
          recoveryAttempted=true;result=await recoverRetainedSend(initialProof);
        } else {
          enteredOriginal=true;revisingInput=revising;
          try {result=await original[name](...args);}finally{revisingInput=false;}
        }
      } catch(e) {error=e;}
      // One bounded continuation after the just-finished original call. This
      // also covers a successful Gmail return whose immediate save failed.
      if(sending&&enteredOriginal&&!recoveryAttempted) {
        try {
          const proof=retainedReturn();
          if(needsReturnRecovery(proof)) {
            recoveryAttempted=true;result=await recoverRetainedSend(proof);error=null;
          }
        } catch(e) {error=e;}
      }
      try {await persist({release:true});}
      catch(e) {storageFault=true;if(!error)error=e;}
    } finally {busy=false;}
    if(error) {
      if(journal.outcome?.status==='SENT_VERIFIED')error.contact_outcome=clone(journal.outcome);
      if(journal.outcome?.status==='SENT_VERIFIED'||state.send_return_recovery) {
        error.contact_checkpoint={repository:REPOSITORY,branch,path:PATH,
          operation_key:operationKey,revision:savedRevision,commit:remote?.commit||null,
          completion_save_pending:storageFault};
        if(state.send_return_recovery)error.retained_send_return={
          ...clone(state.send_return_recovery.proof),recovery_status:state.send_return_recovery.status,
          action:'Continue this original checkpoint; do not send another message.'};
      }
      throw error;
    }
    if(revising&&state.reviewed_input_revision)result={...result,
      revised_checkpoint:{operation_key:digest({input_sha256:state.reviewed_input_revision.input_sha256,lease}),
        input:clone(state.reviewed_input_revision.runtime_input),lease,state_key:stateKey,
        recovery:{original_operation_key:operationKey,
          ...(storage?{storage_receipt:clone(remote.local.receipt)}:{expected_commit:remote.commit,expected_blob_sha:remote.sha}),
          expected_revision:remote.value.revision,
          expected_payload_sha256:remote.value.payload.sha256}}};
    return result;
  };
  // Retain only immutable bytes selected by the last confirmed pointer.
  // Fresh ref, account and recipient reads remain in the original caller.
  function currentChunkCache() {
    const records=new Map();
    for(const part of remote?.value?.payload?.chunks || []) {
      const cached=suppliedChunks.get(part.blob_sha);
      if(cached && cached.bytes===part.bytes && cached.sha256===part.sha256)
        records.set(part.blob_sha,Object.freeze({blob_sha:cached.blob_sha,
          bytes:cached.bytes,sha256:cached.sha256,content:cached.content}));
    }
    return Object.freeze([...records.values()]);
  }
  function retainCurrentChunks() {
    const selected=new Set((remote?.value?.payload?.chunks || []).map(part=>part.blob_sha));
    for(const key of suppliedChunks.keys())if(!selected.has(key))suppliedChunks.delete(key);
  }
  function releasedPayloadUnchanged() {
    if(storageFault || pendingPointer || remote?.empty || remote?.value?.active!==null)
      return false;
    const text=serializeCheckpointPayload(validateState({...state,journal}));
    const measured=hash(modules.sha256Utf8,text);
    return remote.value.payload.bytes===measured.bytes &&
      remote.value.payload.sha256===measured.sha256;
  }
  return Object.freeze({...methods,
    async retainSourceActivation(record) {
      if(busy)fail('CONTACT_CHECKPOINT_OPERATION_ACTIVE');
      if(closed)fail('CONTACT_CHECKPOINT_CLOSED');
      if(storageFault||pendingPointer)fail('CONTACT_CHECKPOINT_SOURCE_SAVE_RECOVERY_REQUIRED',
        'Recover this same checkpoint save before changing its source selection.');
      const retained=clone(record);
      const selection=validateContactSourceActivation(retained,{journal,stateKey,lease,operationKey,
        sha256Utf8:modules.sha256Utf8,current:true});
      if(hash(modules.sha256Utf8,JSON.stringify(original.plan())).sha256!==retained.plan_sha256)
        fail('CONTACT_CHECKPOINT_SOURCE_PLAN_CHANGED');
      if(state.contact_source_activation) {
        const previous=validateContactSourceActivation(state.contact_source_activation,
          {journal,stateKey,lease,operationKey,sha256Utf8:modules.sha256Utf8});
        if(previous.revision>selection.revision||
           canonical(selection.activations.slice(0,previous.revision))!==canonical(previous.activations)||
           previous.sources.some(row=>!selection.sources.some(next=>canonical(row)===canonical(next))))
          fail('CONTACT_CHECKPOINT_SOURCE_HISTORY_CHANGED');
      }
      busy=true;
      try {
        // Retain before the original persistence call. If its pointer response
        // is uncertain, the same state/pendingPointer and checkpoint() recover
        // the original write; no source/history rollback is performed.
        state.contact_source_activation=retained;
        return await persist({release:true});
      } finally {busy=false;}
    },
    sourceActivation:()=>state.contact_source_activation?clone(state.contact_source_activation):null,
    async checkpoint(){if(busy)fail('CONTACT_CHECKPOINT_OPERATION_ACTIVE');return persist({release:true});},
    location:()=>storage?({kind:'commons.connected-contact-local-checkpoint/v1',coordinator_id:storage.coordinatorId,
      operation_key:operationKey,revision:savedRevision,storage_receipt:clone(remote.local.receipt),original_location:clone(remote.original_location)}):
      ({repository:REPOSITORY,branch,path:PATH,operation_key:operationKey,revision:savedRevision,commit:remote?.commit||null}),
    chunkCache:currentChunkCache,
    snapshot:()=>clone({journal,transports:state.transports,pending_pointer:pendingPointer,
      ...(state.reviewed_input_revision?{reviewed_input_revision:state.reviewed_input_revision}:{}),
      ...(state.input_revision_source?{input_revision_source:state.input_revision_source}:{}),
      ...(state.session_input_revision_source?{session_input_revision_source:state.session_input_revision_source}:{}),
      ...(state.send_return_recovery?{send_return_recovery:state.send_return_recovery}:{})}),
    async close(){
      if(busy)fail('CONTACT_CHECKPOINT_OPERATION_ACTIVE');
      if(!closed && !releasedPayloadUnchanged())await persist({release:true});
      closed=true;
    }
  });
}
/**
 * Read a complete committed checkpoint without retaining any previous V8 data.
 * The caller uses its returned runtime_input/state_key/operation_lease to reopen
 * the same original sender with the published original module source.
 */
async function readConnectedContactCheckpoint({tools,sha256Utf8,operationKey,chunkCache,githubRefAction,storage,includeOriginalReadback=false}) {
  if(storage){await storage.verify();const row=await storage.read({namespace:'checkpoint',key:operationKey});
    if(!row)fail('CONTACT_CHECKPOINT_NOT_FOUND');const value=parse(row.content);
    if(row.kind!=='commons.connected-contact-local-snapshot/v1'||row.key!==operationKey||row.namespace!=='checkpoint'||
       hash(sha256Utf8,row.content).sha256!==row.sha256||value.metadata?.operation_key!==operationKey||
       hash(sha256Utf8,value.payload_text).sha256!==value.metadata.payload.sha256||
       hash(sha256Utf8,value.payload_text).bytes!==value.metadata.payload.bytes)fail('CONTACT_LOCAL_CHECKPOINT_CHANGED');
    return {location:{kind:'commons.connected-contact-local-checkpoint/v1',coordinator_id:storage.coordinatorId,
      operation_key:operationKey,sha256:row.sha256,storage_receipt:row.receipt,original_location:value.original_location},metadata:value.metadata,
      payload:parse(value.payload_text),chunk_cache:[]};
  }
  if(!hex(operationKey)||typeof sha256Utf8!=='function')
    fail('CONTACT_CHECKPOINT_SELECTION_REQUIRED');
  const suppliedChunks=copyChunkCache(chunkCache,sha256Utf8);
  const branch='contact-checkpoint/v1/'+operationKey;
  const call=async(name,args)=>{
    const fn=tools?.['mcp__codex_apps__'+name];
    if(typeof fn!=='function')fail('CONTACT_CHECKPOINT_BINDING_REQUIRED',name);
    const value=sourceContent(await fn(args));
    return name==='github_fetch'?parse(value.content):value;
  };
  const readers=checkpointGitReaders(tools,githubRefAction);
  await readers.repository(call);
  const commit=await readers.head(call,branch);
  const file=await call('github_fetch_file',{repository_full_name:REPOSITORY,path:PATH,ref:commit,encoding:'utf-8'});
  const metadata=parse(file.content);
  if(!git(file.sha)||metadata.schema!==SCHEMA||metadata.operation_key!==operationKey||
     !hex(metadata.input_sha256)||typeof metadata.operation_lease!=='string'||
     typeof metadata.state_key!=='string'||!Number.isSafeInteger(metadata.revision)||metadata.revision<1||
     !plain(metadata.payload)||!hex(metadata.payload.sha256)||
     !Number.isSafeInteger(metadata.payload.bytes)||metadata.payload.bytes<2||metadata.payload.bytes>LIMIT||
     !Array.isArray(metadata.payload.chunks)||!metadata.payload.chunks.length)
    fail('CONTACT_CHECKPOINT_IDENTITY_CHANGED');
  const records=await readPayloadChunks(metadata.payload.chunks,call,sha256Utf8,suppliedChunks);
  const body=records.map(part=>part.content).join(''),measured=hash(sha256Utf8,body);
  if(measured.bytes!==metadata.payload.bytes||measured.sha256!==metadata.payload.sha256)
    fail('CONTACT_CHECKPOINT_PAYLOAD_CHANGED');
  const payload=parse(body);
  if(payload.schema!=='commons.connected-contact-checkpoint-payload/v1'||
     !plain(payload.runtime_input)||!plain(payload.journal)||
     payload.journal.input_sha256!==metadata.input_sha256||payload.journal.lease!==metadata.operation_lease||
     hash(sha256Utf8,{input_sha256:metadata.input_sha256,lease:metadata.operation_lease}).sha256!==operationKey)
    fail('CONTACT_CHECKPOINT_JOURNAL_CHANGED');
  if(payload.contact_source_activation)validateContactSourceActivation(payload.contact_source_activation,
    {journal:payload.journal,stateKey:metadata.state_key,lease:metadata.operation_lease,operationKey,sha256Utf8});
  return {location:{repository:REPOSITORY,branch,path:PATH,commit,blob_sha:file.sha},
    metadata,payload,chunk_cache:[...new Map(records.map(row=>[row.blob_sha,row])).values()],
    ...(includeOriginalReadback?{original_readback:{metadata_content:file.content,payload_text:body,
      receipt:clone(file)}}:{})};
}

/** Prepare exact historical bytes for explicit local receiving; never writes or sends. */
async function prepareConnectedContactCheckpointAdoption(options) {
  const {tools,sha256Utf8,operationKey,chunkCache,githubRefAction,
    observedAt=new Date().toISOString()}=options||{};
  if(!iso(observedAt))fail('CONTACT_CHECKPOINT_OBSERVATION_REQUIRED');
  const original=await readConnectedContactCheckpoint({tools,sha256Utf8,operationKey,chunkCache,
    githubRefAction,includeOriginalReadback:true});
  const proof=original.original_readback,location=original.location;
  const content=JSON.stringify({metadata:original.metadata,payload_text:proof.payload_text,
    original_location:location});
  return {namespace:'checkpoint',key:operationKey,content,
    origin:{kind:'git-original-checkpoint-readback',repository:location.repository,path:location.path,
      commit_sha:location.commit,blob_sha:location.blob_sha,sha256:hash(sha256Utf8,content).sha256,
      observed_at:observedAt,metadata_content:proof.metadata_content,receipt:proof.receipt}};
}


/**
 * Prepare the original operator-retained factory journal for explicit receiving.
 * The raw input and journal are retained as their own non-Git source. This
 * validates the original adoption course in memory; it performs no provider or
 * storage operation and never invokes a contact method.
 */
async function prepareConnectedContactJournalAdoption(options) {
  const {tools,factory,modules,runtimeInputText,journalText,stateKey,lease,source,
    observedAt=new Date().toISOString(),githubActorAction,githubRefAction}=options||{};
  if(typeof runtimeInputText!=='string'||typeof journalText!=='string'||
     typeof stateKey!=='string'||!stateKey||typeof lease!=='string'||!lease||
     !plain(source)||typeof source.reference!=='string'||!source.reference||
     typeof source.custodian!=='string'||!source.custodian||!iso(source.observed_at)||
     !iso(observedAt)||!factory?.createConnectedFirstContact||!modules?.sha256Utf8)
    fail('CONTACT_SESSION_ORIGINAL_SOURCE_REQUIRED',
      'Retain the complete original input/journal texts, unchanged state key and lease, and actual source custody.');
  const measuredInput=hash(modules.sha256Utf8,runtimeInputText),measuredJournal=hash(modules.sha256Utf8,journalText);
  if(measuredInput.bytes>LIMIT||measuredJournal.bytes>LIMIT)fail('CONTACT_CHECKPOINT_TOO_LARGE');
  const input=parse(runtimeInputText),journal=parse(journalText),fixed=reviewedInput(input,modules);
  if(!plain(journal)||journal.schema!=='commons.connected-first-contact/v1'||
     journal.input_sha256!==fixed.identity||journal.lease!==lease||
     canonical(journal.input)!==canonical(fixed.reviewed)||!Array.isArray(journal.events))
    fail('CONTACT_SESSION_ORIGINAL_JOURNAL_CHANGED');
  const operationKey=hash(modules.sha256Utf8,{input_sha256:fixed.identity,lease}).sha256;
  const blocked=()=>fail('CONTACT_SESSION_PREPARATION_IS_READ_ONLY');
  const selectedTools=new Proxy(tools||{}, {get(target,key){
    const value=target[key];return typeof value==='function'?blocked:value;
  }});
  // These are explicit source-validation objects, not a new initialized
  // coordinator or provider response. No supplied live storage is called.
  const inspectionStorage={kind:'commons.connected-contact-local-state/v1',
    coordinatorId:'original-session-source-validation',
    verify:async()=>({kind:'commons.connected-contact-local-state/v1'}),
    read:async()=>null,compareAndSwap:blocked,receive:blocked,history:blocked};
  const sourceOrigin={kind:'original-session-journal-readback',operation_key:operationKey,
    input_sha256:fixed.identity,operation_lease:lease,state_key:stateKey,
    runtime_input_content:runtimeInputText,runtime_input:measuredInput,
    journal_content:journalText,journal:measuredJournal,source:clone(source),observed_at:observedAt};
  const inspected=await openConnectedContactCheckpoint({
    tools:selectedTools,factory,modules,input,lease,stateKey,
    owner:'original-session-source-validation',mode:'adopt',journal:clone(journal),
    storage:inspectionStorage,originalSessionSource:sourceOrigin,githubActorAction,githubRefAction});
  const snapshot=inspected.snapshot();
  if(canonical(snapshot.journal)!==canonical(journal)||snapshot.transports.length||
     snapshot.pending_pointer!==null)
    fail('CONTACT_SESSION_ORIGINAL_JOURNAL_CHANGED');
  const payload={schema:'commons.connected-contact-checkpoint-payload/v1',
    runtime_input:input,journal,transports:[],
    ...(snapshot.session_input_revision_source?{session_input_revision_source:snapshot.session_input_revision_source}:{})};
  const payloadText=serializeCheckpointPayload(payload),measuredPayload=hash(modules.sha256Utf8,payloadText);
  if(measuredPayload.bytes>LIMIT)fail('CONTACT_CHECKPOINT_TOO_LARGE');
  const originalLocation={kind:'commons.connected-contact-session-origin/v1',
    source:clone(source),operation_key:operationKey,input_sha256:fixed.identity,
    operation_lease:lease,state_key:stateKey,
    runtime_input:{...measuredInput},journal:{...measuredJournal}};
  const metadata={schema:SCHEMA,operation_key:operationKey,input_sha256:fixed.identity,
    operation_lease:lease,state_key:stateKey,revision:1,updated_at:observedAt,active:null,
    payload:{...measuredPayload,chunks:[{kind:'local-inline',...measuredPayload}]}};
  const content=JSON.stringify({metadata,payload_text:payloadText,original_location:originalLocation});
  const origin={kind:'original-session-journal-readback',operation_key:operationKey,
    input_sha256:fixed.identity,operation_lease:lease,state_key:stateKey,
    runtime_input_content:runtimeInputText,runtime_input:measuredInput,
    journal_content:journalText,journal:measuredJournal,source:clone(source),
    observed_at:observedAt,sha256:hash(modules.sha256Utf8,content).sha256};
  const result={namespace:'checkpoint',key:operationKey,content,origin};
  if(hash(modules.sha256Utf8,JSON.stringify(result)).bytes>LIMIT)fail('CONTACT_CHECKPOINT_TOO_LARGE');
  return result;
}

module.exports={prepareConnectedContactJournalAdoption,prepareConnectedContactCheckpointAdoption,validateContactSourceActivation,validateReceivedReturnedAccountTail,validateReturnedDraftRevision,validateReceivedPreflightTail,validateReceivedCancelledSendTail,validateInterruptedAccountAttempt,reviewConnectedContactInput:reviewedInput,readUndispatchedContactContinuation,openConnectedContactCheckpoint,readConnectedContactCheckpoint,validateReceivedRateHistory,validateReceivedCompletion,validateRetainedSentReturn,validateUndispatchedNativeCall,validateReceivedUndispatchedTail,validateReceivedPendingAccountTail,validateReceivedPendingPreflightTail};
