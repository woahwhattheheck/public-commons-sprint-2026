// MIT. One original browser/terminal purchase continuation with local fixtures.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createServer as httpServer, request as httpRequest } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { connect } from 'node:net';
import { once } from 'node:events';
import { Asset, Keypair, Networks } from '@stellar/stellar-sdk';
import { initializeCommerce, openCommerce } from './commerce.mjs';
import { startCommerceConsole } from './commerce-console.mjs';
import { reviewCommerceSetup } from './commerce-setup.mjs';
import { createNativeSellerServer } from '../sf30-seller-sdk/native-factory.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = process.env.COMMERCE_STREAM_FIXTURE_ROOT;
assert(root && resolve(root) === root && basename(root).startsWith('sf66-stream-'));
const output = process.env.COMMERCE_STREAM_OUTPUT ?? join(root, 'output');
const { chromium } = await import(pathToFileURL(process.env.COMMERCE_STREAM_PLAYWRIGHT).href);
const save = (path, value) => writeFile(path, typeof value === 'string' || Buffer.isBuffer(value) ? value :
  JSON.stringify(value, null, 2) + '\n', { mode:0o600 });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const delay = ms => new Promise(done => setTimeout(done, ms));
const report = { schema:'stellar-forge.commerce-stream-journey.v1', cases:{}, sourceHead:process.env.COMMERCE_STREAM_SOURCE_HEAD,
  node:process.version, nativeSdk:'2.28.0', paymentEnvironment:'DISPOSABLE_LOCAL_SIGNER_AND_FACILITATOR' };
let commerce, consoleSession, browser, proxy, tls;
const peers = new Set(), errors = [], requests = [];
let verifies = 0, settlements = 0;
const facilitator = {
  async getSupported() { return { kinds:[{x402Version:2, scheme:'exact', network:'stellar:testnet'}], extensions:['bazaar'], signers:{} }; },
  async verify() { verifies++; return {isValid:true, payer:'LOCAL_STREAM_FIXTURE'}; },
  async settle() { settlements++; return {success:true, network:'stellar:testnet', transaction:sha('LOCAL_STREAM_FIXTURE_' + settlements)}; },
};
const nativeFactory = compiled => createNativeSellerServer(compiled, {facilitatorClient:facilitator});
async function listen(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return 'http://127.0.0.1:' + server.address().port; }
async function stopServer(server) { if (server) { server.closeAllConnections?.(); await new Promise(done => server.close(done)); } }
async function until(read, name, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = await read(); if (result) return result; await delay(100); }
  throw Error('Timed out: ' + name);
}
async function retainedReport() { report.observed = {verifies, settlements, paymentHttpRequests:requests.length}; await save(join(output, 'commerce-stream-journey.json'), report); }
async function run(name, action) {
  try { report.cases[name] = {status:'PASS', ...await action()}; }
  catch (error) { report.cases[name] = {status:'FAIL', code:error.code ?? error.name, message:error.message}; await retainedReport(); throw error; }
  await retainedReport();
}
try {
  await mkdir(output, {recursive:true, mode:0o700});
  await mkdir(join(root, 'responses'), {mode:0o700}); await mkdir(join(root, 'evidence'), {mode:0o700});
  const payment = {scheme:'exact', network:'stellar:testnet', asset:Asset.native().contractId(Networks.TESTNET),
    payTo:Keypair.random().publicKey(), amount:'10000', maxTimeoutSeconds:180};
  const service = {schema:'stellar-forge.seller-service.v1', publicOrigin:'https://merchant.example',
    handlerTimeoutMs:30000, requestTimeoutMs:180000, maxStreamBytes:1048576,
    routes:[{id:'exa-answer', path:'/research/answer', handler:'answer', definition:{method:'POST', responseFormat:'sse',
      serviceName:'Controlled cited answer', description:'Original browser stream fixture', bodyType:'json', body:{query:'complete'},
      outputExample:{choices:[{delta:{content:'Stellar'}}]}, payment:{...payment, extra:{paymentFlow:'upfront'}}}},
    {id:'telemetry-records', path:'/metrics/records', handler:'records', definition:{method:'GET', responseFormat:'ndjson',
      description:'Original NDJSON browser fixture', outputExample:{sequence:1}, payment}}]};
  const handlersPath = join(root, 'stream-handlers.mjs');
  await save(handlersPath, `import {streamingResponse} from ${JSON.stringify(pathToFileURL(join(here, '../sf30-seller-sdk/stream-response.mjs')).href)};
import {setTimeout as delay} from 'node:timers/promises';
export const activity = {started:0,completed:0,closed:0};
export async function answer(context) {
  activity.started++;
  const partial = context.body.query === 'interrupt';
  const source = new AbortController();
  const chunks = partial ? Array.from({length:80}, (_,i) => ({choices:[{delta:{content:'fragment '+i+' '}}]})) : [
    {choices:[{delta:{content:'Stellar '}}]}, {choices:[{delta:{content:'smart contracts '}}]},
    {choices:[{delta:{content:'run on Soroban. café'}}]},
    {citations:[{id:'stellar',url:'https://developers.stellar.org/',title:'Stellar documentation',publishedDate:'2026-10-11',text:'A local fixture citation'}]},
    {citations:[{id:'stellar',url:'https://developers.stellar.org/',author:'Stellar',fixtureDetail:'preserved'}]}, '[DONE]'];
  return streamingResponse({format:'sse', maxBytes:1048576, maxDurationMs:30000, idleTimeoutMs:5000,
    close() {activity.closed++; source.abort();}, body:(async function* () {
      for (const [index,chunk] of chunks.entries()) {
        yield Buffer.from('id: '+(index+1)+'\\nevent: answer\\ndata: '+(typeof chunk==='string'?chunk:JSON.stringify(chunk))+'\\n\\n');
        await delay(partial ? 200 : 850, undefined, {signal:source.signal});
      }
      activity.completed++;
    })()});
}
export async function records() { return streamingResponse({format:'ndjson',body:(async function* () {
  for(let sequence=1;sequence<=60;sequence++) yield Buffer.from(JSON.stringify({sequence,group:sequence%2?'odd':'even',note:'café <script>text only</script>'})+'\\n');
})()}); }
`);
  await save(join(root, 'seller.json'), service);
  const originalSource = await import(pathToFileURL(handlersPath).href);
  const signer = join(root, 'controlled-signer.mjs'), policy = join(root, 'policy.json');
  await save(signer, "export async function sign({challenge,accepted}) {return {x402Version:2,resource:challenge.resource,accepted,extensions:challenge.extensions,payload:{transaction:'LOCAL_CONTROLLED_STREAM_FIXTURE'}};}\n");
  await save(policy, {schema:'stellar-spend-governor/v1', assets:[{network:payment.network, asset:payment.asset,
    max_single:'10000', max_total:'30000', max_per_utc_day:'30000', max_per_actor_utc_day:'30000', max_per_service_utc_day:'30000'}]});
  await save(join(root, 'question.json'), {query:'complete'});
  await save(join(root, 'interrupt-question.json'), {query:'interrupt'});
  await save(join(root, 'facilitator.json'), {schema:'stellar-forge.native-facilitator.v1', network:payment.network,
    signers:[{address:Keypair.random().publicKey(), secretEnv:'LOCAL_FIXTURE_FACILITATOR_KEY'}],
    payments:{assets:[payment.asset], recipients:[payment.payTo], maxAtomic:payment.amount}, limits:{maxTransactionFeeStroops:1000}});
  const setup = {schema:'stellar-forge.commerce-setup.v1', seller:{config:join(root, 'seller.json'), handlers:handlersPath,
    facilitatorConfig:join(root, 'facilitator.json'), port:0}, operationsPort:0,
    operator:{actor:'fixture-stream', service:'fixture-stream', python:'/usr/bin/python3', payer:Keypair.random().publicKey(),
      secretEnv:'LOCAL_FIXTURE_BUYER_KEY', totalAtomic:'30000', dailyAtomic:'30000'},
    purchases:[{routeId:'exa-answer', acceptIndex:0, intentId:'stream-browser-answer', method:'POST', bodyFile:join(root, 'question.json'),
      paymentFlow:'upfront', requestTimeoutMs:180000, responseTimeoutMs:120000, responseMaxBytes:1048576, responseStream:{format:'sse'}}]};
  await save(join(root, 'setup.json'), setup);
  await run('original-setup-selection', async () => {
    const reviewed = await reviewCommerceSetup({configFile:join(root, 'setup.json'), directory:join(root, 'prepared')});
    const selected = reviewed.summary.selections[0];
    assert.equal(selected.paymentFlow, 'upfront'); assert.equal(selected.requestTimeoutMs, 180000);
    assert.equal(selected.responseFile.stream.format, 'sse'); assert.equal(selected.responseFile.timeoutMs, 120000);
    assert.equal(selected.responseFile.destination, join(root, 'prepared/responses/01.bin'));
    return {paymentFlow:selected.paymentFlow, requestTimeoutMs:selected.requestTimeoutMs, captureTimeoutMs:selected.responseFile.timeoutMs};
  });
  tls = httpsServer({key:await readFile(join(root, 'test.key')), cert:await readFile(join(root, 'test.crt'))}, (req, res) => {
    requests.push({method:req.method, path:req.url, signed:Boolean(req.headers['payment-signature'])});
    const target = new URL(commerce.seller.url); let response;
    const forward = httpRequest({hostname:target.hostname, port:target.port, path:req.url, method:req.method, headers:req.headers}, upstream => {
      response = upstream; res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res);
    });
    res.on('close', () => { if (!res.writableEnded) { response?.destroy(); forward.destroy(); } });
    forward.on('error', () => res.destroy()); req.pipe(forward);
  }); await listen(tls);
  proxy = httpServer((_req, res) => res.writeHead(405).end());
  proxy.on('connect', (req, socket, head) => {
    assert.equal(req.url, 'merchant.example:443'); assert.equal(head.length, 0);
    const peer = connect(tls.address().port, '127.0.0.1', () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); socket.pipe(peer); peer.pipe(socket); });
    for (const stream of [socket, peer]) { peers.add(stream); stream.once('close', () => peers.delete(stream)); }
    peer.on('error', () => socket.destroy()); socket.on('error', () => peer.destroy());
    socket.once('close', () => peer.destroy()); peer.once('close', () => socket.destroy());
  }); const proxyUrl = await listen(proxy);
  const entries = [];
  for (const [suffix, format, flow, path] of [['answer','sse','upfront','/research/answer'], ['partial','sse','upfront','/research/answer'], ['records','ndjson','authorization','/metrics/records']]) {
    const configuration = {operation:{intentId:'stream-browser-' + suffix, url:service.publicOrigin + path, method:format === 'sse' ? 'POST' : 'GET',
      expect:{scheme:payment.scheme, network:payment.network, asset:payment.asset, payTo:payment.payTo, maxAtomic:payment.amount, maxTimeoutSeconds:180, paymentFlow:flow},
      ...(format === 'sse' ? {bodyFile:join(root, suffix === 'partial' ? 'interrupt-question.json' : 'question.json'), headers:{'Content-Type':'application/json'}} : {})},
      operator:{python:'/usr/bin/python3', actor:'fixture-stream', service:'fixture-stream', policy, ledger:join(root, 'ledger.sqlite')},
      signerModule:signer, evidenceDir:join(root, 'evidence'), captureBody:false, requestTimeoutMs:180000,
      responseFile:{destination:join(root, 'responses') + '/./' + suffix + '.' + format, maxBytes:1048576, timeoutMs:120000, stream:{format}},
      buyerTransport:{mode:'explicit-connect', origin:service.publicOrigin, proxyUrl}};
    const config = join(root, 'buyer-' + suffix + '.json'); await save(config, configuration); entries.push({config});
  }
  const directory = join(root, 'commerce');
  await save(join(root, 'plan.json'), {schema:'stellar-forge.commerce-plan.v1', seller:{config:join(root, 'seller.json'), handlers:handlersPath, port:0}, operationsPort:0, buyers:entries});
  await initializeCommerce({planFile:join(root, 'plan.json'), directory});
  commerce = await openCommerce(directory, {nativeFactory}); consoleSession = await startCommerceConsole(commerce, {port:0});
  const api = async (path, body) => fetch(consoleSession.url + path, {method:body === undefined ? 'GET' : 'POST',
    headers:{'x-commerce-token':consoleSession.token, ...(body === undefined ? {} : {origin:consoleSession.url, 'content-type':'application/json'})},
    ...(body === undefined ? {} : {body:JSON.stringify(body)})});
  const status = async intent => (await api('/api/session?intent=' + intent)).json();
  browser = await chromium.launch({executablePath:process.env.COMMERCE_STREAM_BROWSER_PATH,
    args:['--no-sandbox','--disable-gpu'], headless:true});
  const page = await browser.newPage({viewport:{width:1440, height:1050}}); page.on('pageerror', error => errors.push(error.message));
  await page.goto(consoleSession.operatorUrl); await page.locator('#stream-workspace').waitFor({state:'visible'});
  const select = async intent => {
    await page.locator('#operation-select').selectOption(intent);
    await page.waitForFunction(value => document.querySelector('#intent').textContent === value, intent);
  };
  const execute = async intent => {
    await select(intent); await page.locator('#review').click();
    await page.waitForFunction(() => !document.querySelector('#execute').disabled);
    process.stdout.write('FIXTURE_ALLOWED_INTENT ' + intent + '\n');
    await page.locator('#execute').click();
  };
  let complete, partial, records;
  await run('complete-sse-browser-answer', async () => {
    await execute('stream-browser-answer');
    const live = await until(async () => { const value = await status('stream-browser-answer'); return value.stream?.phase === 'CAPTURING' ? value : null; }, 'actual live capture');
    assert(live.stream.bytes > 0); assert.equal(originalSource.activity.completed, 0);
    const paid = await until(async () => { const value = await status('stream-browser-answer'); return value.stream.payment.receipt?.success ? value : null; }, 'original live payment observation');
    assert.equal(paid.stream.payment.settlement, 'REPORTED_SUCCESS');
    assert.equal(paid.stream.payment.transfer.status, 'SELLER_REPORTED_ONLY');
    await page.locator('#refresh').click(); await page.waitForFunction(() => document.querySelector('[data-stream="phase"]').textContent === 'Capturing');
    complete = await until(async () => { const value = await status('stream-browser-answer'); return value.stream?.phase === 'COMPLETE' ? value : null; }, 'original completed capture');
    assert.equal(complete.stream.records, 6); assert.equal(complete.stream.complete, true);
    await page.locator('#refresh').click(); await page.locator('[data-stream="read"]').click();
    await page.locator('[data-stream="record-area"]').waitFor({state:'visible'});
    assert.equal(await page.locator('[data-stream="rows"] > details').count(), 6);
    await page.locator('[data-stream="answer"]').click(); await page.locator('[data-stream="answer-area"]').waitFor({state:'visible'});
    assert.equal(await page.locator('[data-stream="answer-text"]').textContent(), 'Stellar smart contracts run on Soroban. café');
    const answer = await (await api('/api/stream-answer?intent=stream-browser-answer')).json();
    assert.equal(answer.citations.length, 1); assert.equal(answer.citations[0].fixtureDetail, 'preserved');
    assert.equal(answer.citations[0].text, 'A local fixture citation'); assert.equal(answer.providerDoneMarkerSeen, true);
    assert.equal(answer.captureComplete, true);
    await page.screenshot({path:join(output, 'stream-complete-desktop.png'), fullPage:true});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    return {bytes:complete.stream.bytes, records:complete.stream.records, sha256:complete.stream.sha256,
      liveCaptureBeforeCompletion:true, originalReceiptDuringCapture:true, retainedAnswerAndCitations:true};
  });
  await run('interrupt-and-reopen-prefix', async () => {
    await execute('stream-browser-partial');
    await until(async () => { const value = await status('stream-browser-partial'); return value.stream?.bytes > 100 ? value : null; }, 'partial original capture');
    await page.locator('#refresh').click(); await page.locator('[data-stream="interrupt"]').click();
    partial = await until(async () => { const value = await status('stream-browser-partial'); return value.stream?.phase === 'PARTIAL' ? value : null; }, 'original interruption result');
    assert.equal(partial.session.state, 'RUNNING'); assert.equal(partial.attempt.outcome.interrupted, true);
    assert.equal(partial.stream.complete, false); assert(partial.stream.records > 0 && partial.stream.records < 80);
    assert.equal(partial.stream.payment.receipt.success, true);
    await page.locator('#refresh').click(); assert.equal(await page.locator('[data-stream="read"]').isDisabled(), true);
    await page.locator('[data-stream="partial"]').check(); await page.locator('[data-stream="read"]').click();
    await page.locator('[data-stream="record-area"]').waitFor({state:'visible'});
    const reopened = await (await api('/api/stream-records?intent=stream-browser-partial&partial=1')).json();
    assert.equal(reopened.totalRecords, partial.stream.records); assert.equal(reopened.sha256, partial.stream.sha256);
    const raw = await api('/api/stream-file?intent=stream-browser-partial&partial=1');
    const retained = Buffer.from(await raw.arrayBuffer()); assert.equal(sha(retained), partial.stream.sha256);
    const before = settlements; await page.reload(); await page.locator('#operation-select').waitFor(); await select('stream-browser-partial');
    await page.waitForFunction(() => document.querySelector('[data-stream="phase"]').textContent === 'Partial');
    assert.equal(await page.locator('[data-stream="partial"]').isChecked(), false);
    await page.locator('[data-stream="partial"]').check(); await page.locator('[data-stream="read"]').click();
    await page.locator('[data-stream="record-area"]').waitFor({state:'visible'}); assert.equal(settlements, before);
    await page.setViewportSize({width:390, height:844}); await page.screenshot({path:join(output, 'stream-partial-mobile.png'), fullPage:true});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    return {bytes:partial.stream.bytes, records:partial.stream.records, sha256:partial.stream.sha256,
      merchantStillRunning:true, originalReceiptRetained:true, explicitPartialSelection:true, reloadSamePurchase:true};
  });
  await run('ndjson-record-pages-and-restart', async () => {
    await page.setViewportSize({width:1440, height:1050}); await execute('stream-browser-records');
    records = await until(async () => { const value = await status('stream-browser-records'); return value.stream?.phase === 'COMPLETE' ? value : null; }, 'original NDJSON capture');
    assert.equal(records.stream.records, 60); await page.locator('#refresh').click();
    await page.locator('[data-stream="read"]').click(); await page.locator('[data-stream="record-area"]').waitFor({state:'visible'});
    assert.equal(await page.locator('[data-stream="rows"] > details').count(), 25);
    await page.locator('[data-stream="next"]').click(); await page.waitForFunction(() => document.querySelector('[data-stream="page-summary"]').textContent.startsWith('26–50'));
    await page.locator('[data-stream="query"]').fill('even'); await page.locator('[data-stream="read"]').click();
    await page.waitForFunction(() => document.querySelector('[data-stream="page-summary"]').textContent.includes('of 30 matching'));
    const selected = await (await api('/api/stream-records?intent=stream-browser-records&query=even&offset=25')).json();
    assert.equal(selected.rows.length, 5); assert.equal(selected.matches, 30); assert.equal(selected.totalRecords, 60);
    const identities = (await commerce.status()).buyers.map(job => [job.operation.intentId, job.attempt.id]);
    const before = {settlements, requests:requests.length};
    await commerce.close();
    assert.equal((await commerce.streamRecords('stream-browser-records')).totalRecords, 60);
    await consoleSession.close(); consoleSession = null;
    commerce = await openCommerce(directory, {nativeFactory}); consoleSession = await startCommerceConsole(commerce, {port:0});
    await page.goto(consoleSession.operatorUrl); await page.locator('#operation-select').waitFor(); await select('stream-browser-answer');
    await page.locator('[data-stream="answer"]').click(); await page.locator('[data-stream="answer-area"]').waitFor({state:'visible'});
    assert.equal(await page.locator('[data-stream="answer-text"]').textContent(), 'Stellar smart contracts run on Soroban. café');
    assert.deepEqual((await commerce.status()).buyers.map(job => [job.operation.intentId, job.attempt.id]), identities);
    assert.deepEqual({settlements, requests:requests.length}, before);
    assert.equal(settlements, 3); assert.equal(verifies, 1); assert.equal(requests.length, 6); assert.deepEqual(errors, []);
    return {records:60, matchingRecords:30, pageSize:25, originalAttempts:identities.length,
      stoppedSessionReader:true, fullSessionReopen:true, desktopWidth:1440, mobileWidth:390, browserErrors:errors};
  });
  report.status = 'PASS'; await retainedReport(); console.log(JSON.stringify(report));
} finally {
  await browser?.close(); await consoleSession?.close().catch(() => {}); await commerce?.close().catch(() => {});
  for (const peer of peers) peer.destroy(); await stopServer(proxy); await stopServer(tls);
}
