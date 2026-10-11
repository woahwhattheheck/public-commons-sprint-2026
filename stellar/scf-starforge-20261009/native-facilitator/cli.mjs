#!/usr/bin/env node
// MIT. Operator explicitly selects review, native backend or native self-facilitated seller.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readConfig, reviewConfig, validateConfig, requireValue } from './config.mjs';

const print = x => process.stdout.write(JSON.stringify(x,null,2)+'\n');
async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('node cli.mjs --review|--check|--probe|--serve --config FILE [--port NUMBER]\n' +
      'node cli.mjs --seller SELLER_JSON --config FACILITATOR_JSON [--port NUMBER] [--handlers MODULE]\n' +
      'Operating options: --state PRIVATE_SHARED_DIRECTORY --require-ready\n');
    return;
  }
  const mode = args.shift();
  requireValue(['--review','--check','--probe','--serve','--seller'].includes(mode),'MODE_REQUIRED');
  const sellerPath = mode === '--seller' ? args.shift() : null;
  const flags = {};
  while (args.length) {
    const flag = args.shift();
    if (flag === '--require-ready') {
      requireValue(!Object.hasOwn(flags,flag),'ARGUMENTS_INVALID'); flags[flag] = true; continue;
    }
    const value = args.shift();
    requireValue(['--config','--port','--handlers','--state'].includes(flag) && value &&
      !Object.hasOwn(flags,flag),'ARGUMENTS_INVALID');
    flags[flag] = value;
  }
  requireValue(flags['--config'],'CONFIG_REQUIRED');
  requireValue(!flags['--handlers'] || mode === '--seller','HANDLERS_REQUIRE_SELLER');
  requireValue(!flags['--port'] || ['--serve','--seller'].includes(mode),'PORT_REQUIRES_SERVER');
  let c = await readConfig(flags['--config']);
  c = validateConfig({...c,operations:{...c.operations,
    ...(flags['--state'] ? {ownershipDirectory:resolve(flags['--state'])} : {}),
    ...(flags['--require-ready'] ? {requireReady:true} : {})}});
  if (mode === '--review') return print(reviewConfig(c));
  if (mode === '--probe') {
    const {createRpcReadiness} = await import('./readiness.mjs');
    const readiness = createRpcReadiness(c);
    try {
      const result = await readiness.probe(); print(result);
      if (!result.ready) process.exitCode = 2;
    } finally { await readiness.close(); }
    return;
  }
  const {createNativeFacilitator,startSelfFacilitatedSeller} = await import('./runtime.mjs');
  if (mode === '--check') {
    const native = await createNativeFacilitator(c);
    print({...native.status(),mode:'NATIVE_SDK_CONFIGURATION',supported:await native.getSupported()});
    await native.drain(); return;
  }
  const port = flags['--port'] === undefined ? (mode === '--serve' ? 4020 : 0) : Number(flags['--port']);
  requireValue(Number.isInteger(port) && port >= 0 && port <= 65535,'PORT_INVALID');
  let running, ownedFacilitator;
  if (mode === '--seller') {
    const {readSellerConfig} = await import('../sf30-seller-sdk/serve.mjs');
    const config = await readSellerConfig(sellerPath);
    const handlers = flags['--handlers'] ? await import(pathToFileURL(resolve(flags['--handlers'])).href) : {};
    running = await startSelfFacilitatedSeller({facilitatorConfig:c,config,port,handlers});
    ownedFacilitator = running.facilitator;
    print({mode:'NATIVE_SELF_FACILITATED_SELLER',url:running.url,network:c.network,
      supported:await running.facilitator.getSupported(),operations:running.facilitator.status()});
  } else {
    const {startFacilitatorServer} = await import('./server.mjs');
    const facilitator = await createNativeFacilitator(c);
    ownedFacilitator = facilitator;
    try { running = await startFacilitatorServer({facilitator,port}); }
    catch (error) { await facilitator.drain(); throw error; }
    print({mode:'NATIVE_FACILITATOR_HTTP',url:running.url,network:c.network,
      supported:await facilitator.getSupported(),operations:facilitator.status()});
  }
  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    let result;
    try { result = await running.close(); }
    catch { result = {drained:false,error:'SHUTDOWN_FAILED_RECONCILE'}; }
    print({...result,mode:'STOPPED'});
    if (result.drained === false || result.facilitator?.drained === false || result.seller?.forcedClose === true) {
      process.exitCode = 2;
      // An SDK network call cannot be cancelled after submission; the operator must reconcile.
      process.stderr.write('{"error":"INFLIGHT_OPERATION_REQUIRES_RECONCILIATION"}\n');
      const state = ownedFacilitator.status();
      if (state.ownership?.mode === 'HOST_SIGNER_LEASES' && state.activeVerify + state.activeSettle > 0) {
        print({...state,mode:'WAITING_FOR_ACCEPTED_NATIVE_WORK'});
        // Retain the actual parent descriptor even if the accepted native promise
        // currently has no referenced network handle in the event loop.
        const keepAlive = setInterval(() => {},1000);
        try { print({...await ownedFacilitator.waitForIdle(),mode:'ACCEPTED_NATIVE_WORK_FINISHED'}); }
        finally { clearInterval(keepAlive); }
        return;
      }
      setTimeout(() => process.exit(2),20);
    }
  };
  process.once('SIGINT',stop); process.once('SIGTERM',stop);
}
main(process.argv.slice(2)).catch(error => {
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
    ? error.code : 'NATIVE_FACILITATOR_START_FAILED';
  process.stderr.write(JSON.stringify({error:code})+'\n'); process.exitCode = 1;
});

