function zipFiles(files){
 const enc=new TextEncoder(),chunks=[],central=[];let offset=0;
 const table=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[i]=c>>>0;}
 function crc(data){let c=0xffffffff;for(const b of data)c=table[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
 function header(size){const b=new Uint8Array(size);return{b,d:new DataView(b.buffer)};}
 for(const file of files){
  if(!file.path || file.path.startsWith('/') || file.path.split('/').some(p=>p==='..'||p===''))throw Error('Unsafe archive member.');
  const name=enc.encode(file.path),data=typeof file.content==='string'?enc.encode(file.content):file.content,checksum=crc(data),h=header(30);
  h.d.setUint32(0,0x04034b50,true);h.d.setUint16(4,20,true);h.d.setUint16(6,0x800,true);h.d.setUint16(12,23885,true);h.d.setUint32(14,checksum,true);h.d.setUint32(18,data.length,true);h.d.setUint32(22,data.length,true);h.d.setUint16(26,name.length,true);
  chunks.push(h.b,name,data);
  const c=header(46);c.d.setUint32(0,0x02014b50,true);c.d.setUint16(4,20,true);c.d.setUint16(6,20,true);c.d.setUint16(8,0x800,true);c.d.setUint16(14,23885,true);c.d.setUint32(16,checksum,true);c.d.setUint32(20,data.length,true);c.d.setUint32(24,data.length,true);c.d.setUint16(28,name.length,true);c.d.setUint32(42,offset,true);central.push(c.b,name);offset+=30+name.length+data.length;
 }
 const centralBytes=central.reduce((s,b)=>s+b.length,0),end=header(22);end.d.setUint32(0,0x06054b50,true);end.d.setUint16(8,files.length,true);end.d.setUint16(10,files.length,true);end.d.setUint32(12,centralBytes,true);end.d.setUint32(16,offset,true);
 return new Blob([...chunks,...central,end.b],{type:'application/zip'});
}