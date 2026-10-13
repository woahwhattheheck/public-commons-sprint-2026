#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {gunzipSync} from 'node:zlib';

const hash=b=>createHash('sha256').update(b).digest('hex');
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const root=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2);
assert(args.length===2&&args[0]==='--output'&&args[1], 'Usage: node materialize-output.mjs --output NEW_OUTPUT');
const [major,minor]=process.versions.node.split('.').map(Number);
assert(major>22||(major===22&&minor>=16),'Node 22.16 or later is required');
const out=path.resolve(args[1]),sourceRoot=fs.realpathSync(root);
const nested=(a,b)=>{const r=path.relative(a,b);return r===''||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));};
assert(!nested(sourceRoot,out)&&!nested(out,sourceRoot),'Source and output directories must be disjoint');
function ordinaryAncestors(target){
  let cursor=path.parse(target).root;
  for(const component of path.relative(cursor,target).split(path.sep).filter(Boolean)){
    cursor=path.join(cursor,component);
    if(fs.existsSync(cursor)){const stat=fs.lstatSync(cursor);assert(stat.isDirectory()&&!stat.isSymbolicLink(),'Directory ancestor is not ordinary: '+cursor);}
  }
}
ordinaryAncestors(out);
function name(value){assert(typeof value==='string'&&value.length>0&&value!=='.'&&value!=='..'&&!/[\\/\0]/.test(value),'Unsafe member path');return value;}
function verified(bytes,pin,label){assert(bytes.length===pin.bytes&&hash(bytes)===pin.sha256,'Byte/hash mismatch: '+label);return bytes;}
function syncDirectory(directory){const fd=fs.openSync(directory,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function same(file,body){const before=fs.lstatSync(file);assert(before.isFile()&&!before.isSymbolicLink(),'Existing output is not an ordinary file: '+file);const actual=fs.readFileSync(file);assert(actual.length===body.length&&hash(actual)===hash(body),'Existing output differs: '+file);}
function publish(file,body){
  const parent=path.dirname(file),temporary=path.join(parent,'.'+path.basename(file)+'.'+randomUUID()+'.partial');
  let fd,primary;
  try{
    fd=fs.openSync(temporary,'wx',0o600);
    fs.writeFileSync(fd,body);fs.fsyncSync(fd);
    const closing=fd;fd=undefined;fs.closeSync(closing);
    try{fs.linkSync(temporary,file);}catch(error){if(error.code!=='EEXIST')throw error;same(file,body);}
    syncDirectory(parent);
  }catch(error){primary=error;throw error;}
  finally{
    let cleanup;
    if(fd!==undefined)try{fs.closeSync(fd);}catch(error){cleanup=error;}
    try{fs.unlinkSync(temporary);syncDirectory(parent);}catch(error){if(error.code!=='ENOENT')cleanup=cleanup||error;}
    if(cleanup){if(primary){try{Object.defineProperty(primary,'cleanupError',{value:cleanup});}catch{}}else throw cleanup;}
  }
}
const manifest=JSON.parse(fs.readFileSync(path.join(root,'output-bank.json'),'utf8'));
assert(manifest.schema==='commons.ordered-gzip-base64-file/v1'&&Array.isArray(manifest.parts)&&manifest.parts.length>0,'Unexpected source manifest');
const seenParts=new Set(),chunks=[];
for(const part of manifest.parts){name(part.path);assert(!seenParts.has(part.path),'Repeated source part');seenParts.add(part.path);chunks.push(verified(fs.readFileSync(path.join(root,part.path)),part,part.path).toString('utf8'));}
const encoded=chunks.join('');
assert(encoded.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(encoded),'Malformed base64 carrier');
const compressed=Buffer.from(encoded,'base64');
assert(compressed.toString('base64')===encoded,'Noncanonical base64 carrier');
verified(compressed,{bytes:manifest.compressed_bytes,sha256:manifest.compressed_sha256},'compressed carrier');
assert(Number.isSafeInteger(manifest.bytes)&&manifest.bytes>0,'Invalid decoded size');
const decoded=gunzipSync(compressed,{maxOutputLength:manifest.bytes+1});
verified(decoded,manifest,'complete source bank');
const bank=JSON.parse(decoded.toString('utf8'));
assert(bank.schema==='commons.source-bank/v1'&&bank.study_id===manifest.study_id&&bank.result_id===manifest.result_id,'Wrong study or calculation');
assert(Array.isArray(bank.files)&&Array.isArray(manifest.files)&&bank.files.length===manifest.files.length,'Incomplete output roster');
const pins=new Map(manifest.files.map(pin=>[name(pin.path),pin]));
assert(pins.size===manifest.files.length,'Repeated output descriptor');
const files=[],seen=new Set();
for(const member of bank.files){
  name(member.path);assert(!['manifest.json','receiving-identity.json'].includes(member.path),'Reserved receiver output path');assert(!seen.has(member.path)&&pins.has(member.path)&&typeof member.content==='string','Unexpected output member');
  seen.add(member.path);
  const body=Buffer.from(member.content,'utf8');
  verified(body,member,member.path);verified(body,pins.get(member.path),member.path);
  files.push([member.path,body]);
}
const identity=Buffer.from(JSON.stringify({schema:'commons.scientific-output-receiving/v1',source_sha256:manifest.sha256,study_id:manifest.study_id,result_id:manifest.result_id,output:out},null,2)+'\n');
const identityPath=path.join(out,'receiving-identity.json');
if(fs.existsSync(out)){
  if(fs.existsSync(identityPath))same(identityPath,identity);
  else assert(fs.readdirSync(out).length===0,'Nonempty output has no matching receiving identity');
}
fs.mkdirSync(out,{recursive:true});
ordinaryAncestors(out);
assert(fs.realpathSync(out)===out,'Output real path differs from selected directory');
publish(identityPath,identity);
for(const [filename,body]of files)publish(path.join(out,filename),body);
const receipt=Buffer.from(JSON.stringify({schema:'commons.materialized-scientific-output/v1',source_sha256:manifest.sha256,study_id:manifest.study_id,result_id:manifest.result_id,files:manifest.files},null,2)+'\n');
publish(path.join(out,'manifest.json'),receipt);
console.log(JSON.stringify({output:out,files:files.length,study_id:manifest.study_id,result_id:manifest.result_id,source_sha256:manifest.sha256}));
