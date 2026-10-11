#!/usr/bin/env node
// MIT. Portable setup handoff. All payment, order, delivery and wallet behavior
// remains in the selected original toolkit. The Site includes these same bytes
// as merchant.mjs in a downloaded setup packet; this file is not a browser module.
import {constants} from 'node:fs';
import {readFile, mkdir, copyFile, lstat, writeFile, mkdtemp, rename, rm} from 'node:fs/promises';
import {basename, dirname, isAbsolute, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';

const SCHEMA = 'stellar-forge.frontdoor-woo-packet.v1';
const SOURCE = 'stellar/scf-starforge-20261009';
const WOO = 'sf104-woocommerce-merchant-bridge';
const PLUGIN = ['starforge-sf98-woo.php','checkout-gateway.php','checkout-admission.php'];
const ENTRIES = {seller:WOO + '/seller.mjs', buyer:WOO + '/buyer.mjs',
  operator:'sf88-operator-buyer-cli/cli.mjs', queue:'sf88-operator-buyer-cli/queue-cli.mjs',
  worker:'sf98-merchant-delivery/worker.mjs', status:'sf98-merchant-delivery/deliver.mjs'};
const PACKET = dirname(fileURLToPath(import.meta.url));
const help = `Stellar Forge Woo setup packet — original native tools

node merchant.mjs plugin --toolkit /absolute/checkout-or-installed-package --out /private/new-plugin-files
node merchant.mjs prepare --toolkit /absolute/checkout-or-installed-package
node merchant.mjs inspect --toolkit /absolute/checkout-or-installed-package
node merchant.mjs preflight --toolkit /absolute/checkout-or-installed-package
node merchant.mjs serve --toolkit /absolute/checkout-or-installed-package
node merchant.mjs deliver --toolkit /absolute/checkout-or-installed-package
node merchant.mjs status --toolkit /absolute/checkout-or-installed-package
node merchant.mjs buyer --toolkit /absolute/checkout-or-installed-package -- inspect --handoff /private/order.json
node merchant.mjs operator --toolkit /absolute/checkout-or-installed-package -- --review --config /private/review.json
node merchant.mjs queue --toolkit /absolute/checkout-or-installed-package -- show --root /private/inbox --intent EXACT_INTENT

plugin copies the original PHP files for an initial WordPress installation.
prepare is offline and creates a NEW private directory plus the original plugin
folder. inspect reuses it. preflight sends an unsigned {} to the shop and creates
no order. serve / deliver run original foreground services with the existing
SF98_WEBHOOK_SECRET environment. buyer / operator / queue forward only explicit
arguments to their original CLI, including its normal approval and wallet flow.
Read README.md and BUYER.md before operating a real merchant or buyer.`;

function need(value, message) { if (!value) throw new Error(message); }
async function regular(path) {
  const info = await lstat(path); need(info.isFile(), `Expected an original file at ${path}`); return info;
}
async function json(path, limit = 262144) {
  const info = await regular(path); need(info.size > 0 && info.size <= limit, 'Setup JSON exceeds the supported size.');
  const bytes = await readFile(path); need(bytes.length <= limit, 'Setup JSON exceeds the supported size.');
  return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
}
async function absentDirectory(path) {
  try { await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error('That private directory already exists. Use inspect/serve with its existing packet, or select an explicitly new directory.');
}
async function publishDirectory(destination,write) {
  need(typeof destination === 'string' && isAbsolute(destination) && resolve(destination) === destination && destination !== '/', 'Choose a new absolute output directory without a trailing slash.');
  await mkdir(dirname(destination),{recursive:true,mode:0o700});
  await absentDirectory(destination);
  const staging = await mkdtemp(join(dirname(destination),'.' + basename(destination) + '-prepare-'));
  try {
    await write(staging);
    await absentDirectory(destination);
    await rename(staging,destination);
  } catch (error) { await rm(staging,{recursive:true,force:true}).catch(() => {}); throw error; }
}
async function originalPlugin(base,destination) {
  await mkdir(destination,{recursive:true,mode:0o700});
  for (const file of PLUGIN) await copyFile(join(base,WOO,file),join(destination,file),constants.COPYFILE_EXCL);
}
async function smallResponse(response) {
  need(response.body, 'The shop returned an empty preflight response.');
  const reader = response.body.getReader(), chunks = []; let bytes = 0;
  try {
    for (;;) {
      const {done,value} = await reader.read(); if (done) break;
      bytes += value.byteLength; need(bytes <= 8192, 'The shop returned an unexpected preflight response.'); chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
}

async function originalSource(toolkit) {
  need(typeof toolkit === 'string' && isAbsolute(toolkit), 'Choose the absolute root of the original checkout or installed source package with --toolkit.');
  for (const base of [join(toolkit,SOURCE), join(toolkit,'source',SOURCE)]) {
    try {
      await regular(join(base,ENTRIES.seller));
    } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const path of [...Object.values(ENTRIES), ...PLUGIN.map(file => WOO + '/' + file)]) {
      try { await regular(join(base,path)); }
      catch { throw new Error(`This toolkit is missing ${path}. Use the complete maintained SF104 distribution or source checkout.`); }
    }
    return base;
  }
  throw new Error('This toolkit has no original SF104 seller. Upgrade the maintained source package or select the full source checkout.');
}

async function sourceCommand(base, entry, args) {
  const child = spawn(process.execPath, [join(base,ENTRIES[entry]),...args], {stdio:'inherit',shell:false,env:process.env});
  const stop = signal => { if (!child.killed) child.kill(signal); };
  const interrupt = () => stop('SIGINT'), terminate = () => stop('SIGTERM');
  process.once('SIGINT',interrupt); process.once('SIGTERM',terminate);
  try {
    const result = await new Promise((accept,reject) => {
      child.once('error',reject); child.once('exit',(code,signal) => accept({code,signal}));
    });
    if (result.code !== 0) {
      process.exitCode = result.code || (result.signal === 'SIGINT' ? 130 : 1);
      throw new Error('The original tool did not complete successfully. Review its output above before continuing.');
    }
  } finally { process.removeListener('SIGINT',interrupt); process.removeListener('SIGTERM',terminate); }
}

async function setup(base) {
  const input = await json(join(PACKET,'setup.json'));
  need(input.schema === SCHEMA && typeof input.privateDirectory === 'string' &&
    isAbsolute(input.privateDirectory) && resolve(input.privateDirectory) === input.privateDirectory && input.privateDirectory !== '/',
    'setup.json requires a new absolute private directory.');
  need(Array.isArray(input.routes) && input.routes.length >= 1 && input.routes.length <= 64 &&
    input.routes.every(path => typeof path === 'string' && /^routes\/product-[1-9][0-9]{0,17}\.json$/.test(path)) &&
    new Set(input.routes).size === input.routes.length, 'setup.json contains invalid route file paths.');
  const {compileMerchant,readJson} = await import(pathToFileURL(join(base,ENTRIES.seller)).href);
  const routeFiles = input.routes.map(path => join(PACKET,path));
  const raw = {schema:'stellar-forge.sf104.merchant.v1', storeOrigin:input.storeOrigin,
    admissionUrl:input.admissionUrl, outbox:join(input.privateDirectory,'outbox'),
    routes:await Promise.all(routeFiles.map(path => readJson(path)))};
  const compiled = compileMerchant(raw);
  const {publicUrl} = await import(pathToFileURL(join(base,ENTRIES.buyer)).href);
  const facilitator = publicUrl(input.facilitatorUrl);
  need(!facilitator.search && !facilitator.href.endsWith('?'), 'Configure the actual facilitator URL without a query string.');
  const settlementUrl = compiled.admissionUrl.replace(/checkout-admission$/, 'settlement');
  need(input.settlementUrl === settlementUrl, 'The settlement endpoint must match the same configured WordPress REST base.');
  return {input,raw,compiled,routeFiles,settlementUrl,config:join(input.privateDirectory,'merchant.json')};
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 0 || (args.length === 1 && args[0] === '--help')) { console.log(help); return; }
  const [major,minor] = process.versions.node.split('.').map(Number);
  need(major > 22 || (major === 22 && minor >= 16), 'Use Node.js 22.16 or later.');
  const action = args[0], split = args.indexOf('--'), options = split < 0 ? args.slice(1) : args.slice(1,split);
  const forwarded = split < 0 ? [] : args.slice(split + 1);
  need(['plugin','prepare','inspect','preflight','serve','deliver','status','buyer','operator','queue'].includes(action), 'Choose an action shown by --help.');
  need(options[0] === '--toolkit' && (action === 'plugin' ? options.length === 4 && options[2] === '--out' : options.length === 2), 'Supply --toolkit /absolute/checkout-or-installed-package; plugin also requires --out /absolute/new-directory.');
  const base = await originalSource(options[1]);
  if (action === 'plugin') {
    need(forwarded.length === 0, 'plugin does not accept forwarded arguments.');
    await publishDirectory(options[3],staging => originalPlugin(base,join(staging,'starforge-sf98-woo')));
    console.log(JSON.stringify({status:'WOO_ORIGINAL_PLUGIN_PREPARED',pluginDirectory:join(options[3],'starforge-sf98-woo'),files:3,networkRequests:0}));
    return;
  }
  if (['buyer','operator','queue'].includes(action)) {
    need(forwarded.length > 0, 'Supply the original buyer, operator or queue arguments after --.');
    await sourceCommand(base,action,forwarded); return;
  }
  need(forwarded.length === 0, 'Only buyer, operator and queue accept arguments after --.');
  const state = await setup(base);
  if (action === 'prepare') {
    await publishDirectory(state.input.privateDirectory,async staging => {
      // Compile/copy the whole new directory before publishing it. The native
      // config already binds the FINAL outbox path; no service uses staging.
      await sourceCommand(base,'seller',['prepare',...state.routeFiles.flatMap(path => ['--route',path]),
        '--store-origin',state.compiled.storeOrigin,'--admission-url',state.compiled.admissionUrl,
        '--outbox',state.raw.outbox,'--out',join(staging,'merchant.json')]);
      const stagedPlugin = join(staging,'wordpress-plugin','starforge-sf98-woo');
      await originalPlugin(base,stagedPlugin);
      await mkdir(join(staging,'routes'),{mode:0o700});
      for (const [index,path] of state.input.routes.entries())
        await writeFile(join(staging,path),await readFile(state.routeFiles[index]),{flag:'wx',mode:0o600});
    });
    const plugin = join(state.input.privateDirectory,'wordpress-plugin','starforge-sf98-woo');
    console.log(JSON.stringify({status:'WOO_SETUP_PREPARED',privateDirectory:state.input.privateDirectory,
      pluginDirectory:plugin,config:state.config,routes:state.raw.routes.length,networkRequests:0}));
    return;
  }
  const saved = await json(state.config);
  need(isDeepStrictEqual(saved,state.raw), 'The prepared merchant config differs from this packet. Reopen its matching setup-input.json or operate that configuration with the original native CLI.');
  if (action === 'inspect') { await sourceCommand(base,'seller',['inspect','--config',state.config]); return; }
  if (action === 'preflight') {
    const {createPublicHttpsFetch} = await import(pathToFileURL(join(base,'sf31-buyer-client/public-transport.mjs')).href);
    const response = await createPublicHttpsFetch({timeoutMs:5000})(state.compiled.admissionUrl,
      {method:'POST',redirect:'manual',headers:{'content-type':'application/json'},body:'{}'});
    const text = await smallResponse(response);
    let result; try { result = JSON.parse(text); } catch { throw new Error('The shop did not return the WordPress plugin JSON. Check HTTPS ingress, pretty permalinks and REST rewrites.'); }
    need(response.status === 401 && result.schema === 'stellar-forge.sf104.checkout-admission-result.v1' &&
      result.status === 'INVALID_SIGNATURE_OR_TIMESTAMP', 'The shop preflight did not reach the configured plugin signature check. Review the original GATEWAY.md REST setup.');
    console.log(JSON.stringify({status:'WOO_ADMISSION_HTTP_READY',httpStatus:401,ordersCreated:0,reservationsCreated:0})); return;
  }
  if (action === 'serve') {
    await sourceCommand(base,'seller',['serve','--config',state.config,'--facilitator',state.input.facilitatorUrl,
      '--port','8423','--operations-port','8424']); return;
  }
  if (action === 'deliver') {
    await sourceCommand(base,'worker',['run','--state',state.raw.outbox,'--url',state.settlementUrl,
      '--allow-host',new URL(state.settlementUrl).hostname,'--secret-env','SF98_WEBHOOK_SECRET']); return;
  }
  await sourceCommand(base,'status',['status','--state',state.raw.outbox]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode ||= 1; });
}
