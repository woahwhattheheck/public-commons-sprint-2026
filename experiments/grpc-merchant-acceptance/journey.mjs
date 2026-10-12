#!/usr/bin/env node
// One retained native operator journey. Uses original SDK, merchant, release controls and browser.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, rename, open, readdir, rm } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const ROOT = resolve(process.env.GRPC_JOURNEY_ROOT ?? dirname(fileURLToPath(import.meta.url)));
const SOURCE = resolve(process.env.GRPC_JOURNEY_SOURCE ?? process.argv[2] ?? join(ROOT, 'source'));
const SDK = join(SOURCE, 'stellar/scf-starforge-20261009/sf30-seller-sdk');
const stateDirectory = join(ROOT, 'workspace');
const require = createRequire(join(SOURCE, 'package.json'));
const hash = value => createHash('sha256').update(value).digest('hex');
const pretty = value => JSON.stringify(value, null, 2) + '\n';
const canonicalValue = value => Array.isArray(value) ? value.map(canonicalValue) :
  value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])])) : value;
const canonical = value => JSON.stringify(canonicalValue(value));
function resolveLocalSchema(document, schema) {
  const visited = new Set();
  while (schema && typeof schema === 'object' && typeof schema.$ref === 'string') {
    assert.ok(schema.$ref.startsWith('#/'), 'The native response schema must use a local reference.');
    assert.ok(!visited.has(schema.$ref), 'The root response reference must terminate.');
    visited.add(schema.$ref);
    const pointer = decodeURIComponent(schema.$ref.slice(1)).split('/').slice(1)
      .map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
    schema = pointer.reduce((node, key) => {
      assert.ok(node !== null && typeof node === 'object' && Object.hasOwn(node, key),
        'A native OpenAPI local reference must resolve: ' + key);
      return node[key];
    }, document);
  }
  return schema;
}
function responseContract(document) {
  const emitted = document.paths['/summary'].post.responses['2XX'].content['application/json'].schema;
  const message = resolveLocalSchema(document, emitted);
  for (const name of ['record_id', 'observed_sequence', 'amount', 'evidence']) {
    assert.ok(Object.hasOwn(message.properties, name), 'The live protobuf response retains ' + name);
    assert.equal(resolveLocalSchema(document, message.properties[name]).type, 'string');
  }
  return { emitted, message };
}
const importSource = relative => import(pathToFileURL(join(SOURCE, relative)).href);
const delay = ms => new Promise(done => setTimeout(done, ms));
await mkdir(ROOT, { recursive: true }); await mkdir(join(ROOT, 'downloads'), { recursive: true });
async function atomic(path, data) {
  const temporary = path + '.writing';
  const file = await open(temporary, 'w', 0o600);
  try { await file.writeFile(pretty(data)); await file.sync(); } finally { await file.close(); }
  await rename(temporary, path);
  const directory = await open(dirname(path), 'r'); try { await directory.sync(); } finally { await directory.close(); }
}
async function optional(path) { try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
const resultFile = join(ROOT, 'result.json');
const receipt = await optional(resultFile) ?? {
  schema: 'stellar-forge.grpc-native-journey.v1', operation: 'SCF-GRPC-MERCHANT-20261012-6F7C',
  startedAt: new Date().toISOString(), phases: {}, deliveries: {}, nativeCalls: [], facilitator: [],
  semantics: 'Actual local gRPC and original native x402 SDK with a controlled loopback facilitator; zero wallet or chain payments.',
};
async function persist() { await atomic(resultFile, receipt); }
async function phase(name, action) {
  if (receipt.phases[name]?.complete) return receipt.phases[name].value;
  receipt.currentPhase = name; await persist();
  const value = await action();
  receipt.phases[name] = { complete: true, at: new Date().toISOString(), value: value ?? null };
  await persist(); console.log(JSON.stringify({ phase: name, complete: true })); return value;
}
async function waitUntil(action, expected, description, timeout = 60000) {
  const end = Date.now() + timeout; let value, last;
  while (Date.now() < end) {
    try { value = await action(); if (expected(value)) return value; } catch (error) { last = error; }
    await delay(100);
  }
  throw new Error(description + ': ' + (last?.message ?? JSON.stringify(value)));
}
let example, facilitator, workspace, browser, page, releasePage, releaseURL, releaseToken;
let heldVerification, releaseVerification, enteredVerification;
const errors = [];
const { startExample } = await importSource('stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/examples/server.mjs');
const { startGrpcWorkspace } = await importSource('stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/workspace/server.mjs');
const { nativeFactoryFor } = await importSource('stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/start.mjs');
const { readGrpcPrepared, CUSTOMER_FILES } = await importSource('stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/prepare.mjs');
const releaseAPI = await importSource('stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs');
const { encodePaymentSignatureHeader } = require('@x402/core/http');
const { chromium } = await import(pathToFileURL(resolve(process.env.GRPC_PLAYWRIGHT_ENTRY ??
  '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href);
const authorization = 'local-example-' + hash(receipt.operation).slice(0,24);
let workspaceToken, workspaceOrigin;
const jsonRequest = async (origin, token, action, data, header = 'x-workspace-token') => {
  const response = await fetch(origin + '/api/' + action, {
    headers: { [header]: token, ...(data === undefined ? {} : { 'content-type': 'application/json' }) },
    method: data === undefined ? 'GET' : 'POST',
    ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(120000),
  });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.detail ?? value.message ?? value.error), { status: response.status, value });
  return value;
};
const api = (name, value) => jsonRequest(workspaceOrigin, workspaceToken, name, value);
const releaseCall = (name, value) => jsonRequest(new URL(releaseURL).origin, releaseToken, name, value, 'x-release-token');
function attach(p) { p.on('pageerror', error => errors.push(error.message)); return p; }
async function settled(p = page) { await p.waitForFunction(() => document.body.dataset.busy !== 'true', undefined, { timeout: 120000 }); }
async function click(selector, p = page) { await p.locator(selector).click(); await settled(p); }
async function view(name) { await click('nav button[data-view="' + name + '"]'); }
async function loadWorkspacePage() {
  page = attach(await browser.newPage({ viewport: { width: 1280, height: 960 } }));
  await page.goto(workspace.url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('notice').textContent.includes('Private workspace ready'));
}
async function reopenEditor() {
  await page.close({ runBeforeUnload: false }); await loadWorkspacePage();
}
async function method() { await view('methods'); await page.locator('#method-list button').first().click(); await settled(); }
const exampleInput = { account_id: '18446744073709551615', day: '2026-10-11', include_voided: false, labels: ['original'] };
function validateOutput(output) {
  assert.equal(output.record_id, '18446744073709551615');
  assert.equal(output.amount, '123456789012345678901234567890.1234567');
  assert.equal(output.observed_sequence, '-9223372036854775808');
  assert.equal(Buffer.from(output.evidence, 'base64').toString(), 'original-native-grpc-example');
}
async function buy(name, origin, amount, input = exampleInput) {
  const retained = receipt.deliveries[name];
  if (retained?.phase === 'COMPLETED') return retained;
  assert.ok(!retained, 'An unresolved original delivery must be reconciled before its same name is operated again.');
  const requestBody = JSON.stringify(input);
  const challenge = await fetch(origin + '/summary', { method: 'POST', headers: { 'content-type': 'application/json' }, body: requestBody });
  assert.equal(challenge.status, 402);
  const required = JSON.parse(Buffer.from(challenge.headers.get('payment-required'), 'base64').toString());
  assert.equal(required.accepts[0].amount, amount);
  assert.equal(required.accepts[1].amount, '9007199254740993');
  const id = randomUUID();
  receipt.deliveries[name] = { id, phase: 'ATTEMPTED', origin, amount, input, startedAt: new Date().toISOString() };
  await persist();
  const signature = encodePaymentSignatureHeader({ x402Version: 2, resource: required.resource,
    accepted: required.accepts[0], extensions: required.extensions, payload: { localGrpcJourney: id } });
  const response = await fetch(origin + '/summary', { method: 'POST',
    headers: { 'content-type': 'application/json', 'payment-signature': signature }, body: requestBody,
    signal: AbortSignal.timeout(120000) });
  const raw = Buffer.from(await response.arrayBuffer());
  assert.equal(response.status, 200, raw.toString());
  const output = JSON.parse(raw); validateOutput(output);
  const filename = 'delivery-' + name + '.json'; await writeFile(join(ROOT, 'downloads', filename), raw, { mode: 0o600 });
  Object.assign(receipt.deliveries[name], { phase: 'COMPLETED', status: response.status,
    bytes: raw.length, sha256: hash(raw), output, filename, completedAt: new Date().toISOString() });
  await persist(); return receipt.deliveries[name];
}
async function openReleasePage() {
  const opened = await api('release-console', {}); releaseURL = opened.url; releaseToken = new URL(releaseURL).hash.slice(1);
  releasePage = attach(await browser.newPage({ viewport: { width: 1280, height: 960 } }));
  await releasePage.goto(releaseURL, { waitUntil: 'domcontentloaded' });
  await waitUntil(() => releaseCall('status'), state => Boolean(state.state), 'Release console ready');
}
async function chooseRelease(id) {
  await releasePage.locator('#refresh').click();
  await releasePage.locator('#release-list button').filter({ hasText: id }).click();
  await releasePage.waitForFunction(() => !document.getElementById('activate').disabled);
}
async function selectRelease(id) {
  let status = await releaseCall('status');
  if (status.state.active !== id) {
    await chooseRelease(id); await releasePage.locator('#reason').fill('Native gRPC operator ' + id);
    await releasePage.locator('#activate').click();
    status = await waitUntil(() => releaseCall('status'), s => s.state.active === id && !s.console.busy, 'Release selection');
  }
  return status;
}
async function startSelected({ restart = false } = {}) {
  const s = await releaseCall('status');
  if (s.runtime.state === 'RUNNING' && s.runtime.observed.releaseId === s.state.active) return s;
  if (restart) await releasePage.locator('#restart').click(); else await releasePage.locator('#start').click();
  return waitUntil(() => releaseCall('status'), s => s.runtime.state === 'RUNNING' && !s.console.busy, 'Native release readiness', 120000);
}
try {
  await phase('source-binding', async () => {
    const paths = [
      ...await readdir(join(SDK, 'grpc')).then(files => files.filter(f=>f.endsWith('.mjs')).map(f=>'stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/'+f)),
      'stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/workspace/model.mjs',
      'stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/workspace/server.mjs',
      'stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/workspace/public/app.mjs',
      'stellar/scf-starforge-20261009/sf82-seller-pilot/release-grpc.mjs',
      'stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs',
      'stellar/scf-starforge-20261009/sf82-seller-pilot/release-child.mjs',
      'stellar/scf-starforge-20261009/sf30-seller-sdk/developer-portal.mjs',
    ];
    const files = {};
    for (const path of paths) { const bytes = await readFile(join(SOURCE,path)); files[path] = { bytes: bytes.length, sha256: hash(bytes) }; }
    await atomic(join(ROOT,'executed-source.json'),files);
    return { source: SOURCE, node: process.version, files: paths.length, digest: hash(JSON.stringify(files)) };
  });
  example = await startExample({ port: receipt.examplePort ?? 0, authorization });
  receipt.examplePort = Number(example.target.split(':').at(-1)); await persist();
  facilitator = createServer(async (req, res) => {
    try {
      const chunks=[]; for await (const chunk of req) chunks.push(chunk);
      const request = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
      let value;
      if (req.url === '/supported') value = { kinds: [{ x402Version: 2, scheme: 'exact', network: 'stellar:testnet' }], extensions: ['bazaar'], signers: {} };
      else if (req.url === '/verify') {
        receipt.facilitator.push({ kind: 'verify', id: request.paymentPayload?.payload?.localGrpcJourney ?? null, at: new Date().toISOString() }); await persist();
        if (heldVerification) { enteredVerification(); await heldVerification; heldVerification=null; }
        value={ isValid: true, payer:'LOCAL_NATIVE_GRPC_FIXTURE' };
      } else if (req.url === '/settle') {
        const transaction=hash('LOCAL_NATIVE_GRPC_FIXTURE:'+receipt.facilitator.length);
        receipt.facilitator.push({kind:'settle',transaction,at:new Date().toISOString()}); await persist();
        value={success:true,network:'stellar:testnet',transaction,payer:'LOCAL_NATIVE_GRPC_FIXTURE'};
      } else { res.writeHead(404);res.end();return; }
      res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));
    } catch (error) { res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:error.message})); }
  });
  await new Promise(done=>facilitator.listen(receipt.facilitatorPort??0,'127.0.0.1',done));
  receipt.facilitatorPort=facilitator.address().port;await persist();
  const facilitatorURL='http://127.0.0.1:'+receipt.facilitatorPort;
  const options={stateDirectory,port:0,sellerPort:0,operationsPort:0,nativeFactory:await nativeFactoryFor(facilitatorURL,true),
    env:{...process.env,GRPC_DEMO_AUTHORIZATION:authorization},
    releaseRuntime:{port:0,facilitator:facilitatorURL,allowLocalFacilitator:true}};
  workspace=await startGrpcWorkspace(options); workspaceOrigin=workspace.origin; workspaceToken=new URL(workspace.url).hash.slice(1);
  browser=await chromium.launch({executablePath:process.env.GRPC_CHROMIUM_EXECUTABLE??
    '/workspace/scratch/7573d13065d5/aurora_ops/browser-runtime/tmp/chromium',headless:true,
    args:['--no-sandbox','--single-process','--no-zygote','--disable-gpu','--disable-dev-shm-usage',
      '--renderer-process-limit=1','--js-flags=--max-old-space-size=128','--disable-background-networking']});
  await loadWorkspacePage();
  await phase('browser-source-and-editor',async()=>{
    let state=await api('state');
    if (!state.currentRevision) {
      await click('#example');
      await page.locator('#target').fill(example.target);
      await page.locator('#metadata').fill(JSON.stringify([{name:'authorization',valueEnv:'GRPC_DEMO_AUTHORIZATION'}]));
      const exampleConfig=await api('example');
      const plan=structuredClone(exampleConfig.plan);
      const first={...plan.payment};
      plan.paymentOptions=[first,{...first,asset:'UNVERIFIED_DEMO_SECOND_ASSET',amount:'9007199254740993'}];delete plan.payment;
      plan.routes[0].example=exampleInput;
      await view('methods');await page.locator('#plan').fill(pretty(plan));await click('#apply-plan');
      await view('source');await click('#capture');
      state=await api('state');assert.ok(state.currentRevision);
    }
    await method();
    const initialCalls=example.calls.length;
    await page.getByLabel('labels',{exact:true}).fill('[');
    await click('#call');assert.equal(example.calls.length,initialCalls);
    assert.match(await page.locator('#notice').innerText(),/JSON|Unexpected|property|token|position|visible/i);
    await page.getByLabel('labels',{exact:true}).fill('["original"]');
    await page.locator('#description').fill('Unapplied route wording');
    page.once('dialog',d=>d.dismiss());
    await page.locator('#method-list button').first().click();await settled();
    assert.equal(await page.locator('#description').inputValue(),'Unapplied route wording');
    page.once('dialog',d=>d.accept());
    await page.locator('#method-list button').first().click();await settled();
    await page.locator('#plan').fill('{"routes":[');
    assert.equal(await page.locator('#save').isDisabled(),true);
    await click('#refresh');assert.equal(await page.locator('#plan').inputValue(),'{"routes":[');
    page.once('dialog',d=>d.accept());await click('#discard-plan');
    await page.screenshot({path:join(ROOT,'workspace-methods.png'),fullPage:true});
    const other=attach(await browser.newPage({viewport:{width:1280,height:960}}));
    await other.goto(workspace.url);await other.waitForFunction(()=>document.getElementById('notice').textContent.includes('Private workspace ready'));
    await other.locator('#title').fill('Native gRPC merchant v1');
    await click('#save',other);
    const changed=(await api('state')).currentRevision;
    await page.locator('#title').fill('Stale editor title');
    await click('#refresh');await click('#save');
    assert.match(await page.locator('#notice').innerText(),/CONFLICT/);assert.equal((await api('state')).currentRevision,changed);
    await other.close();await reopenEditor();await method();
    const before=example.calls.length;
    const callResponse=page.waitForResponse(r=>r.url()===workspaceOrigin+'/api/call'&&r.request().method()==='POST');
    await click('#call');const response=await callResponse;const call=await response.json();
    assert.equal(call.phase,'COMPLETED');assert.equal(example.calls.length,before+1);validateOutput(call.output);
    const again=await api('call',{id:call.id,revision:call.revision,method:call.method,input:call.input});
    assert.equal(again.responseSha256,call.responseSha256);assert.equal(example.calls.length,before+1);
    const attemptPath=join(stateDirectory,'attempts',call.id+'.json');
    const attempted=JSON.parse(await readFile(attemptPath,'utf8'));attempted.phase='ATTEMPTED';delete attempted.responseSha256;delete attempted.finishedAt;
    await atomic(attemptPath,attempted);
    const recovered=await api('attempt',{id:call.id});assert.equal(recovered.phase,'COMPLETED');assert.equal(example.calls.length,before+1);
    receipt.callId=call.id;await persist();
    await view('operate');await click('#review');
    assert.equal(example.calls.length,before+1);
    return {revision:changed,invalidTypedInputBlocked:true,dirtyReplacementCancelled:true,planTextRetained:true,
      twoWindowConflict:true,callId:call.id,callSHA256:call.responseSha256,lostFinalReceiptRecovered:true};
  });
  await phase('prepare-native-delivery-and-downloads',async()=>{
    await view('operate');
    let state=await api('state'),prepared=state.prepared.find(p=>p.revision===state.currentRevision);
    if(!prepared){await click('#prepare');state=await api('state');prepared=state.prepared.find(p=>p.revision===state.currentRevision);}
    assert.ok(prepared);receipt.v1Prepared=prepared.id;receipt.v1Revision=prepared.revision;await persist();
    await atomic(join(stateDirectory,'intents',prepared.id+'.json'),{schema:'stellar-forge.grpc-workspace-prepare.v1',
      id:prepared.id,revision:prepared.revision,createdAt:prepared.createdAt});
    await click('#refresh');await page.locator('#intents button').click();await settled();
    assert.equal((await api('state')).intents.length,0);
    const card=page.locator('#prepared .item').filter({hasText:prepared.id.slice(0,12)});
    await card.getByRole('button',{name:'Run merchant',exact:true}).click();await settled();
    const running=(await api('state')).runtime.active;assert.equal(running.phase,'RUNNING');assert.equal(running.mode,'NATIVE_X402');
    const calls=example.calls.length,verifies=receipt.facilitator.filter(x=>x.kind==='verify').length;
    const invalid=await fetch(running.url+'/summary',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({...exampleInput,account_id:'18446744073709551616'})});
    assert.equal(invalid.status,422);assert.equal(example.calls.length,calls);
    assert.equal(receipt.facilitator.filter(x=>x.kind==='verify').length,verifies);
    const challenge=await fetch(running.url+'/summary',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(exampleInput)});
    assert.equal(challenge.status,402);assert.equal(example.calls.length,calls);
    await buy('workspace-v1',running.url,'25000');
    const openapi=await (await fetch(running.openapi)).json();
    const liveContract=responseContract(openapi);
    const nativePrepared=await readGrpcPrepared(join(stateDirectory,'prepared',prepared.id));
    const preparedOpenapi=JSON.parse(await readFile(join(nativePrepared.directory, 'openapi.json'), 'utf8'));
    const preparedContract=responseContract(preparedOpenapi);
    assert.deepEqual(liveContract.emitted,preparedContract.emitted);
    assert.deepEqual(liveContract.message,preparedContract.message);
    const preparedManifestBytes=await readFile(join(nativePrepared.directory,'prepared.json'));
    const originalFiles={...nativePrepared.manifest.files,'prepared.json':{bytes:preparedManifestBytes.length,sha256:hash(preparedManifestBytes)}};
    const packageFiles=Object.entries(originalFiles).map(([file,value])=>({file:'grpc/package/'+file,...value})).sort((a,b)=>a.file.localeCompare(b.file));
    receipt.v1ReleaseBinding={packageSha256:hash(canonical(packageFiles)),protoSha256:nativePrepared.protoSource.sha256,
      sourceConfigSha256:nativePrepared.manifest.files['source.json'].sha256,
      planSha256:nativePrepared.manifest.files['merchant-plan.json'].sha256,
      bindingsSha256:nativePrepared.manifest.files['bindings.json'].sha256};
    await persist();
    const downloadPromise=page.waitForEvent('download');
    await card.getByRole('button',{name:'Customer client archive',exact:true}).click();
    const downloaded=await downloadPromise;const archive=join(ROOT,'downloads','grpc-customer-client.tar.gz');await downloaded.saveAs(archive);await settled();
    const {stdout}=await exec('tar',['-tzf',archive]);const names=stdout.trim().split('\n').sort();assert.deepEqual(names,[...CUSTOMER_FILES].sort());
    const operationsPromise=page.waitForEvent('popup');
    await page.getByRole('link',{name:'Operations',exact:true}).click();
    const operations=attach(await operationsPromise);await operations.waitForLoadState('domcontentloaded');
    assert.ok(!(await operations.locator('body').innerText()).includes('LOCAL_ORIGIN_REQUIRED'));
    await operations.screenshot({path:join(ROOT,'merchant-operations.png'),fullPage:true});await operations.close();
    await page.screenshot({path:join(ROOT,'workspace-delivery.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:join(ROOT,'workspace-mobile.png'),fullPage:true});
    await page.setViewportSize({width:1280,height:960});
    await click('#stop');assert.equal((await api('state')).runtime.active,null);
    return {preparedId:prepared.id,sourceRetained:true,consumedPrepareIntentRecovered:true,
      earlyInvalidRequestRejected:true,typedLiveResponse:true,customerFiles:names,archiveSHA256:hash(await readFile(archive))};
  });
  await phase('retained-release-v1',async()=>{
    await view('operate');await click('#refresh');
    const card=page.locator('#prepared .item').filter({hasText:receipt.v1Prepared.slice(0,12)});
    const releases=await releaseAPI.listReleases(join(stateDirectory,'merchant-releases')).catch(e=>{if(e.code==='ENOENT')return {releases:[]};throw e;});
    if(!releases.releases.some(r=>r.id==='grpc-v1')){
      await card.getByLabel('Release name',{exact:true}).fill('grpc-v1');
      await card.getByRole('button',{name:'Stage in release control',exact:true}).click();await settled();
    }
    const preparedPath=join(stateDirectory,'prepared',receipt.v1Prepared),movedPath=preparedPath+'.retired-origin';
    try{await rename(preparedPath,movedPath);}catch(e){if(e.code!=='ENOENT')throw e;}
    const popup=page.waitForEvent('popup');await page.locator('#release-console').click();releasePage=attach(await popup);
    await settled();releaseURL=(await api('release-console',{})).url;releaseToken=new URL(releaseURL).hash.slice(1);
    await releasePage.waitForLoadState('domcontentloaded');
    await selectRelease('grpc-v1');const running=await startSelected();
    const inspected=await releaseAPI.inspectRelease(join(stateDirectory,'merchant-releases'),'grpc-v1');
    assert.equal(inspected.source.kind,'GRPC_MERCHANT_PACKAGE');
    assert.equal(inspected.grpc.schema,'stellar-forge.grpc-release-source.v1');
    for(const [field,expected] of Object.entries(receipt.v1ReleaseBinding)){
      assert.equal(inspected.grpc[field],expected,field);
      assert.equal(inspected.source[field],expected,field+' source');
    }
    const {executionSha256,...execution}=inspected.grpc;
    assert.equal(executionSha256,hash(canonical(execution)));
    assert.equal(inspected.source.executionSha256,executionSha256);
    await buy('retained-v1',running.runtime.observed.listener,'25000');
    receipt.v1ReleaseDigest=running.runtime.observed.releaseDigest;await persist();
    await releasePage.screenshot({path:join(ROOT,'release-v1.png'),fullPage:true});
    return {releaseId:'grpc-v1',digest:receipt.v1ReleaseDigest,formerPreparedUnavailable:true};
  });
  if(!releasePage||releasePage.isClosed())await openReleasePage();
  await phase('changed-release-drain-and-rollback',async()=>{
    let status=await selectRelease('grpc-v1');status=await startSelected();
    const original=await api('open',{revision:receipt.v1Revision});
    const plan=structuredClone(original.plan);
    plan.paymentOptions[0].amount='27500';plan.routes[0].description+=' Retained second release.';
    const current=await api('state');
    const saved=await api('save',{source:original.source,protoSource:original.protoSource,plan,baseRevision:current.currentRevision,title:'Native gRPC merchant v2'});
    const prepared=await api('prepare',{id:receipt.v2PrepareId??=randomUUID(),revision:saved.id});
    receipt.v2Revision=saved.id;receipt.v2Prepared=prepared.id;await persist();
    await api('stage',{id:prepared.id,releaseId:'grpc-v2'});
    const comparison=await releaseAPI.compareReleases(join(stateDirectory,'merchant-releases'),'grpc-v1','grpc-v2');
    assert.ok(JSON.stringify(comparison).includes('27500'));
    const entered=new Promise(done=>{enteredVerification=done;});
    heldVerification=new Promise(done=>{releaseVerification=done;});
    const inFlight=buy('drained-original-v1',status.runtime.observed.listener,'25000');
    await entered;
    await selectRelease('grpc-v2');
    const restart=releaseCall('restart',{expectedGeneration:(await releaseCall('status')).state.generation,
      instanceId:(await releaseCall('status')).console.instanceId});
    let restarted=false;restart.then(()=>{restarted=true;},()=>{restarted=true;});
    await delay(250);assert.equal(restarted,false);releaseVerification();releaseVerification=null;
    await inFlight;await restart;
    status=await waitUntil(()=>releaseCall('status'),s=>s.runtime.state==='RUNNING'&&s.runtime.observed.releaseId==='grpc-v2','Changed native release');
    await buy('retained-v2',status.runtime.observed.listener,'27500');
    await releasePage.locator('#refresh').click();await releasePage.locator('#rollback').click();
    await waitUntil(()=>releaseCall('status'),s=>s.state.active==='grpc-v1'&&!s.console.busy,'Original rollback selection');
    status=await startSelected({restart:true});
    await buy('rollback-v1',status.runtime.observed.listener,'25000');
    assert.equal(status.runtime.observed.releaseDigest,receipt.v1ReleaseDigest);
    await releasePage.screenshot({path:join(ROOT,'release-rollback.png'),fullPage:true});
    return {before:'grpc-v1',changed:'grpc-v2',after:'grpc-v1',prices:['25000','27500','25000'],inFlightDrainedBeforeRestart:true};
  });
  await phase('same-state-reopen-and-live-customer',async()=>{
    await api('release-close',{});await releasePage.close();releasePage=null;
    await page.close({runBeforeUnload:false});await workspace.close();workspace=null;
    workspace=await startGrpcWorkspace(options);workspaceOrigin=workspace.origin;workspaceToken=new URL(workspace.url).hash.slice(1);
    await loadWorkspacePage();await openReleasePage();
    const status=await startSelected();
    assert.equal(status.state.active,'grpc-v1');assert.equal(status.runtime.observed.releaseDigest,receipt.v1ReleaseDigest);
    await buy('reopened-v1',status.runtime.observed.listener,'25000');
    const previous=await api('attempt',{id:receipt.callId});assert.equal(previous.phase,'COMPLETED');validateOutput(previous.output);
    await releasePage.locator('#client-export-id').fill('grpc-customer-v1');
    await releasePage.locator('#client-generate').click();
    await waitUntil(()=>releaseCall('clients'),value=>JSON.stringify(value).includes('grpc-customer-v1'),'Original customer export');
    const clients=await releaseCall('clients');await atomic(join(ROOT,'customer-exports.json'),clients);
    const document=await (await fetch(status.runtime.observed.listener+'/_seller/openapi.json')).json();
    responseContract(document);
    await releasePage.screenshot({path:join(ROOT,'release-customer-reopened.png'),fullPage:true});
    return {stateGeneration:status.state.generation,releaseId:status.state.active,digest:status.runtime.observed.releaseDigest,
      originalCallReopened:receipt.callId,typedLiveResponse:true,customerExport:'grpc-customer-v1'};
  });
  receipt.nativeCalls.push(...example.calls);receipt.browserErrors=errors;
  assert.deepEqual(errors,[]);
  receipt.complete=true;receipt.completedAt=new Date().toISOString();delete receipt.currentPhase;delete receipt.failure;
  await persist();
} catch(error) {
  receipt.failure={phase:receipt.currentPhase,message:error.message,stack:error.stack,at:new Date().toISOString()};
  await persist();console.error(error.stack);process.exitCode=1;
} finally {
  releaseVerification?.();
  const cleanup=[];
  for(const [name,action] of [['browser',()=>browser?.close()],['workspace',()=>workspace?.close()],
    ['grpc',()=>example?.close()],['facilitator',async()=>{if(facilitator){facilitator.closeAllConnections();await new Promise(done=>facilitator.close(done));}}]]){
    try{await action();cleanup.push({name,closed:true});}catch(error){cleanup.push({name,closed:false,error:error.message});process.exitCode=1;}
  }
  receipt.cleanup=cleanup;receipt.closedAt=new Date().toISOString();await persist();
  console.log(JSON.stringify({complete:receipt.complete??false,phase:receipt.currentPhase,
    calls:receipt.nativeCalls.length,verifies:receipt.facilitator.filter(x=>x.kind==='verify').length,
    settles:receipt.facilitator.filter(x=>x.kind==='settle').length,cleanup}));
}
