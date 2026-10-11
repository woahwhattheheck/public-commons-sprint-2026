#!/usr/bin/env node
// MIT. One CLI for the existing provider, research desk and original SF88 jobs.
import {readFile,open,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {MarketModel} from './workspace/model.mjs';
import {MarketJobs} from './workspace/jobs.mjs';
import {startMarketWorkspace,acquireWorkspaceLease} from './workspace/server.mjs';
import {prepareCoinGeckoProduct,startCoinGeckoService} from './provider.mjs';
import {readProjectArchive} from './workspace/recovery.mjs';
import {need,jsonBytes,uuid,LIMITS,text} from './common.mjs';

const HELP=String.raw`CoinGecko provider and market operator — Node24+
  serve --state PRIVATE_DIR [--port 8417] [--config OPERATOR_CONFIG.json]
  status --state PRIVATE_DIR [--project ID]
  project --state PRIVATE_DIR --name NAME --actor NAME
  config --state PRIVATE_DIR --project ID --file PROJECT_CONFIG.json --actor NAME
  request --state PRIVATE_DIR --project ID --file REQUEST.json --actor NAME
  collection --state PRIVATE_DIR --project ID --file COLLECTION.json --actor NAME
  collection-import --state PRIVATE_DIR --project ID --file COLLECTION_EXPORT.json --actor NAME
  import --state PRIVATE_DIR --project ID --request ID --file ORIGINAL_RESPONSE --actor NAME
         [--headers HEADERS.json] [--body-file ORIGINAL_HTTP_BODY] [--status 200]
         [--source-url HTTPS_URL] [--observed-at ISO_TIME] [--name NAME]
  sample --state PRIVATE_DIR --project ID --capture ID --actor NAME [--name NAME]
  probe --state PRIVATE_DIR --project ID --requests ID,ID --target vendor|merchant --name NAME --actor NAME
  checkout --state PRIVATE_DIR --collection ID --file SELECTIONS.json --name NAME --actor NAME [--execute]
  execute|resume|cancel|recover --state PRIVATE_DIR --job ID --actor NAME
  snapshot --state PRIVATE_DIR --project ID --captures ID,ID --name NAME --actor NAME [--collection ID]
  compare --state PRIVATE_DIR --project ID --baseline ID --current ID --name NAME --actor NAME
  note --state PRIVATE_DIR --project ID --file NOTE.json --actor NAME
  list --state PRIVATE_DIR --project ID --kind requests|collections|captures|jobs|snapshots|comparisons|notes|files|events
       [--offset 0] [--limit 25] [--query TEXT]
  export --state PRIVATE_DIR --project ID --name NAME --out NEW_FILE.json.gz --actor NAME
  restore --state PRIVATE_DIR --file HANDOVER.json.gz --name NAME --actor NAME
  unpack-source --file HANDOVER.json.gz --out NEW_DIRECTORY
  provider compile --plan PLAN.json --out NEW_DEPLOYMENT.json
  provider serve --plan PLAN.json [--port 8423] [--data-module TRUSTED_LOCAL_MODULE]
       [--facilitator HTTPS_URL] [--allow-local-facilitator] [--availability-dir PRIVATE_DIR]

Native profiles are startup configuration: {buyerProfiles:[{id,name,network,
  configPath:"/absolute/original/config.json",workspacePath:"/absolute/original/workspace"}]}.
The browser receives profile names and original reviews, not signer keys.
Probes make one unsigned GET per request. Checkout first retains the original
native inbox review. --execute or the explicit execute command uses that review.
Recovery reads the original queue and evidence; it does not replay an attempt.
Use one worker per state directory. The running browser supports multiple operators
through retained project revisions. Stop it before starting a separate native CLI.
`;
function parse(args){
  const position=[],flags=new Map(),boolean=new Set(['--execute','--allow-local-facilitator']);
  for(let i=0;i<args.length;i++){
    const value=args[i];if(!value.startsWith('--')){position.push(value);continue}
    need(!flags.has(value),'DUPLICATE_OPTION',value+' was provided twice');
    if(boolean.has(value)){flags.set(value,true);continue}
    need(typeof args[i+1]==='string'&&!args[i+1].startsWith('--'),'OPTION_VALUE_REQUIRED',value+' needs a value');
    flags.set(value,args[++i]);
  }
  return{position,flags};
}
async function jsonFile(path,maximum=LIMITS.uploadBytes){
  const bytes=await readFile(resolve(path));need(bytes.length<=maximum,'FILE_TOO_LARGE');return JSON.parse(bytes.toString('utf8'));
}
async function createFile(path,bytes){
  const handle=await open(resolve(path),'wx',0o600);
  try{await handle.writeFile(bytes);await handle.sync()}finally{await handle.close()}
}
const output=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
async function waitForJob(runner,model,jobId){
  await new Promise(done=>setImmediate(done));
  await new Promise(done=>setTimeout(done,1));
  const active=runner.active.get(jobId);if(active)await active.promise;
  return model.job(jobId).job;
}
export async function main(args=process.argv.slice(2)){
  if(!args.length||args.includes('--help')){process.stdout.write(HELP);return}
  const{position,flags}=parse(args),command=position[0],get=name=>flags.get('--'+name);
  const required=name=>{const value=get(name);need(typeof value==='string'&&value.length,'OPTION_REQUIRED','--'+name+' is required');return value};
  if(command==='provider'){
    const planFile=await jsonFile(required('plan')),plan=planFile.plan??planFile;
    if(position[1]==='compile'){
      const product=await prepareCoinGeckoProduct(plan);await createFile(required('out'),jsonBytes(product));
      output({path:resolve(get('out')),operations:product.operations.map(o=>({endpoint:o.endpoint,method:o.method,path:o.path})),paymentsInitiated:0});return;
    }
    need(position[1]==='serve','UNKNOWN_PROVIDER_COMMAND');
    let resolveData;
    if(get('data-module')){
      const module=await import(pathToFileURL(resolve(get('data-module'))).href);
      resolveData=module.resolveData??module.default?.resolveData??module.default;
      need(typeof resolveData==='function','PROVIDER_CALLBACK_REQUIRED');
    }
    let nativeFactory=null;
    if(get('facilitator')){
      const url=new URL(get('facilitator')),local=get('allow-local-facilitator')===true&&url.protocol==='http:'&&url.hostname==='127.0.0.1';
      need((url.protocol==='https:'||local)&&!url.username&&!url.password&&!url.search&&!url.hash,'INVALID_FACILITATOR');
      const[{HTTPFacilitatorClient},{createNativeSellerServer}]=await Promise.all([
        import('@x402/core/server'),import('../../sf30-seller-sdk/native-factory.mjs')]);
      nativeFactory=compiled=>createNativeSellerServer(compiled,{facilitatorClient:new HTTPFacilitatorClient({url:url.href.replace(/\/$/,'')})});
    }
    const runtime=await startCoinGeckoService({plan,port:Number(get('port')??8423),nativeFactory,resolveData,
      ...(get('availability-dir')?{availabilityDirectory:resolve(get('availability-dir'))}:{})});
    output({url:runtime.url,mode:runtime.mode,health:runtime.url+'/_seller/health',docs:runtime.url+'/_seller/docs'});
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>runtime.close().catch(error=>{output({error:error.code??error.message});process.exitCode=1}));
    return runtime;
  }
  if(command==='unpack-source'){
    const archive=readProjectArchive(await readFile(resolve(required('file')))),directory=resolve(required('out'));
    await mkdir(directory,{mode:0o700});
    for(const file of archive.runtime.files){
      const path=resolve(directory,file.path);await mkdir(resolve(path,'..'),{recursive:true,mode:0o700});
      await createFile(path,Buffer.from(file.contentBase64,'base64'));
    }
    output({directory,files:archive.runtime.files.length,entry:archive.runtime.entry});return;
  }
  const directory=resolve(required('state')),configuration=get('config')?await jsonFile(get('config')):{};
  if(command==='serve'){
    const runtime=await startMarketWorkspace({directory,port:Number(get('port')??8417),buyerProfiles:configuration.buyerProfiles??[]});
    output({url:runtime.url,stateDirectory:directory,node:process.version});
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>runtime.close().catch(error=>{output({error:error.code??error.message});process.exitCode=1}));
    return runtime;
  }
  const readOnly=['status','list'].includes(command),release=readOnly?async()=>{}:await acquireWorkspaceLease(directory);
  const model=new MarketModel(directory,{buyerProfiles:configuration.buyerProfiles??[]}),runner=new MarketJobs(model);model.attachRunner(runner);
  if(!readOnly)runner.start();
  const actor=readOnly?'reader':text(required('actor'),'actor',240),operation=get('op-id')??uuid();
  const envelope=(projectId,step='operation')=>({actor,opId:operation+':'+step,
    ...(projectId?{revision:get('revision')===undefined?model.store.project(projectId).revision:Number(get('revision'))}:{})});
  const upload=async(projectId,file,label,contentType='application/octet-stream')=>{
    const bytes=await readFile(resolve(file));
    return model.upload(projectId,{...envelope(projectId,label),filename:resolve(file).split('/').pop(),contentType,contentBase64:bytes.toString('base64')}).value;
  };
  try{
    let result,projectId=get('project');
    if(command==='status')result=projectId?model.project(projectId):model.state();
    else if(command==='list')result=model.list(required('project'),required('kind')==='provider-plans'?'providerPlans':get('kind'),
      {offset:get('offset')??0,limit:get('limit')??25,q:get('query')??''});
    else if(command==='project')result=model.createProject({...envelope(null),name:required('name')});
    else if(command==='config')result=model.saveConfig(required('project'),{...envelope(projectId),config:await jsonFile(required('file'))});
    else if(command==='request')result=model.saveRequest(required('project'),{...envelope(projectId),request:await jsonFile(required('file'))});
    else if(command==='collection')result=model.saveCollection(required('project'),{...envelope(projectId),collection:await jsonFile(required('file'))});
    else if(command==='collection-import'){
      const file=await upload(required('project'),required('file'),'file','application/json');
      result=model.importCollection(projectId,{...envelope(projectId),fileId:file.id,...(get('name')?{name:get('name')}:{})});
    }else if(command==='import'){
      const file=await upload(required('project'),required('file'),'file');
      const headers=get('headers')?await upload(projectId,get('headers'),'headers','application/json'):null;
      const body=get('body-file')?await upload(projectId,get('body-file'),'body'):null;
      result=model.importResponse(projectId,{...envelope(projectId),requestId:required('request'),fileId:file.id,
        ...(headers?{headersFileId:headers.id}:{}),...(body?{responseBodyFileId:body.id}:{}),
        ...(get('status')?{httpStatus:Number(get('status'))}:{}),...(get('source-url')?{sourceUrl:get('source-url')}:{}),
        ...(get('observed-at')?{observedAt:get('observed-at')}:{}),...(get('name')?{name:get('name')}:{})});
    }else if(command==='sample')result=model.sample(required('project'),{...envelope(projectId),captureId:required('capture'),...(get('name')?{name:get('name')}:{})});
    else if(command==='probe'){
      result=await model.createProbe(required('project'),{...envelope(projectId),name:required('name'),requestIds:required('requests').split(','),target:required('target')});
      result={...result,value:await waitForJob(runner,model,result.value.id)};
    }else if(command==='checkout'){
      const collection=model.store.get('collections',required('collection')),input=await jsonFile(required('file'));
      result=await model.createCheckout(collection.id,{...envelope(collection.projectId),name:required('name'),
        version:collection.version,buyerProfileId:input.buyerProfileId,selections:input.selections});
      let job=await waitForJob(runner,model,result.value.id);
      if(get('execute')===true){
        result=await model.controlJob(job.id,'execute',{...envelope(job.projectId,'execute'),version:job.version});
        job=await waitForJob(runner,model,job.id);
      }
      result={...result,value:job};
    }else if(['execute','resume','cancel','recover'].includes(command)){
      const job=model.store.get('jobs',required('job'));
      result=await model.controlJob(job.id,command,{...envelope(job.projectId),version:job.version});
      result={...result,value:await waitForJob(runner,model,job.id)};
    }else if(command==='snapshot')result=model.createSnapshot(required('project'),{...envelope(projectId),name:required('name'),
      captureIds:required('captures').split(','),...(get('collection')?{collectionId:get('collection')}:{})});
    else if(command==='compare')result=model.createComparison(required('project'),{...envelope(projectId),name:required('name'),
      baselineId:required('baseline'),currentId:required('current')});
    else if(command==='note')result=model.saveNote(required('project'),{...envelope(projectId),note:await jsonFile(required('file'))});
    else if(command==='export'){
      result=model.exportProject(required('project'),{...envelope(projectId),name:required('name')});
      const archive=model.exportBytes(result.value.id);await createFile(required('out'),archive.bytes);
      result={...result,path:resolve(get('out'))};
    }else if(command==='restore')result=model.restore({...envelope(null),name:required('name'),
      contentBase64:(await readFile(resolve(required('file')))).toString('base64')});
    else need(false,'UNKNOWN_COMMAND',HELP);
    output(result);return result;
  }finally{await runner.close();model.close();await release()}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{output({error:error.code??'COMMAND_FAILED',message:error.message});process.exitCode=1});
