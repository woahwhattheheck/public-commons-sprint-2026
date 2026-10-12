// MIT. Complete original agent responses and input files; business records stay in Study.
import { constants } from 'node:fs';
import { open, readdir, link, unlink, chmod } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { RetainedFileReads } from '../../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import { STUDY_MAX_PACKET_BYTES, STUDY_MAX_JSON_BYTES, STUDY_CHUNK_BYTES as CHUNK, plain, need, exact,
  hash, decode, json, text, sha, integer, identifier, privateDirectory, fileHandle, fileIdentity,
  readFile, immutable, syncDirectory } from './agent-local.mjs';

const SNAPSHOT = 'stellar-forge.study-agent-snapshot.v1', TRANSFER = 'stellar-forge.study-agent-input.v1';
const PAGE_BYTES = 48000;
const snapshotId = value => { need(typeof value === 'string' && /^snapshot-[a-f0-9-]{36}$/.test(value),
  'STUDY_SNAPSHOT_INVALID','Select the retained native response ID.'); return value; };
const transferId = value => { need(typeof value === 'string' && /^input-[a-f0-9]{64}$/.test(value),
  'STUDY_TRANSFER_INVALID','Select the retained input transfer ID.'); return value; };
function filename(value) {
  text(value,240);
  need(Buffer.byteLength(value) <= 240 && !/[\/\\\x00-\x1f\x7f]/.test(value) && !['.','..'].includes(value), 'STUDY_FILENAME_INVALID',
    'Use an original filename without directory components.'); return value;
}
const escape = value => value.replace(/~/g,'~0').replace(/\//g,'~1');
function selectedValue(value, pointer = '') {
  need(typeof pointer === 'string' && pointer.length <= 4000 && (!pointer || pointer.startsWith('/')),
    'STUDY_POINTER_INVALID','Use an original JSON pointer.');
  for (const part of pointer ? pointer.slice(1).split('/') : []) {
    need(!/~(?![01])/u.test(part), 'STUDY_POINTER_INVALID','Use valid JSON pointer escapes.');
    const key = part.replace(/~1/g,'/').replace(/~0/g,'~');
    if (Array.isArray(value)) need(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length,
      'STUDY_POINTER_NOT_FOUND','Select an original array index.');
    need(value !== null && typeof value === 'object' && Object.hasOwn(value,key),
      'STUDY_POINTER_NOT_FOUND','The selected pointer is absent from this exact response.');
    value = value[key];
  }
  return value;
}
export function present(value, base = '') {
  let budget = 16000, extraArrays = 0; const arrays = [];
  const visit = (item, pointer, depth) => {
    if (Array.isArray(item)) {
      if (arrays.length < 200) arrays.push({pointer,count:item.length}); else extraArrays++;
      return {$originalArray:pointer,count:item.length};
    }
    if (!plain(item)) {
      const size = Buffer.byteLength(JSON.stringify(item));
      if (size <= budget) {budget -= size; return item;}
      return {$originalValue:pointer,bytes:size,type:typeof item};
    }
    const reference = () => ({$originalValue:pointer,type:'object',availableKeys:Object.keys(item).slice(0,40),
      additionalKeys:Math.max(0,Object.keys(item).length-40)});
    if (depth >= 8 || budget <= 0) return reference();
    const result = {};
    for (const [key,child] of Object.entries(item)) {
      if (budget <= 0) return reference();
      budget -= Buffer.byteLength(key) + 8;
      Object.defineProperty(result,key,{enumerable:true,value:visit(child,pointer+'/'+escape(key),depth+1)});
    }
    return result;
  };
  return {value:visit(value,base,0),arrays,...(extraArrays ? {additionalArrayPointers:extraArrays} : {})};
}

export class StudyAgentFiles {
  #base; #bindings; #readers = new RetainedFileReads({errorPrefix:'STUDY'}); #tails = new Map();
  constructor(base, bindings) { this.#base = base; this.#bindings = bindings; }
  get summary() { return this.#readers.summary; }
  async root(alias) {
    identifier(alias); need(this.#bindings[alias], 'STUDY_WORKSPACE_NOT_CONFIGURED','Choose a configured original workspace.');
    const root = await privateDirectory(join(this.#base,'study-workspaces'),true);
    return privateDirectory(join(root,alias),true);
  }
  async temporary(alias) {
    return join(await this.root(alias),'.native-download-'+randomUUID());
  }
  async #retainedPath(alias, digest, name) {
    const files = await privateDirectory(join(await this.root(alias),'files'),true);
    const group = await privateDirectory(join(files,sha(digest)),true);
    return join(group,filename(name));
  }
  async retain(alias, original, request) {
    const id = 'snapshot-'+randomUUID(), name = filename(original.filename ?? 'original-response.json');
    const metadata = {schema:SNAPSHOT,id,workspace:alias,createdAt:new Date().toISOString(),request,
      source:original.source,nativeStatus:original.status,
      file:{name,bytes:original.byteCount,sha256:sha(original.sha256),mediaType:original.mediaType}};
    try {
      const target = await this.#retainedPath(alias,metadata.file.sha256,name);
      if (original.file) {
        try {await link(original.file,target);}
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          const current = await fileIdentity(target,STUDY_MAX_PACKET_BYTES,true);
          need(current.bytes === metadata.file.bytes && current.sha256 === metadata.file.sha256,
            'STUDY_RETAINED_CONFLICT','The retained native file has another identity.');
        }
        await syncDirectory(join(await this.root(alias),'files',metadata.file.sha256));
        await unlink(original.file);
      } else await immutable(target,original.bytes);
      const snapshots = await privateDirectory(join(await this.root(alias),'snapshots'),true);
      await immutable(join(snapshots,id+'.json'),json(metadata));
    } catch (error) {
      if (original.file) await unlink(original.file).catch(() => {});
      // The native HTTP result is already known. Local storage failure does not replay it.
      return {...metadata,id:null,retention:{state:'FAILED',code:error.code ?? 'STUDY_RETENTION_FAILED',
        recovery:'Inspect the known native result in the original workspace. Restore storage, then repeat its read or download to retain it.'},
        ...(original.value === undefined ? {} : present(original.value))};
    }
    return {...metadata,retention:{state:'COMPLETE'},...(original.value === undefined ? {} : present(original.value)),
      fileRead:{tool:'merchant_study_file_read',workspace:alias,snapshotId:id,expectedSha256:metadata.file.sha256}};
  }
  async snapshot(alias, id, expected) {
    const root = await this.root(alias);
    const metadata = decode(await readFile(join(root,'snapshots',snapshotId(id)+'.json'),131072,true));
    need(metadata.schema === SNAPSHOT && metadata.workspace === alias && metadata.id === id &&
      metadata.file?.sha256 === sha(expected), 'STUDY_SNAPSHOT_CONFLICT','Use the original alias, snapshot ID and complete hash together.');
    const path = await this.#retainedPath(alias,metadata.file.sha256,metadata.file.name);
    return {metadata,path,root};
  }
  async #jsonSnapshot(alias, args) {
    const selected = await this.snapshot(alias,args.snapshotId,args.expectedSha256);
    need(/^application\/json\b/i.test(selected.metadata.file.mediaType),'STUDY_JSON_REQUIRED',
      'Select a retained native JSON response.');
    const bytes = await readFile(selected.path,STUDY_MAX_JSON_BYTES,true);
    need(bytes.length === selected.metadata.file.bytes && hash(bytes) === args.expectedSha256,
      'STUDY_SNAPSHOT_CHANGED','The complete original response changed.');
    return {...selected,value:selectedValue(decode(bytes),args.pointer ?? '')};
  }
  async view(alias, args) {
    const selected = await this.#jsonSnapshot(alias,args);
    return {...selected.metadata,pointer:args.pointer ?? '',...present(selected.value,args.pointer ?? '')};
  }
  async rows(alias, args) {
    const {metadata,value} = await this.#jsonSnapshot(alias,args);
    need(Array.isArray(value),'STUDY_ARRAY_REQUIRED','Select an original array pointer.');
    const offset = integer(args.offset ?? 0,value.length), limit = integer(args.limit ?? 50,200,1);
    const rows = []; let bytes = 0, next = offset;
    while (next < value.length && rows.length < limit) {
      const size = Buffer.byteLength(JSON.stringify(value[next]));
      if (bytes+size > PAGE_BYTES) break;
      rows.push(value[next++]); bytes += size;
    }
    return {workspace:alias,snapshotId:metadata.id,sha256:metadata.file.sha256,pointer:args.pointer,
      offset,count:value.length,rows,nextOffset:next < value.length ? next : null,
      ...(next === offset && next < value.length ? {largeRow:{index:next,pointer:args.pointer+'/'+next,
        bytes:Buffer.byteLength(JSON.stringify(value[next])),recovery:'Select nested snapshot values or read the complete original response bytes.'}} : {})};
  }
  read(alias, args) {
    return this.#readers.read({scope:alias+':'+snapshotId(args.snapshotId),key:args.snapshotId,kind:'STUDY_ORIGINAL',
      directory:this.#base,readId:args.readId,expectedSha256:sha(args.expectedSha256),
      offset:integer(args.offset ?? 0,STUDY_MAX_PACKET_BYTES),limit:integer(args.limit ?? CHUNK,CHUNK,1),
      load:async () => {
        const selected = await this.snapshot(alias,args.snapshotId,args.expectedSha256);
        const original = await fileHandle(selected.path,STUDY_MAX_PACKET_BYTES,true);
        try {
          need(original.bytes === selected.metadata.file.bytes,'STUDY_SNAPSHOT_CHANGED','The original response length changed.');
          return {readonlyFileHandle:original.handle,bytes:original.bytes,sha256:args.expectedSha256,
            name:selected.metadata.file.name,type:selected.metadata.file.mediaType};
        } catch (error) {await original.handle.close(); throw error;}
      }});
  }
  release(alias, args) {return this.#readers.release(alias+':'+snapshotId(args.snapshotId),args.readId);}
  async input(alias, selection, expected, maximum = STUDY_MAX_PACKET_BYTES) {
    exact(selection,['hostInput','snapshotId','transferId','sourceWorkspace']);
    need(['hostInput','snapshotId','transferId'].filter(key => selection[key] !== undefined).length === 1,
      'STUDY_INPUT_REQUIRED','Choose one original host file, retained native snapshot or completed input.');
    const scope = selection.sourceWorkspace ?? alias, binding = this.#bindings[identifier(scope)];
    need(binding,'STUDY_WORKSPACE_NOT_CONFIGURED','Choose a configured original source workspace.');
    let path, name, declared;
    if (selection.hostInput !== undefined) {
      const file = binding.inputs[identifier(selection.hostInput)];
      need(file,'STUDY_INPUT_NOT_CONFIGURED','Choose an original host input alias.');
      path = file.file; name = basename(path); declared = file.sha256;
    } else if (selection.snapshotId !== undefined) {
      const selected = await this.snapshot(scope,selection.snapshotId,expected);
      path = selected.path; name = selected.metadata.file.name; declared = selected.metadata.file.sha256;
    } else {
      const selected = await this.#transfer(scope,selection.transferId), complete = await this.#completed(selected);
      need(complete,'STUDY_INPUT_INCOMPLETE','Verify the complete input before native receiving.');
      path = join(selected.root,'payload-'+selected.manifest.filename); name = selected.manifest.filename; declared = complete.sha256;
    }
    const identity = await fileIdentity(path,maximum,selection.hostInput === undefined);
    need(identity.sha256 === sha(expected) && (!declared || identity.sha256 === declared),
      'STUDY_INPUT_CHANGED','The original input differs from its selected complete SHA256.');
    return {path,name,...identity};
  }
  async #serial(alias,id,action) {
    const key = alias+':'+id, previous = this.#tails.get(key) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(action); this.#tails.set(key,current);
    try {return await current;} finally {if(this.#tails.get(key) === current) this.#tails.delete(key);}
  }
  async #transfer(alias,id) {
    const root = join(await this.root(alias),'inputs',transferId(id));
    const manifest = decode(await readFile(join(root,'manifest.json'),131072,true));
    need(manifest.schema === TRANSFER && manifest.id === id && manifest.workspace === alias,
      'STUDY_TRANSFER_CONFLICT','Keep the original input and workspace together.');
    filename(manifest.filename);sha(manifest.sha256);integer(manifest.bytes,STUDY_MAX_PACKET_BYTES);
    return {root,manifest};
  }
  async #completed(transfer) {
    try {
      const value = decode(await readFile(join(transfer.root,'complete.json'),32768,true));
      need(value.sha256 === transfer.manifest.sha256 && value.bytes === transfer.manifest.bytes &&
        value.name === transfer.manifest.filename,'STUDY_TRANSFER_CONFLICT','The completed file differs from its original declaration.');
      return value;
    } catch(error) {if(error.code === 'ENOENT') return null;throw error;}
  }
  async #status(transfer,args={}) {
    const complete = await this.#completed(transfer), {manifest,root} = transfer;
    if(complete) return {transferId:manifest.id,state:'COMPLETE',file:complete,missingOffsets:[],nextOffset:null,chunkBytes:CHUNK};
    const names = new Set(await readdir(root)), missing = [];
    for(let offset=0;offset<manifest.bytes;offset+=CHUNK) if(!names.has('part-'+offset+'.json')) missing.push(offset);
    const offset = integer(args.offset ?? 0,manifest.bytes), limit = integer(args.limit ?? 100,200,1);
    const selected = missing.filter(value => value >= offset).slice(0,limit);
    const remaining = missing.filter(value => value >= offset).length;
    return {transferId:manifest.id,state:missing.length?'RECEIVING':'READY_TO_COMMIT',
      file:{name:manifest.filename,bytes:manifest.bytes,sha256:manifest.sha256,mediaType:manifest.mediaType},
      totalParts:Math.ceil(manifest.bytes/CHUNK),receivedParts:Math.ceil(manifest.bytes/CHUNK)-missing.length,
      missingParts:missing.length,missingOffsets:selected,nextOffset:remaining>selected.length?selected.at(-1)+CHUNK:null,chunkBytes:CHUNK};
  }
  async begin(alias,args) {
    filename(args.filename);sha(args.sha256);integer(args.bytes,STUDY_MAX_PACKET_BYTES);text(args.transferKey,180);
    const id = 'input-'+hash(Buffer.from(alias+'\0'+args.transferKey));
    return this.#serial(alias,id,async () => {
      const parent = await privateDirectory(join(await this.root(alias),'inputs'),true);
      const root = await privateDirectory(join(parent,id),true);
      const manifest = {schema:TRANSFER,id,workspace:alias,transferKey:args.transferKey,filename:args.filename,
        bytes:args.bytes,sha256:args.sha256,mediaType:args.mediaType ?? 'application/octet-stream',chunkBytes:CHUNK};
      await immutable(join(root,'manifest.json'),json(manifest));
      try {
        const handle = await open(join(root,'payload-'+manifest.filename),'wx',0o600);
        try {await handle.truncate(manifest.bytes);await handle.sync();} finally {await handle.close();}
      } catch(error) {if(error.code !== 'EEXIST') throw error;}
      const original = await fileHandle(join(root,'payload-'+manifest.filename),STUDY_MAX_PACKET_BYTES,true);
      const currentBytes = original.bytes; await original.handle.close();
      if (currentBytes !== manifest.bytes) {
        const names = await readdir(root);
        need(!names.includes('complete.json') && !names.some(name => /^part-[0-9]+[.]json$/.test(name)),
          'STUDY_TRANSFER_CONFLICT','A received payload has another declared length.');
        const repair = await open(join(root,'payload-'+manifest.filename),constants.O_RDWR | constants.O_NOFOLLOW);
        try {await repair.truncate(manifest.bytes);await repair.sync();} finally {await repair.close();}
      }
      return this.#status({root,manifest});
    });
  }
  status(alias,args) {return this.#serial(alias,args.transferId,async()=>this.#status(await this.#transfer(alias,args.transferId),args));}
  chunk(alias,args) {
    return this.#serial(alias,args.transferId,async()=>{
      const transfer = await this.#transfer(alias,args.transferId),{manifest,root}=transfer;
      const offset = integer(args.offset,manifest.bytes),count=Math.min(CHUNK,manifest.bytes-offset);
      need(offset%CHUNK===0 && count>0 && typeof args.data==='string' &&
        args.data.length<=Math.ceil(CHUNK/3)*4 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(args.data),
      'STUDY_PART_INVALID','Use one exact fixed-offset canonical base64 part.');
      const bytes=Buffer.from(args.data,'base64');
      need(bytes.length===count && bytes.toString('base64')===args.data,'STUDY_PART_INVALID','The part has another original length.');
      const marker=join(root,'part-'+offset+'.json'),expected={offset,bytes:count,sha256:hash(bytes)};
      let received=false;
      try {
        const prior=decode(await readFile(marker,32768,true));
        need(JSON.stringify(prior)===JSON.stringify(expected),'STUDY_PART_CONFLICT','This original offset already contains another part.');
        received=true;
      } catch(error) {if(error.code!=='ENOENT') throw error;}
      const complete=await this.#completed(transfer);
      const handle=await open(join(root,'payload-'+manifest.filename),(received||complete?constants.O_RDONLY:constants.O_RDWR)|constants.O_NOFOLLOW);
      try {
        const info=await handle.stat();
        need(info.isFile()&&info.nlink===1&&!(info.mode&0o077)&&info.size===manifest.bytes,
          'STUDY_TRANSFER_CHANGED','The retained input payload changed.');
        if(received||complete) {
          const original=Buffer.alloc(count);let read=0;
          while(read<count) {const part=await handle.read(original,read,count-read,offset+read);need(part.bytesRead>0,'STUDY_PART_CHANGED','The retained part ended early.');read+=part.bytesRead;}
          need(original.equals(bytes),'STUDY_PART_CHANGED','The retained part differs from its original bytes.');
        } else {
          let written=0;
          while(written<count) {const part=await handle.write(bytes,written,count-written,offset+written);need(part.bytesWritten>0,'STUDY_PART_WRITE_FAILED','The input part could not be retained.');written+=part.bytesWritten;}
          await handle.sync();
          await immutable(marker,json(expected));
        }
      } finally {await handle.close();}
      return {transferId:manifest.id,offset,bytes:count,nextOffset:offset+count<manifest.bytes?offset+count:null,
        state:complete?'COMPLETE':'PART_RETAINED'};
    });
  }
  commit(alias,args) {
    return this.#serial(alias,args.transferId,async()=>{
      const transfer=await this.#transfer(alias,args.transferId),status=await this.#status(transfer);
      const path=join(transfer.root,'payload-'+transfer.manifest.filename);
      if(status.state!=='COMPLETE') need(status.missingParts===0,'STUDY_INPUT_INCOMPLETE',
        'Receive the missing original offsets before complete-file verification.',{missingOffsets:status.missingOffsets});
      const identity=await fileIdentity(path,STUDY_MAX_PACKET_BYTES,true);
      need(identity.bytes===transfer.manifest.bytes&&identity.sha256===transfer.manifest.sha256,
        'STUDY_INPUT_CHANGED','The complete input differs from its original whole-file hash.');
      const complete={name:transfer.manifest.filename,...identity,mediaType:transfer.manifest.mediaType};
      await chmod(path,0o400);
      await immutable(join(transfer.root,'complete.json'),json(complete));
      return {transferId:transfer.manifest.id,state:'COMPLETE',file:complete,missingOffsets:[],nextOffset:null,chunkBytes:CHUNK};
    });
  }
  async close() {
    await Promise.allSettled([...this.#tails.values()]);
    await this.#readers.close();
  }
}
