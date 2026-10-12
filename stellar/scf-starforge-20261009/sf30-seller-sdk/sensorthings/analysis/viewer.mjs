// MIT. Pin and retain the original Helgoland static release; no package build.
import {inflateRawSync} from 'node:zlib';
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceDocument,identity,json,sha,plain,fault} from '../contract.mjs';
import {openPrivateFile,hashHeldFile} from '../portable.mjs';

export const HELGOLAND=Object.freeze({
  repository:'https://github.com/52North/helgoland',tag:'v2.2.3',commit:'a17117b955d3453af0cfc056be012ded507426b0',
  releaseId:34110418,assetId:28453125,filename:'helgoland-complete.zip',bytes:3687093,
  url:'https://github.com/52North/helgoland/releases/download/v2.2.3/helgoland-complete.zip',
  toolbox:{version:'10.0.0-beta.4',commit:'ddd2b20f40ddd5fc80084f8d336644a06d53a484'},
  licenceNotice:'The original Helgoland LICENSE/README identify Apache 2.0 while its package metadata says MIT. Both original declarations are retained without resolving the discrepancy.',
  sourceOnly:'The release bytes are verified when actually received. No unobserved publisher archive SHA is asserted.'
});
export const VIEWER_LIMITS=Object.freeze({expandedBytes:64*1024*1024,entries:5000,memberBytes:16*1024*1024,upstreamBytes:32*1024*1024,sourceManifestBytes:2*1024*1024});
const MAX_EXPANDED=VIEWER_LIMITS.expandedBytes,MAX_ENTRIES=VIEWER_LIMITS.entries,MAX_MEMBER=VIEWER_LIMITS.memberBytes,HASH=/^[a-f0-9]{64}$/;
const crcTable=Array.from({length:256},(_,n)=>{let v=n;for(let i=0;i<8;i++)v=v&1?0xedb88320^(v>>>1):v>>>1;return v>>>0;});
function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function memberName(value){
  if(typeof value!=='string'||!value||value.length>512||/[\u0000-\u001f\u007f\\]/.test(value)||value.startsWith('/')||
     value.split('/').filter((p,i,a)=>!(i===a.length-1&&p==='')).some(p=>!p||p==='.'||p==='..'||p.includes(':')))
    throw fault('VIEWER_ZIP_PATH','The released ZIP contains an unsafe member name.',409);
  return value;
}
export function unpackRelease(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length!==HELGOLAND.bytes)throw fault('VIEWER_ARCHIVE','Use the complete pinned publisher ZIP with its declared byte length.',409);
  let eocd=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50&&i+22+bytes.readUInt16LE(i+20)===bytes.length){eocd=i;break;}
  if(eocd<0)throw fault('VIEWER_ZIP','The original release lacks a complete ZIP directory.',409);
  const count=bytes.readUInt16LE(eocd+10),directoryBytes=bytes.readUInt32LE(eocd+12),directoryOffset=bytes.readUInt32LE(eocd+16);
  if(bytes.readUInt16LE(eocd+4)||bytes.readUInt16LE(eocd+6)||bytes.readUInt16LE(eocd+8)!==count||count>MAX_ENTRIES||
     count===65535||directoryOffset+directoryBytes!==eocd)throw fault('VIEWER_ZIP','Use the original bounded single-disk, non-ZIP64 release.',409);
  const members=[],names=new Set(),fileNames=new Set(),ranges=[];let cursor=directoryOffset,total=0;
  for(let i=0;i<count;i++){
    if(cursor+46>eocd||bytes.readUInt32LE(cursor)!==0x02014b50)throw fault('VIEWER_ZIP','A released directory entry is incomplete.',409);
    const flags=bytes.readUInt16LE(cursor+8),method=bytes.readUInt16LE(cursor+10),crc=bytes.readUInt32LE(cursor+16),
      compressed=bytes.readUInt32LE(cursor+20),expanded=bytes.readUInt32LE(cursor+24),nameBytes=bytes.readUInt16LE(cursor+28),
      extraBytes=bytes.readUInt16LE(cursor+30),commentBytes=bytes.readUInt16LE(cursor+32),attributes=bytes.readUInt32LE(cursor+38),local=bytes.readUInt32LE(cursor+42);
    const end=cursor+46+nameBytes+extraBytes+commentBytes;
    if(end>eocd||flags&1||![0,8].includes(method)||expanded>MAX_MEMBER||total+expanded>MAX_EXPANDED||
       ![0,0x8000,0x4000].includes((attributes>>>16)&0xf000)||bytes.readUInt16LE(cursor+34))throw fault('VIEWER_ZIP','The release contains an encrypted, linked or unsupported member.',409);
    let name;try{name=memberName(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(cursor+46,cursor+46+nameBytes)));}catch(e){if(e.code)throw e;throw fault('VIEWER_ZIP_PATH','The released member name is not UTF-8.',409);}
    const canonicalName=name.endsWith('/')?name.slice(0,-1):name;
    if(names.has(canonicalName))throw fault('VIEWER_ZIP_PATH','The released ZIP repeats a file/directory path.',409);names.add(canonicalName);
    if(!name.endsWith('/'))fileNames.add(name);
    const unixType=(attributes>>>16)&0xf000,isDirectory=name.endsWith('/');
    if(((unixType===0x4000||(attributes&0x10))&&!isDirectory)||(unixType===0x8000&&isDirectory))
      throw fault('VIEWER_ZIP','The released file/directory attributes contradict its original path.',409);
    if(isDirectory&&expanded!==0)throw fault('VIEWER_ZIP','A released directory has unexpected payload bytes.',409);
    if(local+30>directoryOffset||bytes.readUInt32LE(local)!==0x04034b50||bytes.readUInt16LE(local+8)!==method||bytes.readUInt16LE(local+6)!==flags)
      throw fault('VIEWER_ZIP','The released local header differs from its original directory.',409);
    const localNameBytes=bytes.readUInt16LE(local+26),data=local+30+localNameBytes+bytes.readUInt16LE(local+28),dataEnd=data+compressed;
    if(dataEnd>directoryOffset||!bytes.subarray(local+30,local+30+localNameBytes).equals(bytes.subarray(cursor+46,cursor+46+nameBytes)))
      throw fault('VIEWER_ZIP','The released member boundary or name is inconsistent.',409);
    let memberEnd=dataEnd;
    if(!(flags&8)){
      if(bytes.readUInt32LE(local+14)!==crc||bytes.readUInt32LE(local+18)!==compressed||bytes.readUInt32LE(local+22)!==expanded)
        throw fault('VIEWER_ZIP','The released local size/CRC differs from its central directory.',409);
    }else{
      const descriptorMatches=at=>at+12<=directoryOffset&&bytes.readUInt32LE(at)===crc&&
        bytes.readUInt32LE(at+4)===compressed&&bytes.readUInt32LE(at+8)===expanded;
      if(dataEnd+4<=directoryOffset&&bytes.readUInt32LE(dataEnd)===0x08074b50&&descriptorMatches(dataEnd+4))memberEnd=dataEnd+16;
      else if(descriptorMatches(dataEnd))memberEnd=dataEnd+12;
      else throw fault('VIEWER_ZIP','The released data descriptor differs from its central directory.',409);
    }
    ranges.push([local,memberEnd]);total+=expanded;
    let original;try{original=method===0?Buffer.from(bytes.subarray(data,dataEnd)):inflateRawSync(bytes.subarray(data,dataEnd),{maxOutputLength:Math.max(1,expanded)});}
    catch{throw fault('VIEWER_ZIP','A released compressed member could not be reproduced.',409);}
    if(original.length!==expanded||crc32(original)!==crc)throw fault('VIEWER_ZIP','A released member differs from its ZIP size/CRC.',409);
    if(!name.endsWith('/'))members.push({path:name,bytes:expanded,sha256:sha(original),original});cursor=end;
  }
  if(cursor!==eocd)throw fault('VIEWER_ZIP','Unexpected bytes remain in the released directory.',409);
  for(const name of names){const pieces=name.split('/');for(let i=1;i<pieces.length;i++)if(fileNames.has(pieces.slice(0,i).join('/')))
    throw fault('VIEWER_ZIP_PATH','A released file conflicts with a descendant asset directory.',409);}
  ranges.sort((a,b)=>a[0]-b[0]);if(ranges.some((r,i)=>i&&r[0]<ranges[i-1][1]))throw fault('VIEWER_ZIP','Released member byte ranges overlap.',409);
  const indexes=members.filter(m=>m.path==='index.html'||m.path.endsWith('/index.html')).sort((a,b)=>a.path.split('/').length-b.path.split('/').length);
  if(!indexes.length||indexes.length>1&&indexes[0].path.split('/').length===indexes[1].path.split('/').length)throw fault('VIEWER_ZIP','Select the single complete application release with an unambiguous root index.',409);
  const index=indexes[0],prefix=index.path.slice(0,-'index.html'.length),settings=members.find(m=>m.path===prefix+'assets/settings.json');
  if(!settings||!members.some(m=>m.path.startsWith(prefix)&&/\.js$/.test(m.path)))throw fault('VIEWER_ZIP','The original complete viewer assets/settings are absent.',409);
  return {members,prefix,indexPath:index.path,settingsPath:settings.path,expandedBytes:total};
}
async function readSourceFile(path,maximum){
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try{
    const before=await handle.stat({bigint:true});
    if(!before.isFile()||before.size<0n||before.size>BigInt(maximum))
      throw fault('VIEWER_SOURCE','Select a bounded original regular source/license file.',409);
    const bytes=await handle.readFile(),after=await handle.stat({bigint:true});
    if(bytes.length>maximum||['dev','ino','size','mtimeNs','ctimeNs'].some(key=>before[key]!==after[key])||BigInt(bytes.length)!==after.size)
      throw fault('VIEWER_SOURCE','The original source/license file changed during intake.',409);
    return bytes;
  }finally{await handle.close();}
}
export async function importViewer(store,{inboxDirectory,filename,expectedSha256,expectedBytes}){
  if(!inboxDirectory||filename!==HELGOLAND.filename||expectedBytes!==HELGOLAND.bytes||!HASH.test(expectedSha256??''))
    throw fault('VIEWER_INPUT','Choose the complete pinned Helgoland release in the original host-bound source inbox, with its observed SHA and length.');
  const source=await openPrivateFile(join(inboxDirectory,filename),{expectedBytes,maximum:HELGOLAND.bytes});
  let bytes;
  try{await hashHeldFile(source.handle,{expectedBytes,expectedSha256,maximum:HELGOLAND.bytes});bytes=await source.handle.readFile();
    if(bytes.length!==expectedBytes||sha(bytes)!==expectedSha256)throw fault('VIEWER_INPUT','The original viewer changed during intake.',409);}
  finally{await source.handle.close();}
  const unpacked=unpackRelease(bytes),archive=await store.putObject(bytes),members=[];
  for(const member of unpacked.members){const saved=await store.putObject(member.original);members.push({path:member.path,...saved});}
  const sourceRoot=fileURLToPath(new URL('./upstream/',import.meta.url)),licences=[];
  const manifestBytes=await readSourceFile(join(sourceRoot,'source-manifest.json'),VIEWER_LIMITS.sourceManifestBytes);
  sourceDocument(manifestBytes); // validate exact UTF-8/JSON; retain the original bytes below
  const sourceManifest=JSON.parse(manifestBytes.toString('utf8'));
  if(!plain(sourceManifest)||!Array.isArray(sourceManifest.files)||sourceManifest.files.length>MAX_ENTRIES)
    throw fault('VIEWER_SOURCE','The pinned upstream source manifest is incomplete or exceeds its entry capacity.',409);
  const sourceNames=new Set();let sourceBytes=0;
  for(const original of sourceManifest.files){
    if(!plain(original))throw fault('VIEWER_SOURCE','Each upstream source entry must be a complete original file descriptor.',409);
    const path=memberName(original.path);
    if(path.endsWith('/')||path==='source-manifest.json'||sourceNames.has(path)||!Number.isSafeInteger(original.bytes)||original.bytes<0||
       original.bytes>MAX_MEMBER||(sourceBytes+=original.bytes)>VIEWER_LIMITS.upstreamBytes)
      throw fault('VIEWER_SOURCE','The source manifest must bind unique bounded original files.',409);
    sourceNames.add(path);
    const body=await readSourceFile(join(sourceRoot,path),original.bytes);
    if(!HASH.test(original.sha256??'')||body.length!==original.bytes||sha(body)!==original.sha256)
      throw fault('VIEWER_SOURCE','The pinned upstream source or license differs from its manifest.',409);
    licences.push({...original,...await store.putObject(body)});
  }
  const manifestObject=await store.putObject(manifestBytes);
  licences.push({path:'source-manifest.json',...manifestObject});
  const body={schema:'stellar-forge.sensorthings-analysis-viewer.v1',upstream:HELGOLAND,archive,files:members,upstreamSources:licences,
    prefix:unpacked.prefix,indexPath:unpacked.indexPath,settingsPath:unpacked.settingsPath,expandedBytes:unpacked.expandedBytes,
    derivation:'Original archive/assets remain exact. Served index base/connection shim and settings are separately labeled local derivatives.'};
  return {id:identity(body),...body};
}
export function viewerSettings(original,{root,title,period}){
  if(!plain(original))throw fault('VIEWER_SETTINGS','The original viewer settings are invalid.',409);
  return {...original,datasetApis:[{name:title,url:root}],providerBlackList:[],proxyUrl:'',timespanPresets:[],
    mapLayers:[],baseMaps:[],defaultMapLayers:[],
    retainedSource:{root,period,externalRequests:'not configured',numericMeaning:ANALYSIS_NOTE}};
}
const ANALYSIS_NOTE='Native numeric diagrams use only original JSON numbers permitted by the retained numeric observation type, with explicit instantaneous times and finite browser values. Exact numbers remain in the source and CSV; categorical results remain source events.';
const escapeHTML=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function derivedIndex(original,{base,versionId,viewerId,mode,workspaceId,settingsPath='assets/settings.json'}){
  const expected='/analysis/viewer/'+viewerId+'/'+versionId+'/'+mode+'/';
  if(!HASH.test(versionId??'')||!HASH.test(viewerId??'')||!['map','numeric'].includes(mode)||base!==expected||
     typeof workspaceId!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(workspaceId))
    throw fault('VIEWER_BINDING','Use the exact installed viewer, saved version and original workspace.',409);
  memberName(settingsPath);
  let html=new TextDecoder('utf-8',{fatal:true}).decode(original);
  if(!/<head[\s>]/i.test(html)||!/<\/head>/i.test(html)||!/<body[\s>]/i.test(html))
    throw fault('VIEWER_INDEX','The released application index is invalid.',409);
  html=html.replace(/<base\b[^>]*>/gi,'');
  const meta='<base href="'+escapeHTML(base)+'"><meta name="retained-sensorthings-analysis" content="'+versionId+'">'+
    '<script src="/analysis/viewer-bridge.js" data-version="'+versionId+'" data-viewer="'+viewerId+'" data-mode="'+mode+
    '" data-workspace="'+workspaceId+'" data-settings-path="'+escapeHTML(settingsPath)+'"></script>';
  html=html.replace(/<head([^>]*)>/i,'<head$1>'+meta);
  const caption='<aside id="sensorthings-retained-caption" role="status">Saved observation selection · '+mode+
    ' · '+versionId.slice(0,12)+'<span id="sensorthings-viewer-connection-status"></span></aside>';
  const style='<style id="sensorthings-retained-style">body{padding-top:28px!important;box-sizing:border-box}'+
    '#sensorthings-retained-caption{position:fixed;z-index:2147483000;top:0;left:0;right:0;min-height:28px;'+
    'box-sizing:border-box;padding:5px 12px;background:#e8edf0;color:#253947;border-bottom:1px solid #a8b4bc;'+
    'font:12px/17px system-ui,sans-serif;overflow-wrap:anywhere}'+
    '#sensorthings-viewer-connection-status{font-weight:600;margin-left:10px}</style>';
  html=html.replace(/<\/head>/i,style+'</head>').replace(/<body([^>]*)>/i,'<body$1>'+caption);
  return Buffer.from(html);
}
