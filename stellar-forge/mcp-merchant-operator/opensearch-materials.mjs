// MIT. Native material and supplier workflows on the original OpenSearch workspace.
import { constants } from 'node:fs';
import { open, mkdir, lstat, link, unlink, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { exact, failure, identifier as aliasId, plain } from './config.mjs';
import { MATERIAL_EXPORT_FORMATS, SUPPLIER_EXPORT_FORMATS } from './catalog/opensearch-materials.mjs';
import { OPENSEARCH_MATERIAL_EXPORT_SCHEMA, OPENSEARCH_MATERIAL_EXPORT_MANIFEST,
  MAX_OPENSEARCH_MATERIAL_EXPORT_FILE_BYTES, MAX_OPENSEARCH_MATERIAL_MANIFEST_BYTES,
  parseOpenSearchMaterialExportManifest } from './opensearch-material-contracts.mjs';
import { WorkspaceError, clone, canonical, digest, identifier, now } from
  '../../stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/workspace/store.mjs';
import { PLAN_SCHEMA, CORRECTION_SCHEMA, verifySealed } from
  '../../stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/catalog/supplier/model.mjs';
import { catalogIndex } from
  '../../stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/catalog/exports.mjs';
import { openCatalogReadSnapshot, fingerprintCatalogExportSnapshot } from
  '../../stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/catalog/read-snapshot.mjs';

const SHA256 = /^[a-f0-9]{64}$/;
const CHUNK_BYTES = 262144;
const EXPORT_KINDS = { material:'catalog-material-export', supplier:'catalog-supplier-export' };
const COMMIT_SCHEMA = 'stellar-forge.opensearch-material-export-commit.v1';
const parse = row => row ? JSON.parse(row.record_json) : null;
const omit = (value, keys) => Object.fromEntries(Object.entries(value ?? {}).filter(([key]) => !keys.includes(key)));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const fail = (code, message, status = 422) => { throw new WorkspaceError(code, message, status); };
function integer(value, label, min = 1, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail('OPENSEARCH_MATERIAL_INVALID_PARAMS', label + ' must be an integer from ' + min + ' to ' + max + '.');
  return value;
}
function hash(value, label = 'SHA-256') {
  if (typeof value !== 'string' || !SHA256.test(value))
    fail('OPENSEARCH_MATERIAL_INVALID_PARAMS', 'Use the exact original ' + label + '.');
  return value;
}
function choice(value, values, label) {
  if (!values.includes(value)) fail('OPENSEARCH_MATERIAL_INVALID_PARAMS', 'Choose a declared ' + label + '.');
  return value;
}
function page(args) {
  return { offset: integer(args.offset ?? 0, 'Offset', 0), limit: integer(args.limit ?? 50, 'Page size', 1, 100) };
}
function checkReadPaging(args) {
  if (args.offset !== undefined) integer(args.offset, 'Offset', 0);
  if (args.limit !== undefined) integer(args.limit, 'Page size', 1, 100);
}
function safeName(value, label = 'file name') {
  if (typeof value !== 'string' || value.length < 1 || value.length > 240 ||
      /[\\/\x00-\x1f\x7f]/.test(value) || value === '.' || value === '..')
    fail('OPENSEARCH_MATERIAL_FILE_NAME_INVALID', 'Use the original flat ' + label + '.');
  return value;
}
function ioFailure(error) {
  if (!error?.path && !error?.syscall) return error;
  const code = /^[A-Z0-9_]{1,80}$/.test(error.code ?? '') ? error.code : 'IO_ERROR';
  return new WorkspaceError('OPENSEARCH_MATERIAL_IO_FAILED',
    'The original private material file operation could not finish (' + code + '). Its request and prepared files remain retained.', 503);
}
function sameFile(a, b) {
  return ['dev','ino','size','mtimeNs','ctimeNs'].every(key => a[key] === b[key]);
}

/** Normalize host-owned selections without opening input files or resolving credentials. */
export function readOpenSearchMaterialInputs(value = {}, base) {
  if (!plain(value) || Object.keys(value).length > 128)
    throw failure('CONFIGURATION_ERROR', 'Declare at most 128 original material input aliases.');
  const result = Object.create(null);
  for (const [id, item] of Object.entries(value)) {
    aliasId(id, 'Material input alias');
    exact(item, ['path','name','bytes','sha256'], ['path','name','bytes','sha256']);
    if (typeof item.path !== 'string' || !item.path || item.path.includes('\0'))
      throw failure('CONFIGURATION_ERROR', 'Material input paths are selected in the host connection file.');
    safeName(item.name, 'input name');
    integer(item.bytes, 'Original input byte count', 1, MAX_OPENSEARCH_MATERIAL_EXPORT_FILE_BYTES);
    hash(item.sha256, 'input SHA-256');
    result[id] = Object.freeze({ path:resolve(base,item.path), name:item.name, bytes:item.bytes, sha256:item.sha256 });
  }
  return Object.freeze(result);
}
function selectedInput(entry, id) {
  aliasId(id, 'Material input alias');
  const selected = entry.materialInputs?.[id];
  if (!selected) fail('OPENSEARCH_MATERIAL_INPUT_NOT_CONFIGURED', 'Choose an original alias from material_inputs.');
  return selected;
}
/** Opening is lazy: original already-committed requests never reopen retired inputs. */
async function* inputBytes(input, owner) {
  let handle;
  try {
    handle = await owner.open(input.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat({ bigint:true });
    if (!before.isFile() || before.size !== BigInt(input.bytes))
      fail('OPENSEARCH_MATERIAL_INPUT_CHANGED', 'The selected input is not its original regular file and byte count.', 409);
    const buffer = Buffer.alloc(CHUNK_BYTES); let position = 0;
    while (position < input.bytes) {
      const result = await handle.read(buffer, 0, Math.min(buffer.length,input.bytes-position), position);
      if (!result.bytesRead) fail('OPENSEARCH_MATERIAL_INPUT_CHANGED', 'The selected input ended before its declared byte count.', 409);
      position += result.bytesRead;
      yield buffer.subarray(0,result.bytesRead);
    }
    if (!sameFile(before, await handle.stat({ bigint:true })))
      fail('OPENSEARCH_MATERIAL_INPUT_CHANGED', 'The original input changed during transfer. Reopen the host selection.', 409);
  } catch (error) {
    if (String(error.code ?? '').startsWith('OPENSEARCH_')) throw error;
    fail('OPENSEARCH_MATERIAL_INPUT_UNAVAILABLE', 'The host-selected original input is unavailable. Its declared identity is retained.', 503);
  } finally { if (handle) await owner.close(handle); }
}

function summary(kind, value) {
  if (kind === 'catalogs' || kind === 'catalog') return omit(value, ['mapping']);
  if (kind === 'sources') return { ...omit(value,['sample','columns']), columnCount:value.columns?.length ?? 0 };
  if (kind === 'editions') return omit(value,['mapping','sample']);
  if (kind === 'plans' || kind === 'plan') return omit(value,['profile','bindings']);
  if (kind === 'corrections' || kind === 'correction') return { ...omit(value,['patches']), patchCount:value.patches?.length ?? 0 };
  if (kind === 'reviews') return { ...omit(value,['plan','globalFindings']), globalFindingCount:value.globalFindings?.length ?? 0 };
  return value;
}
const MATERIAL_COLLECTIONS = {
  catalogs:{table:'catalog_catalogs'}, sources:{table:'catalog_sources'},
  editions:{table:'catalog_editions'}, decisions:{table:'catalog_decisions'},
};
const SUPPLIER_COLLECTIONS = {
  plans:{table:'catalog_supplier_plans'}, reviews:{table:'catalog_supplier_reviews'},
  corrections:{table:'catalog_supplier_corrections'},
};
function collectionPage(model, family, args) {
  const choices = family === 'material' ? MATERIAL_COLLECTIONS : SUPPLIER_COLLECTIONS;
  const selected = choices[choice(args.collection,Object.keys(choices),'collection')];
  const limit = integer(args.limit ?? 50,'Page size',1,100), db = model.store.db;
  const filters = {};
  if (args.catalogId !== undefined) {
    identifier(args.catalogId,'catalog ID'); model.catalog.catalog(args.catalogId); filters.catalogId=args.catalogId;
  }
  if (args.planId !== undefined) {
    identifier(args.planId,'submission ID'); const plan=model.catalog.supplier.plan(args.planId);
    if (filters.catalogId && plan.catalogId !== filters.catalogId)
      fail('OPENSEARCH_MATERIAL_SCOPE_CONFLICT','The selected submission belongs to another catalog.',409);
    filters.planId=args.planId;
  }
  if (family === 'material' && args.collection === 'sources' && args.catalogId !== undefined)
    fail('OPENSEARCH_MATERIAL_SCOPE_INVALID','Original input sources are workspace-wide. Omit catalogId when listing sources.');
  const cursorIdentity=digest({family,collection:args.collection,filters});
  let after;
  if (args.cursor !== undefined) {
    if (typeof args.cursor !== 'string' || args.cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(args.cursor))
      fail('OPENSEARCH_MATERIAL_CURSOR_INVALID','Continue the nextCursor from this original collection.');
    let value; try { value=JSON.parse(Buffer.from(args.cursor,'base64url').toString('utf8')); } catch {}
    if (!Array.isArray(value) || value.length !== 4 || value[0] !== 1 || value[1] !== model.store.id ||
        value[2] !== cursorIdentity || typeof value[3] !== 'string')
      fail('OPENSEARCH_MATERIAL_CURSOR_INVALID','This cursor belongs to a different original workspace or collection.');
    after=identifier(value[3],'cursor record ID');
  }
  const clauses=[], values=[];
  if (filters.catalogId) {
    if (family === 'material') {
      clauses.push(args.collection === 'catalogs' ? 'r.id=?' : 'r.catalog_id=?'); values.push(filters.catalogId);
    } else {
      clauses.push(args.collection === 'plans' ? 'r.catalog_id=?' :
        'r.plan_id IN (SELECT id FROM catalog_supplier_plans WHERE catalog_id=?)');
      values.push(filters.catalogId);
    }
  }
  if (filters.planId) { clauses.push(args.collection === 'plans' ? 'r.id=?' : 'r.plan_id=?'); values.push(filters.planId); }
  const scope=clauses.length?' WHERE '+clauses.join(' AND '):'';
  const total=Number(db.prepare('SELECT COUNT(*) n FROM '+selected.table+' r'+scope).get(...values).n);
  const paged=scope+(after?(scope?' AND ':' WHERE ')+'r.id>?':'');
  const items=[];let last,more=false,byteLimited=false;
  let used=Buffer.byteLength(JSON.stringify({collection:args.collection,...filters,total,items:[],nextCursor:null}));
  for(const row of db.prepare('SELECT r.id,r.record_json FROM '+selected.table+' r'+paged+' ORDER BY r.id LIMIT ?')
      .iterate(...values,...(after?[after]:[]),limit+1)) {
    if(items.length===limit){more=true;break;}
    const next=addPageItem(items,summary(args.collection,parse(row)),used);
    if(next===null){more=true;byteLimited=true;break;}
    used=next;last=row.id;
  }
  return {collection:args.collection,...filters,total,items,nextCursor:more?
    Buffer.from(JSON.stringify([1,model.store.id,cursorIdentity,last])).toString('base64url'):null,
    ...(byteLimited?{byteLimited:true,replyByteLimit:REPLY_BYTES}:{})};
}
const HISTORY = {
  catalog:{table:'catalog_history',column:'catalog_id',current:'catalog_catalogs',schema:null},
  decision:{table:'catalog_decision_history',column:'decision_id',current:'catalog_decisions',schema:null},
  plan:{table:'catalog_supplier_plan_history',column:'plan_id',current:'catalog_supplier_plans',schema:PLAN_SCHEMA},
  correction:{table:'catalog_supplier_correction_history',column:'correction_id',current:'catalog_supplier_corrections',schema:CORRECTION_SCHEMA},
};
function recordAt(model, kind, id, revision) {
  identifier(id,kind+' ID'); const spec=HISTORY[kind];
  if (revision !== undefined) integer(revision,'Original revision');
  const value=parse(revision === undefined?
    model.store.db.prepare('SELECT record_json FROM '+spec.current+' WHERE id=?').get(id):
    model.store.db.prepare('SELECT record_json FROM '+spec.table+' WHERE '+spec.column+'=? AND revision=?').get(id,revision));
  if (!value) fail('OPENSEARCH_MATERIAL_RECORD_NOT_FOUND','The selected original '+kind+' revision was not found.',404);
  return spec.schema?verifySealed(value,spec.schema):value;
}
function historyPage(model, family, args) {
  const kind=choice(args.kind,family==='material'?['catalog','decision']:['plan','correction'],'history kind');
  identifier(args.id,kind+' ID'); recordAt(model,kind,args.id);
  const spec=HISTORY[kind], limit=integer(args.limit??50,'Page size',1,100);
  const before=args.beforeRevision === undefined?null:integer(args.beforeRevision,'Original revision');
  const total=Number(model.store.db.prepare('SELECT COUNT(*) n FROM '+spec.table+' WHERE '+spec.column+'=?').get(args.id).n);
  const items=[];let last,more=false,byteLimited=false;
  let used=Buffer.byteLength(JSON.stringify({kind,id:args.id,total,items:[],nextRevision:null}));
  for(const row of model.store.db.prepare('SELECT revision,record_json FROM '+spec.table+' WHERE '+spec.column+'=?'+
      (before===null?'':' AND revision<?')+' ORDER BY revision DESC LIMIT ?')
      .iterate(args.id,...(before===null?[]:[before]),limit+1)) {
    if(items.length===limit){more=true;break;}
    const next=addPageItem(items,summary(kind,spec.schema?verifySealed(parse(row),spec.schema):parse(row)),used);
    if(next===null){more=true;byteLimited=true;break;}
    used=next;last=row.revision;
  }
  return {kind,id:args.id,total,items,nextRevision:more?last:null,
    ...(byteLimited?{byteLimited:true,replyByteLimit:REPLY_BYTES}:{})};
}
function facetPage(model,args) {
  const catalog=model.catalog.catalog(identifier(args.catalogId,'catalog ID'));
  const facet=choice(args.facet,['category','manufacturer','unit'],'facet'), paging=page(args);
  const id=args.editionId??catalog.activeEditionId;
  if (!id) return {catalogId:catalog.id,editionId:null,facet,...paging,total:0,items:[],nextOffset:null};
  const edition=model.catalog.edition(identifier(id,'edition ID'));
  if (edition.catalogId!==catalog.id) fail('CATALOG_EDITION_FOREIGN','The selected edition belongs to another catalog.');
  // Field names are selected exclusively from the fixed facet enum.
  const expression="json_extract(record_json,'$."+facet+"')";
  const total=Number(model.store.db.prepare('SELECT COUNT(*) n FROM (SELECT '+expression+
    ' value FROM catalog_materials WHERE edition_id=? AND '+expression+' IS NOT NULL GROUP BY value)').get(id).n);
  const items=model.store.db.prepare('SELECT '+expression+' value,COUNT(*) count FROM catalog_materials WHERE edition_id=? AND '+
    expression+' IS NOT NULL GROUP BY value ORDER BY count DESC,value LIMIT ? OFFSET ?').all(id,paging.limit,paging.offset);
  return {catalogId:catalog.id,editionId:id,facet,...paging,total,items,nextOffset:paging.offset+items.length<total?paging.offset+items.length:null};
}

async function privateDirectory(path) {
  try { await mkdir(path,{mode:0o700}); }
  catch (error) { if (error.code!=='EEXIST') throw error; }
  const info=await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || process.platform!=='win32' &&
      ((info.mode&0o077)!==0 || process.getuid && info.uid!==process.getuid()))
    fail('OPENSEARCH_MATERIAL_DIRECTORY_INVALID','Use the original private material export directory.',409);
  return path;
}
async function syncDirectory(owner,path) {
  const handle=await owner.open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await owner.close(handle); }
}
async function regularFile(owner,path,expected) {
  const handle=await owner.open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const info=await handle.stat({bigint:true});
    if (!info.isFile() || expected && info.size!==BigInt(expected.bytes) ||
        process.platform!=='win32' && ((info.mode&0o077n)!==0n || process.getuid && info.uid!==BigInt(process.getuid())))
      fail('OPENSEARCH_MATERIAL_FILE_CHANGED','The original private export file or its byte count changed.',409);
    return {handle,info};
  } catch (error) { await owner.close(handle); throw error; }
}
async function readSmall(owner,path,maxBytes) {
  const opened=await regularFile(owner,path),{handle,info}=opened;
  try {
    if (info.size<1n || info.size>BigInt(maxBytes))
      fail('OPENSEARCH_MATERIAL_MANIFEST_INVALID','Use the complete bounded original export metadata.',409);
    const bytes=Buffer.alloc(Number(info.size));let position=0;
    while(position<bytes.length) {
      const read=await handle.read(bytes,position,bytes.length-position,position);
      if(!read.bytesRead)fail('OPENSEARCH_MATERIAL_FILE_CHANGED','The retained metadata ended before its original byte count.',409);
      position+=read.bytesRead;
    }
    if(!sameFile(info,await handle.stat({bigint:true})))
      fail('OPENSEARCH_MATERIAL_FILE_CHANGED','The retained metadata changed during its original read.',409);
    return bytes;
  } finally { await owner.close(handle); }
}
async function verifyFile(owner,path,expected) {
  const {handle,info}=await regularFile(owner,path,expected);
  try {
    const hash=createHash('sha256'),buffer=Buffer.alloc(CHUNK_BYTES);let position=0;
    while(position<expected.bytes) {
      const read=await handle.read(buffer,0,Math.min(buffer.length,expected.bytes-position),position);
      if(!read.bytesRead)fail('OPENSEARCH_MATERIAL_FILE_CHANGED','The retained export ended before its declared byte count.',409);
      hash.update(buffer.subarray(0,read.bytesRead));position+=read.bytesRead;
    }
    if(hash.digest('hex')!==expected.sha256 || !sameFile(info,await handle.stat({bigint:true})))
      fail('OPENSEARCH_MATERIAL_FILE_CHANGED','The complete retained export differs from its original SHA-256.',409);
    return info;
  } finally { await owner.close(handle); }
}
async function writeAll(handle,bytes) {
  let written=0;
  while(written<bytes.length) {
    const result=await handle.write(bytes,written,bytes.length-written,null);
    if(!result.bytesWritten)fail('OPENSEARCH_MATERIAL_WRITE_INCOMPLETE','The original private export write made no progress.',503);
    written+=result.bytesWritten;
  }
}
async function originalBytes(owner,directory,name,bytes) {
  const path=join(directory,name),temporary=join(directory,'.'+name+'.'+randomUUID()+'.tmp');
  const handle=await owner.open(temporary,'wx',0o600);let complete=false;
  try { await writeAll(handle,bytes);await handle.sync();complete=true; }
  finally { await owner.close(handle); }
  try {
    try { await link(temporary,path); }
    catch(error) {
      if(error.code!=='EEXIST')throw error;
      const existing=await readSmall(owner,path,Math.max(bytes.length,1));
      if(!existing.equals(bytes))fail('OPENSEARCH_MATERIAL_RECEIPT_CHANGED','The original export completion receipt changed.',409);
    }
    await syncDirectory(owner,directory);
  } finally {
    if(complete)await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
}
async function writeBody(owner,directory,staged,body) {
  const path=join(directory,staged),handle=await owner.open(path,'wx',0o600);
  let bytes=0;const hash=createHash('sha256');
  try {
    const iterable=typeof body==='string'||body instanceof Uint8Array?[body]:body;
    if(!iterable || typeof iterable[Symbol.iterator]!=='function' && typeof iterable[Symbol.asyncIterator]!=='function')
      fail('OPENSEARCH_MATERIAL_EXPORT_BODY_INVALID','The original exporter did not return a complete byte stream.',500);
    for await (const value of iterable) {
      if(typeof value!=='string' && !(value instanceof Uint8Array))
        fail('OPENSEARCH_MATERIAL_EXPORT_BODY_INVALID','The original exporter returned an unsupported byte chunk.',500);
      const chunk=typeof value==='string'?Buffer.from(value):Buffer.from(value.buffer,value.byteOffset,value.byteLength);
      bytes+=chunk.length;
      if(bytes>MAX_OPENSEARCH_MATERIAL_EXPORT_FILE_BYTES)
        fail('OPENSEARCH_MATERIAL_EXPORT_FILE_TOO_LARGE','One original export exceeds the retained 8 GiB file limit.',413);
      hash.update(chunk);
      for(let offset=0;offset<chunk.length;offset+=CHUNK_BYTES)
        await writeAll(handle,chunk.subarray(offset,Math.min(offset+CHUNK_BYTES,chunk.length)));
    }
    await handle.sync();
    if((await handle.stat()).size!==bytes)
      fail('OPENSEARCH_MATERIAL_WRITE_INCOMPLETE','The private export differs from its complete streamed byte count.',503);
    return {bytes,sha256:hash.digest('hex')};
  } finally { await owner.close(handle); }
}
function exportIdentity(model,requestId) {
  return digest([OPENSEARCH_MATERIAL_EXPORT_SCHEMA,model.store.id,requestId]).slice(0,48);
}
function exportDirectory(model,exportId) {
  identifier(exportId,'export ID');
  return join(model.catalog.root,'mcp-exports',exportId);
}
async function prepareDirectory(model,owner,exportId) {
  await privateDirectory(model.catalog.root);
  const root=await privateDirectory(join(model.catalog.root,'mcp-exports'));
  const directory=await privateDirectory(join(root,exportId));
  await syncDirectory(owner,root);
  return directory;
}
function exportRequest(kind,args) {
  const request=clone(omit(args,['workspace']));
  identifier(request.requestId,'request ID');
  const formats=kind==='material'?MATERIAL_EXPORT_FORMATS:SUPPLIER_EXPORT_FORMATS;
  if(!Array.isArray(request.formats)||!request.formats.length||request.formats.length>formats.length||
      new Set(request.formats).size!==request.formats.length||request.formats.some(format=>!formats.includes(format)))
    fail('OPENSEARCH_MATERIAL_EXPORT_FORMAT_INVALID','Choose each original export format once.');
  if(kind==='material') {
    identifier(request.catalogId,'catalog ID');integer(request.expectedCatalogRevision,'Expected catalog revision');
    if(request.editionId!==undefined)identifier(request.editionId,'edition ID');
    if(request.index!==undefined)catalogIndex(request.index);
  } else { identifier(request.reviewId,'review ID');hash(request.expectedReviewSha256,'review SHA-256'); }
  return request;
}
async function clearUnsealedStages(owner,directory,count) {
  // Only this original operation's fixed private staging names are disposable.
  // A visible receipt or final export requires sealed-byte adoption instead.
  const names=await readdir(directory);
  for(const name of names) {
    const matched=/^file-([0-9]{2})\.part$/.exec(name);
    const stage=name==='manifest.part'||matched&&Number(matched[1])>=1&&Number(matched[1])<=count;
    const receiptTemporary=/^\.commit\.json\.[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.tmp$/.test(name);
    if(!stage&&!receiptTemporary)
      fail('OPENSEARCH_MATERIAL_UNSEALED_CONFLICT',
        'This original export has retained final bytes or an unexpected private entry. Reconcile its completion receipt before retrying.',409);
    const info=await lstat(join(directory,name),{bigint:true});
    if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1n||
        process.platform!=='win32'&&((info.mode&0o077n)!==0n||process.getuid&&info.uid!==BigInt(process.getuid())))
      fail('OPENSEARCH_MATERIAL_UNSEALED_CONFLICT','The original unsealed export staging file changed ownership or type.',409);
  }
  for(const name of names)await unlink(join(directory,name));
  await syncDirectory(owner,directory);
}
function retainedResult(manifest,manifestBytes) {
  const manifestFile={name:OPENSEARCH_MATERIAL_EXPORT_MANIFEST,bytes:manifestBytes.length,sha256:sha(manifestBytes)};
  return {exportId:manifest.exportId,manifest,manifestSha256:manifestFile.sha256,manifestFile};
}
function sameOperation(model,manifest,operation) {
  if(manifest.workspaceId!==model.store.id || manifest.exportId!==exportIdentity(model,manifest.requestId) ||
      !operation || operation.id!==manifest.requestId || operation.kind!==EXPORT_KINDS[manifest.kind] ||
      operation.requestSha256!==manifest.requestSha256 || digest(operation.request)!==manifest.requestSha256)
    fail('OPENSEARCH_MATERIAL_EXPORT_IDENTITY_CHANGED','The manifest no longer identifies this original workspace request.',409);
  if(operation.exportSource&&manifest.sourceSnapshotSha256!==operation.exportSource.sha256)
    fail('OPENSEARCH_MATERIAL_EXPORT_SOURCE_CHANGED','The sealed files differ from the original saved source snapshot.',409);
  const request=operation.request,selected=manifest.selection;
  if(canonical(selected.formats)!==canonical(request.formats) ||
      manifest.kind==='material' && (selected.catalogId!==request.catalogId ||
        selected.catalogRevision!==request.expectedCatalogRevision ||
        request.editionId!==undefined&&selected.editionId!==request.editionId ||
        selected.index!==request.index) ||
      manifest.kind==='supplier' && (selected.reviewId!==request.reviewId ||
        selected.reviewSha256!==request.expectedReviewSha256))
    fail('OPENSEARCH_MATERIAL_EXPORT_SELECTION_CHANGED','The complete manifest differs from its original requested selection.',409);
}
async function readCommit(model,owner,exportId,operation) {
  const directory=exportDirectory(model,exportId);
  let bytes;
  try { bytes=await readSmall(owner,join(directory,'commit.json'),MAX_OPENSEARCH_MATERIAL_MANIFEST_BYTES); }
  catch(error) { if(error.code==='ENOENT')return null;throw error; }
  let commit;try{commit=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{}
  if(!plain(commit)||commit.schema!==COMMIT_SCHEMA||commit.exportId!==exportId||
      commit.requestId!==operation.id||commit.requestSha256!==operation.requestSha256||
      !plain(commit.manifestFile)||commit.manifestFile.name!==OPENSEARCH_MATERIAL_EXPORT_MANIFEST||
      !Number.isSafeInteger(commit.manifestFile.bytes)||commit.manifestFile.bytes<1||
      commit.manifestFile.bytes>MAX_OPENSEARCH_MATERIAL_MANIFEST_BYTES||!SHA256.test(commit.manifestFile.sha256??'')||
      !Array.isArray(commit.staged)||!commit.staged.length||commit.staged.length>11)
    fail('OPENSEARCH_MATERIAL_RECEIPT_INVALID','The original completion receipt is incomplete or changed.',409);
  let manifestBytes;
  try {manifestBytes=await readSmall(owner,join(directory,OPENSEARCH_MATERIAL_EXPORT_MANIFEST),MAX_OPENSEARCH_MATERIAL_MANIFEST_BYTES);}
  catch(error){if(error.code!=='ENOENT')throw error;manifestBytes=await readSmall(owner,join(directory,'manifest.part'),MAX_OPENSEARCH_MATERIAL_MANIFEST_BYTES);}
  if(manifestBytes.length!==commit.manifestFile.bytes||sha(manifestBytes)!==commit.manifestFile.sha256)
    fail('OPENSEARCH_MATERIAL_RECEIPT_CHANGED','The manifest differs from its original completion receipt.',409);
  const manifest=parseOpenSearchMaterialExportManifest(manifestBytes,exportId);
  sameOperation(model,manifest,operation);
  const expected=[...manifest.files,commit.manifestFile],names=new Set(),staged=new Set();
  if(commit.staged.length!==expected.length)
    fail('OPENSEARCH_MATERIAL_RECEIPT_INVALID','The completion receipt does not cover every original file.',409);
  for(const item of commit.staged) {
    if(!plain(item)||typeof item.name!=='string'||typeof item.staged!=='string'||
        !/^(?:file-[0-9]{2}|manifest)\.part$/.test(item.staged)||names.has(item.name)||staged.has(item.staged)||
        !expected.some(file=>file.name===item.name)||
        (item.name===OPENSEARCH_MATERIAL_EXPORT_MANIFEST)!==(item.staged==='manifest.part'))
      fail('OPENSEARCH_MATERIAL_RECEIPT_INVALID','The original file staging identities changed.',409);
    names.add(item.name);staged.add(item.staged);
  }
  return {directory,commit,manifest,manifestBytes,expected};
}
async function publishCommitted(owner,retained) {
  const {directory,commit,expected}=retained;
  for(const selected of commit.staged) {
    const file=expected.find(item=>item.name===selected.name);
    const target=join(directory,selected.name),staged=join(directory,selected.staged);
    let finalInfo,stageInfo;
    try { finalInfo=await verifyFile(owner,target,file); } catch(error) {if(error.code!=='ENOENT')throw error;}
    try {
      const info=await lstat(staged,{bigint:true});
      if(finalInfo && info.dev===finalInfo.dev && info.ino===finalInfo.ino && info.size===finalInfo.size &&
          info.isFile()&&!info.isSymbolicLink())stageInfo=info;
      else stageInfo=await verifyFile(owner,staged,file);
    } catch(error) {if(error.code!=='ENOENT')throw error;}
    if(!finalInfo) {
      if(!stageInfo)fail('OPENSEARCH_MATERIAL_EXPORT_INCOMPLETE','The sealed original file has no retained final or staged bytes.',409);
      try {await link(staged,target);}
      catch(error){if(error.code!=='EEXIST')throw error;await verifyFile(owner,target,file);}
    }
  }
  await syncDirectory(owner,directory);
  for(const selected of commit.staged)
    await unlink(join(directory,selected.staged)).catch(error=>{if(error.code!=='ENOENT')throw error;});
  await syncDirectory(owner,directory);
}
async function readRetainedManifest(model,owner,exportId) {
  const bytes=await readSmall(owner,join(exportDirectory(model,exportId),OPENSEARCH_MATERIAL_EXPORT_MANIFEST),
    MAX_OPENSEARCH_MATERIAL_MANIFEST_BYTES);
  const manifest=parseOpenSearchMaterialExportManifest(bytes,exportId);
  const operation=parse(model.store.db.prepare('SELECT record_json FROM operations WHERE id=?').get(manifest.requestId));
  sameOperation(model,manifest,operation);
  const result=retainedResult(manifest,bytes);
  if(operation.state!=='COMPLETE' || operation.result?.exportId!==exportId ||
      operation.result?.manifestSha256!==result.manifestSha256 ||
      canonical(operation.result?.manifestFile)!==canonical(result.manifestFile) ||
      canonical(operation.result?.manifest)!==canonical(manifest))
    fail('OPENSEARCH_MATERIAL_EXPORT_INCOMPLETE',
      'Replay the original export request to finish its retained completion before downloading its files.',409);
  return result;
}

const REPLY_BYTES = 1048576;
const PAGE_PAYLOAD_BYTES = REPLY_BYTES - 8192;
function originalTooLarge() {
  fail('OPENSEARCH_MATERIAL_RECORD_TOO_LARGE',
    'This complete original record exceeds the 1 MiB tool reply budget. Retain catalog.jsonl or catalog-bundle.jsonl, or supplier products.jsonl/review.json, and download the complete file through material_export_file.',413);
}
function boundedRecord(value) {
  if(Buffer.byteLength(JSON.stringify(value))>PAGE_PAYLOAD_BYTES)originalTooLarge();
  return value;
}
function addPageItem(items,item,used) {
  const bytes=Buffer.byteLength(JSON.stringify(item))+(items.length?1:0);
  if(used+bytes>PAGE_PAYLOAD_BYTES) {
    if(!items.length)originalTooLarge();
    return null;
  }
  items.push(item);return used+bytes;
}
function boundedOriginalPage(read,args,field='rows') {
  const paging=page(args), items=[];
  const first=read({...args,offset:paging.offset,limit:1});
  const header={...first,...paging,[field]:[],nextOffset:null};
  let used=Buffer.byteLength(JSON.stringify(header));
  if(used>PAGE_PAYLOAD_BYTES)originalTooLarge();
  let current=first,limited=false;
  while(items.length<paging.limit) {
    const rows=current[field];
    if(!Array.isArray(rows)||rows.length>1)
      fail('OPENSEARCH_MATERIAL_PAGE_INVALID','The original reader returned an invalid retained subpage.',500);
    if(!rows.length)break;
    const next=addPageItem(items,rows[0],used);
    if(next===null){limited=true;break;}
    used=next;
    if(paging.offset+items.length>=first.total||items.length===paging.limit)break;
    current=read({...args,offset:paging.offset+items.length,limit:1});
    if(current.total!==first.total)
      fail('OPENSEARCH_MATERIAL_PAGE_CHANGED','The original read snapshot changed while paging its complete records.',409);
  }
  if(!items.length && paging.offset<first.total)
    fail('OPENSEARCH_MATERIAL_PAGE_INCOMPLETE','The retained reader could not advance this original page. Use its complete export.',409);
  return {...header,[field]:items,nextOffset:paging.offset+items.length<first.total?paging.offset+items.length:null,
    ...(limited?{byteLimited:true,replyByteLimit:REPLY_BYTES}:{})};
}
const OPERATION_FIELDS=['id','kind','state','createdAt','updatedAt','requestSha256','error'];
function operationEnvelope(value,includeRequest) {
  return {...Object.fromEntries(OPERATION_FIELDS.filter(key=>value[key]!==undefined).map(key=>[key,value[key]])),
    ...(includeRequest?{request:value.request}:{}),...(value.result?{result:value.result}:{})};
}
function resultIdentity(value) {
  const result={};
  for(const key of ['schema','id','revision','catalogId','catalogRevision','tenantId','title','createdAt','updatedAt',
    'sha256','mappingSha256','activeEditionId','planId','planRevision','editionId','editionReviewSha256',
    'materialRootSha256','baseEditionId','mode','materialId','materialKey','materialSha256','baseProductSha256',
    'reviewSha256','rowsRootSha256','correctionsRootSha256','status','requestId','requestSha256','bytes','name']) {
    const item=value?.[key];
    if(item===null||typeof item==='boolean'||Number.isSafeInteger(item)||
        typeof item==='string'&&Buffer.byteLength(item)<=4096)result[key]=item;
  }
  if(plain(value?.counts)) {
    const counts=Object.fromEntries(Object.entries(value.counts).filter(([key,item])=>
      key.length<=64&&Number.isSafeInteger(item)));
    if(Buffer.byteLength(JSON.stringify(counts))<=4096)result.counts=counts;
  }
  if(plain(value?.source))result.source=Object.fromEntries(['id','name','bytes','sha256']
    .filter(key=>value.source[key]!==undefined&&Buffer.byteLength(JSON.stringify(value.source[key]))<=4096)
    .map(key=>[key,value.source[key]]));
  for(const [field,count] of [['columns','columnCount'],['dependencies','dependencyCount'],
    ['patches','patchCount'],['globalFindings','globalFindingCount']])
    if(Array.isArray(value?.[field]))result[count]=value[field].length;
  return result;
}
/** Keep complete journal records discoverable through explicitly bounded identities. */
export function projectOpenSearchMaterialOperation(operation,includeRequest=false) {
  if(!operation?.kind || !operation.kind.startsWith('catalog-')&&
      operation.request?.mcp?.kind!=='catalog-material-draft')return operation;
  if(Buffer.byteLength(JSON.stringify(operationEnvelope(operation,includeRequest)))<=PAGE_PAYLOAD_BYTES)return operation;
  const resultSummary={},other={};
  for(const key of ['catalog','source','edition','decision','supplierPlan','supplierCorrection','supplierReview','draft'])
    if(operation.result?.[key])resultSummary[key]=resultIdentity(operation.result[key]);
  for(const key of ['catalogId','sourceId','editionId','draftId','revision','reviewId','planId','exportId','importedRevision']) {
    const item=operation.result?.[key];
    if(item===null||Number.isSafeInteger(item)||typeof item==='string'&&Buffer.byteLength(item)<=4096)other[key]=item;
  }
  const projected={...operation,...(operation.result?{result:{...other,resultSummary,fullResultRetained:true,
    fullResultHint:'The full original result remains in this request journal and its complete catalog/supplier exports. Use the original operation read or retained files to read records exceeding the tool reply limit.'}}:{})};
  if(Buffer.byteLength(JSON.stringify(operationEnvelope(projected,includeRequest)))>PAGE_PAYLOAD_BYTES)
    fail('OPENSEARCH_MATERIAL_RECORD_TOO_LARGE',
      'This original operation request or failure exceeds the 1 MiB reply budget. Read it without includeRequest, or use merchant_opensearch_read with kind operation to retain its complete original journal record.',413);
  return projected;
}

export class MerchantOpenSearchMaterials {
  #exports=new Map(); #snapshots=new Map(); #handles=new Map(); #readOwners=new Map();
  get summary() {return {activeExports:this.#exports.size,openReadSnapshots:this.#snapshots.size,
    ownedFileHandles:this.#handles.size};}
  #owner(scope,operationKey=null) {
    return {
      operationKey,
      open:async(path,flags,mode)=>{
        const handle=await open(path,flags,mode);
        this.#handles.set(handle,{scope,operationKey,pending:null});return handle;
      },
      close:handle=>this.#closeHandle(handle),
      transfer:handle=>{this.#handles.delete(handle);return handle;},
    };
  }
  #closeHandle(handle) {
    const entry=this.#handles.get(handle);
    if(!entry)return Promise.resolve();
    if(!entry.pending)entry.pending=handle.close().then(()=>{this.#handles.delete(handle);},error=>{
      entry.pending=null;
      throw new WorkspaceError('OPENSEARCH_MATERIAL_CLOSE_INCOMPLETE',
        'An original material file descriptor remains owned. Retry closing this same workspace.',503);
    });
    return entry.pending;
  }
  async #closeExportResources(operationKey) {
    const results=await Promise.allSettled([...this.#handles].filter(([,item])=>item.operationKey===operationKey)
      .map(([handle])=>this.#closeHandle(handle)));
    for(const [snapshot,selected] of this.#snapshots)if(selected.operationKey===operationKey) {
      try{snapshot.close();this.#snapshots.delete(snapshot);}
      catch(error){results.push({status:'rejected',reason:error});}
    }
    const failed=results.find(item=>item.status==='rejected');if(failed)throw failed.reason;
  }
  #pinSource(model,kind,request,fingerprint) {
    return model.store.transaction(()=>{
      const operation=model.store.operation(request.requestId);
      if(operation.kind!==EXPORT_KINDS[kind]||operation.requestSha256!==digest(request)||
          canonical(operation.request)!==canonical(request)||operation.state!=='RUNNING'||
          canonical(operation.owner)!==canonical(model.store.owner))
        fail('OPENSEARCH_MATERIAL_EXPORT_OWNER_CHANGED','The original export request is owned by a different active operation.',409);
      if(operation.exportSource) {
        if(canonical(operation.exportSource)!==canonical(fingerprint))
          fail('OPENSEARCH_MATERIAL_EXPORT_SOURCE_CHANGED',
            'The original unsealed export source changed, including its selected customer decisions or supplier history. Retain this request and explicitly select the current source for a new export.',409);
        return operation;
      }
      return model.store.writeOperation({...operation,exportSource:clone(fingerprint),updatedAt:now()});
    });
  }
  async #snapshot(scope,model,action,operationKey=null) {
    const snapshot=await openCatalogReadSnapshot(model.catalog);
    this.#snapshots.set(snapshot,{scope,operationKey});
    try{return await action(snapshot.catalog);}
    finally{snapshot.close();this.#snapshots.delete(snapshot);}
  }
  async closeWorkspace(scope) {
    const running=[...this.#exports.values()].filter(item=>scope===undefined||item.scope===scope);
    await Promise.allSettled(running.map(item=>item.promise));
    const results=await Promise.allSettled([...this.#handles].filter(([,item])=>scope===undefined||item.scope===scope)
      .map(([handle])=>this.#closeHandle(handle)));
    for(const [snapshot,selected] of this.#snapshots)if(scope===undefined||selected.scope===scope) {
      try{snapshot.close();this.#snapshots.delete(snapshot);}
      catch(error){results.push({status:'rejected',reason:error});}
    }
    for(const [readId,selected] of this.#readOwners)if(scope===undefined||selected.scope===scope)this.#readOwners.delete(readId);
    const failed=results.find(result=>result.status==='rejected');
    if(failed)throw failed.reason;
  }
  close(){return this.closeWorkspace();}
  async #sealExport(scope,model,owner,kind,request,operation,exportId,recoverUnsealed=false) {
    const directory=await prepareDirectory(model,owner,exportId);
    const staged=[];let receiptAttempted=false;
    try {
      const retained=await this.#snapshot(scope,model,async catalog=>{
        let selection,current,edition,review;
        if(kind==='material') {
          current=catalog.catalog(request.catalogId,request.expectedCatalogRevision);
          const selectedId=request.editionId??current.activeEditionId;
          edition=selectedId?catalog.edition(selectedId):null;
          if(edition&&edition.catalogId!==current.id)
            fail('CATALOG_EDITION_FOREIGN','The selected edition belongs to another catalog.');
          if(!edition&&request.formats.some(format=>format!=='catalog-bundle.jsonl'))
            fail('CATALOG_EDITION_REQUIRED','Select a reviewed edition before exporting material files.');
          selection={catalogId:current.id,catalogRevision:current.revision,tenantId:current.tenantId,
            mappingSha256:current.mappingSha256,activeEditionId:current.activeEditionId??null,
            editionId:edition?.id??null,editionReviewSha256:edition?.reviewSha256??null,
            materialRootSha256:edition?.materialRootSha256??null,formats:request.formats,
            ...(request.index===undefined?{}:{index:request.index})};
        }else{
          review=catalog.supplier.review(request.reviewId);
          if(review.sha256!==request.expectedReviewSha256)
            fail('SUPPLIER_SELECTION_CHANGED','The selected supplier review differs from its original SHA-256.',409);
          selection={catalogId:review.catalogId,planId:review.planId,planRevision:review.planRevision,
            reviewId:review.id,reviewSha256:review.sha256,editionId:review.editionId,
            editionReviewSha256:review.editionReviewSha256,rowsRootSha256:review.rowsRootSha256,formats:request.formats};
        }
        const fingerprint=fingerprintCatalogExportSnapshot(catalog,{kind,request,selection});
        operation=this.#pinSource(model,kind,request,fingerprint);
        if(recoverUnsealed)await clearUnsealedStages(owner,directory,request.formats.length);
        // Source identity is durable before even constructing a document body.
        const descriptors=kind==='material'?request.formats.map(format=>catalog.export(current.id,format,
          {editionId:edition?.id,...(request.index===undefined?{}:{index:request.index})})):
          request.formats.map(format=>catalog.supplier.export({reviewId:review.id,format,
            expectedReviewSha256:request.expectedReviewSha256}));
        const files=[];
        for(let index=0;index<descriptors.length;index++) {
          const descriptor=descriptors[index],number=String(index+1).padStart(2,'0');
          const name=number+'-'+safeName(descriptor.filename),temporary='file-'+number+'.part';
          if(typeof descriptor.type!=='string'||!descriptor.type.length||descriptor.type.length>200||
              /[\x00-\x1f\x7f]/.test(descriptor.type))
            fail('OPENSEARCH_MATERIAL_EXPORT_TYPE_INVALID','The original exporter returned an invalid content type.',500);
          staged.push({name,staged:temporary});
          files.push({name,type:descriptor.type,...await writeBody(owner,directory,temporary,descriptor.body)});
        }
        const manifest={schema:OPENSEARCH_MATERIAL_EXPORT_SCHEMA,exportId,requestId:operation.id,
          requestSha256:operation.requestSha256,workspaceId:model.store.id,createdAt:operation.createdAt,kind,selection,
          sourceSnapshotSha256:fingerprint.sha256,files};
        const manifestBytes=jsonBytes(manifest);
        parseOpenSearchMaterialExportManifest(manifestBytes,exportId);
        staged.push({name:OPENSEARCH_MATERIAL_EXPORT_MANIFEST,staged:'manifest.part'});
        const manifestIdentity=await writeBody(owner,directory,'manifest.part',manifestBytes);
        const commit={schema:COMMIT_SCHEMA,exportId,requestId:operation.id,requestSha256:operation.requestSha256,
          manifestFile:{name:OPENSEARCH_MATERIAL_EXPORT_MANIFEST,...manifestIdentity},staged};
        // Once publication is attempted, even a failed post-link fsync may have
        // made the sealed receipt visible. Keep its exact complete staged bytes.
        receiptAttempted=true;
        await originalBytes(owner,directory,'commit.json',jsonBytes(commit));
        return {directory,commit,manifest,manifestBytes,expected:[...files,commit.manifestFile]};
      },owner.operationKey);
      await publishCommitted(owner,retained);
      return retainedResult(retained.manifest,retained.manifestBytes);
    }finally{
      if(!receiptAttempted)for(const item of staged)
        await unlink(join(directory,item.staged)).catch(error=>{if(error.code!=='ENOENT')throw error;});
    }
  }
  #runExport(scope,model,owner,kind,request,saved,exportId,retained,recoverUnsealed=false) {
    const key=model.store.id+':'+request.requestId;
    const promise=Promise.resolve().then(async()=>{
      let result;
      try{
        if(retained||recoverUnsealed)await this.#closeExportResources(owner.operationKey);
        if(retained) {
          await publishCommitted(owner,retained);
          result=retainedResult(retained.manifest,retained.manifestBytes);
        }else result=await this.#sealExport(scope,model,owner,kind,request,saved,exportId,recoverUnsealed);
      }catch(error){
        return model.store.finish(request.requestId,null,model.failure(ioFailure(error)));
      }
      return model.store.finish(request.requestId,result);
    }).finally(()=>{
      this.#exports.delete(key);
      if(model.active.get(request.requestId)===promise)model.active.delete(request.requestId);
    });
    this.#exports.set(key,{scope,promise});model.active.set(request.requestId,promise);
    return promise;
  }
  async #export(scope,model,kind,args) {
    model.catalog.open();
    const request=exportRequest(kind,args),exportId=exportIdentity(model,request.requestId),
      owner=this.#owner(scope,model.store.id+':'+request.requestId);
    const saved=model.store.transaction(()=>{
      model.store.recoverInterrupted();
      return model.store.reserve(EXPORT_KINDS[kind],request);
    });
    const existing=this.#exports.get(model.store.id+':'+request.requestId);
    if(existing)return existing.promise;
    if(!saved.existing)return this.#runExport(scope,model,owner,kind,request,saved.operation,exportId);
    if(saved.operation.state==='COMPLETE') {
      await readRetainedManifest(model,owner,exportId);
      return saved.operation;
    }
    if(saved.operation.state==='RUNNING'&&canonical(saved.operation.owner)!==canonical(model.store.owner))return saved.operation;
    const retained=await readCommit(model,owner,exportId,saved.operation);
    const live=this.#exports.get(model.store.id+':'+request.requestId);
    if(live)return live.promise;
    const claimed=model.store.transaction(()=>{
      const current=model.store.operation(request.requestId);
      if(current.kind!==EXPORT_KINDS[kind]||current.requestSha256!==digest(request))
        fail('WORKSPACE_REQUEST_REUSED','This request ID already belongs to different saved input.',409);
      const ownUnfinished=current.state==='RUNNING'&&canonical(current.owner)===canonical(model.store.owner);
      if(!['FAILED','INTERRUPTED'].includes(current.state)&&!ownUnfinished)return{claimed:false,operation:current};
      const recovery={state:current.state,sealed:Boolean(retained),updatedAt:current.updatedAt,...(current.error?{error:current.error}:{}),
        owner:current.owner};
      const next={...current,state:'RUNNING',updatedAt:now(),owner:model.store.owner,
        exportRecoveryHistory:[...(current.exportRecoveryHistory??[]),recovery]};
      delete next.error;
      return{claimed:true,operation:model.store.writeOperation(next)};
    });
    if(!claimed.claimed)return claimed.operation;
    return this.#runExport(scope,model,owner,kind,request,claimed.operation,exportId,retained,!retained);
  }
  #pruneReads(scope,files) {
    const live=new Set(files.status(scope).sessions.map(item=>item.readId));
    for(const [id,item] of this.#readOwners)if(item.scope===scope&&!live.has(id))this.#readOwners.delete(id);
    return live;
  }
  async #readExport(scope,args,{model,entry,files}) {
    const owner=this.#owner(scope),result=await readRetainedManifest(model,owner,identifier(args.exportId,'export ID'));
    hash(args.expectedManifestSha256,'manifest SHA-256');hash(args.expectedSha256,'file SHA-256');
    if(args.expectedManifestSha256!==result.manifestSha256)
      fail('OPENSEARCH_MATERIAL_EXPORT_CHANGED','The selected manifest differs from the original export.',409);
    const metadata=args.file===OPENSEARCH_MATERIAL_EXPORT_MANIFEST?
      {...result.manifestFile,type:'application/json; charset=utf-8'}:result.manifest.files.find(item=>item.name===args.file);
    if(!metadata||metadata.sha256!==args.expectedSha256)
      fail('OPENSEARCH_MATERIAL_EXPORT_FILE_CHANGED','Select an original file and SHA-256 from this export manifest.',409);
    this.#pruneReads(scope,files);
    const key=canonical({exportId:args.exportId,file:metadata.name,manifestSha256:result.manifestSha256});
    const read=await files.read({scope,key,kind:'material-export',directory:entry.directory,
      load:async()=>{
        const {handle}=await regularFile(owner,join(exportDirectory(model,args.exportId),metadata.name),metadata);
        return {readonlyFileHandle:owner.transfer(handle),name:metadata.name,type:metadata.type,
          bytes:metadata.bytes,sha256:metadata.sha256};
      },readId:args.readId,expectedSha256:args.expectedSha256,offset:args.offset,limit:args.limit});
    if(read.nextOffset===null)this.#readOwners.delete(read.readId);
    else this.#readOwners.set(read.readId,{scope,exportId:args.exportId});
    return {exportId:args.exportId,manifestSha256:result.manifestSha256,...read};
  }
  async call(name,args,{model,entry,files}) {
    const scope=args.workspace,request=omit(args,['workspace']);
    const readSnapshot=action=>this.#snapshot(scope,model,action);
    try{
      switch(name) {
        case 'merchant_opensearch_material_inputs':
          return {inputs:Object.entries(entry.materialInputs??{}).map(([inputId,input])=>({inputId,...omit(input,['path'])}))};
        case 'merchant_opensearch_material_list':return collectionPage(model,'material',request);
        case 'merchant_opensearch_material_catalog':
          return boundedRecord(recordAt(model,'catalog',args.catalogId,args.revision));
        case 'merchant_opensearch_material_history':return historyPage(model,'material',request);
        case 'merchant_opensearch_material_decision_get':
          return boundedRecord(recordAt(model,'decision',args.decisionId,args.revision));
        case 'merchant_opensearch_material_source':
          return boundedRecord(model.catalog.source(identifier(args.sourceId,'source ID')));
        case 'merchant_opensearch_material_edition':
          return boundedRecord(model.catalog.edition(identifier(args.editionId,'edition ID')));
        case 'merchant_opensearch_material_rows':
          identifier(args.editionId,'edition ID');checkReadPaging(args);
          return await readSnapshot(catalog=>boundedOriginalPage(input=>catalog.materials(input),request));
        case 'merchant_opensearch_material_changes':
          identifier(args.editionId,'edition ID');checkReadPaging(args);
          return await readSnapshot(catalog=>boundedOriginalPage(input=>catalog.changes(input),request));
        case 'merchant_opensearch_material_get': {
          identifier(args.editionId,'edition ID');hash(args.materialKey,'material key');
          model.catalog.edition(args.editionId);
          const material=model.catalog.material(args.editionId,args.materialKey);
          if(!material)fail('CATALOG_MATERIAL_NOT_FOUND','Material not found in the selected original edition.',404);
          return boundedRecord(material);
        }
        case 'merchant_opensearch_material_facets':return boundedRecord(facetPage(model,request));
        case 'merchant_opensearch_material_suggest':
          identifier(args.catalogId,'catalog ID');checkReadPaging(args);
          return await readSnapshot(catalog=>boundedOriginalPage(input=>catalog.suggest(input),request,'candidates'));
        case 'merchant_opensearch_material_quantity':
          identifier(args.catalogId,'catalog ID');hash(args.materialKey,'material key');hash(args.expectedMaterialSha256,'material SHA-256');
          return model.catalog.quantity(request);
        case 'merchant_opensearch_material_save':
          if((args.catalogId===undefined)!==(args.expectedRevision===undefined))
            fail('OPENSEARCH_MATERIAL_INVALID_PARAMS','Catalog updates require catalogId and expectedRevision together.');
          return model.catalog.save(request);
        case 'merchant_opensearch_material_upload': {
          const input=selectedInput(entry,args.inputId);
          return model.catalog.upload({requestId:args.requestId,name:input.name,bytes:input.bytes,sha256:input.sha256,
            format:args.format,...(args.provenance===undefined?{}:{provenance:args.provenance})},inputBytes(input,this.#owner(scope)));
        }
        case 'merchant_opensearch_material_preview':return model.catalog.preview(request);
        case 'merchant_opensearch_material_select':return model.catalog.select(request);
        case 'merchant_opensearch_material_decision':return model.catalog.saveDecision(request);
        case 'merchant_opensearch_material_draft':return model.catalog.createDraft(request);
        case 'merchant_opensearch_material_receive': {
          const input=selectedInput(entry,args.inputId);
          return model.catalog.importBundle({requestId:args.requestId,name:input.name,bytes:input.bytes,sha256:input.sha256},
            inputBytes(input,this.#owner(scope)));
        }
        case 'merchant_opensearch_material_export':return await this.#export(scope,model,'material',args);
        case 'merchant_opensearch_supplier_templates':return boundedRecord(model.catalog.supplier.templates());
        case 'merchant_opensearch_supplier_list':return collectionPage(model,'supplier',request);
        case 'merchant_opensearch_supplier_plan':
          return boundedRecord(recordAt(model,'plan',args.planId,args.revision));
        case 'merchant_opensearch_supplier_history':return historyPage(model,'supplier',request);
        case 'merchant_opensearch_supplier_product':
          identifier(args.planId,'submission ID');hash(args.materialKey,'material key');
          return boundedRecord(model.catalog.supplier.currentProduct(request));
        case 'merchant_opensearch_supplier_correction_get':
          return boundedRecord(recordAt(model,'correction',args.correctionId,args.revision));
        case 'merchant_opensearch_supplier_review_get':
          return boundedRecord(model.catalog.supplier.review(identifier(args.reviewId,'review ID')));
        case 'merchant_opensearch_supplier_rows':
          identifier(args.reviewId,'review ID');checkReadPaging(args);
          return await readSnapshot(catalog=>boundedOriginalPage(input=>catalog.supplier.rows(input),request));
        case 'merchant_opensearch_supplier_row':
          identifier(args.reviewId,'review ID');hash(args.materialKey,'material key');
          return boundedRecord(model.catalog.supplier.reviewRow(request));
        case 'merchant_opensearch_supplier_save':
          if((args.planId===undefined)!==(args.expectedRevision===undefined))
            fail('OPENSEARCH_MATERIAL_INVALID_PARAMS','Submission updates require planId and expectedRevision together.');
          return model.catalog.supplierSave(request);
        case 'merchant_opensearch_supplier_correction':return model.catalog.supplierCorrection(request);
        case 'merchant_opensearch_supplier_review':return model.catalog.supplierReview(request);
        case 'merchant_opensearch_supplier_export':return await this.#export(scope,model,'supplier',args);
        case 'merchant_opensearch_material_export_manifest': {
          const result=await readRetainedManifest(model,this.#owner(scope),identifier(args.exportId,'export ID'));
          return {state:'MANIFEST_RETAINED',exportId:result.exportId,manifestFile:result.manifestFile};
        }
        case 'merchant_opensearch_material_export_file':return await this.#readExport(scope,args,{model,entry,files});
        case 'merchant_opensearch_material_export_file_release': {
          identifier(args.exportId,'export ID');
          if(typeof args.readId!=='string'||!args.readId||args.readId.length>160)
            fail('OPENSEARCH_MATERIAL_READ_INVALID','Use the original retained file read ID.');
          const live=this.#pruneReads(scope,files),selected=this.#readOwners.get(args.readId);
          if(live.has(args.readId)&&(!selected||selected.scope!==scope||selected.exportId!==args.exportId))
            fail('OPENSEARCH_READ_CONFLICT','This read ID belongs to a different original file selection.',409);
          await files.release(scope,args.readId);this.#readOwners.delete(args.readId);
          return {released:true,exportId:args.exportId,readId:args.readId};
        }
        default:throw failure('METHOD_NOT_FOUND','Unknown material or supplier workspace tool.');
      }
    }catch(error){throw ioFailure(error);}
  }
}
