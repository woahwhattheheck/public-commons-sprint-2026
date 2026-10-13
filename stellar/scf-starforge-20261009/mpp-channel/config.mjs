// MIT. Selected recurring work and channel authority use the native MPP channel model.
import { resolve } from 'node:path';
import { validStrKey, NETWORKS } from '../sf86-rpc-transfer-reconcile/terms.mjs';
import { normalizeBuyerTransport } from '../sf31-buyer-client/public-transport.mjs';
import { absolute, envName, publicURL, requestConfig, clone, MAX_BODY } from '../mpp-charge/config.mjs';
import { requireValue as need, plain, id, hash, stable } from '../mpp-charge/storage.mjs';
export { absolute, envName, publicURL, clone, MAX_BODY };
export const MAX_ATOMIC = (1n << 127n) - 1n;
export function amount(value, {zero = false} = {}) {
  need(typeof value === 'string' && /^(0|[1-9][0-9]{0,38})$/.test(value) &&
    BigInt(value) <= MAX_ATOMIC && (zero || BigInt(value) > 0n), 'MPP_CHANNEL_AMOUNT_INVALID');
  return value;
}
function text(value, maximum, code) {
  need(typeof value === 'string' && value.trim() && value.length <= maximum && !value.includes('\0'), code);
  return value;
}
function sha(value) {
  need(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'MPP_CHANNEL_SHA256_REQUIRED'); return value;
}
export function source(value) {
  need(plain(value), 'MPP_CHANNEL_SOURCE_REQUIRED');
  return {id:id(value.id), edition:text(value.edition, 256, 'MPP_CHANNEL_SOURCE_EDITION_REQUIRED'),
    title:text(value.title, 500, 'MPP_CHANNEL_SOURCE_TITLE_REQUIRED'),
    uri:publicURL(value.uri).href, sha256:sha(value.sha256),
    authorization:text(value.authorization, 4000, 'MPP_CHANNEL_SOURCE_AUTHORIZATION_REQUIRED')};
}
export function channel(value) {
  need(plain(value) && Object.hasOwn(NETWORKS, value.network) &&
    validStrKey(value.address, 'C') && validStrKey(value.token, 'C') &&
    (validStrKey(value.funder, 'G') || validStrKey(value.funder, 'C')) &&
    (validStrKey(value.recipient, 'G') || validStrKey(value.recipient, 'C')) &&
    validStrKey(value.commitmentKey, 'G'), 'MPP_CHANNEL_IDENTITY_INVALID');
  const decimals=value.decimals ?? 7;
  need(Number.isInteger(decimals) && decimals >= 0 && decimals <= 18, 'MPP_CHANNEL_DECIMALS_INVALID');
  return {network:value.network, address:value.address, token:value.token, funder:value.funder,
    recipient:value.recipient, commitmentKey:value.commitmentKey, decimals,
    wasmSha256:sha(value.wasmSha256),
    contractSource:publicURL(value.contractSource).href,
    rpcUrl:publicURL(value.rpcUrl).href};
}
export const streamKey = terms => hash(stable({network:terms.network, channel:terms.address}));
export const channelIdentity = terms => hash(stable({network:terms.network, address:terms.address,
  token:terms.token, funder:terms.funder, recipient:terms.recipient, commitmentKey:terms.commitmentKey}));
export const profileKey = config => hash(stable(config));
export function taskConfig(value) {
  need(plain(value) && plain(value.budget) && plain(value.signer) && plain(value.request),
    'MPP_CHANNEL_TASK_REQUIRED');
  const endpoint=publicURL(value.request.url);
  need(!endpoint.search && ['GET','POST'].includes(value.request.method), 'MPP_CHANNEL_TASK_ENDPOINT_INVALID');
  const queryKeys=value.request.queryKeys ?? [];
  need(Array.isArray(queryKeys) && queryKeys.length <= 32 && new Set(queryKeys).size===queryKeys.length &&
    queryKeys.every(key=>typeof key==='string' && /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(key)),
    'MPP_CHANNEL_QUERY_KEYS_INVALID');
  const expires=Date.parse(value.budget.expiresAt);
  need(Number.isFinite(expires) && new Date(expires).toISOString()===value.budget.expiresAt,
    'MPP_CHANNEL_AUTHORITY_EXPIRY_REQUIRED');
  const maximumPurchases=value.budget.maximumPurchases;
  need(Number.isSafeInteger(maximumPurchases) && maximumPurchases > 0 && maximumPurchases <= 1000000,
    'MPP_CHANNEL_PURCHASE_LIMIT_INVALID');
  const result={schema:'stellar-forge.mpp-channel-task.v1', taskId:id(value.taskId),
    title:text(value.title, 200, 'MPP_CHANNEL_TASK_TITLE_REQUIRED'),
    usefulTask:text(value.usefulTask, 4000, 'MPP_CHANNEL_USEFUL_TASK_REQUIRED'),
    operator:id(value.operator), source:source(value.source), channel:channel(value.channel),
    request:{url:endpoint.href, method:value.request.method, queryKeys:[...queryKeys].sort()},
    realm:text(value.realm, 253, 'MPP_CHANNEL_REALM_REQUIRED'),
    merchantProfileSha256:sha(value.merchantProfileSha256), offerId:id(value.offerId),
    pricedUnit:text(value.pricedUnit, 500, 'MPP_CHANNEL_PRICED_UNIT_REQUIRED'),
    budget:{maximumAtomic:amount(value.budget.maximumAtomic), maximumUnitAtomic:amount(value.budget.maximumUnitAtomic),
      maximumPurchases, expiresAt:value.budget.expiresAt},
    signer:{keyEnv:envName(value.signer.keyEnv)}, dependencyRoot:absolute(value.dependencyRoot)};
  need(BigInt(result.budget.maximumUnitAtomic) <= BigInt(result.budget.maximumAtomic),
    'MPP_CHANNEL_UNIT_EXCEEDS_TASK_BUDGET');
  if(value.transport !== undefined) result.transport=normalizeBuyerTransport(value.transport);
  return result;
}
export function taskRequest(task, value) {
  const request=requestConfig(value), url=new URL(request.url), selected=new URL(task.request.url);
  need(url.origin===selected.origin && url.pathname===selected.pathname && request.method===task.request.method &&
    [...url.searchParams.keys()].every(key=>task.request.queryKeys.includes(key)),
    'MPP_CHANNEL_REQUEST_OUTSIDE_TASK');
  return request;
}
export function reviewChallenge(challenge, task, {fresh = true} = {}) {
  need(plain(challenge) && challenge.method==='stellar' && challenge.intent==='channel' &&
    challenge.realm===task.realm && plain(challenge.request), 'MPP_CHANNEL_CHALLENGE_IDENTITY_MISMATCH');
  const q=challenge.request;
  need(q.channel===task.channel.address && q.methodDetails?.network===task.channel.network &&
    BigInt(amount(q.amount)) <= BigInt(task.budget.maximumUnitAtomic), 'MPP_CHANNEL_CHALLENGE_TERMS_MISMATCH');
  amount(q.methodDetails?.cumulativeAmount ?? '0', {zero:true});
  if(fresh) {
    const expires=Date.parse(challenge.expires);
    need(Number.isFinite(expires) && expires>Date.now()+5000 && expires<=Date.now()+15*60*1000,
      'MPP_CHANNEL_CHALLENGE_EXPIRED');
  }
  return clone(challenge);
}
export function merchantConfig(value) {
  need(plain(value) && Array.isArray(value.routes) && value.routes.length > 0 && value.routes.length <= 64,
    'MPP_CHANNEL_MERCHANT_REQUIRED');
  const origin=publicURL(value.publicOrigin+'/').origin;
  need(origin===value.publicOrigin, 'MPP_CHANNEL_MERCHANT_ORIGIN_INVALID');
  const routes=[], paths=new Set(), ids=new Set();
  for(const row of value.routes) {
    need(plain(row) && ['GET','POST'].includes(row.method) &&
      typeof row.path==='string' && /^\/[A-Za-z0-9/_-]*$/.test(row.path) &&
      !row.path.startsWith('/_mpp') && !paths.has(row.method+' '+row.path) && !ids.has(row.id),
      'MPP_CHANNEL_ROUTE_INVALID');
    paths.add(row.method+' '+row.path); ids.add(id(row.id));
    const resource=clone(row.resource);
    need(plain(resource) && ['json','json-file','handler'].includes(resource.kind), 'MPP_CHANNEL_RESOURCE_INVALID');
    if(resource.kind==='json') need(Buffer.byteLength(JSON.stringify(resource.value))<=MAX_BODY, 'MPP_CHANNEL_RESOURCE_TOO_LARGE');
    if(resource.kind==='json-file') absolute(resource.path);
    if(resource.kind==='handler') need(/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(resource.export), 'MPP_CHANNEL_HANDLER_INVALID');
    routes.push({id:row.id, method:row.method, path:row.path,
      description:text(row.description, 1000, 'MPP_CHANNEL_DESCRIPTION_REQUIRED'),
      pricedUnit:text(row.pricedUnit, 500, 'MPP_CHANNEL_PRICED_UNIT_REQUIRED'),
      source:source(row.source), amountAtomic:amount(row.amountAtomic), resource});
  }
  const result={schema:'stellar-forge.mpp-channel-merchant.v1',
    title:text(value.title, 200, 'MPP_CHANNEL_MERCHANT_TITLE_REQUIRED'),
    publicOrigin:origin, channel:channel(value.channel), routes, secretEnv:envName(value.secretEnv),
    dependencyRoot:absolute(value.dependencyRoot), lifetimeSeconds:value.lifetimeSeconds ?? 300};
  need(Number.isInteger(result.lifetimeSeconds) && result.lifetimeSeconds>=30 && result.lifetimeSeconds<=900,
    'MPP_CHANNEL_CHALLENGE_LIFETIME_INVALID');
  if(value.handlersModule !== undefined) result.handlersModule=absolute(value.handlersModule);
  need(!routes.some(row=>row.resource.kind==='handler') || result.handlersModule, 'MPP_CHANNEL_HANDLERS_REQUIRED');
  if(value.settlement !== undefined) {
    need(plain(value.settlement) && validStrKey(value.channel.recipient, 'G') &&
      value.settlement.account===value.channel.recipient, 'MPP_CHANNEL_RECIPIENT_SIGNER_REQUIRED');
    result.settlement={account:value.settlement.account, keyEnv:envName(value.settlement.keyEnv),
      maximumFeeStroops:amount(value.settlement.maximumFeeStroops), operator:id(value.settlement.operator)};
  }
  return result;
}
export function funderConfig(value) {
  need(plain(value) && plain(value.funding), 'MPP_CHANNEL_FUNDER_PROFILE_REQUIRED');
  const terms=channel(value.channel);
  need(validStrKey(terms.funder,'G') && value.funding.account===terms.funder,
    'MPP_CHANNEL_FUNDER_ACCOUNT_SIGNER_REQUIRED');
  return {schema:'stellar-forge.mpp-channel-funder.v1',
    title:text(value.title,200,'MPP_CHANNEL_FUNDER_TITLE_REQUIRED'),channel:terms,
    dependencyRoot:absolute(value.dependencyRoot),
    funding:{account:terms.funder,keyEnv:envName(value.funding.keyEnv),
      maximumFeeStroops:amount(value.funding.maximumFeeStroops),operator:id(value.funding.operator)}};
}
export function draftFunder(terms) {
  return {schema:'stellar-forge.mpp-channel-funder.v1',title:'',channel:terms?channel(terms):draftTask().channel,
    dependencyRoot:'',funding:{account:terms?.funder ?? '',keyEnv:'MPP_CHANNEL_FUNDER_SECRET',
      maximumFeeStroops:'',operator:''}};
}
export function humanAmount(value, decimals) {
  const digits=amount(value).padStart(decimals+1, '0');
  return decimals ? digits.slice(0,-decimals)+'.'+digits.slice(-decimals) : digits;
}
export function draftTask() {
  return {schema:'stellar-forge.mpp-channel-task.v1', taskId:'selected-recurring-task',
    title:'', usefulTask:'', operator:'', source:{id:'', edition:'', title:'', uri:'', sha256:'', authorization:''},
    channel:{network:'stellar:testnet', address:'', token:'', funder:'', recipient:'', commitmentKey:'',
      decimals:7, wasmSha256:'', contractSource:'', rpcUrl:'https://soroban-testnet.stellar.org/'},
    request:{url:'', method:'POST', queryKeys:[]}, realm:'', merchantProfileSha256:'', offerId:'', pricedUnit:'',
    budget:{maximumAtomic:'', maximumUnitAtomic:'', maximumPurchases:1, expiresAt:''},
    signer:{keyEnv:'MPP_CHANNEL_COMMITMENT_SECRET'}, dependencyRoot:''};
}

export function openingConfig(value) {
  need(plain(value) && plain(value.opening) && plain(value.funding),
    'MPP_CHANNEL_OPENING_PROFILE_REQUIRED');
  const terms=channel(value.channel),selected=value.opening;
  need(validStrKey(terms.funder,'G') && value.funding.account===terms.funder,
    'MPP_CHANNEL_OPENING_FUNDER_ACCOUNT_REQUIRED');
  need(['existing','upload'].includes(selected.codeMode),'MPP_CHANNEL_CODE_MODE_REQUIRED');
  need(Number.isInteger(selected.refundWaitingPeriod) && selected.refundWaitingPeriod>=0 &&
    selected.refundWaitingPeriod<=4294967295,'MPP_CHANNEL_REFUND_WAITING_PERIOD_INVALID');
  return {schema:'stellar-forge.mpp-channel-opening-profile.v1',
    title:text(value.title,200,'MPP_CHANNEL_OPENING_TITLE_REQUIRED'),channel:terms,
    dependencyRoot:absolute(value.dependencyRoot),
    opening:{salt:sha(selected.salt),initialAmountAtomic:amount(selected.initialAmountAtomic,{zero:true}),
      refundWaitingPeriod:selected.refundWaitingPeriod,codeMode:selected.codeMode,
      ...(selected.codeMode==='upload'?{wasmFile:absolute(selected.wasmFile)}:{})},
    funding:{account:terms.funder,keyEnv:envName(value.funding.keyEnv),
      maximumFeeStroops:amount(value.funding.maximumFeeStroops),operator:id(value.funding.operator)}};
}
export function draftOpening() {
  return {schema:'stellar-forge.mpp-channel-opening-profile.v1',title:'',
    channel:{...draftTask().channel},dependencyRoot:'',
    opening:{salt:'',initialAmountAtomic:'',refundWaitingPeriod:null,codeMode:'existing',wasmFile:''},
    funding:{account:'',keyEnv:'MPP_CHANNEL_FUNDER_SECRET',maximumFeeStroops:'',operator:''}};
}
