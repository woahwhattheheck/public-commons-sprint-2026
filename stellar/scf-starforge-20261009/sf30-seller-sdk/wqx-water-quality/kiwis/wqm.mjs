// MIT. Complete original KiWIS WQM sample values as a commissioning counterpart.
import {canonical,digest,fail,decodeResponse} from './source.mjs';
import {readLabZip} from '../../lab-edd/zip.mjs';

const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
function checkedResponse(response){
  if(!response||typeof response!=='object'||Array.isArray(response))
    fail('KIWIS_WQM_SOURCE','Provide the complete original WQM response and its acquisition record.');
  const bytes=Buffer.from(response.base64??'','base64');
  if(bytes.toString('base64')!==response.base64||bytes.length!==response.bytes||digest(bytes)!==response.sha256)
    fail('KIWIS_WQM_SOURCE_CHANGED','The complete original WQM response changed.');
  let request=response.request??response.origin?.request;
  if(response.url!==undefined){
    let url;try{url=new URL(response.url);}catch{fail('KIWIS_WQM_URL','Keep the original WQM acquisition URL.');}
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.hash)
      fail('KIWIS_WQM_URL','Keep the original credential-free KiWIS response URL.');
    if(response.status!==200)fail('KIWIS_WQM_RESPONSE','Use the successful original WQM response.');
    if(request&&request!==url.searchParams.get('request'))fail('KIWIS_WQM_REQUEST','The original acquisition request and URL differ.');
    request=url.searchParams.get('request');
  }else{
    if(response.origin?.kind!=='provided-original-file'||typeof response.origin.filename!=='string'||!response.origin.filename.trim())
      fail('KIWIS_WQM_ORIGIN','Identify the supplied original WQM file and retain its source provenance.');
    if(response.status!==undefined)fail('KIWIS_WQM_ORIGIN','An original file without an HTTP URL cannot acquire an HTTP status.');
  }
  if(request!=='getWqmSampleValues')fail('KIWIS_WQM_REQUEST','Select the complete original getWqmSampleValues export.');
  return bytes;
}
export function wqmCounterpartIdentity(input){
  if(input?.kind!=='kiwis-wqm')fail('KIWIS_WQM_SOURCE','Select the original KiWIS WQM sample counterpart.');
  checkedResponse(input.response);
  if(input.metadataResponses!==undefined&&!Array.isArray(input.metadataResponses))
    fail('KIWIS_WQM_SOURCE','Retain the complete original metadata response array.');
  return {sourceSha256:digest(canonical(input))};
}
export function projectWqmCounterpart(input,{signal}={}){
  const identity=wqmCounterpartIdentity(input),raw=checkedResponse(input.response),types=new WeakMap();
  const table=decodeResponse(input.response,{types,signal});
  if(!Array.isArray(table)||!Array.isArray(table[0])||!table[0].length)
    fail('KIWIS_WQM_TABLE','Receive the complete original WQM header-row table.');
  const headers=table[0];
  if(headers.some((header,index)=>typeof header!=='string'||!header.trim()||types.get(headers)?.get(String(index))!=='string')||new Set(headers).size!==headers.length)
    fail('KIWIS_WQM_COLUMNS','Original WQM columns must have distinct field names.');
  for(const name of ['station_no','timestamp','value'])
    if(!headers.includes(name))fail('KIWIS_WQM_COLUMNS','The original WQM sample table is missing '+name+'.');
  let member=null;
  if(raw.length>=4&&raw.readUInt32LE(0)===0x04034b50){
    if(typeof input.response.archiveMember!=='string')
      fail('KIWIS_WQM_MEMBER','Select the exact original WQM archive member.');
    const files=readLabZip(raw,{maxBytes:64*1024*1024,signal}),selected=files.find(file=>file.filename===input.response.archiveMember);
    if(!selected)fail('KIWIS_WQM_MEMBER','The selected complete WQM archive member is absent.');
    member={filename:selected.filename,bytes:selected.bytes.length,sha256:selected.sha256};
  }
  const fieldType=(row,index)=>{
    const values=types.get(row);
    const type=values instanceof Map?(values.get(String(index))??values.get(index)):values?.[index];
    if(!['string','number','boolean','null'].includes(type))
      fail('KIWIS_WQM_SCALAR','Retain each original WQM scalar type with its lossless field value.');
    return type;
  };
  const records=table.slice(1).map((row,index)=>{
    signal?.throwIfAborted();
    if(!Array.isArray(row)||row.length!==headers.length||row.some(value=>value!==null&&typeof value==='object'))
      fail('KIWIS_WQM_ROW','Retain every complete physical WQM sample row at its original width.');
    const fields=Object.fromEntries(headers.map((header,column)=>[header,row[column]]));
    const scalarTypes=row.map((_,column)=>fieldType(row,column));
    const fieldTypes=Object.fromEntries(headers.map((header,column)=>[header,scalarTypes[column]]));
    const rowIndex=index+1,recordId='wqm-'+digest(canonical([input.response.sha256,member?.filename??null,rowIndex])).slice(0,40);
    return {recordId,fields,rowSha256:digest(canonical(fields)),original:{
      responseSha256:input.response.sha256,responseBytes:input.response.bytes,
      ...(own(input.response,'url')?{url:input.response.url,status:input.response.status}:{}),
      ...(input.response.origin?{origin:input.response.origin}:{}),
      archiveMember:member,rowIndex,columns:headers,values:row,scalarTypes,fieldTypes}};
  });
  return {kind:'kiwis-wqm',sourceSha256:identity.sourceSha256,
    nativeReviewSha256:null,records,
    original:{request:'getWqmSampleValues',responseSha256:input.response.sha256,
      responseBytes:input.response.bytes,archiveMember:member,columns:headers,physicalRows:records.length,
      metadataResponses:input.metadataResponses??[],
      scalarRepresentation:'Original number tokens are retained as exact lexical strings with original scalar type sidecars; the unchanged original response bytes remain in the complete input.'}};
}
