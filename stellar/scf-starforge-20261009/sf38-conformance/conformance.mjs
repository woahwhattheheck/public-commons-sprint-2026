// MIT — SCF SF-38. Read-only, source-pinned x402 v2 Stellar wire + ledger-inclusion audit.
// No signing, RPC submit, /settle POST, wallet, or state changes in this module.
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import https from 'node:https';

export const NETWORKS = Object.freeze(['stellar:testnet','stellar:pubnet']);
export const SCHEMES = Object.freeze(['exact','upto']);
export const SOURCE = Object.freeze({
  x402Spec: 'x402-foundation/x402@f8f83309706b14cc696962f0a002eeeb66c3dc26:specs/x402-specification-v2.md#3b4631af0684748966eafcdf6a6a90a8cbbf7198',
  uptoSpec: 'x402-foundation/x402@f8f83309706b14cc696962f0a002eeeb66c3dc26:specs/schemes/upto/scheme_upto.md#202dae031d453db9cf46cd52de92c1800aee33f5',
  stellarRepo: 'stellar/x402-stellar@45d735ab3f30a50286d11286b7d7e584fa69bc77',
  fleetProfile: 'woahwhattheheck/public-commons-sprint-2026:stellar/scf-starforge-20261009/sf37-upto-interoperability/upto-profile.mjs#e5a0fd3b273aa33c16d2cf1184f6940a7ebf90d5',
});
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = x => typeof x === 'string' && x.trim().length > 0;
// Soroban integer amounts are signed i128, not arbitrary-precision decimal.
// Reject oversized wire values before BigInt conversion or ledger claims.
const MAX_STELLAR_I128_ATOMIC = '170141183460469231731687303715884105727';
const atomic = x => typeof x === 'string' && /^(0|[1-9][0-9]*)$/.test(x) &&
  (x.length < MAX_STELLAR_I128_ATOMIC.length ||
    (x.length === MAX_STELLAR_I128_ATOMIC.length && x <= MAX_STELLAR_I128_ATOMIC));
const sha = x => createHash('sha256').update(x).digest('hex');
const HASH = /^[a-f0-9]{64}$/;
const HORIZON = Object.freeze({
  'stellar:testnet': ['https://horizon-testnet.stellar.org','Test SDF Network ; September 2015'],
  'stellar:pubnet': ['https://horizon.stellar.org','Public Global Stellar Network ; September 2015'],
});
export function requireKind(network,scheme) {
  if (!NETWORKS.includes(network) || !SCHEMES.includes(scheme)) throw new TypeError('UNKNOWN_STELLAR_NETWORK_OR_SCHEME');
  return `${network}/${scheme}`;
}
function insist(ok,why) { if(!ok) throw new TypeError(why); }

/** Conformance of the actual v2 GET /supported body, not of deployment or funds. */
export function inspectSupported(response,{network,scheme}={}) {
  insist(object(response),'SUPPORTED_NOT_OBJECT');
  insist(Array.isArray(response.kinds) && Array.isArray(response.extensions) &&
    response.extensions.every(text) && object(response.signers) &&
    Object.values(response.signers).every(x=>Array.isArray(x) && x.every(text)), 'SUPPORTED_SCHEMA_INVALID');
  const seen=new Set();
  for(const k of response.kinds) {
    insist(object(k) && k.x402Version===2 && text(k.scheme) && text(k.network), 'INVALID_SUPPORTED_KIND');
    insist(/^[-a-z0-9]+:[a-zA-Z0-9-]+$/.test(k.network),'INVALID_CAIP2_NETWORK');
    insist(k.extra===undefined || object(k.extra),'INVALID_KIND_EXTRA');
    if (k.extra?.areFeesSponsored !== undefined) insist(typeof k.extra.areFeesSponsored==='boolean','BAD_FEE_SPONSORSHIP');
    const key=`${k.x402Version}/${k.scheme}/${k.network}`;
    insist(!seen.has(key),'DUPLICATE_KIND'); seen.add(key);
  }
  if (network!==undefined || scheme!==undefined) {
    requireKind(network,scheme);
  }
  return {schemaValid:true,advertised:network===undefined?null:seen.has(`2/${scheme}/${network}`),
    kinds:[...seen].sort(),extensions:[...response.extensions],
    feeSponsorClaim: network===undefined?null:(response.kinds.find(k=>k.network===network && k.scheme===scheme)?.extra?.areFeesSponsored ?? null)};
}

/** Strict request-envelope checks; not cryptographic verification. */
export function inspectRequest(phase,request,{network,scheme}={}) {
  insist(['verify','settle'].includes(phase),'UNKNOWN_PHASE');
  requireKind(network,scheme);
  insist(object(request) && request.x402Version===2 && object(request.paymentPayload) &&
    request.paymentPayload.x402Version===2 && object(request.paymentPayload.accepted) &&
    object(request.paymentPayload.payload) && object(request.paymentRequirements),'BAD_X402_V2_ENVELOPE');
  const offer=request.paymentPayload.accepted, req=request.paymentRequirements;
  for(const [tag,t] of [['accepted',offer],['requirements',req]]) {
    insist(t.scheme===scheme && t.network===network,`${tag.toUpperCase()}_SCHEME_NETWORK_DRIFT`);
    insist(atomic(t.amount) && text(t.asset) && text(t.payTo) &&
      Number.isSafeInteger(t.maxTimeoutSeconds) && t.maxTimeoutSeconds>0,
    `${tag.toUpperCase()}_PAYMENT_TERMS_INVALID`);
  }
  for(const k of ['scheme','network','asset','payTo','maxTimeoutSeconds'])
    insist(offer[k]===req[k],`PAYMENT_TERM_DRIFT_${k}`);
  const max=BigInt(offer.amount), actual=BigInt(req.amount);
  if (scheme==='exact') insist(max>0n && actual===max,'EXACT_AMOUNT_DRIFT');
  else {
    insist(max>0n && actual<=max,'UPTO_OVER_MAX');
    if (phase==='verify') insist(actual===max,'UPTO_VERIFY_REQUIRES_SIGNED_MAX');
    // Verify cannot attest a signing root or one-use auth; forward to canonical SDK.
  }
  return {phase,scheme,network,maximumAtomic:offer.amount,requestedAtomic:req.amount,
    signingVerified:false,authEntryParsed:false};
}

/** Protocol v2 response contract. Does NOT attest signer, events or ledger settlement. */
export function inspectResponse(phase,response,{network,scheme,request}={}) {
  const evidence=inspectRequest(phase,request,{network,scheme});
  insist(object(response),'RESPONSE_NOT_OBJECT');
  if(phase==='verify') {
    insist(typeof response.isValid==='boolean','VERIFY_VALIDITY_MISSING');
    if(response.isValid===false) insist(text(response.invalidReason),'VERIFY_REJECTION_REASON_MISSING');
    else insist(response.invalidReason===undefined || response.invalidReason===null,'VERIFY_SUCCESS_HAS_REJECTION_REASON');
    return {...evidence,valid:response.isValid,rejection:response.isValid?null:response.invalidReason,
      result:'WIRE_RESPONSE_ONLY'};
  }
  insist(typeof response.success==='boolean' && typeof response.transaction==='string' &&
    response.network===network,'SETTLE_RESPONSE_SCHEMA_OR_NETWORK_DRIFT');
  if(response.success) {
    insist(text(response.transaction),'SUCCESS_MISSING_TRANSACTION');
    if (response.amount!==undefined) {
      insist(atomic(response.amount),'SETTLED_AMOUNT_BAD');
      insist(response.amount===evidence.requestedAtomic,'SETTLED_AMOUNT_DIFFERS_REQUEST');
    }
    insist(response.errorReason===undefined || response.errorReason===null,'SUCCESS_HAS_ERROR_REASON');
  } else {
    insist(text(response.errorReason),'SETTLE_REJECTION_REASON_MISSING');
    if(response.errorReason==='settlement_pending') insist(text(response.transaction),'PENDING_TX_REQUIRED');
  }
  return {...evidence,valid:response.success,transaction:response.transaction,
    rejection:response.success?null:response.errorReason,result:'WIRE_RESPONSE_ONLY'};
}

/** Evidence from a separate file is always recorded, never automatically chain-verified. */
export function auditCapture(capture) {
  insist(object(capture) && capture.schema==='sf38.v1' && Array.isArray(capture.observations),
    'INVALID_CAPTURE_FORMAT');
  const entries=[], summary={};
  for(const network of NETWORKS) for(const scheme of SCHEMES)
    summary[`${network}/${scheme}`]={supportedObserved:0,verifyObserved:0,settleObserved:0,
      chainIncluded:0,claim:'UNMEASURED'};
  for(const row of capture.observations) {
    const id=String(row?.id ?? 'unknown');
    try {
      const key=requireKind(row.network,row.scheme);
      insist(['supported','verify','settle'].includes(row.phase),'INVALID_OBSERVATION_PHASE');
      const result=row.phase==='supported'
        ?inspectSupported(row.response,{network:row.network,scheme:row.scheme})
        :inspectResponse(row.phase,row.response,{network:row.network,scheme:row.scheme,request:row.request});
      const positive=row.phase==='supported'?result.advertised:result.valid;
      const field=row.phase==='supported'?'supportedObserved':row.phase==='verify'?'verifyObserved':'settleObserved';
      summary[key][field]++;
      summary[key].claim='RECORDED_WIRE_ONLY';
      entries.push({id,network:row.network,scheme:row.scheme,phase:row.phase,validWire:true,
        positive,reason:result.rejection??null,evidence:'RECORDING_NOT_CHAIN_PROOF'});
    } catch(err) {
      entries.push({id,network:row?.network??null,scheme:row?.scheme??null,
        phase:row?.phase??null,validWire:false,reason:err.message,evidence:'FAILED_WIRE_CHECK'});
    }
  }
  return {schema:'sf38.audit.v1',source:SOURCE,entries,coverage:summary,
    assertion:'Recorded response shape alone does not prove signature, original SDK interoperability or settled transfer'};
}

// Block private, loopback, link-local, documentation, reserved and mapped IPs.
// Validate ALL DNS answers, then connect to the validated answer without another
// resolver lookup, preserving TLS SNI/hostname verification for the original host.
const disallowedProbeAddress = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],
  ['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],
  ['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],
  ['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]
]) disallowedProbeAddress.addSubnet(address,prefix,'ipv4');
for (const [address, prefix] of [
  ['::',128],['::1',128],['fc00::',7],['fe80::',10],
  ['ff00::',8],['2001:db8::',32]
]) disallowedProbeAddress.addSubnet(address,prefix,'ipv6');

const mappedProbeAddress = new BlockList();
mappedProbeAddress.addSubnet('::ffff:0:0',96,'ipv6');
export function selectPublicProbeAddress(answers) {
  if (!Array.isArray(answers) || answers.length===0 ||
      answers.some(a=>![4,6].includes(a?.family) ||
        typeof a.address!=='string' ||
        disallowedProbeAddress.check(a.address,`ipv${a.family}`) ||
        (a.family===6 && mappedProbeAddress.check(a.address,'ipv6'))) {
    throw new TypeError('SUPPORTED_DNS_NONPUBLIC_OR_EMPTY');
  }
  return answers[0];
}
function checkedSupportedUrl(raw) {
  const u=new URL(raw);
  const host=u.hostname.toLowerCase().replace(/\.$/,'');
  if (u.protocol!=='https:' || u.username || u.password || u.hash || u.search || u.port ||
      isIP(host) || !host.includes('.') ||
      ['localhost','local','internal','test','invalid','example'].some(s=>
        host===s || host.endsWith('.'+s))) throw new TypeError('SUPPORTED_PUBLIC_HTTPS_ORIGIN_REQUIRED');
  // Facilitators commonly mount their API under /facilitator: preserve that
  // path while ensuring an existing /supported suffix is not duplicated.
  const prefix=u.pathname.replace(/\/+$/,'');
  const path=prefix.endsWith('/supported')?prefix:prefix+'/supported';
  return new URL(path||'/supported',u.origin).href;
}
async function pinnedSupportedGet(target,signal) {
  const u=new URL(target);
  const address=await Promise.race([
    lookup(u.hostname,{all:true,verbatim:true}).then(selectPublicProbeAddress),
    new Promise((_,reject)=>signal.addEventListener('abort',()=>
      reject(new Error('SUPPORTED_PROBE_TIMEOUT')),{once:true}))
  ]);
  return new Promise((resolve,reject)=>{
    const req=https.request(u,{
      method:'GET',signal,headers:{accept:'application/json'},
      lookup:(_host,_opts,cb)=>cb(null,address.address,address.family)
    },res=>{
      if(res.statusCode!==200) {
        res.resume();reject(new Error('SUPPORTED_HTTP_'+res.statusCode));return;
      }
      let count=0;const chunks=[];
      res.on('data',chunk=>{
        count+=chunk.length;
        if(count>262144) {res.destroy(new Error('SUPPORTED_BODY_TOO_LARGE'));return;}
        chunks.push(chunk);
      });
      res.on('error',reject);
      res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:200})));
    });
    req.on('error',reject);
    req.end();
  });
}

/** GET /supported at the supplied official facilitator path, never POST, no redirects.
 * Default live transport pins public DNS answers to its TLS connection; an
 * explicitly injected fetchImpl exists only for focused caller tests.
 */
export async function probeSupported(url,{fetchImpl,timeoutMs=12000}={}) {
  insist(Number.isSafeInteger(timeoutMs) && timeoutMs>=100 && timeoutMs<=60000,'BAD_PROBE_TIMEOUT');
  const target=checkedSupportedUrl(url);
  const signal=AbortSignal.timeout(timeoutMs);
  const response=fetchImpl
    ? await fetchImpl(target,{method:'GET',redirect:'error',signal,
        headers:{accept:'application/json'}})
    : await pinnedSupportedGet(target,signal);
  insist(response.status===200,'SUPPORTED_HTTP_'+response.status);
  // Stream bounded data; do not trust Content-Length and never store provider auth headers.
  insist(response.body && typeof response.body.getReader==='function','SUPPORTED_BODY_MISSING');
  const reader=response.body.getReader();let size=0;const chunks=[];
  try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;
    insist(size<=262144,'SUPPORTED_BODY_TOO_LARGE');chunks.push(value);}}
  finally {reader.releaseLock();}
  const raw=Buffer.concat(chunks).toString('utf8');
  const parsed=JSON.parse(raw);const checked=inspectSupported(parsed);
  return {at:new Date().toISOString(),url:target,httpStatus:200,rawSHA256:sha(raw),
    kinds:checked.kinds,extensions:checked.extensions,assertion:'REAL_GET_SUPPORTED_ONLY_NO_PAYMENT'};
}

/** Independently verify only tx inclusion against official Stellar Horizon and passphrase. */
export async function checkHorizonInclusion({network,transaction,fetchImpl=fetch,timeoutMs=12000}={}) {
  insist(NETWORKS.includes(network) && typeof transaction==='string' && HASH.test(transaction),
    'NETWORK_OR_TX_HASH_INVALID');
  const [base,passphrase]=HORIZON[network];
  const read=async url=>{const res=await fetchImpl(url,{method:'GET',redirect:'error',
    headers:{accept:'application/json'},signal:AbortSignal.timeout(timeoutMs)});
    insist(res.status===200,'HORIZON_HTTP_'+res.status);
    const length=Number(res.headers?.get('content-length')??0);
    insist(!length || length<=262144,'HORIZON_BODY_TOO_LARGE');
    const chunks=[];let bytes=0;const reader=res.body.getReader();
    try {
      while(true) {
        const {done,value}=await reader.read();
        if(done)break;
        bytes+=value.byteLength;
        insist(bytes<=262144,'HORIZON_BODY_TOO_LARGE');
        chunks.push(value);
      }
    } catch(e) {await reader.cancel().catch(()=>{});throw e;}
    finally {reader.releaseLock();}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));};
  const root=await read(base+'/');
  insist(root.network_passphrase===passphrase,'HORIZON_NETWORK_PASSPHRASE_MISMATCH');
  const tx=await read(base+'/transactions/'+transaction);
  insist(tx.hash===transaction && tx.successful===true && Number.isSafeInteger(tx.ledger) &&
    tx.ledger>0,'HORIZON_TX_NOT_SUCCESS');
  return {network,transaction,ledger:tx.ledger,createdAt:tx.created_at??null,
    evidence:'INDEPENDENT_OFFICIAL_HORIZON_TX_INCLUDED_ONLY',
    amountVerified:false,payToVerified:false,authVerified:false,
    warning:'A successful transaction alone does not prove the quoted asset/recipient/amount transferred'};
}
