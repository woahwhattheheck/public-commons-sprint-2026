'use strict';
// One original checkpoint continuation. The maintained factory/coordinator owns
// correspondence, reservations, account usage, rate limits and send uncertainty.
const crypto=require('node:crypto');
const {canonical,validateContinuation,RELATIONSHIP_BINDING}=require('./connected_contact_operator_bridge.cjs');
const SCHEMA='commons.connected-contact-continuation-result/v1';
const sha=value=>crypto.createHash('sha256').update(value,'utf8').digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
function need(ok,message){if(!ok)throw Object.assign(Error(message),{code:'CONTACT_CONTINUATION_SELECTION'});}
function errorRecord(error){
 const out={name:String(error?.name||'Error'),message:String(error?.message||error)};
 for(const key of Object.getOwnPropertyNames(error&&typeof error==='object'?error:{})){
  if(['__proto__','constructor','prototype'].includes(key))continue;
  try{const value=error[key];if(value!==undefined&&typeof value!=='function')out[key]=clone(value);}catch{}
 }return out;
}
function originalNativeArguments(input,product,configuration){
 const sender=configuration.mailboxes.find(m=>m.link_id===input.link_id);
 need(sender,'The original selected sender is not configured.');
 if(input.native_draft)return {link_id:sender.link_id,draft_id:input.native_draft.draft_id};
 const {gateway,attachments}=product.modules;
 const native=gateway.originalNativeFirstContactArguments(input,sender,attachments);
 if(native)return native;
 const text={mime_type:'text/html',charset:'UTF-8',body:{content:gateway.renderFirstContactTextHtml(input.body)}};
 return {link_id:sender.link_id,from_address:sender.email,
  to:gateway.recipientClaimPath(input.to).recipient,subject:input.subject,
  payload:input.attachments?.length?attachments.payload(attachments.prepare(input),text):text};
}

async function prepareOriginalContinuation({product,configuration,operationKey,operationId,owner,organization,method='accountStatus',messageId}){
 need(typeof operationId==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/.test(operationId),'Retain an explicit original foreground operation identity.');
 await product.storage.verify();
 const received=await product.readOriginal(operationKey),m=received.metadata,input=received.payload.runtime_input;
 let args=[];
 if(['reconcile','receiveSent','receiveCompletedDraft','receiveDeliveryNotice'].includes(method))args=[messageId];
 else if(method==='resumeConsole')args=[received.payload.journal.console_handoff];
 const selected={schema:'commons.connected-contact-continuation/v1',operation_id:operationId,
  operation_key:m.operation_key,input_sha256:m.input_sha256,operation_lease:m.operation_lease,state_key:m.state_key,
  owner,coordinator_id:configuration.coordinatorId,authority:clone(configuration.authority),
  mailboxes:clone(configuration.mailboxes),runtime_input:clone(input),organization:clone(organization),
  continuation:{method,args},native_binding:input.native_draft?'mcp__codex_apps__gmail_send_draft':'mcp__codex_apps__gmail_send_email',
  native_arguments:originalNativeArguments(input,product,configuration)};
 validateContinuation(selected,{operation_id:operationId,policy:{gmail_link_ids:configuration.mailboxes.map(m=>m.link_id)}});
 return selected;
}

async function continueOriginalContact({product,configuration,tools,selected,record,readResult,saveResult}){
 for(const fn of [record,readResult,saveResult])need(typeof fn==='function','Use the original complete private journal and result receiver.');
 validateContinuation(selected,{operation_id:selected.operation_id,policy:{gmail_link_ids:configuration.mailboxes.map(x=>x.link_id)}});
 need(configuration.coordinatorId===selected.coordinator_id&&canonical(configuration.authority)===canonical(selected.authority)&&canonical(configuration.mailboxes)===canonical(selected.mailboxes),'The original deployed coordinator, authority or mailbox identities changed.');
 const selection_sha256=sha(canonical(selected));
 const previous=await readResult();
 if(previous!==null){
  need(previous.schema===SCHEMA&&previous.selection_sha256===selection_sha256&&previous.operation_key===selected.operation_key,'The retained completed continuation names a different original selection.');
  return previous;
 }
 await product.storage.verify();
 const received=await product.readOriginal(selected.operation_key),m=received.metadata;
 need(m.operation_key===selected.operation_key&&m.input_sha256===selected.input_sha256&&m.operation_lease===selected.operation_lease&&m.state_key===selected.state_key,'The original checkpoint identity changed.');
 need(canonical(received.payload.runtime_input)===canonical(selected.runtime_input),'The complete original message input differs from the selected file.');
 need(canonical(originalNativeArguments(selected.runtime_input,product,configuration))===canonical(selected.native_arguments),'Selected native MIME or draft differs from the maintained original renderer.');
 const method=selected.continuation.method,args=clone(selected.continuation.args);
 if(method==='resumeConsole')need(canonical(args[0])===canonical(received.payload.journal.console_handoff),'Retain the original saved console handoff.');
 need(typeof tools[RELATIONSHIP_BINDING]==='function','Supply the existing foreground original relationship review.');
 const event=(phase,details)=>record({schema:'commons.connected-contact-continuation-event/v1',operation_id:selected.operation_id,
  operation_key:selected.operation_key,selection_sha256,phase,observed_at:new Date().toISOString(),...details});
 await event('selected',{selection:clone(selected),location:received.location,metadata:m});
 let original=null,result=null,error=null,close_error=null,snapshot=null,location=null;
 try{
  original=await product.openOriginal(selected.operation_key,{
   owner:selected.owner,organizationQuery:selected.organization.query,organizationDomains:selected.organization.domains,
   githubActorAction:'github_get_user_login',githubRefAction:'github_fetch',
   beforeSend:async spec=>{
    const decision=await tools[RELATIONSHIP_BINDING]({operation_key:selected.operation_key,input_sha256:selected.input_sha256,spec});
    need(decision&&typeof decision.can_contact==='boolean','Keep the actual current owner relationship decision.');
    await event('relationship',{spec,decision});return decision;
   },
   beforeNativeSend:async native=>{
    need(canonical(native)===canonical(selected.native_arguments),'Original exact message or attachments changed before native send.');
    await event('native-envelope',{binding:selected.native_binding,args:native,args_sha256:sha(JSON.stringify(native))});
    return {can_send:true,selection_sha256,native_arguments_sha256:sha(JSON.stringify(native))};
   }
  });
  location=original.location();
  need(location.operation_key===selected.operation_key,'The opened checkpoint names another original operation.');
  need(typeof original[method]==='function','The selected maintained checkpoint method is unavailable.');
  result=await original[method](...args);
 }catch(caught){error=errorRecord(caught);}
 finally{
  if(original){
   try{snapshot=clone(original.snapshot());location=clone(original.location());await event('before-close',{result,error,location,snapshot});}
   catch(caught){error=error||errorRecord(caught);}
   try{await original.close();}catch(caught){close_error=errorRecord(caught);}
   try{snapshot=clone(original.snapshot());location=clone(original.location());}
   catch(caught){error=error||errorRecord(caught);}
  }
 }
 const output={schema:SCHEMA,operation_id:selected.operation_id,operation_key:selected.operation_key,
  input_sha256:selected.input_sha256,operation_lease:selected.operation_lease,selection_sha256,
  coordinator_id:selected.coordinator_id,method,args,
  status:error||close_error?'ORIGINAL_CONTINUATION_REQUIRED':'RETURNED',
  result,error,close_error,location,snapshot,completed_at:new Date().toISOString()};
 // Full result and original snapshot are durable before the CLI emits completion.
 await event('completed',output);await saveResult(output);return output;
}
module.exports={SCHEMA,originalNativeArguments,prepareOriginalContinuation,continueOriginalContact};
