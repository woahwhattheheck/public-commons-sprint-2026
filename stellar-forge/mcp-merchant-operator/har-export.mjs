// MIT. Completion identity shared by the original HAR operator and retained downloader.
import { createHash } from 'node:crypto';
export const HAR_EXPORT_SCHEMA = 'stellar-forge.har-operator-export.v1';
export const HAR_EXPORT_MANIFEST = 'har-export.json';
export const HAR_EXPORT_MAX_BYTES = 128 * 1024 * 1024;
export const HAR_EXPORT_FILES = Object.freeze({
  reviewer: ['review.html', 'text/html; charset=utf-8'],
  inventory: ['inventory.json', 'application/json'],
  decisions: ['decisions.json', 'application/json'],
  draft: ['draft.json', 'application/json'],
  comparison: ['change-report.json', 'application/json'],
  openapi: ['openapi.json', 'application/json'],
});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const SHA = /^[a-f0-9]{64}$/, ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const fail = () => { throw Object.assign(new Error('Select an intact original HAR export manifest.'), {code:'HAR_EXPORT_INVALID'}); };
export function harExportIdentity({workspace,kind,selection,sourceSha256,files}) {
  return hash(JSON.stringify({workspace,kind,selection:{kind:selection.kind,id:selection.id,
    ...(selection.revision?{revision:selection.revision}:{})},sourceSha256,files}));
}
export function parseHarExport(bytes, expectedExportId) {
  if (!Buffer.isBuffer(bytes) || bytes.length<1 || bytes.length>65000) fail();
  let v; try {v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));} catch {fail();}
  if (!plain(v) || Object.keys(v).some(k=>!['schema','exportId','workspace','kind','selection','sourceSha256','createdAt','files'].includes(k)) ||
      v.schema!==HAR_EXPORT_SCHEMA || !SHA.test(v.exportId??'') || v.exportId!==expectedExportId ||
      !ALIAS.test(v.workspace??'') || !Object.hasOwn(HAR_EXPORT_FILES,v.kind) || !SHA.test(v.sourceSha256??'') ||
      !plain(v.selection) || !['capture','refresh'].includes(v.selection.kind) || !SHA.test(v.selection.id??'') ||
      Object.keys(v.selection).some(k=>!['kind','id','revision'].includes(k)) ||
      v.selection.revision!==undefined&&!SHA.test(v.selection.revision) ||
      typeof v.createdAt!=='string' || !Number.isFinite(Date.parse(v.createdAt)) ||
      !Array.isArray(v.files) || v.files.length!==1) fail();
  if (['decisions','openapi'].includes(v.kind)&&!v.selection.revision || v.kind==='comparison'&&v.selection.kind!=='refresh') fail();
  const file=v.files[0], [name,contentType]=HAR_EXPORT_FILES[v.kind];
  if (!plain(file) || Object.keys(file).some(k=>!['name','bytes','sha256','contentType'].includes(k)) ||
      file.name!==name || file.contentType!==contentType || !SHA.test(file.sha256??'') ||
      !Number.isSafeInteger(file.bytes) || file.bytes<1 || file.bytes>HAR_EXPORT_MAX_BYTES ||
      harExportIdentity(v)!==v.exportId) fail();
  return v;
}
