#!/usr/bin/env node
// MIT. Original GTFS workspace, native publisher and complete workspace transfer.
import { resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { bytes, createFile, readJson, digest, fault } from '../postgres/publisher/files.mjs';
import { openGtfsWorkspace, readGtfsInputFile, inspectGtfsLaunch, GTFS_UUID, GTFS_SHA256 } from './workspace.mjs';
import { runGtfsCommand, runGtfsArchiveCommand, GTFS_LAUNCH_SCHEMA } from './source.mjs';
import { startGtfsWorkspaceServer } from './server.mjs';

export { GTFS_LAUNCH_SCHEMA, inspectGtfsLaunch };
const HELP = "GTFS Schedule merchant workspace\n\n  init --workspace NEW_PRIVATE_DIR [--title TEXT]\n  serve --workspace DIR [--port 0]\n        [--expected-workspace-id UUID]\n        [--create-if-missing --expected-workspace-id UUID --title TEXT]\n  status --workspace DIR [--input PAGE.json]\n  import --workspace DIR --archive ORIGINAL.zip --sha256 HASH\n         --request UUID --revision N [--title TEXT]\n  edition|compare|decision|select --workspace DIR --input REQUEST.json\n  feed|edition-read|comparison-read --workspace DIR --id UUID\n  rows|source-rows --workspace DIR --input PAGE.json\n  operation|recover --workspace DIR --request UUID\n  template --workspace DIR --query RESOURCE_QUERY --out NEW_PLAN.json\n  publisher --workspace DIR --operation OPERATION [--input ARGS.json]\n  extract --workspace DIR --plan N --plan-sha256 HASH --run UUID\n  schedule-run|schedule-continue --workspace DIR --input ARGS.json\n  release-prepare|release-stage --workspace DIR --input REQUEST.json\n  export --workspace DIR --request UUID --revision N\n  manifest|file-read --workspace DIR --input ORIGINAL_FILE_SELECTOR.json\n\n  inspect-feed --archive ORIGINAL.zip [--sha256 HASH]\n  inspect-archive --archive WORKSPACE.tar.gz --sha256 HASH\n  receive --archive WORKSPACE.tar.gz --sha256 HASH\n          --output NEW_PRIVATE_DIR --workspace-id UUID\n\nEvery saved source action uses an original request UUID and expectedRevision.\nRepeat that exact request after an unknown reply; recover reads its retained\npayload. The original ZIP and all members are retained. A recipe selects complete\nsource tables and dated schedules; it does not estimate demand or invent trips.\n\nPublisher OPERATION is an original merchant_publisher_ suffix: source, status,\ntarget, plan_save, inspect, review, publish, recover, buyer_offer, buyer_prepare,\nbuyer_read, schedule, schedule_save, schedule_enable or schedule_pause.\nARGS.json contains the original native fields without a publisher alias.\nUse extract/schedule-run/schedule-continue above to await their original operation\nbefore the CLI closes. Browser and MCP retain the same native asynchronous IDs.\n\nREQUEST.json is {requestId,expectedRevision,payload}; source rows and manifests\nuse their displayed IDs, hashes, offsets and limits. Publisher plans/candidates/\nreviews and target revisions retain their native schemas.\n\nCommon optional host declarations:\n  --exports PRIVATE_DIR    Keep complete archives outside the workspace.\n  --release-store DIR      Existing original SF82 release store.\n  --seller URL --resource URL\nStop a live owner before opening its workspace from a separate process. MCP and\nthe browser share their one original model. Enabled schedules run while serve or\nMCP owns the workspace; one-shot CLI reads do not start its timer.\nLinux, Node 22.16+, Python 3.10+ with zoneinfo, util-linux flock.\nSF_GTFS_PYTHON selects an installed Python executable. See gtfs/README.md.\n";
const schemas = {
  init:['--title'],serve:['--port','--title','--expected-workspace-id','--create-if-missing'],
  status:['--input'],import:['--archive','--sha256','--request','--revision','--title'],
  edition:['--input'],compare:['--input'],decision:['--input'],select:['--input'],
  feed:['--id'],'edition-read':['--id'],'comparison-read':['--id'],
  rows:['--input'],'source-rows':['--input'],operation:['--request'],recover:['--request'],
  template:['--query','--out'],publisher:['--operation','--input'],
  extract:['--plan','--plan-sha256','--run'],'schedule-run':['--input'],'schedule-continue':['--input'],
  'release-prepare':['--input'],'release-stage':['--input'],export:['--request','--revision'],
  manifest:['--input'],'file-read':['--input'],
};
const common=['--workspace','--exports','--release-store','--seller','--resource'];
const required=(input,key)=>{if(!input[key])throw fault('GTFS_OPTION_REQUIRED',key);return input[key];};
const integer=(value,fallback)=>{
  if(value===undefined)return fallback;
  if(!/^(0|[1-9]\d*)$/.test(value)||!Number.isSafeInteger(Number(value)))throw fault('GTFS_INTEGER_REQUIRED');
  return Number(value);
};
function options(args,allowed) {
  const result={};
  for(let index=0;index<args.length;index++){
    const key=args[index];
    if(!allowed.includes(key)||Object.hasOwn(result,key))throw fault('GTFS_OPTION_INVALID',key);
    if(key==='--create-if-missing'){result[key]=true;continue;}
    if(args[index+1]===undefined||args[index+1].startsWith('--'))throw fault('GTFS_OPTION_REQUIRED',key);
    result[key]=args[++index];
  }
  return result;
}
const print=value=>{process.stdout.write(JSON.stringify(value,null,2)+'\n');return value;};
const jsonInput=async input=>readJson(resolve(required(input,'--input')),1024*1024);
const ownId=value=>{if(!GTFS_UUID.test(value??''))throw fault('GTFS_ID_REQUIRED');return value;};

export async function makeGtfsPlan(workspace,queryName) {
  const source=await workspace.publisher.source(),query=source.queries[queryName];
  if(!query)throw fault('QUERY_NOT_FOUND','Select an original GTFS resource query.');
  const status=await workspace.status(),edition=await workspace.edition(status.selectedEditionId);
  const resource=edition.edition.resources.find(item=>item.resource===query.resource);
  if(!resource)throw fault('GTFS_QUERY_BINDING_CHANGED','Reopen the selected original resource.');
  return {title:(edition.edition.title+' / '+resource.resource).slice(0,128),
    query:queryName,input:{},sourceHash:source.hash,
    dataset:{name:resource.resource,columns:Object.fromEntries(Object.entries(query.projection).map(([name,spec])=>
      [name,{type:spec.type,nullable:spec.missing==='null'}])),
      filters:[],ranges:[],sorts:[],defaultLimit:50,maxLimit:250,maxCellChars:65536,maxPageBytes:921600},
    extraction:{order:[{column:query.columns[0],direction:'asc'}],maxRows:Math.max(1,resource.rows),
      maxBytes:Math.max(1048576,Math.min(256*1048576,resource.bytes+1048576)),
      maxRowBytes:1048576,timeoutMs:300000}};
}
async function publisherOperation(workspace,operation,input) {
  if(typeof input!=='object'||input===null||Array.isArray(input)||Object.hasOwn(input,'publisher'))
    throw fault('GTFS_PUBLISHER_INPUT_REQUIRED','Use original native arguments without a publisher alias.');
  const {MerchantPublisher}=await import('../../../../stellar-forge/mcp-merchant-operator/publisher.mjs');
  const {publisherTools}=await import('../../../../stellar-forge/mcp-merchant-operator/catalog/publisher.mjs');
  const name='merchant_publisher_'+operation;
  const allowed=publisherTools(value=>value).filter(value=>![
    'merchant_publishers','merchant_publisher_open','merchant_publisher_close','merchant_publisher_extract',
    'merchant_publisher_schedule_run','merchant_publisher_schedule_continue'].includes(value));
  if(!allowed.includes(name))throw fault('GTFS_PUBLISHER_OPERATION_REQUIRED','Choose the documented native publisher operation.');
  const adapter=new MerchantPublisher({});
  try{return await adapter.callBorrowed({alias:'gtfs',publisher:workspace.publisher,schedule:workspace.schedule,
    instanceId:randomUUID()},name,{publisher:'gtfs',...input});}
  finally{await adapter.close();}
}
export async function main(argv=process.argv.slice(2)) {
  if(!argv.length||argv[0]==='--help'){process.stdout.write(HELP);return;}
  if(argv[0]==='init-merchant'){
    const input=options(argv.slice(1),['--directory','--connection','--release-store','--name']);
    return print(await (await import('./merchant.mjs')).initializeGtfsMerchant({
      directory:resolve(required(input,'--directory')),connection:resolve(required(input,'--connection')),
      releaseStore:input['--release-store']?resolve(input['--release-store']):undefined,name:input['--name']}));
  }
  if(argv[0]==='inspect-feed')return print(await runGtfsCommand(['inspect',...argv.slice(1)]));
  if(argv[0]==='inspect-archive')return print(await runGtfsArchiveCommand(['inspect',...argv.slice(1)]));
  if(argv[0]==='receive')return print(await runGtfsArchiveCommand(['receive',...argv.slice(1)]));
  const [command,...args]=argv;
  if(!Object.hasOwn(schemas,command))throw fault('GTFS_COMMAND_REQUIRED',HELP);
  const input=options(args,[...common,...schemas[command]]);
  if(Boolean(input['--seller'])!==Boolean(input['--resource']))throw fault('GTFS_BUYER_BINDING_REQUIRED');
  const directory=resolve(required(input,'--workspace'));
  const model=await openGtfsWorkspace({directory,create:command==='init',
    createIfMissing:input['--create-if-missing']===true,
    expectedWorkspaceId:input['--expected-workspace-id'],
    startSchedule:command==='serve',title:input['--title']??'GTFS Schedule workspace',
    exportsDirectory:input['--exports']?resolve(input['--exports']):undefined,
    releaseStore:input['--release-store']?resolve(input['--release-store']):null,
    seller:input['--seller']??null,resource:input['--resource']??null});
  if(command==='serve') {
    let service;
    try {
      const port=integer(input['--port'],8448);
      if(port>65535)throw fault('GTFS_PORT_INVALID');
      service=await startGtfsWorkspaceServer({workspace:model,port});
      const startup={schema:GTFS_LAUNCH_SCHEMA,status:'GTFS_WORKSPACE_READY',
        directory:await realpath(directory),workspaceId:model.id,pid:process.pid,url:service.url};
      process.stdout.write(JSON.stringify(startup)+'\n');
      let closing;
      const close=()=>closing??=(async()=>{try{await service.close();}finally{await model.close();}})();
      for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>close().catch(issue=>{
        process.stderr.write((issue.code??'GTFS_CLOSE_FAILED')+'\n');process.exitCode=1;}));
      return {...service,close,startup};
    } catch(issue){await service?.close().catch(()=>{});await model.close();throw issue;}
  }
  try {
    let result;
    if(command==='init')result=await model.status();
    else if(command==='status')result=await model.status(input['--input']?await jsonInput(input):{});
    else if(command==='import'){
      const archive=resolve(required(input,'--archive')),content=await readGtfsInputFile(archive);
      const expected=required(input,'--sha256');
      if(!GTFS_SHA256.test(expected)||digest(content)!==expected)throw fault('GTFS_INPUT_CHANGED','Inspect the same complete ZIP before retaining it.');
      result=await model.retainFeed({requestId:required(input,'--request'),expectedRevision:integer(required(input,'--revision')),
        payload:{title:input['--title']??basename(archive),filename:basename(archive),feedSha256:expected,feedBytes:content.length}},content);
    } else if(['edition','compare','decision','select','release-prepare','release-stage'].includes(command)){
      const method={edition:'createEdition',compare:'compareEditions',decision:'saveDecision',select:'selectEdition',
        'release-prepare':'prepareRelease','release-stage':'stageRelease'}[command];
      result=await model[method](await jsonInput(input));
    } else if(['feed','edition-read','comparison-read'].includes(command)){
      result=await model[{feed:'feed','edition-read':'edition','comparison-read':'comparison'}[command]](required(input,'--id'));
    } else if(['rows','source-rows','manifest','file-read'].includes(command)){
      result=await model[{rows:'rows','source-rows':'sourceRows',manifest:'manifest','file-read':'readFile'}[command]](await jsonInput(input));
    } else if(command==='operation')result=model.operation(required(input,'--request'));
    else if(command==='recover')result=await model.recoverRequest(required(input,'--request'));
    else if(command==='export')result=await model.exportWorkspace({requestId:required(input,'--request'),
      expectedRevision:integer(required(input,'--revision'))});
    else if(command==='template'){
      const plan=await makeGtfsPlan(model,required(input,'--query')),output=resolve(required(input,'--out'));
      await createFile(output,bytes(plan));result={file:output,sourceHash:plan.sourceHash,plan};
    } else if(command==='publisher')result=await publisherOperation(model,required(input,'--operation'),
      input['--input']?await jsonInput(input):{});
    else if(command==='extract'){
      const planId=integer(required(input,'--plan')),plan=model.publisher.plan(planId),
        planDigest=required(input,'--plan-sha256'),runId=ownId(required(input,'--run'));
      if(!GTFS_SHA256.test(planDigest)||plan.data.digest!==planDigest)throw fault('PLAN_REVIEW_CHANGED');
      let prior;
      try{prior=model.publisher.run(runId);}catch(issue){if(issue.code!=='RUN_NOT_FOUND')throw issue;}
      if(prior){
        if(prior.plan!==planId||prior.data.planDigest!==planDigest)throw fault('EXTRACTION_ID_CONFLICT');
        result={run:prior,reused:true};
      }else result={run:await model.publisher.startExtraction(planId,{id:runId}).completion,reused:false};
    } else if(command==='schedule-run'||command==='schedule-continue'){
      const selected=await jsonInput(input);
      if(command==='schedule-run')ownId(selected.requestId);
      result=await model.schedule[command==='schedule-run'?'runNow':'continueRun'](selected).completion;
    }
    return print(result);
  } finally {await model.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(issue=>{process.stderr.write((issue.code??'GTFS_OPERATION_FAILED')+': '+issue.message+'\n');process.exitCode=1;});
