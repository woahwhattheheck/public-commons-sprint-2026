/**
 * Complete portable working choices for the original Source Preparation desk.
 * TokenJunkieLabs. No native source, queue, task or scientific writer.
 */
export const DESK_SCHEMA='upstate.source-working-desk/v2';
export const DESK_FILE_BYTES=64*1024*1024;
export const deskCanonical=value=>{
 if(Array.isArray(value))return '['+value.map(deskCanonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+deskCanonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const need=(value,message)=>{if(!value)throw new Error(message);};
const copy=value=>JSON.parse(JSON.stringify(value));
const text=(value,label,empty=false)=>need(typeof value==='string'&&(empty||value.length>0),label+' must retain its original text.');
const equal=(a,b)=>deskCanonical(a)===deskCanonical(b);
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const safeKey=(value,label)=>{text(value,label);need(!['__proto__','prototype','constructor'].includes(value),label+' is not a safe working identity.');};
function jsonTree(value,seen=new Set()){
 need(value===null||['string','boolean','number','object'].includes(typeof value),'Working choices must contain complete JSON values.');
 if(typeof value==='number')need(Number.isFinite(value),'Working choices contain a non-finite number.');
 if(!value||typeof value!=='object')return;
 need(!seen.has(value),'Working choices contain a recursive object.');seen.add(value);
 for(const child of Array.isArray(value)?value:Object.values(value))jsonTree(child,seen);
 seen.delete(value);
}
export function deskByteLength(value){
 const text=typeof value==='string'?value:JSON.stringify(value,null,2)+'\n';
 let bytes=0;for(const char of text){const code=char.codePointAt(0);bytes+=code<=0x7f?1:code<=0x7ff?2:code<=0xffff?3:4;}return bytes;
}
function rows(value,label){need(Array.isArray(value),label+' must retain its complete list.');return value;}
function draft(value,label){
 need(object(value)&&object(value.inputs)&&object(value.options),label+' must retain its original inputs and options.');
 text(value.title,label+' title',true);
 if(value.import_sources!==undefined)need(typeof value.import_sources==='boolean',label+' import choice must be true or false.');
 if(value.numeric_text!==undefined){need(object(value.numeric_text),label+' unfinished numeric choices must be an object.');for(const [name,row]of Object.entries(value.numeric_text)){text(name,'Numeric option');need(object(row)&&typeof row.text==='string',label+' must retain the exact numeric text.');}}
 for(const [name,selector]of Object.entries(value.inputs)){
  text(name,'Input name');need(selector===null||(object(selector)&&Object.keys(selector).length>0),'Keep the complete original selector for '+name+'.');
 }
}
function uniqueIds(value,label){
 const found=new Map();for(const row of rows(value,label)){need(object(row),label+' contains an invalid record.');text(row.id,label+' identity');
  if(found.has(row.id))need(equal(found.get(row.id),row),'A retained '+label+' identity has conflicting complete records.');
  found.set(row.id,row);
 }return found;
}
function validateState(value,namespace,workspace,actions){
 need(object(value),'Keep the complete original desk state.');text(value.method,'Selected method',true);need(object(value.drafts),'Keep all original method drafts.');
 for(const [method,row]of Object.entries(value.drafts)){safeKey(method,'Method');draft(row,'Method '+method);}
 need(!value.method||own(value.drafts,value.method),'The selected method has no retained complete draft.');
 const merge=value.merge;need(object(merge),'Keep the combined-source selection.');text(merge.title,'Combined title',true);
 for(const kind of ['prepared','collections','registered']){const selected=rows(merge[kind],'Combined '+kind);for(const id of selected)text(id,'Combined '+kind+' identity');need(new Set(selected).size===selected.length,'Combined '+kind+' repeats an identity.');}
 if(merge.import_sources!==undefined)need(typeof merge.import_sources==='boolean','The combined import choice must be true or false.');
 if(merge.open!==undefined)need(typeof merge.open==='boolean','The composition disclosure state must be true or false.');
 need(value.task_id===null||typeof value.task_id==='string','Keep the original task selection.');
 need(object(value.operation_view),'Keep the operation view.');text(value.operation_view.query,'Operation search',true);
 need(['all','active','attention','complete'].includes(value.operation_view.status),'The original operation filter is invalid.');
 need(Number.isSafeInteger(value.operation_view.offset)&&value.operation_view.offset>=0,'The original operation page is invalid.');
 const keys=new Map();
 for(const row of uniqueIds(value.requests,'request').values()){
  text(row.key,'Original request body');text(row.at,'Original request time');
  let original;try{original=JSON.parse(row.key);}catch{throw new Error('An original request body is not complete JSON.');}
  need(object(original)&&original.workspace===workspace&&actions.includes(original.action)&&object(original.payload)&&deskCanonical(original)===row.key,'An original request does not belong to this desk and Workspace.');
  if(keys.has(row.key))need(keys.get(row.key)===row.id,'Two original requests name the same body. Keep their separate working files; do not select a replacement implicitly.');
  keys.set(row.key,row.id);
 }
 if(value.retired_requests!==undefined)for(const row of uniqueIds(value.retired_requests,'retired request').values()){
  text(row.key,'Retired original request body');text(row.at,'Retired original request time');
  let original;try{original=JSON.parse(row.key);}catch{throw new Error('A retired original request body is not complete JSON.');}
  need(object(original)&&original.workspace===workspace&&actions.includes(original.action)&&object(original.payload)&&deskCanonical(original)===row.key,'A retired original request differs from this desk.');
  need(!value.requests.some(active=>active.id===row.id),'A retired request cannot also be the active dispatch mapping.');
 }
 for(const row of uniqueIds(value.input_history,'working-input').values()){
  need(object(row.selection),'A previous original working selection is absent.');text(row.selection.method,'Previous method');draft(row.selection,'Previous method '+row.selection.method);
 }
 for(const row of uniqueIds(value.upload_receipts,'upload').values()){
  need(row.workspace===workspace,'An upload receipt belongs to another original Workspace.');
  for(const name of ['method','field','filename'])text(row[name],'Upload '+name);
  need(Number.isSafeInteger(row.bytes)&&row.bytes>=0,'The original uploaded byte count is invalid.');
  if(row.result!==undefined&&row.result!==null){need(object(row.result),'Keep the complete original upload receipt.');text(row.result.id,'Original upload identity');}
 }
}
function validateDescriptions(value){
 for(const row of rows(value,'Selected source descriptions')){need(object(row),'Keep every full selected-source description.');text(row.key,'Selected-source description identity');text(row.kind,'Selected-source kind');}
}
export function validateDeskFile(value,{namespace,workspaceKey,actions}={}){
 jsonTree(value);need(object(value)&&value.schema===DESK_SCHEMA,'Open a complete source-preparation working desk file.');
 text(value.namespace,'Source desk namespace');text(value.workspace_key,'Original Workspace');rows(value.actions,'Original desk actions');
 need(value.actions.length===2&&new Set(value.actions).size===2&&value.actions.every(x=>typeof x==='string'&&x),'Retain the two original preparation/composition actions.');
 if(namespace!==undefined)need(value.namespace===namespace,'Open this file in its original source desk.');
 if(workspaceKey!==undefined)need(value.workspace_key===workspaceKey,'Open this file in its original Workspace; receive its original sources before using another Workspace.');
 if(actions!==undefined)need(equal(value.actions,actions),'The installed source desk has another native action contract.');
 validateState(value.state,value.namespace,value.workspace_key,value.actions);validateDescriptions(value.source_descriptions);
 for(const row of uniqueIds(value.desk_history,'whole-desk history').values()){
  text(row.at,'Whole-desk history time');text(row.reason,'Whole-desk history reason');
  validateState(row.state,value.namespace,value.workspace_key,value.actions);validateDescriptions(row.source_descriptions);
 }
 for(const row of uniqueIds(value.import_history,'desk import').values()){
  text(row.at,'Import time');text(row.filename,'Original working filename');
  need(/^[a-f0-9]{64}$/.test(row.sha256),'Keep the exact imported file SHA256.');need(Number.isSafeInteger(row.bytes)&&row.bytes>0,'Keep the exact imported file bytes.');
 }
 const requestLedger=new Map();for(const state of [value.state,...value.desk_history.map(row=>row.state)])for(const row of [...state.requests,...(state.retired_requests||[])]){const previous=requestLedger.get(row.id);need(!previous||equal(previous,row),'An original request identity conflicts across whole-desk history.');requestLedger.set(row.id,row);}
 need(deskByteLength(value)<=DESK_FILE_BYTES,'The complete working file exceeds the supported 64 MiB UTF-8 capacity; keep its original file and current state.');
 return copy(value);
}
export function createDeskFile({namespace,workspaceKey,actions,state,sourceDescriptions=[],deskHistory=[],importHistory=[]}){
 return validateDeskFile({schema:DESK_SCHEMA,namespace,workspace_key:workspaceKey,actions:copy(actions),state:copy(state),
  source_descriptions:copy(sourceDescriptions),desk_history:copy(deskHistory),import_history:copy(importHistory)});
}
function mergeRequests(current,incoming,retired=[]){
 const all=current.map(copy),byId=new Map(current.map(row=>[row.id,row])),byKey=new Map(current.map(row=>[row.key,row]));
 for(const row of incoming){
  const sameId=byId.get(row.id);if(sameId)need(equal(sameId,row),'An imported original request identity names another complete request.');
  // A deliberate later local request remains the dispatch mapping. The whole
  // incoming request list is retained in the independent incoming snapshot.
  if(!sameId&&!byKey.has(row.key)&&!retired.some(previous=>previous.id===row.id)){all.push(copy(row));byId.set(row.id,row);byKey.set(row.key,row);}
 }return all;
}
function mergeRecords(current,incoming,label){
 const all=new Map(current.map(row=>[row.id,copy(row)]));
 for(const row of incoming){
  const before=all.get(row.id);
  if(before&&!equal(before,row)){
   if(label==='upload'){
    const stable=['id','workspace','method','field','filename','bytes','last_modified','at','selected_before'];
    need(stable.every(key=>equal(before[key],row[key])),'An imported upload identity conflicts with its original file.');
    need(!before.result||!row.result||equal(before.result,row.result),'An imported upload identity names another retained original.');
    // Prefer the actual local response/state when present, while preserving the
    // imported complete state inside its independent whole-desk history entry.
    if(!before.result&&row.result)all.set(row.id,copy(row));
    continue;
   }
   throw new Error('The imported '+label+' history conflicts with a retained original identity.');
  }
  if(!before)all.set(row.id,copy(row));
 }return [...all.values()];
}
export function prepareDeskImport(current,incoming,{id,at,filename,sha256,bytes}){
 current=validateDeskFile(current);incoming=validateDeskFile(incoming,{namespace:current.namespace,workspaceKey:current.workspace_key,actions:current.actions});
 text(id,'Import identity');text(at,'Import time');text(filename,'Original working filename');need(/^[a-f0-9]{64}$/.test(sha256)&&Number.isSafeInteger(bytes)&&bytes>0,'Retain the exact full imported file identity.');
 const next=copy(incoming),previous=copy(current.state);
 next.state.retired_requests=mergeRecords(current.state.retired_requests||[],incoming.state.retired_requests||[],'retired request').filter(row=>!current.state.requests.some(active=>active.id===row.id));
 next.state.requests=mergeRequests(current.state.requests,incoming.state.requests,next.state.retired_requests);
 next.state.upload_receipts=mergeRecords(current.state.upload_receipts,incoming.state.upload_receipts,'upload');
 next.state.input_history=mergeRecords(current.state.input_history,incoming.state.input_history,'working-input');
 next.desk_history=mergeRecords(current.desk_history,incoming.desk_history,'whole-desk');
 next.import_history=mergeRecords(current.import_history,incoming.import_history,'desk import');
 // Keep the actual local operation display. Imported task IDs remain in their
 // full original snapshot; selecting a working file never changes native work.
 next.state.task_id=current.state.task_id;
 next.state.operation_view=copy(current.state.operation_view);
 const originalAlreadyRetained=equal(incoming.state,current.state)&&equal(incoming.source_descriptions,current.source_descriptions)||current.desk_history.some(row=>equal(row.state,incoming.state)&&equal(row.source_descriptions,incoming.source_descriptions));
 if(originalAlreadyRetained&&equal(next.state,current.state)&&equal(next.desk_history,current.desk_history)&&equal(next.import_history,current.import_history)&&equal(next.source_descriptions,current.source_descriptions))return current;
 need(!next.desk_history.some(row=>row.id===id+':before'||row.id===id+':incoming')&&!next.import_history.some(row=>row.id===id),'Use one original import identity for this full working-file selection.');
 next.desk_history.push({id:id+':before',at,reason:'Before opening '+filename,state:previous,source_descriptions:copy(current.source_descriptions)},
  {id:id+':incoming',at,reason:'Complete original choices read from '+filename,state:copy(incoming.state),source_descriptions:copy(incoming.source_descriptions)});
 next.import_history.push({id,at,filename,sha256,bytes});
 return validateDeskFile(next);
}
export function restoreDeskHistory(current,id,{operationId,at}){
 current=validateDeskFile(current);const row=current.desk_history.find(item=>item.id===id);need(row,'Select an original complete desk history entry.');
 text(operationId,'Working restoration identity');text(at,'Working restoration time');
 const incoming={...current,state:copy(row.state),source_descriptions:copy(row.source_descriptions)};
 // This explicit local restore uses the same conflict rules as a file. Keep
 // every current native request/receipt and all independent full snapshots.
 incoming.state.retired_requests=mergeRecords(current.state.retired_requests||[],row.state.retired_requests||[],'retired request').filter(row=>!current.state.requests.some(active=>active.id===row.id));
 incoming.state.requests=mergeRequests(current.state.requests,row.state.requests,incoming.state.retired_requests);
 incoming.state.upload_receipts=mergeRecords(current.state.upload_receipts,row.state.upload_receipts,'upload');
 incoming.state.input_history=mergeRecords(current.state.input_history,row.state.input_history,'working-input');
 incoming.state.task_id=current.state.task_id;incoming.state.operation_view=copy(current.state.operation_view);
 if(equal(incoming.state,current.state)&&equal(incoming.source_descriptions,current.source_descriptions))return current;
 need(!current.desk_history.some(item=>item.id===operationId),'The restoration identity is already retained.');
 incoming.desk_history.push({id:operationId,at,reason:'Before restoring '+row.reason,state:copy(current.state),source_descriptions:copy(current.source_descriptions)});
 return validateDeskFile(incoming);
}
function key(kind,value){return kind+':'+(typeof value==='string'?value:deskCanonical(value));}
export function reconcileDeskSources(file,{catalogue={},state={},operations=[]}={}){
 file=validateDeskFile(file);const result=[],descriptions=new Map(file.source_descriptions.map(row=>[row.key,row])),methods=Array.isArray(catalogue.methods)?catalogue.methods:[];
 const add=(kind,id,title,available,status,descriptor,extra={})=>{
  const identity=key(kind,id),prior=descriptions.get(identity);
  const row={key:identity,kind,id:copy(id),title:title||prior?.title||(typeof id==='string'?id:deskCanonical(id)),available,status,...extra};
  if(descriptor!==undefined)row.descriptor=copy(descriptor);
  else if(prior?.descriptor!==undefined)row.descriptor=copy(prior.descriptor);
  result.push(row);descriptions.set(identity,row);return row;
 };
 const sourceRows=Array.isArray(catalogue.sources)?catalogue.sources:[];
 for(const [methodId,value]of Object.entries(file.state.drafts)){
  const method=methods.find(row=>row.id===methodId);
  add('method',methodId,method?.title||methodId,Boolean(method),method?'Available':'Not installed',method);
  for(const [field,selector]of Object.entries(value.inputs)){
   if(!selector)continue;let descriptor,available=false,status='Not in current source catalogue';
   if(selector.collection_id&&selector.source_id){
    const row=sourceRows.find(item=>item.collection_id===selector.collection_id&&item.source_id===selector.source_id);
    descriptor=selector.companion_path?row?.companions?.find(item=>item.path===selector.companion_path):row;
    available=Boolean(descriptor);
   }else if(selector.upload_id){descriptor=catalogue.uploads?.find(row=>row.id===selector.upload_id);available=Boolean(descriptor);}
   else if(selector.builtin_id){descriptor=catalogue.bundled?.find(row=>row.id===selector.builtin_id);available=Boolean(descriptor)&&descriptor.available!==false;status='Original application source is unavailable';}
   else if(selector.root_id){descriptor=catalogue.roots?.find(row=>row.id===selector.root_id);available=Boolean(descriptor);status=available?'Host directory available; original file is checked when prepared':'Original host directory is unavailable';}
   if(available&&!selector.root_id)status='Available';
   const input=method?.inputs?.find(row=>row.name===field);
   add('input',{method:methodId,field,selector},descriptor?.title||descriptor?.label||descriptor?.name||selector.path||field,available,status,descriptor,{method:methodId,field,selected:methodId===file.state.method,selector:copy(selector),input_known:Boolean(input)});
  }
 }
 for(const kind of ['prepared','collections','registered'])for(const id of file.state.merge[kind]){
  const descriptor=kind==='prepared'?operations.find(row=>row.id===id):
   kind==='collections'?state.data?.sources?.find(row=>row.id===id):state.registered_sources?.find(row=>row.id===id);
  const available=Boolean(descriptor)&&(kind!=='prepared'||descriptor.state==='complete');
  add(kind,id,descriptor?.title||descriptor?.label||descriptor?.name||descriptor?.payload?.title,available,available?'Available':descriptor?'Original preparation is not complete':'Not in current source catalogue',descriptor);
 }
 return {rows:result,missing:result.filter(row=>!row.available),composition_missing:result.filter(row=>['prepared','collections','registered'].includes(row.kind)&&!row.available),
  source_descriptions:[...descriptions.values()]};
}
export function serializeDeskFile(value){return JSON.stringify(validateDeskFile(value),null,2)+'\n';}
