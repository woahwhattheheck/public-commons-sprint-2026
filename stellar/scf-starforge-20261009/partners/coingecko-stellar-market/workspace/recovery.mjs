// MIT. Complete exact-source handover and separate-project restoration.
import {gzipSync,gunzipSync} from 'node:zlib';
import {readFileSync,readdirSync,statSync,existsSync} from 'node:fs';
import {resolve,relative,dirname,join,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {need,plain,sha,uuid,now,jsonBytes,base64,LIMITS,clone} from '../common.mjs';

const SCHEMA='stellar-forge.coingecko-handover.v1';
const featureRoot=fileURLToPath(new URL('../',import.meta.url));
const repositoryRoot=resolve(featureRoot,'../../../..');
const within=path=>{const rel=relative(repositoryRoot,path);return rel&&!rel.startsWith('..'+sep)&&rel!=='..'&&!rel.startsWith(sep)};
function runtimeSources(){
  const queue=[],seen=new Set(),files=[];
  function add(path){if(within(path)&&existsSync(path)&&statSync(path).isFile()&&!seen.has(path)){seen.add(path);queue.push(path)}}
  // Retain published product source, never an operator-selected state subtree.
  const productFiles=["common.mjs","exact-json.mjs","contracts.mjs","market.mjs","provider.mjs","cli.mjs","workspace/store.mjs","workspace/capture.mjs","workspace/model.mjs","workspace/jobs.mjs","workspace/native-worker.mjs","workspace/recovery.mjs","workspace/server.mjs","README.md","collection.example.json","runtime-dependencies.json","workspace/public/index.html","workspace/public/app.mjs","workspace/public/style.css"];
  productFiles.push(...["workspace/acceptance/collect-provider-sources.mjs","workspace/acceptance/sources.example.json","workspace/acceptance/launch-native.py","workspace/acceptance/native-environment.mjs","workspace/acceptance/native.example.json","workspace/acceptance/README.md","workspace/acceptance/run-browser.mjs"]);
  for(const name of productFiles)add(join(featureRoot,name));
  // SF88's original Python ledger initializer resolves this directory at runtime.
  add(resolve(featureRoot,'../../sf36-spend-governor/governor.py'));
  // Preserve the original provider-operated in-process facilitator option as well.
  add(resolve(featureRoot,'../../native-facilitator/runtime.mjs'));
  add(resolve(featureRoot,'../../distribution/distribution.json'));
  add(resolve(featureRoot,'../../sf61-openapi-seller-import/package.json'));
  add(resolve(featureRoot,'../../../../stellar-forge/payment-auto-catalog/package.json'));
  for(const name of ['LICENSE','LICENSE.md','package.json'])add(join(repositoryRoot,name));
  let bytesTotal=0;
  while(queue.length){
    const path=queue.shift(),bytes=readFileSync(path);bytesTotal+=bytes.length;
    need(bytesTotal<=32*1024*1024&&files.length<3000,'SOURCE_PACKAGE_TOO_LARGE');
    files.push({path:relative(repositoryRoot,path).split(sep).join('/'),sha256:sha(bytes),bytes:bytes.length,contentBase64:bytes.toString('base64')});
    if(extname(path)==='.py'){
      const python=bytes.toString('utf8');
      for(const match of python.matchAll(/^(?:from\s+([A-Za-z_][\w.]*)\s+import|import\s+([A-Za-z_][\w.]*))/gm)){
        add(resolve(dirname(path),(match[1]??match[2]).replaceAll('.','/')+'.py'));
      }
    }
    if(!['.mjs','.js','.cjs'].includes(extname(path)))continue;
    const text=bytes.toString('utf8');
    const patterns=[/(?:from\s*|import\s*\(|new\s+URL\s*\()\s*['"](\.[^'"]+)['"]/g,/import\s*['"](\.[^'"]+)['"]/g];
    for(const pattern of patterns)for(const match of text.matchAll(pattern)){
      const candidate=resolve(dirname(path),match[1]);
      if(extname(candidate))add(candidate);
    }
  }
  files.sort((a,b)=>a.path.localeCompare(b.path));
  return{schema:'stellar-forge.coingecko-runtime-source.v1',node:'24 or later',entry:relative(repositoryRoot,join(featureRoot,'cli.mjs')).split(sep).join('/'),
    dependencyMode:'Original Starforge source closure. Install the declared original x402 packages for native payment. Existing operator keys and live ledgers remain external.',
    files};
}
export function createProjectArchive(store,projectId,selection={}){
  const payload=store.exportProject(projectId),runtime=runtimeSources();
  const archive={schema:SCHEMA,createdAt:now(),selection,payload,runtime,
    payloadSha256:sha(jsonBytes(payload)),runtimeSha256:sha(jsonBytes(runtime)),
    contents:'Private original market sources, project history, original native summaries and runnable source; no signer keys or live payment ledgers.'};
  const raw=jsonBytes(archive);need(raw.length<=LIMITS.restoreExpandedBytes,'HANDOVER_TOO_LARGE','Complete handover exceeds the expanded restore limit');
  const bytes=gzipSync(raw,{level:6,mtime:0});need(bytes.length<=LIMITS.restoreBytes,'HANDOVER_TOO_LARGE','Compressed handover exceeds the restore limit');return bytes;
}
export function readProjectArchive(bytes){
  need(bytes instanceof Uint8Array&&bytes.length<=LIMITS.restoreBytes,'INVALID_HANDOVER');
  let archive;try{archive=JSON.parse(gunzipSync(bytes,{maxOutputLength:LIMITS.restoreExpandedBytes}).toString('utf8'))}
  catch{need(false,'INVALID_HANDOVER','The file is not a complete supported gzip handover')}
  need(archive?.schema===SCHEMA&&plain(archive.payload)&&plain(archive.runtime),'UNSUPPORTED_HANDOVER');
  need(archive.payloadSha256===sha(jsonBytes(archive.payload))&&archive.runtimeSha256===sha(jsonBytes(archive.runtime)),
    'HANDOVER_HASH_MISMATCH','The retained handover payload or source manifest changed');
  const p=archive.payload;
  need(plain(p.project)&&Array.isArray(p.records)&&Array.isArray(p.versions)&&Array.isArray(p.files)&&
    plain(p.blobs)&&Array.isArray(p.rows)&&Array.isArray(p.events),'INVALID_HANDOVER_STRUCTURE');
  need(p.records.length<=100000&&p.rows.length<=1000000&&p.files.length<=100000&&p.versions.length<=1000000,
    'HANDOVER_TOO_COMPLEX');
  for(const file of p.files){
    need(typeof file.sha256==='string'&&/^[a-f0-9]{64}$/.test(file.sha256)&&Number.isSafeInteger(file.bytes),'INVALID_SOURCE_MANIFEST');
    const bytes=base64(p.blobs[file.sha256],LIMITS.restoreExpandedBytes);
    need(bytes.length===file.bytes&&sha(bytes)===file.sha256,'ORIGINAL_SOURCE_HASH_MISMATCH');
  }
  need(Array.isArray(archive.runtime.files)&&archive.runtime.files.length<=3000,'INVALID_RUNTIME_MANIFEST');
  for(const file of archive.runtime.files){
    need(typeof file.path==='string'&&!file.path.startsWith('/')&&!file.path.includes('\\')&&
      file.path.split('/').every(part=>part&&part!=='.'&&part!=='..'),'INVALID_RUNTIME_PATH');
    const bytes=base64(file.contentBase64,32*1024*1024);
    need(file.bytes===bytes.length&&file.sha256===sha(bytes),'RUNTIME_SOURCE_HASH_MISMATCH');
  }
  return archive;
}
export function restoreProjectArchive(store,bytes,{name,actor}){
  const archive=readProjectArchive(bytes),p=archive.payload;
  const project=store.newProject(name,{...p.project.config,buyerProfileId:''}),mapping={
    project:{[p.project.id]:project.id},records:{},files:{},rows:{}};
  const kinds=new Set(['requests','collections','captures','jobs','snapshots','comparisons','notes','providerPlans','exports']);
  for(const record of p.records){
    need(kinds.has(record.kind)&&plain(record.value)&&record.value.projectId===p.project.id,'INVALID_RETAINED_RECORD');
    need(!mapping.records[record.value.id],'DUPLICATE_RETAINED_RECORD');mapping.records[record.value.id]=uuid();
  }
  for(const file of p.files){
    need(file.projectId===p.project.id&&!mapping.files[file.id],'INVALID_RETAINED_FILE');
    const created=store.file(project.id,file.name,file.contentType,base64(p.blobs[file.sha256],LIMITS.restoreExpandedBytes));
    store.db.prepare('UPDATE files SET created=? WHERE id=?').run(file.createdAt,created.id);
    mapping.files[file.id]=created.id;
  }
  for(const row of p.rows){
    need(mapping.records[row.ownerId]&&plain(row.value),'INVALID_RETAINED_ROW');
    mapping.rows[row.value.id]??=uuid();
  }
  const rid=value=>value===null||value===undefined?value:mapping.records[value]??value;
  const fid=value=>value===null||value===undefined?value:mapping.files[value]??value;
  const mapRequest=request=>request?{...clone(request),id:rid(request.id),projectId:project.id,
    ...(request.importFileId?{importFileId:fid(request.importFileId)}:{})}:request;
  const mapRow=row=>{
    if(!row)return row;
    const value={...clone(row),id:mapping.rows[row.id]??row.id};
    if(value.sourceCaptureId)value.sourceCaptureId=rid(value.sourceCaptureId);
    if(value.baselineRow)value.baselineRow=mapRow(value.baselineRow);
    if(value.currentRow)value.currentRow=mapRow(value.currentRow);
    return value;
  };
  function mapRecord(kind,input){
    const v={...clone(input),id:rid(input.id),projectId:project.id};
    for(const key of ['requestId','collectionId','parentCaptureId','baselineId','currentId','snapshotId','comparisonId'])if(v[key])v[key]=rid(v[key]);
    for(const key of ['fileId','bodyFileId','headersFileId','challengeFileId','sourceFileId','importFileId'])if(v[key])v[key]=fid(v[key]);
    for(const key of ['requestIds','captureIds'])if(Array.isArray(v[key]))v[key]=v[key].map(rid);
    for(const key of ['sourceFileIds','nativeSourceFileIds'])if(Array.isArray(v[key]))v[key]=v[key].map(fid);
    if(v.request)v.request=mapRequest(v.request);
    if(kind==='notes')v.targetId=v.targetType==='row'?(mapping.rows[v.targetId]??v.targetId):rid(v.targetId);
    if(kind==='jobs'){
      v.items=v.items.map(item=>({...item,requestId:rid(item.requestId),request:mapRequest(item.request),
        ...(item.captureId?{captureId:rid(item.captureId)}:{}),
        ...(item.resultCaptureId?{resultCaptureId:rid(item.resultCaptureId)}:{}),
        nativeSourceFileIds:(item.nativeSourceFileIds??[]).map(fid)}));
      v.originalStatus=v.originalStatus??v.status;v.status='archived';v.restored=true;
      v.restoredFrom={projectId:p.project.id,jobId:input.id,archiveSha256:sha(bytes)};
    }
    if(kind==='exports')v.available=false;
    return v;
  }
  for(const record of p.records){
    const value=mapRecord(record.kind,record.value);
    // Store.put establishes indexes; restore then reinstates the exact retained
    // version and timestamps. No native queue, signer or executor is opened.
    const inserted=store.put(record.kind,value,{history:false});
    store.db.prepare('DELETE FROM versions WHERE id=?').run(inserted.id);
    store.db.prepare('UPDATE records SET version=?,created=?,updated=?,value=? WHERE id=?')
      .run(value.version,value.createdAt,value.updatedAt,JSON.stringify(value),value.id);
  }
  for(const version of p.versions){
    need(kinds.has(version.kind)&&mapping.records[version.value.id],'INVALID_RETAINED_VERSION');
    const value=mapRecord(version.kind,version.value);
    store.db.prepare('INSERT OR IGNORE INTO versions VALUES(?,?,?,?,?,?)')
      .run(value.id,project.id,version.kind,value.version,value.updatedAt??value.createdAt,JSON.stringify(value));
  }
  // Include every current state even when an in-progress job did not write a
  // redundant full version on each progress tick.
  for(const record of p.records){
    const value=mapRecord(record.kind,record.value);
    store.db.prepare('INSERT OR IGNORE INTO versions VALUES(?,?,?,?,?,?)')
      .run(value.id,project.id,record.kind,value.version,value.updatedAt??value.createdAt,JSON.stringify(value));
  }
  const grouped=new Map();
  for(const row of p.rows){
    const owner=rid(row.ownerId);if(!grouped.has(owner))grouped.set(owner,[]);grouped.get(owner).push(mapRow(row.value));
  }
  for(const[owner,rows]of grouped)store.setRows(owner,project.id,rows);
  for(const event of p.events)store.event(project.id,event.actor,event.kind,rid(event.recordId),
    {originalEvent:event,restoredFromProjectId:p.project.id});
  store.event(project.id,actor,'handover.original-restored',project.id,
    {archiveSha256:sha(bytes),originalProjectId:p.project.id,originalPayloadSha256:archive.payloadSha256,
      exactSourceCount:p.files.length,retainedNativeJobsHistorical:true});
  return{project:store.project(project.id),mapping,sourceArchiveSha256:sha(bytes)};
}
