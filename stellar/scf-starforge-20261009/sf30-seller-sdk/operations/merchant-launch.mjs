// MIT. One original SF30 native seller, original SF98 journal, one local operator listener.
// No new payment verifier, wallet, webhook worker or managed cloud dependency.
import { resolve, dirname, isAbsolute } from 'node:path';
import { stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readSellerConfig, startSellerService } from '../serve.mjs';
import { compileSellerRoutes } from '../resource-server.mjs';
import { createNativeSellerServer } from '../native-factory.mjs';
import { readUpstreamBindings, compileUpstreamBindings,
  validateUpstreamService, createUpstreamHandlers } from '../upstream.mjs';
import { openOutbox, instrumentNativeSettlement } from '../../sf98-merchant-delivery/outbox.mjs';
import { startSellerOperations } from './server.mjs';
import { validateAvailabilityDirectory } from '../availability/store.mjs';

const HELP = [
  'Usage: node operations/merchant-launch.mjs --config SELLER.json',
  ' --facilitator HTTPS_URL --state /private/merchant/outbox',
  ' [--handlers TRUSTED_LOCAL_MODULE.mjs | --upstreams BINDINGS.json]',
  ' [--port 8423] [--operations-port 8424] [--max-in-flight 64]',
  ' [--drain-grace-ms 60000] [--allow-loopback-upstream]',
  ' [--history-dir /private/merchant/usage] [--history-days 90]',
  ' [--availability-dir /private/merchant/availability]',
  ' [--allow-local-facilitator] [--check]',
  'Explicit operator-run native x402, original SF98 outbox and local fulfillment view.',
].join('\n');
const VALUE = new Set(['--config','--facilitator','--state','--handlers','--upstreams',
  '--port','--operations-port','--max-in-flight','--drain-grace-ms','--history-dir','--history-days','--availability-dir']);
const SWITCH = new Set(['--check','--allow-loopback-upstream','--allow-local-facilitator']);
const fail = m => { throw new TypeError(m); };

function cliOptions(args) {
  if (args.length === 1 && args[0] === '--help') return null;
  const o = new Map();
  for (let i=0;i<args.length;i++) {
    const key=args[i];
    if(o.has(key)) fail('Duplicate option: '+key);
    if(SWITCH.has(key)) {o.set(key,true);continue;}
    if(!VALUE.has(key) || !args[i+1] || args[i+1].startsWith('--')) fail(HELP);
    o.set(key,args[++i]);
  }
  if(!o.has('--config') || !o.has('--state') || !o.has('--facilitator') ||
     o.has('--handlers') && o.has('--upstreams') ||
     o.has('--allow-loopback-upstream') && !o.has('--upstreams')) fail(HELP);
  const int=(name,defaultValue,min,max)=>{
    const raw=o.get(name)??String(defaultValue);
    if(!/^(?:0|[1-9]\d*)$/.test(raw))fail('Invalid '+name);
    const n=Number(raw);
    if(!Number.isSafeInteger(n)||n<min||n>max)fail('Invalid '+name);
    return n;
  };
  const port=int('--port',8423,0,65535);
  const operationsPort=int('--operations-port',8424,0,65535);
  if(port>0 && port===operationsPort)fail('Seller and operations ports must differ');
  const rawUrl=o.get('--facilitator');
  let url;
  try {url=new URL(rawUrl);} catch {fail('Invalid trusted facilitator URL');}
  const local=o.has('--allow-local-facilitator') && url.protocol==='http:' &&
    url.hostname==='127.0.0.1';
  if((!local && url.protocol!=='https:') || url.username || url.password ||
     url.search || url.hash || url.href.replace(/\/$/,'')!==rawUrl.replace(/\/$/,''))
    fail('Explicit trusted facilitator HTTPS URL required');
  const directory=o.get('--state');
  if(!isAbsolute(directory)||resolve(directory)!==directory||directory==='/')
    fail('Absolute normalized private SF98 outbox directory required');
  const historyDirectory=o.get('--history-dir');
  const availabilityDirectory=o.has('--availability-dir') ? validateAvailabilityDirectory(o.get('--availability-dir')) : undefined;
  if(o.has('--history-days') && historyDirectory===undefined)
    fail('--history-days requires --history-dir');
  if(historyDirectory!==undefined && (!isAbsolute(historyDirectory) ||
     resolve(historyDirectory)!==historyDirectory || historyDirectory==='/' ||
     historyDirectory===directory))
    fail('Absolute normalized private history directory separate from the outbox required');
  if(availabilityDirectory!==undefined && [directory,historyDirectory].includes(availabilityDirectory))
    fail('Use a separate private availability directory');
  return {
    configPath:resolve(o.get('--config')),stateDirectory:directory,
    historyDirectory,historyRetentionDays:int('--history-days',90,1,365),
    availabilityDirectory,
    handlersPath:o.has('--handlers')?o.get('--handlers'):null,
    upstreamPath:o.has('--upstreams')?resolve(o.get('--upstreams')):null,
    facilitator:url.href.replace(/\/$/,''),check:o.has('--check'),
    allowLoopback:o.has('--allow-loopback-upstream'),
    port,operationsPort,maxInFlight:int('--max-in-flight',64,1,1024),
    drainGraceMs:int('--drain-grace-ms',60000,1000,300000),
  };
}

async function sourceConfig(o) {
  const config=await readSellerConfig(o.configPath);
  let upstream=null, compiled=null;
  if(o.upstreamPath) {
    upstream=await readUpstreamBindings(o.upstreamPath);
    compiled=compileUpstreamBindings(upstream,{allowLoopback:o.allowLoopback,env:process.env});
    validateUpstreamService(config,compiled);
  } else if(config.routes.some(route=>route.handler) && !o.handlersPath) {
    fail('Merchant handler route requires --handlers or --upstreams');
  }
  if(o.handlersPath) {
    const path=resolve(dirname(o.configPath),o.handlersPath);
    const s=await stat(path);
    if(!s.isFile()) fail('Trusted merchant handler module must be a regular file');
  }
  // Original compiler checks offers, method, route binding and network support.
  const origin=config.publicOrigin ? new URL(config.publicOrigin).origin : 'http://127.0.0.1:8423';
  const defs=config.routes.map(route=>({
    id:route.id,
    ...(route.offer ? {offer:route.offer} :
      {definition:{...route.definition,url:origin+route.path}}),
    handler:async()=>{throw Error('Preflight never runs merchant application handlers');},
  }));
  const original=compileSellerRoutes(defs,{allowLocalhost:!config.publicOrigin});
  return {config,upstream,compiled,original};
}

export async function main(args=process.argv.slice(2)) {
  const o=cliOptions(args);
  if(!o) {process.stdout.write(HELP+'\n');return null;}
  let prepared;
  try {prepared=await sourceConfig(o);}
  catch(e) {e.operatorMessage='MERCHANT_CONFIG_PREFLIGHT_FAILED';throw e;}
  if(o.check) {
    const info={
      status:'ORIGINAL_CONFIG_VALID',
      nativeRoutes:prepared.original.routes.length,
      upstreamBindings:prepared.compiled?Object.keys(prepared.compiled).length:0,
      externalHandlerModule:!!o.handlersPath,
      privateStateNotOpened:true,
      facilitatorNotContacted:true,
      usageHistoryEnabled:o.historyDirectory!==undefined,
      availabilityEnabled:o.availabilityDirectory!==undefined,
      historyRetentionDays:o.historyDirectory===undefined?null:o.historyRetentionDays,
    };
    process.stdout.write(JSON.stringify(info)+'\n');
    return info;
  }
  let handlers={};
  try {
    if(o.upstreamPath)
      handlers=createUpstreamHandlers(prepared.upstream,
        {allowLoopback:o.allowLoopback,env:{...process.env}});
    else if(o.handlersPath)
      handlers=await import(pathToFileURL(resolve(dirname(o.configPath),o.handlersPath)).href);
  } catch(e) {e.operatorMessage='MERCHANT_HANDLER_SETUP_FAILED';throw e;}
  const outbox=await openOutbox(o.stateDirectory);
  const [{HTTPFacilitatorClient}]=await Promise.all([import('@x402/core/server')]);
  const client=new HTTPFacilitatorClient({url:o.facilitator});
  const nativeFactory=async compiled=>{
    const native=await createNativeSellerServer(compiled,{facilitatorClient:client});
    return instrumentNativeSettlement(native,{
      compiled,outbox,
      onWriteFailure:()=>process.stderr.write('NATIVE_SUCCESS_OUTBOX_WARNING\n'),
    });
  };
  let seller,operations;
  try {
    seller=await startSellerService({
      config:prepared.config,port:o.port,handlers,nativeFactory,
      maxInFlight:o.maxInFlight,drainGraceMs:o.drainGraceMs,
      availabilityDirectory:o.availabilityDirectory,
    });
    operations=await startSellerOperations(seller,{
      port:o.operationsPort,deliveryOutbox:outbox,
      historyDirectory:o.historyDirectory,historyRetentionDays:o.historyRetentionDays,
    });
  } catch(e) {
    if(operations)await operations.close().catch(()=>{});
    if(seller)await seller.close().catch(()=>{});
    e.operatorMessage='MERCHANT_RUNTIME_START_FAILED';throw e;
  }
  let closing;
  const close=()=>{
    if(!closing)closing=(async()=>{
      // Keep the original observer attached throughout native request drain.
      let failed=false;
      try {await seller.close();} catch {failed=true;}
      try {await operations.close();} catch {failed=true;}
      if(failed)throw Error('MERCHANT_SHUTDOWN_FAILED');
    })();
    return closing;
  };
  for(const signal of ['SIGINT','SIGTERM'])
    process.once(signal,()=>close().catch(()=>{process.exitCode=1;}));
  process.stdout.write(JSON.stringify({
    nativeSeller:seller.url, mode:seller.mode,
    ready:seller.url+'/_seller/ready', offers:seller.url+'/_seller/offers',
    operator:operations.url,fulfillment:operations.url+'/fulfillment',
    availability:operations.availabilityUrl,availabilityControl:operations.availabilityControlUrl,
    fulfillmentControl:operations.deliveryControlUrl,
    usageHistory:o.historyDirectory===undefined?null:operations.url+'/api/history',
    privateOriginalOutboxAttached:true,
    webhookDelivery:'OPERATOR_ONLY',
  })+'\n');
  return {seller,operations,outbox,close};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(e=>{
    process.stderr.write((e?.operatorMessage??'MERCHANT_LAUNCH_FAILED')+'\n');
    process.exitCode=1;
  });
}
