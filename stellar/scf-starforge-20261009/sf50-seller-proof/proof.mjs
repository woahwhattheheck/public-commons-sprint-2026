// MIT License. Seller-origin + payment-quote proof for x402 v2 Bazaar.
// This is NOT Stellar wallet ownership, payment verification or settlement.
import {createPrivateKey, createPublicKey, randomBytes, sign, verify} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import {BlockList, isIP} from 'node:net';
import https from 'node:https';

export const PROOF_DOMAIN = 'stellar-bazaar-seller-origin-quote-proof/v1';
export const WELL_KNOWN = '/.well-known/x402-bazaar-proof';
const METHODS = new Set(['GET', 'HEAD', 'DELETE', 'POST', 'PUT', 'PATCH']);
const MAX_LIFETIME_MS = 120_000;
const CLOCK_SKEW_MS = 5_000;
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes base64url
const ACCEPTS_RE = /^\d+$/; // x402 atomic amount string; no floating point conversions
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);

function nonEmpty(v, field) {
  if (typeof v !== 'string' || !v.trim() || v.length > 2048) throw new TypeError(`Invalid ${field}`);
  return v;
}
function checkedUrl(raw) {
  const s = nonEmpty(raw, 'resource.url');
  let u;
  try {u = new URL(s);} catch {throw new TypeError('Invalid resource.url URL');}
  if (u.protocol !== 'https:' || u.username || u.password || u.hash || !u.hostname || u.port) {
    throw new TypeError('resource.url must be public-style HTTPS without credentials, fragment or nonstandard port');
  }
  // Refuse an URL-equivalent signed spelling mismatch (normalization risks).
  if (u.href !== s) throw new TypeError('resource.url must be canonical absolute HTTPS');
  return u;
}
function quoteOf(entry, selectedAccept = 0) {
  if (!plain(entry) || entry.x402Version !== 2 || !Array.isArray(entry.accepts)) {
    throw new TypeError('Expected original x402 v2 PaymentRequired/Bazaar listing');
  }
  const resourceUrl = typeof entry.resource === 'string' ? entry.resource : entry.resource?.url;
  const url = checkedUrl(resourceUrl);
  const input = entry.extensions?.bazaar?.info?.input;
  if (!plain(input)) throw new TypeError('Missing Bazaar info.input');
  let identity;
  if (input.type === 'http' && METHODS.has(input.method)) {
    identity = {type:'http', method:input.method, toolName:null};
  } else if (input.type === 'mcp' && typeof input.toolName === 'string' && input.toolName.trim() && plain(input.inputSchema)) {
    identity = {type:'mcp', method:null, toolName:input.toolName};
  } else throw new TypeError('Invalid Bazaar HTTP/MCP identity');
  if (!Number.isSafeInteger(selectedAccept) || selectedAccept < 0 || selectedAccept >= entry.accepts.length) {
    throw new RangeError('Invalid accepts selection');
  }
  const a = entry.accepts[selectedAccept];
  if (!plain(a) || !ACCEPTS_RE.test(a.amount ?? '') || a.amount.length > 100) {
    throw new TypeError('Missing atomic-string accepts.amount');
  }
  const quote = {
    scheme:nonEmpty(a.scheme,'accepts.scheme'),
    network:nonEmpty(a.network,'accepts.network'),
    asset:nonEmpty(a.asset,'accepts.asset'),
    amount:a.amount,
    payTo:nonEmpty(a.payTo,'accepts.payTo')
  };
  return {origin:url.origin,resourceUrl:url.href,identity,selectedAccept,quote};
}

export function createChallenge() {return randomBytes(32).toString('base64url');}
function validateChallenge(nonce) {
  if (typeof nonce !== 'string' || !CHALLENGE_RE.test(nonce)) throw new TypeError('Expected 32-byte base64url verifier nonce');
  if (Buffer.from(nonce,'base64url').length !== 32) throw new TypeError('Malformed nonce');
}
function checkedTimes(issuedAt,expiresAt,now) {
  if (![issuedAt,expiresAt,now].every(Number.isSafeInteger) || expiresAt <= issuedAt ||
      expiresAt - issuedAt > MAX_LIFETIME_MS || issuedAt > now + CLOCK_SKEW_MS ||
      expiresAt <= now - CLOCK_SKEW_MS) throw new RangeError('Proof expired, issued in future, or lifetime too long');
}
export function statementFor(entry,{nonce,issuedAt,expiresAt,selectedAccept=0}={}) {
  validateChallenge(nonce);
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt)) throw new TypeError('Expected integer millisecond timestamps');
  const {origin,resourceUrl,identity,quote} = quoteOf(entry,selectedAccept);
  // Ordered, fixed-shape JSON is the signature preimage. Never sign arbitrary incoming objects.
  return {domain:PROOF_DOMAIN,origin,resourceUrl,identity,selectedAccept,quote,nonce,issuedAt,expiresAt};
}
function keyToB64(publicKey) {
  const k = publicKey?.type === 'public' ? publicKey : createPublicKey(publicKey);
  if (k.asymmetricKeyType !== 'ed25519') throw new TypeError('Ed25519 key required');
  return k.export({format:'der',type:'spki'}).toString('base64url');
}
function keyFromB64(raw) {
  if (typeof raw !== 'string' || raw.length > 256 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new TypeError('Invalid SPKI encoding');
  const key = createPublicKey({key:Buffer.from(raw,'base64url'),format:'der',type:'spki'});
  if (key.asymmetricKeyType !== 'ed25519') throw new TypeError('Ed25519 public key required');
  if (keyToB64(key) !== raw) throw new TypeError('Noncanonical key encoding');
  return key;
}
export function signProof(entry,{nonce,privateKeyPem,selectedAccept=0,now=Date.now(),lifetimeMs=30_000}={}) {
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(lifetimeMs) || lifetimeMs < 1000 || lifetimeMs > MAX_LIFETIME_MS) {
    throw new RangeError('Invalid proof issuance time or lifetime');
  }
  const privateKey=privateKeyPem?.type === 'private' ? privateKeyPem : createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new TypeError('Ed25519 private key required');
  const statement=statementFor(entry,{nonce,selectedAccept,issuedAt:now,expiresAt:now+lifetimeMs});
  const publicKey=keyToB64(privateKey);
  const signature=sign(null,Buffer.from(JSON.stringify(statement),'utf8'),privateKey).toString('base64url');
  return {statement,publicKey,signature};
}

/** Verify against an OUT-OF-BAND PINNED key. Do not pass proof.publicKey as the pin. */
export function verifyPinnedProof(entry,proof,{nonce,pinnedPublicKey,now=Date.now(),selectedAccept=0}={}) {
  if (!plain(proof) || !plain(proof.statement) || typeof proof.signature !== 'string' || !pinnedPublicKey) {
    throw new TypeError('Proof, signature and independent key pin required');
  }
  validateChallenge(nonce);
  checkedTimes(proof.statement.issuedAt,proof.statement.expiresAt,now);
  const expected = statementFor(entry,{nonce,selectedAccept,issuedAt:proof.statement.issuedAt,expiresAt:proof.statement.expiresAt});
  const canonical = JSON.stringify(expected);
  // Strict exact-shape equality detects silent ignored/additional/unbound fields.
  if (JSON.stringify(proof.statement) !== canonical) throw new Error('Proof statement differs from original resource and quote');
  const key = keyFromB64(proof.publicKey);
  if (keyToB64(pinnedPublicKey) !== proof.publicKey) throw new Error('Seller signing key differs from independent pin');
  const raw=Buffer.from(proof.signature,'base64url');
  if (raw.length !== 64 || raw.toString('base64url') !== proof.signature ||
      !verify(null,Buffer.from(canonical,'utf8'),key,raw)) throw new Error('Invalid seller proof signature');
  return {verified:true,trust:'pinned-ed25519-key',origin:expected.origin,resourceUrl:expected.resourceUrl,
    identity:expected.identity,quote:expected.quote,expiresAt:expected.expiresAt};
}

// Public-address-only DNS pin; HTTPS request uses the vetted answer for this connection.
const rejected = new BlockList();
for (const [ip,prefix] of [
  ['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],
  ['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],
  ['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]
]) rejected.addSubnet(ip,prefix,'ipv4');
for (const [ip,prefix] of [
  ['::',128],['::1',128],['fc00::',7],['fe80::',10],['ff00::',8],
  ['2001:db8::',32],['::ffff:0:0',96]
]) rejected.addSubnet(ip,prefix,'ipv6');
function safeDnsHost(host) {
  const h=host.toLowerCase().replace(/\.$/,'');
  if (isIP(h) || h==='localhost' || h.endsWith('.localhost') || h.endsWith('.local') ||
      h.endsWith('.internal') || h.endsWith('.test') || h.endsWith('.invalid') || h.endsWith('.example') ||
      !h.includes('.')) throw new TypeError('Seller origin must have a public DNS hostname');
}
async function publicAddress(host) {
  safeDnsHost(host);
  const addresses=await lookup(host,{all:true,verbatim:true});
  if (!addresses.length) throw new Error('No seller DNS answers');
  // Reject mixed public/private answer sets, not just the first chosen address.
  for (const a of addresses) if (![4,6].includes(a.family) || rejected.check(a.address,`ipv${a.family}`)) {
    throw new Error('Seller DNS resolved to a non-public address');
  }
  return addresses[0];
}

/**
 * Retrieve per-challenge proof from the seller's ACTUAL HTTPS origin.
 * Only this origin HTTPS/TLS observation can establish DNS-domain control.
 * It does NOT establish Stellar account control, merchant legality or settlement.
 */
export async function fetchOriginProof(entry,{nonce,timeoutMs=5000}={}) {
  validateChallenge(nonce);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 15000) throw new RangeError('Invalid timeout');
  const {origin}=quoteOf(entry);
  const url=new URL(origin);
  // One absolute deadline covers DNS, TLS handshake and the full response body.
  // Socket idle timeouts alone can be defeated by a trickling response; and DNS
  // resolution can hang before a request-level timeout would even be installed.
  const deadline=AbortSignal.timeout(timeoutMs);
  const timedOut=new Promise((_,reject)=>{
    deadline.addEventListener('abort',()=>reject(new Error('Seller proof exceeded DNS/TLS/response deadline')), {once:true});
  });
  const pinned=await Promise.race([publicAddress(url.hostname),timedOut]);
  const path=`${WELL_KNOWN}?nonce=${encodeURIComponent(nonce)}`;
  return await new Promise((resolve,reject)=>{
    const req=https.request({protocol:'https:',hostname:url.hostname,port:443,path,method:'GET',
      signal:deadline,
      headers:{accept:'application/json','user-agent':'StellarBazaarSellerProof/1'},
      lookup:(_hostname,_options,cb)=>cb(null,pinned.address,pinned.family)},res=>{
      if (res.statusCode!==200) {res.resume();reject(new Error(`Seller origin returned HTTP ${res.statusCode}`));return;}
      const type=String(res.headers['content-type']||'').toLowerCase();
      if (!/^application\/json(?:\s*;|$)/.test(type)) {res.resume();reject(new Error('Seller proof must be JSON'));return;}
      const chunks=[];let count=0;
      res.on('data',chunk=>{count+=chunk.length;if(count>65536){res.destroy(new RangeError('Seller proof exceeds 64 KiB'));return;}chunks.push(chunk);});
      res.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch(e){reject(e);}});
      res.on('error',reject);
    });
    // The AbortSignal owns the hard wall clock timeout for this request.
    req.on('error',reject);req.end();
  });
}
/** Verification of fresh signed data fetched from exact seller HTTPS origin. */
export async function verifyOriginProof(entry,{nonce,now=Date.now(),selectedAccept=0,timeoutMs=5000}={}) {
  const proof=await fetchOriginProof(entry,{nonce,timeoutMs});
  // Here the seller key is pinned to the HTTPS origin observation itself.
  const pinnedPublicKey=keyFromB64(proof?.publicKey);
  const result=verifyPinnedProof(entry,proof,{nonce,pinnedPublicKey,now,selectedAccept});
  return {...result,trust:'seller-https-origin-and-ed25519',publicKey:proof.publicKey};
}
