// MIT. A complete selected source tree, with exact executing-module binding.
import { readdir, lstat, realpath } from 'node:fs/promises';
import { join, resolve, relative as relativeTo } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializationBytes, retainInitializationFile } from '../../initialization.mjs';
import { absolute, relative, measure, hash, need, identity, bytes } from './format.mjs';

export const PREFIX='stellar/scf-starforge-20261009/sf88-operator-buyer-cli/';
const OMIT=new Set(['.git','node_modules','__pycache__','.cache']);
const FORBIDDEN=/^(?:\.env(?:\..*)?|id_rsa|id_ed25519|credentials\.json|auth\.json)$/i;
const REQUIRED=['collections/delivery/inbox-task.mjs','node/agents/inbox-task.mjs','node/result.mjs','node/store.mjs','collections/delivery/source.mjs','collections/delivery/model.mjs','collections/delivery/format.mjs','collections/delivery/http.mjs','collections/delivery/uploads.mjs','collections/delivery/review.mjs','collections/delivery/cli.mjs','collections/delivery/public/index.html','collections/delivery/public/app.mjs','collections/delivery/public/style.css','collections/delivery/OPERATOR.md','collections/delivery/receiving/receive.mjs','collections/model.mjs','collections/server.mjs','initialization.mjs','queue.mjs','operations-handoff/capture.mjs','operations-handoff/contract.mjs','config.mjs','node/inbox.mjs'];
export async function inventory(sourceRoot){
 absolute(sourceRoot);need(await realpath(sourceRoot)===sourceRoot,'CUSTOMER_DELIVERY_SOURCE_ROOT');
 const executed=relativeTo(sourceRoot,fileURLToPath(import.meta.url));
 const prefix=executed===PREFIX+'collections/delivery/source.mjs'?PREFIX:executed==='source/'+PREFIX+'collections/delivery/source.mjs'?'source/'+PREFIX:null;
 need(prefix,'CUSTOMER_DELIVERY_EXECUTING_SOURCE');
 const files=[];let total=0;
 async function walk(directory,prefix=''){
  const entries=(await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'));
  for(const entry of entries){if(OMIT.has(entry.name))continue;need(!entry.isSymbolicLink()&&!FORBIDDEN.test(entry.name)&&!/\.(?:pem|key|p12|pfx)$/i.test(entry.name),'CUSTOMER_DELIVERY_SOURCE_PRIVATE_OR_LINK');
   const path=prefix+entry.name;relative(path);
   if(entry.isDirectory()){await walk(join(directory,entry.name),path+'/');continue;}
   need(entry.isFile(),'CUSTOMER_DELIVERY_SOURCE_FILE');const selected=await measure(join(sourceRoot,path));total+=selected.bytes;
   need(files.length<20000&&total<=128*1024*1024,'CUSTOMER_DELIVERY_SOURCE_LIMIT');files.push({path,...selected});
  }
 }
 await walk(sourceRoot);files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 for(const path of REQUIRED)need(files.some(row=>row.path===prefix+path),'CUSTOMER_DELIVERY_SOURCE_CLOSURE');
 need(files.some(row=>/^(?:LICENSE|LICENSE\.md|LICENSE\.txt)$/.test(row.path)),'CUSTOMER_DELIVERY_LICENSE');
 return{schema:'stellar-forge.sf88.customer-delivery-source.v1',files,bytes:total};
}
export async function createSourceManifest({sourceRoot,destination}){
 absolute(destination);need(!destination.startsWith(sourceRoot+'/'),'CUSTOMER_DELIVERY_MANIFEST_OUTSIDE_SOURCE');
 const value=await inventory(sourceRoot);await retainInitializationFile(destination,bytes(value),{resume:true});return{...value,sha256:identity(value)};
}
export async function selectSource({sourceRoot,sourceManifest,exclude=[]}){
 absolute(sourceRoot);absolute(sourceManifest);
 for(const directory of exclude){absolute(directory);need(!directory.startsWith(sourceRoot+'/')&&directory!==sourceRoot&&!sourceRoot.startsWith(directory+'/'),'CUSTOMER_DELIVERY_SOURCE_SEPARATE_FROM_STATE');}
 need(!sourceManifest.startsWith(sourceRoot+'/'),'CUSTOMER_DELIVERY_MANIFEST_OUTSIDE_SOURCE');
 const raw=await initializationBytes(sourceManifest,16*1024*1024),saved=JSON.parse(raw);
 need(saved.schema==='stellar-forge.sf88.customer-delivery-source.v1'&&Array.isArray(saved.files),'CUSTOMER_DELIVERY_SOURCE_MANIFEST');
 const current=await inventory(sourceRoot);
 need(identity(saved)===identity(current),'CUSTOMER_DELIVERY_SOURCE_CHANGED');
 return{...current,sha256:identity(current)};
}
