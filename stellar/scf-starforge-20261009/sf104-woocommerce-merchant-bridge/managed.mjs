#!/usr/bin/env node
// MIT. One original Woo seller and one original SF98 delivery worker.
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileMerchant, startWooMerchant } from './seller.mjs';
import { need } from '../sf88-operator-buyer-cli/config.mjs';
import { openOutbox } from '../sf98-merchant-delivery/outbox.mjs';
import { runWorker, workerStatus } from '../sf98-merchant-delivery/worker.mjs';
import { validateDestination } from '../sf98-merchant-delivery/deliver.mjs';

export const WOO_MANAGED_STARTUP = 'stellar-forge.sf104.managed-startup.v1';
export const WOO_MANAGED_LAUNCH = 'woo-managed-launch.json';
export const WOO_MANAGED_BINDING = 'woo-managed-binding.json';
const HERE = dirname(fileURLToPath(import.meta.url));
const HASH = /^[a-f0-9]{64}$/;
const ENDPOINT = '/wp-json/stellar-forge/v1/checkout-admission';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const code = error => /^[A-Z0-9_]+$/.test(error?.code ?? '') ? error.code : 'WOO_MANAGED_FAILED';
const fail = (name, message = name) => Object.assign(new Error(message), {code:name});
const integer = (value, low, high, name) => {
  need(Number.isSafeInteger(value) && value >= low && value <= high, name);
  return value;
};
function absolute(path) {
  need(typeof path === 'string' && isAbsolute(path) && resolve(path) === path && path !== '/',
    'WOO_MANAGED_ABSOLUTE_PATH_REQUIRED');
  return path;
}
export async function readWooManagedFile(path, {max = 2097152, privateFile = false} = {}) {
  absolute(path);
  need(await realpath(dirname(path)) === dirname(path), 'WOO_MANAGED_CANONICAL_PARENT_REQUIRED');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await file.stat();
    need(before.isFile() && (!privateFile || before.nlink === 1) && before.size > 0 && before.size <= max &&
      (!privateFile || !(before.mode & 0o077)), 'WOO_MANAGED_REGULAR_FILE_REQUIRED');
    const bytes = await file.readFile(), after = await file.stat();
    need(bytes.length === before.size && before.size === after.size &&
      before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs,
      'WOO_MANAGED_FILE_CHANGED');
    return {path, bytes, sha256:sha(bytes)};
  } finally { await file.close(); }
}
export async function wooManagedSources({basket = false} = {}) {
  const names = [
    'managed.mjs', 'seller.mjs', 'buyer.mjs',
    '../sf98-merchant-delivery/worker.mjs', '../sf98-merchant-delivery/delivery-lock.mjs',
    '../sf98-merchant-delivery/deliver.mjs', '../sf98-merchant-delivery/outbox.mjs',
    '../sf30-seller-sdk/serve.mjs', '../sf30-seller-sdk/native-factory.mjs',
    '../sf30-seller-sdk/operations/server.mjs',
    ...(basket ? ['basket.mjs', 'basket-seller.mjs'] : []),
  ];
  const files = [];
  for (const name of names) {
    const original = await readWooManagedFile(resolve(HERE, name), {max:2097152});
    files.push({path:name, sha256:original.sha256});
  }
  return {files, sha256:sha(Buffer.from(JSON.stringify(files)))};
}
export function wooManagedFacilitator(raw, {allowLocal = false} = {}) {
  let url; try { url = new URL(raw); } catch { throw fail('WOO_MANAGED_FACILITATOR_REQUIRED'); }
  need((url.protocol === 'https:' || allowLocal && url.protocol === 'http:' && url.hostname === '127.0.0.1') &&
    !url.username && !url.password && !url.search && !url.hash, 'WOO_MANAGED_FACILITATOR_INVALID');
  return url.href.replace(/\/$/, '');
}
export async function reviewWooManaged({configFile, facilitator, allowLocalFacilitator = false,
  expectedConfigSha256, expectedSourceSha256} = {}) {
  const input = await readWooManagedFile(absolute(configFile));
  let raw;
  try { raw = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(input.bytes)); }
  catch { throw fail('WOO_MANAGED_CONFIG_JSON_REQUIRED'); }
  const compiled = compileMerchant(raw);
  const source = await wooManagedSources({basket:Boolean(compiled.baskets?.length)});
  for (const [expected, observed, name] of [
    [expectedConfigSha256, input.sha256, 'WOO_MANAGED_CONFIG_CHANGED'],
    [expectedSourceSha256, source.sha256, 'WOO_MANAGED_SOURCE_CHANGED'],
  ]) if (expected !== undefined) need(HASH.test(expected) && expected === observed, name);
  const admission = new URL(compiled.admissionUrl);
  need(admission.pathname.endsWith(ENDPOINT), 'WOO_MANAGED_ADMISSION_PATH_CHANGED');
  const wordpressBase = admission.pathname.slice(0, -ENDPOINT.length);
  const deliveryUrl = admission.origin + wordpressBase + '/wp-json/stellar-forge/v1/settlement';
  validateDestination(deliveryUrl, admission.hostname);
  const facilitatorUrl = wooManagedFacilitator(facilitator, {allowLocal:allowLocalFacilitator});
  const selection = {
    configFile:input.path, configSha256:input.sha256, sourceSha256:source.sha256,
    storeOrigin:compiled.storeOrigin, admissionUrl:compiled.admissionUrl,
    deliveryUrl, deliveryHost:admission.hostname,
    adminUrl:admission.origin + wordpressBase + '/wp-admin/admin.php?page=sf98-woocommerce',
    outbox:compiled.outbox, secretEnv:compiled.secretEnv, facilitator:facilitatorUrl,
    routes:compiled.routes.map(route => ({routeId:route.routeId, productId:route.productId,
      url:route.url, method:route.method, expect:route.expect})),
    catalogs:(compiled.baskets ?? []).map(catalog => ({catalogDigest:catalog.catalogDigest,
      routeId:catalog.routeId, url:catalog.url, method:catalog.method,
      products:catalog.products.length})),
  };
  const binding = await readWooManagedBinding(selection,{optional:true});
  return {compiled, source, selection, binding};
}
function scopeFor(selection) {
  return {storeOrigin:selection.storeOrigin, admissionUrl:selection.admissionUrl,
    deliveryUrl:selection.deliveryUrl, outbox:selection.outbox};
}
export async function readWooManagedBinding(selection, {optional = false} = {}) {
  let original;
  try { original=await readWooManagedFile(join(selection.outbox,WOO_MANAGED_BINDING),
    {max:16384,privateFile:true}); }
  catch(error) { if(optional&&error.code==='ENOENT')return null;throw error; }
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(original.bytes));
  need(value?.schema==='stellar-forge.sf104.managed-outbox.v1' &&
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.id??'') &&
    value.scopeSha256===sha(Buffer.from(JSON.stringify(scopeFor(selection)))) &&
    JSON.stringify(value.scope)===JSON.stringify(scopeFor(selection)),
    'WOO_MANAGED_OUTBOX_STORE_CHANGED');
  return {value,path:original.path,sha256:original.sha256};
}
async function bindOutbox(selection) {
  const existing=await readWooManagedBinding(selection,{optional:true});
  if(existing)return existing.value;
  const scope=scopeFor(selection),value={schema:'stellar-forge.sf104.managed-outbox.v1',
    id:randomUUID(),createdAt:new Date().toISOString(),scope,
    scopeSha256:sha(Buffer.from(JSON.stringify(scope)))};
  await saveLaunch(selection.outbox,value,WOO_MANAGED_BINDING);
  return value;
}
async function saveLaunch(directory, value, filename = WOO_MANAGED_LAUNCH) {
  const temporary = join(directory, '.woo-managed-launch.' + randomUUID() + '.tmp');
  let file;
  try {
    file = await open(temporary, 'wx', 0o600);
    await file.writeFile(JSON.stringify(value) + '\n'); await file.sync();
    await file.close(); file = null;
    await rename(temporary, join(directory, filename));
    const folder = await open(directory, 'r');
    try { await folder.sync(); } finally { await folder.close(); }
  } finally {
    if (file) await file.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
export async function readWooManagedLaunch(outboxDirectory) {
  const original = await readWooManagedFile(join(absolute(outboxDirectory), WOO_MANAGED_LAUNCH),
    {max:65536, privateFile:true});
  const value = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(original.bytes));
  need(value?.schema === WOO_MANAGED_STARTUP && value.status === 'WOO_MANAGED_READY',
    'WOO_MANAGED_LAUNCH_INVALID');
  return value;
}
/**
 * This controller does not sign, verify, settle or deliver by itself. The original
 * seller and original delivery worker retain all payment and attempt semantics.
 */
export async function startManagedWoo(review, {env = process.env, port = 0, sellerPort = 8423,
  pollMs = 5000, deliveryLimit = 20, deliveryConcurrency = 1, deliveryTimeoutMs = 7000,
  signal, nativeFactory, fetchImpl, deliverySend, onReady = () => {}, operationsNavigationOrigin = null,
  maxInFlight = 64, drainGraceMs = 60000} = {}) {
  integer(port,0,65535,'WOO_MANAGED_PORT_INVALID');
  integer(sellerPort,0,65535,'WOO_MANAGED_SELLER_PORT_INVALID');
  need(typeof onReady === 'function', 'WOO_MANAGED_READY_CALLBACK_INVALID');
  const current = await reviewWooManaged({configFile:review.selection.configFile,
    facilitator:review.selection.facilitator,
    allowLocalFacilitator:review.selection.facilitator.startsWith('http:'),
    expectedConfigSha256:review.selection.configSha256,expectedSourceSha256:review.selection.sourceSha256});
  const {compiled, selection, source} = current;
  if (operationsNavigationOrigin !== null) {
    const navigation = new URL(operationsNavigationOrigin);
    need(navigation.protocol==='http:' && navigation.hostname==='127.0.0.1' &&
      navigation.origin===operationsNavigationOrigin && navigation.port &&
      Number(navigation.port)<=65535 && navigation.pathname==='/' && !navigation.search && !navigation.hash,
      'WOO_MANAGED_NAVIGATION_INVALID');
  }
  const secret = env[compiled.secretEnv];
  need(typeof secret === 'string' && Buffer.byteLength(secret) >= 32 && Buffer.byteLength(secret) <= 1024,
    'WOO_PRIVATE_SHARED_SECRET_REQUIRED');
  if (signal?.aborted) throw fail('WOO_MANAGED_START_CANCELLED');
  const outbox = await openOutbox(compiled.outbox);
  if (signal?.aborted) throw fail('WOO_MANAGED_START_CANCELLED');
  const controller = new AbortController();
  let merchant = null, starting = null, closing = null, stopping = false, failure = null;
  let owner = null, outboxBinding = null, launch = null, resolveReady, rejectReady, resolveDone;
  const ready = new Promise((yes,no) => { resolveReady=yes; rejectReady=no; });
  const done = new Promise(yes => { resolveDone=yes; });
  // Attach both terminal observers before awaiting original lease readiness.
  const worker = runWorker(outbox, {
    url:selection.deliveryUrl, allowedHost:selection.deliveryHost, secret,
    signal:controller.signal, pollMs, limit:deliveryLimit, concurrency:deliveryConcurrency,
    timeoutMs:deliveryTimeoutMs, ...(deliverySend ? {send:deliverySend} : {}),
    onReady:async state => {
      owner=state.owner;
      // The SAME original lease protects initial binding before any delivery.
      outboxBinding=await bindOutbox(selection);
      resolveReady(state);
    },
  }).then(
    result => {
      if (!stopping) {
        failure ??= fail('WOO_MANAGED_DELIVERY_STOPPED');
        rejectReady(failure); queueMicrotask(() => { void close(); });
      }
      return {result, error:null};
    },
    error => {
      failure ??= error; rejectReady(error);
      if (!stopping) queueMicrotask(() => { void close(); });
      return {result:null, error};
    },
  );
  const stop = () => { void close(); };
  async function close() {
    if (closing) return closing;
    stopping = true;
    closing = (async () => {
      try {
        // A worker failure during native initialization must still close the
        // returned seller. Its original close waits verification/settlement.
        await starting?.catch(() => {});
        try { await merchant?.close(); } catch (error) { failure ??= error; }
      } finally {
        controller.abort(fail('WOO_MANAGED_STOP_REQUESTED'));
        const final = await worker;
        failure ??= final.error;
        signal?.removeEventListener('abort', stop);
        const result = {schema:'stellar-forge.sf104.managed-result.v1',
          status:failure ? 'FAILED' : 'STOPPED', outbox:outbox.dir,
          deliveryOwner:owner, finishedAt:new Date().toISOString(),
          delivery:final.result, ...(failure ? {error:code(failure)} : {})};
        resolveDone(result);
      }
      return done;
    })();
    return closing;
  }
  signal?.addEventListener('abort', stop, {once:true});
  if (signal?.aborted) stop();
  try {
    await ready;
    if (stopping || signal?.aborted || failure) throw failure ?? fail('WOO_MANAGED_START_CANCELLED');
    let factory = nativeFactory;
    if (!factory) {
      const [{HTTPFacilitatorClient},{createNativeSellerServer}] = await Promise.all([
        import('@x402/core/server'), import('../sf30-seller-sdk/native-factory.mjs')]);
      const client = new HTTPFacilitatorClient({url:selection.facilitator});
      factory = routes => createNativeSellerServer(routes, {facilitatorClient:client});
    }
    if (stopping || signal?.aborted || failure) throw failure ?? fail('WOO_MANAGED_START_CANCELLED');
    starting = startWooMerchant(compiled, {env, nativeFactory:factory, fetchImpl,
      port:sellerPort, operationsPort:port, operationsNavigationOrigin, maxInFlight, drainGraceMs});
    merchant = await starting;
    if (stopping || signal?.aborted || failure) throw failure ?? fail('WOO_MANAGED_START_CANCELLED');
    launch = {schema:WOO_MANAGED_STARTUP, status:'WOO_MANAGED_READY', launchId:randomUUID(),
      startedAt:new Date().toISOString(), pid:process.pid, ppid:process.ppid,
      configFile:selection.configFile,configSha256:selection.configSha256,
      sourceSha256:selection.sourceSha256,outbox:selection.outbox,
      selectionSha256:sha(Buffer.from(JSON.stringify(selection))),
      outboxBindingId:outboxBinding.id,source,deliveryOwner:owner,
      url:merchant.operations.url, seller:merchant.seller.url,
      fulfillment:merchant.operations.url + '/fulfillment',
      deliveryControls:merchant.operations.deliveryControlUrl ?? null,
      operationsNavigationOrigin,mode:merchant.seller.mode};
    need(Buffer.byteLength(JSON.stringify(launch))<=16000,'WOO_MANAGED_LAUNCH_TOO_LARGE');
    await saveLaunch(outbox.dir, launch);
    if (stopping || failure) throw failure ?? fail('WOO_MANAGED_START_CANCELLED');
    await onReady(launch);
    return {launch, merchant, outbox, close, done};
  } catch (error) {
    failure ??= error;
    await close();
    throw error;
  }
}
export async function inspectWooManagedStatus(review) {
  const outbox = await openOutbox(review.compiled.outbox);
  const delivery = await workerStatus(outbox);
  let launch = null;
  try { launch = await readWooManagedLaunch(outbox.dir); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const active = Boolean(delivery.deliveryOwner.active && launch &&
    delivery.deliveryOwner.owner?.id === launch.deliveryOwner?.id);
  return {schema:'stellar-forge.sf104.managed-status.v1', observedAt:new Date().toISOString(),
    active, configurationMatches:!launch || launch.configSha256 === review.selection.configSha256,
    selection:review.selection, launch, delivery};
}
const USAGE = [
  'woo-managed inspect|status|serve --config /private/woo-merchant.json --facilitator https://facilitator.example',
  'serve: --port 0 --seller-port 8423 --poll-ms 5000 --delivery-limit 20 --delivery-concurrency 1 --delivery-timeout-ms 7000',
  'Applications supplies --expected-config-sha256 and --expected-source-sha256 from the original selected runtime.',
  'serve starts the original native seller and SAME original SF98 outbox worker. Stop drains seller before delivery.',
  'The merchant config supplies the original WordPress URL and secret environment name. The WordPress PHP constant must match.',
  'Use the merchant existing HTTPS ingress for the seller. WordPress remains the order/release/refund interface.',
].join('\n');
export async function main(argv=process.argv.slice(2)) {
  if (argv.length===1 && argv[0]==='--help') { console.log(USAGE); return; }
  const [action,...rest]=argv, options=new Map();
  need(['inspect','status','serve'].includes(action),'WOO_MANAGED_ACTION_REQUIRED');
  const flags=['--config','--facilitator','--port','--seller-port','--poll-ms','--delivery-limit',
    '--delivery-concurrency','--delivery-timeout-ms','--expected-config-sha256','--expected-source-sha256',
    '--expected-selection-sha256','--operations-navigation-origin'];
  for(let i=0;i<rest.length;i++) {
    const flag=rest[i];
    need(!options.has(flag),'WOO_MANAGED_DUPLICATE_OPTION');
    if(flag==='--allow-local-facilitator') {options.set(flag,true);continue;}
    need(flags.includes(flag)&&typeof rest[i+1]==='string'&&!rest[i+1].startsWith('--'),
      'WOO_MANAGED_OPTION_INVALID');
    options.set(flag,rest[++i]);
  }
  need(options.has('--config')&&options.has('--facilitator'),'WOO_MANAGED_INPUT_REQUIRED');
  const review=await reviewWooManaged({configFile:absolute(options.get('--config')),
    facilitator:options.get('--facilitator'),allowLocalFacilitator:options.has('--allow-local-facilitator'),
    expectedConfigSha256:options.get('--expected-config-sha256'),
    expectedSourceSha256:options.get('--expected-source-sha256')});
  if(options.has('--expected-selection-sha256')) need(options.get('--expected-selection-sha256')===
    sha(Buffer.from(JSON.stringify(review.selection))),'WOO_MANAGED_SELECTION_CHANGED');
  if(action==='inspect') {
    const result={schema:'stellar-forge.sf104.managed-review.v1',selection:review.selection,
      source:review.source,networkRequests:0};console.log(JSON.stringify(result,null,2));return result;
  }
  if(action==='status') {const result=await inspectWooManagedStatus(review);console.log(JSON.stringify(result,null,2));return result;}
  const number=(flag,fallback,low,high)=>{
    const raw=options.get(flag)??String(fallback);
    need(/^(0|[1-9][0-9]{0,5})$/.test(raw),'WOO_MANAGED_NUMBER_INVALID');
    return integer(Number(raw),low,high,'WOO_MANAGED_NUMBER_INVALID');
  };
  const controller=new AbortController(),stop=()=>controller.abort(fail('WOO_MANAGED_STOP_REQUESTED'));
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
  try {
    const session=await startManagedWoo(review,{
      signal:controller.signal,port:number('--port',0,0,65535),
      operationsNavigationOrigin:options.get('--operations-navigation-origin')??null,
      sellerPort:number('--seller-port',8423,0,65535),pollMs:number('--poll-ms',5000,50,60000),
      deliveryLimit:number('--delivery-limit',20,1,100),deliveryConcurrency:number('--delivery-concurrency',1,1,16),
      deliveryTimeoutMs:number('--delivery-timeout-ms',7000,100,60000),
      onReady:value=>process.stdout.write(JSON.stringify(value)+'\n')});
    const result=await session.done;
    process.stdout.write(JSON.stringify(result)+'\n');
    if(result.status==='FAILED')process.exitCode=1;
    return result;
  } finally {process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{process.stderr.write(JSON.stringify({error:code(error),automaticPaymentRetry:false})+'\n');
    process.exitCode=error.code==='SF98_DELIVERY_BUSY'?75:1;});
