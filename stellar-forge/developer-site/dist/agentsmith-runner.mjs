#!/usr/bin/env node
// MIT. Receiving handoff for the original Stellar Forge buyer and wallet CLIs.
import {readFile, writeFile, mkdir, lstat} from 'node:fs/promises';
import {resolve, dirname, join, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn, execFile as execFileCallback} from 'node:child_process';
import {isDeepStrictEqual, promisify} from 'node:util';

const SCHEMA = 'stellar-forge.frontdoor-agentsmith-packet.v1';
const SOURCE = 'stellar/scf-starforge-20261009';
const PACKET = dirname(fileURLToPath(import.meta.url));
const BUYER = 'sf88-operator-buyer-cli/cli.mjs';
const WALLET = 'sf103-native-buyer-signer/browser-wallet/cli.mjs';
const CAPTURE_SHA = '60dd7f472ec518846f50c222160c53751554648f492d150f384b70fa05fb4381';
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
  const interrupt = () => child.kill('SIGINT'), terminate = () => child.kill('SIGTERM');
  process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
  try {
    const code = await new Promise((resolveCode, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => signal ? reject(new Error('Original command ended with ' + signal)) : resolveCode(code));
    });
    need(code === 0, 'The original command exited ' + code + '. Continue from the same retained operation shown above.');
  } finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate); }
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
    await mkdir(dirname(state.directory),{recursive:true,mode:0o700});
    await mkdir(state.directory,{mode:0o700});
    await writeFile(path,JSON.stringify({schema:SCHEMA,packetSha256:state.identity,
      sourceBundleSha256:state.input.sourceBundleSha256,intentId:state.input.intentId},null,2) + '\n',{flag:'wx',mode:0o600});
  }
  need(await exists(path), 'This directory already exists without this packet identity. Preserve its files and choose the matching saved packet.');
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
    if (!await exists(state.capture)) await command(python,[join(PACKET,'capture.py'),'restore','--source',join(PACKET,'source-http.json'),'--directory',state.capture]);
    await inspectCapture(state,python);
    if (!await exists(state.request)) await command(python,[join(PACKET,'capture.py'),'prepare','--capture',state.capture,
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
    if (await exists(state.operator)) {
      const retained = await json(join(state.operator,'operator.json'));
      need(retained.trustedPayer === payer,'The existing operator keeps its original payer.');
      await command(process.execPath,[join(original.base,BUYER),'--review-workspace','--dir',state.operator]);
    } else await command(process.execPath,[join(original.base,BUYER),'--init-workspace','--config',join(state.request,'review.json'),
      '--dir',state.operator,'--actor',state.input.actor,'--service','agentsmith-metar','--payer',payer,'--python',python]);
    return;
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
  if (present.operator) await command(process.execPath,[join(original.base,BUYER),'--review-workspace','--dir',state.operator]);
  console.log(JSON.stringify({status:'AGENTSMITH_RECEIVING_REOPENED',directory:state.directory,intentId:state.input.intentId,present,
    response:present.response ? {path:join(state.request,'metar-result.json'),bytes:(await lstat(join(state.request,'metar-result.json'))).size} : null}));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error.message); process.exitCode = 1;
});
