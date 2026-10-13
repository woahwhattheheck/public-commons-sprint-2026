// SPDX-License-Identifier: MIT
// Complete original merchant host used by the Analysis publication receiving programme.
// It configures the maintained publisher/workbench; it implements no replacement engine.
import { constants as FS } from 'node:fs';
import * as fs from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { startMerchantMcp } from '../../../../../stellar-forge/mcp-merchant-operator/serve.mjs';
import { readMerchantConfig } from '../../../../../stellar-forge/mcp-merchant-operator/config.mjs';
import { openMerchantFileClient } from '../../../../../stellar-forge/mcp-merchant-operator/retained-download.mjs';
import { openFrictionlessClient } from '../../../../../stellar-forge/mcp-merchant-operator/frictionless-workspace-client.mjs';
import { openFrictionlessPublisher } from '../../../sf30-seller-sdk/frictionless/model.mjs';
import { openDatasetVersions } from '../../../sf30-seller-sdk/dataset-refresh/versions.mjs';
import { inspectFrictionlessSource, runFrictionlessCommand } from '../../../sf30-seller-sdk/frictionless/source.mjs';
import { acquireWorkspace } from '../../../sf30-seller-sdk/postgres/publisher/files.mjs';
import { initReleaseStore, readReleaseState } from '../../../sf82-seller-pilot/releases.mjs';

const SCHEMA = 'stellar-forge.analysis-publication-native-merchant.v1';
const ID = /^[a-f0-9]{32}$/, SHA = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const hash = raw => createHash('sha256').update(raw).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function need(value, message) { if (!value) throw new Error(message); }
async function exists(path) { try { await fs.lstat(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
async function directory(path) {
  need(isAbsolute(path), 'Use an absolute original private directory.');
  await fs.mkdir(path, { mode: 0o700, recursive: true });
  const stat = await fs.lstat(path);
  need(stat.isDirectory() && !stat.isSymbolicLink() && !(stat.mode & 0o077) &&
    await fs.realpath(path) === path, 'The original directory must remain canonical and private.');
  return path;
}
async function read(path, maximum = 8 * 1024 * 1024) {
  const file = await fs.open(path, FS.O_RDONLY | FS.O_NOFOLLOW);
  try {
    const before = await file.stat();
    need(before.isFile() && before.nlink === 1 && !(before.mode & 0o077) &&
      (typeof process.getuid !== 'function' || before.uid === process.getuid()) &&
      before.size <= maximum, 'An original private regular file is required.');
    const raw = await file.readFile(), after = await file.stat();
    need(raw.length === before.size && before.dev === after.dev && before.ino === after.ino &&
      before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs,
      'The original file changed while being read.');
    return raw;
  } finally { await file.close(); }
}
async function fileIdentity(path, maximum = 256 * 1024 * 1024) {
  const file = await fs.open(path, FS.O_RDONLY | FS.O_NOFOLLOW);
  try {
    const before = await file.stat();
    need(before.isFile() && before.nlink === 1 && !(before.mode & 0o077) &&
      (typeof process.getuid !== 'function' || before.uid === process.getuid()) &&
      before.size <= maximum, 'The selected package file is not private or exceeds its original limit.');
    const digest = createHash('sha256'), chunk = Buffer.alloc(65536);
    let total = 0;
    for (;;) {
      const { bytesRead } = await file.read(chunk, 0, chunk.length, total);
      if (!bytesRead) break;
      digest.update(chunk.subarray(0, bytesRead)); total += bytesRead;
      need(total <= maximum, 'The selected package file grew past its bound.');
    }
    const after = await file.stat();
    need(total === before.size && before.dev === after.dev && before.ino === after.ino &&
      before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs,
      'The selected package bytes changed.');
    return { bytes: total, sha256: digest.digest('hex') };
  } finally { await file.close(); }
}
async function sync(path) {
  const handle = await fs.open(path, FS.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function write(path, raw, { immutable = true } = {}) {
  await directory(dirname(path));
  if (immutable && await exists(path)) {
    need((await read(path, raw.length + 1)).equals(raw), 'A retained merchant input changed.');
    return;
  }
  const temporary = path + '.tmp-' + randomUUID();
  const handle = await fs.open(temporary, 'wx', 0o600);
  try { await handle.writeFile(raw); await handle.sync(); } finally { await handle.close(); }
  try {
    if (immutable) {
      try { await fs.link(temporary, path); }
      catch (e) { if (e.code !== 'EEXIST') throw e; need((await read(path, raw.length + 1)).equals(raw), 'A concurrent retained input differs.'); }
    } else await fs.rename(temporary, path);
    await sync(dirname(path));
  } finally { await fs.unlink(temporary).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}


/** Hold one exact original successful publisher reply before socket delivery.
 * The original handler executes once. Its complete unmodified reply is retained
 * before the response socket is destroyed; the next caller reads the same run.
 */
async function publicationReplyLoss(host, root, operationId) {
  const intentPath = join(root, 'publication-loss-intent.json');
  const capturePath = join(root, 'publication-loss-capture.json');
  const bodyPath = join(root, 'publication-loss-response.json');
  let intent = await exists(intentPath) ? JSON.parse(await read(intentPath, 65536)) : null;
  let captured = await exists(capturePath) ? JSON.parse(await read(capturePath, 65536)) : null;
  const pending = new Set(), failures = [];
  if (intent) need(intent.schema === SCHEMA && intent.operation_id === operationId &&
    UUID.test(intent.run_id) && UUID.test(intent.review_id), 'Original reply-loss intent changed.');
  if (captured) {
    need(intent && captured.operation_id === operationId && captured.run_id === intent.run_id &&
      captured.review_id === intent.review_id && captured.path === bodyPath,
      'Original response capture belongs to another publication.');
    const raw = await read(bodyPath, 8 * 1024 * 1024);
    need(raw.length === captured.bytes && hash(raw) === captured.sha256, 'Original captured native response changed.');
  }
  let holding = false;
  const listener = (request, response) => {
    if (request.method !== 'POST') return;
    const chunks = []; let length = 0, selected = null;
    request.on('data', chunk => { length += chunk.length; if (length <= 128 * 1024) chunks.push(Buffer.from(chunk)); });
    request.once('end', () => {
      if (length > 128 * 1024 || !intent || captured || holding) return;
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (value.method === 'tools/call' && value.params?.name === 'merchant_publisher_publish' &&
          value.params.arguments?.publisher === 'publication' &&
          value.params.arguments.runId === intent.run_id &&
          value.params.arguments.reviewId === intent.review_id) selected = value;
      } catch { /* The original handler retains its own request validation. */ }
    });
    const end = response.end;
    response.end = function (...args) {
      if (!selected || captured || holding || response.statusCode !== 200 ||
        !(typeof args[0] === 'string' || Buffer.isBuffer(args[0]) || args[0] instanceof Uint8Array))
        return end.apply(this, args);
      const raw = Buffer.from(args[0], typeof args[1] === 'string' ? args[1] : undefined);
      let envelope;
      try { envelope = JSON.parse(raw.toString('utf8')); } catch { return end.apply(this, args); }
      const result = envelope.result?.structuredContent;
      if (raw.length > 8 * 1024 * 1024 || envelope.id !== selected.id ||
        envelope.result?.isError !== false || result?.id !== intent.run_id ||
        result.state !== 'PUBLISHED' || result.data?.review?.id !== intent.review_id ||
        (typeof result.data?.publication?.snapshot !== 'string' || !result.data.publication.snapshot))
        return end.apply(this, args);
      holding = true;
      const task = (async () => {
        await write(bodyPath, raw);
        const receipt = { schema: SCHEMA, operation_id: operationId,
          run_id: intent.run_id, review_id: intent.review_id,
          state: 'ORIGINAL_SUCCESS_CAPTURED_BEFORE_DELIVERY', status: 200,
          path: bodyPath, bytes: raw.length, sha256: hash(raw),
          publication: result.data.publication, captured_at: new Date().toISOString() };
        await write(capturePath, json(receipt));
        captured = receipt;
        // No replacement handler or second publication is invoked. The exact
        // original body has not been passed to response.end.
        response.destroy();
      })().catch(error => { failures.push(error); response.destroy(error); })
        .finally(() => { pending.delete(task); holding = false; });
      pending.add(task);
      return this;
    };
  };
  host.server.prependListener('request', listener);
  return {
    async arm(runId, reviewId) {
      need(UUID.test(runId) && UUID.test(reviewId), 'Select the actual original publication and review.');
      const value = { schema: SCHEMA, operation_id: operationId, run_id: runId, review_id: reviewId };
      await write(intentPath, json(value));
      if (intent) need(same(intent, value), 'The original response-loss selection changed.');
      intent = value;
      return { ...value, captured: captured ? { state: captured.state, sha256: captured.sha256 } : null };
    },
    async inspect() {
      await Promise.allSettled([...pending]);
      if (failures.length) throw failures[0];
      return captured ? { ...captured } : null;
    },
    async close() {
      host.server.removeListener('request', listener);
      await Promise.allSettled([...pending]);
      if (failures.length) throw failures[0];
    },
  };
}

/**
 * The caller holds its original programme lock throughout this returned lifetime.
 * First capture is a documented native bootstrap of these same retained package
 * bytes. The interactive intake later creates its own original workbench capture.
 */
export async function startPublicationMerchant({ directory: selected, operationId, package: input, python, signal } = {}) {
  need(typeof operationId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$/.test(operationId),
    'The original receiving operation identity is required.');
  need(input && ID.test(input.workspace_id) && ID.test(input.job_id) && SHA.test(input.index_sha256) &&
    isAbsolute(input.descriptor?.path || '') && isAbsolute(input.resource?.path || '') &&
    SHA.test(input.descriptor.sha256) && SHA.test(input.resource.sha256) &&
    Number.isSafeInteger(input.descriptor.bytes) && Number.isSafeInteger(input.resource.bytes) &&
    typeof input.queries_text === 'string' && typeof input.resource_name === 'string',
    'Select the actual complete Analysis package and projection.');
  need(isAbsolute(python || ''), 'Select the original installed Python executable.');
  const root = await directory(resolve(selected));
  const environment = { ...process.env, SF_FRICTIONLESS_PYTHON: python };
  // The original MerchantPublisher reads this trusted host environment when it
  // opens the same Frictionless driver. This programme owns its entire process.
  need(!process.env.SF_FRICTIONLESS_PYTHON || process.env.SF_FRICTIONLESS_PYTHON === python,
    'The selected publisher Python runtime changed.');
  process.env.SF_FRICTIONLESS_PYTHON = python;
  const request = { schema: SCHEMA, operation_id: operationId, directory: root, package: input, python };
  const requestFile = join(root, 'request.json');
  await write(requestFile, json(request));
  for (const [name, maximum] of [['descriptor', 8 * 1024 * 1024], ['resource', 256 * 1024 * 1024]]) {
    const identity = await fileIdentity(input[name].path, maximum);
    need(identity.sha256 === input[name].sha256 && identity.bytes === input[name].bytes,
      'The selected original ' + name + ' bytes changed.');
  }
  const descriptor = JSON.parse(await read(input.descriptor.path));
  need(Array.isArray(descriptor.resources) && descriptor.resources.length === 1 &&
    descriptor.resources[0].name === input.resource_name && descriptor.resources[0].path === 'data.json' &&
    resolve(dirname(input.descriptor.path), 'data.json') === input.resource.path,
    'The reviewed package resource no longer matches its original descriptor.');
  const queries = JSON.parse(input.queries_text);
  need(queries && Object.keys(queries).length === 1 &&
    Object.values(queries)[0].resource === input.resource_name, 'The native query selection changed.');

  const captureDirectory = join(root, 'bootstrap-capture'), captureFile = join(captureDirectory, 'capture.json');
  if (!await exists(captureDirectory)) {
    signal?.throwIfAborted();
    await runFrictionlessCommand(['capture', '--descriptor', input.descriptor.path,
      '--output', captureDirectory, '--resource', input.resource_name],
      { env: environment, stdout: null, signal });
  }
  const captureRaw = await read(captureFile), capture = JSON.parse(captureRaw);
  need(capture.schema === 'stellar-forge.frictionless-capture.v1' && capture.state === 'COMPLETE' &&
    Array.isArray(capture.files) && capture.resources?.length === 1 &&
    capture.resources[0].name === input.resource_name, 'The original bootstrap capture is incomplete.');
  const descriptorMember = capture.files.find(v => v.file === capture.descriptorFile);
  const resourceMember = capture.resources[0].members?.[0];
  need(descriptorMember?.sha256 === input.descriptor.sha256 && descriptorMember.bytes === input.descriptor.bytes &&
    resourceMember?.sha256 === input.resource.sha256 && resourceMember.bytes === input.resource.bytes,
    'The original bootstrap capture contains different source bytes.');
  const inspection = await runFrictionlessCommand(['inspect-capture', '--capture', captureFile,
    '--sha256', hash(captureRaw)], { env: environment, stdout: null, signal });
  const sourceFile = join(root, 'bootstrap-source.json');
  const sourceRaw = Buffer.from('{"schema":"stellar-forge.frictionless-source.v1","connection":' +
    JSON.stringify({ file: captureFile, sha256: hash(captureRaw) }) + ',"queries":' + input.queries_text + '}\n');
  await write(sourceFile, sourceRaw);
  const inspected = await inspectFrictionlessSource(sourceFile, { env: environment });
  need(inspected.hash === hash(sourceRaw) && inspected.captureSha256 === hash(captureRaw) &&
    same(inspected.config.queries, queries), 'The original bootstrap source/projection changed.');
  await write(join(root, 'bootstrap-receipt.json'), json({
    schema: SCHEMA, operation_id: operationId, analysis_workspace_id: input.workspace_id,
    package_job_id: input.job_id, index_sha256: input.index_sha256,
    capture_sha256: hash(captureRaw), source_sha256: hash(sourceRaw),
    descriptor: { bytes: input.descriptor.bytes, sha256: input.descriptor.sha256 },
    resource: { bytes: input.resource.bytes, sha256: input.resource.sha256 }, inspection,
  }));

  const publisherDirectory = join(root, 'publisher'), targetDirectory = join(root, 'dataset-target');
  // The native initializer creates its directory before its SQLite/settings
  // files. Keep that unpublished bootstrap outside the final host configuration.
  const publisherStage = join(root, 'publisher-bootstrap-stage');
  await write(join(root, 'publisher-bootstrap-intent.json'), json({
    schema: SCHEMA, operation_id: operationId, sourceFile, targetDirectory,
    staging: publisherStage, destination: publisherDirectory,
  }));
  if (!await exists(publisherDirectory)) {
    if (await exists(publisherStage)) {
      const complete = (await Promise.all(['workspace.json', 'publisher.sqlite', 'plans', 'runs']
        .map(name => exists(join(publisherStage, name))))).every(Boolean);
      if (!complete) {
        // The programme's original lock and the maintained publisher lock prove
        // no original host is writing this unpublished stage. Preserve all
        // partial bytes before allowing the original initializer to continue.
        const releaseStage = await acquireWorkspace(publisherStage);
        try {
          const names = await fs.readdir(publisherStage);
          need(names.every(name => ['workspace.json','publisher.sqlite','publisher.sqlite-journal',
            'publisher.lock','plans','runs'].includes(name)), 'The unpublished original initializer has unexpected files.');
          for (const name of ['plans','runs']) if (await exists(join(publisherStage, name)))
            need((await fs.readdir(join(publisherStage, name))).length === 0,
              'An unpublished stage contains native actions; review its original records.');
          const retained = join(root, 'publisher-bootstrap-incomplete-' + randomUUID());
          const files = [];
          for (const name of names) {
            const path = join(publisherStage, name), stat = await fs.lstat(path);
            need(!stat.isSymbolicLink() && (stat.isDirectory() || stat.isFile()),
              'The original bootstrap member type changed.');
            if (stat.isFile()) files.push({ name, ...await fileIdentity(path, 32 * 1024 * 1024) });
          }
          await write(retained + '.json', json({ schema: SCHEMA, operation_id: operationId,
            sourceFile, targetDirectory, original_stage: publisherStage, retained, files,
            state: 'UNPUBLISHED_INITIALIZER_RETAINED', recorded_at: new Date().toISOString() }));
          await fs.rename(publisherStage, retained); await sync(root);
        } finally { await releaseStage(); }
      }
    }
    const bootstrap = await openFrictionlessPublisher({ directory: publisherStage,
      create: !await exists(publisherStage), sourceFile, targetDirectory, environment });
    try {
      need(bootstrap.sourceName === 'Frictionless Data Package' &&
        bootstrap.settings.sourceFile === sourceFile && bootstrap.settings.targetDirectory === targetDirectory,
        'The original publisher bootstrap binding changed.');
      const state = await bootstrap.status({ limit: 1 });
      need(state.active === null && state.pages.plans.total === 0 && state.pages.runs.total === 0 &&
        state.pages.history.total === 0 && state.sourceSelection === null,
        'The original publisher stage contains actions and cannot be adopted as initialization.');
    } finally { await bootstrap.close(); }
    await fs.rename(publisherStage, publisherDirectory); await sync(root);
  }
  const original = await openFrictionlessPublisher({ directory: publisherDirectory,
    create: false, sourceFile, targetDirectory, environment });
  try {
    need(original.sourceName === 'Frictionless Data Package' && original.settings.sourceFile === sourceFile &&
      original.settings.targetDirectory === targetDirectory, 'The original publisher source/target changed.');
  } finally { await original.close(); }
  const merchantDirectory = await directory(join(root, 'merchant'));
  const releaseStore = join(merchantDirectory, 'releases');
  await initReleaseStore(releaseStore, { resume: true });
  const release = await readReleaseState(releaseStore);
  need(release.active === null && release.history.length === 0, 'This receiving declaration acquired an unrelated release.');
  await directory(join(merchantDirectory, 'customer-exports'));
  const publisherConnection = join(root, 'publisher-connection.json');
  const workbenchConnection = join(root, 'workbench-connection.json');
  await write(publisherConnection, json({ schema: 'stellar-forge.merchant-publisher-connection.v1',
    workspaces: { publication: { label: 'Original Analysis package publisher',
      kind: 'frictionless', directory: publisherDirectory } } }));
  await write(workbenchConnection, json({ schema: 'stellar-forge.frictionless-workspace-connection.v1',
    workspaces: { publication: { label: 'Reviewed Analysis source', publisher: 'publication',
      inputs: { prepared: { kind: 'descriptor', label: 'Exact retained Analysis Data Package',
        path: input.descriptor.path, resources: [input.resource_name] } } } } }));
  const configPath = join(merchantDirectory, 'merchant-mcp.json');
  await write(configPath, json({ schema: 'stellar-forge.merchant-mcp.v1',
    name: 'Analysis dataset publication receiving', releaseStore,
    exportsDirectory: './customer-exports', sources: {}, publisherConnection,
    frictionlessWorkspaceConnection: workbenchConnection }));
  await readMerchantConfig(configPath);
  const tokenFile = join(root, 'merchant-token.txt');
  if (!await exists(tokenFile)) await write(tokenFile, Buffer.from(randomBytes(32).toString('hex') + '\n'));
  const token = (await read(tokenFile, 4096)).toString('utf8').trim();
  need(/^[\x21-\x7e]{24,}$/.test(token), 'The original merchant token changed.');
  const tokenEnv = 'ANALYSIS_DATASET_NATIVE_MERCHANT_TOKEN';
  const hostEnvironment = { ...environment, [tokenEnv]: token };
  const hostRecord = join(root, 'host.json');
  const previous = await exists(hostRecord) ? JSON.parse(await read(hostRecord, 65536)) : null;
  if (previous) need(previous.schema === SCHEMA && previous.operation_id === operationId &&
    previous.analysis_workspace_id === input.workspace_id && previous.package_job_id === input.job_id &&
    previous.index_sha256 === input.index_sha256 && Number.isInteger(previous.port) &&
    previous.port > 0 && previous.port <= 65535 && UUID.test(previous.workspace_id),
    'The original host identity changed.');
  let host, loss;
  try {
    signal?.throwIfAborted();
    host = await startMerchantMcp({ configPath, port: previous?.port ?? 0,
      tokenEnv, environment: hostEnvironment, providerOptions: { environment } });
    const endpoint = new URL(host.url).href, address = new URL(endpoint);
    need(address.protocol === 'http:' && address.hostname === '127.0.0.1' &&
      (!previous || previous.endpoint === endpoint), 'The reviewed original merchant endpoint changed.');
    const transport = await openMerchantFileClient({ url: endpoint, tokenEnv,
      environment: hostEnvironment, signal, errorPrefix: 'FRICTIONLESS', maximumResponseBytes: 32 * 1024 * 1024 });
    const client = await openFrictionlessClient({ workspace: 'publication',
      workspaceId: previous?.workspace_id, client: transport, signal });
    const opened = await client.open();
    need(opened.state === 'OPEN' && UUID.test(opened.workspaceId) && opened.publisher === 'publication',
      'The original native workbench did not open.');
    const selectedInput = await client.input('prepared');
    need(selectedInput.kind === 'descriptor' && selectedInput.sha256 === input.descriptor.sha256 &&
      selectedInput.bytes === input.descriptor.bytes, 'The actual configured input differs from the saved package.');
    const record = { schema: SCHEMA, operation_id: operationId,
      analysis_workspace_id: input.workspace_id, package_job_id: input.job_id,
      index_sha256: input.index_sha256, endpoint, port: Number(address.port),
      workspace_id: opened.workspaceId, publisher: 'publication', workspace: 'publication', input: 'prepared' };
    await write(hostRecord, json(record));
    const connectionFile = join(root, 'analysis-publication-connections.json');
    await write(connectionFile, json({ schema: 'stellar-forge.analysis-publication-connections.v1',
      connections: { receiving: { label: 'Original local Frictionless publisher', url: endpoint,
        token_file: tokenFile, workspace: 'publication', workspace_id: opened.workspaceId,
        publisher: 'publication', input: 'prepared', timeout_ms: 120000 } } }));
    loss = await publicationReplyLoss(host, root, operationId);
    let closing;
    return { ...record, connectionFile, tokenFile, bootstrap: {
      source_sha256: hash(sourceRaw), capture_sha256: hash(captureRaw) },
      async inspect() {
        return { source: await client.status({ limit: 100 }),
          publisher: await transport.call('merchant_publisher_status', { publisher: 'publication', limit: 100 }),
          target: await transport.call('merchant_publisher_target', { publisher: 'publication' }) };
      },
      async targetSnapshot() {
        const observed = await transport.call('merchant_publisher_target', { publisher: 'publication' });
        if (observed.connected && observed.versions) return { observation: observed, versions: observed.versions };
        // Initialization intentionally closes the original version store. Read
        // that exact existing store without supplying an initialization config
        // or collecting retained generations during this receiving observation.
        need(await exists(join(targetDirectory, 'state.json')), 'The original initialized target is not present.');
        const versions = await openDatasetVersions({ directory: targetDirectory, collectOnOpen: false });
        try { return { observation: observed, versions: versions.status() }; }
        finally { await versions.close(); }
      },
      armPublisherLoss: (runId, reviewId) => loss.arm(runId, reviewId),
      publicationLoss: () => loss.inspect(),
      close() {
        return closing ??= (async () => {
          const failures = [];
          try { await loss.close(); } catch (error) { failures.push(error); }
          try { await host.close(); } catch (error) { failures.push(error); }
          if (failures.length) throw new AggregateError(failures, 'Original merchant cleanup requires attention.');
        })().catch(error => { closing = null; throw error; });
      },
    };
  } catch (error) {
    if (host) try { await host.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'The original merchant startup and cleanup need attention.'); }
    throw error;
  }
}
