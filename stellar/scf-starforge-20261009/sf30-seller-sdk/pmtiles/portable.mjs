// MIT. Complete source/runtime/workspace handover with content-addressed receiving.
import {readFile,lstat,readdir,realpath,link,chmod} from 'node:fs/promises';
import {resolve,join,dirname,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {privateDirectory,readJson,readBytes,exists,syncDirectory} from '../../sf88-operator-buyer-cli/node/store.mjs';
import {need,plain,HASH,identifier,pathName,digest,hash,clone,validatePaths,timestamp} from './model.mjs';
import {retainJson,retainFile,fileDescriptor,verifyFiles,MAX_METADATA_BYTES} from './files.mjs';
import {readRuntime,withNativeLease,runNative,PYTHON_HOST_CONTRACT} from './native.mjs';
import {openPMTilesWorkspace,receivePMTilesWorkspace} from './workspace.mjs';
import {VerifiedFile} from '../../sf88-operator-buyer-cli/node/result.mjs';

const HERE=dirname(fileURLToPath(import.meta.url)),SOURCE_ROOT=resolve(HERE,'..','..');
const OWN_PREFIX='sf30-seller-sdk/pmtiles/';
const FILE_KEYS=['pmtilesExecutable','martinExecutable','processLauncher','nativeBundle','previewScript','previewCss','previewWorker'];
const RUNTIME_PATHS={pmtilesExecutable:'bin/pmtiles',martinExecutable:'bin/martin',processLauncher:'native/martin-launch.py',
  nativeBundle:'native/library.cjs',previewScript:'web/preview.js',previewCss:'web/preview.css',previewWorker:'web/maplibre-gl-worker.mjs'};
const PACKAGE_SCHEMA='starforge.pmtiles-operations-package.v1';

async function walkFiles(root,relativePath=''){
  const path=join(root,relativePath),out=[];
  need(await realpath(path)===path,'PMTILES_SOURCE_DIRECTORY_CHANGED');
  for(const entry of (await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    const name=relativePath?relativePath+'/'+entry.name:entry.name;pathName(name);
    if(entry.isDirectory())out.push(...await walkFiles(root,name));
    else{need(entry.isFile()&&!entry.isSymbolicLink(),'PMTILES_SOURCE_NONFILE_MEMBER');out.push(name);}
  }
  return out;
}
async function sourceClosure(){
  const declaration=await readJson(join(HERE,'product-files.json'),MAX_METADATA_BYTES);
  need(declaration.schema==='starforge.pmtiles-product-files.v1'&&Array.isArray(declaration.files),'PMTILES_COMPLETE_PRODUCT_SOURCE_REQUIRED');
  const queue=declaration.files.map(name=>OWN_PREFIX+pathName(name)),rows=new Map();
  queue.push(OWN_PREFIX+'product-files.json');
  while(queue.length){
    const path=queue.shift();if(rows.has(path))continue;
    pathName(path);const absolute=resolve(SOURCE_ROOT,path);
    need(absolute.startsWith(SOURCE_ROOT+sep)&&await realpath(absolute)===absolute,'PMTILES_SOURCE_OUTSIDE_PRODUCT');
    const info=await lstat(absolute);need(info.isFile()&&!info.isSymbolicLink(),'PMTILES_SOURCE_FILE_REQUIRED');
    const descriptor=await fileDescriptor(absolute,{limit:268435456});
    rows.set(path,{path,absolute,...descriptor,mode:0o600});
    if(/\.(?:mjs|cjs|js)$/.test(path)){
      const content=(await readBytes(absolute,MAX_METADATA_BYTES)).toString('utf8'),imports=new Set();
      for(const pattern of [/\b(?:from|import)\s*['"](\.\.?\/[^'"]+)['"]/g,
        /\b(?:import|require)\s*\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g,
        /\bnew\s+URL\s*\(\s*['"](\.\.?\/[^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g]){
        for(const match of content.matchAll(pattern))imports.add(match[1]);
      }
      for(const imported of imports){
        if(/[?#]/.test(imported))need(false,'PMTILES_SOURCE_IMPORT_QUERY_UNSUPPORTED',imported);
        const child=resolve(dirname(absolute),imported);
        need(child.startsWith(SOURCE_ROOT+sep),'PMTILES_SOURCE_IMPORT_OUTSIDE_PRODUCT',imported);
        const type=await lstat(child);
        if(type.isDirectory())continue;
        queue.push(relative(SOURCE_ROOT,child).split(sep).join('/'));
      }
    }
    need(rows.size<=10000,'PMTILES_SOURCE_CLOSURE_LIMIT');
  }
  return [...rows.values()].sort((a,b)=>a.path.localeCompare(b.path));
}
async function objectFile(staging,source,descriptor,{signal,immutable=false}={}){
  const path=join(staging,'objects',descriptor.sha256);
  await privateDirectory(dirname(path));
  if(await exists(path)){
    const prior=await fileDescriptor(path,{signal,limit:2147483648});
    need(prior.bytes===descriptor.bytes&&prior.sha256===descriptor.sha256,'PMTILES_PACKAGE_OBJECT_CHANGED');return;
  }
  const observed=await fileDescriptor(source,{signal,limit:2147483648});
  need(observed.bytes===descriptor.bytes&&observed.sha256===descriptor.sha256,'PMTILES_PACKAGE_SOURCE_CHANGED');
  if(!immutable){await retainFile(source,path,{expected:descriptor,signal});return;}
  // Frozen runtime/snapshot inputs share immutable bytes on the same filesystem.
  try{await link(source,path);}
  catch(error){if(error.code==='EXDEV')await retainFile(source,path,{expected:descriptor,signal});
    else if(error.code==='EEXIST'){const saved=await fileDescriptor(path,{signal});need(saved.bytes===descriptor.bytes&&saved.sha256===descriptor.sha256,'PMTILES_PACKAGE_OBJECT_CHANGED');}
    else throw error;}
  await syncDirectory(dirname(path));
}
async function packageCommand(root,command,{signal,leaseFd}={}){
  const attempt='attempt-'+randomUUID().replaceAll('-',''),directory=join(root,'native',attempt);
  const result=await runNative(directory,command,{signal,leaseFd,timeoutMs:600000});
  const raw=await readBytes(join(directory,result.stdout.path),MAX_METADATA_BYTES);
  const lines=raw.toString('utf8').trim().split('\n'),output=JSON.parse(lines.at(-1));
  need(plain(output),'PMTILES_PACKAGE_RESULT_INVALID');return {result,output,directory};
}
async function runtimeInputs(runtime){
  need(isAbsolute(runtime.buildDirectory),'PMTILES_RUNTIME_SOURCE_DIRECTORY_REQUIRED');
  const root=resolve(runtime.buildDirectory),out=[];
  for(const key of FILE_KEYS){
    const row=runtime[key];out.push({path:'runtime/'+RUNTIME_PATHS[key],absolute:row.path,bytes:row.bytes,sha256:row.sha256,
      mode:['pmtilesExecutable','martinExecutable'].includes(key)?0o700:0o600});
  }
  for(const name of ['runtime.json','build-request.json','build-sources.json']){
    const absolute=join(root,name);out.push({path:'runtime/'+name,absolute,...await fileDescriptor(absolute),mode:0o600});
  }
  const provenance=await readJson(join(root,'build-sources.json'),MAX_METADATA_BYTES);
  need(provenance.schema==='starforge.pmtiles-runtime-sources.v1'&&provenance.buildRequestSha256===runtime.buildRequestSha256,
    'PMTILES_RUNTIME_BUILD_SOURCE_CHANGED');
  for(const row of [...provenance.files,...provenance.licenses]){
    pathName(row.path);need(row.path.startsWith('source/')||row.path.startsWith('licenses/'),'PMTILES_RUNTIME_SOURCE_MEMBER_INVALID');
    out.push({path:'runtime/'+row.path,absolute:join(root,row.path),bytes:row.bytes,sha256:row.sha256,mode:0o600});
  }
  for(const path of await walkFiles(join(root,'build-native'))){
    const absolute=join(root,'build-native',path);
    out.push({path:'runtime/build-native/'+path,absolute,...await fileDescriptor(absolute),mode:0o600});
  }
  const unique=new Map();
  for(const row of out){
    if(unique.has(row.path))need(digest(unique.get(row.path))===digest(row),'PMTILES_RUNTIME_SOURCE_COLLISION');
    unique.set(row.path,row);
  }
  return [...unique.values()].sort((a,b)=>a.path.localeCompare(b.path));
}
export async function createOperationsPackage({workspace,runtime,input,signal}){
  input=clone(input);identifier(input.requestId);runtime=await readRuntime(runtime);
  need(input.expectedWorkspaceId===workspace.state().id,'PMTILES_WORKSPACE_ID_CHANGED');
  for(const key of ['stagingDirectory','destination'])need(isAbsolute(input[key]),'PMTILES_ABSOLUTE_PACKAGE_PATH_REQUIRED',key);
  const root=await privateDirectory(resolve(input.stagingDirectory)),destination=resolve(input.destination);
  need(!root.startsWith(workspace.directory+sep)&&root!==workspace.directory&&
    !workspace.directory.startsWith(root+sep),'PMTILES_SEPARATE_PACKAGE_DIRECTORY_REQUIRED');
  need(!destination.startsWith(root+sep)&&destination!==root,'PMTILES_ARCHIVE_OUTSIDE_STAGING_REQUIRED');
  await privateDirectory(join(root,'locks'));await privateDirectory(dirname(destination));
  return withNativeLease(join(root,'locks'),'package-build',async leaseFd=>{
    const request={schema:'starforge.pmtiles-package-request.v1',requestId:input.requestId,workspaceId:input.expectedWorkspaceId,
      runtimeSha256:runtime.runtimeSha256,destination};
    await retainJson(join(root,'package-request.json'),request);
    const complete=join(root,'package-complete.json');
    if(await exists(complete)){
      const result=await readJson(complete,MAX_METADATA_BYTES);
      need(result.requestSha256===digest(request),'PMTILES_PACKAGE_REQUEST_CHANGED');
      const actual=await fileDescriptor(destination,{limit:34359738368,signal});
      need(actual.bytes===result.archive.bytes&&actual.sha256===result.archive.sha256,'PMTILES_COMPLETE_PACKAGE_CHANGED');return result;
    }
    const stage=join(root,'package'),snapshotRoot=join(root,'workspace-snapshot');
    await privateDirectory(stage);
    const snapshot=await workspace.exportWorkspace({destination:snapshotRoot,requestId:'package-snapshot-'+digest({requestId:input.requestId}).slice(0,40),
      expectedWorkspaceId:input.expectedWorkspaceId,signal});
    let manifest;
    const manifestPath=join(stage,'PACKAGE.json');
    if(await exists(manifestPath)){
      manifest=await readJson(manifestPath,MAX_METADATA_BYTES);
      need(manifest.requestSha256===digest(request)&&manifest.workspace.handoverSha256===snapshot.manifest.sha256,
        'PMTILES_PACKAGE_SELECTION_CHANGED');
      for(const row of manifest.files)await fileDescriptor(join(stage,'objects',row.sha256),{limit:2147483648,signal}).then(actual=>
        need(actual.bytes===row.bytes&&actual.sha256===row.sha256,'PMTILES_PACKAGE_OBJECT_CHANGED'));
    }else{
      const sources=await sourceClosure(),native=await runtimeInputs(runtime);
      const selected=[...sources.map(row=>({...row,path:'source/'+row.path})),...native.map(row=>({...row,immutable:true}))];
      for(const row of snapshot.manifest.files)selected.push({...row,path:'workspace-snapshot/'+row.path,absolute:join(snapshotRoot,row.path),mode:0o600,immutable:true});
      for(const name of ['handover.json','export-request.json','export-selection.json']){
        const absolute=join(snapshotRoot,name);selected.push({path:'workspace-snapshot/'+name,absolute,...await fileDescriptor(absolute),mode:0o600,immutable:true});
      }
      const files=selected.map(({absolute,immutable,...row})=>row).sort((a,b)=>a.path.localeCompare(b.path));validatePaths(files);
      const unique=new Map(files.map(row=>[row.sha256,row]));
      need([...unique.values()].reduce((total,row)=>total+row.bytes,0)<=34359738368,'PMTILES_PACKAGE_SIZE_LIMIT');
      for(const row of selected)await objectFile(stage,row.absolute,row,{signal,immutable:row.immutable===true});
      const bootstrap=[];
      for(const [name,source] of [['RECEIVE.py',join(HERE,'package.py')],['START_HERE.md',join(HERE,'PORTABLE_HANDOVER.md')]]){
        const descriptor=await fileDescriptor(source);await retainFile(source,join(stage,name),{expected:descriptor,signal});
        bootstrap.push({path:name,...descriptor,mode:0o600});
      }
      const chosen={schema:PACKAGE_SCHEMA,requestSha256:digest(request),
        workspace:{id:snapshot.manifest.workspaceId,revision:snapshot.manifest.revision,currentRelease:snapshot.manifest.currentRelease,
          handoverSha256:snapshot.manifest.sha256},
        runtime:{root:'runtime',profile:'runtime/runtime.json',runtimeSha256:runtime.runtimeSha256,pythonHostContract:runtime.pythonHostContract,
          originalPython:clone(runtime.pythonExecutable),files:Object.fromEntries(FILE_KEYS.map(key=>[key,'runtime/'+RUNTIME_PATHS[key]]))},
        source:{root:'source',entry:'source/'+OWN_PREFIX+'cli.mjs',files:sources.length},files,bootstrap,createdAt:snapshot.manifest.exportedAt};
      manifest={...chosen,id:'package-'+digest(chosen).slice(0,32)};
      await retainJson(manifestPath,manifest);
    }
    const manifestBytes=await readBytes(manifestPath,MAX_METADATA_BYTES),manifestSha256=hash(manifestBytes);
    const observed=await packageCommand(root,[runtime.pythonExecutable.path,'-I',join(HERE,'package.py'),'write',
      '--root',stage,'--output',destination,'--manifest-sha256',manifestSha256,'--workspace-id',input.expectedWorkspaceId],{signal,leaseFd});
    need(observed.output.status==='COMPLETE'&&observed.output.manifestSha256===manifestSha256&&
      observed.output.workspaceId===input.expectedWorkspaceId&&observed.output.packageId===manifest.id,'PMTILES_PACKAGE_RESULT_CHANGED');
    const archive=await fileDescriptor(destination,{limit:34359738368,signal});
    need(archive.bytes===observed.output.bytes&&archive.sha256===observed.output.sha256,'PMTILES_PACKAGE_ARCHIVE_CHANGED');
    const result={schema:'starforge.pmtiles-package-complete.v1',requestSha256:digest(request),workspaceId:input.expectedWorkspaceId,
      packageId:manifest.id,manifestSha256,runtimeSha256:runtime.runtimeSha256,workspace:snapshot.manifest,
      archive:{path:destination,...archive},sourceFiles:manifest.source.files,logicalFiles:manifest.files.length,
      uniquePayloads:new Set(manifest.files.map(row=>row.sha256)).size,native:observed.result,completedAt:timestamp()};
    await retainJson(complete,result);return result;
  });
}
export async function receiveInstalledPackage(input,{signal}={}){
  input=clone(input);identifier(input.requestId);
  need(isAbsolute(input.directory)&&isAbsolute(input.workspaceDirectory)&&isAbsolute(input.pythonExecutable),'PMTILES_ABSOLUTE_RECEIVING_PATH_REQUIRED');
  need(HASH.test(input.expectedArchiveSha256??'')&&typeof input.expectedWorkspaceId==='string','PMTILES_ORIGINAL_RECEIVING_SELECTION_REQUIRED');
  const directory=resolve(input.directory),complete=await readJson(join(directory,'package-source-complete.json'),MAX_METADATA_BYTES);
  need(complete.status==='SOURCE_COMPLETE'&&complete.workspaceId===input.expectedWorkspaceId&&
    complete.archiveSha256===input.expectedArchiveSha256,'PMTILES_PACKAGE_SOURCE_RECEIVING_REQUIRED');
  const manifestBytes=await readBytes(join(directory,'PACKAGE.json'),MAX_METADATA_BYTES),manifest=JSON.parse(manifestBytes);
  need(hash(manifestBytes)===complete.manifestSha256&&manifest.id===complete.packageId&&manifest.workspace.id===input.expectedWorkspaceId,
    'PMTILES_PACKAGE_MANIFEST_CHANGED');
  validatePaths(manifest.files);await verifyFiles(directory,manifest.files,{signal});
  const request={schema:'starforge.pmtiles-installed-receiving-request.v1',requestId:input.requestId,workspaceId:input.expectedWorkspaceId,
    archiveSha256:input.expectedArchiveSha256,manifestSha256:complete.manifestSha256,
    workspaceDirectory:resolve(input.workspaceDirectory),pythonExecutable:await realpath(input.pythonExecutable)};
  await privateDirectory(join(directory,'receiving-native'));await privateDirectory(join(directory,'receiving-native','locks'));
  return withNativeLease(join(directory,'receiving-native','locks'),'installed-receiving',async leaseFd=>{
    await retainJson(join(directory,'receiving-native','request.json'),request);
    const targetProfile=join(directory,'runtime','installed-runtime.json');
    const original=await readJson(join(directory,manifest.runtime.profile),MAX_METADATA_BYTES);
    need(original.pythonHostContract===PYTHON_HOST_CONTRACT&&manifest.runtime.pythonHostContract===PYTHON_HOST_CONTRACT,
      'PMTILES_PYTHON_HOST_CONTRACT_CHANGED');
    const profile=clone(original);
    for(const key of FILE_KEYS){
      const path=manifest.runtime.files[key];pathName(path);
      const expected=manifest.files.find(row=>row.path===path);
      need(expected&&expected.sha256===original[key].sha256&&expected.bytes===original[key].bytes,'PMTILES_PACKAGE_RUNTIME_BINDING_CHANGED');
      profile[key]={path:join(directory,path),bytes:expected.bytes,sha256:expected.sha256};
    }
    profile.pythonExecutable={path:request.pythonExecutable,...await fileDescriptor(request.pythonExecutable,{limit:268435456,signal})};
    profile.buildDirectory=join(directory,'runtime');
    const runtime=await readRuntime(profile);
    need(runtime.runtimeSha256===manifest.runtime.runtimeSha256,'PMTILES_RECEIVING_RUNTIME_CHANGED');
    const localPython=await packageCommand(join(directory,'receiving-native'),
      [profile.pythonExecutable.path,'-I','-c',
       'import ctypes,os,sys,json; assert sys.platform=="linux"; assert sys.version_info >= (3,11); print(json.dumps({"status":"COMPATIBLE","version":sys.version}))'],
      {signal,leaseFd});
    need(localPython.output.status==='COMPATIBLE','PMTILES_PYTHON_HOST_INCOMPATIBLE');
    await retainJson(targetProfile,profile);
    const received=await receivePMTilesWorkspace({source:join(directory,'workspace-snapshot'),destination:request.workspaceDirectory,
      expectedWorkspaceId:input.expectedWorkspaceId,expectedSha256:manifest.workspace.handoverSha256,
      requestId:input.requestId,signal});
    const workspace=await openPMTilesWorkspace({directory:request.workspaceDirectory,create:false,expectedWorkspaceId:input.expectedWorkspaceId});
    let state;
    try{
      state=workspace.state();
      need(state.receivedFrom?.handoverSha256===manifest.workspace.handoverSha256,'PMTILES_RECEIVING_WORKSPACE_CHANGED');
      if(state.currentRelease){const release=workspace.getRelease(state.currentRelease);
        need(release.runtimeSha256===runtime.runtimeSha256,'PMTILES_RECEIVING_RELEASE_RUNTIME_CHANGED');
        await verifyFiles(workspace.releaseDirectory(release.id),release.files,{signal});}
    }finally{await workspace.close();}
    const resultPath=join(directory,'receiving-native','complete.json');
    if(await exists(resultPath)){
      const prior=await readJson(resultPath,MAX_METADATA_BYTES);
      need(prior.requestSha256===digest(request)&&prior.packageId===manifest.id&&prior.runtimeSha256===runtime.runtimeSha256,
        'PMTILES_INSTALLED_RECEIVING_RESULT_CHANGED');
      return {...prior,currentRevision:state.revision,currentRelease:state.currentRelease,reused:true};
    }
    const result={schema:'starforge.pmtiles-installed-received.v1',status:'COMPLETE',requestSha256:digest(request),
      packageId:manifest.id,archiveSha256:complete.archiveSha256,workspaceId:input.expectedWorkspaceId,workspaceDirectory:request.workspaceDirectory,
      runtimeProfile:targetProfile,runtimeSha256:runtime.runtimeSha256,sourceRevision:manifest.workspace.revision,
      revision:received.revision,currentRelease:state.currentRelease,pythonHost:{...profile.pythonExecutable,version:localPython.output.version},
      receivedAt:timestamp(),serveCommand:['node',join(directory,manifest.source.entry),'serve','--workspace',request.workspaceDirectory,
        '--runtime',targetProfile,'--workspace-id',input.expectedWorkspaceId]};
    await retainJson(resultPath,result);return result;
  });
}
export async function receiveOperationsPackage(input,{signal}={}){
  input=clone(input);identifier(input.requestId);
  for(const key of ['archive','directory','workspaceDirectory','pythonExecutable'])need(isAbsolute(input[key]),'PMTILES_ABSOLUTE_RECEIVING_PATH_REQUIRED',key);
  const directory=await privateDirectory(resolve(input.directory)),python=await realpath(input.pythonExecutable);
  await privateDirectory(join(directory,'receiving-native'));await privateDirectory(join(directory,'receiving-native','locks'));
  const source=await packageCommand(join(directory,'receiving-native'),[python,'-I',join(HERE,'package.py'),'receive',
    '--archive',resolve(input.archive),'--destination',directory,'--expected-sha256',input.expectedArchiveSha256,
    '--workspace-id',input.expectedWorkspaceId],{signal});
  need(source.output.status==='SOURCE_COMPLETE','PMTILES_PACKAGE_SOURCE_RECEIVING_FAILED');
  return receiveInstalledPackage(input,{signal});
}

class CompletePackageFile extends VerifiedFile{
  constructor(record){super();this.record=clone(record);}
  get path(){return this.record.path;}
  _metadata(){return clone(this.record);}
}
export async function readOperationsPackage(input){
  input=clone(input);identifier(input.requestId);
  need(isAbsolute(input.stagingDirectory)&&HASH.test(input.archiveSha256??''),'PMTILES_PACKAGE_DOWNLOAD_SELECTION_REQUIRED');
  const root=resolve(input.stagingDirectory),request=await readJson(join(root,'package-request.json'),MAX_METADATA_BYTES);
  const result=await readJson(join(root,'package-complete.json'),MAX_METADATA_BYTES);
  need(request.requestId===input.requestId&&request.workspaceId===input.expectedWorkspaceId&&
    result.requestSha256===digest(request)&&result.workspaceId===input.expectedWorkspaceId&&
    result.archive.path===request.destination&&result.archive.sha256===input.archiveSha256,'PMTILES_PACKAGE_DOWNLOAD_CHANGED');
  const file=new CompletePackageFile(result.archive);await file.verify();return {file,result};
}
