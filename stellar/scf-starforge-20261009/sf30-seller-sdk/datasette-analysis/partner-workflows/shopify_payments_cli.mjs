#!/usr/bin/env node
/** Complete retained Shopify Payments acquisition, preparation and receiving. Node >=20. */
import {readFile,writeFile,mkdir,lstat,readdir,rename,rm,open,copyFile,link} from "node:fs/promises";
import {createReadStream,constants} from "node:fs";
import {createHash,randomUUID} from "node:crypto";
import {resolve,join,relative,dirname,sep,isAbsolute} from "node:path";
import {fileURLToPath} from "node:url";
import {hostname} from "node:os";
import {spawn} from "node:child_process";
import {canonical} from "./preparation.mjs";
import {CAPTURE_SCHEMA,createCapture,validateCapture,nextRequest,checkResponse,acceptResponse,summarizePass,reducePageSize} from "./shopify_payments.mjs";
const HERE=fileURLToPath(new URL(".",import.meta.url));
const SOURCES=["preparation.mjs","profiles.mjs","prepare_cli.mjs","README.md","SOURCE_CONTRACTS.md",
 "shopify_payments.mjs","shopify_payments_cli.mjs","SHOPIFY_PAYMENTS.md"];
const CAPTURE_MANIFEST="stellar-forge.shopify-payments-capture-manifest.v1";
const HANDOVER="stellar-forge.shopify-payments-handover.v1";
const sha=value=>createHash("sha256").update(value).digest("hex");
const now=()=>new Date().toISOString();
const fail=(code,detail)=>{const e=new Error(code);e.code=code;e.detail=detail;throw e;};
const need=(ok,code,detail)=>{if(!ok)fail(code,detail);};
const object=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const output=value=>process.stdout.write(JSON.stringify(value)+"\n");
const json=raw=>JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(raw));
const delay=ms=>new Promise(done=>setTimeout(done,ms));
const allowedHeaders=["date","content-type","retry-after","x-request-id","x-shopify-api-version",
 "x-shopify-api-deprecated-reason","x-shopify-shop-api-call-limit"];
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
 const [command,...rest]=argv;need(["capture","inspect","prepare","handover","receive"].includes(command),"COMMAND_REQUIRED");
 const a={command};
 const allowed={
  capture:["config","out","token-env","max-attempts","timeout-seconds","recover-lock"],
  inspect:["input"],prepare:["input","out","installation"],
  handover:["input","prepared","out","native-delivery"],receive:["input","out"]
 }[command];
 for(let i=0;i<rest.length;i+=2){
  need(rest[i]?.startsWith("--")&&rest[i+1]!==undefined,"ARGUMENT_VALUE_REQUIRED");
  const key=rest[i].slice(2);need(allowed.includes(key)&&!(key in a),"UNKNOWN_OR_DUPLICATE_ARGUMENT",key);a[key]=rest[i+1];
 }
 if(command==="capture")need(a.config&&a.out&&a["token-env"],"CAPTURE_CONFIG_OUTPUT_TOKEN_ENV_REQUIRED");
 else need(a.input,"INPUT_REQUIRED");
 if(["prepare","handover","receive"].includes(command))need(a.out,"OUTPUT_REQUIRED");
 if(a.out)need(isAbsolute(a.out),"ABSOLUTE_OUTPUT_REQUIRED");
 if(command==="handover")need(a.prepared,"PREPARED_BUNDLE_REQUIRED");
 if(a["token-env"])need(/^[A-Za-z_][A-Za-z0-9_]*$/.test(a["token-env"]),"TOKEN_ENV_NAME_INVALID");
 return a;
}
async function lock(root,recover){
 const path=join(root,"capture.lock"),id=randomUUID(),record={schema:"stellar-forge.shopify-capture-lock.v1",id,host:hostname(),pid:process.pid,createdAt:now()};
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
 const record={schema:"stellar-forge.shopify-acquisition-source.v1",files:entries};
 await immutable(join(root,"source-edition.json"),canonical(record)+"\n");
 const observed=await walk(join(root,"source"));
 need(canonical(observed)===canonical(entries.map(e=>({...e,path:e.path.slice(7)})).sort((a,b)=>a.path.localeCompare(b.path,"en"))),"SOURCE_EDITION_COMPLETE_FILES");
 return record;
}
async function loadState(root){
 const record=json(await regular(join(root,"state.json")));
 need(record.schema==="stellar-forge.shopify-capture-state-record.v1"&&sha(canonical(record.state))===record.sha256,
  "CAPTURE_STATE_RECORD_CHANGED");
 return validateCapture(record.state,sha);
}
async function saveState(root,state){
 await atomic(join(root,"state.json"),{schema:"stellar-forge.shopify-capture-state-record.v1",state,sha256:sha(canonical(state))});
}
function stateReceipts(state){
 return [state.identityReceipt,...state.passes.flatMap(p=>[
  p.payouts.anchorReceipt,p.transactions.anchorReceipt,...p.payouts.pages,...p.transactions.pages])].filter(Boolean);
}
async function readAccepted(root,entry){
 const raw=await regular(await exact(root,entry),Infinity);
 const response=json(raw);need(object(response),"RETAINED_GRAPHQL_BODY_INVALID",entry.path);return response;
}
async function verifyWorking(root,state){
 const selected=json(await regular(join(root,"selection.json")));
 need(canonical(selected)===canonical(state.selection),"RETAINED_SELECTION_CHANGED");
 const edition=json(await regular(join(root,"source-edition.json")));
 need(edition.schema==="stellar-forge.shopify-acquisition-source.v1"&&Array.isArray(edition.files)&&edition.files.length===SOURCES.length,
  "ORIGINAL_SOURCE_EDITION_REQUIRED");
 need(canonical(edition.files.map(x=>x.path).sort())===canonical(SOURCES.map(x=>"source/"+x).sort()),"SOURCE_EDITION_MEMBERS");
 for(const row of edition.files)await exact(root,row);
 const seen=new Set();
 for(const receipt of stateReceipts(state)){
  if(seen.has(receipt.path))continue;seen.add(receipt.path);
  await exact(root,receipt);
  need(receipt.response&&receipt.request,"ORIGINAL_HTTP_REQUEST_AND_RESPONSE_REQUIRED");
  const request=json(await regular(await exact(root,receipt.request)));
  const metadata=json(await regular(await exact(root,receipt.response)));
  need(metadata.requestId===request.id&&metadata.body.path===receipt.path&&
   metadata.body.sha256===receipt.sha256&&metadata.body.bytes===receipt.bytes,"HTTP_BODY_RECEIPT_CHANGED",receipt.path);
  const rawBody=await readAccepted(root,receipt);
  checkResponse(request,{status:metadata.status,headers:metadata.headers,body:rawBody},state.selection.apiVersion);
 }
 return edition;
}
function retrySeconds(headers,body){
 const retry=headers["retry-after"];
 if(retry){
  const seconds=Number(retry);
  if(Number.isFinite(seconds)&&seconds>=0)return seconds;
  const time=Date.parse(retry);if(Number.isFinite(time))return Math.max(0,(time-Date.now())/1000);
 }
 const cost=body?.extensions?.cost,throttle=cost?.throttleStatus;
 if(Number.isFinite(throttle?.restoreRate)&&throttle.restoreRate>0&&Number.isFinite(throttle.currentlyAvailable)){
  const wanted=Number.isFinite(cost.requestedQueryCost)?cost.requestedQueryCost:1;
  return Math.max(1,(wanted-throttle.currentlyAvailable)/throttle.restoreRate);
 }
 return null;
}
async function waitUntil(root,seconds,reason,requestId){
 const until=Date.now()+Math.max(0,seconds)*1000;
 await atomic(join(root,"wait.json"),{schema:"stellar-forge.shopify-capture-wait.v1",requestId,reason,until:new Date(until).toISOString()});
 output({state:"SHOPIFY_SOURCE_WAIT",requestId,reason,seconds});
 while(Date.now()<until)await delay(Math.min(30000,until-Date.now()));
}
async function fetchOriginal(root,request,token,timeout){
 const requestRaw=canonical(request)+"\n",requestPath="requests/"+request.id+".json";
 await immutable(join(root,requestPath),requestRaw);
 const requestDescriptor={path:requestPath,bytes:Buffer.byteLength(requestRaw),sha256:sha(requestRaw)};
 const attempt=randomUUID(),startedAt=now();
 const requestBody=canonical({query:request.query,variables:request.variables});
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),timeout*1000);
 let status=null,headers={},raw=null,error=null;
 try{
  const response=await fetch(request.endpoint,{method:"POST",redirect:"error",signal:abort.signal,
   headers:{"Content-Type":"application/json","X-Shopify-Access-Token":token,"Shopify-Search-Query-Debug":"1"},
   body:requestBody});
  status=response.status;
  for(const name of allowedHeaders){const value=response.headers.get(name);if(value!=null)headers[name]=value;}
  raw=Buffer.from(await response.arrayBuffer());
 }catch(e){error={code:e.name==="AbortError"?"SOURCE_HTTP_TIMEOUT":"SOURCE_HTTP_TRANSPORT",
   name:String(e.name||"Error"),causeCode:e.cause?.code?String(e.cause.code):null};}
 finally{clearTimeout(timer);}
 const completedAt=now(),bodyPath="raw/"+attempt+".json";
 let bodyDescriptor=null,body=null,decodeError=null;
 if(raw!==null){
  await immutable(join(root,bodyPath),raw);
  bodyDescriptor={path:bodyPath,bytes:raw.length,sha256:sha(raw)};
  try{body=json(raw);}catch(e){decodeError=String(e.name||"JSONDecodeError");}
 }
 const metadata={schema:"stellar-forge.shopify-http-response.v1",requestId:request.id,attempt,
  request:requestDescriptor,endpoint:request.endpoint,method:"POST",startedAt,completedAt,status,headers,
  requestBody:{bytes:Buffer.byteLength(requestBody),sha256:sha(requestBody)},body:bodyDescriptor,error,decodeError,
  cost:body?.extensions?.cost??null,search:body?.extensions?.search??null};
 const responseRaw=canonical(metadata)+"\n",responsePath="responses/"+attempt+".json";
 await immutable(join(root,responsePath),responseRaw);
 const responseDescriptor={path:responsePath,bytes:Buffer.byteLength(responseRaw),sha256:sha(responseRaw)};
 return {metadata,body,envelope:{status,headers,body},receipt:bodyDescriptor?{...bodyDescriptor,
  request:requestDescriptor,response:responseDescriptor}:null};
}
async function finalize(root,state){
 need(state.status==="complete"&&state.result,"COMPLETE_CAPTURE_REQUIRED");
 const inputRaw=await regular(join(root,"original-input.json")),input=json(inputRaw);
 need(input.complete===true&&input.source?.sourceCapture?.fingerprint===state.result.fingerprint,
  "FINAL_SOURCE_INPUT_CHANGED");
 const entries=await walk(root,"",new Set(["capture-manifest.json","capture.lock"]));
 const manifest={schema:CAPTURE_MANIFEST,operationId:state.operationId,
  selectionSha256:state.selectionSha256,sourceFingerprint:state.result.fingerprint,
  result:state.result,files:entries};
 await immutable(join(root,"capture-manifest.json"),canonical(manifest)+"\n");
 return manifest;
}
async function inspectCapture(directory,complete=true){
 const root=await ordinaryRoot(directory),state=await loadState(root);
 await verifyWorking(root,state);
 let manifest=null,manifestSha256=null;
 if(!await absent(join(root,"capture-manifest.json"))){
  const raw=await regular(join(root,"capture-manifest.json"));manifest=json(raw);manifestSha256=sha(raw);
  need(manifest.schema===CAPTURE_MANIFEST&&manifest.operationId===state.operationId&&
   manifest.selectionSha256===state.selectionSha256&&manifest.sourceFingerprint===state.result?.fingerprint,
   "CAPTURE_MANIFEST_CHANGED");
  need(Array.isArray(manifest.files),"CAPTURE_FILE_INVENTORY_REQUIRED");
  const paths=new Set();
  for(const entry of manifest.files){need(!paths.has(entry.path)&&entry.path!=="capture-manifest.json","CAPTURE_MEMBER_DUPLICATE");
   paths.add(entry.path);await exact(root,entry);}
  const actual=await walk(root,"",new Set(["capture-manifest.json","capture.lock"]));
  need(canonical(actual)===canonical(manifest.files),"CAPTURE_COMPLETE_FILE_SET_CHANGED");
  const input=json(await regular(join(root,"original-input.json")));
  need(input.complete===true&&input.source?.sourceCapture?.fingerprint===state.result?.fingerprint,
   "FINAL_SOURCE_INPUT_CHANGED");
  const projection={kind:input.kind,policy:input.policy,balanceTransactions:input.balanceTransactions,
   payouts:input.payouts,orders:input.orders};
  need(sha(canonical(projection))===state.result.fingerprint,"FINAL_PROJECTED_ROWS_CHANGED");
 }
 if(complete)need(state.status==="complete"&&manifest,"COMPLETE_CAPTURE_REQUIRED");
 return {root,state,manifest,manifestSha256};
}
async function capture(a){
 const config=json(await regular(resolve(a.config)));
 await mkdir(a.out,{recursive:true,mode:0o700});const root=await ordinaryRoot(a.out);
 const release=await lock(root,a["recover-lock"]);
 captureWrites={root,directory:join(root,"capture.lock")};
 try{
  let state;
  if(await absent(join(root,"state.json"))){
   const members=await readdir(root);
   need(members.every(x=>["capture.lock","source","source-edition.json","selection.json"].includes(x)),"NEW_CAPTURE_DIRECTORY_MUST_BE_EMPTY");
   state=createCapture(config,sha,now());
   await sourceEdition(root);await immutable(join(root,"selection.json"),canonical(state.selection)+"\n");await saveState(root,state);
  }else{
   state=await loadState(root);
   const proposed=createCapture(config,sha,state.createdAt);
   need(proposed.selectionSha256===state.selectionSha256,"ORIGINAL_CAPTURE_SELECTION_CHANGED");
   await verifyWorking(root,state);await sourceEdition(root);
  }
  if(state.status==="complete"){
   if(await absent(join(root,"capture-manifest.json")))await finalize(root,state);
   const finished=await inspectCapture(root);
   output({state:"SHOPIFY_CAPTURE_COMPLETE",directory:root,operationId:state.operationId,result:state.result,
    manifestSha256:finished.manifestSha256,replayed:true});return;
  }
  const token=process.env[a["token-env"]];
  need(typeof token==="string"&&token.trim().length>0,"EXISTING_ACCESS_TOKEN_ENV_REQUIRED",a["token-env"]);
  const attempts=Number(a["max-attempts"]??8),timeout=Number(a["timeout-seconds"]??60);
  need(Number.isSafeInteger(attempts)&&attempts>=1&&attempts<=100,"ATTEMPT_RANGE");
  need(Number.isFinite(timeout)&&timeout>=5&&timeout<=300,"HTTP_TIMEOUT_RANGE");
  if(!await absent(join(root,"wait.json"))){
   const pending=json(await regular(join(root,"wait.json")));const remaining=(Date.parse(pending.until)-Date.now())/1000;
   if(remaining>0)await waitUntil(root,remaining,pending.reason,pending.requestId);
  }
  while(state.status!=="complete"){
   if(state.phase==="summarize"){
    const result=await summarizePass(state,entry=>readAccepted(root,entry),sha,now());
    await atomic(join(root,"passes","pass-"+result.summary.pass+"-summary.json"),result.summary);
    await atomic(join(root,"passes","pass-"+result.summary.pass+"-input.json"),result.originalInput);
    if(result.state.status==="complete")await atomic(join(root,"original-input.json"),result.originalInput);
    state=result.state;await saveState(root,state);
    output({state:"SHOPIFY_SOURCE_PASS",operationId:state.operationId,...result.summary,
     accepted:state.status==="complete"});continue;
   }
   let request=nextRequest(state,sha),advanced=false;
   for(let attempt=1;attempt<=attempts;attempt++){
    const result=await fetchOriginal(root,request,token,timeout),body=result.body,
     errors=Array.isArray(body?.errors)?body.errors:[],codes=errors.map(x=>x?.extensions?.code);
    output({state:"SHOPIFY_SOURCE_RESPONSE",requestId:request.id,phase:request.phase,pass:request.pass,
     status:result.metadata.status,attempt,body:result.metadata.body,error:result.metadata.error,
     cost:result.metadata.cost});
    const served=result.metadata.headers["x-shopify-api-version"];
    if(served!=null&&served!==state.selection.apiVersion)
     fail("SHOPIFY_SERVED_VERSION_CHANGED",{selected:state.selection.apiVersion,served});
    if(codes.includes("MAX_COST_EXCEEDED")){
     const previousSize=state.pageSize;state=reducePageSize(state,request,sha,now());
     await atomic(join(root,"cost-adjustments",result.metadata.attempt+".json"),{
      requestId:request.id,response:result.receipt,previousSize,pageSize:state.pageSize,at:state.updatedAt});
     await saveState(root,state);advanced=true;break;
    }
    const throttle=result.metadata.status===429||codes.includes("THROTTLED");
    const retry=throttle||codes.includes("INTERNAL_SERVER_ERROR")||result.metadata.error||result.metadata.status>=500;
    if(retry){
     if(attempt===attempts)fail("SOURCE_RETRY_AVAILABLE",{requestId:request.id,attempts,lastResponse:result.metadata.attempt});
     const seconds=retrySeconds(result.metadata.headers,body)??Math.min(60,2**(attempt-1));
     await waitUntil(root,seconds,throttle?"provider-throttle":"source-transport",request.id);continue;
    }
    state=acceptResponse(state,request,result.envelope,result.receipt,sha,result.metadata.completedAt);
    await saveState(root,state);advanced=true;
    const cost=body?.extensions?.cost,throttleStatus=cost?.throttleStatus;
    if(Number.isFinite(cost?.requestedQueryCost)&&Number.isFinite(throttleStatus?.currentlyAvailable)&&
     Number.isFinite(throttleStatus?.restoreRate)&&throttleStatus.restoreRate>0&&
     throttleStatus.currentlyAvailable<cost.requestedQueryCost)
     await waitUntil(root,(cost.requestedQueryCost-throttleStatus.currentlyAvailable)/throttleStatus.restoreRate,
      "observed-query-cost",request.id);
    break;
   }
   need(advanced,"SOURCE_REQUEST_NOT_ADVANCED",request.id);
  }
  const manifest=await finalize(root,state),finished=await inspectCapture(root);
  output({state:"SHOPIFY_CAPTURE_COMPLETE",directory:root,operationId:state.operationId,result:state.result,
   files:manifest.files.length,manifestSha256:finished.manifestSha256,replayed:false});
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
async function prepare(a){
 const capture=await inspectCapture(a.input);
 await executableMatchesCapture(capture.root);
 const command=["prepare","--input",join(capture.root,"original-input.json"),"--out",a.out];
 if(a.installation)command.push("--installation",resolve(a.installation));
 const result=await runPreparation(command);
 output({state:"SHOPIFY_RETAIL_PREPARED",capture: capture.root,captureManifestSha256:capture.manifestSha256,...result});
}
async function validateHandover(directory){
 const root=await ordinaryRoot(directory),raw=await regular(join(root,"handover.json")),manifest=json(raw);
 need(manifest.schema===HANDOVER&&Array.isArray(manifest.files)&&manifest.files.length>0,"HANDOVER_MANIFEST_REQUIRED");
 const names=new Set();
 for(const entry of manifest.files){
  need(!names.has(entry.path)&&entry.path!=="handover.json","HANDOVER_DUPLICATE_MEMBER");names.add(entry.path);await exact(root,entry);
 }
 need(canonical(await walk(root,"",new Set(["handover.json"])))===canonical(manifest.files),"HANDOVER_COMPLETE_MEMBERS_CHANGED");
 const captured=await inspectCapture(join(root,"capture"));
 need(manifest.captureManifestSha256===captured.manifestSha256&&manifest.operationId===captured.state.operationId&&
  manifest.sourceFingerprint===captured.state.result.fingerprint,"HANDOVER_CAPTURE_RELATION_CHANGED");
 const input=await regular(join(root,"prepared","original-input.json"));
 need(sha(input)===sha(await regular(join(root,"capture","original-input.json"))),"HANDOVER_PREPARED_INPUT_CHANGED");
 const prepared=await regular(join(root,"prepared","manifest.json"));
 need(sha(prepared)===manifest.preparedManifestSha256,"HANDOVER_PREPARED_MANIFEST_CHANGED");
 if(manifest.nativeDelivery){
  need(manifest.nativeDelivery.path==="native/delivery.zip","HANDOVER_NATIVE_PATH");
  await exact(root,manifest.nativeDelivery);
 }
 return {root,manifest,manifestSha256:sha(raw),capture:captured};
}
function separateOutput(source,out){
 const rel=relative(source,resolve(out));
 need(rel===".."||rel.startsWith(".."+sep)||isAbsolute(rel),"OUTPUT_MUST_BE_OUTSIDE_SOURCE");
}
async function handover(a){
 const captured=await inspectCapture(a.input),prepared=await ordinaryRoot(a.prepared),destination=resolve(a.out);
 separateOutput(captured.root,destination);separateOutput(prepared,destination);
 need(await absent(destination),"FRESH_HANDOVER_DESTINATION_REQUIRED");
 await ordinaryRoot(dirname(destination));
 const stage=destination+".receiving-"+randomUUID();await mkdir(stage,{mode:0o700});
 try{
  await mkdir(join(stage,"capture"),{mode:0o700});
  const rows=[...captured.manifest.files,{path:"capture-manifest.json",...await identity(join(captured.root,"capture-manifest.json"))}];
  await copyExact(captured.root,rows,join(stage,"capture"));
  await validatePrepared(prepared,join(stage,"prepared"));
  const preparedInput=await regular(join(stage,"prepared","original-input.json"));
  need(sha(preparedInput)===sha(await regular(join(captured.root,"original-input.json"))),"PREPARATION_NOT_FROM_THIS_CAPTURE");
  let nativeDelivery=null;
  if(a["native-delivery"]){
   const original=resolve(a["native-delivery"]),id=await identity(original);
   const file=await open(original,"r");const header=Buffer.alloc(4);try{await file.read(header,0,4,0);}finally{await file.close();}
   need(header[0]===80&&header[1]===75,"ORIGINAL_NATIVE_ZIP_REQUIRED");
   await mkdir(join(stage,"native"),{mode:0o700});await copyFile(original,join(stage,"native","delivery.zip"),constants.COPYFILE_EXCL);
   need(canonical(await identity(join(stage,"native","delivery.zip")))===canonical(id),"ORIGINAL_NATIVE_DELIVERY_CHANGED");
   nativeDelivery={path:"native/delivery.zip",originalName:original.split(sep).at(-1),...id};
  }
  const manifest={schema:HANDOVER,operationId:captured.state.operationId,createdAt:now(),
   sourceFingerprint:captured.state.result.fingerprint,captureManifestSha256:captured.manifestSha256,
   preparedManifestSha256:sha(await regular(join(stage,"prepared","manifest.json"))),nativeDelivery,
   files:await walk(stage)};
  await immutable(join(stage,"handover.json"),canonical(manifest)+"\n");await validateHandover(stage);
  await rename(stage,destination);
  output({state:"SHOPIFY_HANDOVER_COMPLETE",directory:destination,operationId:manifest.operationId,
   files:manifest.files.length,manifestSha256:sha(canonical(manifest)+"\n"),nativeDelivery});
 }catch(e){await rm(stage,{recursive:true,force:true});throw e;}
}
async function receive(a){
 const original=await validateHandover(a.input),destination=resolve(a.out);
 separateOutput(original.root,destination);
 if(!await absent(destination)){
  const previous=await validateHandover(destination);
  need(previous.manifestSha256===original.manifestSha256,"RECEIVING_DESTINATION_DIFFERENT");
  output({state:"SHOPIFY_HANDOVER_RECEIVED",directory:destination,manifestSha256:previous.manifestSha256,replayed:true});return;
 }
 await ordinaryRoot(dirname(destination));const stage=destination+".receiving-"+randomUUID();await mkdir(stage,{mode:0o700});
 try{
  // The original receiver validates and reconstructs its own complete preparation.
  await validatePrepared(join(original.root,"prepared"),join(stage,"prepared"));
  await copyExact(original.root,original.manifest.files.filter(x=>!x.path.startsWith("prepared/")),stage);
  await immutable(join(stage,"handover.json"),await regular(join(original.root,"handover.json")));
  await validateHandover(stage);await rename(stage,destination);
  output({state:"SHOPIFY_HANDOVER_RECEIVED",directory:destination,operationId:original.manifest.operationId,
   manifestSha256:original.manifestSha256,replayed:false});
 }catch(e){await rm(stage,{recursive:true,force:true});throw e;}
}
async function main(){
 const a=argumentsFor(process.argv.slice(2));
 if(a.command==="capture")return capture(a);
 if(a.command==="prepare")return prepare(a);
 if(a.command==="handover")return handover(a);
 if(a.command==="receive")return receive(a);
 const inspected=await inspectCapture(a.input,false);
 output({schema:CAPTURE_SCHEMA,directory:inspected.root,status:inspected.state.status,
  operationId:inspected.state.operationId,phase:inspected.state.phase,pageSize:inspected.state.pageSize,
  identity:inspected.state.identity,selection:inspected.state.selection,
  passes:inspected.state.passes.map(p=>({number:p.number,summary:p.summary,
   payouts:p.payouts.rows,transactions:p.transactions.rows})),
  result:inspected.state.result,manifestSha256:inspected.manifestSha256});
}
main().catch(e=>{
 process.stderr.write(JSON.stringify({error:e.code||e.message,detail:e.detail??null})+"\n");process.exitCode=1;
});
