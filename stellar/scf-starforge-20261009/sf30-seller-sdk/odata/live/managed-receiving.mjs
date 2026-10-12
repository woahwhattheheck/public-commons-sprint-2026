// MIT. Operate one original installed OData application through retained receiving and reopen.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { createConnection } from 'node:net';
import { setTimeout as pause } from 'node:timers/promises';
import { inspectMerchantRuntime } from '../../../sf46-release/runtime-package.mjs';
import { readPackage, readBytes } from './client.mjs';
import { validatePage } from './contract.mjs';
import { odataWorkspaceIdentity, odataLiveIdentity, odataPrivateJson } from './startup.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const need = (value, message) => { if (!value) throw new Error(message); };
const absolute = value => {
  need(typeof value === 'string' && value === resolve(value) && !value.includes('\0'), 'Use absolute retained input paths.');
  return value;
};
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
async function waitFor(read, ready, description) {
  const deadline = Date.now() + 90000;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (ready(value)) return value;
    if (['FAILED', 'UNAVAILABLE', 'INTERRUPTED'].includes(value?.phase))
      throw new Error(description + ': ' + JSON.stringify(value.error ?? value.current?.result ?? value.phase));
    await pause(400);
  }
  throw new Error(description + ' did not complete: ' + JSON.stringify(value));
}
async function request(origin, path, body) {
  const url = new URL(path, origin);
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000),
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
    headers: { Accept: 'application/json', Origin: url.origin,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) } });
  const value = await response.json();
  need(response.ok, 'Original OData operation failed: ' + JSON.stringify(value));
  return value;
}
async function portClosed(value) {
  const url = new URL(value);
  return new Promise(done => {
    const socket = createConnection({ host: '127.0.0.1', port: Number(url.port || 80) });
    const finish = value => { socket.destroy(); done(value); };
    socket.once('connect', () => finish(false));
    socket.once('error', () => finish(true));
    socket.setTimeout(1000, () => finish(false));
  });
}

/**
 * Input contains an already installed runtime, original workspace/live service,
 * and saved response envelopes produced by that original live product.
 * All application actions go through the installed runtime-workspace model.
 */
export async function runManagedReceiving(input) {
  need(Number(process.versions.node.split('.')[0]) >= 24, 'Use the existing Node 24 runtime.');
  need(input?.schema === 'stellar-forge.odata-managed-receiving-input.v1', 'Use the original managed receiving input.');
  const runtimeDirectory = absolute(input.runtimeDirectory), workspaceDirectory = absolute(input.workspaceDirectory);
  const output = absolute(input.outputDirectory);
  need(Array.isArray(input.responseFiles) && input.responseFiles.length >= 1 && input.responseFiles.length <= 10000,
    'Select the complete original saved live response sequence.');
  const workspaceIdentity = await odataWorkspaceIdentity(workspaceDirectory);
  const liveIdentity = await odataLiveIdentity(workspaceDirectory, input.liveServiceId);
  const profile = await odataPrivateJson(join(liveIdentity.packageDirectory, '..', 'profile.json'));
  const prepared = await readPackage(liveIdentity.packageDirectory, { allowLoopback: profile.value.settings?.allowLoopback === true });
  need(prepared.sourceBinding === liveIdentity.sourceBinding, 'The original selected live source changed.');
  const operation = prepared.selection.operation, pages = [];
  let seenRows = 0, fingerprint = null;
  for (const path of input.responseFiles) {
    const bytes = await readBytes(absolute(path)), page = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    validatePage(page, prepared.plan, prepared.catalog, operation);
    need(page.queryFingerprint === prepared.query.compiled.fingerprint,
      'Select responses produced by this exact saved original query.');
    need(page.seenRows === seenRows + page.items.length && (!fingerprint || page.queryFingerprint === fingerprint),
      'Select the ordered complete response sequence from the same original query.');
    if (pages.length) need(pages.at(-1).page.completion === 'continue', 'A terminal response already ended this query.');
    seenRows = page.seenRows; fingerprint = page.queryFingerprint;
    pages.push({ path, bytes, page, sha256: sha256(bytes) });
  }
  need(pages.at(-1).page.completion !== 'continue', 'Retain the final original response before completing this receiving journey.');
  const runtime = await inspectMerchantRuntime(runtimeDirectory, { load: false });
  const module = join(runtime.sourceRoot, 'stellar/scf-starforge-20261009/distribution/runtime-workspace/model.mjs');
  const { createRuntimeWorkspace, openRuntimeWorkspace } = await import(pathToFileURL(module).href);
  await mkdir(output, { mode: 0o700 });
  await writeFile(join(output, 'input.json'), json(input), { flag: 'wx', mode: 0o600 });
  await mkdir(join(output, 'original-responses'), { mode: 0o700 });
  const originals = [];
  for (let index = 0; index < pages.length; index++) {
    const name = String(index + 1).padStart(5, '0') + '-' + pages[index].sha256 + '.json';
    await writeFile(join(output, 'original-responses', name), pages[index].bytes, { flag: 'wx', mode: 0o600 });
    originals.push({ file: name, sha256: pages[index].sha256, bytes: pages[index].bytes.length });
  }
  const controller = join(output, 'applications');
  await createRuntimeWorkspace({ directory: controller });
  let model = await openRuntimeWorkspace({ directory: controller }), applicationId, activeOperation = null;
  const receipt = { schema: 'stellar-forge.odata-managed-receiving.v1',
    runtime: { directory: runtime.directory, sourceCommit: runtime.sourceCommit, sourceManifestSha256: runtime.sourceManifestSha256 },
    workspace: workspaceIdentity, live: liveIdentity, operation, originalResponses: originals, runs: [], receiving: [], buyers: [] };
  const save = () => writeFile(join(output, 'result.json'), json(receipt), { mode: 0o600 });
  const current = async () => (await model.applicationsState()).applications.find(value => value.id === applicationId);
  async function start() {
    const reviewed = await model.applicationsStartReview({ applicationId }), requestId = randomUUID();
    await model.applicationsStart({ applicationId, requestId, reviewId: reviewed.id });
    activeOperation = requestId;
    const running = await waitFor(current, value => value?.phase === 'RUNNING' && Boolean(value.current?.privateUrl),
      'Original managed OData startup');
    need(running.current.id === requestId, 'The managed application reopened a different operation.');
    const original = running.current.url?.original;
    need(same(original?.workspace, workspaceIdentity) && original?.live?.sourceBinding === liveIdentity.sourceBinding &&
      original?.live?.stateDirectory === liveIdentity.stateDirectory, 'The installed application selected a different original source or state.');
    const detail = await request(running.current.privateUrl, '/api/live/detail?id=' + encodeURIComponent(input.liveServiceId));
    need(detail.sourceBinding === liveIdentity.sourceBinding && detail.runtime?.state === 'RUNNING',
      'The original live operator did not open the selected merchant.');
    const cursorKey = await readBytes(join(liveIdentity.stateDirectory, 'odata-cursor.key'), 32);
    need(cursorKey.length === 32, 'The original continuation key changed.');
    const run = { operationId: requestId, url: running.current.privateUrl, links: running.current.privateLinks,
      original, cursorKeySha256: sha256(cursorKey), detail };
    receipt.runs.push(run); await save(); return run;
  }
  async function stop(run) {
    await model.applicationsStop({ applicationId, operationId: run.operationId });
    await waitFor(current, value => value?.phase === 'STOPPED' && value.current?.active === false, 'Original managed OData stop');
    await waitFor(async () => ({ closed: (await Promise.all([run.url, run.original.live.url,
      run.original.live.operationsUrl].map(portClosed))).every(Boolean) }), value => value.closed,
    'Original workspace, merchant and operations listener closure');
    activeOperation = null;
    run.stoppedAt = new Date().toISOString(); await save();
  }
  try {
    const attached = await model.attach({ directory: runtimeDirectory, label: 'Original OData installed runtime' });
    const settings = { workspaceDirectory, liveServiceId: input.liveServiceId, port: 0,
      ...(input.environmentFile ? { environmentFile: absolute(input.environmentFile) } : {}) };
    const review = await model.applicationsReview({ runtimeId: attached.runtimeId, kind: 'odata', settings,
      label: 'OData merchant and customer receiving' });
    const saved = await model.applicationsSave({ requestId: randomUUID(), reviewId: review.id });
    need(!saved.connectionError, 'The original runtime connection failed: ' + JSON.stringify(saved.connectionError));
    applicationId = saved.applicationId; receipt.applicationId = applicationId; receipt.controller = controller;
    await waitFor(current, value => value?.phase === 'READY', 'Original installed runtime adoption');
    const first = await start();
    receipt.buyers.push(await request(first.url, '/api/live/buyer', { id: input.liveServiceId,
      intentId: 'managed-receiving-' + applicationId + '-initial' }));
    for (const page of pages) {
      const received = await request(first.url, '/api/live/receive', { id: input.liveServiceId,
        bodyBase64: page.bytes.toString('base64') });
      need(received.originalResponse?.sha256 === page.sha256 && received.rows === page.page.items.length,
        'The original receiver returned a different response.');
      receipt.receiving.push(received);
      if (page.page.next) receipt.buyers.push(await request(first.url, '/api/live/buyer', {
        id: input.liveServiceId, receivedId: received.id,
        intentId: 'managed-receiving-' + applicationId + '-' + received.id }));
      await save();
    }
    await stop(first);
    await model.close();
    model = await openRuntimeWorkspace({ directory: controller });
    const reopened = await start();
    need(reopened.cursorKeySha256 === first.cursorKeySha256 &&
      reopened.original.live.sha256 === first.original.live.sha256 &&
      reopened.original.live.sourceBinding === first.original.live.sourceBinding &&
      reopened.original.live.stateDirectory === first.original.live.stateDirectory,
    'The reopened original continuation identity changed.');
    const detail = await request(reopened.url, '/api/live/detail?id=' + encodeURIComponent(input.liveServiceId));
    const retained = new Set(detail.received.map(value => value.originalResponse?.sha256));
    need(pages.every(value => retained.has(value.sha256)), 'The reopened original receiver lost a retained response.');
    await stop(reopened);
    receipt.completedAt = new Date().toISOString(); receipt.rows = seenRows; receipt.pages = pages.length;
    receipt.queryFingerprint = fingerprint; receipt.state = 'COMPLETED'; await save();
    return { directory: output, applicationId, rows: seenRows, pages: pages.length,
      sourceBinding: liveIdentity.sourceBinding, sourceCommit: runtime.sourceCommit, result: join(output, 'result.json') };
  } finally {
    if (activeOperation) await model.applicationsStop({ applicationId, operationId: activeOperation }).catch(() => {});
    await model.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--input') throw new TypeError('Use --input with the retained receiving input JSON.');
  runManagedReceiving(JSON.parse(await readFile(absolute(args[1]), 'utf8')))
    .then(value => console.log(json(value)))
    .catch(error => { console.error(json({ error: error.code ?? 'ODATA_MANAGED_RECEIVING_FAILED', message: error.message })); process.exitCode = 1; });
}
