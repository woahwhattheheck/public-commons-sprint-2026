// MIT. Read a saved operations tool result through the original retained-file owner.
import { createHash } from 'node:crypto';
import { canonical, fail } from './records.mjs';
import { parseGrpcExportManifest, GRPC_EXPORT_MANIFEST } from '../grpc-workspace-export.mjs';
import { OPERATIONS_MAX_BYTES } from '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/operations/domain.mjs';
const SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const plain=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
function values(result){
  const queue=[result],found=[],seen=new Set();
  while(queue.length){const value=queue.shift();if(!plain(value)||seen.has(value))continue;seen.add(value);found.push(value);
    for(const key of ['result','structuredContent','delivery'])if(plain(value[key]))queue.push(value[key]);
    for(const item of value.content??[])if(item?.type==='text'&&typeof item.text==='string')try{queue.push(JSON.parse(item.text));}catch{}
  }
  const error=found.find(value=>value.isError===true);
  if(error)throw fail('CONSOLE_GRPC_ORIGINAL_READ_FAILED','The original retained-file tool returned an error. Reopen the same saved request.',409);
  return found;
}
const changed=()=>fail('CONSOLE_GRPC_OPERATIONS_RESULT_CHANGED','The complete operations return differs from its saved original request.',409);
export async function readGrpcOperationsConsoleCall({record,operator,authorize,request}){
  if(record.state!=='COMPLETE'||!record.tool?.startsWith('merchant_grpc_operations_')||typeof record.resultJson!=='string')
    throw fail('CONSOLE_GRPC_OPERATIONS_REQUEST_REQUIRED','Open a completed original operations request.',409);
  const args=JSON.parse(record.argumentsJson),returns=values(JSON.parse(record.resultJson));
  const result=returns.find(value=>value.state==='COMPLETE_RESULT_RETAINED');
  if(!result)throw fail('CONSOLE_GRPC_OPERATIONS_INLINE_RESULT','This original request already contains its complete inline return.',400);
  const delivery=result.delivery,expectedId=args.captureId??args.caseId;
  if(!plain(delivery)||delivery.state!=='MANIFEST_RETAINED'||delivery.kind!=='result'||delivery.workspace!==args.workspace||
    !SHA.test(delivery.exportId??'')||!SHA.test(delivery.manifestFile?.sha256??'')||
    result.original?.topic!=='operations-incident'||delivery.original?.topic!=='operations-incident'||
    expectedId!==undefined&&(result.original.operationId!==expectedId||delivery.original.operationId!==expectedId)||
    canonical(result.original)!==canonical(delivery.original))throw changed();
  const invoke=async(name,input)=>{
    const context=await authorize(request,name,input);
    return values(await operator.call(name,input,context?{authorization:context}:undefined));
  };
  const live=(await invoke('merchant_grpc_export_manifest',{exportId:delivery.exportId})).find(value=>value.state==='MANIFEST_RETAINED');
  if(!live||canonical(live)!==canonical(delivery))throw changed();
  async function readFile(file,maximum){
    if(!SHA.test(file.sha256??'')||!Number.isSafeInteger(file.bytes)||file.bytes<1||file.bytes>maximum)throw changed();
    const chunks=[],hash=createHash('sha256');let offset=0,readId;
    try{
      while(offset<file.bytes){
        const value=(await invoke('merchant_grpc_export_file_read',{exportId:delivery.exportId,
          expectedManifestSha256:delivery.manifestFile.sha256,file:file.name,expectedSha256:file.sha256,
          ...(readId?{readId}:{}),offset,limit:65536})).find(value=>value.exportId===delivery.exportId&&value.encoding==='base64');
        if(!value||!UUID.test(value.readId??'')||readId&&readId!==value.readId||value.manifestSha256!==delivery.manifestFile.sha256||
          value.file?.name!==file.name||value.file?.sha256!==file.sha256||value.file?.bytes!==file.bytes||value.offset!==offset||
          !Number.isSafeInteger(value.bytesRead)||value.bytesRead<1||value.bytesRead>65536||typeof value.data!=='string')throw changed();
        readId=value.readId;const bytes=Buffer.from(value.data,'base64'),next=offset+bytes.length;
        if(bytes.length!==value.bytesRead||bytes.toString('base64')!==value.data||next>file.bytes||
          value.nextOffset!==(next===file.bytes?null:next))throw changed();
        chunks.push(bytes);hash.update(bytes);offset=next;
      }
      if(hash.digest('hex')!==file.sha256)throw changed();
      return Buffer.concat(chunks,offset);
    }finally{if(readId)await invoke('merchant_grpc_export_file_release',{exportId:delivery.exportId,readId});}
  }
  const manifestBytes=await readFile({...delivery.manifestFile,name:GRPC_EXPORT_MANIFEST},65000);
  const manifest=parseGrpcExportManifest(manifestBytes,delivery.exportId);
  if(manifest.workspace!==args.workspace||manifest.kind!=='result'||canonical(manifest.files)!==canonical(delivery.files)||
    canonical(manifest.original)!==canonical(delivery.original)||manifest.files.length!==1||manifest.files[0].name!=='grpc-result.json')throw changed();
  const bytes=await readFile(manifest.files[0],OPERATIONS_MAX_BYTES);
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw changed();}
  return {callId:record.id,originalResultSha256:record.resultSha256,exportId:delivery.exportId,
    fileSha256:manifest.files[0].sha256,value};
}
