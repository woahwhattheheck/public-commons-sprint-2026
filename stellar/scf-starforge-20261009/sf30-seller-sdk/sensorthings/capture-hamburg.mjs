// MIT. One real public Hamburg source operation through the native adapter.
import {resolve,isAbsolute,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openSensorThingsWorkspace} from './core.mjs';
import {json,identity} from './contract.mjs';
const OPERATION='SCF_SENSORTHINGS_HAMBURG_NATIVE_1B40_20261012';
export async function captureHamburg({directory,resume=false,retryFailed=false}={}){
  if(!isAbsolute(directory??''))throw new TypeError('Use a new absolute private native workspace, or the same directory to inspect/resume this operation.');
  const workspace=await openSensorThingsWorkspace({directory});
  const call=async(suffix,action,payload)=>workspace.action({operationId:OPERATION+'_'+suffix,
    expectedRevision:(await workspace.view()).revision,action,payload});
  try{
    const source=(await call('SOURCE','source.add',{
      label:'Hamburg public charging-point status — original selected stream',
      serviceUrl:'https://iot.hamburg.de/v1.1/',
      license:{name:'Datenlizenz Deutschland — Namensnennung — Version 2.0',
        url:'https://www.govdata.de/dl-de/by-2-0',
        attribution:'Freie und Hansestadt Hamburg, Behörde für Wirtschaft und Innovation',
        sourceUrl:'https://suche.transparenz.hamburg.de/dataset/elektro-ladestandorte-hamburg36',
        note:'Original published dataset edition. Provider observations are captured separately at their actual request times; current licence or service revisions must be retained as new source evidence.'},
      maxPageBytes:4*1024*1024,requestTimeoutMs:45000
    })).result;
    const catalogue=(await call('CATALOG','catalog.capture',{sourceId:source.id,kind:'Datastreams',
      query:{filter:"properties/serviceName eq 'HH_STA_E-Ladestationen' and properties/layerName eq 'Status_E-Ladepunkt'",
        orderBy:'id asc',top:3,count:true}})).result;
    const rows=await workspace.catalogRows(catalogue.id,{offset:0,limit:3});
    if(!rows.rows.length)throw Object.assign(new Error('The actual original catalogue has no selected charging-status stream. Retain the source response; do not invent a stream or change the same operation.'),{code:'SENSORTHINGS_EMPTY_ACTUAL_CATALOGUE'});
    const plan=(await call('PLAN','plan.create',{sourceId:source.id,
      label:'First original catalogue stream; provider-selected latest twelve observations and current entity graph',
      streams:[{catalogId:catalogue.id,pointer:rows.rows[0].pointer}],
      observationQuery:{orderBy:'phenomenonTime desc',top:12,count:true,expandFeatureOfInterest:true},
      includeHistoricalLocations:false,maxRequests:128,maxBytes:32*1024*1024})).result;
    const started=(await call('CAPTURE','capture.start',{planId:plan.id,budget:128})).result;
    let capture=await workspace.waitCapture(started.captureId);
    if(capture.state!=='COMPLETE'&&resume){
      const suffix='RESUME_'+identity({captureId:capture.id,attempts:capture.tasks.map(t=>({id:t.id,state:t.state,attempts:t.attempts.length})),retryFailed}).slice(0,20);
      await call(suffix,'capture.resume',{captureId:capture.id,budget:128,retryFailed});
      capture=await workspace.waitCapture(capture.id);
    }
    const view=await workspace.view(),editionId=capture.editionIds.at(-1)??null;
    const result={schema:'stellar-forge.sensorthings-public-capture-operation.v1',operationId:OPERATION,
      workspaceId:view.workspaceId,directory:workspace.directory,revision:view.revision,sourceId:source.id,catalogId:catalogue.id,planId:plan.id,
      captureId:capture.id,state:capture.state,editionId,selectedCataloguePointer:rows.rows[0].pointer,
      selectedOriginalStream:plan.streams[0],catalogueHasAdditionalPage:Boolean(catalogue.next),
      requests:capture.tasks.reduce((n,t)=>n+t.attempts.length,0),pages:capture.pages.length,bytes:capture.totalBytes,
      issues:capture.issues,remaining:capture.tasks.filter(t=>t.state!=='COMPLETE').map(t=>({id:t.id,url:t.url,state:t.state,error:t.error})),
      summary:editionId?await workspace.summary(editionId):null,
      scope:'Actual sequential public GET responses for one explicitly selected source/query. No provider write, payment, QA inference or all-station/historical coverage claim.',
      artifacts:{objects:'objects/<SHA256>',requestReceipts:'receipts/sensorthings-<requestId>-request.json',
        responseReceipts:'receipts/sensorthings-<requestId>-response.json',edition:editionId?'editions/'+editionId+'.json':null}};
    const saved=await workspace.store.putObject(json(result));
    await workspace.store.immutable(join(workspace.directory,'receipts','public-capture-'+saved.sha256+'.json'),json(result));
    return {...result,resultSha256:saved.sha256,resultBytes:saved.bytes};
  }finally{await workspace.close();}
}
export async function main(args=process.argv.slice(2)){
  if(!args.length||args.includes('--help')){
    console.log('node capture-hamburg.mjs --workspace ABSOLUTE_DIRECTORY [--resume] [--retry-failed]\nOne original public GET operation; --resume follows its same native queue. --retry-failed explicitly permits another request after a retained failure.');return;
  }
  if(args[0]!=='--workspace'||!args[1]||args.slice(2).some(x=>!['--resume','--retry-failed'].includes(x))||
      args.includes('--retry-failed')&&!args.includes('--resume'))throw new TypeError('Choose the declared original workspace and optional explicit resume flags.');
  const result=await captureHamburg({directory:resolve(args[1]),resume:args.includes('--resume'),retryFailed:args.includes('--retry-failed')});
  console.log(JSON.stringify(result,null,2));if(result.state!=='COMPLETE')process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{
  console.error(JSON.stringify({error:error.code??'SENSORTHINGS_CAPTURE_FAILED',message:error.message,details:error.details??null}));process.exitCode=1;
});
