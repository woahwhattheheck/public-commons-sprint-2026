#!/usr/bin/env node
// MIT. One new OpenFEMA testnet purchase inside the complete original receiving.
// Host commissioning follows maintained WordPress native/testnet.mjs (4c62463a)
// and NocoDB testnet-consumer.mjs (40afbe0c). Original SF30/SF82/SF88/SF81/SF36/SF43
// remain the merchant, payment, approval, ledger and customer delivery engines.
import assert from 'node:assert/strict';
import {constants,fstatSync} from 'node:fs';
import {readFile,open,mkdir,lstat,realpath,rename,chmod} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {createServer as httpServer,request as httpRequest} from 'node:http';
import {createServer as httpsServer} from 'node:https';
import {createServer as netServer,connect} from 'node:net';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const SELF=fileURLToPath(import.meta.url),HERE=dirname(SELF);
const SCF='stellar/scf-starforge-20261009',NETWORK='stellar:testnet';
const OPERATION='SCF-OPENFEMA-PORTFOLIO-3BDA-20261012';
const SOURCE_SHA='580f2b88274a9d74070d03b636840863a11ab3c21270da9d8a63840524b58077';
const RPC='https://soroban-testnet.stellar.org';
const HORIZON='https://horizon-testnet.stellar.org',FRIENDBOT='https://friendbot.stellar.org';
const PAYER_ENV='OPENFEMA_RECEIVING_PAYER_SECRET',MERCHANT_ENV='OPENFEMA_RECEIVING_MERCHANT_SECRET';
const PROXY_ENV='OPENFEMA_RECEIVING_HTTPS_PROXY',LOCK_ENV='OPENFEMA_RECEIVING_LEASE_FD';
const HASH=/^[a-f0-9]{64}$/;
const jsonBytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const hash=value=>createHash('sha256').update(value).digest('hex');
const blob=value=>createHash('sha1').update(Buffer.concat([Buffer.from('blob '+value.length+'\0'),value])).digest('hex');
const time=()=>new Date().toISOString();
const fail=(code,message=code)=>Object.assign(new Error(message),{code});
const requireValue=(condition,code,message)=>{if(!condition)throw fail(code,message);};
const abs=(value,name)=>{
 requireValue(typeof value==='string'&&isAbsolute(value)&&resolve(value)===value&&value!=='/'&&!/[\0\r\n]/.test(value),'ABSOLUTE_PATH_REQUIRED',name);
 return value;
};
const contains=(parent,child)=>{const value=relative(parent,child);return value===''||!isAbsolute(value)&&value!=='..'&&!value.startsWith('..'+sep);};
const delay=milliseconds=>new Promise(done=>setTimeout(done,milliseconds));

const SOURCE_PINS={
  "native-facilitator/runtime.mjs": "e6122ca867d0417404048e271d1fe179c0abc88f",
  "native-facilitator/server.mjs": "64377fb2a1cc9b46d18edd4af1f5201a37a7c493",
  "sf88-operator-buyer-cli/workspace.mjs": "736b7377ba9229d9accca4c64602ca4610e2e9d9",
  "sf88-operator-buyer-cli/queue.mjs": "1dbc63e9c9e3450a0978482d9b53919116bb3208",
  "sf88-operator-buyer-cli/execute.mjs": "f37ffcd4dfa0f5319b9749bb91bfe07b3b0e8113",
  "sf88-operator-buyer-cli/finalization.mjs": "cbe6123f3affedf9247a79b6139b04d4ba96339d",
  "sf88-operator-buyer-cli/queue-dataset.mjs": "66799c09b9d96549742b371c49d84ab2703987b7",
  "sf81-buyer-operator-bridge/browser-approval.mjs": "fdd43b323bcb85032971b86d3c765b2495aba6ab",
  "sf43-agent-commerce/verify.mjs": "262d68a31e5c9f41e9809a3f45c77d4e39bd5d60",
  "sf82-checkout-evidence/evidence.mjs": "513f6735a8b358526d13916347d5f9d1f15c6133",
  "sf30-seller-sdk/openfema/examples/native-portfolio-receiving.mjs": "84cd5e525926673b33694ccd5a46d8d7e1b1f844",
  "sf30-seller-sdk/openfema/core.mjs": "abf2034fc2149257c748567d5d2cd51f6a8e14a4",
  "sf30-seller-sdk/openfema/workspace.mjs": "b1aa63e5920a03a2cf15b8f94e6d02f6d8e2fb7c",
  "sf30-seller-sdk/openfema/application.mjs": "9173462a6ec34657245812aec2055eac9b9abd18",
  "sf30-seller-sdk/openfema/web/app.js": "7107dc76c917bb7edcb901823453cdbbeba6f0b2",
  "sf30-seller-sdk/stellar-expert/dataset.mjs": "b708ebd3ec4b169e88044e3f5a8ea00ac1c4f4aa"
};

async function privateDirectory(path, create = false) {
  if (create) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    try { await mkdir(path, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const info = await lstat(path);
  requireValue(info.isDirectory() && !info.isSymbolicLink() && !(info.mode & 0o077) &&
    await realpath(path) === path, 'PRIVATE_DIRECTORY_REQUIRED', path);
}
async function privateBytes(path, optional = false, maximum = 16 * 1024 * 1024) {
  let file;
  try { file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
  try {
    const info = await file.stat();
    requireValue(info.isFile() && info.nlink === 1 && !(info.mode & 0o077) && info.size <= maximum,
      'PRIVATE_REGULAR_FILE_REQUIRED', path);
    const bytes = await file.readFile();
    requireValue(bytes.length <= maximum, 'PRIVATE_FILE_LIMIT_EXCEEDED', path);
    return bytes;
  } finally { await file.close(); }
}
async function readJson(path, optional = false) {
  const bytes = await privateBytes(path, optional);
  return bytes === null ? null : JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
async function saveBytes(path, bytes, { createOnly = false } = {}) {
  await privateDirectory(dirname(path));
  const temporary = path + '.' + randomUUID() + '.partial';
  const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY |
    (constants.O_NOFOLLOW ?? 0), 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  if (createOnly) {
    // The inherited kernel operation lease serializes these owned private names.
    // Publish complete bytes atomically; an existing retained record is never replaced.
    try { await lstat(path); throw fail('RETAINED_OPERATION_RECORD_EXISTS', path); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await rename(temporary, path);
  } else {
    const old = await privateBytes(path, true);
    if (old !== null) requireValue(!(await lstat(path)).isSymbolicLink(), 'PRIVATE_TARGET_CHANGED');
    await rename(temporary, path);
  }
  const parent = await open(dirname(path), 'r');
  try { await parent.sync(); } finally { await parent.close(); }
}
const save = (path, value, options) => saveBytes(path, jsonBytes(value), options);
async function retain(path, value) {
  const bytes = jsonBytes(value), previous = await privateBytes(path, true);
  if (previous) assert.deepEqual(previous, bytes, 'Retained operation input changed: ' + path);
  else await saveBytes(path, bytes, { createOnly: true });
  return { file: path, sha256: hash(bytes), bytes: bytes.length };
}
async function waitFor(action, code, milliseconds = 120000) {
  const deadline = Date.now() + milliseconds;
  do {
    const result = await action(); if (result) return result;
    await new Promise(done => setTimeout(done, 1500));
  } while (Date.now() < deadline);
  throw fail(code);
}
async function availablePort() {
  const server = netServer();
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const port = server.address().port;
  await new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
  return port;
}

function startChild(command,args,options={}) {
 const child=spawn(command,args,options);
 let killTimer,settled=false;
 const completion=new Promise((done,reject)=>{
  child.once('error',error=>{settled=true;clearTimeout(killTimer);reject(error);});
  child.once('close',(code,signal)=>{settled=true;clearTimeout(killTimer);done({code,signal});});
 });
 completion.catch(()=>{}); // Keep early spawn failures retained until their owner awaits completion.
 const stop=async(signal='SIGTERM')=>{
  if(!settled) {
   child.kill(signal);
   killTimer??=setTimeout(()=>{if(!settled)child.kill('SIGKILL');},60000);
  }
  return await completion;
 };
 return {child,completion,stop,get settled(){return settled;}};
}
async function subprocess(command,args,options={}) {
 const running=startChild(command,args,options),term=()=>{running.stop('SIGTERM').catch(()=>{});},interrupt=()=>{running.stop('SIGINT').catch(()=>{});};
 process.on('SIGTERM',term);process.on('SIGINT',interrupt);
 try{return await running.completion;}finally{process.off('SIGTERM',term);process.off('SIGINT',interrupt);}
}
async function leaseDescriptor(ctx) {
 const number=Number(process.env[LOCK_ENV]);
 requireValue(Number.isSafeInteger(number)&&number>=3,'ORIGINAL_OPERATION_LEASE_REQUIRED');
 const inherited=fstatSync(number),saved=await lstat(join(ctx.output,'operation.lock'));
 requireValue(inherited.isFile()&&inherited.dev===saved.dev&&inherited.ino===saved.ino&&
  inherited.nlink===1&&!(inherited.mode&0o077),'ORIGINAL_OPERATION_LEASE_CHANGED');
 return number;
}

async function selectedSdk(ctx) {
 const require=createRequire(join(ctx.input.sourceRoot,SCF,'native-facilitator/runtime.mjs'));
 const selected=[['@x402/core/facilitator','@x402/core'],['@x402/stellar/exact/facilitator','@x402/stellar'],
  ['@x402/extensions/bazaar','@x402/extensions'],['@stellar/stellar-sdk','@stellar/stellar-sdk']];
 const identities=[];
 for(const [entry,name]of selected) {
  let directory=dirname(require.resolve(entry)),found=null;
  for(;;) {
   try {
    const raw=await readFile(join(directory,'package.json')),pkg=JSON.parse(raw);
    if(pkg.name===name) {requireValue(typeof pkg.version==='string','NATIVE_PACKAGE_VERSION_REQUIRED');
     requireValue(pkg.version===({'@stellar/stellar-sdk':'16.3.0'}[name]??'2.28.0'),'ORIGINAL_NATIVE_PACKAGE_VERSION_CHANGED',name);
     found={name,version:pkg.version,packageJsonSha256:hash(raw)};break;}
   }catch(error){if(error.code!=='ENOENT')throw error;}
   const parent=dirname(directory);if(parent===directory)break;directory=parent;
  }
  requireValue(found!==null,'NATIVE_PACKAGE_IDENTITY_REQUIRED',name);identities.push(found);
 }
 await retain(join(ctx.output,'native-packages.json'),{schema:'stellar-forge.openfema-native-packages.v1',identities});
 return require('@stellar/stellar-sdk');
}
async function selectedIntent(ctx,source) {
 const path=join(ctx.output,'intent.json');
 let intent=await readJson(path,true);
 if(intent) {
  requireValue(intent.schema==='stellar-forge.openfema-testnet-intent.v1'&&intent.operationId===ctx.input.operationId&&
   intent.inputSha256===ctx.inputSha256,'ORIGINAL_HOST_SELECTION_CHANGED');
  assert.deepEqual(intent.source,source,'The retained native source or helper changed.');
 } else {
  const used=new Set(),ports={};
  for(const name of ['merchant','facilitator','tls','proxy']) {
   let port;do{port=await availablePort();}while(used.has(port));used.add(port);ports[name]=port;
  }
  intent={schema:'stellar-forge.openfema-testnet-intent.v1',operationId:ctx.input.operationId,
   inputSha256:ctx.inputSha256,createdAt:time(),source,ports};
  await save(path,intent,{createOnly:true});
 }
 return intent;
}
async function accountObservation(address) {
  const response = await fetch(HORIZON + '/accounts/' + address,
    { redirect: 'error', signal: AbortSignal.timeout(30000) });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (response.status === 404) return null;
  requireValue(response.status === 200, 'TESTNET_ACCOUNT_READ_FAILED');
  const value = JSON.parse(bytes);
  requireValue(value.account_id === address && Array.isArray(value.balances), 'TESTNET_ACCOUNT_IDENTITY_CHANGED');
  return { address, observedAt: time(), responseSha256: hash(bytes), responseBytes: bytes.length,
    ledger: value.last_modified_ledger, sequence: value.sequence,
    nativeBalance: value.balances.find(item => item.asset_type === 'native')?.balance ?? null };
}
async function prepareAccounts(ctx, nativeSdk, intent) {
  const path = join(ctx.output, 'dedicated-testnet-accounts.private.json');
  let accounts = await readJson(path, true);
  if (!accounts) {
    const payer = nativeSdk.Keypair.random(), merchant = nativeSdk.Keypair.random();
    accounts = { schema: 'stellar-forge.openfema-dedicated-testnet-accounts.v1',
      operationId: ctx.input.operationId, createdAt: time(), network: NETWORK,
      payer: { address: payer.publicKey(), secret: payer.secret() },
      merchant: { address: merchant.publicKey(), secret: merchant.secret() } };
    await save(path, accounts, { createOnly: true });
  }
  requireValue(accounts.schema === 'stellar-forge.openfema-dedicated-testnet-accounts.v1' &&
    accounts.operationId === ctx.input.operationId && accounts.network === NETWORK &&
    accounts.payer.address !== accounts.merchant.address, 'DEDICATED_ACCOUNT_BINDING_CHANGED');
  for (const role of ['payer', 'merchant']) {
    assert.equal(nativeSdk.Keypair.fromSecret(accounts[role].secret).publicKey(), accounts[role].address);
    intent.funding ??= {};
    if (intent.funding[role]) {
      assert.equal(intent.funding[role].address, accounts[role].address);
      if (intent.funding[role].state === 'ACCOUNT_OBSERVED') continue;
    }
    let observed = await accountObservation(accounts[role].address);
    if (!observed && !intent.funding[role]) {
      intent.funding[role] = { address: accounts[role].address, state: 'DISPATCHED', requestedAt: time() };
      await save(join(ctx.output, 'intent.json'), intent); // before the state-changing free faucet GET
      try {
        const response = await fetch(FRIENDBOT + '/?addr=' + encodeURIComponent(accounts[role].address),
          { redirect: 'error', signal: AbortSignal.timeout(90000) });
        const bytes = Buffer.from(await response.arrayBuffer());
        await saveBytes(join(ctx.output, role + '-original-friendbot-response.json'), bytes);
        Object.assign(intent.funding[role], { responseAt: time(), httpStatus: response.status,
          responseSha256: hash(bytes), responseBytes: bytes.length });
        await save(join(ctx.output, 'intent.json'), intent);
      } catch (error) {
        intent.funding[role].observation = 'FUNDING_RESPONSE_UNRESOLVED';
        await save(join(ctx.output, 'intent.json'), intent);
      }
    }
    if (!observed) observed = await waitFor(() => accountObservation(accounts[role].address),
      'FUNDING_RESPONSE_UNRESOLVED_KEEP_SAME_ACCOUNTS', 120000);
    intent.funding[role] = { ...intent.funding[role], address: accounts[role].address,
      state: 'ACCOUNT_OBSERVED', observed };
    await save(join(ctx.output, 'intent.json'), intent);
  }
  return accounts;
}
async function openssl(ctx, args, logFile) {
  const log = await open(logFile, 'a', 0o600);
  try {
    const result = await subprocess(ctx.input.openssl, args, {
      env: process.env, stdio: ['ignore', log.fd, log.fd],
    });
    requireValue(result.code === 0, 'OWNED_TLS_CERTIFICATE_SETUP_FAILED');
  } finally { await log.close(); }
}
async function prepareTls(ctx) {
  const directory = join(ctx.output, 'tls'); await privateDirectory(directory, true);
  const manifestFile = join(directory, 'manifest.json');
  let manifest = await readJson(manifestFile, true);
  if (!manifest) {
    const generation = 'generation-' + randomUUID(), selected = join(directory, generation);
    await privateDirectory(selected, true);
    const config = [
      '[req]', 'distinguished_name=dn', 'prompt=no', '[dn]', 'CN=' + ctx.origin.hostname,
      '[server]', 'basicConstraints=critical,CA:FALSE', 'keyUsage=critical,digitalSignature,keyEncipherment',
      'extendedKeyUsage=serverAuth', 'subjectAltName=DNS:' + ctx.origin.hostname, '',
    ].join('\n');
    await saveBytes(join(selected, 'server.cnf'), Buffer.from(config));
    const log = join(selected, 'openssl.log');
    await openssl(ctx, ['req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-days', '30', '-nodes',
      '-subj', '/CN=OpenFEMA receiving private ingress CA', '-keyout', join(selected, 'ca-key.pem'),
      '-out', join(selected, 'ca.pem'), '-addext', 'basicConstraints=critical,CA:TRUE',
      '-addext', 'keyUsage=critical,keyCertSign,cRLSign'], log);
    await openssl(ctx, ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256',
      '-config', join(selected, 'server.cnf'), '-keyout', join(selected, 'server-key.pem'),
      '-out', join(selected, 'server.csr')], log);
    await openssl(ctx, ['x509', '-req', '-in', join(selected, 'server.csr'),
      '-CA', join(selected, 'ca.pem'), '-CAkey', join(selected, 'ca-key.pem'), '-CAcreateserial',
      '-out', join(selected, 'server.pem'), '-days', '7', '-sha256',
      '-extfile', join(selected, 'server.cnf'), '-extensions', 'server'], log);
    await openssl(ctx, ['verify', '-CAfile', join(selected, 'ca.pem'),
      '-verify_hostname', ctx.origin.hostname, join(selected, 'server.pem')], log);
    const inherited = process.env.NODE_EXTRA_CA_CERTS ? await readFile(process.env.NODE_EXTRA_CA_CERTS) : Buffer.alloc(0);
    requireValue(inherited.length <= 16 * 1024 * 1024, 'INHERITED_CA_BUNDLE_TOO_LARGE');
    await saveBytes(join(selected, 'trust.pem'), Buffer.concat([inherited, Buffer.from('\n'), await readFile(join(selected, 'ca.pem'))]));
    const files = [];
    for (const name of ['ca-key.pem', 'ca.pem', 'server-key.pem', 'server.pem', 'trust.pem']) {
      await chmod(join(selected, name), 0o600);
      const file = await open(join(selected, name), 'r');
      try { await file.sync(); } finally { await file.close(); }
      const bytes = await privateBytes(join(selected, name));
      files.push({ name, sha256: hash(bytes), bytes: bytes.length });
    }
    manifest = { schema: 'stellar-forge.openfema-owned-tls.v1', operationId: ctx.input.operationId,
      hostname: ctx.origin.hostname, generation, createdAt: time(), files };
    await save(manifestFile, manifest, { createOnly: true });
  }
  requireValue(manifest.operationId === ctx.input.operationId && manifest.hostname === ctx.origin.hostname &&
    /^generation-[a-f0-9-]{36}$/.test(manifest.generation), 'OWNED_TLS_IDENTITY_CHANGED');
  const selected = join(directory, manifest.generation);
  await privateDirectory(selected);
  for (const file of manifest.files) {
    requireValue(['ca-key.pem', 'ca.pem', 'server-key.pem', 'server.pem', 'trust.pem'].includes(file.name),
      'OWNED_TLS_FILE_INVALID');
    const bytes = await privateBytes(join(selected, file.name));
    assert.equal(hash(bytes), file.sha256); assert.equal(bytes.length, file.bytes);
  }
  return { directory: selected, manifest, trustFile: join(selected, 'trust.pem') };
}

async function openIngress({ tls, hostname, merchantPort, tlsPort, proxyPort }) {
  // This is the existing fleet host-ingress pattern, outside original SF31.
  // TLS terminates only for the reviewed owned .test name. The explicit proxy
  // also tunnels the fixed public RPC destination; SF31 still verifies its TLS.
  const sockets = new Set(), tunnels = { merchant: 0, rpc: 0 };
  const track = socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); };
  const ingress = httpsServer({ key: await privateBytes(join(tls.directory, 'server-key.pem')),
    cert: await privateBytes(join(tls.directory, 'server.pem')), minVersion: 'TLSv1.2' }, (req, res) => {
    if (req.headers.host !== hostname && req.headers.host !== hostname + ':443') {
      res.writeHead(421); res.end(); return;
    }
    const outgoing = httpRequest({ hostname: '127.0.0.1', port: merchantPort,
      method: req.method, path: req.url, headers: req.headers }, incoming => {
      res.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(res);
    });
    outgoing.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.on('aborted', () => outgoing.destroy()); res.on('close', () => outgoing.destroy());
    req.pipe(outgoing);
  });
  const proxy = httpServer((_req, res) => { res.writeHead(405); res.end(); });
  for (const server of [ingress, proxy]) server.on('connection', track);
  const rpcHost = new URL(RPC).hostname;
  proxy.on('connect', (req, socket, head) => {
    const merchant = req.url === hostname + ':443', rpc = req.url === rpcHost + ':443';
    if ((!merchant && !rpc) || head.length || req.headers['proxy-authorization']) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    const destination = connect({ host: merchant ? '127.0.0.1' : rpcHost, port: merchant ? tlsPort : 443 }, () => {
      tunnels[merchant ? 'merchant' : 'rpc']++;
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      socket.pipe(destination); destination.pipe(socket);
    });
    track(destination);
    destination.setTimeout(180000, () => destination.destroy());
    destination.on('error', () => socket.destroy()); socket.on('error', () => destination.destroy());
    destination.on('close', () => socket.destroy()); socket.on('close', () => destination.destroy());
  });
  const listen = (server, port) => new Promise((done, reject) => {
    server.once('error', reject); server.listen(port, '127.0.0.1', done);
  });
  let closing;
  const close = () => closing ??= (async () => {
    const pending = [proxy, ingress].map(server => new Promise(done => {
      if (!server.listening) { done(); return; }
      server.close(done); server.closeIdleConnections?.();
    }));
    // Original buyer, merchant and facilitator are drained before this owner closes.
    for (const socket of sockets) socket.destroy();
    await Promise.all(pending);
  })();
  try { await listen(ingress, tlsPort); await listen(proxy, proxyPort); }
  catch (error) { await close(); throw error; }
  return { url: 'http://127.0.0.1:' + proxyPort, tunnels, close };
}


async function loadInput(path){
 abs(path,'input');const raw=await privateBytes(path,false,65536);
 const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
 requireValue(input.schema==='stellar-forge.openfema-testnet-host.v1'&&input.operationId===OPERATION,
  'OPENFEMA_HOST_SELECTION_INVALID');
 requireValue(process.platform!=='win32'&&process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0','VERIFIED_POSIX_NATIVE_HOST_REQUIRED');
 for(const key of ['sourceRoot','operationDirectory','bundleFile','python','openssl'])abs(input[key],key);
 requireValue(/^[a-f0-9]{40}$/.test(input.sourceRef??''),'ORIGINAL_SOURCE_REFERENCE_REQUIRED');
 requireValue(Boolean(input.chromium)===Boolean(input.playwrightModule),'EXISTING_BROWSER_PAIR_REQUIRED');
 if(input.chromium){abs(input.chromium,'chromium');abs(input.playwrightModule,'playwrightModule');}
 const origin=new URL(input.origin);
 requireValue(origin.protocol==='https:'&&origin.origin===input.origin&&!origin.port&&
  /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.test$/.test(origin.hostname),'OWNED_TEST_ORIGIN_REQUIRED');
 requireValue(input.path==='/openfema-dr4724','ORIGINAL_OPENFEMA_ROUTE_REQUIRED');
 requireValue(input.amountAtomic==='50000'&&input.maxTotalAtomic===input.amountAtomic&&input.maxTimeoutSeconds===120,
  'SINGLE_ORIGINAL_TESTNET_BUDGET_REQUIRED');
 for(const key of ['sourceRoot','python','openssl',...(input.chromium?['chromium','playwrightModule']:[])]){
  const canonical=await realpath(input[key]),info=await lstat(canonical);
  requireValue(key==='sourceRoot'?info.isDirectory():info.isFile(),'INSTALLED_RUNTIME_REQUIRED',key);
  input[key]=canonical;
 }
 requireValue(!contains(input.sourceRoot,input.operationDirectory)&&!contains(input.operationDirectory,input.sourceRoot),
  'PRIVATE_STATE_OUTSIDE_SOURCE_REQUIRED');
 return {input,inputFile:path,inputSha256:hash(raw),origin,output:join(input.operationDirectory,'commissioning'),
  work:join(input.operationDirectory,'native-work'),results:join(input.operationDirectory,'results'),
  buyer:join(input.operationDirectory,'buyer'),inbox:join(input.operationDirectory,'inbox')};
}
async function checkedSource(ctx){
 const files=[];
 for(const [path,expected]of Object.entries(SOURCE_PINS)){
  const raw=await readFile(join(ctx.input.sourceRoot,SCF,path));
  assert.equal(blob(raw),expected,'Selected original source changed: '+path);
  files.push({path:SCF+'/'+path,gitBlob:expected,bytes:raw.length,sha256:hash(raw)});
 }
 const self=await readFile(SELF);
 return {schema:'stellar-forge.openfema-testnet-source.v1',sourceRef:ctx.input.sourceRef,files,
  commissioner:{path:SELF,sha256:hash(self),bytes:self.length},node:process.version};
}
async function prepareBuyer(ctx,intent,terms,environment){
 const merchant={origin:ctx.origin.origin,path:ctx.input.path,payment:{
  scheme:'exact',network:NETWORK,asset:terms.asset,payTo:terms.recipient,amount:terms.amountAtomic,
  maxTimeoutSeconds:ctx.input.maxTimeoutSeconds,extra:{areFeesSponsored:true,paymentFlow:'authorization'}}};
 const merchantFile=join(ctx.output,'merchant.json'),runtimeFile=join(ctx.output,'seller-runtime.json');
 await retain(merchantFile,merchant);
 await retain(runtimeFile,{port:intent.ports.merchant,facilitator:'http://127.0.0.1:'+intent.ports.facilitator,allowLocalFacilitator:true});
 const intentId='openfema:'+hash(OPERATION+':original-dr4724-dataset').slice(0,48);
 const buyerFile=join(ctx.output,'buyer-template.json');
 await retain(buyerFile,{operation:{intentId,url:ctx.origin.origin+ctx.input.path+'?limit=250',method:'GET',
  expect:{scheme:'exact',network:NETWORK,asset:terms.asset,payTo:terms.recipient,
   maxAtomic:terms.amountAtomic,maxTimeoutSeconds:ctx.input.maxTimeoutSeconds,paymentFlow:'authorization'}},
  requestTimeoutMs:120000});
 const {initializeWorkspace}=await import(pathToFileURL(join(ctx.input.sourceRoot,SCF,'sf88-operator-buyer-cli/workspace.mjs')));
 let exists=true;try{await lstat(ctx.buyer);}catch(error){if(error.code!=='ENOENT')throw error;exists=false;}
 const initialized=await initializeWorkspace(['--config',buyerFile,'--dir',ctx.buyer,
  '--actor','openfema-native-receiving','--service','openfema-dr4724-portfolio',
  '--payer',terms.payer,'--python',ctx.input.python,'--secret-env',PAYER_ENV,'--rpc',RPC,
  '--https-proxy-env',PROXY_ENV,'--total-atomic',ctx.input.maxTotalAtomic,'--daily-atomic',ctx.input.maxTotalAtomic],
  {environment,resume:exists});
 await save(join(ctx.output,'buyer-initialization.json'),initialized);
 const native=await import(pathToFileURL(join(ctx.input.sourceRoot,SCF,'sf88-operator-buyer-cli/queue.mjs')));
 let queueExists=true;try{await lstat(ctx.inbox);}catch(error){if(error.code!=='ENOENT')throw error;queueExists=false;}
 await native.initializeQueue(ctx.inbox,{resume:queueExists});
 return {merchantFile,runtimeFile,intentId,native,environment};
}
async function approveOriginal(ctx,broker,job,terms,decided){
 const review=broker.snapshot(job.operation.intentId);
 if(review?.state!=='AWAITING_OPERATOR'||decided.has(review.id))return;
 const op=job.operation,accepted=review.review.complete_original_accepted_terms;
 requireValue(review.intentId===op.intentId&&review.review.request_id===op.intentId&&
  review.current_native_budget_estimate.approved===true&&review.review.resource===op.url&&
  review.review.method==='GET'&&review.review.body_present===false&&job.bodySha256===null&&
  op.method==='GET'&&op.url===ctx.origin.origin+ctx.input.path+'?limit=250'&&
  op.expect.scheme==='exact'&&op.expect.network===NETWORK&&op.expect.asset===terms.asset&&
  op.expect.payTo===terms.recipient&&op.expect.maxAtomic===terms.amountAtomic&&
  review.review.max_atomic_units_to_reserve===terms.amountAtomic&&
  accepted.scheme==='exact'&&accepted.network===NETWORK&&accepted.asset===terms.asset&&
  accepted.payTo===terms.recipient&&accepted.amount===terms.amountAtomic&&
  accepted.extra?.areFeesSponsored===true&&(accepted.extra?.paymentFlow??'authorization')==='authorization'&&
  Number.isSafeInteger(accepted.maxTimeoutSeconds)&&accepted.maxTimeoutSeconds>=1&&
  accepted.maxTimeoutSeconds<=ctx.input.maxTimeoutSeconds&&HASH.test(review.review.request_sha256),
  'ORIGINAL_OPENFEMA_REVIEW_CHANGED');
 const filename=join(ctx.output,'approvals',hash(op.intentId)+'-'+review.id+'.json');
 await retain(filename,{schema:'stellar-forge.openfema-testnet-review.v1',operationId:OPERATION,
  intentId:op.intentId,approvalId:review.id,requestSha256:review.review.request_sha256,
  configSha256:job.configSha256,sourceConfigSha256:job.sourceConfigSha256,originalReview:review,
  authorization:{network:NETWORK,payer:terms.payer,recipient:terms.recipient,asset:terms.asset,
   maximumPayments:1,maxTotalAtomic:ctx.input.maxTotalAtomic,amountAtomic:terms.amountAtomic},
  decision:'approve'});
 broker.decide({intent:op.intentId,approvalId:review.id,requestSha256:review.review.request_sha256,decision:'approve'});
 decided.add(review.id);
 console.log(JSON.stringify({event:'openfema.original-purchase-approved',intentId:op.intentId,amountAtomic:terms.amountAtomic}));
}
async function purchaseOriginal(ctx,prepared,broker,terms,selected,signal){
 requireValue(selected.sourceSha256===SOURCE_SHA&&selected.route===ctx.input.path&&
  HASH.test(selected.dataset?.snapshot??'')&&selected.dataset?.id&&selected.workspaceId,
  'ORIGINAL_OPENFEMA_PRODUCT_REQUIRED');
 const listener=new URL(selected.listener);
 requireValue(listener.protocol==='http:'&&listener.hostname==='127.0.0.1'&&
  Number(listener.port)===prepared.merchantPort,'ORIGINAL_SELECTED_MERCHANT_CHANGED');
 const binding={schema:'stellar-forge.openfema-testnet-purchase-selection.v1',operationId:OPERATION,
  intentId:prepared.intentId,inbox:ctx.inbox,buyerWorkspace:ctx.buyer,workspaceId:selected.workspaceId,
  sourceSha256:SOURCE_SHA,releaseId:selected.releaseId,releaseDigest:selected.digest,
  datasetId:selected.dataset.id,snapshot:selected.dataset.snapshot,rows:195,
  url:ctx.origin.origin+ctx.input.path+'?limit=250',terms};
 await retain(join(ctx.output,'purchase-selection.json'),binding);
 const responseFile=join(ctx.output,'original-paid-dataset.json');
 const combined=await prepared.native.workspaceConfiguration(ctx.buyer,{configuration:{
  responseFile:{destination:responseFile,maxBytes:2*1024*1024,timeoutMs:120000,expectedContentType:'application/json'},
  captureBody:false}});
 const configFile=join(ctx.output,'queued-buyer.json');await retain(configFile,combined.configuration);
 const queue=await prepared.native.openQueue(ctx.inbox);
 let job=await queue.enqueue(configFile);
 assert.equal(job.operation.intentId,prepared.intentId);assert.equal(job.operation.url,binding.url);
 const decided=new Set();
 if(!job.attempt){
  let complete=false,runError;
  const running=queue.run(prepared.intentId,{workspace:ctx.buyer,environment:prepared.environment,signal})
   .then(value=>{job=value;},error=>{runError=error;}).finally(()=>{complete=true;});
  try{
   while(!complete){await approveOriginal(ctx,broker,job,terms,decided);if(!complete)await delay(100);}
  }catch(error){broker.revoke(prepared.intentId);await running;throw error;}
  await running;if(runError)throw runError;
 }else{
  // Observe the same retained attempt; its original queue permits only one run.
  const evidence=await import(pathToFileURL(join(ctx.input.sourceRoot,SCF,'sf82-checkout-evidence/evidence.mjs')));
  if(!job.outcome?.evidencePath){
   let observed;
   try{observed=await evidence.recoverCheckoutEvidence({outputDir:join(ctx.buyer,'evidence'),
    intentId:prepared.intentId,trustedPayer:terms.payer,rpcEndpoint:RPC});}
   catch(error){if(error.code!=='ENOENT')throw error;observed={checkpointAvailable:false};}
   await save(join(ctx.output,'same-attempt-checkout-recovery.json'),observed);
  }
  try{job=await queue.recover(prepared.intentId);}
  catch(error){if(error.code!=='ENOENT')throw error;}
 }
 await save(join(ctx.output,'original-inbox-outcome.json'),job);
 const outcome=job.outcome,saved=outcome?.responseFile;
 requireValue(job.attempt?.kind==='EXECUTE'&&outcome?.intentId===prepared.intentId&&
  outcome.status==='DELIVERED_REPORTED_SETTLED'&&outcome.httpStatus>=200&&outcome.httpStatus<300&&
  saved?.status==='SAVED'&&saved.path===responseFile&&HASH.test(saved.sha256??''),
  'ORIGINAL_SAME_ATTEMPT_DELIVERY_REQUIRED',
  'Inspect '+join(ctx.output,'original-inbox-outcome.json')+' and its original evidence; this intent is retained.');
 const body=await privateBytes(responseFile,false,2*1024*1024);
 assert.equal(body.length,saved.bytes);assert.equal(hash(body),saved.sha256);
 const page=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));
 requireValue(page.dataset?.snapshot===binding.snapshot&&Array.isArray(page.rows)&&page.rows.length===195&&
  page.page?.nextCursor===null&&page.page?.total===195,'ORIGINAL_COMPLETE_OPENFEMA_DATASET_REQUIRED');
 const evidenceBytes=await privateBytes(job.evidencePath,false,4*1024*1024),evidence=JSON.parse(evidenceBytes);
 const buyer=evidence.observation?.buyer;
 requireValue(evidence.intentId===prepared.intentId&&buyer?.status==='DELIVERED_REPORTED_SETTLED'&&
  buyer.receipt?.success===true&&buyer.receipt.network===NETWORK&&HASH.test(buyer.receipt.transaction??'')&&
  buyer.requirement?.network===NETWORK&&buyer.requirement.asset===terms.asset&&
  buyer.requirement.payTo===terms.recipient&&buyer.requirement.amount===terms.amountAtomic&&
  evidence.operatorReservation?.requestId===prepared.intentId&&
  evidence.operatorReservation.reservedAtomicUnits===terms.amountAtomic,'ORIGINAL_PAID_EVIDENCE_REQUIRED');
 const verify=await import(pathToFileURL(join(ctx.input.sourceRoot,SCF,'sf43-agent-commerce/verify.mjs')));
 let chain=evidence.observation.chain;
 if(chain?.status!=='TOKEN_TRANSFER_MATCHED_TESTNET'){
  const decoder=await verify.createOfficialEventDecoder(),deadline=Date.now()+180000;
  do{
   chain=await verify.checkStellarTestnetTransaction({receipt:{...buyer.receipt,payer:terms.payer},
    expected:{network:NETWORK,asset:terms.asset,payTo:terms.recipient,amount:terms.amountAtomic,payer:terms.payer},
    rpcEndpoint:RPC,decodeContractEvent:decoder});
   await save(join(ctx.output,'original-chain-observation.json'),{intentId:prepared.intentId,observedAt:time(),chain});
   if(chain.status==='TOKEN_TRANSFER_MATCHED_TESTNET')break;
   if(signal.aborted)throw fail('ORIGINAL_OPERATION_INTERRUPTED');
   await delay(3000);
  }while(Date.now()<deadline);
 }
 requireValue(chain?.status==='TOKEN_TRANSFER_MATCHED_TESTNET'&&chain.transaction===buyer.receipt.transaction&&
  chain.payer===terms.payer&&chain.recipient===terms.recipient&&chain.contractId===terms.asset&&
  chain.amountAtomic===terms.amountAtomic,'ORIGINAL_TESTNET_TRANSFER_REQUIRED');
 const {finalizeQueueIntent}=await import(pathToFileURL(join(ctx.input.sourceRoot,SCF,'sf88-operator-buyer-cli/finalization.mjs')));
 const finalized=await finalizeQueueIntent({root:ctx.inbox,intentId:prepared.intentId,workspace:ctx.buyer,signal});
 await save(join(ctx.output,'original-ledger-finalization.json'),finalized);
 const finality=finalized.finalization?.result;
 requireValue(['FINALIZED','IDEMPOTENT_FINALIZED'].includes(finality?.outcome)&&
  finality.request_id===prepared.intentId&&String(finality.actual)===terms.amountAtomic,'ORIGINAL_LEDGER_FINALITY_REQUIRED');
 const result={schema:'stellar-forge.openfema-testnet-purchase.v1',operationId:OPERATION,intentIds:[prepared.intentId],
  inboxDirectory:ctx.inbox,workspace:ctx.buyer,releaseId:selected.releaseId,releaseDigest:selected.digest,
  snapshot:binding.snapshot,rows:195,transaction:chain.transaction,ledger:chain.ledger,
  payer:terms.payer,recipient:terms.recipient,asset:terms.asset,amountAtomic:terms.amountAtomic,
  evidence:{path:job.evidencePath,sha256:hash(evidenceBytes),bytes:evidenceBytes.length},
  response:{path:responseFile,sha256:hash(body),bytes:body.length},
  finalization:{outcome:finality.outcome,actualAtomic:terms.amountAtomic,requestSha256:finality.request_sha256},
  originalAttemptId:job.attempt.id,completedAt:time()};
 await save(join(ctx.output,'purchase-complete.json'),result);
 console.log(JSON.stringify({event:'openfema.original-testnet-purchase-complete',intentId:prepared.intentId,
  transaction:result.transaction,snapshot:result.snapshot,rows:195,amountAtomic:terms.amountAtomic}));
 return result;
}
async function hostPhase(ctx){
 await leaseDescriptor(ctx);const source=await checkedSource(ctx),intent=await selectedIntent(ctx,source);
 const accounts=await readJson(join(ctx.output,'dedicated-testnet-accounts.private.json'));
 requireValue(accounts.operationId===OPERATION&&accounts.network===NETWORK,'DEDICATED_ACCOUNT_BINDING_CHANGED');
 const sdk=await selectedSdk(ctx);
 for(const role of ['payer','merchant'])assert.equal(sdk.Keypair.fromSecret(accounts[role].secret).publicKey(),accounts[role].address);
 const terms={operationId:OPERATION,network:NETWORK,origin:ctx.origin.origin,path:ctx.input.path,
  payer:accounts.payer.address,recipient:accounts.merchant.address,asset:sdk.Asset.native().contractId(sdk.Networks.TESTNET),
  amountAtomic:ctx.input.amountAtomic,maxTotalAtomic:ctx.input.maxTotalAtomic,maximumPayments:1};
 await retain(join(ctx.output,'terms.json'),terms);
 const tls=await prepareTls(ctx);assert.equal(process.env.NODE_EXTRA_CA_CERTS,tls.trustFile);
 process.env[PAYER_ENV]=accounts.payer.secret;process.env[MERCHANT_ENV]=accounts.merchant.secret;
 for(const key of ['SF36_CONSENT_KEY_B64','SF36_AUDIT_KEY_B64','SF36_OPERATOR_KEY_B64'])delete process.env[key];
 const {createNativeFacilitator}=await import(pathToFileURL(join(ctx.input.sourceRoot,SCF,'native-facilitator/runtime.mjs')));
 const {startFacilitatorServer}=await import(pathToFileURL(join(ctx.input.sourceRoot,SCF,'native-facilitator/server.mjs')));
 const {createBrowserApprovalBroker}=await import(pathToFileURL(join(ctx.input.sourceRoot,SCF,'sf81-buyer-operator-bridge/browser-approval.mjs')));
 const resultFile=join(ctx.results,'TESTNET_RECEIVING.json'),previous=await readJson(resultFile,true);
 if(previous?.passed){
  assert.equal(previous.inputSha256,ctx.inputSha256);
  assert.equal(hash(await privateBytes(previous.nativeAcceptance.file,false,32*1024*1024)),previous.nativeAcceptance.sha256);
  console.log(JSON.stringify({event:'openfema.testnet-receiving-reused',operationId:OPERATION,result:resultFile,passed:true}));return previous;
 }
 const result={schema:'stellar-forge.openfema-testnet-receiving.v1',operationId:OPERATION,
  inputSha256:ctx.inputSha256,source,terms,startedAt:time(),passed:false};
 const controller=new AbortController(),interrupt=()=>controller.abort(fail('ORIGINAL_OPERATION_INTERRUPTED'));
 process.on('SIGTERM',interrupt);process.on('SIGINT',interrupt);
 let facilitator,facilitatorHost,ingress,broker,acceptance,primaryError;
 try{
  const configuration={schema:'stellar-forge.native-facilitator.v1',network:NETWORK,rpcUrl:RPC,
   signers:[{address:terms.recipient,secretEnv:MERCHANT_ENV}],
   payments:{assets:[terms.asset],recipients:[terms.recipient],maxAtomic:terms.amountAtomic,paymentFlows:['authorization']},
   limits:{maxTransactionFeeStroops:50000,inclusionFeeStroops:100,maxVerifyInFlight:4,maxSettleInFlight:1,drainGraceMs:60000},
   operations:{ownershipDirectory:join(ctx.output,'facilitator-ownership'),rpcTimeoutMs:30000,
    readinessMaxAgeMs:30000,maxLedgerAgeSeconds:120,requireReady:true}};
  await retain(join(ctx.output,'native-facilitator.json'),configuration);
  facilitator=await createNativeFacilitator(configuration,{environment:process.env});
  facilitatorHost=await startFacilitatorServer({facilitator,port:intent.ports.facilitator});
  ingress=await openIngress({tls,hostname:ctx.origin.hostname,merchantPort:intent.ports.merchant,
   tlsPort:intent.ports.tls,proxyPort:intent.ports.proxy});
  process.env[PROXY_ENV]=ingress.url;broker=await createBrowserApprovalBroker();
  const environment={...process.env,...broker.environment,NODE_TLS_REJECT_UNAUTHORIZED:'1'};
  const prepared=await prepareBuyer(ctx,intent,terms,environment);prepared.merchantPort=intent.ports.merchant;
  const {main}=await import(pathToFileURL(join(ctx.input.sourceRoot,SCF,'sf30-seller-sdk/openfema/examples/native-portfolio-receiving.mjs')));
  acceptance=await main(['--bundle',ctx.input.bundleFile,'--directory',ctx.work,'--source-ref',ctx.input.sourceRef,
   '--terms-file',prepared.merchantFile,'--release-runtime',prepared.runtimeFile,
   ...(ctx.input.chromium?['--chromium',ctx.input.chromium,'--playwright',ctx.input.playwrightModule]:[])],{
    testnet:{inboxDirectory:ctx.inbox,selection:{schema:'stellar-forge.openfema-testnet-selection.v1',
     operationId:OPERATION,inputSha256:ctx.inputSha256,intentId:prepared.intentId,buyerWorkspace:ctx.buyer,terms},
     purchase:selected=>purchaseOriginal(ctx,prepared,broker,terms,selected,controller.signal)}});
  requireValue(acceptance.state==='COMPLETE'&&acceptance.steps.customer?.files?.reopened?.files===5,
   'ORIGINAL_FIVE_FILE_CUSTOMER_RECEIVING_REQUIRED');
  const actual=await privateBytes(join(ctx.work,'native-portfolio-receiving.json'),false,32*1024*1024);
  result.nativeAcceptance={file:join(ctx.work,'native-portfolio-receiving.json'),sha256:hash(actual),bytes:actual.length,
   summary:acceptance.summary};
  result.purchase=await readJson(join(ctx.output,'purchase-complete.json'));
  requireValue(result.purchase.intentIds.length===1&&result.purchase.amountAtomic===ctx.input.maxTotalAtomic,
   'ORIGINAL_COMMISSIONED_PAYMENT_COUNT_CHANGED');
  result.facilitator=facilitator.status();result.passed=true;
 }catch(error){primaryError=error;result.error={code:error.code??error.name,message:String(error.message).slice(0,4000)};}
 finally{
  const failures=[];
  if(broker)try{await broker.close();}catch(error){failures.push({resource:'approval',message:error.message});}
  if(facilitatorHost)try{result.facilitatorDrain=await facilitatorHost.close();
   if(result.facilitatorDrain.drained!==true)failures.push({resource:'facilitator',message:'Original native operations are still draining.'});
  }catch(error){failures.push({resource:'facilitator',message:error.message});}
  else if(facilitator)try{await facilitator.drain();}catch(error){failures.push({resource:'facilitator',message:error.message});}
  if(ingress)try{result.ingress=ingress.tunnels;await ingress.close();}catch(error){failures.push({resource:'ingress',message:error.message});}
  process.off('SIGTERM',interrupt);process.off('SIGINT',interrupt);
  result.resourcesClosed=failures.length===0;result.cleanupFailures=failures;result.finishedAt=time();
  if(!result.resourcesClosed||controller.signal.aborted)result.passed=false;
  await save(resultFile,result);
  console.log(JSON.stringify({event:'openfema.testnet-receiving-complete',operationId:OPERATION,passed:result.passed,
   resourcesClosed:result.resourcesClosed,result:resultFile,transaction:result.purchase?.transaction,
   customerFiles:acceptance?.steps?.customer?.files?.reopened?.files,error:result.error}));
 }
 if(!result.passed)throw primaryError??fail('OPENFEMA_TESTNET_RECEIVING_NOT_COMPLETE');
 return result;
}
async function lockedPhase(ctx){
 const lease=await leaseDescriptor(ctx),source=await checkedSource(ctx),intent=await selectedIntent(ctx,source);
 for(const path of [ctx.results,join(ctx.output,'approvals')])await privateDirectory(path,true);
 const previous=await readJson(join(ctx.results,'TESTNET_RECEIVING.json'),true);
 if(previous?.passed){
  assert.equal(previous.inputSha256,ctx.inputSha256);
  assert.equal(hash(await privateBytes(previous.nativeAcceptance.file,false,32*1024*1024)),previous.nativeAcceptance.sha256);
  console.log(JSON.stringify({event:'openfema.testnet-receiving-reused',operationId:OPERATION,result:join(ctx.results,'TESTNET_RECEIVING.json'),passed:true}));return;
 }
 const sdk=await selectedSdk(ctx),accounts=await prepareAccounts(ctx,sdk,intent),tls=await prepareTls(ctx);
 const completed=await subprocess(process.execPath,[SELF,'--host',ctx.inputFile],{env:{
  ...process.env,[LOCK_ENV]:'3',NODE_EXTRA_CA_CERTS:tls.trustFile,NODE_TLS_REJECT_UNAUTHORIZED:'1',
  [PAYER_ENV]:accounts.payer.secret,[MERCHANT_ENV]:accounts.merchant.secret},
  stdio:['inherit','inherit','inherit',lease]});
 requireValue(completed.code===0,'ORIGINAL_OPENFEMA_HOST_NOT_COMPLETE');
}
const PYTHON_LEASE=String.raw`import fcntl, os, stat, sys
lock, node, script, input_path = sys.argv[1:]
fd = os.open(lock, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
s = os.fstat(fd)
if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1 or s.st_mode & 0o077:
    raise SystemExit("PRIVATE_OPERATION_LEASE_REQUIRED")
try:
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    raise SystemExit("ORIGINAL_RECEIVING_OPERATION_ACTIVE")
os.set_inheritable(fd, True)
os.environ["OPENFEMA_RECEIVING_LEASE_FD"] = str(fd)
os.execv(node, [node, script, "--locked-input", input_path])
`;
async function main(){
 requireValue(process.argv.length===4&&['--input','--locked-input','--host'].includes(process.argv[2]),
  'Use: node testnet-commissioning.mjs --input /absolute/openfema-testnet-host.json');
 const ctx=await loadInput(process.argv[3]);
 if(process.argv[2]==='--input'){
  await privateDirectory(ctx.input.operationDirectory,true);await privateDirectory(ctx.output,true);
  const completed=await subprocess(ctx.input.python,['-I','-B','-c',PYTHON_LEASE,
   join(ctx.output,'operation.lock'),process.execPath,SELF,ctx.inputFile],{env:process.env,stdio:'inherit'});
  process.exitCode=completed.code??1;
 }else if(process.argv[2]==='--locked-input')await lockedPhase(ctx);else await hostPhase(ctx);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 main().catch(error=>{console.error(JSON.stringify({schema:'stellar-forge.openfema-testnet-error.v1',
  code:error.code??error.name,message:String(error.message).slice(0,4000)}));process.exitCode=1;});
export {main as commissionOpenFemaTestnet};
