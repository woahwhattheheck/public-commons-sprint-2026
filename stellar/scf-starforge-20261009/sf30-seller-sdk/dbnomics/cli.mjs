#!/usr/bin/env node
// MIT. One installed DBnomics command and its original source-dataset publisher.
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {main as publisherMain} from '../postgres/publisher/cli.mjs';
import {privateDirectory} from '../postgres/publisher/files.mjs';
import {openDbnomicsWorkspace} from './workspace.mjs';
import {startDbnomicsServer} from './server.mjs';
import {readOriginalFile,importDbnomicsInput} from './source.mjs';
import {discoverDbnomics,exactFile} from './provider.mjs';
import {need,jsonBytes} from './model.mjs';
import {prepareDbnomicsRelease,stageDbnomicsRelease,activateDbnomicsRelease,
  rollbackDbnomicsRelease,runDbnomicsRelease} from './release.mjs';
const HELP = `DBnomics economic workspace — Linux, Node 24 LTS, util-linux flock

  init --workspace NEW_PROJECT [--state ORIGINAL_DATASET]
  serve --workspace PROJECT [--create] [--state ORIGINAL_DATASET] [--port 8459]
        [--seller ORIGINAL_LOCAL_ORIGIN --resource ORIGINAL_HTTPS_RESOURCE]
  discover --input DISCOVERY.json
  acquire | refresh --workspace PROJECT --input ORIGINAL_OPERATION.json
  import --workspace PROJECT --id ORIGINAL_OPERATION --file CAPTURE_OR_IMPORT.json
  import-example --workspace PROJECT --id ORIGINAL_OPERATION
  project-status --workspace PROJECT
  operation --workspace PROJECT --id ORIGINAL_OPERATION
  capture --workspace PROJECT --id CAPTURE_SHA [--out NEW_CAPTURE.json]
  observations | facets --workspace PROJECT --id CAPTURE_SHA [--input PAGE.json]
  compare --workspace PROJECT --before CAPTURE_SHA --after CAPTURE_SHA [--input PAGE.json]
  notes --workspace PROJECT --id CAPTURE_SHA [--revision N]
  save-notes | save-report | query --workspace PROJECT --input ORIGINAL_OPERATION.json
  report --workspace PROJECT --id REPORT_ID
  export-report --workspace PROJECT --id REPORT_ID [--format json|csv|html] [--out NEW_FILE]
  export-sources --workspace PROJECT --out NEW_SOURCE_HANDOVER.json
  import-sources --workspace PROJECT --id ORIGINAL_OPERATION --file SOURCE_HANDOVER.json
  template --workspace PROJECT --query NAME [--out NEW_PLAN.json]
  save-plan --workspace PROJECT --input PLAN_OPERATION.json
  extract --workspace PROJECT --input EXTRACTION_OPERATION.json
  release-prepare --workspace PROJECT --input RELEASE.json
  release-stage | release-activate | release-rollback | release-run --input ORIGINAL_RELEASE.json
  mcp --origin http://127.0.0.1:8459
  receive --workspace PROJECT --input RECEIVING.json

Original publisher actions: inspect, review, publish, recover, buyer, status, source,
schedule, schedule-save, schedule-enable, schedule-pause, schedule-run, schedule-continue.
Use publisher-help for their exact arguments. --workspace always names this DBnomics PROJECT.
An original operation ID and exact input identify each acquisition, note edit, report and plan.
extract input is {id:<one retained UUID>,planId:<original saved plan integer>}.
serve reopens this project. New source acquisition and merchant/payment operations are explicit.
`;
const delegated=new Set(['inspect','review','publish','recover','buyer','status','source','schedule',
  'schedule-save','schedule-enable','schedule-pause','schedule-run','schedule-continue']);
const print=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
const json=async path=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readOriginalFile(resolve(path),256*1024*1024)));
function parse(argv){
  const [command,...rest]=argv,o={};
  const keys=['--workspace','--state','--seller','--resource','--port','--create','--input','--file','--out',
    '--id','--query','--before','--after','--origin','--revision','--format'];
  for(let i=0;i<rest.length;i++){
    const key=rest[i];need(keys.includes(key)&&!Object.hasOwn(o,key),'Unknown or repeated option '+key+'.');
    if(key==='--create'){o[key]=true;continue;}
    need(rest[i+1]!==undefined&&!rest[i+1].startsWith('--'),'Supply the value for '+key+'.');o[key]=rest[++i];
  }
  return {command,o};
}
const required=(o,key)=>{need(typeof o[key]==='string'&&o[key],'Supply '+key+'.');return o[key];};
async function outputFile(path,content){
  path=resolve(path);await privateDirectory(dirname(path),true);
  const file=await exactFile(dirname(path),path.slice(dirname(path).length+1),content);
  return {path,...file};
}
export async function main(argv=process.argv.slice(2)){
  if(!argv.length||['help','--help'].includes(argv[0])){process.stdout.write(HELP+'\n');return;}
  if(argv[0]==='publisher-help')return publisherMain(['--help'],{sourceName:'DBnomics',defaultPort:8459});
  if(delegated.has(argv[0]))return publisherMain(argv,{sourceName:'DBnomics',defaultPort:8459,
    openPublisher:async options=>{const workbench=await openDbnomicsWorkspace(options);return {...workbench.publisher,close:()=>workbench.close()};}});
  const {command,o}=parse(argv);
  if(command==='discover'){const result=await discoverDbnomics(await json(required(o,'--input')));print(result);return result;}
  if(command==='mcp')return (await import('./mcp.mjs')).runDbnomicsMcp({origin:required(o,'--origin')});
  if(['release-stage','release-activate','release-rollback','release-run'].includes(command)){
    const input=await json(required(o,'--input'));
    const result=command==='release-stage'?await stageDbnomicsRelease(input):
      command==='release-activate'?await activateDbnomicsRelease(input.releaseDirectory,input.id,input.options):
      command==='release-rollback'?await rollbackDbnomicsRelease(input.releaseDirectory,input.options):
      await runDbnomicsRelease(input.releaseDirectory,input.options);
    if(command!=='release-run')print(result);return result;
  }
  if(command==='receive')return (await import('./receiving.mjs')).receiveDbnomics({
    directory:resolve(required(o,'--workspace')),config:await json(required(o,'--input')),print});
  const workbench=await openDbnomicsWorkspace({
    directory:resolve(required(o,'--workspace')),create:command==='init'||Boolean(o['--create']),
    targetDirectory:o['--state']?resolve(o['--state']):undefined,seller:o['--seller']??null,resource:o['--resource']??null});
  if(command==='serve'){
    try{
      const service=await startDbnomicsServer({workbench,port:o['--port']===undefined?8459:Number(o['--port'])});
      print({url:service.url,workspace:workbench.directory,source:workbench.sourceFile,target:workbench.settings.targetDirectory});
      for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>service.close().catch(()=>{process.exitCode=1;}));
      return service;
    }catch(error){await workbench.close();throw error;}
  }
  try{
    let result;
    if(command==='init'||command==='project-status')result=await workbench.status();
    else if(command==='operation')result=await workbench.operation(required(o,'--id'));
    else if(command==='acquire')result=await workbench.acquire(await json(required(o,'--input')));
    else if(command==='refresh')result=await workbench.refresh(await json(required(o,'--input')));
    else if(command==='import'||command==='import-example'){
      const file=command==='import-example'?fileURLToPath(new URL('./examples/insee-ipc.import.json',import.meta.url)):resolve(required(o,'--file'));
      result=await workbench.importCapture({id:required(o,'--id'),capture:await importDbnomicsInput(file)});
    }else if(command==='capture'){
      const value=await workbench.capture(required(o,'--id'));
      result=o['--out']?await outputFile(o['--out'],value.captureBytes):
        {captureId:value.capture.captureId,captureSha256:value.captureSha256,capture:value.capture};
    }else if(command==='observations')result=await workbench.observations(required(o,'--id'),o['--input']?await json(o['--input']):{});
    else if(command==='facets')result=await workbench.facets(required(o,'--id'),o['--input']?await json(o['--input']):{});
    else if(command==='compare')result=await workbench.compare(required(o,'--before'),required(o,'--after'),o['--input']?await json(o['--input']):{});
    else if(command==='notes')result=await workbench.notes(required(o,'--id'),o['--revision']===undefined?null:Number(o['--revision']));
    else if(command==='save-notes')result=await workbench.saveNotes(await json(required(o,'--input')));
    else if(command==='save-report')result=await workbench.saveReport(await json(required(o,'--input')));
    else if(command==='report')result=await workbench.report(required(o,'--id'));
    else if(command==='export-report'){
      result=await workbench.exportReport(required(o,'--id'),o['--format']??'json');
      if(o['--out'])result={...result,delivery:await outputFile(o['--out'],await readOriginalFile(result.path))};
    }else if(command==='export-sources')result=await outputFile(required(o,'--out'),jsonBytes(await workbench.exportSources()));
    else if(command==='import-sources')result=await workbench.importSources({id:required(o,'--id'),bundle:await json(required(o,'--file'))});
    else if(command==='query')result=await workbench.saveQuery(await json(required(o,'--input')));
    else if(command==='template'){
      const value=await workbench.planTemplate(required(o,'--query'));result=o['--out']?await outputFile(o['--out'],jsonBytes(value)):value;
    }else if(command==='save-plan')result=await workbench.savePublicationPlan(await json(required(o,'--input')));
    else if(command==='extract')result=workbench.startPublication(await json(required(o,'--input')));
    else if(command==='release-prepare')result=await prepareDbnomicsRelease({...await json(required(o,'--input')),publisher:workbench.publisher});
    else need(false,'Choose a documented DBnomics command.\n'+HELP,'DBNOMICS_COMMAND');
    if(command==='extract'){
      const id=result.id;while(workbench.publisher.run(id).state==='EXTRACTING')await new Promise(resolve=>setTimeout(resolve,50));
      result={...result,run:workbench.publisher.run(id)};
    }
    print(result);return result;
  }finally{await workbench.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'DBNOMICS_FAILED',message:error.message,
    providerStatus:error.providerStatus??null,retryAt:error.retryAt??null})+'\n');process.exitCode=1;});
