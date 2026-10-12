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
const PLUGIN = ['starforge-sf98-woo.php','checkout-gateway.php','checkout-admission.php',
  'merchant-console.php','merchant-console.js','merchant-console.css','OPERATIONS.md',
  'merchant-operator.php','NATIVE_REVIEW.md', 'merchant-refunds.php','merchant-refunds.js',
  'merchant-refunds.css','refund-networks.json','REFUNDS.md'];
const ENTRIES = {seller:WOO + '/seller.mjs', buyer:WOO + '/buyer.mjs',
  refund:WOO + '/refund-operator-cli.mjs',
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
node merchant.mjs refund --toolkit /absolute/checkout-or-installed-package -- inspect --config /private/woo-operator.json --order 123
node merchant.mjs agent-init --toolkit /absolute/checkout-or-installed-package [--input /private/agent-input.json]
node merchant.mjs agent-inspect --toolkit /absolute/checkout-or-installed-package --dir /private/merchant/agents
node merchant.mjs agent-client --toolkit /absolute/checkout-or-installed-package --dir /private/merchant/agents -- --merge /private/host.json --output /private/host-with-woo.json
node merchant.mjs agent-stdio --toolkit /absolute/checkout-or-installed-package --dir /private/merchant/agents

plugin copies the original PHP, browser assets and operating guide for WordPress.
prepare is offline and creates a NEW private directory plus the original plugin
folder. inspect reuses it. preflight sends an unsigned {} to the shop and creates
no order. serve / deliver run original foreground services with the existing
SF98_WEBHOOK_SECRET environment. buyer / operator / queue / refund forward only explicit
arguments to their original CLI, including its normal approval and wallet flow.
Read README.md and BUYER.md before operating a real merchant or buyer.
The original plugin's REFUNDS.md covers verified adjustment import, order credits
and recovery of the same saved WooCommerce refund.
agent-init composes the original Woo operator and merchant MCP initializer in
a new private directory. agent-inspect reopens its original stores offline.
agent-client merges the original stdio registration into a NEW host file.
agent-stdio launches that same provider. Read AGENTS.md for source aliases,
the existing WordPress manager environment and the first real merchant reads.`;

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

async function originalSource(toolkit, agent = false) {
  need(typeof toolkit === 'string' && isAbsolute(toolkit), 'Choose the absolute root of the original checkout or installed source package with --toolkit.');
  for (const base of [join(toolkit,SOURCE), join(toolkit,'source',SOURCE)]) {
    try {
      await regular(join(base,agent ? AGENT_ENTRIES.agentStdio : ENTRIES.seller));
    } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const path of (agent ? [...Object.values(AGENT_ENTRIES), WOO + '/merchant-operator.mjs']
      : [...Object.values(ENTRIES), ...PLUGIN.map(file => WOO + '/' + file)])) {
      try { await regular(join(base,path)); }
      catch { throw new Error(`This toolkit is missing ${path}. Use the complete maintained SF104 distribution or source checkout.`); }
    }
    return base;
  }
  throw new Error(agent
    ? 'This toolkit has no original merchant MCP stdio entry. Select its maintained source package or checkout.'
    : 'This toolkit has no original SF104 seller. Upgrade the maintained source package or select the full source checkout.');
}

async function sourceCommand(base, entry, args) {
  const child = spawn(process.execPath, [join(base,ENTRIES[entry] ?? AGENT_ENTRIES[entry]),...args], {stdio:'inherit',shell:false,env:process.env});
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


const AGENT_INPUT_SCHEMA = 'stellar-forge.frontdoor-woo-agents.v1';
const AGENT_SETUP_SCHEMA = 'stellar-forge.frontdoor-woo-agent-setup.v1';
const AGENT_ENTRIES = {
  agent: '../../stellar-forge/mcp-merchant-operator/serve.mjs',
  agentClient: '../../stellar-forge/mcp-merchant-operator/client-config.mjs',
  agentStdio: '../../stellar-forge/mcp-merchant-operator/stdio.mjs',
};
function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function agentPath(value, label) {
  need(typeof value === 'string' && isAbsolute(value) && resolve(value) === value &&
    value !== '/' && !/[\0\r\n]/.test(value), label + ' must be a normalized absolute host path.');
  return value;
}
async function agentModules(base) {
  const directory = resolve(base, '../../stellar-forge/mcp-merchant-operator');
  for (const file of ['config.mjs','woocommerce.mjs','client-config.mjs','stdio.mjs'])
    await regular(join(directory,file));
  const [configuration, registration, woo, original] = await Promise.all([
    import(pathToFileURL(join(directory,'config.mjs')).href),
    import(pathToFileURL(join(directory,'client-config.mjs')).href),
    import(pathToFileURL(join(directory,'woocommerce.mjs')).href),
    import(pathToFileURL(join(base,WOO,'merchant-operator.mjs')).href),
  ]);
  need(typeof configuration.initializeWooCommerceMerchant === 'function' &&
    typeof registration.createMerchantMcpClientConfiguration === 'function' &&
    typeof woo.MerchantWooCommerce === 'function',
    'Select the maintained toolkit with the Woo merchant MCP connection.');
  return {directory, ...configuration, ...registration, ...woo, ...original};
}
function agentPairs(values, allowed) {
  const options = Object.create(null);
  need(values.length % 2 === 0, 'Supply each agent option with its value. Use --help.');
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index], value = values[index + 1];
    need(allowed.includes(name) && !Object.hasOwn(options,name) && value && !value.startsWith('--'),
      'Unknown, repeated or incomplete agent option. Use --help.');
    options[name] = value;
  }
  return options;
}
async function agentInput(base, state, path, modules) {
  const input = await json(path, 1024 * 1024);
  need(plain(input) && input.schema === AGENT_INPUT_SCHEMA &&
    Object.keys(input).every(key => ['schema','directory','store','label','serverName','operator',
      'usernameEnv','applicationPasswordEnv','records','adjustments'].includes(key)),
    'Choose the packet agent-input.json. Use credential environment names in that file.');
  const directory = agentPath(input.directory,'Agent directory');
  need(typeof input.store === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(input.store) &&
    !['constructor','prototype'].includes(input.store), 'Choose a lowercase store alias.');
  need(typeof input.label === 'string' && input.label.trim() && input.label.length <= 160 &&
    !/[\0\r\n]/.test(input.label), 'Choose a short store label.');
  need(typeof input.serverName === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(input.serverName) &&
    !['constructor','prototype'].includes(input.serverName), 'Choose an MCP server name.');
  need(plain(input.records ?? {}) && plain(input.adjustments ?? {}), 'Receipt and accounting aliases must be objects.');
  for (const entry of Object.values(input.records ?? {})) {
    need(plain(entry),'Each receipt alias needs its original file and trusted payer.');
    agentPath(entry.file,'Original receipt file');
  }
  for (const entry of Object.values(input.adjustments ?? {})) {
    need(plain(entry),'Each accounting alias needs its original export root.');
    agentPath(entry.directory,'Original accounting export root');
  }
  const siteUrl = state.compiled.admissionUrl.slice(0, -'/wp-json/stellar-forge/v1/checkout-admission'.length);
  const external = input.operator === undefined ? null : agentPath(input.operator,'Existing operator');
  need(!external || input.usernameEnv === undefined && input.applicationPasswordEnv === undefined,
    'An existing operator supplies its original environment names. Remove usernameEnv and applicationPasswordEnv when selecting operator.');
  const rawOperator = external ? await json(external,65536) : {
    schema: modules.CONFIG_SCHEMA, siteUrl, usernameEnv:input.usernameEnv,
    applicationPasswordEnv:input.applicationPasswordEnv, outbox:state.raw.outbox,
    workspace:join(directory,'operations'), timeoutMs:15000,
  };
  const operator = modules.compileOperator(rawOperator);
  need(operator.siteUrl === siteUrl,
    'The selected operator must match this packet’s exact WordPress URL.');
  for (const source of [operator.outbox, ...(external ? [operator.workspace] : [])])
    need(directory !== source && !directory.startsWith(source + '/'),
      'Keep the new agent directory outside the original outbox and operator workspace.');
  if (external) need(external !== directory && !external.startsWith(directory + '/'),
    'Select the existing operator outside the new agent directory.');
  if (!external) {
    const saved = await json(state.config);
    need(isDeepStrictEqual(saved,state.raw), 'Prepare the matching original merchant configuration before creating its first operator.');
  }
  return {input,directory,siteUrl,external,rawOperator,operator};
}
async function prepareAgent(base, state, path) {
  const modules = await agentModules(base), selected = await agentInput(base,state,path,modules);
  const {input,directory,siteUrl,external,rawOperator,operator} = selected;
  const entryPath = join(modules.directory,'stdio.mjs');
  const configPath = join(directory,'host','merchant-mcp.json');
  const connection = {schema:modules.WOOCOMMERCE_CONNECTION_SCHEMA, stores:{
    [input.store]:{label:input.label, operator:external ?? './operator.json',
      records:input.records ?? {}, adjustments:input.adjustments ?? {}}}};
  await publishDirectory(directory,async staging => {
    if (!external) {
      await writeFile(join(staging,'operator.json'),JSON.stringify(rawOperator,null,2) + '\n',{flag:'wx',mode:0o600});
      for (const name of ['operations','operations/reviews','operations/refunds'])
        await mkdir(join(staging,name),{mode:0o700});
    }
    const connectionPath = join(staging,'woocommerce.json');
    await writeFile(connectionPath,JSON.stringify(connection,null,2) + '\n',{flag:'wx',mode:0o600});
    await modules.initializeWooCommerceMerchant({directory:join(staging,'host'),connection:connectionPath,name:input.label});
    // The original initializer creates its own stores. Keep its connection
    // relative to those stores when atomically publishing this NEW directory.
    const stagedConfig = join(staging,'host','merchant-mcp.json');
    const host = await json(stagedConfig);
    host.woocommerceConnection = '../woocommerce.json';
    await writeFile(stagedConfig,JSON.stringify(host,null,2) + '\n',{mode:0o600});
    await modules.readMerchantConfig(stagedConfig);
    const client = modules.createMerchantMcpClientConfiguration({
      configPath,name:input.serverName,entryPath,nodePath:process.execPath,
    });
    await writeFile(join(staging,'client.json'),JSON.stringify(client,null,2) + '\n',{flag:'wx',mode:0o600});
    await writeFile(join(staging,'agent-input.json'),await readFile(path),{flag:'wx',mode:0o600});
    const receipt = {schema:AGENT_SETUP_SCHEMA,createdAt:new Date().toISOString(),
      directory,store:input.store,label:input.label,serverName:input.serverName,siteUrl,
      outbox:operator.outbox,operator:external ?? join(directory,'operator.json'),
      workspace:operator.workspace,configuration:configPath,connection:join(directory,'woocommerce.json'),
      client:join(directory,'client.json'),entryPath,nodePath:process.execPath,
      source:resolve(base,'../..')};
    await writeFile(join(staging,'agent-setup.json'),JSON.stringify(receipt,null,2) + '\n',{flag:'wx',mode:0o600});
  });
  return inspectAgent(base,directory);
}
async function readAgent(base,directory) {
  directory = agentPath(directory,'Existing agent directory');
  const metadata = await lstat(directory);
  need(metadata.isDirectory() && !(metadata.mode & 0o077), 'Select the original private agent directory.');
  const saved = await json(join(directory,'agent-setup.json'));
  need(saved.schema === AGENT_SETUP_SCHEMA && saved.directory === directory &&
    saved.configuration === join(directory,'host','merchant-mcp.json') &&
    saved.connection === join(directory,'woocommerce.json') && saved.client === join(directory,'client.json'),
    'Reopen the original agent directory with its matching setup record.');
  const modules = await agentModules(base);
  need(saved.entryPath === join(modules.directory,'stdio.mjs') &&
    saved.source === resolve(base,'../..'), 'Use the same toolkit path as this prepared agent. For an intentional source relocation, use the new toolkit’s original client-config.mjs with the saved host configuration.');
  const config = await modules.readMerchantConfig(saved.configuration);
  const store = config.woocommerce?.stores[saved.store];
  need(store && store.operator.siteUrl === saved.siteUrl && store.operator.outbox === saved.outbox &&
    store.operator.workspace === saved.workspace, 'The original agent store or operator workspace changed.');
  return {saved,modules,config};
}
async function inspectAgent(base,directory) {
  const {saved,modules,config} = await readAgent(base,directory);
  const woo = new modules.MerchantWooCommerce(config);
  try {
    const stores = await woo.call('merchant_woo_stores',{});
    return {status:'WOO_AGENT_CONFIGURED',directory:saved.directory,configuration:saved.configuration,
      client:saved.client,serverName:saved.serverName,store:saved.store,siteUrl:saved.siteUrl,
      outbox:saved.outbox,workspace:saved.workspace,stores:stores.entries,
      credentialEnvironment:{username:config.woocommerce.stores[saved.store].operator.usernameEnv,
        applicationPassword:config.woocommerce.stores[saved.store].operator.applicationPasswordEnv},
      tools:modules.woocommerceTools(name => name),networkRequests:0};
  } finally { await woo.close(); }
}
async function agentAction(base,action,options,forwarded) {
  if (action === 'agent-init') {
    need(forwarded.length === 0,'agent-init accepts --input before the argument separator.');
    const selected = agentPairs(options,['--input']);
    const state = await setup(base);
    const result = await prepareAgent(base,state,resolve(selected['--input'] ?? join(PACKET,'agent-input.json')));
    console.log(JSON.stringify(result)); return;
  }
  const selected = agentPairs(options,['--dir']);
  need(selected['--dir'],'Select --dir /absolute/original-agent-directory.');
  const directory = agentPath(selected['--dir'],'Agent directory');
  if (action === 'agent-inspect') {
    need(forwarded.length === 0,'agent-inspect takes no forwarded arguments.');
    console.log(JSON.stringify(await inspectAgent(base,directory))); return;
  }
  const {saved} = await readAgent(base,directory);
  if (action === 'agent-client') {
    const clientOptions = agentPairs(forwarded,['--name','--merge','--output']);
    need(clientOptions['--output'],'Choose a new private --output file after -- for the original host registration.');
    const name = clientOptions['--name'] ?? saved.serverName;
    await sourceCommand(base,'agentClient',['--config',saved.configuration,'--name',name,
      ...(clientOptions['--merge'] ? ['--merge',clientOptions['--merge']] : []),
      '--output',clientOptions['--output']]);
    return;
  }
  need(forwarded.length === 0,'agent-stdio takes no forwarded arguments.');
  await sourceCommand(base,'agentStdio',['--config',saved.configuration]);
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 0 || (args.length === 1 && args[0] === '--help')) { console.log(help); return; }
  const [major,minor] = process.versions.node.split('.').map(Number);
  need(major > 22 || (major === 22 && minor >= 16), 'Use Node.js 22.16 or later.');
  const action = args[0], split = args.indexOf('--'), options = split < 0 ? args.slice(1) : args.slice(1,split);
  const forwarded = split < 0 ? [] : args.slice(split + 1);
  need(['plugin','prepare','inspect','preflight','serve','deliver','status','buyer','operator','queue','refund','agent-init','agent-inspect','agent-client','agent-stdio'].includes(action), 'Choose an action shown by --help.');
  if (action.startsWith('agent-')) {
    need(options[0] === '--toolkit' && options[1], 'Select --toolkit /absolute/checkout-or-installed-package first.');
    const base = await originalSource(options[1],true);
    await agentAction(base,action,options.slice(2),forwarded); return;
  }
  need(options[0] === '--toolkit' && (action === 'plugin' ? options.length === 4 && options[2] === '--out' : options.length === 2), 'Supply --toolkit /absolute/checkout-or-installed-package; plugin also requires --out /absolute/new-directory.');
  const base = await originalSource(options[1]);
  if (action === 'plugin') {
    need(forwarded.length === 0, 'plugin does not accept forwarded arguments.');
    await publishDirectory(options[3],staging => originalPlugin(base,join(staging,'starforge-sf98-woo')));
    console.log(JSON.stringify({status:'WOO_ORIGINAL_PLUGIN_PREPARED',pluginDirectory:join(options[3],'starforge-sf98-woo'),files:PLUGIN.length,networkRequests:0}));
    return;
  }
  if (['buyer','operator','queue','refund'].includes(action)) {
    need(forwarded.length > 0, 'Supply the original buyer, operator, queue or refund arguments after --.');
    await sourceCommand(base,action,forwarded); return;
  }
  need(forwarded.length === 0, 'Only buyer, operator, queue and refund accept arguments after --.');
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
