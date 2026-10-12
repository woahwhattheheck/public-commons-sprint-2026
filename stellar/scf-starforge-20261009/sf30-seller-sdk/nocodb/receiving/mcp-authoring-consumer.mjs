#!/usr/bin/env node
// MIT. Continue the SAME completed NocoDB receiving operation through the
// released merchant MCP, native authoring/publisher and original SF82 owners.
// This program makes no NocoDB provider read, wallet call or payment.
import assert from 'node:assert/strict';
import { constants, fstatSync } from 'node:fs';
import { readFile, open, lstat, realpath, mkdir, rename, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const SCF = 'stellar/scf-starforge-20261009';
const SOURCE = SCF + '/sf30-seller-sdk/nocodb/receiving/mcp-authoring-consumer.mjs';
const MCP = 'stellar-forge/mcp-merchant-operator';
const LEASE_ENV = 'NOCODB_RECEIVING_LEASE_FD';
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX_PACKET = 256000000;
const stamp = () => new Date().toISOString();
const bytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const hash = value => createHash('sha256').update(value).digest('hex');
const failure = (code, message = code) => Object.assign(new Error(message), { code });
const need = (condition, code, message) => { if (!condition) throw failure(code, message); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const absolute = (value, name) => {
  need(typeof value === 'string' && isAbsolute(value) && resolve(value) === value &&
    !/[\0\r\n]/.test(value), 'ABSOLUTE_PATH_REQUIRED', name);
  return value;
};
const within = (root, path) => {
  const part = relative(root, path);
  return part === '' || !isAbsolute(part) && part !== '..' && !part.startsWith('..' + sep);
};
async function privateDirectory(path, create = false) {
  if (create) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    try { await mkdir(path, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const stat = await lstat(path);
  need(stat.isDirectory() && !stat.isSymbolicLink() && !(stat.mode & 0o077) &&
    stat.uid === process.getuid() && await realpath(path) === path, 'PRIVATE_DIRECTORY_REQUIRED', path);
}
async function regular(path, { optional = false, privateFile = true, maximum = MAX_PACKET } = {}) {
  let fd;
  try { fd = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
  try {
    const before = await fd.stat();
    need(before.isFile() && before.nlink === 1 && before.size <= maximum &&
      (!privateFile || !(before.mode & 0o077) && before.uid === process.getuid()),
    'REGULAR_FILE_REQUIRED', path);
    const data = await fd.readFile(), after = await fd.stat();
    need(data.length === before.size && before.size === after.size &&
      before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs,
    'RETAINED_FILE_CHANGED', path);
    return data;
  } finally { await fd.close(); }
}
async function json(path, optional = false) {
  const data = await regular(path, { optional });
  return data === null ? null : JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
}
async function syncDirectory(path) {
  const fd = await open(path, constants.O_RDONLY);
  try { await fd.sync(); } finally { await fd.close(); }
}
async function atomic(path, data) {
  await privateDirectory(dirname(path));
  const temporary = path + '.' + randomUUID() + '.partial';
  let fd;
  try {
    fd = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL |
      (constants.O_NOFOLLOW ?? 0), 0o600);
    await fd.writeFile(data); await fd.sync(); await fd.close(); fd = null;
    const prior = await regular(path, { optional: true });
    if (prior?.equals(data)) { await unlink(temporary); return; }
    await rename(temporary, path); await syncDirectory(dirname(path));
  } finally { await fd?.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
const save = (path, value) => atomic(path, bytes(value));
async function retain(path, value) {
  const data = bytes(value), previous = await regular(path, { optional: true });
  if (previous) assert.deepEqual(previous, data, 'The retained receiving selection is immutable.');
  else await atomic(path, data);
  return { file: path, bytes: data.length, sha256: hash(data) };
}
async function fileIdentity(path) {
  const data = await regular(path);
  return { file: path, bytes: data.length, sha256: hash(data) };
}

// The same original testnet operation file and descriptor ABI are used here.
// O_CREAT is deliberately absent: this continuation cannot establish a new job.
const PYTHON_LEASE = [
  'import fcntl, os, stat, sys',
  'lock, node, script, input_path = sys.argv[1:]',
  'fd = os.open(lock, os.O_RDWR | getattr(os, "O_NOFOLLOW", 0))',
  's = os.fstat(fd)',
  'if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1 or s.st_mode & 0o077 or s.st_uid != os.getuid():',
  '    raise SystemExit("PRIVATE_ORIGINAL_OPERATION_LEASE_REQUIRED")',
  'try:',
  '    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)',
  'except BlockingIOError:',
  '    raise SystemExit("ORIGINAL_RECEIVING_OPERATION_ACTIVE")',
  'os.set_inheritable(fd, True)',
  'os.environ["NOCODB_RECEIVING_LEASE_FD"] = str(fd)',
  'os.execv(node, [node, script, "--locked-input", input_path])',
].join('\n') + '\n';
function subprocess(command, args, options) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, options);
    const forward = signal => { if (child.exitCode === null && child.signalCode === null) child.kill(signal); };
    const term = () => forward('SIGTERM'), interrupt = () => forward('SIGINT');
    process.on('SIGTERM', term); process.on('SIGINT', interrupt);
    const detach = () => { process.off('SIGTERM', term); process.off('SIGINT', interrupt); };
    child.once('error', error => { detach(); reject(error); });
    child.once('exit', (code, signal) => { detach(); done({ code, signal }); });
  });
}
async function leaseFor(root) {
  const value = Number(process.env[LEASE_ENV]);
  need(Number.isSafeInteger(value) && value >= 3, 'ORIGINAL_OPERATION_LEASE_REQUIRED');
  const held = fstatSync(value), named = await lstat(join(root, 'operation.lock'));
  need(held.isFile() && named.isFile() && !named.isSymbolicLink() &&
    held.nlink === 1 && held.dev === named.dev && held.ino === named.ino &&
    !(held.mode & 0o077) && held.uid === process.getuid(), 'ORIGINAL_OPERATION_LEASE_CHANGED');
  return value;
}
async function loadInput(path) {
  path = absolute(path, 'private receiving input');
  const data = await regular(path, { maximum: 1048576 }), input = JSON.parse(data);
  need(input.schema === 'stellar-forge.nocodb-mcp-receiving-input.v1', 'NOCODB_MCP_RECEIVING_INPUT_REQUIRED');
  need(typeof input.operationId === 'string' && /^[a-z0-9][a-z0-9._-]{3,119}$/.test(input.operationId),
    'ORIGINAL_OPERATION_ID_REQUIRED');
  need(HASH.test(input.consumerSha256) && HASH.test(input.completedOperation?.resultSha256) &&
    HASH.test(input.sourceManifest?.sha256), 'EXACT_INPUT_HASHES_REQUIRED');
  const completed = absolute(input.completedOperation.directory, 'completed original operation');
  const sourceRoot = absolute(input.sourceRoot, 'selected original source');
  absolute(input.sourceManifest.file, 'original package manifest');
  absolute(input.runtimeDirectory, 'original installed runtime');
  absolute(input.python, 'Python executable');
  absolute(input.browser?.module, 'existing Playwright module');
  absolute(input.browser?.executable, 'existing Chromium executable');
  need(typeof input.reviewer === 'string' && input.reviewer.trim().length > 0 &&
    input.reviewer.length <= 240 && !/[\0\r\n]/.test(input.reviewer), 'REVIEWER_REQUIRED');
  need(Number(process.versions.node.split('.')[0]) >= 24 && process.platform !== 'win32',
    'NODE24_POSIX_REQUIRED');
  await privateDirectory(completed);
  need(hash(await regular(SELF, { privateFile: false })) === input.consumerSha256, 'RECEIVING_SOURCE_CHANGED');
  return { input, inputFile: path, inputSha256: hash(data), completed, sourceRoot,
    output: join(completed, 'mcp-authoring') };
}
async function originalBasis(ctx) {
  const finalFile = join(ctx.completed, 'result.json'), finalBytes = await regular(finalFile);
  assert.equal(hash(finalBytes), ctx.input.completedOperation.resultSha256);
  const completed = JSON.parse(finalBytes);
  need(completed.schema === 'stellar-forge.nocodb-testnet-receiving-result.v1' &&
    completed.operationId === ctx.input.operationId && completed.state === 'PASS' &&
    completed.payment?.network === 'stellar:testnet' && completed.payment.completedPayments === 4 &&
    completed.applications?.finalPhase === 'STOPPED', 'ORIGINAL_WHOLE_RECEIVING_NOT_COMPLETE');
  const identities = [{ file: finalFile, sha256: hash(finalBytes) }];
  for (const row of completed.completedFiles ?? []) {
    absolute(row.file, 'original completed artifact');
    need(within(ctx.completed, row.file) && HASH.test(row.sha256), 'ORIGINAL_ARTIFACT_SCOPE_CHANGED');
    assert.equal(hash(await regular(row.file)), row.sha256);
    identities.push({ file: row.file, sha256: row.sha256 });
  }
  const coreDirectory = join(ctx.completed, 'core'), core = await json(join(coreDirectory, 'result.json'));
  const templateBytes = await regular(join(ctx.completed, 'core-input.json')), template = JSON.parse(templateBytes);
  const intent = await json(join(coreDirectory, 'intent.json'));
  need(core.state === 'PASS' && core.inputSha256 === hash(templateBytes) &&
    core.inputSha256 === intent.inputSha256 && template.operationId === ctx.input.operationId &&
    template.outputDirectory === coreDirectory, 'ORIGINAL_CORE_BINDING_CHANGED');
  need(core.actor?.rows === 200 && core.film?.first?.rows === 1000 && core.film?.second?.rows === 1000 &&
    completed.core.resultSha256 === hash(await regular(join(coreDirectory, 'result.json'))),
    'ORIGINAL_COMPLETE_PROVIDER_ROWS_REQUIRED');
  const payment = await json(join(ctx.completed, 'payment-result.json'));
  need(payment.state === 'PASS' && completed.payment.resultSha256 ===
    hash(await regular(join(ctx.completed, 'payment-result.json'))) &&
    payment.snapshot === core.film.second.snapshot && payment.valuesSha256 === core.film.second.valuesSha256,
    'ORIGINAL_PAID_DATASET_BINDING_CHANGED');
  for (const row of payment.completedFiles ?? []) {
    absolute(row.file, 'retained payment/delivery artifact');
    need(within(ctx.completed, row.file) && HASH.test(row.sha256), 'ORIGINAL_ARTIFACT_SCOPE_CHANGED');
    assert.equal(hash(await regular(row.file)), row.sha256);
    identities.push({ file: row.file, sha256: row.sha256 });
  }
  for (const alias of ['film', 'actor']) {
    const selected = intent.authoring?.[alias];
    need(selected && Number.isSafeInteger(selected.version?.id) && selected.version.id > 0 &&
      HASH.test(selected.version.sourceSha256) && HASH.test(selected.version.observationSha256),
      'ORIGINAL_AUTHORING_BINDING_REQUIRED');
    const directory = join(coreDirectory, 'authoring', alias);
    await privateDirectory(directory);
    need(within(directory, absolute(selected.version.sourceFile, 'original saved source')) &&
      selected.publisher.directory === join(directory, 'publisher') &&
      selected.publisher.targetDirectory === join(directory, 'dataset'), 'ORIGINAL_AUTHORING_PATH_CHANGED');
    assert.equal(hash(await regular(selected.version.sourceFile)), selected.version.sourceSha256);
  }
  identities.push({ file: join(ctx.completed, 'core-input.json'), sha256: hash(templateBytes) },
    { file: join(coreDirectory, 'intent.json'), sha256: hash(await regular(join(coreDirectory, 'intent.json'))) });
  return { completed, coreDirectory, core, template, intent, payment, identities };
}
async function selectedSource(ctx) {
  const data = await regular(ctx.input.sourceManifest.file, { privateFile: false, maximum: 16 * 1024 * 1024 });
  assert.equal(hash(data), ctx.input.sourceManifest.sha256);
  const manifest = JSON.parse(data);
  need(Array.isArray(manifest.files) && manifest.files.length > 0, 'ORIGINAL_SOURCE_MANIFEST_REQUIRED');
  need(await realpath(ctx.sourceRoot) === ctx.sourceRoot, 'ORIGINAL_SOURCE_ROOT_CHANGED');
  const seen = new Set();
  for (const row of manifest.files) {
    need(typeof row.path === 'string' && row.path && !row.path.includes('\\') &&
      !isAbsolute(row.path) && !row.path.split('/').some(part => !part || part === '.' || part === '..') &&
      HASH.test(row.sha256) && Number.isSafeInteger(row.bytes) && row.bytes >= 0 && !seen.has(row.path),
    'ORIGINAL_SOURCE_MANIFEST_INVALID');
    seen.add(row.path);
    const path = join(ctx.sourceRoot, row.path);
    need(within(ctx.sourceRoot, path) && await realpath(path) === path, 'ORIGINAL_SOURCE_PATH_CHANGED');
    const content = await regular(path, { privateFile: false });
    assert.equal(content.length, row.bytes); assert.equal(hash(content), row.sha256, row.path);
  }
  for (const file of [SOURCE, MCP + '/serve.mjs', MCP + '/nocodb-workspace.mjs',
    MCP + '/catalog/nocodb-workspace.mjs', MCP + '/retained-download.mjs',
    SCF + '/sf30-seller-sdk/nocodb/workspace/model.mjs'])
    need(seen.has(file), 'COMPLETE_MCP_SOURCE_SELECTION_REQUIRED', file);
  assert.equal(manifest.files.find(row => row.path === SOURCE).sha256, ctx.input.consumerSha256);
  const { inspectMerchantRuntime } = await import(pathToFileURL(join(ctx.sourceRoot,
    SCF + '/sf46-release/runtime-package.mjs')).href);
  const installed = await inspectMerchantRuntime(ctx.input.runtimeDirectory, {
    expectedManifest: ctx.input.sourceManifest.sha256, load: false });
  need(installed.sourceRoot === ctx.sourceRoot &&
    installed.sourceManifestSha256 === ctx.input.sourceManifest.sha256, 'ORIGINAL_INSTALLED_SOURCE_REQUIRED');
  return { sourceCommit: installed.sourceCommit, sourceManifestSha256: installed.sourceManifestSha256,
    sourceFiles: manifest.files.length, installationId: installed.installationId,
    profileId: installed.profileId, runtimeDirectory: installed.directory, lockSha256: installed.lockSha256 };
}
async function assertUnchanged(identities) {
  for (const row of identities) assert.equal(hash(await regular(row.file)), row.sha256,
    'The completed original provider/payment/customer artifact is unchanged: ' + basename(row.file));
}
async function waitFor(action, label, signal, timeout = 120000) {
  const end = Date.now() + timeout;
  for (;;) {
    signal?.throwIfAborted();
    const value = await action();
    if (value) return value;
    if (Date.now() >= end) throw failure('ORIGINAL_OPERATION_WAIT_EXPIRED', label);
    await new Promise(done => setTimeout(done, 150));
  }
}
async function execute(ctx) {
  const lease = await leaseFor(ctx.completed), basis = await originalBasis(ctx), source = await selectedSource(ctx);
  await privateDirectory(ctx.output, true);
  for (const name of ['downloads', 'logs', 'screenshots']) await privateDirectory(join(ctx.output, name), true);
  const intentFile = join(ctx.output, 'intent.json');
  let intent = await json(intentFile, true);
  if (intent) {
    need(intent.schema === 'stellar-forge.nocodb-mcp-receiving-intent.v1' &&
      intent.inputSha256 === ctx.inputSha256 && intent.operationId === ctx.input.operationId,
    'MCP_RECEIVING_INTENT_CHANGED');
  } else {
    intent = { schema: 'stellar-forge.nocodb-mcp-receiving-intent.v1',
      operationId: ctx.input.operationId, inputSha256: ctx.inputSha256, createdAt: stamp(),
      source, previousResultSha256: ctx.input.completedOperation.resultSha256,
      stages: {}, requests: {}, hosts: [], commands: [], downloads: {} };
    await save(intentFile, intent);
  }
  const persist = () => save(intentFile, intent);
  const previous = await json(join(ctx.output, 'result.json'), true);
  if (previous?.state === 'PASS') {
    assert.equal(previous.inputSha256, ctx.inputSha256);
    await assertUnchanged([...basis.identities, ...previous.completedFiles]);
    console.log(JSON.stringify({ state: 'RETAINED_COMPLETE', operationId: ctx.input.operationId,
      result: join(ctx.output, 'result.json'), additionalPayments: 0 }));
    return;
  }
  const { openMerchantFileClient } = await import(pathToFileURL(join(ctx.sourceRoot, MCP + '/retained-download.mjs')).href);
  const { validatePacket } = await import(pathToFileURL(join(ctx.sourceRoot,
    SCF + '/sf30-seller-sdk/nocodb/workspace/packet.mjs')).href);
  const { chromium } = await import(pathToFileURL(ctx.input.browser.module).href);
  const abort = new AbortController(), interrupt = () => abort.abort(failure('MCP_RECEIVING_INTERRUPTED'));
  process.once('SIGTERM', interrupt); process.once('SIGINT', interrupt);
  let host = null, client = null, browser = null, context = null, page = null;
  const browserErrors = [];
  const completedFiles = new Map();
  const remember = async path => { const info = await fileIdentity(path); completedFiles.set(path, info); return info; };
  const connectionFile = join(ctx.output, 'nocodb-workspaces.private.json');
  const configFile = join(ctx.output, 'merchant-mcp.private.json');
  const connection = { schema: 'stellar-forge.nocodb-authoring-connection.v1', workspaces:
    Object.fromEntries(['film', 'actor'].map(alias => [alias, {
      label: 'Original NocoDB ' + alias, directory: join(basis.coreDirectory, 'authoring', alias),
      inputs: { captured: { kind: 'source', file: basis.intent.authoring[alias].version.sourceFile,
        label: 'Original reviewed ' + alias + ' source and complete capture' } },
    }])) };
  // The original generic release/export stores are reused. No extra publisher,
  // source store, account store or release engine is constructed by this caller.
  const config = { schema: 'stellar-forge.merchant-mcp.v1', name: 'NocoDB source authoring receiving',
    releaseStore: join(basis.coreDirectory, 'merchant', 'releases'),
    exportsDirectory: join(basis.coreDirectory, 'merchant', 'customer-exports'),
    sources: {}, nocodbWorkspaceConnection: connectionFile };
  await retain(connectionFile, connection); await retain(configFile, config);

  async function startHost() {
    need(host === null, 'MCP_HOST_ALREADY_OWNED'); abort.signal.throwIfAborted();
    const id = randomUUID(), log = await open(join(ctx.output, 'logs', id + '.log'), 'a', 0o600);
    const token = randomBytes(32).toString('hex');
    const record = { id, startedAt: stamp(), sourceCommit: source.sourceCommit, state: 'STARTING' };
    intent.hosts.push(record); await persist();
    const environment = { ...process.env, MCP_ACCESS_TOKEN: token, [LEASE_ENV]: '3' };
    // This source-only continuation never receives the earlier signer's custody.
    for (const key of ['NOCODB_RECEIVING_PAYER_SECRET', 'NOCODB_RECEIVING_MERCHANT_SECRET',
      'NOCODB_RECEIVING_HTTPS_PROXY', 'MCP_OAUTH_CONFIG']) delete environment[key];
    const child = spawn(process.execPath, [join(ctx.sourceRoot, MCP + '/serve.mjs'),
      'serve', '--config', configFile, '--port', '0'],
    { cwd: ctx.sourceRoot, env: environment, stdio: ['ignore', 'pipe', log.fd, lease] });
    let closed = false, exitResult, tail = '', logWrites = Promise.resolve(), resolveReady, rejectReady;
    const ready = new Promise((done, reject) => { resolveReady = done; rejectReady = reject; });
    const exited = new Promise(done => {
      child.once('error', error => { closed = true; exitResult = { code: null, signal: null, error: error.code };
        rejectReady(error); done(exitResult); });
      child.once('close', (code, signal) => { closed = true; exitResult = { code, signal };
        rejectReady(failure('ORIGINAL_MCP_EXITED_BEFORE_READY')); done(exitResult); });
    });
    child.stdout.on('data', chunk => {
      logWrites = logWrites.then(() => log.writeFile(chunk)); logWrites.catch(() => {});
      if (record.state !== 'STARTING') return;
      tail += chunk.toString('utf8');
      if (tail.length > 2 * 1024 * 1024) { rejectReady(failure('MCP_STARTUP_REPLY_TOO_LARGE')); return; }
      let newline;
      while ((newline = tail.indexOf('\n')) !== -1) {
        const line = tail.slice(0, newline); tail = tail.slice(newline + 1);
        let value; try { value = JSON.parse(line); } catch { continue; }
        if (value.schema === 'stellar-forge.merchant-mcp-listener.v1') resolveReady(value);
      }
    });
    host = { id, child, log, record, exited, logWrites: () => logWrites, closed: () => closed,
      exitResult: () => exitResult };
    let timer;
    try {
      const value = await Promise.race([ready, new Promise((_, reject) => {
        timer = setTimeout(() => reject(failure('ORIGINAL_MCP_STARTUP_EXPIRED')), 120000);
      })]);
      const endpoint = new URL(value.url);
      need(endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1' &&
        Number(endpoint.port) > 0 && Array.isArray(value.tools) &&
        value.tools.includes('merchant_nocodb_open') && value.tools.includes('merchant_nocodb_publisher_inspect') &&
        value.tools.includes('merchant_nocodb_deployment_command'), 'ORIGINAL_MCP_READY_REQUIRED');
      Object.assign(record, { state: 'READY', pid: child.pid, url: endpoint.origin, readyAt: stamp() });
      await persist();
      client = await openMerchantFileClient({ url: endpoint.origin, environment: { MCP_ACCESS_TOKEN: token },
        signal: abort.signal, errorPrefix: 'NOCODB_RECEIVING', clientName: 'nocodb-original-mcp-receiving' });
      await client.call('merchant_nocodb_open', { workspace: 'film' });
      await client.call('merchant_nocodb_open', { workspace: 'actor' });
    } finally { clearTimeout(timer); }
  }
  async function closePage() { if (page) { const owned = page; page = null; await owned.close(); } }
  async function stopHost() {
    await closePage();
    if (!host) return;
    const owned = host; client = null;
    if (!owned.closed()) owned.child.kill('SIGTERM');
    let timer;
    try {
      const result = await Promise.race([owned.exited, new Promise((_, reject) => {
        timer = setTimeout(() => reject(failure('ORIGINAL_MCP_DRAIN_NOT_COMPLETE',
          'The exact owned MCP child still retains this operation lease; preserve it for native drain.')), 120000);
      })]);
      await owned.logWrites(); await owned.log.sync(); await owned.log.close();
      Object.assign(owned.record, { state: result.code === 0 ? 'CLOSED' : 'EXITED_WITH_ERROR',
        closedAt: stamp(), exit: result }); await persist(); host = null;
      need(result.code === 0, 'ORIGINAL_MCP_SHUTDOWN_FAILED');
    } finally { clearTimeout(timer); }
  }
  const call = (name, args = {}, options) => {
    need(client && host?.record.state === 'READY', 'ORIGINAL_MCP_CLIENT_NOT_OPEN');
    abort.signal.throwIfAborted(); return client.call(name, args, options);
  };
  const state = (workspace = 'film') => call('merchant_nocodb_status', { workspace, limit: 100 });
  async function stage(key, action) {
    if (intent.stages[key]) return intent.stages[key];
    abort.signal.throwIfAborted();
    const result = await action();
    intent.stages[key] = result; await persist();
    console.log(JSON.stringify({ state: 'COMPLETED_STAGE', stage: key, operationId: ctx.input.operationId }));
    return result;
  }
  async function original(key, tool, input, { withholdReply = false } = {}) {
    let request = intent.requests[key];
    if (!request) {
      request = { tool, args: { ...input, requestId: randomUUID() }, preparedAt: stamp() };
      intent.requests[key] = request; await persist();
    } else {
      assert.equal(request.tool, tool);
      const { requestId, ...prior } = request.args;
      assert.deepEqual(prior, input, 'Resume the exact saved native input for ' + key);
    }
    const read = () => call('merchant_nocodb_operation', {
      workspace: request.args.workspace, requestId: request.args.requestId });
    let current = await read();
    if (!current.receipt) {
      request.dispatchedAt ??= stamp(); await persist();
      try {
        const reply = await call(tool, request.args);
        if (withholdReply && !request.replyWithheld) {
          const retained = join(ctx.output, 'logs', request.args.requestId + '-withheld-reply.json');
          await save(retained, reply);
          request.replyWithheld = { at: stamp(), ...await fileIdentity(retained) }; await persist();
          // Resolve through the original receipt below. The accepted response is
          // intentionally withheld once from the caller's completion path.
        }
      } catch (error) {
        request.lastTransportCode = error.code ?? 'ORIGINAL_MCP_CALL_UNCERTAIN'; await persist();
      }
      current = await read();
    }
    current = await waitFor(async () => {
      const observed = await read(), receipt = observed.receipt;
      need(receipt !== null, 'ORIGINAL_REQUEST_RECEIPT_MISSING',
        'Keep the same native UUID; no new request was substituted for ' + key);
      if (receipt.status === 'complete') return observed;
      if (receipt.status === 'failed') throw failure(receipt.error?.code ?? 'ORIGINAL_OPERATION_FAILED');
      const live = await state(request.args.workspace);
      if (live.native.active?.id === request.args.requestId) return false;
      await call('merchant_nocodb_resume', {
        workspace: request.args.workspace, requestId: request.args.requestId });
      return false;
    }, key, abort.signal);
    assert.equal(current.receipt.id, request.args.requestId);
    request.receipt = current.receipt; request.completedAt = current.receipt.updatedAt; await persist();
    return current.receipt.result;
  }
  async function savedOriginal(key, tool, makeInput, options) {
    const saved = intent.requests[key];
    const input = saved ? (({ requestId, ...rest }) => rest)(saved.args) : await makeInput();
    return original(key, tool, input, options);
  }
  async function ensurePublisher(workspace = 'film') {
    let observed = await state(workspace);
    if (!observed.native.publisher.running) {
      await original('open-publisher-' + host.id + '-' + workspace, 'merchant_nocodb_publisher_open', {
        workspace, expectedSelectedVersion: observed.native.selectedVersion });
      observed = await state(workspace);
    }
    need(observed.native.publisher.running && typeof observed.native.publisher.url === 'string',
      'ORIGINAL_BORROWED_PUBLISHER_REQUIRED');
    return observed.native.publisher;
  }
  async function showSource(label, mobile = false) {
    await closePage();
    const selected = await state();
    page = await context.newPage(); page.on('pageerror', error => browserErrors.push({ label, message: error.message }));
    await page.setViewportSize({ width: mobile ? 390 : 1440, height: mobile ? 844 : 1000 });
    await page.goto(selected.browserUrl); await page.locator('#draft-fields').waitFor();
    await waitFor(() => page.locator('#draft-fields input, #draft-fields select').count(),
      'Original source review fields', abort.signal);
    const shot = join(ctx.output, 'screenshots', label + '.png');
    await page.screenshot({ path: shot, fullPage: true });
    return { ...await remember(shot), sourceVersion: selected.native.selectedVersion,
      draftRevision: selected.native.draftRevision };
  }
  async function originalRows(workspace, edition) {
    const rows = [], seen = new Set(); let cursor = null, snapshot = null, pages = 0;
    do {
      const query = new URLSearchParams({ limit: '250', ...(cursor ? { cursor } : {}) }).toString();
      const response = (await call('merchant_nocodb_publisher_inspect',
        { workspace, runId: edition.runId, query })).native;
      need(response.run.state === 'PUBLISHED', 'ORIGINAL_PUBLICATION_NOT_RETAINED');
      assert.equal(response.run.data.publication.snapshot, edition.snapshot);
      const part = response.preview;
      need(Array.isArray(part.rows), 'ORIGINAL_DATASET_PAGE_REQUIRED');
      snapshot ??= part.dataset.snapshot; assert.equal(part.dataset.snapshot, snapshot);
      rows.push(...part.rows); pages++;
      need(rows.length <= edition.rows && pages <= edition.rows + 1, 'ORIGINAL_PAGE_BOUND_EXCEEDED');
      cursor = part.page.nextCursor;
      if (cursor) { need(!seen.has(cursor), 'ORIGINAL_CURSOR_REPEATED'); seen.add(cursor); }
    } while (cursor);
    assert.equal(snapshot, edition.snapshot); assert.equal(rows.length, edition.rows);
    assert.equal(hash(bytes(rows)), edition.valuesSha256, 'Every original typed value and its complete retained ordering.');
    return { runId: edition.runId, snapshot, rows: rows.length, valuesSha256: hash(bytes(rows)), pages };
  }
  async function download(key, tool, args, { stopAfterOneChunk = false, expectedSha256 } = {}) {
    const path = join(ctx.output, 'downloads', key), temporary = path + '.partial';
    let saved = intent.downloads[key];
    if (!saved) {
      saved = { tool, args, offset: 0, prefixSha256: hash(Buffer.alloc(0)), createdAt: stamp() };
      intent.downloads[key] = saved; await persist();
    }
    assert.equal(saved.tool, tool); assert.deepEqual(saved.args, args);
    if (expectedSha256 && saved.file) assert.equal(saved.file.sha256, expectedSha256);
    const complete = await regular(path, { optional: true });
    if (complete) {
      need(saved.file && complete.length === saved.file.bytes && hash(complete) === saved.file.sha256,
        'RECEIVED_FILE_CHANGED');
      saved.complete = true; saved.offset = complete.length; await persist();
      return { ...await remember(path), originalFile: saved.file, complete: true };
    }
    let fd;
    try {
      fd = await open(temporary, constants.O_CREAT | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0), 0o600);
      const stat = await fd.stat();
      need(stat.isFile() && stat.nlink === 1 && !(stat.mode & 0o077) &&
        stat.uid === process.getuid() && stat.size >= saved.offset, 'RECEIVED_PARTIAL_CHANGED');
      const prefix = createHash('sha256'), buffer = Buffer.alloc(65536);
      for (let position = 0; position < saved.offset;) {
        const read = await fd.read(buffer, 0, Math.min(buffer.length, saved.offset - position), position);
        need(read.bytesRead > 0, 'RECEIVED_PARTIAL_CHANGED');
        prefix.update(buffer.subarray(0, read.bytesRead)); position += read.bytesRead;
      }
      assert.equal(prefix.copy().digest('hex'), saved.prefixSha256);
      // Only this operation's unpublished bytes beyond its durable checkpoint
      // may be removed. The received prefix and all original files are retained.
      if (stat.size > saved.offset) { await fd.truncate(saved.offset); await fd.sync(); }
      let count = 0;
      while (!saved.file || saved.offset < saved.file.bytes) {
        const reply = await call(tool, { ...args, offset: saved.offset,
          limit: stopAfterOneChunk ? 1024 : 65536,
          ...(saved.file ? { expectedSha256: saved.file.sha256 } : expectedSha256 ? { expectedSha256 } : {}),
          ...(saved.readHost === host.id && saved.readId ? { readId: saved.readId } : {}) });
        need(reply.workspace === args.workspace && UUID.test(reply.readId) && plain(reply.file) &&
          HASH.test(reply.file.sha256) && Number.isSafeInteger(reply.file.bytes) &&
          reply.file.bytes > 0 && reply.file.bytes <= MAX_PACKET &&
          reply.offset === saved.offset && reply.encoding === 'base64', 'ORIGINAL_FILE_CHUNK_INVALID');
        if (saved.file) assert.deepEqual(reply.file, saved.file); else saved.file = reply.file;
        if (expectedSha256) assert.equal(reply.file.sha256, expectedSha256);
        const chunk = Buffer.from(reply.data, 'base64');
        need(chunk.toString('base64') === reply.data && chunk.length === reply.bytesRead &&
          chunk.length > 0 && chunk.length <= 65536 && saved.offset + chunk.length <= reply.file.bytes,
          'ORIGINAL_FILE_CHUNK_INVALID');
        const next = saved.offset + chunk.length;
        assert.equal(reply.nextOffset, next < reply.file.bytes ? next : null);
        for (let written = 0; written < chunk.length;) {
          const result = await fd.write(chunk, written, chunk.length - written, saved.offset + written);
          need(result.bytesWritten > 0, 'RECEIVED_FILE_WRITE_FAILED'); written += result.bytesWritten;
        }
        await fd.sync(); prefix.update(chunk);
        saved.offset = next; saved.prefixSha256 = prefix.copy().digest('hex');
        saved.readId = reply.readId; saved.readHost = host.id;
        saved.readIds ??= []; if (!saved.readIds.includes(reply.readId)) saved.readIds.push(reply.readId);
        await persist(); count++;
        if (stopAfterOneChunk && count === 1 && reply.nextOffset !== null)
          return { complete: false, file: temporary, offset: saved.offset,
            sha256: reply.file.sha256, readId: reply.readId, originalFile: reply.file };
      }
      assert.equal(saved.prefixSha256, saved.file.sha256);
      await fd.close(); fd = null; await rename(temporary, path); await syncDirectory(dirname(path));
      saved.complete = true; await persist();
      return { ...await remember(path), originalFile: saved.file, complete: true };
    } finally { await fd?.close(); }
  }
  async function deploymentState() { return (await call('merchant_nocodb_deployment_status', { workspace: 'film', limit: 100 })).native; }
  async function ensureConsole() {
    let current = await deploymentState();
    if (!current.console.running) {
      await original('console-open-' + host.id, 'merchant_nocodb_deployment_console_open', { workspace: 'film' });
      current = await deploymentState();
    }
    need(current.console.running && UUID.test(current.console.instanceId) &&
      current.native?.runtime && current.native?.state, 'ORIGINAL_DEPLOYMENT_CONSOLE_REQUIRED');
    return current;
  }
  async function reconcileCommands() {
    for (const command of intent.commands) {
      const request = intent.requests[command.key];
      if (!request) {
        command.reconciled = { state: 'NOT_DISPATCHED', observedAt: stamp() };
        continue;
      }
      let observed = await call('merchant_nocodb_operation', {
        workspace: 'film', requestId: request.args.requestId });
      if (!observed.receipt) {
        command.reconciled = { state: 'NO_NATIVE_RECEIPT', observedAt: stamp() };
        // A following command gets its own explicit review and UUID after
        // current native state is inspected; this old UUID is not dispatched.
        continue;
      }
      if (['pending', 'interrupted'].includes(observed.receipt.status)) {
        const live = await state();
        need(live.native.active?.id !== request.args.requestId,
          'ORIGINAL_DEPLOYMENT_COMMAND_STILL_RUNNING');
        await call('merchant_nocodb_resume', { workspace: 'film', requestId: request.args.requestId });
        observed = await call('merchant_nocodb_operation', {
          workspace: 'film', requestId: request.args.requestId });
      }
      need(['complete', 'failed'].includes(observed.receipt.status),
        'ORIGINAL_DEPLOYMENT_COMMAND_UNRESOLVED');
      request.receipt = observed.receipt;
      command.reconciled = { state: observed.receipt.status, observedAt: stamp(),
        mode: observed.receipt.result?.mode ?? null,
        commandReplayed: observed.receipt.result?.commandReplayed ?? false };
    }
    await persist();
  }
  async function command(action, extra = {}) {
    const current = await ensureConsole();
    need(!current.native.console.busy, 'ORIGINAL_CONSOLE_BUSY');
    const args = { workspace: 'film', action, consoleInstanceId: current.console.instanceId,
      expectedGeneration: current.native.state.generation, ...extra };
    const key = 'deployment-command-' + randomUUID();
    intent.commands.push({ key, preparedAt: stamp(), action, consoleInstanceId: current.console.instanceId,
      previousRuntime: current.native.runtime.state, previousInstanceId: current.native.runtime.observed?.instanceId ?? null });
    await persist();
    const receipt = await original(key, 'merchant_nocodb_deployment_command', args);
    const now = await deploymentState();
    intent.commands.find(row => row.key === key).observed = {
      at: stamp(), mode: receipt.mode, actionReplayedByRecovery: receipt.commandReplayed ?? false,
      active: now.native?.state?.active ?? null, generation: now.native?.state?.generation ?? null,
      runtime: now.native?.runtime?.state ?? null, instanceId: now.native?.runtime?.observed?.instanceId ?? null };
    await persist();
    // An uncertain command is recovered by original state observation, never
    // by resubmitting it. Callers below require the actual intended live state.
    return now;
  }
  async function stopMerchant() {
    const current = await ensureConsole();
    if (current.native.runtime.state === 'STOPPED') return current;
    need(current.native.runtime.state === 'RUNNING' && UUID.test(current.native.runtime.observed?.instanceId),
      'ORIGINAL_MERCHANT_OWNERSHIP_NOT_RESOLVED');
    return command('stop', { instanceId: current.native.runtime.observed.instanceId });
  }
  async function activateAndObserve(release, amount, label, rollback = false) {
    let current = await ensureConsole();
    if (current.native.runtime.state !== 'STOPPED') current = await stopMerchant();
    need(current.native.runtime.state === 'STOPPED', 'ORIGINAL_MERCHANT_NOT_STOPPED');
    if (current.native.state.active !== release.id) {
      current = await command(rollback ? 'rollback' : 'activate', {
        expectedDigest: release.digest, ...(rollback ? { to: release.id } : { id: release.id }),
        reason: 'Receive the same reviewed NocoDB edition through the original source-owned MCP deployment.' });
    }
    assert.equal(current.native.state.active, release.id);
    current = await command('run', { expectedDigest: release.digest });
    need(current.native.runtime.state === 'RUNNING', 'ORIGINAL_MERCHANT_NOT_RUNNING');
    const observation = current.native.runtime.observed;
    need(UUID.test(observation.instanceId) && typeof observation.listener === 'string', 'ORIGINAL_MERCHANT_OBSERVATION_REQUIRED');
    const listener = new URL(observation.listener);
    need(listener.protocol === 'http:' && listener.hostname === '127.0.0.1', 'ORIGINAL_LOCAL_MERCHANT_REQUIRED');
    const response = await fetch(listener.origin + basis.template.merchant.path + '?limit=2',
      { redirect: 'error', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]) });
    const body = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 402);
    const encoded = response.headers.get('payment-required');
    const challenge = encoded ? JSON.parse(Buffer.from(encoded, 'base64')) : JSON.parse(body);
    need(Array.isArray(challenge.accepts) && challenge.accepts.some(choice =>
      choice.network === 'stellar:testnet' && choice.asset === basis.template.merchant.payment.asset &&
      choice.payTo === basis.template.merchant.payment.payTo && choice.amount === amount),
      'ORIGINAL_CHALLENGE_TERMS_CHANGED');
    const received = join(ctx.output, 'downloads', label + '-challenge.json');
    await save(received, challenge); const evidence = await remember(received);
    current = await stopMerchant(); need(current.native.runtime.state === 'STOPPED', 'ORIGINAL_MERCHANT_DRAIN_REQUIRED');
    return { releaseId: release.id, digest: release.digest, instanceId: observation.instanceId,
      httpStatus: response.status, challenge: evidence, amount, paymentCalls: 0,
      finalRuntime: current.native.runtime.state };
  }

  let error = null;
  try {
    browser = await chromium.launch({ executablePath: ctx.input.browser.executable, headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    await startHost();
    await stage('original_workspace_and_host_source', async () => {
      const list = await call('merchant_nocodb_workspaces');
      assert.deepEqual(list.workspaces.map(row => row.workspace).sort(), ['actor', 'film']);
      const film = await state(), actor = await state('actor');
      assert.equal(film.native.selectedVersion, basis.intent.authoring.film.version.id);
      assert.equal(actor.native.selectedVersion, basis.intent.authoring.actor.version.id);
      const input = await call('merchant_nocodb_inputs', { workspace: 'film', input: 'captured' });
      assert.equal(input.file.sha256, basis.intent.authoring.film.version.sourceSha256);
      const imported = await savedOriginal('film-import', 'merchant_nocodb_import', async () => ({
        workspace: 'film', input: 'captured', expectedSha256: input.file.sha256,
        title: 'Original NocoDB Film source received by merchant MCP', expectedDraftRevision: (await state()).native.draftRevision }));
      need(imported.draftSaved, 'ORIGINAL_DRAFT_CONFLICT');
      assert.equal(imported.capture.manifestSha256, basis.core.film.captureSha256);
      assert.equal(imported.capture.rowCount, 1000);
      const columns = (await call('merchant_nocodb_columns', { workspace: 'film', captureId: imported.capture.id })).native;
      assert.equal(columns.manifest.rowCount, 1000);
      const actorVersion = (await call('merchant_nocodb_version', {
        workspace: 'actor', versionId: basis.intent.authoring.actor.version.id })).native;
      const actorColumns = (await call('merchant_nocodb_columns', {
        workspace: 'actor', captureId: actorVersion.captureId })).native;
      assert.equal(actorColumns.manifest.rowCount, 200);
      return { filmIdentity: list.workspaces.find(row => row.workspace === 'film').workspaceIdentity,
        actorIdentity: list.workspaces.find(row => row.workspace === 'actor').workspaceIdentity,
        originalVersion: film.native.selectedVersion, importedCaptureId: imported.capture.id,
        originalCaptureSha256: imported.capture.manifestSha256, filmRows: 1000, actorRows: 200,
        draftRevision: imported.draftRevision, capturedFieldIds: columns.fields.map(row => row.id),
        providerReads: 0 };
    });
    const authored = await stage('agent_projection_review_and_saved_version', async () => {
      const draft = await savedOriginal('film-draft', 'merchant_nocodb_draft_save', async () => {
        const current = (await state()).native;
        return { workspace: 'film', draft: { ...current.draft,
          title: 'NocoDB Film: agent-reviewed original merchant source' }, expectedRevision: current.draftRevision };
      });
      const preview = await savedOriginal('film-preview', 'merchant_nocodb_preview', async () => ({
        workspace: 'film', draftRevision: draft.draftRevision }));
      need(preview.complete && preview.allRowsChecked && preview.providerRead === false, 'ORIGINAL_FULL_PREVIEW_REQUIRED');
      const retained = await savedOriginal('film-version', 'merchant_nocodb_version_save', async () => ({
        workspace: 'film', draftRevision: draft.draftRevision, previewId: preview.id,
        reviewer: ctx.input.reviewer,
        note: 'Adopt the complete retained Film capture into the original merchant MCP. Preserve every original field, scalar policy and previously published edition.',
        expectedSelectedVersion: (await state()).native.selectedVersion,
      }), { withholdReply: true });
      assert.equal(retained.version.observationSha256, basis.core.film.captureSha256);
      assert.equal(retained.version.rowCount, 1000);
      const comparison = (await call('merchant_nocodb_compare', { workspace: 'film',
        leftVersion: basis.intent.authoring.film.version.id, rightVersion: retained.version.id })).native;
      need(comparison.sameObservation && comparison.sameSelection && comparison.sameProjection,
        'ORIGINAL_PROVIDER_SELECTION_OR_PROJECTION_CHANGED');
      const screenshot = await showSource('agent-source-review-desktop');
      return { versionId: retained.version.id, sourceSha256: retained.version.sourceSha256,
        observationSha256: retained.version.observationSha256, draftRevision: draft.draftRevision,
        requestId: intent.requests['film-version'].args.requestId,
        lostReplyRecoveredFromOriginalReceipt: true, sameOriginalProjection: true, screenshot };
    });
    await stage('borrowed_original_publisher_and_pinned_buyer', async () => {
      await ensurePublisher('film');
      const before = (await call('merchant_nocodb_publisher_status', { workspace: 'film', limit: 100 })).native;
      const sourceView = (await call('merchant_nocodb_publisher_source', { workspace: 'film' })).native;
      assert.equal(sourceView.hash, authored.sourceSha256);
      assert.equal(sourceView.observation.manifestSha256, basis.core.film.captureSha256);
      const first = await originalRows('film', basis.core.film.first);
      const second = await originalRows('film', basis.core.film.second);
      const recovered = (await call('merchant_nocodb_publisher_recover',
        { workspace: 'film', runId: basis.core.film.second.runId })).native;
      assert.equal(recovered.state, 'PUBLISHED'); assert.equal(recovered.data.publication.snapshot, second.snapshot);
      const selected = (await call('merchant_nocodb_publisher_target', { workspace: 'film' })).native;
      assert.equal(selected.versions.current, second.snapshot);
      const buyer = (await call('merchant_nocodb_publisher_buyer_read', {
        workspace: 'film', runId: first.runId, handoffId: basis.intent.handoffs.filmA.handoffId })).native;
      assert.equal(buyer.configSha256, basis.intent.handoffs.filmA.configSha256);
      assert.equal(hash(Buffer.from(buyer.configText)), buyer.configSha256);
      assert.equal(buyer.configText, basis.intent.handoffs.filmA.configText);
      assert.equal(buyer.snapshot, first.snapshot);
      const buyerPath = join(ctx.output, 'downloads', 'original-film-a-buyer.json');
      await atomic(buyerPath, Buffer.from(buyer.configText)); await remember(buyerPath);
      const after = (await call('merchant_nocodb_publisher_status', { workspace: 'film', limit: 100 })).native;
      assert.deepEqual(after.native.runs.map(row => row.id), before.native.runs.map(row => row.id));
      await ensurePublisher('actor');
      const actor = await originalRows('actor', basis.core.actor);
      return { first, second, actor, originalRunIds: after.native.runs.map(row => row.id),
        samePublisherStore: true, sameSchedulerOwner: true,
        buyer: { handoffId: buyer.handoffId, configSha256: buyer.configSha256, snapshot: buyer.snapshot },
        newExtractions: 0, newPublications: 0, newPayments: 0 };
    });
    await stage('private_packet_restart_boundary', async () => {
      const part = await download('source-packet.json', 'merchant_nocodb_packet_read',
        { workspace: 'film', versionId: authored.versionId }, { stopAfterOneChunk: true });
      need(!part.complete && part.offset > 0, 'ORIGINAL_PACKET_RESTART_BOUNDARY_REQUIRED');
      return { versionId: authored.versionId, sha256: part.sha256, offset: part.offset,
        firstReadId: part.readId, firstHostId: host.id, firstInstanceId: (await state()).instanceId };
    });
    if (intent.stages.private_packet_restart_boundary.firstHostId === host.id) {
      await stopHost(); await startHost();
    }
    await stage('process_reopen_exact_version_and_packet', async () => {
      const boundary = intent.stages.private_packet_restart_boundary, current = await state();
      assert.notEqual(current.instanceId, boundary.firstInstanceId);
      assert.equal(current.native.selectedVersion, authored.versionId);
      assert.equal(current.native.draftRevision, authored.draftRevision);
      const replay = await call('merchant_nocodb_version_save', intent.requests['film-version'].args);
      assert.equal(replay.native.version.id, authored.versionId);
      assert.equal(replay.native.version.sourceSha256, authored.sourceSha256);
      const packet = await download('source-packet.json', 'merchant_nocodb_packet_read',
        { workspace: 'film', versionId: authored.versionId }, { expectedSha256: boundary.sha256 });
      need(packet.complete && intent.downloads['source-packet.json'].readIds.length >= 2,
        'ORIGINAL_PACKET_RESTART_REQUIRED');
      const received = JSON.parse(await regular(packet.file)), checked = validatePacket(received);
      assert.equal(checked.manifestSha256, basis.core.film.captureSha256);
      assert.equal(checked.manifest.rowCount, 1000);
      assert.equal(received.version.id, authored.versionId);
      assert.equal(received.version.sourceSha256, authored.sourceSha256);
      assert.deepEqual(Object.keys(received.source.connection).sort(), ['file', 'kind', 'sha256']);
      const screenshot = await showSource('agent-source-review-mobile', true);
      return { sourceVersion: authored.versionId, receiptReplayedWithoutNewVersion: true,
        originalCaptureSha256: checked.manifestSha256, sourceSha256: authored.sourceSha256,
        packet, firstReadId: boundary.firstReadId,
        readIds: intent.downloads['source-packet.json'].readIds, screenshot,
        originalPublisherClosedWithPriorMcp: current.native.publisher.running === false };
    });
    await ensurePublisher('film');
    await reconcileCommands();
    const packages = await stage('original_source_owned_deployment_packages', async () => {
      const output = {};
      for (const [name, edition, amount] of [
        ['a', basis.core.film.first, basis.template.merchant.payment.amount],
        ['b', basis.core.film.second, basis.template.merchant.nextAmount],
      ]) {
        const terms = { origin: basis.template.merchant.origin, path: basis.template.merchant.path,
          payment: { ...basis.template.merchant.payment, amount } };
        const reviewed = await savedOriginal('deployment-review-' + name, 'merchant_nocodb_deployment_review', async () => ({
          workspace: 'film', versionId: basis.intent.authoring.film.version.id, runId: edition.runId, terms }));
        const prepared = await savedOriginal('deployment-prepare-' + name, 'merchant_nocodb_deployment_prepare', async () => ({
          workspace: 'film', reviewRequestId: intent.requests['deployment-review-' + name].args.requestId,
          expectedReviewSha256: reviewed.reviewSha256 }));
        const packageRequestId = intent.requests['deployment-prepare-' + name].args.requestId;
        const inspected = (await call('merchant_nocodb_deployment_package', { workspace: 'film', packageRequestId })).native;
        assert.equal(prepared.sourceSha256, inspected.sourceSha256);
        assert.equal(prepared.candidateDigest, edition.candidateDigest);
        assert.equal(prepared.files.length, 5);
        const files = [];
        for (const file of prepared.files) {
          const received = await download('deployment-' + name + '-' + file.file,
            'merchant_nocodb_deployment_file_read', { workspace: 'film', packageRequestId, file: file.file },
            { expectedSha256: file.sha256 });
          assert.equal(received.bytes, file.bytes); files.push(received);
        }
        const staged = await savedOriginal('deployment-stage-' + name, 'merchant_nocodb_deployment_stage', async () => ({
          workspace: 'film', packageRequestId, expectedSourceSha256: prepared.sourceSha256,
          id: 'nocodb-mcp-' + name, label: 'Original NocoDB MCP edition ' + name.toUpperCase(), runtime: { port: 0 },
        }));
        need(staged.release && typeof staged.release.id === 'string' && HASH.test(staged.release.digest),
          'ORIGINAL_STAGED_RELEASE_REQUIRED');
        output[name] = { runId: edition.runId, snapshot: edition.snapshot, amount,
          reviewRequestId: intent.requests['deployment-review-' + name].args.requestId, packageRequestId,
          reviewSha256: reviewed.reviewSha256, sourceSha256: prepared.sourceSha256,
          candidateDigest: prepared.candidateDigest, release: staged.release, files };
      }
      return output;
    });
    await stage('managed_activate_run_compare_and_rollback', async () => {
      const first = await stage('deployment_a_received', () => activateAndObserve(packages.a.release, packages.a.amount, 'mcp-a'));
      const second = await stage('deployment_b_received', () => activateAndObserve(packages.b.release, packages.b.amount, 'mcp-b'));
      const comparison = (await call('merchant_nocodb_deployment_compare', {
        workspace: 'film', from: packages.a.release.id, to: packages.b.release.id })).native;
      const comparisonFile = join(ctx.output, 'downloads', 'original-deployment-comparison.json');
      await save(comparisonFile, comparison); await remember(comparisonFile);
      const rollback = await stage('deployment_rollback_received', () => activateAndObserve(packages.a.release, packages.a.amount, 'mcp-rollback', true));
      const deployment = await ensureConsole();
      await closePage(); page = await context.newPage();
      page.on('pageerror', issue => browserErrors.push({ label: 'original-release-console', message: issue.message }));
      await page.goto(deployment.console.url); await page.locator('body').waitFor();
      const shot = join(ctx.output, 'screenshots', 'original-managed-deployment.png');
      await page.screenshot({ path: shot, fullPage: true }); await remember(shot);
      return { first, second, rollback, comparison: await fileIdentity(comparisonFile),
        sourceVersionForPublications: basis.intent.authoring.film.version.id,
        selectedReviewedSourceVersion: authored.versionId, consoleInstanceId: deployment.console.instanceId,
        originalRequests: intent.commands.map(row => intent.requests[row.key].args.requestId),
        finalActiveRelease: packages.a.release.id, finalRuntime: 'STOPPED', additionalPayments: 0 };
    });
    await stopHost();
    await startHost();
    await stage('final_reopen_and_original_artifact_preservation', async () => {
      const current = await state();
      assert.equal(current.native.selectedVersion, authored.versionId);
      need(!current.native.publisher.running && !current.native.deployment.running,
        'ORIGINAL_MCP_OWNERS_DID_NOT_CLOSE');
      const deployment = await ensureConsole();
      assert.equal(deployment.native.state.active, packages.a.release.id);
      assert.equal(deployment.native.runtime.state, 'STOPPED');
      await ensurePublisher();
      const target = (await call('merchant_nocodb_publisher_target', { workspace: 'film' })).native;
      assert.equal(target.versions.current, basis.core.film.second.snapshot);
      const run = (await call('merchant_nocodb_publisher_inspect', {
        workspace: 'film', runId: basis.core.film.second.runId, query: 'limit=2' })).native.run;
      assert.equal(run.state, 'PUBLISHED'); assert.equal(run.data.publication.snapshot, basis.core.film.second.snapshot);
      const receipt = await call('merchant_nocodb_operation', {
        workspace: 'film', requestId: authored.requestId });
      assert.equal(receipt.receipt.status, 'complete'); assert.equal(receipt.receipt.result.version.id, authored.versionId);
      await assertUnchanged(basis.identities);
      return { selectedSourceVersion: authored.versionId, originalPublisherSnapshot: target.versions.current,
        activeRelease: deployment.native.state.active, generation: deployment.native.state.generation,
        merchantState: deployment.native.runtime.state, sourceReceiptStatus: receipt.receipt.status,
        originalCompletedResultSha256: ctx.input.completedOperation.resultSha256,
        originalPaymentCount: basis.completed.payment.completedPayments,
        originalAmountAtomic: basis.completed.payment.actualTotalAtomic,
        originalPaidValuesSha256: basis.completed.payment.valuesSha256,
        originalArtifactsUnchanged: basis.identities.length, additionalProviderReads: 0, additionalPayments: 0 };
    });
  } catch (issue) { error = issue; }
  finally {
    const cleanup = [];
    try { await stopHost(); } catch (issue) { cleanup.push({ owner: 'original-mcp', code: issue.code ?? 'DRAIN_FAILED' }); error ??= issue; }
    try { await context?.close(); await browser?.close(); } catch (issue) { cleanup.push({ owner: 'browser', code: issue.code ?? 'CLOSE_FAILED' }); error ??= issue; }
    process.off('SIGTERM', interrupt); process.off('SIGINT', interrupt);
    intent.lastCleanup = { at: stamp(), errors: cleanup, retainedChildLease: Boolean(host && !host.closed()) };
    await persist();
  }
  if (browserErrors.length) error ??= failure('ORIGINAL_BROWSER_ERROR', 'Inspect retained browserErrors.');
  try { await assertUnchanged(basis.identities); } catch (issue) { error ??= issue; }
  // Include files retained by a prior completed stage after a caller restart.
  for (const stage of Object.values(intent.stages)) {
    const visit = async value => {
      if (!value || typeof value !== 'object') return;
      if (typeof value.file === 'string' && HASH.test(value.sha256 ?? '') && within(ctx.output, value.file)) {
        const info = await fileIdentity(value.file); assert.equal(info.sha256, value.sha256);
        completedFiles.set(value.file, info);
      }
      for (const child of Object.values(value)) if (child && typeof child === 'object') await visit(child);
    };
    await visit(stage);
  }
  const result = { schema: 'stellar-forge.nocodb-mcp-receiving-result.v1', operationId: ctx.input.operationId,
    inputSha256: ctx.inputSha256, consumerSha256: ctx.input.consumerSha256, source,
    state: error ? 'NOT_COMPLETE' : 'PASS', observedAt: stamp(),
    originalCompletedResultSha256: ctx.input.completedOperation.resultSha256,
    stages: intent.stages, nativeRequests: Object.values(intent.requests).map(row => ({
      tool: row.tool, requestId: row.args.requestId, status: row.receipt?.status ?? 'unresolved',
      replyWithheld: Boolean(row.replyWithheld) })),
    originalHosts: intent.hosts, cleanup: intent.lastCleanup, browserErrors,
    completedFiles: [...completedFiles.values()], additionalProviderReads: 0, additionalPayments: 0,
    ...(error ? { error: { code: error.code ?? 'NOCODB_MCP_RECEIVING_FAILED',
      message: String(error.message).replace(/S[A-Z2-7]{55}/g, '[private signing key]') } } : {}) };
  await save(join(ctx.output, 'result.json'), result);
  console.log(JSON.stringify({ state: result.state, operationId: ctx.input.operationId,
    result: join(ctx.output, 'result.json'), resultSha256: hash(bytes(result)),
    stages: Object.keys(intent.stages).length, additionalProviderReads: 0, additionalPayments: 0 }));
  if (error) throw error;
}

const args = process.argv.slice(2);
try {
  need(args.length === 2 && ['--input', '--locked-input'].includes(args[0]), 'USAGE',
    'node mcp-authoring-consumer.mjs --input /absolute/private/mcp-receiving-input.json');
  process.umask(0o077);
  const ctx = await loadInput(args[1]);
  if (args[0] === '--input') {
    const child = await subprocess(ctx.input.python, ['-I', '-B', '-c', PYTHON_LEASE,
      join(ctx.completed, 'operation.lock'), process.execPath, SELF, ctx.inputFile], { stdio: 'inherit', env: process.env });
    process.exitCode = child.code ?? 2;
  } else await execute(ctx);
} catch (error) {
  console.error(JSON.stringify({ state: 'NOT_COMPLETE', code: error.code ?? 'NOCODB_MCP_RECEIVING_FAILED',
    message: String(error.message).replace(/S[A-Z2-7]{55}/g, '[private signing key]'),
    continuation: 'Preserve the same input, original operation lock, request UUIDs and private mcp-authoring directory. Native operation/resume observes uncertain commands before any following reviewed launch.' }));
  process.exitCode = 2;
}
