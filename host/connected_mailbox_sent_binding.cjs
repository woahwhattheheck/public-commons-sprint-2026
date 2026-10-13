'use strict';
// Original pure POST/SENT binding rules from admission 35e92453. No storage or provider calls.
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


module.exports={mailboxRecipientUnits,envelopeRecipientUnits,mailboxRecipientAddresses,canonicalMailboxEvidence,validateMailboxSentReadback};
