'use strict';

// Shared Gmail sending coordination. The original contact gateway owns the
// message, recipient reservation, relationship decision and sent reconciliation.
// This module never sends mail, changes a recipient claim or permits a replay.
const REPOSITORY = 'woahwhattheheck/commons-ship-enforcer';
const SCHEMA = 'commons.gmail-account-admission/v2';
const LEGACY_SCHEMA = 'commons.gmail-account-admission/v1';
const STATE_PATH = 'state/gmail-account.json';
const LEASE_MS = 600000;
const LOCAL_STORAGE_KIND='commons.connected-contact-local-state/v1';
const LOCAL_SNAPSHOT_KIND='commons.connected-contact-local-snapshot/v1';
const LOCAL_RECEIPT_KIND='commons.connected-contact-local-receipt/v1';
const LOCAL_CAS_BINDING='commons.local-state.compareAndSwap';
const QUEUE_SCHEMA = 'commons.gmail-account-turns/v1';
const WAITING_MS = 1800000;
const TURN_MS = 90000;
const MAX_WAITING = 256;
const WRITE_SCHEMA = 'commons.gmail-account-write/v1';
const READBACK_PASSES = 2;
const CONNECTOR_SEND = 'mcp__codex_apps__gmail_send_email';
const CONNECTOR_DRAFT = 'mcp__codex_apps__gmail_send_draft';
const CONNECTOR_TOOLS = Object.freeze({[CONNECTOR_SEND]:'send_email',[CONNECTOR_DRAFT]:'send_draft'});
const NATIVE_SEND = 'gmail.users.messages.send';
const NATIVE_SEND_RESOURCE = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const SEND_BINDINGS = Object.freeze([CONNECTOR_SEND,CONNECTOR_DRAFT,NATIVE_SEND]);

// Owner-requested reduction, 2026-10-13. These are automation operating
// limits, not a claim about Google's recipient quota or guaranteed delivery.
// Existing manual Gmail access is unaffected; all observed Sent activity
// conservatively consumes headroom, including mail that later bounces.
const AUTOMATION_SCHEMA = 'commons.gmail-manual-headroom/v1';
const AUTOMATION_REFRESH_MS = 120000;
const AUTOMATION_REFRESH_SCHEMA = 'commons.gmail-usage-refresh/v1';
const AUTOMATION_POLICY = Object.freeze({
  id:'manual-headroom-20261013',window_ms:86400000,
  max_messages:400,max_recipient_units:400,min_interval_ms:216000,
  snapshot_max_age_ms:60000
});
function mailboxRecipientUnits(value) {
  if (value == null || value === '') return 0;
  if (typeof value !== 'string' || /[\r\n]/.test(value)) return null;
  let quoted=false,escaped=false,angle=0,start=0,parts=[];
  for(let i=0;i<value.length;i++){
    const c=value[i];
    if(escaped){escaped=false;continue;}
    if(quoted && c==='\\'){escaped=true;continue;}
    if(c==='"'){quoted=!quoted;continue;}
    if(!quoted && c==='<'){if(angle)return null;angle=1;}
    else if(!quoted && c==='>'){if(!angle)return null;angle=0;}
    else if(!quoted && !angle && c===','){parts.push(value.slice(start,i));start=i+1;}
  }
  if(quoted||escaped||angle)return null;
  parts.push(value.slice(start));
  for(const part of parts){
    const text=part.trim(),match=/<([^<>]+)>$/.exec(text),address=match?match[1]:text;
    if(!/^[^@\s<>,;:]+@[^@\s<>,;:]+$/.test(address))return null;
  }
  return parts.length;
}
function envelopeRecipientUnits(envelope) {
  if(!envelope || typeof envelope!=='object')return null;
  const counts=['to','cc','bcc'].map(name=>mailboxRecipientUnits(envelope[name]));
  return counts.some(count=>count===null)||counts.reduce((a,b)=>a+b,0)<1
    ? null:counts.reduce((a,b)=>a+b,0);
}
function manualHeadroomSummary(automation,now=Date.now(),proposed={messages:1,recipient_units:1}) {
  const policy=AUTOMATION_POLICY,cutoff=now-policy.window_ms;
  if(!automation)return {status:'AUTOMATION_USAGE_REQUIRED',policy:{...policy},
    reason:'Receive complete original rolling Sent activity before automated dispatch'};
  const entries=[],messageEntries=new Map();
  for(const row of automation.sent.messages){
    if(Date.parse(row.at)<=cutoff)continue;
    const entry={at:Date.parse(row.at),messages:1,recipient_units:row.recipient_units??1,
      unknown_recipient_units:row.recipient_units===null?1:0};
    entries.push(entry);messageEntries.set(row.id,entry);
  }
  // Join a definite provider message ID once, retaining the larger known
  // recipient count from Sent metadata and every original charged envelope.
  // Unknown Sent metadata still requires review. Unknown, rejected and lost
  // returns without a definite ID remain individually charged.
  for(const row of automation.attempts){
    if(Date.parse(row.at)<=cutoff)continue;
    const joined=row.message_id?messageEntries.get(row.message_id):null;
    if(joined){
      joined.recipient_units=Math.max(joined.recipient_units,row.recipient_units);
      joined.at=Math.max(joined.at,Date.parse(row.at));
      continue;
    }
    const entry={at:Date.parse(row.at),messages:1,recipient_units:row.recipient_units,
      unknown_recipient_units:0};
    entries.push(entry);
    if(row.message_id)messageEntries.set(row.message_id,entry);
  }
  entries.sort((a,b)=>a.at-b.at);
  const total=entries.reduce((sum,row)=>({messages:sum.messages+row.messages,
    recipient_units:sum.recipient_units+row.recipient_units,
    unknown_recipient_units:sum.unknown_recipient_units+row.unknown_recipient_units}),
    {messages:0,recipient_units:0,unknown_recipient_units:0});
  const expiryFor=(field,limit)=>{
    let used=total[field],until=now;
    for(const row of entries){
      if(used+proposed[field]<=limit)break;
      used-=row[field];until=row.at+policy.window_ms;
    }
    return used+proposed[field]>limit?null:until;
  };
  const messageAt=expiryFor('messages',policy.max_messages),
    recipientAt=expiryFor('recipient_units',policy.max_recipient_units);
  const last=Math.max((automation.last_dispatch_at?Date.parse(automation.last_dispatch_at):0),...entries.map(x=>x.at));
  const next=Math.max(now,messageAt||now,recipientAt||now,last+policy.min_interval_ms);
  const coverageEnd=Math.min(Date.parse(automation.sent.end),Date.parse(automation.sent.observed_at));
  const snapshotFresh=coverageEnd<=now && now-coverageEnd<=policy.snapshot_max_age_ms;
  const impossible=proposed.messages>policy.max_messages ||
    proposed.recipient_units>policy.max_recipient_units;
  return {status:impossible?'AUTOMATION_ENVELOPE_TOO_LARGE':
      total.unknown_recipient_units>0?'AUTOMATION_RECIPIENT_REVIEW_REQUIRED':next>now?'AUTOMATION_DEFERRED':snapshotFresh?'AUTOMATION_READY':'AUTOMATION_USAGE_REQUIRED',
    policy:{...policy},...total,proposed:{...proposed},
    usage_window_start:new Date(cutoff).toISOString(),
    snapshot_observed_at:automation.sent.observed_at,snapshot_coverage_end:automation.sent.end,
    snapshot_fresh:snapshotFresh,coverage_since:automation.activated_at,
    ...(next>now?{retry_after:new Date(next).toISOString()}:{}),
    reason:impossible?'Original envelope exceeds the reduced automation allowance':
      total.unknown_recipient_units>0?'Receive the original unparsed recipient metadata before automated dispatch':next>now?'Preserve manual headroom and paced automated dispatch':
      !snapshotFresh?'Refresh complete Sent activity before automated dispatch':null};
}


function mailboxRecipientAddresses(value) {
  if (value == null || value === '') return [];
  if (typeof value !== 'string' || /[\r\n]/.test(value)) return null;
  let quoted=false,escaped=false,angle=0,start=0,parts=[];
  for(let i=0;i<value.length;i++){
    const c=value[i];
    if(escaped){escaped=false;continue;}
    if(quoted && c==='\\'){escaped=true;continue;}
    if(c==='"'){quoted=!quoted;continue;}
    if(!quoted && c==='<'){if(angle)return null;angle=1;}
    else if(!quoted && c==='>'){if(!angle)return null;angle=0;}
    else if(!quoted && !angle && c===','){parts.push(value.slice(start,i));start=i+1;}
  }
  if(quoted||escaped||angle)return null;
  parts.push(value.slice(start));
  for(const part of parts){
    const text=part.trim(),match=/<([^<>]+)>$/.exec(text),address=match?match[1]:text;
    if(!/^[^@\s<>,;:]+@[^@\s<>,;:]+$/.test(address))return null;
  }
  return parts.map(part=>{const text=part.trim(),match=/<([^<>]+)>$/.exec(text);return (match?match[1]:text).toLowerCase();});
}

function canonicalMailboxEvidence(value) {
  if (Array.isArray(value)) return '['+value.map(canonicalMailboxEvidence).join(',')+']';
  if (value && typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalMailboxEvidence(value[k])).join(',')+'}';
  return JSON.stringify(value);
}

/** Receive already verified original queue evidence; this function performs no I/O. */
function validateMailboxSentReadback(input, {sha256Utf8,account,send_binding,now=Date.now()}={}) {
  const need=(ok,message)=>{if(!ok)throw new TypeError(message);};
  const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
  const id=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(x);
  const epoch=x=>Number.isSafeInteger(x)&&x>=0&&x<=now;
  const iso=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString()===x;
  const hash=x=>{const h=sha256Utf8(typeof x==='string'?x:JSON.stringify(x))?.sha256;need(hex(h),'Original SHA-256 implementation required');return h;};
  const stable=x=>hash(canonicalMailboxEvidence(x));
  const base='https://gmail.googleapis.com/gmail/v1/users/me';
  need(input&&account&&typeof sha256Utf8==='function'&&epoch(now),'Select the original account and complete readback');
  const {args,raw,observed_at,operation_key,attempt_key,dispatch_token,source_account,
    dispatch_envelope,prepared_envelope,post,sent,acceptance}=input;
  need(hex(operation_key)&&hex(attempt_key)&&hex(dispatch_token)&&iso(observed_at),
    'Original charged operation, attempt, token and first return timestamp required');
  need(source_account&&String(source_account.id)===String(account.id)&&source_account.email===account.email&&source_account.link_id===account.link_id,
    'The readback belongs to another original account');
  need(send_binding==='gmail.users.messages.send'||send_binding==='mcp__codex_apps__gmail_send_email',
    'Select the original messages.send account binding');
  need(args&&typeof args==='object'&&!Array.isArray(args)&&args.method==='POST'&&
    (args.url===base+'/messages/send'||args.resource===base+'/messages/send')&&typeof args.body==='string',
    'Keep the exact serialized POST body inside its originally charged invocation');
  if(send_binding==='gmail.users.messages.send'){
    need(args.binding===send_binding&&args.sender_email===account.email&&args.original_input?.link_id===account.link_id,
      'Original native POST account binding changed');
  }else need(args.link_id===account.link_id&&args.from_address===account.email,
    'Original local POST account binding changed');
  need(dispatch_envelope?.link_id===account.link_id&&dispatch_envelope.from_address===account.email,
    'Retain the exact originally charged address envelope');
  const units=envelopeRecipientUnits(dispatch_envelope);
  need(units!==null,'Retain the complete original recipient envelope');
  need(prepared_envelope&&typeof prepared_envelope==='object'&&!Array.isArray(prepared_envelope)&&
    prepared_envelope.sender===account.email&&Array.isArray(prepared_envelope.to)&&Array.isArray(prepared_envelope.cc)&&
    prepared_envelope.to.length+prepared_envelope.cc.length===units,
    'Retain the original complete prepared sender and recipient binding');
  const chargedTo=mailboxRecipientAddresses(dispatch_envelope.to),chargedCc=mailboxRecipientAddresses(dispatch_envelope.cc);
  need(chargedTo!==null&&chargedCc!==null&&mailboxRecipientUnits(dispatch_envelope.bcc)===0&&
    JSON.stringify(chargedTo)===JSON.stringify(prepared_envelope.to)&&
    JSON.stringify(chargedCc)===JSON.stringify(prepared_envelope.cc),
    'The original charged To/Cc addresses, order or partition differ from the prepared envelope');
  const {digest:preparedDigest,...prepared}=prepared_envelope;
  need(hex(preparedDigest)&&stable(prepared)===preparedDigest,'The prepared original envelope changed');
  const selected=prepared_envelope.selected_account;
  need(selected&&selected.link_id===account.link_id&&String(selected.profile_id)===String(account.id)&&selected.email===account.email,
    'Receive the actual original selected-account envelope');
  let originalPostBody;try{originalPostBody=JSON.parse(args.body);}catch{}
  need(typeof originalPostBody?.raw==='string'&&originalPostBody.raw.length>0,
    'The original POST must retain its full MIME payload');
  const evidence=(item,kind)=>{
    const value=item?.evidence;
    need(hex(item?.evidence_digest)&&value?.schema==='commons.mail-provider-evidence.v1'&&
      value.kind===kind&&value.sender===account.email&&typeof value.claim_id==='string'&&value.claim_id&&
      typeof value.attempt_id==='string'&&value.attempt_id&&typeof value.revision_id==='string'&&value.revision_id&&
      stable(value)===item.evidence_digest,'Complete digest-verified original provider evidence required');
    const obs=value.observation;
    need(obs?.schema==='commons.gmail-http-observation.v1'&&Number.isInteger(obs.status)&&
      obs.status>=200&&obs.status<300&&epoch(obs.observed_at)&&typeof obs.body==='string'&&
      obs.headers&&typeof obs.headers==='object'&&!Array.isArray(obs.headers),
      'Retain the complete original successful HTTP observation');
    let body;try{body=JSON.parse(obs.body);}catch{}
    need(body&&typeof body==='object'&&!Array.isArray(body)&&!body.error&&id(body.id)&&id(body.threadId),
      'Original Gmail response identity is incomplete');
    return {value,obs,body};
  };
  const p=evidence(post,'POST_RESPONSE'),s=evidence(sent,'SENT_READBACK');
  need(['claim_id','attempt_id','revision_id','sender'].every(k=>p.value[k]===s.value[k]),
    'The POST and SENT readback name different original attempts');
  need(p.obs.method==='POST'&&p.obs.url===base+'/messages/send'&&
    p.value.invocation?.method==='POST'&&p.value.invocation.url===p.obs.url&&p.value.invocation.body===args.body,
    'The provider evidence differs from the exact charged POST bytes');
  need(s.obs.method==='GET'&&s.obs.url===base+'/messages/'+p.body.id+'?format=raw'&&
    s.body.id===p.body.id&&s.body.threadId===p.body.threadId&&
    Array.isArray(s.body.labelIds)&&s.body.labelIds.includes('SENT')&&!s.body.labelIds.includes('DRAFT')&&
    typeof s.body.raw==='string'&&s.body.raw.length>0,
    'Receive the original separate full SENT message');
  const returnedAt=Date.parse(observed_at);
  need(p.obs.observed_at<=returnedAt&&returnedAt<=s.obs.observed_at&&returnedAt<=now,
    'Keep the original POST and subsequent SENT observation chronology');
  const marker='<tjlabs.'+hash(p.value.claim_id)+'@tjlabs.local>';
  const receipt=(r,reconciled)=>{
    need(r?.status==='PROVIDER_ACCEPTED'&&r.provider==='gmail'&&r.reconciled===reconciled&&
      r.providerMessageId===p.body.id&&r.providerThreadId===p.body.threadId&&
      r.messageId===marker&&r.rfcMessageId===marker&&r.envelopeDigest===preparedDigest&&
      r.conversationKey===prepared_envelope.conversationKey&&epoch(r.acceptedAt),
      'The original provider receipt changed its envelope or RFC identity');
  };
  receipt(p.value.receipt,false);receipt(s.value.receipt,true);
  need(hex(acceptance?.receipt_digest)&&stable(acceptance.receipt)===acceptance.receipt_digest,
    'Hydrate the complete original acceptance receipt');
  receipt(acceptance.receipt,false);
  need(stable(acceptance.receipt.providerObservation)===stable(p.obs)&&
    stable(acceptance.receipt.invocation)===stable(p.value.invocation),
    'The original acceptance and POST evidence differ');
  let response;
  if(raw?.binding==='gmail.users.messages.send'){
    need(raw.observed_at===observed_at&&raw.invocation!=null&&hash(raw.invocation)===hash(args),
      'Retain the original native returned invocation and timestamp');
    response=raw.native_response;
    need(response?.status===p.obs.status&&response.body_text===p.obs.body&&
      stable(response.body)===stable(p.body),'The original native POST return changed');
  }else{
    response=raw?.provider_transport;
    need(raw?.isError===false&&response?.schema==='commons.local-provider-http/v1'&&
      response.method==='POST'&&response.url===p.obs.url&&response.status===p.obs.status&&
      response.body===p.obs.body&&stable(raw.structuredContent)===stable(p.body),
      'Retain the exact original local HTTP return');
  }
  if(s.body.internalDate!==undefined)need(/^\d+$/.test(s.body.internalDate)&&
    Number.isSafeInteger(Number(s.body.internalDate))&&Number(s.body.internalDate)<=s.obs.observed_at,
    'Preserve the actual original SENT internal date');
  return {schema:'commons.gmail-sent-readback/v1',operation_key,attempt_key,dispatch_token,
    args_sha256:hash(args),envelope_sha256:hash(dispatch_envelope),recipient_units:units,
    return_sha256:hash(raw),returned_at:observed_at,post_observed_at:new Date(p.obs.observed_at).toISOString(),
    observed_at:new Date(s.obs.observed_at).toISOString(),message_id:p.body.id,thread_id:p.body.threadId,
    claim_id:p.value.claim_id,provider_attempt_id:p.value.attempt_id,revision_id:p.value.revision_id,
    prepared_envelope_sha256:preparedDigest,rfc_message_id:marker,
    post_evidence_sha256:post.evidence_digest,sent_evidence_sha256:sent.evidence_digest,
    acceptance_sha256:acceptance.receipt_digest,source_account:{id:String(account.id),email:account.email,link_id:account.link_id}};
}

function createAccountHandle(options, historyOnly=false) {
  const {tools, sha256Utf8, classifyReturnedGmailRateLimit, classifyReturnedSendRateLimit,
    account, record, history, githubRefAction} = options || {};
  const storage=options?.storage;
  if (storage!==undefined && (storage?.kind!==LOCAL_STORAGE_KIND ||
      typeof storage.coordinatorId!=='string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(storage.coordinatorId) ||
      ['verify','read','compareAndSwap','history'].some(name=>typeof storage[name]!=='function')))
    throw new TypeError('Select the explicit shared local-state coordinator and complete storage interface');
  const coordinatorId=storage?.coordinatorId;
  const sendBinding = options?.send_binding === undefined ? CONNECTOR_SEND : options.send_binding;
  if (!SEND_BINDINGS.includes(sendBinding))
    throw new TypeError('Select the original Gmail send_email, send_draft or native users.messages.send binding');
  const classifyLimit = typeof classifyReturnedSendRateLimit === 'function'
    ? classifyReturnedSendRateLimit : classifyReturnedGmailRateLimit;
  if (history !== undefined && typeof history !== 'function')
    throw new TypeError('Original nested account history reader required');
  if (typeof sha256Utf8 !== 'function' || typeof classifyReturnedGmailRateLimit !== 'function' ||
      (!historyOnly && typeof record !== 'function'))
    throw new TypeError('Original hash, returned-provider classifier and nested journal required');
  if (!account || !/^\d+$/.test(String(account.id)) ||
      typeof account.email !== 'string' || !account.email.includes('@') ||
      typeof account.link_id !== 'string' || !account.link_id)
    throw new TypeError('Configured native Gmail account required');
  const selected = Object.freeze({id:String(account.id), email:account.email, link_id:account.link_id});
  // Prefer the connected repository action; older toolsets retain the original read.
  const repositoryReader = typeof tools?.mcp__codex_apps__github_get_repo === 'function'
    ? 'github_get_repo' : 'github_fetch';
  const refChoices = ['github_fetch','github_fetch_commit'];
  if (githubRefAction !== undefined && !refChoices.includes(githubRefAction))
    throw new TypeError('Select the native github_fetch or github_fetch_commit account ref reader');
  const refReader = githubRefAction === undefined
    ? historyOnly ? 'github_fetch' : refChoices.find(name=>typeof tools?.['mcp__codex_apps__'+name]==='function')
    : githubRefAction;
  // Select actual bindings before invocation. A returned failure never changes
  // credentials or replays a read under a different action.
  const comparisonReader = typeof tools?.mcp__codex_apps__github_compare_commits === 'function'
    ? 'github_compare_commits' : 'github_fetch';
  const bindings = storage ? ['gmail_get_profile'] :
    [repositoryReader,refReader,'github_fetch_file','gmail_get_profile'];
  for (const name of bindings)
    if (!historyOnly && typeof tools?.['mcp__codex_apps__' + name] !== 'function')
      throw new TypeError('Missing native account binding: ' + name);
  const digest = value => {
    const result = sha256Utf8(typeof value === 'string' ? value : JSON.stringify(value));
    if (!/^[a-f0-9]{64}$/.test(result?.sha256 || '')) throw new TypeError('Original SHA-256 result required');
    return result.sha256;
  };
  const key = digest({provider:'gmail', profile_id:selected.id, activity:'Mail sending'});
  const branch = 'mailbox-admission/v1/' + key;
  let verified = null;
  let sequence = 0, callSequence = 0;
  let floor = null, queue = Promise.resolve();
  const writes = new Map(), verifiedWrites = new Set(), compared = new Set();
  const immutableFiles = new Map();
  // Original verified account history may contain a profile deadline that a
  // later, longer method deadline replaced in the legacy scalar field.
  const knownDeadlines = new Map();
  let historicalStaleReads = [];
  const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value;
  const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const gitSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
  const copy = value => JSON.parse(JSON.stringify(value));
  const refUrl = name => 'https://api.github.com/repos/' + REPOSITORY + '/git/ref/heads/' + name;
  const branchCommitUrl = 'https://api.github.com/repos/' + REPOSITORY + '/commits/' + encodeURIComponent(branch);
  function failure(raw) {
    const native = raw?.structuredContent;
    return Object.assign(new Error(native?.error || 'Native account provider operation failed'), {
      status:Number(native?.error_data?.status ?? native?.error_data?.code ??
        native?.error_data?.response?.status ?? native?.status ?? 0), native:raw
    });
  }
  async function invoke(name, args, beforeDispatch) {
    if (['github_create_branch','github_create_file','github_update_file'].includes(name))
      throw Object.assign(new Error('Private Git account-state writes are disabled; receive the original account into the selected shared local coordinator.'),{code:'LOCAL_ACCOUNT_STORAGE_REQUIRED'});
    const binding = 'mcp__codex_apps__' + name;
    const call_id = digest({account_key:key,binding,args_sha256:digest(args),
      observed_at:new Date().toISOString(),sequence:++callSequence});
    await record({phase:'invoking', call_id, binding, args, observed_at:new Date().toISOString()});
    if (beforeDispatch) {
      try { beforeDispatch(); }
      catch (error) {
        await record({phase:'not-invoked', call_id, binding,
          reason:'dispatch-precondition-ended', uncertain:false, observed_at:new Date().toISOString()});
        throw error;
      }
    }
    let raw;
    try { raw = await tools[binding](args); }
    catch (error) {
      await record({phase:'failed', call_id, binding, status:Number(error?.status || 0),
        message:String(error?.message || error), observed_at:new Date().toISOString()});
      throw error;
    }
    await record({phase:'returned', call_id, binding, raw, observed_at:new Date().toISOString()});
    if (raw?.isError) throw failure(raw);
    const value = raw?.structuredContent;
    if (!value || typeof value !== 'object') throw new TypeError('Complete native account response required');
    if (name === 'github_fetch') {
      if (typeof value.content !== 'string') throw new TypeError('Complete native repository response required');
      return JSON.parse(value.content);
    }
    return value;
  }
  function receivedNativeHead(value) {
    const commit=value?.commit, sha=commit?.sha;
    if (!gitSha(sha) || commit.repository_full_name!==REPOSITORY ||
        commit.url!=='https://api.github.com/repos/'+REPOSITORY+'/commits/'+sha ||
        commit.html_url!=='https://github.com/'+REPOSITORY+'/commit/'+sha ||
        value.url!==commit.html_url)
      throw new TypeError('Original native account commit repository or identity changed');
    return sha;
  }
  function absentHead(error,name) {
    if (error.status===404) return true;
    const native=error.native?.structuredContent, data=native?.error_data;
    return refReader==='github_fetch_commit' && error.status===422 &&
      native?.error_code==='INVALID_ARGUMENT' && native.commit===undefined &&
      data?.message==='No commit found for SHA: refs/heads/'+name &&
      data.documentation_url==='https://docs.github.com/rest/commits/commits#get-a-commit';
  }
  async function readHead(name,alternate=false) {
    if (refReader==='github_fetch_commit')
      return receivedNativeHead(await invoke(refReader,{repo_full_name:REPOSITORY,commit_sha:'refs/heads/'+name}));
    const result=await invoke(refReader,{url:alternate
      ? 'https://api.github.com/repos/'+REPOSITORY+'/commits/'+encodeURIComponent(name) : refUrl(name)});
    const sha=alternate ? result.sha
      : result.ref==='refs/heads/'+name && result.object?.type==='commit' && result.object.sha;
    if (!gitSha(sha)) throw new TypeError('Shared account branch identity changed');
    return sha;
  }
  function receivedComparison(result,base,head,native=false) {
    if (result.base_commit?.sha!==base || native &&
        (result.repository_full_name!==REPOSITORY || result.base!==base || result.head!==head))
      throw new TypeError('Native account ancestry response has another repository or selection');
    return ['ahead','identical'].includes(result.status) && result.merge_base_commit?.sha===base;
  }
  function validateRepository(repo) {
    const names = [repo?.full_name, repo?.repository_full_name].filter(value => value != null);
    const privateKnown = repo?.private === true || repo?.visibility === 'private';
    const privateConflict = repo?.private === false ||
      (repo?.visibility != null && repo.visibility !== 'private');
    if (!names.length || names.some(value => value !== REPOSITORY) || !privateKnown ||
        privateConflict || repo.archived === true)
      throw new TypeError('Existing private account-state repository required');
    return repo;
  }
  function validateProfile(profile) {
    if (String(profile?.id) !== selected.id || profile?.email !== selected.email)
      throw new TypeError('Original configured Gmail identity changed');
    return profile;
  }
  function retainedRepositoryVerification() {
    // The original carrier supplies only this input/lease's nested history.
    // This restores an uninterrupted handle's identity cache, never a current
    // repository permission, account-state read, provider deadline or send token.
    const scope=options?.verificationScope;
    if (scope === undefined || !history) return null;
    if (!hex(scope.operation_key) || !hex(scope.input_sha256) ||
        typeof scope.operation_lease!=='string' || !scope.operation_lease ||
        /[\x00-\x1f\x7f]/.test(scope.operation_lease))
      throw new TypeError('Original operation identity required for repository verification receiving');
    const events=history();
    if (!Array.isArray(events)) throw new TypeError('Complete original nested account event array required');
    const pending=new Map(), completed=new Set();
    let repository=null, profile=null;
    for (let index=0;index<events.length;index++) {
      const event=events[index], binding=event?.binding;
      if (!['mcp__codex_apps__github_get_repo','mcp__codex_apps__github_fetch',
            'mcp__codex_apps__gmail_get_profile'].includes(binding)) continue;
      if (!hex(event.call_id)) continue; // Older unpaired records never seed verification.
      const id=binding+':'+event.call_id;
      if (event.phase==='invoking') {
        if (pending.has(id) || completed.has(id))
          throw new TypeError('Original repository verification call identity is duplicated');
        const args=event.args;
        const kind=binding==='mcp__codex_apps__github_get_repo' &&
          args?.repository_full_name===REPOSITORY && Object.keys(args).length===1 ? 'repository'
          : binding==='mcp__codex_apps__github_fetch' &&
            args?.url==='https://api.github.com/repos/'+REPOSITORY && Object.keys(args).length===1 ? 'repository'
          : binding==='mcp__codex_apps__gmail_get_profile' &&
            args?.link_id===selected.link_id && Object.keys(args).length===1 ? 'profile' : null;
        if (kind) pending.set(id,{event,index,kind});
        continue;
      }
      if (!['returned','failed'].includes(event.phase) || !pending.has(id)) continue;
      const original=pending.get(id); pending.delete(id); completed.add(id);
      if (!iso(original.event.observed_at) || !iso(event.observed_at) ||
          Date.parse(event.observed_at)<Date.parse(original.event.observed_at))
        throw new TypeError('Original repository verification timestamps changed');
      if (event.phase==='failed' || event.raw?.isError) continue;
      let value=event.raw?.structuredContent;
      if (!value || typeof value!=='object')
        throw new TypeError('Complete original repository verification response required');
      if (binding==='mcp__codex_apps__github_fetch') {
        if (typeof value.content!=='string')
          throw new TypeError('Complete original repository verification body required');
        value=JSON.parse(value.content);
      }
      if (original.kind==='repository') validateRepository(value);
      else validateProfile(value);
      const receipt={binding,call_id:event.call_id,invocation_index:original.index,return_index:index,
        invoked_at:original.event.observed_at,verified_at:event.observed_at,
        args_sha256:digest(original.event.args),return_sha256:digest(event.raw)};
      if (original.kind==='repository') repository={value,receipt};
      else profile={value,receipt};
    }
    if (!repository || !profile) return null;
    return {scope:copy(scope),repository,profile};
  }
  async function verify() {
    if (!verified) verified = (async () => {
      if (storage) {
        if (storage.coordinatorId!==coordinatorId) throw new TypeError('Original local coordinator identity changed');
        const authority=await storage.verify();
        if (authority?.kind!==LOCAL_STORAGE_KIND || authority.coordinator_id!==coordinatorId ||
            typeof authority.authority?.scope_id!=='string' || !authority.authority.scope_id ||
            !Array.isArray(authority.authority.accounts) ||
            authority.authority.accounts.filter(row=>row.account_key===key && row.profile_id===selected.id).length!==1 ||
            authority.authority.accounts.some(row=>row.account_key===key && row.profile_id!==selected.id))
          throw new TypeError('Shared coordinator authority does not contain this original Gmail account');
        const authoritySha=digest(authority.authority);
        if (localAuthoritySha && localAuthoritySha!==authoritySha) throw new TypeError('Shared coordinator authority changed');
        validateProfile(await invoke('gmail_get_profile',{link_id:selected.link_id}));
        localAuthoritySha=authoritySha;
        await record({phase:'local-account-storage-verified',storage_kind:LOCAL_STORAGE_KIND,
          coordinator_id:coordinatorId,authority_sha256:authoritySha,account_key:key,
          profile_id:selected.id,observed_at:new Date().toISOString()});
        return true;
      }
      const retained=retainedRepositoryVerification();
      if (retained) {
        // The selected native sender is fresh even when its earlier paired
        // identity is retained. Current head/CAS and Gmail preflight follow.
        validateProfile(await invoke('gmail_get_profile',{link_id:selected.link_id}));
        await record({phase:'original-repository-verification-restored',
          repository:REPOSITORY,account_key:key,profile_id:selected.id,
          scope:retained.scope,repository_receipt:retained.repository.receipt,
          profile_receipt:retained.profile.receipt,
          repository_id:retained.repository.value.id ?? null,
          original_verified_at:retained.repository.receipt.verified_at,
          observed_at:new Date().toISOString()});
        return true;
      }
      const results = await Promise.allSettled([
        invoke(repositoryReader, repositoryReader === 'github_get_repo'
          ? {repository_full_name:REPOSITORY}
          : {url:'https://api.github.com/repos/' + REPOSITORY}),
        invoke('gmail_get_profile', {link_id:selected.link_id})
      ]);
      for (const result of results) if (result.status === 'rejected') throw result.reason;
      const [repo, profile] = results.map(result => result.value);
      validateRepository(repo);
      validateProfile(profile);
      return true;
    })();
    try { await verified; } catch (error) { verified = null; throw error; }
  }
  function initial() {
    return {schema:SCHEMA, account_key:key, provider:'gmail', profile_id:selected.id,
      activity:'Mail sending', revision:0, not_before:null, deadline_source:null,
      active:null, last_release:null, updated_at:new Date().toISOString()};
  }
  function classifyNativeLimit(raw, observedAt) {
    const response = raw?.native_response;
    if (raw?.binding !== NATIVE_SEND || raw.observed_at !== observedAt ||
        !iso(observedAt) || response?.status !== 429 ||
        typeof response.body_text !== 'string') return null;
    let body;
    try { body = JSON.parse(response.body_text); } catch { return null; }
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        !response.body || typeof response.body !== 'object' || Array.isArray(response.body) ||
        digest(body) !== digest(response.body) ||
        Object.keys(body).some(name => name !== 'error')) return null;
    const error = body.error;
    if (!error || error.code !== 429 ||
        error.status != null && error.status !== 'RESOURCE_EXHAUSTED' ||
        !Array.isArray(error.errors) || !error.errors.length ||
        typeof error.message !== 'string') return null;
    const match = /^User-rate limit exceeded\.\s+Retry after (\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z) \(Mail sending\)$/.exec(error.message);
    if (!match || !iso(match[1]) || error.errors.some(item =>
        !item || !['global','usageLimits'].includes(item.domain) ||
        !['rateLimitExceeded','userRateLimitExceeded'].includes(item.reason) ||
        item.message !== error.message)) return null;
    // A sending-profile error identifies the scope; an actual Retry-After
    // header can lengthen its returned deadline, but cannot create that scope.
    let retryAfter = match[1];
    const header = response.headers?.['retry-after'];
    if (header != null && header !== '') {
      const value = String(header).trim();
      const milliseconds = /^\d+$/.test(value)
        ? Date.parse(observedAt) + Number(value)*1000 : Date.parse(value);
      if (Number.isFinite(milliseconds) && milliseconds > Date.parse(retryAfter) &&
          milliseconds <= 8640000000000000)
        retryAfter = new Date(milliseconds).toISOString();
    }
    return {retry_after:retryAfter,provider_status:429,provider_reason:'rateLimitExceeded',
      provider_service:'gmail',activity:'Mail sending',
      scope:{kind:'gmail_profile',profile_id:selected.id},binding:NATIVE_SEND};
  }
  function classifyProof(proof) {
    return proof?.binding === NATIVE_SEND
      ? classifyNativeLimit(proof.raw,proof.observed_at)
      : classifyLimit(proof?.raw,proof?.observed_at);
  }
  function scopeKey(classified) {
    return classified?.provider_service === 'connector' ? classified.scope.binding : 'gmail_profile';
  }
  function nativeInvocationMatches(invocation) {
    return invocation?.binding === NATIVE_SEND && invocation.method === 'POST' &&
      invocation.resource === NATIVE_SEND_RESOURCE &&
      typeof invocation.sender_email === 'string' &&
      invocation.sender_email.toLowerCase() === selected.email.toLowerCase() &&
      invocation.original_input?.link_id === selected.link_id;
  }
  function validateDeadline(row) {
    const proof = row?.deadline_source, classified = classifyProof(proof);
    if (!iso(row?.not_before) || classified?.retry_after !== row.not_before ||
        !hex(proof?.operation_key) || !hex(proof?.invocation_sha256) ||
        !hex(proof?.return_sha256) || proof.return_sha256 !== digest(proof.raw) ||
        proof.profile_id !== selected.id || !iso(proof.observed_at))
      throw new TypeError('Account deadline requires its complete original returned limit');
    if (proof.binding === NATIVE_SEND) {
      const origin = proof.source_account;
      if (classified.provider_service !== 'gmail' ||
          digest(proof.scope) !== digest({kind:'gmail_profile',profile_id:selected.id}) ||
          !origin || String(origin.id) !== selected.id ||
          origin.email !== selected.email || origin.link_id !== selected.link_id ||
          !nativeInvocationMatches(proof.invocation) ||
          digest(proof.invocation) !== proof.invocation_sha256 ||
          proof.raw.invocation != null && digest(proof.raw.invocation) !== proof.invocation_sha256)
        throw new TypeError('Native Gmail deadline requires its actual sender, invocation and HTTP return');
    } else if (classified.provider_service === 'connector') {
      // Receive the original untyped v1 proof unchanged. New connector proofs
      // retain their exact method, mailbox and actual returned response.
      const legacy = proof.scope === undefined && proof.source_account === undefined &&
        proof.binding === undefined;
      const origin = proof.source_account;
      if (classified.scope?.kind !== 'connector_tool' ||
          !Object.hasOwn(CONNECTOR_TOOLS,classified.scope.binding) ||
          CONNECTOR_TOOLS[classified.scope.binding] !== classified.scope.tool ||
          legacy && classified.scope.binding !== CONNECTOR_SEND ||
          !legacy && (digest(proof.scope) !== digest(classified.scope) ||
            proof.binding !== classified.scope.binding || !origin || String(origin.id) !== selected.id ||
            origin.email !== selected.email || origin.link_id !== selected.link_id))
        throw new TypeError('Method deadline must retain its actual connector scope and original sender');
    } else if (proof.scope !== undefined || proof.source_account !== undefined || proof.binding !== undefined)
      throw new TypeError('Gmail profile deadline has conflicting connector scope');
    return classified;
  }
  function mergeDeadline(rows, row) {
    const key = scopeKey(classifyProof(row.deadline_source));
    const previous = rows.get(key);
    if (!previous || Date.parse(row.not_before) > Date.parse(previous.not_before))
      rows.set(key,row);
  }
  function deadlineRows(state, includeKnown=true) {
    const rows = new Map(includeKnown ? knownDeadlines : []);
    for (const row of state.provider_deadlines || []) mergeDeadline(rows,row);
    if (state.not_before != null)
      mergeDeadline(rows,{not_before:state.not_before,deadline_source:state.deadline_source});
    return [...rows].sort((a,b)=>a[0].localeCompare(b[0])).map(([,row])=>row);
  }
  function retainDeadlines(state) {
    const rows = deadlineRows(state);
    let notBefore = state.not_before, proof = state.deadline_source;
    for (const row of rows) if (!notBefore || Date.parse(row.not_before) > Date.parse(notBefore)) {
      notBefore = row.not_before; proof = row.deadline_source;
    }
    return {...state,not_before:notBefore,deadline_source:proof,
      ...(rows.length ? {provider_deadlines:copy(rows)} : {})};
  }
  function providerDeadline(state, binding=sendBinding) {
    let selectedRow = null;
    for (const row of deadlineRows(state)) {
      const scope = scopeKey(classifyProof(row.deadline_source));
      if (scope !== 'gmail_profile' && scope !== binding) continue;
      if (!selectedRow || Date.parse(row.not_before) > Date.parse(selectedRow.not_before))
        selectedRow = row;
    }
    return selectedRow;
  }
  function validateIdentity(state) {
    // Immutable accepted v1 writes remain original source. Dispatch and every
    // new CAS require v2 below; accepting history does not reopen legacy admission.
    if (![SCHEMA,LEGACY_SCHEMA].includes(state?.schema) || state.account_key !== key || state.provider !== 'gmail' ||
        state.profile_id !== selected.id || state.activity !== 'Mail sending' ||
        !Number.isSafeInteger(state.revision) || state.revision < 0 || !iso(state.updated_at))
      throw new TypeError('Shared native account state does not match this account');
    return state;
  }

  function validateAutomation(value) {
    if(value===undefined)return;
    if(!value || value.schema!==AUTOMATION_SCHEMA ||
        digest(value.policy)!==digest(AUTOMATION_POLICY) || !iso(value.activated_at) ||
        !value.sent || !iso(value.sent.observed_at) || !iso(value.sent.start) || !iso(value.sent.end) ||
        Date.parse(value.sent.end)<=Date.parse(value.sent.start) ||
        Date.parse(value.sent.end)-Date.parse(value.sent.start)<AUTOMATION_POLICY.window_ms ||
        !Number.isSafeInteger(value.sent.pages) || value.sent.pages<1 ||
        !hex(value.sent.ids_sha256) || !Array.isArray(value.sent.messages) ||
        value.sent.messages.length>10000 || !Array.isArray(value.attempts) || value.attempts.length>2000 ||
        value.last_dispatch_at!==null && !iso(value.last_dispatch_at))
      throw new TypeError('Complete original manual-headroom policy and activity coverage required');
    const ids=new Set(),tokens=new Set();
    for(const row of value.sent.messages){
      if(!row || typeof row.id!=='string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(row.id) ||
          ids.has(row.id) || !iso(row.at) ||
          row.recipient_units!==null && (!Number.isSafeInteger(row.recipient_units) || row.recipient_units<1))
        throw new TypeError('Original Sent activity identity or recipient count is incomplete');
      ids.add(row.id);
    }
    for(const row of value.attempts){
      if(!row || !hex(row.token) || tokens.has(row.token) || !hex(row.operation_key) ||
          !hex(row.attempt_key) || !hex(row.args_sha256) || !hex(row.envelope_sha256) ||
          !SEND_BINDINGS.includes(row.send_binding) || !iso(row.at) ||
          !Number.isSafeInteger(row.recipient_units) || row.recipient_units<1 ||
          row.message_id!==null && (typeof row.message_id!=='string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(row.message_id)) ||
          row.return_sha256!==null && !hex(row.return_sha256))
        throw new TypeError('Original automated dispatch debit is incomplete');

      if(row.sent_readback!==undefined){
        const r=row.sent_readback;
        if(r?.schema!=='commons.gmail-sent-readback/v1'||r.dispatch_token!==row.token||
          r.operation_key!==row.operation_key||r.attempt_key!==row.attempt_key||
          r.args_sha256!==row.args_sha256||r.envelope_sha256!==row.envelope_sha256||
          r.recipient_units!==row.recipient_units||r.return_sha256!==row.return_sha256||
          r.message_id!==row.message_id||!hex(r.post_evidence_sha256)||!hex(r.sent_evidence_sha256)||
          !hex(r.acceptance_sha256)||!hex(r.prepared_envelope_sha256)||
          !iso(r.returned_at)||!iso(r.post_observed_at)||!iso(r.observed_at)||
          Date.parse(r.post_observed_at)<Date.parse(row.at)||
          Date.parse(r.returned_at)<Date.parse(r.post_observed_at)||Date.parse(r.observed_at)<Date.parse(r.returned_at)||
          row.returned_at!=null&&r.returned_at!==row.returned_at||
          !r.source_account||r.source_account.id!==selected.id||r.source_account.email!==selected.email||
          r.source_account.link_id!==selected.link_id||
          typeof r.thread_id!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(r.thread_id)||
          typeof r.claim_id!=='string'||!r.claim_id||typeof r.provider_attempt_id!=='string'||!r.provider_attempt_id||
          typeof r.revision_id!=='string'||!r.revision_id||
          r.rfc_message_id!=='<tjlabs.'+digest(r.claim_id)+'@tjlabs.local>')
          throw new TypeError('The retained original SENT readback identity is incomplete');
      }
      tokens.add(row.token);
    }
  }
  function automationDecision(state,proposed) {
    const result=manualHeadroomSummary(state.automation,Date.now(),proposed);
    return {...result,account_key:key};
  }
  function activeUsageRefresh(state,now=Date.now()) {
    const value=state.automation_usage_refresh;
    if(value===undefined || value===null)return null;
    if(value.schema!==AUTOMATION_REFRESH_SCHEMA || !hex(value.token) ||
        !iso(value.claimed_at) || !iso(value.expires_at) ||
        Date.parse(value.expires_at)-Date.parse(value.claimed_at)!==AUTOMATION_REFRESH_MS)
      throw new TypeError('Complete original account usage-refresh lease required');
    return Date.parse(value.expires_at)>now?value:null;
  }
  function usageRefreshWaiting(state) {
    const refresh=activeUsageRefresh(state);
    return {status:refresh?'AUTOMATION_USAGE_REFRESHING':'AUTOMATION_USAGE_REQUIRED',
      account_key:key,retry_after:refresh?.expires_at || new Date().toISOString(),
      reason:refresh?'The original account usage refresh is already running':
        'Receive a complete current account usage selection'};
  }
  async function refreshAutomationUsage({force=false}={}) {
    if(typeof force!=='boolean')throw new TypeError('Explicit usage refresh selection required');
    const compatibility=await ensureCurrentSchema();
    if(!['ACCOUNT_SOURCE_CURRENT','ACCOUNT_SOURCE_UPGRADED'].includes(compatibility.status))return compatibility;
    const fresh=automation=>automation && Math.min(Date.parse(automation.sent.end),Date.parse(automation.sent.observed_at))<=Date.now() &&
      Date.now()-Math.min(Date.parse(automation.sent.end),Date.parse(automation.sent.observed_at))<=AUTOMATION_POLICY.snapshot_max_age_ms;
    const before=await readState();
    if(!force && fresh(before.state.automation))
      return {status:'AUTOMATION_USAGE_CURRENT',account_key:key,usage:automationDecision(before.state)};
    const claimed=await change(state=>{
      if(!force && fresh(state.automation))
        return {result:{status:'AUTOMATION_USAGE_CURRENT',account_key:key,usage:automationDecision(state)}};
      if(activeUsageRefresh(state))return {result:usageRefreshWaiting(state)};
      const now=Date.now(),refresh={schema:AUTOMATION_REFRESH_SCHEMA,
        token:digest({account_key:key,revision:state.revision+1,at:now,
          purpose:'shared-rolling-sent-refresh',sequence:++sequence}),
        claimed_at:new Date(now).toISOString(),expires_at:new Date(now+AUTOMATION_REFRESH_MS).toISOString()};
      return {next:{...state,automation_usage_refresh:refresh},
        result:{status:'AUTOMATION_USAGE_REFRESH_CLAIMED',refresh,account_key:key}};
    });
    if(claimed.status!=='AUTOMATION_USAGE_REFRESH_CLAIMED'){
      const {state,...summary}=claimed;return summary;
    }
    // Receiving the accepted CAS can outlast the refresh lease. Reconcile the
    // current owner before beginning an already expired mailbox scan.
    if(Date.parse(claimed.refresh.expires_at)<=Date.now())
      return usageRefreshWaiting((await readState()).state);
    // A journal write can finish after this lease expires. Check again after
    // that awaited write, immediately before every actual Gmail read. A read
    // already in progress may finish; the original final CAS still owns its
    // complete result only while its exact token remains current.
    const expiredRefresh = new Error('Original account usage-refresh lease expired before dispatch');
    const dispatchUsageRead = async (name,args) => {
      try {
        const data = await invoke(name,args,() => {
          if(Date.parse(claimed.refresh.expires_at)<=Date.now())throw expiredRefresh;
        });
        return {data};
      } catch(error) {
        if(error!==expiredRefresh)throw error;
        return {deferred:usageRefreshWaiting((await readState()).state)};
      }
    };
    const prior=claimed.state.automation,now=Date.now();
    for(const name of ['gmail_search_email_ids','gmail_batch_read_email'])
      if(typeof tools?.['mcp__codex_apps__'+name]!=='function')
        throw new TypeError('Original Gmail rolling-activity reader unavailable: '+name);
    // Absolute bounds do not move between pages. Include boundary seconds
    // conservatively, then use original internal_date for rolling expiration.
    const start=Math.floor(now/1000)-86401,end=Math.floor(now/1000)+1;
    const query='after:'+start+' before:'+end,ids=new Set(),cursors=new Set(),proofs=[];
    let cursor=null,pages=0;
    do {
      const args={link_id:selected.link_id,label_ids:['SENT'],query,max_results:100,
        ...(cursor?{next_page_token:cursor}:{})};
      const received=await dispatchUsageRead('gmail_search_email_ids',args);
      if(received.deferred)return received.deferred;
      const found=received.data;pages++;
      if(!Array.isArray(found.message_ids) ||
          found.message_ids.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(id)))
        throw new TypeError('Complete original Sent ID page required');
      for(const id of found.message_ids)ids.add(id);
      proofs.push(digest({args,result:found}));
      const next=found.next_page_token;
      if(next!==null && (typeof next!=='string'||!next||next.length>4096||cursors.has(next)))
        throw new TypeError('Original Sent pagination is incomplete');
      if(next)cursors.add(next);
      cursor=next||null;
      if(ids.size>10000 || pages>100)
        throw new TypeError('Retain original large Sent history for a complete activity receiving');
    } while(cursor);
    const known=new Map((prior?.sent.messages||[]).map(row=>[row.id,row]));
    const missing=[...ids].filter(id=>!known.has(id)||known.get(id).recipient_units===null);
    for(let offset=0;offset<missing.length;offset+=100){
      const selectedIds=missing.slice(offset,offset+100);
      const args={link_id:selected.link_id,message_ids:selectedIds};
      const received=await dispatchUsageRead('gmail_batch_read_email',args);
      if(received.deferred)return received.deferred;
      const found=received.data;
      if(!Array.isArray(found.responses)||found.responses.length!==selectedIds.length)
        throw new TypeError('Complete original Sent metadata receiving required');
      const batch=new Set();
      for(const message of found.responses){
        if(!selectedIds.includes(message?.id)||batch.has(message.id)||
            !/^\d+$/.test(message.internal_date||'') ||
            !Array.isArray(message.label_ids) || !message.label_ids.includes('SENT'))
          throw new TypeError('Original Sent metadata identity is incomplete');
        batch.add(message.id);
        const epoch=Number(message.internal_date);
        if(!Number.isSafeInteger(epoch)||epoch<start*1000-1000||epoch>end*1000)
          throw new TypeError('Original Sent timestamp is outside its fixed receiving window');
        const headers=message.payload?.headers;
        let units=null;
        if(Array.isArray(headers)){
          const selectedHeaders={};
          for(const name of ['to','cc','bcc']){
            const values=headers.filter(h=>String(h.name).toLowerCase()===name).map(h=>h.value);
            selectedHeaders[name]=values.join(',');
          }
          units=envelopeRecipientUnits(selectedHeaders);
        }
        known.set(message.id,{id:message.id,at:new Date(epoch).toISOString(),recipient_units:units});
      }
      proofs.push(digest({args,result:found}));
    }
    const observed_at=new Date().toISOString(),snapshot={
      start:new Date(start*1000).toISOString(),end:new Date(end*1000).toISOString(),
      observed_at,pages,ids_sha256:digest([...ids].sort()),proof_sha256:digest(proofs),
      matched_ids:ids.size
    };
    const result=await change(state=>{
      // Retain a completed original scan while its token is still the current
      // token; a replacement owner always wins the final metadata CAS.
      if(state.automation_usage_refresh?.token!==claimed.refresh.token)
        return {result:usageRefreshWaiting(state)};
      const current=state.automation,cutoff=Date.now()-AUTOMATION_POLICY.window_ms;
      // Concurrent fresher receiving wins; never erase debits or activity when
      // a message disappears from the Sent label between separate observations.
      if(current && Date.parse(current.sent.end)>Date.parse(snapshot.end))
        return {next:{...state,automation_usage_refresh:null},result:{status:'AUTOMATION_USAGE_CURRENT'}};
      const merged=new Map((current?.sent.messages||[]).map(row=>[row.id,row]));
      for(const row of known.values())merged.set(row.id,row);
      const messages=[...merged.values()].filter(row=>Date.parse(row.at)>cutoff)
        .sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
      const automation={schema:AUTOMATION_SCHEMA,policy:{...AUTOMATION_POLICY},
        activated_at:current?.activated_at||observed_at,
        sent:{...snapshot,messages},
        attempts:(current?.attempts||[]).filter(row=>Date.parse(row.at)>cutoff),
        last_dispatch_at:current?.last_dispatch_at||null};
      validateAutomation(automation);
      return {next:{...state,automation,automation_usage_refresh:null},result:{status:'AUTOMATION_USAGE_RECEIVED'}};
    });
    if(!result.state || !['AUTOMATION_USAGE_RECEIVED','AUTOMATION_USAGE_CURRENT'].includes(result.status)){
      const {state,...summary}=result;return summary;
    }
    return {status:result.status,account_key:key,state_sha:result.state_sha,
      commit_sha:result.commit_sha,revision:result.revision,usage:automationDecision(result.state)};
  }
  async function prepareAutomationUsage() {
    const current=await readState(),now=Date.now();
    // Existing provider returns and active owners are still controlling.
    // A missing/stale snapshot is refreshed when the original account can act.
    if(providerWaiting(current.state,now)||activeWaiting(current.state,now))return;
    const usage=automationDecision(current.state);
    if(usage.status==='AUTOMATION_USAGE_REQUIRED')return refreshAutomationUsage();
  }
  async function prepareUsage({operation_key}={}) {
    if(operation_key!=null && !hex(operation_key))throw new TypeError('Original operation hash required');
    const compatibility=await ensureCurrentSchema();
    if(!['ACCOUNT_SOURCE_CURRENT','ACCOUNT_SOURCE_UPGRADED'].includes(compatibility.status))return compatibility;
    const preparedUsage=await prepareAutomationUsage();
    if(preparedUsage && !['AUTOMATION_USAGE_CURRENT','AUTOMATION_USAGE_RECEIVED'].includes(preparedUsage.status))
      return preparedUsage;
    return inspect({operation_key});
  }
  function returnedSentMessageId(raw) {
    let value=raw?.structuredContent,labels=value?.label_ids;
    if(raw?.binding===NATIVE_SEND && raw.native_response) {
      const response=raw.native_response;
      if(!Number.isInteger(response.status) || response.status<200 || response.status>=300 ||
          typeof response.body_text!=='string')return null;
      try{value=JSON.parse(response.body_text);}catch{return null;}
      if(!response.body || digest(value)!==digest(response.body))return null;
      labels=value?.labelIds;
    } else {
      if(raw?.isError!==false)return null;
      if(raw.provider_transport!==undefined) {
        const response=raw.provider_transport;
        const resource=sendBinding===CONNECTOR_DRAFT
          ? 'https://gmail.googleapis.com/gmail/v1/users/me/drafts/send' : NATIVE_SEND_RESOURCE;
        if(response?.schema!=='commons.local-provider-http/v1' || response.method!=='POST' ||
            response.url!==resource || !Number.isInteger(response.status) ||
            response.status<200 || response.status>=300 || typeof response.body!=='string')return null;
        let original;try{original=JSON.parse(response.body);}catch{return null;}
        if(digest(original)!==digest(value))return null;
        labels=value?.labelIds;
      }
    }
    return !value?.error && !value?.error_code &&
      typeof value?.id==='string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value.id) &&
      Array.isArray(labels) && labels.includes('SENT') && !labels.includes('DRAFT')
      ? value.id : null;
  }
  async function receiveAutomationReturn(args,raw,operationKey,observedAt,attemptKey,dispatchToken) {
    if(dispatchToken!==undefined && !hex(dispatchToken))
      throw new TypeError('Original charged dispatch token required');
    const current=await readState(),automation=current.state.automation;
    if(!automation){
      if(dispatchToken!==undefined)throw new TypeError('Original charged dispatch is absent');
      return;
    }
    const argsHash=digest(args),returned=digest(raw);
    const matching=automation.attempts.filter(value=>value.operation_key===operationKey &&
      value.attempt_key===attemptKey && value.args_sha256===argsHash && value.send_binding===sendBinding);
    let row;
    if(dispatchToken!==undefined){
      row=matching.find(value=>value.token===dispatchToken);
      if(!row)throw new TypeError('Original charged token belongs to another dispatch');
    }else{
      // Legacy returns can receive one unambiguous original charge. An already
      // retained identical return is a replay, not a return for a later retry.
      const sameReturn=matching.filter(value=>value.return_sha256===returned);
      const received=sameReturn.filter(value=>value.returned_at===observedAt);
      const pending=matching.filter(value=>value.return_sha256===null);
      if(received.length===1)row=received[0];
      else if(received.length>1 || pending.length>1 ||
          pending.length && sameReturn.some(value=>!iso(value.returned_at)))
        throw new TypeError('Receive the original charged token for this retained provider return');
      else row=pending[0];
      if(!row){
        if(sameReturn.length)throw new TypeError('Receive the original token or exact returned-event timestamp');
        return;
      }
    }
    if(Date.parse(observedAt)<Date.parse(row.at))
      throw new TypeError('Provider return predates its original charged dispatch');
    if(row.return_sha256!==null){
      if(row.return_sha256!==returned)
        throw new TypeError('Original automated dispatch has a different retained provider return');
      return;
    }
    const messageId=returnedSentMessageId(raw);
    const result=await change(state=>{
      const previous=state.automation?.attempts.find(value=>value.token===row.token);
      if(!previous)throw new TypeError('Original charged dispatch disappeared before return receiving');
      if(previous.operation_key!==operationKey || previous.attempt_key!==attemptKey ||
          previous.args_sha256!==argsHash || previous.send_binding!==sendBinding)
        throw new TypeError('Original charged dispatch identity changed before return receiving');
      if(previous.return_sha256===returned)
        return {result:{status:'AUTOMATION_RETURN_RETAINED'}};
      if(previous.return_sha256!==null)
        throw new TypeError('Original automated dispatch has a different retained provider return');
      const attempts=state.automation.attempts.map(value=>value.token===row.token?
        {...value,message_id:messageId,return_sha256:returned,returned_at:observedAt}:value);
      return {next:{...state,automation:{...state.automation,attempts}},
        result:{status:'AUTOMATION_RETURN_RECEIVED'}};
    });
    if(!['AUTOMATION_RETURN_RECEIVED','AUTOMATION_RETURN_RETAINED'].includes(result.status))
      throw Object.assign(new TypeError('Original dispatch debit return still needs receiving'),
        {account_readback:result});
  }


  async function observeSentReadback(input={}) {
    const proof=validateMailboxSentReadback(input,{sha256Utf8,account:selected,send_binding:sendBinding});
    const result=await change(state=>{
      const row=state.automation?.attempts.find(item=>item.token===proof.dispatch_token);
      if(!row)return {result:{status:'AUTOMATION_ORIGINAL_CHARGE_NOT_CURRENT',account_key:key,
        operation_key:proof.operation_key,attempt_key:proof.attempt_key,dispatch_token:proof.dispatch_token}};
      if(row.operation_key!==proof.operation_key||row.attempt_key!==proof.attempt_key||
          row.send_binding!==sendBinding||row.args_sha256!==proof.args_sha256||
          row.envelope_sha256!==proof.envelope_sha256||row.recipient_units!==proof.recipient_units)
        throw new TypeError('The SENT readback belongs to another original charged dispatch');
      if(Date.parse(proof.post_observed_at)<Date.parse(row.at))
        throw new TypeError('The original POST observation predates its charged dispatch');
      if(row.return_sha256===null)
        return {result:{status:'AUTOMATION_ORIGINAL_RETURN_REQUIRED',account_key:key,
          operation_key:proof.operation_key,attempt_key:proof.attempt_key,dispatch_token:proof.dispatch_token}};
      if(row.return_sha256!==proof.return_sha256||row.returned_at!=null&&row.returned_at!==proof.returned_at)
        throw new TypeError('Keep the first original POST return and its exact timestamp');
      if(row.message_id!==null&&row.message_id!==proof.message_id||
          state.automation.attempts.some(item=>item.token!==row.token&&item.message_id===proof.message_id))
        throw new TypeError('The SENT message is already associated with another dispatch');
      if(row.sent_readback){
        const fixed=['operation_key','attempt_key','dispatch_token','args_sha256','envelope_sha256','return_sha256',
          'returned_at','post_observed_at','message_id','thread_id','claim_id','provider_attempt_id',
          'revision_id','prepared_envelope_sha256','rfc_message_id','post_evidence_sha256','acceptance_sha256'];
        if(fixed.some(k=>row.sent_readback[k]!==proof[k]))
          throw new TypeError('The retained original SENT settlement has another identity');
        return {result:{status:'AUTOMATION_SENT_READBACK_RETAINED',account_key:key,settlement:copy(row.sent_readback)}};
      }
      const attempts=state.automation.attempts.map(item=>item.token===row.token?
        {...item,message_id:proof.message_id,sent_readback:copy(proof)}:item);
      return {next:{...state,automation:{...state.automation,attempts}},
        result:{status:'AUTOMATION_SENT_READBACK_RECEIVED',account_key:key,settlement:copy(proof)}};
    });
    if(!['AUTOMATION_SENT_READBACK_RECEIVED','AUTOMATION_SENT_READBACK_RETAINED'].includes(result.status)){
      const {state,...summary}=result;return summary;
    }
    const saved=result.state.automation?.attempts.find(row=>row.token===proof.dispatch_token);
    if(!saved?.sent_readback||saved.message_id!==proof.message_id||saved.return_sha256!==proof.return_sha256)
      throw new TypeError('The original SENT settlement was not read back');
    const {state,...summary}=result;return summary;
  }

  function validate(state) {
    validateIdentity(state);
    if (state.not_before !== null) validateDeadline(state);
    else if (state.deadline_source !== null) throw new TypeError('Account deadline source is inconsistent');
    if (state.provider_deadlines !== undefined) {
      if (!Array.isArray(state.provider_deadlines) || state.provider_deadlines.length > Object.keys(CONNECTOR_TOOLS).length + 1)
        throw new TypeError('Independent original Gmail profile and connector-method deadlines required');
      const scopes = new Set();
      for (const row of state.provider_deadlines) {
        const scope = scopeKey(validateDeadline(row));
        if (scopes.has(scope) || !state.not_before ||
            Date.parse(row.not_before) > Date.parse(state.not_before))
          throw new TypeError('Original scoped deadlines must retain their legacy maximum');
        scopes.add(scope);
      }
    }
    if (state.active !== null) {
      const active = state.active;
      if (!hex(active.token) || !hex(active.operation_key) || !hex(active.attempt_key) ||
          !iso(active.acquired_at) || !iso(active.expires_at) ||
          Date.parse(active.expires_at) - Date.parse(active.acquired_at) !== LEASE_MS ||
          active.send_binding !== undefined && !SEND_BINDINGS.includes(active.send_binding))
        throw new TypeError('Original active account lease is incomplete');
    }
    validateQueue(state.admission_queue);
    validateAutomation(state.automation);
    activeUsageRefresh(state);
    return state;
  }
  // The original account file owns waiting turns as well as its active token.
  // Missing queue state is the existing v1 account format, received unchanged.
  function validateQueue(queue) {
    if (queue == null) return;
    if (queue.schema !== QUEUE_SCHEMA || !Number.isSafeInteger(queue.next_sequence) ||
        queue.next_sequence < 1 || !Array.isArray(queue.waiting) ||
        queue.waiting.length > MAX_WAITING)
      throw new TypeError('Complete original account waiting order required');
    const operations = new Set();
    let previous = 0;
    for (const item of queue.waiting) {
      if (!hex(item?.operation_key) || operations.has(item.operation_key) ||
          item.send_binding !== undefined && !SEND_BINDINGS.includes(item.send_binding) ||
          !Number.isSafeInteger(item.sequence) || item.sequence <= previous ||
          item.sequence >= queue.next_sequence ||
          !iso(item.queued_at) || !iso(item.renewed_at) || !iso(item.expires_at) ||
          Date.parse(item.renewed_at) < Date.parse(item.queued_at) ||
          Date.parse(item.expires_at) - Date.parse(item.renewed_at) !== WAITING_MS ||
          (item.operation_lease != null &&
            (typeof item.operation_lease !== 'string' || !item.operation_lease.length ||
             item.operation_lease.length > 256 || /[\u0000-\u001f\u007f]/.test(item.operation_lease))))
        throw new TypeError('Original queued operation identity or lifetime is incomplete');

      if (item.queued_return_recovery !== undefined) {
        const r=item.queued_return_recovery;
        if (r?.schema!=='commons.gmail-queued-return-recovery/v1' ||
            r.operation_key!==item.operation_key || r.operation_lease!==item.operation_lease ||
            r.sequence!==item.sequence || r.queued_at!==item.queued_at ||
            !gitSha(r.source_commit_sha) || !gitSha(r.source_state_sha) ||
            !hex(r.recovery_sha256) || !iso(r.received_at) ||
            Date.parse(r.received_at)<Date.parse(item.queued_at))
          throw new TypeError('Original queued-return recovery identity is incomplete');
      }
      if (item.queued_return_recovery?.source_storage_receipt!==undefined)
        validateLocalQueuedReceipt(item.queued_return_recovery);

      operations.add(item.operation_key); previous = item.sequence;
    }
    if (queue.last_change?.kind==='EXPIRED_QUEUED_RETURN_RECEIVED') {
      const r=queue.last_change.recovery;
      if (r?.schema!=='commons.gmail-queued-return-recovery/v1' ||
          !hex(r.operation_key) || !validOperationLease(r.operation_lease) || !r.operation_lease ||
          !Number.isSafeInteger(r.sequence) || r.sequence<1 || !iso(r.queued_at) ||
          !gitSha(r.source_commit_sha) || !gitSha(r.source_state_sha) ||
          !hex(r.recovery_sha256) || !iso(r.source_expires_at) || !iso(r.received_at) ||
          Date.parse(r.received_at)<Date.parse(r.source_expires_at) ||
          r.disposition!=='EXPIRED_REQUIRES_ORDINARY_ACQUISITION' ||
          queue.last_change.operation_keys?.length!==1 ||
          queue.last_change.operation_keys[0]!==r.operation_key ||
          queue.waiting.some(item=>item.operation_key===r.operation_key))
        throw new TypeError('Expired queued-return receiving identity is incomplete');
    }
    if (queue.last_change?.recovery?.source_storage_receipt!==undefined)
      validateLocalQueuedReceipt(queue.last_change.recovery);
    if (queue.turn !== null) {
      const turn = queue.turn, head = queue.waiting[0];
      if (!head || !hex(turn?.operation_key) || turn.operation_key !== head.operation_key ||
          turn.sequence !== head.sequence || !iso(turn.offered_at) || !iso(turn.expires_at) ||
          Date.parse(turn.expires_at) - Date.parse(turn.offered_at) !== TURN_MS)
        throw new TypeError('The offered account turn must name its first waiting operation');
    }
  }
  function queueCopy(state) {
    const source = state.admission_queue;
    return source == null
      ? {schema:QUEUE_SCHEMA,next_sequence:1,waiting:[],turn:null,last_change:null}
      : {...source,waiting:source.waiting.map(item => ({...item})),
        turn:source.turn ? {...source.turn} : null};
  }
  function providerWaiting(state, now, binding=sendBinding) {
    const deadline = providerDeadline(state,binding);
    return !!deadline && Date.parse(deadline.not_before) > now;
  }
  function firstEligible(state, queue, now) {
    return queue.waiting.find(item => !providerWaiting(state,now,item.send_binding || CONNECTOR_SEND)) || null;
  }
  function activeWaiting(state, now) {
    return state.active && Date.parse(state.active.expires_at) > now;
  }
  function changedQueue(queue, kind, operations, now) {
    queue.last_change = {kind,operation_keys:operations,at:new Date(now).toISOString()};
  }
  function maintainQueue(state, now, offer) {
    const queue = queueCopy(state), expired = [];
    queue.waiting = queue.waiting.filter(item => {
      if (Date.parse(item.expires_at) <= now) {expired.push(item.operation_key);return false;}
      return true;
    });
    // A native active token always wins. This also receives an older helper's
    // acquisition without expiring a waiting turn during that real operation.
    if (activeWaiting(state,now)) {
      queue.waiting = queue.waiting.filter(item => item.operation_key !== state.active.operation_key);
      queue.turn = null;
    } else if (queue.waiting[0] &&
        providerWaiting(state,now,queue.waiting[0].send_binding || CONNECTOR_SEND)) {
      queue.turn = null;
    } else if (queue.turn) {
      const head = queue.waiting[0];
      if (!head || head.operation_key !== queue.turn.operation_key ||
          head.sequence !== queue.turn.sequence) queue.turn = null;
      else if (Date.parse(queue.turn.expires_at) <= now) {
        // Legacy offered turns are observation metadata, not acquired tokens.
        // A caller may still be honoring SEND_ACTIVE's returned deadline after
        // that owner releases early. Preserve its original waiting lease and
        // sequence until the waiting lifetime itself expires above.
        queue.turn = null;
      }
    }
    if (expired.length) changedQueue(queue,'EXPIRED',expired,now);
    // Keep the legacy turn at waiting[0]. If that method is deferred, another
    // method can acquire its earliest eligible request in the same account CAS
    // without reordering, withdrawing or expiring the blocked original request.
    if (offer && !activeWaiting(state,now) && !queue.turn && queue.waiting.length &&
        !providerWaiting(state,now,queue.waiting[0].send_binding || CONNECTOR_SEND)) {
      const head = queue.waiting[0], offered_at = new Date(now).toISOString();
      queue.turn = {operation_key:head.operation_key,sequence:head.sequence,
        offered_at,expires_at:new Date(now+TURN_MS).toISOString()};
      if (!expired.length) changedQueue(queue,'OFFERED',[head.operation_key],now);
    }
    return queue;
  }
  function queueSummary(state, queue, operationKey, now) {
    const index = operationKey ? queue.waiting.findIndex(item => item.operation_key === operationKey) : -1;
    const head = firstEligible(state,queue,now);
    return {schema:QUEUE_SCHEMA,waiting_count:queue.waiting.length,
      position:index < 0 ? null : index+1,
      request:index < 0 ? null : {...queue.waiting[index]},
      next_operation:head ? {operation_key:head.operation_key,operation_lease:head.operation_lease,
        sequence:head.sequence,send_binding:head.send_binding || CONNECTOR_SEND} : null,
      turn:queue.turn ? {...queue.turn} : null,
      active_operation_key:activeWaiting(state,now) ? state.active.operation_key : null,
      waiting_expires_at:index < 0 ? null : queue.waiting[index].expires_at,
      // Read-only callers can leave the original request untouched until its
      // existing midpoint renewal is due; this never extends a waiting lease.
      waiting_renew_at:index < 0 ? null : new Date(Date.parse(queue.waiting[index].expires_at)-WAITING_MS/2).toISOString()};
  }
  function withQueueResult(state, queue, result) {
    return JSON.stringify(queue) === JSON.stringify(state.admission_queue)
      ? {result} : {next:{...state,admission_queue:queue},result};
  }
  function validOperationLease(value) {
    return value == null || (typeof value === 'string' && value.length > 0 &&
      value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value));
  }
  function enterQueue(state, queue, operationKey, operationLease, now) {
    // An original active attempt needs its existing release/reconciliation.
    if (activeWaiting(state,now) && state.active.operation_key === operationKey)
      return {full:false};
    let item = queue.waiting.find(value => value.operation_key === operationKey);
    if (item) {
      if (item.operation_lease != null && operationLease != null &&
          item.operation_lease !== operationLease)
        throw new TypeError('The retained queued operation lease changed');
      let changed = false;
      if ((item.send_binding || CONNECTOR_SEND) !== sendBinding) {
        if (!operationLease || item.operation_lease !== operationLease)
          throw new TypeError('Changing an unadmitted transport requires the unchanged original queued lease');
        item.send_binding = sendBinding; changed = true;
        if (queue.turn?.operation_key === operationKey) queue.turn = null;
      }
      if (item.operation_lease == null && operationLease != null) {
        item.operation_lease = operationLease;changed = true;
      }
      // Ordinary observation does not rewrite the account. A continuing
      // original attempt renews its waiting request only near its midpoint.
      if (Date.parse(item.expires_at)-now <= WAITING_MS/2) {
        item.renewed_at = new Date(now).toISOString();
        item.expires_at = new Date(now+WAITING_MS).toISOString();changed = true;
      }
      if (changed) changedQueue(queue,'RENEWED',[operationKey],now);
      return {full:false};
    }
    if (queue.waiting.length >= MAX_WAITING) return {full:true};
    if (queue.next_sequence >= Number.MAX_SAFE_INTEGER)
      throw new TypeError('Account waiting sequence is exhausted');
    const at = new Date(now).toISOString();
    item = {operation_key:operationKey,operation_lease:operationLease ?? null,send_binding:sendBinding,
      sequence:queue.next_sequence++,queued_at:at,renewed_at:at,
      expires_at:new Date(now+WAITING_MS).toISOString()};
    queue.waiting.push(item);changedQueue(queue,'QUEUED',[operationKey],now);
    return {full:false};
  }

  // Explicit local state uses one operator-selected coordinator for this account.
  // The original Git postimage remains provenance, never a synthetic local commit.
  let localFloor=null, localAuthoritySha=null;
  const localSnapshots=new Map(),localPending=new Map(),localCalls=new Map();
  function localFailure(code,message) {
    return Object.assign(new Error(message),{code});
  }
  function localOperation(args) {
    return digest({kind:LOCAL_STORAGE_KIND,coordinator_id:coordinatorId,
      namespace:'account',key,expected_sha256:args.expected_sha256,
      content_sha256:digest(args.content)});
  }
  function localArgs(args) {
    if (!args || args.namespace!=='account' || args.key!==key ||
        !hex(args.expected_sha256) || typeof args.content!=='string' ||
        args.operation_id!==localOperation(args) ||
        Object.keys(args).some(name=>!['namespace','key','expected_sha256','operation_id','content'].includes(name)))
      throw new TypeError('Exact original local account CAS arguments required');
    const state=validate(JSON.parse(args.content));
    if (state.revision<1) throw new TypeError('Original account write revision required');
    return args;
  }
  function validateLocalQueuedReceipt(recovery) {
    if (!storage) throw new TypeError('Receive a local queued return through its original shared coordinator');
    const receipt=localReceipt(recovery.source_storage_receipt);
    if (recovery.source_commit_sha!==receipt.origin.commit_sha || recovery.source_state_sha!==receipt.origin.blob_sha)
      throw new TypeError('Queued return changed its original Git adoption provenance');
    return receipt;
  }
  function localReceipt(receipt) {
    if (receipt?.schema!==LOCAL_RECEIPT_KIND ||
        receipt.coordinator_id!==coordinatorId ||
        receipt.namespace!=='account' || receipt.key!==key ||
        !Number.isSafeInteger(receipt.revision) || receipt.revision<1 ||
        !hex(receipt.sha256) || !iso(receipt.created_at) ||
        receipt.previous_sha256!==null && !hex(receipt.previous_sha256) ||
        typeof receipt.operation_id!=='string' || !receipt.operation_id ||
        typeof receipt.action!=='string' || !receipt.action ||
        receipt.origin?.kind!=='git-original-readback' ||
        receipt.origin.repository!==REPOSITORY || receipt.origin.path!==STATE_PATH ||
        !gitSha(receipt.origin.commit_sha) || !gitSha(receipt.origin.blob_sha) ||
        !hex(receipt.origin.sha256) || !iso(receipt.origin.observed_at) ||
        !receipt.origin.receipt || typeof receipt.origin.receipt!=='object')
      throw new TypeError('Complete original local account receipt and Git readback provenance required');
    return receipt;
  }
  function localSnapshot(raw,args=null) {
    if (raw?.kind!==LOCAL_SNAPSHOT_KIND || raw.coordinator_id!==coordinatorId ||
        raw.namespace!=='account' || raw.key!==key ||
        !Number.isSafeInteger(raw.revision) || raw.revision<1 ||
        typeof raw.content!=='string' || digest(raw.content)!==raw.sha256 ||
        raw.receipt?.revision!==raw.revision || raw.receipt?.sha256!==raw.sha256)
      throw new TypeError('Complete hash-bound original local account snapshot required');
    localReceipt(raw.receipt);
    const state=validate(JSON.parse(raw.content));
    if (args) {
      localArgs(args);
      if (raw.content!==args.content || raw.receipt.previous_sha256!==args.expected_sha256 ||
          raw.receipt.operation_id!==args.operation_id || raw.receipt.action!=='compareAndSwap')
        throw new TypeError('Returned local state differs from its exact original CAS');
    }
    const retained=localSnapshots.get(raw.revision) ||
      (localFloor?.storage_snapshot.revision===raw.revision?localFloor.storage_snapshot:null);
    if (retained && digest(retained)!==digest(raw))
      throw new TypeError('One local storage revision has conflicting complete snapshots');
    if (raw.revision===1 &&
        (raw.receipt.previous_sha256!==null || raw.receipt.origin.sha256!==raw.sha256))
      throw new TypeError('Local account adoption must preserve the complete original Git postimage');
    return {sha:null,commit_sha:null,content:raw.content,state,
      storage_snapshot:copy(raw),storage_receipt:copy(raw.receipt)};
  }
  function rememberLocal(raw,args=null) {
    const candidate=localSnapshot(raw,args);
    // Keep this operation's exact writes. General account history remains in
    // the coordinator; only its latest verified floor is held by this handle.
    if (args) localSnapshots.set(raw.revision,copy(raw));
    return candidate;
  }
  function localProvenance(value) {
    const receipt=value?.storage_receipt;
    return receipt ? {storage_kind:LOCAL_STORAGE_KIND,storage_receipt:copy(receipt),
      source_commit_sha:receipt.origin.commit_sha,source_state_sha:receipt.origin.blob_sha} : {};
  }
  function localIdentity(value) {
    return value ? {revision:value.state.revision,state_sha:null,commit_sha:null,
      ...localProvenance(value)} : null;
  }
  function localWriteIdentity(value) {
    return {schema:'commons.gmail-account-local-write/v1',account_key:key,
      revision:value.state.revision,content_sha256:digest(value.content),
      ...localProvenance(value)};
  }
  function advanceLocal(raw) {
    const candidate=rememberLocal(raw),previous=localFloor;
    if (previous && raw.revision<=previous.storage_snapshot.revision) {
      return candidate;
    }
    if (!previous) {
      if (raw.revision!==1) throw new TypeError('Receive the original local adoption before successor revisions');
      // Old Git journals remain readable. Adoption must not predate an already
      // observed accepted original write in this operation's retained history.
      const required=Math.max(floor?.state.revision||0,...[...writes.values()].map(x=>x.state.revision));
      if (candidate.state.revision<required)
        throw new TypeError('Local account adoption predates an observed original account write');
      for (const old of [...writes.values(),...(floor?[floor]:[])]) {
        if (old.state.revision===candidate.state.revision &&
            (old.content!==candidate.content || old.commit_sha!==raw.receipt.origin.commit_sha ||
             old.sha!==null && old.sha!==raw.receipt.origin.blob_sha))
          throw new TypeError('Local adoption changed the original accepted Git postimage');
      }
    } else {
      if (raw.revision!==previous.storage_snapshot.revision+1 ||
          raw.receipt.previous_sha256!==previous.storage_snapshot.sha256 ||
          candidate.state.revision!==previous.state.revision+1 ||
          digest(raw.receipt.origin)!==digest(previous.storage_receipt.origin))
        throw new TypeError('The local account revision chain or original provenance changed');
      if (previous.state.schema===SCHEMA && candidate.state.schema!==SCHEMA)
        throw new TypeError('Local successor reverted the enforced sender schema');
      for (const old of deadlineRows(previous.state,false)) {
        const same=deadlineRows(candidate.state,false).find(x=>scopeKey(classifyProof(x.deadline_source))===scopeKey(classifyProof(old.deadline_source)));
        if (!same || Date.parse(same.not_before)<Date.parse(old.not_before))
          throw new TypeError('Local successor lost an original provider deadline');
      }
    }
    for (const row of deadlineRows(candidate.state,false)) mergeDeadline(knownDeadlines,copy(row));
    localFloor={...candidate,state:copy(candidate.state)};
    return candidate;
  }
  function loadLocalHistory() {
    if (!history) return;
    const events=history();
    if (!Array.isArray(events)) throw new TypeError('Complete original nested account event array required');
    const calls=new Map();
    for (const event of events) {
      if (event?.phase==='local-account-state-observed') {
        if (event.snapshot?.key===key) {
          const raw=event.snapshot;localSnapshot(raw);
          if (raw.revision===(localFloor?.storage_snapshot.revision||0)+1) advanceLocal(raw);
        }
        continue;
      }
      if (event?.phase==='local-account-history-received') {
        if (event.receiving?.account_key===key) receiveLocalRange(event.receiving);
        continue;
      }
      if (event?.phase==='original-local-account-write-receiving') {
        if (event.original?.args?.key===key) rememberLocal(event.original.raw,localArgs(event.original.args));
        continue;
      }
      if (event?.binding!==LOCAL_CAS_BINDING) continue;
      if (!hex(event.call_id)) throw new TypeError('Original local CAS call identity required');
      if (event.phase==='invoking') {
        if (event.args?.namespace!=='account' || event.args.key!==key) continue;
        localArgs(event.args);
        if (!iso(event.observed_at) || calls.has(event.call_id))
          throw new TypeError('Original local CAS invocation identity is duplicated');
        calls.set(event.call_id,{args:copy(event.args),at:event.observed_at,done:false});
      } else if (['returned','failed'].includes(event.phase) && calls.has(event.call_id)) {
        const call=calls.get(event.call_id);
        if (call.done || !iso(event.observed_at) || Date.parse(event.observed_at)<Date.parse(call.at))
          throw new TypeError('Original local CAS return chronology changed');
        if (event.phase==='returned') {rememberLocal(event.raw,call.args);call.done=true;}
        else if (event.code==='LOCAL_STATE_CONFLICT' && event.status===409) call.done=true;
      }
    }
    for (const [id,call] of calls) {
      const previous=localCalls.get(id);
      if (previous && digest(previous.args)!==digest(call.args))
        throw new TypeError('Retained local invocation arguments changed');
      localCalls.set(id,call);
      if (call.done) localPending.delete(call.args.operation_id);
      else if (!localPending.has(call.args.operation_id)) localPending.set(call.args.operation_id,copy(call.args));
    }
    // Journal snapshots establish only a monotonic receiving floor, never a
    // current account token. readLocalState always reads the coordinator again.
    for (const raw of [...localSnapshots.values()].sort((a,b)=>a.revision-b.revision)) {
      if (raw.revision===(localFloor?.storage_snapshot.revision||0)+1) advanceLocal(raw);
    }
  }
  async function invokeLocalCAS(args) {
    localArgs(args);
    const call_id=digest({account_key:key,binding:LOCAL_CAS_BINDING,
      args_sha256:digest(args),observed_at:new Date().toISOString(),sequence:++callSequence});
    await record({phase:'invoking',binding:LOCAL_CAS_BINDING,args:copy(args),call_id,observed_at:new Date().toISOString()});
    localPending.set(args.operation_id,copy(args));
    let raw;
    try { raw=await storage.compareAndSwap(copy(args)); }
    catch (error) {
      await record({phase:'failed',binding:LOCAL_CAS_BINDING,call_id,
        code:typeof error?.code==='string'?error.code:null,status:Number(error?.status||0),
        message:String(error?.message||error),observed_at:new Date().toISOString()});
      if (error?.code==='LOCAL_STATE_CONFLICT' && error.status===409) localPending.delete(args.operation_id);
      throw error;
    }
    // A lost return is replayed only by the original idempotent operation ID.
    // Never rebuild its timestamp, lease, queue or content from a later state.
    await record({phase:'returned',binding:LOCAL_CAS_BINDING,call_id,raw:copy(raw),observed_at:new Date().toISOString()});
    const received=rememberLocal(raw,args);
    localPending.delete(args.operation_id);
    return received;
  }
  function localReference(raw) {
    return {revision:raw.revision,sha256:raw.sha256,previous_sha256:raw.receipt.previous_sha256,
      receipt_sha256:digest(raw.receipt),business_revision:JSON.parse(raw.content).revision};
  }
  function receiveLocalRange(receiving) {
    const {range_sha256,...body}=receiving||{};
    if (body.schema!=='commons.gmail-account-local-history-range/v1' ||
        body.coordinator_id!==coordinatorId || body.account_key!==key ||
        !hex(range_sha256) || digest(body)!==range_sha256 || !hex(body.history_sha256) ||
        !Number.isSafeInteger(body.count) || body.count<1 ||
        !Number.isSafeInteger(body.from?.revision) || body.from.revision<0 ||
        body.to?.revision-body.from.revision!==body.count ||
        body.first?.revision!==body.from.revision+1 ||
        body.first.previous_sha256!==body.from.sha256 ||
        body.last?.revision!==body.to.revision || body.last.sha256!==body.to.sha256 ||
        body.last.business_revision!==body.to.business_revision)
      throw new TypeError('Original verified local receiving range changed');
    const candidate=localSnapshot(body.snapshot),raw=candidate.storage_snapshot;
    if (digest(localReference(raw))!==digest(body.last) ||
        raw.revision!==body.to.revision || candidate.state.revision!==body.to.business_revision ||
        body.first.business_revision+body.count-1!==candidate.state.revision)
      throw new TypeError('Verified local floor differs from its retained range');
    if (localFloor && raw.revision<=localFloor.storage_snapshot.revision) return;
    if ((localFloor?.storage_snapshot.revision||0)!==body.from.revision ||
        (localFloor?.storage_snapshot.sha256||null)!==body.from.sha256 ||
        (localFloor?.state.revision??null)!==body.from.business_revision)
      throw new TypeError('Verified local receiving range has another preceding floor');
    if (!localFloor) {
      if (body.first.revision!==1 || body.first.previous_sha256!==null ||
          body.first.sha256!==raw.receipt.origin.sha256 ||
          candidate.state.revision<Math.max(floor?.state.revision||0,...[...writes.values()].map(x=>x.state.revision)))
        throw new TypeError('Verified local floor does not retain the original adoption');
    } else {
      if (candidate.state.revision!==localFloor.state.revision+body.count ||
          digest(raw.receipt.origin)!==digest(localFloor.storage_receipt.origin) ||
          localFloor.state.schema===SCHEMA && candidate.state.schema!==SCHEMA)
        throw new TypeError('Verified local receiving range changed account lineage');
      for (const old of deadlineRows(localFloor.state,false)) {
        const same=deadlineRows(candidate.state,false).find(x=>scopeKey(classifyProof(x.deadline_source))===scopeKey(classifyProof(old.deadline_source)));
        if (!same || Date.parse(same.not_before)<Date.parse(old.not_before))
          throw new TypeError('Verified local floor lost an original provider deadline');
      }
    }
    for (const row of deadlineRows(candidate.state,false)) mergeDeadline(knownDeadlines,copy(row));
    // This journal event was emitted only after every full intermediate state
    // passed advanceLocal. Its range hash references coordinator originals;
    // it is not a new current-state read or a send authorization.
    localFloor={...candidate,state:copy(candidate.state)};
  }
  async function receiveLocalHistory(targetRevision) {
    let after=localFloor?.storage_snapshot.revision||0;
    if (after>=targetRevision) return;
    const from={revision:after,sha256:localFloor?.storage_snapshot.sha256||null,
      business_revision:localFloor?.state.revision??null};
    let chain=digest({coordinator_id:coordinatorId,account_key:key,from}),count=0,first=null,last=null;
    while (after<targetRevision) {
      const page=await storage.history({namespace:'account',key,after_revision:after,limit:100});
      if (!page || !Array.isArray(page.records) || !page.records.length || page.records.length>100 ||
          page.next_revision!==null && (!Number.isSafeInteger(page.next_revision)||page.next_revision<=after))
        throw new TypeError('Complete original local account history page required');
      for (const raw of page.records) {
        if (raw.revision!==after+1) throw new TypeError('Local account history is missing a revision');
        advanceLocal(raw);after=raw.revision;
        const reference=localReference(raw);first=first||reference;last=reference;
        chain=digest({previous:chain,reference});count++;
      }
      if (page.next_revision!==null && page.next_revision!==after)
        throw new TypeError('Local history cursor does not identify its last complete revision');
      if (after<targetRevision && page.next_revision===null)
        throw new TypeError('Local account history ended before its observed head');
    }
    const receiving={schema:'commons.gmail-account-local-history-range/v1',
      coordinator_id:coordinatorId,account_key:key,from,
      to:{revision:after,sha256:localFloor.storage_snapshot.sha256,business_revision:localFloor.state.revision},
      count,first,last,history_sha256:chain,snapshot:copy(localFloor.storage_snapshot)};
    receiving.range_sha256=digest(receiving);
    await record({phase:'local-account-history-received',receiving,observed_at:new Date().toISOString()});
  }
  async function readLocalState() {
    await verify();
    loadHistory();loadLocalHistory();
    // Finish the exact prior CAS before allowing any later business transform.
    for (const args of [...localPending.values()]) {
      try { await invokeLocalCAS(args); }
      catch (error) {
        if (error?.code==='LOCAL_STATE_CONFLICT' && error.status===409) continue;
        throw error;
      }
    }
    for (let pass=0;pass<READBACK_PASSES;pass++) {
      const raw=await storage.read({namespace:'account',key});
      if (raw===null) throw localFailure('LOCAL_ACCOUNT_ADOPTION_REQUIRED',
        'Receive the complete original account into the selected shared coordinator; no fresh account is created.');
      const current=rememberLocal(raw);
      if (localFloor && raw.revision<localFloor.storage_snapshot.revision) continue;
      await receiveLocalHistory(raw.revision);
      if (localFloor.storage_snapshot.revision!==raw.revision) continue;
      if (digest(localFloor.storage_snapshot)!==digest(raw))
        throw new TypeError('Local current state differs from its immutable revision history');
      return current;
    }
    throw readbackPending('LOCAL_CURRENT_HEAD_BEHIND_OBSERVED_WRITE',
      [{storage_kind:LOCAL_STORAGE_KIND,minimum_state:localIdentity(localFloor)}]);
  }
  async function changeLocal(transform) {
    for (let attempt=0;attempt<4;attempt++) {
      const before=await readLocalState(),decision=transform(copy(before.state));
      if (!decision?.next) return {...decision.result,state:copy(before.state),
        state_sha:null,commit_sha:null,revision:before.state.revision,...localProvenance(before)};
      const next=validate({...retainDeadlines(decision.next),schema:SCHEMA,
        revision:before.state.revision+1,updated_at:new Date().toISOString()});
      const args={namespace:'account',key,expected_sha256:before.storage_snapshot.sha256,
        content:JSON.stringify(next,null,2)+'\n'};
      args.operation_id=localOperation(args);
      let write;
      try {write=await invokeLocalCAS(args);}
      catch (error) {
        if (error?.code==='LOCAL_STATE_CONFLICT' && error.status===409) continue;
        throw error;
      }
      await receiveLocalHistory(write.storage_snapshot.revision);
      return {...decision.result,state:copy(write.state),state_sha:null,commit_sha:null,
        revision:write.state.revision,accepted_write:localWriteIdentity(write),...localProvenance(write)};
    }
    return {status:'ACCOUNT_STATE_CONTENDED',account_key:key};
  }
  function withLocalResult(result) {
    if (!storage || !result || typeof result!=='object' || result.storage_receipt) return result;
    const selectedSnapshot=result.revision===undefined?null:[...localSnapshots.values()]
      .find(raw=>JSON.parse(raw.content).revision===result.revision);
    const received=selectedSnapshot?localSnapshot(selectedSnapshot):localFloor;
    return {...result,...localProvenance(received)};
  }

  function fileContents(value) {
    if (typeof value?.content !== 'string' || !gitSha(value.sha) ||
        (value.encoding != null && !['utf-8','utf8','text'].includes(value.encoding)))
      throw new TypeError('Complete UTF-8 shared account file and blob required');
    return JSON.parse(value.content);
  }
  function fileState(value, commit_sha) {
    return {sha:value.sha, state:validate(fileContents(value)),
      content:value.content, commit_sha:commit_sha || null};
  }
  function stateIdentity(value) {
    return value ? {revision:value.state.revision,state_sha:value.sha,
      commit_sha:value.commit_sha || null} : null;
  }
  function readbackPending(reason, observations=[], write=null) {
    const known = [...writes.values()].sort((a,b)=>b.state.revision-a.state.revision)[0];
    const minimum = storage && localFloor ? localIdentity(localFloor) :
      floor && (!known || floor.state.revision >= known.state.revision)
      ? stateIdentity(floor) : known ? stateIdentity(known) : null;
    const decision = {status:'ACCOUNT_STATE_READBACK_PENDING',account_key:key,reason,
      minimum_state:minimum,observations:copy(observations),
      ...(write ? {accepted_write:writeIdentity(write)} : {})};
    return Object.assign(new Error('Original account state requires its same-write readback'), {
      code:'ACCOUNT_STATE_READBACK_PENDING',decision
    });
  }
  function rememberImmutable(candidate) {
    // The original floor/write receiving has already validated this complete
    // postimage. Keep exact bytes, not a mutable decision or lease snapshot.
    if (!gitSha(candidate.commit_sha) || !gitSha(candidate.sha) ||
        typeof candidate.content !== 'string') return;
    const retained = Object.freeze({sha:candidate.sha,content:candidate.content,
      content_sha256:digest(candidate.content)});
    const previous = immutableFiles.get(candidate.commit_sha);
    if (previous && (previous.sha!==retained.sha || previous.content!==retained.content))
      throw new TypeError('One original account commit has conflicting immutable file bodies');
    immutableFiles.set(candidate.commit_sha,retained);
  }
  function advanceFloor(candidate) {
    if (!floor || candidate.state.revision > floor.state.revision) {
      if (floor?.state.schema===SCHEMA && candidate.state.schema!==SCHEMA)
        throw new TypeError('A successor account state reverted the enforced sender source version');
      if (floor?.state.not_before && (!candidate.state.not_before ||
          Date.parse(candidate.state.not_before) < Date.parse(floor.state.not_before)))
        throw new TypeError('A successor account state lost its original provider deadline');
      rememberImmutable(candidate);
      for (const row of deadlineRows(candidate.state,false)) mergeDeadline(knownDeadlines,copy(row));
      floor = {...candidate,state:copy(candidate.state)};
      return true;
    }
    if (candidate.state.revision === floor.state.revision) {
      if (candidate.sha !== floor.sha || (candidate.sha !== null && digest(candidate.state) !== digest(floor.state)))
        throw new TypeError('One account revision has conflicting original postimages');
      rememberImmutable(candidate);
      if (!floor.commit_sha && candidate.commit_sha) floor.commit_sha = candidate.commit_sha;
      return true;
    }
    return false;
  }
  function returnedSha(value, field, legacy) {
    const supplied=[value?.[field],legacy].filter(item=>item != null);
    if (!supplied.length || supplied.some(item=>!gitSha(item)) ||
        supplied.some(item=>item!==supplied[0]))
      throw new TypeError('Exact native account commit and content identities required');
    return supplied[0];
  }
  function writeIdentity(write) {
    return {schema:WRITE_SCHEMA,repository:REPOSITORY,branch,path:STATE_PATH,account_key:key,
      revision:write.state.revision,previous_sha:write.previous_sha,
      commit_sha:write.commit_sha,content_sha:write.sha,content_sha256:digest(write.content)};
  }
  function retainedWrite(binding, args, raw) {
    if (!['mcp__codex_apps__github_create_file','mcp__codex_apps__github_update_file'].includes(binding) ||
        args?.repository_full_name !== REPOSITORY || args.branch !== branch || args.path !== STATE_PATH)
      throw new TypeError('Exact original account-state write required');
    if (raw?.isError) throw failure(raw);
    if (typeof args.content !== 'string' ||
        (binding.endsWith('github_update_file') ? !gitSha(args.sha) : args.sha != null))
      throw new TypeError('Original account CAS arguments and complete postimage required');
    const value=raw?.structuredContent;
    const commit_sha=returnedSha(value,'commit_sha',value?.commit?.sha);
    const creation=binding.endsWith('github_create_file');
    // Native create_file returns its accepted commit only. Resolve the actual
    // blob from that immutable commit before admitting its postimage.
    const sha=creation && value?.content_sha == null && value?.content?.sha == null
      ? null : returnedSha(value,'content_sha',value?.content?.sha);
    const state=validate(JSON.parse(args.content));
    if (state.revision < 1) throw new TypeError('Original account write revision required');
    const candidate={sha,commit_sha,state,content:args.content,previous_sha:args.sha || null};
    const existing=writes.get(commit_sha);
    if (existing && (existing.sha!==null && sha!==null && existing.sha!==sha ||
        existing.content!==candidate.content ||
        existing.previous_sha!==candidate.previous_sha))
      throw new TypeError('One native account commit has conflicting retained write identities');
    if (!existing) writes.set(commit_sha,candidate);
    return existing || candidate;
  }
  function verifyWrittenFile(write, current) {
    if (!gitSha(current.sha) || (write.sha!==null && current.sha !== write.sha) ||
        current.content !== write.content || current.state.revision !== write.state.revision)
      throw new TypeError('Native account commit does not contain its exact accepted postimage');
    if (write.sha===null) {
      if (current.commit_sha!==write.commit_sha)
        throw new TypeError('A new account file requires its exact accepted commit readback');
      write.sha=current.sha;
    }
    verifiedWrites.add(write.commit_sha);
    advanceFloor(write);
    return write;
  }
  function loadHistory() {
    if (!history) return;
    const events=history();
    if (!Array.isArray(events)) throw new TypeError('Complete original nested account event array required');
    const pending=new Map(), heads=new Set(), candidates=new Map();
    function receiveCandidates() {
      for (const [commit,candidate] of [...candidates].sort((a,b)=>a[1].state.revision-b[1].state.revision)) {
        // A retained accepted write remains unresolved until its exact native
        // postimage is received, even if a later head happens to look newer.
        if ([...writes.values()].some(write=>!verifiedWrites.has(write.commit_sha) &&
            write.state.revision<=candidate.state.revision)) continue;
        if (floor && candidate.state.revision<floor.state.revision) {candidates.delete(commit);continue;}
        const base=floor?.commit_sha;
        if (base && base!==candidate.commit_sha && !compared.has(base+'...'+candidate.commit_sha)) continue;
        advanceFloor(candidate);
        candidates.delete(commit);
      }
    }
    const accepted=[];
    const stale=[];
    let requiredRevision=0;
    for (let index=0;index<events.length;index++) {
      const event=events[index];
      if (!event || typeof event!=='object') throw new TypeError('Complete original account event required');
      if (event.phase==='original-account-write-receiving') {
        const original=event.original;
        // A reviewed mailbox change retains both accounts' complete history.
        // A different account's received write belongs to its own branch.
        if (original?.args?.repository_full_name === REPOSITORY &&
            original.args.path === STATE_PATH && original.args.branch !== branch &&
            typeof original.args.branch === 'string' &&
            original.args.branch.startsWith('mailbox-admission/v1/') &&
            hex(original.args.branch.slice('mailbox-admission/v1/'.length))) continue;
        const write=retainedWrite(original?.binding,original?.args,original?.raw);
        accepted.push(write);
        requiredRevision=Math.max(requiredRevision,write.state.revision);
        continue;
      }
      const binding=event.binding;
      if (!['mcp__codex_apps__github_create_file','mcp__codex_apps__github_update_file',
            'mcp__codex_apps__github_fetch_file','mcp__codex_apps__github_fetch',
            'mcp__codex_apps__github_fetch_commit','mcp__codex_apps__github_compare_commits'].includes(binding)) continue;
      const id=event.call_id == null ? binding : binding+':'+event.call_id;
      if (event.phase==='invoking') {
        if (pending.has(id))
          throw new TypeError('Original account history has ambiguous overlapping native calls');
        pending.set(id,{event,index});
        continue;
      }
      if (!['returned','failed'].includes(event.phase)) continue;
      let selectedId=id;
      if (!pending.has(selectedId) && event.call_id == null) {
        const matches=[...pending.entries()].filter(([,entry])=>entry.event.binding===binding);
        if (matches.length>1) throw new TypeError('Original returned account call is ambiguous');
        if (matches.length===1) selectedId=matches[0][0];
      }
      const original=pending.get(selectedId);
      if (!original) continue;
      pending.delete(selectedId);
      if (event.phase==='failed' || event.raw?.isError) continue;
      const args=original.event.args, value=event.raw?.structuredContent;
      if (binding==='mcp__codex_apps__github_fetch_commit') {
        if (args?.repo_full_name!==REPOSITORY || args.commit_sha!=='refs/heads/'+branch) continue;
        heads.add(receivedNativeHead(value));
        continue;
      }
      if (binding==='mcp__codex_apps__github_compare_commits') {
        if (args?.repo_full_name!==REPOSITORY || !gitSha(args.base) || !gitSha(args.head)) continue;
        if (receivedComparison(value,args.base,args.head,true)) compared.add(args.base+'...'+args.head);
        receiveCandidates();
        continue;
      }
      if (binding==='mcp__codex_apps__github_fetch') {
        const headRead=[refUrl(branch),branchCommitUrl].includes(args?.url);
        const prefix='https://api.github.com/repos/'+REPOSITORY+'/compare/';
        const pair=typeof args?.url==='string' && args.url.startsWith(prefix)
          ? /^([a-f0-9]{40})\.\.\.([a-f0-9]{40})\?per_page=1&page=1$/.exec(args.url.slice(prefix.length)) : null;
        if (!headRead && !pair) continue;
        if (typeof value?.content!=='string') throw new TypeError('Complete original native account response required');
        const result=JSON.parse(value.content);
        if (headRead) {
          const sha=args.url===refUrl(branch)
            ? result.ref==='refs/heads/'+branch && result.object?.type==='commit' && result.object.sha
            : result.sha;
          if (!gitSha(sha)) throw new TypeError('Original selected account branch identity required');
          heads.add(sha);
        } else {
          if (receivedComparison(result,pair[1],pair[2])) compared.add(pair[1]+'...'+pair[2]);
          receiveCandidates();
        }
        continue;
      }
      if (args?.repository_full_name !== REPOSITORY || args.path !== STATE_PATH) continue;
      if (binding.endsWith('github_create_file') || binding.endsWith('github_update_file')) {
        if (args.branch!==branch) continue;
        const write=retainedWrite(binding,args,event.raw);
        accepted.push(write);
        requiredRevision=Math.max(requiredRevision,write.state.revision);
        continue;
      }
      if (args.ref!==branch && !gitSha(args.ref)) continue;
      // Immutable reads share a repository/path across mailbox branches. Bind
      // them to this account's observed branch heads or accepted write commits
      // before validating state. A prior sender's complete readbacks remain in
      // the original journal, but cannot seed this account's revision floor.
      if (args.ref!==branch && !heads.has(args.ref) && !writes.has(args.ref)) continue;
      // An unmatched historical mutable branch read is an observation, not
      // an accepted write or immutable account head. Keep its original bytes
      // in history and report its revision without adopting its old lease.
      // Every accepted-write readback and immutable candidate below still
      // passes the same complete state, deadline, queue and lease validation.
      if (args.ref===branch &&
          !accepted.some(write=>write.sha!==null && write.sha===value?.sha)) {
        const observation=validateIdentity(fileContents(value));
        if (observation.revision < requiredRevision)
          stale.push({event_index:index,revision:observation.revision,state_sha:value.sha,
            minimum_revision:requiredRevision});
        continue;
      }
      const current=fileState(value,gitSha(args.ref)?args.ref:null);
      if (current.state.revision < requiredRevision)
        stale.push({event_index:index,revision:current.state.revision,state_sha:current.sha,
          minimum_revision:requiredRevision});
      // Complete native write arguments plus its returned commit/content IDs and
      // an exact later blob readback recover the original accepted write. Other
      // caller fields, source captions and Gmail responses never seed this floor.
      for (const write of accepted) {
        if (write.sha!==null && current.sha===write.sha && (args.ref===branch || args.ref===write.commit_sha) ||
            write.sha===null && args.ref===write.commit_sha) verifyWrittenFile(write,current);
      }
      if (gitSha(args.ref) && heads.has(args.ref)) candidates.set(args.ref,current);
      receiveCandidates();
    }
    historicalStaleReads=stale;
  }
  async function readAt(commit_sha) {
    if (!gitSha(commit_sha)) throw new TypeError('Exact native account commit required');
    const retained = immutableFiles.get(commit_sha);
    if (retained) {
      await record({phase:'immutable-account-read-reused',repository:REPOSITORY,
        path:STATE_PATH,account_key:key,commit_sha,content_sha:retained.sha,
        content_sha256:retained.content_sha256,observed_at:new Date().toISOString()});
      // Parse and validate a fresh state object on every decision. readState
      // still resolves the actual branch head and enforces its original floor;
      // confirm still checks the current token, expiry and provider deadline.
      return fileState({sha:retained.sha,content:retained.content,encoding:'utf-8'},commit_sha);
    }
    try {
      const value=await invoke('github_fetch_file',{
        repository_full_name:REPOSITORY,path:STATE_PATH,ref:commit_sha});
      return fileState(value,commit_sha);
    } catch (error) {
      if (error.status===404) return {sha:null,state:initial(),content:null,commit_sha};
      throw error;
    }
  }
  async function receiveAccepted(write) {
    if (verifiedWrites.has(write.commit_sha)) return write;
    let current;
    try { current=await readAt(write.commit_sha); }
    catch (error) {
      // The original native mutation is already accepted. Keep its exact
      // postimage receiving separate from another account-state mutation.
      // Malformed source/state and local validation errors still propagate.
      if (!Number.isFinite(error?.status)) throw error;
      const observation={source:'accepted_commit',commit_sha:write.commit_sha,
        read_request:{binding:'mcp__codex_apps__github_fetch_file',
          args:{repository_full_name:REPOSITORY,path:STATE_PATH,ref:write.commit_sha}},
        status:error.status,message:String(error.message || error)};
      await record({phase:'accepted-write-readback-pending',write:writeIdentity(write),
        observation:copy(observation),observed_at:new Date().toISOString()});
      throw readbackPending('ACCEPTED_COMMIT_READ_FAILED',[observation],write);
    }
    if (!current.sha) throw readbackPending('ACCEPTED_COMMIT_NOT_READABLE',[],write);
    verifyWrittenFile(write,current);
    await record({phase:'accepted-write-readback',write:writeIdentity(write),
      observed_at:new Date().toISOString()});
    return write;
  }
  async function restoreHistory() {
    loadHistory();
    for (const write of [...writes.values()].sort((a,b)=>a.state.revision-b.state.revision))
      if (!verifiedWrites.has(write.commit_sha)) await receiveAccepted(write);
  }
  async function currentHead(alternate) {
    try { return await readHead(branch,alternate); }
    catch (error) {if (absentHead(error,branch)) return null;throw error;}
  }
  async function succeedsFloor(current) {
    if (!floor) return true;
    if (current.state.revision < floor.state.revision) return false;
    if (floor.state.schema===SCHEMA && current.state.schema!==SCHEMA)
      throw new TypeError('Current account head reverted the enforced sender source version');
    if (current.state.revision === floor.state.revision &&
        (current.sha!==floor.sha || (current.sha!==null && digest(current.state)!==digest(floor.state))))
      throw new TypeError('One account revision has conflicting native postimages');
    const base=floor.commit_sha, head=current.commit_sha;
    if (!base || base===head) return true;
    const pair=base+'...'+head;
    if (compared.has(pair)) return true;
    const result=await invoke(comparisonReader,comparisonReader==='github_compare_commits'
      ? {repo_full_name:REPOSITORY,base,head}
      : {url:'https://api.github.com/repos/'+REPOSITORY+'/compare/'+pair+'?per_page=1&page=1'});
    if (!receivedComparison(result,base,head,comparisonReader==='github_compare_commits')) return false;
    compared.add(pair);
    return true;
  }
  async function readState() {
    if (storage) return readLocalState();
    await verify();
    await restoreHistory();
    const observations=[];
    for (let pass=0;pass<READBACK_PASSES;pass++) {
      const commit_sha=await currentHead(pass!==0);
      if (!commit_sha) {
        observations.push({source:pass?'commit':'ref',status:'NOT_FOUND'});
        if (!floor && !writes.size && pass===READBACK_PASSES-1)
          return {sha:null,state:initial(),content:null,commit_sha:null};
        continue;
      }
      const current=await readAt(commit_sha);
      observations.push({source:pass?'commit':'ref',...stateIdentity(current)});
      if (await succeedsFloor(current)) {
        advanceFloor(current);
        return current;
      }
      await record({phase:'stale-account-readback',observed:stateIdentity(current),
        minimum:stateIdentity(floor),observed_at:new Date().toISOString()});
    }
    throw readbackPending('CURRENT_HEAD_BEHIND_OBSERVED_WRITE',observations);
  }
  function inspectHistory({operation_key,attempt_key}={}) {
    if ((operation_key!==undefined || attempt_key!==undefined) &&
        (!hex(operation_key) || !hex(attempt_key)))
      throw new TypeError('Original operation and attempt hashes required for lease history');
    loadHistory();
    if (storage) loadLocalHistory();
    const selectedWrites=[...writes.values()].filter(write=>operation_key===undefined ||
      write.state.active?.operation_key===operation_key && write.state.active?.attempt_key===attempt_key);
    const localCandidates=new Map(localSnapshots);
    if (storage && localFloor) localCandidates.set(localFloor.storage_snapshot.revision,localFloor.storage_snapshot);
    const selectedLocal=storage ? [...localCandidates.values()].map(raw=>localSnapshot(raw)).filter(write=>operation_key===undefined ||
      write.state.active?.operation_key===operation_key && write.state.active?.attempt_key===attempt_key) : [];
    const tokens=new Map();
    for (const write of [...selectedWrites,...selectedLocal]) if (write.state.active)
      tokens.set(write.state.active.token,write.state.active);
    if (operation_key!==undefined && tokens.size>1)
      throw new TypeError('One original account attempt has multiple retained tokens');
    return {status:'ACCOUNT_HISTORY_INSPECTED',account_key:key,current:false,
      minimum_state:storage && localFloor ? localIdentity(localFloor) : stateIdentity(floor),stale_readbacks:copy(historicalStaleReads),
      writes:[...selectedWrites.map(write=>({...writeIdentity(write),
        readback_verified:verifiedWrites.has(write.commit_sha)})),
        ...selectedLocal.map(write=>({...localWriteIdentity(write),
          readback_verified:(localFloor?.storage_snapshot.revision||0)>=write.storage_snapshot.revision}))],
      ...(operation_key!==undefined && tokens.size===1 ? {lease:copy([...tokens.values()][0])}: {})};
  }
  async function receiveWrite({binding,args,raw}={}) {
    await verify();
    if (binding===LOCAL_CAS_BINDING) {
      if (!storage) throw new TypeError('Select the original local coordinator before receiving its write');
      const write=rememberLocal(raw,localArgs(args));
      await record({phase:'original-local-account-write-receiving',original:{binding,args:copy(args),raw:copy(raw)},observed_at:new Date().toISOString()});
      await readLocalState();
      return {status:'ACCOUNT_WRITE_RECEIVED',account_key:key,current:false,
        accepted_write:localWriteIdentity(write),minimum_state:localIdentity(localFloor),...localProvenance(write)};
    }
    loadHistory();
    const write=retainedWrite(binding,args,raw);
    // This is an imported original result, never another provider invocation.
    // Its subsequent exact file readback lets a later handle receive it again.
    await record({phase:'original-account-write-receiving',
      original:{binding,args:copy(args),raw:copy(raw)},observed_at:new Date().toISOString()});
    await receiveAccepted(write);
    return {status:'ACCOUNT_WRITE_RECEIVED',account_key:key,current:false,
      accepted_write:writeIdentity(write),minimum_state:stateIdentity(floor)};
  }
  async function change(transform) {
    if (storage) return changeLocal(transform);
    throw Object.assign(new Error('Private Git account-state writes are disabled; receive the original account into the selected shared local coordinator.'),{code:'LOCAL_ACCOUNT_STORAGE_REQUIRED'});
  }
  async function ensureCurrentSchema() {
    const current=await readState();
    if(current.state.schema===SCHEMA)return {status:'ACCOUNT_SOURCE_CURRENT',
      account_key:key,revision:current.state.revision,state_sha:current.sha,
      commit_sha:current.commit_sha};
    // The existing action owns this same-state CAS. There is no second setter,
    // synthetic provider deadline, replacement queue, or reset of prior debits.
    // A conflicting old acquisition is reread by change() before promotion.
    const result=await change(state=>state.schema===SCHEMA
      ? {result:{status:'ACCOUNT_SOURCE_CURRENT',account_key:key}}
      : {next:{...state},result:{status:'ACCOUNT_SOURCE_UPGRADED',account_key:key,
          previous_schema:state.schema,schema:SCHEMA}});
    if(!['ACCOUNT_SOURCE_CURRENT','ACCOUNT_SOURCE_UPGRADED'].includes(result.status))
      return result;
    const received=await readState();
    if(received.state.schema!==SCHEMA)
      throw new TypeError('Current account source upgrade was not received');
    const {state,...summary}=result;
    return {...summary,state_sha:received.sha,
      commit_sha:received.commit_sha,revision:received.state.revision};
  }
  function deadlineMetadata(state) {
    const proof = state.deadline_source;
    const classified = classifyProof(proof);
    if (classified?.provider_service === 'connector') {
      const origin = proof.source_account || selected;
      return {deadline_scope:copy(classified.scope),
        deadline_source_account:{id:String(origin.id),email:origin.email,link_id:origin.link_id}};
    }
    return {deadline_scope:{kind:'gmail_profile',profile_id:selected.id}};
  }
  function decision(state, operationKey, queue = maintainQueue(state,Date.now(),false)) {
    const now = Date.now(), summary = queueSummary(state,queue,operationKey,now);
    const automation=automationDecision(state);
    const deadline = providerDeadline(state);
    if(state.schema!==SCHEMA)return {status:'ACCOUNT_SOURCE_UPGRADE_REQUIRED',
      account_key:key,required_schema:SCHEMA,observed_schema:state.schema,
      provider_not_before:deadline?.not_before||null,queue:summary,automation,
      reason:'Adopt the paired current sender; its original action receives the same account source upgrade'};
    if (deadline && Date.parse(deadline.not_before) > now)
      return {status:'PROVIDER_DEFERRED',retry_after:deadline.not_before,account_key:key,
        deadline_return_sha256:deadline.deadline_source.return_sha256,
        ...deadlineMetadata(deadline),queue:summary,automation};
    if (activeWaiting(state,now))
      return {status:'SEND_ACTIVE',retry_after:state.active.expires_at,account_key:key,queue:summary,automation};
    if(automation.status==='AUTOMATION_USAGE_REQUIRED' && activeUsageRefresh(state,now))
      return {...usageRefreshWaiting(state),automation,queue:summary};
    if(automation.status!=='AUTOMATION_READY')return {...automation,queue:summary};
    // An offered queue turn is not an acquired send token. A runner here is
    // ready to work now; retain older unexpired requests and acquire an idle
    // account through the existing CAS instead of waiting for an absent poll.
    // A real active token and returned provider deadline above always win.
    return {status:'READY',account_key:key,queue:summary,automation};
  }
  async function inspect({operation_key,offset=0,limit=0} = {}) {
    if (operation_key != null && !hex(operation_key))
      throw new TypeError('Original operation hash required for its waiting position');
    if (!Number.isSafeInteger(offset) || offset < 0 ||
        !Number.isSafeInteger(limit) || limit < 0 || limit > MAX_WAITING)
      throw new TypeError('Valid account waiting-page offset and limit required');
    const current = await readState(), queue = maintainQueue(current.state,Date.now(),false);
    const result = {...decision(current.state,operation_key,queue),state_sha:current.sha,
      revision:current.state.revision,commit_sha:current.commit_sha,
      send_binding:sendBinding,provider_not_before:providerDeadline(current.state)?.not_before || null,
      legacy_provider_not_before:current.state.not_before};
    // The complete queue is available by explicit page request. The normal
    // sender keeps only its position and next handoff in the outcome.
    if (limit) {
      const waiting = queue.waiting.slice(offset,offset+limit), next = offset+waiting.length;
      result.queue_page = {waiting,offset,total:queue.waiting.length,
        next_offset:next < queue.waiting.length ? next : null,has_more:next < queue.waiting.length};
    }
    return result;
  }
  async function acquire({operation_key,attempt_key,operation_lease} = {}) {
    if (!hex(operation_key) || !hex(attempt_key) || !validOperationLease(operation_lease))
      throw new TypeError('Original operation, exact attempt and unchanged operation lease required');
    const compatibility=await ensureCurrentSchema();
    if(!['ACCOUNT_SOURCE_CURRENT','ACCOUNT_SOURCE_UPGRADED'].includes(compatibility.status))return compatibility;
    const preparedUsage=await prepareAutomationUsage();
    if(preparedUsage && !['AUTOMATION_USAGE_CURRENT','AUTOMATION_USAGE_RECEIVED'].includes(preparedUsage.status))
      return preparedUsage;
    const result = await change(state => {
      const now = Date.now(), queue = maintainQueue(state,now,false);
      const entered = enterQueue(state,queue,operation_key,operation_lease,now);
      // Retain legacy offered-turn metadata for older readers. It grants no
      // send token; the ready caller acquires the idle account in this CAS.
      if (!activeWaiting(state,now) && !queue.turn && queue.waiting.length &&
          !providerWaiting(state,now,queue.waiting[0].send_binding || CONNECTOR_SEND)) {
        const head = queue.waiting[0], offered_at = new Date(now).toISOString();
        queue.turn = {operation_key:head.operation_key,sequence:head.sequence,
          offered_at,expires_at:new Date(now+TURN_MS).toISOString()};
      }
      const available = decision(state,operation_key,queue);
      if (entered.full && available.status !== 'READY') return withQueueResult(state,queue,{
        status:'ACCOUNT_QUEUE_FULL',account_key:key,queue:queueSummary(state,queue,operation_key,now),
        retry_after:available.retry_after || queue.turn?.expires_at || null});
      if (available.status !== 'READY') return withQueueResult(state,queue,available);
      const acquired_at = new Date(now).toISOString();
      const lease = {operation_key,attempt_key,send_binding:sendBinding,acquired_at,
        expires_at:new Date(now+LEASE_MS).toISOString(),
        token:digest({account_key:key,operation_key,attempt_key,revision:state.revision+1,
          acquired_at,local_sequence:++sequence})};
      queue.waiting = queue.waiting.filter(item => item.operation_key !== operation_key);
      queue.turn = null;changedQueue(queue,'ADMITTED',[operation_key],now);
      return {next:{...state,active:lease,admission_queue:queue},result:{status:'ACQUIRED',lease}};
    });
    if (result.status !== 'ACQUIRED') {
      const {state,...summary} = result;
      if (!state || result.status === 'ACCOUNT_STATE_CONTENDED') return summary;
      const observed = decision(state,operation_key);
      if (result.status === 'ACCOUNT_QUEUE_FULL') return {...summary,queue:observed.queue};
      // The accepted immutable postimage describes this request's saved turn.
      // It grants no token; a later acquisition reads the actual branch again.
      return observed.status === 'READY'
        ? {...summary,status:'ACCOUNT_QUEUED',ready:true,queue:observed.queue,
          retry_after:new Date().toISOString()}
        : {...summary,...observed};
    }
    // The immutable accepted write proves acquisition at that commit. Read the
    // current head separately; an observed floor is not a claim of linearizability.
    const current=await readState();
    if (current.state.active?.token !== result.lease.token ||
        Date.parse(result.lease.expires_at) <= Date.now())
      return {status:'ACCOUNT_LEASE_CHANGED',account_key:key,state_sha:current.sha,
        commit_sha:current.commit_sha,revision:current.state.revision,accepted_write:result.accepted_write};
    if (providerWaiting(current.state,Date.now())) {
      const deferred = decision(current.state,operation_key);
      await release(result.lease,{outcome:'DEFERRED_BEFORE_SEND'});
      return deferred;
    }
    return {status:'ACQUIRED',lease:Object.freeze(result.lease),
      state_sha:current.sha,commit_sha:current.commit_sha,revision:current.state.revision,
      accepted_write:result.accepted_write,account_key:key};
  }

  // Receive the same queued generation after an ended local runtime lost its
  // volatile journal. This CAS grants no send token and creates no new wait.
  async function receiveQueuedReturn({operation_key,operation_lease,sequence:requestSequence,
    queued_at,source_commit_sha,source_state_sha,source_storage_receipt,recovery_sha256} = {}) {
    if (!hex(operation_key) || !validOperationLease(operation_lease) || !operation_lease ||
        !Number.isSafeInteger(requestSequence) || requestSequence<1 || !iso(queued_at) ||
        !gitSha(source_commit_sha) || !gitSha(source_state_sha) || !hex(recovery_sha256))
      throw new TypeError('Exact original queued return and receiving identity required');
    let original;
    if (source_storage_receipt!==undefined) {
      if (!storage) throw new TypeError('Select the original local coordinator for its queued return');
      const receipt=validateLocalQueuedReceipt({source_storage_receipt,source_commit_sha,source_state_sha});
      await readLocalState();
      let raw=localSnapshots.get(receipt.revision) ||
        (localFloor?.storage_snapshot.revision===receipt.revision?localFloor.storage_snapshot:null);
      if (!raw) {
        const page=await storage.history({namespace:'account',key,after_revision:receipt.revision-1,limit:1});
        raw=page?.records?.length===1?page.records[0]:null;
      }
      if (!raw || raw.revision!==receipt.revision || raw.revision>localFloor.storage_snapshot.revision || digest(raw.receipt)!==digest(receipt))
        throw new TypeError('The exact queued local source receipt is absent from its original history');
      original=localSnapshot(raw);
    } else original=await readAt(source_commit_sha);
    const matches=item=>item && item.operation_key===operation_key &&
      item.operation_lease===operation_lease && item.sequence===requestSequence &&
      item.queued_at===queued_at && (item.send_binding||CONNECTOR_SEND)===sendBinding;
    if ((source_storage_receipt===undefined && original.sha!==source_state_sha) || !original.state.admission_queue?.waiting?.some(matches) ||
        original.state.active?.operation_key===operation_key ||
        original.state.last_release?.operation_key===operation_key ||
        original.state.admission_queue?.last_change?.kind!=='QUEUED' ||
        !original.state.admission_queue.last_change.operation_keys.includes(operation_key))
      throw new TypeError('Immutable source must contain this original unused queued request');
    const recovery={schema:'commons.gmail-queued-return-recovery/v1',
      operation_key,operation_lease,sequence:requestSequence,queued_at,
      source_commit_sha,source_state_sha,recovery_sha256,
      ...(source_storage_receipt===undefined?{}:{source_storage_receipt:copy(source_storage_receipt)})};
    const result=await change(state=>{
      const now=Date.now(),queue=maintainQueue(state,now,false),item=queue.waiting.find(matches);
      if (!item) {
        const rawItem=state.admission_queue?.waiting?.find(value=>value.operation_key===operation_key);
        const sourceItem=original.state.admission_queue.waiting.find(matches);
        // An expired wait does not retain its old place. Receive its ended
        // owner only when the original reservation is still verified by the
        // factory, and make the later run acquire an ordinary new account turn.
        if ((rawItem && !matches(rawItem)) ||
            state.active?.operation_key===operation_key ||
            state.last_release?.operation_key===operation_key ||
            Date.parse(sourceItem.expires_at)>now)
          return {result:{status:'ORIGINAL_ACCOUNT_WAIT_CHANGED',account_key:key,operation_key,
            queue:queueSummary(state,queue,operation_key,now)}};
        const received={...recovery,source_expires_at:sourceItem.expires_at,
          received_at:new Date(now).toISOString(),disposition:'EXPIRED_REQUIRES_ORDINARY_ACQUISITION'};
        changedQueue(queue,'EXPIRED_QUEUED_RETURN_RECEIVED',[operation_key],now);
        queue.last_change.recovery=received;
        // Write through the existing CAS even if expiration was already
        // recorded; a stale negative read must never establish receiving.
        return {next:{...state,admission_queue:queue},result:{
          status:'EXPIRED_QUEUED_RETURN_RECEIVED',account_key:key,operation_key,
          recovery:copy(received),queue:queueSummary(state,queue,operation_key,now)}};
      }
      if (state.active?.operation_key===operation_key)
        return {result:{status:'ORIGINAL_ACCOUNT_WAIT_CHANGED',account_key:key,operation_key,
          queue:queueSummary(state,queue,operation_key,now)}};
      if (item.queued_return_recovery) {
        const {received_at,...identity}=item.queued_return_recovery;
        if (digest(identity)!==digest(recovery))
          return {result:{status:'ORIGINAL_ACCOUNT_RECOVERY_CHANGED',account_key:key,operation_key}};
        return {result:{status:'QUEUED_RETURN_RECEIVED',account_key:key,operation_key,
          recovery:copy(item.queued_return_recovery),queue:queueSummary(state,queue,operation_key,now)}};
      }
      item.queued_return_recovery={...recovery,received_at:new Date(now).toISOString()};
      changedQueue(queue,'QUEUED_RETURN_RECEIVED',[operation_key],now);
      return {next:{...state,admission_queue:queue},result:{status:'QUEUED_RETURN_RECEIVED',
        account_key:key,operation_key,recovery:copy(item.queued_return_recovery),
        queue:queueSummary(state,queue,operation_key,now)}};
    });
    const {state,...summary}=result;
    return summary;
  }

  async function withdraw({operation_key,reason='ORIGINAL_OPERATION_WITHDRAWN'} = {}) {
    if (!hex(operation_key) || typeof reason !== 'string' ||
        !/^[A-Z][A-Z0-9_]{0,63}$/.test(reason))
      throw new TypeError('Original queued operation and explicit withdrawal reason required');
    const result = await change(state => {
      const now = Date.now(), queue = maintainQueue(state,now,false);
      const had = state.admission_queue?.waiting?.some(item => item.operation_key === operation_key);
      if (!had) return {result:{status:'NO_RETAINED_ACCOUNT_WAIT',account_key:key,operation_key,
        queue:queueSummary(state,queue,operation_key,now)}};
      queue.waiting = queue.waiting.filter(item => item.operation_key !== operation_key);
      if (queue.turn?.operation_key === operation_key) queue.turn = null;
      if (had) changedQueue(queue,reason,[operation_key],now);
      const nextState = {...state,admission_queue:queue};
      const offered = maintainQueue(nextState,now,true);
      const status = had ? 'ACCOUNT_WAIT_WITHDRAWN' : 'NO_RETAINED_ACCOUNT_WAIT';
      return withQueueResult(state,offered,{status,account_key:key,operation_key,reason,
        queue:queueSummary(state,offered,operation_key,now)});
    });
    const {state,...summary} = result;
    // The result describes the accepted immutable postimage. Withdrawal never
    // clears any acquired account token or reconciles a provider invocation.
    if (state) summary.queue = queueSummary(state,maintainQueue(state,Date.now(),false),operation_key,Date.now());
    return summary;
  }
  async function confirm(lease,{observe_only=false,verify_only=false,dispatch}={}) {
    if (!hex(lease?.token) || !hex(lease.operation_key) || !hex(lease.attempt_key))
      throw new TypeError('Original acquired account token required');
    const matches=active=>active && active.token===lease.token &&
      active.operation_key===lease.operation_key && active.attempt_key===lease.attempt_key &&
      active.acquired_at===lease.acquired_at && active.expires_at===lease.expires_at &&
      (active.send_binding||CONNECTOR_SEND)===sendBinding &&
      (lease.send_binding||CONNECTOR_SEND)===sendBinding && Date.parse(active.expires_at)>Date.now();
    let current=await readState();
    if(!matches(current.state.active))
      return {status:'ACCOUNT_LEASE_CHANGED',account_key:key,state_sha:current.sha,
        commit_sha:current.commit_sha,revision:current.state.revision};
    // Original interrupted-acquisition reconciliation needs a read-only token
    // check, not a dispatch charge or permission to send.
    if(observe_only)return {status:'LEASE_CONFIRMED',account_key:key,
      lease:Object.freeze({...current.state.active}),state_sha:current.sha,
      commit_sha:current.commit_sha,revision:current.state.revision};
    if(current.state.schema!==SCHEMA){
      const compatibility=await ensureCurrentSchema();
      if(!['ACCOUNT_SOURCE_CURRENT','ACCOUNT_SOURCE_UPGRADED'].includes(compatibility.status))return compatibility;
      current=await readState();
      if(!matches(current.state.active))return {status:'ACCOUNT_LEASE_CHANGED',account_key:key,
        state_sha:current.sha,commit_sha:current.commit_sha,revision:current.state.revision};
    }
    if(providerWaiting(current.state,Date.now()))
      return {...decision(current.state),state_sha:current.sha,commit_sha:current.commit_sha,
        revision:current.state.revision};
    const envelope=dispatch?.envelope,args=dispatch?.args;
    const recipientUnits=envelopeRecipientUnits(envelope);
    if(!args || typeof args!=='object' || Array.isArray(args) ||
        envelope?.link_id!==selected.link_id || !isSelectedSender(envelope.from_address) ||
        recipientUnits===null)
      return {status:'AUTOMATION_ENVELOPE_REQUIRED',account_key:key,
        reason:'Retain the original reviewed To/Cc/Bcc envelope and exact dispatch arguments'};
    const existing=current.state.automation?.attempts.find(row=>row.token===lease.token);
    if(verify_only) {
      if(!existing || existing.args_sha256!==digest(args) ||
          existing.envelope_sha256!==digest(envelope) || existing.recipient_units!==recipientUnits ||
          existing.return_sha256!==null)
        return {status:'AUTOMATION_DISPATCH_RECONCILIATION_REQUIRED',account_key:key};
      const usage=automationDecision(current.state,{messages:0,recipient_units:0});
      if(!usage.snapshot_fresh || usage.unknown_recipient_units>0)
        return {...usage,status:usage.unknown_recipient_units>0?
          'AUTOMATION_RECIPIENT_REVIEW_REQUIRED':'AUTOMATION_USAGE_REQUIRED'};
      if(usage.messages>AUTOMATION_POLICY.max_messages ||
          usage.recipient_units>AUTOMATION_POLICY.max_recipient_units)
        return {...usage,status:'AUTOMATION_DEFERRED'};
      return {status:'CONFIRMED',account_key:key,lease:Object.freeze({...current.state.active}),
        dispatch:Object.freeze({...existing}),state_sha:current.sha,
        commit_sha:current.commit_sha,revision:current.state.revision};
    }
    if(existing)return {status:'AUTOMATION_DISPATCH_RECONCILIATION_REQUIRED',account_key:key,
      attempt_key:lease.attempt_key,reason:'Receive the original charged attempt before any further dispatch'};
    const refreshed=await refreshAutomationUsage();
    if(!['AUTOMATION_USAGE_CURRENT','AUTOMATION_USAGE_RECEIVED'].includes(refreshed.status))return refreshed;
    const result=await change(state=>{
      if(!matches(state.active))return {result:{status:'ACCOUNT_LEASE_CHANGED',account_key:key}};
      if(providerWaiting(state,Date.now()))return {result:decision(state)};
      if(state.automation?.attempts.some(row=>row.token===lease.token))
        return {result:{status:'AUTOMATION_DISPATCH_RECONCILIATION_REQUIRED',account_key:key}};
      const usage=automationDecision(state,{messages:1,recipient_units:recipientUnits});
      if(usage.status!=='AUTOMATION_READY')return {result:usage};
      const at=new Date().toISOString(),cutoff=Date.now()-AUTOMATION_POLICY.window_ms;
      const row={token:lease.token,operation_key:lease.operation_key,attempt_key:lease.attempt_key,
        send_binding:sendBinding,at,recipient_units:recipientUnits,args_sha256:digest(args),
        envelope_sha256:digest(envelope),message_id:null,return_sha256:null};
      const automation={...state.automation,last_dispatch_at:at,
        attempts:[...state.automation.attempts.filter(value=>Date.parse(value.at)>cutoff),row]};
      return {next:{...state,automation},result:{status:'AUTOMATION_DISPATCH_CHARGED',
        account_key:key,dispatch:row}};
    });
    if(result.status!=='AUTOMATION_DISPATCH_CHARGED')return result;
    // Receive the exact immutable CAS, then recheck the current lease and
    // provider floor. The charge remains if readback or dispatch is uncertain.
    const latest=await readState();
    if(!matches(latest.state.active))return {status:'ACCOUNT_LEASE_CHANGED',account_key:key};
    if(providerWaiting(latest.state,Date.now()))return decision(latest.state);
    const charged=latest.state.automation?.attempts.find(row=>row.token===lease.token);
    if(!charged || digest(charged)!==digest(result.dispatch))
      throw new TypeError('Original automated dispatch debit changed before receiving');
    const latestUsage=automationDecision(latest.state,{messages:0,recipient_units:0});
    if(latestUsage.messages>AUTOMATION_POLICY.max_messages ||
        latestUsage.recipient_units>AUTOMATION_POLICY.max_recipient_units)
      return {...latestUsage,status:'AUTOMATION_DEFERRED',account_key:key};
    if(!latestUsage.snapshot_fresh || latestUsage.unknown_recipient_units>0)
      return {status:'AUTOMATION_USAGE_REQUIRED',account_key:key,
        reason:'Dispatch charge retained; reconcile original attempt after stale activity receiving'};
    return {status:'CONFIRMED',account_key:key,lease:Object.freeze({...latest.state.active}),
      dispatch:Object.freeze({...charged}),state_sha:latest.sha,
      commit_sha:latest.commit_sha,revision:latest.state.revision};
  }
  function isSelectedSender(value) {
    if (value == null || value === selected.email) return true;
    if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value)) return false;
    // The native From field accepts a display name and one mailbox. Match that
    // mailbox exactly, without rewriting any retained invocation field or hash.
    const match = /^(.+?)\s*<([^<>\s]+)>$/.exec(value.trim());
    if (!match || match[2] !== selected.email) return false;
    const name = match[1].trim();
    return !!name && (/^[^<>,;:@"\\[\]\x00-\x1f\x7f]+$/.test(name) ||
      /^"(?:[^"\\\x00-\x1f\x7f]|\\["\\])*"$/.test(name));
  }
  async function observe({args, raw, operation_key, observed_at, source_account, attempt_key, dispatch_token} = {}) {
    if (!hex(operation_key) || !iso(observed_at))
      throw new TypeError('Original operation hash and returned-event timestamp required');
    const origin = source_account === undefined ? selected : source_account;
    if (!origin || !/^\d+$/.test(String(origin.id)) ||
        typeof origin.email !== 'string' || !origin.email.includes('@') ||
        typeof origin.link_id !== 'string' || !origin.link_id ||
        args?.link_id !== origin.link_id ||
        !isSelectedSender(args.from_address))
      throw new TypeError('Original native Gmail invocation belongs to another source account');
    const classified = classifyLimit(raw,observed_at);
    if (!classified) {
      if(String(origin.id)!==selected.id || origin.link_id!==selected.link_id || origin.email!==selected.email)
        throw new TypeError('Dispatch return belongs to another configured account');
      if(attempt_key!==undefined && !hex(attempt_key))throw new TypeError('Original dispatch attempt required');
      if(dispatch_token!==undefined && attempt_key===undefined)throw new TypeError('Original dispatch attempt required');
      if(attempt_key!==undefined)await receiveAutomationReturn(args,raw,operation_key,observed_at,attempt_key,dispatch_token);
      return {status:'NOT_A_RETURNED_GMAIL_RATE_LIMIT'};
    }
    const shared = classified.provider_service === 'connector' &&
      classified.scope?.kind === 'connector_tool' &&
      Object.hasOwn(CONNECTOR_TOOLS,classified.scope.binding) &&
      CONNECTOR_TOOLS[classified.scope.binding] === classified.scope.tool;
    if (String(origin.id) !== selected.id ||
        origin.link_id !== selected.link_id || origin.email !== selected.email)
      throw new TypeError('A returned send limit belongs to its actual originating account');
    await verify();
    const proof = {profile_id:selected.id,operation_key,observed_at,
      invocation_sha256:digest(args),return_sha256:digest(raw),raw,
      ...(shared ? {scope:copy(classified.scope),binding:classified.scope.binding,
        source_account:{id:String(origin.id),email:origin.email,link_id:origin.link_id}} : {})};
    // Retain the actual provider floor even when a legacy charged-token
    // association still needs its original caller evidence.
    const observation=await recordDeadline(classified,proof);
    if(!['PROVIDER_DEADLINE_RECORDED','PROVIDER_DEADLINE_RETAINED'].includes(observation.status))return observation;
    if(attempt_key!==undefined && !hex(attempt_key))throw new TypeError('Original dispatch attempt required');
    if(dispatch_token!==undefined && attempt_key===undefined)throw new TypeError('Original dispatch attempt required');
    if(attempt_key!==undefined)await receiveAutomationReturn(args,raw,operation_key,observed_at,attempt_key,dispatch_token);
    return observation;
  }
  async function recordDeadline(classified, proof) {
    const observedRow = {not_before:classified.retry_after,deadline_source:proof};
    validateDeadline(observedRow);
    const result = await change(state => {
      const rows = new Map();
      for (const row of deadlineRows(state)) mergeDeadline(rows,row);
      mergeDeadline(rows,observedRow);
      const next = retainDeadlines({...state,provider_deadlines:[...rows.values()]});
      if (state.admission_queue != null)
        next.admission_queue = maintainQueue(next,Date.now(),false);
      if (digest(next) === digest(state))
        return {result:{status:'PROVIDER_DEADLINE_RETAINED'}};
      return {next,result:{status:'PROVIDER_DEADLINE_RECORDED'}};
    });
    if (result.status === 'ACCOUNT_STATE_CONTENDED') return result;
    const retained = deadlineRows(result.state).find(row =>
      scopeKey(classifyProof(row.deadline_source)) === scopeKey(classified));
    if (!retained || Date.parse(retained.not_before) < Date.parse(classified.retry_after))
      throw new TypeError('Complete original scoped sending deadline was not retained');
    const applicable = providerDeadline(result.state,
      classified.provider_service === 'connector' ? classified.scope.binding : sendBinding) || retained;
    return {status:result.status,account_key:key,retry_after:applicable.not_before,
      deadline_return_sha256:applicable.deadline_source.return_sha256,
      ...deadlineMetadata(applicable),state_sha:result.state_sha || null,
      commit_sha:result.commit_sha || null,revision:result.revision,
      accepted_write:result.accepted_write || null};
  }
  async function observeNativeReturn({invocation,returned,operation_key,source_account,attempt_key,dispatch_token} = {}) {
    if (sendBinding !== NATIVE_SEND)
      throw new TypeError('Native HTTP receiving requires the selected users.messages.send handle');
    const origin = source_account === undefined ? selected : source_account;
    if (!hex(operation_key) || !nativeInvocationMatches(invocation) ||
        !origin || String(origin.id) !== selected.id ||
        origin.email !== selected.email || origin.link_id !== selected.link_id ||
        returned?.binding !== NATIVE_SEND || !iso(returned.observed_at) ||
        returned.invocation != null && digest(returned.invocation) !== digest(invocation))
      throw new TypeError('Original native Gmail operation, sender, invocation and returned event required');
    const classified = classifyNativeLimit(returned,returned.observed_at);
    if (!classified) {
      if(attempt_key!==undefined && !hex(attempt_key))throw new TypeError('Original native dispatch attempt required');
      if(dispatch_token!==undefined && attempt_key===undefined)throw new TypeError('Original native dispatch attempt required');
      if(attempt_key!==undefined)
        await receiveAutomationReturn(invocation,returned,operation_key,returned.observed_at,attempt_key,dispatch_token);
      return {status:'NOT_A_RETURNED_GMAIL_RATE_LIMIT'};
    }
    await verify();
    const proof = {profile_id:selected.id,operation_key,observed_at:returned.observed_at,
      invocation_sha256:digest(invocation),return_sha256:digest(returned),raw:copy(returned),
      invocation:copy(invocation),scope:{kind:'gmail_profile',profile_id:selected.id},
      binding:NATIVE_SEND,source_account:{id:selected.id,email:selected.email,link_id:selected.link_id}};
    const observation=await recordDeadline(classified,proof);
    if(!['PROVIDER_DEADLINE_RECORDED','PROVIDER_DEADLINE_RETAINED'].includes(observation.status))return observation;
    if(attempt_key!==undefined && !hex(attempt_key))throw new TypeError('Original native dispatch attempt required');
    if(dispatch_token!==undefined && attempt_key===undefined)throw new TypeError('Original native dispatch attempt required');
    if(attempt_key!==undefined)
      await receiveAutomationReturn(invocation,returned,operation_key,returned.observed_at,attempt_key,dispatch_token);
    return observation;
  }
  async function release(lease, {outcome} = {}) {
    if (!hex(lease?.token) || !hex(lease.operation_key) || !hex(lease.attempt_key) ||
        typeof outcome !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(outcome))
      throw new TypeError('Original account lease and local completion outcome required');
    const result = await change(state => {
      if (state.active?.token !== lease.token)
        return {result:{status:'ORIGINAL_LEASE_NO_LONGER_ACTIVE'}};
      if (state.active.operation_key !== lease.operation_key || state.active.attempt_key !== lease.attempt_key ||
          (state.active.send_binding || CONNECTOR_SEND) !== sendBinding ||
          (lease.send_binding || CONNECTOR_SEND) !== sendBinding)
        throw new TypeError('Original account lease identity changed');
      const now = Date.now(), releasedState = {...state,active:null};
      const queue = maintainQueue(releasedState,now,true);
      const next = {...releasedState,last_release:{token:lease.token,
        operation_key:lease.operation_key,attempt_key:lease.attempt_key,outcome,
        completed_at:new Date(now).toISOString()}};
      if (state.admission_queue != null || queue.waiting.length) next.admission_queue = queue;
      return {next,result:{status:'RELEASED',next_turn:queueSummary(next,queue,null,now)}};
    });
    if (result.status === 'RELEASED' && result.state.active?.token === lease.token)
      throw new TypeError('Original account lease release was not read back');
    const {state,...summary} = result; return summary;
  }
  if (historyOnly) return Object.freeze({inspectHistory,validateOriginalState:content=>{
    if (typeof content!=='string') throw new TypeError('Complete original account JSON text required');
    const state=validate(JSON.parse(content));
    return {account_key:key,profile_id:selected.id,revision:state.revision,content_sha256:digest(content),state:copy(state)};
  }});
  // Independent callers share the existing Git CAS; this queue only drains
  // concurrent methods on this one handle and preserves their original journals.
  function admitted(operation) {
    return (...args) => {
      const work=queue.then(()=>operation(...args));
      queue=work.catch(()=>{});
      return work.then(withLocalResult).catch(error=>{
        if (error?.code==='ACCOUNT_STATE_READBACK_PENDING') return copy(error.decision);
        throw error;
      });
    };
  }
  return Object.freeze({send_binding:sendBinding,inspect:admitted(inspect),acquire:admitted(acquire),
    manual_headroom:'rolling_usage_v2',returned_dispatch_identity:'charged_token_v1',
    refreshAutomationUsage:admitted(refreshAutomationUsage),
    prepareUsage:admitted(prepareUsage),
    confirm:admitted(confirm),observe:admitted(observe),observeReturnedLimit:admitted(observe),
    observeNativeReturn:admitted(observeNativeReturn),
    sent_readback_identity:'original_post_and_sent_v1',observeSentReadback:admitted(observeSentReadback),
    returned_limit_scope:typeof classifyReturnedSendRateLimit === 'function'
      ? 'connector_tool_and_gmail_profile' : 'gmail_profile',release:admitted(release),
    receiveWrite:admitted(receiveWrite),withdraw:admitted(withdraw),
    receiveQueuedReturn:admitted(receiveQueuedReturn),inspectHistory,
    location:() => storage ? ({storage_kind:LOCAL_STORAGE_KIND,coordinator_id:coordinatorId,namespace:'account',account_key:key})
      : ({repository:REPOSITORY,branch,path:STATE_PATH,account_key:key,read_only:true})});
}
function createConnectedMailboxAdmission(options) {
  return createAccountHandle(options);
}
function validateConnectedMailboxAccountState(options={}) {
  const {content,...selected}=options;
  return createAccountHandle(selected,true).validateOriginalState(content);
}
function inspectConnectedMailboxHistory(options={}) {
  const {account,events,sha256Utf8,classifyReturnedGmailRateLimit,classifyReturnedSendRateLimit,
    operation_key,attempt_key,send_binding,storage}=options;
  return createAccountHandle({account,sha256Utf8,classifyReturnedGmailRateLimit,classifyReturnedSendRateLimit,
    send_binding,storage,history:()=>events},true).inspectHistory({operation_key,attempt_key});
}
if (typeof module !== 'undefined' && module.exports)
  module.exports = {createConnectedMailboxAdmission,inspectConnectedMailboxHistory,
    AUTOMATION_POLICY,mailboxRecipientUnits,envelopeRecipientUnits,manualHeadroomSummary,validateMailboxSentReadback,
    validateConnectedMailboxAccountState};
