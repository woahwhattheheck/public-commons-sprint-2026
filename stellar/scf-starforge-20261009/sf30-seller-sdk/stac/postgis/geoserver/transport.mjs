// MIT. Origin-bound GeoServer REST and original WFS source transport.
import { createPublicHttpsFetch, normalizeBuyerTransport, normalizeSourceAuthorization } from '../../../../sf31-buyer-client/public-transport.mjs';
import { createSourceBearerAuth, createSourceApiKeyAuth } from '../../../../sf31-buyer-client/source-auth.mjs';
import { createWfsProvider } from '../../../wfs/source.mjs';
import { normalizeProfile, need, MiB } from './contract.mjs';

export function createGeoServerService({profile:input,environment=process.env,fetchImpl}={}) {
  const profile = normalizeProfile(input), origin = new URL(profile.baseUrl).origin;
  const local = profile.allowLoopback && new URL(profile.baseUrl).protocol === 'http:';
  const proxy = profile.transport ? normalizeBuyerTransport(profile.transport) : null;
  need(!proxy || proxy.origin === origin, 'GEOSERVER_PROXY_ORIGIN');
  need(!local || !proxy, 'GEOSERVER_LOCAL_PROXY');
  const lifetime = new AbortController(), active = new Set(), authentications = new Map(), wfs = new Map();
  let closing = null;
  function auth(reference) {
    const key = reference.scheme + ':' + reference.authorizationEnv;
    if (authentications.has(key)) return authentications.get(key);
    const capability = local ? {origin,scheme:reference.scheme} :
      normalizeSourceAuthorization({origin,scheme:reference.scheme});
    const native = !local && reference.scheme !== 'Basic'
      ? (reference.scheme === 'Bearer' ? createSourceBearerAuth : createSourceApiKeyAuth)({
        bindings:[{origin,[reference.scheme === 'Bearer' ? 'tokenEnv' : 'apiKeyEnv']:reference.authorizationEnv}],environment})
      : null;
    const dispatch = fetchImpl ?? (local ? fetch : createPublicHttpsFetch({timeoutMs:profile.timeoutMs,
      sourceAuthorization:capability,...(proxy ? {trustedProxy:proxy} : {})}));
    const selected = {
      authorizationForOrigin(value) { return value === origin ? capability : null; },
      async requestHeaders({url,method,signal}) {
        signal?.throwIfAborted();
        const target = new URL(url);
        need(target.origin === origin && !target.username && !target.password && !target.hash &&
          target.pathname.startsWith(new URL(profile.baseUrl).pathname + '/'),
          'GEOSERVER_AUTH_ORIGIN');
        need(['GET','HEAD','POST','PUT','DELETE'].includes(method), 'GEOSERVER_AUTH_METHOD');
        if (native) return native.requestHeaders({url,method,signal});
        const credential = environment[reference.authorizationEnv];
        need(typeof credential === 'string' && credential.length <= 16384 &&
          (reference.scheme === 'Basic' ? /^Basic [A-Za-z0-9+/]+={0,2}$/.test(credential) :
            reference.scheme === 'Bearer' ? /^[A-Za-z0-9._~+/-]+=*$/.test(credential) :
              /^[\x21-\x7e]+$/.test(credential)), 'GEOSERVER_CREDENTIAL_UNAVAILABLE',
          'The selected source credential reference is unavailable or invalid.');
        return {[reference.scheme === 'ApiKey' ? 'api-key' : 'authorization']:reference.scheme === 'Bearer' ? 'Bearer '+credential : credential};
      },
      observeResponse:request => native?.observeResponse?.(request),
      close:() => native?.close(),
      dispatch,
    };
    authentications.set(key,selected); return selected;
  }
  function selectedAuth(readerId) {
    if (readerId === undefined || readerId === null) return auth(profile.administrator);
    const reader = profile.readers.find(row => row.id === readerId);
    need(reader, 'GEOSERVER_READER_UNKNOWN'); return auth(reader.authorization);
  }
  function own(work) {
    if (lifetime.signal.aborted || closing) return Promise.reject(Object.assign(new Error('The GeoServer client is draining.'),{code:'GEOSERVER_CLOSED'}));
    const task = Promise.resolve().then(work); active.add(task);
    task.then(() => active.delete(task),() => active.delete(task)); return task;
  }
  function urlFor(path) {
    need(typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') &&
      !path.includes('#') && !path.includes('\\') && !/%2f|%5c|%00/i.test(path), 'GEOSERVER_RELATIVE_REQUEST');
    const result = new URL(profile.baseUrl + path);
    need(result.origin === origin &&
      result.pathname.startsWith(new URL(profile.baseUrl).pathname + '/') &&
      !result.username && !result.password, 'GEOSERVER_REQUEST_CONTEXT');
    return result.href;
  }
  async function exchange({path,method='GET',body,contentType='application/json',accept='application/json',
    readerId,signal,maximum=8*MiB}) {
    need(['GET','HEAD','POST','PUT','DELETE'].includes(method),'GEOSERVER_REQUEST_METHOD');
    need(readerId === undefined || readerId === null || method === 'GET' || method === 'HEAD',
      'GEOSERVER_READER_WRITE_FORBIDDEN');
    need(Number.isSafeInteger(maximum) && maximum > 0 && maximum <= 64*MiB,'GEOSERVER_RESPONSE_LIMIT');
    need(body === undefined || Buffer.isBuffer(body) || typeof body === 'string','GEOSERVER_REQUEST_BYTES');
    const url = urlFor(path), provider = selectedAuth(readerId);
    const combined = AbortSignal.any([lifetime.signal,AbortSignal.timeout(profile.timeoutMs),...(signal ? [signal] : [])]);
    combined.throwIfAborted();
    const headers = new Headers({accept});
    if (body !== undefined) headers.set('content-type',contentType);
    for (const [name,value] of new Headers(await provider.requestHeaders({url,method,signal:combined}))) headers.set(name,value);
    const response = await provider.dispatch(url,{method,headers,...(body !== undefined ? {body} : {}),
      redirect:'manual',signal:combined});
    let complete = false;
    try {
      await provider.observeResponse({url,status:response.status,authorization:headers.get('authorization')});
      const chunks=[];let size=0;
      for await (const chunk of response.body ?? []) {
        combined.throwIfAborted(); size += chunk.length;
        need(size <= maximum,'GEOSERVER_RESPONSE_TOO_LARGE'); chunks.push(Buffer.from(chunk));
      }
      const bytes=Buffer.concat(chunks,size);
      const result={url,status:response.status,headers:Object.fromEntries(
        ['content-type','etag','last-modified','date','location','retry-after'].flatMap(name =>
          response.headers.has(name) ? [[name,response.headers.get(name)]] : [])),bytes,receivedAt:new Date().toISOString()};
      complete=true;return result;
    } finally {if (!complete) await response.body?.cancel().catch(() => {});}
  }
  function request(input) {return own(() => exchange(input));}
  function featureProvider(readerId) {
    const key = readerId ?? '$administrator';
    if (wfs.has(key)) return wfs.get(key);
    const authentication=selectedAuth(readerId);
    const provider=createWfsProvider({endpoint:profile.baseUrl+'/ows',allowLoopback:profile.allowLoopback,
      sourceAuth:authentication,timeoutMs:profile.timeoutMs,python:profile.python,
      ...(proxy ? {transport:proxy} : {}),fetchImpl:authentication.dispatch});
    wfs.set(key,provider);return provider;
  }
  const close=() => {
    if (closing) return closing;
    lifetime.abort(Object.assign(new Error('GeoServer workspace is closing.'),{code:'GEOSERVER_CLOSED'}));
    const task=(async()=>{
      for (const provider of wfs.values()) await provider.close();
      await Promise.allSettled([...active]);
      for (const authentication of authentications.values()) await authentication.close();
    })();
    closing=task;void task.catch(()=>{if(closing===task)closing=null;});return task;
  };
  return Object.freeze({profile,origin,urlFor,request,
    wfs:readerId=>{need(!lifetime.signal.aborted&&!closing,'GEOSERVER_CLOSED');return featureProvider(readerId);},
    close});
}

export function responseJson(response, {allowMissing=false}={}) {
  if (allowMissing && response.status === 404) return null;
  need(response.status === 200 && /^application\/(?:[^;]+\+)?json(?:\s*;|$)/i.test(response.headers['content-type'] ?? ''),
    'GEOSERVER_HTTP_'+response.status,'GeoServer returned HTTP '+response.status+'.',response.status >= 400 ? response.status : 502);
  let result;
  try {result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(response.bytes));}
  catch {throw Object.assign(new Error('The complete GeoServer response is not valid UTF-8 JSON.'),{code:'GEOSERVER_JSON',status:502});}
  return result;
}
export function retryAt(response) {
  const value=response?.headers?.['retry-after'];if(!value)return null;
  const millis=/^\d+$/.test(value) ? Date.now()+Number(value)*1000 : Date.parse(value);
  return Number.isFinite(millis)&&Math.abs(millis)<=8.64e15 ? new Date(millis).toISOString() : null;
}
