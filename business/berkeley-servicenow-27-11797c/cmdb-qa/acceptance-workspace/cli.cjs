#!/usr/bin/env node
/* SPDX-License-Identifier: MIT */
"use strict";
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),crypto=require("node:crypto");
const C=require("./workspace.cjs");
const stringify=x=>JSON.stringify(x,null,2)+"\n";
const digest=x=>crypto.createHash("sha256").update(x).digest("hex");
function fail(message,code="INPUT_REJECTED"){throw Object.assign(new Error(message),{code});}
function regular(file){const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink())fail("Use a regular local file: "+file);return s;}
function readText(file,max=128*1024*1024,preserveBom=false){const s=regular(file);if(s.size>max)fail("The selected file is larger than the supported local package.");return new TextDecoder("utf-8",{fatal:true,ignoreBOM:preserveBom}).decode(fs.readFileSync(file));}
function jsonFile(file){try{return JSON.parse(readText(file));}catch(e){fail("Cannot read complete JSON from "+file+": "+e.message);}}
function syncDir(dir){const h=fs.openSync(dir,"r");try{fs.fsyncSync(h);}finally{fs.closeSync(h);}}
function exclusive(file,data){const h=fs.openSync(file,"wx",0o600);try{fs.writeFileSync(h,data);fs.fsyncSync(h);}finally{fs.closeSync(h);}}
function readWorkspace(file){return C.receive(readText(file));}
function lockFor(file,fn){
 const dir=path.dirname(file);fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const lock=file+".lock",token=crypto.randomUUID(),record={schema:"cmdb-workspace-writer/1",host:os.hostname(),pid:process.pid,token,createdAt:new Date().toISOString()};
 try{exclusive(lock,stringify(record));syncDir(dir);}catch(e){if(e.code==="EEXIST")fail("Another writer has reserved this workspace. Inspect "+lock+"; resume that writer, or use unlock with its exact token after its process has stopped.","WRITER_BUSY");throw e;}
 try{return fn();}finally{
  try{if(jsonFile(lock).token!==token)fail("The writer reservation changed; keep the lock for investigation.","WRITER_CHANGED");fs.unlinkSync(lock);syncDir(dir);}
  catch(e){if(e.code!=="ENOENT")throw e;}
 }
}
function writeWorkspace(file,w,expected){
 C.validate(w);const raw=stringify(C.pack(w));
 if(expected===null&&fs.existsSync(file))fail("Choose a new workspace path. The existing file is retained.","WORKSPACE_EXISTS");
 if(expected!==null){if(!fs.existsSync(file)||digest(fs.readFileSync(file))!==expected)fail("The workspace changed after reading it. Reload before saving.","WORKSPACE_CHANGED");if(fs.readFileSync(file,"utf8")===raw)return;}
 const temporary=file+".pending-"+crypto.randomUUID();exclusive(temporary,raw);
 try{if(expected===null){fs.linkSync(temporary,file);fs.unlinkSync(temporary);}else fs.renameSync(temporary,file);syncDir(path.dirname(file));}
 finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
function summary(w,runId){
 C.validate(w);const run=runId?w.runs.find(x=>x.id===runId):w.runs.at(-1);if(runId&&!run)fail("The requested comparison is absent.");
 const a=run?C.acceptance(w,run.id):null;
 return {schema:"cmdb-workspace-summary/1",workspaceId:w.id,customer:w.customer,label:w.label,revision:w.revision,sha256:C.pack(w).sha256,
  exports:w.snapshots.map(x=>({id:x.id,side:x.side,label:x.label,filename:x.filename,rows:x.rows,parseError:x.parseError,parentId:x.parentId,sha256:x.sha256})),
  mappings:w.mappings.map(x=>({id:x.id,label:x.label,key:x.key,fields:x.fields})),
  comparisons:w.runs.map(x=>({id:x.id,label:x.label,sourceId:x.sourceId,targetId:x.targetId,previousRunId:x.previousRunId,summary:x.audit.summary})),
  selected:run?{id:run.id,summary:run.audit.summary,lineage:C.lineage(w,run.id),decision:a,receivingStatus:a?.current?a.status:"REVIEW_REQUIRED",findings:C.reviewRows(w,run.id)}:null};
}
function exportDirectory(w,runId,destination){
 C.validate(w);if(fs.existsSync(destination))fail("Choose a new export directory; an existing delivery is retained.","EXPORT_EXISTS");
 const run=w.runs.find(x=>x.id===runId);if(!run)fail("Select an existing comparison to export.");
 const parent=path.dirname(destination);fs.mkdirSync(parent,{recursive:true,mode:0o700});
 const staging=fs.mkdtempSync(path.join(parent,".cmdb-delivery-"));fs.chmodSync(staging,0o700);
 const members=[];function put(name,body){const target=path.join(staging,name);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});exclusive(target,body);members.push({path:name,bytes:Buffer.byteLength(body),sha256:digest(body)});}
 try{
  put("workspace.package.json",stringify(C.pack(w)));put("receiving-summary.json",stringify(summary(w,runId)));
  put("acceptance.html",C.report(w,runId));put("exceptions.csv",C.exceptionsCsv(w,runId));put("audit.json",stringify(run.audit));
  const mapping=w.mappings.find(x=>x.id===run.mappingId),mapped=C.preview(w,run.sourceId,run.targetId,mapping);
  put("mapped-source.csv",mapped.source.text);put("mapped-target.csv",mapped.target.text);
  const originals=[];for(const [i,s]of w.snapshots.entries()){const name="originals/"+String(i+1).padStart(3,"0")+".csv";put(name,s.text);originals.push({path:name,id:s.id,filename:s.filename,side:s.side,sha256:s.sha256,bytes:s.bytes,parentId:s.parentId});}
  put("original-exports.json",stringify(originals));put("operations.json",stringify(w.events));
  put("README.md","# CMDB migration acceptance\n\nOpen acceptance.html for the receiving decision and exceptions.csv for the assigned findings. workspace.package.json contains the full editable original exports, mapping, comparisons and review history. Receive it into a new workspace with the included operating CLI. Original filenames and correction ancestry are listed in original-exports.json. The mapped CSVs reproduce this selected comparison with the original comparator. Exact source and target values stay in this private delivery; share through the agreed customer route.\n");
  put("manifest.json",stringify({schema:"cmdb-workspace-delivery/1",workspaceId:w.id,revision:w.revision,workspaceSha256:C.pack(w).sha256,runId,files:members.slice()}));
  for(const dir of ["originals",""]){syncDir(path.join(staging,dir));}
  if(fs.existsSync(destination))fail("The export destination was created by another writer.","EXPORT_EXISTS");
  fs.renameSync(staging,destination);syncDir(parent);
  return {directory:destination,workspaceSha256:C.pack(w).sha256,revision:w.revision,runId,files:members};
 }catch(e){e.message+=" Prepared delivery remains at "+staging;throw e;}
}
const USAGE="CMDB acceptance CLI\n\nnode cli.cjs init --workspace FILE --settings JSON\nnode cli.cjs receive --workspace NEW_FILE --package JSON\nnode cli.cjs apply --workspace FILE --command JSON\nnode cli.cjs import --workspace FILE --command JSON --csv ORIGINAL_CSV\nnode cli.cjs show --workspace FILE [--run COMPARISON_ID]\nnode cli.cjs preview --workspace FILE --source EXPORT_ID --target EXPORT_ID --mapping JSON\nnode cli.cjs export --workspace FILE --run COMPARISON_ID --out NEW_DIRECTORY\nnode cli.cjs unlock --workspace FILE --token OBSERVED_LOCK_TOKEN\n\nSettings match workspace.create. Commands contain requestId, expectedRevision, actor, exact UTC at, action and payload. apply supports mapping, compare, review, accept and settings as well as complete imports. import reads the original CSV bytes and sets payload.text; retain filename, label, side and correction parent in the command. Each write reserves one writer, checks the current saved edition and commits an atomic durable package. unlock only removes an observed same-host lock whose process is absent. Never remove another active writer's reservation.\n";
function run(argv){
 if(!argv.length||argv[0]==="help"||argv[0]==="--help")return {help:USAGE};
 const [action,...args]=argv,opts={};for(let i=0;i<args.length;i+=2){if(!args[i].startsWith("--")||!args[i+1]||args[i+1].startsWith("--")||opts[args[i]])fail("Use a value once for every option.\n"+USAGE);opts[args[i]]=args[i+1];}
 const allowed={init:["workspace","settings"],receive:["workspace","package"],apply:["workspace","command"],import:["workspace","command","csv"],show:["workspace","run"],preview:["workspace","source","target","mapping"],export:["workspace","run","out"],unlock:["workspace","token"]};
 if(!allowed[action])fail("Unknown command.\n"+USAGE);for(const k of Object.keys(opts))if(!allowed[action].includes(k.slice(2)))fail("Unknown option "+k+".");
 const required=action==="show"?["workspace"]:allowed[action];for(const k of required)if(!opts["--"+k])fail("Missing --"+k+".\n"+USAGE);
 const file=path.resolve(opts["--workspace"]);
 if(action==="show")return summary(readWorkspace(file),opts["--run"]);
 if(action==="preview")return C.preview(readWorkspace(file),opts["--source"],opts["--target"],jsonFile(path.resolve(opts["--mapping"])));
 if(action==="export"){const destination=path.resolve(opts["--out"]);return lockFor(destination,()=>exportDirectory(readWorkspace(file),opts["--run"],destination));}
 if(action==="unlock"){
  const name=file+".lock",record=jsonFile(name);if(record.schema!=="cmdb-workspace-writer/1"||record.token!==opts["--token"]||record.host!==os.hostname()||!Number.isSafeInteger(record.pid)||record.pid<=0)fail("Use the exact same-host reservation and token.");
  let active=true;try{process.kill(record.pid,0);}catch(e){if(e.code==="ESRCH")active=false;else throw e;}
  if(active)fail("The recorded writer process is still present. Resume that process.","WRITER_BUSY");
  if(jsonFile(name).token!==record.token)fail("The writer reservation changed.","WRITER_CHANGED");
  fs.unlinkSync(name);syncDir(path.dirname(name));return {unlocked:true,workspace:file};
 }
 return lockFor(file,()=>{
  if(action==="init"||action==="receive"){const w=action==="init"?C.create(jsonFile(path.resolve(opts["--settings"]))):C.receive(jsonFile(path.resolve(opts["--package"])));writeWorkspace(file,w,null);return summary(w);}
  regular(file);const before=fs.readFileSync(file),w=C.receive(new TextDecoder("utf-8",{fatal:true}).decode(before)),command=jsonFile(path.resolve(opts["--command"]));
  if(action==="import"){if(command.action!=="import")fail("The import command must use action import.");command.payload={...command.payload,text:readText(path.resolve(opts["--csv"]),16*1024*1024,true)};}
  const result=C.transition(w,command);writeWorkspace(file,result.workspace,digest(before));
  return {workspaceId:result.workspace.id,revision:result.workspace.revision,sha256:C.pack(result.workspace).sha256,replayed:result.replayed,result:result.result};
 });
}
module.exports={run,readWorkspace,summary,exportDirectory,USAGE};
if(require.main===module){try{const out=run(process.argv.slice(2));process.stdout.write(out.help||stringify(out));}catch(e){process.stderr.write(stringify({error:e.code||"INPUT_REJECTED",message:e.message}));process.exitCode=2;}}
