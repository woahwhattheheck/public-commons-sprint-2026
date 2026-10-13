// MIT. Exact OAuth source captures in the original seller incident programme.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {validateOAuthObservation,oauthWindow,OAUTH_STAGES,OAUTH_COUNTER_FIELDS} from '../../../stellar-forge/mcp-paid-agent/oauth-observation-contract.mjs';

export const OAUTH_FILES=Object.freeze(['oauth-observation.json','oauth-source.json']);
export const OAUTH_FILE_LIMIT=2_000_000;
export const OAUTH_CAPTURE_SCHEMA='stellar-forge.sf93.oauth-observation.v1';
export const OAUTH_KINDS=Object.freeze(['OAUTH_SOURCE_UNAVAILABLE','OAUTH_CONFIGURATION_CHANGED',
  'OAUTH_SOURCE_INTEGRITY','OAUTH_OBSERVER_INCOMPLETE','OAUTH_VERIFIER_UNAVAILABLE',
  'OAUTH_HOST_AUTHORITY_ERROR','OAUTH_JWKS_UNAVAILABLE','OAUTH_JWKS_RATE_LIMITED']);
const HASH=/^[a-f0-9]{64}$/,CODE=/^[A-Z0-9_]{1,120}$/,ID=/^[A-Za-z0-9_-]{1,64}$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const need=(ok,code='OAUTH_CAPTURE_INVALID')=>{if(!ok)throw Object.assign(new Error(code),{code});};
const instant=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const encoded=value=>Buffer.from(JSON.stringify(value)+'\n');
function fields(value,names,required=names){
  need(plain(value)&&Object.keys(value).every(key=>names.includes(key))&&required.every(key=>Object.hasOwn(value,key)));
  return value;
}
function integer(value,min,max,name){need(Number.isSafeInteger(value)&&value>=min&&value<=max,'OAUTH_SOURCE_'+name.toUpperCase()+'_INVALID');return value;}
function text(value,max,label,pattern){
  need(typeof value==='string'&&value.length>0&&Buffer.byteLength(value)<=max&&
    Buffer.from(value).toString('utf8')===value&&!/[\x00-\x1f\x7f]/.test(value)&&(!pattern||pattern.test(value)),label);
  return value;
}
function registration(value){
  fields(value,['id','label']);return {id:text(value.id,64,'OAUTH_REGISTRATION_INVALID',ID),label:text(value.label,120,'OAUTH_REGISTRATION_INVALID')};
}
export function oauthEndpoint(value){
  text(value,2048,'OAUTH_SOURCE_ENDPOINT_INVALID');let url;
  try {url=new URL(value);}catch{need(false,'OAUTH_SOURCE_ENDPOINT_INVALID');}
  need(url.protocol==='http:'&&['127.0.0.1','[::1]'].includes(url.hostname)&&
    !url.username&&!url.password&&!url.hash&&!url.search&&url.href===value&&url.pathname!=='/',
    'OAUTH_SOURCE_EXACT_LOOPBACK_ENDPOINT_REQUIRED');
  return value;
}
export function normalizeOAuthSource(value){
  const names=['endpoint','tokenEnv','resource','configurationSha256','timeoutMs','windowMinutes',
    'unavailableMinimum','unavailablePercent','hostErrorMinimum','hostErrorPercent'];
  fields(value,names,['endpoint','tokenEnv','resource','configurationSha256']);
  const endpoint=oauthEndpoint(value.endpoint);
  const tokenEnv=text(value.tokenEnv,128,'OAUTH_SOURCE_TOKEN_ENV_INVALID',/^[A-Za-z_][A-Za-z0-9_]{0,127}$/);
  text(value.resource,2048,'OAUTH_SOURCE_RESOURCE_INVALID');let resource;
  try {resource=new URL(value.resource);}catch{need(false,'OAUTH_SOURCE_RESOURCE_INVALID');}
  need(resource.protocol==='https:'&&!resource.username&&!resource.password&&!resource.hash&&!resource.search&&
    !/[\x00-\x20\x7f]/.test(value.resource),
    'OAUTH_SOURCE_RESOURCE_INVALID');
  need(HASH.test(value.configurationSha256??''),'OAUTH_SOURCE_CONFIGURATION_SHA256_INVALID');
  return {endpoint,tokenEnv,resource:value.resource,configurationSha256:value.configurationSha256,
    timeoutMs:integer(value.timeoutMs??5000,100,30000,'timeoutMs'),
    windowMinutes:integer(value.windowMinutes??5,1,60,'windowMinutes'),
    unavailableMinimum:integer(value.unavailableMinimum??1,1,1_000_000_000,'unavailableMinimum'),
    unavailablePercent:integer(value.unavailablePercent??10,0,100,'unavailablePercent'),
    hostErrorMinimum:integer(value.hostErrorMinimum??1,1,1_000_000_000,'hostErrorMinimum'),
    hostErrorPercent:integer(value.hostErrorPercent??10,0,100,'hostErrorPercent')};
}
function parse(bytes){
  need(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=OAUTH_FILE_LIMIT,'OAUTH_CAPTURE_SIZE_LIMIT');
  try {return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch {need(false,'OAUTH_CAPTURE_JSON_INVALID');}
}
export function analyzeOAuthObservation(meta,source){
  registration(meta.registration);
  const selection=normalizeOAuthSource(meta.selection);
  need(isDeepStrictEqual(selection,meta.selection),'OAUTH_CAPTURE_SELECTION_INVALID');
  need(instant(meta.startedAt)&&instant(meta.generatedAt)&&meta.startedAt<=meta.generatedAt,'OAUTH_CAPTURE_TIME_INVALID');
  need(meta.errorCode===null||CODE.test(meta.errorCode??''),'OAUTH_CAPTURE_ERROR_INVALID');
  if(source===null){
    need(meta.errorCode!==null,'OAUTH_CAPTURE_MISSING_SOURCE_REASON');
    return {selection,coverage:'SOURCE_UNAVAILABLE',sourceError:meta.errorCode,identityContradiction:false,
      resource:null,sessionId:null,startedAt:null,capturedAt:null,sequence:null,configurationSha256:null,
      authority:null,state:null,counters:null,issuers:null,last:null,window:null};
  }
  validateOAuthObservation(source);need(meta.errorCode===null,'OAUTH_CAPTURE_SOURCE_ERROR_CONFLICT');
  const identityContradiction=source.resource!==selection.resource||source.configurationSha256!==selection.configurationSha256;
  const incomplete=source.state.observerErrors>0||source.state.clockError;
  return {selection,coverage:identityContradiction?'IDENTITY_CHANGED':incomplete?'OBSERVER_INCOMPLETE':'COMPLETE',
    sourceError:identityContradiction?'OAUTH_CONFIGURATION_MISMATCH':incomplete?'OAUTH_OBSERVER_INCOMPLETE':null,
    identityContradiction,resource:source.resource,sessionId:source.sessionId,startedAt:source.startedAt,
    capturedAt:source.capturedAt,sequence:source.sequence,configurationSha256:source.configurationSha256,
    authority:structuredClone(source.authority),state:structuredClone(source.state),
    counters:structuredClone(source.counters),issuers:structuredClone(source.issuers),last:structuredClone(source.last),
    window:oauthWindow(source,selection.windowMinutes)};
}
export function createOAuthObservation({registration:selected,selection,startedAt,generatedAt,sourceBytes=null,errorCode=null}){
  const bytes=sourceBytes===null?encoded(null):Buffer.from(sourceBytes);
  const source=parse(bytes);
  if(source!==null)validateOAuthObservation(source);
  const meta={schema:OAUTH_CAPTURE_SCHEMA,registration:registration(selected),selection:normalizeOAuthSource(selection),
    startedAt,generatedAt,errorCode,sources:{'oauth-source.json':{bytes:bytes.length,sha256:hash(bytes)}}};
  meta.summary=analyzeOAuthObservation(meta,source);
  const metaBytes=encoded(meta);need(metaBytes.length<=OAUTH_FILE_LIMIT,'OAUTH_CAPTURE_SIZE_LIMIT');
  return {kind:'OAUTH_RESOURCE',files:{'oauth-observation.json':metaBytes,'oauth-source.json':bytes},
    oauth:meta,report:{generatedAt,observation:{sessionId:source?.sessionId??hash(encoded(meta.selection))}}};
}
export function readOAuthObservationFiles(files){
  fields(files,OAUTH_FILES);
  const meta=parse(files['oauth-observation.json']),source=parse(files['oauth-source.json']);
  fields(meta,['schema','registration','selection','startedAt','generatedAt','errorCode','sources','summary']);
  need(meta.schema===OAUTH_CAPTURE_SCHEMA,'OAUTH_CAPTURE_SCHEMA_INVALID');
  fields(meta.sources,['oauth-source.json']);fields(meta.sources['oauth-source.json'],['bytes','sha256']);
  need(meta.sources['oauth-source.json'].bytes===files['oauth-source.json'].length&&
    meta.sources['oauth-source.json'].sha256===hash(files['oauth-source.json']),'OAUTH_CAPTURE_SOURCE_CHANGED');
  const summary=analyzeOAuthObservation(meta,source);
  need(isDeepStrictEqual(summary,meta.summary),'OAUTH_CAPTURE_SUMMARY_CHANGED');
  return {meta,source,summary};
}
function regressed(source,previous){
  if(source.startedAt!==previous.startedAt||source.sequence<=previous.sequence||source.capturedAt<previous.capturedAt)return true;
  for(const stage of OAUTH_STAGES){
    if(OAUTH_COUNTER_FIELDS.some(key=>source.counters[stage][key]<previous.counters[stage][key]))return true;
    if(Object.keys(source.counters[stage].outcomes).some(key=>source.counters[stage].outcomes[key]<previous.counters[stage].outcomes[key]))return true;
  }
  return false;
}
export function oauthObservationSignals(merchant,observation,now,previous=null){
  const packet=observation.packet,meta=packet?.oauth;
  if(!meta)return {signals:{OAUTH_SOURCE_UNAVAILABLE:{bad:true,values:{}}},error:observation.error??'OAUTH_SOURCE_READ_FAILED'};
  need(isDeepStrictEqual(meta.selection,merchant.oauth)&&meta.registration.id===merchant.id&&meta.registration.label===merchant.label,
    'OAUTH_CAPTURE_REGISTRATION_CHANGED');
  const read=readOAuthObservationFiles(packet.files),source=read.source,s=read.summary;
  const captured=Date.parse(meta.generatedAt),sourceTime=source===null?null:Date.parse(source.capturedAt);
  const fresh=Number.isFinite(now)&&captured<=now+5000&&now-captured<=30000&&
    (sourceTime===null||sourceTime<=now+5000&&now-sourceTime<=30000);
  if(!fresh)return {packet,successful:false,fresh:false,signals:{OAUTH_SOURCE_UNAVAILABLE:{bad:true,values:{}}},
    error:'OAUTH_SOURCE_CLOCK_OR_AGE_INVALID'};
  if(source===null){
    return {packet,successful:false,fresh:true,error:meta.errorCode,signals:oauthConditions(s)};
  }
  const same=source.sessionId===previous?.sessionId;
  const broken=same&&regressed(source,previous);
  const complete=s.coverage==='COMPLETE'&&!broken,window=s.window;
  return {packet,successful:complete,fresh:true,previous:{sessionId:source.sessionId,startedAt:source.startedAt,
      capturedAt:source.capturedAt,sequence:source.sequence,counters:structuredClone(source.counters)},
    window:{from:window.from,through:window.through,complete:window.complete&&complete,sessionStartedAt:source.startedAt},
    error:broken?'OAUTH_SOURCE_COUNTER_OR_SEQUENCE_INVALID':s.sourceError,signals:oauthConditions(s,{sourceIntegrity:broken})};
}
/** One condition classifier serves the original watcher and historical Support
 * review. Native freshness and sequence checks remain in the watcher above. */
export function oauthConditions(s,{sourceIntegrity=false}={}){
  need(plain(s)&&typeof sourceIntegrity==='boolean','OAUTH_CONDITION_INPUT_INVALID');
  const limits=normalizeOAuthSource(s.selection);
  if(s.counters===null){
    const corrupt=['OAUTH_OBSERVATION_INVALID','OAUTH_CAPTURE_JSON_INVALID','OAUTH_CAPTURE_SIZE_LIMIT'].includes(s.sourceError);
    return {OAUTH_SOURCE_UNAVAILABLE:{bad:!corrupt,values:{}},
      OAUTH_SOURCE_INTEGRITY:{bad:corrupt?true:null,values:{},...(corrupt?{openAfter:1}:{})}};
  }
  const complete=s.coverage==='COMPLETE'&&!sourceIntegrity,window=s.window,c=window.counters;
  const signal=(bad,values={},immediate=false)=>({bad:bad?true:complete?false:null,values,...(immediate?{openAfter:1}:{})});
  const rate=(failures,checks,minimum,percent,recoveryChecks)=>{
    const observedPercent=checks?failures*100/checks:0;
    const bad=failures>=minimum&&observedPercent>=percent;
    return {bad:!complete?null:bad?true:window.complete&&recoveryChecks>0?false:null,
      values:{failures,checks,percent:observedPercent,minimum,thresholdPercent:percent,windowMinutes:limits.windowMinutes,recoveryChecks}};
  };
  const verifier=rate(c.authentication.unavailable+c.authorization.unavailable,
    c.authentication.completed+c.authorization.completed,limits.unavailableMinimum,limits.unavailablePercent,
    c.authentication.allowed+c.authorization.allowed);
  if(complete&&s.state.closed){verifier.bad=true;verifier.values.closed=1;}
  return {
    OAUTH_SOURCE_UNAVAILABLE:{bad:s.identityContradiction?null:false,values:{}},
    OAUTH_CONFIGURATION_CHANGED:signal(s.identityContradiction,{},true),
    OAUTH_SOURCE_INTEGRITY:signal(sourceIntegrity,{},true),
    OAUTH_OBSERVER_INCOMPLETE:signal(s.state.observerErrors>0||s.state.clockError,{observerErrors:s.state.observerErrors}),
    OAUTH_VERIFIER_UNAVAILABLE:verifier,
    OAUTH_HOST_AUTHORITY_ERROR:s.authority.hostCallback?
      rate(c.hostAuthority.failed,c.hostAuthority.completed,limits.hostErrorMinimum,limits.hostErrorPercent,
        c.hostAuthority.allowed+c.hostAuthority.denied):{bad:null,values:{}},
    OAUTH_JWKS_UNAVAILABLE:rate(c.jwks.unavailable+c.jwks.failed,c.jwks.completed,limits.unavailableMinimum,
      limits.unavailablePercent,c.jwks.allowed),
    OAUTH_JWKS_RATE_LIMITED:rate(c.jwks.outcomes.HTTP_429,c.jwks.completed,1,0,c.jwks.allowed)
  };
}
