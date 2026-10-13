#!/usr/bin/env node
// MIT. Whole BIM local operator, original command/files and portable transfer.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {openWorkspace,inspectPacket,receiveWorkspace,MAX_PACKET} from './lib/workspace.mjs';
import {startServer} from './server.mjs';
import {need,bytes,jsonInput,hash} from './lib/value.mjs';
import {writeExact,fileDescriptor} from './lib/files.mjs';
export function options(argv){const result={};for(let i=0;i<argv.length;i++){const name=argv[i];need(/^--[a-z-]+$/.test(name)&&i+1<argv.length&&!Object.hasOwn(result,name.slice(2)),'CLI_OPTIONS');result[name.slice(2)]=argv[++i];}return result;}
export async function readOriginal(file,max=MAX_PACKET){need(typeof file==='string'&&path.isAbsolute(file),'ABSOLUTE_INPUT_REQUIRED');const d=await fileDescriptor(file);need(d.bytes<=max,'INPUT_TOO_LARGE');const data=await fs.readFile(file);need(data.length===d.bytes&&hash(data)===d.sha256,'INPUT_CHANGED');return{descriptor:d,data};}
async function selectedJSON(file){return jsonInput(new TextDecoder('utf-8',{fatal:true}).decode((await readOriginal(file)).data));}
async function output(value,file){const data=Buffer.isBuffer(value)?value:bytes(value);if(file){need(path.isAbsolute(file),'ABSOLUTE_OUTPUT_REQUIRED');await writeExact(file,data);}else process.stdout.write(data);}
async function credentials(file){if(!file)return null;const original=await readOriginal(file,1024*1024);need((original.descriptor.mode&0o077)===0,'PRIVATE_CREDENTIAL_FILE_REQUIRED');const selected=jsonInput(original.data.toString('utf8'));need(selected&&typeof selected==='object'&&!Array.isArray(selected),'CREDENTIAL_MAP_REQUIRED');return async alias=>{const row=selected[alias];need(row&&Array.isArray(row.origins)&&typeof row.headers==='object','SERVER_CREDENTIAL_UNAVAILABLE');return row;};}
async function providers(){const {createProviders}=await import('./providers/index.mjs');return await createProviders();}
const HELP=[
'BIM operations — Node >=22.16, local Linux SQLite',
'  init --workspace ABS_DIRECTORY [--name NAME] [--out NEW_ABS_JSON]',
'  serve --workspace ABS_DIRECTORY --token-file PRIVATE_ABS_FILE [--credentials-file PRIVATE_ABS_FILE] [--port PORT]',
'  state|bootstrap --workspace ABS_DIRECTORY [--out NEW_ABS_JSON]',
'  command --workspace ABS_DIRECTORY --input ABS_ORIGINAL_COMMAND [--credentials-file PRIVATE_ABS_FILE] [--out NEW_ABS_JSON]',
'  request --workspace ABS_DIRECTORY --id ORIGINAL_ID [--out NEW_ABS_JSON]',
'  file --workspace ABS_DIRECTORY --id FILE_ID --out NEW_ABS_FILE',
'  export --workspace ABS_DIRECTORY --out NEW_ABS_PACKET',
'  inspect --input ABS_COMPLETE_PACKET [--out NEW_ABS_JSON]',
'  receive --input ABS_COMPLETE_PACKET --workspace ABS_NEW_DIRECTORY --request-id ORIGINAL_ID [--out NEW_ABS_JSON]',
'',
'Query, preparation, local signing handoff and explicit external write are distinct.',
'Request lookup never dispatches. Retry a completed original body to recover the',
'same receipt. An unknown original HTTP attempt is never automatically resent.',
'All files are complete and create-only. Private credentials/session tokens and',
'private provider bodies remain with their original host; portable packets retain',
'their complete public identities/status and mark private content unavailable.',''].join('\n');
export async function main(argv=process.argv.slice(2)){
 const action=argv.shift();if(!action||action==='help'){process.stdout.write(HELP);return;}
 const opt=options(argv);if(action==='inspect')return output(inspectPacket(await selectedJSON(opt.input)),opt.out);
 need(opt.workspace&&path.isAbsolute(opt.workspace),'ABSOLUTE_WORKSPACE_REQUIRED');const adapters=await providers(),credentialResolver=await credentials(opt['credentials-file']);
 if(action==='receive')return output(await receiveWorkspace({packet:await selectedJSON(opt.input),directory:opt.workspace,requestId:opt['request-id'],adapters,credentialResolver}),opt.out);
 if(action==='serve'){
  const selected=await readOriginal(opt['token-file'],4096);need((selected.descriptor.mode&0o077)===0,'PRIVATE_TOKEN_FILE_REQUIRED');const token=selected.data.toString('utf8').trim(),port=opt.port===undefined?0:Number(opt.port);need(Number.isInteger(port)&&port>=0&&port<=65535,'PORT_REQUIRED');
  const server=await startServer({directory:opt.workspace,token,adapters,credentialResolver,host:'127.0.0.1',port});process.stdout.write(JSON.stringify({schema:'bim.server.v1',url:server.url,workspaceId:server.workspace.read().workspace.id})+'\n');
  let stop;await new Promise(resolve=>{stop=resolve;process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});try{await server.close();}finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}return;
 }
 const workspace=await openWorkspace({directory:opt.workspace,name:opt.name,adapters,credentialResolver}),stop=()=>workspace.abort.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{
  if(action==='init'||action==='state')return await output(workspace.state(),opt.out);
  if(action==='bootstrap')return await output(workspace.bootstrap(),opt.out);
  if(action==='request')return await output(workspace.request(opt.id),opt.out);
  if(action==='command')return await output(await workspace.command(await selectedJSON(opt.input)),opt.out);
  if(action==='file'){need(opt.out,'OUTPUT_REQUIRED');return await output(workspace.object(opt.id).data,opt.out);}
  if(action==='export'){need(opt.out,'OUTPUT_REQUIRED');return await output(await workspace.portable(),opt.out);}
  throw Object.assign(new Error('UNKNOWN_CLI_ACTION'),{code:'UNKNOWN_CLI_ACTION'});
 }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);await workspace.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code??'ERROR',message:error.code??'Operation failed'}})+'\n');process.exitCode=1;});
