// MIT. Complete analysis-project transfer through the original SensorThings store.
import {open,link} from 'node:fs/promises';
import {join} from 'node:path';
import {constants} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {createGzip,createGunzip} from 'node:zlib';
import {Readable} from 'node:stream';
import {readOwned,privateDirectory,syncDir,atomicJSON} from '../../stellar-expert/store.mjs';
import {parseExactJSON} from '../../stellar-expert/exact-json.mjs';
import {identity,json,stable,sha,plain,fault,WORKSPACE_SCHEMA,sourceDocument,pointer} from '../contract.mjs';
import {validateSourceEdition,openPrivateFile,hashHeldFile,inspectRetainedFile,TRANSFER_LIMITS} from '../portable.mjs';
import {ANALYSIS_SCHEMA,ANALYSIS_LIMITS} from './schema.mjs';
import {safeFile,retainedPath,retainStream} from './artifacts.mjs';

export const PROJECT_TRANSFER_SCHEMA='stellar-forge.sensorthings-analysis-project-transfer.v1';
export const PROJECT_SNAPSHOT_SCHEMA='stellar-forge.sensorthings-analysis-project-snapshot.v1';
export const PROJECT_TRANSFER_LIMITS=Object.freeze({
  metadataBytes:24*1024*1024,archiveBytes:2*1024*1024*1024,expandedBytes:4*1024*1024*1024,
  objectBytes:TRANSFER_LIMITS.objectBytes,fileBytes:2*1024*1024*1024,chunkBytes:48*1024,members:120000,
  files:20000,versions:ANALYSIS_LIMITS.versions
});
const HASH=/^[a-f0-9]{64}$/,OP=/^[A-Za-z0-9_-]{8,100}$/,
  UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,
  FILE_SNAPSHOT='stellar-forge.sensorthings-analysis-project-receiving.v1';
const copy=v=>structuredClone(v);
const fail=(code,message,status=409)=>{throw fault('ANALYSIS_'+code,message,status);};
function hash(value,label){if(!HASH.test(value??''))fail('TRANSFER_ID','The '+label+' must retain its complete SHA256.');return value;}
function bytes(value,maximum,label){if(!Number.isSafeInteger(value)||value<0||value>maximum)fail('TRANSFER_CAPACITY','The '+label+' exceeds its supported exact byte range.',413);return value;}
function record(value,label){if(!plain(value))fail('TRANSFER_RECORD','The '+label+' must retain its original object.');return value;}
function array(value,label,maximum=PROJECT_TRANSFER_LIMITS.members){
  if(!Array.isArray(value)||value.length>maximum)fail('TRANSFER_RECORD','The complete '+label+' list is absent or exceeds capacity.');return value;
}
function unique(values,key,label){const m=new Map();for(const v of values){const k=key(v);if(m.has(k))fail('TRANSFER_DUPLICATE','The '+label+' repeats an identity.');m.set(k,v);}return m;}
function exactId(value,label){
  record(value,label);const {id,...body}=value;if(hash(id,label)!==identity(body))fail('TRANSFER_ID','The '+label+' differs from its retained content identity.');return id;
}
function operation(store,id,createdAt){
  const s=store.read();if(s.schema!==WORKSPACE_SCHEMA||!UUID.test(s.workspaceId??'')||!OP.test(id??'')||
    typeof createdAt!=='string'||!Number.isFinite(Date.parse(createdAt)))fail('TRANSFER_OPERATION','Use the original operation, creation time and native workspace.');
  return s.workspaceId;
}
function memberPath(value,{directory=false}={}){
  if(typeof value!=='string'||value.length>1024||(!value&&!directory)||value.startsWith('/')||/[\u0000-\u001f\u007f\\:]/u.test(value)||
    value.split('/').some((p,i,a)=>(!p&&!(directory&&i===a.length-1))||p==='.'||p==='..'))
    fail('TRANSFER_PATH','The original viewer has an unsafe member path.');
  return value;
}
function publicDescriptor(store,value){
  record(value,'held file descriptor');retainedPath(store,value);
  bytes(value.bytes,PROJECT_TRANSFER_LIMITS.fileBytes,'held file');if(typeof value.type!=='string'||value.type.length>200||/[\r\n\u0000]/.test(value.type))
    fail('TRANSFER_FILE','The retained file has no safe declared media type.');
  return copy(value);
}
function contentObject(objects,value,expected,label){
  const body=json(value),digest=sha(body);if(hash(expected,label)!==digest)fail('TRANSFER_CONTENT','The '+label+' does not match its exact retained bytes.');
  addObject(objects,{sha256:digest,bytes:body.length},label);return digest;
}
function addObject(objects,value,label){
  hash(value.sha256,label);bytes(value.bytes,PROJECT_TRANSFER_LIMITS.objectBytes,label);
  const prior=objects.get(value.sha256);if(prior&&prior.bytes!==value.bytes)fail('TRANSFER_OBJECT','A shared content hash has conflicting byte lengths.');
  objects.set(value.sha256,{sha256:value.sha256,bytes:value.bytes});
}
/** Validate the complete immutable graph without changing a source or workspace.
 * This is identity/closure validation, not a new source review or scientific approval. */
export function inspectProjectSnapshot(store,snapshot){
  record(snapshot,'project snapshot');
  if(snapshot.schema!==PROJECT_SNAPSHOT_SCHEMA||!UUID.test(snapshot.originalWorkspaceId??''))fail('TRANSFER_SCHEMA','Select the complete original analysis-project snapshot.');
  const project=record(snapshot.project,'analysis project');
  if(!OP.test(project.id??'')||!UUID.test(project.originWorkspaceId??''))fail('TRANSFER_PROJECT','The original project and originating workspace identities are absent.');
  const versions=unique(array(snapshot.versions,'versions',PROJECT_TRANSFER_LIMITS.versions),x=>record(x,'version entry').record?.id,'saved version');
  const editions=unique(array(snapshot.editions,'source editions'),x=>record(x,'edition entry').edition?.id,'source edition');
  const viewers=unique(array(snapshot.viewers,'viewer manifests',2000),v=>exactId(v,'viewer'),'viewer');
  const comparisons=unique(array(snapshot.comparisons,'comparisons',20000),x=>record(x,'comparison entry').record?.id,'comparison');
  const evidence=unique(array(snapshot.evidence,'evidence',20000),x=>exactId(x,'evidence'),'evidence');
  const publications=unique(array(snapshot.publications,'publications',20000),x=>record(x,'publication').id,'publication');
  const receipts=unique(array(snapshot.receipts,'receipts',20000),x=>exactId(x,'receiving evidence'),'receiving evidence');
  if(!versions.size||!versions.has(hash(project.headVersionId,'project head')))fail('TRANSFER_HEAD','The full snapshot omits its original project head.');
  record(snapshot.analysisContract,'analysis meaning');
  const objects=new Map(),files=new Map(),citations=[];
  function addFile(file){
    const f=publicDescriptor(store,file),key=f.storage.operationId+'/'+f.storage.filename,prior=files.get(key);
    if(prior&&stable(prior)!==stable(f))fail('TRANSFER_FILE','One original held-file path is claimed by different descriptors.');
    files.set(key,f);
  }
  for(const entry of editions.values()){
    const e=entry.edition;for(const m of validateSourceEdition(e))addObject(objects,m,'original source');
    for(const review of array(entry.reviews,'original source reviews',20000)){
      if(!plain(review)||review.editionId!==e.id)fail('TRANSFER_REVIEW','An original review belongs to another source edition.');
    }
  }
  for(const {record:r,version:v,summary:s} of versions.values()){
    record(r,'version record');record(v,'saved version');record(s,'saved summary');
    exactId(v,'version');
    if(v.schema!==ANALYSIS_SCHEMA||r.id!==v.id||v.projectId!==project.id||r.projectId!==project.id||
      r.editionId!==v.editionId||r.parentId!==v.parentId||r.title!==v.title||r.createdAt!==v.createdAt||
      !editions.has(v.editionId)||v.parentId!==null&&!versions.has(v.parentId))
      fail('TRANSFER_VERSION','A saved version loses its original project, parent, source or record binding.');
    contentObject(objects,v,r.sha256,'version record');contentObject(objects,s,r.summarySha256,'saved summary');
    const e=editions.get(v.editionId).edition,selection=record(v.selection,'saved selection');
    if(s.editionId!==v.editionId||stable(s.selection)!==stable(selection)||!['events','map','numeric'].includes(selection.view)||
      !Array.isArray(selection.streamKeys)||!selection.streamKeys.length||selection.streamKeys.length>ANALYSIS_LIMITS.streams||
      new Set(selection.streamKeys).size!==selection.streamKeys.length||
      selection.streamKeys.some(k=>!e.plan.streams.some(x=>x.key===k&&x.kind==='Datastreams'))||
      selection.viewerId!==null&&!viewers.has(selection.viewerId))
      fail('TRANSFER_SELECTION','The saved source/stream/view/summary binding is incomplete.');
    if(selection.timeBasis!=='phenomenonTime'||selection.intervalPolicy!=='source-explicit-only'||
      selection.instantPolicy!=='events-only'||selection.unresolvedTimePolicy!=='retain-unplaced')
      fail('TRANSFER_MEANING','The saved time/interval meaning is not this original analysis contract.');
    for(const a of array(v.annotations,'annotations',ANALYSIS_LIMITS.annotations)){
      record(a,'annotation');
      for(const ref of array(a.refs,'annotation source references',100)){
        const original=editions.get(ref.editionId)?.edition;
        if(!original||!original.sourceFiles.some(f=>f.sha256===ref.sha256)||typeof ref.jsonPointer!=='string')
          fail('TRANSFER_CITATION','An annotation loses its own original edition or source object.');
        if(ref.occurrenceId!==undefined)hash(ref.occurrenceId,'cited occurrence');
        citations.push({editionId:ref.editionId,sha256:hash(ref.sha256,'cited source'),jsonPointer:ref.jsonPointer});
      }
    }
  }
  // Detect a self-reference or parent cycle even when every named record exists.
  for(const {version:v}of versions.values()){
    const seen=new Set();let id=v.id;
    while(id!==null){if(seen.has(id))fail('TRANSFER_HISTORY','The immutable version history contains a cycle.');seen.add(id);id=versions.get(id).version.parentId;}
  }
  for(const {record:r,comparison:c}of comparisons.values()){
    record(r,'comparison record');exactId(c,'comparison');const v=versions.get(c.versionId)?.version;
    if(r.id!==c.id||r.projectId!==project.id||c.projectId!==project.id||!v||r.versionId!==v.id||
      r.leftEditionId!==c.leftEditionId||r.rightEditionId!==c.rightEditionId||v.editionId!==c.leftEditionId||
      !editions.has(c.rightEditionId)||stable(v.selection)!==stable(c.selection))
      fail('TRANSFER_COMPARISON','The original comparison belongs to another project/version/source selection.');
    contentObject(objects,c,r.sha256,'comparison record');
  }
  for(const v of viewers.values()){
    if(v.schema!=='stellar-forge.sensorthings-analysis-viewer.v1')fail('TRANSFER_VIEWER','The retained viewer has another manifest schema.');
    addObject(objects,v.archive,'viewer archive');
    const assets=unique(array(v.files,'viewer assets',10000),x=>memberPath(record(x,'viewer asset').path),'viewer asset path');
    for(const a of assets.values())addObject(objects,a,'original viewer asset');
    memberPath(v.prefix,{directory:true});memberPath(v.indexPath);memberPath(v.settingsPath);
    if(!assets.has(v.indexPath)||!assets.has(v.settingsPath)||!v.indexPath.startsWith(v.prefix)||!v.settingsPath.startsWith(v.prefix))
      fail('TRANSFER_VIEWER','The original viewer index/settings are outside its retained complete asset closure.');
    for(const a of unique(array(v.upstreamSources,'upstream source/licence files',10000),x=>memberPath(record(x,'upstream source').path),'upstream path').values())
      addObject(objects,a,'upstream source or licence');
    addObject(objects,{sha256:sha(json(v)),bytes:json(v).length},'viewer manifest');
  }
  for(const e of evidence.values()){
    if(e.projectId!==project.id||!versions.has(e.versionId))fail('TRANSFER_EVIDENCE','The retained evidence belongs to another project/version.');
    addFile(e.file);
  }
  for(const p of publications.values()){
    if(!OP.test(p.id??'')||p.projectId!==project.id||!versions.has(p.versionId))fail('TRANSFER_PUBLICATION','A retained publication has another project or saved version.');
    for(const file of array(p.files,'publication files',PROJECT_TRANSFER_LIMITS.files))addFile(file);
  }
  for(const r of receipts.values()){
    const p=publications.get(r.publicationId);
    if(r.projectId!==project.id||!p||r.versionId!==p.versionId)fail('TRANSFER_RECEIPT','The original receipt is not bound to the included publication/version.');
    addFile(r.file);
  }
  if(files.size>PROJECT_TRANSFER_LIMITS.files||objects.size+files.size>PROJECT_TRANSFER_LIMITS.members)
    fail('TRANSFER_CAPACITY','The full project exceeds the declared receiving member capacity.',413);
  const sortedObjects=[...objects.values()].sort((a,b)=>a.sha256.localeCompare(b.sha256)),
    sortedFiles=[...files.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([key,file])=>({key,file}));
  const sourceBytes=sortedObjects.reduce((n,f)=>n+f.bytes,0),fileBytes=sortedFiles.reduce((n,f)=>n+f.file.bytes,0);
  bytes(sourceBytes+fileBytes,PROJECT_TRANSFER_LIMITS.expandedBytes,'complete project closure');
  if(json(snapshot).length>PROJECT_TRANSFER_LIMITS.metadataBytes)fail('TRANSFER_CAPACITY','The complete project metadata exceeds its stated capacity.',413);
  return {objects:sortedObjects,files:sortedFiles,citations,sourceBytes,fileBytes};
}
function manifestFor(store,snapshot,id,createdAt){
  const closure=inspectProjectSnapshot(store,snapshot),manifest={schema:PROJECT_TRANSFER_SCHEMA,id,createdAt,
    workspaceSchema:WORKSPACE_SCHEMA,originalWorkspaceId:snapshot.originalWorkspaceId,snapshot:copy(snapshot),
    snapshotSha256:identity(snapshot),objects:closure.objects,files:closure.files,
    meaning:'Full immutable analysis, original source/asset/file bytes and attributed history. Native local source review is required after receiving; capture and payment operations are not replayed.'};
  if(json(manifest).length>PROJECT_TRANSFER_LIMITS.metadataBytes)fail('TRANSFER_CAPACITY','The full transfer manifest exceeds its stated capacity.',413);
  return {manifest,closure};
}
function validateManifest(store,manifest){
  record(manifest,'transfer manifest');
  if(manifest.schema!==PROJECT_TRANSFER_SCHEMA||manifest.workspaceSchema!==WORKSPACE_SCHEMA||
    manifest.originalWorkspaceId!==manifest.snapshot?.originalWorkspaceId||identity(manifest.snapshot)!==manifest.snapshotSha256||
    !OP.test(manifest.id??'')||typeof manifest.createdAt!=='string'||!Number.isFinite(Date.parse(manifest.createdAt)))
    fail('TRANSFER_MANIFEST','The complete original project manifest is inconsistent.');
  const closure=inspectProjectSnapshot(store,manifest.snapshot);
  if(stable(manifest.objects)!==stable(closure.objects)||stable(manifest.files)!==stable(closure.files))
    fail('TRANSFER_MANIFEST','The archive inventory differs from its complete source/file closure.');
  return closure;
}
function members(closure){
  return [...closure.objects.map(o=>({key:'object:'+o.sha256,kind:'object',...o})),
    ...closure.files.map(({key,file})=>({key:'file:'+key,kind:'file',sha256:file.sha256,bytes:file.bytes,storage:copy(file.storage)}))];
}
function memberMaximum(m){return m.kind==='object'?PROJECT_TRANSFER_LIMITS.objectBytes:PROJECT_TRANSFER_LIMITS.fileBytes;}
function memberTarget(store,m){
  return m.kind==='object'?join(store.root,'objects',m.sha256):join(store.root,'exports',m.storage.operationId,m.storage.filename);
}
function decode(bytesValue){
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytesValue);parseExactJSON(text);return JSON.parse(text);
}
function exactFields(value,allowed){
  if(!plain(value)||Object.keys(value).some(k=>!allowed.includes(k))||allowed.some(k=>!Object.hasOwn(value,k)))
    fail('TRANSFER_RECORD','An archive record has missing or undeclared fields.');
}
async function verifyCitations(closure,readObject){
  let lastHash=null,last=null;
  for(const r of [...closure.citations].sort((a,b)=>a.sha256.localeCompare(b.sha256))){
    if(r.sha256!==lastHash){last=sourceDocument(await readObject(r.sha256));lastHash=r.sha256;}
    if(pointer(last,r.jsonPointer)===undefined)fail('TRANSFER_CITATION','A cited pointer is absent from the exact original source bytes.');
  }
}
async function* heldChunks(handle,length,chunkSize=PROJECT_TRANSFER_LIMITS.chunkBytes){
  const buffer=Buffer.alloc(chunkSize);let offset=0;
  while(offset<length){const n=Math.min(buffer.length,length-offset),r=await handle.read(buffer,0,n,offset);
    if(r.bytesRead<1||r.bytesRead>n)fail('TRANSFER_CHANGED','A retained member ended before its complete byte count.');
    const data=Buffer.from(buffer.subarray(0,r.bytesRead));yield {offset,data};offset+=r.bytesRead;}
}
async function* archiveRecords(store,manifest,closure){
  yield Buffer.from(JSON.stringify({kind:'manifest',manifest})+'\n');
  for(const m of members(closure)){
    const held=await openPrivateFile(memberTarget(store,m),{expectedBytes:m.bytes,maximum:memberMaximum(m)});
    try{
      await hashHeldFile(held.handle,{expectedBytes:m.bytes,expectedSha256:m.sha256,maximum:memberMaximum(m)});
      yield Buffer.from(JSON.stringify({kind:'member',key:m.key,sha256:m.sha256,bytes:m.bytes})+'\n');
      for await(const {offset,data}of heldChunks(held.handle,m.bytes))
        yield Buffer.from(JSON.stringify({kind:'chunk',key:m.key,offset,bytes:data.length,base64:data.toString('base64')})+'\n');
      await hashHeldFile(held.handle,{expectedBytes:m.bytes,expectedSha256:m.sha256,maximum:memberMaximum(m)});
      yield Buffer.from(JSON.stringify({kind:'end',key:m.key,sha256:m.sha256,bytes:m.bytes})+'\n');
    }finally{await held.handle.close();}
  }
  yield Buffer.from(JSON.stringify({kind:'complete',manifestSha256:identity(manifest),members:members(closure).length})+'\n');
}
async function* boundedArchiveRecords(store,manifest,closure){
  let expandedBytes=0;
  for await(const record of archiveRecords(store,manifest,closure)){
    if(record.length-1>PROJECT_TRANSFER_LIMITS.metadataBytes)
      fail('TRANSFER_LINE','A framed project archive record exceeds receiving capacity.',413);
    expandedBytes+=record.length;
    if(expandedBytes>PROJECT_TRANSFER_LIMITS.expandedBytes)
      fail('TRANSFER_CAPACITY','The expanded framed project archive exceeds receiving capacity.',413);
    yield record;
  }
}
export async function exportProject(store,{snapshot,id,createdAt}){
  operation(store,id,createdAt);const {manifest,closure}=manifestFor(store,snapshot,id,createdAt);
  await verifyCitations(closure,h=>store.object(h));
  const input=Readable.from(boundedArchiveRecords(store,manifest,closure)),gzip=createGzip({level:6});
  input.on('error',e=>gzip.destroy(e));gzip.on('error',()=>input.destroy());input.pipe(gzip);
  let file;
  try{
    file=await retainStream(store,gzip,{operationId:id,createdAt,filename:'analysis-'+snapshot.project.id+'-project.ndjson.gz',
      type:'application/gzip',inputIdentity:{schema:PROJECT_TRANSFER_SCHEMA,snapshotSha256:manifest.snapshotSha256,manifestSha256:identity(manifest)},
      maximum:PROJECT_TRANSFER_LIMITS.archiveBytes});
  }finally{input.destroy();gzip.destroy();}
  return {schema:'stellar-forge.sensorthings-analysis-project-export.v1',id,projectId:snapshot.project.id,
    originalWorkspaceId:snapshot.originalWorkspaceId,headVersionId:snapshot.project.headVersionId,createdAt,
    manifestSha256:identity(manifest),snapshotSha256:manifest.snapshotSha256,objects:closure.objects.length,
    retainedFiles:closure.files.length,sourceBytes:closure.sourceBytes,retainedFileBytes:closure.fileBytes,file,
    meaning:manifest.meaning};
}
async function* readLines(handle){
  const input=handle.createReadStream({autoClose:false,start:0}),gzip=createGunzip();let buffered=Buffer.alloc(0),total=0;
  input.on('error',e=>gzip.destroy(e));gzip.on('error',()=>input.destroy());input.pipe(gzip);
  try{
    for await(const part of gzip){
      total+=part.length;if(total>PROJECT_TRANSFER_LIMITS.expandedBytes)fail('TRANSFER_CAPACITY','The expanded project archive exceeds capacity.',413);
      buffered=buffered.length?Buffer.concat([buffered,part]):part;let end;
      while((end=buffered.indexOf(10))!==-1){
        const line=buffered.subarray(0,end);buffered=buffered.subarray(end+1);
        if(!line.length||line.length>PROJECT_TRANSFER_LIMITS.metadataBytes)fail('TRANSFER_LINE','A project archive record exceeds capacity or is empty.',413);
        yield decode(line);
      }
      if(buffered.length>PROJECT_TRANSFER_LIMITS.metadataBytes)fail('TRANSFER_LINE','An incomplete archive record exceeds capacity.',413);
    }
    if(buffered.length)fail('TRANSFER_TRUNCATED','The complete project ends inside an archive record.');
  }finally{input.destroy();gzip.destroy();}
}
async function optionalJSON(path,maximum=PROJECT_TRANSFER_LIMITS.metadataBytes){
  try{return decode(await readOwned(path,maximum));}catch(e){if(e.code==='ENOENT')return null;throw e;}
}
async function publishMember(store,m,path){
  const target=memberTarget(store,m);
  if(m.kind==='file')await privateDirectory(join(store.root,'exports',m.storage.operationId),{create:true});
  const held=await openPrivateFile(path,{expectedBytes:m.bytes,maximum:memberMaximum(m)});
  try{
    await hashHeldFile(held.handle,{expectedBytes:m.bytes,expectedSha256:m.sha256,maximum:memberMaximum(m)});
    try{await link(path,target);await syncDir(join(target,'..'));}catch(e){if(e.code!=='EEXIST')throw e;}
    await inspectRetainedFile(target,{expectedBytes:m.bytes,expectedSha256:m.sha256,maximum:memberMaximum(m)});
  }finally{await held.handle.close();}
}
async function verifyPublished(store,manifest,closure){
  for(const m of members(closure))await inspectRetainedFile(memberTarget(store,m),{expectedBytes:m.bytes,expectedSha256:m.sha256,maximum:memberMaximum(m)});
  for(const {edition}of manifest.snapshot.editions)if(stable(await store.edition(edition.id))!==stable(edition))
    fail('TRANSFER_EDITION','The restored original edition differs from its complete manifest.');
  await verifyCitations(closure,h=>store.object(h));
}
export async function importProject(store,{inboxDirectory,filename,expectedSha256,expectedBytes,id,createdAt}){
  const receivingWorkspaceId=operation(store,id,createdAt);
  safeFile(filename);hash(expectedSha256,'input archive');bytes(expectedBytes,PROJECT_TRANSFER_LIMITS.archiveBytes,'input archive');
  if(!inboxDirectory||expectedBytes<1)fail('TRANSFER_SELECTION','Select the complete original project from the host-bound inbox.',400);
  const directory=await privateDirectory(join(store.root,'receipts',id),{create:true}),
    archive={filename,sha256:expectedSha256,bytes:expectedBytes},
    plan={schema:'stellar-forge.sensorthings-analysis-project-import-plan.v1',id,createdAt,receivingWorkspaceId,archive},
    planPath=join(directory,'analysis-project-plan.json'),manifestPath=join(directory,'analysis-project-manifest.json'),
    receiptPath=join(directory,'analysis-project-receiving.json');
  await store.immutable(planPath,json(plan));
  const prior=await optionalJSON(receiptPath);
  if(prior){
    const manifest=await optionalJSON(manifestPath);if(!manifest)fail('TRANSFER_RECEIPT','The completed receiving manifest is absent.');
    const closure=validateManifest(store,manifest);
    if(prior.schema!==FILE_SNAPSHOT||prior.id!==id||prior.createdAt!==createdAt||prior.receivingWorkspaceId!==receivingWorkspaceId||
      stable(prior.archive)!==stable(archive)||prior.manifestSha256!==identity(manifest)||prior.snapshotSha256!==manifest.snapshotSha256||
      prior.projectId!==manifest.snapshot.project.id||prior.reviewState!=='RECEIVING_REVIEW_REQUIRED')
      fail('TRANSFER_RECEIPT','The saved receiving receipt belongs to another exact original selection.');
    await verifyPublished(store,manifest,closure);return {snapshot:copy(manifest.snapshot),receipt:prior};
  }
  await privateDirectory(inboxDirectory);
  const held=await openPrivateFile(join(inboxDirectory,filename),{expectedBytes,maximum:PROJECT_TRANSFER_LIMITS.archiveBytes}),
    attemptId=randomUUID(),attempt=join(directory,'analysis-attempt-'+attemptId),
    attemptPath=join(directory,'analysis-attempt-'+attemptId+'.json'),
    started={schema:'stellar-forge.sensorthings-analysis-project-import-attempt.v1',id,attemptId,archive,
      planSha256:identity(plan),state:'STARTED',startedAt:new Date().toISOString()};
  let current=null,manifest=null,closure=null,inventory=null,index=0,complete=false;
  try{
    await hashHeldFile(held.handle,{expectedBytes,expectedSha256,maximum:PROJECT_TRANSFER_LIMITS.archiveBytes});
    await privateDirectory(attempt,{create:true});await store.immutable(attemptPath,json(started));
    for await(const r of readLines(held.handle)){
      if(!plain(r)||complete)fail('TRANSFER_ORDER','Unexpected bytes follow the complete original project.');
      if(!manifest){
        exactFields(r,['kind','manifest']);if(r.kind!=='manifest')fail('TRANSFER_ORDER','The project must start with its full original manifest.');
        manifest=r.manifest;closure=validateManifest(store,manifest);inventory=members(closure);continue;
      }
      if(r.kind==='member'){
        exactFields(r,['kind','key','sha256','bytes']);const m=inventory[index];
        if(current||!m||r.key!==m.key||r.sha256!==m.sha256||r.bytes!==m.bytes)
          fail('TRANSFER_ORDER','The project member is missing, repeated or out of order.');
        current={member:m,offset:0,digest:createHash('sha256'),handle:await open(join(attempt,String(index).padStart(8,'0')+'.member'),
          constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600)};continue;
      }
      if(r.kind==='chunk'){
        exactFields(r,['kind','key','offset','bytes','base64']);
        if(!current||r.key!==current.member.key||r.offset!==current.offset||!Number.isSafeInteger(r.bytes)||
          r.bytes<1||r.bytes>PROJECT_TRANSFER_LIMITS.chunkBytes||typeof r.base64!=='string'||
          r.base64.length>4*Math.ceil(PROJECT_TRANSFER_LIMITS.chunkBytes/3)||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(r.base64))
          fail('TRANSFER_CHUNK','An original project chunk has an invalid identity or range.');
        const b=Buffer.from(r.base64,'base64');
        if(b.length!==r.bytes||b.toString('base64')!==r.base64||current.offset+b.length>current.member.bytes)
          fail('TRANSFER_CHUNK','The original project chunk differs from its declared bytes.');
        await current.handle.writeFile(b);current.digest.update(b);current.offset+=b.length;continue;
      }
      if(r.kind==='end'){
        exactFields(r,['kind','key','sha256','bytes']);
        if(!current||r.key!==current.member.key||r.sha256!==current.member.sha256||r.bytes!==current.member.bytes||
          current.offset!==current.member.bytes||current.digest.digest('hex')!==current.member.sha256)
          fail('TRANSFER_MEMBER','An original project member failed its complete byte/hash verification.');
        await current.handle.sync();await current.handle.close();current=null;index++;continue;
      }
      if(r.kind==='complete'){
        exactFields(r,['kind','manifestSha256','members']);
        if(current||index!==inventory.length||r.members!==inventory.length||r.manifestSha256!==identity(manifest))
          fail('TRANSFER_INCOMPLETE','The complete project closure or final manifest binding is absent.');
        complete=true;continue;
      }
      fail('TRANSFER_RECORD','The archive contains an undeclared project record.');
    }
    if(!complete)fail('TRANSFER_INCOMPLETE','The original project archive ended before its completion record.');
    await hashHeldFile(held.handle,{expectedBytes,expectedSha256,maximum:PROJECT_TRANSFER_LIMITS.archiveBytes});
    const objectIndexes=new Map(inventory.map((m,i)=>[m.key,i]));
    await verifyCitations(closure,h=>readOwned(join(attempt,String(objectIndexes.get('object:'+h)).padStart(8,'0')+'.member'),PROJECT_TRANSFER_LIMITS.objectBytes));
    // All member bytes and cited-source positions are verified before publishing
    // create-only objects/files. The core alone adopts source/history state.
    for(let i=0;i<inventory.length;i++)await publishMember(store,inventory[i],join(attempt,String(i).padStart(8,'0')+'.member'));
    for(const {edition}of manifest.snapshot.editions)await store.saveEdition(edition);
    await store.immutable(manifestPath,json(manifest));
    const receipt={schema:FILE_SNAPSHOT,id,createdAt,projectId:manifest.snapshot.project.id,
      originalWorkspaceId:manifest.originalWorkspaceId,receivingWorkspaceId,originalHeadVersionId:manifest.snapshot.project.headVersionId,
      archive,manifestSha256:identity(manifest),snapshotSha256:manifest.snapshotSha256,objects:closure.objects.length,
      retainedFiles:closure.files.length,sourceBytes:closure.sourceBytes,retainedFileBytes:closure.fileBytes,receivingAttemptId:attemptId,
      reviewState:'RECEIVING_REVIEW_REQUIRED',originalReviews:manifest.snapshot.editions.map(x=>({editionId:x.edition.id,reviews:copy(x.reviews)})),
      meaning:'Original byte closure and editable histories verified. Existing local project heads and local review authority are preserved by the original core; no source acquisition, review decision or payment is replayed.'};
    await verifyPublished(store,manifest,closure);await store.immutable(receiptPath,json(receipt));
    await atomicJSON(attemptPath,{...started,state:'COMPLETE',completedAt:new Date().toISOString(),
      manifestSha256:receipt.manifestSha256,members:inventory.length}).catch(()=>{});
    return {snapshot:copy(manifest.snapshot),receipt};
  }catch(e){
    if(current?.handle)await current.handle.close().catch(()=>{});
    await atomicJSON(attemptPath,{...started,state:'FAILED',failedAt:new Date().toISOString(),
      completedMembers:index,error:{code:e.code??'ANALYSIS_PROJECT_IMPORT_FAILED',message:e.message}}).catch(()=>{});
    throw e;
  }finally{await held.handle.close();}
}
