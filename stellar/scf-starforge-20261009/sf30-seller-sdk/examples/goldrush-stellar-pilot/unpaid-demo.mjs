#!/usr/bin/env node
// MIT. Runnable original product walkthrough. No provider request or payment.
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { main as pilot } from './pilot.mjs';
import { main as customer } from './customer.mjs';
import { here, sourceRoot, nativePath, nativeImport, readJson, createJson, sha256, argumentsMap, required } from './runtime.mjs';

function child(command, args, environment = process.env) {
  return new Promise((resolvePromise, reject) => {
    const running = spawn(command, args, { env: environment, stdio: ['ignore','pipe','pipe'], shell: false });
    let stdout = '', stderr = '', bytes = 0;
    const collect = (target, part) => {
      bytes += part.length;
      if (bytes > 1048576) { running.kill('SIGTERM'); reject(new Error('Native example output exceeded 1 MiB')); return; }
      if (target === 'out') stdout += part; else stderr += part;
    };
    running.stdout.on('data', part => collect('out', part)); running.stderr.on('data', part => collect('err', part));
    running.once('error', reject);
    running.once('close', code => {
      if (code !== 0) return reject(new Error('Original example failed: ' + stderr.slice(0, 1024) + stdout.slice(0,1024)));
      try { resolvePromise(JSON.parse(stdout)); } catch { reject(new Error('Original example did not return JSON')); }
    });
  });
}
function need(value, message) { if (!value) throw new TypeError(message); }

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('node unpaid-demo.mjs --out NEW_PRIVATE_DIRECTORY --python PYTHON [--source-root CHECKOUT]\n'); return;
  }
  const options = argumentsMap(args, ['--out','--python','--source-root']);
  const root = sourceRoot(options.get('--source-root')), directory = resolve(required(options, '--out'));
  await mkdir(directory, { mode: 0o700 });
  const release = join(directory, 'release');
  await pilot(['prepare','--plan',join(here,'plan.example.json'),'--catalog',join(here,'source/discovery-catalog.json'),
    '--out',release,'--source-root',root]);
  const { readSellerConfig, startSellerService } = await nativeImport(root, 'sf30-seller-sdk/serve.mjs');
  const { readUpstreamBindings, createUpstreamApplication } = await nativeImport(root, 'sf30-seller-sdk/upstream.mjs');
  const config = await readSellerConfig(join(release,'merchant/seller-service.json'));
  const bindings = await readUpstreamBindings(join(release,'merchant/upstreams.json'));
  const app = createUpstreamApplication(config, bindings, { env: {
    GOLDRUSH_AUTHORIZATION: 'Bearer UNPAID_DEMONSTRATION_NOT_A_PROVIDER_CREDENTIAL',
  } });
  let service;
  const received = [], authored = {}, reviews = {};
  try {
    // No facilitator or nativeFactory is supplied: this is the original
    // explicit CHALLENGE_ONLY mode, not a substitute settlement implementation.
    service = await startSellerService({ config: app.config, handlers: app.handlers, port: 0 });
    need(service.mode === 'CHALLENGE_ONLY', 'Unpaid demo requires original challenge-only mode');
    for (const endpoint of ['/_seller/health','/_seller/openapi.json']) {
      const response = await fetch(service.url + endpoint, { redirect: 'error', signal: AbortSignal.timeout(10000) });
      need(response.status === 200, 'Original developer endpoint failed');
      const raw = Buffer.from(await response.arrayBuffer());
      received.push({ endpoint, status: response.status, bytes: raw.length, sha256: sha256(raw) });
    }
    for (const id of ['balances','transfers']) {
      const requestFile = join(directory,id+'-request.json'), intentId = 'goldrush-unpaid-'+id;
      authored[id] = await customer(['request','--release',release,'--operation',id,
        '--inputs',join(here,id+'.inputs.json'),'--intent',intentId,'--accept','0','--max-atomic','100000',
        '--out',requestFile,'--source-root',root]);
      const { operation } = (await readJson(requestFile)).value, url = new URL(operation.url);
      const response = await fetch(service.url + url.pathname + url.search, { redirect: 'error', signal: AbortSignal.timeout(10000) });
      const header = response.headers.get('payment-required'), raw = Buffer.from(await response.arrayBuffer());
      const offer = JSON.parse(Buffer.from(header ?? '', 'base64').toString('utf8'));
      need(response.status === 402 && offer.x402Version === 2 &&
        offer.accepts[0].network === 'stellar:testnet' && offer.accepts[0].amount === '100000' &&
        offer.accepts[0].asset === 'REPLACE_WITH_PROVIDER_SEP41_CONTRACT' &&
        offer.accepts[0].payTo === 'REPLACE_WITH_PROVIDER_STELLAR_RECIPIENT', 'Original unpaid payment challenge changed');
      received.push({ operation:id, status:response.status, bytes:raw.length, sha256:sha256(raw),
        challengeNetwork:offer.accepts[0].network, amount:offer.accepts[0].amount });
    }
    await customer(['prepare','--config',authored.balances.config,'--state',join(directory,'node-app'),'--source-root',root]);
    // A new process reopens the same original application state, not a copied
    // state model. No execution or attempt marker is requested.
    reviews.node = await child(process.execPath,[join(here,'customer.mjs'),'review','--state',join(directory,'node-app'),
      '--intent','goldrush-unpaid-balances','--source-root',root]);
    const pythonEnvironment = { ...process.env, PYTHONPATH: [nativePath(root,'sf88-operator-buyer-cli/python'),
      process.env.PYTHONPATH].filter(Boolean).join(':') };
    const python = required(options,'--python'), pythonArgs = [join(here,'customer.py'),'--checkout',root,
      '--state',join(directory,'python-app')];
    await child(python,[...pythonArgs,'prepare','--config',authored.transfers.config],pythonEnvironment);
    reviews.python = await child(python,[...pythonArgs,'review','--intent','goldrush-unpaid-transfers'],pythonEnvironment);
    const recoveredNode = await child(process.execPath,[join(here,'customer.mjs'),'recover','--state',join(directory,'node-app'),
      '--intent','goldrush-unpaid-balances','--source-root',root]);
    const recoveredPython = await child(python,[...pythonArgs,'recover','--intent','goldrush-unpaid-transfers'],pythonEnvironment);
    need(recoveredNode.status === 'ORIGINAL_RESULT_NOT_RECORDED' && recoveredPython.status === 'ORIGINAL_RESULT_NOT_RECORDED',
      'Unpaid preparation must not invent a paid result');
    const upstream = app.snapshot();
    need(upstream.bindings.every(binding => binding.started === 0 && binding.inFlight === 0), 'Unpaid demo must not start an upstream request');
    const result = { schema:'stellar-forge.goldrush-unpaid-workflow.v1', status:'ORIGINAL_PREPARE_CHALLENGE_REOPEN_COMPLETE',
      completedAt:new Date().toISOString(), sourceCatalog:(await readJson(join(here,'source/discovery-receipt.json'))).value,
      release, received, reviews, originalUpstream:upstream, recoveredNode,recoveredPython,
      providerDataRequests:0, facilitatorRequests:0, walletApprovals:0, paymentsInitiated:0,
      fixture:'Non-payable illustrative merchant terms; real original compiled routes and original durable SDK application state.' };
    await createJson(join(directory,'result.json'),result);
    process.stdout.write(JSON.stringify({status:result.status,result:join(directory,'result.json'),providerDataRequests:0,paymentsInitiated:0})+'\n');
    return result;
  } finally {
    if (service) await service.close();
    await app.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => {process.stderr.write(String(error.message)+'\n');process.exitCode=1;});
