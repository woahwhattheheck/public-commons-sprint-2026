// MIT. Partner response return uses the original bidder evidence/history and SQLite writer.
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { canonical, sha256, failure, plain, text, revision } from '../core.mjs';
const model=createRequire(import.meta.url)('./model.cjs');
const options={hash:sha256,hashBytes:bytes=>sha256(Buffer.from(bytes))};
const ORIGIN='canadabuys-response-review/';
const requireThat=(condition,code,message,details)=>{if(!condition)throw failure(code,message,409,details);};
const clone=value=>JSON.parse(JSON.stringify(value));
const editionDigest=value=>{const {editionSha256,...body}=value;return sha256(canonical(body));};
const size=value=>Buffer.byteLength(JSON.stringify(value));
function modelCall(fn){try{return fn();}catch(error){if(typeof error.code==='string'&&error.code.startsWith('RESPONSE_')&&!error.status)error.status=400;throw error;}}
async function modelAsync(fn){try{return await fn();}catch(error){if(typeof error.code==='string'&&error.code.startsWith('RESPONSE_')&&!error.status)error.status=400;throw error;}}
function checkedInput(value){
 if(!plain(value))throw failure('RESPONSE_INPUT','Send a complete response operation.');
 if(size(value)>model.MAX_FILE_BYTES)throw failure('RESPONSE_FILE_CAPACITY','Complete response input exceeds 64 MiB.',413);
 return clone(value);
}
function currentContext(workspace,document){
 const notice=workspace.getNotice(document.binding.noticeId),entry=notice.currentEntry;
 const workshare=workspace.getWorkshare(document.workshare.id);
 return {source:{noticeId:notice.id,entryId:entry.id,sourceId:entry.sourceId,rowSha256:entry.rowSha256,row:entry.row,summary:entry.summary},workshare};
}
function readDocument(workspace,id,selectedRevision){
 const desk=workspace.bidderDesk,record=desk.get('evidence',id,{revision:selectedRevision});
 requireThat(record.localOrigin===ORIGIN+id,'RESPONSE_RECORD_REQUIRED','Select a saved response-review document.');
 const file=desk.evidenceFile(id,{revision:record.revision});
 let document;
 try{document=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(file.body));}
 catch{throw failure('RESPONSE_DOCUMENT','The saved complete response document cannot be decoded.',409);}
 try{model.validateDocument(document);}catch(error){throw failure(error.code||'RESPONSE_DOCUMENT',error.message,409);}
 requireThat(document.id===record.id&&document.binding.noticeId===record.noticeId,'RESPONSE_DOCUMENT_CHANGED','The saved response identity or notice differs.');
 return {record,document};
}
function saveRecord(workspace,record){workspace.bidderDesk._save('evidence',record);return record;}
function evidenceValue(workspace,{id,noticeId,title,body,version,at,supersedes=null,origin,notes},current){
 const input={title,kind:'ANNEX',sourceUrl:'',localOrigin:origin||ORIGIN+id,language:'bilingual',
  version:String(version),capturedAt:at,pageOrSection:'Complete response, supplier review and original return',
  relatedNoticeIdentifiers:[noticeId],supersedes,notes:notes||'Editable response engineering and attributed supplier review. Bid and contractual decisions remain separate.',
  review:{state:'UNREVIEWED',reviewedBy:'',reviewedAt:null,note:''},
  bodyBase64:Buffer.from(body,'utf8').toString('base64')};
 const value={...workspace.bidderDesk._prepare('evidence',input,current),id,noticeId,
  revision:current?current.revision+1:1,createdAt:current?.createdAt||at,updatedAt:at,operator:workspace.operator};
 return {...value,editionSha256:editionDigest(value)};
}
function responseStatus(workspace){
 return workspace._snapshot(()=>{
  const records=workspace.db.prepare("SELECT data FROM bidder_records WHERE kind='evidence' ORDER BY rowid").all()
   .map(row=>JSON.parse(row.data)).filter(r=>r.localOrigin===ORIGIN+r.id)
   .map(({id,title,noticeId,revision,updatedAt,sha256,bytes})=>({id,title,noticeId,revision,updatedAt,sha256,bytes}));
  const workshares=workspace.db.prepare('SELECT data FROM workshares ORDER BY rowid').all().map(row=>{
   const {id,noticeId,title,partner,currency,feeCents,revision}=JSON.parse(row.data);return {id,noticeId,title,partner,currency,feeCents,revision};
  });
  return {schema:'starforge.canadabuys.response-review-status.v1',workspace:workspace.metadata(),records,workshares};
 });
}
export {responseStatus};
export function getResponseReview(workspace,id,{revision:selectedRevision}={}){
 return workspace._snapshot(()=>({...readDocument(workspace,id,selectedRevision),workspace:workspace.metadata()}));
}
export function prepareResponseReview(workspace,rawInput){
 const input=checkedInput(rawInput),desk=workspace.bidderDesk;
 modelCall(()=>model.validateMaster(input.master));text(input.commandId,'commandId',180);
 requireThat(input.workspaceId===workspace.metadata().id,'RESPONSE_WORKSPACE_CHANGED','Open the original workspace before preparing this response.');
 return desk._command('response-review.prepared',input,input.expectedRevision,()=>{
  const master=input.master,entry=workspace.getEntry(master.binding.entryId),notice=workspace.getNotice(master.binding.noticeId);
  requireThat(entry.noticeId===notice.id&&entry.sourceId===master.binding.sourceId&&entry.rowSha256===master.binding.rowSha256&&canonical(entry.row)===canonical(master.originalRow),
   'RESPONSE_SOURCE_CHANGED','Use the complete original master and its exact retained source row.');
  requireThat(notice.currentEntry.id===entry.id||input.allowHistoricalSource===true,'RESPONSE_SOURCE_REVIEW','This master uses an earlier retained source edition. Explicitly select that historical source before preparing it.');
  const workshare=workspace.getWorkshare(input.workshareId);
  requireThat(workshare.noticeId===notice.id,'RESPONSE_WORKSHARE_CHANGED','Choose the workshare for this response notice.');
  const id='evidence-'+randomUUID(),at=new Date().toISOString(),title=text(input.title||'Supplier response review','response title',4096);
  const document={schema:model.DOCUMENT_SCHEMA,id,title,binding:clone(master.binding),master:clone(master),workshare,
   content:model.initialContent(master),attachments:[],merges:[],createdAt:at,updatedAt:at};
  document.currentReviewContext=currentContext(workspace,document);
  model.validateDocument(document);
  const body=JSON.stringify(document,null,2)+'\n',record=evidenceValue(workspace,{id,noticeId:notice.id,title,body,version:1,at});
  saveRecord(workspace,record);
  return {value:{record,document},audit:{responseId:id,noticeId:notice.id,sourceEntryId:entry.id,workshareId:workshare.id}};
 });
}
export async function exportResponseReview(workspace,id,{revision:selectedRevision}={}){
 const base=workspace._snapshot(()=>({workspaceId:workspace.metadata().id,...readDocument(workspace,id,selectedRevision)}));
 return modelAsync(()=>model.createTransfer(base,options));
}
function namedReturn(transfer){
 const edition=transfer.editions.at(-1);
 return Boolean(edition&&edition.author.name.trim()&&canonical(edition.content)===canonical(transfer.draft.content)
  &&canonical(edition.attachmentIds)===canonical(transfer.attachments.map(x=>x.id))
  &&canonical(edition.author)===canonical(transfer.draft.author)&&edition.note===transfer.draft.note);
}
function comparePrepared(workspace,recordId,transfer){
 requireThat(transfer.base.workspaceId===workspace.metadata().id,'RESPONSE_WORKSPACE_CHANGED','Receive this file in its original response workspace.');
 requireThat(transfer.base.record.id===recordId,'RESPONSE_RECORD_CHANGED','Choose the original response document for this return.');
 const original=readDocument(workspace,recordId,transfer.base.record.revision);
 requireThat(canonical(original.record)===canonical(transfer.base.record)&&canonical(original.document)===canonical(transfer.base.document),
  'RESPONSE_BASE_CHANGED','The returned baseline differs from the complete original saved response edition.');
 const current=readDocument(workspace,recordId);
 requireThat(canonical(original.document.master)===canonical(current.document.master)&&canonical(original.document.binding)===canonical(current.document.binding),
  'RESPONSE_MASTER_CHANGED','The current response belongs to a different original source master.');
 const context=currentContext(workspace,current.document),previous=current.document.currentReviewContext||{
  source:{noticeId:current.document.binding.noticeId,entryId:current.document.binding.entryId,sourceId:current.document.binding.sourceId,rowSha256:current.document.binding.rowSha256,row:current.document.master.originalRow},
  workshare:current.document.workshare};
 const sameSource=previous.source.entryId===context.source.entryId&&previous.source.sourceId===context.source.sourceId
  &&previous.source.rowSha256===context.source.rowSha256&&canonical(previous.source.row)===canonical(context.source.row);
 const changedSource=sameSource?null:{baseline:previous.source,current:context.source};
 const changedWorkshare=canonical(previous.workshare)===canonical(context.workshare)?null:{baseline:previous.workshare,current:context.workshare};
 const rows=model.compareContent(original.document.content,current.document.content,transfer.draft.content);
 const incoming={transferId:transfer.transferId,sha256:sha256(canonical(transfer)),author:transfer.draft.author,note:transfer.draft.note,
  editions:transfer.editions.length,attachments:transfer.attachments.map(({base64,...a})=>a),returnReady:namedReturn(transfer)};
 const contextSha256=sha256(canonical(context));
 const reviewSha256=sha256(canonical({schema:'starforge.canadabuys.response-return-review.v1',workspaceId:workspace.metadata().id,
  recordId,currentEditionSha256:current.record.editionSha256,incomingSha256:incoming.sha256,contextSha256,rows,changedSource,changedWorkshare}));
 return {workspace:workspace.metadata(),current,incoming,comparison:{rows,changedSource,changedWorkshare,reviewSha256,contextSha256,returnReady:incoming.returnReady},context};
}
export async function compareResponseReturn(workspace,rawInput){
 const input=checkedInput(rawInput),transfer=await modelAsync(()=>model.validateTransfer(input.transfer,options));
 return workspace._snapshot(()=>{const {context,...result}=comparePrepared(workspace,input.recordId,transfer);return result;});
}
function mergeAttachments(current,incoming){
 const attachments=clone(current),known=new Map(attachments.map(a=>[a.id,a]));
 for(const a of incoming){
  const old=known.get(a.id);
  if(old){requireThat(old.base64===a.base64&&old.bytes===a.bytes,'RESPONSE_ATTACHMENT_CHANGED','A returned original attachment differs.');continue;}
  attachments.push(clone(a));known.set(a.id,a);
 }
 const total=attachments.reduce((sum,a)=>sum+a.bytes,0);
 requireThat(total<=model.MAX_ATTACHMENTS_BYTES,'RESPONSE_ATTACHMENT_CAPACITY','The merged complete attachments exceed 16 MiB.');
 return attachments;
}
export async function applyResponseReturn(workspace,rawInput){
 const input=checkedInput(rawInput);
 const transfer=await modelAsync(()=>model.validateTransfer(input.transfer,options));
 requireThat(namedReturn(transfer),'RESPONSE_RETURN_UNFINISHED','Save a named complete return edition in the partner editor before adopting it.');
 text(input.reviewer,'reviewer',4096);requireThat(Boolean(input.reviewer.trim()),'RESPONSE_REVIEWER','Name the reviewer adopting the selected values.');
 text(input.note||'','review note',32768);text(input.commandId,'commandId',180);
 requireThat(input.workspaceId===workspace.metadata().id,'RESPONSE_WORKSPACE_CHANGED','Open the original workspace before saving this return.');
 return workspace.bidderDesk._command('response-review.returned',input,input.expectedRevision,()=>{
  const reviewed=comparePrepared(workspace,input.recordId,transfer),{current,comparison,context}=reviewed;
  requireThat(input.reviewSha256===comparison.reviewSha256,'RESPONSE_CONTEXT_CHANGED','The current response, source or workshare changed. Compare this same complete return again.',{comparison});
  const acknowledgement=input.acknowledgement||{};
  for(const [key,present]of [['source',comparison.changedSource],['workshare',comparison.changedWorkshare]])
   if(present)requireThat(typeof acknowledgement[key]==='string'&&acknowledgement[key].trim(),'RESPONSE_CONTEXT_ACKNOWLEDGEMENT','Record your review of the changed '+key+' before adopting this response.');
  for(const key of ['source','workshare'])if(acknowledgement[key]!==undefined)text(acknowledgement[key],key+' review',32768);
  const selected=modelCall(()=>model.applyChoices(current.document.content,transfer.draft.content,comparison,input.choices));
  const {content,resets:reviewResets}=model.resolveReviewAttribution(current.document.content,transfer.draft.content,selected);
  const attachments=mergeAttachments(current.document.attachments,transfer.attachments);
  modelCall(()=>model.validateContent(content,current.document.master,new Set(attachments.map(a=>a.id))));
  const at=new Date().toISOString(),returnedId='evidence-'+randomUUID(),returnedBody=JSON.stringify(transfer,null,2)+'\n';
  const returnedRecord=evidenceValue(workspace,{id:returnedId,noticeId:current.record.noticeId,title:'Partner return — '+current.document.title,
   body:returnedBody,version:transfer.editions.length,at,origin:'canadabuys-response-return/'+current.record.id,
   notes:'Complete original returned working file. Supplier identity and review statements are attributed entries; the host adopted selected values separately.'});
  const merge={id:input.commandId,at,reviewer:input.reviewer,note:input.note||'',baselineRevision:transfer.base.record.revision,
   previousRevision:current.record.revision,incomingSha256:reviewed.incoming.sha256,transferId:transfer.transferId,
   returnedRecord:{id:returnedRecord.id,revision:returnedRecord.revision,sha256:returnedRecord.sha256,editionSha256:returnedRecord.editionSha256},
   reviewSha256:comparison.reviewSha256,choices:clone(input.choices),acknowledgement:clone(acknowledgement),
   context:clone(context),changedSource:comparison.changedSource,changedWorkshare:comparison.changedWorkshare,reviewResets};
  const document={...current.document,content,attachments,workshare:clone(context.workshare),currentReviewContext:clone(context),
   merges:[...current.document.merges,merge],updatedAt:at};
  model.validateDocument(document);
  requireThat(size(document)<=model.MAX_FILE_BYTES,'RESPONSE_FILE_CAPACITY','The complete saved response exceeds 64 MiB.');
  const record=evidenceValue(workspace,{id:current.record.id,noticeId:current.record.noticeId,title:current.record.title,
   body:JSON.stringify(document,null,2)+'\n',version:current.record.revision+1,at},current.record);
  saveRecord(workspace,returnedRecord);saveRecord(workspace,record);
  return {value:{record,returnedRecord,document,comparison:{...comparison,reviewResets}},
   audit:{responseId:record.id,noticeId:record.noticeId,revision:record.revision,returnedId,transferId:transfer.transferId,reviewSha256:comparison.reviewSha256}};
 });
}
export function responseMarkdown(workspace,id,options={}){
 const {record,document}=getResponseReview(workspace,id,options);
 return {body:model.markdown(document),mime:'text/markdown; charset=utf-8',filename:'response-review-'+record.id+'-r'+record.revision+'.md'};
}
