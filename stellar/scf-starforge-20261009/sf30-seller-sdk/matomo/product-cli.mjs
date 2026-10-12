#!/usr/bin/env node
// MIT. Installed standalone Matomo product; same workspace and archive authority.
import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {exportMatomoProduct,inspectMatomoProduct,receiveMatomoProduct} from './workspace-transfer.mjs';
import {openMatomoWorkspace} from './model.mjs';
import {startMatomoWorkspace} from './server.mjs';

const HELP='Matomo product workspace\n\n'
+'  export --workspace ABS --archive ABS_ZIP --operation-id ID\n'
+'  inspect --archive ABS_ZIP\n'
+'  receive --archive ABS_ZIP --directory NEW_CONTAINER --operation-id ID\n'
+'  origin --workspace ABS [--table history] [--offset 0 --limit 25]\n'
+'  state --workspace ABS\n'
+'  serve --workspace ABS [--port 0]\n\n'
+'Options: --python EXECUTABLE, --allow-loopback\n'
+'Close all original workspace/publisher processes before export. Receive returns\n'
+'NEW_CONTAINER/workspace; open that exact directory in the original UI/Apps/MCP.\n'
+'Source files and original commercial history stay private and byte-exact.\n';
export async function run(argv=process.argv.slice(2)){
  const {values,positionals}=parseArgs({args:argv,allowPositionals:true,options:{
    help:{type:'boolean'},workspace:{type:'string'},archive:{type:'string'},directory:{type:'string'},
    'operation-id':{type:'string'},python:{type:'string'},'allow-loopback':{type:'boolean',default:false},
    table:{type:'string'},offset:{type:'string'},limit:{type:'string'},port:{type:'string'}
  }});
  if(values.help||!positionals.length){process.stdout.write(HELP);return;}
  if(positionals.length!==1)throw Error('Choose one Matomo product command.');
  const command=positionals[0],controller=new AbortController();
  const abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
  const needed=name=>{if(!values[name])throw Error('Use --'+name+'.');return values[name];};
  const number=(name,fallback)=>{const value=values[name];if(value===undefined)return fallback;if(!/^[0-9]+$/.test(value)||!Number.isSafeInteger(Number(value)))throw Error('Use an integer for --'+name+'.');return Number(value);};
  const options={...(values.python?{python:values.python}:{}),signal:controller.signal,allowLoopback:values['allow-loopback']};
  let model,app;
  try{
    let result;
    if(command==='export')result=await exportMatomoProduct({...options,directory:resolve(needed('workspace')),archive:resolve(needed('archive')),operationId:needed('operation-id')});
    else if(command==='inspect')result=await inspectMatomoProduct({...options,archive:resolve(needed('archive'))});
    else if(command==='receive')result=await receiveMatomoProduct({...options,archive:resolve(needed('archive')),directory:resolve(needed('directory')),operationId:needed('operation-id')});
    else if(command==='serve'){
      app=await startMatomoWorkspace({...options,directory:resolve(needed('workspace')),port:number('port',0)});
      process.stdout.write(JSON.stringify({schema:'stellar-forge.matomo-product-listener.v1',url:app.url,directory:app.model.store.directory,workspaceId:app.model.store.settings.id})+'\n');
      if(!controller.signal.aborted)await new Promise(done=>controller.signal.addEventListener('abort',done,{once:true}));
      return;
    }else if(command==='state'||command==='origin'){
      model=await openMatomoWorkspace({...options,directory:resolve(needed('workspace'))});
      if(command==='state')result=model.state();
      else{
        if(!model.origin)throw Object.assign(Error('This workspace has no received original.'),{code:'MATOMO_PRODUCT_ORIGINAL_REQUIRED'});
        result={origin:model.origin.summary(),page:await model.origin.page({table:values.table??'history',offset:number('offset',0),limit:number('limit',25)})};
      }
    }else throw Error('Unknown Matomo product command. Use --help.');
    process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
  }finally{
    try{await app?.close();await model?.close();}
    finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
  }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)run().catch(error=>{
  process.stderr.write(JSON.stringify({error:error.code??'MATOMO_PRODUCT_COMMAND_FAILED',message:error.code??error.message})+'\n');process.exitCode=1;
});
