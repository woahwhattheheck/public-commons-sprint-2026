// MIT. Authored evidence tables and immutable publications in the original dossier.
import {digest,jsonBytes,need,object} from '../node/store.mjs';
import {RESEARCH_PAGE_LIMIT} from './workspace-contracts.mjs';
import {EXTRACTION_PUBLICATION_SCHEMA,EXTRACTION_PUBLICATION_OPERATION_SCHEMA,
  EXTRACTION_PUBLICATION_EDITION_SCHEMA,EXTRACTION_PUBLICATION_SECTIONS,EXTRACTION_PUBLICATION_FORMATS,
  publicationInput,publicationDefinition,publicationDigest,publicationSame,publicationClone,publicationHash,
  publicationEntityId,publicationResultDescriptor,publicationResultFingerprint,publicationCell}
  from './extraction-publication-contracts.mjs';
import {extractionPublicationCsv,extractionPublicationMarkdownLines,
  extractionPublicationHtml,extractionPublicationHtmlFragment} from './extraction-publication-render.mjs';
export {publicationInput,publicationDefinition,publicationDigest,publicationResultDescriptor,publicationResultFingerprint};
export {extractionPublicationMarkdownLines,extractionPublicationHtmlFragment};
export {EXTRACTION_PUBLICATION_SCHEMA,EXTRACTION_PUBLICATION_OPERATION_SCHEMA,
  EXTRACTION_PUBLICATION_EDITION_SCHEMA,EXTRACTION_PUBLICATION_ACTIONS,EXTRACTION_PUBLICATION_SECTIONS,EXTRACTION_PUBLICATION_FORMATS}
  from './extraction-publication-contracts.mjs';
const clone=publicationClone,same=publicationSame,array=value=>Array.isArray(value)?value:[];
const find=(rows,id,code)=>{const value=rows.find(row=>row.id===id);need(value,code);return value;};
const key=(resultId,editionId)=>JSON.stringify([resultId,editionId]);
const latest=(rows,predicate)=>rows.filter(predicate).at(-1)??null;
const time=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const bareImpact=value=>Object.fromEntries(Object.entries(value).filter(([name])=>name!=='review'));
const counted=(rows,select)=>Object.fromEntries([...new Set(rows.map(select))].map(name=>
  [name,rows.filter(value=>select(value)===name).length]));
const common=(state,request,createdAt)=>({actor:clone(request.actor),createdAt,
  originalRevision:state.revision,revision:state.revision+1});

function coreIndex(state,context){
  need(object(context)&&context.dossierId===state.id&&context.revision===state.revision&&
    Array.isArray(context.results)&&Array.isArray(context.impacts)&&Array.isArray(context.unresolved),
    'PUBLICATION_CORE_CONTEXT_REQUIRED');
  const records=new Map(),current=new Map();
  for(const raw of context.results){
    const descriptor=publicationResultDescriptor(raw);
    need(/^xr_[a-f0-9]{64}$/.test(descriptor.resultId)&&/^xre_[a-f0-9]{64}$/.test(descriptor.editionId)&&
      typeof descriptor.questionId==='string'&&typeof descriptor.studyId==='string'&&
      typeof descriptor.label==='string'&&typeof descriptor.status==='string'&&
      Array.isArray(descriptor.sourceBindings)&&object(descriptor.record),'PUBLICATION_CORE_RESULT_INVALID');
    const identity=key(descriptor.resultId,descriptor.editionId);
    need(!records.has(identity),'PUBLICATION_CORE_RESULT_DUPLICATE');
    const result={...descriptor,current:raw.current,fingerprint:publicationDigest(descriptor)};
    records.set(identity,result);
    if(raw.current){
      need(!current.has(descriptor.resultId),'PUBLICATION_CORE_CURRENT_DUPLICATE');
      current.set(descriptor.resultId,result);
    }
  }
  // Only mutable current-selection metadata is omitted from a result fingerprint.
  // The review basis includes current identities and all original impact/unresolved records.
  const review={dossierId:state.id,currentResults:[...current.values()].map(value=>({
    resultId:value.resultId,editionId:value.editionId,fingerprint:value.fingerprint,
    questionId:value.questionId,studyId:value.studyId,status:value.status})),
    impacts:clone(context.impacts),unresolved:clone(context.unresolved)};
  return {records,current,results:[...records.values()],context:clone(context),
    reviewContext:{...review,fingerprint:publicationDigest(review)}};
}
function records(state){
  const model={tables:[],tableEditions:[],publications:[],reviews:[],withdrawals:[],
    operations:array(state.extractionPublicationEvents)};
  for(const event of model.operations){
    const result=event.result;
    if(result.table)model.tables.push(result.table);
    if(result.tableEdition)model.tableEditions.push(result.tableEdition);
    if(result.publication)model.publications.push(result.publication);
    if(result.impactReview)model.reviews.push(result.impactReview);
    if(result.withdrawal)model.withdrawals.push(result.withdrawal);
  }
  return model;
}
const currentTable=(model,tableId)=>latest(model.tableEditions,value=>value.tableId===tableId);
function tableContext(model,tableId,tableEditionId){
  const table=find(model.tables,tableId,'PUBLICATION_TABLE_NOT_FOUND');
  const edition=tableEditionId?find(model.tableEditions,tableEditionId,'PUBLICATION_TABLE_EDITION_NOT_FOUND'):
    currentTable(model,tableId);
  need(edition&&edition.tableId===table.id,'PUBLICATION_TABLE_EDITION_MISMATCH');return {table,edition};
}
function publicationStatuses(model){
  return model.publications.map(publication=>{
    const withdrawal=latest(model.withdrawals,value=>value.publicationId===publication.id);
    const successor=model.publications.find(value=>value.previousPublicationId===publication.id);
    return {publicationId:publication.id,tableId:publication.tableId,
      status:withdrawal?'withdrawn':successor?'superseded':'published',
      latest:latest(model.publications,value=>value.tableId===publication.tableId)?.id===publication.id,
      withdrawalId:withdrawal?.id??null,supersededBy:successor?.id??null,
      currentTableEditionId:currentTable(model,publication.tableId)?.id??null};
  });
}
function resultIdentity(result){
  return result?{resultId:result.resultId,editionId:result.editionId,fingerprint:result.fingerprint,
    questionId:result.questionId,studyId:result.studyId,status:result.status}:null;
}
function impactsFor(state,model,index){
  const impacts=[];
  function append(publication,kind,identity,previous,current,resultIds,sourceImpact=null){
    const id='xpi_'+publicationDigest({dossierId:state.id,publicationId:publication.id,kind,identity});
    const descriptor={id,publicationId:publication.id,tableId:publication.tableId,kind,resultIds:[...resultIds],
      previous:clone(previous),current:clone(current),sourceImpact:clone(sourceImpact)};
    const fingerprint=publicationDigest(descriptor);
    const review=latest(model.reviews,value=>value.impactId===id&&value.fingerprint===fingerprint);
    impacts.push({...descriptor,fingerprint,review:clone(review)});
  }
  for(const publication of model.publications){
    const definition=currentTable(model,publication.tableId);
    if(definition&&definition.id!==publication.tableEditionId)
      append(publication,'table-definition',publication.tableId,publication.tableEditionId,definition.id,[]);
    const resultIds=new Set(publication.rows.map(row=>row.result.resultId));
    const resultSets=new Set(publication.rows.map(row=>row.result.record.resultSet?.id).filter(Boolean));
    for(const row of publication.rows){
      const old={...row.result,fingerprint:row.fingerprint},current=index.current.get(row.result.resultId)??null;
      if(!current||current.fingerprint!==row.fingerprint)
        append(publication,current?'result-edition':'result-unavailable',row.result.resultId,
          resultIdentity(old),resultIdentity(current),[row.result.resultId]);
      if(current&&current.status!=='RESOLVED'){
        const unresolved=index.context.unresolved.find(value=>value.resultId===current.resultId&&
          value.editionId===current.editionId)??resultIdentity(current);
        append(publication,'unresolved-result',row.result.resultId,null,unresolved,[row.result.resultId]);
      }
    }
    for(const impact of index.context.impacts){
      const related=array(impact.resultIds).filter(id=>resultIds.has(id));
      if(!related.length&&!resultSets.has(impact.resultSetId))continue;
      append(publication,'core:'+impact.kind,impact.id,impact.previous??null,impact.current??null,
        related.length?related:[...resultIds].filter(id=>publication.rows.some(row=>
          row.result.resultId===id&&row.result.record.resultSet?.id===impact.resultSetId)),impact);
    }
  }
  return impacts;
}
export function extractionPublicationModel(state,coreContext){
  const index=coreIndex(state,coreContext),model=records(state);
  const tables=model.tables.map(table=>{
    const edition=currentTable(model,table.id);
    return {...clone(table),name:edition.definition.name,editionId:edition.id,edition:edition.edition,
      definition:clone(edition.definition)};
  });
  return {...clone(model),schema:EXTRACTION_PUBLICATION_SCHEMA,dossierId:state.id,revision:state.revision,
    tables,results:clone(index.results),reviewContext:clone(index.reviewContext),
    impacts:impactsFor(state,model,index),statuses:publicationStatuses(model)};
}
function selectedRows(index,tableEdition,selected){
  return selected.map(selection=>{
    const result=index.records.get(key(selection.resultId,selection.editionId));
    need(result,'PUBLICATION_RESULT_EDITION_NOT_FOUND');
    need(result.fingerprint===selection.fingerprint,'PUBLICATION_RESULT_FINGERPRINT_CHANGED');
    need(!tableEdition.definition.questionIds.length||tableEdition.definition.questionIds.includes(result.questionId),
      'PUBLICATION_RESULT_QUESTION_MISMATCH');
    // Do not hash the API fingerprint back into its own descriptor.
    const {fingerprint,current,...descriptor}=result;
    return {result:clone(descriptor),fingerprint,currentAtPublication:current,
      cells:tableEdition.definition.columns.map(column=>({columnId:column.id,pointer:column.pointer,
        ...publicationCell(descriptor.record,column.pointer)}))};
  });
}
function applyAction(state,model,index,request,createdAt){
  const data=request.data,metadata=common(state,request,createdAt);
  if(request.action==='create-table'){
    const table={id:publicationEntityId('xtab',state,request),...metadata};
    const tableEdition={id:publicationEntityId('xtabe',state,request),tableId:table.id,edition:1,
      previousTableEditionId:null,definition:clone(data.definition),reason:'Initial authored table',...metadata};
    return {table,tableEdition};
  }
  if(request.action==='revise-table'){
    const {edition}=tableContext(model,data.tableId);
    need(edition.id===data.expectedTableEditionId,'PUBLICATION_TABLE_EDITION_CONFLICT');
    return {tableEdition:{id:publicationEntityId('xtabe',state,request),tableId:data.tableId,
      edition:edition.edition+1,previousTableEditionId:edition.id,definition:clone(data.definition),
      reason:data.reason,...metadata}};
  }
  if(request.action==='publish-table'){
    const {edition}=tableContext(model,data.tableId,data.tableEditionId);
    const previous=latest(model.publications,value=>value.tableId===data.tableId);
    need((previous?.id??null)===data.previousPublicationId,'PUBLICATION_PREVIOUS_EDITION_CONFLICT');
    need(data.review.contextFingerprint===index.reviewContext.fingerprint,'PUBLICATION_REVIEW_CONTEXT_CHANGED');
    const publication={schema:EXTRACTION_PUBLICATION_EDITION_SCHEMA,id:publicationEntityId('xpub',state,request),
      tableId:data.tableId,tableEditionId:edition.id,edition:(previous?.edition??0)+1,
      previousPublicationId:previous?.id??null,title:data.title,summary:data.summary,
      limitations:data.limitations,reason:data.reason,definition:clone(edition.definition),
      rows:selectedRows(index,edition,data.rows),
      review:{actor:clone(request.actor),note:data.review.note,contextFingerprint:data.review.contextFingerprint,
        context:clone(index.reviewContext)},...metadata};
    return {publication:{...publication,sha256:publicationDigest(publication)}};
  }
  const publication=find(model.publications,data.publicationId,'PUBLICATION_EDITION_NOT_FOUND');
  if(request.action==='review-impact'){
    const impacts=impactsFor(state,model,index);
    const impact=find(impacts,data.impactId,'PUBLICATION_IMPACT_NOT_FOUND');
    need(impact.publicationId===publication.id,'PUBLICATION_IMPACT_EDITION_MISMATCH');
    need(impact.fingerprint===data.fingerprint,'PUBLICATION_IMPACT_CHANGED');
    return {impactReview:{id:publicationEntityId('xpir',state,request),publicationId:publication.id,
      tableId:publication.tableId,impactId:impact.id,fingerprint:impact.fingerprint,
      disposition:data.disposition,reason:data.reason,impact:clone(bareImpact(impact)),...metadata}};
  }
  need(publication.sha256===data.expectedPublicationSha256,'PUBLICATION_EDITION_CHANGED');
  need(!model.withdrawals.some(value=>value.publicationId===publication.id),'PUBLICATION_ALREADY_WITHDRAWN');
  return {withdrawal:{id:publicationEntityId('xpw',state,request),publicationId:publication.id,
    tableId:publication.tableId,publicationSha256:publication.sha256,reason:data.reason,...metadata}};
}
/** Pure original-dossier mutation. The caller owns its existing transaction, revision and lease. */
export function recordExtractionPublication(state,coreContext,input,createdAt){
  const request=publicationInput(input),requestSha256=publicationDigest(request);
  const previous=array(state.extractionPublicationEvents).find(value=>value.requestId===request.requestId);
  if(previous){
    need(previous.requestSha256===requestSha256,'PUBLICATION_REQUEST_CONFLICT');
    return clone(previous);
  }
  need(state.revision===request.expectedRevision,'REVISION_CONFLICT');
  need(time(createdAt),'PUBLICATION_TIME_INVALID');
  const index=coreIndex(state,coreContext),model=records(state);
  if(['create-table','revise-table'].includes(request.action))
    need(request.data.definition.questionIds.every(id=>array(state.questions).some(question=>question.id===id)),
      'PUBLICATION_TABLE_QUESTION_NOT_FOUND');
  const originalRevisionSha256=digest(jsonBytes(state)),result=applyAction(state,model,index,request,createdAt);
  const tableId=result.table?.id??result.tableEdition?.tableId??result.publication?.tableId??
    result.impactReview?.tableId??result.withdrawal?.tableId;
  const payload={schema:EXTRACTION_PUBLICATION_OPERATION_SCHEMA,id:publicationEntityId('xpo',state,request),
    dossierId:state.id,requestId:request.requestId,requestSha256,request:clone(request),tableId,
    action:request.action,actor:clone(request.actor),createdAt,originalRevision:state.revision,
    revision:state.revision+1,originalRevisionSha256,result};
  const event={...payload,sha256:publicationDigest(payload)};
  state.extractionPublicationEvents=[...array(state.extractionPublicationEvents),event];
  return clone(event);
}

function selectedModel(model,{tableId,publicationId,currentOnly=false}={}){
  need(typeof currentOnly==='boolean','PUBLICATION_CURRENT_SELECTION_INVALID');
  let chosenPublication=null;
  if(publicationId!==undefined){
    chosenPublication=find(model.publications,publicationId,'PUBLICATION_EDITION_NOT_FOUND');
    need(tableId===undefined||tableId===chosenPublication.tableId,'PUBLICATION_TABLE_SELECTION_MISMATCH');
    tableId=chosenPublication.tableId;
  }
  if(tableId!==undefined)find(model.tables,tableId,'PUBLICATION_TABLE_NOT_FOUND');
  const tables=model.tables.filter(value=>tableId===undefined||value.id===tableId);
  const tableIds=new Set(tables.map(value=>value.id));
  const publications=model.publications.filter(value=>tableIds.has(value.tableId)&&
    (!chosenPublication||value.id===chosenPublication.id));
  const publicationIds=new Set(publications.map(value=>value.id));
  const allQuestions=tables.some(value=>!value.definition.questionIds.length);
  const questionIds=new Set(tables.flatMap(value=>value.definition.questionIds));
  const resultIds=chosenPublication?new Set(chosenPublication.rows.map(row=>row.result.resultId)):null;
  const results=model.results.filter(value=>(tableId===undefined||allQuestions||questionIds.has(value.questionId))&&
    (!resultIds||resultIds.has(value.resultId))&&(!currentOnly||value.current));
  return {tableId:tableId??null,publicationId:publicationId??null,currentOnly,
    tables:clone(tables),tableEditions:clone(model.tableEditions.filter(value=>tableIds.has(value.tableId))),
    publications:clone(publications),results:clone(results),
    rows:publications.flatMap(publication=>publication.rows.map((row,index)=>({
      publicationId:publication.id,tableId:publication.tableId,rowIndex:index,...clone(row)}))),
    impacts:clone(model.impacts.filter(value=>publicationIds.has(value.publicationId))),
    reviews:clone(model.reviews.filter(value=>publicationIds.has(value.publicationId))),
    withdrawals:clone(model.withdrawals.filter(value=>publicationIds.has(value.publicationId))),
    statuses:clone(model.statuses.filter(value=>publicationIds.has(value.publicationId))),
    operations:clone(model.operations.filter(value=>tableIds.has(value.tableId))),
    reviewContext:clone(model.reviewContext)};
}
function overview(selected){
  const current=selected.results.filter(value=>value.current);
  return {tables:selected.tables.length,tableEditions:selected.tableEditions.length,
    publications:selected.publications.length,publishedRows:selected.rows.length,
    availableResultEditions:selected.results.length,currentResults:current.length,
    currentResultStatuses:counted(current,value=>value.status),publicationStatuses:counted(selected.statuses,value=>value.status),
    impacts:selected.impacts.length,impactsWithoutCurrentReview:selected.impacts.filter(value=>!value.review).length,
    impactsNeedingReview:selected.impacts.filter(value=>value.review?.disposition==='needs_review').length,
    impactReviews:selected.reviews.length,withdrawals:selected.withdrawals.length,
    units:{results:'Logical original extraction rows',resultEditions:'Immutable original result editions',
      publishedRows:'Selected result editions counted separately in each publication',
      impacts:'Current changes per publication; earlier reviews remain in history'}};
}
const escapedPointer=key=>String(key).replace(/~/g,'~0').replace(/\//g,'~1');
function changedValues(before,after){
  const output=[],stack=[{pointer:'',beforePresent:true,afterPresent:true,before,after}];
  while(stack.length){
    const item=stack.pop();
    if(item.beforePresent&&item.afterPresent&&same(item.before,item.after))continue;
    const a=item.before,b=item.after;
    if(item.beforePresent&&item.afterPresent&&
      (Array.isArray(a)&&Array.isArray(b)||object(a)&&object(b))){
      const names=Array.isArray(a)?Array.from({length:Math.max(a.length,b.length)},(_,i)=>String(i)):
        [...new Set([...Object.keys(a),...Object.keys(b)])].sort();
      for(const name of names.reverse()){
        const beforePresent=Object.hasOwn(a,name),afterPresent=Object.hasOwn(b,name);
        stack.push({pointer:item.pointer+'/'+escapedPointer(name),beforePresent,afterPresent,
          before:beforePresent?a[name]:null,after:afterPresent?b[name]:null});
      }
    }else output.push(clone(item));
  }
  return output;
}
/** Compare exact frozen result editions and authored cells; numeric tokens remain strings. */
export function extractionPublicationCompare(state,model,options={}){
  const {fromPublicationId=options.againstPublicationId,toPublicationId=options.publicationId}=options;
  need(options.againstPublicationId===undefined||options.fromPublicationId===undefined||
    options.againstPublicationId===options.fromPublicationId,'PUBLICATION_COMPARISON_FROM_CONFLICT');
  need(options.publicationId===undefined||options.toPublicationId===undefined||
    options.publicationId===options.toPublicationId,'PUBLICATION_COMPARISON_TO_CONFLICT');
  const from=find(model.publications,fromPublicationId,'PUBLICATION_COMPARISON_FROM_REQUIRED');
  const to=find(model.publications,toPublicationId,'PUBLICATION_COMPARISON_TO_REQUIRED');
  need(from.tableId===to.tableId,'PUBLICATION_COMPARISON_TABLE_MISMATCH');
  const before=new Map(from.rows.map((value,index)=>[value.result.resultId,{value,index}]));
  const after=new Map(to.rows.map((value,index)=>[value.result.resultId,{value,index}]));
  const resultIds=[...before.keys(),...[...after.keys()].filter(id=>!before.has(id))];
  const rows=resultIds.map(resultId=>{
    const a=before.get(resultId),b=after.get(resultId);
    const kind=!a?'added':!b?'removed':a.value.fingerprint!==b.value.fingerprint||!same(a.value.cells,b.value.cells)?
      'changed':'unchanged';
    return {resultId,kind,moved:Boolean(a&&b&&a.index!==b.index),beforeIndex:a?.index??null,afterIndex:b?.index??null,
      before:a?clone(a.value):null,after:b?clone(b.value):null,
      changes:a&&b?changedValues(a.value.result,b.value.result):[],
      cellChanges:a&&b?changedValues(a.value.cells,b.value.cells):[]};
  });
  const metadata=value=>({title:value.title,summary:value.summary,limitations:value.limitations,
    reason:value.reason,definition:value.definition,tableEditionId:value.tableEditionId,review:value.review});
  return {schema:'sf88-research-extraction-publication-comparison/v1',dossierId:state.id,revision:state.revision,
    dossier:{id:state.id,title:state.title??'',revision:state.revision},tableId:from.tableId,
    fromPublicationId:from.id,toPublicationId:to.id,from:clone(from),to:clone(to),
    fromStatus:clone(findStatus(model,from.id)),toStatus:clone(findStatus(model,to.id)),
    counts:{added:rows.filter(value=>value.kind==='added').length,removed:rows.filter(value=>value.kind==='removed').length,
      changed:rows.filter(value=>value.kind==='changed').length,unchanged:rows.filter(value=>value.kind==='unchanged').length,
      moved:rows.filter(value=>value.moved).length},
    metadataChanges:changedValues(metadata(from),metadata(to)),rows};
}
function findStatus(model,id){return model.statuses.find(value=>value.publicationId===id)??null;}
export function extractionPublicationPage(state,model,options={}){
  const {section='overview',offset=0,limit=30,changeType='all'}=options;
  need(EXTRACTION_PUBLICATION_SECTIONS.includes(section),'PUBLICATION_SECTION_INVALID');
  need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=RESEARCH_PAGE_LIMIT,
    'PUBLICATION_PAGE_INVALID');
  const selected=selectedModel(model,options);
  let comparison=null,values=[];
  if(section==='comparison'){
    need(['all','added','removed','changed','unchanged'].includes(changeType),'PUBLICATION_COMPARISON_KIND_INVALID');
    comparison=extractionPublicationCompare(state,model,options);
    need(!selected.tableId||selected.tableId===comparison.tableId,'PUBLICATION_COMPARISON_TABLE_MISMATCH');
    values=comparison.rows.filter(value=>changeType==='all'||value.kind===changeType);
  }else if(section!=='overview'){
    values=selected[{'table-editions':'tableEditions',impact:'impacts'}[section]??section];
  }
  need(Array.isArray(values)&&offset<=values.length,'PUBLICATION_PAGE_INVALID');
  const items=values.slice(offset,offset+limit);
  return {schema:EXTRACTION_PUBLICATION_SCHEMA,dossierId:state.id,revision:state.revision,
    dossier:{id:state.id,title:state.title??'',revision:state.revision},
    tableId:selected.tableId,publicationId:selected.publicationId,section,overview:overview(selected),
    reviewContext:clone(selected.reviewContext),tables:clone(selected.tables),statuses:clone(selected.statuses),
    ...(comparison?{comparison:{fromPublicationId:comparison.fromPublicationId,toPublicationId:comparison.toPublicationId,
      counts:comparison.counts,metadataChanges:comparison.metadataChanges,changeType}}:{}),
    items:clone(items),offset,limit,total:values.length,nextOffset:offset+items.length<values.length?offset+items.length:null,
    complete:offset===0&&offset+items.length>=values.length};
}
export function extractionPublicationReport(state,model,options={}){
  const selected=selectedModel(model,options);
  const comparing=options.fromPublicationId!==undefined||options.toPublicationId!==undefined||options.againstPublicationId!==undefined;
  const comparison=comparing?extractionPublicationCompare(state,model,options):null;
  need(!comparison||!selected.tableId||selected.tableId===comparison.tableId,'PUBLICATION_COMPARISON_TABLE_MISMATCH');
  return {schema:'sf88-research-extraction-publication-report/v1',dossierId:state.id,revision:state.revision,
    dossier:{id:state.id,title:state.title??'',revision:state.revision},asOf:state.updatedAt??null,
    ...selected,overview:overview(selected),comparison,
    operatingMethod:{
      operatorIdentity:'Named operators in the existing authenticated local workspace',
      tableIdentity:'Every authored column definition has an immutable table edition and original JSON pointer',
      resultIdentity:'Selected original resultId, editionId and SHA-256 over every descriptor field except current',
      exactValues:'Original tagged values, numeric string tokens, source bases, statuses and derivations are preserved',
      publication:'One immutable publication stores the complete selected engine records and current review context',
      corrections:'Later editions, withdrawal notices and impact reviews append without rewriting earlier publications',
      review:'An explicit local operator note records the viewed context; unresolved original statuses remain publishable',
      receiving:'The complete editable dossier, publications and original source editions use the existing portable export'}};
}
export function extractionPublicationExport(state,model,options={}){
  const format=options.format==='md'?'markdown':options.format??'json';
  need(EXTRACTION_PUBLICATION_FORMATS.includes(format),'EXPORT_FORMAT_INVALID');
  const report=extractionPublicationReport(state,model,options);
  const extension={json:'json',csv:'csv',markdown:'md',html:'html'}[format];
  const text=format==='json'?JSON.stringify(report,null,2)+'\n':format==='csv'?extractionPublicationCsv(report):
    format==='markdown'?extractionPublicationMarkdownLines(report).join('\n')+'\n':extractionPublicationHtml(report);
  return {filename:state.id+'-r'+state.revision+
    (report.publicationId?'-'+report.publicationId:report.tableId?'-'+report.tableId:'')+'.extraction-publication.'+extension,
    revision:state.revision,contentType:{json:'application/json; charset=utf-8',csv:'text/csv; charset=utf-8',
      markdown:'text/markdown; charset=utf-8',html:'text/html; charset=utf-8'}[format],body:Buffer.from(text,'utf8')};
}

function checkedReviewContext(context,dossierId){
  need(object(context)&&context.dossierId===dossierId&&Array.isArray(context.currentResults)&&
    Array.isArray(context.impacts)&&Array.isArray(context.unresolved),'PORTABLE_PUBLICATION_CONTEXT_INVALID');
  const {fingerprint,...body}=context;
  need(publicationHash(fingerprint)&&fingerprint===publicationDigest(body),'PORTABLE_PUBLICATION_CONTEXT_CHANGED');
  need(Object.keys(body).every(name=>['dossierId','currentResults','impacts','unresolved'].includes(name)),
    'PORTABLE_PUBLICATION_CONTEXT_FIELDS_INVALID');
  const ids=new Set();
  for(const row of context.currentResults){
    need(object(row)&&/^xr_[a-f0-9]{64}$/.test(row.resultId)&&/^xre_[a-f0-9]{64}$/.test(row.editionId)&&
      publicationHash(row.fingerprint)&&typeof row.status==='string'&&typeof row.questionId==='string'&&
      typeof row.studyId==='string'&&!ids.has(row.resultId),'PORTABLE_PUBLICATION_CONTEXT_RESULT_INVALID');
    ids.add(row.resultId);
  }
}
function checkedFrozenRows(rows,definition,selections,reviewContext){
  need(Array.isArray(rows)&&rows.length===selections.length,'PORTABLE_PUBLICATION_ROWS_INVALID');
  return rows.map((row,index)=>{
    need(object(row)&&object(row.result)&&Array.isArray(row.result.sourceBindings)&&object(row.result.record)&&
      !Object.hasOwn(row.result,'current')&&typeof row.currentAtPublication==='boolean',
      'PORTABLE_PUBLICATION_RESULT_INVALID');
    const selection=selections[index],fingerprint=publicationDigest(row.result);
    need(row.result.resultId===selection.resultId&&row.result.editionId===selection.editionId&&
      fingerprint===selection.fingerprint&&row.fingerprint===fingerprint,'PORTABLE_PUBLICATION_RESULT_CHANGED');
    need(!definition.questionIds.length||definition.questionIds.includes(row.result.questionId),
      'PORTABLE_PUBLICATION_QUESTION_MISMATCH');
    const current=reviewContext.currentResults.find(value=>value.resultId===row.result.resultId);
    need(row.currentAtPublication===Boolean(current&&current.editionId===row.result.editionId),
      'PORTABLE_PUBLICATION_CURRENT_CHANGED');
    if(row.currentAtPublication)
      need(current.fingerprint===fingerprint&&current.status===row.result.status&&
        current.questionId===row.result.questionId&&current.studyId===row.result.studyId,
        'PORTABLE_PUBLICATION_CURRENT_RESULT_CHANGED');
    const expected={result:clone(row.result),fingerprint,currentAtPublication:row.currentAtPublication,
      cells:definition.columns.map(column=>({columnId:column.id,pointer:column.pointer,
        ...publicationCell(row.result.record,column.pointer)}))};
    need(same(expected,row),'PORTABLE_PUBLICATION_CELLS_CHANGED');return expected;
  });
}
function validateStoredResult(state,prior,event,request){
  const model=records({extractionPublicationEvents:prior});
  const original={id:state.id,revision:event.originalRevision};
  const data=request.data,metadata=common(original,request,event.createdAt),result=event.result;
  let expected;
  if(['create-table','revise-table','withdraw-publication'].includes(request.action)){
    expected=applyAction(original,model,null,request,event.createdAt);
  }else if(request.action==='publish-table'){
    const {edition}=tableContext(model,data.tableId,data.tableEditionId);
    const previous=latest(model.publications,value=>value.tableId===data.tableId);
    need((previous?.id??null)===data.previousPublicationId,'PORTABLE_PUBLICATION_PREVIOUS_CHANGED');
    const saved=result.publication;
    need(object(saved)&&object(saved.review),'PORTABLE_PUBLICATION_EDITION_INVALID');
    checkedReviewContext(saved.review.context,state.id);
    need(saved.review.context.fingerprint===data.review.contextFingerprint,
      'PORTABLE_PUBLICATION_REVIEW_CONTEXT_CHANGED');
    const rows=checkedFrozenRows(saved.rows,edition.definition,data.rows,saved.review.context);
    const publication={schema:EXTRACTION_PUBLICATION_EDITION_SCHEMA,id:publicationEntityId('xpub',original,request),
      tableId:data.tableId,tableEditionId:edition.id,edition:(previous?.edition??0)+1,
      previousPublicationId:previous?.id??null,title:data.title,summary:data.summary,limitations:data.limitations,
      reason:data.reason,definition:clone(edition.definition),rows,
      review:{actor:clone(request.actor),note:data.review.note,contextFingerprint:data.review.contextFingerprint,
        context:clone(saved.review.context)},...metadata};
    expected={publication:{...publication,sha256:publicationDigest(publication)}};
  }else{
    const publication=find(model.publications,data.publicationId,'PORTABLE_PUBLICATION_EDITION_NOT_FOUND');
    const review=result.impactReview,impact=review?.impact;
    need(object(impact)&&typeof impact.kind==='string'&&Array.isArray(impact.resultIds),
      'PORTABLE_PUBLICATION_IMPACT_INVALID');
    const {fingerprint,...descriptor}=impact;
    need(publicationHash(fingerprint)&&publicationDigest(descriptor)===fingerprint&&
      fingerprint===data.fingerprint&&impact.id===data.impactId&&impact.publicationId===publication.id&&
      impact.tableId===publication.tableId,'PORTABLE_PUBLICATION_IMPACT_CHANGED');
    const identity=impact.kind==='table-definition'?publication.tableId:
      ['result-edition','result-unavailable','unresolved-result'].includes(impact.kind)?impact.resultIds[0]:
      impact.kind.startsWith('core:')?impact.sourceImpact?.id:null;
    need(typeof identity==='string'&&impact.id==='xpi_'+publicationDigest({
      dossierId:state.id,publicationId:publication.id,kind:impact.kind,identity}),
      'PORTABLE_PUBLICATION_IMPACT_ID_CHANGED');
    expected={impactReview:{id:publicationEntityId('xpir',original,request),publicationId:publication.id,
      tableId:publication.tableId,impactId:impact.id,fingerprint:impact.fingerprint,
      disposition:data.disposition,reason:data.reason,impact:clone(impact),...metadata}};
  }
  need(same(result,expected),'PORTABLE_PUBLICATION_RESULT_CHANGED');
  const tableId=expected.table?.id??expected.tableEdition?.tableId??expected.publication?.tableId??
    expected.impactReview?.tableId??expected.withdrawal?.tableId;
  need(event.tableId===tableId,'PORTABLE_PUBLICATION_TABLE_CHANGED');
}
/** Structural receiving validation. Original portable revision replay supplies source authority. */
export function validateExtractionPublicationState(state){
  need(state.extractionPublicationEvents===undefined||Array.isArray(state.extractionPublicationEvents),
    'PORTABLE_PUBLICATION_HISTORY_INVALID');
  const prior=[],requests=new Set(),ids=new Set();let revision=0;
  for(const event of state.extractionPublicationEvents??[]){
    need(object(event)&&event.schema===EXTRACTION_PUBLICATION_OPERATION_SCHEMA&&object(event.result)&&
      event.dossierId===state.id&&Number.isSafeInteger(event.originalRevision)&&event.originalRevision>=1&&
      event.originalRevision>=revision&&event.revision===event.originalRevision+1&&event.revision<=state.revision&&
      publicationHash(event.originalRevisionSha256)&&time(event.createdAt),'PORTABLE_PUBLICATION_OPERATION_INVALID');
    const request=publicationInput(event.request);
    need(event.id===publicationEntityId('xpo',state,request)&&event.requestId===request.requestId&&
      event.requestSha256===publicationDigest(request)&&same(event.request,request)&&
      event.action===request.action&&same(event.actor,request.actor)&&event.originalRevision===request.expectedRevision,
      'PORTABLE_PUBLICATION_REQUEST_CHANGED');
    need(!requests.has(event.requestId)&&!ids.has(event.id),'PORTABLE_PUBLICATION_OPERATION_DUPLICATE');
    const {sha256,...payload}=event;
    need(publicationHash(sha256)&&sha256===publicationDigest(payload),'PORTABLE_PUBLICATION_OPERATION_CHANGED');
    validateStoredResult(state,prior,event,request);
    requests.add(event.requestId);ids.add(event.id);prior.push(event);revision=event.revision;
  }
}
/** Replay one original publication mutation while preserving every other dossier field. */
export function validateExtractionPublicationTransition(previous,state,previousCoreContext){
  const before=previous?.extractionPublicationEvents??[],after=state.extractionPublicationEvents??[];
  need(Array.isArray(before)&&Array.isArray(after)&&after.length>=before.length&&
    before.every((value,index)=>same(value,after[index])),'PORTABLE_PUBLICATION_HISTORY_CHANGED');
  const added=after.slice(before.length);
  need(added.length<=1&&added.every(value=>value.revision===state.revision&&
    value.originalRevision===previous?.revision&&value.originalRevisionSha256===state.previous),
    'PORTABLE_PUBLICATION_HISTORY_INVALID');
  if(!added.length)return;
  need(previous&&previousCoreContext,'PORTABLE_PUBLICATION_PREVIOUS_CONTEXT_REQUIRED');
  const replay=clone(previous),event=added[0];
  recordExtractionPublication(replay,previousCoreContext,event.request,event.createdAt);
  const content=value=>Object.fromEntries(Object.entries(value).filter(([name])=>
    !['revision','previous','updatedAt','change'].includes(name)));
  need(same(content(replay),content(state)),'PORTABLE_PUBLICATION_TRANSITION_CHANGED');
}
