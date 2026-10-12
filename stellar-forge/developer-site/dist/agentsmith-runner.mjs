#!/usr/bin/env node
// MIT. Receiving handoff for the original Stellar Forge buyer and wallet CLIs.
import {readFile, mkdir, lstat, readdir, open, link, unlink} from 'node:fs/promises';
import {resolve, dirname, join, isAbsolute} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import {constants as osConstants} from 'node:os';
import {spawn, execFile as execFileCallback} from 'node:child_process';
import {isDeepStrictEqual, promisify} from 'node:util';

const SCHEMA = 'stellar-forge.frontdoor-agentsmith-packet.v1';
const SOURCE = 'stellar/scf-starforge-20261009';
const PACKET = dirname(fileURLToPath(import.meta.url));
const BUYER = 'sf88-operator-buyer-cli/cli.mjs';
const WALLET = 'sf103-native-buyer-signer/browser-wallet/cli.mjs';
const CAPTURE_SHA = '93214bc738c9ad92c70aadddb07655d86ea7e304ea7ed1afda0e5c6b4a940098';
const hash = value => createHash('sha256').update(value).digest('hex');
const execFile = promisify(execFileCallback);
const need = (value, message) => { if (!value) throw new Error(message); };
async function exists(path) { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function bytes(path, limit = 24 * 1024 * 1024) {
  const stat = await lstat(path); need(stat.isFile() && stat.size > 0 && stat.size <= limit, 'Expected a complete original file: ' + path);
  const content = await readFile(path); need(content.length <= limit, 'Source file grew while reading: ' + path); return content;
}
const json = async path => JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(await bytes(path)));
async function command(executable, args) {
  const child = spawn(executable, args, {stdio:'inherit', shell:false, env:process.env});
  let requestedSignal;
  const forward = signal => { requestedSignal = signal; if (child.exitCode === null && child.signalCode === null) child.kill(signal); };
  const interrupt = () => forward('SIGINT'), terminate = () => forward('SIGTERM');
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
  try {
    const result = await new Promise((accept, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => accept({code, signal}));
    });
    const signal = result.signal || (result.code === 0 ? requestedSignal : null);
    const code = signal ? 128 + (osConstants.signals[signal] || 0) : result.code ?? 1;
    if (code !== 0) {
      const error = new Error('The original command ' + (signal ? 'ended with ' + signal : 'exited ' + code) +
        '. Continue from the same retained operation shown above.');
      error.exitCode = code; throw error;
    }
  } finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate); }
}
async function syncDirectory(directory) {
  const handle = await open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
// Publish the complete manifest in one create-only operation. An interrupted
// temporary write never becomes the identity of the receiving directory.
async function publishReceiving(path, content) {
  const temporary = join(dirname(dirname(path)), '.agentsmith-receiving-' + randomUUID() + '.tmp');
  let handle, owned = false;
  try {
    handle = await open(temporary, 'wx', 0o600); owned = true;
    await handle.writeFile(content); await handle.sync(); await handle.close(); handle = undefined;
    try { await link(temporary, path); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    await syncDirectory(dirname(path));
    await syncDirectory(dirname(dirname(path)));
  } finally {
    if (handle) await handle.close().catch(() => {});
    if (owned) await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
async function toolkit(root, wallet = false) {
  need(typeof root === 'string' && isAbsolute(root), 'Select --toolkit with the actual absolute checkout or installed package root.');
  for (const base of [join(root,SOURCE), join(root,'source',SOURCE), root]) {
    if (!await exists(join(base,BUYER))) continue;
    const checkout = resolve(base,'../..');
    need(join(checkout,SOURCE) === resolve(base),'Keep the original stellar/scf-starforge-20261009 source directory layout.');
    await bytes(join(base,BUYER));
    if (wallet) need(await exists(join(base,WALLET)), 'This toolkit does not yet contain browser-wallet. Select the complete current toolkit and its native + freighter-wallet runtime features.');
    return {base,checkout};
  }
  throw new Error('The selected directory has no original Stellar Forge buyer. Use its complete checkout or installed source package.');
}

async function packet() {
  const inputBytes = await bytes(join(PACKET,'packet.json')), input = JSON.parse(inputBytes);
  need(input.schema === SCHEMA, 'Open the complete original AgentSmith receiving packet.');
  const destination = input.privateDirectory;
  need(typeof destination === 'string' && isAbsolute(destination) && resolve(destination) === destination && destination !== '/',
    'The packet needs its original absolute private operation directory.');
  need(typeof input.intentId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(input.intentId) &&
    typeof input.actor === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(input.actor), 'The original operator and stable intent are required.');
  need(typeof input.payer === 'string' && (!input.payer || /^G[A-Z2-7]{55}$/.test(input.payer)), 'The configured payer must be the intended public account.');
  need(input.captureSha256 === CAPTURE_SHA && hash(await bytes(join(PACKET,'capture.py'))) === CAPTURE_SHA,
    'The original capture program changed. Reopen its matching receiving packet.');
  need(hash(await bytes(fileURLToPath(import.meta.url))) === input.runnerSha256, 'The native packet runner changed.');
  const sourceBytes = await bytes(join(PACKET,'source-http.json'));
  need(hash(sourceBytes) === input.sourceBundleSha256, 'The original source bundle changed.');
  const source = JSON.parse(sourceBytes);
  need(source.schema === 'commons.agentsmith.http-bundle.v1' && typeof source.requestUtf8 === 'string', 'The original source bundle is incomplete.');
  need((await bytes(join(PACKET,'request.json'))).equals(Buffer.from(source.requestUtf8)), 'The source request bytes changed.');
  return {input, source, identity:hash(inputBytes), directory:destination,
    capture:join(destination,'source'), request:join(destination,'request'),
    operator:join(destination,'operator'), wallet:join(destination,'wallet')};
}
async function retain(state, create = false) {
  const path = join(state.directory,'receiving.json');
  if (!await exists(state.directory)) {
    need(create, 'Run prepare first, using this same packet and stable intent.');
    await mkdir(dirname(state.directory), {recursive:true, mode:0o700});
    try { await mkdir(state.directory, {mode:0o700}); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const directory = await lstat(state.directory);
  need(directory.isDirectory() && (directory.mode & 0o077) === 0 &&
    (typeof process.getuid !== 'function' || directory.uid === process.getuid()),
    'Use the original private receiving directory owned by the current operator.');
  if (!await exists(path)) {
    need(create, 'Run prepare to finish this receiving packet.');
    const names = await readdir(state.directory);
    // An empty directory is a recoverable interrupted first creation. Any
    // original work requires its existing complete packet identity.
    need(names.length === 0 || await exists(path),
      'This directory contains work without this packet identity. Open its original receiving packet.');
    if (!await exists(path)) await publishReceiving(path, JSON.stringify({
      schema:SCHEMA, packetSha256:state.identity,
      sourceBundleSha256:state.input.sourceBundleSha256, intentId:state.input.intentId
    },null,2) + '\n');
  }
  const original = await json(path);
  need(original.schema === SCHEMA && original.packetSha256 === state.identity &&
    original.sourceBundleSha256 === state.input.sourceBundleSha256 && original.intentId === state.input.intentId,
    'The existing operation belongs to another packet. Reopen that original packet and intent.');
}
async function inspectCapture(state, python) {
  await command(python,[join(PACKET,'capture.py'),'inspect','--capture',state.capture]);
  need(isDeepStrictEqual(await json(join(state.capture,'challenge.http.json')),state.source.challenge) &&
    isDeepStrictEqual(await json(join(state.capture,'supported.http.json')),state.source.supported) &&
    (await bytes(join(state.capture,'request.json'))).equals(Buffer.from(state.source.requestUtf8)),
    'The prepared capture differs from this original packet.');
}
async function inspectRequest(state, base) {
  const record = await json(join(state.request,'preparation.json'));
  need(record.intentId === state.input.intentId && record.sourceDirectory === state.capture &&
    record.captureManifestSha256 === hash(await bytes(join(state.capture,'capture.json'))) &&
    record.reviewConfigSha256 === hash(await bytes(join(state.request,'review.json'))),
    'The original native preparation no longer matches this packet.');
  await command(process.execPath,[join(base,BUYER),'--review','--config',join(state.request,'review.json')]);
}

async function inspectOperator(state, base, payer = state.input.payer) {
  const buyer = join(base,'sf88-operator-buyer-cli');
  const [{openWorkspace},{config,operation},{readRequestBody}] = await Promise.all([
    import(pathToFileURL(join(buyer,'workspace.mjs')).href),
    import(pathToFileURL(join(buyer,'config.mjs')).href),
    import(pathToFileURL(join(buyer,'request-body.mjs')).href)
  ]);
  const original = await openWorkspace(['--dir',state.operator]);
  const prepared = await config(join(state.request,'review.json'));
  const wanted = operation(prepared.operation), actual = operation(original.config.operation);
  need(original.manifest.sourceConfig === join(state.request,'review.json') &&
    wanted.intentId === state.input.intentId && isDeepStrictEqual(actual,wanted),
    'The original operator must retain this packet\'s exact prepared request and stable intent.');
  const {operator:owner,signerModule,evidenceDir,trustedPayer,...retained} = original.config;
  need(isDeepStrictEqual(retained,{...prepared,operation:wanted}) &&
    owner.actor === state.input.actor && owner.service === 'agentsmith-metar' &&
    (!payer || trustedPayer === payer),
    'The original operator, payer or response destination differs from this receiving packet.');
  const body = await readRequestBody(actual);
  need(body !== undefined && Buffer.from(body).equals(Buffer.from(state.source.requestUtf8)),
    'The original operator body differs from this packet\'s retained request bytes.');
  return original;
}
async function initializeOperator(state, base, python, payer) {
  const flags = ['--config',join(state.request,'review.json'),'--dir',state.operator,
    '--actor',state.input.actor,'--service','agentsmith-metar','--payer',payer,'--python',python];
  if (!await exists(state.operator)) await command(process.execPath,[join(base,BUYER),'--init-workspace',...flags]);
  else if (!await exists(join(state.operator,'workspace.json'))) {
    // The maintained initializer reuses its own keys, policy, ledger and
    // initialization journal. This invokes its existing resume operation.
    const program = "import {pathToFileURL} from 'node:url'; " +
      "const {initializeWorkspace}=await import(pathToFileURL(process.argv[1]).href); " +
      "const result=await initializeWorkspace(process.argv.slice(2),{resume:true}); " +
      "process.stdout.write(JSON.stringify(result)+'\\n');";
    await command(process.execPath,['--input-type=module','-e',program,
      join(base,'sf88-operator-buyer-cli/workspace.mjs'),...flags]);
  }
  await inspectOperator(state,base,payer);
  await command(process.execPath,[join(base,BUYER),'--review-workspace','--dir',state.operator]);
}

export async function main(args = process.argv.slice(2)) {
  const help = 'AgentSmith native receiving packet\n\nnode buyer.mjs ACTION --toolkit /absolute/existing-toolkit [--python python3] [--payer ACTUAL_PUBLIC_ACCOUNT]\n\nActions: prepare, review, operator-init, wallet-prepare, wallet-serve, execute, inspect.\nprepare and review retain the original request. operator-init creates its original private accounting workspace. wallet-prepare and wallet-serve operate its Freighter provider. execute uses that same wallet and operator and the original explicit approval. inspect reopens the retained records.';
  if (!args.length || (args.length === 1 && args[0] === '--help')) { console.log(help); return; }
  const [nodeMajor,nodeMinor] = process.versions.node.split('.').map(Number);
  need(nodeMajor > 22 || nodeMajor === 22 && nodeMinor >= 16,'Use Node.js 22.16 or newer.');
  const action = args[0], options = {};
  need(['prepare','review','operator-init','wallet-prepare','wallet-serve','execute','inspect'].includes(action),'Choose an action shown by --help.');
  for (let index = 1; index < args.length; index += 2) {
    const name = args[index], value = args[index + 1];
    need(['--toolkit','--python','--payer'].includes(name) && value && !Object.hasOwn(options,name),'Use each documented option exactly once with its value.');
    options[name] = value;
  }
  need(!options['--payer'] || action === 'operator-init','--payer is an explicit operator-init input.');
  const original = await toolkit(options['--toolkit'],action.startsWith('wallet-') || action === 'execute');
  const state = await packet();
  const selectedPython = options['--python'] || 'python3';
  const resolvedPython = await execFile(selectedPython,['-I','-c','import os,sys;print(os.path.realpath(sys.executable))'],
    {encoding:'utf8',timeout:10000,maxBuffer:8192});
  const python = resolvedPython.stdout.trim();
  need(isAbsolute(python),'The receiving Python runtime must resolve to its original absolute executable.');
  await retain(state,action === 'prepare');
  if (action === 'prepare') {
    await command(python,[join(PACKET,'capture.py'),'restore','--source',join(PACKET,'source-http.json'),'--directory',state.capture]);
    await inspectCapture(state,python);
    await command(python,[join(PACKET,'capture.py'),'prepare','--capture',state.capture,
      '--checkout',original.checkout,'--directory',state.request,'--intent-id',state.input.intentId,'--node',process.execPath]);
    await inspectRequest(state,original.base);
    console.log(JSON.stringify({status:'AGENTSMITH_NATIVE_RECEIVING_PREPARED',directory:state.directory,intentId:state.input.intentId,reviewConfig:join(state.request,'review.json')}));
    return;
  }
  if (action === 'review') { await inspectCapture(state,python); await inspectRequest(state,original.base); return; }
  if (action === 'operator-init') {
    await inspectRequest(state,original.base);
    const payer = options['--payer'] || state.input.payer;
    need(/^G[A-Z2-7]{55}$/.test(payer || ''),'Supply the actual selected Freighter public account with --payer.');
    need(!state.input.payer || state.input.payer === payer,'The payer differs from the packet selection. Review the intended original account.');
    await initializeOperator(state,original.base,python,payer);
    return;
  }
  if (action.startsWith('wallet-') || action === 'execute') {
    await inspectRequest(state,original.base);
    await inspectOperator(state,original.base);
  }
  if (action === 'wallet-prepare') {
    need(await exists(join(state.operator,'operator.json')),'Initialize the original operator before preparing its wallet.');
    if (await exists(state.wallet)) await command(process.execPath,[join(original.base,WALLET),'inspect','--workspace',state.wallet]);
    else await command(process.execPath,[join(original.base,WALLET),'prepare','--buyer-config',join(state.operator,'operator.json'),'--out',state.wallet]);
    return;
  }
  if (action === 'wallet-serve') { await command(process.execPath,[join(original.base,WALLET),'serve','--workspace',state.wallet]); return; }
  if (action === 'execute') {
    await command(process.execPath,[join(original.base,WALLET),'execute','--workspace',state.wallet,'--operator-workspace',state.operator]); return;
  }
  const present = {};
  for (const [name,path] of Object.entries({capture:join(state.capture,'capture.json'),request:join(state.request,'preparation.json'),
    operator:join(state.operator,'operator.json'),wallet:state.wallet,response:join(state.request,'metar-result.json')})) present[name] = await exists(path);
  if (present.capture) await inspectCapture(state,python);
  if (present.request) await inspectRequest(state,original.base);
  if (present.operator) {
    await inspectOperator(state,original.base);
    await command(process.execPath,[join(original.base,BUYER),'--review-workspace','--dir',state.operator]);
  }
  console.log(JSON.stringify({status:'AGENTSMITH_RECEIVING_REOPENED',directory:state.directory,intentId:state.input.intentId,present,
    response:present.response ? {path:join(state.request,'metar-result.json'),bytes:(await lstat(join(state.request,'metar-result.json'))).size} : null}));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error.message); process.exitCode = Number.isInteger(error.exitCode) ? error.exitCode : 1;
});
