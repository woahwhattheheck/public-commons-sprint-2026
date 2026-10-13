'use strict';
// Bind selected mixed-language source to the unchanged whole original ZIP.
// Parsing Python/JavaScript remains the maintained collectors' responsibility.
const zip=require('./connected_zip.cjs');
const SCHEMA='commons.application-archive-source.v1';
const need=(ok,message)=>{if(!ok)throw Object.assign(Error(message),{code:'APPLICATION_ARCHIVE_SOURCE'});};
const equal=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
function relative(value,root=false){
 if(root&&value==='.')return value;
 need(typeof value==='string'&&value&&!value.startsWith('/')&&!/[\\\x00-\x1f\x7f:]/.test(value),'Select an exact portable archive-relative path');
 for(const p of value.split('/'))need(p&&p!=='.'&&p!=='..'&&!/[. ]$/.test(p)&&!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p),'Nonportable source path: '+value);
 return value;
}
function originalBytes(row){
 need(row&&typeof row.content==='string','Retain the complete source member');
 if(row.encoding==='base64')return zip.fromBase64(row.content);
 need(row.encoding===undefined||row.encoding==='utf-8','Unsupported original source encoding');
 return zip.utf8(row.content);
}
function bindArchiveSource({archiveView,memberRoot,source,identify}={}){
 relative(memberRoot,true);need(typeof identify==='function','Use the original byte identifier');
 need(archiveView?.schema==='commons.zip-archive.v1'&&Array.isArray(archiveView.entries),'Use the original complete ZIP view');
 need(source?.schema==='commons.application-source-closure/v1'&&Array.isArray(source.files)&&Array.isArray(source.directories),'Use the original complete mixed-language source packet');
 const files=new Map(),directories=new Set(['.']);
 for(const entry of archiveView.entries){
  relative(entry.path);
  need(!files.has(entry.path),'Duplicate archive member');
  const parts=entry.path.split('/');for(let n=1;n<parts.length;n++)directories.add(parts.slice(0,n).join('/'));
  if(entry.kind==='directory')directories.add(entry.path);else{need(entry.kind==='file','Only ordinary files/directories may supply source');files.set(entry.path,entry);}
 }
 need(directories.has(memberRoot)&&!files.has(memberRoot),'Selected application root is not an original archive directory');
 const name=p=>p==='.'?memberRoot:memberRoot==='.'?p:memberRoot+'/'+p;
 const rows=[],seen=new Set();
 for(const row of source.files){
  relative(row.path);need(!seen.has(row.path),'Duplicate selected source member');seen.add(row.path);
  const entry=files.get(name(row.path));need(entry,'Selected source is absent from the complete archive: '+row.path);
  const raw=originalBytes(row),id=identify(raw);
  need(equal(raw,entry.data),'Selected source bytes differ from the original archive: '+row.path);
  need(row.bytes===id.bytes&&row.sha256===id.sha256&&row.git_blob_sha1===id.git_blob_sha1,'Selected source identity differs: '+row.path);
  const mode=(entry.mode&0o111)?'100755':'100644';
  need(row.mode===mode,'Selected source executable mode differs: '+row.path);
  rows.push({path:row.path,archivePath:entry.path,...id,mode});
 }
 for(const p of source.directories){relative(p);need(directories.has(name(p))&&!files.has(name(p)),'Selected directory is absent from the original archive: '+p);}
 const observations=source.python?.analysis?.observations;
 need(Array.isArray(observations),'Retain complete original Python search observations');
 for(const row of observations){
  relative(row.path,true);const p=name(row.path),kind=files.has(p)?'file':directories.has(p)?'directory':'missing';
  need(row.kind===kind,'Original archive contradicts a retained Python search: '+row.path);
 }
 return {schema:'commons.application-archive-binding.v1',memberRoot,files:rows,
  directories:[...source.directories],archiveFiles:files.size,archiveDirectories:directories.size-1,
  selectedFiles:rows.length,unselectedArchiveFiles:[...files.keys()].filter(p=>!rows.some(r=>r.archivePath===p)).sort(),
  sourceExecution:false};
}
module.exports={SCHEMA,relative,bindArchiveSource};
