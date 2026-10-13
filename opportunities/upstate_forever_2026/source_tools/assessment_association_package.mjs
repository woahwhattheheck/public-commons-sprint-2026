// Complete portable report package using the retained archive codec.
import { createArchiveCodec } from "./archive_codec.mjs";
const codec = createArchiveCodec();
const bytes = value => typeof value === "string" ? codec.utf8Encode(value) : value;
export function zipReportFiles(files, { compress = false } = {}) {
  const locals = [], centrals = []; let offset = 0, centralBytes = 0;
  const u16 = (data,p,v) => { data[p]=v&255; data[p+1]=(v>>>8)&255; };
  const u32 = (data,p,v) => { for(let i=0;i<4;i++)data[p+i]=(v>>>(8*i))&255; };
  const entries=Object.entries(files).sort(([a],[b])=>a.localeCompare(b));
  if(entries.length>65535)throw Error("Too many portable report members");
  for(const [path,value] of entries) {
    if(!/^[A-Za-z0-9_./-]+$/.test(path)||path.startsWith("/")||path.split("/").some(p=>!p||p==="."||p===".."))
      throw Error("Invalid report member path");
    const name=codec.utf8Encode(path),data=bytes(value),crc=codec.crc32(data);
    const packed=compress?codec.deflateRaw(data):data,method=compress?8:0;
    if(data.length>0xffffffff||offset+30+name.length+packed.length>0xffffffff)throw Error("Report exceeds ZIP32 limits");
    const local=new Uint8Array(30+name.length+packed.length);
    u32(local,0,0x04034b50);u16(local,4,20);u16(local,6,0x0800);u16(local,8,method);u16(local,12,33);
    u32(local,14,crc);u32(local,18,packed.length);u32(local,22,data.length);u16(local,26,name.length);
    local.set(name,30);local.set(packed,30+name.length);
    const central=new Uint8Array(46+name.length);
    u32(central,0,0x02014b50);u16(central,4,0x0314);u16(central,6,20);u16(central,8,0x0800);u16(central,10,method);u16(central,14,33);
    u32(central,16,crc);u32(central,20,packed.length);u32(central,24,data.length);u16(central,28,name.length);
    u32(central,38,0o100644*65536);u32(central,42,offset);central.set(name,46);
    locals.push(local);centrals.push(central);offset+=local.length;centralBytes+=central.length;
  }
  const end=new Uint8Array(22);u32(end,0,0x06054b50);u16(end,8,entries.length);u16(end,10,entries.length);
  u32(end,12,centralBytes);u32(end,16,offset);
  const out=new Uint8Array(offset+centralBytes+end.length);let position=0;
  for(const part of [...locals,...centrals,end]){out.set(part,position);position+=part.length;}
  return out;
}
export function packageAssociationReport(report) {
  const files={...report.files};
  const archive=zipReportFiles(files);
  const descriptor={path:"assessment-associations.zip",bytes:archive.length,sha256:codec.sha256(archive)};
  const manifest=JSON.parse(files["sources.json"]);
  if(manifest.entries?.length!==1||manifest.entries[0].id!==report.sourceId)throw Error("Report source manifest differs");
  manifest.entries[0].companions.push(descriptor);
  manifest.entries[0].portable_report={
    ...descriptor,
    description:"Self-contained original report, data tables, exact inputs and source manifest. This archive precedes its outer download registration."
  };
  files[descriptor.path]=archive;
  files["sources.json"]=JSON.stringify(manifest,null,2)+"\n";
  return {...report,files,archive:descriptor};
}
