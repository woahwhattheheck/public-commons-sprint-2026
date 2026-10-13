// MIT. Complete report-editorial delivery identities, shared by host and receiver.
import {need,plain,identity,REPORT_REVIEW_SHA,encode,digest} from './report-editorial-records.mjs';
export const EDITORIAL_MANIFEST='report-editorial-delivery.json';
export const EDITORIAL_DELIVERY='stellar-forge.report-editorial-delivery.v1';
export const EDITORIAL_FILE_BYTES=512*1024*1024;
export function descriptor(f){
  need(plain(f)&&typeof f.name==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(f.name)&&
    Number.isSafeInteger(f.bytes)&&f.bytes>=0&&f.bytes<=EDITORIAL_FILE_BYTES&&
    typeof f.sha256==='string'&&REPORT_REVIEW_SHA.test(f.sha256)&&typeof f.contentType==='string'&&f.contentType.length<=160,
    'Retain the exact complete editorial file descriptor.');return f;
}
export function parseEditorialDelivery(raw,expectedId){
  need(raw.length<=65000,'Read the complete bounded delivery manifest.');
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  need(plain(value)&&value.schema===EDITORIAL_DELIVERY&&typeof value.workspace==='string'&&
    /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value.workspace)&&REPORT_REVIEW_SHA.test(value.exportId),
    'Read an original report editorial delivery manifest.');
  identity(value.workspaceId);identity(value.issueId);
  need(REPORT_REVIEW_SHA.test(value.issueSha256)&&REPORT_REVIEW_SHA.test(value.sourceSha256),
    'Retain the original report and issue identities.');
  if(value.returnId!==null)identity(value.returnId);
  if(value.applyId!==null)identity(value.applyId);
  need(Array.isArray(value.files)&&value.files.length>=2&&value.files.length<=8,'Retain every selected original editorial file.');
  const names=new Set();
  for(const f of value.files){descriptor(f);need(!names.has(f.name)&&f.name!==EDITORIAL_MANIFEST,'Every complete member needs its original unique name.');names.add(f.name);}
  need(names.has('package.json')&&names.has('review.html'),'Retain the complete original report package and recipient HTML.');
  if(value.returnId!==null)need(names.has('returned-review.json'),'Retain the exact attributed returned review.');
  if(value.applyId!==null)need(names.has('application.json'),'Retain the exact original application outcome.');
  const {exportId,...body}=value;
  need(digest(encode(body))===exportId&&(!expectedId||expectedId===exportId),'The complete editorial manifest changed.','REPORT_REVIEW_DELIVERY_CHANGED');
  return value;
}
