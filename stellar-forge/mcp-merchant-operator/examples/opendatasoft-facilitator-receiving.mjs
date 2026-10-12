#!/usr/bin/env node
// MIT. Full original Huwise facilitator commissioning and customer receiving.
import { join, resolve, basename, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { realpath, lstat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { initializeOpendatasoftWorkspaceMerchant } from '../config.mjs';
import { startMerchantMcp } from '../serve.mjs';
import { openOpendatasoftClient, downloadOpendatasoftExport, reopenOpendatasoftExport } from '../opendatasoft-client.mjs';
import { acquireStateLease } from '../../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import { normalizeFacilitatorProfiles } from '../../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-facilitator.mjs';
import { openOpendatasoftWorkbench } from '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/opendatasoft/engine.mjs';
import { receiveFacilitatorBrowser } from './opendatasoft-facilitator-browser.mjs';
import { digest, encoded, failure, plain, equal, privateDirectory, originalBytes, originalJSON, optionalJSON,
  atomicJSON, keepBytes, keepFile, keepJSON, fileInfo } from './opendatasoft-facilitator-files.mjs';

const INPUT='stellar-forge.opendatasoft-facilitator-receiving-input.v1';
const RECORD='stellar-forge.opendatasoft-facilitator-receiving.v1';
const HASH=/^[a-f0-9]{64}$/, UUID=/^[a-f0-9-]{36}$/, ID=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const ROOT=new URL('../../../',import.meta.url);
const PREFIX='stellar/scf-starforge-20261009/';
const HISTORIES=['editions','sources','publications','exports','buyerRequests','tenantPlans','tenantExports'];
const REQUIRED_FILES=['data.json','data.csv','data.geojson','review.html','DATASET-RECEIVING.md',
  'source-declaration.json','merchant.tar.gz','MERCHANT-RECEIVING.md',
  'facilitator-review.json','facilitator-source.json','FACILITATORS.md'];
const HELP='Complete original Huwise facilitator receiving\n\n'+
  'merchant-huwise-facilitators-receive --directory PRIVATE_OPERATION --input ORIGINAL_INPUT.json '+
  '--project ORIGINAL_WORKBENCH --profiles ORIGINAL_PROFILES.json --source-ref COMMIT '+
  '--build-result ORIGINAL_BUILD_RESULT.json --playwright-module ABS_MODULE --browser ABS_CHROMIUM '+
  '[--browser-arg VALUE ...] [--adopt-review PROVIDER=REVIEW_SHA256] [--retry-stage PROVIDER]\n\n'+
  'Use the same complete operation directory to continue a saved review, stage, file download or browser receiving. '+
  'The original capture, merchant packages, buyer requests and seller selection remain their original authorities. '+
  'The native builder receipt and source archive must match the declared huwise source edition. '+
  'No new capture, purchase, seller activation or settlement is dispatched by this command.\n';
function check(condition,code,message){if(!condition)throw failure(code,message);}
function exact(value,keys,required=[]){check(plain(value)&&Object.keys(value).every(key=>keys.includes(key))&&required.every(key=>Object.hasOwn(value,key)),
  'HUWISE_RECEIVING_INPUT','Use the complete declared receiving input fields.');}
function parseArgs(argv){
  const value={'--browser-arg':[],'--adopt-review':[],'--retry-stage':[]};
  const required=['--directory','--input','--project','--profiles','--source-ref','--build-result','--playwright-module','--browser'];
  for(let i=0;i<argv.length;i+=2){
    const key=argv[i],argument=argv[i+1];
    check([...required,'--browser-arg','--adopt-review','--retry-stage'].includes(key)&&typeof argument==='string'&&argument.length>0&&!argument.includes('\0'),
      'HUWISE_RECEIVING_ARGUMENTS',HELP);
    if(Array.isArray(value[key]))value[key].push(argument);
    else {check(!Object.hasOwn(value,key),'HUWISE_RECEIVING_ARGUMENTS','Supply each original path or source option once.');value[key]=argument;}
  }
  check(required.every(key=>value[key]),'HUWISE_RECEIVING_ARGUMENTS',HELP);
  check(/^[a-f0-9]{40}$/.test(value['--source-ref']),'HUWISE_RECEIVING_SOURCE','Use the complete current product commit.');
  return value;
}
function validateInput(value){
  exact(value,['schema','operationId','parentOperation','merchantExportId','releaseId','providers','expected'],
    ['schema','operationId','merchantExportId','providers']);
  check(value.schema===INPUT&&typeof value.operationId==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value.operationId)&&UUID.test(value.merchantExportId??''),
    'HUWISE_RECEIVING_INPUT','Bind this operation to the original retained merchant package.');
  if(value.parentOperation!==undefined)check(typeof value.parentOperation==='string'&&value.parentOperation.length>0&&value.parentOperation.length<=160,
    'HUWISE_RECEIVING_INPUT','Keep the original parent operation identity.');
  if(value.releaseId!==undefined)check(ID.test(value.releaseId),'HUWISE_RECEIVING_INPUT','Select the original seller release ID.');
  check(Array.isArray(value.providers)&&value.providers.length>0&&value.providers.length<=16,'HUWISE_RECEIVING_INPUT','Select the actual configured provider aliases.');
  const aliases=new Set(),ids=new Set(),exports=new Set();
  for(const item of value.providers){
    exact(item,['provider','id','label','exportId'],['provider','id','label','exportId']);
    check(ID.test(item.provider)&&ID.test(item.id)&&ID.test(item.exportId)&&!aliases.has(item.provider)&&!ids.has(item.id)&&!exports.has(item.exportId)&&
      typeof item.label==='string'&&item.label.trim()===item.label&&item.label.length>0&&item.label.length<=240&&!/[\x00-\x1f\x7f]/.test(item.label),
      'HUWISE_RECEIVING_INPUT','Use distinct original aliases, proposed release IDs and full customer export IDs.');
    aliases.add(item.provider);ids.add(item.id);exports.add(item.exportId);
  }
  if(value.expected!==undefined){
    exact(value.expected,['captureSha256','rowCount','notesRevision','releaseDigest','buyerRequestIds']);
    for(const key of ['captureSha256','releaseDigest'])if(value.expected[key]!==undefined)check(HASH.test(value.expected[key]),'HUWISE_RECEIVING_INPUT','Use complete original source digests.');
    for(const key of ['rowCount','notesRevision'])if(value.expected[key]!==undefined)check(Number.isSafeInteger(value.expected[key])&&value.expected[key]>=0,
      'HUWISE_RECEIVING_INPUT','Use the actual original row count and notes revision.');
    if(value.expected.buyerRequestIds!==undefined)check(Array.isArray(value.expected.buyerRequestIds)&&value.expected.buyerRequestIds.every(id=>UUID.test(id)),
      'HUWISE_RECEIVING_INPUT','Use the exact retained buyer request IDs.');
  }
  return value;
}
function projectAuthority(state){
  check(plain(state)&&typeof state.createdAt==='string'&&typeof state.catalogOrigin==='string','HUWISE_RECEIVING_PROJECT','Read the original complete workbench state.');
  return Object.fromEntries(['schema','createdAt','catalogOrigin',...HISTORIES].map(key=>[key,state[key]??[]]));
}
async function history(client,workspace){
  const items=[],seen=new Set(),cursors=new Set();let after;
  do {
    const page=await client.facilitatorHistory({workspace,limit:100,...(after?{after}:{})});
    check(Array.isArray(page.items),'HUWISE_RECEIVING_HISTORY','Read every original native history page.');
    for(const item of page.items){check(HASH.test(item.id??'')&&!seen.has(item.id),'HUWISE_RECEIVING_HISTORY','The native history contains a repeated or invalid review.');seen.add(item.id);items.push(item);}
    after=page.nextCursor;
    if(after){check(HASH.test(after)&&!cursors.has(after),'HUWISE_RECEIVING_HISTORY','The native history cursor did not advance.');cursors.add(after);}
  } while(after);
  return items;
}
async function sourceInventory(directory,product){
  const paths=[
    'stellar-forge/mcp-merchant-operator/examples/opendatasoft-facilitator-receiving.mjs',
    'stellar-forge/mcp-merchant-operator/examples/opendatasoft-facilitator-browser.mjs',
    'stellar-forge/mcp-merchant-operator/examples/opendatasoft-facilitator-files.mjs',
    'stellar-forge/mcp-merchant-operator/FACILITATOR_RECEIVING.md',
    'stellar-forge/mcp-merchant-operator/config.mjs','stellar-forge/mcp-merchant-operator/serve.mjs',
    'stellar-forge/mcp-merchant-operator/opendatasoft-client.mjs','stellar-forge/mcp-merchant-operator/opendatasoft-workspace.mjs',
    'stellar-forge/mcp-merchant-operator/opendatasoft-files.mjs','stellar-forge/mcp-merchant-operator/catalog/opendatasoft-workspace.mjs',
    'stellar-forge/mcp-merchant-operator/retained-download.mjs',
    PREFIX+'sf30-seller-sdk/opendatasoft/engine.mjs',PREFIX+'sf30-seller-sdk/opendatasoft/publisher/facilitators.mjs',
    PREFIX+'sf30-seller-sdk/opendatasoft/workspace/server.mjs',PREFIX+'sf30-seller-sdk/opendatasoft/workspace/static/facilitators.html',
    PREFIX+'sf30-seller-sdk/opendatasoft/workspace/static/facilitators.css',PREFIX+'sf30-seller-sdk/opendatasoft/workspace/static/facilitators.js',
    PREFIX+'sf30-seller-sdk/opendatasoft/FACILITATORS.md',PREFIX+'sf30-seller-sdk/socrata/publisher-facilitators.mjs',
    PREFIX+'sf82-seller-pilot/release-facilitator.mjs',PREFIX+'sf82-seller-pilot/releases.mjs',
    PREFIX+'sf30-seller-sdk/native-factory.mjs',PREFIX+'sf30-seller-sdk/resource-server.mjs',
    PREFIX+'merchant-fleet-gateway/state-lease.mjs'
  ];
  const manifestBytes=await originalBytes(fileURLToPath(new URL('../manifest.json',ROOT)),16777216);
  const packageBytes=await originalBytes(fileURLToPath(new URL('../package.json',ROOT)),16777216);
  const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes));
  const metadata=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(packageBytes));
  check(manifest.schema==='stellar-forge.merchant-distribution-manifest.v1'&&manifest.sourceCommit===product.sourceRef&&
    manifest.sourceSelection?.id==='huwise'&&Array.isArray(manifest.files)&&
    metadata.name===manifest.packageName&&metadata.version===manifest.packageVersion&&
    manifest.packageFiles?.['package.json']===digest(packageBytes)&&
    (!product.packageName||product.packageName===metadata.name)&&(!product.packageVersion||product.packageVersion===metadata.version),
    'HUWISE_RECEIVING_INSTALLED_SOURCE','Use the installed original huwise package and complete native manifest for this build.');
  const files=[];
  for(const path of paths){
    const matches=manifest.files.filter(item=>item.path===path);
    check(matches.length===1&&matches[0].packagePath==='source/'+path&&HASH.test(matches[0].sha256??'')&&Number.isSafeInteger(matches[0].bytes),
      'HUWISE_RECEIVING_INSTALLED_SOURCE','The native package manifest does not identify exactly one required source file: '+path);
    const bytes=await originalBytes(fileURLToPath(new URL(path,ROOT)),16777216);
    check(bytes.length===matches[0].bytes&&digest(bytes)===matches[0].sha256,'HUWISE_RECEIVING_INSTALLED_SOURCE',
      'The installed source differs from its original selected package: '+path);
    const target=join(directory,...path.split('/'));await privateDirectory(dirname(target));
    files.push({path,gitBlob:matches[0].gitBlob,...await keepBytes(target,bytes)});
  }
  return {manifest:await keepBytes(join(directory,'manifest.original.json'),manifestBytes),
    package:await keepBytes(join(directory,'package.original.json'),packageBytes),files};
}
function matches(review,input,plan){
  return review?.review?.source?.releaseId===plan.release.id&&review.review.proposed.id===input.id&&
    review.review.proposed.provider.alias===input.provider&&review.review.proposed.label===input.label&&
    review.source?.merchantExportId===plan.merchant.id&&review.source.merchantManifestSha256===plan.merchant.manifestSha256&&
    review.source.capture.manifestSha256===plan.edition.manifestSha256&&review.source.sourceRelease.digest===plan.release.digest;
}
function completedStage(observed,id){
  return observed?.staged?.state==='STAGED'&&observed.staged.release?.derivedFrom?.reviewId===id;
}
async function buildSource(path,sourceRef,root){
  let bytes;const retained=join(root,'build-result.original.json');
  try {bytes=await originalBytes(retained,16777216);}
  catch(error){if(error.code!=='ENOENT')throw error;bytes=await originalBytes(path,16777216);}
  try {check((await originalBytes(path,16777216)).equals(bytes),'HUWISE_RECEIVING_BUILD','The supplied build result differs from this operation’s retained original receipt.');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const full=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),value=full.distribution??full;
  check(value.sourceCommit===sourceRef&&value.sourceSelection?.id==='huwise'&&HASH.test(value.sha256??'')&&typeof value.archive==='string',
    'HUWISE_RECEIVING_BUILD','Use the original completed huwise selected build for this exact source commit.');
  const archive=resolve(dirname(path),value.archive),name=basename(archive);
  check(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(name),'HUWISE_RECEIVING_BUILD','Use the native builder archive filename.');
  let actual=join(root,name),info;
  try {info=await fileInfo(actual);} catch(error){if(error.code!=='ENOENT')throw error;actual=archive;info=await fileInfo(actual);}
  check(info.sha256===value.sha256,'HUWISE_RECEIVING_BUILD','The original selected source archive differs from its build receipt.');
  await keepBytes(retained,bytes);
  if(actual!==join(root,name))await keepFile(actual,join(root,name),info);
  return {sourceRef,packageName:value.packageName,packageVersion:value.packageVersion,buildReceipt:{name:'source/build-result.original.json',bytes:bytes.length,sha256:digest(bytes)},
    archive:{name:'source/'+name,...info}};
}
export async function main(argv=process.argv.slice(2)){
  if(argv.includes('--help')){process.stdout.write(HELP);return;}
  const args=parseArgs(argv),root=await privateDirectory(args['--directory']),project=await privateDirectory(args['--project'],false);
  check(root!==project&&!root.startsWith(project+'/')&&!project.startsWith(root+'/'),'HUWISE_RECEIVING_DIRECTORY','Keep the receiving operation separate from the original workbench.');
  const releaseStore=join(project,'seller-releases'),stat=await lstat(releaseStore);
  check(stat.isDirectory()&&!stat.isSymbolicLink()&&await realpath(releaseStore)===releaseStore,'HUWISE_RECEIVING_STORE','The original Huwise seller store must already exist.');
  const sourceDir=await privateDirectory(join(root,'source')),nativeDir=await privateDirectory(join(root,'native'));
  const inputBytes=await originalBytes(resolve(args['--input']),262144),input=validateInput(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(inputBytes)));
  const profileBytes=await originalBytes(resolve(args['--profiles']),65536),profiles=normalizeFacilitatorProfiles(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(profileBytes)));
  for(const entry of input.providers)check(Object.hasOwn(profiles.providers,entry.provider),'HUWISE_RECEIVING_PROFILE','The selected alias is not in the exact host profile file.');
  const adopted=new Map();
  for(const value of args['--adopt-review']){const at=value.indexOf('='),alias=value.slice(0,at),id=value.slice(at+1);check(at>0&&input.providers.some(p=>p.provider===alias)&&HASH.test(id)&&!adopted.has(alias),
    'HUWISE_RECEIVING_ADOPTION','Use one selected PROVIDER=REVIEW_SHA256 for explicit original-review adoption.');adopted.set(alias,id);}
  const retries=new Set(args['--retry-stage']);check([...retries].every(alias=>input.providers.some(p=>p.provider===alias)),
    'HUWISE_RECEIVING_STAGE','Retry only a selected provider and its original saved review.');
  const lease=await acquireStateLease(root),recordPath=join(root,'receiving.json');
  const abort=new AbortController();const onSignal=name=>abort.abort(failure('HUWISE_RECEIVING_INTERRUPTED','The original receiving operation was interrupted by '+name+'.'));
  const signals=new Map(['SIGINT','SIGTERM','SIGHUP'].map(name=>[name,()=>onSignal(name)]));
  for(const[name,handler]of signals)process.on(name,handler);
  let host,client,opened,nativeWorkbench,record;
  try {
    await keepBytes(join(sourceDir,'input.original.json'),inputBytes);
    await keepBytes(join(sourceDir,'facilitators.original.json'),profileBytes);
    const product=await buildSource(resolve(args['--build-result']),args['--source-ref'],sourceDir);
    const inventory=await sourceInventory(join(sourceDir,'observed-source'),product);
    const binding={schema:'stellar-forge.opendatasoft-facilitator-receiving-binding.v1',operationId:input.operationId,
      project,inputSha256:digest(inputBytes),profileSha256:digest(profileBytes),product,installedProduct:inventory,
      browser:{module:await fileInfo(resolve(args['--playwright-module']),16777216),arguments:args['--browser-arg']}};
    record=await optionalJSON(recordPath);
    check(!record||record.schema===RECORD&&equal(record.binding,binding),'HUWISE_RECEIVING_BINDING_CHANGED','Continue the same operation with its exact original source, input, project, profiles and browser entry.');
    record??={schema:RECORD,binding,input,startedAt:new Date().toISOString(),state:'PREPARING',phases:[],providers:{},artifacts:[]};
    const save=async()=>{lease.assertHeld();await atomicJSON(recordPath,record);};
    const phase=async(name,detail={})=>{record.phases.push({name,at:new Date().toISOString(),...detail});await save();process.stdout.write(JSON.stringify({phase:name,...detail})+'\n');};
    const artifact=async(name,info)=>{
      const value={name,...info},old=record.artifacts.find(item=>item.name===name);
      check(!old||equal(old,value),'HUWISE_RECEIVING_ARTIFACT_CHANGED','The retained artifact filename belongs to different original bytes.');
      if(!old)record.artifacts.push(value);await save();return value;
    };
    const object=async(name,value)=>artifact(name,await keepJSON(join(root,name),value));
    const projectBytes=()=>originalBytes(join(project,'workbench.json'),33554432);
    const projectState=async()=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await projectBytes()));
    const errorView=error=>({code:error.code??error.name,message:error.message});
    const verifyFiles=async()=>{
      for(const file of record.artifacts)check(equal(await fileInfo(join(root,file.name),file.bytes),{bytes:file.bytes,sha256:file.sha256}),
        'HUWISE_RECEIVING_REOPEN','A completed original receiving artifact is absent or changed.');
      for(const entry of Object.values(record.providers))if(entry.export)
        await reopenOpendatasoftExport({directory:join(root,'received',entry.provider),exportId:entry.export.exportId,expectedManifestSha256:entry.export.manifestSha256});
    };
    if(record.state==='COMPLETE'||record.state==='RECEIVED_INCOMPATIBLE'){
      await verifyFiles();process.stdout.write(JSON.stringify({state:'REOPENED',originalState:record.state,operationId:input.operationId,
        completedAt:record.completedAt,result:recordPath,providers:Object.values(record.providers).map(p=>({provider:p.provider,reviewId:p.reviewId,compatible:p.compatible,staged:Boolean(p.stage?.release)}))})+'\n');return record;
    }
    record.state='RUNNING';await save();
    await artifact(product.buildReceipt.name,{bytes:product.buildReceipt.bytes,sha256:product.buildReceipt.sha256});
    await artifact(product.archive.name,{bytes:product.archive.bytes,sha256:product.archive.sha256});
    const connection=join(root,'connection.json'),workspace='portals';
    const initial=await projectState();
    const connectionValue={schema:'stellar-forge.opendatasoft-workspace-connection.v1',workspaces:{[workspace]:{
      label:'Original Huwise merchant',directory:project,origin:initial.catalogOrigin,create:false,
      facilitatorConnection:join(sourceDir,'facilitators.original.json'),imports:{},merchants:{},sellers:{}}}};
    await keepJSON(connection,connectionValue);
    const merchant=join(root,'merchant'),configPath=join(merchant,'merchant-mcp.json');
    if(!await optionalJSON(configPath))await initializeOpendatasoftWorkspaceMerchant({directory:merchant,connection});
    const environment={...process.env,MCP_ACCESS_TOKEN:randomBytes(32).toString('hex')};
    const start=async(browser=false)=>{
      abort.signal.throwIfAborted();
      host=await startMerchantMcp({configPath,port:record.mcpPort??0,environment});
      record.mcpPort=Number(new URL(host.url).port);await save();
      client=await openOpendatasoftClient({url:host.url,environment});opened=await client.open({workspace,browser});
      check(opened.state==='OPEN','HUWISE_RECEIVING_HOST','The original workbench did not open.');
    };
    const stop=async()=>{
      if(opened){await client.close({workspace,instanceId:opened.instanceId});opened=null;}
      await host?.close();host=null;client=null;
    };
    await start(true);
    const existingBefore=await optionalJSON(join(sourceDir,'workbench.before.json'));
    const beforeBytes=existingBefore?null:await projectBytes();
    const before=existingBefore??JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(beforeBytes));
    if(!existingBefore)await keepBytes(join(sourceDir,'workbench.before.json'),beforeBytes);
    check(equal(projectAuthority(before),projectAuthority(await projectState())),'HUWISE_RECEIVING_SOURCE_CHANGED','The original project sources, notes or purchases changed before this receiving continued.');
    const existingStore=await optionalJSON(join(sourceDir,'facilitators.before.json'));
    const storeBefore=existingStore??await client.facilitators({workspace});
    if(!existingStore)await keepJSON(join(sourceDir,'facilitators.before.json'),storeBefore);
    check(storeBefore.store.initialized,'HUWISE_RECEIVING_STORE','Use the already retained original seller store.');
    const merchantExport=before.exports.find(value=>value.id===input.merchantExportId);
    check(merchantExport,'HUWISE_RECEIVING_MERCHANT','The selected original merchant package is absent.');
    const publication=before.publications.find(value=>value.id===merchantExport.publicationId);
    const source=before.sources.find(value=>value.id===publication?.sourceId);
    const rawEdition=before.editions.find(value=>value.id===source?.editionId);
    check(rawEdition?.state==='COMPLETE','HUWISE_RECEIVING_CAPTURE','The original merchant must retain its complete source edition.');
    const eligible=storeBefore.store.releases.filter(value=>value.merchantExportId===merchantExport.id&&(!input.releaseId||value.id===input.releaseId));
    check(eligible.length===1,'HUWISE_RECEIVING_RELEASE','Choose exactly one original source release for the retained Huwise merchant.');
    const release=eligible[0],edition=await client.edition({workspace,editionId:rawEdition.id});
    check(HASH.test(release.digest??'')&&edition.manifestSha256===merchantExport.capture?.manifestSha256,'HUWISE_RECEIVING_CAPTURE','The seller release and merchant capture differ from the retained edition.');
    const buyers=before.buyerRequests.filter(value=>value.exportId===merchantExport.id);
    const plan={release,merchant:merchantExport,source,publication,
      edition:{id:edition.id,datasetId:edition.datasetId,manifestSha256:edition.manifestSha256,rowCount:edition.rowCount,notes:edition.notes},
      buyers,project:{schema:before.schema,catalogOrigin:before.catalogOrigin,createdAt:before.createdAt},
      selection:{generation:storeBefore.store.generation,active:storeBefore.store.active,previous:storeBefore.store.previous}};
    check(!record.plan||equal(record.plan,plan),'HUWISE_RECEIVING_PLAN_CHANGED','The exact original source or selected seller state differs from its prepared receiving.');
    if(input.expected){
      const expected=input.expected;
      for(const[key,actual]of [['captureSha256',edition.manifestSha256],['rowCount',edition.rowCount],['notesRevision',edition.notes.revision],['releaseDigest',release.digest]])
        if(expected[key]!==undefined)check(expected[key]===actual,'HUWISE_RECEIVING_EXPECTED','The original '+key+' differs from the accepted receiving input.');
      if(expected.buyerRequestIds!==undefined)check(equal([...expected.buyerRequestIds].sort(),buyers.map(value=>value.id).sort()),'HUWISE_RECEIVING_PURCHASES','The exact original buyer requests differ from the accepted input.');
    }
    record.plan=plan;await save();
    await object('source/receiving-plan.json',plan);
    let rowCount=0,rowPages=0;
    for(let offset=0;offset!==null;){
      const page=await client.rows({workspace,editionId:edition.id,offset,limit:500});
      check(Array.isArray(page.records)&&page.page&&(page.page.next===null||Number.isSafeInteger(page.page.next)&&page.page.next>offset),
        'HUWISE_RECEIVING_ROWS','The original captured row pages did not advance.');
      rowCount+=page.records.length;rowPages++;offset=page.page.next;
    }
    check(rowCount===edition.rowCount,'HUWISE_RECEIVING_ROWS','The full native row pages differ from the complete retained capture.');
    await phase('original_source_bound',{merchantExportId:merchantExport.id,releaseId:release.id,captureSha256:edition.manifestSha256,rowCount,rowPages,buyerRequestIds:buyers.map(value=>value.id)});

    const nativeStatus=()=>client.status({workspace,limit:1});
    const saveStep=async(entry,kind,value)=>{entry[kind]=value;await save();return value;};
    const waitOriginal=async(entry,kind,step)=>{
      check(typeof step.operationId==='string','HUWISE_RECEIVING_OPERATION','Keep the original returned operation ID.');
      const done=await client.awaitOperation({workspace,operationId:step.operationId},{timeoutMs:300000,signal:abort.signal});
      step.observation=done.operation;step.state=done.operation?.state??'UNKNOWN';await save();
      await object('native/'+entry.provider+'/'+kind+'-'+step.attempt+'-observation.json',done);
      return done.operation;
    };
    const dispatch=async(entry,kind,request,method,preparedFields={})=>{
      abort.signal.throwIfAborted();
      const beforeStatus=await nativeStatus();
      check(!beforeStatus.native.active,'HUWISE_RECEIVING_BUSY','Wait for the original workbench operation to finish.');
      const prior=entry[kind],continuingPreparation=prior?.state==='PREPARING';
      if(continuingPreparation)check(equal(prior.request,request),'HUWISE_RECEIVING_PREPARATION_CHANGED',
        'Continue the exact locally prepared request and original attempt.');
      const attempt=continuingPreparation?prior.attempt:(prior?.attempt??0)+1;
      const step=continuingPreparation?prior:{state:'PREPARING',attempt,request,preparedAt:new Date().toISOString(),
        beforeOperationId:beforeStatus.native.operation?.id??null,prior:prior??null,...preparedFields};
      if(!continuingPreparation)await saveStep(entry,kind,step);
      let invoked=false;
      try {
        await object('native/'+entry.provider+'/'+kind+'-'+attempt+'-request.json',{
          operationId:input.operationId,action:kind,request:step.request,preparedAt:step.preparedAt,beforeOperationId:step.beforeOperationId});
        abort.signal.throwIfAborted();
        step.state='DISPATCHING';await save();
        abort.signal.throwIfAborted();
        invoked=true;
        const started=await method(step.request,{requestSignal:abort.signal});
        check(UUID.test(started.operationId??''),'HUWISE_RECEIVING_OPERATION','The native dispatch did not return its operation ID.');
        step.operationId=started.operationId;step.state='STARTED';step.startResponse=started;await save();
        await object('native/'+entry.provider+'/'+kind+'-'+attempt+'-start.json',started);
        return await waitOriginal(entry,kind,step);
      } catch(error){
        if(invoked){step.transportError=errorView(error);if(!step.observation)step.state='UNCERTAIN';}
        else {step.preparationError=errorView(error);step.state='PREPARING';}
        try {await save();} catch(retentionError){
          throw new AggregateError([error,retentionError],'The original native receiving could not retain its exact request state.');
        }
        throw error;
      }
    };
    const observeReview=async(entry,selection)=>{
      let id=entry.reviewId??adopted.get(entry.provider);
      if(id){
        const result=await client.facilitatorInspect({workspace,reviewId:id});
        check(matches(result,selection,plan),'HUWISE_RECEIVING_REVIEW','The selected retained review belongs to different original inputs.');
        return result;
      }
      if(!entry.review||entry.review.state==='PREPARING')return null;
      if(matches(entry.review.observation?.result,selection,plan))return entry.review.observation.result;
      const candidates=(await history(client,workspace)).filter(value=>value.releaseId===release.id&&
        value.proposedReleaseId===selection.id&&value.provider?.alias===selection.provider&&
        !(entry.review?.beforeReviewIds??[]).includes(value.id));
      const matchesAll=[];
      for(const item of candidates){
        const observed=await client.facilitatorInspect({workspace,reviewId:item.id});
        if(matches(observed,selection,plan))matchesAll.push(observed);
      }
      check(matchesAll.length<=1,'HUWISE_RECEIVING_REVIEW_AMBIGUOUS','Several complete native observations match this uncertain request. Retain them and select the original review explicitly.');
      if(matchesAll.length)return matchesAll[0];
      const status=await nativeStatus(),current=status.native.operation;
      if(entry.review?.operationId&&current?.id===entry.review.operationId){
        if(current.state==='RUNNING')await waitOriginal(entry,'review',entry.review);
        else {entry.review.observation=current;entry.review.state=current.state;await save();}
        const result=entry.review.observation?.result;
        if(matches(result,selection,plan))return result;
      } else if(entry.review?.state==='UNCERTAIN'||entry.review?.state==='DISPATCHING'){
        if(current?.state==='RUNNING'&&current.kind==='review seller facilitator'&&current.id!==entry.review.beforeOperationId){
          const seen=await client.awaitOperation({workspace,operationId:current.id},{timeoutMs:300000,signal:abort.signal});
          entry.review.reconciliationObservation=seen.operation;await save();
          if(matches(seen.operation?.result,selection,plan))return seen.operation.result;
        }else if(matches(current?.result,selection,plan))return current.result;
      }
      return null;
    };
    const receiveReview=async(entry,selection)=>{
      let observed=await observeReview(entry,selection);
      if(!observed&&(!entry.review||entry.review.state==='PREPARING')){
        const all=await history(client,workspace),collisions=all.filter(value=>value.proposedReleaseId===selection.id);
        check(collisions.length===0,'HUWISE_RECEIVING_PROPOSED_ID','The proposed release already has native history. Adopt its exact original review or use another deliberate receiving operation.');
        const beforeIds=all.map(value=>value.id),request={workspace,merchantExportId:merchantExport.id,releaseId:release.id,...selection};
        delete request.exportId;
        await dispatch(entry,'review',request,(body,options)=>client.facilitatorReview(body,options),{beforeReviewIds:beforeIds});
        observed=await observeReview(entry,selection);
      }
      check(observed,'HUWISE_RECEIVING_REVIEW_UNRESOLVED','No exact saved observation has been found for the original request. Inspect its native history or use --adopt-review; this request has not been dispatched again.');
      check(matches(observed,selection,plan),'HUWISE_RECEIVING_REVIEW','The complete native observation differs from its original input.');
      entry.reviewId=observed.review.id;entry.compatible=observed.review.compatible;
      entry.originalObservation??=observed;
      entry.review??={state:'ADOPTED',attempt:0,preparedAt:new Date().toISOString(),request:{workspace,merchantExportId:merchantExport.id,releaseId:release.id,...selection}};
      entry.review.state='RECEIVED';entry.review.originalId=observed.review.id;
      if(adopted.has(entry.provider))entry.review.adoption={kind:'EXPLICIT_RETAINED_REVIEW',reviewId:adopted.get(entry.provider)};
      await save();await object('native/'+entry.provider+'/original-review-result.json',entry.originalObservation);
      await phase('native_review_received',{provider:entry.provider,reviewId:entry.reviewId,compatible:entry.compatible,error:observed.review.error??null});
      return observed;
    };
    const retainStage=async(entry,observed)=>{
      check(completedStage(observed,entry.reviewId),'HUWISE_RECEIVING_STAGE','The retained staged release differs from its original review.');
      entry.stage??={state:'ADOPTED',attempt:0};entry.stage.release=observed.staged.release;entry.stage.state='RECEIVED';await save();
      await object('native/'+entry.provider+'/committed-stage.json',entry.stage.release);
      await phase('native_stage_received',{provider:entry.provider,reviewId:entry.reviewId,releaseId:entry.stage.release.id,digest:entry.stage.release.digest});
    };
    const receiveStage=async(entry)=>{
      let current=await client.facilitatorInspect({workspace,reviewId:entry.reviewId});
      if(completedStage(current,entry.reviewId)){
        await retainStage(entry,current);return;
      }
      check(current.staged.state==='NOT_STAGED','HUWISE_RECEIVING_STAGE_CONFLICT','The proposed release ID belongs to another original staged source.');
      if(entry.stage&&entry.stage.state!=='PREPARING'){
        if(entry.stage.operationId){
          const status=await nativeStatus();
          if(status.native.operation?.id===entry.stage.operationId){
            if(status.native.operation.state==='RUNNING')await waitOriginal(entry,'stage',entry.stage);
            else {entry.stage.observation=status.native.operation;entry.stage.state=status.native.operation.state;await save();}
          }
        }
        current=await client.facilitatorInspect({workspace,reviewId:entry.reviewId});
        if(completedStage(current,entry.reviewId)){
          await retainStage(entry,current);return;
        }
        check(retries.has(entry.provider)&&['FAILED','CANCELLED','INTERRUPTED'].includes(entry.stage.observation?.state),
          'HUWISE_RECEIVING_STAGE_UNRESOLVED','The original stage is not committed. Retain its exact result; only an observed failed native stage can use --retry-stage.');
      }
      let dispatchError;
      try {
        const done=await dispatch(entry,'stage',{workspace,reviewId:entry.reviewId},(request,options)=>client.facilitatorStage(request,options));
        if(done?.state!=='COMPLETE')throw failure(done?.error?.code??'HUWISE_RECEIVING_STAGE',done?.error?.message??'The original stage did not complete.');
      } catch(error){dispatchError=error;}
      const observed=await client.facilitatorInspect({workspace,reviewId:entry.reviewId});
      if(completedStage(observed,entry.reviewId)){await retainStage(entry,observed);return;}
      if(dispatchError)throw dispatchError;
      throw failure('HUWISE_RECEIVING_STAGE','The original stage did not commit its reviewed release.');
    };
    const receiveExport=async(entry,selection)=>{
      const geometry=edition.fields.find(value=>['geo_point_2d','geo_shape'].includes(value.type));
      entry.exportRequest??={workspace,exportId:selection.exportId,editionId:edition.id,expectedCaptureSha256:edition.manifestSha256,
        expectedNotesRevision:edition.notes.revision,...(geometry?{geometryField:geometry.id}:{}),sourceId:source.id,
        merchantExportId:merchantExport.id,...(buyers.length?{buyerRequestId:buyers.at(-1).id}:{}),facilitatorReviewId:entry.reviewId};
      await save();
      const retained=await client.export(entry.exportRequest);
      check(REQUIRED_FILES.every(name=>retained.manifest.files.some(value=>value.name===name)),'HUWISE_RECEIVING_EXPORT','The complete customer export omitted an original native or merchant file.');
      if(buyers.length)check(retained.manifest.files.some(value=>value.name==='buyer-request.json'),'HUWISE_RECEIVING_PURCHASES','The original selected buyer request was omitted.');
      check(retained.manifest.source.captureSha256===edition.manifestSha256&&retained.manifest.source.facilitatorReviewId===entry.reviewId,
        'HUWISE_RECEIVING_EXPORT','The customer export belongs to another original capture or review.');
      const exportValue={exportId:selection.exportId,manifestSha256:retained.manifestSha256,manifest:retained.manifest};
      check(!entry.export||equal(entry.export,exportValue),'HUWISE_RECEIVING_EXPORT_CHANGED','The original complete customer export changed on continuation.');
      entry.export=exportValue;await save();
      await object('native/'+entry.provider+'/customer-export.json',retained);
      const receiving=await privateDirectory(join(root,'received',entry.provider));
      if(!entry.downloadInterruption){
        const controller=new AbortController();let progressed=false;
        try{
          await downloadOpendatasoftExport({client,exportId:selection.exportId,directory:receiving,
            expectedManifestSha256:retained.manifestSha256,chunkSize:65536,signal:AbortSignal.any([abort.signal,controller.signal]),
            onProgress:()=>{if(!progressed){progressed=true;controller.abort(failure('HUWISE_RECEIVING_CHECKPOINT','Continue the same original receiving checkpoint.'));}}});
        }catch(error){
          if(!controller.signal.aborted||abort.signal.aborted)throw error;
          entry.downloadInterruption={state:'RETAINED_CHECKPOINT',at:new Date().toISOString(),error:errorView(error)};await save();
        }
        if(!entry.downloadInterruption){entry.downloadInterruption={state:'ALREADY_RECEIVED',at:new Date().toISOString()};await save();}
      }
      entry.download=await downloadOpendatasoftExport({client,exportId:selection.exportId,directory:receiving,
        expectedManifestSha256:retained.manifestSha256,chunkSize:196608,signal:abort.signal});
      const replay=await client.export(entry.exportRequest);
      check(replay.manifestSha256===retained.manifestSha256,'HUWISE_RECEIVING_EXPORT_CHANGED','The original immutable export changed on replay.');
      for(const file of retained.manifest.files)await artifact('received/'+entry.provider+'/'+file.name,{bytes:file.bytes,sha256:file.sha256});
      await artifact('received/'+entry.provider+'/opendatasoft-export.json',await fileInfo(join(receiving,'opendatasoft-export.json'),65000));
      await phase('complete_customer_files_received',{provider:entry.provider,exportId:selection.exportId,manifestSha256:retained.manifestSha256,files:retained.manifest.files.length});
    };
    const providerErrors=[];
    for(const selection of input.providers){
      abort.signal.throwIfAborted();await privateDirectory(join(nativeDir,selection.provider));
      const entry=record.providers[selection.provider]??={provider:selection.provider,proposedReleaseId:selection.id};
      await save();
      try {
        await receiveReview(entry,selection);
        if(entry.compatible)await receiveStage(entry);
        else entry.outcome='NATIVE_PROVIDER_INCOMPATIBLE';
        await receiveExport(entry,selection);
        entry.outcome=entry.compatible?'NATIVE_STAGE_AND_FILES_RECEIVED':'NATIVE_PROVIDER_INCOMPATIBLE';
        delete entry.failure;await save();
      }catch(error){
        entry.failure=errorView(error);entry.outcome='NATIVE_RECEIVING_INCOMPLETE';providerErrors.push(entry.failure);await save();
        const status=await nativeStatus();
        if(status.native.active)throw error;
      }
    }
    const received=Object.values(record.providers).filter(entry=>entry.export&&entry.download);
    if(received.length){
      const browserReviews=received.map(entry=>({reviewId:entry.reviewId,merchantExportId:merchantExport.id,captureSha256:edition.manifestSha256,
        sourceSha256:entry.export.manifest.source.facilitatorSourceSha256,
        files:entry.export.manifest.files.filter(file=>['facilitator-review.json','facilitator-source.json','FACILITATORS.md'].includes(file.name))}));
      const browserCohort='browser/'+digest(encoded(browserReviews));
      record.browser=await receiveFacilitatorBrowser({url:opened.browser.url,directory:join(root,browserCohort),reviews:browserReviews,
        playwrightModule:args['--playwright-module'],executablePath:args['--browser'],launchArgs:args['--browser-arg'],
        signal:abort.signal,onProgress:step=>phase('browser_'+step.name,{...step})});
      for(const file of record.browser.files)await artifact(browserCohort+'/'+file.name,{bytes:file.bytes,sha256:file.sha256});
      record.browserReceipt=await artifact(browserCohort+'/browser-receiving.json',await fileInfo(join(root,browserCohort,'browser-receiving.json'),16777216));
      await phase('browser_receiving_complete',{browserVersion:record.browser.browserVersion,steps:record.browser.steps.length,teardownComplete:record.browser.teardownComplete});
    }
    await stop();record.hostClosed=true;await save();
    // The original engine reopens an already committed same-review stage before
    // consulting provider configuration. Exercise that native recovery with no
    // facilitator file, after the original MCP/browser owner has drained.
    if(received.some(entry=>entry.stage?.release)){
      nativeWorkbench=await openOpendatasoftWorkbench({directory:project,create:false,origin:plan.project.catalogOrigin});
      try {
        for(const entry of received.filter(value=>value.stage?.release)){
          abort.signal.throwIfAborted();
          const observed=await nativeWorkbench.facilitatorReview(entry.reviewId);
          check(completedStage(observed,entry.reviewId)&&observed.staged.release.digest===entry.stage.release.digest,
            'HUWISE_RECEIVING_REOPEN','The original committed stage changed after closing the merchant host.');
          if(!entry.closedReplay){
            const started=nativeWorkbench.stageFacilitator(entry.reviewId);
            entry.closedReplay={state:'STARTED',operationId:started.id,startedAt:new Date().toISOString()};await save();
            const done=await started.completion;
            check(done.state==='COMPLETE'&&done.result?.reviewId===entry.reviewId&&done.result?.release?.digest===entry.stage.release.digest,
              'HUWISE_RECEIVING_REPLAY','The original no-profile committed-stage recovery did not return the same retained release.');
            entry.closedReplay={...entry.closedReplay,state:'COMPLETE',result:done};await save();
          }else if(!['COMPLETE','COMMITTED_STAGE_REOPENED'].includes(entry.closedReplay.state)){
            entry.closedReplay={...entry.closedReplay,state:'COMMITTED_STAGE_REOPENED',reopenedAt:new Date().toISOString(),
              release:observed.staged.release,note:'The original committed release was read after interruption; another replay was not dispatched.'};
            await save();
          }
          const replayReceipt=entry.closedReplay.state==='COMPLETE'?'closed-native-stage-replay.json':'closed-native-stage-reopen.json';
          await object('native/'+entry.provider+'/'+replayReceipt,entry.closedReplay);
          const exported=await nativeWorkbench.facilitatorFiles(entry.reviewId);
          for(const file of exported.files){
            const retained=entry.export.manifest.files.find(value=>value.name===file.name);
            check(retained&&retained.bytes===file.content.length&&retained.sha256===file.sha256,
              'HUWISE_RECEIVING_REPLAY','Reopening changed the complete native review, source binding or guide.');
          }
        }
        const final=await nativeWorkbench.facilitators();
        check(equal({generation:final.store.generation,active:final.store.active,previous:final.store.previous},plan.selection),
          'HUWISE_RECEIVING_SELECTION','The original selected seller release changed during provider receiving.');
        const originalRelease=final.store.releases.find(value=>value.id===release.id);
        check(originalRelease?.digest===release.digest,'HUWISE_RECEIVING_SOURCE_CHANGED','The original source release changed during provider receiving.');
        record.sellerReadback=await object('native/seller-state-after-'+digest(encoded(final))+'.json',final);
      }finally{await nativeWorkbench.close();nativeWorkbench=null;}
    }
    const afterBytes=await projectBytes(),after=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(afterBytes));
    check(equal(projectAuthority(before),projectAuthority(after)),'HUWISE_RECEIVING_ORIGINAL_CHANGED','The original sources, notes, merchant packages or buyer requests changed during receiving.');
    const afterName='workbench.after.'+digest(afterBytes)+'.json';
    record.sourceAfter=await artifact('source/'+afterName,await keepBytes(join(sourceDir,afterName),afterBytes));
    await object('source/original-authority-readback.json',{before:projectAuthority(before),after:projectAuthority(after),
      originalMerchantExportId:merchantExport.id,originalCaptureSha256:edition.manifestSha256,originalBuyerRequestIds:before.buyerRequests.map(value=>value.id)});
    for(const entry of received){
      entry.offline=await reopenOpendatasoftExport({directory:join(root,'received',entry.provider),exportId:entry.export.exportId,
        expectedManifestSha256:entry.export.manifestSha256});
      await save();await object('native/'+entry.provider+'/offline-reopen-'+digest(encoded(entry.offline))+'.json',entry.offline);
    }
    await verifyFiles();
    if(providerErrors.length)throw failure('HUWISE_RECEIVING_PARTIAL',providerErrors.map(value=>value.code+': '+value.message).join(' | '));
    check(received.length===input.providers.length&&record.browser?.state==='COMPLETE'&&record.browser.teardownComplete,
      'HUWISE_RECEIVING_PARTIAL','Every selected provider must retain its complete native files and actual browser receiving.');
    record.state=received.every(entry=>entry.compatible&&entry.stage?.release)?'COMPLETE':'RECEIVED_INCOMPATIBLE';
    record.completedAt=new Date().toISOString();record.teardownComplete=true;
    await phase('offline_customer_receiving_complete',{state:record.state,operationId:input.operationId,result:recordPath,
      providers:received.map(entry=>({provider:entry.provider,reviewId:entry.reviewId,compatible:entry.compatible,
        releaseId:entry.stage?.release?.id??null,exportId:entry.export.exportId,manifestSha256:entry.export.manifestSha256}))});
    return record;
  }catch(error){
    if(record){record.state=abort.signal.aborted?'INTERRUPTED':'INCOMPLETE';record.error={code:error.code??error.name,message:error.message};
      await atomicJSON(recordPath,record).catch(()=>{});}
    throw error;
  }finally{
    const errors=[];
    try{await nativeWorkbench?.close();}catch(error){errors.push(error);}
    try{await host?.close();}catch(error){errors.push(error);}
    if(record){record.teardownComplete=errors.length===0;if(errors.length)record.closeErrors=errors.map(error=>({code:error.code??error.name,message:error.message}));
      try{await atomicJSON(recordPath,record);}catch(error){errors.push(error);}}
    for(const[name,handler]of signals)process.off(name,handler);
    try{await lease.close();}catch(error){errors.push(error);}
    if(errors.length)throw new AggregateError(errors,'The original native receiving did not finish its owned close and state publication.');
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main().then(result=>{if(result&&result.state==='RECEIVED_INCOMPATIBLE')process.exitCode=1;}).catch(error=>{
    process.stderr.write((error.code??'HUWISE_FACILITATOR_RECEIVING')+': '+error.message+'\n');process.exitCode=2;
  });
}
