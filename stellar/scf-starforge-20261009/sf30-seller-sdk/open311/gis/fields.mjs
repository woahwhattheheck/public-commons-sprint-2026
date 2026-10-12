// MIT. Standard file columns and explicit analyst-editable fields.
import { canonical, copy, fail, object, text } from './shared.mjs';
export const OPERATOR_COLUMNS = Object.freeze({assigned_team:'assignedTeam',asset_id:'assetId',work_order_id:'workOrderId',priority:'priority',action:'action',due_date:'dueDate',analyst_note:'note'});
export const OPERATOR_FIELDS = Object.freeze(Object.values(OPERATOR_COLUMNS));
export const EMPTY_OPERATOR = Object.freeze({assignedTeam:'',assetId:'',workOrderId:'',priority:'',action:'review',dueDate:'',note:''});
export const SOURCE_COLUMNS = Object.freeze(['feature_key','handoff_id','handoff_sha256','source_key','source_id','source_sha256','service_request_id','capture_id','collection_id','source_observed_at','source_status','source_service_code','source_service_name','source_address','source_description','source_agency','source_requested_at','source_updated_at','source_status_notes','source_closed_at','source_latitude','source_longitude','source_projected_x','source_projected_y','source_geometry_state','source_json','source_review_json','report_context_json']);
export const FILE_COLUMNS = Object.freeze([...SOURCE_COLUMNS,...Object.keys(OPERATOR_COLUMNS)]);
export const columnText = value => value==null?'':typeof value==='object'?canonical(value):String(value);
export function normalizeOperator(input = {}) {
  object(input,'Analyst fields');
  if(Object.keys(input).some(key=>!OPERATOR_FIELDS.includes(key)))fail('UNKNOWN_ANALYST_FIELD','An analyst field is not supported.');
  const value={...EMPTY_OPERATOR,...copy(input)};
  for(const key of OPERATOR_FIELDS)text(value[key],key,key==='note'?20000:500,{empty:true});
  if(!['review','dispatch','defer','dismiss'].includes(value.action))fail('INVALID_ANALYST_ACTION','Choose review, dispatch, defer or dismiss.');
  if(value.dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(value.dueDate)||!Number.isFinite(Date.parse(value.dueDate+'T00:00:00Z'))||new Date(value.dueDate+'T00:00:00Z').toISOString().slice(0,10)!==value.dueDate))fail('INVALID_DUE_DATE','Use a real YYYY-MM-DD date or an empty due date.');
  return value;
}
export function numericCoordinate(value) {
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  if(typeof value!=='string'||!value.trim()||! /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()))return null;
  const result=Number(value);return Number.isFinite(result)?result:null;
}
export function normalizeGeometry(geometry) {
  if(geometry===null)return null;
  object(geometry,'Geometry');
  if(geometry.type!=='Point'||!Array.isArray(geometry.coordinates)||geometry.coordinates.length!==2||geometry.coordinates.some(v=>typeof v!=='number'||!Number.isFinite(v)))fail('INVALID_GEOMETRY','Use a two-dimensional WGS84 Point or NULL geometry.');
  const [longitude,latitude]=geometry.coordinates;
  if(longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90)fail('INVALID_GEOMETRY','Longitude must be −180…180 and latitude −90…90.');
  return {type:'Point',coordinates:[Object.is(longitude,-0)?0:longitude,Object.is(latitude,-0)?0:latitude]};
}
export function sourceGeometry(source) {
  const missing=value=>value===null||value===undefined||typeof value==='string'&&!value.trim();
  const lat=source.lat,long=source.long;
  if(missing(lat)||missing(long))return {geometry:null,geometryStatus:'MISSING_COORDINATES'};
  const latitude=numericCoordinate(lat),longitude=numericCoordinate(long);
  if(latitude===null||longitude===null||latitude < -90||latitude > 90||longitude < -180||longitude > 180)return {geometry:null,geometryStatus:'INVALID_COORDINATES'};
  return {geometry:{type:'Point',coordinates:[longitude,latitude]},geometryStatus:'SOURCE_POINT'};
}
export function flatRow(handoff,row) {
  const s=row.source;
  const out={
    feature_key:row.key,handoff_id:handoff.id,handoff_sha256:handoff.sha256,
    source_key:row.sourceKey,source_id:row.sourceId,source_sha256:row.sourceSha256,service_request_id:row.serviceRequestId,
    capture_id:row.captureId,collection_id:row.collectionId,source_observed_at:row.observedAt,
    source_status:row.sourceStatus,source_service_code:row.serviceCode,source_service_name:row.serviceName,
    source_address:row.address,source_description:row.description,source_agency:row.agency,
    source_requested_at:row.requestedAt,source_updated_at:row.updatedAt,source_status_notes:row.sourceStatusNotes,source_closed_at:row.sourceClosedAt,
    source_latitude:s.lat,source_longitude:s.long,source_projected_x:s.x,source_projected_y:s.y,
    source_geometry_state:row.geometryStatus,source_json:s,source_review_json:row.sourceReview,report_context_json:row.reportContext
  };
  for(const [column,field] of Object.entries(OPERATOR_COLUMNS))out[column]=row.operator[field];
  return Object.fromEntries(FILE_COLUMNS.map(key=>[key,columnText(out[key])]));
}
export function operatorFromFlat(properties) { return normalizeOperator(Object.fromEntries(Object.entries(OPERATOR_COLUMNS).map(([column,field])=>[field,properties[column]]))); }
export const editableRow = row => ({geometry:copy(row.geometry),operator:copy(row.operator)});
