// MIT. Original reviewed dispatch intake for the municipal field desk.
import { canonical, copy, digest, fail, object, text, parseJson, seal, verifySeal, instant, MAX_PACKAGE_BYTES, MAX_ROWS } from '../gis/shared.mjs';
import { validateWorkspacePackage as validateFollowThroughWorkspace } from '../follow-through/workspace.mjs';

export const SOURCE_SCHEMA='commons.open311.field-source.v1';
export const FOLLOW_DISPATCH_SCHEMA='commons.open311.follow-through-dispatch.v1';
export const FOLLOW_WORKSPACE_SCHEMA='commons.open311.follow-through-workspace.v1';
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function record(value,name){
  object(value,name);text(value.key,name+' key',500);
  if(!hash(value.sourceSha256)||digest(value.original)!==value.sourceSha256)fail('ORIGINAL_ROW_MISMATCH',name+' does not match its complete original municipal object.');
}
export function validateDispatch(value){
  const dispatch=verifySeal(value,FOLLOW_DISPATCH_SCHEMA);
  for(const key of ['id','name','editionId','seriesId'])text(dispatch[key],'Dispatch '+key,500);
  instant(dispatch.createdAt,'Dispatch creation time');
  if(!hash(dispatch.editionSha256)||!Array.isArray(dispatch.rows)||dispatch.rows.length>MAX_ROWS)fail('INVALID_DISPATCH','The dispatch needs its complete edition identity and original row array.');
  object(dispatch.definition,'Original dispatch definition');
  if(dispatch.definition.editionId!==dispatch.editionId||!Array.isArray(dispatch.definition.workIds)||!Array.isArray(dispatch.definition.columns))fail('DISPATCH_DEFINITION_MISMATCH','The original dispatch selection is missing or refers to another edition.');
  const keys=new Set(),workIds=new Set();
  for(const row of dispatch.rows){
    object(row,'Dispatch row');record(row.request,'Original request');
    if(keys.has(row.key)||row.key!==row.request.key||row.serviceRequestId!==row.request.serviceRequestId||row.sourceSha256!==row.request.sourceSha256)fail('DISPATCH_REQUEST_MISMATCH','A dispatch repeats or changes an original request identity.');
    keys.add(row.key);if(!Array.isArray(row.orders))fail('INVALID_DISPATCH_ORDERS','Original orders must be a complete array.');
    const orderKeys=new Set();
    for(const order of row.orders){record(order,'Original work order');if(orderKeys.has(order.key))fail('DUPLICATE_DISPATCH_ORDER','The dispatch repeats an original order.');orderKeys.add(order.key);}
    const work=verifySeal(row.work,'commons.open311.follow-through-work.v1');
    if(workIds.has(work.id)||work.key!==row.key||work.sourceSha256!==row.sourceSha256||work.serviceRequestId!==row.serviceRequestId||work.seriesId!==dispatch.seriesId||work.approval!=='approved')fail('DISPATCH_WORK_MISMATCH','The approved work record does not bind this original dispatch request and edition.');
    // Follow-through carries approved work across editions while its original request/order versions match.
    text(work.editionId,'Original approved-work edition',500);
    workIds.add(work.id);
    if(!Array.isArray(work.targetOrders)||!Array.isArray(work.targetOrderKeys)||work.targetOrders.length!==row.orders.length||work.targetOrderKeys.length!==row.orders.length)fail('DISPATCH_RELATIONSHIP_MISMATCH','The original approved target-order selection is incomplete.');
    for(const target of work.targetOrders){const order=row.orders.find(o=>o.key===target.key);if(!order||order.sourceSha256!==target.sourceSha256||order.workOrderId!==target.workOrderId||!work.targetOrderKeys.includes(target.key))fail('DISPATCH_RELATIONSHIP_MISMATCH','An approved order version differs from its retained original order.');}
    if(!work.approvalSource||work.approvalSource.editionId!==work.editionId||work.approvalSource.sourceSha256!==row.sourceSha256)fail('DISPATCH_APPROVAL_MISMATCH','The approved action needs its original edition and request version.');
    if(!Array.isArray(work.approvalSource.orderVersions)||work.approvalSource.orderVersions.length!==row.orders.length)fail('DISPATCH_APPROVAL_MISMATCH','The approved order-version list is incomplete.');
    for(const order of row.orders)if(!work.approvalSource.orderVersions.some(v=>v.key===order.key&&v.sourceSha256===order.sourceSha256))fail('DISPATCH_APPROVAL_MISMATCH','An original order version is outside this action approval.');
    object(row.mapped,'Original mapped dispatch columns');
  }
  if(dispatch.definition.workIds.length!==workIds.size||dispatch.definition.workIds.some(id=>!workIds.has(id))||new Set(dispatch.definition.workIds).size!==workIds.size)fail('DISPATCH_SELECTION_MISMATCH','The complete dispatch rows must equal the explicit original work selection.');
  if(dispatch.totals?.actions!==dispatch.rows.length)fail('DISPATCH_TOTAL_MISMATCH','The dispatch action count differs from its rows.');
  return dispatch;
}
function decode(originalText,dispatchId){
  if(typeof originalText!=='string'||Buffer.byteLength(originalText)>MAX_PACKAGE_BYTES)fail('SOURCE_SIZE','Use a complete dispatch or follow-through workspace of at most 256 MiB.',413);
  const parsed=parseJson(originalText,'Original reviewed dispatch or workspace');
  if(parsed.schema===FOLLOW_DISPATCH_SCHEMA){
    const dispatch=validateDispatch(parsed);
    if(dispatchId!==undefined&&dispatchId!==null&&dispatchId!==dispatch.id)fail('DISPATCH_NOT_FOUND','The selected dispatch is not in this original file.',404);
    return {kind:'dispatch',origin:null,dispatches:[dispatch],selected:dispatch,workspace:null};
  }
  if(parsed.schema!==FOLLOW_WORKSPACE_SCHEMA)fail('SOURCE_SCHEMA','Use an original follow-through dispatch JSON or complete follow-through workspace JSON.');
  const workspace=validateFollowThroughWorkspace(originalText),dispatches=workspace.records.filter(r=>r.kind==='dispatch').map(r=>validateDispatch(r.value));
  if(!dispatches.length)fail('DISPATCH_REQUIRED','The original workspace has no saved reviewed dispatch. Create its explicit dispatch before preparing crew visits.');
  let selected=dispatchId?dispatches.find(d=>d.id===dispatchId):dispatches.length===1?dispatches[0]:null;
  if(dispatchId&&!selected)fail('DISPATCH_NOT_FOUND','The selected dispatch is not in this original workspace.',404,{dispatchId});
  return {kind:'workspace',origin:{workspaceId:workspace.workspaceId,revision:workspace.revision},dispatches,selected,workspace};
}
export function inspectSource(originalText,{dispatchId}={}){
  const decoded=decode(originalText,dispatchId);
  return {schema:decoded.kind==='workspace'?FOLLOW_WORKSPACE_SCHEMA:FOLLOW_DISPATCH_SCHEMA,kind:decoded.kind,origin:decoded.origin,originalFile:{bytes:Buffer.byteLength(originalText),sha256:digest(originalText)},
    dispatches:decoded.dispatches.map(d=>({id:d.id,name:d.name,seriesId:d.seriesId,editionId:d.editionId,rows:d.rows.length,sha256:d.sha256,createdAt:d.createdAt})),
    requiresSelection:!decoded.selected,selectedDispatchId:decoded.selected?.id??null};
}
export function createSource(input,identity){
  text(input.name,'Source name',300);
  const decoded=decode(input.originalText,input.dispatchId);
  if(!decoded.selected)fail('DISPATCH_SELECTION_REQUIRED','Choose one original saved dispatch from the complete workspace.',409,{dispatchIds:decoded.dispatches.map(d=>d.id)});
  const dispatch=decoded.selected;
  return seal({schema:SOURCE_SCHEMA,id:identity.id,name:input.name,kind:decoded.kind,seriesId:dispatch.seriesId,dispatchId:dispatch.id,dispatchSha256:dispatch.sha256,editionId:dispatch.editionId,editionSha256:dispatch.editionSha256,
    originWorkspaceId:decoded.origin?.workspaceId??null,originRevision:decoded.origin?.revision??null,createdAt:identity.createdAt,
    rows:dispatch.rows.length,originalFile:{filename:decoded.kind==='workspace'?'original-follow-through-workspace.json':'original-reviewed-dispatch.json',contentType:'application/json; charset=utf-8',bytes:Buffer.byteLength(input.originalText),sha256:digest(input.originalText)},
    originalText:input.originalText,dispatch,options:{name:input.name,dispatchId:dispatch.id}});
}
export function sourceSummary(source){
  const {id,name,kind,seriesId,dispatchId,dispatchSha256,editionId,editionSha256,originWorkspaceId,originRevision,createdAt,rows,originalFile,sha256}=source;
  return copy({id,name,kind,seriesId,dispatchId,dispatchSha256,editionId,editionSha256,originWorkspaceId,originRevision,createdAt,rows,originalFile,sha256});
}
export function sourceDetail(source){return {source:sourceSummary(source),dispatch:copy(source.dispatch),origin:source.originWorkspaceId?{workspaceId:source.originWorkspaceId,revision:source.originRevision}:null,originalFile:copy(source.originalFile)};}
export function sourceRow(source,key){
  text(key,'Original dispatch row key',500);
  const row=source.dispatch.rows.find(value=>value.key===key);
  if(!row)fail('SOURCE_ROW_NOT_FOUND','The selected original request is not in this saved dispatch.',404,{sourceId:source.id,key});
  return copy(row);
}
export function sourceRows(source,{q=''}={}){
  if(typeof q!=='string')fail('INVALID_SEARCH','Search must be text.');
  const terms=q.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return source.dispatch.rows.filter(row=>{
    const haystack=[row.serviceRequestId,row.request.title,row.request.description,row.request.sourceStatus,row.work.action,row.work.assignee,...row.orders.map(o=>o.workOrderId)].map(v=>typeof v==='string'?v:canonical(v??null)).join(' ').toLocaleLowerCase();
    return terms.every(term=>haystack.includes(term));
  }).map(copy);
}
export function rowBinding(source,row){
  return {sourceId:source.id,sourceSha256:source.sha256,seriesId:source.seriesId,dispatchId:source.dispatchId,dispatchSha256:source.dispatchSha256,editionId:source.editionId,editionSha256:source.editionSha256,
    sourceKey:row.key,serviceRequestId:row.serviceRequestId,requestSha256:row.sourceSha256,workId:row.work.id,workSha256:row.work.sha256,orders:row.orders.map(o=>({key:o.key,workOrderId:o.workOrderId,sourceSha256:o.sourceSha256})),rowSha256:digest(row)};
}
