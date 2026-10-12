// MIT. One focused native capture-refresh receiving workflow.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { newReview } from './model.mjs';
import { prepare, openWorkspace, saveReview, readRevision, digest } from './store.mjs';
import {
  prepareRefresh, openRefresh, saveRefreshReview, writeRefreshPage,
  exportRefresh, copyRefresh, packageRefresh,
} from './refresh.mjs';
import { readPackage } from '../workspace/model.mjs';

const json = value => JSON.stringify(value, null, 2) + '\n';
async function captures() {
  let edition = 1;
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    const value = path.startsWith('/items/') ? { id: path.split('/').pop(), amount: '9007199254740993.01' } : { state: 'ready' };
    if (edition >= 2 && path.startsWith('/items/')) value.active = true;
    response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(value));
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = 'http://127.0.0.1:' + server.address().port;
  async function capture(paths) {
    const entries = [];
    for (const path of paths) {
      const url = new URL(path, origin), start = performance.now(), response = await fetch(url), text = await response.text();
      const elapsed = performance.now() - start;
      entries.push({ startedDateTime: new Date().toISOString(), time: elapsed,
        request: { method: 'GET', url: url.href, httpVersion: 'HTTP/1.1', headers: [], cookies: [],
          queryString: [...url.searchParams].map(([name, value]) => ({ name, value })), headersSize: -1, bodySize: 0 },
        response: { status: response.status, statusText: response.statusText, httpVersion: 'HTTP/1.1', cookies: [],
          headers: [...response.headers].map(([name, value]) => ({ name, value })),
          content: { mimeType: 'application/json', size: Buffer.byteLength(text), text },
          redirectURL: '', headersSize: -1, bodySize: Buffer.byteLength(text) },
        cache: {}, timings: { send: 0, wait: elapsed, receive: 0 } });
    }
    return { log: { version: '1.2', creator: { name: 'Original native refresh workflow', version: '1.0' }, entries } };
  }
  try {
    const before = await capture(['/steady', '/items/a', '/legacy']);
    edition = 2;
    const after = await capture(['/items/c?cursor=next', '/steady', '/steady', '/new']);
    edition = 3;
    const third = await capture(['/steady', '/items/c?cursor=next']);
    edition = 4;
    const fourth = await capture(['/legacy', '/steady', '/items/c?cursor=next']);
    return { before, after, third, fourth, origin };
  } finally { await new Promise(done => server.close(done)); }
}

test('native HTTP capture editions preserve decisions through refresh, independent receive and merchant packaging', async () => {
  const retained = process.env.HAR_REFRESH_OUTPUT;
  const root = retained ? resolve(retained) : await mkdtemp(join(tmpdir(), 'har-refresh-'));
  if (retained) await mkdir(root, { mode: 0o700 });
  await chmod(root, 0o700);
  try {
    const pair = await captures(), oldFile = join(root, 'previous.har'), nextFile = join(root, 'next.har');
    await writeFile(oldFile, json(pair.before), { mode: 0o600 });
    await writeFile(nextFile, json(pair.after), { mode: 0o600 });
    const old = join(root, 'original'); await prepare(oldFile, old);
    const previous = await openWorkspace(old), review = newReview(previous.inventory);
    review.sourceUrl = pair.origin + '/'; review.title = 'Retained API $& source';
    for (const operation of review.operations) {
      const group = previous.inventory.groups.find(row => row.id === operation.groups[0]);
      operation.enabled = true; operation.reviewed = true;
      operation.id = group.path === '/steady' ? 'steady' : group.path === '/legacy' ? 'legacy' : 'item_lookup';
      operation.path = group.path.startsWith('/items/') ? '/items/{id}' : group.path;
      if (operation.id === 'item_lookup') operation.pathExamples = { id: 'example' };
      if (operation.id === 'legacy') {
        operation.description = 'Retained seasonal service';
        operation.responses = { mode: 'author', value: { '200': { description: 'Reviewed seasonal availability',
          content: { 'application/json': { schema: { type: 'object', properties: { state: { type: 'string' } }, additionalProperties: true } } } } } };
      }
    }
    const decisionFile = join(root, 'previous-decisions.json');
    await writeFile(decisionFile, json(review), { mode: 0o600 });
    const saved = await saveReview(old, decisionFile), directory = join(root, 'refresh');
    const requested = { workspace: old, revision: saved.revision, harFile: nextFile, destination: directory };
    const created = await prepareRefresh(requested);
    assert.deepEqual(created.summary, { previousSelected: 3, previousRetained: 0, carried: 1, changed: 1, notObserved: 1, returned: 0, unselectedGroups: 1, ambiguousGroups: 0 });
    assert.equal((await prepareRefresh(requested)).reused, true);
    const packet = await openRefresh(directory), migrated = packet.draft;
    const steady = migrated.operations.find(row => row.id === 'steady');
    const item = migrated.operations.find(row => row.id === 'item_lookup');
    assert.equal(steady.reviewed, true);
    assert.notDeepEqual(steady.groups, review.operations.find(row => row.id === 'steady').groups);
    assert.equal(item.reviewed, false); assert.equal(item.query.cursor.mode, 'unresolved');
    assert.equal(migrated.operations.find(row => row.id === 'legacy').enabled, false);
    assert.ok(packet.report.operations.find(row => row.operationId === 'item_lookup').changes.some(row => row.section === 'responses'));
    item.query.cursor = { mode: 'omit', reason: 'This reviewed operation uses a fixed first page.' }; item.reviewed = true;
    const nextDecision = join(root, 'candidate-decisions.json');
    await writeFile(nextDecision, json(migrated), { mode: 0o600 });
    const candidate = await saveRefreshReview(directory, nextDecision);
    assert.equal((await readRevision(packet.candidate, candidate.revision)).review['x-har-refresh'].previousReviewSha256, saved.revision);
    await writeRefreshPage(directory, join(root, 'reviewed.html'), candidate.revision);
    assert.match(await readFile(join(root, 'reviewed.html'), 'utf8'), /Capture edition changes/);
    await exportRefresh(directory, candidate.revision, join(root, 'export'));
    const receiver = join(root, 'receiver'); await copyRefresh(directory, receiver);
    await rm(directory, { recursive: true }); await rm(old, { recursive: true }); await rm(oldFile); await rm(nextFile);
    const received = await openRefresh(receiver);
    assert.equal(received.manifest.operationId, created.operationId);
    await exportRefresh(receiver, candidate.revision, join(root, 'received-export'));
    assert.deepEqual(await readFile(join(root, 'export', 'openapi.json')), await readFile(join(root, 'received-export', 'openapi.json')));
    // A route can stay absent across editions and return with its authored identity.
    const thirdFile = join(root, 'third.har'), fourthFile = join(root, 'fourth.har');
    await writeFile(thirdFile, json(pair.third), { mode: 0o600 });
    await writeFile(fourthFile, json(pair.fourth), { mode: 0o600 });
    const thirdDirectory = join(root, 'refresh-third');
    const third = await prepareRefresh({ workspace: received.candidate.root, revision: candidate.revision,
      harFile: thirdFile, destination: thirdDirectory });
    const thirdPacket = await openRefresh(thirdDirectory);
    const dormant = thirdPacket.draft.operations.find(row => row.id === 'legacy');
    assert.equal(dormant.description, 'Retained seasonal service');
    assert.equal(dormant.enabled, false); assert.deepEqual(dormant.groups, []);
    assert.equal(dormant['x-har-refresh-retained'].sourceSha256, created.previousSourceSha256);
    const thirdSaved = await saveRefreshReview(thirdDirectory, join(thirdDirectory, 'draft.json'));
    const fourthDirectory = join(root, 'refresh-fourth');
    const fourth = await prepareRefresh({ workspace: thirdPacket.candidate.root, revision: thirdSaved.revision,
      harFile: fourthFile, destination: fourthDirectory });
    const fourthPacket = await openRefresh(fourthDirectory), returned = fourthPacket.draft;
    const seasonal = returned.operations.find(row => row.id === 'legacy');
    assert.equal(fourth.summary.returned, 1); assert.equal(fourth.summary.unselectedGroups, 0);
    assert.equal(seasonal.description, dormant.description);
    assert.deepEqual(seasonal.responses, dormant.responses);
    assert.equal(seasonal.enabled, false); assert.equal(seasonal.reviewed, false);
    assert.equal(fourthPacket.candidate.inventory.groups.find(group => group.id === seasonal.groups[0]).path, '/legacy');
    seasonal.enabled = true; seasonal.reviewed = true;
    const returnedDecision = join(root, 'returned-decisions.json');
    await writeFile(returnedDecision, json(returned), { mode: 0o600 });
    const finalSaved = await saveRefreshReview(fourthDirectory, returnedDecision);
    const finalReceiver = join(root, 'final-receiver'); await copyRefresh(fourthDirectory, finalReceiver);
    await rm(receiver, { recursive: true }); await rm(thirdDirectory, { recursive: true });
    await rm(fourthDirectory, { recursive: true }); await rm(thirdFile); await rm(fourthFile);
    const finalReceived = await openRefresh(finalReceiver);
    assert.equal(finalReceived.manifest.operationId, fourth.operationId);
    const finalExport = await exportRefresh(finalReceiver, finalSaved.revision, join(root, 'final-export'));
    const parent = join(root, 'merchant-packages'); await mkdir(parent, { mode: 0o700 });
    const plan = { schema: 'stellar-forge.api-merchant-plan.v1', sellerServer: 'https://merchant.example/paid', allowLoopbackUpstream: true,
      payment: { network: 'stellar:testnet', asset: 'DEMO_NONPAYABLE_ASSET', payTo: 'DEMO_NONPAYABLE_RECIPIENT', maxTimeoutSeconds: 60 },
      operations: [{ method: 'GET', path: '/steady', id: 'steady', amountAtomic: '10000', responseValidation: 'declared' },
        { method: 'GET', path: '/items/{id}', id: 'lookup', amountAtomic: '9007199254740993', responseValidation: 'declared' },
        { method: 'GET', path: '/legacy', id: 'legacy', amountAtomic: '777', responseValidation: 'declared' }] };
    const planFile = join(root, 'merchant-plan.json'); await writeFile(planFile, json(plan), { mode: 0o600 });
    const merchant = await packageRefresh({ directory: finalReceiver, revision: finalSaved.revision, planFile, parent, name: 'refreshed' });
    assert.equal(merchant.preview.routes.find(row => row.id === 'lookup').amountAtomic, '9007199254740993');
    const reopened = await readPackage(parent, 'refreshed');
    assert.equal(reopened.manifest.files['original-openapi.json'], finalExport.files['openapi.json'].sha256);
    const result = { operation: 'AF825-HAR-REFRESH-20261012', directory: root, node: process.version,
      operationId: fourth.operationId, previousSource: fourth.previousSourceSha256, candidateSource: fourth.candidateSourceSha256,
      previousRevision: thirdSaved.revision, candidateRevision: finalSaved.revision, summary: fourth.summary,
      editions: [created, third, fourth].map(edition => ({ operationId: edition.operationId,
        previousSource: edition.previousSourceSha256, candidateSource: edition.candidateSourceSha256, summary: edition.summary })),
      receivedSourceSha256: digest(await readFile(join(root, 'final-export', 'openapi.json'))),
      merchant: { directory: join(parent, 'refreshed'), routes: merchant.preview.routes.length } };
    await writeFile(join(root, 'result.json'), json(result), { mode: 0o600 });
    console.log(json(result));
  } finally { if (!retained) await rm(root, { recursive: true, force: true }); }
});
