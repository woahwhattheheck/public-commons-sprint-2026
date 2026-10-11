// MIT. Continue the SAME retained Census merchant with its actual 2024 edition.
// Existing source upload/plan/publication/Buyer/session owners retain their native state.
import assert from 'node:assert/strict';
import { readFile,writeFile,mkdir,stat } from 'node:fs/promises';
import { createHash,randomUUID } from 'node:crypto';
import { join,resolve } from 'node:path';
import { pathToFileURL,fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const SOURCE_2023='c884b6c56f0951b8fbc28217b00577fbc22e2372dc375686d024e507c4e8d807';
const SOURCE_2024='14a61938cff58166ef265af9a324b8a6f4cf6040f8630634e5711cb5b07e2cf5';
const DEFAULT_SOURCE=fileURLToPath(new URL('../',import.meta.url));
const exists=async path=>{try{await stat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const serialized=value=>JSON.stringify(value,null,2)+'\n';
async function create(path,value){
  const raw=serialized(value);
  if(await exists(path)){assert.equal(await readFile(path,'utf8'),raw,'saved operation changed');return;}
  await writeFile(path,raw,{mode:0o600,flag:'wx'});
}
async function cli(path,args){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[path,...args],{shell:false,stdio:['ignore','pipe','pipe']});
    const out=[],err=[];child.stdout.on('data',x=>out.push(x));child.stderr.on('data',x=>err.push(x));
    child.once('error',reject);child.once('close',code=>{
      const raw=Buffer.concat(out).toString();
      if(code!==0){reject(Error('Original workbook CLI: '+Buffer.concat(err).toString()));return;}
      try{resolve(JSON.parse(raw));}catch(e){reject(e);}
    });
  });
}
export async function continueCensusWorkbook2024({sessionFile,operationDirectory,publisherDirectory=DEFAULT_SOURCE,
  targetFile,baseline:selection,keys:chosenKeys}){
  if(!sessionFile||!operationDirectory||!targetFile)throw Error('Pass the original private session file, a private operation directory and the captured official 2024 workbook file.');
  await mkdir(operationDirectory,{recursive:true,mode:0o700});
  const cliPath=join(publisherDirectory,'workbook/cli.mjs');
  const {callWorkbookWorkspace}=await import(pathToFileURL(cliPath));
  const call=(action,payload,extra={})=>callWorkbookWorkspace({sessionFile,action,payload,...extra});
  const workbook=await readFile(targetFile);
  assert.equal(createHash('sha256').update(workbook).digest('hex'),SOURCE_2024,'Use the exact captured official 2024 edition');
  const initial=await call('status'),sources=initial.workspace.workbookSources;
  const source=sources.find(x=>x.sha256===SOURCE_2023&&(!selection||x.id===selection.sourceId));
  assert(source,'The original merchant must retain the actual 2023 source first');
  const candidates=source.plans.filter(x=>x.plan.sheet==='Jam Values'&&x.plan.range==='A20:G36'&&x.plan.headerRow===20&&
    (!selection||x.id===selection.planId&&x.revision===selection.planRevision));
  assert.equal(candidates.length,1,'Pass the exact baseline source/plan/revision when multiple original mappings exist');
  const baseline=candidates[0];
  const target=(await call('upload',null,{file:targetFile})).source;
  let request;
  const requestFile=join(operationDirectory,'comparison-request.json');
  if(await exists(requestFile))request=JSON.parse(await readFile(requestFile,'utf8'));
  else{
    const suggested=await call('edition-suggest',{sourceId:source.id,planId:baseline.id,planRevision:baseline.revision,targetId:target.id,
      sheet:'Jam Values',range:'A20:G36',headerRow:20});
    await create(join(operationDirectory,'suggestion.json'),suggested);
    // Both original Census editions were inspected A20:G36. Duplicate lower/upper
    // headings are resolved explicitly by the original coordinate mappings.
    const plan={...suggested.plan,name:baseline.plan.name.replace(/2023/g,'2024').slice(0,150)+' 2024',
      notes:'Original Census 2023 to 2024 Jam Values; exact retained A20:G36 annual source update.',
      columns:structuredClone(baseline.plan.columns)};
    const key=baseline.plan.columns.find(x=>x.source==='A');
    const keys=chosenKeys??(key?[key.name]:null);
    assert(keys?.length,'Pass explicit public row keys from the original projection');
    request={id:randomUUID(),sourceId:source.id,planId:baseline.id,planRevision:baseline.revision,targetId:target.id,
      expectedTargetRevision:suggested.expectedTargetRevision,plan,keys,
      expectedSnapshot:suggested.nativeSchema.snapshot,expectedRevision:suggested.nativeSchema.revision};
    await create(requestFile,request);
  }
  const result=await call('edition-compare',request),comparison=result.comparison;
  assert.equal(comparison.rows,16);assert.equal(comparison.baselineProjection.rowCount,16);
  assert.equal(comparison.targetProjection.rowCount,16);assert.equal(comparison.counts.changed,1);
  const change=result.page.rows.find(x=>x.kind==='changed');
  assert(change?.after.row===36&&change.before.row===36);
  const field=baseline.plan.columns.find(x=>x.source==='G')?.name;
  if(field){assert.equal(change.before.values[field],'2022');assert.equal(change.after.values[field],'2024');}
  assert.equal((await call('edition-compare',request)).reused,true);
  const page=await cli(cliPath,['edition-read','--session-file',sessionFile,'--id',comparison.id,
    '--kind','unchanged','--offset','2','--limit','3']);
  assert.equal(page.page.offset,2);assert.equal(page.page.rows.length,3);
  assert(page.page.rows.every(x=>x.kind==='unchanged'));
  await create(join(operationDirectory,'cli-unchanged-page.json'),page);
  const apply={id:comparison.id,sha256:comparison.sha256,expectedTargetRevision:comparison.expectedTargetRevision,
    expectedSnapshot:comparison.nativeSchema.snapshot,expectedRevision:comparison.nativeSchema.revision};
  const adopted=await call('edition-apply',apply),replayed=await call('edition-apply',apply);
  assert.equal(replayed.reused,true);assert.equal(replayed.plan.id,adopted.plan.id);
  const prepared=await call('prepare',{id:target.id,planId:adopted.plan.id,expectedPlanRevision:adopted.plan.revision});
  assert.equal(prepared.candidate.csvHash,comparison.targetProjection.csvSha256);
  const candidate=prepared.candidate;
  const review=await call('review',{id:candidate.id});
  await create(join(operationDirectory,'original-candidate-review.json'),review);
  const observed=await call('status');
  const published=observed.status.current===candidate.dataset.snapshot?observed:await call('publish',{
    id:candidate.id,expectedSnapshot:candidate.expectedSnapshot,expectedRevision:candidate.expectedRevision});
  assert.equal(published.status.current,candidate.dataset.snapshot);
  // The original saved adoption remains the same operation after publication.
  const recovered=await call('edition-apply',apply);
  assert.equal(recovered.reused,true);assert.equal(recovered.plan.id,adopted.plan.id);
  const output=join(operationDirectory,'comparison.json');
  if(!await exists(output))await create(join(operationDirectory,'export.json'),await cli(cliPath,[
    'edition-export','--session-file',sessionFile,'--id',comparison.id,'--out',output]));
  const full=JSON.parse(await readFile(output,'utf8'));assert.equal(full.rows.length,16);
  const retained=await call('edition-read',{id:comparison.id,offset:0,limit:50,kind:'all'});
  assert.equal(retained.comparison.sha256,comparison.sha256);
  const report={schema:'stellar-forge.census-workbook-edition-operation.v1',completedAt:new Date().toISOString(),
    source2023:{id:source.id,sha256:SOURCE_2023},source2024:{id:target.id,sha256:SOURCE_2024},
    comparisonId:comparison.id,comparisonSha256:comparison.sha256,counts:comparison.counts,
    sourceRows:comparison.rows,planId:adopted.plan.id,planRevision:adopted.plan.revision,candidateId:candidate.id,
    snapshot:published.status.current,publicationRevision:published.status.revision,comparisonFile:output,
    reviewFile:join(operationDirectory,'original-candidate-review.json'),sessionFile};
  await writeFile(join(operationDirectory,'result.json'),serialized(report),{mode:0o600});
  return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const values={};
  for(let i=2;i<process.argv.length;i+=2)values[process.argv[i]]=process.argv[i+1];
  continueCensusWorkbook2024({sessionFile:values['--session-file'],operationDirectory:values['--operation-dir'],
    publisherDirectory:values['--publisher'],targetFile:values['--target-file'],
    baseline:values['--baseline-source']?{sourceId:values['--baseline-source'],planId:values['--baseline-plan'],
      planRevision:Number(values['--baseline-revision'])}:undefined})
    .then(result=>console.log(serialized(result))).catch(error=>{console.error(error.stack);process.exitCode=1;});
}
