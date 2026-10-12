// MIT. Source-bound continuation evidence for an original authorization never dispatched.
// This reader does not approve, reserve, sign, settle, or contact a provider.
import { constants } from 'node:fs';
import { open, lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { need, digest, exists, privateDirectory } from './store.mjs';
import { readContinuationOperation } from './unpaid-continuation.mjs';

const SCHEMA = 'stellar-forge.sf88.undispatched-authorization-evidence.v1';
const HASH = /^[a-f0-9]{64}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = isDeepStrictEqual;
const copy = value => JSON.parse(JSON.stringify(value));
const canonicalValue = value => value === null || typeof value !== 'object' ? value :
  Array.isArray(value) ? value.map(canonicalValue) :
    Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]));
const canonical = value => JSON.stringify(canonicalValue(value));
function checkSignal(signal) {
  need(signal === undefined || signal instanceof AbortSignal, 'INVALID_ABORT_SIGNAL');
  need(!signal?.aborted, 'OPERATION_ABORTED_BEFORE_START');
}

// These are the reviewed authorization implementation, not arbitrary signer modules.
// A new native/SDK implementation needs source review before this reader accepts it.
const PINS = Object.freeze({
  execute:'17e8eb247e149c8c757cd8e1be40a58c88a807c066556e69b158f025b1aea1c3',
  wire:'cbc5e523278dd157c496ecbb53fe41bad45fbbb7694424920175237baf0b3840',
  store:'59528e387d4c572cd4793aa5b212114b30c51e5a87b9c4b99c096cba25bb64d0',
  config:'a489f33ac32f56df37da3cf1b6a6ddbfa41363fc11ec8b6cd824db46582ada3d',
  workspace:'7eb1079646a2fc2d04d3d1ac1dbc028f42aa757801086bcdda216942bce4ed16',
  nativeSigner:'5ed4245258d118191cf3e02d0f6c1ba8eafbc6dc952a4eb6e66cf1d892b91900',
  sf103Signer:'c5b786d8bb4ab34b26a3c48e6136fdf0fca8417be18dbc55427024b083b46279',
  sf54:'873b576c1738dfcba7fe32cb1afcc514d827f95c950a7b1e6e511d474460a836',
  governor:'5f7c06dbed61aa89caaea56464883a00aabe978983870ba490226900ffb42f96',
  coreManifest:'ea1e2b245fc438b45b4905f9a3dd7ec80efc17b750d5b94e634f927678722517',
  coreClient:'34a2c47aaf2cac790d9b7f4eb1f385d2ec2063bb42ab5de227119b945dc20d48',
  stellarManifest:'d28ae35183305c5fc56f7fb756a5013a9d8a8c22bf7cefce69fd18e54d0a15dc',
  stellarClientEntry:'91aec07b4c6f93f31a4400876bd155123b9e075ebe9bb98629b6867635f4e996',
  stellarScheme:'8ab5d52236bca84114dd38dc6f48b61e8f5a70ecbfed17144b4176db6e95af7b',
  stellarFactory:'b0113058449ec5eff6b58bd136c532c4a5daee17beb32998269db17a7b527ed7',
  sdkManifest:'d68e12f22bd0b293f35c4f64e9956e8b1ef15f88dbfa71629073e2e5b72dcc8a',
  sdkEntry:'c451aa190e352f599fa78ecae0f7eb3ca05ccf18c91efa209a40057e69321b5a',
  sdkContractEntry:'eb184c0108b2b62bc1eb2176558b4cbaa69f519495597a1704fe3a4c56029334',
  basicSigner:'a524b9ef247d6adf753784b15821dc10ceb11aed06fc9449a46509ee6095da62',
  keypairSigner:'2ad71e7afab9fc3635951b0cb746be11ce1b6e5758c3a62ecdc9ccf9a636b25f',
  assembled:'0d6f8a4cb11dc2fc875120af693433b2a0dcd9ab3158f63618026a3fb4e8ff87',
});


const PROTECTED_SOURCE_PROFILE = Object.freeze({
  id:'ORIGINAL_AUTHORIZATION_WITH_HELD_FILE_RESERVATIONS_V1',
  execute:'366544e23c3e1c1bd70b993dce3a5a16d133d8357e63ccec8dd2dfac0c97c4b2', wire:'8ab92a2b590c973b6b44f259e6cdeddf16a1cd4840f9dc1adbb436cf59c85f11', store:'5232d58fd2ac4e3666bdd13cb73322bd53785d9e0994b1511200b1dd15d89531',
  runtime:'180e520ac21b7112c89f8dceed85226f29a3a1d6047c63f74835658921e432e5', bootstrap:'aabc20e221b269957ff9e32115500980d27e32e3292ad9e338c7a1fff9eddac4',
  provider:'56362274bad8b536f8928234da773fe7aef4c15773911dfe087e4970a400c06c', runtimeSource:'fc5aedb68fa3ef4e32436298e3aed5a281e48084461469c69fe80f02ec8517ac',
  responseFile:'1aa6e71f1b308a4ea71b61ee597323c41da379408e75633bcc62246f3818c295',
});

async function protectedEntrySource({runtime, directory, operation, bound, reader, signerSources, signal}) {
  const paths = [
    ['reservationRuntime',join(runtime,'node/runtime.mjs'),'runtime'],
    ['reservationBootstrap',join(runtime,'node/reserved-entry.mjs'),'bootstrap'],
    ['reservationProvider',join(runtime,'node/file-reservation.mjs'),'provider'],
    ['reservationRuntimeSource',join(runtime,'node/runtime-source.mjs'),'runtimeSource'],
    ['reservationResponseFile',resolve(runtime,'../sf31-buyer-client/response-file.mjs'),'responseFile'],
  ];
  for (const [name,path,key] of paths) {
    const source = await reader.read(path,{pin:PROTECTED_SOURCE_PROFILE[key]});
    signerSources[name] = source.descriptor;
  }
  const path = join(directory,'native-reserved-request.json');
  if (!await exists(path)) return null;
  const source = await reader.read(path,{limit:2097152,privateFile:true,json:true});
  const request = source.value, workspace = bound.meta.nativeWorkspace;
  const selectedEntry = await realpath(join(runtime,workspace === undefined ? 'cli.mjs' : 'python/bridge.mjs'));
  const args = workspace === undefined ? ['--execute','--config',operation.configPath] :
    ['execute-workspace','--dir',workspace,'--config',operation.configPath,
      '--ticket-sha',bound.meta.ticketSha256 ?? 'none'];
  need(request.schema === 'stellar-forge.sf88.reserved-entry.v1' &&
    Object.keys(request).every(key => ['schema','entryFile','entrySha256','args',
      'nativeFileReservation','nativeRuntimeSource'].includes(key)) &&
    request.entryFile === selectedEntry && HASH.test(request.entrySha256 ?? '') &&
    same(request.args,args), 'UNDISPATCHED_RESERVED_ENTRY_BINDING_CHANGED');
  const entry = await reader.read(selectedEntry,{limit:16777216,pin:request.entrySha256});
  const {normalizeNativeFileReservation} = await import(pathToFileURL(join(runtime,'node/file-reservation.mjs')).href);
  const descriptor = normalizeNativeFileReservation(request.nativeFileReservation);
  need(object(descriptor) && same(descriptor,request.nativeFileReservation),
    'UNDISPATCHED_RESERVED_ENTRY_DESCRIPTOR_CHANGED');
  // The descriptor selects a program, so bind the actual reviewed allocator
  // executable as well as its JavaScript adapter before using this predicate.
  need(await realpath(descriptor.executable) === descriptor.executable &&
    descriptor.executableSha256 === 'ccd7a867766e25f931d6e5cf07a8fd0fb0c9d4baa03c4af4be44f3b41756757a',
    'UNDISPATCHED_REVIEWED_ALLOCATOR_CHANGED');
  const executable = await reader.read(descriptor.executable,{limit:16777216,pin:descriptor.executableSha256});
  signerSources.reservationExecutable = executable.descriptor;
  let runtimeSource = null;
  if (request.nativeRuntimeSource !== undefined) {
    const {verifySuccessorRuntimeSource} = await import(pathToFileURL(join(runtime,'node/runtime-source.mjs')).href);
    runtimeSource = await verifySuccessorRuntimeSource(request.nativeRuntimeSource,{signal});
    need(runtimeSource.directory === runtime &&
      (operation.buyer.runtime.nativeRuntimeSource === undefined ||
        same(runtimeSource,operation.buyer.runtime.nativeRuntimeSource)),
      'UNDISPATCHED_RESERVED_RUNTIME_BINDING_CHANGED');
  }
  signerSources.reservationRequest = source.descriptor;
  signerSources.reservationEntry = entry.descriptor;
  return {requestSha256:source.descriptor.sha256,entrySha256:entry.descriptor.sha256,
    nativeFileReservation:copy(descriptor),runtimeSource};
}

function sourceReader(signal) {
  const observed = new Map();
  let bytesRead = 0;
  async function read(path, {limit = 262144, privateFile = false, pin, json = false} = {}) {
    checkSignal(signal);
    need(typeof path === 'string' && isAbsolute(path) && path === resolve(path),
      'UNDISPATCHED_SOURCE_PATH_INVALID');
    need(observed.has(path) || observed.size < 64, 'UNDISPATCHED_SOURCE_COUNT_LIMIT');
    if (privateFile) {
      await privateDirectory(dirname(path), {create:false});
      need(await realpath(dirname(path)) === dirname(path), 'UNDISPATCHED_PRIVATE_PATH_CHANGED');
    }
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let raw;
    try {
      const before = await handle.stat();
      need(before.isFile() && before.size >= 0 && before.size <= limit &&
        !(before.mode & (privateFile ? 0o077 : 0o022)) &&
        (!privateFile || !process.getuid || before.uid === process.getuid()),
        'UNDISPATCHED_SOURCE_FILE_INVALID');
      bytesRead += before.size;
      need(bytesRead <= 8 * 1024 * 1024, 'UNDISPATCHED_SOURCE_BYTES_LIMIT');
      raw = await handle.readFile({signal});
      const after = await handle.stat(), named = await lstat(path);
      need(raw.length === before.size && before.dev === after.dev && before.ino === after.ino &&
        before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs &&
        !named.isSymbolicLink() && named.dev === after.dev && named.ino === after.ino &&
        named.size === after.size && named.mtimeMs === after.mtimeMs && named.ctimeMs === after.ctimeMs,
        'UNDISPATCHED_SOURCE_CHANGED_DURING_READ');
    } finally { await handle.close(); }
    const sha256 = digest(raw);
    need(pin === undefined || sha256 === pin, 'UNDISPATCHED_REVIEWED_SOURCE_CHANGED');
    const descriptor = {path, bytes:raw.length, sha256};
    const previous = observed.get(path);
    need(!previous || previous.descriptor.sha256 === sha256, 'UNDISPATCHED_SOURCE_CHANGED');
    observed.set(path, {descriptor, limit, privateFile});
    let value;
    if (json) {
      value = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(raw));
      need(object(value), 'UNDISPATCHED_SOURCE_JSON_INVALID');
    }
    return {raw, value, descriptor};
  }
  async function unchanged() {
    for (const {descriptor, limit, privateFile} of [...observed.values()])
      await read(descriptor.path, {limit, privateFile, pin:descriptor.sha256});
  }
  return {read, unchanged};
}

async function packageSource(require, name, specifier, reader, expectedHash) {
  let directory = dirname(require.resolve(specifier));
  for (let count = 0; count < 12; count++) {
    const path = join(directory, 'package.json');
    if (await exists(path)) {
      const loaded = await reader.read(path, {json:true, limit:65536});
      if (loaded.value.name === name) {
        need(loaded.descriptor.sha256 === expectedHash, 'UNDISPATCHED_SDK_MANIFEST_CHANGED');
        return {root:directory, ...loaded};
      }
    }
    const parent = dirname(directory);
    need(parent !== directory, 'UNDISPATCHED_SDK_PACKAGE_UNAVAILABLE');
    directory = parent;
  }
  need(false, 'UNDISPATCHED_SDK_PACKAGE_UNAVAILABLE');
}

function generatedSigner(nativePath, pins) {
  return '// Private operator adapter. No wallet key is stored in this file.\n' +
    'import {createEnvironmentStellarSigner, validateNativeSignerInput} from ' +
      JSON.stringify(pathToFileURL(nativePath).href) + ';\n' +
    'const pins = Object.freeze(' + JSON.stringify(pins) + ');\nlet adapter;\n' +
    'export async function sign(payload) {\n' +
    '  validateNativeSignerInput(payload, pins);\n' +
    '  adapter ??= createEnvironmentStellarSigner({...pins, environment:process.env});\n' +
    '  return (await adapter).sign(payload);\n}\n';
}

// Reuse the actual SF54/SF36 serializer. This isolated child loads only those
// read-only functions; it receives no wallet/operator key environment or journal.
const MAP_REQUEST = [
  'import sys,json,hashlib',
  'sys.path.insert(0,sys.argv[1])',
  'from intent_adapter import buyer_intent_to_governor_request',
  'from governor import canonical',
  'raw=sys.stdin.buffer.read(65537)',
  'if len(raw)>65536: raise ValueError("INPUT_TOO_LARGE")',
  'value=json.loads(raw.decode("utf-8"),parse_constant=lambda x:(_ for _ in ()).throw(ValueError("NONFINITE_JSON")))',
  'request=buyer_intent_to_governor_request(value,actor=sys.argv[2],service=sys.argv[3])',
  'sys.stdout.write(json.dumps({"request":request,"sha256":hashlib.sha256(canonical(request)).hexdigest()},sort_keys=True,separators=(",",":"))+"\\n")',
].join('\n');

async function originalRequest(intent, owner, adapterPath, signal) {
  checkSignal(signal);
  const input = Buffer.from(JSON.stringify(intent));
  need(input.length <= 65536 && typeof owner.python === 'string' &&
    typeof owner.actor === 'string' && typeof owner.service === 'string',
    'UNDISPATCHED_ORIGINAL_MAPPER_INPUT_INVALID');
  const result = await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(owner.python, ['-I', '-B', '-c', MAP_REQUEST, dirname(adapterPath),
      owner.actor, owner.service], {
      stdio:['pipe','pipe','pipe'],
      env:{PATH:process.env.PATH ?? '', LC_ALL:'C.UTF-8'},
      signal,
    });
    const output = [], errors = [];
    let outputBytes = 0, errorBytes = 0, exceeded = false, timedOut = false;
    const timer = setTimeout(() => {timedOut = true; child.kill('SIGKILL');}, 15000);
    child.stdout.on('data', raw => {
      outputBytes += raw.length;
      if (outputBytes > 131072) {exceeded = true; child.kill('SIGKILL');}
      else output.push(raw);
    });
    child.stderr.on('data', raw => {
      errorBytes += raw.length;
      if (errorBytes > 8192) {exceeded = true; child.kill('SIGKILL');}
      else errors.push(raw);
    });
    child.on('error', error => {clearTimeout(timer); rejectPromise(error);});
    child.on('close', (code, exitSignal) => {
      clearTimeout(timer);
      resolvePromise({code, exitSignal, exceeded, timedOut, raw:Buffer.concat(output)});
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
  checkSignal(signal);
  need(result.code === 0 && result.exitSignal === null && !result.exceeded && !result.timedOut,
    'UNDISPATCHED_ORIGINAL_REQUEST_MAPPING_FAILED');
  const mapped = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(result.raw));
  need(object(mapped.request) && HASH.test(mapped.sha256 ?? ''), 'UNDISPATCHED_ORIGINAL_REQUEST_MAPPING_INVALID');
  return mapped;
}


// The first unsigned 402 can be retained before disk failure prevents the
// signing-input checkpoint. Reuse the original SF31 parser/selector/intent
// constructor with a capability that can return only this already saved 402.
// Its approval callback always returns false; no operator, signer, or network
// capability is supplied. The caller separately audits the original reservation.
async function originalUnsignedInput({runtime, op, cfg, body, wire, reader, signerSources, signal}) {
  const path = resolve(runtime,'../sf31-buyer-client/buyer.mjs');
  const source = await reader.read(path);
  const gitSha = createHash('sha1').update('blob '+source.raw.length+'\0').update(source.raw).digest('hex');
  need(gitSha === '04de96e3445a4928d213b036bbb6c2b1c5e92077', 'UNDISPATCHED_ORIGINAL_SF31_SOURCE_CHANGED');
  signerSources.sf31 = {...source.descriptor, gitBlobSha:gitSha};
  const {X402BuyerClient} = await import(pathToFileURL(path).href);
  const retained = wire.events['unsigned-response'], request = wire.events['unsigned-request'];
  need(retained?.status === 402 && request && !wire.events['signing-input'] &&
    !wire.events['signing-result'] && !wire.events['signing-error'] && !wire.events['signed-request'],
    'UNDISPATCHED_UNSIGNED_GATE_REQUIRED');
  let requests = 0, captured = null;
  const original = new X402BuyerClient({fetchImpl:async (url, options) => {
    checkSignal(signal);
    need(++requests === 1 && new URL(url).href === request.url &&
      options.method === request.method &&
      same([...new Headers(options.headers).entries()], request.headers),
      'UNDISPATCHED_RETAINED_UNSIGNED_REQUEST_CHANGED');
    const actualBody = options.body === undefined ? undefined : Buffer.from(options.body);
    need((actualBody !== undefined) === (body !== undefined) &&
      (body === undefined || actualBody.equals(Buffer.from(body))),
      'UNDISPATCHED_RETAINED_UNSIGNED_BODY_CHANGED');
    return new Response(null,{status:402,statusText:retained.statusText,headers:retained.headers});
  }});
  try {
    await original.call({...op,body,headers:cfg.operation.headers ?? {},signal,
      approve:async intent => {captured=copy(intent);return false;},
      sign:async () => {need(false,'UNDISPATCHED_READER_CANNOT_SIGN');}});
    need(false,'UNDISPATCHED_ORIGINAL_INTENT_CAPTURE_FAILED');
  } catch(error) {
    need(error.code === 'PAYMENT_NOT_APPROVED' && requests === 1 && object(captured),
      'UNDISPATCHED_ORIGINAL_INTENT_CAPTURE_FAILED');
  }
  const encoded = new Headers(retained.headers).get('payment-required');
  // The original SF31 call has already validated canonical base64, its bounded
  // JSON challenge, the exact resource and unique accepted requirements.
  const challenge = JSON.parse(Buffer.from(encoded,'base64').toString('utf8'));
  return {intent:captured,challenge,accepted:copy(captured.acceptedTerms)};
}

/**
 * Safe, deterministic evidence for the original generated environment signer.
 * It deliberately avoids operation._bound(): the successor's own lineage check
 * calls this reader through the original raw, nonrecursive operation binding.
 * The full private wire reader owns the existing lock and checks every event.
 * Only its safe hash snapshot is returned; private authorization bytes stay local.
 */
export async function readUndispatchedAuthorizationEvidence(operation, options = {}) {
  const {workspace, expectedRequestSha256, expectedAttemptId, expectedConfigSha256, signal} = options;
  checkSignal(signal);
  need(object(options.approvedRequest) && typeof workspace === 'string' &&
    isAbsolute(workspace) && workspace === resolve(workspace) &&
    [expectedRequestSha256, expectedAttemptId, expectedConfigSha256].every(value => HASH.test(value ?? '')),
    'UNDISPATCHED_AUTHORIZATION_BINDING_REQUIRED');
  // Snapshot the caller's selected request before the first await.
  const approvedRequest = copy(options.approvedRequest);
  const selected = {workspace, expectedRequestSha256, expectedAttemptId, expectedConfigSha256};
  const reader = sourceReader(signal), signerSources = {};
  async function pin(name, path) {
    const loaded = await reader.read(path, {pin:PINS[name]});
    signerSources[name] = loaded.descriptor;
    return loaded;
  }

  const bound = await readContinuationOperation(operation);
  const runtime = operation.buyer.runtime.directory, directory = operation.directory;
  const stateDirectory = operation.buyer.stateDirectory;
  need(isAbsolute(runtime) && runtime === resolve(runtime) &&
    directory === join(stateDirectory, digest(operation.intentId)) &&
    operation.configPath === join(directory, 'config.json') &&
    bound.meta.runtimeDirectory === runtime && bound.configSha256 === selected.expectedConfigSha256,
    'UNDISPATCHED_ORIGINAL_OPERATION_CHANGED');
  await privateDirectory(stateDirectory, {create:false});
  await privateDirectory(directory, {create:false});
  const attemptFile = await reader.read(join(directory, 'attempt.json'), {limit:16384, privateFile:true, json:true});
  const attempt = attemptFile.value;
  need(attemptFile.descriptor.sha256 === selected.expectedAttemptId &&
    attempt.schema === bound.meta.schema && attempt.intentId === operation.intentId &&
    attempt.configSha256 === bound.configSha256 && attempt.bodySha256 === bound.bodySha256 &&
    attempt.kind === undefined &&
    ['STARTING','STARTED','RECORDED','INTERRUPTED_OR_START_FAILED','NATIVE_RESULT_UNAVAILABLE'].includes(attempt.state),
    'UNDISPATCHED_ORIGINAL_ATTEMPT_CHANGED');
  const startedAt = attempt.startedAt ?? attempt.createdAt;
  need(typeof startedAt === 'string' && Number.isFinite(Date.parse(startedAt)),
    'UNDISPATCHED_ORIGINAL_ATTEMPT_TIME_REQUIRED');
  need(bound.config.evidenceDir === join(directory, 'evidence'), 'UNDISPATCHED_ORIGINAL_EVIDENCE_CHANGED');
  await privateDirectory(bound.config.evidenceDir, {create:false});
  const bodyPresent = bound.config.operation.bodyFile !== undefined;
  const wireBody = bodyPresent ? bound.body : undefined;

  // Accept complete reviewed implementations, never a mix of independently
  // allowed execute/wire/store versions. Historical descriptors and output keep
  // their exact previous shape; the additional profile is explicit below.
  const nativeSources = {};
  for (const [name,path] of [
    ['execute',join(runtime,'execute.mjs')],['wire',join(runtime,'attempt-wire.mjs')],
    ['store',join(runtime,'node/store.mjs')],
  ]) {
    const source = await reader.read(path);
    nativeSources[name] = source.descriptor.sha256;
    signerSources[name] = source.descriptor;
  }
  const historical = ['execute','wire','store'].every(name => nativeSources[name] === PINS[name]);
  const protectedSource = ['execute','wire','store'].every(name =>
    nativeSources[name] === PROTECTED_SOURCE_PROFILE[name]);
  need(historical || protectedSource,'UNDISPATCHED_REVIEWED_SOURCE_CHANGED');
  await pin('config',join(runtime,'config.mjs'));
  await pin('workspace',join(runtime,'workspace.mjs'));
  const reservedEntry = protectedSource ? await protectedEntrySource({
    runtime,directory,operation,bound,reader,signerSources,signal,
  }) : null;
  const [{openWorkspace}, {execution}, {readAttemptWireCheckpoint}] = await Promise.all([
    import(pathToFileURL(join(runtime,'workspace.mjs')).href),
    import(pathToFileURL(join(runtime,'config.mjs')).href),
    import(pathToFileURL(join(runtime,'attempt-wire.mjs')).href),
  ]);
  await privateDirectory(selected.workspace, {create:false});
  const manifestFile = await reader.read(join(selected.workspace,'workspace.json'), {limit:65536, privateFile:true, json:true});
  const configFile = await reader.read(join(selected.workspace,'operator.json'), {limit:65536, privateFile:true, json:true});
  const active = await openWorkspace(['--dir',selected.workspace]);
  need(same(manifestFile.value, active.manifest) && same(configFile.value, active.config),
    'UNDISPATCHED_WORKSPACE_CHANGED');
  const {op, owner, transport} = execution(bound.config), current = execution(active.config);
  need(['python','actor','service','ledger','policy'].every(key => owner[key] === current.owner[key]) &&
    bound.config.signerModule === active.config.signerModule &&
    bound.config.trustedPayer === active.config.trustedPayer &&
    same(transport,current.transport) &&
    ['scheme','network','asset','payTo'].every(key => op.expect[key] === current.op.expect[key]) &&
    (bound.meta.nativeWorkspace === undefined || bound.meta.nativeWorkspace === active.manifest.directory),
    'UNDISPATCHED_ORIGINAL_WORKSPACE_MISMATCH');
  signerSources.workspaceManifest = manifestFile.descriptor;
  signerSources.workspaceConfiguration = configFile.descriptor;
  const manifest = active.manifest, pins = manifest.signer;
  need(object(pins) && pins.signerProvider === undefined &&
    typeof pins.secretEnv === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(pins.secretEnv) &&
    Object.keys(pins).sort().join(',') ===
      ['network','asset','payTo','maxAtomic','expectedPayer','secretEnv','rpcUrl','paymentFlow'].sort().join(',') &&
    pins.paymentFlow === 'authorization' && (op.expect.paymentFlow ?? 'authorization') === 'authorization' &&
    typeof manifest.sourceCli === 'string' && isAbsolute(manifest.sourceCli) &&
    manifest.sourceCli === resolve(manifest.sourceCli),
    'UNDISPATCHED_REVIEWED_ENVIRONMENT_AUTHORIZATION_REQUIRED');
  const nativePath = join(dirname(manifest.sourceCli),'native-signer.mjs');
  const generated = await reader.read(bound.config.signerModule, {limit:65536, privateFile:true});
  need(generated.raw.toString('utf8') === generatedSigner(nativePath,pins),
    'UNDISPATCHED_GENERATED_SIGNER_CHANGED');
  signerSources.generatedSigner = generated.descriptor;
  await pin('nativeSigner',nativePath);
  await pin('sf103Signer',resolve(dirname(nativePath),'../sf103-native-buyer-signer/adapter.mjs'));
  const adapterPath = resolve(runtime,'../sf54-buyer-governor-intent/intent_adapter.py');
  await pin('sf54',adapterPath);
  await pin('governor',resolve(runtime,'../sf36-spend-governor/governor.py'));

  // Resolve packages from the exact native signer module, matching its imports.
  const require = createRequire(pathToFileURL(nativePath));
  const core = await packageSource(require,'@x402/core','@x402/core/client',reader,PINS.coreManifest);
  const stellar = await packageSource(require,'@x402/stellar','@x402/stellar/exact/client',reader,PINS.stellarManifest);
  need(core.value.version === '2.28.0' && stellar.value.version === '2.28.0',
    'UNDISPATCHED_REVIEWED_SDK_VERSION_REQUIRED');
  signerSources.coreManifest = core.descriptor;
  signerSources.stellarManifest = stellar.descriptor;
  await pin('coreClient',join(core.root,'dist/esm/client/index.mjs'));
  await pin('stellarClientEntry',join(stellar.root,'dist/esm/exact/client/index.mjs'));
  await pin('stellarScheme',join(stellar.root,'dist/esm/chunk-EGJCLWK3.mjs'));
  await pin('stellarFactory',join(stellar.root,'dist/esm/index.mjs'));
  const stellarRequire = createRequire(pathToFileURL(join(stellar.root,'dist/esm/index.mjs')));
  const sdk = await packageSource(stellarRequire,'@stellar/stellar-sdk','@stellar/stellar-sdk',reader,PINS.sdkManifest);
  need(sdk.value.version === '16.3.1', 'UNDISPATCHED_REVIEWED_STELLAR_SDK_REQUIRED');
  signerSources.sdkManifest = sdk.descriptor;
  for (const [name, path] of [
    ['sdkEntry','lib/esm/index.js'], ['sdkContractEntry','lib/esm/contract/index.js'],
    ['basicSigner','lib/esm/contract/basic_node_signer.js'], ['keypairSigner','lib/esm/contract/signer.js'],
    ['assembled','lib/esm/contract/assembled_transaction.js'],
  ]) await pin(name,join(sdk.root,path));

  const wire = await readAttemptWireCheckpoint({cfg:bound.config,body:wireBody,includeWire:true});
  const snapshot = wire?.snapshot;
  need(snapshot?.writerActive === false && snapshot.intentId === operation.intentId &&
    typeof snapshot.signingEntered === 'boolean' && snapshot.signedDispatchRecorded === false &&
    snapshot.signedResponseRecorded === false && object(wire.events) &&
    !wire.events['signed-dispatch'] && !wire.events['signed-response'] && !wire.events['signed-error'] &&
    wire.events['unsigned-response']?.status === 402 &&
    (snapshot.signingEntered ? object(wire.events['signing-input']?.input) :
      !wire.events['signing-input'] && !wire.events['signing-result'] && !wire.events['signing-error'] &&
      !wire.events['signed-request'] && snapshot.state === 'UNSIGNED_RESPONSE_HEADERS_RETAINED'),
    'UNDISPATCHED_ORIGINAL_WIRE_REQUIRED');
  const input = snapshot.signingEntered ? copy(wire.events['signing-input'].input) :
    await originalUnsignedInput({runtime,op,cfg:bound.config,body:wireBody,wire,reader,signerSources,signal});
  const {validateNativeSignerInput} = await import(pathToFileURL(nativePath).href);
  const checked = validateNativeSignerInput(input,pins);
  need(checked.policy.paymentFlow === 'authorization' &&
    checked.intent.intentId === operation.intentId &&
    checked.intent.url === op.url && checked.intent.method === op.method &&
    checked.intent.bodyPresent === bodyPresent && checked.intent.bodyBytes === bound.body.length &&
    checked.intent.bodySha256 === bound.bodySha256 && checked.intent.maxAtomic === op.expect.maxAtomic,
    'UNDISPATCHED_ORIGINAL_SIGNING_INPUT_CHANGED');
  const mapped = await originalRequest(checked.intent,owner,adapterPath,signal);
  need(mapped.sha256 === selected.expectedRequestSha256 && same(mapped.request,approvedRequest),
    'UNDISPATCHED_ORIGINAL_APPROVED_REQUEST_CHANGED');

  for (const name of ['signed-dispatch','signed-response','signed-error'])
    need(!await exists(join(snapshot.directory,name+'.json')), 'UNDISPATCHED_AUTHORIZATION_WAS_DISPATCHED');
  const reopened = await readAttemptWireCheckpoint({cfg:bound.config,body:wireBody});
  need(same(reopened,snapshot), 'UNDISPATCHED_ORIGINAL_WIRE_CHANGED');
  const finalBound = await readContinuationOperation(operation);
  need(finalBound.operationSha256 === bound.operationSha256 &&
    finalBound.configSha256 === bound.configSha256 && finalBound.bodySha256 === bound.bodySha256 &&
    finalBound.ticketSha256 === bound.ticketSha256 &&
    operation.directory === directory && operation.buyer.runtime.directory === runtime &&
    operation.buyer.stateDirectory === stateDirectory, 'UNDISPATCHED_ORIGINAL_OPERATION_CHANGED');
  await reader.unchanged();
  checkSignal(signal);
  const result = {
    schema:SCHEMA, kind:'ORIGINAL_AUTHORIZATION_NOT_DISPATCHED',
    binding:{
      intentId:operation.intentId, workspace:selected.workspace, stateDirectory,
      operationDirectory:directory, runtimeDirectory:runtime,
      requestSha256:mapped.sha256, attemptId:attemptFile.descriptor.sha256,
      attemptState:attempt.state, attemptStartedAt:startedAt,
      operationSha256:bound.operationSha256, configSha256:bound.configSha256,
      bodyPresent, bodyBytes:bound.body.length, bodySha256:bound.bodySha256,
      ticketSha256:bound.ticketSha256, actor:owner.actor, service:owner.service,
      network:checked.intent.network, asset:checked.intent.asset, payer:pins.expectedPayer,
      payTo:checked.intent.payTo, amount:checked.intent.amount, paymentFlow:'authorization',
      signingInputSha256:snapshot.records['signing-input']?.sha256 ?? null,
    },
    wire:copy(snapshot), signerSources,
    scope:{
      basis:'RETAINED_ORIGINAL_WIRE_AND_REVIEWED_AUTHORIZATION_SOURCE',
      ...(protectedSource ? {
        reviewedNativeSourceProfile:PROTECTED_SOURCE_PROFILE.id,
        allocationEntry:reservedEntry ?? {kind:'REVIEWED_DIRECT_NATIVE_ENTRY'},
      } : {}),
      signer:'ORIGINAL_GENERATED_ENVIRONMENT_ED25519',
      x402SdkVersion:'2.28.0', stellarSdkVersion:'16.3.1',
      signedAuthorizationMayExist:snapshot.signingEntered,
      authorizationTransferredByOriginalSignedHttp:false,
      signedDispatchGate:'ORIGINAL_WIRE_CHECKPOINT_PUBLISHED_BEFORE_TRANSPORT',
      signerRemoteOperations:'LEDGER_AND_ACCOUNT_READS_AND_SIMULATION; NO_SUBMIT_OR_AUTOMATIC_RESTORE_OPTION',
      reservation:'PRESERVED; ORIGINAL_SF36_AUDIT_AND_APPROVAL_BELONG_TO_THE_CALLER',
      rawAuthorization:snapshot.signingEntered ?
        'RETAINED_ONLY_IN_THE_ORIGINAL_PRIVATE_WIRE; OMITTED_FROM_THIS_SNAPSHOT' :
        'ORIGINAL_SIGNER_NOT_ENTERED_BEFORE_THE_RETAINED_UNSIGNED_GATE',
      ...(snapshot.signingEntered ? {} : {approvalIntentSource:'ORIGINAL_SF31_FROM_RETAINED_UNSIGNED_402; ORIGINAL_SF54_CANONICAL_REQUEST'}),
    },
  };
  return {...result,sha256:digest(canonical(result))};
}


