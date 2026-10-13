#!/usr/bin/env node
// MIT. Installed caller for the same original desk bridge and complete file receiving.
import {parseArgs} from 'node:util';
import {constants} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {open,link,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {MerchantTaskDesks,readTaskDeskConfiguration} from './task-desk.mjs';
import {privateJson,failure} from './task-desk-connection.mjs';
const help='Task desk Merchant caller\n\n'+
'starforge merchant-task-desk --connection PRIVATE_CONNECTIONS.json --exports PRIVATE_EXPORT_ROOT list\n'+
'starforge merchant-task-desk --connection PRIVATE_CONNECTIONS.json --exports PRIVATE_EXPORT_ROOT status --desk original\n'+
'starforge merchant-task-desk --connection PRIVATE_CONNECTIONS.json --exports PRIVATE_EXPORT_ROOT call --tool merchant_task_desk_preview --input PRIVATE_REQUEST.json\n'+
'starforge merchant-task-desk --connection PRIVATE_CONNECTIONS.json --exports PRIVATE_EXPORT_ROOT download --input PRIVATE_FILE_SELECTION.json --output COMPLETE_FILE\n\n'+
'Download input selects packet-file fields; kind:"rpc" selects saved RPC bytes, kind:"customer" selects the exact reviewed complete customer/source archive.\n'+
'Use the original live instance for a first file read; full later chunks retain readId, SHA256 and offset.\n'+
'Every call sends one original command. Inspect operation requestId or reconcile the exact named customer request and preview after uncertainty.\n';
async function fileHash(path){
 const h=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{
 const before=await h.stat({bigint:true});if(!before.isFile())throw failure('TASK_DESK_OUTPUT_INVALID','The selected output is not a regular file.');
 const hash=createHash('sha256');for await(const chunk of h.createReadStream({autoClose:false}))hash.update(chunk);
 const after=await h.stat({bigint:true});if(['dev','ino','size','mtimeNs','ctimeNs'].some(key=>before[key]!==after[key]))
  throw failure('TASK_DESK_OUTPUT_CHANGED','The existing complete output changed while it was checked.');
 return {bytes:Number(before.size),sha256:hash.digest('hex')};}finally{await h.close();}
}
export async function receiveTaskDeskFile(bridge,input,output){
 const selected=structuredClone(input),rpc=selected.kind==='rpc',customer=selected.kind==='customer';
 if(rpc||customer)delete selected.kind;
 if(selected.readId!==undefined||selected.offset!==undefined)throw failure('INVALID_PARAMS','A complete local file starts at offset zero; its original SHA may be pinned.');
 const tool=rpc?'merchant_task_desk_rpc_file':customer?'merchant_task_desk_customer_file':'merchant_task_desk_packet_file';
 const destination=resolve(output),temporary=join(dirname(destination),'.task-desk-download-'+randomUUID());
 let file,reading,expected,position=0;const digest=createHash('sha256');
 try{
  file=await open(temporary,'wx',0o600);
  for(;;){
   const part=await bridge.call(tool,{...selected,...(reading?{readId:reading,expectedSha256:expected.sha256,offset:position}:{})});
   if(!expected)expected=part.file;
   if(part.encoding!=='base64'||part.offset!==position||part.file.sha256!==expected.sha256||
      part.file.bytes!==expected.bytes||part.file.name!==expected.name)
     throw failure('TASK_DESK_DOWNLOAD_CHANGED','The original full-file selection changed during receiving.');
   reading=part.readId;const bytes=Buffer.from(part.data,'base64');
   if(bytes.length!==part.bytesRead||bytes.toString('base64')!==part.data||
      part.nextOffset!==null&&part.nextOffset!==position+bytes.length)
     throw failure('TASK_DESK_DOWNLOAD_CHANGED','The retained file range does not match its original bytes.');
   let written=0;while(written<bytes.length){const result=await file.write(bytes,written,bytes.length-written);
    if(!result.bytesWritten)throw failure('TASK_DESK_FILE_WRITE','The original full file could not be written.');written+=result.bytesWritten;}
   digest.update(bytes);position+=bytes.length;
   if(part.nextOffset===null)break;
  }
  const sha256=digest.digest('hex');
  if(position!==expected.bytes||sha256!==expected.sha256)throw failure('TASK_DESK_DOWNLOAD_CHANGED','The received file differs from its complete original identity.');
  await file.sync();await file.close();file=null;
  let reused=false;
  try{await link(temporary,destination);}catch(error){
   if(error.code!=='EEXIST')throw error;
   const existing=await fileHash(destination);
   if(existing.sha256!==sha256||existing.bytes!==position)throw failure('TASK_DESK_OUTPUT_EXISTS','The output path already contains different bytes.');
   reused=true;
  }
  const parent=await open(dirname(destination),'r');try{await parent.sync();}finally{await parent.close();}
  return {path:destination,bytes:position,sha256,name:expected.name,contentType:expected.contentType,reused};
 }finally{
  await file?.close().catch(()=>{});await unlink(temporary).catch(()=>{});
  if(reading)await bridge.call('merchant_task_desk_file_release',{desk:selected.desk,readId:reading}).catch(()=>{});
 }
}
export async function main(argv=process.argv.slice(2)){
 const {values,positionals}=parseArgs({args:argv,allowPositionals:true,strict:true,options:{
  connection:{type:'string'},exports:{type:'string'},desk:{type:'string'},tool:{type:'string'},
  input:{type:'string'},output:{type:'string'},help:{type:'boolean',short:'h'}
 }});
 if(values.help){process.stdout.write(help);return;}
 const action=positionals[0]??'list';
 if(positionals.length>1||!['list','status','call','download'].includes(action)||!values.connection||!values.exports)
   throw failure('INVALID_PARAMS',help);
 const bridge=new MerchantTaskDesks({taskDesks:await readTaskDeskConfiguration(values.connection),exportsDirectory:resolve(values.exports)});
 try{
  let result;
  if(action==='list')result=await bridge.call('merchant_task_desks');
  if(action==='status')result=await bridge.call('merchant_task_desk_status',{desk:values.desk});
  if(action==='call'){
   if(!values.tool||!values.input)throw failure('INVALID_PARAMS','Select the original tool and complete private request file.');
   result=await bridge.call(values.tool,await privateJson(resolve(values.input),4194304));
  }
  if(action==='download'){
   if(!values.input||!values.output)throw failure('INVALID_PARAMS','Select the complete private file request and output filename.');
   result=await receiveTaskDeskFile(bridge,await privateJson(resolve(values.input),4194304),values.output);
  }
  process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
 }finally{await bridge.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 main().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code??'TASK_DESK_COMMAND_FAILED',
  message:error.message,status:error.status,details:error.details,nativeResult:error.nativeResult,requestId:error.requestId}})+'\n');process.exitCode=1;});
}
