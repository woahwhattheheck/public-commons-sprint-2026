// MIT. One actual original-services order lifecycle; controlled local facilitator.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile as execCallback, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { Asset, Networks } from '@stellar/stellar-sdk';
import { compileCheckout, validateHandoff, sha } from './checkout-config.mjs';
import { initializeMerchant, prepareHandoff, inspectOrder, startCheckout } from './checkout.mjs';
import { preparePurchase, retrieveFile } from './purchase.mjs';
import { operation } from '../sf88-operator-buyer-cli/config.mjs';
import { initializeQueue, openQueue } from '../sf88-operator-buyer-cli/queue.mjs';
import { X402BuyerClient } from '../sf31-buyer-client/buyer.mjs';
import { createNativeSellerServer } from '../sf30-seller-sdk/native-factory.mjs';
import { drainOnce, sendSignedWebhook } from '../sf98-merchant-delivery/deliver.mjs';

const execFile = promisify(execCallback), here = dirname(fileURLToPath(import.meta.url));
const root = await mkdtemp(join(tmpdir(), 'sf101-checkout-'));
let merchant, receiver;
const stopReceiver = async () => { if (receiver && receiver.exitCode === null) { receiver.kill('SIGTERM'); await once(receiver, 'exit'); } receiver = null; };
async function startReceiver(state, secret) {
  const code = "import sys\nfrom pathlib import Path\nfrom http.server import ThreadingHTTPServer\nimport receiver\ns=ThreadingHTTPServer(('127.0.0.1',0),receiver.make_handler(Path(sys.argv[1]),sys.argv[2]))\nprint(s.server_address[1],flush=True)\ns.serve_forever()\n";
  const child = spawn('python3', ['-u','-c',code,state,secret], {cwd:here, stdio:['ignore','pipe','pipe']});
  const port = await new Promise((done, fail) => {
    let text = '';
    child.stdout.on('data', b => { text += b.toString(); if (text.includes('\n')) done(Number(text.trim())); });
    child.once('error', fail); child.once('exit', code => fail(new Error('receiver exit ' + code)));
  });
  assert(port > 0); return {child, url:'http://127.0.0.1:' + port};
}
try {
  const payment = JSON.parse(await readFile(new URL('../sf30-seller-sdk/python/example-merchant.json', import.meta.url))).functions.summarize.payment;
  payment.asset = Asset.native().contractId(Networks.TESTNET);
  const compiled = compileCheckout({schema:'stellar-forge.sf101.checkout-service.v1',
    publicOrigin:'https://merchant.example', path:'/purchase/report', routeId:'paid_report',
    description:'Existing approved private report', payment, state:join(root,'receiver'), outbox:join(root,'outbox')});
  await initializeMerchant(compiled);
  const source = Buffer.from('sku,quantity\nA-17,5\nB-23,11\n');
  const file = join(root,'report.csv'), handoffPath = join(root,'handoff.json');
  await writeFile(file, source, {mode:0o600});
  const token = randomBytes(32).toString('hex'), secret = randomBytes(32).toString('hex');
  await prepareHandoff(compiled, {ref:'approved-order-482', file, output:handoffPath, env:{...process.env,SF101_CLAIM_TOKEN:token}});
  const handoff = validateHandoff(JSON.parse(await readFile(handoffPath)));
  assert.deepEqual(handoff.file, {sha256:sha(source),bytes:source.length});
  assert.equal((await stat(handoffPath)).mode & 0o777, 0o600);
  await assert.rejects(prepareHandoff(compiled, {ref:handoff.orderReference,file,output:handoffPath,env:process.env}));

  const evidence = join(root,'evidence'); await mkdir(evidence,{mode:0o700});
  const signer = join(root,'operator.mjs'), policy = join(root,'policy.json');
  await writeFile(signer,'export const sign = () => { throw new Error("NOT_INVOKED_BY_QUEUE_INTAKE"); };',{mode:0o600});
  await writeFile(policy,'{}',{mode:0o600});
  const cfg = {operation:{intentId:'approved-file-482',url:'https://merchant.example/purchase/report',method:'GET',
    expect:{scheme:'exact',network:payment.network,asset:payment.asset,payTo:payment.payTo,maxAtomic:payment.amount}},
    operator:{python:'/usr/bin/python3',actor:'local-order-operator',service:'local-file-merchant',policy,ledger:join(root,'original-ledger.sqlite3')},
    signerModule:signer,evidenceDir:evidence};
  const prepared = join(root,'prepared.json');
  await preparePurchase({handoff,configuration:cfg,output:prepared});
  const normalized = operation(JSON.parse(await readFile(prepared)).operation);
  assert.equal(normalized.headers['X-SF98-Order-ID'], handoff.orderReference);
  assert.throws(() => operation({...normalized,url:'https://merchant.example/purchase/report?sf98_order=another-order'}), {code:'ORDER_REFERENCE_MUST_MATCH_APPROVED_RESOURCE'});
  const queueRoot = join(root,'inbox'); await initializeQueue(queueRoot);
  const queue = await openQueue(queueRoot), queued = await queue.enqueue(prepared);
  assert.equal(queued.operation.orderReference, handoff.orderReference);
  assert.equal((await (await openQueue(queueRoot)).show(cfg.operation.intentId)).operation.headers['X-SF98-Order-ID'],handoff.orderReference);
  const review = await execFile(process.execPath,[join(here,'../sf88-operator-buyer-cli/cli.mjs'),'--review','--config',prepared]);
  assert.equal(JSON.parse(review.stdout).headers['X-SF98-Order-ID'],handoff.orderReference);

  let verifies=0, settlements=0;
  const facilitator = {
    async getSupported() { return {kinds:[{x402Version:2,scheme:'exact',network:payment.network}],extensions:['bazaar'],signers:{}}; },
    async verify() { verifies++; return {isValid:true,payer:'local-controlled-payer'}; },
    async settle() { settlements++; return {success:true,transaction:sha('LOCAL_CONTROLLED_NOT_A_TRANSACTION_'+settlements),network:payment.network}; },
  };
  merchant = await startCheckout(compiled,{port:0,operationsPort:0,nativeFactory:routes=>createNativeSellerServer(routes,{facilitatorClient:facilitator})});
  let receive = await startReceiver(compiled.state,secret); receiver=receive.child;
  const fetchDownload = (url,options) => fetch(receive.url+new URL(url).pathname,options);
  await assert.rejects(retrieveFile({handoff,destination:join(root,'pending.csv'),token,fetchImpl:fetchDownload}), {code:'ENTITLEMENT_NOT_AVAILABLE'});
  let response = await fetch(merchant.seller.url+'/purchase/report?sf98_order='+handoff.orderReference);
  assert.equal(response.status,422); await response.arrayBuffer(); assert.equal(verifies,0);
  response = await fetch(merchant.seller.url+'/purchase/report?sf98_order=unknown',{headers:{'X-SF98-Order-ID':'unknown'}});
  assert.equal(response.status,404); await response.arrayBuffer(); assert.equal(verifies,0);

  const client = new X402BuyerClient({fetchImpl:(url,options)=>fetch(merchant.seller.url+new URL(url).pathname+new URL(url).search,options)});
  let approvedIntent;
  const call = {...normalized, approve:async intent=>{approvedIntent=intent;return true;},
    sign:async ({challenge,accepted})=>({x402Version:2,resource:challenge.resource,accepted,
      extensions:challenge.extensions,payload:{transaction:'LOCAL_CONTROLLED_NOT_A_TRANSACTION'}})};
  const result = await client.call(call);
  assert.equal(result.status,'DELIVERED_REPORTED_SETTLED');
  assert.equal((await result.response.json()).orderReference,handoff.orderReference);
  assert.equal(approvedIntent.url,handoff.purchaseUrl);
  const mapped = await execFile('python3',['-c',
    "import sys,json;sys.path.insert(0,sys.argv[1]);from intent_adapter import buyer_intent_to_governor_request;print(json.dumps(buyer_intent_to_governor_request(json.loads(sys.argv[2]),actor='local-order-operator',service='local-file-merchant')))",
    join(here,'../sf54-buyer-governor-intent'),JSON.stringify(approvedIntent)]);
  assert.equal(JSON.parse(mapped.stdout).resource,handoff.purchaseUrl);
  let rows = await merchant.outbox.rows(); assert.equal(rows.length,1);
  assert.equal(rows[0].event.orderReference,handoff.orderReference);
  const sender = options => sendSignedWebhook({...options,resolver:async()=>[{address:'93.184.216.34',family:4}],
    transport:(_url,requestOptions,callback)=>httpRequest(receive.url+'/sf98/events',{...requestOptions,lookup:undefined},callback)});
  assert.equal((await drainOnce(merchant.outbox,{url:'https://merchant.example/internal/x402-events',allowedHost:'merchant.example',secret,send:sender})).delivered,1);
  assert.equal((await inspectOrder(compiled,handoff.orderReference)).state,'ENTITLED');
  const downloaded = join(root,'purchased.csv');
  await assert.rejects(retrieveFile({handoff,destination:join(root,'wrong-token.csv'),token:randomBytes(32).toString('hex'),fetchImpl:fetchDownload}), {code:'ENTITLEMENT_NOT_AVAILABLE'});
  const saved = await retrieveFile({handoff,destination:downloaded,token,fetchImpl:fetchDownload});
  assert.equal(saved.status,'APPROVED_FILE_SAVED'); assert.deepEqual(await readFile(downloaded),source);
  assert.equal(saved.file.sha256,handoff.file.sha256);
  assert.equal((await stat(downloaded)).mode & 0o777,0o600);
  await stopReceiver(); receive = await startReceiver(compiled.state,secret); receiver=receive.child;
  const recovered = await retrieveFile({handoff,destination:downloaded,fetchImpl:()=>{throw new Error('NO_REPEAT_DOWNLOAD');}});
  assert.equal(recovered.httpRequests,0); assert.equal(recovered.receipt.disposition,'EXISTING_MATCH');
  const duplicate = await sender({event:rows[0].event,url:'https://merchant.example/internal/x402-events',allowedHost:'merchant.example',secret});
  assert.equal(duplicate.httpStatus,200);
  assert.deepEqual(await (await fetch(receive.url+'/deliver/'+handoff.orderReference,{headers:{Authorization:'Bearer '+token}})).arrayBuffer(),source.buffer.slice(source.byteOffset,source.byteOffset+source.byteLength));
  response=await fetch(merchant.seller.url+'/purchase/report?sf98_order='+handoff.orderReference,{headers:{'X-SF98-Order-ID':handoff.orderReference}});
  assert.equal(response.status,404); await response.arrayBuffer(); assert.equal(verifies,1);
  const badTarget=join(root,'wrong-fingerprint.csv');
  await assert.rejects(retrieveFile({handoff,destination:badTarget,token,fetchImpl:async()=>new Response(Buffer.alloc(source.length,120))}));
  await assert.rejects(stat(badTarget),{code:'ENOENT'});
  assert((await readdir(root)).some(name=>name.endsWith('.partial')));
  response=await fetch(merchant.operations.url+'/api/delivery'); const view=await response.json();
  assert.equal(response.status,200); assert(JSON.stringify(view).includes('DELIVERED'));
  await execFile('python3',[join(here,'receiver.py'),'receipt','--state',compiled.state,'--ref',handoff.orderReference,'--out',join(root,'entitlement.json')]);
  assert.equal(JSON.parse(await readFile(join(root,'entitlement.json'))).fileSha256,handoff.file.sha256);
  console.log(JSON.stringify({result:'PASS',node:process.version,nativeSdk:'2.28.0',verifies,settlements,
    flow:'original enrollment -> SF88 immutable inbox/review -> approved URL -> SF30 Python/native settlement -> SF98 signed HTTP -> SF101 entitlement -> exact private file/restart',
    financialExecution:'controlled local facilitator/approval; no wallet or chain transaction',fileBytes:source.length}));
} finally { await stopReceiver(); await merchant?.close(); await rm(root,{recursive:true,force:true}); }
