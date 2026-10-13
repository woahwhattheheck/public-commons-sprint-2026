#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import { readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { openGraviteeWorkspace } from './workspace.mjs';
import { startGraviteeServer } from './server.mjs';
import { inspectReceivingPackage,receivePackage } from './delivery.mjs';
import { readContract,publicError,requireValue } from './contract.mjs';

const HELP='Gravitee commissioning workspace\n\n'+
'  node cli.mjs serve --directory /absolute/workspace [--port 8765]\n'+
'  node cli.mjs init --directory /absolute/workspace [--connection connection.json]\n'+
'  node cli.mjs action --directory /absolute/workspace --method METHOD --input input.json\n'+
'  node cli.mjs export --directory /absolute/workspace --output handover.json\n'+
'  node cli.mjs inspect --input handover.json\n'+
'  node cli.mjs receive --input handover.json --destination /absolute/new-folder\n'+
'  node cli.mjs contract\n\n'+
'Credentials come from the environment variables named in connection.json.\n'+
'Use --input - to read JSON on stdin. Keep the same requestId after reconnecting.\n';
function argumentsFor(argv){
  const [command='help',...rest]=argv,result={command};
  for(let i=0;i<rest.length;i++){requireValue(rest[i].startsWith('--')&&rest[i+1]!==undefined,'ARGUMENT_INVALID',HELP);result[rest[i].slice(2)]=rest[++i];}
  return result;
}
async function inputFile(path){
  requireValue(path,'INPUT_FILE_REQUIRED');
  if(path==='-'){const chunks=[];let bytes=0;for await(const chunk of process.stdin){bytes+=chunk.length;requireValue(bytes<=512*1024*1024,'INPUT_TOO_LARGE');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  return JSON.parse(await readFile(resolve(path),'utf8'));
}
export async function main(argv=process.argv.slice(2),{out=value=>process.stdout.write(JSON.stringify(value)+'\n')}={}){
  const args=argumentsFor(argv);
  if(['help','--help'].includes(args.command)){process.stdout.write(HELP);return;}
  if(args.command==='contract'){out(await readContract());return;}
  if(args.command==='inspect'){out(inspectReceivingPackage(await inputFile(args.input)));return;}
  if(args.command==='receive'){requireValue(args.destination,'RECEIVING_DESTINATION_REQUIRED',HELP);out(await receivePackage(await inputFile(args.input),resolve(args.destination)));return;}
  requireValue(args.directory,'WORKSPACE_DIRECTORY_REQUIRED',HELP);const directory=resolve(args.directory);
  if(args.command==='serve'){
    const server=await startGraviteeServer({directory,port:args.port===undefined?0:Number(args.port)});
    out({schema:'gravitee.native-session.v1',workspaceId:server.workspaceId,url:server.url,directory,port:Number(new URL(server.origin).port)});
    const stop=async()=>{try{await server.close();}catch(error){process.stderr.write(JSON.stringify(publicError(error))+'\n');process.exitCode=1;}};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);return server;
  }
  const workspace=await openGraviteeWorkspace({directory});
  try{
    if(args.command==='init'){
      if(args.connection)await workspace.action('saveConnection',{requestId:randomUUID(),connection:await inputFile(args.connection)});
      out(await workspace.action('view'));return;
    }
    if(args.command==='action'){
      const input=await inputFile(args.input),value=await workspace.action(args.method,input);out(value);return value;
    }
    if(args.command==='export'){
      requireValue(args.output,'HANDOVER_OUTPUT_REQUIRED');const value=await workspace.action('exportHandover',{requestId:randomUUID()});
      const object=await workspace.action('readObject',{reference:value.reference});
      const path=resolve(args.output);await writeFile(path,Buffer.from(object.base64,'base64'),{flag:'wx',mode:0o600});
      out({path,...value.inspection});return;
    }
    throw Object.assign(new Error(HELP),{code:'COMMAND_UNKNOWN'});
  }finally{await workspace.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{process.stderr.write(JSON.stringify(publicError(error))+'\n');process.exitCode=1;});
