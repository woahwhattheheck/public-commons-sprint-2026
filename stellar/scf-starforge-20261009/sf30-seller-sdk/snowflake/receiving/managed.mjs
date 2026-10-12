#!/usr/bin/env node
// MIT. Receive one original Snowflake edition through the maintained Applications lifecycle.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, lstat, open } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { dirname, basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { atomicFile, boundedFile, canonical, sha256 } from '../../../sf46-release/release-core.mjs';
import { acquireStateLease } from '../../../merchant-fleet-gateway/state-lease.mjs';
import { createRuntimeWorkspace, openRuntimeWorkspace } from '../../../distribution/runtime-workspace/model.mjs';
import { openSnowflakeWorkspace } from '../workspace.mjs';
import { inspectSnowflakeWorkspace } from '../managed.mjs';
import { validateSnowflakeReceivingManifest } from '../transfer.mjs';
import { fault, fields, compileSnowflakeSource } from '../declaration.mjs';
import { inspectSnowflakePartition } from '../source.mjs';

const SCHEMA = 'stellar-forge.snowflake-managed-receiving.v1';
async function jsonFile(filename, maximum = 2097152) {
  const path = resolve(filename);
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
    await boundedFile(dirname(path), basename(path), maximum)));
}
async function optional(filename) {
  try { return JSON.parse(await readFile(filename, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  assert.ok(info.isDirectory() && !info.isSymbolicLink() && !(info.mode & 0o077) &&
    await realpath(path) === path, 'Receiving output must be a canonical private directory.');
}
function privateUrl(value) {
  const url = new URL(value);
  assert.equal(url.protocol, 'http:'); assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.pathname, '/'); assert.equal(url.search, '');
  assert.equal(url.username, ''); assert.equal(url.password, '');
  assert.match(url.hash, /^#[a-f0-9]{64}$/);
  return url;
}
async function request(url, path, input) {
  const response = await fetch(new URL(path, url), {
    method: input === undefined ? 'GET' : 'POST', redirect: 'error',
    headers: { 'X-Snowflake-Workspace': url.hash.slice(1),
      ...(input === undefined ? {} : { 'content-type': 'application/json', origin: url.origin }) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    signal: AbortSignal.timeout(120000),
  });
  assert.match(response.headers.get('content-type') ?? '', /^application\/json(?:;|$)/i);
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length; assert.ok(bytes <= 2097152, 'Unexpected Snowflake control response size.');
    chunks.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!response.ok) throw fault(value.error ?? 'SNOWFLAKE_MANAGED_RECEIVING_HTTP_FAILED',
    value.detail ?? value.message ?? 'Original workspace request failed.', response.status);
  return value;
}
async function verifyOriginals(url, manifest) {
  let bytes = 0;
  for (const original of manifest.partitions) {
    const response = await fetch(new URL('/api/editions/' + manifest.editionId +
      '/partitions/' + original.partition, url), {
      redirect: 'error', headers: { 'X-Snowflake-Workspace': url.hash.slice(1) },
      signal: AbortSignal.timeout(120000),
    });
    assert.equal(response.status, 200);
    const digest = createHash('sha256'); let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length; assert.ok(size <= original.bytes);
      digest.update(chunk);
    }
    assert.equal(size, original.bytes); assert.equal(digest.digest('hex'), original.sha256);
    bytes += size;
  }
  return { partitions: manifest.partitions.length, bytes };
}

async function originalRowCount(manifest, manifestPath) {
  const first = manifest.partitions[0];
  const bytes = await boundedFile(dirname(manifestPath), first.path, first.bytes);
  assert.equal(bytes.length, first.bytes); assert.equal(sha256(bytes), first.sha256);
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const query = compileSnowflakeSource(manifest.source).queries[manifest.queryName];
  assert.ok(query, 'The original receiving manifest must select its declared query.');
  return inspectSnowflakePartition(value, { query, index: 0,
    statementHandle: manifest.statementHandle?.toLowerCase() }).metadata.numRows;
}

async function inspectSnapshot(publication, manifest, rows) {
  assert.equal(publication.status, 'PREPARED');
  const path = join(publication.releaseRoot, 'releases', publication.releaseId, 'sqlite', 'snapshot.sqlite');
  const info = await lstat(path);
  assert.ok(info.isFile() && !info.isSymbolicLink() && !(info.mode & 0o077));
  assert.equal(await realpath(path), path);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    assert.equal(db.prepare("SELECT value FROM __sf30_snowflake_meta WHERE name='editionId'").get()?.value, manifest.editionId);
    assert.equal(db.prepare('SELECT count(*) AS n FROM records').get().n, rows);
    let count = 0;
    for (const original of db.prepare(
      'SELECT partition_number, sha256, bytes, body FROM __sf30_snowflake_originals ORDER BY partition_number').iterate()) {
      const expected = manifest.partitions[count++];
      assert.ok(expected); assert.equal(original.partition_number, expected.partition);
      assert.equal(original.bytes, expected.bytes); assert.equal(original.body.length, expected.bytes);
      assert.equal(original.sha256, expected.sha256); assert.equal(sha256(original.body), expected.sha256);
    }
    assert.equal(count, manifest.partitions.length);
  } finally { db.close(); }
  const file = await open(path, 'r'), digest = createHash('sha256'); let bytes = 0;
  try {
    const before = await file.stat({ bigint: true });
    for await (const chunk of file.createReadStream({ autoClose: false })) { digest.update(chunk); bytes += chunk.length; }
    const after = await file.stat({ bigint: true });
    assert.equal(before.dev, after.dev); assert.equal(before.ino, after.ino);
    assert.equal(before.size, BigInt(bytes)); assert.equal(before.size, after.size);
    assert.equal(before.mtimeNs, after.mtimeNs); assert.equal(before.ctimeNs, after.ctimeNs);
  } finally { await file.close(); }
  return { bytes, sha256: digest.digest('hex') };
}

/** The input selects the existing READY runtime and complete original receiving files. */
export async function receiveManagedSnowflake(input, { onProgress = value => console.log(JSON.stringify(value)) } = {}) {
  fields(input, ['runtimeDirectory', 'managerDirectory', 'workspaceDirectory', 'manifestPath',
    'recordPath', 'merchantDraftPath', 'runtimeOptionsPath', 'environmentFile', 'actor'], 'Managed Snowflake receiving');
  for (const key of ['runtimeDirectory', 'managerDirectory', 'workspaceDirectory', 'manifestPath', 'recordPath', 'merchantDraftPath'])
    assert.ok(typeof input[key] === 'string' && input[key], key + ' is required.');
  const selected = { ...input };
  for (const key of ['runtimeDirectory', 'managerDirectory', 'workspaceDirectory', 'manifestPath',
    'recordPath', 'merchantDraftPath', 'runtimeOptionsPath', 'environmentFile'])
    if (selected[key]) selected[key] = resolve(selected[key]);
  const manifest = await jsonFile(selected.manifestPath);
  validateSnowflakeReceivingManifest(manifest);
  assert.match(manifest.editionId ?? '', /^[a-f0-9]{64}$/, 'Select a complete original exported edition.');
  const expectedRows = await originalRowCount(manifest, selected.manifestPath);
  const draft = await jsonFile(selected.merchantDraftPath);
  const runtimeOptions = selected.runtimeOptionsPath ? await jsonFile(selected.runtimeOptionsPath) : { port: 0 };
  const identity = sha256(canonical({ selected, manifest, draft, runtimeOptions }));
  const parent = dirname(selected.recordPath); await privateDirectory(parent);
  const lock = join(parent, 'receiving-lock-' + sha256(basename(selected.recordPath)).slice(0, 16));
  await privateDirectory(lock);
  const lease = await acquireStateLease(lock);
  let model, record;
  async function save() {
    lease.assertHeld(); record.updatedAt = new Date().toISOString();
    await atomicFile(selected.recordPath, JSON.stringify(record, null, 2) + '\n', 0o600);
  }
  async function note(stage, detail = {}) {
    record.stage = stage; record.lastError = null; await save();
    onProgress({ operationId: record.operationId, stage, ...detail });
  }
  try {
    record = await optional(selected.recordPath);
    if (record) {
      assert.equal(record.schema, SCHEMA); assert.equal(record.inputSha256, identity);
    } else {
      record = { schema: SCHEMA, operationId: randomUUID(), inputSha256: identity,
        input: selected, editionId: manifest.editionId, publicationId: randomUUID(),
        saveRequestId: randomUUID(), runs: {}, stage: 'PREPARED', startedAt: new Date().toISOString() };
      await save();
    }
    if (record.stage === 'COMPLETE') return record;
    if (!record.workspaceId) {
      const original = await openSnowflakeWorkspace({ directory: selected.workspaceDirectory });
      try { record.workspaceId = (await original.state()).id; } finally { await original.close(); }
      await save();
    }
    await inspectSnowflakeWorkspace(selected.workspaceDirectory, { expectedId: record.workspaceId });
    if (!await optional(join(selected.managerDirectory, 'workspace.json')))
      await createRuntimeWorkspace({ directory: selected.managerDirectory });
    model = await openRuntimeWorkspace({ directory: selected.managerDirectory });
    const catalog = await model.applicationsState();
    assert.ok(catalog.catalog.some(item => item.id === 'snowflake-workspace'));
    assert.ok(catalog.providers.some(item => item.id === 'snowflake'));
    const attached = await model.attach({ directory: selected.runtimeDirectory, label: 'Snowflake receiving runtime' });
    assert.equal(attached.status, 'READY');
    if (record.runtimeId) assert.equal(attached.runtimeId, record.runtimeId);
    record.runtimeId = attached.runtimeId; await save();

    const current = async () => (await model.applicationsState()).applications.find(item => item.id === record.applicationId);
    async function retainedRun(id, application) {
      const app = application ?? await current();
      assert.ok(app, 'The saved application must remain available.');
      let found = app.runs.find(item => item.id === id), cursor = app.history?.nextCursor;
      const seen = new Set();
      while (!found && cursor) {
        assert.ok(!seen.has(cursor), 'The original Applications history cursor must advance.');
        seen.add(cursor);
        const page = await model.applicationsHistory({ applicationId: record.applicationId,
          limit: app.history.limit, cursor });
        found = page.runs.find(item => item.id === id); cursor = page.nextCursor;
      }
      return found ?? null;
    }
    async function waitFor(label, read) {
      let last = '';
      for (;;) {
        const value = await read();
        if (value.done) return value.value;
        const changed = JSON.stringify(value.progress ?? {});
        if (changed !== last) { onProgress({ operationId: record.operationId, stage: label, ...value.progress }); last = changed; }
        await pause(1000);
      }
    }
    if (!record.applicationId) {
      if (!record.applicationReviewId) {
        const review = await model.applicationsReview({ runtimeId: record.runtimeId,
          kind: 'snowflake-workspace', label: 'Snowflake original edition receiving',
          settings: { workspaceDirectory: selected.workspaceDirectory, port: 0,
            ...(selected.environmentFile ? { environmentFile: selected.environmentFile } : {}) } });
        record.applicationReviewId = review.id; await save();
      }
      const saved = await model.applicationsSave({ requestId: record.saveRequestId, reviewId: record.applicationReviewId });
      record.applicationId = saved.applicationId; record.applicationRevision = saved.revision; await save();
      if (saved.connectionError) throw fault(saved.connectionError.code, saved.connectionError.message);
    }
    let application = await current(); assert.ok(application);
    if (!application.release) await model.applicationsConnect({ applicationId: record.applicationId });
    await waitFor('CONNECTING', async () => {
      const app = await current();
      if (app.error) throw fault(app.error.code, app.error.message);
      if (app.adoption && !app.adoption.active &&
          ['FAILED', 'INTERRUPTED', 'CANCELLED'].includes(app.adoption.phase))
        throw fault('SNOWFLAKE_MANAGED_ADOPTION_INTERRUPTED',
          'Original adoption ' + app.adoption.id + ' ended in ' + app.adoption.phase +
          '. Run the same receiving input to continue its saved connection.');
      return { done: !!app.release, value: app, progress: { phase: app.phase, operationId: app.adoption?.id } };
    });

    async function start(name) {
      let run = record.runs[name], existing = run &&
        await retainedRun(run.requestId);
      if (existing && !existing.active && existing.phase === 'INTERRUPTED') {
        const recovered = await model.applicationsRecover({ applicationId: record.applicationId, operationId: run.requestId });
        if (recovered.commandActive) await stop(name);
        existing = await retainedRun(run.requestId);
      }
      // A later invocation may continue a confirmed closed process. The application,
      // edition and publication remain the same; every foreground lifetime is retained.
      if (!run || existing && !existing.active && ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(existing.phase)) {
        const review = await model.applicationsStartReview({ applicationId: record.applicationId });
        const previous = run ? [...(run.previous ?? []), { requestId: run.requestId,
          reviewId: run.reviewId, instanceId: run.instanceId ?? null,
          phase: existing.phase, result: existing.result ?? null }] : [];
        run = record.runs[name] = { requestId: randomUUID(), reviewId: review.id,
          createdAt: new Date().toISOString(), previous };
        await save(); existing = null;
      }
      await model.applicationsStart({ applicationId: record.applicationId, requestId: run.requestId, reviewId: run.reviewId });
      let recovered = false, quietPolls = 0;
      const app = await waitFor(name + '-STARTING', async () => {
        const value = await current(), active = await retainedRun(run.requestId, value);
        assert.ok(active, 'The original saved application run must remain in its history.');
        if (!active.active && ['PENDING', 'QUEUED', 'INTERRUPTED'].includes(active.phase)) {
          quietPolls++;
          if (!recovered && (existing || quietPolls >= 3)) {
            recovered = true;
            await model.applicationsRecover({ applicationId: record.applicationId, operationId: run.requestId });
          } else if (recovered && active.phase === 'INTERRUPTED') {
            throw fault('SNOWFLAKE_MANAGED_RUN_INTERRUPTED',
              'Original application ' + record.applicationId + ' operation ' + run.requestId +
              ' is interrupted. Run the same receiving input to continue its retained state.');
          }
        }
        if (!active.active && ['FAILED', 'SUCCEEDED', 'CANCELLED'].includes(active.phase))
          throw fault('SNOWFLAKE_MANAGED_RUN_CLOSED',
            'Original application ' + record.applicationId + ' operation ' + run.requestId +
            ' closed before receiving finished: ' + (active.result?.state ?? active.phase) + '.');
        return { done: active.active && !active.stop && !!active.privateUrl, value,
          progress: { phase: value.phase, applicationId: record.applicationId, operationId: run.requestId } };
      });
      const active = await retainedRun(run.requestId, app);
      const url = privateUrl(active.privateUrl);
      const state = await request(url, '/api/state'); assert.equal(state.id, record.workspaceId);
      assert.match(state.instanceId ?? '', /^[a-f0-9-]{36}$/i);
      run.instanceId = state.instanceId; await save();
      return url;
    }
    async function stop(name) {
      const run = record.runs[name];
      if (!run || run.stopped) return;
      const original = await retainedRun(run.requestId);
      assert.ok(original, 'The original run must remain available when closing its owned process.');
      if (original.active || ['PENDING', 'QUEUED', 'RUNNING', 'INTERRUPTED'].includes(original.phase)) {
        run.stoppingAt ??= new Date().toISOString(); await save();
        await model.applicationsStop({ applicationId: record.applicationId, operationId: run.requestId });
        await waitFor(name + '-STOPPING', async () => {
          const value = await current(), active = await retainedRun(run.requestId, value);
          if (active && !active.active && active.phase === 'INTERRUPTED')
            await model.applicationsRecover({ applicationId: record.applicationId, operationId: run.requestId });
          return { done: !!active && !active.active &&
              ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(active.phase), value,
            progress: { phase: value.phase, operationId: run.requestId } };
        });
      }
      run.stopped = true; run.stoppedAt = new Date().toISOString(); await save();
    }

    if (!record.received) {
      const url = await start('receiving');
      const received = await request(url, '/api/receive', { manifestPath: selected.manifestPath });
      assert.equal(received.status, 'COMPLETE'); assert.equal(received.editionId, manifest.editionId);
      const edition = await request(url, '/api/editions/' + manifest.editionId);
      assert.equal(edition.rowCount, expectedRows);
      record.originals = await verifyOriginals(url, manifest);
      if (edition.review?.decision !== 'ACCEPTED')
        await request(url, '/api/editions/' + manifest.editionId + '/review', {
          decision: 'ACCEPTED', actor: selected.actor ?? 'Snowflake receiving operator',
          note: 'Received and verified every original SQL API partition through the retained native workspace.',
        });
      const publication = await request(url, '/api/prepare', {
        editionId: manifest.editionId, publicationId: record.publicationId, draft, runtime: runtimeOptions,
      });
      assert.equal(publication.status, 'PREPARED');
      record.releaseId = publication.releaseId;
      record.snapshot = await inspectSnapshot(publication, manifest, expectedRows);
      record.received = true; await note('RECEIVED', { editionId: record.editionId, releaseId: record.releaseId, ...record.originals });
    }
    await stop('receiving');
    if (!record.reopened) {
      await model.close(); model = await openRuntimeWorkspace({ directory: selected.managerDirectory });
      application = await current();
      assert.equal(application.revision, record.applicationRevision);
      const url = await start('reopening');
      assert.notEqual(record.runs.reopening.instanceId, record.runs.receiving.instanceId);
      const restored = await request(url, '/api/editions/' + manifest.editionId);
      assert.equal(restored.id, manifest.editionId); assert.equal(restored.rowCount, expectedRows);
      const saved = await request(url, '/api/publications/' + record.publicationId);
      assert.equal(saved.releaseId, record.releaseId);
      const resumed = await request(url, '/api/publications/' + record.publicationId + '/resume', {});
      assert.equal(resumed.releaseId, record.releaseId); assert.equal(resumed.status, 'PREPARED');
      assert.deepEqual(await inspectSnapshot(resumed, manifest, expectedRows), record.snapshot);
      const consoleResult = await request(url, '/api/release-console', { port: 0 });
      const consoleUrl = privateUrl(consoleResult.url);
      const page = await fetch(consoleUrl.origin + '/', { redirect: 'error', signal: AbortSignal.timeout(10000) });
      assert.equal(page.status, 200); assert.match(await page.text(), /Seller releases/);
      record.reopened = true; await note('REOPENED', { applicationId: record.applicationId, releaseId: record.releaseId });
    }
    await stop('reopening');
    await inspectSnowflakeWorkspace(selected.workspaceDirectory, { expectedId: record.workspaceId });
    record.completedAt = new Date().toISOString();
    await note('COMPLETE', { applicationId: record.applicationId, workspaceId: record.workspaceId,
      editionId: record.editionId, publicationId: record.publicationId, releaseId: record.releaseId });
    return record;
  } catch (error) {
    if (record) { record.lastError = { code: error.code ?? 'SNOWFLAKE_RECEIVING_FAILED', message: error.message }; await save(); }
    throw error;
  } finally { await model?.close(); await lease.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--input')
    throw new Error('Usage: node receiving/managed.mjs --input /absolute/private/receiving-input.json');
  receiveManagedSnowflake(await jsonFile(args[1])).catch(error => {
    console.error(JSON.stringify({ error: error.code ?? 'SNOWFLAKE_RECEIVING_FAILED', detail: error.message }));
    process.exitCode = 1;
  });
}
