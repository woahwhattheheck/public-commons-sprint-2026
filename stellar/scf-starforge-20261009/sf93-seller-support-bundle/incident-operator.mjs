// MIT. Human operator changes and original SF74 support-file handoff.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {compileConfig,configHash,activeIncident} from './incident-config.mjs';
import {openIncidentStore,readPrivateFile,statusView} from './incident-store.mjs';
import {updateConfiguration,pruneRecords} from './incident-model.mjs';
import {queueNotification,destinationForEvent,MAX_PENDING,terminalNotification,updateIncidentNotificationState} from './notifications.mjs';
import {parseWorkspace,MAX_WORKSPACE_BYTES} from '../sf74-merchant-support-console/workspace-file.mjs';
import {inspectRuntimeFiles,exportRuntimeHandoff,RUNTIME_SCHEMA} from '../sf74-merchant-support-console/runtime-support.mjs';
import {caseMetadata} from '../sf74-merchant-support-console/case-store.mjs';

const fail=code=>{throw new Error('SF93_'+code);};
const note=value=>{
  if(typeof value!=='string'||Buffer.byteLength(value)>2000||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)||Buffer.from(value).toString('utf8')!==value)fail('NOTE_INVALID');
  return value;
};
function owner(value) {
  if(!value?.trim()||Buffer.byteLength(value)>160||/[\r\n\t]/.test(value))fail('OPERATOR_REQUIRED');
  return note(value);
}
function selectedIncident(state,id,revision) {
  const item=state.incidents.find(row=>row.id===id);
  if(!item)fail('INCIDENT_NOT_FOUND');
  if(!Number.isSafeInteger(revision)||revision!==item.revision)fail('INCIDENT_REVISION_CONFLICT');
  return item;
}
export async function configureIncidents({directory,config,expectedConfigRevision,environment=process.env}) {
  const normalized=compileConfig(config),store=await openIncidentStore(directory);
  return store.transaction(state=>{
    if(expectedConfigRevision!==state.configRevision)fail('CONFIGURATION_REVISION_CONFLICT');
    const digest=configHash(normalized);
    if(digest!==state.configHash)updateConfiguration(state,normalized,digest,environment,Date.now());
    return {configRevision:state.configRevision,configHash:state.configHash};
  });
}
export async function acknowledgeIncident({directory,id,expectedRevision,by,notes='',environment=process.env}) {
  by=owner(by);notes=note(notes);const store=await openIncidentStore(directory);
  return store.transaction(state=>{
    const incident=selectedIncident(state,id,expectedRevision);
    if(incident.status!=='OPEN')fail('INCIDENT_NOT_OPEN');
    const now=Date.now(),at=new Date(now).toISOString();
    incident.status='ACKNOWLEDGED';incident.revision++;incident.updatedAt=at;
    incident.acknowledgment={by,notes,at};queueNotification(state,incident,'ACKNOWLEDGED',environment,now);
    return structuredClone(incident);
  });
}
export async function remindIncident({directory,id,expectedRevision,environment=process.env}) {
  const store=await openIncidentStore(directory);
  return store.transaction(state=>{
    const incident=selectedIncident(state,id,expectedRevision);
    const event=queueNotification(state,incident,'REMINDER',environment,Date.now());
    return {incidentId:incident.id,eventId:event?.id ?? null,status:event?.status ?? incident.notificationIssue ?? incident.notificationState};
  });
}
export async function operateNotification({directory,id,expectedAttempts,action,by,environment=process.env}) {
  by=owner(by);const store=await openIncidentStore(directory);
  return store.transaction(state=>{
    const event=state.notifications.find(row=>row.id===id);
    if(!event)fail('NOTIFICATION_NOT_FOUND');
    if(expectedAttempts!==event.attempts)fail('NOTIFICATION_ATTEMPT_CONFLICT');
    if(event.status==='IN_FLIGHT')fail('NOTIFICATION_ATTEMPT_IN_FLIGHT');
    if(event.status==='DELIVERED'||event.status==='CANCELLED')fail('NOTIFICATION_ALREADY_FINISHED');
    if(!['retry','cancel'].includes(action))fail('NOTIFICATION_ACTION_INVALID');
    if(action==='cancel') {
      event.status='CANCELLED';event.lastReason='OPERATOR_CANCELLED';event.nextAttemptAt=null;
    } else {
      if(!['PAUSED','EXHAUSTED'].includes(event.status))fail('NOTIFICATION_ALREADY_SCHEDULED');
      const destination=destinationForEvent(state,event,environment);
      if(destination.reason)fail(destination.reason+'_USE_NOTIFY_FOR_A_NEW_DESTINATION');
      if(terminalNotification(event)&&state.notifications.filter(row=>!terminalNotification(row)).length>=MAX_PENDING)fail('NOTIFICATION_QUEUE_CAPACITY');
      const limit=event.attempts+state.config.notification.maxAttempts;
      if(limit>100_000)fail('NOTIFICATION_LIFETIME_ATTEMPT_LIMIT');
      event.status='RETRY';event.attemptLimit=limit;event.lastReason='OPERATOR_RETRY';event.nextAttemptAt=new Date().toISOString();
    }
    event.operatorAction={by,action,at:new Date().toISOString()};
    updateIncidentNotificationState(state,event);
    return {id:event.id,status:event.status,attempts:event.attempts,attemptLimit:event.attemptLimit};
  });
}
export async function pruneIncidents({directory}) {
  const store=await openIncidentStore(directory);
  return store.transaction(state=>{
    const before={incidents:state.incidents.length,notifications:state.notifications.length};
    pruneRecords(state,Date.now());
    return {removedIncidents:before.incidents-state.incidents.length,
      removedNotifications:before.notifications-state.notifications.length};
  });
}
export async function incidentStatus({directory,details=false}) {
  return statusView(await(await openIncidentStore(directory)).read(),{details});
}
export async function exportIncident({directory,id,expectedRevision,workspaceFile,routeId,out}) {
  const workspaceText=new TextDecoder('utf-8',{fatal:true}).decode(await readPrivateFile(resolve(workspaceFile),MAX_WORKSPACE_BYTES));
  const workspace=await parseWorkspace(workspaceText),store=await openIncidentStore(directory);
  const snapshot=await store.transaction(async(state,io)=>{
    const incident=selectedIncident(state,id,expectedRevision),files={};
    for(const side of ['before','after']) {
      const ref=incident[side+'Capture'];files[side]=ref?await io.readCapture(ref):null;
    }
    return {incident:structuredClone(incident),files};
  },{readonly:true});
  if(!snapshot.files.before&&!snapshot.files.after)fail('INCIDENT_HAS_NO_ORIGINAL_CAPTURE');
  const capture=files=>files?inspectRuntimeFiles({files:Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,bytes.toString('base64')])),
    inputs:workspace.inputs,routeId}).capture:null;
  const supportText=JSON.stringify({schema:RUNTIME_SCHEMA,before:capture(snapshot.files.before),after:capture(snapshot.files.after)},null,2)+'\n';
  const i=snapshot.incident,ack=i.acknowledgment;
  const metadata=caseMetadata({merchant:i.merchantLabel,owner:ack?.by ?? '',
    status:i.status==='RECOVERED'?'ready':activeIncident(i)?'in_progress':'waiting',followUpOn:'',
    nextAction:i.status==='RECOVERED'?'Review the recovered original seller capture in this case.':
      i.status==='RETIRED'?'Review the retired source registration and current merchant configuration.':'Resolve the active '+i.kind+' incident.',
    notes:`Original SF93 incident ${i.id}\nRegistered merchant: ${i.merchantId}\nCondition: ${i.kind}\nIncident state: ${i.status}\nOpened: ${i.openedAt}\nLast failing observation: ${i.lastObservedAt}\nClosed: ${i.closedAt ?? 'open'}\n`+
      (i.retiredReason?`Retirement: ${i.retiredReason}; this is not an observed recovery.\n`:'')+
      (ack?`Acknowledged: ${ack.at} by ${ack.by}\n${ack.notes}\n`:'No human acknowledgment recorded.\n')});
  const result=await exportRuntimeHandoff({workspaceText,supportText,metadata});
  const folder=resolve(out ?? '');if(!out||folder==='/'||folder===process.cwd())fail('NEW_EXPORT_DIRECTORY_REQUIRED');
  await mkdir(folder,{mode:0o700});
  const save=(path,bytes)=>writeFile(path,bytes,{flag:'wx',mode:0o600});
  await save(join(folder,'incident.json'),JSON.stringify(i,null,2)+'\n');
  await save(join(folder,'runtime-support.json'),supportText);
  await save(join(folder,'support-handoff.json'),result.handoff);
  await save(join(folder,'support.html'),result.html);
  for(const side of ['before','after'])if(snapshot.files[side]) {
    const path=join(folder,side);await mkdir(path,{mode:0o700});
    for(const [name,bytes] of Object.entries(snapshot.files[side]))await save(join(path,name),bytes);
  }
  return {out:folder,incidentId:i.id,revision:i.revision,comparison:result.report.comparison.state,
    captures:result.report.summary.captures,handoff:'support-handoff.json'};
}
