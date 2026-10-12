#!/usr/bin/env node
// MIT. Catalog plans use the original WordPress merchant client and private workspace.
import {randomUUID} from 'node:crypto';
import {basename, dirname, isAbsolute, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createMerchantClient,loadOperator} from './merchant-operator.mjs';
import {privateDirectory,exists} from '../sf88-operator-buyer-cli/node/store.mjs';
import {CATALOG_PLAN,MAX_CATALOG_BYTES,catalogDigest,readCatalogBytes,parseCatalogJson,
  createBytesDigest,writeCatalogFile,receiveCatalogHandoff,writeCatalogConfiguration} from './catalog-client.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const REQUEST='stellar-forge.sf104.catalog-local-request.v1';
const RESULT='stellar-forge.sf104.catalog-local-result.v1';
const flags={
  status:['operator'],list:['operator','page'],products:['operator','page','q'],show:['operator','project'],
  create:['operator','title','products','request'],save:['operator','project','revision','plan','note','title','request'],
  review:['operator','project','revision','edition','request'],
  apply:['operator','project','revision','review','confirm','note','request'],
  import:['operator','source','title','project','revision','note','request'],
  request:['operator','id'],continue:['operator','request-file'],
  export:['operator','project','kind','application','out'],
  receive:['handoff','existing-config','outbox','out','secret-env','timeout-ms'],
};
const USAGE=[
  'woo-catalog status|list --operator /private/woo-operator.json',
  'woo-catalog products --operator /private/woo-operator.json [--q name-or-ID] [--page 1]',
  'woo-catalog show --operator /private/woo-operator.json --project UUID',
  'woo-catalog create --operator /private/woo-operator.json --title "Digital catalog" --products 22,23',
  'woo-catalog save --operator /private/woo-operator.json --project UUID --revision N --plan /private/plan.json --note "Reason"',
  'woo-catalog review --operator /private/woo-operator.json --project UUID --revision N --edition UUID',
  'woo-catalog apply --operator /private/woo-operator.json --project UUID --revision N --review UUID --confirm --note "Reviewed reason"',
  'woo-catalog import --operator /private/woo-operator.json --source /private/plan.csv --title "Source catalog"',
  'Existing target import adds --project UUID --revision N. Source may be exact CSV, plan JSON, or complete workspace JSON.',
  'woo-catalog request --operator /private/woo-operator.json --id UUID',
  'woo-catalog continue --operator /private/woo-operator.json --request-file /private/workspace/catalog-requests/UUID/request.json',
  'woo-catalog export --operator /private/woo-operator.json --project UUID --kind workspace|seller --out /private/catalog.json',
  'woo-catalog receive --handoff /private/catalog.json --existing-config /private/woo-merchant.json --out /private/woo-merchant-next.json',
  'Initial receiving replaces --existing-config with --outbox /private/sf98-outbox [--secret-env SF98_WEBHOOK_SECRET].',
  '',
  'Writes retain an immutable request UUID and exact arguments BEFORE the original WordPress request.',
  'After an uncertain response, use request or continue with that retained identity. No automatic application retry occurs.',
  'Current Woo capabilities and application-password credentials remain the original authority; credentials are never exported.',
  'Receiving compiles the original seller configuration. It does not start a seller, pay, fund, release or refund an order.',
].join('\n');
function need(value,code,message=code){if(!value)throw Object.assign(new Error(message),{code});}
function absolute(value){need(typeof value==='string'&&isAbsolute(value),'WOO_CATALOG_ABSOLUTE_PATH_REQUIRED');return resolve(value);}
function id(value){need(UUID.test(value??''),'WOO_CATALOG_UUID_REQUIRED');return value;}
function number(value,optional=false){
  if(value===undefined&&optional)return undefined;
  need(typeof value==='string'&&/^[1-9][0-9]{0,8}$/.test(value),'WOO_CATALOG_INTEGER_REQUIRED');return Number(value);
}
const jsonBytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
async function fileJson(path,limit=MAX_CATALOG_BYTES){return parseCatalogJson(await readCatalogBytes(absolute(path),limit));}
async function requestDirectory(config,requestId,{create=false}={}){
  await privateDirectory(config.workspace,{create});
  const parent=await privateDirectory(join(config.workspace,'catalog-requests'),{create});
  return privateDirectory(join(parent,id(requestId)),{create});
}
async function loadRequest(config,path){
  path=absolute(path);const value=await fileJson(path,32*1024*1024);
  need(value?.schema===REQUEST&&UUID.test(value.requestId??'')&&value.request?.requestId===value.requestId&&
    value.siteUrl===config.siteUrl&&value.workspace===config.workspace&&
    value.inputSha256===catalogDigest(value.request),'WOO_CATALOG_RETAINED_REQUEST_CHANGED');
  const directory=await requestDirectory(config,value.requestId);
  need(path===join(directory,'request.json'),'WOO_CATALOG_ORIGINAL_REQUEST_FILE_REQUIRED');
  return {value,path,directory};
}
async function retainRequest(config,operatorPath,request){
  const directory=await requestDirectory(config,request.requestId,{create:true});
  const path=join(directory,'request.json');
  if(await exists(path)){
    const prior=await loadRequest(config,path);
    need(prior.value.inputSha256===catalogDigest(request),'WOO_CATALOG_REQUEST_ID_REUSED');
    throw Object.assign(new Error('This exact request already exists. Use request to inspect its result or continue with this original request file.'),
      {code:'WOO_CATALOG_REQUEST_ALREADY_RETAINED',requestId:request.requestId,requestFile:path,unknown:true});
  }
  const value={schema:REQUEST,requestId:request.requestId,siteUrl:config.siteUrl,workspace:config.workspace,
    operatorConfig:operatorPath,createdAt:new Date().toISOString(),request,inputSha256:catalogDigest(request)};
  await writeCatalogFile(path,jsonBytes(value));
  return {value,path,directory};
}
async function retainResult(saved,receipt){
  need(receipt?.requestId===saved.value.requestId&&receipt.inputSha256===saved.value.inputSha256,
    'WOO_CATALOG_RESPONSE_ID_CHANGED');
  const path=join(saved.directory,'result.json');
  if(await exists(path)){
    const prior=await fileJson(path);
    need(prior?.schema===RESULT&&prior.inputSha256===saved.value.inputSha256&&
      catalogDigest(prior.receipt)===catalogDigest(receipt),'WOO_CATALOG_COMPLETED_RESULT_CHANGED');
    return {status:'ORIGINAL_CATALOG_RESULT_RECOVERED',requestId:receipt.requestId,requestFile:saved.path,resultFile:path,receipt};
  }
  await writeCatalogFile(path,jsonBytes({schema:RESULT,requestId:receipt.requestId,inputSha256:saved.value.inputSha256,
    observedAt:new Date().toISOString(),receipt}));
  return {status:'CATALOG_RESULT_RETAINED',requestId:receipt.requestId,requestFile:saved.path,resultFile:path,receipt};
}
async function sendOriginal(client,saved,{continueSame=false}={}){
  if(continueSame){
    const retained=await client.catalogRequest(saved.value.requestId);
    if(retained.found)return retainResult(saved,retained.receipt);
  }
  try{
    const returned=await client.catalogMutate(saved.value.request);
    return await retainResult(saved,returned.receipt);
  }catch(error){
    error.requestId=saved.value.requestId;error.requestFile=saved.path;
    if(error.unknown===undefined)error.unknown=true;
    throw error;
  }
}
export async function main(argv=process.argv.slice(2)){
  if(argv.length===1&&argv[0]==='--help'){console.log(USAGE);return;}
  const [action,...rest]=argv;need(Object.hasOwn(flags,action),'WOO_CATALOG_ACTION_REQUIRED',USAGE);
  const options=new Map();
  for(let i=0;i<rest.length;i++){
    const name=rest[i]?.replace(/^--/,'');
    need(rest[i]?.startsWith('--')&&flags[action].includes(name)&&!options.has(name),'WOO_CATALOG_OPTION_INVALID');
    if(name==='confirm'){options.set(name,true);continue;}
    need(typeof rest[i+1]==='string'&&!rest[i+1].startsWith('--'),'WOO_CATALOG_VALUE_REQUIRED');
    options.set(name,rest[++i]);
  }
  const get=(name,required=false)=>{const value=options.get(name);need(!required||value!==undefined,'WOO_CATALOG_'+name.toUpperCase().replaceAll('-','_')+'_REQUIRED');return value;};
  let result;
  if(action==='receive'){
    const value=await fileJson(get('handoff',true));
    const existingConfig=options.has('existing-config')?await fileJson(get('existing-config')):null;
    const received=receiveCatalogHandoff(value,{existingConfig,outbox:options.has('outbox')?absolute(get('outbox')):undefined,
      secretEnv:get('secret-env'),timeoutMs:number(get('timeout-ms'),true)});
    const output=absolute(get('out',true));await privateDirectory(dirname(output),{create:false});
    result=await writeCatalogConfiguration(output,received);
  }else{
    const operatorPath=absolute(get('operator',true)),config=await loadOperator(operatorPath),client=createMerchantClient(config);
    if(action==='status')result=await client.catalogStatus();
    else if(action==='list')result=await client.catalogProjects({page:number(get('page'),true)??1});
    else if(action==='products')result=await client.catalogProducts({page:number(get('page'),true)??1,q:get('q')??''});
    else if(action==='show')result=await client.catalogProject(id(get('project',true)));
    else if(action==='request'){
      const requestId=id(get('id',true));result=await client.catalogRequest(requestId);
      const path=join(config.workspace,'catalog-requests',requestId,'request.json');
      if(result.found&&await exists(path))result=await retainResult(await loadRequest(config,path),result.receipt);
    }else if(action==='continue'){
      const saved=await loadRequest(config,get('request-file',true));result=await sendOriginal(client,saved,{continueSame:true});
    }else if(action==='export'){
      const project=id(get('project',true)),kind=get('kind')??'workspace';
      const value=await client.catalogExport(project,{kind,applicationId:get('application')});
      result={status:'CATALOG_EXPORTED',kind,projectId:project,...await writeCatalogFile(absolute(get('out',true)),jsonBytes(value))};
    }else{
      const request={action,requestId:options.has('request')?id(get('request')):randomUUID()};
      if(action==='create'){
        request.title=get('title',true);request.productIds=get('products',true).split(/[,\s]+/).filter(Boolean);
        need(request.productIds.length>=1&&request.productIds.length<=64&&request.productIds.every(x=>/^[1-9][0-9]{0,17}$/.test(x)),
          'WOO_CATALOG_PRODUCT_IDS_REQUIRED');
      }else if(action==='import'){
        const path=absolute(get('source',true)),bytes=await readCatalogBytes(path);
        new TextDecoder('utf-8',{fatal:true}).decode(bytes);
        request.source={name:basename(path),base64:bytes.toString('base64'),sha256:createBytesDigest(bytes)};
        request.title=get('title')??basename(path);
        if(options.has('project')){request.projectId=id(get('project'));request.expectedRevision=number(get('revision',true));}
        if(options.has('note'))request.note=get('note');
      }else{
        request.projectId=id(get('project',true));request.expectedRevision=number(get('revision',true));
        if(action==='save'){
          request.plan=await fileJson(get('plan',true));need(request.plan?.schema===CATALOG_PLAN,'WOO_CATALOG_PLAN_REQUIRED');
          request.note=get('note')??'';if(options.has('title'))request.title=get('title');
        }else if(action==='review')request.editionId=id(get('edition',true));
        else{
          request.reviewId=id(get('review',true));request.confirm=get('confirm',true)===true;
          request.note=get('note',true);need(request.note.trim().length>0,'WOO_CATALOG_APPLICATION_REASON_REQUIRED');
        }
      }
      const saved=await retainRequest(config,operatorPath,request);result=await sendOriginal(client,saved);
    }
  }
  console.log(JSON.stringify(result,null,2));return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{
    console.error(JSON.stringify({error:/^[A-Za-z0-9_]{1,100}$/.test(error.code??'')?error.code:'WOO_CATALOG_COMMAND_FAILED',
      message:String(error.message??'').slice(0,2000),requestId:error.requestId??null,requestFile:error.requestFile??null,
      resultUncertain:error.unknown===true,automaticApplicationRetry:false}));
    process.exitCode=1;
  });
