
async function runAdmissionLocalChecks(source,H) {
 const mod={exports:{}};new Function('module','exports',source)(mod,mod.exports);
 const A=mod.exports,hash=x=>H.sha256Utf8(typeof x==='string'?x:JSON.stringify(x)).sha256;
 const account={id:'123456',email:'source-check@example.invalid',link_id:'source-check-link'};
 const key=hash({provider:'gmail',profile_id:account.id,activity:'Mail sending'}),coordinatorId='11111111-2222-4333-8444-555555555555';
 const now=()=>new Date().toISOString(),clone=x=>JSON.parse(JSON.stringify(x)),assert=(ok,m)=>{if(!ok)throw Error(m);};
 const proofs=[],events=[],providerCalls=[];
 const base=()=>({schema:'commons.gmail-account-admission/v2',account_key:key,provider:'gmail',profile_id:account.id,activity:'Mail sending',revision:7,not_before:null,deadline_source:null,active:null,last_release:null,updated_at:now(),
  automation:{schema:'commons.gmail-manual-headroom/v1',policy:{...A.AUTOMATION_POLICY},activated_at:now(),
   sent:{observed_at:now(),start:new Date(Date.now()-86400001).toISOString(),end:now(),pages:1,ids_sha256:hash([]),messages:[]},
   attempts:[],last_dispatch_at:null}});
 function fixture(state=base()) {
  let calls=0,loseNext=false,conflictNext=false;
  const content=JSON.stringify(state,null,2)+'\n',origin={kind:'git-original-readback',repository:'woahwhattheheck/commons-ship-enforcer',path:'state/gmail-account.json',commit_sha:'a'.repeat(40),blob_sha:'b'.repeat(40),sha256:hash(content),observed_at:now(),receipt:{synthetic:true}};
  const make=(text,previous,id,action)=>{const revision=rows.length+1,sha256=hash(text);return {kind:'commons.connected-contact-local-snapshot/v1',coordinator_id:coordinatorId,namespace:'account',key,revision,sha256,content:text,receipt:{schema:'commons.connected-contact-local-receipt/v1',coordinator_id:coordinatorId,namespace:'account',key,revision,sha256,previous_sha256:previous,operation_id:id,action,created_at:now(),origin:clone(origin)}};};
  const rows=[],ops=new Map();rows.push(make(content,null,'synthetic-adoption','receive'));
  const storage={kind:'commons.connected-contact-local-state/v1',coordinatorId,
   verify:async()=>({kind:'commons.connected-contact-local-state/v1',coordinator_id:coordinatorId,authority:{scope_id:'source-only-shared-fleet',accounts:[{account_key:key,profile_id:account.id}]}}),
   read:async()=>clone(rows[rows.length-1]),
   history:async({after_revision,limit})=>{const r=rows.slice(after_revision,after_revision+limit);return {records:clone(r),next_revision:after_revision+r.length<rows.length?after_revision+r.length:null};},
   compareAndSwap:async args=>{calls++;const saved=ops.get(args.operation_id);if(saved){assert(saved.args===JSON.stringify(args),'idempotency body conflict');return clone(saved.result);}
    if(conflictNext){conflictNext=false;throw Object.assign(Error('synthetic contention'),{code:'LOCAL_STATE_CONFLICT',status:409});}
    if(args.expected_sha256!==rows.at(-1).sha256)throw Object.assign(Error('conflict'),{code:'LOCAL_STATE_CONFLICT',status:409});
    const r=make(args.content,args.expected_sha256,args.operation_id,'compareAndSwap');rows.push(r);ops.set(args.operation_id,{args:JSON.stringify(args),result:r});
    if(loseNext){loseNext=false;throw Object.assign(Error('synthetic lost return'),{code:'CONNECTION_ENDED'});}
    return clone(r);}};
  const journal=[];const opts={storage,account,sha256Utf8:H.sha256Utf8,classifyReturnedGmailRateLimit:()=>null,
   tools:{mcp__codex_apps__gmail_get_profile:async args=>{providerCalls.push({binding:'synthetic-profile',args});return {structuredContent:{id:account.id,email:account.email}};}},
   record:async e=>journal.push(clone(e)),history:()=>clone(journal)};
  return {storage,rows,journal,opts,handle:()=>A.createConnectedMailboxAdmission(opts),calls:()=>calls,lose:()=>loseNext=true,conflict:()=>conflictNext=true};
 }
 const f=fixture(),handle=f.handle();const initial=await handle.inspect();
 assert(initial.status==='READY'&&initial.state_sha===null&&initial.commit_sha===null,'local initial state/provenance');
 assert(initial.source_commit_sha==='a'.repeat(40)&&initial.storage_receipt.revision===1,'local receipt separate from origin');
 const op=hash('original-operation'),attempt=hash('original-attempt'),lease='source-only-lease';
 const got=await handle.acquire({operation_key:op,attempt_key:attempt,operation_lease:lease});
 assert(got.status==='ACQUIRED'&&got.revision===8&&got.storage_receipt.revision===2,'business/storage revisions independent');
 assert(got.accepted_write.schema==='commons.gmail-account-local-write/v1','typed local write');
 const historical=A.inspectConnectedMailboxHistory({...f.opts,events:f.journal,operation_key:op,attempt_key:attempt});
 assert(historical.lease.token===got.lease.token,'pure local journal lease recovery');
 const confirmed=await handle.confirm(got.lease,{dispatch:{envelope:{to:'recipient@example.invalid',cc:'',bcc:'',link_id:account.link_id,from_address:account.email},args:{source_only:true}}});
 assert(confirmed.status==='CONFIRMED','original debit confirmation retained');
 const check=await handle.confirm(got.lease,{verify_only:true,dispatch:{envelope:{to:'recipient@example.invalid',cc:'',bcc:'',link_id:account.link_id,from_address:account.email},args:{source_only:true}}});
 assert(check.status==='CONFIRMED','same charged token rechecked');
 const paid=JSON.parse(f.rows.at(-1).content).automation.attempts;
 assert(paid.length===1&&paid[0].token===got.lease.token,'one exact envelope charged');
 await handle.release(got.lease,{outcome:'SOURCE_CHECK_COMPLETE'});
 assert(JSON.parse(f.rows.at(-1).content).automation.attempts.length===1,'release retains debit');
 proofs.push('Original acquire/confirm/verify/release behavior with separate storage and business revisions; one envelope debit.');
 const u=fixture();u.lose();
 let lost=false;try{await u.handle().acquire({operation_key:op,attempt_key:attempt,operation_lease:lease});}catch(e){lost=e.code==='CONNECTION_ENDED';}
 assert(lost&&u.rows.length===2,'lost CAS occurred after one committed snapshot');
 const originalArgs=u.journal.find(e=>e.binding==='commons.local-state.compareAndSwap'&&e.phase==='invoking').args;
 await u.handle().inspect();
 assert(u.rows.length===2&&u.calls()===2,'uncertain exact CAS replay does not duplicate revision');
 const invoked=u.journal.filter(e=>e.binding==='commons.local-state.compareAndSwap'&&e.phase==='invoking');
 assert(JSON.stringify(invoked[0].args)===JSON.stringify(invoked[1].args),'replay exact timestamp/postimage/operation');
 const restored=A.inspectConnectedMailboxHistory({...u.opts,events:u.journal,operation_key:op,attempt_key:attempt});
 assert(restored.lease.token===JSON.parse(u.rows[1].content).active.token,'recovered original token');
 proofs.push('Lost post-commit return resumes exact original CAS and original token without a second revision.');
 const race=fixture(),h1=race.handle(),h2=race.handle();
 const r=await Promise.all([h1.acquire({operation_key:hash('a'),attempt_key:hash('aa'),operation_lease:'a'}),h2.acquire({operation_key:hash('b'),attempt_key:hash('bb'),operation_lease:'b'})]);
 assert(r.filter(x=>x.status==='ACQUIRED').length===1,'one fleet token under concurrent handles');
 assert(JSON.parse(race.rows.at(-1).content).active.token===r.find(x=>x.status==='ACQUIRED').lease.token,'loser preserves winner');
 proofs.push('Concurrent shared handles use CAS and retain one original active token.');
 const miss=fixture();miss.storage.read=async()=>null;let missing=false;try{await miss.handle().inspect();}catch(e){missing=e.code==='LOCAL_ACCOUNT_ADOPTION_REQUIRED';}
 assert(missing&&miss.calls()===0,'missing account is not initialized');
 const corrupt=fixture();corrupt.storage.read=async()=>({...clone(corrupt.rows[0]),content:corrupt.rows[0].content+' '});let bad=false;try{await corrupt.handle().inspect();}catch{bad=true;}assert(bad&&corrupt.calls()===0,'corrupt snapshot rejected');
 const wrong=fixture();wrong.storage.verify=async()=>({kind:wrong.storage.kind,coordinator_id:coordinatorId,authority:{scope_id:'wrong',accounts:[]}});let denied=false;try{await wrong.handle().inspect();}catch{denied=true;}assert(denied&&wrong.calls()===0,'wrong authority rejected');
 proofs.push('Missing adoption, corrupt bytes and wrong account authority fail without writes.');

 const qstate=base(),qnow=Date.now();qstate.active={token:hash('another-token'),operation_key:hash('another-operation'),attempt_key:hash('another-attempt'),send_binding:'mcp__codex_apps__gmail_send_email',acquired_at:new Date(qnow).toISOString(),expires_at:new Date(qnow+600000).toISOString()};
 const q=fixture(qstate),qh=q.handle();
 const waiting=await qh.acquire({operation_key:op,attempt_key:attempt,operation_lease:lease});
 assert(waiting.status==='SEND_ACTIVE'&&waiting.queue.request.operation_key===op,'original queue retained under active owner');
 const request=waiting.queue.request,sourceReceipt=waiting.storage_receipt;
 const recovery=await qh.receiveQueuedReturn({operation_key:op,operation_lease:lease,sequence:request.sequence,queued_at:request.queued_at,source_commit_sha:waiting.source_commit_sha,source_state_sha:waiting.source_state_sha,source_storage_receipt:sourceReceipt,recovery_sha256:hash('source-only-recovery')});
 assert(recovery.status==='QUEUED_RETURN_RECEIVED'&&recovery.recovery.source_storage_receipt.sha256===sourceReceipt.sha256,'exact local queued generation received');
 const qs=JSON.parse(q.rows.at(-1).content);
 assert(qs.active.token===qstate.active.token&&qs.admission_queue.waiting[0].sequence===request.sequence,'receiving preserves active owner and original queue order');
 proofs.push('Local queued-return receiving binds the original storage receipt and keeps the active owner, queue generation and Git origin unchanged.');

 const stale=fixture(),sh=stale.handle();await sh.acquire({operation_key:op,attempt_key:attempt,operation_lease:lease});
 stale.storage.read=async()=>clone(stale.rows[0]);
 const staleDecision=await sh.inspect();
 assert(staleDecision.status==='ACCOUNT_STATE_READBACK_PENDING','rollback head cannot erase observed local CAS');
 const paged=fixture();
 for(let index=0;index<101;index++){
  const prior=paged.rows.at(-1),state=JSON.parse(prior.content);state.revision++;
  const content=JSON.stringify(state,null,2)+'\n',args={namespace:'account',key,expected_sha256:prior.sha256,content};
  args.operation_id=hash({kind:paged.storage.kind,coordinator_id:coordinatorId,namespace:'account',key,expected_sha256:args.expected_sha256,content_sha256:hash(content)});
  await paged.storage.compareAndSwap(args);
 }
 const pageResult=await paged.handle().inspect();
 assert(pageResult.revision===108&&pageResult.storage_receipt.revision===102,'complete history spans multiple exact pages');
 const ranges=paged.journal.filter(e=>e.phase==='local-account-history-received');
 assert(ranges.length===1&&ranges[0].receiving.count===102,'one receiving range replaces global full-history duplication');
 assert(!paged.journal.some(e=>e.phase==='local-account-state-observed'),'new receiving does not journal every global state');
 assert(ranges[0].receiving.snapshot.revision===102,'receiving range retains exact final complete floor');
 let historyReads=0;const originalHistory=paged.storage.history;paged.storage.history=async args=>{historyReads++;return originalHistory(args);};
 const reopenedPage=await paged.handle().inspect();
 assert(reopenedPage.revision===108&&historyReads===0,'durable verified floor reopens without replaying complete history');
 const prior=paged.rows.at(-1),following=JSON.parse(prior.content);following.revision++;
 const followingArgs={namespace:'account',key,expected_sha256:prior.sha256,content:JSON.stringify(following,null,2)+'\n'};
 followingArgs.operation_id=hash({kind:paged.storage.kind,coordinator_id:coordinatorId,namespace:'account',key,expected_sha256:followingArgs.expected_sha256,content_sha256:hash(followingArgs.content)});
 await paged.storage.compareAndSwap(followingArgs);
 const latestPage=await paged.handle().inspect();
 assert(latestPage.revision===109&&historyReads===1,'restart receives only the following exact revision');
 assert(paged.journal.filter(e=>e.phase==='local-account-history-received').at(-1).receiving.count===1,'following range retains predecessor floor');
 proofs.push('Observed local floors reject stale heads; 102 full revisions are validated across pages, one final floor is retained, restart reads no old history and then only the new revision.');
 const historicalOptions={...f.opts};delete historicalOptions.storage;
 let privateCalls=0;for(const name of ['github_get_repo','github_fetch','github_fetch_file'])historicalOptions.tools['mcp__codex_apps__'+name]=async()=>{privateCalls++;throw Error('unexpected read');};
 const readOnly=A.createConnectedMailboxAdmission(historicalOptions);
 let writeDenied=false;try{await readOnly.withdraw({operation_key:op});}catch(e){writeDenied=e.code==='LOCAL_ACCOUNT_STORAGE_REQUIRED';}
 assert(writeDenied&&privateCalls===0,'legacy private mutation forbidden before dispatch');
 proofs.push('Legacy mutation entry refuses private Git writes without provider dispatch; historical journal inspection remains available.');
 const legacy=A.inspectConnectedMailboxHistory({account,events:[],sha256Utf8:H.sha256Utf8,classifyReturnedGmailRateLimit:()=>null});
 assert(legacy.status==='ACCOUNT_HISTORY_INSPECTED'&&legacy.writes.length===0,'legacy pure history works');
 assert(!providerCalls.some(x=>x.binding.includes('send')),'no provider send');
 return {schema:'commons.mailbox-local-source-checks/v1',sourceOnly:true,realProviderCalls:0,realStateMutations:0,proofs,syntheticProfileObservations:providerCalls.length,checksAt:now()};
}

module.exports={runAdmissionLocalChecks};
