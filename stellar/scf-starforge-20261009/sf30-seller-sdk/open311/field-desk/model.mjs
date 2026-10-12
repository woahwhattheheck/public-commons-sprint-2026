// MIT. Deterministic field-desk transitions shared by SQLite writes and complete receiving.
import { canonical, copy, digest, equal, fail, object, text, instant, parseJson, entityId, seal, verifySeal, uniqueStrings, page, MAX_PACKAGE_BYTES } from '../gis/shared.mjs';
import { SOURCE_SCHEMA, createSource, sourceSummary, sourceDetail, sourceRow, sourceRows, rowBinding, inspectSource } from './source.mjs';
import { CREW_SCHEMA,VISIT_SCHEMA,ATTACHMENT_SCHEMA,ATTACHMENT_ALIAS_SCHEMA,PACKAGE_SCHEMA,RETURN_SCHEMA,DECISION_SCHEMA,REVIEW_SCHEMA,UPDATE_SCHEMA,
  createCrew,createVisit,visitSummary,decodeAttachment,createAttachment,attachmentSummary,attachmentExport,createPackage,packageSummary,createReturn,returnSummary,
  proposalChanges,assignmentChanged,applyProposal,sourceContext,sameSourceContext,createUpdate,updateSummary,choice } from './domain.mjs';

export const WORKSPACE_SCHEMA='commons.open311.field-desk-workspace.v1';
export const DATABASE_SCHEMA='commons.open311.field-desk-database.v1';
export const KINDS=['source','crew','visit','attachment','attachment-name','package','return','decision','review','update'];
export const SCHEMAS={source:SOURCE_SCHEMA,crew:CREW_SCHEMA,visit:VISIT_SCHEMA,attachment:ATTACHMENT_SCHEMA,'attachment-name':ATTACHMENT_ALIAS_SCHEMA,package:PACKAGE_SCHEMA,return:RETURN_SCHEMA,decision:DECISION_SCHEMA,review:REVIEW_SCHEMA,update:UPDATE_SCHEMA};
export const recordId=(kind,value)=>kind==='crew'||kind==='visit'?value.versionId:value.id;
export function recordSummary(kind,value){
  if(kind==='source')return sourceSummary(value);
  if(kind==='visit')return visitSummary(value);
  if(kind==='attachment')return attachmentSummary(value);
  if(kind==='package')return packageSummary(value);
  if(kind==='return')return returnSummary(value);
  if(kind==='update')return updateSummary(value);
  return copy(value);
}
export function control(input){
  object(input,'Field-desk action');text(input.requestId,'Stable request ID',200);
  if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)fail('EXPECTED_REVISION_REQUIRED','Supply the observed workspace revision.');
  return copy(input);
}
export function validateHostInput(input,kind,raw){
  if(input.hostInput===undefined)return;
  const host=object(input.hostInput,'Original host input');text(host.alias,'Original host input alias',200);
  if(host.kind!==kind||host.format!==(kind==='attachment'?'binary':'json')||!/^[a-f0-9]{64}$/.test(host.sha256??''))fail('HOST_INPUT_IDENTITY','Keep the original named host file kind, format and SHA-256.');
  if(digest(raw)!==host.sha256)fail('HOST_INPUT_CHANGED','The original named host input differs from the bytes supplied for this action.',409,{alias:host.alias});
  if(host.contentType!==undefined)text(host.contentType,'Host input media type',300);
}
export function fingerprint(kind,input){const {expectedRevision,...intent}=input;return digest({kind,intent});}
export function paginated(rows,selection={}){
  const result=page(rows,selection);return {...result,nextOffset:result.offset+result.items.length<result.total?result.offset+result.items.length:null};
}
export function memoryRecords(initial=[]){
  const records=[],maps=Object.fromEntries(KINDS.map(kind=>[kind,new Map()])),ordered=Object.fromEntries(KINDS.map(kind=>[kind,[]]));
  const adapter={
    all:kind=>ordered[kind].map(copy),
    find:(kind,id)=>maps[kind].has(id)?copy(maps[kind].get(id)):null,
    save:(kind,value)=>{const id=recordId(kind,value);if(!maps[kind]||maps[kind].has(id))fail('DUPLICATE_RECORD','A field record identity is repeated.',409,{kind,id});const copied=copy(value);maps[kind].set(id,copied);ordered[kind].push(copied);records.push({kind,id,value:copied});},
    records:()=>copy(records)
  };
  for(const record of initial){if(!KINDS.includes(record.kind)||record.id!==recordId(record.kind,record.value))fail('INVALID_RECORD','The record kind or identity differs.');adapter.save(record.kind,record.value);}
  return adapter;
}
export class FieldModel{
  constructor(adapter,metadata){this.adapter=adapter;this.metadata=metadata;this.cache=new Map();}
  all(kind){if(!this.cache.has(kind))this.cache.set(kind,this.adapter.all(kind));return this.cache.get(kind);}
  find(kind,id){return this.adapter.find(kind,id);}
  get(kind,id){text(id,'Saved '+kind+' ID',500);const value=this.find(kind,id);if(!value)fail('RECORD_NOT_FOUND','The saved '+kind+' was not found.',404,{id});return value;}
  save(kind,value){this.adapter.save(kind,value);this.cache.delete(kind);return value;}
  current(kind,id){const values=this.all(kind);for(let i=values.length-1;i>=0;i--)if(values[i].id===id)return values[i];return null;}
  requireCurrent(kind,id){text(id,kind+' ID',200);const value=this.current(kind,id);if(!value)fail('RECORD_NOT_FOUND','The saved '+kind+' was not found.',404,{id});return value;}
  latest(kind){const map=new Map();for(const value of this.all(kind))map.set(value.id,value);return [...map.values()];}
  source(id){return sourceDetail(this.get('source',id));}
  sourceRows(selection){const source=this.get('source',selection.sourceId);return paginated(sourceRows(source,selection),selection);}
  crew(id){const crew=this.requireCurrent('crew',id);return {crew,history:this.all('crew').filter(v=>v.id===id)};}
  attachmentsFor(ids){
    return ids.map(id=>{const file=this.get('attachment',id),aliases=this.all('attachment-name').filter(v=>v.attachmentId===id).map(v=>({filename:v.filename,contentType:v.contentType,createdAt:v.createdAt}));return attachmentExport(file,aliases);});
  }
  approval(visit){
    let latest=null;
    for(const review of this.all('review'))for(const selection of review.selections)if(selection.visitId===visit.id)latest={...copy(selection),reviewId:review.id,reviewer:review.reviewer,createdAt:review.createdAt,reviewNote:review.note,returnId:review.returnId??null,decisionId:review.decisionId??null};
    if(!latest)return null;
    const context=sourceContext(visit,this.all('source'));
    return {...latest,current:latest.outcome==='approve'&&latest.versionId===visit.versionId&&sameSourceContext(latest.sourceContext,context)};
  }
  visit(id){
    const visit=this.requireCurrent('visit',id),source=this.get('source',visit.sourceId);
    return {visit,sourceRow:sourceRow(source,visit.sourceKey),source:sourceSummary(source),crew:visit.crewVersionId?this.get('crew',visit.crewVersionId):null,history:this.all('visit').filter(v=>v.id===id),
      attachments:this.attachmentsFor(visit.field.attachmentIds).map(({contentBase64,...rest})=>rest),approval:this.approval(visit),sourceChange:sourceContext(visit,this.all('source'))};
  }
  visits(selection={}){
    for(const key of ['sourceId','crewId','status','q'])if(selection[key]!==undefined&&typeof selection[key]!=='string')fail('INVALID_FILTER','Visit filters must be text.');
    const terms=(selection.q??'').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean),sources=this.all('source');
    const rows=this.latest('visit').filter(v=>(!selection.sourceId||v.sourceId===selection.sourceId)&&(!selection.crewId||v.crewId===selection.crewId)&&(!selection.status||v.field.status===selection.status)).filter(v=>{
      const haystack=[v.serviceRequestId,v.title,v.crewName,v.instructions,v.field.completionNote,...v.field.notes.map(n=>n.text)].join(' ').toLocaleLowerCase();return terms.every(t=>haystack.includes(t));
    }).map(v=>({...visitSummary(v),sourceChanged:sourceContext(v,sources).changed,approval:this.approval(v)}));
    return paginated(rows,selection);
  }
  package(id){return {package:this.get('package',id)};}
  update(id){return {update:this.get('update',id)};}
  proposalStatus(returnId,proposalId){
    for(const decision of this.all('decision'))if(decision.returnId===returnId){const item=decision.decisions.find(v=>v.proposalId===proposalId);if(item)return {status:item.choice==='accept'?'accepted':'rejected',decisionId:decision.id};}
    return {status:'pending',decisionId:null};
  }
  returned(id){
    const returned=this.get('return',id),packet=this.get('package',returned.packageId),sources=this.all('source'),decisions=this.all('decision').filter(d=>d.returnId===id);
    const proposals=returned.proposals.map(proposal=>{
      const base=packet.visits.find(e=>e.visit.id===proposal.visitId).visit,current=this.requireCurrent('visit',proposal.visitId),context=sourceContext(current,sources);
      return {...copy(proposal),currentVersionId:current.versionId,...this.proposalStatus(id,proposal.id),changes:proposalChanges(proposal,base,current),
        sourceChange:{...context,packageSourceChanged:!equal(base.source,current.source),changed:context.changed||!equal(base.source,current.source)},assignmentChanged:assignmentChanged(base,current)};
    });
    return {return:{...returnSummary(returned),pending:proposals.filter(p=>p.status==='pending').length},package:packageSummary(packet),proposals,decisions,originalFile:copy(returned.originalFile)};
  }
  state(operations=[]){
    const visits=this.latest('visit'),returns=this.all('return').map(v=>({...returnSummary(v),pending:v.proposals.filter(p=>this.proposalStatus(v.id,p.id).status==='pending').length}));
    return {schema:WORKSPACE_SCHEMA,...copy(this.metadata),schema:WORKSPACE_SCHEMA,sources:this.all('source').map(sourceSummary),crews:this.latest('crew'),packages:this.all('package').map(packageSummary),returns,updates:this.all('update').map(updateSummary),
      counts:{sources:this.all('source').length,crews:this.latest('crew').length,visits:visits.length,packages:this.all('package').length,returns:returns.length,pendingProposals:returns.reduce((n,r)=>n+r.pending,0),updates:this.all('update').length,attachments:this.all('attachment').length,fieldStatuses:Object.fromEntries(['planned','assigned','in_progress','completed','unable','cancelled'].map(status=>[status,visits.filter(v=>v.field.status===status).length]))},
      operations:copy(operations)};
  }
  apply(kind,input,createdAt){
    control(input);instant(createdAt,'Operation time');
    if(kind==='source-import')validateHostInput(input,'source',input.originalText);
    if(kind==='return-import')validateHostInput(input,'return',input.originalText);
    if(kind==='attachment-save'){const decoded=decodeAttachment(input.attachment);validateHostInput(input,'attachment',Buffer.from(decoded.contentBase64,'base64'));if(input.hostInput?.contentType!==undefined&&input.hostInput.contentType!==decoded.contentType)fail('HOST_INPUT_MEDIA_MISMATCH','The attachment media type differs from its declared host file.',409);}
    const identity={workspaceId:this.metadata.workspaceId,revision:this.metadata.revision+1,createdAt},id=(prefix,part=null)=>entityId(prefix,{workspaceId:this.metadata.workspaceId,requestId:input.requestId,part});
    const fileSave=original=>{
      const decoded=decodeAttachment(original),existing=this.find('attachment',decoded.id);
      const attachment=existing??this.save('attachment',createAttachment(original,{createdAt}));
      if(attachment.contentSha256!==decoded.sha256||attachment.bytes!==decoded.bytes||attachment.contentBase64!==decoded.contentBase64)fail('ATTACHMENT_HASH_COLLISION','The retained bytes differ for this file hash.');
      const aliasId=entityId('file-name',{attachmentId:attachment.id,filename:decoded.filename,contentType:decoded.contentType});
      if(!this.find('attachment-name',aliasId))this.save('attachment-name',seal({schema:ATTACHMENT_ALIAS_SCHEMA,id:aliasId,attachmentId:attachment.id,filename:decoded.filename,contentType:decoded.contentType,createdAt}));
      return {attachment:{...attachmentSummary(attachment),filename:decoded.filename,contentType:decoded.contentType},duplicate:!!existing};
    };
    const requireFiles=field=>{for(const fileId of field.attachmentIds)this.get('attachment',fileId);};
    if(kind==='source-import'){
      const source=createSource(input,{id:id('field-source'),createdAt});
      for(const existing of this.all('source'))if(existing.seriesId===source.seriesId&&existing.originWorkspaceId&&source.originWorkspaceId&&existing.originWorkspaceId!==source.originWorkspaceId)fail('SOURCE_SERIES_COLLISION','This follow-through series is already bound to another original workspace.',409);
      this.save('source',source);return {source:sourceSummary(source)};
    }
    if(kind==='crew-save'){
      const proposed=object(input.crew,'Crew'),crewId=proposed.id?text(proposed.id,'Crew ID',200):id('crew'),previous=this.current('crew',crewId);
      const crew=createCrew(proposed,{id:crewId,versionId:id('crew-version'),createdAt},previous);this.save('crew',crew);return {crew};
    }
    if(kind==='visit-save'){
      const proposed=object(input.visit,'Visit'),visitId=proposed.id?text(proposed.id,'Visit ID',200):id('visit'),previous=this.current('visit',visitId),source=this.get('source',proposed.sourceId),row=sourceRow(source,proposed.sourceKey);
      const crew=proposed.crewId?this.requireCurrent('crew',proposed.crewId):null;
      const visit=createVisit(proposed,{id:visitId,versionId:id('visit-version'),createdAt},{previous,source,row,crew,cause:{kind:'visit-save',requestId:input.requestId}});requireFiles(visit.field);
      this.save('visit',visit);return {visit:visitSummary(visit)};
    }
    if(kind==='attachment-save')return fileSave(input.attachment);
    if(kind==='package-create'){
      const visitIds=uniqueStrings(input.visitIds,'Crew visit selection',{empty:false}),entries=visitIds.map(visitId=>{
        const visit=this.requireCurrent('visit',visitId),source=this.get('source',visit.sourceId);
        return {visit,sourceRow:sourceRow(source,visit.sourceKey),source:sourceSummary(source),crew:visit.crewVersionId?this.get('crew',visit.crewVersionId):null};
      }),attachmentIds=[...new Set(entries.flatMap(e=>e.visit.field.attachmentIds))],packet=createPackage(input,{...identity,id:id('crew-package')},entries,this.attachmentsFor(attachmentIds));
      if(Buffer.byteLength(canonical(packet))>MAX_PACKAGE_BYTES)fail('PACKAGE_SIZE','The selected crew package exceeds 256 MiB.',413);
      this.save('package',packet);return {package:packageSummary(packet)};
    }
    if(kind==='return-import'){
      if(typeof input.originalText!=='string'||Buffer.byteLength(input.originalText)>MAX_PACKAGE_BYTES)fail('RETURN_SIZE','Use one complete partial return of at most 256 MiB.',413);
      const parsed=parseJson(input.originalText,'Original crew return'),packet=this.get('package',parsed.packageId),returned=createReturn(parsed,packet,{id:id('field-return'),createdAt,originalText:input.originalText,name:input.name});
      for(const attachment of parsed.attachments??[])fileSave(attachment);
      for(const proposal of returned.proposals){const base=packet.visits.find(v=>v.visit.id===proposal.visitId).visit;requireFiles({...base.field,...proposal.fields});}
      this.save('return',returned);return {return:{...returnSummary(returned),pending:returned.proposals.length}};
    }
    if(kind==='return-decide'){
      const returned=this.get('return',input.returnId),packet=this.get('package',returned.packageId),reviewer=text(input.reviewer,'Supervisor reviewer',300),note=text(input.note??'','Supervisor note',100000,{empty:true});
      if(!Array.isArray(input.decisions)||!input.decisions.length||input.decisions.length>returned.proposals.length)fail('DECISION_SELECTION_REQUIRED','Select pending returned visits for an explicit supervisor decision.');
      const seen=new Set(),decisions=[],reviewSelections=[],decisionId=id('field-decision'),reviewId=id('field-review');
      for(const selection of input.decisions){
        object(selection,'Supervisor decision');const proposal=returned.proposals.find(p=>p.id===selection.proposalId);
        if(!proposal||seen.has(proposal.id))fail('UNKNOWN_PROPOSAL','Select each original return proposal at most once.');seen.add(proposal.id);
        if(this.proposalStatus(returned.id,proposal.id).status!=='pending')fail('PROPOSAL_ALREADY_DECIDED','This returned visit already has a saved supervisor decision.',409,{proposalId:proposal.id});
        const current=this.requireCurrent('visit',proposal.visitId),base=packet.visits.find(v=>v.visit.id===proposal.visitId).visit;
        if(selection.expectedVisitVersionId!==current.versionId)fail('VISIT_VERSION_CHANGED','Review the current visit version before applying this return.',409,{visitId:current.id,currentVersionId:current.versionId});
        const selected=choice(selection.choice,['accept','reject'],'Supervisor decision'),selectionNote=text(selection.note??'','Decision note',100000,{empty:true}),context=sourceContext(current,this.all('source')),sourceChanged=context.changed||!equal(base.source,current.source),changedAssignment=assignmentChanged(base,current);
        const detail={proposalId:proposal.id,visitId:current.id,choice:selected,expectedVisitVersionId:current.versionId,baseVersionId:base.versionId,note:selectionNote,sourceChange:{...context,packageSourceChanged:!equal(base.source,current.source)},assignmentChanged:changedAssignment,acknowledgeSourceChange:selection.acknowledgeSourceChange===true,acknowledgeAssignmentChange:selection.acknowledgeAssignmentChange===true};
        if(selected==='reject'){decisions.push({...detail,resultVersionId:current.versionId,applied:[]});continue;}
        if(sourceChanged&&selection.acknowledgeSourceChange!==true)fail('SOURCE_CHANGE_ACK_REQUIRED','Acknowledge the changed original dispatch/request context before accepting this field return.',409,{proposalId:proposal.id,sourceChange:detail.sourceChange});
        if(changedAssignment&&selection.acknowledgeAssignmentChange!==true)fail('ASSIGNMENT_CHANGE_ACK_REQUIRED','Acknowledge the changed assignment or visit plan before accepting this return.',409,{proposalId:proposal.id});
        const applied=applyProposal(proposal,base,current,selection);requireFiles(applied.field);let visit=current;
        if(!equal(applied.field,current.field)){
          const source=this.get('source',current.sourceId),row=sourceRow(source,current.sourceKey),crew=current.crewVersionId?this.get('crew',current.crewVersionId):null;
          visit=createVisit({...current,field:applied.field},{id:current.id,versionId:id('visit-version',proposal.id),createdAt},{previous:current,source,row,crew,cause:{kind:'return-decision',returnId:returned.id,decisionId,proposalId:proposal.id}});
          this.save('visit',visit);
        }
        decisions.push({...detail,resultVersionId:visit.versionId,applied:applied.applied});
        reviewSelections.push({visitId:visit.id,versionId:visit.versionId,outcome:'approve',note:selectionNote,sourceContext:sourceContext(visit,this.all('source')),acknowledgeSourceChange:sourceChanged});
      }
      const decision=seal({schema:DECISION_SCHEMA,id:decisionId,returnId:returned.id,reviewer,note,createdAt,decisions,reviewId:reviewSelections.length?reviewId:null});
      this.save('decision',decision);
      if(reviewSelections.length)this.save('review',seal({schema:REVIEW_SCHEMA,id:reviewId,reviewer,note,createdAt,returnId:returned.id,decisionId,selections:reviewSelections}));
      return {decision,return:{...returnSummary(returned),pending:returned.proposals.filter(p=>this.proposalStatus(returned.id,p.id).status==='pending').length}};
    }
    if(kind==='visit-review'){
      const reviewer=text(input.reviewer,'Supervisor reviewer',300),note=text(input.note??'','Supervisor note',100000,{empty:true});
      if(!Array.isArray(input.selections)||!input.selections.length)fail('REVIEW_SELECTION_REQUIRED','Select exact saved visit versions for supervisor review.');
      const seen=new Set(),selections=input.selections.map(selection=>{
        object(selection,'Visit review');const visit=this.requireCurrent('visit',selection.visitId);
        if(seen.has(visit.id))fail('DUPLICATE_REVIEW_VISIT','Select a visit only once per supervisor review.');seen.add(visit.id);
        if(selection.expectedVersionId!==visit.versionId)fail('VISIT_VERSION_CHANGED','The visit changed after it was selected for review.',409,{visitId:visit.id,currentVersionId:visit.versionId});
        const outcome=choice(selection.outcome,['approve','return_to_crew'],'Supervisor outcome'),context=sourceContext(visit,this.all('source'));
        if(outcome==='approve'&&context.changed)fail('SOURCE_REBIND_REQUIRED','Select the successor source explicitly on this visit before approving its new work, or decide the returned work with an explicit source-change acknowledgement.',409,{visitId:visit.id,sourceChange:context});
        return {visitId:visit.id,versionId:visit.versionId,outcome,note:text(selection.note??'','Visit review note',100000,{empty:true}),sourceContext:context,acknowledgeSourceChange:false};
      });
      const review=seal({schema:REVIEW_SCHEMA,id:id('field-review'),reviewer,note,createdAt,returnId:null,decisionId:null,selections});this.save('review',review);return {review};
    }
    if(kind==='update-create'){
      if(!Array.isArray(input.items)||!input.items.length)fail('UPDATE_SELECTION_REQUIRED','Select exact approved visit versions for the destination update.');
      const seen=new Set(),entries=input.items.map(selection=>{
        object(selection,'Destination item');const visit=this.requireCurrent('visit',selection.visitId);
        if(seen.has(visit.id))fail('DUPLICATE_UPDATE_VISIT','Select each visit once in the update package.');seen.add(visit.id);
        if(selection.expectedVersionId!==visit.versionId)fail('VISIT_VERSION_CHANGED','The visit changed before the destination package was prepared.',409,{visitId:visit.id,currentVersionId:visit.versionId});
        const approval=this.approval(visit);if(!approval?.current)fail('SUPERVISOR_APPROVAL_REQUIRED','Each selected visit needs supervisor approval of this exact field and source version.',409,{visitId:visit.id});
        const action=choice(selection.action,['update','request_closure'],'Destination action');
        if(action==='request_closure'&&visit.field.status!=='completed')fail('COMPLETED_VISIT_REQUIRED','A closure request requires completed field work and its current supervisor approval.',409,{visitId:visit.id});
        const source=this.get('source',visit.sourceId),row=sourceRow(source,visit.sourceKey);
        return {id:entityId('update-item',{updateId:id('field-update'),visitId:visit.id}),action,destinationReference:text(selection.destinationReference??'','Destination item reference',2000,{empty:true}),note:text(selection.note??'','Destination item note',100000,{empty:true}),visit,source:sourceSummary(source),sourceRow:row,dispatchDefinition:copy(source.dispatch.definition),sourceBinding:rowBinding(source,row),approval,crew:visit.crewVersionId?this.get('crew',visit.crewVersionId):null};
      }),attachmentIds=[...new Set(entries.flatMap(e=>e.visit.field.attachmentIds))],update=createUpdate(input,{...identity,id:id('field-update')},entries,this.attachmentsFor(attachmentIds));
      if(Buffer.byteLength(canonical(update))>MAX_PACKAGE_BYTES)fail('PACKAGE_SIZE','This destination update exceeds 256 MiB.',413);
      this.save('update',update);return {update:updateSummary(update)};
    }
    fail('UNKNOWN_ACTION','This field-desk action is unsupported.',400,{kind});
  }
}
export function validateWorkspacePackage(originalText){
  if(typeof originalText!=='string'||Buffer.byteLength(originalText)>MAX_PACKAGE_BYTES)fail('PACKAGE_SIZE','Receive one complete field workspace of at most 256 MiB.',413);
  const bundle=verifySeal(parseJson(originalText,'Complete field-desk workspace'),WORKSPACE_SCHEMA);
  text(bundle.workspaceId,'Original workspace ID',200);
  for(const key of ['createdAt','updatedAt','exportedAt'])instant(bundle[key],key);
  if(!Number.isSafeInteger(bundle.revision)||bundle.revision<0||!Array.isArray(bundle.records)||!Array.isArray(bundle.operations)||bundle.operations.length!==bundle.revision||!Array.isArray(bundle.receivedFrom))fail('INCOMPLETE_WORKSPACE','Keep the complete field source, file, version and operation history.');
  const adapter=memoryRecords(),meta={schema:DATABASE_SCHEMA,workspaceId:bundle.workspaceId,revision:0,createdAt:bundle.createdAt,updatedAt:bundle.createdAt,receivedFrom:[]},seen=new Set(),receipts=[];
  for(let index=0;index<bundle.operations.length;index++){
    const operation=bundle.operations[index];object(operation,'Original operation');control(operation.input);instant(operation.createdAt,'Original operation time');
    if(seen.has(operation.requestId)||operation.requestId!==operation.input.requestId||operation.state!=='SUCCEEDED'||operation.inputSha256!==fingerprint(operation.kind,operation.input)||operation.result?.requestId!==operation.requestId||operation.result?.workspaceId!==bundle.workspaceId||operation.result?.revision!==index+1)fail('OPERATION_HISTORY_MISMATCH','An original operation identity, result or revision is inconsistent.');
    seen.add(operation.requestId);let expected;
    if(operation.kind==='workspace-receive'){
      const originalFile=operation.input.originalFile;
      if(!originalFile||!/^[a-f0-9]{64}$/.test(originalFile.sha256??'')||!Number.isSafeInteger(originalFile.bytes)||originalFile.bytes<0||originalFile.bytes>MAX_PACKAGE_BYTES||!/^[a-f0-9]{64}$/.test(operation.input.incomingPackageSha256??'')||operation.result.packageSha256!==operation.input.incomingPackageSha256)fail('RECEIVE_HISTORY_MISMATCH','An original receiving descriptor is incomplete.');
      const receipt=operation.result.receivedFrom;object(receipt,'Receiving history');if(receipt.requestId!==operation.requestId||receipt.originalFile.sha256!==originalFile.sha256||receipt.packageSha256!==operation.input.incomingPackageSha256)fail('RECEIVE_HISTORY_MISMATCH','An original receiving receipt differs from its retained file.');
      receipts.push(copy(receipt));expected=copy(operation.result);
    }else{
      if(operation.input.expectedRevision!==index)fail('OPERATION_REVISION_MISMATCH','A saved field action did not continue its original observed revision.');
      const model=new FieldModel(adapter,meta),result=model.apply(operation.kind,operation.input,operation.createdAt);
      expected={workspaceId:bundle.workspaceId,revision:index+1,requestId:operation.requestId,...result};
    }
    if(!equal(expected,operation.result))fail('OPERATION_RESULT_MISMATCH','A saved field result differs from replaying its complete original inputs.',400,{requestId:operation.requestId,kind:operation.kind});
    meta.revision=index+1;meta.updatedAt=operation.createdAt;
  }
  if(!equal(adapter.records(),bundle.records))fail('RECORD_HISTORY_MISMATCH','The complete field records differ from their original source and operation history.');
  if(!equal(receipts,bundle.receivedFrom)||bundle.updatedAt!==meta.updatedAt)fail('WORKSPACE_HISTORY_MISMATCH','The workspace metadata differs from its original successful operations.');
  return bundle;
}
