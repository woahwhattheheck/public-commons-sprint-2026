// MIT. Private retained operator state over the original gRPC/SF30/SF82 APIs.
import { mkdir, readdir, rename, unlink, rm } from 'node:fs/promises';
import { resolve, join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { acquireStateLease } from '../../../merchant-fleet-gateway/state-lease.mjs';
import { atomicJson } from '../../../sf46-release/release-core.mjs';
import { captureProtoSource, compileProtoSource } from '../proto.mjs';
import { grpcMethodSchema, normalizeGrpcRequest } from '../values.mjs';
import { validateGrpcConfig, grpcEnvironmentNames } from '../config.mjs';
import { createGrpcSource } from '../source.mjs';
import { compileGrpcMerchantPlan, prepareGrpcSeller, readGrpcPrepared, CUSTOMER_FILES } from '../prepare.mjs';
import { startGrpcMerchant } from '../merchant.mjs';
import { fields, text, canonical, sha256, jsonBytes, readJson, readBytes, writeNew,
  syncDirectory, privateDirectory, fail, assertProtoArchiveFits, writeJsonSnapshot } from '../common.mjs';

const REV = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const stamp = () => new Date().toISOString();
const identifier = (value, expression = REV) => {
  if (typeof value !== 'string' || !expression.test(value)) fail('GRPC_WORKSPACE_IDENTIFIER_INVALID');
  return value;
};
async function optional(path, cap = 1048576) {
  try { return await readJson(path, cap); } catch (issue) { if (issue.code === 'ENOENT') return null; throw issue; }
}
const routeSummary = bundle => bundle ? bundle.service.routes.map(route => ({
  id: route.id, method: bundle.bindings[route.id].method, path: route.path, url: route.offer.resource.url,
  description: route.offer.resource.description, example: structuredClone(route.offer.extensions.bazaar.info.input.body),
  paymentOptions: structuredClone(route.offer.accepts),
})) : [];
function describe(contract) {
  return Object.entries(contract.methods).map(([path, item]) => ({
    path, requestType: item.requestType, responseType: item.responseType,
    requestStream: Boolean(item.requestStream), responseStream: Boolean(item.responseStream),
    selectable: !item.requestStream && !item.responseStream,
  }));
}
function draft(source, protoSource, plan) {
  const config = validateGrpcConfig(source), contract = compileProtoSource(assertProtoArchiveFits(protoSource));
  fields(plan, ['schema', 'publicOrigin', 'payment', 'paymentOptions', 'routes'], 'GRPC_PLAN_FIELDS_INVALID');
  if (plan.schema !== 'stellar-forge.grpc-merchant-plan.v1' || !Array.isArray(plan.routes)) fail('GRPC_PLAN_SCHEMA_INVALID');
  const bundle = plan.routes.length ? compileGrpcMerchantPlan(contract, plan, { limits: config.limits }) : null;
  const value = { source: config, protoSource: contract.source, plan: structuredClone(plan) };
  jsonBytes(value, 10485760);
  return { ...value, contract, bundle, id: sha256(canonical(value)) };
}
export async function createGrpcWorkspace({ stateDirectory, sourceFile, protoDirectory, entrypoints, planFile,
  sellerPort = 0, operationsPort = 0, maxInFlight = 64, drainGraceMs = 60000,
  nativeFactory = null, releaseRuntime, env = process.env } = {}) {
  if (typeof stateDirectory !== 'string' || !isAbsolute(stateDirectory)) fail('GRPC_ABSOLUTE_WORKSPACE_REQUIRED');
  const root = await privateDirectory(stateDirectory, true), lease = await acquireStateLease(root);
  const environment = { ...env };
  const retainedRuntime = releaseRuntime === undefined ? (nativeFactory ? null : { port: sellerPort }) : structuredClone(releaseRuntime);
  const folders = Object.fromEntries(['revisions', 'prepared', 'intents', 'attempts', 'temporary'].map(name => [name, join(root, name)]));
  let current = null, revisionIndex = [], busy = null, closing = false, closePromise, active = null, previousRun = null;
  let navigationOrigin = null, releaseConsole = null;
  const cached = new Map();
  const execute = action => {
    if (closing) return Promise.reject(Object.assign(new Error('GRPC_WORKSPACE_CLOSING'), { status: 503 }));
    if (busy) return Promise.reject(Object.assign(new Error('GRPC_WORKSPACE_BUSY'), { status: 409 }));
    lease.assertHeld();
    busy = Promise.resolve().then(action).finally(() => { busy = null; });
    return busy;
  };
  const currentId = () => current?.revision ?? null;
  const revisionPath = id => join(folders.revisions, identifier(id) + '.json');
  async function revision(id) {
    identifier(id);
    if (cached.has(id)) return cached.get(id);
    const saved = await readJson(revisionPath(id), 11534336);
    if (saved.schema !== 'stellar-forge.grpc-workspace-revision.v1' || saved.id !== id ||
        typeof saved.createdAt !== 'string') fail('GRPC_WORKSPACE_REVISION_INVALID', 409);
    const parsed = draft(saved.source, saved.protoSource, saved.plan);
    if (sha256(canonical({ source: parsed.source, protoSource: parsed.protoSource, plan: parsed.plan, title: saved.title })) !== id)
      fail('GRPC_WORKSPACE_REVISION_CHANGED', 409);
    const value = { ...saved, contract: parsed.contract, bundle: parsed.bundle };
    cached.set(id, value);
    while (cached.size > 4) cached.delete(cached.keys().next().value);
    return value;
  }
  function visible(value) {
    return { id: value.id, parent: value.parent, createdAt: value.createdAt, title: value.title,
      source: structuredClone(value.source), protoSource: structuredClone(value.protoSource),
      plan: structuredClone(value.plan), methods: describe(value.contract), routes: routeSummary(value.bundle),
      environmentNames: grpcEnvironmentNames(value.source), readyToPrepare: Boolean(value.bundle) };
  }
  async function saveInside({ source, protoSource, plan, baseRevision, title = 'gRPC merchant' }) {
    if (baseRevision !== currentId()) fail('GRPC_WORKSPACE_REVISION_CONFLICT', 409);
    const parsed = draft(source, protoSource, plan);
    text(title, 'GRPC_WORKSPACE_TITLE_REQUIRED', 120);
    parsed.id = sha256(canonical({ source: parsed.source, protoSource: parsed.protoSource, plan: parsed.plan, title }));
    const saved = { schema: 'stellar-forge.grpc-workspace-revision.v1', id: parsed.id,
      parent: currentId(), createdAt: stamp(), title, source: parsed.source, protoSource: parsed.protoSource, plan: parsed.plan };
    try { await atomicJson(revisionPath(parsed.id), saved, { exclusive: true }); }
    catch (issue) {
      if (issue.code !== 'EEXIST') throw issue;
      const retained = await revision(parsed.id);
      if (canonical({ source: retained.source, protoSource: retained.protoSource, plan: retained.plan }) !==
          canonical({ source: saved.source, protoSource: saved.protoSource, plan: saved.plan }))
        fail('GRPC_WORKSPACE_REVISION_CHANGED', 409);
    }
    const retained = await revision(parsed.id);
    if (!revisionIndex.some(row => row.id === parsed.id)) {
      const nextIndex = [...revisionIndex, { id: retained.id, title: retained.title, createdAt: retained.createdAt,
        parent: retained.parent, routes: retained.plan.routes.length, protoSha256: retained.protoSource.sha256 }];
      await atomicJson(join(root, 'revisions.json'), nextIndex); revisionIndex = nextIndex;
    }
    const next = { schema: 'stellar-forge.grpc-workspace-current.v1', revision: parsed.id,
      generation: (current?.generation ?? 0) + 1, selectedAt: stamp() };
    await atomicJson(join(root, 'current.json'), next); current = next;
    return visible(retained);
  }
  function selected(id) {
    if (identifier(id) !== currentId()) fail('GRPC_SELECT_SAVED_REVISION_FIRST', 409);
  }
  async function preparation(id) {
    const key = identifier(id, UUID), directory = join(folders.prepared, key);
    const record = await readJson(join(directory, 'workspace-release.json'), 65536);
    if (record.schema !== 'stellar-forge.grpc-workspace-prepared.v1' || record.id !== key) fail('GRPC_WORKSPACE_RELEASE_INVALID', 409);
    const prepared = await readGrpcPrepared(directory), saved = await revision(record.revision);
    if (prepared.manifest.protoSha256 !== saved.protoSource.sha256 ||
        prepared.manifest.sourceSha256 !== sha256(canonical(saved.source)) ||
        prepared.manifest.planSha256 !== sha256(canonical(saved.plan))) fail('GRPC_WORKSPACE_RELEASE_CHANGED', 409);
    return { record, prepared };
  }
  const runtime = () => ({ busy: Boolean(busy), closing,
    active: active ? { id: active.id, releaseId: active.releaseId, revision: active.revision, phase: active.phase,
      startedAt: active.startedAt, url: active.session?.url, mode: active.session?.mode,
      docs: active.session ? active.session.url + '/_seller/docs' : null,
      openapi: active.session ? active.session.url + '/_seller/openapi.json' : null,
      operations: active.session?.operations?.url, availability: active.session?.operations?.availabilityControlUrl,
      source: active.session?.source.status() } : null,
    previous: previousRun, releaseConsole: releaseConsole ? { url: releaseConsole.operatorUrl } : null });
  async function state() {
    lease.assertHeld();
    const revisions = structuredClone(revisionIndex);
    const prepared = [];
    for (const id of await readdir(folders.prepared)) {
      if (!UUID.test(id)) continue;
      const row = await readJson(join(folders.prepared, id, 'workspace-release.json'), 65536);
      prepared.push(row);
    }
    const intents = [];
    for (const file of await readdir(folders.intents)) {
      if (file.endsWith('.json') && UUID.test(file.slice(0, -5))) intents.push(await readJson(join(folders.intents, file), 65536));
    }
    const attempts = [];
    for (const file of await readdir(folders.attempts)) {
      if (!file.endsWith('.json') || !UUID.test(file.slice(0, -5))) continue;
      const attempt = await readJson(join(folders.attempts, file), 65536);
      attempts.push({ id: attempt.id, revision: attempt.revision, method: attempt.method, phase: attempt.phase,
        startedAt: attempt.startedAt, finishedAt: attempt.finishedAt, error: attempt.error,
        inputSha256: attempt.inputSha256, responseSha256: attempt.responseSha256 });
    }
    return { schema: 'stellar-forge.grpc-workspace-state.v1', stateDirectory: root, currentRevision: currentId(),
      generation: current?.generation ?? 0, revisions: revisions.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      prepared: prepared.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), intents,
      attempts: attempts.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 50),
      attemptCount: attempts.length, runtime: runtime() };
  }
  const save = body => execute(() => saveInside(body));
  const capture = body => execute(async () => {
    fields(body, ['directory', 'entrypoints', 'source', 'plan', 'baseRevision', 'title'], 'GRPC_CAPTURE_FIELDS_INVALID');
    if (body.baseRevision !== currentId()) fail('GRPC_WORKSPACE_REVISION_CONFLICT', 409);
    const protoSource = await captureProtoSource({ directory: body.directory, entrypoints: body.entrypoints });
    return saveInside({ ...body, protoSource });
  });
  const open = async ({ revision: id }) => visible(await revision(identifier(id)));
  const checkout = body => execute(async () => {
    if (body.baseRevision !== currentId()) fail('GRPC_WORKSPACE_REVISION_CONFLICT', 409);
    const saved = await revision(identifier(body.revision));
    const next = { schema: 'stellar-forge.grpc-workspace-current.v1', revision: saved.id,
      generation: (current?.generation ?? 0) + 1, selectedAt: stamp() };
    await atomicJson(join(root, 'current.json'), next); current = next;
    return visible(saved);
  });
  const method = async body => {
    const saved = await revision(identifier(body.revision));
    return grpcMethodSchema(saved.contract, body.method);
  };
  const review = body => execute(async () => {
    selected(body.revision); const saved = await revision(body.revision);
    if (!saved.bundle) fail('GRPC_SELECT_AT_LEAST_ONE_UNARY_METHOD');
    const source = await createGrpcSource(saved.source, saved.protoSource, { env: environment, contract: saved.contract });
    try {
      const observed = await source.ready();
      const report = { schema: 'stellar-forge.grpc-workspace-review.v1', revision: saved.id, reviewedAt: stamp(),
        protoSha256: saved.protoSource.sha256, channelReady: true, methods: describe(saved.contract),
        routes: routeSummary(saved.bundle), limits: observed.limits,
        meaning: 'The captured protobuf contract compiled with the native runtime and the selected channel became ready. No application RPC was executed.' };
      await atomicJson(join(root, 'review-' + saved.id + '.json'), report); return report;
    } finally { await source.close(); }
  });
  async function attemptResult(id, recover = false) {
    const file = join(folders.attempts, identifier(id, UUID) + '.json'), saved = await optional(file, 65536);
    if (!saved) return null;
    const inputBytes = await readBytes(join(folders.attempts, id + '.input'), 33554432);
    const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(inputBytes));
    if (sha256(canonical(input)) !== saved.inputSha256) fail('GRPC_CALL_INPUT_CHANGED', 409);
    const result = await optional(join(folders.attempts, id + '.output'), 17825792);
    if (result) {
      if (result.id !== id || result.fingerprint !== saved.fingerprint ||
          result.sha256 !== sha256(canonical(result.output))) fail('GRPC_CALL_OUTPUT_CHANGED', 409);
      if (saved.phase !== 'COMPLETED' && recover) {
        Object.assign(saved, { phase: 'COMPLETED', responseSha256: result.sha256, finishedAt: result.completedAt });
        await atomicJson(file, saved);
      }
      if (saved.responseSha256 && saved.responseSha256 !== result.sha256) fail('GRPC_CALL_OUTPUT_CHANGED', 409);
    }
    return { ...saved, input, ...(result ? { output: result.output, outputRetained: true } : {}) };
  }
  const call = (body, { signal } = {}) => execute(async () => {
    selected(body.revision); identifier(body.id, UUID);
    const saved = await revision(body.revision);
    if (!saved.bundle || !saved.plan.routes.some(route => route.grpcMethod === body.method))
      fail('GRPC_CALL_APPROVED_METHOD_REQUIRED');
    const input = normalizeGrpcRequest(saved.contract, body.method, body.input);
    const fingerprint = sha256(canonical({ revision: saved.id, method: body.method, input }));
    const file = join(folders.attempts, body.id + '.json'), retained = await optional(file, 65536);
    if (retained) {
      if (retained.fingerprint !== fingerprint) fail('GRPC_CALL_ID_REUSED_WITH_DIFFERENT_INPUT', 409);
      return attemptResult(body.id, true);
    }
    const inputSha256 = sha256(canonical(input)), inputPath = join(folders.attempts, body.id + '.input');
    const earlierInput = await optional(inputPath, 33554432);
    if (earlierInput && sha256(canonical(earlierInput)) !== inputSha256) fail('GRPC_CALL_ID_REUSED_WITH_DIFFERENT_INPUT', 409);
    if (!earlierInput) await writeJsonSnapshot(inputPath, input, 17825792);
    const attempt = { schema: 'stellar-forge.grpc-workspace-call.v1', id: body.id, revision: saved.id,
      fingerprint, method: body.method, inputSha256, phase: 'ATTEMPTED', startedAt: stamp() };
    await atomicJson(file, attempt, { exclusive: true });
    let source, called = false;
    try {
      source = await createGrpcSource(saved.source, saved.protoSource, { env: environment, contract: saved.contract });
      called = true;
      const output = await source.call(body.method, input, { signal });
      const result = { id: body.id, fingerprint, output, sha256: sha256(canonical(output)), completedAt: stamp() };
      await writeJsonSnapshot(join(folders.attempts, body.id + '.output'), result, 17825792);
      Object.assign(attempt, { phase: 'COMPLETED', responseSha256: result.sha256, finishedAt: result.completedAt });
    } catch (issue) {
      // A failed/cancelled transport is not proof that an upstream mutation was
      // not applied. The same operation ID returns its retained attempt.
      Object.assign(attempt, { phase: called ? 'OUTCOME_UNCONFIRMED' : 'NOT_STARTED',
        error: issue.code ?? 'GRPC_CALL_FAILED', ...(issue.grpcCode ? { grpcCode: issue.grpcCode } : {}),
        finishedAt: stamp(), nextAction: called ?
          'Inspect the upstream outcome. A new intentional request uses a new operation ID.' :
          'Correct the connection settings or environment, then submit a new intentional request.' });
    } finally { await source?.close(); }
    await atomicJson(file, attempt);
    return attemptResult(body.id, true);
  });
  const readAttempt = body => execute(() => attemptResult(body.id, true));
  const prepare = body => execute(async () => {
    selected(body.revision); identifier(body.id, UUID);
    const saved = await revision(body.revision);
    if (!saved.bundle) fail('GRPC_SELECT_AT_LEAST_ONE_UNARY_METHOD');
    const intentPath = join(folders.intents, body.id + '.json'), target = join(folders.prepared, body.id);
    const intent = { schema: 'stellar-forge.grpc-workspace-prepare.v1', id: body.id,
      revision: saved.id, createdAt: stamp() };
    const retainedIntent = await optional(intentPath, 65536);
    if (retainedIntent && retainedIntent.revision !== saved.id) fail('GRPC_PREPARE_ID_CONFLICT', 409);
    try {
      const complete = await preparation(body.id);
      if (complete.record.revision !== saved.id) fail('GRPC_PREPARE_ID_CONFLICT', 409);
      if (retainedIntent) { await unlink(intentPath); await syncDirectory(folders.intents); }
      return complete.record;
    } catch (issue) { if (issue.code !== 'ENOENT') throw issue; }
    if (!retainedIntent) { await writeNew(intentPath, jsonBytes(intent, 65536)); await syncDirectory(folders.intents); }
    const temporary = join(folders.temporary, body.id);
    // Only this original operation's unpublished folder is disposable. Preparing
    // is pure source compilation: recovery never repeats an application RPC.
    await rm(temporary, { recursive: true, force: true });
    const prepared = await prepareGrpcSeller({ source: saved.source, protoSource: saved.protoSource,
      plan: saved.plan, directory: temporary });
    const record = { schema: 'stellar-forge.grpc-workspace-prepared.v1', id: body.id, revision: saved.id,
      createdAt: retainedIntent?.createdAt ?? intent.createdAt, protoSha256: saved.protoSource.sha256,
      routes: prepared.routes, manifestSha256: sha256(canonical({
        schema: prepared.schema, protoSha256: prepared.protoSha256, sourceSha256: prepared.sourceSha256,
        planSha256: prepared.planSha256, files: prepared.files })) };
    await writeNew(join(temporary, 'workspace-release.json'), jsonBytes(record, 65536));
    await syncDirectory(temporary); await rename(temporary, target); await syncDirectory(folders.prepared);
    await unlink(intentPath); await syncDirectory(folders.intents); return record;
  });
  const run = body => execute(async () => {
    identifier(body.id, UUID);
    if (releaseConsole) fail('GRPC_CLOSE_RELEASE_CONSOLE_BEFORE_DIRECT_RUN', 409);
    if (active) {
      if (active.releaseId === body.id && active.phase === 'RUNNING') return runtime();
      fail('GRPC_STOP_RUNNING_MERCHANT_FIRST', 409);
    }
    const retained = await preparation(body.id);
    active = { id: randomUUID(), releaseId: body.id, revision: retained.record.revision,
      phase: 'STARTING', startedAt: stamp() };
    await atomicJson(join(root, 'run.json'), active);
    try {
      const session = await startGrpcMerchant({ prepared: retained.prepared, env: environment, nativeFactory,
        port: sellerPort, operationsPort, maxInFlight, drainGraceMs,
        availabilityDirectory: join(root, 'availability'), navigationOrigin });
      active.session = session; active.phase = 'RUNNING';
      await atomicJson(join(root, 'run.json'), { ...runtime().active, pid: process.pid }); return runtime();
    } catch (issue) {
      if (active.session) await active.session.close().catch(() => {});
      previousRun = { id: active.id, releaseId: active.releaseId, revision: active.revision,
        phase: 'START_FAILED', endedAt: stamp(), error: issue.code ?? 'GRPC_MERCHANT_START_FAILED' };
      active = null; await atomicJson(join(root, 'run.json'), previousRun); throw issue;
    }
  });
  async function stopInside() {
    if (!active) return runtime();
    active.phase = 'DRAINING';
    await atomicJson(join(root, 'run.json'), { ...runtime().active, pid: process.pid });
    try {
      await active.session.close();
      previousRun = { id: active.id, releaseId: active.releaseId, revision: active.revision,
        phase: 'STOPPED', startedAt: active.startedAt, endedAt: stamp() };
      active = null; await atomicJson(join(root, 'run.json'), previousRun); return runtime();
    } catch (issue) { active.phase = 'STOP_UNCONFIRMED'; throw issue; }
  }
  const stop = () => execute(stopInside);
  const download = body => execute(async () => {
    const { prepared } = await preparation(identifier(body.id, UUID));
    if (typeof body.file !== 'string' || !CUSTOMER_FILES.includes(body.file)) fail('GRPC_CUSTOMER_FILE_REQUIRED');
    const expected = prepared.manifest.files[body.file];
    const bytes = await readBytes(join(prepared.directory, body.file), expected.bytes);
    if (sha256(bytes) !== expected.sha256) fail('GRPC_CUSTOMER_FILE_CHANGED', 409);
    return { bytes, filename: body.file.replaceAll('/', '-'), sha256: expected.sha256,
      contentType: body.file.endsWith('.json') ? 'application/json' : 'text/plain; charset=utf-8' };
  });
  const archive = body => execute(async () => {
    const { prepared } = await preparation(identifier(body.id, UUID));
    const bytes = await new Promise((done, reject) => {
      const child = spawn('tar', ['-czf', '-', '-C', prepared.directory, '--', ...CUSTOMER_FILES],
        { stdio: ['ignore', 'pipe', 'ignore'] });
      const chunks = []; let size = 0, problem;
      const timer = setTimeout(() => { problem = new Error('GRPC_CUSTOMER_ARCHIVE_TIMEOUT'); child.kill('SIGKILL'); }, 30000);
      child.stdout.on('data', chunk => {
        if ((size += chunk.length) > 33554432) { problem = new Error('GRPC_CUSTOMER_ARCHIVE_TOO_LARGE'); child.kill('SIGKILL'); }
        else chunks.push(chunk);
      });
      child.once('error', issue => { clearTimeout(timer); reject(issue); });
      child.once('close', code => { clearTimeout(timer);
        if (problem || code !== 0) reject(problem ?? new Error('GRPC_CUSTOMER_ARCHIVE_FAILED'));
        else done(Buffer.concat(chunks, size));
      });
    });
    return { bytes, filename: 'grpc-customer-client.tar.gz', sha256: sha256(bytes), contentType: 'application/gzip' };
  });
  async function originalStore() {
    const directory = join(root, 'merchant-releases');
    const { initReleaseStore, readReleaseState } = await import('../../../sf82-seller-pilot/releases.mjs');
    try { await readReleaseState(directory); }
    catch (issue) { if (issue.code !== 'ENOENT') throw issue; await initReleaseStore(directory); }
    return directory;
  }
  const stage = body => execute(async () => {
    if (active) fail('GRPC_STOP_WORKSPACE_MERCHANT_BEFORE_RELEASE_CONTROL', 409);
    const { prepared } = await preparation(identifier(body.id, UUID)), store = await originalStore();
    text(body.releaseId, 'GRPC_RELEASE_NAME_REQUIRED', 64);
    const { stageRelease } = await import('../../../sf82-seller-pilot/releases.mjs');
    if (retainedRuntime === null) fail('GRPC_RELEASE_RUNTIME_REQUIRED');
    return stageRelease(store, { id: body.releaseId, grpcPackage: prepared.directory, runtime: retainedRuntime });
  });
  const openReleaseConsole = () => execute(async () => {
    if (active) fail('GRPC_STOP_WORKSPACE_MERCHANT_BEFORE_RELEASE_CONTROL', 409);
    if (releaseConsole) return { url: releaseConsole.operatorUrl };
    const directory = await originalStore();
    const { startReleaseConsole } = await import('../../../sf82-seller-pilot/release-console.mjs');
    releaseConsole = await startReleaseConsole(directory, { port: 0, env: environment });
    const owned = releaseConsole;
    owned.closed.then(() => { if (releaseConsole === owned) releaseConsole = null; }, () => {});
    return { url: releaseConsole.operatorUrl };
  });
  const closeReleaseConsole = () => execute(async () => {
    await releaseConsole?.close(); releaseConsole = null; return runtime();
  });
  function close() {
    if (closePromise) return closePromise;
    closing = true;
    closePromise = (async () => {
      try { await busy; await releaseConsole?.close(); releaseConsole = null; await stopInside(); }
      finally { await lease.close(); }
    })();
    return closePromise;
  }
  try {
    for (const directory of Object.values(folders)) await privateDirectory(directory, true);
    revisionIndex = await optional(join(root, 'revisions.json'), 1048576) ?? [];
    if (!Array.isArray(revisionIndex) || revisionIndex.some(row => !REV.test(row.id))) fail('GRPC_WORKSPACE_INDEX_INVALID', 409);
    current = await optional(join(root, 'current.json'), 65536);
    if (current && (current.schema !== 'stellar-forge.grpc-workspace-current.v1' ||
        !REV.test(current.revision) || !Number.isSafeInteger(current.generation))) fail('GRPC_WORKSPACE_CURRENT_INVALID', 409);
    if (current) await revision(current.revision);
    previousRun = await optional(join(root, 'run.json'), 65536);
    if (previousRun && !['STOPPED', 'START_FAILED'].includes(previousRun.phase))
      previousRun = { ...previousRun, phase: 'PREVIOUS_OWNER_ENDED', note: 'The prior workspace process ended before recording its final stop. Select a retained merchant to run again.' };
    if (sourceFile || protoDirectory || entrypoints || planFile) {
      if (!sourceFile || !protoDirectory || !entrypoints || !planFile) fail('GRPC_INITIAL_SOURCE_PROTO_PLAN_REQUIRED');
      if (current) fail('GRPC_WORKSPACE_ALREADY_HAS_SOURCE', 409);
      const source = await readJson(sourceFile, 65536), plan = await readJson(planFile, 262144);
      const protoSource = await captureProtoSource({ directory: protoDirectory, entrypoints });
      await saveInside({ source, protoSource, plan, baseRevision: null, title: 'gRPC merchant' });
    }
  } catch (issue) { await lease.close(); throw issue; }
  return { stateDirectory: root, state, runtime, save, capture, open, checkout, method, review,
    call, readAttempt, prepare, run, stop, download, archive, stage, openReleaseConsole, closeReleaseConsole, close,
    bindOperationsNavigationOrigin(origin) {
      const url = new URL(origin);
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.origin !== origin) fail('GRPC_WORKSPACE_ORIGIN_INVALID');
      navigationOrigin = origin;
    } };
}
