#!/usr/bin/env node
// MIT. One explicit native gRPC -> merchant MCP -> usable customer receiving journey.
// Uses the original included service, original stores/HTTP servers and original file transport.
import { mkdir, lstat, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash, randomUUID, randomBytes } from 'node:crypto';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  if (!['--source-root', '--out', '--resume', '--source-commit'].includes(key) || value === undefined || args.has(key))
    throw new Error('Use --source-root COMPLETE_SOURCE with either --out NEW_PRIVATE_DIRECTORY or --resume SAVED_DIRECTORY, and --source-commit REVIEWED_COMMIT.');
  args.set(key, value);
}
if (args.has('--out') === args.has('--resume') || !/^[0-9a-f]{40}$/.test(args.get('--source-commit') ?? ''))
  throw new Error('Supply exactly one --out or --resume directory and the reviewed --source-commit.');
const resuming = args.has('--resume');
const sourceRoot = resolve(args.get('--source-root') ?? root), out = resolve(args.get(resuming ? '--resume' : '--out'));
if (resuming) {
  const stat = await lstat(out);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077))
    throw new Error('Resume the original private real journey directory.');
} else await mkdir(out, { mode: 0o700 });
const nativePath = 'stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/';
const merchantPath = 'stellar-forge/mcp-merchant-operator/';
const imported = path => import(pathToFileURL(join(sourceRoot, path)).href);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const requireValue = (condition, reason) => { if (!condition) throw new Error(reason); };
const privateJson = async (name, value) => writeFile(join(out, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
const previous = resuming ? JSON.parse(await readFile(join(out, 'journey.json'), 'utf8')) : null;
const receivingPhases = ['captured-source-and-native-revisions', 'native-call-and-original-recovery',
  'complete-customer-download-resume-and-repeat', 'complete-source-receiving'];
if (resuming) {
  requireValue(previous.schema === 'stellar-forge.grpc-agent-native-journey.v1' && previous.state !== 'COMPLETE' &&
    Array.isArray(previous.phases) && receivingPhases.every(name => previous.phases.some(row => row.name === name)) &&
    previous.shutdown?.every(row => row.closed) === true,
    'Resume requires the original completed call/receiving phases and closed prior servers.');
}
const report = previous ?? { schema: 'stellar-forge.grpc-agent-native-journey.v1', sourceCommit: args.get('--source-commit'),
  runId: randomUUID(), startedAt: new Date().toISOString(), source: 'original included native gRPC example', node: process.version,
  originalCalls: [], phases: [], state: 'STARTED' };
if (resuming) {
  report.continuations ??= [];
  report.continuations.push({ startedAt: new Date().toISOString(), sourceCommit: report.sourceCommit,
    sourceFiles: report.sourceFiles, previousState: report.state, failure: report.failure,
    finishedAt: report.finishedAt, schemaAssertions: report.phases.find(row => row.name === 'native-schema-assertions'),
    retainedPhases: report.phases.filter(row => row.name !== 'native-schema-assertions').map(row => row.name) });
  for (const row of report.phases) row.sourceCommit ??= report.sourceCommit;
  report.sourceCommit = args.get('--source-commit'); report.node = process.version; report.state = 'STARTED';
  delete report.failure; delete report.finishedAt; delete report.shutdown;
}
const checkpoint = async () => {
  await writeFile(join(out, 'journey.next.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  await rename(join(out, 'journey.next.json'), join(out, 'journey.json'));
};
let example, source, receiving, merchant, client;
const phase = async (name, action) => {
  const retained = report.phases.find(row => row.name === name);
  if (resuming && retained && name !== 'native-schema-assertions') {
    process.stdout.write(JSON.stringify({ phase: name, state: 'RETAINED', sourceCommit: retained.sourceCommit }) + '\n');
    return retained;
  }
  const startedAt = new Date().toISOString();
  const value = await action();
  const result = { name, sourceCommit: report.sourceCommit, startedAt, finishedAt: new Date().toISOString(), ...value };
  if (retained) report.phases[report.phases.indexOf(retained)] = result; else report.phases.push(result);
  await checkpoint(); process.stdout.write(JSON.stringify({ phase: name, state: 'COMPLETE' }) + '\n');
  return result;
};
try {
  const { startExample } = await imported(nativePath + 'examples/server.mjs');
  const { startGrpcWorkspace } = await imported(nativePath + 'workspace/server.mjs');
  const { initializeGrpcWorkspaceMerchant } = await imported(merchantPath + 'config.mjs');
  const { startMerchantMcp } = await imported(merchantPath + 'serve.mjs');
  const { openMerchantFileClient } = await imported(merchantPath + 'retained-download.mjs');
  const { downloadGrpcExport } = await imported(merchantPath + 'grpc-workspace-download.mjs');
  const { grpcCanonical } = await imported(merchantPath + 'grpc-workspace-export.mjs');
  const { validateBazaarExtension } = await imported('stellar-forge/payment-auto-catalog/schema-validation.mjs');
  const environment = { ...process.env, GRPC_DEMO_AUTHORIZATION: randomBytes(24).toString('hex'),
    GRPC_AGENT_MCP_TOKEN: randomBytes(32).toString('hex') };
  report.sourceFiles = {};
  for (const path of [nativePath + 'examples/server.mjs', nativePath + 'workspace/model.mjs', nativePath + 'workspace/server.mjs', nativePath + 'prepare.mjs',
    'stellar-forge/payment-auto-catalog/schema-validation.mjs',
    merchantPath + 'grpc-workspace.mjs', merchantPath + 'grpc-workspace-export.mjs', merchantPath + 'grpc-workspace-download.mjs',
    merchantPath + 'operator.mjs', merchantPath + 'config.mjs', merchantPath + 'serve.mjs'])
    report.sourceFiles[path] = sha(await readFile(join(sourceRoot, path)));
  await phase('native-schema-assertions', async () => {
    const validate = (info, assertions) => validateBazaarExtension({ info,
      schema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', ...assertions } });
    const choice = { oneOf: [{ required: ['email'] }, { required: ['account'] },
      { not: { anyOf: [{ required: ['email'] }, { required: ['account'] }] } }] };
    requireValue(validate({}, choice).ok && validate({ account: 'native' }, choice).ok &&
      !validate({ account: 'native', email: 'operator@example.test' }, choice).ok,
      'Original oneof presence assertions did not preserve zero-or-one selection.');
    const keys = { propertyNames: { pattern: '^(?:0|[1-9][0-9]*)$' }, additionalProperties: { type: 'string' } };
    requireValue(validate({ '0': 'zero', '12': 'twelve' }, keys).ok && !validate({ '01': 'noncanonical' }, keys).ok &&
      validate({}, { propertyNames: false }).ok && !validate({ field: 1 }, { propertyNames: false }).ok,
      'Original propertyNames assertions did not preserve exact map keys.');
    requireValue(!validate({}, { not: true }).ok && validate({}, { not: false }).ok &&
      !validate({}, { not: { $ref: '#/missing' } }).ok &&
      validate({}, { patternProperties: {} }).reason === 'SCHEMA_KEYWORD_UNSUPPORTED:patternProperties',
      'Negation changed original malformed-reference or unsupported-keyword behavior.');
    const malformed = [
      [{}, { not: { anyOf: [{ $ref: '#/missing' }] } }, 'SCHEMA_LOCAL_REFERENCE_MISSING'],
      [{}, { not: { oneOf: [{ $ref: '#/missing' }] } }, 'SCHEMA_LOCAL_REFERENCE_MISSING'],
      [{ field: 1 }, { propertyNames: { not: { anyOf: [{ $ref: '#/missing' }] } } }, 'SCHEMA_LOCAL_REFERENCE_MISSING'],
      [{}, { title: 'annotation', not: { $ref: '#/title' } }, 'SCHEMA_NODE_INVALID'],
      [{}, { anyOf: [true, { $ref: '#/missing' }] }, 'SCHEMA_LOCAL_REFERENCE_MISSING'],
    ];
    for (const [info, schema, reason] of malformed)
      requireValue(validate(info, schema).reason === reason, 'A malformed reference was admitted through an alternate schema branch.');
    const recursive = { $defs: { node: { type: 'object', properties: {
      value: { type: 'integer' }, child: { $ref: '#/$defs/node' },
    }, additionalProperties: false } }, $ref: '#/$defs/node' };
    requireValue(validate({ value: 1, child: { value: 2, child: { value: 3 } } }, recursive).ok &&
      !validate({ value: 1, child: { value: 'wrong type' } }, recursive).ok &&
      validate({}, { not: { $ref: '#' } }).reason === 'SCHEMA_REFERENCE_CYCLE',
      'Finite recursive values or the same-instance cycle guard changed.');
    const repeatedBranch = { properties: { child: { $ref: '#/$defs/node' } } };
    const amplification = { $defs: { node: { type: 'object', allOf: [repeatedBranch, repeatedBranch] } }, $ref: '#/$defs/node' };
    let nested = {}; for (let i = 0; i < 18; i++) nested = { child: nested };
    requireValue(validate(nested, amplification).reason === 'SCHEMA_EVALUATION_LIMIT',
      'Recursive alternatives did not share the validation evaluation budget.');
    return { oneofPresence: 'preserved', canonicalMapKeys: 'enforced', originalUnsupportedKeywords: 'retained',
      malformedReferences: malformed.length, finiteRecursion: 'preserved', sameInstanceCycles: 'rejected', evaluationBudget: 'enforced' };
  });
  const savedSource = resuming ? JSON.parse(await readFile(join(out, 'source.json'), 'utf8')) : null;
  let examplePort = 0;
  if (resuming) {
    const match = /^127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(savedSource.target);
    requireValue(match && Number(match[1]) <= 65535, 'The retained original example target is invalid.');
    examplePort = Number(match[1]);
  }
  example = await startExample({ port: examplePort, authorization: environment.GRPC_DEMO_AUTHORIZATION });
  source = await startGrpcWorkspace({ port: 0, stateDirectory: join(out, 'source-workspace'), env: environment });
  receiving = await startGrpcWorkspace({ port: 0, stateDirectory: join(out, 'receiving-workspace'), env: environment });
  let original;
  if (resuming) original = { source: savedSource, plan: JSON.parse(await readFile(join(out, 'plan.json'), 'utf8')) };
  else {
    const nativeUrl = new URL(source.url);
    const response = await fetch(nativeUrl.origin + '/api/example', { headers: { 'x-workspace-token': nativeUrl.hash.slice(1) } });
    requireValue(response.ok, 'The original native example settings could not be read.');
    original = await response.json(); original.source.target = example.target;
  }
  const method = original.plan.routes[0].grpcMethod;
  const input = resuming ? JSON.parse(await readFile(join(out, 'request.json'), 'utf8')) : original.plan.routes[0].example;
  if (!resuming) {
    await privateJson('source.json', original.source); await privateJson('plan.json', original.plan); await privateJson('request.json', input);
  }
  await writeFile(join(out, 'source-url.txt'), source.url + '\n', { mode: 0o600, flag: resuming ? 'w' : 'wx' });
  await writeFile(join(out, 'receiving-url.txt'), receiving.url + '\n', { mode: 0o600, flag: resuming ? 'w' : 'wx' });
  if (!resuming) await privateJson('connection.json', { schema: 'stellar-forge.grpc-workspace-connection.v1', workspaces: {
    source: { consoleUrlFile: './source-url.txt', captures: { original: { label: 'Original native analytics merchant',
      directory: original.protoDirectory, entrypoints: original.entrypoints, sourceFile: './source.json', planFile: './plan.json' } },
      files: { request: { kind: 'request', path: './request.json' } } },
    receiving: { consoleUrlFile: './receiving-url.txt' },
  } });
  const initialized = resuming ? { configuration: join(out, 'merchant-agent', 'merchant-mcp.json') }
    : await initializeGrpcWorkspaceMerchant({ directory: join(out, 'merchant-agent'), connection: join(out, 'connection.json') });
  merchant = await startMerchantMcp({ configPath: initialized.configuration, port: 0, tokenEnv: 'GRPC_AGENT_MCP_TOKEN', environment });
  client = await openMerchantFileClient({ url: merchant.url, tokenEnv: 'GRPC_AGENT_MCP_TOKEN', environment });
  const call = (name, values = {}) => client.call('merchant_grpc_' + name, { workspace: 'source', ...values }, { timeoutMs: 420000 });
  const ids = resuming ? JSON.parse(await readFile(join(out, 'operation-ids.json'), 'utf8'))
    : { call: randomUUID(), secondCall: randomUUID(), firstPreparation: randomUUID(), secondPreparation: randomUUID() };
  if (!resuming) await privateJson('operation-ids.json', ids);
  let first, second, currentPlan, customer, revisionExport;
  if (resuming) {
    const captured = report.phases.find(row => row.name === 'captured-source-and-native-revisions');
    first = { revision: captured.firstRevision, protoSha256: captured.protoSha256 };
    second = { revision: captured.secondRevision, protoSha256: captured.protoSha256 };
    currentPlan = (await call('revision', { revision: second.revision, section: 'plan' })).plan;
    for (const operationId of [ids.call, ids.secondCall])
      requireValue((await call('attempt', { operationId })).phase === 'COMPLETED', 'A retained original native call is incomplete.');
    requireValue(example.calls.length === 0, 'Reopening the retained workspace dispatched an application RPC.');
  }
  await phase('captured-source-and-native-revisions', async () => {
    first = await call('capture', { capture: 'original', baseRevision: null });
    const methods = await call('revision', { revision: first.revision, section: 'methods' });
    requireValue(methods.items.some(row => row.path === method && row.selectable), 'The original unary method is missing.');
    requireValue(methods.items.some(row => row.responseStream && !row.selectable), 'The original streaming method lost its native selection contract.');
    await call('method', { revision: first.revision, method });
    currentPlan = (await call('revision', { revision: first.revision, section: 'plan' })).plan;
    currentPlan.routes[0].description += ' — received through the original merchant agent';
    second = await call('save', { revision: first.revision, baseRevision: first.revision, plan: currentPlan, title: 'Native analytics agent receiving' });
    requireValue(first.revision !== second.revision && first.protoSha256 === second.protoSha256, 'Saved source changed the captured protobuf closure.');
    let conflict;
    try { await call('save', { revision: first.revision, baseRevision: first.revision, title: 'Stale concurrent edit' }); }
    catch (error) { conflict = error.code; }
    requireValue(conflict === 'GRPC_WORKSPACE_REVISION_CONFLICT', 'The original revision conflict was not preserved.');
    return { firstRevision: first.revision, secondRevision: second.revision, protoSha256: second.protoSha256, methods: methods.total, conflict };
  });
  await phase('native-call-and-original-recovery', async () => {
    await call('review', { revision: second.revision });
    requireValue(example.calls.length === 0, 'Channel review dispatched an application RPC.');
    const result = await call('call', { revision: second.revision, operationId: ids.call, method, file: 'request' });
    requireValue(result.phase === 'COMPLETED' && result.output.record_id === input.account_id &&
      result.output.observed_sequence === '-9223372036854775808', 'The original native exact-value response changed.');
    const recovered = await call('attempt', { operationId: ids.call });
    const repeated = await call('call', { revision: second.revision, operationId: ids.call, method, file: 'request' });
    requireValue(recovered.responseSha256 === result.responseSha256 && repeated.responseSha256 === result.responseSha256 &&
      example.calls.length === 1, 'Recovering the original call dispatched a duplicate RPC or changed output.');
    await call('call', { revision: second.revision, operationId: ids.secondCall, method, file: 'request' });
    const page = await call('inventory', { kind: 'attempts', limit: 1 });
    const next = await call('inventory', { kind: 'attempts', offset: page.nextOffset, limit: 1, expectedSnapshot: page.snapshot });
    requireValue(page.total === 2 && page.items.length === 1 && next.items.length === 1 && next.nextOffset === null,
      'Complete original attempt pagination did not retain both calls.');
    report.originalCalls = [ids.call, ids.secondCall];
    return { operationId: ids.call, responseSha256: result.responseSha256, nativeCalls: example.calls.length, attempts: page.total };
  });
  await phase('complete-customer-download-resume-and-repeat', async () => {
    await call('prepare', { revision: second.revision, operationId: ids.secondPreparation });
    customer = await call('export', { kind: 'customer', preparation: ids.secondPreparation });
    requireValue(customer.files.length === 7, 'The customer export omitted an original file.');
    const controller = new AbortController(); let interrupted = false;
    const options = { url: merchant.url, exportId: customer.exportId, directory: join(out, 'customer'),
      tokenEnv: 'GRPC_AGENT_MCP_TOKEN', environment, expectedManifestSha256: customer.manifestFile.sha256 };
    try { await downloadGrpcExport({ ...options, chunkSize: 1024, signal: controller.signal,
      onProgress: () => controller.abort(new Error('Intentional saved-prefix receiving interruption')) }); }
    catch (error) { if (!controller.signal.aborted) throw error; interrupted = true; }
    requireValue(interrupted, 'The receiving interruption did not occur.');
    const received = await downloadGrpcExport(options), repeated = await downloadGrpcExport(options);
    requireValue(received.resumedBytes > 0 && repeated.files === 7 && repeated.resumed && repeated.directory === options.directory,
      'Receiving did not resume and repeat with the usable native layout.');
    for (const file of customer.files) {
      const bytes = await readFile(join(options.directory, file.path));
      requireValue(bytes.length === file.bytes && sha(bytes) === file.sha256, 'A received native customer file changed: ' + file.path);
    }
    const sdk = await import(pathToFileURL(join(received.customerDirectory, 'seller-client.mjs')).href);
    return { exportId: customer.exportId, manifestSha256: customer.manifestFile.sha256, received,
      repeated: { files: repeated.files, resumedBytes: repeated.resumedBytes }, sdkExports: Object.keys(sdk), originalFiles: customer.files };
  });
  await phase('complete-source-receiving', async () => {
    revisionExport = await call('export', { kind: 'revision', revision: second.revision });
    const imported = await call('import', { workspace: 'receiving', exportId: revisionExport.exportId, baseRevision: null });
    requireValue(imported.revision === second.revision && imported.protoSha256 === second.protoSha256, 'Receiving changed the original native revision identity.');
    const nativePlan = await call('revision', { workspace: 'receiving', revision: imported.revision, section: 'plan' });
    requireValue(grpcCanonical(nativePlan.plan) === grpcCanonical(currentPlan), 'Receiving changed complete original merchant terms.');
    return { exportId: revisionExport.exportId, receivingRevision: imported.revision, protoSha256: imported.protoSha256 };
  });
  await phase('original-direct-merchant', async () => {
    const runtime = await call('run', { preparation: ids.secondPreparation });
    requireValue(runtime.active?.phase === 'RUNNING', 'The original direct merchant did not start.');
    const callsBeforeChallenge = example.calls.length;
    const native = await fetch(runtime.active.url + currentPlan.routes[0].path, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    await native.arrayBuffer();
    requireValue(native.status === 402 && example.calls.length === callsBeforeChallenge, 'The original unpaid challenge dispatched an application RPC.');
    const stopped = await call('stop');
    requireValue(!stopped.active, 'The original direct merchant did not drain.');
    return { runId: runtime.active.id, mode: runtime.active.mode, challengeStatus: native.status, nativeCalls: example.calls.length };
  });
  await phase('original-release-activation-drain-and-rollback', async () => {
    const selected = await call('status');
    if (selected.currentRevision !== first.revision)
      await call('checkout', { revision: first.revision, baseRevision: selected.currentRevision });
    await call('prepare', { revision: first.revision, operationId: ids.firstPreparation });
    await call('checkout', { revision: second.revision, baseRevision: first.revision });
    const suffix = report.runId.slice(0, 8), one = 'grpc-agent-a-' + suffix, two = 'grpc-agent-b-' + suffix;
    await call('stage', { preparation: ids.firstPreparation, releaseId: one });
    await call('stage', { preparation: ids.secondPreparation, releaseId: two });
    await call('release_open');
    await call('release_diff', { from: one, to: two });
    const operate = async (action, values) => {
      const status = await call('release_status');
      return call(action, { expectedGeneration: status.state.generation, ...values });
    };
    await operate('release_activate', { id: one, reason: 'Original first native merchant' });
    let running = await operate('release_run', {});
    await call('release_stop', { instanceId: running.console.instanceId });
    await operate('release_activate', { id: two, reason: 'Reviewed original merchant revision' });
    running = await operate('release_run', {});
    await call('release_stop', { instanceId: running.console.instanceId });
    await operate('release_rollback', { to: one, reason: 'Reopen the original retained merchant' });
    running = await operate('release_run', {});
    const rollbackInstance = running.console.instanceId;
    await call('release_stop', { instanceId: rollbackInstance });
    const final = await call('release_status');
    requireValue(final.state.active === one && !final.console.instanceId, 'The original rollback or drain changed its retained selection.');
    await call('release_close');
    return { firstRelease: one, secondRelease: two, rollbackInstance, generation: final.state.generation, selectedRelease: final.state.active };
  });
  report.state = 'COMPLETE'; report.nativeCalls = report.phases.find(row => row.name === 'native-call-and-original-recovery').nativeCalls;
  if (resuming) report.continuations.at(-1).additionalNativeCalls = example.calls.length;
} catch (error) {
  report.state = 'FAILED'; report.failure = { code: error.code ?? null, message: error.message };
  process.exitCode = 1;
} finally {
  const close = async (name, operation) => {
    try { await operation?.(); return { name, closed: true }; }
    catch (error) { process.exitCode = 1; return { name, closed: false, code: error.code ?? null, message: error.message }; }
  };
  report.shutdown = [];
  report.shutdown.push(await close('merchant-mcp', merchant && (() => merchant.close())));
  report.shutdown.push(await close('source-workspace', source && (() => source.close())));
  report.shutdown.push(await close('receiving-workspace', receiving && (() => receiving.close())));
  report.shutdown.push(await close('original-grpc-example', example && (() => example.close())));
  if (report.shutdown.some(value => !value.closed)) report.state = 'FAILED';
  report.finishedAt = new Date().toISOString(); await checkpoint();
  process.stdout.write(JSON.stringify({ state: report.state, directory: out, phases: report.phases.length,
    nativeCalls: report.nativeCalls ?? null, failure: report.failure ?? null, closed: report.shutdown.every(row => row.closed) }) + '\n');
}
