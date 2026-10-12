// MIT. Complete, streamed original workspace export and cold restoration.
import {constants,openSync,closeSync,writeFileSync,readFileSync,fsyncSync,lstatSync,fstatSync,
  mkdirSync,renameSync,unlinkSync,existsSync,readdirSync,rmdirSync,createReadStream,createWriteStream} from 'node:fs';
import {join,resolve,dirname,basename} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGzip,createGunzip} from 'node:zlib';
import {TextDecoder} from 'node:util';
import {spawnSync} from 'node:child_process';
import {openGridFabricSnapshot,openGridFabricStore,privateDirectory} from './sqlite-store.mjs';
import {createGridFabricFiles,sha256Utf8} from './files.mjs';

const SCHEMA='stellar-forge.gridfabric-portable.v2';
const LEGACY_SCHEMA='stellar-forge.gridfabric-portable.v1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA=/^[0-9a-f]{64}$/;
const MARKER='.gridfabric-restore.json';
const fail=(code,message,detail={})=>Object.assign(new Error(message),{code,...detail});
const assert=(condition,code,message)=>{if(!condition)throw fail(code,message);};
function syncDirectory(path){const fd=openSync(path,constants.O_RDONLY|constants.O_DIRECTORY);try{fsyncSync(fd);}finally{closeSync(fd);}}
function syncFile(path){const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}}
function jsonFile(path){
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const s=fstatSync(fd);assert(s.isFile()&&s.nlink===1,'GRIDFABRIC_METADATA_FILE','Keep the original regular metadata file.');return JSON.parse(readFileSync(fd,'utf8'));}
  finally{closeSync(fd);}
}
function atomicJson(path,value){
  const temporary=join(dirname(path),'.writing-'+randomUUID()),fd=openSync(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fsyncSync(fd);}finally{closeSync(fd);}
  try{renameSync(temporary,path);syncDirectory(dirname(path));}catch(error){try{unlinkSync(temporary);}catch{}throw error;}
}
export async function artifactIdentity(path){
  const absolute=resolve(path),fd=openSync(absolute,constants.O_RDONLY|constants.O_NOFOLLOW),before=fstatSync(fd);
  try{
    assert(before.isFile(),'GRIDFABRIC_ARTIFACT_FILE','Use a complete original regular file.');
    const hash=createHash('sha256');let bytes=0;
    for await(const chunk of createReadStream(absolute,{fd,autoClose:false})){hash.update(chunk);bytes+=chunk.length;}
    const after=fstatSync(fd),named=lstatSync(absolute);
    assert(before.dev===after.dev&&before.ino===after.ino&&before.size===bytes&&before.size===after.size&&
      before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs&&named.ino===before.ino&&named.dev===before.dev&&!named.isSymbolicLink(),
      'GRIDFABRIC_ARTIFACT_CHANGED','The selected complete artifact changed during reading.');
    return {path:absolute,name:basename(absolute),bytes,sha256:hash.digest('hex')};
  }finally{closeSync(fd);}
}
function snapshotDescription(snapshot){
  const recordsHash=createHash('sha256'),counts={},files=[];let workspace=null,records=0;
  for(const row of snapshot.records()){
    const line=JSON.stringify({kind:'record',...row})+'\n';recordsHash.update(line);records++;
    counts[row.table]=(counts[row.table]||0)+1;
    if(row.table==='meta'&&row.id==='workspace')workspace=row.data;
    if(row.table==='host_files'){
      assert(SHA.test(row.id)&&row.data.sha256===row.id&&Number.isSafeInteger(row.data.bytes)&&row.data.bytes>=0,
        'GRIDFABRIC_PORTABLE_FILE_METADATA','The original file catalogue contains an invalid identity.');
      files.push({sha256:row.id,bytes:row.data.bytes,name:row.data.name,mime_type:row.data.mime_type});
    }
  }
  assert(workspace?.schema==='stellar-forge.gridfabric-plaid.workspace.v1','GRIDFABRIC_PORTABLE_WORKSPACE','The original native snapshot has no compatible workspace.');
  files.sort((a,b)=>a.sha256.localeCompare(b.sha256));
  return {workspace,records,counts,files,records_sha256:recordsHash.digest('hex')};
}
export async function* readPortable(path,{expectedSha256,maximumDecodedBytes=4*1024*1024*1024,maximumLineBytes=512*1024*1024}={}){
  assert(Number.isSafeInteger(maximumDecodedBytes)&&maximumDecodedBytes>0&&Number.isSafeInteger(maximumLineBytes)&&maximumLineBytes>0,
    'GRIDFABRIC_PORTABLE_LIMIT','Select positive explicit portable receiving limits.');
  const compressedHash=createHash('sha256'),contentHash=createHash('sha256');
  let compressedBytes=0,decodedBytes=0,buffer='',header=null,footer=null,recordCount=0,fileCount=0;
  const input=createReadStream(path),tap=new Transform({transform(chunk,encoding,callback){compressedHash.update(chunk);compressedBytes+=chunk.length;callback(null,chunk);}});
  const unzip=createGunzip(),flow=pipeline(input,tap,unzip);flow.catch(()=>{});
  const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
  try{
    for await(const chunk of unzip){
      decodedBytes+=chunk.length;assert(decodedBytes<=maximumDecodedBytes,'GRIDFABRIC_PORTABLE_LIMIT','The decoded portable artifact exceeds the selected complete-receiving limit.');
      buffer+=decoder.decode(chunk,{stream:true});
      let newline;
      while((newline=buffer.indexOf('\n'))!==-1){
        const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);
        assert(Buffer.byteLength(line,'utf8')<=maximumLineBytes,'GRIDFABRIC_PORTABLE_LINE','A complete portable member exceeds the selected line allowance.');
        assert(!footer,'GRIDFABRIC_PORTABLE_TRAILING','The portable artifact contains data after its final digest.');
        const item=JSON.parse(line);
        assert(item&&typeof item==='object'&&!Array.isArray(item),'GRIDFABRIC_PORTABLE_MEMBER','Each portable member must be an object.');
        if(!header){
          assert(item.kind==='header'&&[SCHEMA,LEGACY_SCHEMA].includes(item.schema),'GRIDFABRIC_PORTABLE_SCHEMA','Use the original GridFabric portable format.');
          assert(typeof item.workspace_id==='string'&&Number.isSafeInteger(item.revision)&&Number.isSafeInteger(item.records)&&item.records>=1&&Array.isArray(item.files),
            'GRIDFABRIC_PORTABLE_HEADER','The original portable header is incomplete.');
          header=item;
        }else if(item.kind==='footer'){
          const actual=contentHash.digest('hex');
          assert(item.sha256===actual&&item.records===recordCount&&item.files===fileCount&&header.records===recordCount&&header.files.length===fileCount,
            'GRIDFABRIC_PORTABLE_DIGEST','The complete portable record counts or digest differ.');
          footer=item;
        }else{
          assert(['record','file','file_chunk','file_end'].includes(item.kind),'GRIDFABRIC_PORTABLE_MEMBER','An unknown portable member was encountered.');
          if(item.kind==='record')recordCount++;else if(item.kind==='file')fileCount++;
        }
        if(item.kind!=='footer')contentHash.update(line+'\n');
        yield item;
      }
      assert(Buffer.byteLength(buffer,'utf8')<=maximumLineBytes,'GRIDFABRIC_PORTABLE_LINE','A complete portable member exceeds the selected line allowance.');
    }
    buffer+=decoder.decode();await flow;
    assert(buffer===''&&header&&footer,'GRIDFABRIC_PORTABLE_INCOMPLETE','The complete portable footer or final newline is missing.');
    const actualSha256=compressedHash.digest('hex');
    assert(!expectedSha256||expectedSha256===actualSha256,'GRIDFABRIC_PORTABLE_SHA','The original compressed artifact SHA256 differs.');
    yield {kind:'verified',sha256:actualSha256,bytes:compressedBytes,decoded_bytes:decodedBytes,header,footer};
  }catch(error){input.destroy();tap.destroy();unzip.destroy();await flow.catch(()=>{});throw error;}
}
function originalChunk(item,active){
  assert(active&&item.sha256===active.sha256&&item.offset===active.bytes&&typeof item.data_base64==='string',
    'GRIDFABRIC_PORTABLE_CHUNK','An original file chunk is missing, reordered, or belongs to another file.');
  const body=Buffer.from(item.data_base64,'base64');
  assert(body.toString('base64')===item.data_base64,'GRIDFABRIC_PORTABLE_CHUNK','An original file chunk has invalid base64 bytes.');
  active.bytes+=body.length;active.chunks++;
  assert(active.bytes<=active.expectedBytes,'GRIDFABRIC_PORTABLE_FILE_LENGTH','An original retained file exceeds its declared complete length.');
  return body;
}
export async function inspectPortable(path,options={}){
  let verified,active=null;const seenFiles=new Set(),recordHash=createHash('sha256');
  for await(const item of readPortable(path,options)){
    if(active)assert(['file_chunk','file_end'].includes(item.kind),'GRIDFABRIC_PORTABLE_FILE_INCOMPLETE','The complete original file ended before its closing identity.');
    if(item.kind==='record')recordHash.update(JSON.stringify(item)+'\n');
    if(item.kind==='file'){
      assert(SHA.test(item.sha256)&&!seenFiles.has(item.sha256)&&Number.isSafeInteger(item.bytes)&&item.bytes>=0,
        'GRIDFABRIC_PORTABLE_FILE','The original file member is invalid or repeated.');
      if(item.encoding==='base64-chunks'){
        active={sha256:item.sha256,expectedBytes:item.bytes,bytes:0,chunks:0,hash:createHash('sha256'),decoder:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true})};
      }else{
        assert(typeof item.text_utf8==='string','GRIDFABRIC_PORTABLE_FILE','The original file has no supported complete-byte representation.');
        const identity=sha256Utf8(item.text_utf8);
        assert(identity.sha256===item.sha256&&identity.bytes===item.bytes,'GRIDFABRIC_PORTABLE_FILE_SHA','The complete original file bytes differ.');
        seenFiles.add(item.sha256);
      }
    }else if(item.kind==='file_chunk'){
      const body=originalChunk(item,active);active.hash.update(body);active.decoder.decode(body,{stream:true});
    }else if(item.kind==='file_end'){
      assert(active&&item.sha256===active.sha256&&item.bytes===active.expectedBytes&&item.bytes===active.bytes&&item.chunks===active.chunks,
        'GRIDFABRIC_PORTABLE_FILE_LENGTH','The original retained file has an incomplete closing identity.');
      active.decoder.decode();
      assert(active.hash.digest('hex')===active.sha256,'GRIDFABRIC_PORTABLE_FILE_SHA','The complete original streamed file differs.');
      seenFiles.add(active.sha256);active=null;
    }
    if(item.kind==='verified')verified=item;
  }
  assert(!active&&verified&&verified.header.records_sha256===recordHash.digest('hex'),'GRIDFABRIC_PORTABLE_RECORDS','The original logical record digest differs.');
  assert(verified.header.files.length===seenFiles.size&&verified.header.files.every(item=>seenFiles.has(item.sha256)),
    'GRIDFABRIC_PORTABLE_FILES','A declared original file is missing.');
  return verified;
}
export function listExports(workspace){
  const directory=join(workspace.directory,'exports');
  if(!existsSync(directory))return [];
  return readdirSync(directory).filter(name=>/^[0-9a-f-]{36}\.json$/.test(name)).map(name=>jsonFile(join(directory,name)))
    .sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
}
export function exportMetadata(workspace,id){
  assert(UUID.test(id),'GRIDFABRIC_EXPORT_ID','Use the original portable export UUID.');
  const path=join(workspace.directory,'exports',id+'.json');
  if(!existsSync(path))throw fail('GRIDFABRIC_EXPORT_NOT_FOUND','The original export does not exist.',{statusCode:404});
  const item=jsonFile(path);
  assert(item.export_id===id&&item.workspace_id===workspace.workspace_id,'GRIDFABRIC_EXPORT_BINDING','The export belongs to a different original workspace.');
  return item;
}
export async function exportWorkspace(workspace,{request_id,expected_revision,source=null}={}){
  assert(UUID.test(request_id),'GRIDFABRIC_EXPORT_ID','Use a canonical UUID for this original export.');
  assert(Number.isSafeInteger(expected_revision)&&expected_revision>=0,'GRIDFABRIC_EXPORT_REVISION','Supply the original export revision.');
  workspace.store.assertHeld();
  const directory=join(workspace.directory,'exports');privateDirectory(directory);
  const journalPath=join(directory,request_id+'.json'),snapshotPath=join(directory,request_id+'.sqlite'),
    filename='GridFabric_Workspace_'+request_id+'.jsonl.gz',target=join(directory,filename),part=target+'.part';
  let journal=existsSync(journalPath)?jsonFile(journalPath):null;
  if(journal){
    assert(journal.workspace_id===workspace.workspace_id&&journal.revision===expected_revision,
      'GRIDFABRIC_EXPORT_REQUEST_CONFLICT','This export UUID is bound to another original workspace revision.');
    if(journal.status==='READY'){
      const actual=await artifactIdentity(target);
      assert(actual.bytes===journal.bytes&&actual.sha256===journal.sha256,'GRIDFABRIC_EXPORT_CHANGED','The complete original export changed.');
      return {...journal,replayed:true};
    }
    if(existsSync(target)){
      const verified=await inspectPortable(target);
      assert(verified.header.export_id===request_id&&verified.header.records_sha256===journal.records_sha256,
        'GRIDFABRIC_EXPORT_CHANGED','The published original export does not match its retained plan.');
      journal={...journal,status:'READY',bytes:verified.bytes,sha256:verified.sha256,completed_at:new Date().toISOString()};
      atomicJson(journalPath,journal);return {...journal,replayed:true};
    }
  }
  if(!existsSync(snapshotPath)){
    const state=workspace.state();
    assert(state.workspace_id===workspace.workspace_id&&state.revision===expected_revision,'WORKSPACE_REVISION_CONFLICT','Refresh the original workspace before preparing this export.');
    assert(!journal,'GRIDFABRIC_EXPORT_SNAPSHOT_MISSING','The original pending export snapshot is missing; retain this record and prepare a new export UUID.');
    workspace.store.snapshot(snapshotPath);syncFile(snapshotPath);
  }
  const snapshot=openGridFabricSnapshot(snapshotPath);
  try{
    const description=snapshotDescription(snapshot);
    assert(description.workspace.workspace_id===workspace.workspace_id&&description.workspace.revision===expected_revision,
      'GRIDFABRIC_EXPORT_SNAPSHOT_CHANGED','The original snapshot belongs to another workspace revision.');
    if(journal)assert(journal.records_sha256===description.records_sha256,'GRIDFABRIC_EXPORT_SNAPSHOT_CHANGED','The retained logical snapshot changed.');
    else{
      journal={schema:'stellar-forge.gridfabric-export.v1',export_id:request_id,workspace_id:workspace.workspace_id,
        revision:expected_revision,created_at:new Date().toISOString(),status:'PUBLISHING',name:filename,
        mime_type:'application/gzip',records:description.records,counts:description.counts,files:description.files,
        records_sha256:description.records_sha256,source,
        download_url:'/api/export?id='+encodeURIComponent(request_id)};
      atomicJson(journalPath,journal);
    }
    if(existsSync(part))unlinkSync(part);
    const contentHash=createHash('sha256');
    const header={kind:'header',schema:SCHEMA,export_id:request_id,workspace_id:journal.workspace_id,
      revision:journal.revision,created_at:journal.created_at,records:journal.records,counts:journal.counts,
      files:journal.files,records_sha256:journal.records_sha256,source:journal.source};
    async function* members(){
      let count=0,files=0;
      const emit=value=>{const line=JSON.stringify(value)+'\n';contentHash.update(line);return line;};
      yield emit(header);
      for(const row of snapshot.records()){count++;yield emit({kind:'record',...row});}
      for(const file of journal.files){
        const path=workspace.files.filePath(file.sha256),identity=await artifactIdentity(path);
        assert(identity.bytes===file.bytes&&identity.sha256===file.sha256,'GRIDFABRIC_EXPORT_FILE_CHANGED','An original retained file differs from the snapshot.');
        files++;yield emit({kind:'file',...file,encoding:'base64-chunks'});
        const hash=createHash('sha256');let offset=0,chunks=0;
        for await(const body of createReadStream(path,{highWaterMark:256*1024})){
          hash.update(body);yield emit({kind:'file_chunk',sha256:file.sha256,offset,data_base64:body.toString('base64')});
          offset+=body.length;chunks++;
        }
        assert(offset===file.bytes&&hash.digest('hex')===file.sha256,'GRIDFABRIC_EXPORT_FILE_CHANGED','The original immutable file changed during streaming.');
        yield emit({kind:'file_end',sha256:file.sha256,bytes:offset,chunks});
      }
      yield JSON.stringify({kind:'footer',records:count,files,sha256:contentHash.digest('hex')})+'\n';
    }
    await pipeline(Readable.from(members()),createGzip({level:6}),createWriteStream(part,{flags:'wx',mode:0o600}));
    syncFile(part);
    const actual=await artifactIdentity(part);
    assert(!existsSync(target),'GRIDFABRIC_EXPORT_EXISTS','The original export target unexpectedly exists.');
    renameSync(part,target);syncDirectory(directory);
    journal={...journal,status:'READY',bytes:actual.bytes,sha256:actual.sha256,completed_at:new Date().toISOString()};
    atomicJson(journalPath,journal);
    return journal;
  }finally{
    snapshot.close();
    if(journal?.status==='READY'&&existsSync(snapshotPath))unlinkSync(snapshotPath);
  }
}
async function verifyRestored(directory,header){
  const store=await openGridFabricStore({directory,create:false});
  try{
    const recordHash=createHash('sha256');let records=0;
    for(const row of store.entries()){recordHash.update(JSON.stringify({kind:'record',...row})+'\n');records++;}
    assert(records===header.records&&recordHash.digest('hex')===header.records_sha256,'GRIDFABRIC_RESTORE_RECORDS','The restored original logical records differ.');
    const state=store.get('meta','workspace');
    assert(state?.workspace_id===header.workspace_id&&state.revision===header.revision,'GRIDFABRIC_RESTORE_WORKSPACE','Cold restoration changed the original workspace identity.');
    const vault=createGridFabricFiles({directory,assertHeld:store.assertHeld});
    const found=[...vault.identities()],expected=new Map(header.files.map(x=>[x.sha256,x.bytes]));
    assert(found.length===expected.size&&found.every(x=>expected.get(x.sha256)===x.bytes),'GRIDFABRIC_RESTORE_FILES','The restored original file inventory differs.');
    return {workspace_id:state.workspace_id,revision:state.revision,records,files:found.length};
  }finally{await store.close();}
}
function sameRestore(receipt,destination,sha256){
  return receipt?.schema==='stellar-forge.gridfabric-restore.v1'&&receipt.directory===destination&&
    receipt.source?.sha256===sha256&&receipt.header?.workspace_id===receipt.workspace_id&&
    receipt.header?.records_sha256===receipt.records_sha256;
}
export async function restorationStatus({destination,expectedSha256}={}){
  const directory=resolve(destination),receiptPath=join(directory,'restore-receipt.json');
  if(!existsSync(receiptPath))throw fail('GRIDFABRIC_RESTORE_NOT_FOUND','No completed original receiving receipt exists.',{statusCode:404});
  privateDirectory(directory,{create:false});
  const receipt=jsonFile(receiptPath),sha=expectedSha256||receipt.source?.sha256;
  assert(sameRestore(receipt,directory,sha),'GRIDFABRIC_RESTORE_REQUEST_CONFLICT','The completed receiving belongs to another archive or destination.');
  const snapshot=openGridFabricSnapshot(join(directory,'gridfabric.sqlite'));
  let current;try{current=snapshotDescription(snapshot);}finally{snapshot.close();}
  assert(current.workspace.workspace_id===receipt.workspace_id,'GRIDFABRIC_RESTORE_WORKSPACE','The destination now contains an unrelated workspace.');
  // The snapshot is closed before reading complete immutable source files.
  const vault=createGridFabricFiles({directory,readOnly:true});
  for(const file of receipt.header.files){
    const actual=await artifactIdentity(vault.filePath(file.sha256));
    assert(actual.sha256===file.sha256&&actual.bytes===file.bytes,'GRIDFABRIC_RESTORE_FILES','A retained original receiving file has changed or is missing.');
  }
  const matches=current.records_sha256===receipt.records_sha256&&current.workspace.revision===receipt.revision;
  return {...receipt,replayed:true,current:{workspace_id:current.workspace.workspace_id,revision:current.workspace.revision,
    records_sha256:current.records_sha256,matches_snapshot:matches},status:matches?'RESTORED':'RESTORED_AND_ADVANCED'};
}
async function publishRestoration(destination,marker){
  const stage=marker.staging_directory;
  assert(marker.destination===destination&&dirname(stage)===dirname(destination),'GRIDFABRIC_RESTORE_PUBLICATION','The original receiving stage must be a sibling of its destination.');
  privateDirectory(stage,{create:false});
  const logical=await verifyRestored(stage,marker.header);
  const receiptPath=join(stage,'restore-receipt.json');
  const receipt=existsSync(receiptPath)?jsonFile(receiptPath):{
    schema:'stellar-forge.gridfabric-restore.v1',status:'RESTORED',...logical,directory:destination,source:marker.source,
    records_sha256:marker.header.records_sha256,header:marker.header,completed_at:new Date().toISOString()
  };
  assert(sameRestore(receipt,destination,marker.source.sha256),'GRIDFABRIC_RESTORE_REQUEST_CONFLICT','The staged original receiving receipt differs.');
  atomicJson(receiptPath,receipt);
  // The complete receipt and native data are synced before one no-clobber directory publication.
  // GNU mv -T prevents destination-directory interpretation. Source disposition is checked even if mv exits 0.
  if(existsSync(join(stage,MARKER)))unlinkSync(join(stage,MARKER));
  syncDirectory(stage);
  assert(lstatSync(stage).dev===lstatSync(dirname(destination)).dev,'GRIDFABRIC_RESTORE_FILESYSTEM','Keep the original receiving stage on the destination filesystem.');
  const moved=spawnSync('mv',['--no-clobber','--no-target-directory','--',stage,destination],{
    encoding:'utf8',timeout:30000,maxBuffer:65536,stdio:['ignore','pipe','pipe'],env:{...process.env,LC_ALL:'C'}
  });
  if(!existsSync(stage)&&existsSync(join(destination,'restore-receipt.json'))){
    syncDirectory(dirname(destination));return restorationStatus({destination,expectedSha256:marker.source.sha256});
  }
  if(existsSync(destination))throw fail('GRIDFABRIC_RESTORE_EXISTS','The destination already exists; its contents were preserved and the original receiving stage remains.',{statusCode:409,staging_directory:stage});
  throw fail('GRIDFABRIC_RESTORE_PUBLICATION','The complete original receiving stage remains pending. GNU mv with no-clobber and no-target-directory is required.',{
    statusCode:503,staging_directory:stage,process_status:moved.status,process_error:moved.error?.code||null
  });
}
export async function restoreWorkspace({file,destination,expectedSha256,maximumDecodedBytes=4*1024*1024*1024}={}){
  const input=await artifactIdentity(file);
  assert(!expectedSha256||input.sha256===expectedSha256,'GRIDFABRIC_PORTABLE_SHA','The selected original archive SHA256 differs.');
  const target=resolve(destination);privateDirectory(dirname(target));
  if(existsSync(target)){
    if(existsSync(join(target,'restore-receipt.json')))return restorationStatus({destination:target,expectedSha256:input.sha256});
    throw fail('GRIDFABRIC_RESTORE_EXISTS','Choose a new receiving workspace; the selected destination already exists.',{statusCode:409});
  }
  const stage=join(dirname(target),'.gridfabric-receiving-'+createHash('sha256').update(target+'\n'+input.sha256).digest('hex').slice(0,32));
  if(existsSync(stage)){
    privateDirectory(stage,{create:false});
    const publication=join(stage,'publication.json');
    if(existsSync(publication)){
      const retained=jsonFile(publication);
      assert(retained.source.sha256===input.sha256&&retained.destination===target&&retained.staging_directory===stage,
        'GRIDFABRIC_RESTORE_STAGE','The retained publication names another archive or destination.');
      return publishRestoration(target,retained);
    }
    assert(existsSync(join(stage,MARKER)),'GRIDFABRIC_RESTORE_STAGE','The original receiving stage marker is missing.');
    const retained=jsonFile(join(stage,MARKER));
    assert(retained.source.sha256===input.sha256&&retained.destination===target,'GRIDFABRIC_RESTORE_STAGE','The retained receiving stage names a different archive.');
  }else{
    privateDirectory(stage);
    atomicJson(join(stage,MARKER),{schema:'stellar-forge.gridfabric-restore-stage.v1',source:input,destination:target,created_at:new Date().toISOString()});
  }
  const store=await openGridFabricStore({directory:stage,create:true});
  let header,verified,recordHash=createHash('sha256'),filesSeen=new Set(),batch=[],active=null;
  try{
    store.resetForRestore();
    const vault=createGridFabricFiles({directory:stage,assertHeld:store.assertHeld});
    const flush=()=>{if(!batch.length)return;store.transaction(()=>{
      for(const item of batch){
        assert(typeof item.table==='string'&&/^[a-z][a-z0-9_]*$/.test(item.table)&&typeof item.id==='string'&&item.id&&item.data!==null&&typeof item.data==='object',
          'GRIDFABRIC_PORTABLE_RECORD','An original logical record is incomplete.');
        assert(store.get(item.table,item.id)===null,'GRIDFABRIC_PORTABLE_DUPLICATE','The original portable record identity repeats.');
        store.put(item.table,item.id,item.data,{scope:item.scope,sort:item.sort,tag:item.tag});
      }
    });batch=[];};
    for await(const item of readPortable(input.path,{expectedSha256:input.sha256,maximumDecodedBytes})){
      if(active)assert(['file_chunk','file_end'].includes(item.kind),'GRIDFABRIC_PORTABLE_FILE_INCOMPLETE','The original retained file ended before its closing identity.');
      if(item.kind==='header'){header=item;continue;}
      if(item.kind==='record'){recordHash.update(JSON.stringify(item)+'\n');batch.push(item);if(batch.length>=500)flush();continue;}
      if(active)assert(['file_chunk','file_end'].includes(item.kind),'GRIDFABRIC_PORTABLE_FILE_INCOMPLETE','The original retained file ended before its closing identity.');
      if(item.kind==='file'){
        flush();assert(!filesSeen.has(item.sha256),'GRIDFABRIC_PORTABLE_FILE','A retained original file repeats.');
        const expected=header.files.find(entry=>entry.sha256===item.sha256);
        assert(expected&&expected.bytes===item.bytes,'GRIDFABRIC_PORTABLE_FILE_METADATA','The retained file is not in the original declared snapshot.');
        if(item.encoding==='base64-chunks'){
          active={sha256:item.sha256,expectedBytes:item.bytes,bytes:0,chunks:0,receiver:vault.beginReceive(item)};
        }else{
          assert(typeof item.text_utf8==='string','GRIDFABRIC_PORTABLE_FILE','The original file has no supported complete-byte representation.');
          const actual=vault.put(item.text_utf8,{name:item.name,mime_type:item.mime_type});
          assert(actual.sha256===item.sha256&&actual.bytes===item.bytes,'GRIDFABRIC_PORTABLE_FILE_SHA','The retained original UTF-8 bytes differ.');
          filesSeen.add(item.sha256);
        }
        continue;
      }
      if(item.kind==='file_chunk'){const body=originalChunk(item,active);active.receiver.write(body);continue;}
      if(item.kind==='file_end'){
        assert(active&&item.sha256===active.sha256&&item.bytes===active.expectedBytes&&item.bytes===active.bytes&&item.chunks===active.chunks,
          'GRIDFABRIC_PORTABLE_FILE_LENGTH','The original retained file has an incomplete closing identity.');
        active.receiver.finish();filesSeen.add(active.sha256);active=null;continue;
      }
      if(item.kind==='verified')verified=item;
    }
    flush();
    assert(!active&&verified&&header.records_sha256===recordHash.digest('hex')&&filesSeen.size===header.files.length,'GRIDFABRIC_RESTORE_INCOMPLETE','The complete original records or source files did not arrive.');
  }finally{active?.receiver.abort();await store.close();}
  await verifyRestored(stage,header);
  const marker={schema:'stellar-forge.gridfabric-restore-publication.v1',source:input,destination:target,staging_directory:stage,header};
  atomicJson(join(stage,'publication.json'),marker);
  return publishRestoration(target,marker);
}
