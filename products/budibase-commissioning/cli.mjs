#!/usr/bin/env node
// MIT. Complete Budibase commissioning operation on private local files.
import * as fs from "node:fs/promises";
import {constants as F} from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {randomUUID,createHash,pbkdf2Sync,createDecipheriv} from "node:crypto";
import {gunzipSync} from "node:zlib";
import {fileURLToPath} from "node:url";
import * as C from "./core.mjs";

export const FILE_SCHEMA="tjlabs.budibase-cli-project/v1";
export const REQUEST_SCHEMA="tjlabs.budibase-cli-request/v1";
const LEASE_SCHEMA="tjlabs.budibase-cli-lease/v1",MAX_JSON=1024*1024*1024;
const own=Object.prototype.hasOwnProperty;
const need=(ok,message)=>{if(!ok)throw Error(message);};
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const encoded=value=>Buffer.from(JSON.stringify(value,null,2)+"\n","utf8");
const exists=async name=>{try{await fs.lstat(name);return true;}catch(e){if(e.code==="ENOENT")return false;throw e;}};
const iso=()=>new Date().toISOString();

export function argumentsOf(argv){
  const command=argv[0]||"help",options={};
  for(let i=1;i<argv.length;i++){
    const key=argv[i];need(/^--[a-z][a-z-]*$/.test(key),"Use named --options after the command.");
    const name=key.slice(2);need(!own.call(options,name),"Duplicate option: "+key);
    need(i+1<argv.length&&!argv[i+1].startsWith("--"),"Supply a value for "+key);
    options[name]=argv[++i];
  }
  return {command,options};
}
function allow(options,names){for(const key of Object.keys(options))need(names.includes(key),"Unknown option --"+key);}
function required(options,key){need(typeof options[key]==="string"&&options[key].length,"Supply --"+key);return options[key];}
function absolute(value){return path.resolve(value);}
async function canonicalProject(value){
  const requested=absolute(value),directory=await fs.realpath(path.dirname(requested));
  return path.join(directory,path.basename(requested));
}
function identity(raw){return{bytes:raw.length,sha256:sha(raw)};}
async function regular(name,limit=MAX_JSON){
  const handle=await fs.open(name,F.O_RDONLY|F.O_NOFOLLOW);
  try{const stat=await handle.stat();need(stat.isFile()&&stat.size<=limit,"Select a complete regular file within the receiving limit: "+name);
    const raw=await handle.readFile();need(raw.length===stat.size,"File changed while being read: "+name);return raw;
  }finally{await handle.close();}
}
async function json(name,limit=MAX_JSON){return JSON.parse(C.text(await regular(name,limit)));}
async function syncDirectory(name){const handle=await fs.open(name,"r");try{await handle.sync();}finally{await handle.close();}}
async function parent(name){
  const directory=path.dirname(name),info=await fs.lstat(directory);
  need(info.isDirectory()&&!info.isSymbolicLink(),"Choose an existing real output directory: "+directory);
  return directory;
}
async function atomic(name,raw,{createOnly=false,expectedSha=null}={}){
  const directory=await parent(name),temporary=path.join(directory,"."+path.basename(name)+"."+randomUUID()+".partial");
  let handle;
  try{
    handle=await fs.open(temporary,"wx",0o600);
    await handle.writeFile(raw);await handle.sync();await handle.close();handle=null;
    if(createOnly){
      try{await fs.link(temporary,name);}
      catch(error){
        if(error.code!=="EEXIST")throw error;
        const previous=await regular(name);need(previous.equals(raw),"The existing output contains different bytes: "+name);
        await syncDirectory(directory);
        return{...identity(previous),reused:true,path:name};
      }
    }else{
      need(expectedSha!==null,"Keep the original project preimage for replacement.");
      need(sha(await regular(name))===expectedSha,"Project bytes changed outside the original lease; preserve the request and reopen.");
      await fs.rename(temporary,name);
    }
    await syncDirectory(directory);return{...identity(raw),reused:false,path:name};
  }finally{
    try{if(handle)await handle.close();}
    finally{try{await fs.unlink(temporary);}catch(error){if(error.code!=="ENOENT")throw error;}}
  }
}
async function recoverProjectLinks(project){
  if(!await exists(project))return;
  const info=await fs.lstat(project);
  need(info.isFile()&&!info.isSymbolicLink(),"Keep the original regular project file.");
  if(info.nlink===1)return;
  need((info.mode&0o777)===0o600&&(typeof process.getuid!=="function"||info.uid===process.getuid()),"Preserve an aliased project whose private ownership cannot be verified.");
  const directory=path.dirname(project),prefix="."+path.basename(project)+".",suffix=".partial",recognized=[];
  for(const name of await fs.readdir(directory)){
    if(!name.startsWith(prefix)||!name.endsWith(suffix))continue;
    const token=name.slice(prefix.length,-suffix.length);
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(token))continue;
    const candidate=path.join(directory,name),stat=await fs.lstat(candidate);
    if(stat.isFile()&&!stat.isSymbolicLink()&&stat.dev===info.dev&&stat.ino===info.ino&&stat.uid===info.uid&&(stat.mode&0o777)===0o600)recognized.push(candidate);
  }
  need(recognized.length===info.nlink-1,"Preserve unrelated project hard links; receive a complete independent project at a new path.");
  for(const candidate of recognized){
    const now=await fs.lstat(candidate),current=await fs.lstat(project);
    need(now.dev===info.dev&&now.ino===info.ino&&now.uid===info.uid&&(now.mode&0o777)===0o600&&current.dev===info.dev&&current.ino===info.ino,"Original publication links changed during receiving.");
    await fs.unlink(candidate);
  }
  await syncDirectory(directory);
  need((await fs.lstat(project)).nlink===1,"Original project publication has an unrecognized remaining alias.");
}
function envelope(project,origin){
  const complete=C.reopen(project);
  return{schema:FILE_SCHEMA,origin,project:complete,projectDigest:C.digest(complete)};
}
function parseEnvelope(value){
  need(value?.schema===FILE_SCHEMA&&value.origin?.requestDigest&&value.origin?.requestId,"Choose the complete CLI project file.");
  need(C.digest(value.project)===value.projectDigest,"The saved project digest changed.");
  C.reopen(value.project);return value;
}
async function projectFile(file){const info=await fs.lstat(file);need(info.isFile()&&!info.isSymbolicLink()&&info.nlink===1,"Keep one original regular project file; use receive for independent copies.");const raw=await regular(file);return{raw,sha256:sha(raw),value:parseEnvelope(JSON.parse(C.text(raw)))};}
async function machine(){
  let boot=null,pidNamespace=null,start=null;
  try{boot=(await fs.readFile("/proc/sys/kernel/random/boot_id","utf8")).trim();}catch{}
  try{pidNamespace=await fs.readlink("/proc/self/ns/pid");}catch{}
  try{const line=await fs.readFile("/proc/"+process.pid+"/stat","utf8");start=line.slice(line.lastIndexOf(")")+2).split(" ")[19];}catch{}
  return{host:os.hostname(),boot,pidNamespace,pid:process.pid,start};
}
async function alive(owner){
  const here=await machine();
  if(owner.host!==here.host)return{status:"unknown",reason:"The lease belongs to another host."};
  if(owner.boot!==here.boot)return{status:"unknown",reason:"The original boot identity differs; reconcile on the original host or receive a saved project at a new path."};
  if(owner.pidNamespace!==here.pidNamespace)return{status:"unknown",reason:"The original PID namespace differs."};
  try{
    process.kill(owner.pid,0);
    if(owner.start){
      try{const line=await fs.readFile("/proc/"+owner.pid+"/stat","utf8"),start=line.slice(line.lastIndexOf(")")+2).split(" ")[19];
        if(start!==owner.start)return{status:"ended",reason:"The original process identity ended."};
      }catch(error){if(error.code==="ENOENT")return{status:"ended",reason:"The original process ended."};}
    }
    return{status:"running",reason:"The original process is present."};
  }catch(error){return error.code==="ESRCH"?{status:"ended",reason:"The original process ended."}:{status:"unknown",reason:"The original process cannot be verified."};}
}
async function leaseDirectory(project){
  const dir=project+".leases";
  try{await fs.mkdir(dir,{mode:0o700});await syncDirectory(path.dirname(dir));}catch(error){if(error.code!=="EEXIST")throw error;}
  const stat=await fs.lstat(dir);need(stat.isDirectory()&&!stat.isSymbolicLink(),"Keep the original private lease directory.");
  if(typeof process.getuid==="function")need(stat.uid===process.getuid(),"Use the original lease-directory owner.");
  return dir;
}
const generationName=n=>String(n).padStart(12,"0");
async function leaseState(project){
  const directory=await leaseDirectory(project),names=await fs.readdir(directory);
  const numbers=names.filter(n=>/^\d{12}\.lease\.json$/.test(n)).map(n=>Number(n.slice(0,12))).sort((a,b)=>a-b);
  if(!numbers.length)return{directory,generation:0,lease:null,released:true};
  need(numbers.every((n,i)=>n===i+1),"The original lease history has a missing generation.");
  const generation=numbers.at(-1),lease=await json(path.join(directory,generationName(generation)+".lease.json"),65536);
  need(lease.schema===LEASE_SCHEMA&&lease.generation===generation&&lease.project===project,"The current lease identity changed.");
  const releasePath=path.join(directory,generationName(generation)+".release.json");
  let release=null;if(await exists(releasePath)){release=await json(releasePath,65536);need(release.token===lease.token&&release.generation===generation&&release.project===project,"The lease release identity changed.");}
  return{directory,generation,lease,released:!!release,release};
}
async function acquire(project,command){
  const state=await leaseState(project);
  if(!state.released){const live=await alive(state.lease.owner);const error=Error("Project lease is retained by operation "+state.lease.token+" ("+live.status+"). Inspect with lease; use lease-release only after the original process has ended.");error.lease={...state.lease,liveness:live};throw error;}
  const generation=state.generation+1,lease={schema:LEASE_SCHEMA,project,generation,token:randomUUID(),command,createdAt:iso(),owner:await machine()};
  const file=path.join(state.directory,generationName(generation)+".lease.json");
  await atomic(file,encoded(lease),{createOnly:true});
  return{...lease,directory:state.directory};
}
async function release(lease,reason){
  const file=path.join(lease.directory,generationName(lease.generation)+".release.json");
  const current=await json(path.join(lease.directory,generationName(lease.generation)+".lease.json"),65536);
  need(current.token===lease.token,"Keep the original lease token.");
  return atomic(file,encoded({project:lease.project,generation:lease.generation,token:lease.token,reason}),{createOnly:true});
}
async function withLease(project,command,body){
  const lease=await acquire(project,command);let result,failure;
  try{await recoverProjectLinks(project);result=await body(lease);}catch(error){failure=error;}
  try{await release(lease,failure?"operation-returned-error":"operation-returned");}
  catch(error){if(failure)failure.releaseError=error.message;else failure=error;}
  if(failure)throw failure;return result;
}

export function requestEnvelope({command,project,binding,payload,id,at}){
  const value={schema:REQUEST_SCHEMA,id:id||randomUUID(),at:at||iso(),command,project,binding,payload};
  return{...value,digest:C.digest(value)};
}
export function validateRequest(value){
  need(value?.schema===REQUEST_SCHEMA&&typeof value.id==="string"&&typeof value.project==="string"&&value.payload,"Keep the complete original operation request.");
  const{digest,...body}=value;need(C.digest(body)===digest,"Original operation request changed.");
  if(value.payload.operation)need(value.payload.operation.id===value.id,"Core operation identity changed.");
  return value;
}
function binding(command,project,options){
  const kept={};for(const [key,value]of Object.entries(options)){if(key==="request"||key==="project")continue;kept[key]=["source","input","password-file"].includes(key)?absolute(value):value;}
  return{command,project,options:kept};
}
async function originalRequest(command,project,options,construct){
  const file=absolute(required(options,"request")),selected=binding(command,project,options);
  if(await exists(file)){
    const request=validateRequest(await json(file));need(C.canonical(request.binding)===C.canonical(selected),"The request file belongs to another selection. Use resume for its original bytes or choose a new request file.");
    return{request,file,reused:true};
  }
  const id=randomUUID(),at=iso(),payload=await construct({id,at});
  const request=requestEnvelope({command,project,binding:selected,payload,id,at});
  await atomic(file,encoded(request),{createOnly:true});
  return{request,file,reused:false};
}
export function advance(saved,request){
  validateRequest(request);
  if(request.payload.operation){
    const next=C.apply(saved.project,request.payload.operation);
    return{value:envelope(next.project,saved.origin),result:next.result,replayed:next.replayed};
  }
  const project=C.reopen(request.payload.initialProject);
  const origin={requestId:request.id,requestDigest:request.digest,kind:request.command,createdAt:request.at,selectedEdition:request.payload.selectedEdition||null,receivedSource:request.payload.receivedSource||null};
  if(saved){
    need(C.canonical(saved.origin)===C.canonical(origin),"Create and receive require a new project path. The existing project has another origin.");
    return{value:saved,result:{projectId:saved.project.id,selectedEdition:origin.selectedEdition},replayed:true};
  }
  return{value:envelope(project,origin),result:{projectId:project.id,selectedEdition:origin.selectedEdition},replayed:false};
}
async function commitRequest(request,file){
  const existing=await exists(request.project),saved=existing?await projectFile(request.project):null;
  need(existing||request.payload.initialProject,"The original project is missing; restore its complete handover before resuming this mutation.");
  const next=advance(saved?.value,request);
  if(next.replayed)await syncDirectory(path.dirname(request.project));
  const output=next.replayed?{path:request.project,bytes:saved.raw.length,sha256:saved.sha256,reused:true}:
    await atomic(request.project,encoded(next.value),{createOnly:!existing,expectedSha:saved?.sha256||null});
  return{status:"COMPLETED",operation:request.id,command:request.command,request:file,replayed:next.replayed,revision:next.value.project.revision,result:next.result,project:output};
}
function expected(options,project){
  if(options.expect===undefined)return project.revision;
  need(/^(0|[1-9]\d*)$/.test(options.expect)&&Number.isSafeInteger(Number(options.expect)),"Supply an integer --expect revision.");
  return Number(options.expect);
}
async function decodeOriginal(bytes,filename,passwordFile,at){
  let password="";if(passwordFile){const raw=await regular(absolute(passwordFile),16384);password=C.text(raw).replace(/\r?\n$/,"");}
  return C.capture(new Uint8Array(bytes),{filename,at,password,
    gunzip:async(data,max)=>new Uint8Array(gunzipSync(data,{maxOutputLength:max})),
    decrypt:async(data,secret)=>{
      need(data.length>=32,"Encrypted member lacks the original salt and IV.");
      const key=pbkdf2Sync(secret,data.subarray(0,16),10000,32,"sha512"),cipher=createDecipheriv("aes-256-ctr",key,data.subarray(16,32));
      try{return new Uint8Array(Buffer.concat([cipher.update(data.subarray(32)),cipher.final()]));}finally{key.fill(0);}
    }});
}
function summary(saved){
  const p=saved.project;
  return{schema:FILE_SCHEMA,id:p.id,name:p.name,revision:p.revision,origin:saved.origin,activeCapture:p.activeCapture,activePlan:p.activePlan,
    captures:p.captures.map(c=>({id:c.id,filename:c.filename,bytes:c.bytes,sha256:c.sha256,workspace:c.facts.workspace,counts:c.facts.counts,records:c.facts.documentCount,live:c.facts.liveDocumentCount,tombstones:c.facts.tombstoneCount})),
    plans:p.plans.map(p=>({id:p.id,digest:p.digest,captureId:p.captureId,target:p.target,cases:p.cases.length})),observations:p.observations.length,editions:p.editions};
}
async function sourceFiles(){
  const root=path.dirname(fileURLToPath(import.meta.url)),files=[];
  for(const name of ["cli.mjs","core.mjs","CLI_GUIDE.md","UPSTREAM_LICENSE.txt"]){const raw=await regular(path.join(root,name));files.push({name,...identity(raw),base64:raw.toString("base64")});}
  return files;
}
export async function execute(command,options){
  if(command==="help")return{commands:["create","open","capture","select","plan-template","plan-select","plan","observe","ready","issue","compare","handover","receive","source","resume","lease","lease-release"],guide:"Read CLI_GUIDE.md for complete original-source receiving and replay."};
  if(command==="resume"){
    allow(options,["request"]);const file=absolute(required(options,"request")),request=validateRequest(await json(file));
    need(await canonicalProject(request.project)===request.project,"The original project parent moved; receive its complete handover at a new path.");
    return withLease(request.project,"resume",()=>commitRequest(request,file));
  }
  const project=await canonicalProject(required(options,"project"));
  if(command==="lease"){allow(options,["project"]);const state=await leaseState(project);return{...state,liveness:state.lease&&!state.released?await alive(state.lease.owner):null};}
  if(command==="lease-release"){
    allow(options,["project","token"]);const state=await leaseState(project);
    need(state.lease&&state.lease.token===required(options,"token"),"Select the exact original lease token.");
    if(state.released)return{released:true,replayed:true,generation:state.generation};
    const live=await alive(state.lease.owner);need(live.status==="ended","The original process must be confirmed ended in its own host/PID namespace before release: "+live.reason);
    await release({...state.lease,directory:state.directory},"original-process-confirmed-ended");
    return{released:true,replayed:false,generation:state.generation,reason:live.reason};
  }
  if(["create","receive","capture","select","plan-select","plan","observe","issue"].includes(command)){
    const valid={create:["project","request","id","name"],receive:["project","request","input"],capture:["project","request","source","password-file","expect"],select:["project","request","capture","expect"],"plan-select":["project","request","plan","expect"],plan:["project","request","input","expect"],observe:["project","request","input","expect"],issue:["project","request","input","expect"]}[command];
    allow(options,valid);
    const requestPath=await canonicalProject(required(options,"request"));
    need(requestPath!==project&&!requestPath.startsWith(project+".leases"+path.sep),"Keep operation requests separate from the project and lease history.");
    options={...options,request:requestPath};
    return withLease(project,command,async()=>{
      const selected=await originalRequest(command,project,options,async({id,at})=>{
        if(command==="create")return{initialProject:C.newProject({id:required(options,"id"),name:required(options,"name"),at})};
        if(command==="receive"){
          const input=absolute(required(options,"input")),raw=await regular(input),bundle=JSON.parse(C.text(raw));
          const received=bundle?.schema==="tjlabs.budibase-complete-handover/v1"?C.receive(bundle):
            bundle?.schema===FILE_SCHEMA?{project:parseEnvelope(bundle).project,selectedEdition:null}:
            bundle?.schema===C.SCHEMA?{project:C.reopen(bundle),selectedEdition:null}:null;
          need(received,"Receive a complete handover, core project or original CLI project file.");
          return{initialProject:received.project,selectedEdition:received.selectedEdition,receivedSource:{name:path.basename(input),schema:bundle.schema,...identity(raw),originalCliOrigin:bundle.schema===FILE_SCHEMA?bundle.origin:null}};
        }
        const saved=await projectFile(project);let type,input;
        if(command==="capture"){const filename=absolute(required(options,"source")),bytes=await regular(filename,C.LIMITS.compressed);type="capture.add";input={capture:await decodeOriginal(bytes,path.basename(filename),options["password-file"],at)};}
        else if(command==="select"){type="capture.select";input={captureId:required(options,"capture")};}
        else if(command==="plan-select"){type="plan.select";input={planId:required(options,"plan")};}
        else{input=await json(absolute(required(options,"input")));type={plan:"plan.save",observe:"case.record",issue:"edition.issue"}[command];}
        return{operation:{id,at,type,expectedRevision:expected(options,saved.value.project),input}};
      });
      return commitRequest(selected.request,selected.file);
    });
  }
  const saved=(await projectFile(project)).value,p=saved.project;
  if(command==="open"){
    allow(options,["project","out"]);if(options.out)return atomic(absolute(options.out),encoded(p),{createOnly:true});return summary(saved);
  }
  if(command==="ready"){allow(options,["project"]);return C.ready(p);}
  if(command==="plan-template"){
    allow(options,["project","out"]);const c=p.captures.find(c=>c.id===p.activeCapture);need(c,"Capture the complete original export first.");
    const value={target:{installation:"",workspaceId:"",mode:c.facts.sourceContract.kind==="project"?"project-import":"new-workspace",sourceVersion:"",operator:"",reviewer:""},businessOutcome:"",changeScope:"",
      assignments:c.facts.entities.filter(e=>e.kind==="connector"||e.kind==="role").map(e=>({entityId:e.id,name:e.name,owner:"",decision:""})),
      issueResolutions:c.facts.issues.map(x=>({code:x.code,entityId:x.entityId,detail:x.detail,decision:""})),cases:C.suggestedCases(c),rollback:"",commercial:null};
    if(options.out)return atomic(absolute(options.out),encoded(value),{createOnly:true});return value;
  }
  if(command==="compare"){
    allow(options,["project","before","after","out"]);const before=p.captures.find(c=>c.id===required(options,"before")),after=p.captures.find(c=>c.id===required(options,"after"));
    need(before&&after,"Select both exact retained captures.");const value=C.compare(before,after);if(options.out)return atomic(absolute(options.out),encoded(value),{createOnly:true});return value;
  }
  if(command==="source"){
    allow(options,["project","capture","out"]);const capture=p.captures.find(c=>c.id===(options.capture||p.activeCapture));need(capture,"Select an original retained capture.");
    const bytes=Buffer.from(C.unbase64(capture.sourceBase64));need(sha(bytes)===capture.sha256&&bytes.length===capture.bytes,"Original source identity changed.");
    const output=await atomic(absolute(required(options,"out")),bytes,{createOnly:true});return{captureId:capture.id,originalFilename:capture.filename,...output};
  }
  if(command==="handover"){
    allow(options,["project","edition","out"]);const bundle=C.delivery(p,options.edition||null);
    bundle.cli={schema:"tjlabs.budibase-cli-handover/v1",origin:saved.origin,files:await sourceFiles()};
    const output=await atomic(absolute(required(options,"out")),encoded(bundle),{createOnly:true});
    return{selectedEdition:bundle.selectedEdition,projectDigest:bundle.projectDigest,captures:bundle.sourceDigests,programmeFiles:bundle.cli.files.map(({base64,...f})=>f),...output};
  }
  throw Error("Unknown command: "+command);
}
async function main(){
  process.umask(0o077);
  const {command,options}=argumentsOf(process.argv.slice(2));
  try{const value=await execute(command,options);process.stdout.write(JSON.stringify(value,null,2)+"\n");}
  catch(error){process.stderr.write(JSON.stringify({status:"ERROR",command,message:error.message,lease:error.lease||null,releaseError:error.releaseError||null})+"\n");process.exitCode=1;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
