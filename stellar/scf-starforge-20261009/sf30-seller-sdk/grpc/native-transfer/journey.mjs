#!/usr/bin/env node
// MIT. One complete customer continuation over the original installed gRPC state.
import { mkdir, readFile, open, readdir, lstat, realpath, rename } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const SCHEMA = 'stellar-forge.grpc-workspace-migration-native-receiving.v1';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' :
  value && typeof value === 'object' ? '{' + Object.keys(value).sort().filter(key => value[key] !== undefined)
    .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const digest = value => createHash('sha256').update(value).digest('hex');
const same = (left, right) => canonical(left) === canonical(right);
const stamp = () => new Date().toISOString();
const need = (value, message) => { if (!value) throw new Error(message); };
function argumentsOf(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    need(['--work', '--workspace', '--source-root', '--source-commit', '--operations-run',
      '--chromium', '--playwright-modules'].includes(name) && !Object.hasOwn(args, name) &&
      argv[i + 1] && !argv[i + 1].startsWith('--'), 'Select each original receiving input once.');
    args[name] = argv[++i];
  }
  for (const name of ['--work', '--workspace', '--source-root', '--source-commit', '--operations-run', '--chromium'])
    need(args[name], 'Supply ' + name + '.');
  need(/^[a-f0-9]{40}$/.test(args['--source-commit']), 'Select the original installed source commit.');
  return { work: resolve(args['--work']), workspace: resolve(args['--workspace']),
    sourceRoot: resolve(args['--source-root']), sourceCommit: args['--source-commit'],
    operationsRun: resolve(args['--operations-run']), chromium: resolve(args['--chromium']),
    playwrightModules: args['--playwright-modules'] ?? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES };
}
async function optionalJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function atomic(path, value) {
  const temporary = path + '.' + randomUUID() + '.tmp', bytes = Buffer.isBuffer(value) ? value :
    Buffer.from(JSON.stringify(value, null, 2) + '\n');
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, path);
  const directory = await open(dirname(path), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}
async function identity(path) {
  const handle = await open(path, 'r');
  try {
    const before = await handle.stat(), hash = createHash('sha256'), buffer = Buffer.alloc(262144);
    need(before.isFile(), 'Read a complete original regular file.');
    let offset = 0;
    while (offset < before.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, before.size - offset), offset);
      need(bytesRead, 'The original file ended before its saved length.');
      hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
    }
    const after = await handle.stat();
    need(before.dev === after.dev && before.ino === after.ino && before.size === after.size &&
      before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs, 'The original file changed while reading.');
    return { bytes: offset, sha256: hash.digest('hex') };
  } finally { await handle.close(); }
}
async function filesAt(directory) {
  const files = [];
  async function visit(root, relative = '') {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const path = join(root, entry.name), name = relative ? relative + '/' + entry.name : entry.name;
      need(!entry.isSymbolicLink(), 'Retain original state files without a symbolic-link alias.');
      if (entry.isDirectory()) await visit(path, name);
      else { need(entry.isFile(), 'Retain original regular state files.'); files.push({ path: name, ...await identity(path) }); }
    }
  }
  await visit(directory); return files.sort((a, b) => a.path.localeCompare(b.path));
}
function valueOf(result) {
  const pending = [result], seen = new Set();
  while (pending.length) {
    const value = pending.shift();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (value.isError) throw new Error(value.content?.find(item => item.type === 'text')?.text ?? 'Original merchant tool failed.');
    if (typeof value.schema === 'string' || typeof value.exportId === 'string' ||
      Array.isArray(value.items) || typeof value.received === 'boolean' ||
      UUID.test(value.id ?? '') && (value.binding || typeof value.url === 'string')) return value;
    for (const key of ['structuredContent', 'result', 'delivery'])
      if (value[key] && typeof value[key] === 'object') pending.push(value[key]);
    for (const item of value.content ?? []) if (item.type === 'text') {
      try { pending.push(JSON.parse(item.text)); } catch {}
    }
  }
  throw new Error('The original merchant returned no complete structured result.');
}
async function nativeApi(url, action, body) {
  const selected = new URL(url), response = await fetch(selected.origin + '/api/' + action, {
    method: body === undefined ? 'GET' : 'POST', redirect: 'error',
    headers: { origin: selected.origin, 'x-workspace-token': selected.hash.slice(1),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(3600000),
  });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.detail ?? value.error ?? 'Original native action failed.'),
    { code: value.error, status: response.status });
  return value;
}
const archiveOf = record => ({ sha256: record.archive.sha256, bytes: record.archive.bytes,
  manifestSha256: record.manifest.sha256, transferId: record.id });
const captureResult = value => ({ id: value.id, state: value.state, ...archiveOf(value),
  files: value.manifest.files.length, counts: value.manifest.counts });
const interruption = () => Object.assign(new Error('Continue the original durably saved file prefix.'),
  { code: 'ORIGINAL_RECEIVING_PREFIX_RETAINED' });

export async function main(argv = process.argv.slice(2)) {
  const input = argumentsOf(argv), P = 'stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/';
  need(input.work !== input.workspace && !input.work.startsWith(input.workspace + '/') &&
    !input.workspace.startsWith(input.work + '/'), 'Keep the receiving operation outside its original native workspace.');
  for (const path of [input.workspace, input.sourceRoot])
    need(await realpath(path) === path, 'Select the actual original source and workspace paths.');
  await mkdir(input.work, { recursive: true, mode: 0o700 });
  const workInfo = await lstat(input.work);
  need(await realpath(input.work) === input.work && workInfo.isDirectory() && !workInfo.isSymbolicLink() &&
    !(workInfo.mode & 0o077), 'Use the original private real receiving directory.');
  const moduleAt = path => import(pathToFileURL(join(input.sourceRoot, path)).href);
  const { acquireStateLease } = await moduleAt('stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs');
  const lease = await acquireStateLease(input.work);
  try {
    const journalPath = join(input.work, 'journey.json');
    const binding = { work: input.work, workspace: input.workspace, sourceRoot: input.sourceRoot,
      operationsRun: input.operationsRun };
    let journal = await optionalJson(journalPath);
    if (!journal) journal = { schema: SCHEMA, id: randomUUID(), input: binding, state: 'STARTED',
      startedAt: stamp(), sourceEditions: [], phases: [], intents: {}, refs: {}, sessions: [] };
    need(journal.schema === SCHEMA && UUID.test(journal.id) && same(journal.input, binding),
      'Continue the same original migration operation and its inputs.');
    const save = async () => { lease.assertHeld(); await atomic(journalPath, journal); };
    const intent = async (name, build) => {
      if (!journal.intents[name]) { journal.intents[name] = await build(); await save(); }
      return structuredClone(journal.intents[name]);
    };
    const remember = async (name, value) => {
      if (journal.refs[name] !== undefined) need(same(journal.refs[name], value), 'The original retained ' + name + ' changed.');
      else { journal.refs[name] = value; await save(); }
      return journal.refs[name];
    };
    const phase = async (name, operation) => {
      const old = journal.phases.find(row => row.name === name);
      if (old?.state === 'COMPLETE') return old.result;
      const row = old ?? { name, state: 'STARTED', startedAt: stamp() };
      if (!old) journal.phases.push(row);
      journal.state = 'STARTED'; delete journal.error; await save();
      const result = await operation();
      row.state = 'COMPLETE'; row.completedAt = stamp(); row.result = result; await save();
      process.stdout.write(JSON.stringify({ phase: name, state: 'COMPLETE', result }) + '\n');
      return result;
    };
    if (journal.state === 'COMPLETE') { process.stdout.write(JSON.stringify(journal) + '\n'); return journal; }
    const tokenEnv = 'SCF_GRPC_MIGRATION_RECEIVING_TOKEN';
    const environment = { ...process.env, [tokenEnv]: process.env[tokenEnv] || randomBytes(32).toString('hex') };
    const runController = new AbortController(), interrupt = () => runController.abort();
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    const session = { startedAt: stamp(), sourceCommit: input.sourceCommit, state: 'STARTED' };
    journal.sessions.push(session);
    if (!journal.sourceEditions.some(row => row.commit === input.sourceCommit))
      journal.sourceEditions.push({ commit: input.sourceCommit, selectedAt: stamp() });
    let product, client, merchant, browser, page, cold;
    const extraClients = new Set();
    async function closeAll() {
      const outcomes = await Promise.allSettled([
        browser ? browser.close().then(() => { browser = null; page = null; }) : Promise.resolve(),
        client ? client.close().then(() => { client = null; }) : Promise.resolve(),
        ...[...extraClients].map(value => value.close().then(() => { extraClients.delete(value); })),
      ]);
      if (cold) try { await cold.close(); cold = null; } catch (reason) { outcomes.push({ status: 'rejected', reason }); }
      if (product) try { await product.close(); product = null; merchant = null; } catch (reason) { outcomes.push({ status: 'rejected', reason }); }
      const errors = outcomes.filter(row => row.status === 'rejected').map(row => row.reason);
      if (errors.length) throw new AggregateError(errors, 'Continue closure of every original migration resource.');
    }
    try {
      await save();
      const [{ initializeGrpcProduct, openGrpcProduct }, { GrpcProductClient, inspectReceivedGrpcProduct },
        { createGrpcTransferClient }, receiving, { createGrpcWorkspace }, { main: productMain }] = await Promise.all([
        moduleAt('products/grpc-merchant/workspace.mjs'), moduleAt('products/grpc-merchant/client.mjs'),
        moduleAt(P + 'transfer/client.mjs'), moduleAt(P + 'transfer/receiving.mjs'),
        moduleAt(P + 'workspace/model.mjs'), moduleAt('products/grpc-merchant/cli.mjs'),
      ]);
      await phase('original-completed-operations-and-call-records', async () => {
        const bytes = await readFile(input.operationsRun), original = JSON.parse(bytes.toString('utf8'));
        need(original.schema === 'stellar-forge.grpc-operations-native-receiving.v1' && original.state === 'COMPLETE' &&
          original.result?.allOwnedResourcesClosed === true && original.input?.workspace === input.workspace,
          'Use the same completed original operations receiving before migrating its project.');
        const files = await filesAt(join(input.workspace, 'attempts'));
        need(files.length > 0 && same(files, original.refs.originalCalls.files),
          'Select the exact original native call records accepted by the preceding complete operation.');
        const current = await optionalJson(join(input.workspace, 'current.json'));
        need(SHA.test(current?.revision), 'The original project has a saved current source revision.');
        await remember('original', { operationsRun: { path: input.operationsRun, bytes: bytes.length, sha256: digest(bytes),
          id: original.id, caseId: original.refs.caseId, incident: original.refs.browserSaved },
          calls: original.refs.originalCalls.calls, files, callsSha256: digest(canonical(files)), current });
        return { originalOperation: original.id, caseId: original.refs.caseId, incident: original.refs.browserSaved,
          calls: original.refs.originalCalls.calls.length, callFiles: files.length, callsSha256: journal.refs.original.callsSha256 };
      });
      need(same(await identity(input.operationsRun), { bytes: journal.refs.original.operationsRun.bytes,
        sha256: journal.refs.original.operationsRun.sha256 }), 'Keep the completed original operations result.');
      need(same(await filesAt(join(input.workspace, 'attempts')), journal.refs.original.files),
        'The first original call-file observation remains the receiving baseline.');
      const directories = { native: join(input.work, 'received-native'), following: join(input.work, 'received-following'),
        host: join(input.work, 'received-merchant-host'), customer: join(input.work, 'received-merchant-customer'),
        browser: join(input.work, 'received-browser'), download: join(input.work, 'native-download'),
        merchantDownload: join(input.work, 'merchant-download'), product: join(input.work, 'product') };
      const handles = { schema: 'stellar-forge.grpc-product-handles.v1', captures: {}, reflections: {},
        files: { migration: { kind: 'workspace-transfer', path: join(directories.download, 'grpc-workspace.tar.gz') } },
        destinations: { migration: { label: 'Original migration receiving', directory: directories.host } } };
      const handlesFile = join(input.work, 'handles.json'), existingHandles = await optionalJson(handlesFile);
      if (existingHandles) need(same(existingHandles, handles), 'Preserve the original installed host handles.');
      else await atomic(handlesFile, handles);
      await initializeGrpcProduct({ directory: directories.product, workspaceDirectory: input.workspace,
        workspace: 'migration', name: 'Complete original gRPC migration', handlesFile });
      product = await openGrpcProduct({ directory: directories.product, port: 0, workspacePort: 0,
        sellerPort: 0, operationsPort: 0, tokenEnv }, { environment });
      client = createGrpcTransferClient({ url: product.browserUrl });
      merchant = new GrpcProductClient({ directory: directories.product, environment, signal: runController.signal });
      const ready = await merchant.ready();
      await remember('productIdentity', { productId: ready.productId, workspace: ready.workspace,
        operatorWorkspaceId: ready.operatorWorkspaceId });
      session.nativeInstanceId = ready.nativeInstanceId; await save();
      const request = (action, body) => client.request(action, body, { signal: runController.signal });
      async function installed(args) {
        // The CLI reads the same selected token environment as a normal process
        // launch. Scope it to this owned invocation and restore the caller value.
        const previous = process.env[tokenEnv]; process.env[tokenEnv] = environment[tokenEnv];
        try { return await productMain(args); }
        finally { if (previous === undefined) delete process.env[tokenEnv]; else process.env[tokenEnv] = previous; }
      }
      async function completeFiles(owner, capture) {
        const rows = []; let offset = 0, snapshot;
        for (;;) {
          const value = await owner.request('files', { id: capture.id, offset, limit: 31,
            ...(snapshot ? { expectedSnapshot: snapshot } : {}) }, { signal: runController.signal });
          snapshot ??= value.snapshot;
          need(value.snapshot === snapshot && value.offset === offset, 'Continue the complete original immutable file inventory.');
          rows.push(...value.items);
          if (value.nextOffset === null) {
            need(rows.length === value.total && same(rows, capture.manifest.files),
              'Read every original manifest member once through the native page contract.');
            return { files: rows.length, snapshot };
          }
          offset = value.nextOffset;
        }
      }
      await phase('complete-native-capture-pages-and-installed-cli', async () => {
        const body = await intent('capture', async () => ({ id: randomUUID(),
          expectedBinding: (await request('list', {})).binding, maxBytes: 8 * 1024 ** 3 }));
        const captured = await request('capture', body), repeated = await request('capture', body);
        need(captured.state === 'COMPLETED' && same(archiveOf(captured), archiveOf(repeated)) &&
          same(captured.manifest, repeated.manifest), 'Continue the first committed full native capture.');
        need(captured.manifest.counts.attempts === journal.refs.original.calls.length,
          'Include every original native application attempt.');
        need(captured.manifest.files.some(file => file.path.includes('/operations/cases/' + journal.refs.original.operationsRun.caseId + '/')),
          'Include the original complete reviewed incident history.');
        await remember('capture', captured);
        const pages = await completeFiles(client, captured);
        const viaCli = await installed(['transfer', 'read', '--dir', directories.product, '--id', captured.id,
          '--output', join(input.work, 'installed-capture.json')]);
        need(same(archiveOf(viaCli), archiveOf(captured)), 'Forward the original native capture through the installed CLI.');
        return { ...captureResult(captured), ...pages, installedCli: true };
      });
      const selected = archiveOf(journal.refs.capture);
      await phase('native-download-prefix-and-complete-local-archive', async () => {
        const selection = await intent('download', () => ({ id: selected.transferId,
          expectedManifestSha256: selected.manifestSha256, directory: directories.download }));
        if (!journal.refs.downloadPrefix) {
          try {
            await client.downloadTo(selection, { signal: runController.signal, progress: async value => {
              await remember('downloadPrefix', { id: value.id, bytes: value.bytes, receivedBytes: value.receivedBytes });
              throw interruption();
            } });
          } catch (error) { if (error.code !== 'ORIGINAL_RECEIVING_PREFIX_RETAINED') throw error; }
        }
        const result = await client.downloadTo(selection, { signal: runController.signal });
        const repeated = await client.downloadTo(selection, { signal: runController.signal });
        need(result.sha256 === selected.sha256 && result.bytes === selected.bytes && repeated.reused === true,
          'Resume and reuse the original complete native archive.');
        const actual = await identity(result.archivePath);
        need(same(actual, { sha256: selected.sha256, bytes: selected.bytes }), 'Keep the full downloaded archive bytes.');
        const inspected = await receiving.inspectGrpcWorkspaceArchive({ archivePath: result.archivePath,
          expectedSha256: selected.sha256, expectedBytes: selected.bytes, expectedManifestSha256: selected.manifestSha256 },
          { signal: runController.signal });
        need(same(inspected.manifest, journal.refs.capture.manifest), 'Inspect the same complete native source manifest.');
        await remember('download', { archivePath: result.archivePath, directory: result.directory, ...actual,
          manifestSha256: selected.manifestSha256 });
        return { ...journal.refs.download, resumedPrefix: journal.refs.downloadPrefix ?? null,
          files: inspected.manifest.files.length };
      });
      await phase('native-upload-continuation-and-original-completion', async () => {
        const body = await intent('upload', () => ({ id: randomUUID(), path: journal.refs.download.archivePath,
          expectedSha256: selected.sha256, expectedBytes: selected.bytes }));
        if (!journal.refs.uploadPrefix) {
          try {
            await client.uploadFile(body, { signal: runController.signal, progress: async value => {
              await remember('uploadPrefix', { id: value.id, bytes: value.bytes, receivedBytes: value.receivedBytes });
              throw interruption();
            } });
          } catch (error) { if (error.code !== 'ORIGINAL_RECEIVING_PREFIX_RETAINED') throw error; }
        }
        const completed = await client.uploadFile(body, { signal: runController.signal });
        need(completed.state === 'COMPLETED' && completed.receivedBytes === selected.bytes,
          'Recover the first full original upload after its returned progress was interrupted.');
        const bad = await intent('invalid-completed-upload-replay', async () => {
          const file = await open(journal.refs.download.archivePath, 'r'), prefix = Buffer.alloc(Math.min(7, selected.bytes));
          try { await file.read(prefix, 0, prefix.length, 0); } finally { await file.close(); }
          prefix[0] ^= 1;
          return { id: body.id, sha256: selected.sha256, bytes: selected.bytes, offset: 0,
            base64: prefix.toString('base64'), chunkSha256: digest(prefix) };
        });
        let rejected = false;
        try { await request('upload', bad); } catch (error) {
          need(/^GRPC_TRANSFER_/.test(error.code ?? ''), 'The original upload returned its native replay failure.');
          rejected = true;
        }
        need(rejected, 'Reject a different repeated prefix of the already completed archive.');
        const preserved = await request('upload-status', { id: body.id });
        need(preserved.state === 'COMPLETED' && preserved.sha256 === selected.sha256 &&
          preserved.receivedBytes === selected.bytes, 'Preserve the first accepted completed upload.');
        const inspected = await request('inspect', { archive: { kind: 'upload', id: body.id } });
        need(inspected.manifestSha256 === selected.manifestSha256 && inspected.sha256 === selected.sha256,
          'Inspect the complete originally received archive.');
        await remember('upload', { id: body.id, state: preserved.state, sha256: preserved.sha256, bytes: preserved.bytes });
        return { ...journal.refs.upload, resumedPrefix: journal.refs.uploadPrefix ?? null, invalidReplayRejected: true };
      });
      await phase('native-receiving-and-original-history-reopen', async () => {
        const body = await intent('native-receive', () => ({ id: randomUUID(),
          archive: { kind: 'upload', id: journal.refs.upload.id }, directory: directories.native,
          expectedSha256: selected.sha256, expectedBytes: selected.bytes, expectedManifestSha256: selected.manifestSha256 }));
        const received = await request('receive', body), repeated = await request('receive', body);
        need(received.state === 'COMPLETED' && same(received.result.receipt, repeated.result.receipt) &&
          same(received.result.counts, journal.refs.capture.manifest.counts),
          'Receive all original native histories under one retained receipt.');
        await remember('nativeReceipt', received.result.receipt);
        return { id: body.id, directory: directories.native, receipt: received.result.receipt,
          counts: received.result.counts, currentRevision: received.binding.current?.revision };
      });
      await phase('received-native-edit-and-repeat-preservation', async () => {
        const id = journal.intents['native-receive'].id;
        const record = await request('receipt', { id });
        const opened = await request('open', { id, expectedBinding: record.binding });
        const state = await nativeApi(opened.url, 'state');
        const body = await intent('received-source-edit', async () => {
          const revision = await nativeApi(opened.url, 'open', { revision: state.currentRevision });
          return { baseRevision: state.currentRevision, source: revision.source, protoSource: revision.protoSource,
            plan: revision.plan, title: 'Migrated original workspace ' + journal.id };
        });
        const expectedRevision = digest(canonical({ source: body.source, protoSource: body.protoSource,
          plan: body.plan, title: body.title }));
        if (state.currentRevision === body.baseRevision) await nativeApi(opened.url, 'save', body);
        else need(state.currentRevision === expectedRevision, 'Continue the already saved received source revision.');
        const after = await nativeApi(opened.url, 'state');
        need(after.currentRevision === expectedRevision, 'Save the original source with its reviewed receiving title.');
        const current = await nativeApi(opened.url, 'open', { revision: expectedRevision });
        need(same(current.protoSource, body.protoSource) && same(current.plan, body.plan),
          'Keep complete original source and merchant route data in the received revision.');
        await remember('receivedEdit', { revision: expectedRevision, generation: after.generation, title: body.title });
        await request('close', { id });
        const repeated = await request('receive', journal.intents['native-receive']);
        need(repeated.binding.current.revision === expectedRevision &&
          same(repeated.result.receipt, journal.refs.nativeReceipt), 'A repeated original receiving preserves later edits.');
        const independent = await receiving.receiveGrpcWorkspaceArchive({ archivePath: journal.refs.download.archivePath,
          directory: directories.native, expectedSha256: selected.sha256, expectedBytes: selected.bytes,
          expectedManifestSha256: selected.manifestSha256, operationId: id }, { signal: runController.signal, env: environment });
        need(independent.reused === true && independent.native.currentRevision === expectedRevision,
          'The original offline/native audit also preserves the received current revision.');
        return { ...journal.refs.receivedEdit, receipt: independent.receipt,
          originalCounts: independent.native.originalCounts, repeatedReceivingPreserved: true };
      });
      await phase('following-workspace-capture-and-cold-receiving', async () => {
        const id = journal.intents['native-receive'].id, record = await request('receipt', { id });
        const opened = await request('open', { id, expectedBinding: record.binding });
        const nextClient = createGrpcTransferClient({ url: opened.url }); extraClients.add(nextClient);
        try {
          const capture = await intent('following-capture', async () => ({ id: randomUUID(),
            expectedBinding: (await nextClient.request('list', {})).binding }));
          const saved = await nextClient.request('capture', capture, { signal: runController.signal });
          need(saved.manifest.origin.binding.current.revision === journal.refs.receivedEdit.revision &&
            saved.manifest.files.some(file => file.path.startsWith('observations/prior-transfer/')),
            'Recapture the current native project and retain its earlier receiving observations.');
          const pages = await completeFiles(nextClient, saved);
          const download = await nextClient.downloadTo({ id: capture.id, expectedManifestSha256: saved.manifest.sha256,
            directory: join(input.work, 'following-download') }, { signal: runController.signal });
          await remember('followingCapture', { ...captureResult(saved), archivePath: download.archivePath,
            manifest: saved.manifest });
          const body = await intent('following-receive', () => ({ archivePath: download.archivePath,
            directory: directories.following, expectedSha256: saved.archive.sha256, expectedBytes: saved.archive.bytes,
            expectedManifestSha256: saved.manifest.sha256, operationId: randomUUID() }));
          const received = await receiving.receiveGrpcWorkspaceArchive(body, { signal: runController.signal, env: environment });
          need(received.native.currentRevision === journal.refs.receivedEdit.revision,
            'Cold receiving of the following complete archive reopens its later saved source.');
          return { id: capture.id, manifestSha256: saved.manifest.sha256, directory: directories.following,
            currentRevision: received.native.currentRevision, files: pages.files, receipt: received.receipt };
        } finally {
          try { await nextClient.close(); extraClients.delete(nextClient); } finally { await request('close', { id }); }
        }
      });
      await phase('merchant-host-alias-intake-and-receiving', async () => {
        const upload = await intent('merchant-upload', () => ({ operationId: randomUUID(), file: 'migration',
          expectedSha256: selected.sha256, expectedBytes: selected.bytes }));
        const received = valueOf(await merchant.uploadWorkspaceArchive(upload));
        need(received.state === 'COMPLETED' && received.sha256 === selected.sha256,
          'Use the host-declared complete original archive file through the installed merchant.');
        const requestInput = await intent('merchant-host-receive', () => ({ operationId: randomUUID(),
          archive: { kind: 'upload', id: upload.operationId }, destination: 'migration',
          expectedSha256: selected.sha256, expectedBytes: selected.bytes, expectedManifestSha256: selected.manifestSha256 }));
        const result = valueOf(await merchant.receiveWorkspaceInHost(requestInput));
        need(result.state === 'COMPLETED' && result.request.directory === directories.host &&
          same(result.result.counts, journal.refs.capture.manifest.counts),
          'Resolve the original host destination and receive the complete project through its merchant tool.');
        const current = valueOf(await merchant.workspaceReceiving(requestInput.operationId));
        const opened = valueOf(await merchant.openReceivedWorkspace({ operationId: requestInput.operationId,
          expectedBinding: current.binding }));
        const state = await nativeApi(opened.url, 'state');
        need(state.currentRevision === journal.refs.original.current.revision, 'Open the original merchant-received source.');
        await merchant.closeReceivedWorkspace(requestInput.operationId);
        return { uploadId: upload.operationId, operationId: requestInput.operationId, directory: directories.host,
          receipt: result.result.receipt, counts: result.result.counts, currentRevision: state.currentRevision };
      });
      await phase('complete-merchant-export-and-installed-customer-receiving', async () => {
        const requestInput = await intent('merchant-export', () => ({ operationId: selected.transferId,
          expectedManifestSha256: selected.manifestSha256 }));
        if (!journal.refs.merchantExport) {
          const exported = valueOf(await merchant.exportWorkspace(requestInput));
          const inspected = await merchant.inspectExport(exported.exportId);
          need(inspected.manifest.kind === 'workspace-transfer' && inspected.manifest.files.length === 2,
            'Retain the original two-file whole-workspace customer export.');
          await remember('merchantExport', { exportId: exported.exportId, manifestSha256: inspected.manifestSha256,
            files: inspected.manifest.files });
        }
        const exported = journal.refs.merchantExport;
        const body = await intent('merchant-customer-receive', () => ({ exportId: exported.exportId,
          directory: directories.merchantDownload, destination: directories.customer, operationId: randomUUID(),
          expectedManifestSha256: exported.manifestSha256, expectedTransferManifestSha256: selected.manifestSha256,
          expectedArchiveSha256: selected.sha256, expectedArchiveBytes: selected.bytes }));
        const received = await merchant.receiveWorkspace({ ...body, signal: runController.signal,
          receivingEnvironment: environment });
        const repeated = await merchant.receiveWorkspace({ ...body, signal: runController.signal,
          receivingEnvironment: environment });
        const offline = await inspectReceivedGrpcProduct(directories.merchantDownload,
          { expectedExportId: exported.exportId, expectedManifestSha256: exported.manifestSha256 });
        need(offline.kind === 'workspace-transfer' && offline.files.length === 2 &&
          same(received.originalReceiving, repeated.originalReceiving) &&
          received.originalReceiving?.operationId === body.operationId,
          'Reuse the same full merchant download and original native receipt.');
        const viaCli = await installed(['receive-workspace', '--dir', directories.product, '--export-id', exported.exportId,
          '--out', directories.merchantDownload, '--destination', directories.customer, '--id', body.operationId,
          '--manifest-sha256', exported.manifestSha256, '--transfer-manifest-sha256', selected.manifestSha256,
          '--archive-sha256', selected.sha256, '--archive-bytes', String(selected.bytes)]);
        need(same(viaCli.originalReceiving, received.originalReceiving), 'The installed customer command preserves the same original receiving.');
        await remember('merchantCustomerReceipt', received.originalReceiving);
        return { exportId: exported.exportId, outerManifestSha256: exported.manifestSha256,
          nativeManifestSha256: selected.manifestSha256, archiveSha256: selected.sha256, archiveBytes: selected.bytes,
          directory: directories.customer, receipt: received.originalReceiving,
          files: offline.files.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })) };
      });
      async function openBrowser() {
        if (browser) return;
        need(input.playwrightModules, 'Select the original installed Playwright dependency.');
        const require = createRequire(resolve(input.playwrightModules) + '/'), { chromium } = require('playwright');
        need((await lstat(input.chromium)).isFile(), 'Use the observed native Chromium executable.');
        const temporary = join(input.work, 'browser-temporary');
        await mkdir(temporary, { recursive: true, mode: 0o700 });
        const previous = process.env.TMPDIR; process.env.TMPDIR = temporary;
        try {
          browser = await chromium.launch({ executablePath: input.chromium, headless: true,
            env: { ...environment, TMPDIR: temporary },
            args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
        } finally { if (previous === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previous; }
        page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
        page.setDefaultTimeout(120000);
        page.on('dialog', dialog => dialog.accept().catch(() => {}));
      }
      await phase('native-browser-complete-receiving-desktop-and-mobile', async () => {
        await openBrowser();
        await page.goto(product.browserUrl, { waitUntil: 'networkidle' });
        await page.locator('[data-view="transfer"]').click();
        await page.locator('[data-transfer="refresh"]').click();
        const row = page.locator('[data-transfer="captures"] tr').filter({ hasText: selected.transferId.slice(0, 12) });
        await row.getByRole('button', { name: 'Inspect', exact: true }).click();
        await page.waitForFunction(id => document.querySelector('[data-transfer="capture-detail"]').textContent.includes(id), selected.transferId);
        await page.locator('[data-transfer="search"]').fill('/attempts/');
        await page.locator('[data-transfer="filter"]').click();
        await page.waitForFunction(() => !document.querySelector('[data-transfer="filter"]').disabled &&
          document.querySelector('[data-transfer="files"] tr'));
        need(await page.locator('[data-transfer="files"]').textContent().then(text => text.includes('workspace/attempts/')),
          'Filter original application records in the real migration editor.');
        await page.locator('[data-transfer="search"]').fill('');
        await page.locator('[data-transfer="filter"]').click();
        if (!journal.refs.browserArchive) {
          const downloadPromise = page.waitForEvent('download');
          await page.locator('[data-transfer="download"]').click();
          const download = await downloadPromise, path = join(input.work, 'browser-grpc-workspace.tar.gz');
          await download.saveAs(path);
          const actual = await identity(path);
          need(same(actual, { sha256: selected.sha256, bytes: selected.bytes }),
            'Stream the exact full original archive through the real browser download.');
          await remember('browserArchive', { path, ...actual });
        }
        await page.locator('[data-transfer="use-capture"]').click();
        await page.waitForFunction(() => !document.querySelector('[data-transfer="receive"]').disabled);
        if (!journal.intents['browser-receive']) {
          await page.locator('[data-transfer="directory"]').fill(directories.browser);
          await page.route('**/api/transfer-receive', async route => {
            try {
              const body = JSON.parse(route.request().postData());
              need(UUID.test(body.id) && body.directory === directories.browser && body.expectedSha256 === selected.sha256 &&
                body.expectedBytes === selected.bytes && body.expectedManifestSha256 === selected.manifestSha256 &&
                same(body.archive, { kind: 'capture', id: selected.transferId }), 'Retain the actual browser receiving intent.');
              await intent('browser-receive', () => body);
              await route.continue();
            } catch (error) { await route.abort(); throw error; }
          });
          await page.locator('[data-transfer="receive"]').click();
          await page.waitForFunction(() => document.querySelector('[data-transfer="receipt-detail"]').textContent.includes('COMPLETED'),
            null, { timeout: 3600000 });
          await page.unroute('**/api/transfer-receive');
        } else {
          const body = journal.intents['browser-receive'];
          let receipt;
          try { receipt = await request('receipt', { id: body.id }); }
          catch (error) { if (error.status !== 404) throw error; }
          // Restore only the exact application input retained before its first HTTP effect.
          await page.evaluate(({ body, captureId, captureInput }) => {
            const key = 'stellar-forge.grpc-workspace:' + location.origin + ':transfer:v1';
            sessionStorage.setItem(key, JSON.stringify({ schema: 'stellar-forge.grpc-transfer-browser.v1',
              selectedCapture: captureId, captureIntent: captureInput,
              archiveSelection: { kind: 'capture', id: captureId }, receiveIntent: body,
              ...(body.id ? { selectedReceipt: body.id } : {}) }));
          }, { body, captureId: selected.transferId, captureInput: journal.intents.capture });
          await page.reload({ waitUntil: 'networkidle' });
          await page.locator('[data-view="transfer"]').click();
          if (receipt?.state !== 'COMPLETED') {
            await page.locator('[data-transfer="continue-receive"]').click();
            await page.waitForFunction(() => document.querySelector('[data-transfer="receipt-detail"]').textContent.includes('COMPLETED'),
              null, { timeout: 3600000 });
          }
        }
        const received = await request('receipt', { id: journal.intents['browser-receive'].id });
        need(received.state === 'COMPLETED' && same(received.result.counts, journal.refs.capture.manifest.counts),
          'The actual browser receiving completed the original full native project.');
        await page.locator('[data-transfer="open"]').click();
        const link = page.locator('[data-transfer="open-link"] a');
        await link.waitFor({ state: 'visible' });
        const receivedUrl = await link.getAttribute('href');
        const nativePage = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
        try {
          await nativePage.goto(receivedUrl, { waitUntil: 'networkidle' });
          const state = await nativeApi(receivedUrl, 'state');
          need(state.currentRevision === journal.refs.original.current.revision &&
            state.attemptCount === journal.refs.original.calls.length, 'Open the same complete browser-received project.');
        } finally { await nativePage.close(); }
        await page.screenshot({ path: join(input.work, 'workspace-migration-desktop.png'), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('[data-transfer="receipt-detail"]').scrollIntoViewIfNeeded();
        need(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2),
          'Keep the complete migration editor inside the mobile viewport.');
        await page.screenshot({ path: join(input.work, 'workspace-migration-mobile.png'), fullPage: true });
        await page.locator('[data-transfer="close"]').click();
        await page.waitForFunction(() => document.querySelector('[data-transfer="close"]').disabled);
        await remember('browserReceipt', received.result.receipt);
        return { operationId: journal.intents['browser-receive'].id, directory: directories.browser,
          receipt: received.result.receipt, archive: journal.refs.browserArchive,
          screenshots: ['workspace-migration-desktop.png', 'workspace-migration-mobile.png'] };
      });
      await phase('cold-complete-native-history-and-source-preservation', async () => {
        await closeAll();
        const results = [];
        for (const [name, directory] of Object.entries(directories).filter(([name]) => ['native', 'following', 'host', 'customer', 'browser'].includes(name))) {
          cold = await createGrpcWorkspace({ stateDirectory: directory, env: environment });
          try {
            const state = await cold.state();
            const expectedRevision = ['native', 'following'].includes(name) ? journal.refs.receivedEdit.revision : journal.refs.original.current.revision;
            need(state.currentRevision === expectedRevision, 'Cold reopen preserves the selected current received source.');
            const manifest = name === 'following' ? journal.refs.followingCapture.manifest : journal.refs.capture.manifest;
            const audited = await cold.transferAudit(manifest);
            for (const call of journal.refs.original.calls) {
              const retained = await cold.readAttempt({ id: call.id });
              need(retained.id === call.id && retained.revision === call.revision, 'Read the original complete retained call after migration.');
            }
            const incident = await cold.operationsCase({ id: journal.refs.original.operationsRun.caseId,
              version: journal.refs.original.operationsRun.incident.version });
            need(incident.revision.sha256 === journal.refs.original.operationsRun.incident.sha256,
              'Reopen the exact reviewed original incident version after migration.');
            results.push({ name, directory, currentRevision: state.currentRevision, generation: state.generation,
              attempts: state.attemptCount, health: audited.health, counts: audited.originalCounts,
              incidentVersion: incident.revision.version, incidentSha256: incident.revision.sha256 });
          } finally { await cold.close(); cold = null; }
        }
        need(same(await filesAt(join(input.workspace, 'attempts')), journal.refs.original.files),
          'The original endpoint attempt files remain identical to the first receiving observation.');
        return { workspaces: results, originalCallFilesSha256: journal.refs.original.callsSha256,
          originalCalls: journal.refs.original.calls.length };
      });
      await closeAll();
      session.state = 'CLOSED'; session.endedAt = stamp();
      journal.state = 'COMPLETE'; journal.completedAt = stamp();
      journal.result = { sourceCommit: input.sourceCommit, sourceCapture: selected.transferId,
        nativeManifestSha256: selected.manifestSha256, archiveSha256: selected.sha256, archiveBytes: selected.bytes,
        counts: journal.refs.capture.manifest.counts, files: journal.refs.capture.manifest.files.length,
        originalOperationsRun: journal.refs.original.operationsRun.id, originalCalls: journal.refs.original.calls.length,
        originalCallFilesSha256: journal.refs.original.callsSha256, additionalNativeCalls: 0,
        receivingWorkspaces: 5, retainedCustomerFiles: 2, exportId: journal.refs.merchantExport.exportId,
        receivedRevision: journal.refs.receivedEdit.revision, allOwnedResourcesClosed: true,
        phases: journal.phases.filter(row => row.state === 'COMPLETE').length };
      await save(); process.stdout.write(JSON.stringify({ state: 'COMPLETE', result: journal.result }) + '\n');
      return journal;
    } catch (error) {
      journal.state = 'CONTINUATION_REQUIRED';
      journal.error = { code: error.code ?? error.name ?? 'RECEIVING_ERROR', message: error.message, recordedAt: stamp() };
      try { await closeAll(); session.state = 'CLOSED'; }
      catch (closeError) { session.state = 'CLOSE_INCOMPLETE'; session.closeError = { name: closeError.name, message: closeError.message }; }
      session.endedAt = stamp(); await save(); throw error;
    } finally {
      process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
    }
  } finally { await lease.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { process.stderr.write(JSON.stringify({ error: error.code ?? error.name, message: error.message }) + '\n'); process.exitCode = 1; });
