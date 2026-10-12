// MIT. Complete original municipal request and work-order source editions.
import { canonical, copy, digest, fail, object, text, instant, parseJson, now, entityId, seal, MAX_SOURCE_BYTES, MAX_ROWS } from '../gis/shared.mjs';

import { csvDecode } from './csv.mjs';

export const SOURCE_SCHEMA='commons.open311.follow-through-source.v1';
const RETAINED_SCHEMA='commons.arcgis.retained-source.v1';
function validTime(value,name){return value===undefined||value===null?null:instant(value,name);}
function originalFile(name,originalText,kind,sourceUrl=null,observedAt=null,id=null){
  return {id:id??entityId('file',{name,sha256:digest(originalText)}),name,kind,bytes:Buffer.byteLength(originalText),sha256:digest(originalText),sourceUrl,observedAt};
}
function decode(raw){
  object(raw,'Original capture bytes');
  if(raw.encoding!=='base64'||raw.complete!==true||typeof raw.body!=='string')fail('COMPLETE_CAPTURE_REQUIRED','Each retained capture must contain its complete original base64 body.');
  const bytes=Buffer.from(raw.body,'base64');
  if(bytes.toString('base64')!==raw.body||bytes.length!==raw.bytes||digest(bytes)!==raw.sha256)fail('ORIGINAL_CAPTURE_MISMATCH','The retained original capture bytes or SHA-256 do not match.');
  try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{fail('INVALID_UTF8','The original source body is not valid UTF-8.');}
}
function captureTime(value){if(typeof value!=='string')return null;const iso=value.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/,'$1T$2Z');return /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(iso)&&Number.isFinite(Date.parse(iso))?iso:null;}
function fieldsFor(value,metadata){
  const explicit=value.fields??metadata?.fields;
  const map=new Map((Array.isArray(explicit)?explicit:[]).filter(f=>f&&typeof f.name==='string').map(f=>[f.name,{...copy(f),name:f.name,type:f.type??'unknown',alias:f.alias??f.name}]));
  for(const feature of value.features??[]){const attributes=feature?.attributes??feature?.properties??{};for(const [name,item]of Object.entries(attributes)){if(!map.has(name))map.set(name,{name,type:item===null?'unknown':Array.isArray(item)?'array':typeof item,alias:name});}}
  return [...map.values()];
}
function layerAddress(value){
  try{const url=new URL(value),match=url.pathname.replace(/\/+$/,'').match(/^(.*\/(?:MapServer|FeatureServer))\/(\d+)(?:\/query)?$/i);
    return match?{service:url.origin+match[1],layerId:match[2],endpoint:url.origin+match[1]+'/'+match[2]}:null;}catch{return null;}
}
function serviceAddress(value){
  try{const url=new URL(value),match=url.pathname.replace(/\/+$/,'').match(/^(.*\/(?:MapServer|FeatureServer))(?:\/layers)?$/i);return match?url.origin+match[1]:null;}catch{return null;}
}
function automaticMetadata(decoded,selected){
  const target=layerAddress(selected[0].capture.receipt?.url);
  if(target){
    const direct=decoded.find(item=>Array.isArray(item.value.fields)&&!Array.isArray(item.value.features)&&layerAddress(item.capture.receipt?.url)?.endpoint===target.endpoint);
    if(direct)return direct.value;
    for(const item of decoded)if(serviceAddress(item.capture.receipt?.url)===target.service){
      const layer=[...(item.value.layers??[]),...(item.value.tables??[])].find(value=>String(value.id)===target.layerId&&Array.isArray(value.fields));
      if(layer)return layer;
    }
    return null;
  }
  const metadata=decoded.map(item=>item.value).filter(value=>Array.isArray(value.fields)&&!Array.isArray(value.features));
  return metadata.length===1?metadata[0]:null;
}
function originalSpatialReference(value,kind,metadata){
  if(value.spatialReference!==undefined)return copy(value.spatialReference);
  if(kind==='geojson')return Object.hasOwn(value,'crs')?{declaredGeoJsonCrs:copy(value.crs)}:{wkid:4326,source:'RFC7946'};
  return copy(metadata?.spatialReference??null);
}
function inferKind(value){
  if(value?.error)return 'arcgis';
  if(value?.type==='FeatureCollection'&&Array.isArray(value.features))return 'geojson';
  if(Array.isArray(value?.features))return 'arcgis';
  if(Array.isArray(value))return 'records';
  if(Array.isArray(value?.records))return 'records';
  if(value?.schema==='commons.open311.collection-export.v1')return 'open311-collection';
  if(value?.schema==='commons.open311.service-report.v1')return 'open311-report';
  fail('UNSUPPORTED_SOURCE','Choose a complete ArcGIS feature response, GeoJSON FeatureCollection, row array, Open311 collection or service report.');
}
function features(value,kind){
  if(kind==='records'||kind==='csv')return (Array.isArray(value)?value:value.records).map(attributes=>({attributes}));
  if(kind==='open311-collection'){
    const rows=value.rows??value.items??value.requests;
    if(!Array.isArray(rows))fail('COLLECTION_ROWS_REQUIRED','The complete collection export must contain its consolidated rows.');
    return rows.map(row=>({attributes:copy(row.source??row),geometry:row.longitude!==null&&row.latitude!==null&&Number.isFinite(row.longitude)&&Number.isFinite(row.latitude)?{x:row.longitude,y:row.latitude,spatialReference:{wkid:4326}}:null,open311:copy(row)}));
  }
  if(kind==='open311-report'){
    if(!Array.isArray(value.rows))fail('REPORT_ROWS_REQUIRED','The complete service report must contain its rows.');
    return value.rows.map(row=>({attributes:copy(row.source??row),geometry:row.source?.long!==null&&row.source?.lat!==null&&Number.isFinite(Number(row.source?.long))&&Number.isFinite(Number(row.source?.lat))?{x:Number(row.source.long),y:Number(row.source.lat),spatialReference:{wkid:4326}}:null,open311:copy(row)}));
  }
  return value.features??[];
}
function sourceError(value){return value?.error?{code:value.error.code??'SOURCE_ERROR',message:String(value.error.message??'The original source returned an error.'),details:copy(value.error.details??null)}:null;}
function parseSelected(originalText,options={}){
  if(typeof originalText!=='string'||Buffer.byteLength(originalText)>MAX_SOURCE_BYTES)fail('SOURCE_SIZE','Use one complete original source input of at most 128 MiB.',413);
  const csv=options.kind==='csv'||(!options.kind||options.kind==='auto')&&/\.csv$/i.test(options.name??'');
  const root=csv?csvDecode(originalText):parseJson(originalText,'Original municipal source'),files=[originalFile(options.name??'original-source.json',originalText,root?.schema===RETAINED_SCHEMA?'retained-packet':'source',options.sourceUrl??null,options.observedAt??null)];
  let selected=[],metadata=options.metadataText===undefined?null:parseJson(options.metadataText,'Original layer metadata'),availableCaptures=[];
  if(options.metadataText!==undefined){if(Buffer.byteLength(options.metadataText)>MAX_SOURCE_BYTES)fail('METADATA_SIZE','The original layer metadata exceeds 128 MiB.',413);files.push(originalFile('original-layer-metadata.json',options.metadataText,'metadata',null,null));}
  if(root.schema===RETAINED_SCHEMA){
    if(!Array.isArray(root.captures)||!root.captures.length)fail('CAPTURE_REQUIRED','The retained source packet has no original captures.');
    const decoded=root.captures.map(c=>{text(c.id,'Capture identity',200);const body=decode(c.raw),value=parseJson(body,'Original capture');return {capture:c,body,value};});
    if(new Set(decoded.map(c=>c.capture.id)).size!==decoded.length)fail('DUPLICATE_CAPTURE','The retained packet repeats a capture ID.');
    availableCaptures=decoded.filter(c=>Array.isArray(c.value?.features)||c.value?.error).map(c=>({id:c.capture.id,state:sourceError(c.value)?'source_error':'ready',rows:Array.isArray(c.value.features)?c.value.features.length:0,sourceUrl:c.capture.receipt?.url??null}));
    let ids=options.captureIds;
    if(ids===undefined){const ready=availableCaptures.filter(c=>c.state==='ready');if(ready.length===1)ids=[ready[0].id];else if(availableCaptures.length===1)ids=[availableCaptures[0].id];else return {root,files,metadata,selected:[],availableCaptures,selectionRequired:true};}
    if(Array.isArray(ids)&&ids.length===0)return {root,files,metadata,selected:[],availableCaptures,selectionRequired:true};
    if(!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)fail('CAPTURE_SELECTION_REQUIRED','Select distinct complete original capture IDs.');
    selected=ids.map(id=>{const found=decoded.find(c=>c.capture.id===id);if(!found)fail('CAPTURE_NOT_FOUND','An original selected capture was not found.',404,{id});return found;});
    const endpoints=new Set(selected.map(item=>layerAddress(item.capture.receipt?.url)?.endpoint).filter(Boolean));
    if(endpoints.size>1)fail('SOURCE_ENDPOINT_MISMATCH','Select original pages of one service and layer for a source edition.');
    if(!metadata)metadata=automaticMetadata(decoded,selected);
    for(const item of decoded)files.push(originalFile(item.capture.receipt?.provenance?.originalFilename??item.capture.id+'.json',item.body,item.capture.role??'capture',item.capture.receipt?.url??null,captureTime(item.capture.receipt?.observedAt),item.capture.id));
  }else selected=[{body:originalText,value:root,capture:{id:files[0].id,receipt:{url:options.sourceUrl??null,observedAt:options.observedAt??null}}}];
  return {root,files,metadata,selected,availableCaptures,selectionRequired:false};
}
export function inspectSource(originalText,options={}){
  const parsed=parseSelected(originalText,options),{selected,metadata}=parsed;
  if(parsed.selectionRequired)return {name:options.name??'Original source',kind:'arcgis-retained',role:options.role??null,state:'selection_required',rows:0,fields:[],spatialReference:null,coverage:{selectionRequired:true},originalFiles:parsed.files,error:null,availableCaptures:parsed.availableCaptures};
  let rows=0;const fieldMap=new Map(),pages=[],errors=[],kinds=new Set();
  for(const item of selected){
    const error=sourceError(item.value),kind=options.kind==='csv'||(!options.kind||options.kind==='auto')&&/\.csv$/i.test(options.name??'')?'csv':inferKind(item.value);kinds.add(kind);
    const list=error?[]:features(item.value,kind);if(!Array.isArray(list))fail('SOURCE_ROWS_REQUIRED','The original source rows must be an array.');
    rows+=list.length;if(rows>MAX_ROWS)fail('SOURCE_ROWS_LIMIT','One source edition can contain at most 100,000 original rows.',413);
    const effective={...item.value,features:list};for(const field of fieldsFor(effective,metadata))fieldMap.set(field.name,field);
    if(error)errors.push({captureId:item.capture.id,...error});
    let query={};try{query=Object.fromEntries(new URL(item.capture.receipt?.url??options.sourceUrl).searchParams);}catch{}
    pages.push({captureId:item.capture.id,rows:list.length,sha256:digest(item.body),sourceUrl:item.capture.receipt?.url??options.sourceUrl??null,observedAt:captureTime(item.capture.receipt?.observedAt),query,
      exceededTransferLimit:item.value.exceededTransferLimit??null,terminal:kind==='arcgis'&&!error?item.value.exceededTransferLimit!==true:null,state:error?'source_error':'ready'});
  }
  if(kinds.size>1)fail('SOURCE_KIND_MISMATCH','Select original pages of one source format.');
  const first=selected[0],kind=[...kinds][0],spatialReference=originalSpatialReference(first.value,kind,metadata);
  return {name:options.name??metadata?.name??'Original source',kind,role:options.role??null,state:errors.length?'source_error':'ready',rows,fields:[...fieldMap.values()],spatialReference,
    coverage:{scope:'Selected complete original files',pages,selectedCaptures:selected.map(c=>c.capture.id),hasSaturatedPage:pages.some(p=>p.exceededTransferLimit===true),terminal:pages.length?pages.at(-1).terminal:null,declaredMaxRecordCount:metadata?.maxRecordCount??null,sourcePopulation:'Only records returned by the saved original query or file are represented.'},
    originalFiles:parsed.files,error:errors[0]??null,errors,availableCaptures:parsed.availableCaptures,metadata:metadata?copy(metadata):null};
}
export function importSource(originalText,options={},identity={}){
  text(options.role,'Source role',20);if(!['requests','orders'].includes(options.role))fail('INVALID_SOURCE_ROLE','Source role must be requests or orders.');
  text(options.seriesId,'Source series ID',200);text(options.name??'Original source','Source name',300);
  instant(options.observedAt,'Source observation time');
  const inspected=inspectSource(originalText,options);if(inspected.state==='selection_required')fail('CAPTURE_SELECTION_REQUIRED','Select the original dataset captures before importing.',400,{availableCaptures:inspected.availableCaptures});
  const savedOptions={role:options.role,seriesId:options.seriesId,name:options.name??inspected.name,observedAt:options.observedAt};
  for(const key of ['sourceUrl','metadataText','captureIds','kind'])if(options[key]!==undefined)savedOptions[key]=copy(options[key]);
  const sourceId=entityId('source',{originalSha256:digest(originalText),options:savedOptions});
  return seal({schema:SOURCE_SCHEMA,id:sourceId,...inspected,name:savedOptions.name,seriesId:options.seriesId,role:options.role,observedAt:options.observedAt,createdAt:identity.createdAt??now(),options:savedOptions,originalText});
}
export function sourceSummary(source){const {id,name,seriesId,kind,role,observedAt,rows,sha256,coverage,createdAt,state}=source;return {id,name,seriesId,kind,role,observedAt,rows,sha256,coverage,createdAt,state};}
export function sourceDetail(source){const {originalText,options,metadata,...view}=source;return {...copy(view),metadata:metadata?copy(metadata):null};}
export function originalRows(source){
  const parsed=parseSelected(source.originalText,source.options),rows=[];let index=0;
  for(const item of parsed.selected){
    if(sourceError(item.value))continue;
    const kind=source.kind,sr=originalSpatialReference(item.value,kind,parsed.metadata);
    for(const raw of features(item.value,kind)){
      object(raw,'Original source record');
      const attributes=kind==='geojson'?(raw.properties??{}):(raw.attributes??raw.properties??{});object(attributes,'Original attributes');
      const geometry=raw.geometry??null,spatialReference=geometry?.spatialReference??(kind==='geojson'&&Object.hasOwn(geometry??{},'crs')?{declaredGeoJsonCrs:copy(geometry.crs)}:kind==='geojson'&&Object.hasOwn(raw,'crs')?{declaredGeoJsonCrs:copy(raw.crs)}:sr);
      rows.push({index:index++,captureId:item.capture.id,attributes:copy(attributes),geometry:copy(geometry),spatialReference:copy(spatialReference),sourceSha256:digest(raw),original:copy(raw)});
    }
  }
  return rows;
}
export function sourceOriginalFile(source,fileId){
  if(fileId===undefined||fileId===null||fileId===source.originalFiles[0].id)return {filename:source.originalFiles[0].name,body:source.originalText,contentType:source.kind==='csv'?'text/csv; charset=utf-8':source.kind==='geojson'?'application/geo+json; charset=utf-8':'application/json; charset=utf-8'};
  if(fileId===source.originalFiles.find(f=>f.kind==='metadata')?.id&&source.options.metadataText!==undefined)return {filename:'original-layer-metadata.json',body:source.options.metadataText,contentType:'application/json; charset=utf-8'};
  const parsed=source.kind==='csv'?null:parseJson(source.originalText);
  const capture=parsed?.schema===RETAINED_SCHEMA?parsed.captures.find(c=>c.id===fileId):null;
  if(!capture)fail('SOURCE_FILE_NOT_FOUND','The selected complete original source file was not found.',404);
  return {filename:source.originalFiles.find(f=>f.id===fileId)?.name??fileId+'.json',body:decode(capture.raw),contentType:'application/json; charset=utf-8'};
}
