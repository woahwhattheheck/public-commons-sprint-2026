// MIT. Complete setup-to-saved-workspace receiving on the original native Redis fixture.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createRedisConnectionSetup, normalizeRedisSetup } from './setup-model.mjs';
import { startRedisConnectionSetupServer } from './setup-server.mjs';
import { openRedisAuthoringWorkspace, redisWorkspaceBinding } from './model.mjs';
import { startRedisAuthoringServer } from './server.mjs';
import { REDIS_CERTIFICATE_FILES } from '../connection-profile.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
export async function runRedisSetupJourney({sourceFile,planFile,root,runtime,applicationsConfiguration}={}) {
  await mkdir(root,{mode:0o700});
  const source=JSON.parse(await readFile(sourceFile,'utf8')),plan=JSON.parse(await readFile(planFile,'utf8'));
  const initial={label:'Redis setup receiving',source,plan,certificates:{}},environment={...process.env};
  for(const item of REDIS_CERTIFICATE_FILES)if(source.connection[item.profile])
    initial.certificates[item.profile]=await readFile(resolve(dirname(sourceFile),source.connection[item.profile]),'utf8');
  const stages=[],downloads=[],browserErrors=[];
  let server,browser,workspace,reopenedServer,page,managedSetup;
  try{
    // All deployment forms use the original source and merchant compilers. Only the
    // selected fixture is read; other profiles exercise offline creation and CA custody.
    const variants=[
      {topology:'standalone',host:'127.0.0.1',port:6379,tls:'local-plaintext',passwordEnv:'SETUP_DATA_PASSWORD'},
      {topology:'cluster',rootNodes:[{host:'cluster.example',port:6379}],tls:'verify-full',passwordEnv:'SETUP_DATA_PASSWORD'},
      {topology:'sentinel',name:'merchant',sentinelRootNodes:[{host:'sentinel.example',port:26379}],
        tls:'verify-full',passwordEnv:'SETUP_DATA_PASSWORD',sentinelTls:'verify-full',sentinelPasswordEnv:'SETUP_MONITOR_PASSWORD'},
      {transport:'upstash-rest',endpoint:'https://setup-receiving.upstash.io',tokenEnv:'SETUP_UPSTASH_TOKEN'}
    ];
    for(const connection of variants){
      const draft={...structuredClone(initial),source:{...structuredClone(source),connection},certificates:{}};
      const review=normalizeRedisSetup(draft,{}).review;
      assert.ok(review.environment.length);assert.ok(review.environment.every(value=>!value.available));
      const setup=await createRedisConnectionSetup({directory:join(root,'offline-'+(connection.transport??connection.topology)),initial:draft,environment:{}});
      try{
        const checked=setup.review(draft);
        const created=await setup.create({draft,digest:checked.digest,requestId:'offline-create'});
        const repeated=await setup.create({draft,digest:checked.digest,requestId:'offline-create'});
        assert.equal(repeated.workspaceId,created.workspaceId);assert.equal(repeated.recovered,true);
        assert.deepEqual(created.environmentNames,checked.environment.map(value=>value.name).sort());
        const binding=redisWorkspaceBinding(setup.workspace.metadata());assert.equal(binding.profileSha256,created.profileSha256);
        stages.push({kind:'offline-create',deployment:connection.transport??connection.topology,workspaceId:created.workspaceId,environment:checked.environment});
      }finally{await setup.close();}
    }
    if(applicationsConfiguration) managedSetup=await (await import('./managed-journey.mjs')).startRedisManagedSetupJourney({
      configurationFile:applicationsConfiguration,redisDirectory:join(root,'workspace'),initial});
    const setupOperationId=managedSetup?.operationId??'original-native-setup';
    const setupInputSha256=managedSetup?.inputSha256;
    server=managedSetup??await startRedisConnectionSetupServer({
      directory:join(root,'workspace'),initial,environment,port:0,operationId:setupOperationId});
    const playwright=await import(process.env.SF30_PLAYWRIGHT_MODULE??'playwright');
    const chromium=playwright.chromium??playwright.default?.chromium;
    assert.equal(typeof chromium?.launch,'function');
    browser=await chromium.launch({headless:true,args:['--no-sandbox'],
      ...(process.env.SF30_CHROMIUM_EXECUTABLE?{executablePath:process.env.SF30_CHROMIUM_EXECUTABLE}:{})});
    page=await browser.newPage({viewport:{width:1366,height:1000}});
    page.on('pageerror',error=>browserErrors.push(error.message));
    const call=async(path,input)=>{
      const response=await fetch(server.url+'/api/'+path,{method:input===undefined?'GET':'POST',
        headers:{'x-workspace-token':server.token,...(input===undefined?{}:{origin:server.url,'content-type':'application/json'})},
        ...(input===undefined?{}:{body:JSON.stringify(input)})});
      return {status:response.status,value:await response.json()};
    };
    assert.equal((await fetch(server.url+'/api/state')).status,403);
    await page.goto(server.operatorUrl);
    await page.locator('#setup').waitFor({state:'visible'});
    // Import the complete current source packet, including independent CA bundles.
    await page.locator('#import-draft').setInputFiles({name:'receiving-setup.json',mimeType:'application/json',buffer:Buffer.from(json(initial))});
    await page.locator('#status').filter({hasText:'Setup imported.'}).waitFor();
    await page.locator('#workspace-label').fill('Merchant connected through setup');
    await page.reload();await page.locator('#setup').waitFor({state:'visible'});
    assert.equal(await page.locator('#workspace-label').inputValue(),'Merchant connected through setup');
    await page.locator('[data-tab=terms]').click();await page.locator('#review-terms').click();
    await page.locator('#status').filter({hasText:'Review complete.'}).waitFor();
    const reviewed=JSON.parse(await page.locator('#review-json').innerText());
    assert.equal(reviewed.review.label,'Merchant connected through setup');
    for(const name of Object.keys(initial.certificates))assert.equal(reviewed.review.certificates[name],hash(initial.certificates[name]));
    await page.locator('#preview-query').selectOption('catalog');
    await page.locator('#preview-input').fill('{"region":"north"}');
    await page.locator('#preview').click();await page.locator('#status').filter({hasText:'Source preview completed.'}).waitFor();
    const catalog=JSON.parse(await page.locator('#preview-json').innerText());
    assert.equal(catalog.data.rows[0].priceAtomic,'9007199254740993');
    const previewDownload=page.waitForEvent('download');await page.locator('#download-preview').click();
    const previewFile=await previewDownload,previewPath=join(root,'setup-preview.json');
    await previewFile.saveAs(previewPath);const previewBytes=await readFile(previewPath);
    assert.deepEqual(JSON.parse(previewBytes),catalog);
    downloads.push({name:'setup-preview.json',bytes:previewBytes.length,sha256:hash(previewBytes)});
    await page.locator('#preview-query').selectOption('leaderboard');await page.locator('#preview').click();
    await page.locator('#status').filter({hasText:'Source preview completed.'}).waitFor();
    const first=JSON.parse(await page.locator('#preview-json').innerText());
    assert.ok(first.data.nextInput);
    await page.locator('#next-preview').click();await page.locator('#status').filter({hasText:'Source preview completed.'}).waitFor();
    const next=JSON.parse(await page.locator('#preview-json').innerText());assert.deepEqual(next.input,first.data.nextInput);
    const setupDownload=page.waitForEvent('download');await page.locator('#export-draft').click();
    const setupFile=await setupDownload,setupPath=join(root,'complete-setup.json');
    await setupFile.saveAs(setupPath);const setupBytes=await readFile(setupPath),captured=JSON.parse(setupBytes);
    downloads.push({name:'complete-setup.json',bytes:setupBytes.length,sha256:hash(setupBytes)});
    assert.equal(normalizeRedisSetup(captured,environment).digest,reviewed.review.digest);
    const stale=structuredClone(captured);stale.label='Changed after review';
    const refused=await call('create',{draft:stale,digest:reviewed.review.digest,requestId:'stale-create'});
    assert.equal(refused.status,409);assert.equal(refused.value.error,'REDIS_SETUP_REVIEW_REQUIRED');
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const screenshot=process.env.SF30_REDIS_SETUP_SCREENSHOT??join(root,'setup-review.png');
    await page.screenshot({path:screenshot,fullPage:true});
    await page.setViewportSize({width:1366,height:1000});
    await page.locator('#create').click();
    await page.waitForURL(url=>url.origin!==server.url);
    await page.locator('#status').filter({hasText:'Workspace ready.'}).waitFor();
    const created=(await call('state')).value.created,originalId=created.workspaceId;
    assert.ok(originalId);assert.equal(created.digest,reviewed.review.digest);
    const authoringUrl=new URL(page.url());
    const authoringRequest=async(path,input)=>{
      const response=await fetch(new URL('/api/'+path,authoringUrl),{
        method:input===undefined?'GET':'POST',
        headers:{'x-workspace-token':authoringUrl.hash.slice(1),
          ...(input===undefined?{}:{origin:authoringUrl.origin,'content-type':'application/json'})},
        ...(input===undefined?{}:{body:JSON.stringify(input)})});
      const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;
    };
    assert.equal((await authoringRequest('state')).workspace.id,originalId);
    // Continue as an operator in the original saved product editor.
    await page.locator('#query-list button').filter({hasText:'leaderboard'}).click();
    await page.locator('#query-rows').fill('1');await page.locator('#query-form button[type=submit]').click();
    await page.locator('#revision-note').fill('Connected source, one ranking row per request');
    await page.locator('#save').click();await page.locator('#status').filter({hasText:'Revision saved.'}).waitFor();
    const changed=(await authoringRequest('state')).workspace.head;
    const prepared=await authoringRequest('prepare',{requestId:'setup-customer-package',revisionId:changed});
    assert.equal(prepared.status,'COMPLETED');
    const publicFiles=Object.keys(prepared.result.files).filter(name=>name==='openapi.json'||name.startsWith('client/'));
    for(const name of publicFiles){
      const response=await fetch(new URL('/api/customer-file?package='+encodeURIComponent(prepared.id)+
        '&name='+encodeURIComponent(name),authoringUrl),{headers:{'x-workspace-token':authoringUrl.hash.slice(1)}});
      assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());
      assert.equal(hash(bytes),prepared.result.files[name].sha256);
    }
    const staged=await authoringRequest('stage',{requestId:'setup-retained-release',packageId:prepared.id,releaseId:'setup-v1',runtime:runtime??{port:0}});
    assert.equal(staged.status,'COMPLETED');
    stages.push({kind:'browser-create-edit-prepare-stage',workspaceId:originalId,revision:changed,publicFiles:publicFiles.length,
      livePreviewRows:catalog.data.rowCount,screenshot,releaseId:staged.result.releaseId});
    if(managedSetup){
      const retained=await managedSetup.reattach();
      assert.equal(retained.created.workspaceId,originalId);
      assert.equal(retained.created.setupOrigin.operationId,setupOperationId);
      stages.push({kind:'applications-setup-reattach',applicationId:managedSetup.summary().applicationId,
        operationId:setupOperationId,workspaceId:originalId});
    }
    await browser.close();browser=null;await server.close();server=null;workspace=null;
    const continued=await createRedisConnectionSetup({directory:join(root,'workspace'),initial,environment,
      operationId:setupOperationId,inputSha256:setupInputSha256});
    try{
      assert.equal(continued.created.workspaceId,originalId);assert.equal(continued.created.recovered,true);
      assert.equal(continued.id,created.setupOrigin.setupId);
      assert.equal(continued.workspace.metadata().head,changed);
      stages.push({kind:'original-setup-cold-continuation',operationId:continued.operationId,workspaceId:originalId,head:changed});
    }finally{await continued.close();}
    await assert.rejects(createRedisConnectionSetup({directory:join(root,'workspace'),initial,environment,operationId:'another-setup',inputSha256:setupInputSha256}),
      error=>error.code==='REDIS_SETUP_ORIGIN_CHANGED');
    workspace=await openRedisAuthoringWorkspace(join(root,'workspace'),{environment,
      expectedWorkspaceId:created.workspaceId,expectedProfileSha256:created.profileSha256});
    assert.equal(workspace.metadata().id,originalId);
    assert.equal(workspace.operation(prepared.id).status,'COMPLETED');
    for(const item of REDIS_CERTIFICATE_FILES)if(initial.certificates[item.profile]){
      assert.equal(workspace.metadata()[item.fingerprint],hash(initial.certificates[item.profile]));
      assert.equal(workspace.metadata().profile.connection[item.profile],item.file);
    }
    const preview=await workspace.preview({requestId:'setup-cold-reopen',revisionId:workspace.metadata().head,query:'catalog',input:{region:'north'}});
    assert.equal(preview.status,'COMPLETED');assert.equal(preview.result.data.rows[0].priceAtomic,'9007199254740993');
    reopenedServer=await startRedisAuthoringServer({workspace,port:0});
    browser=await chromium.launch({headless:true,args:['--no-sandbox'],
      ...(process.env.SF30_CHROMIUM_EXECUTABLE?{executablePath:process.env.SF30_CHROMIUM_EXECUTABLE}:{})});
    page=await browser.newPage({viewport:{width:390,height:844}});
    page.on('pageerror',error=>browserErrors.push(error.message));
    await page.goto(reopenedServer.operatorUrl);await page.locator('#status').filter({hasText:'Workspace ready.'}).waitFor();
    assert.equal(await page.locator('#workspace-title').innerText(),'Merchant connected through setup');
    assert.deepEqual(browserErrors,[]);
    stages.push({kind:'cold-reopen',workspaceId:originalId,profileSha256:created.profileSha256,query:'catalog',rows:preview.result.data.rowCount});
    return {result:'PASS',workspaceId:originalId,profileSha256:created.profileSha256,stages,downloads,
      ...(managedSetup?{managedSetup:managedSetup.summary()}:{})};
  }catch(error){
    const diagnostic={error:error.message,browserErrors,stages};
    if(page&&!page.isClosed())diagnostic.status=await page.locator('#status').innerText().catch(()=>null);
    if(process.env.SF30_REDIS_SETUP_DIAGNOSTICS)await writeFile(process.env.SF30_REDIS_SETUP_DIAGNOSTICS,json(diagnostic),{mode:0o600}).catch(()=>{});
    console.error(json({redisSetupFailure:diagnostic}));throw error;
  }finally{
    await browser?.close();
    if(reopenedServer)await reopenedServer.close();else if(server)await server.close();else await workspace?.close();
  }
}
