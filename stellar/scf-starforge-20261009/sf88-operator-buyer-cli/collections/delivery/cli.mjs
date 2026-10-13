#!/usr/bin/env node
// MIT. Customer delivery only; no Inbox attempt, signer, ledger or RPC call.
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { openCollections } from '../model.mjs';
import { openCustomerDelivery } from './model.mjs';
import { createSourceManifest } from './source.mjs';
import { inspectPackage, need, bytes } from './format.mjs';
const HELP='Customer result delivery\n\n  source-manifest --source-root ABS --output ABS\n  task-inspect --receiving-directory ABS --request ABS_JSON\n  task-preview --receiving-directory ABS --request ABS_JSON\n  task-prepare --receiving-directory ABS --request ABS_JSON\n  preview --directory ABS --request ABS_JSON\n  prepare --directory ABS --request ABS_JSON\n  list --directory ABS\n  show --directory ABS --id ID\n  inspect-package --file ABS\n  receive --receiving-directory ABS --file ABS --sha256 SHA\n  received-list --receiving-directory ABS\n  received --receiving-directory ABS --sha256 SHA\n  received-package --receiving-directory ABS --sha256 SHA\n\nPreview requires a request with id, collectionId, expectedManifestSha256, title,\nnote, intentIds, sourceRoot, sourceManifest, maxVerifyBytes and allowIncomplete.\nPrepare uses those exact fields plus expectedPreviewSha256 from the preview.\nThe original source root is separate from the private workspace and Inbox.\nUse the existing Collections serve command and /customer-delivery for its UI.\n';
export async function main(args=process.argv.slice(2)){
 if(args.length===0||args.length===1&&args[0]==='--help'){process.stdout.write(HELP);return;}
 const [command,...rest]=args,allowed={
  'source-manifest':['--source-root','--output'],'task-inspect':['--receiving-directory','--request'],'task-preview':['--receiving-directory','--request'],'task-prepare':['--receiving-directory','--request'],preview:['--directory','--request'],prepare:['--directory','--request'],
  list:['--directory'],show:['--directory','--id'],'inspect-package':['--file'],
  receive:['--receiving-directory','--file','--sha256'],'received-list':['--receiving-directory'],received:['--receiving-directory','--sha256'],'received-package':['--receiving-directory','--sha256']
 };need(Object.hasOwn(allowed,command),'CUSTOMER_DELIVERY_COMMAND');const options={};
 for(let i=0;i<rest.length;i+=2){need(allowed[command].includes(rest[i])&&!Object.hasOwn(options,rest[i])&&typeof rest[i+1]==='string','CUSTOMER_DELIVERY_ARGUMENT');options[rest[i]]=rest[i+1];}
 for(const key of allowed[command])need(options[key],'CUSTOMER_DELIVERY_ARGUMENT_REQUIRED');
 let result,collections,desk;
 try{
  if(command==='source-manifest')result=await createSourceManifest({sourceRoot:options['--source-root'],destination:options['--output']});
  else if(command==='inspect-package')result=await inspectPackage(options['--file']);
  else{
   if(options['--directory'])collections=await openCollections({directory:options['--directory'],existingOnly:true});
   desk=await openCustomerDelivery({collections,directory:join(options['--directory']??options['--receiving-directory'],'customer-delivery')});
   if(['task-inspect','task-preview','task-prepare'].includes(command)){const input=JSON.parse(await readFile(options['--request'],'utf8'));result=await desk[{'task-inspect':'inspectTask','task-preview':'previewTask','task-prepare':'prepareTask'}[command]](input);}
   else if(command==='preview'||command==='prepare'){const input=JSON.parse(await readFile(options['--request'],'utf8'));result=await desk[command](input);}
   else if(command==='list')result=await desk.list();
   else if(command==='show')result=await desk.inspect(options['--id']);
   else if(command==='receive')result=await desk.receive({file:options['--file'],expectedSha256:options['--sha256']});
   else if(command==='received-list')result=await desk.listReceived();
   else if(command==='received-package')result=await desk.receivedPackage(options['--sha256']);
   else result=await desk.received(options['--sha256']);
  }
  process.stdout.write(bytes(result));return result;
 }finally{await desk?.close();await collections?.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(/^[A-Z0-9_]+$/.test(error.code??'')?error.code:'CUSTOMER_DELIVERY_FAILED');process.exitCode=1;});
