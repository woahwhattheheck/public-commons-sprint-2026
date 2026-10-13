// MIT. Complete original JSON sources with explicit RFC 6901 row selection.
import { copy,digest,fail,object,text,parseJson,entityId,seal,page,MAX_PACKAGE_BYTES,MAX_ROWS } from '../gis/shared.mjs';
import { pointer,has } from './profile.mjs';
export const SOURCE_SCHEMA='commons.open311.service-source.v1';
export const INSPECTION_SCHEMA='commons.open311.service-source-inspection.v1';
const escapeSegment=value=>String(value).replace(/~/g,'~0').replace(/\//g,'~1');
export function pointerValue(root,supplied){
  pointer(supplied);let value=root;
  if(supplied==='')return {found:true,value};
  for(const segment of supplied.slice(1).split('/').map(s=>s.replace(/~1/g,'/').replace(/~0/g,'~'))){
    if(value===null||typeof value!=='object'||!has(value,segment)||Array.isArray(value)&&!/^(0|[1-9]\d*)$/.test(segment))return {found:false,value:null};
    value=value[segment];
  }
  return {found:true,value};
}
export function originalValue(originalText){
  if(typeof originalText!=='string'||Buffer.byteLength(originalText)>MAX_PACKAGE_BYTES)fail('SOURCE_SIZE','Keep the complete original JSON within the 256 MiB source-file limit.',413);
  return parseJson(originalText,'Complete original service source');
}
export function inspectSource(originalText){
  const root=originalValue(originalText),arrays=[],stack=[{value:root,pointer:'',depth:0}];let examined=0;
  while(stack.length){
    const entry=stack.pop();if(++examined>500000||entry.depth>100)fail('SOURCE_STRUCTURE_LIMIT','Inspect a JSON source with at most 500,000 containers and depth 100.',413);
    if(entry.value===null||typeof entry.value!=='object')continue;
    if(Array.isArray(entry.value)){
      if(arrays.length>=10000)fail('SOURCE_ARRAY_LIMIT','The source contains more than 10,000 separate selectable arrays.',413);
      const fields=new Set();for(const row of entry.value)if(row&&typeof row==='object'&&!Array.isArray(row))for(const key of Object.keys(row))fields.add(key);
      arrays.push({pointer:entry.pointer,rows:entry.value.length,fields:[...fields].sort()});
    }
    const entries=Object.entries(entry.value);
    for(let index=entries.length-1;index>=0;index--){const [key,value]=entries[index];if(value&&typeof value==='object')stack.push({value,pointer:entry.pointer+'/'+escapeSegment(key),depth:entry.depth+1});}
  }
  return {schema:INSPECTION_SCHEMA,originalFile:{bytes:Buffer.byteLength(originalText),sha256:digest(originalText)},rootType:root===null?'null':Array.isArray(root)?'array':typeof root,arrays};
}
export function selectedRows(root,selection){
  object(selection,'Original source selection');const rowsPointer=pointer(selection.rowsPointer,'Original source row-array pointer'),selected=pointerValue(root,rowsPointer);
  if(!selected.found||!Array.isArray(selected.value))fail('SOURCE_ARRAY_REQUIRED','Select an actual original JSON array.',400,{rowsPointer});
  if(selected.value.length>MAX_ROWS)fail('SOURCE_ROWS_LIMIT','A source selection supports at most '+MAX_ROWS+' original rows.',413);
  return selected.value;
}
export function createSource(input,{id,createdAt}){
  const originalText=input.originalText,root=originalValue(originalText),selection={rowsPointer:pointer(input.selection?.rowsPointer,'Original row-array pointer')},rows=selectedRows(root,selection);
  const originalFile={filename:'original-service-source.json',contentType:'application/json; charset=utf-8',bytes:Buffer.byteLength(originalText),sha256:digest(originalText)};
  return seal({schema:SOURCE_SCHEMA,id,name:text(input.name,'Source name',1000),createdAt,selection,rowCount:rows.length,originalFile,originalText});
}
export const sourceSummary=source=>({schema:source.schema,id:source.id,name:source.name,createdAt:source.createdAt,selection:copy(source.selection),rowCount:source.rowCount,originalFile:copy(source.originalFile),sha256:source.sha256});
export const sourceDetail=source=>({source:sourceSummary(source),originalText:source.originalText});
export function sourceRows(source){
  const rows=selectedRows(originalValue(source.originalText),source.selection);
  return rows.map((value,index)=>{const rowPointer=source.selection.rowsPointer+'/'+index;return {key:entityId('source-row',{originalSha256:source.originalFile.sha256,pointer:rowPointer}),index,pointer:rowPointer,value:copy(value)};});
}
export function paginated(rows,selection={}){
  const terms=text(selection.q??'','Search',10000,{empty:true}).toLocaleLowerCase().split(/\s+/u).filter(Boolean),filtered=terms.length?rows.filter(row=>{const input=JSON.stringify(row).toLocaleLowerCase();return terms.every(term=>input.includes(term));}):rows,result=page(filtered,selection);
  return {...result,nextOffset:result.offset+result.items.length<result.total?result.offset+result.items.length:null};
}
