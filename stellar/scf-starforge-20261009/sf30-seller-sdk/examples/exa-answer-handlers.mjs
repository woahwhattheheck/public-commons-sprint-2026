// MIT. Exa Answer product composition over the original SF30 upstream transport.
import { readUpstreamBindings, createUpstreamHandlers, closeUpstreamHandlers } from '../upstream.mjs';

const bindings = await readUpstreamBindings(process.env.EXA_ANSWER_UPSTREAMS ??
  new URL('./exa-answer-upstreams.json',import.meta.url));
const binding=bindings?.bindings?.exaAnswer;
if (Object.keys(bindings?.bindings ?? {}).length!==1 || !binding ||
    binding.origin!=='https://api.exa.ai' || binding.path!=='/answer' ||
    binding.method!=='POST' || binding.responseMode!=='sse' ||
    Object.keys(binding.headerEnv ?? {}).length!==1 || binding.headerEnv['x-api-key']!=='EXA_API_KEY' ||
    binding.oauth2!==undefined ||
    binding.query!==undefined && (!Array.isArray(binding.query) || binding.query.length!==0) ||
    binding.requestHeaders!==undefined && (!Array.isArray(binding.requestHeaders) || binding.requestHeaders.length!==0))
  throw new TypeError('Exa Answer requires the original fixed POST /answer SSE binding and server EXA_API_KEY');

const upstreams=createUpstreamHandlers(bindings,{env:{...process.env}});
const original=upstreams.exaAnswer;
const invalid=()=>({status:400,headers:{'content-type':'application/json; charset=utf-8'},
  body:{error:'INVALID_EXA_QUERY',message:'Supply only query: a nonblank string of at most 8000 UTF-8 bytes.'}});

function sourceRequest(context) {
  const input=context?.body;
  if (context?.method!=='POST' || !(context.url instanceof URL) ||
      context.url.pathname!=='/research/answer' || context.url.search!=='' ||
      context.bodyPresent===false || context.bodyType!==undefined && context.bodyType!=='json' ||
      context.multipart!==undefined && context.multipart!==null ||
      input===null || typeof input!=='object' || Array.isArray(input) ||
      ![Object.prototype,null].includes(Object.getPrototypeOf(input)) ||
      Object.keys(input).length!==1 || !Object.hasOwn(input,'query') ||
      typeof input.query!=='string' || !input.query.trim() || Buffer.byteLength(input.query,'utf8')>8000)
    throw new TypeError('Invalid Exa Answer input');
  // The public buyer cannot alter the source model, streaming mode or text policy.
  // Preserve its actual query; no prompt, location, output schema or key is added.
  const body={query:input.query,stream:true,text:false,model:'exa'};
  // Preserve the original buyer context, while every source descriptor points
  // to the same server-created JSON. Native multipart/raw-body forwarding must
  // never substitute the buyer's original query-only bytes for this source body.
  return {...context,body,bodyPresent:true,bodyType:'json',
    rawBody:Buffer.from(JSON.stringify(body),'utf8'),multipart:null};
}

/** Original admission validates the product input before native upfront payment. */
export function admitExaAnswer(context) {
  let request;
  try {request=sourceRequest(context);} catch {return invalid();}
  return original.admit?.(request) ?? true;
}

/** Invoked through the original verified seller handler path. SSE stays untouched. */
export function exaAnswer(context) {
  let request;
  try {request=sourceRequest(context);} catch {return invalid();}
  return original(request);
}
exaAnswer.admit=admitExaAnswer;
exaAnswer.snapshot=original.snapshot;

/** Private operator counters only; no query, source URL, key or event payload. */
export const snapshotExaAnswer=()=>original.snapshot();
/** Embedded hosts drain their original seller before closing these upstreams. */
export const closeExaAnswer=()=>closeUpstreamHandlers(upstreams);
