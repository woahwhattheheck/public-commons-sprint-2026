// MIT. Complete original Matomo archives and independently editable receiving.
// The archive engine is the maintained source_bundle_archive.py. Source reads,
// merchant configuration and all later effects stay in the original workspace.
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {lstat,readdir} from 'node:fs/promises';
import {resolve,join,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {acquireWorkspace,privateDirectory,hashPrivate,bytes,identity,digest,fault,stamp} from '../postgres/publisher/files.mjs';
import {readRetained,readRetainedJson,writeNew} from './store.mjs';
import {identifier,only,sourceConfig,HASH,integer} from './contract.mjs';

export const MATOMO_PRODUCT_SCHEMA='stellar-forge.matomo-authoring-workspace.v1';
export const MATOMO_PRODUCT_LIMITS=Object.freeze({fileBytes:8*1024**3,workspaceBytes:16*1024**3,archiveBytes:16*1024**3+16*1024**2,members:20000});
const RECEIVED='stellar-forge.matomo-received-source.v1',REQUEST='stellar-forge.matomo-product-receiving.v1';
const RECEIPT='stellar-forge.matomo-product-received.v1';
const PYTHON=fileURLToPath(new URL('./workspace-transfer.py',import.meta.url));
const TABLES=Object.freeze(['actions','history','merchants','merchant_packages','deliveries','handovers','receivings','catalogs','captures','editions','comparisons','edition_reviews','comparison_reviews']);
function canonical(value){if(typeof value!=='string'||!isAbsolute(value)||resolve(value)!==value||/[\x00-\x1f\x7f]/.test(value))throw fault('MATOMO_PRODUCT_CANONICAL_PATH_REQUIRED');return value;}
function archivePin(value){if(!value||!HASH.test(value.sha256??'')||typeof value.bytes!=='string'||!/^(0|[1-9][0-9]*)$/.test(value.bytes)||BigInt(value.bytes)>BigInt(MATOMO_PRODUCT_LIMITS.archiveBytes))throw fault('MATOMO_PRODUCT_ARCHIVE_PIN_INVALID');return {bytes:value.bytes,sha256:value.sha256};}
async function exists(path){try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
function native(command,input,{python=process.env.MATOMO_PYTHON??'python3',environment=process.env,signal}={}){
  if(typeof python!=='string'||!python||python.includes('\0'))throw fault('MATOMO_PRODUCT_PYTHON_REQUIRED');
  return new Promise((done,fail)=>{
    let child,settled=false,output=[],errors=[],length=0,errorLength=0,killTimer,issue;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(killTimer);signal?.removeEventListener('abort',abort);if(error)fail(error);else done(value);};
    const abort=()=>{issue=fault('MATOMO_PRODUCT_CANCELLED');child?.kill('SIGTERM');killTimer=setTimeout(()=>child?.kill('SIGKILL'),5000);killTimer.unref?.();};
    if(signal?.aborted){finish(fault('MATOMO_PRODUCT_CANCELLED'));return;}
    try{child=spawn(python,[PYTHON,command],{env:{...environment,PYTHONDONTWRITEBYTECODE:'1'},stdio:['pipe','pipe','pipe'],shell:false});}
    catch(error){finish(fault('MATOMO_PRODUCT_PYTHON_FAILED'));return;}
    signal?.addEventListener('abort',abort,{once:true});
    child.on('error',()=>{issue=fault('MATOMO_PRODUCT_PYTHON_FAILED');});
    child.stdout.on('data',chunk=>{length+=chunk.length;if(length>34603008){issue=fault('MATOMO_PRODUCT_OUTPUT_LIMIT');child.kill('SIGTERM');}else output.push(chunk);});
    child.stderr.on('data',chunk=>{errorLength+=chunk.length;if(errorLength<=65536)errors.push(chunk);});
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(input));
    child.on('close',code=>{
      if(issue){finish(issue);return;}
      if(code!==0){let value;try{value=JSON.parse(Buffer.concat(errors).toString('utf8'));}catch{}
        finish(fault(/^[A-Z][A-Z0-9_]{0,127}$/.test(value?.error??'')?value.error:'MATOMO_PRODUCT_NATIVE_FAILED'));return;}
      try{finish(null,JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(output))));}
      catch{finish(fault('MATOMO_PRODUCT_NATIVE_RESULT_INVALID'));}
    });
  });
}
export async function exportMatomoProduct({directory,archive,operationId,...options}={}){
  identifier(operationId);canonical(directory);canonical(archive);
  return native('export',{directory,archive,operationId},options);
}
export async function inspectMatomoProduct({archive,...options}={}){
  canonical(archive);const value=await native('inspect',{archive},options);
  if(value.manifest?.schema!==MATOMO_PRODUCT_SCHEMA)throw fault('MATOMO_PRODUCT_ARCHIVE_SCHEMA');
  archivePin(value.archive);return value;
}
export async function receiveMatomoProduct({archive,directory,operationId,allowLoopback=false,...options}={}){
  canonical(archive);canonical(directory);identifier(operationId);
  const inspected=await inspectMatomoProduct({archive,...options}),pin=archivePin(inspected.archive),source=sourceConfig(inspected.manifest.snapshot.source,{allowLoopback});
  if(inspected.receivingBudget?.status!=='WITHIN_POLICY_BEFORE_NEW_METADATA')throw fault('MATOMO_PRODUCT_RECEIVING_EXPORT_BUDGET_EXCEEDED','Inspect the archive receivingBudget before selecting this complete editable receiving path.',400);
  await privateDirectory(dirname(directory),false);
  if(!await exists(directory)){await privateDirectory(directory,true);}
  else await privateDirectory(directory,false);
  const release=await acquireWorkspace(directory);let model;
  try{
    const path=join(directory,'request.json'),requestValue={schema:REQUEST,operationId,archive:pin,
      originalWorkspaceId:inspected.manifest.snapshot.workspaceId,sourceSha256:inspected.manifest.snapshot.sourceSha256};
    let request;
    if(await exists(path)){request=await readRetainedJson(path,65536);const {createdAt,...retainedIdentity}=request;if(identity(retainedIdentity)!==identity(requestValue))throw fault('MATOMO_PRODUCT_RECEIVING_IDENTITY_CONFLICT');}
    else{
      const names=await readdir(directory);
      if(names.some(name=>!['publisher.lock','request.json.matomo-pending'].includes(name)))throw fault('MATOMO_PRODUCT_RECEIVING_DIRECTORY_NOT_EMPTY');
      request={...requestValue,createdAt:stamp()};await writeNew(path,bytes(request));
    }
    const working=join(directory,'workspace'),requestSha256=digest(await readRetained(path,65536));
    const openOptions={directory:working,create:!await exists(join(working,'workspace.json')),source,
      environment:options.environment??process.env,python:options.python,allowLoopback,receivingOperationId:operationId};
    const {openMatomoWorkspace}=await import('./model.mjs');
    model=await openMatomoWorkspace(openOptions);
    if(model.store.settings.sourceSha256!==inspected.manifest.snapshot.sourceSha256)throw fault('MATOMO_PRODUCT_SOURCE_IDENTITY_CHANGED');
    const pending={schema:REQUEST,operationId,requestSha256,archive:pin};
    await writeNew(join(working,'product-receiving.json'),bytes(pending));
    const completed=join(working,'product-received.json');
    if(await exists(completed)){
      const receipt=await readRetainedJson(completed,1048576);
      if(receipt.schema!==RECEIPT||receipt.operationId!==operationId||receipt.requestSha256!==requestSha256||receipt.workspaceId!==model.store.settings.id||identity(receipt.archive)!==identity(pin))throw fault('MATOMO_PRODUCT_RECEIVING_CHANGED');
      // Editable local rows may legitimately have advanced after receiving.
      const origin=model.origin??await createMatomoProductOrigin(model.store,options);try{await origin?.verify();}finally{if(origin!==model.origin)await origin?.close();}
      await writeNew(join(directory,'result.json'),bytes(receipt));
      return {...receipt,directory:working,currentRevision:model.store.revision(),reused:true};
    }
    const files=await native('receive-files',{archive,directory:working,archivePin:pin},options);
    const manifestSha256=files.manifestSha256;if(!HASH.test(manifestSha256??''))throw fault('MATOMO_PRODUCT_NATIVE_RESULT_INVALID');
    if(files.original!=='received/'+pin.sha256+'/original'||identity(files.archive)!==identity(pin))throw fault('MATOMO_PRODUCT_NATIVE_RESULT_INVALID');
    await native('populate',{directory:working,original:files.original,snapshot:files.manifest.snapshot,archivePin:pin},options);
    const received={schema:RECEIVED,operationId,workspaceId:model.store.settings.id,sourceSha256:model.store.settings.sourceSha256,
      archive:{...pin,path:'received/'+pin.sha256+'/source.zip'},manifestSha256,original:files.original,
      snapshot:files.manifest.snapshot,receivingBudget:inspected.receivingBudget,receivedAt:request.createdAt,mode:'independent-editable-source'};
    await writeNew(join(working,'received-source.json'),bytes(received));
    const marker=model.store.db.prepare("SELECT value FROM received_source_state WHERE key='event'").get();
    if(!marker)model.store.transaction(()=>{
      model.store.event('SOURCE_WORKSPACE_RECEIVED',operationId,{archiveSha256:pin.sha256,
        originalWorkspaceId:received.snapshot.workspaceId,sourceSha256:received.sourceSha256,mode:received.mode});
      model.store.db.prepare("INSERT INTO received_source_state(key,value) VALUES('event',?)").run(JSON.stringify({operationId,requestSha256}));
    });
    else if(identity(JSON.parse(marker.value))!==identity({operationId,requestSha256}))throw fault('MATOMO_PRODUCT_RECEIVING_CHANGED');
    const receipt={schema:RECEIPT,operationId,requestSha256,workspaceId:model.store.settings.id,archive:pin,
      sourceSha256:received.sourceSha256,originalWorkspaceId:received.snapshot.workspaceId,mode:received.mode,
      sourceCounts:received.snapshot.counts,receivingBudget:inspected.receivingBudget,completedAt:stamp(),revision:model.store.revision()};
    await writeNew(completed,bytes(receipt));
    await writeNew(join(directory,'result.json'),bytes(receipt));
    return {...receipt,directory:working,currentRevision:model.store.revision(),reused:false};
  }finally{try{await model?.close();}finally{await release();}}
}
export async function createMatomoProductOrigin(store,options={}){
  const path=join(store.directory,'received-source.json');
  if(!await exists(path)){if(await exists(join(store.directory,'product-received.json')))throw fault('MATOMO_PRODUCT_ORIGIN_MISSING');return null;}
  const received=await readRetainedJson(path,1048576),pin=archivePin(received.archive);
  if(received.schema!==RECEIVED||received.workspaceId!==store.settings.id||received.sourceSha256!==store.settings.sourceSha256||
    received.original!=='received/'+pin.sha256+'/original'||received.archive.path!=='received/'+pin.sha256+'/source.zip'||
    !HASH.test(received.manifestSha256??''))throw fault('MATOMO_PRODUCT_ORIGIN_INVALID');
  const root=join(store.directory,received.original);await privateDirectory(root,false);
  const archiveStat=await lstat(join(store.directory,received.archive.path));if(!archiveStat.isFile()||archiveStat.isSymbolicLink()||archiveStat.nlink!==1||archiveStat.mode&0o077||String(archiveStat.size)!==pin.bytes)throw fault('MATOMO_PRODUCT_ARCHIVE_CHANGED');
  const manifestRaw=await readRetained(join(root,'received-workspace.json'),33554432);
  if(digest(manifestRaw)!==received.manifestSha256)throw fault('MATOMO_PRODUCT_ORIGINAL_MANIFEST_CHANGED');
  const manifest=JSON.parse(manifestRaw);
  if(manifest.schema!==MATOMO_PRODUCT_SCHEMA||identity(manifest.snapshot)!==identity(received.snapshot))throw fault('MATOMO_PRODUCT_ORIGIN_CHANGED');
  const members=new Map(manifest.files.map(file=>[file.path,file]));
  const releaseOriginal=await acquireWorkspace(root);let originalReleased=false;
  let database,opening,closed=false;
  async function selectedFile(name){
    if(!members.has(name)&&HASH.test(name??''))name=[...members.keys()].find(path=>digest(Buffer.from(path))===name)??name;
    const item=members.get(name);
    if(!item||typeof name!=='string'||name.startsWith('/')||name.split('/').some(x=>!x||x==='.'||x==='..')||name.includes('\\'))throw fault('MATOMO_PRODUCT_ORIGINAL_FILE_NOT_FOUND',undefined,404);
    const target=join(root,name);await privateDirectory(dirname(target),false);const hash=await hashPrivate(target,MATOMO_PRODUCT_LIMITS.fileBytes);
    if(hash.hash!==item.sha256||String(hash.bytes)!==item.bytes)throw fault('MATOMO_PRODUCT_ORIGINAL_FILE_CHANGED');
    return {path:target,name:name.split('/').pop(),mediaType:'application/octet-stream',sha256:item.sha256,byteLimit:MATOMO_PRODUCT_LIMITS.fileBytes};
  }
  async function openDatabase(){
    if(closed)throw fault('MATOMO_PRODUCT_ORIGIN_CLOSED');if(database)return database;if(opening)return opening;
    opening=(async()=>{const file=await selectedFile('matomo.sqlite');database=new DatabaseSync(file.path,{readOnly:true});database.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;');return database;})();
    try{return await opening;}finally{opening=null;}
  }
  const summary=()=>({schema:RECEIVED,operationId:received.operationId,workspaceId:received.workspaceId,
    originalWorkspaceId:received.snapshot.workspaceId,sourceSha256:received.sourceSha256,archive:pin,
    originalRevision:received.snapshot.revision,receivedAt:received.receivedAt,mode:received.mode,
    counts:received.snapshot.counts,receivingBudget:received.receivingBudget??null,manifestSha256:received.manifestSha256});
  async function page({table='history',offset=0,limit=25}={}){
    if(!TABLES.includes(table))throw fault('MATOMO_PRODUCT_ORIGINAL_TABLE_INVALID');
    integer(offset,0,0,Number.MAX_SAFE_INTEGER,'MATOMO_PRODUCT_OFFSET_INVALID');integer(limit,25,1,50,'MATOMO_PRODUCT_LIMIT_INVALID');
    const db=await openDatabase();
    if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))return {table,offset,limit,total:0,rows:[]};
    const total=db.prepare('SELECT COUNT(*) AS n FROM "'+table+'"').get().n;
    const rows=db.prepare('SELECT * FROM "'+table+'" ORDER BY rowid DESC LIMIT ? OFFSET ?').all(limit,offset).map(row=>{
      const value={...row};for(const key of ['data','scope','selection','input','result','error'])if(typeof value[key]==='string'){try{value[key]=JSON.parse(value[key]);}catch{}}
      return value;
    });
    return {table,offset,limit,total,rows};
  }
  function files({offset=0,limit=25}={}){
    integer(offset,0,0,Number.MAX_SAFE_INTEGER,'MATOMO_PRODUCT_OFFSET_INVALID');integer(limit,25,1,50,'MATOMO_PRODUCT_LIMIT_INVALID');
    return {offset,limit,total:manifest.files.length,rows:manifest.files.slice(offset,offset+limit).map(file=>({...file,id:digest(Buffer.from(file.path))}))};
  }
  async function merchant(id){
    identifier(id);const db=await openDatabase(),row=db.prepare('SELECT * FROM merchants WHERE id=?').get(id);
    if(!row)throw fault('MATOMO_PRODUCT_ORIGINAL_MERCHANT_NOT_FOUND',undefined,404);
    const data=JSON.parse(row.data),name='merchant/'+id+'/workbench/draft.json',file=await selectedFile(name);
    const raw=await readRetained(file.path,4194304),value=JSON.parse(raw);
    if(value.schema!=='stellar-forge.sqlite-workbench.v1'||!value.draft||!data.configuration)throw fault('MATOMO_PRODUCT_ORIGINAL_DRAFT_INVALID');
    return {merchant:{...row,data},draft:value.draft,configuration:data.configuration,editionId:row.edition_id,
      provenance:{schema:'stellar-forge.matomo-received-merchant-draft.v1',archiveSha256:pin.sha256,
        originalWorkspaceId:received.snapshot.workspaceId,merchantId:id,path:name,draftSha256:digest(raw)}};
  }
  async function archiveFile(){
    const target=join(store.directory,received.archive.path);await privateDirectory(dirname(target),false);const hash=await hashPrivate(target,MATOMO_PRODUCT_LIMITS.archiveBytes);
    if(hash.hash!==pin.sha256||String(hash.bytes)!==pin.bytes)throw fault('MATOMO_PRODUCT_ARCHIVE_CHANGED');
    return {path:target,name:'matomo-workspace-'+pin.sha256.slice(0,16)+'.zip',mediaType:'application/zip',sha256:pin.sha256,byteLimit:MATOMO_PRODUCT_LIMITS.archiveBytes};
  }
  async function verify(){
    const result=await native('inspect',{archive:join(store.directory,received.archive.path)},options);
    if(identity(result.archive)!==identity(pin)||result.manifestSha256!==received.manifestSha256)throw fault('MATOMO_PRODUCT_ORIGIN_CHANGED');
    for(const file of manifest.files)await selectedFile(file.path);
    return summary();
  }
  async function close(){closed=true;await opening;database?.close();database=null;if(!originalReleased){await releaseOriginal();originalReleased=true;}}
  return Object.freeze({summary,page,files,merchant,archiveFile,file:selectedFile,
    manifest:()=>({content:manifestRaw,name:'matomo-original-workspace.json',mediaType:'application/json'}),
    verify,close});
}
