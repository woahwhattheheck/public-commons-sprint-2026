#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const args={};for(let i=2;i<process.argv.length;i+=2){if(!process.argv[i].startsWith("--")||!process.argv[i+1])throw Error("Use complete named arguments.");args[process.argv[i].slice(2)]=process.argv[i+1];}
const root=path.resolve(args.out),input=JSON.parse(fs.readFileSync(args.input,"utf8"));
const SCHEMA="commons.register-migration-browser-receiving/v1";
const ORDER=["source-mapping-and-working-file","complete-plan-and-original-controls","independent-rehearsal-and-compare","review-and-cutover","full-exports-and-portable-delivery","wide-narrow-and-original-reopen"];
const need=(ok,message)=>{if(!ok)throw Error(message);};
const stable=x=>x===null||typeof x!=="object"?JSON.stringify(x):Array.isArray(x)?"["+x.map(stable).join(",")+"]":"{"+Object.keys(x).sort().map(k=>JSON.stringify(k)+":"+stable(x[k])).join(",")+"}";
const sha=raw=>crypto.createHash("sha256").update(raw).digest("hex");
const same=(a,b)=>stable(a)===stable(b);
function read(file){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const before=fs.fstatSync(fd,{bigint:true});need(before.isFile()&&before.size<=192n*1024n*1024n,"Select a complete bounded original file.");
 const raw=Buffer.alloc(Number(before.size));let i=0;while(i<raw.length){const n=fs.readSync(fd,raw,i,Math.min(262144,raw.length-i),null);need(n>0,"Original file ended early.");i+=n;}
 const extra=Buffer.alloc(1);need(fs.readSync(fd,extra,0,1,null)===0,"Original file grew.");
 for(const after of [fs.fstatSync(fd,{bigint:true}),fs.lstatSync(file,{bigint:true})])need(["dev","ino","size","mtimeNs","ctimeNs"].every(k=>before[k]===after[k]),"Original file changed.");return raw;
 }finally{fs.closeSync(fd);}
}
function sync(dir){const fd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function directory(dir){fs.mkdirSync(dir,{recursive:true,mode:0o700});const s=fs.lstatSync(dir);need(s.isDirectory()&&!s.isSymbolicLink()&&fs.realpathSync(dir)===dir,"Keep an original ordinary directory.");}
function put(relative,value){
 const file=path.join(root,relative),raw=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value,null,2)+"\n");
 need(file.startsWith(root+path.sep),"Keep output in the original root.");directory(path.dirname(file));
 if(fs.existsSync(file)){need(read(file).equals(raw),"Keep the original immutable result: "+relative);sync(path.dirname(file));return artifact(relative);}
 const temporary=file+".pending-"+crypto.randomUUID();let fd;
 try{fd=fs.openSync(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}
 finally{if(fd!==undefined)fs.closeSync(fd);}
 try{try{fs.linkSync(temporary,file);}catch(e){if(e.code!=="EEXIST")throw e;need(read(file).equals(raw),"The original result differs.");}sync(path.dirname(file));}
 finally{fs.unlinkSync(temporary);sync(path.dirname(file));}
 return artifact(relative);
}
function artifact(relative){
 const file=path.resolve(root,relative);need(file.startsWith(root+path.sep),"Keep the selected artifact in its original root.");
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  const before=fs.fstatSync(fd,{bigint:true});need(before.isFile()&&before.size<=192n*1024n*1024n,"Select the bounded complete original artifact.");
  const digest=crypto.createHash("sha256"),buffer=Buffer.alloc(262144);let total=0;
  while(true){const count=fs.readSync(fd,buffer,0,buffer.length,null);if(!count)break;total+=count;need(BigInt(total)<=before.size,"Original artifact grew.");digest.update(buffer.subarray(0,count));}
  need(BigInt(total)===before.size,"Original artifact ended early.");
  fs.fsyncSync(fd);sync(path.dirname(file));
  for(const after of [fs.fstatSync(fd,{bigint:true}),fs.lstatSync(file,{bigint:true})])need(["dev","ino","size","mtimeNs","ctimeNs"].every(k=>before[k]===after[k]),"The original artifact changed before its durable receipt.");
  return {path:relative,bytes:total,sha256:digest.digest("hex")};
 }finally{fs.closeSync(fd);}
}
function json(relative){return JSON.parse(read(path.join(root,relative)));}
function verify(item){need(same(artifact(item.path),item),"A complete original artifact changed.");}
need(input.schema===SCHEMA+"/input"&&typeof input.selection_sha256==="string","Select the original complete browser input.");
const completeFile=path.join(root,"browser-report.json");
if(fs.existsSync(completeFile)){
 const saved=json("browser-report.json");need(saved.state==="COMPLETE"&&saved.schema===SCHEMA&&saved.selection_sha256===input.selection_sha256&&saved.context_closed===true&&same(saved.phases.map(x=>x.id),ORDER),"Keep the original completed browser selection.");
 for(const item of saved.artifacts)verify(item);process.stdout.write(JSON.stringify({state:"COMPLETE",reopened:true})+"\n");process.exit(0);
}
const attempt="browser-attempt-"+crypto.randomUUID();directory(path.join(root,attempt));directory(path.join(root,"phases"));directory(path.join(root,"operations"));
const artifacts=new Map(),operations=new Map(),phases=[],errors=[],routeErrors=[],routes=new Set();let currentAction=null,context=null,page=null,closed=false,failure=null;
function keep(item){artifacts.set(item.path,item);return item;}
async function until(fn,message,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw Error(message);}
async function idle(){await page.waitForFunction(()=>document.body.dataset.busy!=="true");need(!routeErrors.length,"The original request capture failed: "+routeErrors.join("; "));}
async function click(label,scope=page){await scope.getByRole("button",{name:label,exact:true}).click();await idle();}
async function fill(name,value,scope=page){await scope.locator('[name="'+name+'"]').fill(String(value??""));}
async function nav(label){await click(label,page.locator("#navigation"));await page.getByRole("heading",{name:"Register migration and cutover",exact:true}).waitFor();}
async function tab(label){await click(label,page.getByRole("navigation",{name:"Register migration workflow"}));}
async function readApi(operation,payload={}){
 return await page.evaluate(async ({operation,payload})=>{const r=await fetch("/api/read",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({operation,payload})});const v=await r.json();if(!r.ok||v.error)throw Error(v.error?.message||"Original read failed.");return v;},{operation,payload});
}
async function openWorking(){const details=page.locator("details").filter({has:page.locator("summary").filter({hasText:"Working file, drafts and request recovery"})});if(!await details.evaluate(n=>n.open))await details.locator("summary").click();return details;}
async function capture(label){const relative=attempt+"/"+label+".png";await page.screenshot({path:path.join(root,relative),fullPage:true});return keep(artifact(relative));}
async function download(label,trigger){
 const pending=page.waitForEvent("download");await trigger();const value=await pending;
 const relative=attempt+"/"+label;await value.saveAs(path.join(root,relative));need(await value.failure()===null,"Complete download failed.");
 const item=keep(artifact(relative));return {...item,suggestedFilename:value.suggestedFilename()};
}
async function allRows(operation,payload){
 let offset=0,total=null,rows=[];do{const value=await readApi(operation,{...payload,offset,limit:500});
 need(Array.isArray(value.rows)&&value.offset===offset&&Number.isSafeInteger(value.total)&&value.total>=0&&(total===null||total===value.total),"Keep a complete immutable result page.");
 total=value.total;need(value.rows.length||offset===total,"A complete original page stopped early.");rows.push(...value.rows);offset+=value.rows.length;
 }while(offset<total);need(rows.length===total,"Original population count differs.");return rows;
}
async function settleMountedPending(request){
 const original=await readApi("operation.get",{id:request.payload.operation_id});
 need(original.found&&original.operation.status==="SUCCEEDED"&&same(original.operation.request,request.payload),"Reconcile only the exact original successful request.");
 if(request.operation.startsWith("register.")){
  await nav("Register migration");const working=await openWorking();
  const row=working.locator("tbody tr").filter({hasText:request.payload.operation_id});
  need(await row.count()<=1,"Original pending request is ambiguous.");
  if(await row.count())await click("Inspect result",row);
 }else{
  await click("Handover & history",page.locator("#navigation"));
  const table=page.getByRole("table",{name:"Requests awaiting a confirmed result",exact:true});
  const row=table.locator("tbody tr").filter({hasText:request.payload.operation_id});
  need(await row.count()<=1,"Original pending delivery is ambiguous.");
  if(await row.count())await click("Inspect original",row);
 }
 if(await page.locator("#record-dialog").evaluate(n=>n.open))await page.locator("#close-dialog").click();
 await page.locator("#refresh").click();await idle();
}
function completeCsv(text){
 const records=[];let row=[],field="",quoted=false,ended=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;ended=true;}}else field+=c;continue;}
  if(ended)need(c===","||c==="\r"||c==="\n","Unexpected original CSV content after closing quote.");
  if(c==='"'){need(field===""&&!ended,"Unexpected quote in original CSV.");quoted=true;}
  else if(c===","){row.push(field);field="";ended=false;}
  else if(c==="\r"||c==="\n"){if(c==="\r"&&text[i+1]==="\n")i++;row.push(field);records.push(row);row=[];field="";ended=false;}
  else field+=c;
 }
 need(!quoted,"The complete original CSV ended inside a quoted field.");
 if(field!==""||row.length||ended){row.push(field);records.push(row);}
 return records;
}
async function performAction(key,operation,action){
 const folder="operations/"+key;currentAction=key;
 try{
  if(fs.existsSync(path.join(root,folder,"response.json"))){
   const request=json(folder+"/request.json"),response=json(folder+"/response.json");
   need(request.operation===operation,"The original action type changed.");
   const original=await readApi("operation.get",{id:request.payload.operation_id});
   need(original.found&&original.operation.status==="SUCCEEDED"&&same(original.operation.request,request.payload),"The original accepted action disappeared.");
   keep(artifact(folder+"/request.json"));keep(artifact(folder+"/response.json"));operations.set(key,{key,request,response});await settleMountedPending(request);return response.result;
  }
  if(fs.existsSync(path.join(root,folder,"request.json"))){
   const request=json(folder+"/request.json");need(request.operation===operation,"Keep the exact original pending request.");
   // Recovery transmits only the already retained original body and ID.
   await page.evaluate(async body=>{const r=await fetch("/api/operations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const v=await r.json();if(!r.ok||v.error)throw Error(v.error?.message||"Original replay failed.");},request);
   await page.locator("#refresh").click();await idle();await nav("Register migration");
  }else await action();
  await until(()=>fs.existsSync(path.join(root,folder,"response.json")),"The original action has no complete captured result.",120000);await idle();
  const request=json(folder+"/request.json"),response=json(folder+"/response.json");need(request.operation===operation&&response.result,"Keep the complete original action result.");
  operations.set(key,{key,request,response});await settleMountedPending(request);return response.result;
 }finally{currentAction=null;}
}
async function phase(id,action){
 const selected="phases/"+id+".json";
 if(fs.existsSync(path.join(root,selected))){
  const saved=json(selected);need(saved.id===id&&saved.selection_sha256===input.selection_sha256,"The original completed phase changed.");
  for(const item of saved.artifacts){verify(item);keep(item);}phases.push(saved);return saved.result;
 }
 const before=new Set(artifacts.keys()),result=await action();
 const saved={id,status:"COMPLETE",selection_sha256:input.selection_sha256,result,artifacts:[...artifacts.values()].filter(v=>!before.has(v.path))};
 keep(put(selected,saved));phases.push(saved);return result;
}
async function openRecord(kind,id){
 const names={dataset:["Source mappings","Open original dataset"],plan:["Destination plans","Open complete plan"],rehearsal:["Rehearsals","Open complete rehearsal"],review:["Finding decisions","Open complete review"],cutover:["Cutover","Open complete cutover"]};
 await tab(names[kind][0]);const form=page.locator("form").filter({has:page.getByRole("button",{name:names[kind][1],exact:true})});
 await fill("id",id,form);await click(names[kind][1],form);await page.getByRole("heading",{name:/./}).first().waitFor();
}
async function routeHandler(route){
 const request=route.request();let response=null;
 try{
  need(currentAction!==null,"An unselected browser mutation was attempted.");
  const key=currentAction,body=JSON.parse(request.postData()),folder="operations/"+key;
  keep(put(folder+"/request.json",Buffer.from(request.postData())));
  response=await route.fetch();const raw=await response.body(),value=JSON.parse(raw);
  keep(put(attempt+"/response-"+key+"-"+crypto.randomUUID()+".json",raw));
  if(response.status()>=200&&response.status()<300&&!value.error){keep(put(folder+"/response.json",raw));operations.set(key,{key,request:body,response:value});}
  await route.fulfill({status:response.status(),headers:response.headers(),body:raw});
 }catch(error){routeErrors.push(String(error));try{await route.abort("failed");}catch{}}
 finally{if(response)await response.dispose();}
}
try{
 const playwright=require(path.resolve(args.playwright));
 context=await playwright.chromium.launchPersistentContext(path.join(root,"profile"),{headless:true,executablePath:path.resolve(args.chromium),args:["--no-sandbox","--disable-dev-shm-usage"],viewport:{width:1440,height:1000},acceptDownloads:true});
 await context.route("**/api/operations",route=>{const work=routeHandler(route);routes.add(work);work.finally(()=>routes.delete(work)).catch(()=>{});return work;});
 page=context.pages()[0]||await context.newPage();page.setDefaultTimeout(30000);
 page.on("pageerror",error=>errors.push(String(error)));page.on("console",msg=>{if(msg.type()==="error")errors.push(msg.text());});
 await page.goto(args.url,{waitUntil:"domcontentloaded"});await page.locator("#navigation").getByRole("button",{name:"Register migration",exact:true}).waitFor();
 await page.locator("#actor").fill(input.actor);await nav("Register migration");
 const selected=await phase(ORDER[0],async()=>{
  await tab("Source mappings");
  const dataset=await performAction("dataset","register.dataset.create",async()=>{
   const form=page.locator("form").filter({has:page.getByRole("button",{name:"Save complete mapped register",exact:true})});
   for(const [name,value] of Object.entries({title:"Browser retained original people mapping",source_id:input.people.source.id,register:input.people.register,system:input.people.system,parent_dataset_id:input.people.id,review_note:"Actual browser mapping of the complete authored original people population.",note:"Retain exact text identities and complete source."}))await fill(name,value,form);
   await form.locator('[name="side"]').selectOption("source");
   let index=0;
   for(const [name,spec] of Object.entries(input.people.fields)){
    const row=form.locator(".register-field-row").filter({has:page.getByRole("heading",{name,exact:true})});
    if(!await row.count()){await fill("custom_field",name,form);await click("Add mapped field",form);}
    const actual=form.locator(".register-field-row").filter({has:page.getByRole("heading",{name,exact:true})});
    await actual.locator('input[type="checkbox"]').first().check();
    await actual.locator('select[name$="selectorType"]').selectOption("pointer");await actual.locator('input[name$="selector"]').fill(spec.selector.pointer);
    await actual.locator('select[name$="valueType"]').selectOption(spec.type);
    await actual.locator('input[name$="required"]').setChecked(spec.required);
    await actual.locator('input[name$="keyOrder"]').fill(input.people.key_fields.includes(name)?String(input.people.key_fields.indexOf(name)+1):"");
    index++;
   }
   await click("Preview full mapped population",form);await page.getByText("Preview: "+input.people.row_count+" original occurrences",{exact:true}).waitFor();
   const working=await openWorking();const receipt=await download("source-draft.json",()=>working.getByRole("button",{name:"Download current working file",exact:true}).click());
   const draft=json(receipt.path);need(draft.workspaceId===input.workspace_id&&draft.drafts.dataset.values.source_id===input.people.source.id,"Keep the complete selected draft.");
   await form.locator('[name="note"]').fill("temporary unsaved comparison");
   await working.locator('input[type="file"]').setInputFiles(path.join(root,receipt.path));await click("Restore selected working file",working);
   const restored=page.locator("form").filter({has:page.getByRole("button",{name:"Save complete mapped register",exact:true})});
   need(await restored.locator('[name="note"]').inputValue()==="Retain exact text identities and complete source.","The complete browser draft did not reopen.");
   await capture("source-mapping-wide");await click("Save complete mapped register",restored);
  });
  await openRecord("dataset",dataset.id);const rows=await allRows("register.dataset.rows",{id:dataset.id});
  need(rows.length===input.people.row_count&&rows.some(r=>r.values.id==="001")&&rows.some(r=>r.values.id==="01"),"Exact original text identities changed.");
  keep(put(attempt+"/complete-browser-projection.json",rows));await capture("mapped-original-people");
  return {dataset_id:dataset.id};
 });
 const planned=await phase(ORDER[1],async()=>{
  await tab("Destination plans");const plan=await performAction("plan","register.plan.create",async()=>{
   const form=page.locator("form").filter({has:page.getByRole("button",{name:"Save source-bound destination plan",exact:true})});
   const policy=input.plan.policy,sources=input.plan.source_dataset_ids.map(id=>id===input.people.id?selected.dataset_id:id);
   for(const label of ["Remove draft destination","Remove draft reference","Remove draft control"]){
    while(await form.getByRole("button",{name:label,exact:true}).count()){await form.getByRole("button",{name:label,exact:true}).first().click();await idle();}
   }
   for(const [name,value] of Object.entries({title:"Browser complete seven-register plan",source_dataset_ids:sources.join("\n"),cutoff_at:policy.cutoff_at,max_snapshot_age_seconds:policy.max_snapshot_age_seconds,parent_plan_id:input.plan.id,review_note:"Complete original source, relationship and signed-control selection through the browser."}))await fill(name,value,form);
   async function row(kind,label,values){
    await click(label,form);const all=form.locator(".entry").filter({has:page.locator('[name^="'+kind+'_"]')});const node=all.last();
    for(const [field,value] of Object.entries(values)){const control=node.locator('[name$="_'+field+'"]');if(typeof value==="boolean")await control.setChecked(value);else if(await control.evaluate(n=>n.tagName)==="SELECT")await control.selectOption(String(value));else await control.fill(Array.isArray(value)?value.join("\n"):String(value));}
   }
   for(const [register,system] of Object.entries(policy.destinations))await row("destinations","Add target destinations",{register,system,checks:policy.checks[register]});
   for(const value of policy.references)await row("references","Add relationship rules",value);
   for(const value of policy.controls)await row("controls","Add exact unit and group controls",value);
   await capture("complete-source-plan");await click("Save source-bound destination plan",form);
  });
  await openRecord("plan",plan.id);const items=await allRows("register.plan.items",{id:plan.id});
  need(items.filter(v=>v.details.type==="population").length===Object.keys(input.plan.policy.definitions).length,"Every original register population must remain visible.");
  keep(put(attempt+"/complete-plan-items.json",items));return {plan_id:plan.id};
 });
 const rehearsed=await phase(ORDER[2],async()=>{
  await tab("Rehearsals");const result=await performAction("rehearsal","register.rehearsal.create",async()=>{
   const form=page.locator("form").filter({has:page.getByRole("button",{name:"Reconcile every selected register",exact:true})});
   for(const [name,value] of Object.entries({title:"Browser independent complete target rehearsal",plan_id:planned.plan_id,target_dataset_ids:input.target_dataset_ids.join("\n"),parent_rehearsal_id:input.rehearsal.id,review_note:"Actual independent authored target selection and complete retained source comparison."}))await fill(name,value,form);
   await click("Reconcile every selected register",form);
  });
  need(result.summary.counts.MATCH===result.summary.total,"The complete corrected authored target did not match.");
  await openRecord("rehearsal",result.id);const items=await allRows("register.rehearsal.items",{id:result.id});keep(put(attempt+"/complete-rehearsal-items.json",items));
  const compare=page.locator("form").filter({has:page.getByRole("button",{name:"Compare all retained transitions",exact:true})});
  await fill("before_id",input.first_rehearsal.id,compare);await fill("after_id",result.id,compare);await click("Compare all retained transitions",compare);
  const transitions=await allRows("register.rehearsal.compare",{before_id:input.first_rehearsal.id,after_id:result.id});keep(put(attempt+"/complete-transitions.json",transitions));
  need(transitions.some(r=>r.transition!=="same_findings"),"The original two-edition changes are missing.");
  await capture("complete-rehearsal-and-transitions");return {rehearsal_id:result.id};
 });
 const reviewed=await phase(ORDER[3],async()=>{
  await openRecord("review",input.review.id);await click("Prepare successor decision");
  const review=await performAction("review","register.review.create",async()=>{
   const form=page.locator("form").filter({has:page.getByRole("button",{name:"Retain the finding decision",exact:true})});
   need(await form.locator('[name="evidence_row_ids"]').inputValue()===input.review.evidence_rows.map(r=>r.row_id).join("\n"),"Successor review lost its original evidence IDs.");
   await fill("title","Browser history follow-through",form);await form.locator('[name="disposition"]').selectOption("waiting_evidence");
   await fill("reason","Retain the original first-edition finding and complete source evidence for the authored browser handover.",form);
   await click("Retain the finding decision",form);
  });
  await tab("Cutover");const cutover=await performAction("cutover","register.cutover.create",async()=>{
   const form=page.locator("form").filter({has:page.getByRole("button",{name:"Record the complete cutover review",exact:true})});
   for(const [name,value] of Object.entries({title:"Browser corrected register cutover",rehearsal_ids:rehearsed.rehearsal_id,acceptance_owner:input.actor,parent_cutover_id:input.cutover.id,reason:"The complete selected authored source and independent target populations match; preserve prior local reviews."}))await fill(name,value,form);
   await form.locator('[name="decision"]').selectOption("approved");await click("Record the complete cutover review",form);
  });
  await openRecord("cutover",cutover.id);await capture("complete-cutover");return {review_id:review.id,cutover_id:cutover.id};
 });
 const delivered=await phase(ORDER[4],async()=>{
  await openRecord("rehearsal",rehearsed.rehearsal_id);const downloaded=[];
  for(const format of ["NDJSON","CSV"])downloaded.push(await download("complete-rehearsal."+format.toLowerCase(),()=>page.getByRole("link",{name:"Download complete "+format,exact:true}).click()));
  const ndjson=read(path.join(root,downloaded[0].path)).toString("utf8").trim().split("\n").map(JSON.parse);
  const descriptor=await readApi("register.rehearsal.get",{id:rehearsed.rehearsal_id}),rows=await allRows("register.rehearsal.items",{id:rehearsed.rehearsal_id});
  const state=await readApi("state"),kind="register.rehearsal",entity_id=rehearsed.rehearsal_id;
  const expected=[{schema:"commons.register-migration-export/v1",type:"selection",workspace_id:input.workspace_id,
                  workspace_revision:state.project.revision,kind,entity_id,record:descriptor},
                  ...rows.map(record=>({schema:"commons.register-migration-export/v1",type:"record",kind,entity_id,record}))];
  need(same(ndjson,expected),"The full NDJSON export differs from its exact selection and every ordered original finding.");
  const csv=completeCsv(read(path.join(root,downloaded[1].path)).toString("utf8")),header=csv.shift(),column=header.indexOf("complete_original_record_json");
  need(column>=0&&csv.every(row=>row.length===header.length),"The complete CSV schema or row width differs.");
  need(same(csv.map(row=>JSON.parse(row[column])),expected),"The complete CSV original-record column differs from every selected original wrapper.");
  keep(put(attempt+"/complete-export-selection.json",expected));
  const working=await openWorking();downloaded.push(await download("complete-working-file.json",()=>working.getByRole("button",{name:"Download current working file",exact:true}).click()));
  await click("Handover & history",page.locator("#navigation"));
  const delivery=await performAction("delivery","delivery.prepare",async()=>{
   const form=page.locator("form").filter({has:page.getByRole("button",{name:"Prepare complete editable delivery",exact:true})});
   await fill("title","Complete authored register browser handover",form);await fill("note","Original source, native two-edition programme and accepted browser continuation.",form);
   await click("Prepare complete editable delivery",form);
  });
  await click("Handover & history",page.locator("#navigation"));
  const link=page.locator('a[href="/api/deliveries/'+delivery.id+'"]');await link.waitFor();
  const zip=await download("complete-browser-delivery.zip",()=>link.click());
  need(zip.bytes===delivery.archive_bytes&&zip.sha256===delivery.archive_sha256,"Actual complete ZIP differs from the original delivery receipt.");
  await capture("complete-handover-wide");return {delivery_id:delivery.id,archive:zip,downloads:downloaded};
 });
 await phase(ORDER[5],async()=>{
  await nav("Register migration");await openRecord("rehearsal",rehearsed.rehearsal_id);await capture("final-wide");
  await page.setViewportSize({width:390,height:844});await capture("final-narrow");
  const layout=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth,
    controls:[...document.querySelectorAll("button,input,select,textarea")].filter(n=>{const r=n.getBoundingClientRect();return r.width>0&&r.height>0;}).length}));
  need(layout.controls>0,"The actual narrow operator has no visible controls.");
  keep(put(attempt+"/narrow-layout.json",layout));await page.reload({waitUntil:"domcontentloaded"});await nav("Register migration");
  await openRecord("cutover",reviewed.cutover_id);await capture("reopened-narrow-cutover");
  const state=await readApi("state");need(state.project.id===input.workspace_id,"Browser reopening changed the original project.");
  keep(put(attempt+"/complete-final-state.json",state));return {layout,project:state.project,delivery:delivered.delivery_id};
 });
 need(errors.length===0&&routeErrors.length===0,"The actual browser reported errors: "+[...errors,...routeErrors].join("; "));
}catch(error){failure=error;}
finally{
 if(context)try{await context.close();closed=true;}catch(error){failure=failure||error;}
 const outcomes=await Promise.allSettled([...routes]);for(const outcome of outcomes)if(outcome.status==="rejected")failure=failure||outcome.reason;
 keep(put(attempt+"/browser-outcome.json",{closed,error:failure?String(failure):null,page_errors:errors,route_errors:routeErrors}));
}
if(failure)throw failure;
need(closed&&same(phases.map(p=>p.id),ORDER),"Keep all complete phases and actual browser closure.");
// Adopt operation receipts from earlier completed phases as well as this attempt.
for(const key of ["dataset","plan","rehearsal","review","cutover","delivery"]){
 const request=json("operations/"+key+"/request.json"),response=json("operations/"+key+"/response.json");
 keep(artifact("operations/"+key+"/request.json"));keep(artifact("operations/"+key+"/response.json"));operations.set(key,{key,request,response});
}
for(const id of ORDER)keep(artifact("phases/"+id+".json"));
const report={schema:SCHEMA,state:"COMPLETE",operation_id:input.operation_id,selection_sha256:input.selection_sha256,
 phases,operations:[...operations.values()],artifacts:[...artifacts.values()],context_closed:closed,page_errors:errors,route_errors:routeErrors};
put("browser-report.json",report);process.stdout.write(JSON.stringify({state:"COMPLETE",phases:phases.length,artifacts:artifacts.size})+"\n");
