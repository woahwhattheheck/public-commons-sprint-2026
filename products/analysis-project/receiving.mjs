#!/usr/bin/env node
// MIT. One installed continuation of the retained 7DE2 Analysis project.
import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';

const OPERATION='SCF-ANALYSIS-PROJECT-INSTALLED-D9B53-20261012';
const ORIGINAL={bytes:4265758,sha256:'31a92f2bacd565eac461478519ec2ebc44df7af1fadeda2a9c82f62ab3c27355',
  workspaceId:'5e7e814ca0a4464680168c079b0430bb',members:143,
  originalOperation:'SCF-ANALYSIS-PROJECT-OPENING-7DE2-20261012'};
const PREFIX='stellar/scf-starforge-20261009/distribution';
const json=value=>JSON.stringify(value,null,2)+'\n';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(condition,message)=>{if(!condition)throw new Error(message);};
const pause=ms=>new Promise(done=>setTimeout(done,ms));
const {values}=parseArgs({options:{
  runtime:{type:'string'},workspace:{type:'string'},installation:{type:'string'},python:{type:'string'},
  project:{type:'string'},out:{type:'string'},'source-commit':{type:'string'},
}});
for(const name of ['runtime','workspace','project','out','source-commit'])
  need(values[name],'Supply --'+name+' with its actual original selection.');
for(const name of ['runtime','workspace','project','out'])
  need(resolve(values[name])===values[name],'Select absolute canonical '+name+'.');
need(Boolean(values.installation)!==Boolean(values.python),'Select exactly one of --installation or --python.');
if(values.installation)need(/^[a-f0-9]{64}$/.test(values.installation),'Select the original installed Python environment ID.');
if(values.python)need(resolve(values.python)===values.python,'Select the actual absolute Python executable.');
need(/^[a-f0-9]{40}$/.test(values['source-commit']),'Select the installed source commit.');
const root=values.out;
await mkdir(root,{recursive:true,mode:0o700});
const st=await lstat(root);
need(st.isDirectory() && !st.isSymbolicLink() && (st.mode&0o077)===0 && st.uid===process.getuid(),
  'Keep the retained private operation directory.');
const plan=JSON.parse(await readFile(join(values.runtime,'runtime-install.json'),'utf8'));
need(plan.source?.sourceCommit===values['source-commit'] &&
  plan.sourceRoot===join(values.runtime,'package','source'),'Keep the actual selected installed release.');
const sourceRoot=plan.sourceRoot;
const storage=await import(pathToFileURL(join(sourceRoot,PREFIX,'runtime-workspace/storage.mjs')));
const {openRuntimeWorkspace}=await import(pathToFileURL(join(sourceRoot,PREFIX,'runtime-workspace/model.mjs')));
const lease=await storage.operationLease(join(root,'.installed-receiving.lock'));
const model=await openRuntimeWorkspace({directory:values.workspace});
const config={operation:OPERATION,...values,sourceManifestSha256:plan.source.manifestSha256,original:ORIGINAL};
const pathFor=name=>join(root,name+'.json');
async function read(name){try{return JSON.parse(await readFile(pathFor(name),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;return null;}}
async function keep(name,value){
  const path=pathFor(name),raw=json(value);
  try {await writeFile(path,raw,{flag:'wx',mode:0o600});}
  catch(error){if(error.code!=='EEXIST')throw error;need(await readFile(path,'utf8')===raw,'Preserve the original '+name+' selection.');}
  const handle=await open(path,'r');try{await handle.sync();}finally{await handle.close();}
  const parent=await open(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}
  return value;
}
async function once(name,work){const old=await read(name);return old??keep(name,await work());}
async function identity(path){
  const file=await open(path,'r');
  try{
    const before=await file.stat(),digest=createHash('sha256');let bytes=0;
    need(before.isFile(),'Select a complete regular artifact.');
    for await(const chunk of file.createReadStream({autoClose:false})){bytes+=chunk.length;digest.update(chunk);}
    const after=await file.stat();
    need(bytes===before.size && before.ino===after.ino && before.dev===after.dev &&
      before.size===after.size && before.mtimeMs===after.mtimeMs && before.ctimeMs===after.ctimeMs,
      'The original artifact changed while reading.');
    return {path,bytes,sha256:digest.digest('hex')};
  }finally{await file.close();}
}
async function waitFor(label,readValue,ready,seconds=120){
  const until=Date.now()+seconds*1000;let last;
  while(Date.now()<until){last=await readValue();if(ready(last))return last;await pause(250);}
  await keep('waiting-'+label+'-'+randomUUID(),{operation:OPERATION,label,last});
  throw new Error('Continue the retained '+label+' operation; its final state is saved.');
}
async function pythonOperation(name,operation,selection){
  const request=await once(name+'-request',async()=>({
    requestId:randomUUID(),operation,runtimeId:attached.runtimeId,...selection,
  }));
  const view=async()=>(await model.pythonState({runtimeId:attached.runtimeId}))
    .operations.find(item=>item.id===request.requestId)??null;
  const previous=await view();
  await once(name+'-accepted',()=>model.begin(request));
  if(previous && !previous.workerActive &&
    (['QUEUED','FAILED'].includes(previous.phase) || previous.displayPhase==='INTERRUPTED')){
    const recovered=await model.recoverPythonOperation(request.requestId);
    await keep(name+'-recovery-'+randomUUID(),recovered);
  }
  const completed=await waitFor(name,view,row=>Boolean(row &&
    (['SUCCEEDED','FAILED'].includes(row.phase) || row.displayPhase==='INTERRUPTED')),900);
  need(completed.phase==='SUCCEEDED',
    'Continue the original Python operation '+request.requestId+': '+JSON.stringify(completed.error??completed.displayPhase));
  const receipt=completed.result;
  need(receipt?.schema==='stellar-forge.python-operation-result.v1' && receipt.operation===operation &&
    receipt.binding?.runtimeId===attached.runtimeId &&
    receipt.binding.sourceCommit===values['source-commit'] &&
    receipt.binding.sourceManifestSha256===plan.source.manifestSha256,
    'Retain the actual Python operation result from this selected source release.');
  await keep(name+'-result',receipt);
  return receipt.result;
}
async function selectPython(){
  if(values.installation)return values.installation;
  const review=await once('python-source-review',()=>model.pythonReview({
    runtimeId:attached.runtimeId,python:values.python,extras:[],
  }));
  const version=review.interpreter?.version;
  need(Array.isArray(version) && (version[0]>3 || version[0]===3 && version[1]>=12),
    'The original Analysis project requires Python 3.12 or newer.');
  need(review.binding?.sourceCommit===values['source-commit'] &&
    review.binding.sourceManifestSha256===plan.source.manifestSha256 &&
    review.project?.scripts?.['stellar-forge-analysis-project']==='stellar_forge_buyer.analysis_projects:main',
    'Review the original selected package containing the Analysis project command.');
  const candidate=await pythonOperation('python-resolve','python-resolve',{reviewId:review.reviewId});
  need(/^[a-f0-9]{64}$/.test(candidate?.id??''),'Read the exact original resolved Python cohort.');
  const installation=await pythonOperation('python-install','python-install',{
    candidateId:candidate.id,reviewId:review.reviewId,
  });
  need(/^[a-f0-9]{64}$/.test(installation?.id??'') &&
    installation.entrypoints?.['stellar-forge-analysis-project']?.target==='stellar_forge_buyer.analysis_projects:main',
    'Read the actual original installed Analysis project command.');
  const activation=await once('python-activation-selection',async()=>{
    const current=await model.pythonState({runtimeId:attached.runtimeId});
    return {installationId:installation.id,expectedInstallationId:current.active?.installation??null,python:review.python};
  });
  const active=await pythonOperation('python-activate','python-activate',activation);
  need(active.installation===installation.id,'Retain the exact activated Python installation.');
  await keep('python-selection',{mode:'commissioned',installationId:installation.id,python:review.python,
    reviewId:review.reviewId,candidateId:candidate.id,sourceCommit:values['source-commit'],
    sourceManifestSha256:plan.source.manifestSha256});
  return installation.id;
}
async function app(id){
  const state=await model.applicationsState({historyLimit:30});
  const value=state.applications.find(item=>item.id===id);
  need(value,'Read the original saved application.');
  return value;
}
async function ensureApp(name,kind,settings){
  const reviewed=await once(name+'-review',()=>model.applicationsReview({
    runtimeId:attached.runtimeId,kind,settings,label:name+' / original Analysis project',
  }));
  const input=await once(name+'-save-request',async()=>({requestId:randomUUID(),reviewId:reviewed.id}));
  const saved=await once(name+'-saved',()=>model.applicationsSave(input));
  need(saved.saved && !saved.connectionError,'The original application connection must complete.');
  const ready=await waitFor(name+'-connection',()=>app(saved.applicationId),value=>Boolean(value.release));
  need(ready.release.sourceCommit===values['source-commit'],'Keep the same installed release.');
  return {id:saved.applicationId,review:reviewed,saved};
}
async function start(name,application){
  const reviewed=await once(name+'-start-review',()=>model.applicationsStartReview({applicationId:application.id}));
  const input=await once(name+'-start-request',async()=>({
    applicationId:application.id,requestId:randomUUID(),reviewId:reviewed.id,
  }));
  await once(name+'-accepted',()=>model.applicationsStart(input));
  return {applicationId:application.id,operationId:input.requestId};
}
async function runView(run){
  const selected=await app(run.applicationId);
  return selected.runs.find(item=>item.id===run.operationId)??null;
}
async function listener(run){
  const selected=await waitFor('listener-'+run.operationId,()=>runView(run),
    row=>Boolean(row?.active && row.privateUrl));
  const url=new URL(selected.privateUrl);
  need(url.protocol==='http:' && url.hostname==='127.0.0.1' && url.hash.length>1,
    'Use the actual private original loopback listener.');
  need(selected.url?.workspaceId===ORIGINAL.workspaceId &&
    Number.isInteger(selected.url?.originalPid),'Keep the original observed workspace and process identity.');
  return {url,selected};
}
async function api(run,path,body){
  const {url}=await listener(run);
  const response=await fetch(new URL(path,url),{method:body===undefined?'GET':'POST',
    headers:{Origin:url.origin,'X-Analysis-Capability':url.hash.slice(1),
      ...(body===undefined?{}:{'Content-Type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});
  const raw=await response.text();
  need(raw.length<=16*1024*1024,'Keep the complete original control response within its limit.');
  let value;try{value=JSON.parse(raw);}catch{value={text:raw};}
  need(response.ok,'Original Analysis request failed: '+response.status+' '+JSON.stringify(value));
  return value;
}
async function stop(name,run){
  const input=await once(name+'-stop-request',async()=>run);
  const current=await runView(run);
  if(current?.active)await model.applicationsStop(input);
  const stopped=await waitFor(name+'-stopped',()=>runView(run),
    row=>row && !row.active && ['SUCCEEDED','CANCELLED','FAILED'].includes(row.phase));
  need(stopped.phase!=='FAILED','The original managed application stop failed.');
  return keep(name+'-stopped',stopped);
}
async function cli(name,args){
  const bound=await model.pythonCommand({runtimeId:attached.runtimeId,installationId,
    command:'stellar-forge-analysis-project',args});
  const attempt=join(root,name+'-'+randomUUID());
  await mkdir(attempt,{mode:0o700});
  await writeFile(join(attempt,'command.json'),json(bound),{flag:'wx',mode:0o600});
  const stdout=await open(join(attempt,'stdout'),'wx',0o600),stderr=await open(join(attempt,'stderr'),'wx',0o600);
  let child,interrupt=null;
  const stopChild=signal=>{interrupt=signal;if(child)child.kill('SIGINT');};
  const onInt=()=>stopChild('SIGINT'),onTerm=()=>stopChild('SIGTERM');
  process.on('SIGINT',onInt);process.on('SIGTERM',onTerm);
  try{
    need(!interrupt,'The original command was stopped before dispatch.');
    child=spawn(bound.executable,bound.argv,{cwd:bound.cwd,env:process.env,
      stdio:['ignore',stdout.fd,stderr.fd]});
    if(interrupt)child.kill('SIGINT');
    const ended=await new Promise((done,fail)=>{
      child.once('error',fail);child.once('close',(code,signal)=>done({code,signal}));
    });
    await writeFile(join(attempt,'exit.json'),json({...ended,exitObserved:true,interrupt}),{flag:'wx',mode:0o600});
    need(ended.code===0 && !interrupt,'The original installed command ended; retain its complete output at '+attempt);
    const raw=await readFile(join(attempt,'stdout'),'utf8');
    return JSON.parse(raw);
  }finally{
    if(child && child.exitCode===null && child.signalCode===null)child.kill('SIGINT');
    process.off('SIGINT',onInt);process.off('SIGTERM',onTerm);
    await stdout.close();await stderr.close();
  }
}
function redact(value){
  if(Array.isArray(value))return value.map(redact);
  if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>
    [key,/token|capability|secret/i.test(key)?'[private]':redact(item)]));
  if(typeof value==='string' && /^https?:\/\//.test(value)){try{const url=new URL(value);url.hash='';return url.href;}catch{}}
  return value;
}
let attached,installationId;
try{
  await keep('operation',config);
  const existing=await read('complete');
  if(existing){
    const current=await identity(existing.delivery.path);
    need(current.bytes===existing.delivery.bytes && current.sha256===existing.delivery.sha256,'Keep the completed original following ZIP.');
    process.stdout.write(json({operation:OPERATION,state:'COMPLETE',reused:true,delivery:current,report:pathFor('complete')}));
  }else{
    const input=await identity(values.project);
    need(input.bytes===ORIGINAL.bytes && input.sha256===ORIGINAL.sha256,'Select the exact original 7DE2 complete project.');
    attached=await once('runtime-attachment',()=>model.attach({directory:values.runtime,label:'Analysis project installed continuation'}));
    installationId=await selectPython();
    await once('python-installation',()=>model.pythonState({runtimeId:attached.runtimeId}));
    const inspected=await once('original-inspection',()=>cli('inspect-original',[
      '--checkout',sourceRoot,'--project',values.project,'--project-sha256',ORIGINAL.sha256,'inspect']));
    need(inspected.workspace_id===ORIGINAL.workspaceId && inspected.members===ORIGINAL.members,'Keep the complete original case.');
    const database=join(root,'customer','analysis'),cache=join(root,'retained-project');
    await mkdir(dirname(database),{recursive:true,mode:0o700});
    const settings={installationId,projectPath:values.project,databaseDirectory:database,
      projectCache:cache,projectSha256:ORIGINAL.sha256,nodeExecutable:process.execPath,port:0};
    const opening=await ensureApp('customer','python-analysis-project',settings);
    const run=await start('customer-first',opening);
    const before=await once('customer-before',()=>api(run,'/api/state'));
    need(before.workspace_id===ORIGINAL.workspaceId && before.views.length>0,'Open the retained original analytical views.');
    await once('customer-source-review',async()=>{
      const snapshot=JSON.parse(await readFile(join(cache,'project-data.json'),'utf8'));
      const table=snapshot.tables.find(item=>item.name==='sf_analysis_response_sources');
      const sources=(table?.rows??[]).map(row=>JSON.parse(row.record.text));
      need(sources.length===3,'Keep all three original retained response groups.');
      const descriptions=[];
      for(const source of sources)descriptions.push({name:source.name,revision:source.revision,
        description:await api(run,'/api/response-source/'+encodeURIComponent(source.name)+'?revision='+source.revision)});
      return {sources:descriptions,queries:before.queries,views:before.views,reports:before.reports,workbooks:before.workbooks};
    });
    const decision=await once('customer-query-decision',async()=>{
      const quote=name=>'"'+name.replaceAll('"','""')+'"',literal=name=>"'"+name.replaceAll("'","''")+"'";
      const names=before.views.map(view=>view.name).sort();
      need(names.every(name=>typeof name==='string' && name.length>0),'Read the actual original named views.');
      return {name:'delivery_inventory_d9b53',sql:names.map(name=>
        'SELECT '+literal(name)+' AS source_view, COUNT(*) AS retained_rows FROM '+quote(name)).join(' UNION ALL ')+' ORDER BY source_view',
        parameters_text:'[]',max_rows:1000,expected_revision:0,expected_views:before.views,
        rationale:'Preserve the retained row count of every currently selected source view in the customer handover.',
        queryJob:randomUUID().replaceAll('-','')};
    });
    const changed=await once('customer-query-saved',async()=>{
      const state=await api(run,'/api/state'),found=state.queries.find(row=>row.name===decision.name);
      if(found){
        const current=await api(run,'/api/queries/'+decision.name);
        need(current.revision===1 && current.sql===decision.sql && current.parameters_text===decision.parameters_text,
          'Preserve the customer’s independently saved query.');
        return current;
      }
      return api(run,'/api/queries/'+decision.name,{sql:decision.sql,parameters_text:decision.parameters_text,
        max_rows:decision.max_rows,expected_revision:decision.expected_revision});
    });
    const queryResult=await once('customer-query-result',async()=>{
      const requested=await api(run,'/api/start/query',{id:decision.queryJob,sql:decision.sql,
        parameters_text:decision.parameters_text,max_rows:decision.max_rows,expected_views:decision.expected_views});
      const result=requested.status==='RUNNING'?await waitFor('customer-query',
        ()=>api(run,'/api/jobs/'+decision.queryJob),job=>job.status!=='RUNNING'):requested;
      need(result.status==='COMPLETE' && result.result.total_rows===before.views.length,
        'Complete the original retained-view inventory query.');
      return result;
    });
    await once('customer-first-stop',()=>stop('customer-first',run));
    const restarted=await start('customer-reopen',opening);
    const reopened=await once('customer-reopened',async()=>{
      const state=await api(restarted,'/api/state'),query=await api(restarted,'/api/queries/'+decision.name);
      need(query.revision===changed.revision && query.sql===changed.sql,'The customer revision must survive original receiving reentry.');
      for(const old of before.queries)need(state.queries.some(item=>item.name===old.name && item.revision===old.revision),
        'Preserve every original saved query revision.');
      return {state,query};
    });
    await once('customer-reopen-stop',()=>stop('customer-reopen',restarted));
    const output=join(root,'following-delivery');
    const exporting=await ensureApp('handover','python-analysis-project-export',{
      installationId,projectPath:values.project,databaseDirectory:database,
      projectCache:cache,projectSha256:ORIGINAL.sha256,nodeExecutable:process.execPath,
      outputDirectory:output,title:'Retained source coverage and customer analysis',
    });
    const archiveArgs=exporting.review.command.args;
    const archiveId=archiveArgs[archiveArgs.indexOf('--operation')+1];
    need(/^[a-f0-9]{32}$/.test(archiveId),'Retain the bound original archive ID.');
    const exportedRun=await start('handover-export',exporting);
    await once('handover-run-result',async()=>{
      const result=await waitFor('complete-export',()=>runView(exportedRun),
        row=>row && !row.active && ['SUCCEEDED','FAILED','CANCELLED'].includes(row.phase),600);
      need(result.phase==='SUCCEEDED','Continue the original full project export from its actual result.');
      return result;
    });
    const delivered=await once('following-project',async()=>{
      const result=JSON.parse(await readFile(join(output,'project-operation-result.json'),'utf8'));
      need(result.state==='COMPLETE' && result.operation.operation_id===archiveId,'Read the original complete following delivery.');
      return result;
    });
    const delivery=await identity(delivered.delivery.archive.path);
    need(delivery.bytes===delivered.delivery.archive.bytes && delivery.sha256===delivered.delivery.archive.sha256,
      'Keep all complete following project bytes.');
    const following=await once('following-inspection',()=>cli('inspect-following',[
      '--checkout',sourceRoot,'--project',delivery.path,'--project-sha256',delivery.sha256,'inspect']));
    const secondDatabase=join(root,'independent-customer','analysis'),secondCache=join(root,'following-retained-project');
    await mkdir(dirname(secondDatabase),{recursive:true,mode:0o700});
    const second=await ensureApp('independent-customer','python-analysis-project',{
      installationId,projectPath:delivery.path,databaseDirectory:secondDatabase,
      projectCache:secondCache,projectSha256:delivery.sha256,nodeExecutable:process.execPath,port:0,
    });
    const secondRun=await start('independent-open',second);
    await once('independent-receiving',async()=>{
      const state=await api(secondRun,'/api/state'),query=await api(secondRun,'/api/queries/'+decision.name);
      need(state.workspace_id===ORIGINAL.workspaceId && query.revision===changed.revision &&
        query.sql===changed.sql,'The complete handover must reopen the current customer revision.');
      const snapshot=JSON.parse(await readFile(join(secondCache,'project-data.json'),'utf8'));
      const sources=snapshot.tables.find(item=>item.name==='sf_analysis_response_sources').rows.map(row=>JSON.parse(row.record.text));
      const reopenedSources=[];
      for(const source of sources)reopenedSources.push(await api(secondRun,
        '/api/response-source/'+encodeURIComponent(source.name)+'?revision='+source.revision));
      const originalSnapshot=JSON.parse(await readFile(join(cache,'project-data.json'),'utf8'));
      for(const file of originalSnapshot.sourceInputs)need(snapshot.sourceInputs.some(item=>
        item.file===file.file && item.sha256===file.sha256 && item.bytes===file.bytes),
        'Preserve the complete original retained response payloads.');
      const queryTable=snapshot.tables.find(item=>item.name==='sf_analysis_queries');
      need(queryTable.rows.some(row=>row.name.text===decision.name && JSON.parse(row.record.text).revision===changed.revision),
        'The offline reader must include the current saved customer query.');
      return {state,query,sources:reopenedSources,reader:await identity(join(secondCache,'project.html')),
        snapshot:await identity(join(secondCache,'project-data.json')),sourceFiles:snapshot.sourceInputs.length};
    });
    await once('independent-stop',()=>stop('independent-open',secondRun));
    const repeated=await once('repeated-export',()=>cli('repeat-complete-export',archiveArgs));
    need(repeated.reused===true && repeated.delivery.archive.sha256===delivery.sha256,
      'The same complete export must return its exact original bytes.');
    const records={};
    for(const name of ['runtime-attachment','python-source-review','python-resolve-result','python-install-result',
      'python-activation-selection','python-activate-result','python-selection','python-installation','original-inspection','customer-source-review',
      'customer-query-decision','customer-query-saved','customer-query-result','customer-first-stop','customer-reopened',
      'customer-reopen-stop','handover-review','handover-run-result','following-project','following-inspection',
      'independent-receiving','independent-stop','repeated-export'])records[name]=await read(name);
    const complete=await keep('complete',redact({schema:'stellar-forge.analysis-project-installed-receiving.v1',
      operation:OPERATION,state:'COMPLETE',sourceCommit:values['source-commit'],sourceManifestSha256:plan.source.manifestSha256,
      original:ORIGINAL,delivery,records,completedAt:new Date().toISOString()}));
    process.stdout.write(json({operation:OPERATION,state:complete.state,delivery,report:pathFor('complete'),
      archiveId,customerQuery:decision.name,queryRevision:changed.revision,queryRows:queryResult.result.total_rows}));
  }
}finally{await model.close();await lease.close();}
