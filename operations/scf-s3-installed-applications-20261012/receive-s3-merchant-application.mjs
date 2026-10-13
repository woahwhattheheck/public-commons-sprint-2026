// MIT. One original Applications -> S3 -> SF82 -> customer -> retained restart journey.
// The private signed S3 fixture is supplied separately and stays in its original custody.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, rename, unlink, lstat, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const PREFIX = 'stellar/scf-starforge-20261009/';
const text = value => JSON.stringify(value, null, 2) + '\n';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const exists = async path => { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const pause = ms => new Promise(done => setTimeout(done, ms));
import { retainJson as retain, atomicJson as atomic, writeNew } from './retained-files.mjs';
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
  const path = join(root, name + '.png'); await page.screenshot({ path, fullPage: true });
  const bytes = await readFile(path); return { path, bytes: bytes.length, sha256: sha(bytes), ...overflow };
}

export async function receiveS3MerchantApplication(config) {
  config = structuredClone(config);
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
  const inputSha256 = sha(text(config));
  const operationId = config.operationId ?? 'scf-s3-applications-99d0-20261012';
  const originalFixtureSha256 = sha(await readFile(config.fixtureModule));
  const verifyCustomer = async value => {
    assert.equal(value.releaseId, journal.retained.releaseId);
    assert.deepEqual(value.files.map(item => item.file).sort(), ['objects.json', 'offers.json']);
    for (const file of value.files) {
      const bytes = await readFile(join(root, file.file));
      assert.equal(bytes.length, file.bytes); assert.equal(sha(bytes), file.sha256);
    }
  };
  if (prior) {
    assert.equal(prior.schema, 'stellar-forge.s3-managed-reception.v1');
    assert.equal(prior.operationId, operationId); assert.equal(prior.inputSha256, inputSha256);
    assert.equal(prior.sourceRoot, sourceRoot); assert.equal(prior.originalFixtureSha256, originalFixtureSha256);
  }
  if (prior) await retain(join(root, 'attempt-' + prior.attemptId + '.json'), prior);
  const journal = { ...prior, schema: 'stellar-forge.s3-managed-reception.v1', operationId: config.operationId ?? 'scf-s3-applications-99d0-20261012',
    attemptId: randomUUID(), state: 'RUNNING', startedAt: new Date().toISOString(),
    inputSha256, sourceRoot, previousAttemptId: prior?.attemptId ?? null,
    originalFixtureSha256, steps: structuredClone(prior?.steps ?? []), retained: structuredClone(prior?.retained ?? {}) };
  journal.retained.actions ??= {};
  if (prior?.state === 'COMPLETE') {
    assert.equal(prior.application?.phase, 'STOPPED');
    assert.ok(prior.cleanup?.completedAt); assert.deepEqual(prior.cleanup.errors, []);
    const { inspectMerchantRuntime } = await import(pathToFileURL(join(sourceRoot, PREFIX, 'sf46-release/runtime-package.mjs')).href);
    const selected = await inspectMerchantRuntime(config.runtimeDirectory, { expectedManifest: config.expectedManifest, load: false });
    assert.equal(selected.sourceCommit, config.expectedSourceCommit);
    assert.equal(await realpath(selected.sourceRoot), sourceRoot);
    assert.deepEqual(publicRuntime(selected), publicRuntime(prior.runtime));
    for (const item of prior.runtime.sourceFiles) {
      const bytes = await readFile(join(sourceRoot, item.path));
      assert.equal(bytes.length, item.bytes); assert.equal(sha(bytes), item.sha256);
    }
    await verifyCustomer(prior.customer);
    for (const item of prior.screenshots ?? []) {
      assert.equal(resolve(item.path), join(root, item.path.split('/').at(-1)));
      const bytes = await readFile(item.path);
      if (item.sha256) { assert.equal(bytes.length, item.bytes); assert.equal(sha(bytes), item.sha256); }
    }
    return prior;
  }
  let writing = Promise.resolve();
  const persist = () => {
    const snapshot = structuredClone(journal);
    writing = writing.then(() => atomic(journalPath, snapshot));
    return writing;
  };
  const record = async (phase, detail = {}) => {
    journal.phase = phase; journal.steps.push({ phase, at: new Date().toISOString(), ...detail });
    await fixture?.checkpoint?.(); await persist();
    process.stdout.write(text({ phase, state: journal.state }));
  };
  const module = path => import(pathToFileURL(join(sourceRoot, PREFIX, path)).href);
  const awsNames = ['AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','AWS_REGION'];
  const envBefore = Object.fromEntries(awsNames.map(key => [key,process.env[key]]));
  const tempBefore = process.env.TMPDIR;
  let fixture, runtimeModel, consoleServer, browser, appPage, merchantPage, releasePage, activeApplicationId, objectSource;
  let merchantApi, releaseApi;
  const pageErrors = [], consoleErrors = [];
  let workSucceeded = false, primaryError;
  // A browser request is retained before route.continue permits its original
  // native writer to run. Recovery uses that same complete request and API.
  const uiWrite = async ({ key, page, path, setup, click, validate, recover }) => {
    let selected = journal.retained.actions[key];
    if (selected) {
      assert.equal(selected.path, path); validate(selected.input);
      const value = await recover(structuredClone(selected.input), selected.complete ? selected.result : undefined);
      if (!selected.complete) {
        selected.result = value; selected.complete = true; selected.recoveredAt = new Date().toISOString();
        await persist();
      }
      return value;
    }
    await setup?.();
    let captured, captureError;
    const origin = new URL(page.url()).origin;
    const matches = url => url.origin === origin && url.pathname === path;
    const handler = async route => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      try {
        const input = route.request().postDataJSON(); validate(input);
        assert.ok(!captured, 'One original browser request is required for ' + key);
        captured = { path, input: structuredClone(input), capturedAt: new Date().toISOString() };
        journal.retained.actions[key] = captured;
        await persist(); await route.continue();
      } catch (error) { captureError = error; await route.abort().catch(() => {}); }
    };
    await page.route(matches, handler);
    try {
      const returned = page.waitForResponse(response => matches(new URL(response.url())) &&
        response.request().method() === 'POST', { timeout: 90000 });
      returned.catch(() => {});
      await click();
      let response;
      try { response = await returned; } catch (error) { throw captureError ?? error; }
      if (captureError) throw captureError;
      assert.ok(captured, 'The original browser request was not captured');
      const value = await response.json();
      assert.ok(response.ok(), JSON.stringify(value));
      captured.result = value; captured.complete = true; captured.completedAt = new Date().toISOString();
      await persist();
      const notices = { '/api/save': 'Saved source and complete payment terms as revision ',
        '/api/review': 'Object inspection saved.', '/api/prepare': 'Prepared ', '/api/stage': 'Staged ' };
      if (notices[path]) await page.waitForFunction(prefix => document.getElementById('notice').textContent.startsWith(prefix), notices[path]);
      return value;
    } finally { await page.unroute(matches, handler); }
  };
  const exactFields = (input, fields) => assert.deepEqual(Object.keys(input).sort(), fields.sort());
  const nativeRequestId = value => assert.match(value, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  const originalId = value => assert.match(value, /^[a-z][a-z0-9-]{7,79}$/);
  const retainedValue = async (key, value) => {
    if (Object.hasOwn(journal.retained, key)) assert.deepEqual(journal.retained[key], value, key + ' changed');
    else { journal.retained[key] = structuredClone(value); await persist(); }
    return journal.retained[key];
  };
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
    if (journal.runtime) assert.deepEqual(publicRuntime(selected),publicRuntime(journal.runtime),'Original installed runtime changed');
    journal.runtime = { ...journal.runtime, ...publicRuntime(selected), node: process.version, sourceFiles,
      awsVersion: (await read(join(config.runtimeDirectory,'node_modules/@aws-sdk/client-s3/package.json'))).version,
      stellarSdkVersion: (await read(join(config.runtimeDirectory,'node_modules/@stellar/stellar-sdk/package.json'))).version };
    await record('original-ready-runtime', { runtime: journal.runtime });

    const { startOriginalS3InventoryFixture } = await import(pathToFileURL(config.fixtureModule).href);
    fixture = await startOriginalS3InventoryFixture({ directory: join(root,'fixture') });
    const actualFixturePort = Number(new URL(fixture.connection.endpoint).port);
    if (journal.retained.fixturePort) assert.equal(actualFixturePort, journal.retained.fixturePort, 'Continue the original signed provider on its retained port');
    journal.retained.fixturePort = actualFixturePort;
    await record('original-provider-selection', { fixturePort: actualFixturePort });
    for (const key of awsNames) {
      if (fixture.env[key] === undefined) delete process.env[key]; else process.env[key] = fixture.env[key];
    }
    const inputs = join(root,'inputs'); await mkdir(inputs,{recursive:true,mode:0o700});
    const merchantDirectory = config.merchantDirectory ?? join(root,'merchant');
    const releaseStore = config.releaseStore ?? join(merchantDirectory,'releases');
    const sourcePath = join(inputs,'source.json'), paymentPath = join(inputs,'payment.json'), environmentPath = join(inputs,'environment.json');
    if (!journal.retained.initialSource) {
      const paymentTemplate = { ...(await read(join(sourceRoot,PREFIX,'sf30-seller-sdk/python/example-merchant.json'))).functions.summarize.payment,
        asset: Asset.native().contractId(Networks.TESTNET), amount:'1000' };
      const retainedPaymentPath = await exists(paymentPath+'.archived') ? paymentPath+'.archived' : paymentPath;
      const payment = await exists(retainedPaymentPath) ? await read(retainedPaymentPath) :
        { ...paymentTemplate, payTo: Keypair.random().publicKey() };
      assert.equal(Keypair.fromPublicKey(payment.payTo).publicKey(),payment.payTo);
      assert.deepEqual({...payment,payTo:null},{...paymentTemplate,payTo:null});
      const source = { schema:'stellar-forge.s3-source.v1', ...fixture.connection, objects:[
        { id:'historical',path:'/downloads/historical',key:'exports/versioned',mode:'whole',
          versionId:'v1',maxBytes:1048576,contentType:'text/plain',filename:'historical.txt',
          description:'Retained original object version' },
        { id:'utf8',path:'/downloads/utf8',key:'exports/nested/price 20% + café.txt',mode:'whole',
          maxBytes:1048576,contentType:'text/plain',filename:'price-note.txt',
          description:'Exact literal UTF-8 source key' },
      ] };
      const retainedSourcePath = await exists(sourcePath+'.archived') ? sourcePath+'.archived' : sourcePath;
      if (await exists(retainedSourcePath)) assert.deepEqual(await read(retainedSourcePath),source);
      journal.retained.initialSource = source; journal.retained.initialPayment = payment;
      await record('initial-source-selection');
    }
    assert.ok(journal.retained.initialPayment);
    for (const [key,value] of Object.entries(fixture.connection))
      assert.deepEqual(journal.retained.initialSource[key],value,'Original provider connection changed: '+key);
    for (const [path, value] of [[sourcePath, journal.retained.initialSource], [paymentPath, journal.retained.initialPayment]])
      await retain(await exists(path + '.archived') ? path + '.archived' : path, value);
    await retain(environmentPath,fixture.env);
    const { createRuntimeWorkspace,openRuntimeWorkspace } = await module('distribution/runtime-workspace/model.mjs');
    const workspaceDirectory = config.applicationWorkspace ?? join(root,'applications');
    if (!await exists(join(workspaceDirectory,'workspace.json'))) await createRuntimeWorkspace({directory:workspaceDirectory});
    runtimeModel = await openRuntimeWorkspace({directory:workspaceDirectory});
    const attached = await runtimeModel.attach({directory:config.runtimeDirectory,label:'Original S3 merchant runtime'});
    assert.equal(attached.status,'READY');
    const settings = { workspaceDirectory: merchantDirectory, releaseStore,
      sourceFile: sourcePath, paymentFile: paymentPath, origin: 'https://objects.example',
      environmentFile: environmentPath, port: 0, releaseConsolePort: 0 };
    const validateApplication = app => {
      assert.ok(app); assert.equal(app.kind, 's3-merchant'); assert.equal(app.label, 'S3 managed receiving');
      assert.equal(app.runtimeId, attached.runtimeId); assert.deepEqual(app.settings, settings);
      assert.deepEqual(publicRuntime(app.runtime), publicRuntime(selected));
      nativeRequestId(app.saveRequestId); assert.equal(app.id, sha(app.saveRequestId).slice(0, 24));
      assert.equal(typeof app.reviewId, 'string');
      const original = journal.retained.actions.applicationSave?.input;
      if (original) { assert.equal(app.saveRequestId, original.requestId); assert.equal(app.reviewId, original.reviewId); }
      return app;
    };
    if (journal.retained.journeyComplete) {
      activeApplicationId = journal.retained.applicationId;
      validateApplication((await runtimeModel.applicationsState()).applications.find(item => item.id === activeApplicationId));
      await verifyCustomer(journal.customer);
      workSucceeded = true;
      return journal;
    }
    const { startRuntimeWorkspace } = await module('distribution/runtime-workspace/server.mjs');
    consoleServer = await startRuntimeWorkspace({directory:workspaceDirectory,port:journal.retained.applicationPort ?? 0});
    journal.retained.applicationPort = Number(new URL(consoleServer.url).port);
    await record('applications-console-origin', { port: journal.retained.applicationPort });
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
    const savedRequest = journal.retained.actions.applicationSave?.input;
    let existing = (await applicationState()).applications.find(item =>
      item.id === journal.retained.applicationId || savedRequest && item.saveRequestId === savedRequest.requestId);
    if (!existing && !savedRequest) {
      // Older attempts may have committed Save before recording its returned ID.
      // Only the exact selected runtime/settings and original native save receipt
      // can be adopted; a matching display label alone never establishes ownership.
      const matches = (await applicationState()).applications.filter(item => {
        try { validateApplication(item); return true; } catch { return false; }
      });
      assert.ok(matches.length <= 1, 'More than one original application matches this receiving input');
      existing = matches[0];
      if (existing) {
        journal.retained.actions.applicationSave = { path: '/api/applications/save',
          input: { requestId: existing.saveRequestId, reviewId: existing.reviewId, applicationId: null },
          result: { applicationId: existing.id, revision: existing.revision, saved: true },
          complete: true, adoptedAt: new Date().toISOString() };
        await persist();
      }
    }
    if (existing) {
      validateApplication(existing);
      activeApplicationId = journal.retained.applicationId = existing.id;
      await persist();
      await appPage.getByRole('button',{name:new RegExp('^'+existing.label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+' · ')}).click();
    } else {
      const saved = await uiWrite({ key: 'applicationSave', page: appPage, path: '/api/applications/save',
        validate(input) {
          exactFields(input, ['requestId', 'reviewId', 'applicationId']);
          assert.equal(input.applicationId, null); nativeRequestId(input.requestId); assert.equal(typeof input.reviewId, 'string');
        },
        setup: async () => {
          assert.equal((await applicationState()).applications.filter(item=>item.label==='S3 managed receiving').length,0);
          await appPage.locator('#application-label').fill('S3 managed receiving');
          await appPage.locator('#application-runtime').selectOption(attached.runtimeId);
          await appPage.locator('#application-kind').selectOption('s3-merchant');
          for (const [key,value] of Object.entries(settings)) await appPage.locator('#application-setting-'+key).fill(String(value));
          await appPage.getByRole('button',{name:'Review application',exact:true}).click();
        },
        click: () => appPage.getByRole('button',{name:'Save application',exact:true}).click(),
        recover: input => runtimeModel.applicationsSave(input),
      });
      const app = validateApplication(await until('Saved original application',
        async () => (await applicationState()).applications.find(item => item.id === saved.applicationId), Boolean));
      activeApplicationId = journal.retained.applicationId = app.id;
      await record('saved-application',{applicationId:app.id,revision:app.revision,runtimeId:app.runtimeId});
      await appPage.reload();
      await appPage.locator('[data-view="applications"]').click();
      await appPage.getByRole('button',{name:new RegExp('^S3 managed receiving · ')}).click();
    }
    if (!(await currentApplication())?.release)
      await runtimeModel.applicationsConnect({ applicationId: activeApplicationId });
    await until('Original managed adoption',currentApplication,app=>Boolean(app?.release));
    let startNumber = 0;
    const start = async () => {
      let app = validateApplication(await currentApplication());
      const pending = journal.retained.pendingStart;
      if (pending && journal.retained.actions[pending]?.input &&
          !app.runs.some(run => run.id === journal.retained.actions[pending].input.requestId))
        await runtimeModel.applicationsStart(journal.retained.actions[pending].input);
      app = await currentApplication();
      if (app.current?.active || ['PENDING', 'QUEUED', 'RUNNING', 'INTERRUPTED'].includes(app.current?.phase)) {
        if (!app.current.privateUrl)
          await runtimeModel.applicationsRecover({ applicationId: app.id, operationId: app.current.id });
      } else {
        // A stopped original lifetime stays stopped. A new reviewed start is
        // part of this same receiving journey, with its own retained native ID.
        const key = 'start-' + journal.attemptId + '-' + (++startNumber);
        journal.retained.pendingStart = key; await persist();
        await uiWrite({ key, page: appPage, path: '/api/applications/start',
          validate(input) {
            exactFields(input, ['applicationId', 'requestId', 'reviewId']);
            assert.equal(input.applicationId, activeApplicationId); nativeRequestId(input.requestId);
            assert.equal(typeof input.reviewId, 'string');
          },
          setup: async () => {
            await until('Start control',async()=>appPage.getByRole('button',{name:'Review start',exact:true}).isEnabled(),Boolean);
            await appPage.getByRole('button',{name:'Review start',exact:true}).click();
          },
          click: () => appPage.getByRole('button',{name:'Start reviewed application',exact:true}).click(),
          recover: input => runtimeModel.applicationsStart(input),
        });
      }
      app = await until('Original S3 private launch',currentApplication,item=>Boolean(item?.current?.active && item.current.privateUrl &&
        item.current.privateLinks?.some(link=>link.id==='s3-releases')));
      validateApplication(app);
      delete journal.retained.pendingStart; await persist();
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
    await retainedValue('workspaceId', state.workspaceId);
    assert.ok(state.draft.revision>=1);
    await record('original-application-start',{applicationId:app.id,operationId:app.current.id,
      releaseId:app.release.id,workspaceId:state.workspaceId,authoringOrigin:new URL(initialLink).origin,
      releaseOrigin:new URL(releaseLink).origin,revision:state.draft.revision});

    const saveOriginal = async (key, selection, setup) => {
      const validate = input => {
        exactFields(input, ['expectedRevision','source','payment','origin','operationId']);
        originalId(input.operationId); assert.equal(input.expectedRevision, selection.expectedRevision);
        assert.deepEqual(input.source, selection.source); assert.deepEqual(input.payment, selection.payment);
        assert.equal(input.origin, selection.origin);
      };
      const result = await uiWrite({ key, page: merchantPage, path: '/api/save', validate, setup,
        click: () => merchantPage.locator('#save').click(),
        recover: async (input, completed) => {
          if (completed) return merchantApi('/api/revision?revision=' + completed.revision);
          const current = await merchantApi('/api/status');
          const saved = current.history.revisions.find(item => item.operationId === input.operationId);
          return saved ? merchantApi('/api/revision?revision=' + saved.revision) : merchantApi('/api/save', input);
        },
      });
      return result;
    };
    // Each saved revision is validated using the original public store fields.
    const validateSaved = (saved, selection, actionKey) => {
      assert.equal(saved.operationId, journal.retained.actions[actionKey].input.operationId);
      assert.equal(saved.revision, selection.expectedRevision + 1);
      assert.deepEqual(saved.source, selection.source); assert.deepEqual(saved.payment, selection.payment);
      assert.equal(saved.origin, selection.origin);
    };
    if (!journal.retained.authoredSelection) {
      const original = await merchantApi('/api/revision?revision=1');
      assert.deepEqual(original.payment, journal.retained.initialPayment);
      const source = structuredClone(original.source);
      source.objects.find(item => item.id === 'historical').description = 'Historical object supplied through the original managed merchant';
      await retainedValue('authoredSelection', { expectedRevision: original.revision, source,
        payment: { ...original.payment, amount: '1400' }, origin: original.origin });
    }
    const authoredSelection = journal.retained.authoredSelection;
    if (!journal.retained.authoredRevision) {
      const saved = await saveOriginal('authoredSave', authoredSelection, async () => {
        assert.equal((await merchantApi('/api/status')).draft.revision, authoredSelection.expectedRevision);
        await merchantPage.locator('#object-description').fill('Historical object supplied through the original managed merchant');
        await merchantPage.locator('#payment-json').fill(text(authoredSelection.payment));
      });
      validateSaved(saved, authoredSelection, 'authoredSave');
      journal.retained.authoredRevision = saved.revision; await record('authored-source-saved', { revision: saved.revision });
    }
    const authored = await merchantApi('/api/revision?revision=' + journal.retained.authoredRevision);
    assert.deepEqual(authored.source, authoredSelection.source); assert.deepEqual(authored.payment, authoredSelection.payment);
    if (!journal.retained.reviewId) {
      const review = await uiWrite({ key: 'objectReview', page: merchantPage, path: '/api/review',
        validate(input) {
          exactFields(input, ['revision','operationId']); originalId(input.operationId);
          assert.equal(input.revision, journal.retained.authoredRevision);
        },
        setup: async () => {
          await merchantPage.reload();
          await merchantPage.waitForFunction(revision => document.getElementById('revision-status').textContent === 'Current revision ' + revision,
            journal.retained.authoredRevision);
        },
        click: () => merchantPage.locator('#review').click(),
        recover: async (input, completed) => completed ?
          merchantApi('/api/review?reviewId=' + encodeURIComponent(completed.reviewId)) : merchantApi('/api/review', input),
      });
      assert.equal(review.revision, journal.retained.authoredRevision);
      journal.retained.reviewId = review.reviewId; await record('original-object-review', { reviewId: review.reviewId });
    }
    const reviewed = await merchantApi('/api/review?reviewId='+encodeURIComponent(journal.retained.reviewId));
    assert.equal(reviewed.revision,journal.retained.authoredRevision);
    if (!journal.retained.packageId) {
      const prepared = await uiWrite({ key: 'objectPackage', page: merchantPage, path: '/api/prepare',
        validate(input) {
          exactFields(input, ['revision','reviewId','operationId']); originalId(input.operationId);
          assert.equal(input.revision, reviewed.revision); assert.equal(input.reviewId, reviewed.reviewId);
        },
        setup: async () => {
          await merchantPage.reload();
          await until('Original review selection', () => merchantPage.locator('#reviews option').evaluateAll(nodes => nodes.map(node => node.value)),
            values => values.includes(reviewed.reviewId));
          await merchantPage.locator('#reviews').selectOption(reviewed.reviewId);
        },
        click: () => merchantPage.locator('#prepare').click(),
        recover: (input, completed) => completed ?
          merchantApi('/api/package?packageId=' + encodeURIComponent(completed.packageId)) : merchantApi('/api/prepare', input),
      });
      journal.retained.packageId = prepared.packageId; await record('original-object-package', { packageId: prepared.packageId });
    }
    const prepared = await merchantApi('/api/package?packageId='+encodeURIComponent(journal.retained.packageId));
    assert.equal(prepared.reviewId, reviewed.reviewId);
    const selectedSource = await read(join(prepared.directory,'source.json'));
    assert.equal(sha(await readFile(join(prepared.directory,'source.json'))),reviewed.selectionSha256);
    assert.equal(selectedSource.objects.find(item=>item.id==='historical').versionId,'v1');
    if (!journal.retained.releaseId) {
      const staged = await uiWrite({ key: 'objectStage', page: merchantPage, path: '/api/stage',
        validate(input) {
          exactFields(input, ['packageId','releaseId','runtime','operationId']); originalId(input.operationId);
          assert.equal(input.packageId, prepared.packageId); assert.equal(input.releaseId, 's3-managed-receiving-v1');
          assert.deepEqual(input.runtime, { port: 0 });
        },
        setup: async () => {
          await merchantPage.reload();
          await until('Original package selection', () => merchantPage.locator('#packages option').evaluateAll(nodes => nodes.map(node => node.value)),
            values => values.includes(prepared.packageId));
          await merchantPage.locator('#packages').selectOption(prepared.packageId);
          await merchantPage.locator('#release-id').fill('s3-managed-receiving-v1'); await merchantPage.locator('#seller-port').fill('0');
        },
        click: () => merchantPage.locator('#stage').click(),
        recover: input => merchantApi('/api/stage', input),
      });
      assert.equal(staged.packageId, prepared.packageId);
      journal.retained.releaseId = staged.release.id; await record('original-object-release', { releaseId: staged.release.id });
    }
    const releaseId = journal.retained.releaseId;
    let released = await releaseApi('/api/status');
    if (released.state.active!==releaseId) released = await releaseApi('/api/activate',{
      id:releaseId,expectedGeneration:released.state.generation,reason:'Original S3 Applications receiving'});
    released = await releaseApi('/api/run',{expectedGeneration:released.state.generation});
    const sellerListener = released.runtime.observed.listener;
    const customer = await merchantApi('/api/customer?releaseId='+encodeURIComponent(releaseId));
    await retainedValue('customerSelection', customer);
    if (!journal.retained.customerComplete) {
      if (!journal.delivery) {
        const beforeChallenge = fixture.counters().gets;
        const unpaid = await fetch(sellerListener+'/downloads/historical');
        assert.equal(unpaid.status,402);
        const challengeObjectGets = fixture.counters().gets-beforeChallenge; assert.equal(challengeObjectGets,0);
        const challenge = JSON.parse(Buffer.from(unpaid.headers.get('payment-required'),'base64').toString());
        assert.equal(challenge.resource.url,'https://objects.example/downloads/historical');
        const {createS3ObjectSource} = await module('sf30-seller-sdk/s3/source.mjs');
        objectSource = await createS3ObjectSource(selectedSource,{sdk:aws,env:fixture.env});
        const delivered = await objectSource.route('historical').handler({method:'GET',query:{},headers:{},body:null});
        assert.equal(delivered.status,200); assert.deepEqual(delivered.body,fixture.versions.get('v1'));
        await objectSource.close(); objectSource = null;
        journal.delivery = {releaseId,releaseDigest:customer.releaseDigest,challengeStatus:402,challengeObjectGets,
          objectBytes:delivered.body.length,objectSha256:sha(delivered.body)};
        await record('original-object-delivered', journal.delivery);
      }
      assert.equal(journal.delivery.releaseId, releaseId); assert.equal(journal.delivery.releaseDigest, customer.releaseDigest);
      assert.equal(journal.delivery.challengeObjectGets,0);
      await merchantPage.reload();
      await until('Original customer selection', () => merchantPage.locator('#customer-release option').evaluateAll(nodes => nodes.map(node => node.value)),
        values => values.includes(releaseId));
      await merchantPage.locator('#customer-release').selectOption(releaseId);
      for (const file of customer.files) {
        assert.ok(['objects.json','offers.json'].includes(file.file));
        const target = join(root, file.file);
        if (!await exists(target)) {
          const pending = join(root, file.file + '.download-' + journal.attemptId);
          const download = merchantPage.waitForEvent('download');
          await merchantPage.locator('#download-'+file.file.replace('.json','')).click();
          const response = await download; await response.saveAs(pending);
          const bytes = await readFile(pending);
          assert.equal(bytes.length,file.bytes); assert.equal(sha(bytes),file.sha256);
          await writeNew(target,bytes); await unlink(pending);
        }
        const bytes=await readFile(target);assert.equal(bytes.length,file.bytes);assert.equal(sha(bytes),file.sha256);
        await record('original-customer-file', { releaseId, releaseDigest: customer.releaseDigest, ...file });
      }
      journal.customer={releaseId,releaseDigest:customer.releaseDigest,files:customer.files};
      journal.screenshots ??= [];
      const capture = async (page, name) => {
        const existing = journal.screenshots.find(item => item.path === join(root,name+'.png'));
        if (existing) {
          const bytes = await readFile(existing.path);
          if (existing.sha256) { assert.equal(bytes.length,existing.bytes); assert.equal(sha(bytes),existing.sha256); }
          return;
        }
        journal.screenshots.push(await screenshot(page,root,name)); await persist();
      };
      await capture(appPage,'applications-desktop'); await capture(merchantPage,'merchant-desktop');
      await capture(releasePage,'release-console-desktop');
      await merchantPage.setViewportSize({width:390,height:844}); await capture(merchantPage,'merchant-mobile');
      await merchantPage.setViewportSize({width:1480,height:1000});
      // Preserve the first complete actual customer/provider observation.
      journal.retained.customerComplete = { releaseId, releaseDigest:customer.releaseDigest,
        reviewId:reviewed.reviewId, packageId:prepared.packageId,
        provider:structuredClone({...fixture.counters(),calls:fixture.calls}), completedAt:new Date().toISOString() };
      await record('original-merchant-customer',{reviewId:reviewed.reviewId,packageId:prepared.packageId,
        releaseId,releaseDigest:customer.releaseDigest,customerFiles:customer.files,delivery:journal.delivery});
    } else {
      assert.equal(journal.retained.customerComplete.releaseId,releaseId);
      assert.equal(journal.retained.customerComplete.releaseDigest,customer.releaseDigest);
      assert.deepEqual(journal.customer,customer);
      await verifyCustomer(journal.customer);
    }

    state = await merchantApi('/api/status');
    if (!journal.retained.dirtySelection) {
      assert.equal(state.draft.revision,journal.retained.authoredRevision);
      const source = structuredClone(state.draft.source);
      source.objects.find(item=>item.id==='historical').description='Retained unfinished source edit after managed Stop';
      await retainedValue('dirtySelection', { expectedRevision: state.draft.revision, source,
        payment: {...state.draft.payment,amount:'1700'}, origin: state.draft.origin });
    }
    const dirtySelection = journal.retained.dirtySelection;
    const dirtySourceText = text(dirtySelection.source), dirtyPaymentText = text(dirtySelection.payment);
    const fillDirty = async () => {
      assert.equal((await merchantApi('/api/status')).draft.revision,dirtySelection.expectedRevision);
      if (!await merchantPage.locator('#source-json').isVisible())
        await merchantPage.getByText('Complete source JSON',{exact:true}).click();
      await merchantPage.locator('#source-json').fill(dirtySourceText);
      await merchantPage.locator('#payment-json').fill(dirtyPaymentText);
    };
    if (!journal.retained.reopenProof) {
      await fillDirty();
      const dirtyBefore=await merchantPage.evaluate(()=>JSON.parse(sessionStorage.getItem('sf30.s3.draft')));
      assert.equal(dirtyBefore.dirty,true);assert.equal(dirtyBefore.sourceText,dirtySourceText);assert.equal(dirtyBefore.paymentText,dirtyPaymentText);
      assert.equal(dirtyBefore.expectedRevision,dirtySelection.expectedRevision);
      journal.retained.dirtyDraft=dirtyBefore;
      // Record this actual tab's draft before archiving inputs or stopping it.
      await record('original-dirty-tab',{operationId:initialRun.id,expectedRevision:dirtySelection.expectedRevision});
      for (const [path, value] of [[sourcePath,journal.retained.initialSource],[paymentPath,journal.retained.initialPayment]]) {
        if (await exists(path+'.archived')) await retain(path+'.archived',value);
        if (await exists(path)) {
          await retain(path,value);
          if (await exists(path+'.archived')) await unlink(path);
          else await rename(path,path+'.archived');
        }
        await retain(path+'.archived',value);
      }
      const providerBeforeReopen=structuredClone(fixture.counters());
      await appPage.getByRole('button',{name:'Stop application',exact:true}).click();
      const stopped=await until('Original managed merchant drain',currentApplication,item=>item?.current?.id===initialRun.id&&!item.current.active&&item.phase==='STOPPED');
      for(const url of [initialLink,releaseLink,sellerListener]) await until('Original listener closes',()=>listenerClosed(url),Boolean,20000);
      await releasePage.close();releasePage=null;
      const {inspectS3WorkspaceStore}=await module('sf30-seller-sdk/s3/workspace/store.mjs');
      const stoppedStore=await inspectS3WorkspaceStore(merchantDirectory);
      assert.equal(stoppedStore.workspaceId,journal.retained.workspaceId);
      assert.equal(stoppedStore.authoringPort,Number(new URL(initialLink).port));
      await record('applications-stop-drains-owned-merchant',{operationId:stopped.current.id,
        authoringPort:stoppedStore.authoringPort,revision:stoppedStore.revision,dirtyDraftRetained:true,archivedInitialFiles:true});

      // This is the same live tab, navigating to the new original URL. A
      // receiving-process restart repeats only this unfinished browser phase;
      // it never claims continuity with a browser that no longer exists.
      app=await start();assert.notEqual(app.current.id,initialRun.id);
      const restartedLink=app.current.privateUrl;
      assert.equal(new URL(restartedLink).origin,new URL(initialLink).origin);
      assert.notEqual(new URL(restartedLink).hash,new URL(initialLink).hash);
      const runRequest=await read(join(workspaceDirectory,'operations',app.current.id,'request.json'));
      assert.equal(runRequest.args.includes('--source'),false);assert.equal(runRequest.args.includes('--payment'),false);
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
      assert.equal(reopened.workspaceId,journal.retained.workspaceId);
      assert.equal(reopened.draft.revision,dirtySelection.expectedRevision);
      assert.deepEqual(await merchantApi('/api/review?reviewId='+encodeURIComponent(reviewed.reviewId)),reviewed);
      assert.deepEqual(await merchantApi('/api/customer?releaseId='+encodeURIComponent(releaseId)),customer);
      assert.deepEqual(fixture.counters(),providerBeforeReopen);
      await retainedValue('reopenProof', {applicationId:app.id,firstOperationId:initialRun.id,
        secondOperationId:app.current.id,workspaceId:reopened.workspaceId,revision:reopened.draft.revision,
        authoringOrigin:new URL(restartedLink).origin,reviewId:reviewed.reviewId,releaseId,
        providerBeforeReopen,providerAfterReopen:structuredClone(fixture.counters()),
        providerReadsDuringReopen:0,sourceAndPaymentRestored:true,observedAt:new Date().toISOString()});
      await record('same-origin-dirty-tab-observed',journal.retained.reopenProof);
    }
    const proof=journal.retained.reopenProof;
    assert.equal(proof.workspaceId,journal.retained.workspaceId);assert.equal(proof.reviewId,reviewed.reviewId);
    assert.equal(proof.releaseId,releaseId);assert.equal(proof.revision,dirtySelection.expectedRevision);
    const savedDirty = await saveOriginal('dirtySave',dirtySelection,fillDirty);
    validateSaved(savedDirty,dirtySelection,'dirtySave');
    const finalState=await merchantApi('/api/status');
    assert.equal(finalState.draft.revision,savedDirty.revision);
    assert.deepEqual(finalState.draft.source,dirtySelection.source);assert.deepEqual(finalState.draft.payment,dirtySelection.payment);
    await retainedValue('finalDraft',savedDirty);
    const nextConsole=await releaseApi('/api/status');
    assert.equal(nextConsole.state.active,releaseId);
    const restartedSeller=await releaseApi('/api/run',{expectedGeneration:nextConsole.state.generation});
    assert.equal((await fetch(restartedSeller.runtime.observed.listener+'/downloads/historical')).status,402);
    await record('same-origin-dirty-tab-reopen',{...proof,revision:finalState.draft.revision});

    await appPage.getByRole('button',{name:'Stop application',exact:true}).click();
    const finalApp=await until('Final original Stop',currentApplication,item=>!item?.current?.active&&item?.phase==='STOPPED');
    await until('Final seller closes',()=>listenerClosed(restartedSeller.runtime.observed.listener),Boolean,20000);
    assert.deepEqual(pageErrors,[]);
    assert.equal(fixture.counters().denied,0);
    journal.application={applicationId:finalApp.id,revision:finalApp.revision,phase:finalApp.phase,
      runtime:finalApp.runtime,releaseId:finalApp.release.id,runs:finalApp.runs.map(item=>({id:item.id,phase:item.phase,active:item.active}))};
    journal.provider ??= structuredClone({...fixture.counters(),calls:fixture.calls});
    journal.pageErrors=pageErrors;journal.consoleErrors=consoleErrors;
    journal.retained.journeyComplete={applicationId:finalApp.id,finalPhase:finalApp.phase,revision:finalState.draft.revision};
    await record('journey-complete',journal.retained.journeyComplete);
    workSucceeded=true;
    return journal;
  } catch(error) {
    primaryError=error;
    journal.state='FAILED';journal.error={name:error.name,code:error.code??null,message:error.message,stack:error.stack};
    journal.pageErrors=pageErrors;
    if(appPage&&!appPage.isClosed())journal.applicationMessage=await appPage.locator('#message').textContent().catch(()=>null);
    if(merchantPage&&!merchantPage.isClosed())journal.merchantMessage=await merchantPage.locator('#notice').textContent().catch(()=>null);
    throw error;
  } finally {
    const cleanupErrors=[];
    const drain=async(label,action)=>{
      try{await action();}
      catch(error){cleanupErrors.push(error);consoleErrors.push(label+': '+error.message);}
    };
    await drain('original object source',async()=>{await objectSource?.close();});
    await drain('original managed application',async()=>{
      if(!runtimeModel||!activeApplicationId)return;
      const app=(await runtimeModel.applicationsState()).applications.find(item=>item.id===activeApplicationId);
      assert.ok(app,'The original application is missing during cleanup');
      if(app.current&&(app.current.active||['PENDING','QUEUED','RUNNING','INTERRUPTED'].includes(app.current.phase))){
        await runtimeModel.applicationsStop({applicationId:activeApplicationId,operationId:app.current.id});
        await until('Cleanup original Stop',async()=>(await runtimeModel.applicationsState()).applications.find(item=>item.id===activeApplicationId),
          item=>Boolean(item&&!item.current?.active&&!['PENDING','QUEUED','RUNNING','INTERRUPTED'].includes(item.current?.phase)),15000);
      }
    });
    await drain('browser',async()=>{await browser?.close();});
    await drain('Applications console',async()=>{await consoleServer?.close();});
    await drain('Applications model',async()=>{await runtimeModel?.close?.();});
    await drain('original signed provider',async()=>{await fixture?.close();});
    for(const key of awsNames)if(envBefore[key]===undefined)delete process.env[key];else process.env[key]=envBefore[key];
    if(tempBefore===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=tempBefore;
    journal.cleanup={completedAt:new Date().toISOString(),errors:consoleErrors};
    journal.consoleErrors=consoleErrors;
    if(workSucceeded&&!cleanupErrors.length){
      journal.state='COMPLETE';journal.completedAt=new Date().toISOString();delete journal.error;
      journal.phase='complete';journal.steps.push({phase:'complete',at:journal.completedAt,...journal.retained.journeyComplete});
    }else if(cleanupErrors.length){
      journal.state='FAILED';
      journal.cleanupFailures=cleanupErrors.map(error=>({name:error.name,code:error.code??null,message:error.message}));
    }
    let persistenceError;
    try{await persist();}catch(error){persistenceError=error;}
    if(cleanupErrors.length||persistenceError){
      throw new AggregateError([...(primaryError?[primaryError]:[]),...cleanupErrors,...(persistenceError?[persistenceError]:[])],
        'The original receiving result or owned cleanup is unfinished; continue this same operation.');
    }
    if(workSucceeded)process.stdout.write(text({phase:'complete',state:journal.state}));
  }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const config=await read(resolve(process.argv[2]));
  try{const result=await receiveS3MerchantApplication(config);process.stdout.write(text({state:result.state,applicationId:result.application?.applicationId}));}
  catch(error){process.stderr.write((error.stack??String(error))+'\n');process.exitCode=1;}
}
