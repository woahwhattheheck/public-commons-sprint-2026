#!/usr/bin/env node
// MIT. Receive the already accepted OGC project through one installed original runtime.
import { constants } from 'node:fs';
import { open, readFile, mkdir, lstat, realpath, link, unlink, readdir } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { inspectRuntimeInstall, runtimeCommand } from '../../../distribution/runtime-install.mjs';
import { initializeEdrMerchant } from '../mcp-setup.mjs';
import { MerchantEdrWorkspaces } from '../mcp.mjs';
import { readMerchantConfig } from '../../../../../stellar-forge/mcp-merchant-operator/config.mjs';
import { edrStartup } from '../application-provider.mjs';

const ROOT = 'stellar/scf-starforge-20261009/sf30-seller-sdk/edr/';
const SELF = ROOT + 'delivery/installed-receive.mjs';
const OPERATION = 'SCF-EDR-COVERAGEJSON-F1CB-20261013';
const NATIVE_RESULT = ROOT + 'examples/icoads-native-result.json';
const REFERENCES = [
  { name:'point', stem:'icoads-sst-position', rowCount:12,
    source:'4332c5faf5e6336598c7cdb5042cc945d5b963f4aa0380dcfa9ac3067804b787',
    plan:'bc1a991cb568ca46f5499035c55bac23a57bf80aa44a92a491aea10120c98493',
    build:'14342395a2d9e5b61eab87a89f7c2183e9a62ba089697aa6afa67493892c9500' },
  { name:'cube', stem:'icoads-sst-airt-cube', rowCount:54,
    source:'2d24e2c8e9c4ac481c73bfaca45eff90f58b0abf23dcc8d65b9b176c4451d43c',
    plan:'69fbbd49433e91d593b67abadb97fce2537e15b981bea0ff60dd2736d29fc4ff',
    build:'79e7bdaaac8e17c8627f4ce3fe6b4c8cda581eb12c4e75f0ea45bbb1f807a550' }
];
const collections = ['sources','plans','builds','comparisons','connections','queries','documents','operations'];
const sha = data => createHash('sha256').update(data).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object')
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const same = (left, right) => canonical(left) === canonical(right);
const need = (condition, message) => { if (!condition) throw new Error(message); };
const exists = async path => lstat(path).then(() => true, error => {
  if (error.code === 'ENOENT') return false; throw error;
});
async function regular(path, maximum = 32 * 1024 * 1024) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    need(before.isFile() && before.size <= BigInt(maximum), 'Expected a bounded original regular file: ' + path);
    const bytes = await handle.readFile(), after = await handle.stat({ bigint: true });
    need(BigInt(bytes.length) === before.size && before.size === after.size &&
      before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs, 'Original file changed while read: ' + path);
    return bytes;
  } finally { await handle.close(); }
}
async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() && await realpath(path) === path &&
    !(info.mode & 0o077) && (process.getuid === undefined || info.uid === process.getuid()),
  'Use a private directory owned by this original operation: ' + path);
  return path;
}
async function retain(path, bytes) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  if (await exists(path)) { need((await regular(path)).equals(bytes), 'Preserve differing retained output: ' + path); return; }
  const temporary = join(dirname(path), '.receiving-' + randomUUID());
  const out = await open(temporary, 'wx', 0o600);
  try {
    await out.writeFile(bytes); await out.sync(); await out.close();
    try { await link(temporary, path); }
    catch (error) { if (error.code !== 'EEXIST') throw error; need((await regular(path)).equals(bytes), 'Concurrent receiving output differs.'); }
    const directory = await open(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY);
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await out.close().catch(() => {}); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
async function lease(directory) {
  const path = join(directory, 'installed-receive.lock');
  const handle = await open(path, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    const actual = await handle.stat(), named = await lstat(path);
    need(actual.isFile() && actual.nlink === 1 && !(actual.mode & 0o077) &&
      actual.dev === named.dev && actual.ino === named.ino, 'Original receiving lock differs.');
    const result = spawnSync('flock', ['--exclusive','--nonblock','--conflict-exit-code','75','3'],
      { stdio: ['ignore','ignore','ignore',handle.fd], timeout: 5000 });
    need(!result.error && result.status === 0, 'The original installed receiver is already active or flock is unavailable.');
    return handle;
  } catch (error) { await handle.close(); throw error; }
}
function argumentsFor(values) {
  const allowed = ['--runtime','--work-dir','--point-project','--cube-project','--native-result',
    '--merchant-reference','--merchant-payment','--merchant-origin',
    '--buyer-seller','--buyer-intent','--buyer-accept-index','--buyer-offer-sha'];
  const out = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    need(allowed.includes(key) && !Object.hasOwn(out,key) && typeof values[index + 1] === 'string' &&
      values[index + 1] && !values[index + 1].startsWith('--'), 'Use each documented option once with its value.');
    out[key] = values[index + 1];
  }
  need(out['--runtime'] && out['--work-dir'], '--runtime and --work-dir are required.');
  const merchant = ['--merchant-reference','--merchant-payment','--merchant-origin'].filter(key => out[key]);
  need(!merchant.length || merchant.length === 3, 'Select one reference, public payment terms and seller origin together.');
  if (out['--merchant-reference']) need(REFERENCES.some(value => value.name === out['--merchant-reference']),
    'Select the original point or cube edition for merchant preparation.');
  need(!out['--buyer-seller'] || out['--merchant-payment'], 'Select public merchant terms before reading its original buyer offer.');
  const draft = ['--buyer-intent','--buyer-accept-index','--buyer-offer-sha'].filter(key => out[key]);
  need(!draft.length || draft.length === 3 && out['--buyer-seller'], 'Buyer preparation requires the original seller, intent, offer SHA and acceptance index.');
  if (out['--buyer-accept-index']) need(/^(0|[1-9]\d*)$/.test(out['--buyer-accept-index']) &&
    Number.isSafeInteger(Number(out['--buyer-accept-index'])), 'Use the original displayed zero-based payment alternative.');
  if (out['--buyer-offer-sha']) need(/^[0-9a-f]{64}$/.test(out['--buyer-offer-sha']), 'Use the original displayed offer SHA256.');
  return out;
}
async function command(command, args, { cwd, env, maximum = 32 * 1024 * 1024, timeout = 180000 } = {}) {
  return new Promise(resolveRun => {
    const child = spawn(command, args, { cwd, env: env ?? process.env, shell: false,
      stdio: ['ignore','pipe','pipe'], detached: process.platform !== 'win32' });
    const output = [], errors = []; let size = 0, errorSize = 0, failure, escalator;
    const signal = kind => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
      try { if (process.platform !== 'win32') process.kill(-child.pid, kind); else child.kill(kind); } catch {}
    };
    const stop = message => { if (!failure) failure = new Error(message); signal('SIGTERM');
      escalator ??= setTimeout(() => signal('SIGKILL'), 5000); };
    const timer = setTimeout(() => stop('The original installed command did not finish before its retained timeout.'), timeout);
    child.stdout.on('data', chunk => { size += chunk.length; if (size > maximum) stop('Original command output exceeded its complete-response limit.'); else output.push(chunk); });
    child.stderr.on('data', chunk => { errorSize += chunk.length; if (errorSize <= 1024 * 1024) errors.push(chunk); else stop('Original command stderr exceeded its retained limit.'); });
    child.once('error', error => { failure = error; });
    child.once('close', (code, childSignal) => {
      clearTimeout(timer); clearTimeout(escalator);
      const result = { code, signal: childSignal, stdout: Buffer.concat(output), stderr: Buffer.concat(errors),
        ...(failure ? { failure: { name: failure.name, message: failure.message } } : {}) };
      resolveRun(result);
    });
  });
}
async function stopServer(server) {
  if (!server || server.exited || !server.child.pid || server.child.exitCode !== null || server.child.signalCode !== null) return server?.closed;
  server.child.kill('SIGINT');
  let closed = await Promise.race([server.closed, pause(20000).then(() => null)]);
  if (!closed) { try { process.kill(-server.child.pid, 'SIGTERM'); } catch {}
    closed = await Promise.race([server.closed, pause(5000).then(() => null)]); }
  if (!closed) { try { process.kill(-server.child.pid, 'SIGKILL'); } catch {} closed = await server.closed; }
  return closed;
}
async function startOperator(runtime, workspace, connectionFile, privateRoot) {
  const specification = await runtimeCommand({ directory: runtime,
    args: ['edr','--workspace',workspace,'serve','--host','127.0.0.1','--port','0','--connection-file',connectionFile] });
  const stdout = await open(join(privateRoot,'operator.stdout'), 'wx', 0o600);
  const stderr = await open(join(privateRoot,'operator.stderr'), 'wx', 0o600);
  let child, server;
  try {
    child = spawn(specification.executable, specification.args, { cwd: specification.cwd, shell: false,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', SF30_XML_NODE: process.execPath },
      stdio: ['ignore',stdout.fd,stderr.fd], detached: true });
    const closed = new Promise(resolveClose => {
      child.once('error', error => resolveClose({ error: { name:error.name, message:error.message } }));
      child.once('close', (code, signal) => resolveClose({ code, signal }));
    });
    server = { child, closed, exited:false };
    closed.then(() => { server.exited = true; });
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const ended = await Promise.race([closed, pause(100).then(() => null)]);
      if (ended) throw new Error('The original installed operator exited before its startup record: ' + JSON.stringify(ended));
      if (await exists(connectionFile)) {
        const ready = JSON.parse(await regular(connectionFile, 65536));
        need(ready.schema === 'stellar-forge.edr-workspace-startup.v1' &&
          ready.workspace === workspace && ready.state === 'LISTENING', 'Installed startup selected another workspace.');
        server.ready = ready;
        return server;
      }
    }
    throw new Error('The original installed operator did not publish its private startup record.');
  } catch (error) { await stopServer(server); throw error; }
  finally { await stdout.close(); await stderr.close(); }
}
function checkBuild(build, expected) {
  need(build?.id === expected.id && build.source === expected.source && build.plan === expected.plan &&
    build.rowCount === expected.rowCount && build.native?.snapshot === expected.native.snapshot &&
    same(build.files, expected.files) && same(build.keys,expected.keys), 'Installed native build differs from the accepted project.');
}
function checkQuery(value, expected) {
  need(value?.response?.status === 200 && value.dataset?.snapshot === expected.native.snapshot,
    'Installed native query returned another status or snapshot.');
  const body = value.response.body;
  need(Array.isArray(body?.rows) && Array.isArray(body.fields), 'Original native query body is incomplete.');
  return body;
}
async function traverse(read, build, expected) {
  const rows = []; let next, pages = 0, fields; const seen = new Set(), ordered = createHash('sha256');
  need(expected && expected.rows === build.rowCount && expected.snapshot === build.native.snapshot &&
    /^[0-9a-f]{64}$/.test(expected.orderedRowsSha256) &&
    Array.isArray(expected.fields) && Array.isArray(expected.first?.rows) &&
    same(expected.fields,expected.first.fields), 'The accepted complete native traversal is required.');
  for (;;) {
    const value = await read({ limit:'5', ...(next ? { cursor:next } : {}) });
    const body = checkQuery(value, build);
    if (!fields) fields = body.fields; else need(same(fields,body.fields), 'Original query fields changed between cursors.');
    for (const row of body.rows) { ordered.update(Buffer.from(canonical(row) + '\n','utf8')); rows.push(row); }
    pages++;
    need(rows.length <= build.rowCount && pages <= build.rowCount + 1, 'Original native cursor exceeded its accepted row count.');
    next = body.page?.nextCursor;
    if (!next) break;
    need(typeof next === 'string' && !seen.has(next) && body.rows.length > 0, 'Original native cursor repeated or failed to advance.'); seen.add(next);
  }
  const orderedRowsSha256 = ordered.digest('hex');
  need(rows.length === build.rowCount && same(fields,expected.fields) &&
    same(rows.slice(0,expected.first.rows.length),expected.first.rows) &&
    orderedRowsSha256 === expected.orderedRowsSha256 && (build.rowCount <= 5 || pages > 1),
    'Installed traversal differs from the accepted complete ordered cell projection.');
  return { snapshot:build.native.snapshot, pages, rowCount:rows.length, fields, rows, orderedRowsSha256 };
}
async function zipContents(python, path) {
  const source = "import sys,zipfile,json,hashlib,stat\nwith zipfile.ZipFile(sys.argv[1]) as z:\n infos=z.infolist()\n assert len(infos)==len({i.filename for i in infos}) and sum(i.file_size for i in infos)<=8388608\n out={}\n for i in infos:\n  assert i.filename==i.orig_filename and not i.is_dir() and not i.flag_bits&1 and stat.S_ISREG(i.external_attr>>16) and not i.filename.startswith('/') and '..' not in i.filename.split('/') and '\\\\' not in i.filename\n  b=z.read(i);out[i.filename]={'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}\n  if i.filename=='edr-lineage.json':out[i.filename]['value']=json.loads(b)\n print(json.dumps(out))\n";
  const value = await command(python, ['-B','-c',source,path], { maximum:1024 * 1024, timeout:30000 });
  need(value.code === 0 && !value.failure, 'Original received dataset ZIP could not be inspected: ' + value.stderr.toString('utf8'));
  return JSON.parse(value.stdout);
}
async function receiveFile(family, selection, directory, filename, expected) {
  const destination = join(directory,filename), chunks = []; let readId, offset = 0, first;
  try {
    for (;;) {
      const value = await family.call('merchant_edr_file_read', { workspace:'received', ...selection,
        ...(expected?.sha256 || first?.sha256 ? { expectedSha256:expected?.sha256 ?? first.sha256 } : {}),
        ...(readId ? { readId } : {}), offset, limit:2048 });
      need(value.encoding === 'base64' && typeof value.data === 'string' && value.offset === offset,
        'Original retained-file chunk has another offset or encoding.');
      const bytes = Buffer.from(value.data,'base64');
      need(bytes.toString('base64') === value.data && bytes.length === value.bytesRead, 'Original retained-file chunk is incomplete.');
      if (!first) first = value.file;
      need(same(first,value.file) && (!readId || readId === value.readId) &&
        Number.isSafeInteger(first.bytes) && first.bytes >= 0 && first.bytes <= 8 * 1024 * 1024,
        'Original retained-file identity changed between chunks.');
      readId = value.readId; chunks.push(bytes); offset += bytes.length;
      need(offset <= first.bytes && (value.nextOffset === null ? offset === first.bytes : value.nextOffset === offset && bytes.length > 0),
        'Original retained-file continuation did not match the exact length.');
      if (value.nextOffset === null) break;
    }
    const body = Buffer.concat(chunks);
    need(body.length === first.bytes && sha(body) === first.sha256 &&
      (!expected || body.length === expected.bytes && sha(body) === expected.sha256),
      'Complete installed file differs from its original bytes.');
    await retain(destination,body);
    return { file:destination, name:first.name, contentType:first.contentType, bytes:body.length, sha256:sha(body) };
  } finally { if (readId) await family.call('merchant_edr_file_release',{workspace:'received',readId}).catch(() => {}); }
}
function inputIdentity(file) { return { bytes:file.bytes, sha256:file.sha256 }; }
function referenceIdentity(context) {
  const { name, reference, build, project, capture } = context;
  return {
    name, source:build.source, plan:build.plan, build:build.id, snapshot:build.native.snapshot,
    rowCount:build.rowCount, packet:inputIdentity(project), capture:inputIdentity(capture),
    orderedRowsSha256:reference.traversal.orderedRowsSha256, fields:reference.traversal.fields,
    coverage:reference.coverage, selection:reference.selection, sourceIssues:reference.sourceIssues,
    schemaIdentityPolicy:reference.schemaIdentityPolicy, valuePolicy:reference.valuePolicy,
    rights:reference.rights, duplicatePolicy:reference.duplicatePolicy
  };
}
export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') {
    console.log('installed-receive --runtime READY_ORIGINAL_RUNTIME --work-dir ORIGINAL_OP/installed-receiving [--point-project EXACT_POINT.edr.zip] [--cube-project EXACT_CUBE.edr.zip] [--native-result EXACT_NATIVE_RESULT.json] [--merchant-reference point|cube --merchant-payment PUBLIC_TERMS.json --merchant-origin HTTPS_ORIGIN] [--buyer-seller ORIGINAL_SELLER_URL [--buyer-intent ID --buyer-accept-index INDEX --buyer-offer-sha SHA256]]');
    return;
  }
  const args = argumentsFor(argv), runtime = await realpath(resolve(args['--runtime']));
  const work = await privateDirectory(resolve(args['--work-dir'])), held = await lease(work);
  let family, server, generation, publicFiles = [], selectedSource, attempt;
  const record = async (name, value) => {
    const file = join(generation,name), bytes = Buffer.isBuffer(value) ? value : json(value);
    await retain(file,bytes); publicFiles.push({ path:relative(work,file), bytes:bytes.length, sha256:sha(bytes) });
    return value;
  };
  try {
    const installed = await inspectRuntimeInstall({ directory:runtime,load:true,source:true });
    need(installed.status === 'READY' && installed.ready && installed.sourceVerified, 'Finish the original runtime installation before receiving.');
    need(await realpath(fileURLToPath(import.meta.url)) === await realpath(join(installed.sourceRoot,SELF)),
      'Run this receiving helper from the selected installed package.');
    const packageRoot = dirname(installed.sourceRoot);
    selectedSource = JSON.parse(await regular(join(packageRoot,'manifest.json')));
    need(selectedSource.schema === 'stellar-forge.merchant-distribution-manifest.v1' &&
      selectedSource.sourceSelection?.id === 'edr' && selectedSource.sourceCommit === installed.sourceCommit,
      'The installed source is not this exact EDR selection.');
    const entries = selectedSource.files;
    need(Array.isArray(entries), 'The complete selected source inventory is required.');
    const selectedEntry = path => {
      const matches = entries.filter(item => item.path === path);
      need(matches.length === 1 && Number.isSafeInteger(matches[0].bytes) && matches[0].bytes >= 0 &&
        /^[0-9a-f]{64}$/.test(matches[0].sha256), 'The exact selected input is missing or duplicated: ' + path);
      return matches[0];
    };
    const helperEntry = selectedEntry(SELF), helperBytes = await regular(fileURLToPath(import.meta.url));
    need(helperEntry.sha256 === sha(helperBytes) && helperEntry.bytes === helperBytes.length,
      'The installed original receiver differs from its source manifest.');
    const selectedInput = async (path, override) => {
      const identity = selectedEntry(path), file = await realpath(resolve(override ?? join(installed.sourceRoot,path)));
      const bytes = await regular(file);
      need(bytes.length === identity.bytes && sha(bytes) === identity.sha256,
        'The accepted bundled input differs from its complete selected source identity: ' + path);
      return { path, file, bytes:bytes.length, sha256:sha(bytes), body:bytes };
    };
    const native = await selectedInput(NATIVE_RESULT,args['--native-result']);
    const accepted = JSON.parse(native.body);
    need(accepted.schema === 'stellar-forge.edr-native-receiving.v1' && accepted.operationId === OPERATION &&
      accepted.status === 'EDR_NATIVE_RECEIVING_COMPLETE' && accepted.coveragePolicy === 'require-exhausted' &&
      Array.isArray(accepted.sources) && accepted.sources.length === REFERENCES.length &&
      Array.isArray(accepted.receiving) && Array.isArray(accepted.coldReopen),
      'The complete accepted original EDR producer and independent receiver result is required.');
    const contexts = [];
    for (const definition of REFERENCES) {
      const matches = accepted.sources.filter(value => value.build?.id === definition.build);
      need(matches.length === 1, 'The accepted native reference is missing or duplicated: ' + definition.name);
      const reference = matches[0], build = reference.build;
      need(reference.source === definition.source && reference.plan === definition.plan &&
        build.source === definition.source && build.plan === definition.plan && build.rowCount === definition.rowCount &&
        reference.coveragePolicy === 'require-exhausted' && reference.coverage.status === 'exhausted' &&
        reference.coverage.scope === 'selected-query-response',
        'The original EDR source, mapping, cell count or selected-query coverage differs: ' + definition.name);
      const project = await selectedInput(ROOT+'examples/'+definition.stem+'.edr.zip',args['--'+definition.name+'-project']);
      const capture = await selectedInput(ROOT+'examples/'+definition.stem+'.edr');
      need(project.bytes === reference.packet.bytes && project.sha256 === reference.packet.sha256 &&
        capture.sha256 === definition.source && capture.bytes === reference.sourceBytes,
        'The original accepted source/project bytes differ: ' + definition.name);
      need(reference.traversal.rows === definition.rowCount && reference.traversal.snapshot === build.native.snapshot &&
        /^[0-9a-f]{64}$/.test(reference.traversal.orderedRowsSha256) && Array.isArray(reference.traversal.fields) &&
        Array.isArray(reference.traversal.first?.rows) && reference.traversal.first.rows.length === 1,
        'The complete original native traversal is required: ' + definition.name);
      contexts.push({ ...definition, reference, build, project, capture });
    }
    const expectedReferences = contexts.map(referenceIdentity);
    const paymentBytes = args['--merchant-payment'] ? await regular(await realpath(resolve(args['--merchant-payment'])),16384) : null;
    if (paymentBytes) JSON.parse(paymentBytes);
    const intent = {
      schema:'stellar-forge.edr-installed-receiving-intent.v1', operationId:OPERATION,
      sourceCommit:installed.sourceCommit, installationId:installed.installationId, profileId:installed.profileId,
      nativeResult:inputIdentity(native), references:expectedReferences, workspace:join(work,'workspace'),
      merchant:paymentBytes ? { reference:args['--merchant-reference'], paymentSha256:sha(paymentBytes), origin:args['--merchant-origin'] } : null,
      buyer:args['--buyer-seller'] ? { seller:args['--buyer-seller'],intent:args['--buyer-intent'] ?? null,
        acceptIndex:args['--buyer-accept-index'] ?? null,offerSha256:args['--buyer-offer-sha'] ?? null } : null
    };
    await retain(join(work,'intent.json'),json(intent));
    const generations = join(work,'generations'); await privateDirectory(generations);
    const sequence = (await readdir(generations)).filter(name => /^attempt-[0-9]{6}$/.test(name)).map(name => Number(name.slice(8)));
    const latest = sequence.reduce((maximum,value) => Math.max(maximum,value),0);
    if (latest) {
      const originalGeneration = 'generations/attempt-'+String(latest).padStart(6,'0');
      const originalRoot = join(work,originalGeneration), originalResult = join(originalRoot,'result.json');
      need(await realpath(originalRoot) === originalRoot, 'Preserve the linked original receiving history.');
      if (await exists(originalResult)) {
        const prior = JSON.parse(await regular(originalResult));
        if (prior.status === 'INSTALLED_RECEIVING_COMPLETE') {
          const priorAttempt = JSON.parse(await regular(join(originalRoot,'attempt.json')));
          need(priorAttempt.schema === 'stellar-forge.edr-installed-receiving-attempt.v1' &&
            priorAttempt.operationId === OPERATION && priorAttempt.generation === originalGeneration &&
            priorAttempt.sourceCommit === installed.sourceCommit && priorAttempt.inputSha256 === sha(json(intent)) &&
            same(priorAttempt.helper,{bytes:helperBytes.length,sha256:sha(helperBytes)}),
            'The completed original attempt belongs to different input, source or receiver bytes.');
          need(prior.schema === 'stellar-forge.edr-installed-receiving.v1' &&
            prior.operationId === OPERATION && prior.generation === originalGeneration &&
            prior.sourceCommit === installed.sourceCommit && prior.sourceSelection === 'edr' &&
            prior.installationId === installed.installationId && prior.profileId === installed.profileId &&
            same(prior.nativeResult,inputIdentity(native)) && same(prior.references,expectedReferences) &&
            prior.rowCount === 66 && prior.nativeCli === true && prior.applicationsBinding === true &&
            prior.mcpReceiving === true && prior.closedReopen === true && Array.isArray(prior.files),
            'The completed original receiving identity is incomplete or differs.');
          const retainedNames = new Set();
          for (const file of prior.files) {
            need(file && typeof file.path === 'string' && file.path.startsWith(originalGeneration+'/') &&
              !/[\\\u0000-\u001f\u007f]/.test(file.path) &&
              file.path.split('/').every(part => part && part !== '.' && part !== '..') &&
              !file.path.split('/').includes('private') && !retainedNames.has(file.path) &&
              Number.isSafeInteger(file.bytes) && file.bytes >= 0 && /^[a-f0-9]{64}$/.test(file.sha256),
              'Preserve the incomplete or conflicting original public output inventory.');
            const path = join(work,file.path);
            need(await realpath(path) === path, 'Preserve a linked original receiving output.');
            const bytes = await regular(path);
            need(bytes.length === file.bytes && sha(bytes) === file.sha256,
              'A completed original receiving output differs: '+file.path);
            retainedNames.add(file.path);
          }
          const required = ['attempt.json','installation.json','accepted-native-result.json',
            'merchant.json','buyer.json','operator.json','operator-close.json','mcp-setup.json'];
          for (const context of contexts) {
            for (const suffix of ['project.zip','capture.edr','native.json'])
              required.push('accepted-'+context.name+'-'+suffix);
            for (const prefix of ['cli-traversal-','mcp-traversal-','mcp-downloads-','closed-reopen-traversal-'])
              required.push(prefix+context.name+'.json');
          }
          for (const collection of collections) required.push('mcp-records-'+collection+'.json');
          for (const name of required)
            need(retainedNames.has(originalGeneration+'/'+name), 'The completed original receiving inventory omits '+name);
          need(same(prior.merchant,JSON.parse(await regular(join(originalRoot,'merchant.json')))) &&
            same(prior.buyer,JSON.parse(await regular(join(originalRoot,'buyer.json')))),
            'The completed original merchant or buyer stage differs from its retained result.');
          console.log(JSON.stringify({status:prior.status,operationId:prior.operationId,result:originalResult,
            references:prior.references,rowCount:prior.rowCount,merchant:prior.merchant.state,buyer:prior.buyer.state,recovered:true},null,2));
          return prior;
        }
      }
    }
    const number = latest + 1;
    need(number < 1000000,'Preserve this original receiving history before selecting another generation.');
    generation = join(generations,'attempt-'+String(number).padStart(6,'0')); await mkdir(generation,{mode:0o700});
    const privateRoot = await privateDirectory(join(generation,'private'));
    attempt = { schema:'stellar-forge.edr-installed-receiving-attempt.v1',operationId:OPERATION,
      startedAt:new Date().toISOString(),sourceCommit:installed.sourceCommit,helper:{bytes:helperBytes.length,sha256:sha(helperBytes)},
      inputSha256:sha(json(intent)),generation:relative(work,generation) };
    await record('attempt.json',attempt); await record('installation.json',installed);
    await record('accepted-native-result.json',native.body);
    for (const context of contexts) {
      await record('accepted-'+context.name+'-project.zip',context.project.body);
      await record('accepted-'+context.name+'-capture.edr',context.capture.body);
      await record('accepted-'+context.name+'-native.json',context.reference);
    }
    const cli = async (name,words) => {
      const selected = await runtimeCommand({directory:runtime,args:words});
      const result = await command(selected.executable,selected.args,{cwd:selected.cwd});
      await record(name+'.stdout',result.stdout); await record(name+'.stderr',result.stderr);
      await record(name+'.process.json',{args:words,code:result.code,signal:result.signal,...(result.failure?{failure:result.failure}:{})});
      need(result.code === 0 && !result.failure,'Original installed '+name+' did not complete. Read its retained stdout/stderr.');
      return JSON.parse(result.stdout);
    };
    const source = await cli('source',['source']);
    need(source.sourceCommit === installed.sourceCommit && source.sourceSelection?.id === 'edr',
      'Installed dispatch returned another original source selection.');
    const registration = await cli('registrations',['registrations','--source','edr']), maps = registration.registrations;
    need(registration.id === 'edr' && maps.commands.edr === ROOT+'cli.mjs' &&
      maps.applicationProviders.edr === ROOT+'application-provider.mjs' &&
      maps.merchantProviders['edr-workspaces'] === ROOT+'merchant-provider.mjs',
      'Original installed Applications/MCP/CLI registration differs.');
    for (const [name,path] of Object.entries({'./seller/edr':'merchant.mjs','./buyer/edr':'customer.mjs',
      './merchant/edr':'mcp.mjs','./client/edr':'mcp-client.mjs'}))
      need(maps.exports[name] === './source/'+ROOT+path,'Original installed module export differs: '+name);
    const workspace = intent.workspace, nativeCommand = (name,...words) => cli(name,['edr','--workspace',workspace,...words]);
    if (!await exists(workspace)) await nativeCommand('initialize','init'); else await nativeCommand('existing-state','state');
    await privateDirectory(join(work,'inputs')); await privateDirectory(join(work,'projects')); await privateDirectory(join(work,'datasets'));
    for (const context of contexts) {
      const { name,reference,build,project } = context;
      context.projectPath = join(work,'inputs',name+'.edr.zip'); await retain(context.projectPath,project.body);
      const received = await nativeCommand(name+'-receive','receive','--file',context.projectPath);
      need(received.source === build.source && received.plan === build.plan && received.reconstructed === true,
        'Original imported source/plan ABI or identity differs: '+name);
      checkBuild(received.build,build);
      const rows = await traverse(params => nativeCommand(name+'-query-'+randomUUID(),'query','--build',build.id,'--params',JSON.stringify(params)),
        build,reference.traversal);
      await record('cli-traversal-'+name+'.json',rows);
      const exported = join(work,'projects',name+'.edr.zip');
      const packet = await nativeCommand(name+'-export','export','--build',build.id,'--out',exported);
      need(packet.bytes === project.bytes && packet.sha256 === project.sha256 &&
        (await regular(exported)).equals(project.body), 'Original installed project re-export differs byte for byte: '+name);
      context.datasetPath = join(work,'datasets',name);
      await nativeCommand(name+'-export-dataset','export-dataset','--build',build.id,'--out',context.datasetPath);
      context.lineage = JSON.parse(await regular(join(context.datasetPath,'edr-lineage.json')));
      need(context.lineage.schema === 'stellar-forge.edr-lineage.v1' && context.lineage.build === build.id &&
        context.lineage.snapshot === build.native.snapshot && context.lineage.rowCount === build.rowCount &&
        same(context.lineage.files,Object.fromEntries(['data.csv','dataset.json'].map(file=>[file,build.files[file]]))),
        'Original installed seller projection lineage differs: '+name);
      for (const file of ['data.csv','dataset.json']) {
        const bytes = await regular(join(context.datasetPath,file));
        need(bytes.length === build.files[file].bytes && sha(bytes) === build.files[file].sha256,
          'Original installed dataset member differs: '+name+'/'+file);
      }
    }
    let merchant = {state:'NOT_RUN',reason:'Merchant preparation requires operator-selected public terms, origin and reference.'};
    let buyer = {state:'NOT_RUN',reason:'Buyer offer and draft preparation require an operator-selected seller.'};
    if (paymentBytes) {
      const context = contexts.find(value => value.name === args['--merchant-reference']), build = context.build;
      const terms = join(work,'public-payment-terms.json'); await retain(terms,paymentBytes);
      const release = join(work,'merchant-release');
      const prepared = await cli('merchant-prepare',['edr','merchant','prepare','--dataset',context.datasetPath,
        '--payment',terms,'--origin',args['--merchant-origin'],'--out',release]);
      const reread = await cli('merchant-inspect',['edr','merchant','inspect','--release',release]);
      need(same(prepared.manifest,reread.manifest) && reread.manifest.snapshot === build.native.snapshot,
        'Original merchant preparation/readback differs.');
      merchant = {state:'PREPARED_AND_READ_BACK',reference:context.name,manifest:reread.manifest};
      if (args['--buyer-seller']) {
        const offered = await cli('buyer-offer',['edr','buyer','offer','--release',release,
          '--seller',args['--buyer-seller'],'--query','{"limit":"1"}']);
        need(offered.edition?.snapshot === build.native.snapshot,'Original buyer offer selected another dataset edition.');
        buyer = {state:'OFFER_READ',reference:context.name,offer:offered};
        if (args['--buyer-intent']) {
          const preparedBuyer = await cli('buyer-prepare',['edr','buyer','prepare','--release',release,
            '--seller',args['--buyer-seller'],'--query','{"limit":"1"}','--intent',args['--buyer-intent'],
            '--accept-index',args['--buyer-accept-index'],'--offer-sha',args['--buyer-offer-sha'],
            '--out',join(work,'original-buyer-draft.json')]);
          need(preparedBuyer.edition?.snapshot === build.native.snapshot,'Original buyer draft selected another edition.');
          buyer = {state:'DRAFT_PREPARED',reference:context.name,offer:offered,draft:preparedBuyer};
        }
      }
    }
    await record('merchant.json',merchant); await record('buyer.json',buyer);
    const connectionFile = join(privateRoot,'operator-connection.json');
    server = await startOperator(runtime,workspace,connectionFile,privateRoot);
    const binding = await edrStartup(
      {command:'edr',args:['--workspace',workspace,'serve','--host','127.0.0.1','--port','0','--connection-file',connectionFile]},
      JSON.stringify(server.ready));
    need(binding?.original?.instanceId === server.ready.instanceId,'Installed Applications verifier did not bind the original listener.');
    await record('operator.json',binding.original);
    const connection = join(work,'edr-workspaces.private.json');
    const connectionValue = {schema:'stellar-forge.edr-workspace-connection.v1',workspaces:{
      received:{label:'Original installed ICOADS point and grid receiver',workspace,
        connectionFile:join(work,'live-operator.private.json'),
        inputs:Object.fromEntries(contexts.map(context => [context.name,{
          path:context.projectPath,kind:'packet',label:'Accepted '+context.name+' project',sha256:context.project.sha256
        }]))}}};
    await retain(connection,json(connectionValue));
    const live = join(work,'live-operator.private.json'), liveTemp = join(work,'.live-'+randomUUID());
    await retain(liveTemp,json(server.ready));
    const { rename } = await import('node:fs/promises');
    if (await exists(live)) {
      const old = JSON.parse(await regular(live,65536));
      need(old.schema === server.ready.schema && old.workspace === workspace,'Preserve a different original operator connection.');
    }
    await rename(liveTemp,live);
    const setup = await initializeEdrMerchant({directory:join(work,'merchant-mcp'),connection,
      name:'Installed EDR ICOADS point and grid receiver'});
    await record('mcp-setup.json',{schema:setup.schema,state:setup.state,reused:setup.reused,hostOwnership:'ORIGINAL_EDR_WORKSPACE'});
    const config = await readMerchantConfig(setup.configuration);
    family = new MerchantEdrWorkspaces(config);
    const mcp = async (name,input={}) => {
      const value = await family.call('merchant_edr_'+name,{...(name==='workspaces'?{}:{workspace:'received'}),...input});
      await record('mcp-'+name+'-'+randomUUID()+'.json',value); return value;
    };
    await mcp('workspaces'); await mcp('status');
    for (const context of contexts) {
      const { name,reference,build,project,lineage } = context;
      await mcp('input_inspect',{input:name});
      const imported = await mcp('import',{input:name,expectedSha256:project.sha256});
      need(imported.source === build.source && imported.plan === build.plan,'Installed MCP import returned another original source: '+name);
      checkBuild(imported.build,build);
      const original = await mcp('source',{sourceId:build.source});
      need(original.id === build.source && original.inventory.rowCount === build.rowCount &&
        original.inventory.collectionId === reference.collectionId &&
        original.inventory.schemaSha256 === reference.schemaSha256 &&
        same(original.inventory.coverage,reference.coverage) &&
        same(original.inventory.selection,reference.selection) &&
        same(original.inventory.sourceIssues,reference.sourceIssues) &&
        same(original.inventory.valuePolicy,reference.valuePolicy) &&
        same(original.inventory.schemaIdentityPolicy,reference.schemaIdentityPolicy),
        'Installed MCP source, original coordinates/time issues or selected-query coverage differs: '+name);
      const mapping = await mcp('mapping',{id:build.plan});
      const savedMapping = await mcp('mapping_save',{mapping});
      need(savedMapping.id === build.plan,'Installed MCP mapping did not retain its exact reviewed identity: '+name);
      checkBuild(await mcp('build',{sourceId:build.source,planId:build.plan}),build);
      checkBuild(await mcp('build_read',{buildId:build.id}),build);
      const mcpRows = await traverse(params=>mcp('native_query',{buildId:build.id,params}),build,reference.traversal);
      await record('mcp-traversal-'+name+'.json',mcpRows);
      const files = await mcp('source_files',{sourceId:build.source});
      need(Array.isArray(files.files),'Original source member inventory is incomplete: '+name);
      const downloads = await privateDirectory(join(generation,'downloads-'+name)), downloaded = [];
      for (let index=0;index<files.files.length;index++) {
        const file = files.files[index];
        downloaded.push(await receiveFile(family,{kind:'source',sourceId:build.source,member:file.name},downloads,
          'original-source-member-'+String(index).padStart(3,'0')+'.bin',file));
      }
      downloaded.push(await receiveFile(family,{kind:'packet',buildId:build.id},downloads,'customer-project.edr.zip',inputIdentity(project)));
      const zippedDataset = await receiveFile(family,{kind:'dataset',buildId:build.id},downloads,'native-dataset.zip');
      downloaded.push(zippedDataset);
      const members = await zipContents(process.env.SF30_EDR_PYTHON ?? process.env.CODEX_PRIMARY_RUNTIME_PYTHON ?? 'python3',zippedDataset.file);
      need(same(Object.keys(members).sort(),['data.csv','dataset.json','edr-lineage.json']) &&
        same(members['data.csv'],build.files['data.csv']) && same(members['dataset.json'],build.files['dataset.json']) &&
        same(members['edr-lineage.json'].value,lineage),'Installed MCP dataset ZIP differs from the original projection: '+name);
      for (const file of downloaded) publicFiles.push({path:relative(work,file.file),bytes:file.bytes,sha256:file.sha256});
      await record('mcp-downloads-'+name+'.json',downloaded.map(file=>({...file,file:relative(work,file.file)})));
    }
    for (const collection of collections) {
      let offset = 0, view, total, values = [];
      for (;;) {
        const value = await mcp('records',{collection,offset,limit:25,...(view?{expectedViewSha256:view}:{})});
        view ??= value.viewSha256; total ??= value.total;
        need(value.collection === collection && value.viewSha256 === view && value.total === total &&
          value.offset === offset && Array.isArray(value.items) && value.returned === value.items.length,
          'Original complete collection page changed.');
        values.push(...value.items);
        need(values.length <= total,'Original complete collection exceeded its declared count.');
        if (value.nextOffset === null) { need(values.length === total,'Original complete collection ended early.'); break; }
        need(value.nextOffset === offset+value.returned && value.returned > 0,'Original collection cursor did not advance.');
        offset = value.nextOffset;
      }
      await record('mcp-records-'+collection+'.json',{collection,viewSha256:view,total,items:values});
    }
    await mcp('disconnect'); await family.close(); family = null;
    const stopped = await stopServer(server); server = null;
    await record('operator-close.json',stopped);
    for (const context of contexts) {
      const { name,reference,build } = context;
      const reopened = await nativeCommand(name+'-closed-reopen-build','build-read','--id',build.id);
      checkBuild(reopened,build);
      const finalRows = await traverse(params=>nativeCommand(name+'-closed-query-'+randomUUID(),'query','--build',build.id,'--params',JSON.stringify(params)),
        build,reference.traversal);
      await record('closed-reopen-traversal-'+name+'.json',finalRows);
    }
    const state = await nativeCommand('closed-reopen-state','state');
    for (const context of contexts) {
      need(state.sources.some(value=>value.id===context.source) && state.plans.some(value=>value.id===context.plan) &&
        state.builds.some(value=>value.id===context.build.id), 'The closed receiving workspace lost an original source, mapping or edition.');
    }
    const outcome = {
      schema:'stellar-forge.edr-installed-receiving.v1',status:'INSTALLED_RECEIVING_COMPLETE',
      operationId:OPERATION,generation:attempt.generation,sourceCommit:installed.sourceCommit,
      sourceSelection:'edr',installationId:installed.installationId,profileId:installed.profileId,
      nativeResult:inputIdentity(native),references:expectedReferences,rowCount:contexts.reduce((sum,value)=>sum+value.build.rowCount,0),
      nativeCli:true,applicationsBinding:true,mcpReceiving:true,closedReopen:true,merchant,buyer,
      finishedAt:new Date().toISOString(),files:publicFiles
    };
    await retain(join(generation,'result.json'),json(outcome));
    console.log(JSON.stringify({status:outcome.status,operationId:outcome.operationId,result:join(generation,'result.json'),
      references:outcome.references,rowCount:outcome.rowCount,merchant:merchant.state,buyer:buyer.state},null,2));
    return outcome;
  } catch (error) {
    const cleanup = [];
    console.error(JSON.stringify({status:'INSTALLED_RECEIVING_FAILED',operationId:OPERATION,
      generation:attempt?.generation ?? null,error:{name:error.name,message:error.message}}));
    try { await family?.close(); } catch (failure) { cleanup.push({phase:'mcp_close',name:failure.name,message:failure.message}); }
    try { if(server) cleanup.push({phase:'operator_close',result:await stopServer(server)}); } catch (failure) { cleanup.push({phase:'operator_close',name:failure.name,message:failure.message}); }
    family = null; server = null;
    const failure = {schema:'stellar-forge.edr-installed-receiving.v1',status:'INSTALLED_RECEIVING_INCOMPLETE',
      operationId:OPERATION,generation:attempt?.generation ?? null,
      sourceCommit:selectedSource?.sourceCommit ?? null,error:{name:error.name,message:error.message},cleanup,files:publicFiles};
    console.error(JSON.stringify(failure));
    if (generation) {
      try { await retain(join(generation,'result.json'),json(failure)); }
      catch (saveError) { console.error(JSON.stringify({status:'RECEIVING_RESULT_SAVE_FAILED',
        operationId:OPERATION,generation:failure.generation,originalError:failure.error,
        error:{name:saveError.name,message:saveError.message}})); }
    }
    throw error;
  } finally { await held.close(); }
}
if (process.argv[1]) {
  const invoked = await realpath(resolve(process.argv[1])).catch(()=>null);
  const own = await realpath(fileURLToPath(import.meta.url));
  if (invoked === own) main().catch(error=>{
    console.error(JSON.stringify({error:'EDR_INSTALLED_RECEIVING',name:error.name,message:error.message}));
    process.exitCode=1;
  });
}
