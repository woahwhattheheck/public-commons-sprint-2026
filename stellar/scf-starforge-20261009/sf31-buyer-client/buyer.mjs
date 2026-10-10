// MIT License. SF31 non-custodial x402 v2 buyer transport. No embedded keys or signing.
import { randomUUID, createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { isIP } from 'node:net';

const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const amount = v => typeof v === 'string' && /^(0|[1-9][0-9]*)$/.test(v);
const STELLAR_I128_MAX = '170141183460469231731687303715884105727';
const validStellarAtomic = x => typeof x==='string' && x.length<=39 && amount(x) &&
  (x.length<STELLAR_I128_MAX.length || (x.length===39 && x<=STELLAR_I128_MAX));
// x402 v2 requirements, resource and extensions are JSON objects: member order is not protocol meaning.
// Require exact structural equality (including nested fields and ordered arrays), not identical serialization order.
const same = (a,b) => isDeepStrictEqual(a,b);
const HEADER_LIMIT = 32768;

export class BuyerError extends Error {
  constructor(code, detail='', { paymentSent=false, cause }={}) {
    super(`${code}${detail ? ': '+detail : ''}`, { cause });
    this.name='BuyerError'; this.code=code; this.paymentSent=paymentSent;
  }
}
function requireURL(value,{allowLocal=false}={}) {
  let u;
  try {u=new URL(value);} catch {throw new BuyerError('BAD_URL');}
  if (u.username || u.password || u.hash) throw new BuyerError('BAD_URL');
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  const local = ['localhost','127.0.0.1','[::1]'].includes(host);
  if (u.protocol !== 'https:' && !(allowLocal && local && u.protocol==='http:')) throw new BuyerError('HTTPS_REQUIRED');
  // Discovery returns untrusted seller endpoints. Refuse address literals and
  // private DNS namespaces BEFORE making either unsigned or signed requests.
  // Explicit allowLocal is ONLY for loopback developer fixtures.
  const ipHost = host.startsWith('[') && host.endsWith(']') ? host.slice(1,-1) : host;
  const localName = ['localhost','local','localdomain','internal','home.arpa','ip6-localhost','ip6-loopback'].includes(host) ||
    ['.localhost','.localhost.localdomain','.local','.localdomain','.internal','.home.arpa'].some(s=>host.endsWith(s));
  if ((isIP(ipHost)!==0 || localName) && !(allowLocal && local))
    throw new BuyerError('UNSAFE_RESOURCE_HOST');
  return u;
}
function decodeHeader(raw, kind) {
  if (!raw || raw.length>HEADER_LIMIT || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw) || raw.length%4!==0)
    throw new BuyerError(`BAD_${kind}_HEADER`);
  let content;
  try {const buf=Buffer.from(raw,'base64');if(buf.toString('base64')!==raw)throw Error('noncanonical');content=JSON.parse(buf.toString('utf8'));}
  catch {throw new BuyerError(`BAD_${kind}_HEADER`);}
  if(!object(content))throw new BuyerError(`BAD_${kind}_HEADER`);
  return content;
}
function canonicalChallenge(challenge, requested) {
  if (challenge.x402Version!==2 || !object(challenge.resource) || !Array.isArray(challenge.accepts) || challenge.accepts.length<1 || challenge.accepts.length>32)
    throw new BuyerError('BAD_PAYMENT_REQUIRED');
  if (challenge.resource.url!==requested.href)throw new BuyerError('RESOURCE_MISMATCH');
  if (challenge.extensions!==undefined && !object(challenge.extensions))throw new BuyerError('BAD_EXTENSIONS');
  for(const pay of challenge.accepts){
    if (!object(pay) || !['exact','upto'].includes(pay.scheme) ||
      typeof pay.network!=='string' || !/^[a-z0-9]+:[A-Za-z0-9-]{1,128}$/.test(pay.network) ||
      !amount(pay.amount) || (pay.network.startsWith('stellar:') && !validStellarAtomic(pay.amount)) ||
      !pay.asset || typeof pay.asset!=='string' ||
      typeof pay.payTo!=='string' || !pay.payTo ||
      !Number.isInteger(pay.maxTimeoutSeconds) || pay.maxTimeoutSeconds<1 ||
      pay.maxTimeoutSeconds>86400 || (pay.extra!==undefined && !object(pay.extra)))
      throw new BuyerError('BAD_PAYMENT_REQUIREMENTS');
    if (pay.extra?.paymentFlow && pay.extra.paymentFlow !== 'authorization')
      throw new BuyerError('UNSUPPORTED_PAYMENT_FLOW');
  }
  return challenge;
}
function choose(challenge, expectation){
  // SF-34/35 own true usage-based 'upto'; this transport currently supports only 'exact'.
  if(expectation?.scheme && expectation.scheme!=='exact')throw new BuyerError('UNSUPPORTED_SCHEME');
  if(!object(expectation) || !expectation.network || !expectation.asset || !expectation.payTo || !expectation.maxAtomic)
    throw new BuyerError('EXPLICIT_TERMS_REQUIRED');
  if (!amount(expectation.maxAtomic))throw new BuyerError('BAD_SPEND_LIMIT');
  if (expectation.maxTimeoutSeconds!==undefined &&
      (!Number.isInteger(expectation.maxTimeoutSeconds) || expectation.maxTimeoutSeconds<1 ||
       expectation.maxTimeoutSeconds>86400))
    throw new BuyerError('BAD_TIMEOUT_LIMIT');
  const matches=challenge.accepts.filter(x=>x.scheme===(expectation.scheme??'exact') &&
    x.network===expectation.network && x.asset===expectation.asset && x.payTo===expectation.payTo &&
    BigInt(x.amount)<=BigInt(expectation.maxAtomic) &&
    (expectation.maxTimeoutSeconds===undefined ||
      x.maxTimeoutSeconds<=expectation.maxTimeoutSeconds) &&
    (!expectation.paymentFlow || (x.extra?.paymentFlow??'authorization')===expectation.paymentFlow));
  if (!matches.length)throw new BuyerError('PAYMENT_TERMS_NOT_AUTHORIZED');
  // Require a unique offered requirement. No invisible selection across nonidentical extras.
  if (matches.length!==1)throw new BuyerError('AMBIGUOUS_PAYMENT_TERMS');
  return matches[0];
}
// The policy sees the exact requirement subsequently handed to the signer.
// Freeze the full JSON value graph so an async approver cannot mutate its terms.
function immutableTerms(value){
  const copy=structuredClone(value);
  const stack=[copy];
  while(stack.length){
    const current=stack.pop();
    if(!current || typeof current!=='object' || Object.isFrozen(current))continue;
    for(const child of Object.values(current))
      if(child && typeof child==='object')stack.push(child);
    Object.freeze(current);
  }
  return copy;
}
function prepareBody(body){
  if(body==null)return undefined;
  if(typeof body==='string' && Buffer.byteLength(body)<=1_048_576)return body;
  if(body instanceof Uint8Array && body.byteLength<=1_048_576)return Uint8Array.from(body);
  throw new BuyerError('NONREPLAYABLE_BODY');
}
// Catalog responses are untrusted network input. Apply the limit to bytes actually
// received, not Content-Length (which an origin can omit or misrepresent).
const MAX_DISCOVERY_BYTES = 256 * 1024;
async function readDiscoveryJSON(response) {
  if (!response.body || typeof response.body.getReader !== 'function')
    throw new BuyerError('BAD_DISCOVERY_RESPONSE');
  // Deny an advertised over-limit body before allocating a reader. A dishonest
  // short length is still caught by the independent streaming byte count.
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null && /^[0-9]+$/.test(declaredLength) &&
      BigInt(declaredLength) > BigInt(MAX_DISCOVERY_BYTES)) {
    void response.body.cancel().catch(() => {});
    throw new BuyerError('DISCOVERY_RESPONSE_TOO_LARGE');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0, complete = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) { complete = true; break; }
      if (!(value instanceof Uint8Array)) throw new BuyerError('BAD_DISCOVERY_RESPONSE');
      total += value.byteLength;
      if (total > MAX_DISCOVERY_BYTES) throw new BuyerError('DISCOVERY_RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof BuyerError) throw e;
    throw new BuyerError('DISCOVERY_TRANSPORT_FAILED', '', { cause: e });
  } finally {
    // Cancellation is best-effort: a hostile source can leave cancel() pending
    // forever, but over-limit discovery rejection must never depend on it.
    if (!complete) { try { void reader.cancel().catch(() => {}); } catch {} }
    reader.releaseLock();
  }
  try {
    // Malformed UTF-8 must not be silently substituted in seller metadata.
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total)));
  } catch {
    throw new BuyerError('BAD_DISCOVERY_RESPONSE');
  }
}

function noRedirect(response, sent){
  if(response.status>=300&&response.status<400)throw new BuyerError('REDIRECT_DENIED','Location not followed',{paymentSent:sent});
}
function validReportedHash(network, transaction){
  if(typeof transaction!=='string')return false;
  // Stellar RPC requires 64-character lowercase hexadecimal transaction hashes.
  // This validates a seller's claim; it does not verify ledger settlement.
  return /^stellar:/i.test(network) ? /^[a-f0-9]{64}$/.test(transaction) : transaction.length>0;
}
function receiptResult(response, requirement){
  const raw=response.headers.get('payment-response');
  if(!raw)return { settlement:'UNKNOWN',receipt:null,reason:'MISSING_PAYMENT_RESPONSE' };
  let receipt;
  try{receipt=decodeHeader(raw,'PAYMENT_RESPONSE');}
  catch{return { settlement:'UNKNOWN',receipt:null,reason:'INVALID_PAYMENT_RESPONSE' };}
  if(receipt.network!==requirement.network || typeof receipt.transaction!=='string' || typeof receipt.success!=='boolean')
    return {settlement:'UNKNOWN',receipt:null,reason:'RECEIPT_MISMATCH'};
  const pending=receipt.success===false && receipt.errorReason==='settlement_pending';
  if((receipt.success===true || pending) && !validReportedHash(receipt.network,receipt.transaction))
    return {settlement:'UNKNOWN',receipt:null,reason:'INVALID_TRANSACTION_HASH'};
  if(receipt.success===true && receipt.amount!==undefined && receipt.amount!==requirement.amount)
    return {settlement:'UNKNOWN',receipt:null,reason:'SETTLED_AMOUNT_MISMATCH'};
  if(receipt.success===true && typeof receipt.errorReason==='string' && receipt.errorReason.length)
    return {settlement:'UNKNOWN',receipt:null,reason:'CONTRADICTORY_RECEIPT'};
  if(receipt.success===true)
    return {settlement:'REPORTED_SUCCESS',receipt,reason:null};
  if(pending)
    return {settlement:'PENDING',receipt,reason:'settlement_pending'};
  if(receipt.success===false && receipt.errorReason!=='settlement_pending')
    return {settlement:'REPORTED_FAILED',receipt,reason:receipt.errorReason??'PAYMENT_REJECTED'};
  return {settlement:'UNKNOWN',receipt:null,reason:'INVALID_PAYMENT_RESPONSE'};
}
function standardResult({intentId,status,resource,requirement,response,attempts,settlement,receipt,reason}){
  return { intentId,status,resource,requirement,attempts,settlement,receipt,reason,
    httpStatus:response.status, contentType:response.headers.get('content-type'),response };
}
/** Inject the official scheme signer using `sign` (no private-key custody here). Policy must approve exact signed terms. */
export class X402BuyerClient {
  constructor({fetchImpl=globalThis.fetch,allowLocal=false}={}){
    if(typeof fetchImpl!=='function')throw new TypeError('fetchImpl required');
    this.fetch=fetchImpl;this.allowLocal=allowLocal;
  }
  async discover({origin,query,filters={},limit=20,offset=0,signal}={}){
    const u=requireURL(origin,{allowLocal:this.allowLocal});
    if (!Number.isInteger(limit)||limit<1||limit>100)throw new BuyerError('BAD_DISCOVERY_LIMIT');
    if (!Number.isSafeInteger(offset)||offset<0)throw new BuyerError('BAD_DISCOVERY_OFFSET');
    // Respect a caller-selected provider deployment prefix (e.g. Coinbase CDP's
    // /platform/v2/x402) while preserving the legacy root /discovery/* routes.
    // u is already validated by requireURL; any caller query is discarded.
    const prefix=u.pathname.replace(/\/+$/,'');
    u.pathname=prefix+(query?'/discovery/search':'/discovery/resources');u.search='';
    if(query)u.searchParams.set('query',query);
    for(const [k,v] of Object.entries(filters)){
      if(!['network','scheme','payTo','type','extensions'].includes(k)||typeof v!=='string')throw new BuyerError('BAD_DISCOVERY_FILTER');
      u.searchParams.set(k,v);
    }
    u.searchParams.set('limit',String(limit));
    if(offset>0)u.searchParams.set('offset',String(offset));
    let res;
    try{res=await this.fetch(u,{method:'GET',redirect:'manual',signal});}catch(e){throw new BuyerError('DISCOVERY_TRANSPORT_FAILED','',{cause:e});}
    noRedirect(res,false);
    if(!res.ok)throw new BuyerError('DISCOVERY_HTTP_'+res.status);
    const body=await readDiscoveryJSON(res);
    if(!Array.isArray(body?.resources)||!object(body?.pagination))throw new BuyerError('BAD_DISCOVERY_RESPONSE');
    return {source:u.href,resources:body.resources,pagination:body.pagination};
  }
  /** Call protected HTTP resource. The first unsigned request and one signed retry are the ONLY sends. */
  async call({url,method='GET',body,headers={},expect,approve,sign,signal,intentId=randomUUID()}={}){
    const resource=requireURL(url,{allowLocal:this.allowLocal});
    const verb=String(method).toUpperCase();
    if(!['GET','POST','PUT','PATCH','DELETE','HEAD'].includes(verb))throw new BuyerError('BAD_METHOD');
    if(['GET','HEAD'].includes(verb)&&body!=null)throw new BuyerError('BAD_METHOD_BODY');
    if(typeof approve!=='function'||typeof sign!=='function')throw new BuyerError('APPROVAL_AND_SIGNER_REQUIRED');
    // Inspect the actual header entries sent by fetch. Headers and Map inputs
    // expose no keys via Object.keys(), despite carrying request headers.
    if(!object(headers))throw new BuyerError('FORBIDDEN_CALLER_HEADERS');
    let safeHeaders;
    try {safeHeaders=new Headers(headers);}
    catch(e){throw new BuyerError('BAD_CALLER_HEADERS','',{cause:e});}
    if([...safeHeaders.keys()].some(k=>/^(payment-signature|authorization|proxy-authorization|cookie|host)$/i.test(k)))
      throw new BuyerError('FORBIDDEN_CALLER_HEADERS');
    const data=prepareBody(body);
    if(typeof expect?.network==='string' && expect.network.startsWith('stellar:') &&
       !validStellarAtomic(expect.maxAtomic))throw new BuyerError('BAD_SPEND_LIMIT');
    const options={method:verb,headers:safeHeaders,body:data,redirect:'manual',signal};
    let first;
    try{first=await this.fetch(resource,options);}catch(e){throw new BuyerError('INITIAL_TRANSPORT_FAILED','',{cause:e});}
    noRedirect(first,false);
    if (first.status !== 402) {
      // A free 2xx response needs no payment; a non-402 HTTP failure is not
      // successful free delivery. Preserve the single unsigned attempt and
      // its original response without invoking policy or the payment signer.
      const freeSuccess = first.ok;
      return standardResult({intentId,
        status:freeSuccess ? 'NO_PAYMENT_REQUIRED' : 'UNPAID_HTTP_ERROR',
        resource:resource.href,requirement:null,response:first,attempts:1,
        settlement:'NOT_REQUESTED',receipt:null,
        reason:freeSuccess ? null : 'HTTP_'+first.status});
    }
    const challenge=canonicalChallenge(decodeHeader(first.headers.get('payment-required'),'PAYMENT_REQUIRED'),resource);
    const requirement=choose(challenge,expect);
    const acceptedTerms=immutableTerms(requirement);
    // Body identity is part of approval, including the distinction between
    // an absent body and a present zero-byte body. Never put body data in logs.
    const intent=Object.freeze({intentId,url:resource.href,method:verb,
      scheme:acceptedTerms.scheme,network:acceptedTerms.network,amount:acceptedTerms.amount,
      asset:acceptedTerms.asset,payTo:acceptedTerms.payTo,maxAtomic:expect.maxAtomic,
      maxTimeoutSeconds:acceptedTerms.maxTimeoutSeconds,acceptedTerms,
      bodyPresent:data!==undefined,
      bodyBytes:data===undefined?0:Buffer.byteLength(data),
      bodySha256:createHash('sha256').update(data??'').digest('hex')});
    const allowed=await approve(intent);
    if(allowed!==true)throw new BuyerError('PAYMENT_NOT_APPROVED');
    // External signer must use the canonical x402 SDK/scheme and return its v2 envelope;
    // this transport does not construct, authorize or fake any blockchain transaction.
    const signed=await sign({intent,challenge:structuredClone(challenge),accepted:structuredClone(acceptedTerms)});
    if(!object(signed)||signed.x402Version!==2||!object(signed.payload)||
      !same(signed.accepted,requirement)||!same(signed.resource,challenge.resource)||
      !same(signed.extensions??{},challenge.extensions??{}))throw new BuyerError('SIGNER_ENVELOPE_MISMATCH');
    const signedBytes=Buffer.from(JSON.stringify(signed));
    if(signedBytes.length>HEADER_LIMIT)throw new BuyerError('PAYMENT_SIGNATURE_TOO_LARGE');
    const paidHeaders=new Headers(safeHeaders);
    paidHeaders.set('PAYMENT-SIGNATURE',signedBytes.toString('base64'));
    // Never follow redirects with PAYMENT-SIGNATURE. Never blindly retry after it was sent.
    let paid;
    try{paid=await this.fetch(resource,{...options,headers:paidHeaders});}
    catch(e){throw new BuyerError('PAYMENT_OUTCOME_UNKNOWN','Signed request may have reached the seller',{paymentSent:true,cause:e});}
    noRedirect(paid,true);
    const {settlement,receipt,reason}=receiptResult(paid,requirement);
    const status=settlement==='REPORTED_SUCCESS'&&paid.ok?'DELIVERED_REPORTED_SETTLED'
      : settlement==='PENDING'?'SETTLEMENT_PENDING'
      : settlement==='REPORTED_FAILED'?'PAYMENT_REPORTED_FAILED'
      : 'PAYMENT_OUTCOME_UNKNOWN';
    return standardResult({intentId,status,resource:resource.href,requirement,response:paid,
      attempts:2,settlement,receipt,reason});
  }
}
