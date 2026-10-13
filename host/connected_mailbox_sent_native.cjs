'use strict';
/**
 * Receive an original charged return in its existing private operation directory.
 * The caller supplies the current queue and account authority; this module never
 * constructs a sender, account store, grant or dispatcher.
 */
const fs=require('node:fs');
const path=require('node:path');
const net=require('node:net');
const {createHash,randomUUID}=require('node:crypto');
const {createMailboxSentReadbackReceiver}=require('./connected_mailbox_sent_readback.cjs');
const {validateMailboxSentReadback}=require('./connected_mailbox_sent_binding.cjs');
const SCHEMA='commons.mailbox-sent-native-receiving/v1';
const DONE=new Set(['AUTOMATION_SENT_READBACK_RECEIVED','AUTOMATION_SENT_READBACK_RETAINED']);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sha256Utf8=text=>({sha256:hash(Buffer.from(text,'utf8')),bytes:Buffer.byteLength(text,'utf8')});
const bytes=value=>Buffer.from(JSON.stringify(value)+'\n','utf8');
const need=(ok,message)=>{if(!ok)throw new TypeError(message);};
function regular(filename) {
  const fd=fs.openSync(filename,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  try {
    const stat=fs.fstatSync(fd);
    need(stat.isFile()&&!fs.lstatSync(filename).isSymbolicLink(),'Read the complete regular original receiving file.');
    return fs.readFileSync(fd);
  }finally{fs.closeSync(fd);}
}
function optional(filename) {
  try{return regular(filename);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
function json(body) {
  const text=body.toString('utf8');
  need(Buffer.from(text,'utf8').equals(body),'Read the complete UTF-8 original receiving record.');
  return JSON.parse(text);
}
function privateDirectory(filename,create=false,enforcePrivate=true) {
  if(create)try{fs.mkdirSync(filename,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  const stat=fs.lstatSync(filename);
  need(stat.isDirectory()&&!stat.isSymbolicLink(),'Use the existing ordinary private operation directory.');
  if(enforcePrivate&&process.platform!=='win32')need((stat.mode&0o077)===0,'Keep the original operation directory private.');
  return fs.realpathSync(filename);
}
function syncDirectory(dirname) {
  if(process.platform==='win32')return;
  const fd=fs.openSync(dirname,fs.constants.O_RDONLY);
  try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
function publish(filename,body) {
  const old=optional(filename);
  if(old){need(old.equals(body),'The original receiving file already names another complete value.');return;}
  const temporary=filename+'.'+randomUUID()+'.candidate';
  try {
    const fd=fs.openSync(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL,0o600);
    try{fs.writeFileSync(fd,body);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    try{fs.linkSync(temporary,filename);}catch(error){
      if(error.code!=='EEXIST'||!regular(filename).equals(body))throw error;
    }
    syncDirectory(path.dirname(filename));
  }finally{try{fs.unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
}
async function lease(root) {
  const key=hash(root),address=process.platform==='win32'?'\\\\.\\pipe\\mail-sent-'+key:
    process.platform==='linux'?'\0mail-sent-'+key:null;
  need(address,'Use the existing Windows or Linux native receiving runtime.');
  const server=net.createServer(socket=>socket.destroy());
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(address,()=>{server.off('error',reject);resolve();});});
  let closed=false;
  return async()=>{if(closed)return;closed=true;await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));};
}
function identity(selection) {
  need(selection?.schema==='commons.mailbox-sent-receiving-selection/v1'&&
    ['claim_id','provider_attempt_id','revision_id'].every(key=>typeof selection[key]==='string'&&selection[key]),
    'Receive the original complete queue claim, attempt and revision.');
  const account=selection.account;
  need(account&&typeof account.email==='string'&&typeof account.link_id==='string'&&
    /^\d+$/.test(String(account.id)),'Receive the original selected native account.');
  return {claim_id:selection.claim_id,provider_attempt_id:selection.provider_attempt_id,
    revision_id:selection.revision_id,account:{id:String(account.id),email:account.email,link_id:account.link_id}};
}
function sameAccount(left,right) {
  return left&&right&&String(left.id)===String(right.id)&&left.email===right.email&&left.link_id===right.link_id;
}
function scanEvents(directory,selectionSha) {
  const names=fs.readdirSync(directory).filter(name=>/^\d{10}-[a-f0-9]{64}\.json$/.test(name)).sort();
  let sequence=0,previous=null,settled=null,settlementInput=null;
  for(const name of names) {
    const body=regular(path.join(directory,name)),digest=hash(body),row=json(body);
    need(name===String(sequence+1).padStart(10,'0')+'-'+digest+'.json'&&row.schema===SCHEMA&&
      row.sequence===sequence+1&&row.previous_sha256===previous&&row.selection_sha256===selectionSha,
      'Reopen the complete original receiving journal without gaps or changed entries.');
    sequence++;previous=digest;
    const event=row.event;
    if(event?.phase==='sent-settlement-selected')settlementInput=event.input;
    if(event?.phase==='sent-settlement-returned'&&DONE.has(event.result?.status)) {
      need(settlementInput,'Retain the complete selected evidence before the settled account result.');
      settled={result:event.result,input:settlementInput,sequence,digest};
    }
  }
  return {sequence,previous,settled};
}
function appendEvent(directory,state,selectionSha,event) {
  need(state.sequence<9999999999,'The original receiving sequence is exhausted.');
  const value={schema:SCHEMA,selection_sha256:selectionSha,sequence:state.sequence+1,
    previous_sha256:state.previous,recorded_at:new Date().toISOString(),event};
  const body=bytes(value),digest=hash(body),name=String(value.sequence).padStart(10,'0')+'-'+digest+'.json';
  publish(path.join(directory,name),body);
  state.sequence=value.sequence;state.previous=digest;
  return {path:name,bytes:body.length,sha256:digest,sequence:value.sequence};
}
function compactResult(selectionSha,selected,state,result) {
  return {schema:SCHEMA,state:DONE.has(result.status)?'COMPLETE':'PENDING',
    selection_sha256:selectionSha,original:selected,status:result.status,
    journal:{events:state.sequence,last_sha256:state.previous},
    result,dispatch_permission:false};
}
/**
 * The current controller calls this after it has retained the exact first
 * provider return. Repeat with the same directory; omit selection on reopen.
 * account and sendBinding come from the currently configured owner adapter.
 */
async function receiveRetainedMailboxSent({operationDirectory,selection,account,sendBinding,
  service,admission,record}={}) {
  need(typeof operationDirectory==='string'&&path.isAbsolute(operationDirectory),'Use the existing absolute operation directory.');
  need(typeof service?.providerEvidence==='function'&&typeof admission?.observeSentReadback==='function'&&
    admission.sent_readback_identity==='original_post_and_sent_v1','Use the current original queue and account authority.');
  need(typeof record==='function','Use the original dispatcher journal callback.');
  need(['gmail.users.messages.send','mcp__codex_apps__gmail_send_email'].includes(sendBinding),'Use the actual original POST binding.');
  const operation=privateDirectory(operationDirectory,false,false);
  const root=privateDirectory(path.join(operation,'sent-readback'),true),release=await lease(root);
  try {
    const sourcePath=path.join(root,'selection.json');
    const saved=optional(sourcePath);
    if(selection!==undefined) {
      selection=json(bytes(selection));identity(selection);
      need(sameAccount(selection.account,account)&&sameAccount(selection.charge?.source_account,account),
        'The original selection belongs to another configured account.');
      if(saved)need(saved.equals(bytes(selection)),'Keep the exact original charged selection on continuation.');
      else publish(sourcePath,bytes(selection));
    }else {
      need(saved,'Select the complete original charged return for its first receiving.');
      selection=json(saved);identity(selection);
      need(sameAccount(selection.account,account)&&sameAccount(selection.charge?.source_account,account),
        'Reopen this operation with its original configured account.');
    }
    const selected=identity(selection),selectionSha=sha256Utf8(JSON.stringify(selection)).sha256;
    const expectedBinding=selection.charge?.args?.binding==='gmail.users.messages.send'?
      'gmail.users.messages.send':'mcp__codex_apps__gmail_send_email';
    need(sendBinding===expectedBinding,'Keep the original charged POST transport binding.');
    const events=privateDirectory(path.join(root,'events'),true),state=scanEvents(events,selectionSha);
    const completedPath=path.join(root,'complete.json'),completed=optional(completedPath);
    const verifySettlement=settled=>{
      const {post,sent,acceptance,...charged}=settled.input||{};
      need(JSON.stringify(charged)===JSON.stringify(selection.charge),
        'The retained evidence must contain the complete unchanged first charged return.');
      const proof=validateMailboxSentReadback(settled.input,{sha256Utf8,account,send_binding:sendBinding});
      need(proof.claim_id===selected.claim_id&&proof.provider_attempt_id===selected.provider_attempt_id&&
        proof.revision_id===selected.revision_id&&settled.result.settlement&&
        settled.result.settlement.message_id===proof.message_id&&
        settled.result.settlement.return_sha256===proof.return_sha256&&
        settled.result.settlement.dispatch_token===proof.dispatch_token,
        'The saved account settlement belongs to another original receiving selection.');
      return proof;
    };
    if(completed) {
      const result=json(completed);
      need(result.schema===SCHEMA&&result.state==='COMPLETE'&&result.selection_sha256===selectionSha&&state.settled,
        'Retain the complete original receiving journal and its completion.');
      verifySettlement(state.settled);
      need(result.journal.events===state.sequence&&result.journal.last_sha256===state.previous&&
        JSON.stringify(result.original)===JSON.stringify(selected)&&
        result.status===state.settled.result.status&&result.result?.status===result.status&&
        result.result.selection_sha256===selectionSha&&
        JSON.stringify(result.result.account)===JSON.stringify(state.settled.result),
        'The retained completion and journal differ.');
      await record({phase:'sent-native-receiving-reopened',selection_sha256:selectionSha,result});
      return result;
    }
    if(state.settled) {
      verifySettlement(state.settled);
      const received={status:state.settled.result.status,selection_sha256:selectionSha,
        original_claim_id:selected.claim_id,original_provider_attempt_id:selected.provider_attempt_id,
        account:state.settled.result};
      const result=compactResult(selectionSha,selected,state,received);
      publish(completedPath,bytes(result));
      await record({phase:'sent-native-receiving-completed',selection_sha256:selectionSha,result});
      return result;
    }
    const retainedRecord=async event=>{
      const receipt=appendEvent(events,state,selectionSha,event);
      await record({phase:'sent-native-evidence-retained',selection_sha256:selectionSha,entry:receipt,
        original:selected,evidence_phase:event.phase});
    };
    const guarded={
      sent_readback_identity:admission.sent_readback_identity,
      async observeSentReadback(input) {
        const {post,sent,acceptance,...charged}=input;
        need(JSON.stringify(charged)===JSON.stringify(selection.charge),'Keep the original charged invocation and first return.');
        validateMailboxSentReadback(input,{sha256Utf8,account,send_binding:sendBinding});
        return admission.observeSentReadback(input);
      },
      observeNativeReturn:typeof admission.observeNativeReturn==='function'?
        input=>admission.observeNativeReturn(input):undefined,
      observe:typeof admission.observe==='function'?input=>admission.observe(input):undefined
    };
    const receiver=createMailboxSentReadbackReceiver({service,admission:guarded,sha256Utf8,record:retainedRecord});
    const result=compactResult(selectionSha,selected,state,await receiver.receive(selection));
    if(result.state==='COMPLETE')publish(completedPath,bytes(result));
    else {
      const receipt=appendEvent(events,state,selectionSha,{phase:'sent-native-receiving-pending',result});
      await record({phase:'sent-native-receiving-pending',selection_sha256:selectionSha,entry:receipt,result});
    }
    await record({phase:'sent-native-receiving-returned',selection_sha256:selectionSha,result});
    return result;
  }finally{await release();}
}
async function inspectRetainedMailboxSent(operationDirectory) {
  need(typeof operationDirectory==='string'&&path.isAbsolute(operationDirectory),'Use the original absolute operation directory.');
  const operation=privateDirectory(operationDirectory,false,false),root=privateDirectory(path.join(operation,'sent-readback'));
  const release=await lease(root);
  try {
    const body=regular(path.join(root,'selection.json')),selection=json(body),selected=identity(selection);
    const selectionSha=sha256Utf8(JSON.stringify(selection)).sha256;
    const state=scanEvents(privateDirectory(path.join(root,'events')),selectionSha);
    const bodyResult=optional(path.join(root,'complete.json')),completion=bodyResult?json(bodyResult):null;
    if(completion)need(completion.schema===SCHEMA&&completion.selection_sha256===selectionSha&&
      completion.state==='COMPLETE'&&state.settled&&completion.journal?.events===state.sequence&&
      completion.journal.last_sha256===state.previous&&
      JSON.stringify(completion.original)===JSON.stringify(selected)&&
      JSON.stringify(completion.result?.account)===JSON.stringify(state.settled.result),
      'The retained completion and original journal differ.');
    return {schema:SCHEMA,state:completion?'COMPLETE':state.settled?'SETTLEMENT_RETAINED':'PENDING',
      selection_sha256:selectionSha,original:selected,journal:{events:state.sequence,last_sha256:state.previous},
      completion,dispatch_permission:false};
  }finally{await release();}
}
module.exports={receiveRetainedMailboxSent,inspectRetainedMailboxSent};
