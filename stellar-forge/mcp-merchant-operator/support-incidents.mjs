// MIT. Host-declared incident sources over the original SF74/SF93 lifecycle.
import { openIncidentSources, incidentProblem } from '../../stellar/scf-starforge-20261009/sf74-merchant-support-console/incident-sources.mjs';
import { importRuntimeHandoff, inspectRuntimeFiles } from '../../stellar/scf-starforge-20261009/sf74-merchant-support-console/runtime-support.mjs';
import { openIncidentStore, statusView } from '../../stellar/scf-starforge-20261009/sf93-seller-support-bundle/incident-store.mjs';
import { incidentStatus } from '../../stellar/scf-starforge-20261009/sf93-seller-support-bundle/incident-operator.mjs';
import { resolveDestination } from '../../stellar/scf-starforge-20261009/sf93-seller-support-bundle/notifications.mjs';
import { inspectSlackDestination } from '../../stellar/scf-starforge-20261009/sf93-seller-support-bundle/notifications-slack.mjs';
import { failure } from './host-files.mjs';

const SCHEMA='stellar-forge.merchant-support-incident-sources.v1';
const sourceNames=new Set(['merchant_support_profiles','merchant_support_configure','merchant_support_watch_status',
  'merchant_support_watch_start','merchant_support_watch_stop','merchant_notifications','merchant_incident_notify',
  'merchant_notification_update','merchant_incidents','merchant_incident_ack','merchant_incident_case']);
const addedNames=new Set(['merchant_support_incident_sources','merchant_support_destination','merchant_incident_view']);
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const statuses=['OPEN','ACKNOWLEDGED','RECOVERED','RETIRED'];
const notificationStates=['PENDING','RETRY','IN_FLIGHT','PAUSED','EXHAUSTED','DELIVERED','CANCELLED'];
const fail=(code,message,status=400)=>Object.assign(failure(code,message),{status});
const uuid=value=>{if(typeof value!=='string'||!UUID.test(value))throw fail('INVALID_CASE_ID','Use an original incident, notification, case or watcher UUID.');return value;};
const integer=(value,label,min=0)=>{if(!Number.isSafeInteger(value)||value<min)throw fail('INVALID_PARAMS','Use the current original '+label+'.');return value;};
const digest=value=>{if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw fail('INVALID_PARAMS','Use the exact inspected original SHA-256.');return value;};
const projection=value=>({schema:value.schema,sha256:value.sha256,
  sources:value.sources.map(({id,label,directory})=>({id,label,directory}))});
const publicSource=value=>value?{id:value.id,label:value.label}:null;
function pagination(args){
  const offset=integer(args.offset??0,'page offset'),limit=integer(args.limit??50,'page limit',1);
  if(limit>100)throw fail('INVALID_PARAMS','Use a page limit from 1 to 100.');
  return {offset,limit};
}
function pageRows(rows,{offset,limit}){
  return {total:rows.length,offset,limit,nextOffset:offset+limit<rows.length?offset+limit:null};
}
function latestNotifications(state){
  const values=new Map();for(const event of state.notifications)values.set(event.incidentId,event.id);return values;
}
async function originalView(directory,id){
  uuid(id);
  return (await openIncidentStore(directory)).transaction(async(state,io)=>{
    const incident=state.incidents.find(value=>value.id===id);
    if(!incident)throw fail('SF93_INCIDENT_NOT_FOUND','The incident was not found in this original store.',404);
    const routes=new Map(),captureProblems={};
    for(const side of ['before','after']){
      const ref=incident[side+'Capture'];if(!ref)continue;
      try{
        const files=await io.readCapture(ref);
        const encoded=Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,bytes.toString('base64')]));
        for(const route of inspectRuntimeFiles({files:encoded}).routes){
          const value={id:route.id,method:route.method,...(route.path===undefined?{}:{path:route.path})};
          const key=JSON.stringify(value),retained=routes.get(key)??{...value,sides:[]};
          retained.sides.push(side);routes.set(key,retained);
        }
      }catch(error){const problem=incidentProblem(error);captureProblems[side]={error:problem.error,detail:problem.detail};}
    }
    return {revision:state.revision,configRevision:state.configRevision,configHash:state.configHash,
      incident:structuredClone(incident),latestNotificationId:latestNotifications(state).get(id)??null,
      notifications:statusView(state).notifications.filter(value=>value.incidentId===id),
      routes:[...routes.values()],captureProblems};
  },{readonly:true});
}

export class MerchantSupportIncidentSources {
  #config;#callbacks;#environment;#opening;#manager;#closing=false;#close;
  #lifecycle=new Set();#started=new Map();#exits=new Map();
  constructor(config,callbacks,{environment=process.env}={}){
    this.#config=config;this.#callbacks=callbacks;this.#environment=environment;
  }
  get configured(){return Boolean(this.#config?.incidentSourcesFile);}
  handles(name){return addedNames.has(name)||this.configured&&sourceNames.has(name);}
  get summary(){
    return {mode:this.configured?'sources':'legacy',configured:Boolean(this.configured||this.#config?.incidentsDirectory),
      sourceConfigurationSha256:this.#config?.incidentSources?.sha256??null,
      defaultIncidentSource:this.#config?.defaultIncidentSource??(this.#config?.incidentSources?.sources.length===1?this.#config.incidentSources.sources[0].id:null),
      sources:(this.#config?.incidentSources?.sources??[]).map(publicSource),closing:this.#closing};
  }
  async #open(){
    if(this.#closing)throw fail('OPERATOR_CLOSING','Merchant support is closing.',503);
    if(!this.configured)return null;
    if(!this.#opening){
      const opening=(async()=>{
        const manager=await openIncidentSources({configPath:this.#config.incidentSourcesFile,environment:this.#environment});
        try{
          if(JSON.stringify(projection(manager.configuration()))!==JSON.stringify(this.#config.incidentSources))
            throw fail('SUPPORT_INCIDENT_SOURCES_CHANGED','The host incident source selection changed. Review and restart the original merchant configuration.',409);
          if(this.#closing)throw fail('OPERATOR_CLOSING','Merchant support is closing.',503);
          this.#manager=manager;return manager;
        }catch(error){await manager.close();throw error;}
      })();
      this.#opening=opening;
      // A transient original-store failure may recover. Every new opening still
      // checks the same host-selected bytes and canonical store identities.
      opening.catch(()=>{if(this.#opening===opening)this.#opening=null;});
    }
    return this.#opening;
  }
  #source(args){
    if(!this.configured){
      if(args.incidentSource!==undefined)
        throw fail('SUPPORT_INCIDENT_SOURCE_NOT_FOUND','This connection uses its original single incident store; omit incidentSource or select a host source file.',404);
      if(!this.#config?.incidentsDirectory)throw fail('INCIDENTS_NOT_CONFIGURED','Register an existing original incident store or source file on the host.');
      return null;
    }
    const entries=this.#config.incidentSources.sources;
    const id=args.incidentSource??this.#config.defaultIncidentSource??(entries.length===1?entries[0].id:undefined);
    const selected=entries.find(value=>value.id===id);
    if(!selected)throw fail('SUPPORT_INCIDENT_SOURCE_NOT_FOUND','Choose incidentSource from merchant_support_incident_sources.',404);
    return selected;
  }
  #directory(source){return source?.directory??this.#config.incidentsDirectory;}
  async #status(source,manager){
    const state=await manager.list(source.id,{limit:1}),worker=state.worker,started=this.#started.get(source.id);
    const owned=worker.ownership==='console'?{
      instanceId:worker.recorded?.instanceId??started?.instanceId??null,state:worker.status,
      startedConfiguration:started?.configuration??null}:null;
    return {schema:'stellar-forge.merchant-support-watch.v1',incidentSource:publicSource(source),
      configRevision:state.configRevision,configHash:state.configHash,worker:worker.recorded,
      owned,lastOwnedExit:this.#exits.get(source.id)??null,watcher:worker};
  }
  async #withLifecycle(source,action){
    if(this.#lifecycle.has(source.id))throw fail('INCIDENT_WATCH_BUSY','The original source watcher is starting or stopping. Read its current status.',409);
    this.#lifecycle.add(source.id);try{return await action();}finally{this.#lifecycle.delete(source.id);}
  }
  async #start(source,manager,args){
    integer(args.expectedConfigRevision,'configuration revision',1);digest(args.expectedConfigHash);
    return this.#withLifecycle(source,async()=>{
      const result=await manager.start(source.id,{expectedConfigRevision:args.expectedConfigRevision,expectedConfigHash:args.expectedConfigHash});
      const instanceId=result.worker.recorded?.instanceId;
      if(!instanceId){
        await manager.stop(source.id);
        throw fail('INCIDENT_WATCH_NOT_STARTED','The original watcher did not retain its started instance.',409);
      }
      this.#started.set(source.id,{instanceId,configuration:{configRevision:args.expectedConfigRevision,configHash:args.expectedConfigHash}});
      this.#exits.delete(source.id);
      return this.#status(source,manager);
    });
  }
  async #stop(source,manager,args){
    uuid(args.instanceId);
    return this.#withLifecycle(source,async()=>{
      const started=this.#started.get(source.id),prior=this.#exits.get(source.id);
      if(!started||started.instanceId!==args.instanceId){
        if(prior?.instanceId===args.instanceId&&prior.state==='STOPPED')return {...await this.#status(source,manager),unchanged:true};
        throw fail('INCIDENT_WATCH_INSTANCE_CONFLICT','This MCP operator does not own that source watcher instance. Read its current status.',409);
      }
      const result=await manager.stop(source.id);
      const stopped={instanceId:args.instanceId,state:result.worker.error?'FAILED':'STOPPED',
        completedAt:new Date().toISOString(),code:result.worker.error??null};
      this.#exits.set(source.id,stopped);this.#started.delete(source.id);
      return this.#status(source,manager);
    });
  }
  async #destination(source,manager,args){
    integer(args.expectedConfigRevision,'configuration revision',1);
    if(manager)return manager.inspectDestination(source.id,{expectedConfigRevision:args.expectedConfigRevision});
    const state=await (await openIncidentStore(this.#directory(source))).read();
    if(state.configRevision!==args.expectedConfigRevision)throw fail('SF93_CONFIGURATION_REVISION_CONFLICT','The original configuration changed. Inspect it again before checking the destination.',409);
    const selected=resolveDestination(state.config,this.#environment);
    const result=selected.reason?{accepted:false,reason:selected.reason}:selected.transport==='slack'
      ?await inspectSlackDestination(selected,state.config.notification)
      :{accepted:true,reason:'WEBHOOK_CONFIGURATION_RESOLVED',destinationId:selected.binding.id};
    return {configRevision:state.configRevision,configHash:state.configHash,...result};
  }
  async call(name,args={}){
    const manager=await this.#open();
    if(name==='merchant_support_incident_sources')return {schema:SCHEMA,...this.summary};
    const source=this.#source(args),selected=publicSource(source);
    try{
      if(name==='merchant_support_destination')return {...await this.#destination(source,manager,args),incidentSource:selected};
      if(name==='merchant_incident_view'){
        const result=manager?await manager.view(source.id,uuid(args.id)):await originalView(this.#directory(source),args.id);
        return {...result,incidentSource:selected};
      }
      if(!manager)throw fail('SUPPORT_INCIDENT_SOURCES_REQUIRED','Select the original incident source file in the host support connection.');
      switch(name){
        case 'merchant_support_profiles':{
          const current=await manager.list(source.id,{limit:1});
          const state={configRevision:current.configRevision,configHash:current.configHash,configuration:current.config};
          if(args.profile===undefined)return {incidentSource:selected,profiles:this.#callbacks.profiles(),current:state};
          const profile=await this.#callbacks.profile(args.profile);
          return {...profile,incidentSource:selected,current:state,matchesCurrent:profile.configHash===current.configHash,
            changes:this.#callbacks.configurationChanges(current.config,profile.configuration)};
        }
        case 'merchant_support_configure':{
          const profile=await this.#callbacks.profile(args.profile,args.expectedSourceSha256);
          digest(args.expectedSourceSha256);
          const result=await manager.configure(source.id,{config:profile.configuration,expectedConfigRevision:args.expectedConfigRevision});
          return {...result,incidentSource:selected,profile:profile.profile,sourceSha256:profile.sourceSha256,
            unchanged:result.configRevision===args.expectedConfigRevision};
        }
        case 'merchant_support_watch_status':return this.#status(source,manager);
        case 'merchant_support_watch_start':return this.#start(source,manager,args);
        case 'merchant_support_watch_stop':return this.#stop(source,manager,args);
        case 'merchant_notifications':{
          const state=await incidentStatus({directory:source.directory}),page=pagination(args);
          if(args.id!==undefined)uuid(args.id);if(args.incidentId!==undefined)uuid(args.incidentId);
          if(args.status!==undefined&&!notificationStates.includes(args.status))throw fail('INVALID_PARAMS','Choose an original notification status.');
          const found=state.notifications.filter(row=>(args.id===undefined||row.id===args.id)&&
            (args.incidentId===undefined||row.incidentId===args.incidentId)&&(args.status===undefined||row.status===args.status));
          return {incidentSource:selected,directoryRevision:state.directoryRevision,...pageRows(found,page),
            notifications:found.slice(page.offset,page.offset+page.limit),notificationCapacityEvents:state.notificationCapacityEvents};
        }
        case 'merchant_incident_notify':
          return {...await manager.notify(source.id,uuid(args.id),{
            expectedRevision:args.expectedRevision,...(Object.hasOwn(args,'expectedNotificationId')?{expectedNotificationId:args.expectedNotificationId}:{})}),incidentSource:selected};
        case 'merchant_notification_update':
          return {...await manager.notification(source.id,uuid(args.id),{
            expectedAttempts:args.expectedAttempts,action:args.action,by:args.by}),incidentSource:selected};
        case 'merchant_incidents':{
          const state=await incidentStatus({directory:source.directory,details:true}),page=pagination(args);
          if(args.id!==undefined)uuid(args.id);
          if(args.status!==undefined&&!statuses.includes(args.status))throw fail('INVALID_PARAMS','Choose an original incident status.');
          const latest=latestNotifications(state);
          const found=state.incidents.filter(row=>(args.id===undefined||row.id===args.id)&&(args.status===undefined||row.status===args.status));
          const incidents=found.slice(page.offset,page.offset+page.limit).map(row=>({...row,latestNotificationId:latest.get(row.id)??null}));
          const ids=new Set(incidents.map(row=>row.id));
          return {schema:state.schema,incidentSource:selected,directoryRevision:state.directoryRevision,
            configRevision:state.configRevision,configHash:state.configHash,worker:state.worker,active:state.active,
            incidents,...pageRows(found,page),notifications:state.notifications.filter(row=>ids.has(row.incidentId)),captureStorage:state.captureStorage};
        }
        case 'merchant_incident_ack':
          return {...await manager.acknowledge(source.id,uuid(args.id),{expectedRevision:args.expectedRevision,by:args.by,notes:args.notes??''}),incidentSource:selected};
        case 'merchant_incident_case':{
          uuid(args.id);uuid(args.incidentId);digest(args.expectedTemplateSha256);
          const template=await this.#callbacks.template(args.template,args.expectedTemplateSha256);
          const prepared=await manager.prepareCase(source.id,args.incidentId,{
            expectedRevision:args.expectedIncidentRevision,workspaceText:template.workspaceText,routeId:args.routeId});
          const handoff=await importRuntimeHandoff(prepared.handoff);
          const result=await (await this.#callbacks.cases()).save({id:args.id,expectedRevision:null,...handoff});
          return {...result,incidentSource:selected,incident:{id:args.incidentId,revision:args.expectedIncidentRevision},
            templateSha256:template.sourceSha256};
        }
        default:throw fail('TOOL_NOT_FOUND','Unknown original support incident operation.');
      }
    }catch(error){
      if(/^(SF93|FLEET)_/.test(String(error.message??''))){
        const problem=incidentProblem(error);throw fail(problem.error,problem.detail,problem.status);
      }
      throw error;
    }
  }
  close(){
    if(this.#close)return this.#close;
    this.#closing=true;
    this.#close=(async()=>{
      if(!this.#opening)return;
      let manager;try{manager=await this.#opening;}catch{return;}
      await manager.close();
    })();
    return this.#close;
  }
}
