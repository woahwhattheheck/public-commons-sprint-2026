#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import {mkdir,readFile,lstat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {openGraviteeWorkspace} from './workspace.mjs';
import {writeImmutableBytes} from './store.mjs';
import {receivePackage,inspectReceivingPackage} from './delivery.mjs';
import {normalizeConnection,hashJSON,sha256,requireValue,publicError} from './contract.mjs';
import {operationLease,saveJSON,privateDirectory,regular} from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';

const stableUUID=(parent,name)=>{const h=hashJSON({parent,name});return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);};
const saveFile=writeImmutableBytes;
export async function runNativeReceiving(configuration){
 const configured=normalizeConnection(configuration.connection),directory=resolve(configuration.outputDirectory);
 await mkdir(directory,{mode:0o700,recursive:false}).catch(error=>{if(error.code!=='EEXIST')throw error;});await privateDirectory(directory);
 const lease=await operationLease(join(directory,'native-receiving.lock'));let workspace,receiving;
 const inputIdentity=hashJSON({connection:configured,upstream:configuration.upstream,expectedPublicStatus:configuration.expectedPublicStatus??200,
  expectedUnauthenticatedStatus:configuration.expectedUnauthenticatedStatus??401,review:configuration.review??{},probeSuffix:configuration.probeSuffix??'/',gatewayWaitMs:configuration.gatewayWaitMs??120000});
 let state,report;
 async function checkpoint(){await saveJSON(join(directory,'state.json'),{...state,report},true);await saveJSON(join(directory,'native-report.json'),report,true);}
 function progress(phase,details={}){process.stdout.write(JSON.stringify({operationId:state.operationId,phase,...details})+'\n');}
 try{
  let saved=null;try{saved=JSON.parse((await regular(join(directory,'state.json'),32*1024*1024)).toString('utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(saved){
   const {report:originalReport,...originalState}=saved;state=originalState;report=originalReport;
   requireValue(state.schema==='gravitee.native-receiving-state.v1'&&report?.operationId===state.operationId,'ORIGINAL_NATIVE_STATE_INVALID');
   requireValue(state.inputIdentity===inputIdentity,'NATIVE_RECEIVING_INPUT_CHANGED');
   if(report.state==='COMPLETE'){
    const bytes=await regular(join(directory,report.handover.file),512*1024*1024);
    requireValue(bytes.length===report.handover.bytes&&sha256(bytes)===report.handover.sha256,'ORIGINAL_NATIVE_HANDOVER_CHANGED');
    progress('COMPLETE',{report:join(directory,'native-report.json'),handover:join(directory,report.handover.file),apiIds:report.apiIds});
    return report;
   }
  }else{
   const operationId=randomUUID();state={schema:'gravitee.native-receiving-state.v1',operationId,inputIdentity,prefix:'native-'+operationId.slice(0,8),createdAt:new Date().toISOString(),steps:{},gatewayAttempts:{}};
   report={schema:'gravitee.native-receiving-report.v1',operationId,startedAt:state.createdAt,connection:{...configured,contract:configured.contract?'operator-selected':'4.12.21'},upstream:configuration.upstream,steps:[],state:'RUNNING'};await checkpoint();
  }
  workspace=await openGraviteeWorkspace({directory:join(directory,'workspace')});
  async function step(name,method,input){
   const file='step-'+name+'.json',path=join(directory,file);
   const requiresId=!['view','list','get','readObject','readSource','readDraft','readCapture','refreshOperation','executeOperation','reconcileOperation'].includes(method);
   const args={...input,...(requiresId?{requestId:stableUUID(state.operationId,name)}:{})};
   async function current(result){
    if(result?.kind&&['operation','commissioning','capture'].includes(result.kind)){
     let original=await workspace.action('get',{kind:result.kind,id:result.id});
     if(method==='capture'&&original.value.state!=='CAPTURED')original=await workspace.action(method,args);
     return original;
    }
    return result;
   }
   if(state.steps[name]){
    const bytes=await regular(path,512*1024*1024),saved=state.steps[name];
    requireValue(bytes.length===saved.bytes&&sha256(bytes)===saved.sha256,'ORIGINAL_NATIVE_STEP_CHANGED');
    return current(JSON.parse(bytes.toString('utf8')));
   }
   let bytes,result;
   try{bytes=await regular(path,512*1024*1024);result=JSON.parse(bytes.toString('utf8'));}
   catch(error){if(error.code!=='ENOENT')throw error;progress(name,{method});result=await workspace.action(method,args);bytes=Buffer.from(JSON.stringify(result,null,2)+'\n');await saveFile(path,bytes);}
   state.steps[name]={file,sha256:sha256(bytes),bytes:bytes.length};report.steps.push({name,method,record:result?.kind?{kind:result.kind,id:result.id,revision:result.revision}:null,
    state:result?.value?.state??(result.complete===false?'INCOMPLETE':'RECEIVED'),file,sha256:sha256(bytes)});await checkpoint();return current(result);
  }
  const connection=await step('save-connection','saveConnection',{connection:configured});const connectionId=connection.id;
  const upstream=new URL(configuration.upstream);requireValue(['https:','http:'].includes(upstream.protocol)&&!upstream.username&&!upstream.password,'REAL_UPSTREAM_REQUIRED');
  const publicName=state.prefix+' public',privateName=state.prefix+' protected';
  const originalOpenAPI={openapi:'3.0.3',info:{title:publicName,version:'1.0'},servers:[{url:upstream.href}],paths:{'/':{get:{operationId:'readUpstream',responses:{'200':{description:'Original upstream response'}}}}}};
  const publicSource=await step('import-openapi','importSource',{entry:'public/openapi.json',label:publicName,files:[{path:'public/openapi.json',content:JSON.stringify(originalOpenAPI,null,2)+'\n',mediaType:'application/json'}]});
  const publicDraft=await step('map-public-proxy','saveDraft',{sourceId:publicSource.id,mapping:{name:publicName,apiVersion:'1.0',contextPath:'/'+state.prefix+'-public',
    upstream:upstream.href,security:{type:'KEY_LESS'},visibility:'PRIVATE'}});
  const sourceRAML='#%RAML 1.0\n'+
   'title: '+privateName+'\nversion: "1.0"\nbaseUri: '+upstream.href+'\n'+
   'securitySchemes:\n  apiKey:\n    type: Pass Through\n    describedBy:\n      headers:\n        X-Gravitee-Api-Key:\n          type: string\nsecuredBy: [apiKey]\n'+
   'types:\n  Message:\n    type: object\n    properties:\n      message: string\n'+
   '/:\n  get:\n    responses:\n      200:\n        body:\n          application/json:\n            type: Message\n';
  const raml=sourceRAML;
  const privateSource=await step('import-raml','importSource',{entry:'protected/api.raml',label:privateName,files:[{path:'protected/api.raml',content:raml,mediaType:'application/raml+yaml'}]});
  const privateOriginal=await workspace.action('readSource',{id:privateSource.id}),resolutions={};
  for(const finding of privateOriginal.source.findings){
   requireValue(finding.code==='RAML_BEHAVIOR_REQUIRES_MAPPING'&&['securitySchemes','securedBy'].includes(finding.location),'NATIVE_RAMl_MAPPING_CHANGED','Review this original source behavior: '+finding.location);
   resolutions[finding.id]='The original pass-through API key maps to the native API_KEY plan. The configured gateway is exercised without a consumer key and must return the configured native authentication status.';
  }
  const privateDraft=await step('map-protected-proxy','saveDraft',{sourceId:privateSource.id,mapping:{name:privateName,apiVersion:'1.0',contextPath:'/'+state.prefix+'-protected',
    upstream:upstream.href,security:{type:'API_KEY'},visibility:'PRIVATE',resolutions}});
  async function commission(name,draft){
   const selected=await workspace.action('readDraft',{id:draft.id,revision:draft.revision});
   const input={connectionId,draftId:draft.id,draftRevision:selected.record.revision,mappingSha256:selected.review.mappingSha256,label:draft.value.label,
    publishPlans:true,start:true,deploy:true,review:configuration.review??{},deploymentLabel:(state.prefix+' '+name).slice(0,32),probes:[]};
   let record=await step(name,'commission',input);
   if(!['COMMISSIONED','COMMISSIONED_WITH_DIFFERENCES'].includes(record.value.state)){
    record=await workspace.action('commission',{...record.value.input,requestId:stableUUID(state.operationId,name)});
    await saveJSON(join(directory,'current-'+name+'.json'),record,true);
   }
   requireValue(['COMMISSIONED','COMMISSIONED_WITH_DIFFERENCES'].includes(record.value.state),'NATIVE_COMMISSIONING_INCOMPLETE',
    name+' remains '+record.value.state+'; continue its original child request from '+join(directory,'workspace')+'.');
   return record;
  }
  const publicCommission=await commission('commission-public',publicDraft),privateCommission=await commission('commission-protected',privateDraft);
  async function gateway(name,path,expectedStatus){
   requireValue(configured.gatewayUrls.length>0,'REAL_GATEWAY_REQUIRED');
   const observations=[];
   for(let index=0;index<configured.gatewayUrls.length;index++){
    const key=name+'-'+index,start=Date.now(),timeout=configuration.gatewayWaitMs??120000;
    requireValue(Number.isSafeInteger(timeout)&&timeout>=1000&&timeout<=600000,'GATEWAY_WAIT_INVALID');
    let matched=false;
    while(Date.now()-start<timeout){
     const attempt=state.gatewayAttempts[key]??0;state.gatewayAttempts[key]=attempt+1;await checkpoint();
     const result=await step('gateway-'+key+'-'+attempt,'probe',{connectionId,probe:{gatewayIndex:index,path,method:'GET',expectedStatus}});
     observations.push({gatewayIndex:index,path,status:result.status??null,complete:result.complete,sha256:result.bodySha256??null,reference:result.retained??null});
     if(result.complete&&result.matchesExpectedStatus===true){matched=true;break;}
     await new Promise(resolve=>setTimeout(resolve,1500));
    }
    requireValue(matched,'NATIVE_GATEWAY_RESULT_PENDING',configured.gatewayUrls[index]+' did not return '+expectedStatus+' within this original observation window.');
   }
   return observations;
  }
  const publicObservations=await gateway('public','/'+state.prefix+'-public'+(configuration.probeSuffix??'/'),configuration.expectedPublicStatus??200);
  const protectedObservations=await gateway('protected','/'+state.prefix+'-protected'+(configuration.probeSuffix??'/'),configuration.expectedUnauthenticatedStatus??401);
  const apiId=publicCommission.value.apiId;
  const accepted=record=>['APPLIED','ACCEPTED'].includes(record.value.state)||record.value.nativeReceiptAccepted===true||['APPLIED','ACCEPTED'].includes(record.value.originalOutcome)||record.value.effectMatched===true;
  const readyOrReceived=record=>record.value.state==='PREPARED'||accepted(record);
  const update=await step('prepare-native-edition-two','prepareOperation',{connectionId,operationId:'patchApi',parameters:{apiId,body:{description:'Second native configuration edition for '+state.operationId,apiVersion:'2.0'}}});
  requireValue(readyOrReceived(update),'NATIVE_UPDATE_PREPARATION_FAILED');
  const changed=await step('apply-native-edition-two','executeOperation',{id:update.id,planSha256:update.value.planSha256});
  requireValue(accepted(changed),'NATIVE_UPDATE_REQUIRES_RECONCILIATION');
  const readback=await step('read-native-edition-two','reconcileOperation',{id:update.id});
  requireValue(readback.value.effectMatched===true,'NATIVE_UPDATED_DEFINITION_DIFFERS');
  const deploy=await step('prepare-edition-two-deployment','prepareOperation',{connectionId,operationId:'createApiDeployment',parameters:{apiId,body:{deploymentLabel:(state.prefix+' edition2').slice(0,32)}}});
  requireValue(readyOrReceived(deploy),'NATIVE_DEPLOY_PREPARATION_FAILED');
  const deployed=await step('request-edition-two-deployment','executeOperation',{id:deploy.id,planSha256:deploy.value.planSha256});
  requireValue(accepted(deployed)&&deployed.value.status===202,'NATIVE_DEPLOYMENT_NOT_ACCEPTED');
  await step('read-edition-two-deployment','reconcileOperation',{id:deploy.id});
  const changedObservations=await gateway('edition-two','/'+state.prefix+'-public'+(configuration.probeSuffix??'/'),configuration.expectedPublicStatus??200);
  const finalCapture=await step('capture-complete-cohort','capture',{connectionId,label:state.prefix+' final native receiving',apiIds:[apiId,privateCommission.value.apiId]});
  requireValue(finalCapture.value.state==='CAPTURED'&&finalCapture.value.captureRef,'NATIVE_COMPLETE_CAPTURE_REQUIRED','Continue this same capture after resolving its returned resource responses.');
  const handover=await step('export-complete-handover','exportHandover',{includeSoftware:true,label:state.prefix+' complete editable handover'});
  const object=await workspace.action('readObject',{reference:handover.reference}),bytes=Buffer.from(object.base64,'base64'),packet=JSON.parse(bytes.toString('utf8'));
  const inspection=inspectReceivingPackage(packet);await saveFile(join(directory,'handover.json'),bytes);
  const received=await receivePackage(packet,join(directory,'received'));
  receiving=await openGraviteeWorkspace({directory:join(directory,'received','workspace')});
  const originalView=await workspace.action('view'),receivedView=await receiving.action('view');
  requireValue(originalView.workspaceId===receivedView.workspaceId,'RECEIVED_WORKSPACE_ID_CHANGED');
  const originalDraft=await workspace.action('readDraft',{id:publicDraft.id,revision:publicDraft.revision}),receivedDraft=await receiving.action('readDraft',{id:publicDraft.id,revision:publicDraft.revision});
  requireValue(hashJSON(originalDraft.draft)===hashJSON(receivedDraft.draft),'RECEIVED_NATIVE_DRAFT_CHANGED');
  const correction=structuredClone(receivedDraft.draft);correction.body.description='Editable receiving handover for '+state.operationId;
  const receivedEdit=await receiving.action('saveDraft',{requestId:stableUUID(state.operationId,'received-draft-edit'),sourceId:receivedDraft.record.value.source.id,
    sourceRevision:receivedDraft.record.value.source.revision,id:receivedDraft.record.id,expectedRevision:receivedDraft.record.revision,draft:correction});
  requireValue(receivedEdit.revision===receivedDraft.record.revision+1,'RECEIVED_EDIT_NOT_SAVED');
  report={...report,state:'COMPLETE',completedAt:new Date().toISOString(),apiIds:[apiId,privateCommission.value.apiId],
   gatewayObservations:{public:publicObservations,protected:protectedObservations,changedEdition:changedObservations},
   currentCapture:{id:finalCapture.id,state:finalCapture.value.state},handover:{file:'handover.json',bytes:bytes.length,sha256:sha256(bytes),packageSha256:inspection.sha256,files:inspection.totalFiles},
   receiving:{directory:received.destination,workspaceId:received.workspaceId,editedDraft:{id:receivedEdit.id,revision:receivedEdit.revision}}};
  await checkpoint();progress('COMPLETE',{report:join(directory,'native-report.json'),handover:join(directory,'handover.json'),apiIds:report.apiIds});return report;
 }catch(error){if(report){report.state='CONTINUATION_REQUIRED';report.error=publicError(error);report.lastObservedAt=new Date().toISOString();await checkpoint();progress('CONTINUATION_REQUIRED',{code:error.code,message:error.message,report:join(directory,'native-report.json')});}throw error;}
 finally{await receiving?.close();await workspace?.close();await lease.close();}
}
async function main(){const args=process.argv.slice(2);requireValue(args.length===2&&args[0]==='--input','NATIVE_INPUT_REQUIRED');const path=resolve(args[1]),info=await lstat(path);requireValue(info.isFile()&&!info.isSymbolicLink()&&!(info.mode&0o077),'PRIVATE_NATIVE_CONFIGURATION_REQUIRED');await runNativeReceiving(JSON.parse(await readFile(path,'utf8')));}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{process.stderr.write(JSON.stringify(publicError(error))+'\n');process.exitCode=1;});
