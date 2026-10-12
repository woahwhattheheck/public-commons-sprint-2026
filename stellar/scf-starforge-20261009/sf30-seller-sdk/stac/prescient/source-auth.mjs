// MIT. Private original-SDK headers joined to the existing exact-origin SF31 capability.
import {normalizeSourceAuthorization} from '../../../sf31-buyer-client/public-transport.mjs';
import {normalizePrescientProfile,prescientCatalogEndpoint,PRESCIENT_SDK} from './configuration.mjs';

function failure(code){return Object.assign(new Error(code),{code});}
function need(value,code){if(!value)throw failure(code);}
const safeCode=error=>typeof error?.code==='string'&&/^PRESCIENT_[A-Z0-9_]{1,100}$/u.test(error.code)?error.code:'PRESCIENT_SOURCE_REQUEST_FAILED';
export function publicPrescientError(error){
  const result={code:safeCode(error)},details={};
  if(Number.isInteger(error?.details?.httpStatus))details.httpStatus=error.details.httpStatus;
  for(const key of ['awsCode','requestId'])if(typeof error?.details?.[key]==='string'&&/^[A-Za-z0-9_.:/+-]{1,160}$/u.test(error.details[key]))details[key]=error.details[key];
  if(Object.keys(details).length)result.details=details;
  return result;
}
function checkedURL(value){
  let url;try{url=new URL(value);}catch{throw failure('PRESCIENT_SOURCE_URL_INVALID');}
  need(url.protocol==='https:'&&!url.username&&!url.password&&!url.hash&&(!url.port||url.port==='443'),'PRESCIENT_SOURCE_URL_INVALID');
  return url;
}
export function inspectPrescientRuntime(runtime,profile){
  profile=normalizePrescientProfile(profile);
  const metadata=runtime?.metadata;
  need(metadata?.schema==='prescient-sdk-runtime/v1'&&metadata.sdkCommit===PRESCIENT_SDK.commit&&
    metadata.installedVersion===PRESCIENT_SDK.version,'PRESCIENT_RUNTIME_SDK_SOURCE_CHANGED');
  need(metadata.endpoint===profile.endpoint&&metadata.authMode===profile.authMode&&
    metadata.catalogUrl===prescientCatalogEndpoint(profile.endpoint),'PRESCIENT_RUNTIME_PROFILE_CHANGED');
  need(profile.authMode!=='oauth'||metadata.identityProvider===profile.identityProvider,'PRESCIENT_RUNTIME_IDENTITY_PROVIDER_CHANGED');
  need(Array.isArray(metadata.allowedOrigins)&&JSON.stringify([...metadata.allowedOrigins].sort())===JSON.stringify(profile.allowedOrigins),'PRESCIENT_RUNTIME_SOURCE_ORIGINS_CHANGED');
  return Object.freeze({schema:metadata.schema,sdkCommit:metadata.sdkCommit,installedVersion:metadata.installedVersion,
    endpoint:metadata.endpoint,catalogUrl:metadata.catalogUrl,authMode:metadata.authMode,
    identityProvider:profile.identityProvider,allowedOrigins:[...profile.allowedOrigins]});
}
/** The caller owns the SDK worker shared with S3 receiving. This facade owns only its pending header reads. */
export function createPrescientSourceAuth({runtime,profile}={}){
  profile=normalizePrescientProfile(profile);
  const metadata=inspectPrescientRuntime(runtime,profile);
  for(const name of ['requestHeaders','observeResponse'])need(typeof runtime[name]==='function','PRESCIENT_RUNTIME_INTERFACE_REQUIRED');
  const capabilities=new Map(profile.allowedOrigins.map(origin=>[origin,normalizeSourceAuthorization({
    origin,scheme:profile.authMode==='api-key'?'ApiKey':'Bearer'
  })]));
  const controller=new AbortController(),pending=new Set();let closing=null;
  const signalFor=signal=>signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  function owned(run){
    return (...args)=>{
      if(closing)return Promise.reject(failure('PRESCIENT_SOURCE_AUTH_CLOSED'));
      const result=Promise.resolve().then(()=>run(...args));pending.add(result);
      result.then(()=>pending.delete(result),()=>pending.delete(result));return result;
    };
  }
  return Object.freeze({
    metadata,
    authorizationForOrigin(origin){return capabilities.get(origin)??null;},
    requestHeaders:owned(async({url,method='GET',signal}={})=>{
      const target=checkedURL(url),combined=signalFor(signal);combined.throwIfAborted();
      if(!capabilities.has(target.origin))return {};
      need(['GET','HEAD','POST'].includes(method),'PRESCIENT_SOURCE_METHOD_NOT_APPROVED');
      let headers;
      try{headers=await runtime.requestHeaders({url:target.href,method,signal:combined});}
      catch(error){const safe=publicPrescientError(error);throw Object.assign(failure(safe.code),safe.details?{details:safe.details}:{});}
      combined.throwIfAborted();
      const name=profile.authMode==='api-key'?'api-key':'authorization';
      need(headers&&typeof headers==='object'&&!Array.isArray(headers)&&Object.keys(headers).length===1&&
        Object.hasOwn(headers,name)&&typeof headers[name]==='string'&&headers[name].length>0&&headers[name].length<=16391&&
        !/[\u0000-\u001f\u007f]/u.test(headers[name]),'PRESCIENT_SOURCE_HEADER_INVALID');
      if(name==='authorization')need(/^Bearer [A-Za-z0-9._~+/-]+=*$/iu.test(headers[name]),'PRESCIENT_SOURCE_BEARER_INVALID');
      return {[name]:headers[name]};
    }),
    observeResponse:owned(async({url,status,signal}={})=>{
      const target=checkedURL(url);
      if(!capabilities.has(target.origin))return;
      need(Number.isInteger(status)&&status>=100&&status<=599,'PRESCIENT_SOURCE_STATUS_INVALID');
      const combined=signalFor(signal);combined.throwIfAborted();
      try{await runtime.observeResponse({url:target.href,status,signal:combined});}
      catch(error){const safe=publicPrescientError(error);throw Object.assign(failure(safe.code),safe.details?{details:safe.details}:{});}
    }),
    close(){
      if(!closing){controller.abort(failure('PRESCIENT_SOURCE_AUTH_CLOSED'));closing=Promise.allSettled([...pending]).then(()=>{});}
      return closing;
    }
  });
}
