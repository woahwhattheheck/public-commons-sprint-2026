#!/usr/bin/env node
// MIT. Complete public geocoding operator/customer workflow over the maintained engines.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Buyer} from '../../sf88-operator-buyer-cli/node/client.mjs';
import {examplePlan,compileGeocodePlan,fail} from './config.mjs';
import {exampleTerms,packageGeocodeMerchant,inspectGeocodePackage} from './merchant.mjs';
import {GeocodeWorkspace} from './workspace.mjs';
import {GeocodeDelivery} from './customer.mjs';
import {createGeocodeServer} from './server.mjs';
import {privateDirectory,readJson,readBytes,writeJson} from '../twelvedata/files.mjs';
const HELP=`Starforge OpenCage merchant and customer workbench

examples --out NEW_DIRECTORY
init --workspace DIR --plan PLAN.json --terms TERMS.json
serve --workspace DIR [--port 0]
serve --delivery DELIVERY_DIR [--port 0]
capture --workspace DIR --id ID --product ID --query JSON
import-response --workspace DIR --id ID --product ID --query JSON --observation FILE --response FILE
list --workspace DIR
inspect --workspace DIR --id ID
select --workspace DIR --id ID --response-sha256 SHA --index N|none --revision N [--note TEXT]
export --workspace DIR --id ID --response-sha256 SHA --revision N
read --delivery DELIVERY_DIR
package --workspace DIR [--terms TERMS.json]
package --plan PLAN.json --terms TERMS.json --out NEW_DIRECTORY
package-inspect --package PACKAGE_DIR
stage --workspace DIR --release ID [--package-id ID | --package PACKAGE_DIR] [--label TEXT] [--facilitator HTTPS_URL]
release-status --workspace DIR
release-diff --workspace DIR --after ID [--before ID]
activate --workspace DIR --release ID --generation N
rollback --workspace DIR --generation N
start --workspace DIR --generation N
consume-buyer --buyer-config FILE --intent ID --plan PLAN.json --product ID --origin HTTPS_ORIGIN --out NEW_DIRECTORY
adopt-buyer --workspace DIR --buyer-config FILE --intent ID --id ID --product ID [--package-id ID]

The key is supplied through the plan's named process environment variable.
Each capture ID retains one attempted provider dispatch and its complete result.
The original seller release and original buyer operation own commerce and recovery.
`;
const OPTIONS={
  examples:['out'],init:['workspace','plan','terms'],serve:['workspace','delivery','port'],
  capture:['workspace','id','product','query'],'import-response':['workspace','id','product','query','observation','response'],
  list:['workspace'],inspect:['workspace','id'],select:['workspace','id','response-sha256','index','revision','note'],
  export:['workspace','id','response-sha256','revision'],read:['delivery'],
  package:['workspace','plan','terms','out'],'package-inspect':['package'],
  stage:['workspace','release','package-id','package','label','facilitator'],
  'release-status':['workspace'],'release-diff':['workspace','before','after'],
  activate:['workspace','release','generation'],rollback:['workspace','generation'],start:['workspace','generation'],
  'consume-buyer':['buyer-config','intent','plan','product','origin','out'],
  'adopt-buyer':['workspace','buyer-config','intent','id','product','package-id'],
};
function parse(argv){
  const command=argv[0];if(!Object.hasOwn(OPTIONS,command))fail('GEOCODE_COMMAND_UNKNOWN');
  const options={command};
  for(let i=1;i<argv.length;i+=2){
    const flag=argv[i];
    if(!flag.startsWith('--')||!OPTIONS[command].includes(flag.slice(2))||options[flag.slice(2)]!==undefined||
        argv[i+1]===undefined||argv[i+1].startsWith('--'))fail('GEOCODE_COMMAND_OPTIONS_INVALID');
    options[flag.slice(2)]=argv[i+1];
  }
  return options;
}
const required=(options,name)=>{if(options[name]===undefined)fail('GEOCODE_OPTION_REQUIRED','--'+name+' is required');return options[name];};
function number(options,name,min=0,max=Number.MAX_SAFE_INTEGER,fallback){
  const raw=options[name]??fallback;
  if(raw===undefined||!/^[0-9]+$/.test(String(raw))||!Number.isSafeInteger(Number(raw))||Number(raw)<min||Number(raw)>max)
    fail('GEOCODE_OPTION_INVALID','Invalid --'+name);
  return Number(raw);
}
const print=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
const query=options=>{try{return JSON.parse(required(options,'query'));}catch{fail('GEOCODE_QUERY_JSON_INVALID');}};
function signals(close){
  let ending;
  const stop=()=>ending??=(async()=>{try{await close();process.exitCode=0;}catch{process.exitCode=1;}})();
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
export async function main(argv=process.argv.slice(2)){
  if(!argv.length||argv.includes('--help')){process.stdout.write(HELP);return;}
  const options=parse(argv),command=options.command;let result;
  if(command==='examples'){
    const directory=await privateDirectory(resolve(required(options,'out')));
    await writeJson(directory+'/plan.json',examplePlan(),{exclusive:true});
    await writeJson(directory+'/terms.json',exampleTerms(),{exclusive:true});
    result={directory,plan:'plan.json',terms:'terms.json'};
  }else if(command==='read'){
    result=(await GeocodeDelivery.open(resolve(required(options,'delivery')))).inspect();
  }else if(command==='package-inspect'){
    const bundle=await inspectGeocodePackage(resolve(required(options,'package')));
    result={manifest:bundle.manifest,plan:bundle.built.plan,terms:bundle.built.terms,offers:bundle.built.imported.offers};
  }else if(command==='package'&&!options.workspace){
    result=await packageGeocodeMerchant(resolve(required(options,'out')),await readJson(resolve(required(options,'plan')),1048576),
      await readJson(resolve(required(options,'terms')),1048576));
  }else if(command==='consume-buyer'){
    const buyer=new Buyer(await readJson(resolve(required(options,'buyer-config')),65536));
    const delivery=await GeocodeDelivery.fromOperation(buyer.operation(required(options,'intent')),{
      plan:await readJson(resolve(required(options,'plan')),1048576),productId:required(options,'product'),
      publicOrigin:required(options,'origin')});
    result=await delivery.export(resolve(required(options,'out')));
  }else if(command==='serve'&&options.delivery){
    if(options.workspace)fail('GEOCODE_SERVE_TARGET_CONFLICT');
    const delivery=await GeocodeDelivery.open(resolve(options.delivery));
    const server=await createGeocodeServer({delivery,port:number(options,'port',0,65535,0)});
    print({url:server.url,mode:'CUSTOMER_DELIVERY',identity:delivery.identity});signals(server.close);return {server,delivery};
  }else{
    const readOnly=['list','inspect','release-status','release-diff'].includes(command);
    const workspace=await GeocodeWorkspace.open(resolve(required(options,'workspace')),{
      ...(command==='init'?{plan:await readJson(resolve(required(options,'plan')),1048576),
        terms:await readJson(resolve(required(options,'terms')),1048576)}:{}),readOnly});
    let kept=false;
    try{
      if(command==='init')result=await workspace.overview();
      else if(command==='list'||command==='release-status')result=await workspace.overview();
      else if(command==='inspect')result=await workspace.get(required(options,'id'));
      else if(command==='capture')result=await workspace.capture({id:required(options,'id'),productId:required(options,'product'),input:query(options)});
      else if(command==='import-response')result=await workspace.importResponse({
        id:required(options,'id'),productId:required(options,'product'),input:query(options),
        observation:await readJson(resolve(required(options,'observation')),262144),
        bytes:await readBytes(resolve(required(options,'response')),workspace.configuration.plan.maxResponseBytes)});
      else if(command==='select')result=await workspace.select({id:required(options,'id'),
        responseSha256:required(options,'response-sha256'),index:required(options,'index')==='none'?null:number(options,'index',0,99),
        expectedRevision:number(options,'revision'),note:options.note??''});
      else if(command==='export')result=await workspace.export({id:required(options,'id'),
        responseSha256:required(options,'response-sha256'),expectedRevision:number(options,'revision')});
      else if(command==='package')result=await workspace.package(options.terms?{terms:await readJson(resolve(options.terms),1048576)}:{});
      else if(command==='stage'){
        if(Boolean(options.package)===Boolean(options['package-id']))fail('GEOCODE_PACKAGE_SELECTION_REQUIRED');
        const packageId=options.package?(await workspace.importPackage(resolve(options.package))).packageId:options['package-id'];
        result=await workspace.stage({packageId,id:required(options,'release'),label:options.label??'Reviewed geocoding release',
          ...(options.facilitator?{facilitator:options.facilitator}:{})});
      }else if(command==='release-diff')result=await workspace.releaseDiff(options.before,required(options,'after'));
      else if(command==='activate')result=await workspace.activate({id:required(options,'release'),expectedGeneration:number(options,'generation')});
      else if(command==='rollback')result=await workspace.rollback({expectedGeneration:number(options,'generation')});
      else if(command==='start'){
        result=await workspace.start({expectedGeneration:number(options,'generation')});kept=true;
        print(result);signals(()=>workspace.close());return {workspace,result};
      }else if(command==='adopt-buyer'){
        const buyer=new Buyer(await readJson(resolve(required(options,'buyer-config')),65536));
        result=await workspace.adoptBuyer({id:required(options,'id'),productId:required(options,'product'),
          operation:buyer.operation(required(options,'intent')),packageId:options['package-id']});
      }else if(command==='serve'){
        const server=await createGeocodeServer({workspace,port:number(options,'port',0,65535,0)});kept=true;
        print({url:server.url,mode:'GEOCODING_OPERATOR',identity:workspace.configuration.identity});
        signals(server.close);return {workspace,server};
      }else fail('GEOCODE_COMMAND_UNKNOWN');
    }finally{if(!kept)await workspace.close();}
  }
  print(result);return result;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'GEOCODE_OPERATION_FAILED',
    message:String(error.message??error).slice(0,600)})+'\n');process.exitCode=1;});
