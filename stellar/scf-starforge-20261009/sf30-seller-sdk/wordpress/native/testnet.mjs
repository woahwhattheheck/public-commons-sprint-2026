#!/usr/bin/env node
// MIT. Dedicated testnet commissioning for the same complete WordPress receiving.
// Account, funding and TLS lifecycle compose the original NocoDB native consumer
// (40afbe0c); original SF30/SF82/SF88/SF81/SF36/SF43 own every payment and delivery.
import assert from 'node:assert/strict';
import {constants,fstatSync} from 'node:fs';
import {readFile,open,mkdir,lstat,realpath,rename,chmod,readdir,unlink} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {createServer as httpServer,request as httpRequest} from 'node:http';
import {createServer as httpsServer} from 'node:https';
import {createServer as netServer,connect} from 'node:net';
import {dirname,basename,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const SELF=fileURLToPath(import.meta.url),HERE=dirname(SELF);
const SCF='stellar/scf-starforge-20261009',NETWORK='stellar:testnet';
const RPC='https://soroban-testnet.stellar.org';
const HORIZON='https://horizon-testnet.stellar.org',FRIENDBOT='https://friendbot.stellar.org';
const PAYER_ENV='WORDPRESS_RECEIVING_PAYER_SECRET',MERCHANT_ENV='WORDPRESS_RECEIVING_MERCHANT_SECRET';
const PROXY_ENV='WORDPRESS_RECEIVING_HTTPS_PROXY',LOCK_ENV='WORDPRESS_RECEIVING_LEASE_FD';
const HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const jsonBytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const hash=value=>createHash('sha256').update(value).digest('hex');
const blob=value=>createHash('sha1').update(Buffer.concat([Buffer.from('blob '+value.length+'\0'),value])).digest('hex');
const time=()=>new Date().toISOString();
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
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
  "sf88-operator-buyer-cli/dataset-session.mjs": "e1dc725bb6a0d43a69328a1f306c3261063f46b6",
  "sf81-buyer-operator-bridge/browser-approval.mjs": "fdd43b323bcb85032971b86d3c765b2495aba6ab",
  "sf30-seller-sdk/socrata/publisher.mjs": "f029528f7feb0e4c9d52ede00314d8c7eb8a9280",
  "sf30-seller-sdk/wordpress/native/journey.mjs": "13fd6cb86b0e9069264b9f93ecae4fda721c659b",
  "sf30-seller-sdk/wordpress/native/seed.php": "b3acc5400af2e693cb80a89467df39cbb8324e06",
  "sf30-seller-sdk/wordpress/native/prepare.mjs": "549737ce2a640c447fd3aa6d524633cbb62b9182",
  "sf30-seller-sdk/wordpress/native/component-source.json": "4f32402434a5f404441474916ae9650bd00de940",
  "sf30-seller-sdk/wordpress/native/mu-plugin.php": "45b107b554bfa67eb116a9182fa26860114b9b66",
  "sf30-seller-sdk/wordpress/native/receive.py": "38e5b3031f00ea8d123e7e6712996abf7ad96903",
  "sf82-checkout-evidence/evidence.mjs": "513f6735a8b358526d13916347d5f9d1f15c6133",
  "sf43-agent-commerce/verify.mjs": "262d68a31e5c9f41e9809a3f45c77d4e39bd5d60"
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
    await new Promise(done => setTimeout(done, 250));
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

async function nativePath(path,kind) {
 abs(path,kind);
 const canonical=await realpath(path),info=await lstat(canonical);
 requireValue(kind==='directory'?info.isDirectory():info.isFile(),'INSTALLED_RUNTIME_REQUIRED',path);
 return canonical;
}
async function loadInput(path) {
 abs(path,'input');
 const raw=await readFile(path);requireValue(raw.length<=65536,'HOST_SELECTION_TOO_LARGE');
 const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
 requireValue(input.schema==='stellar-forge.wordpress-testnet-host.v1'&&
  /^[A-Za-z0-9][A-Za-z0-9._-]{2,120}$/.test(input.operationId??''),'WORDPRESS_HOST_SELECTION_INVALID');
 requireValue(process.platform!=='win32'&&process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0','VERIFIED_POSIX_NATIVE_HOST_REQUIRED');
 for(const key of ['sourceRoot','nativeHelper','operationDirectory','python','openssl','chromium','playwrightModule','php','wordpressCore','sqlite'])
  abs(input[key],key);
 requireValue(basename(input.sourceRoot)==='source','ORIGINAL_RELEASE_SOURCE_LAYOUT_REQUIRED');
 const origin=new URL(input.origin);
 requireValue(origin.protocol==='https:'&&origin.origin===input.origin&&!origin.port&&
  /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.test$/.test(origin.hostname),'OWNED_TEST_ORIGIN_REQUIRED');
 requireValue(input.path==='/wordpress-native','WORDPRESS_NATIVE_RESOURCE_REQUIRED');
 requireValue(/^[1-9][0-9]{0,6}$/.test(input.amountAtomic??'')&&
  Number.isSafeInteger(input.maxPages)&&input.maxPages>=2&&input.maxPages<=4096&&
  /^[1-9][0-9]{0,18}$/.test(input.maxTotalAtomic??'')&&
  BigInt(input.maxTotalAtomic)===BigInt(input.amountAtomic)*BigInt(input.maxPages)&&
  BigInt(input.maxTotalAtomic)<=9223372036854775807n,'EXACT_TESTNET_BUDGET_REQUIRED');
 requireValue(input.maxTimeoutSeconds===120,'NATIVE_PAYMENT_TIMEOUT_REQUIRED');
 for(const key of ['sourceRoot','wordpressCore','sqlite'])assert.equal(await nativePath(input[key],'directory'),input[key]);
 for(const key of ['nativeHelper','python','openssl','chromium','playwrightModule','php'])assert.equal(await nativePath(input[key],'file'),input[key]);
 requireValue(!contains(input.sourceRoot,input.operationDirectory)&&!contains(input.operationDirectory,input.sourceRoot),'PRIVATE_STATE_OUTSIDE_SOURCE_REQUIRED');
 const output=join(input.operationDirectory,'commissioning');
 return {input,inputFile:path,inputSha256:hash(raw),origin,output,
  work:join(input.operationDirectory,'native-work'),results:join(input.operationDirectory,'results'),
  buyer:join(input.operationDirectory,'buyer'),selector:join(input.operationDirectory,'selected.json')};
}
async function checkedSource(ctx) {
 const root=ctx.input.sourceRoot,source=join(root,SCF,'sf30-seller-sdk/wordpress');
 const componentRaw=await readFile(join(HERE,'component-source.json')),component=JSON.parse(componentRaw);
 requireValue(component.schema==='stellar-forge.wordpress-native-source.v1'&&Object.keys(component.files).length===19,'ORIGINAL_WORDPRESS_COMPONENT_REQUIRED');
 const files=[];
 for(const [name,expected]of Object.entries(component.files)) {
  const bytes=await readFile(join(source,name));assert.equal(blob(bytes),expected,'Original WordPress source changed: '+name);
  files.push({path:SCF+'/sf30-seller-sdk/wordpress/'+name,gitBlob:expected,sha256:hash(bytes),bytes:bytes.length});
 }
 for(const [name,expected]of Object.entries(SOURCE_PINS)) {
  const bytes=await readFile(join(root,SCF,name));assert.equal(blob(bytes),expected,'Original native contract changed: '+name);
  files.push({path:SCF+'/'+name,gitBlob:expected,sha256:hash(bytes),bytes:bytes.length});
 }
 const helper=await readFile(ctx.input.nativeHelper),self=await readFile(SELF);
 return {schema:'stellar-forge.wordpress-testnet-source.v1',componentRef:component.sourceRef,
  originalContractsRef:'f167c3e524b782ceb6dd196df81f6b97886442a9',files,
  helper:{path:ctx.input.nativeHelper,bytes:helper.length,sha256:hash(helper)},
  commissioning:{path:SELF,bytes:self.length,sha256:hash(self)},node:process.version};
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
     found={name,version:pkg.version,packageJsonSha256:hash(raw)};break;}
   }catch(error){if(error.code!=='ENOENT')throw error;}
   const parent=dirname(directory);if(parent===directory)break;directory=parent;
  }
  requireValue(found!==null,'NATIVE_PACKAGE_IDENTITY_REQUIRED',name);identities.push(found);
 }
 await retain(join(ctx.output,'native-packages.json'),{schema:'stellar-forge.wordpress-native-packages.v1',identities});
 return require('@stellar/stellar-sdk');
}
async function selectedIntent(ctx,source) {
 const path=join(ctx.output,'intent.json');
 let intent=await readJson(path,true);
 if(intent) {
  requireValue(intent.schema==='stellar-forge.wordpress-testnet-intent.v1'&&intent.operationId===ctx.input.operationId&&
   intent.inputSha256===ctx.inputSha256,'ORIGINAL_HOST_SELECTION_CHANGED');
  assert.deepEqual(intent.source,source,'The retained native source or helper changed.');
 } else {
  const used=new Set(),ports={};
  for(const name of ['merchant','facilitator','tls','proxy']) {
   let port;do{port=await availablePort();}while(used.has(port));used.add(port);ports[name]=port;
  }
  intent={schema:'stellar-forge.wordpress-testnet-intent.v1',operationId:ctx.input.operationId,
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
    accounts = { schema: 'stellar-forge.wordpress-dedicated-testnet-accounts.v1',
      operationId: ctx.input.operationId, createdAt: time(), network: NETWORK,
      payer: { address: payer.publicKey(), secret: payer.secret() },
      merchant: { address: merchant.publicKey(), secret: merchant.secret() } };
    await save(path, accounts, { createOnly: true });
  }
  requireValue(accounts.schema === 'stellar-forge.wordpress-dedicated-testnet-accounts.v1' &&
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
      '-subj', '/CN=WordPress receiving private ingress CA', '-keyout', join(selected, 'ca-key.pem'),
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
    manifest = { schema: 'stellar-forge.wordpress-owned-tls.v1', operationId: ctx.input.operationId,
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
async function retainedSessions(ctx) {
 const checkpoint=await readJson(join(ctx.work,'journey-checkpoint.json'),true);
 if(!checkpoint)return [];
 requireValue(checkpoint.operationId===ctx.input.operationId,'ORIGINAL_WORDPRESS_OPERATION_CHANGED');
 const sessions=[];
 for(const [name,productId]of [['content',checkpoint.contentProduct],['source-files',checkpoint.sourceProduct]]) {
  if(!productId)continue;
  requireValue(UUID.test(productId),'ORIGINAL_PRODUCT_ID_REQUIRED');
  const root=join(ctx.work,'source-workspace','publishers',productId,'sessions');
  let entries;try{entries=await readdir(root,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')continue;throw error;}
  for(const entry of entries) {
   if(!UUID.test(entry.name))continue;
   requireValue(entry.isDirectory()&&!entry.isSymbolicLink(),'ORIGINAL_BUYER_DIRECTORY_REQUIRED');
   const directory=join(root,entry.name),binding=await readJson(join(directory,'binding.json'),true);
   if(!binding)continue;
   requireValue(binding.schema==='stellar-forge.socrata-buyer-session.v1'&&binding.buyerId===entry.name&&
    binding.workspaceDirectory===ctx.buyer,'ORIGINAL_BUYER_BINDING_CHANGED');
   const acquisition=join(directory,'acquisition'),definition=await readJson(join(acquisition,'session.json'),true);
   if(!definition)continue;
   const originalIntent=checkpoint.ids[name+'-buyer-intent'];
   requireValue(UUID.test(originalIntent??'')&&definition.config?.operation?.intentId===originalIntent&&
    definition.expectedSnapshot===binding.snapshot,'ORIGINAL_WORDPRESS_CUSTOMER_CHANGED');
   requireValue(binding.maxPages===definition.limits?.maxPages&&binding.maxPages<=ctx.input.maxPages&&
    binding.maxTotalAtomic===definition.limits.maxTotalAtomic&&
    BigInt(binding.maxTotalAtomic)===BigInt(ctx.input.amountAtomic)*BigInt(binding.maxPages),
    'ORIGINAL_PAGE_BUDGET_CHANGED');
   sessions.push({name,productId,buyerId:entry.name,directory,acquisition,binding,definition,originalIntent});
  }
 }
 return sessions;
}
async function recoverOriginalSessions(ctx,native,terms) {
 const selected=await retainedSessions(ctx),observations=[];
 if(!selected.length)return observations;
 const directory=join(ctx.output,'session-recovery');
 await privateDirectory(directory,true);
 const evidence=await import(pathToFileURL(join(ctx.input.sourceRoot,SCF,'sf82-checkout-evidence/evidence.mjs')));
 for(const session of selected) {
  // Original SF88 checks its retained lock owner before reclaiming that lock.
  // A live original buyer remains authoritative and recovery rejects it.
  const before=await native.recoverDatasetSession(session.acquisition);
  const observation={schema:'stellar-forge.wordpress-original-session-recovery.v1',
   operationId:ctx.input.operationId,productId:session.productId,buyerId:session.buyerId,
   acquisition:session.acquisition,originalIntent:session.originalIntent,observedAt:time(),
   before,checkout:null,after:before,buyerInvocations:0,signerInvocations:0};
  if(before.status==='RECONCILIATION_REQUIRED'&&before.stoppedPage?.intentId) {
   try {
    observation.checkout=await evidence.recoverCheckoutEvidence({
     outputDir:join(session.acquisition,'evidence'),intentId:before.stoppedPage.intentId,
     trustedPayer:terms.payer,rpcEndpoint:RPC});
   }catch(error) {
    if(error.code!=='ENOENT')throw error;
    observation.checkout={intentId:before.stoppedPage.intentId,checkpointAvailable:false};
   }
   observation.after=await native.recoverDatasetSession(session.acquisition);
  }
  const file=join(directory,session.buyerId+'-'+randomUUID()+'.json'),bytes=jsonBytes(observation);
  await saveBytes(file,bytes,{createOnly:true});
  observations.push({productId:session.productId,buyerId:session.buyerId,
   status:observation.after.status,file,sha256:hash(bytes),bytes:bytes.length});
  requireValue(['READY','COMPLETE'].includes(observation.after.status),
   'ORIGINAL_DATASET_CONTINUATION_REQUIRED',
   'Original acquisition '+session.acquisition+' retains '+observation.after.status+
   '; inspect the unchanged page and recovery observation '+file+'.');
 }
 return observations;
}
async function reviewPending(ctx,native,broker,terms,decided) {
 for(const selected of await retainedSessions(ctx)) {
  const root=join(selected.acquisition,'pages');
  const entries=(await readdir(root,{withFileTypes:true})).filter(x=>/^[0-9]{6}$/.test(x.name)).sort((a,b)=>a.name.localeCompare(b.name));
  // Original SF88 runs pages serially; only its last retained page can await review.
  for(const entry of entries.slice(-1)) {
   requireValue(entry.isDirectory()&&!entry.isSymbolicLink(),'ORIGINAL_PAGE_DIRECTORY_REQUIRED');
   const cfg=await readJson(join(root,entry.name,'config.json'),true);
   if(!cfg)continue;
   const review=broker.snapshot(cfg.operation?.intentId);
   if(review?.state!=='AWAITING_OPERATOR'||decided.has(review.id))continue;
   const index=Number(entry.name),original=await native.readRetainedDatasetAttempt(selected.acquisition,index);
   assert.deepEqual(original.cfg,cfg,'The original native page selection changed.');
   const op=original.cfg.operation,accepted=review.review.complete_original_accepted_terms,url=new URL(op.url);
   requireValue(review.intentId===op.intentId&&review.review.request_id===op.intentId&&
    review.current_native_budget_estimate.approved===true&&review.review.resource===op.url&&
    review.review.method==='GET'&&review.review.body_present===false&&op.method==='GET'&&
    url.origin===ctx.origin.origin&&url.pathname===ctx.input.path&&
    op.expect.scheme==='exact'&&op.expect.network===NETWORK&&op.expect.asset===terms.asset&&
    op.expect.payTo===terms.recipient&&op.expect.maxAtomic===terms.amountPerPageAtomic&&
    review.review.max_atomic_units_to_reserve===terms.amountPerPageAtomic&&
    accepted.scheme==='exact'&&accepted.network===NETWORK&&accepted.asset===terms.asset&&
    accepted.payTo===terms.recipient&&accepted.amount===terms.amountPerPageAtomic&&
    accepted.extra?.areFeesSponsored===true&&(accepted.extra?.paymentFlow??'authorization')==='authorization'&&
    Number.isSafeInteger(accepted.maxTimeoutSeconds)&&accepted.maxTimeoutSeconds>=1&&
    accepted.maxTimeoutSeconds<=ctx.input.maxTimeoutSeconds&&HASH.test(review.review.request_sha256),
    'ORIGINAL_WORDPRESS_PAGE_REVIEW_CHANGED');
   const path=join(ctx.output,'approvals',hash(op.intentId)+'-'+review.id+'.json');
   let retained=await readJson(path,true);
   if(retained) {
    requireValue(retained.intentId===op.intentId&&retained.approvalId===review.id&&
     retained.requestSha256===review.review.request_sha256&&retained.sourceHashes.attempt===original.sourceHashes.attempt,
     'RETAINED_APPROVAL_CHANGED');
   }else{
    retained={schema:'stellar-forge.wordpress-testnet-page-review.v1',operationId:ctx.input.operationId,
     productId:selected.productId,buyerId:selected.buyerId,acquisition:selected.acquisition,
     index,intentId:op.intentId,approvalId:review.id,requestSha256:review.review.request_sha256,
     sourceHashes:original.sourceHashes,originalReview:review,
     authorization:{network:NETWORK,maxPages:ctx.input.maxPages,maxTotalAtomic:ctx.input.maxTotalAtomic,
      payer:terms.payer,recipient:terms.recipient,asset:terms.asset,amountPerPageAtomic:terms.amountPerPageAtomic},
     decision:'approve',reviewedAt:time()};
    await save(path,retained,{createOnly:true});
   }
   broker.decide({intent:op.intentId,approvalId:review.id,requestSha256:review.review.request_sha256,decision:'approve'});
   decided.add(review.id);
   console.log(JSON.stringify({event:'wordpress.original-page-approved',operationId:ctx.input.operationId,
    productId:selected.productId,buyerId:selected.buyerId,index,intentId:op.intentId,amountAtomic:terms.amountPerPageAtomic}));
  }
 }
}
async function observeOriginalTransfers(ctx,terms,acceptance) {
 const selected=await retainedSessions(ctx),verify=await import(pathToFileURL(join(ctx.input.sourceRoot,SCF,'sf43-agent-commerce/verify.mjs')));
 const decoder=await verify.createOfficialEventDecoder(),pages=[],transactions=new Set();
 const required=[
  ['original-versioned-publication-and-customer','report'],
  ['original-paid-complete-source-receiving','nativeDelivery']
 ];
 for(const [name,key]of required) {
  const phase=acceptance.phases.find(x=>x.name===name),report=phase?.[key];
  requireValue(report?.status==='COMPLETE'&&Array.isArray(report.pages)&&report.pages.length>0,'ORIGINAL_COMPLETE_PAID_REPORT_REQUIRED',name);
  const native=selected.find(x=>x.productId===phase.productId&&x.buyerId===phase.buyerId);
  requireValue(native&&report.directory===native.acquisition,'ORIGINAL_PAID_ACQUISITION_CHANGED');
  for(const page of report.pages) {
   requireValue(contains(native.acquisition,page.evidencePath)&&contains(native.acquisition,page.responsePath),
    'ORIGINAL_PAID_ARTIFACT_PATH_CHANGED');
   const evidenceRaw=await privateBytes(page.evidencePath),body=await privateBytes(page.responsePath);
   assert.equal(hash(evidenceRaw),page.evidenceSha256);
   const evidence=JSON.parse(evidenceRaw),buyer=evidence.observation?.buyer,delivery=JSON.parse(body);
   requireValue(evidence.intentId===page.intentId&&buyer?.status==='DELIVERED_REPORTED_SETTLED'&&
    buyer.httpStatus>=200&&buyer.httpStatus<300&&buyer.receipt?.success===true&&
    buyer.receipt.network===NETWORK&&HASH.test(buyer.receipt.transaction)&&
    buyer.requirement.network===NETWORK&&buyer.requirement.asset===terms.asset&&
    buyer.requirement.payTo===terms.recipient&&buyer.requirement.amount===terms.amountPerPageAtomic&&
    page.operatorReservation?.outcome==='FRESH_RESERVATION_APPROVED'&&
    page.operatorReservation.requestId===page.intentId&&page.operatorReservation.reservedAtomicUnits===terms.amountPerPageAtomic,
    'ORIGINAL_NATIVE_PAID_PAGE_REQUIRED');
   requireValue(delivery.dataset?.snapshot===report.snapshot&&Array.isArray(delivery.rows),'ORIGINAL_PAID_DATASET_SNAPSHOT_CHANGED');
   let chain=evidence.observation.chain;
   if(chain?.status!=='TOKEN_TRANSFER_MATCHED_TESTNET') {
    const deadline=Date.now()+180000;
    do {
     chain=await verify.checkStellarTestnetTransaction({
      receipt:{...buyer.receipt,payer:terms.payer},
      expected:{network:NETWORK,asset:terms.asset,payTo:terms.recipient,amount:terms.amountPerPageAtomic,payer:terms.payer},
      rpcEndpoint:RPC,decodeContractEvent:decoder});
     await save(join(ctx.output,'chain-observations',hash(page.intentId)+'.json'),{
      schema:'stellar-forge.wordpress-original-rpc-observation.v1',intentId:page.intentId,
      evidencePath:page.evidencePath,evidenceSha256:page.evidenceSha256,
      observedAt:time(),observation:chain,buyerInvocations:0,signerInvocations:0});
     if(chain.status==='TOKEN_TRANSFER_MATCHED_TESTNET')break;
     await delay(3000);
    }while(Date.now()<deadline);
   }
   requireValue(chain?.status==='TOKEN_TRANSFER_MATCHED_TESTNET'&&chain.transaction===buyer.receipt.transaction&&
    chain.payer===terms.payer&&chain.recipient===terms.recipient&&chain.contractId===terms.asset&&
    chain.amountAtomic===terms.amountPerPageAtomic,'ORIGINAL_TESTNET_TRANSFER_OBSERVATION_REQUIRED');
   requireValue(!transactions.has(chain.transaction),'ONE_NATIVE_TRANSACTION_PER_PAGE_REQUIRED');
   transactions.add(chain.transaction);
   pages.push({productId:phase.productId,buyerId:phase.buyerId,index:page.index,intentId:page.intentId,
    transaction:chain.transaction,ledger:chain.ledger,eventId:chain.eventId,payer:chain.payer,recipient:chain.recipient,
    asset:chain.contractId,amountAtomic:chain.amountAtomic,snapshot:report.snapshot,
    evidencePath:page.evidencePath,evidenceSha256:page.evidenceSha256,
    responsePath:page.responsePath,responseBytes:body.length,responseSha256:hash(body),rows:delivery.rows.length});
   console.log(JSON.stringify({event:'wordpress.original-transfer-observed',productId:phase.productId,index:page.index,
    transaction:chain.transaction,amountAtomic:chain.amountAtomic,rows:delivery.rows.length}));
  }
 }
 const actualTotalAtomic=pages.reduce((sum,page)=>sum+BigInt(page.amountAtomic),0n).toString();
 requireValue(pages.length<=ctx.input.maxPages&&BigInt(actualTotalAtomic)<=BigInt(ctx.input.maxTotalAtomic),
  'ORIGINAL_COMMISSIONED_BUDGET_EXCEEDED');
 return {pages,actualPages:pages.length,actualTotalAtomic};
}

async function prepareBuyerAndJourney(ctx,intent,terms,environment) {
 const merchant={origin:ctx.origin.origin,path:ctx.input.path,payment:{
  scheme:'exact',network:NETWORK,asset:terms.asset,payTo:terms.recipient,amount:terms.amountPerPageAtomic,
  maxTimeoutSeconds:ctx.input.maxTimeoutSeconds,extra:{areFeesSponsored:true,paymentFlow:'authorization'}}};
 const merchantFile=join(ctx.output,'merchant.json'),runtimeFile=join(ctx.output,'seller-runtime.json');
 await retain(merchantFile,merchant);
 await retain(runtimeFile,{port:intent.ports.merchant,facilitator:'http://127.0.0.1:'+intent.ports.facilitator,allowLocalFacilitator:true});
 const buyerFile=join(ctx.output,'buyer-template.json');
 await retain(buyerFile,{operation:{intentId:'wordpress:'+hash(ctx.input.operationId).slice(0,48),
  url:ctx.origin.origin+ctx.input.path,method:'GET',
  expect:{scheme:'exact',network:NETWORK,asset:terms.asset,payTo:terms.recipient,
   maxAtomic:terms.amountPerPageAtomic,maxTimeoutSeconds:ctx.input.maxTimeoutSeconds,paymentFlow:'authorization'}},
  requestTimeoutMs:120000});
 const {initializeWorkspace}=await import(pathToFileURL(join(ctx.input.sourceRoot,SCF,'sf88-operator-buyer-cli/workspace.mjs')));
 let exists=true;try{await lstat(ctx.buyer);}catch(error){if(error.code!=='ENOENT')throw error;exists=false;}
 const initialized=await initializeWorkspace(['--config',buyerFile,'--dir',ctx.buyer,
  '--actor','wordpress-native-receiving','--service','wordpress-paid-source',
  '--payer',terms.payer,'--python',ctx.input.python,'--secret-env',PAYER_ENV,'--rpc',RPC,
  '--https-proxy-env',PROXY_ENV,'--total-atomic',ctx.input.maxTotalAtomic,'--daily-atomic',ctx.input.maxTotalAtomic],
  {environment,resume:exists});
 await save(join(ctx.output,'buyer-initialization.json'),initialized);
 const args=[join(HERE,'prepare.mjs'),'--out',ctx.selector,'--operation',ctx.input.operationId,
  '--source',ctx.input.sourceRoot,'--helper',ctx.input.nativeHelper,'--work',ctx.work,'--results',ctx.results,
  '--python',ctx.input.python,'--chromium',ctx.input.chromium,'--playwright',ctx.input.playwrightModule,
  '--buyer-workspace',ctx.buyer,'--merchant',merchantFile,'--seller-runtime',runtimeFile,
  '--php',ctx.input.php,'--wordpress-core',ctx.input.wordpressCore,'--sqlite',ctx.input.sqlite];
 const prepared=await subprocess(process.execPath,args,{env:environment,stdio:'inherit'});
 requireValue(prepared.code===0,'ORIGINAL_NATIVE_SELECTOR_FAILED');
 const selector=await privateBytes(ctx.selector);
 return {file:ctx.selector,sha256:hash(selector),bytes:selector.length};
}
async function hostPhase(ctx) {
 const lease=await leaseDescriptor(ctx),source=await checkedSource(ctx),intent=await selectedIntent(ctx,source);
 const accounts=await readJson(join(ctx.output,'dedicated-testnet-accounts.private.json'));
 requireValue(accounts.operationId===ctx.input.operationId&&accounts.network===NETWORK,'DEDICATED_ACCOUNT_BINDING_CHANGED');
 const sdk=await selectedSdk(ctx);
 for(const role of ['payer','merchant'])assert.equal(sdk.Keypair.fromSecret(accounts[role].secret).publicKey(),accounts[role].address);
 const asset=sdk.Asset.native().contractId(sdk.Networks.TESTNET);
 const terms={operationId:ctx.input.operationId,network:NETWORK,origin:ctx.origin.origin,path:ctx.input.path,
  payer:accounts.payer.address,recipient:accounts.merchant.address,asset,amountPerPageAtomic:ctx.input.amountAtomic,
  maxPages:ctx.input.maxPages,maxTotalAtomic:ctx.input.maxTotalAtomic};
 await retain(join(ctx.output,'terms.json'),terms);
 const tls=await prepareTls(ctx);assert.equal(process.env.NODE_EXTRA_CA_CERTS,tls.trustFile,'Native TLS trust must be present when Node starts.');
 process.env[PAYER_ENV]=accounts.payer.secret;process.env[MERCHANT_ENV]=accounts.merchant.secret;
 for(const name of ['SF36_CONSENT_KEY_B64','SF36_AUDIT_KEY_B64','SF36_OPERATOR_KEY_B64'])delete process.env[name];
 const native=await import(pathToFileURL(join(ctx.input.sourceRoot,SCF,'sf88-operator-buyer-cli/dataset-session.mjs')));
 const {createNativeFacilitator}=await import(pathToFileURL(join(ctx.input.sourceRoot,SCF,'native-facilitator/runtime.mjs')));
 const {startFacilitatorServer}=await import(pathToFileURL(join(ctx.input.sourceRoot,SCF,'native-facilitator/server.mjs')));
 const {createBrowserApprovalBroker}=await import(pathToFileURL(join(ctx.input.sourceRoot,SCF,'sf81-buyer-operator-bridge/browser-approval.mjs')));
 const resultFile=join(ctx.results,'TESTNET_RECEIVING.json'),previous=await readJson(resultFile,true);
 if(previous?.passed) {
  requireValue(previous.inputSha256===ctx.inputSha256,'COMPLETED_OPERATION_CHANGED');
  const actual=await privateBytes(previous.nativeAcceptance.file);assert.equal(hash(actual),previous.nativeAcceptance.sha256);
  console.log(JSON.stringify({event:'wordpress.testnet-receiving-reused',operationId:ctx.input.operationId,result:resultFile,passed:true}));
  return;
 }
 if(previous) {
  await privateDirectory(join(ctx.results,'history'),true);
  const raw=await privateBytes(resultFile),history=join(ctx.results,'history','testnet-'+hash(raw)+'.json');
  if(!await readJson(history,true))await saveBytes(history,raw,{createOnly:true});
 }
 const result={schema:'stellar-forge.wordpress-testnet-receiving.v1',operationId:ctx.input.operationId,
  inputSha256:ctx.inputSha256,source,terms,startedAt:time(),passed:false,
  previousResult:previous?{sha256:hash(jsonBytes(previous)),file:join(ctx.results,'history','testnet-'+hash(jsonBytes(previous))+'.json')}:null};
 let facilitator,facilitatorHost,ingress,broker,running,log,acceptance,primaryError;
 const decided=new Set();let interrupted=false;
 const interrupt=()=>{interrupted=true;if(running)running.stop('SIGTERM').catch(()=>{});};
 process.on('SIGTERM',interrupt);process.on('SIGINT',interrupt);
 try {
  const configuration={schema:'stellar-forge.native-facilitator.v1',network:NETWORK,rpcUrl:RPC,
   signers:[{address:terms.recipient,secretEnv:MERCHANT_ENV}],
   payments:{assets:[terms.asset],recipients:[terms.recipient],maxAtomic:terms.amountPerPageAtomic,paymentFlows:['authorization']},
   limits:{maxTransactionFeeStroops:50000,inclusionFeeStroops:100,maxVerifyInFlight:4,maxSettleInFlight:1,drainGraceMs:60000},
   operations:{ownershipDirectory:join(ctx.output,'facilitator-ownership'),rpcTimeoutMs:30000,
    readinessMaxAgeMs:30000,maxLedgerAgeSeconds:120,requireReady:true}};
  await retain(join(ctx.output,'native-facilitator.json'),configuration);
  facilitator=await createNativeFacilitator(configuration,{environment:process.env});
  facilitatorHost=await startFacilitatorServer({facilitator,port:intent.ports.facilitator});
  ingress=await openIngress({tls,hostname:ctx.origin.hostname,merchantPort:intent.ports.merchant,
   tlsPort:intent.ports.tls,proxyPort:intent.ports.proxy});
  process.env[PROXY_ENV]=ingress.url;
  broker=await createBrowserApprovalBroker();
  const environment={...process.env,...broker.environment,[LOCK_ENV]:'3',NODE_TLS_REJECT_UNAUTHORIZED:'1'};
  result.selector=await prepareBuyerAndJourney(ctx,intent,terms,environment);
  requireValue(!interrupted,'ORIGINAL_OPERATION_INTERRUPTED');
  const acceptancePath=join(ctx.results,'NATIVE_ACCEPTANCE.json');
  acceptance=await readJson(acceptancePath,true);
  if(!acceptance?.passed) {
   result.sessionRecovery=await recoverOriginalSessions(ctx,native,terms);
   requireValue(!interrupted,'ORIGINAL_OPERATION_INTERRUPTED');
   log=await open(join(ctx.output,'native-journey.log'),'a',0o600);
   running=startChild(process.execPath,[join(HERE,'journey.mjs'),'--config',ctx.selector],
    {env:environment,stdio:['ignore',log.fd,log.fd,lease]});
   // Retained immutable page attempts expose original request identity even
   // while runDatasetSession owns its writer lock. This observer performs no
   // page creation, replay, signing, reservation or second execution path.
   while(!running.settled) {
    await reviewPending(ctx,native,broker,terms,decided);
    if(interrupted)await running.stop('SIGTERM');
    if(!running.settled)await delay(100);
   }
   const completed=await running.completion;
   result.nativeProcess=completed;
   acceptance=await readJson(acceptancePath,true);
   requireValue(completed.code===0,'ORIGINAL_WORDPRESS_JOURNEY_NOT_COMPLETE',
    'Inspect '+join(ctx.output,'native-journey.log')+' and its retained NATIVE_ACCEPTANCE.json.');
  }
  requireValue(acceptance?.passed===true&&acceptance.resourcesClosed===true&&
   acceptance.operationId===ctx.input.operationId,'ORIGINAL_WORDPRESS_COMPLETION_REQUIRED');
  const acceptedRaw=await privateBytes(acceptancePath);
  result.nativeAcceptance={file:acceptancePath,sha256:hash(acceptedRaw),bytes:acceptedRaw.length,
   sourceRef:acceptance.sourceRef,phases:acceptance.phases.map(x=>x.name)};
  result.transfers=await observeOriginalTransfers(ctx,terms,acceptance);
  result.facilitator=facilitator.status();
  result.publicAccounts={payer:await accountObservation(terms.payer),merchant:await accountObservation(terms.recipient)};
  result.passed=true;
 }catch(error) {
  primaryError=error;result.error={name:error.name,code:error.code??null,message:String(error.message).slice(0,4000)};
 }finally{
  const failures=[];
  if(running&&!running.settled) {
   try{await running.stop('SIGTERM');}catch(error){failures.push({resource:'journey',message:String(error.message)});}
  }
  if(log)try{await log.close();}catch(error){failures.push({resource:'journey-log',message:String(error.message)});}
  if(broker)try{await broker.close();}catch(error){failures.push({resource:'original-approval',message:String(error.message)});}
  if(facilitatorHost)try{
   const closed=await facilitatorHost.close();result.facilitatorDrain=closed;
   if(closed.drained!==true)failures.push({resource:'original-facilitator',message:'The accepted native work has not drained.'});
  }catch(error){failures.push({resource:'original-facilitator',message:String(error.message)});}
  else if(facilitator)try{const closed=await facilitator.drain();if(closed.drained!==true)failures.push({resource:'original-facilitator',message:'Native drain is incomplete.'});}
   catch(error){failures.push({resource:'original-facilitator',message:String(error.message)});}
  if(ingress)try{result.ingress=ingress.tunnels;await ingress.close();}catch(error){failures.push({resource:'owned-ingress',message:String(error.message)});}
  process.off('SIGTERM',interrupt);process.off('SIGINT',interrupt);
  result.resourcesClosed=failures.length===0&&acceptance?.resourcesClosed===true;
  result.cleanupFailures=failures;result.finishedAt=time();
  if(!result.resourcesClosed||interrupted)result.passed=false;
  await save(resultFile,result);
  console.log(JSON.stringify({event:'wordpress.testnet-receiving-complete',operationId:ctx.input.operationId,
   passed:result.passed,resourcesClosed:result.resourcesClosed,actualPages:result.transfers?.actualPages,
   actualTotalAtomic:result.transfers?.actualTotalAtomic,result:resultFile,error:result.error?.code??result.error?.message}));
 }
 if(!result.passed)throw primaryError??fail('WORDPRESS_TESTNET_RECEIVING_NOT_COMPLETE');
}
async function lockedPhase(ctx) {
 const lease=await leaseDescriptor(ctx),source=await checkedSource(ctx),intent=await selectedIntent(ctx,source);
 for(const path of [ctx.results,join(ctx.output,'approvals'),join(ctx.output,'chain-observations')])await privateDirectory(path,true);
 const previous=await readJson(join(ctx.results,'TESTNET_RECEIVING.json'),true);
 if(previous?.passed) {
  requireValue(previous.inputSha256===ctx.inputSha256,'COMPLETED_OPERATION_CHANGED');
  assert.equal(hash(await privateBytes(previous.nativeAcceptance.file)),previous.nativeAcceptance.sha256);
  console.log(JSON.stringify({event:'wordpress.testnet-receiving-reused',operationId:ctx.input.operationId,
   result:join(ctx.results,'TESTNET_RECEIVING.json'),passed:true}));
  return;
 }
 const sdk=await selectedSdk(ctx),accounts=await prepareAccounts(ctx,sdk,intent),tls=await prepareTls(ctx);
 const environment={...process.env,[LOCK_ENV]:'3',NODE_EXTRA_CA_CERTS:tls.trustFile,NODE_TLS_REJECT_UNAUTHORIZED:'1',
  [PAYER_ENV]:accounts.payer.secret,[MERCHANT_ENV]:accounts.merchant.secret};
 const completed=await subprocess(process.execPath,[SELF,'--host',ctx.inputFile],
  {env:environment,stdio:['inherit','inherit','inherit',lease]});
 requireValue(completed.code===0,'ORIGINAL_WORDPRESS_HOST_NOT_COMPLETE');
}

const PYTHON_LEASE = String.raw`import fcntl, os, stat, sys
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
os.environ["WORDPRESS_RECEIVING_LEASE_FD"] = str(fd)
os.execv(node, [node, script, "--locked-input", input_path])
`;
async function main() {
 requireValue(process.argv.length===4&&['--input','--locked-input','--host'].includes(process.argv[2]),
  'Use: node testnet.mjs --input /absolute/host-selection.json');
 const ctx=await loadInput(process.argv[3]);
 if(process.argv[2]==='--input') {
  await privateDirectory(ctx.input.operationDirectory,true);await privateDirectory(ctx.output,true);
  const completed=await subprocess(ctx.input.python,['-I','-B','-c',PYTHON_LEASE,
   join(ctx.output,'operation.lock'),process.execPath,SELF,ctx.inputFile],{env:process.env,stdio:'inherit'});
  process.exitCode=completed.code??1;
 }else if(process.argv[2]==='--locked-input')await lockedPhase(ctx);
 else await hostPhase(ctx);
}
try{await main();}catch(error){
 console.error(JSON.stringify({schema:'stellar-forge.wordpress-testnet-error.v1',code:error.code??null,message:String(error.message).slice(0,4000)}));
 process.exitCode=1;
}
