/** Standard uncompressed ZIP for independently usable complete study delivery. */
import {crc32} from 'node:zlib';
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
