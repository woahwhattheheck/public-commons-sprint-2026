'use strict';
// Complete original-attempt provider-evidence receiving. No Gmail send or read.
function createMailboxSentReadbackReceiver({service,admission,sha256Utf8,record,now=()=>Date.now()}={}) {
  if(typeof service?.providerEvidence!=='function'||typeof admission?.observeSentReadback!=='function'||
      admission.sent_readback_identity!=='original_post_and_sent_v1'||typeof sha256Utf8!=='function'||
      typeof record!=='function'||typeof now!=='function')
    throw new TypeError('Use the original trusted queue service, current account authority and retained journal');
  const need=(ok,message)=>{if(!ok)throw new TypeError(message);};
  const clone=value=>JSON.parse(JSON.stringify(value));
  const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':
    value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
  const hash=value=>{const out=sha256Utf8(typeof value==='string'?value:JSON.stringify(value))?.sha256;
    need(typeof out==='string'&&/^[a-f0-9]{64}$/.test(out),'Use the original SHA-256 implementation');return out;};
  const stable=value=>hash(canonical(value));
  let tail=Promise.resolve();
  async function receive(original) {
    // Clone once, preserving insertion order and the original charged-object digest.
    const selected=clone(original),selectionHash=hash(selected);
    const {claim_id,provider_attempt_id,revision_id,account,charge}=selected;
    need(selected.schema==='commons.mailbox-sent-receiving-selection/v1'&&
      [claim_id,provider_attempt_id,revision_id].every(x=>typeof x==='string'&&x)&&
      account&&charge&&charge.source_account&&
      String(account.id)===String(charge.source_account.id)&&account.email===charge.source_account.email&&
      account.link_id===charge.source_account.link_id,
      'Select the original provider claim, attempt, revision, charge and account');
    const identity={claim_id,attempt_id:provider_attempt_id};
    await record({phase:'sent-readback-selected',selection_sha256:selectionHash,original:selected});
    const accept=clone(await service.providerEvidence({...identity,acceptance_only:true}));
    const pageIdentity=page=>{
      need(page?.schema==='commons.mail-provider-evidence-readback.v1'&&
        page.claim_id===claim_id&&page.attempt_id===provider_attempt_id&&
        page.revision_id===revision_id&&page.sender===account.email,
        'The original provider readback page changed its selected account or attempt');
    };
    pageIdentity(accept);
    await record({phase:'sent-acceptance-returned',selection_sha256:selectionHash,result:accept});
    if(!accept.acceptance?.receipt)return {status:'ORIGINAL_POST_ACCEPTANCE_PENDING',selection_sha256:selectionHash};
    const acceptance=accept.acceptance;
    need(stable(acceptance.receipt)===acceptance.receipt_digest,'The complete original POST acceptance changed');
    const a=acceptance.receipt;
    const originalResponse=charge.raw?.provider_transport||charge.raw?.native_response;
    const body=originalResponse?.body_text??originalResponse?.body;
    const seen=new Set(),cursors=new Set();
    let after=null,pages=0,matchingPost=null,matchingPostCount=0,earliestSent=null;
    // Complete pages are already retained by record(). Keep only the selected
    // original POST and earliest matching SENT body across page boundaries.
    // Evidence is digest-sorted. Every reopened receiving pass starts at the
    // original beginning; a new SENT record can sort before an earlier cursor.
    do {
      const page=clone(await service.providerEvidence({...identity,limit:10,...(after?{after_digest:after}:{})}));
      pageIdentity(page);need(Array.isArray(page.items),'Receive the complete original provider evidence page');
      await record({phase:'sent-evidence-page-returned',selection_sha256:selectionHash,after_digest:after,result:page});
      let previous=after||'';
      for(const item of page.items){
        const e=item?.evidence,d=item?.evidence_digest;
        need(typeof d==='string'&&/^[a-f0-9]{64}$/.test(d)&&d>previous&&!seen.has(d)&&
          e?.schema==='commons.mail-provider-evidence.v1'&&e.claim_id===claim_id&&
          e.attempt_id===provider_attempt_id&&e.revision_id===revision_id&&e.sender===account.email&&
          ['POST_RESPONSE','SENT_READBACK'].includes(e.kind)&&stable(e)===d,
          'The complete original provider evidence inventory changed');
        previous=d;seen.add(d);
        if(e.kind==='POST_RESPONSE'){
          const o=e.observation;
          if(o?.method==='POST'&&o.status===originalResponse?.status&&o.body===body&&
            e.invocation?.body===charge.args?.body&&
            e.receipt?.providerMessageId===a.providerMessageId&&e.receipt?.providerThreadId===a.providerThreadId&&
            e.receipt?.rfcMessageId===a.rfcMessageId&&e.receipt?.envelopeDigest===a.envelopeDigest){
            matchingPostCount++;
            if(matchingPostCount===1)matchingPost=item;
          }
        }else{
          const r=e.receipt;
          if(r?.providerMessageId===a.providerMessageId&&r?.providerThreadId===a.providerThreadId&&
            r?.rfcMessageId===a.rfcMessageId&&r?.envelopeDigest===a.envelopeDigest&&
            (!earliestSent||(e.observation.observed_at-earliestSent.evidence.observation.observed_at||
              d.localeCompare(earliestSent.evidence_digest))<0))earliestSent=item;
        }
      }
      const next=page.next_cursor;
      need(next===null||typeof next==='string'&&/^[a-f0-9]{64}$/.test(next)&&
        page.items.length>0&&next===previous&&!cursors.has(next),'Original provider evidence pagination did not advance');
      if(next)cursors.add(next);
      after=next;pages++;
    }while(after);
    need(matchingPostCount<=1,'Several original POST observations match; retain their original separate return identities');
    if(!matchingPost)return {status:'ORIGINAL_POST_EVIDENCE_PENDING',selection_sha256:selectionHash,pages,evidence_count:seen.size};
    if(!earliestSent)return {status:'ORIGINAL_SENT_READBACK_PENDING',selection_sha256:selectionHash,pages,evidence_count:seen.size};
    const input={...charge,post:matchingPost,sent:earliestSent,acceptance};
    await record({phase:'sent-settlement-selected',selection_sha256:selectionHash,input});
    let returned=await admission.observeSentReadback(input);
    // Receiving the retained first POST uses its exact original wrapper. It is
    // never normalized anew from the later GET or from a reduced receipt.
    if(returned.status==='AUTOMATION_ORIGINAL_RETURN_REQUIRED'){
      const observed=charge.args.binding==='gmail.users.messages.send'
        ? await admission.observeNativeReturn({invocation:charge.args,returned:charge.raw,
          operation_key:charge.operation_key,attempt_key:charge.attempt_key,
          dispatch_token:charge.dispatch_token,source_account:charge.source_account})
        : await admission.observe({args:charge.args,raw:charge.raw,observed_at:charge.observed_at,
          operation_key:charge.operation_key,attempt_key:charge.attempt_key,
          dispatch_token:charge.dispatch_token,source_account:charge.source_account});
      await record({phase:'original-post-return-received',selection_sha256:selectionHash,result:observed});
      if(observed.status!=='NOT_A_RETURNED_GMAIL_RATE_LIMIT')
        return {status:'ORIGINAL_POST_RECEIVING_PENDING',selection_sha256:selectionHash,account:observed};
      returned=await admission.observeSentReadback(input);
    }
    await record({phase:'sent-settlement-returned',selection_sha256:selectionHash,result:returned});
    return {status:returned.status,selection_sha256:selectionHash,pages,evidence_count:seen.size,
      original_claim_id:claim_id,original_provider_attempt_id:provider_attempt_id,account:returned};
  }
  return Object.freeze({receive(original){
    const selected=clone(original);
    const work=tail.then(()=>receive(selected));tail=work.catch(()=>{});return work;
  }});
}
if(typeof module!=='undefined'&&module.exports)module.exports={createMailboxSentReadbackReceiver};
