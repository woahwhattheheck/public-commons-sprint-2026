import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as Engine from './engine.mjs';
import {sha256Bytes} from './sha256.mjs';
import {recovery,parseRecovery,json,nativeFilename} from './portable.mjs';
import {build,publishFile,publishDirectory} from './build.mjs';

const HELP='Application Packet Workspace\n\n'+
'node cli.mjs create --id ID --title TITLE --out NEW_JSON [--at ISO_TIME]\n'+
'node cli.mjs apply --workspace ORIGINAL_JSON --operation COMPLETE_OPERATION_JSON --out NEW_JSON\n'+
'node cli.mjs add-file --workspace ORIGINAL_JSON --file ORIGINAL_FILE --file-id ID --purpose TEXT --mime TYPE --actor NAME --operation-id ID --expected-revision N --at ISO_TIME --out NEW_JSON\n'+
'node cli.mjs inspect --workspace ORIGINAL_JSON --out NEW_JSON\n'+
'node cli.mjs native --workspace ORIGINAL_JSON --mapping ID --out-dir NEW_DIRECTORY\n'+
'node cli.mjs export --workspace ORIGINAL_JSON --out-dir NEW_DIRECTORY [--copy-id ORIGINAL_BROWSER_COPY_ID]\n\n'+
'The apply input is {action,input,operationId,expectedRevision,actor,at}. Preserve the exact operation ID, timestamp, actor and input when retrying. Outputs are create-only; identical completed output is reused.\n';
function options(argv,allowed,required){const out={};for(let i=0;i<argv.length;i+=2){const key=argv[i];if(!allowed.includes(key)||!argv[i+1]||Object.prototype.hasOwnProperty.call(out,key))throw Error('Unknown, repeated or incomplete option '+key+'.\n'+HELP);out[key]=argv[i+1];}for(const key of required)if(!out[key])throw Error('Supply '+key+'.\n'+HELP);return out;}
async function readRecord(path){return parseRecovery(await readFile(resolve(path),'utf8'));}
export async function run(argv){
  const [command,...args]=argv;if(!command||['help','--help','-h'].includes(command))return{help:HELP};
  if(command==='create'){
    const a=options(args,['--id','--title','--out','--at'],['--id','--title','--out']);
    const workspace=Engine.createWorkspace({id:a['--id'],title:a['--title'],createdAt:a['--at']||new Date().toISOString()});
    return publishFile(a['--out'],json(recovery(workspace)));
  }
  if(command==='apply'){
    const a=options(args,['--workspace','--operation','--out'],['--workspace','--operation','--out']),record=await readRecord(a['--workspace']),operation=JSON.parse(await readFile(resolve(a['--operation']),'utf8'));
    const result=Engine.apply(record.workspace,operation.action,operation.input,{operationId:operation.operationId,expectedRevision:operation.expectedRevision,actor:operation.actor,at:operation.at});
    return{...await publishFile(a['--out'],json({...record,workspace:result.workspace})),replayed:result.replayed,operation:result.operation};
  }
  if(command==='add-file'){
    const names=['--workspace','--file','--file-id','--purpose','--mime','--actor','--operation-id','--expected-revision','--at','--out'];
    const a=options(args,names,names),record=await readRecord(a['--workspace']),bytes=await readFile(resolve(a['--file']));
    if(bytes.length>Engine.LIMITS.fileBytes)throw Error('The original file exceeds 32 MiB.');
    const path=a['--file'].replaceAll('\\','/').split('/').at(-1),input={id:a['--file-id'],filename:path,purpose:a['--purpose'],mimeType:a['--mime'],base64:Engine.base64Encode(bytes)};
    const result=Engine.apply(record.workspace,'addFile',input,{operationId:a['--operation-id'],expectedRevision:Number(a['--expected-revision']),actor:a['--actor'],at:a['--at']});
    return{...await publishFile(a['--out'],json({...record,workspace:result.workspace})),original:{path:resolve(a['--file']),...sha256Bytes(bytes)},operation:result.operation,replayed:result.replayed};
  }
  if(command==='inspect'){
    const a=options(args,['--workspace','--out'],['--workspace','--out']),record=await readRecord(a['--workspace']);
    return publishFile(a['--out'],json(Engine.inspect(record.workspace)));
  }
  if(command==='native'){
    const a=options(args,['--workspace','--mapping','--out-dir'],['--workspace','--mapping','--out-dir']),record=await readRecord(a['--workspace']),result=Engine.nativeExport(record.workspace,a['--mapping']);
    const files=result.files.map(f=>({...f,path:'native/'+nativeFilename(f.path),originalPath:f.path}));
    return publishDirectory(a['--out-dir'],[...files,{path:'Native_Export_Assessment.json',content:json({...result,files:files.map(f=>f.path),originalPaths:files.map(f=>({path:f.path,originalPath:f.originalPath}))})}]);
  }
  if(command==='export'){
    const a=options(args,['--workspace','--out-dir','--copy-id'],['--workspace','--out-dir']);
    return build({out:a['--out-dir'],workspacePath:a['--workspace'],copyId:a['--copy-id']});
  }
  throw Error('Unknown command '+command+'.\n'+HELP);
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{const result=await run(process.argv.slice(2));console.log(result.help||json(result));}
  catch(e){console.error((e.code?e.code+': ':'')+e.message);process.exitCode=1;}
}
