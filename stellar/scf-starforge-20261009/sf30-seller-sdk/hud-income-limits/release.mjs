// MIT. Immutable official release custody and the maintained public XLSX reader.
import { constants } from 'node:fs';
import { open, readFile, mkdir, rename, rm, lstat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { bytes,digest,identity,readPrivate,readJson,createFile,privateDirectory,syncDirectory,fault,absolute,stamp } from '../postgres/publisher/files.mjs';
import { HASH,SCHEMA,releaseFiles,releaseMetadata,selection,observations,selectedLocality,queryDefinition } from './contract.mjs';

const INDEX_MAX=64*1024**2;
const exists=async path=>{try{await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const decode=raw=>new TextDecoder('utf-8',{fatal:true}).decode(raw);
async function originalFile(path,maximum){
  const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const before=await file.stat();
    if(!before.isFile()||before.size>maximum)throw fault('HUD_SOURCE_FILE_INVALID');
    const value=await file.readFile(),after=await file.stat();
    if(value.length!==before.size||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)
      throw fault('HUD_SOURCE_CHANGED_DURING_READ');
    return value;
  }finally{await file.close();}
}
function signature(item,raw){
  if(!raw.length||raw.length>item.maxBytes)throw fault('HUD_SOURCE_SIZE_INVALID');
  if(item.role==='workbook'&&raw.subarray(0,2).toString()!=='PK'||
    ['areas','methodology'].includes(item.role)&&raw.subarray(0,5).toString()!=='%PDF-')
    throw fault('HUD_SOURCE_CONTENT_CHANGED','The original '+item.role+' download is not its declared document format.');
  if(item.role==='index'&&!/Income Limits/i.test(decode(raw)))throw fault('HUD_INDEX_CONTENT_CHANGED');
}
function captureReceipt(item,raw,receipt){
  const final=receipt.final_url??receipt.url;
  if(receipt.status!==200||receipt.url!==item.url||final!==item.url||receipt.bytes!==raw.length||receipt.sha256!==digest(raw)||
    typeof receipt.retrieved_at!=='string'||!Number.isFinite(Date.parse(receipt.retrieved_at)))
    throw fault('HUD_CAPTURE_RECEIPT_MISMATCH','Retain the original HTTP 200 capture and exact '+item.role+' bytes.');
  return receipt;
}
async function download(item,signal){
  const response=await fetch(item.url,{redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(120000),...(signal?[signal]:[])]),
    headers:{accept:item.type}});
  if(response.status!==200)throw fault('HUD_DOWNLOAD_HTTP_'+response.status,'The official '+item.role+' source returned HTTP '+response.status+'.',502);
  const pieces=[];let size=0;
  for await(const chunk of response.body){
    size+=chunk.length;
    if(size>item.maxBytes)throw fault('HUD_SOURCE_SIZE_INVALID');
    pieces.push(chunk);
  }
  const raw=Buffer.concat(pieces);
  return {raw,receipt:{url:item.url,final_url:response.url||item.url,retrieved_at:stamp(),status:response.status,
    content_type:response.headers.get('content-type'),etag:response.headers.get('etag'),last_modified:response.headers.get('last-modified'),
    bytes:raw.length,sha256:digest(raw)}};
}
async function runReader(workbookPath,indexPath,expected,year,{python='python3',signal}={}){
  if(typeof python!=='string'||!python||python.includes('\0'))throw fault('HUD_PYTHON_EXECUTABLE_REQUIRED');
  const parserPath=new URL('../dataset-refresh/workbook/reader.py',import.meta.url);
  const workerPath=new URL('./hud-reader.py',import.meta.url);
  const parser=await open(parserPath,constants.O_RDONLY),source=await open(workbookPath,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  let output;
  try{
    output=await open(indexPath,'wx',0o600);
    const worker=await readFile(workerPath,'utf8');
    if(worker.length>262144)throw fault('HUD_WORKER_CAPACITY');
    return await new Promise((resolveResult,reject)=>{
      let result=[],length=0,problem;
      const child=spawn(python,['-I','-B','-c',worker],{shell:false,stdio:['pipe','pipe','pipe',source.fd,output.fd,parser.fd]});
      const fail=e=>{problem??=e;child.kill('SIGKILL');};
      const timer=setTimeout(()=>fail(fault('HUD_WORKBOOK_TIMEOUT','The original workbook exceeded the two-minute read budget.')),120000);
      const abort=()=>fail(fault('HUD_IMPORT_CANCELLED'));signal?.addEventListener('abort',abort,{once:true});
      if(signal?.aborted)abort();
      child.once('error',()=>{problem??=fault('HUD_WORKBOOK_PYTHON_UNAVAILABLE','Configure an installed Python 3.10+ executable.');});
      child.stdin.on('error',()=>{});let stderr=0;
      child.stderr.on('data',chunk=>{stderr+=chunk.length;if(stderr>65536)fail(fault('HUD_WORKBOOK_PROCESS_OUTPUT'));});
      child.stdout.on('data',chunk=>{length+=chunk.length;if(length>4*1024**2)fail(fault('HUD_WORKBOOK_RESULT_CAPACITY'));else result.push(chunk);});
      child.once('close',code=>{
        clearTimeout(timer);signal?.removeEventListener('abort',abort);
        if(problem)return reject(problem);
        let envelope;try{envelope=JSON.parse(decode(Buffer.concat(result)));}catch{return reject(fault('HUD_WORKBOOK_PROCESS_FAILED'));}
        if(code!==0||envelope.ok!==true)return reject(fault(envelope.error??'HUD_WORKBOOK_READ_FAILED',envelope.message??'Review the original workbook.'));
        resolveResult(envelope.result);
      });
      child.stdin.end(JSON.stringify({fiscalYear:year,source:expected}));
    });
  }finally{await Promise.allSettled([source.close(),parser.close(),output?.close()]);}
}
function releaseIdentity(value){
  return identity({schema:value.schema,fiscalYear:value.fiscalYear,effectiveDate:value.effectiveDate,
    files:value.files,
    projection:{schema:value.projection.schema,sheet:value.projection.sheet,columns:value.projection.columns,
      parserSha256:value.projection.parserSha256,indexSha256:value.projection.indexSha256,indexBytes:value.projection.indexBytes}});
}

/** Host-owned sourceDirectory is a public capture carrier. HTTP callers upload
 * document bytes or acquire the fixed official URLs; they never choose a path. */
export async function retainHudRelease(root,metadata,{sourceDirectory,uploads,python='python3',signal,onProgress=()=>{}}={}){
  const reviewed=releaseMetadata(metadata);await privateDirectory(root,true);
  if(sourceDirectory)absolute(sourceDirectory,'public capture directory');
  const pending=join(root,'.import-'+randomUUID());await mkdir(pending,{mode:0o700});
  let moved=false;
  try{
    const records={};
    for(const item of releaseFiles(reviewed.fiscalYear)){
      if(signal?.aborted)throw fault('HUD_IMPORT_CANCELLED');
      onProgress({phase:'retaining',role:item.role});
      let raw,receipt,receiptRaw;
      if(sourceDirectory){
        raw=await originalFile(join(sourceDirectory,item.name),item.maxBytes);
        const receiptName=item.role==='index'?'hud-income-limits-index.capture.json':item.name+'.capture.json';
        receiptRaw=await originalFile(join(sourceDirectory,receiptName),65536);
        try{receipt=JSON.parse(decode(receiptRaw));}catch{throw fault('HUD_CAPTURE_RECEIPT_INVALID');}
      }else if(uploads){
        raw=uploads[item.role]?.raw;receipt=uploads[item.role]?.receipt;
        receiptRaw=uploads[item.role]?.receiptRaw;
        if(receiptRaw!==undefined){
          if(!Buffer.isBuffer(receiptRaw)||receiptRaw.length>65536)throw fault('HUD_CAPTURE_RECEIPT_INVALID');
          try{receipt=JSON.parse(decode(receiptRaw));}catch{throw fault('HUD_CAPTURE_RECEIPT_INVALID');}
        }
        if(!Buffer.isBuffer(raw)||!receipt)throw fault('HUD_ALL_RELEASE_DOCUMENTS_REQUIRED');
      }else({raw,receipt}=await download(item,signal));
      signature(item,raw);captureReceipt(item,raw,receipt);receiptRaw??=bytes(receipt);
      await createFile(join(pending,item.name),raw);await createFile(join(pending,item.name+'.capture.json'),receiptRaw);
      records[item.role]={name:item.name,url:item.url,bytes:raw.length,sha256:digest(raw),type:item.type,
        capture:{name:item.name+'.capture.json',bytes:receiptRaw.length,sha256:digest(receiptRaw),retrievedAt:receipt.retrieved_at}};
    }
    onProgress({phase:'indexing'});
    const workbook=records.workbook;
    const projection=await runReader(join(pending,workbook.name),join(pending,'localities.jsonl'),
      {sha256:workbook.sha256,bytes:workbook.bytes},reviewed.fiscalYear,{python,signal});
    const manifest={schema:'stellar-forge.hud-income-limits-release.v1',fiscalYear:reviewed.fiscalYear,
      effectiveDate:reviewed.effectiveDate,program:'HUD Section 8 Income Limits',createdAt:stamp(),
      review:{reviewer:reviewed.reviewer,note:reviewed.note},files:records,projection};
    manifest.releaseId=releaseIdentity(manifest);
    await createFile(join(pending,'release.json'),bytes(manifest));await syncDirectory(pending);
    const target=join(root,manifest.releaseId);
    if(await exists(target)){
      const old=await readHudRelease(join(target,'release.json'),{expected:manifest.releaseId});
      return {manifest:old.manifest,directory:target,reused:true};
    }
    await rename(pending,target);moved=true;await syncDirectory(root);
    return {manifest,directory:target,reused:false};
  }finally{if(!moved)await rm(pending,{recursive:true,force:true});}
}
export async function readHudRelease(manifestFile,{expected,includeRows=true}={}){
  absolute(manifestFile,'HUD release manifest');
  const directory=dirname(manifestFile),raw=await readPrivate(manifestFile,4*1024**2);
  let manifest;try{manifest=JSON.parse(decode(raw));}catch{throw fault('HUD_RELEASE_JSON_INVALID');}
  if(manifest.schema!=='stellar-forge.hud-income-limits-release.v1'||!HASH.test(manifest.releaseId??'')||
    expected&&manifest.releaseId!==expected||releaseIdentity(manifest)!==manifest.releaseId)
    throw fault('HUD_RELEASE_IDENTITY_CHANGED');
  releaseMetadata({fiscalYear:manifest.fiscalYear,effectiveDate:manifest.effectiveDate,...manifest.review});
  for(const spec of releaseFiles(manifest.fiscalYear)){
    const record=manifest.files[spec.role];
    if(record?.name!==spec.name||record.url!==spec.url)throw fault('HUD_RELEASE_SOURCE_CHANGED');
    const data=await readPrivate(join(directory,record.name),spec.maxBytes);
    if(data.length!==record.bytes||digest(data)!==record.sha256)throw fault('HUD_RELEASE_SOURCE_CHANGED');
    signature(spec,data);
    if(record.capture?.name!==record.name+'.capture.json')throw fault('HUD_CAPTURE_RECEIPT_MISMATCH');
    const capture=await readPrivate(join(directory,record.capture.name),65536);
    if(capture.length!==record.capture.bytes||digest(capture)!==record.capture.sha256)throw fault('HUD_CAPTURE_RECEIPT_MISMATCH');
    captureReceipt(spec,data,JSON.parse(decode(capture)));
  }
  const index=await readPrivate(join(directory,'localities.jsonl'),INDEX_MAX);
  if(index.length!==manifest.projection.indexBytes||digest(index)!==manifest.projection.indexSha256)throw fault('HUD_LOCALITY_INDEX_CHANGED');
  const rows=includeRows?decode(index).trimEnd().split('\n').map(line=>JSON.parse(line)):null;
  if(rows&&rows.length!==manifest.projection.localityRows)throw fault('HUD_LOCALITY_COUNT_CHANGED');
  return {manifest,directory,manifestFile,raw,index,rows};
}
export async function readHudSource(sourceFile,{includeRows=true}={}){
  absolute(sourceFile,'HUD source file');
  const original=await readPrivate(sourceFile,65536);
  let config;try{config=JSON.parse(decode(original));}catch{throw fault('HUD_SOURCE_JSON_INVALID');}
  if(config.schema!==SCHEMA||typeof config.release!=='string'||!HASH.test(config.releaseId??''))throw fault('HUD_SOURCE_CONFIG_INVALID');
  const manifestFile=resolve(dirname(sourceFile),config.release);
  const retained=await readHudRelease(manifestFile,{expected:config.releaseId,includeRows});
  const chosen=selection(config.selection??{}),query=queryDefinition(retained.manifest,chosen);
  return {...retained,config,original,hash:digest(original),selection:chosen,queries:{limits:query}};
}
export async function writeHudSource(path,release,chosen={}){
  absolute(path,'HUD source file');
  const config={schema:SCHEMA,release:join(release.directory,'release.json'),releaseId:release.manifest.releaseId,selection:selection(chosen)};
  await createFile(path,bytes(config));return config;
}
export function inspectLocalities(retained,{selection:input={},search='',offset=0,limit=50}={}){
  const chosen=selection(input);
  if(typeof search!=='string'||search.length>200||!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>100)
    throw fault('HUD_LOCALITY_PAGE_INVALID');
  const query=search.trim().toLowerCase();
  const matching=retained.rows.filter(row=>selectedLocality(row,chosen)&&(!query||
    ['fips','state_name','County_Name','county_town_name','hud_area_code','hud_area_name'].some(key=>row.values[key].toLowerCase().includes(query))));
  return {releaseId:retained.manifest.releaseId,selection:chosen,selectionHash:identity(chosen),
    total:matching.length,offset,limit,next:offset+limit<matching.length?offset+limit:null,
    localities:matching.slice(offset,offset+limit).map(row=>({sourceRow:row.row,values:row.values,
      observations:observations(row,retained.manifest,chosen)}))};
}
export function compareHudReleases(before,after,input={}){
  const chosen=selection(input);
  const extract=release=>new Map(release.rows.flatMap(row=>observations(row,release.manifest,chosen))
    .map(row=>[row.locality_id+'|'+row.metric+'|'+(row.family_size??''),row]));
  const a=extract(before),b=extract(after),added=[],removed=[],changed=[],unchanged=[];
  for(const [key,value] of a){
    const next=b.get(key);
    if(!next)removed.push(value);
    else{
      const fields=['published_income_usd','hud_area_code','hud_area_name','county_name','locality_name'];
      const changes=fields.filter(field=>value[field]!==next[field]).map(field=>({field,before:value[field],after:next[field]}));
      (changes.length?changed:unchanged).push(changes.length?{key,before:value,after:next,changes}:key);
    }
  }
  for(const [key,value] of b)if(!a.has(key))added.push(value);
  return {schema:'stellar-forge.hud-published-selection-comparison.v1',
    before:{releaseId:before.manifest.releaseId,fiscalYear:before.manifest.fiscalYear,effectiveDate:before.manifest.effectiveDate},
    after:{releaseId:after.manifest.releaseId,fiscalYear:after.manifest.fiscalYear,effectiveDate:after.manifest.effectiveDate},
    selection:chosen,selectionHash:identity(chosen),counts:{added:added.length,removed:removed.length,changed:changed.length,unchanged:unchanged.length},
    added,removed,changed,unchanged};
}
export function publicSelection(retained,input={}){
  const chosen=selection(input),rows=retained.rows.flatMap(row=>observations(row,retained.manifest,chosen));
  return {schema:'stellar-forge.hud-published-selection.v1',release:retained.manifest,
    selection:chosen,selectionHash:identity(chosen),rowCount:rows.length,
    semantics:{unit:'annual USD',metric:'published HUD value',geography:'original HUD locality and income-limit area',
      additive:false,aggregation:'none',familySize:null,sourceCells:'original worksheet coordinates'},observations:rows};
}

/** Portable public-source custody: exact four HUD documents and four original
 * capture receipts. Workspace, seller, buyer and host configuration stay local. */
export async function hudSourcePacket(retained){
  const verified=await readHudRelease(retained.manifestFile,{expected:retained.manifest.releaseId,includeRows:false}),documents={};
  for(const [role,item]of Object.entries(verified.manifest.files)){
    const raw=await readPrivate(join(verified.directory,item.name),item.bytes);
    const capture=await readPrivate(join(verified.directory,item.capture.name),65536);
    if(digest(raw)!==item.sha256||digest(capture)!==item.capture.sha256)throw fault('HUD_RELEASE_SOURCE_CHANGED');
    documents[role]={base64:raw.toString('base64'),captureBase64:capture.toString('base64')};
  }
  return {schema:'stellar-forge.hud-public-source-packet.v1',release:verified.manifest,documents};
}
export function openHudSourcePacket(packet){
  if(packet?.schema!=='stellar-forge.hud-public-source-packet.v1'||!packet.release||
    !HASH.test(packet.release.releaseId??'')||releaseIdentity(packet.release)!==packet.release.releaseId)
    throw fault('HUD_SOURCE_PACKET_INVALID');
  const metadata=releaseMetadata({fiscalYear:packet.release.fiscalYear,effectiveDate:packet.release.effectiveDate,...packet.release.review}),uploads={};
  const fromBase64=(value,maximum)=>{
    if(typeof value!=='string'||value.length>Math.ceil(maximum/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw fault('HUD_SOURCE_PACKET_ENCODING');
    const raw=Buffer.from(value,'base64');if(raw.length>maximum||raw.toString('base64')!==value)throw fault('HUD_SOURCE_PACKET_ENCODING');return raw;
  };
  for(const item of releaseFiles(metadata.fiscalYear)){
    const record=packet.release.files[item.role],document=packet.documents?.[item.role];
    const raw=fromBase64(document?.base64,item.maxBytes),receiptRaw=fromBase64(document?.captureBase64,65536);
    if(record?.name!==item.name||record.url!==item.url||record.bytes!==raw.length||record.sha256!==digest(raw)||
      record.capture?.name!==item.name+'.capture.json'||record.capture.bytes!==receiptRaw.length||record.capture.sha256!==digest(receiptRaw))
      throw fault('HUD_SOURCE_PACKET_CHANGED');
    let receipt;try{receipt=JSON.parse(decode(receiptRaw));}catch{throw fault('HUD_CAPTURE_RECEIPT_INVALID');}
    signature(item,raw);captureReceipt(item,raw,receipt);uploads[item.role]={raw,receipt,receiptRaw};
  }
  return {metadata,uploads,releaseId:packet.release.releaseId};
}
