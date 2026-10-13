
async function runOriginalSessionChecks(files){
 const assert=(ok,message)=>{if(!ok)throw Error(message)},clone=x=>JSON.parse(JSON.stringify(x));
 const F={exports:{}},C={exports:{}};
 new Function('module','exports',files['host/connected_first_contact.cjs'])(F,F.exports);
 new Function('module','exports',files['host/connected_first_contact_checkpoint.cjs'])(C,C.exports);
 const keys={hash:'host/connected_sha256.cjs',intent:'host/revenue_outbound_intent.cjs',gateway:'host/first_contact_gateway.cjs',mailboxAdmission:'host/connected_mailbox_admission.cjs',publicationPolicy:'commons-publication-policy.cjs',attachments:'host/connected_contact_attachments.cjs',deliveryCorrection:'host/contact_delivery_correction.cjs',content:'host/first_contact_content.cjs',deliveryNotices:'host/connected_delivery_notices.cjs'};
 const original=F.exports.loadOriginalContactModules({...Object.fromEntries(Object.entries(keys).map(([k,p])=>[k,files[p]])),deliveryNoticeSources:files});
 const modules={...original,mailboxes:[{name:'business',link_id:'synthetic-one',id:'1001',email:'one@example.invalid'},{name:'secondary',link_id:'synthetic-two',id:'1002',email:'two@example.invalid'}]};
 let providerCalls=0;const tools={};
 for(const name of ['github_get_profile','github_fetch','github_fetch_file','github_fetch_blob','gmail_get_profile','gmail_search_email_ids','gmail_send_email','gmail_read_email'])
 tools['mcp__codex_apps__'+name]=async()=>{providerCalls++;throw Error('Unexpected provider call')};
 const input={prospect_org:'Synthetic Journal',opportunity_id:'synthetic-session-case',touchpoint:'initial',link_id:'synthetic-one',to:'receiver@example.invalid',subject:'Original session custody',body:'Original complete session source fixture.'};
 const lease='synthetic-session-original',stateKey='synthetic-session-private-journal',memory=new Map();
 const factory=F.exports.createConnectedFirstContact({tools,input,modules,load:k=>memory.get(k),store:(k,v)=>memory.set(k,v),lease,stateKey});
 const plan=factory.plan(),journal=clone(memory.get(stateKey));
 const args={tools,factory:F.exports,modules,runtimeInputText:JSON.stringify(input,null,2)+'\n',journalText:JSON.stringify(journal,null,2)+'\n',stateKey,lease,source:{reference:'synthetic-retained-session/v1',custodian:'synthetic-original-owner',observed_at:'2026-10-13T13:00:00.000Z'},observedAt:'2026-10-13T13:01:00.000Z'};
 const entry=await C.exports.prepareConnectedContactJournalAdoption(args);
 const entry2=await C.exports.prepareConnectedContactJournalAdoption(args);
 assert(JSON.stringify(entry)===JSON.stringify(entry2),'Frozen original source preparation changed');
 const body=JSON.parse(entry.content),payload=JSON.parse(body.payload_text),H=modules.sha256Utf8;
 assert(JSON.stringify(payload.journal)===JSON.stringify(journal)&&JSON.stringify(payload.runtime_input)===JSON.stringify(input),'Full original session lost');
 assert(entry.origin.journal_content===args.journalText&&entry.origin.runtime_input_content===args.runtimeInputText,'Original raw UTF8 source lost');
 assert(entry.origin.kind==='original-session-journal-readback'&&!('commit_sha' in entry.origin),'Session source mislabeled Git');
 const coordinatorId='11111111-2222-4333-8444-555555555555';
 const row={kind:'commons.connected-contact-local-snapshot/v1',coordinator_id:coordinatorId,namespace:'checkpoint',key:entry.key,revision:1,content:entry.content,sha256:H(entry.content).sha256,
 receipt:{schema:'commons.connected-contact-local-receipt/v1',coordinator_id:coordinatorId,namespace:'checkpoint',key:entry.key,revision:1,sha256:H(entry.content).sha256,bytes:H(entry.content).bytes,previous_sha256:null,operation_id:'synthetic-session-receiving',action:'receive',created_at:args.observedAt,origin:entry.origin}};
 let reads=0,writes=0;
 const storage={kind:'commons.connected-contact-local-state/v1',coordinatorId,verify:async()=>({kind:'commons.connected-contact-local-state/v1',coordinator_id:coordinatorId}),read:async()=>{reads++;return clone(row)},compareAndSwap:async()=>{writes++;throw Error('No write permitted')},history:async()=>{throw Error('No fabricated history')}};
 const read=await C.exports.readConnectedContactCheckpoint({storage,operationKey:entry.key,sha256Utf8:H});
 const reopened=await C.exports.openConnectedContactCheckpoint({tools,factory:F.exports,modules,input,lease,stateKey,owner:'synthetic-source-review',storage});
 assert(JSON.stringify(reopened.snapshot().journal)===JSON.stringify(journal),'Cold reopening changed full journal');
 assert(read.location.kind==='commons.connected-contact-local-checkpoint/v1'&&read.payload.journal.input_sha256===plan.input_sha256,'Cold source identity changed');
 let refused=0;for(const changed of [{lease:'different'},{journalText:JSON.stringify({...journal,input_sha256:'f'.repeat(64)})},{runtimeInputText:JSON.stringify({...input,body:'different'})}]){
 try{await C.exports.prepareConnectedContactJournalAdoption({...args,...changed})}catch{refused++}
 }
 assert(refused===3&&providerCalls===0&&writes===0,'Original mismatch/no-action checks failed');
 return {schema:'commons.original-session-journal-source-checks/v1',checks:8,providerCalls,writes,reads,entry,proofs:['Full raw source preserved under typed non-Git origin.','Exact frozen preparation and original operation key retained.','Original complete journal cold reopens without methods/provider/storage mutation.','Input/lease/journal mismatch refused.']};
}
module.exports={runOriginalSessionChecks};
