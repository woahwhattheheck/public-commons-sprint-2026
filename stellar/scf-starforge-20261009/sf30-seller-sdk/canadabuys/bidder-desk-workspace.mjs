// MIT. Saved bidder decisions share the original CanadaBuys SQLite transaction and source records.
import { randomUUID } from 'node:crypto';
import { canonical, sha256, failure, plain, text, revision, timestamp } from './core.mjs';
import { normalizeCapabilityProfile, normalizeEvidenceDocument, normalizeRequirementAssessment,
  assessCapabilityFit, compareDecisionContext } from './bidder-desk-domain.mjs';
import { renderDecisionReport } from './bidder-desk-reports.mjs';
import responseReviewModel from './response-review/model.cjs';

export const BIDDER_DESK_SCHEMA = 'starforge.canadabuys.bidder-desk.v1';
export const BIDDER_PACKAGE_SCHEMA = 'starforge.canadabuys.package.v2';
const KINDS = ['profile','evidence','requirement','decision'];
const HASH = /^[a-f0-9]{64}$/;
const ID = /^(?:profile|evidence|requirement|decision)-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const FIELDS = {
 profile:['label','legalName','operatingNames','description','keywords','excludedKeywords','categories','commodityCodes','deliveryRegions','opportunityRegions','qualificationClaims','capacity','commercial','evidenceIds','notes'],
 evidence:['title','kind','sourceUrl','localOrigin','accessState','sha256','bytes','language','capturedAt','issuedAt','version','pageOrSection','relatedNoticeIdentifiers','supersedes','review','accessFailure','notes'],
 requirement:['kind','applicability','requirementText','sourceEvidence','assessment','supplierEvidence','applicabilityBasis','reviewedBy','reviewedAt','owner','dueAt','clarificationQuestion','notes']
};
const NORMALIZE = {profile:normalizeCapabilityProfile,evidence:normalizeEvidenceDocument,requirement:normalizeRequirementAssessment};
const fields = (kind,value={}) => Object.fromEntries(FIELDS[kind].filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]]));
const requireThat = (condition,code,message,details) => {if(!condition)throw failure(code,message,409,details);};
const digest = record => {const {editionSha256,...body}=record;return sha256(canonical(body));};
const positive = (value,name) => {if(!Number.isSafeInteger(value)||value<1)throw failure('INVALID_REVISION',name+' must be a positive revision');return value;};
const strings = (input,name,maximum=1000) => {
 if(!Array.isArray(input)||input.length>maximum)throw failure('INVALID_FIELD',name+' must be a complete text list');
 return input.map(value=>text(value,name,32768));
};
const publicDecision = value => {
 const {context,assessment,changes,...decision}=value;
 return {...decision,requirementCount:context?.requirements?.length||0,evidenceCount:context?.evidence?.length||0,
   fit:assessment?.overall||null,reviewIssueCount:assessment?.reviewIssues?.length||0};
};
function sourceDescriptor(value){
 const {rawText,entryIds,observations,...source}=value;return source;
}
function recordKey(kind,id){return kind+'\n'+id;}

const RESPONSE_ORIGIN='canadabuys-response-review/';
function responseDocument(record,body){
 requireThat(record?.accessState==='CAPTURED'&&body&&body.sha256===record.sha256&&body.bytes===record.bytes,
  'BIDDER_RESPONSE_BODY_MISSING','The complete response needs its selected original evidence bytes');
 const bytes=Buffer.from(body.base64,'base64');
 requireThat(bytes.length===body.bytes&&bytes.toString('base64')===body.base64&&sha256(bytes)===body.sha256,
  'BIDDER_RESPONSE_BODY_CHANGED','The complete response evidence differs from its original bytes');
 let value;
 try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
 catch{throw failure('BIDDER_RESPONSE_JSON','The complete response evidence is not valid UTF-8 JSON',409);}
 return value;
}
function validateResponseCommand(command,edition,graph,bodyMap){
 const result=command.result,keys=Object.keys(result).sort();
 if(canonical(keys)===canonical(['record']))return;
 const applied=canonical(keys)===canonical(['comparison','document','record','returnedRecord']);
 requireThat(applied||canonical(keys)===canonical(['document','record']),
  'BIDDER_COMMAND_RESULT_CHANGED','A saved command contains an unsupported result shape');
 requireThat(edition.localOrigin===RESPONSE_ORIGIN+edition.id,
  'BIDDER_RESPONSE_ORIGIN','An expanded response result must belong to its original response evidence');
 const selected=(id,revision)=>{
  const item=graph.get(recordKey('evidence',id))?.editions?.[revision-1];
  requireThat(item&&item.revision===revision,'BIDDER_RESPONSE_DEPENDENCY_MISSING','A complete response history dependency is missing',{id,revision});
  return item;
 };
 const read=record=>responseDocument(record,bodyMap.get(record.sha256));
 const document=read(edition);
 responseReviewModel.validateDocument(document);
 requireThat(canonical(document)===canonical(result.document)&&document.id===edition.id&&document.binding.noticeId===edition.noticeId,
  'BIDDER_RESPONSE_DOCUMENT_CHANGED','The command response differs from its original selected evidence body');
 if(!applied){
  requireThat(edition.revision===1&&document.merges.length===0,
   'BIDDER_RESPONSE_PREPARED_CHANGED','The prepared response must be its initial complete edition');
  return;
 }
 const merge=document.merges.at(-1),returned=result.returnedRecord,comparison=result.comparison;
 requireThat(plain(merge)&&merge.id===command.id&&merge.previousRevision===edition.revision-1&&plain(returned)&&plain(comparison),
  'BIDDER_RESPONSE_RETURN_CHANGED','The returned command needs its original receiving history');
 const previousRecord=selected(edition.id,merge.previousRevision),previous=read(previousRecord);
 requireThat(canonical(previous.master)===canonical(document.master)&&canonical(previous.binding)===canonical(document.binding)
  &&canonical(previous.merges)===canonical(document.merges.slice(0,-1)),
  'BIDDER_RESPONSE_HISTORY_CHANGED','A response return must preserve its original master and complete prior receiving history');
 requireThat(canonical(returned)===canonical(selected(returned.id,returned.revision))
  &&returned.noticeId===edition.noticeId&&returned.localOrigin==='canadabuys-response-return/'+edition.id
  &&canonical(merge.returnedRecord)===canonical({id:returned.id,revision:returned.revision,sha256:returned.sha256,editionSha256:returned.editionSha256}),
  'BIDDER_RESPONSE_RETURN_CHANGED','The returned original record differs from its complete selected evidence edition');
 const transfer=read(returned),base=transfer.base;
 requireThat(transfer.schema===responseReviewModel.TRANSFER_SCHEMA&&plain(base)&&plain(base.record)
  &&base.record.id===edition.id&&base.record.revision===merge.baselineRevision&&base.record.revision<=merge.previousRevision,
  'BIDDER_RESPONSE_BASE_CHANGED','The returned original baseline is missing or selects another response');
 const original=selected(edition.id,base.record.revision);
 requireThat(canonical(base.record)===canonical(original)&&canonical(base.document)===canonical(read(original))
  &&sha256(canonical(base))===transfer.transferId&&transfer.transferId===merge.transferId
  &&sha256(canonical(transfer))===merge.incomingSha256,
  'BIDDER_RESPONSE_BASE_CHANGED','The returned file differs from its immutable baseline or retained complete return');
 const rows=responseReviewModel.compareContent(base.document.content,previous.content,transfer.draft.content);
 const context=merge.context,prior=previous.currentReviewContext||{
  source:{noticeId:previous.binding.noticeId,entryId:previous.binding.entryId,sourceId:previous.binding.sourceId,rowSha256:previous.binding.rowSha256,row:previous.master.originalRow},
  workshare:previous.workshare};
 requireThat(plain(context)&&plain(context.source)&&plain(context.workshare),
  'BIDDER_RESPONSE_CONTEXT_CHANGED','The receiving history needs its complete reviewed source and workshare');
 const sameSource=prior.source.entryId===context.source.entryId&&prior.source.sourceId===context.source.sourceId
  &&prior.source.rowSha256===context.source.rowSha256&&canonical(prior.source.row)===canonical(context.source.row);
 const changedSource=sameSource?null:{baseline:prior.source,current:context.source};
 const changedWorkshare=canonical(prior.workshare)===canonical(context.workshare)?null:{baseline:prior.workshare,current:context.workshare};
 const contextSha256=sha256(canonical(context));
 const reviewSha256=sha256(canonical({schema:'starforge.canadabuys.response-return-review.v1',workspaceId:base.workspaceId,
  recordId:edition.id,currentEditionSha256:previousRecord.editionSha256,incomingSha256:merge.incomingSha256,
  contextSha256,rows,changedSource,changedWorkshare}));
 requireThat(canonical(merge.changedSource)===canonical(changedSource)&&canonical(merge.changedWorkshare)===canonical(changedWorkshare)
  &&merge.reviewSha256===reviewSha256&&canonical(document.currentReviewContext)===canonical(context)
  &&canonical(document.workshare)===canonical(context.workshare)
  &&canonical(comparison)===canonical({rows,changedSource,changedWorkshare,reviewSha256,contextSha256,returnReady:true,reviewResets:merge.reviewResets}),
  'BIDDER_RESPONSE_COMPARISON_CHANGED','The saved comparison differs from the complete original three-way review');
 const selectedContent=responseReviewModel.applyChoices(previous.content,transfer.draft.content,rows,merge.choices);
 const resolved=responseReviewModel.resolveReviewAttribution(previous.content,transfer.draft.content,selectedContent);
 requireThat(canonical(resolved.resets)===canonical(merge.reviewResets)&&canonical(resolved.content)===canonical(document.content),
  'BIDDER_RESPONSE_SELECTION_CHANGED','The saved response differs from its original explicit choices and source-bound review attribution');
}


export class CanadaBuysBidderDesk {
 constructor(workspace,{maximumEvidenceBytes=64*1024*1024}={}){
  this.workspace=workspace;this.db=workspace.db;this.maximumEvidenceBytes=maximumEvidenceBytes;
  this.db.exec('CREATE TABLE IF NOT EXISTS bidder_records(kind TEXT NOT NULL,id TEXT NOT NULL,notice_id TEXT,data TEXT NOT NULL,PRIMARY KEY(kind,id));'
   +'CREATE INDEX IF NOT EXISTS bidder_notice_records ON bidder_records(notice_id,kind);'
   +'CREATE TABLE IF NOT EXISTS bidder_editions(kind TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id,revision));'
   +'CREATE TABLE IF NOT EXISTS bidder_evidence_bodies(sha256 TEXT PRIMARY KEY,body BLOB NOT NULL);'
   +'CREATE TABLE IF NOT EXISTS bidder_commands(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,result TEXT NOT NULL);');
 }
 _kind(kind){if(!KINDS.includes(kind))throw failure('INVALID_BIDDER_KIND','Choose a profile, evidence, requirement or decision');return kind;}
 _record(kind,id,selectedRevision){
  this._kind(kind);text(id,'record id',256);
  const row=selectedRevision===undefined
   ?this.db.prepare('SELECT data FROM bidder_records WHERE kind=? AND id=?').get(kind,id)
   :this.db.prepare('SELECT data FROM bidder_editions WHERE kind=? AND id=? AND revision=?').get(kind,id,positive(selectedRevision,'record revision'));
  if(!row)throw failure('BIDDER_RECORD_NOT_FOUND','The selected saved '+kind+' edition does not exist',404,{kind,id,revision:selectedRevision});
  const record=JSON.parse(row.data);
  requireThat(record.editionSha256===digest(record),'BIDDER_RECORD_CHANGED','The saved record differs from its complete edition');
  return record;
 }
 _history(kind,id,maximum=Number.MAX_SAFE_INTEGER){
  return this.db.prepare('SELECT data FROM bidder_editions WHERE kind=? AND id=? AND revision<=? ORDER BY revision').all(kind,id,maximum).map(row=>JSON.parse(row.data));
 }
 get(kind,id,{revision:selectedRevision,history=false}={}){
  return this.workspace._snapshot(()=>{
   const record=this._record(kind,id,selectedRevision);
   return history?{...record,history:this._history(kind,id,record.revision)}:record;
  });
 }
 list(kind,{noticeId,offset=0,limit=100}={}){
  this._kind(kind);
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>1000)
   throw failure('INVALID_PAGE','Use a nonnegative offset and a page size from 1 to 1000');
  return this.workspace._snapshot(()=>{
   const where=noticeId===undefined?'kind=?':'kind=? AND notice_id=?',args=noticeId===undefined?[kind]:[kind,text(noticeId,'notice id',256)];
   const total=Number(this.db.prepare('SELECT COUNT(*) AS n FROM bidder_records WHERE '+where).get(...args).n);
   const rows=this.db.prepare('SELECT data FROM bidder_records WHERE '+where+' ORDER BY rowid LIMIT ? OFFSET ?').all(...args,limit,offset).map(row=>JSON.parse(row.data));
   return {kind,records:kind==='decision'?rows.map(publicDecision):rows,page:{offset,limit,total,nextOffset:offset+rows.length<total?offset+rows.length:null}};
  });
 }
 _all(kind,noticeId){
  return (noticeId===undefined
   ?this.db.prepare('SELECT data FROM bidder_records WHERE kind=? ORDER BY rowid').all(kind)
   :this.db.prepare('SELECT data FROM bidder_records WHERE kind=? AND notice_id=? ORDER BY rowid').all(kind,noticeId)).map(row=>JSON.parse(row.data));
 }
 status(){
  return this.workspace._snapshot(()=>({schema:BIDDER_DESK_SCHEMA,workspace:this.workspace.metadata(),
   counts:Object.fromEntries(KINDS.map(kind=>[kind,Number(this.db.prepare('SELECT COUNT(*) AS n FROM bidder_records WHERE kind=?').get(kind).n)]))}));
 }
 _command(type,input,expectedWorkspaceRevision,callback){
  if(!plain(input))throw failure('INVALID_BIDDER_INPUT','Send a complete record object');
  const commandId=input.commandId===undefined?null:text(input.commandId,'commandId',256);
  if(commandId!==null&&!commandId.trim())throw failure('INVALID_COMMAND_ID','Use a stable nonempty command id');
  const fingerprint=sha256(canonical({type,input}));
  const previous=()=>{
   if(!commandId)return null;
   const row=this.db.prepare('SELECT fingerprint,result FROM bidder_commands WHERE id=?').get(commandId);
   if(!row)return null;
   requireThat(row.fingerprint===fingerprint,'COMMAND_ID_REUSED','This command id already belongs to different saved input');
   return JSON.parse(row.result);
  };
  const replay=previous();if(replay)return {...replay,workspace:this.workspace.metadata(),alreadyApplied:true};
  try{
   return this.workspace._change('bidder.'+type,expectedWorkspaceRevision,()=>{
    if(previous())throw failure('BIDDER_COMMAND_REPLAY','The original command already completed',409);
    const result=callback();
    if(commandId)this.db.prepare('INSERT INTO bidder_commands(id,fingerprint,result) VALUES(?,?,?)').run(commandId,fingerprint,JSON.stringify(result.value));
    return result;
   });
  }catch(error){
   if(['BIDDER_COMMAND_REPLAY','REVISION_CONFLICT'].includes(error.code)){
    const done=previous();if(done)return {...done,workspace:this.workspace.metadata(),alreadyApplied:true};
   }
   throw error;
  }
 }
 _save(kind,record){
  this.db.prepare('INSERT INTO bidder_editions(kind,id,revision,data) VALUES(?,?,?,?)').run(kind,record.id,record.revision,JSON.stringify(record));
  this.db.prepare('INSERT INTO bidder_records(kind,id,notice_id,data) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data')
   .run(kind,record.id,record.noticeId||null,JSON.stringify(record));
 }
 _references(references){
  if(!Array.isArray(references))throw failure('INVALID_EVIDENCE_REFERENCES','Use a complete document reference list');
  return references.map(reference=>{
   if(!plain(reference))throw failure('INVALID_EVIDENCE_REFERENCE','Each reference needs its saved document');
   const saved=this._record('evidence',reference.evidenceId,reference.revision);
   if(reference.sha256!==undefined&&reference.sha256!==null&&reference.sha256!==saved.sha256)
    throw failure('EVIDENCE_SELECTION_CHANGED','The selected document digest differs from this evidence edition',409);
   const {sha256:providedHash,...selected}=reference;
   return {...selected,revision:saved.revision,...(saved.sha256?{sha256:saved.sha256}:{})};
  });
 }
 _prepare(kind,input,current){
  let selected={...fields(kind,current||{}),...fields(kind,input)};
  if(kind==='evidence'&&Object.hasOwn(input,'bodyBase64')){
   if(typeof input.bodyBase64!=='string'||input.bodyBase64.length>Math.ceil(this.maximumEvidenceBytes/3)*4)
    throw failure('EVIDENCE_CAPACITY','Select a file within the configured evidence capacity',413);
   const body=Buffer.from(input.bodyBase64,'base64');
   if(body.toString('base64')!==input.bodyBase64||body.length>this.maximumEvidenceBytes)
    throw failure('INVALID_EVIDENCE_BODY','Evidence must contain complete canonical Base64 bytes');
   const hash=sha256(body);
   if(input.sha256&&input.sha256!==hash)throw failure('EVIDENCE_HASH_MISMATCH','The selected evidence bytes differ from the supplied SHA256',409);
   if(input.bytes!==undefined&&input.bytes!==body.length)throw failure('EVIDENCE_LENGTH_MISMATCH','The selected evidence bytes differ from the supplied length',409);
   selected={...selected,accessState:'CAPTURED',sha256:hash,bytes:body.length,capturedAt:input.capturedAt||new Date().toISOString()};
   const retained=this.db.prepare('SELECT body FROM bidder_evidence_bodies WHERE sha256=?').get(hash);
   if(retained)requireThat(sha256(Buffer.from(retained.body))===hash,'EVIDENCE_BODY_CHANGED','Retained evidence bytes differ from their hash');
   else this.db.prepare('INSERT INTO bidder_evidence_bodies(sha256,body) VALUES(?,?)').run(hash,body);
  }
  if(kind==='requirement'){
   selected.sourceEvidence=this._references(selected.sourceEvidence||[]);
   selected.supplierEvidence=this._references(selected.supplierEvidence||[]);
  }
  if(current&&kind==='evidence'){
   const changed=['sha256','bytes','sourceUrl','issuedAt','version','accessState'].some(key=>canonical(selected[key])!==canonical(current[key]));
   const review=input.review;
   const renewed=plain(review)&&review.state==='REVIEWED'&&typeof review.reviewedBy==='string'&&review.reviewedBy.trim()
    &&typeof review.reviewedAt==='string'&&Date.parse(review.reviewedAt)>Date.parse(current.review?.reviewedAt||'1970-01-01T00:00:00Z');
   if(changed&&!renewed)selected.review={state:'UNREVIEWED',reviewedBy:'',reviewedAt:null,note:selected.review?.note||''};
  }
  if(current&&kind==='requirement'){
   const changed=['kind','applicability','requirementText','sourceEvidence','supplierEvidence','applicabilityBasis'].some(key=>canonical(selected[key])!==canonical(current[key]));
   const renewed=['MET','NOT_MET','UNKNOWN','NOT_APPLICABLE'].includes(input.assessment)&&typeof input.reviewedBy==='string'&&input.reviewedBy.trim()
    &&typeof input.reviewedAt==='string'&&Date.parse(input.reviewedAt)>Date.parse(current.reviewedAt||'1970-01-01T00:00:00Z');
   if(changed&&!renewed)selected={...selected,assessment:'UNREVIEWED',reviewedBy:'',reviewedAt:null};
  }
  const record=NORMALIZE[kind](selected,fields(kind,current||{}));
  if(kind==='evidence'&&record.accessState==='CAPTURED'){
   const found=this.db.prepare('SELECT length(body) AS bytes FROM bidder_evidence_bodies WHERE sha256=?').get(record.sha256);
   requireThat(found&&Number(found.bytes)===record.bytes,'EVIDENCE_BODY_REQUIRED','Attach the exact document bytes for captured evidence');
  }
  if(kind==='profile'){
   const refs=new Set([...(record.evidenceIds||[]),...(record.qualificationClaims||[]).flatMap(claim=>claim.evidenceIds||[])]);
   for(const id of refs)this._record('evidence',id);
  }
  return record;
 }
 create(kind,input){
  this._kind(kind);if(kind==='decision')return this.createDecision(input);
  return this._command(kind+'.created',input,input.expectedRevision,()=>{
   const id=input.id===undefined?kind+'-'+randomUUID():text(input.id,'record id',256);
   requireThat(ID.test(id)&&id.startsWith(kind+'-'),'INVALID_BIDDER_ID','Use the original record kind and UUID');
   requireThat(!this.db.prepare('SELECT 1 FROM bidder_records WHERE kind=? AND id=?').get(kind,id),'BIDDER_RECORD_EXISTS','The chosen record already exists');
   const noticeId=kind==='profile'?null:input.noticeId?text(input.noticeId,'noticeId',256):null;
   if(kind==='requirement'&&!noticeId)throw failure('NOTICE_REQUIRED','Select the notice for this requirement');
   if(noticeId)this.workspace.getNotice(noticeId);
   const at=new Date().toISOString(),value={...this._prepare(kind,input),id,noticeId,revision:1,createdAt:at,updatedAt:at,operator:this.workspace.operator};
   const record={...value,editionSha256:digest(value)};this._save(kind,record);
   return {value:{record},audit:{kind,id,noticeId,revision:1}};
  });
 }
 update(kind,id,input){
  this._kind(kind);if(kind==='decision')return this.updateDecision(id,input);
  return this._command(kind+'.updated',{...input,id},null,()=>{
   const current=this._record(kind,id);revision(input.expectedRevision,current.revision,kind);
   if(input.noticeId!==undefined&&input.noticeId!==current.noticeId)throw failure('BIDDER_NOTICE_CHANGED','Create a separate record for another notice',409);
   const value={...this._prepare(kind,input,current),id,noticeId:current.noticeId,revision:current.revision+1,createdAt:current.createdAt,updatedAt:new Date().toISOString(),operator:this.workspace.operator};
   const record={...value,editionSha256:digest(value)};this._save(kind,record);
   return {value:{record},audit:{kind,id,noticeId:record.noticeId,revision:record.revision}};
  });
 }
 /**
  * Save a complete document intake in one original SQLite transaction.
  * Every document remains a native evidence record and native replay command.
  */
 intakeEvidence(input){
  if(!plain(input)||!Array.isArray(input.documents)||!input.documents.length||input.documents.length>100)
   throw failure('INVALID_EVIDENCE_INTAKE','Choose between 1 and 100 complete documents');
  const commandId=text(input.commandId,'intake commandId',180);
  if(!commandId.trim()||/[\x00-\x1f\x7f]/.test(commandId))
   throw failure('INVALID_COMMAND_ID','Use a stable nonempty intake command id');
  const metadata=this.workspace.metadata();
  requireThat(input.workspaceId===metadata.id,'INTAKE_WORKSPACE_CHANGED','Open this intake in its original workspace');
  revision(input.expectedRevision,input.expectedRevision);
  const noticeId=text(input.noticeId,'intake noticeId',256);
  const notice=this.workspace.getNotice(noticeId);
  const {applyRevision,...originalInput}=input;
  const saveRevision=applyRevision===undefined?input.expectedRevision:applyRevision;
  revision(saveRevision,saveRevision);
  const intakeSha256=sha256(canonical(originalInput));
  const commands=input.documents.map((document,index)=>{
   if(!plain(document)||typeof document.bodyBase64!=='string')
    throw failure('INVALID_EVIDENCE_BODY','Each intake document needs its complete original bytes');
   for(const key of ['id','noticeId','revision','createdAt','updatedAt','operator','editionSha256','commandId','expectedRevision','intakeSha256'])
    if(Object.hasOwn(document,key))throw failure('INVALID_INTAKE_FIELD','Document '+(index+1)+' must not set '+key);
   if(document.bodyBase64.length>Math.ceil(this.maximumEvidenceBytes/3)*4)
    throw failure('EVIDENCE_CAPACITY','Select files within the configured evidence capacity',413);
   const body=Buffer.from(document.bodyBase64,'base64'),hash=sha256(body);
   if(body.toString('base64')!==document.bodyBase64||body.length>this.maximumEvidenceBytes)
    throw failure('INVALID_EVIDENCE_BODY','Evidence must contain complete canonical Base64 bytes');
   if(document.sha256!==undefined&&document.sha256!==hash)
    throw failure('EVIDENCE_HASH_MISMATCH','Intake document '+(index+1)+' differs from its supplied SHA256',409);
   if(document.bytes!==undefined&&document.bytes!==body.length)
    throw failure('EVIDENCE_LENGTH_MISMATCH','Intake document '+(index+1)+' differs from its supplied byte length',409);
   if(document.review&&document.review.state!=='UNREVIEWED')
    throw failure('INTAKE_REVIEW_REQUIRED','Open the saved document to record its completed review');
   if(typeof document.capturedAt!=='string'||!document.capturedAt.trim())
    throw failure('INVALID_TIMESTAMP','Each intake document needs its saved capture timestamp');
   const {bodyBase64,...fields}=document;
   const value=normalizeEvidenceDocument({...fields,sha256:hash,bytes:body.length,accessState:'CAPTURED',
    capturedAt:timestamp(document.capturedAt,'document capturedAt'),
    review:{state:'UNREVIEWED',reviewedBy:'',reviewedAt:null,note:document.review?.note||''}});
   if(value.supersedes){
    const earlier=this._record('evidence',value.supersedes);
    requireThat(earlier.noticeId===notice.id,'INTAKE_DOCUMENT_NOTICE_CHANGED','An earlier document must belong to this notice');
   }
   const original={...value,bodyBase64,noticeId,expectedRevision:input.expectedRevision,
    commandId:commandId+':document:'+index,intakeSha256};
   return {input:original,fingerprint:sha256(canonical({type:'evidence.created',input:original}))};
  });
  const replay=()=>this.workspace._snapshot(()=>{
   const records=[];
   for(const command of commands){
    const prior=this.db.prepare('SELECT fingerprint,result FROM bidder_commands WHERE id=?').get(command.input.commandId);
    if(!prior)continue;
    requireThat(prior.fingerprint===command.fingerprint,'COMMAND_ID_REUSED','This intake identity already belongs to different original input');
    const saved=JSON.parse(prior.result).record,edition=this._record('evidence',saved.id,saved.revision);
    requireThat(saved.editionSha256===edition.editionSha256,'INTAKE_RECORD_CHANGED','The original intake edition differs');
    records.push(edition);
   }
   if(!records.length)return null;
   requireThat(records.length===commands.length,'INTAKE_INCOMPLETE_HISTORY','Receive the complete original intake before replaying it');
   return {schema:'starforge.canadabuys.evidence-intake.v1',commandId,intakeSha256,noticeId,
    records,workspace:this.workspace.metadata(),alreadyApplied:true};
  });
  const previous=replay();if(previous)return previous;
  try{
   return this.workspace._change('bidder.evidence.intake',saveRevision,()=>{
    if(replay())throw failure('BIDDER_COMMAND_REPLAY','The original intake already completed',409);
    const records=commands.map(command=>{
     const at=new Date().toISOString(),value={...this._prepare('evidence',command.input),id:'evidence-'+randomUUID(),
      noticeId,revision:1,createdAt:at,updatedAt:at,operator:this.workspace.operator};
     const record={...value,editionSha256:digest(value)};
     this._save('evidence',record);
     this.db.prepare('INSERT INTO bidder_commands(id,fingerprint,result) VALUES(?,?,?)')
      .run(command.input.commandId,command.fingerprint,JSON.stringify({record}));
     return record;
    });
    return {value:{schema:'starforge.canadabuys.evidence-intake.v1',commandId,intakeSha256,noticeId,records,alreadyApplied:false},
     audit:{commandId,intakeSha256,noticeId,recordIds:records.map(record=>record.id),documents:records.length}};
   });
  }catch(error){
   if(['BIDDER_COMMAND_REPLAY','REVISION_CONFLICT'].includes(error.code)){const done=replay();if(done)return done;}
   throw error;
  }
 }
 evidenceFile(id,{revision:selectedRevision}={}){
  return this.workspace._snapshot(()=>{
   const record=this._record('evidence',id,selectedRevision);
   if(record.accessState!=='CAPTURED')throw failure('EVIDENCE_NOT_CAPTURED','This record retains a source link or access state',404);
   const found=this.db.prepare('SELECT body FROM bidder_evidence_bodies WHERE sha256=?').get(record.sha256);
   const body=found?Buffer.from(found.body):null;
   requireThat(body&&body.length===record.bytes&&sha256(body)===record.sha256,'EVIDENCE_BODY_CHANGED','Original evidence bytes are unavailable or differ');
   return {record,body,mime:'application/octet-stream',filename:record.title||'evidence-'+record.sha256};
  });
 }
 _context({noticeId,sourceEntryId,profileId,profileRevision,allowHistoricalEntry=false}){
  const notice=this.workspace.getNotice(text(noticeId,'noticeId',256));
  const entry=this.workspace.getEntry(text(sourceEntryId,'sourceEntryId',256));
  requireThat(entry.noticeId===notice.id,'DECISION_NOTICE_CHANGED','The selected source edition belongs to another notice');
  requireThat(allowHistoricalEntry===true||entry.id===notice.currentEntry.id,'DECISION_SOURCE_REVIEW_REQUIRED','The notice has a newer source edition; select and review it or explicitly choose the historical edition',
   {selectedEntryId:entry.id,currentEntryId:notice.currentEntry.id});
  const profile=this._record('profile',text(profileId,'profileId',256),positive(profileRevision,'profileRevision'));
  const currentProfile=this._record('profile',profile.id);
  requireThat(profile.revision===currentProfile.revision,'DECISION_PROFILE_REVIEW_REQUIRED','The profile has changed; review its current saved revision',
   {selectedRevision:profile.revision,currentRevision:currentProfile.revision});
  const requirements=this._all('requirement',notice.id),evidence=new Map();
  const add=(id,rev)=>{const item=this._record('evidence',id,rev);evidence.set(item.id+':'+item.revision,item);};
  for(const item of this._all('evidence',notice.id))add(item.id,item.revision);
  for(const id of new Set([...(profile.evidenceIds||[]),...(profile.qualificationClaims||[]).flatMap(claim=>claim.evidenceIds||[])]))add(id);
  for(const requirement of requirements)for(const ref of [...requirement.sourceEvidence,...requirement.supplierEvidence]){
   add(ref.evidenceId,ref.revision);add(ref.evidenceId);
  }
  return {entry,source:sourceDescriptor(this.workspace.getSource(entry.sourceId,{includeBody:false})),profile,
   evidence:[...evidence.values()].sort((a,b)=>a.id.localeCompare(b.id)||a.revision-b.revision),requirements};
 }
 assess(input){
  return this.workspace._snapshot(()=>{
   const context=this._context(input),at=new Date().toISOString();
   return {context,assessment:this._assessment(context,at),contextSha256:sha256(canonical(context)),evaluatedAt:at};
  });
 }
 _assessment(context,at){
  const result=assessCapabilityFit({entry:context.entry,profile:context.profile,now:Date.parse(at)}),issues=[];
  for(const requirement of context.requirements){
   if(requirement.kind==='MANDATORY'&&requirement.applicability!=='DOES_NOT_APPLY'&&requirement.assessment!=='MET')
    issues.push({code:'MANDATORY_REVIEW',requirementId:requirement.id,message:requirement.requirementText,assessment:requirement.assessment});
   for(const ref of [...requirement.sourceEvidence,...requirement.supplierEvidence]){
    const current=this._record('evidence',ref.evidenceId);
    if(current.revision!==ref.revision)issues.push({code:'DOCUMENT_CHANGED_SINCE_ASSESSMENT',requirementId:requirement.id,evidenceId:ref.evidenceId,reviewedRevision:ref.revision,currentRevision:current.revision,
     message:'Document changed after this requirement was assessed'});
   }
  }
  return {...result,reviewIssues:issues,requirements:{total:context.requirements.length,met:context.requirements.filter(r=>r.assessment==='MET').length,
   unresolved:context.requirements.filter(r=>['UNREVIEWED','UNKNOWN'].includes(r.assessment)).length}};
 }
 fit(profileId,{profileRevision,noticeIds=[],now=Date.now()}={}){
  return this.workspace._snapshot(()=>{
   const profile=this._record('profile',profileId,profileRevision),notices=this.workspace.view().notices;
   if(!Array.isArray(noticeIds)||noticeIds.some(id=>typeof id!=='string'))throw failure('INVALID_SELECTION','Select notice identities');
   const ids=new Set(noticeIds),selected=ids.size?notices.filter(n=>ids.has(n.id)):notices;
   if(ids.size!==0&&selected.length!==ids.size)throw failure('NOTICE_NOT_FOUND','A selected notice is unavailable',404);
   return {profile,results:selected.map(notice=>{
    const entry=this.workspace.getEntry(notice.entries[0].id);
    return {...assessCapabilityFit({entry,profile,now}),noticeId:notice.id,sourceEntryId:entry.id,presentInLatestOpenFeed:notice.presentInLatestOpenFeed};
   })};
  });
 }
 _decision(input,current){
  const selected={...(current?{noticeId:current.noticeId,sourceEntryId:current.sourceEntryId,profileId:current.profileId,profileRevision:current.profileRevision}:{}),...input};
  if(current&&selected.noticeId!==current.noticeId)throw failure('DECISION_NOTICE_CHANGED','Create a new decision for another notice',409);
  const administrative=current&&Object.keys(input).every(key=>['id','commandId','expectedRevision','owner','nextActions'].includes(key));
  const context=administrative?current.context:this._context(selected);
  const contextSha256=sha256(canonical(context));
  if(!administrative)requireThat(HASH.test(input.contextSha256||'')&&input.contextSha256===contextSha256,
   'DECISION_CONTEXT_REVIEW_REQUIRED','Review the selected context and pass its contextSha256 before saving this decision',
   {selectedContextSha256:input.contextSha256||null,currentContextSha256:contextSha256});
  const choose=(key,fallback)=>Object.hasOwn(input,key)?input[key]:current?.[key]??fallback;
  const choice=choose('choice','INVESTIGATE');
  if(!['BID','NO_BID','INVESTIGATE','PARK'].includes(choice))throw failure('INVALID_BID_DECISION','Choose Bid, No Bid, Investigate or Park');
  const rationale=text(choose('rationale',''),'rationale',131072);
  if(!rationale.trim())throw failure('DECISION_RATIONALE_REQUIRED','Record the reason for this decision');
  const reviewedBy=text(choose('reviewedBy',this.workspace.operator),'reviewedBy',256);
  if(!reviewedBy.trim())throw failure('REVIEWER_REQUIRED','Record who reviewed this decision');
  const actions=choose('nextActions',[]);
  if(!Array.isArray(actions)||actions.length>1000)throw failure('INVALID_NEXT_ACTIONS','Use a complete action list');
  const nextActions=actions.map((action,index)=>{
   if(!plain(action))throw failure('INVALID_NEXT_ACTION','Each action needs its task and owner');
   const status=action.status||'OPEN';
   if(!['OPEN','DONE','CANCELLED'].includes(status))throw failure('INVALID_NEXT_ACTION','Choose an action status');
   return {id:text(action.id||'action-'+(index+1),'action id',256),task:text(action.task||'','action task',32768),
    owner:text(action.owner||'','action owner',256),dueAt:action.dueAt?timestamp(action.dueAt,'action dueAt'):null,status};
  });
  if(new Set(nextActions.map(a=>a.id)).size!==nextActions.length)throw failure('DUPLICATE_NEXT_ACTION','Action ids must be unique');
  const at=new Date().toISOString(),value={schema:'starforge.canadabuys.bid-decision.v1',noticeId:context.entry.noticeId,
   sourceEntryId:context.entry.id,profileId:context.profile.id,profileRevision:context.profile.revision,
   contextSha256,choice,rationale,owner:text(choose('owner',this.workspace.operator),'owner',256),
   nextActions,unknowns:strings(choose('unknowns',[]),'unknowns'),conditions:text(choose('conditions',''),'conditions',65536),
   reviewedBy,reviewedAt:administrative?current.reviewedAt:at,context,
   assessment:administrative?current.assessment:this._assessment(context,at),
   changes:administrative?current.changes:current?compareDecisionContext(current.context,context):null};
  return value;
 }
 createDecision(input){
  return this._command('decision.created',input,input.expectedRevision,()=>{
   const id=input.id||'decision-'+randomUUID();
   requireThat(ID.test(id)&&id.startsWith('decision-'),'INVALID_BIDDER_ID','Use an original decision UUID');
   requireThat(!this.db.prepare("SELECT 1 FROM bidder_records WHERE kind='decision' AND id=?").get(id),'BIDDER_RECORD_EXISTS','This decision already exists');
   const at=new Date().toISOString(),value={...this._decision(input),id,revision:1,createdAt:at,updatedAt:at,operator:this.workspace.operator};
   const record={...value,editionSha256:digest(value)};this._save('decision',record);
   return {value:{record},audit:{kind:'decision',id,noticeId:record.noticeId,revision:1,choice:record.choice}};
  });
 }
 updateDecision(id,input){
  return this._command('decision.updated',{...input,id},null,()=>{
   const current=this._record('decision',id);revision(input.expectedRevision,current.revision,'decision');
   const value={...this._decision(input,current),id,revision:current.revision+1,createdAt:current.createdAt,updatedAt:new Date().toISOString(),operator:this.workspace.operator};
   const record={...value,editionSha256:digest(value)};this._save('decision',record);
   return {value:{record},audit:{kind:'decision',id,noticeId:record.noticeId,revision:record.revision,choice:record.choice}};
  });
 }
 compareCurrent(id){
  return this.workspace._snapshot(()=>{
   const decision=this._record('decision',id),notice=this.workspace.getNotice(decision.noticeId),profile=this._record('profile',decision.profileId);
   const current=this._context({noticeId:decision.noticeId,sourceEntryId:notice.currentEntry.id,profileId:profile.id,profileRevision:profile.revision});
   return {decision:publicDecision(decision),changes:compareDecisionContext(decision.context,current),current,
    assessment:this._assessment(current,new Date().toISOString())};
  });
 }
 report(id,{revision:selectedRevision,format='html'}={}){
  return this.workspace._snapshot(()=>{
   const record=this._record('decision',id,selectedRevision),{context,assessment,changes,...decision}=record;
   const body=renderDecisionReport({decision,context,assessment,changes},{format});
   if(typeof body!=='string')throw failure('INVALID_DECISION_REPORT','The decision renderer did not produce complete text',500);
   return {body,mime:format==='html'?'text/html; charset=utf-8':format==='csv'?'text/csv; charset=utf-8':'application/json; charset=utf-8',
    filename:'canadabuys-decision-'+id+'-r'+record.revision+'.'+format};
  });
 }

 exportData({noticeIds=[],all=false}={}){
  return this.workspace._snapshot(()=>{
   const ids=new Set(noticeIds),selection=new Map();
   const include=(kind,id,rev)=>{
    const head=this._record(kind,id),cap=rev===undefined?head.revision:positive(rev,'export revision');
    requireThat(cap<=head.revision,'BIDDER_EXPORT_REVISION','A requested edition is not retained');
    const key=recordKey(kind,id),old=selection.get(key);
    if(!old||old.revision<cap){selection.set(key,{kind,id,revision:cap});return true;}return false;
   };
   for(const kind of KINDS)for(const head of this._all(kind))
    if(all||head.noticeId&&ids.has(head.noticeId))include(kind,head.id);
   let expanded=true;
   while(expanded){
    expanded=false;
    for(const selected of [...selection.values()])for(const edition of this._history(selected.kind,selected.id,selected.revision)){
     if(selected.kind==='decision'){
      expanded=include('profile',edition.context.profile.id,edition.context.profile.revision)||expanded;
      for(const item of edition.context.evidence)expanded=include('evidence',item.id,item.revision)||expanded;
      for(const item of edition.context.requirements)expanded=include('requirement',item.id,item.revision)||expanded;
     }
     if(selected.kind==='evidence'&&edition.localOrigin===RESPONSE_ORIGIN+edition.id){
      const bytes=this.evidenceFile(edition.id,{revision:edition.revision}).body;
      const document=responseDocument(edition,{sha256:edition.sha256,bytes:bytes.length,base64:bytes.toString('base64')});
      responseReviewModel.validateDocument(document);
      for(const merge of document.merges){
       requireThat(plain(merge.returnedRecord),'BIDDER_RESPONSE_DEPENDENCY_MISSING','A response return needs its complete original evidence reference');
       expanded=include('evidence',merge.returnedRecord.id,merge.returnedRecord.revision)||expanded;
      }
     }
     if(selected.kind==='requirement')for(const ref of [...edition.sourceEvidence,...edition.supplierEvidence])
      expanded=include('evidence',ref.evidenceId,ref.revision)||expanded;
     if(selected.kind==='profile')for(const id of new Set([...(edition.evidenceIds||[]),...(edition.qualificationClaims||[]).flatMap(c=>c.evidenceIds||[])])){
      if(!selection.has(recordKey('evidence',id)))expanded=include('evidence',id)||expanded;
     }
    }
   }
   const records=[...selection.values()].sort((a,b)=>recordKey(a.kind,a.id).localeCompare(recordKey(b.kind,b.id))).map(item=>({
    kind:item.kind,id:item.id,headRevision:item.revision,editions:this._history(item.kind,item.id,item.revision)
   }));
   const bodies=new Map();
   for(const group of records)if(group.kind==='evidence')for(const edition of group.editions)if(edition.accessState==='CAPTURED'){
    const body=this.evidenceFile(edition.id,{revision:edition.revision}).body;
    bodies.set(edition.sha256,{sha256:edition.sha256,bytes:body.length,base64:body.toString('base64')});
   }
   const commands=this.db.prepare('SELECT id,fingerprint,result FROM bidder_commands ORDER BY id').all().map(row=>({...row,result:JSON.parse(row.result)}))
    .filter(command=>{const record=command.result?.record;if(!record)return false;
     const group=selection.get(recordKey(record.id.split('-')[0],record.id));return group&&record.revision<=group.revision;});
   return sealBidderDesk(records,[...bodies.values()].sort((a,b)=>a.sha256.localeCompare(b.sha256)),commands);
  });
 }
 _validateIncoming(packet,selectedNoticeIds){
  validateDeskEnvelope(packet);
  const graph=new Map(packet.records.map(group=>[recordKey(group.kind,group.id),group]));
  const bodyMap=new Map(packet.bodies.map(body=>[body.sha256,body]));
  const member=(kind,id,rev)=>{
   const group=graph.get(recordKey(kind,id)),edition=group?.editions?.[rev-1];
   requireThat(edition&&edition.revision===rev,'BIDDER_DEPENDENCY_MISSING','A complete saved decision dependency is missing',{kind,id,revision:rev});
   return edition;
  };
  for(const group of packet.records){
   for(const edition of group.editions){
    if(['requirement','decision'].includes(group.kind))requireThat(selectedNoticeIds.has(edition.noticeId),'BIDDER_NOTICE_NOT_SELECTED','A saved record refers to an unselected notice');
    if(group.kind==='evidence'&&edition.accessState==='CAPTURED'){
     const body=bodyMap.get(edition.sha256);
     requireThat(body&&body.bytes===edition.bytes,'BIDDER_EVIDENCE_MISSING','A captured evidence edition needs its exact original bytes');
    }
    if(group.kind==='requirement')for(const ref of [...edition.sourceEvidence,...edition.supplierEvidence]){
     const evidence=member('evidence',ref.evidenceId,ref.revision);
     if(ref.sha256)requireThat(evidence.sha256===ref.sha256,'BIDDER_EVIDENCE_CHANGED','A requirement refers to different original evidence bytes');
    }
    if(group.kind==='profile')for(const id of new Set([...(edition.evidenceIds||[]),...(edition.qualificationClaims||[]).flatMap(c=>c.evidenceIds||[])]))
     requireThat(graph.has(recordKey('evidence',id)),'BIDDER_PROFILE_EVIDENCE_MISSING','Profile evidence must travel with its saved history');
    if(group.kind==='decision'){
     const context=edition.context;
     requireThat(plain(context)&&plain(context.entry)&&plain(context.source)&&plain(context.profile)&&Array.isArray(context.evidence)&&Array.isArray(context.requirements),
      'BIDDER_CONTEXT_REQUIRED','A decision needs its complete reviewed source and evidence context');
     requireThat(edition.contextSha256===sha256(canonical(context)),'BIDDER_CONTEXT_CHANGED','The complete decision context differs from its digest');
     const entry=this.workspace.getEntry(context.entry.id),source=this.workspace.getSource(entry.sourceId,{includeBody:false});
     requireThat(entry.noticeId===edition.noticeId&&entry.id===edition.sourceEntryId&&context.entry.noticeId===edition.noticeId&&
      entry.sourceId===context.entry.sourceId&&entry.rowNumber===context.entry.rowNumber&&entry.rowSha256===context.entry.rowSha256&&
      sha256(canonical(context.entry.row))===entry.rowSha256&&canonical(entry.row)===canonical(context.entry.row)&&
      context.source.id===source.id&&context.source.sha256===source.sha256&&context.source.bytes===source.bytes&&
      canonical(context.source.columns)===canonical(source.columns)&&
      ['summary','kind','solicitationKey','referenceKey'].every(key=>canonical(context.entry[key])===canonical(entry[key]))&&
      ['stream','rowCount','bodyKind','coverage','derivationSha256','derivation'].every(key=>canonical(context.source[key])===canonical(source[key])),'BIDDER_SOURCE_CHANGED','The reviewed notice differs from its retained original source');
     const profile=member('profile',edition.profileId,edition.profileRevision);
     requireThat(canonical(profile)===canonical(context.profile),'BIDDER_PROFILE_CHANGED','The reviewed capability profile differs from its saved edition');
     for(const evidence of context.evidence)requireThat(canonical(member('evidence',evidence.id,evidence.revision))===canonical(evidence),
      'BIDDER_EVIDENCE_CHANGED','Reviewed document metadata differs from its saved edition');
     for(const requirement of context.requirements)requireThat(requirement.noticeId===edition.noticeId&&canonical(member('requirement',requirement.id,requirement.revision))===canonical(requirement),
      'BIDDER_REQUIREMENT_CHANGED','Reviewed requirement differs from its saved edition');
     const {context:frozen,assessment,changes,...decision}=edition;
     renderDecisionReport({decision,context:frozen,assessment,changes},{format:'json'});
    }
   }
  }
  const usedBodies=new Set(packet.records.filter(g=>g.kind==='evidence').flatMap(g=>g.editions.filter(e=>e.accessState==='CAPTURED').map(e=>e.sha256)));
  requireThat(usedBodies.size===bodyMap.size&&[...bodyMap.keys()].every(hash=>usedBodies.has(hash)),
   'BIDDER_UNSELECTED_BODY','Every included document body must belong to a selected evidence edition');
 }
 receiveData(packet,{selectedNoticeIds}={}){
  if(this.workspace.depth<1)throw failure('BIDDER_TRANSACTION_REQUIRED','Receive decision records through the original workspace transaction',409);
  this._validateIncoming(packet,selectedNoticeIds);
  const conflicts=[];
  for(const group of packet.records){
   const current=this.db.prepare('SELECT data FROM bidder_records WHERE kind=? AND id=?').get(group.kind,group.id);
   if(!current)continue;
   const local=JSON.parse(current.data),overlap=Math.min(local.revision,group.headRevision);
   for(let index=0;index<overlap;index++){
    const original=this._record(group.kind,group.id,index+1);
    if(canonical(original)!==canonical(group.editions[index])){
     conflicts.push({kind:group.kind,id:group.id,revision:index+1,localSha256:original.editionSha256,incomingSha256:group.editions[index].editionSha256});break;
    }
   }
  }
  for(const command of packet.commands){
   const old=this.db.prepare('SELECT fingerprint,result FROM bidder_commands WHERE id=?').get(command.id);
   if(old&&(old.fingerprint!==command.fingerprint||canonical(JSON.parse(old.result))!==canonical(command.result)))
    conflicts.push({kind:'command',id:command.id,reason:'The same command id has a different saved input or result'});
  }
  if(conflicts.length)return {schema:BIDDER_DESK_SCHEMA,status:'REVIEW_REQUIRED',conflicts,incoming:packet,
   message:'Both complete histories are retained in this receiving record; existing authored decisions remain current.'};
  for(const body of packet.bodies){
   const old=this.db.prepare('SELECT body FROM bidder_evidence_bodies WHERE sha256=?').get(body.sha256);
   if(old)requireThat(sha256(Buffer.from(old.body))===body.sha256,'BIDDER_EVIDENCE_CHANGED','Existing evidence bytes differ from their retained identity');
   else this.db.prepare('INSERT INTO bidder_evidence_bodies(sha256,body) VALUES(?,?)').run(body.sha256,Buffer.from(body.base64,'base64'));
  }
  let editionsAdded=0,recordsAdded=0;
  for(const group of packet.records){
   const old=this.db.prepare('SELECT data FROM bidder_records WHERE kind=? AND id=?').get(group.kind,group.id);
   const first=old?JSON.parse(old.data).revision:0;if(!old)recordsAdded++;
   for(const edition of group.editions.filter(e=>e.revision>first)){this._save(group.kind,edition);editionsAdded++;}
  }
  let commandsAdded=0;
  for(const command of packet.commands){
   const result=this.db.prepare('INSERT OR IGNORE INTO bidder_commands(id,fingerprint,result) VALUES(?,?,?)').run(command.id,command.fingerprint,JSON.stringify(command.result));
   commandsAdded+=Number(result.changes);
  }
  return {schema:BIDDER_DESK_SCHEMA,status:'RECEIVED',packageSha256:packet.packageSha256,recordsAdded,editionsAdded,commandsAdded,conflicts:[]};
 }
}

function sealBidderDesk(records,bodies,commands=[]){
 const body={schema:BIDDER_DESK_SCHEMA,records,bodies,commands};
 return {...body,packageSha256:sha256(canonical(body))};
}
export function validateDeskEnvelope(packet){
 requireThat(plain(packet)&&packet.schema===BIDDER_DESK_SCHEMA&&Array.isArray(packet.records)&&Array.isArray(packet.bodies)&&Array.isArray(packet.commands),
  'BIDDER_PACKAGE_REQUIRED','Select a complete saved bidder desk package');
 const {packageSha256,...body}=packet;
 requireThat(HASH.test(packageSha256||'')&&sha256(canonical(body))===packageSha256,
  'BIDDER_PACKAGE_CHANGED','The complete saved bidder desk differs from its digest');
 const seen=new Set();
 for(const group of packet.records){
  requireThat(plain(group)&&KINDS.includes(group.kind)&&ID.test(group.id||'')&&group.id.startsWith(group.kind+'-')&&
   Number.isSafeInteger(group.headRevision)&&group.headRevision>0&&Array.isArray(group.editions)&&group.editions.length===group.headRevision,
   'BIDDER_HISTORY_REQUIRED','Every saved record needs all original editions through its selected head');
  const key=recordKey(group.kind,group.id);requireThat(!seen.has(key),'BIDDER_DUPLICATE_RECORD','The package repeats a saved record');seen.add(key);
  let original=null;
  for(let index=0;index<group.editions.length;index++){
   const edition=group.editions[index];
   requireThat(plain(edition)&&edition.id===group.id&&edition.revision===index+1&&edition.editionSha256===digest(edition),
    'BIDDER_EDITION_CHANGED','A saved edition differs from its original identity or complete digest');
   timestamp(edition.createdAt,'createdAt');timestamp(edition.updatedAt,'updatedAt');text(edition.operator,'operator',256);
   if(original)requireThat(edition.createdAt===original.createdAt&&edition.noticeId===original.noticeId,
    'BIDDER_RECORD_IDENTITY_CHANGED','Saved history changes its original notice or creation time');
   else original=edition;
   if(group.kind!=='decision'){
    const normalized=NORMALIZE[group.kind](fields(group.kind,edition));
    requireThat(canonical(fields(group.kind,normalized))===canonical(fields(group.kind,edition))&&edition.schema===normalized.schema,
     'BIDDER_FIELDS_CHANGED','Saved fields do not match their declared domain schema');
   }else{
    requireThat(edition.schema==='starforge.canadabuys.bid-decision.v1'&&['BID','NO_BID','INVESTIGATE','PARK'].includes(edition.choice)&&
     typeof edition.rationale==='string'&&edition.rationale.trim()&&Array.isArray(edition.nextActions)&&Array.isArray(edition.unknowns)&&
     typeof edition.reviewedBy==='string'&&edition.reviewedBy.trim(),'BIDDER_DECISION_INVALID','The saved decision lacks its original choice, review or rationale');
    timestamp(edition.reviewedAt,'reviewedAt');
   }
  }
 }
 const commandIds=new Set(),graph=new Map(packet.records.map(group=>[recordKey(group.kind,group.id),group]));
 const responseBodies=new Map(packet.bodies.map(body=>[body.sha256,body]));
 for(const command of packet.commands){
  requireThat(plain(command)&&typeof command.id==='string'&&command.id.trim()&&command.id.length<=256&&
   HASH.test(command.fingerprint||'')&&plain(command.result)&&plain(command.result.record)&&!commandIds.has(command.id),
   'BIDDER_COMMAND_INVALID','Every saved command needs its unique id, input fingerprint and original result');
  const record=command.result.record,kind=typeof record.id==='string'?record.id.split('-')[0]:'';
  const edition=graph.get(recordKey(kind,record.id))?.editions?.[record.revision-1];
  requireThat(edition&&canonical(command.result.record)===canonical(edition),
   'BIDDER_COMMAND_RESULT_CHANGED','The saved command result differs from its selected original record edition');
  validateResponseCommand(command,edition,graph,responseBodies);
  commandIds.add(command.id);
 }
 const hashes=new Set();
 for(const item of packet.bodies){
  requireThat(plain(item)&&HASH.test(item.sha256||'')&&!hashes.has(item.sha256)&&Number.isSafeInteger(item.bytes)&&item.bytes>=0&&typeof item.base64==='string',
   'BIDDER_BODY_INVALID','Every original document needs one complete byte descriptor');
  const raw=Buffer.from(item.base64,'base64');
  requireThat(raw.length===item.bytes&&raw.toString('base64')===item.base64&&sha256(raw)===item.sha256,
   'BIDDER_BODY_CHANGED','A captured document differs from its complete original bytes');
  hashes.add(item.sha256);
 }
 return packet;
}
export function mergeBidderDeskPackages(packets){
 const groups=new Map(),bodies=new Map(),commands=new Map();
 for(const packet of packets.filter(Boolean)){
  validateDeskEnvelope(packet);
  for(const group of packet.records){
   const key=recordKey(group.kind,group.id),old=groups.get(key);
   if(old){
    const overlap=Math.min(old.headRevision,group.headRevision);
    for(let index=0;index<overlap;index++)requireThat(canonical(old.editions[index])===canonical(group.editions[index]),
     'BIDDER_DELIVERY_HISTORY_CONFLICT','Delivered packages contain different editions of the same saved record');
   }
   if(!old||group.headRevision>old.headRevision)groups.set(key,group);
  }
  for(const command of packet.commands){
   const old=commands.get(command.id);
   requireThat(!old||canonical(old)===canonical(command),'BIDDER_DELIVERY_COMMAND_CONFLICT','Delivered packages disagree on the original command result');
   commands.set(command.id,command);
  }
  for(const body of packet.bodies){
   const old=bodies.get(body.sha256);
   requireThat(!old||canonical(old)===canonical(body),'BIDDER_DELIVERY_BODY_CONFLICT','Delivered packages disagree on original evidence bytes');
   bodies.set(body.sha256,body);
  }
 }
 return sealBidderDesk([...groups.values()].sort((a,b)=>recordKey(a.kind,a.id).localeCompare(recordKey(b.kind,b.id))),
  [...bodies.values()].sort((a,b)=>a.sha256.localeCompare(b.sha256)),[...commands.values()].sort((a,b)=>a.id.localeCompare(b.id)));
}
