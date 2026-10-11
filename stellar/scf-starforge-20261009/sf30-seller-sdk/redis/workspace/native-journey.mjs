// MIT. The original native Redis merchant journey calls this optional authoring continuation.
import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRedisAuthoringWorkspace, openRedisAuthoringWorkspace } from './model.mjs';
import { startRedisAuthoringServer } from './server.mjs';
import { inspectRelease, activateRelease, runActiveRelease, releaseStatus } from '../../../sf82-seller-pilot/releases.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
export async function runRedisWorkspaceJourney({sourceFile,planFile,root,runtime}){
  let workspace=await createRedisAuthoringWorkspace({directory:root,sourceFile,planFile,label:'Native Redis merchant'});
  let server,browser,managed;
  const stages=[],downloads=[];
  try{
    const initial=workspace.state(),initialRevision=initial.workspace.head,workspaceId=initial.workspace.id;
    server=await startRedisAuthoringServer({workspace,port:0});
    const call=async(path,input)=>{
      const response=await fetch(server.url+path,{method:input===undefined?'GET':'POST',
        headers:{'x-workspace-token':server.token,...(input===undefined?{}:{origin:server.url,'content-type':'application/json'})},
        ...(input===undefined?{}:{body:JSON.stringify(input)})});
      const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;
    };
    assert.equal((await fetch(server.url+'/api/state')).status,403);
    for(const [name,input]of [['availability',{}],['catalog',{region:'north'}],['leaderboard',{offset:'0'}],['events',{after:'-'}]]){
      const operation=await call('/api/preview',{requestId:'initial-'+name,revisionId:initialRevision,query:name,input});
      assert.equal(operation.status,'COMPLETED');
      if(name==='catalog')assert.equal(operation.result.data.rows[0].priceAtomic,'9007199254740993');
      if(name==='availability')assert.equal(operation.result.data.rows[0].availability.base64,Buffer.from([255,0,239,187,191]).toString('base64'));
      stages.push({kind:'preview',query:name,rows:operation.result.data.rowCount});
    }
    if(process.env.SF30_REDIS_WORKSPACE_BROWSER==='1'){
      const {chromium}=await import(process.env.SF30_PLAYWRIGHT_MODULE??'playwright');
      browser=await chromium.launch({headless:true,args:['--no-sandbox'],
        ...(process.env.SF30_CHROMIUM_EXECUTABLE?{executablePath:process.env.SF30_CHROMIUM_EXECUTABLE}:{})});
      const page=await browser.newPage({viewport:{width:1440,height:1000}}),issues=[];
      page.on('pageerror',error=>issues.push(error.message));
      await page.goto(server.operatorUrl);await page.locator('#status').filter({hasText:'Workspace ready.'}).waitFor();
      await page.locator('#query-list button').filter({hasText:'leaderboard'}).click();
      await page.locator('#query-rows').fill('1');await page.locator('#query-form button[type=submit]').click();
      await page.locator('#revision-note').fill('One ranking row per request');
      await page.locator('#save').click();await page.locator('#status').filter({hasText:'Revision saved.'}).waitFor();
      await page.locator('[data-tab=terms]').click();await page.locator('#payment-amount').fill('20000');
      await page.locator('#revision-note').fill('Reviewed merchant price');
      await page.locator('#review').click();await page.locator('#detail-dialog').waitFor();await page.locator('#close-detail').click();
      await page.locator('#save').click();await page.locator('#status').filter({hasText:'Revision saved.'}).waitFor();
      await page.locator('[data-tab=preview]').click();
      await page.locator('#preview-version').selectOption(workspace.metadata().head);
      await page.locator('#preview-query').selectOption('leaderboard');await page.locator('#preview-input').fill('{"offset":"0"}');
      await page.locator('#run-preview').click();await page.locator('#status').filter({hasText:'Live source preview completed.'}).waitFor();
      assert.match(await page.locator('#preview-table').innerText(),/first/);
      await page.locator('#next-preview').click();await page.locator('#status').filter({hasText:'Live source preview completed.'}).waitFor();
      assert.match(await page.locator('#preview-table').innerText(),/second/);
      await page.locator('[data-tab=packages]').click();await page.locator('#prepare').click();
      await page.locator('#status').filter({hasText:'Merchant package and customer files are ready.'}).waitFor();
      const downloadEvent=page.waitForEvent('download');
      await page.locator('#package-list button').filter({hasText:/^openapi\.json$/}).first().click();
      const download=await downloadEvent,destination=join(root,'browser-customer-openapi.json');await download.saveAs(destination);
      const bytes=await readFile(destination);assert.ok(JSON.parse(bytes).paths[initial.current.plan.routes[0].path]);downloads.push({name:download.suggestedFilename(),bytes:bytes.length,sha256:hash(bytes)});
      await page.locator('#stage-id').fill('browser-v2');await page.locator('#stage-label').fill('Browser merchant version 2');
      await page.locator('#stage-port').fill('0');await page.locator('#stage-facilitator').fill(runtime.facilitator);await page.locator('#stage-local').check();
      await page.locator('#stage').click();await page.locator('#status').filter({hasText:'Release browser-v2 is staged.'}).waitFor();
      await page.locator('#open-releases').click();await page.locator('#status a').waitFor();
      await page.locator('[data-tab=versions]').click();assert.ok(await page.locator('#version-list tbody tr').count()>=3);
      await page.locator('[data-tab=activity]').click();assert.ok(await page.locator('#activity-list tbody tr').count()>=8);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      if(process.env.SF30_REDIS_WORKSPACE_SCREENSHOT)await page.screenshot({path:process.env.SF30_REDIS_WORKSPACE_SCREENSHOT,fullPage:true});
      assert.deepEqual(issues,[]);await browser.close();browser=null;
      stages.push({kind:'browser',viewport:{width:1440,height:1000},flow:'product,price,preview,continuation,customer-download,stage,release-controls,versions,activity'});
    }else{
      const queries=structuredClone(initial.current.source.queries),plan=structuredClone(initial.current.plan);
      queries.leaderboard.maxRows=1;plan.payment.amount='20000';
      const saved=await call('/api/save',{requestId:'updated-product-price',expectedHead:initialRevision,queries,plan,note:'Reviewed page size and merchant price'});
      assert.equal(saved.status,'COMPLETED');
    }
    let current=workspace.state(),changedRevision=current.workspace.head;
    assert.equal(current.current.source.queries.leaderboard.maxRows,1);assert.equal(current.current.plan.payment.amount,'20000');
    const previewInput={requestId:'changed-ranking',revisionId:changedRevision,query:'leaderboard',input:{offset:'0'}};
    const preview=await call('/api/preview',previewInput);assert.equal(preview.status,'COMPLETED');assert.equal(preview.result.data.rowCount,1);
    const repeated=await call('/api/preview',previewInput);assert.deepEqual(repeated,preview);
    const continued=await call('/api/preview',{...previewInput,requestId:'changed-ranking-next',input:preview.result.data.nextInput});
    assert.equal(continued.result.data.rows[0].itemId,'second');
    const prepared=await call('/api/prepare',{requestId:'terminal-package-v2',revisionId:changedRevision});
    assert.equal(prepared.status,'COMPLETED');
    const names=Object.keys(prepared.result.files).filter(name=>name==='openapi.json'||name.startsWith('client/'));
    for(const name of names){const file=await workspace.file(prepared.id,name);assert.equal(hash(file.bytes),prepared.result.files[name].sha256);}
    const staged=await call('/api/stage',{requestId:'terminal-stage-v2',packageId:prepared.id,releaseId:'terminal-v2',label:'Terminal version 2',runtime});
    assert.equal(staged.status,'COMPLETED');
    const restored=await call('/api/restore',{requestId:'restore-initial',expectedHead:changedRevision,revisionId:initialRevision,note:'Restore initial configuration'});
    assert.equal(restored.status,'COMPLETED');assert.equal(workspace.state().current.plan.payment.amount,'10000');
    const firstPage=await call('/api/operations?limit=2');assert.equal(firstPage.items.length,2);assert.ok(firstPage.nextCursor);
    const secondPage=await call('/api/operations?limit=2&after='+firstPage.nextCursor);assert.notEqual(secondPage.items[0].id,firstPage.items[0].id);
    await server.close();server=null;
    workspace=await openRedisAuthoringWorkspace(root);
    assert.equal(workspace.metadata().id,workspaceId);assert.equal(workspace.operation(prepared.id).status,'COMPLETED');
    assert.equal(workspace.state().current.plan.payment.amount,'10000');
    const reopened=await workspace.preview({requestId:'reopened-catalog',revisionId:workspace.metadata().head,query:'catalog',input:{region:'north'}});
    assert.equal(reopened.result.data.rows[0].priceAtomic,'9007199254740993');
    // The original retained release runs after both revision materializations and private prepared files are removed.
    await rm(join(root,'materialized'),{recursive:true});await rm(join(root,'packages'),{recursive:true});
    const releaseRoot=join(root,'releases'),release=await inspectRelease(releaseRoot,'terminal-v2');
    assert.equal(release.redis.queries.leaderboard.maxRows,1);assert.equal(release.routes[0].payment[0].amount,'20000');
    await activateRelease(releaseRoot,'terminal-v2',{expectedGeneration:0,reason:'Run the workspace retained package'});
    managed=await runActiveRelease(releaseRoot,{expectedGeneration:1});
    const running=await releaseStatus(releaseRoot),listener=running.runtime.observed.listener;
    const rankingPath=initial.current.plan.routes.find(route=>route.query==='leaderboard').path;
    const challenge=await fetch(listener+rankingPath+'?offset=0');assert.equal(challenge.status,402);
    await managed.close();managed=null;
    stages.push({kind:'retained-release',releaseId:release.id,digest:release.digest,challengeStatus:challenge.status});
    return {result:'PASS',workspaceId,initialRevision,changedRevision,retainedRevision:workspace.metadata().head,
      publicFiles:names.length,stages,downloads};
  }finally{await browser?.close();await managed?.close();if(server)await server.close();else await workspace?.close();}
}
