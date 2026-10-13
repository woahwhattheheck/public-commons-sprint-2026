
async function runContactCheckpointLocalChecks(files) {
 const assert=(ok,m)=>{if(!ok)throw Error(m);},clone=x=>JSON.parse(JSON.stringify(x));
 const F={exports:{}},C={exports:{}};
 new Function('module','exports',files['host/connected_first_contact.cjs'])(F,F.exports);
 new Function('module','exports',files['host/connected_first_contact_checkpoint.cjs'])(C,C.exports);
 const keys={hash:'host/connected_sha256.cjs',intent:'host/revenue_outbound_intent.cjs',gateway:'host/first_contact_gateway.cjs',mailboxAdmission:'host/connected_mailbox_admission.cjs',publicationPolicy:'commons-publication-policy.cjs',attachments:'host/connected_contact_attachments.cjs',deliveryCorrection:'host/contact_delivery_correction.cjs',content:'host/first_contact_content.cjs',deliveryNotices:'host/connected_delivery_notices.cjs'};
 const baseModules=F.exports.loadOriginalContactModules({...Object.fromEntries(Object.entries(keys).map(([k,p])=>[k,files[p]])),deliveryNoticeSources:files});
 const modules={...baseModules,mailboxes:[{name:'business',link_id:'synthetic-one',id:'1001',email:'one@example.invalid'},{name:'secondary',link_id:'synthetic-two',id:'1002',email:'two@example.invalid'}]};
 const hash=x=>modules.sha256Utf8(typeof x==='string'?x:JSON.stringify(x)).sha256,now=()=>new Date().toISOString();
 const tools={},providerCalls=[];
 for(const name of ['github_get_profile','github_fetch','github_fetch_file','github_fetch_blob','gmail_get_profile','gmail_search_email_ids','gmail_send_email','gmail_read_email'])
  tools['mcp__codex_apps__'+name]=async args=>{providerCalls.push({name,args});throw Error('No provider call is authorized in this source fixture');};
 const input={prospect_org:'Synthetic Review',opportunity_id:'synthetic-preserved-case',touchpoint:'initial',link_id:'synthetic-one',to:'receiver@example.invalid',subject:'Source continuity',body:'Synthetic original review only.'};
 const lease='synthetic-original-lease',stateKey='synthetic-private-journal',memory=new Map();
 const plain=F.exports.createConnectedFirstContact({tools,input,modules,load:k=>memory.get(k),store:(k,v)=>memory.set(k,v),lease,stateKey});
 const plan=plain.plan(),operationKey=hash({input_sha256:plan.input_sha256,lease});
 const origin={kind:'git-original-checkpoint-readback',repository:'historical/example',path:'state/contact-checkpoint.json',commit_sha:'a'.repeat(40),blob_sha:'b'.repeat(40),sha256:null,observed_at:now(),receipt:{synthetic:true}};
 const coordinatorId='11111111-2222-4333-8444-555555555555',rows=new Map(),ops=new Map(),calls=[];
 let loseNext=false;
 function put(namespace,key,content,previous,id,action){
  const k=namespace+':'+key,revision=(rows.get(k)?.revision||0)+1,sha256=hash(content);
  const row={kind:'commons.connected-contact-local-snapshot/v1',coordinator_id:coordinatorId,namespace,key,revision,sha256,content,
   receipt:{schema:'commons.connected-contact-local-receipt/v1',coordinator_id:coordinatorId,namespace,key,revision,sha256,bytes:modules.sha256Utf8(content).bytes,previous_sha256:previous,operation_id:id,action,created_at:now(),origin}};
  rows.set(k,row);return clone(row);
 }
 const storage={kind:'commons.connected-contact-local-state/v1',coordinatorId,
  verify:async()=>({kind:'commons.connected-contact-local-state/v1',coordinator_id:coordinatorId,authority:{scope_id:'synthetic-fleet',accounts:[]}}),
  read:async({namespace,key})=>clone(rows.get(namespace+':'+key)||null),
  receive:async()=>{throw Error('No adoption performed by this fixture');},
  compareAndSwap:async request=>{
   calls.push(clone(request));const prior=ops.get(request.operation_id);
   if(prior){assert(JSON.stringify(prior.request)===JSON.stringify(request),'Changed exact replay');return clone(prior.result);}
   const old=rows.get(request.namespace+':'+request.key);
   if((old?.sha256||null)!==request.expected_sha256)throw Object.assign(Error('synthetic conflict'),{code:'LOCAL_STATE_CONFLICT',status:409});
   const result=put(request.namespace,request.key,request.content,request.expected_sha256,request.operation_id,'compareAndSwap');
   ops.set(request.operation_id,{request:clone(request),result});
   if(loseNext){loseNext=false;throw Object.assign(Error('synthetic lost return'),{status:503,code:'LOCAL_STATE_OUTCOME_UNKNOWN'});}
   return result;
  }};
 function seed(journal,transports){
  const payload={schema:'commons.connected-contact-checkpoint-payload/v1',runtime_input:input,journal,transports};
  const payload_text=JSON.stringify(payload),metadata={schema:'commons.connected-contact-checkpoint/v1',operation_key:operationKey,input_sha256:plan.input_sha256,operation_lease:lease,state_key:stateKey,revision:1,updated_at:now(),active:null,payload:{...modules.sha256Utf8(payload_text),chunks:[{blob_sha:'c'.repeat(40),...modules.sha256Utf8(payload_text)}]}};
  const content=JSON.stringify({metadata,payload_text,original_location:{repository:'historical/example',branch:'contact-checkpoint/v1/'+operationKey,path:'state/contact-checkpoint.json',commit:'a'.repeat(40),blob_sha:'b'.repeat(40)}});
  put('checkpoint',operationKey,content,null,'synthetic-original-adoption','receive');
 }
 seed(clone(memory.get(stateKey)),[]);
 const options={tools,factory:F.exports,modules,input,lease,stateKey,owner:'synthetic-review',storage};
 let handle=await C.exports.openConnectedContactCheckpoint(options);
 assert(JSON.stringify(await handle.plan())===JSON.stringify(plan),'Plan changed on local checkpoint reopening');
 assert(handle.location().kind==='commons.connected-contact-local-checkpoint/v1'&&!('commit' in handle.location()),'Local identity mislabeled');
 await handle.close();
 const original=await C.exports.readConnectedContactCheckpoint({storage,operationKey,sha256Utf8:modules.sha256Utf8});
 assert(original.payload.journal.input_sha256===plan.input_sha256,'Complete original input changed');
 handle=await C.exports.openConnectedContactCheckpoint(options);
 loseNext=true;let interrupted=false;
 try{const saved=await storage.read({namespace:'checkpoint',key:operationKey});const body=JSON.parse(saved.content);body.metadata.active={owner:'synthetic-review',token:'f'.repeat(64),acquired_at:new Date(Date.now()-700000).toISOString(),expires_at:new Date(Date.now()-100000).toISOString()};rows.set('checkpoint:'+operationKey,{...saved,content:JSON.stringify(body),sha256:hash(JSON.stringify(body)),receipt:{...saved.receipt,sha256:hash(JSON.stringify(body))}});handle=await C.exports.openConnectedContactCheckpoint(options);await handle.checkpoint();}catch(error){interrupted=error.code==='LOCAL_STATE_OUTCOME_UNKNOWN';}
 assert(interrupted,'Lost pointer return did not remain uncertain');
 const pending=handle.snapshot().pending_pointer;assert(pending?.request,'Original pointer request lost');
 await handle.checkpoint();
 assert(calls.filter(x=>x.operation_id===pending.request.operation_id).every(x=>JSON.stringify(x)===JSON.stringify(pending.request)),'Pointer replay changed exact bytes');
 await handle.close();
 // A process can end after a local state commit and before the checkpoint has its return.
 const journal=clone(memory.get(stateKey)),request={namespace:'journal',key:'synthetic-retained-state',expected_sha256:null,operation_id:'synthetic-fixed-cas',content:JSON.stringify({original:true})};
 const accepted=await storage.compareAndSwap(request),binding='commons.local-state.compareAndSwap',call_id=hash({original:'nested-operation'});
 const event={phase:'invoking',binding,args:request,call_id,observed_at:now()};
 journal.events.push({phase:'account-admission',event,observed_at:event.observed_at});
 const index=journal.events.length-1,transport={id:hash({operationKey,index,binding,args:request}),event_index:index,nested:true,binding,args_sha256:hash(JSON.stringify(request)),state:'INVOKING'};
 seed(journal,[transport]);
 handle=await C.exports.openConnectedContactCheckpoint(options);
 await handle.plan();
 const snapshot=handle.snapshot(),returned=snapshot.journal.events.find(x=>x.phase==='account-admission'&&x.event?.phase==='returned'&&x.event.call_id===call_id);
 assert(returned&&JSON.stringify(returned.event.raw)===JSON.stringify(accepted),'Exact nested return was not reconstructed');
 assert(snapshot.transports[0].state==='RETURNED','Original transport did not settle');
 await handle.close();
 const closed=await C.exports.readConnectedContactCheckpoint({storage,operationKey,sha256Utf8:modules.sha256Utf8});
 assert(closed.metadata.active===null&&closed.payload.transports[0].state==='RETURNED','Cold read did not retain settled operation');
 assert(providerCalls.length===0,'Source receiving invoked a real/provider-facing operation');
 return {schema:'commons.connected-contact-local-source-checks/v1',checks:7,realProviderCalls:0,realStateMutations:0,
  proofs:['Exact original plan/private mailbox identity survives local open, close and cold read.','Lost checkpoint CAS return replays only the exact original request.','Cold reopened original nested local CAS is received into its same account journal and transport.','Typed local checkpoint provenance never fabricates Git identities.']};
}

module.exports={runContactCheckpointLocalChecks};
