#!/usr/bin/env node
// MIT. Complete public geocoding operator/customer workflow over the maintained engines.
import {resolve,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Buyer} from '../../sf88-operator-buyer-cli/node/client.mjs';
import {examplePlan,compileGeocodePlan,fail} from './config.mjs';
import {exampleTerms,packageGeocodeMerchant,inspectGeocodePackage} from './merchant.mjs';
import {GeocodeWorkspace} from './workspace.mjs';
import {GeocodeDelivery} from './customer.mjs';
import {GeocodeBatchDelivery} from './batch-delivery.mjs';
import {inspectCsvSource,MAX_CSV_BYTES} from './batch.mjs';
import {createGeocodeServer} from './server.mjs';
import {openGeocodeManagedWorkspace} from './launch.mjs';
import {privateDirectory,readJson,readBytes,writeJson} from '../twelvedata/files.mjs';
const HELP=`Starforge OpenCage merchant and customer workbench

examples --out NEW_DIRECTORY
init --workspace DIR --plan PLAN.json --terms TERMS.json
serve --workspace DIR [--port 0] [--managed-selection SAVED_REVIEW_JSON]
serve --delivery DELIVERY_DIR [--port 0]
capture --workspace DIR --id ID --product ID --query JSON
import-response --workspace DIR --id ID --product ID --query JSON --observation FILE --response FILE
list --workspace DIR [--offset N --limit N]
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

batch-source --source INPUT.csv
batch-review --workspace DIR --source INPUT.csv --product ID --mapping MAPPING.json [--reuse ID,ID]
batch-prepare --workspace DIR --source INPUT.csv --product ID --mapping MAPPING.json --review-sha256 SHA [--reuse ID,ID]
batch-list --workspace DIR
batch-status --workspace DIR --batch ID [--offset N --limit N --status STATE]
batch-row --workspace DIR --batch ID --row N
batch-run --workspace DIR --batch ID --run ID
batch-reconcile --workspace DIR --batch ID
batch-select --workspace DIR --batch ID --row N --request ID --response-sha256 SHA --revision N --index N|none [--note TEXT]
batch-retry --workspace DIR --batch ID --row N --request ID --response-sha256 SHA|none --reason TEXT [--acknowledge-uncertain true]
batch-export --workspace DIR --batch ID --revision N [--max-bytes N]
batch-read --delivery DIR [--row N | --offset N --limit N] [--verify true]
batch-serve --delivery DIR [--port 0]

CSV review/prepare also accept --label TEXT and --supersedes BATCH_ID.
Mapping selects existing column names; each row keeps its original ordinal and values.
Each deliberate new retry retains the previous original attempt and its reviewed reason.
Batch exports keep every source row and each row's independent candidate decision.

The key is supplied through the plan's named process environment variable.
Each capture ID retains one attempted provider dispatch and its complete result.
The original seller release and original buyer operation own commerce and recovery.
`;
const CSV_OPTIONS=['workspace','source','product','mapping','reuse','label','supersedes'];
const OPTIONS={
  'batch-source':['source'],
  'batch-review':CSV_OPTIONS,'batch-prepare':[...CSV_OPTIONS,'review-sha256'],
  'batch-list':['workspace'],'batch-status':['workspace','batch','offset','limit','status'],
  'batch-row':['workspace','batch','row'],'batch-run':['workspace','batch','run'],
  'batch-reconcile':['workspace','batch'],
  'batch-select':['workspace','batch','row','request','response-sha256','revision','index','note'],
  'batch-retry':['workspace','batch','row','request','response-sha256','reason','acknowledge-uncertain'],
  'batch-export':['workspace','batch','revision','max-bytes'],
  'batch-read':['delivery','row','offset','limit','verify'],'batch-serve':['delivery','port'],
  examples:['out'],init:['workspace','plan','terms'],serve:['workspace','delivery','port','managed-selection'],
  capture:['workspace','id','product','query'],'import-response':['workspace','id','product','query','observation','response'],
  list:['workspace','offset','limit'],inspect:['workspace','id'],select:['workspace','id','response-sha256','index','revision','note'],
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
  if(command==='batch-source'){
    result=inspectCsvSource(await readBytes(resolve(required(options,'source')),MAX_CSV_BYTES));
  }else if(command==='batch-read'||command==='batch-serve'){
    const delivery=await GeocodeBatchDelivery.open(resolve(required(options,'delivery')));
    if(command==='batch-serve'){
      const server=await createGeocodeServer({batchDelivery:delivery,port:number(options,'port',0,65535,0)});
      print({url:server.url,mode:'GEOCODING_CSV_CUSTOMER',identity:delivery.manifest.identity});signals(server.close);return {server,delivery};
    }
    if(options.verify!==undefined&&options.verify!=='true')fail('GEOCODE_OPTION_INVALID');
    if(options.row!==undefined&&(options.offset!==undefined||options.limit!==undefined))fail('GEOCODE_OPTION_INVALID');
    if(options.verify==='true')await delivery.verify();
    result=options.row!==undefined?await delivery.row(number(options,'row',1,10000)):
      delivery.inspect({offset:number(options,'offset',0,Number.MAX_SAFE_INTEGER,0),limit:number(options,'limit',1,100,50)});
  }else if(command==='examples'){
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
    if(options.workspace||options['managed-selection'])fail('GEOCODE_SERVE_TARGET_CONFLICT');
    const delivery=await GeocodeDelivery.open(resolve(options.delivery));
    const server=await createGeocodeServer({delivery,port:number(options,'port',0,65535,0)});
    print({url:server.url,mode:'CUSTOMER_DELIVERY',identity:delivery.identity});signals(server.close);return {server,delivery};
  }else if(command==='serve'&&options['managed-selection']){
    const opened=await openGeocodeManagedWorkspace({directory:resolve(required(options,'workspace')),
      selection:options['managed-selection'],port:number(options,'port',0,65535,0)});
    process.stdout.write(JSON.stringify(opened.startup)+'\n');signals(opened.server.close);return opened;
  }else{
    const readOnly=['list','inspect','release-status','release-diff','batch-list','batch-status','batch-row','batch-review'].includes(command);
    const workspace=await GeocodeWorkspace.open(resolve(required(options,'workspace')),{
      ...(command==='init'?{plan:await readJson(resolve(required(options,'plan')),1048576),
        terms:await readJson(resolve(required(options,'terms')),1048576)}:{}),readOnly});
    let kept=false;
    try{
      if(command.startsWith('batch-')){
        const manager=await workspace.batches(),batchId=options.batch;
        if(command==='batch-review'||command==='batch-prepare'){
          const source=resolve(required(options,'source'));
          const input={bytes:await readBytes(source,MAX_CSV_BYTES),productId:required(options,'product'),
            mapping:await readJson(resolve(required(options,'mapping')),65536),fileName:basename(source),
            ...(options.label?{label:options.label}:{}),reuseRequestIds:options.reuse?options.reuse.split(','):[],
            supersedesBatchId:options.supersedes??null};
          result=command==='batch-review'?await manager.review(input):
            await manager.prepare({...input,expectedReviewSha256:required(options,'review-sha256')});
        }else if(command==='batch-list')result=await manager.list();
        else if(command==='batch-status')result=await manager.status(required(options,'batch'),{
          offset:number(options,'offset',0,Number.MAX_SAFE_INTEGER,0),limit:number(options,'limit',1,100,50),
          ...(options.status?{status:options.status}:{})});
        else if(command==='batch-row')result=await manager.row(required(options,'batch'),number(options,'row',1,10000));
        else if(command==='batch-reconcile')result=await manager.reconcile({batchId:required(options,'batch')});
        else if(command==='batch-run'){
          const input={batchId:required(options,'batch'),runId:required(options,'run')};
          const stop=()=>{void manager.stop(input).catch(()=>{});};
          process.once('SIGINT',stop);process.once('SIGTERM',stop);
          try{print(await manager.start(input));result=await manager.wait(input.batchId,input.runId);}
          finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
        }else if(command==='batch-select')result=await manager.select({batchId:required(options,'batch'),
          ordinal:number(options,'row',1,10000),expectedRequestId:required(options,'request'),
          responseSha256:required(options,'response-sha256'),expectedRevision:number(options,'revision'),
          index:required(options,'index')==='none'?null:number(options,'index',0,99),note:options.note??''});
        else if(command==='batch-retry'){
          if(options['acknowledge-uncertain']!==undefined&&!['true','false'].includes(options['acknowledge-uncertain']))
            fail('GEOCODE_OPTION_INVALID');
          result=await manager.retry({batchId:required(options,'batch'),ordinal:number(options,'row',1,10000),
            expectedRequestId:required(options,'request'),expectedResponseSha256:required(options,'response-sha256')==='none'?null:options['response-sha256'],
            reason:required(options,'reason'),acknowledgeUncertain:options['acknowledge-uncertain']==='true'});
        }else if(command==='batch-export')result=await manager.export({batchId:required(options,'batch'),
          expectedRevision:number(options,'revision'),...(options['max-bytes']?{maxBytes:number(options,'max-bytes',1048576,536870912)}:{})});
        else fail('GEOCODE_COMMAND_UNKNOWN');
      }else if(command==='init')result=await workspace.overview();
      else if(command==='list'||command==='release-status')result=await workspace.overview(options.limit!==undefined||options.offset!==undefined?{
        offset:number(options,'offset',0,Number.MAX_SAFE_INTEGER,0),limit:number(options,'limit',1,1000,100)}:{});
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
