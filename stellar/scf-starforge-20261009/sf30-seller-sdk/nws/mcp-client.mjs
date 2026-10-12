// MIT. Original Nws MCP client and complete retained-file receiver.
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { ACTIONS as NATIVE_ACTIONS } from './schema.mjs';
import { pathToFileURL } from 'node:url';
import { openMerchantFileClient, createRetainedDownload } from '../../../../stellar-forge/mcp-merchant-operator/retained-download.mjs';
import { nwsWorkspaceTools } from './mcp-protocol.mjs';

const PREFIX='merchant_nws_';
const MANIFEST='nws-transfer.json';
const SCHEMA='stellar-forge.nws-file-transfer.v1';
const MAXIMUM=256 * 1024 * 1024;
const SHA=/^[a-f0-9]{64}$/;
const ALIAS=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=(code,message)=>Object.assign(new Error(message),{code:'NWS_TRANSFER_'+code});
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const names=new Set(nwsWorkspaceTools(name=>name));
const ACTIONS=Object.keys(NATIVE_ACTIONS);
function alias(value){if(typeof value!=='string'||!ALIAS.test(value))throw fail('CONFIGURATION','Choose a host-declared workspace alias.');return value;}
function accepted(value){
  if(!plain(value)||value.ok!==true)throw Object.assign(fail('ORIGINAL_REJECTED',value?.native?.message??'Inspect the original workspace response before continuing.'),{original:value});
  return value;
}
export async function openNwsClient({workspace,...options}={}){
  alias(workspace);
  const client=await openMerchantFileClient({...options,errorPrefix:'NWS_TRANSFER',clientName:'starforge-nws-client'});
  return {workspace,endpoint:client.endpoint,
    async call(name,args={},callOptions){
      if(!name.startsWith(PREFIX))name=PREFIX+name;
      if(!names.has(name))throw fail('TOOL','Choose an advertised original NWS tool.');
      if(!plain(args)||Object.hasOwn(args,'workspace'))throw fail('CONFIGURATION','The client already binds the selected workspace.');
      return client.call(name,name===PREFIX+'workspaces'?args:{workspace,...args},callOptions);
    },
    async action(action,payload,{operationId,expectedRevision,signal}={}){
      if(!ACTIONS.includes(action)||!plain(payload))throw fail('CONFIGURATION','Supply an original action and complete payload.');
      const name=PREFIX+action.replaceAll('.','_');
      if(!names.has(name)||!/^[A-Za-z0-9_-]{8,100}$/.test(operationId??'')||!Number.isSafeInteger(expectedRevision)||expectedRevision<0||
          ['workspace','operationId','expectedRevision'].some(key=>Object.hasOwn(payload,key)))
        throw fail('CONFIGURATION','Retain the original action payload, operationId and expectedRevision before calling.');
      return client.call(name,{workspace,operationId,expectedRevision,...payload},{signal});
    }};
}
function parse(bytes,exportId){
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw fail('MANIFEST','The saved transfer index is not valid UTF-8 JSON.');}
  if(!plain(value)||value.schema!==SCHEMA||value.exportId!==exportId||!ALIAS.test(value.workspace??'')||!UUID.test(value.workspaceId??'')||
      !['source','export','receipt'].includes(value.kind)||typeof value.id!=='string'||!Array.isArray(value.files)||value.files.length<1)
    throw fail('MANIFEST','Use a complete original NWS transfer index.');
  const names=new Set();let total=0;
  for(const file of value.files){
    if(!plain(file)||typeof file.name!=='string'||!file.name||file.name===MANIFEST||file.name==='download-state'||
        (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(file.name))||names.has(file.name)||typeof file.originalName!=='string'||
        !Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>MAXIMUM||!SHA.test(file.sha256??'')||
        !plain(file.selection)||file.selection.kind!==value.kind||file.selection.id!==value.id)
      throw fail('MANIFEST','The transfer index has an invalid or duplicate original file selection.');
    names.add(file.name);total+=file.bytes;
  }
  if(total>MAXIMUM)throw fail('CAPACITY','The selected transfer exceeds the maintained 256 MiB download budget.');
  return value;
}
async function selected(options){
  const {workspace,kind,id,page,wire,expectedWorkspaceId}=options;
  if(!['source','export','receipt'].includes(kind)||typeof id!=='string'||
      page!==undefined&&(kind!=='source'||!Number.isSafeInteger(page)||page<0)||
      wire!==undefined&&(kind!=='source'||typeof wire!=='boolean'))
    throw fail('CONFIGURATION','Select source, export or receipt with its original ID; page applies only to source.');
  const client=await openNwsClient(options),response=accepted(await client.call('files',{kind,id,...(wire===undefined?{}:{wire})}));
  if(expectedWorkspaceId!==undefined&&response.workspaceId!==expectedWorkspaceId)
    throw fail('IDENTITY_CHANGED','The original running workspace differs from the selected UUID.');
  let files=response.native.files;
  if(page!==undefined)files=files.filter(file=>file.selection.page===page);
  if(!files.length)throw fail('SELECTION','Select a retained original file or source page.');
  files=files.map(file=>({...file,originalName:file.name,
    name:kind==='source'?'page-'+String(file.selection.page).padStart(6,'0')+'-'+file.name:file.name}));
  const identity={workspace,workspaceId:response.workspaceId,kind,id,...(page===undefined?{}:{page}),...(wire===undefined?{}:{wire}),files};
  const exportId='nws-transfer-'+hash(Buffer.from(JSON.stringify(identity))).slice(0,24);
  const manifest={schema:SCHEMA,exportId,...identity,
    ...(response.native.dataset?{dataset:response.native.dataset,intentIds:response.native.intentIds,
      originalManifestSha256:response.native.manifestSha256,mode:response.native.mode}:{}),
    provenance:'File bytes and SHA256 come from the original workspace. This transfer index records their local receiving names.'};
  const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
  if(bytes.length>65000)throw fail('INDEX_LIMIT','Select a source page for this download, or use the complete native edition export; this transfer index exceeds 65 KB.');
  parse(bytes,exportId);
  return {client,manifest,bytes,sha256:hash(bytes)};
}
function receiver(selection){
  const {client,manifest,bytes,sha256}=selection;
  const transport={
    // The authenticated workspace survives a listener restart and port change.
    endpoint:"nws-workspace:"+manifest.workspaceId,
    async call(name,args,options){
      if(args.exportId!==manifest.exportId)throw fail('IDENTITY_CHANGED','Keep the same selected transfer identity.');
      if(name==='nws_transfer_manifest')return {state:'MANIFEST_RETAINED',exportId:manifest.exportId,
        manifestFile:{name:MANIFEST,bytes:bytes.length,sha256}};
      if(name==='nws_transfer_file_release')return client.call('file_release',{readId:args.readId},options);
      if(name!=='nws_transfer_file'||args.expectedManifestSha256!==sha256)
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
        if(error.code==='NWS_MCP_FILE_READ_NOT_FOUND')throw fail('READ_NOT_FOUND','The original temporary read expired; resume this same original file hash.');
        throw error;
      }
      if(result.file?.name!==file.originalName)throw fail('FILE_CHANGED','The original file name differs from the selected transfer.');
      return {...result,exportId:manifest.exportId,manifestSha256:sha256,file:{...result.file,name:file.name}};
    }
  };
  return createRetainedDownload({
    manifestName:MANIFEST,parseManifest:parse,maximumBytes:MAXIMUM,
    stateSchema:'stellar-forge.nws-download-state.v1',
    resultSchema:'stellar-forge.nws-download-result.v1',
    toolPrefix:'nws_transfer',errorPrefix:'NWS_TRANSFER',clientName:'starforge-nws-receiver',
    describe:value=>({workspace:value.workspace,workspaceId:value.workspaceId,kind:value.kind,id:value.id}),
    connect:async()=>transport
  });
}
export async function inspectNwsFiles(options={}){
  const value=await selected(options);
  return {manifest:value.manifest,manifestSha256:value.sha256};
}
async function adoptDownloadWorkspace(owner,selection,options){
  if(options.expectedManifestSha256!==undefined&&
      (!SHA.test(options.expectedManifestSha256)||options.expectedManifestSha256!==selection.sha256))
    throw fail('DOWNLOAD_EXPORT_CHANGED','The retained completion manifest differs from the reviewed original export.');
  const endpoint="nws-workspace:"+selection.manifest.workspaceId;
  await owner.lockedDownload(options.directory,async context=>{
    let previous;
    try{previous=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(
      await owner.bytesAt(resolve(context.stateDirectory,'checkpoint.json'),65000)));}
    catch(error){if(error.code==='ENOENT')return;throw error;}
    if(previous?.endpoint===endpoint)return;
    // Older clients used the HTTP listener as the checkpoint identity. It is
    // only a retained label here; all calls still use the selected live client.
    let legacy;try{legacy=new URL(previous?.endpoint);}catch{}
    if(!legacy||legacy.username||legacy.password||legacy.search||legacy.hash||
        legacy.protocol!=='https:'&&!(legacy.protocol==='http:'&&['127.0.0.1','[::1]'].includes(legacy.hostname)))
      throw fail('DOWNLOAD_CHECKPOINT_CONFLICT','The retained download belongs to a different original workspace.');
    // The original locked loader checks schema, export ID, complete manifest
    // SHA256 and file selections before changing this legacy transport label.
    const savedManifest=await owner.bytesAt(resolve(context.stateDirectory,MANIFEST),65000);
    if(!savedManifest.equals(selection.bytes))
      throw fail('DOWNLOAD_EXPORT_CHANGED','The saved transfer manifest differs from this original workspace selection.');
    await owner.loadContext(context,selection.bytes,selection.manifest.exportId);
    context.state.endpoint=endpoint;
    await owner.checkpoint(context);
  });
}
export async function downloadNwsFiles(options={}){
  const selection=await selected(options),owner=receiver(selection);
  await adoptDownloadWorkspace(owner,selection,options);
  return owner.download({...options,exportId:selection.manifest.exportId});
}
export async function reopenNwsFiles({directory,expectedManifestSha256}={}){
  const owner=createRetainedDownload({manifestName:MANIFEST,parseManifest:parse,maximumBytes:MAXIMUM,
    stateSchema:'stellar-forge.nws-download-state.v1',resultSchema:'stellar-forge.nws-download-result.v1',
    toolPrefix:'nws_transfer',errorPrefix:'NWS_TRANSFER'});
  return owner.lockedDownload(directory,async context=>{
    const bytes=await owner.bytesAt(resolve(context.root,MANIFEST),65000),value=JSON.parse(bytes.toString('utf8')),digest=hash(bytes);
    const manifest=parse(bytes,value.exportId);
    if(expectedManifestSha256!==undefined&&(!SHA.test(expectedManifestSha256)||expectedManifestSha256!==digest))
      throw fail('MANIFEST_CHANGED','The saved transfer differs from the reviewed index SHA256.');
    for(const file of manifest.files)await owner.verifiedFile(resolve(context.root,file.name),file);
    return {schema:'stellar-forge.nws-reopened.v1',state:'COMPLETE',directory:context.root,
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
const HELP = `NWS original merchant MCP client
  tools --url MCP_URL --workspace ALIAS [--token-env MCP_ACCESS_TOKEN]
  call --url MCP_URL --workspace ALIAS --request-file PRIVATE_JSON
  action --url MCP_URL --workspace ALIAS --request-file PRIVATE_JSON
  inspect --url MCP_URL --workspace ALIAS --kind source|export|receipt --id ORIGINAL_ID
          [--page SOURCE_PAGE] [--wire true|false] [--token-env MCP_ACCESS_TOKEN]
  download --url MCP_URL --workspace ALIAS --kind source|export|receipt --id ORIGINAL_ID
           --out PRIVATE_DIRECTORY [--page SOURCE_PAGE] [--wire true|false]
           [--token-env MCP_ACCESS_TOKEN] [--workspace-id ORIGINAL_UUID]
           [--manifest-sha256 REVIEWED_SHA256] [--chunk-bytes 196608]
  reopen --out PRIVATE_DIRECTORY [--manifest-sha256 REVIEWED_SHA256]

call reads {tool,args}. action reads {action,payload,operationId,expectedRevision}.
Keep the same private request file after an uncertain reply. capture.import uses
payload.sourcePackage: a host-declared alias with its pinned original file hash.
Source files retain original body bytes; --wire true selects actual transport
bodies, including empty304 revalidation responses. Exports include complete
source packages, original JSON, table CSV, reports and comparisons. Customer
receiving preserves all five native files and their original names. Downloads
resume in the same private directory; reopen checks all completed bytes offline.
Tokens are read only from the selected host environment variable.
`;
export async function main(args=process.argv.slice(2)){
  if(!args.length||args.length===1&&['--help','-h'].includes(args[0])){process.stdout.write(HELP);return;}
  const [command,...rest]=args;
  if(!['tools','call','action','inspect','download','reopen'].includes(command))
    throw fail('CONFIGURATION','Choose tools, call, action, inspect, download or reopen.');
  const common=['--url','--workspace','--token-env'];
  const allowed=new Set(command==='reopen'?['--out','--manifest-sha256']:
    ['tools','call','action'].includes(command)?[...common,...(command==='tools'?[]:['--request-file'])]:
    [...common,'--kind','--id','--page','--wire','--workspace-id','--manifest-sha256',...(command==='download'?['--out','--chunk-bytes']:[])]);
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
  for(const key of ['--page','--chunk-bytes'])if(values[key]!==undefined&&!/^[0-9]{1,9}$/.test(values[key]))
    throw fail('CONFIGURATION','Use a whole nonnegative '+key+' value.');
  if(values['--wire']!==undefined&&!['true','false'].includes(values['--wire']))
    throw fail('CONFIGURATION','Choose --wire true or --wire false.');
  const controller=new AbortController(),stop=()=>controller.abort(fail('INTERRUPTED','Repeat the same operation or download with its retained original identity.'));
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    const options={url:values['--url'],workspace:values['--workspace'],kind:values['--kind'],id:values['--id'],
      directory:values['--out'],tokenEnv:values['--token-env'],expectedManifestSha256:values['--manifest-sha256'],
      expectedWorkspaceId:values['--workspace-id'],signal:controller.signal,
      ...(values['--page']===undefined?{}:{page:Number(values['--page'])}),
      ...(values['--wire']===undefined?{}:{wire:values['--wire']==='true'}),
      ...(values['--chunk-bytes']===undefined?{}:{chunkSize:Number(values['--chunk-bytes'])}),
      onProgress:value=>process.stderr.write(JSON.stringify(value)+'\n')};
    let result;
    if(['tools','call','action'].includes(command)){
      const client=await openNwsClient(options);
      if(command==='tools'){
        const schema=accepted(await client.call('schema'));
        result={workspace:options.workspace,workspaceId:schema.workspaceId,source:schema.native,
          tools:nwsWorkspaceTools((name,description,properties,required,annotations)=>({name,description,
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
    }else result=command==='inspect'?await inspectNwsFiles(options):
      command==='download'?await downloadNwsFiles(options):await reopenNwsFiles(options);
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    if(result?.ok===false)process.exitCode=2;
    return result;
  }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write((error.code??'NWS_TRANSFER_FAILED')+': '+error.message+'\n');process.exitCode=1;});
