#!/usr/bin/env node
// MIT. One complete collection lifecycle through the original SF88 inbox.
// Run on Linux: node collections/examples/lifecycle.mjs /ABS/NEW_PRIVATE_RUN
// The profiles demonstrate preparation, retained input and cancellation. The
// signer deliberately fails if imported; payment execution remains in the
// original operator's terminal workflow described in the collection guide.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink, realpath } from 'node:fs/promises';
import { resolve, isAbsolute, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeQueue, openQueue } from '../../queue.mjs';
import { openCollections } from '../model.mjs';
import { serveCollections } from '../server.mjs';

const OPERATION = 'SCF-BUYER-REQUEST-COLLECTIONS-0D0B-20261012';
const sha = value => createHash('sha256').update(value).digest('hex');
const encoded = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const privateFile = (path, value) => writeFile(path,
  typeof value === 'string' || value instanceof Uint8Array ? value : encoded(value),
  { mode: 0o600, flag: 'wx' });
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));

export async function lifecycle(directory) {
  assert.equal(process.platform, 'linux', 'This example uses the same Linux kernel lock as the product.');
  assert.ok(typeof directory === 'string' && isAbsolute(directory) &&
    resolve(directory) === directory && directory !== '/', 'Supply an absolute, new private run directory.');
  assert.equal(await realpath(dirname(directory)), dirname(directory), 'Use a canonical parent directory.');
  await mkdir(directory, { mode: 0o700 });
  const source = join(directory, 'source'), evidence = join(directory, 'evidence');
  const queueRoot = join(directory, 'original-inbox'), storeRoot = join(directory, 'request-collections');
  const exportRoot = join(directory, 'exports');
  for (const path of [source, evidence, exportRoot]) await mkdir(path, { mode: 0o700 });

  const signerModule = join(source, 'signer.mjs'), policy = join(source, 'policy.json');
  await privateFile(join(source, 'signer-dependency.mjs'),
    "export const preparationOnly = true;\n");
  await privateFile(signerModule,
    "import { preparationOnly } from './signer-dependency.mjs';\n" +
    "if (preparationOnly) throw new Error('COLLECTION_EXAMPLE_SIGNER_IMPORTED');\n");
  await privateFile(policy, { example: 'Collection preparation and original inbox cancellation' });
  const emptyBody = join(source, 'empty-request.bin'), reportBody = join(source, 'report-request.json');
  await privateFile(emptyBody, Buffer.alloc(0));
  const reportBytes = encoded({ period: '2026-10', format: 'csv' });
  await privateFile(reportBody, reportBytes);

  const terms = { scheme: 'exact', network: 'stellar:testnet',
    asset: 'collection-example-asset', payTo: 'collection-example-recipient' };
  const definitions = [
    { intentId: 'collection.example.empty', method: 'POST', url: 'https://example.com/empty',
      expect: { ...terms, maxAtomic: '9007199254740993' },
      bodyFile: emptyBody, bodyBytes: 0, bodySha256: sha(Buffer.alloc(0)) },
    { intentId: 'collection.example.report', method: 'POST', url: 'https://example.com/report',
      headers: { 'Content-Type': 'application/json' }, expect: { ...terms, maxAtomic: '7' },
      bodyFile: reportBody, bodyBytes: reportBytes.length, bodySha256: sha(reportBytes) },
    { intentId: 'collection.example.reference', method: 'GET', url: 'https://example.com/reference',
      expect: { ...terms, network: 'stellar:pubnet', maxAtomic: '30000' } },
  ];
  const configFiles = [];
  for (const [index, operation] of definitions.entries()) {
    const path = join(source, 'operator-' + index + '.json');
    await privateFile(path, { operation,
      operator: { python: '/usr/bin/python3', actor: 'collection-example', service: 'customer-handoff',
        policy, ledger: join(source, 'original-ledger.sqlite') },
      signerModule, evidenceDir: evidence, captureBody: false,
      responseFile: { destination: join(directory, 'original-response-' + index + '.bin'), maxBytes: 1048576 } });
    configFiles.push(path);
  }

  await initializeQueue(queueRoot);
  const queue = await openQueue(queueRoot);
  const adopted = await queue.enqueue(configFiles[0]);
  assert.equal(adopted.state, 'QUEUED');
  let collections = await openCollections({ directory: storeRoot, queueRoot });
  let result;
  try {
    const preview = await collections.preview({ configFiles });
    const grouped = Object.fromEntries(preview.totals.map(value => [value.network, value.maxAtomic]));
    assert.deepEqual(grouped, { 'stellar:pubnet': '30000', 'stellar:testnet': '9007199254741000' });
    const saved = await collections.create({ id: 'monthly-customer-handoff', name: 'Monthly customer handoff',
      configFiles, expectedPreviewSha256: preview.previewSha256 });
    assert.equal(saved.state, 'ENQUEUE_PARTIAL');
    const pin = { id: saved.id, expectedManifestSha256: saved.manifestSha256 };
    const manifest = await readJson(join(saved.directory, 'manifest.json'));
    assert.equal(manifest.items[0].adoptedOriginalJob, true);
    assert.equal(manifest.items[0].queueSourceConfigSha256, adopted.sourceConfigSha256);

    // The authoring files can be removed after successful retention. Original
    // signer and policy stay at their original paths with relative imports.
    for (const path of [...configFiles, emptyBody, reportBody]) await unlink(path);
    const reopenedCreate = await collections.create({ id: saved.id, name: saved.name,
      configFiles, expectedPreviewSha256: preview.previewSha256 });
    assert.equal(reopenedCreate.manifestSha256, saved.manifestSha256);
    const enqueued = await collections.enqueue(pin);
    assert.equal(enqueued.state, 'QUEUED');
    assert.equal(enqueued.action.results.length, 3);
    assert.ok(enqueued.action.results.every(value => !value.error));
    assert.equal((await collections.enqueue(pin)).state, 'QUEUED');
    for (const item of enqueued.items) {
      const executionFile = join(queueRoot, 'jobs', sha(item.intentId), 'execution.json');
      assert.equal((await readJson(executionFile)).signerModule, signerModule);
      assert.equal(item.job.attempt, null);
    }
    const retainedEmpty = await readFile(join(queueRoot, 'jobs', sha(definitions[0].intentId), 'request-body.bin'));
    const retainedReport = await readFile(join(queueRoot, 'jobs', sha(definitions[1].intentId), 'request-body.bin'));
    assert.equal(retainedEmpty.length, 0);
    assert.equal(sha(retainedEmpty), definitions[0].bodySha256);
    assert.deepEqual(retainedReport, reportBytes);

    // A second customer review can use this exact original queued request.
    // Its execution config still resolves the same body, signer and policy.
    const sharedConfig = join(queueRoot, 'jobs', sha(definitions[1].intentId), 'execution.json');
    const sharedPreview = await collections.preview({ configFiles: [sharedConfig] });
    const shared = await collections.create({ id: 'customer-report-review', name: 'Customer report review',
      configFiles: [sharedConfig], expectedPreviewSha256: sharedPreview.previewSha256 });
    assert.equal(shared.items[0].job.configSha256, enqueued.items[1].job.configSha256);
    assert.equal(shared.state, 'QUEUED');

    // Pausing before the first selected request retains this run and leaves
    // every original inbox entry available for a later terminal operation.
    const paused = await collections.run({ ...pin, intentIds: definitions.map(value => value.intentId),
      signal: AbortSignal.abort() });
    assert.equal(paused.action.state, 'PAUSED');
    assert.equal(paused.runs.length, 1);
    assert.ok(paused.items.every(value => value.state === 'QUEUED' && value.job.attempt === null));
    const cancelled = await collections.cancel({ ...pin, intentIds: [definitions[1].intentId] });
    assert.equal(cancelled.state, 'PARTIAL');
    assert.equal((await queue.show(definitions[1].intentId)).state, 'CANCELLED');
    assert.equal((await queue.show(definitions[0].intentId)).state, 'QUEUED');

    // User directories next to collections, and unrelated directories inside
    // the internal directory, do not become phantom collection entries.
    await mkdir(join(storeRoot, 'source'), { mode: 0o700 });
    await mkdir(join(storeRoot, 'exports'), { mode: 0o700 });
    await mkdir(join(storeRoot, 'collections', 'unrelated-source'), { mode: 0o700 });
    assert.deepEqual((await collections.list()).collections.map(value => value.id).sort(),
      [saved.id, shared.id].sort());
    assert.equal((await collections.inspect(shared.id)).state, 'CANCELLED');
    const exported = await collections.export({ ...pin, directory: join(exportRoot, saved.id) });
    const repeated = await collections.export({ ...pin, directory: exported.directory });
    assert.equal(repeated.reused, true);
    assert.deepEqual(repeated.files, exported.files);
    for (const file of exported.files) {
      const bytes = await readFile(join(exported.directory, file.name));
      assert.equal(bytes.length, file.bytes);
      assert.equal(sha(bytes), file.sha256);
    }

    await collections.close();
    collections = await openCollections({ directory: storeRoot });
    assert.equal(collections.queueRoot, queueRoot);
    let current = await collections.inspect(saved.id);
    assert.equal(current.manifestSha256, saved.manifestSha256);
    assert.equal(current.state, 'PARTIAL');
    assert.equal(current.runs[0].state, 'PAUSED');
    const queueAfterReopen = await openQueue(queueRoot);
    assert.equal((await queueAfterReopen.show(definitions[1].intentId)).state, 'CANCELLED');

    // The private browser serves these same retained records and export files.
    const workspace = await serveCollections(collections, { port: 0 });
    let workspaceExport;
    try {
      const headers = { Authorization: 'Bearer ' + workspace.token };
      const request = async (path, body) => {
        const response = await fetch(workspace.origin + path, {
          method: body === undefined ? 'GET' : 'POST', redirect: 'error',
          headers: { ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const value = await response.json();
        assert.ok(response.ok, value.error ?? 'The original workspace request failed.');
        return value;
      };
      const page = await fetch(workspace.origin + '/');
      assert.equal(page.status, 200);
      assert.ok(page.headers.get('content-type').startsWith('text/html'));
      await page.arrayBuffer();
      const privateResponse = await fetch(workspace.origin + '/api/status');
      assert.equal(privateResponse.status, 401);
      await privateResponse.arrayBuffer();
      assert.equal((await request('/api/status')).queueRoot, queueRoot);
      const route = '/api/collections/' + encodeURIComponent(saved.id);
      assert.equal((await request(route)).manifestSha256, saved.manifestSha256);
      const command = await request(route + '/command', {
        expectedManifestSha256: saved.manifestSha256,
        intentIds: [definitions[0].intentId, definitions[2].intentId],
      });
      assert.deepEqual(command.argv.slice(-4),
        ['--intent', definitions[0].intentId, '--intent', definitions[2].intentId]);
      assert.equal(command.manifestSha256, saved.manifestSha256);
      const updated = await request(route + '/cancel', {
        expectedManifestSha256: saved.manifestSha256, intentIds: [definitions[2].intentId],
      });
      assert.equal(updated.items[2].state, 'CANCELLED');
      assert.equal((await queue.show(definitions[2].intentId)).state, 'CANCELLED');
      workspaceExport = await request(route + '/export', {
        expectedManifestSha256: saved.manifestSha256,
      });
      assert.equal(workspaceExport.files.length, 5);
      for (const file of workspaceExport.files) {
        const response = await fetch(workspace.origin + file.downloadUrl, { headers, redirect: 'error' });
        assert.equal(response.status, 200);
        const bytes = Buffer.from(await response.arrayBuffer());
        assert.equal(bytes.length, file.bytes);
        assert.equal(sha(bytes), file.sha256);
      }
      assert.equal((await request('/api/collections')).collections.length, 2);
    } finally { await workspace.close(); }
    current = await collections.inspect(saved.id);
    result = {
      schema: 'stellar-forge.sf88.collection-lifecycle.v1', operationId: OPERATION,
      status: 'COMPLETED', mode: 'ORIGINAL_SF88_INBOX_PREPARATION_AND_CANCELLATION',
      sourceRef: process.env.SCF_COLLECTION_SOURCE_REF ?? null, node: process.version,
      originalQueueModule: fileURLToPath(new URL('../../queue.mjs', import.meta.url)),
      directory, queueRoot, collectionDirectory: current.directory,
      collectionId: current.id, manifestSha256: current.manifestSha256, totals: current.totals,
      originalJobs: current.items.map(value => ({ intentId: value.intentId, state: value.state,
        sourceConfigSha256: value.job.sourceConfigSha256, configSha256: value.job.configSha256,
        bodySha256: value.job.bodySha256, bodyBytes: value.job.bodyBytes, attempt: value.job.attempt })),
      pausedRunId: paused.action.runId,
      sharedCollection: { id: shared.id, manifestSha256: shared.manifestSha256,
        originalIntentId: definitions[1].intentId, state: (await collections.inspect(shared.id)).state },
      export: exported,
      workspaceExport: { directory: workspaceExport.directory,
        files: workspaceExport.files.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })) },
      finishedAt: new Date().toISOString(),
    };
    await privateFile(join(directory, 'lifecycle-result.json'), result);
  } finally { await collections.close(); }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    process.stderr.write('Usage: node collections/examples/lifecycle.mjs /ABS/NEW_PRIVATE_RUN\n');
    process.exitCode = 2;
  } else {
    try { process.stdout.write(JSON.stringify(await lifecycle(process.argv[2]), null, 2) + '\n'); }
    catch (error) {
      process.stderr.write(JSON.stringify({ operationId: OPERATION, status: 'FAILED',
        code: error.code ?? error.name, message: error.message }, null, 2) + '\n');
      process.exitCode = 1;
    }
  }
}
