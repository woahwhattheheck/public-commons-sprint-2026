// MIT. Complete private SF96 case recovery; no path or ledger relocation.
import { createReadStream } from 'node:fs';
import { constants } from 'node:fs';
import { open, lstat, readdir, realpath, mkdir, mkdtemp, rm, rename, chmod, unlink } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes, createCipheriv, createDecipheriv, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { createGzip, createGunzip } from 'node:zlib';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { show } from '../operator.mjs';
import { absolutePath, privateDirectory, privateInfo, readPrivate, readJSON, writeNew,
  hashBytes, encodeJSON, requireValue as need, fail, syncDirectory, withPilotLock, processStatus, withAdmissionGate, inspectPilotLock, pilotLockPath, replaceJSON } from '../operator-lock.mjs';

const scrypt = promisify(scryptCallback);
const MAGIC = Buffer.from('SF96CASE1\n');
const SCHEMA = 'scf.sf96.complete-case.v1';
const MAX_BYTES = 512 * 1024 * 1024;
const MAX_FILES = 8192;
const HASH = /^[a-f0-9]{64}$/;
const size32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const now = () => new Date().toISOString();
const within = (parent, child) => child === parent || child.startsWith(parent + sep);
function passphraseBytes(value) {
  need(typeof value === 'string' && value.length >= 12 && Buffer.byteLength(value) <= 4096,
    'RECOVERY_PASSPHRASE_MINIMUM_12_CHARACTERS');
  return Buffer.from(value);
}
async function keyFor(value, salt) {
  const bytes = passphraseBytes(value);
  try { return await scrypt(bytes, salt, 32, {N:32768, r:8, p:1, maxmem:64 * 1024 * 1024}); }
  finally { bytes.fill(0); }
}
async function fingerprint(handle) {
  const hash = (await import('node:crypto')).createHash('sha256');
  let size = 0;
  for await (const bytes of handle.createReadStream({start:0, autoClose:false})) { hash.update(bytes); size += bytes.length; }
  return {sha256:hash.digest('hex'),bytes:size};
}
async function tree(directory) {
  const output = []; let total = 0;
  async function walk(path, prefix) {
    const entries = (await readdir(path, {withFileTypes:true})).sort((a,b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const name = prefix ? prefix + '/' + entry.name : entry.name;
      need(name.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(name) && !entry.name.startsWith('.sf96-write-') &&
        !entry.name.startsWith('.sf96-update-'), 'RECOVERY_INCOMPLETE_LOCAL_WRITE', 409);
      const full = join(directory, name), info = await lstat(full);
      need(!info.isSymbolicLink() && privateInfo(info), 'RECOVERY_PRIVATE_REGULAR_TREE_REQUIRED');
      need(output.length < MAX_FILES, 'RECOVERY_FILE_LIMIT');
      if (info.isDirectory()) {
        need(await realpath(full) === full, 'RECOVERY_ALIASED_DIRECTORY_REFUSED');
        output.push({path:name,type:'directory',mode:info.mode & 0o700,bytes:0});
        await walk(full,name);
      } else {
        need(info.isFile() && info.nlink === 1 && Number.isSafeInteger(info.size), 'RECOVERY_PRIVATE_REGULAR_TREE_REQUIRED');
        total += info.size; need(total <= MAX_BYTES, 'RECOVERY_BYTE_LIMIT');
        const h = await open(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
          const bytes = await fingerprint(h), after = await h.stat();
          need(after.dev === info.dev && after.ino === info.ino && after.size === info.size &&
            after.mtimeMs === info.mtimeMs && bytes.bytes === info.size, 'RECOVERY_CASE_CHANGED', 409);
          output.push({path:name,type:'file',mode:info.mode & 0o700,bytes:info.size,sha256:bytes.sha256});
        } finally { await h.close(); }
      }
    }
  }
  await walk(directory,'');
  return {entries:output,totalBytes:total};
}
const identity = snapshot => hashBytes(encodeJSON(snapshot));
async function sourceReferences(directory, workspace, configured) {
  const references = [
    ['DESK_OPERATOR','../operator.mjs'],['DESK_OPERATOR_CLI','../operator-cli.mjs'],
    ['DESK_COORDINATOR','../operator-lock.mjs'],
    ['DESK_NATIVE_WORKSPACE','../../sf88-operator-buyer-cli/workspace.mjs'],
    ['DESK_NATIVE_QUEUE','../../sf88-operator-buyer-cli/queue.mjs'],
    ['DESK_NATIVE_SIGNER','../../sf88-operator-buyer-cli/native-signer.mjs'],
    ['DESK_NATIVE_DEPENDENCIES','../../sf88-operator-buyer-cli/package-lock.json'],
  ].map(([role,part]) => ({role,path:fileURLToPath(new URL(part,import.meta.url)),required:true}));
  references.push({role:'ORIGINAL_WORKSPACE_CLI',path:absolutePath(workspace.sourceCli)});
  const adapter = absolutePath(configured.signerModule);
  need(adapter === join(directory,'operator','signer.mjs'),'RECOVERY_ORIGINAL_SIGNER_PATH_CHANGED');
  references.push({role:'ORIGINAL_GENERATED_SIGNER',path:adapter,includedInCase:true,required:true});
  const source = new TextDecoder('utf-8',{fatal:true}).decode(await readPrivate(adapter,65536));
  const imports = [...source.matchAll(/^\s*import\s*\{[^}]*\}\s*from\s*("(?:\\.|[^"\\])*")\s*;/gm)];
  for (const match of imports) {
    const specifier = JSON.parse(match[1]),url = new URL(specifier);
    need(url.protocol === 'file:' && !url.search && !url.hash,'RECOVERY_NATIVE_SIGNER_REFERENCE_INVALID');
    references.push({role:'ORIGINAL_SIGNER_IMPLEMENTATION',path:fileURLToPath(url)});
  }
  if (workspace.signerProvider)
    references.push({role:'ORIGINAL_TRUSTED_SIGNER_PROVIDER',path:absolutePath(workspace.signerProvider)});
  const entries = [];
  for (const reference of references) {
    let handle;
    try {
      handle = await open(reference.path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
      entries.push({role:reference.role,path:reference.path,status:'PRESENT',
        ...(reference.includedInCase?{includedInCase:true}:{}),...await fingerprint(handle)});
    } catch(error) {
      if(reference.required || !['ENOENT','ENOTDIR','ELOOP','EACCES'].includes(error.code))throw error;
      // Preserve the actual bound path even when an old checkout/provider is
      // absent. Losing external code must not prevent saving the native case.
      entries.push({role:reference.role,path:reference.path,status:'UNAVAILABLE',reason:error.code});
    } finally {await handle?.close();}
  }
  if (!imports.length)
    entries.push({role:'ORIGINAL_SIGNER_IMPORTS',path:adapter,status:'REQUIRES_ADAPTER_REVIEW',includedInCase:true});
  return entries;
}
async function ensureStopped(native) {
  if (native.buyer.state === 'RUNNING_OR_INTERRUPTED')
    need(await processStatus(native.buyer.attempt) === 'STOPPED', 'RECOVERY_ORIGINAL_ATTEMPT_STILL_ACTIVE_OR_REMOTE', 409);
}
export async function createRecovery(directoryInput, destinationInput, passphrase) {
  const directory = absolutePath(directoryInput), destination = absolutePath(destinationInput);
  await privateDirectory(directory); await privateDirectory(dirname(destination));
  need(!within(directory,destination), 'RECOVERY_OUTPUT_MUST_BE_OUTSIDE_CASE');
  passphraseBytes(passphrase).fill(0);
  return withPilotLock(directory,'BACKUP',async () => {
    const native = await show(directory); await ensureStopped(native);
    const snapshot = await tree(directory), originalWorkspace = await readJSON(join(directory,'operator','workspace.json'));
    const configured = await readJSON(join(directory,'operator','operator.json'));
    const manifest = {schema:SCHEMA,createdAt:now(),originalDirectory:directory,
      intentId:native.intentId,captureSha256:native.source.captureSha256,
      queueConfigSha256:native.buyer.configSha256,state:native.buyer.state,
      files:snapshot.entries.length,totalBytes:snapshot.totalBytes,treeSha256:identity(snapshot),
      sourceReferences:await sourceReferences(directory,originalWorkspace,configured),
      runtime:{node:process.versions.node,python:configured.operator.python,
        sourceCli:originalWorkspace.sourceCli,signerModule:configured.signerModule,
        signerProvider:originalWorkspace.signerProvider ?? null,
        walletEnvironmentName:originalWorkspace.walletKeyEnvironment ?? null},
      restore:'ORIGINAL_ABSOLUTE_DIRECTORY_ONLY',walletEnvironmentIncluded:false,
      custody:'COMPLETE_PRIVATE_CASE_INCLUDING_ORIGINAL_ACCOUNTING_KEYS'};
    const salt = randomBytes(16), iv = randomBytes(12), key = await keyFor(passphrase,salt);
    const header = encodeJSON({schema:'scf.sf96.encrypted-case.v1',cipher:'aes-256-gcm',
      kdf:'scrypt',N:32768,r:8,p:1,salt:salt.toString('hex'),iv:iv.toString('hex')});
    const aad = Buffer.concat([MAGIC,size32(header.length),header]);
    const temporary = destination + '.partial-' + randomBytes(12).toString('hex');
    let handle, published = false;
    try {
      handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,0o600);
      await handle.write(aad);
      const cipher = createCipheriv('aes-256-gcm',key,iv); cipher.setAAD(aad);
      async function* records() {
        const metadata = encodeJSON(manifest); yield size32(metadata.length); yield metadata;
        for (const entry of snapshot.entries) {
          const description = encodeJSON(entry); yield size32(description.length); yield description;
          if (entry.type === 'file') {
            const h = await open(join(directory,entry.path),constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
            try {
              const hash = (await import('node:crypto')).createHash('sha256'); let count = 0;
              for await (const bytes of h.createReadStream({start:0,autoClose:false})) {
                hash.update(bytes); count += bytes.length;
                need(count <= entry.bytes,'RECOVERY_CASE_CHANGED',409); yield bytes;
              }
              need(count === entry.bytes && hash.digest('hex') === entry.sha256,'RECOVERY_CASE_CHANGED',409);
            } finally { await h.close(); }
          }
        }
        need(identity(await tree(directory)) === manifest.treeSha256, 'RECOVERY_CASE_CHANGED',409);
        const current = await show(directory);
        need(identity(current) === identity(native),'RECOVERY_CASE_CHANGED',409);
        yield size32(0);
      }
      const sink = new Writable({write(chunk, _encoding, done) {
        handle.writeFile(chunk).then(() => done(), done);
      }});
      await pipeline(Readable.from(records()),createGzip(),cipher,sink);
      await handle.write(cipher.getAuthTag(),0,16,(await handle.stat()).size);
      await handle.sync(); await handle.close(); handle = null;
      // Exclusive publication: never replace an earlier recovery point.
      const {link,unlink} = await import('node:fs/promises');
      await link(temporary,destination); await unlink(temporary); await syncDirectory(dirname(destination));
      published = true;
      const saved = await open(destination,constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try { return {path:destination,name:destination.split(sep).pop(),manifest,...await fingerprint(saved)}; }
      finally { await saved.close(); }
    } finally {
      key.fill(0);
      await handle?.close().catch(() => {});
      if (!published) await rm(temporary,{force:true});
    }
  });
}
async function openEncrypted(filename, passphrase) {
  const path = absolutePath(filename), h = await open(path,constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await h.stat();
    need(info.isFile() && privateInfo(info) && info.size > MAGIC.length + 20 &&
      info.size <= MAX_BYTES + 16 * 1024 * 1024,'RECOVERY_ARCHIVE_INVALID');
    const first = Buffer.alloc(MAGIC.length + 4);
    need((await h.read(first,0,first.length,0)).bytesRead === first.length &&
      first.subarray(0,MAGIC.length).equals(MAGIC),'RECOVERY_ARCHIVE_INVALID');
    const length = first.readUInt32BE(MAGIC.length);
    need(length > 0 && length <= 2048,'RECOVERY_ARCHIVE_INVALID');
    const raw = Buffer.alloc(length);
    need((await h.read(raw,0,length,first.length)).bytesRead === length,'RECOVERY_ARCHIVE_INVALID');
    let header; try { header = JSON.parse(raw); } catch { fail('RECOVERY_ARCHIVE_INVALID'); }
    need(header.schema === 'scf.sf96.encrypted-case.v1' && header.cipher === 'aes-256-gcm' &&
      header.kdf === 'scrypt' && header.N === 32768 && header.r === 8 && header.p === 1 &&
      /^[a-f0-9]{32}$/.test(header.salt) && /^[a-f0-9]{24}$/.test(header.iv),'RECOVERY_ARCHIVE_INVALID');
    const aad = Buffer.concat([first,raw]), key = await keyFor(passphrase,Buffer.from(header.salt,'hex'));
    const tag = Buffer.alloc(16);
    await h.read(tag,0,16,info.size-16);
    const decipher = createDecipheriv('aes-256-gcm',key,Buffer.from(header.iv,'hex'));
    key.fill(0); decipher.setAAD(aad); decipher.setAuthTag(tag);
    const input = h.createReadStream({start:aad.length,end:info.size-17,autoClose:false});
    const gunzip = createGunzip();
    const completion = pipeline(input,decipher,gunzip);
    completion.catch(() => {}); // Awaited after parsing; avoids an unhandled early auth rejection.
    return {h,input,gunzip,completion};
  } catch (error) { await h.close(); throw error; }
}
class Reader {
  constructor(stream) { this.iterator=stream[Symbol.asyncIterator](); this.buffer=Buffer.alloc(0); this.done=false; }
  async exact(count,allowEnd=false) {
    need(Number.isSafeInteger(count) && count>=0 && count<=MAX_BYTES,'RECOVERY_RECORD_INVALID');
    const chunks=[]; let remaining=count;
    while(remaining) {
      if(!this.buffer.length && !this.done) {
        const next=await this.iterator.next(); this.done=Boolean(next.done);
        this.buffer=next.done?Buffer.alloc(0):Buffer.from(next.value);
      }
      if(!this.buffer.length) {
        if(allowEnd && remaining===count) return null;
        fail('RECOVERY_ARCHIVE_TRUNCATED');
      }
      const size=Math.min(remaining,this.buffer.length);
      chunks.push(this.buffer.subarray(0,size)); this.buffer=this.buffer.subarray(size); remaining-=size;
    }
    return chunks.length===1?chunks[0]:Buffer.concat(chunks,count);
  }
  async json(maximum=65536) {
    const length=(await this.exact(4)).readUInt32BE(0);
    if(length===0)return null;
    need(length<=maximum,'RECOVERY_RECORD_INVALID');
    try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await this.exact(length)));}
    catch(error){if(error.code)throw error;fail('RECOVERY_RECORD_INVALID');}
  }
}
function safeEntry(entry) {
  need(entry && typeof entry.path==='string' && entry.path.length<=2048 &&
    !entry.path.startsWith('/') && !/[\u0000-\u001f\u007f\\]/.test(entry.path) &&
    entry.path.split('/').every(part=>part && part!=='.' && part!=='..') &&
    ['file','directory'].includes(entry.type) && Number.isInteger(entry.mode) &&
    entry.mode>=0o400 && entry.mode<=0o700 && (entry.mode&0o077)===0 &&
    Number.isSafeInteger(entry.bytes) && entry.bytes>=0 && entry.bytes<=MAX_BYTES &&
    (entry.type==='directory'?entry.bytes===0:HASH.test(entry.sha256)),'RECOVERY_RECORD_INVALID');
}
async function consume(filename, passphrase, callbacks={}) {
  const opened=await openEncrypted(filename,passphrase);
  try {
    const reader=new Reader(opened.gunzip), manifest=await reader.json();
    need(manifest?.schema===SCHEMA && manifest.restore==='ORIGINAL_ABSOLUTE_DIRECTORY_ONLY' &&
      manifest.originalDirectory===absolutePath(manifest.originalDirectory) &&
      typeof manifest.intentId==='string' && HASH.test(manifest.treeSha256) &&
      Number.isSafeInteger(manifest.files) && manifest.files>0 && manifest.files<=MAX_FILES &&
      Number.isSafeInteger(manifest.totalBytes) && manifest.totalBytes>=0 && manifest.totalBytes<=MAX_BYTES,
      'RECOVERY_MANIFEST_INVALID');
    await callbacks.manifest?.(manifest);
    const entries=[], names=new Set(); let total=0;
    for(;;) {
      const entry=await reader.json(8192); if(entry===null)break;
      safeEntry(entry); need(!names.has(entry.path) && entries.length<manifest.files,'RECOVERY_RECORD_INVALID');
      names.add(entry.path); total+=entry.bytes; need(total<=manifest.totalBytes,'RECOVERY_BYTE_LIMIT');
      const handle=await callbacks.entry?.(entry);
      try {
        if(entry.type==='file') {
          const hash=(await import('node:crypto')).createHash('sha256'); let remaining=entry.bytes;
          while(remaining) {
            const bytes=await reader.exact(Math.min(65536,remaining));
            hash.update(bytes); if(handle)await handle.writeFile(bytes); remaining-=bytes.length;
          }
          need(hash.digest('hex')===entry.sha256,'RECOVERY_FILE_HASH_MISMATCH');
          await handle?.sync();
        }
      } finally {await handle?.close();}
      await callbacks.finishedEntry?.(entry); entries.push(entry);
    }
    need(entries.length===manifest.files && total===manifest.totalBytes &&
      identity({entries,totalBytes:total})===manifest.treeSha256,'RECOVERY_MANIFEST_FILE_MISMATCH');
    need(await reader.exact(1,true)===null,'RECOVERY_TRAILING_DATA');
    await opened.completion;
    return {manifest,entries};
  } catch(error) {
    opened.input.destroy(); opened.gunzip.destroy();
    await opened.completion.catch(()=>{});
    if(['Z_DATA_ERROR','ERR_OSSL_BAD_DECRYPT','ERR_CRYPTO_INVALID_AUTH_TAG'].includes(error.code) || !error.code || !/^[A-Z0-9_]{1,120}$/.test(error.code))
      fail('RECOVERY_PASSPHRASE_OR_ARCHIVE_INVALID');
    throw error;
  } finally {await opened.h.close();}
}
export async function inspectRecovery(filename,passphrase) {
  return consume(filename,passphrase);
}
function restoreIntentPath(directory) {
  return join(dirname(directory),'.sf96-restore-'+hashBytes(directory)+'.json');
}
export async function inspectRestoreOperation(directoryInput) {
  const directory=absolutePath(directoryInput);await privateDirectory(dirname(directory));
  let bytes;
  try{bytes=await readPrivate(restoreIntentPath(directory),65536);}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
  let record;try{record=JSON.parse(bytes);}catch{fail('RECOVERY_RESTORE_INTENT_INVALID');}
  need(record.schema==='scf.sf96.restore-operation.v1'&&record.directory===directory&&
    typeof record.id==='string'&&/^[a-f0-9-]{36}$/.test(record.id)&&
    record.stage===join(dirname(directory),'.sf96-restore-'+hashBytes(directory)+'-'+record.id)&&
    HASH.test(record.treeSha256)&&HASH.test(record.ownerSha256),'RECOVERY_RESTORE_INTENT_INVALID');
  const lock=await inspectPilotLock(directory);
  const ownerStatus=await processStatus(record.owner);
  let stagePresent=false,destinationPresent=false;
  try{await lstat(record.stage);stagePresent=true;}catch(error){if(error.code!=='ENOENT')throw error;}
  try{await lstat(directory);destinationPresent=true;}catch(error){if(error.code!=='ENOENT')throw error;}
  const {owner,...publicRecord}=record;
  return {...publicRecord,sha256:hashBytes(bytes),ownerStatus,lock,stagePresent,destinationPresent,
    canRetire:(ownerStatus==='STOPPED'||(record.phase==='FAILED'&&!lock))&&
      (!lock||(lock.sha256===record.ownerSha256&&lock.state==='STOPPED'))};
}
export async function retireInterruptedRestore(directoryInput,expectedIntentSha256) {
  const directory=absolutePath(directoryInput);
  return withAdmissionGate(directory,async()=>{
    const current=await inspectRestoreOperation(directory);
    need(current&&current.sha256===expectedIntentSha256,'RECOVERY_RESTORE_INTENT_CHANGED',409);
    need(current.canRetire,'RECOVERY_RESTORE_OWNER_NOT_STOPPED',409);
    // A directory already published by restore is retained and verified, never deleted.
    if(current.destinationPresent)await ensureStopped(await show(directory));
    if(current.stagePresent){await privateDirectory(current.stage);await rm(current.stage,{recursive:true});}
    if(current.lock)await unlink(pilotLockPath(directory));
    await syncDirectory(dirname(directory));
    await unlink(restoreIntentPath(directory));
    await syncDirectory(dirname(directory));
    return {retired:true,stageRemoved:current.stagePresent,publishedCasePreserved:current.destinationPresent,
      originalAttemptPreserved:true};
  });
}
export async function restoreRecovery(filename,passphrase,{expectedDirectory,allowedRoot=null}={}) {
  const inspected=await inspectRecovery(filename,passphrase), directory=absolutePath(inspected.manifest.originalDirectory);
  need(expectedDirectory===directory,'RECOVERY_EXACT_ORIGINAL_DIRECTORY_REQUIRED');
  if(allowedRoot)need(within(absolutePath(allowedRoot),directory) && directory!==absolutePath(allowedRoot),
    'RECOVERY_USE_TRUSTED_TERMINAL_FOR_EXTERNAL_PATH');
  await privateDirectory(dirname(directory));
  return withPilotLock(directory,'RESTORE',async(owner)=>{
    need(!await inspectRestoreOperation(directory),'RECOVERY_RESTORE_STAGING_RECONCILIATION_REQUIRED',409);
    try{await lstat(directory);fail('RECOVERY_DESTINATION_ALREADY_EXISTS',409);}
    catch(error){if(error.code!=='ENOENT')throw error;}
    const id=randomUUID(),stage=join(dirname(directory),'.sf96-restore-'+hashBytes(directory)+'-'+id);
    const intentPath=restoreIntentPath(directory);
    let intent={schema:'scf.sf96.restore-operation.v1',id,directory,stage,phase:'STAGING',createdAt:now(),
      treeSha256:inspected.manifest.treeSha256,owner,ownerSha256:hashBytes(encodeJSON(owner))};
    // Publish the exact staging ownership before creating any plaintext.
    await writeNew(intentPath,encodeJSON(intent));
    let published=false,stageCreated=false;
    try {
      await mkdir(stage,{mode:0o700});stageCreated=true;
      await consume(filename,passphrase,{
        manifest:async value=>need(identity(value)===identity(inspected.manifest),'RECOVERY_ARCHIVE_CHANGED'),
        entry:async entry=>{
          const target=join(stage,entry.path);need(within(stage,target),'RECOVERY_RECORD_INVALID');
          await privateDirectory(dirname(target));
          if(entry.type==='directory'){await mkdir(target,{mode:0o700});return null;}
          return open(target,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
        },
        finishedEntry:entry=>chmod(join(stage,entry.path),entry.mode),
      });
      const manifest=await readJSON(join(stage,'pilot.json'));
      need(manifest.directory===directory && manifest.intentId===inspected.manifest.intentId,
        'RECOVERY_NATIVE_CASE_MISMATCH');
      try{await lstat(directory);fail('RECOVERY_DESTINATION_ALREADY_EXISTS',409);}
      catch(error){if(error.code!=='ENOENT')throw error;}
      await rename(stage,directory); published=true; await syncDirectory(dirname(directory));
      let native;
      try {
        native=await show(directory);
        need(native.intentId===inspected.manifest.intentId &&
          native.source.captureSha256===inspected.manifest.captureSha256 &&
          native.buyer.configSha256===inspected.manifest.queueConfigSha256,'RECOVERY_NATIVE_CASE_MISMATCH');
        need(identity(await tree(directory))===inspected.manifest.treeSha256,'RECOVERY_RESTORED_TREE_CHANGED');
      } catch(error) {
        await rename(directory,stage); published=false; throw error;
      }
      await unlink(intentPath);await syncDirectory(dirname(directory));
      return {directory,manifest:inspected.manifest,native,restoredAt:now(),
        files:inspected.entries.length,totalBytes:inspected.manifest.totalBytes};
    } catch(error) {
      if(!published) {
        try {
          if(stageCreated)await rm(stage,{recursive:true,force:true});
          await unlink(intentPath);await syncDirectory(dirname(directory));
        } catch(cleanup) {
          intent={...intent,phase:'FAILED',finishedAt:now()};
          await replaceJSON(intentPath,intent).catch(()=>{});
          error.cleanupCode=cleanup.code;
        }
      }
      throw error;
    }
  });
}
