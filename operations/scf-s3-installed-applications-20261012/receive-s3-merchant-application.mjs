// MIT. One original Applications -> S3 -> SF82 -> customer -> retained restart journey.
// The private signed S3 fixture is supplied separately and stays in its original custody.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, rename, lstat, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const PREFIX = 'stellar/scf-starforge-20261009/';
const text = value => JSON.stringify(value, null, 2) + '\n';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const exists = async path => { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const pause = ms => new Promise(done => setTimeout(done, ms));
import { retainJson as retain, atomicJson as atomic } from './retained-files.mjs';
async function until(label, action, predicate, timeout = 90000) {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) {
    last = await action();
    if (predicate(last)) return last;
    await pause(300);
  }
  throw Object.assign(new Error(label + ' did not reach its expected original state: ' + JSON.stringify(last).slice(0,1500)), { code: 'S3_MANAGED_RECEIVING_TIMEOUT' });
}
function nativeApi(link, header) {
  const selected = new URL(link), token = selected.hash.slice(1);
  assert.match(token, /^[a-f0-9]{64}$/);
  return async (path, input) => {
    const response = await fetch(selected.origin + path, {
      method: input === undefined ? 'GET' : 'POST',
      headers: { [header]: token, ...(input === undefined ? {} : { origin: selected.origin, 'content-type': 'application/json' }) },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      signal: AbortSignal.timeout(15000),
    });
    const value = await response.json();
    assert.equal(response.status, 200, JSON.stringify(value));
    return value;
  };
}
async function listenerClosed(url) {
  try { await fetch(new URL('/api/status', url), { signal: AbortSignal.timeout(800) }); return false; }
  catch { return true; }
}
function publicRuntime(value) {
  return Object.fromEntries(['directory','installationId','profileId','profileSha256','lockSha256','sourceCommit','sourceManifestSha256']
    .map(key => [key, value[key]]));
}
async function screenshot(page, root, name) {
  const overflow = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
  assert.ok(overflow.content <= overflow.width, name + ' overflows its viewport: ' + JSON.stringify(overflow));
  const path = join(root, name + '.png'); await page.screenshot({ path, fullPage: true }); return { path, ...overflow };
}

export async function receiveS3MerchantApplication(config) {
  assert.equal(config.schema, 'stellar-forge.s3-managed-reception-input.v1');
  for (const key of ['runtimeDirectory','sourceRoot','receptionDirectory','fixtureModule','playwrightPackage','chromiumExecutable'])
    assert.equal(resolve(config[key]), config[key], 'An absolute ' + key + ' is required');
  assert.match(config.expectedSourceCommit, /^[a-f0-9]{40}$/);
  assert.match(config.expectedManifest, /^[a-f0-9]{64}$/);
  const root = config.receptionDirectory, sourceRoot = await realpath(config.sourceRoot);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await retain(join(root, 'receiving-input.json'), config);
  const journalPath = join(root, 'managed-s3-reception.json');
  const prior = await exists(journalPath) ? await read(journalPath) : null;
  if (prior?.state === 'COMPLETE') return prior;
  if (prior) await retain(join(root, 'attempt-' + prior.attemptId + '.json'), prior);
  const journal = { schema: 'stellar-forge.s3-managed-reception.v1', operationId: config.operationId ?? 'scf-s3-applications-99d0-20261012',
    attemptId: randomUUID(), state: 'RUNNING', startedAt: new Date().toISOString(),
    inputSha256: sha(text(config)), sourceRoot, previousAttemptId: prior?.attemptId ?? null,
    originalFixtureSha256: sha(await readFile(config.fixtureModule)), steps: [], retained: prior?.retained ?? {} };
  const record = async (phase, detail = {}) => {
    journal.phase = phase; journal.steps.push({ phase, at: new Date().toISOString(), ...detail });
    await fixture?.checkpoint?.(); await atomic(journalPath, journal);
    process.stdout.write(text({ phase, state: journal.state }));
  };
  const module = path => import(pathToFileURL(join(sourceRoot, PREFIX, path)).href);
  const awsNames = ['AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','AWS_REGION'];
  const envBefore = Object.fromEntries(awsNames.map(key => [key,process.env[key]]));
  const tempBefore = process.env.TMPDIR;
  let fixture, runtimeModel, consoleServer, browser, appPage, merchantPage, releasePage, activeApplicationId, objectSource;
  let merchantApi, releaseApi;
  const pageErrors = [], consoleErrors = [];
  try {
    const { inspectMerchantRuntime } = await module('sf46-release/runtime-package.mjs');
    const selected = await inspectMerchantRuntime(config.runtimeDirectory, { expectedManifest: config.expectedManifest, load: true });
    assert.equal(selected.sourceCommit, config.expectedSourceCommit);
    assert.equal(await realpath(selected.sourceRoot), sourceRoot);
    assert.ok(selected.dependencies.some(item => item.name === '@aws-sdk/client-s3'));
    const required = [
      'sf30-seller-sdk/s3/workspace/store.mjs','sf30-seller-sdk/s3/workspace/controller.mjs',
      'sf30-seller-sdk/s3/workspace/server.mjs','distribution/runtime-workspace/application-s3-merchant.mjs',
      'distribution/runtime-workspace/applications.mjs','distribution/runtime-workspace/application-command.mjs',
    ];
    const sourceFiles = [];
    for (const path of required) {
      const bytes = await readFile(join(sourceRoot, PREFIX, path));
      sourceFiles.push({ path: PREFIX + path, bytes: bytes.length, sha256: sha(bytes) });
    }
    const { APPLICATION_CATALOG } = await module('distribution/runtime-workspace/applications.mjs');
    assert.equal(APPLICATION_CATALOG.filter(item => item.id === 's3-merchant').length, 1);
    const runtimeRequire = createRequire(join(config.runtimeDirectory,'package.json'));
    const aws = runtimeRequire('@aws-sdk/client-s3');
    const { Asset, Networks, Keypair } = runtimeRequire('@stellar/stellar-sdk');
    journal.runtime = { ...publicRuntime(selected), node: process.version, sourceFiles,
      awsVersion: (await read(join(config.runtimeDirectory,'node_modules/@aws-sdk/client-s3/package.json'))).version,
      stellarSdkVersion: (await read(join(config.runtimeDirectory,'node_modules/@stellar/stellar-sdk/package.json'))).version };
    await record('original-ready-runtime', { runtime: journal.runtime });

    const { startOriginalS3InventoryFixture } = await import(pathToFileURL(config.fixtureModule).href);
    fixture = await startOriginalS3InventoryFixture({ directory: join(root,'fixture') });
    const actualFixturePort = Number(new URL(fixture.connection.endpoint).port);
    if (journal.retained.fixturePort) assert.equal(actualFixturePort, journal.retained.fixturePort, 'Continue the original signed provider on its retained port');
    journal.retained.fixturePort = actualFixturePort;
    for (const key of awsNames) {
      if (fixture.env[key] === undefined) delete process.env[key]; else process.env[key] = fixture.env[key];
    }
    const inputs = join(root,'inputs'); await mkdir(inputs,{recursive:true,mode:0o700});
    const merchantDirectory = config.merchantDirectory ?? join(root,'merchant');
    const releaseStore = config.releaseStore ?? join(merchantDirectory,'releases');
    const sourcePath = join(inputs,'source.json'), paymentPath = join(inputs,'payment.json'), environmentPath = join(inputs,'environment.json');
    if (!journal.retained.initialSource) {
      const payment = { ...(await read(join(sourceRoot,PREFIX,'sf30-seller-sdk/python/example-merchant.json'))).functions.summarize.payment,
        asset: Asset.native().contractId(Networks.TESTNET), payTo: Keypair.random().publicKey(), amount:'1000' };
      const source = { schema:'stellar-forge.s3-source.v1', ...fixture.connection, objects:[
        { id:'historical',path:'/downloads/historical',key:'exports/versioned',mode:'whole',
          versionId:'v1',maxBytes:1048576,contentType:'text/plain',filename:'historical.txt',
          description:'Retained original object version' },
        { id:'utf8',path:'/downloads/utf8',key:'exports/nested/price 20% + café.txt',mode:'whole',
          maxBytes:1048576,contentType:'text/plain',filename:'price-note.txt',
          description:'Exact literal UTF-8 source key' },
      ] };
      journal.retained.initialSource = source; journal.retained.initialPayment = payment;
      await retain(sourcePath,source); await retain(paymentPath,payment);
    }
    await retain(environmentPath,fixture.env);
    const { createRuntimeWorkspace,openRuntimeWorkspace } = await module('distribution/runtime-workspace/model.mjs');
    const workspaceDirectory = config.applicationWorkspace ?? join(root,'applications');
    if (!await exists(join(workspaceDirectory,'workspace.json'))) await createRuntimeWorkspace({directory:workspaceDirectory});
    runtimeModel = await openRuntimeWorkspace({directory:workspaceDirectory});
    const attached = await runtimeModel.attach({directory:config.runtimeDirectory,label:'Original S3 merchant runtime'});
    assert.equal(attached.status,'READY');
    const { startRuntimeWorkspace } = await module('distribution/runtime-workspace/server.mjs');
    consoleServer = await startRuntimeWorkspace({directory:workspaceDirectory,port:journal.retained.applicationPort ?? 0});
    journal.retained.applicationPort = Number(new URL(consoleServer.url).port);
    const browserTemp = join(root,'browser-temp'); await mkdir(browserTemp,{recursive:true,mode:0o700}); process.env.TMPDIR = browserTemp;
    const requireBrowser = createRequire(config.playwrightPackage), {chromium} = requireBrowser('playwright');
    browser = await chromium.launch({executablePath:config.chromiumExecutable,headless:true,
      args:['--no-sandbox','--disable-dev-shm-usage']});
    journal.runtime.browser = {playwright:requireBrowser('playwright/package.json').version,chromium:await browser.version()};
    const context = await browser.newContext({viewport:{width:1480,height:1000},acceptDownloads:true});
    context.on('page',page => {page.on('pageerror',error => pageErrors.push(error.message));});
    appPage = await context.newPage(); appPage.setDefaultTimeout(20000);
    await appPage.goto(consoleServer.url);
    await appPage.locator('[data-view="applications"]').click();
    await appPage.locator('#application-kind').waitFor();
    const applicationState = () => runtimeModel.applicationsState();
    const currentApplication = async () => (await applicationState()).applications.find(item => item.id === activeApplicationId);
    const existing = (await applicationState()).applications.find(item => item.id === journal.retained.applicationId);
    if (existing) {
      activeApplicationId = existing.id;
      await appPage.getByRole('button',{name:new RegExp('^'+existing.label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+' · ')}).click();
    } else {
      assert.equal((await applicationState()).applications.filter(item=>item.label==='S3 managed receiving').length,0);
      await appPage.locator('#application-label').fill('S3 managed receiving');
      await appPage.locator('#application-runtime').selectOption(attached.runtimeId);
      await appPage.locator('#application-kind').selectOption('s3-merchant');
      const settings = {workspaceDirectory:merchantDirectory,releaseStore,
        sourceFile:sourcePath,paymentFile:paymentPath,origin:'https://objects.example',
        environmentFile:environmentPath,port:'0',releaseConsolePort:'0'};
      for (const [key,value] of Object.entries(settings)) await appPage.locator('#application-setting-'+key).fill(value);
      await appPage.getByRole('button',{name:'Review application',exact:true}).click();
      await appPage.getByRole('button',{name:'Save application',exact:true}).click();
      const saved = await until('Saved application',applicationState,state=>state.applications.some(item=>item.label==='S3 managed receiving'));
      const app = saved.applications.find(item=>item.label==='S3 managed receiving');
      activeApplicationId = journal.retained.applicationId = app.id;
      await record('saved-application',{applicationId:app.id,revision:app.revision,runtimeId:app.runtimeId});
    }
    await until('Original managed adoption',currentApplication,app=>Boolean(app?.release));
    const start = async () => {
      let app = await currentApplication();
      if (app.current?.active && app.current.privateUrl) return app;
      assert.ok(!app.current?.active,'An existing original application is still active without its startup URL');
      await until('Start control',async()=>appPage.getByRole('button',{name:'Review start',exact:true}).isEnabled(),Boolean);
      await appPage.getByRole('button',{name:'Review start',exact:true}).click();
      await appPage.getByRole('button',{name:'Start reviewed application',exact:true}).click();
      app = await until('Original S3 private launch',currentApplication,item=>Boolean(item?.current?.active && item.current.privateUrl &&
        item.current.privateLinks?.some(link=>link.id==='s3-releases')));
      assert.equal(app.kind,'s3-merchant'); assert.equal(app.runtime.sourceCommit,config.expectedSourceCommit);
      return app;
    };
    let app = await start();
    journal.retained.firstRunId ??= app.current.id;
    const initialRun = app.current, initialLink = initialRun.privateUrl;
    const releaseLink = initialRun.privateLinks.find(link=>link.id==='s3-releases').url;
    const popup = context.waitForEvent('page');
    await appPage.getByRole('link',{name:'Open application',exact:true}).click();
    merchantPage = await popup; merchantPage.setDefaultTimeout(20000);
    await merchantPage.waitForLoadState('domcontentloaded');
    await merchantPage.locator('#revision-status').waitFor();
    merchantApi = nativeApi(initialLink,'x-s3-workspace-token');
    releaseApi = nativeApi(releaseLink,'x-release-token');
    const releasePopup=context.waitForEvent('page');
    await appPage.getByRole('link',{name:'Open merchant releases',exact:true}).click();
    releasePage=await releasePopup;await releasePage.waitForLoadState('domcontentloaded');
    assert.equal(new URL(releasePage.url()).origin,new URL(releaseLink).origin);
    let state = await merchantApi('/api/status');
    await merchantPage.waitForFunction(revision=>document.getElementById('revision-status').textContent==='Current revision '+revision,state.draft.revision);
    assert.equal(state.workspaceId,initialRun.url.original.workspaceId);
    journal.retained.workspaceId = state.workspaceId;
    assert.ok(state.draft.revision>=1);
    await record('original-application-start',{applicationId:app.id,operationId:app.current.id,
      releaseId:app.release.id,workspaceId:state.workspaceId,authoringOrigin:new URL(initialLink).origin,
      releaseOrigin:new URL(releaseLink).origin,revision:state.draft.revision});

    if (!journal.retained.authoredRevision) {
      await merchantPage.locator('#object-description').fill('Historical object supplied through the original managed merchant');
      const payment = {...journal.retained.initialPayment,amount:'1400'};
      await merchantPage.locator('#payment-json').fill(text(payment));
      await merchantPage.locator('#save').click();
      await merchantPage.waitForFunction(()=>document.getElementById('notice').textContent.startsWith('Saved source and complete payment terms as revision '));
      state = await merchantApi('/api/status');
      journal.retained.authoredRevision = state.draft.revision;
      assert.equal(state.draft.payment.amount,'1400');
    }
    if (!journal.retained.reviewId) {
      await merchantPage.locator('#review').click();
      await merchantPage.waitForFunction(()=>document.getElementById('notice').textContent.startsWith('Object inspection saved.'));
      const reviewId = await merchantPage.locator('#reviews').inputValue();
      journal.retained.reviewId = reviewId;
    }
    const reviewed = await merchantApi('/api/review?reviewId='+encodeURIComponent(journal.retained.reviewId));
    assert.equal(reviewed.revision,journal.retained.authoredRevision);
    if (!journal.retained.packageId) {
      await merchantPage.locator('#reviews').selectOption(journal.retained.reviewId);
      await merchantPage.locator('#prepare').click();
      await merchantPage.waitForFunction(()=>document.getElementById('notice').textContent.startsWith('Prepared '));
      journal.retained.packageId = await merchantPage.locator('#packages').inputValue();
    }
    const prepared = await merchantApi('/api/package?packageId='+encodeURIComponent(journal.retained.packageId));
    const selectedSource = await read(join(prepared.directory,'source.json'));
    assert.equal(sha(await readFile(join(prepared.directory,'source.json'))),reviewed.selectionSha256);
    assert.equal(selectedSource.objects.find(item=>item.id==='historical').versionId,'v1');
    if (!journal.retained.releaseId) {
      await merchantPage.locator('#packages').selectOption(journal.retained.packageId);
      await merchantPage.locator('#release-id').fill('s3-managed-receiving-v1');
      await merchantPage.locator('#seller-port').fill('0');
      await merchantPage.locator('#stage').click();
      await merchantPage.waitForFunction(()=>document.getElementById('notice').textContent.startsWith('Staged '));
      journal.retained.releaseId = await merchantPage.locator('#customer-release').inputValue();
    }
    const releaseId = journal.retained.releaseId;
    let released = await releaseApi('/api/status');
    if (released.state.active!==releaseId) released = await releaseApi('/api/activate',{
      id:releaseId,expectedGeneration:released.state.generation,reason:'Original S3 Applications receiving'});
    released = await releaseApi('/api/run',{expectedGeneration:released.state.generation});
    const sellerListener = released.runtime.observed.listener;
    const beforeChallenge = fixture.counters().gets;
    const unpaid = await fetch(sellerListener+'/downloads/historical');
    assert.equal(unpaid.status,402); const challengeObjectGets=fixture.counters().gets-beforeChallenge; assert.equal(challengeObjectGets,0);
    const challenge = JSON.parse(Buffer.from(unpaid.headers.get('payment-required'),'base64').toString());
    assert.equal(challenge.resource.url,'https://objects.example/downloads/historical');
    const {createS3ObjectSource} = await module('sf30-seller-sdk/s3/source.mjs');
    objectSource = await createS3ObjectSource(selectedSource,{sdk:aws,env:fixture.env});
    const delivered = await objectSource.route('historical').handler({method:'GET',query:{},headers:{},body:null});
    assert.equal(delivered.status,200); assert.deepEqual(delivered.body,fixture.versions.get('v1'));
    objectSource.close(); objectSource = null;
    const customer = await merchantApi('/api/customer?releaseId='+encodeURIComponent(releaseId));
    await merchantPage.locator('#customer-release').selectOption(releaseId);
    for (const file of customer.files) {
      const download = merchantPage.waitForEvent('download');
      await merchantPage.locator('#download-'+file.file.replace('.json','')).click();
      const response = await download,target=join(root,file.file); await response.saveAs(target);
      const bytes=await readFile(target);assert.equal(bytes.length,file.bytes);assert.equal(sha(bytes),file.sha256);
    }
    journal.customer={releaseId,releaseDigest:customer.releaseDigest,files:customer.files};
    journal.delivery={challengeStatus:402,challengeObjectGets,
      objectBytes:delivered.body.length,objectSha256:sha(delivered.body)};
    assert.equal(journal.delivery.challengeObjectGets,0);
    journal.screenshots=[await screenshot(appPage,root,'applications-desktop'),await screenshot(merchantPage,root,'merchant-desktop'),
      await screenshot(releasePage,root,'release-console-desktop')];
    await merchantPage.setViewportSize({width:390,height:844});
    journal.screenshots.push(await screenshot(merchantPage,root,'merchant-mobile'));
    await merchantPage.setViewportSize({width:1480,height:1000});
    await record('original-merchant-customer',{reviewId:reviewed.reviewId,packageId:prepared.packageId,
      releaseId,releaseDigest:customer.releaseDigest,customerFiles:customer.files,delivery:journal.delivery});

    state = await merchantApi('/api/status');
    const dirtySource = structuredClone(state.draft.source);
    dirtySource.objects.find(item=>item.id==='historical').description='Retained unfinished source edit after managed Stop';
    const dirtyPayment = {...state.draft.payment,amount:'1700'};
    const dirtySourceText=text(dirtySource),dirtyPaymentText=text(dirtyPayment);
    await merchantPage.getByText('Complete source JSON',{exact:true}).click();
    await merchantPage.locator('#source-json').fill(dirtySourceText);
    await merchantPage.locator('#payment-json').fill(dirtyPaymentText);
    const dirtyBefore=await merchantPage.evaluate(()=>JSON.parse(sessionStorage.getItem('sf30.s3.draft')));
    assert.equal(dirtyBefore.dirty,true);assert.equal(dirtyBefore.sourceText,dirtySourceText);assert.equal(dirtyBefore.paymentText,dirtyPaymentText);
    journal.retained.dirtyDraft=dirtyBefore;
    if (await exists(sourcePath)) await rename(sourcePath,sourcePath+'.archived');
    if (await exists(paymentPath)) await rename(paymentPath,paymentPath+'.archived');
    const providerBeforeReopen=fixture.counters();
    await appPage.getByRole('button',{name:'Stop application',exact:true}).click();
    const stopped=await until('Original managed merchant drain',currentApplication,item=>item?.current?.id===initialRun.id&&!item.current.active&&item.phase==='STOPPED');
    for(const url of [initialLink,releaseLink,sellerListener]) await until('Original listener closes',()=>listenerClosed(url),Boolean,20000);
    await releasePage.close();releasePage=null;
    const {inspectS3WorkspaceStore}=await module('sf30-seller-sdk/s3/workspace/store.mjs');
    const stoppedStore=await inspectS3WorkspaceStore(merchantDirectory);
    assert.equal(stoppedStore.workspaceId,journal.retained.workspaceId);
    assert.equal(stoppedStore.authoringPort,Number(new URL(initialLink).port));
    await record('applications-stop-drains-owned-merchant',{operationId:stopped.current.id,
      authoringPort:stoppedStore.authoringPort,revision:stoppedStore.revision,dirtyDraftRetained:true,
      archivedInitialFiles:true});

    // The same tab navigates normally to the new original URL. No page script,
    // storage injection or alternate HTTP transport is used to restore the draft.
    app=await start();assert.notEqual(app.current.id,initialRun.id);
    const restartedLink=app.current.privateUrl;
    assert.equal(new URL(restartedLink).origin,new URL(initialLink).origin);
    assert.notEqual(new URL(restartedLink).hash,new URL(initialLink).hash);
    const runRequest=await read(join(workspaceDirectory,'operations',app.current.id,'request.json'));
    assert.equal(runRequest.args.includes('--source'),false);
    assert.equal(runRequest.args.includes('--payment'),false);
    await merchantPage.goto(restartedLink);
    await merchantPage.waitForFunction(()=>document.getElementById('draft-status').textContent.includes('Unsaved changes'));
    assert.equal(await merchantPage.locator('#source-json').inputValue(),dirtySourceText);
    assert.equal(await merchantPage.locator('#payment-json').inputValue(),dirtyPaymentText);
    const dirtyAfter=await merchantPage.evaluate(()=>JSON.parse(sessionStorage.getItem('sf30.s3.draft')));
    assert.deepEqual(dirtyAfter.pending,dirtyBefore.pending);
    assert.equal(dirtyAfter.expectedRevision,dirtyBefore.expectedRevision);
    merchantApi=nativeApi(restartedLink,'x-s3-workspace-token');
    releaseApi=nativeApi(app.current.privateLinks.find(link=>link.id==='s3-releases').url,'x-release-token');
    const reopened=await merchantApi('/api/status');
    assert.equal(reopened.workspaceId,state.workspaceId);
    assert.equal(reopened.draft.revision,state.draft.revision);
    assert.deepEqual(await merchantApi('/api/review?reviewId='+encodeURIComponent(reviewed.reviewId)),reviewed);
    assert.deepEqual(await merchantApi('/api/customer?releaseId='+encodeURIComponent(releaseId)),customer);
    assert.deepEqual(fixture.counters(),providerBeforeReopen);
    await merchantPage.locator('#save').click();
    await merchantPage.waitForFunction(()=>document.getElementById('notice').textContent.startsWith('Saved source and complete payment terms as revision '));
    const finalState=await merchantApi('/api/status');
    assert.equal(finalState.draft.revision,state.draft.revision+1);
    assert.equal(finalState.draft.payment.amount,'1700');
    assert.equal(finalState.draft.source.objects.find(item=>item.id==='historical').description,dirtySource.objects.find(item=>item.id==='historical').description);
    const nextConsole=await releaseApi('/api/status');
    assert.equal(nextConsole.state.active,releaseId);
    const restartedSeller=await releaseApi('/api/run',{expectedGeneration:nextConsole.state.generation});
    assert.equal((await fetch(restartedSeller.runtime.observed.listener+'/downloads/historical')).status,402);
    await record('same-origin-dirty-tab-reopen',{applicationId:app.id,firstOperationId:initialRun.id,
      secondOperationId:app.current.id,workspaceId:finalState.workspaceId,revision:finalState.draft.revision,
      authoringOrigin:new URL(restartedLink).origin,reviewId:reviewed.reviewId,releaseId,
      providerReadsDuringReopen:0,sourceAndPaymentRestored:true});

    await appPage.getByRole('button',{name:'Stop application',exact:true}).click();
    const finalApp=await until('Final original Stop',currentApplication,item=>!item?.current?.active&&item?.phase==='STOPPED');
    await until('Final seller closes',()=>listenerClosed(restartedSeller.runtime.observed.listener),Boolean,20000);
    assert.deepEqual(pageErrors,[]);
    assert.equal(fixture.counters().denied,0);
    journal.application={applicationId:finalApp.id,revision:finalApp.revision,phase:finalApp.phase,
      runtime:finalApp.runtime,releaseId:finalApp.release.id,runs:finalApp.runs.map(item=>({id:item.id,phase:item.phase,active:item.active}))};
    journal.provider={...fixture.counters(),calls:fixture.calls};
    journal.pageErrors=pageErrors;journal.consoleErrors=consoleErrors;
    journal.state='COMPLETE';journal.completedAt=new Date().toISOString();
    await record('complete',{applicationId:finalApp.id,finalPhase:finalApp.phase,revision:finalState.draft.revision});
    return journal;
  } catch(error) {
    journal.state='FAILED';journal.error={name:error.name,code:error.code??null,message:error.message,stack:error.stack};
    journal.pageErrors=pageErrors;
    if(appPage&&!appPage.isClosed())journal.applicationMessage=await appPage.locator('#message').textContent().catch(()=>null);
    if(merchantPage&&!merchantPage.isClosed())journal.merchantMessage=await merchantPage.locator('#notice').textContent().catch(()=>null);
    await atomic(journalPath,journal);
    throw error;
  } finally {
    objectSource?.close();
    if(runtimeModel&&activeApplicationId){
      const app=(await runtimeModel.applicationsState().catch(()=>({applications:[]}))).applications.find(item=>item.id===activeApplicationId);
      if(app?.current?.active){
        await runtimeModel.applicationsStop({applicationId:activeApplicationId,operationId:app.current.id}).catch(error=>consoleErrors.push(error.message));
        await until('Cleanup original Stop',async()=>(await runtimeModel.applicationsState()).applications.find(item=>item.id===activeApplicationId),
          item=>!item?.current?.active,15000).catch(error=>consoleErrors.push(error.message));
      }
    }
    await browser?.close().catch(error=>consoleErrors.push(error.message));
    await consoleServer?.close().catch(error=>consoleErrors.push(error.message));
    await runtimeModel?.close?.();
    await fixture?.close();
    for(const key of awsNames)if(envBefore[key]===undefined)delete process.env[key];else process.env[key]=envBefore[key];
    if(tempBefore===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=tempBefore;
    journal.cleanup={completedAt:new Date().toISOString(),errors:consoleErrors};
    await atomic(journalPath,journal);
  }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const config=await read(resolve(process.argv[2]));
  try{const result=await receiveS3MerchantApplication(config);process.stdout.write(text({state:result.state,applicationId:result.application?.applicationId}));}
  catch(error){process.stderr.write((error.stack??String(error))+'\n');process.exitCode=1;}
}
