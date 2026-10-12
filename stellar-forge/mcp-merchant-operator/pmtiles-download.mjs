// MIT. Exact original PMTiles package receiving through the shared retained download engine.
import {createRetainedDownload} from './retained-download.mjs';
import {failure,plain} from './host-files.mjs';
export const PMTILES_DOWNLOAD_SCHEMA='stellar-forge.pmtiles-package-download.v1';
export const PMTILES_DOWNLOAD_MANIFEST='pmtiles-download.json';
export const PMTILES_DOWNLOAD_FILE='pmtiles-operations.zip';
export const MAX_PMTILES_MCP_DOWNLOAD_BYTES=8*1024*1024*1024;
const hash=/^[a-f0-9]{64}$/;
export function parsePMTilesExportId(value){
  if(typeof value!=='string'||!/^[a-z0-9][a-z0-9_-]{0,63}:[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value))
    throw failure('INVALID_PARAMS','Use the original package exportId: workspace:requestId.');
  const split=value.indexOf(':');return {workspace:value.slice(0,split),requestId:value.slice(split+1)};
}
export function parsePMTilesDownload(bytes,exportId){
  const selected=parsePMTilesExportId(exportId);let value;
  try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{
    throw failure('PMTILES_DOWNLOAD_MANIFEST_INVALID','The saved package download manifest must be valid UTF-8 JSON.');
  }
  if(!plain(value)||value.schema!==PMTILES_DOWNLOAD_SCHEMA||value.exportId!==exportId||
    value.workspace!==selected.workspace||value.requestId!==selected.requestId||
    typeof value.workspaceId!=='string'||typeof value.packageId!=='string'||
    !hash.test(value.packageManifestSha256??'')||!hash.test(value.runtimeSha256??'')||
    !Array.isArray(value.files)||value.files.length!==1||value.files[0]?.name!==PMTILES_DOWNLOAD_FILE||
    !Number.isSafeInteger(value.files[0].bytes)||value.files[0].bytes<1||value.files[0].bytes>MAX_PMTILES_MCP_DOWNLOAD_BYTES||
    !hash.test(value.files[0].sha256??''))
    throw failure('PMTILES_DOWNLOAD_MANIFEST_INVALID','Select an original complete PMTiles package and its exact one-file download manifest, within the retained MCP 8 GiB limit.');
  return value;
}
export const pmtilesPackageDownload=createRetainedDownload({
  manifestName:PMTILES_DOWNLOAD_MANIFEST,parseManifest:parsePMTilesDownload,
  maximumBytes:MAX_PMTILES_MCP_DOWNLOAD_BYTES,
  stateSchema:'stellar-forge.pmtiles-package-download-state.v1',
  resultSchema:'stellar-forge.pmtiles-package-download-result.v1',
  toolPrefix:'merchant_pmtiles_download',errorPrefix:'PMTILES',
  clientName:'starforge-pmtiles-package-download',
  validateExportId:parsePMTilesExportId,
  describe:value=>({workspace:value.workspace,workspaceId:value.workspaceId,packageId:value.packageId,
    packageManifestSha256:value.packageManifestSha256,runtimeSha256:value.runtimeSha256})
});
export const downloadPMTilesPackage=options=>pmtilesPackageDownload.download(options);
export const inspectPMTilesPackageDownload=options=>pmtilesPackageDownload.inspect(options);
