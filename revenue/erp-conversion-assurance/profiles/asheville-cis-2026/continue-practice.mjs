#!/usr/bin/env node
// MIT. Continue the browser against an existing, completed native Practice workspace.
import {readFile,lstat,mkdir,mkdtemp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startAsheville} from './cli.mjs';
import {runProgram} from './backup.mjs';
import {need,sha,json,atomic,privateDirectory} from './util.mjs';

const expect=(value,message)=>need(value,message,'PRACTICE_CONTINUATION_INVALID',400);
async function originalFiles(root) {
  const names=['result.json','practice-files/browser-scenario.json',
    'practice-files/browser-addresses.csv','practice-files/field-route.html',
    'practice-files/practice-photo.png'];
  const optional='native-continuation-result.json';
  try { await lstat(join(root,optional)); names.push(optional); }
  catch(error) { if(error.code!=='ENOENT')throw error; }
  const bytes={},identities={};
  for(const name of names) {
    const path=join(root,name),s=await lstat(path);
    expect(s.isFile()&&!s.isSymbolicLink(),'Retain the original ordinary file: '+name);
    bytes[name]=await readFile(path);
    identities[name]={bytes:bytes[name].length,sha256:sha(bytes[name])};
  }
  return {bytes,identities};
}
async function comparedJobs(app,ids) {
  const output=[];
  // These are the original completed jobs; this path does not enqueue comparisons.
  for(const id of ids) {
    const value=await app.model.getJob(id);
    expect(value.job.state==='COMPLETED','The original comparison must be complete: '+id);
    output.push({id,status:value.comparison.status,reviews:value.reviews.length,
      reportSha256:value.job.result.report.sha256});
  }
  return output;
}
function retainedMetadata(store) {
  return Object.fromEntries(store.list().map(project=>{
    const summary=store.summary(project.id);
    return [project.id,{
      assets:summary.assets.map(a=>({name:a.name,sha256:a.sha256,bytes:a.bytes,kind:a.kind})),
      datasets:summary.datasets.map(d=>({id:d.id,source:d.sourceSha256,rows:d.rowsSha256})),
      history:store.history(project.id)
    }];
  }));
}
function checkOriginalMetadata(before,after) {
  for(const [id,retained] of Object.entries(before)) {
    expect(after[id],'The original project disappeared: '+id);
    for(const group of ['assets','datasets']) {
      const values=new Set(after[id][group].map(value=>json(value)));
      expect(retained[group].every(value=>values.has(json(value))),
        'An original '+group+' identity changed in project '+id);
    }
    expect(json(after[id].history.slice(0,retained.history.length))===json(retained.history),
      'The original journal prefix changed in project '+id);
  }
}
function baseline(store,projectId) {
  const rows=store.db.prepare('SELECT * FROM bill_baselines WHERE project=? ORDER BY bill_id').all(projectId);
  return {count:rows.length,sha256:sha(json(rows))};
}
export async function continuePractice({directory,readonly=false,
  python=process.env.UTILITY_PYTHON??'python3'}={}) {
  expect(typeof directory==='string'&&directory,'Select the existing completed Practice operation.');
  const root=resolve(directory),workspace=join(root,'workspace');
  const info=await lstat(root);
  expect(info.isDirectory()&&!info.isSymbolicLink(),'The existing Practice root must be a directory.');
  await privateDirectory(root);
  await readFile(join(workspace,'service.json')); // Do not initialize an empty replacement workspace.
  const original=await originalFiles(root);
  const native=JSON.parse(original.bytes['result.json'].toString('utf8'));
  const scenario=JSON.parse(original.bytes['practice-files/browser-scenario.json'].toString('utf8'));
  const adoption=native.phases?.find(phase=>phase.name==='Original comparison and reviewed adoption');
  expect(native.mode==='Practice'&&adoption&&adoption.initial==='FAIL'&&adoption.corrected==='PASS'&&adoption.baselines===5000,
    'This continuation needs the retained native Practice comparison and 5,000-baseline adoption.');
  expect(scenario.projectId==='practice-main'&&scenario.accountDatasetId&&scenario.billingId,
    'Retain the original project, account dataset and billing identities.');
  const jobIds=[adoption.originalJob,adoption.correctedJob];
  expect(jobIds.every(id=>typeof id==='string'&&id)&&jobIds[0]!==jobIds[1],
    'Retain both original comparison job identifiers.');
  const parent=join(root,'browser-continuations');
  await mkdir(parent,{recursive:true,mode:0o700});
  await privateDirectory(parent);
  const output=await mkdtemp(join(parent,'run-'));
  const receiptPath=join(output,'result.json');
  const result={schema:'asheville.practice-browser-continuation.v1',
    mode:readonly?'read-only existing Practice':'existing Practice operator continuation',
    started:new Date().toISOString(),status:'RUNNING',directory:root,output,
    originalFiles:original.identities,projectId:scenario.projectId,
    accountDatasetId:scenario.accountDatasetId,billingId:scenario.billingId,steps:[]};
  const save=()=>atomic(receiptPath,json(result)+'\n');
  let app;
  try {
    await save();
    // Only the two local fixture paths are relocated. Original inputs remain byte-identical.
    const relocated={...scenario,fixtures:join(root,'practice-files'),
      fieldPath:join(root,'practice-files','field-route.html')};
    const scenarioPath=join(output,'browser-scenario.json');
    await atomic(scenarioPath,json(relocated)+'\n');
    app=await startAsheville({directory:workspace,port:0});
    const store=app.engine.store;
    expect(store.project(scenario.projectId).mode==='Practice','Browser continuation requires the original Practice project.');
    store.verify();
    const dataset=store.dataset(scenario.projectId,scenario.accountDatasetId);
    expect(dataset.kind==='accounts'&&dataset.rows===5000,'Reopen the original 5,000-account dataset.');
    const bill=store.artifact(scenario.projectId,scenario.billingId);
    expect(bill.kind==='billing'&&bill.value.rows.length===5000&&bill.value.totals.total==='509750.00',
      'Reopen the original complete billing candidate.');
    const jobsBefore=await comparedJobs(app,jobIds);
    expect(jobsBefore[0].status==='FAIL'&&jobsBefore[1].status==='PASS'&&jobsBefore.every(job=>job.reviews>=1),
      'Reopen both original reviewed comparison outcomes.');
    const metadataBefore=retainedMetadata(store),baselineBefore=baseline(store,scenario.projectId);
    expect(baselineBefore.count===5000,'The original accepted baseline must contain 5,000 bills.');
    result.originalComparisons=jobsBefore;
    result.acceptedBaseline=baselineBefore;
    await save();
    const driver=fileURLToPath(new URL('browser_journey.py',import.meta.url));
    const args=[driver,app.url,scenarioPath,join(output,'operator')];
    if(readonly)args.push('read-only');
    result.browser=JSON.parse(await runProgram(python,args));
    expect(result.browser.status==='PASS','The actual operator browser must return PASS.');
    result.steps.push('existing workspace desktop/mobile and offline route browser');
    await save();
    store.verify();
    checkOriginalMetadata(metadataBefore,retainedMetadata(store));
    expect(json(baselineBefore)===json(baseline(store,scenario.projectId)),
      'The browser continuation changed the accepted billing baseline.');
    expect(json(jobsBefore)===json(await comparedJobs(app,jobIds)),
      'An original comparison or review changed.');
    await app.close(); app=null;
    result.steps.push('original source metadata, journal prefix, baseline and comparisons preserved');
    await save();
    if(!readonly) {
      app=await startAsheville({directory:workspace,port:0});
      result.reopenedBrowser=JSON.parse(await runProgram(python,
        [driver,app.url,scenarioPath,join(output,'reopened'),'read-only']));
      expect(result.reopenedBrowser.status==='PASS','The reopened browser must return PASS.');
      app.engine.store.verify();
      checkOriginalMetadata(metadataBefore,retainedMetadata(app.engine.store));
      expect(json(baselineBefore)===json(baseline(app.engine.store,scenario.projectId))&&
        json(jobsBefore)===json(await comparedJobs(app,jobIds)),
        'Reopening changed an original adopted bill or comparison.');
      result.steps.push('same workspace closed, reopened and rendered through read-only browser');
    }
    const retained=await originalFiles(root);
    expect(json(original.identities)===json(retained.identities),'An original Practice input or result file changed.');
    result.originalFilesPreserved=true;
    result.status='PASS';
  } catch(error) {
    result.status='FAILED';
    result.error={message:error.message,code:error.code??null};
    throw error;
  } finally {
    try { await app?.close(); }
    catch(error) { result.status='FAILED';result.closeError={message:error.message}; }
    result.finished=new Date().toISOString();
    await save();
    if(result.closeError)throw Error(result.closeError.message);
  }
  return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);
  if(!args[0]||args.slice(1).some(value=>value!=='--read-only')) {
    console.error('Usage: node continue-practice.mjs /existing/private/practice-operation [--read-only]');
    process.exitCode=2;
  } else {
    continuePractice({directory:args[0],readonly:args.includes('--read-only')})
      .then(result=>console.log(json({status:result.status,output:result.output,steps:result.steps})))
      .catch(error=>{console.error(error.message);process.exitCode=1;});
  }
}
