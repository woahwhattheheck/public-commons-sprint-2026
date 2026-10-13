function writeGeoTiff({width,height,transform,strips,description}) {
 if(transform[1]||transform[3]||transform[0]<=0||transform[4]>=0)throw Error("Expected native north-up metric grid");
 const utf=s=>Uint8Array.from([...s].map(x=>x.charCodeAt(0)));
 const field=(tag,type,values)=>{if(type===2)values=utf(values+"\0");const size={2:1,3:2,4:4,12:8}[type],data=new Uint8Array(values.length*size),view=new DataView(data.buffer);for(let i=0;i<values.length;i++){if(type===2)data[i]=values[i];else if(type===3)view.setUint16(i*size,values[i],true);else if(type===4)view.setUint32(i*size,values[i],true);else view.setFloat64(i*size,values[i],true);}return {tag,type,count:values.length,data};};
 const rowsPerStrip=1024;
 if(strips.length!==Math.ceil(height/rowsPerStrip))throw Error('Incomplete strips');
 const tags=[field(256,4,[width]),field(257,4,[height]),field(258,3,[8]),field(259,3,[8]),field(262,3,[1]),field(270,2,description),field(273,4,strips.map(()=>0)),field(277,3,[1]),field(278,4,[rowsPerStrip]),field(279,4,strips.map(x=>x.length)),field(284,3,[1]),field(305,2,"Upper Savannah native class source receiver 2026-10-13"),field(339,3,[1]),field(33550,12,[transform[0],-transform[4],0]),field(33922,12,[0,0,0,transform[2],transform[5],0]),field(34735,3,[1,1,0,5,1024,0,1,1,1025,0,1,1,2048,0,1,4269,3072,0,1,5070,3076,0,1,9001]),field(42113,2,"250")].sort((a,b)=>a.tag-b.tag);
 let offset=8+2+tags.length*12+4;for(const t of tags)if(t.data.length>4){offset=(offset+7)&~7;t.offset=offset;offset+=t.data.length;}offset=(offset+7)&~7;const stripOffsets=[];for(const strip of strips){stripOffsets.push(offset);offset+=strip.length;}
 const offTag=tags.find(t=>t.tag===273);offTag.data=field(273,4,stripOffsets).data;
 const bytes=new Uint8Array(offset),view=new DataView(bytes.buffer);bytes[0]=73;bytes[1]=73;view.setUint16(2,42,true);view.setUint32(4,8,true);view.setUint16(8,tags.length,true);for(let i=0;i<tags.length;i++){const t=tags[i],at=10+i*12;view.setUint16(at,t.tag,true);view.setUint16(at+2,t.type,true);view.setUint32(at+4,t.count,true);if(t.data.length<=4)bytes.set(t.data,at+8);else{view.setUint32(at+8,t.offset,true);bytes.set(t.data,t.offset);}}for(let i=0;i<strips.length;i++)bytes.set(strips[i],stripOffsets[i]);return bytes;
}
export {writeGeoTiff};
