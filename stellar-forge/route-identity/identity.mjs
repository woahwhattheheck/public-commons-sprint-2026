/**
 * Stellar Forge SF-28 - x402 Bazaar route and resource identity.
 * Pure, dependency-free catalog-ingestion guard, not a payment verifier.
 * Baseline: x402-foundation/x402@7f2b2f1f77fa5317615735e3378a6fad41cccb4e
 * specs/extensions/bazaar.md blob 442708e76d5a129e0c1393471d8ed71e3604c94e.
 * Upstream already fixes multi-encoded traversal (TS #3213, Go #3441).
 */
const RAW_TEMPLATE = /^\/[A-Za-z0-9_/:.\-~%]+$/;
const DECODED_TEMPLATE = /^\/[A-Za-z0-9_/:.\-~]+$/;
const PARAM = /^:([A-Za-z_][A-Za-z0-9_]*)$/;
const METHODS = new Set(['GET','HEAD','DELETE','POST','PUT','PATCH']);
const fail = reason => ({ok:false,reason});

/** Align five bounded decoding passes with the pinned TS/Go source. */
function fixedDecode(raw) {
  let value = raw;
  for (let pass=0; pass<5; pass++) {
    let next;
    try { next=decodeURIComponent(value); }
    catch { return fail('INVALID_PERCENT_ENCODING'); }
    if(next === value) return {ok:true,value};
    value=next;
  }
  return fail('ENCODING_DEPTH_EXCEEDED');
}

/** Stricter catalog key policy layered after the canonical SDK validator. */
export function inspectRouteTemplate(value) {
  if(typeof value!=='string'||!value) return fail('TEMPLATE_MISSING');
  if(value.length>2048) return fail('TEMPLATE_TOO_LONG');
  if(!value.startsWith('/')) return fail('TEMPLATE_NOT_ABSOLUTE');
  if(!RAW_TEMPLATE.test(value)) return fail('TEMPLATE_UNSAFE_CHAR');
  const decoded=fixedDecode(value);
  if(!decoded.ok) return fail('TEMPLATE_'+decoded.reason);
  const path=decoded.value;
  if(path.includes('..')) return fail('TEMPLATE_TRAVERSAL');
  if(path.includes('://')) return fail('TEMPLATE_SCHEME_INJECTION');
  if(!DECODED_TEMPLATE.test(path)) return fail('TEMPLATE_DECODED_UNSAFE_CHAR');
  if(value.split('/').length!==path.split('/').length) return fail('TEMPLATE_ENCODED_SEPARATOR');
  const names=new Set();
  for(const part of path.slice(1).split('/')) {
    if(!part||part==='.') return fail('TEMPLATE_AMBIGUOUS_SEGMENT');
    if(!part.includes(':')) continue;
    const match=PARAM.exec(part);
    if(!match) return fail('TEMPLATE_PARAM_SYNTAX');
    if(names.has(match[1])) return fail('TEMPLATE_DUPLICATE_PARAM');
    names.add(match[1]);
  }
  return {ok:true,canonicalPath:path,paramNames:[...names]};
}

/** Inspect the original URL before WHATWG URL can normalize away dot segments. */
export function inspectResourceURL(input) {
  if(typeof input!=='string'||!input) return fail('RESOURCE_URL_MISSING');
  if(input.length>4096) return fail('RESOURCE_URL_TOO_LONG');
  if(/[\x00-\x20\x7f\\]/.test(input)) return fail('RESOURCE_URL_UNSAFE_CHAR');
  const prefix=/^https?:\/\/([^/?#]*)/i.exec(input);
  if(!prefix) return fail('RESOURCE_URL_SCHEME');
  if(prefix[1].includes('@')) return fail('RESOURCE_URL_USERINFO');
  if(input.includes('#')) return fail('RESOURCE_URL_FRAGMENT');
  const rawPath=input.slice(prefix[0].length).split(/[?#]/,1)[0]||'/';
  if(!rawPath.startsWith('/')) return fail('RESOURCE_PATH_NOT_ABSOLUTE');
  for(const segment of rawPath.split('/')) {
    if(!segment) continue;
    let value=segment;
    for(let pass=0;pass<5;pass++) {
      let next;
      try { next=decodeURIComponent(value); }
      catch { return fail('RESOURCE_PATH_PERCENT_ENCODING'); }
      if(next==='.'||next==='..') return fail('RESOURCE_PATH_DOT_SEGMENT');
      if(next.includes('/')||next.includes('\\')) return fail('RESOURCE_PATH_ENCODED_SEPARATOR');
      if(next===value) break;
      value=next;
      if(pass===4) return fail('RESOURCE_PATH_ENCODING_DEPTH');
    }
  }
  let url;
  try { url=new URL(input); } catch { return fail('RESOURCE_URL_INVALID'); }
  if(!['http:','https:'].includes(url.protocol)) return fail('RESOURCE_URL_SCHEME');
  if(!url.hostname) return fail('RESOURCE_URL_HOST');
  if(url.username||url.password) return fail('RESOURCE_URL_USERINFO');
  return {ok:true,canonicalURL:url.href,url};
}

/** Bind a real resource path and optional echoed parameter claims to a template. */
function bindPath(template, actual, claimed) {
  const parts=template.split('/'), values=actual.split('/');
  if(parts.length!==values.length) return fail('TEMPLATE_PATH_MISMATCH');
  const bindings={};
  for(let i=1;i<parts.length;i++) {
    let value;
    try { value=decodeURIComponent(values[i]); }
    catch { return fail('RESOURCE_PATH_PERCENT_ENCODING'); }
    if(value.includes('/')||value.includes('\\')||value==='.'||value==='..') {
      return fail('RESOURCE_PATH_ENCODED_SEPARATOR');
    }
    const p=PARAM.exec(parts[i]);
    if(p) {
      if(!value) return fail('TEMPLATE_EMPTY_PARAM');
      bindings[p[1]]=value;
    } else if(value!==parts[i]) {
      return fail('TEMPLATE_PATH_MISMATCH');
    }
  }
  if(claimed!==undefined) {
    if(claimed===null||Array.isArray(claimed)||typeof claimed!=='object') {
      return fail('TEMPLATE_PARAMS_INVALID');
    }
    const want=Object.keys(bindings).sort(),got=Object.keys(claimed).sort();
    if(JSON.stringify(want)!==JSON.stringify(got)) return fail('TEMPLATE_PARAMS_MISMATCH');
    for(const key of want) if(String(claimed[key])!==bindings[key]) {
      return fail('TEMPLATE_PARAMS_MISMATCH');
    }
  }
  return {ok:true,bindings};
}

/**
 * Input: {resourceURL, input:{type:'http',method,pathParams?} or
 * input:{type:'mcp',toolName}, routeTemplate?}.
 * Outputs an implementation-private catalogKey, NOT authentication.
 * Independently verify seller, payTo, schema, settlement before any write.
 */
export function resolveCatalogIdentity(record) {
  if(!record||typeof record!=='object') return {status:'rejected',reason:'RECORD_INVALID'};
  const resource=inspectResourceURL(record.resourceURL);
  if(!resource.ok) return {status:'rejected',reason:resource.reason};
  if(!record.input||typeof record.input!=='object') return {status:'rejected',reason:'INPUT_MISSING'};
  const {canonicalURL,url}=resource;
  if(record.input.type==='mcp') {
    const name=record.input.toolName;
    if(typeof name!=='string'||!/^[A-Za-z0-9_.\-]{1,128}$/.test(name)) {
      return {status:'rejected',reason:'MCP_TOOL_NAME_INVALID'};
    }
    return {status:'accepted',kind:'mcp',resourceURL:canonicalURL,
      catalogKey:'mcp|'+canonicalURL+'|'+name,toolName:name};
  }
  if(record.input.type!=='http'||!METHODS.has(record.input.method)) {
    return {status:'rejected',reason:'HTTP_METHOD_INVALID'};
  }
  const method=record.input.method;
  const concrete={status:'accepted',kind:'http',resourceURL:canonicalURL,
    catalogKey:'http|'+method+'|'+canonicalURL,method};
  if(record.routeTemplate===undefined||record.routeTemplate===null) return concrete;
  const template=inspectRouteTemplate(record.routeTemplate);
  if(!template.ok) return {...concrete,status:'fallback',reason:template.reason};
  const matched=bindPath(template.canonicalPath,url.pathname,record.input.pathParams);
  if(!matched.ok) return {...concrete,status:'fallback',reason:matched.reason};
  const keyURL=url.origin+template.canonicalPath;
  return {status:'accepted',kind:'http',resourceURL:keyURL,
    catalogKey:'http|'+method+'|'+keyURL,method,
    canonicalRouteTemplate:template.canonicalPath,pathParams:matched.bindings};
}
