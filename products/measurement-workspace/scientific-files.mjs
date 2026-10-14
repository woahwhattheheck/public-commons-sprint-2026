// MIT. Materialize only original native file products from complete retained
// HTTP responses. Scientific construction and receiving stay in their original owners.
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {regularFile,saveClientBytes,saveClientJSON,copyClientFile,need} from './client.mjs';
import {resolveOperation} from './operations.mjs';
export const MAX_NATIVE_ENVELOPE=512*1024*1024;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const wrappers=new Map([
 ['flow-bundle',{field:'base64',type:'application/zip'}],
 ['load-bundle',{field:'base64',type:'application/zip'}],
 ['collection-bundle',{field:'base64',type:'application/zip'}],
 ['handback-bundle',{field:'contentBase64',type:'application/zip'}],
 ['flow-comparison-bundle',{field:'base64',type:'application/zip'}],
 ['flow-comparison-report',{field:'content',type:'text/html; charset=utf-8'}],
 ['flow-comparison-csv',{field:'content',type:'text/csv; charset=utf-8'}],
 ['flow-load-comparison-bundle',{field:'base64',type:'application/zip'}],
 ['flow-load-comparison-report',{field:'content',type:'text/html; charset=utf-8'}],
 ['flow-load-comparison-csv',{field:'content',type:'text/csv; charset=utf-8'}]
]);
const mime=v=>String(v||'').split(';',1)[0].trim().toLowerCase();
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function nativeName(value,fallback){
 const name=value??fallback;need(typeof name==='string'&&name.length>0&&name.length<=240&&!/[\\/\u0000-\u001f\u007f]/.test(name)&&name!=='.'&&name!=='..','Original artifact filename is invalid.');
 return name;
}
function decode(response,contract,operation){
 let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(response));}catch{need(false,'Retain a complete UTF-8 native file envelope.');}
 need(plain(value),'Original native file envelope must be an object.');
 need(value.type===undefined||mime(value.type)===mime(contract.type),'Original native file media type differs from its declared operation.');
 let bytes;
 if(contract.field==='content'){
  need(typeof value.content==='string','Original native text file is absent.');bytes=Buffer.from(value.content,'utf8');
 }else{
  const encoded=value[contract.field];need(typeof encoded==='string'&&encoded.length%4===0&&!/[^A-Za-z0-9+/=]/.test(encoded)&&!encoded.slice(0,-2).includes('='),'Original native archive is not complete canonical base64.');
  need(Number.isSafeInteger(value.bytes)&&value.bytes>=0&&/^[a-f0-9]{64}$/.test(value.sha256||''),'Original native archive byte count and SHA are required.');
  need(value.bytes<=MAX_NATIVE_ENVELOPE&&Math.ceil(value.bytes/3)*4===encoded.length,'Original native archive size differs or exceeds the complete envelope limit.');
  bytes=Buffer.from(encoded,'base64');need(bytes.toString('base64')===encoded&&bytes.length===value.bytes&&hash(bytes)===value.sha256,'Original native archive bytes differ from its complete declared identity.');
 }
 const sha256=hash(bytes);
 if(value.bytes!==undefined)need(value.bytes===bytes.length,'Original native text byte count differs.');
 if(value.sha256!==undefined)need(value.sha256===sha256,'Original native text hash differs.');
 const suffix=mime(contract.type)==='application/zip'?'.zip':mime(contract.type)==='text/html'?'.html':'.csv';
 return {bytes,sha256,type:contract.type,name:nativeName(value.name??value.filename,operation+suffix)};
}
export async function measurementArtifact(client,id,{requestId}={}){
 const status=await client.status(id,requestId);
 need(status.phase==='COMPLETED'&&status.successful===true,'Choose the first complete successful native response; unknown, partial and HTTP-error outcomes remain raw evidence.');
 const descriptor=await client.file(id,{requestId,part:'response'});
 need(descriptor.sha256===status.result.sha256&&descriptor.bytes===status.result.bytes,'Selected original response identity differs.');
 // Resolve the retained original input, not a caller-supplied decoder or route.
 const input=await client.file(id,{requestId,part:'input'});
 const original=await regularFile(input.path,{maximum:128*1024*1024,privateOnly:true,published:true});
 need(original.sha256===input.sha256&&original.sha256===status.request.inputSha256&&original.bytes===status.request.inputBytes,'Retained original input identity changed.');
 let command;try{command=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(original.body));}catch{need(false,'Retained original operation input differs.');}
 const operation=resolveOperation(command);need(operation.name===status.request.operation&&operation.path===status.request.path&&operation.method===status.request.method,'Original artifact operation identity differs.');
 const contract=wrappers.get(operation.name);
 const binding={requestId,operation:operation.name,responseSha256:descriptor.sha256,responseBytes:descriptor.bytes,connection:status.request.connection};
 if(!contract){
  // Unwrapped native output remains byte-for-byte the original response. No JSON
  // model, report, table or scientific value is reconstructed here.
  const disposition=status.result.headers?.['content-disposition']||'',matched=/^attachment;\s*filename="([^"]+)"$/i.exec(disposition);
  const type=mime(descriptor.type),extension=type==='text/html'?'.html':type==='text/csv'?'.csv':type==='application/zip'?'.zip':type==='application/json'||type==='application/geo+json'?'.json':'.bin';
  const name=nativeName(matched?.[1],/\.(?:html|csv|json|zip)$/.test(operation.name)?operation.name:operation.name+extension);
  return {...descriptor,...binding,name,representation:'original-http-body'};
 }
 need(mime(descriptor.type)==='application/json','Original wrapped native file must retain its JSON response media type.');
 need(descriptor.bytes<=MAX_NATIVE_ENVELOPE,'Native JSON file envelope exceeds 512 MiB. Retain/download the complete raw response or use the existing large-file transfer; no partial file is produced.');
 const response=await regularFile(descriptor.path,{maximum:MAX_NATIVE_ENVELOPE,privateOnly:true,published:true});
 need(response.sha256===descriptor.sha256&&response.bytes===descriptor.bytes,'Original native envelope changed.');
 const product=decode(response.body,contract,operation.name),root=dirname(descriptor.path),path=join(root,'native-artifact.bin');
 await saveClientBytes(path,product.bytes);
 const receipt={schema:'stellar-forge.measurement-native-artifact.v1',...binding,name:product.name,type:product.type,bytes:product.bytes.length,sha256:product.sha256,representation:'original-native-envelope'};
 await saveClientJSON(join(root,'native-artifact.json'),receipt);
 return {...receipt,path,directory:descriptor.directory};
}
export async function copyMeasurementArtifact(client,id,selection,out){
 const descriptor=await measurementArtifact(client,id,selection);
 const result=await copyClientFile({file:async()=>descriptor},id,{},out);
 return {...result,requestId:descriptor.requestId,operation:descriptor.operation,responseSha256:descriptor.responseSha256,representation:descriptor.representation};
}
