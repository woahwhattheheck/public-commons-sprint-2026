// MIT. Portable receiving composes the original Tenderly and analysis exports.
import { readdir, realpath, lstat } from 'node:fs/promises';
import { join, dirname, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { absolute, need, object, digest, jsonBytes, privateDirectory, readBytes, readJson,
  exists, syncDirectory, matchingWriteTemporaries } from '../../sf88-operator-buyer-cli/node/store.mjs';
import { openExport } from '../tenderly-stellar-pilot/customer/client.mjs';
import { equalExpected, MAX_RESULT_BYTES } from '../tenderly-stellar-pilot/customer/contract.mjs';
import { receiveResponseFile, exportCapture } from '../../sf88-operator-buyer-cli/tenderly-analysis/library.mjs';
import { MAX_RESPONSE_BYTES } from '../../sf88-operator-buyer-cli/tenderly-analysis/analyze.mjs';
import { openSelection, receiveSelection, exactWrite, describeSelection } from './transaction.mjs';
import { renderHandover } from './report.mjs';

export const HANDOVER_SCHEMA='stellar-forge.safe-simulation-handover.v1';
const INTENT='.safe-handover.json';
const HASH=/^[a-f0-9]{64}$/;
const META=4*1024*1024;
const SELECTION_FILES=['safe-transaction.json','simulation.json','selection.json'];
const CUSTOMER_FILES=['response.json','request.json','buyer-result.json','request.body',
  'simulation-request.json','buyer-evidence.json'];
const ANALYSIS_FILES=['export-intent.json','response.json','request.json','buyer-result.json',
  'capture.json','analysis.json','review.html','calls.csv','state.csv','assets.csv','logs.csv'];
const ROOT_NAMES=[INTENT,'selection','tenderly','analysis','index.html','manifest.json'];
const allowed=new Set([INTENT,'index.html',...SELECTION_FILES.map(n=>'selection/'+n),
  '.tenderly-export.json','manifest.json',...CUSTOMER_FILES].map(n=>
    n===INTENT||n==='index.html'||n.startsWith('selection/')?n:'tenderly/'+n)
  .concat(['manifest.json',...ANALYSIS_FILES].map(n=>'analysis/'+n)));
function fileLimit(name) {
  if(name==='tenderly/response.json') return MAX_RESULT_BYTES;
  if(name.startsWith('analysis/')) return MAX_RESPONSE_BYTES*4;
  return META;
}
function descriptor(value) {
  return object(value)&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&HASH.test(value.sha256);
}
function sameObject(a,b) { return isDeepStrictEqual(a,b); }
function ownPath(root,name) { need(allowed.has(name),'SAFE_HANDOVER_MEMBER_INVALID');return join(root,name); }
async function rootAt(directory,create=false) {
  const root=await privateDirectory(absolute(directory),{create});
  need(await realpath(root)===root,'SAFE_HANDOVER_DIRECTORY_SYMLINK');
  return root;
}
async function verifyNames(root,files,{complete,manifestBytes,sourceRoot=root}) {
  const expected=new Set([...Object.keys(files),...(complete?['manifest.json']:[])]);
  async function temporariesAt(directory,prefix) {
    const sizes=new Set(),matches=new Set();
    for(const name of await readdir(directory)) {
      if(!/^\.write-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(name))continue;
      try { sizes.add((await lstat(join(directory,name))).size); }
      catch(error) { if(error.code!=='ENOENT')throw error; }
    }
    if(sizes.size===0)return matches;
    for(const [name,info] of Object.entries(files)) {
      if((prefix===''&&!name.includes('/'))||(prefix!==''&&name.startsWith(prefix))) {
        need(descriptor(info)&&info.bytes<=fileLimit(name),'SAFE_HANDOVER_DESCRIPTOR_INVALID');
        if(!sizes.has(info.bytes))continue;
        const raw=await readBytes(ownPath(sourceRoot,name),info.bytes);
        for(const name of await matchingWriteTemporaries(directory,[raw]))matches.add(name);
      }
    }
    if(prefix===''&&sizes.has(manifestBytes.length))
      for(const name of await matchingWriteTemporaries(directory,[manifestBytes]))matches.add(name);
    return matches;
  }
  const rootTemporaries=await temporariesAt(root,'');
  for(const name of await readdir(root)) {
    if(rootTemporaries.has(name))continue;
    need(ROOT_NAMES.includes(name),'SAFE_HANDOVER_DESTINATION_CONFLICT');
    const path=join(root,name),info=await lstat(path);
    need(!info.isSymbolicLink(),'SAFE_HANDOVER_DIRECTORY_SYMLINK');
    if(['selection','tenderly','analysis'].includes(name)) {
      need(info.isDirectory(),'SAFE_HANDOVER_DIRECTORY_REQUIRED');
      await rootAt(path);
      const temporary=await temporariesAt(path,name+'/');
      for(const child of await readdir(path)) need(expected.has(name+'/'+child)||temporary.has(child),
        'SAFE_HANDOVER_DESTINATION_CONFLICT');
    } else need(info.isFile()&&expected.has(name),'SAFE_HANDOVER_DESTINATION_CONFLICT');
  }
}
async function fileMetadata(root,names) {
  const files={};
  for(const name of [...names].sort()) {
    const raw=await readBytes(ownPath(root,name),fileLimit(name));
    files[name]={bytes:raw.length,sha256:digest(raw)};
  }
  return files;
}
function bindingFor(result,selected,binding) {
  return {selectionId:selected.id,intentId:result.intentId,configSha256:binding.configSha256,
    bodySha256:binding.bodySha256,responseSha256:result.delivery.sha256};
}
/** Export the retained native result first; its first complete record owns analysis on every retry. */
export async function exportHandover(result,{directory,workspace,signal}={}) {
  const {binding,selected}=await result.operation._binding();
  const originalDirectory=absolute(result.operation.directory);
  directory=absolute(directory);workspace=absolute(workspace);
  need(directory!==originalDirectory&&!directory.startsWith(originalDirectory+sep)&&
    workspace!==directory&&!workspace.startsWith(directory+sep),'SAFE_HANDOVER_DESTINATION_INVALID');
  const input={schema:HANDOVER_SCHEMA+'.intent',...bindingFor(result,selected,binding)};
  directory=await rootAt(directory,true);
  if(await exists(join(directory,'manifest.json'))) {
    const saved=await openHandover(directory);
    need(sameObject(saved.intent,input),'SAFE_HANDOVER_DESTINATION_CONFLICT');
    return {...describeHandover(saved),resumed:true};
  }
  const names=await readdir(directory);
  const temporary=await matchingWriteTemporaries(directory,[jsonBytes(input)]);
  const ordinary=names.filter(name=>!temporary.has(name));
  need(names.every(name=>ROOT_NAMES.includes(name)||/^\.write-[0-9a-f-]{36}$/.test(name))&&
    (ordinary.length===0||ordinary.includes(INTENT)),'SAFE_HANDOVER_DESTINATION_CONFLICT');
  await exactWrite(join(directory,INTENT),jsonBytes(input));
  await receiveSelection(selected.directory,join(directory,'selection'));
  const customer=await result.original.export(join(directory,'tenderly'),{signal});
  const original=await openExport(customer.directory);
  // The original export deliberately retains the first native record if process
  // recovery later changes recording metadata. Analyze that exact record too.
  const capture=await receiveResponseFile(join(customer.directory,'response.json'),{
    workspace,requestFile:join(customer.directory,'simulation-request.json'),
    nativeResultFile:join(customer.directory,'buyer-result.json'),label:selected.record.label});
  const analysis=await exportCapture(workspace,capture.record.id,join(directory,'analysis'));
  await exactWrite(join(directory,'index.html'),Buffer.from(renderHandover({
    selection:describeSelection(selected),intentId:result.intentId,
    simulation:original.simulation,native:original.record.native,captureId:capture.record.id,
    response:original.manifest.files['response.json']})));
  const members=[INTENT,'index.html',...SELECTION_FILES.map(n=>'selection/'+n),
    'tenderly/.tenderly-export.json','tenderly/manifest.json',
    ...Object.keys(customer.manifest.files).map(n=>'tenderly/'+n),
    'analysis/manifest.json',...Object.keys(analysis.manifest.files).map(n=>'analysis/'+n)];
  const manifest={schema:HANDOVER_SCHEMA,binding:input,analysisCaptureId:capture.record.id,
    files:await fileMetadata(directory,members)};
  await verifyNames(directory,manifest.files,{complete:false,manifestBytes:jsonBytes(manifest)});
  await exactWrite(join(directory,'manifest.json'),jsonBytes(manifest));
  await syncDirectory(directory);
  return {...describeHandover(await openHandover(directory)),resumed:false};
}
/** Read a completed original handover at its current location; needs no wallet or listener. */
export async function openHandover(directory) {
  directory=await rootAt(directory);
  const manifestBytes=await readBytes(join(directory,'manifest.json'),65536);
  const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes));
  need(manifest.schema===HANDOVER_SCHEMA&&object(manifest.files)&&HASH.test(manifest.analysisCaptureId)&&
    Object.keys(manifest.files).every(name=>allowed.has(name))&&
    [INTENT,'index.html',...SELECTION_FILES.map(n=>'selection/'+n),
      'tenderly/.tenderly-export.json','tenderly/manifest.json','analysis/manifest.json',
      ...ANALYSIS_FILES.map(n=>'analysis/'+n)]
      .every(name=>Object.hasOwn(manifest.files,name)),'SAFE_HANDOVER_MANIFEST_INVALID');
  await verifyNames(directory,manifest.files,{complete:true,manifestBytes});
  for(const [name,info] of Object.entries(manifest.files)) {
    need(descriptor(info)&&info.bytes<=fileLimit(name),'SAFE_HANDOVER_DESCRIPTOR_INVALID');
    const raw=await readBytes(ownPath(directory,name),info.bytes);
    need(raw.length===info.bytes&&digest(raw)===info.sha256,'SAFE_HANDOVER_MEMBER_CHANGED');
  }
  const intent=await readJson(join(directory,INTENT));
  need(intent.schema===HANDOVER_SCHEMA+'.intent'&&sameObject(intent,manifest.binding)&&
    ['selectionId','configSha256','bodySha256','responseSha256'].every(k=>HASH.test(intent[k]))&&
    typeof intent.intentId==='string','SAFE_HANDOVER_BINDING_INVALID');
  const selection=await openSelection(join(directory,'selection'));
  const original=await openExport(join(directory,'tenderly'));
  const requestBody=await readBytes(join(directory,'tenderly/request.body'),1048576);
  need(intent.selectionId===selection.id&&intent.intentId===original.request.intentId&&
    intent.configSha256===original.request.configSha256&&intent.bodySha256===original.request.bodySha256&&
    intent.responseSha256===original.manifest.files['response.json'].sha256&&
    requestBody.equals(selection.bytes['simulation.json'])&&equalExpected(original.request.expected,selection.expected),
    'SAFE_HANDOVER_ORIGINAL_RESULT_MISMATCH');
  const customerManifest=original.manifest;
  need(Object.keys(customerManifest.files).every(name=>sameObject(customerManifest.files[name],
    manifest.files['tenderly/'+name])),'SAFE_HANDOVER_CUSTOMER_MANIFEST_MISMATCH');
  const analysis=await readJson(join(directory,'analysis/manifest.json'),65536);
  need(analysis.schema==='stellar-forge.tenderly-export.v1'&&analysis.captureId===manifest.analysisCaptureId&&
    object(analysis.files)&&Object.keys(analysis.files).length===ANALYSIS_FILES.length&&
    ANALYSIS_FILES.every(name=>sameObject(analysis.files[name],manifest.files['analysis/'+name])),
    'SAFE_HANDOVER_ANALYSIS_MANIFEST_MISMATCH');
  const capture=await readJson(join(directory,'analysis/capture.json'),META);
  need(capture.schema==='stellar-forge.tenderly-capture.v1'&&capture.id===manifest.analysisCaptureId&&
    capture.binding?.responseSha256===intent.responseSha256&&
    capture.binding.responseBytes===customerManifest.files['response.json'].bytes&&
    capture.binding.nativeSha256===customerManifest.files['buyer-result.json'].sha256&&
    capture.binding.requestSha256===customerManifest.files['simulation-request.json'].sha256&&
    sameObject(analysis.files['response.json'],customerManifest.files['response.json'])&&
    sameObject(analysis.files['request.json'],customerManifest.files['simulation-request.json'])&&
    sameObject(analysis.files['buyer-result.json'],customerManifest.files['buyer-result.json']),
    'SAFE_HANDOVER_ANALYSIS_SOURCE_MISMATCH');
  return {directory,manifest,intent,selection,original,capture};
}
export function describeHandover(value) {
  return {schema:HANDOVER_SCHEMA,directory:value.directory,intentId:value.intent.intentId,
    selection:describeSelection(value.selection),response:value.original.manifest.files['response.json'],
    simulation:value.original.simulation,nativeStatus:value.original.record.native.status,
    captureId:value.manifest.analysisCaptureId,files:Object.keys(value.manifest.files).length+1,
    reviewFile:join(value.directory,'index.html'),analysisFile:join(value.directory,'analysis/review.html')};
}
/** Copy the exact declared members, then receive the same response through the original analysis library. */
export async function receiveHandover(sourceDirectory,{directory,workspace}={}) {
  const source=await openHandover(sourceDirectory);
  directory=absolute(directory);workspace=absolute(workspace);
  need(directory!==source.directory&&!directory.startsWith(source.directory+sep)&&
    !source.directory.startsWith(directory+sep)&&workspace!==directory&&!workspace.startsWith(directory+sep),
    'SAFE_HANDOVER_DESTINATION_INVALID');
  directory=await rootAt(directory,true);
  const manifestBytes=await readBytes(join(source.directory,'manifest.json'),65536);
  await verifyNames(directory,source.manifest.files,{complete:await exists(join(directory,'manifest.json')),
    manifestBytes,sourceRoot:source.directory});
  const temporary=await matchingWriteTemporaries(directory,[await readBytes(join(source.directory,INTENT),META),manifestBytes]);
  const names=(await readdir(directory)).filter(name=>!temporary.has(name));
  need(names.length===0||names.includes(INTENT),'SAFE_HANDOVER_DESTINATION_CONFLICT');
  // The source intent is published before payloads and the source manifest last.
  await exactWrite(join(directory,INTENT),await readBytes(join(source.directory,INTENT),META));
  for(const name of Object.keys(source.manifest.files).filter(n=>n!==INTENT).sort()) {
    await rootAt(dirname(ownPath(directory,name)),true);
    await exactWrite(ownPath(directory,name),await readBytes(ownPath(source.directory,name),source.manifest.files[name].bytes));
  }
  await exactWrite(join(directory,'manifest.json'),manifestBytes);
  await syncDirectory(directory);
  const received=await openHandover(directory);
  const capture=await receiveResponseFile(join(directory,'tenderly/response.json'),{
    workspace,requestFile:join(directory,'tenderly/simulation-request.json'),
    nativeResultFile:join(directory,'tenderly/buyer-result.json'),label:received.selection.record.label});
  need(capture.record.id===received.manifest.analysisCaptureId,'SAFE_RECEIVED_CAPTURE_ID_MISMATCH');
  return {...describeHandover(received),analysisWorkspace:absolute(workspace),captureDirectory:capture.directory};
}
