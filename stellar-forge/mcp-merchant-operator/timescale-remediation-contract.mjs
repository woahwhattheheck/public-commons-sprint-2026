// MIT. Complete immutable reports from the original Timescale remediation journal.
import { failure, plain } from './host-files.mjs';
export const REMEDIATION_MANIFEST = 'Timescale_Remediation_Manifest.json';
export const REMEDIATION_SCHEMA = 'stellar-forge.timescale-remediation-download.v1';
export const REMEDIATION_MANIFEST_BYTES = 65536;
export const REMEDIATION_REPORT_BYTES = 256 * 1024 * 1024;
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/, HASH=/^[a-f0-9]{64}$/;
export function remediationReportId(value) {
  if(typeof value!=='string'||!UUID.test(value))throw failure('TIMESCALE_REPORT_ID','Use the original report request UUID.');
  return value;
}
export function parseRemediationManifest(bytes,exportId) {
  if(bytes.length<1||bytes.length>REMEDIATION_MANIFEST_BYTES)
    throw failure('TIMESCALE_REPORT_MANIFEST','Use the complete original report manifest within 64 KiB.');
  let value;
  try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{throw failure('TIMESCALE_REPORT_MANIFEST','The original manifest is not exact UTF-8 JSON.');}
  if(!plain(value)||value.schema!==REMEDIATION_SCHEMA||value.complete!==true||
      value.exportId!==remediationReportId(exportId)||!UUID.test(value.workspaceId??'')||
      !UUID.test(value.workItemId??'')||!Number.isSafeInteger(value.itemRevision)||value.itemRevision<1||
      !HASH.test(value.itemDigest??'')||!Number.isSafeInteger(value.workspaceVersion)||value.workspaceVersion<0||
      typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt))||
      !Array.isArray(value.files)||value.files.length!==2)
    throw failure('TIMESCALE_REPORT_MANIFEST','The original report identity is incomplete.');
  const names=new Set();
  for(const file of value.files) {
    if(!plain(file)||!['report.json','report.html'].includes(file.name)||names.has(file.name)||
        !HASH.test(file.sha256??'')||!Number.isSafeInteger(file.bytes)||file.bytes<1||file.bytes>REMEDIATION_REPORT_BYTES)
      throw failure('TIMESCALE_REPORT_MANIFEST','Both complete report files need their original byte counts and digests.');
    names.add(file.name);
  }
  return value;
}
