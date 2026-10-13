#!/usr/bin/env node
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {readFile} from 'node:fs/promises';
import {Hdf5Workbench} from './controller.mjs';
import {serveHdf5} from './server.mjs';
const usage='HDF5 array workbench\n\nnode hdf5/app.mjs --workspace /private/workspace [--python /path/to/python] [--input-root /private/input] [--buyer-workspace /private/buyer]\nnode hdf5/app.mjs --workspace /private/workspace --action status\nnode hdf5/app.mjs --workspace /private/workspace --action selection.save --payload request.json\n\nDefault starts the original loopback operator and prints its host-private URL. --action executes that same workspace API and closes its original runtime. All writes retain the caller operation ID. h5py and NumPy must be installed in the selected Python. Publisher/customer actions use the existing dataset release and buyer configuration.\n';
export async function main(argv=process.argv.slice(2)){
  const {values}=parseArgs({args:argv,options:{help:{type:'boolean',short:'h'},workspace:{type:'string'},python:{type:'string'},'input-root':{type:'string',multiple:true},'buyer-workspace':{type:'string'},port:{type:'string'},action:{type:'string'},payload:{type:'string'}}});
  if(values.help){process.stdout.write(usage);return;}
  if(!values.workspace)throw new Error('Supply --workspace; use --help for the complete original launcher.');
  const configuration={directory:values.workspace,python:values.python??'python3',inputRoots:values['input-root']??[],buyerWorkspace:values['buyer-workspace']};
  if(values.action){
    const workbench=new Hdf5Workbench(configuration);
    try{const input=values.payload?JSON.parse(await readFile(values.payload,'utf8')):{};process.stdout.write(JSON.stringify(await workbench.call(values.action,input),null,2)+'\n');}
    finally{await workbench.close();}
    return;
  }
  const port=values.port===undefined?0:Number(values.port);
  if(!Number.isSafeInteger(port)||port<0||port>65535)throw new Error('Choose a valid loopback port.');
  const server=await serveHdf5({...configuration,port});
  process.stdout.write(JSON.stringify({schema:server.schema,url:server.url,directory:server.directory,pid:server.pid})+'\n');
  let stopping;
  const stop=()=>{
    if(stopping)return stopping;
    stopping=server.close().then(()=>{process.exitCode=0;},error=>{
      process.stderr.write(error.message+'\n');process.exitCode=1;stopping=null;
    });return stopping;
  };
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'HDF5_ERROR',message:error.message})+'\n');process.exitCode=1;});
