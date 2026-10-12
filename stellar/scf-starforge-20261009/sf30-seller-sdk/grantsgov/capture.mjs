// MIT. One retained Grants.gov acquisition, checkpointed source files, portable exact-byte restoration.
import {join,basename} from 'node:path';
import {readdir,rename} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {privateDirectory,readPrivate,readJson,atomicJson,createFile,syncDirectory,acquireWorkspace}
  from '../postgres/publisher/files.mjs';
import {canonical,sha,copy,object,need,fault,safeInteger,opportunityId,normalizeQuery,queryFromRequest,
  queryEchoWarnings,decodeSourceRecord,normalizeOpportunity,ATTRIBUTION,SOURCE_DOCUMENTATION} from './source.mjs';
import {createGrantsTransport} from './transport.mjs';

export const CAPTURE_VERSION='stellar-forge.grantsgov-capture.v1';
export const CAPTURE_EXPORT_VERSION='stellar-forge.grantsgov-capture-export.v1';
const MAX_SOURCE_BYTES=24*1024*1024,MAX_MANIFEST_BYTES=32*1024*1024,MAX_EXPORT_BYTES=1024*1024*1024;
const stamp=()=>new Date().toISOString();
const encoded=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const sourceName=(kind,value)=>kind==='search'?
  'search-'+String(safeInteger(value,'startRecord')).padStart(10,'0')+'.json':
  'detail-'+opportunityId(value)+'.json';
const sourcePath=name=>'sources/'+name;
const allowedSourcePath=value=>typeof value==='string'&&/^sources\/(?:search-\d{10,16}|detail-[1-9]\d{0,14})\.json$/.test(value);
function compactRecord(record){
  const {payload,...rest}=record;
  decodeSourceRecord(rest);
  return copy(rest);
}
function requestMatches(record,query,kind,value){
  need(record.kind===kind,'GRANTS_SOURCE_KIND_MISMATCH');
  if(kind==='search'){
    need(canonical(queryFromRequest(record.request.body))===canonical(query),'GRANTS_SOURCE_QUERY_MISMATCH',
      'The retained page was acquired with another query.');
    need(safeInteger(record.request.body.startRecordNum??0,'startRecordNum')===value,
      'GRANTS_SOURCE_CURSOR_MISMATCH');
  }else need(opportunityId(record.request.body.opportunityId)===opportunityId(value),'GRANTS_DETAIL_ID_MISMATCH');
}
function sourceDescriptor(record,file,fileBytes){
  const payload=decodeSourceRecord(record);
  const common={file,sha256:sha(fileBytes),bytes:fileBytes.length,kind:record.kind,
    requestSha256:record.request.sha256,responseSha256:record.response.bodySha256,
    dataSha256:record.data.sha256,capturedAt:record.response.capturedAt};
  if(record.kind==='search')return {...common,
    startRecord:safeInteger(payload.startRecord,'startRecord'),
    hitCount:safeInteger(payload.hitCount,'hitCount'),rows:payload.oppHits.length,
    opportunityIds:payload.oppHits.map(row=>opportunityId(row.id))};
  return {...common,opportunityId:opportunityId(payload.id),revision:payload.revision??null};
}
function calculateCoverage(manifest){
  const pages=manifest.pages,counts=[...new Set(pages.map(p=>p.hitCount))],ids=[],duplicates=new Set(),unique=new Set();
  let next=0,contiguous=true;
  for(const page of pages){
    if(page.startRecord!==next)contiguous=false;
    next=page.startRecord+page.rows;
    for(const id of page.opportunityIds){ids.push(id);if(unique.has(id))duplicates.add(id);else unique.add(id);}
  }
  const expectedHits=pages[0]?.hitCount??null,last=pages.at(-1);
  const paginationReachedEnd=!!last&&last.startRecord+last.rows>=last.hitCount;
  const warnings=[];
  if(counts.length>1)warnings.push({code:'COHORT_CHANGED_DURING_CAPTURE',hitCounts:counts});
  if(duplicates.size)warnings.push({code:'DUPLICATE_OPPORTUNITIES_ACROSS_PAGES',opportunityIds:[...duplicates]});
  if(!contiguous)warnings.push({code:'NONCONTIGUOUS_PROVIDER_PAGES'});
  if(paginationReachedEnd&&expectedHits!==unique.size)
    warnings.push({code:'COHORT_COUNT_MISMATCH',expected:expectedHits,unique:unique.size});
  for(const issue of manifest.sourceWarnings??[])warnings.push(issue);
  const captured=new Set(manifest.details.map(d=>d.opportunityId));
  const missing=[...unique].filter(id=>!captured.has(id));
  const searchComplete=paginationReachedEnd&&contiguous&&counts.length===1&&duplicates.size===0&&
    unique.size===expectedHits&&!warnings.some(v=>v.code==='SEARCH_FILTER_ECHO_MISMATCH');
  return {searchComplete,paginationReachedEnd,detailsRequested:manifest.includeDetails,
    detailsComplete:manifest.includeDetails&&missing.length===0,
    expectedHits,seenHits:ids.length,uniqueOpportunities:unique.size,detailCount:captured.size,
    missingDetailIds:missing,duplicateIds:[...duplicates],changedHitCounts:counts.length>1?counts:[],
    nextStartRecord:next,warnings};
}
function sourceSignature(manifest){
  return sha({schema:CAPTURE_VERSION,captureId:manifest.captureId,operationId:manifest.operationId,
    query:manifest.query,includeDetails:manifest.includeDetails,
    pages:manifest.pages.map(v=>({file:v.file,sha256:v.sha256})),
    details:manifest.details.map(v=>({file:v.file,sha256:v.sha256})),
    coverage:calculateCoverage(manifest)});
}
function validateManifest(manifest){
  need(object(manifest)&&manifest.schema===CAPTURE_VERSION,'GRANTS_CAPTURE_INVALID');
  need(typeof manifest.operationId==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(manifest.operationId),
    'GRANTS_OPERATION_ID_INVALID');
  const query=normalizeQuery(manifest.query);
  need(canonical(query)===canonical(manifest.query),'GRANTS_CAPTURE_QUERY_INVALID');
  need(manifest.captureId==='GSC-'+sha({operationId:manifest.operationId,query}).slice(0,32),
    'GRANTS_CAPTURE_ID_MISMATCH');
  need(Array.isArray(manifest.pages)&&Array.isArray(manifest.details)&&
    manifest.pages.length<=10000&&manifest.details.length<=250000,'GRANTS_CAPTURE_SIZE_INVALID');
  need(typeof manifest.includeDetails==='boolean','GRANTS_CAPTURE_INVALID');
  const files=new Set();
  for(const entry of [...manifest.pages,...manifest.details]){
    need(allowedSourcePath(entry.file)&&!files.has(entry.file),'GRANTS_SOURCE_PATH_INVALID');
    files.add(entry.file);
    need(/^[a-f0-9]{64}$/.test(entry.sha256??'')&&Number.isSafeInteger(entry.bytes)&&
      entry.bytes>0&&entry.bytes<=MAX_SOURCE_BYTES,'GRANTS_SOURCE_DESCRIPTOR_INVALID');
  }
  need(manifest.sourceSignature===sourceSignature(manifest),'GRANTS_CAPTURE_SIGNATURE_MISMATCH');
  need(canonical(manifest.coverage)===canonical(calculateCoverage(manifest)),'GRANTS_CAPTURE_COVERAGE_MISMATCH');
  return manifest;
}
async function writeManifest(directory,manifest){
  manifest.coverage=calculateCoverage(manifest);
  manifest.sourceSignature=sourceSignature(manifest);
  manifest.updatedAt=stamp();
  await atomicJson(directory,'capture.json',manifest);
}
async function optionalJson(path,maximum=MAX_MANIFEST_BYTES){
  try{return await readJson(path,maximum);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function loadSource(directory,entry){
  need(allowedSourcePath(entry.file),'GRANTS_SOURCE_PATH_INVALID');
  const bytes=await readPrivate(join(directory,entry.file),MAX_SOURCE_BYTES);
  need(bytes.length===entry.bytes&&sha(bytes)===entry.sha256,'GRANTS_SOURCE_FILE_CHANGED',
    'A retained provider source file differs from its manifest.');
  const record=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),payload=decodeSourceRecord(record);
  const actual=sourceDescriptor(record,entry.file,bytes);
  need(canonical(actual)===canonical(entry),'GRANTS_SOURCE_DESCRIPTOR_MISMATCH');
  return {record,payload,bytes};
}
function validateSources(manifest,sources){
  const rowMap=new Map(),details=new Map();
  for(const entry of manifest.pages){
    const value=sources.get(entry.file);need(value,'GRANTS_SOURCE_FILE_MISSING');
    requestMatches(value.record,manifest.query,'search',entry.startRecord);
    need(value.payload.oppHits.length===entry.rows,'GRANTS_SOURCE_ROW_COUNT_MISMATCH');
    for(let index=0;index<value.payload.oppHits.length;index++){
      const hit=value.payload.oppHits[index],id=opportunityId(hit.id);
      if(!rowMap.has(id))rowMap.set(id,{hit,source:value.record,pointer:'/oppHits/'+index});
    }
  }
  for(const entry of manifest.details){
    const value=sources.get(entry.file);need(value,'GRANTS_SOURCE_FILE_MISSING');
    requestMatches(value.record,manifest.query,'detail',entry.opportunityId);
    need(rowMap.has(entry.opportunityId)&&!details.has(entry.opportunityId),'GRANTS_DETAIL_COHORT_MISMATCH');
    details.set(entry.opportunityId,value);
  }
  return {rowMap,details};
}
async function readCaptureInternal(directory,{withPending=true}={}){
  await privateDirectory(directory);
  const manifestBytes=await readPrivate(join(directory,'capture.json'),MAX_MANIFEST_BYTES);
  const manifest=validateManifest(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes)));
  const sources=new Map();
  for(const entry of [...manifest.pages,...manifest.details])sources.set(entry.file,await loadSource(directory,entry));
  const {rowMap,details}=validateSources(manifest,sources);
  const pending=[];
  if(withPending){
    for(const name of (await readdir(join(directory,'sources'))).sort()){
      const file=sourcePath(name);
      if(!allowedSourcePath(file)||sources.has(file))continue;
      const bytes=await readPrivate(join(directory,file),MAX_SOURCE_BYTES);
      const record=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),payload=decodeSourceRecord(record);
      const entry=sourceDescriptor(record,file,bytes);
      if(record.kind==='search')requestMatches(record,manifest.query,'search',entry.startRecord);
      else requestMatches(record,manifest.query,'detail',entry.opportunityId);
      need(file===sourcePath(sourceName(record.kind,record.kind==='search'?entry.startRecord:entry.opportunityId)),
        'GRANTS_SOURCE_PATH_MISMATCH');
      pending.push(entry);sources.set(file,{record,payload,bytes});
    }
  }
  return {manifest,manifestBytes,sources,rowMap,details,pending};
}
function captureView(internal){
  const {manifest,sources,rowMap,details,pending}=internal;
  const opportunities=[...rowMap].map(([id,value])=>normalizeOpportunity({
    hit:value.hit,detail:details.get(id)?.payload??null,
    source:{search:value.source,searchPointer:value.pointer,detail:details.get(id)?.record??null}
  }));
  return {...copy(manifest),header:copy(manifest),
    pages:manifest.pages.map(entry=>({...copy(entry),source:copy(sources.get(entry.file).record)})),
    details:manifest.details.map(entry=>({...copy(entry),source:copy(sources.get(entry.file).record)})),
    pendingSources:copy(pending),opportunities};
}
export async function readCapture(directory){
  return captureView(await readCaptureInternal(directory));
}
function issueRecord(error){
  return {code:error.code??'GRANTS_CAPTURE_FAILED',message:String(error.message??error).slice(0,1000),
    status:error.status??null,at:stamp(),retryAt:error.retryAt??null,retryAfterMs:error.retryAfterMs??null,
    receipt:error.receipt??null,attempts:error.attempts??null};
}
export async function captureGrants({directory,query,operationId,transport=createGrantsTransport(),signal,
  includeDetails=true,maxPages=1000,maxOpportunities=25000,seedSources=[],onProgress}){
  const normalized=normalizeQuery(query);
  need(typeof operationId==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(operationId),
    'GRANTS_OPERATION_ID_INVALID','Choose a stable operationId for this exact acquisition.');
  safeInteger(maxPages,'maxPages',1,10000);
  safeInteger(maxOpportunities,'maxOpportunities',normalized.pageSize,250000);
  need(Array.isArray(seedSources),'GRANTS_SEED_SOURCES_INVALID');
  need(transport&&typeof transport.search==='function'&&typeof transport.detail==='function','GRANTS_TRANSPORT_REQUIRED');
  await privateDirectory(directory,true);
  await privateDirectory(join(directory,'sources'),true);
  const release=await acquireWorkspace(directory);
  let manifest,canCheckpoint=false;
  try{
    manifest=await optionalJson(join(directory,'capture.json'));
    if(manifest){
      validateManifest(manifest);
      need(manifest.operationId===operationId&&canonical(manifest.query)===canonical(normalized)&&
        manifest.includeDetails===includeDetails,'GRANTS_CAPTURE_CONFLICT',
        'Continue the original operation and query, or choose a new capture directory.');
      // Full verification precedes a resumed provider request.
      await readCaptureInternal(directory);
      if(manifest.status==='completed')return await readCapture(directory);
      canCheckpoint=true;
    }else{
      manifest={schema:CAPTURE_VERSION,captureId:'GSC-'+sha({operationId,query:normalized}).slice(0,32),
        operationId,query:normalized,includeDetails,status:'capturing',startedAt:stamp(),updatedAt:null,
        completedAt:null,pages:[],details:[],sourceWarnings:[],detailFailures:[],lastError:null,
        attribution:ATTRIBUTION,documentation:[...SOURCE_DOCUMENTATION],coverage:null,sourceSignature:null};
      await writeManifest(directory,manifest);
      canCheckpoint=true;
    }
    manifest.status='capturing';manifest.lastError=null;manifest.completedAt=null;
    await writeManifest(directory,manifest);
    const seeds=new Map();
    for(const value of seedSources){
      const record=compactRecord(value);
      const key=record.kind==='search'?'search:'+safeInteger(record.request.body.startRecordNum??0,'startRecordNum'):
        'detail:'+opportunityId(record.request.body.opportunityId);
      requestMatches(record,normalized,record.kind,record.kind==='search'?
        safeInteger(record.request.body.startRecordNum??0,'startRecordNum'):opportunityId(record.request.body.opportunityId));
      need(!seeds.has(key)||canonical(seeds.get(key))===canonical(record),'GRANTS_SEED_CONFLICT');
      seeds.set(key,record);
    }
    const acquire=async(kind,value)=>{
      if(signal?.aborted)throw fault('GRANTS_CANCELLED','The original capture was paused.',409);
      const name=sourceName(kind,value),file=sourcePath(name),path=join(directory,file);
      let record=await optionalJson(path,MAX_SOURCE_BYTES);
      const seed=seeds.get(kind+':'+value);
      if(record){
        requestMatches(record,normalized,kind,value);decodeSourceRecord(record);
        if(seed)need(canonical(seed)===canonical(record),'GRANTS_SEED_CONFLICT',
          'The supplied source differs from this already retained original response.');
      }else{
        record=compactRecord(seed??await (kind==='search'?
          transport.search(normalized,value,{signal}):transport.detail(value,{signal})));
        requestMatches(record,normalized,kind,value);
        const bytes=encoded(record);
        need(bytes.length<=MAX_SOURCE_BYTES,'GRANTS_SOURCE_TOO_LARGE');
        // An immutable request slot is committed before the capture cursor moves.
        // On a crash between these writes, the original response is adopted on resume.
        await atomicJson(join(directory,'sources'),name,record);
      }
      const bytes=await readPrivate(path,MAX_SOURCE_BYTES),payload=decodeSourceRecord(record);
      need(sha(bytes)===sha(encoded(record)),'GRANTS_SOURCE_FILE_CHANGED');
      return {record,payload,entry:sourceDescriptor(record,file,bytes)};
    };
    const progress=async phase=>{
      if(onProgress)await onProgress({captureId:manifest.captureId,operationId,status:manifest.status,
        phase,coverage:copy(manifest.coverage),sourceSignature:manifest.sourceSignature});
    };
    await progress('resume');
    while(!calculateCoverage(manifest).paginationReachedEnd){
      const coverage=calculateCoverage(manifest);
      if(manifest.pages.length>=maxPages||coverage.seenHits>=maxOpportunities)break;
      const start=coverage.nextStartRecord,original=await acquire('search',start);
      need(original.entry.startRecord===start,'GRANTS_PROVIDER_CURSOR_MISMATCH',
        'The provider returned a different page start; the original response is retained.',502);
      need(original.entry.rows<=normalized.pageSize,'GRANTS_PROVIDER_PAGE_SIZE_MISMATCH');
      if(original.entry.rows===0&&start<original.entry.hitCount)
        throw fault('GRANTS_PROVIDER_PAGE_GAP','The provider returned an empty page before its reported end.',502);
      manifest.pages.push(original.entry);
      for(const warning of queryEchoWarnings(normalized,original.payload)){
        if(!manifest.sourceWarnings.some(existing=>canonical(existing)===canonical(warning)))
          manifest.sourceWarnings.push(warning);
      }
      await writeManifest(directory,manifest);await progress('search');
    }
    if(includeDetails){
      const allIds=[...new Set(manifest.pages.flatMap(page=>page.opportunityIds))];
      const existing=new Set(manifest.details.map(detail=>detail.opportunityId));
      for(const id of allIds){
        if(existing.has(id))continue;
        try{
          const original=await acquire('detail',id);
          manifest.details.push(original.entry);existing.add(id);
          manifest.detailFailures=manifest.detailFailures.filter(failure=>failure.opportunityId!==id);
          await writeManifest(directory,manifest);await progress('detail');
        }catch(error){
          if(error.code==='GRANTS_RECORD_UNAVAILABLE'){
            const failure={opportunityId:id,...issueRecord(error)};
            manifest.detailFailures=manifest.detailFailures.filter(item=>item.opportunityId!==id);
            manifest.detailFailures.push(failure);await writeManifest(directory,manifest);
            await progress('detail-unavailable');continue;
          }
          throw error;
        }
      }
    }
    manifest.coverage=calculateCoverage(manifest);
    manifest.status=manifest.coverage.searchComplete&&(!includeDetails||manifest.coverage.detailsComplete)?'completed':'partial';
    manifest.completedAt=manifest.status==='completed'?stamp():null;manifest.lastError=null;
    await writeManifest(directory,manifest);await progress('finished');
    return await readCapture(directory);
  }catch(error){
    if(manifest&&canCheckpoint){
      manifest.status='interrupted';manifest.lastError=issueRecord(error);
      try{await writeManifest(directory,manifest);}catch(writeError){
        error.checkpointError={code:writeError.code??'WRITE_FAILED',message:String(writeError.message).slice(0,300)};
      }
      Object.assign(error,{captureId:manifest.captureId,operationId,directory});
    }
    throw error;
  }finally{await release();}
}
export async function exportCapture(directory){
  await privateDirectory(directory);
  const release=await acquireWorkspace(directory);
  try{
    const original=await readCaptureInternal(directory);
    const manifest={file:'capture.json',bytes:original.manifestBytes.length,sha256:sha(original.manifestBytes),
      base64:original.manifestBytes.toString('base64')};
    const sources=[...original.sources].map(([file,value])=>({file,bytes:value.bytes.length,
      sha256:sha(value.bytes),base64:value.bytes.toString('base64')})).sort((a,b)=>a.file.localeCompare(b.file));
    const packet={schema:CAPTURE_EXPORT_VERSION,captureId:original.manifest.captureId,
      sourceSignature:original.manifest.sourceSignature,exportedAt:stamp(),manifest,sources};
    return {...packet,sha256:sha(packet)};
  }finally{await release();}
}
function decodeExportMember(member,maximum){
  need(object(member)&&typeof member.base64==='string'&&/^[a-f0-9]{64}$/.test(member.sha256??''),
    'GRANTS_CAPTURE_EXPORT_MEMBER_INVALID');
  need(Number.isSafeInteger(member.bytes)&&member.bytes>0&&member.bytes<=maximum,
    'GRANTS_CAPTURE_EXPORT_TOO_LARGE');
  need(member.base64.length<=4*Math.ceil(maximum/3),'GRANTS_CAPTURE_EXPORT_TOO_LARGE');
  const bytes=Buffer.from(member.base64,'base64');
  need(bytes.toString('base64')===member.base64&&bytes.length===member.bytes&&sha(bytes)===member.sha256,
    'GRANTS_CAPTURE_EXPORT_DIGEST_MISMATCH');
  return bytes;
}
export function inspectCaptureExport(packet){
  need(object(packet)&&packet.schema===CAPTURE_EXPORT_VERSION,'GRANTS_CAPTURE_EXPORT_INVALID');
  const {sha256,...unsigned}=packet;
  need(sha(unsigned)===sha256,'GRANTS_CAPTURE_EXPORT_DIGEST_MISMATCH');
  need(packet.manifest?.file==='capture.json'&&Array.isArray(packet.sources)&&packet.sources.length<=260000,
    'GRANTS_CAPTURE_EXPORT_INVALID');
  const manifestBytes=decodeExportMember(packet.manifest,MAX_MANIFEST_BYTES);
  const manifest=validateManifest(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes)));
  need(packet.captureId===manifest.captureId&&packet.sourceSignature===manifest.sourceSignature,
    'GRANTS_CAPTURE_EXPORT_IDENTITY_MISMATCH');
  let total=manifestBytes.length;const sources=new Map();
  for(const member of packet.sources){
    need(allowedSourcePath(member.file)&&!sources.has(member.file),'GRANTS_CAPTURE_EXPORT_PATH_INVALID');
    const bytes=decodeExportMember(member,MAX_SOURCE_BYTES);total+=bytes.length;
    need(total<=MAX_EXPORT_BYTES,'GRANTS_CAPTURE_EXPORT_TOO_LARGE');
    const record=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),payload=decodeSourceRecord(record);
    const entry=sourceDescriptor(record,member.file,bytes);
    const value=record.kind==='search'?entry.startRecord:entry.opportunityId;
    need(member.file===sourcePath(sourceName(record.kind,value)),'GRANTS_SOURCE_PATH_MISMATCH');
    requestMatches(record,manifest.query,record.kind,value);
    sources.set(member.file,{record,payload,bytes});
  }
  for(const entry of [...manifest.pages,...manifest.details]){
    const source=sources.get(entry.file);need(source,'GRANTS_CAPTURE_EXPORT_INCOMPLETE');
    need(canonical(sourceDescriptor(source.record,entry.file,source.bytes))===canonical(entry),
      'GRANTS_CAPTURE_EXPORT_DESCRIPTOR_MISMATCH');
  }
  validateSources(manifest,sources);
  return {manifest,manifestBytes,sources,totalBytes:total};
}
export function readCaptureExport(packet){
  const inspected=inspectCaptureExport(packet);
  const {rowMap,details}=validateSources(inspected.manifest,inspected.sources);
  const accepted=new Set([...inspected.manifest.pages,...inspected.manifest.details].map(entry=>entry.file));
  const pending=[...inspected.sources].filter(([file])=>!accepted.has(file)).map(([file,value])=>
    sourceDescriptor(value.record,file,value.bytes));
  return captureView({...inspected,rowMap,details,pending});
}
async function atomicExact(directory,name,bytes){
  const temporary=join(directory,'.import-'+randomUUID());
  await createFile(temporary,bytes);await rename(temporary,join(directory,name));await syncDirectory(directory);
}
export async function importCapture(directory,packet){
  // Validate every byte, identity, descriptor and source/request join before a destination write.
  const incoming=inspectCaptureExport(packet);
  await privateDirectory(directory,true);await privateDirectory(join(directory,'sources'),true);
  const release=await acquireWorkspace(directory);
  try{
    const current=await optionalJson(join(directory,'capture.json'));
    if(current){
      validateManifest(current);
      need(current.captureId===incoming.manifest.captureId&&current.sourceSignature===incoming.manifest.sourceSignature,
        'GRANTS_CAPTURE_IMPORT_CONFLICT','The receiving capture directory already contains another original edition.');
      const currentBytes=await readPrivate(join(directory,'capture.json'),MAX_MANIFEST_BYTES);
      need(sha(currentBytes)===sha(incoming.manifestBytes),'GRANTS_CAPTURE_IMPORT_CONFLICT',
        'Preserve the existing acquisition journal; restore into another private directory.');
    }
    for(const [file,value] of incoming.sources){
      let existing;
      try{existing=await readPrivate(join(directory,file),MAX_SOURCE_BYTES);}
      catch(error){if(error.code!=='ENOENT')throw error;}
      if(existing)need(sha(existing)===sha(value.bytes),'GRANTS_CAPTURE_IMPORT_SOURCE_CONFLICT');
      else await atomicExact(join(directory,'sources'),basename(file),value.bytes);
    }
    if(!current)await atomicExact(directory,'capture.json',incoming.manifestBytes);
    const reopened=await readCapture(directory);
    need(reopened.sourceSignature===packet.sourceSignature&&reopened.captureId===packet.captureId,
      'GRANTS_CAPTURE_IMPORT_IDENTITY_MISMATCH');
    return reopened;
  }finally{await release();}
}
