// MIT. Original StellarExpert MCP client and complete retained-file receiver.
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openMerchantFileClient, createRetainedDownload } from './retained-download.mjs';
import { stellarExpertWorkspaceTools } from './stellar-expert-workspace.mjs';

const PREFIX='merchant_stellar_expert_';
const MANIFEST='stellar-transfer.json';
const SCHEMA='stellar-forge.stellar-expert-file-transfer.v1';
const MAXIMUM=256000000;
const SHA=/^[a-f0-9]{64}$/;
const ALIAS=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=(code,message)=>Object.assign(new Error(message),{code:'STELLAR_TRANSFER_'+code});
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const names=new Set(stellarExpertWorkspaceTools(name=>name));
const ACTIONS=['watch.add','watch.remove','capture.start','capture.resume','edition.select','edition.compare','annotation.save','dataset.prepare','dataset.query','release.prepare','release.inspect','release.activate','release.start','release.stop','release.rollback','buyer.inspect','buyer.receive','export.create'];
function alias(value){if(typeof value!=='string'||!ALIAS.test(value))throw fail('CONFIGURATION','Choose a host-declared workspace alias.');return value;}
function accepted(value){
  if(!plain(value)||value.ok!==true)throw Object.assign(fail('ORIGINAL_REJECTED',value?.native?.message??'Inspect the original workspace response before continuing.'),{original:value});
  return value;
}
export async function openStellarExpertClient({workspace,...options}={}){
  alias(workspace);
  const client=await openMerchantFileClient({...options,errorPrefix:'STELLAR_TRANSFER',clientName:'starforge-stellar-expert-client'});
  return {workspace,endpoint:client.endpoint,
    async call(name,args={},callOptions){
      if(!name.startsWith(PREFIX))name=PREFIX+name;
      if(!names.has(name))throw fail('TOOL','Choose an advertised original StellarExpert tool.');
      if(!plain(args)||Object.hasOwn(args,'workspace'))throw fail('CONFIGURATION','The client already binds the selected workspace.');
      return client.call(name,name===PREFIX+'workspaces'?args:{workspace,...args},callOptions);
    },
    async action(action,payload,{operationId,expectedRevision}={}){
      if(!ACTIONS.includes(action)||!plain(payload))throw fail('CONFIGURATION','Supply an original action and complete payload.');
      const name=PREFIX+action.replaceAll('.','_');
      if(!names.has(name)||!/^[A-Za-z0-9_-]{8,100}$/.test(operationId??'')||!Number.isSafeInteger(expectedRevision)||expectedRevision<0||
          ['workspace','operationId','expectedRevision'].some(key=>Object.hasOwn(payload,key)))
        throw fail('CONFIGURATION','Retain the original action payload, operationId and expectedRevision before calling.');
      return client.call(name,{workspace,operationId,expectedRevision,...payload});
    }};
}
function parse(bytes,exportId){
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw fail('MANIFEST','The saved transfer index is not valid UTF-8 JSON.');}
  if(!plain(value)||value.schema!==SCHEMA||value.exportId!==exportId||!ALIAS.test(value.workspace??'')||!UUID.test(value.workspaceId??'')||
      !['source','export','receipt'].includes(value.kind)||typeof value.id!=='string'||!Array.isArray(value.files)||value.files.length<1)
    throw fail('MANIFEST','Use a complete original StellarExpert transfer index.');
  const names=new Set();let total=0;
  for(const file of value.files){
    if(!plain(file)||typeof file.name!=='string'||!file.name||file.name===MANIFEST||file.name==='download-state'||
        (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(file.name))||names.has(file.name)||typeof file.originalName!=='string'||
        !Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>MAXIMUM||!SHA.test(file.sha256??'')||
        !plain(file.selection)||file.selection.kind!==value.kind||file.selection.id!==value.id)
      throw fail('MANIFEST','The transfer index has an invalid or duplicate original file selection.');
    names.add(file.name);total+=file.bytes;
  }
  if(total>MAXIMUM)throw fail('CAPACITY','The selected transfer exceeds the maintained 256 MB download budget.');
  return value;
}
async function selected(options){
  const {workspace,kind,id,page,expectedWorkspaceId}=options;
  if(!['source','export','receipt'].includes(kind)||typeof id!=='string'||
      page!==undefined&&(kind!=='source'||!Number.isSafeInteger(page)||page<0))
    throw fail('CONFIGURATION','Select source, export or receipt with its original ID; page applies only to source.');
  const client=await openStellarExpertClient(options),response=accepted(await client.call('files',{kind,id}));
  if(expectedWorkspaceId!==undefined&&response.workspaceId!==expectedWorkspaceId)
    throw fail('IDENTITY_CHANGED','The original running workspace differs from the selected UUID.');
  let files=response.native.files;
  if(page!==undefined)files=files.filter(file=>file.selection.page===page);
  if(!files.length)throw fail('SELECTION','Select a retained original file or source page.');
  files=files.map(file=>({...file,originalName:file.name,
    name:kind==='source'?'page-'+String(file.selection.page).padStart(6,'0')+'-'+file.name:file.name}));
  const identity={workspace,workspaceId:response.workspaceId,kind,id,...(page===undefined?{}:{page}),files};
  const exportId='stellar-transfer-'+hash(Buffer.from(JSON.stringify(identity))).slice(0,24);
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
    endpoint:"stellar-expert-workspace:"+manifest.workspaceId,
    async call(name,args,options){
      if(args.exportId!==manifest.exportId)throw fail('IDENTITY_CHANGED','Keep the same selected transfer identity.');
      if(name==='stellar_transfer_manifest')return {state:'MANIFEST_RETAINED',exportId:manifest.exportId,
        manifestFile:{name:MANIFEST,bytes:bytes.length,sha256}};
      if(name==='stellar_transfer_file_release')return client.call('file_release',{readId:args.readId},options);
      if(name!=='stellar_transfer_file'||args.expectedManifestSha256!==sha256)
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
        if(error.code==='STELLAR_MCP_FILE_READ_NOT_FOUND')throw fail('READ_NOT_FOUND','The original temporary read expired; resume this same original file hash.');
        throw error;
      }
      if(result.file?.name!==file.originalName)throw fail('FILE_CHANGED','The original file name differs from the selected transfer.');
      return {...result,exportId:manifest.exportId,manifestSha256:sha256,file:{...result.file,name:file.name}};
    }
  };
  return createRetainedDownload({
    manifestName:MANIFEST,parseManifest:parse,maximumBytes:MAXIMUM,
    stateSchema:'stellar-forge.stellar-expert-download-state.v1',
    resultSchema:'stellar-forge.stellar-expert-download-result.v1',
    toolPrefix:'stellar_transfer',errorPrefix:'STELLAR_TRANSFER',clientName:'starforge-stellar-expert-receiver',
    describe:value=>({workspace:value.workspace,workspaceId:value.workspaceId,kind:value.kind,id:value.id}),
    connect:async()=>transport
  });
}
export async function inspectStellarExpertFiles(options={}){
  const value=await selected(options);
  return {manifest:value.manifest,manifestSha256:value.sha256};
}
async function adoptDownloadWorkspace(owner,selection,options){
  if(options.expectedManifestSha256!==undefined&&
      (!SHA.test(options.expectedManifestSha256)||options.expectedManifestSha256!==selection.sha256))
    throw fail('DOWNLOAD_EXPORT_CHANGED','The retained completion manifest differs from the reviewed original export.');
  const endpoint="stellar-expert-workspace:"+selection.manifest.workspaceId;
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
export async function downloadStellarExpertFiles(options={}){
  const selection=await selected(options),owner=receiver(selection);
  await adoptDownloadWorkspace(owner,selection,options);
  return owner.download({...options,exportId:selection.manifest.exportId});
}
export async function reopenStellarExpertFiles({directory,expectedManifestSha256}={}){
  const owner=createRetainedDownload({manifestName:MANIFEST,parseManifest:parse,maximumBytes:MAXIMUM,
    stateSchema:'stellar-forge.stellar-expert-download-state.v1',resultSchema:'stellar-forge.stellar-expert-download-result.v1',
    toolPrefix:'stellar_transfer',errorPrefix:'STELLAR_TRANSFER'});
  return owner.lockedDownload(directory,async context=>{
    const bytes=await owner.bytesAt(resolve(context.root,MANIFEST),65000),value=JSON.parse(bytes.toString('utf8')),digest=hash(bytes);
    const manifest=parse(bytes,value.exportId);
    if(expectedManifestSha256!==undefined&&(!SHA.test(expectedManifestSha256)||expectedManifestSha256!==digest))
      throw fail('MANIFEST_CHANGED','The saved transfer differs from the reviewed index SHA256.');
    for(const file of manifest.files)await owner.verifiedFile(resolve(context.root,file.name),file);
    return {schema:'stellar-forge.stellar-expert-reopened.v1',state:'COMPLETE',directory:context.root,
      workspace:manifest.workspace,workspaceId:manifest.workspaceId,kind:manifest.kind,id:manifest.id,
      files:manifest.files.length,bytes:manifest.files.reduce((sum,file)=>sum+file.bytes,0),manifestSha256:digest};
  });
}

const HELP = `StellarExpert original MCP client
  inspect --url MCP_URL --workspace ALIAS --kind source|export|receipt --id ORIGINAL_ID
          [--page SOURCE_PAGE] [--token-env MCP_ACCESS_TOKEN]
  download --url MCP_URL --workspace ALIAS --kind source|export|receipt --id ORIGINAL_ID
           --out PRIVATE_DIRECTORY [--page SOURCE_PAGE] [--token-env MCP_ACCESS_TOKEN]
           [--manifest-sha256 REVIEWED_SHA256] [--chunk-bytes 196608]
  reopen --out PRIVATE_DIRECTORY [--manifest-sha256 REVIEWED_SHA256]

Source selection retains original response bytes. Export selection retains the
original complete JSON, CSV, report or comparison. Receipt selection retrieves
all five native customer files in their original order. Downloads resume verified
partial files in the same private directory; reopen verifies all bytes offline.
The MCP endpoint token is read only from the chosen environment variable.
`;
export async function main(args=process.argv.slice(2)){
  if(!args.length||args.length===1&&['--help','-h'].includes(args[0])){process.stdout.write(HELP);return;}
  const [command,...rest]=args,allowed=new Set(['--url','--workspace','--kind','--id','--page','--out','--token-env','--manifest-sha256','--chunk-bytes']);
  if(!['inspect','download','reopen'].includes(command))throw fail('CONFIGURATION','Choose inspect, download or reopen.');
  const values={};
  for(let i=0;i<rest.length;i+=2){
    if(!allowed.has(rest[i])||Object.hasOwn(values,rest[i])||!rest[i+1]||rest[i+1].startsWith('--'))
      throw fail('CONFIGURATION','Use complete, unique declared options.');
    values[rest[i]]=rest[i+1];
  }
  const required=command==='reopen'?['--out']:['--url','--workspace','--kind','--id',...(command==='download'?['--out']:[])];
  for(const key of required)if(!values[key])throw fail('CONFIGURATION','Supply '+key+'.');
  if(command==='reopen'&&Object.keys(values).some(key=>!['--out','--manifest-sha256'].includes(key)))
    throw fail('CONFIGURATION','Reopen reads the selected local directory and optional reviewed hash.');
  for(const key of ['--page','--chunk-bytes'])if(values[key]!==undefined&&!/^[0-9]{1,9}$/.test(values[key]))
    throw fail('CONFIGURATION','Use a whole nonnegative '+key+' value.');
  const controller=new AbortController(),stop=()=>controller.abort(fail('INTERRUPTED','Repeat the same download command to resume its original verified bytes.'));
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    const options={url:values['--url'],workspace:values['--workspace'],kind:values['--kind'],id:values['--id'],
      directory:values['--out'],tokenEnv:values['--token-env'],expectedManifestSha256:values['--manifest-sha256'],
      signal:controller.signal,...(values['--page']===undefined?{}:{page:Number(values['--page'])}),
      ...(values['--chunk-bytes']===undefined?{}:{chunkSize:Number(values['--chunk-bytes'])}),
      onProgress:value=>process.stderr.write(JSON.stringify(value)+'\n')};
    const result=command==='inspect'?await inspectStellarExpertFiles(options):
      command==='download'?await downloadStellarExpertFiles(options):await reopenStellarExpertFiles(options);
    process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
  }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write((error.code??'STELLAR_TRANSFER_FAILED')+': '+error.message+'\n');process.exitCode=1;});
