// MIT. Read-only original RPC observations; no wallet, simulation or submission.
import { randomUUID } from 'node:crypto';
import { validateConfig, FacilitatorError } from './config.mjs';

// Stellar's native network passphrases, also published by getNetwork and the SDK.
const PASSPHRASES = Object.freeze({
  'stellar:testnet':'Test SDF Network ; September 2015',
  'stellar:pubnet':'Public Global Stellar Network ; September 2015',
});
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const positive = x => Number.isSafeInteger(x) && x > 0;
const BODY_LIMIT = 1024 * 1024;

async function responseJson(response, signal) {
  if (!response.ok) throw new FacilitatorError('RPC_HTTP_UNAVAILABLE',503);
  const size = response.headers.get('content-length');
  if (size !== null && (!/^\d+$/.test(size) || Number(size) > BODY_LIMIT)) {
    await response.body?.cancel();
    throw new FacilitatorError('RPC_RESPONSE_TOO_LARGE',503);
  }
  if (!response.body) throw new FacilitatorError('RPC_RESPONSE_INVALID',503);
  const reader = response.body.getReader();
  const chunks = []; let length = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const {done,value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > BODY_LIMIT) throw new FacilitatorError('RPC_RESPONSE_TOO_LARGE',503);
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof FacilitatorError) throw error;
    if (signal.aborted) throw new FacilitatorError('RPC_TIMEOUT',503);
    throw new FacilitatorError('RPC_RESPONSE_INVALID',503);
  } finally { reader.releaseLock(); }
}

/** Coalesces a probe, caches its observation, and expires readiness explicitly. */
export function createRpcReadiness(input, {fetchImpl = globalThis.fetch, now = Date.now} = {}) {
  const c = validateConfig(input);
  const base = {schema:'stellar-forge.facilitator-readiness.v1',network:c.network,
    rpcOrigin:new URL(c.rpcUrl).origin};
  let current = {...base,state:'NOT_PROBED',ready:false,checkedAt:null};
  let observedAt = null, inflight = null, controller = null, closed = false;

  function status() {
    const ageMs = observedAt === null ? null : now()-observedAt;
    const stale = ageMs !== null && (ageMs < 0 || ageMs > c.operations.readinessMaxAgeMs);
    return structuredClone({...current,ageMs,
      ...(closed ? {state:'DRAINING',ready:false} : stale ? {state:'STALE',ready:false} : {})});
  }
  async function rpc(method, signal) {
    const id = randomUUID();
    let response;
    try {
      response = await fetchImpl(c.rpcUrl,{method:'POST',redirect:'error',signal,
        headers:{'content-type':'application/json','accept':'application/json'},
        body:JSON.stringify({jsonrpc:'2.0',id,method})});
    } catch {
      throw new FacilitatorError(signal.aborted ? 'RPC_TIMEOUT' : 'RPC_TRANSPORT_UNAVAILABLE',503);
    }
    const value = await responseJson(response,signal);
    if (!object(value) || value.jsonrpc !== '2.0' || value.id !== id ||
      Object.hasOwn(value,'error') || !object(value.result))
      throw new FacilitatorError('RPC_RESPONSE_INVALID',503);
    return value.result;
  }
  async function observe(signal) {
    const methods = ['getNetwork','getHealth','getLatestLedger'];
    const results = await Promise.allSettled(methods.map(method => rpc(method,signal)));
    const checks = {};
    for (let i=0;i<methods.length;i++) checks[methods[i]] = results[i].status === 'fulfilled'
      ? 'OBSERVED' : results[i].reason instanceof FacilitatorError ? results[i].reason.code : 'RPC_UNAVAILABLE';
    const failures = results.filter(x => x.status === 'rejected');
    if (failures.length) return {state:'UNAVAILABLE',ready:false,checks};
    const [network,health,ledger] = results.map(x => x.value);
    if (network.passphrase !== PASSPHRASES[c.network])
      return {state:'NETWORK_MISMATCH',ready:false,checks:{...checks,getNetwork:'NETWORK_MISMATCH'}};
    if (health.status !== 'healthy')
      return {state:'UNHEALTHY',ready:false,checks:{...checks,getHealth:'RPC_UNHEALTHY'}};
    if (!positive(network.protocolVersion) || !positive(health.latestLedger) ||
      !positive(health.oldestLedger) || health.oldestLedger > health.latestLedger ||
      !positive(ledger.sequence) || ledger.sequence < health.oldestLedger ||
      !positive(ledger.protocolVersion) || !/^[a-f0-9]{64}$/.test(ledger.id ?? '') ||
      typeof ledger.closeTime !== 'string' || !/^[0-9]{1,13}$/.test(ledger.closeTime))
      return {state:'INVALID_RESPONSE',ready:false,checks:{...checks,getLatestLedger:'LEDGER_METADATA_INVALID'}};
    const closedAtMs = Number(ledger.closeTime)*1000;
    const ageSeconds = (now()-closedAtMs)/1000;
    const observedLedger = {sequence:ledger.sequence,id:ledger.id,protocolVersion:ledger.protocolVersion,
      closeTime:ledger.closeTime,ageSeconds};
    const observedHealth = {latestLedger:health.latestLedger,oldestLedger:health.oldestLedger};
    if (!Number.isSafeInteger(closedAtMs) || ageSeconds < -30 || ageSeconds > c.operations.maxLedgerAgeSeconds)
      return {state:'STALE_LEDGER',ready:false,checks,ledger:observedLedger,health:observedHealth};
    return {state:'READY',ready:true,checks,ledger:observedLedger,health:observedHealth};
  }
  function probe({force = false} = {}) {
    if (closed) return Promise.resolve(status());
    if (inflight) return inflight;
    if (!force && observedAt !== null && status().state !== 'STALE') return Promise.resolve(status());
    controller = new AbortController();
    const activeController = controller;
    const timeout = setTimeout(() => activeController.abort(),c.operations.rpcTimeoutMs);
    inflight = (async () => {
      try {
        const result = await observe(activeController.signal);
        observedAt = now();
        current = {...base,...result,checkedAt:new Date(observedAt).toISOString()};
      } catch {
        observedAt = now();
        current = {...base,state:'UNAVAILABLE',ready:false,checkedAt:new Date(observedAt).toISOString(),
          checks:{probe:'RPC_UNAVAILABLE'}};
      } finally {
        clearTimeout(timeout); controller = null; inflight = null;
      }
      return status();
    })();
    return inflight;
  }
  async function close() {
    closed = true; controller?.abort();
    if (inflight) await inflight;
  }
  return Object.freeze({status,probe,close});
}
