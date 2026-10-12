#!/usr/bin/env node
// MIT. Native Matomo operator commands use the same journal as the browser.
import {parseArgs} from 'node:util';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openMatomoWorkspace} from './model.mjs';
import {startMatomoWorkspace} from './server.mjs';
export async function run(argv=process.argv.slice(2)) {
  const {values,positionals}=parseArgs({args:argv,allowPositionals:true,options:{
    workspace:{type:'string'},source:{type:'string'},create:{type:'boolean',default:false},'allow-loopback':{type:'boolean',default:false},
    python:{type:'string'},input:{type:'string'},id:{type:'string'},port:{type:'string'},query:{type:'string'}
  }});
  if(!values.workspace)throw new Error('Use --workspace PRIVATE_DIRECTORY. First open also uses --create --source SOURCE_JSON.');
  const command=positionals[0]??'serve',options={directory:resolve(values.workspace),create:values.create,
    sourceFile:values.source?resolve(values.source):undefined,allowLoopback:values['allow-loopback'],...(values.python?{python:values.python}:{})};
  if(command==='serve'){
    const app=await startMatomoWorkspace({...options,port:Number(values.port??0)});
    process.stdout.write(JSON.stringify({schema:'stellar-forge.matomo-operator.v1',url:app.url,directory:options.directory})+'\n');
    let closing=false;const close=async()=>{if(closing)return;closing=true;await app.close();};
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void close().catch(()=>{process.exitCode=1;}));
    return app;
  }
  const model=await openMatomoWorkspace(options);
  try{
    let result;
    if(command==='state')result=model.state();
    else if(command==='action')result=model.store.action(values.id);
    else if(command==='catalog')result=model.captures.catalog(values.id);
    else if(command==='capture-state')result={capture:model.captures.capture(values.id),tables:model.captures.tables(values.id)};
    else if(command==='edition-state'){const value=await model.editions.manifest(values.id,{database:true});result={edition:value.edition,manifest:value.value};}
    else if(command==='merchant-state')result=await model.merchant.state(values.id);
    else if(command==='delivery-state')result=await model.merchant.inspectDelivery(values.id,values.query);
    else if(command==='handover-state')result=model.handover.handover(values.id);
    else if(command==='receiving-state')result=model.handover.receiving(values.id);
    else if(command==='releases')result=await model.merchant.releases();
    else{
      if(!values.input)throw new Error('Use --input JSON_FILE, or --input - for one exact JSON operation on stdin.');
      const raw=values.input==='-'?await new Promise((done,fail)=>{let value='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>{value+=x;if(value.length>1048576){process.stdin.destroy();fail(new Error('Operation exceeds1MiB'));}});process.stdin.on('end',()=>done(value));process.stdin.on('error',fail);}):await readFile(resolve(values.input),'utf8');
      const input=JSON.parse(raw);
      if(command==='preview')result=await model.merchant.preview(input);
      else result=await model.perform(command,input);
    }
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    if(['start-release','open-release-console'].includes(command))await new Promise(done=>{for(const signal of ['SIGINT','SIGTERM'])process.once(signal,done);});
    return result;
  }finally{await model.close();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)run().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'MATOMO_COMMAND_FAILED',message:error.message})+'\n');process.exitCode=1;});
