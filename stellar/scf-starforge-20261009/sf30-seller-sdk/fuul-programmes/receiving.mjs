// MIT. Complete private workspace and institutional report receiving.
import { promises as fs } from 'node:fs';
import { dirname,join,resolve,isAbsolute,basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  files,now,plain,clone,digest,canonical,jsonBytes,need,integer,identifier,selected,hash,
  privateDirectory,withLock,descriptor,copyDescriptor,collectFiles,sealed,verified,inside,
  SOURCE_ROOT,STATE_SCHEMA,readState,recoverState,intent,replay,revision,commitState,
  readDescriptor,readRecord,retainJSON,assertOriginalHistory,mutate,html
} from './common.mjs';
import {resolveFuulRuntime,readFuulRuntimeManifest,restoreFuulRuntime,verifyFuulRuntime,publicFuulRuntime} from './runtime.mjs';
const EXPORT_SCHEMA='stellar-forge.fuul-programmes.package.v1';
const APP_SCHEMA='stellar-forge.fuul-programmes.application-source.v1';
const RECEIVING_SCHEMA='stellar-forge.fuul-programmes.receiving.v1';
const SOURCE_FOLDER=dirname(fileURLToPath(import.meta.url));
const REPO_ROOT=resolve(SOURCE_FOLDER,'../../../..');

export function fuulRuntimeReferences(state){
  const result=new Map();
  for(const table of ['sources','captures','actions'])for(const row of Object.values(state[table]??{})){
    if(row.runtime===undefined||row.runtime===null)continue;
    const runtime=row.runtime;
    need(plain(runtime),'INVALID_RUNTIME_SOURCE','Retained source runtime metadata must be a complete descriptor.');
    hash(runtime.id);hash(runtime.manifestSha256);
    need(runtime.version==='0.3.0'&&runtime.stellarVersion==='17.2.1','INVALID_RUNTIME_SOURCE','The retained source must name the original Fuul SDK and Stellar dependency versions.');
    const prior=result.get(runtime.id);
    need(!prior||(prior.manifestSha256===runtime.manifestSha256&&prior.version===runtime.version&&prior.stellarVersion===runtime.stellarVersion),
      'RUNTIME_SOURCE_CHANGED','The same runtime ID names conflicting original source.');
    result.set(runtime.id,{id:runtime.id,manifestSha256:runtime.manifestSha256,version:runtime.version,stellarVersion:runtime.stellarVersion});
  }
  return [...result.values()].sort((a,b)=>a.id.localeCompare(b.id));
}
function requireRuntimeCoverage(state,selections){
  const map=new Map(selections.map(item=>[item.id,item]));
  for(const required of fuulRuntimeReferences(state)){
    const selected=map.get(required.id);
    need(selected?.manifestSha256===required.manifestSha256&&selected?.version===required.version&&selected?.stellarVersion===required.stellarVersion,
      'RUNTIME_SOURCE_REQUIRED','Include the complete original installed runtime used by this capture, source or prepared action.',
      {runtimeId:required.id,manifestSha256:required.manifestSha256,version:required.version,stellarVersion:required.stellarVersion});
  }
}
async function selectedRuntimeSources(selections=[]){
  need(Array.isArray(selections),'INVALID_RUNTIME_SOURCE','Supply complete trusted runtime source selections.');
  const result=new Map();
  for(const item of selections){
    need(plain(item),'INVALID_RUNTIME_SOURCE','Select the original runtime directory and manifest.');
    await originalDirectory(item.directory);
    const runtime=await resolveFuulRuntime({runtimeDirectory:item.directory,expectedManifestSha256:item.expectedManifestSha256});
    const publicRuntime=publicFuulRuntime(runtime),previous=result.get(runtime.id);
    if(previous){
      need(previous.manifestSha256===runtime.manifestSha256,'RUNTIME_SOURCE_CHANGED','One runtime ID has conflicting original manifests.');
      continue;
    }
    const manifest=await descriptor(runtime.directory,'manifest.json','application/json');
    need(manifest.sha256===runtime.manifestSha256,'RUNTIME_SOURCE_CHANGED','The selected original runtime manifest changed.');
    const nativeFiles=runtime.manifest.files.map(file=>({...file,contentType:file.path.endsWith('.json')?'application/json':'application/octet-stream'}));
    result.set(runtime.id,{...publicRuntime,directory:runtime.directory,files:[manifest,...nativeFiles]});
  }
  return [...result.values()].sort((a,b)=>a.id.localeCompare(b.id));
}
function validateRuntimeSelections(manifest){
  need(Array.isArray(manifest.runtimes),'INVALID_DELIVERY','The package runtime selection is missing.');
  const seen=new Set();
  for(const runtime of manifest.runtimes){
    need(plain(runtime),'INVALID_DELIVERY','A complete runtime selection is required.');
    hash(runtime.id);hash(runtime.manifestSha256);
    need(runtime.version==='0.3.0'&&runtime.stellarVersion==='17.2.1'&&!seen.has(runtime.id)&&runtime.sourceRoot==='runtimes/'+runtime.id+'/source',
      'INVALID_DELIVERY','The original runtime namespace or version conflicts.');
    seen.add(runtime.id);
    const file=manifest.files.find(item=>item.role==='runtime'&&item.path===runtime.sourceRoot+'/manifest.json');
    need(file?.sha256===runtime.manifestSha256,'INVALID_DELIVERY','The complete original runtime manifest is absent.');
  }
  for(const file of manifest.files.filter(item=>item.role==='runtime'))
    need(manifest.runtimes.some(runtime=>file.path.startsWith(runtime.sourceRoot+'/')),
      'INVALID_DELIVERY','A runtime file lies outside its retained runtime selection.');
  if(manifest.kind==='report')need(manifest.runtimes.length===0,'INVALID_DELIVERY','A report-only package must retain its original report selection.');
}
async function inspectDeliveryRuntimes(sourceDirectory,manifest){
  for(const runtime of manifest.runtimes){
    const root=join(sourceDirectory,runtime.sourceRoot);
    const native=await readFuulRuntimeManifest({directory:root,expectedManifestSha256:runtime.manifestSha256});
    need(native.manifest.id===runtime.id&&native.manifest.sdk.version===runtime.version&&native.manifest.stellar.version===runtime.stellarVersion,
      'RUNTIME_SOURCE_CHANGED','The retained native runtime selection differs from the package.');
    const declared=manifest.files.filter(item=>item.role==='runtime'&&item.path.startsWith(runtime.sourceRoot+'/'));
    const map=new Map(declared.map(item=>[item.path.slice(runtime.sourceRoot.length+1),item]));
    need(map.size===native.manifest.files.length+1,'INVALID_DELIVERY','The package must contain every original runtime regular file exactly once.');
    const nativeManifest=map.get('manifest.json');
    need(nativeManifest?.bytes===native.bytes.length&&nativeManifest.sha256===native.manifestSha256,
      'RUNTIME_SOURCE_CHANGED','The original runtime manifest bytes differ.');
    for(const file of native.manifest.files){
      const supplied=map.get(file.path);
      need(supplied?.bytes===file.bytes&&supplied?.sha256===file.sha256&&supplied?.mode===file.mode,
        'RUNTIME_SOURCE_CHANGED','A complete original runtime file differs from its package member.',{runtimeId:runtime.id,path:file.path});
    }
  }
}
async function restoreDeliveryRuntimes(staging,destination,manifest){
  const result=[];
  for(const runtime of manifest.runtimes){
    const installedRoot='runtimes/'+runtime.id+'/installed';
    const restored=await restoreFuulRuntime({sourceDirectory:join(staging,runtime.sourceRoot),
      destination:join(staging,installedRoot),expectedManifestSha256:runtime.manifestSha256});
    need(restored.id===runtime.id,'RUNTIME_SOURCE_CHANGED','The received runtime identity differs from its original package.');
    result.push({...publicFuulRuntime(restored),installedRoot,directory:join(destination,installedRoot),
      sourceDirectory:join(destination,runtime.sourceRoot)});
  }
  return result;
}

function receiptId(value){
  const s=digest(value);return s.slice(0,8)+'-'+s.slice(8,12)+'-4'+s.slice(13,16)+'-8'+s.slice(17,20)+'-'+s.slice(20,32);
}
async function exists(path){try{return await fs.lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function originalDirectory(directory){
  need(typeof directory==='string'&&isAbsolute(directory)&&resolve(directory)===directory,'INVALID_DIRECTORY','Select an absolute original directory.');
  const stat=await fs.lstat(directory);
  need(stat.isDirectory()&&!stat.isSymbolicLink()&&await fs.realpath(directory)===directory,'INVALID_DIRECTORY','Select a real original directory.');
  return directory;
}
async function fsyncDirectory(directory){
  const file=await fs.open(directory,'r');try{await file.sync();}finally{await file.close();}
}
async function manifestAt(directory,expectedManifestSha256){
  await originalDirectory(directory);
  const bytes=await files.readFile(directory,'manifest.json'),manifest=JSON.parse(bytes.toString('utf8'));
  if(expectedManifestSha256!==undefined)need(digest(bytes)===hash(expectedManifestSha256),'SOURCE_CHANGED','The original delivery manifest differs.');
  verified(manifest,'Delivery manifest');
  need(manifest.schema===EXPORT_SCHEMA&&['workspace','report'].includes(manifest.kind),'INVALID_DELIVERY','Select a complete Fuul programme delivery.');
  identifier(manifest.id);identifier(manifest.workspaceId);integer(manifest.workspaceRevision,'workspaceRevision');
  need(Array.isArray(manifest.files)&&manifest.files.length>0,'INVALID_DELIVERY','The complete delivery file list is missing.');
  const seen=new Set();
  for(const item of manifest.files){
    files.relativeFile(item.path);hash(item.sha256);integer(item.bytes,'file bytes');
    if(item.mode!==undefined)integer(item.mode,'original file mode',0,0o777);
    need(!seen.has(item.path)&&['workspace','application','runtime','report','guide'].includes(item.role),'INVALID_DELIVERY','The original file roles or paths conflict.');
    seen.add(item.path);
    if(item.role==='workspace')need(item.path.startsWith('workspace/'),'INVALID_DELIVERY','Workspace files must remain in their original section.');
    if(item.role==='application')need(item.path.startsWith('application/source/'),'INVALID_DELIVERY','Application files must remain in their original section.');
    if(item.role==='report')need(item.path.startsWith('report/'),'INVALID_DELIVERY','Report files must remain in their original section.');
    if(item.role==='runtime')need(item.path.startsWith('runtimes/'),'INVALID_DELIVERY','Runtime files must remain in their original section.');
  }
  if(manifest.kind==='workspace')need(plain(manifest.application),'INVALID_DELIVERY','The complete workspace delivery must include its source application.');
  if(manifest.application){
    const app=manifest.application;
    need(app.sourceRoot==='application/source'&&plain(app.entrypoints),'INVALID_DELIVERY','The application must use its own retained source root.');
    hash(app.sourceManifestSha256);
    for(const key of ['cli','server']){
      files.relativeFile(app.entrypoints[key]);
      need(manifest.files.some(item=>item.role==='application'&&item.path===app.sourceRoot+'/'+app.entrypoints[key]),
        'INVALID_DELIVERY','The application entrypoint is missing from its retained source.',{entrypoint:key});
    }
    const sourceManifest=manifest.files.find(item=>item.role==='application'&&item.path===app.sourceRoot+'/'+SOURCE_ROOT+'/source-files.json');
    need(sourceManifest?.sha256===app.sourceManifestSha256,'INVALID_DELIVERY','The declared application source manifest differs from its retained file.');
  }
  validateRuntimeSelections(manifest);
  return {manifest,manifestSha256:digest(bytes),bytes};
}
const EXPORT_INTENT_SCHEMA='stellar-forge.fuul-programmes.export-intent.v2';
const EXPORT_SELECTION_SCHEMA='stellar-forge.fuul-programmes.export-selection.v1';
async function assertSelectedFile(directory,file){
  hash(file.sha256);integer(file.bytes,'source bytes');
  await files.sourceFileRange(directory,file,0,1);
  const stat=await fs.lstat(await files.filePath(directory,file.path));
  need(stat.isFile()&&!stat.isSymbolicLink(),'INVALID_SOURCE','The original delivery member must be a regular file.',{path:file.path});
  if(file.mode!==undefined)need((stat.mode&0o777)===file.mode,'SOURCE_CHANGED','The original delivery file mode differs.',{path:file.path});
  return file.bytes;
}
async function assertFiles(directory,manifest){
  let bytes=0;
  for(const file of manifest.files){
    bytes+=await assertSelectedFile(directory,file);
    integer(bytes,'complete delivery bytes');
  }
  return bytes;
}
async function originalApplication(){
  const body=await fs.readFile(join(SOURCE_FOLDER,'source-files.json')),manifest=JSON.parse(body.toString('utf8'));
  need(manifest.schema===APP_SCHEMA&&manifest.rootFromWorkspace==='../../../..'&&Array.isArray(manifest.files),
    'APPLICATION_SOURCE_REQUIRED','Install the complete source-owned Fuul programme distribution.');
  const selected=[],seen=new Set();
  for(const item of manifest.files){
    files.relativeFile(item.path);need(!seen.has(item.path),'INVALID_APPLICATION_SOURCE','Application source paths repeat.');seen.add(item.path);
    need(item.path!==SOURCE_ROOT+'/source-files.json','INVALID_APPLICATION_SOURCE','The application manifest declares itself recursively.');
    const observed=await descriptor(REPO_ROOT,item.path,item.contentType??(item.path.endsWith('.json')?'application/json':'text/plain'));
    need(observed.bytes===item.bytes&&observed.sha256===item.sha256,'APPLICATION_SOURCE_CHANGED','The application source differs from its installed cohort.',{path:item.path});
    selected.push({...observed,role:'application'});
  }
  const own=await descriptor(REPO_ROOT,SOURCE_ROOT+'/source-files.json','application/json');
  need(own.bytes===body.length&&own.sha256===digest(body),'APPLICATION_SOURCE_CHANGED','The original application manifest changed during selection.');
  selected.push({...own,role:'application'});
  return {manifestSha256:digest(body),files:selected,entrypoints:{cli:SOURCE_ROOT+'/cli.mjs',server:SOURCE_ROOT+'/server.mjs'},
    runtime:{engine:'node',minimumMajor:22,minimumMinor:16}};
}
function workspaceFile(item,revision){
  if(item.path==='genesis.json')return true;
  if(item.path.startsWith('history/')){
    const match=item.path.match(/^history\/(\d{12})-[a-f0-9]{64}\.json$/);
    return Boolean(match&&Number(match[1])<=revision);
  }
  return /^(programmes|captures|sources|events|batches|actions|runs|decisions|reconciliations|reports)\//.test(item.path);
}
async function workspaceCandidates(directory,revision){
  // Retained members are published once under immutable names. Only enumerate
  // their names and metadata here; hashing and copying run after writer release.
  const result=[];
  async function walk(prefix){
    const path=prefix?join(directory,prefix):directory;
    const entries=(await fs.readdir(path,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name));
    for(const entry of entries){
      if(/\.pending-[a-f0-9-]+$/.test(entry.name))continue;
      const relative=prefix?prefix+'/'+entry.name:entry.name;
      if(!prefix&&!['genesis.json','history','programmes','captures','sources','events','batches','actions','runs','decisions','reconciliations','reports'].includes(entry.name))continue;
      files.relativeFile(relative);
      need(!entry.isSymbolicLink(),'INVALID_SOURCE','The original workspace source cannot contain external links.',{path:relative});
      if(entry.isDirectory())await walk(relative);
      else if(workspaceFile({path:relative},revision)){
        need(entry.isFile(),'INVALID_SOURCE','The original workspace source must be a regular file.',{path:relative});
        const stat=await fs.lstat(await files.filePath(directory,relative));
        need(stat.isFile()&&!stat.isSymbolicLink()&&Number.isSafeInteger(stat.size),'INVALID_SOURCE','The original workspace member changed during selection.',{path:relative});
        result.push({path:relative,bytes:stat.size,mode:stat.mode&0o777,
          contentType:relative.endsWith('.json')?'application/json':'application/octet-stream'});
      }
    }
  }
  await walk('');
  need(result.some(file=>file.path==='genesis.json'),'INVALID_WORKSPACE','The original workspace genesis is missing.');
  return result;
}
function receivingGuide(manifest){
  if(manifest.kind==='report')return '# '+manifest.name+'\n\nOpen report/'+(manifest.report?.html??'report.html')+
    '. The report.json file retains the exact original sealed report metadata. Every original JSON, CSV and HTML member remains available under its own filename.\n\nReport ID: '+manifest.reportId+'\nManifest SHA field: '+manifest.sha256+'\n';
  const cli=manifest.application?.entrypoints.cli;
  return '# '+manifest.name+'\n\nThis delivery includes the original Fuul programme workspace, complete original Fuul API and Stellar RPC request/response files, event and action attempts, programme runs and history, complete application source, and every referenced original Fuul SDK/Stellar runtime.\n\n'+
    'Receive with the same installed CLI:\n\n'+
    'node '+(cli?'application/source/'+cli:'PATH_TO_FUUL_CLI')+' package-receive --source-directory ORIGINAL_DELIVERY --destination NEW_CLIENT_DIRECTORY --request-id ORIGINAL_RECEIVE_UUID\n\n'+
    'When the sender provides the manifest SHA-256, append --expected-manifest-sha256 ORIGINAL_MANIFEST_SHA256.\n\n'+
    'Open the returned workspace using its returned CLI. Configure the same public source aliases with host-private endpoint credentials. Merge the returned runtime connections into that private configuration so every Stellar connection selects its original runtime ID and manifest. The receiver has already reconstructed complete package files, native resolution links and permission modes.\n\n'+
    'Workspace identity and all original source/history bytes remain selected. Captures, events, batches and actions reopen with paused=true; incomplete captures and unfinished programme runs become PAUSED. Original in-flight requests, event dedup identities, action prerequisites, task selections, run positions and execution arguments remain unchanged. Select the receiving host’s original private project/RPC connections, then resume each selected queue and programme run through its existing operation.\n\n'+
    'Original workspace: '+manifest.workspaceId+'\nOriginal revision: '+manifest.workspaceRevision+'\nOriginal head: '+manifest.workspaceHead+'\n';
}
async function existingExport(destination,before,operation,args,kind){
  if(!await exists(join(destination,'manifest.json')))return null;
  const original=await manifestAt(destination),manifest=original.manifest,request=intent(operation,args);
  need(manifest.kind===kind&&manifest.workspaceId===before.workspaceId&&manifest.requestId===request.requestId&&
    manifest.intentSha256===request.intentSha256,'DELIVERY_DESTINATION_CONFLICT','The selected directory belongs to a different original delivery.');
  await assertFiles(destination,manifest);
  return original;
}
function exportResult(destination,original){
  const {manifest,manifestSha256}=original;
  return {exportId:manifest.id,kind:manifest.kind,directory:destination,manifestSha256,
    sourceWorkspaceId:manifest.workspaceId,sourceRevision:manifest.workspaceRevision,sourceHead:manifest.workspaceHead,
    files:manifest.files.length,bytes:manifest.files.reduce((sum,item)=>sum+item.bytes,0),
    reportId:manifest.reportId??null,application:manifest.application??null,runtimes:manifest.runtimes??[]};
}
function validateExportIntent(pin,directory,args,kind,state){
  verified(pin,'Original export selection');
  const request=intent(kind==='workspace'?'workspace.export':'report.export',args);
  need(pin.schema===EXPORT_INTENT_SCHEMA&&pin.kind===kind&&pin.sourceDirectory===directory&&pin.destination===args.destination&&
    pin.workspaceId===state.workspaceId&&pin.requestId===request.requestId&&pin.intentSha256===request.intentSha256,
    'DELIVERY_DESTINATION_CONFLICT','The incomplete delivery belongs to a different original export.');
  identifier(pin.workspaceId);integer(pin.workspaceRevision,'original workspace revision');
  need(pin.workspaceHead===null||/^[a-f0-9]{64}$/.test(pin.workspaceHead),'INVALID_DELIVERY','The original selected workspace head is invalid.');
  return pin;
}
const pendingIntentName=/^export-intent\.json\.pending-[a-f0-9-]{36}$/;
async function recoveredExportIntent(directory,args,kind,initial){
  if(await exists(join(args.destination,'export-intent.json')))
    return validateExportIntent(await files.readJSON(args.destination,'export-intent.json'),directory,args,kind,initial);
  let selected=null;
  for(const name of (await fs.readdir(args.destination)).filter(name=>pendingIntentName.test(name)).sort()){
    let candidate;
    try{candidate=await files.readJSON(args.destination,name);}
    catch(error){if(error instanceof SyntaxError||error.code==='INVALID_SOURCE_JSON'||error.code==='ENOENT')continue;throw error;}
    // A complete original intent can survive file sync before its final link.
    // Recover that exact selection rather than selecting a newer workspace.
    const pin=validateExportIntent(candidate,directory,args,kind,initial);
    need(selected===null||selected.sha256===pin.sha256,'DELIVERY_DESTINATION_CONFLICT','Incomplete original export selections disagree.');
    selected=pin;
  }
  if(selected){
    await retainJSON(args.destination,'export-intent.json',selected);
    await fsyncDirectory(args.destination);
  }
  return selected;
}
async function pinExport(directory,args,kind,initial,runtimeSources){
  const saved=await recoveredExportIntent(directory,args,kind,initial);
  if(saved)return {pin:saved};
  // This is the exact executing application cohort. Resolve it before entering
  // the workspace writer; retries read this retained selection, never a new one.
  const application=kind==='workspace'||args.includeApplication===true?await originalApplication():null;
  const runtimes=kind==='workspace'?await selectedRuntimeSources(runtimeSources):[];
  return withLock(directory,'writer.lock',async()=>{
    await recoverState(directory);const before=await readState(directory),operation=kind==='workspace'?'workspace.export':'report.export';
    const previous=replay(before,operation,args);if(previous)return {completed:previous};
    revision(before,args);
    const entries=await fs.readdir(args.destination);
    need(entries.every(name=>name==='export.lock'||pendingIntentName.test(name)),'DELIVERY_DESTINATION_NOT_EMPTY','Use an empty directory or this operation’s incomplete delivery.');
    const request=intent(operation,args),report=kind==='report'?clone(selected(before.reports,args.reportId,'Report')):null;
    let snapshot=null;
    if(kind==='workspace'){
      const bytes=await files.readFile(directory,'state.json'),state=JSON.parse(bytes.toString('utf8'));
      need(canonical(state)===canonical(before),'SOURCE_CHANGED','The original workspace state changed during selection.');
      const stat=await fs.lstat(await files.filePath(directory,'state.json'));
      requireRuntimeCoverage(state,runtimes);
      snapshot={state:{path:'state.json',bytes:bytes.length,sha256:digest(bytes),mode:stat.mode&0o777,
          contentType:'application/json',base64:bytes.toString('base64')},
        files:await workspaceCandidates(directory,before.revision)};
    }
    const pin=sealed({schema:EXPORT_INTENT_SCHEMA,...request,kind,sourceDirectory:directory,destination:args.destination,
      workspaceId:before.workspaceId,workspaceRevision:before.revision,workspaceHead:before.head,
      createdAt:now(),name:args.name??(report?report.name:before.profile.name),report,snapshot,
      application:application?{...application,sourceDirectory:REPO_ROOT}:null,runtimes});
    await retainJSON(args.destination,'export-intent.json',pin);
    await fsyncDirectory(args.destination);
    return {pin};
  });
}
function inlineCopy(path,body,metadata){
  need(Buffer.isBuffer(body),'INVALID_SOURCE','The selected inline source must preserve original bytes.');
  return {origin:'inline',base64:body.toString('base64'),
    file:{path,bytes:body.length,sha256:digest(body),mode:0o600,...metadata}};
}
async function originalFile(directory,item){
  const observed=await descriptor(directory,item.path,item.contentType??'application/octet-stream');
  need(observed.bytes===item.bytes&&(item.sha256===undefined||observed.sha256===item.sha256)&&
    (item.mode===undefined||observed.mode===item.mode),'SOURCE_CHANGED','The original selected source changed before its delivery copy.',{path:item.path});
  return observed;
}
function sourceCopy(origin,source,path,metadata){
  files.relativeFile(path);
  return {origin,source:clone(source),file:{...source,path,...metadata}};
}
function validateExportSelection(selection,pin){
  verified(selection,'Retained export copy plan');
  need(selection.schema===EXPORT_SELECTION_SCHEMA&&selection.intentSha256===pin.sha256&&Array.isArray(selection.copies),
    'INVALID_DELIVERY','The retained copy plan differs from its original export selection.');
  const manifest=verified(selection.manifest,'Pinned delivery manifest');
  need(manifest.schema===EXPORT_SCHEMA&&manifest.kind===pin.kind&&manifest.id===pin.requestId&&manifest.requestId===pin.requestId&&
    manifest.intentSha256===pin.intentSha256&&manifest.workspaceId===pin.workspaceId&&manifest.workspaceRevision===pin.workspaceRevision&&
    manifest.workspaceHead===pin.workspaceHead&&canonical(manifest.files)===canonical(selection.copies.map(copy=>copy.file)),
    'INVALID_DELIVERY','The retained delivery manifest differs from its original copy plan.');
  const seen=new Set();
  for(const copy of selection.copies){
    const file=copy.file;
    files.relativeFile(file.path);hash(file.sha256);integer(file.bytes,'selected source bytes');integer(file.mode,'selected source mode',0,0o777);
    need(!seen.has(file.path)&&['workspace','application','runtime','report','guide'].includes(file.role),'INVALID_DELIVERY','The original copy plan repeats a file or has an invalid role.');
    seen.add(file.path);
    need(['workspace','application','runtime','inline'].includes(copy.origin),'INVALID_DELIVERY','The original copy plan has an unknown source.');
    if(copy.origin==='inline'){
      need(typeof copy.base64==='string','INVALID_DELIVERY','The retained original inline bytes are missing.');
      const body=Buffer.from(copy.base64,'base64');
      need(body.toString('base64')===copy.base64&&body.length===file.bytes&&digest(body)===file.sha256,
        'SOURCE_CHANGED','The original inline source bytes changed.',{path:file.path});
    }else{
      files.relativeFile(copy.source?.path);hash(copy.source?.sha256);integer(copy.source?.bytes,'original source bytes');
      need(copy.source.sha256===file.sha256&&copy.source.bytes===file.bytes,'INVALID_DELIVERY','A copied source differs from its original descriptor.');
    }
  }
  validateRuntimeSelections(manifest);
  return selection;
}
async function selectExportFiles(destination,pin){
  if(await exists(join(destination,'export-selection.json')))
    return validateExportSelection(await files.readJSON(destination,'export-selection.json'),pin);
  const copies=[];let reportId=null,report=null,application=null;const runtimes=[];
  if(pin.kind==='workspace'){
    need(plain(pin.snapshot)&&plain(pin.snapshot.state)&&Array.isArray(pin.snapshot.files),'INVALID_DELIVERY','The original workspace selection is missing.');
    const original=pin.snapshot.state,body=Buffer.from(original.base64,'base64');
    need(body.toString('base64')===original.base64&&body.length===original.bytes&&digest(body)===original.sha256,
      'SOURCE_CHANGED','The exact selected workspace state differs from its retained bytes.');
    const state=JSON.parse(body.toString('utf8'));
    need(state.schema===STATE_SCHEMA&&state.workspaceId===pin.workspaceId&&state.revision===pin.workspaceRevision&&state.head===pin.workspaceHead,
      'WORKSPACE_SOURCE_MISMATCH','The selected workspace state differs from the original export.');
    await assertOriginalHistory(pin.sourceDirectory,state);
    requireRuntimeCoverage(state,pin.runtimes??[]);
    copies.push(inlineCopy('workspace/state.json',body,{role:'workspace',originalPath:'state.json',contentType:'application/json',mode:original.mode}));
    for(const candidate of pin.snapshot.files){
      const file=await originalFile(pin.sourceDirectory,candidate);
      copies.push(sourceCopy('workspace',file,'workspace/'+file.path,{role:'workspace',originalPath:file.path}));
    }
  }else{
    const original=pin.report.file??pin.report;
    const bytes=await readDescriptor(pin.sourceDirectory,original),body=verified(JSON.parse(bytes.toString('utf8')),'Report');
    need(body.id===pin.report.id,'SOURCE_CHANGED','The retained report edition identity differs.');
    reportId=body.id;
    need(Array.isArray(body.files)&&body.files.length>0,'INVALID_REPORT','The original report has no retained member files.');
    const names=new Set(['report.json']);let html=null;
    for(const item of body.files){
      need(typeof item.filename==='string'&&!/[\/\\]/.test(item.filename)&&item.filename!=='.'&&item.filename!=='..'&&!names.has(item.filename),
        'INVALID_REPORT','Original report filenames must be unique, complete leaf names.');
      names.add(item.filename);
      const file=await originalFile(pin.sourceDirectory,item.file??item);
      need((item.bytes===undefined||item.bytes===file.bytes)&&(item.sha256===undefined||item.sha256===file.sha256),
        'SOURCE_CHANGED','The original report member differs from its retained metadata.',{filename:item.filename});
      copies.push(sourceCopy('workspace',file,'report/'+item.filename,{role:'report',originalPath:file.path,
        contentType:item.contentType??file.contentType,filename:item.filename,format:item.format??null}));
      if(item.format==='html'||item.contentType==='text/html')html??=item.filename;
    }
    const metadata=await originalFile(pin.sourceDirectory,original);
    copies.push(sourceCopy('workspace',metadata,'report/report.json',{role:'report',originalPath:metadata.path,
      filename:'report.json',format:'manifest',contentType:'application/json'}));
    report={id:body.id,metadata:'report.json',html,programmeId:body.programmeId,programmeVersion:body.programmeVersion,
      programmeSha256:body.programmeSha256,reconciliationId:body.reconciliationId,reconciliationSha256:body.reconciliationSha256,
      projectId:body.projectId??null,userIdentifier:body.userIdentifier??null,scope:clone(body.scope??null)};
  }
  if(pin.kind==='workspace')for(const selectedRuntime of pin.runtimes??[]){
    const sourceRoot='runtimes/'+selectedRuntime.id+'/source';
    for(const file of selectedRuntime.files){
      const copy=sourceCopy('runtime',file,sourceRoot+'/'+file.path,{role:'runtime',runtimeId:selectedRuntime.id,originalPath:file.path});
      copy.runtimeId=selectedRuntime.id;copies.push(copy);
    }
    runtimes.push({id:selectedRuntime.id,version:selectedRuntime.version,stellarVersion:selectedRuntime.stellarVersion,manifestSha256:selectedRuntime.manifestSha256,sourceRoot});
  }
  if(pin.application){
    const chosen=pin.application;
    for(const file of chosen.files){
      copies.push(sourceCopy('application',file,'application/source/'+file.path,{role:'application',originalPath:file.path}));
    }
    application={sourceManifestSha256:chosen.manifestSha256,sourceRoot:'application/source',entrypoints:chosen.entrypoints,runtime:chosen.runtime};
  }
  const manifest={schema:EXPORT_SCHEMA,id:pin.requestId,requestId:pin.requestId,intentSha256:pin.intentSha256,kind:pin.kind,name:pin.name,
    createdAt:pin.createdAt,workspaceId:pin.workspaceId,workspaceRevision:pin.workspaceRevision,workspaceHead:pin.workspaceHead,
    reportId,report,application,runtimes,files:[]};
  copies.push(inlineCopy('README.md',Buffer.from(receivingGuide({...manifest,sha256:'See manifest.json'}),'utf8'),
    {role:'guide',contentType:'text/markdown'}));
  manifest.files=copies.map(copy=>copy.file);
  const selection=sealed({schema:EXPORT_SELECTION_SCHEMA,intentSha256:pin.sha256,manifest:sealed(manifest),copies});
  validateExportSelection(selection,pin);
  await retainJSON(destination,'export-selection.json',selection);
  await fsyncDirectory(destination);
  return selection;
}
async function copySelectedFile(destination,pin,copy){
  const target=await files.filePath(destination,copy.file.path,true),present=await exists(target);
  if(present){
    // Reuse retained bytes first. A completed application copy stays usable
    // even when the original installed source directory has since moved.
    need(present.isFile()&&!present.isSymbolicLink(),'INVALID_SOURCE','The selected delivery member is not a regular file.',{path:copy.file.path});
    await files.sourceFileRange(destination,copy.file,0,1);
  }else if(copy.origin==='inline'){
    await files.writeNew(destination,copy.file.path,Buffer.from(copy.base64,'base64'));
  }else{
    const origin=copy.origin==='workspace'?pin.sourceDirectory:copy.origin==='runtime'?
      pin.runtimes?.find(item=>item.id===copy.runtimeId)?.directory:pin.application?.sourceDirectory;
    need(typeof origin==='string','INVALID_DELIVERY','The original application source root is missing.');
    await copyDescriptor(origin,copy.source,destination,copy.file.path);
  }
  const mode=(await fs.lstat(target)).mode&0o777;
  if(mode!==copy.file.mode){
    await fs.chmod(target,copy.file.mode);
    const handle=await fs.open(target,'r');try{await handle.sync();}finally{await handle.close();}
  }
  await assertSelectedFile(destination,copy.file);
  if(copy.origin==='inline')await fsyncDirectory(dirname(target));
}
async function assertSelectedAncestor(directory,state,manifest){
  need(state.workspaceId===manifest.workspaceId&&state.revision>=manifest.workspaceRevision,
    'WORKSPACE_DIVERGED','The current workspace no longer contains the original exported revision.');
  let head=state.head,revision=state.revision;
  while(revision>manifest.workspaceRevision){
    hash(head);
    const path='history/'+String(revision).padStart(12,'0')+'-'+head+'.json';
    const record=await files.readJSON(directory,path),unsigned=clone(record);delete unsigned.hash;
    need(record.schema==='stellar-forge.fuul-programmes.commit.v1'&&record.workspaceId===state.workspaceId&&record.revision===revision&&
      record.hash===head&&digest(jsonBytes(unsigned))===head,'INVALID_JOURNAL','The current workspace history differs from its original continuation.',{path});
    head=record.parent;revision--;
  }
  need(head===manifest.workspaceHead,'WORKSPACE_DIVERGED','The current workspace has a different history at the exported revision.');
}
async function acknowledgeExport(directory,args,kind,original){
  const operation=kind==='workspace'?'workspace.export':'report.export';
  return withLock(directory,'writer.lock',async()=>{
    await recoverState(directory);const before=await readState(directory),previous=replay(before,operation,args);
    if(previous)return previous;
    await assertSelectedAncestor(directory,before,original.manifest);
    const result=exportResult(args.destination,original),after=clone(before);
    after.exports[result.exportId]={...result,createdAt:original.manifest.createdAt};
    return commitState(directory,before,after,operation,args,result);
  });
}
async function exportDelivery(directory,args,kind,runtimeSources=[]){
  const operation=kind==='workspace'?'workspace.export':'report.export',request=intent(operation,args);
  need(typeof args.destination==='string'&&isAbsolute(args.destination)&&resolve(args.destination)===args.destination,
    'INVALID_DIRECTORY','Select an absolute delivery destination.');
  need(!inside(directory,args.destination)&&!inside(args.destination,directory),'INVALID_DIRECTORY','Choose a delivery directory outside the active workspace.');
  return withLock(directory,'export-'+request.requestId+'.lock',async()=>{
    const initial=await withLock(directory,'writer.lock',async()=>{
      await recoverState(directory);const state=await readState(directory);
      return {state,previous:replay(state,operation,args)};
    });
    if(initial.previous)return initial.previous;
    await privateDirectory(args.destination);
    return withLock(args.destination,'export.lock',async()=>{
      let original=await existingExport(args.destination,initial.state,operation,args,kind);
      if(!original){
        const pinned=await pinExport(directory,args,kind,initial.state,runtimeSources);
        if(pinned.completed)return pinned.completed;
        const pin=validateExportIntent(pinned.pin,directory,args,kind,initial.state);
        const selection=await selectExportFiles(args.destination,pin);
        // No workspace writer is held while the original source is hashed,
        // copied or fsynced. Only this request and destination are serialized.
        for(const copy of selection.copies)await copySelectedFile(args.destination,pin,copy);
        await retainJSON(args.destination,'manifest.json',selection.manifest);
        await assertFiles(args.destination,selection.manifest);
        await fsyncDirectory(args.destination);
        original={manifest:selection.manifest,manifestSha256:digest(jsonBytes(selection.manifest))};
      }
      return acknowledgeExport(directory,args,kind,original);
    });
  });
}
export async function exportFuulWorkspace({directory,runtimes=[],...args}){return exportDelivery(directory,args,'workspace',runtimes);}
export async function exportFuulReport({directory,runtimes:unusedRuntimes,...args}){return exportDelivery(directory,args,'report');}
export async function readFuulDeliveryManifest({sourceDirectory,expectedManifestSha256}){return manifestAt(sourceDirectory,expectedManifestSha256);}
export async function inspectFuulDelivery({sourceDirectory,expectedManifestSha256}){
  const original=await manifestAt(sourceDirectory,expectedManifestSha256);
  const bytes=await assertFiles(sourceDirectory,original.manifest);
  await inspectDeliveryRuntimes(sourceDirectory,original.manifest);
  if(original.manifest.kind==='workspace')requireRuntimeCoverage(await readState(join(sourceDirectory,'workspace')),original.manifest.runtimes??[]);
  return {...original,bytes};
}
async function receivedReceipt(destination,requestId,manifestSha256){
  if(!await exists(destination))return null;
  const receipt=await files.readJSON(destination,'receiving.json');
  need(receipt.schema===RECEIVING_SCHEMA&&receipt.requestId===requestId&&receipt.manifestSha256===manifestSha256,
    'RECEIVING_DESTINATION_CONFLICT','The receiving directory belongs to a different original delivery.');
  for(const item of receipt.files)if(item.path!=='workspace/state.json')await assertSelectedFile(destination,item);
  for(const runtime of receipt.runtimes??[]){
    const verifiedRuntime=await verifyFuulRuntime({directory:join(destination,runtime.installedRoot),expectedManifestSha256:runtime.manifestSha256});
    need(verifiedRuntime.id===runtime.id,'RUNTIME_SOURCE_CHANGED','The received runtime identity differs.');
  }
  if(receipt.kind==='workspace'){
    const state=await readState(join(destination,'workspace'));
    need(state.workspaceId===receipt.result.workspace.workspaceId&&state.revision>=receipt.result.workspace.revision,'RECEIVING_DESTINATION_CONFLICT','The receiving workspace identity changed.');
    await assertOriginalHistory(join(destination,'workspace'),state);
    const path='history/'+String(receipt.result.workspace.revision).padStart(12,'0')+'-'+receipt.result.workspace.head+'.json';
    need(await exists(join(destination,'workspace',path)),'RECEIVING_DESTINATION_CONFLICT','The receiving transition is absent from this workspace.');
  }
  return {...receipt.result,replayed:true};
}
export async function receiveFuulDelivery({sourceDirectory,destination,requestId,expectedManifestSha256}){
  identifier(requestId);await originalDirectory(sourceDirectory);
  need(typeof destination==='string'&&isAbsolute(destination)&&resolve(destination)===destination,'INVALID_DIRECTORY','Select an absolute receiving destination.');
  need(!inside(sourceDirectory,destination)&&!inside(destination,sourceDirectory),'INVALID_DIRECTORY','Choose an independent receiving directory.');
  const parent=dirname(destination);
  await files.privateDirectory(parent);
  // The lock remains in the stable parent while staging is atomically renamed.
  // All retries inspect original destination/stage receipts inside this lease.
  return withLock(parent,'fuul-receive-'+digest(destination)+'.lock',()=>
    receiveSelectedDelivery({sourceDirectory,destination,requestId,expectedManifestSha256}));
}
async function receiveSelectedDelivery({sourceDirectory,destination,requestId,expectedManifestSha256}){
  const original=await manifestAt(sourceDirectory,expectedManifestSha256),manifest=original.manifest;
  const previous=await receivedReceipt(destination,requestId,original.manifestSha256);if(previous)return previous;
  await assertFiles(sourceDirectory,manifest);
  await inspectDeliveryRuntimes(sourceDirectory,manifest);
  const staging=destination+'.receiving-'+requestId;
  await privateDirectory(staging);
  let result;
  const completedStage=await exists(join(staging,'receiving.json'))?await receivedReceipt(staging,requestId,original.manifestSha256):null;
  if(completedStage)result=completedStage;
  else await withLock(staging,'receiving.lock',async()=>{
    const intentFile=join(staging,'receiving-intent.json');
    if(await exists(intentFile)){
      const saved=await files.readJSON(staging,'receiving-intent.json');
      need(saved.requestId===requestId&&saved.manifestSha256===original.manifestSha256&&saved.destination===destination,
        'RECEIVING_DESTINATION_CONFLICT','The original receiving operation differs.');
    }else{
      const pending=/^receiving-intent\.json\.pending-[a-f0-9-]{36}$/;
      const entries=await fs.readdir(staging);
      need(entries.every(name=>name==='receiving.lock'||pending.test(name)),'RECEIVING_DESTINATION_NOT_EMPTY','Select an empty receiving directory.');
      for(const name of entries.filter(name=>pending.test(name))){
        let saved;
        try{saved=await files.readJSON(staging,name);}
        catch(error){if(error instanceof SyntaxError||error.code==='INVALID_SOURCE_JSON'||error.code==='ENOENT')continue;throw error;}
        need(saved.requestId===requestId&&saved.manifestSha256===original.manifestSha256&&saved.destination===destination,
          'RECEIVING_DESTINATION_CONFLICT','The original pending receiving intent differs.');
      }
      await retainJSON(staging,'receiving-intent.json',{requestId,manifestSha256:original.manifestSha256,destination});
      await fsyncDirectory(staging);
    }
    const preparedId=receiptId(requestId+':receive-prepare');
    let stagedState=null;
    if(manifest.kind==='workspace'&&await exists(join(staging,'workspace','state.json'))){
      await recoverState(join(staging,'workspace'));stagedState=await readState(join(staging,'workspace'));
    }
    const alreadyPrepared=Boolean(stagedState?.requests[preparedId]);
    if(alreadyPrepared)need(stagedState.workspaceId===manifest.workspaceId,'RECEIVING_DESTINATION_CONFLICT','The staged receiving workspace changed.');
    const received=[];
    for(const file of manifest.files){
      const target=alreadyPrepared&&file.path==='workspace/state.json'?{...await descriptor(join(staging,'workspace'),'state.json','application/json'),path:file.path}:
        await copyDescriptor(sourceDirectory,file,staging,file.path);
      const targetPath=await files.filePath(staging,file.path),mode=target.mode??(file.role==='application'?0o644:0o600);
      if(((await fs.lstat(targetPath)).mode&0o777)!==mode){
        await fs.chmod(targetPath,mode);
        const handle=await fs.open(targetPath,'r');try{await handle.sync();}finally{await handle.close();}
      }
      received.push({...target,role:file.role});
    }
    await files.writeNew(staging,'original-manifest.json',original.bytes);
    const runtimes=await restoreDeliveryRuntimes(staging,destination,manifest);
    let workspace=null;
    if(manifest.kind==='workspace'){
      workspace=join(staging,'workspace');let state=await readState(workspace);
      need(state.workspaceId===manifest.workspaceId&&(alreadyPrepared||(state.revision===manifest.workspaceRevision&&state.head===manifest.workspaceHead)),
        'WORKSPACE_SOURCE_MISMATCH','The retained workspace differs from the original delivery selection.');
      await assertOriginalHistory(workspace,state);
      requireRuntimeCoverage(state,manifest.runtimes??[]);
      const prepareArgs={requestId:preparedId,expectedRevision:manifest.workspaceRevision,originalExportId:manifest.id};
      await mutate(workspace,'receive.prepare',prepareArgs,async next=>{
        const pausedCaptures=[],pausedEvents=[],pausedBatches=[],pausedActions=[],pausedRuns=[];
        for(const capture of Object.values(next.captures)){
          capture.paused=true;
          if(capture.status!=='COMPLETE')capture.status='PAUSED';
          pausedCaptures.push(capture.id);
        }
        for(const [table,ids]of [['events',pausedEvents],['batches',pausedBatches],['actions',pausedActions]]){
          for(const row of Object.values(next[table])){
            // Preserve original status, in-flight request/attempt, action
            // prerequisite graph and exact body/dedup identity for resumption.
            row.paused=true;ids.push(row.id);
          }
        }
        for(const run of Object.values(next.runs)){
          if(run.status!=='COMPLETE'){
            run.paused=true;run.status='PAUSED';pausedRuns.push(run.id);
          }
        }
        return {originalExportId:manifest.id,originalWorkspaceHead:manifest.workspaceHead,
          pausedCaptures,pausedEvents,pausedBatches,pausedActions,pausedRuns};
      });
      state=await readState(workspace);
      await assertOriginalHistory(workspace,state);
      // The receiving transition replaces only the active state. Its original
      // source version remains unchanged in original-manifest.json and history.
      const current=await descriptor(workspace,'state.json','application/json');
      const index=received.findIndex(item=>item.path==='workspace/state.json');
      received[index]={...current,path:'workspace/state.json',role:'workspace'};
      const historyFiles=(await collectFiles(workspace,'history')).filter(item=>!received.some(old=>old.path==='workspace/'+item.path));
      received.push(...historyFiles.map(item=>({...item,path:'workspace/'+item.path,role:'workspace'})));
      workspace={workspaceId:state.workspaceId,revision:state.revision,head:state.head,
        sourceRevision:manifest.workspaceRevision,sourceHead:manifest.workspaceHead,directory:join(destination,'workspace'),
        preparation:clone(state.requests[preparedId].result)};
    }
    const application=manifest.application?{directory:join(destination,manifest.application.sourceRoot),
      cli:join(destination,manifest.application.sourceRoot,manifest.application.entrypoints.cli),
      server:join(destination,manifest.application.sourceRoot,manifest.application.entrypoints.server),
      sourceManifestSha256:manifest.application.sourceManifestSha256,runtime:manifest.application.runtime,
      runtimeConnections:runtimes.map(item=>({id:item.id,version:item.version,stellarVersion:item.stellarVersion,runtimeDirectory:item.directory,expectedManifestSha256:item.manifestSha256}))}:null;
    result={kind:manifest.kind,directory:destination,requestId,exportId:manifest.id,manifestSha256:original.manifestSha256,
      workspace,application,runtimes,report:manifest.kind==='report'?{id:manifest.reportId,
        metadata:join(destination,'report','report.json'),html:manifest.report?.html?join(destination,'report',manifest.report.html):null}:null,
      files:received.length,receivedAt:now()};
    const receipt={schema:RECEIVING_SCHEMA,requestId,manifestSha256:original.manifestSha256,kind:manifest.kind,
      sourceExportId:manifest.id,files:received,runtimes:runtimes.map(({id,version,stellarVersion,manifestSha256,installedRoot})=>({id,version,stellarVersion,manifestSha256,installedRoot})),result};
    await retainJSON(staging,'receiving.json',receipt);
    await fsyncDirectory(staging);
  });
  if(await exists(destination)){
    const prior=await receivedReceipt(destination,requestId,original.manifestSha256);if(prior)return prior;
  }
  try{await fs.rename(staging,destination);await fsyncDirectory(dirname(destination));}
  catch(error){
    if(error.code==='ENOENT'||error.code==='EEXIST'||error.code==='ENOTEMPTY'){
      const prior=await receivedReceipt(destination,requestId,original.manifestSha256);if(prior)return prior;
    }
    throw error;
  }
  return {...result,replayed:false};
}
export const fuulReceivingSchemas={package:EXPORT_SCHEMA,receiving:RECEIVING_SCHEMA,applicationSource:APP_SCHEMA};
