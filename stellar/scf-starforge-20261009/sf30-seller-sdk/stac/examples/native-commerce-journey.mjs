// MIT. The existing captured STAC edition through the original full operator protocol.
// Local commerce fixture adapted from maintained usgs-water/journey.mjs,
// Git blob531872e9fd0c061a0b5f6b56fe7c7929c06d46d8. SF36/SF81/SF88 are unchanged.
// The only upstream input is the existing native-complete edition directory.
import {createServer as httpServer,request as httpRequest} from 'node:http';
import {createServer as httpsServer} from 'node:https';
import {connect as connectTcp} from 'node:net';
import {execFile as execFileCallback,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,chmod} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {withPrivateLock} from '../../routescan/quota.mjs';
import {Buyer} from '../../../sf88-operator-buyer-cli/node/client.mjs';
import {absolute,privateDirectory,readJson,jsonBytes,exists,need}
  from '../../../sf88-operator-buyer-cli/node/store.mjs';
import {readStacEdition,stageStacMerchant,readStacMerchant,stacRetain,STAC_CHUNK_BYTES}
  from '../merchant.mjs';
import {StacDelivery} from '../customer.mjs';
import {runNativeMerchantCustomer} from './native-merchant-customer.mjs';

const execFile=promisify(execFileCallback);
const ORIGIN='https://stac-journey.example';
const MODE='ORIGINAL_LOCAL_PROTOCOL_FIXTURE';
const FIXTURE_TRANSACTION='LOCAL_CONTROLLED_NOT_A_TRANSACTION';
const PAYMENT=Object.freeze({scheme:'exact',network:'stellar:testnet',asset:'C'+'A'.repeat(55),
  payTo:'G'+'A'.repeat(55),amount:'7',maxTimeoutSeconds:60});
const SCHEMA='stellar-forge.stac-native-commerce-journey.v1';
const publicError=error=>({code:error?.code??error?.name??'STAC_NATIVE_COMMERCE_FAILED',
  message:String(error?.message??error).slice(0,1200)});

async function listen(server, port = 0) {
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); done(); });
  });
  return 'http://127.0.0.1:' + server.address().port;
}
async function closeServer(server) {
  if (!server?.listening) return;
  server.closeAllConnections?.();
  await new Promise(done => server.close(done));
}

/** HTTP exposure of the original local protocol facilitator fixture. */
async function localFacilitator() {
  const counts = { supported: 0, verified: 0, settled: 0 };
  const original = {
    async getSupported() {
      counts.supported++;
      return { kinds: [{ x402Version: 2, scheme: 'exact', network: 'stellar:testnet' }],
        extensions: ['bazaar'], signers: {} };
    },
    async verify() { counts.verified++; return { isValid: true, payer: 'local-controlled-payer' }; },
    async settle() { counts.settled++; return { success: true, transaction: 'local-controlled-result', network: 'stellar:testnet' }; },
  };
  const server = httpServer(async (request, response) => {
    try {
      let size = 0;
      for await (const chunk of request) { size += chunk.length; if (size > 1048576) throw Error('Local fixture request exceeds 1 MiB.'); }
      const method = request.method;
      const call = method === 'GET' && request.url === '/supported' ? original.getSupported :
        method === 'POST' && request.url === '/verify' ? original.verify :
        method === 'POST' && request.url === '/settle' ? original.settle : null;
      const value = call ? await call() : { error: 'Unknown local fixture route.' };
      response.writeHead(call ? 200 : 404, { 'content-type': 'application/json' });
      response.end(JSON.stringify(value));
    } catch {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end('{"error":"Local fixture request failed."}');
    }
  });
  const url = await listen(server);
  return { url, counts, close: () => closeServer(server) };
}

/** Keep original SF31/SF85 HTTPS validation through an explicit owned CONNECT endpoint.
 * The generated certificate is trusted only by the native SF88 child processes. */
async function localMerchantTransport(directory, merchantUrl) {
  const retainedPath = join(directory, 'transport.json');
  const retained = await exists(retainedPath) ? await readJson(retainedPath, 65536) : null;
  if (retained) {
    const prior = new URL(retained.proxyUrl);
    need(retained.origin === ORIGIN && prior.protocol === 'http:' && prior.hostname === '127.0.0.1' &&
      !prior.username && !prior.password && prior.pathname === '/' && !prior.search && !prior.hash &&
      Number.isInteger(Number(prior.port)) && Number(prior.port) > 0, 'STAC_ORIGINAL_FIXTURE_TRANSPORT_CHANGED');
  }
  const keyFile = join(directory, 'merchant-key.pem'), certFile = join(directory, 'merchant-cert.pem');
  if (!await exists(keyFile) || !await exists(certFile)) await execFile('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=stac-journey.example', '-addext', 'subjectAltName=DNS:stac-journey.example',
    '-keyout', keyFile, '-out', certFile], { timeout: 30000, maxBuffer: 32768 });
  await Promise.all([chmod(keyFile, 0o600), chmod(certFile, 0o600)]);
  const counts = { tunnels: 0, requests: 0, signedRequests: 0 };
  const sockets = new Set();
  const local = new URL(merchantUrl);
  const gateway = httpsServer({ key: await readFile(keyFile), cert: await readFile(certFile) }, (request, response) => {
    counts.requests++; if (request.headers['payment-signature']) counts.signedRequests++;
    const upstream = httpRequest({
      hostname: '127.0.0.1', port: local.port, method: request.method, path: request.url,
      headers: { ...request.headers, host: new URL(ORIGIN).host },
    }, original => {
      response.writeHead(original.statusCode, original.headers);
      original.pipe(response);
      original.on('error', () => response.destroy());
    });
    upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    request.on('aborted', () => upstream.destroy());
    response.on('close', () => { if (!response.writableEnded) upstream.destroy(); });
    request.pipe(upstream);
  });
  const proxy = httpServer((_request, response) => { response.writeHead(405); response.end(); });
  proxy.on('connect', (request, downstream, head) => {
    if (request.url !== 'stac-journey.example:443') {
      downstream.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    counts.tunnels++;
    const upstream = connectTcp({ host: '127.0.0.1', port: gateway.address().port });
    for (const socket of [downstream, upstream]) {
      sockets.add(socket); socket.once('close', () => sockets.delete(socket));
      socket.once('error', () => { downstream.destroy(); upstream.destroy(); });
    }
    upstream.once('connect', () => {
      downstream.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      downstream.pipe(upstream); upstream.pipe(downstream);
    });
  });
  try {
    await listen(gateway);
    const proxyUrl = await listen(proxy, retained ? Number(new URL(retained.proxyUrl).port) : 0);
    await stacRetain(retainedPath, jsonBytes({origin:ORIGIN,proxyUrl}));
    return { certFile, counts, buyerTransport: { mode: 'explicit-connect', origin: ORIGIN, proxyUrl },
      async close() { for (const socket of sockets) socket.destroy(); await closeServer(proxy); await closeServer(gateway); } };
  } catch (error) {
    for (const socket of sockets) socket.destroy();
    await closeServer(proxy); await closeServer(gateway); throw error;
  }
}


async function prepare(directory) {
  const operationDirectory=absolute(directory);
  const source=await readJson(join(operationDirectory,'complete-result.json'),1048576);
  need(source.stage==='COMPLETE'&&source.editionDirectory&&source.manifestDigest,
    'STAC_ORIGINAL_COMPLETED_SOURCE_REQUIRED');
  const edition=await readStacEdition(absolute(source.editionDirectory));
  need(edition.manifest.id===source.manifestId&&edition.manifest.digest===source.manifestDigest,
    'STAC_ORIGINAL_SOURCE_EDITION_CHANGED');
  const root=await privateDirectory(join(operationDirectory,'native-commerce'));
  const staged=await stageStacMerchant({editionDirectory:edition.directory,
    directory:join(root,'merchant'),origin:ORIGIN,payment:PAYMENT});
  const merchant=await readStacMerchant(staged.directory);
  const rowCount=merchant.dataset.describe().rowCount;
  // Use the original typed CSV count. A small page makes the real case paginate;
  // the native page ceiling and full actual-member chunk allocation stay exact.
  const pageSize=Math.min(250,Math.max(2,Math.ceil(rowCount/5000)));
  const maxPages=Math.max(1,Math.ceil(rowCount/pageSize));
  need(Number.isSafeInteger(rowCount)&&rowCount>=0&&maxPages<=10000,
    'STAC_ORIGINAL_DATASET_PLAN_INVALID');
  const selectedAssets=edition.manifest.assets.map(asset=>asset.path);
  const requests=1+maxPages+edition.manifest.files.reduce((sum,file)=>
    sum+Math.max(1,Math.ceil(file.bytes/STAC_CHUNK_BYTES)),0);
  need(Number.isSafeInteger(requests)&&requests>0,'STAC_NATIVE_REQUEST_PLAN_INVALID');
  const maxTotalAtomic=(BigInt(PAYMENT.amount)*BigInt(requests)).toString();
  const plan={schema:SCHEMA,mode:MODE,operationDirectory,editionDirectory:edition.directory,
    editionId:edition.manifest.id,editionDigest:edition.manifest.digest,
    manifestSha256:edition.manifestSha256,manifestBytes:edition.manifestBytes,
    snapshot:staged.snapshot,rowCount,selectedAssets,sourceOperationId:source.id??null,
    sourceEditionId:source.editionId,sourceAsset:source.asset??null,
    maxPages,pageSize,maxTotalAtomic,plannedRequests:requests,
    customerId:'stac-native-'+edition.manifest.digest.slice(0,24)};
  await stacRetain(join(root,'plan.json'),jsonBytes(plan));
  return {root,plan};
}

async function fixtureBuyer({root,plan,python,session,facilitator}) {
  const fixture=await privateDirectory(join(root,'local-fixture'));
  const transport=await localMerchantTransport(fixture,session.url);
  try {
    const policyPath=join(fixture,'policy.json'),signerPath=join(fixture,'signer.mjs');
    const policy={schema:'stellar-spend-governor/v1',assets:[{network:PAYMENT.network,
      asset:PAYMENT.asset,max_single:PAYMENT.amount,max_total:plan.maxTotalAtomic,
      max_per_utc_day:plan.maxTotalAtomic,max_per_actor_utc_day:plan.maxTotalAtomic,
      max_per_service_utc_day:plan.maxTotalAtomic}]};
    await stacRetain(policyPath,jsonBytes(policy));
    await stacRetain(signerPath,'export async function sign({challenge,accepted}) {\n'+
      ' return {x402Version:2,resource:challenge.resource,accepted,payload:{transaction:'+
      JSON.stringify(FIXTURE_TRANSACTION)+'},extensions:challenge.extensions};\n}\n');
    const keysPath=join(fixture,'operator-keys.json');
    const keyNames=['SF36_CONSENT_KEY_B64','SF36_AUDIT_KEY_B64','SF36_OPERATOR_KEY_B64'];
    const keys=await exists(keysPath)?await readJson(keysPath,65536):
      Object.fromEntries(keyNames.map(name=>[name,randomBytes(32).toString('base64')]));
    need(Object.keys(keys).length===keyNames.length&&keyNames.every(name=>
      typeof keys[name]==='string'&&Buffer.from(keys[name],'base64').length===32&&
      Buffer.from(keys[name],'base64').toString('base64')===keys[name]),
      'STAC_ORIGINAL_LOCAL_OPERATOR_KEYS_CHANGED');
    await stacRetain(keysPath,jsonBytes(keys));
    const profile={operator:{python,actor:'stac-native-customer',service:'stac-satellite-imagery',
      policy:policyPath,ledger:join(fixture,'ledger.sqlite')},
      signerModule:signerPath,buyerTransport:transport.buyerTransport};
    await stacRetain(join(fixture,'operator-profile.json'),jsonBytes(profile));
    const buyer=await new Buyer({
      runtimeDirectory:fileURLToPath(new URL('../../../sf88-operator-buyer-cli/',import.meta.url)),
      stateDirectory:join(root,'buyer'),operatorProfile:profile,
      environment:{...process.env,...keys,NODE_EXTRA_CA_CERTS:transport.certFile},
      timeoutMs:90000,
    }).ready();
    const query=new URLSearchParams({limit:String(plan.pageSize),sort:'item_id',snapshot:plan.snapshot});
    const unsigned=await fetch(session.url+session.paths.scenes+'?'+query,
      {signal:AbortSignal.timeout(10000)});
    const challengeHeader=unsigned.headers.get('payment-required');
    await unsigned.arrayBuffer();
    need(unsigned.status===402&&challengeHeader,'STAC_ORIGINAL_UNSIGNED_CHALLENGE_REQUIRED');
    const challenge=JSON.parse(Buffer.from(challengeHeader,'base64'));
    need(challenge.x402Version===2&&challenge.accepts?.[0]?.network===PAYMENT.network&&
      challenge.accepts[0].amount===PAYMENT.amount,'STAC_ORIGINAL_CHALLENGE_CHANGED');
    await stacRetain(join(root,'unsigned-402.json'),jsonBytes({status:unsigned.status,challenge}));
    return {buyer,transport};
  }catch(error){await transport.close();throw error;}
}

/** Called only by this fixture's retained PTY child. It does not query Earth Search. */
export async function runStacNativeCommerce({directory,python}={}) {
  const {root,plan}=await prepare(directory);
  return withPrivateLock(root,'journey.lock',async()=>{
    const resultPath=join(root,'result.json');
    if(await exists(resultPath)){
      const original=await readJson(resultPath,33554432);
      need(original.schema===SCHEMA&&original.plan.editionDigest===plan.editionDigest&&
        original.status==='COMPLETE','STAC_RETAINED_COMMERCE_RESULT_CHANGED');
      await StacDelivery.open(original.customer.receiving.directory);
      await StacDelivery.open(original.customer.copied.directory);
      return original;
    }
    let facilitator,transport;
    const startedAt=new Date().toISOString();
    try {
      facilitator=await localFacilitator();
      const customer=await runNativeMerchantCustomer({
        editionDirectory:plan.editionDirectory,merchantDirectory:join(root,'merchant'),
        customerDirectory:join(root,'customer'),deliveryDirectory:join(root,'received'),
        copyDirectory:join(root,'receiving-copy'),origin:ORIGIN,payment:PAYMENT,
        id:plan.customerId,maxPages:plan.maxPages,maxTotalAtomic:plan.maxTotalAtomic,
        query:{limit:String(plan.pageSize),sort:'item_id'},selectedAssets:plan.selectedAssets,
        facilitator:facilitator.url,allowLocalFacilitator:true,port:0,
        createBuyer:async({session})=>{
          const configured=await fixtureBuyer({root,plan,python,session,facilitator});
          transport=configured.transport;return configured.buyer;
        },
        progress:event=>process.stdout.write(JSON.stringify({stage:'NATIVE_CUSTOMER',...event})+'\n'),
      });
      need(customer.sceneCount===plan.rowCount,'STAC_NATIVE_ALL_SCENES_NOT_RECEIVED');
      // Native reports are the count authority after an interrupted invocation.
      // This facilitator counter describes only this process's original calls.
      const result={schema:SCHEMA,status:'COMPLETE',mode:MODE,startedAt,
        completedAt:new Date().toISOString(),plan,customer,
        facilitator:{...facilitator.counts},transport:{...transport.counts}};
      await stacRetain(resultPath,jsonBytes(result));
      return result;
    }finally{
      await transport?.close();await facilitator?.close();
    }
  });
}

const PTY_DRIVER = [
  "# Original SF81 acceptance.py PTY method, scoped to this retained original local fixture.",
  "import json, os, pty, re, select, signal, sys, time",
  "node, script, directory = sys.argv[1:4]",
  "limit = int(sys.argv[4])",
  "command = [node, script, '--fixture-tty-child', '--directory', directory, '--python', sys.executable]",
  "pid, fd = pty.fork()",
  "if pid == 0:",
  "    os.execve(node, command, os.environ.copy())",
  "transcript = bytearray()",
  "scanned = 0",
  "approvals = 0",
  "status = None",
  "prompt = re.compile(rb'To authorize ONE fresh reservation, type exactly: (APPROVE [0-9a-f]{16})')",
  "def terminate(_signal, _frame):",
  "    raise InterruptedError('Local journey interrupted')",
  "signal.signal(signal.SIGTERM, terminate)",
  "try:",
  "    deadline = time.monotonic() + 600",
  "    while time.monotonic() < deadline:",
  "        ready, _, _ = select.select([fd], [], [], 0.1)",
  "        if ready:",
  "            try: chunk = os.read(fd, 65536)",
  "            except OSError: break",
  "            if not chunk: break",
  "            transcript.extend(chunk)",
  "            if len(transcript) > 2097152:",
  "                raise RuntimeError('Local fixture transcript exceeded 2 MiB')",
  "            for match in prompt.finditer(transcript, scanned):",
  "                if approvals >= limit:",
  "                    raise RuntimeError('Unexpected extra local fixture reservation')",
  "                os.write(fd, match.group(1) + b'\\n')",
  "                approvals += 1",
  "                scanned = match.end()",
  "        ended, value = os.waitpid(pid, os.WNOHANG)",
  "        if ended:",
  "            status = value",
  "            break",
  "finally:",
  "    if status is None:",
  "        ended, value = os.waitpid(pid, os.WNOHANG)",
  "        if ended: status = value",
  "        else:",
  "            os.killpg(pid, signal.SIGTERM)",
  "            ended, value = os.waitpid(pid, 0)",
  "            status = value",
  "    os.close(fd)",
  "    output = os.open(os.path.join(directory, 'local-fixture-transcript.log'),",
  "                     os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)",
  "    with os.fdopen(output, 'wb') as file: file.write(transcript)",
  "sys.exit(os.waitstatus_to_exitcode(status))"
].join('\n');


function argumentsOf(args) {
  const result={};
  for(let index=0;index<args.length;index++){
    const key=args[index];
    if(key==='--help'||key==='-h'){result.help=true;continue;}
    if(key==='--fixture-tty-child'){result.child=true;continue;}
    const name={'--directory':'directory','--python':'python'}[key];
    need(name&&!result[name]&&args[index+1]&&!args[index+1].startsWith('--'),
      'STAC_NATIVE_COMMERCE_ARGUMENTS_INVALID');
    result[name]=args[++index];
  }
  return result;
}
async function main(args) {
  const options=argumentsOf(args);
  if(options.help){
    process.stdout.write('node native-commerce-journey.mjs --directory ABS_EXISTING_STAC_OPERATION [--python ABS_PYTHON]\n');
    return;
  }
  need(options.directory,'STAC_EXISTING_OPERATION_DIRECTORY_REQUIRED');
  options.directory=absolute(options.directory);
  options.python=options.python??(await execFile('python3',['-I','-c','import sys; print(sys.executable)'])).stdout.trim();
  if(options.child){await runStacNativeCommerce(options);return;}
  const {root,plan}=await prepare(options.directory);
  if(await exists(join(root,'result.json'))){
    const result=await runStacNativeCommerce(options);
    process.stdout.write(JSON.stringify({status:result.status,result:join(root,'result.json'),
      sceneCount:result.customer.sceneCount,receiving:result.customer.receiving.directory,
      copy:result.customer.copied.directory,mode:result.mode,reopened:true})+'\n');
    return;
  }
  const child=spawn(options.python,['-I','-B','-c',PTY_DRIVER,process.execPath,
    fileURLToPath(import.meta.url),options.directory,String(plan.plannedRequests)],
    {shell:false,stdio:['ignore','pipe','pipe'],env:{...process.env}});
  let diagnostic='';
  for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>{
    diagnostic=(diagnostic+bytes.toString('utf8')).slice(-8192);
  });
  const stop=()=>child.kill('SIGTERM');
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
  let exit;
  try{exit=await new Promise((done,reject)=>{
    child.once('error',reject);child.once('close',(code,signal)=>done({code,signal}));
  });}finally{process.off('SIGTERM',stop);process.off('SIGINT',stop);}
  if(exit.code!==0){
    process.stderr.write(JSON.stringify({status:'FAILED',directory:root,exitCode:exit.code,
      signal:exit.signal,diagnostic})+'\n');process.exitCode=1;return;
  }
  const result=await readJson(join(root,'result.json'),33554432);
  process.stdout.write(JSON.stringify({status:result.status,result:join(root,'result.json'),
    sceneCount:result.customer.sceneCount,receiving:result.customer.receiving.directory,
    copy:result.customer.copied.directory,mode:result.mode})+'\n');
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main(process.argv.slice(2)).catch(error=>{
    process.stderr.write(JSON.stringify({status:'FAILED',...publicError(error)})+'\n');process.exitCode=1;
  });
