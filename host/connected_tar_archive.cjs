'use strict';
// Convert only the trusted standard-library parser result; never parse or execute source.
const zip=require('./connected_zip.cjs'),core=require('./connected_application_archive.cjs');
const SCHEMA='commons.tar-source-receiving.v1';
const need=(ok,message)=>{if(!ok)throw Object.assign(Error(message),{code:'TAR_SOURCE_RECEIVING_REQUIRED'});};
function viewFromResult(result,raw,{identify,format,maxBytes=128*1024*1024,maxEntries=8192,maxUncompressedBytes=128*1024*1024}={}){
 need(typeof identify==='function'&&['tar','tar.gz'].includes(format),'Select the trusted original TAR parser and format');
 const id=identify(raw);
 need(raw.length<=maxBytes&&result?.status==='COMPLETE'&&result.schema==='commons.tar-archive.v1'&&result.applicationExecution===false&&
  result.archive?.bytes===id.bytes&&result.archive.sha256===id.sha256&&result.archive.format===format,
  'Trusted TAR result differs from the unchanged original archive');
 need(Array.isArray(result.entries)&&result.entries.length<=maxEntries,'Complete TAR member count exceeds its limit');
 const seen=new Set();let total=0;
 const entries=result.entries.map(row=>{
  need(row&&['file','directory'].includes(row.kind),'Unsupported original TAR member kind');
  core.relative(row.path,row.kind==='directory');
  need(!seen.has(row.path),'Duplicate original TAR path');seen.add(row.path);
  const data=zip.fromBase64(row.dataBase64);
  need(data.length===row.bytes&&identify(data).sha256===row.sha256,'Original TAR member bytes changed');
  need(Number.isSafeInteger(row.mode)&&row.mode>=0&&row.mode<=0o7777&&
   (row.kind!=='directory'||data.length===0),'Invalid original TAR mode/payload');
  total+=data.length;need(total<=maxUncompressedBytes,'Complete TAR source exceeds its byte limit');
  const {dataBase64,...metadata}=row;
  return {...metadata,data};
 });
 need(total===result.archive.uncompressedBytes&&Number.isSafeInteger(result.archive.expandedBytes)&&
  result.archive.expandedBytes<=maxUncompressedBytes,'Trusted TAR totals differ');
 return{schema:'commons.tar-archive.v1',archive:{...result.archive},entries};
}
function describeView(view,limits){
 const entries=view.entries.map(({data,...entry})=>entry);
 return{schema:SCHEMA,archive:{...view.archive,filename:view.archive.format==='tar'?'archive.tar':'archive.tar.gz'},
  limits:{maxBytes:limits.maxBytes,maxEntries:limits.maxEntries,maxUncompressedBytes:limits.maxUncompressedBytes},
  memberRoot:'members',entries};
}
module.exports={SCHEMA,viewFromResult,describeView};
