// MIT. Original ClinicalTrials packet → retained Research dossier interpretation.
// Full study content remains the original NDJSON text, including numeric tokens.
import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
export const PROVIDER='clinicaltrials-gov',ORIGIN='https://clinicaltrials.gov';
export const PACKET='stellar-forge.clinicaltrials-packet.v1',ENVELOPE='sf88-research-results-v1';
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
export const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function need(value,code){if(!value)throw Object.assign(new Error(code),{code});}
function ordered(value){
 if(Array.isArray(value))return value.map(ordered);
 if(object(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])]));
 return value;
}
export const same=(left,right)=>JSON.stringify(ordered(left))===JSON.stringify(ordered(right));
function parse(bytes){try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
 catch{need(false,'CLINICALTRIALS_RETAINED_JSON_INVALID');}}
// Read just the original Python ZIP's manifest for independent retained-source binding.
// Complete input validation (all declared files, paths and study/page equality) stays in
// clinical-trials-packet.py using Python's maintained zipfile implementation.
function manifestFromPacket(bytes){
 const fail='CLINICALTRIALS_PACKET_MANIFEST_CHANGED';
 const take=(offset,count)=>{need(Number.isSafeInteger(offset)&&offset>=0&&offset+count<=bytes.length,fail);return bytes.subarray(offset,offset+count);};
 const u16=offset=>take(offset,2).readUInt16LE(0),u32=offset=>take(offset,4).readUInt32LE(0);
 let end=-1;
 for(let offset=bytes.length-22;offset>=Math.max(0,bytes.length-65557);offset--)
  if(u32(offset)===0x06054b50&&offset+22+u16(offset+20)===bytes.length){end=offset;break;}
 need(end>=0&&u16(end+4)===0&&u16(end+6)===0&&u16(end+8)===u16(end+10),fail);
 const count=u16(end+10),centralSize=u32(end+12),central=u32(end+16);
 need(count>0&&count<=20001&&central+centralSize===end,fail);
 let offset=central,found=null;
 for(let index=0;index<count;index++){
  need(u32(offset)===0x02014b50,fail);
  const flags=u16(offset+8),method=u16(offset+10),compressed=u32(offset+20),size=u32(offset+24),
   nameLength=u16(offset+28),extraLength=u16(offset+30),commentLength=u16(offset+32),local=u32(offset+42);
  const name=take(offset+46,nameLength).toString('utf8');
  if(name==='manifest.json'){
   need(!found&&!(flags&1)&&[0,8].includes(method)&&size>0&&size<=8*1024*1024&&local<central,fail);
   need(u32(local)===0x04034b50&&u16(local+8)===method,fail);
   const localName=u16(local+26),localExtra=u16(local+28);
   need(take(local+30,localName).toString('utf8')===name,fail);
   const start=local+30+localName+localExtra;
   need(start+compressed<=central,fail);
   const packed=take(start,compressed);
   found=method===0?Buffer.from(packed):inflateRawSync(packed,{maxOutputLength:8*1024*1024});
   need(found.length===size,fail);
  }
  offset+=46+nameLength+extraLength+commentLength;need(offset<=end,fail);
 }
 need(offset===end&&found,fail);return {bytes:found,value:parse(found)};
}
export function packetBytes(value){
 need(object(value)&&value.schema===PACKET&&typeof value.base64==='string'&&
  Number.isSafeInteger(value.bytes)&&value.bytes>0&&value.bytes<=128*1024*1024,'CLINICALTRIALS_SOURCE_PACKET_REQUIRED');
 const bytes=Buffer.from(value.base64,'base64');
 need(bytes.toString('base64')===value.base64&&bytes.length===value.bytes&&sha(bytes)===value.sha256,'CLINICALTRIALS_SOURCE_PACKET_CHANGED');
 return bytes;
}
export function validateEdition(value){
 need(object(value)&&value.schema===ENVELOPE&&value.provider===PROVIDER&&value.success===true&&
  typeof value.query==='string'&&typeof value.label==='string'&&Array.isArray(value.results)&&
  Array.isArray(value.sourcePages)&&Array.isArray(value.sourceVersions)&&object(value.usage),
  'CLINICALTRIALS_RETAINED_EDITION_REQUIRED');
 const packet=packetBytes(value.sourcePacket),manifest=manifestFromPacket(packet);
 need(sha(manifest.bytes)===value.sourcePacket.manifestSha256&&manifest.value.schema===PACKET&&
  Array.isArray(manifest.value.captures),'CLINICALTRIALS_ORIGINAL_MANIFEST_CHANGED');
 const capture=manifest.value.captures.find(row=>row.id===value.usage.captureId);
 need(capture&&same(capture.configuration,value.usage.scope)&&capture.rowCount===value.results.length&&
  capture.pageCount===value.sourcePages.length&&capture.byteCount===value.usage.sourceBytes&&
  value.usage.occurrences===value.results.length&&
  value.usage.sourceId==='ctsrc_'+value.sourcePacket.sha256,'CLINICALTRIALS_CAPTURE_BINDING_CHANGED');
 need(value.sourceVersions.length===capture.versionRequests.length&&value.sourceVersions.every((row,index)=>same(row.request,capture.versionRequests[index])),
  'CLINICALTRIALS_ORIGINAL_VERSION_CHANGED');
 const complete=capture.status==='completed';
 need(value.usage.complete===complete&&value.status===(complete?'AVAILABLE':'PARTIAL')&&
  value.usage.coverage===(complete?'COMPLETE_CAPTURE':'PARTIAL_CAPTURE')&&
  value.usage.nextPageToken===capture.nextPageToken&&same(value.usage.sourceVersion,capture.version),
  'CLINICALTRIALS_CAPTURE_COVERAGE_CHANGED');
 const hash=createHash('sha256'),ids=new Set(),counts=Array(value.sourcePages.length).fill(0),pageHashes=value.sourcePages.map(()=>createHash('sha256'));let lastPage=-1;
 for(let index=0;index<value.sourcePages.length;index++){
  const page=value.sourcePages[index],original=capture.pages[index];
  need(page.index===index&&original&&Object.keys(page).every(key=>same(page[key],original[key]??null)),
   'CLINICALTRIALS_ORIGINAL_PAGE_CHANGED');
 }
 for(const result of value.results){
  need(object(result)&&typeof result.id==='string'&&/^NCT[0-9]{8}$/.test(result.id)&&
   typeof result.content==='string'&&result.content.endsWith('\n')&&object(result.metadata),
   'CLINICALTRIALS_WHOLE_STUDY_REQUIRED');
  const body=Buffer.from(result.content,'utf8'),meta=result.metadata,page=value.sourcePages[meta.pageIndex];
  need(body.length<=16*1024*1024&&body.length===meta.recordBytes&&sha(body)===meta.recordSha256&&
   meta.nctId===result.id&&meta.captureId===capture.id&&page&&meta.pageSha256===page.sha256&&
   meta.pageStudyIndex===counts[meta.pageIndex]++&&result.url===ORIGIN+'/study/'+result.id,
   'CLINICALTRIALS_WHOLE_STUDY_BINDING_CHANGED');
  need(meta.pageIndex>=lastPage,'CLINICALTRIALS_STUDY_ORDER_CHANGED');lastPage=meta.pageIndex;
  ids.add(result.id);hash.update(body);pageHashes[meta.pageIndex].update(body);
 }
 need(counts.every((count,index)=>count===value.sourcePages[index].rowCount&&pageHashes[index].digest('hex')===value.sourcePages[index].ndjsonSha256)&&
  hash.digest('hex')===value.usage.sourceSha256&&ids.size===value.usage.uniqueStudies&&
  (capture.source===null||capture.source===value.usage.sourceSha256)&&
  capture.source===value.usage.originalSourceSha256,'CLINICALTRIALS_ORIGINAL_SOURCE_CHANGED');
 need(same(value.usage.nativeBuilds,(manifest.value.native?.builds??[]).filter(row=>
  capture.source&&row.source===capture.source)),'CLINICALTRIALS_NATIVE_BUILD_BINDING_CHANGED');
 return value;
}
export function compareEditions(before,after){
 before=validateEdition(before);after=validateEdition(after);
 const groups=rows=>{const result=new Map();for(const row of rows){const current=result.get(row.id)??[];current.push(row);result.set(row.id,current);}return result;};
 const left=groups(before.results),right=groups(after.results),added=[],absent=[],changed=[];let unchanged=0;
 const hashes=rows=>rows.map(row=>row.metadata.recordSha256).sort();
 const values=(rows,key)=>[...new Set(rows.map(row=>row.metadata.sectionSha256?.[key]??null))].sort();
 for(const[id,rows]of right){
  const old=left.get(id);
  if(!old){added.push({nctId:id,occurrences:rows.length,records:rows.map(row=>row.metadata)});continue;}
  const beforeHashes=hashes(old),afterHashes=hashes(rows);
  if(same(beforeHashes,afterHashes)){unchanged++;continue;}
  const keys=[...new Set([...old,...rows].flatMap(row=>Object.keys(row.metadata.sectionSha256??{})))].sort();
  const changedSections=keys.filter(key=>!same(values(old,key),values(rows,key)));
  changed.push({nctId:id,before:old.map(row=>row.metadata),after:rows.map(row=>row.metadata),
   beforeOccurrences:old.length,afterOccurrences:rows.length,changedSections,
   sourceTextChanged:!same([...new Set(beforeHashes)],[...new Set(afterHashes)]),
   occurrenceCountsChanged:old.length!==rows.length,
   sectionValuesChanged:changedSections.length>0});
 }
 for(const[id,rows]of left)if(!right.has(id))absent.push({nctId:id,occurrences:rows.length,records:rows.map(row=>row.metadata)});
 return {beforeNormalizedSha256:sha(json(before)),afterNormalizedSha256:sha(json(after)),sameScope:same(before.usage.scope,after.usage.scope),
  beforeCoverage:before.usage.coverage,afterCoverage:after.usage.coverage,
  beforeCaptureId:before.usage.captureId,afterCaptureId:after.usage.captureId,
  added,absentFromSelectedCapture:absent,changed,unchanged,
  meaning:'Each retained study occurrence and source variant remains explicit. Absence is relative to these selected captures. Registry withdrawal, efficacy and eligibility are not inferred. Whole-source text, occurrence counts and section-value changes are reported separately.'};
}
