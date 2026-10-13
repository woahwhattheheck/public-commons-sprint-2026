'use strict';
async function runSessionAdoptionChecks({files,adoption}){
 const assert=(ok,message)=>{if(!ok)throw Error(message)},clone=x=>JSON.parse(JSON.stringify(x));
 function cjs(body){const m={exports:{}};new Function('module','exports',body)(m,m.exports);return m.exports;}
 const carrier=cjs(files['host/connected_first_contact.cjs']),drafts=cjs(files['host/connected_first_contact_draft.cjs']);
 const checkpoint=cjs(files['host/connected_first_contact_checkpoint.cjs']);
 const factory={...carrier,createConnectedFirstContact:options=>options.input.native_draft!==undefined
  ?drafts.createConnectedExistingFirstContactDraft({...options,createConnectedFirstContact:carrier.createConnectedFirstContact})
  :carrier.createConnectedFirstContact(options)};
 const names={hash:'host/connected_sha256.cjs',intent:'host/revenue_outbound_intent.cjs',gateway:'host/first_contact_gateway.cjs',mailboxAdmission:'host/connected_mailbox_admission.cjs',publicationPolicy:'commons-publication-policy.cjs',attachments:'host/connected_contact_attachments.cjs',deliveryCorrection:'host/contact_delivery_correction.cjs',content:'host/first_contact_content.cjs',deliveryNotices:'host/connected_delivery_notices.cjs'};
 const base=carrier.loadOriginalContactModules({...Object.fromEntries(Object.entries(names).map(([k,p])=>[k,files[p]])),deliveryNoticeSources:files});
 const mailboxes=[{name:'business',link_id:'source-one',id:'1001',email:'one@example.invalid'},{name:'secondary',link_id:'source-two',id:'1002',email:'two@example.invalid'}];
 const modules={...base,mailboxes,admission:base.mailboxAdmission,checkpoint},H=modules.sha256Utf8;
 const hash=x=>H(typeof x==='string'?x:JSON.stringify(x)).sha256,at='2026-10-13T13:00:00.000Z';
 let providerCalls=0,receives=0,verifies=0;
 const tools=new Proxy({}, {get(){return async()=>{providerCalls++;throw Error('No provider call permitted');}}});
 function original(kind){
  const body='Complete original source-only body.',input={prospect_org:'Synthetic source intake',opportunity_id:'synthetic-'+kind,touchpoint:'initial',link_id:'source-one',to:'receiver@example.invalid',subject:'Original '+kind,body};
  if(kind==='draft')Object.assign(input,{body_type:'text/plain',attachments:[],attachment_data:[],
   native_draft:{draft_id:'original-draft',message_id:'original-message',thread_id:'original-thread'},
   native_arguments:{link_id:'source-one',from_address:'one@example.invalid',to:input.to,subject:input.subject,
    payload:{mime_type:'multipart/alternative',parts:[{mime_type:'text/plain',charset:'UTF-8',body:{content:body}},{mime_type:'text/html',charset:'UTF-8',body:{content:'<p>'+body+'</p>'}}]}}});
  const lease='original-'+kind,stateKey='original-state-'+kind,memory=new Map();
  const contact=factory.createConnectedFirstContact({tools,modules,input,lease,stateKey,
   load:k=>memory.get(k),store:(k,v)=>memory.set(k,v),githubActorAction:'github_get_profile',githubRefAction:'github_fetch_commit'});
  const plan=contact.plan(),journal=memory.get(stateKey);
  return {runtimeInputText:JSON.stringify(input,null,2)+'\n',journalText:JSON.stringify(journal,null,2)+'\n',
   stateKey,lease,operationKey:hash({input_sha256:plan.input_sha256,lease}),
   source:{reference:'source-only-original/'+kind,custodian:'synthetic-original-owner',observed_at:at}};
 }
 const originals=[original('ordinary'),original('draft')],coordinatorId='11111111-2222-4333-8444-555555555555';
 const authority={scope_id:'source-only-existing-fleet',accounts:[{profile_id:'1001',account_key:hash({provider:'gmail',profile_id:'1001',activity:'Mail sending'})}]};
 let accepted=null,lost=true;
 const storage={kind:'commons.connected-contact-local-state/v1',coordinatorId,
  verify:async()=>{verifies++;return{kind:'commons.connected-contact-local-state/v1',coordinator_id:coordinatorId,authority:clone(authority)}},
  receiveBatch:async request=>{
   receives++;if(accepted){assert(JSON.stringify(request)===accepted.request,'Replay changed');return clone(accepted.raw);}
   const raw={status:'ORIGINAL_STATE_RECEIVED',coordinator_id:coordinatorId,operation_id:request.operation_id,
    records:request.entries.map((entry,index)=>({kind:'commons.connected-contact-local-snapshot/v1',coordinator_id:coordinatorId,
     namespace:entry.namespace,key:entry.key,revision:1,sha256:hash(entry.content),content:entry.content,
     receipt:{schema:'commons.connected-contact-local-receipt/v1',coordinator_id:coordinatorId,
      namespace:entry.namespace,key:entry.key,revision:1,...H(entry.content),previous_sha256:null,
      operation_id:request.operation_id+':'+index,action:'receive',created_at:at,origin:clone(entry.origin)}}))};
   accepted={request:JSON.stringify(request),raw};
   if(lost){lost=false;throw Object.assign(Error('Synthetic lost response'),{code:'CONNECTION_ENDED'});}
   return clone(raw);
  }};
 const events=[],record=async event=>events.push(clone(event));
 const options={tools,storage,factory,modules,sha256Utf8:H,classifyReturnedGmailRateLimit:carrier.classifyReturnedGmailRateLimit,
  classifyReturnedSendRateLimit:carrier.classifyReturnedSendRateLimit,operationId:'synthetic-company-session-batch',
  accounts:[],contacts:[],checkpoints:[],originalJournals:originals,observedAt:at,
  githubActorAction:'github_get_profile',githubRefAction:'github_fetch_commit',
  ownerHandoff:{controllers_quiesced:true,recorded_at:at,recorded_by:'synthetic-original-owner',reference:'source-only-selected-writers'},record};
 const prepared=await adoption.prepareConnectedContactAdoption(options);
 assert(prepared.request.entries.length===2&&prepared.source_observations.length===0&&providerCalls===0&&receives===0,'Pure complete preparation');
 for(let i=0;i<2;i++){
  const entry=prepared.request.entries[i],original=originals[i],payload=JSON.parse(JSON.parse(entry.content).payload_text);
  assert(entry.namespace==='checkpoint'&&entry.key===original.operationKey&&entry.expected_sha256===null,'Original checkpoint key');
  assert(entry.origin.kind==='original-session-journal-readback'&&!('commit_sha' in entry.origin),'No invented Git origin');
  assert(entry.origin.runtime_input_content===original.runtimeInputText&&entry.origin.journal_content===original.journalText,'Raw source text preserved');
  assert(JSON.stringify(payload.journal)===JSON.stringify(JSON.parse(original.journalText))&&payload.transports.length===0,'Full source journal preserved');
 }
 assert(!prepared.request.entries.some(x=>x.namespace==='account')&&JSON.stringify(prepared.coordinator.authority)===JSON.stringify(authority),'Existing account authority preserved');
 let lostCaught=false;try{await adoption.receivePreparedConnectedContactAdoption({storage,prepared,record})}catch(error){lostCaught=error.code==='CONNECTION_ENDED'}
 assert(lostCaught&&accepted,'Synthetic commit then lost return');
 const result=await adoption.receivePreparedConnectedContactAdoption({storage,prepared,record});
 assert(result.status==='ORIGINAL_STATE_RECEIVED'&&receives===2,'Original exact batch replay');
 let rejects=0;
 for(const changed of [{originalJournals:[originals[0],originals[0]]},{originalJournals:[{...originals[0],lease:'changed-lease'}]},{originalJournals:[{...originals[0],operationKey:'f'.repeat(64)}]}]){
  try{await adoption.prepareConnectedContactAdoption({...options,...changed})}catch{rejects++}
 }
 const tampered=clone(prepared);tampered.request.entries[0].origin.journal_content+=' ';
 try{await adoption.receivePreparedConnectedContactAdoption({storage,prepared:tampered,record})}catch{rejects++}
 assert(rejects===4&&receives===2&&providerCalls===0,'Changed source rejected before mutation');
 return {schema:'commons.connected-contact-session-batch-source-checks/v1',checks:10,
  providerCalls,actualCoordinatorWrites:0,syntheticReceives:receives,
  proofs:['Ordinary and native-draft complete original journals share one truthful create-only company batch.',
   'Full raw inputs and journals, operation keys and original factory validation are preserved.',
   'No Git source read or shared-account adoption occurs for session-only receiving.',
   'Same exact frozen request recovers a lost batch result; duplicate or changed original identities reject.']};
}
module.exports={runSessionAdoptionChecks};
