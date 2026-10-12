// MIT. Merchant incident operations composed with the original SF93 store and watcher.
import {realpath} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {openIncidentStore,readPrivateFile,statusView} from '../sf93-seller-support-bundle/incident-store.mjs';
import {configureIncidents,acknowledgeIncident,remindIncident,operateNotification} from '../sf93-seller-support-bundle/incident-operator.mjs';
import {runIncidentWatch} from '../sf93-seller-support-bundle/watch.mjs';
import {resolveDestination} from '../sf93-seller-support-bundle/notifications.mjs';
import {inspectSlackDestination} from '../sf93-seller-support-bundle/notifications-slack.mjs';
import {activeIncident,idPattern,kinds} from '../sf93-seller-support-bundle/incident-config.mjs';
import {parseWorkspace,MAX_WORKSPACE_BYTES} from './workspace-file.mjs';
import {inspectRuntimeFiles,exportRuntimeHandoff,RUNTIME_SCHEMA} from './runtime-support.mjs';
import {caseMetadata} from './case-store.mjs';

export const INCIDENT_SOURCES_SCHEMA='stellar-forge.support-incident-sources.v1';
const MAX_CONFIG_BYTES=65_536;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SOURCE_ID=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const STATUSES=['OPEN','ACKNOWLEDGED','RECOVERED','RETIRED'];
const decoder=new TextDecoder('utf-8',{fatal:true});
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const fail=(code,detail,status=400)=>Object.assign(new Error(detail),{code,status});
function fields(value,allowed,label) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))
    throw fail('INCIDENT_INPUT_INVALID','Invalid '+label);
  return value;
}
function text(value,maximum,label,{empty=false}={}) {
  if(typeof value!=='string'||!empty&&!value.trim()||Buffer.byteLength(value)>maximum||
      Buffer.from(value).toString('utf8')!==value||/[\u0000-\u001f\u007f]/.test(value))
    throw fail('INCIDENT_INPUT_INVALID','Invalid '+label);
  return value;
}
function integer(value,minimum,maximum,label) {
  if(typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value))value=Number(value);
  if(!Number.isSafeInteger(value)||value<minimum||value>maximum)
    throw fail('INCIDENT_INPUT_INVALID','Invalid '+label);
  return value;
}
function identifier(value,label) {
  if(typeof value!=='string'||!UUID.test(value))throw fail('INCIDENT_INPUT_INVALID','Invalid '+label);
  return value;
}
function expectedRevision(value) {return integer(value,1,Number.MAX_SAFE_INTEGER,'incident revision');}
function currentIncident(state,id,revision) {
  const incident=state.incidents.find(row=>row.id===id);
  if(!incident)throw fail('INCIDENT_NOT_FOUND','Incident was not found in this source.',404);
  if(revision!==undefined&&incident.revision!==revision)
    throw fail('INCIDENT_REVISION_CONFLICT','Incident changed. Refresh it before continuing.',409);
  return incident;
}
function latestNotificationId(state,incidentId) {
  for(let index=state.notifications.length-1;index>=0;index--)
    if(state.notifications[index].incidentId===incidentId)return state.notifications[index].id;
  return null;
}
function checkConfiguration(state,expected) {
  if(state.configRevision!==expected)
    throw fail('INCIDENT_CONFIGURATION_CONFLICT','Watcher configuration changed. Refresh it before continuing.',409);
}
const publicSource=source=>({id:source.id,label:source.label});
const encodedFiles=files=>Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,bytes.toString('base64')]));

const ORIGINAL_PROBLEMS={
  SF93_INCIDENT_NOT_FOUND:[404,'Incident was not found in this source.'],
  SF93_NOTIFICATION_NOT_FOUND:[404,'Notification was not found in this source.'],
  SF93_INCIDENT_REVISION_CONFLICT:[409,'Incident changed. Refresh it before continuing.'],
  SF93_CONFIGURATION_REVISION_CONFLICT:[409,'Watcher configuration changed. Refresh it before continuing.'],
  SF93_CONFIGURATION_DIGEST_CONFLICT:[409,'Watcher configuration changed. Refresh it before starting.'],
  SF93_NOTIFICATION_ATTEMPT_CONFLICT:[409,'Notification attempts changed. Refresh its current state.'],
  SF93_NOTIFICATION_SELECTION_CONFLICT:[409,'A newer notification exists. Refresh the incident before notifying again.'],
  SF93_NOTIFICATION_ATTEMPT_IN_FLIGHT:[409,'The original watcher is delivering this notification.'],
  SF93_NOTIFICATION_ALREADY_FINISHED:[409,'This notification is already finished.'],
  SF93_NOTIFICATION_ALREADY_SCHEDULED:[409,'This notification is already scheduled by the original queue.'],
  SF93_INCIDENT_NOT_OPEN:[409,'Only an open incident can be acknowledged.'],
  SF93_INCIDENT_HAS_NO_ORIGINAL_CAPTURE:[409,'This incident has no retained original capture to attach.'],
  SF93_NOTIFICATION_QUEUE_CAPACITY:[409,'The original notification queue is full. Resolve its existing events before retrying.'],
  SF93_NOTIFICATION_LIFETIME_ATTEMPT_LIMIT:[409,'This notification reached its original lifetime attempt limit.'],
  SF93_STATE_BUSY:[409,'Another original incident operation currently owns the state transaction.'],
  FLEET_STATE_ALREADY_OWNED:[409,'Another watcher owns this source\'s original worker lease.'],
};
/** Stable API problems omit filesystem paths, credential values and raw transport errors. */
export function incidentProblem(error) {
  if(typeof error?.code==='string'&&error.code.startsWith('INCIDENT_')&&
      Number.isInteger(error.status)&&error.status>=400&&error.status<=599)
    return {status:error.status,error:error.code,detail:error.message};
  const message=String(error?.message??'');
  const code=/^(SF93_[A-Z0-9_]+|FLEET_[A-Z0-9_]+)/.exec(message)?.[1];
  if(code&&ORIGINAL_PROBLEMS[code]) {
    const [status,detail]=ORIGINAL_PROBLEMS[code];return {status,error:code,detail};
  }
  if(code==='SF93_CONFIG_INVALID')
    return {status:422,error:code,detail:'Invalid watcher configuration: '+message.slice(message.indexOf(':')+1).trim().slice(0,160)};
  if(code) {
    const invalid=code.includes('INVALID')||code.includes('REQUIRED');
    return {status:invalid?422:409,error:code,
      detail:invalid?'The original incident operation rejected an invalid input or private state.':
        'The original incident operation could not proceed: '+code+'.'};
  }
  if(['ENOENT','EACCES','EPERM','ELOOP','ENOTDIR','EIO','ENOSPC','EROFS'].includes(error?.code))
    return {status:503,error:'INCIDENT_STORE_UNAVAILABLE',
      detail:'The configured original incident store is unavailable ('+error.code+').'};
  if(error instanceof TypeError||error instanceof SyntaxError)
    return {status:422,error:'INCIDENT_INPUT_INVALID',detail:message.slice(0,300)||'Invalid incident input.'};
  if(typeof error?.code==='string'&&Number.isInteger(error.status)&&error.status>=400&&error.status<=499)
    return {status:error.status,error:error.code,detail:message.slice(0,300)};
  return {status:500,error:'INCIDENT_OPERATION_FAILED',detail:'The original incident operation failed.'};
}

/** Bind configured IDs to initialized private stores. Browser input never selects a path. */
export async function openIncidentSources({configPath,environment=process.env}={}) {
  const sources=new Map(),workers=new Map();
  let closing=false,closePromise=null;
  if(configPath!==undefined&&configPath!==null) {
    const path=resolve(text(configPath,4096,'incident sources configuration path'));
    let config;
    try {config=JSON.parse(decoder.decode(await readPrivateFile(path,MAX_CONFIG_BYTES)));}
    catch(error) {
      if(error instanceof SyntaxError)throw fail('INCIDENT_SOURCES_CONFIG_INVALID','Incident sources configuration must be UTF-8 JSON.',422);
      throw error;
    }
    fields(config,['schema','sources'],'incident sources configuration');
    if(config.schema!==INCIDENT_SOURCES_SCHEMA||!Array.isArray(config.sources)||config.sources.length>8)
      throw fail('INCIDENT_SOURCES_CONFIG_INVALID','Use the original incident sources schema with at most eight sources.',422);
    const directories=new Set();
    for(const entry of config.sources) {
      fields(entry,['id','label','directory'],'incident source');
      const id=text(entry.id,64,'source ID');
      if(!SOURCE_ID.test(id)||['profiles','__proto__','constructor','prototype'].includes(id)||sources.has(id))
        throw fail('INCIDENT_SOURCES_CONFIG_INVALID','Source IDs must be distinct lowercase identifiers; profiles is reserved.',422);
      const label=text(entry.label??id,120,'source label');
      const configured=resolve(dirname(path),text(entry.directory,4096,'source directory'));
      // Validate the named private directory before canonicalizing ancestor aliases.
      const original=await openIncidentStore(configured);
      const directory=await realpath(original.root);
      if(directories.has(directory))
        throw fail('INCIDENT_SOURCES_CONFIG_INVALID','Each original incident store may have only one source ID.',422);
      const store=directory===original.root?original:await openIncidentStore(directory);
      await store.read();
      directories.add(directory);sources.set(id,{id,label,directory,store,routeCache:new Map()});
    }
  }
  function sourceFor(id) {
    if(closing)throw fail('INCIDENT_SOURCES_CLOSED','The incident console is closing.',503);
    if(typeof id!=='string'||!sources.has(id))
      throw fail('INCIDENT_SOURCE_NOT_FOUND','Configured incident source was not found.',404);
    return sources.get(id);
  }
  function workerView(source,state) {
    const entry=workers.get(source.id),recorded=state.worker?structuredClone(state.worker):null;
    const active=entry?.active===true;
    const external=!active&&recorded?.status==='RUNNING'&&recorded.instanceId!==entry?.instanceId;
    return {ownership:active?'console':external?'external':'none',
      status:active?entry.phase:external?'RUNNING':entry?.error?'FAILED':recorded?.status??'STOPPED',
      canStart:!closing&&!active,canStop:active&&entry.phase!=='STOPPING',
      recorded,error:entry?.error??null};
  }
  const snapshot=async source=>({source:publicSource(source),worker:workerView(source,await source.store.read())});
  const profiles=()=>({schema:INCIDENT_SOURCES_SCHEMA,sources:[...sources.values()].map(publicSource)});
  async function list(sourceId,filters={}) {
    const source=sourceFor(sourceId);
    fields(filters,['q','status','merchant','kind','offset','limit'],'incident filters');
    const q=text(filters.q??'',800,'search query',{empty:true});
    if(q.length>200)throw fail('INCIDENT_INPUT_INVALID','Search query exceeds 200 characters.');
    const status=text(filters.status??'',32,'status filter',{empty:true});
    const merchant=text(filters.merchant??'',64,'merchant filter',{empty:true});
    const kind=text(filters.kind??'',64,'condition filter',{empty:true});
    if(status&&!STATUSES.includes(status)||kind&&!kinds.includes(kind)||merchant&&!idPattern.test(merchant))
      throw fail('INCIDENT_INPUT_INVALID','Unknown incident filter.');
    const offset=integer(filters.offset??0,0,Number.MAX_SAFE_INTEGER,'page offset');
    const limit=integer(filters.limit??20,1,100,'page limit');
    const state=await source.store.read(),view=statusView(state),query=q.trim().toLowerCase();
    const originals=new Map(state.incidents.map(row=>[row.id,row]));
    const latest=new Map();
    for(const event of state.notifications)latest.set(event.incidentId,event.id);
    const rows=view.incidents.map(row=>({...row,merchantLabel:originals.get(row.id).merchantLabel,
      latestNotificationId:latest.get(row.id)??null}));
    const selected=rows.filter(row=>(!status||row.status===status)&&(!merchant||row.merchantId===merchant)&&
      (!kind||row.kind===kind)&&(!query||[row.id,row.merchantId,row.merchantLabel,row.kind,row.status,row.acknowledgedBy]
        .filter(Boolean).join(' ').toLowerCase().includes(query)))
      .sort((a,b)=>b.openedAt.localeCompare(a.openedAt)||a.id.localeCompare(b.id));
    const counts=Object.fromEntries(STATUSES.map(name=>[name,0]));
    for(const row of state.incidents)counts[row.status]++;
    const counters={total:state.incidents.length,active:counts.OPEN+counts.ACKNOWLEDGED,
      open:counts.OPEN,acknowledged:counts.ACKNOWLEDGED,recovered:counts.RECOVERED,retired:counts.RETIRED,
      pendingNotifications:0,pausedNotifications:0,exhaustedNotifications:0,
      notificationCapacityEvents:state.notificationCapacityEvents??0};
    for(const event of state.notifications) {
      if(['PENDING','RETRY','IN_FLIGHT'].includes(event.status))counters.pendingNotifications++;
      else if(event.status==='PAUSED')counters.pausedNotifications++;
      else if(event.status==='EXHAUSTED')counters.exhaustedNotifications++;
    }
    return {source:publicSource(source),revision:state.revision,configRevision:state.configRevision,
      configHash:state.configHash,config:structuredClone(state.config),worker:workerView(source,state),counters,
      merchants:state.config.merchants.map(({id,label})=>({id,label})),filters:{q,status,merchant,kind},
      page:{offset,limit,total:selected.length,hasMore:offset+limit<selected.length},
      incidents:selected.slice(offset,offset+limit)};
  }
  async function view(sourceId,incidentId) {
    const source=sourceFor(sourceId);identifier(incidentId,'incident ID');
    return source.store.transaction(async(state,io)=>{
      const incident=currentIncident(state,incidentId),routes=new Map(),captureProblems={};
      for(const side of ['before','after']) {
        const ref=incident[side+'Capture'];if(!ref)continue;
        try {
          // Immutable capture hashes share the original parser result across
          // detail refreshes. Preparing a case always rereads exact file bytes.
          let available=source.routeCache.get(ref.id);
          if(!available) {
            const files=await io.readCapture(ref);
            available=inspectRuntimeFiles({files:encodedFiles(files)}).routes.map(route=>({
              id:route.id,method:route.method,...(route.path===undefined?{}:{path:route.path})}));
            source.routeCache.set(ref.id,available);
            if(source.routeCache.size>64)source.routeCache.delete(source.routeCache.keys().next().value);
          }
          for(const route of available) {
            const key=JSON.stringify(route),row=routes.get(key)??{...route,sides:[]};
            row.sides.push(side);routes.set(key,row);
          }
        } catch(error) {
          const problem=incidentProblem(error);
          captureProblems[side]={error:problem.error,detail:problem.detail};
        }
      }
      const notifications=statusView(state).notifications.filter(event=>event.incidentId===incidentId);
      return {source:publicSource(source),revision:state.revision,configRevision:state.configRevision,
        configHash:state.configHash,worker:workerView(source,state),incident:structuredClone(incident),
        latestNotificationId:latestNotificationId(state,incidentId),notifications,
        routes:[...routes.values()],captureProblems};
    },{readonly:true});
  }
  async function configure(sourceId,input) {
    const source=sourceFor(sourceId);fields(input,['config','expectedConfigRevision'],'configuration change');
    return configureIncidents({directory:source.directory,config:input.config,
      expectedConfigRevision:integer(input.expectedConfigRevision,1,Number.MAX_SAFE_INTEGER,'configuration revision'),environment});
  }
  async function acknowledge(sourceId,incidentId,input) {
    const source=sourceFor(sourceId);identifier(incidentId,'incident ID');
    fields(input,['expectedRevision','by','notes'],'acknowledgment');
    return acknowledgeIncident({directory:source.directory,id:incidentId,expectedRevision:expectedRevision(input.expectedRevision),
      by:input.by,notes:input.notes??'',environment});
  }
  async function notify(sourceId,incidentId,input) {
    const source=sourceFor(sourceId);identifier(incidentId,'incident ID');
    fields(input,['expectedRevision','expectedNotificationId'],'notification request');
    if(!own(input,'expectedNotificationId')||input.expectedNotificationId!==null&&
        (typeof input.expectedNotificationId!=='string'||!UUID.test(input.expectedNotificationId)))
      throw fail('INCIDENT_INPUT_INVALID','Supply the last observed notification ID, or null when none exists.');
    return remindIncident({directory:source.directory,id:incidentId,expectedRevision:expectedRevision(input.expectedRevision),
      expectedNotificationId:input.expectedNotificationId,environment});
  }
  async function notification(sourceId,eventId,input) {
    const source=sourceFor(sourceId);identifier(eventId,'notification ID');
    fields(input,['expectedAttempts','action','by'],'notification operation');
    if(!['retry','cancel'].includes(input.action))throw fail('INCIDENT_INPUT_INVALID','Choose retry or cancel.');
    return operateNotification({directory:source.directory,id:eventId,
      expectedAttempts:integer(input.expectedAttempts,0,100_000,'notification attempt count'),
      action:input.action,by:input.by,environment});
  }
  async function inspectDestination(sourceId,input) {
    const source=sourceFor(sourceId);fields(input,['expectedConfigRevision'],'destination inspection');
    const expected=integer(input.expectedConfigRevision,1,Number.MAX_SAFE_INTEGER,'configuration revision');
    const state=await source.store.read();checkConfiguration(state,expected);
    const selected=resolveDestination(state.config,environment);
    const result=selected.reason?{accepted:false,reason:selected.reason}:
      selected.transport==='slack'?await inspectSlackDestination(selected,state.config.notification):
        {accepted:true,reason:'WEBHOOK_CONFIGURATION_RESOLVED',destinationId:selected.binding.id};
    return {source:publicSource(source),configRevision:state.configRevision,configHash:state.configHash,...result};
  }
  async function start(sourceId,input) {
    const source=sourceFor(sourceId);fields(input,['expectedConfigRevision','expectedConfigHash'],'watcher start');
    const expectedConfigRevision=integer(input.expectedConfigRevision,1,Number.MAX_SAFE_INTEGER,'configuration revision');
    const expectedConfigHash=input.expectedConfigHash;
    if(typeof expectedConfigHash!=='string'||!/^[a-f0-9]{64}$/.test(expectedConfigHash))
      throw fail('INCIDENT_INPUT_INVALID','Supply the observed configuration digest.');
    if(workers.get(sourceId)?.active)
      throw fail('INCIDENT_WORKER_ALREADY_STARTED','This console already owns the source watcher.',409);
    const controller=new AbortController();
    let readyResolve,readyReject,readySettled=false;
    const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
    const entry={controller,active:true,phase:'STARTING',instanceId:null,error:null,done:null};
    workers.set(sourceId,entry);
    entry.done=Promise.resolve().then(()=>runIncidentWatch({directory:source.directory,environment,
      signal:controller.signal,expectedConfigRevision,expectedConfigHash,
      onReady(info) {
        entry.instanceId=info.instanceId;entry.phase=controller.signal.aborted?'STOPPING':'RUNNING';
        readySettled=true;readyResolve(info);
      }})).then(result=>{
        entry.active=false;entry.phase='STOPPED';
        if(!readySettled){readySettled=true;readyReject(fail('INCIDENT_WORKER_STOPPED','Watcher stopped before becoming ready.',409));}
        return {result};
      },error=>{
        entry.active=false;entry.phase='FAILED';entry.error=incidentProblem(error).error;
        if(!readySettled){readySettled=true;readyReject(error);}
        return {error};
      });
    await ready;
    return snapshot(source);
  }
  async function stop(sourceId) {
    const source=sourceFor(sourceId),entry=workers.get(sourceId);
    if(!entry)throw fail('INCIDENT_WORKER_NOT_OWNED','This console did not start the source watcher.',409);
    if(entry.active){entry.phase='STOPPING';entry.controller.abort();}
    await entry.done;
    return snapshot(source);
  }
  function close() {
    if(closePromise)return closePromise;
    closing=true;
    const owned=[...workers.values()].filter(entry=>entry.active);
    for(const entry of owned){entry.phase='STOPPING';entry.controller.abort();}
    closePromise=Promise.all(owned.map(entry=>entry.done)).then(()=>undefined);
    return closePromise;
  }
  async function prepareCase(sourceId,incidentId,input) {
    const source=sourceFor(sourceId);identifier(incidentId,'incident ID');
    fields(input,['expectedRevision','workspaceText','routeId'],'incident case handoff');
    const revision=expectedRevision(input.expectedRevision);
    if(typeof input.workspaceText!=='string'||Buffer.byteLength(input.workspaceText)>MAX_WORKSPACE_BYTES)
      throw fail('INCIDENT_INPUT_INVALID','Supply the current serialized merchant workspace within its original size limit.');
    const workspaceText=input.workspaceText,workspace=await parseWorkspace(workspaceText);
    const routeId=text(input.routeId,80,'selected merchant route');
    const retained=await source.store.transaction(async(state,io)=>{
      const incident=currentIncident(state,incidentId,revision),files={};
      for(const side of ['before','after']) {
        const ref=incident[side+'Capture'];files[side]=ref?await io.readCapture(ref):null;
      }
      return {incident:structuredClone(incident),files};
    },{readonly:true});
    if(!retained.files.before&&!retained.files.after)
      throw fail('INCIDENT_NO_CAPTURE','This incident has no retained original capture to attach.',409);
    const capture=files=>files?inspectRuntimeFiles({files:encodedFiles(files),inputs:workspace.inputs,routeId}).capture:null;
    const supportText=JSON.stringify({schema:RUNTIME_SCHEMA,
      before:capture(retained.files.before),after:capture(retained.files.after)},null,2)+'\n';
    const incident=retained.incident,ack=incident.acknowledgment;
    const metadata=caseMetadata({merchant:incident.merchantLabel,owner:ack?.by??'',
      status:incident.status==='RECOVERED'?'ready':activeIncident(incident)?'in_progress':'waiting',followUpOn:'',
      nextAction:incident.status==='RECOVERED'?'Review the recovered original seller capture in this case.':
        incident.status==='RETIRED'?'Review the retired source registration and current merchant configuration.':
          'Resolve the active '+incident.kind+' incident.',
      notes:'Original SF93 incident '+incident.id+'\nRegistered merchant: '+incident.merchantId+
        '\nCondition: '+incident.kind+'\nIncident state: '+incident.status+'\nOpened: '+incident.openedAt+
        '\nLast failing observation: '+incident.lastObservedAt+'\nClosed: '+(incident.closedAt??'open')+'\n'+
        (incident.retiredReason?'Retirement: '+incident.retiredReason+'; this is a registration change.\n':'')+
        (ack?'Acknowledged: '+ack.at+' by '+ack.by+'\n'+ack.notes+'\n':'No human acknowledgment recorded.\n')});
    const result=await exportRuntimeHandoff({workspaceText,supportText,metadata});
    return {source:publicSource(source),incidentId,revision,
      handoff:result.handoff,html:result.html,report:result.report};
  }
  return {profiles,list,view,configure,acknowledge,notify,notification,inspectDestination,start,stop,close,prepareCase};
}

