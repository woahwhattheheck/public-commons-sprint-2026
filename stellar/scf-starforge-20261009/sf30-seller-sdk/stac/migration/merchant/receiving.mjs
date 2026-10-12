// SPDX-License-Identifier: MIT
// Original merchant retained-file transport and original native GIS receiving.
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { MigrationWorkspaceClient, migrationFailure, migrationIdentifier, migrationSha256,
  migrationPrivateDirectory, retainMigrationBytes, openMigrationFile,
  readMigrationWorkspaceConfiguration, validateMigrationWorkspaceConfiguration,
  parseMigrationExportManifest, parseExactJSON, stringifyExactJSON } from './client.mjs';
import { MIGRATION_CONNECTION_SCHEMA, MIGRATION_EXPORT_MANIFEST, MIGRATION_TOOL_PREFIX,
  MAX_MIGRATION_FILE_BYTES, MAX_MIGRATION_REQUEST_BYTES, migrationToolDefinitions } from './tools.mjs';

const SHA=/^[a-f0-9]{64}$/,ALIAS=/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const requireValue=(condition,code,message)=>{if(!condition)throw migrationFailure(code,message);};
const decode=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
const JSON_LIMIT=4*1024*1024;
async function originalBytes(path,expected={},maximum=JSON_LIMIT){
  const file=await openMigrationFile(path,expected);
  try{
    requireValue(file.bytes<=maximum,'INPUT_TOO_LARGE','The complete original document exceeds its selected byte limit.');
    const bytes=Buffer.alloc(file.bytes);let offset=0;
    while(offset<bytes.length){
      const chunk=await file.readonlyFileHandle.read(bytes,offset,bytes.length-offset,offset);
      requireValue(chunk.bytesRead>0,'FILE_CHANGED','The original document ended during reading.');offset+=chunk.bytesRead;
    }
    requireValue(migrationSha256(bytes)===file.sha256,'FILE_CHANGED','The original document changed during reading.');
    return bytes;
  }finally{await file.readonlyFileHandle.close();}
}
function binding(options){
  requireValue(plain(options)&&ALIAS.test(options.workspace??''),'WORKSPACE_ALIAS','Select the original merchant workspace alias.');
  const workspaceId=migrationIdentifier(options.workspaceId,'workspace ID');
  requireValue(Boolean(options.merchant)!==Boolean(options.url),'CONNECTION_REQUIRED','Select one existing merchant object or its original MCP URL.');
  if(options.merchant)requireValue(typeof options.merchant.call==='function'&&typeof options.endpoint==='string'&&
    options.endpoint.trim()&&options.endpoint.length<=3000&&!/[\0\r\n]/.test(options.endpoint),
    'CONNECTION_REQUIRED','Give the borrowed original merchant its stable, non-secret endpoint identity.');
  return {workspace:options.workspace,workspaceId};
}
function unwrapped(value){
  if(value?.isError){
    const body=value.structuredContent;
    const error=new Error(body?.reason??body?.message??'The original migration merchant operation failed.');
    error.code=/^[A-Z][A-Z0-9_]+$/.test(body?.code??'')?body.code:'MIGRATION_TOOL_FAILED';
    throw error;
  }
  const result=value?.structuredContent??value;
  requireValue(plain(result),'REPLY_INVALID','Keep the complete original structured merchant reply.');
  return result;
}

/** Borrow the caller's merchant; its original owner keeps start/close authority. */
export async function createMigrationMerchantClient(options){
  const selected=binding(options);
  const transport=options.merchant?{endpoint:options.endpoint,call:options.merchant.call.bind(options.merchant)}:
    await (await import('../../../../../../stellar-forge/mcp-merchant-operator/retained-download.mjs')).openMerchantFileClient({
      url:options.url,tokenEnv:options.tokenEnv,environment:options.environment,signal:options.signal,
      errorPrefix:'MIGRATION',clientName:'starforge-migration-workspace',maximumResponseBytes:16*1024*1024});
  const endpoint=transport.endpoint+'|migration:'+selected.workspace+':'+selected.workspaceId;
  async function call(action,args={},requestOptions={}){
    requireValue(typeof action==='string','TOOL_NOT_FOUND','Select an original declared migration operation.');
    const name=action.startsWith(MIGRATION_TOOL_PREFIX)?action:MIGRATION_TOOL_PREFIX+action;
    requireValue(migrationToolDefinitions.some(item=>item.name===name),'TOOL_NOT_FOUND','Select an original declared migration operation.');
    requireValue(plain(args)&&(!Object.hasOwn(args,'workspace')||args.workspace===selected.workspace),
      'WORKSPACE_CHANGED','Keep this client attached to its original workspace.');
    const chosen=requestOptions.requestSignal??requestOptions.signal;
    const requestSignal=requestOptions.requestSignal===null?null:
      chosen&&options.signal?AbortSignal.any([chosen,options.signal]):chosen??options.signal;
    requestSignal?.throwIfAborted();
    const value=unwrapped(await transport.call(name,{...args,workspace:selected.workspace},
      {...requestOptions,requestSignal}));
    if(value.workspaceId!==undefined&&name!==MIGRATION_TOOL_PREFIX+'receive')
      requireValue(value.workspaceId===selected.workspaceId,'WORKSPACE_CHANGED','The original merchant alias now names another workspace.');
    return value;
  }
  const current=await call('status'),row=current.workspaces?.find(item=>item.workspace===selected.workspace);
  requireValue(row?.workspaceId===selected.workspaceId,'WORKSPACE_CHANGED','The original configured workspace identity differs.');
  let downloader;
  async function retained(){
    if(!downloader){
      const {createRetainedDownload}=await import('../../../../../../stellar-forge/mcp-merchant-operator/retained-download.mjs');
      downloader=createRetainedDownload({
        manifestName:MIGRATION_EXPORT_MANIFEST,maximumBytes:MAX_MIGRATION_FILE_BYTES,
        stateSchema:'starforge.migration-retained-download.v1',resultSchema:'starforge.migration-downloaded-export.v1',
        toolPrefix:'merchant_migration_export',errorPrefix:'MIGRATION',clientName:'starforge-migration-workspace',
        validateExportId:id=>migrationIdentifier(id,'export ID'),
        parseManifest:(bytes,id)=>{
          const value=parseMigrationExportManifest(bytes,id);
          requireValue(value.workspaceId===selected.workspaceId,'WORKSPACE_CHANGED','The export must retain this original workspace identity.');
          return value;
        },
        describe:manifest=>({workspaceId:manifest.workspaceId,revision:manifest.revision,requestId:manifest.requestId})
      });
    }
    return downloader;
  }
  const originalFileClient=signal=>({endpoint,call:(name,args,options={})=>call(name,args,
    {...options,requestSignal:options.requestSignal===null?null:options.requestSignal??signal})});
  return Object.freeze({
    ...selected,endpoint,call,
    async inspectExport({exportId,signal}={}){
      signal?.throwIfAborted();return (await retained()).inspect({client:originalFileClient(signal),exportId,signal});
    },
    async downloadExport({exportId,directory,expectedManifestSha256,chunkSize,onProgress,signal}={}){
      return (await retained()).download({client:originalFileClient(signal),exportId,directory,expectedManifestSha256,
        chunkSize,onProgress,signal});
    },
    async downloadTaskFile({requestId,kind='result',directory,chunkSize,onProgress,signal}={}){
      migrationIdentifier(requestId);
      requireValue(['result','log'].includes(kind),'FILE_NOT_DECLARED','Choose the original task result or completed native log.');
      const manifestName='migration-task.json';
      let savedRaw;
      for(const name of [join(directory,manifestName),join(directory,'download-state',manifestName)]){
        try{const current=await originalBytes(name,{},65000);
          requireValue(!savedRaw||savedRaw.equals(current),'FILE_CHANGED','The retained task selection changed.');savedRaw=current;
        }catch(error){if(error.code!=='ENOENT')throw error;}
      }
      let manifest,raw;
      if(savedRaw){
        manifest=parseExactJSON(decode(savedRaw));raw=savedRaw;
        requireValue(manifest.schema==='starforge.migration-task-file.v1'&&manifest.workspaceId===selected.workspaceId&&
          manifest.requestId===requestId&&manifest.kind===kind,'FILE_CHANGED','Resume the same original task and file selection.');
      }else{
        const task=await call('task',{requestId},{signal}),file=kind==='log'?task.logFile:task.resultFile;
        const identity={schema:'starforge.migration-task-file.v1',workspaceId:selected.workspaceId,requestId,
          command:task.command,attempt:task.attempt,kind,files:[file]};
        const exportId='task-'+migrationSha256(Buffer.from(JSON.stringify(identity)));
        manifest={...identity,exportId};raw=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
      }
      const {exportId,files:filesSelected,...identityFields}=manifest;
      const file=filesSelected?.[0],attempt=manifest.attempt;
      requireValue(Array.isArray(filesSelected)&&filesSelected.length===1&&file&&
        file.name===(kind==='log'?'native.log':'result.json')&&Number.isSafeInteger(file.bytes)&&file.bytes>=0&&
        file.bytes<=MAX_MIGRATION_FILE_BYTES&&SHA.test(file.sha256)&&Number.isSafeInteger(attempt)&&attempt>=1,
        'FILE_NOT_READY','The original task has no completed selected file yet.');
      const identity={...identityFields,files:filesSelected};
      requireValue(exportId==='task-'+migrationSha256(Buffer.from(JSON.stringify(identity))),
        'FILE_CHANGED','Keep the complete original task-file identity.');
      const manifestSha256=migrationSha256(raw);
      const {createRetainedDownload}=await import('../../../../../../stellar-forge/mcp-merchant-operator/retained-download.mjs');
      const receiving=createRetainedDownload({manifestName,maximumBytes:MAX_MIGRATION_FILE_BYTES,
        stateSchema:'starforge.migration-task-download-state.v1',resultSchema:'starforge.migration-downloaded-task.v1',
        toolPrefix:'original_migration_task',errorPrefix:'MIGRATION',clientName:'starforge-migration-task-file',
        validateExportId:id=>requireValue(id===exportId,'FILE_CHANGED','Keep the original task file identity.'),
        parseManifest:bytes=>{
          requireValue(migrationSha256(bytes)===manifestSha256,'FILE_CHANGED','Keep the original task and exact file descriptor.');
          return manifest;
        },describe:()=>({workspaceId:selected.workspaceId,requestId,kind})});
      const adapter={endpoint:endpoint+'|task:'+exportId,call:async(name,args,requestOptions={})=>{
        requireValue(args.exportId===exportId,'FILE_CHANGED','Keep the original selected task file.');
        if(name==='original_migration_task_manifest')return {state:'MANIFEST_RETAINED',exportId,
          manifestFile:{name:manifestName,bytes:raw.length,sha256:manifestSha256}};
        if(name==='original_migration_task_file_release')
          return call('task_file_release',{requestId,kind,attempt,readId:args.readId},requestOptions);
        requireValue(name==='original_migration_task_file'&&args.expectedManifestSha256===manifestSha256,
          'FILE_CHANGED','Read the original task file against its retained selection.');
        if(args.file===manifestName){
          requireValue(args.expectedSha256===manifestSha256,'FILE_CHANGED','Keep the exact local task-selection manifest.');
          const offset=args.offset??0,part=raw.subarray(offset,offset+args.limit);
          return {exportId,manifestSha256,readId:args.readId??randomUUID(),file:{name:manifestName,
            bytes:raw.length,sha256:manifestSha256,contentType:'application/json'},offset,bytesRead:part.length,
            nextOffset:offset+part.length<raw.length?offset+part.length:null,encoding:'base64',data:part.toString('base64')};
        }
        requireValue(args.file===file.name&&args.expectedSha256===file.sha256,'FILE_CHANGED','Select this task’s exact completed original file.');
        const result=await call('task_file',{requestId,kind,attempt,expectedSha256:file.sha256,
          ...(args.readId?{readId:args.readId}:{}),offset:args.offset,limit:args.limit},
          {...requestOptions,requestSignal:requestOptions.requestSignal===null?null:requestOptions.requestSignal??signal});
        return {...result,exportId,manifestSha256};
      }};
      return receiving.download({client:adapter,exportId,directory,expectedManifestSha256:manifestSha256,
        chunkSize,onProgress,signal});
    }
  });
}
export async function inspectMigrationExport(options){
  return (await createMigrationMerchantClient(options)).inspectExport(options);
}
export async function downloadMigrationTaskFile(options){
  return (await createMigrationMerchantClient(options)).downloadTaskFile(options);
}
export async function downloadMigrationExport(options){
  return (await createMigrationMerchantClient(options)).downloadExport(options);
}

/** Read a completed download using exact files; never contact or recapture a source. */
export async function inspectReceivedMigrationExport({directory,exportId,expectedManifestSha256,signal}={}){
  signal?.throwIfAborted();
  const root=await migrationPrivateDirectory(directory);
  const raw=await originalBytes(join(root,MIGRATION_EXPORT_MANIFEST),{},65000);
  const candidate=parseExactJSON(decode(raw));
  const manifest=parseMigrationExportManifest(raw,exportId??candidate.exportId);
  const manifestSha256=migrationSha256(raw);
  requireValue(expectedManifestSha256===undefined||SHA.test(expectedManifestSha256)&&
    manifestSha256===expectedManifestSha256,'EXPORT_CHANGED','The received original manifest differs from the selected handover.');
  const file=manifest.files[0];
  signal?.throwIfAborted();
  const original=await openMigrationFile(join(root,file.name),file,file.name);
  await original.readonlyFileHandle.close();
  return {schema:'starforge.migration-received-export.v1',state:'VERIFIED',directory:root,
    manifest,manifestSha256,archive:{path:join(root,file.name),bytes:file.bytes,sha256:file.sha256}};
}
function receiverConfiguration(options,manifest){
  requireValue(typeof options.destination==='string'&&options.destination&&typeof options.runtimeDirectory==='string'&&
    options.runtimeDirectory&&typeof options.python==='string'&&options.python,'CONNECTION_REQUIRED',
    'Select the original receiving directory, external request directory and actual QGIS Python.');
  const value=validateMigrationWorkspaceConfiguration({schema:MIGRATION_CONNECTION_SCHEMA,
    workspaces:{receiver:{workspaceId:manifest.workspaceId,directory:options.destination,
      runtimeDirectory:options.runtimeDirectory,python:options.python,pythonPath:options.pythonPath??[],
      environment:options.nativeEnvironment??{},inlineResultBytes:4*1024*1024,inputs:{},destinations:{}}}});
  return value.workspaces.receiver;
}
function complete(result,label){
  if(result?.state!=='COMPLETE')throw migrationFailure('NATIVE_INCOMPLETE',
    label+' did not complete; retain and resume its original task/result.',{task:result});
  return result;
}

/** The original Python receiver installs, verifies and natively reopens the full ZIP. */
export async function receiveMigrationExport(options){
  const selected=await inspectReceivedMigrationExport(options);
  const requestId=migrationIdentifier(options.requestId,'receiving request ID');
  const nativeReopen=options.nativeReopen??'required';
  requireValue(['auto','required','skip'].includes(nativeReopen),'NATIVE_MODE_REQUIRED','Select an original receiving mode.');
  const configuration=receiverConfiguration(options,selected.manifest);
  const root=await migrationPrivateDirectory(configuration.runtimeDirectory,{create:true});
  const logical={schema:'starforge.migration-consumer-request.v1',requestId,exportId:selected.manifest.exportId,
    workspaceId:selected.manifest.workspaceId,revision:selected.manifest.revision,manifestSha256:selected.manifestSha256,
    archive:{bytes:selected.archive.bytes,sha256:selected.archive.sha256},nativeReopen};
  const operationDirectory=await migrationPrivateDirectory(join(root,'consumer-'+migrationSha256(Buffer.from(requestId))),{create:true});
  await retainMigrationBytes(join(operationDirectory,'request.json'),Buffer.from(stringifyExactJSON(logical,2)+'\n'));
  const resultPath=join(operationDirectory,'result.json');
  const client=new MigrationWorkspaceClient(configuration,{environment:options.environment??process.env});
  try{
    const received=complete(await client.execute('receive',{archive:selected.archive.path,destination:configuration.directory,
      expectedSha256:selected.archive.sha256,expectedWorkspaceId:selected.manifest.workspaceId,nativeReopen},
      {requestId,wait:true,signal:options.signal}),'The original complete migration receiving');
    // State is read through the same original engine after its independent receive.
    const state=complete(await client.execute('state',{}, {requestId:'consumer-state-'+migrationSha256(Buffer.from(requestId)),signal:options.signal}),
      'The received original workspace state');
    requireValue(state.value?.id===selected.manifest.workspaceId,'WORKSPACE_CHANGED','The received workspace must preserve its original identity.');
    const verified=complete(await client.execute('verify',{}, {requestId:'consumer-verify-'+migrationSha256(Buffer.from(requestId)),signal:options.signal}),
      'The received original migration verification');
    const result={schema:'starforge.migration-consumer-receiving.v1',state:'COMPLETE',requestId,
      workspaceId:selected.manifest.workspaceId,exportId:selected.manifest.exportId,revision:selected.manifest.revision,
      manifestSha256:selected.manifestSha256,archive:{bytes:selected.archive.bytes,sha256:selected.archive.sha256},
      nativeReopen,receiving:received,workspace:state,verification:verified};
    await retainMigrationBytes(resultPath,Buffer.from(stringifyExactJSON(result,2)+'\n'));
    return {...result,locations:{directory:selected.directory,destination:configuration.directory,
      runtimeDirectory:root,result:resultPath}};
  }finally{await client.close();}
}

/** Attach this one source-owned family to the maintained merchant configuration. */
export async function initializeMigrationWorkspaceMerchant({directory,connection,name='Native GIS migration workspaces'}={}){
  requireValue(typeof directory==='string'&&directory&&typeof connection==='string'&&connection&&
    typeof name==='string'&&name.trim()&&name.length<=200&&!/[\0\r\n]/.test(name),
    'CONNECTION_REQUIRED','Select the original merchant directory, complete connection file and name.');
  const connectionPath=resolve(connection),selection=await readMigrationWorkspaceConfiguration(connectionPath);
  const root=await migrationPrivateDirectory(directory,{create:true});
  const configuration=join(root,'merchant-mcp.json');
  const desired={schema:'stellar-forge.merchant-mcp.v1',name,releaseStore:'./releases',
    exportsDirectory:'./customer-exports',sources:{},migrationWorkspaceConnection:connectionPath};
  const bytes=Buffer.from(JSON.stringify(desired,null,2)+'\n');
  try{
    const existing=await originalBytes(configuration);
    requireValue(existing.equals(bytes),'CONNECTION_CHANGED','Preserve the original merchant configuration at this directory.');
  }catch(error){if(error.code!=='ENOENT')throw error;}
  const {initReleaseStore}=await import('../../../../sf82-seller-pilot/releases.mjs');
  await initReleaseStore(join(root,'releases'),{resume:true});
  await migrationPrivateDirectory(join(root,'customer-exports'),{create:true});
  await retainMigrationBytes(configuration,bytes);
  const {readMerchantConfig}=await import('../../../../../../stellar-forge/mcp-merchant-operator/config.mjs');
  await readMerchantConfig(configuration);
  return {schema:desired.schema,state:'INITIALIZED',configuration,migrationWorkspacesConfigured:true,
    workspaces:Object.entries(selection.workspaces).map(([workspace,row])=>({workspace,workspaceId:row.workspaceId})),
    hostOwnership:'ORIGINAL_MIGRATION_WORKSPACE'};
}

const HELP=[
'Native GIS migration workspace and complete handover consumer',
'',
'starforge migration-workspace init --directory DIR --connection FILE [--name NAME]',
'starforge migration-workspace status|call|inspect-export|download|download-task|receive --merchant FILE|--url URL --workspace ALIAS --workspace-id ID ...',
'starforge migration-workspace call --command ACTION --payload FILE ...',
'starforge migration-workspace inspect-export --export-id ID ...',
'starforge migration-workspace download --export-id ID --directory DIR [--expected-manifest-sha256 SHA] ...',
'starforge migration-workspace download-task --request-id ID --kind result|log --directory DIR ...',
'starforge migration-workspace receive --export-id ID --directory DIR --destination DIR --runtime DIR --python QGIS_PYTHON --request-id ID ...',
'starforge migration-workspace inspect-received --directory DIR [--export-id ID] [--expected-manifest-sha256 SHA]',
'starforge migration-workspace receive-local --directory DIR --destination DIR --runtime DIR --python QGIS_PYTHON --request-id ID',
'',
'Native runtime options: repeat --python-path DIR; --native-reopen required|auto|skip (default required).',
'Transport options: --token-env NAME (default MCP_ACCESS_TOKEN), --chunk-size 1..196608.',
'Original host options: --endpoint ID for an explicit stable native merchant identity.',
'The host owns actual source/output paths. These CLI paths belong to the local receiving operator.',
'Same request, export and directory resume original files and native tasks. Different reviewed input needs its own original request.',
'Exact plans/specs are JSON strings in planJson/specJson; resultJson contains the original full numeric tokens.',
'Native failures retain task/result/log identities. Call task, task_file or cancel through the original host.',
].join('\n');
function parseArguments(argv){
  const options={},position=[];const repeated=new Set(['python-path']);
  const allowed=new Set(['directory','connection','name','merchant','url','workspace','workspace-id','endpoint',
    'command','payload','export-id','kind','destination','runtime','python','python-path','request-id','expected-manifest-sha256',
    'native-reopen','token-env','chunk-size']);
  for(let i=0;i<argv.length;i++){
    const item=argv[i];
    if(item==='--help'||item==='-h'){options.help=true;continue;}
    if(!item.startsWith('--')){position.push(item);continue;}
    const key=item.slice(2);
    requireValue(allowed.has(key)&&i+1<argv.length&&!argv[i+1].startsWith('--'),
      'CLI_ARGUMENTS','Use a declared flag and its complete value: '+item+'.');
    const value=argv[++i];
    requireValue(repeated.has(key)||options[key]===undefined,'CLI_ARGUMENTS','Give each original option once: '+item+'.');
    if(repeated.has(key))(options[key]??=[]).push(value);else options[key]=value;
  }
  requireValue(position.length<=1,'CLI_ARGUMENTS','Select one complete native command.');
  return {command:position[0]??'help',options};
}
export async function runMigrationWorkspaceCli(argv=process.argv.slice(2),{stdout=process.stdout,stderr=process.stderr,environment=process.env}={}){
  const parsed=parseArguments(argv),o=parsed.options,command=parsed.command;
  if(o.help||command==='help'){stdout.write(HELP+'\n');return 0;}
  const get=(key)=>{requireValue(typeof o[key]==='string'&&o[key],'CLI_ARGUMENTS','Supply --'+key+'.');return o[key];};
  const controller=new AbortController();
  const stop=()=>controller.abort(migrationFailure('CANCELLED','The original CLI operation was interrupted.'));
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  let merchant,result;
  try{
    if(command==='init')result=await initializeMigrationWorkspaceMerchant({
      directory:get('directory'),connection:get('connection'),...(o.name?{name:o.name}:{})});
    else if(command==='inspect-received')result=await inspectReceivedMigrationExport({
      directory:get('directory'),exportId:o['export-id'],expectedManifestSha256:o['expected-manifest-sha256'],signal:controller.signal});
    else{
      requireValue(['status','call','inspect-export','download','download-task','receive','receive-local'].includes(command),
        'CLI_ARGUMENTS','Choose an original migration workspace command.');
      const receiving=command==='receive'||command==='receive-local';
      const local=command==='receive-local';
      const directory=['download','download-task','receive','receive-local'].includes(command)?get('directory'):undefined;
      const receiver=receiving?{directory,destination:get('destination'),runtimeDirectory:get('runtime'),
        python:get('python'),pythonPath:o['python-path']??[],requestId:get('request-id'),
        nativeReopen:o['native-reopen']??'required',environment,signal:controller.signal}:null;
      if(receiver){
        migrationIdentifier(receiver.requestId,'receiving request ID');
        requireValue(['auto','required','skip'].includes(receiver.nativeReopen),'CLI_ARGUMENTS','Choose the original native receiving mode.');
      }
      if(local)result=await receiveMigrationExport({...receiver,exportId:o['export-id'],
        expectedManifestSha256:o['expected-manifest-sha256']});
      else{
        // Complete binding validation precedes acquisition of the original host.
        const workspace=get('workspace'),workspaceId=get('workspace-id');
        requireValue(ALIAS.test(workspace),'WORKSPACE_ALIAS','Select an original workspace alias.');
        migrationIdentifier(workspaceId,'workspace ID');
        requireValue(Boolean(o.merchant)!==Boolean(o.url),'CLI_ARGUMENTS','Choose one --merchant FILE or --url URL.');
        const exportId=['inspect-export','download','receive'].includes(command)?get('export-id'):undefined;
        if(exportId)migrationIdentifier(exportId,'export ID');
        const chunkSize=o['chunk-size']===undefined?undefined:Number(o['chunk-size']);
        if(chunkSize!==undefined)requireValue(Number.isSafeInteger(chunkSize)&&chunkSize>=1&&chunkSize<=196608,
          'CLI_ARGUMENTS','Choose --chunk-size from 1 to 196608.');
        const taskId=command==='download-task'?get('request-id'):undefined;
        if(taskId)migrationIdentifier(taskId);
        const taskKind=o.kind??'result';
        if(command==='download-task')requireValue(['result','log'].includes(taskKind),'CLI_ARGUMENTS','Choose --kind result or log.');
        const action=command==='call'?get('command'):null;
        const payload=command==='call'?parseExactJSON(decode(await originalBytes(get('payload'),{},MAX_MIGRATION_REQUEST_BYTES))):null;
         requireValue(!o.merchant||payload?.wait!==false,'CLI_ASYNC_HOST_REQUIRED',
           'Use the running merchant URL for an asynchronous task, or await this private native host’s complete call.');
        let endpoint=o.endpoint;
        if(o.merchant){
          const configPath=resolve(o.merchant),original=await originalBytes(configPath);
          endpoint??='native:merchant-config:'+migrationSha256(original);
          const {openMerchantOperator}=await import('../../../../../../stellar-forge/mcp-merchant-operator/operator.mjs');
          merchant=await openMerchantOperator(configPath,{environment});
        }
        const client=await createMigrationMerchantClient({merchant,url:o.url,endpoint,workspace,workspaceId,
          tokenEnv:o['token-env'],environment,signal:controller.signal});
        if(command==='status')result=await client.call('status');
        if(command==='call')result=await client.call(action,payload);
        if(command==='inspect-export')result=await client.inspectExport({exportId,signal:controller.signal});
        if(command==='download-task')result=await client.downloadTaskFile({requestId:taskId,kind:taskKind,directory,
          chunkSize,signal:controller.signal,onProgress:value=>stderr.write(JSON.stringify(value)+'\n')});
        if(command==='download'||command==='receive'){
          const downloaded=await client.downloadExport({exportId,directory,chunkSize,
            expectedManifestSha256:o['expected-manifest-sha256'],signal:controller.signal,
            onProgress:value=>stderr.write(JSON.stringify(value)+'\n')});
          result=command==='download'?downloaded:{download:downloaded,
            receiving:await receiveMigrationExport({...receiver,exportId,expectedManifestSha256:downloaded.manifestSha256})};
        }
      }
    }
    stdout.write(stringifyExactJSON(result,2)+'\n');return ['FAILED','CANCELLED','INTERRUPTED'].includes(result?.state)?2:0;
  }finally{
    process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
    await merchant?.close();
  }
}
export const main=runMigrationWorkspaceCli;
export default runMigrationWorkspaceCli;
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  runMigrationWorkspaceCli().then(code=>{process.exitCode=code;},error=>{
    process.stderr.write(JSON.stringify({state:'FAILED',code:error.code??'MIGRATION_CLI_FAILED',message:error.message})+'\n');
    process.exitCode=1;
  });
}
