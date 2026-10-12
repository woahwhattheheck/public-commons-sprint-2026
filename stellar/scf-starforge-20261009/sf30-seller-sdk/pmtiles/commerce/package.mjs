// MIT. Retain an immutable map release as a complete original merchant input.
import {constants} from 'node:fs';
import {open,realpath,lstat} from 'node:fs/promises';
import {resolve,join,dirname,isAbsolute,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {privateDirectory,readBytes,readJson,exists} from '../../../sf88-operator-buyer-cli/node/store.mjs';
import {need,clone,digest,hash,identifier,canonical} from '../model.mjs';
import {retainJson,retainFile,fileDescriptor,MAX_METADATA_BYTES} from '../files.mjs';
import {readOperationsPackage} from '../portable.mjs';
import {withNativeLease} from '../native.mjs';
import {OUTPUT_SOURCE_SCHEMA,OUTPUT_PACKAGE_SCHEMA,MAX_OUTPUT_BYTES,MAX_OUTPUT_CHUNKS,OUTPUT_METADATA_BYTES,
  normalizeOutputInput,makeOutputObject,validateOutputSource,outputDocuments,outputHash,outputCount} from './model.mjs';

const META=['request.json','selection.json','source.json','seller-service.json','offers.json','objects.json','catalog.json'];
const bytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const sort=rows=>rows.sort((a,b)=>a.path.localeCompare(b.path));
function separate(a,b){need(a!==b&&!a.startsWith(b+sep)&&!b.startsWith(a+sep),'PMTILES_OUTPUT_SEPARATE_DIRECTORY_REQUIRED');}
async function canonicalDirectory(path,{create=false}={}){
  need(typeof path==='string'&&isAbsolute(path),'PMTILES_OUTPUT_ABSOLUTE_DIRECTORY_REQUIRED');
  path=resolve(path);await privateDirectory(path,{create});
  need(await realpath(path)===path,'PMTILES_OUTPUT_CANONICAL_DIRECTORY_REQUIRED');return path;
}
function releaseBinding(release){
  return {workspaceId:release.workspaceId,releaseId:release.id,manifestSha256:release.manifestSha256,
    editionId:release.editionId,editionVersion:release.editionVersion,runtimeSha256:release.runtimeSha256};
}
export async function indexOutputFile(path,{expected,chunkBytes,signal}){
  outputCount(chunkBytes,'Chunk bytes',1,1048576);
  outputCount(expected.bytes,'Output bytes',1,MAX_OUTPUT_BYTES);outputHash(expected.sha256);
  need(Math.ceil(expected.bytes/chunkBytes)<=MAX_OUTPUT_CHUNKS,'PMTILES_OUTPUT_CHUNK_COUNT_LIMIT');
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const before=await file.stat({bigint:true});
    need(before.isFile()&&before.size===BigInt(expected.bytes)&&before.size>0n&&before.size<=BigInt(MAX_OUTPUT_BYTES),
      'PMTILES_OUTPUT_FILE_CHANGED');
    const body=Buffer.alloc(chunkBytes),whole=createHash('sha256'),chunks=[];let offset=0;
    while(offset<expected.bytes){
      signal?.throwIfAborted();const wanted=Math.min(chunkBytes,expected.bytes-offset);let used=0;
      while(used<wanted){const part=await file.read(body,used,wanted-used,offset+used);
        need(part.bytesRead>0,'PMTILES_OUTPUT_FILE_TRUNCATED');used+=part.bytesRead;}
      const selected=body.subarray(0,wanted);whole.update(selected);chunks.push(hash(selected));offset+=wanted;
    }
    const after=await file.stat({bigint:true});
    need(before.size===after.size&&before.mtimeNs===after.mtimeNs&&before.ctimeNs===after.ctimeNs&&
      whole.digest('hex')===expected.sha256,'PMTILES_OUTPUT_FILE_CHANGED');
    return chunks;
  }finally{await file.close();}
}
async function selectOutputs(workspace,input,{signal}={}){
  const state=workspace.state(),release=workspace.getRelease(input.releaseId);
  need(state.id===input.expectedWorkspaceId&&release.workspaceId===state.id&&
    release.manifestSha256===input.releaseManifestSha256,'PMTILES_OUTPUT_RELEASE_CHANGED');
  need(state.currentRelease===release.id,'PMTILES_OUTPUT_PUBLISHED_RELEASE_REQUIRED',
    'Select the currently published map release. Existing prepared output packages retain their earlier selection.');
  const selected=[];
  for(const row of input.objects){
    signal?.throwIfAborted();
    const product={schema:'starforge.pmtiles-output-product.v1',workspaceId:state.id,
      releaseId:release.id,manifestSha256:release.manifestSha256};
    if(row.resourceId){
      const resource=clone(workspace.getResource(row.resourceId));
      need(release.resourceIds.includes(resource.id),'PMTILES_OUTPUT_RESOURCE_OUTSIDE_RELEASE');
      const file=workspace.resourceFile(resource.id);await file.verify({signal});
      product.resource={id:resource.id,kind:resource.kind,name:resource.name,rights:clone(resource.rights)};
      selected.push({id:row.id,name:resource.name,kind:resource.kind,path:file.path,
        bytes:resource.bytes,sha256:resource.sha256,product});
    }else{
      need(isAbsolute(row.package.stagingDirectory),'PMTILES_OUTPUT_ABSOLUTE_PACKAGE_REQUIRED');
      const original=await readOperationsPackage({...row.package,expectedWorkspaceId:state.id});
      const result=original.result;
      need(result.workspace.currentRelease===release.id&&result.runtimeSha256===release.runtimeSha256&&
        result.workspace.workspaceId===state.id,'PMTILES_OUTPUT_PACKAGE_RELEASE_CHANGED');
      product.package={requestId:row.package.requestId,packageId:result.packageId,manifestSha256:result.manifestSha256,
        archiveSha256:result.archive.sha256,workspaceRevision:result.workspace.revision,handoverSha256:result.workspace.sha256};
      selected.push({id:row.id,name:input.title+' operations package',kind:'operations',path:original.file.path,
        bytes:result.archive.bytes,sha256:result.archive.sha256,product});
    }
  }
  need(selected.reduce((total,row)=>total+row.bytes,0)<=MAX_OUTPUT_BYTES,'PMTILES_OUTPUT_TOTAL_SIZE_LIMIT');
  need(selected.reduce((total,row)=>total+Math.ceil(row.bytes/input.chunkBytes),0)<=MAX_OUTPUT_CHUNKS,
    'PMTILES_OUTPUT_CHUNK_COUNT_LIMIT','Choose a larger chunk size so this output package contains at most '+MAX_OUTPUT_CHUNKS+' chunks.');
  return {schema:'starforge.pmtiles-output-selection.v1',requestSha256:digest(input),
    release:releaseBinding(release),objects:selected};
}
function sourceFrom(input,selection,objects){
  need(selection.schema==='starforge.pmtiles-output-selection.v1'&&selection.requestSha256===digest(input)&&
    selection.release.workspaceId===input.expectedWorkspaceId&&selection.release.releaseId===input.releaseId&&
    selection.release.manifestSha256===input.releaseManifestSha256&&selection.objects.length===input.objects.length,
    'PMTILES_OUTPUT_SELECTION_CHANGED');
  need(objects.length===input.objects.length,'PMTILES_OUTPUT_OBJECTS_CHANGED');
  for(const [index,row]of objects.entries()){
    const selected=selection.objects[index],original=input.objects[index];
    need(row.id===original.id&&row.id===selected.id&&row.amount===original.amount&&row.name===selected.name&&
      row.kind===selected.kind&&row.bytes===selected.bytes&&row.sha256===selected.sha256&&
      digest(row.product)===digest(selected.product)&&row.chunkBytes===input.chunkBytes,
      'PMTILES_OUTPUT_OBJECT_SELECTION_CHANGED');
    if(original.filename!==undefined)need(original.filename===row.filename,'PMTILES_OUTPUT_FILENAME_CHANGED');
  }
  return validateOutputSource({schema:OUTPUT_SOURCE_SCHEMA,requestSha256:digest(input),offerId:input.offerId,
    title:input.title,origin:input.origin,payment:clone(input.payment),chunkBytes:input.chunkBytes,
    release:clone(selection.release),objects});
}
function manifestSelection(manifest){
  need(manifest?.schema===OUTPUT_PACKAGE_SCHEMA&&Array.isArray(manifest.files)&&manifest.files.length<=128,
    'PMTILES_OUTPUT_PACKAGE_INVALID');
  const {id,...content}=manifest;need(id==='output-'+digest(content).slice(0,32),'PMTILES_OUTPUT_MANIFEST_CHANGED');
  outputHash(manifest.requestSha256);outputHash(manifest.sourceSha256);outputHash(manifest.catalogSha256);
  const paths=new Set();
  for(const row of manifest.files){
    need(row&&typeof row.path==='string'&&!paths.has(row.path)&&
      (META.includes(row.path)||/^objects\/[a-f0-9]{64}$/.test(row.path)),'PMTILES_OUTPUT_MEMBER_INVALID');
    outputHash(row.sha256);outputCount(row.bytes,'Retained file bytes',1,
      row.path.startsWith('objects/')?MAX_OUTPUT_BYTES:OUTPUT_METADATA_BYTES);
    paths.add(row.path);
  }
  need(META.every(path=>paths.has(path)),'PMTILES_OUTPUT_PACKAGE_INCOMPLETE');
  need(canonical(sort(clone(manifest.files)))===canonical(manifest.files),'PMTILES_OUTPUT_MANIFEST_ORDER_CHANGED');
}
/** Source inspection uses original retained files; no seller, wallet or network is opened. */
export async function readOutputPackage(directory,{expectedManifestSha256,verify=true,signal}={}){
  const root=await canonicalDirectory(directory),manifestRaw=await readBytes(join(root,'package.json'),OUTPUT_METADATA_BYTES);
  const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestRaw));manifestSelection(manifest);
  const manifestSha256=hash(manifestRaw);
  if(expectedManifestSha256!==undefined)need(outputHash(expectedManifestSha256)===manifestSha256,'PMTILES_OUTPUT_PACKAGE_CHANGED');
  const retained={};
  for(const name of META){
    const raw=await readBytes(join(root,name),OUTPUT_METADATA_BYTES),row=manifest.files.find(item=>item.path===name);
    need(row.bytes===raw.length&&row.sha256===hash(raw),'PMTILES_OUTPUT_RETAINED_FILE_CHANGED',name);
    retained[name]=raw;
  }
  const parse=name=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(retained[name]));
  const input=normalizeOutputInput(parse('request.json')),selection=parse('selection.json');
  const source=sourceFrom(input,selection,parse('source.json').objects),documents=outputDocuments(source);
  need(retained['source.json'].equals(bytes(source))&&manifest.requestSha256===digest(input)&&
    manifest.sourceSha256===hash(retained['source.json'])&&manifest.catalogSha256===hash(retained['catalog.json']),
    'PMTILES_OUTPUT_SOURCE_CHANGED');
  for(const [name,value]of Object.entries({'seller-service.json':documents.service,'offers.json':documents.offers,
    'objects.json':documents.description,'catalog.json':documents.catalog}))
    need(retained[name].equals(bytes(value)),'PMTILES_OUTPUT_COMPILED_FILE_CHANGED',name);
  const objects=new Map(source.objects.map(row=>[row.file,{path:row.file,bytes:row.bytes,sha256:row.sha256}]));
  need(manifest.files.length===META.length+objects.size,'PMTILES_OUTPUT_MANIFEST_MEMBERS_CHANGED');
  for(const row of objects.values()){
    const saved=manifest.files.find(item=>item.path===row.path);
    need(saved&&digest(saved)===digest(row),'PMTILES_OUTPUT_OBJECT_DESCRIPTOR_CHANGED');
    const target=join(root,row.path);
    need(await realpath(dirname(target))===dirname(target),'PMTILES_OUTPUT_CANONICAL_FILE_REQUIRED');
    if(verify){
      const actual=await fileDescriptor(target,{limit:MAX_OUTPUT_BYTES,signal});
      need(actual.bytes===row.bytes&&actual.sha256===row.sha256,'PMTILES_OUTPUT_OBJECT_BYTES_CHANGED');
    }
  }
  return {directory:root,manifest,manifestRaw,manifestSha256,source,documents,retained,
    files:[...manifest.files,{path:'package.json',bytes:manifestRaw.length,sha256:manifestSha256}]};
}
export function outputPackageView(prepared){
  const {source,manifest,manifestSha256,documents}=prepared;
  return {schema:OUTPUT_PACKAGE_SCHEMA,state:'COMPLETE',packageId:manifest.id,manifestSha256,
    requestId:JSON.parse(prepared.retained['request.json']).requestId,requestSha256:manifest.requestSha256,
    sourceSha256:manifest.sourceSha256,catalogSha256:manifest.catalogSha256,
    offerId:source.offerId,release:clone(source.release),objects:clone(documents.catalog.objects)};
}
/** This one request selects and retains original bytes once; later map refreshes are independent. */
export async function prepareOutputPackage({workspace,directory,input,signal,onProgress}){
  input=normalizeOutputInput(input);
  need(workspace?.state().id===input.expectedWorkspaceId,'PMTILES_WORKSPACE_ID_CHANGED');
  const root=await canonicalDirectory(directory,{create:true});separate(root,workspace.directory);
  await privateDirectory(join(root,'locks'));await privateDirectory(join(root,'objects'));
  return withNativeLease(join(root,'locks'),'prepare-output',async()=>{
    signal?.throwIfAborted();await retainJson(join(root,'request.json'),input);
    if(await exists(join(root,'package.json')))return outputPackageView(await readOutputPackage(root,{signal}));
    const selectionPath=join(root,'selection.json');let selection;
    if(await exists(selectionPath))selection=await readJson(selectionPath,OUTPUT_METADATA_BYTES);
    else{
      selection=await withNativeLease(join(workspace.directory,'locks'),'workspace-files',
        ()=>selectOutputs(workspace,input,{signal}),{shared:true});
      await retainJson(selectionPath,selection);
    }
    need(selection.requestSha256===digest(input),'PMTILES_OUTPUT_SELECTION_CHANGED');
    // Immutable references remain bound even when the current map publication advances.
    need(digest(releaseBinding(workspace.getRelease(input.releaseId)))===digest(selection.release),
      'PMTILES_OUTPUT_RELEASE_CHANGED');
    need(selection.objects.reduce((total,row)=>total+Math.ceil(row.bytes/input.chunkBytes),0)<=MAX_OUTPUT_CHUNKS,
      'PMTILES_OUTPUT_CHUNK_COUNT_LIMIT');
    const objects=[],indexes=new Map();
    for(const [index,selected]of selection.objects.entries()){
      const original=input.objects[index],target=join(root,'objects',selected.sha256);
      await retainFile(selected.path,target,{expected:selected,limit:MAX_OUTPUT_BYTES,signal,onProgress});
      let chunks=indexes.get(selected.sha256);
      if(!chunks){chunks=await indexOutputFile(target,{expected:selected,chunkBytes:input.chunkBytes,signal});indexes.set(selected.sha256,chunks);}
      objects.push(makeOutputObject({...selected,chunkBytes:input.chunkBytes,amount:original.amount,
        filename:original.filename,offerId:input.offerId,chunks}));
    }
    const source=sourceFrom(input,selection,objects),documents=outputDocuments(source);
    const values={'source.json':source,'seller-service.json':documents.service,'offers.json':documents.offers,
      'objects.json':documents.description,'catalog.json':documents.catalog};
    for(const [name,value]of Object.entries(values))await retainJson(join(root,name),value);
    const files=[];
    for(const name of META){const raw=await readBytes(join(root,name),OUTPUT_METADATA_BYTES);
      files.push({path:name,bytes:raw.length,sha256:hash(raw)});}
    for(const row of new Map(source.objects.map(row=>[row.file,row])).values())
      files.push({path:row.file,bytes:row.bytes,sha256:row.sha256});
    const content={schema:OUTPUT_PACKAGE_SCHEMA,requestSha256:digest(input),sourceSha256:hash(bytes(source)),
      catalogSha256:hash(bytes(documents.catalog)),files:sort(files)};
    await retainJson(join(root,'package.json'),{id:'output-'+digest(content).slice(0,32),...content});
    return outputPackageView(await readOutputPackage(root,{verify:false,signal}));
  });
}
