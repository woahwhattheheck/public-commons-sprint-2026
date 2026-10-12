// MIT. Native vector operations owned by the original WFS project and source orders.
import { join, resolve, dirname } from 'node:path';
import { readdir, lstat, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { privateDirectory, acquireWorkspace, readPrivate, atomicJson, digest as byteHash,
  stamp, object, fault } from '../postgres/publisher/files.mjs';
import { readWfsProject } from './project.mjs';
import { exactFile, reconcileRetainedFile, durableDirectory, optionalJson } from './source.mjs';
import { reconcileWfsVectorSourceLinks } from '../stac/vector/wfs.mjs';
import { operationId } from './model.mjs';
import { retainWfsVectorSource, captureVectorSelection, openVectorCapture,
  exportVectorCapture, openVectorExport, compareVectorCaptures, openVectorComparison,
  vectorChanges, createVectorBundle, receiveVectorBundle, parseExactJSON,
  stringifyExactJSON, ExactNumber } from '../stac/vector/index.mjs';

export const WFS_VECTOR_ROOT='native-vectors';
export const WFS_VECTOR_REQUEST='stellar-forge.wfs-vector-request.v1';
export const WFS_VECTOR_RECEIPT='stellar-forge.wfs-vector-receipt.v1';
const MAX_JSON=256*1024*1024, MAX_PROFILE=4*1024*1024, MAX_ENVELOPE=2*MAX_PROFILE+262144;
const HASH=/^[a-f0-9]{64}$/, OP=/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const need=(yes,code,detail=code,status=400)=>{if(!yes)throw fault(code,detail,status);};
const text=(value,maximum=8192)=>typeof value==='string'&&value.length>0&&value.length<=maximum&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value);
function sorted(value){
  if(value instanceof ExactNumber||value===null||typeof value!=='object')return value;
  if(Array.isArray(value))return value.map(sorted);
  return Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])]));
}
const exact=value=>stringifyExactJSON(sorted(value));
const json=value=>Buffer.from(stringifyExactJSON(value,2)+'\n');
const same=(a,b)=>exact(a)===exact(b);
const hash=bytes=>byteHash(bytes);
function profile(value,required=true){
  if(value===undefined&&!required)return null;
  need(text(value,MAX_PROFILE)&&Buffer.byteLength(value,'utf8')<=MAX_PROFILE,'WFS_VECTOR_PROFILE_REQUIRED','Choose the complete native profile JSON.');
  const parsed=parseExactJSON(value);
  need(object(parsed)&&parsed.schema==='starforge.vector-export-profile.v1'&&
    object(parsed.layers??{}),'WFS_VECTOR_PROFILE_INVALID');
  return parsed;
}
function safePath(path){
  need(typeof path==='string'&&path.length>0&&path.length<=1024&&!path.includes('\\')&&!path.includes('\0')&&
    path.split('/').every(part=>part.length>0&&part!=='.'&&part!=='..'),'WFS_VECTOR_MEMBER_INVALID');
  return path;
}
function nativePath(path){return safePath(path).split('/').filter(Boolean);}
export function isWfsVectorPath(path){
  const p=nativePath(path);
  if(p[0]!==WFS_VECTOR_ROOT||!OP.test(p[1]??'')||p.length<3)return false;
  if(p.length===3)return ['request.json','receipt.json','error.json','profile.json','incoming.zip'].includes(p[2]);
  return ['source','capture','output'].includes(p[2]);
}
export function isWfsVectorDirectory(path){
  const p=nativePath(path);
  return p[0]===WFS_VECTOR_ROOT&&(p.length===1||
    OP.test(p[1]??'')&&(p.length===2||['source','capture','output'].includes(p[2])));
}
export function ignoreWfsVectorMember(path){
  const p=path.split('/'),name=p.at(-1);
  if(p[0]!==WFS_VECTOR_ROOT)return false;
  if(name==='.vector.lock'||/^\.wfs-staged-[a-f0-9]{64}$/.test(name)||
    /^\..+\.[a-f0-9]{32}\.receiving$/.test(name))return true;
  if(p.length===3&&(name==='download.zip'||/^\.pending-[a-f0-9-]{36}$/.test(name)))return true;
  return p.length===4&&p[2]==='source'&&
    /^(?:request\.json|source-receipt\.json|features\.geojson|original-order\.json|profile\.json|selection\.json)\.[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.receiving$/.test(name);
}
async function readOptional(path,maximum=MAX_JSON){
  try{return await readPrivate(path,maximum);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
/** Complete only the original exactFile link commit while owning its project lease. */
async function readRetained(directory,path,maximum=MAX_JSON,leaseHeld=false){
  try{return await readOptional(path,maximum);}catch(error){
    if(error.code!=='PRIVATE_FILE_REQUIRED')throw error;
    const observed=await lstat(path);
    if(!observed.isFile()||observed.isSymbolicLink()||observed.nlink!==2||
      observed.mode&0o077||observed.size>maximum)throw error;
    const release=leaseHeld?null:await acquireWorkspace(resolve(directory));
    try{
      path=resolve(path);await privateDirectory(dirname(path));
      const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));let raw,stat;
      try{
        stat=await handle.stat();
        need(stat.isFile()&&[1,2].includes(stat.nlink)&&!(stat.mode&0o077)&&stat.size<=maximum,
          'WFS_VECTOR_STAGED_FILE_INVALID');
        raw=Buffer.alloc(stat.size);let size=0;
        while(size<raw.length){const part=await handle.read(raw,size,raw.length-size,null);if(!part.bytesRead)break;size+=part.bytesRead;}
        const after=await handle.stat();
        need(size===stat.size&&after.size===stat.size&&after.mtimeMs===stat.mtimeMs&&after.ctimeMs===stat.ctimeMs,
          'WFS_VECTOR_STAGED_FILE_CHANGED');
      }finally{await handle.close();}
      if(stat.nlink===2)await reconcileRetainedFile(path,hash(raw));
      const retained=await readPrivate(path,maximum);
      need(retained.equals(raw),'WFS_VECTOR_STAGED_FILE_CHANGED');return retained;
    }finally{if(release)await release();}
  }
}
async function immutable(path,bytes){
  await durableDirectory(dirname(path));
  await exactFile(path,bytes);
}
function requestCheck(value,id,projectId){
  need(object(value)&&value.schema===WFS_VECTOR_REQUEST&&value.id===id&&value.projectId===projectId&&
    ['capture','export','compare','receive'].includes(value.kind)&&object(value.input)&&HASH.test(value.requestSha256??''),
    'WFS_VECTOR_REQUEST_INVALID');
  const {requestSha256,...body}=value;
  need(hash(exact(body))===requestSha256,'WFS_VECTOR_REQUEST_CHANGED');
  const allowed={
    capture:['orderId','sourceCrs','coordinateOrder','sourceId','selectionId','identityJson'],
    export:['captureId','captureManifestSha256','profileJson'],
    compare:['before','after','beforeManifestSha256','afterManifestSha256'],
    receive:['archiveSha256','archiveBytes','manifestSha256']
  };
  need(Object.keys(value.input).every(key=>allowed[value.kind].includes(key)),'WFS_VECTOR_REQUEST_FIELDS_CHANGED');
  if(value.kind==='capture')need(HASH.test(value.input.orderId??'')&&text(value.input.sourceCrs)&&
    value.input.coordinateOrder==='x,y','WFS_VECTOR_SOURCE_BINDING_REQUIRED');
  if(value.kind==='export'){
    need(OP.test(value.input.captureId??'')&&HASH.test(value.input.captureManifestSha256??''),'WFS_VECTOR_CAPTURE_REQUIRED');
    profile(value.input.profileJson);
  }
  if(value.kind==='compare')need(OP.test(value.input.before??'')&&OP.test(value.input.after??'')&&
    HASH.test(value.input.beforeManifestSha256??'')&&HASH.test(value.input.afterManifestSha256??''),'WFS_VECTOR_COMPARISON_SOURCE_REQUIRED');
  if(value.kind==='receive')need(HASH.test(value.input.archiveSha256??'')&&
    Number.isSafeInteger(value.input.archiveBytes)&&value.input.archiveBytes>0&&value.input.archiveBytes<=MAX_JSON&&
    (value.input.manifestSha256===null||HASH.test(value.input.manifestSha256??'')),'WFS_VECTOR_ARCHIVE_REQUIRED');
  return value;
}
function receiptCheck(value,request){
  need(object(value)&&value.schema===WFS_VECTOR_RECEIPT&&value.id===request.id&&value.projectId===request.projectId&&
    value.kind===request.kind&&value.requestSha256===request.requestSha256&&value.state==='COMPLETE'&&
    typeof value.completedAt==='string'&&object(value.manifest)&&HASH.test(value.manifest.sha256??'')&&
    Number.isSafeInteger(value.manifest.bytes)&&value.manifest.bytes>0,'WFS_VECTOR_RECEIPT_CHANGED');
  const targets={capture:'capture/capture.json',export:'output/vector-export.json',
    compare:'output/vector-comparison.json',receive:null};
  need(targets[value.kind]?value.manifest.path===targets[value.kind]:
    ['output/vector-export.json','output/vector-comparison.json'].includes(value.manifest.path),'WFS_VECTOR_MANIFEST_SELECTION_CHANGED');
  const nativeKind=value.manifest.path==='capture/capture.json'?'capture':
    value.manifest.path==='output/vector-export.json'?'export':'comparison';
  need(value.manifest.kind===nativeKind,'WFS_VECTOR_MANIFEST_KIND_CHANGED');
  return value;
}
async function record(directory,id,projectId,leaseHeld=false){
  operationId(id);
  const root=join(directory,WFS_VECTOR_ROOT,id), raw=await readRetained(directory,join(root,'request.json'),MAX_ENVELOPE,leaseHeld);
  need(raw,'WFS_VECTOR_OPERATION_UNKNOWN','Choose an existing native vector operation.',404);
  const request=requestCheck(JSON.parse(raw),id,projectId);
  const complete=await readRetained(directory,join(root,'receipt.json'),4*1024*1024,leaseHeld);
  const receipt=complete?receiptCheck(JSON.parse(complete),request):null;
  return {root,request,receipt};
}
function summary(value){
  const input={...value.request.input};
  if(typeof input.profileJson==='string'){
    input.profileBytes=Buffer.byteLength(input.profileJson,'utf8');
    input.profileSha256=hash(input.profileJson);delete input.profileJson;
  }
  return {id:value.request.id,kind:value.request.kind,projectId:value.request.projectId,
    requestSha256:value.request.requestSha256,input,
    state:value.receipt?'COMPLETE':'PENDING',...(value.receipt?{receipt:value.receipt}:{})};
}
async function completed(directory,id,projectId,kind,leaseHeld=false){
  const found=await record(directory,id,projectId,leaseHeld);
  need(found.receipt&&(!kind||found.request.kind===kind),'WFS_VECTOR_COMPLETED_SELECTION_REQUIRED');
  return found;
}
function manifestSelection(result){
  const manifest=result.manifest;
  need(object(manifest),'WFS_VECTOR_NATIVE_MANIFEST_REQUIRED');
  const kind=manifest.schema==='starforge.vector-export.v1'?'export':
    manifest.schema==='starforge.vector-comparison.v1'?'comparison':
    manifest.schema==='starforge.vector-capture.v1'?'capture':null;
  need(kind&&object(result.manifestFile)&&HASH.test(result.manifestFile.sha256??''),'WFS_VECTOR_NATIVE_MANIFEST_REQUIRED');
  return {kind,manifest,file:result.manifestFile};
}
function nativeSummary(result){
  const {kind,manifest,file}=manifestSelection(result);
  const layers=manifest.native?.layers??[];
  return {manifest:{kind,path:(kind==='capture'?'capture/':'output/')+file.path,
    bytes:file.bytes,sha256:file.sha256},
    counts:manifest.counts??null,layers:layers.map(layer=>({id:layer.id,sourceLayerId:layer.sourceLayerId,
      sourceId:layer.sourceId,driver:layer.driver,path:layer.path,layer:layer.layer,
      geometry:layer.geometry,crsWkt:layer.crsWkt,coordinateOrder:layer.coordinateOrder,
      featureCount:layer.featureCount,sourceFeatureCount:layer.sourceFeatureCount,fieldCount:layer.fields?.length??0})),
    nativeReceived:result.receiving?{schema:result.receiving.schema,nativeFeatures:result.receiving.nativeFeatures,
      allOriginalBindingsMatched:result.receiving.allOriginalBindingsMatched}:null};
}
function nativeOptions(options){
  return {python:options.python??process.env.STARFORGE_VECTOR_PYTHON??process.env.SF30_WFS_PYTHON??
    process.env.CODEX_PRIMARY_RUNTIME_PYTHON??(process.platform==='win32'?'python':'python3'),signal:options.signal};
}
async function reopen(found,options={}){
  const m=found.receipt.manifest, native=nativeOptions(options),root=found.root;
  if(m.kind==='capture')return openVectorCapture(join(root,'capture'),{...native,expectedManifestSha256:m.sha256});
  if(m.kind==='export')return openVectorExport(join(root,'output'),{...native,expectedManifestSha256:m.sha256});
  if(m.kind==='comparison')return openVectorComparison(join(root,'output'),{...native,expectedManifestSha256:m.sha256});
  need(false,'WFS_VECTOR_MANIFEST_KIND_INVALID');
}
async function retainedProfile(capture,proposed){
  const initial=parseExactJSON((await readPrivate(join(capture.root,'source','profile.json'),MAX_PROFILE)).toString('utf8'));
  const selected=profile(proposed),sourceId=capture.receipt.sourceId;
  need(typeof sourceId==='string'&&object(initial.layers[sourceId]),'WFS_VECTOR_ORIGINAL_PROFILE_MISSING');
  const original=initial.layers[sourceId],actual=selected.layers?.[sourceId];
  need(object(actual)&&actual.assignSourceCrs===original.assignSourceCrs&&
    same(actual.sourceCoordinateBinding,original.sourceCoordinateBinding),'WFS_VECTOR_ORIGINAL_COORDINATES_CHANGED',
    'Keep the captured source CRS and coordinate binding. A different source interpretation requires a new reviewed capture.');
  return selected;
}
export async function runWfsVector({directory,application,id,kind,input={},...options}){
  directory=resolve(directory);operationId(id);
  need(object(input),'WFS_VECTOR_INPUT_REQUIRED');options.signal?.throwIfAborted();
  await privateDirectory(directory);
  const release=await acquireWorkspace(directory);
  try{
    const project=await readWfsProject(directory), projectId=project.id;
    let intent,archiveBytes=null,capture,before,after;
    if(kind==='capture'){
      need(application?.binding?.projectId===projectId,'WFS_VECTOR_ORIGINAL_APPLICATION_REQUIRED');
      need(HASH.test(input.orderId??'')&&text(input.sourceCrs)&&input.coordinateOrder==='x,y',
        'WFS_VECTOR_COORDINATE_REVIEW_REQUIRED','Select a complete order, its source CRS, and x,y coordinate order.');
      const identityJson=input.identityJson??'{"mode":"feature-id"}';
      need(text(identityJson,131072),'WFS_VECTOR_IDENTITY_INVALID');
      const identity=parseExactJSON(identityJson);need(object(identity),'WFS_VECTOR_IDENTITY_INVALID');
      intent={orderId:input.orderId,sourceCrs:input.sourceCrs,coordinateOrder:'x,y',
        ...(input.sourceId?{sourceId:input.sourceId}:{}),...(input.selectionId?{selectionId:input.selectionId}:{}),
        identityJson:exact(identity)};
    }else if(kind==='export'){
      capture=await completed(directory,input.captureId,projectId,'capture',true);
      await retainedProfile(capture,input.profileJson);
      intent={captureId:input.captureId,captureManifestSha256:capture.receipt.manifest.sha256,
        profileJson:input.profileJson};
    }else if(kind==='compare'){
      before=await completed(directory,input.before,projectId,'capture',true);
      after=await completed(directory,input.after,projectId,'capture',true);
      intent={before:input.before,after:input.after,beforeManifestSha256:before.receipt.manifest.sha256,
        afterManifestSha256:after.receipt.manifest.sha256};
    }else if(kind==='receive'){
      need(typeof input.archiveBase64==='string'&&input.archiveBase64.length<=4*Math.ceil(MAX_JSON/3)&&
        HASH.test(input.archiveSha256??'')&&(input.manifestSha256==null||HASH.test(input.manifestSha256)),
        'WFS_VECTOR_ARCHIVE_REQUIRED');
      archiveBytes=Buffer.from(input.archiveBase64,'base64');
      need(archiveBytes.length>0&&archiveBytes.toString('base64')===input.archiveBase64&&
        hash(archiveBytes)===input.archiveSha256,'WFS_VECTOR_ARCHIVE_CHANGED');
      intent={archiveSha256:input.archiveSha256,archiveBytes:archiveBytes.length,manifestSha256:input.manifestSha256??null};
    }else need(false,'WFS_VECTOR_ACTION_UNKNOWN');
    const body={schema:WFS_VECTOR_REQUEST,id,projectId,kind,input:intent};
    const request={...body,requestSha256:hash(exact(body))};
    requestCheck(request,id,projectId);
    const root=join(directory,WFS_VECTOR_ROOT,id);
    await durableDirectory(root);
    // exactFile reconciles its same committed inode before the strict private read.
    await immutable(join(root,'request.json'),json(request));
    const found=await record(directory,id,projectId,true);
    if(found.receipt)return {...summary(found),reused:true};
    try{
      let result,additional={};
      if(kind==='capture'){
        const source=await retainWfsVectorSource(application,intent.orderId,join(root,'source'),{
          ...intent,identity:parseExactJSON(intent.identityJson)});
        result=await captureVectorSelection(source.selectionFile,join(root,'capture'),{
          ...nativeOptions(options),sourceRoot:source.sourceDirectory});
        // Original capture replay may return the manifest without the inspection projection.
        additional={sourceId:source.sourceId,selectionId:source.selection.id,orderId:intent.orderId,
          profileJson:stringifyExactJSON(source.profile,2)};
      }else if(kind==='export'){
        const original=await openVectorCapture(join(capture.root,'capture'),{
          ...nativeOptions(options),expectedManifestSha256:intent.captureManifestSha256});
        await immutable(join(root,'profile.json'),Buffer.from(intent.profileJson,'utf8'));
        result=await exportVectorCapture(original.directory,join(root,'output'),join(root,'profile.json'),id,nativeOptions(options));
        additional={captureId:intent.captureId};
      }else if(kind==='compare'){
        result=await compareVectorCaptures(join(before.root,'capture'),join(after.root,'capture'),join(root,'output'),id,{
          ...nativeOptions(options),beforeManifestSha256:intent.beforeManifestSha256,
          afterManifestSha256:intent.afterManifestSha256});
        additional={before:intent.before,after:intent.after};
      }else{
        await immutable(join(root,'incoming.zip'),archiveBytes);
        result=await receiveVectorBundle(join(root,'incoming.zip'),join(root,'output'),{
          ...nativeOptions(options),expectedArchiveSha256:intent.archiveSha256,
          expectedManifestSha256:intent.manifestSha256??undefined});
      }
      const received=nativeSummary(result);
      const receipt={schema:WFS_VECTOR_RECEIPT,id,projectId,kind,state:'COMPLETE',
        requestSha256:request.requestSha256,completedAt:stamp(),...received,...additional};
      receiptCheck(receipt,request);await immutable(join(root,'receipt.json'),json(receipt));
      return {...summary({request,receipt}),reused:false};
    }catch(error){
      // A durable successful result remains authoritative if its response was interrupted.
      const complete=await readRetained(directory,join(root,'receipt.json'),4*1024*1024,true);
      if(complete)return {...summary({request,receipt:receiptCheck(JSON.parse(complete),request)}),reused:true};
      try{await atomicJson(root,'error.json',{code:error.code??error.name,message:String(error.message).slice(0,4096),at:stamp()});}catch{}
      throw error;
    }
  }finally{await release();}
}
export async function resumeWfsVector({directory,application,id,...options}){
  const project=await readWfsProject(directory),found=await record(directory,id,project.id);
  const input={...found.request.input};
  delete input.captureManifestSha256;delete input.beforeManifestSha256;delete input.afterManifestSha256;
  if(found.request.kind==='receive'){
    const bytes=await readRetained(directory,join(found.root,'incoming.zip'),found.request.input.archiveBytes);
    need(bytes,'WFS_VECTOR_ORIGINAL_ARCHIVE_REQUIRED',
      'Repeat vector-receive with this original ID and the same archive; its request was saved before the archive copy completed.');
    need(hash(bytes)===input.archiveSha256,'WFS_VECTOR_ORIGINAL_ARCHIVE_CHANGED');
    input.archiveBase64=bytes.toString('base64');delete input.archiveBytes;
  }
  return runWfsVector({directory,application,id,kind:found.request.kind,input,...options});
}
export async function listWfsVectors({directory,offset=0,limit=100}){
  const project=await readWfsProject(directory);
  need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=1000,'WFS_VECTOR_PAGE_INVALID');
  let names=[];try{names=await readdir(join(directory,WFS_VECTOR_ROOT),{withFileTypes:true});}
  catch(error){if(error.code!=='ENOENT')throw error;}
  names=names.filter(item=>item.isDirectory()&&!item.isSymbolicLink()&&OP.test(item.name)).map(item=>item.name).sort();
  const retained=[];
  for(const id of names){
    try{
      const file=await lstat(join(directory,WFS_VECTOR_ROOT,id,'request.json'));
      need(file.isFile()&&!file.isSymbolicLink(),'WFS_VECTOR_PRIVATE_REQUEST_REQUIRED');
      retained.push(id);
    }catch(error){if(error.code!=='ENOENT')throw error;}
  }
  names=retained;
  const items=[];
  for(const id of names.slice(offset,offset+limit)){
    const found=await record(directory,id,project.id),row=summary(found);
    if(!found.receipt)row.lastError=await optionalJson(join(found.root,'error.json'),16384);
    items.push(row);
  }
  return {projectId:project.id,total:names.length,offset,items,nextOffset:offset+items.length<names.length?offset+items.length:null};
}
export async function inspectWfsVector({directory,id,...options}){
  const project=await readWfsProject(directory),found=await record(directory,id,project.id);
  if(!found.receipt)return summary(found);
  const result=await reopen(found,options);
  return {...summary(found),manifestJson:stringifyExactJSON(result.manifest,2),
    inspectionJson:result.inspection?stringifyExactJSON(result.inspection,2):null,
    receivingJson:result.receiving?stringifyExactJSON(result.receiving,2):null};
}
export async function pageWfsVectorChanges({directory,id,...options}){
  const project=await readWfsProject(directory),found=await completed(directory,id,project.id);
  need(found.receipt.manifest.kind==='comparison','WFS_VECTOR_COMPARISON_REQUIRED');
  const result=await vectorChanges(join(found.root,'output'),{...options,...nativeOptions(options),
    expectedManifestSha256:found.receipt.manifest.sha256});
  const {native,...view}=result;
  // Exact fractional values remain JSON text through the existing ordinary JSON UI transport.
  return {id,projectId:project.id,resultJson:stringifyExactJSON(view,2)};
}
export async function downloadWfsVector({directory,id,...options}){
  directory=resolve(directory);const release=await acquireWorkspace(directory);
  try{
    const project=await readWfsProject(directory),found=await completed(directory,id,project.id,undefined,true);
    need(['export','comparison'].includes(found.receipt.manifest.kind),'WFS_VECTOR_DELIVERY_REQUIRED');
    const result=await createVectorBundle(join(found.root,'output'),join(found.root,'download.zip'),{
      ...nativeOptions(options),expectedManifestSha256:found.receipt.manifest.sha256});
    const raw=await readPrivate(join(found.root,'download.zip'),MAX_JSON);
    need(result.file?.bytes===raw.length&&hash(raw)===result.file.sha256,'WFS_VECTOR_DOWNLOAD_CHANGED');
    return {name:'wfs-vector-'+id+'.zip',type:'application/zip',bytes:raw};
  }finally{await release();}
}

export async function downloadWfsVectorDocument({directory,id,document,...options}){
  need(['manifest','inspection','profile','receiving'].includes(document),'WFS_VECTOR_DOCUMENT_UNKNOWN');
  const project=await readWfsProject(directory),found=await completed(directory,id,project.id);
  let body;
  if(document==='profile'){
    body=found.receipt.profileJson;
    if(body===undefined&&found.request.kind==='export')body=found.request.input.profileJson;
  }else{
    const opened=await reopen(found,options);
    body=opened[document]===undefined?undefined:stringifyExactJSON(opened[document],2);
  }
  need(body!==undefined,'WFS_VECTOR_DOCUMENT_UNAVAILABLE','This operation does not retain the selected document.');
  return {name:'wfs-vector-'+id+'-'+document+'.json',type:'application/json',bytes:Buffer.from(body+'\n')};
}

/** Select only this module's complete relative operation roots for the original project bundle. */
export async function wfsVectorFiles(directory){
  const names=[];
  async function visit(path){
    if(/^native-vectors\/[A-Za-z0-9][A-Za-z0-9_-]{0,95}\/source$/.test(path))
      await reconcileWfsVectorSourceLinks(join(directory,path));
    let entries;try{entries=await readdir(join(directory,path),{withFileTypes:true});}
    catch(error){if(error.code==='ENOENT')return;throw error;}
    for(const item of entries){
      const name=path+'/'+item.name;
      if(ignoreWfsVectorMember(name))continue;
      need(!item.isSymbolicLink(),'WFS_VECTOR_PRIVATE_MEMBER_REQUIRED',name);
      if(item.isDirectory()){
        need(isWfsVectorDirectory(name),'WFS_VECTOR_UNSELECTED_DIRECTORY',name);
        await privateDirectory(join(directory,name));await visit(name);
      }else{
        need(item.isFile()&&isWfsVectorPath(name),'WFS_VECTOR_UNSELECTED_MEMBER',name);
        const info=await lstat(join(directory,name));
        if(info.nlink===2)await readRetained(directory,join(directory,name),MAX_JSON,true);
        names.push(name);
      }
    }
  }
  await visit(WFS_VECTOR_ROOT);return names.sort();
}
function memberAt(view,path,descriptor){
  const row=view.map.get(path);need(row,'WFS_VECTOR_BUNDLE_MEMBER_MISSING',path);
  if(descriptor)need(row.bytes===descriptor.bytes&&row.sha256===descriptor.sha256,'WFS_VECTOR_BUNDLE_MEMBER_CHANGED',path);
  return view.get(path);
}
/** Validate native request, original order and every declared manifest byte before receiving. */
export function inspectWfsVectorMembers(index,view){
  const groups=new Map(),manifests=[];
  for(const path of view.map.keys()){
    if(!path.startsWith(WFS_VECTOR_ROOT+'/'))continue;
    need(isWfsVectorPath(path),'WFS_VECTOR_BUNDLE_PATH_INVALID');
    const id=path.split('/')[1];if(!groups.has(id))groups.set(id,[]);groups.get(id).push(path);
  }
  const operations=[];
  for(const [id,files]of groups){
    const base=WFS_VECTOR_ROOT+'/'+id,request=requestCheck(JSON.parse(memberAt(view,base+'/request.json')),id,index.id);
    const receipt=view.has(base+'/receipt.json')?receiptCheck(JSON.parse(view.get(base+'/receipt.json')),request):null;
    if(request.kind==='capture'){
      const order=index.orders.find(item=>item.id===request.input.orderId);
      need(order?.state==='READY','WFS_VECTOR_BUNDLE_ORIGINAL_ORDER_MISSING');
      if(view.has(base+'/source/source-receipt.json')){
        const source=JSON.parse(view.get(base+'/source/source-receipt.json'));
        const sourceRequest=parseExactJSON(memberAt(view,base+'/source/request.json').toString('utf8'));
        need(source.schema==='starforge.vector-wfs-received-source.v1'&&source.sourceEdition?.projectId===index.id&&
          same(source.sourceEdition.order,order)&&source.file?.path==='features.geojson'&&
          Number.isSafeInteger(source.file.bytes)&&source.file.bytes>0&&HASH.test(source.file.sha256??'')&&
          sourceRequest.requestSha256===source.requestSha256&&HASH.test(source.requestSha256??'')&&
          hash(exact(sourceRequest.request))===source.requestSha256&&
          same(sourceRequest.request.binding,source.sourceEdition),'WFS_VECTOR_BUNDLE_ORDER_BINDING_CHANGED');
        const originalFile=base+'/source/'+source.file.path;
        if(view.has(originalFile))memberAt(view,originalFile,source.file);
        else need(!receipt&&!view.has(base+'/capture/capture.json'),
          'WFS_VECTOR_BUNDLE_COMPLETED_SOURCE_MISSING',
          'Only an unfinished source copy can continue from the retained original WFS order.');
      }
    }
    if(request.kind==='receive'&&view.has(base+'/incoming.zip'))
      memberAt(view,base+'/incoming.zip',{bytes:request.input.archiveBytes,sha256:request.input.archiveSha256});
    if(request.kind==='export'){
      const previous=WFS_VECTOR_ROOT+'/'+request.input.captureId+'/receipt.json';
      const capture=JSON.parse(memberAt(view,previous));
      need(capture.kind==='capture'&&capture.projectId===index.id&&
        capture.manifest.sha256===request.input.captureManifestSha256,'WFS_VECTOR_BUNDLE_CAPTURE_BINDING_CHANGED');
    }
    if(request.kind==='compare')for(const [key,shaKey]of [['before','beforeManifestSha256'],['after','afterManifestSha256']]){
      const capture=JSON.parse(memberAt(view,WFS_VECTOR_ROOT+'/'+request.input[key]+'/receipt.json'));
      need(capture.kind==='capture'&&capture.projectId===index.id&&capture.manifest.sha256===request.input[shaKey],
        'WFS_VECTOR_BUNDLE_COMPARISON_BINDING_CHANGED');
    }
    const targets=[['capture/capture.json','starforge.vector-capture.v1','capture'],
      ['output/vector-export.json','starforge.vector-export.v1','export'],
      ['output/vector-comparison.json','starforge.vector-comparison.v1','comparison']];
    for(const [path,schema,kind]of targets){
      const name=base+'/'+path;if(!view.has(name))continue;
      const manifest=JSON.parse(view.get(name)),descriptor=view.map.get(name),parent=name.slice(0,name.lastIndexOf('/')+1);
      need(manifest.schema===schema&&Array.isArray(manifest.files),'WFS_VECTOR_BUNDLE_MANIFEST_INVALID');
      const seen=new Set();
      for(const file of manifest.files){
        const target=parent+safePath(file.path);
        need(!seen.has(target)&&target!==name,'WFS_VECTOR_BUNDLE_DUPLICATE_MEMBER');seen.add(target);
        memberAt(view,target,file);
      }
      if(receipt&&receipt.manifest.path===path)memberAt(view,name,receipt.manifest);
      manifests.push({id,path:name,kind,sha256:descriptor.sha256});
    }
    if(receipt)need(manifests.some(value=>value.id===id&&value.path===base+'/'+receipt.manifest.path),
      'WFS_VECTOR_BUNDLE_COMPLETED_MANIFEST_MISSING');
    operations.push({id,request,complete:Boolean(receipt)});
  }
  return {operations,manifests};
}
export function wfsVectorMutableReplayPath(path,closure){
  if(!path.startsWith(WFS_VECTOR_ROOT+'/'))return false;
  const p=path.split('/'),original=closure?.operations.find(value=>value.id===p[1]);
  if(!original)return false;
  return p.length===3&&p[2]==='error.json'||
    !original.complete&&['capture','output'].includes(p[2])&&p.at(-1)!=='request.json';
}
export async function verifyWfsVectors(directory,closure,{python,signal,leaseHeld=false}={}){
  if(!closure?.operations.length)return;
  for(const original of closure.operations){
    const found=await record(directory,original.id,original.request.projectId,leaseHeld);
    need(same(found.request,original.request),'WFS_VECTOR_RECEIVING_REQUEST_CHANGED');
    if(found.receipt)await reopen(found,{python,signal});
    else for(const manifest of closure.manifests.filter(value=>value.id===original.id)){
      const root=join(directory,dirname(manifest.path)),opts={...nativeOptions({python,signal}),expectedManifestSha256:manifest.sha256};
      if(manifest.kind==='capture')await openVectorCapture(root,opts);
      else if(manifest.kind==='export')await openVectorExport(root,opts);
      else await openVectorComparison(root,opts);
    }
  }
}
