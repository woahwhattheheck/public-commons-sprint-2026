#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {initializeCollectionReceiver,openCollectionReceiver,startCollectionReceiver}
  from './native-collections-receiver.mjs';
const commands={init:[],register:['--description'],'collections-register':['--description'],
  inspect:[],call:['--input'],opened:['--name','--request-id'],serve:['--port']};
const fail=code=>{throw Object.assign(new Error(code),{code});};
const print=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
function parse(args){
  const [command,...rest]=args;if(!Object.hasOwn(commands,command)||rest.length%2)fail('MCP_COLLECTION_RECEIVER_ARGUMENTS_INVALID');
  const values={};
  for(let i=0;i<rest.length;i+=2){
    if(!['--dir',...commands[command]].includes(rest[i])||Object.hasOwn(values,rest[i])||!rest[i+1])
      fail('MCP_COLLECTION_RECEIVER_ARGUMENTS_INVALID');
    values[rest[i]]=rest[i+1];
  }
  if(!values['--dir'])fail('MCP_COLLECTION_RECEIVER_DIRECTORY_REQUIRED');
  return {command,values};
}
async function input(path){
  if(!path)fail('MCP_COLLECTION_RECEIVER_INPUT_REQUIRED');
  const raw=await readFile(path);if(raw.length>256*1024)fail('MCP_COLLECTION_RECEIVER_INPUT_TOO_LARGE');
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
  catch{fail('MCP_COLLECTION_RECEIVER_JSON_INVALID');}
}
export async function main(args=process.argv.slice(2)){
  if(args.length===1&&['--help','-h'].includes(args[0])){
    process.stdout.write('Original Request Collections and recovery MCP host.\n'+
      'init --dir PRIVATE_NEW_DIRECTORY\n'+
      'register --dir PRIVATE --description ORIGINAL_RECOVERY_REGISTRATION_JSON\n'+
      'collections-register --dir PRIVATE --description ORIGINAL_COLLECTION_REGISTRATION_JSON\n'+
      'inspect --dir PRIVATE\ncall --dir PRIVATE --input ORIGINAL_TOOL_ARGUMENTS_JSON\n'+
      'opened --dir PRIVATE --name RECOVERY_ALIAS --request-id ORIGINAL_RESTORE_UUID\n'+
      'serve --dir PRIVATE [--port 0..65535]\n'+
      'Serve uses MCP_ACCESS_TOKEN or the original MCP_OAUTH_CONFIG. It starts only this MCP listener.\n'+
      'Registration keeps the separately owned original listener and exact host-selected profile bytes.\n');
    return 0;
  }
  try{
    const {command,values:v}=parse(args),directory=v['--dir'];
    if(command==='init'){print(await initializeCollectionReceiver({directory}));return 0;}
    if(command==='serve'){
      const value=v['--port']??'0';
      if(!/^(0|[1-9][0-9]{0,4})$/.test(value)||Number(value)>65535)fail('MCP_COLLECTION_RECEIVER_PORT_INVALID');
      const service=await startCollectionReceiver({directory,port:Number(value)});
      print({schema:service.schema,id:service.id,state:'LISTENING',url:service.url,pid:service.pid,
        directory,authorization:service.authorization,originalListenerOwned:false,walletCreated:false});
      let closing;
      const stop=()=>{closing??=service.close().catch(error=>{
        process.stderr.write(JSON.stringify({error:/^[A-Z0-9_]{1,160}$/.test(error?.code??'')?
          error.code:'MCP_COLLECTION_RECEIVER_CLOSE_FAILED'})+'\n');process.exitCode=2;
      });};
      process.once('SIGINT',stop);process.once('SIGTERM',stop);return 0;
    }
    const native=await openCollectionReceiver(directory);
    try{
      if(command==='register')print(await native.registerRecovery(await input(v['--description'])));
      else if(command==='collections-register')print(await native.registerCollections(await input(v['--description'])));
      else if(command==='call')print(await native.call(await input(v['--input'])));
      else if(command==='opened')print(await native.openedConnection(v['--name'],v['--request-id']));
      else print({schema:native.manifest.schema,id:native.manifest.id,directory,
        collections:await native.call({action:'collections',collectionOperation:'workspaces'}),
        recovery:await native.call({action:'collection-recovery',recoveryOperation:'workspaces'}),
        walletCreated:false,originalListenerOwned:false});
    }finally{await native.close();}
    return 0;
  }catch(error){
    process.stderr.write(JSON.stringify({error:/^[A-Z0-9_]{1,160}$/.test(error?.code??'')?
      error.code:'MCP_COLLECTION_RECEIVER_FAILED',retry:'REOPEN_ORIGINAL_OPERATION'})+'\n');return 2;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)process.exitCode=await main();
