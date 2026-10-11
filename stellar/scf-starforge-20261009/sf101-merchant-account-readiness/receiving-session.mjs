// MIT. Native discovery and retained reads composed with the original SAC reviewer.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readSellerConfig } from '../sf30-seller-sdk/serve.mjs';
import { formatAtomic } from '../sf16-asset-engine/assets.mjs';
import { amountText, sha256 } from './readiness.mjs';
import { createSacAssetMap, createSacRecipientReviewer, resolveSacRpcEndpoint } from './sac.mjs';
import { compileSellerReadinessPlan, reviewSellerSacReadiness, summarizeMerchantReadiness } from './merchant.mjs';
import { createNativeReader, createReadTransport, loadStellarSdk, fault } from './native-reader.mjs';

const serial = value => JSON.stringify(value);
const key = terms => serial([terms.network,terms.asset]);
const codeOf = error => typeof error?.code === 'string' && /^[A-Z0-9_]{1,100}$/.test(error.code)
  ? error.code : 'NATIVE_READ_FAILED';
const captureRead = async task => { try { return {value:await task()}; } catch (error) { return {error:codeOf(error)}; } };

export async function readMerchantReceivingPlan(configPath, {origin} = {}) {
  const path = resolve(configPath), before = await readFile(path);
  if (before.length > 1024*1024) throw fault('SELLER_CONFIG_TOO_LARGE');
  const config = await readSellerConfig(path), after = await readFile(path);
  if (!before.equals(after)) throw fault('SELLER_CONFIG_CHANGED_DURING_READ');
  if (!config.publicOrigin && !origin) throw fault('SELLER_ORIGIN_REQUIRED');
  const plan = compileSellerReadinessPlan(config,{origin});
  const configuration = {path,bytes:before.length,sha256:sha256(before),publicOrigin:plan.publicOrigin};
  return {config,plan,configuration,planDigest:sha256(serial(plan))};
}

/** The original SAC G-account evaluator remains the only classic receiving engine. */
export async function inspectMerchantReceiving({configPath,origin,assetMap,rpcEndpoints,environment = process.env,
  timeoutMs = 12000,feeOperations = 0,capture,sdk,fetchImpl,liveTransport = false} = {}) {
  origin ??= capture?.publicOrigin;
  const source = await readMerchantReceivingPlan(configPath,{origin});
  if (capture && (capture.planDigest !== source.planDigest || capture.configurationSha256 !== source.configuration.sha256))
    throw fault('CAPTURE_SELLER_PLAN_MISMATCH');
  if (capture && assetMap !== undefined && serial(assetMap) !== serial(capture.inputAssetMap)) throw fault('CAPTURE_ASSET_MAP_MISMATCH');
  if (capture && feeOperations !== capture.feeOperations) throw fault('CAPTURE_FEE_OPERATIONS_MISMATCH');
  assetMap ??= capture?.inputAssetMap ?? undefined;
  sdk ??= await loadStellarSdk();
  const supplied = assetMap ? await createSacAssetMap(assetMap,{sdk}) : null;
  const terms = source.plan.routes.flatMap(route=>route.accepts);
  const selected = rpcEndpoints ?? capture?.endpoints ?? {}, endpoints = {};
  for (const network of new Set(terms.map(term=>term.network))) {
    try { endpoints[network] = {url:resolveSacRpcEndpoint(network,selected,environment)}; }
    catch { if (selected[network] !== undefined) endpoints[network] = selected[network]; }
  }
  if (capture && serial(endpoints) !== serial(capture.endpoints)) throw fault('CAPTURE_ENDPOINTS_MISMATCH');
  const transport = createReadTransport({capture,fetchImpl,liveTransport});
  const native = createNativeReader({sdk,transport,endpoints,environment,timeoutMs});
  const tokens = new Map(), mappings = new Map((supplied?.entries() ?? []).map(row=>[key(row),row]));
  for (const term of terms) if (!tokens.has(key(term))) {
    const result = await captureRead(()=>native.token(term.network,term.asset));
    tokens.set(key(term),result);
    if (result.value?.kind === 'STELLAR_ASSET_CONTRACT' && !mappings.has(key(term))) {
      const token = result.value;
      mappings.set(key(term),{network:term.network,asset:term.asset,classicAsset:token.classic,
        source:`Native SDK verified RPC metadata at ${token.rpcOrigin}; ledger ${token.instanceLedger}; endpoint ${token.endpointDigest}`});
    }
  }
  const resolvedAssetMap = {schema:'stellar-forge.sac-asset-map.v1',assets:[...mappings.values()]};
  const sac = mappings.size ? await createSacRecipientReviewer({assetMap:resolvedAssetMap,rpcEndpoints:endpoints,
    environment,timeoutMs,feeOperations,fetchImpl:transport.fetch,sdk}) : null;
  const reviewer = {review:async payment => {
    const found = tokens.get(key(payment));
    if (!found?.value) throw fault(found?.error ?? 'NATIVE_TOKEN_READ_MISSING');
    const token = found.value, isAccount = sdk.StrKey.isValidEd25519PublicKey(payment.payTo);
    if (!isAccount && !sdk.StrKey.isValidContract(payment.payTo)) throw fault('INVALID_G_ADDRESS');
    const read = await captureRead(()=>native.recipient(payment.network,payment.asset,payment.payTo));
    const nativeResult = {token,amountDecimal:formatAtomic(payment.amount,token.decimals),
      recipient:read.value ?? null,errors:read.error ? [read.error] : []};
    let result;
    if (token.kind === 'STELLAR_ASSET_CONTRACT' && isAccount) {
      result = structuredClone(await sac.review(payment));
    } else {
      result = {schema:'stellar-forge.sac-recipient-readiness.v1',terms:structuredClone(payment),
        mapping:mappings.get(key(payment)) ?? null,classic:null,contract:token.instance,
        observedAtMs:Date.now(),completedAt:new Date().toISOString(),reasons:[],accountAdvisories:[],
        status:token.kind === 'STELLAR_ASSET_CONTRACT' ? 'SAC_RECIPIENT_READY' : 'REVIEW_REQUIRED',
        ready:token.kind === 'STELLAR_ASSET_CONTRACT'};
      if (token.kind === 'CUSTOM_CONTRACT') result.reasons.push('CUSTOM_CONTRACT_RECEIVING_POLICY');
    }
    result.native = nativeResult;
    const add = (code,status='ACTION_REQUIRED') => {
      if (!result.reasons.includes(code)) result.reasons.push(code);
      result.ready = false;
      if (result.status !== 'ACTION_REQUIRED') result.status = status;
    };
    if (read.error) add(read.error,'READ_FAILED');
    else {
      const recipient = read.value;
      if (recipient.authorized === false) add('NATIVE_RECIPIENT_NOT_AUTHORIZED');
      const max = (1n << (isAccount && token.kind === 'STELLAR_ASSET_CONTRACT' ? 63n : 127n)) - 1n;
      if (BigInt(recipient.balanceAtomic) + BigInt(payment.amount) > max) add('TOKEN_BALANCE_LIMIT_EXCEEDED');
      if (result.classic?.recipient.existingBalance !== null && result.classic?.recipient.existingBalance !== undefined &&
        amountText(recipient.balanceAtomic) !== result.classic.recipient.existingBalance)
        add('NATIVE_CLASSIC_BALANCE_CHANGED','REVIEW_REQUIRED');
      if (result.classic && token.classic !== 'native' && recipient.authorized !== null &&
        (result.classic.recipient.authorization === 'AUTHORIZED') !== recipient.authorized)
        add('NATIVE_CLASSIC_AUTHORIZATION_CHANGED','REVIEW_REQUIRED');
      const ledgers = [token.instanceLedger,...token.metadataLedgers,recipient.balanceLedger,
        ...(recipient.authorizationLedger ? [recipient.authorizationLedger] : [])];
      if (Math.max(...ledgers)-Math.min(...ledgers) > 12) add('NATIVE_LEDGER_SKEW','REVIEW_REQUIRED');
    }
    return result;
  }};
  let report = await reviewSellerSacReadiness(source.config,{reviewer,origin});
  const reads = transport.reads(), now = Date.now();
  const oldest = reads.length ? Math.min(...reads.map(read=>Date.parse(read.observedAt))) : now;
  const changed = await captureRead(()=>readFile(source.configuration.path));
  const configurationUnchanged = changed.value !== undefined && sha256(changed.value) === source.configuration.sha256;
  const sourceReasons = [
    ...(transport.mode !== 'LIVE_NETWORK_READS' ? ['RETAINED_SOURCE_REVIEW'] : []),
    ...(now-oldest > 60000 || now < oldest ? ['OBSERVATION_STALE'] : []),
    ...(!configurationUnchanged ? ['SELLER_CONFIG_CHANGED_DURING_CHECK'] : []),
  ];
  if (sourceReasons.length) report.options = report.options.map(row=> {
    if (!row.readiness) return row;
    const readiness = {...row.readiness,reasons:[...new Set([...row.readiness.reasons,...sourceReasons])],ready:false};
    if (readiness.status === 'SAC_RECIPIENT_READY') readiness.status = 'REVIEW_REQUIRED';
    return {...row,status:readiness.status,readiness};
  });
  report = summarizeMerchantReadiness({...report,mode:transport.mode,configuration:{...source.configuration,
    unchangedAtCompletion:configurationUnchanged},sourceReasons,readCount:reads.length});
  return {plan:source.plan,report,resolvedAssetMap,capture:{schema:'stellar-forge.sf101.merchant-capture.v1',
    planDigest:source.planDigest,configurationSha256:source.configuration.sha256,publicOrigin:source.plan.publicOrigin,
    inputAssetMap:assetMap ?? null,
    endpoints,feeOperations,mode:transport.mode,reads}};
}

export function compareMerchantReadiness(previous,current) {
  if (previous?.schema !== 'stellar-forge.seller-sac-readiness.v1' || !Array.isArray(previous.options)) throw fault('PREVIOUS_REPORT_INVALID');
  // Option position can change; payment identity includes the complete original terms and resource.
  const identity = row => serial([row.routeId,row.method,row.url,row.terms]);
  const reasons = row => row?.readiness?.reasons ?? (row?.errorCode ? [row.errorCode] : []);
  const before = new Map(previous.options.map(row=>[identity(row),row])), seen = new Set(), options = [];
  for (const row of current.options) {
    const id = identity(row), prior = before.get(id); seen.add(id);
    options.push({routeId:row.routeId,optionIndex:row.optionIndex,optionId:row.optionId,
      change:!prior?'ADDED':serial([prior.status,reasons(prior)])===serial([row.status,reasons(row)])?'UNCHANGED':'CHANGED',
      before:prior?.status ?? null,after:row.status,resolved:reasons(prior).filter(code=>!reasons(row).includes(code)),
      introduced:reasons(row).filter(code=>!reasons(prior).includes(code))});
  }
  for (const row of previous.options) if (!seen.has(identity(row))) options.push({routeId:row.routeId,optionIndex:row.optionIndex,
    optionId:row.optionId,change:'REMOVED',before:row.status,after:null,resolved:[],introduced:[]});
  return {previousCompletedAt:previous.completedAt,previousPlanDigest:previous.planDigest,currentPlanDigest:current.planDigest,options};
}
