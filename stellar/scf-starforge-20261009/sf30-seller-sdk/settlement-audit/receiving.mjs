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
const EXPORT_SCHEMA='stellar-forge.settlement-audit.delivery.v1';
const APP_SCHEMA='stellar-forge.settlement-audit.application-source.v1';
const RECEIVING_SCHEMA='stellar-forge.settlement-audit.receiving.v1';
const SOURCE_FOLDER=dirname(fileURLToPath(import.meta.url));
const REPO_ROOT=resolve(SOURCE_FOLDER,'../../../..');
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
  need(manifest.schema===EXPORT_SCHEMA&&['workspace','report'].includes(manifest.kind),'INVALID_DELIVERY','Select a complete settlement delivery.');
  identifier(manifest.id);identifier(manifest.workspaceId);integer(manifest.workspaceRevision,'workspaceRevision');
  need(Array.isArray(manifest.files)&&manifest.files.length>0,'INVALID_DELIVERY','The complete delivery file list is missing.');
  const seen=new Set();
  for(const item of manifest.files){
    files.relativeFile(item.path);hash(item.sha256);integer(item.bytes,'file bytes');
    if(item.mode!==undefined)integer(item.mode,'original file mode',0,0o777);
    need(!seen.has(item.path)&&['workspace','application','report','guide'].includes(item.role),'INVALID_DELIVERY','The original file roles or paths conflict.');
    seen.add(item.path);
    if(item.role==='workspace')need(item.path.startsWith('workspace/'),'INVALID_DELIVERY','Workspace files must remain in their original section.');
    if(item.role==='application')need(item.path.startsWith('application/source/'),'INVALID_DELIVERY','Application files must remain in their original section.');
    if(item.role==='report')need(item.path.startsWith('report/'),'INVALID_DELIVERY','Report files must remain in their original section.');
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
  return {manifest,manifestSha256:digest(bytes),bytes};
}
const EXPORT_INTENT_SCHEMA='stellar-forge.settlement-audit.export-intent.v2';
const EXPORT_SELECTION_SCHEMA='stellar-forge.settlement-audit.export-selection.v1';
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
    'APPLICATION_SOURCE_REQUIRED','Install the complete source-owned settlement distribution.');
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
  return /^(policies|batches|captures|sources|plans|reconciliations|corrections|reports)\//.test(item.path);
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
      if(!prefix&&!['genesis.json','history','policies','batches','captures','sources','plans','reconciliations','corrections','reports'].includes(entry.name))continue;
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
  if(manifest.kind==='report')return '# '+manifest.name+'\n\nOpen report/settlement-report.html. The matching JSON and CSV files carry the same retained partner report edition.\n\nReport ID: '+manifest.reportId+'\nManifest SHA field: '+manifest.sha256+'\n';
  const cli=manifest.application?.entrypoints.cli;
  return '# '+manifest.name+'\n\nThis delivery includes the original settlement workspace, its complete native response files and history, and the complete application source.\n\n'+
    'Receive with the same installed CLI:\n\n'+
    'node '+(cli?'application/source/'+cli:'PATH_TO_SETTLEMENT_CLI')+' delivery-receive --source-directory ORIGINAL_DELIVERY --destination NEW_CLIENT_DIRECTORY --request-id ORIGINAL_RECEIVE_UUID\n\n'+
    'When the original sender provides the manifest SHA-256, append --expected-manifest-sha256 ORIGINAL_MANIFEST_SHA256.\n\n'+
    'After receiving, open the returned workspace using its returned CLI. Configure existing SDP/Horizon connection aliases in a private connections file on that host, then pass --connections-file FILE. Saved captures retain the exact original source scope and can continue with refreshed credentials for that scope.\n\n'+
    'The receiver preserves the original workspace identity and histories. Incomplete captures reopen paused; the original request arguments and pending native response remain available to continue.\n\n'+
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
  return {deliveryId:manifest.id,kind:manifest.kind,directory:destination,manifestSha256,
    sourceWorkspaceId:manifest.workspaceId,sourceRevision:manifest.workspaceRevision,sourceHead:manifest.workspaceHead,
    files:manifest.files.length,bytes:manifest.files.reduce((sum,item)=>sum+item.bytes,0),
    reportId:manifest.reportId??null,application:manifest.application??null};
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
async function pinExport(directory,args,kind,initial){
  const saved=await recoveredExportIntent(directory,args,kind,initial);
  if(saved)return {pin:saved};
  // This is the exact executing application cohort. Resolve it before entering
  // the workspace writer; retries read this retained selection, never a new one.
  const application=kind==='workspace'||args.includeApplication===true?await originalApplication():null;
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
      snapshot={state:{path:'state.json',bytes:bytes.length,sha256:digest(bytes),mode:stat.mode&0o777,
          contentType:'application/json',base64:bytes.toString('base64')},
        files:await workspaceCandidates(directory,before.revision)};
    }
    const pin=sealed({schema:EXPORT_INTENT_SCHEMA,...request,kind,sourceDirectory:directory,destination:args.destination,
      workspaceId:before.workspaceId,workspaceRevision:before.revision,workspaceHead:before.head,
      createdAt:now(),name:args.name??(report?report.name:before.profile.name),report,snapshot,
      application:application?{...application,sourceDirectory:REPO_ROOT}:null});
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
    need(!seen.has(file.path)&&['workspace','application','report','guide'].includes(file.role),'INVALID_DELIVERY','The original copy plan repeats a file or has an invalid role.');
    seen.add(file.path);
    need(['workspace','application','inline'].includes(copy.origin),'INVALID_DELIVERY','The original copy plan has an unknown source.');
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
  return selection;
}
async function selectExportFiles(destination,pin){
  if(await exists(join(destination,'export-selection.json')))
    return validateExportSelection(await files.readJSON(destination,'export-selection.json'),pin);
  const copies=[];let reportId=null,application=null;
  if(pin.kind==='workspace'){
    need(plain(pin.snapshot)&&plain(pin.snapshot.state)&&Array.isArray(pin.snapshot.files),'INVALID_DELIVERY','The original workspace selection is missing.');
    const original=pin.snapshot.state,body=Buffer.from(original.base64,'base64');
    need(body.toString('base64')===original.base64&&body.length===original.bytes&&digest(body)===original.sha256,
      'SOURCE_CHANGED','The exact selected workspace state differs from its retained bytes.');
    const state=JSON.parse(body.toString('utf8'));
    need(state.schema===STATE_SCHEMA&&state.workspaceId===pin.workspaceId&&state.revision===pin.workspaceRevision&&state.head===pin.workspaceHead,
      'WORKSPACE_SOURCE_MISMATCH','The selected workspace state differs from the original export.');
    await assertOriginalHistory(pin.sourceDirectory,state);
    copies.push(inlineCopy('workspace/state.json',body,{role:'workspace',originalPath:'state.json',contentType:'application/json',mode:original.mode}));
    for(const candidate of pin.snapshot.files){
      const file=await originalFile(pin.sourceDirectory,candidate);
      copies.push(sourceCopy('workspace',file,'workspace/'+file.path,{role:'workspace',originalPath:file.path}));
    }
  }else{
    const body=verified(await readRecord(pin.sourceDirectory,pin.report),'Report');
    need(body.id===pin.report.id,'SOURCE_CHANGED','The retained report edition identity differs.');
    reportId=body.id;
    for(const item of body.files){
      const file=await originalFile(pin.sourceDirectory,item);
      copies.push(sourceCopy('workspace',file,'report/'+item.filename,{role:'report',contentType:item.contentType,filename:item.filename}));
    }
    const reportBody={schema:body.schema,kind:body.kind,id:body.id,name:body.name,createdAt:body.createdAt,partnerId:body.partnerId,
      planId:body.planId,reconciliationId:body.reconciliationId,planSha256:body.planSha256,reconciliationSha256:body.reconciliationSha256,
      data:body.data,files:copies.map(copy=>({filename:copy.file.filename,bytes:copy.file.bytes,sha256:copy.file.sha256,contentType:copy.file.contentType}))};
    copies.push(inlineCopy('report/edition.json',jsonBytes(sealed(reportBody)),{role:'report',filename:'edition.json',contentType:'application/json'}));
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
    reportId,application,files:[]};
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
    const origin=copy.origin==='workspace'?pin.sourceDirectory:pin.application?.sourceDirectory;
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
    need(record.schema==='stellar-forge.settlement-audit.commit.v1'&&record.workspaceId===state.workspaceId&&record.revision===revision&&
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
    after.deliveries[result.deliveryId]={...result,createdAt:original.manifest.createdAt};
    return commitState(directory,before,after,operation,args,result);
  });
}
async function exportDelivery(directory,args,kind){
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
        const pinned=await pinExport(directory,args,kind,initial.state);
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
export async function exportSettlementWorkspace({directory,...args}){return exportDelivery(directory,args,'workspace');}
export async function exportSettlementReport({directory,...args}){return exportDelivery(directory,args,'report');}
export async function readSettlementDeliveryManifest({sourceDirectory,expectedManifestSha256}){return manifestAt(sourceDirectory,expectedManifestSha256);}
export async function inspectSettlementDelivery({sourceDirectory,expectedManifestSha256}){
  const original=await manifestAt(sourceDirectory,expectedManifestSha256);
  const bytes=await assertFiles(sourceDirectory,original.manifest);
  return {...original,bytes};
}
async function receivedReceipt(destination,requestId,manifestSha256){
  if(!await exists(destination))return null;
  const receipt=await files.readJSON(destination,'receiving.json');
  need(receipt.schema===RECEIVING_SCHEMA&&receipt.requestId===requestId&&receipt.manifestSha256===manifestSha256,
    'RECEIVING_DESTINATION_CONFLICT','The receiving directory belongs to a different original delivery.');
  for(const item of receipt.files)if(item.path!=='workspace/state.json')await assertSelectedFile(destination,item);
  if(receipt.kind==='workspace'){
    const state=await readState(join(destination,'workspace'));
    need(state.workspaceId===receipt.result.workspace.workspaceId&&state.revision>=receipt.result.workspace.revision,'RECEIVING_DESTINATION_CONFLICT','The receiving workspace identity changed.');
    await assertOriginalHistory(join(destination,'workspace'),state);
    const path='history/'+String(receipt.result.workspace.revision).padStart(12,'0')+'-'+receipt.result.workspace.head+'.json';
    need(await exists(join(destination,'workspace',path)),'RECEIVING_DESTINATION_CONFLICT','The receiving transition is absent from this workspace.');
  }
  return {...receipt.result,replayed:true};
}
export async function receiveSettlementDelivery({sourceDirectory,destination,requestId,expectedManifestSha256}){
  identifier(requestId);await originalDirectory(sourceDirectory);
  need(typeof destination==='string'&&isAbsolute(destination)&&resolve(destination)===destination,'INVALID_DIRECTORY','Select an absolute receiving destination.');
  need(!inside(sourceDirectory,destination)&&!inside(destination,sourceDirectory),'INVALID_DIRECTORY','Choose an independent receiving directory.');
  const parent=dirname(destination);
  await files.privateDirectory(parent);
  // The lock remains in the stable parent while staging is atomically renamed.
  // All retries inspect original destination/stage receipts inside this lease.
  return withLock(parent,'settlement-receive-'+digest(destination)+'.lock',()=>
    receiveSelectedDelivery({sourceDirectory,destination,requestId,expectedManifestSha256}));
}
async function receiveSelectedDelivery({sourceDirectory,destination,requestId,expectedManifestSha256}){
  const original=await manifestAt(sourceDirectory,expectedManifestSha256),manifest=original.manifest;
  const previous=await receivedReceipt(destination,requestId,original.manifestSha256);if(previous)return previous;
  await assertFiles(sourceDirectory,manifest);
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
        catch(error){if(error.code==='INVALID_SOURCE_JSON'||error.code==='ENOENT')continue;throw error;}
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
    let workspace=null;
    if(manifest.kind==='workspace'){
      workspace=join(staging,'workspace');let state=await readState(workspace);
      need(state.workspaceId===manifest.workspaceId&&(alreadyPrepared||(state.revision===manifest.workspaceRevision&&state.head===manifest.workspaceHead)),
        'WORKSPACE_SOURCE_MISMATCH','The retained workspace differs from the original delivery selection.');
      await assertOriginalHistory(workspace,state);
      const prepareArgs={requestId:preparedId,expectedRevision:manifest.workspaceRevision,originalDeliveryId:manifest.id};
      await mutate(workspace,'receive.prepare',prepareArgs,async next=>{
        const paused=[];
        for(const capture of Object.values(next.captures)){
          if(['READY','RUNNING'].includes(capture.status)){capture.status='PAUSED';paused.push(capture.id);}
        }
        return {originalDeliveryId:manifest.id,originalWorkspaceHead:manifest.workspaceHead,pausedCaptures:paused};
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
        sourceRevision:manifest.workspaceRevision,sourceHead:manifest.workspaceHead,directory:join(destination,'workspace')};
    }
    const application=manifest.application?{directory:join(destination,manifest.application.sourceRoot),
      cli:join(destination,manifest.application.sourceRoot,manifest.application.entrypoints.cli),
      server:join(destination,manifest.application.sourceRoot,manifest.application.entrypoints.server),
      sourceManifestSha256:manifest.application.sourceManifestSha256,runtime:manifest.application.runtime}:null;
    result={kind:manifest.kind,directory:destination,requestId,deliveryId:manifest.id,manifestSha256:original.manifestSha256,
      workspace,application,report:manifest.kind==='report'?{id:manifest.reportId,html:join(destination,'report','settlement-report.html')}:null,
      files:received.length,receivedAt:now()};
    const receipt={schema:RECEIVING_SCHEMA,requestId,manifestSha256:original.manifestSha256,kind:manifest.kind,
      sourceDeliveryId:manifest.id,files:received,result};
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
export const settlementReceivingSchemas={delivery:EXPORT_SCHEMA,receiving:RECEIVING_SCHEMA,applicationSource:APP_SCHEMA};
