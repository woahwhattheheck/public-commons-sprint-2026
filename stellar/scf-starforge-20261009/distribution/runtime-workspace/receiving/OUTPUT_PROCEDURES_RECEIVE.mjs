// MIT. Additive full operator course for an existing equipped Runtime receiving session.
import assert from 'node:assert/strict';
import { mkdir, open, readFile, link, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { privateDirectory, operationLease } from '../storage.mjs';
import { receiveCompleteOutputSearch } from './OUTPUT_SEARCH_RECEIVE.mjs';
import { inspectProcedureOutputs, verifyProcedureOutputs } from '../output-procedure.mjs';
import { runRuntimeProcedureCommand } from '../operating-procedures-cli.mjs';
import { openRuntimeWorkspace } from '../model.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
export const OPERATION='RUNTIME-OUTPUT-PROCEDURE-HANDOFF-C57E-20261013';
async function optional(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function publish(path,content){
  const raw=Buffer.from(content),temporary=path+'.partial-'+randomUUID();let file;
  try{
    file=await open(temporary,'wx',0o600);await file.writeFile(raw);await file.sync();await file.close();file=null;
    try{await link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;assert.equal(digest(await readFile(path)),digest(raw),'Preserve the different original course file: '+path);}
    const parent=await open(resolve(path,'..'),'r');try{await parent.sync();}finally{await parent.close();}
  }finally{await file?.close();await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function retain(path,prepare){const prior=await optional(path);if(prior)return prior;const next=await prepare();await publish(path,json(next));return next;}
/**
 * The caller supplies its already-open native pages/models and actual original
 * selectors. No worker is started/stopped and no browser origin is substituted.
 * openProcedure(page,id) navigates the original installed procedure controls.
 */
export async function receiveOutputProcedure({
  page,model,receiverPage,receiverModel,outputDirectory,source,query,kind='runtime',
  openOutput,openProcedure,
}){
  assert(page&&model&&receiverPage&&receiverModel&&typeof openOutput==='function'&&typeof openProcedure==='function');
  assert.notEqual(model.directory,receiverModel.directory,'Use an independent original receiving workspace.');
  const parent=resolve(outputDirectory);await privateDirectory(parent);
  const root=join(parent,'output-procedure');try{await mkdir(root,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}await privateDirectory(root);
  const lease=await operationLease(join(root,'course.guard')),attempt=randomUUID(),attemptRoot=join(root,'attempt-'+attempt);
  let routeHandler;const sourceFiles=[];
  try{
  await mkdir(attemptRoot,{mode:0o700});
  const originalState=await model.state(),receiverState=await receiverModel.state();
  const immutable={operation:OPERATION,originalWorkspace:originalState.workspaceId,receiverWorkspace:receiverState.workspaceId,
    originalDirectory:model.directory,receiverDirectory:receiverModel.directory,source,query,kind};
  const saved=await retain(join(root,'case.json'),async()=>({...immutable,id:randomUUID(),createdAt:new Date().toISOString()}));
  for(const key of Object.keys(immutable))assert.deepEqual(saved[key],immutable[key],'Continue the original case selection.');
    for(const path of ['output-procedure.mjs','output-review-core.mjs','output-search-core.mjs','operating-procedures.mjs','operating-procedures-cli.mjs',
      'public/output-review.mjs','public/output-search.mjs','public/application-output.mjs','public/runtime-output.mjs','public/operating-procedures.mjs','public/app.mjs','server.mjs']){
      const raw=await readFile(new URL('../'+path,import.meta.url));sourceFiles.push({path,bytes:raw.length,sha256:digest(raw)});
    }
    await publish(join(attemptRoot,'intent.json'),json({operation:OPERATION,attempt,case:saved,sourceFiles,startedAt:new Date().toISOString()}));
    const stage=(name,run)=>retain(join(root,name+'.json'),run);
    const request=(name,prepare)=>retain(join(root,name+'-request.json'),prepare);
    const search=await stage('01-original-search',()=>receiveCompleteOutputSearch({page,model,outputDirectory:root,source,query,kind,openOutput}));
    const choice={kind,input:source,selection:search.firstPage.selection,query,contextBytes:96};
    const selected=await stage('02-full-selected-source',async()=>{
      const method=kind==='application'?'applicationsOutputDownload':'runtimeOutputDownload';
      const download=await model[method]({...source,selection:choice.selection});const chunks=[];
      try{for await(const chunk of download.stream)chunks.push(Buffer.from(chunk));}finally{download.stream.destroy();await download.close();}
      const raw=Buffer.concat(chunks);assert.equal(raw.length,download.bytes);
      await publish(join(root,'original-selected.log'),raw);
      return{sourceId:download.sourceId,selection:download.selection,bytes:raw.length,sha256:digest(raw)};
    });
    const expectedRaw=await readFile(join(root,'original-selected.log'));
    assert.equal(expectedRaw.length,selected.bytes);assert.equal(digest(expectedRaw),selected.sha256);
    const createPath=join(root,'03-browser-create-request.json');
    const title='Complete output review '+saved.id;
    const created=await stage('03-browser-create',async()=>{
      const prior=await optional(createPath);
      if(prior)return model.runtimeProcedureCreate(prior);
      await openOutput(page,source);
      const searchDesk=page.locator('.output-search-desk:visible');
      await searchDesk.locator('[data-output-search="procedure"]').click();
      await page.locator('#rp-output-choice').getByText('Output selected for the next capture',{exact:true}).waitFor();
      await page.locator('#rp-create [name="title"]').fill(title);
      await page.locator('#rp-create [name="customer"]').fill('Original Runtime receiving course');
      await page.locator('#rp-create [name="owner"]').fill('Original receiving operator');
      await page.locator('#rp-create [name="purpose"]').fill('Retain complete selected output, every query match and independent received work.');
      routeHandler=async route=>{
        const value=route.request().postDataJSON();
        if(value.title!==title)return route.continue();
        assert.deepEqual(value.selection.output,choice,'The browser must retain the original exact fixed-end search.');
        await publish(createPath,json(value));await route.continue();
      };
      await page.route('**/api/runtime-procedures/create',routeHandler);
      try{
        const response=page.waitForResponse(r=>r.url().endsWith('/api/runtime-procedures/create')&&r.request().postDataJSON()?.title===title);
        await page.locator('#rp-create button[type="submit"]').click();
        const received=await response,result=await received.json();assert(received.ok(),JSON.stringify(result));
        assert.equal(result.record.id,(await optional(createPath)).requestId);return result;
      }finally{await page.unroute('**/api/runtime-procedures/create',routeHandler);routeHandler=null;}
    });
    const procedureId=created.record.id;
    const originalOutputs=await verifyProcedureOutputs(created.record.plan);
    assert.equal(originalOutputs.length,1);
    const originalOutput=originalOutputs[0];
    assert.deepEqual(originalOutput.output.selection,choice);
    assert.equal(originalOutput.output.sha256,selected.sha256);
    assert(Buffer.from(originalOutput.bytes).equals(expectedRaw));
    await stage('04-browser-evidence',async()=>{
      await openProcedure(page,procedureId);
      const disclosure=page.locator('#rp-captures > details').filter({hasText:'Read complete retained output'}).first();
      await disclosure.locator('summary').first().click();
      const desk=page.locator('.procedure-output-review:visible');await desk.waitFor();
      assert((await desk.textContent()).includes(JSON.stringify(query)));
      const downloads=[];
      for(const [label,name] of [['Download complete original output','browser-original.log'],['Download complete match index','browser-matches.jsonl']]){
        const pending=page.waitForEvent('download');await desk.getByRole('button',{name:label,exact:true}).click();
        const download=await pending,path=join(attemptRoot,name);await download.saveAs(path);
        const raw=await readFile(path);downloads.push({path,bytes:raw.length,sha256:digest(raw)});
        if(name.endsWith('.log'))assert(raw.equals(expectedRaw));
        else{const rows=raw.toString('utf8').trim().split('\n').map(JSON.parse);assert.equal(rows.at(-1).matches,originalOutput.output.review.matches.length);assert.equal(rows.at(-1).complete,true);}
      }
      if(originalOutput.output.review.matches.length)await desk.getByRole('button',{name:/^Open original bytes /}).first().click();
      const screenshots=[];
      for(const width of [1360,390]){await page.setViewportSize({width,height:960});const path=join(attemptRoot,'original-'+width+'.png');await page.screenshot({path,fullPage:true});screenshots.push(path);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
      return{downloads,screenshots};
    });
    const incoming=await stage('05-independent-receive',async()=>receiverModel.runtimeProcedureReceive(await request('05-independent-receive',async()=>({
      requestId:randomUUID(),document:created.record,
    }))));
    assert.equal(incoming.record.workspaceId,originalState.workspaceId);
    await stage('06-independent-browser',async()=>{
      await openProcedure(receiverPage,procedureId);
      const disclosure=receiverPage.locator('#rp-captures > details').filter({hasText:'Read complete retained output'}).first();
      await disclosure.locator('summary').first().click();
      const desk=receiverPage.locator('.procedure-output-review:visible');await desk.waitFor();
      const pending=receiverPage.waitForEvent('download');await desk.getByRole('button',{name:'Download complete original output',exact:true}).click();
      const download=await pending,path=join(attemptRoot,'independently-received.log');await download.saveAs(path);
      assert((await readFile(path)).equals(expectedRaw));
      await receiverPage.reload();await openProcedure(receiverPage,procedureId);
      const screenshots=[];
      for(const width of [1360,390]){await receiverPage.setViewportSize({width,height:960});const p=join(attemptRoot,'receiver-'+width+'.png');await receiverPage.screenshot({path:p,fullPage:true});screenshots.push(p);}
      return{path,sha256:selected.sha256,screenshots};
    });
    const observed=await stage('07-receiving-observation',async()=>receiverModel.runtimeProcedureRecord(await request('07-receiving-observation',async()=>({
      requestId:randomUUID(),procedureId,expectedSha256:(await receiverModel.runtimeProcedureRead({procedureId})).recordSha256,
      stepId:'review-receiving',status:'completed',owner:'Independent receiving operator',
      recordedResult:'Opened the full carried output and complete match index without the original worker; raw download matched its retained SHA-256.',selection:{},
    }))));
    let returned=await stage('08-returned-work',async()=>model.runtimeProcedureReturn(await request('08-returned-work',async()=>({
      requestId:randomUUID(),procedureId,expectedSha256:(await model.runtimeProcedureRead({procedureId})).recordSha256,
      incoming:observed.record.plan,reviewer:'Original receiving operator',notes:'Receive the complete independent observation and its original source history.',
    }))));
    const reviewId=(await optional(join(root,'08-returned-work-request.json'))).requestId;
    const comparison=returned.returnComparisons.find(r=>r.reviewId===reviewId).comparison;
    for(let i=0;i<comparison.rows.length;i++){
      const row=comparison.rows[i],name='09-decision-'+i;
      returned=await stage(name,async()=>model.runtimeProcedureDecide(await request(name,async()=>({
        requestId:randomUUID(),procedureId,expectedSha256:(await model.runtimeProcedureRead({procedureId})).recordSha256,
        reviewId,key:row.key,decision:{take:'incoming',note:'Receive this complete original returned value.'},
      }))));
    }
    const applied=await stage('10-apply-return',async()=>model.runtimeProcedureApply(await request('10-apply-return',async()=>({
      requestId:randomUUID(),procedureId,expectedSha256:(await model.runtimeProcedureRead({procedureId})).recordSha256,reviewId,
    }))));
    const repeated=await model.runtimeProcedureApply(await optional(join(root,'10-apply-return-request.json')));assert(repeated.reused);
    const exportResult=await stage('11-cli-exports',async()=>{
      const result={};
      for(const format of ['json','html','output-json','output-html','output-index']){
        const value=await runRuntimeProcedureCommand(model,'procedure-export',{'--procedure-id':procedureId,'--format':format,
          ...(format.startsWith('output-')?{'--capture-id':originalOutput.captureId}:{})});
        const path=join(root,'handover-'+format+(format.endsWith('html')?'.html':format==='output-index'?'.jsonl':'.json'));
        await publish(path,value.content);result[format]={path,bytes:value.bytes,sha256:value.sha256};
      }
      return result;
    });
    const cold=await openRuntimeWorkspace({directory:receiverModel.directory});
    try{
      const reopened=await cold.runtimeProcedureRead({procedureId});
      const outputs=await verifyProcedureOutputs(reopened.record.plan);
      assert(Buffer.from(outputs[0].bytes).equals(expectedRaw));
      assert.deepEqual(outputs[0].output,originalOutput.output);
      const observedRequest=await optional(join(root,'07-receiving-observation-request.json'));
      assert(reopened.record.requests.some(r=>r.requestId===observedRequest.requestId));
    }finally{await cold.close();}
    const current=await model.runtimeProcedureRead({procedureId});assert.deepEqual(current.record,applied.record);
    for(const item of Object.values(exportResult)){const raw=await readFile(item.path);assert.equal(raw.length,item.bytes);assert.equal(digest(raw),item.sha256);}
    const output=inspectProcedureOutputs(current.record.plan)[0];assert(Buffer.from(output.bytes).equals(expectedRaw));
    const result={operation:OPERATION,attempt,phase:'COMPLETE',procedureId,originalWorkspace:originalState.workspaceId,
      receiverWorkspace:receiverState.workspaceId,output:output.output,sourceFiles,exports:exportResult,completedAt:new Date().toISOString(),
      renderedInspection:'Inspect retained actual desktop/narrow screenshots and open the complete outgoing HTML in the equipped session before accepting rendered delivery.'};
    await publish(join(attemptRoot,'result.json'),json(result));return result;
  }catch(error){await publish(join(attemptRoot,'failure.json'),json({operation:OPERATION,attempt,error:{name:error.name,code:error.code,message:error.message,stack:error.stack},sourceFiles})).catch(()=>{});throw error;}
  finally{if(routeHandler)await page.unroute('**/api/runtime-procedures/create',routeHandler).catch(()=>{});await lease.close();}
}
