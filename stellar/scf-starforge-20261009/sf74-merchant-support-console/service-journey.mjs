#!/usr/bin/env node
// MIT. One real service case: original seller/observer, incidents, MCP, browser and receiving.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {parseArgs} from 'node:util';
import {startSellerService} from '../sf30-seller-sdk/serve.mjs';
import {startSellerOperations} from '../sf30-seller-sdk/operations/server.mjs';
import {initializeIncidentStore,openIncidentStore} from '../sf93-seller-support-bundle/incident-store.mjs';
import {configureIncidents,exportIncident} from '../sf93-seller-support-bundle/incident-operator.mjs';
import {readSupportBundle} from '../sf93-seller-support-bundle/bundle.mjs';
import {openCaseStore} from './case-store.mjs';
import {serializeWorkspace,parseWorkspace,workspaceDraft} from './workspace-file.mjs';
import {exportRuntimeHandoff,importRuntimeHandoff} from './runtime-support.mjs';
import {start as startSupportConsole} from './server.mjs';
import {serviceCli} from './service-cli.mjs';
import {newCommissioning,applyCommissioningCommand} from './commissioning.mjs';
import {receiveServiceBrowser} from './service-browser-receiving.mjs';
import {MerchantSupport,supportTools} from '../../../stellar-forge/mcp-merchant-operator/support.mjs';
import {readSupportConfiguration} from '../../../stellar-forge/mcp-merchant-operator/config.mjs';
import {createMcpToolHandler,MCP_VERSION} from '../../../stellar-forge/mcp-paid-agent/http-tools.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const delay=ms=>new Promise(done=>setTimeout(done,ms));
async function optional(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;return null;}}
async function listen(server,port=0){await new Promise((done,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',done);});return 'http://127.0.0.1:'+server.address().port;}
async function closeServer(server){if(!server?.listening)return;server.closeIdleConnections?.();await new Promise((done,fail)=>server.close(error=>error?fail(error):done()));}
export async function receiveServiceCase({directory,sourceCommit,chromiumPath,playwrightModule}={}){
  if(!directory||!sourceCommit||!chromiumPath||!playwrightModule)throw new Error('Supply directory, sourceCommit, chromiumPath and playwrightModule.');
  directory=resolve(directory);assert.match(sourceCommit,/^[a-f0-9]{40}$/);
  await mkdir(directory,{recursive:true,mode:0o700});
  const checkpoint=join(directory,'service-receiving-checkpoint.json'),completed=join(directory,'service-native-run.json');
  const finished=await optional(completed);
  if(finished?.result==='PASS'){
    for(const file of finished.artifacts){const bytes=await readFile(join(directory,file.name));assert.equal(bytes.length,file.bytes);assert.equal(sha(bytes),file.sha256);}
    return {...finished,reused:true};
  }
  const state=await optional(checkpoint)??{schema:'stellar-forge.merchant-service-native-receiving.v1',
    operationId:'SCF-SUPPORT-SERVICE-COMMITMENTS-24EA-20261012',directory,sourceSelections:[],startedAt:new Date().toISOString(),
    caseId:randomUUID(),termsId:randomUUID(),commissioningRequestId:randomUUID(),ports:{},phases:{},requests:{},stages:[],artifacts:[],httpOperations:0,result:'RUNNING'};
  assert.equal(state.directory,directory);state.result='RUNNING';delete state.error;
  if(state.sourceSelections.at(-1)?.commit!==sourceCommit)state.sourceSelections.push({commit:sourceCommit,selectedAt:new Date().toISOString()});
  const save=async()=>{await writeFile(checkpoint+'.tmp',json(state),{mode:0o600});await rename(checkpoint+'.tmp',checkpoint);};
  const phase=async(name,data={})=>{state.phases[name]=true;state.stages.push({name,at:new Date().toISOString(),...data});await save();process.stdout.write(json({phase:name,...data}));};
  const retain=async(name,body)=>{
    const bytes=Buffer.isBuffer(body)?body:Buffer.from(typeof body==='string'?body:json(body));
    await writeFile(join(directory,name),bytes,{mode:0o600});
    const item={name,bytes:bytes.length,sha256:sha(bytes)};state.artifacts=state.artifacts.filter(x=>x.name!==name);state.artifacts.push(item);await save();return item;
  };
  await save();
  const sourceCases=join(directory,'cases'),receiverCases=join(directory,'receiving-cases'),
    incidents=join(directory,'incidents'),sourceFile=join(directory,'incident-sources.json'),
    connectionFile=join(directory,'support-connection.json'),exportsDirectory=join(directory,'exports');
  for(const path of [sourceCases,receiverCases,exportsDirectory])await mkdir(path,{recursive:true,mode:0o700});
  let seller,ops,proxy,mcpServer,provider,sourceConsole,receiverConsole,context,failing=!state.phases.recovered;
  let mcpUrl,proxyUrl,rpcId=0;
  const sourceStore=await openCaseStore(sourceCases),receiverStore=await openCaseStore(receiverCases);
  let token;try{token=(await readFile(join(directory,'access-token.txt'),'utf8')).trim();}
  catch(error){if(error.code!=='ENOENT')throw error;token=randomBytes(32).toString('hex');await writeFile(join(directory,'access-token.txt'),token+'\n',{mode:0o600,flag:'wx'});}
  const rpc=async(method,params={},drop=false)=>{
    state.httpOperations++;
    const response=await fetch(mcpUrl,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',
      accept:'application/json, text/event-stream','mcp-protocol-version':MCP_VERSION,...(drop?{'x-native-drop-response':'once'}:{})},
      body:JSON.stringify({jsonrpc:'2.0',id:++rpcId,method,params}),signal:AbortSignal.timeout(30000)});
    assert.equal(response.status,200);const envelope=await response.json();
    if(envelope.error)throw new Error(envelope.error.message);
    if(envelope.result?.isError)throw Object.assign(new Error(envelope.result.structuredContent?.reason),{code:envelope.result.structuredContent?.code});
    return envelope.result?.structuredContent??envelope.result;
  };
  const call=(name,args={},drop=false)=>rpc('tools/call',{name,arguments:args},drop);
  const current=()=>sourceStore.read(state.caseId);
  const request=async(key,action,input)=>{
    if(!state.requests[key]){
      const original=await current();state.requests[key]={id:state.caseId,expectedRevision:original.currentRevision,
        requestId:randomUUID(),action,input};await save();
    }
    return state.requests[key];
  };
  const change=async(key,action,input)=>call('merchant_service_change',await request(key,action,input));
  const snapshot=()=>call('merchant_support_service_snapshot',{incidentSource:'receiving',merchantId:'service-merchant'}).then(value=>value.snapshot);
  const capture=async key=>{
    if(state.requests[key])return call('merchant_service_change',state.requests[key]);
    const source=await snapshot();
    return change(key,'capture',{incidentSource:'receiving',merchantId:'service-merchant',expectedSourceRevision:source.revision,
      expectedConfigHash:source.configHash,expectedMerchantBinding:source.merchant.binding});
  };
  const waitFor=async(predicate,label)=>{
    const deadline=Date.now()+45000;
    while(Date.now()<deadline){const value=await predicate();if(value)return value;await delay(120);}
    throw new Error('Original '+label+' did not complete; retained case and request can continue.');
  };
  const observeUntil=async predicate=>{
    const status=await call('merchant_support_watch_status',{incidentSource:'receiving'});
    let instance=status.owned?.instanceId;
    if(!instance){const begun=await call('merchant_support_watch_start',{incidentSource:'receiving',
      expectedConfigRevision:status.configRevision,expectedConfigHash:status.configHash});instance=begun.owned?.instanceId;}
    assert.ok(instance,'Original watcher returned its owned instance');
    try{return await waitFor(async()=>predicate((await (await openIncidentStore(incidents)).read()).incidents),'incident transition');}
    finally{await call('merchant_support_watch_stop',{incidentSource:'receiving',instanceId:instance});}
  };
  const transfer=async()=>{
    const original=await current();assert.ok(original.supportText);
    const handoff=await exportRuntimeHandoff({workspaceText:original.workspaceText,supportText:original.supportText,metadata:original.metadata});
    const received=await importRuntimeHandoff(handoff.handoff);assert.equal(received.workspaceText,original.workspaceText);assert.equal(received.supportText,original.supportText);
    const old=await receiverStore.read(state.caseId).catch(error=>{if(error.code!=='CASE_NOT_FOUND')throw error;return null;});
    const saved=await receiverStore.save({id:state.caseId,expectedRevision:old?.currentRevision??null,...received});
    const fresh=await receiverStore.read(state.caseId);
    assert.equal(fresh.workspaceText,original.workspaceText);assert.equal(fresh.supportText,original.supportText);
    await retain('received-service-handoff-'+sha(handoff.handoff).slice(0,20)+'.json',handoff.handoff);
    return {caseId:state.caseId,revision:saved.case.revision};
  };
  try {
    const config=JSON.parse(await readFile(new URL('../sf30-seller-sdk/examples/service.json',import.meta.url),'utf8'));
    seller=await startSellerService({config,port:state.ports.seller??0});state.ports.seller=Number(new URL(seller.url).port);await save();
    ops=await startSellerOperations(seller,{port:state.ports.ops??0});state.ports.ops=Number(new URL(ops.url).port);await save();
    proxy=createServer(async(req,res)=>{
      if(failing){res.writeHead(503,{'content-type':'application/json'});res.end('{"error":"CONTROLLED_RECEIVING_OUTAGE"}');return;}
      try{const original=await fetch(seller.url+req.url,{signal:AbortSignal.timeout(5000)});
        res.writeHead(original.status,{'content-type':original.headers.get('content-type')??'application/json'});res.end(Buffer.from(await original.arrayBuffer()));
      }catch{res.writeHead(502,{'content-type':'application/json'});res.end('{"error":"ORIGINAL_SELLER_UNAVAILABLE"}');}
    });
    proxyUrl=await listen(proxy,state.ports.proxy??0);state.ports.proxy=Number(new URL(proxyUrl).port);await save();
    const watchConfig={schema:'stellar-forge.seller-watch-config.v1',pollMs:250,failurePolls:1,recoveryPolls:1,windowMinutes:1,
      captureEveryMs:1000,httpErrors:null,disconnects:null,notification:null,
      merchants:[{id:'service-merchant',label:'Original service receiving merchant',seller:proxyUrl,ops:ops.url}]};
    if(!await optional(join(incidents,'state.json')))await initializeIncidentStore({directory:incidents,config:watchConfig});
    const sourceSelection={schema:'stellar-forge.support-incident-sources.v1',sources:[{id:'receiving',label:'Native receiving incidents',directory:incidents}]};
    if(!await optional(sourceFile))await writeFile(sourceFile,json(sourceSelection),{mode:0o600,flag:'wx'});
    else assert.deepEqual(await optional(sourceFile),sourceSelection);
    const connection={schema:'stellar-forge.merchant-support-connection.v1',casesDirectory:sourceCases,
      incidentSourcesFile:sourceFile,defaultIncidentSource:'receiving',handoffs:{},workspaces:{},profiles:{}};
    if(!await optional(connectionFile))await writeFile(connectionFile,json(connection),{mode:0o600,flag:'wx'});
    else assert.deepEqual(await optional(connectionFile),connection);
    let saved;try{saved=await current();}catch(error){if(error.code!=='CASE_NOT_FOUND')throw error;}
    if(!saved){
      const commissioning=await applyCommissioningCommand(newCommissioning(),{type:'update_plan',requestId:state.commissioningRequestId,
        actor:'Service receiving operator',expectedRevision:0,payload:{notes:'Commissioning history retained with the original service case.'}});
      const workspaceText=await serializeWorkspace({name:'Complete merchant service receiving',inputs:{resource:seller.url+'/dataset',
        origin:seller.url,network:'stellar:testnet'},termsText:'',commissioning:commissioning.state});
      saved=await sourceStore.save({id:state.caseId,expectedRevision:null,workspaceText,supportText:null,
        metadata:{merchant:'Original service receiving merchant',owner:'Service receiving operator',status:'in_progress',notes:'Original service operations and staff receiving.'}});
    }
    provider=new MerchantSupport({support:await readSupportConfiguration(connectionFile),exportsDirectory},{environment:process.env});
    const tools=supportTools((name,description,properties,required=[],flags={})=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},
      annotations:{readOnlyHint:Boolean(flags.readOnly),idempotentHint:Boolean(flags.idempotent)}}));
    const handler=createMcpToolHandler({tools,call:(name,args)=>provider.call(name,args)},{bearerToken:token,serverName:'starforge-service-receiving',
      instructions:'Original merchant support and service receiving.',maxRequestBytes:131072});
    mcpServer=createServer((req,res)=>{
      if(req.headers['x-native-drop-response']==='once'){
        const end=res.end.bind(res);res.end=(body,...args)=>{
          try{const envelope=JSON.parse(String(body));if(envelope.result?.isError===false){res.destroy();return res;}}catch{}
          return end(body,...args);
        };
      }
      void handler(req,res);
    });
    mcpUrl=await listen(mcpServer,state.ports.mcp??0);state.ports.mcp=Number(new URL(mcpUrl).port);await save();
    const initialized=await rpc('initialize',{protocolVersion:MCP_VERSION,capabilities:{},clientInfo:{name:'service-receiving',version:'1'}});
    assert.equal(initialized.protocolVersion,MCP_VERSION);
    const catalog=await rpc('tools/list');for(const name of ['merchant_support_service_snapshot','merchant_service_read','merchant_service_change','merchant_service_preview','merchant_service_report'])
      assert.ok(catalog.tools.some(tool=>tool.name===name),name);
    await phase('original-hosts-opened',{seller:seller.url,operations:ops.url,mcp:mcpUrl,tools:catalog.tools.length});
    if(!state.phases.opened){
      failing=true;const incident=await observeUntil(rows=>rows.find(row=>row.merchantId==='service-merchant'&&row.kind==='ENDPOINT_UNAVAILABLE'&&row.status==='OPEN'));
      state.incidentId=incident.id;state.openedAt=incident.openedAt;await phase('opened',{incidentId:incident.id});
    }
    const first=await capture('capture-open');state.firstCaptureSha256=first.result.sha256;await save();
    if(!state.requests['terms-initial']){
      const source=first.result.snapshot;
      await request('terms-initial','terms',{id:state.termsId,expectedRevision:null,title:'Native merchant service commitment',
        customer:'Original service receiving merchant',owner:'Service receiving operator',reference:'Receiving work order '+state.caseId,status:'active',
        incidentSourceId:'receiving',merchantId:'service-merchant',merchantBinding:source.merchant.binding,
        effectiveFrom:state.openedAt,effectiveUntil:null,calendar:{mode:'always',timeZone:'Etc/UTC',week:[],exceptions:[]},
        targets:[{kind:'ENDPOINT_UNAVAILABLE',responseMinutes:30,recoveryMinutes:240}],reviewedBy:'Service receiving operator',
        note:'Actual original HTTP outage, acknowledgment and recovery receiving.'});
    }
    if(!state.phases.lostResponse){
      let interrupted=false;try{await call('merchant_service_change',state.requests['terms-initial'],true);}catch{interrupted=true;}
      assert.equal(interrupted,true,'Actual reply was interrupted after the original save');
      const replay=await call('merchant_service_change',state.requests['terms-initial']);assert.equal(replay.reused,true);
      state.initialTerms=replay.result;await phase('lostResponse',{operationId:replay.operation.id,termsSha256:replay.result.sha256});
    }
    if(!state.phases.acknowledged){
      const source=await snapshot(),incident=source.incidents.find(row=>row.id===state.incidentId);
      if(incident.status==='OPEN')await call('merchant_incident_ack',{incidentSource:'receiving',id:incident.id,expectedRevision:incident.revision,
        by:'Service receiving operator',notes:'Reviewing the original controlled HTTP outage.'});
      const next=(await snapshot()).incidents.find(row=>row.id===state.incidentId);assert.ok(next.acknowledgment);
      state.acknowledgedAt=next.acknowledgment.at;await phase('acknowledged',{incidentId:next.id});
    }
    await capture('capture-acknowledged');
    if(!state.phases.recovered){
      failing=false;const incident=await observeUntil(rows=>rows.find(row=>row.id===state.incidentId&&row.status==='RECOVERED'));
      assert.ok(incident.afterCapture,'Recovery retained the original seller support files');
      state.recoveredAt=incident.closedAt;await phase('recovered',{incidentId:incident.id,closedAt:incident.closedAt});
    }
    const recovered=await capture('capture-recovered');state.recoveredCaptureSha256=recovered.result.sha256;await save();
    if(!state.phases.runtimeAttached){
      const folder=join(directory,'original-incident-export'),original=await current(),workspaceFile=join(directory,'incident-workspace.json');
      if(!await optional(join(folder,'incident.json'))){
        await writeFile(workspaceFile,original.workspaceText,{mode:0o600});
        const incident=(await snapshot()).incidents.find(row=>row.id===state.incidentId);
        const staging=join(directory,'incident-export-staging');
        await rm(staging,{recursive:true,force:true});
        await exportIncident({directory:incidents,id:incident.id,expectedRevision:incident.revision,workspaceFile,routeId:'dataset',out:staging});
        await rename(staging,folder);
      }
      const handoff=await importRuntimeHandoff(await readFile(join(folder,'support-handoff.json'),'utf8'));
      const latest=await current();await sourceStore.save({id:state.caseId,expectedRevision:latest.currentRevision,
        workspaceText:latest.workspaceText,supportText:handoff.supportText,metadata:latest.metadata});
      await phase('runtimeAttached');
    }
    const exclusion=await change('exclusion','exclusion',{id:state.requests.exclusion?.input.id??randomUUID(),incidentId:state.incidentId,
      captureSha256:state.recoveredCaptureSha256,from:state.openedAt,through:state.acknowledgedAt,scope:'both',
      reason:'Reviewed controlled native receiving outage before operator acknowledgment.',reference:'Receiving work order '+state.caseId,reviewedBy:'Service receiving operator'});
    state.exclusionId=exclusion.result.id;await save();
    const retainReport=async(key,termsRevision)=>{
      if(state.requests[key])return call('merchant_service_change',state.requests[key]);
      const original=await current(),workspace=await parseWorkspace(original.workspaceText),service=workspace.service;
      const captured=service.captures.map(row=>row.snapshot.capturedAt).sort().at(-1),month=captured.slice(0,7);
      const end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10);
      const selection={termsId:state.termsId,termsRevision,from:month+'-01',through:end,asOf:captured,
        captureSha256s:service.captures.map(row=>row.sha256),exclusionIds:[state.exclusionId]};
      const preview=await call('merchant_service_preview',{id:state.caseId,expectedRevision:original.currentRevision,selection});
      return change(key,'report',{...selection,expectedPreviewSha256:preview.preview.previewSha256,reviewedBy:'Service receiving operator',note:key});
    };
    const firstReport=await retainReport('report-recovered',1);state.firstReportId=firstReport.result.id;
    const recoveredRow=firstReport.result.preview.incidents.find(row=>row.id===state.incidentId);
    assert.equal(recoveredRow.response.state,'MET');assert.equal(recoveredRow.recovery.state,'MET');
    await phase('recoveredReport',{reportId:state.firstReportId});
    if(!state.phases.retired){
      let native=await (await openIncidentStore(incidents)).read();
      let second=native.incidents.find(row=>row.id===state.retiredIncidentId)||
        native.incidents.find(row=>row.merchantId==='service-merchant'&&row.id!==state.incidentId&&row.kind==='ENDPOINT_UNAVAILABLE'&&row.status==='RETIRED');
      if(!second||second.status!=='RETIRED'){
        failing=true;
        second=await observeUntil(rows=>rows.find(row=>row.merchantId==='service-merchant'&&row.id!==state.incidentId&&row.kind==='ENDPOINT_UNAVAILABLE'&&row.status==='OPEN'));
        state.retiredIncidentId=second.id;await save();
        native=await (await openIncidentStore(incidents)).read();
        await configureIncidents({directory:incidents,expectedConfigRevision:native.configRevision,
          config:{...native.config,merchants:[{...native.config.merchants[0],id:'next-service-merchant',label:'Next registered merchant'}]}});
      }
      const retired=(await snapshot()).incidents.find(row=>row.id===second.id);
      assert.equal(retired.status,'RETIRED');state.retiredIncidentId=retired.id;state.retiredAt=retired.closedAt;failing=false;
      await phase('retired',{incidentId:retired.id,closedAt:retired.closedAt});
    }
    const retiredCapture=await capture('capture-retired');assert.equal(retiredCapture.result.snapshot.merchant.registered,false);
    await change('terms-ended','terms',{...state.requests['terms-initial'].input,expectedRevision:1,status:'ended',
      effectiveUntil:state.retiredAt,note:'Original source registration ended after the retained receiving incident.'});
    const finalReport=await retainReport('report-retired',2);state.reportId=finalReport.result.id;await save();
    const retiredRow=finalReport.result.preview.incidents.find(row=>row.id===state.retiredIncidentId);
    assert.equal(retiredRow.status,'RETIRED');assert.equal(retiredRow.recovery.state,'RETIRED');
    const replay=await call('merchant_service_change',state.requests['terms-initial']);assert.equal(replay.reused,true);assert.equal(replay.result.sha256,state.initialTerms.sha256);
    const preUpdate=await current();await call('merchant_case_update',{id:state.caseId,expectedRevision:preUpdate.currentRevision,baselineOnly:true});
    const afterUpdate=await current(),savedWorkspace=await parseWorkspace(afterUpdate.workspaceText);
    assert.ok(savedWorkspace.service.reports.some(row=>row.id===state.firstReportId));assert.ok(savedWorkspace.service.reports.some(row=>row.id===state.reportId));assert.equal(savedWorkspace.commissioning.events[0].id,state.commissioningRequestId);
    await phase('combinedCasePreserved',{reportId:state.reportId,serviceReports:savedWorkspace.service.reports.length,implementationEvents:savedWorkspace.commissioning.events.length});
    await transfer();
    sourceConsole=await startSupportConsole({port:state.ports.sourceConsole??0,casesDir:sourceCases,incidentSources:sourceFile,allowLoopback:true});
    receiverConsole=await startSupportConsole({port:state.ports.receiverConsole??0,casesDir:receiverCases,incidentSources:sourceFile,allowLoopback:true});
    state.ports.sourceConsole=Number(new URL(sourceConsole.url).port);state.ports.receiverConsole=Number(new URL(receiverConsole.url).port);await save();
    const catalogResponse=await fetch(sourceConsole.url+'/api/incidents/receiving'),sourceList=await catalogResponse.json();
    assert.equal(catalogResponse.status,200);assert.ok(sourceList.serviceMerchants.some(row=>row.id==='service-merchant'&&row.registered===false));
    const {chromium}=createRequire(import.meta.url)(playwrightModule);
    context=await chromium.launchPersistentContext(join(directory,'browser'),{headless:true,executablePath:chromiumPath,
      args:['--no-sandbox','--disable-dev-shm-usage'],acceptDownloads:true,viewport:{width:1440,height:1080}});
    const browser=await receiveServiceBrowser({context,sourceUrl:sourceConsole.url,receivingUrl:receiverConsole.url,
      caseId:state.caseId,reportId:state.reportId,directory,transfer});
    for(const artifact of Object.values(browser.artifacts??{})){
      const name=relative(directory,artifact.path);
      assert.ok(name&&!name.startsWith('..')&&!isAbsolute(name),'Browser artifact belongs to the original receiving directory');
      const bytes=await readFile(artifact.path);assert.equal(bytes.length,artifact.bytes);assert.equal(sha(bytes),artifact.sha256);
      await retain(name,bytes);
    }
    await retain('service-browser/service-browser-state.json',await readFile(browser.checkpointPath));
    await retain('service-browser-result.json',browser);await phase('browserReceiving');
    const finalCase=await current(),finalWorkspace=await parseWorkspace(finalCase.workspaceText);
    const latestReport=finalWorkspace.service.reports.at(-1);
    const cliRequest={method:'report',args:{id:state.caseId,revision:finalCase.currentRevision,reportId:latestReport.id}};
    const cliPath=join(directory,'service-report-request.json');await writeFile(cliPath,json(cliRequest),{mode:0o600});
    const cliArgs=['--cases-dir',sourceCases,'--request-file',cliPath,'--out',join(directory,'service-delivery')];
    const firstDelivery=await serviceCli(cliArgs,{stdout:{write:()=>{}}}),replayedDelivery=await serviceCli(cliArgs,{stdout:{write:()=>{}}});
    assert.equal(replayedDelivery.reused,true);assert.deepEqual(firstDelivery.files,replayedDelivery.files);
    for(const file of firstDelivery.files){const bytes=await readFile(join(directory,'service-delivery',file.name));
      assert.equal(sha(bytes),file.sha256);await retain('service-delivery/'+file.name,bytes);}
    await retain('service-delivery/service-delivery.json',await readFile(join(directory,'service-delivery','service-delivery.json')));
    await retain('service-delivery/service-delivery-request.json',await readFile(join(directory,'service-delivery','service-delivery-request.json')));
    state.exportRequest??={id:state.caseId,expectedRevision:finalCase.currentRevision,exportId:'service-complete',includeWorkorder:false};await save();
    assert.equal(state.exportRequest.expectedRevision,finalCase.currentRevision,'Continue the original complete browser case selected for export');
    let exportStatus=await call('merchant_support_export_status',{exportId:'service-complete'});
    if(exportStatus.state!=='COMPLETE')exportStatus=await call('merchant_case_export',state.exportRequest);
    assert.equal(exportStatus.state,'COMPLETE');
    assert.equal(exportStatus.case.id,state.caseId);assert.equal(exportStatus.case.revision,finalCase.currentRevision);
    assert.equal(exportStatus.case.workspaceSha256,sha(finalCase.workspaceText));
    if(!state.phases.exportPublicationRecovered){
      const published=await call('merchant_support_export_manifest',{exportId:'service-complete'});
      const interruption=join(directory,'export-publication-interruption');await mkdir(interruption,{recursive:true,mode:0o700});
      if(!state.exportInterruption){
        state.exportInterruption={files:[published.manifestFile,published.files.find(file=>file.name==='merchant-service-report.html')]};
        assert.ok(state.exportInterruption.files.every(Boolean));await save();
      }
      // Deliberate native publication fault: retain these original files outside
      // their final names. The original request journal must restore the exact
      // same export from its immutable case and frozen rendering time.
      for(const file of state.exportInterruption.files){
        const final=join(exportsDirectory,'service-complete',file.name),retained=join(interruption,file.name);
        let bytes;try{bytes=await readFile(retained);}catch(error){
          if(error.code!=='ENOENT')throw error;bytes=await readFile(final);
        }
        assert.equal(bytes.length,file.bytes);assert.equal(sha(bytes),file.sha256);
        // Re-entry may already have restored the export before returning to
        // this unfinished fault. Move its verified completion marker first
        // again, even when the retained copy exists, before moving the HTML.
        let finalBytes;try{finalBytes=await readFile(final);}catch(error){if(error.code!=='ENOENT')throw error;}
        if(finalBytes){
          assert.equal(finalBytes.length,file.bytes);assert.equal(sha(finalBytes),file.sha256);
          await rename(final,retained);
        }
        await retain('export-publication-interruption/'+file.name,bytes);
      }
      const interrupted=await call('merchant_support_export_status',{exportId:'service-complete'});
      assert.ok(['INCOMPLETE_OR_OTHER_EXPORT','COMPLETE'].includes(interrupted.state));
      if(interrupted.state!=='COMPLETE')assert.deepEqual(interrupted.request,state.exportRequest);
      const restored=await call('merchant_case_export',state.exportRequest);
      assert.equal(restored.state,'COMPLETE');assert.equal(restored.case.revision,state.exportRequest.expectedRevision);
      const replayed=await call('merchant_case_export',state.exportRequest);assert.equal(replayed.reused,true);
      const restoredManifest=await call('merchant_support_export_manifest',{exportId:'service-complete'});
      assert.equal(restoredManifest.manifestFile.sha256,state.exportInterruption.files[0].sha256);
      await phase('exportPublicationRecovered',{resumed:restored.resumed??false,completedReplay:replayed.reused,caseRevision:restored.case.revision});
    }
    const manifest=await call('merchant_support_export_manifest',{exportId:'service-complete'});
    assert.equal(manifest.case.id,state.caseId);assert.equal(manifest.case.revision,state.exportRequest.expectedRevision);
    assert.equal(manifest.case.workspaceSha256,sha(finalCase.workspaceText));
    const fullFiles=[...manifest.files,manifest.manifestFile];
    for(const name of ['merchant-service.json','merchant-service-report.json','merchant-service-report.csv','merchant-service-report.html'])
      assert.ok(manifest.files.some(file=>file.name===name),'Complete original export includes '+name);
    await mkdir(join(directory,'mcp-delivery'),{recursive:true,mode:0o700});
    for(const file of fullFiles){
      let offset=0,readId,parts=[];
      while(offset<file.bytes){
        const chunk=await call('merchant_support_export_file',{exportId:'service-complete',file:file.name,expectedManifestSha256:manifest.manifestFile.sha256,
          ...(readId?{readId}:{}),expectedSha256:file.sha256,offset,limit:32768});
        const data=Buffer.from(chunk.data??chunk.base64,'base64');assert.ok(data.length);parts.push(data);offset+=data.length;readId=chunk.readId;
      }
      const bytes=Buffer.concat(parts);assert.equal(bytes.length,file.bytes);assert.equal(sha(bytes),file.sha256);await retain('mcp-delivery/'+file.name,bytes);
      if(readId)await call('merchant_support_export_file_release',{exportId:'service-complete',readId});
    }
    const receivedCase=await receiverStore.read(state.caseId);
    assert.equal(receivedCase.workspaceText,finalCase.workspaceText);assert.equal(receivedCase.supportText,finalCase.supportText);
    await phase('completeReportsAndReceiving',{caseRevision:finalCase.currentRevision,receivingRevision:receivedCase.currentRevision,
      serviceReports:finalWorkspace.service.reports.length,serviceCaptures:finalWorkspace.service.captures.length,
      operatorChanges:finalWorkspace.service.operations.length,deliveryFiles:firstDelivery.files.length,mcpFiles:fullFiles.length});
    await context.close();context=null;await sourceConsole.close();sourceConsole=null;await receiverConsole.close();receiverConsole=null;
    await provider.close();provider=null;await closeServer(mcpServer);await closeServer(proxy);await ops.close();ops=null;await seller.close();seller=null;
    state.result='PASS';state.completedAt=new Date().toISOString();state.node=process.version;await save();
    await writeFile(completed,json(state),{mode:0o600});return state;
  }catch(error){state.result='INTERRUPTED';state.error={code:error.code??null,message:error.message};await save();throw error;}
  finally{await context?.close().catch(()=>{});await sourceConsole?.close().catch(()=>{});await receiverConsole?.close().catch(()=>{});
    await provider?.close().catch(()=>{});await closeServer(mcpServer).catch(()=>{});await closeServer(proxy).catch(()=>{});
    await ops?.close().catch(()=>{});await seller?.close().catch(()=>{});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {values}=parseArgs({options:{directory:{type:'string'},'source-commit':{type:'string'},chromium:{type:'string'},'playwright-module':{type:'string'}}});
  receiveServiceCase({directory:values.directory,sourceCommit:values['source-commit'],chromiumPath:values.chromium,playwrightModule:values['playwright-module']})
    .then(result=>process.stdout.write(json(result))).catch(error=>{process.stderr.write(json({error:error.code??null,detail:error.message}));process.exitCode=1;});
}
