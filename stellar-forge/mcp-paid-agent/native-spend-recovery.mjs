#!/usr/bin/env node
/** MIT. Native MCP spending-owner recovery through original SF36/SF88/SF101. */
import {spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {constants, createWriteStream} from 'node:fs';
import {access, lstat, mkdir, mkdtemp, open, readdir, realpath, rename, rm, link, unlink} from 'node:fs/promises';
import {dirname, isAbsolute, join, resolve, sep} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {Transform, Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {isDeepStrictEqual as same} from 'node:util';
import {readMcpSpendingHost} from './native-spend-workspace.mjs';

const SCHEMA = 'stellar-forge.mcp-spending-recovery.v1';
const ROOT = new URL('../../stellar/scf-starforge-20261009/', import.meta.url);
const LEDGER = fileURLToPath(new URL('sf88-operator-buyer-cli/workspace-recovery-ledger.py', ROOT));
const CRYPTO = fileURLToPath(new URL('sf101-merchant-recovery/recover.mjs', ROOT));
const LOCK = fileURLToPath(new URL('./native-spend-recovery-lock.py', import.meta.url));
const KEYS = ['SF36_CONSENT_KEY_B64','SF36_AUDIT_KEY_B64','SF36_OPERATOR_KEY_B64'];
const HASH = /^[a-f0-9]{64}$/;
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const STATE_FILE = new RegExp('^(configuration\\.json|ledger-initialized\\.json|' + UUID +
  '(\\.finality)?\\.json|\\.mcp-spending-[A-Za-z0-9_-]+)$');
const MAX_BYTES = 4 * 1024 ** 3 - 32 * 1024 ** 2;
const MAX_FILE = 2 * 1024 ** 3;
const json = value => JSON.stringify(value, null, 2) + '\n';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (root, path) => root === path || path.startsWith(root + sep);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function fail(code) { throw Object.assign(new Error(code), {code}); }
function need(ok, code) { if (!ok) fail(code); }
function absolute(path) {
  need(typeof path === 'string' && isAbsolute(path) && resolve(path) === path &&
    path !== sep && !path.includes('\0'), 'NATIVE_RECOVERY_CANONICAL_PATH_REQUIRED');
  return path;
}
function context(options, supplied = {}) {
  return {environment: supplied.environment ?? options.environment ?? process.env,
    signal: supplied.signal ?? options.signal,
    onProgress: supplied.onProgress ?? options.onProgress ?? (() => {})};
}
function interrupted(signal) { need(!signal?.aborted, 'NATIVE_RECOVERY_INTERRUPTED'); }
function owner(configFile, cfg) {
  return {configFile, policy:cfg.spending.policy, ledger:cfg.spending.ledger,
    stateDirectory:cfg.spending.stateDirectory, actor:cfg.spending.actor,
    service:cfg.spending.service, payer:cfg.payer, network:cfg.limits.network,
    python:cfg.spending.python, signerSecretEnv:cfg.signerSecretEnv};
}
async function exists(path) {
  try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function privateDirectory(path) {
  absolute(path); const stat = await lstat(path);
  need(stat.isDirectory() && stat.uid === process.getuid() && !(stat.mode & 0o077) &&
    await realpath(path) === path, 'NATIVE_RECOVERY_PRIVATE_DIRECTORY_REQUIRED');
  return stat;
}
async function ensurePrivateDirectory(path) {
  absolute(path);
  if (!await exists(path)) {
    await privateDirectory(dirname(path));
    await mkdir(path, {mode:0o700}).catch(error => { if (error.code !== 'EEXIST') throw error; });
    await syncDirectory(dirname(path));
  }
  return privateDirectory(path);
}
async function regular(path, {max = MAX_FILE, privateMode = true} = {}) {
  absolute(path);
  need(await realpath(path) === path, 'NATIVE_RECOVERY_REAL_FILE_REQUIRED');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    need(stat.isFile() && stat.nlink === 1 && stat.size <= max &&
      (!privateMode || stat.uid === process.getuid() && !(stat.mode & 0o077)),
      'NATIVE_RECOVERY_REGULAR_FILE_REQUIRED');
    return {file, stat};
  } catch (error) { await file.close(); throw error; }
}
const stamp = stat => [stat.dev,stat.ino,stat.mode,stat.size,stat.mtimeMs,stat.ctimeMs];
async function digest(path, destination, signal, privateMode = true) {
  interrupted(signal);
  const {file, stat} = await regular(path, {privateMode});
  const hash = createHash('sha256'); let size = 0;
  try {
    await pipeline(file.createReadStream({autoClose:false}),
      new Transform({transform(chunk, _encoding, done) { size += chunk.length; hash.update(chunk); done(null, chunk); }}),
      destination ? createWriteStream(destination, {flags:'wx',mode:0o600}) :
        new Writable({write(_chunk, _encoding, done) { done(); }}), {signal});
    need(same(stamp(stat),stamp(await file.stat())) && size === stat.size, 'NATIVE_RECOVERY_SOURCE_CHANGED');
    if (destination) {
      const copied = await open(destination, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { await copied.sync(); } finally { await copied.close(); }
    }
    return {size,sha256:hash.digest('hex')};
  } finally { await file.close(); }
}
async function readJson(path, max = 12 * 1024 ** 2, privateMode = true) {
  const {file} = await regular(path, {max,privateMode});
  try {
    const raw = await file.readFile();
    need(raw.length <= max, 'NATIVE_RECOVERY_JSON_TOO_LARGE');
    return {raw,value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw))};
  } finally { await file.close(); }
}
async function syncDirectory(path) {
  const directory = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await directory.sync(); } finally { await directory.close(); }
}
async function save(path, value) {
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try { await file.writeFile(json(value)); await file.sync(); } finally { await file.close(); }
}
async function pythonExecutable(path) {
  absolute(path); await access(path, constants.X_OK);
  need((await lstat(await realpath(path))).isFile(), 'NATIVE_RECOVERY_PYTHON_REQUIRED');
  return path;
}
function keysFrom(environment) {
  const keys = {};
  for (const name of KEYS) {
    const value = environment[name];
    need(typeof value === 'string' && value.length <= 4096 && /^[A-Za-z0-9+/]+={0,2}$/.test(value) &&
      Buffer.from(value,'base64').length >= 32 &&
      Buffer.from(value,'base64').toString('base64') === value,
      'NATIVE_RECOVERY_ORIGINAL_CONTROL_KEYS_REQUIRED');
    keys[name] = value;
  }
  return keys;
}
function passphrase(options, environment, originalOwner) {
  const name = options.passphraseEnv ?? 'MCP_BACKUP_PASSPHRASE';
  need(typeof name === 'string' && /^[A-Z][A-Z0-9_]{4,63}$/.test(name) &&
    !KEYS.includes(name) && name !== originalOwner?.signerSecretEnv,
    'NATIVE_RECOVERY_SEPARATE_PASSPHRASE_REQUIRED');
  const value = environment[name];
  need(typeof value === 'string' && Buffer.byteLength(value) >= 16 && Buffer.byteLength(value) <= 65536,
    'NATIVE_RECOVERY_PASSPHRASE_REQUIRED');
  return {name,value};
}
/** A pipe-only child. Holders retain their original lock until release() resolves. */
async function runChild(executable, args, {input, expected, hold = false, signal,
  environment = {LANG:'C.UTF-8',LC_ALL:'C.UTF-8'}, timeout = 180000} = {}) {
  interrupted(signal);
  const child = spawn(executable,args,{shell:false,env:environment,stdio:['pipe','pipe','ignore']});
  let output = '', first = false, closed = false, problem;
  let resolveReady, rejectReady, resolveDone, rejectDone;
  const ready = new Promise((accept,reject) => {resolveReady=accept;rejectReady=reject;});
  const done = new Promise((accept,reject) => {resolveDone=accept;rejectDone=reject;});
  done.catch(() => {});
  const stop = code => {
    problem ??= Object.assign(new Error(code), {code});
    rejectReady(problem); if (!closed) child.kill('SIGKILL');
  };
  const timer = setTimeout(() => stop('NATIVE_RECOVERY_CHILD_TIMEOUT'), timeout);
  const abort = () => stop('NATIVE_RECOVERY_INTERRUPTED');
  signal?.addEventListener('abort',abort,{once:true});
  child.once('error',() => stop('NATIVE_RECOVERY_CHILD_START_FAILED'));
  child.stdin.once('error',() => stop('NATIVE_RECOVERY_CHILD_PIPE_FAILED'));
  child.stdout.on('data',chunk => {
    output += chunk;
    if (output.length > 65536) return stop('NATIVE_RECOVERY_CHILD_RESULT_INVALID');
    const end = output.indexOf('\n');
    if (first || end < 0) return;
    first = true;
    try {
      const value = JSON.parse(output.slice(0,end));
      need(value.status === expected, 'NATIVE_RECOVERY_CHILD_FAILED');
      resolveReady(value);
    } catch { stop('NATIVE_RECOVERY_CHILD_FAILED'); }
  });
  child.once('close',code => {
    closed = true; clearTimeout(timer); signal?.removeEventListener('abort',abort);
    if (code === 0 && first && !problem) resolveDone();
    else { stop('NATIVE_RECOVERY_CHILD_FAILED'); rejectDone(problem); }
  });
  if (input !== undefined) child.stdin.write(JSON.stringify(input) + '\n');
  if (!hold) child.stdin.end();
  try {
    const value = await ready;
    if (!hold) await done;
    return {value,
      async release() { need(!closed && !problem, 'NATIVE_RECOVERY_LOCK_LOST'); child.stdin.end('release\n'); await done; },
      async stop() { if (!closed) child.kill('SIGKILL'); await done.catch(() => {}); }};
  } catch (error) { if (!closed) child.kill('SIGKILL'); await done.catch(() => {}); throw error; }
}
async function stateLock(plan, ctx) {
  return runChild(await pythonExecutable(plan.python),['-I','-B',LOCK,'lock',plan.stateDirectory],
    {expected:'STATE_LOCKED',hold:true,signal:ctx.signal,timeout:1800000});
}
async function captureLedger(plan, destination, keys, ctx) {
  const {file,stat} = await regular(plan.ledger);
  await file.close();
  const identity = {dev:stat.dev,ino:stat.ino};
  const holder = await runChild(await pythonExecutable(plan.python),
    ['-I','-B',LEDGER,'snapshot',plan.ledger,plan.policy,destination],
    {input:{keys,identity},expected:'CAPTURE_LOCKED',hold:true,signal:ctx.signal,timeout:1800000});
  if (holder.value.checkpoint?.outcome !== 'JOURNAL_CONSISTENT') {
    await holder.stop(); fail('NATIVE_RECOVERY_LEDGER_AUDIT_FAILED');
  }
  return {...holder,identity};
}
async function verifyNative(plan, staged, keys, ctx, python, expectedCheckpoint) {
  const result = await runChild(await pythonExecutable(python ?? plan.python),
    ['-I','-B',LOCK,'verify',join(staged,'state')],
    {input:{owner:plan,keys,database:join(staged,'ledger.sqlite'),policy:join(staged,'policy.json'),
      ...(expectedCheckpoint === undefined ? {} : {expected_checkpoint:expectedCheckpoint})},
      expected:'NATIVE_STATE_VERIFIED',signal:ctx.signal});
  need(result.value.checkpoint?.outcome === 'JOURNAL_CONSISTENT','NATIVE_RECOVERY_LEDGER_AUDIT_FAILED');
  return result.value;
}
async function cryptography(args, options, ctx, originalOwner) {
  const pass = passphrase(options,ctx.environment,originalOwner);
  const expected = args[0] === 'snapshot' ? 'SNAPSHOT_CREATED' : args[0] === 'restore' ? 'RESTORED_TO_NEW_DIR' : 'SNAPSHOT_VERIFIED';
  return (await runChild(process.execPath,[CRYPTO,...args,'--pass-env',pass.name],
    {expected,signal:ctx.signal,timeout:1800000,
      environment:{LANG:'C.UTF-8',LC_ALL:'C.UTF-8',[pass.name]:pass.value}})).value;
}
async function stateInventory(plan, ctx) {
  await privateDirectory(plan.stateDirectory);
  const excluded = new Set([plan.configFile,plan.policy,plan.ledger,
    ...['-wal','-shm','-journal'].map(suffix => plan.ledger + suffix)]);
  const names = (await readdir(plan.stateDirectory)).sort();
  need(names.length <= 9400, 'NATIVE_RECOVERY_STATE_LIMIT');
  const files = [];
  for (const name of names) {
    const path = join(plan.stateDirectory,name);
    if (name === 'state.lock' || excluded.has(path)) continue;
    need(STATE_FILE.test(name), 'NATIVE_RECOVERY_UNEXPECTED_OWNER_STATE');
    files.push({path:name,...await digest(path,undefined,ctx.signal)});
  }
  return files;
}
async function stageInventory(staged, ctx) {
  const result = [];
  for (const name of ['host.json','policy.json','ledger.sqlite','control-keys.json']) {
    result.push({path:name,...await digest(join(staged,name),undefined,ctx.signal)});
  }
  for (const name of (await readdir(join(staged,'state'))).sort()) {
    need(STATE_FILE.test(name), 'NATIVE_RECOVERY_UNEXPECTED_OWNER_STATE');
    result.push({path:'state/'+name,...await digest(join(staged,'state',name),undefined,ctx.signal)});
  }
  need(result.length <= 9500 && result.reduce((sum,item) => sum+item.size,0) <= MAX_BYTES,
    'NATIVE_RECOVERY_ARCHIVE_LIMIT');
  return result;
}
function summary(record, recordSha256, manifestSha256) {
  return {schema:SCHEMA,operationId:record.operationId,createdAt:record.createdAt,
    owner:record.owner,configSha256:record.configSha256,policySha256:record.policySha256,
    recordSha256,manifestSha256,checkpoint:record.checkpoint,ledgerIdentity:record.ledgerIdentity,
    nativeState:record.nativeState,files:record.files.length,
    bytes:record.files.reduce((sum,file) => sum+file.size,0),
    controlKeyEnvironment:[...KEYS],controlKeyCustody:'ORIGINAL_ENCRYPTED_RECOVERY'};
}
/** Read original configuration and filesystem identity without opening a signer. */
export async function inspectNativeMcpSpendingRecovery(options, supplied) {
  const ctx = context(options,supplied), configFile = absolute(options.configFile);
  interrupted(ctx.signal);
  const cfg = await readMcpSpendingHost(configFile), plan = owner(configFile,cfg);
  for (const path of [plan.policy,plan.ledger,plan.stateDirectory]) absolute(path);
  need(new Set([plan.configFile,plan.policy,plan.ledger,plan.stateDirectory]).size === 4,
    'NATIVE_RECOVERY_OWNER_PATHS_OVERLAP');
  await privateDirectory(plan.stateDirectory);
  const ledger = await regular(plan.ledger); await ledger.file.close();
  return {schema:SCHEMA,owner:plan,configSha256:(await digest(configFile,undefined,ctx.signal)).sha256,
    policySha256:(await digest(plan.policy,undefined,ctx.signal,false)).sha256,
    ledgerIdentity:{dev:ledger.stat.dev,ino:ledger.stat.ino}};
}
export async function snapshotNativeMcpSpendingRecovery(options, supplied) {
  const ctx = context(options,supplied);
  need(options.quiesced === true,'NATIVE_RECOVERY_QUIESCED_OWNER_REQUIRED');
  need(typeof options.operationId === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(options.operationId),
    'NATIVE_RECOVERY_OPERATION_ID_REQUIRED');
  const inspected = await inspectNativeMcpSpendingRecovery(options,ctx), plan = inspected.owner;
  passphrase(options,ctx.environment,plan);
  const keys = keysFrom(ctx.environment), output = absolute(options.output);
  need([plan.stateDirectory,plan.configFile,plan.policy,plan.ledger].every(path =>
    !inside(output,path) && !inside(path,output)), 'NATIVE_RECOVERY_ARCHIVE_OVERLAPS_OWNER');
  need(!await exists(output),'NATIVE_RECOVERY_ARCHIVE_EXISTS');
  need(await realpath(dirname(output)) === dirname(output),'NATIVE_RECOVERY_OUTPUT_PARENT_INVALID');
  const temporary = await mkdtemp(join(dirname(output),'.mcp-capture-'));
  const staged = join(temporary,'native'); await mkdir(staged,{mode:0o700});
  await mkdir(join(staged,'state'),{mode:0o700});
  let locked, ledger, placeholder;
  try {
    locked = await stateLock(plan,ctx);
    ledger = await captureLedger(plan,join(staged,'ledger.sqlite'),keys,ctx);
    const before = await stateInventory(plan,ctx);
    await digest(plan.configFile,join(staged,'host.json'),ctx.signal);
    await digest(plan.policy,join(staged,'policy.json'),ctx.signal,false);
    for (const entry of before) {
      const copied = await digest(join(plan.stateDirectory,entry.path),join(staged,'state',entry.path),ctx.signal);
      need(same(copied,{size:entry.size,sha256:entry.sha256}),'NATIVE_RECOVERY_SOURCE_CHANGED');
    }
    await save(join(staged,'control-keys.json'),{schema:SCHEMA,keys});
    need(same(before,await stateInventory(plan,ctx)) &&
      same(inspected,await inspectNativeMcpSpendingRecovery(options,ctx)), 'NATIVE_RECOVERY_SOURCE_CHANGED');
    const verified = await verifyNative(plan,staged,keys,ctx);
    need(same(verified.checkpoint,ledger.value.checkpoint),'NATIVE_RECOVERY_CHECKPOINT_CHANGED');
    const ledgerIdentity = ledger.identity;
    await ledger.release(); ledger = undefined;
    await locked.release(); locked = undefined;
    const files = await stageInventory(staged,ctx);
    const record = {schema:SCHEMA,operationId:options.operationId,createdAt:new Date().toISOString(),
      owner:plan,configSha256:inspected.configSha256,policySha256:inspected.policySha256,
      ledgerIdentity,checkpoint:verified.checkpoint,
      nativeState:{boundRequests:verified.boundRequests,reservedRequests:verified.reservedRequests,
        finalityRecords:verified.finalityRecords},files};
    const recordPath = join(temporary,'record.json'); await save(recordPath,record);
    const planPath = join(temporary,'plan.json');
    await save(planPath,{schema:'stellar-forge.merchant-recovery-plan.v1',
      roots:[{name:'native',path:staged},{name:'record',path:recordPath}]});
    ctx.onProgress({stage:'ENCRYPTING',checkpoint:record.checkpoint,nativeState:record.nativeState});
    const encrypted = join(temporary,'encrypted');
    await cryptography(['snapshot','--plan',planPath,'--out',encrypted,'--quiesced'],options,ctx,plan);
    const manifestSha256 = (await digest(join(encrypted,'manifest.json'),undefined,ctx.signal)).sha256;
    interrupted(ctx.signal);
    await mkdir(output,{mode:0o700}); placeholder = await lstat(output);
    await rename(encrypted,output); placeholder = undefined;
    await syncDirectory(dirname(output));
    return {status:'NATIVE_SPENDING_BACKUP_CREATED',bundle:output,
      ...summary(record,sha(Buffer.from(json(record))),manifestSha256)};
  } finally {
    if (ledger) await ledger.stop();
    if (locked) await locked.stop();
    if (placeholder) {
      const current = await exists(output);
      if (current?.ino === placeholder.ino && current?.dev === placeholder.dev &&
        (await readdir(output)).length === 0) await rm(output,{recursive:true});
    }
    await rm(temporary,{recursive:true,force:true});
  }
}
async function openBackup(options, ctx) {
  const bundle = absolute(options.bundle); await privateDirectory(bundle);
  const observed = await digest(join(bundle,'manifest.json'),undefined,ctx.signal);
  if (options.expectedManifestSha256 !== undefined) need(
    HASH.test(options.expectedManifestSha256) && options.expectedManifestSha256 === observed.sha256,
    'NATIVE_RECOVERY_SELECTED_MANIFEST_CHANGED');
  const temporary = await mkdtemp(join(options.temporaryDirectory ?? tmpdir(),'.mcp-open-'));
  try {
    const extracted = join(temporary,'contents');
    await cryptography(['restore','--bundle',bundle,'--out',extracted],options,ctx);
    need((await digest(join(bundle,'manifest.json'),undefined,ctx.signal)).sha256 === observed.sha256,
      'NATIVE_RECOVERY_SELECTED_MANIFEST_CHANGED');
    const {value:record,raw} = await readJson(join(extracted,'record'));
    need(plain(record) && record.schema === SCHEMA && plain(record.owner) && Array.isArray(record.files) &&
      record.checkpoint?.outcome === 'JOURNAL_CONSISTENT' && HASH.test(record.configSha256) &&
      HASH.test(record.policySha256), 'NATIVE_RECOVERY_RECORD_INVALID');
    const recordSha256 = sha(raw);
    if (options.expectedRecordSha256 !== undefined) need(options.expectedRecordSha256 === recordSha256,
      'NATIVE_RECOVERY_SELECTED_RECORD_CHANGED');
    const staged = join(extracted,'native');
    const cfg = await readMcpSpendingHost(join(staged,'host.json'));
    need(same(record.owner,owner(absolute(record.owner.configFile),cfg)),
      'NATIVE_RECOVERY_ORIGINAL_OWNER_CHANGED');
    const files = await stageInventory(staged,ctx);
    need(same(record.files,files) && files.find(f => f.path === 'host.json').sha256 === record.configSha256 &&
      files.find(f => f.path === 'policy.json').sha256 === record.policySha256,
      'NATIVE_RECOVERY_CONTENT_CHANGED');
    const stored = (await readJson(join(staged,'control-keys.json'),16384)).value;
    need(stored.schema === SCHEMA && plain(stored.keys) && Object.keys(stored.keys).length === 3,
      'NATIVE_RECOVERY_CONTROL_KEYS_INVALID');
    const keys = keysFrom(stored.keys);
    const native = await verifyNative(record.owner,staged,keys,ctx,options.python ?? '/usr/bin/python3');
    need(same(native.checkpoint,record.checkpoint) && same(record.nativeState,
      {boundRequests:native.boundRequests,reservedRequests:native.reservedRequests,finalityRecords:native.finalityRecords}),
      'NATIVE_RECOVERY_CHECKPOINT_CHANGED');
    return {temporary,staged,record,keys,recordSha256,manifestSha256:observed.sha256};
  } catch (error) { await rm(temporary,{recursive:true,force:true}); throw error; }
}
export async function verifyNativeMcpSpendingRecovery(options, supplied) {
  const ctx = context(options,supplied), opened = await openBackup(options,ctx);
  try { return {status:'NATIVE_SPENDING_BACKUP_VERIFIED',
    ...summary(opened.record,opened.recordSha256,opened.manifestSha256)}; }
  finally { await rm(opened.temporary,{recursive:true,force:true}); }
}
/** Atomic create-only publication. Exact existing bytes are a resumable receipt. */
async function publishFile(source,target,expected,ctx,{privateMode = true} = {}) {
  await privateDirectory(dirname(target));
  if (await exists(target)) {
    need(same(await digest(target,undefined,ctx.signal,privateMode),expected),'NATIVE_RECOVERY_EXISTING_FILE_CONFLICT');
    return 'EXISTING';
  }
  const temporary = join(dirname(target),'.native-recovery-'+randomUUID());
  try {
    need(same(await digest(source,temporary,ctx.signal),expected),'NATIVE_RECOVERY_CONTENT_CHANGED');
    try { await link(temporary,target); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      need(same(await digest(target,undefined,ctx.signal,privateMode),expected),'NATIVE_RECOVERY_EXISTING_FILE_CONFLICT');
      return 'EXISTING';
    }
    await syncDirectory(dirname(target)); return 'CREATED';
  } finally { await unlink(temporary).catch(error => {if (error.code !== 'ENOENT') throw error;}); }
}
/** Restore the original canonical owner, or reattach its exact present ledger.
 * Existing history is audited under the same original SQLite writer lock.
 * Each file is create-only; an interrupted publication resumes from exact bytes.
 */
export async function restoreNativeMcpSpendingRecovery(options, supplied) {
  need(HASH.test(options.expectedManifestSha256 ?? ''),'NATIVE_RECOVERY_SELECTED_MANIFEST_REQUIRED');
  const ctx = context(options,supplied), opened = await openBackup(options,ctx);
  let locked, ledger; const created = [];
  try {
    const {record,staged,keys} = opened, plan = {...record.owner,python:options.python ?? record.owner.python};
    if (options.configFile !== undefined) need(options.configFile === plan.configFile,'NATIVE_RECOVERY_ORIGINAL_PATHS_REQUIRED');
    if (options.destination !== undefined) need(options.destination === plan.stateDirectory,'NATIVE_RECOVERY_ORIGINAL_PATHS_REQUIRED');
    for (const name of KEYS) if (ctx.environment[name] !== undefined) need(
      ctx.environment[name] === keys[name], 'NATIVE_RECOVERY_PRESENT_CONTROL_KEY_CONFLICT');
    need(!inside(plan.stateDirectory,absolute(options.bundle)),'NATIVE_RECOVERY_ARCHIVE_OVERLAPS_OWNER');
    await ensurePrivateDirectory(plan.stateDirectory);
    for (const path of [plan.configFile,plan.policy,plan.ledger]) await ensurePrivateDirectory(dirname(path));
    locked = await stateLock(plan,ctx);
    const file = name => {const entry = record.files.find(f => f.path === name);
      need(entry,'NATIVE_RECOVERY_RECORD_INVALID');return {size:entry.size,sha256:entry.sha256};};
    const publish = async (name,target,privateMode = true) => {
      const result = await publishFile(join(staged,name),target,file(name),ctx,{privateMode});
      if (result === 'CREATED') created.push(target);
    };
    // Preflight immutable configuration and every existing native record before
    // making a missing ledger visible to any other original SF36 consumer.
    for (const [name,target,privateMode] of [['host.json',plan.configFile,true],['policy.json',plan.policy,false]]) {
      if (await exists(target)) need(same(await digest(target,undefined,ctx.signal,privateMode),file(name)),
        'NATIVE_RECOVERY_EXISTING_FILE_CONFLICT');
    }
    const expectedState = record.files.filter(f => f.path.startsWith('state/'));
    const presentState = await stateInventory(plan,ctx);
    need(presentState.every(present => expectedState.some(expected => expected.path === 'state/'+present.path &&
      expected.sha256 === present.sha256 && expected.size === present.size)), 'NATIVE_RECOVERY_EXISTING_STATE_CONFLICT');
    await publish('policy.json',plan.policy,false);
    const ledgerExisted = Boolean(await exists(plan.ledger));
    if (!ledgerExisted) await publish('ledger.sqlite',plan.ledger);
    // Original online backup/audit, not immutable reads of a live WAL database.
    const liveCopy = join(opened.temporary,'current-ledger.sqlite');
    ledger = await captureLedger(plan,liveCopy,keys,ctx);
    need(same(ledger.value.checkpoint,record.checkpoint),'NATIVE_RECOVERY_PRESENT_HISTORY_CHANGED');
    for (const entry of expectedState) await publish(entry.path,join(plan.stateDirectory,entry.path.slice(6)));
    await publish('host.json',plan.configFile);
    need(same(record.owner,owner(plan.configFile,await readMcpSpendingHost(plan.configFile))),
      'NATIVE_RECOVERY_ORIGINAL_OWNER_CHANGED');
    const finalState = await stateInventory(plan,ctx);
    need(same(finalState,expectedState.map(f => ({...f,path:f.path.slice(6)}))),
      'NATIVE_RECOVERY_CONTENT_CHANGED');
    const currentIdentity = ledger.identity;
    await ledger.release(); ledger = undefined;
    await locked.release(); locked = undefined;
    return {status:ledgerExisted ? 'NATIVE_SPENDING_OWNER_REATTACHED' : 'NATIVE_SPENDING_OWNER_RESTORED',
      ...summary(record,opened.recordSha256,opened.manifestSha256),currentLedgerIdentity:currentIdentity,created};
  } catch (error) {
    // A created original file is retained as a receipt for the same operation.
    // In particular, removing a newly published shared ledger would erase state.
    if (created.length) error.recovery = {status:'NATIVE_SPENDING_RESTORE_INCOMPLETE',created};
    throw error;
  } finally {
    if (ledger) await ledger.stop();
    if (locked) await locked.stop();
    await rm(opened.temporary,{recursive:true,force:true});
  }
}
/** Verify a present, possibly advanced original owner. The archived checkpoint
 * must be a prefix of the fully audited current journal; every archived native
 * binding/finality file remains byte-identical. Later legitimate work is kept.
 * The operation only locks/reads original state and creates private temp copies.
 */
export async function verifyCurrentNativeMcpSpendingOwner(options, supplied) {
  need(HASH.test(options.expectedManifestSha256 ?? ''),'NATIVE_RECOVERY_SELECTED_MANIFEST_REQUIRED');
  const ctx = context(options,supplied), opened = await openBackup(options,ctx);
  let locked, ledger;
  try {
    const {record,keys} = opened, plan = {...record.owner,python:options.python ?? record.owner.python};
    if (options.configFile !== undefined) need(options.configFile === plan.configFile,'NATIVE_RECOVERY_ORIGINAL_PATHS_REQUIRED');
    for (const name of KEYS) if (ctx.environment[name] !== undefined) need(
      ctx.environment[name] === keys[name],'NATIVE_RECOVERY_PRESENT_CONTROL_KEY_CONFLICT');
    const inspected = await inspectNativeMcpSpendingRecovery({configFile:plan.configFile},ctx);
    need(same(inspected.owner,record.owner) && inspected.configSha256 === record.configSha256 &&
      inspected.policySha256 === record.policySha256,'NATIVE_RECOVERY_ORIGINAL_OWNER_CHANGED');
    locked = await stateLock(plan,ctx);
    const current = join(opened.temporary,'current'); await mkdir(current,{mode:0o700});
    await mkdir(join(current,'state'),{mode:0o700});
    ledger = await captureLedger(plan,join(current,'ledger.sqlite'),keys,ctx);
    const before = await stateInventory(plan,ctx);
    const archivedState = record.files.filter(file => file.path.startsWith('state/') &&
      !file.path.startsWith('state/.mcp-spending-'));
    need(archivedState.every(archived => before.some(present =>
      archived.path === 'state/'+present.path && archived.sha256 === present.sha256 && archived.size === present.size)),
      'NATIVE_RECOVERY_ORIGINAL_STATE_CHANGED');
    await digest(plan.policy,join(current,'policy.json'),ctx.signal,false);
    for (const entry of before) {
      const copied = await digest(join(plan.stateDirectory,entry.path),join(current,'state',entry.path),ctx.signal);
      need(same(copied,{size:entry.size,sha256:entry.sha256}),'NATIVE_RECOVERY_SOURCE_CHANGED');
    }
    need(same(before,await stateInventory(plan,ctx)) &&
      same(inspected,await inspectNativeMcpSpendingRecovery({configFile:plan.configFile},ctx)),
      'NATIVE_RECOVERY_SOURCE_CHANGED');
    const verified = await verifyNative(plan,current,keys,ctx,options.python,record.checkpoint);
    need(same(verified.checkpoint,ledger.value.checkpoint) && same(verified.archivePrefix,record.checkpoint),
      'NATIVE_RECOVERY_CHECKPOINT_CHANGED');
    const currentLedgerIdentity = ledger.identity;
    await ledger.release(); ledger = undefined;
    await locked.release(); locked = undefined;
    return {status:'NATIVE_SPENDING_CURRENT_OWNER_VERIFIED',
      ...summary(record,opened.recordSha256,opened.manifestSha256),
      currentCheckpoint:verified.checkpoint,currentLedgerIdentity,
      currentNativeState:{boundRequests:verified.boundRequests,reservedRequests:verified.reservedRequests,
        finalityRecords:verified.finalityRecords},archivePrefix:verified.archivePrefix};
  } finally {
    if (ledger) await ledger.stop();
    if (locked) await locked.stop();
    await rm(opened.temporary,{recursive:true,force:true});
  }
}
/** Keep recovered control-key custody scoped to a caller-owned application
 * lifespan. The callback receives a new environment; process.env is untouched.
 */
export async function withNativeMcpSpendingRecoveryEnvironment(options, operation, supplied) {
  need(typeof operation === 'function','NATIVE_RECOVERY_CALLBACK_REQUIRED');
  const ctx = context(options,supplied), opened = await openBackup(options,ctx);
  try {
    for (const name of KEYS) if (ctx.environment[name] !== undefined) need(
      ctx.environment[name] === opened.keys[name], 'NATIVE_RECOVERY_PRESENT_CONTROL_KEY_CONFLICT');
    const environment = {...ctx.environment,...opened.keys};
    try { return await operation({environment,recovery:
      summary(opened.record,opened.recordSha256,opened.manifestSha256)}); }
    finally { for (const name of KEYS) delete environment[name]; }
  } finally { await rm(opened.temporary,{recursive:true,force:true}); }
}
export async function nativeMcpSpendingRecoveryMain(argv = process.argv.slice(2), supplied = {}) {
  const [action,...rest] = argv, options = {};
  const flags = {config:'configFile',output:'output',bundle:'bundle','pass-env':'passphraseEnv',
    expected:'expectedManifestSha256','expected-record':'expectedRecordSha256',
    operation:'operationId',python:'python','temporary-directory':'temporaryDirectory'};
  for (let i=0;i<rest.length;i++) {
    if (rest[i] === '--quiesced') {need(options.quiesced === undefined,'NATIVE_RECOVERY_ARGUMENT_INVALID');options.quiesced=true;continue;}
    const flag = rest[i]?.slice(2);
    const key = Object.hasOwn(flags,flag) ? flags[flag] : undefined;
    need(rest[i]?.startsWith('--') && key && options[key] === undefined && rest[i+1] &&
      !rest[i+1].startsWith('--'),'NATIVE_RECOVERY_ARGUMENT_INVALID');
    options[key]=rest[++i];
  }
  const actions = {inspect:inspectNativeMcpSpendingRecovery,snapshot:snapshotNativeMcpSpendingRecovery,
    verify:verifyNativeMcpSpendingRecovery,restore:restoreNativeMcpSpendingRecovery,
    'verify-current':verifyCurrentNativeMcpSpendingOwner};
  need(Object.hasOwn(actions,action),'NATIVE_RECOVERY_ACTION_REQUIRED');
  return actions[action](options,supplied);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  nativeMcpSpendingRecoveryMain().then(value => process.stdout.write(json(value))).catch(error => {
    process.stderr.write(json({status:'NATIVE_RECOVERY_FAILED',code:error.code ?? 'NATIVE_RECOVERY_LOCAL_ERROR',
      ...(error.recovery ? {recovery:error.recovery} : {})}));process.exitCode=1;
  });
}
