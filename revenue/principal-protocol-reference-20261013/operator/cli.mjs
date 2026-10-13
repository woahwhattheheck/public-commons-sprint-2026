#!/usr/bin/env node
// MIT. Full Principal workspace, original requests, files and portable receiving.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {openWorkspace,inspectPacket,receiveWorkspace,MAX_PACKET} from './lib/workspace.mjs';
import {startServer} from './server.mjs';
import {need,bytes,jsonInput,hash,uuid} from './lib/value.mjs';
import {writeExact,fileDescriptor} from './lib/files.mjs';
export function options(argv){const result={};for(let i=0;i<argv.length;i++){const name=argv[i];need(/^--[a-z-]+$/.test(name)&&i+1<argv.length&&!Object.hasOwn(result,name.slice(2)),'CLI_OPTIONS');result[name.slice(2)]=argv[++i];}return result;}
export async function readOriginal(file,max=MAX_PACKET){need(typeof file==='string'&&path.isAbsolute(file),'ABSOLUTE_INPUT_REQUIRED');const d=await fileDescriptor(file);need(d.bytes<=max,'INPUT_TOO_LARGE');const data=await fs.readFile(file);need(data.length===d.bytes&&hash(data)===d.sha256,'INPUT_CHANGED');return{descriptor:d,data};}
async function selectedJSON(file){return jsonInput((await readOriginal(file)).data.toString('utf8'));}
async function output(value,file){const data=Buffer.isBuffer(value)?value:bytes(value);if(file){need(path.isAbsolute(file),'ABSOLUTE_OUTPUT_REQUIRED');await writeExact(file,data);}else process.stdout.write(data);}
const HELP=`Principal operations (Node >=22.16, local Linux workspace)
  init --workspace ABS_DIRECTORY [--name NAME] [--out ABS_JSON]
  serve --workspace ABS_DIRECTORY --token-file ABS_FILE [--port PORT] [--host 127.0.0.1]
  state|bootstrap --workspace ABS_DIRECTORY [--out ABS_JSON]
  command --workspace ABS_DIRECTORY --input ABS_ORIGINAL_COMMAND_JSON [--out ABS_JSON]
  request --workspace ABS_DIRECTORY --id ORIGINAL_ID [--out ABS_JSON]
  file --workspace ABS_DIRECTORY --id FILE_ID --out NEW_ABS_FILE
  export --workspace ABS_DIRECTORY --out NEW_ABS_PACKET
  inspect --input ABS_COMPLETE_PACKET [--out ABS_JSON]
  receive --input ABS_COMPLETE_PACKET --workspace ABS_NEW_DESTINATION --request-id ORIGINAL_RECEIVE_ID [--out ABS_JSON]
  course --input ABS_ACTUAL_COURSE_INPUT --out ABS_OWNED_COURSE_DIRECTORY

Commands preserve their complete requestId/expectedRevision/method/args. Inspecting
or receiving never sends a contract transaction. A native plan executes only via
explicit plan.execute and matching enabled configuration. An uncertain native
attempt cannot be automatically repeated. All output files are complete and
create-only; use the exact original file for a retry.
`;
export async function main(argv=process.argv.slice(2)){
 const action=argv.shift();if(!action||action==='help'){process.stdout.write(HELP);return;}
 const opt=options(argv);
 if(action==='inspect')return output(inspectPacket(await selectedJSON(opt.input)),opt.out);
 if(action==='receive')return output(await receiveWorkspace({packet:await selectedJSON(opt.input),directory:path.resolve(opt.workspace),requestId:opt['request-id']}),opt.out);
 if(action==='course'){const {receiveCourse}=await import('./receiving/principal-receiving.mjs');return output(await receiveCourse(await selectedJSON(opt.input),path.resolve(opt.out)));}
 need(opt.workspace&&path.isAbsolute(opt.workspace),'ABSOLUTE_WORKSPACE_REQUIRED');
 if(action==='serve'){
  const token=(await readOriginal(opt['token-file'],4096)).data.toString('utf8').trim();
  const port=opt.port===undefined?0:Number(opt.port);need(Number.isInteger(port)&&port>=0&&port<=65535,'PORT_REQUIRED');
  const server=await startServer({directory:opt.workspace,token,host:opt.host??'127.0.0.1',port});
  process.stdout.write(JSON.stringify({schema:'principal.server.v1',url:server.url,workspaceId:server.workspace.read().workspace.id})+'\n');
  let stop;await new Promise(resolve=>{stop=resolve;process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
  try{await server.close();}finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}return;
 }
 const workspace=await openWorkspace({directory:opt.workspace,name:opt.name});
 const stop=()=>workspace.abort.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
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
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code??'ERROR',message:error.message,details:error.details??{}}})+'\n');process.exitCode=1;});
