// MIT. The original RFP dictionary and explicit, source-attributed revisions.
import {RFP} from '../spec.mjs';
import {createHash} from 'node:crypto';

export const CLASSES=Object.keys(RFP.classes);
export const ROLES={
  IMP_SURFACE_AOI:{FEAT_ID:'Integer',SURF_CLASS:'SmallInteger',AREA_SQFT:'Double'},
  IMP_SURFACE_PARCELS:{PARCEL_ID:['String','Integer','SmallInteger'],PARCEL_AREA_SQFT:'Double',IMP_AREA_SQFT:'Double',PERV_AREA_SQFT:'Double',IMP_PCT:'Double'},
  CONTOURS_1FT:{},LIDAR_FLIGHTLINES:{FLIGHTLINE_ID:'String'}
};
export const MILESTONES=[
  {id:'original_packet',section:'Procurement / addenda',title:'Current original City packet and addenda'},
  {id:'notice_to_proceed',section:'5.5',title:'Notice to proceed and dictionary due date'},
  {id:'dictionary_submission',section:'5.5',title:'Dictionary delivered within 30 calendar days of notice to proceed'},
  {id:'dictionary_approval',section:'5.5',title:'Written City dictionary approval before acquisition'},
  {id:'representative_sample',section:'5.5',title:'At least five representative records and City load validation'},
  {id:'approved_modifications',section:'5.5',title:'Written approval of any schema modifications'},
  {id:'physical_schema',section:'4.5 / 5.5',title:'Declared numeric precision and physical database storage review'},
  {id:'spatial_accuracy',section:'3–6',title:'Prime geospatial, datum, coverage and accuracy review'},
  {id:'billing_join',section:'4.5',title:'City-provided parcel and stormwater billing join'},
  {id:'delivery_inventory',section:'5.4.4',title:'SHA-256 file inventory, CSV and PDF'},
  {id:'city_qa_comments',section:'6',title:'City QA comments and requested corrections'},
  {id:'city_final_acceptance',section:'6',title:'City final acceptance correspondence'}
];
export const ARTIFACT_ROLES=[
  'original_bid_or_addendum','city_dictionary','city_correspondence','source_gis_context',
  'lidar','dem','contours','impervious_aoi','impervious_parcels','flightlines',
  'geodatabase','imagery','accuracy_report','metadata','delivery_other'
];
export function object(value,label='value'){
  if(!value||typeof value!=='object'||Array.isArray(value))throw fault(422,label+' must be an object.');
  return value;
}
export function fault(status,message){return Object.assign(new Error(message),{status});}
export function text(value,label,max=500,required=true){
  if(typeof value!=='string'||value.length>max||value.includes('\0')||(required&&!value.trim()))
    throw fault(422,'Enter '+label+' (up to '+max+' characters).');
  return value.trim();
}
export function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
export const digest=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:canonical(value)).digest('hex');
export function defaultDictionary(){
  return {schema:'midland.delivery-dictionary.v1',label:'RFP 27000010 published schema',
    expected_parcels:RFP.expected_parcels,classes:structuredClone(RFP.classes),
    semantic_fields:Object.fromEntries(CLASSES.map(c=>[c,Object.fromEntries(Object.keys(ROLES[c]).map(k=>[k,k]))]))};
}
export function compileDictionary(input){
  const value=object(input,'Dictionary');
  if(value.schema!=='midland.delivery-dictionary.v1')throw fault(422,'Unsupported dictionary format.');
  const label=text(value.label,'a dictionary label');
  if(!Number.isSafeInteger(value.expected_parcels)||value.expected_parcels<1||value.expected_parcels>100000000)
    throw fault(422,'Enter the documented full parcel population.');
  const classes=object(value.classes,'Dictionary classes'),semantics=object(value.semantic_fields,'Semantic field mappings');
  if(Object.keys(classes).sort().join('|')!==CLASSES.slice().sort().join('|'))throw fault(422,'The dictionary must define the four original feature classes.');
  const compiled={},mapped={};
  for(const name of CLASSES){
    const spec=object(classes[name],name);
    if(spec.geometry!==RFP.classes[name].geometry)throw fault(422,'Retain the specified geometry family for '+name+'.');
    if(!Array.isArray(spec.fields)||!spec.fields.length||spec.fields.length>2000)throw fault(422,'Supply the field definitions for '+name+'.');
    const fields=[],names=new Set();
    for(const item of spec.fields){
      const f=object(item,'Field'),key=text(f.name,'a field name',128);
      if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)||names.has(key))throw fault(422,'Field names must be distinct Esri identifiers.');
      names.add(key);
      if(!['OID','Geometry','String','Integer','SmallInteger','Double','Date'].includes(f.type)||typeof f.nullable!=='boolean')
        throw fault(422,'Supply an original Esri field type and explicit nullable value.');
      const out={name:key,type:f.type,nullable:f.nullable};
      if(f.type==='String'){
        if(!Number.isSafeInteger(f.length)||f.length<1||f.length>65535)throw fault(422,'Supply a valid text field width.');
        out.length=f.length;
      }
      if(f.precision!==undefined||f.scale!==undefined){
        if(f.type!=='Double'||!Number.isSafeInteger(f.precision)||f.precision<1||f.precision>1000||
            !Number.isSafeInteger(f.scale)||f.scale<0||f.scale>f.precision)
          throw fault(422,'Supply a valid declared Double precision and scale pair.');
        out.precision=f.precision;out.scale=f.scale;
      }
      if(f.domain!==undefined){
        if(!['String','Integer','SmallInteger','Double'].includes(f.type)||!Array.isArray(f.domain)||!f.domain.length||f.domain.length>2000||
          f.domain.some(v=>f.type==='String'?typeof v!=='string'||v.length>f.length:typeof v!=='number'||!Number.isFinite(v)||
          (f.type!=='Double'&&!Number.isSafeInteger(v))))throw fault(422,'The coded domain must match its field type.');
        if(new Set(f.domain.map(v=>canonical(v))).size!==f.domain.length)throw fault(422,'Remove duplicate domain values.');
        out.domain=structuredClone(f.domain);
      }
      fields.push(out);
    }
    if(fields.filter(f=>f.type==='OID').length!==1||fields.filter(f=>f.type==='Geometry').length!==1)
      throw fault(422,'Retain one OID and one geometry field per feature class.');
    const roles=object(semantics[name],name+' semantic fields');mapped[name]={};
    for(const [role,type] of Object.entries(ROLES[name])){
      const target=text(roles[role],'the '+role+' field',128),field=fields.find(f=>f.name===target);
      const allowed=Array.isArray(type)?type:[type];
      if(!field||!allowed.includes(field.type))throw fault(422,'The '+role+' mapping must select a '+allowed.join(' or ')+' field in '+name+'.');
      mapped[name][role]=target;
    }
    compiled[name]={geometry:spec.geometry,fields,...(RFP.classes[name].vertical_crs?{vertical_crs:RFP.classes[name].vertical_crs}:{})};
  }
  return {schema:value.schema,label,expected_parcels:value.expected_parcels,classes:compiled,semantic_fields:mapped};
}
export function stableRecordKey(featureClass,row,contract){
  if(!row||typeof row!=='object'||Array.isArray(row))return 'invalid';
  const key={IMP_SURFACE_AOI:'FEAT_ID',IMP_SURFACE_PARCELS:'PARCEL_ID',LIDAR_FLIGHTLINES:'FLIGHTLINE_ID'}[featureClass];
  const name=key&&(contract.semantic_fields?.[featureClass]?.[key]??key);
  return name&&row[name]!==undefined?name+':'+canonical(row[name]):'row:'+digest(row);
}
