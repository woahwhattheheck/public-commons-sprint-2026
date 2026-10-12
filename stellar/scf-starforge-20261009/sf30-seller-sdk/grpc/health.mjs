// MIT. Standard health RPC observations over the original native gRPC source.
import {fileURLToPath} from 'node:url';
import {captureProtoSource, compileProtoSource} from './proto.mjs';
import {createGrpcSource} from './source.mjs';
import {validateGrpcConfig, captureGrpcEnvironment} from './config.mjs';

export const GRPC_HEALTH_PROTOCOL_SHA256 = '164b670058855c6277a0511a14e2a302dd5a8ff899853ca6851b6b201a413d28';
export const GRPC_HEALTH_OBSERVATION_SCHEMA = 'stellar-forge.grpc-health-observation.v1';
const PREFIX = '/grpc.health.v1.Health/';
const STATUS_NAMES = ['UNKNOWN','SERVING','NOT_SERVING','SERVICE_UNKNOWN'];
const GRPC_NAMES = ['OK','CANCELLED','UNKNOWN','INVALID_ARGUMENT','DEADLINE_EXCEEDED','NOT_FOUND',
  'ALREADY_EXISTS','PERMISSION_DENIED','RESOURCE_EXHAUSTED','FAILED_PRECONDITION','ABORTED',
  'OUT_OF_RANGE','UNIMPLEMENTED','INTERNAL','UNAVAILABLE','DATA_LOSS','UNAUTHENTICATED'];
const own = (value,key) => Object.prototype.hasOwnProperty.call(value,key);
const copy = value => structuredClone(value);
function invalid(code, field) {
  return Object.assign(new Error(code), {code, status:422, ...(field ? {field_path:field} : {})});
}
function closedObject(value, allowed, field='request') {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype,null].includes(Object.getPrototypeOf(value)))
    throw invalid('GRPC_HEALTH_REQUEST_INVALID',field);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if (typeof key!=='string' || !allowed.includes(key) || !descriptor.enumerable ||
        !own(descriptor,'value') || descriptor.value===undefined)
      throw invalid('GRPC_HEALTH_REQUEST_FIELDS_INVALID',field);
  }
}
function integer(value, fallback, minimum, maximum, field) {
  if (value===undefined) return fallback;
  if (!Number.isSafeInteger(value) || value<minimum || value>maximum)
    throw invalid('GRPC_HEALTH_LIMIT_INVALID',field);
  return value;
}
export function normalizeGrpcHealthRequest(value) {
  closedObject(value,['kind','service','timeoutMs','durationMs','maxEvents']);
  if (!['check','list','watch'].includes(value.kind))
    throw invalid('GRPC_HEALTH_KIND_INVALID','kind');
  if (value.kind==='list' && own(value,'service'))
    throw invalid('GRPC_HEALTH_LIST_SERVICE_INVALID','service');
  if (value.kind!=='watch' && (own(value,'durationMs') || own(value,'maxEvents')))
    throw invalid('GRPC_HEALTH_WATCH_FIELDS_REQUIRED','request');
  let service;
  if (value.kind!=='list') {
    service=own(value,'service') ? value.service : '';
    if (typeof service!=='string' || Buffer.byteLength(service,'utf8')>1024 ||
        /[\u0000-\u001f\u007f]/.test(service) || Buffer.from(service,'utf8').toString('utf8')!==service)
      throw invalid('GRPC_HEALTH_SERVICE_INVALID','service');
  }
  return {
    kind:value.kind, ...(value.kind==='list' ? {} : {service}),
    timeoutMs:integer(value.timeoutMs,30000,1,300000,'timeoutMs'),
    ...(value.kind==='watch' ? {
      durationMs:integer(value.durationMs,60000,1,3600000,'durationMs'),
      maxEvents:integer(value.maxEvents,1000,1,10000,'maxEvents')
    } : {})
  };
}
export const validateGrpcHealthRequest = normalizeGrpcHealthRequest;

function serving(value) {
  if (!value || typeof value!=='object' || Array.isArray(value))
    throw invalid('GRPC_HEALTH_RESPONSE_INVALID','status');
  // proto3 omits an unset zero enum because the original loader preserves absence.
  const actual = value?.status === undefined ? 0 : value.status;
  let code;
  if (typeof actual==='string' && STATUS_NAMES.includes(actual)) code=STATUS_NAMES.indexOf(actual);
  else if (Number.isInteger(actual) && actual>=-2147483648 && actual<=2147483647) code=actual;
  else throw invalid('GRPC_HEALTH_RESPONSE_INVALID','status');
  return {name:STATUS_NAMES[code] ?? 'UNRECOGNIZED',code};
}
function responseValue(request,value) {
  if (!value || typeof value!=='object' || Array.isArray(value))
    throw invalid('GRPC_HEALTH_RESPONSE_INVALID','response');
  if (request.kind!=='list') return {service:request.service,status:serving(value)};
  const statuses=value.statuses ?? Object.create(null);
  if (!statuses || typeof statuses!=='object' || Array.isArray(statuses))
    throw invalid('GRPC_HEALTH_RESPONSE_INVALID','statuses');
  return {statuses:Object.keys(statuses).sort().map(service=>({
    service,status:serving(statuses[service])
  })),atomic:false};
}
function safeFailure(error) {
  const status = typeof error?.grpcCode==='number'
    ? GRPC_NAMES[error.grpcCode] : error?.grpcCode;
  const grpcCode = GRPC_NAMES.indexOf(status);
  const code = typeof error?.code==='string' && /^GRPC_[A-Z0-9_]{1,100}$/.test(error.code)
    ? error.code : 'GRPC_HEALTH_OBSERVATION_FAILED';
  return {complete:false,terminalObserved:grpcCode>=0 && code.startsWith('GRPC_UPSTREAM_'),
    ...(grpcCode>=0 ? {grpcCode,grpcStatus:GRPC_NAMES[grpcCode]} : {}),error:code};
}
function nativeTerminal(value,error) {
  if (!value) return safeFailure(error);
  return {complete:value.complete===true,terminalObserved:value.terminalObserved===true,
    ...(Number.isInteger(value.grpcCode) && value.grpcCode>=0 && value.grpcCode<GRPC_NAMES.length
      ? {grpcCode:value.grpcCode,grpcStatus:GRPC_NAMES[value.grpcCode]} : {}),
    ...(typeof value.error==='string' && /^GRPC_[A-Z0-9_]{1,100}$/.test(value.error)
      ? {error:value.error} : error ? {error:safeFailure(error).error} : {})};
}
function backoff(delay,signal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve=>{
    const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',finish);resolve();};
    const timer=setTimeout(finish,delay);
    signal.addEventListener('abort',finish,{once:true});
    if(signal.aborted)finish();
  });
}

/**
 * onEvent is the sole ordered history sink. It is awaited before another record
 * or reconnect; callback failure closes the native owner and is propagated.
 * The result is compact and deliberately contains no second history copy.
 */
export async function observeGrpcHealth(configInput, requestInput, {env=process.env,signal,onEvent}={}) {
  const started=performance.now();
  const request=normalizeGrpcHealthRequest(requestInput);
  if (onEvent!==undefined && typeof onEvent!=='function')
    throw invalid('GRPC_HEALTH_EVENT_SINK_INVALID');
  const config=validateGrpcConfig(configInput);
  const capturedEnvironment=captureGrpcEnvironment(config,env);
  const proto=await captureProtoSource({
    directory:fileURLToPath(new URL('./health/',import.meta.url)),entrypoints:['health.proto']
  });
  if (proto.files.length!==1 || proto.files[0].sha256!==GRPC_HEALTH_PROTOCOL_SHA256)
    throw invalid('GRPC_HEALTH_PROTOCOL_CHANGED');
  const contract=compileProtoSource(proto);
  const controller=new AbortController();
  const budget=request.kind==='watch' ? request.maxEvents : 3;
  let reason,latest,terminal,updates=0,connections=0,eventCount=0,consumerFailure,consumerFailed=false;
  let durationTimer;
  function stop(value) { reason ??= value; controller.abort(); }
  const abort=()=>stop('CANCELLED');
  signal?.addEventListener('abort',abort,{once:true});
  if (signal?.aborted) abort();
  const lifetime=request.kind==='watch' ? request.durationMs : request.timeoutMs;
  const remaining=()=>Math.max(0,lifetime-(performance.now()-started));
  const initialRemaining=remaining();
  if(initialRemaining<=0)stop('DURATION_REACHED');
  else durationTimer=setTimeout(()=>stop('DURATION_REACHED'),initialRemaining);
  async function emit(event) {
    if(eventCount>=budget) {stop('EVENT_LIMIT_REACHED');return false;}
    try {if(onEvent)await onEvent(copy(event));}
    catch(error){consumerFailed=true;consumerFailure=error;controller.abort();throw error;}
    eventCount++;
    if(eventCount>=budget && request.kind==='watch') stop('EVENT_LIMIT_REACHED');
    return true;
  }
  async function closeOwned(opened,source,primary) {
    let issue;
    if(opened)try{await opened.close();}catch(error){issue=error;}
    if(source)try{await source.close();}catch(error){issue??=error;}
    if(issue && !primary)throw issue;
  }
  try {
    if(request.kind!=='watch') {
      let source,primary=false;
      try {
        if(!reason) {
          const nativeTimeout=Math.max(1,Math.min(request.timeoutMs,Math.ceil(remaining())));
          source=await createGrpcSource({...config,limits:{...config.limits,timeoutMs:nativeTimeout}},
            proto,{env:capturedEnvironment,contract});
          connections++;
          await emit({type:'opening',connection:connections,kind:request.kind,timeoutMs:nativeTimeout,
            ...(request.kind==='list'?{}:{service:request.service})});
          if(!reason) {
            try {
              const value=await source.call(PREFIX+(request.kind==='check'?'Check':'List'),
                request.kind==='list'?{}:{service:request.service},{signal:controller.signal});
              clearTimeout(durationTimer);
              latest=responseValue(request,value);
              await emit({type:'status',connection:connections,...latest});updates++;
              terminal={complete:true,terminalObserved:true,grpcCode:0,grpcStatus:'OK'};
            } catch(error) {
              clearTimeout(durationTimer);
              if(consumerFailed)throw consumerFailure;
              terminal=safeFailure(error);
            }
            await emit({type:'terminal',connection:connections,...terminal});
            reason ??= terminal.grpcStatus==='UNIMPLEMENTED' ? 'UNIMPLEMENTED'
              : terminal.complete ? 'COMPLETED' : 'NATIVE_ERROR';
          }
        }
      } catch(error){primary=true;throw error;}
      finally{await closeOwned(null,source,primary);}
    } else {
      let failures=0;
      while(!reason) {
        const left=remaining();
        if(left<=0){stop('DURATION_REACHED');break;}
        // The original native stream has both deadline and idle controls.
        // Matching their lifetime makes a quiet Watch a renewal, never a
        // NOT_SERVING result. The last received native status stays unchanged.
        const connectionTimeout=Math.max(1,Math.min(request.timeoutMs,Math.ceil(left)));
        const streamPolicy=config.limits.stream ?? {};
        const watchConfig={...config,limits:{...config.limits,timeoutMs:connectionTimeout,
          stream:{
            maxBytes:streamPolicy.maxBytes ?? 67108864,
            maxRecords:Math.min(streamPolicy.maxRecords ?? budget,budget),
            idleTimeoutMs:connectionTimeout
          }}};
        let source,opened,primary=false,nativeProblem,observedStatus=false;
        try {
          source=await createGrpcSource(watchConfig,proto,{env:capturedEnvironment,contract});
          connections++;
          await emit({type:'opening',connection:connections,kind:'watch',service:request.service,
            timeoutMs:connectionTimeout});
          if(reason)break;
          try {
            opened=source.stream(PREFIX+'Watch',{service:request.service},{signal:controller.signal});
            for await (const chunk of opened.body) {
              let value;
              try {value=JSON.parse(Buffer.from(chunk).toString('utf8'));}
              catch {throw invalid('GRPC_HEALTH_RESPONSE_INVALID','response');}
              const observed=responseValue(request,value);
              if(await emit({type:'status',connection:connections,...observed})) {
                latest=observed;updates++;observedStatus=true;
              }
              if(reason)break;
            }
          } catch(error) {
            if(consumerFailed)throw consumerFailure;
            nativeProblem=error;
          }
        } catch(error){primary=true;throw error;}
        finally {
          await closeOwned(opened,source,primary);
        }
        if(opened || nativeProblem) {
          terminal=nativeTerminal(opened?.snapshot(),nativeProblem);
          if(terminal.grpcStatus==='UNIMPLEMENTED' && !reason)reason='UNIMPLEMENTED';
          await emit({type:'terminal',connection:connections,...terminal});
        }
        if(reason)break;
        if(terminal?.grpcStatus==='UNIMPLEMENTED'){reason='UNIMPLEMENTED';break;}
        if(observedStatus)failures=0;else failures++;
        const delayMs=Math.min(10000,250*(2**Math.min(Math.max(0,failures-1),6)),Math.max(0,Math.ceil(remaining())));
        if(delayMs<=0){stop('DURATION_REACHED');break;}
        await emit({type:'retry',connection:connections,delayMs,
          ...(terminal?.grpcStatus ? {grpcStatus:terminal.grpcStatus} : {}),
          ...(terminal?.error ? {error:terminal.error} : {})});
        if(reason)break;
        await backoff(delayMs,controller.signal);
      }
    }
    return {
      schema:GRPC_HEALTH_OBSERVATION_SCHEMA,protocolSha256:GRPC_HEALTH_PROTOCOL_SHA256,
      protoSourceSha256:proto.sha256,reason:reason ?? 'COMPLETED',
      ...(latest ? {latest:copy(latest)} : {}),updates,connections,
      ...(terminal ? {terminal:copy(terminal)} : {}),eventCount
    };
  } finally {
    clearTimeout(durationTimer);
    signal?.removeEventListener('abort',abort);
    controller.abort();
  }
}
