// MIT. Shared merchant attachment to the original Wherobots Python workspace.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {createWherobotsWorkspace} from "./index.mjs";
import {wherobotsMerchantTools,WHEROBOTS_CONNECTION_SCHEMA,WHEROBOTS_EXPORT_SCHEMA} from "./merchant-tools.mjs";
import {exact,failure,identifier,line,plain,privateSupportDirectory} from "../../../../../stellar-forge/mcp-merchant-operator/host-files.mjs";
import {RetainedFileReads,MAX_RETAINED_CHUNK_BYTES,MAX_RETAINED_IMMUTABLE_FILE_BYTES} from "../../../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs";

export {wherobotsMerchantTools,WHEROBOTS_CONNECTION_SCHEMA,WHEROBOTS_EXPORT_SCHEMA};
const HASH=/^[0-9a-f]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,239}$/;
const INPUT_KINDS=new Set(["source","script","intake","handover"]);
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const stable=value=>JSON.stringify(value && typeof value==="object" ?
  Array.isArray(value)?value.map(item=>JSON.parse(stable(item))):
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(stable(value[key]))])):value);
const definitions=new Map(wherobotsMerchantTools((name,description,properties,required=[])=>({name,properties,required})).map(value=>[value.name,value]));

function hostPath(value,base){
  if(typeof value!=="string"||!value||/[\u0000-\u001f\u007f]/.test(value))throw failure("CONFIGURATION_ERROR","Declare an original host path in the private connection.");
  return path.resolve(base,value);
}
function relativeFile(value){
  if(typeof value!=="string"||!value||value.length>4096||value.includes("\\")||value.startsWith("/")||
     value.split("/").some(part=>!part||part==="."||part==="..")||/[\u0000-\u001f\u007f]/.test(value))
    throw failure("WHEROBOTS_FILE","Select an exact original file from its retained manifest.");
  return value;
}
function integer(value,min,max,label){
  if(!Number.isSafeInteger(value)||value<min||value>max)throw failure("INVALID_PARAMS",label+" is outside the supported range.");
  return value;
}
async function canonicalDirectory(directory){
  await privateSupportDirectory(directory);
  if(await fsp.realpath(directory)!==directory)throw failure("CONFIGURATION_ERROR","Select the original canonical private directory.");
  return directory;
}
async function fileIdentity(filename,{maximum=MAX_RETAINED_IMMUTABLE_FILE_BYTES,privateFile=false,read=false}={}){
  filename=path.resolve(filename);
  if(await fsp.realpath(filename)!==filename)throw failure("WHEROBOTS_FILE","Select an original regular canonical file.");
  let handle;
  try{
    handle=await fsp.open(filename,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0)|(fs.constants.O_NONBLOCK??0));
    const before=await handle.stat({bigint:true});
    if(!before.isFile()||before.size>BigInt(maximum)||(privateFile&&process.platform!=="win32"&&
        ((before.mode&0o077n)!==0n||typeof process.getuid!=="function"||before.uid!==BigInt(process.getuid()))))
      throw failure("WHEROBOTS_FILE","The selected original file has invalid ownership, type or size.");
    const size=Number(before.size),hash=createHash("sha256"),buffer=Buffer.alloc(Math.min(1024*1024,Math.max(1,size))),parts=[];
    let position=0;
    while(position<size){
      const received=await handle.read(buffer,0,Math.min(buffer.length,size-position),position);
      if(!received.bytesRead)throw failure("WHEROBOTS_FILE_CHANGED","The original file ended during inspection.");
      const bytes=buffer.subarray(0,received.bytesRead);hash.update(bytes);
      if(read)parts.push(Buffer.from(bytes));
      position+=received.bytesRead;
    }
    const after=await handle.stat({bigint:true});
    if(["dev","ino","size","mtimeNs","ctimeNs"].some(key=>before[key]!==after[key]))
      throw failure("WHEROBOTS_FILE_CHANGED","The original file changed during inspection.");
    return {bytes:size,sha256:hash.digest("hex"),...(read?{content:Buffer.concat(parts)}:{})};
  }finally{await handle?.close();}
}
async function publishPrivateJson(filename,value){
  const directory=path.dirname(filename),temporary=path.join(directory,".wherobots-"+randomUUID()+".pending");
  let handle,owned=false;
  try{
    handle=await fsp.open(temporary,"wx",0o600);owned=true;
    await handle.writeFile(JSON.stringify(value,null,2)+"\n");
    await handle.sync();await handle.close();handle=null;
    // The final immutable name becomes visible only after all original bytes
    // are durable. The caller retains its existing EEXIST identity check.
    await fsp.link(temporary,filename);
    if(process.platform!=="win32"){
      const parent=await fsp.open(directory,fs.constants.O_RDONLY);
      try{await parent.sync();}finally{await parent.close();}
    }
  }finally{
    await handle?.close();
    if(owned)await fsp.unlink(temporary).catch(error=>{if(error.code!=="ENOENT")throw error;});
  }
}
async function privateJson(filename,maximum=1024*1024){
  const source=await fileIdentity(filename,{maximum,privateFile:true,read:true});
  const value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(source.content));
  if(!plain(value))throw failure("CONFIGURATION_ERROR","Use an original complete JSON object.");
  return value;
}
export async function readWherobotsWorkspaceConfiguration(filename){
  filename=path.resolve(filename);
  const raw=await privateJson(filename),base=path.dirname(filename);
  exact(raw,["schema","workspaces"],["schema","workspaces"]);
  if(raw.schema!==WHEROBOTS_CONNECTION_SCHEMA||!plain(raw.workspaces)||
      Object.keys(raw.workspaces).length<1||Object.keys(raw.workspaces).length>32)
    throw failure("CONFIGURATION_ERROR","Declare 1–32 original Wherobots workspace aliases.");
  const workspaces=Object.create(null),seen=new Set();
  for(const [alias,entry] of Object.entries(raw.workspaces)){
    identifier(alias,"Wherobots workspace alias");
    exact(entry,["label","directory","workspaceId","python","profile","pythonPath","inputs"],["directory","workspaceId"]);
    if(typeof entry.workspaceId!=="string"||!ID.test(entry.workspaceId))throw failure("CONFIGURATION_ERROR","Pin the original workspace_id returned by init or state.");
    const directory=hostPath(entry.directory,base);
    await canonicalDirectory(directory);
    const database=await fsp.lstat(path.join(directory,"workspace.sqlite3"));
    if(!database.isFile()||database.isSymbolicLink()||seen.has(directory))
      throw failure("CONFIGURATION_ERROR","Give each original initialized workspace one alias.");
    seen.add(directory);
    const python=entry.python??"python3";
    if(typeof python!=="string"||!python||/[\u0000-\u001f\u007f]/.test(python)||
        (python!=="python3"&&!path.isAbsolute(python)))
      throw failure("CONFIGURATION_ERROR","Select python3 or an installed absolute Python executable.");
    let profile;
    if(entry.profile!==undefined){
      profile=hostPath(entry.profile,base);
      await privateJson(profile);
    }
    if(entry.pythonPath!==undefined&&(!Array.isArray(entry.pythonPath)||entry.pythonPath.length>8))
      throw failure("CONFIGURATION_ERROR","Declare at most eight original Python module directories.");
    const pythonPath=[];
    for(const value of entry.pythonPath??[]){
      const directory=hostPath(value,base),info=await fsp.stat(directory);
      if(!info.isDirectory())throw failure("CONFIGURATION_ERROR","Select existing installed Python module directories.");
      pythonPath.push(directory);
    }
    if(entry.inputs!==undefined&&(!plain(entry.inputs)||Object.keys(entry.inputs).length>32))
      throw failure("CONFIGURATION_ERROR","Declare at most32 named original source and handover inputs.");
    const inputs=Object.create(null);
    for(const [name,input] of Object.entries(entry.inputs??{})){
      identifier(name,"Wherobots input alias");
      exact(input,["label","kind","file","sha256","bytes"],["kind","file","sha256"]);
      if(!INPUT_KINDS.has(input.kind)||!HASH.test(input.sha256??""))throw failure("CONFIGURATION_ERROR","Pin each original input kind and SHA256.");
      const file=hostPath(input.file,base),info=await fsp.lstat(file);
      if(!info.isFile()||info.isSymbolicLink()||await fsp.realpath(file)!==file||info.size>MAX_RETAINED_IMMUTABLE_FILE_BYTES)
        throw failure("CONFIGURATION_ERROR","Select an existing canonical original input within8GiB.");
      if(input.bytes!==undefined&&input.bytes!==info.size)throw failure("CONFIGURATION_ERROR","The original input differs from its pinned byte count.");
      inputs[name]={label:line(input.label??name),kind:input.kind,file,sha256:input.sha256,bytes:info.size};
    }
    workspaces[alias]={label:line(entry.label??alias),directory,workspaceId:entry.workspaceId,python,profile,pythonPath,inputs};
  }
  return {workspaces};
}
function publicInput(name,value){return {input:name,label:value.label,kind:value.kind,filename:path.basename(value.file),sha256:value.sha256,bytes:value.bytes};}
function publicNative(value){
  const {path:unusedPath,directory,source,files,reused,workflow_revision,...rest}=value;
  return {...rest,files:Array.isArray(files)?files.length:files,
    ...(workflow_revision?{workflow_revision}:{}),
    ...(source?{source:{workflow_id:source.workflow_id,operation_id:source.operation_id,native_run_id:source.native_run_id,
      edition_id:source.edition_id,dataset_id:source.dataset_id,source_binding_sha256:source.source_binding_sha256,row_count:source.row_count}}:{})};
}
export class MerchantWherobotsWorkspaces {
  #config;#environment;#handles=new Map();#pending=new Map();#closures=new Map();#closing=false;#close;#reads;
  constructor(config,{environment=process.env}={}){
    this.#config=config;this.#environment=environment;
    this.#reads=new RetainedFileReads({errorPrefix:"WHEROBOTS"});
  }
  get summary(){return {configured:Boolean(this.#config.wherobotsWorkspaces),connected:[...this.#handles.keys()],
    pending:this.#pending.size,closing:this.#closing,...this.#reads.summary};}
  #entry(alias){
    identifier(alias,"Wherobots workspace alias");
    const entry=this.#config.wherobotsWorkspaces?.workspaces?.[alias];
    if(!entry)throw failure("WHEROBOTS_NOT_CONFIGURED","Select an alias returned by merchant_wherobots_status.");
    return entry;
  }
  #client(alias){
    const entry=this.#entry(alias);
    if(!this.#handles.has(alias)){
      const env={...this.#environment,PYTHONDONTWRITEBYTECODE:"1"};
      if(entry.profile)env.WHEROBOTS_OPERATOR_PROFILE=entry.profile;
      if(entry.pythonPath.length)env.PYTHONPATH=[...entry.pythonPath,...(env.PYTHONPATH?[env.PYTHONPATH]:[])].join(path.delimiter);
      this.#handles.set(alias,createWherobotsWorkspace({directory:entry.directory,workspaceId:entry.workspaceId,python:entry.python,env}));
    }
    return this.#handles.get(alias);
  }
  #input(alias,name,kinds){
    const entry=this.#entry(alias);identifier(name,"Original input alias");
    const input=entry.inputs[name];
    if(!input||kinds&&!kinds.includes(input.kind))throw failure("WHEROBOTS_INPUT","Select a host-declared original input for this operation.");
    return input;
  }
  async #cache(alias,exportId){
    this.#entry(alias);identifier(exportId,"Export ID");
    await canonicalDirectory(this.#config.exportsDirectory);
    const directory=path.join(this.#config.exportsDirectory,"wherobots-workspaces",alias,exportId);
    await fsp.mkdir(directory,{recursive:true,mode:0o700});
    await canonicalDirectory(directory);
    return directory;
  }
  async #manifest(alias,exportId){
    const root=await this.#cache(alias,exportId),manifest=await privateJson(path.join(root,"manifest.json"),32*1024*1024);
    const {manifest_sha256,...payload}=manifest;
    if(manifest.schema!==WHEROBOTS_EXPORT_SCHEMA||manifest.export_id!==exportId||
        manifest.workspace_id!==this.#entry(alias).workspaceId||manifest_sha256!==sha(stable(payload))||!Array.isArray(manifest.files))
      throw failure("WHEROBOTS_EXPORT_CHANGED","The original export manifest differs from its saved identity.");
    const names=new Set();
    for(const file of manifest.files){
      relativeFile(file.path);
      if(names.has(file.path)||!HASH.test(file.sha256??"")||!Number.isSafeInteger(file.bytes)||file.bytes<0)
        throw failure("WHEROBOTS_EXPORT_CHANGED","The original export file inventory changed.");
      names.add(file.path);
    }
    return {root,manifest};
  }
  async #export(alias,operation,args){
    if(typeof args.expected_revision!=="string"||!HASH.test(args.expected_revision))
      throw failure("INVALID_PARAMS","Select the exact original workflow or edition revision SHA256 before export.");
    const entry=this.#entry(alias),root=await this.#cache(alias,args.export_id);
    const selection=Object.fromEntries(Object.entries(args).filter(([key])=>key!=="workspace"));
    const request={workspace_id:entry.workspaceId,operation,selection};
    const request_sha256=sha(stable(request));
    let declared={...request,request_sha256,created_at:new Date().toISOString()};
    try{await publishPrivateJson(path.join(root,"request.json"),declared);}
    catch(error){
      if(error.code!=="EEXIST")throw error;
      declared=await privateJson(path.join(root,"request.json"));
      if(declared.request_sha256!==request_sha256||stable({workspace_id:declared.workspace_id,operation:declared.operation,selection:declared.selection})!==stable(request))
        throw failure("WHEROBOTS_EXPORT_CONFLICT","This original export ID belongs to a different retained selection.");
    }
    try{
      const original=await this.#manifest(alias,args.export_id);
      if(original.manifest.request_sha256!==request_sha256)throw failure("WHEROBOTS_EXPORT_CONFLICT","This export manifest belongs to another original request.");
      return original.manifest;
    }catch(error){if(error.code!=="ENOENT")throw error;}
    const filesDirectory=path.join(root,"files");
    const kind=operation==="export"?"workflow":"dataset";
    if(kind==="workflow")await fsp.mkdir(filesDirectory,{recursive:true,mode:0o700});
    const destination=kind==="workflow"?path.join(filesDirectory,"handover.zip"):filesDirectory;
    const result=await this.#client(alias).execute(operation,{...selection,destination,reuse_existing:true});
    let files;
    if(kind==="workflow"){
      files=[{path:"handover.zip",sha256:result.sha256,bytes:result.bytes,content_type:"application/zip"}];
    }else{
      const packageIdentity=await fileIdentity(path.join(filesDirectory,"package.json"));
      files=[...result.files,{path:"package.json",...packageIdentity}].map(file=>({...file,
        content_type:file.path.endsWith(".json")?"application/json":file.path.endsWith(".csv")?"text/csv":"application/octet-stream"}));
    }
    for(const file of files){
      relativeFile(file.path);
      const filename=path.join(filesDirectory,file.path);
      if(await fsp.realpath(filename)!==filename)throw failure("WHEROBOTS_EXPORT_PATH","The native export must retain its original canonical files.");
      if(process.platform!=="win32")await fsp.chmod(filename,0o600);
    }
    const payload={schema:WHEROBOTS_EXPORT_SCHEMA,export_id:args.export_id,workspace_id:entry.workspaceId,kind,
      request_sha256,selection,created_at:declared.created_at,native:publicNative(result),files};
    const manifest={...payload,manifest_sha256:sha(stable(payload))};
    try{await publishPrivateJson(path.join(root,"manifest.json"),manifest);}
    catch(error){
      if(error.code!=="EEXIST")throw error;
      const existing=(await this.#manifest(alias,args.export_id)).manifest;
      if(existing.request_sha256!==request_sha256)throw failure("WHEROBOTS_EXPORT_CONFLICT","Another original request published this export.");
      return existing;
    }
    return manifest;
  }
  async #fileSelection(alias,args){
    const entry=this.#entry(alias);
    if(args.kind==="object"){
      if(!HASH.test(args.object_sha256??"")||args.export_id!==undefined||args.file!==undefined)
        throw failure("WHEROBOTS_FILE","Select one original object SHA256.");
      return {scope:alias+"/object/"+args.object_sha256,key:args.object_sha256,kind:"object",directory:entry.directory,
        filename:path.join(entry.directory,"objects",args.object_sha256),name:args.object_sha256+".data",sha256:args.object_sha256};
    }
    if(args.kind!=="export"||args.object_sha256!==undefined)throw failure("WHEROBOTS_FILE","Select one original export file or content object.");
    const {root,manifest}=await this.#manifest(alias,args.export_id);
    const file=manifest.files.find(file=>file.path===args.file);
    if(!file)throw failure("WHEROBOTS_FILE","Select an exact file path from the original export manifest.");
    return {scope:alias+"/export/"+args.export_id,key:file.path,kind:"export",directory:root,
      filename:path.join(root,"files",file.path),name:path.basename(file.path),sha256:file.sha256,bytes:file.bytes,type:file.content_type};
  }
  async #readFile(alias,args){
    const selected=await this.#fileSelection(alias,args);
    if(args.expected_sha256!==selected.sha256)throw failure("WHEROBOTS_FILE_CHANGED","Receive the exact SHA256 from the original source object or manifest.");
    const result=await this.#reads.read({scope:selected.scope,key:selected.key,kind:selected.kind,directory:selected.directory,
      expectedSha256:selected.sha256,readId:args.read_id,offset:args.offset??0,limit:args.limit??65536,
      load:async()=>{
        let handle;
        try{
          handle=await fsp.open(selected.filename,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0)|(fs.constants.O_NONBLOCK??0));
          const info=await handle.stat();
          if(!info.isFile()||info.size>MAX_RETAINED_IMMUTABLE_FILE_BYTES||selected.bytes!==undefined&&selected.bytes!==info.size||
              process.platform!=="win32"&&((info.mode&0o077)!==0||typeof process.getuid!=="function"||info.uid!==process.getuid()))
            throw failure("WHEROBOTS_FILE_CHANGED","The retained original file has changed type, ownership or length.");
          const value={readonlyFileHandle:handle,bytes:info.size,sha256:selected.sha256,name:selected.name,type:selected.type};
          handle=null;return value;
        }finally{await handle?.close();}
      }});
    return {...result,read_id:result.readId,next_offset:result.nextOffset};
  }
  async #closeAlias(alias){
    if(!this.#closures.has(alias)){
      const pending=(async()=>{
        await Promise.allSettled([...this.#pending].filter(([,name])=>name===alias).map(([promise])=>promise));
        const client=this.#handles.get(alias);
        if(client)await client.close();
        for(const scope of this.#ownedScopes(alias))await this.#reads.closeScope(scope);
        this.#handles.delete(alias);
        return {workspace:alias,workspace_id:this.#entry(alias).workspaceId,state:"CLOSED"};
      })();
      this.#closures.set(alias,pending);
      pending.then(()=>this.#closures.delete(alias),()=>this.#closures.delete(alias));
    }
    return this.#closures.get(alias);
  }
  #scopes=new Map();
  #ownedScopes(alias){return this.#scopes.get(alias)??new Set();}
  async #dispatch(name,args){
    const operation=name.slice("merchant_wherobots_".length),alias=args.workspace;
    if(operation==="status"){
      const entries=alias?[[alias,this.#entry(alias)]]:Object.entries(this.#config.wherobotsWorkspaces?.workspaces??{});
      return {configured:Boolean(this.#config.wherobotsWorkspaces),workspaces:entries.map(([workspace,entry])=>({
        workspace,label:entry.label,workspace_id:entry.workspaceId,connected:this.#handles.has(workspace),
        closing:this.#closures.has(workspace),client:this.#handles.get(workspace)?.summary??null,
        inputs:Object.entries(entry.inputs).map(([name,value])=>publicInput(name,value))})),retained:this.#reads.summary};
    }
    this.#entry(alias);
    if(operation==="close")return this.#closeAlias(alias);
    if(operation==="inputs"){
      if(!args.input)return {workspace:alias,inputs:Object.entries(this.#entry(alias).inputs).map(([name,value])=>publicInput(name,value))};
      const input=this.#input(alias,args.input),actual=await fileIdentity(input.file);
      if(actual.sha256!==input.sha256||actual.bytes!==input.bytes)throw failure("WHEROBOTS_INPUT_CHANGED","The original named input changed.");
      return {workspace:alias,...publicInput(args.input,input),verified:true};
    }
    if(operation==="export_status")return (await this.#manifest(alias,args.export_id)).manifest;
    if(operation==="file"||operation==="file_release"){
      const selected=await this.#fileSelection(alias,args);
      let scopes=this.#scopes.get(alias);if(!scopes){scopes=new Set();this.#scopes.set(alias,scopes);}scopes.add(selected.scope);
      if(operation==="file_release"){await this.#reads.release(selected.scope,args.read_id);return {released:true,read_id:args.read_id};}
      return this.#readFile(alias,args);
    }
    if(["export","export_dataset"].includes(operation))return this.#export(alias,operation,args);
    const client=this.#client(alias),body=Object.fromEntries(Object.entries(args).filter(([key])=>key!=="workspace"));
    if(operation==="open")return {workspace:alias,...await client.state({offset:0,limit:20})};
    if(operation==="state"||operation==="list"){body.offset??=0;body.limit??=20;}
    if(operation==="import_source"){
      const input=this.#input(alias,args.input,["source","script"]);
      if(input.sha256!==args.expected_sha256)throw failure("WHEROBOTS_INPUT_CHANGED","Use the original named source SHA256.");
      delete body.input;body.path=input.file;body.expected_bytes=input.bytes;
    }
    if(operation==="adopt"){
      const input=this.#input(alias,args.input,["intake"]);
      if(input.sha256!==args.input_sha256)throw failure("WHEROBOTS_INPUT_CHANGED","Use the original customer document SHA256.");
      if(!plain(args.files))throw failure("WHEROBOTS_INPUT","Map every original customer source ID to its declared input alias.");
      const files=Object.create(null);
      for(const [sourceId,inputAlias] of Object.entries(args.files)){
        const original=this.#input(alias,inputAlias,["source","script"]);
        const saved=await client.import_source({path:original.file,expected_sha256:original.sha256,expected_bytes:original.bytes});
        files[sourceId]={sha256:saved.sha256,bytes:saved.bytes};
      }
      body.input=input.file;body.files=files;
    }
    if(operation==="import"){
      const input=this.#input(alias,args.input,["handover"]);
      if(input.sha256!==args.expected_sha256)throw failure("WHEROBOTS_INPUT_CHANGED","Use the original complete handover SHA256.");
      delete body.input;body.source=input.file;
    }
    return client.execute(operation,body);
  }
  async call(name,args={}){
    if(this.#closing)throw failure("WHEROBOTS_CLOSING","The Wherobots merchant attachment is closing.");
    const definition=definitions.get(name);
    if(!definition)throw failure("TOOL_NOT_FOUND","Choose a Wherobots workspace tool.");
    exact(args,Object.keys(definition.properties),definition.required);
    if(args.workspace&&this.#closures.has(args.workspace)&&name!=="merchant_wherobots_close")
      throw failure("WHEROBOTS_CLOSING","This original workspace attachment is closing.");
    const pending=this.#dispatch(name,args);this.#pending.set(pending,args.workspace);
    try{return await pending;}finally{this.#pending.delete(pending);}
  }
  close(){
    if(!this.#close){
      this.#closing=true;
      const pending=(async()=>{
        await Promise.allSettled([...this.#pending.keys()]);
        const results=await Promise.allSettled([...this.#handles.values()].map(client=>client.close()));
        results.push(...await Promise.allSettled([this.#reads.close()]));
        const errors=results.filter(result=>result.status==="rejected").map(result=>result.reason);
        if(errors.length)throw new AggregateError(errors,"The original Wherobots attachment has retained incomplete shutdown work.");
        this.#handles.clear();this.#scopes.clear();
      })();
      this.#close=pending;
      pending.catch(()=>{if(this.#close===pending)this.#close=null;});
    }
    return this.#close;
  }
}
