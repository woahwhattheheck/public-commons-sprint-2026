// MIT. Complete original SF88 acquisitions inside a portable Directus project.
import {constants} from 'node:fs';
import {open,lstat,link,unlink} from 'node:fs/promises';
import {join,dirname,resolve,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {withLockedDatasetSession} from '../../sf88-operator-buyer-cli/dataset-session.mjs';
import {exportDatasetSessionArchive,inspectDatasetSessionArchive,receiveDatasetSessionArchive}
  from '../../sf88-operator-buyer-cli/dataset-session-portable.mjs';
import {resolveDatasetSessionPath} from '../../sf88-operator-buyer-cli/dataset-location.mjs';
import {canonical as canonicalBuyer} from '../../sf88-operator-buyer-cli/dataset-page.mjs';
import {operation as buyerOperation} from '../../sf88-operator-buyer-cli/config.mjs';
import {readPrivate,hashPrivate,privateDirectory,syncDirectory,MiB} from '../dspace/merchant-files.mjs';
import {canonical,hash,object,fault,MAX_SOURCE_BYTES} from './source.mjs';

export const DIRECTUS_SESSION_RECORD_SCHEMA='stellar-forge.directus-project-session.v1';
export const DIRECTUS_SESSION_CUSTODY_SCHEMA='stellar-forge.directus-buyer-session-custody.v1';
const KIND='buyer-sessions',HASH=/^[a-f0-9]{64}$/,ID=/^session-[a-f0-9]{64}$/;
const CHUNK=4*MiB,MAX_ARCHIVE=17*1024**3,DEFINITION_LIMIT=262144;
const identity=value=>hash(canonical(value));
const decode=raw=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
const need=(ok,code,message)=>{if(!ok)throw fault(code,message,409);};
const sameFile=(a,b)=>['dev','ino','size','mode','uid','gid','mtimeNs','ctimeNs'].every(key=>a[key]===b[key]);
const exactPath=value=>typeof value==='string'&&isAbsolute(value)&&resolve(value)===value&&!value.includes('\0');
const archiveOptions=({python,signal,maxBytes}={})=>
  Object.fromEntries(Object.entries({python,signal,maxBytes}).filter(([,value])=>value!==undefined));
const descriptor=(workspace,raw)=>({bytes:raw.length,sha256:workspace.blob(raw)});
const receivedDirectory=(workspace,id)=>join(workspace.directory,'project-runtime','sessions',id);
function bytesOf(workspace,entry,maximum=MAX_SOURCE_BYTES){
  need(object(entry)&&HASH.test(entry.sha256??'')&&Number.isSafeInteger(entry.bytes)&&
    entry.bytes>=0&&entry.bytes<=maximum,'DIRECTUS_SESSION_FILE','An original acquisition file identity is invalid.');
  const raw=workspace.bytes(entry.sha256);
  need(raw.length===entry.bytes&&hash(raw)===entry.sha256,
    'DIRECTUS_SESSION_FILE_CHANGED','An original acquisition file differs from its digest.');
  return raw;
}
function buyerOf(workspace,id){
  const buyer=workspace.get('buyer-configurations',id),unsigned={...buyer};delete unsigned.sha256;
  need(buyer.schema==='stellar-forge.directus-project-buyer.v1'&&
    buyer.workspace_id===workspace.meta('workspace_id')&&HASH.test(buyer.sha256??'')&&
    identity(unsigned)===buyer.sha256&&Array.isArray(buyer.files),
    'DIRECTUS_SESSION_BUYER','Select an original prepared buyer in this collection project.');
  const configs=buyer.files.filter(file=>file.path==='buyer.json');
  const selections=buyer.files.filter(file=>file.path==='selection.json');
  need(configs.length===1&&selections.length===1,
    'DIRECTUS_SESSION_CONFIGURATION','The original buyer configuration and selection are required.');
  const raw=bytesOf(workspace,configs[0],MiB),selected=decode(bytesOf(workspace,selections[0],MiB));
  const edition=workspace.get('editions',buyer.edition.id);
  need(hash(raw)===buyer.configuration_sha256&&
    selected.schema==='stellar-forge.directus-buyer-selection.v1'&&
    selected.configuration_sha256===buyer.configuration_sha256&&
    selected.edition?.workspace_id===buyer.workspace_id&&selected.edition.id===buyer.edition.id&&
    selected.edition.sha256===buyer.edition.sha256&&selected.edition.snapshot===buyer.edition.snapshot&&
    edition.sha256===buyer.edition.sha256&&edition.snapshot===buyer.edition.snapshot,
    'DIRECTUS_SESSION_CONFIGURATION','The prepared request differs from its selected collection edition.');
  const configuration=decode(raw);
  need(object(configuration),'DIRECTUS_SESSION_CONFIGURATION','The original buyer configuration must be an object.');
  return {buyer,configuration};
}
function definitionBinding(workspace,buyerId,raw,native){
  const {buyer,configuration}=buyerOf(workspace,buyerId),definition=decode(raw);
  need(object(definition)&&exactPath(native.sourceDirectory)&&
    hash(raw)===native.sessionSha256&&definition.directory===native.sourceDirectory&&
    HASH.test(native.configurationSha256??'')&&definition.configurationSha256===native.configurationSha256&&
    object(definition.config)&&hash(canonicalBuyer(definition.config))===native.configurationSha256&&
    definition.expectedSnapshot===buyer.edition.snapshot&&
    canonicalBuyer(buyerOperation(definition.config.operation))===canonicalBuyer(buyerOperation(configuration.operation)),
    'DIRECTUS_SESSION_SELECTION','The native acquisition differs from the original buyer request, terms or snapshot.');
  const inspection=native.inspection;
  need(object(inspection)&&inspection.directory===native.sourceDirectory&&
    inspection.configurationSha256===native.configurationSha256&&
    inspection.sessionId===definition.config.operation.intentId&&
    typeof inspection.sessionId==='string'&&inspection.sessionId.length>0&&
    (inspection.snapshot==null||inspection.snapshot===buyer.edition.snapshot)&&
    (inspection.expectedSnapshot==null||inspection.expectedSnapshot===buyer.edition.snapshot),
    'DIRECTUS_SESSION_INSPECTION','The original acquisition identity differs from its prepared buyer.');
  return {buyer,definition};
}
function validateRecord(workspace,record){
  const unsigned={...record};delete unsigned.sha256;
  need(object(record)&&record.schema===DIRECTUS_SESSION_RECORD_SCHEMA&&ID.test(record.id??'')&&
    record.workspace_id===workspace.meta('workspace_id')&&HASH.test(record.sha256??'')&&
    identity(unsigned)===record.sha256&&HASH.test(record.session_sha256??'')&&
    record.id==='session-'+identity({buyerId:record.buyer_id,sessionSha256:record.session_sha256})&&
    record.definition?.sha256===record.session_sha256&&
    record.relative==='project-runtime/sessions/'+record.id,
    'DIRECTUS_SESSION_RECORD','An original acquisition registration differs from its identity.');
  const raw=bytesOf(workspace,record.definition,DEFINITION_LIMIT);
  const {buyer}=definitionBinding(workspace,record.buyer_id,raw,{
    sourceDirectory:record.source_directory,sessionSha256:record.session_sha256,
    configurationSha256:record.configuration_sha256,inspection:{
      directory:record.source_directory,configurationSha256:record.configuration_sha256,
      sessionId:record.session_id,snapshot:record.snapshot,expectedSnapshot:record.snapshot}});
  need(record.buyer_sha256===buyer.sha256&&record.prepared_configuration_sha256===buyer.configuration_sha256&&
    record.snapshot===buyer.edition.snapshot,
    'DIRECTUS_SESSION_BUYER_CHANGED','The acquisition belongs to a different prepared buyer or edition.');
  return record;
}
function optionalRecord(workspace,id){
  try{return workspace.get(KIND,id);}catch(error){if(error.code==='DIRECTUS_RECORD_MISSING')return null;throw error;}
}
function locationOf(workspace,record){
  const location=workspace.meta('session_locations')?.[record.id];
  need(object(location)&&exactPath(location.directory),
    'DIRECTUS_SESSION_LOCATION','Receive or retain this original acquisition before exporting it.');
  return location.directory;
}

/** Caller holds the original workspace queue/lease. This records an existing
 * native acquisition; it creates no page, approval, signer or ledger operation. */
export async function registerDirectusBuyerSession(workspace,{buyerId,directory}={}){
  need(exactPath(directory),'DIRECTUS_SESSION_DIRECTORY','Supply the canonical original private session directory.');
  buyerOf(workspace,buyerId);
  const selected=await withLockedDatasetSession(directory,async source=>{
    const inspection=await source.inspect();
    const raw=await readPrivate(await resolveDatasetSessionPath(directory,join(source.directory,'session.json')),DEFINITION_LIMIT);
    const native={sourceDirectory:source.directory,sessionSha256:hash(raw),
      configurationSha256:source.definition.configurationSha256,inspection};
    const {buyer}=definitionBinding(workspace,buyerId,raw,native);
    return {raw,native,buyer};
  });
  const {raw,native,buyer}=selected;
  const id='session-'+identity({buyerId,sessionSha256:native.sessionSha256});
  const doc={schema:DIRECTUS_SESSION_RECORD_SCHEMA,id,workspace_id:workspace.meta('workspace_id'),
    buyer_id:buyer.id,buyer_sha256:buyer.sha256,prepared_configuration_sha256:buyer.configuration_sha256,
    session_id:native.inspection.sessionId,session_sha256:native.sessionSha256,
    configuration_sha256:native.configurationSha256,source_directory:native.sourceDirectory,
    snapshot:buyer.edition.snapshot,relative:'project-runtime/sessions/'+id,
    definition:{bytes:raw.length,sha256:hash(raw)}};
  const prior=optionalRecord(workspace,id),locations=workspace.meta('session_locations')??{};
  if(prior){
    validateRecord(workspace,prior);
    const original={...prior};delete original.created_at;delete original.sha256;
    need(identity(original)===identity(doc),'DIRECTUS_SESSION_RECORD_CHANGED','The original acquisition registration changed.');
    need(!locations[id]||locations[id].directory===directory,
      'DIRECTUS_SESSION_LOCATION_CHANGED','Use the retained current acquisition location for this original session.');
    if(locations[id])return prior;
  }
  workspace.db.exec('BEGIN IMMEDIATE');
  try{
    need(workspace.blob(raw)===doc.definition.sha256,
      'DIRECTUS_SESSION_DEFINITION_CHANGED','The original native definition changed during registration.');
    if(!prior){doc.created_at=new Date().toISOString();doc.sha256=identity(doc);workspace.put(KIND,doc);}
    locations[id]={directory};
    workspace.setMeta('session_locations',locations);
    workspace.setMeta('revision',workspace.revision()+1);
    workspace.db.exec('COMMIT');
  }catch(error){workspace.db.exec('ROLLBACK');throw error;}
  return prior??doc;
}

export function directusBuyerSessionLocations(workspace){
  const out=[];
  for(const small of workspace.list(KIND)){
    const record=validateRecord(workspace,workspace.get(KIND,small.id));
    const location=workspace.meta('session_locations')?.[record.id];
    if(location)out.push({id:record.id,buyerId:record.buyer_id,sessionId:record.session_id,
      sourceDirectory:record.source_directory,configurationSha256:record.configuration_sha256,
      preparedConfigurationSha256:record.prepared_configuration_sha256,snapshot:record.snapshot,
      directory:locationOf(workspace,record)});
  }
  return out;
}
async function retainArchive(workspace,file,native){
  need(Number.isSafeInteger(native.archiveBytes)&&native.archiveBytes>0&&native.archiveBytes<=MAX_ARCHIVE&&
    HASH.test(native.archiveSha256??''),'DIRECTUS_SESSION_ARCHIVE','The native session archive is incomplete.');
  const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const chunks=[],digest=createHash('sha256');let offset=0;
  try{
    const before=await handle.stat({bigint:true});
    need(before.isFile()&&before.nlink===1n&&(before.mode&0o077n)===0n&&
      before.uid===BigInt(process.getuid())&&before.size===BigInt(native.archiveBytes),
      'DIRECTUS_SESSION_ARCHIVE_FILE','The original private archive changed before capture.');
    while(offset<native.archiveBytes){
      const buffer=Buffer.allocUnsafe(Math.min(CHUNK,native.archiveBytes-offset));
      let filled=0;
      while(filled<buffer.length){
        const {bytesRead}=await handle.read(buffer,filled,buffer.length-filled,offset+filled);
        need(bytesRead>0,'DIRECTUS_SESSION_ARCHIVE_SHORT','The original acquisition archive ended early.');
        filled+=bytesRead;
      }
      digest.update(buffer);chunks.push({offset,...descriptor(workspace,buffer)});offset+=filled;
    }
    need(sameFile(before,await handle.stat({bigint:true}))&&digest.digest('hex')===native.archiveSha256,
      'DIRECTUS_SESSION_ARCHIVE_CHANGED','The original archive changed while entering the project.');
  }finally{await handle.close();}
  return {bytes:offset,sha256:native.archiveSha256,chunks};
}
function validateArchive(workspace,archive){
  need(object(archive)&&Number.isSafeInteger(archive.bytes)&&archive.bytes>0&&archive.bytes<=MAX_ARCHIVE&&
    HASH.test(archive.sha256??'')&&Array.isArray(archive.chunks)&&archive.chunks.length>0,
    'DIRECTUS_SESSION_ARCHIVE','A complete retained session archive is required.');
  const digest=createHash('sha256');let offset=0;
  for(const chunk of archive.chunks){
    need(object(chunk)&&chunk.offset===offset&&Number.isSafeInteger(chunk.bytes)&&chunk.bytes>0&&
      chunk.bytes<=CHUNK&&offset+chunk.bytes<=archive.bytes,
      'DIRECTUS_SESSION_CHUNKS','The original archive chunk sequence differs.');
    const raw=bytesOf(workspace,chunk,CHUNK);digest.update(raw);offset+=raw.length;
  }
  need(offset===archive.bytes&&digest.digest('hex')===archive.sha256,
    'DIRECTUS_SESSION_ARCHIVE_CHANGED','The complete retained archive failed its digest.');
}
function nativeBinding(workspace,record,entry){
  const native=entry.native;
  need(object(native)&&native.schema==='stellar-forge.sf88.dataset-session-archive.v1'&&
    HASH.test(native.manifestSha256??'')&&native.sourceDirectory===record.source_directory&&
    native.sessionSha256===record.session_sha256&&native.configurationSha256===record.configuration_sha256&&
    Number.isSafeInteger(native.sourceBytes)&&native.sourceBytes>0&&
    Number.isSafeInteger(native.files)&&native.files>=1&&Number.isSafeInteger(native.directories)&&native.directories>=0,
    'DIRECTUS_SESSION_NATIVE_IDENTITY','The original native archive metadata differs.');
  const inspectionRaw=bytesOf(workspace,entry.inspection);
  const inspection=decode(inspectionRaw);
  definitionBinding(workspace,record.buyer_id,bytesOf(workspace,record.definition,DEFINITION_LIMIT),{...native,inspection});
  need(inspection.sessionId===record.session_id,
    'DIRECTUS_SESSION_NATIVE_IDENTITY','The original session ID differs from its registered acquisition.');
  return inspection;
}

/** Select a new frozen SF88 export on every new project capture. Reusing a native
 * export path would preserve its old pages, so each capture owns a fresh UUID.
 * The caller atomically saves this returned document with its project metadata. */
export async function captureDirectusBuyerSessions(workspace,settings={}){
  settings=archiveOptions(settings);
  const captureId=randomUUID(),workspaceId=workspace.meta('workspace_id');
  const root=join(workspace.directory,'session-transfers',captureId),sessions=[];
  await privateDirectory(root,true);
  for(const small of workspace.list(KIND)){
    const record=validateRecord(workspace,workspace.get(KIND,small.id)),directory=locationOf(workspace,record);
    const archive=join(root,record.id+'.zip');
    const operation='directus-export-'+identity({workspaceId,captureId,sessionId:record.id}).slice(0,48);
    const native=await exportDatasetSessionArchive({directory,archive,operation,...settings});
    const raw=await readPrivate(await resolveDatasetSessionPath(directory,join(native.sourceDirectory,'session.json')),DEFINITION_LIMIT);
    definitionBinding(workspace,record.buyer_id,raw,native);
    need(hash(raw)===record.session_sha256&&native.inspection.sessionId===record.session_id,
      'DIRECTUS_SESSION_DEFINITION_CHANGED','The current native session differs from its registered acquisition.');
    const captured=await retainArchive(workspace,archive,native);
    const inspectionRaw=Buffer.from(canonicalBuyer(native.inspection));
    need(inspectionRaw.length<=MAX_SOURCE_BYTES,'DIRECTUS_SESSION_INSPECTION_LIMIT','The original native inspection exceeds its project member limit.');
    sessions.push({id:record.id,recordSha256:record.sha256,buyerId:record.buyer_id,
      archive:captured,inspection:descriptor(workspace,inspectionRaw),
      native:{schema:native.schema,manifestSha256:native.manifestSha256,sourceDirectory:native.sourceDirectory,
        sessionSha256:native.sessionSha256,configurationSha256:native.configurationSha256,
        sourceBytes:native.sourceBytes,files:native.files,directories:native.directories}});
  }
  const value={schema:DIRECTUS_SESSION_CUSTODY_SCHEMA,workspaceId,captureId,
    capturedAt:new Date().toISOString(),sessions};
  value.sha256=identity(value);validateDirectusBuyerSessions(workspace,value);
  return value;
}

export function validateDirectusBuyerSessions(workspace,value,{allowAdditionalSessions=false}={}){
  const records=new Map(workspace.list(KIND).map(small=>{
    const record=validateRecord(workspace,workspace.get(KIND,small.id));return [record.id,record];
  }));
  if(value===null||value===undefined){
    need(records.size===0,'DIRECTUS_SESSION_CUSTODY_MISSING','The project is missing its registered original acquisitions.');
    return null;
  }
  const {sha256,...unsigned}=value;
  need(object(value)&&value.schema===DIRECTUS_SESSION_CUSTODY_SCHEMA&&value.workspaceId===workspace.meta('workspace_id')&&
    HASH.test(sha256??'')&&identity(unsigned)===sha256&&Array.isArray(value.sessions),
    'DIRECTUS_SESSION_CUSTODY','The original project session custody differs.');
  const seen=new Set();
  for(const entry of value.sessions){
    need(object(entry)&&ID.test(entry.id??'')&&!seen.has(entry.id)&&records.has(entry.id),
      'DIRECTUS_SESSION_CUSTODY','An original session is unknown or duplicated.');
    seen.add(entry.id);const record=records.get(entry.id);
    need(entry.recordSha256===record.sha256&&entry.buyerId===record.buyer_id,
      'DIRECTUS_SESSION_RECORD_CHANGED','The archived session belongs to another registered buyer.');
    nativeBinding(workspace,record,entry);validateArchive(workspace,entry.archive);
  }
  if(!allowAdditionalSessions)need(seen.size===records.size,
    'DIRECTUS_SESSION_CUSTODY_INCOMPLETE','The complete project must include every registered acquisition.');
  return value;
}
async function materializeArchive(workspace,root,archive){
  await privateDirectory(root,true);const file=join(root,archive.sha256+'.zip');
  try{
    const previous=await hashPrivate(file,MAX_ARCHIVE);
    need(previous.bytes===archive.bytes&&previous.hash===archive.sha256,
      'DIRECTUS_SESSION_ARCHIVE_CHANGED','The retained receiving archive differs.');
    return file;
  }catch(error){if(error.code!=='ENOENT')throw error;}
  const temporary=join(root,'.archive-'+randomUUID());let handle,created;
  try{
    handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    created=await handle.stat({bigint:true});
    for(const chunk of archive.chunks){
      const raw=bytesOf(workspace,chunk,CHUNK);let offset=0;
      while(offset<raw.length){
        const {bytesWritten}=await handle.write(raw,offset,raw.length-offset,null);
        need(bytesWritten>0,'DIRECTUS_SESSION_ARCHIVE_WRITE','The received archive write made no progress.');
        offset+=bytesWritten;
      }
    }
    await handle.sync();await handle.close();handle=null;
    const actual=await hashPrivate(temporary,MAX_ARCHIVE);
    need(actual.bytes===archive.bytes&&actual.hash===archive.sha256,
      'DIRECTUS_SESSION_ARCHIVE_CHANGED','The written original archive differs.');
    try{await link(temporary,file);}catch(error){
      if(error.code!=='EEXIST')throw error;
      const previous=await hashPrivate(file,MAX_ARCHIVE);
      need(previous.bytes===archive.bytes&&previous.hash===archive.sha256,
        'DIRECTUS_SESSION_ARCHIVE_CHANGED','Another archive occupies the receiving path.');
    }
    await syncDirectory(root);return file;
  }finally{
    await handle?.close();
    if(created)try{const current=await lstat(temporary,{bigint:true});
      if(current.dev===created.dev&&current.ino===created.ino&&current.isFile())await unlink(temporary);
    }catch(error){if(error.code!=='ENOENT')throw error;}
  }
}

/** Reopen the original portable SF88 acquisition under its explicit storage map.
 * The incoming project SHA, not the latest re-exported custody, selects a receive.
 * Once completed, the same incoming project reopens current native progress. */
export async function restoreDirectusBuyerSessions(workspace,value,{sourceArchiveSha256,...settings}={}){
  settings=archiveOptions(settings);
  need(HASH.test(sourceArchiveSha256??''),'DIRECTUS_SESSION_SOURCE_ARCHIVE','Supply the exact incoming project archive digest.');
  const completed=workspace.meta('receiving_sessions');
  if(completed?.sourceArchiveSha256===sourceArchiveSha256){
    const completedUnsigned={...completed};delete completedUnsigned.sha256;
    need(completed.schema==='stellar-forge.directus-session-receiving.v1'&&
      HASH.test(completed.sha256??'')&&identity(completedUnsigned)===completed.sha256&&
      completed.workspaceId===workspace.meta('workspace_id')&&Array.isArray(completed.sessions),
      'DIRECTUS_SESSION_RECEIVING','The retained original session receiving marker differs.');
    const restored=[],seen=new Set();
    for(const item of completed.sessions){
      need(object(item)&&ID.test(item.id??'')&&!seen.has(item.id),
        'DIRECTUS_SESSION_RECEIVING','The original received session list is invalid.');
      seen.add(item.id);
      const record=validateRecord(workspace,workspace.get(KIND,item.id)),directory=locationOf(workspace,record);
      need(item.directory===directory&&item.recordSha256===record.sha256,
        'DIRECTUS_SESSION_RECEIVING','The original receiving session location changed.');
      const current=await withLockedDatasetSession(directory,async source=>{
        const inspection=await source.inspect();
        const raw=await readPrivate(await resolveDatasetSessionPath(directory,join(source.directory,'session.json')),DEFINITION_LIMIT);
        definitionBinding(workspace,record.buyer_id,raw,{sourceDirectory:source.directory,
          sessionSha256:hash(raw),configurationSha256:source.definition.configurationSha256,inspection});
        need(hash(raw)===record.session_sha256&&inspection.sessionId===record.session_id,
          'DIRECTUS_SESSION_RECEIVING','The original received acquisition changed identity.');
        return inspection;
      },{recoverDead:true});
      restored.push({id:record.id,buyerId:record.buyer_id,directory,sourceDirectory:record.source_directory,
        sessionId:current.sessionId,configurationSha256:current.configurationSha256,status:current.status,
        completedPages:current.completedPages,acquiredRows:current.acquiredRows,reused:true});
    }
    return restored;
  }
  need(completed===null||completed===undefined,'DIRECTUS_SESSION_RECEIVING_SOURCE','This project retains another incoming session selection.');
  validateDirectusBuyerSessions(workspace,value);
  if(!value)return [];
  const restored=[],locations=workspace.meta('session_locations')??{};
  for(const entry of value.sessions){
    const record=validateRecord(workspace,workspace.get(KIND,entry.id));
    const archive=await materializeArchive(workspace,join(workspace.directory,'session-transfers','received'),entry.archive);
    const inspected=await inspectDatasetSessionArchive({archive,expectedSha256:entry.archive.sha256,...settings});
    need(inspected.archiveBytes===entry.archive.bytes&&inspected.manifestSha256===entry.native.manifestSha256&&
      inspected.sessionSha256===record.session_sha256&&inspected.configurationSha256===record.configuration_sha256&&
      inspected.sourceDirectory===record.source_directory&&inspected.inspection.sessionId===record.session_id&&
      hash(canonicalBuyer(inspected.inspection))===entry.inspection.sha256,
      'DIRECTUS_SESSION_NATIVE_ARCHIVE','The original archive or its frozen native inspection differs.');
    definitionBinding(workspace,record.buyer_id,bytesOf(workspace,record.definition,DEFINITION_LIMIT),inspected);
    const directory=receivedDirectory(workspace,record.id);await privateDirectory(dirname(directory),true);
    const operation='directus-receive-'+identity({workspaceId:value.workspaceId,sourceArchiveSha256,
      sessionId:record.id,archiveSha256:entry.archive.sha256}).slice(0,48);
    const result=await receiveDatasetSessionArchive({archive,directory,expectedSha256:entry.archive.sha256,operation,...settings});
    need(result.session.sessionId===record.session_id&&result.session.configurationSha256===record.configuration_sha256,
      'DIRECTUS_SESSION_RECEIVING_CHANGED','The original session changed identity during receiving.');
    locations[record.id]={directory};
    restored.push({id:record.id,buyerId:record.buyer_id,directory,sourceDirectory:record.source_directory,
      archiveSha256:entry.archive.sha256,sessionId:result.session.sessionId,
      configurationSha256:result.session.configurationSha256,status:result.session.status,
      completedPages:result.session.completedPages,acquiredRows:result.session.acquiredRows,reused:result.reused??false});
  }
  workspace.db.exec('BEGIN IMMEDIATE');
  try{
    workspace.setMeta('session_locations',locations);
    const marker={schema:'stellar-forge.directus-session-receiving.v1',
      workspaceId:value.workspaceId,sourceArchiveSha256,custodySha256:value.sha256,
      sessions:restored.map(item=>({id:item.id,directory:item.directory,
        recordSha256:workspace.get(KIND,item.id).sha256}))};
    marker.sha256=identity(marker);workspace.setMeta('receiving_sessions',marker);
    workspace.db.exec('COMMIT');
  }catch(error){workspace.db.exec('ROLLBACK');throw error;}
  return restored;
}
