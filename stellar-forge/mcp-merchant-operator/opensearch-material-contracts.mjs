// MIT. Shared identity contract for original retained material and supplier exports.
export const OPENSEARCH_MATERIAL_EXPORT_SCHEMA = 'stellar-forge.opensearch-material-export.v1';
export const OPENSEARCH_MATERIAL_EXPORT_MANIFEST = 'manifest.json';
export const MAX_OPENSEARCH_MATERIAL_EXPORT_FILE_BYTES = 8 * 1024 * 1024 * 1024;
export const MAX_OPENSEARCH_MATERIAL_MANIFEST_BYTES = 65536;
export const OPENSEARCH_MATERIAL_DOWNLOAD_STATE_SCHEMA = 'stellar-forge.opensearch-material-download-state.v1';
export const OPENSEARCH_MATERIAL_DOWNLOAD_RESULT_SCHEMA = 'stellar-forge.opensearch-material-download.v1';

const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fail=message=>{const error=new Error(message);error.code='OPENSEARCH_DOWNLOAD_MANIFEST_INVALID';throw error;};

/** Validate the complete retained manifest without resolving any host file path. */
export function parseOpenSearchMaterialExportManifest(bytes,expectedExportId) {
  if(!(bytes instanceof Uint8Array)||bytes.byteLength<1||bytes.byteLength>MAX_OPENSEARCH_MATERIAL_MANIFEST_BYTES)
    fail('Use the complete original export manifest within its declared byte limit.');
  let value;
  try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{fail('The retained export manifest must contain valid UTF-8 JSON.');}
  if(!plain(value)||value.schema!==OPENSEARCH_MATERIAL_EXPORT_SCHEMA||!id(value.exportId)||
      value.exportId!==expectedExportId||!id(value.requestId)||!hash(value.requestSha256)||
      value.sourceSnapshotSha256!==undefined&&!hash(value.sourceSnapshotSha256)||
      typeof value.workspaceId!=='string'||!value.workspaceId.length||value.workspaceId.length>256||
      !['material','supplier'].includes(value.kind)||!plain(value.selection)||
      typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt))||
      !Array.isArray(value.files)||!value.files.length||value.files.length>10)
    fail('The retained manifest must identify its original export, workspace, request, selection and files.');
  const names=new Set();
  for(const file of value.files){
    if(!plain(file)||typeof file.name!=='string'||file.name.length<1||file.name.length>512||
        /[\\/\x00-\x1f\x7f]/.test(file.name)||file.name==='.'||file.name==='..'||
        file.name.toLowerCase()===OPENSEARCH_MATERIAL_EXPORT_MANIFEST||
        names.has(file.name.toLowerCase())||!Number.isSafeInteger(file.bytes)||file.bytes<0||
        file.bytes>MAX_OPENSEARCH_MATERIAL_EXPORT_FILE_BYTES||!hash(file.sha256)||
        typeof file.type!=='string'||!file.type.length||file.type.length>200||/[\x00-\x1f\x7f]/.test(file.type))
      fail('Each original export file needs a distinct flat name, content type, exact byte count and SHA-256.');
    names.add(file.name.toLowerCase());
  }
  return value;
}
