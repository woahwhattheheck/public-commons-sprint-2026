/** Ordered native matched-control comparisons and recoverable original requests. */
import {canonical,clone,numeric} from "./multivariate_control_core.mjs";
export {canonical,clone,numeric};
export const SCHEMA="upstate.multivariate-control-outcome-desk/v1";
export const POLLUTANTS=["nitrogen_export","phosphorus_export","sediment_export"];
const object=x=>x&&typeof x==="object"&&!Array.isArray(x);
const fail=s=>{throw Error(s);};
const identifier=x=>typeof x==="string"&&/^[a-f0-9]{64}$/.test(x);
export function blankDraft(){return {title:"Matched-control native outcomes",reason:"",design_ids:[],pollutants:[],quantity_scope:"reporting"};}
export function emptyDesk(project){return {schema:SCHEMA,project_id:project,draft:blankDraft(),selected_id:null,requests:[]};}
export function validateDesk(value,project){
 if(!object(value)||value.schema!==SCHEMA||value.project_id!==project||!object(value.draft)||!Array.isArray(value.requests))fail("Choose a complete outcome desk from this original project.");
 const d=value.draft;
 if(typeof d.title!=="string"||typeof d.reason!=="string"||!Array.isArray(d.design_ids)||d.design_ids.some(x=>!identifier(x))||new Set(d.design_ids).size!==d.design_ids.length)fail("Retain each selected control design once, in its original order.");
 if(!Array.isArray(d.pollutants)||d.pollutants.some(x=>!POLLUTANTS.includes(x))||new Set(d.pollutants).size!==d.pollutants.length)fail("Retain the original selected pollutant outputs.");
 if(!["reporting","model_domain"].includes(d.quantity_scope))fail("Choose the original reporting area or model domain.");
 if(value.selected_id!==null&&!identifier(value.selected_id))fail("The retained outcome identifier is incomplete.");
 const ids=new Map();
 for(const r of value.requests){
  if(!object(r)||!object(r.body)||!object(r.body.payload)||typeof r.body.workspace!=="string"||!r.body.workspace||r.body.action!=="control.outcomes.prepare"||!/^[A-Za-z0-9_-]{16,100}$/.test(r.body.operation_id))fail("Retain each complete original outcome request.");
  if(r.signature!==canonical({workspace:r.body.workspace,action:r.body.action,payload:r.body.payload}))fail("A retained request differs from its original scientific choices.");
  if(ids.has(r.body.operation_id)&&ids.get(r.body.operation_id)!==canonical(r.body))fail("A saved operation identity has conflicting requests.");
  ids.set(r.body.operation_id,canonical(r.body));
  if(r.task_id!=null&&!identifier(r.task_id))fail("The original task receipt is incomplete.");
 }
 return clone(value);
}
export function selectionFromDraft(d,catalog){
 if(!object(d)||!object(catalog))fail("Load the original outcome catalogue first.");
 if(typeof d.title!=="string"||!d.title.trim()||typeof d.reason!=="string"||!d.reason.trim())fail("Give the comparison a title and scientific reason.");
 if(!Array.isArray(d.design_ids)||!d.design_ids.length||new Set(d.design_ids).size!==d.design_ids.length)fail("Choose each completed original control design once.");
 for(const id of d.design_ids){const row=catalog.designs.find(x=>x.id===id);if(!row)fail("A selected control design is no longer available in this project.");if(!row.ready)fail("Every selected control must have complete original native runs.");if(d.pollutants.some(p=>!row.pollutants.includes(p)))fail("A selected control lacks one of the chosen original native pollutant outputs.");}
 if(!Array.isArray(d.pollutants)||!d.pollutants.length||d.pollutants.some(x=>!POLLUTANTS.includes(x)))fail("Choose at least one original modeled pollutant.");
 if(!["reporting","model_domain"].includes(d.quantity_scope))fail("Choose the original quantity area.");
 return {schema:"upstate.multivariate-control-outcome-selection/v1",title:d.title.trim(),reason:d.reason.trim(),design_ids:[...d.design_ids],pollutants:POLLUTANTS.filter(x=>d.pollutants.includes(x)),quantity_scope:d.quantity_scope};
}
export function draftFromSelection(s){return {title:s.title,reason:s.reason,design_ids:[...s.design_ids],pollutants:[...s.pollutants],quantity_scope:s.quantity_scope};}
export function prepareRequest(desk,workspace,payload,operationID){
 const action="control.outcomes.prepare",signature=canonical({workspace,action,payload}),old=desk.requests.find(x=>x.signature===signature);
 if(old)return {desk:clone(desk),request:clone(old)};
 const request={signature,body:{workspace,action,payload:clone(payload),operation_id:operationID},task_id:null},next=clone(desk);next.requests.push(request);
 return {desk:validateDesk(next,desk.project_id),request};
}
export function retainReceipt(desk,operationID,task){
 const next=clone(desk),r=next.requests.find(x=>x.body.operation_id===operationID);
 if(!r||!identifier(task?.id))fail("The native outcome receipt is incomplete.");
 if(r.task_id&&r.task_id!==task.id)fail("The retained operation returned a different task identity.");
 r.task_id=task.id;return validateDesk(next,desk.project_id);
}
export function persistDesk(storage,key,desk){
 const exact=JSON.stringify(validateDesk(desk,desk.project_id));storage.setItem(key,exact);
 if(storage.getItem(key)!==exact)fail("Save the complete comparison choices before starting native analysis.");
 return desk;
}
export function mergeDesk(imported,current){
 const next=validateDesk(imported,current.project_id);
 for(const row of current.requests){
  const old=next.requests.find(x=>x.body.operation_id===row.body.operation_id);
  if(old){if(canonical(old.body)!==canonical(row.body)||old.task_id&&row.task_id&&old.task_id!==row.task_id)fail("Imported original request conflicts with this desk.");old.task_id=old.task_id||row.task_id;}
  else next.requests.push(clone(row));
 }
 return validateDesk(next,current.project_id);
}
