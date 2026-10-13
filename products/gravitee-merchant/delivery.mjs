// SPDX-License-Identifier: MIT
import { readFile, mkdir, open, realpath } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateDirectory, operationLease, saveJSON, regular } from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';
import { sourcePath } from './source.mjs';
import { writeImmutableBytes } from './store.mjs';
import { sha256, hashJSON, requireValue } from './contract.mjs';
const PACKAGE_SCHEMA='gravitee.receiving-package.v1';
export async function createReceivingPackage(store,{includeSoftware=true}={}) {
  const workspaceFiles=(await store.snapshot()).map(file=>({...file,path:'workspace/'+file.path}));
  const files=[...workspaceFiles];
  if(includeSoftware){
    const manifest=JSON.parse(await readFile(new URL('./source-files.json',import.meta.url),'utf8'));
    for(const relative of manifest.files){
      sourcePath(relative);const absolute=fileURLToPath(new URL('../../'+relative,import.meta.url));
      const bytes=await readFile(absolute);files.push({path:'source/'+relative,bytes:bytes.length,sha256:sha256(bytes),base64:bytes.toString('base64')});
    }
  }
  const unsigned={schema:PACKAGE_SCHEMA,workspaceId:store.identity.workspaceId,createdAt:new Date().toISOString(),includeSoftware,
    derivedArtifacts:'Handover files are stored separately in the producing workspace; operating records and all original sources and provider responses are included.',
    start:includeSoftware?'node source/products/gravitee-merchant/cli.mjs serve --directory workspace':null,files};
  return{...unsigned,sha256:hashJSON(unsigned)};
}
export function inspectReceivingPackage(packet) {
  requireValue(packet?.schema===PACKAGE_SCHEMA&&Array.isArray(packet.files),'RECEIVING_PACKAGE_INVALID');
  const {sha256:saved,...unsigned}=packet;requireValue(hashJSON(unsigned)===saved,'RECEIVING_PACKAGE_CHANGED');
  const paths=new Set();let totalBytes=0;const files=[];
  for(const file of packet.files){
    sourcePath(file.path);requireValue(file.path.startsWith('workspace/')||file.path.startsWith('source/'),'RECEIVING_PATH_INVALID');
    requireValue(!paths.has(file.path),'RECEIVING_DUPLICATE_PATH');paths.add(file.path);
    requireValue(typeof file.base64==='string'&&/^[a-f0-9]{64}$/.test(file.sha256),'RECEIVING_FILE_INVALID');
    const bytes=Buffer.from(file.base64,'base64');requireValue(bytes.length===file.bytes&&sha256(bytes)===file.sha256,'RECEIVING_FILE_CHANGED',file.path+' does not match its saved bytes.');
    totalBytes+=bytes.length;requireValue(totalBytes<=2*1024*1024*1024,'RECEIVING_PACKAGE_TOO_LARGE');
    files.push({path:file.path,bytes:file.bytes,sha256:file.sha256});
  }
  for(const path of paths){const components=path.split('/');for(let n=1;n<components.length;n++)requireValue(!paths.has(components.slice(0,n).join('/')),'RECEIVING_FILE_PARENT_CONFLICT');}
  requireValue(paths.has('workspace/workspace.json')&&paths.has('workspace/heads.json'),'RECEIVING_WORKSPACE_MISSING');
  const workspace=JSON.parse(Buffer.from(packet.files.find(f=>f.path==='workspace/workspace.json').base64,'base64').toString('utf8'));
  requireValue(workspace.workspaceId===packet.workspaceId,'RECEIVING_WORKSPACE_ID_CHANGED');
  return{schema:PACKAGE_SCHEMA,sha256:saved,workspaceId:packet.workspaceId,totalFiles:files.length,totalBytes,files,start:packet.start};
}
async function privateParents(root,relative){
  let current=root;
  for(const component of relative.split('/').slice(0,-1)){
    current=join(current,component);
    await mkdir(current,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
    await privateDirectory(current);
  }
}
export async function receivePackage(packet,destination) {
  const inspection=inspectReceivingPackage(packet);
  requireValue(typeof destination==='string'&&destination===resolve(destination),'ABSOLUTE_RECEIVING_PATH_REQUIRED');
  const parent=dirname(destination);requireValue(await realpath(parent)===parent,'RECEIVING_REAL_PARENT_REQUIRED');
  let created=false;
  try{await mkdir(destination,{mode:0o700});created=true;}catch(error){if(error.code!=='EEXIST')throw error;}
  await privateDirectory(destination);
  const markerPath=join(destination,'receiving-operation.json');
  if(created){
    await saveJSON(markerPath,{schema:'gravitee.receiving-operation.v1',sha256:inspection.sha256,workspaceId:inspection.workspaceId,destination,startedAt:new Date().toISOString()});
    const handle=await open(parent,'r');try{await handle.sync();}finally{await handle.close();}
  }
  let marker;
  try{marker=JSON.parse((await regular(markerPath)).toString('utf8'));}
  catch(error){if(error.code==='ENOENT')requireValue(false,'RECEIVING_DESTINATION_EXISTS','Choose a new directory, or continue the destination carrying this original receiving operation.');throw error;}
  requireValue(marker.schema==='gravitee.receiving-operation.v1'&&marker.sha256===inspection.sha256&&marker.workspaceId===inspection.workspaceId&&marker.destination===destination,'ORIGINAL_RECEIVING_PACKAGE_CHANGED');
  const lease=await operationLease(join(destination,'receiving.lock'));
  try{
    try{
      const receipt=JSON.parse((await regular(join(destination,'receiving.json'),16*1024*1024)).toString('utf8'));
      requireValue(receipt.sha256===inspection.sha256&&receipt.workspaceId===inspection.workspaceId&&receipt.destination===destination,'ORIGINAL_RECEIVING_RECEIPT_CHANGED');
      return receipt;
    }catch(error){if(error.code!=='ENOENT')throw error;}
    for(const file of packet.files){await privateParents(destination,file.path);await writeImmutableBytes(join(destination,file.path),Buffer.from(file.base64,'base64'));}
    const receipt={...inspection,receivedAt:new Date().toISOString(),destination};
    await saveJSON(join(destination,'receiving.json'),receipt);
    return receipt;
  }finally{await lease.close();}
}
