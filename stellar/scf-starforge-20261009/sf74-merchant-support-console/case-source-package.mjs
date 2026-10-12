// MIT. Complete SF74 cases and their original native SF49 source editions.
// Archives, byte publication, retained downloads and case reopening remain native.
import {constants} from 'node:fs';
import {open,mkdir,lstat,realpath,readdir} from 'node:fs/promises';
import {resolve,join,dirname,isAbsolute,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {openCaseStore} from './case-store.mjs';
import {parseWorkspace} from './workspace-file.mjs';
import {exportRuntimeHandoff,MAX_HANDOFF_BYTES} from './runtime-support.mjs';
import {commissioningSummary,commissioningReport,commissioningTasksCsv,
  commissioningOriginalFiles,commissioningFileBytes,commissioningSourceBundles} from './commissioning.mjs';
import {readPrivateFile} from '../sf93-seller-support-bundle/incident-store.mjs';
import {atomicBytes,atomicJson,fileDigest,retainFile} from '../sf30-seller-sdk/duckdb/cloud-delivery/files.mjs';
import {acquireWorkspace} from '../sf30-seller-sdk/postgres/publisher/files.mjs';
import {SOURCE_ARCHIVE_LIMITS,exportSourceEditionArchive,inspectSourceEditionArchive} from '../../scf_2026/sf49_data_commissioning/source-edition-archive.mjs';
import {parseSupportExportManifest} from '../../../stellar-forge/mcp-merchant-operator/support.mjs';
import {RetainedFileReads} from '../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import {downloadSupportExport,reopenDownloadedSupportExport} from '../../../stellar-forge/mcp-merchant-operator/support-download.mjs';

export const CASE_SOURCE_PACKAGE_SCHEMA='stellar-forge.merchant-case-source-package.v1';
export const CASE_SOURCE_RECEIVING_SCHEMA='stellar-forge.merchant-case-source-receiving.v1';
export const MAX_CASE_SOURCE_MANIFEST_BYTES=64*1024*1024;
const MAX_ARCHIVE_BYTES=SOURCE_ARCHIVE_LIMITS.archiveBytes;
const MAX_FILES=200000,MAX_REVISIONS=50000;
const SHA=/^[a-f0-9]{64}$/,ID=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const BUNDLE=SHA;
const json=value=>JSON.stringify(value,null,2)+'\n';
const sha=value=>createHash('sha256').update(value).digest('hex');
const decode=value=>new TextDecoder('utf-8',{fatal:true}).decode(value);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const textOrder=(a,b)=>a<b?-1:a>b?1:0;
const fail=(code,message,status=422)=>Object.assign(new Error(message),{code,status});
function ensure(condition,code,message,status) {if(!condition)throw fail(code,message,status);}
function pin(value) {
  ensure(plain(value)&&SHA.test(value.sha256??'')&&
    (Number.isSafeInteger(value.bytes)||typeof value.bytes==='string'&&/^(0|[1-9]\d*)$/.test(value.bytes)),
    'CASE_PACKAGE_FILE_IDENTITY','Use original file byte counts and SHA-256 identities.');
  const count=Number(value.bytes);
  ensure(Number.isSafeInteger(count)&&count>=0&&count<=MAX_ARCHIVE_BYTES,
    'CASE_PACKAGE_FILE_LIMIT','A selected file exceeds the original native archive limit.');
  return {bytes:count,sha256:value.sha256};
}
function pathName(value) {
  ensure(typeof value==='string'&&value.length>0&&Buffer.byteLength(value)<=4096&&
    !/^[\\/]/.test(value)&&!/^[A-Za-z]:/.test(value)&&!/[\\\u0000-\u001f\u007f]/.test(value)&&
    value.split('/').every(part=>part&&part!=='.'&&part!=='..')&&value.split('/').length<=32,
    'CASE_PACKAGE_FILE_NAME','Use a canonical relative file path.');
  return value;
}
function utc(value) {
  ensure(typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&
    Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value,
    'CASE_PACKAGE_TIME','Use the original full UTC generation time.');
  return value;
}
function exact(value,fields,label) {
  ensure(plain(value)&&Object.keys(value).every(key=>fields.includes(key)),
    'CASE_PACKAGE_INPUT','Unexpected '+label+' fields.');
}
function equivalent(a,b,code='CASE_PACKAGE_IDENTITY_CONFLICT') {
  ensure(isDeepStrictEqual(a,b),code,'This retained operation belongs to different original bytes or selections.',409);
}
function rootPath(value,label) {
  ensure(typeof value==='string'&&isAbsolute(value)&&!value.includes('\0')&&resolve(value)!=='/',
    'CASE_PACKAGE_DIRECTORY','Choose an absolute private '+label+' directory.');
  return resolve(value);
}
const within=(child,parent)=>child===parent||child.startsWith(parent+sep);
async function privateDirectory(path,{create=true}={}) {
  const root=rootPath(path,'operation');
  if(create)await mkdir(root,{recursive:true,mode:0o700});
  const stat=await lstat(root);
  ensure(stat.isDirectory()&&!stat.isSymbolicLink()&&await realpath(root)===root&&
    (process.platform==='win32'||!(stat.mode&0o077)&&stat.uid===process.getuid()),
    'CASE_PACKAGE_PRIVATE_DIRECTORY','Use an owned canonical private directory (0700).',503);
  return root;
}
async function nativePath(root,name,{parents=false}={}) {
  const parts=pathName(name).split('/');let parent=root;
  for(const part of parts.slice(0,-1))parent=await privateDirectory(join(parent,part),{create:parents});
  const path=join(parent,parts.at(-1));
  try {const stat=await lstat(path);ensure(stat.isFile()&&!stat.isSymbolicLink()&&
    (process.platform==='win32'||!(stat.mode&0o077)&&stat.uid===process.getuid()),
    'CASE_PACKAGE_PRIVATE_FILE','Use owned private regular files (0600).',503);}
  catch(error){if(error.code!=='ENOENT'||!parents)throw error;}
  return path;
}
async function filePin(path,expected,signal) {
  signal?.throwIfAborted();
  const original=pin(expected),found=await fileDigest(path,Math.max(original.bytes,1));
  equivalent(pin(found),original,'CASE_PACKAGE_FILE_CHANGED');
  signal?.throwIfAborted();return original;
}
async function pinnedBytes(path,expected,maximum=MAX_CASE_SOURCE_MANIFEST_BYTES) {
  const identity=pin(expected);
  ensure(identity.bytes<=maximum,'CASE_PACKAGE_FILE_LIMIT','This original document exceeds its source-owned limit.');
  const bytes=Buffer.from(await readPrivateFile(path,Math.max(maximum,1)));
  equivalent({bytes:bytes.length,sha256:sha(bytes)},identity,'CASE_PACKAGE_FILE_CHANGED');return bytes;
}
async function optionalJson(path,maximum=MAX_CASE_SOURCE_MANIFEST_BYTES) {
  try {const bytes=Buffer.from(await readPrivateFile(path,maximum));return {bytes,value:JSON.parse(decode(bytes))};}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function locked(root,operation) {
  const state=await privateDirectory(join(root,'package-state')),release=await acquireWorkspace(state);
  let primary;
  try{return await operation(state);}catch(error){primary=error;throw error;}
  finally{try{await release();}catch(error){if(primary){primary.closeError=error;throw primary;}throw error;}}
}
function addFile(inventory,name,identity,role) {
  pathName(name);const value={name,...pin(identity),role};
  const prior=inventory.get(name);
  if(prior)equivalent(prior,value,'CASE_PACKAGE_DUPLICATE_FILE');
  else {
    ensure(inventory.size<MAX_FILES,'CASE_PACKAGE_MANIFEST_LIMIT','The complete original inventory exceeds the declared file limit.');
    inventory.set(name,value);
  }
  return value;
}
async function put(root,name,body,inventory,role) {
  const bytes=Buffer.from(body),path=await nativePath(root,name,{parents:true});
  await atomicBytes(path,bytes);
  return addFile(inventory,name,{bytes:bytes.length,sha256:sha(bytes)},role);
}
async function copyFile(root,name,source,identity,inventory,role,signal) {
  signal?.throwIfAborted();const selected=pin(identity),path=await nativePath(root,name,{parents:true});
  try {await filePin(path,selected,signal);}
  catch(error) {
    if(error.code!=='ENOENT')throw error;
    await retainFile(source,path,{bytes:String(selected.bytes),sha256:selected.sha256});
  }
  signal?.throwIfAborted();return addFile(inventory,name,selected,role);
}
function manifestBytes(value) {
  const bytes=Buffer.from(json(value));
  ensure(bytes.length<=MAX_CASE_SOURCE_MANIFEST_BYTES,'CASE_PACKAGE_MANIFEST_LIMIT',
    'The complete package manifest exceeds its declared 64 MiB metadata limit.');
  return bytes;
}
function selectFile(manifest,name) {
  const found=manifest.files.find(file=>file.name===name);
  ensure(found,'CASE_PACKAGE_FILE_MISSING','The package manifest does not contain '+name+'.');
  return found;
}
function packageSummary(manifest,manifestSha256,directory) {
  return {schema:CASE_SOURCE_PACKAGE_SCHEMA,state:'COMPLETE',directory,exportId:manifest.exportId,
    manifestSha256,case:manifest.case,caseHistory:{headRevision:manifest.caseHistory.headRevision,
      revisions:manifest.caseHistory.revisions.length,directory:manifest.caseHistory.directory},
    sourceBundles:manifest.sourceBundles.length,sourceFiles:manifest.sourceBundles.reduce((n,b)=>n+b.files.length,0),
    files:manifest.files.length,bytes:manifest.files.reduce((n,file)=>n+BigInt(file.bytes),0n).toString()};
}

/** Local adapter for the SAME original Support downloader. It creates no server
 * or case and never writes a download checkpoint itself. Original retained file
 * leases validate each requested file and preserve restart/offset behavior.
 */
async function originalSupportClient(root,completeManifest,manifestSha256) {
  const exportId=completeManifest.exportId,supportPin=completeManifest.support.manifest;
  const supportBytes=await pinnedBytes(await nativePath(root,'support-export.json'),supportPin,65000);
  const manifest=parseSupportExportManifest(supportBytes,exportId),reads=new RetainedFileReads({errorPrefix:'SUPPORT'});
  equivalent(manifest.case,completeManifest.case,'CASE_PACKAGE_SUPPORT_IDENTITY');
  const manifestFile={name:'support-export.json',...pin(supportPin)};
  return {
    endpoint:'stellar-forge:case-source-package:'+manifestSha256+':'+exportId,
    async call(name,args) {
      ensure(args?.exportId===exportId,'CASE_PACKAGE_EXPORT_ID','Select this original package export.');
      if(name==='merchant_support_export_manifest')
        return {...manifest,state:'MANIFEST_RETAINED',manifestFile,fileReads:reads.status(exportId)};
      if(name==='merchant_support_export_file_release') {
        await reads.release(exportId,args.readId);return {exportId,readId:args.readId,released:true};
      }
      ensure(name==='merchant_support_export_file','CASE_PACKAGE_READ_ONLY','This local adapter serves the original Support files.');
      equivalent(args.expectedManifestSha256,supportPin.sha256,'CASE_PACKAGE_SUPPORT_IDENTITY');
      const file=args.file==='support-export.json'?manifestFile:manifest.files.find(row=>row.name===args.file);
      ensure(file,'CASE_PACKAGE_FILE_MISSING','Select an original Support manifest file.');
      return {exportId,manifestSha256:supportPin.sha256,...await reads.read({scope:exportId,
        key:JSON.stringify([exportId,args.file,supportPin.sha256]),kind:'support-export',directory:root,
        readId:args.readId,offset:args.offset,limit:args.limit,expectedSha256:args.expectedSha256,
        load:async()=>({bytes:args.file==='support-export.json'?supportBytes:
          await pinnedBytes(await nativePath(root,file.name),file,MAX_HANDOFF_BYTES),
          name:file.name,type:file.name.endsWith('.json')?'application/json':'application/octet-stream'})})};
    },
    close:()=>reads.close(),
  };
}


async function originalRecords(store,id,headRevision,selectedRevision,signal) {
  const records=new Map(),headChain=[],selectedChain=[];
  async function visit(first,chain) {
    let current=first;const path=new Set();
    while(current) {
      signal?.throwIfAborted();
      ensure(SHA.test(current)&&!path.has(current),'CASE_PACKAGE_HISTORY','The original case history contains an invalid revision or cycle.');
      path.add(current);chain.push(current);
      if(records.has(current))break;
      ensure(records.size<MAX_REVISIONS,'CASE_PACKAGE_HISTORY_LIMIT','This case exceeds the declared complete-history limit.');
      const record=await store.read(id,current);
      equivalent({id:record.id,revision:record.revision},{id,revision:current},'CASE_PACKAGE_HISTORY');
      records.set(current,record);current=record.previousRevision;
    }
  }
  await visit(headRevision,headChain);
  if(!records.has(selectedRevision))await visit(selectedRevision,selectedChain);
  return {records,headChain,selectedChain};
}
function nativeBundleRow(row,caseRevision) {
  ensure(plain(row)&&BUNDLE.test(row.bundleId??'')&&SHA.test(row.manifestSha256??'')&&
    typeof row.manifestText==='string'&&sha(Buffer.from(row.manifestText))===row.manifestSha256&&
    Array.isArray(row.files)&&Array.isArray(row.editionIds),
    'CASE_PACKAGE_SOURCE_IDENTITY','Use every retained native source manifest and its exact original bytes.');
  let manifest;try{manifest=JSON.parse(row.manifestText);}catch{throw fail('CASE_PACKAGE_SOURCE_IDENTITY','The retained native manifest is not JSON.');}
  ensure(manifest.bundleId===row.bundleId&&Array.isArray(manifest.files),
    'CASE_PACKAGE_SOURCE_IDENTITY','The original source manifest belongs to another bundle.');
  const expected=new Map(manifest.files.map(file=>[pathName(file.path),{path:file.path,role:file.role,...pin(file)}]));
  ensure(expected.size===manifest.files.length&&!expected.has('manifest.json'),
    'CASE_PACKAGE_SOURCE_IDENTITY','The original native file inventory is inconsistent.');
  expected.set('manifest.json',{path:'manifest.json',role:'source-edition-manifest',
    bytes:Buffer.byteLength(row.manifestText),sha256:row.manifestSha256});
  const members=new Map();
  for(const file of row.files) {
    const name=pathName(file.path),value={path:name,role:file.role,...pin(file)};
    ensure(!members.has(name),'CASE_PACKAGE_SOURCE_IDENTITY','A native member appears twice.');
    equivalent(value,expected.get(name),'CASE_PACKAGE_SOURCE_IDENTITY');
    equivalent(file.sourceFile,{bundleId:row.bundleId,manifestSha256:row.manifestSha256,path:name},'CASE_PACKAGE_SOURCE_IDENTITY');
    members.set(name,value);
  }
  ensure(members.size===expected.size,'CASE_PACKAGE_SOURCE_INCOMPLETE',
    'The retained source inventory must include every original native member.');
  ensure(row.editionIds.every(value=>typeof value==='string'&&value.length>0&&value.length<=200),
    'CASE_PACKAGE_SOURCE_IDENTITY','Retain the original source edition identities.');
  return {bundleId:row.bundleId,manifestSha256:row.manifestSha256,manifestText:row.manifestText,
    editionIds:[...new Set(row.editionIds)].sort(),caseRevisions:[caseRevision],
    files:[...members.values()].sort((a,b)=>textOrder(a.path,b.path))};
}
async function allNativeBundles(records,signal) {
  const bundles=new Map();
  for(const [revision,record]of records) {
    signal?.throwIfAborted();
    const workspace=await parseWorkspace(record.workspaceText);
    for(const original of workspace.commissioning?commissioningSourceBundles(workspace.commissioning):[]) {
      const row=nativeBundleRow(original,revision),key=row.bundleId+'\0'+row.manifestSha256,prior=bundles.get(key);
      if(prior) {
        equivalent({manifestText:prior.manifestText,files:prior.files},
          {manifestText:row.manifestText,files:row.files},'CASE_PACKAGE_SOURCE_IDENTITY');
        prior.editionIds=[...new Set(prior.editionIds.concat(row.editionIds))].sort();
        prior.caseRevisions=[...new Set(prior.caseRevisions.concat(revision))].sort();
      } else bundles.set(key,row);
    }
  }
  return [...bundles.values()].sort((a,b)=>textOrder(a.manifestSha256,b.manifestSha256)||textOrder(a.bundleId,b.bundleId));
}
async function copyOriginalHistory({store,casesDirectory,root,id,captured,inventory,signal}) {
  const revisionRows=[];
  for(const [revision,record]of [...captured.records].sort(([a],[b])=>textOrder(a,b))) {
    signal?.throwIfAborted();
    const versionName=id+'/versions/'+revision+'.json';
    const source=await nativePath(casesDirectory,versionName);
    const metadataBytes=Buffer.from(await readPrivateFile(source,65000));
    ensure(sha(metadataBytes)===revision,'CASE_PACKAGE_HISTORY','The native original version bytes changed.');
    const metadata=JSON.parse(decode(metadataBytes));
    equivalent({id:metadata.id,previousRevision:metadata.previousRevision},
      {id,previousRevision:record.previousRevision},'CASE_PACKAGE_HISTORY');
    const files=[];
    files.push(await copyFile(root,'original-case-store/'+versionName,source,
      {bytes:metadataBytes.length,sha256:revision},inventory,'original-case-version',signal));
    const workspaceName=id+'/workspaces/'+metadata.workspaceSha256+'.json';
    equivalent({bytes:Buffer.byteLength(record.workspaceText),sha256:sha(record.workspaceText)},
      {bytes:metadata.workspaceBytes,sha256:metadata.workspaceSha256},'CASE_PACKAGE_HISTORY');
    files.push(await copyFile(root,'original-case-store/'+workspaceName,await nativePath(casesDirectory,workspaceName),
      {bytes:metadata.workspaceBytes,sha256:metadata.workspaceSha256},inventory,'original-case-workspace',signal));
    if(metadata.runtimeSupport) {
      const name=id+'/runtime/'+metadata.runtimeSupport.sha256+'.json';
      equivalent({bytes:Buffer.byteLength(record.supportText),sha256:sha(record.supportText)},
        pin(metadata.runtimeSupport),'CASE_PACKAGE_HISTORY');
      files.push(await copyFile(root,'original-case-store/'+name,await nativePath(casesDirectory,name),
        metadata.runtimeSupport,inventory,'original-case-runtime',signal));
    }
    revisionRows.push({revision,previousRevision:record.previousRevision,
      workspaceSha256:metadata.workspaceSha256,supportSha256:metadata.runtimeSupport?.sha256??null,
      files:files.map(file=>file.name)});
  }
  // The original native head selects the frozen capture, while every copied
  // immutable version remains byte-exact. Concurrent sender saves keep their head.
  await put(root,'original-case-store/'+id+'/head.json',
    JSON.stringify({schema:'stellar-forge.merchant-case-head.v1',id,revision:captured.headChain[0]})+'\n',
    inventory,'original-case-head');
  const opened=await openCaseStore(join(root,'original-case-store'));
  for(const [revision,original]of captured.records) {
    const read=await opened.read(id,revision);
    equivalent({workspaceText:read.workspaceText,supportText:read.supportText,metadata:read.metadata},
      {workspaceText:original.workspaceText,supportText:original.supportText,metadata:original.metadata},'CASE_PACKAGE_HISTORY');
  }
  return {directory:'original-case-store',id,headRevision:captured.headChain[0],
    headChain:captured.headChain,selectedChain:captured.selectedChain,revisions:revisionRows};
}
async function archiveBundles({rows,sourceDelivery,root,inventory,python,environment,signal}) {
  ensure(!rows.length||sourceDelivery&&typeof sourceDelivery.resolveBundle==='function'&&typeof sourceDelivery.resolveFile==='function',
    'CASE_PACKAGE_SOURCE_DIRECTORY','Select the existing native case source delivery directory.');
  const result=[];
  for(const row of rows) {
    signal?.throwIfAborted();
    const selected={bundleId:row.bundleId,manifestSha256:row.manifestSha256};
    const resolved=await sourceDelivery.resolveBundle(selected);
    ensure(resolved&&typeof resolved.directory==='string'&&resolved.descriptor,
      'CASE_PACKAGE_SOURCE_UNAVAILABLE','The original native bundle is unavailable in this source directory.');
    equivalent({bundleId:resolved.descriptor.bundleId,manifestSha256:resolved.descriptor.manifestSha256},
      selected,'CASE_PACKAGE_SOURCE_IDENTITY');
    const manifestFile=await sourceDelivery.resolveFile({...selected,path:'manifest.json'});
    const exact=await pinnedBytes(manifestFile.path,{bytes:Buffer.byteLength(row.manifestText),sha256:row.manifestSha256},2*1024*1024);
    ensure(exact.equals(Buffer.from(row.manifestText)),'CASE_PACKAGE_SOURCE_IDENTITY','The retained manifest bytes changed.');
    const name='source-bundles/'+row.manifestSha256+'.zip',destination=await nativePath(root,name,{parents:true});
    const exported=await exportSourceEditionArchive({directory:resolved.directory,destination,python,environment,signal});
    equivalent({bundleId:exported.bundleId,manifestSha256:exported.manifestSha256},selected,'CASE_PACKAGE_SOURCE_IDENTITY');
    const archive=addFile(inventory,name,exported.archive,'native-sf49-source-archive');
    result.push({...row,archive:{name,...pin(archive)},native:{operationId:exported.operationId,
      verification:exported.original?.verification??null,nativeSourceMatches:exported.original?.nativeSourceMatches??null}});
  }
  return result;
}

/** Capture a selected case plus all immutable history and every native source
 * manifest referenced anywhere in that history. The first selection/time is
 * retained before publication; an identical retry completes its original files.
 */
export async function exportCaseSourcePackage({store,casesDirectory,id,revision,directory,
  exportId,sourceDelivery,generatedAt,python=process.env.SCF_PYTHON||'python3',
  environment=process.env,signal}={}) {
  ensure(store&&typeof store.read==='function'&&UUID.test(id??'')&&SHA.test(revision??'')&&ID.test(exportId??''),
    'CASE_PACKAGE_INPUT','Select the original saved case/revision and a lowercase export ID.');
  const cases=await privateDirectory(rootPath(casesDirectory,'original case'),{create:false});
  const root=await privateDirectory(rootPath(directory,'package'));
  ensure(!within(root,cases)&&!within(cases,root),'CASE_PACKAGE_DIRECTORY',
    'Keep the exported package separate from its original case store.');
  if(generatedAt!==undefined)utc(generatedAt);
  return locked(root,async stateDirectory=>{
    const completed=await optionalJson(join(root,'case-source-package.json'));
    if(completed) {
      equivalent({exportId:completed.value.exportId,id:completed.value.case?.id,revision:completed.value.case?.revision},
        {exportId,id,revision});
      if(generatedAt!==undefined)equivalent(generatedAt,completed.value.generatedAt);
      return inspectCaseSourcePackage({directory:root,expectedManifestSha256:sha(completed.bytes),python,environment,signal});
    }
    const record=await store.read(id,revision),selected={id,revision,workspaceSha256:sha(record.workspaceText),
      supportSha256:record.supportText===null?null:sha(record.supportText)};
    const original=await optionalJson(join(stateDirectory,'export-request.json'));
    let request;
    if(original) {
      request=original.value;
      equivalent({schema:request.schema,exportId:request.exportId,case:request.case,casesDirectory:request.casesDirectory},
        {schema:'stellar-forge.merchant-case-source-export-request.v1',exportId,case:selected,casesDirectory:cases});
      if(generatedAt!==undefined)equivalent(generatedAt,request.generatedAt);
      utc(request.generatedAt);ensure(SHA.test(request.headRevision),'CASE_PACKAGE_HISTORY','The original selected head is invalid.');
    } else {
      request={schema:'stellar-forge.merchant-case-source-export-request.v1',exportId,case:selected,
        casesDirectory:cases,headRevision:record.currentRevision,generatedAt:generatedAt??new Date().toISOString()};
      await atomicJson(join(stateDirectory,'export-request.json'),request);
    }
    const workspace=await parseWorkspace(record.workspaceText),state=workspace.commissioning,inventory=new Map();
    const captured=await originalRecords(store,id,request.headRevision,revision,signal);
    const nativeRows=await allNativeBundles(captured.records,signal);
    const history=await copyOriginalHistory({store,casesDirectory:cases,root,id,captured,inventory,signal});
    const {workspaceText,supportText,...caseSummary}=record;
    caseSummary.currentRevision=request.headRevision;
    const flat=[];
    flat.push(await put(root,'case.json',json(caseSummary),inventory,'selected-case'));
    flat.push(await put(root,'merchant-workspace.json',workspaceText,inventory,'selected-workspace'));
    if(state) {
      flat.push(await put(root,'merchant-commissioning.json',json(state),inventory,'merchant-implementation'));
      flat.push(await put(root,'merchant-implementation.html',commissioningReport(state),inventory,'implementation-report'));
      flat.push(await put(root,'merchant-implementation-tasks.csv',commissioningTasksCsv(state),inventory,'implementation-tasks'));
      for(const file of commissioningOriginalFiles(state)) {
        // Full sourceFile rows travel once inside their native archive, including
        // members never selected for a task, receipt or material alias.
        if(file.sourceFile)continue;
        const bytes=Buffer.from(commissioningFileBytes(state,file.sha256));
        equivalent({bytes:bytes.length,sha256:sha(bytes)},pin(file),'CASE_PACKAGE_ORIGINAL_CHANGED');
        await put(root,'originals/'+pathName(file.name),bytes,inventory,'inline-implementation-original');
      }
    }
    if(supportText!==null) {
      const handoff=await exportRuntimeHandoff({workspaceText,supportText,metadata:record.metadata,generatedAt:request.generatedAt});
      flat.push(await put(root,'merchant-support.json',handoff.handoff,inventory,'original-support-handoff'));
      flat.push(await put(root,'support.html',handoff.html,inventory,'original-support-report'));
    }
    const sourceBundles=await archiveBundles({rows:nativeRows,sourceDelivery,root,inventory,python,environment,signal});
    const support={schema:'stellar-forge.merchant-support-export.v1',exportId,createdAt:request.generatedAt,
      case:selected,workorderIncluded:false,files:flat.map(({name,bytes,sha256})=>({name,bytes,sha256}))};
    const supportBytes=Buffer.from(json(support));
    parseSupportExportManifest(supportBytes,exportId);
    const supportFile=await put(root,'support-export.json',supportBytes,inventory,'original-support-manifest');
    const implementation={schema:'stellar-forge.merchant-implementation-export.v1',case:{id,revision},
      implementationRevision:state?.revision??null,summary:state?commissioningSummary(state):null,
      sourceBundles:sourceBundles.map(({bundleId,manifestSha256,editionIds,caseRevisions,archive})=>
        ({bundleId,manifestSha256,editionIds,caseRevisions,archive})),
      caseHistory:history,files:[...inventory.values()].sort((a,b)=>textOrder(a.name,b.name))};
    await put(root,'implementation-export.json',manifestBytes(implementation),inventory,'implementation-manifest');
    const complete={schema:CASE_SOURCE_PACKAGE_SCHEMA,exportId,generatedAt:request.generatedAt,case:selected,
      implementationRevision:state?.revision??null,caseHistory:history,
      support:{manifest:{name:'support-export.json',...pin(supportFile)}},sourceBundles,
      files:[...inventory.values()].sort((a,b)=>textOrder(a.name,b.name))};
    const bytes=manifestBytes(complete);
    await atomicBytes(join(root,'case-source-package.json'),bytes);
    return packageSummary(complete,sha(bytes),root);
  });
}


function completeManifest(value) {
  exact(value,['schema','exportId','generatedAt','case','implementationRevision','caseHistory',
    'support','sourceBundles','files'],'complete package');
  ensure(value.schema===CASE_SOURCE_PACKAGE_SCHEMA&&ID.test(value.exportId??''),
    'CASE_PACKAGE_SCHEMA','Use a completed original case/source package.');
  utc(value.generatedAt);
  exact(value.case,['id','revision','workspaceSha256','supportSha256'],'selected case');
  ensure(UUID.test(value.case.id??'')&&SHA.test(value.case.revision??'')&&SHA.test(value.case.workspaceSha256??'')&&
    (value.case.supportSha256===null||SHA.test(value.case.supportSha256??'')),
    'CASE_PACKAGE_CASE_IDENTITY','The original case identity is incomplete.');
  ensure(value.implementationRevision===null||Number.isSafeInteger(value.implementationRevision)&&value.implementationRevision>=0,
    'CASE_PACKAGE_IMPLEMENTATION','The selected implementation revision is invalid.');
  exact(value.caseHistory,['directory','id','headRevision','headChain','selectedChain','revisions'],'original case history');
  const history=value.caseHistory;
  ensure(history.directory==='original-case-store'&&history.id===value.case.id&&SHA.test(history.headRevision??'')&&
    Array.isArray(history.headChain)&&history.headChain.length>0&&history.headChain[0]===history.headRevision&&
    Array.isArray(history.selectedChain)&&Array.isArray(history.revisions)&&history.revisions.length>0&&
    history.revisions.length<=MAX_REVISIONS&&history.headChain.every(id=>SHA.test(id))&&
    history.selectedChain.every(id=>SHA.test(id)),
    'CASE_PACKAGE_HISTORY','The original case history inventory is invalid.');
  ensure(Array.isArray(value.files)&&value.files.length>=5&&value.files.length<=MAX_FILES&&
    Array.isArray(value.sourceBundles)&&value.sourceBundles.length<=MAX_FILES,
    'CASE_PACKAGE_MANIFEST_LIMIT','Use the complete bounded original file inventory.');
  const names=new Map();
  for(const file of value.files) {
    exact(file,['name','bytes','sha256','role'],'package file');
    const name=pathName(file.name);pin(file);
    ensure(typeof file.role==='string'&&file.role.length>0&&file.role.length<=160&&
      !names.has(name)&&!name.startsWith('package-state/')&&name!=='case-source-package.json',
      'CASE_PACKAGE_DUPLICATE_FILE','The package inventory contains a duplicate or private operation record.');
    names.set(name,file);
  }
  for(const name of names.keys()) {
    const parts=name.split('/');
    for(let n=1;n<parts.length;n++)ensure(!names.has(parts.slice(0,n).join('/')),
      'CASE_PACKAGE_FILE_NAME','A package member is also a directory.');
  }
  exact(value.support,['manifest'],'original Support export');
  exact(value.support.manifest,['name','bytes','sha256'],'original Support manifest');
  ensure(value.support.manifest.name==='support-export.json','CASE_PACKAGE_SUPPORT_IDENTITY','Use the original flat Support manifest.');
  equivalent(pin(value.support.manifest),pin(names.get('support-export.json')),'CASE_PACKAGE_SUPPORT_IDENTITY');
  const identities=new Set();
  for(const row of value.sourceBundles) {
    exact(row,['bundleId','manifestSha256','manifestText','editionIds','caseRevisions','files','archive','native'],'native source bundle');
    ensure(SHA.test(row.bundleId??'')&&SHA.test(row.manifestSha256??'')&&
      Array.isArray(row.caseRevisions)&&row.caseRevisions.length>0&&row.caseRevisions.every(id=>SHA.test(id)),
      'CASE_PACKAGE_SOURCE_IDENTITY','Use each original source manifest and its retained case revisions.');
    const identity=row.bundleId+'\0'+row.manifestSha256;
    ensure(!identities.has(identity),'CASE_PACKAGE_SOURCE_IDENTITY','A native source identity appears twice.');
    identities.add(identity);
    exact(row.archive,['name','bytes','sha256'],'native source archive');
    ensure(row.archive.name==='source-bundles/'+row.manifestSha256+'.zip',
      'CASE_PACKAGE_SOURCE_IDENTITY','The original archive name must retain its manifest identity.');
    equivalent(pin(row.archive),pin(names.get(row.archive.name)),'CASE_PACKAGE_SOURCE_IDENTITY');
    exact(row.native,['operationId','verification','nativeSourceMatches'],'original native verification');
  }
  return value;
}
function originalSourceProjection(row) {
  return {bundleId:row.bundleId,manifestSha256:row.manifestSha256,manifestText:row.manifestText,
    editionIds:row.editionIds,caseRevisions:row.caseRevisions,files:row.files};
}
async function inspectHistory(root,manifest,expected,signal) {
  const history=manifest.caseHistory,id=manifest.case.id;
  const cases=await privateDirectory(join(root,history.directory),{create:false});
  const headName='original-case-store/'+id+'/head.json';
  const headBytes=Buffer.from(JSON.stringify({schema:'stellar-forge.merchant-case-head.v1',id,revision:history.headRevision})+'\n');
  addFile(expected,headName,{bytes:headBytes.length,sha256:sha(headBytes)},'original-case-head');
  const observedHead=await pinnedBytes(await nativePath(root,headName),selectFile(manifest,headName),65000);
  ensure(headBytes.equals(observedHead),'CASE_PACKAGE_HISTORY','The retained original head is not the selected capture.');
  const store=await openCaseStore(cases);
  const captured=await originalRecords(store,id,history.headRevision,manifest.case.revision,signal);
  equivalent(captured.headChain,history.headChain,'CASE_PACKAGE_HISTORY');
  equivalent(captured.selectedChain,history.selectedChain,'CASE_PACKAGE_HISTORY');
  const revisions=[];
  for(const [revision,record]of [...captured.records].sort(([a],[b])=>textOrder(a,b))) {
    signal?.throwIfAborted();
    const name='original-case-store/'+id+'/versions/'+revision+'.json';
    const bytes=await pinnedBytes(await nativePath(root,name),selectFile(manifest,name),65000);
    ensure(sha(bytes)===revision,'CASE_PACKAGE_HISTORY','The retained revision is not its original version bytes.');
    const metadata=JSON.parse(decode(bytes));
    equivalent({id:metadata.id,previousRevision:metadata.previousRevision},
      {id,previousRevision:record.previousRevision},'CASE_PACKAGE_HISTORY');
    const files=[addFile(expected,name,{bytes:bytes.length,sha256:revision},'original-case-version').name];
    const workspace='original-case-store/'+id+'/workspaces/'+metadata.workspaceSha256+'.json';
    equivalent({bytes:Buffer.byteLength(record.workspaceText),sha256:sha(record.workspaceText)},
      {bytes:metadata.workspaceBytes,sha256:metadata.workspaceSha256},'CASE_PACKAGE_HISTORY');
    files.push(addFile(expected,workspace,{bytes:metadata.workspaceBytes,sha256:metadata.workspaceSha256},
      'original-case-workspace').name);
    if(metadata.runtimeSupport) {
      equivalent({bytes:Buffer.byteLength(record.supportText),sha256:sha(record.supportText)},
        pin(metadata.runtimeSupport),'CASE_PACKAGE_HISTORY');
      files.push(addFile(expected,'original-case-store/'+id+'/runtime/'+metadata.runtimeSupport.sha256+'.json',
        metadata.runtimeSupport,'original-case-runtime').name);
    }
    revisions.push({revision,previousRevision:record.previousRevision,workspaceSha256:metadata.workspaceSha256,
      supportSha256:metadata.runtimeSupport?.sha256??null,files});
  }
  equivalent(revisions,history.revisions,'CASE_PACKAGE_HISTORY');
  const selected=captured.records.get(manifest.case.revision);
  ensure(selected,'CASE_PACKAGE_HISTORY','The selected case revision is absent from its retained history.');
  equivalent({id,revision:selected.revision,workspaceSha256:sha(selected.workspaceText),
    supportSha256:selected.supportText===null?null:sha(selected.supportText)},manifest.case,'CASE_PACKAGE_CASE_IDENTITY');
  const bundles=await allNativeBundles(captured.records,signal);
  equivalent(bundles,manifest.sourceBundles.map(originalSourceProjection),'CASE_PACKAGE_SOURCE_INCOMPLETE');
  return {captured,selected};
}
async function expectedOriginalFiles(manifest,selected,expected,signal) {
  const {workspaceText,supportText,...caseSummary}=selected;
  caseSummary.currentRevision=manifest.caseHistory.headRevision;
  const workspace=await parseWorkspace(workspaceText),state=workspace.commissioning,flat=[];
  const add=(name,body,role)=> {
    const bytes=Buffer.from(body),file=addFile(expected,name,{bytes:bytes.length,sha256:sha(bytes)},role);
    flat.push({name:file.name,bytes:file.bytes,sha256:file.sha256});return file;
  };
  add('case.json',json(caseSummary),'selected-case');
  add('merchant-workspace.json',workspaceText,'selected-workspace');
  equivalent(state?.revision??null,manifest.implementationRevision,'CASE_PACKAGE_IMPLEMENTATION');
  if(state) {
    add('merchant-commissioning.json',json(state),'merchant-implementation');
    add('merchant-implementation.html',commissioningReport(state),'implementation-report');
    add('merchant-implementation-tasks.csv',commissioningTasksCsv(state),'implementation-tasks');
    for(const file of commissioningOriginalFiles(state)) {
      signal?.throwIfAborted();if(file.sourceFile)continue;
      const bytes=Buffer.from(commissioningFileBytes(state,file.sha256));
      equivalent({bytes:bytes.length,sha256:sha(bytes)},pin(file),'CASE_PACKAGE_ORIGINAL_CHANGED');
      addFile(expected,'originals/'+pathName(file.name),file,'inline-implementation-original');
    }
  }
  if(supportText!==null) {
    const handoff=await exportRuntimeHandoff({workspaceText,supportText,metadata:selected.metadata,generatedAt:manifest.generatedAt});
    add('merchant-support.json',handoff.handoff,'original-support-handoff');
    add('support.html',handoff.html,'original-support-report');
  }
  for(const bundle of manifest.sourceBundles)addFile(expected,bundle.archive.name,bundle.archive,'native-sf49-source-archive');
  const support={schema:'stellar-forge.merchant-support-export.v1',exportId:manifest.exportId,createdAt:manifest.generatedAt,
    case:manifest.case,workorderIncluded:false,files:flat};
  const supportBytes=Buffer.from(json(support));
  parseSupportExportManifest(supportBytes,manifest.exportId);
  addFile(expected,'support-export.json',{bytes:supportBytes.length,sha256:sha(supportBytes)},'original-support-manifest');
  const implementation={schema:'stellar-forge.merchant-implementation-export.v1',
    case:{id:manifest.case.id,revision:manifest.case.revision},
    implementationRevision:state?.revision??null,summary:state?commissioningSummary(state):null,
    sourceBundles:manifest.sourceBundles.map(({bundleId,manifestSha256,editionIds,caseRevisions,archive})=>
      ({bundleId,manifestSha256,editionIds,caseRevisions,archive})),caseHistory:manifest.caseHistory,
    files:[...expected.values()].sort((a,b)=>textOrder(a.name,b.name))};
  const bytes=manifestBytes(implementation);
  addFile(expected,'implementation-export.json',{bytes:bytes.length,sha256:sha(bytes)},'implementation-manifest');
}
async function loadCaseSourcePackage({directory,expectedManifestSha256,python=process.env.SCF_PYTHON||'python3',
  environment=process.env,signal}={}) {
  if(expectedManifestSha256!==undefined)ensure(SHA.test(expectedManifestSha256),
    'CASE_PACKAGE_EXPECTED_DIGEST','Use the complete original package manifest SHA-256.');
  const root=await privateDirectory(rootPath(directory,'package'),{create:false});
  const body=Buffer.from(await readPrivateFile(await nativePath(root,'case-source-package.json'),MAX_CASE_SOURCE_MANIFEST_BYTES));
  const manifestSha256=sha(body);
  if(expectedManifestSha256!==undefined)equivalent(manifestSha256,expectedManifestSha256,'CASE_PACKAGE_MANIFEST_CHANGED');
  const manifest=completeManifest(JSON.parse(decode(body))),expected=new Map();
  const {captured,selected}=await inspectHistory(root,manifest,expected,signal);
  await expectedOriginalFiles(manifest,selected,expected,signal);
  equivalent([...expected.values()].sort((a,b)=>textOrder(a.name,b.name)),manifest.files,
    'CASE_PACKAGE_INCOMPLETE');
  // The original archive inspector streams and validates its own complete ZIP.
  // Other files use the existing immutable file digest reader.
  for(const file of manifest.files) {
    signal?.throwIfAborted();
    const path=await nativePath(root,file.name);
    if(file.role!=='native-sf49-source-archive')await filePin(path,file,signal);
  }
  const archives=[];
  for(const row of manifest.sourceBundles) {
    signal?.throwIfAborted();
    const original=JSON.parse(row.manifestText);
    equivalent(row.native.operationId,original.operationId,'CASE_PACKAGE_SOURCE_IDENTITY');
    const inspected=await inspectSourceEditionArchive({archive:await nativePath(root,row.archive.name),python,environment,signal});
    equivalent(pin(inspected.archive),pin(row.archive),'CASE_PACKAGE_SOURCE_IDENTITY');
    equivalent({operationId:inspected.manifest.operationId,bundleId:inspected.manifest.bundleId,
      manifestSha256:inspected.manifest.manifestSha256,generatedAt:inspected.manifest.generatedAt},
      {operationId:original.operationId,bundleId:row.bundleId,manifestSha256:row.manifestSha256,generatedAt:original.generatedAt},
      'CASE_PACKAGE_SOURCE_IDENTITY');
    const actual=inspected.manifest.files.map(file=>({path:file.path,...pin(file)})).sort((a,b)=>textOrder(a.path,b.path));
    const declared=row.files.map(file=>({path:file.path,...pin(file)})).sort((a,b)=>textOrder(a.path,b.path));
    equivalent(actual,declared,'CASE_PACKAGE_SOURCE_INCOMPLETE');
    archives.push({bundleId:row.bundleId,manifestSha256:row.manifestSha256,
      archive:row.archive,members:inspected.members,files:row.files.length});
  }
  return {root,body,manifest,manifestSha256,selected,captured,archives};
}

/** Inspect the actual original case/history, selected Support export and every
 * source archive with their maintained native readers. No receiving case is
 * created and no source transfer is registered by this operation.
 */
export async function inspectCaseSourcePackage(options={}) {
  const context=await loadCaseSourcePackage(options);
  return {...packageSummary(context.manifest,context.manifestSha256,context.root),
    inspection:{originalCaseRevisions:context.captured.records.size,
      originalSourceArchives:context.archives,selectedWorkspaceSha256:sha(context.selected.workspaceText)}};
}


async function retainWholePackage(context,destination,signal,progress) {
  const root=await privateDirectory(destination),inventory=new Map();
  for(const file of context.manifest.files) {
    signal?.throwIfAborted();
    await copyFile(root,file.name,await nativePath(context.root,file.name),file,inventory,file.role,signal);
    await progress?.({file:file.name,files:inventory.size,totalFiles:context.manifest.files.length});
  }
  equivalent([...inventory.values()].sort((a,b)=>textOrder(a.name,b.name)),context.manifest.files,
    'CASE_PACKAGE_INCOMPLETE');
  const path=await nativePath(root,'case-source-package.json',{parents:true});
  await atomicBytes(path,context.body);
  return root;
}
function originalBundleIdentity(value) {
  return {bundleId:value.bundleId,manifestSha256:value.manifestSha256};
}
async function uploadOriginalArchive(service,id,path,identity,signal) {
  const expected=pin(identity);
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  let stream,primary;
  try {
    const before=await handle.stat({bigint:true});
    ensure(before.isFile()&&before.size===BigInt(expected.bytes)&&
      (process.platform==='win32'||before.uid===BigInt(process.getuid())&&!(before.mode&0o077n)),
      'CASE_PACKAGE_PRIVATE_FILE','Use the original private archive file.');
    stream=handle.createReadStream({autoClose:false});
    const result=await service.upload({id,fileId:'archive',stream,signal});
    equivalent(pin(result.file),expected,'CASE_PACKAGE_SOURCE_IDENTITY');
    const after=await handle.stat({bigint:true});
    ensure(['dev','ino','size','mtimeNs','ctimeNs','mode','uid'].every(key=>before[key]===after[key]),
      'CASE_PACKAGE_SOURCE_CHANGED','The original archive changed during its native upload.',409);
    return result;
  } catch(error){primary=error;throw error;}
  finally {
    stream?.destroy();
    try {await handle.close();}
    catch(error){if(primary){primary.closeError=error;throw primary;}throw error;}
  }
}
async function receiveOriginalBundle({context,packageDirectory,bundle,sourceDelivery,request,caseResult,prior,signal}) {
  signal?.throwIfAborted();
  const identity=originalBundleIdentity(bundle),service=sourceDelivery.service;
  let descriptor,reusedSource=false;
  try {
    const existing=await sourceDelivery.resolveBundle(identity);
    descriptor=existing.descriptor;reusedSource=true;
  } catch(error) {
    if(error.code!=='ORIGINAL_SOURCE_BUNDLE_REQUIRED')throw error;
  }
  if(!descriptor) {
    // The new local case identity is already retained by the original Handoffs
    // checkpoint. Exact repeated receives keep this same native transfer ID.
    const id='case-pkg-'+sha(JSON.stringify([context.manifestSha256,caseResult.case.id,
      bundle.bundleId,bundle.manifestSha256]));
    let view=await service.begin({id,kind:'archive',caseId:caseResult.case.id,
      caseRevision:caseResult.case.importedRevision,label:'Case source '+bundle.manifestSha256.slice(0,16),
      actor:request.actor,files:[{id:'archive',name:bundle.manifestSha256+'.zip',
        role:'source-edition-archive',bytes:String(bundle.archive.bytes),sha256:bundle.archive.sha256}]});
    if(!view.descriptor) {
      const retained=view.files.find(file=>file.id==='archive');
      if(!retained?.present) {
        await uploadOriginalArchive(service,id,await nativePath(packageDirectory,bundle.archive.name),bundle.archive,signal);
      }
      signal?.throwIfAborted();
      view=await service.receive({id});
    }
    descriptor=view.descriptor;
  }
  ensure(descriptor&&typeof descriptor.id==='string','CASE_PACKAGE_SOURCE_RECEIVING',
    'The original source service did not return its completed transfer.');
  equivalent(originalBundleIdentity(descriptor),identity,'CASE_PACKAGE_SOURCE_IDENTITY');
  const actualMembers=descriptor.files.map(file=>({path:file.path,role:file.role,...pin(file)}))
    .sort((a,b)=>textOrder(a.path,b.path));
  equivalent(actualMembers,bundle.files,'CASE_PACKAGE_SOURCE_INCOMPLETE');
  const checkId='case-pkg-'+sha(JSON.stringify([request.requestId,context.manifestSha256,
    bundle.bundleId,bundle.manifestSha256]));
  signal?.throwIfAborted();
  const reopened=await service.reopen({id:descriptor.id,requestId:checkId});
  equivalent(originalBundleIdentity(reopened.check),identity,'CASE_PACKAGE_SOURCE_IDENTITY');
  let members=0;
  for(const file of bundle.files) {
    signal?.throwIfAborted();
    const resolved=await sourceDelivery.resolveFile({...identity,path:file.path});
    equivalent(pin(resolved),pin(file),'CASE_PACKAGE_SOURCE_IDENTITY');
    await filePin(resolved.path,file,signal);members++;
  }
  if(prior)equivalent({transferId:prior.transferId,...originalBundleIdentity(prior)},
    {transferId:descriptor.id,...identity},'CASE_PACKAGE_SOURCE_RECEIVING');
  return {...identity,transferId:descriptor.id,sourceCase:{id:descriptor.caseId,revision:descriptor.caseRevision},
    reusedSource:prior?.reusedSource??reusedSource,archive:bundle.archive,filesVerified:members,
    receivedAt:prior?.receivedAt??new Date().toISOString(),nativeCheck:reopened.check};
}
function receivingIdentity(request) {
  return {schema:request.schema,requestId:request.requestId,actor:request.actor,
    manifestSha256:request.manifestSha256,exportId:request.exportId,sourceCase:request.sourceCase,
    receivingDirectory:request.receivingDirectory,casesDirectory:request.casesDirectory,
    sourceDirectory:request.sourceDirectory};
}
function receivingError(error,stage) {
  return {stage,code:typeof error?.code==='string'?error.code:'CASE_PACKAGE_RECEIVING_FAILED',
    message:typeof error?.message==='string'?error.message:'The original receiving operation needs continuation.'};
}

/** Reopen the selected case through the original Support downloader/reopener,
 * and receive all historical native source archives in the original SF49
 * service. Each stage retains its first identity before performing writes.
 */
export async function receiveCaseSourcePackage({directory,receivingDirectory,casesDirectory,sourceDelivery,
  requestId,actor,expectedManifestSha256,python=process.env.SCF_PYTHON||'python3',
  environment=process.env,signal}={}) {
  ensure(typeof requestId==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(requestId)&&
    typeof actor==='string'&&actor.trim()&&Buffer.byteLength(actor)<=200&&!/[\x00-\x1f\x7f]/.test(actor),
    'CASE_PACKAGE_RECEIVING_INPUT','Use the original receiving request ID and named operator.');
  ensure(SHA.test(expectedManifestSha256??''),'CASE_PACKAGE_EXPECTED_DIGEST',
    'Receive against the completed whole package manifest SHA-256.');
  ensure(sourceDelivery&&typeof sourceDelivery.directory==='string'&&sourceDelivery.service&&
    typeof sourceDelivery.resolveBundle==='function'&&typeof sourceDelivery.resolveFile==='function',
    'CASE_PACKAGE_SOURCE_DIRECTORY','Open the existing case source delivery factory for this receiver.');
  const root=await privateDirectory(rootPath(receivingDirectory,'receiving')),
    cases=await privateDirectory(rootPath(casesDirectory,'receiving case')),
    sources=await privateDirectory(rootPath(sourceDelivery.directory,'receiving source'),{create:false});
  const input=rootPath(directory,'original package');
  for(const [a,b]of [[root,cases],[root,sources],[input,root],[input,cases],[input,sources]])
    ensure(!within(a,b)&&!within(b,a),'CASE_PACKAGE_DIRECTORY',
      'Keep original package and receiving files separate from the working case and source stores.');
  // The original host defaults to <cases>/source-bundles. It is a separate
  // native service directory, outside every UUID case and its immutable files.
  ensure(!within(cases,sources)&&(!within(sources,cases)||
    !UUID.test(sources.slice(cases.length+1).split(sep)[0])),
    'CASE_PACKAGE_DIRECTORY','Keep the source service outside individual native case directories.');
  return locked(root,async stateDirectory=>{
    const requestPath=join(stateDirectory,'receive-request.json'),statePath=join(stateDirectory,'receiving-state.json');
    let progress=(await optionalJson(statePath))?.value??null,context,request,stage='inspect-original-package';
    const checkpoint=async update=>{
      progress={schema:CASE_SOURCE_RECEIVING_SCHEMA,...progress,...update,updatedAt:new Date().toISOString()};
      await atomicJson(statePath,progress,{replace:true});
    };
    try {
      // Once the complete original is retained here, it is the receiving source
      // for every retry. The sender may close or move its package afterwards.
      const retainedRoot=join(root,'package'),retained=await optionalJson(join(retainedRoot,'case-source-package.json'));
      context=await loadCaseSourcePackage({directory:retained?retainedRoot:input,
        expectedManifestSha256,python,environment,signal});
      const identity={schema:'stellar-forge.merchant-case-source-receive-request.v1',requestId,actor,
        manifestSha256:context.manifestSha256,exportId:context.manifest.exportId,sourceCase:context.manifest.case,
        receivingDirectory:root,casesDirectory:cases,sourceDirectory:sources};
      const previous=await optionalJson(requestPath);
      if(previous) {
        request=previous.value;equivalent(receivingIdentity(request),identity,'CASE_PACKAGE_RECEIVING_REQUEST');
        utc(request.createdAt);
      } else {
        request={...identity,createdAt:new Date().toISOString()};
        await atomicJson(requestPath,request);
      }
      if(progress)equivalent({requestId:progress.requestId,manifestSha256:progress.manifestSha256},
        {requestId,manifestSha256:context.manifestSha256},'CASE_PACKAGE_RECEIVING_REQUEST');
      await checkpoint({state:'RECEIVING',requestId,manifestSha256:context.manifestSha256,
        exportId:context.manifest.exportId,sourceCase:context.manifest.case,startedAt:request.createdAt,
        stage,lastError:null,sourceBundles:progress?.sourceBundles??[]});
      stage='retain-original-package';
      if(!retained)await retainWholePackage(context,retainedRoot,signal,
        update=>checkpoint({stage,copy:update}));
      await checkpoint({stage,retainedPackage:{directory:retainedRoot,manifestSha256:context.manifestSha256,
        files:context.manifest.files.length}});
      stage='receive-original-support-export';
      const handoffDirectory=join(root,'handoff'),client=await originalSupportClient(retainedRoot,context.manifest,context.manifestSha256);
      let originalError;
      try {
        signal?.throwIfAborted();
        await downloadSupportExport({client,exportId:context.manifest.exportId,directory:handoffDirectory,
          expectedManifestSha256:context.manifest.support.manifest.sha256,signal,
          onProgress:event=>checkpoint({stage,supportTransfer:{
            state:event.state??null,file:event.file??null,bytes:event.bytes??null,total:event.total??null}})});
      } catch(error){originalError=error;throw error;}
      finally {
        try {await client.close();}
        catch(error){if(originalError){originalError.closeError=error;throw originalError;}throw error;}
      }
      stage='reopen-original-case';
      signal?.throwIfAborted();
      let caseResult=await reopenDownloadedSupportExport({directory:handoffDirectory,casesDirectory:cases});
      equivalent(caseResult.sourceCase,context.manifest.case,'CASE_PACKAGE_CASE_IDENTITY');
      await checkpoint({stage,case:caseResult.case,support:caseResult});
      stage='receive-original-source-bundles';
      const received=[];
      for(const bundle of context.manifest.sourceBundles) {
        const prior=progress.sourceBundles.find(row=>row.bundleId===bundle.bundleId&&row.manifestSha256===bundle.manifestSha256);
        const result=await receiveOriginalBundle({context,packageDirectory:retainedRoot,bundle,sourceDelivery,
          request,caseResult,prior,signal});
        received.push(result);
        await checkpoint({stage,sourceBundles:[...received,
          ...progress.sourceBundles.filter(row=>!received.some(done=>done.bundleId===row.bundleId&&done.manifestSha256===row.manifestSha256))]});
      }
      stage='reopen-complete-case';
      // Read the current receiving head, preserving any legitimate edits made
      // after the first import and before this source receiving continuation.
      caseResult=await reopenDownloadedSupportExport({directory:handoffDirectory,casesDirectory:cases});
      const result={schema:CASE_SOURCE_RECEIVING_SCHEMA,state:'COMPLETE',requestId,actor,
        exportId:context.manifest.exportId,manifestSha256:context.manifestSha256,
        sourceCase:context.manifest.case,case:caseResult.case,support:caseResult,
        package:{directory:retainedRoot,manifestSha256:context.manifestSha256,files:context.manifest.files.length},
        originalCaseHistory:{directory:join(retainedRoot,'original-case-store'),id:context.manifest.case.id,
          headRevision:context.manifest.caseHistory.headRevision,revisions:context.manifest.caseHistory.revisions.length},
        sourceDirectory:sources,sourceBundles:received,
        sourceFilesVerified:received.reduce((sum,row)=>sum+row.filesVerified,0),
        firstReceivedAt:progress.firstReceivedAt??new Date().toISOString(),checkedAt:new Date().toISOString()};
      await atomicJson(join(root,'receiving-result.json'),result,{replace:true});
      await checkpoint({...result,stage:'complete',lastError:null});
      return result;
    } catch(error) {
      // A checkpoint failure preserves the original native file/case/transfer
      // identities; its retry always reads the original native completion first.
      if(request)try {
        await checkpoint({state:'NEEDS_CONTINUATION',stage,lastError:receivingError(error,stage)});
      } catch(checkpointError){error.checkpointError=checkpointError;}
      throw error;
    }
  });
}

/** Parse only the bounded original completion manifest for stream selection.
 * Full history/source verification remains inspectCaseSourcePackage. */
export function parseCaseSourcePackageManifest(value) {
  ensure(typeof value==='string'||value instanceof Uint8Array,'CASE_PACKAGE_MANIFEST',
    'Supply the exact original complete manifest bytes.');
  const bytes=Buffer.from(value);
  ensure(bytes.length>0&&bytes.length<=MAX_CASE_SOURCE_MANIFEST_BYTES,'CASE_PACKAGE_MANIFEST_LIMIT',
    'Use the original bounded complete package manifest.');
  let parsed;
  try{parsed=JSON.parse(decode(bytes));}catch(problem){
    throw Object.assign(new Error('The complete package manifest is not valid UTF-8 JSON.'),
      {code:'CASE_PACKAGE_MANIFEST',status:422});
  }
  return {manifest:completeManifest(parsed),manifestSha256:sha(bytes),bytes:bytes.length};
}
