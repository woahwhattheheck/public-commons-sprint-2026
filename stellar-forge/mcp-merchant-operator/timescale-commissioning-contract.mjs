// MIT. Immutable complete commissioning reports from the original workspace.
import { failure, plain } from './host-files.mjs';
export const COMMISSIONING_MANIFEST='Timescale_Commissioning_Manifest.json';
export const COMMISSIONING_SCHEMA='stellar-forge.timescale-commissioning-download.v1';
export const COMMISSIONING_MANIFEST_BYTES=65536;
export const COMMISSIONING_REPORT_BYTES=256000000;
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,HASH=/^[a-f0-9]{64}$/;
export function commissioningReportId(value){
  if(typeof value!=='string'||!UUID.test(value))throw failure('TIMESCALE_COMMISSIONING_REPORT_ID','Use the original completed report request UUID.');
  return value;
}
export function parseCommissioningManifest(bytes,exportId){
  if(bytes.length<1||bytes.length>COMMISSIONING_MANIFEST_BYTES)throw failure('TIMESCALE_COMMISSIONING_MANIFEST','Use the complete original report manifest.');
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{throw failure('TIMESCALE_COMMISSIONING_MANIFEST','The manifest must retain its exact UTF-8 JSON.');}
  if(!plain(value)||value.schema!==COMMISSIONING_SCHEMA||value.complete!==true||
      value.exportId!==commissioningReportId(exportId)||!UUID.test(value.workspaceId??'')||
      !UUID.test(value.commissioningId??'')||!Number.isSafeInteger(value.revision)||value.revision<1||
      !HASH.test(value.digest??'')||!Number.isSafeInteger(value.workspaceVersion)||value.workspaceVersion<0||
      typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt))||
      !Array.isArray(value.files)||value.files.length!==2)
    throw failure('TIMESCALE_COMMISSIONING_MANIFEST','The retained report identity is incomplete.');
  const names=new Set();
  for(const file of value.files){
    if(!plain(file)||!['report.json','report.html'].includes(file.name)||names.has(file.name)||
        !HASH.test(file.sha256??'')||!Number.isSafeInteger(file.bytes)||file.bytes<1||file.bytes>COMMISSIONING_REPORT_BYTES)
      throw failure('TIMESCALE_COMMISSIONING_MANIFEST','Keep both complete report files and their original sizes and hashes.');
    names.add(file.name);
  }
  return value;
}
