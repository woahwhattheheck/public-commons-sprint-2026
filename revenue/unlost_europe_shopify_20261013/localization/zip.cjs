function crc(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function zip(members){
 const locals=[],central=[];let offset=0;
 for(const {name,bytes} of members){const n=Buffer.from(name),h=Buffer.alloc(30),c=Buffer.alloc(46),sum=crc(bytes);
  h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(0x5d4d,12);h.writeUInt32LE(sum,14);h.writeUInt32LE(bytes.length,18);h.writeUInt32LE(bytes.length,22);h.writeUInt16LE(n.length,26);
  c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(0x5d4d,14);c.writeUInt32LE(sum,16);c.writeUInt32LE(bytes.length,20);c.writeUInt32LE(bytes.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);
  locals.push(h,n,bytes);central.push(c,n);offset+=h.length+n.length+bytes.length;
 }
 const center=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(members.length,8);end.writeUInt16LE(members.length,10);end.writeUInt32LE(center.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,center,end]);
}
module.exports={zip};
