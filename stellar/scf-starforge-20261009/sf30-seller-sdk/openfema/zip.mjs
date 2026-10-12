// MIT. Deterministic UTF-8 ZIP packaging and exact original-byte receiving.
import {inflateRawSync} from 'node:zlib';
import {fault} from './domain.mjs';
const crcTable=Uint32Array.from({length:256},(_,i)=>{let n=i;for(let b=0;b<8;b++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc32=bytes=>{let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;};
export function archivePath(value){
  if(typeof value!=='string'||!value||value.length>1024||value.startsWith('/')||/[\\:\x00-\x1f]/.test(value)||value.split('/').some(x=>!x||x==='.'||x==='..'))throw fault('OPENFEMA_ARCHIVE_PATH','The archive contains an invalid relative path.');
  return value;
}
export function zipEntries(entries){
  if(!Array.isArray(entries)||entries.length>65535)throw fault('OPENFEMA_ARCHIVE_SIZE','A handover archive supports up to 65,535 files.');
  const local=[],central=[],seen=new Set();let offset=0,centralSize=0;
  for(const entry of entries){
    const path=archivePath(entry.path);if(seen.has(path))throw fault('OPENFEMA_ARCHIVE_PATH','The archive repeats a path.');seen.add(path);
    const name=Buffer.from(path,'utf8'),bytes=Buffer.isBuffer(entry.bytes)?entry.bytes:Buffer.from(entry.text??'','utf8'),crc=crc32(bytes);
    if(bytes.length>0xffffffff||name.length>65535)throw fault('OPENFEMA_ARCHIVE_SIZE','This file exceeds ZIP32 capacity.');
    const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(33,12);h.writeUInt32LE(crc,14);h.writeUInt32LE(bytes.length,18);h.writeUInt32LE(bytes.length,22);h.writeUInt16LE(name.length,26);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(33,14);c.writeUInt32LE(crc,16);c.writeUInt32LE(bytes.length,20);c.writeUInt32LE(bytes.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);
    local.push(h,name,bytes);central.push(c,name);offset+=h.length+name.length+bytes.length;centralSize+=c.length+name.length;
    if(offset+centralSize+22>0xffffffff)throw fault('OPENFEMA_ARCHIVE_SIZE','This handover exceeds ZIP32 capacity.');
  }
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(centralSize,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,...central,end]);
}
export function readZip(bytes,{maximumBytes=1024*1024*1024}={}){
  bytes=Buffer.from(bytes);if(bytes.length>maximumBytes||bytes.length<22)throw fault('OPENFEMA_ARCHIVE_SIZE','Choose a complete workspace ZIP within the configured capacity.');
  let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50&&i+22+bytes.readUInt16LE(i+20)===bytes.length){end=i;break;}
  if(end<0||bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6)||bytes.readUInt16LE(end+8)!==bytes.readUInt16LE(end+10))throw fault('OPENFEMA_ARCHIVE_FORMAT','Use one complete single-volume workspace ZIP.');
  const count=bytes.readUInt16LE(end+10),size=bytes.readUInt32LE(end+12),start=bytes.readUInt32LE(end+16),entries=new Map(),regions=[];let at=start,total=0;
  if(start+size!==end)throw fault('OPENFEMA_ARCHIVE_FORMAT','The ZIP directory is incomplete.');
  const decoder=new TextDecoder('utf-8',{fatal:true});
  for(let i=0;i<count;i++){
    if(at+46>end||bytes.readUInt32LE(at)!==0x02014b50)throw fault('OPENFEMA_ARCHIVE_FORMAT','The ZIP directory changed.');
    const flags=bytes.readUInt16LE(at+8),method=bytes.readUInt16LE(at+10),crc=bytes.readUInt32LE(at+16),compressed=bytes.readUInt32LE(at+20),uncompressed=bytes.readUInt32LE(at+24),nameLength=bytes.readUInt16LE(at+28),extra=bytes.readUInt16LE(at+30),comment=bytes.readUInt16LE(at+32),offset=bytes.readUInt32LE(at+42);
    if(flags&1||![0,8].includes(method)||at+46+nameLength+extra+comment>end)throw fault('OPENFEMA_ARCHIVE_FORMAT','Choose an unencrypted UTF-8 workspace ZIP.');
    const path=archivePath(decoder.decode(bytes.subarray(at+46,at+46+nameLength)));
    if(entries.has(path)||offset+30>start||bytes.readUInt32LE(offset)!==0x04034b50)throw fault('OPENFEMA_ARCHIVE_FORMAT','The ZIP repeats or changes an original file.');
    const localName=bytes.readUInt16LE(offset+26),localExtra=bytes.readUInt16LE(offset+28),bodyAt=offset+30+localName+localExtra,finish=bodyAt+compressed;
    if(finish>start||bytes.readUInt16LE(offset+8)!==method||decoder.decode(bytes.subarray(offset+30,offset+30+localName))!==path)throw fault('OPENFEMA_ARCHIVE_FORMAT','The original ZIP file binding differs.');
    total+=uncompressed;if(total>maximumBytes)throw fault('OPENFEMA_ARCHIVE_SIZE','The expanded workspace exceeds its receiving capacity.');
    const packed=bytes.subarray(bodyAt,finish),body=method===0?Buffer.from(packed):inflateRawSync(packed,{maxOutputLength:Math.max(1,uncompressed)});
    if(body.length!==uncompressed||crc32(body)!==crc)throw fault('OPENFEMA_ARCHIVE_CRC','An original archive file is incomplete or changed.',409);
    entries.set(path,body);regions.push([offset,finish]);at+=46+nameLength+extra+comment;
  }
  regions.sort((a,b)=>a[0]-b[0]);if(at!==end||regions.some((r,i)=>i&&r[0]<regions[i-1][1]))throw fault('OPENFEMA_ARCHIVE_FORMAT','The ZIP contains overlapping files.');
  return entries;
}
