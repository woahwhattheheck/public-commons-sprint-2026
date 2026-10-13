function buildStoredZip(files) {
  const encoder=new TextEncoder(),parts=[],central=[];let offset=0;
  const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
  const crc=bytes=>{let n=0xffffffff;for(const b of bytes)n=crcTable[(n^b)&255]^(n>>>8);return (n^0xffffffff)>>>0;};
  const header=(length)=>{const bytes=new Uint8Array(length);return {bytes,view:new DataView(bytes.buffer)};};
  for(const file of files){
    if(!file.name||file.name.startsWith("/")||file.name.split("/").includes(".."))throw new Error("Unsafe archive path.");
    const name=encoder.encode(file.name),data=typeof file.data==="string"?encoder.encode(file.data):file.data;
    if(data.length>0xffffffff||offset>0xffffffff)throw new Error("Package exceeds ZIP32 limits.");
    const sum=crc(data),h=header(30),v=h.view;
    v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint32(14,sum,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true);
    parts.push(h.bytes,name,data);
    const c=header(46),cv=c.view;cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x800,true);cv.setUint32(16,sum,true);cv.setUint32(20,data.length,true);cv.setUint32(24,data.length,true);cv.setUint16(28,name.length,true);cv.setUint32(42,offset,true);central.push(c.bytes,name);
    offset+=30+name.length+data.length;
  }
  if(files.length>65535)throw new Error("Package has too many files for ZIP32.");
  const centralSize=central.reduce((n,b)=>n+b.length,0),end=header(22),v=end.view;
  v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,centralSize,true);v.setUint32(16,offset,true);
  return new Blob([...parts,...central,end.bytes],{type:"application/zip"});
}