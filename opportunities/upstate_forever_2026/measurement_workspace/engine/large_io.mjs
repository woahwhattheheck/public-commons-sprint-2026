/** Disk-backed primitives shared by the Measurements large-file workflow. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {InputError} from './parse.mjs';
import {DatabaseSync} from 'node:sqlite';
export const CHUNK=256*1024;
export const identifier=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export const sha=data=>createHash('sha256').update(data).digest('hex');
export const json=value=>JSON.stringify(value,null,2)+'\n';
export function safePath(name){
  if(typeof name!=='string'||!name||name.includes('\\')||name.includes('\0')||path.posix.isAbsolute(name)||name.split('/').some(x=>!x||x==='.'||x==='..'))throw new InputError('Invalid retained file path');
  return name;
}
export function writeAll(fd,buffer){
  let offset=0;while(offset<buffer.length){const n=fs.writeSync(fd,buffer,offset,buffer.length-offset);if(!n)throw new Error('File write made no progress');offset+=n;}
}
export function atomicJSON(file,value){
  fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.pending';let fd;
  try{fd=fs.openSync(temp,'wx',0o600);writeAll(fd,Buffer.from(json(value)));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temp,file);}
  finally{if(fd!==undefined)fs.closeSync(fd);fs.rmSync(temp,{force:true});}
}
export function readJSON(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
export function* fileChunks(file,chunkSize=CHUNK){
  const fd=fs.openSync(file,'r');try{const buffer=Buffer.allocUnsafe(chunkSize);let size;while((size=fs.readSync(fd,buffer,0,buffer.length,null)))yield Buffer.from(buffer.subarray(0,size));}finally{fs.closeSync(fd);}
}
export function fileDigest(file){const digest=createHash('sha256');let bytes=0;for(const b of fileChunks(file)){digest.update(b);bytes+=b.length;}return {bytes,sha256:digest.digest('hex')};}
export function copyVerified(source,target,expected){
  fs.mkdirSync(path.dirname(target),{recursive:true});
  if(fs.existsSync(target)){if(fs.lstatSync(target).isSymbolicLink())throw new InputError('Retained destination cannot be a symlink');const actual=fileDigest(target);if(actual.sha256===expected.sha256&&actual.bytes===expected.bytes)return;throw new InputError('Existing retained file differs: '+path.basename(target),409);}
  const temp=target+'.'+randomUUID()+'.pending';let fd;
  try{fd=fs.openSync(temp,'wx',0o600);const digest=createHash('sha256');let bytes=0;for(const b of fileChunks(source)){writeAll(fd,b);digest.update(b);bytes+=b.length;}
    if(bytes!==expected.bytes||digest.digest('hex')!==expected.sha256)throw new InputError('Original file changed during copying',409);
    fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
    // link is create-only, unlike rename which could replace a concurrent writer.
    try{fs.linkSync(temp,target);}catch(error){if(error.code!=='EEXIST')throw error;const actual=fileDigest(target);if(actual.sha256!==expected.sha256||actual.bytes!==expected.bytes)throw new InputError('Concurrent retained file differs',409);}
  }finally{if(fd!==undefined)fs.closeSync(fd);fs.rmSync(temp,{force:true});}
}
/** A separate SQLite lock survives awaits and is released by process death. */
export function withDirectoryLock(directory,operation){
  fs.mkdirSync(directory,{recursive:true});
  const db=new DatabaseSync(path.join(directory,'operation.lock.sqlite'));
  const release=()=>{try{db.exec('ROLLBACK');}finally{db.close();}};
  try{db.exec('PRAGMA busy_timeout=100; BEGIN IMMEDIATE');}
  catch(error){db.close();if(/locked|busy/i.test(error.message))throw new InputError('This operation is already running; reopen its same identifier',409);throw error;}
  let result;try{result=operation();}catch(error){release();throw error;}
  if(result&&typeof result.then==='function')return result.finally(release);
  release();return result;
}
export function listFiles(root,{exclude=new Set()}={}){
  const rows=[];function visit(relative){for(const entry of fs.readdirSync(path.join(root,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const name=relative?relative+'/'+entry.name:entry.name;if(exclude.has(name))continue;
    const stat=fs.lstatSync(path.join(root,name));if(stat.isSymbolicLink()||(!stat.isDirectory()&&!stat.isFile()))throw new InputError('Portable sources must be regular files: '+name);
    if(stat.isDirectory())visit(name);else rows.push({path:name,...fileDigest(path.join(root,name))});}}
  visit('');return rows;
}
