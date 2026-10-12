#!/usr/bin/env node
// MIT. Continue one maintained Haystack distribution, installation and application operation.
import assert from "node:assert/strict";
import { promises as fs, constants as F } from "node:fs";
import { join, resolve, dirname, basename, relative, isAbsolute, posix } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { SourceTextModule, createContext } from "node:vm";

const FORMAT = "commons.haystack.distribution-receiving.v1";
const BASE = "stellar/scf-starforge-20261009/";
const DIST = BASE + "distribution/";
const APP = BASE + "sf30-seller-sdk/haystack-workspace/";
const SELECTION = "haystack-turnover";
const COHORT_PATHS = [
  "util.mjs","model.mjs","catalog.mjs","files.mjs","reports.mjs","portable.mjs",
  "store.mjs","LICENSE","browser-assets-loader.mjs","browser-assets.json","package.json",
  "client.mjs","protocol.mjs","mcp.mjs","server.mjs","client.d.mts","application-provider.mjs",
  "merchant-client.mjs","merchant-tools.mjs","merchant.mjs","json-codec.mjs","contribution.json",
  "merchant-provider.mjs","merchant-setup.mjs","README.md","MERCHANT.md","index.html","app.js",
  "style.css","cli.mjs","OPERATING.md","haystack-types.mjs","haystack-types.d.mts",
  "haystack-index.mjs","haystack-index.d.mts","HAYSTACK_CONTRACT.md","fixtures.json",
  "RECEIVING.mjs","HAYSTACK_LICENSE.txt","fixture-charlie.json"
].map(name => APP + name).concat([
  DIST + "selections/haystack-turnover.json",
  DIST + "contributions/haystack-workspace.json",
  "products/haystack/OPERATING.md"
]).sort();
const BOOTSTRAP_PINS = {
  [DIST+"build.mjs"]:"7cbbd5ec1e4d23cd48da63d55a4d4001a424346d",
  [DIST+"build-state.mjs"]:"eb9543e9ad3e594e4c343bb15375918a42149a9a",
  [DIST+"specification.mjs"]:"805c5463adf678123c860c1837d09446f0b3990d",
  [DIST+"source-selection.mjs"]:"4f1e18e25e7bfd2858e9891a5cd170e6f9d8c65b",
  [DIST+"product-package.mjs"]:"2c668933f214f201137ac6d3c6b7410525955c9b",
  [DIST+"runtime-install.mjs"]:"6d9374932166d7c597fb55148912be193116fa7b",
  [DIST+"runtime-install-cli.mjs"]:"e9079549ce8644041c62779dec6109752a4b3251",
  [DIST+"runtime-unpack.py"]:"6981dc29e20a6795c9b656d8956b0976d2434ffc"
};
const sha256 = body => createHash("sha256").update(body).digest("hex");
const gitBlob = body => createHash("sha1").update("blob "+body.length+"\0").update(body).digest("hex");
const now = () => new Date().toISOString();
const ordinary = value => value && typeof value === "object" && !Array.isArray(value);
let stringify = (value, space=2) => JSON.stringify(value, null, space);
const bytesFor = value => Buffer.from(stringify(value, 2)+"\n");
const errorView = error => ({
  message:String(error.message ?? error),code:error.code ?? null,
  ...(error.details === undefined ? {} : {details:error.details}),
  ...(error.result === undefined ? {} : {nativeResult:error.result})
});
function need(value, message, details) {
  if (!value) throw Object.assign(new Error(message), {code:"HAYSTACK_DISTRIBUTION_CONTINUATION",details});
}
async function exists(path) {
  try { await fs.lstat(path); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}
async function directory(path, create=false) {
  path=resolve(path);
  if(create) await fs.mkdir(path,{recursive:true,mode:0o700});
  const value=await fs.lstat(path);
  need(value.isDirectory()&&!value.isSymbolicLink(),"Use the original ordinary operation directory.",{path});
  return path;
}
async function readBytes(path, maximum=128*1024*1024) {
  const handle=await fs.open(path,F.O_RDONLY|F.O_NOFOLLOW);
  try {
    const before=await handle.stat({bigint:true});
    need(before.isFile()&&before.size<=BigInt(maximum),"Use the complete ordinary input file within its declared capacity.",{path,bytes:String(before.size),maximum});
    const bytes=await handle.readFile(),after=await handle.stat({bigint:true});
    need(BigInt(bytes.length)===before.size&&before.dev===after.dev&&before.ino===after.ino&&
      before.size===after.size&&before.mtimeNs===after.mtimeNs,"The original input changed while it was read.",{path});
    return bytes;
  } finally { await handle.close(); }
}
async function json(path, optional=false) {
  try { return JSON.parse((await readBytes(path)).toString("utf8")); }
  catch(error) { if(optional&&error.code==="ENOENT") return null; throw error; }
}
async function syncDirectory(path) {
  const handle=await fs.open(path,F.O_RDONLY|F.O_DIRECTORY);
  try { await handle.sync(); } finally { await handle.close(); }
}
export async function retain(path, body) {
  body=Buffer.from(body); await directory(dirname(path),true);
  if(await exists(path)) {
    need((await readBytes(path)).equals(body),"The complete retained file differs from its original bytes.",{path});
  } else {
    const temporary=join(dirname(path),"."+basename(path)+"."+randomUUID()+".receiving");
    const handle=await fs.open(temporary,"wx",0o600);
    try {
      await handle.writeFile(body);await handle.sync();await handle.close();
      try { await fs.link(temporary,path); }
      catch(error) {
        if(error.code!=="EEXIST")throw error;
        need((await readBytes(path)).equals(body),"Concurrent retained bytes differ.",{path});
      }
      await syncDirectory(dirname(path));
    } finally { await handle.close().catch(()=>{});await fs.unlink(temporary).catch(()=>{}); }
  }
  return {path,bytes:body.length,sha256:sha256(body)};
}
async function save(path,value) {
  const temporary=join(dirname(path),"."+basename(path)+"."+randomUUID()+".next");
  const handle=await fs.open(temporary,"wx",0o600);
  try {
    await handle.writeFile(bytesFor(value));await handle.sync();await handle.close();
    await fs.rename(temporary,path);await syncDirectory(dirname(path));
  } finally { await handle.close().catch(()=>{});await fs.unlink(temporary).catch(()=>{}); }
}
async function retainedJson(path,value){return retain(path,bytesFor(value));}
async function fileIdentity(path) {
  const bytes=await readBytes(path);return {path,bytes:bytes.length,sha256:sha256(bytes)};
}
function relativeSource(path) {
  need(typeof path==="string"&&path&&!path.includes("\\")&&!path.includes("\0")&&
    !path.startsWith("/")&&path.split("/").every(part=>part&&part!=="."&&part!==".."),
    "Use one complete ordinary relative source path.",{path});
  return path;
}
export function validateInput(value) {
  need(ordinary(value)&&value.format===FORMAT,"Use this programme's complete input format.");
  const accepted=new Set(["format","operationId","directory","repository","sourceCommit","cohort",
    "receivingDirectory","python","npm","npmCache","sourceOffline","installOffline"]);
  need(Object.keys(value).every(key=>accepted.has(key)),"Use the declared original input fields.");
  need(/^[a-zA-Z0-9][a-zA-Z0-9._-]{7,159}$/.test(value.operationId??""),"Retain one original distribution operation ID.");
  for(const field of ["directory","repository"])need(typeof value[field]==="string"&&
    isAbsolute(value[field])&&resolve(value[field])===value[field],"Use explicit absolute "+field+".");
  need(/^[0-9a-f]{40}$/.test(value.sourceCommit??""),"Pin the maintained base to its full Git commit.");
  need(ordinary(value.cohort)&&Array.isArray(value.cohort.files),"Supply the complete final application and product source cohort.");
  const paths=value.cohort.files.map(file=>relativeSource(file.path)).sort();
  need(JSON.stringify(paths)===JSON.stringify(COHORT_PATHS),"Supply all 40 application and three product/declaration paths exactly once.",{received:paths,expected:COHORT_PATHS});
  for(const file of value.cohort.files){
    need(typeof file.content==="string"&&/^[0-9a-f]{40}$/.test(file.gitBlobSha1??""),"Retain each complete UTF-8 source and its Git blob.",{path:file.path});
    const bytes=Buffer.from(file.content);
    need(bytes.length<=2*1024*1024&&gitBlob(bytes)===file.gitBlobSha1,"The complete source Git blob differs.",{path:file.path});
  }
  if(value.receivingDirectory!==undefined)need(isAbsolute(value.receivingDirectory)&&resolve(value.receivingDirectory)===value.receivingDirectory,"Use the same absolute original native receiving directory.");
  for(const field of ["python","npm","npmCache"])if(value[field]!==undefined)
    need(typeof value[field]==="string"&&value[field]&&!value[field].includes("\0"),"Use the original "+field+".");
  for(const field of ["sourceOffline","installOffline"])if(value[field]!==undefined)need(typeof value[field]==="boolean","Use a boolean "+field+".");
  return value;
}
const ARCHIVE_SOURCE = "#!/usr/bin/env python3\n\"\"\"Preserve one completed distribution operation with every original source and outcome.\"\"\"\nimport hashlib,json,os,stat,sys,tarfile,uuid\nfrom pathlib import Path\nconfig=json.loads(Path(sys.argv[1]).read_text())\nroot=Path(config[\"directory\"])\nreceiving=Path(config[\"receiving_directory\"])\npointer=root.with_name(root.name+\"-complete-archive.json\")\ndef check(value,message):\n    if not value: raise ValueError(message)\ndef digest(path):\n    with path.open(\"rb\") as stream:return hashlib.file_digest(stream,\"sha256\").hexdigest()\ndef exact(path,body):\n    if path.exists():\n        check(path.is_file() and not path.is_symlink() and path.read_bytes()==body,\"Original archive input changed: \"+str(path))\n        return\n    candidate=path.with_name(\".\"+path.name+\".\"+uuid.uuid4().hex+\".receiving\")\n    fd=os.open(candidate,os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,\"O_NOFOLLOW\",0),0o600)\n    try:\n        with os.fdopen(fd,\"wb\") as output:output.write(body);output.flush();os.fsync(output.fileno())\n        try:os.link(candidate,path,follow_symlinks=False)\n        except FileExistsError:\n            check(path.is_file() and not path.is_symlink() and path.read_bytes()==body,\"Original archive input changed: \"+str(path))\n        directory=os.open(path.parent,os.O_RDONLY|getattr(os,\"O_DIRECTORY\",0))\n        try:os.fsync(directory)\n        finally:os.close(directory)\n    finally:candidate.unlink(missing_ok=True)\ndef encode(value):return (json.dumps(value,ensure_ascii=False,indent=2)+\"\\n\").encode()\ndef verify(archive,inventory):\n    expected={item[\"name\"]:item for item in inventory[\"entries\"]}\n    seen=set()\n    with tarfile.open(archive,\"r:gz\") as stream:\n        for item in stream:\n            check(item.name in expected and item.name not in seen,\"Unexpected or duplicate saved archive member: \"+item.name)\n            seen.add(item.name);entry=expected[item.name]\n            if entry[\"kind\"]==\"file\":\n                check(item.isfile() and item.size==entry[\"bytes\"],\"Saved file size/type differs: \"+item.name)\n                source=stream.extractfile(item)\n                check(source is not None,\"Saved original file is absent.\")\n                with source:actual=hashlib.file_digest(source,\"sha256\").hexdigest()\n                check(actual==entry[\"sha256\"],\"Saved full original bytes differ: \"+item.name)\n            elif entry[\"kind\"]==\"directory\":check(item.isdir(),\"Saved original directory differs.\")\n            else:check(item.issym() and item.linkname==entry[\"target\"],\"Saved original link differs.\")\n    check(seen==set(expected),\"The saved original operation is incomplete.\")\ndef receipt_for(capture):\n    meta=json.loads((capture/\"inventory.json\").read_text())\n    check(meta[\"operation_id\"]==config[\"operation_id\"] and meta[\"complete_result_sha256\"]==config[\"complete_result_sha256\"],\"Choose the same completed operation capture.\")\n    archive=capture/\"complete-operation.tar.gz\"\n    verify(archive,meta)\n    return {\"format\":\"commons.haystack.distribution-archive.v1\",\"operationId\":config[\"operation_id\"],\n      \"directory\":str(root),\"archive\":str(archive),\"bytes\":archive.stat().st_size,\"sha256\":digest(archive),\n      \"inventory\":str(capture/\"inventory.json\"),\"inventorySha256\":digest(capture/\"inventory.json\"),\n      \"completeResultSha256\":config[\"complete_result_sha256\"],\"entries\":len(meta[\"entries\"]),\n      \"fileBytes\":sum(item.get(\"bytes\",0) for item in meta[\"entries\"]),\"receivingDirectory\":str(receiving)}\ncheck(root.is_dir() and not root.is_symlink() and receiving.is_dir() and not receiving.is_symlink(),\"Preserve the original completed ordinary directories.\")\ncheck(digest(root/\"complete-result.json\")==config[\"complete_result_sha256\"],\"The completed operation result changed.\")\nif pointer.exists():\n    saved=json.loads(pointer.read_text())\n    check(saved[\"operationId\"]==config[\"operation_id\"] and saved[\"completeResultSha256\"]==config[\"complete_result_sha256\"],\"The saved archive belongs to another original result.\")\n    check(digest(Path(saved[\"archive\"]))==saved[\"sha256\"],\"The complete saved archive changed.\")\n    verify(Path(saved[\"archive\"]),json.loads(Path(saved[\"inventory\"]).read_text()))\n    print(json.dumps(saved),flush=True);sys.exit(0)\nprefix=root.name+\"-capture-\"\nfor candidate in sorted(root.parent.glob(prefix+\"*\")):\n    if candidate.is_dir() and not candidate.is_symlink() and (candidate/\"complete-operation.tar.gz\").is_file():\n        original=json.loads((candidate/\"inventory.json\").read_text())\n        if original.get(\"operation_id\")==config[\"operation_id\"] and original.get(\"complete_result_sha256\")==config[\"complete_result_sha256\"]:\n            saved=receipt_for(candidate);exact(pointer,encode(saved));print(json.dumps(saved),flush=True);sys.exit(0)\ncapture=root.parent/(prefix+uuid.uuid4().hex)\ncapture.mkdir(mode=0o700)\nroots=[(root,root.name)]\nif not receiving.is_relative_to(root):roots.append((receiving,root.name+\"/original-native-receiving\"))\nomit={receiving/\"workspace\"/\"connection.json\",receiving/\"received\"/\"connection.json\"}\nentries=[]\nfor base,archive_name in roots:\n    for current,directories,files in os.walk(base,followlinks=False):\n        current=Path(current)\n        choices=[current]+[current/name for name in files]+[current/name for name in directories if (current/name).is_symlink()]\n        for path in choices:\n            if path in omit:continue\n            name=archive_name if path==base else archive_name+\"/\"+path.relative_to(base).as_posix()\n            info=path.lstat()\n            entry={\"name\":name,\"path\":str(path),\"mode\":stat.S_IMODE(info.st_mode)}\n            if stat.S_ISDIR(info.st_mode):entry[\"kind\"]=\"directory\"\n            elif stat.S_ISREG(info.st_mode):entry.update(kind=\"file\",bytes=info.st_size,sha256=digest(path))\n            elif stat.S_ISLNK(info.st_mode):entry.update(kind=\"symlink\",target=os.readlink(path))\n            else:raise ValueError(\"An ordinary completed operation contains a live special file: \"+str(path))\n            entries.append(entry)\nentries.sort(key=lambda item:item[\"name\"])\ncheck(len(entries)==len({item[\"name\"] for item in entries}),\"Complete operation archive paths overlap.\")\ninventory={\"format\":\"commons.haystack.distribution-archive-inventory.v1\",\"operation_id\":config[\"operation_id\"],\n  \"complete_result_sha256\":config[\"complete_result_sha256\"],\"entries\":entries,\n  \"ephemeral_files_omitted\":[str(path) for path in sorted(omit)]}\nexact(capture/\"inventory.json\",encode(inventory))\ntemporary=capture/\"complete-operation.tar.gz.receiving\"\nwith tarfile.open(temporary,\"w:gz\",format=tarfile.PAX_FORMAT,dereference=False,compresslevel=6) as output:\n    for item in entries:\n        output.inodes.clear()\n        output.add(item[\"path\"],arcname=item[\"name\"],recursive=False)\nverify(temporary,inventory)\nwith temporary.open(\"rb\") as stream:os.fsync(stream.fileno())\nos.rename(temporary,capture/\"complete-operation.tar.gz\")\nsaved=receipt_for(capture);exact(pointer,encode(saved));print(json.dumps(saved),flush=True)\n";
const WORKER_SOURCE = [
'import {promises as fs,constants as F} from "node:fs";',
'import {spawn} from "node:child_process";',
'import {join} from "node:path";',
'const directory=process.argv[2],request=JSON.parse(await fs.readFile(join(directory,"request.json"),"utf8"));',
'const stamp=()=>new Date().toISOString();',
'async function save(name,value){const path=join(directory,name),tmp=path+".next";const h=await fs.open(tmp,"w",0o600);try{await h.writeFile(JSON.stringify(value,null,2)+"\\n");await h.sync();}finally{await h.close();}await fs.rename(tmp,path);}',
'await save("worker.json",{pid:process.pid,startedAt:stamp()});',
'const out=await fs.open(join(directory,"stdout.log"),F.O_WRONLY|F.O_CREAT|F.O_APPEND|F.O_NOFOLLOW,0o600);',
'const err=await fs.open(join(directory,"stderr.log"),F.O_WRONLY|F.O_CREAT|F.O_APPEND|F.O_NOFOLLOW,0o600);',
'let child;try{',
'child=spawn(request.executable,request.args,{cwd:request.cwd,env:process.env,stdio:["ignore",out.fd,err.fd,3]});',
'const completion=new Promise(resolve=>{child.once("close",(code,signal)=>resolve({code,signal,completedAt:stamp()}));});',
'await new Promise((ok,no)=>{child.once("spawn",ok);child.once("error",no);});',
'await save("child.json",{pid:child.pid,startedAt:stamp()});',
'const result=await completion;',
'await out.sync();await err.sync();await save("result.json",result);process.exitCode=result.code===0?0:1;',
'}catch(error){await save("result.json",{code:null,signal:null,error:{message:error.message,code:error.code??null},completedAt:stamp()});process.exitCode=1;}',
'finally{await out.close();await err.close();}'
].join("\n")+"\n";

export async function main(inputFilename) {
  const inputBody=await readBytes(resolve(inputFilename),16*1024*1024);
  const input=validateInput(JSON.parse(inputBody.toString("utf8")));
  const root=await directory(input.directory,true),journalPath=join(root,"distribution-programme.json");
  need(!(input.repository===root||input.repository.startsWith(root+"/")),"Keep the borrowed checkout outside the original operation root.");
  await directory(input.repository);
  await retain(join(root,"input.json"),inputBody);
  const self=await readBytes(fileURLToPath(import.meta.url));
  await retain(join(root,"DISTRIBUTION_RECEIVING.mjs"),self);
  await retain(join(root,"command-worker.mjs"),Buffer.from(WORKER_SOURCE));
  await retain(join(root,"archive-operation.py"),Buffer.from(ARCHIVE_SOURCE));
  for(const name of ["stages","requests","commands","outputs","bootstrap","git-objects"])
    await directory(join(root,name),true);
  const lock=await fs.open(join(root,"operation.lock"),F.O_RDWR|F.O_CREAT|F.O_NOFOLLOW,0o600);
  const acquired=spawnSync("flock",["-n","-E","73","3"],{stdio:["ignore","pipe","pipe",lock.fd]});
  if(acquired.error||acquired.status!==0){
    await lock.close();
    throw Object.assign(new Error("The original distribution operation still has an owner. Continue this same input after that owner returns."),{code:"HAYSTACK_DISTRIBUTION_ACTIVE",details:{status:acquired.status,error:acquired.error?.message,stderr:acquired.stderr?.toString()}});
  }
  try {
  let journal=await json(journalPath,true);
  if(!journal){
    journal={format:FORMAT,operationId:input.operationId,directory:root,inputSha256:sha256(inputBody),
      sourceCommit:input.sourceCommit,createdAt:now(),state:"CONTINUING",stages:{},requests:{},invocations:[],
      installAttempts:[],managedAttempts:[]};
    await save(journalPath,journal);
  }
  need(journal.format===FORMAT&&journal.operationId===input.operationId&&journal.inputSha256===sha256(inputBody),
    "Continue the complete original distribution input without replacing its identity.");
  const invocation={id:randomUUID(),startedAt:now(),pid:process.pid,node:process.version};
  journal.invocations.push(invocation);await save(journalPath,journal);
  const progress=(stage,details={})=>process.stdout.write(JSON.stringify({operationId:input.operationId,stage,at:now(),...details})+"\n");
  const persist=()=>save(journalPath,journal);
  async function stage(name,work) {
    const path=join(root,"stages",name+".json"),existing=await json(path,true);
    if(existing){
      need(existing.operationId===input.operationId&&existing.name===name,"The original completed stage differs.");
      journal.stages[name]={path,sha256:sha256(await readBytes(path)),completedAt:existing.completedAt};await persist();
      return existing.result;
    }
    progress(name,{state:"RUNNING"});
    const result=await work();
    const completed={operationId:input.operationId,name,completedAt:now(),result};
    await retainedJson(path,completed);journal.stages[name]={path,sha256:sha256(await readBytes(path)),completedAt:completed.completedAt};
    await persist();progress(name,{state:"COMPLETED"});return result;
  }
  async function request(name,fields) {
    const path=join(root,"requests",name+".json");
    let original=await json(path,true);
    if(!original){original={operationId:input.operationId,name,createdAt:now(),...fields};await retainedJson(path,original);}
    else for(const [key,value]of Object.entries(fields))
      need(stringify(original[key],0)===stringify(value,0),"Keep the original complete request fields.",{name,key});
    journal.requests[name]={path,sha256:sha256(await readBytes(path))};await persist();return original;
  }
  async function command(name,executable,args,{cwd=root}={}) {
    need(/^[a-z0-9-]+$/.test(name),"Use an ordinary native command identity.");
    const commandRoot=await directory(join(root,"commands",name),true);
    const original={executable,args,cwd};
    await retainedJson(join(commandRoot,"command.json"),original);
    const attempts=(await fs.readdir(commandRoot)).filter(value=>/^[0-9]{4}$/.test(value)).sort();
    const latest=attempts.at(-1),prior=latest?await json(join(commandRoot,latest,"result.json"),true):null;
    if(prior?.code===0)return {directory:join(commandRoot,latest),...prior,
      stdout:join(commandRoot,latest,"stdout.log"),stderr:join(commandRoot,latest,"stderr.log"),reused:true};
    const current=join(commandRoot,String(attempts.length+1).padStart(4,"0"));await directory(current,true);
    await retainedJson(join(current,"request.json"),original);
    const child=spawn(process.execPath,[join(root,"command-worker.mjs"),current],{
      cwd:root,env:process.env,stdio:["ignore","inherit","inherit",lock.fd]});
    await new Promise((ok,no)=>{child.once("spawn",ok);child.once("error",no);});
    const exit=await new Promise(resolveDone=>child.once("close",(code,signal)=>resolveDone({code,signal})));
    const result=await json(join(current,"result.json"),true);
    need(result,"The native command outcome is still retained by its original worker.",{name,directory:current,exit});
    const observed={directory:current,...result,stdout:join(current,"stdout.log"),stderr:join(current,"stderr.log"),reused:false};
    if(result.code!==0)throw Object.assign(new Error("The original native command returned a failure."),{code:"HAYSTACK_NATIVE_COMMAND_FAILED",result:observed});
    return observed;
  }
  const gitEnvNames=["GIT_INDEX_FILE","GIT_OBJECT_DIRECTORY","GIT_ALTERNATE_OBJECT_DIRECTORIES"];
  const originalGitEnv=Object.fromEntries(gitEnvNames.map(name=>[name,process.env[name]]));
  let managed=null;
  try {
    need(process.platform==="linux","Use the maintained Linux runtime and original kernel locks.");
    const version=process.versions.node.split(".").map(Number);
    need(version[0]>22||version[0]===22&&version[1]>=16,"Use Node 22.16 or newer for the maintained source.");
    need(typeof SourceTextModule==="function","Launch this runner with --experimental-vm-modules.");
    const cohortByPath=new Map(input.cohort.files.map(file=>[file.path,file]));
    const ownObjects=join(root,"git-objects"),ownIndex=join(root,"git-index");
    function git(args,{input:stdin,env=process.env}={}) {
      const response=spawnSync("git",["--no-replace-objects","-C",input.repository,...args],{
        env,input:stdin,encoding:null,maxBuffer:192*1024*1024});
      if(response.error||response.status!==0)throw Object.assign(new Error("The original Git source command failed."),{
        code:"HAYSTACK_GIT_SOURCE",details:{args,status:response.status,error:response.error?.message,stderr:response.stderr?.toString("utf8")}});
      return response.stdout;
    }
    const donorObjects=git(["rev-parse","--path-format=absolute","--git-path","objects"]).toString("utf8").trim();
    need(isAbsolute(donorObjects)&&!donorObjects.includes("\n")&&!donorObjects.includes(":"),
      "Use the original checkout's ordinary object directory.");
    process.env.GIT_INDEX_FILE=ownIndex;process.env.GIT_OBJECT_DIRECTORY=ownObjects;
    process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES=donorObjects+(originalGitEnv.GIT_ALTERNATE_OBJECT_DIRECTORIES?
      ":"+originalGitEnv.GIT_ALTERNATE_OBJECT_DIRECTORIES:"");
    const source=await stage("complete-git-source-snapshot",async()=>{
      need(git(["rev-parse",input.sourceCommit+"^{commit}"]).toString().trim()===input.sourceCommit,"The maintained base commit differs.");
      git(["read-tree",input.sourceCommit]);
      const entries=[],unchanged=[];
      for(const file of [...input.cohort.files].sort((a,b)=>a.path.localeCompare(b.path))){
        const tree=git(["ls-tree","-z",input.sourceCommit,"--",file.path]).toString("utf8");
        const match=tree?tree.match(/^([0-9]+) blob ([0-9a-f]{40})\t([^\0]+)\0$/):null;
        need(!tree||match&&match[3]===file.path,"The source preimage is not an ordinary Git blob.",{path:file.path});
        const mode=match?.[1]??"100644";
        need(["100644","100755"].includes(mode),"Retain ordinary source modes.",{path:file.path,mode});
        const raw=Buffer.from(file.content),actual=git(["hash-object","-w","--stdin"],{input:raw}).toString().trim();
        need(actual===file.gitBlobSha1,"The task-owned Git source differs.",{path:file.path});
        git(["update-index","--add","--cacheinfo",mode+","+actual+","+file.path]);
        entries.push({path:file.path,mode,preimage:match?.[2]??null,gitBlobSha1:actual,bytes:raw.length,sha256:sha256(raw)});
        if(match?.[2]===actual)unchanged.push(file.path);
      }
      const tree=git(["write-tree"]).toString().trim();
      const parentTree=git(["rev-parse",input.sourceCommit+"^{tree}"]).toString().trim();
      let commit=input.sourceCommit;
      if(tree!==parentTree){
        const commitEnv={...process.env,GIT_AUTHOR_NAME:"Commons native receiving",GIT_AUTHOR_EMAIL:"commons@users.noreply.github.com",
          GIT_COMMITTER_NAME:"Commons native receiving",GIT_COMMITTER_EMAIL:"commons@users.noreply.github.com",
          GIT_AUTHOR_DATE:journal.createdAt,GIT_COMMITTER_DATE:journal.createdAt};
        const message="Receive complete Haystack distribution for "+input.operationId+"\n\nOriginal input SHA256: "+journal.inputSha256+"\n";
        commit=git(["commit-tree",tree,"-p",input.sourceCommit],{input:Buffer.from(message),env:commitEnv}).toString().trim();
      }
      await retain(join(root,"source-commit.txt"),git(["cat-file","commit",commit]));
      return {repository:input.repository,baseCommit:input.sourceCommit,sourceCommit:commit,tree,
        objectDirectory:ownObjects,index:ownIndex,donorObjects,entries,unchanged:unchanged.length};
    });
    need(git(["rev-parse",source.sourceCommit+"^{tree}"]).toString().trim()===source.tree,"The retained original source snapshot is unavailable.");
    const bootstrap=await stage("original-builder-and-installer-source",async()=>{
      const pending=[DIST+"build.mjs",DIST+"runtime-install.mjs",DIST+"runtime-install-cli.mjs",DIST+"runtime-unpack.py"],
        visited=new Map(),context=createContext();
      while(pending.length){
        const path=relativeSource(pending.shift());if(visited.has(path))continue;
        const entry=git(["ls-tree","-z",source.sourceCommit,"--",path]).toString("utf8");
        const match=entry.match(/^([0-9]+) blob ([0-9a-f]{40})\t([^\0]+)\0$/);
        need(match&&match[3]===path&&["100644","100755"].includes(match[1]),"The maintained bootstrap dependency is unavailable.",{path});
        if(BOOTSTRAP_PINS[path])need(match[2]===BOOTSTRAP_PINS[path],"The maintained bootstrap changed since its complete source review.",{path,expected:BOOTSTRAP_PINS[path],actual:match[2]});
        const body=git(["cat-file","blob",match[2]]);
        need(body.length<=2*1024*1024&&gitBlob(body)===match[2],"The original bootstrap source is incomplete.",{path});
        await retain(join(root,"bootstrap",path),body);
        visited.set(path,{path,gitBlobSha1:match[2],bytes:body.length,sha256:sha256(body)});
        if(/\.(?:mjs|js)$/.test(path)){
          const module=new SourceTextModule(body.toString("utf8"),{context,identifier:path});
          for(const dependency of module.dependencySpecifiers){
            if(dependency.startsWith("node:"))continue;
            need(dependency.startsWith("."),"The maintained bootstrap requires an undeclared external module.",{path,dependency});
            pending.push(relativeSource(posix.normalize(posix.join(posix.dirname(path),dependency))));
          }
        }
      }
      return {sourceCommit:source.sourceCommit,files:[...visited.values()].sort((a,b)=>a.path.localeCompare(b.path))};
    });
    for(const file of bootstrap.files)need((await fileIdentity(join(root,"bootstrap",file.path))).sha256===file.sha256,"The retained original bootstrap bytes changed.",{path:file.path});
    const builder=await import(pathToFileURL(join(root,"bootstrap",DIST+"build.mjs")).href);
    const installer=await import(pathToFileURL(join(root,"bootstrap",DIST+"runtime-install.mjs")).href);
    const built=await stage("maintained-selected-distribution",async()=>{
      const output=join(root,"selected-distribution");
      return builder.buildDistribution({repository:input.repository,ref:source.sourceCommit,selection:SELECTION,
        output,offline:input.sourceOffline??false,resume:await exists(output),python:input.python??"python3",
        onProgress:event=>progress("maintained-builder",typeof event==="object"?event:{message:String(event)})});
    });
    need(built.status==="PACKAGED"&&built.sourceCommit===source.sourceCommit,"The maintained builder returned a different source snapshot.",{built});
    const builtArchive=await fileIdentity(built.archive);
    need(builtArchive.sha256===built.sha256,"The complete maintained distribution archive changed.");
    const installed=await stage("maintained-runtime-install",async()=>{
      let attempt=journal.installAttempts.at(-1);
      if(!attempt){attempt={directory:join(root,"runtime-01"),createdAt:now()};journal.installAttempts.push(attempt);await persist();}
      for(;;){
        if(await exists(join(attempt.directory,"runtime-install.json")))break;
        if(await exists(attempt.directory)){
          const previous=attempt.directory,hasPreparation=await exists(join(previous,"preparation.json"));
          attempt={directory:join(root,"runtime-"+String(journal.installAttempts.length+1).padStart(2,"0")),createdAt:now(),from:previous};
          journal.installAttempts.push(attempt);await persist();
          if(hasPreparation){
            await installer.recoverRuntime({from:previous,directory:attempt.directory,install:false,python:input.python??"python3"});
            break;
          }
          continue;
        }
        await installer.prepareRuntimeInstall({directory:attempt.directory,archive:built.archive,sha256:built.sha256,
          native:false,features:[],pins:{},operator:true,python:input.python??"python3"});break;
      }
      const result=await installer.installRuntime({directory:attempt.directory,offline:input.installOffline??true,
        cache:input.npmCache??null,npm:input.npm??"npm"});
      const observed=await installer.inspectRuntimeInstall({directory:attempt.directory,load:true,source:true,python:input.python??"python3"});
      need(observed.ready&&observed.status==="READY"&&observed.sourceVerified&&observed.sourceCommit===source.sourceCommit,
        "Complete the actual source-selected installation.",{observed});
      return {directory:attempt.directory,result,observed};
    });
    const liveInstall=await installer.inspectRuntimeInstall({directory:installed.directory,load:true,source:true,python:input.python??"python3"});
    need(liveInstall.ready&&liveInstall.sourceCommit===source.sourceCommit,"The original installed runtime changed.");
    const sourceRoot=liveInstall.sourceRoot,applicationRoot=join(sourceRoot,APP);
    const codec=await import(pathToFileURL(join(applicationRoot,"json-codec.mjs")).href);stringify=codec.stringifyJson;
    const native=(name,args)=>installer.runtimeCommand({directory:installed.directory,args}).then(value=>command(name,value.executable,value.args,{cwd:value.cwd}));

    const registered=await stage("installed-source-and-registrations",async()=>{
      const {readDistributionSpecification,inspectDistributionRegistrations}=
        await import(pathToFileURL(join(sourceRoot,DIST+"specification.mjs")).href);
      const distribution=await readDistributionSpecification({sourceRoot});
      const {spec,manifest}=distribution;
      need(manifest?.sourceCommit===source.sourceCommit&&manifest.sourceSelection?.id===SELECTION,
        "The installed distribution selected a different source or recipe.");
      need(spec.commands.haystack===APP+"cli.mjs"&&spec.commands["haystack-mcp"]===APP+"mcp.mjs",
        "The actual installed command registrations differ.");
      need(spec.applicationProviders["haystack-workspace"]===APP+"application-provider.mjs"&&
        spec.merchantProviders["haystack-workspaces"]===APP+"merchant-provider.mjs",
        "The complete application and Merchant providers must be registered.");
      const files=new Map(manifest.files.map(value=>[value.path,value]));
      const verified=[];
      for(const wanted of input.cohort.files){
        const found=files.get(wanted.path);
        need(found?.gitBlob===wanted.gitBlobSha1,"The installed manifest omitted or changed a full cohort member.",{path:wanted.path,found});
        const bytes=await readBytes(join(sourceRoot,wanted.path));
        need(gitBlob(bytes)===wanted.gitBlobSha1&&bytes.equals(Buffer.from(wanted.content)),
          "The actual installed source differs from its original complete postimage.",{path:wanted.path});
        verified.push({path:wanted.path,gitBlobSha1:wanted.gitBlobSha1,bytes:bytes.length,sha256:sha256(bytes)});
      }
      const cliSource=await native("installed-source",["source"]);
      const cliRegistrations=await native("installed-registrations",["registrations","--source","haystack-workspace"]);
      const cliDoctor=await native("installed-doctor",["doctor"]);
      const cliHelp=await native("installed-haystack-help",["haystack","--help"]);
      const cliProviders=await native("installed-merchant-provider",["merchant-providers","inspect","haystack-workspaces"]);
      const selected=JSON.parse((await readBytes(cliProviders.stdout)).toString("utf8"));
      need(selected.sourceCommit===source.sourceCommit&&selected.providers.some(provider=>provider.id==="haystack-workspaces"&&provider.toolCount>0),
        "The actual Merchant command did not select its full registered Haystack provider.");
      return {sourceCommit:source.sourceCommit,selection:manifest.sourceSelection,sourceFiles:verified,
        declarations:inspectDistributionRegistrations(distribution,{source:"haystack-workspace"}),
        commands:{source:cliSource,registrations:cliRegistrations,doctor:cliDoctor,help:cliHelp,providers:cliProviders}};
    });
    const portable=await import(pathToFileURL(join(applicationRoot,"portable.mjs")).href);
    const selectedApplication=[];
    for(const name of portable.APPLICATION_FILES){
      const bytes=await readBytes(join(applicationRoot,name));
      selectedApplication.push({name,bytes:bytes.length,sha256:sha256(bytes)});
    }
    const receivingDirectory=input.receivingDirectory??join(root,"native-receiving");
    const completeNative=await stage("original-complete-native-receiving",async()=>{
      const resultPath=join(receivingDirectory,"complete-result.json");
      let result=await json(resultPath,true),commandResult=null;
      if(!result){
        // The caller transfers this SAME original programme directory. Its own
        // original journal reconciles saved mutations and output files.
        commandResult=await command("original-native-receiving",process.execPath,
          [join(applicationRoot,"RECEIVING.mjs"),receivingDirectory]);
        result=await json(resultPath);
      }
      need(result.format==="commons.haystack.complete-receiving.v1"&&result.directory===receivingDirectory&&
        result.stages?.["stopped-writer-recovery"],"Continue the complete original receiving programme and its stopped-writer stage.");
      need(stringify(result.application,0)===stringify(selectedApplication,0),
        "The original receiving result belongs to different application bytes.",{original:result.application,current:selectedApplication});
      const fixture=await readBytes(join(applicationRoot,"fixture-charlie.json"));
      need(result.source.sha256===sha256(fixture)&&result.source.bytes===fixture.length,
        "The original receiving operation used different upstream source bytes.");
      const fullPackage=await readBytes(result.package.file.path);
      need(sha256(fullPackage)===result.package.file.sha256,"The original complete editable workspace changed.");
      const verified=portable.verifyBundle(fullPackage);
      need(verified.state.workspaceId===result.workspaceId&&verified.application.size===selectedApplication.length,
        "The complete delivered application does not match the original operation.");
      for(const item of selectedApplication){
        need(sha256(verified.application.get(item.name))===item.sha256,"A complete received application source differs.",{name:item.name});
        need((await fileIdentity(join(result.received,"application",item.name))).sha256===item.sha256,
          "The independently received application differs.",{name:item.name});
      }
      return {result:await fileIdentity(resultPath),operationId:result.operationId,workspaceId:result.workspaceId,
        receivingDirectory,received:result.received,source:result.source,application:result.application,
        package:result.package,stages:Object.keys(result.stages).length,command:commandResult};
    });
    need((await fileIdentity(completeNative.result.path)).sha256===completeNative.result.sha256,
      "The original completed native result changed after its handoff.");
    const received=completeNative.received;
    const standalone=await stage("received-standalone-and-installed-cli",async()=>{
      const installedStatus=await native("installed-received-status",["haystack","status","--directory",received]);
      const standaloneStatus=await command("received-standalone-status",process.execPath,
        [join(received,"application","cli.mjs"),"status","--directory",received]);
      const left=JSON.parse((await readBytes(installedStatus.stdout)).toString("utf8"));
      const right=JSON.parse((await readBytes(standaloneStatus.stdout)).toString("utf8"));
      need(left.workspaceId===completeNative.workspaceId&&stringify(left,0)===stringify(right,0),
        "Installed and delivered CLI commands must reopen the same complete workspace.");
      const output=join(root,"outputs","installed-complete-register.json");
      const register=await native("installed-complete-register",["haystack","records","--directory",received,"--out",output]);
      const all=await json(output);
      need(all.complete===true&&all.items.length===left.recordCount,
        "The installed CLI must export every selected source record.");
      return {workspaceId:left.workspaceId,revision:left.revision,recordCount:left.recordCount,
        installedStatus,standaloneStatus,register,completeRegister:await fileIdentity(output)};
    });
    const modelSource=await import(pathToFileURL(join(sourceRoot,DIST+"runtime-workspace/model.mjs")).href);
    const managedRoot=await stage("original-runtime-workspace",async()=>{
      let attempt=journal.managedAttempts.at(-1);
      if(!attempt){attempt={directory:join(root,"applications-01"),createdAt:now()};journal.managedAttempts.push(attempt);await persist();}
      for(;;){
        if(await exists(join(attempt.directory,"workspace.json")))break;
        if(await exists(attempt.directory)){
          const previous=attempt.directory;
          attempt={directory:join(root,"applications-"+String(journal.managedAttempts.length+1).padStart(2,"0")),createdAt:now(),from:previous};
          journal.managedAttempts.push(attempt);await persist();continue;
        }
        await modelSource.createRuntimeWorkspace({directory:attempt.directory});break;
      }
      const owner=await modelSource.openRuntimeWorkspace({directory:attempt.directory});
      try {
        const attached=await owner.attach({directory:installed.directory,label:"Haystack turnover "+input.operationId});
        need(attached.status==="READY","Attach the actual READY installed runtime.");
        return {directory:attempt.directory,...attached};
      } finally { await owner.close(); }
    });
    managed=await modelSource.openRuntimeWorkspace({directory:managedRoot.directory});
    const applicationReview=await stage("complete-application-review",async()=>{
      const reviewed=await managed.applicationsReview({runtimeId:managedRoot.runtimeId,kind:"haystack-workspace",
        settings:{workspaceDirectory:received,port:0},label:"Charlie building turnover"});
      need(reviewed.kind==="haystack-workspace"&&reviewed.command.args.includes(received),
        "The reviewed application must select the original received workspace.");
      return reviewed;
    });
    const savedApplication=await stage("saved-application-and-original-adoption",async()=>{
      let original=await json(join(root,"requests","application-save.json"),true);
      if(!original)original=await request("application-save",{requestId:randomUUID(),reviewId:applicationReview.id,applicationId:null});
      const result=await managed.applicationsSave({requestId:original.requestId,reviewId:original.reviewId,applicationId:null});
      need(result.saved&&result.applicationId,"The original Applications save did not retain its request.",{result});
      return result;
    });
    async function applicationView() {
      const state=await managed.applicationsState({historyLimit:1});
      const application=state.applications.find(value=>value.id===savedApplication.applicationId);
      need(application,"The original saved application is missing.");return {state,application};
    }
    async function observeApplication(name,condition,{connect=false,recover=false}={}) {
      let last=null,lastProgress=0,connected=false,recovered=false;
      for(;;){
        const current=await applicationView(),application=current.application;
        const signature=stringify({phase:application.phase,release:application.release?.id,
          adoption:application.adoption?.phase,current:application.current?.phase,
          currentActive:application.current?.active,url:application.current?.privateUrl},0);
        if(signature!==last){
          await save(join(root,"outputs",name+"-latest.json"),{observedAt:now(),...current});
          last=signature;progress(name,{phase:application.phase,operationId:application.current?.id??application.adoption?.id??null});
          lastProgress=Date.now();
        } else if(Date.now()-lastProgress>20000){progress(name,{phase:application.phase});lastProgress=Date.now();}
        if(condition(application))return current;
        if(connect&&!application.release&&!connected){
          connected=true;
          await save(join(root,"outputs",name+"-connection.json"),await managed.applicationsConnect({applicationId:application.id}));
          continue;
        }
        const work=application.current??application.adoption;
        if(recover&&work&&!work.active&&!recovered&&["PENDING","QUEUED","INTERRUPTED","FAILED"].includes(work.phase)){
          recovered=true;
          await save(join(root,"outputs",name+"-recovery.json"),await managed.applicationsRecover({applicationId:application.id,operationId:work.id}));
          continue;
        }
        need(!["FAILED","UNAVAILABLE"].includes(application.phase)&&work?.phase!=="FAILED",
          "The original maintained application operation returned a failure.",{application});
        need(!(application.current&&!application.current.active&&
          ["SUCCEEDED","CANCELLED"].includes(application.current.phase)),
          "The original application ended before the retained live operation completed.",{application});
        await new Promise(resolveDone=>setTimeout(resolveDone,250));
      }
    }
    const connected=await stage("original-managed-release-connected",async()=>{
      const observed=await observeApplication("application-connection",value=>Boolean(value.release),{connect:true});
      return {application:observed.application,workspaceDirectory:managedRoot.directory};
    });
    let startOriginal=await json(join(root,"requests","application-start.json"),true);
    if(!startOriginal){
      const reviewed=await managed.applicationsStartReview({applicationId:savedApplication.applicationId});
      await retainedJson(join(root,"outputs","application-start-review.json"),reviewed);
      startOriginal=await request("application-start",{requestId:randomUUID(),applicationId:savedApplication.applicationId,reviewId:reviewed.id});
    }
    const launched=await stage("original-managed-application-launch",async()=>{
      // Reusing the saved request is the original Applications replay/recovery path.
      const result=await managed.applicationsStart({applicationId:startOriginal.applicationId,
        requestId:startOriginal.requestId,reviewId:startOriginal.reviewId});
      need(result.operationId===startOriginal.requestId,"The application launch changed its original request ID.");
      return result;
    });
    const live=await stage("installed-application-live-and-registered-provider",async()=>{
      const observed=await observeApplication("application-launch",
        value=>value.current?.id===startOriginal.requestId&&Boolean(value.current.privateUrl),{recover:true});
      const application=observed.application,url=application.current.privateUrl;
      const {HaystackClient}=await import(pathToFileURL(join(applicationRoot,"client.mjs")).href);
      const client=new HaystackClient({url,workspaceId:completeNative.workspaceId});
      const identity=await client.connect(),status=await client.request("workspace.status",{});
      need(status.workspaceId===completeNative.workspaceId&&status.revision===standalone.revision,
        "The maintained application must reopen the unchanged received edition.");
      const fixture=Buffer.from(await client.sourceBytes(completeNative.source.sha256));
      need(fixture.length===completeNative.source.bytes&&sha256(fixture)===completeNative.source.sha256,
        "The live managed application must retain every original source byte.");
      const hostPath=join(root,"registered-merchant-host.json");
      await retainedJson(hostPath,{schema:"stellar-forge.haystack-workspace-host.v1",workspaces:{turnover:{
        label:"Original received Charlie turnover",workspaceId:completeNative.workspaceId,
        connectionFile:join(received,"connection.json"),inputs:{charlie:{
          label:"Original retained Charlie grid",path:join(applicationRoot,"fixture-charlie.json"),kind:"source",
          name:"charlie.json",mediaType:"application/json",sha256:completeNative.source.sha256,
          sourceReference:"https://project-haystack.org/example/download/charlie.json"
        }}
      }}});
      const setupPath=join(root,"registered-merchant-setup.json"),merchantDirectory=join(root,"registered-merchant");
      await retainedJson(setupPath,{directory:merchantDirectory,connection:hostPath,name:"Haystack turnover distribution"});
      const initialized=await native("registered-merchant-initialize",["merchant-providers","init","haystack-workspaces","--options",setupPath]);
      const initializedValue=JSON.parse((await readBytes(initialized.stdout)).toString("utf8"));
      need(initializedValue.state==="INITIALIZED"&&initializedValue.haystackWorkspacesConfigured,
        "The registered provider initializer did not complete its actual host configuration.");
      const {readMerchantConfig}=await import(pathToFileURL(join(sourceRoot,"stellar-forge/mcp-merchant-operator/config.mjs")).href);
      const {readMerchantProviders}=await import(pathToFileURL(join(sourceRoot,"stellar-forge/mcp-merchant-operator/provider-registry.mjs")).href);
      const registry=await readMerchantProviders({sourceRoot}),provider=registry.forId("haystack-workspaces");
      need(registry.sourceCommit===source.sourceCommit,"The actual Merchant registry selected different source.");
      const config=await readMerchantConfig(initializedValue.configuration);
      const service=provider.create(await provider.load(),config);
      try {
        const nativeCatalog=await import(pathToFileURL(join(applicationRoot,"catalog.mjs")).href);
        const toolFor=action=>"merchant_"+nativeCatalog.tools.find(value=>value.action===action).name;
        const aliases=await service.call("merchant_haystack_workspaces",{});
        const inputFile=await service.call("merchant_haystack_input",{workspace:"turnover",input:"charlie",expectedSha256:completeNative.source.sha256});
        const selected=await service.call(toolFor("workspace.status"),{workspace:"turnover"});
        need(selected.workspaceId===status.workspaceId&&selected.revision===status.revision&&inputFile.bytes===fixture.length,
          "The registered Merchant owner selected different live source.");
        const rows=[];let offset=0,total=null;
        for(;;){
          const page=await service.call(toolFor("records.list"),{workspace:"turnover",expectedRevision:selected.revision,offset,limit:137});
          need(page.workspaceId===selected.workspaceId&&page.revision===selected.revision&&page.offset===offset,
            "A registered Merchant page changed source identity.");
          if(total!==null)need(page.total===total,"The full registered source result changed between pages.");
          total=page.total;rows.push(...page.items);
          if(!page.hasMore){need(rows.length===total&&total===selected.recordCount,"The registered provider ended before every source row.");break;}
          need(page.nextOffset>offset&&page.nextOffset<=total,"The original registered page cursor did not advance.");offset=page.nextOffset;
        }
        const recordFile=await retainedJson(join(root,"outputs","registered-merchant-complete-register.json"),{
          operationId:input.operationId,workspaceId:selected.workspaceId,revision:selected.revision,total,items:rows
        });
        await service.close();
        const after=await client.request("workspace.status",{});
        need(after.workspaceId===selected.workspaceId&&after.revision===selected.revision,
          "Closing the borrowed registered provider changed the original live application.");
        return {application:observed.application,identity,status,initialized,aliases,inputFile,sourceSha256:sha256(fixture),
          registeredProvider:registry.sources.find(value=>value.id==="haystack-workspaces"),completeRegister:recordFile,
          providerClosed:true,applicationAfterProviderClose:after};
      } finally { await service.close(); }
    });
    const stopped=await stage("original-application-stopped-and-history",async()=>{
      const current=(await applicationView()).application;
      let stop=null;
      if(current.current?.id===startOriginal.requestId&&!["SUCCEEDED","CANCELLED"].includes(current.current.phase))
        stop=await managed.applicationsStop({applicationId:savedApplication.applicationId,operationId:startOriginal.requestId});
      const observed=await observeApplication("application-stop",
        value=>value.current?.id===startOriginal.requestId&&value.phase==="STOPPED",{recover:true});
      need(observed.application.phase==="STOPPED","The original application did not finish its explicit stop.",{application:observed.application});
      const history=[],pages=[];let cursor;
      for(;;){
        const page=await managed.applicationsHistory({applicationId:savedApplication.applicationId,limit:30,...(cursor?{cursor}:{})});
        history.push(...page.runs);pages.push(page);
        if(!page.nextCursor)break;
        need(page.nextCursor!==cursor,"The actual application history cursor repeated.");cursor=page.nextCursor;
      }
      need(history.filter(value=>value.id===startOriginal.requestId).length===1,"The saved application history changed its original launch identity.");
      const output=await managed.applicationsOutput({applicationId:savedApplication.applicationId,operationId:startOriginal.requestId});
      const fullState=await managed.state({runtimeId:managedRoot.runtimeId});
      const file=await retainedJson(join(root,"outputs","complete-managed-application-history.json"),{
        application:observed.application,history,pages,output,runtimeWorkspace:fullState
      });
      return {applicationId:savedApplication.applicationId,operationId:startOriginal.requestId,stop,
        phase:observed.application.phase,history:file};
    });
    await managed.close();managed=null;
    const finalInstall=await installer.inspectRuntimeInstall({directory:installed.directory,load:true,source:true,python:input.python??"python3"});
    need(finalInstall.ready&&finalInstall.sourceCommit===source.sourceCommit,"The installed distribution changed during its full native operation.");
    const result={format:FORMAT,operationId:input.operationId,directory:root,inputSha256:journal.inputSha256,
      sourceCommit:source.sourceCommit,baseCommit:input.sourceCommit,selection:SELECTION,startedAt:journal.createdAt,
      completedAt:now(),distribution:{...built,archive:builtArchive},runtime:finalInstall,
      nativeReceiving:completeNative,application:{applicationId:savedApplication.applicationId,
        operationId:startOriginal.requestId,phase:stopped.phase,workspaceId:completeNative.workspaceId},
      sources:registered.sourceFiles,stages:journal.stages,requests:journal.requests,
      operationJournal:journalPath};
    const completePath=join(root,"complete-result.json");
    const previousComplete=await json(completePath,true);
    if(previousComplete){
      need(previousComplete.operationId===input.operationId&&previousComplete.inputSha256===journal.inputSha256&&
        previousComplete.sourceCommit===source.sourceCommit,"The original completed distribution result differs.");
    } else await retainedJson(completePath,result);
    invocation.completedAt=now();journal.state="COMPLETED";journal.completedAt=previousComplete?.completedAt??result.completedAt;await persist();
    const archiveInput=join(root,"archive-request.json");
    await retainedJson(archiveInput,{operation_id:input.operationId,directory:root,receiving_directory:receivingDirectory,
      complete_result_sha256:sha256(await readBytes(completePath))});
    const archived=await command("preserve-complete-operation",input.python??"python3",[join(root,"archive-operation.py"),archiveInput]);
    const archiveReceipt=JSON.parse((await readBytes(archived.stdout)).toString("utf8"));
    need(archiveReceipt.operationId===input.operationId,"The whole operation archive belongs to another task.");
    progress("complete-maintained-distribution",{completed:true,result:completePath,runtime:installed.directory,
      applicationId:savedApplication.applicationId,originalNativeOperationId:completeNative.operationId,archive:archiveReceipt});
    return {...await json(completePath),archive:archiveReceipt};
  } catch(error) {
    invocation.failedAt=now();invocation.error=errorView(error);journal.state="CONTINUING";
    await persist().catch(()=>{});
    progress("original-operation-retained",{error:errorView(error),journal:journalPath});
    throw error;
  } finally {
    if(managed)await managed.close().catch(()=>{});
    for(const [name,value]of Object.entries(originalGitEnv)){
      if(value===undefined)delete process.env[name];else process.env[name]=value;
    }
  }
  } finally { await lock.close(); }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==3){
    process.stderr.write("Use node --experimental-vm-modules --no-warnings DISTRIBUTION_RECEIVING.mjs /absolute/original-input.json\n");
    process.exitCode=2;
  } else main(process.argv[2]).catch(error=>{
    process.stderr.write(JSON.stringify(errorView(error))+"\n");process.exitCode=1;
  });
}
