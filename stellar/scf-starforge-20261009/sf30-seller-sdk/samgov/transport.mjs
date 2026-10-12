// MIT. GSA-bound API credentials and original public HTTPS source acquisition.
import { createPublicHttpsFetch } from '../../sf31-buyer-client/public-transport.mjs';
import {
  SAM_ENDPOINT, MAX_SOURCE_BYTES, endpoint, cleanSourceUrl, validateDescriptionUrl,
  safeHeaders, integer, text, sha, instant, requireThat, SamError, now,
} from './core.mjs';

function publicReceiptUrl(value) {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()])
    if (/api[_-]?key|access[_-]?token|authorization|password|secret|signature|credential|security.token/i.test(key))
      url.searchParams.set(key, '[REDACTED]');
  return url.href;
}
function retryAt(value, receivedAt) {
  if (!value) return null;
  if (/^\d+$/.test(value)) return new Date(Date.parse(receivedAt) + Number(value) * 1000).toISOString();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
function credentialSafeBody(bytes, secret) {
  let source;
  try{source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
  catch{return {bytes,originalSha256:sha(bytes),redactions:[]};}
  const variants=secret?[...new Set([secret,encodeURIComponent(secret),JSON.stringify(secret).slice(1,-1)])]
    .filter(Boolean).sort((a,b)=>b.length-a.length):[];
  let result=source,replacements=0;
  for(const value of variants){
    const parts=result.split(value);replacements+=parts.length-1;
    if(parts.length>1)result=parts.join('[REDACTED_SAM_CREDENTIAL]');
  }
  result=result.replace(/([?&](?:api[_-]?key|access[_-]?token|authorization|password|secret)=)([^&#"'\\\s<>]+)/gi,
    (whole,prefix,value)=>{
      if(/^(?:\[REDACTED|%5BREDACTED)/i.test(value))return whole;
      replacements++;return prefix+'[REDACTED_SAM_CREDENTIAL]';
    });
  if(!replacements)return {bytes,originalSha256:sha(bytes),redactions:[]};
  return {bytes:Buffer.from(result,'utf8'),originalBytes:bytes,originalSha256:sha(bytes),
    redactions:[{kind:'credential_echo',replacements}]};
}
async function readBounded(response, limit, signal) {
  const length = response.headers.get('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > limit) {
    await response.body?.cancel().catch(()=>{});
    throw new SamError('SOURCE_TOO_LARGE', 'Original source exceeds the selected byte capacity.', 413);
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const {done,value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      requireThat(size <= limit, 'SOURCE_TOO_LARGE', 'Original source exceeds the selected byte capacity.', 413);
      chunks.push(Buffer.from(value));
    }
  } catch (error) { await reader.cancel().catch(()=>{}); throw error; }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks,size);
}
function filename(header, fallback) {
  let selected = '';
  const encoded = /(?:^|;)\s*filename\*=UTF-8''([^;]+)/i.exec(header || '');
  if (encoded) { try { selected = decodeURIComponent(encoded[1]); } catch {} }
  if (!selected) {
    const ordinary = /(?:^|;)\s*filename=(?:"([^"]*)"|([^;]*))/i.exec(header || '');
    if (ordinary) selected = ordinary[1] ?? ordinary[2];
  }
  selected = String(selected || fallback).replace(/[\\/\x00-\x1f\x7f]/g,'_').trim();
  if (!selected || selected === '.' || selected === '..') selected = 'source.bin';
  return selected.slice(0,240);
}
export function createSamTransport({
  apiKeyEnv = 'SAM_GOV_API_KEY', endpoint: selectedEndpoint = SAM_ENDPOINT,
  environment = process.env, fetchImpl, timeoutMs = 60000, maxBytes = MAX_SOURCE_BYTES,
} = {}) {
  selectedEndpoint = endpoint(selectedEndpoint);
  text(apiKeyEnv,'API key environment reference',160);
  requireThat(/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv), 'API_KEY_REFERENCE_INVALID',
    'Use an environment-variable name for the host-held SAM API key.');
  integer(timeoutMs,'Source timeout milliseconds',1000,300000);
  integer(maxBytes,'Source byte capacity',1024,MAX_SOURCE_BYTES);
  const transport = fetchImpl ?? createPublicHttpsFetch({timeoutMs});
  requireThat(typeof transport === 'function','SOURCE_TRANSPORT_INVALID');
  let closed = false;
  const active = new Set();
  const key = () => {
    const value = environment[apiKeyEnv];
    requireThat(typeof value === 'string' && value.length >= 8 && value.length <= 4096 &&
      !/[\x00-\x20\x7f]/.test(value), 'SAM_API_KEY_REQUIRED',
      'The selected host environment reference does not contain a usable SAM API key.', 409);
    return value;
  };
  function sanitizeReceipt(receipt){
    const configured=environment[apiKeyEnv],secret=typeof configured==='string' && configured.length>=8?configured:null;
    const sanitized=credentialSafeBody(receipt.body,secret),originalHeaders=safeHeaders(receipt.headers??{}),headers={};
    let headerChanges=0;
    for(const [name,value] of Object.entries(originalHeaders)){
      const selected=credentialSafeBody(Buffer.from(value,'utf8'),secret);
      headers[name]=selected.bytes.toString('utf8');
      headerChanges+=selected.redactions.reduce((sum,item)=>sum+item.replacements,0);
    }
    return {...receipt,body:sanitized.bytes,headers,
      originalSha256:receipt.originalSha256??sanitized.originalSha256,
      redactions:[...(receipt.redactions??[]),...sanitized.redactions,
        ...(headerChanges?[{kind:'credential_header_echo',replacements:headerChanges}]:[])],
      ...(receipt.privateOriginalBody||sanitized.originalBytes?
        {privateOriginalBody:receipt.privateOriginalBody??sanitized.originalBytes}:{}),
      ...(receipt.privateOriginalHeaders||headerChanges?
        {privateOriginalHeaders:receipt.privateOriginalHeaders??originalHeaders}:{})};
  }
  function describe() {
    const value = environment[apiKeyEnv];
    return {endpoint:selectedEndpoint,apiKeyEnv,keyConfigured:typeof value === 'string' && value.length >= 8 && value.length<=4096 && !/[\x00-\x20\x7f]/.test(value),
      maxBytes,timeoutMs,closed};
  }
  async function fetchSource({
    url, kind = 'search', noticeId, filename: requestedFilename,
    signal, maximumBytes = maxBytes,
  }) {
    requireThat(!closed,'SOURCE_TRANSPORT_CLOSED','Source transport is closed.',409);
    integer(maximumBytes,'Source byte capacity',1,maxBytes);
    const selected = cleanSourceUrl(url);
    requireThat(['search','description','attachment'].includes(kind),'SOURCE_KIND_INVALID');
    const original = new URL(selected), api = new URL(selectedEndpoint);
    let secret = null;
    if (kind === 'search') {
      requireThat(original.origin === api.origin && original.pathname === api.pathname,
        'SAM_SOURCE_CHANGED','Search may use only the selected original SAM v2 endpoint.');
      secret = key();
    } else if (kind === 'description') {
      validateDescriptionUrl(selected,noticeId,selectedEndpoint); secret = key();
    }
    const controller = new AbortController(); active.add(controller);
    const stop = () => controller.abort(signal.reason);
    if (signal?.aborted) controller.abort(signal.reason);
    else signal?.addEventListener('abort',stop,{once:true});
    const timer = setTimeout(()=>controller.abort(new SamError('SOURCE_TIMEOUT',
      'The original source request timed out.',504)),timeoutMs);
    const at = now(), redirects = [];
    let current = new URL(selected);
    try {
      if (secret) current.searchParams.set('api_key',secret);
      for (let redirect = 0; ; redirect++) {
        controller.signal.throwIfAborted();
        const response = await transport(current.href, {
          method:'GET',headers:{accept:kind === 'search' ? 'application/json' : '*/*',
            'accept-encoding':'identity'},redirect:'manual',signal:controller.signal,
        });
        requireThat(response && Number.isInteger(response.status) && response.headers &&
          typeof response.headers.get === 'function', 'SOURCE_TRANSPORT_RESPONSE_INVALID');
        if ([301,302,303,307,308].includes(response.status)) {
          const location = response.headers.get('location');
          await response.body?.cancel().catch(()=>{});
          requireThat(kind === 'attachment' && !secret, 'GSA_REDIRECT_REFUSED',
            'An authenticated GSA request cannot redirect its credential.',502);
          requireThat(location && redirect < 5,'SOURCE_REDIRECT_LIMIT','The attachment redirect chain is incomplete.',502);
          const next = new URL(location,current);
          // Each hop uses the original connect-time public HTTPS guard; no API
          // credential, cookies or authorization are introduced on an asset hop.
          cleanSourceUrl(next.href);
          redirects.push({status:response.status,from:publicReceiptUrl(current.href),to:publicReceiptUrl(next.href)});
          current = next; continue;
        }
        const raw = await readBounded(response,maximumBytes,controller.signal);
        const receivedAt = now(), sanitized = sanitizeReceipt({body:raw,headers:safeHeaders(response.headers)});
        const headers = sanitized.headers;
        const type = (headers['content-type'] || 'application/octet-stream').slice(0,500);
        const fallback = requestedFilename || (kind === 'search' ? 'sam-opportunities.json' :
          kind === 'description' ? String(noticeId) + '-description.html' :
          current.pathname.split('/').at(-1) || 'attachment.bin');
        return {
          request:{method:'GET',url:selected},status:response.status,startedAt:at,capturedAt:receivedAt,
          headers,redirects,finalUrl:publicReceiptUrl(current.href),mediaType:type,
          filename:filename(headers['content-disposition'],fallback),body:sanitized.body,
          originalSha256:sanitized.originalSha256,redactions:sanitized.redactions,
          ...(sanitized.privateOriginalBody?{privateOriginalBody:sanitized.privateOriginalBody}:{}),
          ...(sanitized.privateOriginalHeaders?{privateOriginalHeaders:sanitized.privateOriginalHeaders}:{}),
          retryAt:retryAt(headers['retry-after'],receivedAt),
        };
      }
    } catch (error) {
      if (controller.signal.aborted) throw new SamError(
        signal?.aborted ? 'SOURCE_CANCELLED' : 'SOURCE_TIMEOUT',
        signal?.aborted ? 'The operator paused the original source request.' : 'The original source request timed out.',
        signal?.aborted ? 409 : 504);
      if (error instanceof SamError) throw error;
      // Native transport errors may include the authenticated URL in cause.
      // Keep its machine-readable class, never provider URL/cause text.
      const code = typeof error.code === 'string' && /^[A-Z0-9_]{1,100}$/.test(error.code) ?
        error.code : 'SOURCE_REQUEST_FAILED';
      throw new SamError(code,'The original source request failed (' + code + ').',502);
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort',stop); active.delete(controller);
      secret = null;
    }
  }
  async function close() {
    closed = true;
    for (const controller of active) controller.abort(new SamError('SOURCE_CANCELLED'));
  }
  return Object.freeze({describe,fetchSource,sanitizeReceipt,close});
}

