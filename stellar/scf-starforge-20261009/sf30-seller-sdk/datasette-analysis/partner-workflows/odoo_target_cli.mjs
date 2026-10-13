#!/usr/bin/env node
/** Read-only Odoo target acquisition and original preparation/receiving. Node >=20. */
import {readFile,writeFile,mkdir,lstat,readdir,rename,rm,open,copyFile,link} from "node:fs/promises";
import {createReadStream,constants} from "node:fs";
import {createHash,randomUUID} from "node:crypto";
import {resolve,join,relative,dirname,sep,isAbsolute} from "node:path";
import {fileURLToPath} from "node:url";
import {hostname} from "node:os";
import {spawn} from "node:child_process";
import {canonical} from "./preparation.mjs";
import {CAPTURE_SCHEMA,SOURCE_SCHEMA,createCapture,validateCapture,nextRequest,checkResponse,acceptResponse,
 summarizePass,composePreparation,composeReconciliation} from "./odoo_target.mjs";
const HERE=fileURLToPath(new URL(".",import.meta.url));
const SOURCES=["preparation.mjs","profiles.mjs","prepare_cli.mjs","README.md","SOURCE_CONTRACTS.md",
 "odoo_target.mjs","odoo_target_cli.mjs","ODOO_TARGET.md"];
const CAPTURE_MANIFEST="stellar-forge.odoo-target-capture-manifest.v1";
const HANDOVER="stellar-forge.odoo-target-handover.v1";
const sha=value=>createHash("sha256").update(value).digest("hex");
const now=()=>new Date().toISOString();
const fail=(code,detail)=>{const e=new Error(code);e.code=code;e.detail=detail;throw e;};
const need=(ok,code,detail)=>{if(!ok)fail(code,detail);};
const object=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const output=value=>process.stdout.write(JSON.stringify(value)+"\n");
const json=raw=>JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(raw));
const delay=ms=>new Promise(done=>setTimeout(done,ms));
const allowedHeaders=["date","content-type","retry-after","x-request-id"];
function member(value){
 need(typeof value==="string"&&value.length>0&&!value.includes("\\")&&!value.includes("\0")&&
  !isAbsolute(value)&&value.split("/").every(p=>/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p)&&p!=="."&&p!==".."),"ORDINARY_RELATIVE_MEMBER_REQUIRED",value);
 return value;
}
async function regular(path,limit=128*1024*1024){
 const stat=await lstat(path);
 need(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=limit,"REGULAR_SOURCE_FILE_REQUIRED",path);
 return readFile(path);
}
async function absent(path){try{await lstat(path);return false;}catch(e){if(e.code==="ENOENT")return true;throw e;}}
async function ordinaryRoot(path){
 const root=resolve(path);let at=root;
 while(true){const s=await lstat(at);need(s.isDirectory()&&!s.isSymbolicLink(),"ORDINARY_DIRECTORY_REQUIRED",at);
  if(at===dirname(at))break;at=dirname(at);}
 return root;
}
async function sourcePath(root,name){
 member(name);const path=join(root,...name.split("/"));let at=dirname(path);
 while(at!==root){const s=await lstat(at);need(s.isDirectory()&&!s.isSymbolicLink(),"SOURCE_DIRECTORY_CHANGED",at);at=dirname(at);}
 const s=await lstat(path);need(s.isFile()&&!s.isSymbolicLink(),"SOURCE_FILE_CHANGED",name);return path;
}
async function identity(path){
 const before=await lstat(path);need(before.isFile()&&!before.isSymbolicLink(),"REGULAR_FILE_REQUIRED",path);
 const hash=createHash("sha256");let bytes=0;
 for await(const chunk of createReadStream(path)){hash.update(chunk);bytes+=chunk.length;}
 const after=await lstat(path);
 need(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&
  bytes===after.size,"SOURCE_CHANGED_DURING_READ",path);
 return {bytes,sha256:hash.digest("hex")};
}
async function exact(root,entry){
 member(entry.path);need(Number.isSafeInteger(entry.bytes)&&entry.bytes>=0&&/^[a-f0-9]{64}$/.test(entry.sha256),
  "SOURCE_DESCRIPTOR_INVALID",entry.path);
 const path=await sourcePath(root,entry.path),actual=await identity(path);
 need(actual.bytes===entry.bytes&&actual.sha256===entry.sha256,"RETAINED_SOURCE_CHANGED",entry.path);
 return path;
}
let captureWrites=null;
async function completeTemporary(path,raw,publish){
 await mkdir(dirname(path),{recursive:true,mode:0o700});await ordinaryRoot(dirname(path));
 const rel=captureWrites?relative(captureWrites.root,resolve(path)):null;
 const owned=captureWrites&&rel!==""&&rel!==".."&&!rel.startsWith(".."+sep)&&!isAbsolute(rel);
 const directory=owned?captureWrites.directory:dirname(path);
 await ordinaryRoot(directory);
 const temporary=owned?join(directory,"writing-"+randomUUID()):path+".writing-"+randomUUID();
 let file,created=false;
 try{
  file=await open(temporary,"wx",0o600);created=true;await file.writeFile(raw);await file.sync();
  await file.close();file=null;await publish(temporary);
 }finally{
  try{if(file)await file.close();}finally{if(created)await rm(temporary,{force:true});}
 }
}
async function atomic(path,value){
 const raw=typeof value==="string"||Buffer.isBuffer(value)?value:canonical(value)+"\n";
 await completeTemporary(path,raw,async temporary=>{
  if(!await absent(path)){
   const stat=await lstat(path);need(stat.isFile()&&!stat.isSymbolicLink(),"REGULAR_SOURCE_FILE_REQUIRED",path);
  }
  await rename(temporary,path);
 });
}
async function immutable(path,raw){
 const expected=Buffer.from(raw);
 if(!await absent(path)){
  need((await regular(path,Infinity)).equals(expected),"IMMUTABLE_SOURCE_CHANGED",path);return;
 }
 await completeTemporary(path,expected,async temporary=>{
  try{await link(temporary,path);}
  catch(e){
   if(e.code!=="EEXIST")throw e;
   need((await regular(path,Infinity)).equals(expected),"IMMUTABLE_SOURCE_CHANGED",path);
  }
 });
}
async function walk(root,directory="",ignore=new Set()){
 const result=[];
 for(const entry of await readdir(join(root,directory),{withFileTypes:true})){
  const name=directory?directory+"/"+entry.name:entry.name;
  if(ignore.has(name))continue;
  need(!entry.isSymbolicLink(),"SOURCE_SYMLINK",name);
  if(entry.isDirectory())result.push(...await walk(root,name,ignore));
  else {need(entry.isFile(),"SOURCE_MEMBER_TYPE",name);member(name);result.push({path:name,...await identity(join(root,name))});}
 }
 return result.sort((a,b)=>a.path.localeCompare(b.path,"en"));
}
async function copyExact(root,entries,destination){
 for(const entry of entries){
  const source=await exact(root,entry),target=join(destination,...member(entry.path).split("/"));
  await mkdir(dirname(target),{recursive:true,mode:0o700});
  await copyFile(source,target,constants.COPYFILE_EXCL);
  const actual=await identity(target);need(actual.bytes===entry.bytes&&actual.sha256===entry.sha256,"RECEIVED_MEMBER_CHANGED",entry.path);
 }
}
function argumentsFor(argv){
 const [command,...rest]=argv;need(["capture","inspect","prepare","reconcile","handover","receive"].includes(command),"COMMAND_REQUIRED");
 const a={command},allowed={
  capture:["config","out","token-env","max-attempts","timeout-seconds","recover-lock"],
  inspect:["input"],prepare:["input","contacts","out","installation"],
  reconcile:["input","baseline","native-result","out","installation"],
  handover:["input","prepared","out","baseline-capture","native-delivery"],receive:["input","out"]
 }[command];
 for(let i=0;i<rest.length;i+=2){
  need(rest[i]?.startsWith("--")&&rest[i+1]!==undefined,"ARGUMENT_VALUE_REQUIRED");
  const key=rest[i].slice(2);need(allowed.includes(key)&&!(key in a),"UNKNOWN_OR_DUPLICATE_ARGUMENT",key);a[key]=rest[i+1];
 }
 if(command==="capture")need(a.config&&a.out&&a["token-env"],"CAPTURE_CONFIG_OUTPUT_TOKEN_ENV_REQUIRED");
 else need(a.input,"INPUT_REQUIRED");
 if(["prepare","reconcile","handover","receive"].includes(command))need(a.out,"OUTPUT_REQUIRED");
 if(a.out)need(isAbsolute(a.out),"ABSOLUTE_OUTPUT_REQUIRED");
 if(command==="prepare")need(a.contacts,"ORIGINAL_CONTACT_SOURCE_INPUT_REQUIRED");
 if(command==="reconcile")need(a.baseline&&a["native-result"],"ORIGINAL_BASELINE_AND_NATIVE_IMPORT_RESULT_REQUIRED");
 if(command==="handover")need(a.prepared,"ORIGINAL_PREPARED_BUNDLE_REQUIRED");
 if(a["token-env"])need(/^[A-Za-z_][A-Za-z0-9_]*$/.test(a["token-env"]),"TOKEN_ENV_NAME_INVALID");
 return a;
}
async function lock(root,recover){
 const path=join(root,"capture.lock"),id=randomUUID(),record={schema:"stellar-forge.odoo-target-lock.v1",id,host:hostname(),pid:process.pid,createdAt:now()};
 try{await mkdir(path,{mode:0o700});}
 catch(e){
  if(e.code!=="EEXIST")throw e;
  const stat=await lstat(path);need(stat.isDirectory()&&!stat.isSymbolicLink(),"CAPTURE_LOCK_INVALID");
  const original=json(await regular(join(path,"owner.json")));
  need(original.schema===record.schema&&typeof original.id==="string","CAPTURE_LOCK_INVALID");
  let live=false,unknown=false;
  if(original.host===hostname()&&Number.isSafeInteger(original.pid)&&original.pid>0){
   try{process.kill(original.pid,0);live=true;}catch(x){if(x.code!=="ESRCH")unknown=true;}
  }else unknown=true;
  need(!live,"CAPTURE_ALREADY_RUNNING",{host:original.host,pid:original.pid,id:original.id});
  need(!unknown||recover===original.id,"CAPTURE_LOCK_OWNER_REQUIRES_RECONCILIATION",{id:original.id,host:original.host,pid:original.pid});
  const moved=join(root,"closed-lock-"+original.id+"-"+randomUUID());
  await rename(path,moved);await rm(moved,{recursive:true});await mkdir(path,{mode:0o700});
 }
 await immutable(join(path,"owner.json"),canonical(record)+"\n");
 return async()=>{
  try{const current=json(await regular(join(path,"owner.json")));if(current.id===id)await rm(path,{recursive:true});}
  catch(e){if(e.code!=="ENOENT")throw e;}
 };
}
async function sourceEdition(root){
 const entries=[];
 for(const name of SOURCES){
  const raw=await regular(join(HERE,name));await immutable(join(root,"source",name),raw);
  entries.push({path:"source/"+name,bytes:raw.length,sha256:sha(raw)});
 }
 const record={schema:"stellar-forge.odoo-target-acquisition-source.v1",files:entries};
 await immutable(join(root,"source-edition.json"),canonical(record)+"\n");
 const observed=await walk(join(root,"source"));
 need(canonical(observed)===canonical(entries.map(e=>({...e,path:e.path.slice(7)})).sort((a,b)=>a.path.localeCompare(b.path,"en"))),"SOURCE_EDITION_COMPLETE_FILES");
 return record;
}
async function loadState(root){
 const record=json(await regular(join(root,"state.json")));
 need(record.schema==="stellar-forge.odoo-target-state-record.v1"&&sha(canonical(record.state))===record.sha256,"TARGET_STATE_CHANGED");
 return validateCapture(record.state,sha);
}
async function saveState(root,state){
 await atomic(join(root,"state.json"),{schema:"stellar-forge.odoo-target-state-record.v1",state,sha256:sha(canonical(state))});
}
async function readAccepted(root,entry){return json(await regular(await exact(root,entry),Infinity));}
async function verifyWorking(root,state){
 const selected=json(await regular(join(root,"selection.json")));
 need(canonical(selected)===canonical(state.selection),"RETAINED_SELECTION_CHANGED");
 const edition=json(await regular(join(root,"source-edition.json")));
 need(edition.schema==="stellar-forge.odoo-target-acquisition-source.v1"&&Array.isArray(edition.files)&&
  canonical(edition.files.map(x=>x.path).sort())===canonical(SOURCES.map(x=>"source/"+x).sort()),"TARGET_SOURCE_EDITION_REQUIRED");
 for(const row of edition.files)await exact(root,row);
 for(const p of state.passes)for(const receipt of p.receipts){
  await exact(root,receipt);need(receipt.request&&receipt.response,"ORIGINAL_HTTP_RECEIPT_REQUIRED");
  const request=json(await regular(await exact(root,receipt.request))),meta=json(await regular(await exact(root,receipt.response)));
  need(meta.requestId===request.id&&meta.body?.path===receipt.path&&meta.body.sha256===receipt.sha256&&meta.body.bytes===receipt.bytes,
   "ORIGINAL_HTTP_RECEIPT_CHANGED");
  const {id,...requestBody}=request;
  need(id===sha(canonical(requestBody))&&request.selectionSha256===state.selectionSha256&&
   request.database===state.selection.database&&request.endpoint===state.selection.origin+(request.phase==="version"?"/web/version":"/json/2/"+request.model+"/"+request.method)&&
   request.httpMethod===(request.phase==="version"?"GET":"POST"),
   "RETAINED_TARGET_REQUEST_CHANGED");
  checkResponse(request,{status:meta.status,headers:meta.headers,body:await readAccepted(root,receipt)});
 }
 return edition;
}
async function fetchOriginal(root,request,token,timeout){
 const requestRaw=canonical(request)+"\n",requestPath="requests/"+request.id+".json";
 await immutable(join(root,requestPath),requestRaw);
 const requestDescriptor={path:requestPath,bytes:Buffer.byteLength(requestRaw),sha256:sha(requestRaw)};
 const attempt=randomUUID(),startedAt=now(),requestBody=request.httpMethod==="GET"?"":canonical(request.body);
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),timeout*1000);
 let status=null,headers={},raw=null,error=null;
 try{
  const response=await fetch(request.endpoint,{method:request.httpMethod,redirect:"error",signal:abort.signal,
   headers:{"Content-Type":"application/json","Authorization":"bearer "+token,"X-Odoo-Database":request.database,
    "User-Agent":"Commons-Odoo-Target-Source/1.0"},...(request.httpMethod==="POST"?{body:requestBody}:{})});
  status=response.status;
  for(const name of allowedHeaders){const value=response.headers.get(name);if(value!=null)headers[name]=value;}
  raw=Buffer.from(await response.arrayBuffer());
 }catch(e){error={code:e.name==="AbortError"?"SOURCE_HTTP_TIMEOUT":"SOURCE_HTTP_TRANSPORT",
  name:String(e.name||"Error"),causeCode:e.cause?.code?String(e.cause.code):null};}
 finally{clearTimeout(timer);}
 const completedAt=now(),bodyPath="raw/"+attempt+".json";
 let descriptor=null,body=null,decodeError=null;
 if(raw!==null){
  await immutable(join(root,bodyPath),raw);descriptor={path:bodyPath,bytes:raw.length,sha256:sha(raw)};
  try{body=json(raw);}catch(e){decodeError=String(e.name||"JSONDecodeError");}
 }
 const metadata={schema:"stellar-forge.odoo-json2-response.v1",requestId:request.id,attempt,request:requestDescriptor,
  endpoint:request.endpoint,method:request.httpMethod,startedAt,completedAt,status,headers,
  requestBody:{bytes:Buffer.byteLength(requestBody),sha256:sha(requestBody)},body:descriptor,error,decodeError};
 const responseRaw=canonical(metadata)+"\n",responsePath="responses/"+attempt+".json";
 await immutable(join(root,responsePath),responseRaw);
 return {metadata,body,envelope:{status,headers,body},receipt:descriptor?{...descriptor,request:requestDescriptor,
  response:{path:responsePath,bytes:Buffer.byteLength(responseRaw),sha256:sha(responseRaw)}}:null};
}
function retrySeconds(headers){
 const value=headers["retry-after"];if(value==null)return null;
 const number=Number(value);if(Number.isFinite(number)&&number>=0)return number;
 const time=Date.parse(value);return Number.isFinite(time)?Math.max(0,(time-Date.now())/1000):null;
}
async function waitUntil(root,seconds,requestId){
 const until=Date.now()+Math.max(0,seconds)*1000;
 await atomic(join(root,"wait.json"),{requestId,until:new Date(until).toISOString()});
 output({state:"ODOO_SOURCE_WAIT",requestId,seconds});
 while(Date.now()<until)await delay(Math.min(30000,until-Date.now()));
}
function targetBinding(state,target){
 need(target?.schema===SOURCE_SCHEMA&&target.complete===true&&target.targetScope===state.targetScope&&
  target.namespace===state.selection.namespace&&sha(canonical(target.observed))===state.result?.fingerprint&&
  canonical(target.rows)===canonical(target.observed.rows)&&canonical(target.issues)===canonical(target.observed.issues)&&
  target.targetBaselineComplete===(target.issues.length===0)&&target.source?.capture?.fingerprint===state.result?.fingerprint,
  "FINAL_TARGET_PROJECTION_CHANGED");
}
async function finalize(root,state){
 need(state.status==="complete"&&state.result,"COMPLETE_TARGET_CAPTURE_REQUIRED");
 const target=json(await regular(join(root,"target-source.json"),Infinity));targetBinding(state,target);
 const manifest={schema:CAPTURE_MANIFEST,operationId:state.operationId,targetScope:state.targetScope,
  selectionSha256:state.selectionSha256,sourceFingerprint:state.result.fingerprint,result:state.result,
  files:await walk(root,"",new Set(["capture-manifest.json","capture.lock"]))};
 await immutable(join(root,"capture-manifest.json"),canonical(manifest)+"\n");return manifest;
}
async function inspectCapture(directory,complete=true){
 const root=await ordinaryRoot(directory),state=await loadState(root);await verifyWorking(root,state);
 let manifest=null,manifestSha256=null,target=null;
 if(!await absent(join(root,"capture-manifest.json"))){
  const raw=await regular(join(root,"capture-manifest.json"));manifest=json(raw);manifestSha256=sha(raw);
  need(manifest.schema===CAPTURE_MANIFEST&&manifest.operationId===state.operationId&&manifest.targetScope===state.targetScope&&
   manifest.selectionSha256===state.selectionSha256&&manifest.sourceFingerprint===state.result?.fingerprint&&
   Array.isArray(manifest.files),"TARGET_CAPTURE_MANIFEST_CHANGED");
  const names=new Set();for(const row of manifest.files){need(!names.has(row.path)&&row.path!=="capture-manifest.json","TARGET_MEMBER_DUPLICATE");names.add(row.path);await exact(root,row);}
  need(canonical(await walk(root,"",new Set(["capture-manifest.json","capture.lock"])))===canonical(manifest.files),"TARGET_CAPTURE_FILE_SET_CHANGED");
  target=json(await regular(join(root,"target-source.json"),Infinity));targetBinding(state,target);
 }
 if(complete)need(state.status==="complete"&&manifest&&target,"COMPLETE_TARGET_CAPTURE_REQUIRED");
 return {root,state,manifest,manifestSha256,target};
}
async function capture(a){
 const config=json(await regular(resolve(a.config)));
 await mkdir(a.out,{recursive:true,mode:0o700});const root=await ordinaryRoot(a.out),release=await lock(root,a["recover-lock"]);
 captureWrites={root,directory:join(root,"capture.lock")};
 try{
  let state;
  if(await absent(join(root,"state.json"))){
   need((await readdir(root)).every(x=>["capture.lock","source","source-edition.json","selection.json"].includes(x)),"NEW_CAPTURE_DIRECTORY_MUST_BE_EMPTY");
   state=createCapture(config,sha,now());await sourceEdition(root);
   await immutable(join(root,"selection.json"),canonical(state.selection)+"\n");await saveState(root,state);
  }else{
   state=await loadState(root);need(createCapture(config,sha,state.createdAt).selectionSha256===state.selectionSha256,"ORIGINAL_TARGET_SELECTION_CHANGED");
   await verifyWorking(root,state);await sourceEdition(root);
  }
  if(state.status==="complete"){
   if(await absent(join(root,"capture-manifest.json")))await finalize(root,state);
   const saved=await inspectCapture(root);output({state:"ODOO_TARGET_CAPTURE_COMPLETE",directory:root,result:state.result,
    manifestSha256:saved.manifestSha256,replayed:true});return;
  }
  const token=process.env[a["token-env"]];need(typeof token==="string"&&token.trim().length>0,"EXISTING_API_KEY_ENV_REQUIRED",a["token-env"]);
  const attempts=Number(a["max-attempts"]??8),timeout=Number(a["timeout-seconds"]??60);
  need(Number.isSafeInteger(attempts)&&attempts>=1&&attempts<=100,"ATTEMPT_RANGE");
  need(Number.isFinite(timeout)&&timeout>=5&&timeout<=300,"HTTP_TIMEOUT_RANGE");
  if(!await absent(join(root,"wait.json"))){
   const pending=json(await regular(join(root,"wait.json"))),remaining=(Date.parse(pending.until)-Date.now())/1000;
   if(remaining>0)await waitUntil(root,remaining,pending.requestId);
  }
  while(state.status!=="complete"){
   if(state.phase==="summarize"){
    const result=await summarizePass(state,ref=>readAccepted(root,ref),sha,now());
    await atomic(join(root,"passes","pass-"+result.summary.pass+"-summary.json"),result.summary);
    await atomic(join(root,"passes","pass-"+result.summary.pass+"-source.json"),result.targetSource);
    if(result.state.status==="complete")await atomic(join(root,"target-source.json"),result.targetSource);
    state=result.state;await saveState(root,state);
    output({state:"ODOO_TARGET_SOURCE_PASS",operationId:state.operationId,...result.summary,accepted:state.status==="complete"});continue;
   }
   const request=nextRequest(state,sha);let advanced=false;
   for(let attempt=1;attempt<=attempts;attempt++){
    const result=await fetchOriginal(root,request,token,timeout);
    output({state:"ODOO_TARGET_RESPONSE",requestId:request.id,phase:request.phase,pass:request.pass,
     status:result.metadata.status,attempt,body:result.metadata.body,error:result.metadata.error});
    const retry=result.metadata.status===429||result.metadata.status>=500||result.metadata.error;
    if(retry){
     if(attempt===attempts)fail("SOURCE_RETRY_AVAILABLE",{requestId:request.id,attempts,lastResponse:result.metadata.attempt});
     await waitUntil(root,retrySeconds(result.metadata.headers)??Math.min(60,2**(attempt-1)),request.id);continue;
    }
    state=acceptResponse(state,request,result.envelope,result.receipt,sha,result.metadata.completedAt);
    await saveState(root,state);advanced=true;break;
   }
   need(advanced,"SOURCE_REQUEST_NOT_ADVANCED");
  }
  const manifest=await finalize(root,state),saved=await inspectCapture(root);
  output({state:"ODOO_TARGET_CAPTURE_COMPLETE",directory:root,operationId:state.operationId,result:state.result,
   files:manifest.files.length,manifestSha256:saved.manifestSha256,replayed:false});
 }finally{try{await release();}finally{captureWrites=null;}}
}
async function executableMatchesCapture(root){
 const edition=json(await regular(join(root,"source-edition.json")));
 for(const row of edition.files){
  const current=await regular(join(HERE,row.path.slice(7)));
  need(current.length===row.bytes&&sha(current)===row.sha256,"RUN_ORIGINAL_RETAINED_CAPTURE_SOURCE",row.path);
 }
}
async function runPreparation(args){
 return new Promise((resolvePromise,reject)=>{
  const child=spawn(process.execPath,[join(HERE,"prepare_cli.mjs"),...args],{stdio:["ignore","pipe","pipe"],env:process.env});
  let out="",err="";
  child.stdout.on("data",x=>out+=x);child.stderr.on("data",x=>err+=x);
  child.on("error",reject);child.on("close",code=>{
   if(code!==0){const e=new Error("ORIGINAL_PREPARATION_FAILED");e.code="ORIGINAL_PREPARATION_FAILED";
    e.detail={exitCode:code,stderr:err};reject(e);return;}
   try{const lines=out.trim().split("\n");resolvePromise(json(Buffer.from(lines.at(-1))));}
   catch(e){reject(e);}
  });
 });
}
async function validatePrepared(root,temporary){
 const result=await runPreparation(["receive","--input",root,"--out",temporary]);
 return result;
}
function separateOutput(source,out){
 const rel=relative(source,resolve(out));
 need(rel===".."||rel.startsWith(".."+sep)||isAbsolute(rel),"OUTPUT_MUST_BE_OUTSIDE_SOURCE");
}
async function prepareInput(captured,input,out,installation){
 await executableMatchesCapture(captured.root);
 separateOutput(captured.root,out);await ordinaryRoot(dirname(resolve(out)));
 const temporary=resolve(out)+".input-"+sha(canonical(input))+".json";
 await immutable(temporary,canonical(input)+"\n");
 try{
  const args=["prepare","--input",temporary,"--out",out];if(installation)args.push("--installation",resolve(installation));
  const result=await runPreparation(args);
  output({state:"ODOO_CONTACT_PREPARED",captureManifestSha256:captured.manifestSha256,...result});
 }finally{await rm(temporary,{force:true});}
}
async function prepare(a){
 const captured=await inspectCapture(a.input),raw=await regular(resolve(a.contacts)),contacts=json(raw);
 const input=composePreparation(contacts,captured.target,sha);
 input.source.originalContactInput.raw={bytes:raw.length,sha256:sha(raw),content:raw.toString("utf8")};
 return prepareInput(captured,input,a.out,a.installation);
}
async function reconcile(a){
 const captured=await inspectCapture(a.input),baseline=await ordinaryRoot(a.baseline);
 const checking=resolve(a.out)+".baseline-check-"+randomUUID();
 let original;
 try{await validatePrepared(baseline,checking);original=json(await regular(join(checking,"original-input.json"),Infinity));}
 finally{await rm(checking,{recursive:true,force:true});}
 const raw=await regular(resolve(a["native-result"]),Infinity),result=json(raw);
 const input=composeReconciliation(original,captured.target,result,sha);
 input.targetAfter.nativeResultSource={bytes:raw.length,sha256:sha(raw),content:raw.toString("utf8")};
 return prepareInput(captured,input,a.out,a.installation);
}
function inputRelations(input,current,before){
 need(input.kind==="odoo-contact-import-preparation"&&input.targetScope===current.state.targetScope&&
  input.namespace===current.target.namespace,"PREPARED_TARGET_SCOPE_CHANGED");
 const original=input.source?.targetCapture;
 need(original&&before.state.targetScope===current.state.targetScope&&
  original.capture?.fingerprint===before.state.result.fingerprint&&canonical(input.targetExisting)===canonical(before.target.rows)&&
  typeof input.targetBaselineComplete==="boolean","PREPARED_BASELINE_CHANGED");
 if(input.targetAfter){
  need(input.targetAfter.scope===current.state.targetScope&&input.targetAfter.source?.capture?.capture?.fingerprint===current.state.result.fingerprint&&
   canonical(input.targetAfter.rows)===canonical(current.target.rows)&&input.targetAfter.complete===true,"PREPARED_RECEIVED_TARGET_CHANGED");
  const raw=input.targetAfter.nativeResultSource;
  need(raw&&typeof raw.content==="string"&&Buffer.byteLength(raw.content)===raw.bytes&&sha(raw.content)===raw.sha256&&
   canonical(JSON.parse(raw.content))===canonical(input.targetAfter.nativeResult),"ORIGINAL_NATIVE_RESULT_BYTES_CHANGED");
 }else need(before.manifestSha256===current.manifestSha256,"CURRENT_CAPTURE_NOT_PREPARED_BASELINE");
 const retained=input.source.originalContactInput;
 need(retained&&sha(canonical(retained.content))===retained.sha256&&retained.raw&&
  Buffer.byteLength(retained.raw.content)===retained.raw.bytes&&sha(retained.raw.content)===retained.raw.sha256&&
  canonical(JSON.parse(retained.raw.content))===canonical(retained.content),"ORIGINAL_CONTACT_SOURCE_BYTES_CHANGED");
 const projected=composePreparation(retained.content,before.target,sha);
 need(input.targetBaselineComplete===projected.targetBaselineComplete&&
  canonical(input.source.targetPreparationIssues)===canonical(projected.source.targetPreparationIssues),"PREPARED_TARGET_ALIAS_REVIEW_CHANGED");
}
async function validateHandover(directory){
 const root=await ordinaryRoot(directory),raw=await regular(join(root,"handover.json")),manifest=json(raw);
 need(manifest.schema===HANDOVER&&Array.isArray(manifest.files)&&manifest.files.length>0,"HANDOVER_MANIFEST_REQUIRED");
 const names=new Set();
 for(const row of manifest.files){need(!names.has(row.path)&&row.path!=="handover.json","HANDOVER_DUPLICATE_MEMBER");names.add(row.path);await exact(root,row);}
 need(canonical(await walk(root,"",new Set(["handover.json"])))===canonical(manifest.files),"HANDOVER_COMPLETE_MEMBERS_CHANGED");
 const current=await inspectCapture(join(root,"capture"));
 const before=manifest.baselineCaptureManifestSha256?await inspectCapture(join(root,"baseline-capture")):current;
 need(manifest.captureManifestSha256===current.manifestSha256&&manifest.operationId===current.state.operationId&&
  manifest.targetScope===current.state.targetScope&&(!manifest.baselineCaptureManifestSha256||
  manifest.baselineCaptureManifestSha256===before.manifestSha256),"HANDOVER_TARGET_RELATION_CHANGED");
 const input=json(await regular(join(root,"prepared","original-input.json"),Infinity));inputRelations(input,current,before);
 need(sha(await regular(join(root,"prepared","manifest.json")))===manifest.preparedManifestSha256,"HANDOVER_PREPARED_MANIFEST_CHANGED");
 if(manifest.nativeDelivery){need(manifest.nativeDelivery.path==="native/delivery.zip","HANDOVER_NATIVE_PATH");await exact(root,manifest.nativeDelivery);}
 return {root,manifest,manifestSha256:sha(raw),current,before};
}
async function copyCapture(captured,target){
 await mkdir(target,{mode:0o700});
 await copyExact(captured.root,[...captured.manifest.files,{path:"capture-manifest.json",
  ...await identity(join(captured.root,"capture-manifest.json"))}],target);
}
async function handover(a){
 const captured=await inspectCapture(a.input),prepared=await ordinaryRoot(a.prepared),destination=resolve(a.out);
 const before=a["baseline-capture"]?await inspectCapture(a["baseline-capture"]):captured;
 separateOutput(captured.root,destination);separateOutput(prepared,destination);separateOutput(before.root,destination);
 if(!await absent(destination)){
  const saved=await validateHandover(destination);
  need(saved.current.manifestSha256===captured.manifestSha256&&saved.before.manifestSha256===before.manifestSha256,
   "HANDOVER_DESTINATION_DIFFERENT_SOURCE");
  const expectedPrepared=saved.manifest.files.filter(r=>r.path.startsWith("prepared/")).map(r=>({...r,path:r.path.slice(9)}));
  need(canonical(await walk(prepared))===canonical(expectedPrepared),"HANDOVER_DESTINATION_DIFFERENT_PREPARATION");
  need(Boolean(a["native-delivery"])===Boolean(saved.manifest.nativeDelivery),"HANDOVER_DESTINATION_DIFFERENT_NATIVE_DELIVERY");
  if(a["native-delivery"])need(canonical(await identity(resolve(a["native-delivery"])))===
   canonical({bytes:saved.manifest.nativeDelivery.bytes,sha256:saved.manifest.nativeDelivery.sha256}),"HANDOVER_DESTINATION_DIFFERENT_NATIVE_DELIVERY");
  output({state:"ODOO_TARGET_HANDOVER_COMPLETE",directory:destination,operationId:saved.manifest.operationId,
   files:saved.manifest.files.length,manifestSha256:saved.manifestSha256,nativeDelivery:saved.manifest.nativeDelivery,replayed:true});return;
 }
 await ordinaryRoot(dirname(destination));
 const stage=destination+".receiving-"+randomUUID();await mkdir(stage,{mode:0o700});
 try{
  await copyCapture(captured,join(stage,"capture"));await validatePrepared(prepared,join(stage,"prepared"));
  const input=json(await regular(join(stage,"prepared","original-input.json"),Infinity));inputRelations(input,captured,before);
  const separateBaseline=before.manifestSha256!==captured.manifestSha256;
  if(separateBaseline)await copyCapture(before,join(stage,"baseline-capture"));
  let nativeDelivery=null;
  if(a["native-delivery"]){
   const original=resolve(a["native-delivery"]),id=await identity(original);
   const file=await open(original,"r"),header=Buffer.alloc(4);try{await file.read(header,0,4,0);}finally{await file.close();}
   need(header[0]===80&&header[1]===75,"ORIGINAL_NATIVE_ZIP_REQUIRED");
   await mkdir(join(stage,"native"),{mode:0o700});await copyFile(original,join(stage,"native","delivery.zip"),constants.COPYFILE_EXCL);
   need(canonical(await identity(join(stage,"native","delivery.zip")))===canonical(id),"ORIGINAL_NATIVE_DELIVERY_CHANGED");
   nativeDelivery={path:"native/delivery.zip",originalName:original.split(sep).at(-1),...id};
  }
  const manifest={schema:HANDOVER,operationId:captured.state.operationId,createdAt:now(),targetScope:captured.state.targetScope,
   captureManifestSha256:captured.manifestSha256,baselineCaptureManifestSha256:separateBaseline?before.manifestSha256:null,
   preparedManifestSha256:sha(await regular(join(stage,"prepared","manifest.json"))),nativeDelivery,files:await walk(stage)};
  await immutable(join(stage,"handover.json"),canonical(manifest)+"\n");await validateHandover(stage);await rename(stage,destination);
  output({state:"ODOO_TARGET_HANDOVER_COMPLETE",directory:destination,operationId:manifest.operationId,
   files:manifest.files.length,manifestSha256:sha(canonical(manifest)+"\n"),nativeDelivery,replayed:false});
 }catch(e){await rm(stage,{recursive:true,force:true});throw e;}
}
async function receive(a){
 const original=await validateHandover(a.input),destination=resolve(a.out);separateOutput(original.root,destination);
 if(!await absent(destination)){
  const previous=await validateHandover(destination);need(previous.manifestSha256===original.manifestSha256,"RECEIVING_DESTINATION_DIFFERENT");
  output({state:"ODOO_TARGET_HANDOVER_RECEIVED",directory:destination,manifestSha256:previous.manifestSha256,replayed:true});return;
 }
 await ordinaryRoot(dirname(destination));const stage=destination+".receiving-"+randomUUID();await mkdir(stage,{mode:0o700});
 try{
  await validatePrepared(join(original.root,"prepared"),join(stage,"prepared"));
  await copyExact(original.root,original.manifest.files.filter(x=>!x.path.startsWith("prepared/")),stage);
  await immutable(join(stage,"handover.json"),await regular(join(original.root,"handover.json")));
  await validateHandover(stage);await rename(stage,destination);
  output({state:"ODOO_TARGET_HANDOVER_RECEIVED",directory:destination,operationId:original.manifest.operationId,
   manifestSha256:original.manifestSha256,replayed:false});
 }catch(e){await rm(stage,{recursive:true,force:true});throw e;}
}
async function main(){
 const a=argumentsFor(process.argv.slice(2));
 if(a.command==="capture")return capture(a);
 if(a.command==="prepare")return prepare(a);
 if(a.command==="reconcile")return reconcile(a);
 if(a.command==="handover")return handover(a);
 if(a.command==="receive")return receive(a);
 const saved=await inspectCapture(a.input,false);
 output({schema:CAPTURE_SCHEMA,directory:saved.root,status:saved.state.status,operationId:saved.state.operationId,
  phase:saved.state.phase,targetScope:saved.state.targetScope,selection:saved.state.selection,
  passes:saved.state.passes.map(p=>({number:p.number,summary:p.summary})),result:saved.state.result,
  manifestSha256:saved.manifestSha256,issues:saved.target?.issues??null});
}
main().catch(e=>{process.stderr.write(JSON.stringify({error:e.code||e.message,detail:e.detail??null})+"\n");process.exitCode=1;});
