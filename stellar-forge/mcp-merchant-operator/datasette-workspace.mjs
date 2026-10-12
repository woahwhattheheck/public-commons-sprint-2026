// MIT. Complete receiving over the original Datasette provider and its one native workspace.
import {constants} from 'node:fs';
import {open, mkdir, mkdtemp, unlink, rmdir, realpath, link} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {MerchantDatasetteWorkspaces as OriginalDatasetteWorkspaces} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/datasette/provider.mjs';
import {DatasetteClientError} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/datasette/client.mjs';
import {datasetteReceivingTools} from './catalog/datasette-workspace.mjs';
import {RetainedFileReads, MAX_RETAINED_CHUNK_BYTES} from './retained-file-reads.mjs';
import {exact, plain, failure, privateSupportDirectory, writePrivate} from './host-files.mjs';
import {DATASETTE_DOWNLOAD_MANIFEST, DATASETTE_NATIVE_MANIFEST, DATASETTE_MAX_FILE_BYTES,
  DATASETTE_MAX_MANIFEST_BYTES, datasetteRelativeFile, datasetteNativeFile, datasetteCanonical,
  createDatasetteDownloadManifest, validateDatasetteExportId} from './datasette-download-contract.mjs';

export {datasetteReceivingTools} from './catalog/datasette-workspace.mjs';
const PREFIX='merchant_datasette_', HASH=/^[a-f0-9]{64}$/;
const INVENTORY_SCHEMA='stellar-forge.datasette-native-inventory.v1';
const MAX_FILES=30000, CACHE_BYTES=32*1024*1024;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const jsonBytes=value=>Buffer.from(datasetteCanonical(value)+'\n');
const error=(code,message)=>failure('DATASETTE_'+code,message);
const definitions=new Map(datasetteReceivingTools((name,description,properties,required)=>
  ({name,properties,required})).map(item=>[item.name,item]));
function hash(value) {if(typeof value!=='string'||!HASH.test(value)) throw error('FILE_IDENTITY_REQUIRED','Use the reviewed complete SHA-256.');return value;}
function count(value,maximum=Number.MAX_SAFE_INTEGER,minimum=0) {
  if(!Number.isSafeInteger(value)||value<minimum||value>maximum) throw error('FILE_RANGE_INVALID','Use an integer within the original declared range.');
  return value;
}
function workspaceIdentity(value) {
  if(typeof value!=='string'||!value||value.length>256||/[\u0000-\u001f\u007f]/.test(value))
    throw error('WORKSPACE_ID_REQUIRED','Use the persistent native workspace ID.');
  return value;
}
function prefix(value='') {
  if(typeof value!=='string'||value.length>4096||value.startsWith('/')||/[\\:\u0000-\u001f\u007f]/.test(value)||
      value.split('/').some(part=>part==='.'||part==='..'))
    throw error('FILE_PATH_INVALID','Choose an original relative file prefix.');
  return value;
}
function sameNative(left,right) {
  return left.workspaceId===right.workspaceId&&left.path===right.path&&left.bytes===right.bytes&&left.sha256===right.sha256;
}
function nativeFiles(inventory) {
  if(!plain(inventory)||inventory.schema!==INVENTORY_SCHEMA||!Array.isArray(inventory.pages)||
      !inventory.pages.length||inventory.pages.length>MAX_FILES)
    throw error('INVENTORY_INVALID','Read the complete saved native inventory.');
  workspaceIdentity(inventory.workspaceId);prefix(inventory.prefix);
  const files=[],names=new Set();let expectedOffset=0,total;
  for(let index=0;index<inventory.pages.length;index++) {
    const result=inventory.pages[index];
    if(!plain(result)||result.workspaceId!==inventory.workspaceId||!Array.isArray(result.files)||!plain(result.page))
      throw error('INVENTORY_INVALID','Every page must retain its original workspace, files and pagination.');
    const page=result.page;
    count(page.offset,MAX_FILES);count(page.limit,250,1);count(page.total,MAX_FILES);
    if(page.offset!==expectedOffset||result.files.length>page.limit||total!==undefined&&total!==page.total)
      throw error('INVENTORY_CHANGED','The original complete native file inventory changed between pages.');
    total=page.total;
    for(const value of result.files) {
      datasetteNativeFile(value,inventory.workspaceId);
      if(names.has(value.path)||!value.path.startsWith(inventory.prefix))
        throw error('INVENTORY_INVALID','Original file paths must be unique and belong to the selected native prefix.');
      names.add(value.path);files.push(value);
    }
    expectedOffset+=result.files.length;
    const next=expectedOffset<total?expectedOffset:null;
    if(page.next!==next||next!==null&&!result.files.length||
       index<inventory.pages.length-1&&next===null||index===inventory.pages.length-1&&next!==null)
      throw error('INVENTORY_INCOMPLETE','Receive every original inventory page through the terminal native cursor.');
  }
  if(files.length!==total) throw error('INVENTORY_INCOMPLETE','The declared full native inventory has not been received.');
  return files;
}
function nativeUpload(value,workspaceId,input) {
  const decimal=value=>typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value)&&
    Number.isSafeInteger(Number(value))&&Number(value)<=DATASETTE_MAX_FILE_BYTES;
  if(!plain(value)||value.schema!=='stellar-forge.datasette-upload.v1'||value.workspaceId!==workspaceId||
      value.uploadId!==input.uploadId||!['RECEIVING','FINALIZABLE','COMPLETE','REJECTED'].includes(value.state)||
      !['bytes','receivedBytes','uncheckpointedBytes'].every(key=>decimal(value[key]))||
      Number(value.receivedBytes)>Number(value.bytes)||!HASH.test(value.sha256??'')||
      !HASH.test(value.prefixSha256??'')||typeof value.name!=='string')
    throw error('UPLOAD_REPLY_INVALID','The native upload reply must retain its complete original file and prefix identity.');
  for(const field of ['name','bytes','sha256'])if(input[field]!==undefined&&value[field]!==input[field])
    throw error('UPLOAD_REPLY_CHANGED','The native upload belongs to another original file declaration.');
  if(value.state==='COMPLETE') {
    const file=datasetteNativeFile(value.retainedFile,workspaceId);
    if(value.receivedBytes!==value.bytes||value.prefixSha256!==value.sha256||
        value.uncheckpointedBytes!=='0'||file.bytes!==value.bytes||file.sha256!==value.sha256||
        file.name!==value.name||typeof value.archiveFile!=='string'||!value.archiveFile)
      throw error('UPLOAD_REPLY_INVALID','A completed upload must name the original fully verified retained file.');
  }
  return value;
}
function retainedRecord(inventory,raw=jsonBytes(inventory)) {
  const files=nativeFiles(inventory),nativeSha=digest(raw);
  const selected=createDatasetteDownloadManifest({workspaceId:inventory.workspaceId,
    native:{operation:'files.list',prefix:inventory.prefix,files:files.length,manifestSha256:nativeSha},
    files:[{name:DATASETTE_NATIVE_MANIFEST,bytes:raw.length,sha256:nativeSha},
      ...files.map(file=>({name:'files/'+file.path,bytes:Number(file.bytes),sha256:file.sha256}))]});
  return {...selected,nativeRaw:raw,native:inventory,nativeFiles:files,
    manifestFile:{name:DATASETTE_DOWNLOAD_MANIFEST,bytes:selected.bytes.length,sha256:selected.sha256}};
}
async function privateBytes(path,maximum) {
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const before=await handle.stat({bigint:true});
    if(!before.isFile()||(before.mode&0o077n)!==0n||before.size>BigInt(maximum))
      throw error('PRIVATE_FILE_REQUIRED','Use the original bounded private receiving record.');
    const raw=await handle.readFile(),after=await handle.stat({bigint:true});
    if(raw.length>maximum||before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||
        before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs)
      throw error('RECEIVING_RECORD_CHANGED','The saved receiving record changed while it was read.');
    return raw;
  } finally {await handle.close();}
}
async function syncDirectory(directory) {
  const handle=await open(directory,constants.O_RDONLY);
  try {await handle.sync();} finally {await handle.close();}
}
async function publishRecord(directory,name,bytes) {
  const path=join(directory,name),temporary=join(directory,'.receiving-'+randomUUID()+'.tmp');
  await writePrivate(temporary,bytes);
  try {
    try {await link(temporary,path);}
    catch(issue) {
      if(issue.code!=='EEXIST')throw issue;
      const previous=await privateBytes(path,DATASETTE_MAX_MANIFEST_BYTES);
      if(!previous.equals(bytes))throw error('RECEIVING_RECORD_CHANGED','The original receiving identity already has different saved bytes.');
    }
    await syncDirectory(directory);
  } finally {await unlink(temporary).catch(issue=>{if(issue.code!=='ENOENT')throw issue;});}
  return path;
}

/** A pure attachment to the original source owner. No source, publisher or Analysis lease is opened here. */
export class MerchantDatasetteWorkspaces extends OriginalDatasetteWorkspaces {
  #config;#reads;#closing=false;#closePromise;#cache=new Map();#cacheBytes=0;#temporaries=new Set();#storageBindings=new Set();
  constructor(config,options={}) {
    super(config,options);this.#config=config;
    this.#reads=new RetainedFileReads({errorPrefix:'DATASETTE',maxImmutableFileBytes:DATASETTE_MAX_FILE_BYTES,
      maxSnapshotBytes:2*DATASETTE_MAX_MANIFEST_BYTES});
  }
  get summary(){return {...super.summary,receiving:{closing:this.#closing,retainedReads:this.#reads.summary}};}
  async #checkStorageLocation(client,health) {
    const key=client.origin+':'+health.workspaceId;
    if(this.#storageBindings.has(key))return;
    const url=new URL(client.origin);
    if(['127.0.0.1','localhost','[::1]'].includes(url.hostname)) {
      const native=await client.status();
      if(native?.workspaceId!==health.workspaceId||typeof native.directory!=='string')
        throw error('WORKSPACE_CHANGED','Read the original native workspace location and identity before receiving.');
      const target=resolve(this.#config.exportsDirectory??''),source=resolve(native.directory);
      if(target===source||target.startsWith(source+'/'))
        throw error('RECEIVING_DIRECTORY_OVERLAP','Keep merchant receiving storage outside its original source workspace.');
    }
    this.#storageBindings.add(key);
  }
  async #storage(workspaceId) {
    if(typeof this.#config.exportsDirectory!=='string'||!this.#config.exportsDirectory)
      throw error('RECEIVING_NOT_CONFIGURED','Configure the original merchant private exports directory.');
    const root=resolve(this.#config.exportsDirectory);
    await privateSupportDirectory(root);
    if(await realpath(root)!==root)throw error('PRIVATE_DIRECTORY_REQUIRED','Use the original canonical private exports directory.');
    let path=root;
    for(const part of ['datasette-receiving',digest(Buffer.from(workspaceIdentity(workspaceId)))]) {
      path=join(path,part);await mkdir(path,{mode:0o700}).catch(issue=>{if(issue.code!=='EEXIST')throw issue;});
      await privateSupportDirectory(path);
    }
    return path;
  }
  #scope(alias,workspaceId){return alias+':'+workspaceId;}
  #remember(value) {
    const key=value.manifest.workspaceId+':'+value.manifest.exportId,size=value.bytes.length+value.nativeRaw.length;
    if(this.#cache.has(key))return value;
    if(size<=CACHE_BYTES) {
      while(this.#cache.size&&(this.#cache.size>=4||this.#cacheBytes+size>CACHE_BYTES)) {
        const [old,entry]=this.#cache.entries().next().value;this.#cache.delete(old);this.#cacheBytes-=entry.size;
      }
      this.#cache.set(key,{value,size});this.#cacheBytes+=size;
    }
    return value;
  }
  async #record(workspaceId,exportId) {
    validateDatasetteExportId(exportId);const key=workspaceId+':'+exportId;
    const cached=this.#cache.get(key);if(cached)return cached.value;
    const raw=await privateBytes(join(await this.#storage(workspaceId),exportId+'.json'),DATASETTE_MAX_MANIFEST_BYTES);
    let inventory;try{inventory=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
    catch{throw error('RECEIVING_RECORD_INVALID','Read the complete original UTF-8 receiving record.');}
    if(inventory.workspaceId!==workspaceId||!jsonBytes(inventory).equals(raw))
      throw error('RECEIVING_RECORD_CHANGED','The original saved inventory or persistent workspace binding changed.');
    const selected=retainedRecord(inventory,raw);
    if(selected.manifest.exportId!==exportId)throw error('RECEIVING_RECORD_CHANGED','The saved inventory differs from this receiving export ID.');
    return this.#remember(selected);
  }
  async #inventory(client,workspaceId,selectedPrefix) {
    const pages=[];let offset=0;
    for(;;) {
      if(this.#closing)throw error('RECEIVING_CLOSING','Finish closing this receiving attachment.');
      const page=await client.dispatch('files.list',{prefix:selectedPrefix,offset,limit:250});
      pages.push(page);
      if(pages.length>MAX_FILES||page?.workspaceId!==workspaceId||!plain(page.page))
        throw error('INVENTORY_INVALID','The original native inventory has an invalid workspace or page.');
      if(page.page.next===null)break;
      if(!Number.isSafeInteger(page.page.next)||page.page.next<=offset||page.page.next>MAX_FILES)
        throw error('INVENTORY_INCOMPLETE','The original native inventory did not advance its cursor.');
      offset=page.page.next;
    }
    const inventory={schema:INVENTORY_SCHEMA,workspaceId,prefix:selectedPrefix,pages};
    nativeFiles(inventory);
    if(jsonBytes(inventory).length>DATASETTE_MAX_MANIFEST_BYTES)
      throw error('INVENTORY_LIMIT','The complete receiving inventory exceeds its original 64 MiB manifest limit.');
    return inventory;
  }
  async #prepare(client,health,args) {
    if(workspaceIdentity(args.workspaceId)!==health.workspaceId)
      throw error('WORKSPACE_CHANGED','Prepare receiving for the original persistent workspace identity.');
    const selectedPrefix=prefix(args.prefix),first=await this.#inventory(client,health.workspaceId,selectedPrefix);
    const second=await this.#inventory(client,health.workspaceId,selectedPrefix);
    if(datasetteCanonical(first)!==datasetteCanonical(second))
      throw error('INVENTORY_CHANGED','The native file inventory changed. Inspect the original owner before preparing another receiving snapshot.');
    const selected=retainedRecord(first),directory=await this.#storage(health.workspaceId);
    try {await publishRecord(directory,selected.manifest.exportId+'.json',selected.nativeRaw);}
    catch(issue){issue.details={workspaceId:health.workspaceId,exportId:selected.manifest.exportId,manifestSha256:selected.sha256};throw issue;}
    this.#remember(selected);
    return {state:'MANIFEST_RETAINED',workspace:args.workspace,workspaceId:health.workspaceId,
      exportId:selected.manifest.exportId,manifestFile:selected.manifestFile,
      originalFiles:selected.nativeFiles.length,totalBytes:selected.manifest.totalBytes,
      native:selected.manifest.native};
  }
  async #cleanup(item) {
    const issues=[];
    for(const field of ['writer','reader'])if(item[field])try{await item[field].close();item[field]=null;}catch(issue){issues.push(issue);}
    if(item.path)try{await unlink(item.path);item.path=null;}catch(issue){if(issue.code==='ENOENT')item.path=null;else issues.push(issue);}
    if(item.directory)try{await rmdir(item.directory);item.directory=null;}catch(issue){if(issue.code==='ENOENT')item.directory=null;else issues.push(issue);}
    if(!item.writer&&!item.reader&&!item.path&&!item.directory)this.#temporaries.delete(item);
    if(issues.length)throw new AggregateError(issues,'The original temporary receiving resources did not all close.');
  }
  async #nativeHandle(client,workspaceId,selected) {
    datasetteNativeFile(selected,workspaceId);
    const current=datasetteNativeFile(await client.dispatch('files.inspect',{path:selected.path,sha256:selected.sha256}),workspaceId);
    if(!sameNative(selected,current))throw error('FILE_CHANGED','The original file differs from the retained receiving identity.');
    const directory=await mkdtemp(join(await this.#storage(workspaceId),'.native-file-'));
    const item={directory,path:join(directory,'bytes'),writer:null,reader:null};this.#temporaries.add(item);
    try {
      item.writer=await open(item.path,'wx',0o600);
      const size=Number(selected.bytes),hashState=createHash('sha256');let position=0;
      do {
        if(this.#closing)throw error('RECEIVING_CLOSING','The receiving attachment is closing.');
        const result=await client.dispatch('files.read',{path:selected.path,sha256:selected.sha256,
          offset:String(position),limit:262144});
        datasetteNativeFile(result,workspaceId);
        if(!sameNative(selected,result)||result.offset!==String(position)||result.encoding!=='base64'||
            typeof result.length!=='string'||!/^(0|[1-9][0-9]*)$/.test(result.length)||typeof result.data!=='string'||
            result.data.length>349528)
          throw error('FILE_REPLY_INVALID','The original native file range differs from its exact selected identity.');
        const part=Buffer.from(result.data,'base64'),length=Number(result.length),next=position+length;
        if(part.toString('base64')!==result.data||part.length!==length||length>262144||next>size||
            length===0&&position!==size||result.complete!==(next===size)||result.nextOffset!==(next<size?String(next):null))
          throw error('FILE_REPLY_INVALID','The complete native range must match its original byte count, cursor and encoding.');
        let written=0;
        while(written<part.length) {
          const saved=await item.writer.write(part,written,part.length-written,position+written);
          if(!Number.isInteger(saved.bytesWritten)||saved.bytesWritten<1)throw error('RECEIVING_WRITE_FAILED','The native file range was not fully retained.');
          written+=saved.bytesWritten;
        }
        hashState.update(part);position=next;
      } while(position<size);
      if(position!==size||hashState.digest('hex')!==selected.sha256)
        throw error('FILE_CHANGED','The complete received bytes differ from the original native SHA-256.');
      const after=datasetteNativeFile(await client.dispatch('files.inspect',{path:selected.path,sha256:selected.sha256}),workspaceId);
      if(!sameNative(selected,after))throw error('FILE_CHANGED','The original native file changed while it was received.');
      await item.writer.sync();await item.writer.close();item.writer=null;
      item.reader=await open(item.path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
      const info=await item.reader.stat();
      if(!info.isFile()||info.size!==size||(info.mode&0o077)!==0)throw error('PRIVATE_FILE_REQUIRED','The original received file must remain private and complete.');
      await unlink(item.path);item.path=null;await rmdir(item.directory);item.directory=null;
      const handle=item.reader;item.reader=null;this.#temporaries.delete(item);
      return {readonlyFileHandle:handle,name:selected.name,bytes:size,sha256:selected.sha256,type:'application/octet-stream'};
    } catch(issue) {
      try{await this.#cleanup(item);}catch(cleanup){issue.cleanupError=cleanup;}
      throw issue;
    }
  }
  async #execute(short,args,{client,health}) {
    const workspaceId=workspaceIdentity(health.workspaceId),scope=this.#scope(args.workspace,workspaceId);
    if(!['reconnect','files','file','upload_status','upload_chunk'].includes(short))await this.#checkStorageLocation(client,health);
    if(short==='upload_status')
      return {workspace:args.workspace,native:nativeUpload(await client.uploadStatus({uploadId:args.uploadId}),workspaceId,args)};
    if(short==='upload_chunk') {
      if(typeof args.data!=='string'||args.data.length>11184812)
        throw error('UPLOAD_RANGE_INVALID','Supply canonical base64 for one original range of at most 8 MiB.');
      const raw=Buffer.from(args.data,'base64');
      if(raw.length>8*1024*1024||raw.toString('base64')!==args.data||String(raw.length)!==args.length)
        throw error('UPLOAD_RANGE_INVALID','The complete original chunk must match its declared byte count and canonical base64.');
      const input=Object.fromEntries(['uploadId','name','bytes','sha256','offset','length'].map(key=>[key,args[key]]));
      return {workspace:args.workspace,native:nativeUpload(await client.uploadChunk(input,raw),workspaceId,input)};
    }
    if(short==='reconnect') {
      if(workspaceIdentity(args.workspaceId)!==workspaceId)throw error('WORKSPACE_CHANGED','Reconnect the original persistent native workspace.');
      return {state:'CONNECTED',workspace:args.workspace,workspaceId,native:health,
        status:await client.status(),operations:await client.operations()};
    }
    if(short==='files') {
      const result=await client.dispatch('files.list',{prefix:prefix(args.prefix),offset:count(args.offset??0,MAX_FILES),limit:count(args.limit??100,250,1)});
      if(result?.workspaceId!==workspaceId||!Array.isArray(result.files))throw error('INVENTORY_INVALID','Read an original native inventory page.');
      for(const file of result.files)datasetteNativeFile(file,workspaceId);
      return {workspace:args.workspace,native:result};
    }
    if(short==='file') {
      datasetteRelativeFile(args.path);if(args.sha256!==undefined)hash(args.sha256);
      return {workspace:args.workspace,native:datasetteNativeFile(await client.dispatch('files.inspect',
        {path:args.path,...(args.sha256===undefined?{}:{sha256:args.sha256})}),workspaceId)};
    }
    if(short==='file_read') {
      datasetteRelativeFile(args.path);hash(args.expectedSha256);
      return this.#reads.read({scope,key:'native:'+args.path,kind:'DATASETTE_NATIVE',directory:await this.#storage(workspaceId),
        expectedSha256:args.expectedSha256,offset:count(args.offset??0,DATASETTE_MAX_FILE_BYTES),
        limit:count(args.limit??65536,MAX_RETAINED_CHUNK_BYTES,1),readId:args.readId,
        load:async()=>this.#nativeHandle(client,workspaceId,datasetteNativeFile(
          await client.dispatch('files.inspect',{path:args.path,sha256:args.expectedSha256}),workspaceId))});
    }
    if(short==='file_release'||short==='export_file_release') {
      if(short==='export_file_release')validateDatasetteExportId(args.exportId);
      await this.#reads.release(scope,args.readId);
      return {state:'RELEASED',workspace:args.workspace,readId:args.readId,
        ...(short==='export_file_release'?{exportId:args.exportId}:{})};
    }
    if(short==='export_prepare')return this.#prepare(client,health,args);
    const selected=await this.#record(workspaceId,args.exportId);
    if(short==='export_manifest')return {state:'MANIFEST_RETAINED',workspace:args.workspace,workspaceId,
      exportId:args.exportId,manifestFile:selected.manifestFile};
    if(short==='export_inventory') {
      const offset=count(args.offset??0,selected.manifest.files.length),limit=count(args.limit??100,250,1);
      return {workspace:args.workspace,workspaceId,exportId:args.exportId,manifestSha256:selected.sha256,
        native:selected.manifest.native,files:selected.manifest.files.slice(offset,offset+limit),
        page:{offset,limit,total:selected.manifest.files.length,
          next:offset+limit<selected.manifest.files.length?offset+limit:null}};
    }
    if(short==='export_file') {
      datasetteRelativeFile(args.file);hash(args.expectedSha256);
      if(hash(args.expectedManifestSha256)!==selected.sha256)throw error('FILE_CHANGED','Use this original receiving manifest SHA-256.');
      const file=args.file===DATASETTE_DOWNLOAD_MANIFEST?selected.manifestFile:selected.manifest.files.find(item=>item.name===args.file);
      if(!file||file.sha256!==args.expectedSha256)throw error('FILE_CHANGED','Select an exact original manifest member and file SHA-256.');
      const result=await this.#reads.read({scope,key:'export:'+args.exportId+':'+args.file,kind:'DATASETTE_EXPORT',
        directory:await this.#storage(workspaceId),expectedSha256:args.expectedSha256,
        offset:count(args.offset??0,file.bytes),limit:count(args.limit??65536,MAX_RETAINED_CHUNK_BYTES,1),readId:args.readId,
        load:async()=> {
          if(args.file===DATASETTE_DOWNLOAD_MANIFEST)return {name:DATASETTE_DOWNLOAD_MANIFEST,bytes:selected.bytes,type:'application/json'};
          if(args.file===DATASETTE_NATIVE_MANIFEST)return {name:DATASETTE_NATIVE_MANIFEST,bytes:selected.nativeRaw,type:'application/json'};
          const original=selected.nativeFiles.find(item=>'files/'+item.path===args.file);
          if(!original)throw error('FILE_CHANGED','This original native member is not in the retained manifest.');
          const native=await this.#nativeHandle(client,workspaceId,original);
          return {...native,name:file.name};
        }});
      return {exportId:args.exportId,manifestSha256:selected.sha256,...result};
    }
    throw error('TOOL_NOT_FOUND','Choose an original Datasette receiving action.');
  }
  async call(name,args={}) {
    if(this.#closing)throw error('RECEIVING_CLOSING','Finish closing this original receiving attachment.');
    try {
      const definition=definitions.get(name);
      if(!definition)return await super.call(name,args);
      exact(args,Object.keys(definition.properties),definition.required);
      const original=structuredClone(args);
      return await this.withWorkspace(original.workspace,bound=>this.#execute(name.slice(PREFIX.length),original,bound));
    } catch(issue) {
      // These are the original public native result and recovery identities.
      // The shared transport receives no Error enumeration, cause or credentials.
      if(issue instanceof DatasetteClientError)issue.details={
        status:issue.status,operation:issue.operation,operationId:issue.operationId,
        uncertain:issue.uncertain,result:issue.result,
      };
      throw issue;
    }
  }
  close() {
    if(this.#closePromise)return this.#closePromise;
    this.#closing=true;
    this.#closePromise=(async()=>{
      const issues=[];
      try{await super.close();}catch(issue){issues.push(issue);}
      try{await this.#reads.close();}catch(issue){issues.push(issue);}
      for(const item of [...this.#temporaries])try{await this.#cleanup(item);}catch(issue){issues.push(issue);}
      if(issues.length)throw new AggregateError(issues,'Datasette receiving resources did not all close; the original native owner remains separate.');
      this.#cache.clear();this.#cacheBytes=0;
    })().catch(issue=>{this.#closePromise=null;throw issue;});
    return this.#closePromise;
  }
}
