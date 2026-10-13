/** Complete publisher ZIP intake. PKWARE APPNOTE 6.3.10: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT */
export const ARCHIVE_VERSION="publisher-archive-intake/1";
const requireValue=(yes,message)=>{if(!yes)throw Error(message);};
const CRC_TABLE=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);return c>>>0;});
export function archiveCRC32(bytes){
  let crc=0xffffffff;for(const byte of bytes)crc=(crc>>>8)^CRC_TABLE[(crc^byte)&255];return (crc^0xffffffff)>>>0;
}
export function archiveBase64(bytes){
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",chunks=[];
  for(let start=0;start<bytes.length;start+=24576){
    let text="";for(let i=start;i<Math.min(start+24576,bytes.length);i+=3){
      const n=(bytes[i]<<16)|((bytes[i+1]||0)<<8)|(bytes[i+2]||0);
      text+=alphabet[n>>>18]+alphabet[(n>>>12)&63]+(i+1<bytes.length?alphabet[(n>>>6)&63]:"=")+(i+2<bytes.length?alphabet[n&63]:"=");
    }chunks.push(text);
  }return chunks.join("");
}
export function archiveUnbase64(text){
  requireValue(typeof text==="string"&&text.length%4===0&&!/[^A-Za-z0-9+/=]/.test(text)&&(text.indexOf("=")<0||/^={1,2}$/.test(text.slice(text.indexOf("=")))),"Original archive base64 is invalid");
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",size=text.length/4*3-(text.endsWith("==")?2:text.endsWith("=")?1:0),bytes=new Uint8Array(size);
  for(let i=0,j=0;i<text.length;i+=4){const n=(alphabet.indexOf(text[i])<<18)|(alphabet.indexOf(text[i+1])<<12)|((text[i+2]==="="?0:alphabet.indexOf(text[i+2]))<<6)|(text[i+3]==="="?0:alphabet.indexOf(text[i+3]));if(j<size)bytes[j++]=n>>>16;if(j<size)bytes[j++]=(n>>>8)&255;if(j<size)bytes[j++]=n&255;}
  requireValue(archiveBase64(bytes)===text,"Original archive base64 is not canonical");return bytes;
}
function plainFilename(name){
  requireValue(typeof name==="string"&&name.length>0&&!/[\/\\\u0000-\u001f]/.test(name)&&name!=="."&&name!=="..","Use the original archive's plain filename");return name;
}
function memberName(bytes,utf8){
  if(!utf8)requireValue(bytes.every(b=>b<128),"This archive has non-ASCII filenames without its UTF-8 flag; preserve the archive and use a reader for its declared legacy encoding");
  const name=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);
  requireValue(name&&!/^[\/\\]|^[A-Za-z]:|[\\\u0000-\u001f]/.test(name)&&!name.split("/").some((p,i,a)=>p==="."||p===".."||(!p&&i!==a.length-1)),"Archive has an unsafe or ambiguous member path");
  return name;
}
export function inspectPublisherZip(input){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  requireValue(bytes.length>=22&&bytes.length<=536870912,"Choose a complete ZIP up to 512 MiB");
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),bounds=(p,n)=>requireValue(Number.isSafeInteger(p)&&p>=0&&p+n<=bytes.length,"ZIP structure is truncated");
  const u16=p=>{bounds(p,2);return view.getUint16(p,true);},u32=p=>{bounds(p,4);return view.getUint32(p,true);};
  let end=-1;
  for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(u32(p)===0x06054b50&&p+22+u16(p+20)===bytes.length){end=p;break;}
  requireValue(end>=0,"ZIP end directory is absent");
  const count=u16(end+10),size=u32(end+12),offset=u32(end+16);
  requireValue(u16(end+4)===0&&u16(end+6)===0&&u16(end+8)===count,"Split ZIP archives need their complete single-volume source");
  requireValue(count!==65535&&size!==0xffffffff&&offset!==0xffffffff,"ZIP64 is not supported by this publisher intake");
  requireValue(count>0&&offset+size===end,"ZIP directory extent is inconsistent");
  const entries=[],names=new Set();let p=offset,total=0;
  for(let i=0;i<count;i++){
    bounds(p,46);requireValue(u32(p)===0x02014b50,"ZIP central file header is invalid");
    const flags=u16(p+8),method=u16(p+10),crc=u32(p+16),compressed=u32(p+20),expanded=u32(p+24),nl=u16(p+28),el=u16(p+30),cl=u16(p+32),local=u32(p+42);
    bounds(p,46+nl+el+cl);requireValue(p+46+nl+el+cl<=end,"ZIP member crosses its directory");
    requireValue((flags&~0x080e)===0&&[0,8].includes(method),"Use an unencrypted stored or Deflate ZIP with ordinary UTF-8/ASCII paths");
    requireValue(method===8||(flags&6)===0,"Stored ZIP member declares Deflate options");
    requireValue(compressed!==0xffffffff&&expanded!==0xffffffff&&local!==0xffffffff&&u16(p+34)===0,"ZIP64 or multi-volume member is unsupported");
    const nameBytes=bytes.subarray(p+46,p+46+nl),name=memberName(nameBytes,!!(flags&0x800));
    requireValue(!names.has(name),"Duplicate original ZIP member: "+name);names.add(name);
    const unixKind=u16(p+4)>>>8===3?(u32(p+38)>>>16)&0xf000:0;
    requireValue([0,0x4000,0x8000].includes(unixKind),"Archive contains a symbolic link or special file: "+name);
    const directory=name.endsWith("/");requireValue(unixKind!==0x4000||directory,"Directory member lacks its original trailing slash");
    requireValue(!directory||expanded===0,"Directory member contains data");
    requireValue(expanded<=268435456,"One archive member exceeds 256 MiB");
    total+=expanded;requireValue(total<=2147483648,"Archive expanded inventory exceeds 2 GiB");
    bounds(local,30);requireValue(local<offset&&u32(local)===0x04034b50,"ZIP local header is invalid");
    requireValue(u16(local+6)===flags&&u16(local+8)===method,"ZIP local method/flags differ from the directory");
    const ln=u16(local+26),le=u16(local+28),start=local+30+ln+le,finish=start+compressed;
    bounds(local,30+ln+le);requireValue(ln===nl&&nameBytes.every((b,j)=>b===bytes[local+30+j]),"ZIP local filename differs from the directory");
    requireValue(finish<=offset,"ZIP compressed member crosses the directory");
    let localEnd=finish;
    if(flags&8){
      const signed=u32(finish)===0x08074b50;
      const matches=q=>q+12<=offset&&u32(q)===crc&&u32(q+4)===compressed&&u32(q+8)===expanded;
      const descriptor=signed&&matches(finish+4)?finish+4:finish;
      requireValue(matches(descriptor),"ZIP streaming descriptor differs from original central values");localEnd=descriptor+12;
    }else requireValue(u32(local+14)===crc&&u32(local+18)===compressed&&u32(local+22)===expanded,"ZIP local CRC/length differs from the directory");
    entries.push({path:name,directory,method,bytes:expanded,compressed_bytes:compressed,crc32:crc.toString(16).padStart(8,"0"),dos_time:u16(p+12),dos_date:u16(p+14),local_offset:local,data_offset:start,local_end:localEnd});
    p+=46+nl+el+cl;
  }
  requireValue(p===offset+size,"ZIP directory has unaccounted records");
  const ordered=[...entries].sort((a,b)=>a.local_offset-b.local_offset);
  for(let i=1;i<ordered.length;i++)requireValue(ordered[i-1].local_end<=ordered[i].local_offset,"ZIP original member extents overlap");
  return {bytes,entries,total_expanded_bytes:total};
}
export async function readPublisherMember(zip,entry,inflateRaw){
  requireValue(zip.entries.includes(entry),"Select an original ZIP inventory member");
  const compressed=zip.bytes.subarray(entry.data_offset,entry.data_offset+entry.compressed_bytes);
  const bytes=entry.method===0?compressed.slice():await inflateRaw(compressed,entry.bytes,entry);
  requireValue(bytes instanceof Uint8Array&&bytes.length===entry.bytes,"Expanded original member length differs: "+entry.path);
  requireValue(archiveCRC32(bytes).toString(16).padStart(8,"0")===entry.crc32,"Original member CRC differs: "+entry.path);return bytes;
}
export async function verifyPublisherArchive(input,filename,{hashBytes,inflateRaw}){
  plainFilename(filename);requireValue(typeof hashBytes==="function"&&typeof inflateRaw==="function","Archive byte hash and Deflate reader required");
  const zip=inspectPublisherZip(input),inventory=[];
  for(const entry of zip.entries){
    const bytes=await readPublisherMember(zip,entry,inflateRaw);
    inventory.push({path:entry.path,directory:entry.directory,bytes:entry.bytes,compressed_bytes:entry.compressed_bytes,
      method:entry.method,crc32:entry.crc32,sha256:hashBytes(bytes),dos_time:entry.dos_time,dos_date:entry.dos_date});
  }
  return {filename,bytes:zip.bytes,sha256:hashBytes(zip.bytes),zip,inventory};
}
function same(a,b,api){return api.stable(a)===api.stable(b);}
export async function buildArchiveIntake(archive,member,request,{api,hash,hashBytes,inflateRaw}){
  requireValue(["official-original","derived-current-api-csv"].includes(request?.origin),"Declare the original publisher or prepared current-API CSV origin");
  requireValue(request.metadata?.archive_member===member,"Retain the exact selected archive member in the mapping request");
  if(request.origin==="official-original")requireValue(request.metadata.archive_url===request.metadata.source_url&&!!request.metadata.archive_url,"Retain the exact publisher archive URL in the mapping request");
  const entry=archive.zip.entries.find(e=>e.path===member&&!e.directory);requireValue(entry&&/\.csv$/i.test(member),"Choose the actual original CSV member");
  const bytes=await readPublisherMember(archive.zip,entry,inflateRaw),text=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);
  requireValue(hash(text)===hashBytes(bytes),"Original UTF-8 CSV bytes changed during decoding");
  const path=request.original_member||"original/"+member.split("/").at(-1),source={path,text,bytes:bytes.length,sha256:hashBytes(bytes)};
  const release=api.buildCsvRelease(source,request,hash),transfer=api.makeTransfer(release,[source]);
  api.receiveTransfer(transfer,hash);
  for(const [kind,proof]of Object.entries(release.manifest.date_provenance||{})){
    if(!proof.source_member)continue;
    requireValue(proof.source_url===request.metadata.archive_url,kind+" date member must reference this original archive URL");
    const original=archive.inventory.find(row=>row.path===proof.source_member&&!row.directory);
    requireValue(original&&original.sha256===proof.source_sha256,kind+" date attribution member is absent or its original SHA differs");
  }
  const packet={schema:ARCHIVE_VERSION,origin:request.origin==="official-original"?"publisher-original":"prepared-current-api-csv-package",archive:{filename:archive.filename,bytes:archive.bytes.length,sha256:archive.sha256,
      base64:archiveBase64(archive.bytes)},inventory:archive.inventory,selected_member:member,request,release:transfer};
  packet.archive_intake_id="cms-archive-"+hash(api.stable({archive_sha256:archive.sha256,selected_member:member,request,release_id:release.manifest.release_id}));
  return {packet,release,source,archive};
}
export async function receiveArchiveIntake(packet,services){
  const {api,hash}=services;
  requireValue(packet?.schema===ARCHIVE_VERSION&&packet.archive&&typeof packet.archive.sha256==="string","Use a complete publisher archive intake");
  requireValue(Number.isInteger(packet.archive.bytes)&&packet.archive.bytes>0&&packet.archive.bytes<=536870912,"Original archive size is invalid");
  requireValue(typeof packet.archive.base64==="string"&&packet.archive.base64.length<=Math.ceil(packet.archive.bytes/3)*4,"Original archive base64 length differs");
  const bytes=archiveUnbase64(packet.archive.base64);
  requireValue(bytes.length===packet.archive.bytes&&services.hashBytes(bytes)===packet.archive.sha256,"Original whole archive bytes differ");
  const archive=await verifyPublisherArchive(bytes,packet.archive.filename,services);
  requireValue(same(archive.inventory,packet.inventory,api),"Original archive inventory differs");
  const rebuilt=await buildArchiveIntake(archive,packet.selected_member,packet.request,services);
  requireValue(same(rebuilt.packet,packet,api),"Archive intake differs from complete original source");return rebuilt;
}
export async function inflatePublisherBrowser(bytes,expected){
  const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader(),chunks=[];let size=0;
  try{while(true){const item=await reader.read();if(item.done)break;size+=item.value.length;requireValue(size<=expected,"Deflate member exceeds its declared original size");chunks.push(item.value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}
  requireValue(size===expected,"Deflate member ended before its original size");
  const output=new Uint8Array(size);let offset=0;for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.length;}return output;
}
