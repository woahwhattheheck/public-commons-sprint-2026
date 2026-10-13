'use strict';
async function runDraftIntakeChecks({files,loaderSource}){
 const assert=(ok,message)=>{if(!ok)throw Error(message)},clone=x=>JSON.parse(JSON.stringify(x));
 function cjs(source){const m={exports:{}};new Function('module','exports',source)(m,m.exports);return m.exports;}
 const carrier=cjs(files['host/connected_first_contact.cjs']),drafts=cjs(files['host/connected_first_contact_draft.cjs']);
 const names={hash:'host/connected_sha256.cjs',intent:'host/revenue_outbound_intent.cjs',gateway:'host/first_contact_gateway.cjs',mailboxAdmission:'host/connected_mailbox_admission.cjs',publicationPolicy:'commons-publication-policy.cjs',attachments:'host/connected_contact_attachments.cjs',deliveryCorrection:'host/contact_delivery_correction.cjs',content:'host/first_contact_content.cjs',deliveryNotices:'host/connected_delivery_notices.cjs'};
 const base=carrier.loadOriginalContactModules({...Object.fromEntries(Object.entries(names).map(([k,p])=>[k,files[p]])),deliveryNoticeSources:files});
 const modules={...base,mailboxes:[{name:'business',link_id:'source-one',id:'1001',email:'one@example.invalid'},{name:'secondary',link_id:'source-two',id:'1002',email:'two@example.invalid'}]};
 const factory={...carrier,createConnectedFirstContact:options=>drafts.createConnectedExistingFirstContactDraft({...options,createConnectedFirstContact:carrier.createConnectedFirstContact})};
 const input={prospect_org:'Synthetic draft source',opportunity_id:'source-only-draft-intake',touchpoint:'initial',link_id:'source-one',to:'receiver@example.invalid',subject:'Source-only existing draft',body:'Exact original plain body.',body_type:'text/plain',
  native_draft:{draft_id:'source-draft',message_id:'source-message',thread_id:'source-thread'},attachments:[],attachment_data:[]};
 input.native_arguments={link_id:input.link_id,to:input.to,from_address:'one@example.invalid',subject:input.subject,
  payload:{mime_type:'multipart/alternative',parts:[{mime_type:'text/plain',charset:'UTF-8',body:{content:input.body}},{mime_type:'text/html',charset:'UTF-8',body:{content:'<p>Exact original HTML body.</p>'}}]}};
 const calls=[],tools=new Proxy({}, {get(target,key){return async args=>{
  calls.push({key,args:clone(args)});
  if(key==='mcp__codex_apps__gmail_list_drafts')return {structuredContent:{drafts:[{draft_id:'source-draft',message_id:'source-message',thread_id:'source-thread',subject:input.subject,to:[input.to],cc:[],bcc:[],has_attachment:false}]}};
  if(key==='mcp__codex_apps__gmail_read_email'){
   assert(args.format==='full','Unexpected source format');
   return {structuredContent:{id:'source-message',thread_id:'source-thread',label_ids:['DRAFT'],payload:{...clone(input.native_arguments.payload),headers:[{name:'From',value:'one@example.invalid'},{name:'To',value:input.to},{name:'Subject',value:input.subject}]}}};
  }
  throw Error('Unexpected provider operation');
 }}});
 const start=loaderSource.indexOf(' async function receiveOriginalDraft('),end=loaderSource.indexOf(' async function readOriginal(operationKey)',start);
 assert(start>=0&&end>start,'Complete actual source entry required');
 const receive=new Function('factory','modules','tools','checkTools',loaderSource.slice(start,end)+'return receiveOriginalDraft;')(factory,modules,tools,()=>{});
 const memory=new Map(),raw=JSON.stringify(input,null,2)+'\n',stateKey='original-draft-journal',lease='original-draft-lease';
 const result=await receive({runtimeInputText:raw,stateKey,lease,load:k=>memory.get(k),store:(k,v)=>memory.set(k,v),githubActorAction:'github_get_profile',githubRefAction:'github_fetch_commit'});
 const journal=JSON.parse(result.journalText);
 assert(result.runtimeInputText===raw&&journal.events.length===5,'Exact source and actual five read events');
 assert(journal.events.at(-1).phase==='original-draft-received'&&journal.reviewed_native_draft.draft_id==='source-draft','Actual draft receipt retained');
 assert(calls.length===2&&calls.every(x=>['mcp__codex_apps__gmail_list_drafts','mcp__codex_apps__gmail_read_email'].includes(x.key)),'Only original native read bindings invoked');
 assert(!journal.events.some(e=>e.phase.includes('account'))&&!journal.receipt,'No account or send evidence invented');
 return {schema:'commons.original-draft-intake-source-checks/v1',checks:5,syntheticReadCalls:2,actualProviderCalls:0,accountOperations:0,sendOperations:0,events:journal.events.length};
}
module.exports={runDraftIntakeChecks};
