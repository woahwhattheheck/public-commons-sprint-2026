'use strict';
/** Verify one complete retained native MIME delivery using the maintained parser. */
const sha=require('../runtime/host/connected_sha256.cjs');
const mime=require('../runtime/host/connected_mime.cjs');
const bytes=require('../runtime/host/connected_archive_bytes.cjs');
const rawGmail=require('../runtime/host/connected_gmail_raw.cjs');
const {createConnectedContactAttachments}=require('../runtime/host/connected_contact_attachments.cjs');
const wire=createConnectedContactAttachments(sha);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function safe(path){
 if(typeof path!=='string'||!path||path.startsWith('/')||path.includes('\\')||path.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Unsafe original attachment source path');
 return path;
}
function sourceBytes(files,binaries,path){
 safe(path);
 if(typeof files[path]==='string')return bytes.utf8(files[path]);
 const value=binaries?.[path];
 if(value instanceof Uint8Array)return value;
 throw Error('Complete original attachment source is missing: '+path);
}
function receiveMessage({message,raw,originalPayload,attachments,files,binaries={},account_email,body}){
 if(!originalPayload||!raw||!Array.isArray(attachments))throw Error('Multipart delivery needs its complete original payload, RAW response and attachment source selection');
 if(raw.id!==message.id||(raw.thread_id??raw.threadId)!==(message.thread_id??message.threadId))throw Error('Original FULL/RAW identity differs');
 if(raw.internal_date!==undefined&&raw.internal_date!==null&&String(raw.internal_date)!==String(message.internal_date))throw Error('Original FULL/RAW timestamp differs');
 const selected=wire.prepareNative(originalPayload);
 if(selected.prepared.attachments.length!==attachments.length)throw Error('Every original attachment needs one retained source path');
 const bound=rawGmail.bindGmailRawMessage(message,raw,{mailbox:account_email});
 const parsed=mime.parseGmailRaw(raw,{accountId:account_email,includeBase64:true,includeText:true,maxParts:128,maxDepth:12});
 if(!parsed.complete)throw Error('Complete original MIME tree is required');
 const rawHeaders=parsed.nodes[0].headers;
 for(const name of ['from','to','cc','bcc','date','subject','message-id']){
  const warnings=[];
  const values=headers=>headers.filter(h=>String(h.name).toLowerCase()===name).map(h=>mime.decodeHeaderWords(String(h.value),warnings).replace(/^[ \t]+|[ \t]+$/g,''));
  // Gmail FULL may lowercase a bare address domain while RAW retains its case.
  // Domains are case-insensitive; preserve the local part and all other syntax.
  const comparable=value=>['from','to','cc','bcc'].includes(name)
   ? value.replace(/^([A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@)([A-Za-z0-9.-]+)$/,(_,local,domain)=>local+domain.toLowerCase())
   : value;
  if(!same(values(message.payload.headers||[]).map(comparable),values(rawHeaders).map(comparable))||warnings.length)throw Error('Original FULL/RAW header differs: '+name);
 }
 // Keep every observed original part; FULL must describe the same RAW tree.
 const partRows=[];
 function compare(full,actual,path){
  const type=String(full.mime_type??full.mimeType??'').split(';')[0].trim().toLowerCase();
  const fullParts=full.parts??[],actualParts=actual.parts??[];
  if(type!==actual.mime_type||(full.filename||'')!==(actual.filename||'')||!Array.isArray(fullParts)||fullParts.length!==actualParts.length)throw Error('Original FULL/RAW MIME tree differs: '+path);
  if(!actualParts.length){
   const bytes=mime.decodeBase64(actual.body.base64_url_content);
   const observed=sha.sha256Bytes(bytes),size=full.body?.size??full.body?.size_bytes;
   if(size!==undefined&&Number(size)!==observed.bytes)throw Error('Original FULL part size differs: '+path);
   if(typeof full.body?.content==='string'&&sha.sha256Utf8(full.body.content).sha256!==observed.sha256)throw Error('Original FULL text bytes differ: '+path);
   for(const key of ['data','base64_url_content'])if(typeof full.body?.[key]==='string'&&sha.sha256Bytes(mime.decodeBase64(full.body[key])).sha256!==observed.sha256)throw Error('Original FULL byte content differs: '+path);
   partRows.push({part_path:path,raw_part_id:actual.part_id,mime_type:actual.mime_type,filename:actual.filename||null,...observed});
  }
  fullParts.forEach((child,i)=>compare(child,actualParts[i],path+'.'+i));
 }
 compare(message.payload,bound.message.payload,'0');
 wire.receiveNativeBody(originalPayload,bound.message.payload);
 const primary=selected.bodies.find(x=>x.mime_type==='text/plain')||selected.bodies[0];
 if(primary.content!==body)throw Error('Original primary message body differs');
 const originalFiles=new Set();
 const attachmentRows=selected.prepared.attachments.map((expected,i)=>{
  const source=attachments[i];
  if(!source||source.filename!==expected.filename||source.mime_type!==expected.mime_type||originalFiles.has(source.source_path))throw Error('Original attachment selection differs');
  originalFiles.add(source.source_path);
  const original=sha.sha256Bytes(sourceBytes(files,binaries,source.source_path));
  if(original.bytes!==expected.bytes||original.sha256!==expected.sha256)throw Error('Original attachment payload differs from retained source: '+source.source_path);
  const matches=partRows.filter(x=>x.filename===expected.filename);
  if(matches.length!==1||matches[0].mime_type!==expected.mime_type||matches[0].bytes!==expected.bytes||matches[0].sha256!==expected.sha256)throw Error('Actual attachment bytes differ: '+expected.filename);
  return {source_path:safe(source.source_path),filename:expected.filename,mime_type:expected.mime_type,bytes:expected.bytes,sha256:expected.sha256,part_path:matches[0].part_path,raw_part_id:matches[0].raw_part_id};
 });
 const bodyRows=selected.bodies.map(expected=>{
  const actual=partRows.find(x=>x.part_path===expected.part_path);
  if(!actual||actual.filename||actual.mime_type!==expected.mime_type||actual.bytes!==expected.bytes||actual.sha256!==expected.sha256)throw Error('Actual original text alternative differs');
  return {...actual,charset:'UTF-8'};
 });
 if(partRows.length!==attachmentRows.length+bodyRows.length)throw Error('Unselected original MIME leaf');
 return {schema:'lead-cohort.complete-message.v1',primary_mime_type:primary.mime_type,body_sha256:primary.sha256,
  original_payload_sha256:selected.native_payload_sha256,raw_response_sha256:sha.sha256Utf8(JSON.stringify(raw)).sha256,
  raw_message:parsed.rfc2822,rfc_message_id:bound.source.rfc_message_id,
  bodies:bodyRows,attachments:attachmentRows,warnings:bound.source.warnings,
  mime_tree_sha256:sha.sha256Utf8(JSON.stringify(partRows)).sha256};
}
module.exports={receiveMessage,safe};
