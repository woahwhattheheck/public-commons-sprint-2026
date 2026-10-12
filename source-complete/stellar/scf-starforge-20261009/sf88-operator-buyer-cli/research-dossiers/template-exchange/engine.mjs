// MIT. Source-bound workbook exchange composed into the original dossier.
import {digest as rawDigest,jsonBytes} from '../../node/store.mjs';
import {extractionInput,extractionTypedValue} from '../study-extraction.mjs';
import {inspectWorkbook,patchWorkbook,workbookFilename,hashBytes,requireValue,checkTemplateSignal,cellAt,cellColumn,cellRow,valueText} from './workbook.mjs';
import {TEMPLATE_SCHEMA,TEMPLATE_OPERATION_SCHEMA,TEMPLATE_EVENT_FIELD,TEMPLATE_SECTIONS,
  input,digest,clone,same,object,text,descriptor,model,eventId,sourceContext,mappingBindings,
  validateTemplateExchangeState,templateExchangeBlobs} from './contracts.mjs';
import {compareReturn,reviewedDecisions,returnedTypedValue} from './compare.mjs';
export {TEMPLATE_SCHEMA,TEMPLATE_EVENT_FIELD,TEMPLATE_SECTIONS,validateTemplateExchangeState,templateExchangeBlobs};
const find=(rows,id,code)=>{const item=rows.find(r=>r.id===id);requireValue(item,code);return item;};
const latest=(rows,predicate)=>rows.filter(predicate).at(-1)??null;
const jsonBuffer=value=>Buffer.from(JSON.stringify(value)+'\n','utf8');
const uniqueBlobs=rows=>[...new Map(rows.map(d=>{const x=descriptor(d);return [x.sha256,x];})).values()];
const savedFields=state=>Object.fromEntries(Object.entries(state).filter(([key])=>!['revision','previous','updatedAt','change'].includes(key)));
const inspectionSemantics=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!['sha256','bytes','filename'].includes(key)));
const common=(state,request,createdAt)=>({actor:clone(request.actor),createdAt,originalRevision:state.revision,revision:state.revision+1});
export function publicationFor(state,id){
  const rows=(state.extractionPublicationEvents??[]).map(e=>e.result?.publication).filter(Boolean);
  const publication=find(rows,id,'TEMPLATE_PUBLICATION_NOT_FOUND');
  const {sha256,...body}=publication;
  requireValue(sha256===digest(body),'TEMPLATE_PUBLICATION_CHANGED');
  const withdrawal=(state.extractionPublicationEvents??[]).map(e=>e.result?.withdrawal).filter(Boolean).find(r=>r.publicationId===id);
  const successor=rows.find(r=>r.previousPublicationId===id);
  return {publication:clone(publication),status:withdrawal?'withdrawn':successor?'superseded':'published',
    withdrawal:clone(withdrawal??null),successorId:successor?.id??null};
}
export function newerSourceReview(state,publication){
  const nativeChanges=[];
  for(const family of ['extractionEvents','eligibilityEvents','extractionPublicationEvents']){
    for(const event of state[family]??[])if(event.revision>publication.revision)nativeChanges.push({
      family,operationId:event.id,action:event.action,revision:event.revision,actor:clone(event.actor),createdAt:event.createdAt});
  }
  const sourceEditions=(state.editions??[]).filter(e=>(e.revision??e.originalRevision??0)>publication.revision)
    .map(e=>({id:e.id,label:e.label,provider:e.provider,mode:e.mode,revision:e.revision??null}));
  return {publicationRevision:publication.revision,currentRevision:state.revision,nativeChanges,sourceEditions,
    acknowledgementRequired:nativeChanges.length>0||sourceEditions.length>0,
    meaning:'These retained operations postdate the frozen publication. Review their original impact and result views before releasing this historical selection.'};
}
function io(readContent,options={}){
  requireValue(typeof readContent==='function','TEMPLATE_SOURCE_READER_REQUIRED');
  const cache=options.cache??new Map(),check=()=>checkTemplateSignal(options.signal);
  check();
  async function bytes(metadata){
    check();
    const d=descriptor(metadata),body=await readContent(d);
    check();
    requireValue(Buffer.isBuffer(body)&&body.length===d.bytes&&hashBytes(body)===d.sha256,'TEMPLATE_PORTABLE_BLOB_CHANGED');
    return body;
  }
  async function json(metadata){
    try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(metadata)));}
    catch(error){if(error.code)throw error;throw Object.assign(new Error('TEMPLATE_JSON_BLOB_INVALID'),{code:'TEMPLATE_JSON_BLOB_INVALID'});}
  }
  async function workbook(value){
    check();
    const filename=workbookFilename(value.filename),format=value.format??undefined,delimiter=value.delimiter??undefined;
    const key=JSON.stringify([descriptor(value.workbook),filename,format,delimiter]);
    if(!cache.has(key))cache.set(key,(async()=>{
      const body=await bytes(value.workbook);
      const actual=await inspectWorkbook(body,{filename,format,delimiter,...options});
      if(value.inspection){
        const recorded=await json(value.inspection);requireValue(same(recorded,actual),'TEMPLATE_INSPECTION_CHANGED');
      }
      return {body,inspection:actual};
    })());
    const result=await cache.get(key);check();return result;
  }
  return {bytes,json,workbook};
}
function workbookSummary(inspection){
  return {format:inspection.format,bytes:inspection.bytes,sheets:inspection.sheets.map(s=>({name:s.name,kind:s.kind,state:s.state,
    cells:s.cells.length,protected:s.protected,mergedRanges:s.merged.length})),formulaCount:inspection.formulaCount,partCount:inspection.partCount};
}
function normalizeBook(value){
  requireValue(object(value),'TEMPLATE_WORKBOOK_REQUIRED');
  const result={filename:workbookFilename(value.filename),workbook:descriptor(value.workbook),inspection:descriptor(value.inspection)};
  if(value.format!==undefined){requireValue(['xlsx','csv'].includes(value.format),'TEMPLATE_FORMAT_INVALID');result.format=value.format;}
  if(value.delimiter!==undefined){requireValue([',','\t',';','|'].includes(value.delimiter),'TEMPLATE_DELIMITER_INVALID');result.delimiter=value.delimiter;}
  return result;
}
function editionFor(state,id){return find(model(state).editions,id,'TEMPLATE_EDITION_NOT_FOUND');}
function mappingFor(state,id){return find(model(state).mappings,id,'TEMPLATE_MAPPING_NOT_FOUND');}
function releaseFor(state,id){return find(model(state).releases,id,'TEMPLATE_RELEASE_NOT_FOUND');}
function returnFor(state,id){return find(model(state).returns,id,'TEMPLATE_RETURN_NOT_FOUND');}
function reviewFor(state,id){return find(model(state).reviews,id,'TEMPLATE_RETURN_REVIEW_NOT_FOUND');}
async function checkedMapping(state,mapping,reader){
  const edition=editionFor(state,mapping.templateEditionId),book=await reader.workbook(edition);
  const {publication}=publicationFor(state,mapping.publicationId);
  requireValue(publication.sha256===mapping.publicationSha256,'TEMPLATE_MAPPING_PUBLICATION_CHANGED');
  const retained=await reader.json(mapping.details);
  requireValue(retained.schema==='sf88-template-mapping/v1'&&retained.templateEditionId===edition.id&&
    retained.publicationId===publication.id&&retained.publicationSha256===publication.sha256,'TEMPLATE_MAPPING_CHANGED');
  const bindings=mappingBindings(retained.requestedBindings,book.inspection,publication);
  requireValue(same(bindings,retained.bindings),'TEMPLATE_MAPPING_BINDINGS_CHANGED');
  return {edition,book,publication,details:retained,bindings};
}
function makePatches(inspection,bindings){
  const result=bindings.map(b=>({sheet:b.sheet,cell:b.cell,expectedFingerprint:b.expectedFingerprint,value:clone(b.output)}));
  const cells=new Map(result.map(p=>[JSON.stringify([p.sheet,p.cell]),p]));
  for(const binding of bindings){
    if(!binding.rowIdentity)continue;
    const cell=binding.rowIdentity.column+cellRow(binding.cell),key=JSON.stringify([binding.sheet,cell]);
    const value={type:'text',value:binding.resultId},original=cellAt(inspection,binding.sheet,cell);
    requireValue(original.formula===null&&['',binding.resultId].includes(valueText(original.value)),'TEMPLATE_IDENTITY_COLUMN_NOT_EMPTY');
    const expected={sheet:binding.sheet,cell,expectedFingerprint:original.fingerprint,value};
    if(cells.has(key))requireValue(same(cells.get(key),expected),'TEMPLATE_IDENTITY_COLUMN_COLLISION');
    else{cells.set(key,expected);result.push(expected);}
  }
  return result;
}
function nativeReportSemantics(value){return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='outputSha256'));}
function releaseReport({state,mapping,edition,publication,source,filename,patched,outputInspection}){
  return {schema:'sf88-template-release-report/v1',mappingId:mapping.id,templateEditionId:edition.id,
    sourceWorkbook:edition.workbook,publicationId:publication.id,publicationSha256:publication.sha256,
    sourceContextSha256:source.sha256,newerSourceReview:newerSourceReview(state,publication),filename,outputSha256:outputInspection.sha256,
    native:{...patched.report,outputSha256:outputInspection.sha256},
    lineage:mapping.details,calculation:patched.report.calculation,
    method:'Only reviewed mapped values and original result-ID cells change. Original formulas, native media, styles, unmapped cells and all unrelated package parts remain retained.'};
}
async function apply(state,request,createdAt,reader,options={}){
  const data=request.data,records=model(state),metadata=common(state,request,createdAt);
  if(['retain-template','revise-template'].includes(request.action)){
    const specification=normalizeBook(data.edition),actual=await reader.workbook(specification);
    let template,previous=null;
    if(request.action==='retain-template'){
      template={id:eventId(state,request,'txt'),name:text(data.name,'TEMPLATE_NAME_REQUIRED',240),...metadata};
    }else{
      template=find(records.templates,data.templateId,'TEMPLATE_NOT_FOUND');
      previous=latest(records.editions,e=>e.templateId===template.id);
      requireValue(previous?.id===data.expectedEditionId,'TEMPLATE_EDITION_CONFLICT');
    }
    if(data.sourceReturnId!==undefined){
      const returned=returnFor(state,data.sourceReturnId),release=releaseFor(state,returned.releaseId);
      requireValue(release.templateId===template.id&&same(returned.workbook,specification.workbook),'TEMPLATE_RETURN_BASE_MISMATCH');
    }
    const edition={id:eventId(state,request,'txte'),templateId:template.id,edition:(previous?.edition??0)+1,
      previousEditionId:previous?.id??null,...specification,summary:workbookSummary(actual.inspection),
      sourceReturnId:data.sourceReturnId??null,reason:data.reason,...metadata};
    return {result:{...(request.action==='retain-template'?{template}:{}),edition},
      blobs:[specification.workbook,specification.inspection]};
  }
  if(request.action==='save-mapping'){
    const edition=editionFor(state,data.templateEditionId);
    const {publication}=publicationFor(state,data.publicationId);
    requireValue(publication.sha256===data.publicationSha256,'TEMPLATE_PUBLICATION_CHANGED');
    const details=descriptor(data.details);
    const value={id:eventId(state,request,'txm'),templateId:edition.templateId,templateEditionId:edition.id,
      publicationId:publication.id,publicationSha256:publication.sha256,details,
      previousMappingId:data.previousMappingId??null,reason:data.reason,...metadata};
    if(value.previousMappingId){
      const previous=mappingFor(state,value.previousMappingId);
      requireValue(previous.templateId===edition.templateId,'TEMPLATE_MAPPING_PARENT_MISMATCH');
    }
    const bound=await checkedMapping(state,value,reader);
    value.bindingCount=bound.bindings.length;
    value.sourceResults=[...new Set(bound.bindings.map(b=>b.resultId))].length;
    return {result:{mapping:value},blobs:[details]};
  }
  if(request.action==='release-workbook'){
    const mapping=mappingFor(state,data.mappingId),bound=await checkedMapping(state,mapping,reader);
    const {edition,book,publication,bindings}=bound;
    const latestEdition=latest(records.editions,e=>e.templateId===edition.templateId);
    requireValue(data.expectedTemplateEditionId===edition.id&&latestEdition?.id===edition.id,'TEMPLATE_LATER_CLIENT_EDITION_REQUIRES_MAPPING');
    const source=sourceContext(state);
    requireValue(data.sourceContextSha256===source.sha256,'TEMPLATE_SOURCE_CONTEXT_CHANGED');
    const selected=publicationFor(state,publication.id);
    requireValue(object(data.review),'TEMPLATE_RELEASE_REVIEW_REQUIRED');text(data.review.note,'TEMPLATE_RELEASE_REVIEW_REQUIRED',5000);
    requireValue(selected.status==='published'||data.review.allowHistorical===true,'TEMPLATE_HISTORICAL_PUBLICATION_REVIEW_REQUIRED');
    requireValue(!newerSourceReview(state,publication).acknowledgementRequired||data.review.acknowledgeNewerSource===true,'TEMPLATE_NEWER_SOURCE_REVIEW_REQUIRED');
    const filename=workbookFilename(data.filename);
    requireValue(filename.toLowerCase().split('.').at(-1)===edition.filename.toLowerCase().split('.').at(-1),'TEMPLATE_OUTPUT_FORMAT_CHANGED');
    const output=normalizeBook({...data.output,filename,format:edition.format,delimiter:edition.delimiter});
    const actual=await reader.workbook(output);
    const patched=await patchWorkbook(book.body,{filename:edition.filename,format:edition.format,delimiter:edition.delimiter,
      patches:makePatches(book.inspection,bindings),...options});
    requireValue(same(inspectionSemantics(patched.inspection),inspectionSemantics(actual.inspection)),'TEMPLATE_RELEASE_VALUES_OR_PARTS_CHANGED');
    const report=releaseReport({state,mapping,edition,publication,source,filename,patched,outputInspection:actual.inspection});
    const reportMetadata=descriptor(data.output.report);
    requireValue(same(await reader.json(reportMetadata),report),'TEMPLATE_RELEASE_REPORT_CHANGED');
    const previous=latest(records.releases,r=>r.templateId===edition.templateId);
    requireValue((data.previousReleaseId??null)===(previous?.id??null),'TEMPLATE_PREVIOUS_RELEASE_REQUIRED');
    const value={id:eventId(state,request,'txr'),templateId:edition.templateId,templateEditionId:edition.id,mappingId:mapping.id,
      edition:(previous?.edition??0)+1,previousReleaseId:previous?.id??null,publicationId:publication.id,
      publicationSha256:publication.sha256,sourceContextSha256:source.sha256,publicationStatus:selected.status,
      filename,workbook:output.workbook,inspection:output.inspection,report:reportMetadata,
      format:actual.inspection.format,...(actual.inspection.csv?{delimiter:actual.inspection.csv.delimiter}:{}),
      review:clone(data.review),reason:data.reason,...metadata};
    return {result:{release:value},blobs:[output.workbook,output.inspection,reportMetadata]};
  }
  if(request.action==='receive-return'){
    const release=releaseFor(state,data.releaseId);
    requireValue(release.workbook.sha256===data.releasedSha256,'TEMPLATE_RETURN_RELEASE_CHANGED');
    const specification=normalizeBook(data.returned);
    requireValue(specification.filename.toLowerCase().split('.').at(-1)===release.filename.toLowerCase().split('.').at(-1),'TEMPLATE_RETURN_FORMAT_CHANGED');
    const original=await reader.workbook(release),returned=await reader.workbook(specification);
    const mapping=mappingFor(state,release.mappingId),bound=await checkedMapping(state,mapping,reader);
    const comparison=compareReturn(original.inspection,returned.inspection,bound.bindings);
    const comparisonMetadata=descriptor(data.comparison);
    requireValue(same(await reader.json(comparisonMetadata),comparison),'TEMPLATE_RETURN_COMPARISON_CHANGED');
    const value={id:eventId(state,request,'txreturn'),templateId:release.templateId,releaseId:release.id,
      releasedSha256:release.workbook.sha256,...specification,comparison:comparisonMetadata,
      comparisonFingerprint:comparison.fingerprint,counts:comparison.counts,reason:data.reason,...metadata};
    return {result:{return:value},blobs:[specification.workbook,specification.inspection,comparisonMetadata]};
  }
  if(request.action==='review-return'){
    const returned=returnFor(state,data.returnId),comparison=await reader.json(returned.comparison);
    requireValue(data.comparisonSha256===returned.comparison.sha256,'TEMPLATE_RETURN_REVIEW_SOURCE_CHANGED');
    const previous=latest(records.reviews,r=>r.returnId===returned.id);
    requireValue((data.expectedReviewId??null)===(previous?.id??null),'TEMPLATE_RETURN_REVIEW_CONFLICT');
    const decisions=descriptor(data.decisions),raw=await reader.json(decisions);
    const selected=reviewedDecisions(raw.decisions,comparison);
    requireValue(raw.schema==='sf88-template-return-decisions/v1'&&raw.returnId===returned.id&&
      raw.comparisonSha256===returned.comparison.sha256&&same(selected,raw.decisions),'TEMPLATE_RETURN_DECISIONS_CHANGED');
    const value={id:eventId(state,request,'txreview'),templateId:returned.templateId,returnId:returned.id,
      previousReviewId:previous?.id??null,decisions,comparisonSha256:returned.comparison.sha256,
      counts:Object.fromEntries(['keep-release','propose-correction','client-only'].map(d=>[d,selected.filter(s=>s.disposition===d).length])),
      reason:data.reason,...metadata};
    return {result:{review:value},blobs:[decisions]};
  }
  const review=reviewFor(state,data.reviewId),nativeRequest=extractionInput(await reader.json(descriptor(data.extractionRequest)));
  const native=(state.extractionEvents??[]).find(e=>e.id===data.nativeOperationId);
  requireValue(native&&native.requestSha256===digest(nativeRequest)&&same(native.request,nativeRequest)&&
    native.action==='save-extraction','TEMPLATE_NATIVE_DRAFT_RECEIPT_REQUIRED');
  const earlier=clone(state);earlier.revision=native.originalRevision;
  for(const [key,value] of Object.entries(earlier))if(key.endsWith('Events')&&Array.isArray(value))earlier[key]=value.filter(e=>e.revision<=native.originalRevision);
  const reconstructed=await extractionDraft(earlier,review.id,{actor:nativeRequest.actor,requestId:nativeRequest.requestId,
    resultSetId:nativeRequest.data.resultSetId,reason:nativeRequest.data.reason},reader);
  requireValue(same(reconstructed,nativeRequest),'TEMPLATE_NATIVE_DRAFT_CHANGED');
  const value={id:eventId(state,request,'txdraft'),templateId:review.templateId,reviewId:review.id,
    extractionRequest:descriptor(data.extractionRequest),nativeOperationId:native.id,nativeOperationSha256:native.sha256,
    nativeRevision:native.revision,resultSetId:nativeRequest.data.resultSetId,extractionId:native.result.extraction.id,
    status:'DRAFT_IN_ORIGINAL_EXTRACTION_ENGINE',reason:data.reason,...metadata};
  return {result:{draft:value},blobs:[value.extractionRequest]};
}
export async function recordTemplateExchange(state,raw,createdAt,{readContent,...options}={}){
  checkTemplateSignal(options.signal);
  const request=input(raw),requestSha256=digest(request),prior=(state[TEMPLATE_EVENT_FIELD]??[]).find(e=>e.requestId===request.requestId);
  if(prior){requireValue(prior.requestSha256===requestSha256,'TEMPLATE_REQUEST_CONFLICT');return clone(prior);}
  requireValue(state.revision===request.expectedRevision,'REVISION_CONFLICT',409);
  requireValue(Number.isFinite(Date.parse(createdAt)),'TEMPLATE_TIME_INVALID');
  const originalRevisionSha256=rawDigest(jsonBytes(state));
  const {result,blobs}=await apply(state,request,createdAt,io(readContent,options),options);
  checkTemplateSignal(options.signal);
  const body={schema:TEMPLATE_OPERATION_SCHEMA,id:eventId(state,request),dossierId:state.id,
    requestId:request.requestId,requestSha256,request:clone(request),action:request.action,actor:clone(request.actor),
    createdAt,originalRevision:state.revision,revision:state.revision+1,originalRevisionSha256,result,
    blobs:uniqueBlobs(blobs)};
  const operation={...body,sha256:digest(body)};
  state[TEMPLATE_EVENT_FIELD]=[...(state[TEMPLATE_EVENT_FIELD]??[]),operation];return clone(operation);
}
export async function validateTemplateExchangeTransition(previous,state,{readContent,...options}={}){
  checkTemplateSignal(options.signal);
  validateTemplateExchangeState(state);
  const before=previous?.[TEMPLATE_EVENT_FIELD]??[],after=state[TEMPLATE_EVENT_FIELD]??[];
  requireValue(after.length>=before.length&&after.length<=before.length+1&&before.every((e,i)=>same(e,after[i])),'TEMPLATE_HISTORY_NOT_APPEND_ONLY');
  if(after.length===before.length)return;
  const event=after.at(-1);
  requireValue(previous&&event.originalRevision===previous.revision&&event.revision===state.revision&&
    event.originalRevisionSha256===state.previous,'TEMPLATE_TRANSITION_REVISION_CHANGED');
  const replay=clone(previous);
  await recordTemplateExchange(replay,event.request,event.createdAt,{readContent,...options});
  checkTemplateSignal(options.signal);
  requireValue(same(savedFields(replay),savedFields(state)),'TEMPLATE_TRANSITION_CHANGED');
}
function basisInput(basis){
  return basis.kind==='json-pointer'?{occurrenceId:basis.occurrenceId,kind:basis.kind,pointer:basis.pointer,...(basis.file?{fileName:basis.file.name}:{})}:
    {occurrenceId:basis.occurrenceId,kind:'passage',locator:basis.locator,...(basis.quote?{quote:basis.quote}:{}),...(basis.file?{fileName:basis.file.name}:{})};
}
function answerInput(answer){
  return {rowId:answer.rowId,fieldId:answer.fieldId,status:answer.status,value:clone(answer.value),
    bases:(answer.bases??[]).map(basisInput),context:clone(answer.context??{}),note:answer.note??'',
    ...(answer.derivation?{derivation:clone(answer.derivation)}:{})};
}
async function extractionDraft(state,reviewId,{actor,requestId,resultSetId,reason},reader){
  const review=reviewFor(state,reviewId),returned=returnFor(state,review.returnId),release=releaseFor(state,returned.releaseId);
  requireValue(latest(model(state).reviews,r=>r.returnId===returned.id)?.id===review.id,'TEMPLATE_NEWER_RETURN_REVIEW_EXISTS');
  const comparison=await reader.json(returned.comparison),decisionFile=await reader.json(review.decisions);
  const selected=reviewedDecisions(decisionFile.decisions,comparison).filter(d=>d.disposition==='propose-correction');
  const {publication}=publicationFor(state,release.publicationId);
  const rows=publication.rows.map(r=>r.result).filter(r=>r.record.resultSet.id===resultSetId);
  requireValue(rows.length>0,'TEMPLATE_RESULT_SET_NOT_PUBLISHED');
  const events=state.extractionEvents??[],resultSet=events.map(e=>e.result?.resultSet).find(r=>r?.id===resultSetId);
  requireValue(resultSet,'TEMPLATE_RESULT_SET_NOT_FOUND');
  const prior=events.map(e=>e.result?.extraction).filter(r=>r&&r.resultSetId===resultSetId&&r.actor.id===actor.id).at(-1);
  const answers=new Map((prior?.answers??[]).map(a=>[JSON.stringify([a.rowId,a.fieldId]),answerInput(a)]));
  for(const row of rows)for(const answer of Object.values(row.record.values??{})){
    const key=JSON.stringify([answer.rowId,answer.fieldId]);if(!answers.has(key))answers.set(key,answerInput(answer));
  }
  const changes=new Map();let applied=0;
  for(const decision of selected){
    const change=comparison.mapped.find(m=>m.bindingId===decision.bindingId),row=rows.find(r=>r.resultId===change.resultId);
    if(!row)continue;
    const key=JSON.stringify([row.record.row.id,change.fieldId]),existing=answers.get(key);
    requireValue(existing,'TEMPLATE_ORIGINAL_ANSWER_MISSING');
    const value=returnedTypedValue(change,row.record.values[change.fieldId].value);
    if(changes.has(key))requireValue(same(changes.get(key),value),'TEMPLATE_CONFLICTING_CLIENT_VALUES');
    changes.set(key,value);
    // Client corrections are explicitly uncertain until the original assigned
    // reviewers submit and resolve them; the publication is never overwritten.
    answers.set(key,{...existing,value,status:'uncertain',context:{...existing.context,templateReturn:{
      reviewId,returnId:returned.id,releaseId:release.id,workbookSha256:returned.workbook.sha256,
      sheet:change.returned.sheet,cell:change.returned.cell,bindingId:change.bindingId}},
      note:[existing.note,decision.note,'Client workbook correction awaiting original extraction review.'].filter(Boolean).join('\n')});
    applied+=1;
  }
  requireValue(applied>0,'TEMPLATE_NO_CORRECTIONS_FOR_RESULT_SET');
  const form=events.map(e=>e.result?.formEdition).find(f=>f?.id===resultSet.formEditionId);
  requireValue(form?.definition.extractorIds.includes(actor.id),'TEMPLATE_ASSIGNED_EXTRACTOR_REQUIRED');
  for(const row of resultSet.rows)for(const field of form.definition.fields){
    requireValue(answers.has(JSON.stringify([row.id,field.id])),'TEMPLATE_COMPLETE_DRAFT_REQUIRED');
  }
  return extractionInput({requestId,expectedRevision:state.revision,actor,action:'save-extraction',
    data:{resultSetId,answers:[...answers.values()],reason,...(prior?{supersedes:prior.id}:{})}});
}
export function createTemplateExchange({head,commit,blob,putBlob,reviewExtraction,workbookOptions={}}){
  for(const fn of [head,commit,blob,putBlob])requireValue(typeof fn==='function','TEMPLATE_DOSSIER_BINDING_REQUIRED');
  const reader=io(blob,workbookOptions),check=()=>checkTemplateSignal(workbookOptions.signal);
  async function saveBytes(body){
    check();const saved=await putBlob(body);check();return descriptor(saved);
  }
  async function saveJson(value){return saveBytes(jsonBuffer(value));}
  async function stageWorkbook({filename,body,format,delimiter}){
    const inspection=await inspectWorkbook(body,{filename,format,delimiter,...workbookOptions});
    return {filename:workbookFilename(filename),format:inspection.format,...(inspection.csv?{delimiter:inspection.csv.delimiter}:{}),
      workbook:await saveBytes(body),inspection:await saveJson(inspection),summary:workbookSummary(inspection)};
  }
  async function page(id,{revision,section='overview',offset=0,limit=30,templateId}={}){
    requireValue(TEMPLATE_SECTIONS.includes(section)&&Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=200,'TEMPLATE_PAGE_INVALID');
    requireValue(offset===0||revision!==undefined,'RESEARCH_PAGE_REVISION_REQUIRED');
    const {state}=await head(id,revision),records=model(state);
    if(templateId)find(records.templates,templateId,'TEMPLATE_NOT_FOUND');
    const lists={templates:records.templates,'template-editions':records.editions,mappings:records.mappings,releases:records.releases,
      returns:records.returns,'return-reviews':records.reviews,drafts:records.drafts,operations:records.operations};
    const list=section==='overview'?[]:lists[section].filter(r=>!templateId||r.templateId===templateId||r.id===templateId||
      r.result?.template?.id===templateId||Object.values(r.result??{}).some(v=>v?.templateId===templateId));
    requireValue(offset<=list.length,'TEMPLATE_PAGE_INVALID');
    return {schema:TEMPLATE_SCHEMA,dossierId:id,revision:state.revision,section,templateId:templateId??null,
      sourceContext:sourceContext(state),publications:(state.extractionPublicationEvents??[]).filter(e=>e.result?.publication).map(e=>({id:e.result.publication.id,title:e.result.publication.title,sha256:e.result.publication.sha256,rows:e.result.publication.rows.length,status:publicationFor(state,e.result.publication.id).status})),overview:Object.fromEntries(Object.entries(lists).map(([k,v])=>[k,v.length])),
      items:clone(list.slice(offset,offset+limit)),offset,limit,total:list.length,nextOffset:offset+limit<list.length?offset+limit:null};
  }
  async function review(id,{projection='metadata',...raw}){
    check();
    const request=input(raw),sha=digest(request);
    async function recovered(){
      const current=await head(id),op=(current.state[TEMPLATE_EVENT_FIELD]??[]).find(e=>e.requestId===request.requestId);
      if(!op)return null;requireValue(op.requestSha256===sha,'TEMPLATE_REQUEST_CONFLICT');
      return {dossier:{id,revision:current.state.revision},operation:clone(op),duplicate:true};
    }
    const existing=await recovered();if(existing)return existing;
    let operation;
    try{
      const dossier=await commit(id,request.expectedRevision,'Template exchange: '+request.action,async(state)=>{
        operation=await recordTemplateExchange(state,request,new Date().toISOString(),{readContent:blob,...workbookOptions});
      },{projection});
      return {dossier,operation:clone(operation),duplicate:false};
    }catch(error){
      if(error.code==='REVISION_CONFLICT'){const saved=await recovered();if(saved)return saved;}throw error;
    }
  }
  async function stageMapping(id,{revision,templateEditionId,publicationId,bindings,previousMappingId=null}){
    const {state}=await head(id,revision),edition=editionFor(state,templateEditionId),book=await reader.workbook(edition);
    const {publication,status}=publicationFor(state,publicationId);
    const bound=mappingBindings(bindings,book.inspection,publication);
    // Native patch validation rejects protected, merged-child, array-formula and
    // Excel-precision targets before an operator can accept the mapping.
    await patchWorkbook(book.body,{filename:edition.filename,format:edition.format,delimiter:edition.delimiter,
      patches:makePatches(book.inspection,bound),...workbookOptions});
    const details={schema:'sf88-template-mapping/v1',templateEditionId,publicationId,publicationSha256:publication.sha256,
      requestedBindings:clone(bindings),bindings:bound};
    return {expectedRevision:state.revision,action:'save-mapping',data:{templateEditionId,publicationId,publicationSha256:publication.sha256,
      details:await saveJson(details),previousMappingId},preview:{publicationStatus:status,bindingCount:bound.length,bindings:bound}};
  }
  async function stageRelease(id,{revision,mappingId,filename,review:releaseReview}){
    const {state}=await head(id,revision),mapping=mappingFor(state,mappingId),bound=await checkedMapping(state,mapping,reader);
    const {edition,book,publication,bindings}=bound,source=sourceContext(state);
    const patched=await patchWorkbook(book.body,{filename:edition.filename,format:edition.format,delimiter:edition.delimiter,
      patches:makePatches(book.inspection,bindings),...workbookOptions});
    const named=workbookFilename(filename??edition.filename);
    const output=await stageWorkbook({filename:named,body:patched.body,format:edition.format,delimiter:edition.delimiter});
    const outputInspection=await reader.json(output.inspection);
    const report=releaseReport({state,mapping,edition,publication,source,filename:named,patched,outputInspection});
    const previous=latest(model(state).releases,r=>r.templateId===edition.templateId);
    return {expectedRevision:state.revision,action:'release-workbook',data:{mappingId,expectedTemplateEditionId:edition.id,
      sourceContextSha256:source.sha256,previousReleaseId:previous?.id??null,filename:named,
      review:clone(releaseReview),output:{workbook:output.workbook,inspection:output.inspection,report:await saveJson(report)}},
      preview:report};
  }
  async function stageReturn(id,{revision,releaseId,...raw}){
    const {state}=await head(id,revision),release=releaseFor(state,releaseId),original=await reader.workbook(release);
    const returned=await stageWorkbook(raw),actual=await reader.workbook(returned);
    const {bindings}=await checkedMapping(state,mappingFor(state,release.mappingId),reader);
    const comparison=compareReturn(original.inspection,actual.inspection,bindings);
    return {expectedRevision:state.revision,action:'receive-return',data:{releaseId,releasedSha256:release.workbook.sha256,
      returned,comparison:await saveJson(comparison)},preview:comparison};
  }
  async function stageReturnReview(id,{revision,returnId,decisions}){
    const {state}=await head(id,revision),returned=returnFor(state,returnId),comparison=await reader.json(returned.comparison);
    const selected=reviewedDecisions(decisions,comparison),previous=latest(model(state).reviews,r=>r.returnId===returnId);
    const record={schema:'sf88-template-return-decisions/v1',returnId,comparisonSha256:returned.comparison.sha256,decisions:selected};
    return {expectedRevision:state.revision,action:'review-return',data:{returnId,comparisonSha256:returned.comparison.sha256,
      expectedReviewId:previous?.id??null,decisions:await saveJson(record)},preview:record};
  }
  async function prepareExtractionDraft(id,{revision,reviewId,...options}){
    const {state}=await head(id,revision),request=await extractionDraft(state,reviewId,options,reader);
    return {schema:'sf88-template-native-draft-request/v1',dossierId:id,revision:state.revision,reviewId,
      request,requestSha256:digest(request),blob:await saveJson(request)};
  }
  async function acceptExtractionDraft(id,{reviewId,request,requestBlob,receiptRequestId,reason}){
    requireValue(typeof reviewExtraction==='function','TEMPLATE_ORIGINAL_EXTRACTION_WRITER_REQUIRED');
    const normalized=extractionInput(request),retained=await reader.json(descriptor(requestBlob));
    requireValue(same(normalized,retained),'TEMPLATE_DRAFT_REQUEST_CHANGED');
    // Bind the selected review and every proposed answer BEFORE the first
    // native write. A recovered native request uses that same actual historical
    // dossier head, even if later native/template operations already exist.
    const preparedHead=await head(id,normalized.expectedRevision);
    const prepared=await extractionDraft(preparedHead.state,reviewId,{actor:normalized.actor,
      requestId:normalized.requestId,resultSetId:normalized.data.resultSetId,reason:normalized.data.reason},reader);
    requireValue(same(prepared,normalized),'TEMPLATE_SELECTED_REVIEW_REQUEST_MISMATCH');
    const receiptInput=revision=>input({requestId:receiptRequestId,expectedRevision:revision,actor:normalized.actor,
      action:'record-extraction-draft',data:{reviewId,extractionRequest:descriptor(requestBlob),
        nativeOperationId:null,reason}});
    receiptInput(preparedHead.state.revision); // Validate receipt ID/actor/reason before any native mutation.
    const beforeNative=await head(id),existingReceipt=(beforeNative.state[TEMPLATE_EVENT_FIELD]??[]).find(e=>e.requestId===receiptRequestId);
    if(existingReceipt){
      const accepted=(beforeNative.state.extractionEvents??[]).find(e=>e.requestId===normalized.requestId);
      requireValue(accepted&&accepted.requestSha256===digest(normalized),'TEMPLATE_RECEIPT_REQUEST_CONFLICT');
      const expected=receiptInput(existingReceipt.originalRevision);expected.data.nativeOperationId=accepted.id;
      requireValue(existingReceipt.requestSha256===digest(expected)&&same(existingReceipt.request,expected),'TEMPLATE_RECEIPT_REQUEST_CONFLICT');
    }
    // The original engine owns reviewer assignment, current source authority,
    // CAS, request recovery, submission and adjudication.
    check();
    const native=await reviewExtraction(id,{...normalized,projection:'metadata'});
    check();
    const current=await head(id),operation=native.operation;
    requireValue(operation?.requestSha256===digest(normalized),'TEMPLATE_NATIVE_DRAFT_RECEIPT_REQUIRED');
    const prior=(current.state[TEMPLATE_EVENT_FIELD]??[]).find(e=>e.requestId===receiptRequestId);
    if(prior){
      const expected=receiptInput(prior.originalRevision);expected.data.nativeOperationId=operation.id;
      requireValue(prior.requestSha256===digest(expected)&&same(prior.request,expected),'TEMPLATE_RECEIPT_REQUEST_CONFLICT');
      return {native,receipt:{operation:prior,duplicate:true}};
    }
    const receipt=await review(id,{requestId:receiptRequestId,expectedRevision:current.state.revision,actor:normalized.actor,
      action:'record-extraction-draft',data:{reviewId,extractionRequest:descriptor(requestBlob),nativeOperationId:operation.id,reason}});
    return {native,receipt};
  }
  async function readBlob(id,{revision,sha256}){
    const {state}=await head(id,revision),metadata=templateExchangeBlobs(state).find(b=>b.sha256===sha256);
    requireValue(metadata,'TEMPLATE_BLOB_NOT_IN_DOSSIER');
    return {dossierId:id,revision:state.revision,...metadata,body:await reader.bytes(metadata)};
  }
  async function inspectRecord(id,{revision,kind,recordId}){
    const {state}=await head(id,revision),records=model(state);
    const list={edition:records.editions,mapping:records.mappings,release:records.releases,return:records.returns,review:records.reviews,draft:records.drafts}[kind];
    requireValue(list,'TEMPLATE_RECORD_KIND_INVALID');const record=find(list,recordId,'TEMPLATE_RECORD_NOT_FOUND');
    const details={};
    for(const key of ['inspection','details','report','comparison','decisions','extractionRequest'])if(record[key])details[key]=await reader.json(record[key]);
    return {schema:TEMPLATE_SCHEMA,dossierId:id,revision:state.revision,kind,record:clone(record),details};
  }
  async function publication(id,{revision,publicationId,offset=0,limit=30}){
    requireValue(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=200,'TEMPLATE_PAGE_INVALID');
    requireValue(offset===0||revision!==undefined,'RESEARCH_PAGE_REVISION_REQUIRED');
    const {state}=await head(id,revision),selected=publicationFor(state,publicationId),all=selected.publication.rows;
    requireValue(offset<=all.length,'TEMPLATE_PAGE_INVALID');
    const {rows,...record}=selected.publication;
    return {schema:TEMPLATE_SCHEMA,dossierId:id,revision:state.revision,publication:record,status:selected.status,
      newerSourceReview:newerSourceReview(state,selected.publication),items:clone(all.slice(offset,offset+limit)),
      offset,limit,total:all.length,nextOffset:offset+limit<all.length?offset+limit:null};
  }
  async function operation(id,{revision,requestId}){
    const {state}=await head(id,revision),value=(state[TEMPLATE_EVENT_FIELD]??[]).find(e=>e.requestId===requestId)??null;
    return {dossierId:id,revision:state.revision,operation:clone(value)};
  }
  const methods={page,review,stageWorkbook,stageMapping,stageRelease,stageReturn,stageReturnReview,publication,operation,
    prepareExtractionDraft,acceptExtractionDraft,readBlob,inspectRecord};
  // This nested API is outside the caller's top-level Store wrapper. Stop at
  // each original boundary; an already committed request retains its normal replay.
  return Object.fromEntries(Object.entries(methods).map(([name,method])=>[name,async(...args)=>{
    check();const result=await method(...args);check();return result;
  }]));
}
