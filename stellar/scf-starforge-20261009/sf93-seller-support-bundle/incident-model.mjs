// MIT. Conditions from original runtime snapshots; no parallel traffic collector.
import {randomUUID} from 'node:crypto';
import {activeIncident, kinds, merchantBinding} from './incident-config.mjs';
import {queueNotification, terminalNotification} from './notifications.mjs';

const cumulative=['started','completed','responses','success','challenge','clientError','serverError','other','disconnected'];
const iso=now=>new Date(now).toISOString();
export function freshMerchant(config,merchant) {
  return {binding:merchantBinding(config,merchant),previous:null,lastSuccessAt:null,lastAttemptAt:null,
    lastCapture:null,captureState:'NO_CAPTURE',sessionsSeen:0,lastError:null,conditions:{}};
}
export function updateConfiguration(state,config,digest,env,now) {
  const merchants={};
  for(const merchant of config.merchants) {
    const old=state.merchants[merchant.id],binding=merchantBinding(config,merchant);
    merchants[merchant.id]=old?.binding===binding?old:freshMerchant(config,merchant);
  }
  for(const incident of state.incidents.filter(activeIncident)) {
    if(merchants[incident.merchantId]?.binding===incident.binding) continue;
    incident.status='RETIRED';incident.retiredReason='CONFIGURATION_CHANGED';
    incident.closedAt=iso(now);incident.updatedAt=iso(now);incident.revision++;
    // Bind this final old-source transition to its original configuration.
    queueNotification(state,incident,'RETIRED',env,now);
  }
  state.config=config;state.configHash=digest;state.configRevision++;
  state.merchants=merchants;
}
function signalsFor(config,merchant,observation,previous,now) {
  const packet=observation.packet;
  if(!packet) return {signals:{ENDPOINT_UNAVAILABLE:{bad:true,values:{}}},error:observation.error};
  const o=packet.report.observation,captured=Date.parse(o.capturedAt),start=Date.parse(o.startedAt);
  const same=previous?.sessionId===o.sessionId;
  if(start>captured || captured>now+5000 || now-captured>30_000 ||
      (same&&(previous.startedAt!==o.startedAt||captured<Date.parse(previous.capturedAt)||
        cumulative.some(key=>o.totals[key]<previous.totals[key])||o.observerErrors<previous.observerErrors)))
    return {signals:{ENDPOINT_UNAVAILABLE:{bad:true,values:{}}},error:'SOURCE_COUNTER_OR_CLOCK_INVALID'};
  const minute=Math.floor(captured/60_000)*60_000;
  const windowStart=minute-(config.windowMinutes-1)*60_000;
  const buckets=o.minutes.filter(row=>Date.parse(row.minute)>=windowStart&&Date.parse(row.minute)<=minute);
  if(buckets.length!==config.windowMinutes || new Set(buckets.map(row=>row.minute)).size!==buckets.length ||
      buckets.some(row=>Date.parse(row.minute)%60_000!==0))
    return {signals:{ENDPOINT_UNAVAILABLE:{bad:true,values:{}}},error:'SOURCE_MINUTE_WINDOW_INVALID'};
  const totals=buckets.reduce((sum,row)=>{for(const key of ['responses','completed','serverError','disconnected'])sum[key]+=row[key];return sum;},
    {responses:0,completed:0,serverError:0,disconnected:0});
  const complete=o.attached&&o.observerErrors===0&&start<=windowStart;
  const traffic=(threshold,failures,requests)=>{
    if(!threshold)return {bad:null,values:{}};
    const percent=requests?failures*100/requests:0;
    const bad=failures>=threshold.minimum&&percent>=threshold.percent;
    return {bad:bad?true:complete?false:null,values:{requests,failures,percent,
      minimum:threshold.minimum,thresholdPercent:threshold.percent,windowMinutes:config.windowMinutes}};
  };
  const signals={ENDPOINT_UNAVAILABLE:{bad:false,values:{}},
    OBSERVER_INCOMPLETE:{bad:!o.attached||o.observerErrors>0,values:{observerErrors:o.observerErrors}},
    HTTP_5XX:traffic(config.httpErrors,totals.serverError,totals.responses),
    DISCONNECTED:traffic(config.disconnects,totals.disconnected,totals.completed)};
  if(merchant.delivery) {
    const d=observation.delivery;
    const available=d?.available===true;
    signals.DELIVERY_UNAVAILABLE={bad:available?false:merchant.delivery.required?true:null,values:{}};
    signals.DELIVERY_BACKLOG={bad:available?d.pending>0&&d.oldestPendingSeconds!==null&&
      d.oldestPendingSeconds>=merchant.delivery.oldestPendingSeconds:null,
      values:available?{pending:d.pending,oldestPendingSeconds:d.oldestPendingSeconds ?? 0,
        thresholdSeconds:merchant.delivery.oldestPendingSeconds}:{}};
    signals.DELIVERY_EXHAUSTED={bad:available?d.exhausted>=merchant.delivery.exhausted:null,
      values:available?{exhausted:d.exhausted,minimum:merchant.delivery.exhausted}:{}};
  }
  return {signals,packet,previous:{sessionId:o.sessionId,startedAt:o.startedAt,capturedAt:o.capturedAt,
    observerErrors:o.observerErrors,totals:Object.fromEntries(cumulative.map(key=>[key,o.totals[key]]))},
    window:{from:iso(windowStart),through:o.capturedAt,complete,sessionStartedAt:o.startedAt},error:null};
}
export function validateDelivery(value,now) {
  if(value?.schema!=='stellar-forge.sf98.operator-delivery.v1'||typeof value.available!=='boolean')
    throw new Error('SF93_DELIVERY_SOURCE_INVALID');
  if(!value.available)return {available:false};
  const fields=['originalNativeEvents','webhookAccepted','pending','retryDue','retryWaiting','exhausted'];
  if(fields.some(key=>!Number.isSafeInteger(value[key])||value[key]<0)||
      value.originalNativeEvents!==value.webhookAccepted+value.pending+value.exhausted||
      value.retryDue+value.retryWaiting!==value.pending ||
      !(value.oldestPendingSeconds===null||Number.isSafeInteger(value.oldestPendingSeconds)&&value.oldestPendingSeconds>=0)||
      !Number.isFinite(Date.parse(value.capturedAt))||Date.parse(value.capturedAt)>now+5000||
      now-Date.parse(value.capturedAt)>30_000) throw new Error('SF93_DELIVERY_SOURCE_INVALID');
  return {available:true,capturedAt:value.capturedAt,
    ...Object.fromEntries(fields.map(key=>[key,value[key]])),oldestPendingSeconds:value.oldestPendingSeconds};
}
export async function applyObservation(state,merchant,observation,saveCapture,env,now) {
  const row=state.merchants[merchant.id];
  const result=signalsFor(state.config,merchant,observation,row.previous,now);
  row.lastAttemptAt=iso(now);row.lastError=result.error ?? null;
  let currentCapture;
  const capture=async()=>{
    if(currentCapture!==undefined)return currentCapture;
    currentCapture=result.packet?await saveCapture(result.packet):null;
    row.captureState=currentCapture?'CAPTURED':result.packet?'STORAGE_LIMIT':'SOURCE_UNAVAILABLE';
    if(currentCapture)row.lastCapture=currentCapture;
    return currentCapture;
  };
  if(result.packet) {
    const changedSession=row.previous?.sessionId!==result.previous.sessionId;
    if(changedSession) {
      row.sessionsSeen++;
      // A new native observer starts a new history. No cumulative subtraction.
      for(const condition of Object.values(row.conditions)) {condition.badStreak=0;condition.goodStreak=0;}
    }
    row.previous=result.previous;row.lastSuccessAt=iso(now);row.window=result.window;
    if(!row.lastCapture||changedSession||now-Date.parse(row.lastCapture.generatedAt)>=state.config.captureEveryMs) await capture();
  }
  for(const kind of kinds) {
    const condition=row.conditions[kind]??={badStreak:0,goodStreak:0,lastState:'UNKNOWN',incidentId:null};
    const signal=result.signals[kind]??{bad:null,values:{}};
    condition.lastState=signal.bad===null?'UNKNOWN':signal.bad?'FAILING':'CLEAR';
    if(signal.bad===null) {condition.badStreak=0;condition.goodStreak=0;continue;}
    condition.badStreak=signal.bad?Math.min(100,condition.badStreak+1):0;
    condition.goodStreak=signal.bad?0:Math.min(100,condition.goodStreak+1);
    let incident=state.incidents.find(item=>item.id===condition.incidentId&&activeIncident(item));
    if(signal.bad) {
      if(!incident&&condition.badStreak>=state.config.failurePolls) {
        const before=result.packet?await capture():row.lastCapture;
        incident={id:randomUUID(),merchantId:merchant.id,merchantLabel:merchant.label,binding:row.binding,kind,
          status:'OPEN',revision:1,openedAt:iso(now),updatedAt:iso(now),lastObservedAt:iso(now),closedAt:null,
          sessionId:row.previous?.sessionId ?? null,lastSessionId:row.previous?.sessionId ?? null,
          signal:{...signal.values,consecutivePolls:condition.badStreak},
          acknowledgment:null,beforeCapture:before ?? null,afterCapture:null,notificationState:null};
        state.incidents.push(incident);condition.incidentId=incident.id;
        queueNotification(state,incident,'OPENED',env,now);
      } else if(incident) {
        incident.lastObservedAt=iso(now);incident.signal={...signal.values,consecutivePolls:condition.badStreak};
        incident.lastSessionId=row.previous?.sessionId ?? null;
      }
    } else if(incident&&condition.goodStreak>=state.config.recoveryPolls) {
      incident.status='RECOVERED';incident.closedAt=iso(now);incident.updatedAt=iso(now);incident.revision++;
      incident.afterCapture=await capture();incident.recoverySessionId=row.previous?.sessionId ?? null;
      incident.recoverySignal={...signal.values,consecutivePolls:condition.goodStreak};
      queueNotification(state,incident,'RECOVERED',env,now);condition.incidentId=null;
    }
  }
}
export function pruneRecords(state,now) {
  const keepEvents=new Set(state.notifications.filter(event=>!terminalNotification(event)).map(event=>event.id));
  state.notifications.filter(terminalNotification).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))
    .slice(0,state.config.retention.notifications).forEach(event=>keepEvents.add(event.id));
  state.notifications=state.notifications.filter(event=>keepEvents.has(event.id));
  const protectedIds=new Set(state.notifications.filter(event=>!terminalNotification(event)).map(event=>event.incidentId));
  const cutoff=now-state.config.retention.closedDays*86_400_000;
  const closed=state.incidents.filter(item=>!activeIncident(item)&&Date.parse(item.closedAt)>=cutoff)
    .sort((a,b)=>b.closedAt.localeCompare(a.closedAt)).slice(0,state.config.retention.closedIncidents);
  const keep=new Set(closed.map(item=>item.id));
  state.incidents=state.incidents.filter(item=>activeIncident(item)||protectedIds.has(item.id)||keep.has(item.id));
  const ids=new Set(state.incidents.map(item=>item.id));
  state.notifications=state.notifications.filter(event=>ids.has(event.incidentId));
}
