// MIT. Portable links to the original SF49 source-edition inventory.
// Native prepare/receive/replay and the source delivery store own file validation.
export const IMPLEMENTATION_SOURCE_BUNDLE_SCHEMA='stellar-forge.merchant-implementation-source-bundle.v1';
export const ORIGINAL_SOURCE_BUNDLE_SCHEMA='stellar-forge.sf49.source-edition-workorder.v1';
export const MAX_SOURCE_BUNDLE_MANIFEST_BYTES=2*1024*1024;
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const ORIGINAL_FILES={
  'request.json':'commissioning-request',
  'originals/support.json':'original-sf74-handoff',
  'originals/terms.json':'original-owner-terms',
  'packet.json':'original-sf77-output',
  'seller-packet.html':'original-sf77-output',
  'acceptance-checklist.md':'original-sf77-output',
};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(value));
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const check=(condition,message)=>{if(!condition)throw Object.assign(new Error(message),{
  code:'INVALID_IMPLEMENTATION_SOURCE_BUNDLE',status:422});};
const fields=(value,allowed,label)=>{check(plain(value),'Use an object for '+label);
  check(Object.keys(value).every(key=>allowed.includes(key)),'Unexpected '+label+' field');};
const digest=value=>{check(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),'Keep the original source digest');return value;};
const identity=value=>{check(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value),'Keep the original source identity');return value;};
function text(value,max,label) {
  check(typeof value==='string','Keep the original '+label);
  const bytes=encoder.encode(value);
  check(bytes.length<=max&&decoder.decode(bytes)===value&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),
    'Invalid '+label);return value;
}
function instant(value) {
  check(typeof value==='string'&&value.length<=64&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value)&&
    Number.isFinite(Date.parse(value)),'Keep the original source generation time');return value;
}
function size(value,limit,label) {
  check(Number.isSafeInteger(value)&&value>=0&&value<=limit,'Invalid '+label+' byte count');return value;
}
function filename(value) {
  text(value,240,'source filename');
  check(value.length>0&&value!=='.'&&value!=='..'&&!/[\\/\u0000-\u001f\u007f]/.test(value),
    'Keep an original source basename');return value;
}
function memberPath(value) {
  if(value==='manifest.json'||own(ORIGINAL_FILES,value))return value;
  check(typeof value==='string','Keep the original bundle member path');
  const parts=value.split('/');
  check(parts.length===3&&parts[0]==='attachments','Unknown original bundle member');
  identity(parts[1]);filename(parts[2]);return value;
}
export async function sourceBundleDigest(value) {
  const bytes=typeof value==='string'?encoder.encode(value):value;
  check(bytes instanceof Uint8Array,'Source digest requires original bytes');
  return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes)),
    byte=>byte.toString(16).padStart(2,'0')).join('');
}
/** Read the native inventory without recompiling an earlier SF77 edition. */
export function parseImplementationSourceManifest(manifestText) {
  text(manifestText,MAX_SOURCE_BUNDLE_MANIFEST_BYTES,'original source manifest');
  let manifest;try{manifest=JSON.parse(manifestText);}catch{check(false,'The original source manifest is not JSON');}
  fields(manifest,['schema','operationId','generatedAt','bundleId','nativeSource','attachments','files'],'source manifest');
  check(manifest.schema===ORIGINAL_SOURCE_BUNDLE_SCHEMA,'Use the original SF49 source-edition manifest');
  identity(manifest.operationId);instant(manifest.generatedAt);digest(manifest.bundleId);
  fields(manifest.nativeSource,['workorder','runtimeSupport','workspaceFile'],'original implementation identities');
  for(const key of ['workorder','runtimeSupport','workspaceFile'])digest(manifest.nativeSource[key]);
  check(Array.isArray(manifest.attachments)&&manifest.attachments.length<=64,'Invalid complete attachment inventory');
  check(Array.isArray(manifest.files)&&manifest.files.length===6+manifest.attachments.length,'Invalid complete source file inventory');
  const ids=new Set(),paths=new Set(),attachments=new Map();let inputBytes=0;
  for(const attachment of manifest.attachments) {
    fields(attachment,['id','role','name','path','bytes','sha256'],'source attachment');
    identity(attachment.id);check(!ids.has(attachment.id),'Repeated source attachment');ids.add(attachment.id);
    filename(attachment.name);text(attachment.role,640,'source role');
    check(attachment.role.length>0&&attachment.role.length<=160&&!/[\u0000-\u001f\u007f]/.test(attachment.role),'Invalid source role');
    check(attachment.path==='attachments/'+attachment.id+'/'+attachment.name,'Source attachment path changed');
    size(attachment.bytes,8*1024**3,'attachment');digest(attachment.sha256);
    attachments.set(attachment.path,attachment);inputBytes+=attachment.bytes;
  }
  for(const file of manifest.files) {
    fields(file,['path','role','bytes','sha256'],'source file');
    memberPath(file.path);check(!paths.has(file.path),'Repeated original source member');paths.add(file.path);
    size(file.bytes,16*1024**3,'source file');digest(file.sha256);text(file.role,640,'source role');
    check(file.role.length>0&&file.role.length<=160,'Invalid source role length');
    const attachment=attachments.get(file.path);
    if(attachment)check(file.role===attachment.role&&file.bytes===attachment.bytes&&file.sha256===attachment.sha256,
      'The source attachment differs from its original file inventory');
    else check(file.role===ORIGINAL_FILES[file.path],'Original source file role changed');
    if(file.path==='originals/support.json'||file.path==='originals/terms.json')inputBytes+=file.bytes;
  }
  for(const path of Object.keys(ORIGINAL_FILES))check(paths.has(path),'Missing original source file '+path);
  check(inputBytes<=16*1024**3,'Original source input population exceeds its native carrier limit');
  return manifest;
}
export async function validateImplementationSourceBundle(reference,manifestText,{packet,termsSha256,sourceCase,outputs}={}) {
  fields(reference,['schema','bundleId','manifestSha256','manifest','runtimeBytes'],'implementation source bundle');
  check(reference.schema===IMPLEMENTATION_SOURCE_BUNDLE_SCHEMA,'Unknown implementation source-bundle reference');
  digest(reference.bundleId);digest(reference.manifestSha256);digest(reference.manifest);
  check(reference.manifest===reference.manifestSha256,'The retained manifest file differs from its original digest');
  size(reference.runtimeBytes,192*1024*1024,'original runtime');
  check(reference.runtimeBytes>0,'The original runtime must contain bytes');
  const manifest=parseImplementationSourceManifest(manifestText);
  check(await sourceBundleDigest(manifestText)===reference.manifestSha256&&manifest.bundleId===reference.bundleId,
    'The original source manifest bytes changed');
  if(packet!==undefined) {
    check(plain(packet)&&packet.sourceKind==='RUNTIME'&&plain(packet.runtimeSource),
      'A source-edition bundle must retain its original runtime workorder');
    for(const key of ['handoffSha256','workspaceSha256','supportSha256'])digest(packet.runtimeSource[key]);
    const byPath=new Map(manifest.files.map(file=>[file.path,file]));
    if(outputs!==undefined) {
      fields(outputs,['packet','html','checklist'],'original workorder output digests');
      for(const [key,path] of [['packet','packet.json'],['html','seller-packet.html'],['checklist','acceptance-checklist.md']])
        check(byPath.get(path).sha256===digest(outputs[key]),'The retained '+path+' differs from its original bundle');
    }
    check(byPath.get('originals/support.json').sha256===packet.runtimeSource.handoffSha256,
      'The workorder belongs to a different original support handoff');
    check(packet.baseline?.sourceSha256===packet.runtimeSource.supportSha256,
      'The workorder runtime source changed');
    if(termsSha256!==undefined)check(byPath.get('originals/terms.json').sha256===digest(termsSha256),
      'The retained owner terms differ from the original bundle');
    if(sourceCase!==undefined&&sourceCase!==null) {
      check(sourceCase.workspaceSha256===packet.runtimeSource.workspaceSha256&&
        sourceCase.supportSha256===packet.runtimeSource.supportSha256,
        'The workorder source differs from the selected saved case');
    }
  }
  return manifest;
}
export async function createImplementationSourceBundle({manifestText,runtimeBytes,packet,termsSha256,sourceCase,outputs}) {
  const manifest=parseImplementationSourceManifest(manifestText),manifestSha256=await sourceBundleDigest(manifestText);
  const reference={schema:IMPLEMENTATION_SOURCE_BUNDLE_SCHEMA,bundleId:manifest.bundleId,
    manifestSha256,manifest:manifestSha256,runtimeBytes};
  await validateImplementationSourceBundle(reference,manifestText,{packet,termsSha256,sourceCase,outputs});
  return reference;
}
export function implementationSourceMember(reference,manifestText,path) {
  const manifest=parseImplementationSourceManifest(manifestText);memberPath(path);
  check(manifest.bundleId===reference.bundleId,'Source bundle identity changed');
  const file=path==='manifest.json'?{path,role:'source-edition-manifest',
    bytes:encoder.encode(manifestText).length,sha256:reference.manifestSha256}:
    manifest.files.find(row=>row.path===path);check(file,'Original source member is missing');
  return {...file,sourceFile:{bundleId:reference.bundleId,manifestSha256:reference.manifestSha256,path:file.path}};
}
export function validateImplementationSourceFile(value,reference,manifestText,{sha256,bytes}={}) {
  fields(value,['bundleId','manifestSha256','path'],'implementation source file');
  digest(value.bundleId);digest(value.manifestSha256);memberPath(value.path);
  check(value.bundleId===reference.bundleId&&value.manifestSha256===reference.manifestSha256,
    'The selected file belongs to another original bundle');
  const file=implementationSourceMember(reference,manifestText,value.path);
  if(sha256!==undefined)check(file.sha256===digest(sha256),'Original source file digest changed');
  if(bytes!==undefined)check(file.bytes===bytes,'Original source file size changed');
  return file;
}
