// MIT. Native SDK serialization and read-only Stellar RPC observations for SF101.
import { createHash } from 'node:crypto';
import { SAC_NETWORKS as NETWORKS, resolveSacRpcEndpoint, decodeSacInstance } from './sac.mjs';
export { NETWORKS };
const READ_METHODS = new Set(['getNetwork', 'getLedgerEntries', 'simulateTransaction']);
const MAX_BODY = 2 * 1024 * 1024;
const MAX_CAPTURE = 64 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function fault(code, message = code) { return Object.assign(new Error(message), {code}); }
const requireThat = (ok, code) => { if (!ok) throw fault(code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export async function loadStellarSdk() {
  try { return await import('@stellar/stellar-sdk'); }
  catch (error) { throw fault('STELLAR_SDK_REQUIRED', 'Install the original optional @stellar/stellar-sdk dependency in this application: ' + error.code); }
}

/** Retain original HTTP bytes; replay addresses the same exact serialized request. */
export function createReadTransport({capture, fetchImpl = fetch, liveTransport = false} = {}) {
  if (capture !== undefined) requireThat(object(capture) && capture.schema === 'stellar-forge.sf101.merchant-capture.v1' &&
    Array.isArray(capture.reads) && capture.reads.length <= 10000, 'INVALID_CAPTURE');
  const recorded = new Map();
  let size = 0;
  for (const item of capture?.reads ?? []) {
    requireThat(object(item) && object(item.request) && (typeof item.raw === 'string' || object(item.failure)) &&
      (item.failure || item.sha256 === hash(item.raw) && item.bytes === Buffer.byteLength(item.raw)) &&
      (item.failure || Number.isInteger(item.status) && item.status >= 100 && item.status <= 599) &&
      Number.isFinite(Date.parse(item.observedAt)) && !recorded.has(item.key), 'INVALID_CAPTURE_ENTRY');
    requireThat(item.key === hash(JSON.stringify(item.request)), 'CAPTURE_REQUEST_DIGEST_MISMATCH');
    size += Buffer.byteLength(item.raw ?? '');
    requireThat(Buffer.byteLength(item.raw ?? '') <= MAX_BODY && size <= MAX_CAPTURE, 'CAPTURE_TOO_LARGE');
    recorded.set(item.key, structuredClone(item));
  }
  const used = new Map();
  async function recordedFetch(url, init = {}) {
    const request = {url:String(url), method:init.method ?? 'GET', body:init.body ?? null};
    requireThat(request.method === 'GET' || request.method === 'POST', 'READ_METHOD_REQUIRED');
    if (request.method === 'POST') {
      let body;
      try { body = JSON.parse(request.body); } catch { throw fault('RPC_BODY_INVALID'); }
      requireThat(READ_METHODS.has(body.method), 'RPC_READ_METHOD_REQUIRED');
    }
    const key = hash(JSON.stringify(request));
    let item = recorded.get(key);
    if (capture !== undefined) requireThat(item, 'CAPTURE_REQUEST_MISSING');
    if (!item) {
      let response;
      try { response = await fetchImpl(url, {...init, redirect:'manual'}); }
      catch (error) {
        item = {key,request,observedAt:new Date().toISOString(),failure:{
          code:String(error.code ?? error.cause?.code ?? 'READ_TRANSPORT_FAILED').slice(0,80),
          message:String(error.message ?? 'Read transport failed').slice(0,300)}};
        recorded.set(key,item); used.set(key,item);
        throw fault(item.failure.code,item.failure.message);
      }
      const chunks = []; let bytes = 0;
      if (response.body) for await (const chunk of response.body) {
        bytes += chunk.length;
        requireThat(bytes <= MAX_BODY && size + bytes <= MAX_CAPTURE, 'READ_RESPONSE_TOO_LARGE');
        chunks.push(chunk);
      }
      const raw = new TextDecoder('utf-8', {fatal:true}).decode(Buffer.concat(chunks));
      item = {key,request,status:response.status,raw,sha256:hash(raw),bytes,
        observedAt:new Date().toISOString()};
      size += bytes;
      recorded.set(key,item);
    }
    used.set(key,item);
    if (item.failure) throw fault(item.failure.code,item.failure.message);
    return new Response([204,205,304].includes(item.status) ? null : item.raw,
      {status:item.status,headers:{'content-type':'application/json'}});
  }
  return {fetch:recordedFetch, mode:capture !== undefined ? 'RETAINED_NETWORK_READS' :
    fetchImpl === fetch || liveTransport ? 'LIVE_NETWORK_READS' : 'CALLER_TRANSPORT_READS',
    reads:() => [...used.values()].map(value => structuredClone(value))};
}

export function createNativeReader({sdk, transport, endpoints = {}, environment = process.env, timeoutMs = 12000}) {
  requireThat(Number.isInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 30000, 'INVALID_TIMEOUT');
  const networks = new Map(), tokens = new Map(), balances = new Map();
  const memo = (map, key, task) => {
    if (!map.has(key)) map.set(key, Promise.resolve().then(task));
    return map.get(key);
  };
  async function rpc(endpoint, method, params = {}) {
    requireThat(READ_METHODS.has(method), 'RPC_READ_METHOD_REQUIRED');
    const id = 'sf101-' + method;
    const response = await transport.fetch(endpoint, {method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id,method,params}),signal:AbortSignal.timeout(timeoutMs)});
    requireThat(response.ok, 'RPC_HTTP_' + response.status);
    const message = await response.json();
    requireThat(object(message) && message.jsonrpc === '2.0' && message.id === id, 'RPC_ENVELOPE_MISMATCH');
    if (message.error) throw fault('RPC_PROVIDER_ERROR', String(message.error.message ?? 'RPC provider error').slice(0,300));
    requireThat(object(message.result), 'RPC_RESULT_INVALID');
    return message.result;
  }
  const network = name => memo(networks,name,async () => {
    const definition = NETWORKS[name];
    requireThat(definition, 'UNSUPPORTED_NETWORK');
    const endpoint = resolveSacRpcEndpoint(name,endpoints,environment), result = await rpc(endpoint,'getNetwork');
    requireThat(result.passphrase === definition.passphrase, 'RPC_NETWORK_PASSPHRASE_MISMATCH');
    return {name,endpoint,passphrase:definition.passphrase,protocolVersion:result.protocolVersion ?? null};
  });
  async function query(context, contractId, method, args = []) {
    // Match the original SDK's unsigned read source. It has no private key.
    const transaction = new sdk.TransactionBuilder(new sdk.Account(sdk.contract.NULL_ACCOUNT,'0'),
      {fee:sdk.BASE_FEE,networkPassphrase:context.passphrase})
      .addOperation(new sdk.Contract(contractId).call(method,...args)).setTimeout(0).build();
    const result = await rpc(context.endpoint,'simulateTransaction',{transaction:transaction.toXDR()});
    requireThat(Number.isSafeInteger(result.latestLedger) && result.latestLedger > 0, 'RPC_LEDGER_INVALID');
    if (result.error) throw fault('TOKEN_READ_FAILED', String(result.error).slice(0,300));
    requireThat(!result.restorePreamble, 'TOKEN_STATE_RESTORATION_REQUIRED');
    requireThat(Array.isArray(result.results) && result.results.length === 1 &&
      typeof result.results[0].xdr === 'string' && typeof result.transactionData === 'string', 'TOKEN_READ_RESULT_INVALID');
    const entry = result.results[0], data = new sdk.SorobanDataBuilder(result.transactionData);
    requireThat((entry.auth ?? []).length === 0 && data.getReadWrite().length === 0,
      'TOKEN_GETTER_REQUIRES_AUTHORIZATION_OR_WRITE');
    return {value:sdk.scValToNative(sdk.xdr.ScVal.fromXDR(entry.xdr,'base64')),ledger:result.latestLedger};
  }
  const token = (name, asset) => memo(tokens,JSON.stringify([name,asset]),async () => {
    requireThat(sdk.StrKey.isValidContract(asset), 'ASSET_CONTRACT_ADDRESS_INVALID');
    const context = await network(name), key = new sdk.Contract(asset).getFootprint().toXDR('base64');
    const result = await rpc(context.endpoint,'getLedgerEntries',{keys:[key]});
    const instance = decodeSacInstance({result},asset,sdk);
    requireThat(instance.state !== 'SAC_INSTANCE_MISSING' && instance.liveUntilLedger >= result.latestLedger,
      'CONTRACT_INSTANCE_MISSING_OR_ARCHIVED');
    const kind = instance.executable;
    const sac = kind === 'contractExecutableStellarAsset';
    const decimals = await query(context,asset,'decimals');
    const symbol = await query(context,asset,'symbol');
    const nameResult = await query(context,asset,'name');
    requireThat(Number.isInteger(decimals.value) && decimals.value >= 0 && decimals.value <= 18, 'TOKEN_DECIMALS_UNSUPPORTED');
    requireThat(typeof symbol.value === 'string' && symbol.value.length <= 64 &&
      typeof nameResult.value === 'string' && nameResult.value.length <= 256, 'TOKEN_METADATA_INVALID');
    let classic = null;
    if (sac) {
      requireThat(decimals.value === 7, 'SAC_DECIMALS_MISMATCH');
      if (sdk.Asset.native().contractId(context.passphrase) === asset) classic = 'native';
      else {
        const match = /^([A-Za-z0-9]{1,12}):(G[A-Z2-7]{55})$/.exec(nameResult.value);
        requireThat(match && symbol.value === match[1] && sdk.StrKey.isValidEd25519PublicKey(match[2]), 'SAC_ASSET_IDENTITY_INVALID');
        requireThat(new sdk.Asset(match[1],match[2]).contractId(context.passphrase) === asset, 'SAC_CONTRACT_ID_MISMATCH');
        classic = {code:match[1],issuer:match[2]};
      }
    }
    return {network:name,asset,kind:sac?'STELLAR_ASSET_CONTRACT':'CUSTOM_CONTRACT',executable:kind,
      decimals:decimals.value,symbol:symbol.value,name:nameResult.value,classic,
      rpcOrigin:new URL(context.endpoint).origin,endpointDigest:hash(context.endpoint),
      instanceLedger:instance.latestLedger,liveUntilLedger:instance.liveUntilLedger,instance,
      metadataLedgers:[decimals.ledger,symbol.ledger,nameResult.ledger]};
  });
  const recipient = (name, asset, payTo) => memo(balances,JSON.stringify([name,asset,payTo]),async () => {
    requireThat(sdk.StrKey.isValidEd25519PublicKey(payTo) || sdk.StrKey.isValidContract(payTo), 'RECIPIENT_ADDRESS_INVALID');
    const context = await network(name), metadata = await token(name,asset), address = new sdk.Address(payTo).toScVal();
    const balance = await query(context,asset,'balance',[address]);
    requireThat(typeof balance.value === 'bigint' && balance.value >= 0n && balance.value < (1n << 127n), 'TOKEN_BALANCE_INVALID');
    let authorized = null, authorizationLedger = null;
    if (metadata.kind === 'STELLAR_ASSET_CONTRACT' && metadata.classic !== 'native') {
      const answer = await query(context,asset,'authorized',[address]);
      requireThat(typeof answer.value === 'boolean', 'TOKEN_AUTHORIZATION_INVALID');
      authorized = answer.value; authorizationLedger = answer.ledger;
    }
    return {payTo,balanceAtomic:String(balance.value),balanceLedger:balance.ledger,authorized,authorizationLedger};
  });
  return {network,token,recipient};
}
