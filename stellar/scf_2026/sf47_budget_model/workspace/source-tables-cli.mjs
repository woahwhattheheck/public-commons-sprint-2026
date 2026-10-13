#!/usr/bin/env node
// MIT. Headless source-table authoring uses the original Python planning writer.
import {readFile, mkdir, open, link, unlink, mkdtemp, rename, rm, stat} from 'node:fs/promises';
import {dirname, resolve, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash, randomUUID} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import {receivePlanningFile} from '../../../../stellar-forge/developer-site/dist/grant-plan-source.mjs';
import {
  importPlanningBook, serializePlanningBook, planningBookFromNative, addPlanningTable,
  receivePlanningEdition, retainPlanningTableReview, changePlanningMapping, rebasePlanningBook,
  requireCurrentBaseline, preparePlanningImport, completeNativePreview, acceptPlanningPreview,
  tableImportGuide, ROLES, receivePlanningWorkbook, retainPlanningBook,
} from './source-tables-core.mjs';

import {workbookUpload, decodeWorkbookBytes, workbookSelectionBody, validateWorkbookMaterials} from './source-workbooks.mjs';
import {zipWorkspace} from '../../../../stellar-forge/developer-site/dist/onboarding.mjs';
import {preparePlanningWorkbookHandover, receivePlanningWorkbookReturn,
  validatePlanningWorkbookProfile, validatePlanningWorkbookReturnProfile,
  defaultPlanningWorkbookProfile, defaultPlanningWorkbookReturnProfile} from './source-workbook-export.mjs';

const execute = promisify(execFile), HERE = dirname(fileURLToPath(import.meta.url));
const nativeCli = join(HERE, 'cli.py');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const MAX = 128 * 1024 * 1024;
const own = (value,key) => Object.prototype.hasOwnProperty.call(value,key);
const COMMANDS = {
  'export-plan-workbook': ['workspace','plan','revision','profile','output-directory','python'],
  'receive-returned-workbook': ['project','file','return-profile','output','python'],
  'workbook-export-profile': ['output'],
  'workbook-return-profile': ['output'],
  'inspect-workbook': ['file','sheet','range','header-row','offset','limit','python','output'],
  'project-workbook': ['file','mapping','python','output'],
  'receive-workbook': ['project','role','file','mapping','selection','python','output'],
  'export-workbooks': ['project','output-directory'],
  snapshot: ['workspace','plan','revision','python','output'],
  receive: ['project','role','file','delimiter','no-header','output'],
  configure: ['project','role','binding','table-mapping','output'],
  review: ['project','role','output'],
  rebase: ['project','workspace','plan','python','output'],
  preview: ['project','workspace','plan','python','output'],
  save: ['preview','workspace','python','note','request-id','output-directory'],
};
function need(value, message) { if (!value) throw new Error(message); }
function argumentsFor(argv) {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === 'help') return {command:'help'};
  need(own(COMMANDS, command), 'Choose snapshot, receive, configure, review, rebase, preview, save, inspect-workbook, project-workbook, receive-workbook, export-workbooks, export-plan-workbook or receive-returned-workbook.');
  const options = {command};
  for (let i=0;i<rest.length;i++) {
    const key=rest[i].replace(/^--/,'');
    need(rest[i].startsWith('--') && COMMANDS[command].includes(key) && !own(options,key), 'Unknown or repeated option: '+rest[i]);
    if (key === 'no-header') options[key]=true;
    else { need(i+1<rest.length, 'Enter a value for '+rest[i]); options[key]=rest[++i]; }
  }
  return options;
}
function required(options, ...keys) { for (const key of keys) need(typeof options[key] === 'string' && options[key], 'Use --'+key+' with '+options.command+'.'); }
async function bytes(filename, maximum=MAX) {
  const handle=await open(resolve(filename),'r');
  try {
    const before=await handle.stat();
    need(before.isFile()&&before.size<=maximum,'Choose a complete regular input within '+maximum+' bytes.');
    const chunks=[];let count=0;
    while(count<=maximum){
      const chunk=Buffer.allocUnsafe(Math.min(65536,maximum+1-count));
      const result=await handle.read(chunk,0,chunk.length,count);
      if(!result.bytesRead)break;
      chunks.push(chunk.subarray(0,result.bytesRead));count+=result.bytesRead;
    }
    const after=await handle.stat();
    need(count<=maximum&&count===before.size&&after.size===before.size&&after.mtimeMs===before.mtimeMs,
      'The complete input changed while it was being received or exceeds its byte allowance.');
    return Buffer.concat(chunks,count);
  }finally{await handle.close();}
}
async function readJson(filename) { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(filename)).replace(/^\uFEFF/,'')); }
async function readBook(filename) { return importPlanningBook(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(filename))); }
async function publish(filename, content) {
  const path=resolve(filename), raw=Buffer.isBuffer(content)?content:Buffer.from(content);
  const existing=async()=> { try { const prior=await readFile(path); return prior.equals(raw); } catch(error) { if(error.code==='ENOENT')return false;throw error; } };
  try { const prior=await readFile(path); need(prior.equals(raw),'Output already exists with different contents: '+path); return {path,bytes:raw.length,sha256:digest(raw)}; }
  catch(error) { if(error.code!=='ENOENT') throw error; }
  const temporary=join(dirname(path),'.source-table-'+randomUUID()+'.tmp');
  const handle=await open(temporary,'wx',0o600);
  try { await handle.writeFile(raw); await handle.sync(); } finally { await handle.close(); }
  try {
    try { await link(temporary,path); }
    catch(error) { if(error.code!=='EEXIST'||!await existing()) throw error; }
  } finally { await unlink(temporary).catch(()=>{}); }
  const readback=await readFile(path); need(readback.equals(raw),'The complete output could not be read back: '+path);
  return {path,bytes:raw.length,sha256:digest(raw)};
}
async function nativeText(args, options) {
  try {
    const result=await execute(options.python || 'python3',[nativeCli,...args],{encoding:'utf8',maxBuffer:MAX,windowsHide:true});
    return result.stdout;
  } catch(error) {
    let message=error.stderr || error.message;
    try { const body=JSON.parse(message); message=body.error?.message || message; } catch {}
    throw new Error('Original planner: '+String(message).trim());
  }
}
async function native(args, options) { return JSON.parse(await nativeText(args, options)); }
async function current(options) {
  required(options,'workspace','plan');
  return native(['show','--workspace',resolve(options.workspace),'--plan',options.plan,
    ...(options.revision?['--revision',options.revision]:[]),'--part','all'],options);
}
async function outputBook(options,book) {
  required(options,'output'); return {output:await publish(options.output,serializePlanningBook(book)),
    project:book.id,baseline:{id:book.baseline.id,revision:book.baseline.revision},
    roles:book.bindings.map(x=>x.role)};
}
function delimiter(value) {
  const choices={comma:',',tab:'\t',semicolon:';',pipe:'|'};
  need(own(choices,value),'Use --delimiter comma, tab, semicolon or pipe.');return choices[value];
}

async function workbookNative(request, options) {
  const input = json(request);
  need(Buffer.byteLength(input) <= 32*1024*1024, 'The complete workbook request exceeds the original 32 MiB input allowance.');
  return new Promise((resolve, reject) => {
    const child = execFile(options.python || 'python3', [join(HERE,'source_workbooks.py')],
      {encoding:'utf8',maxBuffer:MAX,windowsHide:true}, (error, stdout, stderr) => {
        if (error) {
          let body;
          try { body = JSON.parse(stderr).error; } catch {}
          reject(Object.assign(new Error(body?.message || String(stderr || error.message).trim()),
            body ? {code:body.code,details:body.details} : {}));
          return;
        }
        try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
      });
    child.stdin.on('error', error => { if(error.code !== 'EPIPE')reject(error); });
    child.stdin.end(input);
  });
}
async function uploadWorkbook(filename) {
  const raw = await bytes(filename,32*1024*1024);
  return workbookUpload(resolve(filename).split(/[\\/]/).at(-1),new Uint8Array(raw));
}
function workbookInteger(value, label) {
  need(/^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)), label+' needs an original whole number.');
  return Number(value);
}
async function inspectWorkbook(options) {
  required(options,'file','output');
  const preview = {offset:workbookInteger(options.offset || '0','Offset'),limit:workbookInteger(options.limit || '25','Page length')};
  if (options.sheet) preview.sheet = options.sheet;
  if (options.range) preview.range = options.range;
  const request = {action:'inspect',source:await uploadWorkbook(options.file),preview};
  if (own(options,'header-row')) request.headerRow = options['header-row'] === 'none' ? null : workbookInteger(options['header-row'],'Header row');
  const result = await workbookNative(request,options);
  return {output:await publish(options.output,json(result)),sourceId:result.source.id,
    sheets:result.source.description.sheets.length,sourceBytes:result.source.bytes,
    selectedSheet:result.preview.metadata.name,range:result.preview.range,nextOffset:result.preview.nextOffset};
}
async function projectWorkbook(options) {
  required(options,'file','mapping');
  return workbookNative({action:'project',source:await uploadWorkbook(options.file),mapping:await readJson(options.mapping)},options);
}
async function receiveWorkbook(options, book) {
  required(options,'role');
  need(own(ROLES,options.role),'Choose packages, milestones, contributors or assignments.');
  need(Boolean(options.selection) !== Boolean(options.file || options.mapping),
    'Choose either --selection COMPLETE_SELECTION.json or both --file ORIGINAL.xlsx and --mapping MAPPING.json.');
  const received = options.selection ? await readJson(options.selection) : await projectWorkbook(options);
  need(received?.source && received?.projection, 'Open the complete workbook selection, including its original source bytes.');
  const next = await receivePlanningWorkbook(book,{role:options.role,source:received.source,projection:received.projection});
  // The same native parser verifies portable selections received from the browser
  // before the original planner is asked to calculate or save a change.
  await workbookNative({action:'validate',retained:retainPlanningBook(next)},options);
  return outputBook(options,next);
}
async function exportWorkbooks(book, directory) {
  await validateWorkbookMaterials(book);
  const destination = resolve(directory), sources = [], selections = [], artifacts = [];
  await mkdir(destination,{recursive:true,mode:0o700});
  for (const source of book.workbookSources || []) {
    const relative = 'workbooks/'+source.sha256+'.xlsx', path=join(destination,relative);
    await mkdir(dirname(path),{recursive:true,mode:0o700});
    const artifact = await publish(path,Buffer.from(decodeWorkbookBytes(source.dataBase64)));
    sources.push({sourceId:source.id,originalFilename:source.filename,path:relative,bytes:artifact.bytes,sha256:artifact.sha256});
    artifacts.push(artifact);
  }
  for (const selection of book.workbookSelections || []) {
    const body = workbookSelectionBody(selection), stem='worksheet-selections/'+selection.id;
    const records = [
      [stem+'.json',selection.text,'complete-selection'],
      [stem+'.csv',body.csv.text,'projected-csv'],
      [stem+'.rows.jsonl',body.rowMap.text,'original-worksheet-row-map'],
      [stem+'.mapping.json',json(body.mapping),'saved-column-choices'],
    ], outputs = [];
    for (const [relative,content,role] of records) {
      const path=join(destination,relative);await mkdir(dirname(path),{recursive:true,mode:0o700});
      const artifact=await publish(path,content);artifacts.push(artifact);
      outputs.push({role,path:relative,bytes:artifact.bytes,sha256:artifact.sha256});
    }
    selections.push({id:selection.id,sourceId:selection.sourceId,documentId:selection.documentId,editionId:selection.editionId,
      sheet:body.mapping.plan.sheet,range:body.mapping.plan.range,rows:body.rows.length,files:outputs});
  }
  const index = {schema:'stellar-forge.planning-workbook-handover.v1',project:book.id,
    sources,selections,selectedWorkbooks:book.selectedWorkbooks || {}};
  artifacts.push(await publish(join(destination,'workbook-handover.json'),json(index)));
  return {index,artifacts};
}


function sameJson(a,b) {
  const ordered=value=>value&&typeof value==='object'&&!Array.isArray(value)?
    Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):
    Array.isArray(value)?value.map(ordered):value;
  return JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
}
async function existingWorkbookHandover(directory,plan,profile) {
  let info;
  try{info=await stat(directory);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  need(info.isDirectory(),'Choose a new workbook handover directory.');
  const manifest=await readJson(join(directory,'WORKBOOK_EXPORT.json'));
  need(sameJson(manifest.source,{id:plan.id,revision:plan.revision,contentSha256:plan.contentSha256})&&
    sameJson(manifest.profile,profile),'The output directory belongs to different saved workbook choices.');
  need(Array.isArray(manifest.files)&&manifest.files.length===14,'Retain the complete original workbook handover.');
  const files=[],artifacts=[];
  for(const file of manifest.files){
    need(typeof file.path==='string'&&!file.path.startsWith('/')&&!file.path.split('/').some(x=>x==='.'||x==='..'||!x),
      'The original handover contains an invalid relative filename.');
    const raw=await bytes(join(directory,file.path));
    need(raw.length===file.bytes&&digest(raw)===file.sha256,'The retained handover file changed: '+file.path);
    files.push({path:file.path,content:new Uint8Array(raw)});
    artifacts.push({path:join(directory,file.path),bytes:raw.length,sha256:digest(raw)});
  }
  const manifestBytes=await bytes(join(directory,'WORKBOOK_EXPORT.json'));
  files.push({path:'WORKBOOK_EXPORT.json',content:new Uint8Array(manifestBytes)});
  const archive=await bytes(join(directory,'planning-workbook-handover.zip'));
  need(Buffer.from(zipWorkspace(files)).equals(archive),'Retain the complete original workbook handover archive.');
  const nativeZip=files.find(x=>x.path==='planning.zip');
  need(nativeZip,'Retain the original native planning ZIP.');
  const received=await receivePlanningFile(nativeZip.content,{filename:'planning.zip',
    inflate:(raw,max)=>new Uint8Array(inflateRawSync(raw,{maxOutputLength:Math.max(1,max)}))});
  const currentRevision=received.document.revisions.find(x=>x.revision===received.document.currentRevision);
  need(received.document.id===plan.id&&currentRevision?.revision===plan.revision&&currentRevision.contentSha256===plan.contentSha256,
    'The retained ZIP differs from the selected saved native revision.');
  artifacts.push({path:join(directory,'WORKBOOK_EXPORT.json'),bytes:manifestBytes.length,sha256:digest(manifestBytes)},
    {path:join(directory,'planning-workbook-handover.zip'),bytes:archive.length,sha256:digest(archive)});
  return {source:manifest.source,profile:manifest.profile,tables:manifest.tables,files:15,artifacts,replayed:true};
}
async function exportPlanWorkbook(options) {
  required(options,'workspace','plan','revision','profile','output-directory');
  need(workbookInteger(options.revision,'Saved revision')>0,'Select a positive saved revision.');
  const plan=await current(options),profile=validatePlanningWorkbookProfile(await readJson(options.profile)),
    destination=resolve(options['output-directory']);
  const retained=await existingWorkbookHandover(destination,plan,profile);
  if(retained)return retained;
  await mkdir(dirname(destination),{recursive:true,mode:0o700});
  const temporary=await mkdtemp(join(dirname(destination),'.planning-workbook-'));
  let published=false;
  try {
    const zipPath=join(temporary,'planning.zip');
    await native(['export','--workspace',resolve(options.workspace),'--plan',plan.id,
      '--revision',String(plan.revision),'--output',zipPath],options);
    const result=await preparePlanningWorkbookHandover(plan,profile,{
      nativeZip:new Uint8Array(await bytes(zipPath,32*1024*1024)),
      projectWorkbook:request=>workbookNative({action:'project',...request},options),
      inflate:(raw,max)=>new Uint8Array(inflateRawSync(raw,{maxOutputLength:Math.max(1,max)})),
    });
    await workbookNative({action:'validate',retained:retainPlanningBook(result.book)},options);
    const artifacts=[];
    for(const file of [...result.files,{path:result.archive.filename,content:result.archive.data}]){
      const output=join(temporary,file.path);await mkdir(dirname(output),{recursive:true,mode:0o700});
      const saved=await publish(output,file.content);
      artifacts.push({...saved,path:join(destination,file.path)});
    }
    // A complete private directory becomes visible only after all original files exist.
    try{await stat(destination);throw new Error('The output directory was created by another operation. Use a new directory.');}
    catch(error){if(error.code!=='ENOENT')throw error;}
    await rename(temporary,destination);published=true;
    return {source:result.manifest.source,profile:result.manifest.profile,tables:result.manifest.tables,
      files:result.files.length,artifacts,replayed:false};
  }finally{if(!published)await rm(temporary,{recursive:true,force:true});}
}
async function receiveReturnedWorkbook(options,book) {
  required(options,'file','return-profile');
  const profile=validatePlanningWorkbookReturnProfile(await readJson(options['return-profile']));
  const result=await receivePlanningWorkbookReturn(book,await uploadWorkbook(options.file),profile,{
    inspectWorkbook:request=>workbookNative({action:'inspect',...request},options),
    projectWorkbook:request=>workbookNative({action:'project',...request},options),
  });
  await workbookNative({action:'validate',retained:retainPlanningBook(result.book)},options);
  return {...await outputBook(options,result.book),sourceId:result.source.id,received:result.received,profile:result.profile};
}

async function previewProject(options) {
  required(options,'project','output','workspace','plan');
  const book=await readBook(options.project), plan=await current(options);
  requireCurrentBaseline(book,plan);
  const prepared=await preparePlanningImport(book);
  const directory=resolve(dirname(options.output));
  const inputDirectory=join(directory,'.planning-preview-'+prepared.id);
  await mkdir(inputDirectory,{recursive:true,mode:0o700});
  const patch=await publish(join(inputDirectory,'scenario-patch.json'),json(prepared.scenarioPatch));
  const planning=await publish(join(inputDirectory,'planning.json'),json(prepared.planning));
  const result=await native(['estimate','--workspace',resolve(options.workspace),'--plan',prepared.planId,
    '--expected-revision',String(prepared.expectedRevision),'--patch',patch.path,'--planning',planning.path],options);
  const preview=await completeNativePreview(prepared,result);
  return {output:await publish(options.output,json(preview)),project:book.id,plan:prepared.planId,
    baselineRevision:prepared.expectedRevision,workPackages:result.scenario.future_costs.length,
    awardRequestUsd:result.scenario.award_request_usd,hours:result.report.capacity.totalHours,
    changes:preview.review.changes.length,sourceRows:preview.review.sourceRows.length,
    peakCashGapUsd:result.report.cash.peakCashGapUsd,peakCashGapDay:result.report.cash.peakCashGapDay};
}
async function savePreview(options) {
  required(options,'preview','workspace','note','request-id','output-directory');
  need(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(options['request-id']),'Use the original planner request-ID format: at most 100 letters, numbers, dots, hyphens or underscores.');
  const selected=await readJson(options.preview), prepared=await preparePlanningImport(selected.book);
  need(selected.id===prepared.id && selected.planId===prepared.planId && selected.expectedRevision===prepared.expectedRevision,
    'The complete preview must match its retained source project and native baseline.');
  // The actual writer receives reproducible inputs from the original source project.
  // Replays retain the original expected revision and request ID; native save
  // reconciles a committed request before its current-revision comparison.
  const draft=await acceptPlanningPreview(selected,prepared.book,{note:options.note,
    reviewedAt:selected.review.preparedAt});
  const directory=resolve(options['output-directory']);
  await mkdir(directory,{recursive:true,mode:0o700});
  const inputDirectory=join(directory,'.source-table-input');
  await mkdir(inputDirectory,{recursive:true,mode:0o700});
  const scenarioPatch=await publish(join(inputDirectory,'scenario-patch.json'),json(prepared.scenarioPatch));
  const planningInput={...prepared.planning,sourceTables:draft.planning.sourceTables};
  const planning=await publish(join(inputDirectory,'planning.json'),json(planningInput));
  const result=await native(['save','--workspace',resolve(options.workspace),'--plan',prepared.planId,
    '--expected-revision',String(prepared.expectedRevision),'--patch',scenarioPatch.path,
    '--planning',planning.path,'--note',options.note,'--request-id',options['request-id']],options);
  const artifacts=[];
  const planPath=join(directory,'plan.json');
  let planRaw;
  try {
    planRaw=await readFile(planPath);
    const prior=JSON.parse(planRaw);
    need(prior.id===result.id && prior.revision===result.revision && prior.contentSha256===result.contentSha256,
      'The existing full native plan belongs to another saved result.');
  } catch(error) {
    if(error.code!=='ENOENT') throw error;
    planRaw=Buffer.from(await nativeText(['show','--workspace',resolve(options.workspace),'--plan',result.id,
      '--revision',String(result.revision),'--part','all'],options));
  }
  artifacts.push(await publish(planPath,planRaw));
  artifacts.push(await publish(join(directory,'planning-source-tables.json'),draft.planning.sourceTables.text));
  artifacts.push(await publish(join(directory,'SOURCE_TABLES.md'),tableImportGuide(prepared.book)));
  const zipPath=join(directory,'planning.zip');
  let rawZip;
  try { rawZip=await readFile(zipPath); }
  catch(error) {
    if(error.code!=='ENOENT')throw error;
    // A committed request keeps its original immutable saved revision even if
    // another operator saved later work before this ZIP could be published.
    await native(['export','--workspace',resolve(options.workspace),'--plan',result.id,
      '--revision',String(result.revision),'--output',zipPath],options);
    rawZip=await readFile(zipPath);
  }
  // Use the same complete native ZIP receiver as the maintained submission editor.
  // This also reconciles an export completed before the process was interrupted.
  const received=await receivePlanningFile(new Uint8Array(rawZip),{
    filename:'planning.zip',digest:async raw=>digest(raw),
    inflate:async (raw,maximum)=>new Uint8Array(inflateRawSync(raw,{maxOutputLength:Math.max(1,maximum)})),
  });
  const receivedRevision=received.document.revisions.find(row=>row.revision===received.document.currentRevision);
  need(received.document.id===result.id && receivedRevision.revision===result.revision &&
    receivedRevision.contentSha256===result.contentSha256,
    'The complete native ZIP differs from this source-import revision.');
  const zip={plan:{id:result.id,revision:result.revision,contentSha256:result.contentSha256},
    output:{path:zipPath,bytes:rawZip.length,sha256:digest(rawZip)}};
  await publish(join(directory,'native-export.json'),json(zip));
  const workbooks=(prepared.book.workbookSources || []).length ? await exportWorkbooks(prepared.book,directory) : null;
  if(workbooks)artifacts.push(...workbooks.artifacts);
  const complete={schema:'stellar-forge.planning-source-tables.delivery.v1',
    requestId:options['request-id'],project:prepared.book.id,planId:result.id,revision:result.revision,
    contentSha256:result.contentSha256,sourceImport:prepared.id,
    nativeExport:zip,artifacts,...(workbooks?{workbookSources:workbooks.index.sources.length,workbookSelections:workbooks.index.selections.length}:{})};
  await publish(join(directory,'DELIVERY.json'),json(complete));
  return complete;
}
export async function runPlanningSourceTables(argv=process.argv.slice(2)) {
  const options=argumentsFor(argv);
  if(options.command==='help') return {help:[
    'snapshot --workspace PATH --plan ID --output source-project.json',
    'inspect-workbook --file ORIGINAL.xlsx [--sheet NAME --range A1:K9 --header-row 1 --offset 0 --limit 25] --output workbook-inspection.json',
    'project-workbook --file ORIGINAL.xlsx --mapping workbook-mapping.json --output workbook-selection.json',
    'receive-workbook --project source-project.json --role packages --selection workbook-selection.json --output next-project.json',
    'receive-workbook --project source-project.json --role packages --file ORIGINAL.xlsx --mapping workbook-mapping.json --output next-project.json',
    'export-workbooks --project source-project.json --output-directory NEW_DIRECTORY',
    'workbook-export-profile --output WORKBOOK_PROFILE.json',
    'workbook-return-profile --output RETURN_PROFILE.json',
    'export-plan-workbook --workspace PATH --plan ID --revision N --profile WORKBOOK_PROFILE.json --output-directory NEW_DIRECTORY',
    'receive-returned-workbook --project planning-source-project.json --file EDITED.xlsx --return-profile RETURN_PROFILE.json --output returned-project.json',
    'receive --project source-project.json --role packages --file costs.csv --delimiter comma --output next-project.json',
    'configure --project source-project.json --role packages --binding binding.json [--table-mapping mapping.json] --output mapped-project.json',
    'review --project mapped-project.json --role packages --output reviewed-project.json',
    'rebase --project source-project.json --workspace PATH --plan ID --output rebased-project.json',
    'preview --project reviewed-project.json --workspace PATH --plan ID --output preview.json',
    'save --preview preview.json --workspace PATH --note "Reviewed source revision" --request-id ORIGINAL_ID --output-directory NEW_DIRECTORY',
    'Use --python PATH on commands that invoke the original planner. Close its browser listener before headless commands open the same workspace.',
    'Every output is a complete new file. Retry the same save with the same preview, note, request ID and output directory.',
  ]};
  if(options.command==='workbook-export-profile'||options.command==='workbook-return-profile'){
    required(options,'output');const value=options.command==='workbook-export-profile'?
      defaultPlanningWorkbookProfile():defaultPlanningWorkbookReturnProfile();
    return {output:await publish(options.output,json(value)),profile:value};
  }
  if(options.command==='export-plan-workbook')return exportPlanWorkbook(options);
  if(options.command==='inspect-workbook')return inspectWorkbook(options);
  if(options.command==='project-workbook'){
    required(options,'output');const result=await projectWorkbook(options),body=workbookSelectionBody(result.projection);
    return {output:await publish(options.output,json(result)),sourceId:result.source.id,
      rows:body.rows.length,sheet:body.mapping.plan.sheet,range:body.mapping.plan.range,
      csvSha256:body.csv.sha256,selectionSha256:result.projection.sha256};
  }
  if(options.command==='export-workbooks'){
    required(options,'project','output-directory');
    return exportWorkbooks(await readBook(options.project),options['output-directory']);
  }
  if(options.command==='snapshot') { required(options,'workspace','plan','output'); return outputBook(options,await planningBookFromNative(await current(options))); }
  if(options.command==='preview')return previewProject(options);
  if(options.command==='save')return savePreview(options);
  required(options,'project','output');
  let book=await readBook(options.project);
  if(options.command==='receive-workbook')return receiveWorkbook(options,book);
  if(options.command==='receive-returned-workbook')return receiveReturnedWorkbook(options,book);
  if(options.command==='rebase')return outputBook(options,rebasePlanningBook(book,await current(options)));
  required(options,'role'); need(own(ROLES,options.role),'Choose packages, milestones, contributors or assignments.');
  if(options.command==='receive') {
    required(options,'file'); const raw=await bytes(options.file,16*1024*1024);
    const sourceText=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);
    const filename=resolve(options.file).split(/[\\/]/).at(-1);
    if(book.bindings.some(x=>x.role===options.role))book=await receivePlanningEdition(book,options.role,{filename,sourceText});
    else { required(options,'delimiter'); book=await addPlanningTable(book,{role:options.role,filename,sourceText,delimiter:delimiter(options.delimiter),header:!options['no-header']}); }
  } else if(options.command==='configure') {
    const binding=book.bindings.find(x=>x.role===options.role);need(binding,'Receive the source table before configuring it.');
    need(options.binding||options['table-mapping'],'Provide --binding or --table-mapping.');
    if(options.binding) {
      const selected=await readJson(options.binding);
      need(selected&&typeof selected==='object'&&!Array.isArray(selected),'Use a complete binding JSON object.');
      const keys=Object.keys(selected);need(keys.every(x=>['fields','mode','excludedRows'].includes(x)),'Binding configuration accepts fields, mode and excludedRows.');
      Object.assign(binding,selected);
    }
    if(options['table-mapping'])book=changePlanningMapping(book,options.role,await readJson(options['table-mapping']));
    book=await importPlanningBook(book);
  } else if(options.command==='review')book=await retainPlanningTableReview(book,options.role);
  return outputBook(options,book);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  runPlanningSourceTables().then(result=>process.stdout.write(json(result))).catch(error=>{
    process.stderr.write(json({error:{code:error.code||'PLANNING_SOURCE_TABLES',message:error.message,
      ...(error.role?{role:error.role}:{}),...(error.record?{record:error.record,line:error.line}:{}),...(error.details?{details:error.details}:{})}}));process.exitCode=1;
  });
}
