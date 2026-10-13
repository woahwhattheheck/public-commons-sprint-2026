import { existsSync, readFileSync, createReadStream, statSync, openSync, closeSync, readSync, copyFileSync, mkdirSync, renameSync, unlinkSync, fsyncSync, constants } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { atomicBytes, digest, requireValue, sha, fsyncDirectory } from './common.mjs';
export function hashFile(path){
  const fd=openSync(path,'r'),buffer=Buffer.alloc(1024*1024),h=createHash('sha256');let bytes=0;
  try{for(;;){const n=readSync(fd,buffer,0,buffer.length,null);if(!n)break;h.update(buffer.subarray(0,n));bytes+=n;}}finally{closeSync(fd);}
  return {sha256:h.digest('hex'),bytes};
}
export class ObjectStore {
  constructor(directory){this.directory=directory;}
  path(hash){digest(hash);return join(this.directory,hash.slice(0,2),hash);}
  put(bytes){const body=Buffer.from(bytes),hash=sha(body),path=this.path(hash);atomicBytes(path,body,{immutable:true});return {sha256:hash,bytes:body.length};}
  putFile(source,expected){
    const selected=hashFile(source);if(expected)requireValue(selected.sha256===expected.sha256&&selected.bytes===expected.bytes,'OBJECT_IDENTITY_CHANGED','The original source file did not match its selected bytes.',409);
    const target=this.path(selected.sha256);
    if(existsSync(target)){this.verify(selected.sha256,selected.bytes);return selected;}
    mkdirSync(dirname(target),{recursive:true,mode:0o700});const temp=target+'.pending-'+randomUUID();
    try{copyFileSync(source,temp,constants.COPYFILE_EXCL);const copy=hashFile(temp);requireValue(copy.sha256===selected.sha256&&copy.bytes===selected.bytes,'OBJECT_COPY_CHANGED','Source bytes changed while retaining their object.',409);const fd=openSync(temp,'r');try{fsyncSync(fd);}finally{closeSync(fd);}renameSync(temp,target);fsyncDirectory(dirname(target));}
    catch(error){try{unlinkSync(temp);}catch{}throw error;}return selected;
  }
  verify(hash,expectedBytes){const observed=hashFile(this.path(hash));requireValue(observed.sha256===hash&&(expectedBytes===undefined||observed.bytes===expectedBytes),'OBJECT_IDENTITY_CHANGED','The retained original object failed its byte identity.',409,{sha256:hash});return observed;}
  read(hash,expectedBytes){const body=readFileSync(this.path(hash));requireValue(sha(body)===hash&&(expectedBytes===undefined||body.length===expectedBytes),'OBJECT_IDENTITY_CHANGED','The retained original object failed its byte identity.',409,{sha256:hash});return body;}
  describe(hash){const p=this.path(hash);requireValue(existsSync(p),'OBJECT_MISSING','The selected retained object is missing.',409,{sha256:hash});return {sha256:hash,bytes:statSync(p).size};}
  stream(hash,expectedBytes){this.verify(hash,expectedBytes);return createReadStream(this.path(hash));}
}
