// MIT. Live OData mode on the original source workspace and seller/buyer engines.
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareDraft,prepareFromWorkspace,templateFromWorkspace,writePackage,readPackage,prepareBuyerHandoff,receivePage,readJson } from './client.mjs';
import { templatePlan,json } from './config.mjs';
import { startODataMerchant } from './merchant.mjs';
const HELP=`Live OData merchant and customer

node odata/live/cli.mjs COMMAND [options]

  template --catalog catalog.json [--entity-set NAME] --out plan.json
  template --workspace DIRECTORY --saved-plan ID --out plan.json
  package --catalog catalog.json --plan plan.json --query selection.json --out NEW_DIRECTORY
  package --workspace DIRECTORY --saved-plan ID --plan plan.json --operation ID --out NEW_DIRECTORY
  inspect --package DIRECTORY
  serve --package DIRECTORY --state PRIVATE_DIRECTORY [--port 8423 --operations-port 8424] [--facilitator HTTPS_URL]
  buyer --package DIRECTORY --operation ID --request request.json --intent STABLE_INTENT --out NEW_DIRECTORY
  receive --package DIRECTORY --operation ID --response saved-response.json --out NEW_DIRECTORY

Use original odata/cli.mjs to connect, inspect metadata, and save/review queries.
A selection.json is {"operation":"Orders","request":{"pageSize":100,"top":830}}.
Payment amount is per successful supplier page. pageSize is a provider preference;
maxPageRows is the hard response ceiling, and top limits the complete query.
Retain the state directory so issued continuations survive process restarts.
Explicit --allow-loopback true supports a local original supplier for development.
`;
function parse(args){const [command,...rest]=args,options={};for(let i=0;i<rest.length;i++){
  if(!rest[i].startsWith('--')||Object.hasOwn(options,rest[i].slice(2))||!rest[i+1]||rest[i+1].startsWith('--'))throw new TypeError('Each named option requires one value');
  options[rest[i].slice(2)]=rest[++i];}return {command,options};}
const required=(value,name)=>{if(!value)throw new TypeError('--'+name+' is required');return value;};
export async function main(args=process.argv.slice(2)){
  if(!args.length||args.includes('--help')){console.log(HELP);return;}
  const {command,options:o}=parse(args),options={allowLoopback:o['allow-loopback']==='true'};
  let result;
  if(command==='template'){
    if(o.workspace){const {openODataWorkspace}=await import('../workspace.mjs'),workspace=await openODataWorkspace({directory:resolve(o.workspace)});
      try{result=await templateFromWorkspace(workspace,{planId:required(o['saved-plan'],'saved-plan'),publicOrigin:o.origin});}finally{await workspace.close();}}
    else result=templatePlan(await readJson(required(o.catalog,'catalog')),{...(o.origin?{publicOrigin:o.origin}:{}),...(o['entity-set']?{entitySet:o['entity-set']}:{})});
    await writeFile(resolve(required(o.out,'out')),json(result),{flag:'wx',mode:0o600});result={path:resolve(o.out)};
  }else if(command==='package'){
    const plan=await readJson(required(o.plan,'plan'));let prepared;
    if(o.workspace){const {openODataWorkspace}=await import('../workspace.mjs'),workspace=await openODataWorkspace({directory:resolve(o.workspace)});
      try{prepared=await prepareFromWorkspace(workspace,{planId:required(o['saved-plan'],'saved-plan'),plan,operation:o.operation},options);}finally{await workspace.close();}}
    else prepared=prepareDraft({catalog:await readJson(required(o.catalog,'catalog')),plan,selection:await readJson(required(o.query,'query'))},options);
    result=await writePackage(prepared,required(o.out,'out'));
  }else{
    const prepared=await readPackage(required(o.package,'package'),options);
    if(command==='inspect')result={manifest:prepared.manifest,plan:prepared.plan,selection:prepared.selection};
    else if(command==='buyer')result=await prepareBuyerHandoff(prepared,{operation:required(o.operation,'operation'),request:await readJson(required(o.request,'request')),
      intentId:required(o.intent,'intent'),directory:required(o.out,'out')});
    else if(command==='receive')result=await receivePage(prepared,{operation:required(o.operation,'operation'),responsePath:required(o.response,'response'),directory:required(o.out,'out')});
    else if(command==='serve'){
      let nativeFactory=null;
      if(o.facilitator){const url=new URL(o.facilitator);if(url.protocol!=='https:'||url.username||url.password||url.hash)throw new TypeError('Use the original facilitator HTTPS URL');
        const [{HTTPFacilitatorClient},{createNativeSellerServer}]=await Promise.all([import('@x402/core/server'),import('../../native-factory.mjs')]);
        const facilitatorClient=new HTTPFacilitatorClient({url:url.href});nativeFactory=compiled=>createNativeSellerServer(compiled,{facilitatorClient});}
      const merchant=await startODataMerchant({plan:prepared.plan,catalog:prepared.catalog,directory:required(o.state,'state'),
        port:Number(o.port??8423),operationsPort:Number(o['operations-port']??8424),nativeFactory,...options});
      console.log(json({url:merchant.url,operationsUrl:merchant.operations.url,mode:merchant.mode,sourceBinding:prepared.sourceBinding,state:merchant.directory}));
      let closing=false;const stop=()=>{if(closing)return;closing=true;merchant.close().catch(error=>{console.error(error.message);process.exitCode=1;})
        .finally(()=>{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);});};
      process.once('SIGINT',stop);process.once('SIGTERM',stop);return merchant;
    }else throw new TypeError('Unknown command; use --help');
  }
  console.log(json(result));return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{console.error(json({error:error.code??'ODATA_LIVE_COMMAND_FAILED',message:error.message}));process.exitCode=1;});
