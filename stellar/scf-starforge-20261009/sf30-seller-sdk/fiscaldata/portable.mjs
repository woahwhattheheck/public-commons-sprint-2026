// MIT. Portable, streamed checkpoints of the original Fiscal source/review workspace.
import { constants, createWriteStream } from 'node:fs';
import { open, readdir, lstat, mkdir, rename, unlink, realpath } from 'node:fs/promises';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';
import { acquireWorkspace, privateDirectory, readPrivate, readJson, createFile, atomicJson,
  syncDirectory, hashPrivate, identity, bytes, fault, object } from '../postgres/publisher/files.mjs';

export const FISCAL_PACKAGE_SCHEMA = 'stellar-forge.fiscaldata-source-package.v1';
const WORKSPACE_SCHEMA = 'stellar-forge.fiscaldata-workspace.v1';
const ROOTS = new Set(['catalogs','sources','captures','editions','comparisons','exports','staging','restoration','operator-history']);
const MAX_FILE = 256 * 1024 ** 2, MAX_SOURCE = 512 * 1024 ** 2, MAX_PACKAGE = 256_000_000;
const MAX_FILES = 20000, CHUNK = 48 * 1024, MAX_LINE = 8 * 1024 ** 2;
const HASH = /^[a-f0-9]{64}$/, UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const clock = () => new Date().toISOString();
const lineBytes = value => Buffer.from(JSON.stringify(value)+'\n');
const exists = async p => { try { await lstat(p); return true; } catch (e) { if(e.code==='ENOENT')return false;throw e; } };
function only(value, keys) {
  if(!object(value)||Object.keys(value).some(k=>!keys.includes(k)))throw fault('PACKAGE_FORMAT','Unexpected package fields.');
}
function actorValue(actor) {
  only(actor,['id','label']);
  if(!/^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,159}$/.test(actor.id??'')||typeof actor.label!=='string'||
    !actor.label.trim()||actor.label.length>200||/[\x00-\x1f\x7f]/.test(actor.label))
    throw fault('PACKAGE_OPERATOR','Use the host-declared original operator ID and label.');
  return {...actor};
}
function operation(value) {
  if(!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value??''))throw fault('PACKAGE_OPERATION','Keep one explicit operation ID for this package or receiving attempt.');
  return value;
}
function absolute(value) {
  if(typeof value!=='string'||!isAbsolute(value)||resolve(value)!==value||value==='/')throw fault('PACKAGE_DIRECTORY','Use an explicit normalized private directory.');
  return value;
}
function relativePath(value) {
  if(typeof value!=='string'||value.length>2048||value.includes('\\')||/[\x00-\x1f\x7f]/.test(value)||
    value.split('/').some(p=>!p||p==='.'||p==='..'||p.length>255)||
    value!=='workspace.json'&&!ROOTS.has(value.split('/')[0]))
    throw fault('PACKAGE_PATH','The package contains a path outside the original source/review workspace.');
  return value;
}
async function immutable(path, value) {
  try { await createFile(path,value); }
  catch(error){if(error.code!=='EEXIST')throw error;
    if(!(await readPrivate(path,Math.max(value.length+1,1024))).equals(value))throw fault('PACKAGE_IDENTITY_CHANGED','An original package or receiving identity already selects other bytes.',409);}
}
async function descriptor(root,path) {
  const result=await hashPrivate(join(root,relativePath(path)),MAX_FILE);
  return {path,size:result.bytes,sha256:result.hash};
}
async function inventory(directory) {
  const files=[];
  async function walk(path) {
    for(const entry of (await readdir(join(directory,path),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      const name=path+'/'+entry.name;relativePath(name);
      if(entry.isDirectory())await walk(name);
      else if(entry.isFile())files.push(await descriptor(directory,name));
      else throw fault('PACKAGE_SOURCE_TYPE','Retain only original regular files and directories; symbolic links are not portable.');
      if(files.length>MAX_FILES)throw fault('PACKAGE_CAPACITY','This workspace exceeds the declared 20,000-file package capacity.',413);
    }
  }
  files.push(await descriptor(directory,'workspace.json'));
  for(const root of [...ROOTS].sort())if(await exists(join(directory,root)))await walk(root);
  files.sort((a,b)=>a.path.localeCompare(b.path));
  const size=files.reduce((n,f)=>n+f.size,0);
  if(size>MAX_SOURCE)throw fault('PACKAGE_CAPACITY','The original source/review workspace exceeds the 512 MiB streaming package capacity.',413);
  return {files,bytes:size};
}
async function* fileChunks(path,expected) {
  if(await realpath(path)!==path)throw fault('PACKAGE_SOURCE_PATH','Use original canonical source paths.');
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try {
    const before=await handle.stat();
    if(!before.isFile()||before.nlink!==1||before.size!==expected.size||(before.mode&0o077))
      throw fault('PACKAGE_SOURCE_CHANGED','An original private source file changed.',409);
    let offset=0;const hash=createHash('sha256');
    for await(const chunk of handle.createReadStream({highWaterMark:CHUNK,autoClose:false})) {
      hash.update(chunk);yield {offset,data:chunk};offset+=chunk.length;
    }
    const after=await handle.stat();
    if(offset!==expected.size||hash.digest('hex')!==expected.sha256||before.ino!==after.ino||
      before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)
      throw fault('PACKAGE_SOURCE_CHANGED','An original source changed while its package was streamed.',409);
  } finally {await handle.close();}
}
function limitBytes(maximum,code) {
  let total=0;
  return new Transform({transform(chunk,encoding,callback){total+=chunk.length;
    callback(total>maximum?fault(code,'This package exceeds its declared streaming capacity.',413):null,chunk);}});
}
async function syncFile(path) {const handle=await open(path,'r');try{await handle.sync();}finally{await handle.close();}}
function validateManifest(value) {
  only(value,['schema','operationId','createdAt','operator','workspace','files','bytes','publication']);
  if(value.schema!==FISCAL_PACKAGE_SCHEMA||!object(value.workspace)||!UUID.test(value.workspace.id??'')||
    !Number.isSafeInteger(value.workspace.revision)||value.workspace.revision<1||!Array.isArray(value.files)||value.files.length>MAX_FILES)
    throw fault('PACKAGE_FORMAT','Use an original Fiscal source-workspace package.');
  operation(value.operationId);actorValue(value.operator);
  let total=0,previous=null;const paths=new Set();
  for(const file of value.files){
    only(file,['path','size','sha256']);relativePath(file.path);
    if(paths.has(file.path)||previous!==null&&previous.localeCompare(file.path)>=0||
      !Number.isSafeInteger(file.size)||file.size<0||file.size>MAX_FILE||!HASH.test(file.sha256??''))
      throw fault('PACKAGE_MANIFEST','The original package file inventory is invalid.');
    paths.add(file.path);previous=file.path;total+=file.size;
  }
  if(!paths.has('workspace.json')||total!==value.bytes||total>MAX_SOURCE)throw fault('PACKAGE_MANIFEST','The original workspace header and complete byte inventory are required.');
  return value;
}
/** Caller closes its original model first; this function owns the same kernel lease while copying. */
export async function createFiscalSourcePackage({directory,outputDirectory,operationId,actor,publication={}}) {
  absolute(directory);absolute(outputDirectory);operation(operationId);actor=actorValue(actor);
  if(outputDirectory===directory||outputDirectory.startsWith(directory+'/'))throw fault('PACKAGE_OUTPUT','Keep package outputs outside the original workspace.');
  await privateDirectory(directory,false);await privateDirectory(outputDirectory,true);
  const release=await acquireWorkspace(directory);
  try {
    const packageId=identity({operationId,directory}),root=join(outputDirectory,packageId);
    await privateDirectory(root,true);
    const sealPath=join(root,'sealed.json');
    if(await exists(sealPath)) {
      const seal=await readJson(sealPath,1024*1024);
      if(seal.operationId!==operationId||seal.directory!==directory)throw fault('PACKAGE_IDENTITY_CHANGED','This package identity belongs to another source.',409);
      for(const file of seal.files){const current=await hashPrivate(join(root,file.name),MAX_PACKAGE);if(current.hash!==file.sha256||current.bytes!==file.size)throw fault('PACKAGE_SEALED_CHANGED','A sealed package file changed.',409);}
      return {packageId,operationId,workspace:seal.workspace,files:seal.files,createdAt:seal.createdAt};
    }
    const header=await readJson(join(directory,'workspace.json'),1024*1024);
    if(header.schema!==WORKSPACE_SCHEMA||!UUID.test(header.id??''))throw fault('PACKAGE_WORKSPACE','Use the original initialized Fiscal workspace.');
    const listed=await inventory(directory),intentPath=join(root,'intent.json');
    let manifest={schema:FISCAL_PACKAGE_SCHEMA,operationId,createdAt:clock(),operator:actor,
      workspace:{id:header.id,revision:header.revision},...listed,publication};
    if(await exists(intentPath)) {
      const prior=await readJson(intentPath,MAX_LINE);
      if(prior.operationId!==operationId||identity(prior.files)!==identity(listed.files)||identity(prior.workspace)!==identity(manifest.workspace)||
        identity(prior.operator)!==identity(actor))throw fault('PACKAGE_SOURCE_ADVANCED','This unfinished checkpoint selects an earlier source. Preserve it and use a new operation ID for the changed workspace.',409);
      manifest=prior;
    } else await immutable(intentPath,bytes(manifest));
    validateManifest(manifest);
    const manifestSha256=identity(manifest),temporary=join(root,'workspace.fiscal.gz.partial-'+randomUUID());
    async function* stream() {
      yield lineBytes({kind:'manifest',manifest,sha256:manifestSha256});
      for(const file of manifest.files){
        yield lineBytes({kind:'file',...file});
        for await(const chunk of fileChunks(join(directory,file.path),file))
          yield lineBytes({kind:'data',offset:chunk.offset,base64:chunk.data.toString('base64')});
        yield lineBytes({kind:'end',path:file.path,sha256:file.sha256});
      }
      yield lineBytes({kind:'complete',manifestSha256});
    }
    await pipeline(Readable.from(stream()),createGzip({level:6}),limitBytes(MAX_PACKAGE,'PACKAGE_COMPRESSED_CAPACITY'),
      createWriteStream(temporary,{flags:'wx',mode:0o600}));
    await syncFile(temporary);
    const target=join(root,'workspace.fiscal.gz');
    if(await exists(target)) {
      // Only an unsealed derived output can be superseded; keep its original interrupted bytes.
      await rename(target,join(root,'workspace.fiscal.gz.unsealed-'+randomUUID()));
    }
    await rename(temporary,target);await syncDirectory(root);
    await immutable(join(root,'manifest.json'),bytes(manifest));
    const files=[];
    for(const [name,mime] of [['workspace.fiscal.gz','application/gzip'],['manifest.json','application/json']]){
      const result=await hashPrivate(join(root,name),MAX_PACKAGE);files.push({name,mime,size:result.bytes,sha256:result.hash});
    }
    await immutable(sealPath,bytes({schema:FISCAL_PACKAGE_SCHEMA,packageId,operationId,directory,workspace:manifest.workspace,
      createdAt:manifest.createdAt,manifestSha256,files}));
    return {packageId,operationId,workspace:manifest.workspace,files,createdAt:manifest.createdAt};
  } finally {await release();}
}
async function* lines(stream) {
  let retained=Buffer.alloc(0),total=0;
  for await(const chunk of stream) {
    total+=chunk.length;if(total>MAX_SOURCE*1.5+64*1024**2)throw fault('PACKAGE_EXPANDED_CAPACITY','The expanded package exceeds its source capacity.',413);
    retained=retained.length?Buffer.concat([retained,chunk]):chunk;
    for(;;){const at=retained.indexOf(10);if(at<0)break;
      if(at>MAX_LINE)throw fault('PACKAGE_LINE_CAPACITY','The package has an oversized metadata or data line.',413);
      const line=retained.subarray(0,at);retained=retained.subarray(at+1);
      if(!line.length)throw fault('PACKAGE_FORMAT','Empty package records are invalid.');
      yield JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(line));
    }
    if(retained.length>MAX_LINE)throw fault('PACKAGE_LINE_CAPACITY','The package has an oversized record.',413);
  }
  if(retained.length)throw fault('PACKAGE_TRUNCATED','The package ended before its complete original record.',409);
}
/** Verify the entire compressed file and each streamed member before accepting a checkpoint. */
async function readPackage(path,expectedSha256,onManifest,onFile) {
  path=absolute(path);
  if(!HASH.test(expectedSha256??''))throw fault('PACKAGE_SHA256','Select the complete expected package SHA-256.');
  const fingerprint=await hashPrivate(path,MAX_PACKAGE);
  if(fingerprint.hash!==expectedSha256)throw fault('PACKAGE_CHANGED','The selected source package differs from its reviewed SHA-256.',409);
  if(await realpath(path)!==path)throw fault('PACKAGE_SOURCE_PATH','Use the canonical original package file.');
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  const before=await handle.stat(),compressed=createHash('sha256');
  const input=handle.createReadStream({autoClose:false}),checker=new Transform({transform(chunk,encoding,callback){compressed.update(chunk);callback(null,chunk);}}),expanded=createGunzip();input.pipe(checker).pipe(expanded);
  let manifest,manifestSha,selected=null,writer=null,index=0,offset=0,hash,complete=false;
  const fail=e=>expanded.destroy(e);input.on('error',fail);checker.on('error',fail);
  try {
    for await(const item of lines(expanded)){
      if(complete)throw fault('PACKAGE_TRAILING_DATA','The package has data after its completion record.');
      if(!manifest){
        only(item,['kind','manifest','sha256']);
        if(item.kind!=='manifest')throw fault('PACKAGE_FORMAT','The package must start with its exact manifest.');
        manifest=validateManifest(item.manifest);manifestSha=identity(manifest);
        if(item.sha256!==manifestSha)throw fault('PACKAGE_MANIFEST_CHANGED','The package manifest digest changed.',409);
        await onManifest?.(manifest);continue;
      }
      if(item.kind==='file'){
        only(item,['kind','path','size','sha256']);selected=manifest.files[index];
        if(writer||!selected||item.path!==selected.path||item.size!==selected.size||item.sha256!==selected.sha256)
          throw fault('PACKAGE_MEMBER_ORDER','The package members differ from their original inventory.');
        offset=0;hash=createHash('sha256');writer=await onFile?.(selected)??{write:async()=>{},end:async()=>{},abort:async()=>{}};
      } else if(item.kind==='data'){
        only(item,['kind','offset','base64']);
        if(!writer||item.offset!==offset||typeof item.base64!=='string'||item.base64.length>CHUNK*4/3||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.base64))
          throw fault('PACKAGE_CHUNK','A package member chunk has an invalid offset or encoding.');
        const data=Buffer.from(item.base64,'base64');
        if(!data.length||offset+data.length>selected.size)throw fault('PACKAGE_MEMBER_SIZE','A package member exceeds its declared bytes.');
        hash.update(data);await writer.write(data);offset+=data.length;
      } else if(item.kind==='end'){
        only(item,['kind','path','sha256']);
        if(!writer||item.path!==selected.path||item.sha256!==selected.sha256||offset!==selected.size||hash.digest('hex')!==selected.sha256)
          throw fault('PACKAGE_MEMBER_CHANGED','A streamed package member differs from its original digest.',409);
        await writer.end();writer=null;selected=null;index++;
      } else if(item.kind==='complete'){
        only(item,['kind','manifestSha256']);
        if(writer||index!==manifest.files.length||item.manifestSha256!==manifestSha)throw fault('PACKAGE_INCOMPLETE','The package is missing original members.',409);
        complete=true;
      } else throw fault('PACKAGE_FORMAT','Unknown package record.');
    }
    if(!complete)throw fault('PACKAGE_INCOMPLETE','The original package completion record is missing.',409);
    const after=await handle.stat();
    if(after.size!==fingerprint.bytes||compressed.digest('hex')!==expectedSha256||before.ino!==after.ino||
      before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw fault('PACKAGE_CHANGED','The source package changed while being read.',409);
    return {manifest,sha256:expectedSha256,size:fingerprint.bytes,manifestSha256:manifestSha};
  } finally {
    input.off('error',fail);checker.off('error',fail);input.destroy();checker.destroy();expanded.destroy();
    await writer?.abort?.();await handle.close();
  }
}
export async function inspectFiscalSourcePackage({packagePath,expectedSha256}) {
  const result=await readPackage(packagePath,expectedSha256);
  return {...result,manifest:{...result.manifest,files:result.manifest.files}};
}
async function fileWriter(stage,file) {
  const destination=join(stage,file.path);await privateDirectory(dirname(destination),true);
  const incomplete=join(dirname(stage),'incomplete');await privateDirectory(incomplete,true);
  const temporary=join(incomplete,randomUUID()),handle=await open(temporary,'wx',0o600);
  let closed=false,position=0;
  return {
    async write(data){let done=0;while(done<data.length){const result=await handle.write(data,done,data.length-done,position);if(!result.bytesWritten)throw fault('PACKAGE_WRITE','The receiver could not advance its original file.');done+=result.bytesWritten;position+=result.bytesWritten;}},
    async end(){await handle.sync();await handle.close();closed=true;
      if(await exists(destination)){
        const prior=await hashPrivate(destination,MAX_FILE);
        if(prior.hash===file.sha256&&prior.bytes===file.size){await unlink(temporary);return;}
        await rename(destination,join(incomplete,randomUUID()));
      }
      await rename(temporary,destination);await syncDirectory(dirname(destination));
    },
    async abort(){if(!closed){await handle.close();closed=true;}}
  };
}
/** Receive into one empty declared destination; interrupted receiving resumes under its original lease. */
export async function receiveFiscalSourcePackage({directory,packagePath,expectedSha256,operationId,actor}) {
  absolute(directory);absolute(packagePath);operation(operationId);actor=actorValue(actor);
  if(!HASH.test(expectedSha256??''))throw fault('PACKAGE_SHA256','Use the reviewed package digest.');
  await privateDirectory(directory,true);
  const unlock=await acquireWorkspace(directory);
  try {
    const receivingId=identity({operationId,expectedSha256}),control=join(directory,'.fiscal-receive'),root=join(control,receivingId);
    const receiptPath=join(directory,'restoration',receivingId,'receipt.json');
    if(await exists(join(directory,'workspace.json'))){
      if(!await exists(receiptPath))throw fault('PACKAGE_DESTINATION_NOT_EMPTY','Receive into an empty declared workspace; keep existing originals.',409);
      const receipt=await readJson(receiptPath,MAX_LINE);
      if(receipt.operationId!==operationId||receipt.packageSha256!==expectedSha256)throw fault('PACKAGE_RECEIVING_CONFLICT','This destination belongs to another received source.',409);
      return {...receipt,reused:true};
    }
    const initial=await readdir(directory);
    if(!await exists(root)&&initial.some(name=>name!=='publisher.lock'&&name!=='.fiscal-receive'))
      throw fault('PACKAGE_DESTINATION_NOT_EMPTY','Choose an empty declared receiving workspace.',409);
    await privateDirectory(root,true);
    const intentPath=join(root,'intent.json');let intent;
    if(await exists(intentPath)){
      intent=await readJson(intentPath,MAX_LINE);
      if(intent.operationId!==operationId||intent.packageSha256!==expectedSha256||identity(intent.operator)!==identity(actor))
        throw fault('PACKAGE_RECEIVING_CONFLICT','Continue the original receiving identity and operator.',409);
    } else {intent={operationId,packageSha256:expectedSha256,operator:actor,createdAt:clock()};await immutable(intentPath,bytes(intent));}
    const stage=join(root,'stage');await privateDirectory(stage,true);
    const parsed=await readPackage(packagePath,expectedSha256,async manifest=>immutable(join(root,'manifest.json'),bytes(manifest)),
      file=>fileWriter(stage,file));
    const originalHeader=await readJson(join(stage,'workspace.json'),1024*1024);
    if(originalHeader.schema!==WORKSPACE_SCHEMA||originalHeader.id!==parsed.manifest.workspace.id||
      originalHeader.revision!==parsed.manifest.workspace.revision)throw fault('PACKAGE_WORKSPACE_CHANGED','The retained workspace header differs from its original manifest.',409);
    const history=join(stage,'restoration',receivingId),originals=join(history,'originals');
    await privateDirectory(originals,true);
    await immutable(join(originals,'workspace.json'),await readPrivate(join(stage,'workspace.json'),1024*1024));
    const paused=[],generatedPaths=['restoration/'+receivingId+'/originals/workspace.json','restoration/'+receivingId+'/receipt.json'];
    for(const file of parsed.manifest.files.filter(f=>/^captures\/[a-f0-9-]+\/record\.json$/.test(f.path))){
      const record=await readJson(join(stage,file.path),32*1024**2);
      if(record.desiredState==='RUNNING'&&!['COMPLETE','CANCELLED'].includes(record.status)){
        await privateDirectory(dirname(join(originals,file.path)),true);
        await immutable(join(originals,file.path),await readPrivate(join(stage,file.path),32*1024**2));
        generatedPaths.push('restoration/'+receivingId+'/originals/'+file.path);
        const changed={...record,revision:record.revision+1,status:'PAUSED',desiredState:'PAUSED',updatedAt:intent.createdAt,
          restoredFrom:{packageSha256:expectedSha256,revision:record.revision,status:record.status,desiredState:record.desiredState}};
        await atomicJson(dirname(join(stage,file.path)),'record.json',changed);paused.push(record.id);
      }
    }
    const header={...originalHeader,revision:originalHeader.revision+1,updatedAt:intent.createdAt,
      restoredFrom:{packageSha256:expectedSha256,workspaceId:originalHeader.id,revision:originalHeader.revision,operationId}};
    await atomicJson(stage,'workspace.json',header);
    const receipt={schema:FISCAL_PACKAGE_SCHEMA,receivingId,operationId,packageSha256:expectedSha256,
      manifestSha256:parsed.manifestSha256,operator:actor,receivedAt:intent.createdAt,workspace:{id:header.id,revision:header.revision},
      originalWorkspace:parsed.manifest.workspace,originalFiles:parsed.manifest.files.length,originalBytes:parsed.manifest.bytes,
      pausedCaptures:paused,publication:parsed.manifest.publication,reused:false};
    await immutable(join(history,'receipt.json'),bytes(receipt));
    const promoted=[];
    for(const path of new Set([...parsed.manifest.files.map(f=>f.path),...generatedPaths]))promoted.push(await descriptor(stage,path));
    promoted.sort((a,b)=>a.path==='workspace.json'?1:b.path==='workspace.json'?-1:a.path.localeCompare(b.path));
    await immutable(join(root,'promotion.json'),bytes(promoted));
    for(const file of promoted){
      relativePath(file.path);
      const target=join(directory,file.path);await privateDirectory(dirname(target),true);
      if(await exists(target)){
        const current=await hashPrivate(target,MAX_FILE);
        if(current.hash!==file.sha256||current.bytes!==file.size)throw fault('PACKAGE_RECEIVING_CHANGED','A receiving target changed outside its original operation.',409);
      } else await rename(join(stage,file.path),target);
      await syncDirectory(dirname(target));
    }
    await syncDirectory(directory);
    return receipt;
  } finally {await unlock();}
}
export async function fiscalSourcePackageFile({outputDirectory,packageId,filename}) {
  absolute(outputDirectory);
  if(!HASH.test(packageId??'')||!['workspace.fiscal.gz','manifest.json'].includes(filename))throw fault('PACKAGE_FILE','Choose an original package file.');
  const root=join(outputDirectory,packageId),seal=await readJson(join(root,'sealed.json'),1024*1024);
  const file=seal.files.find(item=>item.name===filename),path=join(root,filename),actual=await hashPrivate(path,MAX_PACKAGE);
  if(!file||actual.hash!==file.sha256||actual.bytes!==file.size)throw fault('PACKAGE_SEALED_CHANGED','The retained package differs from its original sealed file.',409);
  return {path,name:filename,mime:file.mime,size:file.size,sha256:file.sha256};
}
