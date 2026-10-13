// MIT. Receive the original SQLite snapshot and retain the customer's later edits.
import {open,link,unlink,lstat,readdir,realpath} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {restoreSnapshot,fileIdentity} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/webhook-feed/snapshots.mjs';
import {operationLease,privateDirectory} from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';
import {inspectWebhookStore} from './runtime.mjs';
import {privateBytes,privateJson} from './connection.mjs';
import {MANIFEST_NAME,parseSnapshotManifest,encode,digest,need,hash} from './contracts.mjs';
export async function writeOriginal(file,value){
 const bytes=Buffer.isBuffer(value)?value:encode(value),temporary=file+'.'+randomUUID()+'.next';
 const handle=await open(temporary,'wx',0o600);
 try{await handle.writeFile(bytes);await handle.sync();await handle.close();
  try{await link(temporary,file);}catch(error){if(error.code!=='EEXIST')throw error;need((await privateBytes(file,Math.max(bytes.length,1))).equals(bytes),'WEBHOOK_OPERATIONS_RECEIVE_CONFLICT');}
  const parent=await open(dirname(file),'r');try{await parent.sync();}finally{await parent.close();}
 }finally{await handle.close().catch(()=>{});await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
export async function restoreWebhookSnapshot({directory,destination,exportId,expectedManifestSha256}={}){
 directory=resolve(directory);destination=resolve(destination);hash(expectedManifestSha256);
 need(directory!==destination&&await realpath(directory)===directory,'WEBHOOK_OPERATIONS_RECEIVE_PATH_CONFLICT');
 const bytes=await privateBytes(join(directory,MANIFEST_NAME),65536),manifest=parseSnapshotManifest(bytes,exportId);
 need(digest(bytes)===expectedManifestSha256,'WEBHOOK_OPERATIONS_MANIFEST_CHANGED');
 const original=await privateBytes(join(directory,'snapshot.json'),65536);
 need(digest(original)===manifest.originalManifestSha256&&original.length===manifest.files[0].bytes,'WEBHOOK_OPERATIONS_MANIFEST_CHANGED');
 const parent=dirname(destination);await privateDirectory(parent);
 const lease=await operationLease(join(parent,'.webhook-receive-'+digest(Buffer.from(destination))+'.lock'));
 const binding={schema:'stellar-forge.webhook-feed-received.v1',exportId,storeId:manifest.storeId,manifestSha256:expectedManifestSha256,originalManifestSha256:manifest.originalManifestSha256,database:manifest.files[1]};
 try{
  let exists=true;try{await lstat(destination);}catch(error){if(error.code!=='ENOENT')throw error;exists=false;}
  const receiptFile=join(destination,'.webhook-received.json');
  if(exists){
   await privateDirectory(destination);
   let receipt;try{receipt=await privateJson(receiptFile,65536);}catch(error){if(error.code!=='ENOENT')throw error;}
   if(receipt){
    need(digest(encode(receipt))===digest(encode(binding)),'WEBHOOK_OPERATIONS_RECEIVE_CONFLICT','This receiving workspace belongs to a different original snapshot.');
    const current=await inspectWebhookStore(destination);need(current.storeId===manifest.storeId,'WEBHOOK_OPERATIONS_STORE_CHANGED');
    return {state:'REOPENED',directory:destination,storeId:manifest.storeId,exportId,manifestSha256:expectedManifestSha256};
   }
   // Recover only the exact native restore that completed before its receipt.
   need((await readdir(destination)).every(name=>name==='events.sqlite'),'WEBHOOK_OPERATIONS_RECEIVE_DIRECTORY_IN_USE');
   const actual=await fileIdentity(join(destination,'events.sqlite'));
   need(actual.bytes===manifest.files[1].bytes&&actual.sha256===manifest.files[1].sha256,'WEBHOOK_OPERATIONS_RECEIVE_CONFLICT');
   const current=await inspectWebhookStore(destination);need(current.storeId===manifest.storeId,'WEBHOOK_OPERATIONS_STORE_CHANGED');
  }else{
   const restored=await restoreSnapshot({directory,destination});
   need(restored.storeId===manifest.storeId&&restored.sha256===manifest.files[1].sha256,'WEBHOOK_OPERATIONS_STORE_CHANGED');
  }
  await writeOriginal(receiptFile,binding);
  return {state:'RECEIVED',directory:destination,storeId:manifest.storeId,exportId,manifestSha256:expectedManifestSha256};
 }finally{await lease.close();}
}
