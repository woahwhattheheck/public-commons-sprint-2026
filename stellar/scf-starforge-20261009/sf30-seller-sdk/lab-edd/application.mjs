// MIT. Complete laboratory source review through the original sealed-file paid-job runtime.
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createScientificArchive } from '../wqx-water-quality/jobs/archive.mjs';
import { labProfile } from './profiles.mjs';
import { inspectDelivery, normalizeDecisions, previewDelivery, renderPreparedFiles, compareDeliveries, canonicalJson, sha256 } from './model.mjs';
import { decodeText, labError } from './table.mjs';
import { readLabZip, writeLabZip } from './zip.mjs';
import { reviewTable, parseReviewTable, issueTable } from './decisions.mjs';
import { renderLabReport } from './report.mjs';
const JSON_BYTES=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const SOURCE_LIMIT=16777216,DECISION_LIMIT=4194304;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function request(input){
  const keys=['profile','reviewName','expectedSourceSha256','encoding','decisionFormat','tableScope','tableFields','$files'];
  if(!plain(input)||Object.keys(input).some(key=>!keys.includes(key))||
    typeof input.profile!=='string'||typeof input.reviewName!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(input.reviewName))
    labError('REQUEST','Select an installed profile and a stable review name.');
  if(input.expectedSourceSha256!==undefined&&!/^[0-9a-f]{64}$/.test(input.expectedSourceSha256))
    labError('SOURCE_HASH','Use an exact source SHA256.');
  if(input.encoding!==undefined&&!['utf-8','windows-1252'].includes(input.encoding))
    labError('ENCODING','Use the original text encoding.');
  if(input.decisionFormat!==undefined&&!['json','csv','tsv'].includes(input.decisionFormat))
    labError('DECISION_FORMAT','Select the exact decision document representation.');
  if(input.tableScope!==undefined&&!['issues','all'].includes(input.tableScope))
    labError('TABLE_SCOPE','Select issue fields or all selected fields for the editable table.');
  return input;
}
function sourceName(metadata){
  if(!plain(metadata)||typeof metadata.filename!=='string'||!metadata.filename.length)
    labError('FILE_DESCRIPTOR','The original file descriptor must retain its filename.');
  return metadata.filename;
}
export function sourceMembers(bytes,metadata,{signal}={}){
  const name=sourceName(metadata);
  if(/\.(?:xlsx|xls)$/i.test(name))return [{filename:name,bytes,mediaType:metadata.mediaType??metadata.contentType}];
  if(/\.zip$/i.test(name)||(metadata.mediaType??metadata.contentType)==='application/zip')
    return readLabZip(bytes,{maxBytes:67108864,signal});
  return [{filename:name,bytes,mediaType:metadata.mediaType??metadata.contentType}];
}
function extension(metadata){
  const match=/\.(xlsx|xls|zip|csv|tsv|json|txt)$/i.exec(sourceName(metadata));
  return match?match[1].toLowerCase():'bin';
}
function decisionFormat(input,metadata){
  if(input.decisionFormat)return input.decisionFormat;
  const name=sourceName(metadata),mime=metadata.mediaType??metadata.contentType;
  return /\.tsv$/i.test(name)||mime==='text/tab-separated-values'?'tsv':/\.csv$/i.test(name)||mime==='text/csv'?'csv':'json';
}
export function readLabDecisions(delivery,bytes,metadata,format){
  const text=decodeText(bytes).replace(/^\uFEFF/,''),selected=decisionFormat({decisionFormat:format},metadata);
  if(selected!=='json')return parseReviewTable(delivery,text,{format:selected});
  try{return normalizeDecisions(delivery,JSON.parse(text));}
  catch(error){if(error.code)throw error;labError('DECISION_JSON','The complete decision file is not valid JSON.');}
}
function guide(manifest){
  return [
    '# Laboratory EDD receiving','',
    'Open report.html to review the complete original records, native profile observations, source lineage and explicit field decisions.',
    'The report is a self-contained local editor. It reopens the original decision JSON, records keep/set/clear actions with reasons, and downloads a complete source-bound decision document.',
    'Run that document with the same source file through the existing Request application or the supplied command. The original job runtime owns saved requests, sealed files, checkout, execution and result receiving.','',
    '## Native receiving files','',
    manifest.nativePreparation.status==='PREPARED'?
      'prepared/receiving-files.zip contains every resulting native member under its original or profile-defined filename.':
      'Native preparation requires further review. native-preparation.json retains its exact refusal; the complete original input, profile report, editable decisions and offline editor are available in this result.',
    'For a workbook profile, use its prepared native workbook. The selected DTS format emits an actual XLSX workbook.',
    'Original inputs remain under original/. manifest.json binds their original names, hashes, selected source profile and result members.',
    'The source/ description and rows retain every original field, worksheet representation and native identifier.',
    'review.json records the computed before/after profile observations and every field decision. issues.csv and lineage.json retain the complete native report.',
    'The editable CSV and TSV tables include a source-binding row. Keep their identity, before-value and reason fields when editing.','',
    '## Continue the same original source review','',
    'Use the installed Request application to select this same function and original source. Add the downloaded decision JSON or table in the decisions slot.',
    'From a source-pinned installation:','',
    '    starforge lab-edd receive --source /absolute/original-source --profile '+manifest.profile.id+' --review '+manifest.reviewName+' --decisions /absolute/lab-edd-decisions.json --out /absolute/new-result.zip','',
    'Use a new result output path for a changed request; the original job entry retains its own execution and same-job recovery identity.','',
    '## Receiving scope','',
    'Each profile states its actual format and native field checks. The receiving organization supplies its selected format version, current reference values, and final native import result.',
    'The application preserves source laboratory qualifiers, detection limits, reported blank results and units. It records explicit edits in a separate source-bound document.',
    'Reissue comparison uses the selected profile’s complete identity. Every ambiguous duplicate remains available for review.','',
    'Job: '+manifest.jobId,
    'Original source: '+manifest.sourceSha256,
    'Profile: '+manifest.profile.id+' / '+manifest.profile.version,
    'Decision: '+manifest.documentSha256,
    'Computed review: '+manifest.reviewSha256,
    'Native preparation: '+manifest.nativePreparation.status,'',
  ].join('\n');
}
export async function laboratoryReview(input,context){
  request(input);
  if(!context?.files||!context.signal||typeof context.jobId!=='string')labError('RECEIVER','Use the original sealed-file application receiver.');
  const profile=labProfile(input.profile),signal=context.signal,descriptors=context.files.list();
  signal.throwIfAborted();
  if(!Array.isArray(descriptors)||!descriptors.some(file=>file.slot==='source')||
    descriptors.some(file=>!['source','baseline','decisions'].includes(file.slot)))
    labError('FILE_SLOTS','Use source, optional baseline and optional decisions file slots.');
  const has=slot=>descriptors.some(file=>file.slot===slot),metadata=slot=>context.files.metadata(slot);
  const parent=resolve(process.env.LAB_EDD_TEMP_ROOT||tmpdir());await mkdir(parent,{recursive:true,mode:0o700});
  const directory=await mkdtemp(join(await realpath(parent),'lab-edd-'+sha256(context.jobId).slice(0,16)+'-'));
  const outputPath=join(directory,'laboratory-review.zip');let archive;
  try{
    archive=await createScientificArchive(outputPath,{signal});
    const originalNames={};
    for(const slot of ['source','baseline','decisions'])if(has(slot)){
      const meta=metadata(slot),name='original/'+slot+'.'+extension(meta);originalNames[slot]=name;
      await archive.add(name,context.files.stream(slot),{contentType:meta.mediaType??meta.contentType??'application/octet-stream',expected:meta});
    }
    const sourceBytes=await context.files.read('source',{maxBytes:SOURCE_LIMIT});
    const delivery=await inspectDelivery(sourceMembers(sourceBytes,metadata('source'),{signal}),profile,{encoding:input.encoding??'utf-8',signal,processes:context.processes});
    if(input.expectedSourceSha256&&input.expectedSourceSha256!==delivery.source.sourceSha256)
      labError('SOURCE_CHANGED','The selected originals do not match the requested source edition.');
    let comparison=null;
    if(has('baseline')){
      const bytes=await context.files.read('baseline',{maxBytes:SOURCE_LIMIT});
      const baseline=await inspectDelivery(sourceMembers(bytes,metadata('baseline'),{signal}),profile,{encoding:input.encoding??'utf-8',signal,processes:context.processes});
      comparison=compareDeliveries(delivery,baseline);
    }
    let document;
    if(has('decisions')){
      const bytes=await context.files.read('decisions',{maxBytes:DECISION_LIMIT});
      document=readLabDecisions(delivery,bytes,metadata('decisions'),input.decisionFormat);
    }else document=normalizeDecisions(delivery);
    const review=previewDelivery(delivery,document);
    let prepared=[],nativeZip=null,nativePreparation;
    try{
      prepared=await renderPreparedFiles(delivery,review,{signal,processes:context.processes});
      nativeZip=writeLabZip(prepared,{signal});
      nativePreparation={status:'PREPARED',files:prepared.length};
    }catch(error){
      signal.throwIfAborted();
      nativePreparation={status:'REVIEW_REQUIRED',error:{code:String(error.code??'NATIVE_PREPARATION'),message:String(error.message??error),
        ...((error.details??error.detail)===undefined?{}:{detail:error.details??error.detail})}};
    }
    if(nativeZip)await archive.add('prepared/receiving-files.zip',nativeZip,{contentType:'application/zip'});
    await archive.add('native-preparation.json',JSON_BYTES(nativePreparation),{contentType:'application/json'});
    const links={'Native preparation state':'native-preparation.json','Computed review JSON':'review.json',
      'Complete profile observations CSV':'issues.csv','Editable decision CSV':'decisions.csv','Editable decision TSV':'decisions.tsv',
      'Original source file':originalNames.source};
    if(nativeZip)links['Native receiving files']='prepared/receiving-files.zip';
    links['Complete original rows']='source/rows.json';links['Full lineage']='lineage.json';
    if(originalNames.baseline)links['Original earlier delivery']=originalNames.baseline;
    if(originalNames.decisions)links['Original supplied decisions']=originalNames.decisions;
    if(comparison)links['Complete reissue comparison']='comparison.json';
    let directNative=null;
    if(prepared.length===1){
      const ext=/\.(xlsx|xls|csv|tsv|txt)$/i.exec(prepared[0].filename)?.[1].toLowerCase()??'bin';
      directNative='prepared/native-output.'+ext;
      await archive.add(directNative,prepared[0].bytes,{contentType:prepared[0].mediaType??'application/octet-stream'});
      links['Native '+prepared[0].filename]={path:directNative,filename:prepared[0].filename.split('/').at(-1)};
    }
    const tables={};
    for(const format of ['csv','tsv']){
      signal.throwIfAborted();
      const result=reviewTable(delivery,document,{format,scope:input.tableScope??'issues',fields:input.tableFields});
      await archive.add('decisions.'+format,Buffer.from(result.text),{contentType:result.mime});
      tables[format]={bytes:Buffer.byteLength(result.text),sha256:sha256(result.text),rows:result.rows};
    }
    await archive.add('source/manifest.json',JSON_BYTES({...delivery.source,unassigned:delivery.unassigned}),{contentType:'application/json'});
    await archive.add('source/rows.json',JSON_BYTES(delivery.tables),{contentType:'application/json'});
    await archive.add('decisions.json',JSON_BYTES(document),{contentType:'application/json'});
    await archive.add('review.json',JSON_BYTES(review),{contentType:'application/json'});
    await archive.add('issues.csv',Buffer.from(issueTable({...delivery,report:review.report})),{contentType:'text/csv'});
    await archive.add('lineage.json',JSON_BYTES(review.report.lineage),{contentType:'application/json'});
    if(comparison)await archive.add('comparison.json',JSON_BYTES(comparison),{contentType:'application/json'});
    await archive.add('report.html',Buffer.from(renderLabReport(delivery,review,{comparison,links,nativePreparation})),{contentType:'text/html; charset=utf-8'});
    const manifest={schema:'starforge.lab-edd-job-result.v1',jobId:context.jobId,functionId:'laboratoryReview',
      reviewName:input.reviewName,profile:delivery.source.profile,sourceSha256:delivery.source.sourceSha256,
      documentSha256:review.documentSha256,reviewSha256:review.reviewSha256,sourceFiles:descriptors,
      request:Object.fromEntries(Object.entries(input).filter(([key])=>key!=='$files')),originalMembers:originalNames,
      report:{summary:review.report.summary,counts:review.report.counts,disposition:review.report.disposition},
      changes:review.changes,comparison:comparison?{disposition:comparison.disposition,counts:comparison.counts}:null,
      nativePreparation,prepared:nativeZip?{archive:'prepared/receiving-files.zip',bytes:nativeZip.byteLength,sha256:sha256(nativeZip),
        files:prepared.map(file=>({filename:file.filename,bytes:file.size,sha256:file.sha256,mediaType:file.mediaType??null})),
        directMember:directNative}:null,editableTables:tables};
    await archive.add('README.md',Buffer.from(guide(manifest)),{contentType:'text/markdown; charset=utf-8'});
    manifest.members=archive.members();await archive.add('manifest.json',JSON_BYTES(manifest),{contentType:'application/json'});
    await archive.finish();signal.throwIfAborted();return await readFile(outputPath);
  }finally{try{await archive?.close();}finally{await rm(directory,{recursive:true,force:true});}}
}
