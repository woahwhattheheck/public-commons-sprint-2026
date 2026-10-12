// MIT. One original Gateway + Dashboard lifecycle and complete cold receiving journey.
import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { readFile, open, mkdir, rename, unlink, realpath, lstat } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startTykWorkspaceServer } from './workspace/server.mjs';
import { TykWorkspaceHttpClient } from './workspace/http-client.mjs';
import { normalizeTykConnection, readTykMigrationDefinitions } from './native.mjs';

const SCHEMA='stellar-forge.tyk-native-journey.v1';
const sha=value=>createHash('sha256').update(value).digest('hex');
const need=(value,message)=>{if(!value)throw Object.assign(new Error(message),{code:'TYK_NATIVE_JOURNEY_MISMATCH'});};
const ref=record=>({kind:record.kind,id:record.id,revision:record.revision,sha256:record.sha256,state:record.value.state});
function preciseJson(text){
  need(typeof JSON.rawJSON==='function','Use the original Node 24 runtime with lossless JSON source support.');
  return JSON.parse(text,(_key,value,context)=>typeof value==='number'?JSON.rawJSON(context.source):value);
}
function encoded(value){return JSON.stringify(value,null,2)+'\n';}
async function hashFile(path){
  const hash=createHash('sha256');let bytes=0;
  for await(const part of createReadStream(path)){hash.update(part);bytes+=part.length;}
  return {path,bytes,sha256:hash.digest('hex')};
}
async function privateDirectory(path){
  await mkdir(path,{recursive:true,mode:0o700});
  const st=await lstat(path);
  need(st.isDirectory()&&!st.isSymbolicLink()&&await realpath(path)===path&&!(st.mode&0o077),'Use an owned private receiving directory.');
}
async function atomicJson(path,value){
  const temporary=path+'.pending-'+randomUUID(),handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await handle.writeFile(encoded(value));await handle.sync();}finally{await handle.close();}
  try{await rename(temporary,path);const parent=await open(dirname(path),constants.O_RDONLY|constants.O_DIRECTORY);
    try{await parent.sync();}finally{await parent.close();}}
  finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
function publicUrl(value){const u=new URL(value);need(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.hash,'Use an original HTTP target URL.');return u;}
function cloneClassic(seed,{apiId,name,listenPath,upstreamUrl}){
  const wrapper=preciseJson(seed.definitionText),definition=wrapper.api_definition??wrapper;
  need(seed.kind==='classic'&&definition.is_oas!==true,'Select an original Classic seed API.');
  need(definition.version_data?.not_versioned===true,'Select a native unversioned Classic seed.');
  need(!definition.definition?.base_id&&!Object.keys(definition.definition?.versions??{}).length,
    'Use a standalone native seed without references to another versioned API.');
  need(!definition.protocol||definition.protocol==='http','Select an HTTP Classic seed.');
  // These are explicit receiving identities and routing choices; original numeric values stay exact.
  definition.api_id=apiId;definition.name=name;definition.active=true;definition.use_keyless=true;
  definition.proxy={...definition.proxy,listen_path:listenPath,target_url:upstreamUrl,strip_listen_path:true};
  delete definition.id;
  if(wrapper.api_definition)delete wrapper.api_model;
  return encoded(wrapper);
}
function renameDefinition(capture,name){
  const doc=preciseJson(capture.definitionText),definition=doc.api_definition??doc;
  if(capture.kind==='oas'){definition.info={...definition.info,title:name};definition['x-tyk-api-gateway'].info.name=name;}
  else definition.name=name;
  return encoded(doc);
}
export async function runTykNativeJourney(configPath,outputDirectory,{fetch=globalThis.fetch}={}){
  const configBytes=await readFile(resolve(configPath)),config=JSON.parse(configBytes);
  need(config.schema===SCHEMA&&typeof config.operation==='string'&&config.operation.length>=8&&config.operation.length<=128,
    'Use a complete named native journey configuration.');
  need(config.gateway&&config.dashboard,'Declare both the original Gateway and licensed Dashboard targets.');
  const declarations=['gateway','dashboard'].map(kind=>{
    const selected=config[kind];need(selected.connection?.kind===kind&&typeof selected.classicSeedApiId==='string',
      'Declare the original '+kind+' connection and selected Classic seed API ID.');
    need(typeof selected.installedVersion==='string'&&selected.installedVersion.trim(),'Retain the actual installed '+kind+' version.');
    publicUrl(selected.upstreamUrl);
    return normalizeTykConnection(selected.connection);
  });
  need(declarations[0].id!==declarations[1].id,'Use distinct native target aliases.');
  publicUrl(config.gateway.publicBaseUrl);
  const root=resolve(outputDirectory);await privateDirectory(root);await privateDirectory(join(root,'downloads'));
  const statePath=join(root,'journey.json'),inputSha256=sha(configBytes);
  let state;
  try{state=JSON.parse(await readFile(statePath,'utf8'));need(state.schema===SCHEMA&&state.inputSha256===inputSha256,
    'This original journey directory belongs to another exact configuration.');}
  catch(error){if(error.code!=='ENOENT')throw error;state={schema:SCHEMA,operation:config.operation,inputSha256,
    startedAt:new Date().toISOString(),steps:{},inputs:{},nativeRequests:[],lostResponse:null};}
  let persistTail=Promise.resolve();
  const persist=()=>{const snapshot=JSON.parse(JSON.stringify(state));persistTail=persistTail.then(()=>atomicJson(statePath,snapshot));return persistTail;};
  const requestId=label=>{const s=sha(config.operation+'\n'+label).slice(0,32);return s.slice(0,8)+'-'+s.slice(8,12)+'-'+s.slice(12,16)+'-'+s.slice(16,20)+'-'+s.slice(20);};
  const apiId=label=>sha(config.operation+'\napi\n'+label).slice(0,32);
  const prefix='/d76c-'+sha(config.operation).slice(0,12)+'/';
  const freeze=async(label,value)=>{if(Object.hasOwn(state.inputs,label))return state.inputs[label];state.inputs[label]=value;await persist();return value;};
  async function step(name,fn){
    if(state.steps[name])return state.steps[name].value;
    state.currentPhase=name;await persist();process.stdout.write(JSON.stringify({phase:name,state:'RUNNING'})+'\n');
    const value=await fn();state.steps[name]={completedAt:new Date().toISOString(),value};await persist();
    process.stdout.write(JSON.stringify({phase:name,state:'COMPLETE'})+'\n');return value;
  }
  const lossId=apiId('gateway-classic'),gatewayBase=new URL(declarations[0].baseUrl);
  const lossPath=gatewayBase.pathname.replace(/\/$/,'')+'/tyk/apis/'+encodeURIComponent(lossId);
  let armLoss=false,sender,receiver,browser,terminalError;
  const nativeFetch=async(input,options={})=>{
    const url=new URL(String(input)),item={method:options.method??'GET',origin:url.origin,path:url.pathname,query:url.search,
      bodySha256:typeof options.body==='string'?sha(options.body):null,startedAt:new Date().toISOString()};
    state.nativeRequests.push(item);await persist();
    const response=await fetch(input,options);item.status=response.status;item.completedAt=new Date().toISOString();await persist();
    if(armLoss&&!state.lostResponse&&item.method==='PUT'&&url.origin===gatewayBase.origin&&url.pathname===lossPath){
      const bytes=Buffer.from(await response.arrayBuffer());
      need(response.ok,'The real Gateway rejected the selected update before response-loss receiving.');
      state.lostResponse={request:item,actualResponse:{status:response.status,bytes:bytes.length,sha256:sha(bytes),bodyBase64:bytes.toString('base64')},
        consumedAt:new Date().toISOString()};await persist();armLoss=false;
      let part=0;const body=new ReadableStream({pull(controller){
        if(part++===0&&bytes.length){controller.enqueue(bytes.subarray(0,Math.min(16,bytes.length)));return;}
        controller.error(Object.assign(new Error('Original native reply interrupted after retained first bytes.'),{code:'TYK_RECEIVING_REPLY_LOST'}));
      }});
      return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
    }
    return response;
  };
  async function openHost(name){
    const host=await startTykWorkspaceServer({directory:join(root,name),connections:name==='sender'?declarations:[],
      environment:process.env,fetch:nativeFetch,timeoutMs:config.nativeTimeoutMs??120000,
      maximumResponseBytes:config.maximumResponseBytes??64*1024*1024});
    const client=new TykWorkspaceHttpClient({url:host.url,workspaceId:host.workspaceId});
    await client.ready();return {host,client};
  }
  async function closeHost(value){if(value){await value.client.close();await value.host.close();}}
  const call=(method,args={})=>sender.client.action(method,args);
  const current=record=>call('getRecord',{kind:record.kind,id:record.id});
  async function retainReview(record){
    const key=record.id+'@'+record.revision;
    if(state.reviews?.[key])return state.reviews[key];
    let offset=0,total,report,changes=0;
    do{
      const page=await call('readReview',{id:record.id,revision:record.revision,offset,limit:17});
      report??=page;need(page.reportSha256===report.reportSha256,'The paged native review changed its immutable source.');
      total=page.changes.total;changes+=page.changes.items.length;offset=page.changes.nextOffset;
    }while(offset!==null);
    need(changes===total,'The full native field review was truncated.');
    const downloaded=await sender.client.downloadSource(report.report,join(root,'downloads',key+'-review.json'));
    const parsed=JSON.parse(await readFile(downloaded.path,'utf8'));
    need(parsed.planSha256===report.planSha256&&parsed.changes.length===changes,
      'The full downloaded native report differs from its paged review.');
    const originals=[];
    for(const item of report.sources)for(const side of ['before','after']){
      const source=item[side];if(source.state!=='PRESENT')continue;
      const file=await sender.client.downloadSource(source.reference,join(root,'downloads','source-'+source.reference.sha256+'.bin'));
      need(file.sha256===source.reference.sha256&&file.bytes===source.reference.bytes,'Original review source download changed bytes.');
      originals.push({apiId:item.apiId,side,...file});
    }
    const value={record:ref(record),stage:report.stage,changes,report:downloaded,originals};
    state.reviews??={};state.reviews[key]=value;await persist();return value;
  }
  async function rollout(label,connectionId,selection,cohort){
    const prepare=await freeze(label+':prepare',{requestId:requestId(label+':prepare'),connectionId,
      label:config.operation+' '+label,selection,...(cohort?{cohortId:cohort.id,cohortRevision:cohort.revision}:{})});
    const prepared=await call('prepareRollout',prepare);
    need(!['PREPARE_FAILED','INTERRUPTED','STALE','PREPARING'].includes(prepared.value.phase),
      label+' native preparation did not complete: '+JSON.stringify(prepared.value.failure??prepared.value));
    const originalPrepared=await freeze(label+':original-prepared',ref(prepared));
    await retainReview(await call('getRecord',{kind:'rollout',id:originalPrepared.id,revision:originalPrepared.revision}));
    const dispatch=await freeze(label+':dispatch',{requestId:requestId(label+':dispatch'),id:prepared.id,
      expectedRevision:originalPrepared.revision,planSha256:prepared.value.planSha256});
    const result=await call('dispatchRollout',dispatch);
    need(!['PREPARE_FAILED','STALE'].includes(result.value.phase),label+' rejected the reviewed native preimage.');
    await retainReview(await current(result));
    return {record:ref(result),dispatch};
  }
  async function capture(label,connectionId){
    const record=await call('capture',await freeze(label+':capture',{requestId:requestId(label+':capture'),connectionId,label}));
    need(record.value.state==='CAPTURED',label+' did not retain a complete native portfolio.');
    const original=await call('getRecord',{kind:'capture',id:record.id,limit:1});
    let offset=0,count=0;
    do{const page=await call('getRecord',{kind:'capture',id:record.id,revision:record.revision,offset,limit:37});
      count+=page.portfolio.items.length;offset=page.portfolio.nextOffset;}while(offset!==null);
    need(count===original.portfolio.total,label+' inventory paging omitted original API entries.');
    return {record:ref(record),summary:record.value.summary,apis:count,inventory:record.value.inventory};
  }
  async function definition(captureRef,id){return (await call('readDefinition',{captureId:captureRef.id,revision:captureRef.revision,apiId:id})).definition;}
  async function reconcile(label,rolloutRef){
    const record=await call('reconcileRollout',await freeze(label+':reconcile',{requestId:requestId(label+':reconcile'),id:rolloutRef.id}));
    await retainReview(await current(record));return record;
  }
  async function reload(label,targetId){return rollout(label,targetId,{operation:'hotReload',scope:'node',block:true});}
  async function cohort(label,portfolio,ids){
    const record=await call('createCohort',await freeze(label+':cohort',{requestId:requestId(label+':cohort'),
      label,captureId:portfolio.record.id,captureRevision:portfolio.record.revision,apiIds:ids}));
    return ref(record);
  }
  async function migration(label,targetId,selected,mode,overrideStaged=false){
    const result=await rollout(label,targetId,{operation:'migrate',mode,apiIds:selected.apiIds??[apiId('dashboard-stage')],
      abortOnFailure:true,overrideStaged},selected.record??selected);
    const record=await current(result.record),native=record.reconciliation?.evidence?.migration;
    need(native&&native.success?.count>0&&!(native.failure?.count>0)&&!(native.skipped?.count>0)&&!native.abortedOnFailure,
      label+' native migration requires its actual returned outcome: '+JSON.stringify(native??record.value));
    const exchange=(await call('readSource',{reference:record.value.response})).value;
    const definitions=readTykMigrationDefinitions(exchange);
    if(mode==='dryRun')need(definitions.size>0,'Native dryRun did not return complete converted definitions.');
    return {...result,state:record.value.state,returnedDefinitionIds:[...definitions.keys()],
      readbackApiIds:record.reconciliation.evidence.readbackApiIds,nativeResponseSha256:exchange.bodySha256};
  }
  try{
    await persist();sender=await openHost('sender');
    const view=await call('view'),targets=Object.fromEntries(view.connections.map(item=>[item.connection.kind,item]));
    need(targets.gateway?.credentialAvailable&&targets.dashboard?.credentialAvailable,'The original target credential environment references must be available.');
    const initial=await step('complete-native-portfolios',async()=>{
      const gateway=await capture('initial-gateway',targets.gateway.id),dashboard=await capture('initial-dashboard',targets.dashboard.id);
      const seeds={gateway:await definition(gateway.record,config.gateway.classicSeedApiId),dashboard:await definition(dashboard.record,config.dashboard.classicSeedApiId)};
      need(seeds.gateway.kind==='classic'&&seeds.dashboard.kind==='classic','Select original Classic seed APIs on both native targets.');
      return {gateway,dashboard,seeds};
    });
    const gatewayCreate=await step('gateway-native-create-and-explicit-reload',async()=>{
      const body=cloneClassic(initial.seeds.gateway,{apiId:lossId,name:config.operation+' Gateway Classic',
        listenPath:prefix+'classic/',upstreamUrl:config.gateway.upstreamUrl});
      const created=await rollout('gateway-classic-create',targets.gateway.id,{operation:'create',kind:'classic',apiId:lossId,definitionText:body});
      if(!state.inputs['gateway-create-before-reload']){
        const beforeReload=await current(created.record);
        need(beforeReload.response?.ok&&beforeReload.reconciliation?.evidence?.activation==='RELOAD_REQUIRED',
          'Gateway create must retain its original receipt and separate reload state.');
        await freeze('gateway-create-before-reload',ref(beforeReload));
      }
      await reload('gateway-classic-reload',targets.gateway.id);
      const portfolio=await capture('gateway-classic-active',targets.gateway.id),active=await definition(portfolio.record,lossId);
      need(active.found&&active.kind==='classic','Gateway reload did not activate the created native Classic definition.');
      const probe=new URL(prefix+'classic/'+String(config.gateway.probePath??'').replace(/^\/+/,''),config.gateway.publicBaseUrl);
      const response=await fetch(probe,{redirect:'manual',signal:AbortSignal.timeout(config.nativeTimeoutMs??120000)});
      const bytes=Buffer.from(await response.arrayBuffer());
      need(response.status===(config.gateway.expectedUpstreamStatus??200),'The original Gateway route did not reach the selected upstream.');
      return {...created,active,portfolio,probe:{url:probe.href,status:response.status,bytes:bytes.length,sha256:sha(bytes)}};
    });
    const imported=await step('gateway-native-openapi-import-and-update',async()=>{
      const document={openapi:'3.0.3',info:{title:config.operation+' imported API',version:'1.0.0'},
        servers:[{url:config.gateway.upstreamUrl}],paths:{'/':{get:{operationId:'originalNativeProbe',responses:{'200':{description:'Original selected upstream response'}}}}}};
      const imported=await rollout('gateway-oas-import',targets.gateway.id,{operation:'import',kind:'oas',definitionText:encoded(document),
        query:{upstreamURL:config.gateway.upstreamUrl,listenPath:prefix+'oas/',authentication:false}});
      let record=await current(imported.record);
      need(record.response?.ok&&record.reconciliation.evidence.providerReturnedApiIds.length===1,
        'Native OpenAPI import must return its exact generated public API ID.');
      const generatedId=record.reconciliation.evidence.providerReturnedApiIds[0];
      await reload('gateway-oas-import-reload',targets.gateway.id);
      const portfolio=await capture('gateway-imported-oas',targets.gateway.id),active=await definition(portfolio.record,generatedId);
      need(active.kind==='oas','Native import did not produce the original Tyk OAS definition.');
      const update=await rollout('gateway-oas-update',targets.gateway.id,{operation:'update',kind:'oas',apiId:generatedId,
        definitionText:renameDefinition(active,config.operation+' updated native OAS')});
      await reload('gateway-oas-update-reload',targets.gateway.id);
      record=await reconcile('gateway-oas-updated-current',update.record);
      need(record.value.state==='CONFIRMED'&&record.reconciliation.evidence.confirmation==='CURRENT_NATIVE_CONFIGURATION_MATCH',
        'The full updated native OpenAPI definition did not match its active readback.');
      return {import:imported,generatedId,update,confirmed:ref(record)};
    });
    const lost=await step('real-response-loss-and-cold-original-recovery',async()=>{
      const portfolio=await capture('gateway-before-lost-update',targets.gateway.id),active=await definition(portfolio.record,lossId);
      armLoss=!state.lostResponse;
      const updated=await rollout('gateway-lost-update',targets.gateway.id,{operation:'update',kind:'classic',apiId:lossId,
        definitionText:renameDefinition(active,config.operation+' lost-response native update')});
      let record=await current(updated.record),initialLoss=state.inputs['gateway-loss-observation'];
      if(!initialLoss){
        need(state.lostResponse&&record.value.state==='UNKNOWN'&&record.value.failure?.exchange,
          'The real partial native reply must remain in the original unknown request journal.');
        const partial=(await call('readSource',{reference:record.value.failure.exchange})).value;
        need(partial.complete===false&&partial.bodyBytes>0&&partial.bodyBytes<state.lostResponse.actualResponse.bytes,
          'The original partial exchange bytes were not retained.');
        initialLoss=await freeze('gateway-loss-observation',{record:ref(record),
          partialExchange:{bytes:partial.bodyBytes,sha256:partial.bodySha256},
          writeCount:state.nativeRequests.filter(x=>x.method==='PUT'&&x.path===lossPath).length});
      }
      const writeCount=initialLoss.writeCount;
      await closeHost(sender);sender=await openHost('sender');
      const replay=await call('dispatchRollout',updated.dispatch);
      need(replay.id===record.id&&state.nativeRequests.filter(x=>x.method==='PUT'&&x.path===lossPath).length===writeCount,
        'Reopening the original dispatched request repeated its native mutation.');
      if(!state.inputs['gateway-loss-before-reload']){
        const pending=await reconcile('gateway-lost-before-reload',updated.record);
        need(pending.value.state!=='CONFIRMED','An inactive new definition must not be confirmed before explicit Gateway reload.');
        await freeze('gateway-loss-before-reload',ref(pending));
      }
      await reload('gateway-lost-update-reload',targets.gateway.id);
      record=await reconcile('gateway-lost-after-reload',updated.record);
      need(record.value.state==='CONFIRMED'&&record.reconciliation.evidence.confirmation==='CURRENT_NATIVE_CONFIGURATION_MATCH'&&
        record.reconciliation.evidence.nativeAcknowledged===false,'Cold recovery must identify current native configuration without manufacturing an acknowledgement.');
      need(state.nativeRequests.filter(x=>x.method==='PUT'&&x.path===lossPath).length===writeCount,'Recovery repeated the original native update.');
      return {...updated,recovered:ref(record),partialExchange:initialLoss.partialExchange,nativeUpdateCount:writeCount};
    });
    await step('later-native-edit-does-not-confirm-an-earlier-body',async()=>{
      const portfolio=await capture('gateway-before-later-edit',targets.gateway.id),active=await definition(portfolio.record,lossId);
      const later=await rollout('gateway-later-edit',targets.gateway.id,{operation:'update',kind:'classic',apiId:lossId,
        definitionText:renameDefinition(active,config.operation+' later independently reviewed edit')});
      await reload('gateway-later-edit-reload',targets.gateway.id);
      const now=await reconcile('gateway-later-current',later.record);
      need(now.value.state==='CONFIRMED','The later reviewed configuration did not activate.');
      const prior=await reconcile('gateway-old-request-after-later-edit',lost.record);
      need(prior.value.state!=='CONFIRMED','A different later edit falsely confirmed the earlier native configuration.');
      return {later:ref(now),earlier:ref(prior),comparison:prior.reconciliation.items};
    });
    await step('dashboard-original-dryrun-stage-override-promote-direct',async()=>{
      for(const label of ['dashboard-stage','dashboard-direct']){
        const body=cloneClassic(initial.seeds.dashboard,{apiId:apiId(label),name:config.operation+' '+label,
          listenPath:prefix+label+'/',upstreamUrl:config.dashboard.upstreamUrl});
        const created=await rollout(label+'-create',targets.dashboard.id,{operation:'create',kind:'classic',apiId:apiId(label),definitionText:body});
        need((await current(created.record)).response?.ok,'Dashboard rejected the explicit native seed copy.');
      }
      const portfolio=await capture('dashboard-selected-classics',targets.dashboard.id);
      const stageIds=[apiId('dashboard-stage')],saved=await cohort('native-stage-cohort',portfolio,stageIds);
      const selected={record:saved,apiIds:stageIds};
      const dryRun=await migration('dashboard-dryrun',targets.dashboard.id,selected,'dryRun');
      const staged=await migration('dashboard-stage',targets.dashboard.id,selected,'stage');
      const stageCapture=await capture('dashboard-native-staging',targets.dashboard.id);
      const stageIdentity=staged.readbackApiIds.find(id=>id==='staging-'+stageIds[0]);
      need(stageIdentity,'Native stage must retain the original staged public API identity.');
      need((await definition(stageCapture.record,stageIdentity)).kind==='oas','Native staged OAS source was not captured.');
      const overridden=await migration('dashboard-stage-override',targets.dashboard.id,selected,'stage',true);
      const promoted=await migration('dashboard-promote',targets.dashboard.id,selected,'promote');
      const promotedCapture=await capture('dashboard-promoted-original-id',targets.dashboard.id);
      need((await definition(promotedCapture.record,stageIds[0])).kind==='oas','Promotion did not retain the original public API ID.');
      const directIds=[apiId('dashboard-direct')],directCohort=await cohort('native-direct-cohort',promotedCapture,directIds);
      const direct=await migration('dashboard-direct',targets.dashboard.id,{record:directCohort,apiIds:directIds},'direct');
      const final=await capture('dashboard-native-complete',targets.dashboard.id);
      need((await definition(final.record,directIds[0])).kind==='oas','Native direct conversion did not retain the selected public API ID.');
      const writes=state.nativeRequests.length;const replay=await call('dispatchRollout',promoted.dispatch);
      need(replay.id===promoted.record.id&&state.nativeRequests.length===writes,'Saved migration replay contacted the native target again.');
      return {cohort:saved,dryRun,staged,overridden,promoted,direct,final};
    });
    await step('complete-native-history-export-and-cold-receiving',async()=>{
      const firstInput=await freeze('first-export',{requestId:requestId('first-export'),label:'Complete native Tyk receiving'});
      const first=await call('exportWorkspace',firstInput);
      need(first.value.state==='EXPORTED','The first complete history was not exported.');
      const local=await sender.client.downloadDelivery(first.id,join(root,'downloads','first.ndjson'),
        {expectedSha256:first.value.file.sha256,expectedBytes:first.value.file.bytes});
      const nativeBefore=state.nativeRequests.length;receiver=await openHost('receiver');
      const receiveInput={requestId:requestId('first-inspect'),label:'Complete original Tyk history',expectedSha256:local.sha256};
      const inspected=await receiver.client.inspectFile(local.path,receiveInput);
      const adopt=await freeze('first-adopt',{requestId:requestId('first-adopt'),id:inspected.id,
        expectedRevision:inspected.revision,manifestSha256:inspected.value.manifestSha256});
      const adopted=await receiver.client.action('adoptDelivery',adopt);
      need(adopted.value.state==='ADOPTED','The original complete history was not adopted.');
      await closeHost(receiver);receiver=await openHost('receiver');
      const reopened=await receiver.client.action('adoptDelivery',adopt);
      need(reopened.id===adopted.id&&reopened.sha256===adopted.sha256&&state.nativeRequests.length===nativeBefore,
        'Cold original receiving must preserve its saved identity without a native target mutation.');
      const originalLost=await receiver.client.action('getRecord',{kind:'rollout',id:lost.record.id});
      need(originalLost.id===lost.record.id&&originalLost.value.planSha256,
        'Cold receiving omitted the exact original interrupted-request history.');
      const owned=await sender.host.workspace.deliveryFile({id:first.id});await unlink(owned.path);
      const reconstructed=await sender.host.workspace.deliveryFile({id:first.id});
      const reconstruction=await hashFile(reconstructed.path);
      need(reconstruction.sha256===local.sha256&&reconstruction.bytes===local.bytes,'The original missing archive reconstructed different bytes.');
      await capture('later-native-portfolio-before-second-export',targets.gateway.id);
      const second=await call('exportWorkspace',await freeze('second-export',{requestId:requestId('second-export'),label:'Later complete native Tyk edition'}));
      const laterFile=await sender.client.downloadDelivery(second.id,join(root,'downloads','second.ndjson'),
        {expectedSha256:second.value.file.sha256,expectedBytes:second.value.file.bytes});
      const inspectedLater=await receiver.client.inspectFile(laterFile.path,{requestId:requestId('second-inspect'),
        label:'Later complete original Tyk history',expectedSha256:laterFile.sha256});
      const laterAdopt=await freeze('second-adopt',{requestId:requestId('second-adopt'),id:inspectedLater.id,
        expectedRevision:inspectedLater.revision,manifestSha256:inspectedLater.value.manifestSha256});
      const laterReceived=await receiver.client.action('adoptDelivery',laterAdopt);
      need(laterReceived.value.state==='ADOPTED','The later original history failed to receive over its earlier edition.');
      await closeHost(receiver);receiver=await openHost('receiver');
      const laterReplay=await receiver.client.action('adoptDelivery',laterAdopt);
      need(laterReplay.sha256===laterReceived.sha256,'The later receiving operation changed on cold replay.');
      const receivedOriginalArchive=await receiver.host.workspace.deliveryFile({id:first.id});
      const receivedBytes=await hashFile(receivedOriginalArchive.path);
      need(receivedBytes.sha256===local.sha256&&receivedBytes.bytes===local.bytes,
        'Cold received source could not reconstruct the original earlier complete archive.');
      const firstReplay=await receiver.client.action('adoptDelivery',adopt);
      need(firstReplay.sha256===adopted.sha256,'Receiving a later edition changed the original receiving receipt.');
      return {first:ref(first),download:local,receiving:ref(adopted),second:ref(second),laterDownload:laterFile,
        laterReceiving:ref(laterReceived),coldOriginalArchive:receivedBytes,firstReplay:ref(firstReplay)};
    });
    if(config.chromiumExecutablePath){
      await step('current-customer-browser-receiving',async()=>{
        const {chromium}=await import('playwright'),pageErrors=[],nativeBefore=state.nativeRequests.length;
        browser=await chromium.launch({headless:true,executablePath:resolve(config.chromiumExecutablePath),
          args:['--no-sandbox','--disable-dev-shm-usage']});
        const page=await browser.newPage({viewport:{width:1440,height:1080},acceptDownloads:true});
        page.on('pageerror',error=>pageErrors.push(String(error.message??error)));
        const idle=async()=>{await page.locator('main[aria-busy="false"]').waitFor();};
        async function rowInPages(tableId,pagerId,text){
          for(;;){
            const row=page.locator('#'+tableId+' tbody tr').filter({hasText:text});
            if(await row.count())return row.first();
            const next=page.locator('#'+pagerId).getByRole('button',{name:'Next',exact:true});
            need(await next.count(),'The saved '+text+' record is absent from its original browser inventory.');
            await next.click();await idle();
          }
        }
        await page.goto(sender.host.url,{waitUntil:'networkidle'});await idle();
        need((await page.locator('#notice').textContent()).includes('Workspace ready'),'The original customer workspace did not open.');
        const dashboardRun=state.steps['dashboard-original-dryrun-stage-override-promote-direct'].value;
        await page.locator('[data-tab="portfolio"]').click();
        await page.selectOption('#capture-select',dashboardRun.final.record.id);await idle();
        const api=await rowInPages('api-table','api-pages',apiId('dashboard-direct'));
        await api.getByRole('button',{name:'Definition',exact:true}).click();await idle();
        need((await page.locator('#definition-text').inputValue()).includes(apiId('dashboard-direct')),
          'The customer original-definition view lost its selected native API identity.');
        await page.locator('[data-tab="cohorts"]').click();
        const selectedCohort=await rowInPages('cohort-list','cohort-pages','native-stage-cohort');
        await selectedCohort.getByRole('button',{name:'Open',exact:true}).click();await idle();
        need((await page.locator('#cohort-details').textContent()).includes(apiId('dashboard-stage')),
          'The original saved cohort browser view lost its selected API.');
        await page.locator('[data-tab="rollouts"]').click();
        const selectedRollout=await rowInPages('rollout-list','rollout-pages',config.operation+' dashboard-dryrun');
        await selectedRollout.getByRole('button',{name:'Open',exact:true}).click();await idle();
        await page.locator('.definition-review').getByRole('heading',{name:'Native conversion review',exact:true}).waitFor();
        const nextFields=page.locator('.definition-review').getByRole('button',{name:'Next fields',exact:true});
        let paged=false;
        if(await nextFields.isEnabled()){
          await nextFields.click();await idle();paged=true;
          await page.locator('.definition-review').getByRole('button',{name:'Previous fields',exact:true}).click();await idle();
        }
        const actualRollout=await current(dashboardRun.dryRun.record);
        const review=await call('readReview',{id:actualRollout.id,revision:actualRollout.revision,limit:17});
        const selectedSource=review.sources.find(item=>item.after.state==='PRESENT');
        need(selectedSource,'The original native conversion report omitted its complete OAS output.');
        await page.locator('.definition-review select').selectOption(selectedSource.apiId);
        const downloadEvent=page.waitForEvent('download');
        await page.locator('.definition-review').getByRole('link',{name:/^After · complete original/}).click();
        const download=await downloadEvent;
        const uiSourcePath=join(root,'downloads','browser-native-conversion.json');await download.saveAs(uiSourcePath);
        const uiSource=await hashFile(uiSourcePath);
        need(uiSource.sha256===selectedSource.after.reference.sha256&&uiSource.bytes===selectedSource.after.reference.bytes,
          'The actual browser original-source download changed native conversion bytes.');
        await page.locator('.definition-review').scrollIntoViewIfNeeded();
        const reviewScreenshot=join(root,'customer-native-conversion.png');await page.screenshot({path:reviewScreenshot});
        await page.locator('[data-tab="handover"]').click();
        need(await page.locator('#delivery-list').getByRole('link',{name:'Download',exact:true}).count(),
          'The original customer handover view omitted complete saved delivery links.');
        if(!receiver)receiver=await openHost('receiver');
        await page.goto(receiver.host.url,{waitUntil:'networkidle'});await idle();
        await page.locator('[data-tab="handover"]').click();
        const receivedRow=await rowInPages('receiving-list','receiving-pages','Later complete original Tyk history');
        await receivedRow.getByRole('button',{name:'Open',exact:true}).click();await idle();
        need((await page.locator('#receiving-review').textContent()).includes('Received'),
          'The cold customer workspace did not show its original adopted history.');
        const receivingScreenshot=join(root,'customer-received-history.png');await page.screenshot({path:receivingScreenshot});
        need(!pageErrors.length,'The actual customer browser raised a runtime error: '+pageErrors.join('; '));
        need(state.nativeRequests.length===nativeBefore,'Opening saved customer reviews contacted the native target.');
        const title=await page.title();await browser.close();browser=null;
        return {title,fieldPagerUsed:paged,uiSource,reviewScreenshot:await hashFile(reviewScreenshot),
          receivingScreenshot:await hashFile(receivingScreenshot),pageErrors};
      });
    }
    const final=await call('view');
    const sourcePaths=['native.mjs','native-journey.mjs','workspace/model.mjs','workspace/store.mjs',
      'workspace/delivery.mjs','workspace/server.mjs','workspace/actions.mjs','workspace/http-client.mjs','workspace/review.mjs'];
    const source=[];
    for(const path of sourcePaths){const bytes=await readFile(new URL('./'+path,import.meta.url));source.push({path,bytes:bytes.length,sha256:sha(bytes)});}
    const drained=[];
    if(receiver){const identity={role:'receiver',workspaceId:receiver.host.workspaceId,directory:receiver.host.directory};
      await closeHost(receiver);receiver=undefined;drained.push({...identity,state:'CLOSED'});}
    if(sender){const identity={role:'sender',workspaceId:sender.host.workspaceId,directory:sender.host.directory};
      await closeHost(sender);sender=undefined;drained.push({...identity,state:'CLOSED'});}
    state.ownerDrain={completedAt:new Date().toISOString(),owners:drained};
    state.state='PASSED';state.completedAt=new Date().toISOString();state.source=source;
    state.summary={gatewayVersion:config.gateway.installedVersion,dashboardVersion:config.dashboard.installedVersion,
      gatewayApiId:lossId,generatedOpenApiId:imported.generatedId,dashboardApiIds:[apiId('dashboard-stage'),apiId('dashboard-direct')],
      originalWorkspaceId:final.workspaceId,records:final.counts,nativeRequests:state.nativeRequests.length,
      phases:Object.keys(state.steps),completeFieldReviews:Object.keys(state.reviews??{}).length,originalResponseLoss:state.lostResponse?.actualResponse};
    await persist();const result={schema:SCHEMA,operation:state.operation,state:state.state,completedAt:state.completedAt,
      summary:state.summary,ownerDrain:state.ownerDrain,source,stateFile:await hashFile(statePath)};
    await atomicJson(join(root,'result.json'),result);process.stdout.write(JSON.stringify(result)+'\n');return result;
  }catch(error){
    terminalError=error;state.state='INTERRUPTED';state.failure={phase:state.currentPhase,code:error.code??'NATIVE_JOURNEY_FAILED',
      message:String(error.message??error),at:new Date().toISOString()};await persist();
    process.stdout.write(JSON.stringify({schema:SCHEMA,operation:state.operation,state:state.state,failure:state.failure,statePath})+'\n');throw error;
  }finally{
    const failures=[];
    if(browser)try{await browser.close();}catch(error){failures.push({owner:'browser',error});}
    for(const [owner,value]of [['receiver',receiver],['sender',sender]])if(value){
      try{await closeHost(value);}catch(error){failures.push({owner,error});}
    }
    if(failures.length){
      state.state='INTERRUPTED';state.closeFailures=failures.map(item=>({owner:item.owner,code:item.error.code??'TYK_OWNER_CLOSE_FAILED',message:String(item.error.message??item.error)}));
      await persist();process.stderr.write(JSON.stringify({operation:state.operation,ownerCloseFailures:state.closeFailures})+'\n');
      if(!terminalError)throw failures[0].error;
    }
    await persistTail;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.argv.length!==4){process.stderr.write('Usage: node native-journey.mjs PRIVATE_CONFIG_JSON PRIVATE_OUTPUT_DIRECTORY\n');process.exitCode=2;}
  else runTykNativeJourney(process.argv[2],process.argv[3]).catch(error=>{process.stderr.write(String(error.stack??error)+'\n');process.exitCode=1;});
}
