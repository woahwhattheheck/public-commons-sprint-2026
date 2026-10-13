import {sha256Utf8,sha256Bytes} from './sha256.mjs';
import * as Engine from './engine.mjs';
export const RECOVERY_SCHEMA='commons.harbour-source-recovery.v1';
export const RECOVERY_BYTES=128*1024*1024;
export function json(value){return JSON.stringify(value,null,2)+'\n';}
export function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);}
export function genesis(ws){return sha256Utf8(canonical([ws.id,ws.title,ws.createdAt])).sha256;}
export function draftIdentity(record){return sha256Utf8(canonical(record)).sha256;}
export function head(ws){return sha256Utf8(canonical([genesis(ws),ws.revision,ws.operations.at(-1)||null])).sha256;}
export function compare(current,incoming){
  Engine.validateWorkspace(current);Engine.validateWorkspace(incoming);
  if(genesis(current)!==genesis(incoming))return 'different_workspace';
  const a=current.operations,b=incoming.operations,n=Math.min(a.length,b.length);
  for(let i=0;i<n;i++)if(canonical(a[i])!==canonical(b[i]))return 'diverged';
  return a.length===b.length?'identical':a.length>b.length?'incoming_ancestor':'incoming_descendant';
}
export function recovery(workspace,drafts={},selection={},copyId=null){
  Engine.validateWorkspace(workspace);
  const record={schema:RECOVERY_SCHEMA,workspace,drafts,selection,...(copyId?{copyId}:{})};
  validateDrafts(record);
  if(sha256Utf8(json(record)).bytes>RECOVERY_BYTES)throw Error('The complete working file, including unfinished writing, exceeds 128 MiB. Download raw unfinished values before reducing an oversized draft.');
  return record;
}
function validateDrafts(record){
  if(!record.drafts||typeof record.drafts!=='object'||Array.isArray(record.drafts))throw Error('Retain unfinished forms as a complete object.');
  if(!record.selection||typeof record.selection!=='object'||Array.isArray(record.selection))throw Error('Retain the complete current selection.');
  if(record.copyId!==undefined&&(typeof record.copyId!=='string'||!record.copyId||record.copyId.length>240))throw Error('The saved browser copy identity is invalid.');
  for(const value of Object.values(record.drafts)){
    if(!value||typeof value!=='object'||Array.isArray(value)||!value.fields||typeof value.fields!=='object'||Array.isArray(value.fields))throw Error('An unfinished form is not complete.');
    if(!Number.isSafeInteger(value.baseRevision)||value.baseRevision<0||!/^[a-f0-9]{64}$/.test(value.baseHead||''))throw Error('Retain each unfinished form’s exact original revision.');
    for(const field of Object.values(value.fields))if(typeof field!=='string'&&typeof field!=='boolean')throw Error('Keep unfinished text and checkbox values unchanged.');
  }
}
export function parseRecovery(text){
  if(sha256Utf8(text).bytes>RECOVERY_BYTES)throw Error('Open a complete working file within 128 MiB.');
  const value=JSON.parse(text);
  const record=value.schema===RECOVERY_SCHEMA?value:{schema:RECOVERY_SCHEMA,workspace:Engine.importWorkspace(text),drafts:{},selection:{}};
  Engine.validateWorkspace(record.workspace);validateDrafts(record);return record;
}
export function safeJSON(value){return JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');}
function strip(source){return source.replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm,'').replace(/^export\s*\{[^}]+\};?\s*$/gm,'').replace(/^export\s+(?=(?:async\s+)?(?:function|class|const|let|var)\b)/gm,'');}
function moduleSource(source,path){
  const body=source[path];if(typeof body!=='string')throw Error('Retain the complete source file '+path+'.');
  const entries=[...body.matchAll(/^export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)].map(m=>[m[1],m[1]]);
  for(const match of body.matchAll(/^export\s*\{([^}]+)\};?\s*$/gm))for(const item of match[1].split(',')){const named=item.trim().match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);if(!named)throw Error('Retain explicit supported named exports in '+path+'.');entries.push([named[2]||named[1],named[1]]);}
  const names=[...new Map(entries).entries()].map(([name,local])=>name===local?name:name+':'+local);
  if(!names.length)throw Error('Retain named exports in '+path+'.');
  return '(function(){\n'+strip(body)+'\nreturn {'+names.join(',')+'};\n})()';
}
export function bundleSource(source){
  for(const path of ['sha256.mjs','engine.mjs','portable.mjs','store.mjs','app.mjs','style.css','template.html','build.mjs','README.md','BROWSER_OPERATING.md'])if(typeof source[path]!=='string')throw Error('Retain complete source '+path+'.');
  return 'const SHA='+moduleSource(source,'sha256.mjs')+';\nconst {sha256Utf8,sha256Bytes}=SHA;\n'+
    'const Engine='+moduleSource(source,'engine.mjs')+';\n'+
    'const Portable='+moduleSource(source,'portable.mjs')+';\n'+
    'const Store='+moduleSource(source,'store.mjs')+';\n'+
    '(function(){\n'+strip(source['app.mjs'])+'\n})();';
}
export function workingHTML(source,record=null){
  const template=source['template.html'],script=bundleSource(source);
  const payload={source,record,copyId:record?.copyId||'harbour-'+(record?head(record.workspace):sha256Utf8(canonical(source)).sha256)};
  const replacements={__HARBOUR_STYLE__:source['style.css'],__HARBOUR_BOOT__:safeJSON(payload),__HARBOUR_CODE__:script.replace(/<\/script/gi,'<\\/script')};
  for(const token of Object.keys(replacements))if(template.split(token).length!==2)throw Error('The original template must contain exactly one '+token+'.');
  return template.replace(/__HARBOUR_(?:STYLE|BOOT|CODE)__/g,token=>replacements[token]);
}
const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc(bytes){let c=0xffffffff;for(const value of bytes)c=crcTable[(c^value)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
export function memberBytes(file){
  if((typeof file.text==='string')===(typeof file.base64==='string'))throw Error('A complete member needs exactly one text or binary body.');
  return typeof file.base64==='string'?Engine.decodeBase64(file.base64):Engine.utf8Bytes(file.text);
}
export function zipBytes(files){
  if(!Array.isArray(files)||files.length>65535)throw Error('The complete archive exceeds the supported member count.');
  const parts=[],central=[],seen=new Set();let offset=0,centralBytes=0;
  const make=n=>new DataView(new ArrayBuffer(n)),bytes=v=>new Uint8Array(v.buffer);
  for(const file of files){
    const path=file.path;
    if(typeof path!=='string'||path.startsWith('/')||path.includes('\\')||/[\u0000-\u001f]/.test(path)||path.split('/').some(p=>!p||p==='.'||p==='..')||seen.has(path))throw Error('Retain distinct safe relative archive paths.');
    seen.add(path);const name=Engine.utf8Bytes(path),body=memberBytes(file),identity=sha256Bytes(body),sum=crc(body);
    if((file.bytes!==undefined&&file.bytes!==identity.bytes)||(file.sha256!==undefined&&file.sha256!==identity.sha256))throw Error('Complete member identity differs: '+path);
    if(name.length>65535||offset+body.length+name.length+30>=0xffffffff)throw Error('The complete archive exceeds the supported ZIP size.');
    const local=make(30);local.setUint32(0,0x04034b50,true);local.setUint16(4,20,true);local.setUint16(6,0x800,true);local.setUint16(12,33,true);local.setUint32(14,sum,true);local.setUint32(18,body.length,true);local.setUint32(22,body.length,true);local.setUint16(26,name.length,true);
    parts.push(bytes(local),name,body);
    const entry=make(46);entry.setUint32(0,0x02014b50,true);entry.setUint16(4,20,true);entry.setUint16(6,20,true);entry.setUint16(8,0x800,true);entry.setUint16(14,33,true);entry.setUint32(16,sum,true);entry.setUint32(20,body.length,true);entry.setUint32(24,body.length,true);entry.setUint16(28,name.length,true);entry.setUint32(42,offset,true);
    central.push(bytes(entry),name);centralBytes+=46+name.length;offset+=30+name.length+body.length;
  }
  const end=make(22);end.setUint32(0,0x06054b50,true);end.setUint16(8,files.length,true);end.setUint16(10,files.length,true);end.setUint32(12,centralBytes,true);end.setUint32(16,offset,true);
  if(offset+centralBytes+22>=0xffffffff)throw Error('The complete archive exceeds the supported ZIP size.');
  const out=new Uint8Array(offset+centralBytes+22);let at=0;for(const value of [...parts,...central,bytes(end)]){out.set(value,at);at+=value.length;}return out;
}
export function sourcePath(path){return path.startsWith('migration-receiving/')?path:'harbour-source-workspace/'+path;}
export function completeFiles(source,record){
  recovery(record.workspace,record.drafts,record.selection,record.copyId);
  const original=Engine.buildHandover(record.workspace),files=original.files.map(f=>({...f}));
  const add=(path,type,text)=>files.push({path,type,text,...sha256Utf8(text)});
  add('START_HERE.txt','text/plain','Open Harbour_Source_Workspace.html in a current browser. Working_Recovery.json retains the whole workspace, this copy and unfinished form values. Keep every original file and report together. source/ holds the complete maintained program and its operating guides. Permission rows are source assertions, not local access controls.\n');
  add('Harbour_Source_Workspace.html','text/html',workingHTML(source,record));
  add('Working_Recovery.json','application/json',json(record));
  for(const [path,text]of Object.entries(source))add('source/'+sourcePath(path),'text/plain',text);
  const seen=new Set();for(const file of files){if(seen.has(file.path))throw Error('Duplicate complete member '+file.path);seen.add(file.path);}
  add('DELIVERY.json','application/json',json({schema:'commons.harbour-source-delivery.v1',workspaceId:record.workspace.id,revision:record.workspace.revision,head:head(record.workspace),files:files.map(({path,type,bytes,sha256})=>({path,type,bytes,sha256}))}));
  return files;
}
