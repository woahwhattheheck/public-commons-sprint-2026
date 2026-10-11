/**
 * SF84: offline, read-only protocol intake of an operator-supplied HTTP response.
 * No network, signer, wallet, storage or payment functionality.
 * SPDX-License-Identifier: MIT
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { splitAuthenticateChallenges } from './split-auth-challenges.mjs';

const MAX_CAPTURE_BYTES = 262144;
const MAX_HEADER_BYTES = 16384;
const MAX_HEADERS = 80;
const MAX_OFFERS = 100;
const SENSITIVE = /^(?:authorization|proxy-authorization|cookie|set-cookie|payment-signature|x-api-key|x-auth-token)$/i;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

export class IntakeError extends Error {
  constructor(code) { super(code); this.name = 'IntakeError'; this.code = code; }
}

function decodeJson64(value, variant) {
  const url = variant === 'url';
  if (typeof value !== 'string' || value.length > MAX_HEADER_BYTES) throw new IntakeError('INVALID_ENCODED_PAYLOAD');
  if (url) {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new IntakeError('NONCANONICAL_BASE64URL');
  } else if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2,3})?$/.test(value)) {
    throw new IntakeError('NONCANONICAL_BASE64');
  }
  const decoded = Buffer.from(value, url ? 'base64url' : 'base64');
  if (decoded.length < 2 || decoded.toString(url ? 'base64url' : 'base64').replace(/=+$/,'') !== value.replace(/=+$/,'')) {
    throw new IntakeError('NONCANONICAL_ENCODED_PAYLOAD');
  }
  const raw = decoded.toString('utf8');
  if (!Buffer.from(raw,'utf8').equals(decoded)) throw new IntakeError('NON_UTF8_PAYLOAD');
  let obj;
  try { obj = JSON.parse(raw); } catch { throw new IntakeError('INVALID_JSON_PAYLOAD'); }
  if (!isObject(obj)) throw new IntakeError('PAYLOAD_MUST_BE_OBJECT');
  return obj;
}

function headersOf(input) {
  const source = input.headers;
  let pairs;
  if (Array.isArray(source)) {
    pairs = source;
  } else if (isObject(source)) {
    pairs = Object.entries(source).flatMap(([name, value]) => Array.isArray(value) ? value.map(v=>[name,v]) : [[name,value]]);
  } else throw new IntakeError('HEADERS_MUST_BE_OBJECT_OR_PAIRS');
  if (pairs.length > MAX_HEADERS) throw new IntakeError('TOO_MANY_HEADERS');
  const map = new Map();
  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || !/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(pair[0]) || typeof pair[1] !== 'string') {
      throw new IntakeError('INVALID_HEADER_PAIR');
    }
    const [name, value] = pair;
    if (Buffer.byteLength(value,'utf8') > MAX_HEADER_BYTES || /[\r\n\0]/.test(value)) throw new IntakeError('INVALID_HEADER_VALUE');
    if (SENSITIVE.test(name)) throw new IntakeError('CREDENTIAL_HEADER_IN_CAPTURE');
    const key = name.toLowerCase();
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  }
  return map;
}

// Parse a single RFC 9110 auth-params value. Deliberately reject incomplete,
// duplicated and malformed parameters instead of guessing where a price ends.
function parsePaymentAuth(value) {
  const prefix = /^\s*Payment(?:\s+|$)/i.exec(value);
  if (!prefix) return null;
  const params = Object.create(null);
  let pos = prefix[0].length;
  const eat = () => { while (/\s/.test(value[pos] ?? '')) pos++; };
  while (pos < value.length) {
    eat();
    if (pos >= value.length) break;
    const nameMatch = /^[!#$%&'*+.^_`|~0-9a-z-]+/i.exec(value.slice(pos));
    if (!nameMatch) throw new IntakeError('MPP_MALFORMED_PARAMETER');
    const name = nameMatch[0].toLowerCase();
    pos += nameMatch[0].length;
    eat();
    if (value[pos] !== '=') throw new IntakeError('MPP_MALFORMED_PARAMETER');
    pos++; eat();
    let val = '';
    if (value[pos] === '"') {
      pos++;
      let finished = false;
      while (pos < value.length) {
        const ch = value[pos++];
        if (ch === '"') { finished = true; break; }
        if (ch === '\\') {
          if (pos >= value.length) throw new IntakeError('MPP_BAD_QUOTE_ESCAPE');
          val += value[pos++];
        } else {
          if (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) > 126) throw new IntakeError('MPP_INVALID_QUOTED_VALUE');
          val += ch;
        }
      }
      if (!finished) throw new IntakeError('MPP_UNCLOSED_QUOTE');
    } else {
      const token = /^[!#$%&'*+.^_`|~0-9a-z-]+/i.exec(value.slice(pos));
      if (!token) throw new IntakeError('MPP_BAD_TOKEN_VALUE');
      val = token[0]; pos += val.length;
    }
    if (Object.hasOwn(params,name)) throw new IntakeError('MPP_DUPLICATE_PARAMETER');
    params[name] = val;
    eat();
    if (pos < value.length) {
      if (value[pos] !== ',') throw new IntakeError('MPP_UNEXPECTED_TRAILING_TEXT');
      pos++; eat();
      if (pos >= value.length) throw new IntakeError('MPP_TRAILING_COMMA');
    }
  }
  for (const name of ['id','realm','method','intent','request']) {
    if (!params[name]) throw new IntakeError(`MPP_MISSING_${name.toUpperCase()}`);
  }
  if (!/^[a-z]+$/.test(params.method) || !/^[a-zA-Z0-9-]+$/.test(params.intent)) {
    throw new IntakeError('MPP_INVALID_METHOD_OR_INTENT');
  }
  const request = decodeJson64(params.request,'url');
  return {
    wireSha256:hash(value),
    challengeId:params.id,
    realm:params.realm,
    method:params.method,
    intent:params.intent,
    advertisedRequest:request,
    expires:params.expires ?? null,
    hasDigest:Object.hasOwn(params,'digest'),
    hasOpaque:Object.hasOwn(params,'opaque'),
    supportedByCurrentSCFBuyer:false,
    stellarMethod:params.method === 'stellar',
    knownStellarIntent:params.method === 'stellar' && ['charge','session'].includes(params.intent),
  };
}

function parseX402(value) {
  const data = decodeJson64(value,'standard');
  if (data.x402Version !== 2 || !isObject(data.resource) || typeof data.resource.url !== 'string' || !Array.isArray(data.accepts)) {
    throw new IntakeError('X402_NOT_CANONICAL_V2_CHALLENGE');
  }
  if (data.accepts.length > MAX_OFFERS || data.accepts.length === 0) throw new IntakeError('X402_INVALID_OFFERS');
  const options = data.accepts.map((offer,index) => {
    if (!isObject(offer)) throw new IntakeError('X402_INVALID_OFFER');
    const out = {};
    for (const field of ['scheme','network','asset','payTo','amount','maxTimeoutSeconds']) {
      if (offer[field] !== undefined) {
        if (!['string','number'].includes(typeof offer[field])) throw new IntakeError('X402_INVALID_FIELD');
        out[field] = String(offer[field]);
      }
    }
    return {index, ...out, stellar:typeof offer.network === 'string' && offer.network.startsWith('stellar:'), originalOfferSha256:hash(JSON.stringify(offer))};
  });
  return {wireSha256:hash(value),resourceUrl:data.resource.url,optionCount:options.length,options,eligibleForOriginalSF31Review:true};
}

function assertCapture(input) {
  if (!isObject(input) || !Number.isInteger(input.status) || input.status < 100 || input.status > 599) throw new IntakeError('INVALID_HTTP_STATUS');
  if (input.url !== undefined && (typeof input.url !== 'string' || input.url.length > 4096)) throw new IntakeError('INVALID_CAPTURE_URL');
  if (input.method !== undefined && (typeof input.method !== 'string' || !/^[A-Z]+$/.test(input.method))) throw new IntakeError('INVALID_CAPTURE_METHOD');
}

export function inspectCapture(input,{rawBytes}={}) {
  assertCapture(input);
  const headers = headersOf(input);
  const xValues = headers.get('payment-required') ?? [];
  const authValues = headers.get('www-authenticate') ?? [];
  const mppCandidates = authValues.flatMap(splitAuthenticateChallenges).filter(h => /^\s*Payment(?:\s+|$)/i.test(h));
  const report = {
    schema:'scf.sf84.market-intake.v1',
    capturedSha256:hash(rawBytes ?? JSON.stringify(input)),
    serviceUrl:input.url ?? null,
    method:input.method ?? null,
    httpStatus:input.status,
    classification:'',
    x402:{headerCount:xValues.length,status:'absent',offer:null,error:null},
    mpp:{headerCount:mppCandidates.length,status:'absent',challenges:[],error:null},
    review:[],
  };
  if (input.status !== 402) {
    report.classification='not-http-402';
    if (xValues.length || mppCandidates.length) report.review.push('Challenge-like headers on a non-402 response require independent seller review.');
    return report;
  }
  if (xValues.length > 1) {
    report.x402.status='ambiguous';
    report.x402.error='X402_DUPLICATE_CHALLENGE_HEADERS';
  } else if (xValues.length === 1) {
    try {report.x402.offer=parseX402(xValues[0]);report.x402.status='parsed';}
    catch(e){report.x402.status='invalid';report.x402.error=e.code ?? 'X402_PARSE_FAILED';}
  }
  if (mppCandidates.length > MAX_OFFERS) {
    report.mpp.status='invalid';report.mpp.error='MPP_TOO_MANY_CHALLENGES';
  } else if (mppCandidates.length) {
    try {
      report.mpp.challenges=mppCandidates.map(parsePaymentAuth);
      const ids = report.mpp.challenges.map(c=>c.challengeId);
      if (new Set(ids).size !== ids.length) {
        report.mpp.status='ambiguous';report.mpp.error='MPP_DUPLICATE_CHALLENGE_ID';
      } else report.mpp.status='parsed';
    } catch(e){report.mpp.status='invalid';report.mpp.error=e.code ?? 'MPP_PARSE_FAILED';report.mpp.challenges=[];}
  }
  const xValid = report.x402.status === 'parsed';
  const mValid = report.mpp.status === 'parsed';
  const anyBad = ['invalid','ambiguous'].includes(report.x402.status) || ['invalid','ambiguous'].includes(report.mpp.status);
  report.classification=anyBad?'invalid-or-ambiguous-402':xValid&&mValid?'multi-protocol-402':xValid?'x402-v2-402':mValid?'mpp-402':'unrecognized-402';
  if (xValid) report.review.push('Original SF31/SF81 buyer can review these indivisible x402 v2 offers. Do not infer consent, signing or settlement.');
  if (mValid) report.review.push('MPP is a separate payment-auth protocol. Original SF31/SF81 does not verify or pay these challenges; evaluate the official @stellar/mpp implementation separately.');
  if (mValid && report.mpp.challenges.some(c=>!c.knownStellarIntent)) report.review.push('An advertised MPP method/intent is outside the documented Stellar Charge/Session implementation. Confirm the original provider support.');
  if (xValid && mValid) report.review.push('Both rails advertised. Select a single original offer and do not mix amounts, assets, recipients, methods or challenge IDs.');
  if (anyBad) report.review.push('One or more payment challenges are invalid or ambiguous: resolve the original header evidence before integrating.');
  if (!xValid && !mValid && !anyBad) report.review.push('HTTP 402 does not establish an x402 v2 or MPP payment offer without its original challenge headers.');
  report.review.push('Offline parse only: no original issuer authorization, chain observation, SDK replay or real customer purchase was performed.');
  return report;
}

export function inspectBytes(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buf.length === 0 || buf.length > MAX_CAPTURE_BYTES) throw new IntakeError('CAPTURE_SIZE_OUT_OF_BOUNDS');
  let input;
  try {input=JSON.parse(buf.toString('utf8'));} catch {throw new IntakeError('INVALID_CAPTURE_JSON');}
  if (!Buffer.from(buf.toString('utf8'),'utf8').equals(buf)) throw new IntakeError('INVALID_CAPTURE_UTF8');
  return inspectCapture(input,{rawBytes:buf});
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    if (process.argv.length !== 3 || process.argv[2].startsWith('-')) throw new IntakeError('USAGE: node inspect.mjs path-to-original-capture.json');
    const bytes = readFileSync(process.argv[2]);
    console.log(JSON.stringify(inspectBytes(bytes),null,2));
  } catch(e) {
    console.error(`SF84_INTAKE_ERROR: ${e.code ?? (e instanceof IntakeError ? e.message : 'FILE_OR_RUNTIME_ERROR')}`);
    process.exitCode=2;
  }
}
