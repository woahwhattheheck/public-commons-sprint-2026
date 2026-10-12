#!/usr/bin/env node
// MIT. One installed Eurostat command, original publication and buyer workflows.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bytes, createFile, privateDirectory, fault } from '../postgres/publisher/files.mjs';
import { main as publisherMain } from '../postgres/publisher/cli.mjs';
import { openEurostatWorkspace } from './workspace.mjs';
import { startEurostatServer } from './server.mjs';
import { readOriginalFile } from './source.mjs';
import { prepareEurostatRelease,stageEurostatRelease,activateEurostatRelease,rollbackEurostatRelease,runEurostatRelease } from './release.mjs';
const HELP='Eurostat economic workspace — Linux, Node 24 LTS, util-linux flock\n\n'+
'  init --workspace NEW_PROJECT [--state ORIGINAL_DATASET]\n'+
'  serve --workspace PROJECT [--create] [--state ORIGINAL_DATASET] [--port 8468]\n'+
'        [--seller LOCAL_ORIGIN --resource EXISTING_HTTPS_RESOURCE]\n'+
'  acquire --workspace PROJECT --input REQUEST.json\n'+
'  import --workspace PROJECT --file ORIGINAL.json --input ACQUISITION.json\n'+
'  import-handover --workspace PROJECT --file SOURCE_HANDOVER.json\n'+
'  export-sources --workspace PROJECT --out NEW_HANDOVER.json\n'+
'  capture --workspace PROJECT --id CAPTURE_SHA\n'+
'  cells --workspace PROJECT --id CAPTURE_SHA [--input PAGE_OPTIONS.json]\n'+
'  compare --workspace PROJECT --before CAPTURE_SHA --after CAPTURE_SHA [--input OPTIONS.json]\n'+
'  query --workspace PROJECT --input REVIEWED_QUERY.json\n'+
'  template --workspace PROJECT --query NAME --out NEW_PLAN.json\n'+
'  briefing --workspace PROJECT --id CAPTURE_SHA [--query NAME] --out NEW_PRIVATE_DIRECTORY\n'+
'  project-status --workspace PROJECT\n'+
'  release-prepare --workspace PROJECT --input RELEASE.json\n'+
'  release-stage --input STAGE.json\n'+
'  release-activate | release-rollback | release-run --input ORIGINAL_RELEASE.json\n'+
'  mcp --origin http://127.0.0.1:8468\n'+
'  receive --workspace PROJECT --input RECEIVING.json\n\n'+
'Original publisher actions: save, extract, inspect, review, publish, recover, buyer, status,\n'+
'source, schedule, schedule-save, schedule-enable, schedule-pause, schedule-run, schedule-continue.\n'+
'Use publisher-help for their exact options. --workspace always names the Eurostat PROJECT.\n'+
'serve reopens the same project and starts its original scheduler. New source acquisition is explicit.';
const delegated=new Set(['save','extract','inspect','review','publish','recover','buyer','status','source','schedule','schedule-save','schedule-enable','schedule-pause','schedule-run','schedule-continue']);
const print=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
const json=async path=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readOriginalFile(resolve(path),384*1024*1024)));
function parse(argv){
 const [command,...rest]=argv,o={};
 for(let i=0;i<rest.length;i++){const k=rest[i];
  if(!['--workspace','--state','--seller','--resource','--port','--create','--input','--file','--out','--id','--query','--before','--after','--origin'].includes(k)||Object.hasOwn(o,k))throw fault('EUROSTAT_OPTION',k);
  if(k==='--create'){o[k]=true;continue;}if(!rest[i+1]||rest[i+1].startsWith('--'))throw fault('EUROSTAT_OPTION_VALUE',k);o[k]=rest[++i];
 }return {command,o};
}
const required=(o,k)=>{if(!o[k])throw fault('EUROSTAT_OPTION_REQUIRED',k);return o[k];};
export async function main(argv=process.argv.slice(2)){
 if(!argv.length||['--help','help'].includes(argv[0])){process.stdout.write(HELP+'\n');return;}
 if(argv[0]==='publisher-help')return publisherMain(['--help'],{sourceName:'Eurostat',defaultPort:8468});
 if(delegated.has(argv[0]))return publisherMain(argv,{sourceName:'Eurostat',defaultPort:8468,
   openPublisher:async options=>{const w=await openEurostatWorkspace(options);return {...w.publisher,close:()=>w.close()};}});
 const {command,o}=parse(argv);
 if(command==='mcp')return (await import('./mcp.mjs')).runEurostatMcp({origin:required(o,'--origin')});
 if(['release-stage','release-activate','release-rollback','release-run'].includes(command)){
  const input=await json(required(o,'--input'));let result;
  if(command==='release-stage')result=await stageEurostatRelease(input);
  if(command==='release-activate')result=await activateEurostatRelease(input.releaseDirectory,input.id,input.options);
  if(command==='release-rollback')result=await rollbackEurostatRelease(input.releaseDirectory,input.options);
  if(command==='release-run')result=await runEurostatRelease(input.releaseDirectory,input.options);
  if(command!=='release-run')print(result);return result;
 }
 if(command==='receive')return (await import('./receiving.mjs')).receiveEurostat({
   directory:resolve(required(o,'--workspace')),config:await json(required(o,'--input')),print});
 const workspace=await openEurostatWorkspace({directory:resolve(required(o,'--workspace')),create:command==='init'||Boolean(o['--create']),
   targetDirectory:o['--state']?resolve(o['--state']):undefined,seller:o['--seller']??null,resource:o['--resource']??null});
 if(command==='serve'){
   try{const service=await startEurostatServer({workspace,port:o['--port']===undefined?8468:Number(o['--port'])});
     print({url:service.url,workspace:workspace.directory,source:workspace.sourceFile,target:workspace.settings.targetDirectory});
     for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>service.close().catch(()=>{process.exitCode=1;}));return service;
   }catch(e){await workspace.close();throw e;}
 }
 try{
   let output;
   if(command==='init'||command==='project-status')output=await workspace.status();
   else if(command==='acquire')output=await workspace.acquire(await json(required(o,'--input')));
   else if(command==='import')output=await workspace.importCapture({...await json(required(o,'--input')),body:await readOriginalFile(required(o,'--file'))});
   else if(command==='import-handover')output=await workspace.importSources(await json(required(o,'--file')));
   else if(command==='export-sources'){const path=resolve(required(o,'--out'));await createFile(path,bytes(await workspace.exportSources()));output={created:path};}
   else if(command==='briefing'){
     const id=required(o,'--id'),source=await workspace.publisher.source(),q=o['--query']?source.config.queries[o['--query']]:null;
     if(o['--query']&&(!q||q.captureId!==id))throw fault('EUROSTAT_QUERY_CAPTURE_MISSING');
     const r=await workspace.briefing(id,q?{selection:q.selection,includeMissing:q.includeMissing,review:q.review}:{});
     const directory=resolve(required(o,'--out'));await privateDirectory(directory,true);
     const original=await workspace.capture(id);
     for(const [name,content]of [['briefing.html',Buffer.from(r.html)],['briefing.json',bytes(r.report)],
       ['observations.csv',Buffer.from(r.csv)],['original-response.json',original.body]])
       await createFile(resolve(directory,name),content);
     output={directory,rows:r.report.rows,series:r.report.comparisons.length,responseSha256:original.capture.response.sha256};
   }
   else if(command==='capture'){const c=await workspace.capture(required(o,'--id'));output={capture:c.capture,captureSha256:c.captureSha256};}
   else if(command==='cells')output=await workspace.cells(required(o,'--id'),o['--input']?await json(o['--input']):{});
   else if(command==='compare')output=await workspace.compare(required(o,'--before'),required(o,'--after'),o['--input']?await json(o['--input']):{});
   else if(command==='query')output=await workspace.saveQuery(await json(required(o,'--input')));
   else if(command==='template'){const path=resolve(required(o,'--out'));await createFile(path,bytes(await workspace.planTemplate({query:required(o,'--query')})));output={created:path};}
   else if(command==='release-prepare')output=await prepareEurostatRelease({...await json(required(o,'--input')),publisher:workspace.publisher});
   else throw fault('EUROSTAT_COMMAND_REQUIRED',HELP);
   print(output);return output;
 }finally{await workspace.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 main().catch(e=>{process.stderr.write(JSON.stringify({error:e.code??'EUROSTAT_FAILED',message:e.message})+'\n');process.exitCode=1;});
