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
import { initializeConnectedSystemsMerchant } from '../mcp-setup.mjs';
import { MerchantConnectedSystemsWorkspaces } from '../mcp.mjs';
import { readMerchantConfig } from '../../../../../stellar-forge/mcp-merchant-operator/config.mjs';
import { connectedSystemsStartup } from '../application-provider.mjs';

const ROOT = 'stellar/scf-starforge-20261009/sf30-seller-sdk/connected-systems/';
const SELF = ROOT + 'delivery/installed-receive.mjs';
const EXAMPLE = {
  operation: 'ogc-room-temperature-reference-v1',
  packet: { bytes: 6137, sha256: '976fbe48b0264411d776bb76469bb9fc1e0fd13d6e175c9251f8f45736a19a1a' },
  native: { bytes: 14611, sha256: 'f61e754b83f342a86dd341745b18d3411019708a90c40e679a10eb293957b8de' },
};
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
  const allowed = ['--runtime','--work-dir','--project','--native-result','--merchant-payment','--merchant-origin',
    '--buyer-seller','--buyer-intent','--buyer-accept-index','--buyer-offer-sha'];
  const out = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    need(allowed.includes(key) && !Object.hasOwn(out,key) && typeof values[index + 1] === 'string' &&
      values[index + 1] && !values[index + 1].startsWith('--'), 'Use each documented option once with its value.');
    out[key] = values[index + 1];
  }
  need(out['--runtime'] && out['--work-dir'], '--runtime and --work-dir are required.');
  need(Boolean(out['--merchant-payment']) === Boolean(out['--merchant-origin']), 'Merchant payment and origin are one explicit selection.');
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
    args: ['connected-systems','--workspace',workspace,'serve','--host','127.0.0.1','--port','0','--connection-file',connectionFile] });
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
        need(ready.schema === 'stellar-forge.connected-systems-workspace-startup.v1' &&
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
async function traverse(read, build, expectedRows) {
  const rows = []; let next, pages = 0, fields; const seen = new Set();
  for (;;) {
    const value = await read({ limit:'1', ...(next ? { cursor:next } : {}) });
    const body = checkQuery(value, build);
    if (!fields) fields = body.fields; else need(same(fields,body.fields), 'Original query fields changed between cursors.');
    rows.push(...body.rows); pages++;
    need(rows.length <= build.rowCount && pages <= build.rowCount + 1, 'Original native cursor exceeded its accepted row count.');
    next = body.page?.nextCursor;
    if (!next) break;
    need(typeof next === 'string' && !seen.has(next), 'Original native cursor repeated.'); seen.add(next);
  }
  need(rows.length === build.rowCount && same(rows,expectedRows.rows) && same(fields,expectedRows.fields),
    'Installed traversal differs from every accepted original row and field.');
  return { snapshot:build.native.snapshot, pages, rowCount:rows.length, fields, rows,
    rowsSha256:sha(Buffer.from(canonical(rows))) };
}
async function zipContents(python, path) {
  const source = "import sys,zipfile,json,hashlib,stat\nwith zipfile.ZipFile(sys.argv[1]) as z:\n infos=z.infolist()\n assert len(infos)==len({i.filename for i in infos}) and sum(i.file_size for i in infos)<=8388608\n out={}\n for i in infos:\n  assert i.filename==i.orig_filename and not i.is_dir() and not i.flag_bits&1 and stat.S_ISREG(i.external_attr>>16) and not i.filename.startswith('/') and '..' not in i.filename.split('/') and '\\\\' not in i.filename\n  b=z.read(i);out[i.filename]={'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}\n  if i.filename=='connected-systems-lineage.json':out[i.filename]['value']=json.loads(b)\n print(json.dumps(out))\n";
  const value = await command(python, ['-B','-c',source,path], { maximum:1024 * 1024, timeout:30000 });
  need(value.code === 0 && !value.failure, 'Original received dataset ZIP could not be inspected: ' + value.stderr.toString('utf8'));
  return JSON.parse(value.stdout);
}
async function receiveFile(family, selection, directory, filename, expected) {
  const destination = join(directory,filename), chunks = []; let readId, offset = 0, first;
  try {
    for (;;) {
      const value = await family.call('merchant_csapi_file_read', { workspace:'received', ...selection,
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
  } finally { if (readId) await family.call('merchant_csapi_file_release',{workspace:'received',readId}).catch(() => {}); }
}
export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') {
    console.log('installed-receive --runtime READY_ORIGINAL_RUNTIME --work-dir ORIGINAL_OP/installed-receiving [--project EXACT_EXAMPLE.zip] [--native-result EXACT_RESULT.json] [--merchant-payment PUBLIC_TERMS.json --merchant-origin HTTPS_ORIGIN] [--buyer-seller ORIGINAL_SELLER_URL [--buyer-intent ID --buyer-accept-index INDEX --buyer-offer-sha SHA256]]');
    return;
  }
  const args = argumentsFor(argv), runtime = await realpath(resolve(args['--runtime']));
  const work = await privateDirectory(resolve(args['--work-dir'])), held = await lease(work);
  let family, server, generation, publicFiles = [], outcome, selectedSource, attempt;
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
      selectedSource.sourceSelection?.id === 'connected-systems' &&
      selectedSource.sourceCommit === installed.sourceCommit, 'The installed source is not this exact Connected Systems selection.');
    const helperEntry = selectedSource.files.find(item => item.path === SELF);
    const helperBytes = await regular(fileURLToPath(import.meta.url));
    need(helperEntry && helperEntry.sha256 === sha(helperBytes) && helperEntry.bytes === helperBytes.length,
      'The installed original receiver differs from its source manifest.');
    const project = await realpath(resolve(args['--project'] ?? join(installed.sourceRoot,ROOT+'examples/ogc-room-temperature.connected-systems.zip')));
    const nativePath = await realpath(resolve(args['--native-result'] ?? join(installed.sourceRoot,ROOT+'examples/ogc-room-temperature-native-result.json')));
    const projectBytes = await regular(project), nativeBytes = await regular(nativePath);
    need(projectBytes.length === EXAMPLE.packet.bytes && sha(projectBytes) === EXAMPLE.packet.sha256 &&
      nativeBytes.length === EXAMPLE.native.bytes && sha(nativeBytes) === EXAMPLE.native.sha256,
      'Receive the exact already accepted publisher example and its complete original native result.');
    const accepted = JSON.parse(nativeBytes), reference = accepted.native.sources[0], build = reference.build;
    need(accepted.native.operationId === EXAMPLE.operation && accepted.native.sources.length === 1 &&
      build.rowCount === 1 && accepted.publisher.classification.includes('not a field measurement'),
      'Original publisher reference identity differs.');
    const paymentBytes = args['--merchant-payment'] ? await regular(await realpath(resolve(args['--merchant-payment'])),16384) : null;
    if (paymentBytes) JSON.parse(paymentBytes);
    const intent = { schema:'stellar-forge.connected-systems-installed-receiving-intent.v1', operationId:EXAMPLE.operation,
      sourceCommit:installed.sourceCommit, installationId:installed.installationId, profileId:installed.profileId,
      project:EXAMPLE.packet, nativeResult:EXAMPLE.native, source:build.source, plan:build.plan, build:build.id,
      snapshot:build.native.snapshot, workspace:join(work,'workspace'),
      merchant:paymentBytes ? { paymentSha256:sha(paymentBytes),origin:args['--merchant-origin'] } : null,
      buyer:args['--buyer-seller'] ? { seller:args['--buyer-seller'],intent:args['--buyer-intent'] ?? null,
        acceptIndex:args['--buyer-accept-index'] ?? null,offerSha256:args['--buyer-offer-sha'] ?? null } : null };
    await retain(join(work,'intent.json'),json(intent));
    const generations = join(work,'generations'); await privateDirectory(generations);
    const sequence = (await readdir(generations)).filter(name => /^attempt-[0-9]{6}$/.test(name)).map(name => Number(name.slice(8)));
    const latest = sequence.reduce((maximum, value) => Math.max(maximum, value), 0);
    if (latest) {
      const originalGeneration = 'generations/attempt-' + String(latest).padStart(6,'0');
      const originalRoot = join(work,originalGeneration), originalResult = join(originalRoot,'result.json');
      need(await realpath(originalRoot) === originalRoot, 'Preserve the linked original receiving history.');
      if (await exists(originalResult)) {
        const prior = JSON.parse(await regular(originalResult));
        if (prior.status === 'INSTALLED_RECEIVING_COMPLETE') {
          const priorAttempt = JSON.parse(await regular(join(originalRoot,'attempt.json')));
          need(priorAttempt.schema === 'stellar-forge.connected-systems-installed-receiving-attempt.v1' &&
            priorAttempt.operationId === EXAMPLE.operation && priorAttempt.generation === originalGeneration &&
            priorAttempt.sourceCommit === installed.sourceCommit && priorAttempt.inputSha256 === sha(json(intent)) &&
            same(priorAttempt.helper,{bytes:helperBytes.length,sha256:sha(helperBytes)}),
            'The completed original attempt belongs to different input, source or receiver bytes.');
          need(prior.schema === 'stellar-forge.connected-systems-installed-receiving.v1' &&
            prior.operationId === EXAMPLE.operation && prior.generation === originalGeneration &&
            prior.sourceCommit === installed.sourceCommit && prior.sourceSelection === 'connected-systems' &&
            prior.installationId === installed.installationId && prior.profileId === installed.profileId &&
            same(prior.project,EXAMPLE.packet) && prior.source === build.source && prior.plan === build.plan &&
            prior.build === build.id && prior.snapshot === build.native.snapshot && prior.rowCount === build.rowCount &&
            same(prior.coverage,reference.coverage) && prior.classification === accepted.publisher.classification &&
            prior.nativeCli === true && prior.applicationsBinding === true && prior.mcpReceiving === true &&
            prior.closedReopen === true && Array.isArray(prior.files),
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
          for (const name of ['attempt.json','installation.json','accepted-native-result.json','accepted-project.zip',
            'cli-traversal.json','merchant.json','buyer.json','operator.json','operator-close.json',
            'mcp-traversal.json','mcp-downloads.json','closed-reopen-traversal.json'])
            need(retainedNames.has(originalGeneration+'/'+name), 'The completed original receiving inventory omits '+name);
          need(same(prior.merchant,JSON.parse(await regular(join(originalRoot,'merchant.json')))) &&
            same(prior.buyer,JSON.parse(await regular(join(originalRoot,'buyer.json')))),
            'The completed original merchant or buyer stage differs from its retained result.');
          console.log(JSON.stringify({status:prior.status,operationId:prior.operationId,result:originalResult,
            source:prior.source,plan:prior.plan,build:prior.build,snapshot:prior.snapshot,rowCount:prior.rowCount,
            merchant:prior.merchant.state,buyer:prior.buyer.state,recovered:true},null,2));
          return prior;
        }
      }
    }
    const number = latest + 1;
    need(number < 1000000,'Preserve this original receiving history before selecting another generation.');
    generation = join(generations,'attempt-'+String(number).padStart(6,'0')); await mkdir(generation,{mode:0o700});
    const privateRoot = await privateDirectory(join(generation,'private'));
    attempt = { schema:'stellar-forge.connected-systems-installed-receiving-attempt.v1', operationId:EXAMPLE.operation,
      startedAt:new Date().toISOString(), sourceCommit:installed.sourceCommit, helper:{bytes:helperBytes.length,sha256:sha(helperBytes)},
      inputSha256:sha(json(intent)), generation:relative(work,generation) };
    await record('attempt.json',attempt); await record('installation.json',installed);
    await record('accepted-native-result.json',nativeBytes);
    await record('accepted-project.zip',projectBytes);
    const cli = async (name, words) => {
      const selected = await runtimeCommand({directory:runtime,args:words});
      const result = await command(selected.executable,selected.args,{cwd:selected.cwd});
      await record(name+'.stdout',result.stdout); await record(name+'.stderr',result.stderr);
      await record(name+'.process.json',{args:words,code:result.code,signal:result.signal,...(result.failure?{failure:result.failure}:{})});
      need(result.code === 0 && !result.failure,'Original installed '+name+' did not complete. Read its retained stdout/stderr.');
      return JSON.parse(result.stdout);
    };
    const source = await cli('source',['source']);
    need(source.sourceCommit === installed.sourceCommit && source.sourceSelection?.id === 'connected-systems',
      'Installed dispatch returned another original source selection.');
    const registration = await cli('registrations',['registrations','--source','connected-systems']);
    const maps = registration.registrations;
    need(registration.id === 'connected-systems' && maps.commands['connected-systems'] === ROOT+'cli.mjs' &&
      maps.applicationProviders['connected-systems'] === ROOT+'application-provider.mjs' &&
      maps.merchantProviders['connected-systems-workspaces'] === ROOT+'merchant-provider.mjs',
      'Original installed Applications/MCP/CLI registration differs.');
    for (const [name,path] of Object.entries({'./seller/connected-systems':'merchant.mjs','./buyer/connected-systems':'customer.mjs',
      './merchant/connected-systems':'mcp.mjs','./client/connected-systems':'mcp-client.mjs'}))
      need(maps.exports[name] === './source/'+ROOT+path,'Original installed module export differs: '+name);
    const workspace = intent.workspace, native = (name,...words) => cli(name,['connected-systems','--workspace',workspace,...words]);
    if (!await exists(workspace)) await native('initialize','init'); else await native('existing-state','state');
    const received = await native('receive','receive','--file',project);
    need(received.source === build.source && received.plan === build.plan && received.reconstructed === true,
      'Original imported source/plan ABI or identity differs.');
    checkBuild(received.build,build);
    const cliRows = await traverse(params => native('query-'+randomUUID(),'query','--build',build.id,'--params',JSON.stringify(params)),
      build,reference.traversal.first);
    await record('cli-traversal.json',cliRows);
    const exported = join(work,'received-project.zip');
    const packet = await native('export','export','--build',build.id,'--out',exported);
    need(packet.bytes === EXAMPLE.packet.bytes && packet.sha256 === EXAMPLE.packet.sha256 &&
      (await regular(exported)).equals(projectBytes),'Original installed project re-export differs byte for byte.');
    const dataset = join(work,'dataset');
    await native('export-dataset','export-dataset','--build',build.id,'--out',dataset);
    const lineage = JSON.parse(await regular(join(dataset,'connected-systems-lineage.json')));
    need(lineage.schema === 'stellar-forge.connected-systems-lineage.v1' && lineage.build === build.id &&
      lineage.snapshot === build.native.snapshot && lineage.rowCount === build.rowCount &&
      same(lineage.files,Object.fromEntries(['data.csv','dataset.json'].map(name=>[name,build.files[name]]))),
      'Original installed seller projection lineage differs.');
    for (const name of ['data.csv','dataset.json']) {
      const bytes = await regular(join(dataset,name)); need(bytes.length === build.files[name].bytes &&
        sha(bytes) === build.files[name].sha256,'Original installed dataset member differs: '+name);
    }
    let merchant = {state:'NOT_RUN',reason:'No public payment terms or seller origin were selected.'};
    let buyer = {state:'NOT_RUN',reason:'No existing seller offer was selected; no signer, account or paid attempt was created.'};
    if (paymentBytes) {
      const terms = join(work,'public-payment-terms.json'); await retain(terms,paymentBytes);
      const release = join(work,'merchant-release');
      const prepared = await cli('merchant-prepare',['connected-systems','merchant','prepare','--dataset',dataset,
        '--payment',terms,'--origin',args['--merchant-origin'],'--out',release]);
      const reread = await cli('merchant-inspect',['connected-systems','merchant','inspect','--release',release]);
      need(same(prepared.manifest,reread.manifest) && reread.manifest.snapshot === build.native.snapshot,
        'Original merchant preparation/readback differs.');
      merchant = {state:'PREPARED_AND_READ_BACK',manifest:reread.manifest};
      if (args['--buyer-seller']) {
        const offered = await cli('buyer-offer',['connected-systems','buyer','offer','--release',release,
          '--seller',args['--buyer-seller'],'--query','{"limit":"1"}']);
        need(offered.edition?.snapshot === build.native.snapshot,'Original buyer offer selected another dataset edition.');
        buyer = {state:'OFFER_READ',offer:offered};
        if (args['--buyer-intent']) {
          const preparedBuyer = await cli('buyer-prepare',['connected-systems','buyer','prepare','--release',release,
            '--seller',args['--buyer-seller'],'--query','{"limit":"1"}','--intent',args['--buyer-intent'],
            '--accept-index',args['--buyer-accept-index'],'--offer-sha',args['--buyer-offer-sha'],
            '--out',join(work,'original-buyer-draft.json')]);
          need(preparedBuyer.edition?.snapshot === build.native.snapshot,'Original buyer draft selected another edition.');
          buyer = {state:'DRAFT_PREPARED',offer:offered,draft:preparedBuyer};
        }
      }
    }
    await record('merchant.json',merchant); await record('buyer.json',buyer);
    const connectionFile = join(privateRoot,'operator-connection.json');
    server = await startOperator(runtime,workspace,connectionFile,privateRoot);
    const binding = await connectedSystemsStartup(
      {command:'connected-systems',args:['--workspace',workspace,'serve','--host','127.0.0.1','--port','0','--connection-file',connectionFile]},
      JSON.stringify(server.ready));
    need(binding?.original?.instanceId === server.ready.instanceId,'Installed Applications verifier did not bind the original listener.');
    await record('operator.json',binding.original);
    const connection = join(work,'connected-systems-workspaces.private.json');
    // A new generation refreshes only its own connection path. The original setup
    // binding stays at one stable file name across the same receiving operation.
    const connectionValue = {schema:'stellar-forge.connected-systems-workspace-connection.v1',workspaces:{
      received:{label:'Original installed OGC example receiver',workspace,connectionFile:join(work,'live-operator.private.json'),
        inputs:{project:{path:project,kind:'packet',label:'Accepted publisher project',sha256:EXAMPLE.packet.sha256}}}}};
    await retain(connection,json(connectionValue));
    const live = join(work,'live-operator.private.json'), liveTemp = join(work,'.live-'+randomUUID());
    await retain(liveTemp,json(server.ready));
    const { rename } = await import('node:fs/promises');
    if (await exists(live)) {
      const old = JSON.parse(await regular(live,65536));
      need(old.schema === server.ready.schema && old.workspace === workspace,'Preserve a different original operator connection.');
    }
    await rename(liveTemp,live);
    const setup = await initializeConnectedSystemsMerchant({directory:join(work,'merchant-mcp'),connection,
      name:'Installed Connected Systems publisher example'});
    await record('mcp-setup.json',{schema:setup.schema,state:setup.state,reused:setup.reused,hostOwnership:'ORIGINAL_CSAPI_WORKSPACE'});
    const config = await readMerchantConfig(setup.configuration);
    family = new MerchantConnectedSystemsWorkspaces(config);
    const mcp = async (name,input={}) => {
      const value = await family.call('merchant_csapi_'+name,{...(name==='workspaces'?{}:{workspace:'received'}),...input});
      await record('mcp-'+name+'-'+randomUUID()+'.json',value); return value;
    };
    await mcp('workspaces'); await mcp('status'); await mcp('input_inspect',{input:'project'});
    const imported = await mcp('import',{input:'project',expectedSha256:EXAMPLE.packet.sha256});
    need(imported.source === build.source && imported.plan === build.plan,'Installed MCP import returned another original source.');
    checkBuild(imported.build,build);
    const original = await mcp('source',{sourceId:build.source});
    need(original.id === build.source && same(original.inventory.coverage,reference.coverage),'Installed MCP source/coverage differs.');
    const mapping = await mcp('mapping',{id:build.plan});
    const savedMapping = await mcp('mapping_save',{mapping});
    need(savedMapping.id === build.plan,'Installed MCP mapping did not retain its exact reviewed identity.');
    checkBuild(await mcp('build',{sourceId:build.source,planId:build.plan}),build);
    checkBuild(await mcp('build_read',{buildId:build.id}),build);
    const mcpRows = await traverse(params=>mcp('native_query',{buildId:build.id,params}),build,reference.traversal.first);
    await record('mcp-traversal.json',mcpRows);
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
    const files = await mcp('source_files',{sourceId:build.source});
    need(Array.isArray(files.files),'Original source member inventory is incomplete.');
    const downloads = await privateDirectory(join(generation,'downloads')), downloaded = [];
    for (let index=0;index<files.files.length;index++) {
      const file = files.files[index];
      downloaded.push(await receiveFile(family,{kind:'source',sourceId:build.source,member:file.name},downloads,
        'original-source-member-'+String(index).padStart(3,'0')+'.bin',file));
    }
    downloaded.push(await receiveFile(family,{kind:'packet',buildId:build.id},downloads,'customer-project.zip',EXAMPLE.packet));
    const zippedDataset = await receiveFile(family,{kind:'dataset',buildId:build.id},downloads,'native-dataset.zip');
    downloaded.push(zippedDataset);
    const entries = await zipContents(process.env.SF30_CONNECTED_SYSTEMS_PYTHON ?? process.env.CODEX_PRIMARY_RUNTIME_PYTHON ?? 'python3',zippedDataset.file);
    need(same(Object.keys(entries).sort(),['connected-systems-lineage.json','data.csv','dataset.json']) &&
      same(entries['data.csv'],build.files['data.csv']) && same(entries['dataset.json'],build.files['dataset.json']) &&
      same(entries['connected-systems-lineage.json'].value,lineage),'Installed MCP dataset ZIP differs from the original projection.');
    for (const file of downloaded) publicFiles.push({path:relative(work,file.file),bytes:file.bytes,sha256:file.sha256});
    await record('mcp-downloads.json',downloaded.map(file=>({...file,file:relative(work,file.file)})));
    await mcp('disconnect'); await family.close(); family = null;
    const stopped = await stopServer(server); server = null;
    await record('operator-close.json',stopped);
    const reopened = await native('closed-reopen-build','build-read','--id',build.id); checkBuild(reopened,build);
    const finalRows = await traverse(params=>native('closed-query-'+randomUUID(),'query','--build',build.id,'--params',JSON.stringify(params)),
      build,reference.traversal.first);
    await record('closed-reopen-traversal.json',finalRows);
    await native('closed-reopen-state','state');
    outcome = {schema:'stellar-forge.connected-systems-installed-receiving.v1',status:'INSTALLED_RECEIVING_COMPLETE',
      operationId:EXAMPLE.operation,generation:attempt.generation,sourceCommit:installed.sourceCommit,
      sourceSelection:'connected-systems',installationId:installed.installationId,profileId:installed.profileId,
      project:EXAMPLE.packet,source:build.source,plan:build.plan,build:build.id,snapshot:build.native.snapshot,rowCount:build.rowCount,
      classification:accepted.publisher.classification,coverage:reference.coverage,
      nativeCli:true,applicationsBinding:true,mcpReceiving:true,closedReopen:true,merchant,buyer,
      finishedAt:new Date().toISOString(),files:publicFiles};
    await retain(join(generation,'result.json'),json(outcome));
    console.log(JSON.stringify({status:outcome.status,operationId:outcome.operationId,result:join(generation,'result.json'),
      source:outcome.source,plan:outcome.plan,build:outcome.build,snapshot:outcome.snapshot,rowCount:outcome.rowCount,
      merchant:merchant.state,buyer:buyer.state},null,2));
    return outcome;
  } catch (error) {
    const cleanup = [];
    try { await family?.close(); } catch (failure) { cleanup.push({phase:'mcp_close',name:failure.name,message:failure.message}); }
    try { if(server) cleanup.push({phase:'operator_close',result:await stopServer(server)}); } catch (failure) { cleanup.push({phase:'operator_close',name:failure.name,message:failure.message}); }
    family = null; server = null;
    const failure = {schema:'stellar-forge.connected-systems-installed-receiving.v1',status:'INSTALLED_RECEIVING_INCOMPLETE',
      operationId:EXAMPLE.operation,generation:attempt?.generation ?? null,
      sourceCommit:selectedSource?.sourceCommit ?? null,error:{name:error.name,message:error.message},cleanup,files:publicFiles};
    console.error(JSON.stringify(failure));
    if (generation) {
      try { await retain(join(generation,'result.json'),json(failure)); }
      catch (saveError) { console.error(JSON.stringify({status:'RECEIVING_RESULT_SAVE_FAILED',
        operationId:EXAMPLE.operation, generation:failure.generation, originalError:failure.error,
        error:{name:saveError.name,message:saveError.message}})); }
    }
    throw error;
  } finally { await held.close(); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().catch(error=>{console.error(JSON.stringify({error:'CONNECTED_SYSTEMS_INSTALLED_RECEIVING',name:error.name,message:error.message}));process.exitCode=1;});
