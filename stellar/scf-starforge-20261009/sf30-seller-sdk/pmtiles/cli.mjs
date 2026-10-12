#!/usr/bin/env node
// MIT. The original PMTiles workspace and complete runtime/receiving commands.
import {isAbsolute,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readJson} from '../../sf88-operator-buyer-cli/node/store.mjs';
import {Buyer} from '../../sf88-operator-buyer-cli/node/client.mjs';
import {need,clone,identifier} from './model.mjs';
import {MAX_METADATA_BYTES,retainFile} from './files.mjs';
import {readRuntime} from './native.mjs';
import {openPMTilesWorkspace,receivePMTilesWorkspace} from './workspace.mjs';
import {buildPMTilesRuntime} from './build-runtime.mjs';
import {servePMTilesWorkspace} from './server.mjs';
import {createOperationsPackage,receiveOperationsPackage,receiveInstalledPackage,readOperationsPackage} from './portable.mjs';

const HELP='PMTiles release operations\n\n'+
'node cli.mjs init --workspace /ABS/workspace [--title "Map releases"]\n'+
'node cli.mjs runtime-build --input /ABS/runtime-build.json\n'+
'node cli.mjs serve --workspace /ABS/workspace --workspace-id ID --runtime /ABS/runtime/runtime.json [--port 0]\n'+
'node cli.mjs state --workspace /ABS/workspace --workspace-id ID [--offset 0 --limit 50]\n'+
'node cli.mjs resources --workspace /ABS/workspace --workspace-id ID [--kind pmtiles --offset 0 --limit 100]\n'+
'node cli.mjs read-resource|read-review|read-release|read-request --workspace /ABS/workspace --workspace-id ID --id RECORD\n'+
'node cli.mjs read-edition --workspace /ABS/workspace --workspace-id ID --id EDITION --version 1\n'+
'node cli.mjs compare --workspace /ABS/workspace --workspace-id ID --input /ABS/comparison.json\n'+
'node cli.mjs import-local|acquire|adopt-object|save-edition|review|prepare-release|publish|restore|export --workspace /ABS/workspace --workspace-id ID --input /ABS/request.json\n'+
'node cli.mjs inspect|package --workspace /ABS/workspace --workspace-id ID --runtime /ABS/runtime/runtime.json --input /ABS/request.json\n'+
'node cli.mjs preview --workspace /ABS/workspace --workspace-id ID --runtime /ABS/runtime/runtime.json --input /ABS/preview.json [--port 0]\n'+
'node cli.mjs resource-copy --workspace /ABS/workspace --workspace-id ID --input /ABS/file-copy.json\n'+
'node cli.mjs receive-workspace|receive-package|receive-installed --input /ABS/receiving.json\n'+
'node cli.mjs read-package --input /ABS/saved-package-selection.json\n\n'+
'Every mutation uses the complete saved JSON requestId and expectedWorkspaceId. Reopening that same file resumes its original operation.\n'+
'serve and preview stay in the foreground; SIGINT/SIGTERM drain the owned Martin child and close the saved workspace.\n';

function argumentsFor(argv){
  const [command,...rest]=argv;
  if(!command||command==='help'||command==='--help')return {command:'help',options:{}};
  const options={};
  for(let i=0;i<rest.length;i+=2){
    const name=rest[i],value=rest[i+1];
    need(/^--[a-z][a-z-]*$/.test(name)&&typeof value==='string'&&!value.startsWith('--'),'PMTILES_CLI_ARGUMENT_REQUIRED',name);
    need(!Object.hasOwn(options,name.slice(2)),'PMTILES_CLI_ARGUMENT_DUPLICATED',name);options[name.slice(2)]=value;
  }
  return {command,options};
}
function selectedPath(options,key){
  need(typeof options[key]==='string'&&isAbsolute(options[key]),'PMTILES_CLI_ABSOLUTE_PATH_REQUIRED','--'+key);return resolve(options[key]);
}
function integer(options,key,fallback){
  if(options[key]===undefined)return fallback;
  need(/^\d+$/.test(options[key]),'PMTILES_CLI_INTEGER_REQUIRED','--'+key);
  const result=Number(options[key]);need(Number.isSafeInteger(result),'PMTILES_CLI_INTEGER_REQUIRED','--'+key);return result;
}
async function inputFile(options){return clone(await readJson(selectedPath(options,'input'),MAX_METADATA_BYTES));}
function allowed(options,names){need(Object.keys(options).every(key=>names.includes(key)),'PMTILES_CLI_OPTION_UNKNOWN');}
async function print(value){await new Promise((resolve,reject)=>process.stdout.write(JSON.stringify(value,null,2)+'\n',error=>error?reject(error):resolve()));}
export async function runPMTilesCommand(argv,{signal,onReady=print}={}){
  const {command,options}=argumentsFor(argv);
  if(command==='help'){await new Promise(resolve=>process.stdout.write(HELP,resolve));return undefined;}
  if(command==='runtime-build'){allowed(options,['input']);return buildPMTilesRuntime(await inputFile(options),{signal});}
  if(['receive-workspace','receive-package','receive-installed','read-package'].includes(command)){
    allowed(options,['input']);const input=await inputFile(options);
    if(command==='receive-workspace')return receivePMTilesWorkspace({...input,signal});
    if(command==='receive-package')return receiveOperationsPackage(input,{signal});
    if(command==='receive-installed')return receiveInstalledPackage(input,{signal});
    return (await readOperationsPackage(input)).result;
  }
  if(command==='init'){
    allowed(options,['workspace','title']);
    const workspace=await openPMTilesWorkspace({directory:selectedPath(options,'workspace'),title:options.title??'Map release operations'});
    try{return workspace.state();}finally{await workspace.close();}
  }
  allowed(options,['workspace','workspace-id','runtime','input','port','offset','limit','kind','id','version']);
  const directory=selectedPath(options,'workspace'),workspaceId=identifier(options['workspace-id']);
  if(command==='serve'||command==='preview'){
    const input=command==='preview'?await inputFile(options):null;
    if(input)need(input.expectedWorkspaceId===workspaceId,'PMTILES_WORKSPACE_ID_CHANGED');
    const server=await servePMTilesWorkspace({directory,expectedWorkspaceId:workspaceId,runtime:selectedPath(options,'runtime'),port:integer(options,'port',0)});
    const stop=()=>{server.close().catch(()=>{});};signal?.addEventListener('abort',stop,{once:true});
    try{
      signal?.throwIfAborted();
      const preview=input?await server.controller.execute('preview',input,{signal}):null;
      await onReady({schema:'starforge.pmtiles-authoring-ready.v1',workspaceId,origin:server.origin,url:server.url,port:server.port,preview});
      await server.closed;return {schema:'starforge.pmtiles-authoring-stopped.v1',workspaceId};
    }finally{signal?.removeEventListener('abort',stop);await server.close();}
  }
  const workspace=await openPMTilesWorkspace({directory,create:false,expectedWorkspaceId:workspaceId});
  try{
    if(command==='state')return workspace.state({offset:integer(options,'offset',0),limit:integer(options,'limit',50)});
    if(command==='resources')return workspace.listResources({offset:integer(options,'offset',0),limit:integer(options,'limit',100),kind:options.kind??null});
    const readers={'read-resource':workspace.getResource,'read-review':workspace.getReview,
      'read-release':workspace.getRelease,'read-request':workspace.getRequest};
    if(readers[command]){const result=readers[command](identifier(options.id));need(result,'PMTILES_RECORD_NOT_FOUND');return result;}
    if(command==='read-edition')return workspace.getEdition(identifier(options.id),integer(options,'version',null));
    const input=await inputFile(options);
    need(input.expectedWorkspaceId===workspaceId,'PMTILES_WORKSPACE_ID_CHANGED');
    if(command==='compare')return workspace.compare(input);
    if(command==='resource-copy'){
      need(isAbsolute(input.destination),'PMTILES_ABSOLUTE_FILE_REQUIRED');
      const file=workspace.resourceFile(identifier(input.resourceId)),original=await file.verify({signal});
      await retainFile(file.path,resolve(input.destination),{expected:original,signal});
      return {workspaceId,resourceId:input.resourceId,destination:resolve(input.destination),...original};
    }
    const operations={
      'import-local':()=>workspace.importLocal(input,{signal}),
      acquire:()=>workspace.acquire(input,{signal}),
      'save-edition':()=>workspace.saveEdition(input),
      inspect:async()=>workspace.inspectEdition(input,await readRuntime(selectedPath(options,'runtime')),{signal}),
      review:()=>workspace.review(input),
      'prepare-release':()=>workspace.prepareRelease(input,{signal}),
      publish:()=>workspace.publish(input,{signal}),
      restore:()=>workspace.restore(input,{signal}),
      export:()=>workspace.exportWorkspace({...input,signal}),
      package:async()=>createOperationsPackage({workspace,runtime:await readRuntime(selectedPath(options,'runtime')),input,signal}),
      'adopt-object':async()=>{
        const {buyer:buyerInput,objectId,assemblyPath,...resource}=input;
        need(buyerInput&&typeof buyerInput==='object','PMTILES_ORIGINAL_OBJECT_BUYER_REQUIRED');
        const buyer=new Buyer(clone(buyerInput));
        const delivery=await buyer.object(identifier(objectId)).delivery(assemblyPath,{signal});
        return workspace.adoptObject(resource,delivery,{signal});
      }
    };
    need(operations[command],'PMTILES_CLI_COMMAND_UNKNOWN',command);
    return await operations[command]();
  }finally{await workspace.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const abort=new AbortController();
  const stop=()=>abort.abort(new Error('PMTILES_CLI_STOPPED'));
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{const result=await runPMTilesCommand(process.argv.slice(2),{signal:abort.signal});if(result!==undefined)await print(result);}
  catch(error){await print({error:{code:error.code??'PMTILES_CLI_FAILED',message:String(error.message??error)}});process.exitCode=1;}
  finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
