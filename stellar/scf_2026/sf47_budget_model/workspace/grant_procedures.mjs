// MIT. Complete Operating Plan handover through the original Grant Operations case.
import {
  inspectOperatingPlan, operatingPlanRevision, receiveOperatingPlan,
  summarizeOperatingPlan, renderOperatingPlanHTML, renderOperatingPlanMarkdown,
} from '../../../scf-starforge-20261009/distribution/discovery/operating-plan.mjs';
import {importPlanningBook, sourceTableRows, BOOK_SCHEMA, STORAGE_SCHEMA} from './source-tables-core.mjs';

export const GRANT_PROCEDURE_SCHEMA = 'stellar-forge.sf47-grant-procedure.v1';
export const GRANT_PROCEDURE_REPORT_SCHEMA = GRANT_PROCEDURE_SCHEMA + '.inspection';
export const GRANT_PROCEDURE_MAX_BYTES = 8 * 1024 * 1024;
export const GRANT_PROCEDURE_PREFIX = 'grant-procedure-';
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const clone = x => JSON.parse(JSON.stringify(x));
const own = (x,k) => Object.prototype.hasOwnProperty.call(x,k);
export const procedureJSON = x => JSON.stringify(x,null,2) + '\n';
export const procedureCanonical = x => Array.isArray(x) ? '[' + x.map(procedureCanonical).join(',') + ']'
  : plain(x) ? '{' + Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+procedureCanonical(x[k])).join(',') + '}'
  : JSON.stringify(x);
const equal = (a,b) => procedureCanonical(a) === procedureCanonical(b);
export class GrantProcedureError extends Error {
  constructor(code,message,details={}) {super(message);this.name='GrantProcedureError';this.code=code;Object.assign(this,details);}
}
function need(ok,code,message,details) {if(!ok)throw new GrantProcedureError(code,message,details);}
function only(x,keys,label) {need(plain(x)&&Object.keys(x).every(k=>keys.includes(k))&&keys.every(k=>own(x,k)),
  'PROCEDURE_FIELDS',label+' must retain its complete supported fields.');}
function text(x,label,max=32000,required=false) {
  need(typeof x==='string'&&x.length<=max&&!x.includes('\0')&&
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(x)&&(!required||x.trim()),
    'PROCEDURE_TEXT',label+' must contain complete UTF-8 text'+(required?' and cannot be empty.':'.'));
  return x;
}
function ident(x,prefix) {
  need(typeof x==='string'&&new RegExp('^'+prefix+'-[a-f0-9]{32}$').test(x),
    'PROCEDURE_ID','Use the original '+prefix+' identifier.');return x;
}
function hash(x) {need(typeof x==='string'&&/^[a-f0-9]{64}$/.test(x),'PROCEDURE_HASH','Retain a complete SHA-256 identity.');return x;}
function positive(x,label,max=10000000) {need(Number.isSafeInteger(x)&&x>0&&x<=max,'PROCEDURE_NUMBER',label+' must be a positive whole number.');return x;}
function timestamp(x) {need(typeof x==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(x)&&
  Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,19)===x.slice(0,19),
  'PROCEDURE_TIME','Retain the actual UTC creation time.');return x;}
export async function procedureSha256(value) {
  const bytes=typeof value==='string'?new TextEncoder().encode(value):value;
  need(bytes instanceof Uint8Array,'PROCEDURE_BYTES','Supply complete UTF-8 text or bytes.');
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export async function packProcedureText(value) {
  text(value,'Original JSON text',GRANT_PROCEDURE_MAX_BYTES);
  const bytes=new TextEncoder().encode(value);
  need(bytes.length<=GRANT_PROCEDURE_MAX_BYTES,'PROCEDURE_TOO_LARGE','The complete source must fit the original 8 MiB attachment limit.');
  return {text:value,bytes:bytes.length,sha256:await procedureSha256(bytes)};
}
export async function unpackProcedureText(value) {
  only(value,['text','bytes','sha256'],'Retained text');hash(value.sha256);
  const packed=await packProcedureText(value.text);
  need(packed.bytes===value.bytes&&packed.sha256===value.sha256,'PROCEDURE_SOURCE_CHANGED','Retained original bytes differ from their declared identity.');
  let result;try{result=JSON.parse(value.text.replace(/^\uFEFF/,''));}
  catch{throw new GrantProcedureError('PROCEDURE_JSON','Receive the complete original JSON document.');}
  need(plain(result),'PROCEDURE_JSON','The original JSON must be an object.');return result;
}
function sourceMetadata(value) {
  need(plain(value),'PROCEDURE_SOURCE','Retain the complete native source metadata.');
  ident(value.id,'source');hash(value.sha256);need(Number.isSafeInteger(value.bytes)&&value.bytes>=0&&value.bytes<=GRANT_PROCEDURE_MAX_BYTES,'PROCEDURE_SOURCE','Retain the complete native source byte count.');
  text(value.filename,'Source filename',240,true);text(value.mediaType,'Source media type',200,true);
  need(!/[\\/\u0000-\u001f]/.test(value.filename),'PROCEDURE_SOURCE','Use the original plain source filename.');
  return clone(value);
}
function nativeCase(value) {
  need(plain(value)&&plain(value.program)&&plain(value.plan)&&Array.isArray(value.sources),'PROCEDURE_CASE','Read the complete original Grant Operations case.');
  const p=value.program;ident(p.id,'operation');ident(p.planId,'plan');positive(p.version,'Case version');
  positive(p.planRevision,'Pinned plan revision');hash(value.plan.contentSha256);
  need(value.plan.id===p.planId&&value.plan.revision===p.planRevision&&['OPERATIONS','WALKTHROUGH'].includes(p.mode),
    'PROCEDURE_CASE','The pinned plan must match its actual native case.');
  const seen=new Set();for(const meta of value.sources){sourceMetadata(meta);need(!seen.has(meta.id),'PROCEDURE_SOURCE','Native source IDs must be unique.');seen.add(meta.id);}
  return {id:p.id,version:p.version,name:p.name,mode:p.mode,state:p.state,origin:clone(p.origin??{}),
    plan:{id:p.planId,revision:p.planRevision,contentSha256:value.plan.contentSha256}};
}
async function sourceOriginal(value) {
  only(value,['metadata','original'],'Selected case source');
  const meta=sourceMetadata(value.metadata),raw=value.original;
  only(raw,['text','bytes','sha256'],'Selected original source');
  const packed=await packProcedureText(raw.text);
  need(meta.sha256===packed.sha256&&meta.bytes===packed.bytes&&equal(packed,raw),
    'PROCEDURE_SOURCE_CHANGED','Keep the whole source together with its native metadata.');
  return meta;
}
function tableInput(value) {
  if(value?.schema===BOOK_SCHEMA||value?.schema===STORAGE_SCHEMA)return value;
  if(value?.planning?.sourceTables)return value.planning.sourceTables;
  throw new GrantProcedureError('PROCEDURE_TABLE','Select a complete planning source-table project or its retained native plan.');
}
async function tableSummary(value) {
  const book=await importPlanningBook(tableInput(value));
  return {id:book.id,name:book.name,baseline:clone(book.baseline),appliedReviewId:book.appliedReviewId,
    bindings:book.bindings.map(binding=>{
      const {doc,edition,rows,records,summary}=sourceTableRows(book,binding.role);
      return {role:binding.role,documentId:doc.id,resourceId:doc.resourceId,
        editionId:edition.id,editionSha256:edition.sha256??null,
        selectedReviewId:doc.selectedReviewId??null,baselineReviewId:doc.baselineReviewId??null,
        rows:rows.length,sourceRecords:records.length,summary:clone(summary),
        binding:clone(binding),mapping:clone(doc.mapping)};
    })};
}
/** Preserve the complete original input. No table reconstruction from report rows. */
export async function makeProcedureTable({key,origin,originalText,metadata=null,nativePlanText=null}) {
  text(key,'Table selection key',128,true);
  need(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(key)&&['case-plan','case-source','local-original'].includes(origin),
    'PROCEDURE_TABLE','Select an original table origin and stable key.');
  const original=await packProcedureText(originalText),value=await unpackProcedureText(original);
  if(origin==='case-source'){
    const meta=sourceMetadata(metadata);
    need(meta.bytes===original.bytes&&meta.sha256===original.sha256,'PROCEDURE_TABLE','The selected table must match its native source bytes.');
  }else need(metadata===null,'PROCEDURE_TABLE','Only native case sources have source metadata.');
  let nativePlan=null;
  if(origin==='case-plan'){
    need(typeof nativePlanText==='string','PROCEDURE_TABLE','Retain the complete original pinned plan for its selected table.');
    nativePlan=await packProcedureText(nativePlanText);const retained=await unpackProcedureText(nativePlan);
    ident(retained.id,'plan');positive(retained.revision,'Original source-table plan revision');hash(retained.contentSha256);
    need(equal(value,retained.planning?.sourceTables),'PROCEDURE_TABLE_CHANGED','Select the exact source-table field from the retained native plan.');
  }else need(nativePlanText===null,'PROCEDURE_TABLE','Only pinned-plan tables carry that original plan.');
  return {key,origin,metadata:metadata?clone(metadata):null,nativePlan,original,selection:await tableSummary(value)};
}
function selectedEdition(value,kind) {
  return kind==='installation'?value:value?.edition;
}
function stableEdition(value,kind) {
  if(kind==='task-outcome')return {source:clone(value.source),edition:clone(value.edition)};
  const result=clone(value);delete result.current;return result;
}
function sameRetainedEdition(received,expected,kind) {
  if(!equal(stableEdition(received,kind),stableEdition(expected,kind)))return false;
  // The original task view includes current case context and an append-only
  // descending history. Preserve its full captured bytes, while allowing a
  // later native edition to extend that history after receiving.
  return kind!=='task-outcome'||received.history.length>=expected.history.length&&
    equal(received.history.slice(received.history.length-expected.history.length),expected.history);
}
function editionRef(value,kind) {
  need(plain(value),'PROCEDURE_EDITION','Read the complete selected native edition.');
  const edition=selectedEdition(value,kind);
  need(plain(edition),'PROCEDURE_EDITION','Retain the native task view with its complete edition and source metadata.');
  ident(edition.id,kind==='installation'?'installation':'task-outcomes');positive(edition.revision,'Native edition');
  hash(edition.sha256);
  if(kind==='installation') {
    need(plain(edition.preview)&&edition.preview.schema==='stellar-forge.sf47-installation.v1'&&plain(edition.preview.document),
      'PROCEDURE_EDITION','Retain the complete original Installation edition.');
    positive(edition.version,'Installation case version');
  }else {
    need(edition.schema==='stellar-forge.sf47-customer-task-outcomes.v1'&&plain(edition.document)&&plain(edition.source)&&plain(edition.report),
      'PROCEDURE_EDITION','Retain the complete original customer task comparison.');
    positive(edition.caseVersion,'Comparison case version');sourceMetadata(value.source);
    const marker=value.source.customerTaskOutcomes;
    need(plain(marker)&&marker.schema===edition.schema&&marker.id===edition.id&&marker.revision===edition.revision&&marker.sha256===edition.sha256,
      'PROCEDURE_EDITION','The native task edition must match its original retained source marker.');
    need(plain(value.case)&&Array.isArray(value.history)&&value.history.length>=edition.revision&&value.history.length<=200,
      'PROCEDURE_EDITION','Retain the actual task view case and complete descending edition history.');
    ident(value.case.id,'operation');positive(value.case.version,'Current comparison case version');
    need(['OPEN','CLOSED'].includes(value.case.state)&&value.case.version>=edition.caseVersion,
      'PROCEDURE_EDITION','The task view must retain its actual current case context.');
    for(let i=0;i<value.history.length;i++){
      const row=value.history[i];
      need(plain(row)&&row.id===edition.id&&row.revision===value.history.length-i,
        'PROCEDURE_EDITION','The original task history must retain each native revision in descending order.');
      hash(row.sha256);ident(row.sourceId,'source');hash(row.sourceSha256);
      if(row.revision===edition.revision)need(row.sha256===edition.sha256&&row.sourceId===value.source.id&&row.sourceSha256===value.source.sha256,
        'PROCEDURE_EDITION','The selected task history entry differs from its original source.');
    }
  }
  return {id:edition.id,revision:edition.revision,sha256:edition.sha256};
}
export async function makeProcedureEdition(kind,originalText) {
  need(['installation','task-outcome'].includes(kind),'PROCEDURE_EDITION','Choose an Installation or task comparison.');
  const original=await packProcedureText(originalText),value=await unpackProcedureText(original);
  return {kind,ref:editionRef(value,kind),original};
}
function parentRef(meta,value,plan) {
  return {sourceId:meta.id,bytes:meta.bytes,sha256:meta.sha256,editionId:value.editionId,
    operatingPlanId:plan.id,headRevision:plan.revisions.length};
}
function linksFor(value,plan,tables,editions,sources) {
  need(Array.isArray(value)&&value.length<=1000,'PROCEDURE_LINKS','Retain the explicit step links.');
  const seen=new Set(),steps=new Set(plan.revisions.flatMap(x=>x.steps.map(y=>y.id))),
    tableKeys=new Set(tables.map(x=>x.key)),sourceIds=new Set(sources.map(x=>x.id)),
    editionKeys=new Set(editions.map(x=>x.kind+':'+x.ref.id+':'+x.ref.revision));
  for(const row of value){
    only(row,['stepId','sourceIds','tableKeys','editionKeys','note'],'Step source links');
    need(steps.has(row.stepId)&&!seen.has(row.stepId),'PROCEDURE_LINKS','Each linked step must exist in the retained history once.');seen.add(row.stepId);
    for(const [field,available] of [['sourceIds',sourceIds],['tableKeys',tableKeys],['editionKeys',editionKeys]]){
      need(Array.isArray(row[field])&&new Set(row[field]).size===row[field].length&&row[field].every(x=>available.has(x)),
        'PROCEDURE_LINKS','Each '+field+' link must select a complete retained original.');
    }
    text(row.note,'Step source note',12000);
  }
  return clone(value);
}
export async function inspectGrantProcedure(input) {
  let value=input;
  if(typeof input==='string'){need(new TextEncoder().encode(input).length<=GRANT_PROCEDURE_MAX_BYTES,'PROCEDURE_TOO_LARGE','The procedure exceeds the original attachment bound.');
    try{value=JSON.parse(input.replace(/^\uFEFF/,''));}catch{throw new GrantProcedureError('PROCEDURE_JSON','Open the complete procedure JSON.');}}
  only(value,['schema','editionId','createdAt','actor','note','case','nativePlan','operatingPlan','selectedRevision','sourceTables','editions','sources','stepLinks','parent'],'Grant procedure');
  need(value.schema===GRANT_PROCEDURE_SCHEMA,'PROCEDURE_SCHEMA','Open a complete Grant Operations procedure.');
  ident(value.editionId,'procedure');timestamp(value.createdAt);text(value.actor,'Recording operator',300,true);text(value.note,'Procedure note',12000);
  only(value.case,['id','version','name','mode','state','origin','plan'],'Original case selection');
  ident(value.case.id,'operation');positive(value.case.version,'Original case version');
  text(value.case.name,'Original case name',300,true);
  need(['OPERATIONS','WALKTHROUGH'].includes(value.case.mode)&&['OPEN','CLOSED'].includes(value.case.state)&&plain(value.case.origin),
    'PROCEDURE_CASE','Retain the original case purpose, state and origin.');
  only(value.case.plan,['id','revision','contentSha256'],'Native plan binding');
  ident(value.case.plan.id,'plan');positive(value.case.plan.revision,'Native plan revision');hash(value.case.plan.contentSha256);
  const nativePlan=await unpackProcedureText(value.nativePlan);
  need(nativePlan.id===value.case.plan.id&&nativePlan.revision===value.case.plan.revision&&nativePlan.contentSha256===value.case.plan.contentSha256,
    'PROCEDURE_CASE','The complete native plan differs from its original selection.');
  const plan=inspectOperatingPlan(await unpackProcedureText(value.operatingPlan));
  const selected=operatingPlanRevision(plan,value.selectedRevision);
  need(Array.isArray(value.sourceTables)&&value.sourceTables.length<=16&&Array.isArray(value.editions)&&value.editions.length<=32&&
    Array.isArray(value.sources)&&value.sources.length<=200,'PROCEDURE_CAPACITY','The complete procedure source selections exceed their supported count.');
  const sourceIds=new Set();
  for(const row of value.sources){sourceMetadata(row);need(!sourceIds.has(row.id),'PROCEDURE_SOURCE','Keep each source selection once.');sourceIds.add(row.id);}
  const keys=new Set();
  for(const table of value.sourceTables){
    only(table,['key','origin','metadata','nativePlan','original','selection'],'Source-table selection');
    need(!keys.has(table.key),'PROCEDURE_TABLE','Each table selection needs a distinct key.');keys.add(table.key);
    const rebuilt=await makeProcedureTable({key:table.key,origin:table.origin,metadata:table.metadata,originalText:table.original.text,nativePlanText:table.nativePlan?.text??null});
    need(equal(rebuilt,table),'PROCEDURE_TABLE_CHANGED','The selected table editions, bindings or original bytes differ.');
    if(table.origin==='case-source')need(value.sources.some(meta=>equal(meta,table.metadata)),
      'PROCEDURE_TABLE_CHANGED','Retain the native source metadata for a selected case table.');
  }
  const editionKeys=new Set();
  for(const edition of value.editions){
    only(edition,['kind','ref','original'],'Native edition selection');
    const rebuilt=await makeProcedureEdition(edition.kind,edition.original.text);
    const key=edition.kind+':'+edition.ref.id+':'+edition.ref.revision;
    need(!editionKeys.has(key)&&equal(edition,rebuilt),'PROCEDURE_EDITION_CHANGED','Keep each complete native edition exactly once.');editionKeys.add(key);
    const doc=await unpackProcedureText(edition.original);
    need((edition.kind==='installation'?doc.version:doc.edition.caseVersion)<=value.case.version,'PROCEDURE_EDITION_CHANGED','The selected edition is newer than the reviewed native case.');
    if(edition.kind==='task-outcome')need(value.sources.some(meta=>equal(meta,doc.source)),
      'PROCEDURE_SOURCE','Retain the complete original native source metadata for every selected task comparison.');
  }
  linksFor(value.stepLinks,plan,value.sourceTables,value.editions,value.sources);
  if(value.parent!==null){
    only(value.parent,['sourceId','bytes','sha256','editionId','operatingPlanId','headRevision'],'Preceding procedure');
    ident(value.parent.sourceId,'source');hash(value.parent.sha256);ident(value.parent.editionId,'procedure');
    positive(value.parent.bytes,'Preceding source size',GRANT_PROCEDURE_MAX_BYTES);positive(value.parent.headRevision,'Preceding plan history',1000000);
    need(value.parent.operatingPlanId===plan.id&&value.parent.headRevision<=plan.revisions.length,
      'PROCEDURE_HISTORY','Retain the complete original Operating Plan history.');
  }
  need(new TextEncoder().encode(procedureJSON(value)).length<=GRANT_PROCEDURE_MAX_BYTES,
    'PROCEDURE_TOO_LARGE','The complete procedure exceeds the original 8 MiB attachment limit.');
  return {document:clone(value),plan,selected,nativePlan,summary:summarizeOperatingPlan(plan,{revision:value.selectedRevision})};
}
export async function prepareGrantProcedure({current,operatingPlanText,selectedRevision,actor,note='',createdAt=new Date().toISOString(),
  editionId='procedure-'+crypto.randomUUID().replaceAll('-',''),sourceTables=[],editions=[],sourceIds=[],stepLinks=[],parent=null}) {
  const bound=nativeCase(current),packedPlan=await packProcedureText(operatingPlanText),plan=inspectOperatingPlan(await unpackProcedureText(packedPlan));
  const selected=operatingPlanRevision(plan,selectedRevision??plan.revisions.length);
  need(new Set(sourceIds).size===sourceIds.length,'PROCEDURE_SOURCE','Select each original source once.');
  const selectedSources=sourceIds.map(id=>{const meta=current.sources.find(x=>x.id===id);need(meta,'PROCEDURE_SOURCE','Selected source is absent from the original case: '+id);return sourceMetadata(meta);});
  for(const table of sourceTables)if(table.origin==='case-source'&&!selectedSources.some(x=>x.id===table.metadata?.id)){
    const meta=current.sources.find(x=>x.id===table.metadata?.id);
    need(meta&&equal(meta,table.metadata),'PROCEDURE_SOURCE','The table source belongs to the reviewed original case.');selectedSources.push(sourceMetadata(meta));
  }
  for(const item of editions)if(item.kind==='task-outcome'){
    const view=await unpackProcedureText(item.original);editionRef(view,item.kind);
    const meta=current.sources.find(x=>x.id===view.source.id);
    need(meta&&equal(meta,view.source),'PROCEDURE_SOURCE','The selected task comparison belongs to this original case source history.');
    if(!selectedSources.some(x=>x.id===meta.id))selectedSources.push(sourceMetadata(meta));
  }
  let previous=null;
  if(parent){
    await sourceOriginal(parent);
    const original=await inspectGrantProcedure(parent.original.text),meta=current.sources.find(x=>x.id===parent.metadata.id);
    need(meta&&equal(meta,parent.metadata),'PROCEDURE_HISTORY','The preceding procedure must be retained in this case.');
    const received=receiveOperatingPlan(plan,original.plan);
    need(received.plan.revisions.length===plan.revisions.length,'PROCEDURE_HISTORY','The new procedure must retain every prior saved revision.');
    previous=parentRef(meta,original.document,original.plan);
  }
  const document={schema:GRANT_PROCEDURE_SCHEMA,editionId,createdAt,actor,note,case:bound,
    nativePlan:await packProcedureText(procedureJSON(current.plan)),operatingPlan:packedPlan,
    selectedRevision:selected.revision,sourceTables:clone(sourceTables),editions:clone(editions),sources:selectedSources,
    stepLinks:clone(stepLinks),parent:previous};
  const inspected=await inspectGrantProcedure(document),raw=procedureJSON(document),identity=await packProcedureText(raw);
  return {...inspected,raw,bytes:identity.bytes,sha256:identity.sha256,
    filename:GRANT_PROCEDURE_PREFIX+document.editionId+'.json'};
}
/** Validate originals through the same case reader, including received-case identities. */
export async function verifyGrantProcedure(input,{current,readSource,readEdition,sourceId=null,verifyParents=true}={}) {
  const inspected=await inspectGrantProcedure(input),d=inspected.document,bound=nativeCase(current),verified=[],visited=new Set();
  need(typeof readSource==='function','PROCEDURE_READER','Use the original case source reader.');
  const bytesOf=async(meta)=>{
    const raw=await readSource(meta.id);
    need(raw instanceof Uint8Array&&raw.length===meta.bytes&&await procedureSha256(raw)===meta.sha256,
      'PROCEDURE_SOURCE_CHANGED','The complete source differs: '+meta.id);return raw;
  };
  const checked=new Map();
  async function checkSource(expected){
    const meta=current.sources.find(x=>x.id===expected.id);
    need(meta&&equal(meta,expected),'PROCEDURE_SOURCE_CHANGED','Retain the exact original case source metadata: '+expected.id);
    if(!checked.has(meta.id)){const raw=await bytesOf(meta);checked.set(meta.id,raw);verified.push({id:meta.id,bytes:raw.length,sha256:meta.sha256});}
    return checked.get(meta.id);
  }
  if(sourceId){
    const meta=current.sources.find(x=>x.id===sourceId);need(meta,'PROCEDURE_SOURCE','Select the original saved procedure source.');
    const raw=await checkSource(meta),decoded=new TextDecoder('utf-8',{fatal:true}).decode(raw);
    const original=await inspectGrantProcedure(decoded);
    need(equal(original.document,d),'PROCEDURE_SOURCE_CHANGED','The requested procedure differs from its native source.');
  }
  for(const meta of d.sources)await checkSource(meta);
  const verifiedEditions=[];
  for(const edition of d.editions){
    need(typeof readEdition==='function','PROCEDURE_READER','Use the original Installation/task comparison reader.');
    const received=await readEdition(edition.kind,clone(edition.ref)),expected=await unpackProcedureText(edition.original);
    need(equal(editionRef(received,edition.kind),edition.ref)&&sameRetainedEdition(received,expected,edition.kind),
      'PROCEDURE_EDITION_CHANGED','The complete selected native edition differs: '+edition.ref.id);
    verifiedEditions.push({kind:edition.kind,...edition.ref});
  }
  let cursor=d,cursorPlan=inspected.plan;const precedingTables=[];
  if(verifyParents)while(cursor.parent){
    const p=cursor.parent;need(!visited.has(p.sourceId)&&visited.size<200,'PROCEDURE_HISTORY','The preceding source chain is cyclic or exceeds the native case capacity.');visited.add(p.sourceId);
    const meta=current.sources.find(x=>x.id===p.sourceId);
    need(meta&&meta.bytes===p.bytes&&meta.sha256===p.sha256,'PROCEDURE_HISTORY','The original preceding procedure is absent or changed.');
    const raw=await checkSource(meta),prior=await inspectGrantProcedure(new TextDecoder('utf-8',{fatal:true}).decode(raw));
    need(prior.document.editionId===p.editionId&&prior.plan.id===p.operatingPlanId&&prior.plan.revisions.length===p.headRevision,
      'PROCEDURE_HISTORY','The preceding source identity differs.');
    const merged=receiveOperatingPlan(cursorPlan,prior.plan);
    need(merged.plan.revisions.length===cursorPlan.revisions.length,'PROCEDURE_HISTORY','A preceding saved revision is missing.');
    precedingTables.push(...prior.document.sourceTables);
    for(const original of prior.document.sources)await checkSource(original);
    for(const edition of prior.document.editions){
      need(typeof readEdition==='function','PROCEDURE_READER','Use the original native edition reader for prior history.');
      const received=await readEdition(edition.kind,clone(edition.ref)),expected=await unpackProcedureText(edition.original);
      need(equal(editionRef(received,edition.kind),edition.ref)&&sameRetainedEdition(received,expected,edition.kind),
        'PROCEDURE_EDITION_CHANGED','An edition cited by the original procedure history differs.');
      if(!verifiedEditions.some(x=>x.kind===edition.kind&&x.id===edition.ref.id&&x.revision===edition.ref.revision))
        verifiedEditions.push({kind:edition.kind,...edition.ref});
    }
    cursor=prior.document;cursorPlan=prior.plan;
  }
  for(const table of d.sourceTables)if(table.origin==='case-plan'){
    need(equal(table.nativePlan,d.nativePlan)||precedingTables.some(x=>equal(x,table)),
      'PROCEDURE_TABLE_ORIGIN','An older selected plan table must remain linked to its original preceding procedure.');
  }
  return {schema:GRANT_PROCEDURE_REPORT_SCHEMA,editionId:d.editionId,operatingPlanId:inspected.plan.id,
    selectedRevision:d.selectedRevision,headRevision:inspected.plan.revisions.length,
    originalCase:clone(d.case),receivingCase:bound,sourceId,
    sameCase:bound.id===d.case.id,currentPlanMatches:bound.plan.contentSha256===d.case.plan.contentSha256,
    verifiedSources:verified,verifiedEditions,verifiedParentSources:[...visited],
    sourceTables:d.sourceTables.map(x=>({key:x.key,origin:x.origin,selection:clone(x.selection)})),
    stepLinks:clone(d.stepLinks),summary:inspected.summary,
    interpretation:'Step statuses and results are the named operator’s recorded procedure. Native evidence remains separately selected; no command execution, customer outcome or financial award is inferred.'};
}
export function procedureCandidates(current) {
  nativeCase(current);
  return current.sources.filter(x=>x.mediaType==='application/json'&&x.filename.startsWith(GRANT_PROCEDURE_PREFIX)&&x.filename.endsWith('.json')).map(clone);
}
export async function grantProcedureFiles(input,verification=null) {
  const inspected=await inspectGrantProcedure(input),d=inspected.document;
  const files={'grant-procedure.json':typeof input==='string'?input:procedureJSON(d),
    'operating-plan.json':d.operatingPlan.text,'native-plan.json':d.nativePlan.text,
    'procedure.html':renderOperatingPlanHTML(inspected.plan,{revision:d.selectedRevision}),
    'procedure.md':renderOperatingPlanMarkdown(inspected.plan,{revision:d.selectedRevision}),
    'source-links.json':procedureJSON({case:d.case,sourceTables:d.sourceTables.map(x=>({key:x.key,origin:x.origin,metadata:x.metadata,selection:x.selection})),
      sources:d.sources,editions:d.editions.map(x=>({kind:x.kind,ref:x.ref,original:{bytes:x.original.bytes,sha256:x.original.sha256}})),stepLinks:d.stepLinks,parent:d.parent})};
  d.sourceTables.forEach((x,i)=>{files['table-'+(i+1)+'.json']=x.original.text;});
  d.editions.forEach((x,i)=>{files[x.kind+'-'+(i+1)+'.json']=x.original.text;});
  if(verification!==null)files['receiving-inspection.json']=procedureJSON(verification);
  files['README.md']='# '+inspected.summary.title+'\n\nOpen procedure.html for the selected operating steps. operating-plan.json is the complete original Command finder plan, including every saved revision. Import it through Operating plans to continue that history.\n\nThe original Grant Operations case ZIP travels beside these files. Import that ZIP through the existing application or grant-procedures receive, then reopen grant-procedure.json from Sources / Operating procedures. The original importer assigns a new case ID and preserves all source bytes and prior history. Use the explicit source links to inspect the selected tables, Installation editions and task comparisons. Authored status text does not create a payment, completed task or measured customer result.\n';
  const members=[];for(const [name,raw] of Object.entries(files)){const p=await packProcedureText(raw);members.push({name,bytes:p.bytes,sha256:p.sha256});}
  files['MANIFEST.json']=procedureJSON({schema:GRANT_PROCEDURE_SCHEMA+'.files',editionId:d.editionId,operatingPlanId:inspected.plan.id,
    selectedRevision:d.selectedRevision,members});
  return files;
}
