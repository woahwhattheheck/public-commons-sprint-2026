// MIT. Complete original Timescale package transported by the maintained file receiver.
import { failure, plain } from './host-files.mjs';
export const TIMESCALE_DOWNLOAD_MANIFEST = 'Timescale_Download_Manifest.json';
export const TIMESCALE_DOWNLOAD_SCHEMA = 'stellar-forge.timescale-download-manifest.v1';
export const TIMESCALE_MANIFEST_BYTES = 64 * 1024 * 1024;
export const TIMESCALE_FILE_BYTES = 8 * 1024 * 1024 * 1024;
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/, HASH=/^[a-f0-9]{64}$/;
export function timescaleExportId(value) {
  if(typeof value!=='string'||!UUID.test(value))throw failure('TIMESCALE_DOWNLOAD_CONFIGURATION','Use the retained original export UUID.');
  return value;
}
export function parseTimescaleDownloadManifest(bytes,exportId) {
  if(bytes.length<1||bytes.length>TIMESCALE_MANIFEST_BYTES)
    throw failure('TIMESCALE_DOWNLOAD_MANIFEST_INVALID','The complete original manifest exceeds 64 MiB.');
  let value;
  try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{throw failure('TIMESCALE_DOWNLOAD_MANIFEST_INVALID','Use the exact retained UTF-8 manifest.');}
  if(!plain(value)||value.schema!==TIMESCALE_DOWNLOAD_SCHEMA||value.exportId!==timescaleExportId(exportId)||
      !UUID.test(value.workspaceId??'')||typeof value.workspace!=='string'||
      !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value.workspace)||!HASH.test(value.nativeManifestSha256??'')||
      !Array.isArray(value.files)||value.files.length<7||value.files.length>262144||
      !Array.isArray(value.directories)||value.directories.length>262144)
    throw failure('TIMESCALE_DOWNLOAD_MANIFEST_INVALID','The complete package identity is invalid.');
  const names=new Set();let total=0;
  for(const file of value.files){
    const name=file?.name;
    if(!plain(file)||typeof name!=='string'||name.length>4096||
        !/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/.test(name)||
        name.split('/').some(part=>part==='.'||part==='..')||name.split('/').length>32||
        name!=='manifest.json'&&!/^(workspace|dataset)\//.test(name)||names.has(name)||
        !HASH.test(file.sha256??'')||!Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>TIMESCALE_FILE_BYTES)
      throw failure('TIMESCALE_DOWNLOAD_MANIFEST_INVALID','The original complete file list has an invalid path, digest or size.');
    names.add(name);total+=file.bytes;
    if(!Number.isSafeInteger(total))throw failure('TIMESCALE_DOWNLOAD_MANIFEST_INVALID','The complete file byte count exceeds exact integer representation.');
  }
  const directories=new Set();
  for(const name of value.directories){
    if(typeof name!=='string'||name.length>4096||!/^workspace(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/.test(name)||
        name.split('/').some(part=>part==='.'||part==='..')||name.split('/').length>32||directories.has(name)||names.has(name))
      throw failure('TIMESCALE_DOWNLOAD_MANIFEST_INVALID','The native package directory inventory is invalid.');
    directories.add(name);
  }
  const native=value.files.find(file=>file.name==='manifest.json');
  if(!native||native.sha256!==value.nativeManifestSha256||native.bytes>TIMESCALE_MANIFEST_BYTES)
    throw failure('TIMESCALE_DOWNLOAD_MANIFEST_INVALID','The original native manifest must be included byte-for-byte.');
  for(const name of ['workspace/workspace.json','workspace/timescale.sqlite','workspace/publisher/workspace.json',
    'workspace/publisher/publisher.sqlite','workspace/connection/source.json','workspace/connection/source-original.json'])
    if(!names.has(name))throw failure('TIMESCALE_DOWNLOAD_MANIFEST_INVALID','The original Timescale project is incomplete.');
  if(value.target&&!names.has('dataset/state.json'))
    throw failure('TIMESCALE_DOWNLOAD_MANIFEST_INVALID','The published original dataset state is missing.');
  return value;
}
