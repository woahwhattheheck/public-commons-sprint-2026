import { assertSha256, sha256Hex } from './canonical.mjs';

// The Solana mainnet-beta genesis hash, not a private provider identifier.
export const SOLANA_MAINNET_GENESIS_HASH = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';

export class WorkSealSolamiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WorkSealSolamiError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new WorkSealSolamiError(code, message);
}

function assertSolamiUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail('BAD_ENDPOINT', 'Provide an absolute Solami HTTPS RPC URL'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || (host !== 'solami.dev' && !host.endsWith('.solami.dev')) ||
      url.username || url.password || url.hash || url.port) {
    fail('BAD_ENDPOINT', 'Only HTTPS Solami hostnames with no URL userinfo, fragment or port are allowed');
  }
  return url.toString();
}

function validatedBinding(verified) {
  if (!verified || verified.verdict !== 'PASS' || verified.writePerformed !== false ||
      verified.externalAuthorityGranted !== false) {
    fail('UNVERIFIED_WORK', 'Pass a read-only PASS result returned by verifyBrowserBundle');
  }
  const binding = {};
  for (const key of ['taskDigest', 'resultDigest', 'acceptanceDigest', 'settlementIntentDigest']) {
    try { binding[key] = assertSha256(verified[key], 'verified.' + key); }
    catch { fail('BAD_DIGEST', 'Invalid WorkSeal ' + key); }
  }
  return binding;
}

async function rpc(endpoint, fetchFn, method, params, id) {
  const request = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  let response;
  try {
    response = await fetchFn(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: request,
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
  } catch { fail('RPC_UNAVAILABLE', 'Solami RPC request failed'); }
  if (!response?.ok) fail('RPC_UNAVAILABLE', 'Solami RPC returned an unsuccessful status');
  let payload;
  try {
    const raw = await response.text();
    if (raw.length > 8192) fail('BAD_RPC_RESPONSE', 'Oversized Solami RPC response');
    payload = JSON.parse(raw);
  } catch (error) {
    if (error instanceof WorkSealSolamiError) throw error;
    fail('BAD_RPC_RESPONSE', 'Invalid Solami RPC JSON');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      payload.jsonrpc !== '2.0' || payload.id !== id || !Object.hasOwn(payload, 'result') ||
      Object.hasOwn(payload, 'error')) {
    fail('BAD_RPC_RESPONSE', 'Solami RPC response does not match request');
  }
  return payload.result;
}

/**
 * Read a finalized Solana mainnet slot through the owner's Solami RPC endpoint and
 * content-address the observation together with a VERIFIED WorkSeal acceptance.
 * This is a network observation, not an on-chain anchoring transaction or signed oracle.
 */
export async function buildSolamiAcceptanceObservation({
  verified,
  endpoint,
  fetchFn = fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
  maxAgeSeconds = 300,
}) {
  const binding = validatedBinding(verified);
  const rpcUrl = assertSolamiUrl(endpoint);
  if (typeof fetchFn !== 'function' || !Number.isSafeInteger(nowSeconds) ||
      !Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 1 || maxAgeSeconds > 300) {
    fail('BAD_INPUT', 'Invalid transport, time or maximum slot age');
  }
  const genesis = await rpc(rpcUrl, fetchFn, 'getGenesisHash', [], 1);
  if (genesis !== SOLANA_MAINNET_GENESIS_HASH) fail('WRONG_CLUSTER', 'Solami endpoint is not on Solana mainnet-beta');
  const slot = await rpc(rpcUrl, fetchFn, 'getSlot', [{ commitment: 'finalized' }], 2);
  if (!Number.isSafeInteger(slot) || slot <= 0) fail('BAD_SLOT', 'Invalid finalized slot');
  const blockTime = await rpc(rpcUrl, fetchFn, 'getBlockTime', [slot], 3);
  if (!Number.isSafeInteger(blockTime) || blockTime > nowSeconds + 30 ||
      nowSeconds - blockTime > maxAgeSeconds) {
    fail('STALE_SLOT', 'Finalized slot time is missing, future or stale');
  }
  const body = {
    schema: 'workseal-solami-observation/v1',
    provider: 'Solami RPC',
    chain: 'solana-mainnet-beta',
    workSealBinding: binding,
    observation: { genesisHash: genesis, finalizedSlot: slot, slotTimeUnix: blockTime, readAtUnix: nowSeconds },
    authority: { readOnly: true, writePerformed: false, chainAnchoringPerformed: false },
    externalState: { colosseumSubmission: 'NOT_ASSERTED', superteamSubmission: 'NOT_ASSERTED', award: 'NOT_ASSERTED', payment: 'NOT_ASSERTED' },
  };
  return Object.freeze({ ...body, receiptDigest: sha256Hex(body) });
}
