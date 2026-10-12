#!/usr/bin/env node
// MIT. Saved Applications launch for the original Python Wherobots operator.
import {constants} from "node:fs";
import {open,realpath,lstat,access} from "node:fs/promises";
import {createHash} from "node:crypto";
import {spawn} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";

export const WHEROBOTS_APPLICATION_SELECTION = "stellar-forge.wherobots-application-selection.v1";
export const WHEROBOTS_APPLICATION_STARTUP = "stellar-forge.wherobots-application-startup.v1";
const WORKER = "stellar-forge.wherobots-application-worker.v1";
const PRODUCT = "stellar/scf-starforge-20261009/sf30-seller-sdk/wherobots/";
const originalRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const SHA = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,239}$/;
const plain = value => !!value && typeof value === "object" && !Array.isArray(value);
const stable = value => JSON.stringify(value && typeof value === "object"
  ? Array.isArray(value) ? value.map(item => JSON.parse(stable(item)))
  : Object.fromEntries(Object.keys(value).sort().map(key => [key,JSON.parse(stable(value[key]))])) : value);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const fail = (code,message) => Object.assign(new Error(message),{code});
function need(value,code,message=code){if(!value)throw fail(code,message);}
function portNumber(value){
  need(Number.isSafeInteger(value)&&value>=0&&value<=65535,"WHEROBOTS_APPLICATION_PORT",
    "Use a local port from 0 through 65535.");return value;
}
const SOURCE_FILES = [
  "application-launcher.mjs","managed-serve.py",
  ...["operate.py","index.mjs","tools.mjs","merchant-tools.mjs","merchant-client.mjs",
    "merchant-provider.mjs","requirements.txt","contracts/customer-workflow.v1.schema.json",
    "wherobots_operator/__init__.py","wherobots_operator/__main__.py","wherobots_operator/storage.py",
    "wherobots_operator/workflow.py","wherobots_operator/native.py","wherobots_operator/cli.py",
    "wherobots_operator/server.py","wherobots_operator/editions.py","wherobots_operator/exports.py",
    "wherobots_operator/portable.py","wherobots_operator/web/index.html","wherobots_operator/web/app.js",
    "wherobots_operator/web/style.css"].map(name=>"source/"+name),
].map(name=>PRODUCT+name).sort();

async function originalFile(filename,{privateOnly=false,maximum=32*1024*1024}={}){
  filename=path.resolve(filename);
  need(await realpath(filename)===filename,"WHEROBOTS_APPLICATION_FILE",
    "Select the original canonical regular file.");
  const handle=await open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try{
    const before=await handle.stat({bigint:true});
    need(before.isFile()&&before.size>=0n&&before.size<=BigInt(maximum)&&
      (!privateOnly||process.platform==="win32"||((before.mode&0o077n)===0n&&
       typeof process.getuid==="function"&&before.uid===BigInt(process.getuid()))),
      "WHEROBOTS_APPLICATION_FILE","Select the original file with its private ownership and supported size.");
    const digest=createHash("sha256"),buffer=Buffer.alloc(65536);let offset=0;
    while(offset<Number(before.size)){
      const result=await handle.read(buffer,0,Math.min(buffer.length,Number(before.size)-offset),offset);
      need(result.bytesRead>0,"WHEROBOTS_APPLICATION_FILE_CHANGED");
      digest.update(buffer.subarray(0,result.bytesRead));offset+=result.bytesRead;
    }
    const after=await handle.stat({bigint:true}),named=await lstat(filename,{bigint:true});
    need(["dev","ino","size","mtimeNs","ctimeNs"].every(key=>before[key]===after[key])&&
      named.dev===after.dev&&named.ino===after.ino,"WHEROBOTS_APPLICATION_FILE_CHANGED",
      "Review the current file after it changes.");
    return {path:filename,bytes:offset,sha256:digest.digest("hex")};
  }finally{await handle.close();}
}
async function sourceIdentity(sourceRoot){
  const root=await realpath(path.resolve(sourceRoot)),files=[];
  for(const name of SOURCE_FILES){
    const value=await originalFile(path.join(root,name),{maximum:4*1024*1024});
    files.push({name,bytes:value.bytes,sha256:value.sha256});
  }
  return {root,files,sha256:hash(stable(files))};
}
function selectedValue(value){
  const selected=typeof value==="string"?JSON.parse(value):value;
  need(plain(selected)&&selected.schema===WHEROBOTS_APPLICATION_SELECTION&&plain(selected.binding)&&
    plain(selected.source)&&Array.isArray(selected.source.files)&&SHA.test(selected.source.sha256??""),
    "WHEROBOTS_APPLICATION_SELECTION","Use the complete selection returned by the original launcher.");
  const {bindingSha256,...binding}=selected.binding;
  need(SHA.test(bindingSha256??"")&&bindingSha256===hash(stable(binding))&&
    typeof binding.connectionFile==="string"&&path.isAbsolute(binding.connectionFile)&&
    typeof binding.directory==="string"&&path.isAbsolute(binding.directory)&&
    typeof binding.workspace==="string"&&ID.test(binding.workspace)&&ID.test(binding.workspaceId??"")&&
    typeof binding.python==="string"&&path.isAbsolute(binding.python)&&
    typeof binding.pythonRealPath==="string"&&path.isAbsolute(binding.pythonRealPath)&&
    Array.isArray(binding.configurationFiles)&&Array.isArray(binding.pythonPath)&&
    stable(selected.source.files.map(file=>file.name))===stable(SOURCE_FILES)&&
    selected.source.sha256===hash(stable(selected.source.files))&&
    selected.source.files.every(file=>SHA.test(file.sha256??"")&&Number.isSafeInteger(file.bytes)&&file.bytes>=0),
    "WHEROBOTS_APPLICATION_SELECTION","The reviewed original source or connection selection changed.");
  return selected;
}

/** Read the configured identity and original source without opening a workspace. */
export async function prepareWherobotsApplication({
  connection,workspace,python,sourceRoot=originalRoot,
}={}){
  need(typeof connection==="string"&&path.isAbsolute(connection)&&typeof workspace==="string"&&ID.test(workspace),
    "WHEROBOTS_APPLICATION_INPUT","Select the private connection file and its Wherobots alias.");
  const connectionFile=await originalFile(connection,{privateOnly:true,maximum:1024*1024});
  const {readWherobotsWorkspaceConfiguration}=await import("./source/merchant-provider.mjs");
  const configuration=await readWherobotsWorkspaceConfiguration(connectionFile.path);
  need(Object.hasOwn(configuration.workspaces,workspace),"WHEROBOTS_APPLICATION_ALIAS",
    "Choose an alias declared in this original connection.");
  const entry=configuration.workspaces[workspace];
  python=python??entry.python;
  need(typeof python==="string"&&path.isAbsolute(python),"WHEROBOTS_APPLICATION_PYTHON",
    "Select the absolute installed Python executable in Applications or in the connection.");
  python=path.resolve(python);
  const pythonRealPath=await realpath(python);
  await access(python,constants.X_OK);
  const executable=await originalFile(pythonRealPath);
  const files=[connectionFile,executable];
  if(entry.profile)files.push(await originalFile(entry.profile,{privateOnly:true,maximum:1024*1024}));
  const venv=path.join(path.dirname(path.dirname(python)),"pyvenv.cfg");
  try{files.push(await originalFile(venv,{maximum:1024*1024}));}
  catch(error){if(error.code!=="ENOENT")throw error;}
  for(const file of files){
    const current=await originalFile(file.path,{privateOnly:file.path===connectionFile.path||file.path===entry.profile});
    need(stable(current)===stable(file),"WHEROBOTS_APPLICATION_BINDING_CHANGED",
      "Review the current connection and installed runtime.");
  }
  const binding={connectionFile:connectionFile.path,workspace,workspaceId:entry.workspaceId,
    directory:entry.directory,python,pythonRealPath,profile:entry.profile??null,
    pythonPath:entry.pythonPath,configurationFiles:files};
  return {schema:WHEROBOTS_APPLICATION_SELECTION,
    binding:{...binding,bindingSha256:hash(stable(binding))},source:await sourceIdentity(sourceRoot)};
}
function localUrl(value,port=0){
  let url;try{url=new URL(value);}catch{throw fail("WHEROBOTS_APPLICATION_URL","Use the original private browser URL.");}
  need(url.protocol==="http:"&&url.hostname==="127.0.0.1"&&!url.username&&!url.password&&!url.search&&
    url.pathname==="/"&&Number(url.port)>0&&Number(url.port)<=65535&&(!port||Number(url.port)===port)&&
    /^#token=[A-Za-z0-9_-]{43}$/.test(url.hash),"WHEROBOTS_APPLICATION_URL",
    "The browser must be the original authenticated local listener.");
  return url;
}
async function browserState(url,{signal}={}){
  const timeout=AbortSignal.timeout(10000);
  const response=await fetch(new URL("/api/state",url),{
    headers:{authorization:"Bearer "+url.hash.slice("#token=".length),connection:"close"},redirect:"error",
    signal:signal?AbortSignal.any([signal,timeout]):timeout,
  });
  need(response.status===200&&response.headers.get("content-type")?.startsWith("application/json"),
    "WHEROBOTS_APPLICATION_LISTENER","The original authenticated browser did not answer.");
  const reader=response.body.getReader(),parts=[];let bytes=0;
  try{
    for(;;){const next=await reader.read();if(next.done)break;bytes+=next.value.length;
      need(bytes<=32*1024*1024,"WHEROBOTS_APPLICATION_STATE","The saved workspace state exceeds 32 MiB.");
      parts.push(next.value);}
  }finally{await reader.cancel().catch(()=>{});}
  const value=JSON.parse(Buffer.concat(parts).toString("utf8"));
  need(plain(value)&&ID.test(value.workspace_id??""),"WHEROBOTS_APPLICATION_LISTENER");
  return value;
}
export async function verifyWherobotsApplicationStartup(value,{
  selection,launchSourceRoot,port=0,pid,signal,
}={}){
  const selected=selectedValue(selection),binding=selected.binding;
  portNumber(port);
  need(plain(value)&&value.schema===WHEROBOTS_APPLICATION_STARTUP&&value.state==="READY"&&
    value.workspace===binding.workspace&&value.workspace_id===binding.workspaceId&&
    value.directory===binding.directory&&value.connectionFile===binding.connectionFile&&
    value.bindingSha256===binding.bindingSha256&&value.sourceSha256===selected.source.sha256&&
    value.sourceRoot===path.resolve(launchSourceRoot)&&Number.isSafeInteger(value.pid)&&value.pid>0&&
    (pid===undefined||value.pid===pid)&&Number.isSafeInteger(value.workerPid)&&value.workerPid>0&&
    /^[a-f0-9-]{36}$/.test(value.instanceId??""),
    "WHEROBOTS_APPLICATION_STARTUP_CHANGED","The original source, process or workspace differs from its review.");
  const url=localUrl(value.url,port),state=await browserState(url,{signal});
  need(state.workspace_id===binding.workspaceId,"WHEROBOTS_APPLICATION_WORKSPACE_CHANGED",
    "The original listener belongs to a different saved workspace.");
  return {url:url.href,workspaceId:binding.workspaceId,connectionFile:binding.connectionFile,
    original:{schema:WHEROBOTS_APPLICATION_STARTUP,workspace:binding.workspace,workspace_id:binding.workspaceId,
      directory:binding.directory,connectionFile:binding.connectionFile,bindingSha256:binding.bindingSha256,
      sourceSha256:selected.source.sha256,sourceRoot:value.sourceRoot,pid:value.pid,
      workerPid:value.workerPid,instanceId:value.instanceId,python:binding.python,runtime:value.runtime}};
}

/** One supervised original Python server. Closing drains its accepted HTTP and task work. */
export async function startWherobotsApplication({
  connection,workspace,python,selection,port=0,environment=process.env,signal,
}={}){
  portNumber(port);signal?.throwIfAborted();
  const selected=selection===undefined?null:selectedValue(selection);
  const current=await prepareWherobotsApplication({connection,workspace,python:python??selected?.binding.python});
  if(selected)need(current.binding.bindingSha256===selected.binding.bindingSha256&&
    current.source.sha256===selected.source.sha256,"WHEROBOTS_APPLICATION_REVIEW_CHANGED",
    "Review the current connection and application source before starting it.");
  signal?.throwIfAborted();
  const binding=current.binding,env={...environment,PYTHONDONTWRITEBYTECODE:"1",PYTHONUNBUFFERED:"1"};
  if(binding.profile)env.WHEROBOTS_OPERATOR_PROFILE=binding.profile;
  if(binding.pythonPath.length)env.PYTHONPATH=[...binding.pythonPath,...(env.PYTHONPATH?[env.PYTHONPATH]:[])].join(path.delimiter);
  const child=spawn(binding.python,["-B",path.join(current.source.root,PRODUCT+"managed-serve.py"),"--port",String(port)],
    {cwd:binding.directory,env,stdio:["pipe","pipe","pipe"],shell:false,windowsHide:true});
  let exited=false,spawnError=null,closing,resolveReady,rejectReady,announcement=false;
  const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  const done=new Promise(resolve=>{
    child.once("error",error=>{spawnError=error;rejectReady(error);});
    child.once("close",(code,termination)=>{
      exited=true;resolve({code,signal:termination,error:spawnError});
      if(!announcement)rejectReady(fail("WHEROBOTS_APPLICATION_STARTUP_FAILED",
        "The original Python server closed before announcing its workspace."));
    });
  });
  function close(){
    return closing??=(async()=>{
      if(!exited)child.kill("SIGTERM");
      const result=await done;
      if(result.error)throw result.error;
      need(result.code===0||result.signal==="SIGTERM","WHEROBOTS_APPLICATION_SHUTDOWN",
        "The original Python server closed with an error; inspect its saved operation.");
      return result;
    })();
  }
  const stop=()=>{rejectReady(signal?.reason??fail("WHEROBOTS_APPLICATION_STOPPED","The application was stopped."));close().catch(()=>{});};
  signal?.addEventListener("abort",stop,{once:true});
  const timer=setTimeout(()=>rejectReady(fail("WHEROBOTS_APPLICATION_STARTUP_TIMEOUT",
    "The original Python server has not announced its workspace.")),30000);
  timer.unref?.();
  let buffer="",stderr="";
  child.stderr.on("data",chunk=>{stderr=(stderr+chunk.toString("utf8")).slice(-32768);});
  child.stdout.setEncoding("utf8");
  child.stdout.on("data",chunk=>{
    if(announcement)return;
    buffer+=chunk;
    if(buffer.length>65536){rejectReady(fail("WHEROBOTS_APPLICATION_STARTUP_SIZE","The original startup line is too large."));return;}
    const lines=buffer.split(/\r?\n/);buffer=lines.pop();
    for(const text of lines){
      let value;try{value=JSON.parse(text);}catch{continue;}
      if(value?.schema!==WORKER)continue;
      needWorker(value);
    }
  });
  function needWorker(value){
    try{
      need(value.state==="READY"&&value.workspace_id===binding.workspaceId&&value.directory===binding.directory&&
        value.sourceRoot===current.source.root&&value.sourceSha256===current.source.sha256&&
        value.bindingSha256===binding.bindingSha256&&value.pid===child.pid&&value.parentPid===process.pid,
        "WHEROBOTS_APPLICATION_STARTUP_CHANGED","The Python startup differs from its selected original workspace.");
      announcement=true;resolveReady(value);
    }catch(error){rejectReady(error);}
  }
  child.stdin.on("error",error=>{if(error.code!=="EPIPE")rejectReady(error);});
  child.stdin.end(JSON.stringify(current));
  if(signal?.aborted)stop();
  try{
    const worker=await ready;signal?.throwIfAborted();
    const after=await prepareWherobotsApplication({connection,workspace,python:binding.python});
    need(after.binding.bindingSha256===current.binding.bindingSha256&&after.source.sha256===current.source.sha256,
      "WHEROBOTS_APPLICATION_REVIEW_CHANGED","Review the current source or connection after it changes.");
    const startup={schema:WHEROBOTS_APPLICATION_STARTUP,state:"READY",workspace:binding.workspace,
      workspace_id:binding.workspaceId,directory:binding.directory,connectionFile:binding.connectionFile,
      bindingSha256:binding.bindingSha256,sourceRoot:current.source.root,sourceSha256:current.source.sha256,
      pid:process.pid,workerPid:child.pid,instanceId:worker.instanceId,url:worker.url,runtime:worker.runtime};
    await verifyWherobotsApplicationStartup(startup,{selection:current,launchSourceRoot:current.source.root,port,pid:process.pid,signal});
    return {startup,url:startup.url,selection:current,close,closed:done,
      get diagnostics(){return {pid:child.pid,closing:!!closing,exited,stderr};}};
  }catch(error){
    try{await close();}catch(shutdown){throw new AggregateError([error,shutdown],"Wherobots startup and shutdown failed.");}
    throw error;
  }finally{
    clearTimeout(timer);
    done.finally(()=>signal?.removeEventListener("abort",stop));
  }
}
const HELP = "Wherobots saved application\n\n"+
  "  starforge wherobots-app inspect --connection FILE --workspace ALIAS [--python ABSOLUTE_PYTHON]\n"+
  "  starforge wherobots-app serve --connection FILE --workspace ALIAS [--python ABSOLUTE_PYTHON] [--port 0]\n"+
  "    [--managed-selection JSON]\n\n"+
  "Open the original private connection and saved workspace. The existing Python\n"+
  "browser retains native jobs, complete editions, comparisons and customer handovers.\n"+
  "SIGINT/SIGTERM stop admission, drain accepted work and close this local attachment.\n";
export async function main(argv=process.argv.slice(2)){
  if(!argv.length||["--help","help","-h"].includes(argv[0])){process.stdout.write(HELP);return;}
  const [command,...rest]=argv,options={};
  need(["inspect","serve"].includes(command),"WHEROBOTS_APPLICATION_COMMAND","Choose inspect or serve.");
  const names=new Map([["--connection","connection"],["--workspace","workspace"],["--python","python"],
    ["--port","port"],["--managed-selection","selection"]]);
  for(let index=0;index<rest.length;index+=2){
    const key=names.get(rest[index]),value=rest[index+1];
    need(key&&typeof value==="string"&&value&&!value.startsWith("--")&&!Object.hasOwn(options,key),
      "WHEROBOTS_APPLICATION_ARGUMENT","Use each documented option once with its value.");
    options[key]=value;
  }
  if(command==="inspect"){
    need(options.port===undefined&&options.selection===undefined,"WHEROBOTS_APPLICATION_ARGUMENT");
    const value=await prepareWherobotsApplication(options);process.stdout.write(JSON.stringify(value)+"\n");return value;
  }
  need(/^(0|[1-9]\d*)$/.test(options.port??"0"),"WHEROBOTS_APPLICATION_PORT");options.port=Number(options.port??0);
  const controller=new AbortController(),stop=()=>controller.abort();
  process.on("SIGINT",stop);process.on("SIGTERM",stop);
  let application;
  try{
    application=await startWherobotsApplication({...options,signal:controller.signal});
    process.stdout.write(JSON.stringify(application.startup)+"\n");
    const result=await application.closed;
    if(result.error)throw result.error;
    need(result.code===0,"WHEROBOTS_APPLICATION_EXIT","The original Python server returned an error.");
    return application.startup;
  }finally{
    process.off("SIGINT",stop);process.off("SIGTERM",stop);
    await application?.close();
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{
    process.stderr.write(JSON.stringify({error:error.code??"WHEROBOTS_APPLICATION",message:error.message})+"\n");
    process.exitCode=error.name==="AbortError"?130:1;
  });
}
