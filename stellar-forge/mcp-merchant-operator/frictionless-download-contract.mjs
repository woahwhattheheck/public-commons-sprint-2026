// SPDX-License-Identifier: MIT
export const FRICTIONLESS_DOWNLOAD_MANIFEST='Frictionless-Source-Download.json';
export const FRICTIONLESS_DOWNLOAD_SCHEMA='stellar-forge.frictionless-source-download.v1';
export const FRICTIONLESS_FILE_BYTES=256*1024*1024;
export const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const HASH=/^[a-f0-9]{64}$/;
export function parseFrictionlessDownloadManifest(raw,exportId){
 const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
 const fail=()=>{throw Object.assign(new Error('The complete original Frictionless source export declaration differs.'),{code:'FRICTIONLESS_DOWNLOAD_MANIFEST_INVALID'});};
 if(value.schema!==FRICTIONLESS_DOWNLOAD_SCHEMA||value.exportId!==exportId||!UUID.test(exportId)||!UUID.test(value.workspaceId??'')||
  !UUID.test(value.editionId??'')||!HASH.test(value.sourceHash??'')||!HASH.test(value.captureSha256??'')||
  !HASH.test(value.nativeManifestSha256??'')||!Array.isArray(value.files)||value.files.length<5||value.files.length>10000)fail();
 const required=new Set(['manifest.json','source.tar.gz','source-edition.json','capture-inspection.json','RECEIVING.md']);
 const names=new Set();let total=0;
 for(const file of value.files){
  if(!file||typeof file.name!=='string'||!(required.has(file.name)||/^reviews\/[a-f0-9-]{36}\.json$/.test(file.name))||
   names.has(file.name)||!Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>FRICTIONLESS_FILE_BYTES||!HASH.test(file.sha256??''))fail();
  names.add(file.name);required.delete(file.name);total+=file.bytes;
 }
 if(required.size||!Number.isSafeInteger(total)||total!==value.totalBytes||value.files.find(f=>f.name==='manifest.json').sha256!==value.nativeManifestSha256)fail();
 return value;
}
