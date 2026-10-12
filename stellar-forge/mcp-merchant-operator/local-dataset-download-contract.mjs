// SPDX-License-Identifier: MIT
export const LOCAL_DATASET_DOWNLOAD_MANIFEST='Local-Dataset-Download.json';
export const LOCAL_DATASET_DOWNLOAD_SCHEMA='stellar-forge.local-dataset-download.v1';
export const LOCAL_DATASET_FILE_BYTES=8*1024**3;
export const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const HASH=/^[a-f0-9]{64}$/;
export function parseLocalDatasetDownloadManifest(raw,exportId){
 const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
 const fail=()=>{throw Object.assign(new Error('The complete retained local customer package declaration changed.'),{code:'LOCAL_DATASET_DOWNLOAD_MANIFEST_INVALID'});};
 if(value.schema!==LOCAL_DATASET_DOWNLOAD_SCHEMA||value.exportId!==exportId||!UUID.test(exportId)||!UUID.test(value.workspaceId??'')||!UUID.test(value.deliveryId??'')||
  !Array.isArray(value.files)||value.files.length!==2||!HASH.test(value.nativeManifestSha256??''))fail();
 const expected=new Set(['manifest.json','Local_Dataset_Customer.zip']);let total=0;
 for(const file of value.files){if(!expected.delete(file.name)||!Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>LOCAL_DATASET_FILE_BYTES||!HASH.test(file.sha256??''))fail();total+=file.bytes;}
 if(expected.size||total!==value.totalBytes||value.files.find(x=>x.name==='manifest.json').sha256!==value.nativeManifestSha256)fail();
 return value;
}
