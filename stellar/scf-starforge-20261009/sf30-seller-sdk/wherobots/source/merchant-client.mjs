#!/usr/bin/env node
// MIT. Complete receiving through the original merchant's named export tools.
import {open,readFile,mkdir,realpath,lstat,readdir,link,unlink,rename} from "node:fs/promises";
import {constants} from "node:fs";
import {createHash,randomUUID} from "node:crypto";
import {hostname} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {spawn} from "node:child_process";
import {wherobotsMerchantTools,WHEROBOTS_EXPORT_SCHEMA,MAX_RETAINED_CHUNK_BYTES} from "./merchant-tools.mjs";

const SHA=/^[0-9a-f]{64}$/, ALIAS=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const SCHEMA="stellar-forge.wherobots-merchant-receiving.v1";
const MAX_FILE_BYTES=8*1024*1024*1024, MAX_JSON_BYTES=32*1024*1024;
const here=path.dirname(fileURLToPath(import.meta.url));
const definitions=new Map(wherobotsMerchantTools((name,description,properties,required=[])=>({
  name,description,inputSchema:{type:"object",properties,required,additionalProperties:false}
})).map(item=>[item.name,item]));
const plain=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const stable=value=>JSON.stringify(value&&typeof value==="object"?
  Array.isArray(value)?value.map(item=>JSON.parse(stable(item))):
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(stable(value[key]))])):value);
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const json=value=>Buffer.from(JSON.stringify(value,null,2)+"\n");
const fail=(code,message,details)=>Object.assign(new Error(message),{code,details});
const exists=filename=>lstat(filename).then(()=>true,error=>{if(error.code==="ENOENT")return false;throw error;});
const equal=(left,right)=>stable(left)===stable(right);
function alias(value,label){if(typeof value!=="string"||!ALIAS.test(value))throw fail("WHEROBOTS_RECEIVE_SELECTION","Use the original "+label+" alias.");return value;}
function hash(value,label){if(typeof value!=="string"||!SHA.test(value))throw fail("WHEROBOTS_RECEIVE_HASH","Use the exact "+label+" SHA256.");return value;}
function integer(value,min,max,label){if(!Number.isSafeInteger(value)||value<min||value>max)throw fail("WHEROBOTS_RECEIVE_RANGE",label+" is outside its supported range.");return value;}
function relative(value){
  if(typeof value!=="string"||!value||value.length>4096||value.includes("\\")||value.includes(":")||value.startsWith("/")||
     /[\u0000-\u001f\u007f]/.test(value)||value.split("/").some(item=>!item||item==="."||item===".."))
    throw fail("WHEROBOTS_RECEIVE_PATH","Use an exact portable relative path from the original file inventory.");
  return value;
}
function absolute(value,label){
  if(typeof value!=="string"||!path.isAbsolute(value)||/[\u0000-\u001f\u007f]/.test(value))
    throw fail("WHEROBOTS_RECEIVE_PATH","Select an absolute private "+label+" directory.");
  return path.resolve(value);
}
function abort(signal){
  if(signal?.aborted)throw fail("WHEROBOTS_RECEIVE_INTERRUPTED","Receiving paused at its last committed byte offset.");
}
function owned(info,label){
  if(process.platform!=="win32"&&((info.mode&0o077)!==0||typeof process.getuid!=="function"||info.uid!==process.getuid()))
    throw fail("WHEROBOTS_RECEIVE_PRIVATE","Use an owned private "+label+".");
}
async function directory(filename,create=false){
  if(create)await mkdir(filename,{recursive:true,mode:0o700});
  const info=await lstat(filename);
  if(!info.isDirectory()||info.isSymbolicLink()||await realpath(filename)!==filename)
    throw fail("WHEROBOTS_RECEIVE_PATH","Use an ordinary canonical receiving directory.");
  owned(info,"receiving directory");return filename;
}
async function syncDirectory(filename){
  let handle;
  try{handle=await open(filename,constants.O_RDONLY);await handle.sync();}
  catch(error){if(process.platform!=="win32"||!["EINVAL","EPERM","EISDIR"].includes(error.code))throw error;}
  finally{await handle?.close();}
}
async function regular(filename,flags=constants.O_RDONLY){
  if(await realpath(filename)!==filename)throw fail("WHEROBOTS_RECEIVE_PATH","A receiving file contains a symbolic path.");
  const handle=await open(filename,flags|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try{
    const info=await handle.stat();
    if(!info.isFile())throw fail("WHEROBOTS_RECEIVE_PATH","Use an original regular receiving file.");
    owned(info,"receiving file");return handle;
  }catch(error){await handle.close();throw error;}
}
async function readJson(filename){
  const handle=await regular(filename);
  try{
    if((await handle.stat()).size>MAX_JSON_BYTES)throw fail("WHEROBOTS_RECEIVE_MANIFEST","The original manifest exceeds 32 MiB.");
    const value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(await handle.readFile()));
    if(!plain(value))throw fail("WHEROBOTS_RECEIVE_MANIFEST","Use a complete original JSON object.");
    return value;
  }finally{await handle.close();}
}
async function writeJson(filename,value,{replace=false}={}){
  const temporary=filename+".writing-"+randomUUID();let handle;
  try{
    handle=await open(temporary,"wx",0o600);await handle.writeFile(json(value));await handle.sync();await handle.close();handle=null;
    if(replace)await rename(temporary,filename);
    else{
      try{await link(temporary,filename);}
      catch(error){if(error.code!=="EEXIST"||!equal(await readJson(filename),value))throw error;}
    }
    await syncDirectory(path.dirname(filename));
  }finally{await handle?.close();await unlink(temporary).catch(error=>{if(error.code!=="ENOENT")throw error;});}
}
async function fileHash(filename,expectedBytes){
  const handle=await regular(filename);
  try{return await descriptorHash(handle,expectedBytes);}
  finally{await handle.close();}
}
async function descriptorHash(handle,prefixBytes){
  const before=await handle.stat({bigint:true}),total=Number(before.size);
  if(!Number.isSafeInteger(total)||total>MAX_FILE_BYTES)throw fail("WHEROBOTS_RECEIVE_SIZE","The original file exceeds 8 GiB.");
  const length=prefixBytes??total;
  integer(length,0,total,"Saved prefix");const digest=createHash("sha256");
  const buffer=Buffer.alloc(Math.min(1024*1024,Math.max(length,1)));let offset=0;
  while(offset<length){
    const result=await handle.read(buffer,0,Math.min(buffer.length,length-offset),offset);
    if(!result.bytesRead)throw fail("WHEROBOTS_RECEIVE_CHANGED","The original file ended while it was read.");
    digest.update(buffer.subarray(0,result.bytesRead));offset+=result.bytesRead;
  }
  const after=await handle.stat({bigint:true});
  if(["dev","ino","size","mtimeNs","ctimeNs"].some(key=>before[key]!==after[key]))
    throw fail("WHEROBOTS_RECEIVE_CHANGED","The receiving file changed while its bytes were checked.");
  return {bytes:length,sha256:digest.copy().digest("hex"),digest,total};
}
async function assertFile(filename,item){
  const value=await fileHash(filename);
  if(value.bytes!==item.bytes||value.sha256!==item.sha256)
    throw fail("WHEROBOTS_RECEIVE_CHANGED","A complete received file differs from its original inventory.",{file:item.path});
}
async function lease(root){
  const filename=path.join(root,"receiving.lock"),owner={schema:SCHEMA,pid:process.pid,host:hostname(),id:randomUUID()};
  const candidate=path.join(root,".lease-"+owner.id);await writeJson(candidate,owner);
  let acquired=false;
  try{
    for(let attempt=0;attempt<3;attempt++){
      try{await link(candidate,filename);await syncDirectory(root);acquired=true;break;}
      catch(error){if(error.code!=="EEXIST")throw error;}
      const previous=await readJson(filename);
      if(previous.host!==owner.host||!Number.isSafeInteger(previous.pid)||previous.pid<1||typeof previous.id!=="string")
        throw fail("WHEROBOTS_RECEIVE_ACTIVE","Another host owns this receiving directory.",{owner:previous});
      let alive=true;
      try{process.kill(previous.pid,0);}catch(error){if(error.code==="ESRCH")alive=false;else if(error.code!=="EPERM")throw error;}
      if(alive)throw fail("WHEROBOTS_RECEIVE_ACTIVE","This receiving directory already has an active process.",{pid:previous.pid});
      // A complete hard-linked generation claim admits one stale-owner recovery.
      const marker=path.join(root,".recovered-"+sha(stable(previous)));
      try{await link(filename,marker);}
      catch(error){if(error.code==="EEXIST")throw fail("WHEROBOTS_RECEIVE_ACTIVE","The previous receiving lease is being recovered; repeat the same command.");throw error;}
      const [current,retired]=await Promise.all([lstat(filename),lstat(marker)]);
      if(current.ino!==retired.ino||current.dev!==retired.dev||!equal(await readJson(marker),previous))
        throw fail("WHEROBOTS_RECEIVE_ACTIVE","The original receiving lease changed during recovery.");
      await unlink(filename);await syncDirectory(root);
    }
    if(!acquired)throw fail("WHEROBOTS_RECEIVE_ACTIVE","Another process acquired this receiving directory.");
    return {
      assert:async()=>{if(!equal(await readJson(filename),owner))throw fail("WHEROBOTS_RECEIVE_ACTIVE","The original receiving lease changed.");},
      close:async()=>{if(await exists(filename)&&equal(await readJson(filename),owner)){await unlink(filename);await syncDirectory(root);}}
    };
  }finally{await unlink(candidate).catch(error=>{if(error.code!=="ENOENT")throw error;});}
}
function unwrap(result){
  if(!plain(result))return result;
  if(result.isError===true){
    let error=result.structuredContent;
    if(!error){try{error=JSON.parse(result.content?.filter(item=>item.type==="text").map(item=>item.text).join("\n")??"");}catch{}}
    const code=typeof error?.error==="string"?error.error:error?.error?.code??error?.code??"WHEROBOTS_MERCHANT_ERROR";
    throw fail(code,error?.message??error?.error?.message??"The original merchant operation failed.",error?.details);
  }
  if(result.structuredContent!==undefined)return result.structuredContent;
  if(Array.isArray(result.content)&&result.content.every(item=>item.type==="text")){
    try{return JSON.parse(result.content.map(item=>item.text).join("\n"));}catch{}
  }
  return result;
}
function validateManifest(value,{exportId,workspaceId,expectedManifestSha256}={}){
  if(!plain(value)||value.schema!==WHEROBOTS_EXPORT_SCHEMA||!["workflow","dataset"].includes(value.kind))
    throw fail("WHEROBOTS_RECEIVE_MANIFEST","Select the original complete Wherobots export manifest.");
  alias(value.export_id,"export");hash(value.manifest_sha256,"manifest");hash(value.request_sha256,"request");
  if(typeof value.workspace_id!=="string"||!value.workspace_id||!plain(value.selection)||!Array.isArray(value.files)||!value.files.length)
    throw fail("WHEROBOTS_RECEIVE_MANIFEST","The original export is missing its workspace, selection or complete file inventory.");
  const {manifest_sha256,...payload}=value;
  if(sha(stable(payload))!==manifest_sha256||exportId!==undefined&&value.export_id!==exportId||
     workspaceId!==undefined&&value.workspace_id!==workspaceId||
     expectedManifestSha256!==undefined&&value.manifest_sha256!==hash(expectedManifestSha256,"expected manifest"))
    throw fail("WHEROBOTS_RECEIVE_BINDING","The export differs from its selected original manifest or workspace.");
  const operation=value.kind==="workflow"?"export":"export_dataset";
  if(value.selection.export_id!==value.export_id||!SHA.test(value.selection.expected_revision??"")||
     value.request_sha256!==sha(stable({workspace_id:value.workspace_id,operation,selection:value.selection})))
    throw fail("WHEROBOTS_RECEIVE_BINDING","The export request does not bind its original saved selection.");
  const names=new Set();let total=0;
  for(const item of value.files){
    if(!plain(item))throw fail("WHEROBOTS_RECEIVE_MANIFEST","Each export member needs its exact file descriptor.");
    relative(item.path);hash(item.sha256,"file");integer(item.bytes,0,MAX_FILE_BYTES,"Original file size");
    if(names.has(item.path))throw fail("WHEROBOTS_RECEIVE_INVENTORY","The original inventory repeats a path.");
    names.add(item.path);total+=item.bytes;integer(total,0,Number.MAX_SAFE_INTEGER,"Complete export size");
  }
  for(const name of names){let prefix=path.posix.dirname(name);while(prefix!=="."){if(names.has(prefix))throw fail("WHEROBOTS_RECEIVE_INVENTORY","A file conflicts with another member's directory.");prefix=path.posix.dirname(prefix);}}
  if(value.kind==="workflow"&&(names.size!==1||!names.has("handover.zip"))||
     value.kind==="dataset"&&!["package.json","source.json","dataset.json","dataset.csv"].every(name=>names.has(name)))
    throw fail("WHEROBOTS_RECEIVE_INVENTORY","The complete original export omits its required handover files.");
  return {manifest:structuredClone(value),total};
}
async function inventory(root){
  const found=[];
  async function visit(directoryName,prefix=""){
    for(const item of await readdir(directoryName,{withFileTypes:true})){
      const name=prefix+item.name,filename=path.join(directoryName,item.name);
      if(item.isSymbolicLink())throw fail("WHEROBOTS_RECEIVE_PATH","The receiving inventory contains a symbolic file.");
      if(item.isDirectory())await visit(filename,name+"/");
      else if(item.isFile())found.push(name);
      else throw fail("WHEROBOTS_RECEIVE_PATH","The receiving inventory contains an unsupported file.");
    }
  }
  await visit(root);return found.sort();
}
async function inspect(root,options={}){
  await directory(root);
  const retained=await readJson(path.join(root,"manifest.json"));
  const {manifest,total}=validateManifest(retained,options),binding=await readJson(path.join(root,"binding.json"));
  if(binding.schema!==SCHEMA||binding.export_id!==manifest.export_id||binding.workspace_id!==manifest.workspace_id||
     binding.manifest_sha256!==manifest.manifest_sha256)
    throw fail("WHEROBOTS_RECEIVE_BINDING","The receiving directory belongs to another original export.");
  const filesDirectory=await directory(path.join(root,"files"));
  if(!equal(await inventory(filesDirectory),manifest.files.map(item=>item.path).sort()))
    throw fail("WHEROBOTS_RECEIVE_INCOMPLETE","Receive every original file before importing this handover.");
  for(const item of manifest.files)await assertFile(path.join(filesDirectory,item.path),item);
  return {schema:SCHEMA,state:"COMPLETE",directory:root,filesDirectory,
    workspace:binding.workspace,workspace_id:manifest.workspace_id,export_id:manifest.export_id,
    manifest_sha256:manifest.manifest_sha256,kind:manifest.kind,files:manifest.files,bytes:total,
    manifest,...(manifest.kind==="workflow"?{handover:path.join(filesDirectory,"handover.zip")}:{datasetDirectory:filesDirectory})};
}
export async function inspectReceivedWherobotsExport(directoryName,options={}){
  return inspect(absolute(directoryName,"received export"),options);
}
function chunk(value,item,offset,limit){
  const readId=value?.read_id??value?.readId,next=value&&Object.hasOwn(value,"next_offset")?value.next_offset:value?.nextOffset;
  if(typeof readId!=="string"||!readId||value.read_id!==undefined&&value.readId!==undefined&&value.read_id!==value.readId||
     value.next_offset!==undefined&&value.nextOffset!==undefined&&value.next_offset!==value.nextOffset||
     value?.file?.sha256!==item.sha256||value.file.bytes!==item.bytes||value.file.name!==path.posix.basename(item.path)||
     value.offset!==offset||value.encoding!=="base64"||typeof value.data!=="string"||value.data.length>Math.ceil(limit/3)*4)
    throw fail("WHEROBOTS_RECEIVE_CHUNK","The returned chunk differs from its original file or offset.");
  const bytes=Buffer.from(value.data,"base64");
  if(bytes.toString("base64")!==value.data||!Number.isSafeInteger(value.bytesRead)||value.bytesRead!==bytes.length||
     bytes.length>limit||offset+bytes.length>item.bytes||(!bytes.length&&offset!==item.bytes)||
     next!==(offset+bytes.length<item.bytes?offset+bytes.length:null))
    throw fail("WHEROBOTS_RECEIVE_CHUNK","The original chunk has an incomplete or inconsistent byte range.");
  return {bytes,readId,next};
}
export function createWherobotsMerchantClient({merchant,workspace,workspaceId}={}){
  if(!merchant||typeof merchant.call!=="function")throw new TypeError("Supply the original merchant.call transport.");
  alias(workspace,"workspace");
  if(workspaceId!==undefined&&(typeof workspaceId!=="string"||!workspaceId||workspaceId.length>240))throw new TypeError("Pin the original workspace_id.");
  let pinned=workspaceId,binding;
  async function status(){
    const value=unwrap(await merchant.call("merchant_wherobots_status",{workspace}));
    const selected=value?.workspaces?.find(item=>item.workspace===workspace);
    if(!selected||typeof selected.workspace_id!=="string"||pinned!==undefined&&pinned!==selected.workspace_id)
      throw fail("WHEROBOTS_RECEIVE_WORKSPACE","The selected host alias differs from the original workspace identity.");
    pinned=selected.workspace_id;return value;
  }
  async function bind(){return binding??=status().catch(error=>{binding=null;throw error;});}
  async function call(operation,args={}){
    const name=operation.startsWith("merchant_wherobots_")?operation:"merchant_wherobots_"+operation;
    const definition=definitions.get(name);
    if(!definition||!plain(args)||Object.hasOwn(args,"workspace"))throw new TypeError("Use a documented operation with this client's fixed workspace alias.");
    const selected={...args,workspace},schema=definition.inputSchema;
    if(Object.keys(selected).some(key=>!Object.hasOwn(schema.properties,key))||schema.required.some(key=>!Object.hasOwn(selected,key)))
      throw new TypeError("The original merchant operation has missing or unknown arguments.");
    if(name==="merchant_wherobots_status")return status();
    await bind();
    const value=unwrap(await merchant.call(name,selected));
    if(name==="merchant_wherobots_open"||name==="merchant_wherobots_state"){
      if(value?.workspace_id!==pinned)throw fail("WHEROBOTS_RECEIVE_WORKSPACE","The original workspace identity changed.");
    }
    return value;
  }
  const client={
    workspace,get workspaceId(){return pinned;},call,tools:()=>structuredClone([...definitions.values()]),
    ...Object.fromEntries([...definitions.keys()].map(name=>[name.slice("merchant_wherobots_".length),(args={})=>call(name,args)]))
  };
  client.receiveExport=options=>receiveExport(client,options);
  return Object.freeze(client);
}
export async function receiveWherobotsExport({merchant,workspace,workspaceId,...options}={}){
  return createWherobotsMerchantClient({merchant,workspace,workspaceId}).receiveExport(options);
}
async function receiveExport(client,{exportId,directory:directoryName,expectedManifestSha256,
    chunkBytes=65536,signal,onProgress}={}){
  alias(exportId,"export");integer(chunkBytes,1,MAX_RETAINED_CHUNK_BYTES,"Chunk size");
  const root=absolute(directoryName,"receiving");await directory(root,true);
  const owner=await lease(root);let activeRead,activeFile,completedBytes=0,chunks=0;
  try{
    abort(signal);
    const {manifest,total}=validateManifest(await client.export_status({export_id:exportId}),{
      exportId,workspaceId:client.workspaceId,expectedManifestSha256});
    await owner.assert();
    await writeJson(path.join(root,"binding.json"),{schema:SCHEMA,workspace:client.workspace,
      workspace_id:manifest.workspace_id,export_id:exportId,manifest_sha256:manifest.manifest_sha256});
    await writeJson(path.join(root,"manifest.json"),manifest);
    const filesDirectory=await directory(path.join(root,"files"),true),progressDirectory=await directory(path.join(root,"progress"),true);
    const progress=async(phase,item,offset)=>{if(onProgress)await onProgress({
      phase,workspace:client.workspace,workspace_id:manifest.workspace_id,export_id:exportId,
      manifest_sha256:manifest.manifest_sha256,file:item?.path??null,fileOffset:offset??null,
      completedBytes,totalBytes:total,chunks
    });};
    for(const item of manifest.files){
      abort(signal);await owner.assert();activeFile=item;activeRead=undefined;
      const destination=path.join(filesDirectory,item.path);
      await directory(path.dirname(destination),true);
      if(await exists(destination)){await assertFile(destination,item);completedBytes+=item.bytes;await progress("FILE",item,item.bytes);continue;}
      const stage=await directory(path.join(progressDirectory,sha(item.path)),true);
      const partial=path.join(stage,"part"),journalFile=path.join(stage,"journal.json");
      const binding={schema:SCHEMA,manifest_sha256:manifest.manifest_sha256,path:item.path,sha256:item.sha256,bytes:item.bytes};
      let saved={...binding,offset:0,prefix_sha256:sha(Buffer.alloc(0))};
      if(await exists(journalFile)){
        saved=await readJson(journalFile);
        if(!Object.entries(binding).every(([key,value])=>saved[key]===value)||!SHA.test(saved.prefix_sha256??""))
          throw fail("WHEROBOTS_RECEIVE_PREFIX","The saved byte prefix belongs to another original file.");
        integer(saved.offset,0,item.bytes,"Committed offset");
      }
      let handle;
      try{
        if(!await exists(partial)){
          if(saved.offset)throw fail("WHEROBOTS_RECEIVE_PREFIX","The original saved byte prefix is missing.");
          const fresh=await open(partial,"wx",0o600);await fresh.close();
        }
        handle=await regular(partial,constants.O_RDWR);
        const prefix=await descriptorHash(handle,saved.offset);
        if(prefix.sha256!==saved.prefix_sha256)throw fail("WHEROBOTS_RECEIVE_PREFIX","The saved byte prefix changed.");
        await handle.truncate(saved.offset);await handle.sync();
        let offset=saved.offset,digest=prefix.digest;
        completedBytes+=offset;await progress("RESUMED",item,offset);
        while(offset<item.bytes||item.bytes===0&&!await exists(journalFile)){
          abort(signal);await owner.assert();
          const request={kind:"export",export_id:exportId,file:item.path,expected_sha256:item.sha256,offset,limit:chunkBytes,
            ...(activeRead?{read_id:activeRead}:{})};
          let value;
          try{value=await client.file(request);}
          catch(error){
            if(error.code!=="WHEROBOTS_READ_NOT_FOUND"||!activeRead)throw error;
            activeRead=undefined;delete request.read_id;value=await client.file(request);
          }
          const received=chunk(value,item,offset,chunkBytes);activeRead=received.readId;
          abort(signal);await owner.assert();
          let written=0;
          while(written<received.bytes.length){
            const result=await handle.write(received.bytes,written,received.bytes.length-written,offset+written);
            if(!result.bytesWritten)throw fail("WHEROBOTS_RECEIVE_WRITE","The receiving filesystem could not commit this chunk.");
            written+=result.bytesWritten;
          }
          await handle.sync();digest.update(received.bytes);offset+=received.bytes.length;completedBytes+=received.bytes.length;
          await owner.assert();
          await writeJson(journalFile,{...binding,offset,prefix_sha256:digest.copy().digest("hex")},{replace:true});
          chunks++;if(received.next===null)activeRead=undefined;
          await progress("CHUNK",item,offset);abort(signal);
        }
        const actual=await descriptorHash(handle);
        if(actual.bytes!==item.bytes||actual.sha256!==item.sha256)
          throw fail("WHEROBOTS_RECEIVE_HASH","The complete file differs from its original SHA256.",{file:item.path});
        await handle.sync();await handle.close();handle=null;await owner.assert();
        try{await link(partial,destination);}catch(error){if(error.code!=="EEXIST")throw error;await assertFile(destination,item);}
        await syncDirectory(path.dirname(destination));await unlink(partial);await syncDirectory(stage);
        await progress("FILE",item,item.bytes);
      }finally{await handle?.close();}
    }
    const result=await inspect(root,{exportId,workspaceId:manifest.workspace_id,expectedManifestSha256:manifest.manifest_sha256});
    const receipt={schema:SCHEMA,state:"COMPLETE",workspace:client.workspace,workspace_id:manifest.workspace_id,
      export_id:exportId,manifest_sha256:manifest.manifest_sha256,kind:manifest.kind,files:manifest.files,bytes:total};
    await owner.assert();await writeJson(path.join(root,"receipt.json"),receipt);
    await progress("COMPLETE",null,null);
    return {...result,chunks};
  }catch(error){
    if(activeRead&&activeFile){
      try{await client.file_release({kind:"export",export_id:exportId,file:activeFile.path,read_id:activeRead});}
      catch(cleanup){error.releaseError={code:cleanup.code,message:cleanup.message};}
    }
    throw error;
  }finally{await owner.close();}
}
async function initialize(directoryName,{python,env,title}){
  const output=await new Promise((resolve,reject)=>{
    const child=spawn(python,[path.join(here,"operate.py"),"--workspace",directoryName,"init","--title",title],
      {env,shell:false,stdio:["ignore","pipe","pipe"],windowsHide:true});
    const chunks=[];let bytes=0,overflow=false;child.stderr.resume();
    child.on("error",reject);
    child.stdout.on("data",chunk=>{bytes+=chunk.length;if(bytes>2*1024*1024){overflow=true;child.kill("SIGTERM");}else chunks.push(chunk);});
    child.on("close",(code,signal)=>{
      if(overflow)return reject(fail("WHEROBOTS_RECEIVE_INIT","The original initializer exceeded its reply size."));
      let value;try{value=JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{return reject(fail("WHEROBOTS_RECEIVE_INIT","The original initializer ended without a complete reply.",{code,signal}));}
      if(code!==0||value.error)return reject(fail(value.error??"WHEROBOTS_RECEIVE_INIT",value.message??"The original workspace could not initialize."));
      resolve(value);
    });
  });
  return output;
}
export async function importReceivedWherobotsWorkflow({directory:directoryName,workspace,workspaceId,
    python=process.env.WHEROBOTS_PYTHON||"python3",env=process.env,create=false,title="Received Wherobots workflow"}={}){
  const received=await inspectReceivedWherobotsExport(directoryName);
  if(received.kind!=="workflow")throw fail("WHEROBOTS_RECEIVE_KIND","Import a complete workflow handover; open dataset packages through the original SF30 loader.");
  const destination=absolute(workspace,"customer workspace");
  if(destination===received.directory||destination.startsWith(received.filesDirectory+path.sep)||received.directory.startsWith(destination+path.sep))
    throw fail("WHEROBOTS_RECEIVE_PATH","Keep the independent customer workspace separate from the received export files.");
  if(create){
    await directory(destination,true);
    if(!await exists(path.join(destination,"workspace.sqlite3")))await initialize(destination,{python,env,title});
  }
  await directory(destination);
  const {createWherobotsWorkspace}=await import("./index.mjs");
  let client=createWherobotsWorkspace({directory:destination,workspaceId,python,env});
  let original,imported,workflow,editions,pinned;
  try{
    pinned=(await client.state({offset:0,limit:1})).workspace_id;
    original=await client.inspect_export({export_kind:"workflow",source:received.handover});
    if(original.source_workspace_id!==received.workspace_id||original.workflow_id!==received.manifest.selection.workflow_id||
       original.workflow_revision!==received.manifest.selection.expected_revision||original.sha256!==received.files[0].sha256)
      throw fail("WHEROBOTS_RECEIVE_BINDING","The original archive differs from its selected source workflow.");
    imported=await client.import({source:received.handover,expected_sha256:received.files[0].sha256});
    workflow=await client.get({kind:"workflow",id:original.workflow_id});
    editions=[];for(const id of original.editions)editions.push(await client.get({kind:"edition",id}));
  }finally{await client.close();}
  client=createWherobotsWorkspace({directory:destination,workspaceId:pinned,python,env});
  try{
    const reopened=await client.get({kind:"workflow",id:workflow.id});
    if(!equal(reopened,workflow))throw fail("WHEROBOTS_RECEIVE_REOPEN","The received original workflow changed on reopen.");
    for(const edition of editions){
      const record=await client.get({kind:"edition",id:edition.id});
      if(!equal(record,edition))throw fail("WHEROBOTS_RECEIVE_REOPEN","A received original edition changed on reopen.");
    }
    const state=await client.state({offset:0,limit:20});
    return {schema:"stellar-forge.wherobots-merchant-import.v1",state:"REOPENED",directory:destination,
      workspace_id:pinned,source_workspace_id:received.workspace_id,export_id:received.export_id,
      manifest_sha256:received.manifest_sha256,archive_sha256:received.files[0].sha256,
      package_id:original.package_id,workflow,editions,receiving:imported,workspace:state};
  }finally{await client.close();}
}
const HELP="Wherobots merchant consumer\n\n"+
 "status --config FILE --workspace ALIAS [--workspace-id ID]\n"+
 "export --config FILE --workspace ALIAS --workflow-id ID --expected-revision SHA --export-id ID\n"+
 "export-dataset --config FILE --workspace ALIAS --edition-id ID --dataset-id ID --expected-revision SHA --export-id ID\n"+
 "receive --config FILE --workspace ALIAS --export-id ID --directory DIR [--manifest-sha256 SHA] [--chunk-bytes N]\n"+
 "inspect --directory DIR [--manifest-sha256 SHA]\n"+
 "import --directory DIR --customer-workspace DIR [--customer-id ID] [--create-customer] [--python FILE]\n"+
 "deliver --config FILE --workspace ALIAS --export-id ID --directory DIR --customer-workspace DIR [--create-customer]\n"+
 "call --config FILE --workspace ALIAS --operation NAME [--arguments PRIVATE_JSON]\n\n"+
 "Repeat receive or deliver with the same selection to resume committed file ranges.\n"+
 "Configuration and receiving paths stay on this private host. Merchant requests use declared aliases.\n";
export async function runWherobotsMerchantClientCli(argv=process.argv.slice(2),{stdout=process.stdout,stderr=process.stderr}={}){
  if(!argv.length||argv[0]==="help"||argv[0]==="--help"){stdout.write(HELP);return;}
  const [command,...rest]=argv,options={};
  const allowed=new Set(["config","workspace","workspace-id","workflow-id","edition-id","dataset-id","expected-revision","export-id",
    "directory","manifest-sha256","chunk-bytes","customer-workspace","customer-id","python","operation","arguments","create-customer"]);
  for(let index=0;index<rest.length;index++){
    const name=rest[index].replace(/^--/,"");
    if(!rest[index].startsWith("--")||!allowed.has(name)||Object.hasOwn(options,name))throw new TypeError("Use distinct documented --name value options.");
    if(name==="create-customer")options[name]=true;
    else{const value=rest[++index];if(value===undefined||value.startsWith("--"))throw new TypeError("Missing value for --"+name);options[name]=value;}
  }
  const need=name=>{if(options[name]===undefined)throw new TypeError("Missing --"+name);return options[name];};
  const write=value=>stdout.write(JSON.stringify(value,null,2)+"\n");
  const importOptions=()=>({directory:need("directory"),workspace:need("customer-workspace"),workspaceId:options["customer-id"],
    python:options.python,create:options["create-customer"]===true});
  if(command==="inspect"){const result=await inspectReceivedWherobotsExport(need("directory"),{expectedManifestSha256:options["manifest-sha256"]});write(result);return result;}
  if(command==="import"){const result=await importReceivedWherobotsWorkflow(importOptions());write(result);return result;}
  if(!["status","export","export-dataset","receive","deliver","call"].includes(command))throw new TypeError("Choose a documented merchant consumer command.");
  const configuration=absolute(need("config"),"merchant configuration");
  const {openMerchantOperator}=await import("../../../../../stellar-forge/mcp-merchant-operator/operator.mjs");
  const merchant=await openMerchantOperator(configuration),client=createWherobotsMerchantClient({
    merchant,workspace:need("workspace"),workspaceId:options["workspace-id"]
  });
  const controller=new AbortController(),interrupt=()=>controller.abort();
  process.on("SIGINT",interrupt);process.on("SIGTERM",interrupt);
  try{
    let result;
    if(command==="status")result=await client.status();
    if(command==="export")result=await client.export({workflow_id:need("workflow-id"),
      expected_revision:need("expected-revision"),export_id:need("export-id")});
    if(command==="export-dataset")result=await client.export_dataset({edition_id:need("edition-id"),
      dataset_id:need("dataset-id"),expected_revision:need("expected-revision"),export_id:need("export-id")});
    if(command==="call"){
      const args=options.arguments?await readJson(path.resolve(options.arguments)):{};
      result=await client.call(need("operation"),args);
    }
    if(command==="receive"||command==="deliver"){
      result=await client.receiveExport({exportId:need("export-id"),directory:need("directory"),
        expectedManifestSha256:options["manifest-sha256"],
        chunkBytes:options["chunk-bytes"]===undefined?65536:Number(options["chunk-bytes"]),signal:controller.signal,
        onProgress:value=>{if(value.phase!=="CHUNK")stderr.write(JSON.stringify(value)+"\n");}});
      if(command==="deliver")result={received:result,customer:await importReceivedWherobotsWorkflow(importOptions())};
    }
    write(result);return result;
  }finally{process.off("SIGINT",interrupt);process.off("SIGTERM",interrupt);await merchant.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runWherobotsMerchantClientCli().catch(error=>{
    process.stderr.write(JSON.stringify({error:error.code??"WHEROBOTS_CONSUMER",message:error.message,details:error.details})+"\n");
    process.exitCode=error.code==="WHEROBOTS_RECEIVE_INTERRUPTED"?130:1;
  });
}
