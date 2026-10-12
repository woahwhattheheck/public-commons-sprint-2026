(function(root,factory){if(typeof module==="object"&&module.exports)module.exports=factory(require("node:crypto").webcrypto);else root.NycSurveyBundle=factory(root.crypto);})(typeof globalThis!=="undefined"?globalThis:this,function(cryptoApi){
"use strict";
const encoder=new TextEncoder(),decoder=new TextDecoder("utf-8",{fatal:true});
function bytes(value){return typeof value==="string"?encoder.encode(value):value instanceof Uint8Array?value:new Uint8Array(value);}
function path(name){if(typeof name!=="string"||!name||name.startsWith("/")||name.includes("\\")||name.split("/").some(p=>!p||p==="."||p==="..")||/[\0-\x1f]/.test(name))throw Error("Unsafe archive path.");return name;}
async function hash(value){if(!cryptoApi||!cryptoApi.subtle)throw Error("SHA-256 is unavailable in this browser context.");const digest=await cryptoApi.subtle.digest("SHA-256",bytes(value));return Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,"0")).join("");}
const table=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}
function crc(data){let c=0xffffffff;for(const v of data)c=table[(c^v)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
function word(n,width){const a=new Uint8Array(width);for(let i=0;i<width;i++)a[i]=(n/2**(8*i))&255;return a;}
function join(parts){const size=parts.reduce((n,a)=>n+a.length,0);if(size>256*1024*1024)throw Error("Archive exceeds the 256 MiB workplan limit.");const out=new Uint8Array(size);let at=0;for(const a of parts){out.set(a,at);at+=a.length;}return out;}
function zip(entries){
  const local=[],central=[];let offset=0,count=0;const seen=new Set();
  for(const [name,value]of Object.entries(entries)){path(name);if(seen.has(name))throw Error("Duplicate archive path.");seen.add(name);const filename=bytes(name),data=bytes(value);if(filename.length>65535)throw Error("Archive path is too long.");const checksum=crc(data);
    const header=join([word(0x04034b50,4),word(20,2),word(0x0800,2),word(0,2),word(0,2),word(33,2),word(checksum,4),word(data.length,4),word(data.length,4),word(filename.length,2),word(0,2),filename]);
    local.push(header,data);
    central.push(join([word(0x02014b50,4),word(20,2),word(20,2),word(0x0800,2),word(0,2),word(0,2),word(33,2),word(checksum,4),word(data.length,4),word(data.length,4),word(filename.length,2),word(0,2),word(0,2),word(0,2),word(0,2),word(0,4),word(offset,4),filename]));
    offset+=header.length+data.length;count++;
  }
  if(count>65535)throw Error("Too many archive entries.");
  const directory=join(central),end=join([word(0x06054b50,4),word(0,2),word(0,2),word(count,2),word(count,2),word(directory.length,4),word(offset,4),word(0,2)]);
  return join([...local,directory,end]);
}
function unzip(input){
  const data=bytes(input),view=new DataView(data.buffer,data.byteOffset,data.byteLength),entries={};
  const u16=p=>{if(p+2>data.length)throw Error("Truncated archive.");return view.getUint16(p,true);};
  const u32=p=>{if(p+4>data.length)throw Error("Truncated archive.");return view.getUint32(p,true);};
  if(data.length<22)throw Error("Archive is too short.");
  const end=data.length-22;if(u32(end)!==0x06054b50||u16(end+20)!==0||u16(end+4)!==0||u16(end+6)!==0)throw Error("Unsupported ZIP directory.");
  const count=u16(end+10);if(count!==u16(end+8))throw Error("Invalid entry count.");
  let cursor=u32(end+16);const directoryEnd=cursor+u32(end+12);if(directoryEnd!==end)throw Error("Invalid ZIP directory bounds.");
  const occupied=[];
  for(let n=0;n<count;n++){
    if(u32(cursor)!==0x02014b50)throw Error("Invalid directory entry.");
    const flags=u16(cursor+8),method=u16(cursor+10),expectedCrc=u32(cursor+16),packed=u32(cursor+20),size=u32(cursor+24),nameLength=u16(cursor+28),extra=u16(cursor+30),comment=u16(cursor+32),start=u32(cursor+42);
    if(flags!==0x0800||method!==0||packed!==size)throw Error("Only this workbench's stored UTF-8 ZIP format is supported.");
    const name=path(decoder.decode(data.subarray(cursor+46,cursor+46+nameLength)));if(Object.prototype.hasOwnProperty.call(entries,name))throw Error("Duplicate archive path.");
    if(u32(start)!==0x04034b50||u16(start+6)!==flags||u16(start+8)!==method||u32(start+14)!==expectedCrc||u32(start+18)!==packed||u32(start+22)!==size)throw Error("ZIP headers disagree.");
    const localNameLength=u16(start+26),localExtra=u16(start+28),begin=start+30+localNameLength+localExtra,finish=begin+size;
    if(decoder.decode(data.subarray(start+30,start+30+localNameLength))!==name||finish>u32(end+16))throw Error("Invalid local member bounds.");
    if(occupied.some(([a,b])=>start<b&&finish>a))throw Error("Overlapping archive members.");
    occupied.push([start,finish]);const content=data.slice(begin,finish);if(crc(content)!==expectedCrc)throw Error("ZIP checksum mismatch for "+name);
    Object.defineProperty(entries,name,{value:content,enumerable:true});
    cursor+=46+nameLength+extra+comment;
  }
  if(cursor!==directoryEnd)throw Error("Unexpected directory bytes.");return entries;
}
function scriptJson(value){return JSON.stringify(value).replace(/</g,"\\u003c").replace(/\u2028/g,"\\u2028").replace(/\u2029/g,"\\u2029");}
function standalone(files,workplan){
  for(const name of ["index.html","rules.js","core.cjs","bundle.cjs","app.js","style.css"])if(typeof files[name]!=="string")throw Error("Missing application source "+name);
  let html=files["index.html"];
  html=html.replace('<link rel="stylesheet" href="style.css">',()=>"<style>"+files["style.css"].replace(/<\/style/gi,"<\\/style")+"</style>");
  html=html.replace("<!-- WORKPLAN_STATE -->",()=>'<script id="initial-workplan" type="application/json">'+scriptJson(workplan)+'</script><script id="application-sources" type="application/json">'+scriptJson(files)+"</script>");
  for(const name of ["rules.js","core.cjs","bundle.cjs","app.js"])html=html.replace('<script src="'+name+'"></script>',()=>"<script>"+files[name].replace(/<\/script/gi,"<\\/script")+"</script>");
  return html;
}
async function create(workplan,reportFiles,applicationFiles){
  const entries={...reportFiles,"standalone.html":standalone(applicationFiles,workplan)};
  for(const [name,value]of Object.entries(applicationFiles))entries["application/"+path(name)]=value;
  const manifest={schema:"nyc-survey-workplan-bundle/v1",workplan_id:workplan.workplan_id,revision:workplan.revision,rules_version:workplan.rules_version,files:[]};
  for(const [name,value]of Object.entries(entries)){const content=bytes(value);manifest.files.push({path:name,bytes:content.length,sha256:await hash(content)});}
  manifest.files.sort((a,b)=>a.path.localeCompare(b.path));
  entries["bundle-manifest.json"]=JSON.stringify(manifest,null,2)+"\n";
  return{bytes:zip(entries),manifest};
}
async function verify(input){
  const entries=unzip(input);if(!entries["bundle-manifest.json"]||!entries["workplan.json"])throw Error("Workplan bundle members are missing.");
  const manifest=JSON.parse(decoder.decode(entries["bundle-manifest.json"]));if(manifest.schema!=="nyc-survey-workplan-bundle/v1"||!Array.isArray(manifest.files))throw Error("Unknown bundle manifest.");
  const expected=new Set(["bundle-manifest.json"]);
  for(const f of manifest.files){path(f.path);if(expected.has(f.path))throw Error("Duplicate manifest path.");expected.add(f.path);const data=entries[f.path];if(!data||data.length!==f.bytes||await hash(data)!==f.sha256)throw Error("Source verification failed: "+f.path);}
  if(expected.size!==Object.keys(entries).length)throw Error("Unlisted archive member.");
  const workplan=JSON.parse(decoder.decode(entries["workplan.json"]));if(workplan.workplan_id!==manifest.workplan_id||workplan.revision!==manifest.revision||workplan.rules_version!==manifest.rules_version)throw Error("Workplan identity differs from its manifest.");
  return{manifest,workplan,entries};
}
function texts(entries){return Object.fromEntries(Object.entries(entries).map(([name,value])=>[name,decoder.decode(value)]));}
return Object.freeze({bytes,hash,crc,zip,unzip,standalone,create,verify,texts});
});
