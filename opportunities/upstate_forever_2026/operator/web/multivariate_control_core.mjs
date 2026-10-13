/** Scientific choices and durable original-queue requests for matched controls. */
export const SCHEMA="upstate.multivariate-control-desk/v1";
export const ROLES=["DEM","K_FACTOR","R_FACTOR"];
export const clone=value=>JSON.parse(JSON.stringify(value));
export const canonical=value=>Array.isArray(value)?"["+value.map(canonical).join(",")+"]":value&&typeof value==="object"?"{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+canonical(value[k])).join(",")+"}":JSON.stringify(value);
const object=value=>value&&typeof value==="object"&&!Array.isArray(value);
const fail=message=>{throw new Error(message);};
const text=value=>typeof value==="string"?value:"";
export function blankDraft(){return {title:"Matched-control design",reason:"",baseline_run_id:"",restoration_footprint_id:"",boundaries:{DEM:"",K_FACTOR:"",R_FACTOR:""},enabled:{DEM:false,K_FACTOR:false,R_FACTOR:false},precipitation_caliper:"",exclusion_source:"",max_working_bytes:"1073741824",optional:{SLOPE:{enabled:false,source:"",boundaries:"",definition:""},CONNECTIVITY:{enabled:false,source:"",boundaries:"",definition:""}}};}
export function parseBoundaries(raw,role){
 if(typeof raw!=="string")fail("Enter the "+role+" boundaries as numbers separated by spaces or commas.");
 const tokens=raw.trim()?raw.trim().split(/[\s,]+/):[];
 const result=tokens.map(t=>{if(!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(t))fail("Use finite decimal boundaries for "+role+".");const n=Number(t);if(!Number.isFinite(n))fail("Use finite boundaries for "+role+".");return n;});
 for(let i=1;i<result.length;i++)if(result[i]<=result[i-1])fail(role+" boundaries must increase strictly.");
 return result;
}
export function selectionFromDraft(draft,catalog){
 if(!object(draft)||!object(catalog))fail("Load the original project catalogue first.");
 if(!text(draft.title).trim()||!text(draft.reason).trim())fail("Give the design a title and a scientific reason.");
 if(!catalog.baselines.some(x=>x.id===draft.baseline_run_id))fail("Choose a retained original baseline run.");
 const restored=catalog.restorations.find(x=>x.id===draft.restoration_footprint_id);
 if(!restored)fail("Choose a retained original restoration footprint.");
 const strata=ROLES.filter(role=>draft.enabled?.[role]===true).map(role=>{
  const units=restored.scalars?.[role]?.units;
  if(typeof units!=="string"||!units)fail("This restoration has no prepared "+role+" units.");
  return {role,boundaries:parseBoundaries(draft.boundaries?.[role]??"",role),units};
 });
 for(const role of ["SLOPE","CONNECTIVITY"]){
  const row=draft.optional?.[role];if(!row?.enabled)continue;
  const source=(catalog.covariate_sources||[]).find(x=>exclusionKey(x)===row.source);
  if(!source||typeof source.units!=="string"||!source.units)fail("Choose an original aligned "+role+" source with declared units.");
  if(!text(row.definition).trim())fail("Describe what the selected "+role+" raster measures.");
  strata.push({role,units:source.units,boundaries:parseBoundaries(row.boundaries,role),definition:row.definition.trim(),source:{source_collection_id:source.source_collection_id,source_id:source.source_id,source_sha256:source.source_sha256}});
 }
 if(!strata.length)fail("Select at least one original covariate; add boundaries to constrain its interval.");
 const raw=text(draft.precipitation_caliper).trim(),caliper=raw===""?null:Number(raw);
 if(caliper!==null&&(!/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(raw)||!Number.isFinite(caliper)||caliper<0))fail("The precipitation threshold must be a finite nonnegative decimal or blank.");
 if(!/^[1-9]\d*$/.test(text(draft.max_working_bytes)))fail("Use a positive whole number of working-memory bytes.");
 const max=Number(draft.max_working_bytes);if(!Number.isSafeInteger(max))fail("The working-memory budget exceeds exact browser integer precision.");
 let exclusion=null;
 if(draft.exclusion_source){
  exclusion=catalog.exclusions.find(x=>exclusionKey(x)===draft.exclusion_source);
  if(!exclusion)fail("The chosen exclusion source is no longer in this project catalogue.");
  exclusion={source_collection_id:exclusion.source_collection_id,source_id:exclusion.source_id,source_sha256:exclusion.source_sha256};
 }
 return {schema:"upstate.multivariate-control-selection/v1",title:draft.title.trim(),reason:draft.reason.trim(),baseline_run_id:draft.baseline_run_id,restoration_footprint_id:draft.restoration_footprint_id,strata,precipitation_caliper:caliper,exclusion_source:exclusion,max_working_bytes:max};
}
export const exclusionKey=value=>[value.source_collection_id,value.source_id,value.source_sha256].join(":");
export function draftFromSelection(value){
 const d=blankDraft();for(const k of["title","reason","baseline_run_id","restoration_footprint_id"])d[k]=text(value[k]);
 for(const row of value.strata||[]){if(ROLES.includes(row.role)){d.enabled[row.role]=true;d.boundaries[row.role]=(row.boundaries||[]).join(", ");}else if(d.optional[row.role])d.optional[row.role]={enabled:true,source:exclusionKey(row.source),boundaries:(row.boundaries||[]).join(", "),definition:text(row.definition)};}
 d.precipitation_caliper=value.precipitation_caliper==null?"":String(value.precipitation_caliper);
 d.max_working_bytes=String(value.max_working_bytes);d.exclusion_source=value.exclusion_source?exclusionKey(value.exclusion_source):"";return d;
}
export function emptyDesk(project){return {schema:SCHEMA,project_id:project,draft:blankDraft(),selected_id:null,requests:[]};}
export function validateDesk(value,project){
 if(!object(value)||value.schema!==SCHEMA||value.project_id!==project||!object(value.draft)||!Array.isArray(value.requests))fail("Choose a complete matched-control desk from this original project.");
 const d=value.draft;
 for(const key of Object.keys(blankDraft()).filter(x=>x!=="boundaries"&&x!=="optional"&&x!=="enabled"))if(typeof d[key]!=="string")fail("The saved draft is missing "+key+".");
 if(!object(d.boundaries)||ROLES.some(k=>typeof d.boundaries[k]!=="string"))fail("The saved draft is missing exact covariate boundaries.");
 if(!object(d.enabled)||ROLES.some(k=>typeof d.enabled[k]!=="boolean"))fail("Retain the selected prepared covariates.");
 for(const role of ["SLOPE","CONNECTIVITY"]){const row=d.optional?.[role];if(!object(row)||typeof row.enabled!=="boolean"||["source","boundaries","definition"].some(k=>typeof row[k]!=="string"))fail("Retain the complete optional "+role+" source choices.");}
 if(value.selected_id!==null&&(typeof value.selected_id!=="string"||!/^[a-f0-9]{64}$/.test(value.selected_id)))fail("The saved design identifier is incomplete.");
 const ids=new Map();
 for(const r of value.requests){
  if(!object(r)||!object(r.body)||typeof r.body.workspace!=="string"||!r.body.workspace||!/^control\.(prepare|adopt|execute)$/.test(r.body.action)||!/^[A-Za-z0-9_-]{16,100}$/.test(r.body.operation_id)||!object(r.body.payload))fail("Retain each original complete native operation.");
  if(r.signature!==canonical({workspace:r.body.workspace,action:r.body.action,payload:r.body.payload}))fail("A saved request differs from its immutable original choices.");
  if(ids.has(r.body.operation_id)&&ids.get(r.body.operation_id)!==canonical(r.body))fail("A retained operation identity has conflicting requests.");
  ids.set(r.body.operation_id,canonical(r.body));
  if(r.task_id!=null&&(typeof r.task_id!=="string"||!/^[a-f0-9]{64}$/.test(r.task_id)))fail("The retained native task identifier is incomplete.");
 }
 return clone(value);
}
export function prepareRequest(desk,workspace,action,payload,operationID){
 const signature=canonical({workspace,action,payload});
 const retained=desk.requests.find(r=>r.signature===signature);
 if(retained)return {desk:clone(desk),request:clone(retained)};
 const request={signature,body:{workspace,action,payload:clone(payload),operation_id:operationID},task_id:null};
 const next=clone(desk);next.requests.push(request);validateDesk(next,desk.project_id);return {desk:next,request};
}
export function retainReceipt(desk,operationID,task){
 const next=clone(desk),request=next.requests.find(x=>x.body.operation_id===operationID);
 if(!request||!task||typeof task.id!=="string"||!/^[a-f0-9]{64}$/.test(task.id))fail("The native operation receipt is incomplete.");
 if(request.task_id&&request.task_id!==task.id)fail("The original operation returned a different task identity.");
 request.task_id=task.id;return validateDesk(next,desk.project_id);
}
export function persistDesk(storage,key,desk){
 const exact=JSON.stringify(validateDesk(desk,desk.project_id));
 storage.setItem(key,exact);if(storage.getItem(key)!==exact)fail("Save the complete matched-control work before starting a native operation.");
 return desk;
}
export const describeState=state=>({
 prepared:"Control design prepared",infeasible:"Treatment support or eligible controls are incomplete",
 threshold_not_met:"Computed match exceeds the selected runoff-proxy threshold",
 ready:"Sources bound; ready for matching",existing:"Original design already retained"
}[state]||String(state||"Awaiting preparation"));
export function numeric(value){if(typeof value!=="number"||!Number.isFinite(value))return value==null?"—":String(value);const magnitude=Math.abs(value);return magnitude!==0&&(magnitude<0.000001||magnitude>=1000000000)?value.toExponential(6):value.toLocaleString(undefined,{maximumSignificantDigits:9});}
