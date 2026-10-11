#!/usr/bin/env node
// MIT. Operator explicitly selects review, native backend or native self-facilitated seller.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readConfig, reviewConfig, requireValue } from './config.mjs';

const print = x => process.stdout.write(JSON.stringify(x,null,2)+'\n');
async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('node cli.mjs --review|--check|--serve --config FILE [--port NUMBER]\n' +
      'node cli.mjs --seller SELLER_JSON --config FACILITATOR_JSON [--port NUMBER] [--handlers MODULE]\n');
    return;
  }
  const mode = args.shift();
  requireValue(['--review','--check','--serve','--seller'].includes(mode),'MODE_REQUIRED');
  const sellerPath = mode === '--seller' ? args.shift() : null;
  const flags = {};
  while (args.length) {
    const flag = args.shift(), value = args.shift();
    requireValue(['--config','--port','--handlers'].includes(flag) && value &&
      !Object.hasOwn(flags,flag),'ARGUMENTS_INVALID');
    flags[flag] = value;
  }
  requireValue(flags['--config'],'CONFIG_REQUIRED');
  requireValue(!flags['--handlers'] || mode === '--seller','HANDLERS_REQUIRE_SELLER');
  requireValue(!flags['--port'] || ['--serve','--seller'].includes(mode),'PORT_REQUIRES_SERVER');
  const c = await readConfig(flags['--config']);
  if (mode === '--review') return print(reviewConfig(c));
  const {createNativeFacilitator,startSelfFacilitatedSeller} = await import('./runtime.mjs');
  if (mode === '--check') {
    const native = await createNativeFacilitator(c);
    print({mode:'NATIVE_SDK_CONFIGURATION',supported:await native.getSupported(),...native.status()});
    await native.drain(); return;
  }
  const port = flags['--port'] === undefined ? (mode === '--serve' ? 4020 : 0) : Number(flags['--port']);
  requireValue(Number.isInteger(port) && port >= 0 && port <= 65535,'PORT_INVALID');
  let running;
  if (mode === '--seller') {
    const {readSellerConfig} = await import('../sf30-seller-sdk/serve.mjs');
    const config = await readSellerConfig(sellerPath);
    const handlers = flags['--handlers'] ? await import(pathToFileURL(resolve(flags['--handlers'])).href) : {};
    running = await startSelfFacilitatedSeller({facilitatorConfig:c,config,port,handlers});
    print({mode:'NATIVE_SELF_FACILITATED_SELLER',url:running.url,network:c.network,
      supported:await running.facilitator.getSupported()});
  } else {
    const {startFacilitatorServer} = await import('./server.mjs');
    const facilitator = await createNativeFacilitator(c);
    running = await startFacilitatorServer({facilitator,port});
    print({mode:'NATIVE_FACILITATOR_HTTP',url:running.url,network:c.network,supported:await facilitator.getSupported()});
  }
  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    let result;
    try { result = await running.close(); }
    catch { result = {drained:false,error:'SHUTDOWN_FAILED_RECONCILE'}; }
    print({mode:'STOPPED',...result});
    if (result.drained === false || result.facilitator?.drained === false || result.seller?.forcedClose === true) {
      process.exitCode = 2;
      // An SDK network call cannot be cancelled after submission; the operator must reconcile.
      process.stderr.write('{"error":"INFLIGHT_OPERATION_REQUIRES_RECONCILIATION"}\n');
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
