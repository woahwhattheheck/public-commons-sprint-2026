// MIT. Original complete-package format shared by host export and Node-only receiving.
import { createHash } from 'node:crypto';
import { MAX_RETAINED_CHUNK_BYTES } from '../../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import { packageName } from './package-name.mjs';

export const PACKAGE_EXPORT_SCHEMA='stellar-forge.api-merchant-package-export.v1';
export const PACKAGE_EXPORT_MANIFEST='package-export.json';
export const PACKAGE_EXPORT_MAX_BYTES=128*1024*1024;
export const PACKAGE_EXPORT_MAX_FILE_BYTES=32*1024*1024;
export const PACKAGE_EXPORT_MAX_CHUNK_BYTES=MAX_RETAINED_CHUNK_BYTES;
export const MANIFEST_LIMIT=65000;
const HASH=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const TOP_FILES=new Set(['original-openapi.json','original-openapi.yaml','merchant-plan.json',
  'facade-openapi.json','selections.json','route-bindings.json','upstreams.json',
  'operator-cases.json','source-revision.json']);
const REQUIRED=['merchant-package.json','RUN.md','merchant-plan.json','facade-openapi.json',
  'selections.json','route-bindings.json','upstreams.json','compiled/manifest.json',
  'compiled/offers.json','compiled/seller-service.json'];
export const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export const sha=v=>createHash('sha256').update(v).digest('hex');
export const encode=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
export const decode=v=>new TextDecoder('utf-8',{fatal:true}).decode(v);
const normalize=v=>Array.isArray(v)?v.map(normalize):plain(v)
  ?Object.fromEntries(Object.keys(v).sort().map(k=>[k,normalize(v[k])])):v;
export const canonical=v=>JSON.stringify(normalize(v));
export const fail=(message,code='PACKAGE_TRANSFER_INVALID',status=400)=>{
  throw Object.assign(new Error(message),{code,status});
};
export function exact(value,allowed,required=[]) {
  if(!plain(value)||Object.keys(value).some(key=>!allowed.includes(key))||required.some(key=>!Object.hasOwn(value,key)))
    fail('Supply the original package-transfer fields.');
}
export function digest(value,label='manifest') {
  if(typeof value!=='string'||!HASH.test(value))fail('Supply the exact SHA-256 of the selected '+label+'.');
  return value;
}
export function exportIdentifier(value) { return digest(value,'retained export ID'); }
export function selectedFile(name) {
  if(typeof name!=='string'||!name||name.length>180)fail('Select an original immutable package file.');
  if(name==='merchant-package.json'||name==='RUN.md'||TOP_FILES.has(name)||
      ['compiled/manifest.json','compiled/offers.json','compiled/seller-service.json'].includes(name)||
      /^compiled\/responses\/[A-Za-z0-9_-]{1,64}\.json$/.test(name))return name;
  fail('This path is outside the original immutable package file set.');
}
export const isPackageSourceFile = name => TOP_FILES.has(name);
export const isPackageExportHash = value => HASH.test(value);
export const isPackageReadId = value => UUID.test(value);

function manifestCore(value) {
  return {schema:value.schema,package:value.package,files:value.files,totalBytes:value.totalBytes};
}
/** Shared by original HTTP receiving and the original retained-download adapter. */
export function parseMerchantPackageExport(bytes,exportId) {
  if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>MANIFEST_LIMIT)
    fail('An original package export manifest must be 1–65,000 bytes.');
  let value;
  try{value=JSON.parse(decode(bytes));}catch{fail('Read the original package export JSON bytes.');}
  exact(value,['schema','exportId','package','files','totalBytes'],['schema','exportId','package','files','totalBytes']);
  if(value.schema!==PACKAGE_EXPORT_SCHEMA||!HASH.test(value.exportId??'')||
      exportId!==undefined&&value.exportId!==exportIdentifier(exportId))fail('The retained package export identity differs.');
  exact(value.package,['name','id','manifestSha256','sourceFile','sourceSha256','planSha256','sourceRevisionSha256','createdAt'],
    ['name','id','manifestSha256','sourceFile','sourceSha256','planSha256','createdAt']);
  packageName(value.package.name);
  if(!UUID.test(value.package.id??'')||
      !['original-openapi.json','original-openapi.yaml'].includes(value.package.sourceFile)||
      typeof value.package.createdAt!=='string'||!Number.isFinite(Date.parse(value.package.createdAt))||
      !['manifestSha256','sourceSha256','planSha256'].every(k=>HASH.test(value.package[k]??''))||
      value.package.sourceRevisionSha256!==undefined&&!HASH.test(value.package.sourceRevisionSha256))
    fail('The export must retain its original package UUID and input hashes.');
  if(!Array.isArray(value.files)||value.files.length<REQUIRED.length+1||value.files.length>256)
    fail('The export must list its complete original source and compiled files.');
  const names=new Set();let total=0;
  for(const file of value.files) {
    exact(file,['name','bytes','sha256'],['name','bytes','sha256']);selectedFile(file.name);
    if(names.has(file.name)||!Number.isSafeInteger(file.bytes)||file.bytes<0||
        file.bytes>PACKAGE_EXPORT_MAX_FILE_BYTES||!HASH.test(file.sha256??''))
      fail('Invalid or duplicated original file identity.');
    names.add(file.name);total+=file.bytes;
  }
  if(REQUIRED.some(name=>!names.has(name))||!names.has(value.package.sourceFile)||
      names.has(value.package.sourceFile==='original-openapi.json'?'original-openapi.yaml':'original-openapi.json')||
      names.has('source-revision.json')!==Object.hasOwn(value.package,'sourceRevisionSha256')||
      total!==value.totalBytes||total>PACKAGE_EXPORT_MAX_BYTES)
    fail('The transfer manifest has an incomplete original file set or byte total.');
  const byName=new Map(value.files.map(file=>[file.name,file]));
  if(byName.get('merchant-package.json').sha256!==value.package.manifestSha256||
      byName.get(value.package.sourceFile).sha256!==value.package.sourceSha256||
      byName.get('merchant-plan.json').sha256!==value.package.planSha256||
      names.has('source-revision.json')&&byName.get('source-revision.json').sha256!==value.package.sourceRevisionSha256)
    fail('The original package identity differs from its selected file hashes.');
  if(sha(canonical(manifestCore(value)))!==value.exportId)
    fail('The original export identity does not match its complete file manifest.');
  return value;
}
