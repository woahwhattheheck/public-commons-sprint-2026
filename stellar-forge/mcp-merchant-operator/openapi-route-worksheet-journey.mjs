#!/usr/bin/env node
// MIT. One original SF61/merchant MCP route worksheet, receiving and release journey.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, lstat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startWorkspace } from '../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/server.mjs';
import { readPackage } from '../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/model.mjs';
import { initializeMerchantProvider } from './providers.mjs';
import { inspectMerchantProvider } from './provider-cli.mjs';
import { startMerchantMcp } from './serve.mjs';
import { openMerchantFileClient } from './retained-download.mjs';
import { downloadOpenApiRouteWorksheet, readOpenApiRouteWorksheet } from './openapi-route-worksheet-client.mjs';
import { main as worksheetCli } from './openapi-route-worksheet-cli.mjs';
import { downloadOpenApiPackage, reopenOpenApiPackageDownload } from './openapi-workspace-client.mjs';
import { routeKey } from '../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/route-sheet-model.mjs';

const OPERATION='ASTRA-D76C-SCF-ROUTE-WORKSHEET-20261012';
const json=value=>JSON.stringify(value,null,2)+'\n';
const hash=value=>createHash('sha256').update(value).digest('hex');
const clone=value=>structuredClone(value);
const exists=async path=>{try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const file=async(path,content)=>writeFile(path,content,{mode:0o600});
const canonical=value=>JSON.stringify(value,(_,entry)=>entry&&typeof entry==='object'&&!Array.isArray(entry)
  ?Object.fromEntries(Object.keys(entry).sort().map(key=>[key,entry[key]])):entry);
const withoutPrice=row=>{const result=clone(row);delete result.amountAtomic;return result;};

export async function runRouteWorksheetJourney({parent}={}) {
  const root=await mkdtemp(join(resolve(parent),'merchant-route-worksheet-'));
  const senderRoot=join(root,'sender'),receiverRoot=join(root,'receiver'),hostFiles=join(root,'host-files');
  const downloads=join(root,'downloads'),downloadDirectory=join(downloads,'received-package');
  for(const directory of [senderRoot,receiverRoot,hostFiles,downloads])await mkdir(directory,{mode:0o700});
  const report={schema:'stellar-forge.api-route-worksheet-native-journey.v1',operation:OPERATION,
    startedAt:new Date().toISOString(),node:process.version,steps:[],source:{}};
  for(const path of ['openapi-route-worksheet.mjs','openapi-workspace.mjs','openapi-route-worksheet-client.mjs',
    'openapi-route-worksheet-cli.mjs','catalog/openapi-route-worksheet.mjs','catalog/openapi-workspace.mjs',
    'sf61-connection.mjs','config.mjs','serve.mjs','retained-download.mjs',
    'openapi-workspace-client.mjs','openapi-route-worksheet-journey.mjs',
    '../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/server.mjs',
    '../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/model.mjs',
    '../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/route-sheet-model.mjs'])
    report.source[path]=hash(await readFile(new URL(path,import.meta.url)));
  const step=(name,details={})=>{report.steps.push({name,completedAt:new Date().toISOString(),...details});
    console.log(JSON.stringify({operation:OPERATION,step:name,...details}));};
  const originalText=await readFile(new URL('../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/openapi.example.json',import.meta.url),'utf8');
  const spec=JSON.parse(originalText);
  for(let index=0;index<1300;index++) {
    const path='/receiving-station-'+String(index).padStart(4,'0')+'/forecast/{city}';
    spec.paths[path]=clone(spec.paths['/forecast/{city}']);
    spec.paths[path].get.operationId='stationForecast'+index;
  }
  const specText=JSON.stringify(spec),sourcePath=join(hostFiles,'source.json');
  const selections=JSON.parse(await readFile(new URL('../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/service-selections.example.json',import.meta.url),'utf8'));
  const {scheme,amount,...payment}=selections[0].accepts[0];assert.equal(scheme,'exact');
  const high='9007199254740993',extraPrice='9007199254741001';
  const forecast={id:'forecast',method:'GET',path:'/forecast/{city}',amountAtomic:high,
    timeoutMs:4500,maxResponseBytes:1048576,maxInFlight:3,requestHeaders:['accept-language'],
    responseMode:'json',responseValidation:'none',publicDescription:'Forecast for one city',
    cache:{shareAcrossBuyers:true,ttlMs:30000,maxEntries:64,maxBytes:1048576,maxEntryBytes:65536,
      maxSourceInFlight:2,maxWaiters:32,sourceTimeoutMs:5000}};
  const coordinates={id:'coordinates',method:'POST',path:'/forecast',amountAtomic:'27000',
    timeoutMs:7000,maxResponseBytes:262144,maxRequestBytes:8192,maxInFlight:4,responseMode:'json',
    responseValidation:'none',publicDescription:'Forecast from coordinates'};
  const plan={schema:'stellar-forge.api-merchant-plan.v1',sellerServer:'https://merchant.example/api',
    serviceName:selections[0].serviceName,payment:{...payment,paymentFlow:'authorization'},
    operations:[forecast,coordinates],allowLoopbackUpstream:false};
  const alternate=clone(plan);alternate.operations[0].amountAtomic='9007199254741010';
  const extra={...clone(forecast),id:'extra_station',path:'/receiving-station-0000/forecast/{city}',amountAtomic:extraPrice};
  const currentOnly={...clone(forecast),id:'current_station',path:'/receiving-station-0001/forecast/{city}',amountAtomic:'75000'};
  const planPath=join(hostFiles,'plan.json'),alternatePath=join(hostFiles,'alternate-plan.json');
  const proposedPath=join(hostFiles,'proposed-sheet.json'),basePath=join(hostFiles,'base-sheet.json');
  const cliPath=join(hostFiles,'cli-sheet.json'),resolvedPath=join(hostFiles,'resolved-sheet.json');
  const senderUrl=join(hostFiles,'sender-url.txt'),receiverUrl=join(hostFiles,'receiver-url.txt');
  const connection=join(hostFiles,'sf61-connection.json');
  await file(sourcePath,specText);await file(planPath,json(plan));await file(alternatePath,json(alternate));
  const environment={...process.env,WORKSHEET_NATIVE_TOKEN:randomBytes(32).toString('hex'),
    MCP_OAUTH_CONFIG:undefined,MCP_CLIENT_ORIGINS:''};
  let sender,receiver,mcp,client,configuration,rotation;
  const originalFetch=globalThis.fetch;
  const close=async()=>{
    globalThis.fetch=originalFetch;
    if(mcp){const selected=mcp;mcp=null;await selected.close();}
    const owners=[sender,receiver].filter(Boolean);sender=null;receiver=null;
    const endings=await Promise.allSettled(owners.map(owner=>owner.close()));
    const failures=endings.filter(value=>value.status==='rejected').map(value=>value.reason);
    if(failures.length)throw new AggregateError(failures,'Original console shutdown failed');
  };
  const call=(name,args)=>client.call('merchant_openapi_'+name,args);
  const native=async(name,args)=>(await call(name,args)).native;
  try {
    sender=await startWorkspace({parent:senderRoot,port:0,noSignals:true});
    receiver=await startWorkspace({parent:receiverRoot,port:0,noSignals:true});
    await file(senderUrl,sender.url+'\n');await file(receiverUrl,receiver.url+'\n');
    const declared={source:{kind:'source',path:sourcePath,sha256:hash(specText)},
      plan:{kind:'plan',path:planPath,sha256:hash(json(plan))},
      alternate:{kind:'plan',path:alternatePath,sha256:hash(json(alternate))},
      proposed:{kind:'packet',path:proposedPath},base:{kind:'packet',path:basePath},
      resolved:{kind:'packet',path:resolvedPath}};
    await file(connection,json({schema:'stellar-forge.sf61-workspace-connection.v1',workspaces:{
      sender:{label:'Original API sender',consoleUrlFile:senderUrl,files:declared},
      receiver:{label:'Original API receiver',consoleUrlFile:receiverUrl,files:declared,
        deliveries:{received:{directory:downloadDirectory}}}}}));
    const registered=inspectMerchantProvider('openapi-workspaces').providers[0];
    assert.equal(registered.family,'openapiWorkspaces');assert.equal(registered.configurationInput,'openapiWorkspaceConnection');
    assert(registered.contributions.length);assert(registered.tools.some(tool=>tool.name==='merchant_openapi_route_sheet_reconcile'));
    step('registered-source-provider-selected',{provider:registered.id,tools:registered.toolCount,sourceSha256:registered.sha256});
    ({configuration}=await initializeMerchantProvider('openapi-workspaces', {directory:join(root,'merchant-mcp'),connection,name:'Original route worksheet receiving'}));
    mcp=await startMerchantMcp({configPath:configuration,port:0,tokenEnv:'WORKSHEET_NATIVE_TOKEN',environment});
    client=await openMerchantFileClient({url:mcp.url,tokenEnv:'WORKSHEET_NATIVE_TOKEN',environment,
      errorPrefix:'OPENAPI_WORKSHEET',clientName:'original-route-worksheet-native'});
    const initialName='worksheet-base',firstName='worksheet-reviewed',currentName='worksheet-current',finalName='worksheet-reconciled';
    const initial=await native('save',{workspace:'sender',name:initialName,specFile:'source',planFile:'plan'});
    await native('save',{workspace:'receiver',name:initialName,specFile:'source',planFile:'alternate'});
    const input={workspace:'sender',baseName:initialName};
    const found=[];let offset=0,inventory;
    do {
      inventory=await call('routes',{...input,offset,limit:200});
      found.push(...inventory.inventory.items);offset=inventory.inventory.nextOffset;
    }while(offset!==null);
    assert.equal(found.length,1302);assert.equal(new Set(found.map(routeKey)).size,1302);
    assert.equal(inventory.counts.selected,2);assert.equal(inventory.context.sourceSha256,hash(specText));
    assert.equal(inventory.context.planSha256,hash(canonical(plan)));
    assert.ok(inventory.worksheet.bytes>131072);assert.equal(inventory.inlineWorksheet,undefined);
    const beforeFile=await downloadOpenApiRouteWorksheet({client,workspace:'sender',request:{baseName:initialName},
      path:basePath,chunkBytes:65536,expectedWorksheetSha256:inventory.worksheet.sha256});
    step('original-large-source-and-complete-inventory',{sourceBytes:Buffer.byteLength(specText),operations:found.length,
      inventoryPages:Math.ceil(found.length/200),worksheetBytes:beforeFile.bytes,merchantRequestBytes:mcp.maxRequestBytes,
      initialPackageId:initial.package.manifest.id,fixtureSha256:hash(originalText)});
    const actions=[
      {filter:{inclusion:'included'},price:{kind:'percent',value:'12.50',rounding:'up'}},
      {filter:{method:'GET',search:extra.path},selected:true,price:{kind:'fixed',value:extraPrice}}];
    const staged={baseName:initialName,expectedSourceSha256:hash(specText),expectedPlanSha256:hash(canonical(plan)),actions};
    const selected=await call('routes',{workspace:'sender',...staged,filter:{changed:true}});
    assert.equal(selected.counts.selected,3);assert.equal(selected.counts.changed,3);
    const expectedHigh=((BigInt(high)*11250n+9999n)/10000n).toString();
    assert.equal(selected.inventory.items.find(row=>row.path===forecast.path).amountAtomic,expectedHigh);
    assert.equal(selected.inventory.items.find(row=>row.path===coordinates.path).amountAtomic,'30375');
    let chunks=0;
    const downloaded=await downloadOpenApiRouteWorksheet({client,workspace:'sender',request:staged,path:proposedPath,
      expectedWorksheetSha256:selected.worksheet.sha256,chunkBytes:65536,onProgress:()=>{chunks++;}});
    assert.ok(downloaded.bytes>131072);assert.ok(chunks>1);assert.equal(downloaded.state,'COMPLETE');
    const read=await readOpenApiRouteWorksheet({path:proposedPath,expectedSha256:downloaded.sha256});
    assert.equal(read.sheet.rows.length,1302);
    const repeated=await downloadOpenApiRouteWorksheet({client,workspace:'sender',request:staged,path:proposedPath,
      expectedWorksheetSha256:downloaded.sha256,chunkBytes:65536});
    assert.equal(repeated.state,'REOPENED');assert.equal(repeated.sha256,downloaded.sha256);
    const oversized=JSON.stringify({jsonrpc:'2.0',id:701,method:'tools/call',params:{
      name:'merchant_openapi_routes',arguments:{workspace:'sender',baseName:initialName,worksheet:read.sheet}}});
    assert.ok(Buffer.byteLength(oversized)>mcp.maxRequestBytes);
    const rejected=await originalFetch(mcp.url,{method:'POST',headers:{authorization:'Bearer '+environment.WORKSHEET_NATIVE_TOKEN,
      'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-06-18'},body:oversized});
    assert.equal(rejected.status,413);await rejected.body?.cancel();
    const imported={workspace:'sender',baseName:initialName,worksheetFile:'proposed',operationPlans:[extra]};
    const reviewed=await call('route_sheet_review',imported);
    assert.equal(reviewed.review.worksheetSha256,downloaded.sha256);
    assert.equal(reviewed.native.routes.length,3);
    const saveInput={...imported,name:firstName,expectedReviewSha256:reviewed.review.sha256};
    rotation={armed:true,changed:false};
    globalThis.fetch=async(target,options)=>{
      const response=await originalFetch(target,options),url=new URL(typeof target==='string'?target:target.url??target.href);
      if(rotation?.armed&&url.origin===sender.origin&&url.pathname==='/api/load'&&url.searchParams.get('name')===initialName&&response.ok) {
        rotation.armed=false;await file(senderUrl,receiver.url+'\n');rotation.changed=true;
      }
      return response;
    };
    const saved=await call('route_sheet_save',saveInput);
    globalThis.fetch=originalFetch;
    assert.equal(rotation.changed,true);assert.equal(await exists(join(senderRoot,firstName)),true);
    assert.equal(await exists(join(receiverRoot,firstName)),false);
    const nextHost=await call('routes',{workspace:'sender',baseName:initialName,limit:1});
    assert.equal(nextHost.context.planSha256,hash(canonical(alternate)));
    await file(senderUrl,sender.url+'\n');
    const savedRetry=await call('route_sheet_save',saveInput);assert.equal(savedRetry.native.recovered,true);
    assert.equal(savedRetry.native.package.manifest.id,saved.native.package.manifest.id);
    const reopened=await native('load',{workspace:'sender',name:firstName});
    const accepted=await readPackage(senderRoot,firstName);
    assert.deepEqual(reopened.plan,accepted.plan);
    assert.deepEqual(accepted.plan.operations.map(withoutPrice),[forecast,coordinates,extra].map(withoutPrice));
    assert.equal(accepted.plan.operations[0].amountAtomic,expectedHigh);
    assert.equal(accepted.plan.operations[2].amountAtomic,extraPrice);
    step('exact-prices-portable-file-original-save-and-host-rotation',{worksheetBytes:downloaded.bytes,worksheetSha256:downloaded.sha256,
      chunks,inlineRequestStatus:rejected.status,exactBefore:high,exactAfter:expectedHigh,
      newRouteId:extra.id,packageId:saved.native.package.manifest.id,recovered:savedRetry.native.recovered,
      currentOperationKeptOriginalHost:true,nextOperationUsedUpdatedHost:true});
    const cliRequest=join(hostFiles,'worksheet-request.json');await file(cliRequest,json({workspace:'sender',baseName:initialName,worksheetFile:'proposed'}));
    const previousToken=process.env.WORKSHEET_NATIVE_TOKEN;process.env.WORKSHEET_NATIVE_TOKEN=environment.WORKSHEET_NATIVE_TOKEN;
    try {
      const cli=await worksheetCli(['export','--url',mcp.url,'--token-env','WORKSHEET_NATIVE_TOKEN','--request-file',cliRequest,
        '--out',cliPath,'--worksheet-sha256',downloaded.sha256,'--chunk-bytes','65536']);
      assert.equal(cli.sha256,downloaded.sha256);assert.equal(hash(await readFile(cliPath)),downloaded.sha256);
    } finally {if(previousToken===undefined)delete process.env.WORKSHEET_NATIVE_TOKEN;else process.env.WORKSHEET_NATIVE_TOKEN=previousToken;}
    const currentPlan=clone(plan);currentPlan.operations[0].amountAtomic='9007199254741200';
    currentPlan.operations[1].amountAtomic='45000';currentPlan.operations.push(clone(extra),clone(currentOnly));
    await native('save',{workspace:'sender',name:currentName,specFile:'source',plan:currentPlan});
    const reconcileInput={workspace:'sender',baseName:currentName,worksheetFile:'proposed',baseWorksheetFile:'base'};
    const conflict=await call('route_sheet_reconcile',reconcileInput);
    assert.equal(conflict.conflicts.total,2);assert(conflict.conflicts.items.every(row=>row.field==='amountAtomic'));
    const choices=Object.fromEntries(conflict.conflicts.items.map(row=>[row.id,row.path===forecast.path?'SHEET':'CURRENT']));
    const reconciled=await call('route_sheet_reconcile',{...reconcileInput,choices});
    assert.equal(reconciled.conflicts.total,0);assert.equal(reconciled.counts.selected,4);
    const finalReview=await call('route_sheet_review',{...reconcileInput,choices});
    const finalSave=await call('route_sheet_save',{...reconcileInput,choices,name:finalName,expectedReviewSha256:finalReview.review.sha256});
    const finalProject=await readPackage(senderRoot,finalName);
    const byId=Object.fromEntries(finalProject.plan.operations.map(row=>[row.id,row]));
    assert.equal(byId.forecast.amountAtomic,expectedHigh);assert.equal(byId.coordinates.amountAtomic,'45000');
    assert.equal(byId.extra_station.amountAtomic,extraPrice);assert.deepEqual(byId.current_station,currentOnly);
    assert.deepEqual(withoutPrice(byId.forecast),withoutPrice(forecast));
    const {workspace:ignored,...resolvedRequest}=reconcileInput;
    const resolvedFile=await downloadOpenApiRouteWorksheet({client,workspace:'sender',request:{...resolvedRequest,choices},
      path:resolvedPath,chunkBytes:65536,expectedWorksheetSha256:finalReview.worksheet.sha256});
    assert.ok(resolvedFile.bytes>131072);
    step('original-current-plan-reconciliation-and-cli',{priceConflicts:2,choices:['SHEET','CURRENT'],selected:4,
      coalescedRoute:extra.id,preservedCurrentRoute:currentOnly.id,finalPackageId:finalSave.native.package.manifest.id,
      finalWorksheetSha256:resolvedFile.sha256,cliWorksheetSha256:downloaded.sha256});
    const inspected=await native('package_inspect',{workspace:'sender',name:finalName});
    const exported=await call('export',{workspace:'sender',name:finalName,expectedPackageManifestSha256:inspected.manifestSha256});
    const complete=await downloadOpenApiPackage({client,workspace:'sender',exportId:exported.exportId,directory:downloadDirectory,
      expectedManifestSha256:exported.manifestFile.sha256,chunkSize:65536});
    const local=await reopenOpenApiPackageDownload({directory:downloadDirectory,expectedManifestSha256:exported.manifestFile.sha256});
    assert.equal(complete.state,'COMPLETE');assert.equal(local.package.id,finalProject.manifest.id);
    const received=await native('receive',{workspace:'receiver',delivery:'received',name:finalName,
      expectedManifestSha256:exported.manifestFile.sha256});
    const retryReceive=await native('receive',{workspace:'receiver',delivery:'received',name:finalName,
      expectedManifestSha256:exported.manifestFile.sha256});
    assert.equal(retryReceive.recovered,true);assert.equal(received.package.id,finalProject.manifest.id);
    const restored=await readPackage(receiverRoot,finalName);
    assert.deepEqual(restored.plan,finalProject.plan);assert.equal(restored.specText,specText);
    for(const entry of exported.manifest.files)assert.equal(hash(await readFile(join(restored.folder,entry.name))),entry.sha256,entry.name);
    step('complete-original-package-export-download-and-receive',{exportId:exported.exportId,
      manifestSha256:exported.manifestFile.sha256,files:exported.manifest.files.length,bytes:exported.manifest.totalBytes,
      packageId:received.package.id,recovered:retryReceive.recovered});
    const stagedRelease=await native('stage',{workspace:'receiver',name:finalName,id:'worksheet-received',
      expectedPackageManifestSha256:received.package.manifestSha256});
    assert.equal(stagedRelease.state,'STAGED');
    const release=await client.call('merchant_inspect',{id:'worksheet-received'});
    const comparison=await client.call('merchant_compare',{from:null,to:'worksheet-received'});
    await client.call('merchant_activate',{id:'worksheet-received',expectedDigest:release.digest,
      expectedGeneration:comparison.generation,reason:'Operate the original reviewed worksheet receiving package'});
    const selectedRelease=await client.call('merchant_status',{});
    const started=await client.call('merchant_start',{expectedDigest:release.digest,expectedGeneration:selectedRelease.state.generation});
    assert.equal(started.runtime.state,'RUNNING');assert.equal(started.runtime.observed.mode,'CHALLENGE_ONLY');
    const offer=restored.manifest.preview.routes.find(row=>row.id==='forecast');
    const publicPath=new URL(offer.publicUrl).pathname.replace(/\{city\}|%7Bcity%7D/gi,'Louisville');
    const unpaidUrl=new URL(publicPath,started.runtime.observed.listener);unpaidUrl.searchParams.set('days','1');
    const unpaid=await originalFetch(unpaidUrl,{signal:AbortSignal.timeout(15000)});
    assert.equal(unpaid.status,402);await unpaid.body?.cancel();
    const stopped=await client.call('merchant_stop',{instanceId:started.operator.instanceId});
    assert.equal(stopped.status.runtime.state,'STOPPED');
    step('original-release-compare-activate-start-402-and-owned-stop',{releaseId:stagedRelease.record.id,
      releaseDigest:release.digest,selectionGeneration:selectedRelease.state.generation,challengeStatus:unpaid.status,
      shutdown:stopped.status.runtime.state});
    report.state='PASSED';report.completedAt=new Date().toISOString();
  } catch(error) {
    report.state='FAILED';report.failure={code:error.code??null,message:error.message,stack:error.stack};
    throw error;
  } finally {
    try{await close();}finally{await file(join(root,'result.json'),json(report));}
  }
  const result=join(root,'result.json');
  console.log(JSON.stringify({state:report.state,operation:OPERATION,result,steps:report.steps.length,node:report.node}));
  return {report,result};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [parent,...extra]=process.argv.slice(2);
  if(!parent||extra.length){console.error('Usage: node openapi-route-worksheet-journey.mjs EXISTING_PRIVATE_PARENT');process.exitCode=1;}
  else runRouteWorksheetJourney({parent}).catch(error=>{console.error(error.stack??error.message);process.exitCode=1;});
}
