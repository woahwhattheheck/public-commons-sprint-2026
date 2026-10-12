// MIT. Incoming OAuth resource authorization for the original MCP HTTP transport.
import { createRemoteJWKSet, customFetch, decodeJwt, decodeProtectedHeader, jwtVerify } from 'jose';
import { createPublicHttpsFetch } from '../../stellar/scf-starforge-20261009/sf31-buyer-client/public-transport.mjs';

export const OAUTH_RESOURCE_SCHEMA = 'stellar-forge.mcp-oauth-resource.v1';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const scopePattern = /^[\x21\x23-\x5b\x5d-\x7e]+$/;
const toolPattern = /^[-A-Za-z0-9_.]{1,128}$/;
const algorithms = new Set(['RS256','RS384','RS512','PS256','PS384','PS512','ES256','ES384','ES512','EdDSA']);
const defaults = Object.freeze({clockToleranceSeconds:30,jwksTimeoutMs:5000,jwksCacheMaxAgeMs:300000,
  jwksCooldownMs:30000,maxJwksBytes:262144,maxTokenBytes:16384});
const configKeys = new Set(['schema','resource','authorizationServers','requiredScopes','toolScopes',
  'scopesSupported',...Object.keys(defaults)]);
const issuerKeys = new Set(['issuer','jwksUri','algorithms','tokenTypes','scopeClaim','allowedSubjects']);

function text(value, name, max=2048) {
  if (typeof value !== 'string' || !value || value.length > max || /[\x00-\x20\x7f]/.test(value))
    throw new TypeError(name + ' must be nonempty text without whitespace or control characters');
  return value;
}
function exactHttps(value, name, {query=false}={}) {
  text(value,name);
  let url; try { url = new URL(value); } catch { throw new TypeError(name + ' must be an absolute HTTPS URI'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (!query && url.search))
    throw new TypeError(name + ' requires HTTPS without credentials, a fragment or a query');
  // URL parsing checks syntax; the configured issuer/audience string is not normalized.
  return value;
}
function unique(values, name, check, max=128) {
  if (!Array.isArray(values) || values.length > max) throw new TypeError(name + ' must be an array');
  const result = values.map(value => check(value,name));
  if (new Set(result).size !== result.length) throw new TypeError(name + ' contains duplicate entries');
  return result;
}
function scopes(values, name) {
  return unique(values,name,(value,label) => {
    text(value,label,256);
    if (!scopePattern.test(value) || value === 'offline_access')
      throw new TypeError(label + ' must contain resource scope tokens; offline_access belongs to the authorization server');
    return value;
  });
}
function integer(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new TypeError(name + ' must be an integer in ' + min + '..' + max);
  return value;
}
function frozen(value) {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) frozen(item); Object.freeze(value); }
  return value;
}
const normalizedType = value => String(value).toLowerCase().replace(/^application\//,'');
const allScopes = (base, extra=[]) => [...new Set([...base,...extra])];

/** Validate trusted host configuration without discovery or an authorization request. */
export function validateOAuthResourceConfig(input) {
  if (!plain(input) || input.schema !== OAUTH_RESOURCE_SCHEMA ||
      Object.keys(input).some(key => !configKeys.has(key)))
    throw new TypeError('Use the explicit ' + OAUTH_RESOURCE_SCHEMA + ' configuration');
  const resource = exactHttps(input.resource,'resource');
  if (!Array.isArray(input.authorizationServers) || !input.authorizationServers.length || input.authorizationServers.length > 8)
    throw new TypeError('Configure one to eight explicit authorization servers');
  const servers = input.authorizationServers.map((server,index) => {
    const name = 'authorizationServers[' + index + ']';
    if (!plain(server) || Object.keys(server).some(key => !issuerKeys.has(key))) throw new TypeError('Invalid ' + name);
    const issuer = exactHttps(server.issuer,name + '.issuer');
    const jwksUri = exactHttps(server.jwksUri,name + '.jwksUri',{query:true});
    const selected = unique(server.algorithms ?? ['RS256'],name + '.algorithms',(value,label) => {
      if (!algorithms.has(value)) throw new TypeError(label + ' requires public-key signature algorithms');
      return value;
    },16);
    const tokenTypes = unique(server.tokenTypes ?? ['at+jwt'],name + '.tokenTypes',(value,label) => {
      text(value,label,128);
      if (!/^(?:application\/)?[-a-z0-9!#$&^_.+]+$/i.test(value)) throw new TypeError('Invalid ' + label);
      return value;
    },8);
    if (!selected.length || !tokenTypes.length) throw new TypeError('Select algorithms and explicit access-token types');
    const scopeClaim = server.scopeClaim ?? 'scope';
    if (!['scope','scp'].includes(scopeClaim)) throw new TypeError(name + '.scopeClaim must be scope or scp');
    const allowedSubjects = unique(server.allowedSubjects ?? [],name + '.allowedSubjects',(value,label) => text(value,label,1024),1024);
    return {issuer,jwksUri,algorithms:selected,tokenTypes,scopeClaim,allowedSubjects};
  });
  if (new Set(servers.map(server => server.issuer)).size !== servers.length) throw new TypeError('Authorization-server issuers must be unique');
  const requiredScopes = scopes(input.requiredScopes ?? [],'requiredScopes');
  const scopesSupported = scopes(input.scopesSupported ?? requiredScopes,'scopesSupported');
  if (!plain(input.toolScopes ?? {}) || Object.keys(input.toolScopes ?? {}).length > 2048)
    throw new TypeError('toolScopes must map exact tool names to required scopes');
  const toolScopes = Object.fromEntries(Object.entries(input.toolScopes ?? {}).map(([name,values]) => {
    if (!toolPattern.test(name)) throw new TypeError('Invalid tool name in toolScopes');
    return [name,scopes(values,'toolScopes.' + name)];
  }));
  return {schema:OAUTH_RESOURCE_SCHEMA,resource,authorizationServers:servers,requiredScopes,toolScopes,scopesSupported,
    clockToleranceSeconds:integer(input.clockToleranceSeconds ?? defaults.clockToleranceSeconds,'clockToleranceSeconds',0,300),
    jwksTimeoutMs:integer(input.jwksTimeoutMs ?? defaults.jwksTimeoutMs,'jwksTimeoutMs',1,60000),
    jwksCacheMaxAgeMs:integer(input.jwksCacheMaxAgeMs ?? defaults.jwksCacheMaxAgeMs,'jwksCacheMaxAgeMs',1000,3600000),
    jwksCooldownMs:integer(input.jwksCooldownMs ?? defaults.jwksCooldownMs,'jwksCooldownMs',0,300000),
    maxJwksBytes:integer(input.maxJwksBytes ?? defaults.maxJwksBytes,'maxJwksBytes',1024,1048576),
    maxTokenBytes:integer(input.maxTokenBytes ?? defaults.maxTokenBytes,'maxTokenBytes',1024,65536)};
}

/** RFC9728 path insertion. No Host or forwarded header determines this URI. */
export function resourceMetadataLocation(resource) {
  exactHttps(resource,'resource');
  const url = new URL(resource), path = url.pathname === '/' ? '' : url.pathname;
  const metadataPath = '/.well-known/oauth-protected-resource' + path;
  return {resource,metadataUrl:url.origin + metadataPath,metadataPath};
}

export class OAuthResourceError extends Error {
  constructor(status, code, message, required=[]) {
    super(message); this.name='OAuthResourceError'; this.status=status; this.code=code;
    this.requiredScopes=Object.freeze([...required]);
  }
}
const unavailable = () => new OAuthResourceError(503,'temporarily_unavailable','Authorization service is temporarily unavailable');
const invalidToken = () => new OAuthResourceError(401,'invalid_token','The access token is invalid or expired');

function requestTarget(req) {
  if (typeof req?.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//') || /[\x00-\x20\x7f]/.test(req.url))
    throw new OAuthResourceError(400,'invalid_request','Use an origin-form request target');
  return new URL(req.url,'https://request.invalid');
}
function tokenFrom(req,maxBytes) {
  const target = requestTarget(req);
  if (target.searchParams.has('access_token')) throw new OAuthResourceError(400,'invalid_request','Send the access token only in the Authorization header');
  const raw = req.rawHeaders ?? [];
  if (!Array.isArray(raw) || raw.filter((value,index) => index % 2 === 0 && String(value).toLowerCase() === 'authorization').length > 1)
    throw new OAuthResourceError(400,'invalid_request','Send exactly one Authorization header');
  const value = req.headers?.authorization;
  if (value === undefined) throw new OAuthResourceError(401,'authorization_required','Authorization is required');
  if (typeof value !== 'string' || Buffer.byteLength(value) > maxBytes + 16)
    throw new OAuthResourceError(400,'invalid_request','Invalid Authorization header');
  const match = /^Bearer +([A-Za-z0-9._~+/-]+=*)$/i.exec(value);
  if (!match) throw new OAuthResourceError(400,'invalid_request','Use the Bearer authorization scheme');
  const token = match[1];
  if (Buffer.byteLength(token) > maxBytes || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw invalidToken();
  return token;
}
function grantedScopes(payload,claim) {
  const value = payload[claim];
  if (value === undefined) return [];
  const selected = typeof value === 'string' ? (value === '' ? [] : value.split(' '))
    : claim === 'scp' && Array.isArray(value) ? value : null;
  if (!selected || selected.length > 256 || selected.some(scope => typeof scope !== 'string' || scope.length > 256 || !scopePattern.test(scope)))
    throw invalidToken();
  return [...new Set(selected)];
}
async function boundedJwks(response,maxBytes,signal) {
  if (!response || response.status !== 200) { await response?.body?.cancel().catch(()=>{}); throw unavailable(); }
  if (!/^application\/(?:json|jwk-set\+json)(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel().catch(()=>{}); throw unavailable();
  }
  const declared = response.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    await response.body?.cancel().catch(()=>{}); throw unavailable();
  }
  const reader = response.body?.getReader();
  if (!reader) throw unavailable();
  let size=0,complete=false; const chunks=[];
  try {
    for (;;) {
      signal.throwIfAborted();
      const {done,value}=await reader.read();
      if (done) { complete=true; break; }
      size+=value.byteLength;
      if (size > maxBytes) throw unavailable();
      chunks.push(value);
    }
    signal.throwIfAborted();
  } finally { if (!complete) await reader.cancel().catch(()=>{}); reader.releaseLock(); }
  let body; try { body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size))); }
  catch { throw unavailable(); }
  if (!plain(body) || !Array.isArray(body.keys) || !body.keys.length || body.keys.length > 128 ||
      body.keys.some(key => !plain(key) || ['d','p','q','dp','dq','qi','oth','k'].some(name => Object.hasOwn(key,name))))
    throw unavailable();
  return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/jwk-set+json'}});
}

/**
 * Configure the incoming resource server. The existing authorization server
 * issues grants. fetchImpl and authorize are trusted host capabilities.
 * Every issuer needs explicit subjects unless the host supplies authorize.
 */
export function createOAuthResourceAuthorization(input,{fetchImpl,clock=Date.now,authorize}={}) {
  const config=frozen(validateOAuthResourceConfig(input)), location=resourceMetadataLocation(config.resource);
  if (typeof clock !== 'function' || (fetchImpl !== undefined && typeof fetchImpl !== 'function') ||
      (authorize !== undefined && typeof authorize !== 'function')) throw new TypeError('Invalid trusted OAuth host capability');
  if (!authorize && config.authorizationServers.some(server => !server.allowedSubjects.length))
    throw new TypeError('Configure exact allowedSubjects for every issuer or supply the host authorize callback');
  const fetcher=fetchImpl ?? createPublicHttpsFetch({timeoutMs:config.jwksTimeoutMs});
  const shutdown=new AbortController(), active=new Set(), authenticated=new WeakSet();
  let closed=false,closing;
  const metadata=frozen({resource:config.resource,authorization_servers:config.authorizationServers.map(server=>server.issuer),
    bearer_methods_supported:['header'],scopes_supported:[...config.scopesSupported]});
  const issuers=new Map(config.authorizationServers.map(server=>{
    const jwks=createRemoteJWKSet(new URL(server.jwksUri),{timeoutDuration:config.jwksTimeoutMs,
      cacheMaxAge:config.jwksCacheMaxAgeMs,cooldownDuration:config.jwksCooldownMs,
      [customFetch]:async (url,options)=>{
        if (closed || url !== new URL(server.jwksUri).href) throw unavailable();
        const signal=AbortSignal.any([options.signal,shutdown.signal]);
        const response=await fetcher(url,{method:'GET',headers:{accept:'application/json, application/jwk-set+json'},
          redirect:'manual',signal});
        return boundedJwks(response,config.maxJwksBytes,signal);
      }});
    return [server.issuer,{server,jwks,types:new Set(server.tokenTypes.map(normalizedType))}];
  }));
  const running=()=>{if(closed)throw unavailable();};
  const currentTime=()=>{const now=clock();if(!Number.isFinite(now)||now<0)throw unavailable();return now;};
  const track=operation=>{
    active.add(operation);
    operation.then(()=>active.delete(operation),()=>active.delete(operation));
    return operation;
  };
  const authenticate=req=>track((async()=>{
    running();
    const token=tokenFrom(req,config.maxTokenBytes);
    let untrusted,header;
    try { untrusted=decodeJwt(token);header=decodeProtectedHeader(token); } catch { throw invalidToken(); }
    const entry=issuers.get(untrusted.iss);
    if (!entry || !entry.server.algorithms.includes(header.alg) || typeof header.typ !== 'string' ||
        !entry.types.has(normalizedType(header.typ)) || ['jku','jwk','x5u'].some(key=>Object.hasOwn(header,key)) ||
        (header.kid !== undefined && (typeof header.kid !== 'string' || header.kid.length > 256)))
      throw invalidToken();
    let payload;
    try {
      ({payload}=await jwtVerify(token,entry.jwks,{issuer:entry.server.issuer,audience:config.resource,
        algorithms:entry.server.algorithms,requiredClaims:['iss','sub','aud','exp'],
        clockTolerance:config.clockToleranceSeconds,currentDate:new Date(currentTime())}));
    } catch(error) {
      if (error instanceof OAuthResourceError) throw error;
      if (/^ERR_(?:JWT_|JWS_|JOSE_ALG_NOT_ALLOWED$|JOSE_NOT_SUPPORTED$|JWKS_NO_MATCHING_KEY$|JWKS_MULTIPLE_MATCHING_KEYS$)/.test(error?.code ?? ''))
        throw invalidToken();
      throw unavailable();
    }
    running();
    const now=currentTime()/1000;
    if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length>1024 || /[\x00-\x1f\x7f]/.test(payload.sub) ||
        !Number.isFinite(payload.exp) || payload.exp<=0 ||
        (payload.iat!==undefined && (!Number.isFinite(payload.iat) || payload.iat>now+config.clockToleranceSeconds || payload.iat>payload.exp)) ||
        (Array.isArray(payload.aud) && (payload.aud.length>32 || payload.aud.some(value=>typeof value!=='string'))))
      throw invalidToken();
    if (entry.server.allowedSubjects.length && !entry.server.allowedSubjects.includes(payload.sub))
      throw new OAuthResourceError(403,'access_denied','This identity is not authorized for this operator workspace');
    const client=payload.client_id ?? payload.azp;
    if (client!==undefined && (typeof client!=='string' || !client || client.length>1024 || /[\x00-\x1f\x7f]/.test(client))) throw invalidToken();
    const context=frozen({subject:payload.sub,issuer:entry.server.issuer,audience:config.resource,
      scopes:grantedScopes(payload,entry.server.scopeClaim),clientId:client ?? null,
      issuedAt:payload.iat ?? null,expiresAt:payload.exp});
    authenticated.add(context);
    return context;
  })());
  const authorizeTool=(context,name=null,args={})=>track((async()=>{
    running();
    if (!authenticated.has(context)) throw invalidToken();
    if (name!==null && (typeof name!=='string'||!toolPattern.test(name))) throw new TypeError('Expected an original tool name');
    if (!plain(args)) throw new TypeError('Expected original tool arguments');
    if (currentTime()/1000 >= context.expiresAt+config.clockToleranceSeconds) throw invalidToken();
    const required=allScopes(config.requiredScopes,name===null?[]:config.toolScopes[name]??[]);
    if (required.some(scope=>!context.scopes.includes(scope)))
      throw new OAuthResourceError(403,'insufficient_scope','Additional resource scopes are required',required);
    if (authorize) {
      let accepted;
      try { accepted=await authorize({context,tool:name,arguments:structuredClone(args),signal:shutdown.signal}); }
      catch { running(); throw new OAuthResourceError(403,'access_denied','The host did not authorize this operation'); }
      running();
      if (accepted!==true) throw new OAuthResourceError(403,'access_denied','The host did not authorize this operation');
    }
    // Long-running host checks cannot authorize an already expired request.
    if (currentTime()/1000 >= context.expiresAt+config.clockToleranceSeconds) throw invalidToken();
    return context;
  })());
  const quote=value=>'"'+String(value).replaceAll('\\','\\\\').replaceAll('"','\\"')+'"';
  function respondError(error,res,{id=null}={}) {
    const selected=error instanceof OAuthResourceError?error:unavailable();
    const required=selected.code==='insufficient_scope'?selected.requiredScopes:config.requiredScopes;
    const fields=['resource_metadata='+quote(location.metadataUrl)];
    if (selected.code!=='authorization_required') fields.push('error='+quote(selected.code));
    if (required.length) fields.push('scope='+quote(required.join(' ')));
    const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store',
      'www-authenticate':'Bearer '+fields.join(', ')};
    if (selected.status===503) headers['retry-after']='5';
    if (res.destroyed||res.writableEnded) return;
    res.writeHead(selected.status,headers);
    res.end(JSON.stringify({jsonrpc:'2.0',id,error:{code:selected.status===400?-32600:-32001,
      message:selected.message,data:{error:selected.code,resource_metadata:location.metadataUrl,
        ...(required.length?{scope:required.join(' ')}:{})}}}));
  }
  function metadataHandler(req,res) {
    let target; try { target=requestTarget(req); } catch { return false; }
    if (target.pathname!==location.metadataPath) return false;
    const headers={'content-type':'application/json; charset=utf-8','cache-control':'public, max-age=300',
      'access-control-allow-origin':'*','access-control-allow-methods':'GET, HEAD, OPTIONS',
      'x-content-type-options':'nosniff'};
    if (target.search) { res.writeHead(400,{'cache-control':'no-store'});res.end();return true; }
    if (req.method==='OPTIONS') { res.writeHead(204,headers);res.end();return true; }
    if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405,{...headers,allow:'GET, HEAD, OPTIONS'});res.end();return true; }
    res.writeHead(200,headers);res.end(req.method==='HEAD'?undefined:JSON.stringify(metadata));return true;
  }
  function describe() {
    return {schema:'stellar-forge.mcp-oauth-resource-status.v1',...location,
      authorizationServers:config.authorizationServers.map(server=>({...structuredClone(server),
        keys:{fresh:issuers.get(server.issuer).jwks.fresh,reloading:issuers.get(server.issuer).jwks.reloading,
          coolingDown:issuers.get(server.issuer).jwks.coolingDown}})),
      requiredScopes:[...config.requiredScopes],toolScopes:structuredClone(config.toolScopes),
      metadata:structuredClone(metadata),closed,activeRequests:active.size};
  }
  function close() {
    if (closing) return closing;
    closed=true;shutdown.abort(new Error('OAuth resource is closing'));
    closing=Promise.allSettled([...active]).then(()=>undefined);
    return closing;
  }
  return Object.freeze({authenticate,authorizeTool,respondError,metadataHandler,describe,close});
}
