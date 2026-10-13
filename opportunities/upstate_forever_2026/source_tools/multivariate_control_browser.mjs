/** Optional original Geographic browser chapter for one explicit matched-control design.
 * No scientific defaults and no background task. All writes use the visible
 * original desk and queue; complete original runs are compared before and after.
 */
import {promises as fs} from "node:fs";
import {createHash} from "node:crypto";
import {isAbsolute,resolve,join,extname} from "node:path";
import {pathToFileURL} from "node:url";
const terminal=new Set(["complete","failed","interrupted","cancelled"]);
const nativeId=value=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);
const sourceKey=value=>[value.source_collection_id,value.source_id,value.source_sha256].join(":");
const clean=value=>JSON.parse(JSON.stringify(value,(key,item)=>key==="_downloads"?undefined:item));

export async function admitMatchedControlChapter(value,{requireValue}){
 if(value===undefined)return null;
 requireValue(value&&typeof value==="object"&&!Array.isArray(value),"Use one explicit matched-control chapter");
 const allowed=["action","selection_file","design_id"];
 requireValue(Object.keys(value).every(k=>allowed.includes(k)),"Unknown matched-control chapter fields");
 requireValue(["inspect","prepare","adopt","execute"].includes(value.action),"Choose the exact matched-control continuation");
 requireValue(Boolean(value.selection_file)!==Boolean(value.design_id),"Choose one authored selection file or saved design ID");
 if(value.design_id){
  requireValue(nativeId(value.design_id),"Use the original saved design ID");
  return {action:value.action,design_id:value.design_id};
 }
 requireValue(isAbsolute(value.selection_file),"Use the actual absolute authored selection path");
 const bytes=await fs.readFile(value.selection_file),selection=JSON.parse(bytes.toString("utf8"));
 requireValue(selection?.schema==="upstate.multivariate-control-selection/v1","Use the original multivariate-control selection schema");
 requireValue(value.action!=="inspect","Inspect needs an actual saved design ID");
 return {action:value.action,selection,selection_sha256:createHash("sha256").update(bytes).digest("hex"),
  selection_raw_base64:bytes.toString("base64")};
}

export async function admitMatchedControlReceiving(value,chapter,{readJSON,fileHash,regular,verified,equal,requireValue}){
 requireValue(value&&typeof value==="object"&&!Array.isArray(value)&&
  Object.keys(value).every(key=>["path","sha256"].includes(key))&&
  typeof value.path==="string"&&isAbsolute(value.path)&&nativeId(value.sha256),
  "Select the exact completed native receiving.json path and SHA256");
 const path=resolve(value.path);
 requireValue(await fs.realpath(path)===path&&(await fs.lstat(path)).isFile(),"Select the original regular receiving receipt");
 requireValue((await fileHash(path)).sha256===value.sha256,"The original native receiving receipt changed");
 const state=await readJSON(path),admission=state.browser_admission;
 requireValue(state.schema==="upstate.multivariate-control-receiving/v1"&&state.state==="complete"&&
  nativeId(state.id)&&nativeId(state.study_id)&&nativeId(state.design_id)&&
  admission?.schema==="upstate.multivariate-control-browser-admission/v1"&&
  admission.project&&typeof admission.project==="object"&&!Array.isArray(admission.project),
  "Finish the original native matched-control receiving chapter, including its browser admission");
 requireValue(chapter?.action==="inspect"&&chapter.design_id===state.design_id,
  "Open this received exact saved design with action inspect; author a new design through its own native course");
 requireValue(state.independent_reopen?.identity==="MATCH"&&state.independent_reopen.design_id===state.design_id&&
  state.independent_reopen.study_id===state.study_id&&equal(state.independent_reopen.project,admission.project)&&
  state.preserved_originals?.identity==="MATCH"&&state.design?.id===state.design_id&&
  state.identity?.project_id===admission.project?.id&&admission.study_id===state.study_id&&admission.design_id===state.design_id&&
  state.archive?.sha256===admission.archive_sha256&&state.restored?.archive_sha256===admission.archive_sha256&&
  equal(state.restored?.project,admission.project),
  "The native receipt, independent reopen, Study and original project differ");
 requireValue(isAbsolute(admission.workspace)&&isAbsolute(admission.application)&&
  state.restored.workspace===admission.workspace&&state.restored.application===admission.application,
  "Use the exact independently restored application and Workspace");
 const workspace=await fs.realpath(admission.workspace),application=await fs.realpath(admission.application);
 requireValue(workspace===resolve(admission.workspace)&&application===resolve(admission.application),
  "Use original received paths without aliases");
 const root=resolve(workspace,"..");
 requireValue(workspace===join(root,"workspace")&&application===join(root,"application"),
  "The application and Workspace must belong to the same original received Study");
 const members=new Map(),records=[];
 requireValue(Array.isArray(admission.files)&&Array.isArray(admission.run_records),"The native browser admission is incomplete");
 for(const descriptor of admission.files){
  requireValue(descriptor&&typeof descriptor==="object"&&typeof descriptor.path==="string"&&!members.has(descriptor.path),"The native browser admission has an invalid or repeated member");
  const memberPath=await verified(workspace,descriptor);members.set(descriptor.path,descriptor);
  records.push({path:descriptor.path,value:await readJSON(memberPath)});
 }
 const required=["workspace.json","study-transfers/"+state.study_id+".json",
  "multivariate-controls/"+state.design_id+"/design.json",
  ...(state.design.adoption?["multivariate-controls/"+state.design_id+"/adoption.json"]:[]),
  ...(state.outcome_report?["multivariate-control-outcomes/"+state.outcome_report.id+"/outcome.json"]:[])];
 const runIds=new Set();
 for(const row of admission.run_records){
  requireValue(nativeId(row.id)&&!runIds.has(row.id)&&typeof row.state==="string","The received native roster is malformed");
  runIds.add(row.id);required.push("runs/"+row.id+"/run.json");
  const actual=records.find(item=>item.path==="runs/"+row.id+"/run.json")?.value;
  requireValue(actual?.id===row.id&&actual.state===row.state,"A received original native run changed");
 }
 requireValue(members.size===required.length&&required.every(name=>members.has(name)),
  "The browser admission lost or substituted a selected native member");
 const valueAt=name=>records.find(row=>row.path===name)?.value;
 requireValue(equal(valueAt("workspace.json"),admission.project),"The received project changed");
 const receipt=valueAt("study-transfers/"+state.study_id+".json");
 requireValue(receipt?.schema==="upstate.study-transfer/v1"&&receipt.id===state.study_id&&
  receipt.identity?.project_id===admission.project.id&&
  receipt.identity.selection?.roots?.some(row=>row.kind==="multivariate-controls"&&row.id===state.design_id),
  "The original selected Study does not contain this matched-control root");
 const design=valueAt("multivariate-controls/"+state.design_id+"/design.json");
 const expanded={...design};
 if(state.design.adoption)expanded.adoption=valueAt("multivariate-controls/"+state.design_id+"/adoption.json");
 requireValue(equal(expanded,state.design)&&design.binding?.baseline_run_id===state.identity.baseline_run_id&&
  design.binding.restoration_run_id===state.identity.restoration_run_id,"The received design/cohort differs from the native result");
 if(state.outcome_report){
  requireValue(nativeId(state.outcome_report.id)&&state.outcome_report.id===admission.outcome_id&&
   state.independent_reopen.outcome_id===state.outcome_report.id&&
   equal(valueAt("multivariate-control-outcomes/"+state.outcome_report.id+"/outcome.json"),state.outcome_report)&&
   receipt.identity.selection.roots.some(row=>row.kind==="multivariate-control-outcomes"&&row.id===state.outcome_report.id),
   "The received exact outcome report or typed Study root changed");
 }
 const completed=admission.run_records.filter(row=>row.state==="complete").map(row=>row.id);
 requireValue(completed.includes(state.identity.baseline_run_id)&&completed.includes(state.identity.restoration_run_id),
  "The original baseline and restoration are not completed in this received Study");
 requireValue((await fileHash(path)).sha256===value.sha256,"The original native receipt changed during admission");
 return {root,workspace,application,project:admission.project,design:expanded,receipt:state,
  binding:{receiving_sha256:value.sha256,operation_id:state.id,study_id:state.study_id,
   design_id:state.design_id,...(state.outcome_report?{outcome_id:state.outcome_report.id}:{}),archive_sha256:admission.archive_sha256,files:admission.files},
  source:{path,sha256:value.sha256},
  nativeCohort:{baseline_run_id:state.identity.baseline_run_id,restoration_run_ids:[state.identity.restoration_run_id]},
  course:{completed_run_ids:completed,planned_run_ids:[...runIds],pending_run_ids:admission.run_records.filter(row=>row.state!=="complete").map(row=>row.id),records}};
}

export async function operateMatchedControl(options){
 const {page,chapter,prepared,course,api,apiPost,workspaceKey,equal,requireValue,check,waitFor,
  saveRecord,screenshot,action,download,ticketDownloads,click,closeDialog,navigate,readJSON}=options;
 if(!chapter)return;
 const cohort=options.nativeCohort||{baseline_run_id:prepared.baseline_run_id,restoration_run_ids:prepared.alternative_run_ids};
 const original=new Map();
 for(const id of course.completed_run_ids){
  const value=clean(await api("/api/item",{kind:"runs",id}));
  requireValue(value.id===id&&value.state==="complete","Retain the actual completed original run before this chapter");
  original.set(id,value);
 }
 const before=await api("/api/state");
 const runIdsBefore=new Set(before.data.runs.map(row=>row.id));
 const openDesk=async()=>{
  await navigate("multivariate-control");
  await waitFor(async()=>await page.locator("[data-mc-field=baseline_run_id]").count()===1,"original matched-control catalogue");
 };
 const error=async()=>{
  const el=page.locator("[data-mc-error]");
  if(await el.count()&&await el.isVisible()){
   const text=await el.textContent();if(text?.trim())throw Error(text.trim());
  }
 };
 const openDesign=async id=>{
  await click('[data-mc-action="reload"]');
  await waitFor(async()=>await page.locator('[data-mc-saved] option[value="'+id+'"]').count()===1,"retained matched-control design");
  await page.locator("[data-mc-saved]").selectOption(id);
  await click('[data-mc-action="open"]');
  await waitFor(async()=>{await error();return (await page.locator("[data-mc-result]").textContent()).includes(id);},"exact saved matched-control design");
  const value=await apiPost("/api/multivariate-control/inspect",{design_id:id});
  requireValue(value.id===id,"The desk opened another design");
  return value;
 };
 const queue=async(actionName,button,expected)=>{
  const state=await api("/api/state");
  let task=(state.tasks||[]).filter(row=>row.workspace===workspaceKey&&row.action===actionName&&
   (row.payload?.design_id===expected||row.payload?.expected_design_id===expected))
   .sort((a,b)=>String(b.created_at||"").localeCompare(String(a.created_at||"")))[0];
  if(!task){
   const [response]=await Promise.all([
    page.waitForResponse(response=>new URL(response.url()).pathname==="/api/actions"&&response.request().method()==="POST"&&response.request().postDataJSON()?.action===actionName),
    click('[data-mc-action="'+button+'"]')]);
   requireValue(response.ok(),"The original "+actionName+" queue request failed");
   task=await response.json();const body=response.request().postDataJSON();
   requireValue(task.id&&body.payload&&(expected===body.payload.design_id||expected===body.payload.expected_design_id),"The accepted queue request belongs to another saved design");
   await saveRecord("matched-control-"+button+"-accepted",{request:body,task});
  }else await saveRecord("matched-control-"+button+"-retained-task",task);
  action("matched_control_queue_accepted",{action:actionName,task_id:task.id,design_id:expected});
  let last=null,progress=null;
  await waitFor(async()=>{
   check();
   progress=await apiPost("/api/multivariate-control/progress",{task_id:task.id});
   const signature=JSON.stringify(progress);
   if(signature!==last){last=signature;await saveRecord("matched-control-"+button+"-progress",progress);}
   return terminal.has(progress.state);
  },"original "+actionName+" task",Infinity);
  requireValue(progress.state==="complete","Resolve the original "+actionName+" failure before continuing: "+JSON.stringify(progress.error||progress));
  await waitFor(async()=>!(await page.locator('[data-mc-action="reload"]').isDisabled()),"matched-control queue receipt");
  return openDesign(expected);
 };
 await openDesk();
 const catalog=await apiPost("/api/multivariate-control/catalog",{});
 await saveRecord("matched-control-original-catalog",catalog);
 await screenshot(page,"matched-control-original-desk",1440);
 await screenshot(page,"matched-control-original-desk",390);
 let design=null,selection=chapter.selection;
 if(chapter.design_id){
  design=await openDesign(chapter.design_id);selection=design.selection;
 }else{
  const authoredPreview=await apiPost("/api/multivariate-control/preview",{selection});
  await saveRecord("matched-control-authored-selection",{selection_sha256:chapter.selection_sha256,
   selection_raw_base64:chapter.selection_raw_base64,authored_selection:selection,native_preview:authoredPreview});
  selection=authoredPreview.selection;
  const available=catalog.restorations.find(row=>row.id===selection.restoration_footprint_id);
  requireValue(available,"The exact authored restoration footprint is absent from this original project");
  requireValue(selection.baseline_run_id===cohort.baseline_run_id&&
    cohort.restoration_run_ids.includes(available.run_id),"The authored design differs from the retained original baseline/restoration");
  await click('[data-mc-action="new"]');
  for(const field of ["title","reason","max_working_bytes"])
   await page.locator("[data-mc-field="+field+"]").fill(String(selection[field]));
  await page.locator("[data-mc-field=baseline_run_id]").selectOption(selection.baseline_run_id);
  await page.locator("[data-mc-field=restoration_footprint_id]").selectOption(selection.restoration_footprint_id);
  for(const role of ["DEM","K_FACTOR","R_FACTOR"]){
   const row=selection.strata.find(item=>item.role===role);
   const toggle=page.locator('[data-mc-enabled="'+role+'"]');
   if(await toggle.count())await toggle.setChecked(Boolean(row));
   requireValue(row||await toggle.count(),"The native editor cannot preserve this covariate subset");
   await page.locator('[data-mc-boundaries="'+role+'"]').fill((row?.boundaries||[]).join(", "));
  }
  for(const role of ["SLOPE","CONNECTIVITY"]){
   const row=selection.strata.find(item=>item.role===role);
   await page.locator('[data-mc-optional="'+role+'"][data-mc-part=enabled]').setChecked(Boolean(row));
   if(row){
    await page.locator('[data-mc-optional="'+role+'"][data-mc-part=source]').selectOption(sourceKey(row.source));
    await page.locator('[data-mc-optional="'+role+'"][data-mc-part=boundaries]').fill(row.boundaries.join(", "));
    await page.locator('[data-mc-optional="'+role+'"][data-mc-part=definition]').fill(row.definition);
   }
  }
  await page.locator("[data-mc-field=precipitation_caliper]").fill(selection.precipitation_caliper===null?"":String(selection.precipitation_caliper));
  await page.locator("[data-mc-field=exclusion_source]").selectOption(selection.exclusion_source?sourceKey(selection.exclusion_source):"");
  const [response]=await Promise.all([
   page.waitForResponse(response=>new URL(response.url()).pathname==="/api/multivariate-control/preview"&&response.request().method()==="POST"),
   click('[data-mc-action="preview"]')]);
  requireValue(response.ok(),"The authored original-source preview failed");
  const preview=await response.json();
  requireValue(equal(preview.selection,selection)&&preview.id===authoredPreview.id&&equal(preview.binding,authoredPreview.binding),"The visible editor changed an authored scientific choice or original source binding");
  await saveRecord("matched-control-source-preview",preview);
  await waitFor(async()=>await page.locator('[data-mc-action="prepare"]').isEnabled(),"reviewed original design choices");
  await screenshot(page,"matched-control-authored-preview",1440);
  await screenshot(page,"matched-control-authored-preview",390);
  design=preview.existing?await openDesign(preview.id):await queue("control.prepare","prepare",preview.id);
 }
 requireValue(design.binding.baseline_run_id===cohort.baseline_run_id&&
  cohort.restoration_run_ids.includes(design.binding.restoration_run_id),"The saved design belongs to another retained native cohort");
 const accepted=design.state==="prepared";
 if(accepted&&["adopt","execute"].includes(chapter.action)&&!design.adoption)
  design=await queue("control.adopt","adopt",design.id);
 if(accepted&&chapter.action==="execute"){
  const current=await api("/api/item",{kind:"runs",id:design.adoption.run_id});
  if(current.state!=="complete")design=await queue("control.execute","execute",design.id);
 }
 await saveRecord("matched-control-retained-design",design);
 await screenshot(page,"matched-control-support-balance",1440);
 await screenshot(page,"matched-control-support-balance",390);
 const exported=await download(page.locator('[data-mc-action="export-result"]'),"matched-control-design-json");
 const document=await readJSON(exported.file);
 requireValue(equal(clean(document),clean(design)),"The downloaded complete design differs from the selected original");
 if(design._downloads?.length)
  await ticketDownloads("[data-mc-result]",design._downloads,"matched-control-original-design-file");
 const deskFile=await download(page.locator('[data-mc-action="export"]'),"matched-control-editable-desk");
 await click('[data-mc-action="new"]');
 await page.locator("[data-mc-import]").setInputFiles(deskFile.file);
 await waitFor(async()=>{await error();return (await page.locator("[data-mc-result]").textContent()).includes(design.id);},"reopened complete authored desk");
 await page.reload({waitUntil:"domcontentloaded"});
 await openDesk();
 const reopened=await openDesign(design.id);
 requireValue(equal(clean(reopened),clean(design)),"Reload changed the saved design or adoption");
 await screenshot(page,"matched-control-reopened",1440);
 await screenshot(page,"matched-control-reopened",390);
 if(design.adoption){
  for(const [button,kind,id] of [["run","runs",design.adoption.run_id],["scenario","scenarios",design.adoption.scenario_id]]){
   await click('[data-mc-action="'+button+'"]');
   await waitFor(async()=>await page.locator("#detail-dialog").evaluate(node=>node.open),"original adopted "+kind);
   const item=await api("/api/item",{kind,id});
   requireValue(item.id===id,"The native opener selected another original item");
   await saveRecord("matched-control-"+kind,item);
   await screenshot(page,"matched-control-"+kind,1440);await screenshot(page,"matched-control-"+kind,390);
   await closeDialog();
  }
  const [experimentResponse]=await Promise.all([
   page.waitForResponse(response=>{const url=new URL(response.url());return url.pathname==="/api/experiments/inspect"&&url.searchParams.get("experiment_id")===design.adoption.experiment_id;}),
   click('[data-mc-action="experiment"]')]);
  requireValue(experimentResponse.ok(),"The original saved experiment could not be reopened");
  const experiment=await experimentResponse.json();
  requireValue(experiment.id===design.adoption.experiment_id,"The experiment desk opened another native design");
  await waitFor(async()=>await page.locator('#experiment-detail [data-action="experiment-clone"][data-id="'+design.adoption.experiment_id+'"]').count()===1,"original saved experiment");
  await saveRecord("matched-control-original-experiment",experiment);
  let summary=null;
  if(experiment.state==="complete"){
   summary=await api("/api/experiments/summary",{experiment_id:experiment.id});
   requireValue(summary.id===experiment.id,"The native report belongs to another experiment");
   await saveRecord("matched-control-native-summary",summary);
  }
  await screenshot(page,"matched-control-original-experiment",1440);
  await screenshot(page,"matched-control-original-experiment",390);
  const files=[...(experiment._downloads||[]),...(summary?._downloads||[])].filter((row,index,rows)=>rows.findIndex(other=>other.id===row.id)===index);
  if(files.length)await ticketDownloads("#experiment-detail",files,"matched-control-native-experiment-file");
  await openDesk();await openDesign(design.id);
 }
 for(const [id,value] of original)
  requireValue(equal(clean(await api("/api/item",{kind:"runs",id})),value),"The new control chapter changed an original completed run");
 const after=await api("/api/state"),created=after.data.runs.filter(row=>!runIdsBefore.has(row.id));
 requireValue(created.every(row=>row.id===design.adoption?.run_id),"This chapter created an unexpected native run");
 if(chapter.action==="execute"&&accepted){
  const run=await api("/api/item",{kind:"runs",id:design.adoption.run_id});
  requireValue(run.state==="complete","The new control is not an actual complete native run");
 }
 const result={schema:"upstate.multivariate-control-browser/v1",action:chapter.action,
  project_id:catalog.project_id,design_id:design.id,state:design.state,adoption:design.adoption||null,
  selection:design.selection,original_completed_run_ids:[...original.keys()],new_run_ids:created.map(row=>row.id),
  original_run_identity:"MATCH",files:(design._downloads||[]).length,
  native_receiving_next:{saved_design_id:design.id,execute_already_requested:chapter.action==="execute"},
  producer_view:"The producing worker must personally view the final screens and every downloaded report/map/archive; automated operation and capture are not visual acceptance."};
 await saveRecord("matched-control-browser-completion",result);
 action("matched_control_browser_completed",result);
 return result;
}


export async function admitMatchedControlOutcomeChapter(value,{requireValue}){
 if(value===undefined)return null;
 requireValue(value&&typeof value==="object"&&!Array.isArray(value)&&
  Object.keys(value).every(key=>["action","selection_file","outcome_id"].includes(key)),
  "Use one explicit original native outcome chapter");
 requireValue(["inspect","prepare"].includes(value.action)&&
  Boolean(value.selection_file)!==Boolean(value.outcome_id),"Choose original outcome inspect or report preparation and one selection or saved ID");
 if(value.outcome_id){
  requireValue(nativeId(value.outcome_id)&&value.action==="inspect","Open a retained exact outcome with inspect");
  return {action:value.action,outcome_id:value.outcome_id};
 }
 requireValue(value.action==="prepare"&&typeof value.selection_file==="string"&&isAbsolute(value.selection_file),
  "Select an absolute authored original outcome selection file");
 const bytes=await fs.readFile(value.selection_file),selection=JSON.parse(bytes.toString("utf8"));
 requireValue(selection?.schema==="upstate.multivariate-control-outcome-selection/v1","Use the original native outcome selection");
 return {action:value.action,selection,selection_sha256:createHash("sha256").update(bytes).digest("hex"),
  selection_raw_base64:bytes.toString("base64")};
}

export async function operateMatchedControlOutcomes(options){
 const {page,chapter,matchedResult,nativeCohort,workspace,workspaceKey,api,apiPost,equal,requireValue,
  check,waitFor,saveRecord,screenshot,action,download,ticketDownloads,click,closeDialog,navigate,readJSON,verified}=options;
 if(!chapter)return null;
 requireValue(matchedResult?.adoption,"Outcome comparison needs the retained adopted original matched-control design");
 const before=await api("/api/state"),original=new Map();
 for(const row of before.data.runs){
  if(row.state==="complete")original.set(row.id,clean(await api("/api/item",{kind:"runs",id:row.id})));
 }
 const openDesk=async()=>{
  await navigate("multivariate-control-outcomes");
  await waitFor(async()=>await page.locator('[data-mco-field="title"]').count()===1,"original outcome catalogue");
 };
 const error=async()=>{
  const target=page.locator("[data-mco-error]");
  if(await target.count()&&await target.isVisible()){const text=await target.textContent();if(text?.trim())throw Error(text.trim());}
 };
 const openOutcome=async id=>{
  await click('[data-mco-action="reload"]');
  await waitFor(async()=>{await error();return await page.locator('[data-mco-saved] option[value="'+id+'"]').count()===1;},"exact saved outcome");
  await page.locator("[data-mco-saved]").selectOption(id);
  await click('[data-mco-action="open"]');
  await waitFor(async()=>{await error();return (await page.locator("[data-mco-result]").textContent()).includes(id);},"original outcome result");
  const value=await apiPost("/api/multivariate-control-outcomes/inspect",{outcome_id:id});
  requireValue(value.id===id,"The outcome desk returned another original comparison");return value;
 };
 await openDesk();
 const catalog=await apiPost("/api/multivariate-control-outcomes/catalog",{});
 await saveRecord("matched-control-outcome-catalog",catalog);
 await screenshot(page,"matched-control-outcomes-initial",1440);await screenshot(page,"matched-control-outcomes-initial",390);
 let result=null;
 if(chapter.outcome_id)result=await openOutcome(chapter.outcome_id);
 else{
  const preview=await apiPost("/api/multivariate-control-outcomes/preview",{selection:chapter.selection});
  await saveRecord("matched-control-outcome-authored-selection",{authored_selection:chapter.selection,
   selection_raw_base64:chapter.selection_raw_base64,selection_sha256:chapter.selection_sha256,native_preview:preview});
  const selection=preview.selection;
  requireValue(selection.design_ids.includes(matchedResult.design_id)&&
   preview.binding.baseline_run_id===nativeCohort.baseline_run_id&&
   nativeCohort.restoration_run_ids.includes(preview.binding.restoration_run_id),
   "The outcome choices differ from this retained native cohort");
  await click('[data-mco-action="new"]');
  await page.locator('[data-mco-field="title"]').fill(selection.title);
  await page.locator('[data-mco-field="reason"]').fill(selection.reason);
  await page.locator('[data-mco-field="quantity_scope"]').selectOption(selection.quantity_scope);
  for(const id of selection.design_ids){
   const target=page.locator('[data-mco-design="'+id+'"]');
   requireValue(await target.count()===1&&!(await target.isDisabled()),"A selected original control is unavailable or incomplete");
   await target.check();
  }
  for(const pollutant of selection.pollutants)await page.locator('[data-mco-pollutant="'+pollutant+'"]').check();
  const [response]=await Promise.all([
   page.waitForResponse(row=>new URL(row.url()).pathname==="/api/multivariate-control-outcomes/preview"&&row.request().method()==="POST"),
   click('[data-mco-action="preview"]')]);
  requireValue(response.ok(),"The authored outcome source preview failed");
  const actual=await response.json();
  requireValue(actual.id===preview.id&&equal(actual.selection,preview.selection)&&equal(actual.binding,preview.binding),
   "The visible outcome form changed the exact original authored source selection");
  await saveRecord("matched-control-outcome-visible-preview",actual);
  await screenshot(page,"matched-control-outcome-preview",1440);await screenshot(page,"matched-control-outcome-preview",390);
  if(preview.existing)result=await openOutcome(preview.id);
  else{
   const current=await api("/api/state");
   let task=(current.tasks||[]).filter(row=>row.workspace===workspaceKey&&row.action==="control.outcomes.prepare"&&
    row.payload?.expected_id===preview.id).sort((a,b)=>String(b.created_at||"").localeCompare(String(a.created_at||"")))[0];
   if(!task){
    const [accepted]=await Promise.all([
     page.waitForResponse(row=>new URL(row.url()).pathname==="/api/actions"&&row.request().method()==="POST"&&row.request().postDataJSON()?.action==="control.outcomes.prepare"),
     click('[data-mco-action="prepare"]')]);
    requireValue(accepted.ok(),"The original native outcome queue rejected this request");
    task=await accepted.json();const request=accepted.request().postDataJSON();
    requireValue(task.id&&request.payload?.expected_id===preview.id&&equal(request.payload.selection,selection),
     "The accepted outcome request belongs to another source preview");
    await saveRecord("matched-control-outcome-accepted",{request,task});
   }else await saveRecord("matched-control-outcome-retained-task",task);
   let progress=null,last=null;
   await waitFor(async()=>{
    check();progress=await apiPost("/api/multivariate-control-outcomes/progress",{task_id:task.id});
    const signature=JSON.stringify(progress);
    if(signature!==last){last=signature;await saveRecord("matched-control-outcome-progress",progress);}
    return terminal.has(progress.state);
   },"original native outcome report",Infinity);
   requireValue(progress.state==="complete","Resolve the exact retained outcome failure: "+JSON.stringify(progress.error||progress));
   result=await openOutcome(preview.id);
  }
 }
 requireValue(result.state==="complete"&&result.selection.design_ids.includes(matchedResult.design_id)&&
  result.binding.baseline_run_id===nativeCohort.baseline_run_id&&
  nativeCohort.restoration_run_ids.includes(result.binding.restoration_run_id),
  "The saved outcome does not retain this original baseline/restoration/control cohort");
 if(options.pinnedOutcome)requireValue(equal(clean(result),options.pinnedOutcome),
  "The browser changed the exact native report already verified after receiving");
 await saveRecord("matched-control-outcome-result",result);
 const regions=await page.locator("[data-mco-region] option").evaluateAll(nodes=>nodes.map(node=>node.value));
 requireValue(regions.length>0,"The complete original outcome has no supported region");
 for(const region of regions)for(const support of ["group_common","per_design"]){
  await page.locator("[data-mco-region]").selectOption(region);
  await page.locator("[data-mco-support]").selectOption(support);
  requireValue(await page.locator("[data-mco-support]").inputValue()===support,"The native support selection did not change");
  action("native_outcome_support_opened",{outcome_id:result.id,region,support});
  await screenshot(page,"matched-outcome-"+regions.indexOf(region)+"-"+support,1440);
  await screenshot(page,"matched-outcome-"+regions.indexOf(region)+"-"+support,390);
 }
 const complete=await download(page.locator('[data-mco-action="export-result"]'),"matched-control-outcome-complete");
 requireValue(equal(clean(await readJSON(complete.file)),clean(result)),"The downloaded outcome differs from the exact native result");
 await ticketDownloads("[data-mco-result]",result._downloads||[],"matched-control-outcome-file");
 const files=[];
 for(const row of result.files){
  const path=await verified(workspace,row);files.push({path:row.path,bytes:row.bytes,sha256:row.sha256});
  if([".html",".htm",".svg",".png",".jpg",".jpeg"].includes(extname(path).toLowerCase())){
   const child=await page.context().newPage();
   try{
    await child.goto(pathToFileURL(path).href,{waitUntil:"load"});
    await screenshot(child,"outcome-file-"+files.length,1440);
    await screenshot(child,"outcome-file-"+files.length,390);
    action("native_outcome_file_opened",{path:row.path});
   }finally{await child.close();}
  }
 }
 await saveRecord("matched-control-outcome-original-files",files);
 for(const placement of result.placements){
  const runId=placement.control_run_id;
  await click('[data-mco-action="run"][data-run-id="'+runId+'"]');
  await waitFor(async()=>await page.locator("#detail-dialog").evaluate(node=>node.open),"completed original outcome control");
  const retained=clean(await api("/api/item",{kind:"runs",id:runId}));
  requireValue(retained.id===runId&&retained.state==="complete","An outcome run is not actually complete");
  await saveRecord("outcome-native-"+runId,retained);await screenshot(page,"outcome-native-"+runId.slice(0,12),1440);
  await closeDialog();
 }
 await click('[data-mco-action="clone"]');
 const choices=await download(page.locator('[data-mco-action="export"]'),"matched-control-outcome-editable-choices");
 await click('[data-mco-action="new"]');
 await page.locator("[data-mco-import]").setInputFiles(choices.file);
 await waitFor(async()=>{await error();return (await page.locator("[data-mco-result]").textContent()).includes(result.id);},"reopened original outcome choices");
 await page.reload({waitUntil:"domcontentloaded"});await openDesk();
 const reopened=await openOutcome(result.id);
 requireValue(equal(clean(reopened),clean(result)),"Reload changed the original native outcome");
 await screenshot(page,"matched-control-outcome-reopened",1440);await screenshot(page,"matched-control-outcome-reopened",390);
 for(const [id,value]of original)requireValue(equal(clean(await api("/api/item",{kind:"runs",id})),value),
  "Outcome analysis changed an original completed model record");
 const after=await api("/api/state");
 requireValue(equal(before.data.runs.map(row=>row.id).sort(),after.data.runs.map(row=>row.id).sort()),
  "Reading native outcomes must not create a model run");
 const completion={schema:"upstate.multivariate-control-outcome-browser/v1",outcome_id:result.id,
  design_ids:result.selection.design_ids,source:result.source,files:files.length,original_run_identity:"MATCH",
  native_model_execution:false,producer_view:"The producing worker must view every actual final screen, PDF, raster/map, table and archived project. Browser operation and capture are not personal visual acceptance."};
 await saveRecord("matched-control-outcome-browser-completion",completion);action("matched_control_outcomes_opened",completion);return completion;
}
