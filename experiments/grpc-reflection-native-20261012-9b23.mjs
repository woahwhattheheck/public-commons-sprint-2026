#!/usr/bin/env node
// MIT. One original reflection -> private workspace -> merchant/customer receiving operation.
import { mkdir, readFile, writeFile, rename, lstat, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  if (!['--source-root', '--out', '--resume', '--source-commit', '--phase', '--chrome-bin'].includes(key) ||
      value === undefined || args.has(key)) throw new Error('Use --source-root, --source-commit, --out NEW_DIRECTORY or --resume SAVED_DIRECTORY, and --phase native|browser.');
  args.set(key, value);
}
if (args.has('--out') === args.has('--resume') || !/^[a-f0-9]{40}$/.test(args.get('--source-commit') ?? ''))
  throw new Error('Retain one private operation directory and the exact reviewed source commit.');
const sourceRoot = resolve(args.get('--source-root') ?? fileURLToPath(new URL('../', import.meta.url)));
const out = resolve(args.get('--out') ?? args.get('--resume')), resuming = args.has('--resume');
const operationPhase = args.get('--phase') ?? 'native';
if (!['native', 'browser'].includes(operationPhase)) throw new Error('Choose native or browser continuation.');
if (resuming) {
  const s = await lstat(out);
  if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o077)) throw new Error('Resume the original private operation directory.');
} else await mkdir(out, { mode: 0o700 });
const nativePath = 'stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/';
const merchantPath = 'stellar-forge/mcp-merchant-operator/';
const imported = name => import(pathToFileURL(join(sourceRoot, name)).href);
const runtimeRequire = createRequire(join(sourceRoot, 'package.json'));
const grpc = runtimeRequire('@grpc/grpc-js'), protoLoader = runtimeRequire('@grpc/proto-loader');
const descriptor = runtimeRequire('protobufjs/ext/descriptor/index.js');
const hash = value => createHash('sha256').update(value).digest('hex');
const need = (condition, message) => { if (!condition) throw new Error(message); };
const privateJson = async (name, value, overwrite = false) => writeFile(join(out, name),
  JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: overwrite ? 'w' : 'wx' });
const report = resuming ? JSON.parse(await readFile(join(out, 'journey.json'), 'utf8')) : {
  schema: 'stellar-forge.grpc-reflection-native-journey.v1', runId: randomUUID(), startedAt: new Date().toISOString(),
  sourceCommit: args.get('--source-commit'), node: process.version, state: 'STARTED', phases: [], retained: {},
};
if (resuming) {
  need(report.schema === 'stellar-forge.grpc-reflection-native-journey.v1' && report.shutdown?.every(x => x.closed),
    'Resume the original saved operation after all of its prior servers closed.');
  report.continuations ??= []; report.continuations.push({ at: new Date().toISOString(),
    previousState: report.state, sourceCommit: args.get('--source-commit'), previousFailure: report.failure ?? null });
}
report.sourceCommit = args.get('--source-commit'); report.state = 'STARTED'; delete report.failure;
const state = report.retained, checkpoint = async () => {
  await writeFile(join(out, 'journey.next.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  await rename(join(out, 'journey.next.json'), join(out, 'journey.json'));
};
const phase = async (name, action) => {
  const retained = report.phases.find(x => x.name === name);
  if (retained) return retained;
  const result = { name, sourceCommit: report.sourceCommit, startedAt: new Date().toISOString(), ...await action(),
    finishedAt: new Date().toISOString() };
  report.phases.push(result); await checkpoint();
  process.stdout.write(JSON.stringify({ phase: name, state: 'COMPLETE' }) + '\n'); return result;
};
const ids = state.ids ??= { firstCapture: randomUUID(), nextCapture: randomUUID(), call: randomUUID(),
  firstPreparation: randomUUID(), secondPreparation: randomUUID() };
await checkpoint();
const runFile = promisify(execFile);
const ownedEnvironment = {
  GRPC_REFLECTION_AUTH: randomBytes(24).toString('hex'), GRPC_REFLECTION_BINARY: Buffer.from('native-reflection-metadata').toString('base64'),
  GRPC_REFLECTION_MCP_TOKEN: randomBytes(32).toString('hex'),
};
let endpoint, workspace, receiving, merchant, browser;
const nativeCalls = [], reflectionRequests = [];
let sourceConfig;
async function tlsMaterial() {
  const dir = join(out, 'tls');
  try { await access(join(dir, 'ready')); }
  catch {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const command = async values => runFile('openssl', values, { cwd: dir, maxBuffer: 131072 });
    await command(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.crt',
      '-days', '2', '-subj', '/CN=Native reflection operation CA']);
    for (const name of ['server', 'client']) {
      await command(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', name + '.key', '-out', name + '.csr',
        '-subj', '/CN=' + (name === 'server' ? 'localhost' : 'reflection-operator')]);
      await writeFile(join(dir, name + '.ext'), name === 'server' ?
        'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n' : 'extendedKeyUsage=clientAuth\n', { mode: 0o600 });
      await command(['x509', '-req', '-in', name + '.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial',
        '-out', name + '.crt', '-days', '2', '-extfile', name + '.ext']);
    }
    await writeFile(join(dir, 'ready'), 'native ephemeral TLS material\n', { mode: 0o600 });
  }
  ownedEnvironment.GRPC_REFLECTION_CA = await readFile(join(dir, 'ca.crt'), 'utf8');
  ownedEnvironment.GRPC_REFLECTION_CERT = await readFile(join(dir, 'client.crt'), 'utf8');
  ownedEnvironment.GRPC_REFLECTION_KEY = await readFile(join(dir, 'client.key'), 'utf8');
  return { ca: Buffer.from(ownedEnvironment.GRPC_REFLECTION_CA),
    serverCert: await readFile(join(dir, 'server.crt')), serverKey: await readFile(join(dir, 'server.key')) };
}
const plainFiles = {
  'defaults.proto': 'syntax = "proto2"; package commons.defaults; message Defaults { optional double ratio = 1 [default = 1.25]; optional bytes marker = 2 [default = "\\001\\377"]; optional uint64 precise = 3 [default = 18446744073709551615]; }\n',
  'shared.proto': 'syntax = "proto3"; package commons.reflection.v1; import "defaults.proto"; message AccountRequest { uint64 account_id = 1 [json_name = "accountPublicId"]; map<string,sint64> tags = 2; optional string note = 3; oneof filter { string email = 4; uint64 customer = 5; } commons.defaults.Defaults defaults = 6; } message AccountReply { uint64 account_id = 1; map<string,sint64> tags = 2; optional string note = 3; sint64 sequence = 4; bytes evidence = 5; commons.defaults.Defaults defaults = 6; }\n',
  'ledger.proto': 'syntax = "proto3"; package commons.reflection.v1; import "shared.proto"; service Ledger { rpc Get(AccountRequest) returns(AccountReply); } service Audit { rpc Inspect(AccountRequest) returns(AccountReply); rpc Check(AccountRequest) returns(AccountReply); } service Internal { rpc Hidden(AccountRequest) returns(AccountReply); }\n',
};
const field = (name, number, type, extra = {}) => ({ name, number, label: 1, type, ...extra });
const mapEntry = { name: 'TagsEntry', options: { mapEntry: true }, field: [field('key', 1, 9), field('value', 2, 18)] };
const fileDescriptors = {
  'defaults.proto': { name: 'defaults.proto', package: 'commons.defaults', syntax: 'proto2', messageType: [{ name: 'Defaults',
    field: [field('ratio', 1, 1, { defaultValue: '1.25' }), field('marker', 2, 12, { defaultValue: '\\001\\377' }),
      field('precise', 3, 4, { defaultValue: '18446744073709551615' })] }] },
  'shared.proto': { name: 'shared.proto', package: 'commons.reflection.v1', syntax: 'proto3', dependency: ['defaults.proto'],
    messageType: [
      { name: 'AccountRequest', nestedType: [mapEntry], oneofDecl: [{ name: 'filter' }, { name: '_note' }],
        field: [field('account_id', 1, 4, { jsonName: 'accountPublicId' }),
          field('tags', 2, 11, { label: 3, typeName: '.commons.reflection.v1.AccountRequest.TagsEntry' }),
          field('note', 3, 9, { oneofIndex: 1, proto3Optional: true }), field('email', 4, 9, { oneofIndex: 0 }),
          field('customer', 5, 4, { oneofIndex: 0 }), field('defaults', 6, 11, { typeName: '.commons.defaults.Defaults' })] },
      { name: 'AccountReply', nestedType: [mapEntry], oneofDecl: [{ name: '_note' }],
        field: [field('account_id', 1, 4), field('tags', 2, 11, { label: 3, typeName: '.commons.reflection.v1.AccountReply.TagsEntry' }),
          field('note', 3, 9, { oneofIndex: 0, proto3Optional: true }), field('sequence', 4, 18),
          field('evidence', 5, 12), field('defaults', 6, 11, { typeName: '.commons.defaults.Defaults' })] },
    ] },
};
const serviceNames = ['commons.reflection.v1.Audit', 'commons.reflection.v1.Internal', 'commons.reflection.v1.Ledger'];
const selectedServices = ['commons.reflection.v1.Audit', 'commons.reflection.v1.Ledger'];
const method = '/commons.reflection.v1.Ledger/Get';
function descriptorBytes(name, version) {
  let file = fileDescriptors[name];
  if (name === 'ledger.proto') file = { name, package: 'commons.reflection.v1', syntax: 'proto3', dependency: ['shared.proto'],
    service: [['Ledger', ['Get']], ['Audit', version ? ['Inspect', 'Check'] : ['Inspect']], ['Internal', ['Hidden']]]
      .map(([name, methods]) => ({ name, method: methods.map(name => ({ name, inputType: '.commons.reflection.v1.AccountRequest',
        outputType: '.commons.reflection.v1.AccountReply' })) })) };
  return descriptor.FileDescriptorProto.encode(descriptor.FileDescriptorProto.fromObject(file)).finish();
}
async function startEndpoint(port) {
  const tls = await tlsMaterial(), fixture = join(out, 'endpoint-source');
  await mkdir(fixture, { recursive: true, mode: 0o700 });
  for (const [name, content] of Object.entries(plainFiles)) await writeFile(join(fixture, name), content, { mode: 0o600 });
  const definitions = protoLoader.loadSync(join(fixture, 'ledger.proto'), {
    keepCase: true, longs: String, enums: String, bytes: String, defaults: false, oneofs: true,
  });
  const service = grpc.loadPackageDefinition(definitions).commons.reflection.v1;
  const server = new grpc.Server({ 'grpc.max_receive_message_length': 8388608, 'grpc.max_send_message_length': 8388608 });
  const controller = { mode: 'v1alpha', version: state.secondRevision ? 1 : 0 };
  function authorized(call) {
    return call.metadata.get('authorization')[0] === ownedEnvironment.GRPC_REFLECTION_AUTH &&
      Buffer.isBuffer(call.metadata.get('operator-bin')[0]) &&
      call.metadata.get('operator-bin')[0].equals(Buffer.from('native-reflection-metadata'));
  }
  function application(call, done) {
    if (!authorized(call)) return done({ code: grpc.status.UNAUTHENTICATED, details: 'Original native authorization required.' });
    nativeCalls.push({ method, input: structuredClone(call.request) });
    const response = { account_id: call.request.account_id, tags: call.request.tags,
      sequence: '-9223372036854775808', evidence: Buffer.from('native-reflected-contract').toString('base64') };
    if (Object.hasOwn(call.request, 'note')) response.note = call.request.note;
    if (Object.hasOwn(call.request, 'defaults')) response.defaults = call.request.defaults;
    done(null, response);
  }
  server.addService(service.Ledger.service, { get: application });
  server.addService(service.Audit.service, { inspect: application, check: application });
  server.addService(service.Internal.service, { hidden: application });
  for (const protocol of ['v1', 'v1alpha']) {
    const definitions = protoLoader.loadSync(join(sourceRoot, nativePath, 'reflection', protocol, 'reflection.proto'),
      { keepCase: true, bytes: Buffer, longs: String, defaults: false, oneofs: true });
    const wire = grpc.loadPackageDefinition(definitions).grpc.reflection[protocol].ServerReflection.service;
    server.addService(wire, { serverReflectionInfo(call) {
      reflectionRequests.push({ protocol, kind: 'stream' });
      if (!authorized(call)) { call.emit('error', { code: grpc.status.UNAUTHENTICATED, details: 'Native metadata required.' }); return; }
      if (controller.mode === 'v1alpha' && protocol === 'v1') {
        call.emit('error', { code: grpc.status.UNIMPLEMENTED, details: 'Native compatibility endpoint.' }); return;
      }
      const sent = new Set();
      call.on('data', request => {
        const key = ['list_services', 'file_containing_symbol', 'file_by_filename'].find(name => Object.hasOwn(request, name));
        reflectionRequests.push({ protocol, kind: key, value: request[key] });
        const response = { valid_host: 'localhost', original_request: request };
        if (key === 'list_services') response.list_services_response = { service: serviceNames.map(name => ({ name })) };
        else {
          let names;
          if (key === 'file_containing_symbol' && serviceNames.includes(request[key])) names = ['ledger.proto', 'shared.proto'];
          else if (key === 'file_by_filename' && Object.hasOwn(fileDescriptors, request[key])) names = [request[key]];
          else {
            response.error_response = { error_code: grpc.status.NOT_FOUND, error_message: 'Unknown original source.' };
            call.write(response); return;
          }
          response.file_descriptor_response = { file_descriptor_proto: names.filter(name => !sent.has(name)).map(name => {
            sent.add(name); return descriptorBytes(name, controller.version);
          }) };
        }
        call.write(response);
      });
      call.on('end', () => call.end());
      call.on('error', () => {});
    } });
  }
  const selected = await new Promise((done, reject) => server.bindAsync('127.0.0.1:' + port,
    grpc.ServerCredentials.createSsl(tls.ca, [{ private_key: tls.serverKey, cert_chain: tls.serverCert }], true),
    (error, value) => error ? reject(error) : done(value)));
  return { target: '127.0.0.1:' + selected, controller,
    close: () => new Promise(done => server.tryShutdown(done)) };
}
function requireWireValues(value, input) {
  need(value.account_id === input.account_id && value.sequence === '-9223372036854775808' &&
    value.tags?.largest === '9223372036854775807' && value.tags?.smallest === '-9223372036854775808' &&
    Object.hasOwn(value, 'note') && value.note === '' && Object.keys(value.defaults ?? {}).length === 0,
    'The original wire changed exact integers, a native map, explicit optional presence or absent defaults.');
}
try {
  const previousSource = resuming ? JSON.parse(await readFile(join(out, 'source.json'), 'utf8')) : null;
  endpoint = await startEndpoint(previousSource ? Number(previousSource.target.split(':').at(-1)) : 0);
  sourceConfig = previousSource ?? { schema: 'stellar-forge.grpc-source.v1', target: endpoint.target,
    transport: { mode: 'tls', caEnv: 'GRPC_REFLECTION_CA', certificateEnv: 'GRPC_REFLECTION_CERT',
      privateKeyEnv: 'GRPC_REFLECTION_KEY', serverName: 'localhost' },
    metadata: [{ name: 'authorization', valueEnv: 'GRPC_REFLECTION_AUTH' }, { name: 'operator-bin', valueEnv: 'GRPC_REFLECTION_BINARY' }],
    limits: { timeoutMs: 15000, readyTimeoutMs: 5000 } };
  if (!resuming) await privateJson('source.json', sourceConfig);
  const environment = { ...process.env, ...ownedEnvironment };
  for (const [name, value] of Object.entries(ownedEnvironment)) process.env[name] = value;
  const input = { account_id: '18446744073709551615', tags: { largest: '9223372036854775807', smallest: '-9223372036854775808' },
    note: '', customer: '9007199254740993', defaults: {} };
  const plan = { schema: 'stellar-forge.grpc-merchant-plan.v1', publicOrigin: 'https://merchant.example.com',
    payment: { scheme: 'exact', network: 'stellar:testnet', amount: '25000', asset: 'UNVERIFIED_DEMO_ASSET',
      payTo: 'UNVERIFIED_DEMO_RECIPIENT', maxTimeoutSeconds: 60 },
    routes: [{ id: 'account', path: '/account', grpcMethod: method, serviceName: 'Reflected account ledger',
      description: 'Original reflected typed account operation.', example: input }] };
  if (!resuming) { await privateJson('request.json', input); await privateJson('plan.json', plan); }
  const { startGrpcWorkspace } = await imported(nativePath + 'workspace/server.mjs');
  const openWorkspace = async () => {
    workspace = await startGrpcWorkspace({ port: 0, stateDirectory: join(out, 'source-workspace'), env: environment });
    await writeFile(join(out, 'source-url.txt'), workspace.url + '\n', { mode: 0o600 });
  };
  await openWorkspace();
  if (operationPhase === 'native') {
    await phase('original-reflection-tls-protocol-and-descriptor-closure', async () => {
      const { inspectGrpcReflection } = await imported(nativePath + 'reflection.mjs');
      const { compileProtoSource } = await imported(nativePath + 'proto.mjs');
      const { main } = await imported(nativePath + 'cli.mjs');
      const stdout = { write() {} };
      const inventory = await main(['reflect', '--source', join(out, 'source.json')], { stdout });
      need(inventory.protocol === 'v1alpha' && inventory.services.length === 3, 'Native UNIMPLEMENTED fallback lost the complete service inventory.');
      const beforeFailure = reflectionRequests.length;
      let denied;
      try { await inspectGrpcReflection(sourceConfig, { env: { ...environment, GRPC_REFLECTION_AUTH: 'wrong-native-metadata' } }); }
      catch (error) { denied = error.grpcCode; }
      need(denied === 'UNAUTHENTICATED' && reflectionRequests.slice(beforeFailure).filter(x => x.kind === 'stream').length === 1,
        'Authentication failure triggered reflection fallback or changed its native status.');
      const filename = join(out, 'cli-descriptor-source.json');
      try { await access(filename); }
      catch { await main(['reflect-capture', '--source', join(out, 'source.json'), '--service', selectedServices[0],
        '--service', selectedServices[1], '--expected-inventory-sha', inventory.sha256, '--out', filename], { stdout }); }
      const captured = JSON.parse(await readFile(filename, 'utf8')), compiled = compileProtoSource(captured);
      need(captured.files.length === 3 && captured.files.every(x => !Object.hasOwn(x, 'content') &&
        hash(Buffer.from(x.descriptorBase64, 'base64')) === x.sha256), 'Exact native descriptor bytes or import closure changed.');
      need(Object.keys(compiled.methods).length === 2 && !Object.keys(compiled.methods).some(x => x.includes('.Internal/')),
        'Unselected service methods escaped the reviewed descriptor selection.');
      const request = compiled.root.lookupType('commons.reflection.v1.AccountRequest');
      const defaults = compiled.root.lookupType('commons.defaults.Defaults');
      need(request.fields.tags.map && Boolean(request.fields.note.hasPresence) &&
        Boolean(request.fields.note.partOf?.isProto3Optional) && request.fields.account_id.getOption('json_name') === 'accountPublicId',
        'Native reflected map, optional presence or original JSON name changed.');
      need(defaults.fields.ratio.defaultValue === 1.25 && Buffer.from(defaults.fields.marker.defaultValue).equals(Buffer.from([1, 255])) &&
        defaults.fields.precise.descriptorMetadata.declaredDefault === '18446744073709551615',
        'Native declared double, bytes or exact 64-bit default metadata changed.');
      endpoint.controller.mode = 'v1';
      const stable = await inspectGrpcReflection(sourceConfig, { env: environment, protocol: 'v1' });
      need(stable.protocol === 'v1', 'The original stable v1 protocol did not execute.');
      endpoint.controller.mode = 'v1alpha';
      state.cliSourceSha256 = captured.sha256; await checkpoint();
      return { tls: 'mutual', metadata: ['authorization', 'operator-bin'], compatibilityProtocol: inventory.protocol,
        stableProtocol: stable.protocol, descriptorFiles: captured.files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })),
        selectedServices, methods: Object.keys(compiled.methods), sourceSha256: captured.sha256, denied, nativeApplicationCalls: nativeCalls.length };
    });
    receiving = await startGrpcWorkspace({ port: 0, stateDirectory: join(out, 'receiving-workspace'), env: environment });
    await writeFile(join(out, 'receiving-url.txt'), receiving.url + '\n', { mode: 0o600 });
    try { await access(join(out, 'connection.json')); }
    catch { await privateJson('connection.json', { schema: 'stellar-forge.grpc-workspace-connection.v1',
      workspaces: { source: { consoleUrlFile: './source-url.txt',
        reflections: { endpoint: { label: 'Original reflected account ledger', sourceFile: './source.json', protocol: 'auto' } },
        files: { request: { kind: 'request', path: './request.json' } } }, receiving: { consoleUrlFile: './receiving-url.txt' } } }); }
    const { initializeGrpcWorkspaceMerchant } = await imported(merchantPath + 'config.mjs');
    const { startMerchantMcp } = await imported(merchantPath + 'serve.mjs');
    const { openMerchantFileClient } = await imported(merchantPath + 'retained-download.mjs');
    const { downloadGrpcExport } = await imported(merchantPath + 'grpc-workspace-download.mjs');
    const configPath = join(out, 'merchant-agent', 'merchant-mcp.json');
    try { await access(configPath); }
    catch { await initializeGrpcWorkspaceMerchant({ directory: join(out, 'merchant-agent'), connection: join(out, 'connection.json') }); }
    merchant = await startMerchantMcp({ configPath, port: 0, tokenEnv: 'GRPC_REFLECTION_MCP_TOKEN', environment });
    const client = await openMerchantFileClient({ url: merchant.url, tokenEnv: 'GRPC_REFLECTION_MCP_TOKEN', environment });
    const call = (name, values = {}) => client.call('merchant_grpc_' + name, { workspace: 'source', ...values }, { timeoutMs: 60000 });
    await phase('merchant-retained-reflection-preview-and-recovery', async () => {
      const inventory = await call('reflection_inventory', { profile: 'endpoint' });
      const capture = await call('reflection_capture', { profile: 'endpoint', operationId: ids.firstCapture,
        services: selectedServices, expectedInventorySha256: inventory.sha256, baseRevision: null });
      need((await call('status')).currentRevision === null, 'Reflection preview advanced the saved merchant revision.');
      const before = reflectionRequests.length;
      const repeated = await call('reflection_capture', { profile: 'endpoint', operationId: ids.firstCapture,
        services: selectedServices, expectedInventorySha256: inventory.sha256, baseRevision: null });
      const opened = await call('reflection_open', { captureId: ids.firstCapture });
      need(repeated.captureSha256 === capture.captureSha256 && opened.captureSha256 === capture.captureSha256 &&
        reflectionRequests.length === before, 'Recovering the retained reflection capture queried the endpoint again.');
      const list = await call('inventory', { kind: 'reflections', limit: 1 });
      need(list.total === 1 && list.items[0].id === ids.firstCapture, 'The original capture history did not receive the reflection preview.');
      state.firstCapture = capture; await checkpoint();
      return { operationId: ids.firstCapture, captureSha256: capture.captureSha256,
        sourceSha256: capture.protoSource.sha256, sourceFiles: capture.protoSource.files.length, descriptorRequests: capture.observation.descriptorRequests };
    });
    await phase('original-revision-call-and-reflected-source-refresh', async () => {
      if (!state.firstRevision) {
        state.firstRevision = await call('reflection_save', { captureId: ids.firstCapture,
          expectedCaptureSha256: state.firstCapture.captureSha256, baseRevision: null, title: 'Reflected account ledger', plan });
        await checkpoint();
      }
      let conflict;
      try { await call('reflection_save', { captureId: ids.firstCapture, expectedCaptureSha256: state.firstCapture.captureSha256,
        baseRevision: null, title: 'Concurrent stale reflection edit', plan }); }
      catch (error) { conflict = error.code; }
      need(conflict === 'GRPC_WORKSPACE_REVISION_CONFLICT', 'Reflection source saving lost the original revision CAS.');
      const result = await call('call', { revision: state.firstRevision.revision, operationId: ids.call, method, file: 'request' });
      need(result.phase === 'COMPLETED', 'The selected reflected application method did not complete.'); requireWireValues(result.output, input);
      const before = nativeCalls.length;
      const repeated = await call('call', { revision: state.firstRevision.revision, operationId: ids.call, method, file: 'request' });
      need(repeated.responseSha256 === result.responseSha256 && nativeCalls.length === before, 'Same-ID recovery dispatched another native application call.');
      state.callResponseSha256 = result.responseSha256;
      endpoint.controller.version = 1;
      const inventory = await call('reflection_inventory', { revision: state.firstRevision.revision });
      const capture = await call('reflection_capture', { revision: state.firstRevision.revision, operationId: ids.nextCapture,
        services: selectedServices, expectedInventorySha256: inventory.sha256, baseRevision: state.firstRevision.revision });
      need(capture.comparison.methods.added.includes('/commons.reflection.v1.Audit/Check') &&
        capture.comparison.files.changed.includes('ledger.proto'), 'The original source comparison omitted a reflected method/file change.');
      state.nextCapture = capture; await checkpoint();
      if (!state.secondRevision) {
        state.secondRevision = await call('reflection_save', { captureId: ids.nextCapture, expectedCaptureSha256: capture.captureSha256,
          baseRevision: state.firstRevision.revision, title: 'Reflected account ledger with reviewed audit method', plan });
        await checkpoint();
      }
      const beforeOpen = reflectionRequests.length;
      const compared = await call('reflection_open', { captureId: ids.nextCapture, baseRevision: state.secondRevision.revision });
      need(compared.comparison.methods.added.length === 0 && compared.captureSha256 === capture.captureSha256 &&
        reflectionRequests.length === beforeOpen, 'Offline re-comparison changed or reacquired the retained descriptor source.');
      await workspace.close(); workspace = null; await openWorkspace();
      need((await call('status')).currentRevision === state.secondRevision.revision &&
        (await call('reflection_open', { captureId: ids.firstCapture })).captureSha256 === state.firstCapture.captureSha256,
        'Reopening the original workspace lost source capture or current merchant identity.');
      return { firstRevision: state.firstRevision.revision, secondRevision: state.secondRevision.revision,
        sourceSha256: state.secondRevision.protoSha256, operationId: ids.call, responseSha256: result.responseSha256,
        conflict, addedMethod: '/commons.reflection.v1.Audit/Check', nativeApplicationCalls: nativeCalls.length };
    });
    await phase('complete-original-source-and-seven-file-customer-receiving', async () => {
      await call('prepare', { revision: state.secondRevision.revision, operationId: ids.secondPreparation });
      const exported = await call('export', { kind: 'customer', preparation: ids.secondPreparation });
      need(exported.files.length === 7, 'The original customer export did not contain all seven files.');
      const received = await downloadGrpcExport({ url: merchant.url, exportId: exported.exportId, directory: join(out, 'customer'),
        tokenEnv: 'GRPC_REFLECTION_MCP_TOKEN', environment, expectedManifestSha256: exported.manifestFile.sha256 });
      for (const file of exported.files) {
        const bytes = await readFile(join(out, 'customer', file.path));
        need(bytes.length === file.bytes && hash(bytes) === file.sha256, 'The original customer file changed: ' + file.path);
      }
      const sdk = await import(pathToFileURL(join(received.customerDirectory, 'seller-client.mjs')).href);
      const revision = await call('export', { kind: 'revision', revision: state.secondRevision.revision });
      const imported = await call('import', { workspace: 'receiving', exportId: revision.exportId, baseRevision: null });
      const source = await call('revision', { workspace: 'receiving', revision: imported.revision, section: 'source' });
      need(imported.revision === state.secondRevision.revision && imported.protoSha256 === state.nextCapture.protoSource.sha256,
        'Receiving changed the original descriptor-backed revision identity.');
      state.customerExport = { exportId: exported.exportId, manifestSha256: exported.manifestFile.sha256,
        files: exported.files, customerDirectory: received.customerDirectory };
      await checkpoint();
      return { ...state.customerExport, sourceExportId: revision.exportId, receivedRevision: imported.revision,
        sourceSha256: imported.protoSha256, sdkExports: Object.keys(sdk), sourceSection: source.section ?? 'source' };
    });
    await phase('original-merchant-challenge-and-release-rollback', async () => {
      const running = await call('run', { preparation: ids.secondPreparation });
      const before = nativeCalls.length;
      const challenge = await fetch(running.active.url + '/account', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }); await challenge.arrayBuffer();
      need(challenge.status === 402 && nativeCalls.length === before, 'The original unpaid merchant challenge invoked a native application method.');
      await call('stop');
      await call('checkout', { revision: state.firstRevision.revision, baseRevision: state.secondRevision.revision });
      await call('prepare', { revision: state.firstRevision.revision, operationId: ids.firstPreparation });
      await call('checkout', { revision: state.secondRevision.revision, baseRevision: state.firstRevision.revision });
      await call('release_open');
      const a = 'reflection-a-' + report.runId.slice(0, 8), b = 'reflection-b-' + report.runId.slice(0, 8);
      for (const [preparation, releaseId] of [[ids.firstPreparation, a], [ids.secondPreparation, b]]) {
        if (!(await call('release_status')).releases.some(x => x.id === releaseId)) await call('stage', { preparation, releaseId });
      }
      await call('release_diff', { from: a, to: b });
      const mutate = async (name, values = {}) => call(name, { expectedGeneration: (await call('release_status')).state.generation, ...values });
      for (const [name, values] of [['release_activate', { id: a, reason: 'Original selected reflected source' }],
        ['release_activate', { id: b, reason: 'Reviewed reflected audit source revision' }],
        ['release_rollback', { to: a, reason: 'Original retained reflected merchant recovery' }]]) {
        await mutate(name, values); const selected = await mutate('release_run'); await call('release_stop', { instanceId: selected.console.instanceId });
      }
      const result = await call('release_status'); need(result.state.active === a && !result.console.instanceId, 'Original reflected release rollback/drain failed.');
      await call('release_close');
      return { challengeStatus: challenge.status, selectedRelease: a, generation: result.state.generation,
        firstSource: state.firstRevision.protoSha256, secondSource: state.secondRevision.protoSha256 };
    });
    report.state = report.phases.some(x => x.name === 'original-browser-reflection-editing') ? 'COMPLETE' : 'NATIVE_COMPLETE';
  } else {
    need(state.secondRevision && state.nextCapture, 'Complete the retained native source/customer operation before its browser continuation.');
    await phase('original-browser-reflection-editing', async () => {
      const playwright = createRequire(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + '/')('playwright');
      const executablePath = args.get('--chrome-bin'); need(executablePath, 'Supply the maintained original Chromium executable.');
      await access(executablePath);
      const profile = join(out, 'browser-profile'); await mkdir(profile, { recursive: true, mode: 0o700 });
      browser = await playwright.chromium.launchPersistentContext(profile, { executablePath, headless: true,
        viewport: { width: 1440, height: 1000 }, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        env: { ...environment, TMPDIR: profile } });
      const page = await browser.newPage(), errors = [];
      page.on('pageerror', issue => errors.push(issue.message));
      page.on('dialog', dialog => dialog.accept());
      await page.goto(workspace.url, { waitUntil: 'networkidle' });
      await page.locator('[data-view="history"]').click();
      const captured = page.locator('#reflection-history').locator(':scope > *').filter({ hasText: ids.nextCapture.slice(0, 12) });
      await captured.getByRole('button', { name: 'Open capture and compare', exact: true }).click();
      await page.locator('#reflection-preview').waitFor({ state: 'visible' });
      need((await page.locator('#reflection-preview-summary').innerText()).includes(state.nextCapture.captureSha256),
        'The original browser reopened a different immutable capture.');
      await page.locator('#source-file').selectOption('defaults.proto');
      const rawDownload = page.waitForEvent('download'); await page.locator('#source-download').click();
      const raw = await rawDownload; await raw.saveAs(join(out, 'browser-original-defaults.descriptor.pb'));
      const expectedRaw = state.nextCapture.protoSource.files.find(x => x.path === 'defaults.proto');
      need(hash(await readFile(join(out, 'browser-original-defaults.descriptor.pb'))) === expectedRaw.sha256,
        'The browser changed an original binary descriptor download.');
      const sourceDownload = page.waitForEvent('download'); await page.locator('#reflection-source-download').click();
      const sourceFile = await sourceDownload; await sourceFile.saveAs(join(out, 'browser-descriptor-source.json'));
      need(JSON.parse(await readFile(join(out, 'browser-descriptor-source.json'), 'utf8')).sha256 === state.nextCapture.protoSource.sha256,
        'The browser descriptor-source receiving lost its original identity.');
      await page.locator('#title').fill('Reflected account ledger operator review');
      await page.locator('#reflection-save').click();
      await page.waitForFunction(() => document.getElementById('notice').textContent.startsWith('Reviewed reflected source saved as'));
      const nativeUrl = new URL(workspace.url);
      const nativeState = async () => {
        const response = await fetch(nativeUrl.origin + '/api/state', { headers: { 'x-workspace-token': nativeUrl.hash.slice(1) } });
        need(response.ok, 'The original browser receiving state could not be read.'); return response.json();
      };
      const reopenedSave = await nativeState();
      need(reopenedSave.currentRevision && reopenedSave.currentRevision !== state.secondRevision.revision,
        'The original browser did not save its edited title and reviewed source.');
      await page.locator('#reflection-discover').click();
      await page.waitForFunction(() => document.getElementById('notice').textContent.startsWith('Discovered 3 services'));
      await page.locator('#reflection-filter').fill('Ledger');
      need(await page.locator('#reflection-services input').count() === 1, 'Native service filtering lost the selected package.');
      await page.locator('#reflection-services input').check();
      await page.locator('#reflection-filter').fill('Audit'); await page.locator('#reflection-services input').check();
      await page.locator('#reflection-filter').fill('');
      need(await page.locator('#reflection-services input:checked').count() === 2, 'Native service selection did not survive filtering.');
      await page.locator('#reflection-capture').click();
      await page.waitForFunction(() => document.getElementById('notice').textContent.startsWith('Exact descriptor/import bytes captured'));
      need((await page.locator('#reflection-preview-summary').innerText()).includes('3 exact descriptors'),
        'The browser did not retain the full selected descriptor import closure.');
      await page.screenshot({ path: join(out, 'reflection-desktop.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: join(out, 'reflection-mobile.png'), fullPage: true });
      need(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
        'The reflected source editor overflowed its narrow viewport.');
      await page.locator('#reflection-save').click();
      await page.waitForFunction(() => document.getElementById('notice').textContent.startsWith('Reviewed reflected source saved as'));
      await page.locator('[data-view="methods"]').click();
      await page.locator('#route-list').getByRole('button', { name: 'Edit route', exact: true }).click();
      await page.locator('#description').fill('Original reflected account operation reviewed by the native browser operator.');
      await page.locator('#apply-route').click(); await page.locator('#save').click();
      await page.waitForFunction(() => document.getElementById('revision-label').textContent.includes('current') &&
        !document.getElementById('revision-label').textContent.includes('unsaved'));
      const final = await nativeState();
      need(final.currentRevision !== reopenedSave.currentRevision && nativeCalls.length === 0,
        'The browser did not retain its edited merchant terms or dispatched an unintended application method.');
      need(errors.length === 0, 'The original reflection editor raised a browser error: ' + errors.join('; '));
      state.browserRevision = final.currentRevision; await checkpoint();
      await browser.close(); browser = null;
      return { desktop: 'reflection-desktop.png', mobile: 'reflection-mobile.png', sourceRevision: final.currentRevision,
        sourceSha256: state.nextCapture.protoSource.sha256, reopenedCaptureId: ids.nextCapture,
        descriptorDownloadSha256: expectedRaw.sha256, originalCallsRepeated: nativeCalls.length,
        serviceFilter: 'Ledger/Audit', selectedServices: 2, browserErrors: errors };
    });
    report.state = 'COMPLETE';
  }
  report.nativeApplicationCalls = report.phases.find(x => x.name === 'original-revision-call-and-reflected-source-refresh')?.nativeApplicationCalls ?? 0;
} catch (error) {
  report.state = 'FAILED'; report.failure = { code: error.code ?? null, message: error.message }; process.exitCode = 1;
} finally {
  report.shutdown = [];
  for (const [name, owned] of [['browser', browser], ['merchant-mcp', merchant], ['source-workspace', workspace],
    ['receiving-workspace', receiving], ['native-reflection-endpoint', endpoint]]) {
    try { await owned?.close(); report.shutdown.push({ name, closed: true }); }
    catch (error) { report.shutdown.push({ name, closed: false, code: error.code ?? null, message: error.message }); process.exitCode = 1; report.state = 'FAILED'; }
  }
  for (const name of Object.keys(ownedEnvironment)) delete process.env[name];
  report.finishedAt = new Date().toISOString(); await checkpoint();
  process.stdout.write(JSON.stringify({ state: report.state, directory: out, phases: report.phases.length,
    nativeApplicationCalls: report.nativeApplicationCalls ?? nativeCalls.length, failure: report.failure ?? null,
    closed: report.shutdown.every(x => x.closed) }) + '\n');
}
