// MIT. Manifest-bound POSIX tar/PAX delivery with streamed gzip and source hashes.
// Format: https://www.gnu.org/software/tar/manual/html_node/Standard.html
// PAX records: https://pubs.opengroup.org/onlinepubs/9799919799/utilities/pax.html
import {promises as fs, constants as FS} from 'node:fs';
import {dirname, join, resolve, isAbsolute} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {createGzip, createGunzip} from 'node:zlib';
import {readPollarDeliveryManifest} from './receiving.mjs';
import {withLock} from './common.mjs';

const BLOCK = 512;
const CHUNK = 65536;
const MAX_MANIFEST_BYTES = 33554432;
const MAX_PAX_BYTES = 16384;
const MAX_PATH_BYTES = 4096;
const MAX_FILES = 100000;
const MAX_TRAILING_PADDING = 1048576;
const MAX_OCTAL_SIZE = 8589934591;
const ZERO = Buffer.alloc(BLOCK);
const decoder = new TextDecoder('utf-8', {fatal:true});
export const pollarArchiveFormat = Object.freeze({
  schema:'stellar-forge.pollar-partner.archive-format.v1',
  contentType:'application/gzip', extension:'.tar.gz', manifest:'manifest.json',
  format:'POSIX ustar with local PAX path and size records',
  maximumManifestBytes:MAX_MANIFEST_BYTES, maximumFiles:MAX_FILES
});
export class PollarArchiveError extends Error {
  constructor(code, message, details={}) { super(message); this.name='PollarArchiveError'; this.code=code; this.details=details; }
}
function requireValue(ok, code, message, details={}) {
  if (!ok) throw new PollarArchiveError(code,message,details);
}
function interrupted(signal) {
  if (signal?.aborted) throw new PollarArchiveError('ARCHIVE_INTERRUPTED','The complete delivery transfer was interrupted.');
}
function validHash(value) {
  requireValue(typeof value==='string' && /^[a-f0-9]{64}$/.test(value),'INVALID_MANIFEST_HASH','Select the original lowercase SHA256 manifest hash.');
  return value;
}
function nonnegative(value, label) {
  requireValue(Number.isSafeInteger(value) && value>=0,'INVALID_ARCHIVE_METADATA',label+' must be a nonnegative safe integer.');
  return value;
}
function mode(value) {
  requireValue(Number.isInteger(value) && value>=0 && value<=0o777,'INVALID_ARCHIVE_MODE','The original file mode must contain only permission bits.');
  return value;
}
function relativePath(value) {
  requireValue(typeof value==='string' && value.length>0 && !value.includes('\0') && !value.includes('\\') &&
    !value.startsWith('/') && !/^[A-Za-z]:/.test(value),'INVALID_ARCHIVE_PATH','Use an original relative POSIX file path.');
  const encoded=Buffer.from(value,'utf8');
  requireValue(encoded.length<=MAX_PATH_BYTES && encoded.toString('utf8')===value,'INVALID_ARCHIVE_PATH','The original archive path must be bounded valid UTF-8.');
  requireValue(value.split('/').every(part=>part!=='' && part!=='.' && part!=='..'),
    'INVALID_ARCHIVE_PATH','Archive paths cannot traverse or repeat directory separators.',{path:value});
  return value;
}
function absolutePath(value) {
  requireValue(typeof value==='string' && isAbsolute(value) && resolve(value)===value,
    'INVALID_ARCHIVE_DIRECTORY','Select an absolute normalized archive directory.');
  return value;
}
async function existing(path) {
  try { return await fs.lstat(path); } catch(error) { if(error.code==='ENOENT')return null; throw error; }
}
async function realDirectory(directory) {
  absolutePath(directory);
  const stat=await fs.lstat(directory);
  requireValue(stat.isDirectory() && !stat.isSymbolicLink() && await fs.realpath(directory)===directory,
    'INVALID_ARCHIVE_DIRECTORY','Select a real directory without symbolic path components.');
  return directory;
}
async function prepareParent(directory) {
  absolutePath(directory);
  let current='/';
  for(const part of directory.split('/').filter(Boolean)) {
    current=join(current,part);
    try{await fs.mkdir(current,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
    const stat=await fs.lstat(current);
    requireValue(stat.isDirectory() && !stat.isSymbolicLink() && await fs.realpath(current)===current,
      'INVALID_ARCHIVE_DIRECTORY','A receiving parent contains a symbolic link or conflicting file.');
  }
  return directory;
}
async function readOnlyFile(directory,path) {
  relativePath(path);
  const target=join(directory,path);
  requireValue(await fs.realpath(dirname(target))===dirname(target),'INVALID_ARCHIVE_PATH','A source file directory contains a symbolic link.',{path});
  const handle=await fs.open(target,FS.O_RDONLY | (FS.O_NOFOLLOW??0));
  try {
    const stat=await handle.stat();
    requireValue(stat.isFile(),'INVALID_ARCHIVE_FILE','A declared source must be a regular file.',{path});
    const named=await fs.lstat(target);
    requireValue(!named.isSymbolicLink() && named.dev===stat.dev && named.ino===stat.ino,
      'SOURCE_CHANGED','The selected original source file changed while it was opened.',{path});
    return {handle,stat};
  } catch(error) { await handle.close(); throw error; }
}
function metadata(original) {
  const {manifest,manifestSha256}=original;
  validHash(manifestSha256);
  requireValue(Buffer.isBuffer(original.bytes) && original.bytes.length>0 && original.bytes.length<=MAX_MANIFEST_BYTES,
    'ARCHIVE_MANIFEST_TOO_LARGE','The original delivery manifest exceeds the supported metadata bound.');
  requireValue(Array.isArray(manifest.files) && manifest.files.length>0 && manifest.files.length<=MAX_FILES,
    'ARCHIVE_FILE_LIMIT','The complete delivery file list exceeds the supported metadata bound.');
  const entries=new Map(), directories=new Set(); let bytes=0;
  for(const item of manifest.files) {
    relativePath(item.path); nonnegative(item.bytes,'file bytes'); validHash(item.sha256);
    if(item.mode!==undefined)mode(item.mode);
    requireValue(item.path!=='manifest.json' && !entries.has(item.path),'DUPLICATE_ARCHIVE_ENTRY','Each original file must be declared exactly once.',{path:item.path});
    entries.set(item.path,item);
    bytes+=item.bytes;
    requireValue(Number.isSafeInteger(bytes),'ARCHIVE_SIZE_LIMIT','The complete source byte count exceeds safe integer addressing.');
    const parts=item.path.split('/');
    for(let i=1;i<parts.length;i++)directories.add(parts.slice(0,i).join('/'));
  }
  const ordered=['manifest.json',...entries.keys()].sort();
  for(let i=1;i<ordered.length;i++)requireValue(!ordered[i].startsWith(ordered[i-1]+'/'),
    'INVALID_ARCHIVE_PATH','A declared file cannot also contain other files.',{path:ordered[i]});
  return {original,manifest,manifestSha256,entries,directories,bytes};
}
async function deliveryMetadata(directory,expectedManifestSha256) {
  await realDirectory(directory);
  if(expectedManifestSha256!==undefined)validHash(expectedManifestSha256);
  const selected=await readOnlyFile(directory,'manifest.json');
  try {
    requireValue(selected.stat.size>0 && selected.stat.size<=MAX_MANIFEST_BYTES,
      'ARCHIVE_MANIFEST_TOO_LARGE','The original delivery manifest exceeds the supported metadata bound.');
  } finally { await selected.handle.close(); }
  return metadata(await readPollarDeliveryManifest({sourceDirectory:directory,expectedManifestSha256}));
}
function sameFile(a,b) {
  return a.dev===b.dev && a.ino===b.ino && a.size===b.size && a.mode===b.mode &&
    a.mtimeMs===b.mtimeMs && a.ctimeMs===b.ctimeMs;
}
async function* originalFile(directory,item,signal) {
  interrupted(signal);
  const {handle,stat}=await readOnlyFile(directory,item.path);
  try {
    requireValue(stat.size===item.bytes,'SOURCE_CHANGED','The original file size differs from the complete delivery manifest.',{path:item.path});
    if(item.mode!==undefined)requireValue((stat.mode & 0o777)===item.mode,'SOURCE_CHANGED','The original file mode differs from its delivery descriptor.',{path:item.path});
    const hash=createHash('sha256'); let count=0;
    while(count<item.bytes) {
      interrupted(signal);
      const buffer=Buffer.allocUnsafe(Math.min(CHUNK,item.bytes-count));
      const {bytesRead}=await handle.read(buffer,0,buffer.length,count);
      requireValue(bytesRead>0,'SOURCE_CHANGED','The original source ended before its declared length.',{path:item.path});
      const chunk=buffer.subarray(0,bytesRead);
      count+=bytesRead;hash.update(chunk);yield chunk;
    }
    interrupted(signal);
    requireValue(hash.digest('hex')===item.sha256,'SOURCE_CHANGED','The complete original file differs from its delivery hash.',{path:item.path});
    requireValue(sameFile(stat,await handle.stat()),'SOURCE_CHANGED','The original source changed while it was transferred.',{path:item.path});
  } finally { await handle.close(); }
}
async function verifyDelivery(directory,selected,signal) {
  for(const item of selected.entries.values())for await(const chunk of originalFile(directory,item,signal))void chunk;
  return selected;
}
function putString(header,offset,length,value) {
  const bytes=Buffer.from(value,'utf8');
  requireValue(bytes.length<=length,'ARCHIVE_HEADER_LIMIT','The selected original path requires a PAX header.');
  bytes.copy(header,offset);
}
function putOctal(header,offset,length,value) {
  nonnegative(value,'tar numeric field');
  const text=value.toString(8);
  requireValue(text.length<length,'ARCHIVE_HEADER_LIMIT','The native tar field requires an extended header.');
  header.write(text.padStart(length-1,'0')+'\0',offset,length,'ascii');
}
function splitHeaderPath(path) {
  if(Buffer.byteLength(path,'utf8')<=100 && /^[\x20-\x7e]+$/.test(path))return {name:path,prefix:''};
  for(let index=path.lastIndexOf('/');index>0;index=path.lastIndexOf('/',index-1)) {
    const prefix=path.slice(0,index),name=path.slice(index+1);
    if(Buffer.byteLength(prefix,'utf8')<=155 && Buffer.byteLength(name,'utf8')<=100 && /^[\x20-\x7e]+$/.test(path))return {name,prefix};
  }
  return null;
}
function tarHeader(path,size,permissions,type='0') {
  const selected=splitHeaderPath(path);
  requireValue(selected,'ARCHIVE_HEADER_LIMIT','The tar header path was not prepared.');
  const header=Buffer.alloc(BLOCK);
  putString(header,0,100,selected.name);putOctal(header,100,8,mode(permissions));
  putOctal(header,108,8,0);putOctal(header,116,8,0);putOctal(header,124,12,size);putOctal(header,136,12,0);
  header.fill(32,148,156);header[156]=type.charCodeAt(0);
  header.write('ustar\0',257,6,'ascii');header.write('00',263,2,'ascii');
  putOctal(header,329,8,0);putOctal(header,337,8,0);putString(header,345,155,selected.prefix);
  let sum=0;for(const byte of header)sum+=byte;
  header.write(sum.toString(8).padStart(6,'0')+'\0 ',148,8,'ascii');
  return header;
}
function paxRecord(key,value) {
  const tail=Buffer.from(' '+key+'='+value+'\n','utf8');
  let length=tail.length+1;
  while(String(length).length+tail.length!==length)length=String(length).length+tail.length;
  return Buffer.concat([Buffer.from(String(length),'ascii'),tail],length);
}
function fileFraming(path,size,permissions,index) {
  const fields=[];const ordinaryPath=splitHeaderPath(path);
  if(!ordinaryPath)fields.push(paxRecord('path',path));
  if(size>MAX_OCTAL_SIZE)fields.push(paxRecord('size',String(size)));
  const result=[];
  if(fields.length) {
    const body=Buffer.concat(fields);
    requireValue(body.length<=MAX_PAX_BYTES,'ARCHIVE_HEADER_LIMIT','The original extended path exceeds the metadata bound.');
    result.push(tarHeader('PaxHeaders/'+index,body.length,0o600,'x'),body);
    const padding=(BLOCK-body.length%BLOCK)%BLOCK;if(padding)result.push(ZERO.subarray(0,padding));
  }
  result.push(tarHeader(ordinaryPath?path:'PaxPayload/'+index,size>MAX_OCTAL_SIZE?0:size,permissions));
  return result;
}
async function* tarDelivery(directory,selected,signal) {
  interrupted(signal);
  const manifestBytes=selected.original.bytes;
  for(const block of fileFraming('manifest.json',manifestBytes.length,0o600,0))yield block;
  for(let start=0;start<manifestBytes.length;start+=CHUNK){interrupted(signal);yield manifestBytes.subarray(start,start+CHUNK);}
  let padding=(BLOCK-manifestBytes.length%BLOCK)%BLOCK;if(padding)yield ZERO.subarray(0,padding);
  let index=0;
  for(const item of selected.entries.values()) {
    interrupted(signal);
    // Permissions are original declared bits; private source files without a
    // declared mode remain private in the portable delivery.
    for(const block of fileFraming(item.path,item.bytes,item.mode??0o600,++index))yield block;
    for await(const chunk of originalFile(directory,item,signal))yield chunk;
    padding=(BLOCK-item.bytes%BLOCK)%BLOCK;if(padding)yield ZERO.subarray(0,padding);
  }
  yield ZERO;yield ZERO;
}
export async function streamPollarDelivery({sourceDirectory,expectedManifestSha256,signal}={}) {
  interrupted(signal);
  const selected=await deliveryMetadata(sourceDirectory,expectedManifestSha256);
  const tar=Readable.from(tarDelivery(sourceDirectory,selected,signal),{objectMode:false,highWaterMark:CHUNK});
  const gzip=createGzip({level:6,chunkSize:CHUNK});
  const cancel=()=>{const error=new PollarArchiveError('ARCHIVE_INTERRUPTED','The complete delivery transfer was interrupted.');tar.destroy(error);gzip.destroy(error);};
  const fail=error=>gzip.destroy(error);
  tar.on('error',fail);
  signal?.addEventListener('abort',cancel,{once:true});
  gzip.once('close',()=>{
    signal?.removeEventListener('abort',cancel);
    if(!tar.destroyed)tar.destroy();
  });
  if(signal?.aborted) { tar.destroy();gzip.destroy();interrupted(signal); }
  tar.pipe(gzip);
  return gzip;
}

class ByteReader {
  constructor(stream,signal) { this.iterator=stream[Symbol.asyncIterator]();this.signal=signal;this.buffer=Buffer.alloc(0);this.offset=0;this.ended=false; }
  async available() {
    interrupted(this.signal);
    while(this.offset===this.buffer.length && !this.ended) {
      const next=await this.iterator.next();
      interrupted(this.signal);
      if(next.done) { this.ended=true;return false; }
      requireValue(Buffer.isBuffer(next.value) || next.value instanceof Uint8Array,'INVALID_ARCHIVE_STREAM','The gzip source must produce byte chunks.');
      this.buffer=Buffer.isBuffer(next.value)?next.value:Buffer.from(next.value);this.offset=0;
    }
    return this.offset<this.buffer.length;
  }
  async *chunks(size) {
    nonnegative(size,'archive source length');
    let remaining=size;
    while(remaining>0) {
      requireValue(await this.available(),'INCOMPLETE_ARCHIVE','The original archive ended before its declared file length.');
      const length=Math.min(remaining,this.buffer.length-this.offset),chunk=this.buffer.subarray(this.offset,this.offset+length);
      this.offset+=length;remaining-=length;yield chunk;
    }
  }
  async bytes(size,maximum=MAX_PAX_BYTES) {
    requireValue(size<=maximum,'ARCHIVE_METADATA_LIMIT','The archive metadata exceeds the supported parser bound.');
    const result=Buffer.allocUnsafe(size);let offset=0;
    for await(const chunk of this.chunks(size)){chunk.copy(result,offset);offset+=chunk.length;}
    return result;
  }
  async zeros(size) {
    for await(const chunk of this.chunks(size))requireValue(chunk.every(byte=>byte===0),'INVALID_ARCHIVE_PADDING','Original tar padding must contain zero bytes.');
  }
  async finish() {
    let padding=0;
    while(await this.available()) {
      const chunk=this.buffer.subarray(this.offset);padding+=chunk.length;this.offset=this.buffer.length;
      requireValue(padding<=MAX_TRAILING_PADDING && chunk.every(byte=>byte===0),
        'TRAILING_ARCHIVE_DATA','The archive contains additional or excessive data after the complete delivery.');
    }
  }
  async close() { if(!this.ended && this.iterator.return)await this.iterator.return(); }
}
function headerString(block,offset,size) {
  const field=block.subarray(offset,offset+size),zero=field.indexOf(0);
  const bytes=zero<0?field:field.subarray(0,zero);
  if(zero>=0)requireValue(field.subarray(zero).every(byte=>byte===0),'INVALID_ARCHIVE_HEADER','A native tar header contains bytes after its field terminator.');
  try{return decoder.decode(bytes);}catch{throw new PollarArchiveError('INVALID_ARCHIVE_HEADER','The native archive header contains invalid UTF-8.');}
}
function headerNumber(block,offset,size,label) {
  const field=block.subarray(offset,offset+size);
  requireValue(field.every(byte=>byte===0 || byte===32 || (byte>=48 && byte<=55)),
    'INVALID_ARCHIVE_HEADER',label+' must use the original POSIX octal field encoding.');
  const text=field.toString('ascii').replace(/\0/g,' ').trim();
  requireValue(text==='' || /^[0-7]+$/.test(text),'INVALID_ARCHIVE_HEADER',label+' is not a complete native octal field.');
  const value=text===''?0:Number.parseInt(text,8);return nonnegative(value,label);
}
function parseHeader(block) {
  const checksum=headerNumber(block,148,8,'tar checksum');let total=0;
  for(let index=0;index<BLOCK;index++)total+=index>=148 && index<156?32:block[index];
  requireValue(total===checksum,'INVALID_ARCHIVE_CHECKSUM','The original tar header checksum differs.');
  requireValue(block.subarray(257,263).equals(Buffer.from('ustar\0','ascii')) &&
    block.subarray(263,265).equals(Buffer.from('00','ascii')),
    'UNSUPPORTED_ARCHIVE_FORMAT','Select a POSIX ustar/PAX Pollar programme delivery.');
  requireValue(headerString(block,157,100)==='','ARCHIVE_LINK_FORBIDDEN','Symbolic and hard-link archive entries are not accepted.');
  const name=headerString(block,0,100),prefix=headerString(block,345,155);
  const path=prefix?prefix+'/'+name:name;
  return {path,type:String.fromCharCode(block[156]),bytes:headerNumber(block,124,12,'tar source bytes'),
    mode:mode(headerNumber(block,100,8,'tar file mode'))};
}
function parsePax(body) {
  const result=new Map();let start=0;
  const allowed=new Set(['path','size','mtime','atime','ctime','uid','gid','uname','gname','charset','comment']);
  while(start<body.length) {
    const space=body.indexOf(32,start);
    requireValue(space>start && space-start<=8,'INVALID_ARCHIVE_PAX','A PAX record is missing its bounded decimal byte length.');
    const lengthText=body.subarray(start,space).toString('ascii');
    requireValue(/^[1-9][0-9]*$/.test(lengthText),'INVALID_ARCHIVE_PAX','A PAX record has an invalid byte length.');
    const length=Number(lengthText),end=start+length;
    requireValue(length<=MAX_PAX_BYTES && end<=body.length && end>space+3 && body[end-1]===10,
      'INVALID_ARCHIVE_PAX','A PAX record does not contain its complete original bytes.');
    const equal=body.indexOf(61,space+1);
    requireValue(equal>space+1 && equal<end-1,'INVALID_ARCHIVE_PAX','A PAX record is missing its key/value separator.');
    let key,value;
    try { key=decoder.decode(body.subarray(space+1,equal));value=decoder.decode(body.subarray(equal+1,end-1)); }
    catch { throw new PollarArchiveError('INVALID_ARCHIVE_PAX','PAX metadata must use valid UTF-8.'); }
    requireValue(allowed.has(key) && !result.has(key) && !value.includes('\0'),
      'UNSUPPORTED_ARCHIVE_PAX','The archive includes a repeated or unsupported PAX field.',{key});
    result.set(key,value);start=end;
  }
  requireValue(result.size>0,'INVALID_ARCHIVE_PAX','The original extended header is empty.');
  return result;
}
function effectiveHeader(header,pax) {
  if(!pax)return header;
  const result={...header};
  if(pax.has('path'))result.path=pax.get('path');
  if(pax.has('size')) {
    const text=pax.get('size');
    requireValue(/^(?:0|[1-9][0-9]*)$/.test(text),'INVALID_ARCHIVE_PAX','An original PAX size must be a nonnegative decimal integer.');
    result.bytes=nonnegative(Number(text),'extended source bytes');
  }
  return result;
}
async function writableParent(directory,path,directories) {
  const parts=relativePath(path).split('/').slice(0,-1);let current=directory;
  for(const part of parts) {
    current=join(current,part);
    try{await fs.mkdir(current,{mode:0o700});}
    catch(error){if(error.code!=='EEXIST')throw error;}
    const stat=await fs.lstat(current);
    requireValue(stat.isDirectory() && !stat.isSymbolicLink() && await fs.realpath(current)===current,
      'INVALID_ARCHIVE_PATH','A receiving directory contains a symbolic link or conflicting file.',{path});
    directories.add(current);
  }
  return join(directory,path);
}
async function writeAll(handle,chunk) {
  let offset=0;
  while(offset<chunk.length) {
    const {bytesWritten}=await handle.write(chunk,offset,chunk.length-offset,null);
    requireValue(bytesWritten>0,'ARCHIVE_WRITE_FAILED','The receiving file stopped accepting its original bytes.');
    offset+=bytesWritten;
  }
}
async function writeOriginal(directory,item,permissions,chunks,directories,signal) {
  const target=await writableParent(directory,item.path,directories);
  const handle=await fs.open(target,FS.O_WRONLY|FS.O_CREAT|FS.O_EXCL|(FS.O_NOFOLLOW??0),0o600);
  const hash=createHash('sha256');let count=0;
  try {
    for await(const chunk of chunks) {
      interrupted(signal);count+=chunk.length;
      requireValue(count<=item.bytes,'ARCHIVE_FILE_SIZE_MISMATCH','An archive member exceeds its manifest length.',{path:item.path});
      hash.update(chunk);await writeAll(handle,chunk);
    }
    requireValue(count===item.bytes && hash.digest('hex')===item.sha256,
      'ARCHIVE_FILE_HASH_MISMATCH','The full original archive member differs from its manifest bytes or SHA256.',{path:item.path});
    await handle.chmod(mode(permissions));await handle.sync();
  } finally {await handle.close();}
}
async function syncDirectory(directory) {
  const handle=await fs.open(directory,FS.O_RDONLY);
  try{await handle.sync();}finally{await handle.close();}
}
function resultFor(directory,selected,replayed=false) {
  return {sourceDirectory:directory,directory,manifest:selected.manifest,manifestSha256:selected.manifestSha256,
    bytes:selected.bytes,fileCount:selected.entries.size,replayed};
}
async function extractTar(input,directory,expectedManifestSha256,signal) {
  const gzip=createGunzip({chunkSize:CHUNK});
  const inputFailure=error=>gzip.destroy(error);
  const inputClosed=()=>{if(!input.readableEnded)gzip.destroy(new PollarArchiveError('INCOMPLETE_ARCHIVE','The uploaded source closed before its complete gzip stream ended.'));};
  const cancel=()=>gzip.destroy(new PollarArchiveError('ARCHIVE_INTERRUPTED','The complete delivery transfer was interrupted.'));
  input.on('error',inputFailure);input.on('close',inputClosed);
  // Parser exceptions may stop consumption before the decompressor finishes.
  // Keep its error event handled until the stream has been closed.
  const gzipFailure=()=>{};gzip.on('error',gzipFailure);
  signal?.addEventListener('abort',cancel,{once:true});
  const reader=new ByteReader(gzip,signal);
  let selected=null,pax=null,headers=0;const received=new Set(),seenDirectories=new Set(),directories=new Set([directory]);
  try {
    interrupted(signal);input.pipe(gzip);
    while(true) {
      interrupted(signal);
      const block=await reader.bytes(BLOCK,BLOCK);
      if(block.every(byte=>byte===0)) {
        requireValue(!pax,'INCOMPLETE_ARCHIVE','The archive ends before an extended header’s selected file.');
        await reader.zeros(BLOCK);await reader.finish();break;
      }
      const header=parseHeader(block);
      headers++;
      const bound=selected?2*(selected.entries.size+selected.directories.size+1)+2:3;
      requireValue(headers<=bound,'ARCHIVE_METADATA_LIMIT','The archive contains excessive or undeclared header metadata.');
      if(header.type==='x') {
        requireValue(!pax && header.bytes>0 && header.bytes<=MAX_PAX_BYTES,
          'ARCHIVE_METADATA_LIMIT','Select one bounded local PAX header for the following original file.');
        pax=parsePax(await reader.bytes(header.bytes,MAX_PAX_BYTES));
        await reader.zeros((BLOCK-header.bytes%BLOCK)%BLOCK);continue;
      }
      const entry=effectiveHeader(header,pax);pax=null;
      requireValue(entry.type==='0' || entry.type==='\0' || entry.type==='5',
        'ARCHIVE_ENTRY_FORBIDDEN','Only declared regular files and their directory parents are accepted.',{type:entry.type});
      if(entry.type==='5') {
        requireValue(selected && entry.bytes===0,'ARCHIVE_ENTRY_FORBIDDEN','Directory metadata must follow the original delivery manifest and contain no file bytes.');
        const path=relativePath(entry.path.endsWith('/')?entry.path.slice(0,-1):entry.path);
        requireValue(selected.directories.has(path) && !seenDirectories.has(path),'UNDECLARED_ARCHIVE_ENTRY','The archive directory is outside the complete file selection or repeated.',{path});
        seenDirectories.add(path);continue;
      }
      relativePath(entry.path);
      requireValue(!received.has(entry.path),'DUPLICATE_ARCHIVE_ENTRY','The same original archive file appears more than once.',{path:entry.path});
      if(!selected) {
        requireValue(entry.path==='manifest.json' && entry.bytes>0 && entry.bytes<=MAX_MANIFEST_BYTES,
          'ARCHIVE_MANIFEST_REQUIRED','The first original archive file must be the complete bounded manifest.json.');
        const bytes=await reader.bytes(entry.bytes,MAX_MANIFEST_BYTES);
        try{decoder.decode(bytes);}catch{throw new PollarArchiveError('INVALID_ARCHIVE_MANIFEST','The original delivery manifest must use valid UTF-8.');}
        const manifestSha256=createHash('sha256').update(bytes).digest('hex');
        if(expectedManifestSha256!==undefined)requireValue(manifestSha256===validHash(expectedManifestSha256),
          'SOURCE_CHANGED','The uploaded original manifest differs from the selected delivery hash.');
        await writeOriginal(directory,{path:'manifest.json',bytes:bytes.length,sha256:manifestSha256},0o600,[bytes],directories,signal);
        selected=await deliveryMetadata(directory,manifestSha256);
      } else {
        const item=selected.entries.get(entry.path);
        requireValue(item,'UNDECLARED_ARCHIVE_ENTRY','The archive contains a file outside the complete delivery manifest.',{path:entry.path});
        requireValue(item.bytes===entry.bytes,'ARCHIVE_FILE_SIZE_MISMATCH','The original archive member length differs from its declared source.',{path:entry.path});
        if(item.mode!==undefined)requireValue(item.mode===entry.mode,'ARCHIVE_FILE_MODE_MISMATCH','The original source permission bits differ from the manifest.',{path:entry.path});
        await writeOriginal(directory,item,item.mode??entry.mode,reader.chunks(entry.bytes),directories,signal);
      }
      received.add(entry.path);
      await reader.zeros((BLOCK-entry.bytes%BLOCK)%BLOCK);
    }
    requireValue(selected && received.size===selected.entries.size+1,'INCOMPLETE_ARCHIVE',
      'The uploaded archive is missing original files from its complete manifest.',
      {missing:selected?[...selected.entries.keys()].filter(path=>!received.has(path)).slice(0,20):['manifest.json']});
    for(const path of [...directories].sort((a,b)=>b.length-a.length))await syncDirectory(path);
    interrupted(signal);
    return selected;
  } finally {
    input.unpipe(gzip);input.removeListener('error',inputFailure);input.removeListener('close',inputClosed);
    signal?.removeEventListener('abort',cancel);
    await reader.close().catch(()=>{});
    if(!gzip.destroyed)gzip.destroy();
  }
}
export async function unpackPollarDelivery({input,destination,expectedManifestSha256,signal}={}) {
  interrupted(signal);absolutePath(destination);
  if(expectedManifestSha256!==undefined)validHash(expectedManifestSha256);
  requireValue(input && typeof input.pipe==='function' && typeof input.on==='function' &&
    typeof input[Symbol.asyncIterator]==='function','INVALID_ARCHIVE_STREAM','Supply the original gzip delivery as a readable byte stream.');
  const parent=dirname(destination);
  requireValue(destination!==parent,'INVALID_ARCHIVE_DIRECTORY','Choose a new named receiving directory.');
  await prepareParent(parent);
  const staging=destination+'.unpacking-'+randomUUID();
  await fs.mkdir(staging,{mode:0o700});
  let published=false;
  try {
    const selected=await extractTar(input,staging,expectedManifestSha256,signal);
    const lock='archive-'+createHash('sha256').update(destination).digest('hex')+'.lock';
    return await withLock(parent,lock,async()=>{
      interrupted(signal);
      if(await existing(destination)) {
        const prior=await deliveryMetadata(destination,selected.manifestSha256);
        await verifyDelivery(destination,prior,signal);
        return resultFor(destination,prior,true);
      }
      await fs.rename(staging,destination);published=true;
      await syncDirectory(parent);
      return resultFor(destination,selected,false);
    });
  } finally {
    // Only this invocation's uncommitted private upload directory is removed.
    // Existing delivery directories are never modified by an upload retry.
    if(!published)await fs.rm(staging,{recursive:true,force:true}).catch(()=>{});
  }
}
