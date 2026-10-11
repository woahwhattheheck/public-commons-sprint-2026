// MIT. Original MPP terms remain MPP; SF36 receives only its exact-amount accounting contract.
import { isIP } from 'node:net';
import { MAX_REQUEST_BODY_BYTES } from '../sf31-buyer-client/request-body.mjs';
import { resolve } from 'node:path';
import { validStrKey, NETWORKS } from '../sf86-rpc-transfer-reconcile/terms.mjs';
import { normalizeBuyerTransport } from '../sf31-buyer-client/public-transport.mjs';
import { hash, stable, plain, requireValue, id } from './storage.mjs';
export const MAX_BODY = 2 * 1024 * 1024;
export const clone = value => JSON.parse(JSON.stringify(value));
export function atomic(value) {
  requireValue(typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n,'MPP_ATOMIC_AMOUNT_INVALID');
  return value;
}
export function envName(value) {
  requireValue(typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value),'MPP_ENVIRONMENT_NAME_INVALID'); return value;
}
export function absolute(value) {
  requireValue(typeof value === 'string' && value === resolve(value) && !value.includes('\0'),'MPP_ABSOLUTE_PATH_REQUIRED'); return value;
}
export function publicURL(value) {
  let url; try { url=new URL(value); } catch { requireValue(false,'MPP_HTTPS_URL_REQUIRED'); }
  requireValue(typeof value === 'string' && value === url.href && url.protocol === 'https:' &&
    !url.username && !url.password && !url.hash && !url.port && url.hostname.includes('.') &&
    !isIP(url.hostname.replace(/^\[|\]$/g,'')) &&
    !['localhost','local','internal','home.arpa'].some(x=>url.hostname===x || url.hostname.endsWith('.'+x)) &&
    !/[\u0000-\u0020\\]/.test(value),'MPP_CANONICAL_PUBLIC_HTTPS_REQUIRED');
  return url;
}
export function terms(value) {
  requireValue(plain(value) && Object.hasOwn(NETWORKS,value.network) &&
    validStrKey(value.currency,'C') && (validStrKey(value.recipient,'G') || validStrKey(value.recipient,'C')),
    'MPP_STELLAR_TERMS_INVALID');
  const decimals=value.decimals ?? 7;
  requireValue(Number.isInteger(decimals) && decimals >= 0 && decimals <= 18,'MPP_DECIMALS_INVALID');
  return {network:value.network,currency:value.currency,recipient:value.recipient,
    amountAtomic:atomic(value.amountAtomic),decimals};
}
export function humanAmount(amount,decimals) {
  const digits=atomic(amount).padStart(decimals+1,'0');
  return decimals ? digits.slice(0,-decimals)+'.'+digits.slice(-decimals) : digits;
}
export function merchantConfig(value) {
  requireValue(plain(value) && Buffer.byteLength(JSON.stringify(value)) <= MAX_BODY,'MPP_MERCHANT_PROFILE_REQUIRED');
  const origin=publicURL(value.publicOrigin+'/').origin;
  requireValue(origin === value.publicOrigin && typeof value.title === 'string' &&
    value.title.length > 0 && value.title.length <= 200,'MPP_MERCHANT_IDENTITY_INVALID');
  requireValue(Array.isArray(value.routes) && value.routes.length > 0 && value.routes.length <= 64,'MPP_MERCHANT_ROUTES_INVALID');
  const ids=new Set(), paths=new Set();
  const routes=value.routes.map(route=>{
    requireValue(plain(route) && ['GET','POST'].includes(route.method) &&
      typeof route.path === 'string' && /^\/[A-Za-z0-9/_-]*$/.test(route.path) &&
      !route.path.startsWith('/_mpp') && !ids.has(route.id) &&
      !paths.has(route.method+' '+route.path),'MPP_ROUTE_INVALID');
    ids.add(id(route.id)); paths.add(route.method+' '+route.path);
    requireValue(typeof route.description === 'string' && route.description.length <= 1000,'MPP_DESCRIPTION_INVALID');
    const resource=clone(route.resource);
    requireValue(plain(resource) && ['json','json-file','handler'].includes(resource.kind),'MPP_RESOURCE_KIND_INVALID');
    if(resource.kind === 'json') requireValue(Buffer.byteLength(JSON.stringify(resource.value)) <= MAX_BODY,'MPP_RESOURCE_TOO_LARGE');
    if(resource.kind === 'json-file') absolute(resource.path);
    if(resource.kind === 'handler') requireValue(/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(resource.export),'MPP_HANDLER_EXPORT_INVALID');
    return {id:route.id,method:route.method,path:route.path,description:route.description,payment:terms(route.payment),resource};
  });
  const lifetimeSeconds=value.lifetimeSeconds ?? 300;
  requireValue(Number.isInteger(lifetimeSeconds) && lifetimeSeconds >= 30 && lifetimeSeconds <= 900,'MPP_CHALLENGE_LIFETIME_INVALID');
  const result={schema:'stellar-forge.mpp-merchant.v1',title:value.title,publicOrigin:origin,
    secretEnv:envName(value.secretEnv),dependencyRoot:absolute(value.dependencyRoot),lifetimeSeconds,routes};
  if(value.handlersModule !== undefined) result.handlersModule=absolute(value.handlersModule);
  requireValue(!routes.some(r=>r.resource.kind === 'handler') || result.handlersModule,'MPP_HANDLERS_MODULE_REQUIRED');
  if(value.rpcUrl !== undefined) result.rpcUrl=publicURL(value.rpcUrl).href;
  return result;
}
export function requestConfig(value) {
  requireValue(plain(value) && ['GET','POST'].includes(value.method),'MPP_REQUEST_INVALID');
  const result={url:publicURL(value.url).href,method:value.method};
  if(Object.hasOwn(value,'json')) {
    requireValue(value.method === 'POST','MPP_GET_BODY_INVALID');
    result.json=clone(value.json);
    requireValue(Buffer.byteLength(JSON.stringify(result.json)) <= MAX_REQUEST_BODY_BYTES,'MPP_REQUEST_TOO_LARGE');
  }
  return result;
}
export const requestBytes = request => Object.hasOwn(request,'json') ? Buffer.from(JSON.stringify(request.json)) : null;
export function bindingFacts(request,bytes=requestBytes(request)) {
  return {url:request.url,method:request.method,bodyPresent:bytes !== null,
    bodyBytes:bytes?.length ?? 0,bodySha256:hash(bytes ?? Buffer.alloc(0))};
}
export const requestBinding = (request,bytes) => hash(stable(bindingFacts(request,bytes)));
export function buyerConfig(value) {
  requireValue(plain(value) && plain(value.expect) && plain(value.operator) && plain(value.signer),'MPP_BUYER_PROFILE_REQUIRED');
  const payment=terms({...value.expect,amountAtomic:value.expect.maxAtomic});
  requireValue(typeof value.expect.realm === 'string' && value.expect.realm.length > 0 &&
    value.expect.realm.length <= 253 && validStrKey(value.signer.payer,'G'),'MPP_BUYER_IDENTITY_INVALID');
  const result={schema:'stellar-forge.mpp-buyer.v1',intentId:id(value.intentId),
    request:requestConfig(value.request),
    expect:{network:payment.network,currency:payment.currency,recipient:payment.recipient,
      decimals:payment.decimals,maxAtomic:payment.amountAtomic,realm:value.expect.realm,
      maxFeeStroops:atomic(value.expect.maxFeeStroops ?? '100000')},
    operator:{python:absolute(value.operator.python),ledger:absolute(value.operator.ledger),
      policy:absolute(value.operator.policy),actor:id(value.operator.actor),service:id(value.operator.service)},
    signer:{payer:value.signer.payer,keyEnv:envName(value.signer.keyEnv)},dependencyRoot:absolute(value.dependencyRoot)};
  if(value.rpcUrl !== undefined) result.rpcUrl=publicURL(value.rpcUrl).href;
  if(value.transport !== undefined) result.transport=normalizeBuyerTransport(value.transport);
  return result;
}
export function reviewChallenge(challenge,profile,{fresh=true}={}) {
  requireValue(plain(challenge) && challenge.method === 'stellar' && challenge.intent === 'charge' &&
    challenge.realm === profile.expect.realm && plain(challenge.request),'MPP_CHALLENGE_METHOD_OR_REALM_MISMATCH');
  const q=challenge.request, e=profile.expect;
  requireValue(q.methodDetails?.network === e.network && q.currency === e.currency &&
    q.recipient === e.recipient && BigInt(atomic(q.amount)) <= BigInt(e.maxAtomic),'MPP_CHALLENGE_TERMS_MISMATCH');
  requireValue(q.methodDetails?.feePayer !== true,'MPP_UNSPONSORED_PULL_REQUIRED');
  requireValue(Array.isArray(q.methodDetails?.credentialTypes) && q.methodDetails.credentialTypes.includes('transaction'),
    'MPP_PULL_CREDENTIAL_REQUIRED');
  if(fresh) {
    const expires=Date.parse(challenge.expires);
    requireValue(Number.isFinite(expires) && expires > Date.now()+5000 && expires <= Date.now()+15*60*1000,
      'MPP_CHALLENGE_EXPIRED_OR_LIFETIME_INVALID');
  }
  return clone(challenge);
}
