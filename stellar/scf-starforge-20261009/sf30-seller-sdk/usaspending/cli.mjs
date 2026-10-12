#!/usr/bin/env node
// MIT. Complete local USAspending research and original merchant/receiving operations.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { AwardWorkspace } from './workspace.mjs';
import { readJsonFile, importRetainedCapture, importRetainedDetail, importSourceCollection } from './source-import.mjs';
import { prepareMerchant, previewMerchant, serveMerchant, adoptDelivery } from './merchant.mjs';
import { serveWorkspace } from './server.mjs';
import { workshareBrief } from './brief.mjs';
import { COLUMNS, requireThat, integer, csv, publicRow, sha } from './core.mjs';

const HELP = 'USAspending research — Node 22.13+ or 24\n\n'+
'All research commands take --workspace PRIVATE_DIRECTORY [--operator NAME].\n'+
'  init | state\n'+
'  serve [--port 8783] [--receiving-root DIRECTORY]\n'+
'  query-save --file QUERY.json [--query ID --revision N]\n'+
'  capture --query ID --revision N\n'+
'  resume --capture ID\n'+
'  capacity --capture ID --max-rows N --updated-at ISO_TIME\n'+
'  import-capture --file ORIGINAL_CAPTURE.json [--name NAME]\n'+
'  import-collection --file SOURCE_COLLECTION.json\n'+
'  import-detail --file RESPONSE.json --receipt RECEIPT.json [--name NAME]\n'+
'  attach-details --edition ID --file DETAIL_IDS.json\n'+
'  select-edition --edition ID --file AWARD_KEYS.json [--name NAME]\n'+
'  enrich --edition ID --file AWARD_KEYS.json\n'+
'  browse --edition ID [--search TEXT --page N --limit N]\n'+
'  award --edition ID --key ORIGINAL_AWARD_ID\n'+
'  review --edition ID --key ORIGINAL_AWARD_ID --revision N --file REVIEW.json\n'+
'  compare --before ID --after ID [--out FILE]\n'+
'  export-edition --edition ID --out FILE [--include-reviews]\n'+
'  export-csv --edition ID --out FILE [--spreadsheet]\n'+
'  brief --edition ID --key ORIGINAL_AWARD_ID --out FILE\n'+
'  backup --out FILE | restore --file FILE\n'+
'  merchant-prepare --edition ID [--payment FILE --origin HTTPS_ORIGIN --path /federal-awards]\n'+
'  adopt-delivery --directory FINALIZED_SF88_OR_SF100_DIRECTORY\n\n'+
'Merchant commands use the retained bundle directly and do not require --workspace:\n'+
'  merchant-preview --bundle DIRECTORY [--query-file QUERY.json] [--out FILE]\n'+
'  merchant-serve --bundle DIRECTORY [--port 8423 --facilitator HTTPS_URL]\n'+
'    [--allow-local-facilitator --availability-dir DIRECTORY]\n\n'+
'Output files are create-only. Ctrl-C pauses foreground provider capture; resume uses its original query and pages.';

function options(args){
  if(!args.length||args.includes('--help'))return {command:'help'};
  const [command,...tail]=args,out={command};
  const booleans=new Set(['include-reviews','spreadsheet','allow-local-facilitator']);
  for(let i=0;i<tail.length;i++){
    requireThat(/^--[a-z][a-z-]*$/.test(tail[i]),'ARGUMENT_INVALID','Use --name value options; --help lists commands');
    const key=tail[i].slice(2);requireThat(!Object.hasOwn(out,key),'DUPLICATE_OPTION',key);
    if(booleans.has(key))out[key]=true;
    else{requireThat(tail[i+1]!==undefined&&!tail[i+1].startsWith('--'),'OPTION_VALUE_REQUIRED',key);out[key]=tail[++i];}
  }
  return out;
}
function only(o,names){const allowed=new Set(['command','workspace','operator',...names]);requireThat(Object.keys(o).every(k=>allowed.has(k)),'OPTION_UNKNOWN','Unknown option for '+o.command);}
function need(o,key){requireThat(typeof o[key]==='string'&&o[key].length>0,'OPTION_REQUIRED','--'+key+' is required');return o[key];}
function num(o,key,fallback,min=0,max=Number.MAX_SAFE_INTEGER){const value=o[key]===undefined?fallback:Number(o[key]);return integer(value,key,min,max);}
async function json(path,max){return (await readJsonFile(path,max)).value;}
async function output(o,value,{text=false}={}){
  if(o.out){const bytes=Buffer.from(text?value:JSON.stringify(value,null,2)+'\n');await writeFile(resolve(o.out),bytes,{flag:'wx',mode:0o600});return {file:resolve(o.out),bytes:bytes.length,sha256:sha(bytes)};}
  return value;
}
export async function main(args=process.argv.slice(2),{print=true}={}){
  const o=options(args);
  const emit=value=>{if(print)process.stdout.write((typeof value==='string'?value:JSON.stringify(value,null,2))+'\n');return value;};
  if(o.command==='help')return emit(HELP);
  if(o.command==='merchant-preview'){
    only(o,['bundle','query-file','out']);const result=await previewMerchant(need(o,'bundle'),o['query-file']?await json(o['query-file']):{});return emit(await output(o,result));
  }
  if(o.command==='merchant-serve'){
    only(o,['bundle','port','facilitator','allow-local-facilitator','availability-dir']);
    const session=await serveMerchant(need(o,'bundle'),{port:num(o,'port',8423,0,65535),facilitator:o.facilitator,allowLocalFacilitator:!!o['allow-local-facilitator'],availabilityDirectory:o['availability-dir']});
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>session.close().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;}));
    emit({url:session.url,mode:session.mode,merchantId:session.merchantId,sourceEditionId:session.sourceEditionId,snapshot:session.snapshot,offers:session.url+'/_seller/offers',docs:session.url+'/_seller/docs'});return session;
  }
  const workspace=new AwardWorkspace(need(o,'workspace'),{operator:o.operator??'Local operator'}),controller=new AbortController();
  const stop=()=>controller.abort(new Error('Operator interrupted the foreground operation'));process.once('SIGINT',stop);process.once('SIGTERM',stop);
  let detached=false;
  try{
    let result;
    switch(o.command){
      case 'init':case 'state':only(o,[]);result=workspace.state();break;
      case 'serve':{
        only(o,['port','receiving-root']);process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
        const session=await serveWorkspace(workspace,{port:num(o,'port',8783,0,65535),receivingRoot:o['receiving-root']});detached=true;
        for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>session.close().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;}));
        emit({url:session.url,workspace:workspace.directory,workspaceId:workspace.state().id});return session;
      }
      case 'query-save':only(o,['file','query','revision']);result=workspace.saveQuery({queryId:o.query,expectedRevision:num(o,'revision',0),definition:await json(need(o,'file'))});break;
      case 'capture':only(o,['query','revision']);result=await workspace.runCapture({queryId:need(o,'query'),queryRevision:num(o,'revision',undefined,1)},{signal:controller.signal});break;
      case 'resume':only(o,['capture']);result=await workspace.runCapture({captureId:need(o,'capture')},{signal:controller.signal});break;
      case 'capacity':only(o,['capture','max-rows','updated-at']);result=workspace.resizeCapture({captureId:need(o,'capture'),maxRows:num(o,'max-rows',undefined,1,250000),expectedUpdatedAt:need(o,'updated-at')});break;
      case 'import-capture':only(o,['file','name']);result=await importRetainedCapture(workspace,need(o,'file'),{name:o.name});break;
      case 'import-collection':only(o,['file']);result=await importSourceCollection(workspace,need(o,'file'));break;
      case 'import-detail':only(o,['file','receipt','name']);result=await importRetainedDetail(workspace,need(o,'file'),need(o,'receipt'),{name:o.name});break;
      case 'attach-details':only(o,['edition','file']);result=workspace.attachDetails(need(o,'edition'),await json(need(o,'file')));break;
      case 'select-edition':only(o,['edition','file','name']);result=workspace.selectEdition(need(o,'edition'),{awardKeys:await json(need(o,'file')),name:o.name});break;
      case 'enrich':only(o,['edition','file']);result=await workspace.enrich(need(o,'edition'),await json(need(o,'file')),{signal:controller.signal});break;
      case 'browse':only(o,['edition','search','page','limit']);result=workspace.browse(need(o,'edition'),{search:o.search??'',page:num(o,'page',1,1),limit:num(o,'limit',50,1,250)});break;
      case 'award':only(o,['edition','key']);result=workspace.row(need(o,'edition'),need(o,'key'));break;
      case 'review':only(o,['edition','key','revision','file']);result=workspace.saveReview({editionId:need(o,'edition'),award_key:need(o,'key'),expectedRevision:num(o,'revision',undefined),review:await json(need(o,'file'))});break;
      case 'compare':only(o,['before','after','out']);result=await output(o,workspace.compare(need(o,'before'),need(o,'after')));break;
      case 'export-edition':only(o,['edition','out','include-reviews']);need(o,'out');result=await output(o,workspace.exportEdition(need(o,'edition'),{includeReviews:!!o['include-reviews']}));break;
      case 'export-csv':only(o,['edition','out','spreadsheet']);need(o,'out');result=await output(o,csv(workspace.rows(need(o,'edition')).map(publicRow),COLUMNS,{spreadsheet:!!o.spreadsheet}),{text:true});break;
      case 'brief':only(o,['edition','key','out']);need(o,'out');result=await output(o,workshareBrief(workspace,need(o,'edition'),need(o,'key')),{text:true});break;
      case 'backup':only(o,['out']);need(o,'out');result=await output(o,workspace.exportPacket());break;
      case 'restore':only(o,['file']);result=workspace.restorePacket(await json(need(o,'file'),512*1024*1024));break;
      case 'merchant-prepare':only(o,['edition','payment','origin','path']);requireThat(!!o.payment===!!o.origin,'PAYMENT_AND_ORIGIN_TOGETHER');result=await prepareMerchant(workspace,need(o,'edition'),{...(o.payment?{payment:await json(o.payment,16384),origin:need(o,'origin')}:{}),...(o.path?{path:o.path}:{})});break;
      case 'adopt-delivery':only(o,['directory']);result=await adoptDelivery(workspace,need(o,'directory'));break;
      default:throw Object.assign(new Error('Unknown command. Use --help.'),{code:'COMMAND_UNKNOWN'});
    }
    return emit(result);
  }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);if(!detached)workspace.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'RESEARCH_FAILED',message:error.message,captureId:error.captureId??null,providerStatus:error.providerStatus??null,retryAt:error.retryAt??null})+'\n');process.exitCode=1;});
}
