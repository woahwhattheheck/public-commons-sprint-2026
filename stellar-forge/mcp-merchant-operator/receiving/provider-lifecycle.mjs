// MIT. Focused receiving for original provider controls and retained shutdown ownership.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { open, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MerchantReleaseOperator } from '../operator.mjs';
import { MerchantProviderOwners } from '../provider-lifecycle.mjs';
import { RetainedFileReads } from '../retained-file-reads.mjs';

const output = resolve(process.argv[2] ?? 'provider-lifecycle-receiving.json');
await mkdir(dirname(output), { recursive: true });
const work = await mkdtemp(join(dirname(output), '.merchant-provider-lifecycle-'));
const report = { schema: 'stellar-forge.provider-lifecycle-receiving.v1',
  startedAt: new Date().toISOString(), node: process.version, state: 'RUNNING', stages: [] };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function within(promise, label, ms = 8000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(label + ' did not settle.'), { code: 'RECEIVING_TIMEOUT' })), ms);
  })]); } finally { clearTimeout(timer); }
}
async function stage(name, run) {
  const start = performance.now();
  const details = await run();
  report.stages.push({ name, state: 'COMPLETE', elapsedMs: Math.round((performance.now() - start) * 1000) / 1000, ...details });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
}
const failure = (code, message) => Object.assign(new Error(message), { code });
try {
  if (process.argv[3]) await stage('published-source-identity', async () => {
    const manifest = JSON.parse(await readFile(resolve(process.argv[3]), 'utf8'));
    const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
    const observed = [];
    for (const [path, expected] of Object.entries(manifest.files)) {
      const bytes = await readFile(join(repositoryRoot, path));
      const gitBlob = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
      assert.equal(gitBlob, expected, 'Published source differs: ' + path);
      observed.push({ path, gitBlob, bytes: bytes.length });
    }
    return { sourceCommit: manifest.commit, files: observed.length,
      bytes: observed.reduce((sum, file) => sum + file.bytes, 0), sourceIdentitySha256: sha256(Buffer.from(JSON.stringify(observed))) };
  });

  await stage('original-grpc-controls-and-cancel', async () => {
    const token = randomBytes(32).toString('hex'), arrived = deferred(), disconnected = deferred();
    const routes = [], errors = [], sockets = new Set();
    const server = createServer(async (request, response) => {
      try {
        assert.equal(request.headers['x-workspace-token'], token);
        const chunks = []; for await (const bytes of request) chunks.push(bytes);
        const body = Buffer.concat(chunks).toString('utf8');
        routes.push({ method: request.method, path: request.url, inputBytes: Buffer.byteLength(body) });
        assert.equal(request.method, 'POST');
        if (request.url === '/api/call') {
          const input = JSON.parse(body);
          assert.equal(input.method, 'Receiving.Wait');
          assert.deepEqual(input.input, { wait: true });
          response.on('close', () => disconnected.resolve());
          arrived.resolve();
          return;
        }
        if (request.url === '/api/stop') {
          assert.deepEqual(JSON.parse(body), {});
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ state: 'RECEIVING_STOP_OBSERVED' }));
          return;
        }
        throw new Error('Unexpected native adapter route: ' + request.url);
      } catch (error) {
        errors.push({ code: error.code ?? 'RECEIVING_HTTP_ERROR', message: error.message });
        response.writeHead(500); response.end(); arrived.reject(error);
      }
    });
    server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
    const address = server.address();
    const config = { name: 'provider-lifecycle-receiving', releaseStore: join(work, 'releases'),
      exportsDirectory: join(work, 'exports'), sources: {},
      grpcWorkspaces: { workspaces: { source: { label: 'Original adapter receiving transport',
        consoleUrlEnv: 'MERCHANT_LIFECYCLE_RECEIVING_URL', captures: {}, files: {} } } } };
    const options = { grpc: { environment: { MERCHANT_LIFECYCLE_RECEIVING_URL: 'http://127.0.0.1:' + address.port + '/#' + token } } };
    const operator = new MerchantReleaseOperator(config, options);
    const callArgs = { workspace: 'source', revision: '1'.repeat(64), operationId: randomUUID(), method: 'Receiving.Wait', input: { wait: true } };
    let active, shutdownStarted = false;
    try {
      assert(operator.tools.some(tool => tool.name === 'merchant_grpc_stop'));
      active = operator.call('merchant_grpc_call', callArgs).then(value => ({ status: 'fulfilled', value }), error => ({ status: 'rejected', code: error.code }));
      await within(arrived.promise, 'Original gRPC call transport');
      const duringCall = operator.activity;
      assert.equal(duringCall.length, 1);
      assert.equal(duringCall[0].tool, 'merchant_grpc_call');
      assert.equal(duringCall[0].serialized, true);
      assert(!Object.hasOwn(duringCall[0], 'args'));
      await assert.rejects(operator.call('merchant_grpc_call', { ...callArgs, operationId: randomUUID() }), { code: 'OPERATOR_BUSY' });
      const stopped = await within(operator.call('merchant_grpc_stop', { workspace: 'source' }), 'Native stop control');
      assert.equal(stopped.state, 'RECEIVING_STOP_OBSERVED');
      assert.equal(operator.activity.length, 1);
      const closingAt = performance.now(); shutdownStarted = true;
      await within(operator.close(), 'Original provider close');
      const callOutcome = await within(active, 'Accepted gRPC call settlement');
      await within(disconnected.promise, 'Original adapter connection abort');
      assert.deepEqual(callOutcome, { status: 'rejected', code: 'GRPC_OPERATION_INTERRUPTED' });
      assert.equal(operator.activity.length, 0);
      assert.deepEqual(operator.providerShutdown.map(value => ({ name: value.name, state: value.state, attempts: value.attempts })),
        [{ name: 'grpcWorkspaces', state: 'CLOSED', attempts: 1 }]);
      await assert.rejects(operator.call('merchant_grpc_workspaces'), { code: 'OPERATOR_CLOSING' });
      assert.equal(errors.length, 0);
      const shutdownMs = Math.round((performance.now() - closingAt) * 1000) / 1000;
      // The second original instance has no provider yet; close arrives during its import.
      const lazy = new MerchantReleaseOperator(config, options);
      const accepted = lazy.call('merchant_grpc_workspaces');
      const closing = lazy.close();
      const inventory = await within(accepted, 'Accepted lazy native provider call');
      await within(closing, 'Late original provider owner close');
      assert.equal(inventory.workspaces[0].workspace, 'source');
      assert.deepEqual(lazy.providerShutdown.map(value => value.state), ['CLOSED']);
      return { adapter: 'MerchantGrpcWorkspaces', transport: 'loopback HTTP receiving endpoint', routes,
        nativeControlReachedDuringMutation: true, callOutcome, shutdownMs,
        lateImportAcceptedAndClosed: true, shutdown: operator.providerShutdown };
    } finally {
      if (!shutdownStarted) await within(operator.close().catch(() => {}), 'Receiving cleanup close').catch(() => {});
      if (active) await within(active, 'Receiving cleanup call').catch(() => {});
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    }
  });

  await stage('native-file-ownership-and-close-retry', async () => {
    const parentHandle = await open(join(work, 'parent-owner.txt'), 'w+', 0o600);
    const childPath = join(work, 'child-owner.txt');
    await parentHandle.writeFile('retained parent owner\n');
    await writeFile(childPath, 'retained child owner\n', { mode: 0o600 });
    const childHandle = await open(childPath, 'r');
    const originalChildClose = childHandle.close.bind(childHandle);
    const gate = deferred(), parentReady = deferred(), sequence = [];
    let childAttempts = 0, parentAttempts = 0;
    childHandle.close = async () => {
      childAttempts++; sequence.push('child:' + childAttempts);
      if (childAttempts === 1) throw failure('EBUSY', 'Receiving injects a descriptor close failure before the original descriptor is released.');
      return originalChildClose();
    };
    const reads = new RetainedFileReads({ errorPrefix: 'RECEIVING' });
    const parent = { handle: parentHandle, async close() { parentAttempts++; sequence.push('parent:' + parentAttempts); await parentHandle.close(); } };
    const child = {
      read: () => reads.read({ scope: 'child', key: 'source-file', kind: 'receiving', directory: work,
        offset: 0, limit: 4, expectedSha256: sha256(Buffer.from('retained child owner\n')),
        load: async () => ({ readonlyFileHandle: childHandle, bytes: 21,
          sha256: sha256(Buffer.from('retained child owner\n')), name: 'child-owner.txt' }) }),
      close: () => reads.close(),
    };
    const definitions = {
      parent: { configKey: null, dependencies: [], shutdown: 'provider',
        load: async () => ({}), create: () => { parentReady.resolve(); return parent; } },
      child: { configKey: null, dependencies: ['parent'],
        load: async () => { await gate.promise; return {}; },
        create: (_module, _config, _options, dependencies) => { assert.equal(dependencies.parent, parent); return child; } },
    };
    const owners = new MerchantProviderOwners({ definitions, config: {}, options: {},
      loads: new Map(), instances: new Map(), states: new Map(), failure });
    let retained, readerRetained, final;
    try {
      const accepted = owners.invoke('child', provider => provider.read());
      await within(parentReady.promise, 'Original parent handle load');
      owners.beginClose();
      assert.equal(parentAttempts, 0);
      assert.equal(owners.pendingStarts, 1);
      gate.resolve();
      const first = await within(accepted, 'Accepted original retained-file read');
      assert.equal(Buffer.from(first.data, 'base64').toString(), 'reta');
      assert.equal(first.nextOffset, 4);
      let originalFailure;
      try { await owners.finishClose(); } catch (error) { originalFailure = error; }
      assert.equal(originalFailure?.code, 'OPERATOR_SHUTDOWN_INCOMPLETE');
      assert.deepEqual(originalFailure.providers.map(value => ({ name: value.name, code: value.code })), [
        { name: 'child', code: 'RECEIVING_CLOSE_INCOMPLETE' }, { name: 'parent', code: 'PROVIDER_DEPENDENCY_ACTIVE' },
      ]);
      assert.equal(parentAttempts, 0);
      assert.equal((await parentHandle.stat()).size, 22);
      assert.equal((await childHandle.stat()).size, 21);
      retained = owners.shutdown; readerRetained = reads.summary;
      assert.equal(readerRetained.activeFileReads, 1);
      assert.equal(readerRetained.pendingFileCloses, 1);
      owners.beginClose();
      await owners.finishClose();
      await owners.finishClose();
      assert.deepEqual(sequence, ['child:1', 'child:2', 'parent:1']);
      assert.equal(reads.summary.activeFileReads, 0);
      assert.equal(reads.summary.pendingFileCloses, 0);
      await assert.rejects(parentHandle.stat(), { code: 'EBADF' });
      await assert.rejects(childHandle.stat(), { code: 'EBADF' });
      final = owners.shutdown;
    } finally {
      gate.resolve();
      await originalChildClose().catch(() => {});
      await parentHandle.close().catch(() => {});
    }

    // A loader can return its original descriptor after closeScope was requested.
    // It has not published a readId, but failed disposal must retain ownership.
    const latePath = join(work, 'late-loader.txt'), bytes = Buffer.from('late descriptor\n');
    await writeFile(latePath, bytes, { mode: 0o600 });
    const lateHandle = await open(latePath, 'r'), actualLateClose = lateHandle.close.bind(lateHandle);
    const lateReader = new RetainedFileReads({ errorPrefix: 'LATE' }), loading = deferred(), returned = deferred();
    let refuseClose = true, failedAttempts = 0;
    lateHandle.close = async () => {
      if (refuseClose) { failedAttempts++; throw failure('EBUSY', 'Receiving retains an unpublished original descriptor.'); }
      return actualLateClose();
    };
    try {
      const opening = lateReader.read({ scope: 'late', key: 'source-file', kind: 'receiving', directory: work,
        offset: 0, limit: 4, expectedSha256: sha256(bytes), load: async () => {
          loading.resolve(); await returned.promise;
          return { readonlyFileHandle: lateHandle, bytes: bytes.length, sha256: sha256(bytes), name: 'late-loader.txt' };
        } }).then(value => ({ status: 'fulfilled', value }), error => ({ status: 'rejected', code: error.code }));
      await loading.promise;
      const closing = lateReader.closeScope('late').then(() => ({ status: 'fulfilled' }), error => ({ status: 'rejected', code: error.code }));
      returned.resolve();
      assert.deepEqual(await within(opening, 'Original late loader settlement'), { status: 'rejected', code: 'LATE_CLOSING' });
      assert.deepEqual(await within(closing, 'Original late scope close'), { status: 'rejected', code: 'LATE_CLOSE_INCOMPLETE' });
      assert.equal((await lateHandle.stat()).size, bytes.length);
      assert.equal(lateReader.summary.pendingFileCloses, 1);
      await assert.rejects(lateReader.read({ scope: 'late' }), { code: 'LATE_CLOSING' });
      refuseClose = false;
      await lateReader.closeScope('late');
      await assert.rejects(lateHandle.stat(), { code: 'EBADF' });
      assert.equal(lateReader.summary.pendingFileCloses, 0);
      const reopened = await lateReader.read({ scope: 'late', key: 'reopened', kind: 'receiving', directory: work,
        load: async () => ({ bytes: Buffer.from('reopened'), name: 'reopened.txt' }) });
      assert.equal(Buffer.from(reopened.data, 'base64').toString(), 'reopened');
      await lateReader.close();
      return { source: 'original RetainedFileReads and native fs FileHandles with injected EBUSY close failures',
        pendingBorrowerPreventedEarlyOwnerClose: true, retained, readerRetained,
        closeSequence: sequence, final, unpublishedDescriptorRetained: true,
        failedScopeBlocksNewReadsUntilSuccessfulRetry: true, failedAttempts };
    } finally {
      returned.resolve(); refuseClose = false;
      await lateReader.close().catch(() => {});
      await actualLateClose().catch(() => {});
    }
  });
  report.state = 'COMPLETE'; report.finishedAt = new Date().toISOString();
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  await rm(work, { recursive: true, force: true });
  process.stdout.write(JSON.stringify(report) + '\n');
} catch (error) {
  report.state = 'FAILED'; report.finishedAt = new Date().toISOString();
  report.error = { code: error.code ?? 'RECEIVING_FAILED', message: error.message, stack: error.stack };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  process.stderr.write(JSON.stringify(report) + '\n'); process.exitCode = 1;
}
