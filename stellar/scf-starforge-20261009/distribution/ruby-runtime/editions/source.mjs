// MIT. Inspect the exact completed Ruby data packet selected for a managed application edition.
import { join } from 'node:path';
import { absolute, directory, digest, need, plain, regular, sha, member } from '../files.mjs';

const NATIVE = new Set(['stellar-forge.ruby-native-dataset-delivery.v1','stellar-forge.ruby-dataset-delivery.v1']);
async function read(root,name,maximum,expected) {
  const path=join(root,member(name)),bytes=await regular(path,maximum);
  const observed={name,bytes:bytes.length,sha256:digest(bytes)};
  if(expected!==undefined)need(observed.sha256===sha(expected),'RUBY_EDITION_SOURCE_CHANGED',undefined,409);
  let value;
  try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{need(false,'RUBY_EDITION_SOURCE_JSON');}
  need(plain(value),'RUBY_EDITION_SOURCE_JSON');
  return {value,manifest:observed};
}
function descriptor(value) {
  need(plain(value)&&typeof value.name==='string'&&Number.isSafeInteger(value.bytes)&&value.bytes>=0&&
    /^[a-f0-9]{64}$/.test(value.sha256),'RUBY_EDITION_SOURCE_FILE');
  member(value.name);return value;
}
/** Selects original metadata. The staged Ruby receiver validates and copies every retained byte before review. */
export async function previewApplicationEditionSource(input={}) {
  need(plain(input)&&Object.keys(input).every(key=>['format','directory','expectedManifestSha256'].includes(key)),
    'RUBY_EDITION_ARGUMENTS');
  need(['native','baserow'].includes(input.format),'RUBY_EDITION_FORMAT');
  const root=await directory(absolute(input.directory)),isBaserow=input.format==='baserow';
  const original=await read(root,isBaserow?'baserow-delivery.json':'dataset-customer.json',
    isBaserow?1048576:4194304,input.expectedManifestSha256);
  let dataset=original,datasetDirectory=root,customer=null;
  if(isBaserow) {
    const m=original.value;
    need(m.schema==='stellar-forge.ruby-baserow-customer-delivery.v1'&&
      m.dataset?.directory==='dataset'&&/^[a-f0-9]{64}$/.test(m.dataset.manifestSha256)&&
      m.customer?.directory==='customer'&&m.customer.manifest==='customer-manifest.json'&&
      /^[a-f0-9]{64}$/.test(m.customer.manifestSha256),'RUBY_EDITION_SOURCE_FORMAT');
    datasetDirectory=await directory(join(root,'dataset'));
    dataset=await read(datasetDirectory,'dataset-customer.json',4194304,m.dataset.manifestSha256);
    customer=await read(await directory(join(root,'customer')),'customer-manifest.json',4194304,m.customer.manifestSha256);
    need(dataset.value.datasetId===m.datasetId&&dataset.value.sourceKey===m.sourceKey&&
      customer.value.sourceKey===m.sourceKey,'RUBY_EDITION_SOURCE_BINDING',undefined,409);
  }
  const m=dataset.value;
  need(NATIVE.has(m.schema)&&Number.isSafeInteger(m.rowCount)&&m.rowCount>=0&&m.rowCount<=1000000&&
    Array.isArray(m.fields)&&m.fields.length>=1&&m.fields.length<=64&&
    m.fields.every(value=>typeof value==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(value))&&
    new Set(m.fields).size===m.fields.length&&Array.isArray(m.files)&&m.files.every(descriptor)&&
    new Set(m.files.map(file=>file.name)).size===m.files.length&&
    /^[a-f0-9]{64}$/.test(m.snapshot)&&/^[a-f0-9]{64}$/.test(m.sourceSha256),
    'RUBY_EDITION_SOURCE_FORMAT');
  const nativeDescriptor=m.files.find(file=>file.name==='manifest.json');
  need(nativeDescriptor&&nativeDescriptor.bytes<=4194304,'RUBY_EDITION_SOURCE_MANIFEST');
  const native=await read(datasetDirectory,'manifest.json',4194304,nativeDescriptor.sha256);
  need(native.manifest.bytes===nativeDescriptor.bytes&&
    native.value.dataset?.rows===m.rowCount&&native.value.dataset.snapshot===m.snapshot&&
    JSON.stringify(native.value.dataset.projectedFields)===JSON.stringify(m.fields),
    'RUBY_EDITION_SOURCE_BINDING',undefined,409);
  return {schema:'stellar-forge.ruby-application-edition-source-preview.v1',format:input.format,
    directory:root,manifest:original.manifest,original:original.value,
    dataset:{manifest:dataset.manifest,directory:datasetDirectory,schema:m.schema,
      datasetId:m.datasetId,sourceKey:m.sourceKey??null,sourceFormat:m.sourceFormat??'SF88_SESSION',
      rowCount:m.rowCount,fields:m.fields,snapshot:m.snapshot,sourceSha256:m.sourceSha256,
      querySha256:native.value.dataset.originalQueryHash,definition:native.value.dataset},
    ...(customer?{customer:{manifest:customer.manifest,original:customer.value}}:{})};
}
