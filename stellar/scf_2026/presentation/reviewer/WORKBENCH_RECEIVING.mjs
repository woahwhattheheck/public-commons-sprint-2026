#!/usr/bin/env node
/** MIT. One restartable full reviewer UI/native receiving operation over the original public packet. */
import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import {startReviewerWorkbench} from './workbench.mjs';
import {readSourceFile, writeSourceFile, inspectGrantDemoWorkspace, exportGrantDemo} from './workspace.mjs';
import {operationLease} from '../../../scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const name = process.argv[i], value = process.argv[i + 1];
  assert(['--operation', '--source-root', '--playwright', '--chromium'].includes(name) && value && !value.startsWith('--'),
    'Use --operation ABS --source-root ABS --playwright ABS --chromium ABS.');
  assert(!Object.hasOwn(options, name), 'Repeated option'); options[name] = resolve(value);
}
for (const name of ['--operation', '--source-root', '--playwright', '--chromium']) assert(options[name], name + ' is required.');
assert(Number(process.versions.node.split('.')[0]) >= 22, 'Use the maintained native Node 22 or later runtime.');
const {chromium} = await import(pathToFileURL(options['--playwright']).href);
const root = options['--operation'];
await mkdir(root, {recursive:true, mode:0o700});
for (const name of ['workbenches', 'downloads', 'screenshots', 'browser-temp']) await mkdir(join(root, name), {mode:0o700}).catch(error => {
  if (error.code !== 'EEXIST') throw error;
});
const lease = await operationLease(join(root, 'controller.lock'));
const journalFile = join(root, 'WORKBENCH-STATE.json'), resultFile = join(root, 'WORKBENCH-RESULT.json');
let journal;
try { journal = JSON.parse(await readSourceFile(journalFile, {privateFile:true})); }
catch (error) { if (error.code !== 'ENOENT') throw error;
  journal = {schema:'stellar-forge.grant-reviewer-receiving.v1', runId:randomUUID(), operation:root,
    sourceRoot:options['--source-root'], createdAt:new Date().toISOString(), state:'CONTINUING',
    phases:{}, requests:{}, nativeReads:[], views:[]}; }
assert.equal(journal.operation, root); assert.equal(journal.sourceRoot, options['--source-root']);
if (journal.state === 'COMPLETE') {
  const result = JSON.parse(await readSourceFile(resultFile, {privateFile:true}));
  await lease.close(); process.stdout.write(JSON.stringify({status:'REUSED_COMPLETE', resultFile, resultSha256:sha(await readFile(resultFile)),
    runId:result.runId}) + '\n'); process.exit(0);
}
let saving = Promise.resolve(), activePhase = 'setup', browser, context, page, stopping = false;
const applications = new Map(), consoleErrors = [];
const save = () => {
  const bytes = Buffer.from(JSON.stringify(journal, null, 2) + '\n');
  saving = saving.then(() => writeSourceFile(journalFile, bytes, {replace:true})); return saving;
};
async function api(application, path, payload, selectedToken = application.accessToken) {
  const response = await fetch(application.url + 'api/' + path, {
    method:payload === undefined ? 'GET' : 'POST', redirect:'error',
    headers:{authorization:'Bearer ' + selectedToken, ...(payload === undefined ? {} : {'content-type':'application/json'})},
    ...(payload === undefined ? {} : {body:JSON.stringify(payload)})});
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error?.message ?? 'HTTP_' + response.status), {code:value.error?.code});
  return value;
}
async function application(name) {
  if (applications.has(name)) return applications.get(name);
  assert(!stopping, 'Original receiving was cancelled.');
  const value = await startReviewerWorkbench({directory:join(root, 'workbenches', name),
    sourceRoot:options['--source-root']});
  applications.set(name, value); return value;
}
async function closeApplication(name) {
  const value = applications.get(name); if (!value) return;
  await value.close(); applications.delete(name);
}
async function idle() { await page.waitForFunction(() => document.body.getAttribute('aria-busy') !== 'true'); }
async function press(label) { assert(!stopping); await page.getByRole('button', {name:label, exact:true}).click(); await idle(); }
async function view(label) { await press(label); await page.locator('main h2').first().waitFor({state:'visible'}); }
async function openPage(name) {
  const value = await application(name);
  assert(!stopping); await page.goto(value.url + '#' + encodeURIComponent(value.accessToken));
  await page.locator('#workspace').waitFor({state:'visible'}); await idle();
  return value;
}
async function select(id) {
  await page.locator('#selection').selectOption(id); await idle();
  assert.equal(await page.locator('#selection').inputValue(), id);
}
async function current(application, id) {
  const state = await api(application, 'state'); return {state, selection:state.selections.find(item => item.id === id)};
}
async function snapshot(name, suffix) {
  await idle();
  const overflow = await page.evaluate(() => ({width:document.documentElement.clientWidth, scroll:document.documentElement.scrollWidth}));
  assert(overflow.scroll <= overflow.width + 1, 'The actual reviewer view overflows: ' + suffix);
  const path = join(root, 'screenshots', name + '-' + suffix + '.png');
  await page.screenshot({path, fullPage:false});
  return {view:suffix, width:overflow.width, path, sha256:sha(await readFile(path))};
}
async function phase(name, fn) {
  activePhase = name;
  if (journal.phases[name]) return journal.phases[name];
  assert(!stopping); journal.activePhase = name; await save();
  const value = await fn();
  journal.phases[name] = {...value, completedAt:new Date().toISOString()}; await save();
  process.stdout.write(JSON.stringify({phase:name, status:'COMPLETE'}) + '\n'); return journal.phases[name];
}
async function selectedNativeRead(application, selection, quoteId) {
  const headers = {authorization:'Bearer ' + application.accessToken, 'content-type':'application/json',
    'mcp-protocol-version':'2025-11-25'};
  const response = await fetch(application.url, {method:'POST', headers, body:JSON.stringify({
    jsonrpc:'2.0', id:randomUUID(), method:'tools/call', params:{name:'bazaar_status', arguments:{quoteId}}})});
  const value = await response.json(); assert(response.ok && !value.error);
  const data = value.result.structuredContent ?? JSON.parse(value.result.content.find(item => item.type === 'text').text);
  return data;
}
async function resultDownload(quoteId, expected, name) {
  await page.getByLabel('Original quote', {exact:true}).selectOption(quoteId); await idle();
  await press('Read complete saved result');
  await page.getByRole('heading', {name:'Complete saved result', exact:true}).waitFor();
  const downloadPromise = page.waitForEvent('download');
  await press('Download complete JSON');
  const downloaded = await downloadPromise, path = join(root, 'downloads', name);
  await downloaded.saveAs(path);
  const bytes = await readSourceFile(path);
  assert.equal(bytes.length, expected.bytes); assert.equal(sha(bytes), expected.sha256);
  return {path, bytes:bytes.length, sha256:sha(bytes)};
}
const signal = () => { stopping = true; browser?.close().catch(() => {}); };
process.once('SIGINT', signal); process.once('SIGTERM', signal);
try {
  await save();
  process.env.TMPDIR = join(root, 'browser-temp');
  browser = await chromium.launch({executablePath:options['--chromium'], headless:true,
    args:['--no-sandbox', '--disable-dev-shm-usage'], downloadsPath:join(root, 'downloads')});
  assert(!stopping);
  context = await browser.newContext({viewport:{width:1440, height:1000}, acceptDownloads:true});
  page = await context.newPage();
  page.on('pageerror', error => consoleErrors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/' && request.method() === 'POST') {
      try {
        const rpc = request.postDataJSON();
        journal.nativeReads.push({phase:activePhase, method:rpc.method, tool:rpc.params?.name ?? null,
          quoteId:rpc.params?.arguments?.quoteId ?? null});
      } catch {}
    }
  });
  await page.route('**/api/**', async route => {
    const request = route.request();
    if (request.method() !== 'POST') return route.continue();
    const data = request.postDataJSON();
    if (!data?.requestId) return route.continue();
    const input = {...data}; delete input.requestId;
    const requestUrl = new URL(request.url()), path = requestUrl.pathname;
    const liveInstance = ['/api/open', '/api/close'].includes(path) ? [...applications.values()].find(item => item.address === requestUrl.origin)?.instanceId : undefined;
    const fingerprint = sha(JSON.stringify({phase:activePhase, path, input, liveInstance}));
    let original = journal.requests[fingerprint];
    if (!original) {
      original = {id:data.requestId, phase:activePhase, path, inputHash:sha(JSON.stringify(input)),
        ...(input.selectionId ? {selectionId:input.selectionId, expectedRevision:input.expectedRevision} : {})};
      journal.requests[fingerprint] = original; await save();
    }
    if (stopping) return route.abort('aborted');
    await route.continue({postData:JSON.stringify({...data, requestId:original.id})});
  });
  let sender = await openPage('sender');
  const reviewed = await phase('original_packet_review', async () => {
    await view('Packet intake'); await press('Review bundled purchase');
    const state = await api(sender, 'state');
    const selection = state.selections.find(item => item.origin.kind === 'bundled');
    assert(selection && selection.packet.sha256 === '34979a3e06790eb4957edac734c4eea5931fead40cb77ae14d29c5c3ff8a674b');
    assert.equal(selection.packet.quotes.length, 2);
    await page.getByText('Exact saved query configuration', {exact:true}).click();
    return {selectionId:selection.id, packetId:selection.packet.packetId, packetSha256:selection.packet.sha256,
      operationId:selection.packet.operationId, screenshot:await snapshot('desktop', 'source-review')};
  });
  await select(reviewed.selectionId);
  await phase('original_native_receive', async () => {
    await view('Source and query');
    const before = await current(sender, reviewed.selectionId);
    if (before.selection.state !== 'RECEIVED') await press('Receive this packet');
    const {selection} = await current(sender, reviewed.selectionId);
    assert.equal(selection.state, 'RECEIVED'); assert.equal(selection.receipt.newPayments, 0);
    assert.deepEqual(selection.receipt.originalQuoteIds.slice().sort(), selection.packet.quotes.map(item => item.quoteId).sort());
    await press('Inspect retained workspace');
    return {receipt:selection.receipt, revision:selection.revision};
  });
  await phase('original_buyer_open', async () => {
    await view('Source and query'); await press('Open original Buyer');
    const state = await api(sender, 'state');
    assert(state.buyer.active && state.buyer.selectionId === reviewed.selectionId);
    return {selectionId:reviewed.selectionId, originalQuotes:state.selections.find(item => item.id === reviewed.selectionId).receipt.originalQuoteIds};
  });
  // An interrupted later phase reopens the retained selection explicitly, using a new continuation action.
  const ensureSenderBuyer = async () => {
    const state = await api(sender, 'state');
    if (!state.buyer.active) {
      activePhase = 'continuation_open_' + (journal.activePhase ?? 'original');
      await view('Source and query'); await press('Open original Buyer');
    } else { await view('Buyer results'); }
  };
  if (['complete_primary_result','complete_earlier_result','desktop_views','mobile_views'].some(name => !journal.phases[name]))
    await ensureSenderBuyer();
  const sourceSelection = (await current(sender, reviewed.selectionId)).selection;
  const primary = sourceSelection.packet.quotes.find(item => item.quoteId === sourceSelection.packet.primaryQuoteId);
  const earlier = sourceSelection.packet.quotes.find(item => item.quoteId !== primary.quoteId);
  await phase('complete_primary_result', async () => {
    const result = await resultDownload(primary.quoteId, primary.result, 'original-primary.json');
    assert.equal(result.bytes, 53468); assert.equal(primary.status, 'CONFIRMED_BY_SERVER');
    assert.equal(primary.observation.outcome, 'TRANSFER_MATCHED');
    await page.getByRole('tab', {name:'Structured data', exact:true}).click(); await idle();
    assert((await page.locator('#complete-result').textContent()).includes('100 rows'));
    return {...result, quoteId:primary.quoteId, status:primary.status, observation:primary.observation.outcome,
      screenshot:await snapshot('desktop', 'native-primary-result')};
  });
  await phase('complete_earlier_result', async () => {
    const result = await resultDownload(earlier.quoteId, earlier.result, 'original-earlier.json');
    assert.equal(result.bytes, 4733); assert.equal(earlier.status, 'INDETERMINATE'); assert.equal(earlier.observation.outcome, 'FAILED');
    return {...result, quoteId:earlier.quoteId, status:earlier.status, observation:earlier.observation.outcome};
  });
  await phase('desktop_views', async () => {
    const views = [];
    for (const [label, id] of [['Overview','overview'],['Packet intake','intake'],['Source and query','source'],
      ['Buyer results','buyer'],['Handover','handover'],['Activity','activity']]) {
      await view(label); views.push(await snapshot('desktop', id));
    } return {views};
  });
  await phase('mobile_views', async () => {
    await page.setViewportSize({width:390, height:844}); const views = [];
    for (const [label, id] of [['Overview','overview'],['Packet intake','intake'],['Source and query','source'],
      ['Buyer results','buyer'],['Handover','handover'],['Activity','activity']]) {
      await view(label); views.push(await snapshot('mobile', id));
    }
    await page.setViewportSize({width:1440, height:1000}); return {views};
  });
  const exported = await phase('closed_native_export', async () => {
    await view('Handover'); await press('Close Buyer and export packet');
    const state = await api(sender, 'state'); assert.equal(state.buyer.active, false);
    const action = state.operations.find(item => item.kind === 'export' && item.input.selectionId === reviewed.selectionId && item.state === 'COMPLETED');
    assert(action); const result = action.result.export;
    const promise = page.waitForEvent('download'); await press('Download receiving packet');
    const download = await promise, path = join(root, 'downloads', 'original-receiving-packet.json');
    await download.saveAs(path); assert.equal(sha(await readSourceFile(path)), result.sha256);
    const replay = await api(sender, 'export', {...action.input, requestId:action.id});
    assert(replay.replayed); assert.equal(replay.export.sha256, result.sha256);
    const native = await inspectGrantDemoWorkspace({directory:join(sender.model.directory, 'received', reviewed.selectionId),
      sourceRoot:options['--source-root']});
    assert.deepEqual(native.quotes.map(item => item.quoteId).sort(), sourceSelection.receipt.originalQuoteIds.slice().sort());
    return {path, export:result, actionId:action.id, originalNative:native.quotes, replayedSameAction:true};
  });
  await phase('same_directory_reopen', async () => {
    await view('Handover'); await press('Reopen this received packet');
    const state = await api(sender, 'state'); assert(state.buyer.active);
    assert.equal(state.buyer.selectionId, reviewed.selectionId);
    const quote = await selectedNativeRead(sender, sourceSelection, primary.quoteId);
    // Reconcile the already accepted export while the original Buyer owns the writer.
    // This must read the immutable artifact, not reacquire a writer or regenerate history.
    const accepted = await exportGrantDemo({directory:join(sender.model.directory, 'received', reviewed.selectionId),
      sourceRoot:options['--source-root'], output:exported.export.path,
      requestId:exported.actionId, exportedAt:exported.export.exportedAt});
    assert(accepted.reused); assert.equal(accepted.sha256, exported.export.sha256);
    return {quoteId:primary.quoteId, nativeStatus:quote, packetId:state.buyer.packetId,
      acceptedExportReconciledWithLiveWriter:true, acceptedExportSha256:accepted.sha256};
  });
  await phase('cold_workbench_reopen', async () => {
    const before = await api(sender, 'state'), oldToken = sender.accessToken, oldInstance = sender.instanceId;
    await page.goto('about:blank'); await closeApplication('sender');
    sender = await openPage('sender');
    assert.notEqual(sender.instanceId, oldInstance); assert.notEqual(sender.accessToken, oldToken);
    const unauthorized = await fetch(sender.url + 'api/state', {headers:{authorization:'Bearer ' + oldToken}});
    assert.equal(unauthorized.status, 401);
    const after = await api(sender, 'state');
    assert.equal(after.id, before.id); assert.equal(after.buyer.active, false);
    assert.deepEqual(after.selections, before.selections);
    const originalOpen = before.operations.find(item => item.kind === 'open' && item.state === 'COMPLETED');
    assert(originalOpen);
    const replay = await api(sender, 'open', {...originalOpen.input, requestId:originalOpen.id});
    assert(replay.replayed); assert.equal(replay.buyer.active, false); assert.equal(replay.recordedResult.buyer.active, true);
    assert.equal((await api(sender, 'state')).buyer.active, false);
    assert.equal(sha(await readSourceFile(exported.path)), exported.export.sha256);
    await select(reviewed.selectionId);
    return {workbenchId:after.id, freshAccessCode:true, oldCodeStatus:unauthorized.status,
      oldOpenReceiptReportsCurrentClosedState:true, retainedSelections:after.selections.length};
  });
  await page.goto('about:blank'); await closeApplication('sender');
  const receiver = await openPage('receiver');
  const receiving = await phase('second_operator_packet_intake', async () => {
    await view('Packet intake');
    await page.getByLabel('Packet title', {exact:true}).fill('Second operator receiving');
    await page.getByLabel('Receiving packet JSON', {exact:true}).setInputFiles(exported.path);
    await press('Review selected packet');
    const state = await api(receiver, 'state'), selection = state.selections.find(item => item.title === 'Second operator receiving');
    assert(selection); assert.equal(selection.packet.packetId, exported.export.packetId);
    assert.equal(selection.packet.sha256, exported.export.sha256);
    return {selectionId:selection.id, packetId:selection.packet.packetId, sourcePacketId:exported.export.sourcePacketId};
  });
  await select(receiving.selectionId);
  await phase('second_operator_native_receive', async () => {
    await view('Source and query');
    const before = await current(receiver, receiving.selectionId);
    if (before.selection.state !== 'RECEIVED') await press('Receive this packet');
    const {selection} = await current(receiver, receiving.selectionId);
    assert.equal(selection.receipt.newPayments, 0);
    assert.deepEqual(selection.receipt.originalQuoteIds.slice().sort(), sourceSelection.receipt.originalQuoteIds.slice().sort());
    await press('Open original Buyer');
    const result = await resultDownload(primary.quoteId, primary.result, 'receiver-primary.json');
    assert.equal(result.sha256, journal.phases.complete_primary_result.sha256);
    return {receipt:selection.receipt, completeResult:result, screenshot:await snapshot('receiver', 'native-result')};
  });
  await phase('second_operator_handover', async () => {
    await view('Handover'); await press('Close Buyer and export packet');
    const state = await api(receiver, 'state'), action = state.operations.find(item => item.kind === 'export' && item.state === 'COMPLETED');
    assert(action && !state.buyer.active);
    const bytes = await readSourceFile(action.result.export.path), packet = JSON.parse(bytes);
    assert.equal(packet.receivingHistory.length, JSON.parse(await readSourceFile(exported.path)).receivingHistory.length + 1);
    assert.deepEqual(packet.quotes, JSON.parse(await readSourceFile(exported.path)).quotes);
    return {export:action.result.export, receivingStages:packet.receivingHistory.length};
  });
  await phase('source_owned_application_handoff', async () => {
    const {default:provider} = await import('./application-provider.mjs');
    const catalog = provider.catalog({common:[], field:(name,label,type='path',required=false,description='') =>
      ({name,label,type,required,description})});
    assert.equal(catalog[0].command, 'grant-demo'); assert.equal(catalog[0].id, 'grant-reviewer');
    // This exercises the real published observer against the actual current private instance.
    // Full Review/Save/Connect/Start adoption belongs to the maintained distribution receipt.
    const observerDirectory = join(root, 'observer', receiver.instanceId); await mkdir(observerDirectory, {recursive:true, mode:0o700}).catch(error => {
      if (error.code !== 'EEXIST') throw error;
    });
    const id = journal.runId.replaceAll('-', '').slice(0,24);
    const request = {applicationId:id, command:'grant-demo', args:['workbench','--dir',receiver.model.directory]};
    const observer = provider.createObserver(request, observerDirectory);
    observer.write(Buffer.from(JSON.stringify(receiver.startup) + '\n')); await observer.close();
    const saved = JSON.parse(await readSourceFile(join(observerDirectory, 'application-url.json'), {privateFile:true}));
    assert.equal(saved.original.workbenchId, receiver.workbenchId);
    assert.equal(saved.original.instanceId, receiver.instanceId);
    assert.equal(new URL(saved.url).origin, receiver.address);
    assert.equal(decodeURIComponent(new URL(saved.url).hash.slice(1)), receiver.accessToken);
    return {providerId:catalog[0].id, command:catalog[0].command,
      currentInstanceVerified:true, workbenchId:receiver.workbenchId, fullManagedAdoption:'separate maintained distribution operation'};
  });
  assert.deepEqual(consoleErrors, []);
  const allowed = new Set(['bazaar_history','bazaar_results','bazaar_status','bazaar_read_result']);
  assert(journal.nativeReads.filter(row => row.method === 'tools/call').every(row => allowed.has(row.tool)));
  journal.state = 'FINALIZING'; journal.completedAt = new Date().toISOString(); delete journal.error;
} catch (error) {
  journal.state = 'CONTINUATION_REQUIRED'; journal.error = {code:error.code ?? error.name, message:error.message,
    phase:activePhase}; process.exitCode = 1;
} finally {
  try { await browser?.close(); }
  finally {
    for (const [name] of applications) await closeApplication(name);
    journal.closedAt = new Date().toISOString(); journal.ownedBrowserClosed = true; journal.ownedWorkbenchesClosed = true;
    journal.consoleErrors = consoleErrors;
    await save(); await lease.close();
  }
  process.removeListener('SIGINT', signal); process.removeListener('SIGTERM', signal);
}
if (journal.state === 'FINALIZING') {
  const codeRoot = fileURLToPath(new URL('./', import.meta.url)), code = {};
  for (const name of ['workspace.mjs','workbench-model.mjs','workbench.mjs','application-provider.mjs','workbench-ui/app.mjs'])
    code[name] = sha(await readFile(join(codeRoot, name)));
  const result = {...journal, state:'COMPLETE', schema:'stellar-forge.grant-reviewer-receiving-result.v1', node:process.version,
    originalPurchaseTransactions:1, originalQuoteAttempts:2, newPaymentTransactions:0,
    sourceCodeSha256:code, fullManagedAdoption:'separate maintained distribution operation'};
  await writeSourceFile(resultFile, Buffer.from(JSON.stringify(result, null, 2) + '\n'), {replace:true});
  journal.state = 'COMPLETE'; await save();
  process.stdout.write(JSON.stringify({status:'COMPLETE', runId:journal.runId, phases:Object.keys(journal.phases).length,
    resultFile, resultSha256:sha(await readFile(resultFile)), ownedBrowserClosed:true, ownedWorkbenchesClosed:true}) + '\n');
} else process.stdout.write(JSON.stringify({status:journal.state, runId:journal.runId, error:journal.error,
  ownedBrowserClosed:true, ownedWorkbenchesClosed:true}) + '\n');
