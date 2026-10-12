#!/usr/bin/env node
// MIT. Source-edition commissioning through the original SF74/SF77 interfaces.
import {open,readFile,mkdir,lstat,link,unlink,readdir,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {importRuntimeHandoff,MAX_HANDOFF_BYTES} from '../../scf-starforge-20261009/sf74-merchant-support-console/runtime-support.mjs';
import {parseWorkspace} from '../../scf-starforge-20261009/sf74-merchant-support-console/workspace-file.mjs';
import {buildRuntimePacket,renderHtml,renderChecklist} from '../../scf-starforge-20261009/sf77-merchant-workorder/workorder.mjs';

export const REQUEST_SCHEMA='stellar-forge.sf49.source-edition-workorder-request.v1';
export const BUNDLE_SCHEMA='stellar-forge.sf49.source-edition-workorder.v1';
export const ATTACHMENT_SCHEMA='stellar-forge.sf49.source-edition-attachments.v1';
const MAX_META=2*1024*1024,MAX_TERMS=1024*1024,MAX_ATTACHMENT=8*1024**3,MAX_TOTAL=16*1024**3;
const nativePaths={
  workorder:'../../scf-starforge-20261009/sf77-merchant-workorder/workorder.mjs',
  runtimeSupport:'../../scf-starforge-20261009/sf74-merchant-support-console/runtime-support.mjs',
  workspaceFile:'../../scf-starforge-20261009/sf74-merchant-support-console/workspace-file.mjs'
};
const ensure=(value,message)=>{if(!value)throw new Error(message);};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':plain(value)?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const json=bytes=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
const jsonBytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const digestOK=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const instant=value=>typeof value==='string'&&value.length<=64&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value)&&Number.isFinite(Date.parse(value));
const identity=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
const baseName=value=>typeof value==='string'&&value!=='.'&&value!=='..'&&value.length>0&&Buffer.byteLength(value)<=240&&!/[\\/\x00-\x1f\x7f]/.test(value);
const bytesOK=(value,max)=>Number.isSafeInteger(value)&&value>=0&&value<=max;

function fields(value,allowed,label) {
  ensure(plain(value)&&Object.keys(value).every(key=>allowed.includes(key)),'Invalid '+label+' fields');
}
function relPath(value) {
  if(['request.json','packet.json','seller-packet.html','acceptance-checklist.md','originals/support.json','originals/terms.json'].includes(value))return value;
  ensure(typeof value==='string','Invalid bundle path');
  const parts=value.split('/');
  ensure(parts.length===3&&parts[0]==='attachments'&&identity(parts[1])&&baseName(parts[2]),'Invalid attachment path');
  return value;
}
async function privateDirectory(directory) {
  const absolute=path.resolve(directory);
  await mkdir(absolute,{recursive:true,mode:0o700});
  const info=await lstat(absolute);
  ensure(info.isDirectory()&&!info.isSymbolicLink()&&(info.mode&0o077)===0,'Output must be a private directory');
  return absolute;
}
async function syncDirectory(directory) {
  const handle=await open(directory,constants.O_RDONLY);
  try {await handle.sync();}finally {await handle.close();}
}
async function readBounded(file,max) {
  const handle=await open(path.resolve(file),constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const info=await handle.stat();
    ensure(info.isFile()&&bytesOK(info.size,max),'Input exceeds its file limit or is not a regular file');
    const bytes=await handle.readFile();
    ensure(bytes.length===info.size&&bytes.length<=max,'Input changed while reading');
    return bytes;
  }finally {await handle.close();}
}
async function readPinned(file,max,pin) {
  const bytes=await readBounded(file,max);
  ensure(bytes.length===pin.bytes&&sha(bytes)===pin.sha256,'Retained input changed: '+path.basename(file));
  return bytes;
}
async function hasManifest(directory) {
  try {await lstat(path.join(directory,'manifest.json'));return true;}
  catch(error){if(error.code==='ENOENT')return false;throw error;}
}
async function hashFile(file,expected) {
  const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const info=await handle.stat();
    ensure(info.isFile()&&bytesOK(info.size,MAX_TOTAL),'Invalid retained file');
    if(expected)ensure(info.size===expected.bytes,'Retained file size changed: '+path.basename(file));
    const buffer=Buffer.allocUnsafe(1024*1024),hash=createHash('sha256');let total=0;
    for(;;) {
      const {bytesRead}=await handle.read(buffer,0,buffer.length,null);
      if(!bytesRead)break;
      total+=bytesRead;ensure(total<=MAX_TOTAL&&(!expected||total<=expected.bytes),'Retained file grew');
      hash.update(buffer.subarray(0,bytesRead));
    }
    const result={bytes:total,sha256:hash.digest('hex')};
    ensure(total===info.size,'Retained file changed size');
    if(expected)ensure(result.sha256===expected.sha256,'Retained file digest changed: '+path.basename(file));
    return result;
  }finally {await handle.close();}
}
async function existingFile(file,expected) {
  try {return await hashFile(file,expected);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function publishBytes(file,bytes,{stagePrefix}={}) {
  const expected={bytes:bytes.length,sha256:sha(bytes)};
  if(await existingFile(file,expected))return expected;
  await mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const temporary=file+(stagePrefix??'.tmp-')+randomUUID();let handle;
  try {
    handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
    try {await link(temporary,file);}catch(error){if(error.code!=='EEXIST')throw error;await hashFile(file,expected);}
    await syncDirectory(path.dirname(file));
    return expected;
  }finally {
    if(handle)await handle.close();
    await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
}
async function copyPinned(source,destination,expected) {
  if(await existingFile(destination,expected))return expected;
  await mkdir(path.dirname(destination),{recursive:true,mode:0o700});
  const temporary=destination+'.tmp-'+randomUUID();let input,output;
  try {
    input=await open(source,constants.O_RDONLY|constants.O_NOFOLLOW);
    const info=await input.stat();
    ensure(info.isFile()&&info.size===expected.bytes,'Source file size changed');
    output=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    const buffer=Buffer.allocUnsafe(1024*1024),hash=createHash('sha256');let total=0;
    for(;;) {
      const {bytesRead}=await input.read(buffer,0,buffer.length,null);
      if(!bytesRead)break;
      total+=bytesRead;ensure(total<=expected.bytes,'Source file grew while copying');
      hash.update(buffer.subarray(0,bytesRead));
      let offset=0;
      while(offset<bytesRead) {
        const written=await output.write(buffer,offset,bytesRead-offset,null);
        ensure(written.bytesWritten>0,'Source copy made no progress');offset+=written.bytesWritten;
      }
    }
    ensure(total===expected.bytes&&hash.digest('hex')===expected.sha256,'Source file digest changed');
    await output.sync();await output.close();output=null;await input.close();input=null;
    try {await link(temporary,destination);}catch(error){if(error.code!=='EEXIST')throw error;await hashFile(destination,expected);}
    await syncDirectory(path.dirname(destination));
    return expected;
  }finally {
    if(input)await input.close();if(output)await output.close();
    await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
}
async function nativeSource() {
  const result={};
  for(const [name,relative]of Object.entries(nativePaths))result[name]=sha(await readFile(new URL(relative,import.meta.url)));
  return result;
}
async function originalPacket(supportBytes,termsBytes,generatedAt) {
  const handoff=await importRuntimeHandoff(new TextDecoder('utf-8',{fatal:true}).decode(supportBytes));
  const workspace=await parseWorkspace(handoff.workspaceText),terms=json(termsBytes);
  const packet=buildRuntimePacket({supportText:handoff.supportText,inputs:workspace.inputs},terms,generatedAt);
  packet.runtimeSource={handoffSha256:sha(supportBytes),workspaceSha256:sha(handoff.workspaceText),supportSha256:sha(handoff.supportText)};
  return {
    packet,outputs:{
      'packet.json':jsonBytes(packet),
      'seller-packet.html':Buffer.from(renderHtml(packet)),
      'acceptance-checklist.md':Buffer.from(renderChecklist(packet))
    }
  };
}
function requestStagePrefix(request,bytes) {
  return '.stage-'+Buffer.from(request.generatedAt).toString('base64url')+'.'+sha(bytes)+'.';
}
async function requestStages(directory) {
  let entries;
  try {entries=await readdir(directory);}catch(error){if(error.code==='ENOENT')return [];throw error;}
  const result=[];
  for(const name of entries) {
    if(!name.startsWith('request.json.stage-'))continue;
    const match=/^request\.json\.stage-([A-Za-z0-9_-]+)\.([a-f0-9]{64})\.([a-f0-9-]{36})$/.exec(name);
    ensure(match,'Unrecognized first-request staging file');
    const generatedAt=Buffer.from(match[1],'base64url').toString('utf8');
    ensure(instant(generatedAt)&&Buffer.from(generatedAt).toString('base64url')===match[1],'Invalid first-request staging timestamp');
    const info=await lstat(path.join(directory,name));
    ensure(info.isFile()&&!info.isSymbolicLink()&&info.size<=MAX_META,'Invalid first-request staging file');
    result.push({name,generatedAt,sha256:match[2]});
  }
  return result;
}
async function allowRequestStages(directory,request,bytes) {
  const entries=await readdir(directory),stages=await requestStages(directory),names=new Set(stages.map(value=>value.name));
  ensure(entries.every(name=>names.has(name)),'A new request needs an empty directory or its own retained first-request stages');
  const expected=sha(bytes);
  for(const value of stages)ensure(value.generatedAt===request.generatedAt&&value.sha256===expected,'The directory retains a different first-request stage');
}
async function publishRequest(directory,request,bytes=jsonBytes(request)) {
  // A killed writer may leave an incomplete uniquely named stage. Its filename
  // retains the exact request digest and generation time. Never remove another
  // writer's stage: a new complete same-byte stage can safely win the final link.
  return publishBytes(path.join(directory,'request.json'),bytes,{stagePrefix:requestStagePrefix(request,bytes)});
}
async function checkedNativeSource() {
  const current=await nativeSource();
  ensure(canonical(current)===canonical(loadedNativeSource),'Native source changed after this process opened; reopen the original pinned installation');
  return current;
}
async function attachmentInput(file) {
  if(!file)return [];
  const document=json(await readBounded(file,MAX_META));
  fields(document,['schema','files'],'attachment selection');
  ensure(document.schema===ATTACHMENT_SCHEMA&&Array.isArray(document.files)&&document.files.length<=64,'Invalid attachment selection');
  const ids=new Set(),base=path.dirname(path.resolve(file));let total=0;
  return document.files.map(value=>{
    fields(value,['id','role','name','path','bytes','sha256'],'attachment');
    ensure(identity(value.id)&&!ids.has(value.id),'Attachment identifiers must be unique');
    ids.add(value.id);
    ensure(typeof value.role==='string'&&value.role.trim()===value.role&&value.role.length>0&&value.role.length<=160&&!/[\x00-\x1f\x7f]/.test(value.role),'Invalid attachment role');
    ensure(baseName(value.name)&&typeof value.path==='string'&&value.path.length>0,'Invalid attachment name or input path');
    ensure(bytesOK(value.bytes,MAX_ATTACHMENT)&&digestOK(value.sha256),'Attachment needs its original byte count and SHA-256');
    total+=value.bytes;ensure(total<=MAX_TOTAL-MAX_HANDOFF_BYTES-MAX_TERMS,'Attachment inventory exceeds the total limit');
    return {id:value.id,role:value.role,name:value.name,path:'attachments/'+value.id+'/'+value.name,bytes:value.bytes,sha256:value.sha256,input:path.resolve(base,value.path)};
  });
}
function binding(selection) {
  return selection.map(({input,...record})=>record);
}
function validateRequest(request) {
  fields(request,['schema','operationId','generatedAt','inputs','attachments'],'workorder request');
  ensure(request.schema===REQUEST_SCHEMA&&identity(request.operationId)&&instant(request.generatedAt),'Invalid workorder request identity');
  fields(request.inputs,['support','terms'],'request inputs');
  for(const [name,max]of [['support',MAX_HANDOFF_BYTES],['terms',MAX_TERMS]]) {
    const value=request.inputs[name];fields(value,['bytes','sha256'],'request input');
    ensure(bytesOK(value.bytes,max)&&value.bytes>0&&digestOK(value.sha256),'Invalid request input pin');
  }
  ensure(Array.isArray(request.attachments)&&request.attachments.length<=64,'Invalid request attachments');
  const ids=new Set();let total=request.inputs.support.bytes+request.inputs.terms.bytes;
  for(const value of request.attachments) {
    fields(value,['id','role','name','path','bytes','sha256'],'request attachment');
    ensure(identity(value.id)&&!ids.has(value.id)&&baseName(value.name)&&value.path==='attachments/'+value.id+'/'+value.name,'Invalid request attachment identity');
    ids.add(value.id);relPath(value.path);
    ensure(typeof value.role==='string'&&value.role.length>0&&value.role.length<=160&&!/[\x00-\x1f\x7f]/.test(value.role)&&bytesOK(value.bytes,MAX_ATTACHMENT)&&digestOK(value.sha256),'Invalid request attachment pin');
    total+=value.bytes;
  }
  ensure(total<=MAX_TOTAL,'Request exceeds the total limit');
  return request;
}
async function retainedRequest(directory) {
  try {return validateRequest(json(await readBounded(path.join(directory,'request.json'),MAX_META)));}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}
function summary(manifest,manifestBytes,packet,currentSource) {
  return {
    schema:BUNDLE_SCHEMA,operationId:manifest.operationId,bundleId:manifest.bundleId,manifestSha256:sha(manifestBytes),
    generatedAt:manifest.generatedAt,files:manifest.files.length,attachmentCount:manifest.attachments.length,
    nativeSourceMatches:canonical(currentSource)===canonical(manifest.nativeSource),
    workOrderRef:packet.workOrderRef,sourceKind:packet.sourceKind,runtimeSource:packet.runtimeSource,
    commercial:packet.commercial,readiness:packet.readiness,limits:packet.limits,
    runtimeComparison:packet.runtimeReview.comparison.state,
    verification:'Original SF74 import and SF77 workorder replay; attachment bytes match the retained inventory'
  };
}
export async function prepareSourceEditionWorkorder({handoff,terms,attachments,operationId,directory,generatedAt}) {
  ensure(identity(operationId),'A stable operationId is required');
  const out=path.resolve(directory);
  const supportBytes=await readBounded(handoff,MAX_HANDOFF_BYTES),termsBytes=await readBounded(terms,MAX_TERMS);
  const selected=await attachmentInput(attachments),retained=await retainedRequest(out),stages=retained?[]:await requestStages(out);
  const stageIdentities=new Map(stages.map(value=>[value.generatedAt+'|'+value.sha256,value]));
  ensure(stageIdentities.size<=1,'Multiple first-request stages need the original operator to resolve their identity');
  const staged=[...stageIdentities.values()][0];
  const request=validateRequest({
    schema:REQUEST_SCHEMA,operationId,generatedAt:generatedAt??retained?.generatedAt??staged?.generatedAt??new Date().toISOString(),
    inputs:{support:{bytes:supportBytes.length,sha256:sha(supportBytes)},terms:{bytes:termsBytes.length,sha256:sha(termsBytes)}},
    attachments:binding(selected)
  });
  if(retained)ensure(canonical(retained)===canonical(request),'This directory retains a different request; keep its original identity');
  if(await hasManifest(out))return replaySourceEditionWorkorder({directory:out});
  const sourcePins=await checkedNativeSource();
  const original=await originalPacket(supportBytes,termsBytes,request.generatedAt);
  await privateDirectory(out);
  if(!retained)await allowRequestStages(out,request,jsonBytes(request));
  const files=[];
  const retain=async(name,bytes,role)=>{
    const pin=await publishBytes(path.join(out,relPath(name)),bytes);files.push({path:name,role,...pin});
  };
  const requestPin=await publishRequest(out,request);
  files.push({path:'request.json',role:'commissioning-request',...requestPin});
  await retain('originals/support.json',supportBytes,'original-sf74-handoff');
  await retain('originals/terms.json',termsBytes,'original-owner-terms');
  for(const value of selected) {
    await copyPinned(value.input,path.join(out,value.path),value);
    files.push({path:value.path,role:value.role,bytes:value.bytes,sha256:value.sha256});
  }
  for(const [name,bytes]of Object.entries(original.outputs))await retain(name,bytes,'original-sf77-output');
  ensure(canonical(await checkedNativeSource())===canonical(sourcePins),'Native source changed while preparing the original workorder');
  const manifest={
    schema:BUNDLE_SCHEMA,operationId,generatedAt:request.generatedAt,bundleId:sha(canonical(request)),
    nativeSource:sourcePins,attachments:request.attachments,files
  };
  const manifestBytes=jsonBytes(manifest);
  await publishBytes(path.join(out,'manifest.json'),manifestBytes);
  return replaySourceEditionWorkorder({directory:out});
}
async function readBundle(directory,{verifyFiles=true}={}) {
  const root=path.resolve(directory),manifestBytes=await readBounded(path.join(root,'manifest.json'),MAX_META),manifest=json(manifestBytes);
  fields(manifest,['schema','operationId','generatedAt','bundleId','nativeSource','attachments','files'],'bundle manifest');
  ensure(manifest.schema===BUNDLE_SCHEMA&&identity(manifest.operationId)&&instant(manifest.generatedAt)&&digestOK(manifest.bundleId),'Invalid bundle identity');
  fields(manifest.nativeSource,Object.keys(nativePaths),'native implementation pins');
  ensure(Object.keys(nativePaths).every(key=>digestOK(manifest.nativeSource[key])),'Missing native implementation pin');
  ensure(Array.isArray(manifest.files)&&manifest.files.length>=6&&manifest.files.length<=70,'Invalid bundle inventory');
  const seen=new Set();let total=0;
  for(const value of manifest.files) {
    fields(value,['path','role','bytes','sha256'],'bundle file');relPath(value.path);
    ensure(!seen.has(value.path)&&typeof value.role==='string'&&value.role.length>0&&value.role.length<=160&&bytesOK(value.bytes,MAX_TOTAL)&&digestOK(value.sha256),'Invalid or duplicate bundle file');
    seen.add(value.path);total+=value.bytes;ensure(total<=MAX_TOTAL+MAX_HANDOFF_BYTES+MAX_META*2,'Bundle exceeds the total limit');
    if(verifyFiles)await hashFile(path.join(root,value.path),value);
  }
  for(const required of ['request.json','originals/support.json','originals/terms.json','packet.json','seller-packet.html','acceptance-checklist.md'])ensure(seen.has(required),'Missing original bundle file: '+required);
  const inventory=new Map(manifest.files.map(value=>[value.path,value]));
  const request=validateRequest(json(await readPinned(path.join(root,'request.json'),MAX_META,inventory.get('request.json'))));
  ensure(manifest.bundleId===sha(canonical(request))&&manifest.operationId===request.operationId&&manifest.generatedAt===request.generatedAt&&canonical(manifest.attachments)===canonical(request.attachments),'Bundle request binding changed');
  ensure(manifest.files.length===6+request.attachments.length,'Unexpected bundle file count');
  const roles={'request.json':'commissioning-request','originals/support.json':'original-sf74-handoff','originals/terms.json':'original-owner-terms','packet.json':'original-sf77-output','seller-packet.html':'original-sf77-output','acceptance-checklist.md':'original-sf77-output'};
  for(const value of request.attachments)roles[value.path]=value.role;
  for(const value of manifest.files)ensure(value.role===roles[value.path],'Bundle file role changed');
  for(const [name,value]of [['originals/support.json',request.inputs.support],['originals/terms.json',request.inputs.terms],...request.attachments.map(value=>[value.path,value])]) {
    const actual=inventory.get(name);
    ensure(actual&&actual.bytes===value.bytes&&actual.sha256===value.sha256,'Bundle source binding changed: '+name);
  }
  return {root,manifestBytes,manifest,request,inventory};
}
async function replayBundle(bundle) {
  const sourcePins=await checkedNativeSource();
  const original=await originalPacket(await readPinned(path.join(bundle.root,'originals/support.json'),MAX_HANDOFF_BYTES,bundle.request.inputs.support),await readPinned(path.join(bundle.root,'originals/terms.json'),MAX_TERMS,bundle.request.inputs.terms),bundle.request.generatedAt);
  for(const [name,bytes]of Object.entries(original.outputs)) {
    const retained=bundle.inventory.get(name);
    ensure(retained.bytes===bytes.length&&retained.sha256===sha(bytes),'The current native SF77 output differs from the retained '+name);
  }
  ensure(canonical(await checkedNativeSource())===canonical(sourcePins),'Native source changed during original workorder replay');
  return {summary:summary(bundle.manifest,bundle.manifestBytes,original.packet,sourcePins),original};
}
export async function replaySourceEditionWorkorder({directory}) {
  return (await replayBundle(await readBundle(directory))).summary;
}
/** Original validated inventory and replay result; attachment bytes stay in files. */
export async function inspectSourceEditionWorkorder({directory}) {
  const bundle=await readBundle(directory),checked=await replayBundle(bundle);
  return {...checked.summary,manifest:bundle.manifest,request:bundle.request,
    packet:checked.original.packet,manifestBytes:bundle.manifestBytes.length};
}
/** A descriptor bound to the original manifest/request. The streaming caller
 * verifies the selected opened file; complete inspection/replay remains explicit.
 */
export async function sourceEditionWorkorderFile({directory,name}) {
  const bundle=await readBundle(directory,{verifyFiles:false});
  const selected=name==='manifest.json'?{path:name,role:'source-edition-manifest',
    bytes:bundle.manifestBytes.length,sha256:sha(bundle.manifestBytes)}:bundle.inventory.get(relPath(name));
  ensure(selected,'The original bundle does not declare this file');
  return {...selected,path:path.join(bundle.root,selected.path),name:selected.path,verification:'ORIGINAL_MANIFEST_BOUND',
    bundleId:bundle.manifest.bundleId,manifestSha256:sha(bundle.manifestBytes)};
}
/** Bounded original workorder input for the existing case adapter.
 * The full handoff and attachments remain available through their declared files.
 */
export async function sourceEditionWorkorderInput({directory}) {
  const bundle=await readBundle(directory),checked=await replayBundle(bundle);
  const handoff=await importRuntimeHandoff(new TextDecoder('utf-8',{fatal:true}).decode(
    await readPinned(path.join(bundle.root,'originals/support.json'),MAX_HANDOFF_BYTES,bundle.request.inputs.support)));
  const workspace=await parseWorkspace(handoff.workspaceText);
  const terms=await readPinned(path.join(bundle.root,'originals/terms.json'),MAX_TERMS,bundle.request.inputs.terms);
  return {summary:checked.summary,manifest:bundle.manifest,request:bundle.request,
    result:{packet:checked.original.packet,html:checked.original.outputs['seller-packet.html'].toString('utf-8'),
      checklist:checked.original.outputs['acceptance-checklist.md'].toString('utf-8')},
    inputs:{terms:terms.toString('base64'),supportText:handoff.supportText,inputs:workspace.inputs},
    source:{workspaceSha256:sha(Buffer.from(handoff.workspaceText)),supportSha256:sha(Buffer.from(handoff.supportText)),
      termsSha256:sha(terms),handoff:bundle.request.inputs.support}};
}
export async function receiveSourceEditionWorkorder({directory,destination}) {
  const before=await replaySourceEditionWorkorder({directory}),bundle=await readBundle(directory);
  const out=await privateDirectory(destination),sourceReal=await realpath(bundle.root),targetReal=await realpath(out);
  ensure(targetReal!==sourceReal&&!targetReal.startsWith(sourceReal+path.sep)&&!sourceReal.startsWith(targetReal+path.sep),'Receiving needs a separate destination outside the source bundle');
  if(await hasManifest(out)) {
    const retained=await replaySourceEditionWorkorder({directory:out});
    ensure(retained.manifestSha256===before.manifestSha256,'The destination already retains a different bundle');
    return {...retained,directory:out};
  }
  const requestPin=bundle.inventory.get('request.json'),requestFile=path.join(out,'request.json');
  const requestBytes=await readPinned(path.join(bundle.root,'request.json'),MAX_META,requestPin);
  if(!await existingFile(requestFile,requestPin))await allowRequestStages(out,bundle.request,requestBytes);
  await publishRequest(out,bundle.request,requestBytes);
  for(const value of bundle.manifest.files)if(value.path!=='request.json')await copyPinned(path.join(bundle.root,value.path),path.join(out,value.path),value);
  await publishBytes(path.join(out,'manifest.json'),bundle.manifestBytes);
  const after=await replaySourceEditionWorkorder({directory:out});
  ensure(after.manifestSha256===before.manifestSha256&&after.bundleId===before.bundleId,'Receiving changed the original bundle');
  return {...after,directory:out};
}

export async function main(argv=process.argv.slice(2)) {
  const command=argv[0];
  if(!command||command==='--help'||command==='help') {
    console.log('SF49 source-edition workorder\n\nprepare --handoff CASE.merchant-support.json --terms OWNER_TERMS.json --id STABLE_ID --out PRIVATE_DIRECTORY [--attachments EXACT_FILES.json] [--at UTC_TIMESTAMP]\nreplay --bundle PRIVATE_DIRECTORY\ninspect --bundle PRIVATE_DIRECTORY\nreceive --bundle PRIVATE_DIRECTORY --out NEW_PRIVATE_DIRECTORY\nexport --bundle PRIVATE_DIRECTORY --out ARCHIVE.zip [--python PYTHON]\ninspect-archive --archive ARCHIVE.zip [--python PYTHON]\nreceive-archive --archive ARCHIVE.zip --intake PRIVATE_INTAKE_DIRECTORY --out NEW_PRIVATE_DIRECTORY [--python PYTHON]\n\nThe original SF74/SF77 modules validate and rebuild the workorder. Source files remain separate from receiving observations. Archives stream through the maintained Python ZIP64 engine.');
    return;
  }
  ensure(['prepare','replay','inspect','receive','export','inspect-archive','receive-archive'].includes(command),'Unknown command');
  const flags={};
  for(let i=1;i<argv.length;i+=2) {
    ensure(['--handoff','--terms','--id','--out','--attachments','--at','--bundle','--archive','--intake','--python'].includes(argv[i])&&typeof argv[i+1]==='string'&&!argv[i+1].startsWith('--')&&!Object.hasOwn(flags,argv[i]),'Invalid or duplicate command argument');
    flags[argv[i]]=argv[i+1];
  }
  const allowed={
    prepare:['--handoff','--terms','--id','--out','--attachments','--at'],
    receive:['--bundle','--out'],replay:['--bundle'],inspect:['--bundle'],
    export:['--bundle','--out','--python'],'inspect-archive':['--archive','--python'],
    'receive-archive':['--archive','--intake','--out','--python']
  }[command];
  ensure(Object.keys(flags).every(key=>allowed.includes(key)),'Argument does not belong to this command');
  const required={prepare:['--handoff','--terms','--id','--out'],receive:['--bundle','--out'],
    replay:['--bundle'],inspect:['--bundle'],export:['--bundle','--out'],
    'inspect-archive':['--archive'],'receive-archive':['--archive','--intake','--out']}[command];
  for(const key of required)ensure(flags[key],'Missing '+key);
  let result;
  if(command==='prepare')result=await prepareSourceEditionWorkorder({handoff:flags['--handoff'],terms:flags['--terms'],operationId:flags['--id'],directory:flags['--out'],attachments:flags['--attachments'],generatedAt:flags['--at']});
  else if(command==='receive')result=await receiveSourceEditionWorkorder({directory:flags['--bundle'],destination:flags['--out']});
  else if(command==='inspect')result=await inspectSourceEditionWorkorder({directory:flags['--bundle']});
  else if(command==='replay')result=await replaySourceEditionWorkorder({directory:flags['--bundle']});
  else {
    const archive=await import('./source-edition-archive.mjs'),options=flags['--python']?{python:flags['--python']}:{};
    if(command==='export')result=await archive.exportSourceEditionArchive({directory:flags['--bundle'],destination:flags['--out'],...options});
    else if(command==='inspect-archive')result=await archive.inspectSourceEditionArchive({archive:flags['--archive'],...options});
    else result=await archive.receiveSourceEditionArchive({archive:flags['--archive'],stagingDirectory:flags['--intake'],destination:flags['--out'],...options});
  }
  console.log(JSON.stringify(result,null,2));
}
const loadedNativeSource=await nativeSource();
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error('SF49: '+error.message);process.exitCode=1;});
