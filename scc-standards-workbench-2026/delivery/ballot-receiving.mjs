// Complete member-to-secretariat operating course for the installed SCC workbench.
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";
import http from "node:http";
import {spawn,execFileSync} from "node:child_process";
import {createHash,randomUUID} from "node:crypto";
import assert from "node:assert/strict";

const OPERATION="SCC-BALLOT-RECEIVING-9B2C-20261013";
const sha=b=>createHash("sha256").update(b).digest("hex");
const canonical=v=>v===null?"null":Array.isArray(v)?"["+v.map(canonical).join(",")+"]":typeof v==="object"?"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canonical(v[k])).join(",")+"}":JSON.stringify(v);
const read=p=>JSON.parse(fs.readFileSync(p,"utf8"));
const args=process.argv.slice(2),at=args.indexOf("--config");
assert.ok(at>=0&&args[at+1]&&path.isAbsolute(args[at+1]),"Use --config ABSOLUTE_JSON_CONFIGURATION");
const config=read(args[at+1]);
for(const key of ["source","workspace","output","python","playwright","chromium"])
 assert.ok(typeof config[key]==="string"&&path.isAbsolute(config[key]),"Configuration requires an absolute "+key);
process.umask(0o077);
for(const dir of [config.output,config.workspace])fs.mkdirSync(dir,{recursive:true,mode:0o700});
for(const key of ["source","workspace","output"])config[key]=fs.realpathSync(config[key]);
assert.ok(![config.workspace,config.output].some(p=>p===config.source||p.startsWith(config.source+path.sep)),"Keep the original source separate from the operated case.");
const out=name=>path.join(config.output,name);
function write(file,raw,replace=false){
 raw=Buffer.isBuffer(raw)?raw:Buffer.from(raw);
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 if(!replace&&fs.existsSync(file)){assert.deepEqual(fs.readFileSync(file),raw,"Retained file differs: "+file);return;}
 const tmp=file+"."+randomUUID()+".next",fd=fs.openSync(tmp,"wx",0o600);
 try{fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 try{if(replace)fs.renameSync(tmp,file);else{try{fs.linkSync(tmp,file);}catch(e){if(e.code!=="EEXIST")throw e;assert.deepEqual(fs.readFileSync(file),raw);}fs.unlinkSync(tmp);}}
 finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
 const dir=fs.openSync(path.dirname(file),"r");try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}
const json=(file,value,replace=false)=>{if(!replace&&fs.existsSync(file)){assert.deepEqual(read(file),value,"Retained JSON value differs: "+file);return;}write(file,JSON.stringify(value,null,2)+"\n",replace);};
const pin=file=>{const b=fs.readFileSync(file);return{path:path.relative(config.output,file).split(path.sep).join("/"),bytes:b.length,sha256:sha(b)};};
function inventory(root){
 const rows=[];function visit(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
 if(["__pycache__","build","dist",".git"].includes(entry.name)||entry.name.endsWith(".egg-info"))continue;
 const p=path.join(dir,entry.name);assert.ok(!entry.isSymbolicLink(),"Source must retain ordinary files: "+p);
 if(entry.isDirectory())visit(p);else if(entry.isFile()){const b=fs.readFileSync(p);rows.push({path:path.relative(root,p).split(path.sep).join("/"),bytes:b.length,sha256:sha(b)});}
 }}visit(root);return rows;
}
const sourceFiles=inventory(config.source),sourceIdentity=sha(canonical(sourceFiles));
const binding={operation:OPERATION,source:config.source,workspace:config.workspace,output:config.output,python:config.python,playwright:config.playwright,chromium:config.chromium};
if(!args.includes("--lock-held")){
 const stdio=["inherit","inherit","inherit"],inherited=Number(config.controller_lock_fd);
 if(config.controller_lock_fd!==undefined){assert.ok(Number.isInteger(inherited)&&inherited>=3);fs.fstatSync(inherited);while(stdio.length<=inherited)stdio.push("ignore");stdio[inherited]=inherited;}
 const child=spawn(config.flock||"flock",["--exclusive","--nonblock",out("operation.lock"),process.execPath,path.resolve(process.argv[1]),...args,"--lock-held"],{stdio});
 child.once("error",e=>{console.error(e.message);process.exitCode=1;});
 child.once("exit",(code,signal)=>{process.exitCode=code??(signal?1:0);});
}else{
 await run();
}
async function run(){
 json(out("operation-selection.json"),binding);
 const marker=path.join(config.workspace,"ballot-operation.json");
 if(!fs.existsSync(marker))assert.equal(fs.readdirSync(config.workspace).length,0,"Select a separate empty ballot workspace, preserving the original consultation case.");
 json(marker,{operation:OPERATION,output:config.output});
 if(config.original_baseline_archive){
  assert.ok(path.isAbsolute(config.original_baseline_archive)&&typeof config.original_baseline_sha256==="string"&&typeof config.continued_from_output==="string"&&path.isAbsolute(config.continued_from_output));
  const raw=fs.readFileSync(config.original_baseline_archive);assert.equal(sha(raw),config.original_baseline_sha256);
  const parentProgress=read(path.join(config.continued_from_output,"progress.json"));assert.equal(parentProgress.operation,OPERATION);assert.notEqual(config.output,config.continued_from_output);
  json(out("original-baseline-continuation.json"),{operation:OPERATION,parent_output:config.continued_from_output,parent_source_identity:parentProgress.source_identity,parent_active:parentProgress.active,archive:config.original_baseline_archive,bytes:raw.length,sha256:sha(raw),reason:config.baseline_continuation_note});
  if(!fs.existsSync(out("progress.json")))execFileSync(config.python,["-B",path.join(config.source,"server.py"),"--workspace",config.workspace,"--restore",config.original_baseline_archive,"--no-serve"],{stdio:["ignore","pipe","pipe"]});
 }

 const progressFile=out("progress.json");
 const progress=fs.existsSync(progressFile)?read(progressFile):{schema:"scc-ballot-receiving/v1",operation:OPERATION,started_at:new Date().toISOString(),steps:{}};
 assert.equal(progress.operation,OPERATION);
 if(progress.source_identity&&progress.source_identity!==sourceIdentity){
  assert.equal(config.continuation_from_source_identity,progress.source_identity,"Select the exact retained source identity for an explicit continuation.");
  assert.ok(typeof config.source_change_note==="string"&&config.source_change_note.trim());
  (progress.source_revisions??=[]).push({previous:progress.source_identity,current:sourceIdentity,note:config.source_change_note,at:new Date().toISOString()});
 }
 progress.source_identity=sourceIdentity;progress.source_files=sourceFiles;
 const save=()=>json(progressFile,progress,true);
 const stage=async(name,action)=>{if(progress.steps[name])return progress.steps[name].value;progress.active=name;save();const value=await action();progress.steps[name]={at:new Date().toISOString(),value:value??null};save();process.stdout.write(JSON.stringify({operation:OPERATION,stage:name,complete:true})+"\n");return value;};
 save();
 const editionRoot=out("receiving/"+sourceIdentity),viewsFile=path.join(editionRoot,"views.json"),attachmentsFile=path.join(editionRoot,"outgoing-attachments.json"),resultFile=path.join(editionRoot,"result.json");
 fs.mkdirSync(editionRoot,{recursive:true,mode:0o700});
 function verifyPins(rows){
  assert.ok(Array.isArray(rows));
  for(const row of rows){
   assert.ok(typeof row.path==="string"&&row.path&&!row.path.includes("\\")&&!path.isAbsolute(row.path)&&!row.path.split("/").some(p=>!p||p==="."||p===".."));
   const file=out(row.path),resolved=fs.realpathSync(file);assert.ok(resolved.startsWith(config.output+path.sep));
   assert.deepEqual(pin(file),{path:row.path,bytes:row.bytes,sha256:row.sha256},"Retained artifact differs: "+row.path);
  }
 }
 function selectResult(){
  const retained=read(resultFile);assert.equal(retained.operation,OPERATION);assert.equal(retained.source_identity,sourceIdentity);
  assert.deepEqual(retained.source_files,sourceFiles);verifyPins(retained.artifacts);
  json(out("current-result.json"),{schema:"scc-ballot-current-result/v1",operation:OPERATION,source_identity:sourceIdentity,result:pin(resultFile)},true);
  progress.active=null;progress.state="COMPLETE";save();
  process.stdout.write(JSON.stringify({operation:OPERATION,state:"COMPLETE",output:config.output,source_identity:sourceIdentity,result:path.relative(config.output,resultFile)})+"\n");
 }
 if(fs.existsSync(resultFile)){selectResult();return;}
 let server=null,browser=null,context=null,operator=null,base="",projectId="scc-authored-operator-v1",serverLog=null,primaryError=null,pendingResult=null;
 // Open exact retained recipient files over allowed loopback HTTP. Chromium's
 // managed file-URL restriction remains unchanged; only this operation's files
 // are served, under an unguessable route and strict real-path containment.
 const attachmentToken=randomUUID();let attachmentBase="";
 const attachmentServer=http.createServer((req,res)=>{
  try{
   assert.ok(req.method==="GET"||req.method==="HEAD");
   const selected=new URL(req.url,"http://127.0.0.1");
   assert.ok(selected.pathname.startsWith("/"+attachmentToken+"/"));
   const relative=decodeURIComponent(selected.pathname.slice(attachmentToken.length+2));
   assert.ok(relative&&!relative.includes("\\")&&!relative.split("/").some(p=>p===".."||p==="."));
   const file=fs.realpathSync(path.join(config.output,relative));
   assert.ok(file.startsWith(config.output+path.sep)&&fs.statSync(file).isFile());
   const raw=fs.readFileSync(file),types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".txt":"text/plain; charset=utf-8",".csv":"text/csv",".pdf":"application/pdf"};
   res.writeHead(200,{"Content-Type":types[path.extname(file)]||"application/octet-stream","Content-Length":raw.length,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
   res.end(req.method==="HEAD"?undefined:raw);
  }catch{res.writeHead(404);res.end("Not found");}
 });

 function attachmentURL(file){const resolved=fs.realpathSync(file);assert.ok(resolved.startsWith(config.output+path.sep));return attachmentBase+path.relative(config.output,resolved).split(path.sep).map(encodeURIComponent).join("/");}

 const pageErrors=[],views=fs.existsSync(viewsFile)?read(viewsFile).views:[];
 async function boundedClose(action,label,ms=10000){
  let timer;try{return await Promise.race([Promise.resolve().then(action),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+" close timed out")),ms);})]);}finally{clearTimeout(timer);}
 }
 async function closeRecipient(selected,primary=null){
  if(!selected)return;
  try{await boundedClose(()=>selected.close(),"recipient context");}
  catch(error){if(!primary)throw error;(primary.recipient_cleanup_errors??=[]).push(String(error));}
 }
 const endpoint=()=>base+"/api/projects/"+encodeURIComponent(projectId);
 async function api(url,options={}){
  const response=await fetch(url.startsWith("http")?url:base+url,{...options,headers:{"Content-Type":"application/json",...options.headers}});
  if(!response.ok){const e=Error("HTTP "+response.status+" "+url+": "+await response.text());e.status=response.status;throw e;}
  return response.headers.get("content-type")?.includes("application/json")?response.json():Buffer.from(await response.arrayBuffer());
 }
 const project=()=>api(endpoint()),record=(collection,id)=>api(endpoint()+"/records/"+collection+"/"+encodeURIComponent(id));
 async function start(workspace){
  assert.equal(server,null);
  server=spawn(config.python,["-B",path.join(config.source,"server.py"),"--workspace",workspace,"--port","0"],{stdio:["ignore","pipe","pipe"],env:{...process.env,PYTHONDONTWRITEBYTECODE:"1"}});
  const child=server;
  await new Promise((resolve,reject)=>{
   let text="",timer=setTimeout(()=>reject(Error("The selected application did not announce its bound local address.")),30000);
   child.once("error",e=>{clearTimeout(timer);reject(e);});
   child.once("exit",code=>{clearTimeout(timer);reject(Error("The selected application exited before serving: "+code));});
   child.stderr.on("data",b=>{if(serverLog!==null)fs.writeSync(serverLog,b);});
   child.stdout.on("data",b=>{if(serverLog!==null)fs.writeSync(serverLog,b);text+=b.toString();const m=text.match(/Standards drafting workspace: (http:\/\/127\.0\.0\.1:\d+)/);if(m){base=m[1];clearTimeout(timer);resolve();}});
  });await api("/api/status");
 }
 async function stop(){
  if(!server)return;const child=server;
  const ended=()=>child.exitCode!==null||child.signalCode!==null;
  async function waitExit(ms){
   if(ended())return true;
   return new Promise(resolve=>{let timer;const done=()=>{clearTimeout(timer);child.removeListener("exit",onExit);resolve(ended());},onExit=()=>done();child.once("exit",onExit);timer=setTimeout(done,ms);if(ended())done();});
  }
  for(const signal of ["SIGINT","SIGTERM","SIGKILL"]){
   if(ended())break;child.kill(signal);if(await waitExit(5000))break;
  }
  if(!ended())throw Error("Native server did not exit after bounded SIGINT/SIGTERM/SIGKILL: PID "+child.pid);
  server=null;
 }
 const sourceDocumentWarnings=[];
 const archivedDependencyHashes=new Set(["e123655d3cf1ceea9de96c406de58a99c0b8983d57252d75fb8124701e523351","9c5763f5e7fc70dd557fdb438e4ef6fd1e877ddc8abb368b2a89ee9fde2bdad3"]);
 function attach(page){page.setDefaultTimeout(30000);page.on("pageerror",e=>{
  if(page.url().startsWith(attachmentBase)&&e.message==="$ is not defined"){
   const relative=decodeURIComponent(new URL(page.url()).pathname.slice(attachmentToken.length+2)),file=out(relative);
   if(relative.includes("/originals/")&&fs.existsSync(file)&&archivedDependencyHashes.has(sha(fs.readFileSync(file)))){sourceDocumentWarnings.push({path:relative,sha256:sha(fs.readFileSync(file)),message:String(e),stack:e.stack,classification:"Unmodified original Statistics Canada HTML requires an unavailable original jQuery dependency; retained source bytes and rendered document remain available."});return;}
  }
  pageErrors.push(String(e));
 });page.on("dialog",d=>d.accept());return page;}
 async function operatorOpen(){
  if(context)await closeRecipient(context);
  context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  operator=attach(await context.newPage());await desk();
 }
 async function selectRendered(page,selector,value){
  const previous=await page.locator(selector).elementHandle();assert.ok(previous);
  try{await page.locator(selector).selectOption(value);await page.waitForFunction(node=>!node.isConnected,previous);assert.equal(await page.locator(selector).inputValue(),value);}
  finally{await previous.dispose();}
 }
 async function desk(member){
  await operator.goto(base);await operator.locator("#project-picker").selectOption(projectId);
  await operator.locator('[data-section="ballot-exchange"]').click();
  await operator.locator("#ballot-exchange").waitFor();
  if(member)await selectRendered(operator,"#member-select",member);
  await operator.locator("#ballot-message").waitFor({state:"attached"});
 }
 async function capture(page,name,width=1440,height=1000){
  await page.setViewportSize({width,height});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const raw=await page.screenshot({fullPage:true}),file=path.join(editionRoot,"views",name+"-"+sha(raw)+".png");write(file,raw);
  const measured=await page.evaluate(()=>({viewport:innerWidth,document_width:document.documentElement.scrollWidth,title:document.title,text:document.body.innerText}));
  const row={name,width,height,...measured,...pin(file)},prior=views.findIndex(v=>v.name===name&&v.width===width&&v.height===height);
  if(prior<0)views.push(row);else views[prior]=row;
  json(viewsFile,{source_identity:sourceIdentity,views},true);
  assert.ok(measured.document_width<=width+1,"Actual "+name+" overflows its selected viewport.");
  return row;
 }
 async function download(page,control,file){
  if(fs.existsSync(file))return pin(file);
  const event=page.waitForEvent("download");await control.click();const d=await event,tmp=file+"."+randomUUID()+".download";
  fs.mkdirSync(path.dirname(file),{recursive:true});await d.saveAs(tmp);
  try{write(file,fs.readFileSync(tmp));}finally{fs.rmSync(tmp,{force:true});}
  assert.ok(fs.statSync(file).size);return pin(file);
 }
 function unpack(file,directory){
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  execFileSync(config.python,["-B","-c",
   "from pathlib import Path,PurePosixPath\nimport zipfile,sys,json,hashlib,os,tempfile\nroot=Path(sys.argv[2])\nwith zipfile.ZipFile(sys.argv[1]) as z:\n rows=z.infolist()\n if len(rows)>8192 or len({r.filename for r in rows})!=len(rows) or sum(r.file_size for r in rows)>384*1024*1024:raise ValueError('Complete archive capacity or duplicate member')\n data={}\n for r in rows:\n  p=PurePosixPath(r.filename)\n  if r.is_dir() or p.is_absolute() or '..' in p.parts or '\\\\' in r.filename or str(p)!=r.filename:raise ValueError('Unsafe archive member')\n  data[r.filename]=z.read(r)\n manifest=json.loads(data['manifest.json'])\n if set(manifest['files'])!=set(data)-{'manifest.json'}:raise ValueError('Incomplete archive manifest')\n for name,meta in manifest['files'].items():\n  raw=data[name]\n  if len(raw)!=meta['bytes'] or hashlib.sha256(raw).hexdigest()!=meta['sha256']:raise ValueError('Original member differs')\n for name,raw in data.items():\n  target=root/name;target.parent.mkdir(parents=True,exist_ok=True)\n  if target.exists():\n   if target.read_bytes()!=raw:raise ValueError('Retained extracted member differs')\n  else:\n   fd,tmp=tempfile.mkstemp(prefix='.receive-',dir=target.parent)\n   try:\n    with os.fdopen(fd,'wb') as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())\n    os.link(tmp,target)\n   finally:os.unlink(tmp)\n",file,directory],{stdio:["ignore","pipe","pipe"]});
  return read(path.join(directory,"manifest.json"));
 }
 async function mutation(name,operation,payload){
  const file=out("requests/"+name+".json");
  let request;if(fs.existsSync(file)){request=read(file);assert.equal(request.operation,operation);assert.deepEqual(request.payload,payload);}
  else{request={operation,payload,expected_revision:(await project()).revision,request_id:"ballot-course-"+sha(OPERATION+":"+name),actor:"Authored ballot operating example"};json(file,request);}
  const result=await api(endpoint()+"/operations",{method:"POST",body:JSON.stringify(request)});
  const identity={...result};delete identity.replayed;json(out("requests/"+name+".result.json"),identity);return identity;
 }
 async function uiOperation(name,operation,trigger,withhold=false){
  const file=out("requests/"+name+".json"),resultFile=out("requests/"+name+".result.json");
  if(fs.existsSync(file)){
   const request=read(file);assert.equal(request.operation,operation);
   const result=await api(endpoint()+"/operations",{method:"POST",body:JSON.stringify(request)}),identity={...result};delete identity.replayed;
   json(resultFile,identity);return identity;
  }
  const url=endpoint()+"/operations";let first=true,resolveResult,rejectResult;
  const completed=new Promise((r,j)=>{resolveResult=r;rejectResult=j;});completed.catch(()=>{});
  await operator.route(url,async route=>{
   try{
    const request=route.request().postDataJSON();if(request.operation!==operation){await route.continue();return;}
    json(file,request);
    const response=await route.fetch(),value=await response.json();
    if(!response.ok()){await route.fulfill({response});rejectResult(Error(JSON.stringify(value)));return;}
    const identity={...value};delete identity.replayed;json(resultFile,identity);
    if(withhold&&first){first=false;await route.fulfill({status:502,contentType:"application/json",body:JSON.stringify({error:"Original response interrupted after native commit; recover its retained request."})});return;}
    await route.fulfill({response});resolveResult(identity);
   }catch(e){rejectResult(e);await route.abort().catch(()=>{});}
  });
  const page=operator,child=server,timeout=config.operation_timeout_ms??120000;
  assert.ok(Number.isSafeInteger(timeout)&&timeout>=1000,"Use a positive native operation timeout in milliseconds.");
  let timer,monitor,checking=false,rejectStopped;
  const stopped=new Promise((_resolve,reject)=>{rejectStopped=reject;});
  const abort=message=>rejectStopped(Error(message+" Original request/result files remain in "+out("requests")+"."));
  const pageClosed=()=>abort("The original operator page closed before its operation returned."),
    pageCrashed=()=>abort("The original operator page crashed."),
    pageFailed=error=>abort("The original operator raised "+String(error)),
    serverEnded=code=>abort("The original native server exited during the operation: "+code);
  page.once("close",pageClosed);page.once("crash",pageCrashed);page.once("pageerror",pageFailed);child.once("exit",serverEnded);
  timer=setTimeout(()=>abort("Native operation "+name+" did not complete within "+timeout+" ms."),timeout);
  monitor=setInterval(async()=>{
   if(checking||page.isClosed())return;checking=true;
   try{
    const messages=await page.locator("#ballot-message.ballot-error,#editor-error").evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length).map(n=>n.textContent.trim()).filter(Boolean));
    const failure=messages.find(message=>!(withhold&&!first&&message.includes("Original response interrupted after native commit")));
    if(failure)abort("The original operator could not dispatch/recover "+name+": "+failure);
   }catch(error){if(page.isClosed())abort("The original operator closed while its request was pending.");}
   finally{checking=false;}
  },250);
  try{
   return await Promise.race([stopped,(async()=>{
    await trigger();
    if(withhold){
     await page.locator("#ballot-retry").waitFor();
     await capture(page,name+"-retained-request");
     await page.reload();await page.locator('[data-section="ballot-exchange"]').click();
     await page.locator("#ballot-retry").waitFor();await page.locator("#ballot-retry").click();
    }
    const result=await completed;await page.locator("#ballot-retry").waitFor({state:"detached"});return result;
   })()]);
  }finally{
   clearTimeout(timer);clearInterval(monitor);
   page.removeListener("close",pageClosed);page.removeListener("crash",pageCrashed);page.removeListener("pageerror",pageFailed);child.removeListener("exit",serverEnded);
   await page.unroute(url);
  }
 }
 async function formFields(form,values){
  for(const [name,value]of Object.entries(values)){if(Array.isArray(value)&&await form.locator('[data-list-field="'+name+'"]').count()){const choices=form.locator('[data-list-field="'+name+'"] input[type="checkbox"]');for(let i=0;i<await choices.count();i++)await choices.nth(i).setChecked(value.includes(await choices.nth(i).getAttribute("value")));continue;}const input=form.locator('[name="'+name+'"],[data-field="'+name+'"]').first();
   const tag=await input.evaluate(e=>({tag:e.tagName,type:e.type}));
   if(tag.type==="checkbox")await input.setChecked(value);else if(tag.tag==="SELECT")await input.selectOption(value);else await input.fill(Array.isArray(value)?value.join("\n"):tag.type==="datetime-local"?String(value).replace(/T(\d{2}:\d{2}):00$/,"T$1"):String(value));
  }
 }

 async function archive(audience,file,extra=""){
  if(!fs.existsSync(file))write(file,await api(endpoint()+"/export?audience="+audience+extra));
  return pin(file);
 }
 async function retain(member,packetId,file,name){
  if(fs.existsSync(out("requests/"+name+".json"))){const result=await uiOperation(name,"ballot.receive",async()=>{});const kept=await record("ballot_returns",result.return_id);assert.equal(kept.source_sha256,sha(fs.readFileSync(file)));assert.deepEqual(kept.response,read(file));return result.return_id;}
  await desk(member);await selectRendered(operator,"#packet-select",packetId);
  await operator.locator("#ballot-return-file").setInputFiles(file);
  await operator.locator(".ballot-file").waitFor();await operator.locator("#preview-return").click();
  await operator.locator("#retain-return").waitFor();await operator.locator("#retain-return").isEnabled();
  await operator.locator('#ballot-intake-form [name="receipt_note"]').fill("Authored operating example: retain the complete original downloaded return and its exact predecessor.");
  const result=await uiOperation(name,"ballot.receive",()=>operator.locator("#retain-return").click());
  const kept=await record("ballot_returns",result.return_id);
  assert.equal(kept.source_sha256,sha(fs.readFileSync(file)));assert.deepEqual(kept.response,read(file));
  const source=await record("sources",kept.source_id),raw=await api(endpoint()+"/files/"+source.source_file_id);
  assert.deepEqual(raw,fs.readFileSync(file));return result.return_id;
 }
 async function adopt(member,returnId,name){
  if(fs.existsSync(out("requests/"+name+".json"))){await uiOperation(name,"ballot.adopt",async()=>{});const rows=await api(endpoint()+"/ballot-exchange/status"),m=rows.ballots.find(x=>x.ballot.id===ballotId).members.find(x=>x.member.person_id===member);return m.adoptions.find(a=>a.return_id===returnId).vote_id;}
  await desk(member);await selectRendered(operator,"#return-select",returnId);
  await operator.locator('#ballot-adopt-form [name="verification_note"]').fill("Authored exercise: the selected member page produced this exact return in the same operating course. Original response identity, current correction and full content were compared.");
  const result=await uiOperation(name,"ballot.adopt",()=>operator.locator("#ballot-adopt").click());
  const rows=await api(endpoint()+"/ballot-exchange/status"),m=rows.ballots.find(x=>x.ballot.id===ballotId).members.find(x=>x.member.person_id===member);
  assert.ok(m.adoptions.some(a=>a.return_id===returnId));return m.current_vote.id;
 }
 const editionId="ballot-course-edition-v1",consultationId="ballot-course-consultation-v1",ballotId="ballot-course-pas-v1";
 let baseline;
 try{
  serverLog=fs.openSync(out("server.log"),"a");
  await new Promise((resolve,reject)=>{attachmentServer.once("error",reject);attachmentServer.listen(0,"127.0.0.1",resolve);});
  attachmentBase="http://127.0.0.1:"+attachmentServer.address().port+"/"+attachmentToken+"/";
  await start(config.workspace);
  const mod=await import(pathToFileURL(config.playwright).href),playwright=mod.chromium?mod:mod.default;
  assert.ok(playwright?.chromium,"Use the installed Playwright module");
  browser=await playwright.chromium.launch({headless:true,executablePath:config.chromium,args:["--no-sandbox","--disable-dev-shm-usage"]});
  await stage("original_authored_case",async()=>{
   const seeded=await api("/api/demo",{method:"POST",body:JSON.stringify({kind:"authored"})});assert.equal(seeded.id,projectId);
   const file=out("original-authored-project.private.zip");await archive("private_restore",file);unpack(file,out("original"));
   const state=read(out("original/project.json"));assert.equal(state.mode,"authored_example");assert.equal(state.clauses.length,10);assert.equal(state.cases.length,8);assert.equal(state.votes.length,0);
   return{project_id:projectId,revision:state.revision,source_files:state.files.length,archive:pin(file)};
  });
  baseline=read(out("original/project.json"));
  await operatorOpen();
  await stage("original_empty_ballot_desk",async()=>{assert.equal((await api(endpoint()+"/ballot-exchange/status")).ballots.length,0);await capture(operator,"operator-empty");return{visible:true};});
  await stage("actual_loading_desk",async()=>{
   const url=endpoint()+"/ballot-exchange/status";let release;const gate=new Promise(r=>{release=r;});
   await operator.route(url,async route=>{await gate;await route.continue();});
   const opening=desk();
   try{await operator.getByText("Opening the complete ballot and retained requests…",{exact:true}).waitFor();await capture(operator,"operator-loading");release();await opening;}
   finally{release();await operator.unroute(url);}
   return{view:"operator-loading"};
  });
  await stage("frozen_edition_procedure_and_roster",async()=>{
   await mutation("freeze-edition","edition.freeze",{id:editionId,label:"Authored bilingual member ballot operating edition",contributor_ids:[],notes:"Original municipal source clauses and cases; explicit authored operating exercise."});
   await mutation("consultation","record.save",{collection:"consultations",record:{id:consultationId,title:"Authored steering consultation for member exchange",edition_id:editionId,procedure_id:"scc-pas-2021-flexible",kind:"steering",opens:"2027-01-15",closes:"2027-02-11",participant_ids:baseline.people.filter(p=>p.id.startsWith("example-member-")).map(p=>p.id),actual_closed:true,source_ids:["example-consultation-record"]}});
   await mutation("open-ballot","ballot.open",{id:ballotId,title:"Authored member ballot — source-preserving municipal handover",edition_id:editionId,procedure_id:"scc-pas-2021-flexible",opens:"2027-02-12",closes:"2027-03-01",method:"letter_ballot",membership_ids:baseline.memberships.map(m=>m.id),consultation_ids:[consultationId],sponsor_endorsement_source_ids:["example-consultation-record"],notes:"Authored operating exercise. All votes, verification, notifications and authority below are explicitly entered example records."});
   const ballot=await record("ballots",ballotId);assert.equal(ballot.roster.filter(r=>r.voting).length,7);
   assert.deepEqual((await record("editions",editionId)).snapshot.clauses,baseline.clauses);
   return{ballot_id:ballotId,edition_id:editionId,roster:ballot.roster.map(r=>r.person_id),profile:ballot.profile};
  });
  const ballot=await record("ballots",ballotId),members=ballot.roster.filter(r=>r.voting);
  const primary=members[0].person_id,choices=["no","yes","yes","yes","yes","abstain","blank"];
  const packetIds={},voteIds={};
  for(let index=0;index<members.length;index++){
   const member=members[index],id=member.person_id,name="member-"+(index+1);
   packetIds[id]=await stage(name+"_packet",async()=>{
    if(fs.existsSync(out("requests/"+name+"-packet.json")))return(await uiOperation(name+"-packet","ballot.packet",async()=>{})).packet_id;
    await desk(id);
    await formFields(operator.locator("#ballot-packet-form"),{title:"Authored ballot packet — "+member.person_name,instructions_en:"Read the frozen municipal clauses and original worked cases. This complete member response is an authored operating example.",instructions_fr:"Lire les clauses municipales figées et les cas originaux. Cette réponse complète constitue un exemple de fonctionnement rédigé.",reply_route_en:"Save the complete JSON and receive it in this same local ballot course.",reply_route_fr:"Enregistrer le JSON complet et le recevoir dans ce même parcours local."});
    const result=await uiOperation(name+"-packet","ballot.packet",()=>operator.locator("#prepare-member-packet").click(),index===0);
    const packet=await record("ballot_packets",result.packet_id);assert.equal(packet.person_id,id);return result.packet_id;
   });
   const packetId=packetIds[id],zip=out(name+"/Member_Ballot.zip"),recipientRoot=out(name+"/recipient"),first=out(name+"/Member_Return_r1.json");
   await stage(name+"_offline_member",async()=>{
    await desk(id);await selectRendered(operator,"#packet-select",packetId);
    await download(operator,operator.locator("#download-member-packet"),zip);unpack(zip,recipientRoot);
    const envelope=read(path.join(recipientRoot,"packet.json")),packet=await record("ballot_packets",packetId);
    assert.equal(envelope.packet_sha256,packet.packet_sha256);assert.equal(envelope.packet.member.person_id,id);
    assert.equal(envelope.packet.edition.snapshot.cases.length,baseline.cases.length);
    let recipientContext=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
    let page,recipientError=null;
    try{
     page=attach(await recipientContext.newPage());
     await page.goto(attachmentURL(path.join(recipientRoot,"member-ballot.html")));
     await page.locator('#tabs [data-tab="document"]').click();assert.ok((await page.locator("#read-body").innerText()).includes("Amos"));
     await page.locator('#tabs [data-tab="vote"]').click();
     const explanation=index===0?"Authored negative: retain the original Census reference date separately from the municipal change effective date. Literal <source> & \"quoted\" wording remains unchanged.":index===5?"Authored justified abstention: this example member records no technical position.":index===6?"":"Authored agreement with the exact frozen bilingual edition and source-bound cases.";
     await formFields(page.locator("#vote-form"),{declared_name:member.person_name,choice:choices[index],justification:explanation,cast_at:"2027-02-12T12:00:00"});
     const draft=out(name+"/Member_Draft.json");await download(page,page.locator('[data-do="draft"]'),draft);
     assert.equal(read(draft).response.justification,explanation);
     await closeRecipient(recipientContext);
     recipientContext=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
     page=attach(await recipientContext.newPage());await page.goto(attachmentURL(path.join(recipientRoot,"member-ballot.html")));
     await page.locator("#open-file").setInputFiles(draft);await page.locator("#notice").filter({hasText:"Complete saved input opened"}).waitFor();
     assert.ok((await page.locator("#content").innerText()).includes(member.person_name));
     await page.locator("#confirmed").check();await download(page,page.locator('[data-do="export"]'),first);
     await page.locator("#open-file").setInputFiles(first);await page.locator("#notice").filter({hasText:"Complete saved input opened"}).waitFor();
     const returned=read(first);assert.equal(returned.person_id,id);assert.equal(returned.choice,choices[index]);assert.equal(returned.response_revision,1);assert.equal(returned.justification,explanation);
     const copy=out(name+"/Member_Readable_r1.html");await download(page,page.locator('[data-do="copy"]'),copy);
     await capture(page,name+"-return-desktop");
     if(index===0){
      await capture(page,name+"-return-narrow",390,844);
      await page.locator("#language").selectOption("fr");await page.locator('#tabs [data-tab="document"]').click();await capture(page,"member-french-document",390,844);
      await page.locator("#language").selectOption("en");
      const invalid={...returned,packet_id:"another-packet"};await page.locator("#open-file").setInputFiles({name:"Wrong_Packet.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(invalid))});await page.locator("#notice.error").waitFor();await capture(page,"member-wrong-packet-error",390,844);
      await page.locator("#open-file").setInputFiles(first);await page.locator("#notice").filter({hasText:"Complete saved input opened"}).waitFor();
      await page.locator('#tabs [data-tab="vote"]').click();assert.ok(await page.locator("#vote-form [name=\"choice\"]").isDisabled());assert.ok(await page.locator("#vote-form fieldset").evaluate(element=>element.disabled));
     }
     await page.goto(attachmentURL(copy));assert.ok((await page.locator("body").innerText()).includes(explanation||member.person_name));await capture(page,name+"-readable-copy",index===0?390:1440,index===0?844:1000);
     return{packet_id:packetId,packet:pin(zip),draft:pin(draft),returned:pin(first),readable:pin(copy),response_id:returned.response_id};
    }catch(error){recipientError=error;throw error;}finally{await closeRecipient(recipientContext,recipientError);}
   });
   const returnedId=await stage(name+"_receive",()=>retain(id,packetId,first,name+"-receive"));
   voteIds[id]=await stage(name+"_adopt",()=>adopt(id,returnedId,name+"-adopt"));
   assert.equal((await record("votes",voteIds[id])).person_id,id);
  }

  const originalVote=voteIds[primary],originalReturn=out("member-1/Member_Return_r1.json"),correction=out("member-1/Member_Return_r2.json");
  await stage("original_negative_review",async()=>{
   const kept=out("requests/initial-negative-resolution.json"),payload=fs.existsSync(kept)?read(kept).payload:{collection:"votes",record:{...await record("votes",originalVote),negative_resolution:"Authored initial review: retain the two distinct source dates.",notification_at:"2027-02-13T10:00:00Z",notification_evidence:"Authored operating example: notification recorded for first returned edition."}};
   await mutation("initial-negative-resolution","record.save",payload);
   json(out("member-1/Adopted_Original_Vote.json"),await record("votes",originalVote));return{vote_id:originalVote};
  });
  await stage("offline_explicit_correction",async()=>{
   const recipientContext=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});let recipientError=null;
   try{
    const page=attach(await recipientContext.newPage());
    await page.goto(attachmentURL(out("member-1/recipient/member-ballot.html")));
    await page.locator("#open-file").setInputFiles(originalReturn);await page.locator("#notice").filter({hasText:"Complete saved input opened"}).waitFor();
    await page.locator('[data-do="correct"]').click();await page.locator("#vote-form").waitFor();
    const first=read(originalReturn),justification=first.justification+"\n\nAuthored correction: affected Census population must also remain distinct from a new annual population estimate.";
    await formFields(page.locator("#vote-form"),{justification,cast_at:"2027-02-14T11:30:00"});
    const draft=out("member-1/Corrected_Draft.json");await download(page,page.locator('[data-do="draft"]'),draft);
    await page.reload();await page.locator("#open-file").setInputFiles(draft);await page.locator("#notice").filter({hasText:"Complete saved input opened"}).waitFor();
    await page.locator("#confirmed").check();await download(page,page.locator('[data-do="export"]'),correction);
    await page.locator("#open-file").setInputFiles(correction);await page.locator("#notice").filter({hasText:"Complete saved input opened"}).waitFor();
    const second=read(correction);assert.equal(second.response_id,first.response_id);assert.equal(second.response_revision,2);assert.equal(second.previous_response_sha256,sha(canonical(first)));assert.equal(second.justification,justification);
    const copy=out("member-1/Member_Readable_r2.html");await download(page,page.locator('[data-do="copy"]'),copy);
    await capture(page,"member-correction",390,844);await page.goto(attachmentURL(copy));assert.ok((await page.locator("body").innerText()).includes(justification));await capture(page,"member-correction-readable",390,844);
    return{returned:pin(correction),draft:pin(draft),readable:pin(copy),response_id:second.response_id};
   }catch(error){recipientError=error;throw error;}finally{await closeRecipient(recipientContext,recipientError);}
  });
  const correctedId=await stage("retain_corrected_original",()=>retain(primary,packetIds[primary],correction,"primary-correction-receive"));
  await stage("correction_preserves_vote_and_reopens_resolution",async()=>{
   const id=await adopt(primary,correctedId,"primary-correction-adopt");assert.equal(id,originalVote);
   const vote=await record("votes",id),first=read(out("member-1/Adopted_Original_Vote.json"));
   assert.equal(vote.id,first.id);assert.equal(vote.revision,first.revision+1);assert.equal(vote.negative_resolution,"");assert.equal(vote.notification_at,"");assert.equal(vote.notification_evidence,"");
   assert.equal(vote.justification,read(correction).justification);
   const state=await api(endpoint()+"/ballot-exchange/status"),m=state.ballots.find(r=>r.ballot.id===ballotId).members.find(r=>r.member.person_id===primary);
   assert.equal(m.returns.length,2);assert.equal(m.adoptions.length,2);assert.equal(m.returns.find(r=>r.id===correctedId).supersedes_id,m.returns.find(r=>r.id!==correctedId).id);
   json(out("member-1/Adopted_Corrected_Vote.json"),vote);return{vote_id:id,adoptions:m.adoptions.map(a=>a.id)};
  });
  await stage("exact_duplicate_preserves_vote",async()=>{
   const before=await api(endpoint()+"/ballot-exchange/status"),id=await retain(primary,packetIds[primary],correction,"primary-exact-duplicate");
   const after=await api(endpoint()+"/ballot-exchange/status"),m=s=>s.ballots.find(x=>x.ballot.id===ballotId).members.find(x=>x.member.person_id===primary);
   assert.equal(id,correctedId);assert.deepEqual(m(after),m(before));return{return_id:id};
  });
  await stage("review_corrected_negative_in_original_editor",async()=>{
   if(fs.existsSync(out("requests/corrected-negative-resolution.json"))){await uiOperation("corrected-negative-resolution","record.save",async()=>{});return{vote_id:originalVote,revision:(await record("votes",originalVote)).revision};}
   await desk(primary);await operator.locator('[data-ballot="decisions"]').click();await operator.locator('button[data-collection="votes"]:not([data-action])').click();
   await operator.locator('[data-action="edit"][data-collection="votes"][data-id="'+originalVote+'"]').click();await operator.locator("#editor").waitFor();
   await formFields(operator.locator("#editor"),{negative_resolution:"Authored corrected review: the frozen clauses and original case records retain reference date, municipal change date and affected Census counts independently; the received clarification was reviewed without relabelling any original quantity.",notification_at:"2027-02-15T10:00:00Z",notification_evidence:"Authored exercise notification for complete member return revision 2, retained within this operating case."});
   await uiOperation("corrected-negative-resolution","record.save",()=>operator.locator("#editor-save").click());await operator.locator("#editor").waitFor({state:"hidden"});
   const vote=await record("votes",originalVote);assert.equal(vote.id,originalVote);assert.ok(vote.negative_resolution.includes("corrected review"));return{vote_id:originalVote,revision:vote.revision};
  });
  const closureId=await stage("original_authority_closure",async()=>{
   if(fs.existsSync(out("requests/authority-closure.json")))return(await uiOperation("authority-closure","ballot.close",async()=>{})).record_ids[0];
   await desk(primary);await capture(operator,"operator-complete-votes");
   const status=await api(endpoint()+"/ballot-exchange/status"),row=status.ballots.find(r=>r.ballot.id===ballotId);
   assert.equal(row.members.filter(r=>r.current_vote).length,7);assert.deepEqual(row.calculation.raw,{yes:4,no:1,abstain:1,blank:1});
   json(out("calculation-before-authority.json"),row.calculation);
   await operator.locator('[data-ballot="close"]').click();await operator.locator("#editor").waitFor();
   await formFields(operator.locator("#editor"),{authority:"Authored developer authority — operating exercise",recorded_decision:"adopted",rationale:"Authored operating decision after all seven member declarations, corrected negative review and original selected PAS calculation. This entry exercises the original separate authority record.",source_ids:["example-consultation-record"]});
   const result=await uiOperation("authority-closure","ballot.close",()=>operator.locator("#editor-save").click());await operator.locator("#editor").waitFor({state:"hidden"});
   const id=result.record_ids[0],closure=await record("ballot_closures",id);assert.deepEqual(closure.calculation,row.calculation);assert.equal(closure.input_snapshot.votes.length,7);
   return id;
  });
  const reviewId=await stage("original_independent_procedural_review",async()=>{
   if(fs.existsSync(out("requests/procedural-review.json")))return(await uiOperation("procedural-review","procedure.review",async()=>{})).record_ids[0];
   await desk(primary);await operator.locator('[data-ballot="procedure"]').click();await operator.locator("#editor").waitFor();
   await formFields(operator.locator("#editor"),{closure_id:closureId,reviewer_id:"example-independent-reviewer",independence_declared:true,appointment_source_ids:["example-appointment"],decision:"confirmed",rationale:"Authored procedural exercise: independently review this exact closed input, original procedure, frozen membership, complete return/correction history and separate developer authority.",source_ids:["example-consultation-record"]});
   const result=await uiOperation("procedural-review","procedure.review",()=>operator.locator("#editor-save").click());await operator.locator("#editor").waitFor({state:"hidden"});
   const id=result.record_ids[0],review=await record("procedural_reviews",id);assert.equal(review.reviewed_input_sha256,(await record("ballot_closures",closureId)).input_sha256);return id;
  });
  const publicationId=await stage("original_publication_record",async()=>{
   if(fs.existsSync(out("requests/publication.json")))return(await uiOperation("publication","record.save",async()=>{})).record_ids[0];
   await desk(primary);await operator.locator('[data-ballot="publication"]').click();
   await operator.locator('[data-action="new-record"][data-collection="publications"]').click();await operator.locator("#editor").waitFor();
   await formFields(operator.locator("#editor"),{edition_id:editionId,closure_id:closureId,procedural_review_id:reviewId,version:"Authored ballot receiving edition 1",status:"prepared",issued:"2027-03-02",authority:"Authored developer publication handover",authority_source_ids:["example-consultation-record"],access:"planned",license_notice:"Original public-source notices and authored example attribution retained.",notes:"Prepared publication in a separate authored operating case, with original member and authority records retained in its private continuation."});
   const result=await uiOperation("publication","record.save",()=>operator.locator("#editor-save").click());await operator.locator("#editor").waitFor({state:"hidden"});return result.record_ids[0];
  });
  await stage("closed_ballot_preserves_original_votes",async()=>{
   await desk(primary);const before=await record("votes",originalVote),closure=await record("ballot_closures",closureId);
   assert.ok(await operator.locator("#ballot-adopt").isDisabled());assert.ok(await operator.locator('[data-ballot="close"]').isDisabled());
   assert.equal(closure.input_snapshot.votes.find(r=>r.id===originalVote).justification,read(correction).justification);
   await capture(operator,"operator-closed-desktop");await capture(operator,"operator-closed-narrow",390,844);
   assert.deepEqual(await record("votes",originalVote),before);return{vote_id:originalVote,closure_id:closureId};
  });
  await stage("complete_decision_publication_and_private_downloads",async()=>{
   await desk(primary);
   await download(operator,operator.locator("#download-ballot-decision"),out("Ballot_Decision.private.zip"));
   await download(operator,operator.locator("#download-ballot-workspace"),out("Ballot_Complete_Project.private.zip"));
   unpack(out("Ballot_Decision.private.zip"),out("decision"));unpack(out("Ballot_Complete_Project.private.zip"),out("producer"));
   await archive("edition",out("Bilingual_Publication.zip"),"&edition_id="+encodeURIComponent(editionId)+"&publication_id="+encodeURIComponent(publicationId));
   unpack(out("Bilingual_Publication.zip"),out("publication"));
   const dossier=read(out("decision/decision.json")),full=read(out("producer/project.json")),history=read(out("producer/history.json")),originalHistory=read(out("original/history.json"));
   assert.equal(dossier.member_packets.length,7);assert.equal(dossier.member_returns.length,8);assert.equal(dossier.vote_adoptions.length,8);assert.equal(dossier.authority_closures[0].id,closureId);
   assert.deepEqual(history.slice(0,originalHistory.length),originalHistory);
   for(const collection of ["scope","procedures","people","memberships","clauses","cases","references","funding","costs","tasks"]){assert.deepEqual(full[collection],baseline[collection],"Original "+collection+" changed");}
   for(const meta of baseline.files){const current=full.files.find(x=>x.id===meta.id);assert.deepEqual(current,meta);const a=fs.readFileSync(out("original/originals/"+meta.id+"/"+meta.filename)),b=fs.readFileSync(out("producer/originals/"+meta.id+"/"+meta.filename));assert.deepEqual(a,b);}
   for(const returned of full.ballot_returns){const meta=full.files.find(f=>f.id===full.sources.find(s=>s.id===returned.source_id).source_file_id),raw=fs.readFileSync(out("producer/originals/"+meta.id+"/"+meta.filename));assert.equal(sha(raw),returned.source_sha256);assert.deepEqual(JSON.parse(raw),returned.response);}
   json(out("final-native-records.json"),{project_id:projectId,revision:full.revision,ballot_id:ballotId,closure_id:closureId,review_id:reviewId,publication_id:publicationId,original_source_files:baseline.files.length,original_member_vote_id:originalVote,returns:full.ballot_returns.length,adoptions:full.ballot_adoptions.length});
   return{private_archive:pin(out("Ballot_Complete_Project.private.zip")),decision:pin(out("Ballot_Decision.private.zip")),publication:pin(out("Bilingual_Publication.zip"))};
  });
  await stage("independent_private_restore_and_reopen",async()=>{
   await closeRecipient(context);context=null;operator=null;await stop();
   const restored=out("received-workspace");fs.mkdirSync(restored,{recursive:true,mode:0o700});
   const result=execFileSync(config.python,["-B",path.join(config.source,"server.py"),"--workspace",restored,"--restore",out("Ballot_Complete_Project.private.zip"),"--no-serve"],{encoding:"utf8"});
   if(!fs.existsSync(out("restore-result.txt")))write(out("restore-result.txt"),result);
   await start(restored);await operatorOpen();await selectRendered(operator,"#ballot-select",ballotId);await selectRendered(operator,"#member-select",primary);
   const rows=await api(endpoint()+"/ballot-exchange/status"),m=rows.ballots.find(r=>r.ballot.id===ballotId).members.find(r=>r.member.person_id===primary);
   assert.equal(m.current_vote.id,originalVote);assert.equal(m.returns.length,2);assert.equal(m.adoptions.length,2);
   await archive("private_restore",out("Received_Complete_Project.private.zip"));unpack(out("Received_Complete_Project.private.zip"),out("received"));
   for(const filename of ["project.json","history.json","requests.json","manifest.json"])assert.deepEqual(fs.readFileSync(out("producer/"+filename)),fs.readFileSync(out("received/"+filename)));
   const manifest=read(out("producer/manifest.json"));for(const filename of Object.keys(manifest.files))assert.deepEqual(fs.readFileSync(out("producer/"+filename)),fs.readFileSync(out("received/"+filename)));
   await capture(operator,"received-operator-desktop");await capture(operator,"received-operator-narrow",390,844);
   return{project_id:projectId,vote_id:originalVote,files:Object.keys(manifest.files).length,archive:pin(out("Received_Complete_Project.private.zip"))};
  });
  const presentation=out("presentation/"+sourceIdentity);
  await stage("current_presentation_exports_"+sourceIdentity,async()=>{
   const before=await project();
   await archive("edition",path.join(presentation,"Bilingual_Publication.zip"),"&edition_id="+encodeURIComponent(editionId)+"&publication_id="+encodeURIComponent(publicationId));unpack(path.join(presentation,"Bilingual_Publication.zip"),path.join(presentation,"publication"));
   await archive("ballot_decision",path.join(presentation,"Ballot_Decision.private.zip"),"&ballot_id="+encodeURIComponent(ballotId));unpack(path.join(presentation,"Ballot_Decision.private.zip"),path.join(presentation,"decision"));
   for(let i=0;i<members.length;i++){
    const packet=before.ballot_packets.find(p=>p.person_id===members[i].person_id&&p.ballot_id===ballotId);assert.ok(packet);
    const dir=path.join(presentation,"member-"+(i+1));await archive("ballot_member",path.join(dir,"Member_Ballot.zip"),"&packet_id="+encodeURIComponent(packet.id));unpack(path.join(dir,"Member_Ballot.zip"),path.join(dir,"recipient"));
    assert.deepEqual(fs.readFileSync(path.join(dir,"recipient/packet.json")),fs.readFileSync(out("member-"+(i+1)+"/recipient/packet.json")),"Presentation export changed the original packet binding");
   }
   assert.deepEqual(await project(),before,"Presentation export changed native records");
   json(path.join(presentation,"presentation-continuation.json"),{source_identity:sourceIdentity,project_id:projectId,revision:before.revision,publication_id:publicationId,ballot_id:ballotId,note:"Native read-only exports of the exact existing closed ballot, publication and seven packet identities. Earlier artifacts remain unchanged at original paths.",files:inventory(presentation).filter(row=>row.path!=="presentation-continuation.json")});
   return{directory:path.relative(config.output,presentation),revision:before.revision};
  });
  await stage("actual_outgoing_attachment_views_"+sourceIdentity,async()=>{
   if(fs.existsSync(attachmentsFile)){
    const retained=read(attachmentsFile);assert.equal(retained.source_identity,sourceIdentity);verifyPins(retained.retained_files);
    return{html:retained.html.length,pdfs:retained.pdfs.length,manifest:path.relative(config.output,attachmentsFile),views:path.relative(config.output,viewsFile)};
   }
   const recipientContext=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true}),opened=[];let recipientError=null;
   try{
    const page=attach(await recipientContext.newPage());
    const htmlFiles=inventory(config.output).filter(r=>r.path.endsWith(".html")&&!r.path.startsWith("received-workspace/")&&(!r.path.startsWith("presentation/")||r.path.startsWith("presentation/"+sourceIdentity+"/"))).filter(r=>!r.path.startsWith("publication/")&&!r.path.startsWith("decision/")&&!/^member-\d+\/recipient\//.test(r.path));
    for(const row of htmlFiles){
     const file=out(row.path);await page.goto(attachmentURL(file));
     const name="attachment-"+sha(row.path).slice(0,16);await capture(page,name,1440,1000);await capture(page,name+"-narrow",390,844);opened.push({path:row.path,sha256:row.sha256,view:name});
    }
    const pdfs=inventory(path.join(presentation,"publication")).filter(r=>r.path.endsWith(".pdf")),rendered=[];
    for(const row of pdfs){
     const file=path.join(presentation,"publication",row.path),pdfRoot=path.join(editionRoot,"pdf",sha(row.path+":"+row.sha256)),prefix=path.join(pdfRoot,"page");
     fs.mkdirSync(pdfRoot,{recursive:true,mode:0o700});
     execFileSync(config.pdftoppm||"pdftoppm",["-r","100","-png",file,prefix],{stdio:["ignore","pipe","pipe"]});
     const pages=fs.readdirSync(pdfRoot).filter(n=>n.startsWith("page-")&&n.endsWith(".png")).sort();
     assert.ok(pages.length);rendered.push({file:row.path,sha256:row.sha256,pages:pages.map(n=>pin(path.join(pdfRoot,n)))});
    }
    json(attachmentsFile,{source_identity:sourceIdentity,retained_files:[...inventory(presentation).map(row=>pin(path.join(presentation,row.path))),pin(viewsFile),...views.map(row=>({path:row.path,bytes:row.bytes,sha256:row.sha256})),...rendered.flatMap(row=>row.pages),...opened.map(row=>pin(out(row.path)))],presentation_directory:path.relative(config.output,presentation),html:opened,pdfs:rendered,source_document_warnings:sourceDocumentWarnings,full_publication_members:inventory(path.join(presentation,"publication")),full_decision_members:inventory(path.join(presentation,"decision")),member_packets:members.map((m,i)=>({member:m.person_id,files:inventory(path.join(presentation,"member-"+(i+1)+"/recipient"))})),operator_instruction:"Open and visually VIEW every actual captured screen and report page; open the exact DOCX/CSV/JSON/archive contents in their normal recipient view. Fix the affected output and continue this same case."});
    return{html:opened.length,pdfs:rendered.length,manifest:path.relative(config.output,attachmentsFile),views:path.relative(config.output,viewsFile)};
   }catch(error){recipientError=error;throw error;}finally{await closeRecipient(recipientContext,recipientError);}
  });
  assert.deepEqual(inventory(config.source),sourceFiles,"The selected complete source changed during the operating course.");assert.deepEqual(pageErrors,[]);
  pendingResult={schema:"scc-ballot-receiving-result/v1",operation:OPERATION,state:"COMPLETE",completed_at:new Date().toISOString(),project_id:projectId,source_identity:sourceIdentity,source_files:sourceFiles,steps:Object.keys(progress.steps),records:read(out("final-native-records.json")),rendered_outputs:path.relative(config.output,attachmentsFile),views:path.relative(config.output,viewsFile)};
 }catch(error){
  primaryError=error;
  if(operator&&!operator.isClosed()){
   await operator.screenshot({path:out("failure-view-"+Date.now()+".png"),fullPage:true}).catch(()=>{});
   await operator.locator("body").innerText().then(text=>write(out("failure-page-"+Date.now()+".txt"),text)).catch(()=>{});
  }
  try{json(out("failure-"+Date.now()+".json"),{operation:OPERATION,at:new Date().toISOString(),stage:progress.active,project_id:projectId,message:String(error),stack:error.stack,page_errors:pageErrors});}
  catch(failureWrite){error.failure_record_error=String(failureWrite);}
 }finally{
  const cleanup=[];
  async function close(name,action,ms=10000){
   let timer;try{await Promise.race([Promise.resolve().then(action),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(name+" close timed out")),ms);})]);cleanup.push({resource:name,closed:true});}
   catch(error){cleanup.push({resource:name,closed:false,message:String(error)});}finally{clearTimeout(timer);}
  }
  if(context)await close("browser context",()=>context.close());
  if(browser)await close("browser",()=>browser.close());
  await close("native server",()=>stop(),17000);
  await close("attachment server",async()=>{attachmentServer.closeAllConnections();if(attachmentServer.listening)await new Promise((resolve,reject)=>attachmentServer.close(error=>error?reject(error):resolve()));});
  if(serverLog!==null)await close("server log",()=>{fs.closeSync(serverLog);serverLog=null;});
  if(cleanup.some(row=>!row.closed)){
   if(!primaryError)primaryError=Error("Receiving resources did not all close: "+cleanup.filter(row=>!row.closed).map(row=>row.resource).join(", "));
   primaryError.cleanup=cleanup;
   try{json(out("cleanup-failure-"+Date.now()+".json"),{operation:OPERATION,source_identity:sourceIdentity,primary_message:String(primaryError),cleanup});}catch(error){primaryError.cleanup_record_error=String(error);}
  }
 }
 if(primaryError)throw primaryError;
 assert.ok(pendingResult);
 const retainedAttachments=read(attachmentsFile);assert.equal(retainedAttachments.source_identity,sourceIdentity);verifyPins(retainedAttachments.retained_files);
 const editionPrefix=path.relative(config.output,editionRoot).split(path.sep).join("/")+"/";
 pendingResult.artifacts=inventory(config.output).filter(row=>!row.path.startsWith("received-workspace/")&&(!row.path.startsWith("receiving/")||row.path.startsWith(editionPrefix))&&!["progress.json","operation.lock","server.log","current-result.json"].includes(row.path)&&row.path!==editionPrefix+"result.json");
 json(resultFile,pendingResult);selectResult();
}
