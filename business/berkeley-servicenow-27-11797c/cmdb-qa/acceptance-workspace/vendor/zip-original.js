function buildCompanionZip(files){
  const enc=s=>new TextEncoder().encode(s);
  const table=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);return c>>>0;});
  const crc=data=>{let c=0xffffffff;for(const b of data)c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
  const u16=(v)=>[v&255,(v>>>8)&255],u32=v=>[v&255,(v>>>8)&255,(v>>>16)&255,(v>>>24)&255];
  const chunks=[],central=[];let offset=0,count=0;
  for(const [path,text]of Object.entries(files)){
    const n=enc(path),d=enc(text),c=crc(d);
    const header=[...u32(0x04034b50),...u16(20),...u16(0x0800),...u16(0),...u16(0),...u16(33),...u32(c),...u32(d.length),...u32(d.length),...u16(n.length),...u16(0),...n];
    const cd=[...u32(0x02014b50),...u16(20),...u16(20),...u16(0x0800),...u16(0),...u16(0),...u16(33),...u32(c),...u32(d.length),...u32(d.length),...u16(n.length),...u16(0),...u16(0),...u16(0),...u16(0),...u32(0),...u32(offset),...n];
    chunks.push(Uint8Array.from(header),d);central.push(Uint8Array.from(cd));offset+=header.length+d.length;count++;
  }
  const centralLength=central.reduce((n,x)=>n+x.length,0);
  const end=Uint8Array.from([...u32(0x06054b50),...u16(0),...u16(0),...u16(count),...u16(count),...u32(centralLength),...u32(offset),...u16(0)]);
  const result=new Uint8Array(offset+centralLength+end.length);let at=0;
  for(const chunk of [...chunks,...central,end]){result.set(chunk,at);at+=chunk.length;}return result;
};