// MIT. Native CLI for complete Public Assistance capture, analysis and delivery.
import {readFile,open,lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {openOpenFemaWorkspace} from './core.mjs';
import {main as workspaceMain,readReleaseRuntime} from './workspace.mjs';
import {restoreWorkspaceArchive,inspectWorkspaceArchive} from './exports.mjs';
import {writeNew,jsonBytes} from '../stellar-expert/store.mjs';
import {fault} from './domain.mjs';
const USAGE='OpenFEMA Public Assistance\n\n'+
'  openfema-workspace --workspace PRIVATE_DIR [--inbox ORIGINAL_INBOX] [--release-runtime PRIVATE_JSON]\n'+
'  openfema capture --workspace PRIVATE_DIR [--disasters 4724,4725] [--states VT,FL] [--from YYYY-MM-DD] [--through YYYY-MM-DD] [--label NAME]\n'+
'  openfema receive-source --workspace PRIVATE_DIR --bundle ORIGINAL_JSON_OR_GZIP\n'+
'  openfema portfolio --workspace PRIVATE_DIR --source EDITION_ID --name NAME [--criteria JSON_FILE]\n'+
'  openfema view --workspace PRIVATE_DIR\n'+
'  openfema schema --workspace PRIVATE_DIR\n'+
'  openfema rows --workspace PRIVATE_DIR --version VERSION_ID [--table projects] [--search TEXT] [--offset 0] [--limit 100]\n'+
'  openfema action --workspace PRIVATE_DIR --request ACTION_JSON [--wait]\n'+
'  openfema operation --workspace PRIVATE_DIR --operation-id ORIGINAL_ID\n'+
'  openfema export --workspace PRIVATE_DIR --version VERSION_ID --format html|json|csv --out NEW_FILE\n'+
'  openfema source-export --workspace PRIVATE_DIR --source EDITION_ID --out NEW_JSON\n'+
'  openfema backup --workspace PRIVATE_DIR --out NEW_ZIP\n'+
'  openfema inspect-backup --archive ORIGINAL_ZIP\n'+
'  openfema restore --archive ORIGINAL_ZIP --workspace NEW_ABSOLUTE_PRIVATE_DIRECTORY\n\n'+
'Every schema action is available through action --request: source continuation, portfolio revision and comparison, analyst review, native dataset query, release staging/control and original customer receiving. Requests use {action,payload,operationId,expectedRevision}; omitted operationId/revision receive the current native values. Keep the original operationId to reopen interrupted work.\n';
function parse(args){
  const [command,...rest]=args,options={};
  for(let i=0;i<rest.length;i++){
    const key=rest[i];
    if(key==='--wait'){if(options[key])throw fault('OPENFEMA_OPTIONS','Repeated option.');options[key]=true;continue;}
    if(!/^--[a-z-]+$/.test(key)||Object.hasOwn(options,key)||!rest[i+1]||rest[i+1].startsWith('--'))throw fault('OPENFEMA_OPTIONS','Use paired options; see --help.');
    options[key]=rest[++i];
  }
  return {command,options};
}
async function originalFile(path,max=256*1024*1024){
  if(typeof path!=='string'||!path)throw fault('OPENFEMA_SOURCE_FILE','Select an original file.');
  const f=await open(resolve(path),'r');
  try{const before=await f.stat({bigint:true});if(!before.isFile()||before.size>BigInt(max))throw fault('OPENFEMA_SOURCE_SIZE','Select a complete regular file within the receiving capacity.');const body=await f.readFile(),after=await f.stat({bigint:true});if(before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs||BigInt(body.length)!==before.size)throw fault('OPENFEMA_SOURCE_CHANGED','The original selected file changed during reading.',409);return body;}finally{await f.close();}
}
async function originalJSON(path){let bytes=await originalFile(path);if(bytes[0]===31&&bytes[1]===139)bytes=gunzipSync(bytes,{maxOutputLength:256*1024*1024});return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
const print=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
export async function main(args=process.argv.slice(2)){
  if(!args.length||args.includes('--help')){console.log(USAGE);return;}
  if(args[0]==='workspace'||args[0]==='serve')return workspaceMain(args.slice(1));
  const {command,options:o}=parse(args);
  const common=['--workspace','--inbox','--release-runtime','--user-agent','--operation-id'];
  const specific={
    capture:['--disasters','--states','--from','--through','--label','--page-size'],
    'receive-source':['--bundle'],portfolio:['--source','--name','--criteria'],
    schema:[],view:[],rows:['--version','--table','--search','--sort','--direction','--offset','--limit'],
    action:['--request','--wait'],operation:[],export:['--version','--table','--format','--out'],
    'source-export':['--source','--out'],backup:['--out'],'inspect-backup':['--archive'],restore:['--archive']
  };
  if(!Object.hasOwn(specific,command)||Object.keys(o).some(k=>!common.includes(k)&&!specific[command].includes(k)))throw fault('OPENFEMA_OPTIONS','Use a supported command and its options; see --help.');
  if(command==='inspect-backup'){const {manifest,archiveSha256,manifestSha256}=inspectWorkspaceArchive(await originalFile(o['--archive'],1024*1024*1024));print({manifest,archiveSha256,manifestSha256});return;}
  if(command==='restore'){print(await restoreWorkspaceArchive({bytes:await originalFile(o['--archive'],1024*1024*1024),directory:o['--workspace']}));return;}
  if(!o['--workspace'])throw fault('OPENFEMA_WORKSPACE_REQUIRED','--workspace is required.');
  const app=await openOpenFemaWorkspace({directory:resolve(o['--workspace']),inboxDirectory:o['--inbox']?resolve(o['--inbox']):undefined,releaseRuntime:o['--release-runtime']?await readReleaseRuntime(o['--release-runtime']):undefined,userAgent:o['--user-agent']});
  const act=(action,payload,original={})=>app.action({action,payload,operationId:o['--operation-id']||original.operationId||'cli-'+randomUUID(),expectedRevision:original.expectedRevision??app.store.read().revision});
  let signal=false;const interrupt=()=>{signal=true;void app.close();};process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
  try{
    if(command==='schema'){print(app.schema());return;}
    if(command==='view'){print(await app.view());return;}
    if(command==='operation'){if(!o['--operation-id'])throw fault('OPENFEMA_OPERATION_ID','Select an original operation ID.');print(await app.operation(o['--operation-id']));return;}
    if(command==='rows'){print(await app.rows(o['--version']??app.store.read().selectedVersionId,{table:o['--table']||'projects',search:o['--search']||'',sort:o['--sort']||'',direction:o['--direction']||'asc',offset:Number(o['--offset']||0),limit:Number(o['--limit']||100)}));return;}
    if(command==='backup'){if(!o['--out'])throw fault('OPENFEMA_OUTPUT','--out is required.');const archive=await app.archive();await writeNew(resolve(o['--out']),archive.bytes);print({output:resolve(o['--out']),bytes:archive.bytes.length,manifest:archive.manifest});return;}
    if(command==='capture'){
      const scope={},list=x=>x?x.split(',').map(s=>s.trim()).filter(Boolean):[];
      if(o['--disasters']){const ids=list(o['--disasters']);if(ids.some(x=>!/^[1-9][0-9]*$/.test(x)))throw fault('OPENFEMA_SCOPE','Use positive disaster numbers.');scope.disasterNumbers=ids.map(Number);}
      if(o['--states'])scope.states=list(o['--states']).map(s=>s.toUpperCase());
      if(o['--from'])scope.declarationDateFrom=o['--from'];if(o['--through'])scope.declarationDateTo=o['--through'];if(o['--page-size'])scope.pageSize=Number(o['--page-size']);
      const result=await act('source.capture',{scope,label:o['--label']||'Public Assistance source'});print(result);
      await app.waitForCaptures();const status=await app.capture.status(result.result.captureId);print({capture:status,view:await app.view()});if(status.state!=='COMPLETE')process.exitCode=signal?130:1;return;
    }
    if(command==='receive-source'){print(await act('source.import',{bundle:await originalJSON(o['--bundle'])}));return;}
    if(command==='portfolio'){const criteria=o['--criteria']?await originalJSON(o['--criteria']):{name:o['--name']};if(o['--name'])criteria.name=o['--name'];print(await act('portfolio.create',{name:criteria.name,editionId:o['--source'],criteria}));return;}
    if(command==='action'){
      const request=await originalJSON(o['--request']);if(!request||typeof request!=='object'||Object.keys(request).some(k=>!['action','payload','operationId','expectedRevision'].includes(k)))throw fault('OPENFEMA_ACTION','Select an original action request.');
      print(await act(request.action,request.payload??{},request));if(o['--wait']){await app.waitForCaptures();print(await app.view());}return;
    }
    if(command==='export'||command==='source-export'){
      if(!o['--out'])throw fault('OPENFEMA_OUTPUT','--out is required.');
      const result=await act(command==='source-export'?'source.export':'export.create',command==='source-export'?{editionId:o['--source']}:{versionId:o['--version']??app.store.read().selectedVersionId,table:o['--table']||'projects',format:o['--format']||'html'}),output=await app.exported(result.result.id);
      await writeNew(resolve(o['--out']),output.bytes);print({...output.item,output:resolve(o['--out'])});return;
    }
  }finally{process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);await app.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(JSON.stringify({error:error.code||'OPENFEMA_CLI',message:error.message,receivingDirectory:error.receivingDirectory??null}));process.exitCode=1;});
