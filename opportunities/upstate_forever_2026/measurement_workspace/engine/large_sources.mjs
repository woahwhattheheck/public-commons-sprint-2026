/** Complete ordinary source files and rejection populations from the native store. */
import fs from 'node:fs';
import path from 'node:path';
import {hash,stable} from './normalise.mjs';
import {InputError} from './parse.mjs';
import {sourceChunks} from './large_intake.mjs';
import {CHUNK,identifier,fileChunks,fileDigest,atomicJSON,readJSON,writeAll,withDirectoryLock,safePath} from './large_io.mjs';

export function fileDescription(file,name=path.basename(file)){
 const chunks=[];for(const block of fileChunks(file))chunks.push(hash(block));
 return {path:name,...fileDigest(file),chunks};
}
export function sourceList(w){return [...w.db.prepare('SELECT id,kind,label,sha,summary FROM imports ORDER BY created_at DESC,id').iterate()].map(row=>({...row,summary:JSON.parse(row.summary)}));}
function ensureId(id){if(!identifier(id))throw new InputError('Invalid original source identifier');}
function originalRoot(w,id){ensureId(id);return path.join(w.directory,'.large','sources',id);}
/** The optional destination is a captured native workspace, not an alternate store. */
export function sourceFiles(w,id,destination){
 const root=destination?path.join(destination,id):originalRoot(w,id);ensureId(id);
 return withDirectoryLock(root,()=>{
  const info=path.join(root,'files.json');
  if(fs.existsSync(info))return readJSON(info);
  const source=w.db.prepare('SELECT id,kind,label,created_at,sha,origin,mapping,summary FROM imports WHERE id=?').get(id);
  if(!source)throw new InputError('Original source not found',404);
  const name=source.kind==='usgs-daily'?'original.geojson':'original.csv';
  const build=path.join(root,'building');fs.rmSync(build,{recursive:true,force:true});fs.mkdirSync(build,{recursive:true});
  const fd=fs.openSync(path.join(build,name),'wx',0o600);
  try{for(const block of sourceChunks(w,source))writeAll(fd,block);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  if(fileDigest(path.join(build,name)).sha256!==source.sha)throw new InputError('Stored original checksum differs');
  const rejectedFile=path.join(build,'rejections.jsonl'),rejected=fs.openSync(rejectedFile,'wx',0o600);let rejectedCount=0;
  try{
   const supported=w.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='source_chunks'").get();
   const chunked=supported&&w.db.prepare('SELECT 1 FROM source_chunks WHERE import_id=? LIMIT 1').get(id);
   const rows=chunked?w.db.prepare('SELECT data FROM source_rejections WHERE import_id=? ORDER BY category,sequence').iterate(id):JSON.parse(w.db.prepare('SELECT rejected FROM imports WHERE id=?').get(id).rejected).map(data=>({data:stable(data)}));
   for(const row of rows){writeAll(rejected,Buffer.from(row.data+'\n'));rejectedCount++;}fs.fsyncSync(rejected);
  }finally{fs.closeSync(rejected);}
  const metadata={format:'upper-savannah-original-measurement-source/v1',id:source.id,kind:source.kind,label:source.label,createdAt:source.created_at,sha256:source.sha,origin:JSON.parse(source.origin),mapping:JSON.parse(source.mapping),summary:JSON.parse(source.summary)};
  if(metadata.summary.rejectedCount!==rejectedCount)throw new InputError('Stored source rejection count differs');
  atomicJSON(path.join(build,'source.json'),metadata);
  const files=[name,'rejections.jsonl','source.json'].map(name=>fileDescription(path.join(build,name),name));
  const value={format:'upper-savannah-original-source-files/v1',id,label:source.label,sourceSha256:source.sha,kind:source.kind,rejectedCount,files,chunkBytes:CHUNK};
  // Each file is only promoted after all original members have been produced.
  for(const member of files){const file=path.join(root,member.path);if(fs.existsSync(file)){
    const actual=fileDigest(file);if(actual.sha256!==member.sha256||actual.bytes!==member.bytes)throw new InputError('Retained source file differs',409);
   }else fs.linkSync(path.join(build,member.path),file);}
  atomicJSON(info,value);fs.rmSync(build,{recursive:true,force:true});return value;
 });
}
export function sourceFileChunk(w,id,name,index){
 const value=sourceFiles(w,id),member=value.files.find(file=>file.path===name);
 if(!member||!Number.isSafeInteger(index)||index<0||index>=member.chunks.length)throw new InputError('Original source chunk not found',404);
 const file=path.join(originalRoot(w,id),safePath(name)),fd=fs.openSync(file,'r'),data=Buffer.alloc(Math.min(CHUNK,member.bytes-index*CHUNK));let size;
 try{size=fs.readSync(fd,data,0,data.length,index*CHUNK);}finally{fs.closeSync(fd);}
 if(size!==data.length||hash(data)!==member.chunks[index])throw new InputError('Retained original source file changed',409);
 return {id,name,index,bytes:size,sha256:member.chunks[index],base64:data.toString('base64')};
}
export function materializeOriginals(w,directory){
 const originals=path.join(directory,'original-source-files');
 for(const source of w.db.prepare('SELECT id FROM imports ORDER BY id').iterate()){
  sourceFiles(w,source.id,originals);
  // Locks are process-local coordination, not part of the user's source delivery.
  for(const suffix of ['','-journal','-wal','-shm'])fs.rmSync(path.join(originals,source.id,'operation.lock.sqlite'+suffix),{force:true});
 }
}
