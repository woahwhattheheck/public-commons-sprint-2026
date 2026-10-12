// MIT. Declarative field contracts for retained OpenAlex editions.
import {ResearchError,canonical,safeId} from '../workspace.mjs';
import {digest} from '../../node/store.mjs';

export const CONTRACT_SCHEMA='stellar-forge.research-feed-contract.v1';
export const check=(ok,code,message=code,status=400)=>{if(!ok)throw new ResearchError(code,message,status);};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const own=(v,k)=>Object.hasOwn(v,k);
export const TYPES=['string','number','integer','boolean','array','object','date','uri','any'];
export const TRANSFORMS=['identity','trim','doi-key','flatten','enum'];
export function jsonValue(value){
  check(value!==undefined,'FEED_JSON_VALUE_REQUIRED');
  const text=JSON.stringify(value,(_k,v)=>{check(v!==undefined&&typeof v!=='bigint'&&typeof v!=='function'&&typeof v!=='symbol'&&(typeof v!=='number'||Number.isFinite(v)),'FEED_JSON_VALUE_REQUIRED');return v;});
  check(text.length<=1048576,'FEED_VALUE_TOO_LARGE');return JSON.parse(text);
}
export function normalizeContract(input){
  check(object(input),'FEED_CONTRACT_REQUIRED');safeId(input.id);
  check(typeof input.label==='string'&&input.label.trim().length>0&&input.label.length<=200,'FEED_LABEL_REQUIRED');
  const selection=input.selection??'all';check(['all','included'].includes(selection),'FEED_SELECTION_INVALID');
  check(Array.isArray(input.fields)&&input.fields.length>0&&input.fields.length<=100,'FEED_FIELDS_REQUIRED');
  const seen=new Set(),fields=input.fields.map(f=>{
    check(object(f)&&typeof f.target==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(f.target)&&!['__proto__','prototype','constructor'].includes(f.target)&&!seen.has(f.target),'FEED_TARGET_INVALID','Target names must be distinct plain column names.');seen.add(f.target);
    check(typeof f.source==='string'&&f.source.startsWith('/')&&f.source.length<=500&&!/~(?![01])/u.test(f.source),'FEED_SOURCE_POINTER_INVALID','Source fields use JSON Pointer, with * for array elements.');
    const type=f.type??'any',transform=f.transform??'identity';check(TYPES.includes(type)&&TRANSFORMS.includes(transform),'FEED_FIELD_RULE_INVALID');
    const missing=f.missing??'omit';check(['omit','null'].includes(missing),'FEED_MISSING_RULE_INVALID');
    check(f.required===undefined||typeof f.required==='boolean','FEED_REQUIRED_INVALID');check(f.nullable===undefined||typeof f.nullable==='boolean','FEED_NULLABLE_INVALID');
    const field={target:f.target,source:f.source,type,transform,required:f.required??false,nullable:f.nullable??true,missing};
    if(transform==='enum'){
      check(object(f.values)&&Object.keys(f.values).length>0&&Object.keys(f.values).length<=500,'FEED_ENUM_REQUIRED');field.values=jsonValue(f.values);
    }
    if(f.description!==undefined){check(typeof f.description==='string'&&f.description.length<=2000,'FEED_DESCRIPTION_INVALID');field.description=f.description;}
    return field;
  });
  const identityField=input.identityField??'work_id',identity=fields.find(f=>f.target===identityField);
  check(identity?.source==='/id'&&identity.transform==='identity'&&identity.required&&!identity.nullable&&['string','uri'].includes(identity.type),'FEED_IDENTITY_REQUIRED','Choose a required, non-null identity field mapped directly from /id.');
  check(input.allowPartial===undefined||typeof input.allowPartial==='boolean','FEED_PARTIAL_RULE_INVALID');
  return {schema:CONTRACT_SCHEMA,id:input.id,label:input.label.trim(),entity:'works',identityField,selection,allowPartial:input.allowPartial??false,fields};
}
export const contractHash=contract=>digest(canonical(normalizeContract(contract)));
export function readPointer(record,pointer){
  const keys=pointer.slice(1).split('/').map(k=>k.replace(/~1/g,'/').replace(/~0/g,'~'));
  function at(value,index){
    if(index===keys.length)return {present:true,value};
    const key=keys[index];
    if(key==='*'){
      if(!Array.isArray(value))return {present:false};
      const found=value.map(item=>at(item,index+1));
      // Keep explicit nulls and element order; absent elements remain visible as null.
      return {present:true,value:found.map(item=>item.present?item.value:null),missingElements:found.filter(item=>!item.present).length};
    }
    if(value===null||typeof value!=='object'||!own(value,key))return {present:false};
    return at(value[key],index+1);
  }
  return at(record,0);
}
export function applyTransform(raw,field){
  if(raw===null||field.transform==='identity')return {value:raw};
  if(field.transform==='trim')return typeof raw==='string'?{value:raw.trim()}:{error:'TRANSFORM_TYPE'};
  if(field.transform==='doi-key'){
    if(typeof raw!=='string')return {error:'TRANSFORM_TYPE'};
    const value=raw.trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i,'').toLowerCase();
    return /^10\.\d{4,9}\/\S+$/u.test(value)?{value}:{error:'DOI_FORMAT'};
  }
  if(field.transform==='flatten')return Array.isArray(raw)?{value:raw.flat(1)}:{error:'TRANSFORM_TYPE'};
  if(field.transform==='enum')return (typeof raw==='string'||typeof raw==='number'||typeof raw==='boolean')&&own(field.values,String(raw))?{value:field.values[String(raw)]}:{error:'UNMAPPED_VALUE'};
  return {error:'TRANSFORM_UNKNOWN'};
}
export function valueError(value,field){
  if(value===null)return field.nullable?null:'NULL_NOT_ALLOWED';
  if(typeof value==='string'&&field.required&&!value.trim())return 'EMPTY_REQUIRED_VALUE';
  switch(field.type){
    case 'any':return null;
    case 'string':return typeof value==='string'?null:'TYPE_STRING';
    case 'number':return typeof value==='number'&&Number.isFinite(value)?null:'TYPE_NUMBER';
    case 'integer':return Number.isSafeInteger(value)?null:'TYPE_INTEGER';
    case 'boolean':return typeof value==='boolean'?null:'TYPE_BOOLEAN';
    case 'array':return Array.isArray(value)?null:'TYPE_ARRAY';
    case 'object':return object(value)?null:'TYPE_OBJECT';
    case 'date':return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value?null:'TYPE_DATE';
    case 'uri':try{const u=new URL(value);return typeof value==='string'&&['http:','https:'].includes(u.protocol)?null:'TYPE_URI';}catch{return 'TYPE_URI';}
  }
}
export function defaultContract(id='openalex-metadata'){
  const field=(target,source,type,extra={})=>({target,source,type,transform:'identity',required:false,nullable:true,missing:'omit',...extra});
  return normalizeContract({id,label:'OpenAlex scholarly metadata',identityField:'work_id',selection:'all',allowPartial:false,fields:[
    field('work_id','/id','uri',{required:true,nullable:false}),
    field('doi','/doi','uri'),field('doi_key','/doi','string',{transform:'doi-key'}),
    field('title','/display_name','string',{required:true,nullable:false}),
    field('publication_date','/publication_date','date'),field('publication_year','/publication_year','integer'),
    field('work_type','/type','string'),field('work_type_source','/type','string'),field('language','/language','string'),
    field('authorships','/authorships','array'),field('authors','/authorships/*/author','array'),
    field('institutions','/authorships/*/institutions','array',{transform:'flatten'}),
    field('venue','/primary_location/source','object'),field('landing_page_url','/primary_location/landing_page_url','uri'),
    field('primary_location','/primary_location','object'),field('open_access','/open_access','object'),
    field('primary_topic','/primary_topic','object'),field('topics','/topics','array'),field('keywords','/keywords','array'),
    field('cited_by_count','/cited_by_count','integer'),field('is_retracted','/is_retracted','boolean'),
  ]});
}
