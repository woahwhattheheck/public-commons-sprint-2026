// MIT. Complete native Baserow packets and merchant files in the original retained transport.
import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath, readdir, unlink, rename, link } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { acquireStateLease } from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';

export const BASEROW_EXPORT_SCHEMA = 'stellar-forge.baserow-mcp-export.v1';
export const BASEROW_EXPORT_MAX_BYTES = 553648128;
export const BASEROW_EXPORT_MANIFEST = 'manifest.json';
export const BASEROW_DEPLOYMENT_NAMES = Object.freeze(['dataset.csv','dataset.json','seller.json','source.json','binding.json']);
const HASH = /^[a-f0-9]{64}$/, UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/, ATTACHMENT = /^attachment-[0-9]{6}\.bin$/;
const REQUEST = 'stellar-forge.baserow-mcp-export-request.v1';
const fail = (code, message = code) => Object.assign(new Error(message), { code: 'BASEROW_FILE_' + code });
const sha = value => createHash('sha256').update(value).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = value => Array.isArray(value) ? value.map(canonical) : plain(value) ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const identity = value => sha(JSON.stringify(canonical(value)));
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const decode = value => new TextDecoder('utf-8', { fatal: true }).decode(value);
export function baserowExportId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw fail('EXPORT_ID_REQUIRED', 'Use one UUIDv4 for the complete export and its recovery.');
  return value;
}
export function baserowExportSelection(value) {
  if (!plain(value) || Object.keys(value).some(key => !['kind','captureId','versionId','packageRequestId',
      'expectedCaptureSha256','expectedSourceSha256','expectedPackageSha256','file','expectedFileSha256'].includes(key)) ||
      !['capture','version','deployment','handoff','attachment'].includes(value.kind))
    throw fail('SELECTION_INVALID', 'Select an original capture, source version, deployment, complete handoff or attachment.');
  const isCapture = ['capture','attachment'].includes(value.kind), isVersion = ['version','handoff'].includes(value.kind);
  const isDeployment = ['deployment','handoff'].includes(value.kind);
  for (const [key, required] of [['captureId',isCapture],['versionId',isVersion],['packageRequestId',isDeployment],
      ['expectedCaptureSha256',isCapture || isVersion],['expectedSourceSha256',isVersion],
      ['expectedPackageSha256',isDeployment],['file',value.kind === 'attachment'],['expectedFileSha256',value.kind === 'attachment']]) {
    if (required !== Object.hasOwn(value,key)) throw fail('SELECTION_INVALID', 'Supply exactly the fields belonging to this native export kind.');
  }
  for (const key of ['captureId','packageRequestId']) if (value[key] !== undefined &&
      (typeof value[key] !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value[key]))) throw fail('SELECTION_INVALID');
  if (value.versionId !== undefined && (!Number.isSafeInteger(value.versionId) || value.versionId < 1)) throw fail('SELECTION_INVALID');
  for (const key of ['expectedCaptureSha256','expectedSourceSha256','expectedPackageSha256','expectedFileSha256'])
    if (value[key] !== undefined && (typeof value[key] !== 'string' || !HASH.test(value[key]))) throw fail('SELECTION_INVALID');
  if (value.file !== undefined && !ATTACHMENT.test(value.file)) throw fail('SELECTION_INVALID');
  return structuredClone(value);
}
function names(selection) {
  if (selection.kind === 'attachment') return [selection.file];
  return [...(['capture','version','handoff'].includes(selection.kind) ? ['baserow-source.json'] : []),
    ...(['deployment','handoff'].includes(selection.kind) ? BASEROW_DEPLOYMENT_NAMES : [])];
}
export function parseBaserowExportManifest(content, exportId) {
  let value;
  try { value = JSON.parse(decode(content)); } catch { throw fail('MANIFEST_INVALID'); }
  if (!plain(value) || value.schema !== BASEROW_EXPORT_SCHEMA || value.exportId !== baserowExportId(exportId) ||
      !ALIAS.test(value.workspace ?? '') || !Array.isArray(value.files) || !plain(value.source) ||
      !Number.isFinite(Date.parse(value.createdAt)) || content.length > 65000) throw fail('MANIFEST_INVALID');
  const selection = baserowExportSelection(value.selection), expected = names(selection);
  if (value.files.length !== expected.length || value.files.some((file,index) => !plain(file) ||
      file.name !== expected[index] || !Number.isSafeInteger(file.bytes) || file.bytes < 0 ||
      file.bytes > BASEROW_EXPORT_MAX_BYTES || typeof file.sha256 !== 'string' || !HASH.test(file.sha256) ||
      typeof file.contentType !== 'string')) throw fail('MANIFEST_INVALID');
  if (identity(selection) !== value.selectionSha256) throw fail('MANIFEST_INVALID');
  return value;
}
async function directory(path, create = true) {
  let created=false;
  if (create) { try { await mkdir(path, { mode: 0o700 }); created=true; } catch(issue) { if (issue.code !== 'EEXIST') throw issue; } }
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || process.platform !== 'win32' && info.mode & 0o077 ||
      await realpath(path) !== path) throw fail('DIRECTORY_INVALID', 'Use the original private canonical export directory.');
  if(created)await sync(dirname(path));
  return path;
}
async function regular(path, maximum = BASEROW_EXPORT_MAX_BYTES) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > maximum || process.platform !== 'win32' && info.mode & 0o077)
      throw fail('PRIVATE_SOURCE_REQUIRED');
    return { handle, info };
  } catch (issue) { await handle.close(); throw issue; }
}
async function bytesAt(path, maximum = 65000) {
  const { handle, info } = await regular(path, maximum);
  try {
    const content = await handle.readFile(), after = await handle.stat();
    if (content.length !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs)
      throw fail('SOURCE_CHANGED');
    return content;
  } finally { await handle.close(); }
}
async function hashAt(path) {
  const { handle, info } = await regular(path);
  try {
    const digest = createHash('sha256'); let length = 0;
    for await (const chunk of handle.createReadStream({ autoClose:false })) { length += chunk.length; digest.update(chunk); }
    const after = await handle.stat();
    if (length !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs)
      throw fail('SOURCE_CHANGED');
    return { bytes:length,sha256:digest.digest('hex') };
  } finally { await handle.close(); }
}
async function sync(path) { const handle = await open(path,constants.O_RDONLY); try { await handle.sync(); } finally { await handle.close(); } }
async function retainJson(path,value) {
  const content=json(value),temporary=path+'.next-'+randomUUID();let handle;
  try {
    handle=await open(temporary,'wx',0o600);await handle.writeFile(content);await handle.sync();await handle.close();handle=null;
    try { await link(temporary,path); }
    catch(issue) {
      if(issue.code!=='EEXIST')throw issue;
      if(!(await bytesAt(path)).equals(content))throw fail('EXPORT_CONFLICT');
    }
  } finally { await handle?.close();await unlink(temporary).catch(issue=>{if(issue.code!=='ENOENT')throw issue;}); }
}
export class BaserowRetainedExports {
  #root; #definitions; #reads = new RetainedFileReads({errorPrefix:'BASEROW_FILE',maxSnapshotBytes:BASEROW_EXPORT_MAX_BYTES});
  #pending = new Set(); #closing = false; #close;
  constructor({directory:root,workspaces}) { this.#root=resolve(root); this.#definitions=workspaces; }
  get summary() { return this.#reads.summary; }
  #workspace(value) {
    if (!ALIAS.test(value ?? '') || !this.#definitions[value]) throw fail('WORKSPACE_NOT_CONFIGURED');
    return value;
  }
  async #base() {
    await directory(this.#root,false); return directory(join(this.#root,'baserow'));
  }
  async #folder(exportId,create=false) {
    baserowExportId(exportId); return directory(join(await this.#base(),exportId),create);
  }
  async #request(exportId) {
    const path=await this.#folder(exportId), saved=JSON.parse(decode(await bytesAt(join(path,'request.json'))));
    if (saved.schema!==REQUEST || saved.exportId!==exportId || !Number.isFinite(Date.parse(saved.createdAt)))
      throw fail('EXPORT_REQUEST_CHANGED');
    this.#workspace(saved.workspace); baserowExportSelection(saved.selection);
    if(saved.selectionSha256!==identity(saved.selection))throw fail('EXPORT_REQUEST_CHANGED');
    return {path,saved};
  }
  async #manifest(exportId) {
    const {path,saved}=await this.#request(exportId), content=await bytesAt(join(path,BASEROW_EXPORT_MANIFEST));
    const manifest=parseBaserowExportManifest(content,exportId);
    if(manifest.workspace!==saved.workspace || manifest.createdAt!==saved.createdAt ||
        manifest.selectionSha256!==saved.selectionSha256)throw fail('EXPORT_CONFLICT');
    return {path,saved,content,manifest,manifestSha256:sha(content)};
  }
  #accept(fn) {
    if(this.#closing)throw fail('CLOSING');
    const pending=Promise.resolve().then(fn);this.#pending.add(pending);
    return pending.finally(()=>this.#pending.delete(pending));
  }
  retain({workspace,exportId,selection,inspect,fetchFile}) {
    return this.#accept(async()=>{
      this.#workspace(workspace);baserowExportId(exportId);selection=baserowExportSelection(selection);
      const path=await this.#folder(exportId,true),lease=await acquireStateLease(path);
      try {
        let request;
        try { request=JSON.parse(decode(await bytesAt(join(path,'request.json')))); }
        catch(issue){if(issue.code!=='ENOENT')throw issue;}
        request??={schema:REQUEST,workspace,exportId,selection,selectionSha256:identity(selection),createdAt:new Date().toISOString()};
        if(request.schema!==REQUEST || request.workspace!==workspace || request.exportId!==exportId ||
            request.selectionSha256!==identity(selection) || identity(request.selection)!==identity(selection))
          throw fail('EXPORT_CONFLICT','This export UUID belongs to a different original selection.');
        await retainJson(join(path,'request.json'),request);await sync(path);
        try { return await this.#describe(exportId); } catch(issue){if(issue.code!=='ENOENT')throw issue;}
        const source=await inspect();
        if(!plain(source) || !plain(source.expectedFiles))throw fail('ORIGINAL_SOURCE_INVALID');
        const files=[];
        for(const name of names(selection)) {
          lease.assertHeld();
          const destination=join(path,name),expected=source.expectedFiles[name]??null;
          let retained;
          try { retained=await hashAt(destination); } catch(issue){if(issue.code!=='ENOENT')throw issue;}
          if(!retained) {
            const temporary=join(path,'.partial-'+name);
            await unlink(temporary).catch(issue=>{if(issue.code!=='ENOENT')throw issue;});
            const handle=await open(temporary,'wx',0o600),digest=createHash('sha256');let length=0,complete=false;
            try {
              const response=await fetchFile(name);
              for await(const chunk of response.body??[]) {
                length+=chunk.length;
                if(length>BASEROW_EXPORT_MAX_BYTES)throw fail('EXPORT_TOO_LARGE');
                digest.update(chunk);await handle.writeFile(chunk);
              }
              await handle.sync();retained={bytes:length,sha256:digest.digest('hex')};
              if(expected && (retained.bytes!==expected.bytes || retained.sha256!==expected.sha256))throw fail('ORIGINAL_FILE_CHANGED');
              lease.assertHeld();await handle.close();
              await rename(temporary,destination);await sync(path);complete=true;
            } finally {
              await handle.close().catch(()=>{});
              if(!complete)await unlink(temporary).catch(()=>{});
            }
          }
          if(expected && (retained.bytes!==expected.bytes || retained.sha256!==expected.sha256))throw fail('ORIGINAL_FILE_CHANGED');
          files.push({name,...retained,contentType:name.endsWith('.json')?'application/json':
            name.endsWith('.csv')?'text/csv; charset=utf-8':'application/octet-stream'});
        }
        const after=await inspect();
        if(identity(after)!==identity(source))throw fail('ORIGINAL_SOURCE_CHANGED');
        const {expectedFiles,...nativeSource}=source;
        const manifest={schema:BASEROW_EXPORT_SCHEMA,workspace,exportId,selection,selectionSha256:identity(selection),
          source:nativeSource,createdAt:request.createdAt,files};
        parseBaserowExportManifest(json(manifest),exportId);
        lease.assertHeld();await retainJson(join(path,BASEROW_EXPORT_MANIFEST),manifest);await sync(path);
        return this.#describe(exportId);
      } finally { await lease.close(); }
    });
  }
  async #describe(exportId) {
    const value=await this.#manifest(exportId);
    return {state:'MANIFEST_RETAINED',exportId,workspace:value.manifest.workspace,
      manifest:value.manifest,manifestSha256:value.manifestSha256,
      manifestFile:{name:BASEROW_EXPORT_MANIFEST,bytes:value.content.length,sha256:value.manifestSha256,contentType:'application/json'}};
  }
  manifest(exportId){return this.#accept(()=>this.#describe(exportId));}
  list({workspace,offset=0,limit=25,expectedSnapshot}={}) {
    return this.#accept(async()=>{
      this.#workspace(workspace);
      if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw fail('PAGE_INVALID');
      const rows=[];
      for(const name of await readdir(await this.#base()))if(UUID.test(name)) {
        const {saved}=await this.#request(name);
        if(saved.workspace!==workspace)continue;
        try {
          const info=await this.#describe(name);
          rows.push({exportId:name,state:info.state,createdAt:saved.createdAt,selection:saved.selection,
            manifestSha256:info.manifestSha256,files:info.manifest.files.length,bytes:info.manifest.files.reduce((sum,file)=>sum+file.bytes,0)});
        } catch(issue) {
          if(issue.code!=='ENOENT')throw issue;
          rows.push({exportId:name,state:'PREPARING',createdAt:saved.createdAt,selection:saved.selection});
        }
      }
      rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.exportId.localeCompare(b.exportId));
      const snapshot=identity(rows);
      if(offset && !expectedSnapshot || expectedSnapshot!==undefined && expectedSnapshot!==snapshot)throw fail('INVENTORY_CHANGED');
      return {workspace,snapshot,offset,total:rows.length,items:rows.slice(offset,offset+limit),
        nextOffset:offset+limit<rows.length?offset+limit:null};
    });
  }
  file({exportId,file,expectedManifestSha256,expectedSha256,readId,offset,limit}) {
    return this.#accept(async()=>{
      const value=await this.#manifest(exportId);
      if(value.manifestSha256!==expectedManifestSha256)throw fail('MANIFEST_CHANGED');
      const selected=file===BASEROW_EXPORT_MANIFEST
        ?{name:file,bytes:value.content.length,sha256:value.manifestSha256,contentType:'application/json'}
        :value.manifest.files.find(item=>item.name===file);
      if(!selected || expectedSha256!==selected.sha256)throw fail('SELECTION_CHANGED');
      const result=await this.#reads.read({scope:exportId,key:file,kind:'baserow-'+value.manifest.selection.kind,
        directory:value.path,readId,offset,limit,expectedSha256,
        loadFile:async()=>({path:join(value.path,file),name:file,type:selected.contentType,bytes:selected.bytes})});
      return {exportId,workspace:value.manifest.workspace,manifestSha256:value.manifestSha256,...result};
    });
  }
  release({exportId,readId}) {
    return this.#accept(async()=>{
      await this.#request(exportId);await this.#reads.release(exportId,readId);
      return {exportId,readId,state:'RELEASED'};
    });
  }
  sourcePacket(exportId) {
    return this.#accept(async()=>{
      const value=await this.#manifest(exportId);
      if(!['capture','version','handoff'].includes(value.manifest.selection.kind))throw fail('SOURCE_PACKET_REQUIRED');
      const file=value.manifest.files.find(file=>file.name==='baserow-source.json');
      return {path:join(value.path,file.name),...file,workspace:value.manifest.workspace,
        manifest:value.manifest,manifestSha256:value.manifestSha256};
    });
  }
  close() {
    if(!this.#close){this.#closing=true;this.#close=(async()=>{
      await Promise.allSettled([...this.#pending]);await this.#reads.close();
    })();}return this.#close;
  }
}
