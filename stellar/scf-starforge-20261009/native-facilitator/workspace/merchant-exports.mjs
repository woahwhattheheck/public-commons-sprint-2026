// MIT. Durable receiving of original native profiles and fixed-version catalog views.
import {constants} from 'node:fs';
import {open, mkdir, readdir, link, unlink, lstat} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {acquireStateLease} from '../../merchant-fleet-gateway/state-lease.mjs';
import {saveJSON} from '../../distribution/runtime-workspace/storage.mjs';
import {privateDirectory} from './store.mjs';
import {readNativePrivateFile} from './merchant-connection.mjs';
import {NATIVE_OPERATOR_EXPORT_SCHEMA, NATIVE_OPERATOR_MANIFEST,
  NATIVE_OPERATOR_MAX_FILE_BYTES, NATIVE_OPERATOR_MAX_MANIFEST_BYTES,
  nativeAlias, nativeDigest, nativeJSON, nativeCanonicalJSON, nativeExportRequest,
  parseNativeOperatorManifest, validateNativeOperatorManifest, requireNative, isDigest} from './merchant-export-contract.mjs';

const decode = bytes => new TextDecoder('utf-8', {fatal:true}).decode(bytes);
async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try {await handle.sync();} finally {await handle.close();}
}
async function privateChild(path, create) {
  if (create) await mkdir(path, {mode:0o700}).catch(error => {if (error.code !== 'EEXIST') throw error;});
  await privateDirectory(path);
  if (create) await syncDirectory(dirname(path));
}
async function optionalBytes(path, maximum) {
  try {return await readNativePrivateFile(path, maximum);}
  catch (error) {if (error.code === 'ENOENT') return null; throw error;}
}
async function immutableJSON(path, value) {
  const expected = Buffer.from(nativeJSON(value));
  requireNative(expected.length <= NATIVE_OPERATOR_MAX_MANIFEST_BYTES, 'NATIVE_OPERATOR_MANIFEST_TOO_LARGE');
  try {await saveJSON(path, value);}
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const actual = await readNativePrivateFile(path, NATIVE_OPERATOR_MAX_MANIFEST_BYTES);
    requireNative(actual.equals(expected), 'NATIVE_OPERATOR_EXPORT_CONFLICT',
      'This receiving operation already retains different original bytes.');
  }
  return expected;
}
async function openedFile(path, file) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat({bigint:true});
    requireNative(stat.isFile() && stat.size === BigInt(file.bytes) && !(stat.mode & 0o077n) &&
      (process.getuid === undefined || stat.uid === BigInt(process.getuid())),
    'NATIVE_OPERATOR_EXPORT_FILE_CHANGED');
    return handle;
  } catch (error) {await handle.close(); throw error;}
}
async function verifyFile(path, file) {
  const handle = await openedFile(path, file);
  try {
    const before = await handle.stat({bigint:true}), hash = createHash('sha256'), buffer = Buffer.alloc(196608);
    let offset = 0;
    while (offset < file.bytes) {
      const {bytesRead} = await handle.read(buffer, 0, Math.min(buffer.length,file.bytes-offset),offset);
      requireNative(bytesRead > 0, 'NATIVE_OPERATOR_EXPORT_FILE_CHANGED');
      hash.update(buffer.subarray(0,bytesRead)); offset += bytesRead;
    }
    const after = await handle.stat({bigint:true});
    requireNative(['dev','ino','size','mtimeNs','ctimeNs'].every(key => before[key] === after[key]) &&
      hash.digest('hex') === file.sha256, 'NATIVE_OPERATOR_EXPORT_FILE_CHANGED');
  } finally {await handle.close();}
}
function publicManifest(bytes, exportId) {
  const manifest = parseNativeOperatorManifest(bytes, exportId);
  return {state:'MANIFEST_RETAINED', exportId, operator:manifest.operator,
    manifestSha256:nativeDigest(bytes),
    manifestFile:{name:NATIVE_OPERATOR_MANIFEST, bytes:bytes.length, sha256:nativeDigest(bytes)},
    manifest};
}

export class NativeOperatorExports {
  #directory;
  constructor(exportsDirectory) {this.#directory = exportsDirectory;}
  async #path(operator, exportId, create = false) {
    nativeAlias(operator); if (exportId !== undefined) nativeAlias(exportId);
    await privateDirectory(this.#directory);
    const root = join(this.#directory,'native-operator-exports'), alias = join(root,operator);
    await privateChild(root,create); await privateChild(alias,create);
    if (exportId === undefined) return alias;
    const path = join(alias,exportId); await privateChild(path,create); return path;
  }
  async manifest(operator, exportId) {
    const path = await this.#path(operator,exportId);
    const bytes = await readNativePrivateFile(join(path,NATIVE_OPERATOR_MANIFEST),NATIVE_OPERATOR_MAX_MANIFEST_BYTES);
    const result = publicManifest(bytes,exportId);
    requireNative(result.manifest.operator === operator,'NATIVE_OPERATOR_EXPORT_CONFLICT');
    return result;
  }
  async list(operator, {after = '', limit = 30} = {}) {
    nativeAlias(operator);
    requireNative(after === '' || nativeAlias(after), 'NATIVE_OPERATOR_EXPORT_CURSOR_INVALID');
    requireNative(Number.isSafeInteger(limit) && limit >= 1 && limit <= 100,'NATIVE_OPERATOR_EXPORT_PAGE_INVALID');
    let directory;
    try {directory = await this.#path(operator);}
    catch (error) {if (error.code === 'ENOENT') return {items:[],next:null}; throw error;}
    const names = (await readdir(directory,{withFileTypes:true})).filter(entry => entry.isDirectory() &&
      /^[a-z0-9][a-z0-9_-]{0,63}$/.test(entry.name)).map(entry=>entry.name).sort();
    const selected = names.filter(name=>name>after).slice(0,limit), items = [];
    for (const exportId of selected) {
      try {
        const current = await this.manifest(operator,exportId);
        const m = current.manifest;
        items.push({exportId,state:current.state,kind:m.kind,capturedAt:m.capturedAt,
          profile:m.source.profile,network:m.source.network,files:m.files,
          manifestSha256:current.manifestSha256});
      } catch (error) {
        if (error.code === 'ENOENT') items.push({exportId,state:'RECEIVING'});
        else items.push({exportId,state:'UNAVAILABLE',error:error.code??'NATIVE_OPERATOR_EXPORT_UNAVAILABLE'});
      }
    }
    return {items,next:selected.length&&names.some(name=>name>selected.at(-1))?selected.at(-1):null};
  }
  async #captureFile(directory, name, produce, lease) {
    const path = join(directory,name+'.part');
    await unlink(path).catch(error=>{if(error.code!=='ENOENT')throw error;});
    const handle = await open(path,'wx',0o600), hash = createHash('sha256'); let bytes = 0;
    try {
      const result = await produce(async text => {
        requireNative(typeof text === 'string','NATIVE_OPERATOR_EXPORT_STREAM_INVALID');
        const chunk = Buffer.from(text,'utf8');
        requireNative(bytes + chunk.length <= (name==='profile.json'?65536:NATIVE_OPERATOR_MAX_FILE_BYTES),
          'NATIVE_OPERATOR_EXPORT_FILE_TOO_LARGE');
        lease.assertHeld(); let written = 0;
        while (written < chunk.length) {
          const output = await handle.write(chunk,written,chunk.length-written,bytes+written);
          requireNative(output.bytesWritten > 0,'NATIVE_OPERATOR_EXPORT_WRITE_INCOMPLETE');
          written += output.bytesWritten;
        }
        hash.update(chunk); bytes += chunk.length;
      });
      requireNative(bytes > 0,'NATIVE_OPERATOR_EXPORT_STREAM_INVALID');
      lease.assertHeld(); await handle.sync();
      return {result,file:{name,bytes,sha256:hash.digest('hex')}};
    } finally {await handle.close();}
  }
  async #finish(directory, manifest, lease) {
    validateNativeOperatorManifest(manifest,manifest.exportId);
    for (const file of manifest.files) {
      lease.assertHeld();
      const final = join(directory,file.name), partial = final+'.part';
      let exists = false;
      try {await verifyFile(final,file); exists = true;}
      catch (error) {if(error.code!=='ENOENT')throw error;}
      if (!exists) {
        await verifyFile(partial,file); lease.assertHeld();
        try {await link(partial,final);}
        catch (error) {if(error.code!=='EEXIST')throw error; await verifyFile(final,file);}
        await syncDirectory(directory);
      }
      await unlink(partial).catch(error=>{if(error.code!=='ENOENT')throw error;});
      await syncDirectory(directory);
    }
    lease.assertHeld();
    const bytes = await immutableJSON(join(directory,NATIVE_OPERATOR_MANIFEST),manifest);
    return publicManifest(bytes,manifest.exportId);
  }
  /** Same-ID continuation reopens completed bytes, or finishes the same retained capture. */
  async capture(input, connect) {
    const request = nativeExportRequest(input), requestSha256 = nativeDigest(nativeCanonicalJSON(request));
    const directory = await this.#path(request.operator,request.exportId,true);
    let lease;
    try {lease = await acquireStateLease(directory);}
    catch (error) {
      requireNative(false, error.message==='FLEET_STATE_ALREADY_OWNED'?'NATIVE_OPERATOR_EXPORT_BUSY':'NATIVE_OPERATOR_EXPORT_LEASE_REQUIRED',
        error.message==='FLEET_STATE_ALREADY_OWNED'?'The original receiving operation is already active.':'Use the existing Linux flock receiving runtime.');
    }
    try {
      lease.assertHeld();
      const requestPath = join(directory,'request.json'), previous = await optionalBytes(requestPath,NATIVE_OPERATOR_MAX_MANIFEST_BYTES);
      if (previous) requireNative(nativeCanonicalJSON(JSON.parse(decode(previous))) === nativeCanonicalJSON(request),
        'NATIVE_OPERATOR_EXPORT_CONFLICT','Continue this receiving ID with its exact original selection.');
      else await immutableJSON(requestPath,request);
      const complete = await optionalBytes(join(directory,NATIVE_OPERATOR_MANIFEST),NATIVE_OPERATOR_MAX_MANIFEST_BYTES);
      if (complete) {
        const result = publicManifest(complete,request.exportId);
        requireNative(result.manifest.requestSha256 === requestSha256,'NATIVE_OPERATOR_EXPORT_CONFLICT');
        // Final files are checked when selected for their native descriptor read.
        return result;
      }
      const captured = await optionalBytes(join(directory,'capture.json'),NATIVE_OPERATOR_MAX_MANIFEST_BYTES);
      if (captured) {
        const manifest = parseNativeOperatorManifest(captured,request.exportId);
        requireNative(manifest.requestSha256 === requestSha256,'NATIVE_OPERATOR_EXPORT_CONFLICT');
        return await this.#finish(directory,manifest,lease);
      }
      // Uncommitted .part files belong to this receiving ID. The original
      // read-only selection may restart while no complete capture is retained.
      for (const name of ['profile.json','catalog.json']) {
        let exists = true;
        try {await lstat(join(directory,name));} catch (error) {if(error.code==='ENOENT')exists=false;else throw error;}
        requireNative(!exists,'NATIVE_OPERATOR_EXPORT_STATE_INVALID');
      }
      const connected = await connect(), client = connected.client;
      const options = () => ({signal:AbortSignal.timeout(connected.timeoutMs)});
      let source, capturedAt, files;
      if (request.kind === 'profile') {
        const profile = await client.profile(request.selection.name,options());
        requireNative(profile.sha256 === request.selection.sha256,'FACILITATOR_SELECTED_PROFILE_CHANGED');
        const profileFile = await this.#captureFile(directory,'profile.json',async write=>{
          await write(await client.downloadProfile(request.selection,options()));
        },lease);
        requireNative(profileFile.file.sha256 === request.selection.sha256,'NATIVE_OPERATOR_PROFILE_BYTES_CHANGED');
        source = {operator:connected.identity,profile:request.selection,network:profile.config.network};
        files = [profileFile.file]; capturedAt = new Date().toISOString();
      } else {
        const catalogFile = await this.#captureFile(directory,'catalog.json',write=>
          client.streamCatalog(request.selection,{...options(),write}),lease);
        const received = catalogFile.result, profile = received.metadata.profile;
        const profileFile = await this.#captureFile(directory,'profile.json',async write=>{
          await write(await client.downloadProfile(profile,options()));
        },lease);
        requireNative(profileFile.file.sha256 === profile.sha256,'NATIVE_OPERATOR_PROFILE_BYTES_CHANGED');
        source = {operator:connected.identity,profile,network:received.metadata.network,
          catalog:{...received.metadata,resourceCount:received.resourceCount,pages:received.pages}};
        capturedAt = received.metadata.observedAt; files = [profileFile.file,catalogFile.file];
      }
      const manifest = {schema:NATIVE_OPERATOR_EXPORT_SCHEMA,exportId:request.exportId,
        operator:request.operator,kind:request.kind,request,requestSha256,capturedAt,source,files};
      validateNativeOperatorManifest(manifest,request.exportId);
      lease.assertHeld(); await immutableJSON(join(directory,'capture.json'),manifest);
      return await this.#finish(directory,manifest,lease);
    } finally {await lease.close();}
  }
  /** Original readers receive the complete manifest or sole ownership of its immutable file descriptor. */
  async file(operator, exportId, name, expectedManifestSha256) {
    requireNative(isDigest(expectedManifestSha256),'NATIVE_OPERATOR_MANIFEST_SHA256_REQUIRED');
    const directory = await this.#path(operator,exportId);
    const manifestBytes = await readNativePrivateFile(join(directory,NATIVE_OPERATOR_MANIFEST),NATIVE_OPERATOR_MAX_MANIFEST_BYTES);
    requireNative(nativeDigest(manifestBytes)===expectedManifestSha256,'NATIVE_OPERATOR_EXPORT_CONFLICT');
    const manifest = parseNativeOperatorManifest(manifestBytes,exportId);
    requireNative(manifest.operator===operator,'NATIVE_OPERATOR_EXPORT_CONFLICT');
    if(name===NATIVE_OPERATOR_MANIFEST)return {bytes:manifestBytes,name:NATIVE_OPERATOR_MANIFEST,type:'application/json'};
    const file = manifest.files.find(value=>value.name===name);
    requireNative(file,'NATIVE_OPERATOR_EXPORT_FILE_UNKNOWN','Choose a file declared by this original completion manifest.');
    return {readonlyFileHandle:await openedFile(join(directory,file.name),file),
      name:file.name,bytes:file.bytes,sha256:file.sha256,type:'application/json'};
  }
}
