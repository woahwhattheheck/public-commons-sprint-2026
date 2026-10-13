import {sha256Utf8,sha256Bytes} from './sha256.mjs';
import {base64Decode,inspect,exportWorkspace,buildHandover} from './engine.mjs';
export const RECOVERY_SCHEMA='commons.application-packet-recovery.v1';
export function nativeFilename(path){const name=path.split('/').at(-1).replace(/\.csv$/,'');return 'table-'+name+'-'+sha256Utf8(name).sha256.slice(0,20)+'.csv';}
export function json(value){return JSON.stringify(value,null,2)+'\n';}
export function safeJSON(value){return JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');}
export function head(workspace){return workspace.journal.at(-1)?.hash||sha256Utf8(JSON.stringify([workspace.schema,workspace.id,workspace.title,workspace.createdAt])).sha256;}
export function recovery(workspace,drafts={},selection={},copyId=null){inspect(workspace);const record={schema:RECOVERY_SCHEMA,workspace,drafts,selection,...(copyId?{copyId}:{})};if(sha256Utf8(json(record)).bytes>192*1024*1024)throw Error('The complete recovery exceeds 192 MiB. Download raw unfinished values separately before reducing a draft.');return record;}
export function parseRecovery(text){
  if(sha256Utf8(text).bytes>192*1024*1024)throw Error('Open a complete recovery file within 192 MiB.');
  const value=JSON.parse(text),record=value.schema===RECOVERY_SCHEMA?value:{schema:RECOVERY_SCHEMA,workspace:value,drafts:{},selection:{}};
  inspect(record.workspace);
  if(!record.drafts||typeof record.drafts!=='object'||Array.isArray(record.drafts))throw Error('The unfinished drafts are not a complete object.');
  if(!record.selection||typeof record.selection!=='object'||Array.isArray(record.selection))throw Error('The saved selection is invalid.');
  for(const row of Object.values(record.drafts)){
    if(!row||typeof row!=='object'||Array.isArray(row)||!row.fields||typeof row.fields!=='object'||Array.isArray(row.fields))throw Error('A retained unfinished form is invalid.');
    if(!Number.isSafeInteger(row.baseRevision)||row.baseRevision<0||typeof row.baseHead!=='string'||!/^[a-f0-9]{64}$/.test(row.baseHead))throw Error('Retain each unfinished form’s original revision and head.');
    for(const value of Object.values(row.fields))if(typeof value!=='string'&&typeof value!=='boolean')throw Error('Retain unfinished values as exact strings or checkbox booleans.');
  }
  return record;
}
function stripModule(source){
  return source.replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm,'')
    .replace(/^export\s*\{[^}]+\};?\s*$/gm,'').replace(/^export\s+(?=(?:async\s+)?(?:function|class|const|let|var)\b)/gm,'');
}
export function bundleSource(source){
  for(const path of ['sha256.mjs','engine.mjs','portable.mjs','app.mjs','style.css','template.html','build.mjs','cli.mjs','README.md','BROWSER_OPERATING.md'])if(typeof source[path]!=='string')throw Error('Retain the complete source file '+path+'.');
  // Private closures preserve each original module's lexical names.
  const make=(path,names)=>'(function(){\n'+stripModule(source[path])+'\nreturn {'+names.join(',')+'};\n})()';
  return 'const SHA='+make('sha256.mjs',['sha256Utf8','sha256Bytes'])+';\nconst {sha256Utf8,sha256Bytes}=SHA;\n'+
    'const Engine='+make('engine.mjs',['SCHEMA','LIMITS','canonical','base64Encode','base64Decode','createWorkspace','inspect','apply','exportWorkspace','importWorkspace','nativeExport','buildHandover','renderReport','compareWorkspaces'])+';\n'+
    'const {base64Decode,inspect,exportWorkspace,buildHandover}=Engine;\n'+
    'const Portable='+make('portable.mjs',['RECOVERY_SCHEMA','nativeFilename','json','head','recovery','parseRecovery','workingHTML','zipBytes','completeFiles'])+';\n'+
    '(function(){\n'+stripModule(source['app.mjs'])+'\n})();';
}
export function workingHTML(source,record=null){
  const script=bundleSource(source);
  const payload={source,record,copyId:record?.copyId||'packet-'+(record?head(record.workspace):sha256Utf8(JSON.stringify(Object.keys(source))).sha256)};
  const template=source['template.html'];
  for(const token of ['__APPLICATION_STYLE__','__APPLICATION_BOOT__','__APPLICATION_CODE__'])if(template.split(token).length!==2)throw Error('The complete template must contain one '+token+'.');
  return template.replace('__APPLICATION_STYLE__',()=>source['style.css'])
    .replace('__APPLICATION_BOOT__',()=>safeJSON(payload))
    .replace('__APPLICATION_CODE__',()=>script.replace(/<\/script/gi,'<\\/script'));
}
const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc(bytes){let c=0xffffffff;for(const n of bytes)c=crcTable[(c^n)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
export function zipBytes(files){
  if(!Array.isArray(files)||files.length>65535)throw Error('ZIP member count exceeds the supported complete archive size.');
  const enc=new TextEncoder(),seen=new Set(),parts=[],centers=[];let offset=0,centerSize=0;
  const header=(size)=>new DataView(new ArrayBuffer(size));
  const u8=view=>new Uint8Array(view.buffer);
  for(const f of files){
    if(typeof f.path!=='string'||f.path.startsWith('/')||f.path.includes('\\')||f.path.split('/').some(x=>!x||x==='.'||x==='..')||/[\u0000-\u001f]/.test(f.path)||seen.has(f.path))throw Error('Archive paths must be distinct safe relative paths.');
    seen.add(f.path);const name=enc.encode(f.path),bytes=f.base64!==undefined?base64Decode(f.base64):enc.encode(f.content),sum=crc(bytes);
    if(name.length>65535||offset+bytes.length+name.length+30>=0xffffffff)throw Error('The complete archive exceeds the supported ZIP size.');
    const local=header(30);local.setUint32(0,0x04034b50,true);local.setUint16(4,20,true);local.setUint16(6,0x800,true);
    local.setUint16(12,33,true);local.setUint32(14,sum,true);local.setUint32(18,bytes.length,true);local.setUint32(22,bytes.length,true);local.setUint16(26,name.length,true);
    parts.push(u8(local),name,bytes);
    const central=header(46);central.setUint32(0,0x02014b50,true);central.setUint16(4,20,true);central.setUint16(6,20,true);central.setUint16(8,0x800,true);
    central.setUint16(14,33,true);central.setUint32(16,sum,true);central.setUint32(20,bytes.length,true);central.setUint32(24,bytes.length,true);central.setUint16(28,name.length,true);central.setUint32(42,offset,true);
    centers.push(u8(central),name);centerSize+=46+name.length;offset+=30+name.length+bytes.length;
  }
  const end=header(22);end.setUint32(0,0x06054b50,true);end.setUint16(8,files.length,true);end.setUint16(10,files.length,true);end.setUint32(12,centerSize,true);end.setUint32(16,offset,true);
  const total=offset+centerSize+22;if(total>=0xffffffff)throw Error('The complete archive exceeds the supported ZIP size.');
  const result=new Uint8Array(total);let cursor=0;for(const bytes of [...parts,...centers,u8(end)]){result.set(bytes,cursor);cursor+=bytes.length;}return result;
}
export function completeFiles(source,record){
  const files=buildHandover(record.workspace);
  files.push({path:'START_HERE.txt',mimeType:'text/plain',content:'Open Application_Packet_Workspace.html in a current browser. Keep the complete folder together for Packet_Review.html original-file links. Working_Recovery.json preserves saved history and this tab’s unfinished values. source/ contains the full maintained program and operating guides. All native exports retain their exact mapping and assessment.\n'});
  files.push({path:'Application_Packet_Workspace.html',mimeType:'text/html',content:workingHTML(source,record)});
  files.push({path:'Working_Recovery.json',mimeType:'application/json',content:json(record)});
  for(const [path,content]of Object.entries(source))files.push({path:'source/'+path,mimeType:'text/plain',content});
  const manifest=files.map(f=>({path:f.path,mimeType:f.mimeType,...(f.base64!==undefined?sha256Bytes(base64Decode(f.base64)):sha256Utf8(f.content))}));
  files.push({path:'CONTENTS.json',mimeType:'application/json',content:json({schema:'commons.application-packet-delivery.v1',workspaceId:record.workspace.id,head:head(record.workspace),files:manifest})});
  return files;
}
