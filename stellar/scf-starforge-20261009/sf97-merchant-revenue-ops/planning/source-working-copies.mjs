// MIT. Shared create-only storage for source-bound merchant working copies.
import { constants } from 'node:fs';
import { mkdir,open,lstat,realpath,readdir,link,unlink } from 'node:fs/promises';
import { join,resolve,isAbsolute } from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { requireCompletedRestore } from '../economics/archive.mjs';


/** Domain adapters own every schema, document and source rule; this module owns publication. */
export function createSourceWorkingCopies(profile) {
  if(!profile || !/^[a-z][a-z0-9-]+$/.test(profile.directory) ||
      !['documentShape','summary','verifySource'].every(key=>typeof profile[key]==='function'))
    throw new TypeError('Use an original source-owned working-copy profile.');
  const SCHEMA=profile.recordSchema,PACKAGE=profile.packageSchema,documentShape=profile.documentShape;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const MAX=8*1024*1024;
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)
  ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const digest=value=>createHash('sha256').update(value).digest('hex');
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const fail=(code,message,status=422)=>Object.assign(new Error(message),{code,status});
function shape(value,keys,label) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))
    throw fail('WORKING_COPY_INVALID','Use the original '+label+' fields.');
}
async function privateDirectory(path,create=false) {
  if(create)await mkdir(path,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  const stat=await lstat(path);
  if(!stat.isDirectory()||(stat.mode&0o077)||await realpath(path)!==path)
    throw fail('PRIVATE_WORKING_DIRECTORY_REQUIRED','Use the original private merchant workspace.');
}
async function bytesAt(path) {
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try {
    const stat=await handle.stat();
    if(!stat.isFile()||(stat.mode&0o077)||stat.size>MAX)throw fail('WORKING_COPY_CHANGED','The retained working record has changed type, permissions or size.');
    const bytes=await handle.readFile();
    if(bytes.length>MAX)throw fail('WORKING_COPY_TOO_LARGE','A working record supports up to 8 MiB.');
    return bytes;
  }finally{await handle.close();}
}
async function syncDirectory(path){const file=await open(path,'r');try{await file.sync();}finally{await file.close();}}
function boundSource(value) {
  if(!value||!UUID.test(value.version??'')||!value.provenance||typeof value.provenance!=='object'||
      !HASH.test(value.provenance.seller??'')||!HASH.test(value.provenance.terms??'')||!HASH.test(value.provenance.snapshot??''))
    throw fail('WORKING_SOURCE_REQUIRED','Load an original saved pricing review before retaining unfinished work.');
  return {version:value.version,provenance:structuredClone(value.provenance)};
}

function summary(entry) { return profile.summary(entry); }

async function chain(directory,workingCopyId,{missing=false}={}) {
  if(!UUID.test(workingCopyId??''))throw fail('WORKING_COPY_NOT_FOUND','Choose an original saved working copy.',404);
  const home=join(directory,profile.directory,workingCopyId),folder=join(home,'successors');
  try{await privateDirectory(home);await privateDirectory(folder);}
  catch(error){if(missing&&error.code==='ENOENT')return [];throw error;}
  const entries=[];let previous=null,source=null;
  for(;;) {
    let bytes;
    try{bytes=await bytesAt(join(folder,(previous??'root')+'.json'));}
    catch(error){if(error.code==='ENOENT')return entries;throw error;}
    const envelope=JSON.parse(bytes.toString('utf8')),record=envelope.record,revision=envelope.sha256;
    if(!record||!HASH.test(revision??'')||digest(canonical(record))!==revision)
      throw fail('WORKING_COPY_CHANGED','The saved working record differs from its committed envelope.');
    if(record.schema!==SCHEMA||record.workingCopyId!==workingCopyId||record.previousRevision!==previous||
       !UUID.test(record.requestId??'')||!HASH.test(record.requestSha256??'')||typeof record.savedAt!=='string')
      throw fail('WORKING_COPY_CHANGED','A retained working revision no longer matches its original chain.');
    documentShape(record.document);
    if(!UUID.test(record.source?.version??'')||!record.source?.provenance||
        !['seller','terms','snapshot'].every(key=>HASH.test(record.source.provenance[key]??'')))
      throw fail('WORKING_COPY_CHANGED','The working revision has no complete original source binding.');
    if(source!==null&&canonical(record.source)!==source)
      throw fail('WORKING_SOURCE_CHANGED','An existing working copy cannot change its original review.');
    source=canonical(record.source);
    const expected=digest(canonical({workingCopyId,expectedRevision:record.previousRevision,source:record.source,
      document:record.document,receivedFrom:record.receivedFrom??null}));
    if(expected!==record.requestSha256)throw fail('WORKING_COPY_CHANGED','The retained working request has changed.');
    entries.push({record,revision,bytes,name:profile.directory+'/'+workingCopyId+'/successors/'+(previous??'root')+'.json'});
    previous=revision;
  }
}
async function captureBackup({directory}) {
  const folder=join(directory,profile.directory);let names;
  try{await privateDirectory(folder);names=await readdir(folder);}
  catch(error){if(error.code==='ENOENT')return {files:[],copies:[],pricingVersions:[]};throw error;}
  const files=[],copies=[],versions=new Set(),references=new Set();
  for(const id of names.filter(name=>UUID.test(name)).sort()) {
    const entries=await chain(directory,id);if(!entries.length)continue;
    for(const entry of entries) {
      const path=join(directory,...entry.name.split('/')),fileSha256=digest(entry.bytes);
      files.push({name:entry.name,read:async()=>{const bytes=await bytesAt(path);if(digest(bytes)!==fileSha256)
        throw fail('WORKING_BACKUP_CHANGED','A selected working revision changed during backup.',409);return bytes;}});
      versions.add(entry.record.source.version);
      for(const version of profile.dependencies?.(entry.record.document)??[])versions.add(version);
      for(const reference of profile.references?.(entry.record.document)??[])references.add(reference);
    }
    copies.push({...summary(entries.at(-1)),revisions:entries.length});
  }
  return {files,copies,pricingVersions:[...versions],...(profile.references?{references:[...references]}:{})};
}
async function openCopies({directory,source}={}) {
  if(!isAbsolute(directory??'')||resolve(directory)!==directory||directory==='/'||typeof source!=='function')
    throw fail('PRIVATE_WORKING_DIRECTORY_REQUIRED','Use the original private workspace and pricing source reader.');
  await privateDirectory(directory);await requireCompletedRestore(directory);
  const folder=join(directory,profile.directory),pending=join(folder,'pending');
  await privateDirectory(folder,true);await privateDirectory(pending,true);
  await syncDirectory(folder);await syncDirectory(directory);
  async function durableCopy(workingCopyId) {
    const home=join(folder,workingCopyId);
    await syncDirectory(join(home,'successors'));await syncDirectory(home);await syncDirectory(folder);
  }
  async function verifySource(binding,document,loaded) {
    const actual=loaded??await source(binding.version),current=boundSource(actual);
    if(canonical(current)!==canonical(binding))throw fail('WORKING_SOURCE_CHANGED','The original pricing review differs from this working copy.',409);
    await profile.verifySource({binding,document,actual,source});
    return actual;
  }
  async function list() {
    const rows=[];
    for(const id of (await readdir(folder)).filter(name=>UUID.test(name)).sort()) {
      const entries=await chain(directory,id);if(entries.length)rows.push(summary(entries.at(-1)));
    }
    rows.sort((a,b)=>b.savedAt.localeCompare(a.savedAt)||a.workingCopyId.localeCompare(b.workingCopyId));
    return {schema:profile.listSchema,total:rows.length,copies:rows};
  }
  async function load({workingCopyId,revision}={}) {
    const entries=await chain(directory,workingCopyId),entry=revision===undefined?entries.at(-1):entries.find(item=>item.revision===revision);
    if(!entry)throw fail('WORKING_COPY_NOT_FOUND','The selected original working revision is unavailable.',404);
    const original=await verifySource(entry.record.source,entry.record.document);
    return {schema:profile.stateSchema,...summary(entry),record:entry.record,
      latestRevision:entries.at(-1).revision,source:original,
      history:entries.map(item=>({...summary(item),requestId:item.record.requestId}))};
  }
  async function save(input) {
    shape(input,['workingCopyId','expectedRevision','requestId','version','sourceBinding','document','receivedFrom'],'working-copy save');
    if(!UUID.test(input.workingCopyId??'')||!UUID.test(input.requestId??'')||
        (input.expectedRevision!==null&&!HASH.test(input.expectedRevision??'')))
      throw fail('WORKING_COPY_SAVE_REQUIRED','Retain the working-copy ID, exact revision and same save request ID.');
    const document=documentShape(input.document);
    const receivedFrom=input.receivedFrom??null;
    if(receivedFrom!==null) {
      shape(receivedFrom,['workingCopyId','revision','packageSha256'],'received working-copy origin');
      if(!UUID.test(receivedFrom.workingCopyId??'')||!HASH.test(receivedFrom.revision??'')||!HASH.test(receivedFrom.packageSha256??''))
        throw fail('WORKING_COPY_INVALID','Keep the original received copy, revision and package identity.');
    }
    const original=await source(input.version),binding=boundSource(original);
    if(input.sourceBinding&&canonical(input.sourceBinding)!==canonical(binding))
      throw fail('WORKING_SOURCE_CHANGED','The selected original source differs from the received working copy.',409);
    await verifySource(binding,document,original);
    const request={workingCopyId:input.workingCopyId,expectedRevision:input.expectedRevision,source:binding,document,receivedFrom};
    const requestSha256=digest(canonical(request)),entries=await chain(directory,input.workingCopyId,{missing:true});
    async function recover(entry) {
      if(entry.record.requestSha256!==requestSha256)throw fail('WORKING_REQUEST_CHANGED','This save request already belongs to different unfinished inputs.',409);
      await durableCopy(input.workingCopyId);
      return {status:profile.savedStatus,recovered:true,...summary(entry),record:entry.record};
    }
    const prior=entries.find(entry=>entry.record.requestId===input.requestId);if(prior)return recover(prior);
    const latest=entries.at(-1);
    if((latest?.revision??null)!==input.expectedRevision)
      throw Object.assign(fail('WORKING_COPY_CONFLICT','Another saved revision exists. Keep these inputs as a new copy, or open the newer original before applying changes.',409),{latestRevision:latest?.revision??null});
    if(latest&&canonical(latest.record.source)!==canonical(binding))
      throw fail('WORKING_SOURCE_CHANGED','Save a new working copy when choosing another original pricing review.',409);
    const home=join(folder,input.workingCopyId),successors=join(home,'successors');
    await privateDirectory(home,true);await privateDirectory(successors,true);
    const record={schema:SCHEMA,workingCopyId:input.workingCopyId,previousRevision:input.expectedRevision,
      requestId:input.requestId,requestSha256,savedAt:new Date().toISOString(),source:binding,document,receivedFrom};
    const revision=digest(canonical(record)),bytes=encode({sha256:revision,record});if(bytes.length>MAX)throw fail('WORKING_COPY_TOO_LARGE','A working revision supports up to 8 MiB.');
    const staging=join(pending,randomUUID()+'.json'),target=join(successors,(input.expectedRevision??'root')+'.json');
    let handle;
    try {
      handle=await open(staging,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
      try{await link(staging,target);}
      catch(error) {
        if(error.code!=='EEXIST')throw error;
        const next=await chain(directory,input.workingCopyId),saved=next.find(entry=>entry.record.requestId===input.requestId);
        if(saved)return recover(saved);
        throw Object.assign(fail('WORKING_COPY_CONFLICT','Another save published first. Keep these inputs as a new copy or open the newer original.',409),{latestRevision:next.at(-1)?.revision??null});
      }
      await durableCopy(input.workingCopyId);
      return {status:profile.savedStatus,recovered:false,...summary({record,revision}),record};
    }finally{if(handle)await handle.close().catch(()=>{});await unlink(staging).catch(()=>{});}
  }
  async function exportCopy(input) {
    const loaded=await load(input),payload={record:loaded.record,revision:loaded.revision};
    return {schema:PACKAGE,sha256:digest(canonical(payload)),...payload};
  }
  async function importCopy({package:packet,workingCopyId,requestId}={}) {
    if(packet?.schema===profile.inputsSchema) {
      shape(packet,['schema','source','document'],'unfinished input package');
      return save({workingCopyId,requestId,expectedRevision:null,version:packet.source?.version,
        sourceBinding:packet.source,document:packet.document});
    }
    shape(packet,['schema','sha256','record','revision'],'working-copy package');
    if(packet.schema!==PACKAGE||!HASH.test(packet.sha256??'')||!HASH.test(packet.revision??'')||
        digest(canonical({record:packet.record,revision:packet.revision}))!==packet.sha256||
        digest(canonical(packet.record))!==packet.revision||packet.record?.schema!==SCHEMA)
      throw fail('WORKING_PACKAGE_CHANGED','The complete original working-copy package has changed.');
    if(workingCopyId===packet.record.workingCopyId)throw fail('WORKING_IMPORT_ID_REQUIRED','Receive this work under a new local working-copy identity.');
    return save({workingCopyId,requestId,expectedRevision:null,version:packet.record.source.version,
      sourceBinding:packet.record.source,document:packet.record.document,
      receivedFrom:{workingCopyId:packet.record.workingCopyId,revision:packet.revision,packageSha256:packet.sha256}});
  }
  return {list,load,save,exportCopy,importCopy};
}

  return Object.freeze({open:openCopies,captureBackup});
}
