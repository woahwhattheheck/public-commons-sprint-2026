// MIT. Exact DBnomics editions for the maintained Python Analysis document reader.
import {join,resolve} from 'node:path';
import {readJson,privateDirectory} from '../postgres/publisher/files.mjs';
import {need,isRecord,clone,canonical,digest,hash,jsonBytes,operationId,text,
  rowsCsv,calculateReport,MAX_CAPTURE_BYTES} from './model.mjs';
import {inspectDbnomicsCapture,exactFile} from './provider.mjs';
import {readOriginalFile,HASH} from './source.mjs';

export const DBNOMICS_ANALYSIS_SCHEMA='stellar-forge.dbnomics-analysis-source.v1';
export const DBNOMICS_ANALYSIS_BUNDLE='stellar-forge.dbnomics-analysis-delivery.v1';
const DOCUMENT='stellar-forge.analysis-source-document.v1';
const HANDOVER='stellar-forge.dbnomics-source-handover.v1';
const CHUNK=32*1024*1024,MAX_TOTAL=256*1024*1024;
export const DBNOMICS_ANALYSIS_COLUMNS=Object.freeze([
  'record_id','record_kind','observation_id','report_id','report_title',
  'series_id','series_name','provider','dataset','frequency','period',
  'period_start_day','period_order','calendar_issue','value_text','value_state',
  'calculated_value','calculation','calculation_reason','base_period',
  'base_observation_id','base_value_text','precision','source_updated_at',
  'response_sha256','capture_id','capture_sha256','notes_revision','notes_sha256',
  'dimensions_json','attributes_json','note_id','note_author','note_tag','note_text','review_note'
]);
export const DBNOMICS_WORKBOOK_COLUMNS=Object.freeze(DBNOMICS_ANALYSIS_COLUMNS.filter(
  key=>!['dimensions_json','attributes_json'].includes(key)));
export function normalizeDbnomicsAnalysisSelection(input){
  need(isRecord(input)&&Object.keys(input).every(k=>['captureId','captureSha256','reportIds','notesRevision','title'].includes(k)),
    'Use the documented complete economic source selection.');
  need(HASH.test(input.captureId??'')&&HASH.test(input.captureSha256??''),'Bind the exact original capture ID and file SHA256.');
  need(Number.isSafeInteger(input.notesRevision)&&input.notesRevision>=0,'Select an exact saved notes revision, including zero.');
  const reportIds=input.reportIds??[];
  need(Array.isArray(reportIds)&&reportIds.length<=32&&new Set(reportIds).size===reportIds.length,
    'Choose at most 32 distinct complete saved reports.');
  reportIds.forEach(operationId);
  return {captureId:input.captureId,captureSha256:input.captureSha256,reportIds:[...reportIds],
    notesRevision:input.notesRevision,title:text(input.title??'DBnomics economic analysis','analysis title',160)};
}
const contentRecord=(bytes,type,extension)=>({path:'files/'+hash(bytes)+'.'+extension,
  bytes:bytes.length,sha256:hash(bytes),contentType:type});
function originalNotes(bundle,captureId,revision,captureSha256){
  if(revision===0)return {schema:'stellar-forge.dbnomics-notes.v1',captureId,revision:0,entries:[],sha256:null};
  const matches=bundle.notes.filter(n=>n.captureId===captureId&&n.revision===revision);
  need(matches.length===1,'The exact selected notes revision is absent or duplicated.');
  const value=matches[0];
  need(value.schema==='stellar-forge.dbnomics-notes.v1'&&value.captureSha256===captureSha256&&Array.isArray(value.entries),
    'The selected notes do not belong to this capture.');
  return {...value,sha256:hash(jsonBytes(value))};
}
function baseRow(selection){
  return Object.fromEntries(DBNOMICS_ANALYSIS_COLUMNS.map(k=>[k,
    k==='capture_id'?selection.captureId:k==='capture_sha256'?selection.captureSha256:
    k==='notes_revision'?String(selection.notesRevision):'']));
}
function observation(row,selection,noteSha){
  return {...baseRow(selection),observation_id:row.observationId,series_id:row.seriesId,
    series_name:row.seriesName,provider:row.provider,dataset:row.dataset,frequency:row.frequency,
    period:row.period,period_start_day:row.periodStartDay??'',period_order:row.periodOrdinal===null?'':String(row.periodOrdinal),
    calendar_issue:row.calendarIssue??'',value_text:row.valueText,
    value_state:row.missingReason??'NUMBER',source_updated_at:row.sourceUpdatedAt??'',
    response_sha256:row.responseSha256,notes_sha256:noteSha??'',
    dimensions_json:canonical(row.dimensions),attributes_json:canonical(row.attributes)};
}
export function buildDbnomicsAnalysisSource(bundle,input,{createdAt}={}){
  const selection=normalizeDbnomicsAnalysisSelection(input);
  need(isRecord(bundle)&&bundle.schema===HANDOVER&&Array.isArray(bundle.captures)&&Array.isArray(bundle.notes)&&Array.isArray(bundle.reports),
    'Supply the complete original DBnomics source handover.');
  const {bundleSha256,...body}=bundle;
  need(HASH.test(bundleSha256??'')&&digest(body)===bundleSha256,'The original source handover changed.','DBNOMICS_HANDOVER_CHANGED',409);
  need(typeof createdAt==='string'&&Number.isFinite(Date.parse(createdAt)),'Retain the source operation creation time.');
  const originals=bundle.captures.filter(c=>c.captureId===selection.captureId);
  need(originals.length===1,'Choose one exact original capture from the handover.');
  const capture=originals[0],captureBytes=jsonBytes(capture),model=inspectDbnomicsCapture(capture);
  need(hash(captureBytes)===selection.captureSha256,'The selected capture file digest changed.','DBNOMICS_CAPTURE_CONFLICT',409);
  const notes=originalNotes(bundle,selection.captureId,selection.notesRevision,selection.captureSha256);
  const byObservation=new Map(model.rows.map(row=>[row.observationId,row]));
  need(notes.entries.every(note=>note.observationId===null||byObservation.has(note.observationId)),
    'The selected notes contain an observation outside the captured source.');
  const reports=selection.reportIds.map(id=>{
    const found=bundle.reports.filter(r=>r.reportId===id);
    need(found.length===1,'A selected complete report is absent or duplicated: '+id);
    const report=found[0],rebuilt=calculateReport(model,report.spec);
    need(report.schema===rebuilt.schema&&report.captureId===selection.captureId&&report.captureSha256===selection.captureSha256&&
      ['rows','series','rowCount','missingCalculations','methodology','terms'].every(k=>canonical(report[k])===canonical(rebuilt[k])),
      'The selected report differs from its exact original calculation: '+id,'DBNOMICS_REPORT_CHANGED',409);
    const reportNotes=originalNotes(bundle,selection.captureId,report.notesRevision,selection.captureSha256);
    need(report.notesSha256===reportNotes.sha256&&canonical(report.analystNotes)===canonical(reportNotes.entries),
      'The selected report has another notes edition: '+id);
    return report;
  });
  const rows=[],counts={observation:0,calculation:0,series:0,note:0};
  const append=(kind,row)=>{need(rows.length<1000000,'This complete analyst edition exceeds one million records.');
    rows.push({...row,record_kind:kind});counts[kind]++;};
  for(const row of model.rows)append('observation',{...observation(row,selection,notes.sha256),
    record_id:digest({kind:'observation',observationId:row.observationId})});
  for(const report of reports)for(const row of report.rows){
    const base=row.baseObservationId?byObservation.get(row.baseObservationId):null;
    append('calculation',{...observation(row,selection,report.notesSha256),
      record_id:digest({kind:'calculation',reportId:report.reportId,observationId:row.observationId}),
      report_id:report.reportId,report_title:report.spec.title,
      notes_revision:String(report.notesRevision),calculated_value:row.calculatedValue===null?'':String(row.calculatedValue),
      calculation:row.calculation,calculation_reason:row.calculationReason??'',
      base_period:row.basePeriod??'',base_observation_id:row.baseObservationId??'',
      base_value_text:base?.valueText??'',precision:row.precision});
  }
  for(const series of model.series)append('series',{...baseRow(selection),
    record_id:digest({kind:'series',seriesId:series.id}),series_id:series.id,series_name:series.name,
    provider:series.provider,dataset:series.dataset,frequency:series.frequency,value_state:'NOT_APPLICABLE',
    source_updated_at:series.sourceUpdatedAt??'',response_sha256:series.responseSha256,
    dimensions_json:canonical(series.dimensions),notes_sha256:notes.sha256??''});
  for(const note of notes.entries)append('note',{...baseRow(selection),
    ...(note.observationId?observation(byObservation.get(note.observationId),selection,notes.sha256):{}),
    record_id:digest({kind:'note',captureId:selection.captureId,revision:selection.notesRevision,noteId:note.id}),
    observation_id:note.observationId??'',value_state:note.observationId?
      (byObservation.get(note.observationId).missingReason??'NUMBER'):'NOT_APPLICABLE',
    note_id:note.id,note_author:note.author,note_tag:note.tag,note_text:note.text,notes_sha256:notes.sha256??''});
  need(new Set(rows.map(r=>r.record_id)).size===rows.length,'The complete economic record identity repeats.');
  const csv=Buffer.from(rowsCsv(rows,DBNOMICS_ANALYSIS_COLUMNS)),handoverBytes=jsonBytes(bundle);
  need(csv.length<=MAX_CAPTURE_BYTES&&handoverBytes.length<=MAX_CAPTURE_BYTES,
    'The complete analyst table or original source handover exceeds 128 MiB.');
  const files=new Map(),document=contentRecord(csv,'text/csv; charset=utf-8','csv');
  files.set(document.path,csv);
  const retained=[],parts=[];
  for(let offset=0,index=0;offset<handoverBytes.length;offset+=CHUNK,index++){
    const bytes=handoverBytes.subarray(offset,Math.min(handoverBytes.length,offset+CHUNK));
    const record={...contentRecord(bytes,'application/octet-stream','bin'),
      role:'dbnomics-source-handover-part-'+String(index+1).padStart(3,'0')};
    files.set(record.path,bytes);retained.push(record);parts.push({role:record.role,bytes:record.bytes,sha256:record.sha256});
  }
  const mapping={collection:'',columns:DBNOMICS_ANALYSIS_COLUMNS.map(name=>({name,pointer:'/'+name,type:'text',missing:'error'}))};
  const receipt={schema:DBNOMICS_ANALYSIS_SCHEMA,createdAt,selection,
    identity:{project:clone(bundle.project),captureId:selection.captureId,captureSha256:selection.captureSha256,
      sourceBundleSha256:bundleSha256,sourceFileSha256:hash(handoverBytes),selectionSha256:digest(selection)},
    rowCount:rows.length,counts,columns:[...DBNOMICS_ANALYSIS_COLUMNS],workbookColumns:[...DBNOMICS_WORKBOOK_COLUMNS],mapping,
    notes:{revision:notes.revision,sha256:notes.sha256,entries:notes.entries.length},
    reports:reports.map(r=>({id:r.reportId,sha256:hash(jsonBytes(r)),title:r.spec.title,rows:r.rowCount,
      spec:r.spec,notesRevision:r.notesRevision,notesSha256:r.notesSha256,methodology:r.methodology})),
    series:clone(model.series),terms:clone(capture.terms),retrievalWindow:clone(model.retrievalWindow),
    archives:[{role:'dbnomics-source-handover',bytes:handoverBytes.length,sha256:hash(handoverBytes),
      contentType:'application/json; charset=utf-8',parts}],
    valueSemantics:'Source numeric spellings, NA/null states, original periods and exact calendar calculations are retained. Empty fields outside their record kind are not applicable. Derived calculations use IEEE-754; exact original values remain value_text and base_value_text.',
    reviewSemantics:'review_note is operator-authored commentary. A returned workbook is a separately retained edition compared through the original Analysis DatasetChanges; it cannot change provider captures.'};
  const receiptBytes=jsonBytes(receipt),receiptFile={...contentRecord(receiptBytes,'application/json; charset=utf-8','json'),role:'analysis-receipt'};
  need(receiptBytes.length<=CHUNK,'The complete source context exceeds 32 MiB.');
  files.set(receiptFile.path,receiptBytes);retained.push(receiptFile);
  need([...files.values()].reduce((n,b)=>n+b.length,0)<=MAX_TOTAL,'The complete Analysis document source exceeds 256 MiB.');
  const manifest={schema:DOCUMENT,title:selection.title,format:'csv',complete:true,document,originals:retained,
    provenance:{kind:'public-source',publisher:'DBnomics / '+[...new Set(model.series.map(s=>s.provider))].join(', '),
      capturedAt:model.retrievedAt,sourceUrl:'https://db.nomics.world/',
      scope:selection.captureId+' / '+model.rowCount+' original observations / '+reports.length+' saved reports',
      description:receipt.valueSemantics+' '+receipt.reviewSemantics}};
  const manifestBytes=jsonBytes(manifest);
  return {manifest,manifestBytes,documentId:hash(manifestBytes),receipt,files,rows};
}
export async function writeDbnomicsAnalysisSource(directory,built){
  directory=resolve(directory);await privateDirectory(directory,true);await privateDirectory(join(directory,'files'),true);
  for(const[path,bytes]of built.files)await exactFile(join(directory,'files'),path.slice(6),bytes);
  await exactFile(directory,'source.json',built.manifestBytes);
  return {directory,documentId:built.documentId,manifestSha256:built.documentId,
    selection:built.receipt.selection,sourceBundleSha256:built.receipt.identity.sourceBundleSha256,
    rowCount:built.receipt.rowCount,counts:built.receipt.counts,
    files:[{path:'source.json',bytes:built.manifestBytes.length,sha256:built.documentId,contentType:'application/json; charset=utf-8'},
      built.manifest.document,...built.manifest.originals]};
}
export async function readDbnomicsAnalysisSource(directory){
  directory=resolve(directory);const raw=await readOriginalFile(join(directory,'source.json'),1024*1024),manifest=JSON.parse(raw);
  need(manifest.schema===DOCUMENT&&manifest.complete===true&&manifest.format==='csv'&&Array.isArray(manifest.originals),
    'The complete economic Analysis descriptor is invalid.');
  const files=new Map([['source.json',raw]]),descriptors=[manifest.document,...manifest.originals];
  for(const item of descriptors){
    need(isRecord(item)&&/^files\/[a-f0-9]{64}\.(csv|json|bin)$/.test(item.path??'')&&
      item.path.slice(6,70)===item.sha256&&Number.isSafeInteger(item.bytes)&&item.bytes>=0&&item.bytes<=MAX_TOTAL,
      'The economic source file descriptor is invalid.');
    const bytes=await readOriginalFile(join(directory,item.path),item.bytes);
    need(bytes.length===item.bytes&&hash(bytes)===item.sha256,'A complete retained economic source file changed.','DBNOMICS_ANALYSIS_SOURCE_CHANGED',409);
    files.set(item.path,bytes);
  }
  const receipts=manifest.originals.filter(f=>f.role==='analysis-receipt');
  need(receipts.length===1,'The exact economic analysis receipt is required.');
  const receipt=JSON.parse(files.get(receipts[0].path));
  need(receipt.schema===DBNOMICS_ANALYSIS_SCHEMA&&digest(receipt.selection)===receipt.identity?.selectionSha256,
    'The economic selection identity changed.');
  const original=receipt.archives?.find(a=>a.role==='dbnomics-source-handover');
  need(original&&Array.isArray(original.parts),'The original DBnomics handover is absent.');
  const parts=original.parts.map(part=>{
    const refs=manifest.originals.filter(f=>f.role===part.role);
    need(refs.length===1&&refs[0].bytes===part.bytes&&refs[0].sha256===part.sha256,'An original source part changed.');
    return files.get(refs[0].path);
  }),sourceBytes=Buffer.concat(parts);
  need(sourceBytes.length===original.bytes&&hash(sourceBytes)===original.sha256&&original.sha256===receipt.identity.sourceFileSha256,
    'The complete original economic source handover changed.');
  const built=buildDbnomicsAnalysisSource(JSON.parse(sourceBytes),receipt.selection,{createdAt:receipt.createdAt});
  need(built.documentId===hash(raw)&&canonical(built.receipt)===canonical(receipt),
    'The economic source does not reproduce its original mapped edition.','DBNOMICS_ANALYSIS_SOURCE_CHANGED',409);
  for(const[path,bytes]of built.files)need(files.has(path)&&Buffer.compare(files.get(path),bytes)===0,'A mapped economic source file changed.');
  return {directory,manifest,manifestBytes:raw,documentId:hash(raw),receipt,files,sourceBytes};
}
export async function exportDbnomicsAnalysisSource(directory){
  const value=await readDbnomicsAnalysisSource(directory);
  return {schema:DBNOMICS_ANALYSIS_BUNDLE,documentId:value.documentId,selection:value.receipt.selection,
    files:[...value.files].map(([path,bytes])=>({path,bytes:bytes.length,sha256:hash(bytes),contentBase64:bytes.toString('base64')}))};
}
export async function copyDbnomicsAnalysisSource(directory,destination){
  const value=await readDbnomicsAnalysisSource(directory);
  await privateDirectory(resolve(destination),true);await privateDirectory(join(resolve(destination),'files'),true);
  for(const[path,bytes]of value.files)await exactFile(path==='source.json'?resolve(destination):join(resolve(destination),'files'),
    path==='source.json'?path:path.slice(6),bytes);
  return {directory:resolve(destination),documentId:value.documentId,selection:value.receipt.selection,rowCount:value.receipt.rowCount};
}
