/** Optional original Geographic browser chapter for one explicit matched-control design.
 * No scientific defaults and no background task. All writes use the visible
 * original desk and queue; complete original runs are compared before and after.
 */
import {promises as fs} from "node:fs";
import {createHash} from "node:crypto";
import {isAbsolute} from "node:path";
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

export async function operateMatchedControl(options){
 const {page,chapter,prepared,course,api,apiPost,workspaceKey,equal,requireValue,check,waitFor,
  saveRecord,screenshot,action,download,ticketDownloads,click,closeDialog,navigate,readJSON}=options;
 if(!chapter)return;
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
  requireValue(selection.baseline_run_id===prepared.baseline_run_id&&
    prepared.alternative_run_ids.includes(available.run_id),"The authored design differs from the original Geographic baseline/restoration");
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
 requireValue(design.binding.baseline_run_id===prepared.baseline_run_id&&
  prepared.alternative_run_ids.includes(design.binding.restoration_run_id),"The saved design belongs to another native Geographic cohort");
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
  await click('[data-mc-action="experiment"]');
  await waitFor(async()=>await page.locator("#detail-dialog").evaluate(node=>node.open)&&
   (await page.locator("#detail-dialog").textContent()).includes(design.adoption.experiment_id), "original saved experiment");
  await screenshot(page,"matched-control-original-experiment",1440);
  await screenshot(page,"matched-control-original-experiment",390);
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
