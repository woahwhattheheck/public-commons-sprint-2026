#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {initializationBytes} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/initialization.mjs';
import {need} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/collections/delivery/format.mjs';
import {openNativeCollectionDeliveryClient,retainNativeCustomerRequest,uploadNativeCustomerPackage} from './native-collection-delivery-client.mjs';
import {inspectNativeCustomerPackage,downloadNativeCustomerPackage,reopenNativeCustomerPackage,receiveDownloadedCustomerPackage,inspectReceivedCustomerPackage,downloadReceivedCustomerPackage,reopenReceivedCustomerPackage} from './native-collection-delivery-download.mjs';
const connection=['--url','--workspace','--token-env'];
const commands={
 read:[...connection,'--operation','--input'],preview:[...connection,'--input','--state'],
 prepare:[...connection,'--input','--state'],'task-preview':[...connection,'--input','--state'],
 'task-prepare':[...connection,'--input','--state'],receive:[...connection,'--sha256','--state'],
 inspect:[...connection,'--id'],download:[...connection,'--id','--manifest-sha256','--directory'],
 reopen:['--workspace','--id','--manifest-sha256','--directory'],
 upload:[...connection,'--file','--sha256','--filename','--state'],
 'receive-local':['--file','--sha256','--directory'],
 'received-list':[...connection,'--offset','--limit','--history-sha256'],
 'received-inspect':[...connection,'--sha256'],
 'received-download':[...connection,'--sha256','--manifest-sha256','--directory'],
 'received-reopen':['--workspace','--sha256','--manifest-sha256','--directory']
};
const readOperations=new Set(['workspaces','status','task-inspect','inspect','manifest-file','result-file','package-file','upload-status','received','received-file','received-list','received-package','received-manifest-file','received-package-file']);
function parse(args){
 const [command,...rest]=args;need(Object.hasOwn(commands,command)&&rest.length%2===0,'MCP_DELIVERY_CLI_ARGUMENTS');
 const v={};for(let i=0;i<rest.length;i+=2){need(commands[command].includes(rest[i])&&!Object.hasOwn(v,rest[i])&&rest[i+1],'MCP_DELIVERY_CLI_ARGUMENTS');v[rest[i]]=rest[i+1];}return{command,v};
}
async function input(file){
 need(file,'MCP_DELIVERY_CLI_INPUT_REQUIRED');return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await initializationBytes(resolve(file),256*1024)));
}
const required=(v,key)=>{need(typeof v[key]==='string'&&v[key].length>0,'MCP_DELIVERY_CLI_REQUIRED_'+key.slice(2).replaceAll('-','_').toUpperCase());return v[key];};
const number=(v,key)=>{need(/^(0|[1-9][0-9]*)$/.test(v[key]??'')&&Number.isSafeInteger(Number(v[key])),'MCP_DELIVERY_CLI_INTEGER');return Number(v[key]);};
const help="Original Collections customer packages over the registered MCP host.\nHost registration: native-workspace-cli collection-delivery-register, or\nnative-collections-receiver-cli collection-delivery-register. Only host-side JSON contains local paths.\n\npreview --url URL --workspace ALIAS --input REQUEST.json --state PRIVATE_PREVIEW\ntask-preview --url URL --workspace TASK_ALIAS --input TASK_REQUEST.json --state PRIVATE_PREVIEW\ntask-prepare --url URL --workspace TASK_ALIAS --input REVIEWED_TASK_REQUEST.json --state PRIVATE_PREPARE\nprepare --url URL --workspace ALIAS --input REVIEWED_REQUEST.json --state PRIVATE_PREPARE\ninspect --url URL --workspace ALIAS --id DELIVERY_ID\ndownload --url URL --workspace ALIAS --id DELIVERY_ID --manifest-sha256 SHA --directory PRIVATE_DOWNLOAD\nreopen --workspace ALIAS --id DELIVERY_ID --manifest-sha256 SHA --directory PRIVATE_DOWNLOAD\nupload --url URL --workspace ALIAS --file COMPLETE.ndjson --sha256 SHA --filename NAME --state PRIVATE_UPLOAD\nreceive --url URL --workspace ALIAS --sha256 SHA --state PRIVATE_RECEIVE\nreceive-local --file COMPLETE.ndjson --sha256 SHA --directory PRIVATE_RECIPIENT\nreceived-list --url URL --workspace RECIPIENT [--offset N --limit N --history-sha256 SHA]\nreceived-inspect --url URL --workspace RECIPIENT --sha256 SELECTED_RECEIPT_SHA\nreceived-download --url URL --workspace RECIPIENT --sha256 SELECTED_RECEIPT_SHA --manifest-sha256 REVIEWED_SHA --directory PRIVATE_DOWNLOAD\nreceived-reopen --workspace RECIPIENT --sha256 SELECTED_RECEIPT_SHA --manifest-sha256 REVIEWED_SHA --directory PRIVATE_DOWNLOAD\nread --url URL [--workspace ALIAS] --operation READ_OPERATION [--input PRIVATE_JSON]\n\nNetwork commands accept --token-env NAME (default MCP_ACCESS_TOKEN).\npreview saves its exact response; prepare requires that same request plus expectedPreviewSha256.\nReuse each selected state directory and original request after uncertainty.\ninspect prints the small download manifest and its digest; review it before download.\nreopen, received-reopen and receive-local need no listener or bearer token.\nreceived-list reads the original recipient history; pass its history SHA on later pages.\nreceived-inspect verifies all original bytes and returns a manifest to review before received-download.\nRecipient download does not need the original sender or its delivery ID.\nUploads preserve original filename and complete bytes; supported registered hosts use two-part batches.\nRepeat the identical upload command and state directory to resume its original committed offset.\nreceive is a separate explicit step.\nNo command starts a purchase, quote, Collection run, wallet, or original listener.\n";
export async function main(args=process.argv.slice(2)){
 if(args.length===1&&['--help','-h'].includes(args[0])){process.stdout.write(help);return 0;}
 try{
  const {command,v}=parse(args),network={url:v['--url'],deliveryWorkspace:v['--workspace'],tokenEnv:v['--token-env']??'MCP_ACCESS_TOKEN'};
  let result;
  if(command==='receive-local')result=await receiveDownloadedCustomerPackage({file:resolve(required(v,'--file')),receivingDirectory:resolve(required(v,'--directory')),expectedSha256:required(v,'--sha256')});
  else if(command==='received-reopen')result=await reopenReceivedCustomerPackage({deliveryWorkspace:required(v,'--workspace'),receivedSha256:required(v,'--sha256'),directory:resolve(required(v,'--directory')),expectedManifestSha256:required(v,'--manifest-sha256')});
  else if(command==='reopen')result=await reopenNativeCustomerPackage({deliveryWorkspace:required(v,'--workspace'),id:required(v,'--id'),directory:resolve(required(v,'--directory')),expectedManifestSha256:required(v,'--manifest-sha256')});
  else{
   required(v,'--url');
   if(command==='received-inspect')result=await inspectReceivedCustomerPackage({...network,receivedSha256:required(v,'--sha256')});
   else if(command==='received-download')result=await downloadReceivedCustomerPackage({...network,receivedSha256:required(v,'--sha256'),directory:resolve(required(v,'--directory')),expectedManifestSha256:required(v,'--manifest-sha256')});
   else if(command==='inspect')result=await inspectNativeCustomerPackage({...network,id:required(v,'--id')});
   else if(command==='download')result=await downloadNativeCustomerPackage({...network,id:required(v,'--id'),directory:resolve(required(v,'--directory')),expectedManifestSha256:required(v,'--manifest-sha256')});
   else{
    const client=await openNativeCollectionDeliveryClient(network);
    if(command==='received-list')result=await client.receivedHistory({
     ...(v['--offset']!==undefined?{offset:number(v,'--offset')}:{}),...(v['--limit']!==undefined?{limit:number(v,'--limit')}:{}),
     ...(v['--history-sha256']!==undefined?{expectedHistorySha256:v['--history-sha256']}:{})});
    else if(command==='read'){const operation=required(v,'--operation');need(readOperations.has(operation),'MCP_DELIVERY_CLI_READ_ONLY');result=await client.call(operation,v['--input']?await input(v['--input']):{});}
    else if(command==='upload')result=await uploadNativeCustomerPackage({client,file:resolve(required(v,'--file')),expectedSha256:required(v,'--sha256'),filename:required(v,'--filename'),directory:resolve(required(v,'--state'))});
    else result=await retainNativeCustomerRequest({client,directory:resolve(required(v,'--state')),operation:command,body:command==='receive'?{sha256:required(v,'--sha256')}:await input(v['--input'])});
   }
  }
  process.stdout.write(JSON.stringify(result,null,2)+'\n');return 0;
 }catch(error){process.stderr.write(JSON.stringify({error:/^[A-Z0-9_]{1,160}$/.test(error?.code??'')?error.code:'MCP_DELIVERY_CLI_FAILED',retry:'REOPEN_THE_SAME_SAVED_REQUEST'})+'\n');return 2;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)process.exitCode=await main();
