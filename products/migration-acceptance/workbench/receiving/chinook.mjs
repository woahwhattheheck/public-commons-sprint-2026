// SPDX-License-Identifier: MIT
// Whole Chinook continuation inside the original Definian programme and hosts.
import {existsSync,readFileSync,mkdirSync,openSync,closeSync,fsyncSync,readdirSync,lstatSync,realpathSync} from 'node:fs';
import {join,resolve,relative,dirname} from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {atomicBytes,atomicJson,canonical,requireValue,identity,now,safeRelative} from '../vendor/dlt/vendor/sling/core/common.mjs';
import {hashFile} from '../vendor/dlt/vendor/sling/core/objects.mjs';
import {readReferenceDirectory,retainReferenceInputs,buildPipelineInput,columnType} from '../integration/chinook-native-input.mjs';
import {evaluateRelationalAcceptance} from '../integration/relational-acceptance.mjs';
import {runBrowserJourney} from './browser.mjs';

const read=path=>JSON.parse(readFileSync(path,'utf8'));
const selected=(rows,id,label)=>{const row=rows.find(x=>x.id===id);requireValue(row,'CHINOOK_SELECTION','The original '+label+' is absent.',409,{id});return row;};
const eq=(a,b)=>canonical(a)===canonical(b);
function descriptor(root,path){const name=relative(root,path).split('\\').join('/');safeRelative(name);return{path:name,...hashFile(path)};}
function verify(root,file){safeRelative(file.path);const actual=hashFile(join(root,file.path));requireValue(actual.bytes===file.bytes&&actual.sha256===file.sha256,'CHINOOK_ARTIFACT','The complete original Chinook artifact changed.',409,{path:file.path});return file;}
function walk(root,directory){
  const out=[];for(const entry of readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    const path=join(directory,entry.name);requireValue(!entry.isSymbolicLink(),'CHINOOK_FILE','Keep ordinary original receiving files.',409);
    if(entry.isDirectory())out.push(...walk(root,path));else if(entry.isFile())out.push(descriptor(root,path));else requireValue(false,'CHINOOK_FILE','Unexpected special receiving file.',409);
  }return out;
}
function measuredInput(prepared,plan){
  const objectIds=new Map(prepared.binding.tables.map(t=>[t.originalTable,'chinook_'+t.nativeTable]));
  const objects=prepared.binding.tables.map(t=>({id:objectIds.get(t.originalTable),
    streamId:selected(plan.acceptance,plan.acceptance.find(a=>a.table===t.nativeTable)?.id,'native table').id,
    key:t.schema.primaryKey.map(k=>t.fieldMap[k]),
    required:t.schema.columns.filter(c=>!c.nullable||c.primaryKeyOrder).map(c=>t.fieldMap[c.name])}));
  const relationships=[],controls=[];
  for(const t of prepared.binding.tables){
    for(const fk of t.schema.foreignKeys){
      const parent=prepared.binding.tables.find(x=>x.originalTable===fk.parentTable),columns=[...fk.columns].sort((a,b)=>a.sequence-b.sequence);
      requireValue(parent,'CHINOOK_RELATION','The complete original relationship parent is missing.',409);
      relationships.push({id:fk.id,parentObjectId:objectIds.get(parent.originalTable),childObjectId:objectIds.get(t.originalTable),
        parentColumns:columns.map(c=>parent.fieldMap[c.parent]),childColumns:columns.map(c=>t.fieldMap[c.child]),
        nulls:columns.every(c=>t.schema.columns.find(x=>x.name===c.child).nullable)?'allow-all-null':'forbid',acceptance:'required'});
    }
    controls.push({id:t.originalTable+'.row_count',objectId:objectIds.get(t.originalTable),groupBy:[],measure:{kind:'count'},nulls:'reject',acceptance:'required'});
    for(const c of t.schema.columns.filter(c=>columnType(c).cellType==='decimal')){
      controls.push({id:t.originalTable+'.'+c.name+'.sum',objectId:objectIds.get(t.originalTable),groupBy:[],
        measure:{kind:'sum',column:t.fieldMap[c.name],scale:2},nulls:'reject',acceptance:'required'});
    }
    if(t.originalTable==='Invoice')for(const by of ['CustomerId','BillingCountry']){
      controls.push({id:'Invoice.Total.by_'+by,objectId:objectIds.get(t.originalTable),groupBy:[t.fieldMap[by]],
        measure:{kind:'sum',column:t.fieldMap.Total,scale:2},nulls:'reject',acceptance:'required'});
    }
    if(t.originalTable==='InvoiceLine')controls.push({id:'InvoiceLine.Quantity.by_InvoiceId',objectId:objectIds.get(t.originalTable),
      groupBy:[t.fieldMap.InvoiceId],measure:{kind:'sum',column:t.fieldMap.Quantity,scale:0},nulls:'reject',acceptance:'required'});
  }
  return{schema:'definian.acceptance-input.v1',title:'Complete Chinook object, relationship and exact control acceptance',pipelinePlan:plan,objects,relationships,controls};
}
const html=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function reportDocument(report){
  const table=(heads,rows)=>'<div class="scroll"><table><thead><tr>'+heads.map(x=>'<th>'+html(x)+'</th>').join('')+'</tr></thead><tbody>'+
    rows.map(row=>'<tr>'+row.map(x=>'<td>'+html(typeof x==='object'?JSON.stringify(x):x)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
  const invoiceRows=report.source.controls.invoices.map((x,i)=>{const y=report.target.controls.invoices[i];
    return[x.InvoiceId,x.CustomerId,x.InvoiceDate,x.BillingCountry,x.lineCount,x.quantity,x.headerTotal,x.extendedLineTotal,
      y?.headerTotal,y?.extendedLineTotal,x.difference,y?.difference];});
  const sections=['source','target'].map(side=>'<section><h2>'+html(side==='source'?'Original source':'Native destination')+' keys and relationships</h2>'+
    table(['Table','Primary key','Rows','Distinct non-null keys','Null key rows','Duplicate keys'],report[side].keys.map(x=>[x.table,x.primaryKey.join(', '),x.rowCount,x.distinctNonNullKeys,x.nullRows.length,x.duplicates.length]))+
    table(['Relationship','Child','Parent','Columns','Checked rows','Nullable rows','Missing parents'],report[side].relations.map(x=>[x.id,x.childTable,x.parentTable,x.columns,x.checkedNonNullRows,x.nullChildRows.length,x.missingParents.length]))+
    '<h3>Every exact grouped control</h3>'+table(['Group','Key','Invoices','Lines','Quantity','Header total','Extended line total','Difference'],report[side].controls.groups.map(x=>[x.group,x.key,x.invoiceCount,x.lineCount,x.quantity,x.headerTotal,x.extendedLineTotal,x.difference]))+'</section>').join('');
  return'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chinook migration reconciliation</title><style>body{font:14px/1.5 system-ui,Arial,sans-serif;color:#242424;background:#f4f4f4;margin:0}main{max-width:1440px;margin:auto;padding:28px}header,section{background:white;border:1px solid #d4d4d4;padding:22px;margin-bottom:18px}h1{font-size:27px;margin:0 0 10px}h2{font-size:20px}p{max-width:100ch}.meta{font:12px ui-monospace,monospace;overflow-wrap:anywhere}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:12px}th,td{padding:8px 10px;text-align:left;vertical-align:top;border-bottom:1px solid #ddd}th{background:#eee}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px}a{color:#242424}@media(max-width:600px){main{padding:12px}header,section{padding:15px}}</style><main><header><p>DEFINIAN · MIGRATION ACCEPTANCE</p><h1>Complete Chinook reconciliation</h1><p>'+html(report.originalSourceMeaning)+'</p><p>Result: '+html(report.status)+'. The original complete typed comparison, every key and foreign key, all invoice calculations and every grouped control are retained below. Amounts use the source’s unspecified reference units.</p><p class="meta">Source '+html(report.provenance.sourceCommit)+'<br>Original source operation '+html(report.provenance.sourceOperationId)+'<br>Native job '+html(report.provenance.jobId)+'<br>Report '+html(report.reportSha256)+'</p></header>'+sections+
    '<section><h2>All source and destination invoice controls</h2>'+table(['Invoice','Customer','Local date','Country','Lines','Quantity','Source header','Source extended','Target header','Target extended','Source difference','Target difference'],invoiceRows)+'</section>'+
    '<section><h2>Exceptions and source mapping decisions</h2><p>'+report.exceptions.length+' complete exceptions.</p><pre>'+html(JSON.stringify({exceptions:report.exceptions,sourceControlDifferences:report.sourceControlDifferences,controlDifferences:report.controlDifferences,decisions:report.decisions},null,2))+'</pre></section></main></html>\n';
}
async function sourceReference(p,sourceRoot,runtimeReadyFile){
  const directory=join(p.root,'chinook','source'),received=join(directory,'received');
  mkdirSync(directory,{recursive:true,mode:0o700});
  if(p.options['chinook-reference']){
    const original=resolve(p.options['chinook-reference']),prepared=readReferenceDirectory(original);
    const manifest=read(join(original,'DELIVERY_MANIFEST.json'));
    const selectedSource={originalDirectory:original,manifest:prepared.binding.sourceManifest,sourceOperationId:prepared.binding.sourceOperationId};
    atomicJson(join(directory,'existing-source-selection.json'),selectedSource,{immutable:true});
    mkdirSync(received,{recursive:true,mode:0o700});
    atomicBytes(join(received,'DELIVERY_MANIFEST.json'),readFileSync(join(original,'DELIVERY_MANIFEST.json')),{immutable:true});
    for(const entry of manifest.files)atomicBytes(join(received,safeRelative(entry.path)),readFileSync(join(original,entry.path)),{immutable:true});
    const verified=readReferenceDirectory(received);
    requireValue(verified.binding.sourceOperationId===prepared.binding.sourceOperationId,'CHINOOK_SOURCE','Keep the original completed source operation.',409);
  }else{
    const ready=read(resolve(runtimeReadyFile)),runKey='original-source-'+randomUUID(),logs=join(directory,'invocations');
    mkdirSync(logs,{recursive:true,mode:0o700});
    const argv=[join(sourceRoot,'vendor/dlt/runtime/runtime.mjs'),'run','--directory',dirname(resolve(runtimeReadyFile)),
      '--cwd',directory,'--operation-lock',join(directory,'lifetime.lock'),'--argv-json',JSON.stringify([
        ready.python.executable,'-P',join(sourceRoot,'receiving/chinook-source.py'),'--source',sourceRoot,
        '--directory',directory,'--runtime-ready',resolve(runtimeReadyFile),...(p.options.resume?['--resume']:[])])];
    const out=join(logs,runKey+'.stdout.txt'),err=join(logs,runKey+'.stderr.txt');
    atomicJson(join(logs,runKey+'.request.json'),{executable:process.execPath,argv,selectedAt:now()},{immutable:true});
    const fds=[openSync(out,'wx',0o600),openSync(err,'wx',0o600)];let closed;
    try{closed=await new Promise((yes,no)=>{const child=spawn(process.execPath,argv,{cwd:sourceRoot,stdio:['ignore',fds[0],fds[1]]});
      child.once('error',no);child.once('exit',(exitCode,signal)=>yes({exitCode,signal}));});for(const fd of fds)fsyncSync(fd);}
    finally{for(const fd of fds)closeSync(fd);}
    atomicJson(join(logs,runKey+'.receipt.json'),{executable:process.execPath,argv,...closed,completedAt:now(),stdout:hashFile(out),stderr:hashFile(err)},{immutable:true});
    requireValue(closed.exitCode===0,'CHINOOK_SOURCE_REALIZATION','Continue the original complete source invocation with its retained result.',409,{runKey,...closed});
  }
  const prepared=readReferenceDirectory(received);
  requireValue(prepared.binding.tables.length===11&&prepared.binding.tables.reduce((n,t)=>n+t.rowCount,0)===15607,
    'CHINOOK_POPULATION','Retain all eleven original source tables and 15,607 rows.',409);
  return{directory:'chinook/source/received',sourceOperationId:prepared.binding.sourceOperationId,
    sourceManifest:prepared.binding.sourceManifest,sourceCommit:prepared.binding.sourceCommit,
    tables:prepared.binding.tables.map(t=>({table:t.originalTable,rows:t.rowCount})),files:walk(p.root,directory)};
}
async function compilePlan(p,host,projectId,prepared,intake){
  const built=buildPipelineInput(prepared,{sourceIds:intake.sourceIds,expectedSourceIds:intake.expectedSourceIds,
    pipelineName:'definian_chinook_reference',datasetName:'definian_chinook',title:'Complete original Chinook relational migration',phase:'baseline'});
  const path=join(p.root,'chinook','selected-pipeline-input.json');atomicJson(path,built.input,{immutable:true});
  const source=await p.localSource(host,projectId,'chinook-pipeline-input',path,{title:built.input.title,role:'pipeline_config'});
  const answer=await p.action(host,projectId,'chinook-plan-compile','plan.compile',{sourceId:source.sourceId,title:built.input.title});
  requireValue(answer.result.ready,'CHINOOK_PLAN','The full native original mapping must compile.',409);
  await p.action(host,projectId,'chinook-plan-approve','plan.review',{planId:answer.result.planId,decision:'approved',
    notes:'All eleven source tables, original full keys, exact decimal hints, explicit source-local date text and independent expected typed exports reviewed.'});
  return{planId:answer.result.planId,semanticPlanId:built.compiled.planId,input:descriptor(p.root,path),source};
}
async function fullParity(p,host,projectId,prepared,plan,job){
  const answer=await p.action(host,projectId,'chinook-complete-parity','comparison.create',{jobId:job.jobId}),view=await p.view(host,projectId);
  const comparison=selected(view.comparisons,answer.result.comparisonId,'comparison');
  requireValue(comparison.equal&&comparison.readyForCutover&&comparison.planId===plan.planId,'CHINOOK_PARITY','All complete original typed rows, keys, schemas and closed native packages must match.',409);
  const report=await p.download(host,'/api/projects/'+projectId+'/outputs/comparison/'+comparison.id,'chinook/delivery/complete-parity.json',comparison.report);
  const observations=await p.download(host,'/api/projects/'+projectId+'/outputs/observations/'+comparison.id,'chinook/delivery/complete-observations.json',comparison.observations);
  const full=read(join(p.root,observations.path)),planRow=selected(view.plans,plan.planId,'plan');
  const compiled=JSON.parse(host.app.workspace.store.objects.read(planRow.compiled.sha256,planRow.compiled.bytes).toString('utf8'));
  requireValue(full.streams.length===11&&full.pendingPackages===false&&full.failedJobs===false&&full.completeTables===true,
    'CHINOOK_NATIVE_CLOSURE','Keep every completed original table and native package state.',409);
  for(const t of prepared.binding.tables){
    const id=compiled.acceptance.find(a=>a.table===t.nativeTable)?.id,stream=full.streams.find(s=>s.streamId===id);
    requireValue(stream,'CHINOOK_NATIVE_TABLE','The actual native output omitted an original business table.',409);
    for(const side of ['left','right'])requireValue(stream[side].source.complete===true&&stream[side].source.rowCount===t.rowCount&&stream[side].rows.length===t.rowCount,
      'CHINOOK_NATIVE_POPULATION','The original full source and destination population differs.',409,{table:t.originalTable,side});
  }
  return{comparisonId:comparison.id,planId:plan.planId,jobId:job.jobId,report,observations};
}

function compiledPlan(host,view,planId){
  const row=selected(view.plans,planId,'pipeline plan');
  return JSON.parse(host.app.workspace.store.objects.read(row.compiled.sha256,row.compiled.bytes).toString('utf8'));
}
async function relationalReview(p,host,projectId,prepared,plan,jobRecord){
  const view=await p.view(host,projectId),job=selected(view.jobs,jobRecord.jobId,'native verify job');
  const compiled=compiledPlan(host,view,plan.planId),observed=job.files.find(f=>f.path==='artifacts/observations.json');
  requireValue(observed&&job.status==='complete'&&job.stage==='verify','CHINOOK_RECONCILIATION','Select the complete original native verification job.',409);
  const report=evaluateRelationalAcceptance({prepared,plan:compiled,
    observationsBytes:host.app.workspace.store.objects.read(observed.sha256,observed.bytes),
    selectionBytes:host.app.workspace.store.objects.read(job.selection.sha256,job.selection.bytes),
    job,workspaceInstanceId:host.app.workspace.store.instanceId,projectId});
  requireValue(report.status==='RECONCILED_FOR_REVIEW'&&report.exceptions.length===0&&
    report.source.controls.invoices.length===412&&report.target.controls.invoices.length===412&&
    report.source.controls.groups.length===89&&report.target.controls.groups.length===89,
    'CHINOOK_RECONCILIATION','Every source and target invoice, group, relationship and exact typed row must reconcile.',409);
  const jsonPath=join(p.root,'chinook/delivery/complete-relational-acceptance.json');
  const htmlPath=join(p.root,'chinook/delivery/complete-relational-acceptance.html');
  atomicJson(jsonPath,report,{immutable:true});atomicBytes(htmlPath,Buffer.from(reportDocument(report)),{immutable:true});
  const jsonSource=await p.localSource(host,projectId,'chinook-relational-json',jsonPath,
    {title:'Complete Chinook relationships, 412 invoices and 89 exact grouped controls',role:'relational_acceptance'});
  const htmlSource=await p.localSource(host,projectId,'chinook-relational-html',htmlPath,
    {title:'Readable complete Chinook migration reconciliation',role:'relational_acceptance_document',mediaType:'text/html; charset=utf-8'});
  const review=await p.action(host,projectId,'chinook-relational-reviewed','review.record',{subjectId:jsonSource.sourceId,decision:'reviewed',
    notes:'Reviewed all 11 source objects, every original key and foreign key, all 412 invoice calculations and 89 grouped controls against the complete original native verification. No measured exception; amounts retain their unspecified source reference units.'});
  return{reportSha256:report.reportSha256,status:report.status,invoices:412,groups:89,exceptions:0,
    json:descriptor(p.root,jsonPath),html:descriptor(p.root,htmlPath),jsonSource,htmlSource,review:review.result};
}
async function businessAcceptance(p,host,projectId,prepared,plan,parity){
  const compiled=compiledPlan(host,await p.view(host,projectId),plan.planId),input=measuredInput(prepared,compiled);
  const path=join(p.root,'chinook/selected-business-acceptance.json');atomicJson(path,input,{immutable:true});
  const source=await p.localSource(host,projectId,'chinook-business-input',path,
    {title:input.title,role:'acceptance_input'});
  const rules=await p.action(host,projectId,'chinook-business-compile','acceptance.compile',
    {title:input.title,sourceId:source.sourceId,planId:plan.planId});
  const measured=await p.action(host,projectId,'chinook-business-evaluate','acceptance.evaluate',
    {acceptancePlanId:rules.result.acceptancePlanId,comparisonId:parity.comparisonId});
  const report=selected((await p.view(host,projectId)).acceptanceReports,measured.result.acceptanceReportId,'business acceptance report');
  requireValue(report.readyForCutover===true&&report.findings.length===0,
    'CHINOOK_BUSINESS_ACCEPTANCE','All required whole-population keys, fields, relationships and exact controls must pass.',409);
  const file=await p.download(host,'/api/projects/'+projectId+'/sources/'+report.sourceId,
    'chinook/delivery/complete-business-acceptance.json',report.report);
  return{acceptancePlanId:rules.result.acceptancePlanId,reportId:report.id,semanticReportId:report.reportId,
    readyForCutover:report.readyForCutover,counts:report.counts,findings:report.findings,source,input:descriptor(p.root,path),file};
}
async function allConsumers(p,host,projectId,key,prepared,expectedSelection){
  const view=await p.view(host,projectId),tables=[];let shared=null,comparison=null,observations=null;
  for(const original of prepared.binding.tables){
    const plan=compiledPlan(host,view,view.currentPlanId),streamId=plan.acceptance.find(a=>a.table===original.nativeTable)?.id;
    requireValue(streamId,'CHINOOK_CONSUMER','The selected native stream is absent.',409);
    let first=null,rows=[];
    for(let offset=0;;offset+=1000){
      const value=await p.api(host,'/api/projects/'+projectId+'/consumer?streamId='+encodeURIComponent(streamId)+'&offset='+offset+'&limit=1000');
      requireValue(value.mode==='retained-complete-native-export'&&value.liveQuery===false&&value.rowCount===original.rowCount,
        'CHINOOK_CONSUMER_POPULATION','Keep every original typed consumer row.',409,{table:original.originalTable});
      requireValue(value.selection?.snapshot?.sha256===expectedSelection.snapshot.sha256,
        'CHINOOK_CONSUMER_SELECTION','Read the exact selected original consumer snapshot.',409);
      if(first)requireValue(value.selection.snapshot.sha256===first.selection.snapshot.sha256&&eq(value.columns,first.columns)&&eq(value.binding,first.binding),
        'CHINOOK_CONSUMER_CHANGED','The original consumer binding changed across pages.',409);else first=value;
      if(shared)requireValue(eq(shared,value.selection),'CHINOOK_CONSUMER_CHANGED','All business tables must come from one retained selection.',409);
      else{
        shared=value.selection;comparison=selected(view.comparisons,value.binding.comparisonId,'consumer comparison');
        observations=JSON.parse(host.app.workspace.store.objects.read(comparison.observations.sha256,comparison.observations.bytes).toString('utf8'));
      }
      rows.push(...value.rows);if(rows.length>=value.rowCount)break;
      requireValue(value.rows.length===1000,'CHINOOK_CONSUMER_PAGE','A complete original consumer page ended early.',409);
    }
    const observed=observations.streams.find(s=>s.streamId===streamId),side=first.binding.side==='expected'?'left':'right';
    requireValue(observed&&rows.length===original.rowCount&&eq(rows,observed[side].rows)&&eq(first.columns,observed[side].columns),
      'CHINOOK_CONSUMER_CELLS','Every displayed consumer cell and column must equal the actual selected full native observation.',409,{table:original.originalTable});
    tables.push({...first,rows,offset:0,limit:original.rowCount,originalTable:original.originalTable});
  }
  requireValue(tables.length===11&&tables.reduce((n,t)=>n+t.rows.length,0)===15607,
    'CHINOOK_CONSUMER_COVERAGE','Keep all eleven complete consumer tables.',409);
  const result={schema:'definian.chinook-complete-consumer.v1',projectId,selection:shared,comparisonId:comparison.id,
    complete:true,rows:15607,tables},path=join(p.root,'chinook/delivery/'+key+'-consumers.json');
  atomicJson(path,result,{immutable:true});return{...descriptor(p.root,path),selection:shared,rows:15607,tables:11};
}
async function browserCourse(p,host,projectId,phase,prepared,sourceRoot){
  const view=await p.view(host,projectId),compiled=compiledPlan(host,view,view.currentPlanId);
  const counts=Object.fromEntries(prepared.binding.tables.map(t=>[compiled.acceptance.find(a=>a.table===t.nativeTable).id,t.rowCount]));
  const result=await runBrowserJourney({directory:join(p.root,'chinook/browser',phase),origin:host.origin,
    operator:p.operator,viewer:p.viewer,projectId,sourceRoot,sourceManifestSha256:p.source.identity.sha256,
    playwright:resolve(p.options.playwright),chromium:resolve(p.options.chromium),phase,resume:p.options.resume===true,
    expectedRows:15607,expectedRowsByStream:counts,sourceIds:view.sources.map(x=>x.id),planIds:view.plans.map(x=>x.id),
    jobIds:view.jobs.map(x=>x.id),comparisonIds:view.comparisons.map(x=>x.id),handoffIds:view.handoffs.map(x=>x.id),
    acceptancePlanIds:view.acceptancePlans.map(x=>x.id),acceptanceReportIds:view.acceptanceReports.map(x=>x.id),
    acceptanceDecisionIds:view.acceptanceDecisions.map(x=>x.id)});
  requireValue(result?.status==='complete'&&result.phase===phase&&result.projectId===projectId&&Array.isArray(result.files),
    'CHINOOK_BROWSER','Retain the complete original Chinook browser journey.',409);
  safeRelative(result.resultPath);requireValue(result.resultPath.startsWith('browser/'+phase+'/'),
    'CHINOOK_BROWSER_PATH','Keep the actual original browser result in this programme phase.',409);
  const resultFile=descriptor(p.root,join(p.root,'chinook',result.resultPath));
  requireValue(eq(read(join(p.root,resultFile.path)),result),'CHINOOK_BROWSER_RESULT','Original browser result differs from the complete returned value.',409);
  const files=result.files.map(file=>{safeRelative(file.path);requireValue(file.path.startsWith('browser/'+phase+'/'),
    'CHINOOK_BROWSER_PATH','Every browser artifact must stay in its original phase.',409);return verify(p.root,{...file,path:'chinook/'+file.path});});
  return{original:result,resultFile,files:[...files,resultFile]};
}
export async function runChinookProgramme({programme:p,sourceRoot,runtimeReadyFile}){
  const source=await p.phase('chinook-01-original-source',()=>sourceReference(p,sourceRoot,runtimeReadyFile));
  for(const file of source.files)verify(p.root,file);
  const prepared=readReferenceDirectory(join(p.root,source.directory));
  const primary=await p.startHost('primary');
  const projectId=await p.phase('chinook-02-project',()=>p.create(primary,'chinook-project',
    'Chinook — complete relational migration','Original Chinook1.4.5 source; all 11 objects, 15,607 rows, full controls, native destination, reversible selection and complete editable receiving.'));
  const intake=await p.phase('chinook-03-full-source-intake',async()=>{
    const result=await retainReferenceInputs(primary.app.workspace,p.operator,
      {projectId,operationId:'chinook-'+identity({operationId:p.state.id,projectId}).slice(0,48),prepared});
    await p.action(primary,projectId,'chinook-runtime-select','runtime.select',{});
    const path=join(p.root,'chinook/intake.json');
    if(existsSync(path)){
      const original=read(path);requireValue(original.projectId===projectId&&original.operationId===result.operationId&&
        original.mappingSha256===result.mappingSha256&&eq(original.sourceIds,result.sourceIds)&&eq(original.expectedSourceIds,result.expectedSourceIds)&&
        original.ledgerSourceId===result.ledgerSourceId,'CHINOOK_INTAKE_REPLAY','Continue the same completed original intake result.',409);return original;
    }
    atomicJson(path,result,{immutable:true});return result;
  });
  const plan=await p.phase('chinook-04-original-plan',()=>compilePlan(p,primary,projectId,prepared,intake));
  const loaded=await p.phase('chinook-05-native-pipeline',()=>p.stage(primary,projectId,'chinook-native-run',plan,null,'run'));
  const verified=await p.phase('chinook-06-native-verification',()=>p.stage(primary,projectId,'chinook-native-verify',plan,loaded,'verify'));
  const parity=await p.phase('chinook-07-complete-typed-parity',()=>fullParity(p,primary,projectId,prepared,plan,verified));
  const relational=await p.phase('chinook-08-full-relational-reconciliation',()=>relationalReview(p,primary,projectId,prepared,plan,verified));
  const acceptance=await p.phase('chinook-09-required-business-acceptance',()=>businessAcceptance(p,primary,projectId,prepared,plan,parity));
  const expectedSources=await p.phase('chinook-10-complete-source-selection',async()=>{
    const view=await p.view(primary,projectId);return view.sources.map(s=>({sourceId:s.id,bytes:s.bytes,sha256:s.sha256}));
  });
  const cutover=await p.phase('chinook-11-cutover-rollback-and-reselect',async()=>{
    const payload={comparisonId:parity.comparisonId,acceptanceReportId:acceptance.reportId,
      reason:'Select every original Chinook business table after complete native parity, required business acceptance and full invoice/relationship review.'};
    const first=await p.phase('chinook-11a-selected-consumers',async()=>{
      const answer=await p.action(primary,projectId,'chinook-cutover','cutover.apply',payload);
      return{action:answer.result,consumer:await allConsumers(p,primary,projectId,'selected',prepared,answer.result.selection)};
    });
    const rollback=await p.phase('chinook-11b-rollback-consumers',async()=>{
      const answer=await p.action(primary,projectId,'chinook-rollback','cutover.rollback',{cutoverId:first.action.cutoverId,
        reason:'Reopen the original complete expected-source consumer population while preserving every native object and accepted history.'});
      return{action:answer.result,consumer:await allConsumers(p,primary,projectId,'rollback',prepared,answer.result.selection)};
    });
    const final=await p.phase('chinook-11c-reselected-consumers',async()=>{
      const answer=await p.action(primary,projectId,'chinook-reselect','cutover.apply',payload);
      return{action:answer.result,consumer:await allConsumers(p,primary,projectId,'final',prepared,answer.result.selection)};
    });
    return{first:first.action,rollback:rollback.action,final:final.action,selected:first.consumer,rolled:rollback.consumer,current:final.consumer};
  });
  const h1=await p.phase('chinook-12-original-handoff',()=>p.handoff(primary,projectId,'CHINOOK-H1',
    'Complete original 11-table Chinook migration, exact invoice reconciliation and accepted native consumer'));
  const browserPrimary=await p.phase('chinook-13-primary-browser',()=>browserCourse(p,primary,projectId,'primary',prepared,sourceRoot));
  const h2=await p.phase('chinook-14-complete-handoff',()=>p.handoff(primary,projectId,'CHINOOK-H2',
    'Complete Chinook editable workspace after every primary operator pane, table, report and full typed consumer review'));
  const receiving=await p.startHost('receiving');
  const fresh=await p.phase('chinook-15-fresh-receiving',async()=>{
    const empty=await p.create(receiving,'chinook-receiving-project','Received complete Chinook workspace',
      'Retain the original project, complete source, database, controls, rule decisions and full version history.');
    const received=await p.receive(receiving,empty,'chinook-fresh-H2',h2,'imported');
    const view=await p.view(receiving,projectId);
    requireValue(view.currentAcceptanceReportId===acceptance.reportId&&view.currentPlanId===plan.planId,
      'CHINOOK_RECEIVING','The received selection must preserve the original native plan and complete accepted report.',409);
    const intakeAdoption=await retainReferenceInputs(receiving.app.workspace,p.operator,
      {projectId,operationId:intake.operationId,prepared});
    requireValue(intakeAdoption.completedOriginalIntakeAdopted===true&&eq(intakeAdoption.sourceIds,intake.sourceIds)&&
      eq(intakeAdoption.expectedSourceIds,intake.expectedSourceIds),'CHINOOK_INTAKE_RECEIVING',
      'Adopt the complete retained original source requests and IDs without duplicating an intake.',409);
    return{result:received.result,intakeAdoption,
      audit:await p.audit(receiving,projectId,'chinook-fresh',expectedSources),
      consumer:await allConsumers(p,receiving,projectId,'received',prepared,cutover.final.selection)};
  });
  const browserReceiving=await p.phase('chinook-16-receiving-browser',()=>browserCourse(p,receiving,projectId,'receiving',prepared,sourceRoot));
  const returned=await p.phase('chinook-17-forward-same-older-history',async()=>{
    await p.action(receiving,projectId,'chinook-received-review','review.record',{subjectId:relational.jsonSource.sourceId,
      decision:'received',notes:'Received and reviewed every original Chinook source member, all 11 loaded tables, 412 invoice controls, 89 groups, original current acceptance, both complete browser roles and full editable history on the second installation.'});
    const h3=await p.handoff(receiving,projectId,'CHINOOK-H3','Returned complete original Chinook migration and independent receiving review');
    const forward=await p.receive(primary,projectId,'chinook-forward-H3',h3,'forward');
    const same=await p.receive(primary,projectId,'chinook-same-H3',h3,'same');
    const older=await p.receive(primary,projectId,'chinook-older-H1',h1,'older');
    requireValue([forward,same,older].every(r=>r.result.currentRevision===h3.revision),
      'CHINOOK_PREFIX_HISTORY','Keep the newest returned history across forward, duplicate and older original packages.',409);
    return{h3,forward:forward.result,same:same.result,older:older.result,
      audit:await p.audit(primary,projectId,'chinook-returned',expectedSources)};
  });
  await p.closeHost('receiving');await p.closeHost('primary');
  const reopened=await p.phase('chinook-18-cold-cli-reopen',async()=>{
    const result={};for(const host of ['primary','receiving']){
      const directory=join(p.root,'workspaces',host);
      const show=await p.cli('chinook-'+host+'-show','show',['--directory',directory,'--project',projectId]);
      requireValue(show.value.view.revision===returned.h3.revision&&show.value.view.currentAcceptanceReportId===acceptance.reportId&&
        show.value.view.currentPlanId===plan.planId,'CHINOOK_COLD_REOPEN','Cold reopen must preserve the original complete accepted programme.',409);
      const path=join(p.root,'cli','chinook-'+host+'-original-H1.ndjson');
      await p.cli('chinook-'+host+'-original-handoff','download',
        ['--directory',directory,'--project',projectId,'--kind','handoff','--id',h1.handoffId,'--output',path]);
      requireValue(eq(hashFile(path),{bytes:h1.archive.bytes,sha256:h1.archive.sha256}),
        'CHINOOK_NAMED_HANDOFF','The original named complete archive must remain byte-identical after every receiving edition.',409);
      result[host]={revision:show.value.view.revision,named:descriptor(p.root,path)};
    }return result;
  });
  const files=[...source.files,plan.input,descriptor(p.root,join(p.root,'chinook/intake.json')),
    parity.report,parity.observations,relational.json,relational.html,acceptance.input,acceptance.file,
    ...[loaded,verified].map(job=>descriptor(p.root,join(p.root,'native-results',job.jobId+'.json'))),
    ...browserPrimary.files,...browserReceiving.files,...[h1,h2,returned.h3].map(x=>x.archive),
    cutover.selected,cutover.rolled,cutover.current,fresh.audit,fresh.consumer,returned.audit,...Object.values(reopened).map(x=>x.named)];
  const artifacts=[...new Map(files.map(file=>[file.path,{path:file.path,bytes:file.bytes,sha256:file.sha256}])).values()];
  for(const file of artifacts)verify(p.root,file);
  return{schema:'definian.chinook-programme-result.v1',projectId,revision:returned.h3.revision,source,
    originalEngine:'dlt 1.31.0',sourceCommit:prepared.binding.sourceCommit,rows:15607,tables:11,
    intake,plan,native:{loaded,verified},parity,relational,acceptance,consumer:cutover,
    browser:{primary:browserPrimary,receiving:browserReceiving},
    receiving:{fresh,forward:returned.forward,same:returned.same,older:returned.older,reopened},
    namedPackages:[h1,h2,returned.h3],artifacts};
}
