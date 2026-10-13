#!/usr/bin/env node
/** Native read-only Xero acquisition and complete source/decision receiving. Node >=20. */
import {readFile,writeFile,mkdir,rename,rm,link,lstat} from "node:fs/promises";
import {createHash,randomUUID} from "node:crypto";
import {resolve,dirname,join,isAbsolute} from "node:path";
import {fileURLToPath} from "node:url";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {canonical} from "./preparation.mjs";
import {CAPTURE_SCHEMA,contactsURL,pageValue,validateCapture,reviewCapture,normalizeContacts,compareCaptures} from "./xero_contacts.mjs";
const HERE=fileURLToPath(new URL(".",import.meta.url)),run=promisify(execFile);
const SOURCES=["xero_contacts.mjs","xero_contacts_cli.mjs","XERO_CONTACTS.md"];
const sha=x=>createHash("sha256").update(x).digest("hex");
const json=x=>canonical(x)+"\n";
const fail=(code,detail)=>{const e=new Error(code);e.code=code;e.detail=detail;throw e;};
const need=(ok,code,detail)=>{if(!ok)fail(code,detail);};
const now=()=>new Date().toISOString(),pause=ms=>new Promise(r=>setTimeout(r,ms));
const descriptor=(path,content,contentType="application/json")=>({path,bytes:Buffer.byteLength(content),sha256:sha(content),contentType,content});
async function read(path){const st=await lstat(path);need(st.isFile()&&!st.isSymbolicLink()&&st.size<=128*1024*1024,"REGULAR_SOURCE_FILE_REQUIRED",path);return readFile(path);}
async function readJSON(path){return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(await read(path)));}
async function unchangedWrite(path,content){
  const temporary=path+".writing-"+randomUUID();
  try{
    await writeFile(temporary,content,{flag:"wx",mode:0o600});
    try{await link(temporary,path);}
    catch(e){if(e.code!=="EEXIST")throw e;need((await read(path)).equals(Buffer.from(content)),"EXISTING_FILE_DIFFERS",path);}
  }finally{await rm(temporary,{force:true});}
}
async function atomic(path,value){const serialized=json(value);need(Buffer.byteLength(serialized)<=128*1024*1024,"STATE_SIZE_LIMIT",path);const tmp=path+".writing-"+randomUUID();try{await writeFile(tmp,serialized,{flag:"wx",mode:0o600});await rename(tmp,path);}finally{await rm(tmp,{force:true});}}
function argumentsOf(argv){
  const [command,...rest]=argv,allowed={
    capture:["state","tenant","token-env","page-size","max-records"],
    review:["capture","out"],prepare:["capture","decisions","out","installation"],
    receive:["input","out"],compare:["before","after","out"]};
  need(allowed[command]&&rest.length%2===0,"COMMAND_OR_ARGUMENT_INVALID");
  const a={command};for(let i=0;i<rest.length;i+=2){
    const k=rest[i].replace(/^--/,"");need(rest[i].startsWith("--")&&allowed[command].includes(k)&&!(k in a)&&rest[i+1],"ARGUMENT_INVALID",rest[i]);a[k]=rest[i+1];
  }return a;
}
async function requestPage(state,page,token){
  await pause(1100);
  const url=contactsURL(page,state.pageSize);
  const res=await fetch(url,{headers:{Authorization:"Bearer "+token,"xero-tenant-id":state.tenantId,Accept:"application/json"},redirect:"error",signal:AbortSignal.timeout(30000)});
  const raw=Buffer.from(await res.arrayBuffer());need(raw.length<=16*1024*1024,"XERO_PAGE_TOO_LARGE");
  const bodyText=new TextDecoder("utf-8",{fatal:true}).decode(raw);
  const headers={};for(const k of ["date","xero-correlation-id","retry-after","x-daylimit-remaining","x-minlimit-remaining","x-appminlimit-remaining","x-rate-limit-problem"])if(res.headers.has(k))headers[k]=res.headers.get(k);
  return{url,page,status:res.status,receivedAt:now(),headers,bodyText,sha256:sha(bodyText)};
}
function afterDelay(entry){
  const raw=entry.headers["retry-after"],seconds=Number(raw);
  return {retryAt:new Date(Date.now()+(Number.isFinite(seconds)&&seconds>=0?seconds*1000:60000)).toISOString(),
    source:Number.isFinite(seconds)&&seconds>=0?"Xero Retry-After seconds":"60-second fallback: Retry-After absent"};
}
async function capture(a){
  need(a.state&&isAbsolute(a.state)&&a.tenant&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(a.tenant),"CAPTURE_STATE_AND_TENANT_REQUIRED");
  const pageSize=Number(a["page-size"]||1000),maxRecords=Number(a["max-records"]||100000);
  need(Number.isSafeInteger(pageSize)&&pageSize>=1&&pageSize<=1000&&Number.isSafeInteger(maxRecords)&&maxRecords>=0&&maxRecords<=100000,"CAPTURE_LIMIT_INVALID");
  const envName=a["token-env"]||"XERO_ACCESS_TOKEN";need(/^[A-Z][A-Z0-9_]+$/.test(envName),"TOKEN_ENV_REFERENCE_INVALID");
  const token=process.env[envName];need(token&&token.trim()===token&&!/[\r\n]/.test(token),"EXISTING_XERO_ACCESS_TOKEN_REQUIRED");
  const lock=a.state+".lock";await mkdir(lock,{mode:0o700}).catch(e=>{if(e.code==="EEXIST")fail("CAPTURE_ALREADY_OPEN",lock);throw e;});
  await writeFile(join(lock,"owner.json"),json({pid:process.pid,startedAt:now()}),{mode:0o600});
  let state;
  try{
    try{state=await readJSON(a.state);}catch(e){if(e.code!=="ENOENT")throw e;state={schema:CAPTURE_SCHEMA,tenantId:a.tenant,pageSize,maxRecords,selection:"all-contacts-including-archived",order:"ContactID ASC",summaryOnly:false,startedAt:now(),complete:false,pages:[],attempts:[],resumeValidation:[]};}
    need(state.tenantId.toLowerCase()===a.tenant.toLowerCase()&&state.pageSize===pageSize&&state.maxRecords===maxRecords,"CAPTURE_SCOPE_CHANGED");
    validateCapture(state,sha,{complete:false});
    if(state.complete){const v=validateCapture(state,sha);return{state:a.state,replayed:true,complete:true,contacts:v.itemCount,captureSha256:v.captureSha256};}
    if(state.retryAt&&Date.parse(state.retryAt)>Date.now())fail("NATIVE_RETRY_WINDOW_ACTIVE",{retryAt:state.retryAt,source:state.retrySource});
    await atomic(a.state,state);
    async function get(page,reason){
      let entry;try{entry=await requestPage(state,page,token);}catch(e){state.lastError={at:now(),code:e.code||e.name||"NETWORK_ERROR",phase:reason,page};await atomic(a.state,state);throw e;}
      if(entry.status!==200){
        state.attempts.push({...entry,phase:reason});state.lastError={at:now(),code:"XERO_HTTP_"+entry.status,page};
        if(entry.status===429){const wait=afterDelay(entry);state.retryAt=wait.retryAt;state.retrySource=wait.source;}
        await atomic(a.state,state);fail("XERO_HTTP_"+entry.status,{state:a.state,page,retryAt:state.retryAt??null});
      }
      return entry;
    }
    // Interrupted page sequences are resumed only after re-reading each retained page.
    // A changed native record/page restarts into a new capture path rather than mixing editions.
    for(let i=0;i<state.pages.length;i++){
      const entry=await get(i+1,"resume-revalidation");
      state.resumeValidation.push(entry);await atomic(a.state,state);
      const old=pageValue(state.pages[i],i+1,pageSize,sha),fresh=pageValue(entry,i+1,pageSize,sha);
      if(canonical(old.Contacts)!==canonical(fresh.Contacts)||canonical(old.pagination)!==canonical(fresh.pagination)){
        state.lastError={at:now(),code:"SOURCE_CHANGED_RESTART_CAPTURE",page:i+1};await atomic(a.state,state);fail("SOURCE_CHANGED_RESTART_CAPTURE",a.state);
      }
      await atomic(a.state,state);
    }
    for(let page=state.pages.length+1;;page++){
      const entry=await get(page,"capture");let body;
      try{body=pageValue(entry,page,pageSize,sha);}catch(e){state.attempts.push({...entry,phase:"response-contract"});state.lastError={at:now(),code:e.code||e.message,page};await atomic(a.state,state);throw e;}
      if(body.pagination.itemCount>maxRecords){state.attempts.push({...entry,phase:"record-limit"});await atomic(a.state,state);fail("SELECTED_SOURCE_EXCEEDS_RECORD_LIMIT",{actual:body.pagination.itemCount,maxRecords});}
      const candidate={...state,pages:[...state.pages,entry]};
      try{validateCapture(candidate,sha,{complete:false});}catch(e){state.attempts.push({...entry,phase:"capture-continuity"});state.lastError={at:now(),code:e.code||e.message,page};await atomic(a.state,state);throw e;}
      need(Buffer.byteLength(json(candidate))<=96*1024*1024,"CAPTURE_SIZE_LIMIT");
      state=candidate;delete state.retryAt;delete state.retrySource;delete state.lastError;
      if(page>=Math.max(1,body.pagination.pageCount)){state.complete=true;state.completedAt=now();}
      await atomic(a.state,state);
      if(state.complete){const v=validateCapture(state,sha);return{state:a.state,replayed:false,complete:true,contacts:v.itemCount,pages:state.pages.length,captureSha256:v.captureSha256};}
    }
  }finally{await rm(lock,{recursive:true,force:true});}
}
async function core(command,input,out,installation){
  const args=[join(HERE,"prepare_cli.mjs"),command,"--input",input,"--out",out];
  if(installation)args.push("--installation",installation);
  const result=await run(process.execPath,args,{maxBuffer:2*1024*1024});
  return JSON.parse(result.stdout);
}
async function validateXero(directory){
  const manifest=await readJSON(join(directory,"manifest.json")),xm=await readJSON(join(directory,"xero-manifest.json"));
  need(xm.schema==="stellar-forge.xero-contacts-bundle.v1"&&Array.isArray(xm.files),"XERO_BUNDLE_INVALID");
  const required=[...SOURCES,"xero-capture.json","xero-decisions.json","xero-review.json"];
  need(canonical(xm.files.map(f=>f.path).sort())===canonical(required.sort()),"XERO_REQUIRED_MEMBERS_MISSING");
  for(const f of xm.files){
    const match=manifest.files.find(x=>x.path===f.path);need(match&&canonical(match)===canonical(f),"XERO_MEMBER_DESCRIPTOR_CHANGED",f.path);
    const raw=await read(join(directory,f.path));need(raw.length===f.bytes&&sha(raw)===f.sha256,"XERO_MEMBER_CHANGED",f.path);
  }
  const cap=await readJSON(join(directory,"xero-capture.json")),dec=await readJSON(join(directory,"xero-decisions.json"));
  const input=normalizeContacts(cap,dec,sha),saved=await readJSON(join(directory,"original-input.json")),review=await readJSON(join(directory,"xero-review.json"));
  need(canonical(input)===canonical(saved)&&sha(canonical(input))===xm.originalSha256&&manifest.originalSha256===xm.originalSha256,"XERO_ORIGINAL_INPUT_CHANGED");
  need(validateCapture(cap,sha).captureSha256===xm.captureSha256&&canonical(review)===canonical(reviewCapture(cap,sha)),"XERO_SOURCE_REVIEW_CHANGED");
  const requiredManifest=manifest.files.find(f=>f.path==="xero-manifest.json");
  const raw=await read(join(directory,"xero-manifest.json"));need(requiredManifest&&sha(raw)===requiredManifest.sha256&&raw.length===requiredManifest.bytes,"XERO_MANIFEST_UNBOUND");
  return {directory,manifest,xeroManifest:xm};
}
async function prepare(a){
  need(a.capture&&a.decisions&&a.out&&isAbsolute(a.out),"CAPTURE_DECISIONS_ABSOLUTE_OUTPUT_REQUIRED");
  const capRaw=await read(a.capture),decRaw=await read(a.decisions);
  const cap=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(capRaw)),dec=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(decRaw));
  const input=normalizeContacts(cap,dec,sha),inputText=json(input);
  const files=[
    descriptor("xero-capture.json",capRaw.toString("utf8")),descriptor("xero-decisions.json",decRaw.toString("utf8")),
    descriptor("xero-review.json",json(reviewCapture(cap,sha)))];
  for(const name of SOURCES)files.push(descriptor(name,(await read(join(HERE,name))).toString("utf8"),name.endsWith(".md")?"text/markdown":"text/javascript"));
  const xm={schema:"stellar-forge.xero-contacts-bundle.v1",captureSha256:validateCapture(cap,sha).captureSha256,
    originalSha256:sha(canonical(input)),files:files.map(({content,...f})=>f)};
  files.push(descriptor("xero-manifest.json",json(xm)));
  let previous;
  try{previous=await readJSON(join(a.out,"manifest.json"));}catch(e){if(e.code!=="ENOENT")throw e;}
  if(previous?.files?.some(f=>f.path==="xero-manifest.json")){
    const existing=await validateXero(a.out);
    need(canonical(existing.xeroManifest)===canonical(xm),"EXISTING_XERO_SOURCE_OR_DECISIONS_DIFFER");
    for(const f of files)need((await read(join(a.out,f.path))).equals(Buffer.from(f.content)),"EXISTING_XERO_MEMBER_DIFFERS",f.path);
    const installed=existing.manifest.files.some(f=>f.path==="installation-selection.json");
    need(installed===!!a.installation,"INSTALLATION_SELECTION_CHANGED");
    if(a.installation){
      const selected=await readJSON(a.installation);selected.directory=resolve(a.out);
      need(canonical(selected)===canonical(await readJSON(join(a.out,"installation-selection.json"))),"INSTALLATION_SELECTION_CHANGED");
    }
    // Original receiver validates every core/runtime/table member before returning this same delivery.
    const replay=await core("receive",a.out,a.out);
    return {...replay,replayed:true,xeroCaptureSha256:xm.captureSha256,manifestSha256:sha(await read(join(a.out,"manifest.json")))};
  }
  const temp=join(dirname(a.out),".xero-input-"+randomUUID()+".json");
  await writeFile(temp,inputText,{flag:"wx",mode:0o600});let result;
  try{result=await core("prepare",temp,a.out,a.installation);}finally{await rm(temp,{force:true});}
  const manifest=await readJSON(join(a.out,"manifest.json"));
  for(const f of files){
    await unchangedWrite(join(a.out,f.path),f.content);
    const {content,...meta}=f,old=manifest.files.find(x=>x.path===f.path);
    if(old)need(canonical(old)===canonical(meta),"BUNDLE_EXTENSION_DIFFERS",f.path);else manifest.files.push(meta);
  }
  await atomic(join(a.out,"manifest.json"),manifest);await validateXero(a.out);
  return {...result,files:manifest.files.length,xeroCaptureSha256:xm.captureSha256,manifestSha256:sha(await read(join(a.out,"manifest.json")))};
}
async function main(){
  const a=argumentsOf(process.argv.slice(2));let result;
  if(a.command==="capture")result=await capture(a);
  if(a.command==="review"){
    need(a.capture&&a.out&&isAbsolute(a.out),"CAPTURE_AND_ABSOLUTE_OUTPUT_REQUIRED");
    const review=reviewCapture(await readJSON(a.capture),sha);await unchangedWrite(a.out,json(review));result={output:a.out,...review.counts,captureSha256:review.captureSha256};
  }
  if(a.command==="compare"){
    need(a.before&&a.after&&a.out&&isAbsolute(a.out),"TWO_CAPTURES_AND_ABSOLUTE_OUTPUT_REQUIRED");
    const value=compareCaptures(await readJSON(a.before),await readJSON(a.after),sha);await unchangedWrite(a.out,json(value));result={output:a.out,beforeCount:value.beforeCount,afterCount:value.afterCount,changed:value.changed};
  }
  if(a.command==="prepare")result=await prepare(a);
  if(a.command==="receive"){
    need(a.input&&a.out&&isAbsolute(a.out),"INPUT_AND_ABSOLUTE_OUTPUT_REQUIRED");
    await validateXero(a.input);result=await core("receive",a.input,a.out);await validateXero(a.out);
  }
  process.stdout.write(json(result));
}
main().catch(e=>{process.stderr.write(json({error:e.code||e.message,detail:e.detail||null}));process.exitCode=1;});
