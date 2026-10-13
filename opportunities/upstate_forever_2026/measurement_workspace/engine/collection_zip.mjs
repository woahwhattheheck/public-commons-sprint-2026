/** Standard uncompressed ZIP for independently usable complete study delivery. */
import {crc32,deflateRawSync} from 'node:zlib';
export function zipMembers(members){
  const local=[],central=[];let offset=0;
  if(members.length>65535)throw new Error('ZIP member count requires ZIP64');
  for(const {name,data} of members){
    const filename=Buffer.from(name,'utf8'),body=Buffer.from(data),checksum=crc32(body);
    if(body.length>0xffffffff||offset>0xffffffff)throw new Error('Study exceeds classic ZIP size');
    const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x0800,6);h.writeUInt16LE(33,12);h.writeUInt32LE(checksum,14);h.writeUInt32LE(body.length,18);h.writeUInt32LE(body.length,22);h.writeUInt16LE(filename.length,26);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x0800,8);c.writeUInt16LE(33,14);c.writeUInt32LE(checksum,16);c.writeUInt32LE(body.length,20);c.writeUInt32LE(body.length,24);c.writeUInt16LE(filename.length,28);c.writeUInt32LE(offset,42);
    local.push(h,filename,body);central.push(c,filename);offset+=h.length+filename.length+body.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);if(offset+directory.length>0xffffffff)throw new Error('Study exceeds classic ZIP size');
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(members.length,8);end.writeUInt16LE(members.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}

/**
 * Complete standard ZIP with per-member DEFLATE for large scientific products.
 * Original strings are encoded one at a time; retained historical stored ZIPs
 * continue through zipMembers above with their original bytes.
 */
export function deflatedZipMembers(members){
  const local=[],central=[],names=new Set();let offset=0,count=0;
  for(const {name,data} of members){
    if(typeof name!=='string'||!name||name.startsWith('/')||name.includes('\\')||
      name.split('/').some(part=>!part||part==='.'||part==='..')||/[\x00-\x1f:]/.test(name))
      throw new Error('ZIP member needs an ordinary relative path');
    if(names.has(name))throw new Error('ZIP member names must be unique');
    names.add(name);if(++count>65535)throw new Error('ZIP member count requires ZIP64');
    const filename=Buffer.from(name,'utf8');
    if(filename.length>65535)throw new Error('ZIP member name exceeds classic ZIP length');
    const body=Buffer.isBuffer(data)?data:Buffer.from(data),checksum=crc32(body);
    if(body.length>0xffffffff||offset>0xffffffff)throw new Error('Study exceeds classic ZIP size');
    const compressed=deflateRawSync(body,{level:6});
    const useDeflate=compressed.length<body.length,payload=useDeflate?compressed:body,method=useDeflate?8:0;
    if(payload.length>0xffffffff)throw new Error('Study exceeds classic ZIP size');
    const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);
    h.writeUInt16LE(0x0800,6);h.writeUInt16LE(method,8);h.writeUInt16LE(33,12);
    h.writeUInt32LE(checksum,14);h.writeUInt32LE(payload.length,18);h.writeUInt32LE(body.length,22);h.writeUInt16LE(filename.length,26);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);
    c.writeUInt16LE(0x0800,8);c.writeUInt16LE(method,10);c.writeUInt16LE(33,14);
    c.writeUInt32LE(checksum,16);c.writeUInt32LE(payload.length,20);c.writeUInt32LE(body.length,24);
    c.writeUInt16LE(filename.length,28);c.writeUInt32LE(offset,42);
    local.push(h,filename,payload);central.push(c,filename);offset+=h.length+filename.length+payload.length;
    if(offset>0xffffffff)throw new Error('Study exceeds classic ZIP size');
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);
  if(offset+directory.length+end.length>0xffffffff)throw new Error('Study exceeds classic ZIP size');
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(count,8);end.writeUInt16LE(count,10);
  end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
