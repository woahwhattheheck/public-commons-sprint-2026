// MIT. Compose the original transport, durable operation, payment and operator engines.
import { join, resolve } from 'node:path';
import { realpath } from 'node:fs/promises';
import { createUpstreamApplication, compileUpstreamBindings } from '../../sf30-seller-sdk/upstream.mjs';
import { createUpstreamOperationControl } from '../../sf30-seller-sdk/upstream-operation-control.mjs';
import { canonicalOperationJSON } from '../../sf30-seller-sdk/upstream-idempotency.mjs';
import { startSellerService } from '../../sf30-seller-sdk/serve.mjs';
import { startSellerOperations } from '../../sf30-seller-sdk/operations/server.mjs';
import { privateDirectory, newDirectory, readBytes, writeNew, syncDirectory, json, parse } from '../../sf102-cube-paid-query-adapter/onboarding/files.mjs';
import { inspectPlan, sellerConfig, upstreamBindings, providerRequest, describeResult, HANDLER, ADMISSION } from './product.mjs';

import { createTenderlyProviderRecovery } from './provider-recovery.mjs';

const REQUEST_SCHEMA = 'stellar-forge.tenderly-operation-request.v1';
const fail = (code, status = 409) => Object.assign(new Error(code), { code, status });
const reject = (status, error) => ({ status, headers: { 'content-type': 'application/json; charset=utf-8' }, body: { error } });
const operationKey = key => { if (!/^[a-f0-9]{64}$/.test(key ?? '')) throw new TypeError('Exact operationKey required'); return key; };

export function createTenderlyApplication({ plan: rawPlan, stateDirectory, env = process.env,
  allowLoopbackUpstream = false, upstreamOrigin, lookup } = {}) {
  const review = inspectPlan(rawPlan), plan = review.plan;
  const bindings = upstreamBindings(plan, { stateDirectory, allowLoopbackUpstream, upstreamOrigin });
  const options = { allowLoopback: allowLoopbackUpstream, env: { ...env }, ...(lookup ? { lookup } : {}) };
  const original = createUpstreamApplication(sellerConfig(plan), bindings, options);
  const backend = original.handlers[HANDLER], durable = backend.idempotency;
  const originalAdmission = original.handlers[original.config.routes[0].admit];
  const requestsDirectory = join(stateDirectory, 'requests');
  let preparing, closing, closed = false;
  const pending = new Set();
  function active() { if (closed) throw fail('TENDERLY_APPLICATION_CLOSED', 503); }
  function tracked(fn) {
    active(); const result = Promise.resolve().then(fn); pending.add(result);
    result.finally(() => pending.delete(result)).catch(() => {}); return result;
  }
  async function requestDirectory() {
    return preparing ??= (async () => {
      await privateDirectory(stateDirectory);
      if (await realpath(stateDirectory) !== stateDirectory) throw new TypeError('Use canonical private operation state');
      try { await newDirectory(requestsDirectory); await syncDirectory(stateDirectory); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      await privateDirectory(requestsDirectory);
      return requestsDirectory;
    })().catch(error => { preparing = undefined; throw error; });
  }
  function contextFor(context) {
    if (context?.method !== 'POST' || !(context.url instanceof URL) || context.url.href !== review.route.url ||
        context.bodyPresent === false || context.bodyType !== undefined && context.bodyType !== 'json') throw new TypeError('Use the reviewed fixed simulation route and JSON request');
    const body = providerRequest(plan, context.body);
    return { ...context, body, rawBody: Buffer.from(canonicalOperationJSON(body)), bodyType: 'json', bodyPresent: true };
  }
  async function readRequest(key) {
    key = operationKey(key); await requestDirectory();
    let bytes;
    try { bytes = await readBytes(join(requestsDirectory, key + '.json'), { privateFile: true, max: 1048576 }); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    const saved = parse(bytes, 'retained simulation request');
    if (saved.schema !== REQUEST_SCHEMA || saved.operationKey !== key || !/^[a-f0-9]{64}$/.test(saved.requestHash ?? '') ||
        saved.networkId !== plan.networkId || saved.providerPath !== review.provider.path || saved.simulationType !== plan.simulationType) throw fail('TENDERLY_REQUEST_RECORD_MISMATCH');
    providerRequest(plan, saved.body); return saved;
  }
  async function retainRequest(issued, body) {
    await requestDirectory();
    const record = { schema: REQUEST_SCHEMA, operationKey: issued.operationKey, requestHash: issued.requestHash,
      networkId: plan.networkId, providerPath: review.provider.path, simulationType: plan.simulationType,
      body: structuredClone(body), createdAt: new Date().toISOString() };
    try { await writeNew(join(requestsDirectory, issued.operationKey + '.json'), json(record)); await syncDirectory(requestsDirectory); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const saved = await readRequest(issued.operationKey);
      if (saved.requestHash !== issued.requestHash || canonicalOperationJSON(saved.body) !== canonicalOperationJSON(body)) throw fail('OPERATION_REQUEST_CONFLICT');
    }
    return { schema: 'stellar-forge.upstream-operation-ticket.v1', ...issued };
  }
  async function storedResponse(key) {
    const response = await durable.response(key);
    if (response === null) return null;
    const request = await readRequest(key);
    if (!request) throw fail('TENDERLY_REQUEST_RECORD_NOT_FOUND', 404);
    const row = await durable.inspect(key);
    if (row.requestHash !== request.requestHash) throw fail('TENDERLY_REQUEST_RECORD_MISMATCH');
    describeResult(response, { plan, body: request.body });
    return response;
  }
  async function recover(options) {
    const request = await readRequest(options?.operationKey);
    if (!request || request.requestHash !== options.requestHash) throw fail('TENDERLY_REQUEST_RECORD_MISMATCH');
    if (options.action === 'complete') {
      const summary = describeResult(options.response, { plan, body: request.body });
      if (options.response?.status >= 200 && options.response.status < 300 && !summary) throw fail('TENDERLY_RESULT_INVALID', 422);
    }
    return durable.recover(options);
  }
  const operations = Object.freeze({
    issue: ({ body, id, subject, expiresAt }) => tracked(async () => {
      const context = contextFor({ method: 'POST', url: new URL(review.route.url), headers: {}, body });
      const issued = durable.issue(context, { id, subject, expiresAt });
      return retainRequest(issued, body);
    }),
    inspect: key => tracked(() => durable.inspect(key)),
    list: options => tracked(() => durable.list(options)),
    audit: (key, options) => tracked(() => durable.audit(key, options)),
    request: key => tracked(() => readRequest(key)),
    response: key => tracked(() => storedResponse(key)),
    recover: options => tracked(() => recover(options)),
  });
  const retainedProvider = createTenderlyProviderRecovery({ plan, stateDirectory, env, upstreamOrigin,
    allowLoopbackUpstream, operations: {
      request: readRequest, inspect: key => durable.inspect(key), response: storedResponse, recover,
    } });
  const providerRecovery = Object.freeze(Object.fromEntries(Object.entries(retainedProvider)
    .map(([name, method]) => [name, input => tracked(() => method(input))])));
  const handlers = {
    [HANDLER]: context => tracked(async () => {
      let provider;
      try { provider = contextFor(context); } catch { return reject(422, 'TENDERLY_REQUEST_INVALID'); }
      const response = await backend(provider);
      try { describeResult(response, { plan, body: context.body }); }
      catch (error) { return reject(502, error.code ?? 'TENDERLY_RESULT_INVALID'); }
      return response;
    }),
    [ADMISSION]: context => tracked(() => {
      let provider;
      try { provider = contextFor(context); } catch { return reject(422, 'TENDERLY_REQUEST_INVALID'); }
      return originalAdmission(provider);
    }),
  };
  // The original operation desk keeps its controller and result-generation CAS.
  // Its issuer is adapted to the same server-composed request as the public route.
  const adapted = { idempotency: { ...durable,
    issue: (context, terms) => operations.issue({ body: context.body, ...terms }),
    inspect: operations.inspect, list: operations.list, audit: operations.audit, recover: operations.recover } };
  let operationControl;
  const close = () => closing ??= (async () => {
    closed = true; await Promise.allSettled([...pending]); await original.close();
  })();
  operationControl = createUpstreamOperationControl(compileUpstreamBindings(bindings, options), { [HANDLER]: adapted }, { closeHandlers: close });
  const config = structuredClone(original.config); config.routes[0].admit = ADMISSION;
  return { config, handlers: Object.freeze(handlers), operations, providerRecovery, operationControl, review, close,
    snapshot: () => ({ schema: 'stellar-forge.tenderly-merchant-status.v1', planSha256: review.planSha256,
      networkId: plan.networkId, simulationType: plan.simulationType, route: review.route,
      provider: 'Tenderly Simulation API', upstreams: original.snapshot(), closed }) };
}

export async function startTenderlyMerchant({ plan, stateDirectory, env = process.env, port = 8423,
  operationsPort = 8424, facilitator, nativeFactory, allowLocalFacilitator = false,
  allowLoopbackUpstream = false, upstreamOrigin, historyDirectory, availabilityDirectory,
  deliveryStateDirectory, maxInFlight = 64, drainGraceMs = 60000, navigationOrigin = null, lookup } = {}) {
  if (facilitator && nativeFactory) throw new TypeError('Select facilitator or supplied nativeFactory');
  if (deliveryStateDirectory && !facilitator && !nativeFactory) throw new TypeError('Delivery state requires native payment');
  if (port !== 0 && port === operationsPort) throw new TypeError('Seller and operations ports must differ');
  const application = createTenderlyApplication({ plan, stateDirectory, env, allowLoopbackUpstream, upstreamOrigin, lookup });
  let seller, operations, outbox, factory = nativeFactory ?? null;
  try {
    if (facilitator) {
      const url = new URL(facilitator);
      const local = allowLocalFacilitator && url.protocol === 'http:' && url.hostname === '127.0.0.1';
      if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) throw new TypeError('Use the explicit HTTPS facilitator or selected local facilitator');
      const [{ HTTPFacilitatorClient }, { createNativeSellerServer }] = await Promise.all([
        import('@x402/core/server'), import('../../sf30-seller-sdk/native-factory.mjs') ]);
      factory = routes => createNativeSellerServer(routes, { facilitatorClient: new HTTPFacilitatorClient({ url: url.href.replace(/\/$/, '') }) });
    }
    if (deliveryStateDirectory) {
      const { openOutbox, instrumentNativeSettlement } = await import('../../sf98-merchant-delivery/outbox.mjs');
      outbox = await openOutbox(resolve(deliveryStateDirectory));
      const originalFactory = factory;
      factory = async compiled => instrumentNativeSettlement(await originalFactory(compiled), { compiled, outbox,
        onWriteFailure: () => process.stderr.write('TENDERLY_NATIVE_DELIVERY_JOURNAL_WARNING\n') });
    }
    seller = await startSellerService({ config: application.config, handlers: application.handlers, port,
      nativeFactory: factory, maxInFlight, drainGraceMs, availabilityDirectory });
    seller.upstreamSnapshot = () => application.snapshot().upstreams;
    seller.operationControl = application.operationControl;
    if (operationsPort !== null) operations = await startSellerOperations(seller, { port: operationsPort,
      historyDirectory, operationControls: true, deliveryOutbox: outbox, navigationOrigin });
  } catch (error) {
    await seller?.close().catch(() => {}); await operations?.close().catch(() => {});
    await application.close().catch(() => {}); throw error;
  }
  let closing, cleanup;
  const finalize = () => cleanup ??= (async () => {
    await seller.lifecycle.whenIdle();
    try { await operations?.close(); }
    finally { await application.operationControl.close(); }
  })();
  const close = () => closing ??= (async () => {
    try { const result = await seller.close(); await finalize(); return result; }
    catch (error) { finalize().catch(() => {}); throw error; }
  })();
  return { seller, operations, application, outbox, url: seller.url, mode: seller.mode, close };
}
