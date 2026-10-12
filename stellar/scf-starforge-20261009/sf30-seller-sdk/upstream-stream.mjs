// MIT. Streaming backend exchange for the original SF30 upstream handler.
// Request preparation, credential resolution, admission and payment stay upstream.
import { request as httpRequest, Agent as HttpAgent } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { upstreamTlsRequestOptions } from './upstream-tls/profile.mjs';
import { Transform } from 'node:stream';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';

const FORMATS = Object.freeze({sse:'text/event-stream',ndjson:'application/x-ndjson'});
const fields = new Set(['maxBytes','maxDurationMs','idleTimeoutMs']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype,null].includes(Object.getPrototypeOf(value));
const error = code => Object.assign(new Error(code),{code});
const failure = (status,code,upstreamStatus) => ({status,
  headers:{'content-type':'application/json; charset=utf-8'},
  body:{error:code,...(upstreamStatus === undefined ? {} : {upstreamStatus})}});

export function compileUpstreamStreamPolicy(value,format) {
  if (!Object.hasOwn(FORMATS,format)) throw new TypeError('Streaming upstream format must be sse or ndjson');
  if (value === undefined) value = {};
  if (!plain(value) || Object.keys(value).some(key => !fields.has(key)))
    throw new TypeError('stream accepts maxBytes, maxDurationMs and idleTimeoutMs');
  const integer = (name,fallback,max) => {
    const n = value[name] ?? fallback;
    if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new TypeError('Invalid stream.'+name);
    return n;
  };
  return Object.freeze({maxBytes:integer('maxBytes',64*1024*1024,1024*1024*1024),
    maxDurationMs:integer('maxDurationMs',60000,3600000),
    idleTimeoutMs:integer('idleTimeoutMs',10000,300000)});
}

function contentType(value,format) {
  if (typeof value !== 'string' || value.length > 8192) return false;
  const parts = value.toLowerCase().split(';').map(part => part.trim());
  if (format === 'sse' ? parts[0] !== FORMATS.sse : ![FORMATS.ndjson,'application/ndjson'].includes(parts[0])) return false;
  const charsets=parts.slice(1).filter(part => /^charset\s*=/.test(part));
  return charsets.length<=1 && charsets.every(part =>
    /^charset\s*=\s*(?:utf-8|utf8|"utf-8"|"utf8")$/.test(part));
}

/**
 * Open one already prepared backend request. Headers are returned first, while
 * its source capacity stays owned until the original response is consumed or
 * closed. The public result carries only permitted response headers and bytes.
 */
export function openUpstreamStream({target,outgoing,body,method,lookup,expose,tls,
  format,policy,headerSignal,signal,agent} = {}) {
  policy = compileUpstreamStreamPolicy(policy,format);
  if (tls !== undefined && target?.protocol !== 'https:') throw new TypeError('TLS profile requires an HTTPS upstream');
  const tlsOptions = upstreamTlsRequestOptions(tls);
  if (agent !== undefined && (!(agent instanceof HttpAgent) || agent.protocol !== target.protocol))
    throw new TypeError('Streaming upstream agent must match the configured protocol');
  return new Promise(resolve => {
    let request,response,wireStream,decoded,iterator,headerReturned=false,done=false;
    let received=0,wireBytes=0,terminalError=null,iterating=false,naturalEnd=false;
    let finishCompletion;
    const completion = new Promise(complete => {finishCompletion=complete;});
    const began = performance.now();
    const timer = setTimeout(() => stop('UPSTREAM_TIMEOUT'),policy.maxDurationMs);
    const abort = () => stop('UPSTREAM_ABORTED');
    const headerAbort = () => stop(headerSignal?.reason?.code === 'UPSTREAM_TIMEOUT' ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_ABORTED');
    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener('abort',abort);
      headerSignal?.removeEventListener('abort',headerAbort);
    }
    function releaseSource() {
      cleanup();
      // Error listeners stay installed while Node finishes an aborted socket.
      decoded?.destroy(); wireStream?.destroy(); response?.destroy(); request?.destroy();
    }
    function finalize(code=null) {
      if (done) return;
      done=true;
      terminalError=code ? error(code) : null;
      releaseSource();
      finishCompletion(Object.freeze({dispatched:!!request,status:code ? (code === 'UPSTREAM_TIMEOUT' ? 504 : code === 'UPSTREAM_ABORTED' ? 499 : 502) : 200,
        error:code,upstreamStatus:response?.statusCode ?? null,responseBytes:received,wireBytes,
        durationMs:Math.round(performance.now()-began),complete:code === null}));
    }
    function stop(code,status,upstreamStatus) {
      if (done || naturalEnd) return;
      if (!headerReturned) {
        headerReturned=true;
        const httpStatus=status ?? (code === 'UPSTREAM_TIMEOUT' ? 504 : code === 'UPSTREAM_ABORTED' ? 499 : 502);
        const result=failure(httpStatus,code,upstreamStatus);
        if (['UPSTREAM_REQUEST_FAILED'].includes(code) && [429,503].includes(upstreamStatus)) {
          const value=response?.headers['retry-after'];
          const hop=new Set(String(response?.headers.connection ?? '').split(',').map(name=>name.trim().toLowerCase()));
          if (!hop.has('retry-after') && typeof value === 'string' && value.length <= 128 &&
              (/^\d+$/.test(value) || Number.isFinite(Date.parse(value)))) result.headers['retry-after']=value;
        }
        resolve({response:result,outcome:request ? 'UNCERTAIN' : 'NOT_DISPATCHED',error:code});
      }
      finalize(code);
    }
    const close = async reason => {
      if (!done) {
        const code=typeof reason?.code === 'string' ? reason.code : '';
        const sourceFailure=(code.startsWith('RESPONSE_STREAM_') && code!=='RESPONSE_STREAM_ABORTED') ||
          ['STREAM_INCOMPLETE_RECORD','STREAM_BYTE_LIMIT_EXCEEDED','STREAM_CHUNK_LIMIT_EXCEEDED',
            'STREAM_BYTE_CHUNK_REQUIRED','STREAM_UTF8_REQUIRED','STREAM_CONTENT_TYPE_MISMATCH',
            'STREAM_BODY_MUST_BE_DECODED','INVALID_RESPONSE_STREAM','INVALID_RESPONSE_STREAM_ITERATOR'].includes(code);
        const tooLarge=['STREAM_BYTE_LIMIT_EXCEEDED','STREAM_CHUNK_LIMIT_EXCEEDED',
          'RESPONSE_STREAM_RECORD_TOO_LARGE'].includes(code);
        const timedOut=['UPSTREAM_TIMEOUT','STREAM_DURATION_EXCEEDED','STREAM_IDLE_TIMEOUT'].includes(code);
        finalize(sourceFailure ? (tooLarge ? 'UPSTREAM_RESPONSE_TOO_LARGE' : 'UPSTREAM_RESPONSE_INCOMPLETE') :
          naturalEnd ? null : timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_ABORTED');
      }
      return completion;
    };
    const source = {
      async *[Symbol.asyncIterator]() {
        if (iterating) throw error('UPSTREAM_STREAM_ALREADY_CONSUMED');
        iterating=true;
        if (done) {if (terminalError) throw terminalError;return;}
        iterator=decoded[Symbol.asyncIterator]();
        try {
          for (;;) {
            let timeout;
            const idle = new Promise((_,reject) => {
              timeout=setTimeout(() => {stop('UPSTREAM_TIMEOUT');reject(error('UPSTREAM_TIMEOUT'));},policy.idleTimeoutMs);
            });
            let next;
            try {next=await Promise.race([iterator.next(),idle]);}
            finally {clearTimeout(timeout);}
            if (terminalError) throw terminalError;
            if (next.done) {
              if (!response.complete) throw error('UPSTREAM_RESPONSE_INCOMPLETE');
              // EOF still needs the caller's record/parser finalization. Its
              // mandatory close() commits the final readiness outcome once.
              naturalEnd=true;releaseSource();return;
            }
            const chunk=next.value;
            if (!(chunk instanceof Uint8Array)) throw error('UPSTREAM_RESPONSE_INCOMPLETE');
            received+=chunk.byteLength;
            if (received>policy.maxBytes) throw error('UPSTREAM_RESPONSE_TOO_LARGE');
            yield chunk;
          }
        } catch (cause) {
          const code=terminalError?.code ?? (['UPSTREAM_RESPONSE_TOO_LARGE','UPSTREAM_TIMEOUT','UPSTREAM_ABORTED'].includes(cause?.code)
            ? cause.code : 'UPSTREAM_RESPONSE_INCOMPLETE');
          finalize(code);throw error(code);
        } finally {
          if (!done && !naturalEnd) finalize('UPSTREAM_ABORTED');
          try {await iterator.return?.();} catch { /* Original terminal outcome is retained. */ }
        }
      },
    };
    try {
      if (signal?.aborted || headerSignal?.aborted) {headerAbort();return;}
      signal?.addEventListener('abort',abort,{once:true});
      headerSignal?.addEventListener('abort',headerAbort,{once:true});
      request=(target.protocol === 'https:' ? httpsRequest : httpRequest)(target,{
        method,headers:outgoing,maxHeaderSize:16384,agent:agent ?? false,
        ...tlsOptions,
        ...(lookup === undefined ? {} : {lookup}),
      },res => {
        response=res;
        res.on('error',() => stop('UPSTREAM_RESPONSE_INCOMPLETE'));
        res.on('aborted',() => stop('UPSTREAM_RESPONSE_INCOMPLETE'));
        if (done) {res.destroy();return;}
        const status=res.statusCode;
        if (status>=300 && status<400) return stop('UPSTREAM_REDIRECT_REFUSED',502,status);
        if (status===402) return stop('UPSTREAM_PAYMENT_REQUIRED',502,status);
        if (status===401 || status===403) return stop('UPSTREAM_AUTH_FAILED',502,status);
        if (status>=400 && status<=599) return stop('UPSTREAM_REQUEST_FAILED',status,status);
        if (status!==200) return stop('UPSTREAM_STATUS_UNSUPPORTED',502,status);
        const hop=new Set(String(res.headers.connection ?? '').split(',').map(value=>value.trim().toLowerCase()));
        if (hop.has('content-type') || !contentType(res.headers['content-type'],format) ||
            res.rawHeaders.filter((name,index)=>index%2===0 && name.toLowerCase()==='content-type').length!==1)
          return stop('UPSTREAM_CONTENT_TYPE_UNEXPECTED');
        const encoding=String(res.headers['content-encoding'] ?? 'identity').trim().toLowerCase();
        if (!['identity','gzip','deflate','br'].includes(encoding) || hop.has('content-encoding'))
          return stop('UPSTREAM_ENCODING_UNSUPPORTED');
        const length=res.headers['content-length'];
        if (length!==undefined && (!/^\d+$/.test(length) || BigInt(length)>BigInt(policy.maxBytes)))
          return stop('UPSTREAM_RESPONSE_TOO_LARGE');
        const resultHeaders=Object.create(null);
        for (const name of expose) {
          const value=res.headers[name];
          if (!hop.has(name) && typeof value==='string' && value.length<=8192) resultHeaders[name]=value;
        }
        resultHeaders['content-type']=FORMATS[format]+'; charset=utf-8';
        resultHeaders['cache-control']='no-store';
        wireStream=new Transform({transform(chunk,_encoding,callback){
          wireBytes+=chunk.length;
          callback(wireBytes>policy.maxBytes ? error('UPSTREAM_RESPONSE_TOO_LARGE') : null,chunk);
        }});
        wireStream.on('error',cause=>stop(cause.code==='UPSTREAM_RESPONSE_TOO_LARGE' ? cause.code : 'UPSTREAM_RESPONSE_INCOMPLETE'));
        decoded=encoding==='identity' ? wireStream : encoding==='gzip' ? createGunzip() :
          encoding==='deflate' ? createInflate() : createBrotliDecompress();
        if (decoded!==wireStream) {
          decoded.on('error',()=>stop('UPSTREAM_RESPONSE_INCOMPLETE'));
          wireStream.pipe(decoded);
        }
        res.pipe(wireStream);
        headerReturned=true;
        headerSignal?.removeEventListener('abort',headerAbort);
        resolve({response:{status:200,headers:resultHeaders,
          stream:{format,body:source,...policy,close}},outcome:'STREAMING',completion});
      });
      request.on('error',()=>stop('UPSTREAM_UNAVAILABLE'));
      request.on('upgrade',(_res,socket)=>{socket.destroy();stop('UPSTREAM_STATUS_UNSUPPORTED');});
      request.end(body);
    } catch {stop('UPSTREAM_UNAVAILABLE');}
  });
}
