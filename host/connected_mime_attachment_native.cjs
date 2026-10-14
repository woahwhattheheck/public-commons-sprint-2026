#!/usr/bin/env node
'use strict';
/** Exact original attachment/source intake into explicitly selected local files. */
const fs=require('node:fs');
const path=require('node:path');
const {receiveGmailRawAttachment,receiveGmailSourceCarrier}=require('./connected_mime_attachment.cjs');
const {sha256Bytes}=require('./connected_sha256.cjs');
const carrier=require('./connected_source_carrier.cjs');
const codec=require('./connected_zip.cjs');
function need(ok,message){if(!ok)throw TypeError(message);}
function readBytes(filename,maxBytes){
  const stat=fs.statSync(filename);
  need(stat.isFile()&&stat.size<=maxBytes,'Choose a complete file within the selected capacity');
  const data=fs.readFileSync(filename);
  need(data.length<=maxBytes,'Input grew beyond the selected capacity');
  return data;
}
function readJSON(filename,maxBytes){return JSON.parse(codec.utf8Text(readBytes(filename,maxBytes)));}
function sameOutput(filename,expected){
  const stat=fs.lstatSync(filename);
  need(stat.isFile()&&!stat.isSymbolicLink(),'Existing output must be a regular file');
  need(stat.size===expected.bytes,'Existing output has different bytes; choose a new path');
  const actual=sha256Bytes(fs.readFileSync(filename));
  need(actual.bytes===expected.bytes&&actual.sha256===expected.sha256,'Existing output differs; choose a new path');
}
function distinct(paths){
  const resolved=paths.map(value=>{
    need(typeof value==='string'&&value.length,'Choose complete input and output filenames');
    return path.resolve(value);
  });
  need(new Set(resolved).size===resolved.length,'Choose separate input, carrier, selection and output files');
  return resolved;
}
function writeComplete(filename,data,expected){
  let fd,disposition='created';
  try{fd=fs.openSync(filename,'wx',0o600);}
  catch(error){
    if(error.code!=='EEXIST')throw error;
    sameOutput(filename,expected);
    return 'already-identical';
  }
  try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}
  finally{fs.closeSync(fd);}
  sameOutput(filename,expected);
  return disposition;
}
function unwrapRaw(response){
  if(response&&typeof response.raw==='string')return response;
  if(response&&response.structuredContent)return unwrapRaw(response.structuredContent);
  if(response&&Array.isArray(response.content)){
    const items=response.content.filter(item=>item.type==='text');
    need(items.length===1,'Select one complete original raw response');
    return unwrapRaw(JSON.parse(items[0].text));
  }
  throw TypeError('Receive the original raw message or its untouched connector envelope');
}
function receiveRawFile(rawFile,selectionFile,outputFile){
  const [rawPath,selectionPath,output]=distinct([rawFile,selectionFile,outputFile]);
  const selection=readJSON(selectionPath,64*1024);
  const capacity=selection.maxMessageBytes??64*1024*1024;
  need(Number.isSafeInteger(capacity)&&capacity>0,'Choose a positive message byte capacity');
  const rawLimit=Math.ceil(capacity/3)*4+8*1024*1024;
  need(Number.isSafeInteger(rawLimit),'Selected message capacity is too large');
  const message=unwrapRaw(readJSON(rawPath,rawLimit));
  const received=selection.source_carrier
    ?receiveGmailSourceCarrier(message,selection)
    :receiveGmailRawAttachment(message,selection);
  const expected=received.original??received.attachment;
  const disposition=writeComplete(output,received.data,expected);
  return {schema:received.schema,source:received.source,attachment:received.attachment,
    ...(received.original?{original:received.original,carrier:received.carrier}:{}),output,disposition};
}
function packSourceFile(sourceFile,carrierFile,selectionFile,maxCarrierBytes=carrier.DEFAULT_CARRIER_BYTES){
  const [input,output,selectionOutput]=distinct([sourceFile,carrierFile,selectionFile]);
  const packed=carrier.packSourceCarrier(readBytes(input,carrier.MAX_SOURCE_BYTES),
    {filename:path.basename(input),maxCarrierBytes});
  const selection={...packed.selection,maxCarrierBytes,maxSourceBytes:carrier.MAX_SOURCE_BYTES};
  const selectionBytes=codec.utf8(JSON.stringify(selection,null,2)+'\n');
  const selectionIdentity=sha256Bytes(selectionBytes);
  // Receive before publishing so both the native and connected paths use the
  // same complete decoder, including its original UTF-8 and identity checks.
  carrier.receiveSourceCarrier(packed.data,selection,{maxCarrierBytes});
  const disposition=writeComplete(output,packed.data,packed.carrier);
  const selectionDisposition=writeComplete(selectionOutput,selectionBytes,selectionIdentity);
  return {schema:carrier.SCHEMA,source:packed.source,carrier:packed.carrier,gzip:packed.gzip,
    output,disposition,selection_output:selectionOutput,selection_disposition:selectionDisposition,
    selection_file:selectionIdentity};
}
function receiveSourceFile(carrierFile,selectionFile,outputFile){
  const [input,selectionPath,output]=distinct([carrierFile,selectionFile,outputFile]);
  const selection=readJSON(selectionPath,64*1024);
  const maxCarrierBytes=selection.maxCarrierBytes??carrier.DEFAULT_CARRIER_BYTES;
  need(Number.isSafeInteger(maxCarrierBytes)&&maxCarrierBytes>0&&maxCarrierBytes<=carrier.MAX_SOURCE_BYTES,
    'Choose a complete carrier capacity up to 64 MiB');
  const restored=carrier.receiveSourceCarrier(readBytes(input,maxCarrierBytes),selection,
    {maxCarrierBytes,maxSourceBytes:selection.maxSourceBytes});
  const disposition=writeComplete(output,restored.data,restored.source);
  return {schema:restored.schema,source:restored.source,carrier:restored.carrier,gzip:restored.gzip,
    members:restored.members,output,disposition};
}
function main(argv){
  let result;
  if(argv[0]==='pack'){
    need(argv.length===4||argv.length===5,'Usage: pack SOURCE_FILE CARRIER.json SELECTION.json [MAX_CARRIER_BYTES]');
    result=packSourceFile(argv[1],argv[2],argv[3],argv.length===5?Number(argv[4]):undefined);
  }else if(argv[0]==='unpack'){
    need(argv.length===4,'Usage: unpack CARRIER.json SELECTION.json OUTPUT_SOURCE');
    result=receiveSourceFile(argv[1],argv[2],argv[3]);
  }else{
    need(argv.length===3,'Usage: node host/connected_mime_attachment_native.cjs RAW_RESPONSE.json SELECTION.json OUTPUT_FILE; or pack/unpack');
    result=receiveRawFile(...argv);
  }
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
module.exports={receiveRawFile,packSourceFile,receiveSourceFile,main};
if(require.main===module){try{main(process.argv.slice(2));}catch(error){process.stderr.write('Attachment/source receive failed: '+error.message+'\n');process.exitCode=1;}}
