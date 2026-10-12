// MIT. Original OpenFema MCP client and complete retained-file receiver.
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { ACTIONS as NATIVE_ACTIONS } from './schema.mjs';
import { pathToFileURL } from 'node:url';
import { openMerchantFileClient, createRetainedDownload } from '../../../../stellar-forge/mcp-merchant-operator/retained-download.mjs';
import { openFemaWorkspaceTools, OPENFEMA_OPERATION_PATTERN } from './mcp-protocol.mjs';

const PREFIX='merchant_openfema_';
const MANIFEST='openfema-transfer.json';
const SCHEMA='stellar-forge.openfema-file-transfer.v1';
const MAXIMUM=1024 * 1024 * 1024;
const SHA=/^[a-f0-9]{64}$/;
const ALIAS=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=(code,message)=>Object.assign(new Error(message),{code:'OPENFEMA_TRANSFER_'+code});
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const names=new Set(openFemaWorkspaceTools(name=>name));
const ACTIONS=Object.keys(NATIVE_ACTIONS);
function alias(value){if(typeof value!=='string'||!ALIAS.test(value))throw fail('CONFIGURATION','Choose a host-declared workspace alias.');return value;}
function accepted(value){
  if(!plain(value)||value.ok!==true)throw Object.assign(fail('ORIGINAL_REJECTED',value?.native?.message??'Inspect the original workspace response before continuing.'),{original:value});
  return value;
}
export async function openOpenFemaClient({workspace,...options}={}){
  alias(workspace);
  const client=await openMerchantFileClient({maximumResponseBytes:64*1024*1024,...options,errorPrefix:'OPENFEMA_TRANSFER',clientName:'starforge-openfema-client'});
  return {workspace,endpoint:client.endpoint,
    async call(name,args={},callOptions){
      if(typeof name!=='string')throw fail('TOOL','Choose a named original OpenFEMA tool.');
      if(!name.startsWith(PREFIX))name=PREFIX+name;
      if(!names.has(name))throw fail('TOOL','Choose an advertised original OPENFEMA tool.');
      if(!plain(args)||Object.hasOwn(args,'workspace'))throw fail('CONFIGURATION','The client already binds the selected workspace.');
      return client.call(name,name===PREFIX+'workspaces'?args:{workspace,...args},callOptions?{...callOptions,requestSignal:callOptions.signal??callOptions.requestSignal}:undefined);
    },
    async action(action,payload,{operationId,expectedRevision,signal,timeoutMs}={}){
      if(!ACTIONS.includes(action)||!plain(payload))throw fail('CONFIGURATION','Supply an original action and complete payload.');
      const name=PREFIX+action.replaceAll('.','_');
      if(!names.has(name)||!OPENFEMA_OPERATION_PATTERN.test(operationId??'')||!Number.isSafeInteger(expectedRevision)||expectedRevision<0||
          ['workspace','operationId','expectedRevision'].some(key=>Object.hasOwn(payload,key)))
        throw fail('CONFIGURATION','Retain the original action payload, operationId and expectedRevision before calling.');
      return client.call(name,{workspace,operationId,expectedRevision,...payload},{requestSignal:signal,...(timeoutMs===undefined?{}:{timeoutMs})});
    }};
}
function parse(bytes,exportId){
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw fail('MANIFEST','The saved transfer index is not valid UTF-8 JSON.');}
  if(!plain(value)||value.schema!==SCHEMA||value.exportId!==exportId||!ALIAS.test(value.workspace??'')||!UUID.test(value.workspaceId??'')||
      !['source','portfolio','export','receipt'].includes(value.kind)||typeof value.id!=='string'||!Array.isArray(value.files)||value.files.length<1)
    throw fail('MANIFEST','Use a complete original OPENFEMA transfer index.');
  const names=new Set();let total=0;
  for(const file of value.files){
    if(!plain(file)||typeof file.name!=='string'||!file.name||file.name===MANIFEST||file.name==='download-state'||
        (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(file.name))||names.has(file.name)||typeof file.originalName!=='string'||
        !Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>MAXIMUM||!SHA.test(file.sha256??'')||
        !plain(file.selection)||file.selection.kind!==value.kind||file.selection.id!==value.id||file.selection.file!==file.originalName||file.name!==file.originalName)
      throw fail('MANIFEST','The transfer index has an invalid or duplicate original file selection.');
    names.add(file.name);total+=file.bytes;
  }
  if(total>MAXIMUM)throw fail('CAPACITY','The selected transfer exceeds the declared one-GiB retained-file download budget.');
  return value;
}
async function selected(options){
  const {workspace,kind,id,file,expectedWorkspaceId}=options;
  if(!['source','portfolio','export','receipt'].includes(kind)||typeof id!=='string'||
    file!==undefined&&(typeof file!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(file)))
    throw fail('CONFIGURATION','Select an original source, portfolio, export or customer receipt and optional exact filename.');
  const client=await openOpenFemaClient(options),response=accepted(await client.call('files',{kind,id}));
  if(expectedWorkspaceId!==undefined&&response.workspaceId!==expectedWorkspaceId)
    throw fail('IDENTITY_CHANGED','The original running workspace differs from the selected UUID.');
  let files=response.native.files;
  if(!Array.isArray(files))throw fail('MANIFEST','The original workspace did not return its file manifest.');
  if(file!==undefined)files=files.filter(item=>item.name===file);
  if(!files.length)throw fail('SELECTION','Select a retained original file from the complete source manifest.');
  files=files.map(item=>({...item,originalName:item.name}));
  const identity={workspace,workspaceId:response.workspaceId,kind,id,...(file===undefined?{}:{file}),files};
  const exportId='openfema-transfer-'+hash(Buffer.from(JSON.stringify(identity))).slice(0,24);
  const manifest={schema:SCHEMA,exportId,...identity,
    ...(response.native.dataset?{dataset:response.native.dataset,intentIds:response.native.intentIds,
      originalManifestSha256:response.native.manifestSha256,mode:response.native.mode}:{}),
    provenance:'Original workspace file bytes and SHA256 are preserved. The index binds the exact selected files to their receiving names.'};
  const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
  if(bytes.length>65000)throw fail('INDEX_LIMIT','Select a named original file or use the complete native source.export bundle; this retained transfer index exceeds 65 KB.');
  parse(bytes,exportId);
  return {client,manifest,bytes,sha256:hash(bytes)};
}
function receiver(selection){
  const {client,manifest,bytes,sha256}=selection;
  const transport={
    // The authenticated workspace survives a listener restart and port change.
    endpoint:"openfema-workspace:"+manifest.workspaceId,
    async call(name,args,options){
      if(args.exportId!==manifest.exportId)throw fail('IDENTITY_CHANGED','Keep the same selected transfer identity.');
      if(name==='openfema_transfer_manifest')return {state:'MANIFEST_RETAINED',exportId:manifest.exportId,
        manifestFile:{name:MANIFEST,bytes:bytes.length,sha256}};
      if(name==='openfema_transfer_file_release')return client.call('file_release',{readId:args.readId},options);
      if(name!=='openfema_transfer_file'||args.expectedManifestSha256!==sha256)
        throw fail('IDENTITY_CHANGED','Keep the same selected transfer index SHA256.');
      if(args.file===MANIFEST){
        if(args.expectedSha256!==sha256||args.offset||args.readId)throw fail('IDENTITY_CHANGED','Use the complete selected transfer index.');
        return {exportId:manifest.exportId,manifestSha256:sha256,readId:randomUUID(),
          file:{name:MANIFEST,contentType:'application/json',bytes:bytes.length,sha256},
          offset:0,bytesRead:bytes.length,nextOffset:null,encoding:'base64',data:bytes.toString('base64')};
      }
      const file=manifest.files.find(file=>file.name===args.file);
      if(!file||file.sha256!==args.expectedSha256)throw fail('SELECTION','Keep the exact original file and SHA256 from the transfer index.');
      let result;
      try{
        result=accepted(await client.call('file_read',{...file.selection,expectedSha256:args.expectedSha256,
          offset:args.offset??0,limit:args.limit,...(args.readId?{readId:args.readId}:{})},options)).native;
      }catch(error){
        if(error.code==='OPENFEMA_MCP_FILE_READ_NOT_FOUND')throw fail('READ_NOT_FOUND','The original temporary read expired; resume this same original file hash.');
        throw error;
      }
      if(result.file?.name!==file.originalName)throw fail('FILE_CHANGED','The original file name differs from the selected transfer.');
      return {...result,exportId:manifest.exportId,manifestSha256:sha256,file:{...result.file,name:file.name}};
    }
  };
  return createRetainedDownload({
    manifestName:MANIFEST,parseManifest:parse,maximumBytes:MAXIMUM,
    stateSchema:'stellar-forge.openfema-download-state.v1',
    resultSchema:'stellar-forge.openfema-download-result.v1',
    toolPrefix:'openfema_transfer',errorPrefix:'OPENFEMA_TRANSFER',clientName:'starforge-openfema-receiver',
    describe:value=>({workspace:value.workspace,workspaceId:value.workspaceId,kind:value.kind,id:value.id}),
    connect:async()=>transport
  });
}
export async function inspectOpenFemaFiles(options={}){
  const value=await selected(options);
  return {manifest:value.manifest,manifestSha256:value.sha256};
}
export async function downloadOpenFemaFiles(options={}){
  const selection=await selected(options),owner=receiver(selection);
  if(options.expectedManifestSha256!==undefined&&
    (!SHA.test(options.expectedManifestSha256)||options.expectedManifestSha256!==selection.sha256))
    throw fail('MANIFEST_CHANGED','The selected original transfer differs from the retained manifest SHA256.');
  return owner.download({...options,exportId:selection.manifest.exportId});
}
export async function reopenOpenFemaFiles({directory,expectedManifestSha256}={}){
  const owner=createRetainedDownload({manifestName:MANIFEST,parseManifest:parse,maximumBytes:MAXIMUM,
    stateSchema:'stellar-forge.openfema-download-state.v1',resultSchema:'stellar-forge.openfema-download-result.v1',
    toolPrefix:'openfema_transfer',errorPrefix:'OPENFEMA_TRANSFER'});
  return owner.lockedDownload(directory,async context=>{
    const bytes=await owner.bytesAt(resolve(context.root,MANIFEST),65000),value=JSON.parse(bytes.toString('utf8')),digest=hash(bytes);
    const manifest=parse(bytes,value.exportId);
    if(expectedManifestSha256!==undefined&&(!SHA.test(expectedManifestSha256)||expectedManifestSha256!==digest))
      throw fail('MANIFEST_CHANGED','The saved transfer differs from the reviewed index SHA256.');
    for(const file of manifest.files)await owner.verifiedFile(resolve(context.root,file.name),file);
    return {schema:'stellar-forge.openfema-reopened.v1',state:'COMPLETE',directory:context.root,
      workspace:manifest.workspace,workspaceId:manifest.workspaceId,kind:manifest.kind,id:manifest.id,
      files:manifest.files.length,bytes:manifest.files.reduce((sum,file)=>sum+file.bytes,0),manifestSha256:digest};
  });
}

async function requestFile(path){
  const file=await open(resolve(path),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const stat=await file.stat();
    if(!stat.isFile()||stat.size>128*1024||process.platform!=='win32'&&((stat.mode&0o077)||stat.uid!==process.getuid()))
      throw fail('CONFIGURATION','Use an owned private regular JSON request file of at most128KiB.');
    const bytes=await file.readFile();
    if(bytes.length>128*1024)throw fail('CONFIGURATION','The selected request file grew beyond its limit.');
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(!plain(value))throw fail('CONFIGURATION','Use one original request object.');
    return value;
  }finally{await file.close();}
}
const HELP = "OpenFEMA merchant MCP client and complete-file receiver\n  tools --url MCP_URL --workspace ALIAS [--token-env MCP_ACCESS_TOKEN]\n  call --url MCP_URL --workspace ALIAS --request-file PRIVATE_JSON\n  action --url MCP_URL --workspace ALIAS --request-file PRIVATE_JSON\n  inspect --url MCP_URL --workspace ALIAS --kind source|portfolio|export|receipt --id ORIGINAL_ID\n          [--file EXACT_FILENAME] [--token-env MCP_ACCESS_TOKEN]\n  download --url MCP_URL --workspace ALIAS --kind source|portfolio|export|receipt --id ORIGINAL_ID\n           --out PRIVATE_DIRECTORY [--file EXACT_FILENAME]\n           [--token-env MCP_ACCESS_TOKEN] [--workspace-id ORIGINAL_UUID]\n           [--manifest-sha256 REVIEWED_SHA256] [--chunk-bytes 196608]\n  reopen --out PRIVATE_DIRECTORY [--manifest-sha256 REVIEWED_SHA256]\n\ncall reads {tool,args}. action reads {action,payload,operationId,expectedRevision}.\nKeep that exact request after uncertainty. source.import reads payload.sourcePackage,\na host-declared alias with the unchanged original bundle hash. The native engine\nvalidates every metadata, field and source-page response.\nAmount fields remain exact original decimal strings, including negative source\nadjustments. Portfolio revisions, source selections and analyst notes stay with\ntheir actual IDs. Complete files include every source response, retained\nportfolio JSON, report/export, source/workspace bundle and native customer files.\nDownload resumes in the same directory and verifies the whole original SHA256.\nReopen checks all completed bytes offline; it performs no provider or payment call.\nThe existing merchant token is read only from its selected environment variable.\n";
export async function main(args=process.argv.slice(2)){
  if(!args.length||args.length===1&&['--help','-h'].includes(args[0])){process.stdout.write(HELP);return;}
  const [command,...rest]=args;
  if(!['tools','call','action','inspect','download','reopen'].includes(command))
    throw fail('CONFIGURATION','Choose tools, call, action, inspect, download or reopen.');
  const common=['--url','--workspace','--token-env'];
  const allowed=new Set(command==='reopen'?['--out','--manifest-sha256']:
    ['tools','call','action'].includes(command)?[...common,...(command==='tools'?[]:['--request-file'])]:
    [...common,'--kind','--id','--file','--workspace-id','--manifest-sha256',...(command==='download'?['--out','--chunk-bytes']:[])]);
  const values={};
  for(let i=0;i<rest.length;i+=2){
    if(!allowed.has(rest[i])||Object.hasOwn(values,rest[i])||!rest[i+1]||rest[i+1].startsWith('--'))
      throw fail('CONFIGURATION','Use complete, unique declared options.');
    values[rest[i]]=rest[i+1];
  }
  const required=command==='reopen'?['--out']:['--url','--workspace',
    ...(['call','action'].includes(command)?['--request-file']:[]),
    ...(['inspect','download'].includes(command)?['--kind','--id']:[]),
    ...(command==='download'?['--out']:[])];
  for(const key of required)if(!values[key])throw fail('CONFIGURATION','Supply '+key+'.');
  for(const key of ['--chunk-bytes'])if(values[key]!==undefined&&!/^[0-9]{1,9}$/.test(values[key]))
    throw fail('CONFIGURATION','Use a whole nonnegative '+key+' value.');
  const controller=new AbortController(),stop=()=>controller.abort(fail('INTERRUPTED','Repeat the same operation or download with its retained original identity.'));
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    const options={url:values['--url'],workspace:values['--workspace'],kind:values['--kind'],id:values['--id'],
      directory:values['--out'],tokenEnv:values['--token-env'],expectedManifestSha256:values['--manifest-sha256'],
      expectedWorkspaceId:values['--workspace-id'],signal:controller.signal,
      ...(values['--file']===undefined?{}:{file:values['--file']}),
      ...(values['--chunk-bytes']===undefined?{}:{chunkSize:Number(values['--chunk-bytes'])}),
      onProgress:value=>process.stderr.write(JSON.stringify(value)+'\n')};
    let result;
    if(['tools','call','action'].includes(command)){
      const client=await openOpenFemaClient(options);
      if(command==='tools'){
        const schema=accepted(await client.call('schema'));
        result={workspace:options.workspace,workspaceId:schema.workspaceId,source:schema.native,
          tools:openFemaWorkspaceTools((name,description,properties,required,annotations)=>({name,description,
            inputSchema:{type:'object',properties,required,additionalProperties:false},annotations}))};
      }else{
        const request=await requestFile(values['--request-file']);
        if(command==='call'){
          if(Object.keys(request).some(k=>!['tool','args'].includes(k))||typeof request.tool!=='string'||!plain(request.args))
            throw fail('CONFIGURATION','Use a call request with tool and args.');
          result=await client.call(request.tool,request.args,{signal:controller.signal});
        }else{
          if(Object.keys(request).some(k=>!['action','payload','operationId','expectedRevision'].includes(k)))
            throw fail('CONFIGURATION','Use the original action, payload, operationId and expectedRevision.');
          result=await client.action(request.action,request.payload,{operationId:request.operationId,expectedRevision:request.expectedRevision,signal:controller.signal});
        }
      }
    }else result=command==='inspect'?await inspectOpenFemaFiles(options):
      command==='download'?await downloadOpenFemaFiles(options):await reopenOpenFemaFiles(options);
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    if(result?.ok===false)process.exitCode=2;
    return result;
  }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write((error.code??'OPENFEMA_TRANSFER_FAILED')+': '+error.message+'\n');process.exitCode=1;});
