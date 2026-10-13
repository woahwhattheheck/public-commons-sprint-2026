#!/usr/bin/env node
// MIT. Complete editable receiving walkthrough using the retained reader budget.
import {mkdir, readFile, open, link, unlink, readdir} from 'node:fs/promises';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {
  createPlanningBook, addPlanningTable, retainPlanningTableReview, planningRoleCsv,
  serializePlanningBook, importPlanningBook, rebasePlanningBook, receivePlanningEdition,
  sourceEditionComparison, preparePlanningImport,
} from '../../source-tables-core.mjs';
import {runPlanningSourceTables} from '../../source-tables-cli.mjs';

const HERE=dirname(fileURLToPath(import.meta.url));
const nativeCli=resolve(HERE,'../../cli.py'), execute=promisify(execFile);
const json=value=>JSON.stringify(value,null,2)+'\n';
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const need=(value,message)=>{if(!value)throw new Error(message);};
const rawJson=async path=>JSON.parse(await readFile(path,'utf8'));
async function native(args) {
  try {return JSON.parse((await execute('python3',[nativeCli,...args],{encoding:'utf8',maxBuffer:128*1024*1024})).stdout);}
  catch(error){throw new Error(String(error.stderr||error.message));}
}
async function existing(path) {
  try {return await readFile(path);} catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function save(path,value,mode=0o600) {
  const bytes=Buffer.from(typeof value==='string'?value:json(value)),prior=await existing(path);
  if(prior){need(prior.equals(bytes),'Retain the original complete output: '+path);return path;}
  const temporary=path+'.'+randomUUID()+'.partial',handle=await open(temporary,'wx',mode);
  try {await handle.writeFile(bytes);await handle.sync();} finally {await handle.close();}
  try {try{await link(temporary,path);}catch(error){
    if(error.code!=='EEXIST')throw error;
    need((await readFile(path)).equals(bytes),'The original output changed: '+path);
  }} finally {await unlink(temporary);}
  return path;
}
async function retainedJson(path,produce) {
  const prior=await existing(path);
  if(prior)return JSON.parse(prior.toString('utf8'));
  const value=await produce();await save(path,value);return value;
}
async function previewResult(project,path,workspace,id) {
  if(!await existing(path))await runPlanningSourceTables(['preview','--project',project,
    '--workspace',workspace,'--plan',id,'--output',path]);
  const value=await rawJson(path),book=await importPlanningBook(await readFile(project,'utf8')),
    prepared=await preparePlanningImport(book);
  need(value.id===prepared.id&&value.planId===prepared.planId&&
    value.expectedRevision===prepared.expectedRevision,
    'Retain the complete preview for this original source project and saved baseline.');
  return {hours:value.native.report.capacity.totalHours,awardRequestUsd:value.native.scenario.award_request_usd};
}
async function prepareOriginalDirectory(root,source,binding) {
  try{await mkdir(root,{mode:0o700});}
  catch(error){if(error.code!=='EEXIST')throw error;}
  const path=join(root,'OPERATION.json'),prior=await existing(path);
  const identity={schema:'stellar-forge.planning-source-tables.receiving-operation.v1',
    operation:'SCF-NATIVE-PLAN-SOURCE-TABLES-94FE-20261012',
    originalSourceSha256:hash(Buffer.from(source)),bindingSha256:hash(Buffer.from(json(binding)))};
  if(prior)need(json(JSON.parse(prior.toString('utf8')))===json(identity),'Continue the original selected source-table operation directory.');
  else{need((await readdir(root)).length===0,'Choose the original operation directory or a new empty directory.');await save(path,identity);}
}
function csv(rows) {return rows.map(row=>row.map(value=>'"'+String(value??'').replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n';}
function typed(book,role) {
  const binding=book.bindings.find(x=>x.role===role), document=book.project.documents.find(x=>x.id===binding.documentId);
  const keys=role==='packages'?['package_id']:role==='milestones'?['tranche']:role==='contributors'?['id']:['costId','contributorId'];
  document.mapping.keyColumns=keys.map(key=>document.mapping.columns.find(column=>column.sourceName===key).index);
  for(const column of document.mapping.columns) {
    if(['planned_hours','planning_rate_usd_per_hour','planned_cost_usd','weeklyHours','hours'].includes(column.sourceName)) column.type='decimal-text';
    if(['tranche','start_day_after_actual_award_acceptance','end_day_after_actual_award_acceptance','submit_day','review_and_payment_lag_days'].includes(column.sourceName)) column.type='integer';
  }
  return book;
}
export async function receiveCurrentBudget(directory) {
  const root=resolve(directory);
  const source=await readFile(join(HERE,'current-reader-budget.csv'),'utf8');
  const binding=await rawJson(join(HERE,'current-reader-budget.binding.json'));
  await prepareOriginalDirectory(root,source,binding);
  const workspace=join(root,'authoring'), receiver=join(root,'receiving');
  const original=await retainedJson(join(root,'original-plan.json'),async()=>{
    const seed=await native(['init','--workspace',workspace]),id=seed.plans[0]?.id;
    need(id,'The original planner must provide its current candidate.');
    return native(['show','--workspace',workspace,'--plan',id,'--part','all']);
  });
  const id=original.id;
  need(original.scenario.future_costs.length===6 && String(original.scenario.award_request_usd)==='38000',
    'Use the retained six-package current candidate; review a changed source before this walkthrough.');
  const firstProject=join(root,'source-project-1.json');
  let book;
  if(await existing(firstProject))book=await importPlanningBook(await readFile(firstProject,'utf8'));
  else{
  book=createPlanningBook(original,{name:'Current reader budget and source-table receiving'});
  book=await addPlanningTable(book,{role:'packages',filename:'current-reader-budget.csv',sourceText:source,delimiter:','});
  Object.assign(book.bindings.find(x=>x.role==='packages'),binding);
  typed(book,'packages'); book=await retainPlanningTableReview(book,'packages');
  book=await addPlanningTable(book,{role:'milestones',filename:'original-milestones.csv',sourceText:planningRoleCsv(original,'milestones'),delimiter:','});
  typed(book,'milestones');book=await retainPlanningTableReview(book,'milestones');

  const capacityNote='Operator-selected walkthrough capacity. Assign the actual accountable contributor and capacity before operational use.';
  const contributors=csv([['id','name','weeklyHours','note'],['delivery-owner','Delivery owner (planning input)','40',capacityNote]]);
  book=await addPlanningTable(book,{role:'contributors',filename:'selected-capacity.csv',sourceText:contributors,delimiter:','});
  typed(book,'contributors');book=await retainPlanningTableReview(book,'contributors');
  const assignments=csv([['costId','contributorId','hours'],...original.scenario.future_costs.map(row=>[row.id,'delivery-owner',row.estimated_hours])]);
  book=await addPlanningTable(book,{role:'assignments',filename:'selected-work-assignments.csv',sourceText:assignments,delimiter:','});
  typed(book,'assignments');book=await retainPlanningTableReview(book,'assignments');
  await save(firstProject,serializePlanningBook(book));
  }
  const firstPreview=join(root,'native-preview-1.json');
  const calculated1=await previewResult(firstProject,firstPreview,workspace,id);
  need(String(calculated1.hours)==='400' && String(calculated1.awardRequestUsd)==='38000','Read the complete native result for the retained original budget.');
  const first=await runPlanningSourceTables(['save','--preview',firstPreview,'--workspace',workspace,
    '--note','Reviewed the original reader budget, complete milestones and explicitly selected walkthrough capacity.',
    '--request-id','source-tables-current-budget-first','--output-directory',join(root,'edition-1')]);
  const saved1=await rawJson(join(root,'edition-1','plan.json'));
  book=rebasePlanningBook(await importPlanningBook(saved1.planning.sourceTables),saved1);

  // This is a separately saved operator alternative; the original CSV remains retained.
  const revised=source.replace('Merchant-resource integration,80,95,7600,prospective',
    'Merchant-resource integration,81,95,7695,prospective');
  need(revised!==source,'Receive the exact retained source row before applying the one-hour operator alternative.');
  const secondProject=join(root,'source-project-2.json');
  if(await existing(secondProject))book=await importPlanningBook(await readFile(secondProject,'utf8'));
  else{
    book=await receivePlanningEdition(book,'packages',{filename:'reviewed-budget-alternative.csv',sourceText:revised});
    book=await retainPlanningTableReview(book,'packages');
    book.settings.scenarioName=original.scenario.scenario_name+' — reviewed one-hour alternative';
    book.settings.awardRequestUsd='38095';
    await save(secondProject,serializePlanningBook(book));
  }
  const comparison=sourceEditionComparison(book,'packages');
  need(comparison.summary.changed===1 && comparison.summary.unchanged===5 &&
    comparison.summary.added===0 && comparison.summary.removed===0,'Retain the exact source edition comparison.');
  await save(join(root,'source-edition-comparison.json'),comparison);
  const secondPreview=join(root,'native-preview-2.json');
  const calculated2=await previewResult(secondProject,secondPreview,workspace,id);
  need(String(calculated2.hours)==='401' && String(calculated2.awardRequestUsd)==='38095','Read the original native calculation for the reviewed alternative.');
  // This private receiving helper ends the actual native export child exactly
  // once after the original save has committed and before ZIP publication.
  const wrapper=join(root,'interrupt-before-original-export.py'),
    marker=join(root,'original-export-interrupted.json');
  const wrapperSource=[
    '#!/usr/bin/env python3',
    'import json,os,signal,sys',
    'from pathlib import Path',
    'marker=Path(__file__).with_name("original-export-interrupted.json")',
    'if len(sys.argv)>2 and sys.argv[2]=="export":',
    ' try: fd=os.open(marker,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)',
    ' except FileExistsError: pass',
    ' else:',
    '  with os.fdopen(fd,"w") as out:',
    '   json.dump({"phase":"original-save-committed-before-export","pid":os.getpid(),"signal":"SIGKILL","nativeArguments":sys.argv[1:]},out)',
    '   out.write("\\n");out.flush();os.fsync(out.fileno())',
    '  print("Original receiving: native export interrupted before ZIP publication",file=sys.stderr,flush=True)',
    '  os.kill(os.getpid(),signal.SIGKILL)',
    'os.execv(sys.executable,[sys.executable]+sys.argv[1:])',
    ''
  ].join('\n');
  await save(wrapper,wrapperSource,0o700);
  const saveArgs=['save','--preview',secondPreview,'--workspace',workspace,'--python',wrapper,
    '--note','Reviewed the retained successor source, exact one-hour change and complete native result.',
    '--request-id','source-tables-current-budget-successor','--output-directory',join(root,'edition-2')];
  const interruptionPath=join(root,'export-interruption-observation.json');
  if(!await existing(marker)){
    let interrupted;
    try{await runPlanningSourceTables(saveArgs);}catch(error){interrupted=error;}
    need(interrupted&&await existing(marker)&&!await existing(join(root,'edition-2','planning.zip')),
      'The original native save must commit before its first export child is interrupted.');
    await save(interruptionPath,{observedFailure:String(interrupted.message),marker:await rawJson(marker)});
  }
  const committed=await rawJson(join(root,'edition-2','plan.json'));
  const laterPlanningPath=join(root,'later-planning.json');
  const laterPlanning=await retainedJson(laterPlanningPath,async()=>({
    ...committed.planning,
    notes:'Later operator note retained while the original reviewed source-table delivery was being completed.'
  }));
  const later=await native(['save','--workspace',workspace,'--plan',id,
    '--expected-revision',String(committed.revision),'--planning',laterPlanningPath,
    '--note','Retained later operator work while the original export was interrupted.',
    '--request-id','source-tables-later-work-during-original-export']);
  need(later.revision===committed.revision+1,'Retain exactly one later original operator revision.');
  const second=await runPlanningSourceTables(saveArgs);
  const replay=await runPlanningSourceTables(saveArgs);
  need(json(second)===json(replay),'The repeated original request must return the same complete delivery.');
  const saved2=await rawJson(join(root,'edition-2','plan.json'));
  const current=await native(['show','--workspace',workspace,'--plan',id,'--part','all']);
  need(second.revision===committed.revision&&current.revision===later.revision&&
    current.contentSha256===later.contentSha256&&current.planning.notes===laterPlanning.notes,
    'Complete the original saved edition while preserving the later active operator work.');
  const portable=await importPlanningBook(saved2.planning.sourceTables);
  need(portable.bindings.length===4 && portable.reviews.length===2,'Reopen all four source roles and both complete native import reviews.');
  const packages=portable.project.documents.find(doc=>doc.id===portable.bindings.find(row=>row.role==='packages').documentId);
  need(packages.editions.length===2 && packages.editions[0].sourceText===source && packages.editions[1].sourceText===revised,
    'Retain both complete original source editions through native save.');

  const imported=await native(['import-bundle','--workspace',receiver,'--file',join(root,'edition-2','planning.zip'),
    '--name','Received editable source-table plan','--request-id','source-tables-current-budget-receiving']);
  const received=await native(['show','--workspace',receiver,'--plan',imported.plan.id,'--part','all']);
  need(received.contentSha256===saved2.contentSha256 && received.revision===saved2.revision,
    'The original complete planning receiver must retain the saved content and revision history.');
  const receivedBook=await importPlanningBook(received.planning.sourceTables);
  const continuationPath=join(root,'received-source-project.json');
  const continuation=await existing(continuationPath)?
    await importPlanningBook(await readFile(continuationPath,'utf8')):
    rebasePlanningBook(receivedBook,received);
  const prepared=await preparePlanningImport(continuation);
  need(prepared.planId===received.id && prepared.expectedRevision===received.revision && prepared.review.sourceRows.length===16,
    'The received native plan must support a complete next editable source import.');
  await save(join(root,'received-source-project.json'),serializePlanningBook(continuation));

  const result={schema:'stellar-forge.planning-source-tables.receiving-walkthrough.v1',
    originalSource:{path:'current-reader-budget.csv',bytes:Buffer.byteLength(source),sha256:hash(Buffer.from(source))},
    sourceRoles:portable.bindings.map(row=>row.role),originalBudget:{hours:calculated1.hours,awardRequestUsd:calculated1.awardRequestUsd},
    selectedAlternative:{hours:calculated2.hours,awardRequestUsd:calculated2.awardRequestUsd},
    comparison:comparison.summary,first,second,identicalRequestReplay:true,
    interruptedExport:{originalRevision:committed.revision,completedRevision:second.revision,
      laterActiveRevision:current.revision,laterContentSha256:current.contentSha256,
      laterWorkPreserved:current.planning.notes===laterPlanning.notes,
      nativeInterruption:await rawJson(marker),observationFile:'export-interruption-observation.json'},
    received:{id:received.id,revision:received.revision,contentSha256:received.contentSha256},
    editableSourceRows:prepared.review.sourceRows.length,sourceEditions:packages.editions.length};
  await save(join(root,'RECEIVING.json'),result);
  return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(!process.argv[2]||process.argv[2]==='--help') {
    process.stdout.write('node receive-current-budget.mjs ORIGINAL_OR_NEW_PRIVATE_DIRECTORY\nCreates or continues the complete original budget and separately saved one-hour alternative, interrupts its native export after commit, retains later work, then receives the original editable ZIP.\n');
  } else receiveCurrentBudget(process.argv[2]).then(result=>process.stdout.write(json(result))).catch(error=>{
    process.stderr.write(json({error:error.message}));process.exitCode=1;
  });
}
