// MIT. Lossless private storage for original Grants.gov capture packets.
import { open, lstat, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { acquireWorkspace, privateDirectory, readPrivate, readJson, syncDirectory,
  bytes, digest, fault, object, absolute } from '../postgres/publisher/files.mjs';
import { inspectCaptureExport } from './capture.mjs';

export const CAPTURE_STORAGE_SCHEMA='stellar-forge.grantsgov-capture-storage.v1';
export const CAPTURE_STORAGE_LIMITS=Object.freeze({
  decodedBytes:256*1024*1024,storedBytes:256*1024*1024,descriptorBytes:65536,
});
const zip=promisify(gzip),unzip=promisify(gunzip),HASH=/^[a-f0-9]{64}$/;
const utf8=new TextDecoder('utf-8',{fatal:true});
const fields=['schema','encoding','file','captureId','sourceSignature','packetSha256',
  'storedBytes','storedSha256','decodedBytes','decodedSha256'];
const check=(value,code,message=code)=>{if(!value)throw fault(code,message,409);};
function packetKey(value){
  check(HASH.test(value??''),'CAPTURE_STORAGE_ID','Use the original capture packet SHA-256.');
  return value;
}
function memberPath(value){
  check(typeof value==='string'&&value.length<=1024&&!/[\x00-\x1f\x7f\\]/.test(value)&&
    !value.startsWith('/')&&value.split('/').every(part=>part&&part!=='.'&&part!=='..'),
    'CAPTURE_STORAGE_PATH','Use the retained relative capture member.');
  return value;
}
function descriptor(value){
  check(object(value)&&Object.keys(value).every(key=>fields.includes(key))&&
    fields.every(key=>Object.hasOwn(value,key))&&value.schema===CAPTURE_STORAGE_SCHEMA&&
    ['gzip','identity'].includes(value.encoding)&&typeof value.captureId==='string'&&
    value.captureId.length>0&&value.captureId.length<=160&&
    (value.sourceSignature===null||HASH.test(value.sourceSignature??''))&&
    HASH.test(value.packetSha256??'')&&HASH.test(value.storedSha256??'')&&
    HASH.test(value.decodedSha256??'')&&Number.isSafeInteger(value.storedBytes)&&
    value.storedBytes>0&&value.storedBytes<=CAPTURE_STORAGE_LIMITS.storedBytes&&
    Number.isSafeInteger(value.decodedBytes)&&value.decodedBytes>0&&
    value.decodedBytes<=CAPTURE_STORAGE_LIMITS.decodedBytes,'CAPTURE_STORAGE_DESCRIPTOR');
  memberPath(value.file);
  if(value.encoding==='identity')check(value.storedBytes===value.decodedBytes&&
    value.storedSha256===value.decodedSha256,'CAPTURE_STORAGE_IDENTITY_DESCRIPTOR');
  return {...value};
}
async function absent(path){
  try{await lstat(path);return false;}catch(error){if(error.code==='ENOENT')return true;throw error;}
}
function observeDecoded(raw,expectedPacketSha256){
  check(Buffer.isBuffer(raw)&&raw.length>0&&raw.length<=CAPTURE_STORAGE_LIMITS.decodedBytes,
    'CAPTURE_STORAGE_DECODE_LIMIT');
  let packet;
  try{packet=JSON.parse(utf8.decode(raw));}catch{throw fault('CAPTURE_STORAGE_JSON','The decoded original packet is not valid UTF-8 JSON.');}
  const original=inspectCaptureExport(packet);
  if(expectedPacketSha256!==undefined)check(packet.sha256===packetKey(expectedPacketSha256),
    'CAPTURE_STORAGE_PACKET_CHANGED','The retained storage belongs to another original packet.');
  return {packet,captureId:original.manifest.captureId,sourceSignature:original.manifest.sourceSignature};
}
function observedDescriptor(body,raw,encoding,file,observed){
  return descriptor({schema:CAPTURE_STORAGE_SCHEMA,encoding,file:memberPath(file),
    captureId:observed.captureId,sourceSignature:observed.sourceSignature,
    packetSha256:observed.packet.sha256,storedBytes:body.length,storedSha256:digest(body),
    decodedBytes:raw.length,decodedSha256:digest(raw)});
}
/** Gzip has a zero timestamp and platform-neutral header; the saved descriptor
 * retains the actual encoded bytes across future compressor versions. */
export async function encodeCapturePacket(packet,{file,originalBytes}={}){
  inspectCaptureExport(packet);
  check(originalBytes===undefined||Buffer.isBuffer(originalBytes),'CAPTURE_STORAGE_ORIGINAL_BYTES');
  const raw=originalBytes===undefined?bytes(packet):Buffer.from(originalBytes);
  check(raw.length<=CAPTURE_STORAGE_LIMITS.decodedBytes,'CAPTURE_STORAGE_DECODE_LIMIT');
  if(originalBytes!==undefined)observeDecoded(raw,packet.sha256);
  const packed=await zip(raw,{level:6,mtime:0});
  check(packed.length>=18&&packed[0]===31&&packed[1]===139&&packed[2]===8&&packed[3]===0,
    'CAPTURE_STORAGE_GZIP_HEADER');
  packed.fill(0,4,8);packed[9]=255;
  const encoding=packed.length<raw.length?'gzip':'identity',body=encoding==='gzip'?packed:raw;
  const observed={packet,captureId:packet.captureId,sourceSignature:packet.sourceSignature};
  const saved=observedDescriptor(body,raw,encoding,file??'capture.json'+(encoding==='gzip'?'.gz':''),observed);
  return {descriptor:saved,body};
}
/** Length/hash checks bind both byte layers before the original source validator
 * checks all requests, pages, detail records, cursors and retained identity. */
export async function decodeCapturePacket(body,inputDescriptor){
  const saved=descriptor(inputDescriptor);
  check(Buffer.isBuffer(body)&&body.length===saved.storedBytes&&digest(body)===saved.storedSha256,
    'CAPTURE_STORAGE_BYTES_CHANGED','The stored capture bytes differ from their descriptor.');
  let raw;
  try{raw=saved.encoding==='gzip'?await unzip(body,{maxOutputLength:saved.decodedBytes}):body;}
  catch(error){throw fault('CAPTURE_STORAGE_DECODE','The compressed capture is incomplete, invalid or exceeds its declared decoded length.');}
  check(raw.length===saved.decodedBytes&&digest(raw)===saved.decodedSha256,
    'CAPTURE_STORAGE_DECODED_CHANGED','The decoded original capture differs from its descriptor.');
  const observed=observeDecoded(raw,saved.packetSha256);
  check(observed.captureId===saved.captureId&&observed.sourceSignature===saved.sourceSignature,
    'CAPTURE_STORAGE_SOURCE_CHANGED','Storage metadata does not match the original capture.');
  return {packet:observed.packet,descriptor:saved,decodedBytes:raw};
}
async function atomicFile(directory,name,body){
  const temporary=join(directory,'capture-storage-'+randomUUID()+'.tmp');let owned=false;
  try{
    const file=await open(temporary,'wx',0o600);owned=true;
    try{await file.writeFile(body);await file.sync();}finally{await file.close();}
    await rename(temporary,join(directory,name));owned=false;await syncDirectory(directory);
  }finally{if(owned)await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
/** Returns the original packet and its actual retained body. Legacy JSON remains
 * its own first stored representation; reading does not rewrite it. */
export async function readStoredCapture(directory,packetSha256){
  directory=absolute(directory,'capture storage directory');packetKey(packetSha256);
  await privateDirectory(directory);
  const indexName=packetSha256+'.storage.json',indexPath=join(directory,indexName);
  if(!await absent(indexPath)){
    const saved=descriptor(await readJson(indexPath,CAPTURE_STORAGE_LIMITS.descriptorBytes));
    check(saved.packetSha256===packetSha256&&saved.file===packetSha256+'.json'+
      (saved.encoding==='gzip'?'.gz':''),'CAPTURE_STORAGE_FILE_BINDING');
    const body=await readPrivate(join(directory,saved.file),CAPTURE_STORAGE_LIMITS.storedBytes);
    const decoded=await decodeCapturePacket(body,saved);
    return {...decoded,body,legacy:false,indexFile:indexName};
  }
  const file=packetSha256+'.json',body=await readPrivate(join(directory,file),CAPTURE_STORAGE_LIMITS.decodedBytes);
  const observed=observeDecoded(body,packetSha256),saved=observedDescriptor(body,body,'identity',file,observed);
  return {packet:observed.packet,descriptor:saved,decodedBytes:body,body,legacy:true,indexFile:null};
}
/** The original private-file/kernel-lock helpers serialize first retention.
 * A complete body is committed before its descriptor; replay reuses either the
 * first indexed representation or a validated body left before index commit. */
export async function retainCapturePacket(directory,packet){
  directory=absolute(directory,'capture storage directory');inspectCaptureExport(packet);
  const id=packetKey(packet.sha256);await privateDirectory(directory,true);
  const release=await acquireWorkspace(directory);
  try{
    const index=join(directory,id+'.storage.json'),legacy=join(directory,id+'.json');
    if(!await absent(index)||!await absent(legacy)){
      const saved=await readStoredCapture(directory,id);
      check(saved.packet.captureId===packet.captureId&&saved.packet.sourceSignature===packet.sourceSignature,
        'CAPTURE_STORAGE_SOURCE_CHANGED');
      return {descriptor:saved.descriptor,legacy:saved.legacy,reused:true};
    }
    const recoveredFile=id+'.json.gz';let saved,file;
    if(!await absent(join(directory,recoveredFile))){
      const body=await readPrivate(join(directory,recoveredFile),CAPTURE_STORAGE_LIMITS.storedBytes);
      let raw;
      try{raw=await unzip(body,{maxOutputLength:CAPTURE_STORAGE_LIMITS.decodedBytes});}
      catch{throw fault('CAPTURE_STORAGE_UNCOMMITTED_BODY','The retained original body cannot be recovered.');}
      const observed=observeDecoded(raw,id);file=recoveredFile;
      saved={body,descriptor:observedDescriptor(body,raw,'gzip',file,observed)};
    }else{
      saved=await encodeCapturePacket(packet);file=id+'.json'+(saved.descriptor.encoding==='gzip'?'.gz':'');
      saved.descriptor={...saved.descriptor,file};
      await atomicFile(directory,file,saved.body);
    }
    await atomicFile(directory,id+'.storage.json',bytes(saved.descriptor));
    return {descriptor:saved.descriptor,legacy:false,reused:false};
  }finally{await release();}
}
/** Supplies the exact stored member to the existing sourceFiles publisher ABI.
 * Descriptor hashes describe the actual transported bytes; decoded hashes
 * describe the unchanged capture packet carried by those bytes. */
export async function captureMerchantMember(directory,packetSha256){
  const retained=await readStoredCapture(directory,packetSha256);
  const saved=retained.descriptor.encoding==='gzip'?retained:
    await encodeCapturePacket(retained.packet,{originalBytes:retained.decodedBytes});
  const file='source/capture.json'+(saved.descriptor.encoding==='gzip'?'.gz':'');
  return {path:file,body:saved.body,descriptor:{...saved.descriptor,file}};
}
/** Opens a received native merchant package, including original uncompressed
 * packages. It verifies the declared member before decoding the original packet. */
export async function readMerchantCapture(directory){
  directory=absolute(directory,'merchant package directory');await privateDirectory(directory);
  await privateDirectory(join(directory,'source'));
  const source=await readJson(join(directory,'source.json'),2*1024*1024);
  check(object(source)&&Array.isArray(source.sourceFiles),'CAPTURE_STORAGE_SOURCE_MANIFEST');
  let saved,body;
  if(source.captureStorage!==undefined){
    saved=descriptor(source.captureStorage);
    check(saved.file==='source/capture.json'+(saved.encoding==='gzip'?'.gz':''),
      'CAPTURE_STORAGE_MERCHANT_MEMBER');
    body=await readPrivate(join(directory,saved.file),CAPTURE_STORAGE_LIMITS.storedBytes);
  }else{
    const file='source/capture.json';body=await readPrivate(join(directory,file),CAPTURE_STORAGE_LIMITS.decodedBytes);
    const observed=observeDecoded(body);saved=observedDescriptor(body,body,'identity',file,observed);
  }
  const members=source.sourceFiles.filter(value=>value?.path===saved.file);
  check(members.length===1&&members[0].bytes===saved.storedBytes&&members[0].sha256===saved.storedSha256,
    'CAPTURE_STORAGE_MANIFEST_CHANGED','The native source manifest does not bind this capture member.');
  const decoded=await decodeCapturePacket(body,saved);
  check(source.sourceSignature===decoded.packet.sourceSignature,'CAPTURE_STORAGE_MERCHANT_SOURCE');
  return {...decoded,legacy:source.captureStorage===undefined,source};
}
