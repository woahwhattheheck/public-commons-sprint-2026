// MIT. One complete original SSE frame; WHATWG event fields and byte-preserving framing.
const MAX_FRAME=16*1024*1024;
function requireValue(ok,code){if(!ok)throw Object.assign(new Error(code),{code});}
export function parseSSEFrame(raw){
 requireValue(raw instanceof Uint8Array&&raw.length>0&&raw.length<=MAX_FRAME,'SSE_FRAME_SIZE');
 let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);}catch{requireValue(false,'SSE_UTF8_INVALID');}
 const bom=text.charCodeAt(0)===0xfeff;if(bom)text=text.slice(1);
 requireValue(/(?:\r\n|\r|\n)$/.test(text),'SSE_FRAME_INCOMPLETE');
 const lines=text.split(/\r\n|\r|\n/);lines.pop();
 requireValue(lines.length>0&&lines.at(-1)===''&&lines.slice(0,-1).every(x=>x!==''),'SSE_SINGLE_COMPLETE_FRAME_REQUIRED');
 let event=null,id=null,retry=null;const data=[];
 for(const line of lines.slice(0,-1)){
  if(line.startsWith(':'))continue;
  const i=line.indexOf(':'),field=i<0?line:line.slice(0,i);let value=i<0?'':line.slice(i+1);if(value.startsWith(' '))value=value.slice(1);
  if(field==='data')data.push(value);
  else if(field==='event')event=value||null;
  else if(field==='id'&&!value.includes('\0'))id=value;
  else if(field==='retry'&&/^\d+$/.test(value)){const n=Number(value);requireValue(Number.isSafeInteger(n),'SSE_RETRY_RANGE');retry=n;}
 }
 return {event,id,data:data.length?data.join('\n'):null,retry,bom};
}
export class SSEFrameDecoder {
 constructor(){this.buffer=new Uint8Array(0);this.scan=0;this.lineStart=0;this.first=true;this.frames=0;}
 feed(chunk,{final=false}={}){
  requireValue(chunk instanceof Uint8Array,'SSE_BYTES_REQUIRED');
  const bytes=new Uint8Array(this.buffer.length+chunk.length);bytes.set(this.buffer);bytes.set(chunk,this.buffer.length);
  let i=this.scan,lineStart=this.lineStart,frameStart=0;const frames=[];
  if(this.first&&this.frames===0&&bytes[0]===239){
   if(bytes.length<3&&[239,187,191].slice(0,bytes.length).every((b,j)=>bytes[j]===b)&&!final){this.buffer=bytes;return frames;}
   if(bytes[1]===187&&bytes[2]===191&&lineStart===0){lineStart=3;i=Math.max(i,3);}
  }
  while(i<bytes.length){
   if(bytes[i]!==10&&bytes[i]!==13){i++;requireValue(i-frameStart<=MAX_FRAME,'SSE_FRAME_SIZE');continue;}
   if(bytes[i]===13&&i+1===bytes.length&&!final)break;
   const end=i+(bytes[i]===13&&bytes[i+1]===10?2:1);
   requireValue(end-frameStart<=MAX_FRAME,'SSE_FRAME_SIZE');
   if(i===lineStart){
    const raw=bytes.slice(frameStart,end),frame=parseSSEFrame(raw);
    requireValue(!frame.bom||this.first,'SSE_UNEXPECTED_BOM');
    frames.push({...frame,raw});this.first=false;this.frames++;frameStart=end;
   }
   i=end;lineStart=end;
  }
  this.buffer=bytes.slice(frameStart);this.scan=i-frameStart;this.lineStart=lineStart-frameStart;
  requireValue(this.buffer.length<=MAX_FRAME,'SSE_FRAME_SIZE');
  return frames;
 }
 finish(){const frames=this.feed(new Uint8Array(0),{final:true}),discardedBytes=this.buffer.length;this.buffer=new Uint8Array(0);this.scan=0;this.lineStart=0;return {frames,discardedBytes};}
}
