// MIT. Complete immutable SensorThings source-edition handover in the original store.
import {createHash,randomUUID} from 'node:crypto';
import {open,link,unlink,rmdir,realpath} from 'node:fs/promises';
import {createGzip,createGunzip} from 'node:zlib';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {join,basename,resolve} from 'node:path';
import {constants} from 'node:fs';
import {readOwned,privateDirectory,syncDir,atomicJSON} from '../stellar-expert/store.mjs';
import {parseExactJSON} from '../stellar-expert/exact-json.mjs';
import {sha,identity,json,stable,plain,fault,EDITION_SCHEMA,WORKSPACE_SCHEMA} from './contract.mjs';

export const TRANSFER_FORMAT='stellar-forge.sensorthings-edition-transfer.v1';
export const TRANSFER_LIMITS=Object.freeze({
  chunkBytes:48*1024,objectBytes:256*1024*1024,sourceBytes:2*1024*1024*1024,
  archiveBytes:2*1024*1024*1024,expandedBytes:4*1024*1024*1024,
  lineBytes:24*1024*1024,editionBytes:16*1024*1024,objects:100000
});
const HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,
  OP=/^[A-Za-z0-9_-]{8,100}$/,BUFFER_BYTES=65536;
const same=(a,b)=>['dev','ino','size','mtimeNs','ctimeNs','uid','mode'].every(k=>a[k]===b[k]);
const errorRecord=e=>({code:typeof e.code==='string'?e.code:'SENSORTHINGS_TRANSFER_FAILED',
  message:typeof e.message==='string'?e.message:'The original transfer did not complete.'});
function exactFields(record,names){
  if(!plain(record)||Object.keys(record).some(k=>!names.includes(k)))
    throw fault('TRANSFER_RECORD','An archive record contains undeclared fields.',409);
}
function byteCount(value,maximum,label){
  if(!Number.isSafeInteger(value)||value<0||value>maximum)
    throw fault('TRANSFER_CAPACITY','The '+label+' has an invalid or unsupported byte count.',413);
  return value;
}
function selection(store,id,createdAt){
  if(!OP.test(id??'')||typeof createdAt!=='string'||!Number.isFinite(Date.parse(createdAt)))
    throw fault('TRANSFER_OPERATION','Use the original operation identity and its retained creation time.');
  const state=store.read();
  if(state.schema!==WORKSPACE_SCHEMA||!UUID.test(state.workspaceId??''))
    throw fault('TRANSFER_WORKSPACE','Use the original SensorThings kernel workspace.',409);
  return state.workspaceId;
}
function decodeRecord(bytes){
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  // The original exact scanner rejects duplicate keys and excessive depth.
  // Structural counters are then decoded as ordinary safe integers. Original
  // provider numeric lexemes travel unchanged in the binary source objects.
  parseExactJSON(text);
  return JSON.parse(text);
}
async function readRecord(path,maximum=TRANSFER_LIMITS.lineBytes){
  return decodeRecord(await readOwned(path,maximum));
}
export function validateSourceEdition(edition){
  if(!plain(edition)||edition.schema!==EDITION_SCHEMA||!HASH.test(edition.id??'')||
      !Array.isArray(edition.sourceFiles)||!Array.isArray(edition.pages)||!plain(edition.source)||
      !plain(edition.plan)||!Array.isArray(edition.plan.streams)||!Array.isArray(edition.streamMetadata)||
      !Array.isArray(edition.issues)||!plain(edition.scope)||edition.sourceFiles.length>TRANSFER_LIMITS.objects)
    throw fault('TRANSFER_EDITION','Retain the complete original source-edition manifest.',409);
  const {id,...body}=edition;
  if(identity(body)!==id||json(edition).length>TRANSFER_LIMITS.editionBytes)
    throw fault('TRANSFER_EDITION','The complete source edition differs from its identity or native capacity.',409);
  const byHash=new Map();
  for(const file of edition.sourceFiles){
    if(!plain(file)||!HASH.test(file.sha256??''))
      throw fault('TRANSFER_OBJECT','An original source object has no exact SHA256.',409);
    byteCount(file.bytes,TRANSFER_LIMITS.objectBytes,'original source object');
    const prior=byHash.get(file.sha256);
    if(prior&&prior.bytes!==file.bytes)
      throw fault('TRANSFER_OBJECT','The same source SHA has conflicting byte counts.',409);
    byHash.set(file.sha256,{sha256:file.sha256,bytes:file.bytes});
  }
  const bound=receipt=>{
    if(!plain(receipt)||!HASH.test(receipt.sha256??'')||
        byHash.get(receipt.sha256)?.bytes!==receipt.bytes)
      throw fault('TRANSFER_SOURCE_CLOSURE','An original source reference is absent from the declared complete closure.',409);
  };
  for(const page of edition.pages)bound(page.receipt);
  for(const stream of edition.plan?.streams??[])bound(stream.sourceRef);
  for(const metadata of edition.streamMetadata??[])bound(metadata.receipt);
  const members=[...byHash.values()].sort((a,b)=>a.sha256.localeCompare(b.sha256));
  byteCount(members.reduce((sum,m)=>sum+m.bytes,0),TRANSFER_LIMITS.sourceBytes,'complete original source closure');
  return members;
}

/** Open a host-selected immutable regular file. Caller owns the returned FD.
 * No caller path is accepted by the public file-selection API. */
export async function openPrivateFile(path,{expectedBytes,maximum=TRANSFER_LIMITS.archiveBytes}={}){
  if(await realpath(path)!==resolve(path))
    throw fault('RETAINED_PATH','Use the original canonical retained file.',409);
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try{
    const observed=await handle.stat({bigint:true});
    if(!observed.isFile()||typeof process.getuid!=='function'||
        observed.uid!==BigInt(process.getuid())||(observed.mode&0o077n)!==0n||
        observed.size<0n||observed.size>BigInt(maximum)||
        expectedBytes!==undefined&&observed.size!==BigInt(byteCount(expectedBytes,maximum,'retained file')))
      throw fault('RETAINED_FILE','The selected file changed type, ownership, access or declared size.',409);
    return {handle,identity:observed,bytes:Number(observed.size)};
  }catch(error){await handle.close();throw error;}
}
export async function hashHeldFile(handle,{expectedBytes,expectedSha256,maximum=TRANSFER_LIMITS.archiveBytes}={}){
  const before=await handle.stat({bigint:true});
  if(!before.isFile()||before.size<0n||before.size>BigInt(maximum))
    throw fault('RETAINED_FILE','The selected retained descriptor is not a supported regular file.',409);
  const bytes=Number(before.size);
  if(expectedBytes!==undefined&&bytes!==expectedBytes||expectedSha256!==undefined&&!HASH.test(expectedSha256))
    throw fault('RETAINED_IDENTITY','Use the complete original byte count and SHA256.',409);
  const digest=createHash('sha256'),buffer=Buffer.alloc(Math.min(BUFFER_BYTES,Math.max(bytes,1)));
  let offset=0;
  while(offset<bytes){
    const wanted=Math.min(buffer.length,bytes-offset),part=await handle.read(buffer,0,wanted,offset);
    if(!Number.isInteger(part.bytesRead)||part.bytesRead<1||part.bytesRead>wanted)
      throw fault('RETAINED_CHANGED','The original retained file ended before its declared length.',409);
    digest.update(buffer.subarray(0,part.bytesRead));offset+=part.bytesRead;
  }
  const after=await handle.stat({bigint:true}),sha256=digest.digest('hex');
  if(!same(before,after)||expectedSha256!==undefined&&sha256!==expectedSha256)
    throw fault('RETAINED_CHANGED','The complete retained bytes differ from their original identity.',409);
  return {bytes,sha256,identity:after};
}
export async function inspectRetainedFile(path,options={}){
  const selected=await openPrivateFile(path,options);
  try{
    const result=await hashHeldFile(selected.handle,options);
    return {bytes:result.bytes,sha256:result.sha256};
  }finally{await selected.handle.close();}
}
async function optionalRecord(path,maximum){
  try{return await readRecord(path,maximum);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function failedAttempt(path,record,error,partialPath){
  const failure={...record,state:'FAILED',failedAt:new Date().toISOString(),error:errorRecord(error)};
  if(partialPath)try{failure.partial={...(await inspectRetainedFile(partialPath)),complete:false};}catch{}
  // Preserve the original failure when a full disk also prevents this small
  // update. The already retained STARTED receipt and partial bytes remain.
  await atomicJSON(path,failure).catch(()=>{});
}
async function publishFile(path,target,expected){
  const selected=await openPrivateFile(path,{expectedBytes:expected.bytes});
  try{
    await hashHeldFile(selected.handle,{expectedBytes:expected.bytes,expectedSha256:expected.sha256});
    try{await link(path,target);await syncDir(join(target,'..'));}
    catch(error){if(error.code!=='EEXIST')throw error;}
    await inspectRetainedFile(target,{expectedBytes:expected.bytes,expectedSha256:expected.sha256});
  }finally{await selected.handle.close();}
}
async function retireMatched(path,target,expected){
  try{
    await inspectRetainedFile(path,{expectedBytes:expected.bytes,expectedSha256:expected.sha256});
    await inspectRetainedFile(target,{expectedBytes:expected.bytes,expectedSha256:expected.sha256});
    await unlink(path);await syncDir(join(path,'..'));
    return true;
  }catch(error){if(error.code==='ENOENT')return true;return false;}
}
function validateManifest(manifest){
  if(!plain(manifest)||manifest.schema!==TRANSFER_FORMAT||manifest.workspaceSchema!==WORKSPACE_SCHEMA||
      !UUID.test(manifest.originalWorkspaceId??'')||!Array.isArray(manifest.reviews)||
      manifest.reviews.some(r=>!plain(r)||r.editionId!==manifest.edition?.id))
    throw fault('TRANSFER_MANIFEST','The original transfer manifest or source review history is invalid.',409);
  const members=validateSourceEdition(manifest.edition);
  if(json(manifest).length>TRANSFER_LIMITS.lineBytes)throw fault('TRANSFER_MANIFEST_CAPACITY','The complete retained manifest exceeds its declared capacity.',413);
  if(stable(manifest.objects)!==stable(members))
    throw fault('TRANSFER_MANIFEST','The original member inventory differs from the edition closure.',409);
  return members;
}
function receiptFrom(plan,physical,filename){
  return {schema:'stellar-forge.sensorthings-transfer-receipt.v1',id:plan.id,kind:'source-edition',
    createdAt:plan.createdAt,editionId:plan.manifest.edition.id,originalWorkspaceId:plan.manifest.originalWorkspaceId,
    manifestSha256:plan.manifestSha256,objects:plan.manifest.objects.length,
    sourceBytes:plan.manifest.objects.reduce((sum,f)=>sum+f.bytes,0),
    file:{filename,type:'application/gzip',relativePath:'exports/'+plan.id+'/'+filename,...physical}};
}
async function verifyExportReceipt(receipt,plan,target,filename){
  const expected=receiptFrom(plan,{bytes:receipt.file?.bytes,sha256:receipt.file?.sha256},filename);
  if(stable(receipt)!==stable(expected)||!HASH.test(receipt.file?.sha256??''))
    throw fault('TRANSFER_CHANGED','The original transfer receipt differs from its frozen source selection.',409);
  await inspectRetainedFile(target,{expectedBytes:receipt.file.bytes,expectedSha256:receipt.file.sha256});
  return receipt;
}
export async function exportEdition(store,{edition,reviews,id,createdAt}){
  const workspaceId=selection(store,id,createdAt),members=validateSourceEdition(edition);
  if(!Array.isArray(reviews)||reviews.some(r=>!plain(r)))throw fault('TRANSFER_REVIEWS','Supply the original retained source review history.');
  const directory=join(store.root,'exports',id);
  await privateDirectory(directory,{create:true});
  const planPath=join(directory,'export-plan.json'),receiptPath=join(directory,'transfer.json'),
    candidatePath=join(directory,'completed-candidate.json');
  let plan=await optionalRecord(planPath);
  if(plan){
    if(plan.schema!=='stellar-forge.sensorthings-export-plan.v1'||plan.id!==id||plan.createdAt!==createdAt||
        plan.manifest?.originalWorkspaceId!==workspaceId||plan.manifest?.edition?.id!==edition.id||
        stable(plan.manifest.edition)!==stable(edition)||plan.manifestSha256!==identity(plan.manifest))
      throw fault('TRANSFER_CONFLICT','This original export operation belongs to another frozen selection.',409);
    validateManifest(plan.manifest);
  }else{
    const manifest={schema:TRANSFER_FORMAT,workspaceSchema:WORKSPACE_SCHEMA,originalWorkspaceId:workspaceId,
      edition:structuredClone(edition),reviews:structuredClone(reviews.filter(r=>r.editionId===edition.id)),objects:members,
      meaning:'Complete declared immutable source closure and original review history. Unfinished captures, seller processes and payment journals retain their existing owners.'};
    validateManifest(manifest);
    if(Buffer.byteLength(JSON.stringify({kind:'manifest',manifest})+'\n')>TRANSFER_LIMITS.lineBytes)
      throw fault('TRANSFER_MANIFEST_CAPACITY','The complete source manifest exceeds the declared transfer header capacity.',413);
    plan={schema:'stellar-forge.sensorthings-export-plan.v1',id,createdAt,manifestSha256:identity(manifest),manifest};
    const planBytes=json(plan);
    if(planBytes.length>TRANSFER_LIMITS.lineBytes)throw fault('TRANSFER_MANIFEST_CAPACITY','The frozen export selection exceeds the retained metadata capacity.',413);
    await store.immutable(planPath,planBytes);
  }
  const filename='sensorthings-'+edition.id.slice(0,16)+'-source.ndjson.gz',target=join(directory,filename);
  const retained=await optionalRecord(receiptPath);
  if(retained){
    await verifyExportReceipt(retained,plan,target,filename);
    const prior=await optionalRecord(candidatePath);
    if(prior?.temporaryName&&/^source-[a-f0-9-]{36}\.partial$/.test(prior.temporaryName))
      await retireMatched(join(directory,prior.temporaryName),target,retained.file);
    return retained;
  }
  let candidate=await optionalRecord(candidatePath);
  if(!candidate){
    const attemptId=randomUUID(),temporaryName='source-'+attemptId+'.partial',
      temporary=join(directory,temporaryName),attemptPath=join(directory,'export-attempt-'+attemptId+'.json'),
      started={schema:'stellar-forge.sensorthings-transfer-attempt.v1',direction:'export',id,attemptId,
        manifestSha256:plan.manifestSha256,createdAt:new Date().toISOString(),state:'STARTED',temporaryName};
    await store.immutable(attemptPath,json(started));
    let output;
    async function* lines(){
      yield Buffer.from(JSON.stringify({kind:'manifest',manifest:plan.manifest})+'\n');
      for(const member of plan.manifest.objects){
        const held=await openPrivateFile(join(store.root,'objects',member.sha256),
          {expectedBytes:member.bytes,maximum:TRANSFER_LIMITS.objectBytes});
        const digest=createHash('sha256'),buffer=Buffer.alloc(TRANSFER_LIMITS.chunkBytes);
        try{
          yield Buffer.from(JSON.stringify({kind:'object',...member})+'\n');
          let offset=0;
          while(offset<member.bytes){
            const count=Math.min(buffer.length,member.bytes-offset),part=await held.handle.read(buffer,0,count,offset);
            if(!part.bytesRead)throw fault('TRANSFER_OBJECT','The original source object ended early.',409);
            const body=buffer.subarray(0,part.bytesRead);digest.update(body);
            yield Buffer.from(JSON.stringify({kind:'chunk',sha256:member.sha256,offset,bytes:body.length,base64:body.toString('base64')})+'\n');
            offset+=body.length;
          }
          if(!same(held.identity,await held.handle.stat({bigint:true}))||digest.digest('hex')!==member.sha256)
            throw fault('TRANSFER_OBJECT','The held source object changed or differs from its complete SHA256.',409);
          yield Buffer.from(JSON.stringify({kind:'end',sha256:member.sha256,bytes:member.bytes})+'\n');
        }finally{await held.handle.close();}
      }
      yield Buffer.from(JSON.stringify({kind:'complete',manifestSha256:plan.manifestSha256,objects:plan.manifest.objects.length})+'\n');
    }
    try{
      output=await open(temporary,'wx',0o600);
      let compressedBytes=0;
      const bounded=new Transform({transform(chunk,encoding,done){
        compressedBytes+=chunk.length;
        if(compressedBytes>TRANSFER_LIMITS.archiveBytes)return done(fault('TRANSFER_CAPACITY','The compressed archive exceeds its declared capacity.',413));
        done(null,chunk);
      }});
      await pipeline(Readable.from(lines()),createGzip({level:6}),bounded,output.createWriteStream({autoClose:false}));
      await output.sync();await output.close();output=null;
      const physical=await inspectRetainedFile(temporary);
      candidate={schema:'stellar-forge.sensorthings-complete-transfer-candidate.v1',id,attemptId,
        manifestSha256:plan.manifestSha256,temporaryName,file:physical};
      await store.immutable(candidatePath,json(candidate));
      await atomicJSON(attemptPath,{...started,state:'COMPLETE',completedAt:new Date().toISOString(),file:physical});
    }catch(error){
      if(output)await output.close().catch(()=>{});
      await failedAttempt(attemptPath,started,error,temporary);throw error;
    }
  }
  if(candidate.schema!=='stellar-forge.sensorthings-complete-transfer-candidate.v1'||candidate.id!==id||
      candidate.manifestSha256!==plan.manifestSha256||!/^source-[a-f0-9-]{36}\.partial$/.test(candidate.temporaryName??'')||
      !HASH.test(candidate.file?.sha256??''))
    throw fault('TRANSFER_CANDIDATE','The original completed transfer candidate needs reconciliation.',409);
  byteCount(candidate.file.bytes,TRANSFER_LIMITS.archiveBytes,'complete archive');
  try{
    await inspectRetainedFile(target,{expectedBytes:candidate.file.bytes,expectedSha256:candidate.file.sha256});
  }catch(error){
    if(error.code!=='ENOENT')throw error;
    await publishFile(join(directory,candidate.temporaryName),target,candidate.file);
  }
  const receipt=receiptFrom(plan,candidate.file,filename);
  await store.immutable(receiptPath,json(receipt));
  await verifyExportReceipt(receipt,plan,target,filename);
  await retireMatched(join(directory,candidate.temporaryName),target,candidate.file);
  return receipt;
}
async function* archiveLines(handle){
  const unzip=createGunzip(),input=handle.createReadStream({autoClose:false,start:0});
  let produced=0,buffer=Buffer.alloc(0),failure=null;
  input.on('error',e=>unzip.destroy(e));
  unzip.on('error',e=>{failure=e;input.destroy();});
  input.pipe(unzip);
  try{
    for await(const chunk of unzip){
      produced+=chunk.length;
      if(produced>TRANSFER_LIMITS.expandedBytes)
        throw fault('TRANSFER_CAPACITY','The expanded archive exceeds the declared complete-transfer capacity.',413);
      buffer=buffer.length?Buffer.concat([buffer,chunk]):chunk;
      let end;
      while((end=buffer.indexOf(10))>=0){
        const line=buffer.subarray(0,end);buffer=buffer.subarray(end+1);
        if(!line.length||line.length>TRANSFER_LIMITS.lineBytes)
          throw fault('TRANSFER_LINE','An original archive line has an invalid length.',413);
        yield decodeRecord(line);
      }
      if(buffer.length>TRANSFER_LIMITS.lineBytes)
        throw fault('TRANSFER_LINE','An original archive line exceeds the declared capacity.',413);
    }
    if(failure)throw failure;
    if(buffer.length)throw fault('TRANSFER_TRUNCATED','The original archive ends inside a record.',409);
  }finally{unzip.destroy();input.destroy();}
}
async function verifyReceived(store,receipt,id,createdAt,archive,receivingWorkspaceId,directory){
  if(receipt.schema!=='stellar-forge.sensorthings-source-receiving.v1'||receipt.id!==id||
      receipt.createdAt!==createdAt||receipt.receivingWorkspaceId!==receivingWorkspaceId||
      stable(receipt.archive)!==stable(archive))
    throw fault('TRANSFER_CONFLICT','This original receiving operation belongs to another archive or workspace.',409);
  const manifest=await readRecord(join(directory,'original-transfer-manifest.json')),
    members=validateManifest(manifest),edition=await store.edition(receipt.editionId);
  if(manifest.edition.id!==receipt.editionId||receipt.manifestSha256!==identity(manifest)||
      stable(manifest.edition)!==stable(edition)||receipt.originalWorkspaceId!==manifest.originalWorkspaceId||
      stable(receipt.originalReviews)!==stable(manifest.reviews)||receipt.objects!==members.length||
      receipt.sourceBytes!==members.reduce((n,m)=>n+m.bytes,0)||receipt.reviewState!=='RECEIVING_REVIEW_REQUIRED')
    throw fault('TRANSFER_CHANGED','The retained receiving identity or source history changed.',409);
  for(const member of members)
    await inspectRetainedFile(join(store.root,'objects',member.sha256),
      {expectedBytes:member.bytes,expectedSha256:member.sha256,maximum:TRANSFER_LIMITS.objectBytes});
  return {receipt,manifest,members};
}
async function retireReceivedStaging(store,receipt,directory,members){
  const attemptId=receipt.receivingAttemptId;
  if(!UUID.test(attemptId??''))return 0;
  const attempt=join(directory,'attempt-'+attemptId),attemptPath=join(directory,'attempt-'+attemptId+'.json');
  let journal;
  try{
    journal=await readRecord(attemptPath,1024*1024);
    if(journal.id!==receipt.id||journal.attemptId!==attemptId||stable(journal.archive)!==stable(receipt.archive))return 0;
    await privateDirectory(attempt);
  }catch{return 0;}
  let retired=0;
  for(const member of members)
    if(await retireMatched(join(attempt,member.sha256),join(store.root,'objects',member.sha256),member))retired++;
  if(retired===members.length)await rmdir(attempt).catch(()=>{});
  await atomicJSON(attemptPath,{...journal,state:'COMPLETE',completedAt:journal.completedAt??new Date().toISOString(),
    manifestSha256:receipt.manifestSha256,editionId:receipt.editionId,objects:members.length,
    sourceBytes:receipt.sourceBytes,retiredVerifiedStagingObjects:retired}).catch(()=>{});
  return retired;
}
export async function importEdition(store,{inboxDirectory,filename,expectedSha256,expectedBytes,id,createdAt}){
  const receivingWorkspaceId=selection(store,id,createdAt);
  if(!inboxDirectory||typeof filename!=='string'||filename!==basename(filename)||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(filename)||!HASH.test(expectedSha256??'')||
      !Number.isSafeInteger(expectedBytes)||expectedBytes<1||expectedBytes>TRANSFER_LIMITS.archiveBytes)
    throw fault('TRANSFER_SELECTION','Choose the exact complete archive from the host-bound source inbox.');
  const archive={filename,bytes:expectedBytes,sha256:expectedSha256},
    directory=join(store.root,'receipts',id);
  await privateDirectory(directory,{create:true});
  const resultPath=join(directory,'source-receiving.json'),prior=await optionalRecord(resultPath);
  if(prior){
    const verified=await verifyReceived(store,prior,id,createdAt,archive,receivingWorkspaceId,directory);
    // A completed receive reopens from its retained objects and manifest even
    // after the host moves the original input archive out of its inbox.
    await retireReceivedStaging(store,verified.receipt,directory,verified.members);
    return verified.receipt;
  }
  await privateDirectory(inboxDirectory);
  const selected=await openPrivateFile(join(inboxDirectory,filename),{expectedBytes,maximum:TRANSFER_LIMITS.archiveBytes});
  const attemptId=randomUUID(),attemptName='attempt-'+attemptId,attempt=join(directory,attemptName),
    attemptPath=join(directory,attemptName+'.json'),started={schema:'stellar-forge.sensorthings-transfer-attempt.v1',
      direction:'import',id,attemptId,createdAt:new Date().toISOString(),state:'STARTED',archive};
  let current=null,manifest=null,members=null,memberIndex=0,complete=false,verifiedInput;
  try{
    verifiedInput=await hashHeldFile(selected.handle,{expectedBytes,expectedSha256});
    await privateDirectory(attempt,{create:true});await store.immutable(attemptPath,json(started));
    for await(const record of archiveLines(selected.handle)){
      if(!plain(record)||complete)throw fault('TRANSFER_ORDER','The original archive contains unexpected or trailing records.',409);
      if(!manifest){
        exactFields(record,['kind','manifest']);
        if(record.kind!=='manifest')throw fault('TRANSFER_FORMAT','The original transfer must begin with its complete manifest.',409);
        manifest=record.manifest;members=validateManifest(manifest);continue;
      }
      if(record.kind==='object'){
        exactFields(record,['kind','sha256','bytes']);
        const expected=members[memberIndex];
        if(current||!expected||record.sha256!==expected.sha256||record.bytes!==expected.bytes)
          throw fault('TRANSFER_ORDER','An original object is missing, repeated or out of order.',409);
        current={...expected,offset:0,hash:createHash('sha256'),file:await open(join(attempt,expected.sha256),'wx',0o600)};
        continue;
      }
      if(record.kind==='chunk'){
        exactFields(record,['kind','sha256','offset','bytes','base64']);
        if(!current||record.sha256!==current.sha256||record.offset!==current.offset||
            !Number.isSafeInteger(record.bytes)||record.bytes<1||record.bytes>TRANSFER_LIMITS.chunkBytes||
            typeof record.base64!=='string'||record.base64.length>4*Math.ceil(TRANSFER_LIMITS.chunkBytes/3)||
            !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(record.base64))
          throw fault('TRANSFER_CHUNK','An original source chunk has a missing or inconsistent range.',409);
        const bytes=Buffer.from(record.base64,'base64');
        if(bytes.length!==record.bytes||bytes.toString('base64')!==record.base64||current.offset+bytes.length>current.bytes)
          throw fault('TRANSFER_CHUNK','An original source chunk differs from its declared exact bytes.',409);
        await current.file.writeFile(bytes);current.hash.update(bytes);current.offset+=bytes.length;continue;
      }
      if(record.kind==='end'){
        exactFields(record,['kind','sha256','bytes']);
        if(!current||record.sha256!==current.sha256||record.bytes!==current.bytes||
            current.offset!==current.bytes||current.hash.digest('hex')!==current.sha256)
          throw fault('TRANSFER_OBJECT','A complete original source object failed its exact hash or byte count.',409);
        await current.file.sync();await current.file.close();current=null;memberIndex++;continue;
      }
      if(record.kind==='complete'){
        exactFields(record,['kind','manifestSha256','objects']);
        if(current||memberIndex!==members.length||record.objects!==members.length||record.manifestSha256!==identity(manifest))
          throw fault('TRANSFER_INCOMPLETE','The original archive lacks its exact completion record.',409);
        complete=true;continue;
      }
      throw fault('TRANSFER_RECORD','The original archive contains an unknown record kind.',409);
    }
    if(!complete)throw fault('TRANSFER_INCOMPLETE','The original archive ended before complete source verification.',409);
    if(!same(verifiedInput.identity,await selected.handle.stat({bigint:true})))
      throw fault('TRANSFER_CHANGED','The same original archive descriptor changed during receiving.',409);
    const manifestSha256=identity(manifest),sourceBytes=members.reduce((n,m)=>n+m.bytes,0);
    // The entire archive is verified before any edition becomes visible.
    // Same-filesystem links publish the exact staged bytes in the original CAS.
    // Existing objects are reused only after full bounded SHA/length readback.
    for(const member of members)
      await publishFile(join(attempt,member.sha256),join(store.root,'objects',member.sha256),member);
    await store.saveEdition(manifest.edition);
    await store.immutable(join(directory,'original-transfer-manifest.json'),json(manifest));
    const receipt={schema:'stellar-forge.sensorthings-source-receiving.v1',id,createdAt,editionId:manifest.edition.id,
      originalWorkspaceId:manifest.originalWorkspaceId,receivingWorkspaceId,receivingAttemptId:attemptId,archive,manifestSha256,objects:members.length,sourceBytes,
      originalReviews:manifest.reviews,reviewState:'RECEIVING_REVIEW_REQUIRED',
      scope:'Original immutable source objects and edition. Original reviews are evidence; local receiving review remains explicit. Existing capture, seller and payment state is not imported.'};
    await store.immutable(resultPath,json(receipt));
    await verifyReceived(store,receipt,id,createdAt,archive,receivingWorkspaceId,directory);
    // Completion is already immutable; cleanup cannot turn it into a failed receive.
    await retireReceivedStaging(store,receipt,directory,members);
    return receipt;
  }catch(error){
    if(current?.file){await current.file.close().catch(()=>{});current=null;}
    await failedAttempt(attemptPath,started,error);throw error;
  }finally{await selected.handle.close();}
}
