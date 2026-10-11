// MIT. Native SAC receiving preflight composed with original SF101 and SF16.
import { isDeepStrictEqual } from 'node:util';
import { amountText, evaluateSnapshots, fetchOfficialSnapshots, sha256, validateGAddress } from './readiness.mjs';
import { validatePaymentTerms } from '../sf16-asset-engine/assets.mjs';

const I64_MAX = (1n << 63n) - 1n;
const NETWORKS = Object.freeze({
  'stellar:testnet': { horizon:'testnet', passphrase:'Test SDF Network ; September 2015', rpc:'https://soroban-testnet.stellar.org' },
  'stellar:pubnet': { horizon:'public', passphrase:'Public Global Stellar Network ; September 2015' },
});
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const check = (condition, code) => { if (!condition) throw new SacReadinessError(code); };
const freeze = value => { if (object(value) || Array.isArray(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const keyFor = (network, asset) => `${network}|${asset}`;
function nativeStroops(value) {
  check(typeof value === 'string' && /^(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,7})?$/.test(value), 'INVALID_NATIVE_BALANCE');
  const [whole,fraction=''] = value.split('.');
  const amount = BigInt(whole)*10000000n+BigInt(fraction.padEnd(7,'0'));
  check(amount <= I64_MAX, 'INVALID_NATIVE_BALANCE');
  return amount;
}

export class SacReadinessError extends Error {
  constructor(code, report) { super(code); this.name = 'SacReadinessError'; this.code = code; if (report) this.report = report; }
}

function termsCopy(input) {
  check(object(input), 'PAYMENT_TERMS_REQUIRED');
  const terms = structuredClone(input);
  check(terms.scheme === 'exact' && Object.hasOwn(NETWORKS, terms.network), 'UNSUPPORTED_PAYMENT_PROFILE');
  check(typeof terms.asset === 'string' && /^C[A-Z2-7]{55}$/.test(terms.asset), 'SAC_CONTRACT_REQUIRED');
  validateGAddress(terms.payTo);
  check(typeof terms.amount === 'string' && /^[1-9][0-9]{0,18}$/.test(terms.amount) && BigInt(terms.amount) <= I64_MAX,
    'CLASSIC_RECIPIENT_AMOUNT_OUT_OF_RANGE');
  return freeze(terms);
}

/** Bind an operator's classic asset to its reserved SAC using the official SDK. */
export async function createSacAssetMap(input, { sdk } = {}) {
  check(object(input) && input.schema === 'stellar-forge.sac-asset-map.v1' && Array.isArray(input.assets) &&
    input.assets.length > 0 && input.assets.length <= 200, 'SAC_ASSET_MAP_REQUIRED');
  const original = structuredClone(input);
  sdk ??= await import('@stellar/stellar-sdk');
  const entries = new Map();
  for (const row of original.assets) {
    check(object(row) && Object.hasOwn(NETWORKS, row.network), 'INVALID_SAC_ASSET_NETWORK');
    const native = row.classicAsset === 'native';
    if (!native) {
      check(object(row.classicAsset) && /^[A-Z0-9]{1,12}$/.test(row.classicAsset.code ?? ''), 'INVALID_CLASSIC_ASSET');
      validateGAddress(row.classicAsset.issuer);
    }
    let derived;
    try {
      const asset = native ? sdk.Asset.native() : new sdk.Asset(row.classicAsset.code, row.classicAsset.issuer);
      derived = asset.contractId(NETWORKS[row.network].passphrase);
    } catch { throw new SacReadinessError('SAC_DERIVATION_FAILED'); }
    check(row.asset === derived, 'SAC_CONTRACT_ASSET_MISMATCH');
    check(typeof row.source === 'string' && row.source.length >= 12 && row.source.length <= 512, 'ASSET_SOURCE_REQUIRED');
    const key = keyFor(row.network, row.asset);
    check(!entries.has(key), 'DUPLICATE_SAC_ASSET');
    entries.set(key, freeze({network:row.network, asset:derived, classicAsset:row.classicAsset, decimals:7, source:row.source}));
  }
  return Object.freeze({ get:(network, asset) => entries.get(keyFor(network, asset)), entries:() => [...entries.values()] });
}

function endpointFor(network, endpoints, environment) {
  const selected = endpoints[network];
  let raw = NETWORKS[network].rpc;
  if (selected !== undefined) {
    check(object(selected) && Object.keys(selected).every(key => ['url','urlEnv'].includes(key)) &&
      (selected.url === undefined) !== (selected.urlEnv === undefined), 'INVALID_RPC_ENDPOINT');
    if (selected.urlEnv !== undefined) {
      check(typeof selected.urlEnv === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(selected.urlEnv), 'INVALID_RPC_ENVIRONMENT_NAME');
      raw = environment[selected.urlEnv];
    } else raw = selected.url;
  }
  check(typeof raw === 'string' && raw.length <= 4096, 'RPC_ENDPOINT_REQUIRED');
  let url;
  try { url = new URL(raw); } catch { throw new SacReadinessError('INVALID_RPC_ENDPOINT'); }
  check(url.protocol === 'https:' && !url.username && !url.password && !url.hash, 'RPC_HTTPS_REQUIRED');
  return url.href;
}

async function rpcRead(url, method, params, {fetchImpl, timeoutMs}) {
  check(['getNetwork','getLedgerEntries'].includes(method), 'RPC_READ_METHOD_REQUIRED');
  const id = `sf101-${method}`, controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(url, {method:'POST', headers:{'content-type':'application/json',accept:'application/json'},
        body:JSON.stringify({jsonrpc:'2.0',id,method,params}), redirect:'manual', signal:controller.signal});
    } catch { throw new SacReadinessError('RPC_TRANSPORT_FAILED'); }
    check(response.ok, `RPC_HTTP_${response.status}`);
    check(response.body, 'RPC_EMPTY_RESPONSE');
    let size = 0; const parts = [];
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 1024 * 1024) { controller.abort(); throw new SacReadinessError('RPC_RESPONSE_TOO_LARGE'); }
      parts.push(chunk);
    }
    const bytes = Buffer.concat(parts); let envelope;
    try { envelope = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)); }
    catch { throw new SacReadinessError('RPC_INVALID_JSON'); }
    check(object(envelope) && envelope.jsonrpc === '2.0' && envelope.id === id &&
      !Object.hasOwn(envelope,'error') && object(envelope.result), 'RPC_INVALID_RESULT');
    return {result:envelope.result, source:{method, origin:new URL(url).origin, endpointDigest:sha256(url),
      responseDigest:sha256(bytes), bytes:size}};
  } finally { clearTimeout(timer); controller.abort(); }
}

function decodeSacInstance({result}, asset, sdk) {
  check(Number.isSafeInteger(result.latestLedger) && result.latestLedger > 0 && Array.isArray(result.entries) &&
    result.entries.length <= 1, 'RPC_INVALID_LEDGER_ENTRIES');
  if (!result.entries.length) return {state:'SAC_INSTANCE_MISSING', latestLedger:result.latestLedger};
  const row = result.entries[0], expected = new sdk.Contract(asset).getFootprint();
  check(object(row) && row.key === expected.toXDR('base64') && typeof row.xdr === 'string' &&
    row.xdr.length <= 512 * 1024, 'RPC_CONTRACT_KEY_MISMATCH');
  let data;
  try { data = sdk.xdr.LedgerEntryData.fromXDR(row.xdr, 'base64').contractData(); }
  catch { throw new SacReadinessError('RPC_CONTRACT_XDR_INVALID'); }
  const expectedData = expected.contractData();
  check(data.contract().toXDR('base64') === expectedData.contract().toXDR('base64') &&
    data.key().toXDR('base64') === expectedData.key().toXDR('base64') &&
    data.durability().value === expectedData.durability().value, 'RPC_CONTRACT_DATA_MISMATCH');
  let executable;
  try { executable = data.val().instance().executable().switch().name; }
  catch { throw new SacReadinessError('RPC_CONTRACT_INSTANCE_INVALID'); }
  check(Number.isSafeInteger(row.lastModifiedLedgerSeq) && row.lastModifiedLedgerSeq > 0 &&
    row.lastModifiedLedgerSeq <= result.latestLedger, 'RPC_CONTRACT_LEDGER_INVALID');
  const liveUntil = row.liveUntilLedgerSeq;
  check(Number.isSafeInteger(liveUntil) && liveUntil >= 0, 'RPC_CONTRACT_LIFETIME_MISSING');
  return {state:executable !== 'contractExecutableStellarAsset' ? 'CONTRACT_EXECUTABLE_NOT_SAC' :
      liveUntil < result.latestLedger ? 'SAC_INSTANCE_ARCHIVED' : 'SAC_INSTANCE_LIVE',
    executable, latestLedger:result.latestLedger, lastModifiedLedger:row.lastModifiedLedgerSeq,
    liveUntilLedger:liveUntil, entryDigest:sha256(Buffer.from(row.xdr,'base64'))};
}

/** One run-scoped reader shares actual account and contract reads across options. */
export async function createSacRecipientReviewer({assetMap, rpcEndpoints = {}, environment = process.env,
  timeoutMs = 12000, feeOperations = 0, fetchImpl = globalThis.fetch, sdk} = {}) {
  check(object(rpcEndpoints) && Object.keys(rpcEndpoints).every(key => Object.hasOwn(NETWORKS,key)), 'INVALID_RPC_ENDPOINTS');
  check(Number.isInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 30000 && typeof fetchImpl === 'function', 'INVALID_READ_OPTIONS');
  check(Number.isSafeInteger(feeOperations) && feeOperations >= 0 && feeOperations <= 100000, 'INVALID_FEE_OPERATIONS');
  sdk ??= await import('@stellar/stellar-sdk');
  const assets = await createSacAssetMap(assetMap, {sdk});
  const endpoints = structuredClone(rpcEndpoints), cache = new Map();
  const readOptions = {fetchImpl,timeoutMs};
  function cached(key, read) {
    const prior = cache.get(key), now = Date.now();
    if (prior && now - prior.startedAtMs <= 30000) return prior.promise;
    const entry = {startedAtMs:now};
    entry.promise = Promise.resolve().then(read).then(value => ({value, startedAtMs:now}));
    cache.set(key, entry);
    entry.promise.catch(() => { if (cache.get(key) === entry) cache.delete(key); });
    return entry.promise;
  }
  async function review(input) {
    const terms = termsCopy(input), mapping = assets.get(terms.network,terms.asset);
    check(mapping, 'SAC_ASSET_MAPPING_REQUIRED');
    const rpcUrl = endpointFor(terms.network,endpoints,environment), endpointId = sha256(rpcUrl);
    const network = await cached(`network|${endpointId}`, () => rpcRead(rpcUrl,'getNetwork',{},readOptions));
    check(network.value.result.passphrase === NETWORKS[terms.network].passphrase, 'RPC_NETWORK_MISMATCH');
    const [horizon, rpc] = await Promise.all([
      cached(`account|${terms.network}|${terms.payTo}`, () => fetchOfficialSnapshots({network:NETWORKS[terms.network].horizon,
        accountId:terms.payTo,timeoutMs,fetchImpl})),
      cached(`contract|${endpointId}|${terms.asset}`, () => rpcRead(rpcUrl,'getLedgerEntries',
        {keys:[new sdk.Contract(terms.asset).getFootprint().toXDR('base64')]},readOptions)),
    ]);
    const observedAtMs = Math.min(network.startedAtMs,horizon.startedAtMs,rpc.startedAtMs), now = Date.now();
    const classic = evaluateSnapshots({...horizon.value, accountId:terms.payTo,network:NETWORKS[terms.network].horizon,
      asset:mapping.classicAsset,inboundAmount:amountText(terms.amount),feeOperations,mode:'live',now:new Date(now)});
    const contract = decodeSacInstance(rpc.value,terms.asset,sdk), reasons = classic.reasons.filter(reason =>
      !['XLM_FEE_FLOOR_NOT_MET','XLM_BELOW_BASE_RESERVE_AND_LIABILITIES'].includes(reason));
    if (contract.state !== 'SAC_INSTANCE_LIVE') reasons.push(contract.state);
    if (Math.abs(contract.latestLedger - classic.ledger.sequence) > 12) reasons.push('RPC_HORIZON_LEDGER_SKEW');
    if (classic.cautions.includes('LEDGER_HEAD_AGE_OUT_OF_RANGE') || now - observedAtMs > 60000 || now < observedAtMs)
      reasons.push('OBSERVATION_STALE');
    if (mapping.classicAsset === 'native') {
      const line = horizon.value.account.balances.find(value => value.asset_type === 'native');
      if (nativeStroops(line.balance) + nativeStroops(line.buying_liabilities ?? '0') + BigInt(terms.amount) > I64_MAX)
        reasons.push('NATIVE_INBOUND_CAPACITY_EXCEEDED');
    }
    return freeze({schema:'stellar-forge.sac-recipient-readiness.v1', terms, mapping,
      status:reasons.length ? 'ACTION_REQUIRED' : 'SAC_RECIPIENT_READY', ready:reasons.length === 0,
      observedAtMs, completedAt:new Date(now).toISOString(), reasons, contract, classic,
      accountAdvisories:classic.reasons.filter(reason => !reasons.includes(reason)),
      source:{horizon:horizon.value.source, network:network.value.source, contract:rpc.value.source}});
  }
  async function validate(input, registry) {
    const terms = termsCopy(input), metadata = registry.get(terms.network,terms.asset);
    check(metadata.decimals === 7, 'SAC_DECIMALS_MISMATCH');
    const report = await review(terms);
    check(report.ready, 'SAC_RECIPIENT_ACTION_REQUIRED');
    const accepted = await validatePaymentTerms(terms,registry,{now:Date.now(),verifyRecipient:async claim => {
      check(isDeepStrictEqual(claim,{network:terms.network,asset:terms.asset,payTo:terms.payTo}), 'RECIPIENT_CLAIM_MISMATCH');
      return {...claim,ready:true,observedAtMs:report.observedAtMs};
    }});
    return Object.freeze({terms:accepted,readiness:report});
  }
  return Object.freeze({review,validate,assets:assets.entries,clear:() => cache.clear()});
}
