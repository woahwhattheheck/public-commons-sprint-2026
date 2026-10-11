// MIT. Metadata-only, destination-bound, signed incident notifications.
import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {createHmac, randomUUID} from 'node:crypto';
import {hash, idPattern, kinds} from './incident-config.mjs';

export const NOTIFICATION_SCHEMA = 'stellar-forge.seller-incident-notification.v1';
export const MAX_PENDING = 1024;
const uuid = /^[a-f0-9-]{36}$/;
const terminal = event => ['DELIVERED','EXHAUSTED','CANCELLED'].includes(event.status);
export {terminal as terminalNotification};

/** The URL and secret are resolved in memory; neither is returned in state. */
export function resolveDestination(config, env) {
  if (!config.notification) return {reason:'NOT_CONFIGURED'};
  const n = config.notification;
  let url;
  try {url = new URL(env[n.urlEnv]);} catch {return {reason:'DESTINATION_UNAVAILABLE'};}
  const local = n.allowLoopback && url.protocol==='http:' && url.hostname==='127.0.0.1' &&
    Boolean(url.port) && Number(url.port)>=1 && Number(url.port)<=65535;
  if ((url.protocol!=='https:' && !local) || url.username || url.password || url.hash ||
      Buffer.byteLength(url.href)>4096) return {reason:'DESTINATION_INVALID'};
  const secret = env[n.secretEnv];
  if (typeof secret!=='string' || Buffer.byteLength(secret)<32 || Buffer.byteLength(secret)>4096)
    return {reason:'SIGNING_KEY_UNAVAILABLE'};
  return {url,secret,binding:{id:n.id,urlEnv:n.urlEnv,secretEnv:n.secretEnv,endpointHash:hash(url.href)}};
}
export function payloadFor(incident, eventId, transition, createdAt) {
  // Deliberately construct each field. Never spread incident/source/ack objects.
  const counts = {};
  const recovered=incident.status==='RECOVERED';
  for (const [key,value] of Object.entries((recovered?incident.recoverySignal:incident.signal) ?? {}))
    if (['requests','failures','percent','minimum','thresholdPercent','pending','exhausted',
      'oldestPendingSeconds','thresholdSeconds','observerErrors','consecutivePolls',
      'windowMinutes'].includes(key) && Number.isFinite(value) && value>=0) counts[key]=value;
  return {schema:NOTIFICATION_SCHEMA,eventId,incidentId:incident.id,merchantId:incident.merchantId,
    kind:incident.kind,transition,status:incident.status,occurredAt:createdAt,
    openedAt:incident.openedAt,sessionId:(recovered?incident.recoverySessionId:incident.lastSessionId ?? incident.sessionId) ?? null,counts};
}
export function queueNotification(state, incident, transition, env, now) {
  if (!state.config.notification) {incident.notificationState='NOT_CONFIGURED';incident.notificationIssue='NOT_CONFIGURED';return null;}
  if (state.notifications.filter(event=>!terminal(event)).length>=MAX_PENDING) {
    incident.notificationIssue='QUEUE_CAPACITY';state.notificationCapacityEvents++;return null;
  }
  const id=randomUUID(),createdAt=new Date(now).toISOString(),destination=resolveDestination(state.config,env);
  const notificationConfigHash=hash(JSON.stringify(state.config.notification));
  if(transition==='OPENED'||transition==='REMINDER') {
    // Only opening a newly registered incident or an explicit operator notify
    // selects a destination. Later automatic transitions retain that scope.
    incident.notificationScope={notificationConfigHash,binding:destination.binding ?? null};
  }
  const scope=incident.notificationScope ?? {notificationConfigHash,binding:null};
  const body=JSON.stringify(payloadFor(incident,id,transition,createdAt));
  const event={id,incidentId:incident.id,transition,createdAt,configHash:state.configHash,
    notificationConfigHash:scope.notificationConfigHash,
    binding:scope.binding,body,bodyHash:hash(body),status:'PENDING',
    attempts:0,attemptLimit:state.config.notification.maxAttempts,attemptId:null,inFlightUntil:null,nextAttemptAt:createdAt,
    lastReason:null,httpStatus:null,acceptedAt:null};
  const usable=destinationForEvent(state,event,env);
  if(usable.reason){event.status='PAUSED';event.lastReason=usable.reason;}
  state.notifications.push(event);incident.notificationState=event.status;incident.notificationIssue=null;return event;
}
export function updateIncidentNotificationState(state,event) {
  if(state.notifications.findLast(item=>item.incidentId===event.incidentId)?.id!==event.id)return;
  const incident=state.incidents.find(item=>item.id===event.incidentId);
  if(incident)incident.notificationState=event.status;
}
export function checkPayload(event) {
  let p;try {p=JSON.parse(event.body);} catch {throw new Error('SF93_NOTIFICATION_PAYLOAD_INVALID');}
  const fields=['schema','eventId','incidentId','merchantId','kind','transition','status','occurredAt','openedAt','sessionId','counts'];
  const safeCounts=['requests','failures','percent','minimum','thresholdPercent','pending','exhausted',
    'oldestPendingSeconds','thresholdSeconds','observerErrors','consecutivePolls','windowMinutes'];
  const instant=value=>typeof value==='string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value;
  if (Buffer.byteLength(event.body)>4096 || hash(event.body)!==event.bodyHash || !p ||
      Object.keys(p).length!==fields.length || Object.keys(p).some(key=>!fields.includes(key)) ||
      p.schema!==NOTIFICATION_SCHEMA || p.eventId!==event.id || !uuid.test(p.eventId) ||
      p.incidentId!==event.incidentId || !uuid.test(p.incidentId) || !idPattern.test(p.merchantId) ||
      !kinds.includes(p.kind) || !['OPENED','ACKNOWLEDGED','RECOVERED','RETIRED','REMINDER'].includes(p.transition) ||
      !['OPEN','ACKNOWLEDGED','RECOVERED','RETIRED'].includes(p.status) ||
      !instant(p.occurredAt) || !instant(p.openedAt) || !(p.sessionId===null || uuid.test(p.sessionId)) ||
      !p.counts || typeof p.counts!=='object' || Array.isArray(p.counts) ||
      Object.entries(p.counts).some(([key,value])=>!safeCounts.includes(key)||!Number.isFinite(value)||value<0))
    throw new Error('SF93_NOTIFICATION_PAYLOAD_INVALID');
}
export function destinationForEvent(state,event,env) {
  checkPayload(event);
  if (hash(JSON.stringify(state.config.notification))!==event.notificationConfigHash) return {reason:'NOTIFICATION_CONFIGURATION_CHANGED'};
  const destination=resolveDestination(state.config,env);
  if (destination.reason) return destination;
  if (!event.binding || JSON.stringify(destination.binding)!==JSON.stringify(event.binding))
    return {reason:'DESTINATION_CHANGED'};
  return destination;
}
function retryAfter(value, now, maximum) {
  if (typeof value!=='string' || value.length>128) return null;
  const ms=/^\d+$/.test(value)?Number(value)*1000:Date.parse(value)-now;
  return Number.isFinite(ms)&&ms>=0?Math.min(ms,maximum):null;
}
export async function deliverNotification(event,destination,options,{signal}={}) {
  checkPayload(event);
  const timestamp=String(Math.floor(Date.now()/1000));
  const signature=createHmac('sha256',destination.secret).update(timestamp+'.'+event.body).digest('hex');
  return new Promise(resolve=>{
    let finished=false,timer;
    const finish=result=>{if(!finished){finished=true;clearTimeout(timer);resolve(result);}};
    const req=(destination.url.protocol==='https:'?httpsRequest:httpRequest)(destination.url,
      {method:'POST',agent:false,signal,headers:{'content-type':'application/json',
        'content-length':Buffer.byteLength(event.body),'user-agent':'stellar-forge-sf93/1',
        'x-starforge-event-id':event.id,'x-starforge-timestamp':timestamp,
        'x-starforge-signature':'sha256='+signature}},res=>{
        let bytes=0;
        const status=res.statusCode;
        res.on('data',chunk=>{bytes+=chunk.length;if(bytes>65_536){
          finish({accepted:false,status,reason:'RESPONSE_TOO_LARGE',retryable:true});req.destroy();}});
        res.once('aborted',()=>finish({accepted:false,status,reason:'RESPONSE_ABORTED',retryable:true}));
        res.once('error',()=>finish({accepted:false,status,reason:'RESPONSE_ERROR',retryable:true}));
        res.once('end',()=>finish({accepted:status>=200&&status<300,status,
          reason:status>=200&&status<300?'HTTP_ACCEPTED':'HTTP_'+status,
          retryable:[408,425,429].includes(status)||status>=500,
          retryAfterMs:retryAfter(res.headers['retry-after'],Date.now(),options.maxRetryMs)}));
      });
    timer=setTimeout(()=>{finish({accepted:false,status:null,reason:'DEADLINE',retryable:true});req.destroy();},options.timeoutMs);
    req.once('error',()=>finish({accepted:false,status:null,reason:signal?.aborted?'CANCELLED':'NETWORK_ERROR',retryable:true}));
    req.end(event.body);
  });
}
export function applyDelivery(event,result,options,now) {
  event.attemptId=null;event.inFlightUntil=null;event.httpStatus=result.status ?? null;
  event.lastReason=result.reason;
  if (result.accepted) {event.status='DELIVERED';event.acceptedAt=new Date(now).toISOString();event.nextAttemptAt=null;return;}
  if (!result.retryable || event.attempts>=options.maxAttempts) {event.status='EXHAUSTED';event.nextAttemptAt=null;return;}
  event.status='RETRY';
  const backoff=Math.min(options.maxRetryMs,options.retryMs*2**Math.min(event.attempts-1,30));
  event.nextAttemptAt=new Date(now+Math.max(backoff,result.retryAfterMs ?? 0)).toISOString();
}
