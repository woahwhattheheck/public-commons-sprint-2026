// MIT. Continue the original two purchased jobs through the actual customer application.
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { openJobMerchant } from '../../sf30-seller-sdk/jobs/model.mjs';
import { startCustomerServer } from '../../sf30-seller-sdk/jobs/customer.mjs';
import { createPublicHttpsFetch } from '../../sf31-buyer-client/public-transport.mjs';
import { readBytes, readJson, writeBytes, writeJson, exists } from '../node/store.mjs';
import { receiveCollection, inspectCollectionArchive, openReceivedLibrary } from '../resource-library/collection-package.mjs';
import { openJobWorkspace } from './model.mjs';
import { startJobCustomerWorkspace } from './server.mjs';

const args = process.argv.slice(2), flags = new Map();
assert.equal(args.length % 2, 0, 'Use --retained ABS [--out ABS]');
for (let index = 0; index < args.length; index += 2) {
  assert.ok(['--retained','--out'].includes(args[index]) && !flags.has(args[index]), 'Unknown or duplicate option');
  flags.set(args[index], args[index + 1]);
}
assert.ok(flags.get('--retained')?.startsWith('/'), 'The original SF_JOBS_JOURNEY_KEEP=1 directory is required');
const retained = resolve(flags.get('--retained')), directory = join(retained, 'customer-workspace');
const output = flags.has('--out') ? resolve(flags.get('--out')) : join(retained, 'customer-workspace-native.json');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const operation = 'SCF-JOB-CUSTOMER-WORKSPACE-0B8D-20261011';
let merchant, customer, model, host, received, statusReads = 0, resultReads = 0, complete = false;
const transport = createPublicHttpsFetch({
  timeoutMs: 30000, lookup: async () => [{ address: '8.8.8.8', family: 4 }],
  requestImpl(options, receive) {
    assert.equal(options.hostname, 'jobs-merchant.example'); assert.equal(options.method, 'GET');
    assert.match(options.path, /^\/jobs\/(?:report|recovery)%3A2026\.10(?:\/result)?$/);
    if (options.path.endsWith('/result')) resultReads++; else statusReads++;
    const target = new URL(customer.url);
    return httpRequest({ hostname: '127.0.0.1', port: target.port, method: options.method, path: options.path,
      headers: { ...options.headers, host: options.hostname }, signal: options.signal, agent: false,
      maxHeaderSize: options.maxHeaderSize }, receive);
  },
});
async function startWorkspace() {
  model = await openJobWorkspace({ directory, buyerRoots: [retained], fileRoots: [retained], fetchImpl: transport });
  host = await startJobCustomerWorkspace({ model, port: 0 });
}
async function closeWorkspace() {
  try { await host?.close(); } finally { host = null; try { await model?.close(); } finally { model = null; } }
}
async function api(path, body, method) {
  const response = await fetch(host.origin + path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { authorization: 'Bearer ' + host.token, origin: host.origin,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json();
  assert.ok(response.ok, JSON.stringify({ path, status: response.status, value })); return value;
}
async function transfer(path, body) {
  const ticket = await api(path, body);
  const response = await fetch(host.origin + ticket.url);
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.length, ticket.bytes); assert.equal(hash(bytes), ticket.sha256);
  return { bytes, sha256: ticket.sha256 };
}
try {
  merchant = await openJobMerchant({ configPath: join(retained, 'merchant.json'),
    directory: join(retained, 'merchant-state'), env: { SF_JOBS_JOURNEY_GATE: join(retained, 'release-application') } });
  for (const id of ['report:2026.10','recovery:2026.10']) assert.equal((await merchant.get(id)).state, 'COMPLETED');
  const originalSettlements = (await merchant.deliveryOutbox.rows()).length;
  assert.equal(originalSettlements, 2);
  customer = await startCustomerServer({ model: merchant, port: 0 });
  await startWorkspace();
  for (const path of ['/jobs/','/jobs/app.mjs','/jobs/style.css','/','/collections'])
    assert.equal((await fetch(host.origin + path)).status, 200, path);
  assert.ok((await api('/api/status')).pages.includes('/jobs/'));

  // The accepted bytes and capability are the original private fixture data.
  // Intake makes a new customer handle for that same accepted purchase.
  const originalBuyer = join(retained, 'customer-report_2026.10');
  const privateBuyer = await readJson(join(originalBuyer, 'buyer.json'));
  const acceptedBytes = await readBytes(join(originalBuyer, 'acceptance.json'));
  const added = await api('/api/job-workspace/retain', {
    acceptanceBase64: acceptedBytes.toString('base64'), claimToken: privateBuyer.claimToken, label: 'October analysis',
  });
  const first = added.entry;
  const registered = await api('/api/job-workspace/register', { buyerDirectory: originalBuyer, label: 'Original report' });
  assert.equal(registered.entry.id, first.id); assert.equal(registered.reused, true);
  const second = (await api('/api/job-workspace/register',
    { buyerDirectory: join(retained, 'customer-recovery_2026.10'), label: 'Recovered October analysis' })).entry;
  assert.notEqual(second.id, first.id);
  assert.equal((await api('/api/job-workspace/jobs?view=all')).total, 2);

  for (const entry of [first, second]) {
    await api('/api/job-workspace/jobs/' + entry.id + '/start', { kind: 'refresh', deadlineMs: 30000 });
    assert.equal((await model.wait(entry.id)).task.state, 'COMPLETE');
    await api('/api/job-workspace/jobs/' + entry.id + '/start', { kind: 'fetch', deadlineMs: 30000 });
    const done = await model.wait(entry.id);
    assert.equal(done.task.state, 'COMPLETE'); assert.equal(done.resource.status, 'VERIFIED');
    assert.equal(done.receipt.latestStatus.state, 'COMPLETED');
  }
  const original = await api('/api/job-workspace/jobs/' + first.id);
  const resource = original.resource;
  const preview = await api('/api/resources/' + resource.id + '/preview');
  assert.equal(JSON.parse(preview.text).mean, 5);
  const download = await transfer('/api/resources/' + resource.id + '/download', {});
  assert.equal(JSON.parse(download.bytes).sum, 20);
  assert.equal(download.sha256, resource.sha256);
  await api('/api/selection', { id: resource.id }, 'PUT');
  const annotation = await api('/api/resources/' + resource.id + '/note', {
    expectedRevision: 0, operationId: operation + ':note',
    note: 'October result: mean 5, sum 20; retained job and recovered job agree.',
    tags: ['october','operations'], starred: true,
  }, 'PATCH');
  assert.equal(annotation.revision, 1);
  const a = await api('/api/job-workspace/jobs/' + first.id), b = await api('/api/job-workspace/jobs/' + second.id);
  const collection = await api('/api/collections', {
    id: 'paid-job-analysis', name: 'October application results',
    note: 'The completed report and its recovered companion.', expectedRevision: 0, operationId: operation + ':collection',
    members: [a.resource,b.resource].map(value => ({ id: value.id, sha256: value.sha256,
      annotationRevision: value.annotation.revision, mode: 'current' })),
  }, 'PUT');
  assert.equal(collection.members.length, 2);
  const exported = await transfer('/api/collections/' + collection.id + '/download', { revision: collection.revision });
  const archive = join(retained, 'paid-job-analysis.tar');
  if (await exists(archive)) assert.equal(hash(await readFile(archive)), exported.sha256);
  else await writeBytes(archive, exported.bytes, { exclusive: true });
  const inspected = await inspectCollectionArchive(archive, { expectedSha256: exported.sha256 });
  assert.equal(inspected.manifest.objects.length, 1, 'Identical result bytes are stored once in the collection');
  assert.equal(inspected.manifest.collection.members[0].job.acceptanceSha256, a.receipt.acceptanceSha256);
  assert.equal(JSON.stringify(inspected.manifest).includes(privateBuyer.claimToken), false);
  const intake = await receiveCollection({ archive, destination: join(retained, 'received-job-collection'),
    resume: true, expectedSha256: exported.sha256 });
  received = await openReceivedLibrary({ directory: intake.directory, state: join(retained, 'received-job-library') });
  const receivedRows = received.search({ limit: 50 }).items;
  assert.equal(receivedRows.length, 2);
  for (const value of receivedRows) {
    assert.equal(value.status, 'VERIFIED');
    assert.equal(value.origin.resource.source.kind, 'paid-jobs');
    assert.ok(['report:2026.10','recovery:2026.10'].includes(value.origin.resource.job.jobId));
    assert.equal(JSON.parse((await received.preview(value.id)).text).mean, 5);
  }

  const before = host.token;
  await closeWorkspace(); await startWorkspace();
  assert.notEqual(host.token, before);
  const reopened = await api('/api/job-workspace/jobs/' + first.id);
  assert.equal(reopened.receipt.delivery.sha256, resource.sha256);
  assert.equal(reopened.resource.annotation.note, annotation.note);
  assert.equal((await api('/api/collections/' + collection.id)).members.length, 2);
  assert.equal((await merchant.deliveryOutbox.rows()).length, originalSettlements);
  const summary = { result: 'PASS', operation, node: process.version, retainedWorkDirectory: retained,
    customerWorkspace: directory, customerStatusReads: statusReads, customerResultReads: resultReads,
    transport: 'ORIGINAL_SF31_HTTPS_TRANSPORT_WITH_LOOPBACK_REQUEST_SEAM',
    originalSettlementEvents: originalSettlements, jobs: [first.id,second.id],
    artifact: { sha256: resource.sha256, bytes: resource.bytes },
    collection: { id: collection.id, revision: collection.revision, archiveSha256: exported.sha256,
      resources: receivedRows.length, storedObjects: inspected.manifest.objects.length },
    lifecycle: ['accepted-file browser intake', 'original buyer reopen', 'same-job customer status',
      'verified artifact retrieval', 'library preview and browser download', 'research notes',
      'collection export and receiving', 'private workspace restart'] };
  await received.close(); received = null;
  await closeWorkspace();
  await customer.close(); customer = null;
  await merchant.close(); merchant = null;
  await writeJson(output, summary); process.stdout.write(JSON.stringify(summary) + '\n'); complete = true;
} finally {
  const results = await Promise.allSettled([received?.close(), closeWorkspace(), customer?.close()]);
  try { await merchant?.close(); } finally {
    if (!complete) process.stderr.write(JSON.stringify({ retainedWorkDirectory: retained,
      customerWorkspace: directory, operation }) + '\n');
  }
  const failed = results.filter(value => value.status === 'rejected');
  if (failed.length) throw new AggregateError(failed.map(value => value.reason), 'CUSTOMER_CONTINUATION_CLOSE_FAILED');
}
