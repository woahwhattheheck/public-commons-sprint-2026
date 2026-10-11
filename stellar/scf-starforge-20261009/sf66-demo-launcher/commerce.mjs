// MIT. One operator session over the original merchant, inbox and buyer runtimes.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, lstat, open, realpath, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { isDeepStrictEqual as same } from 'node:util';
import { readSellerConfig, startSellerService } from '../sf30-seller-sdk/serve.mjs';
import { createNativeSellerServer } from '../sf30-seller-sdk/native-factory.mjs';
import { startSellerOperations } from '../sf30-seller-sdk/operations/server.mjs';
import { validateAvailabilityDirectory } from '../sf30-seller-sdk/availability/store.mjs';
import { selectServiceRoute } from '../sf30-seller-sdk/route-path.mjs';
import { initializeQueue, openQueue } from '../sf88-operator-buyer-cli/queue.mjs';
import { acquireInitialization, initializationJson, retainInitializationFile,
  retainInitializationRecord, optionalInitializationBytes, verifyInitializationFile } from '../sf88-operator-buyer-cli/initialization.mjs';
import { readRequestBody } from '../sf88-operator-buyer-cli/request-body.mjs';
import { config as readBuyer, execution } from '../sf88-operator-buyer-cli/config.mjs';
import { absolute, readPrivateFile, parseJson, inspectOperatorConfig } from '../sf103-native-buyer-signer/operator.mjs';
import { readCheckout, compileCheckout } from '../sf101-merchant-receiver/checkout-config.mjs';
import { startCheckout } from '../sf101-merchant-receiver/checkout.mjs';
import { readPurchaseInput, freezePurchase, inspectCommercePurchase, retrieveCommercePurchase, resetCommercePurchase } from './commerce-purchase.mjs';
import { preparePythonCommerce, savePythonCommerce, readPythonCommerce,
  describePythonCommerce, openPythonCommerce } from './commerce-python.mjs';
import { readUpstreamCommerce, retainUpstreamCommerce, openUpstreamCommerce,
  describeUpstreamCommerce } from './commerce-upstream.mjs';
import { readJsonrpcCommerce, retainJsonrpcCommerce, describeJsonrpcCommerce,
  openJsonrpcCommerce } from './commerce-jsonrpc.mjs';
import { createJsonrpcCommerceRecovery } from './commerce-jsonrpc-recovery.mjs';
import { createCommerceStreamAccess } from './commerce-stream.mjs';

const PLAN = 'stellar-forge.commerce-plan.v1';
const SESSION = 'stellar-forge.commerce-session.v1';
const here = dirname(fileURLToPath(import.meta.url));
const buyerCli = resolve(here, '../sf88-operator-buyer-cli/cli.mjs');
const queueCli = resolve(here, '../sf88-operator-buyer-cli/queue-cli.mjs');
const nativeSigner = resolve(here, '../sf103-native-buyer-signer/signer.mjs');
const signerCli = resolve(here, '../sf103-native-buyer-signer/setup.mjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const codeOf = error => /^[A-Z0-9_]{1,120}$/.test(error?.code ?? '') ? error.code : 'COMMERCE_OPERATION_FAILED';
function need(ok, code) { if (!ok) throw Object.assign(new Error(code), { code }); }
function fields(value, names, code) {
  need(object(value) && Object.keys(value).every(key => names.includes(key)), code);
  return value;
}
function port(value, fallback) {
  value ??= fallback;
  need(Number.isInteger(value) && value >= 0 && value <= 65535, 'COMMERCE_PORT_INVALID');
  return value;
}
async function privateDirectory(path) {
  absolute(path);
  const info = await lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() && await realpath(path) === path &&
    (process.platform === 'win32' || (info.uid === process.getuid() && (info.mode & 0o077) === 0)),
  'COMMERCE_PRIVATE_DIRECTORY_REQUIRED');
}
async function sourceFile(path, maximum = 1048576) {
  absolute(path);
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat();
    need(info.isFile() && info.size <= maximum && (info.mode & 0o022) === 0, 'COMMERCE_SOURCE_FILE_INVALID');
    const bytes = await file.readFile();
    need(bytes.length <= maximum, 'COMMERCE_SOURCE_TOO_LARGE');
    return { path, bytes, sha256: sha(bytes) };
  } finally { await file.close(); }
}
async function writeNew(path, value) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2) + '\n'); await file.sync(); }
  finally { await file.close(); }
}
function facilitator(value) {
  if (value === undefined) return null;
  fields(value, ['url', 'allowLocal'], 'COMMERCE_FACILITATOR_INVALID');
  need(value.allowLocal === undefined || typeof value.allowLocal === 'boolean', 'COMMERCE_FACILITATOR_INVALID');
  let url;
  try { url = new URL(value.url); } catch { need(false, 'COMMERCE_FACILITATOR_URL_INVALID'); }
  const local = value.allowLocal === true && url.protocol === 'http:' &&
    url.hostname === '127.0.0.1' && url.port;
  need((url.protocol === 'https:' || local) && !url.username && !url.password && !url.search && !url.hash,
    'COMMERCE_FACILITATOR_HTTPS_OR_EXPLICIT_LOOPBACK_REQUIRED');
  return { url: url.href.replace(/\/$/, ''), allowLocal: value.allowLocal === true };
}
function plan(value) {
  fields(value, ['schema', 'seller', 'buyers', 'operationsPort', 'operationControls'], 'COMMERCE_PLAN_INVALID');
  need(value.schema === PLAN && Array.isArray(value.buyers) && value.buyers.length >= 1 &&
    value.buyers.length <= 64, 'COMMERCE_PLAN_BUYERS_REQUIRED');
  const seller = fields(value.seller, ['config', 'checkoutConfig', 'python', 'jsonrpc', 'handlers', 'upstreams',
    'allowLoopbackUpstream', 'availabilityDirectory', 'port', 'facilitator', 'facilitatorConfig'], 'COMMERCE_SELLER_INVALID');
  need([seller.config, seller.checkoutConfig, seller.python, seller.jsonrpc].filter(Boolean).length === 1,
    'COMMERCE_ONE_SELLER_CONFIGURATION_REQUIRED');
  absolute(seller.checkoutConfig ?? seller.python ?? seller.jsonrpc ?? seller.config);
  need(!(seller.checkoutConfig || seller.python || seller.jsonrpc) || seller.handlers === undefined, 'COMMERCE_APPLICATION_USES_ORIGINAL_HANDLERS');
  need(seller.upstreams === undefined || seller.config && seller.handlers === undefined,
    'COMMERCE_UPSTREAM_USES_CONFIGURED_APPLICATION');
  need(seller.allowLoopbackUpstream === undefined || (seller.upstreams !== undefined || seller.jsonrpc !== undefined) &&
    typeof seller.allowLoopbackUpstream === 'boolean', 'COMMERCE_UPSTREAM_LOOPBACK_INVALID');
  need(value.operationControls === undefined || typeof value.operationControls === 'boolean',
    'COMMERCE_OPERATION_CONTROLS_INVALID');
  if (seller.upstreams !== undefined) absolute(seller.upstreams);
  if (seller.handlers !== undefined) absolute(seller.handlers);
  if (seller.facilitatorConfig !== undefined) absolute(seller.facilitatorConfig);
  need(!seller.facilitatorConfig || seller.facilitator === undefined, 'COMMERCE_ONE_FACILITATOR_REQUIRED');
  const buyers = value.buyers.map(item => {
    fields(item, ['config', 'signerConfig', 'workspace', 'paidFile'], 'COMMERCE_BUYER_INVALID');
    absolute(item.config);
    if (item.signerConfig !== undefined) absolute(item.signerConfig);
    if (item.workspace !== undefined) absolute(item.workspace);
    return { ...item };
  });
  return { seller: { config: seller.config ?? null, checkoutConfig: seller.checkoutConfig ?? null, handlers: seller.handlers ?? null,
    python: seller.python ?? null, jsonrpc: seller.jsonrpc ?? null,
    upstreams: seller.upstreams ?? null, allowLoopbackUpstream: seller.allowLoopbackUpstream === true,
    availabilityDirectory: seller.availabilityDirectory === undefined ? null :
      validateAvailabilityDirectory(seller.availabilityDirectory),
    port: port(seller.port, 8423), facilitator: facilitator(seller.facilitator),
    facilitatorConfig: seller.facilitatorConfig ?? null },
  buyers, operationsPort: port(value.operationsPort, 0), operationControls: value.operationControls === true };
}

/** Create an original buyer inbox and one persistent merchant configuration. */
export async function initializeCommerce({ planFile, directory }, { resume = false } = {}) {
  absolute(planFile); absolute(directory);
  await privateDirectory(dirname(directory));
  const planBytes = await readPrivateFile(planFile), input = plan(parseJson(planBytes));
  const checkoutRaw = input.seller.checkoutConfig ? await readPrivateFile(input.seller.checkoutConfig) : null;
  const checkout = checkoutRaw ? compileCheckout(parseJson(checkoutRaw)) : null;
  const python = input.seller.python ? await preparePythonCommerce(input.seller.python) : null;
  const jsonrpc = input.seller.jsonrpc ? await readJsonrpcCommerce(input.seller.jsonrpc,
    { allowLoopback: input.seller.allowLoopbackUpstream }) : null;
  const seller = checkout?.service ?? python?.compiled.service ?? jsonrpc?.service ?? await readSellerConfig(input.seller.config);
  need(typeof seller.publicOrigin === 'string', 'COMMERCE_MERCHANT_PUBLIC_ORIGIN_REQUIRED');
  const upstream = input.seller.upstreams ? await readUpstreamCommerce(input.seller.upstreams, seller,
    {allowLoopback:input.seller.allowLoopbackUpstream}) : null;
  need(!input.operationControls || upstream &&
    Object.values(upstream.review.bindings).some(binding => binding.idempotency),
  'COMMERCE_OPERATION_CONTROLS_REQUIRE_IDEMPOTENT_UPSTREAM');
  const handlers = input.seller.handlers ? await sourceFile(input.seller.handlers) : null;
  let facilitatorConfig;
  if (input.seller.facilitatorConfig) {
    const { readConfig } = await import('../native-facilitator/config.mjs');
    facilitatorConfig = await readConfig(input.seller.facilitatorConfig);
  }
  const prepared = [], sources = [], outputs = new Set();
  let operatorPython;
  const reserveOutput = path => {
    const key = resolve(path);
    need(!outputs.has(key), 'COMMERCE_OUTPUT_PATH_COLLISION');
    outputs.add(key);
  };
  for (const entry of input.buyers) {
    const buyer = await readBuyer(entry.config), { op, owner } = execution(buyer);
    operatorPython ??= owner.python;
    const body = await readRequestBody(op);
    need(new URL(op.url).origin === new URL(seller.publicOrigin).origin, 'COMMERCE_BUYER_MERCHANT_ORIGIN_MISMATCH');
    need(!prepared.some(item => item.intentId === op.intentId), 'COMMERCE_DUPLICATE_INTENT');
    need(buyer.signerModule !== nativeSigner || entry.signerConfig, 'COMMERCE_SF103_CONFIG_REQUIRED');
    const signer = entry.signerConfig ? await inspectOperatorConfig(entry.signerConfig) : null;
    if (signer) need(signer.config.buyerConfig === entry.config &&
      signer.expected.operation.intentId === op.intentId, 'COMMERCE_SF103_BUYER_MISMATCH');
    if (entry.workspace) await privateDirectory(entry.workspace);
    const purchase = entry.paidFile ? await readPurchaseInput(entry.paidFile, op, buyer.responseFile?.destination) : null;
    sources.push({ intentId: op.intentId, config: entry.config,
      configSha256: sha(await readPrivateFile(entry.config, 65536)),
      bodySha256: body === undefined ? null : sha(body), bodyBytes: body?.length ?? 0,
      signerSha256: sha(await sourceFile(buyer.signerModule).then(value => value.bytes)),
      policySha256: sha(await readPrivateFile(owner.policy)),
      purchaseSha256: purchase?.sha256 ?? null });
    reserveOutput(join(buyer.evidenceDir, sha(op.intentId) + '.json'));
    if (buyer.responseFile) reserveOutput(buyer.responseFile.destination);
    if (purchase) { reserveOutput(purchase.destination); reserveOutput(purchase.destination + '.sf101.json'); }
    if (purchase) need(!prepared.some(item => item.purchase?.destination === purchase.destination),
      'COMMERCE_DUPLICATE_PRODUCT_DESTINATION');
    prepared.push({ ...entry, intentId: op.intentId,
      ...(purchase ? { purchase } : {}),
      ...(entry.signerConfig ? { signerConfigSha256: sha(await readPrivateFile(entry.signerConfig)) } : {}) });
  }
  const lease = await acquireInitialization(directory, { python: operatorPython, resume });
  try {
    const checkpoint = { schema: 'stellar-forge.commerce-session-initialization.v1', planFile,
      planSha256: sha(planBytes), directory, buyers: sources,
      sellerSha256: sha(initializationJson(seller)),
      python: python ? { declaration: python.declaration, applicationSha256: python.applicationSha256 } : null,
      upstreamSha256: upstream?.sha256 ?? null, jsonrpcSha256: jsonrpc?.sha256 ?? null,
      facilitatorSha256: facilitatorConfig ? sha(initializationJson(facilitatorConfig)) : null,
      handlersSha256: handlers?.sha256 ?? null };
    const priorCheckpoint = await optionalInitializationBytes(join(directory, 'initializing.json'));
    if (lease.created || priorCheckpoint)
      await retainInitializationRecord(join(directory, 'initializing.json'), checkpoint, { resume });
    const sellerBytes = initializationJson(seller);
    const pythonSnapshot = python ? { python: join(directory, 'python.json'),
      pythonSha256: sha(initializationJson(python.declaration)), pythonApplicationSha256: python.applicationSha256 } : {};
    const upstreamSnapshot = upstream ? { file: join(directory, 'upstreams.json'), sha256: upstream.sha256 } : null;
    const jsonrpcSnapshot = jsonrpc ? { file: join(directory, 'jsonrpc.json'), sha256: jsonrpc.sha256 } : null;
    const queueRoot = join(directory, 'inbox');
    const facilitatorPath = facilitatorConfig ? join(directory, 'facilitator.json') : null;
    const buyers = [];
    for (const entry of prepared) {
      const { purchase, paidFile: sourcePaidFile, ...original } = entry;
      if (purchase) original.paidFile = { handoff: join(directory, 'handoff-' + sha(entry.intentId) + '.json'),
        handoffSha256: purchase.sha256, destination: purchase.destination, claimEnv: purchase.claimEnv };
      buyers.push(original);
    }
    const checkoutPath = checkoutRaw ? join(directory, 'checkout.json') : null;
    const session = { schema: SESSION, createdAt: new Date().toISOString(),
      directory, queueRoot, seller: { ...input.seller, config: join(directory, 'seller.json'),
        configSha256: sha(sellerBytes),
        ...pythonSnapshot,
        upstreams: upstreamSnapshot?.file ?? null,
        ...(upstreamSnapshot ? {upstreamsSha256:upstreamSnapshot.sha256} : {}),
        jsonrpc: jsonrpcSnapshot?.file ?? null,
        ...(jsonrpcSnapshot ? { jsonrpcSha256: jsonrpcSnapshot.sha256 } : {}),
        checkoutConfig: checkoutPath,
        ...(checkoutPath ? { checkoutConfigSha256: sha(initializationJson(parseJson(checkoutRaw))) } : {}),
        facilitatorConfig: facilitatorPath,
        ...(facilitatorPath ? { facilitatorConfigSha256: sha(initializationJson(facilitatorConfig)) } : {}),
        ...(handlers ? { handlersSha256: handlers.sha256 } : {}) },
      operationsPort: input.operationsPort, operationControls: input.operationControls, buyers };
    const checkBuyer = queued => {
      const source = sources.find(item => item.intentId === queued.operation.intentId);
      need(source && queued.sourceConfigSha256 === source.configSha256 && queued.bodySha256 === source.bodySha256 &&
        queued.bodyBytes === source.bodyBytes && queued.dependencies?.signer?.sha256 === source.signerSha256 &&
        queued.dependencies?.policy?.sha256 === source.policySha256, 'COMMERCE_INITIALIZATION_BUYER_CHANGED');
    };
    // A published session is reopened read-only. Lost queue history is restored, never re-enqueued.
    if (await optionalInitializationBytes(join(directory, 'session.json'))) {
      await retainInitializationRecord(join(directory, 'session.json'), session, { resume: true, ignore: ['createdAt'] });
      const existing = await readSession(directory);
      for (const queued of existing.jobs) checkBuyer(queued);
      return await inspectCommerce(directory);
    }
    const staged = [[join(directory, 'seller.json'), sellerBytes],
      ...(python ? [[pythonSnapshot.python, initializationJson(python.declaration)]] : []),
      ...(upstream ? [[upstreamSnapshot.file, upstream.sourceBytes]] : []),
      ...(jsonrpc ? [[jsonrpcSnapshot.file, jsonrpc.sourceBytes]] : []),
      ...(facilitatorPath ? [[facilitatorPath, initializationJson(facilitatorConfig)]] : [])];
    const inboxPresent = await lstat(queueRoot).then(() => true).catch(error => {
      if (error.code === 'ENOENT') return false; throw error;
    });
    if (resume) {
      for (const [path, bytes] of staged) {
        const present = await verifyInitializationFile(path, bytes);
        need(!inboxPresent || present, 'COMMERCE_RESTORE_ORIGINAL_SESSION_INPUTS');
      }
      if (checkoutPath) await verifyInitializationFile(checkoutPath, initializationJson(parseJson(checkoutRaw)));
      for (const entry of prepared) if (entry.purchase)
        await verifyInitializationFile(join(directory, 'handoff-' + sha(entry.intentId) + '.json'), entry.purchase.bytes);
    }
    const retain = (path, value) => retainInitializationFile(path, initializationJson(value), { resume });
    await retain(join(directory, 'seller.json'), seller);
    if (python) await savePythonCommerce(python, directory, { resume });
    if (upstream) await retainUpstreamCommerce(upstreamSnapshot.file, upstream, { resume });
    if (jsonrpc) await retainJsonrpcCommerce(jsonrpcSnapshot.file, jsonrpc, { resume });
    if (facilitatorPath) await retain(facilitatorPath, facilitatorConfig);
    await initializeQueue(queueRoot, { resume });
    const queue = await openQueue(queueRoot);
    for (const queued of await queue.list()) checkBuyer(queued);
    for (const entry of prepared) checkBuyer(await queue.enqueue(entry.config));
    for (const entry of prepared) if (entry.purchase)
      await freezePurchase(entry.purchase, join(directory, 'handoff-' + sha(entry.intentId) + '.json'), { resume });
    if (checkoutPath) await retain(checkoutPath, parseJson(checkoutRaw));
    if (!lease.created && !priorCheckpoint)
      await retainInitializationRecord(join(directory, 'initializing.json'), checkpoint, { resume });
    await retainInitializationRecord(join(directory, 'session.json'), session, { resume, ignore: ['createdAt'] });
    const handle = await open(directory, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
    return await inspectCommerce(directory);
  } catch (error) {
    // Only this invocation's exclusively created, unpublished session is removed.
    if (lease.created && !resume) await rm(directory, { recursive: true, force: true });
    throw error;
  } finally { await lease.close(); }
}

async function readSession(directory) {
  await privateDirectory(directory);
  const saved = parseJson(await readPrivateFile(join(directory, 'session.json')));
  need(saved.schema === SESSION && saved.directory === directory && saved.queueRoot === join(directory, 'inbox') &&
    saved.seller?.config === join(directory, 'seller.json') && Array.isArray(saved.buyers), 'COMMERCE_SESSION_INVALID');
  const sellerBytes = await readPrivateFile(saved.seller.config, 1048576);
  need(sha(sellerBytes) === saved.seller.configSha256,
    'COMMERCE_MERCHANT_CONFIG_CHANGED');
  if (saved.seller.availabilityDirectory !== undefined && saved.seller.availabilityDirectory !== null)
    validateAvailabilityDirectory(saved.seller.availabilityDirectory);
  need([saved.seller.python, saved.seller.checkoutConfig, saved.seller.jsonrpc].filter(Boolean).length <= 1 &&
    (!(saved.seller.python || saved.seller.checkoutConfig || saved.seller.jsonrpc) || !saved.seller.handlers),
    'COMMERCE_ONE_MERCHANT_APPLICATION_REQUIRED');
  need(!saved.seller.upstreams || !saved.seller.python && !saved.seller.checkoutConfig && !saved.seller.jsonrpc && !saved.seller.handlers &&
    saved.seller.upstreams === join(directory, 'upstreams.json') &&
    /^[a-f0-9]{64}$/.test(saved.seller.upstreamsSha256 ?? ''),
  'COMMERCE_UPSTREAM_SNAPSHOT_INVALID');
  need(saved.seller.allowLoopbackUpstream === undefined || typeof saved.seller.allowLoopbackUpstream === 'boolean',
    'COMMERCE_UPSTREAM_LOOPBACK_INVALID');
  const upstream = saved.seller.upstreams ? await readUpstreamCommerce(saved.seller.upstreams, parseJson(sellerBytes),
    {allowLoopback:saved.seller.allowLoopbackUpstream === true, expectedSha256:saved.seller.upstreamsSha256}) : null;
  need(!saved.seller.jsonrpc || saved.seller.jsonrpc === join(directory, 'jsonrpc.json') &&
    /^[a-f0-9]{64}$/.test(saved.seller.jsonrpcSha256 ?? ''), 'COMMERCE_JSONRPC_SNAPSHOT_INVALID');
  const jsonrpc = saved.seller.jsonrpc ? await readJsonrpcCommerce(saved.seller.jsonrpc,
    { expectedConfig: parseJson(sellerBytes), expectedSha256: saved.seller.jsonrpcSha256,
      allowLoopback: saved.seller.allowLoopbackUpstream === true }) : null;
  need(saved.operationControls === undefined || typeof saved.operationControls === 'boolean',
    'COMMERCE_OPERATION_CONTROLS_INVALID');
  need(!saved.operationControls || upstream &&
    Object.values(upstream.review.bindings).some(binding => binding.idempotency),
  'COMMERCE_OPERATION_CONTROLS_REQUIRE_IDEMPOTENT_UPSTREAM');
  const python = saved.seller.python ? await readPythonCommerce(saved.seller, directory, parseJson(sellerBytes)) : null;
  if (saved.seller.handlers) need((await sourceFile(saved.seller.handlers)).sha256 === saved.seller.handlersSha256,
    'COMMERCE_HANDLER_CHANGED');
  if (saved.seller.checkoutConfig) need(saved.seller.checkoutConfig === join(directory, 'checkout.json') &&
    sha(await readPrivateFile(saved.seller.checkoutConfig)) === saved.seller.checkoutConfigSha256,
    'COMMERCE_CHECKOUT_CONFIG_CHANGED');
  if (saved.seller.facilitatorConfig) need(saved.seller.facilitatorConfig === join(directory, 'facilitator.json') &&
    sha(await readPrivateFile(saved.seller.facilitatorConfig)) === saved.seller.facilitatorConfigSha256,
    'COMMERCE_FACILITATOR_CONFIG_CHANGED');
  const queue = await openQueue(saved.queueRoot);
  const jobs = await queue.list();
  need(saved.buyers.length === jobs.length && saved.buyers.every(entry =>
    jobs.some(job => job.operation?.intentId === entry.intentId)), 'COMMERCE_INBOX_MEMBERSHIP_CHANGED');
  for (const entry of saved.buyers) if (entry.paidFile) {
    need(entry.paidFile.handoff === join(directory, 'handoff-' + sha(entry.intentId) + '.json'),
      'COMMERCE_HANDOFF_PATH_CHANGED');
    await inspectCommercePurchase(entry, jobs.find(job => job.operation.intentId === entry.intentId));
  }
  return { saved, queue, jobs, python, upstream, jsonrpc };
}
export async function inspectCommerce(directory) {
  const { saved, jobs, python, upstream, jsonrpc } = await readSession(directory);
  return { schema: SESSION, state: 'SAVED_SESSION', directory,
    sellerConfig: saved.seller.config, sellerPort: saved.seller.port,
    availabilityDirectory: saved.seller.availabilityDirectory ?? null,
    python: python ? describePythonCommerce(python) : null,
    upstreams: describeUpstreamCommerce(upstream), operationControls: saved.operationControls === true,
    jsonrpc: describeJsonrpcCommerce(jsonrpc),
    facilitator: saved.seller.facilitator ?? { config: saved.seller.facilitatorConfig },
    buyers: await Promise.all(jobs.map(async job => ({ ...job,
      paidFile: await inspectCommercePurchase(saved.buyers.find(entry => entry.intentId === job.operation.intentId), job) }))) };
}

/** Review the retained native RPC without opening signers or merchant listeners. */
export async function probeCommerceReadiness(directory) {
  const { saved } = await readSession(directory);
  need(saved.seller.facilitatorConfig, 'COMMERCE_NATIVE_FACILITATOR_NOT_CONFIGURED');
  const [{ readConfig }, { createRpcReadiness }] = await Promise.all([
    import('../native-facilitator/config.mjs'), import('../native-facilitator/readiness.mjs'),
  ]);
  const readiness = createRpcReadiness(await readConfig(saved.seller.facilitatorConfig));
  try { return await readiness.probe(); }
  finally { await readiness.close(); }
}

/** Keep the owning process alive through accepted native work after a grace timeout. */
export async function completeCommerceShutdown(session, closing, { onWaiting } = {}) {
  const keepAlive = setInterval(() => {}, 1000);
  try {
    let result;
    try { result = await closing; }
    catch (error) {
      // Original seller/observer cleanup can reject after a native drain times out.
      // Retain this process through the owned native completion, then report that error.
      try { await session.waitForIdle?.({ sharedOnly: true }); } catch {}
      throw error;
    }
    const native = result?.shutdown?.facilitator;
    if (result?.drained !== false || result?.nativeCompletion?.drained === true ||
        native?.ownership?.mode !== 'HOST_SIGNER_LEASES' ||
        (native.activeVerify ?? 0) + (native.activeSettle ?? 0) === 0) return result;
    need(typeof session.waitForIdle === 'function', 'COMMERCE_NATIVE_DRAIN_INTERFACE_REQUIRED');
    // An optional presentation callback cannot shorten accepted native work.
    try { await onWaiting?.(native); } catch {}
    const nativeCompletion = await session.waitForIdle();
    return { ...result, nativeCompletion };
  } finally { clearInterval(keepAlive); }
}

/** Bind the actual compiled native merchant route to the frozen original request. */
export function bindMerchantPurchase(compiled, job) {
  const op = job.operation, url = new URL(op.url);
  const selected = selectServiceRoute(compiled.routes, url.pathname, op.method);
  const route = selected?.route;
  need(route && new URL(route.offer.resource.url).origin === url.origin, 'COMMERCE_BUYER_ROUTE_MISMATCH');
  const matches = route.offer.accepts.map((terms, index) => ({ terms, index })).filter(({ terms }) =>
    ['scheme', 'network', 'asset', 'payTo'].every(key => terms[key] === op.expect[key]) &&
    BigInt(terms.amount) <= BigInt(op.expect.maxAtomic) &&
    (op.expect.maxTimeoutSeconds === undefined || terms.maxTimeoutSeconds <= op.expect.maxTimeoutSeconds) &&
    (terms.extra?.paymentFlow ?? 'authorization') === (op.expect.paymentFlow ?? 'authorization'));
  need(matches.length === 1, 'COMMERCE_BUYER_TERMS_MISMATCH');
  return { routeId: route.id, intentId: op.intentId, method: op.method, url: op.url,
    acceptIndex: matches[0].index, originalTerms: structuredClone(matches[0].terms),
    maxAtomic: op.expect.maxAtomic };
}

async function originalCommand(script, args, { environment = process.env, signal } = {}) {
  need(!signal?.aborted, 'COMMERCE_INTERRUPTED');
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [script, ...args], {
      shell: false, env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    const output = [], errors = [];
    let size = 0, errorSize = 0, overflow = false;
    const abort = () => child.kill('SIGTERM');
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on('data', bytes => {
      size += bytes.length;
      if (size > 2 * 1024 * 1024) { overflow = true; abort(); }
      else output.push(bytes);
    });
    child.stderr.on('data', bytes => { errorSize += bytes.length; if (errorSize <= 8192) errors.push(bytes); });
    child.once('error', error => { signal?.removeEventListener('abort', abort); fail(error); });
    child.once('close', (exitCode, childSignal) => {
      signal?.removeEventListener('abort', abort);
      if (overflow) return fail(Object.assign(new Error('COMMERCE_ORIGINAL_OUTPUT_LIMIT'), { code: 'COMMERCE_ORIGINAL_OUTPUT_LIMIT' }));
      let value;
      try { value = JSON.parse(Buffer.concat(output).toString('utf8')); } catch {}
      if (value !== undefined) return done({ exitCode, signal: childSignal, original: value });
      let error;
      try { error = JSON.parse(Buffer.concat(errors).toString('utf8')); } catch {}
      const code = /^[A-Z0-9_]{1,120}$/.test(error?.error ?? '') ? error.error : 'COMMERCE_ORIGINAL_COMMAND_FAILED';
      fail(Object.assign(new Error(code), { code, exitCode, signal: childSignal }));
    });
  });
}

async function signerEnvironment(saved, job, environment) {
  const entry = saved.buyers.find(item => item.intentId === job.operation.intentId);
  const env = { ...environment };
  if (entry.signerConfig) {
    need(sha(await readPrivateFile(entry.signerConfig)) === entry.signerConfigSha256, 'COMMERCE_SIGNER_CONFIG_CHANGED');
    const { expected } = await inspectOperatorConfig(entry.signerConfig);
    need(['intentId', 'url', 'method'].every(key => expected.operation[key] === job.operation[key]) &&
      same(expected.operation.expect, job.operation.expect) && same(expected.operation.headers, job.operation.headers) &&
      expected.body.present === (job.bodySha256 !== null) && expected.body.bytes === job.bodyBytes &&
      expected.body.sha256 === (job.bodySha256 ?? sha(Buffer.alloc(0))), 'COMMERCE_SIGNER_REQUEST_MISMATCH');
    env.SF103_SIGNER_CONFIG = entry.signerConfig;
  }
  return { env, workspace: entry.workspace };
}

/** Trusted embedding may supply an already configured original nativeFactory. */
export async function openCommerce(directory, { nativeFactory, environment = process.env, purchaseFetch,
  finalityNode = process.execPath } = {}) {
  const { saved, queue, jobs, python: pythonApplication } = await readSession(directory);
  absolute(finalityNode);
  await access(finalityNode, constants.X_OK);
  need(nativeFactory === undefined || typeof nativeFactory === 'function', 'COMMERCE_NATIVE_FACTORY_INVALID');
  need(purchaseFetch === undefined || typeof purchaseFetch === 'function', 'COMMERCE_PURCHASE_TRANSPORT_INVALID');
  need(!nativeFactory || !saved.seller.facilitator && !saved.seller.facilitatorConfig, 'COMMERCE_ONE_FACILITATOR_REQUIRED');
  let config = await readSellerConfig(saved.seller.config);
  let handlers = saved.seller.handlers ? await import(pathToFileURL(saved.seller.handlers).href) : {};
  if (saved.seller.facilitator) {
    const endpoint = facilitator(saved.seller.facilitator);
    const { HTTPFacilitatorClient } = await import('@x402/core/server');
    const client = new HTTPFacilitatorClient({ url: endpoint.url });
    nativeFactory = compiled => createNativeSellerServer(compiled, { facilitatorClient: client });
  }
  let seller, operations, checkoutSession, ownedFacilitator, python, upstream, jsonrpc, jsonrpcRecovery, closing, active;
  let state = 'STARTING', activeIntent = null, activeBuyerController = null;
  const controller = new AbortController();
  const streams = createCommerceStreamAccess(queue.root);
  const pending = new Set(), activeRetrievals = new Map(), activeRpcActions = new Map();
  const waitForIdle = async ({ sharedOnly = false } = {}) => {
    need(state === 'STOPPING' || state === 'STOPPED', 'COMMERCE_DRAIN_REQUIRED');
    const native = ownedFacilitator ?? seller?.facilitator;
    if (!native || sharedOnly && native.status().ownership?.mode !== 'HOST_SIGNER_LEASES') return null;
    need(typeof native.waitForIdle === 'function', 'COMMERCE_NATIVE_DRAIN_INTERFACE_REQUIRED');
    // A failed original close can reach this path before native draining begins.
    if (native.status().state === 'ACCEPTING') {
      try { await native.drain(); } catch {}
    }
    return native.waitForIdle();
  };
  const runOriginal = (script, args, options) => {
    const promise = originalCommand(script, args, options);
    pending.add(promise);
    promise.then(() => pending.delete(promise), () => pending.delete(promise));
    return promise;
  };
  const close = () => closing ??= (async () => {
    state = 'STOPPING'; controller.abort();
    if (active) await active.catch(() => {});
    await Promise.allSettled([...pending]);
    // Keep the original observer attached until merchant draining has finished.
    const failures = [];
    let shutdown;
    try { shutdown = await seller?.close(); } catch (error) { failures.push(error); }
    if (ownedFacilitator) try {
      const native = await ownedFacilitator.drain();
      shutdown = { ...shutdown, facilitator: native, drained: shutdown?.drained !== false && native.drained };
    } catch (error) { failures.push(error); }
    let pythonShutdown = null;
    try { pythonShutdown = await (python ?? checkoutSession?.source)?.close() ?? null; }
    catch (error) { failures.push(error); }
    let upstreamShutdown = null;
    try { upstreamShutdown = await upstream?.close() ?? null; }
    catch (error) { failures.push(error); }
    const traffic = operations?.observer.snapshot() ?? null;
    try { await (checkoutSession ? checkoutSession.close() : operations?.close()); } catch (error) { failures.push(error); }
    let jsonrpcShutdown = null;
    if (jsonrpc) try {
      await jsonrpc.close();
      jsonrpcShutdown = { closed: true, rpc: jsonrpc.snapshot().rpc };
    } catch (error) { failures.push(error); }
    state = 'STOPPED';
    need(failures.length === 0, 'COMMERCE_SHUTDOWN_INCOMPLETE');
    return { state, shutdown, python: pythonShutdown, upstreams: upstreamShutdown, jsonrpc: jsonrpcShutdown,
      drained: shutdown?.drained !== false && shutdown?.forcedClose !== true && pythonShutdown?.clean !== false &&
        (upstreamShutdown ?? []).every(result => result.drained !== false),
      traffic, buyers: await queue.list() };
  })();
  try {
    if (saved.seller.jsonrpc) {
      jsonrpc = await openJsonrpcCommerce(saved.seller.jsonrpc, {
        expectedConfig: config, expectedSha256: saved.seller.jsonrpcSha256,
        allowLoopback: saved.seller.allowLoopbackUpstream === true, environment,
      });
      config = jsonrpc.config; handlers = jsonrpc.handlers;
    }
    if (saved.seller.upstreams) {
      ({application:upstream} = await openUpstreamCommerce(saved.seller.upstreams, config, {
        allowLoopback:saved.seller.allowLoopbackUpstream === true,
        expectedSha256:saved.seller.upstreamsSha256, environment,
      }));
      config = upstream.config; handlers = upstream.handlers;
    }
    if (pythonApplication) {
      python = await openPythonCommerce(pythonApplication, {
        native: Boolean(nativeFactory || saved.seller.facilitatorConfig), environment,
      });
      handlers = python.handlers;
    }
    if (saved.seller.checkoutConfig) {
      const checkout = await readCheckout(saved.seller.checkoutConfig);
      need(same(JSON.parse(JSON.stringify(checkout.service)), config), 'COMMERCE_CHECKOUT_OFFER_CHANGED');
      if (saved.seller.facilitatorConfig) {
        const [{ readConfig }, { createNativeFacilitator }] = await Promise.all([
          import('../native-facilitator/config.mjs'), import('../native-facilitator/runtime.mjs'),
        ]);
        const policy = await readConfig(saved.seller.facilitatorConfig), terms = checkout.terms;
        need(terms.scheme === 'exact' && terms.network === policy.network &&
          policy.payments.assets.includes(terms.asset) && policy.payments.recipients.includes(terms.payTo) &&
          BigInt(terms.amount) <= BigInt(policy.payments.maxAtomic), 'SELLER_TERMS_OUTSIDE_FACILITATOR_POLICY');
        ownedFacilitator = await createNativeFacilitator(policy, { environment });
        nativeFactory = compiled => createNativeSellerServer(compiled, { facilitatorClient: ownedFacilitator });
      }
      checkoutSession = await startCheckout(checkout, { port: saved.seller.port,
        operationsPort: saved.operationsPort, nativeFactory: nativeFactory ?? null, env: environment,
        availabilityDirectory: saved.seller.availabilityDirectory ?? undefined,
        historyDirectory: join(directory, 'usage'), historyRetentionDays: 90,
        ...(ownedFacilitator ? { maxInFlight: 1, drainGraceMs: ownedFacilitator.drainGraceMs } : {}) });
      seller = checkoutSession.seller; operations = checkoutSession.operations;
    } else if (saved.seller.facilitatorConfig) {
      const [{ readConfig }, { startSelfFacilitatedSeller }] = await Promise.all([
        import('../native-facilitator/config.mjs'), import('../native-facilitator/runtime.mjs'),
      ]);
      seller = await startSelfFacilitatedSeller({
        facilitatorConfig: await readConfig(saved.seller.facilitatorConfig),
        config, port: saved.seller.port, handlers, environment,
        availabilityDirectory: saved.seller.availabilityDirectory ?? undefined,
      });
    } else {
      seller = await startSellerService({ config, port: saved.seller.port, handlers, nativeFactory: nativeFactory ?? null,
        availabilityDirectory: saved.seller.availabilityDirectory ?? undefined });
    }
    if (upstream) {
      seller.upstreamSnapshot = upstream.snapshot;
      seller.operationControl = upstream.operationControl;
      seller.invalidateUpstreamCache = upstream.invalidateCache;
    }
    if (jsonrpc) seller.upstreamSnapshot = jsonrpc.snapshot;
    for (const job of jobs) {
      const merchant = bindMerchantPurchase(seller.compiled, job);
      await inspectCommercePurchase(saved.buyers.find(entry => entry.intentId === job.operation.intentId), { ...job, merchant });
    }
    operations ??= await startSellerOperations(seller, { port: saved.operationsPort,
      historyDirectory: join(directory, 'usage'), historyRetentionDays: 90,
      operationControls: saved.operationControls === true });
    if (jsonrpc) jsonrpcRecovery = createJsonrpcCommerceRecovery({ saved, queue, application: jsonrpc,
      availability: seller.availability, environment, node: finalityNode, signal: controller.signal });
    state = 'RUNNING';
    const status = async () => ({ schema: SESSION, state, directory,
      seller: { url: seller.url, publicOrigin: config.publicOrigin, mode: seller.mode,
        health: seller.url + '/_seller/health', docs: seller.url + '/_seller/docs', lifecycle: seller.lifecycle.snapshot(),
        ...(upstream ? { upstreams: upstream.snapshot() } : {}),
        ...(jsonrpc ? { jsonrpc: jsonrpc.snapshot().rpc } : {}),
        ...(python ? { python: python.status() } : {}) },
      facilitator: (ownedFacilitator ?? seller.facilitator)?.status() ?? { mode: saved.seller.facilitator ? 'EXISTING_HTTP_FACILITATOR' :
        nativeFactory ? 'TRUSTED_NATIVE_EMBEDDING' : 'NOT_CONFIGURED' },
      operations: { url: operations.url, traffic: operations.observer.snapshot(),
        availabilityUrl: saved.seller.availabilityDirectory ? operations.availabilityUrl : null,
        merchantOperationsUrl: upstream ? operations.merchantOperationsUrl : null,
        operationControls: saved.operationControls === true,
        historyUrl: operations.history ? operations.url + '/history.json' : null, usageHistory: operations.history?.status() ?? null },
      buyers: await Promise.all((await queue.list()).map(async job => {
        const bound = { ...job, merchant: bindMerchantPurchase(seller.compiled, job) };
        return { ...bound, stream: await streams.inspect(bound, { active: activeIntent === job.operation.intentId }),
          paidFile: await inspectCommercePurchase(
          saved.buyers.find(entry => entry.intentId === job.operation.intentId), bound),
          ...(jsonrpcRecovery ? { rpcRecovery: await jsonrpcRecovery.inspect(bound) } : {}) };
      })),
    });
    const retainedJobFor = async intentId => {
      const job = await queue.show(intentId);
      need(saved.buyers.some(entry => entry.intentId === intentId), 'COMMERCE_INTENT_NOT_IN_SESSION');
      return { ...job, merchant: bindMerchantPurchase(seller.compiled, job) };
    };
    const jobFor = async intentId => {
      need(state === 'RUNNING', 'COMMERCE_SESSION_NOT_RUNNING');
      return retainedJobFor(intentId);
    };
    const fileAction = (intentId, operation) => {
      need(!activeRetrievals.has(intentId), 'COMMERCE_FILE_RETRIEVAL_BUSY');
      const work = (async () => {
        const job = await jobFor(intentId), entry = saved.buyers.find(item => item.intentId === intentId);
        need(!controller.signal.aborted, 'COMMERCE_INTERRUPTED');
        return operation(entry, job);
      })();
      pending.add(work); activeRetrievals.set(intentId, work);
      return work.finally(() => { pending.delete(work); activeRetrievals.delete(intentId); });
    };
    const rpcAction = (intentId, method, selection) => {
      need(jsonrpcRecovery && !activeRpcActions.has(intentId), 'COMMERCE_RPC_RECOVERY_BUSY');
      const work = (async () => {
        const job = await jobFor(intentId);
        need(!controller.signal.aborted, 'COMMERCE_INTERRUPTED');
        return jsonrpcRecovery[method](job, selection);
      })();
      pending.add(work); activeRpcActions.set(intentId, work);
      return work.finally(() => { pending.delete(work); activeRpcActions.delete(intentId); });
    };
    return Object.freeze({ seller, operations, status, close, waitForIdle,
      async streamRecords(intentId, options) { return streams.records(await retainedJobFor(intentId), options); },
      async streamAnswer(intentId, options) { return streams.answer(await retainedJobFor(intentId), options); },
      async streamFile(intentId, options) { return streams.file(await retainedJobFor(intentId), options); },
      verifyRpcPayment: (intentId, selection) => rpcAction(intentId, 'verify', selection),
      recoverRpcResponse: (intentId, selection) => rpcAction(intentId, 'recover', selection),
      async probeReadiness() {
        need(state === 'RUNNING', 'COMMERCE_SESSION_NOT_RUNNING');
        const native = ownedFacilitator ?? seller.facilitator;
        need(typeof native?.probeReadiness === 'function', 'COMMERCE_NATIVE_FACILITATOR_NOT_CONFIGURED');
        return native.probeReadiness({ force: true });
      },
      async review(intentId) {
        const job = await jobFor(intentId);
        return runOriginal(buyerCli, ['--review', '--config', join(queue.root, 'jobs', job.id, 'execution.json')],
          { signal: controller.signal });
      },
      async checkSigner(intentId) {
        const job = await jobFor(intentId);
        const entry = saved.buyers.find(item => item.intentId === intentId);
        need(entry.signerConfig, 'COMMERCE_USE_EXISTING_SIGNER_DIAGNOSTIC');
        const { env } = await signerEnvironment(saved, job, environment);
        return runOriginal(signerCli, ['check-signer', '--config', entry.signerConfig],
          { environment: env, signal: controller.signal });
      },
      async execute(intentId) {
        need(!active, 'COMMERCE_BUYER_BUSY');
        activeIntent = intentId;
        activeBuyerController = new AbortController();
        const signal = AbortSignal.any([controller.signal, activeBuyerController.signal]);
        active = (async () => {
          need(seller.mode === 'NATIVE_X402', 'COMMERCE_NATIVE_FACILITATOR_REQUIRED');
          const job = await jobFor(intentId);
          need(job.state === 'QUEUED', 'COMMERCE_USE_RETAINED_INBOX_RESULT');
          const { env, workspace } = await signerEnvironment(saved, job, environment);
          const args = ['execute', '--root', queue.root, '--intent', intentId];
          if (workspace) args.push('--workspace', workspace);
          return runOriginal(queueCli, args, { environment: env, signal });
        })();
        try {
          const original = await active;
          return { ...original, merchantTraffic: operations.observer.snapshot() };
        } finally { active = null; activeIntent = null; activeBuyerController = null; }
      },
      async interrupt(intentId) {
        need(state === 'RUNNING' && active && activeIntent === intentId, 'COMMERCE_BUYER_NOT_ACTIVE');
        const running = active;
        activeBuyerController.abort();
        await running.catch(() => {});
        return retainedJobFor(intentId);
      },
      async cancel(intentId) { await jobFor(intentId); return queue.cancel(intentId); },
      async recover(intentId) { await jobFor(intentId); return queue.recover(intentId); },
      retrieve(intentId) {
        return fileAction(intentId, (entry, job) => retrieveCommercePurchase(entry, job,
          { environment, signal: controller.signal, fetchImpl: purchaseFetch }));
      },
      resetTransfer(intentId) { return fileAction(intentId, resetCommercePurchase); },
    });
  } catch (error) {
    await completeCommerceShutdown({ waitForIdle }, close()).catch(() => {});
    throw error;
  }
}

export { codeOf as commerceErrorCode };

