// MIT. Original warehouse CLI: direct owner or the existing authenticated listener.
import { readFile, lstat, open, link, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { fault, digest } from '../../odata/state.mjs';
import { normalizeConnection } from '../commissioning/agreement.mjs';
import { ODK_CONNECTION_SCHEMA, connectCentralWorkspace } from '../connection.mjs';
import { normalizeWarehouseProfiles } from './bridge.mjs';
import { openCentralWarehouse, serveCentralWarehouse } from './open.mjs';

const methods=new Map([['state','state'],['prepare','prepare'],['connect','connect'],['inspect','inspect'],
  ['review','review'],['import','import'],['report','periodReport'],['operation','operation'],['approval','approval'],['resume','resume']]);
export const WAREHOUSE_HELP="Central approved period warehouse\n\n  node odk/warehouse/cli.mjs serve --workspace /private/central \\\n    --profiles /private/postgres-profiles.json --port 0 \\\n    --ready-file /private/central-warehouse-listener.json\n  node odk/warehouse/cli.mjs COMMAND --operator-file /private/central-warehouse-listener.json \\\n    --input /private/original-action.json\n  node odk/warehouse/cli.mjs COMMAND --workspace /private/central \\\n    --profiles /private/postgres-profiles.json --input /private/original-action.json\n\nUse the existing listener when the Central workspace is open.\nThe managed odk.connection.json is accepted by --operator-file.\nEvery action retains its 32-character hexadecimal requestId before execution.\n\n  state       current profiles, original deliveries, approvals and operations\n  connect     {requestId, profileId}; binds the actual existing warehouse identity\n  prepare     {requestId, deliveryId, datasetId, period:0|1}\n  inspect     {requestId, approvalId, profileId}\n  review      {requestId, inspectionId, mapping, reviewer, note}\n  import      {requestId, reviewId}\n  report      {requestId, previousImportId, currentImportId, title}\n  operation   {requestId}; complete original command/result/recovery record\n  approval    {requestId}; full approved original source and every file receipt\n  resume      {requestId}; original saved action and stable native IDs\n\nOptional --connection FILE supplies the original commissioning connection for its\nsame listener. PostgreSQL credentials stay in each profile's connectionEnv. The\noriginal Python package and warehouse are installed/initialized by the host.\n";
function parse(argv) {
  const options={command:argv[0]};
  if(!argv.length||argv.includes('--help')||argv.includes('-h'))return {help:true};
  if(!methods.has(options.command)&&options.command!=='serve')throw fault('CENTRAL_WAREHOUSE_COMMAND','Choose a documented warehouse command.');
  const allowed=new Set(['workspace','profiles','operator-file','input','connection','host','port','ready-file']);
  for(let index=1;index<argv.length;index+=2) {
    const key=argv[index]?.slice(2),value=argv[index+1];
    if(!argv[index]?.startsWith('--')||!allowed.has(key)||typeof value!=='string'||value.startsWith('--')||Object.hasOwn(options,key))
      throw fault('CENTRAL_WAREHOUSE_ARGUMENT','Supply each documented command option once.');
    options[key]=value;
  }
  if(options.port!==undefined){options.port=Number(options.port);if(!Number.isSafeInteger(options.port)||options.port<0||options.port>65535)
    throw fault('CENTRAL_WAREHOUSE_PORT','Choose a valid local listener port.');}
  return options;
}
async function jsonFile(path,{privateFile=false,limit=2*1024*1024}={}) {
  const selected=resolve(path),info=await lstat(selected);
  if(!info.isFile()||info.isSymbolicLink()||info.size>limit||
      privateFile&&process.platform!=='win32'&&(info.mode&0o077)!==0)
    throw fault('CENTRAL_WAREHOUSE_FILE','Use the complete regular '+(privateFile?'private ':'')+'JSON file.');
  const raw=await readFile(selected);
  if(raw.length>limit)throw fault('CENTRAL_WAREHOUSE_FILE','The selected JSON exceeds its complete input limit.');
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
  catch{throw fault('CENTRAL_WAREHOUSE_JSON','Use a complete UTF-8 JSON file.');}
}
async function profilesFile(path) {
  if(!path)return [];
  const value=await jsonFile(path,{privateFile:true}),profiles=Array.isArray(value)?value:
    value?.schema==='stellar-forge.central-warehouse-profiles.v1'?value.profiles:null;
  return normalizeWarehouseProfiles(profiles);
}
async function connectionFile(path) {
  if(!path)return undefined;
  const value=await jsonFile(path,{privateFile:true});
  return normalizeConnection(value.connection??value);
}
async function publishReady(path,value) {
  const selected=resolve(path),parent=await lstat(dirname(selected));
  if(!parent.isDirectory()||parent.isSymbolicLink()||process.platform!=='win32'&&(parent.mode&0o077)!==0)
    throw fault('CENTRAL_WAREHOUSE_READY_FILE','Select a ready file in an existing private host directory.');
  const temporary=selected+'.'+randomUUID()+'.part',bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');
  try {
    const file=await open(temporary,'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
    await link(temporary,selected);
    const directory=await open(dirname(selected),'r');try{await directory.sync();}finally{await directory.close();}
    return {path:selected,sha256:digest(bytes)};
  }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function retireReady(receipt) {
  if(!receipt)return;
  try{const info=await lstat(receipt.path);if(info.isFile()&&!info.isSymbolicLink()&&digest(await readFile(receipt.path))===receipt.sha256)await unlink(receipt.path);}
  catch(error){if(error.code!=='ENOENT')throw error;}
}
async function remoteClient(path) {
  const descriptor=await jsonFile(path,{privateFile:true,limit:65536});
  if(descriptor.schema===ODK_CONNECTION_SCHEMA){
    const client=await connectCentralWorkspace({connectionFile:resolve(path)});
    try{
      await client.warehouseState();
      const send=(route,input)=>route==='/api/warehouse/state'?client.warehouseState():
        client.warehouseAction(route.slice('/api/warehouse/'.length),input);
      send.close=()=>client.close();
      return send;
    }catch(error){client.close();throw error;}
  }
  let address;try{address=new URL(descriptor.origin);}catch{throw fault('CENTRAL_WAREHOUSE_LISTENER','Use the original private listener descriptor.');}
  if(address.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(address.hostname)||
      address.username||address.password||address.pathname!=='/'||address.search||address.hash||
      typeof descriptor.token!=='string'||descriptor.token.length<32||typeof descriptor.workspaceId!=='string')
    throw fault('CENTRAL_WAREHOUSE_LISTENER','Use the existing original loopback listener and private token.');
  const send=async(route,input)=>{
    const response=await fetch(address.origin+route,{redirect:'error',method:input===undefined?'GET':'POST',
      headers:{Origin:address.origin,Authorization:'Bearer '+descriptor.token,...(input===undefined?{}:{'Content-Type':'application/json'})},
      ...(input===undefined?{}:{body:JSON.stringify(input)})});
    const value=await response.json();
    if(!response.ok||value.ok===false)throw Object.assign(fault(value.error?.code??'CENTRAL_WAREHOUSE_HTTP',
      value.error?.message??'Reopen the original saved request.',response.status),{details:value.error?.details});
    return value.result??value;
  };
  const state=await send('/api/warehouse/state');
  if(state.schema!=='stellar-forge.central-warehouse.v1'||state.workspaceId!==descriptor.workspaceId)
    throw fault('CENTRAL_WAREHOUSE_LISTENER_IDENTITY','This private listener belongs to another original workspace.');
  return send;
}
const output=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
export async function runCentralWarehouseCli(argv=process.argv.slice(2)) {
  const options=parse(argv);if(options.help){process.stdout.write(WAREHOUSE_HELP);return;}
  if(options['operator-file']&&options.workspace)throw fault('CENTRAL_WAREHOUSE_ONE_OWNER','Choose the existing listener or a direct closed workspace.');
  if(options.command==='serve') {
    if(!options.workspace||options['operator-file']||!options['ready-file'])
      throw fault('CENTRAL_WAREHOUSE_SERVE','Select the original workspace and a new private ready file.');
    const owner=await serveCentralWarehouse({directory:options.workspace,profiles:await profilesFile(options.profiles),
      connection:await connectionFile(options.connection),host:options.host??'127.0.0.1',port:options.port??0});
    let receipt=null,resolveStop;const stop=new Promise(resolve=>{resolveStop=resolve;});
    const shutdown=()=>resolveStop();
    process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
    try {
      receipt=await publishReady(options['ready-file'],{schema:owner.schema,workspaceId:owner.workspaceId,
        directory:owner.directory,origin:owner.origin,url:owner.url,token:owner.token,
        fieldWorkspaceUrl:owner.fieldWorkspaceUrl,commissioningUrl:owner.commissioningUrl});
      output({schema:owner.schema,workspaceId:owner.workspaceId,origin:owner.origin,privateReadyFile:receipt.path});
      await stop;
    } finally {
      process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);
      try{await owner.close();}finally{await retireReady(receipt);}
    }
    return;
  }
  const method=methods.get(options.command),input=options.input?await jsonFile(options.input):{};
  if(method!=='state'&&!input.requestId)throw fault('CENTRAL_WAREHOUSE_REQUEST_ID','Save the complete action and requestId in the original input file.');
  if(input.requestId)process.stderr.write(JSON.stringify({method,requestId:input.requestId,inputSha256:digest(JSON.stringify(input))})+'\n');
  let owner=null,remote=null;
  try {
    let result;
    if(options['operator-file']) {
      remote=await remoteClient(options['operator-file']);
      result=await remote(method==='state'?'/api/warehouse/state':'/api/warehouse/'+method,method==='state'?undefined:input);
    } else {
      if(!options.workspace)throw fault('CENTRAL_WAREHOUSE_WORKSPACE','Choose the original workspace or private listener.');
      owner=await openCentralWarehouse({directory:options.workspace,profiles:await profilesFile(options.profiles),
        connection:await connectionFile(options.connection)});
      result=await owner.warehouse[method](input);
    }
    output(result);return result;
  }finally{remote?.close?.();await owner?.close();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  runCentralWarehouseCli().catch(error=>{process.stderr.write(JSON.stringify({code:error.code??'CENTRAL_WAREHOUSE_CLI',
    message:error.message,...(error.details?{details:error.details}:{})})+'\n');process.exitCode=1;});
