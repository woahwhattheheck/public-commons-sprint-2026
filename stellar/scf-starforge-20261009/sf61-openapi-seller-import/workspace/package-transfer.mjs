// MIT. Transfer complete immutable ORIGINAL SF61 packages through their own readers.
import { constants as C } from 'node:fs';
import { open, lstat, mkdir, readdir, realpath } from 'node:fs/promises';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { privateParent, packageName, readPackage, prepareMerchant, publishPackage } from './model.mjs';
import { inspectReleaseSource, stageRelease, initReleaseStore } from '../../sf82-seller-pilot/releases.mjs';
import { readReleaseWorkspace } from '../../sf82-seller-pilot/release-upstreams.mjs';
import { releaseCommands } from './revisions.mjs';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from '../../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
export { RetainedFileReads as MerchantPackageFileReads };

import {
  PACKAGE_EXPORT_SCHEMA, PACKAGE_EXPORT_MANIFEST, PACKAGE_EXPORT_MAX_BYTES, PACKAGE_EXPORT_MAX_FILE_BYTES, PACKAGE_EXPORT_MAX_CHUNK_BYTES, parseMerchantPackageExport, MANIFEST_LIMIT, plain, sha, encode, decode, canonical, fail, exact, digest, exportIdentifier, selectedFile, isPackageSourceFile, isPackageExportHash, isPackageReadId
} from './package-export-format.mjs';
export {
  PACKAGE_EXPORT_SCHEMA, PACKAGE_EXPORT_MANIFEST, PACKAGE_EXPORT_MAX_BYTES, PACKAGE_EXPORT_MAX_FILE_BYTES, PACKAGE_EXPORT_MAX_CHUNK_BYTES, parseMerchantPackageExport
} from './package-export-format.mjs';

async function directory(path,{create=false}={}) {
  const full=resolve(path);
  if(create)try{await mkdir(full,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  await privateParent(full);
  if(await realpath(full)!==full)fail('Use the canonical private directory without symlink components.');
  return full;
}
async function fileBytes(root,name,maximum=PACKAGE_EXPORT_MAX_FILE_BYTES) {
  let parent=root;
  for(const part of name.split('/').slice(0,-1))parent=await directory(join(parent,part));
  const handle=await open(join(root,name),C.O_RDONLY|(C.O_NOFOLLOW??0)|(C.O_NONBLOCK??0));
  try {
    const before=await handle.stat();
    if(!before.isFile()||before.size>maximum||process.platform!=='win32'&&(before.mode&0o077)!==0)
      fail('Transfer requires a private regular file within its limit: '+name+'.');
    const bytes=await handle.readFile(),after=await handle.stat();
    if(bytes.length>maximum||bytes.length!==before.size||after.size!==before.size||
        after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)
      fail('Package file changed while reading: '+name+'.','PACKAGE_TRANSFER_CHANGED',409);
    return bytes;
  } finally {await handle.close();}
}
async function syncDirectory(path) {
  const handle=await open(path,C.O_RDONLY);
  try{await handle.sync();}finally{await handle.close();}
}
async function writeBytes(root,name,bytes) {
  let parent=root;
  for(const part of name.split('/').slice(0,-1))parent=await directory(join(parent,part),{create:true});
  const handle=await open(join(root,name),'wx',0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  await syncDirectory(parent);
}
function metadataFile(name,bytes) {return {name,bytes:bytes.length,sha256:sha(bytes)};}
function packageIdentity(project,manifestBytes,{name=project.name}={}) {
  return {name,id:project.manifest.id,manifestSha256:sha(manifestBytes),
    sourceFile:project.manifest.sourceFile??'original-openapi.json',
    sourceSha256:project.manifest.files[project.manifest.sourceFile??'original-openapi.json'],
    planSha256:project.manifest.files['merchant-plan.json'],
    ...(project.sourceRevision?{sourceRevisionSha256:project.manifest.files['source-revision.json']}:{}),
    createdAt:project.manifest.createdAt};
}
async function existingPackage(parent,name) {
  const base=await directory(parent),folder=join(base,packageName(name));
  try{await lstat(folder);}catch(error){
    if(error.code==='ENOENT')fail('The saved package name is absent.','PACKAGE_NOT_FOUND',404);
    throw error;
  }
  try{return await readPackage(base,name);}
  catch(error){
    // An existing incomplete package is never mistaken for an absent name by
    // author/save recovery. Keep the original name and report the broken input.
    if(error.code==='ENOENT')fail('This existing package is incomplete. Reopen its original source.','PACKAGE_INCOMPLETE',409);
    throw error;
  }
}
/** Exact original identity, including unchanged revision and operating lineage. */
export async function inspectMerchantPackage({parent,name}) {
  const closure=await packageClosure(parent,name),{project}=closure;
  const bytes=closure.contents.get('merchant-package.json'),original=await readReleaseWorkspace(project.folder);
  if(original.provenance.manifestSha256!==sha(bytes))
    fail('The original package changed while reopening.','PACKAGE_TRANSFER_CHANGED',409);
  const files=new Map(closure.files.map(file=>[file.name,file]));
  return {state:'PACKAGE_RETAINED',name:project.name,folder:project.folder,
    package:closure.package,manifest:project.manifest,manifestSha256:sha(bytes),
    sourceSha256:original.provenance.originalOpenApiSha256,
    planSha256:project.manifest.files['merchant-plan.json'],
    compiled:{manifestSha256:files.get('compiled/manifest.json').sha256,
      offersSha256:files.get('compiled/offers.json').sha256,
      serviceConfigSha256:files.get('compiled/seller-service.json').sha256},
    files:closure.files,totalBytes:closure.totalBytes,
    ...(project.sourceRevision?{sourceRevision:project.sourceRevision}:{}),provenance:original.provenance};
}
function pageOptions({after='',limit=25}={}) {
  if(typeof after!=='string'||after.length>64||!Number.isSafeInteger(limit)||limit<1||limit>200)
    fail('Use the previous cursor and a page limit from 1 to 200.');
  return {after,limit};
}
async function pageDirectories(root,options,valid,read) {
  const {after,limit}=pageOptions(options),names=(await readdir(root,{withFileTypes:true}))
    .filter(entry=>entry.isDirectory()&&valid(entry.name)&&entry.name>after).map(entry=>entry.name).sort();
  const rows=[];let more=false;
  for(const name of names) {
    let row;
    try{row=await read(name);}catch(error){
      if(error.code==='EACCES'||error.code==='EIO'||error.code==='EMFILE'||error.code==='ENFILE')throw error;
      continue;
    }
    if(rows.length===limit){more=true;break;}
    rows.push(row);
  }
  return {rows,nextCursor:more?rows.at(-1).cursor:null,complete:!more};
}
/** Pagination selects packages after scanning directory names, including beyond 200 entries. */
export async function listMerchantPackages({parent,after='',limit=25}) {
  const base=await directory(parent),result=await pageDirectories(base,{after,limit},
    name=>/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name),async name=>{
      const value=await inspectMerchantPackage({parent:base,name});
      return {cursor:name,name,...value.package,title:value.manifest.preview?.title??name,
        routes:value.manifest.preview?.routes?.length??0};
    });
  return {packages:result.rows.map(({cursor,...row})=>row),nextCursor:result.nextCursor,complete:result.complete};
}
async function packageClosure(parent,name,{identityName=name}={}) {
  const project=await existingPackage(parent,name),manifestBytes=await fileBytes(project.folder,'merchant-package.json',1024*1024);
  if(canonical(JSON.parse(decode(manifestBytes)))!==canonical(project.manifest))
    fail('Package manifest changed while selecting original files.','PACKAGE_TRANSFER_CHANGED',409);
  const original=await readReleaseWorkspace(project.folder);
  const compiled=await inspectReleaseSource(join(project.folder,'compiled'));
  if(compiled.manifest.schema!=='stellar.open-api-seller-manifest.v1'||
      compiled.manifest.specSha256!==project.manifest.files['facade-openapi.json']||
      compiled.manifest.selectionsSha256!==project.manifest.files['selections.json']||
      compiled.manifest.serviceBindingsSha256!==project.manifest.files['route-bindings.json'])
    fail('Compiled output belongs to different original package inputs.','PACKAGE_TRANSFER_CHANGED',409);
  const expected=new Map([['merchant-package.json',sha(manifestBytes)],['RUN.md',null]]);
  for(const [file,hash] of Object.entries(project.manifest.files)) {
    if(!isPackageSourceFile(file)||!isPackageExportHash(hash))fail('The original package declares an unsupported source file.');
    expected.set(file,hash);
  }
  for(const file of compiled.files)expected.set(selectedFile('compiled/'+file.file),file.sha256);
  const contents=new Map(),files=[];let totalBytes=0;
  for(const [name,hash] of [...expected].sort(([a],[b])=>a<b?-1:a>b?1:0)) {
    const bytes=await fileBytes(project.folder,selectedFile(name));
    if(hash!==null&&sha(bytes)!==hash)fail('Immutable package input changed: '+name+'.','PACKAGE_TRANSFER_CHANGED',409);
    totalBytes+=bytes.length;
    if(totalBytes>PACKAGE_EXPORT_MAX_BYTES)fail('The complete package exceeds the 128 MiB transfer limit.');
    contents.set(name,bytes);files.push(metadataFile(name,bytes));
  }
  if(original.provenance.manifestSha256!==sha(manifestBytes))
    fail('Original workspace manifest changed during export.','PACKAGE_TRANSFER_CHANGED',409);
  return {project,contents,files,totalBytes,package:packageIdentity(project,manifestBytes,{name:identityName})};
}
async function exportRoot(parent,create=false) {
  return directory(join(await directory(parent),'.package-exports'),{create});
}
async function readExport(parent,exportId) {
  exportId=exportIdentifier(exportId);
  let root;
  try{root=await directory(join(await exportRoot(parent),exportId));}
  catch(error){if(error.code==='ENOENT')fail('The retained export is absent.','PACKAGE_EXPORT_NOT_FOUND',404);throw error;}
  const bytes=await fileBytes(root,PACKAGE_EXPORT_MANIFEST,MANIFEST_LIMIT);
  return {root,bytes,manifest:parseMerchantPackageExport(bytes,exportId),manifestFile:metadataFile(PACKAGE_EXPORT_MANIFEST,bytes)};
}
const exportView=retained=>({state:'MANIFEST_RETAINED',exportId:retained.manifest.exportId,
  package:retained.manifest.package,manifest:retained.manifest,manifestFile:retained.manifestFile});
export async function inspectMerchantPackageExport({parent,exportId}) {
  return exportView(await readExport(parent,exportId));
}
async function verifyClosure(closure,manifest) {
  if(canonical(closure.package)!==canonical(manifest.package)||canonical(closure.files)!==canonical(manifest.files)||
      closure.totalBytes!==manifest.totalBytes)
    fail('The received package differs from the complete original export.','PACKAGE_TRANSFER_CHANGED',409);
}
/** A retained export owns copies of immutable files, so sender relocation is harmless. */
export async function exportMerchantPackage({parent,name,expectedPackageManifestSha256}) {
  const selected=await packageClosure(parent,name);
  if(expectedPackageManifestSha256!==undefined&&digest(expectedPackageManifestSha256)!==selected.package.manifestSha256)
    fail('The selected package changed before export.','PACKAGE_TRANSFER_CHANGED',409);
  const core={schema:PACKAGE_EXPORT_SCHEMA,package:selected.package,files:selected.files,totalBytes:selected.totalBytes};
  const exportId=sha(canonical(core)),manifest={...core,exportId},bytes=encode(manifest);
  parseMerchantPackageExport(bytes,exportId);
  const root=await exportRoot(parent,true);
  const recover=async()=>{
    const retained=await readExport(parent,exportId);
    if(!retained.bytes.equals(bytes))fail('This retained export ID has different bytes.','PACKAGE_EXPORT_CONFLICT',409);
    const reopened=await packageClosure(root,exportId,{identityName:manifest.package.name});
    await verifyClosure(reopened,manifest);
    return {...exportView(retained),state:'EXPORTED',recovered:true};
  };
  try {
    return await publishPackage({parent:root,name:exportId},async({staging,stagingParent})=>{
      for(const [name,content] of selected.contents)await writeBytes(staging,name,content);
      const copied=await packageClosure(stagingParent,exportId,{identityName:manifest.package.name});
      await verifyClosure(copied,manifest);
      await writeBytes(staging,PACKAGE_EXPORT_MANIFEST,bytes);
      return {state:'EXPORTED',exportId,package:manifest.package,manifest,manifestFile:metadataFile(PACKAGE_EXPORT_MANIFEST,bytes),recovered:false};
    });
  } catch(error){if(error.code==='EEXIST')return recover();throw error;}
}
/** List retained exports independently of the present source-package directories. */
export async function listMerchantPackageExports({parent,after='',limit=25}) {
  let root;
  try{root=await exportRoot(parent);}catch(error){if(error.code==='ENOENT')return {exports:[],nextCursor:null,complete:true};throw error;}
  const result=await pageDirectories(root,{after,limit},name=>isPackageExportHash(name),async exportId=>{
    const retained=await readExport(parent,exportId);
    return {cursor:exportId,exportId,package:retained.manifest.package,manifestFile:retained.manifestFile,
      files:retained.manifest.files.length,totalBytes:retained.manifest.totalBytes};
  });
  return {exports:result.rows.map(({cursor,...row})=>row),nextCursor:result.nextCursor,complete:result.complete};
}
/** Exact file protocol consumed by the existing retained-download nestedFiles path. */
export async function readMerchantPackageExportFile({parent,exportId,file,expectedManifestSha256,expectedSha256,
  offset=0,limit=PACKAGE_EXPORT_MAX_CHUNK_BYTES,readId,reads}) {
  if(!(reads instanceof RetainedFileReads))fail('Use the original host-owned retained file reader.');
  const retained=await readExport(parent,exportId),manifestSha256=retained.manifestFile.sha256;
  if(digest(expectedManifestSha256)!==manifestSha256)
    fail('Retained export manifest changed.','PACKAGE_TRANSFER_CHANGED',409);
  const row=file===PACKAGE_EXPORT_MANIFEST?retained.manifestFile:retained.manifest.files.find(row=>row.name===file);
  if(!row)fail('The selected export does not contain this file.','PACKAGE_EXPORT_FILE_NOT_FOUND',404);
  if(digest(expectedSha256,'file')!==row.sha256)fail('Select the original retained file hash.','PACKAGE_TRANSFER_CHANGED',409);
  if(!Number.isSafeInteger(offset)||offset<0||offset>row.bytes||!Number.isSafeInteger(limit)||limit<1||limit>PACKAGE_EXPORT_MAX_CHUNK_BYTES||
      readId!==undefined&&!isPackageReadId(readId))fail('Select a valid byte range and retained read ID.');
  const result=await reads.read({scope:exportId+':'+manifestSha256,
    key:row.name+':'+row.sha256,kind:'ORIGINAL_API_PACKAGE',directory:retained.root,
    expectedSha256:row.sha256,offset,limit,readId,load:async()=>{
      const bytes=file===PACKAGE_EXPORT_MANIFEST?retained.bytes:await fileBytes(retained.root,row.name,row.bytes);
      if(bytes.length!==row.bytes)fail('Retained export file changed.','PACKAGE_TRANSFER_CHANGED',409);
      return {name:row.name,bytes};
    }});
  return {exportId,manifestSha256,...result};
}
export async function releaseMerchantPackageExportFile({parent,exportId,readId,reads}) {
  if(!(reads instanceof RetainedFileReads))fail('Use the original host-owned retained file reader.');
  exportIdentifier(exportId);if(!isPackageReadId(readId??''))fail('Select the retained read ID to release.');
  const retained=await readExport(parent,exportId);
  await reads.release(exportId+':'+retained.manifestFile.sha256,readId);
  return {state:'RELEASED',exportId,readId};
}
/** Receive downloaded bytes through the same atomic publisher as original savePackage. */
export async function receiveMerchantPackage({parent,directory:input,name,expectedManifestSha256}) {
  if(typeof input!=='string'||!isAbsolute(input))fail('Choose an absolute, configured private receiving directory.');
  const received=await directory(input),bytes=await fileBytes(received,PACKAGE_EXPORT_MANIFEST,MANIFEST_LIMIT);
  if(sha(bytes)!==digest(expectedManifestSha256))fail('The downloaded manifest differs from the selected export.','PACKAGE_TRANSFER_CHANGED',409);
  const manifest=parseMerchantPackageExport(bytes),target=packageName(name??manifest.package.name),contents=new Map();
  for(const file of manifest.files) {
    const content=await fileBytes(received,file.name,file.bytes);
    if(content.length!==file.bytes||sha(content)!==file.sha256)
      fail('Downloaded original file differs: '+file.name+'.','PACKAGE_TRANSFER_CHANGED',409);
    contents.set(file.name,content);
  }
  const result=(project,recovered)=>({state:'RECEIVED',name:target,folder:project.folder,exportId:manifest.exportId,
    manifestSha256:sha(bytes),package:packageIdentity(project,contents.get('merchant-package.json')),
    manifest:project.manifest,...(project.sourceRevision?{sourceRevision:project.sourceRevision}:{}),
    release:releaseCommands(project.folder,target),recovered});
  const recover=async()=>{
    let saved;
    try{saved=await packageClosure(parent,target,{identityName:manifest.package.name});}
    catch(error){throw Object.assign(new Error('This package name exists with different or incomplete files. Choose another name.',{cause:error}),{code:'EEXIST',status:409});}
    await verifyClosure(saved,manifest);
    return result(saved.project,true);
  };
  try {
    return await publishPackage({parent,name:target},async({folder,staging,stagingParent})=>{
      for(const [file,content] of contents)await writeBytes(staging,file,content);
      const reopened=await packageClosure(stagingParent,target,{identityName:manifest.package.name});
      await verifyClosure(reopened,manifest);
      // The original pure planner validates references, payment and transport
      // syntax without resolving any receiving-host credential values.
      prepareMerchant(reopened.project.specText,reopened.project.plan);
      await mkdir(join(staging,'support'),{mode:0o700});
      await syncDirectory(staging);
      return result({...reopened.project,folder},false);
    });
  } catch(error){if(error.code==='EEXIST')return recover();throw error;}
}
/** Initial saves and reviewed candidates use the same original SF82 stage operation. */
export async function stageMerchantPackage({parent,name,store,id,createStore=false,expectedPackageManifestSha256,validatePlan}) {
  if(typeof store!=='string'||!isAbsolute(store)||typeof createStore!=='boolean')
    fail('Select an absolute original release store and explicit create-store choice.');
  const project=await existingPackage(parent,name),identity=await inspectMerchantPackage({parent,name});
  if(expectedPackageManifestSha256!==undefined&&digest(expectedPackageManifestSha256)!==identity.manifestSha256)
    fail('The saved package changed before release staging.','PACKAGE_TRANSFER_CHANGED',409);
  packageName(id);
  if(typeof validatePlan==='function')await validatePlan(project.specText,project.plan);
  if(createStore)await initReleaseStore(store);
  const record=await stageRelease(store,{id,workspace:project.folder,runtime:{port:0}});
  return {state:'STAGED',package:identity.package,record,release:releaseCommands(project.folder,id,resolve(store))};
}
