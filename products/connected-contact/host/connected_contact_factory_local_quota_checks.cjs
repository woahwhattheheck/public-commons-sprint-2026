async function runContactFactoryLocalQuotaChecks(files) {
 const clone=x=>JSON.parse(JSON.stringify(x)),assert=(v,m)=>{if(!v)throw Error(m);};
 const F={exports:{}};new Function('module','exports',files['host/connected_first_contact.cjs'])(F,F.exports);
 const keys={hash:'host/connected_sha256.cjs',intent:'host/revenue_outbound_intent.cjs',gateway:'host/first_contact_gateway.cjs',mailboxAdmission:'host/connected_mailbox_admission.cjs',publicationPolicy:'commons-publication-policy.cjs',attachments:'host/connected_contact_attachments.cjs',deliveryCorrection:'host/contact_delivery_correction.cjs',content:'host/first_contact_content.cjs',deliveryNotices:'host/connected_delivery_notices.cjs'};
 const loaded=F.exports.loadOriginalContactModules({...Object.fromEntries(Object.entries(keys).map(([k,p])=>[k,files[p]])),deliveryNoticeSources:files});
 const modules={...loaded,mailboxes:[{name:'business',link_id:'synthetic-one',id:'1001',email:'one@example.invalid'},{name:'secondary',link_id:'synthetic-two',id:'1002',email:'two@example.invalid'}]};
 const hash=x=>modules.sha256Utf8(typeof x==='string'?x:JSON.stringify(x)).sha256;
 const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
 let forbidden=0;
 const reject=()=>{forbidden++;throw Error('No external/provider/state operation is permitted in this source check');};
 const tools={};for(const name of ['github_get_profile','github_fetch','github_fetch_file','gmail_get_profile','gmail_search_email_ids','gmail_send_email','gmail_read_email'])tools['mcp__codex_apps__'+name]=reject;
 const coordinatorId='11111111-2222-4333-8444-555555555555',storage={kind:'commons.connected-contact-local-state/v1',coordinatorId,verify:reject,read:reject,compareAndSwap:reject,receive:reject};
 const input={prospect_org:'Synthetic Review',opportunity_id:'synthetic-preserved-case',touchpoint:'initial',link_id:'synthetic-one',to:'receiver@example.invalid',subject:'Source continuity',body:'Synthetic original review only.'};
 const lease='synthetic-original-lease',stateKey='synthetic-private-journal';
 let journal;
 const base={tools,input,modules,lease,stateKey,load:()=>journal,store:(k,v)=>{journal=v;}};
 const fresh=F.exports.createConnectedFirstContact({...base,storage});
 const plan=fresh.plan(),operationKey=hash({input_sha256:plan.input_sha256,lease}),intent=modules.intent.fingerprint(journal.input);
 const initial=clone(journal),at='2026-10-13T10:00:00.000Z',deadline='2040-01-01T00:00:00.000Z';
 const expectedRef='local:'+hash(canonical({coordinator_id:coordinatorId,intent_key:intent.key}));
 const intentContent=JSON.stringify({schema:'commons.local-contact-intent/v1',branch:intent.branch,reference:expectedRef,operation_lease:lease,input_sha256:plan.input_sha256});
 const claimContent=JSON.stringify({protocol:'commons-first-contact-v1',status:'reserved',case:input.opportunity_id,lease,reserved_at:at,send_expires_at:'2026-10-13T10:10:00.000Z'});
 function snapshot(namespace,key,content) {
  const measured=modules.sha256Utf8(content);
  return {kind:'commons.connected-contact-local-snapshot/v1',coordinator_id:coordinatorId,namespace,key,revision:1,sha256:measured.sha256,content,
   receipt:{schema:'commons.connected-contact-local-receipt/v1',coordinator_id:coordinatorId,namespace,key,revision:1,sha256:measured.sha256,bytes:measured.bytes,previous_sha256:null,operation_id:'synthetic-original-'+namespace,action:'compareAndSwap',created_at:at,origin:null}};
 }
 function appendRead(namespace,key,content) {
  const binding='commons.local-state.read',args={namespace,key},call_id=hash(canonical({operation_key:operationKey,binding,args}));
  journal.events.push({phase:'invoking',binding,args,call_id,observed_at:at},{phase:'returned',binding,call_id,raw:snapshot(namespace,key,content),observed_at:at});
 }
 appendRead('intent',intent.branch,intentContent);appendRead('recipient',plan.recipient_claim_path,claimContent);
 const sendArgs={link_id:'synthetic-one',from_address:'one@example.invalid',to:input.to,subject:input.subject,payload:{mime_type:'text/html',charset:'UTF-8',body:{content:modules.gateway.renderFirstContactTextHtml(input.body)}}};
 const msg='User-rate limit exceeded. Retry after '+deadline+' (Mail sending)';
 const raw={isError:true,structuredContent:{error_code:'RATE_LIMITED',error_data:{type:'http_error',code:429,response:{status:429,payload:JSON.stringify({error:{code:429,status:'RESOURCE_EXHAUSTED',message:msg,errors:[{domain:'global',reason:'rateLimitExceeded',message:msg}]}})}}}};
 journal.events.push({phase:'invoking',binding:'mcp__codex_apps__gmail_send_email',args:sendArgs,observed_at:at},{phase:'returned',binding:'mcp__codex_apps__gmail_send_email',raw,observed_at:at});
 const selected=clone(journal);
 const open=(value,local=true)=>{journal=clone(value);return F.exports.createConnectedFirstContact({...base,...(local?{storage}:{})});};
 const actual=open(selected).rateLimitContinuation();
 assert(actual.intent_ref_sha===expectedRef&&actual.rejected_invocations===1&&actual.intent_readback_event===1&&actual.recipient_readback_event===3,'Complete local pre-send provenance did not reopen');
 const waiting=await open(selected).resumeRateLimited();
 assert(waiting.status==='RATE_LIMIT_WAIT'&&waiting.retry_after===deadline&&forbidden===0,'Quota wait invoked another provider or state action');
 const pure=open(selected,false).rateLimitContinuation();
 assert(pure.proof_sha256===actual.proof_sha256&&pure.intent_ref_sha===actual.intent_ref_sha,'Original pure draft-revision validation cannot inspect local evidence');
 for(const change of [
  j=>{j.events[1].raw.content+=' ';},
  j=>{j.events[1].raw.receipt.sha256='0'.repeat(64);},
  j=>{j.events[3].raw.coordinator_id='22222222-2222-4333-8444-555555555555';j.events[3].raw.receipt.coordinator_id=j.events[3].raw.coordinator_id;},
  j=>{j.events[1].call_id='0'.repeat(64);}
 ]){const changed=clone(selected);change(changed);let rejected=false;try{open(changed).rateLimitContinuation();}catch{rejected=true;}assert(rejected,'Changed exact local provenance was accepted');}
 assert(forbidden===0,'External operation occurred');
 return {schema:'commons.connected-contact-factory-local-quota-checks/v1',checks:7,providerCalls:0,stateMutations:0,
  proof_sha256:actual.proof_sha256,proofs:['Original full factory accepts complete typed local pre-send intent and recipient receipts.','Same original definite Gmail rejection returns RATE_LIMIT_WAIT without provider/state calls.','Pure original input-revision validation reads the same local provenance.','Changed source bytes, receipt hash, coordinator or call identity are rejected.']};
}
module.exports={runContactFactoryLocalQuotaChecks};
