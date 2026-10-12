// MIT. Complete original SF88 acquisition custody inside a Superset project.
import {constants} from 'node:fs';
import {open,lstat,link,unlink} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {exportDatasetSessionArchive,inspectDatasetSessionArchive,receiveDatasetSessionArchive}
  from '../../sf88-operator-buyer-cli/dataset-session-portable.mjs';
import {resolveDatasetSessionPath} from '../../sf88-operator-buyer-cli/dataset-location.mjs';
import {canonical as canonicalBuyer} from '../../sf88-operator-buyer-cli/dataset-page.mjs';
import {operation as buyerOperation} from '../../sf88-operator-buyer-cli/config.mjs';
import {object,identity,digest,readPrivate,hashPrivate,privateDirectory,syncDirectory,fault,MiB} from './files.mjs';

export const SUPERSET_SESSION_CUSTODY_SCHEMA='stellar-forge.superset-buyer-session-custody.v1';
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/,HASH=/^[a-f0-9]{64}$/;
const CHUNK=4*MiB,MAX_ARCHIVE=2*1024*MiB;
const need=(value,code,message)=>{if(!value)throw fault(code,message,409);};
const decode=raw=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
const sameFile=(a,b)=>['dev','ino','size','mode','uid','gid','mtimeNs','ctimeNs'].every(key=>a[key]===b[key]);
const located=(workspace,buyer)=>join(workspace.directory,'buyers',buyer.id,'session');
const archiveOptions=({python,signal,maxBytes}={})=>Object.fromEntries(Object.entries({python,signal,maxBytes}).filter(([,value])=>value!==undefined));
function selectedBuyer(workspace,buyer){
  need(ID.test(buyer.id??'')&&buyer.relative==='buyers/'+buyer.id&&
    HASH.test(buyer.sha256??'')&&HASH.test(buyer.configurationSha256??''),
    'SUPERSET_SESSION_BUYER','The original buyer selection is invalid.');
  const configRaw=workspace.bytes(buyer.configurationSha256);
  need(configRaw.length===buyer.configuration?.bytes&&digest(configRaw)===buyer.configuration.sha256,
    'SUPERSET_SESSION_CONFIGURATION','The original prepared buyer configuration differs.');
  return decode(configRaw);
}
function definitionBinding(workspace,buyer,raw,native){
  const definition=decode(raw),prepared=selectedBuyer(workspace,buyer);
  need(digest(raw)===native.sessionSha256&&definition.directory===native.sourceDirectory&&
    definition.configurationSha256===native.configurationSha256&&object(definition.config)&&
    digest(canonicalBuyer(definition.config))===native.configurationSha256&&
    definition.expectedSnapshot===buyer.snapshot&&
    canonicalBuyer(buyerOperation(definition.config.operation))===canonicalBuyer(buyerOperation(prepared.operation)),
    'SUPERSET_SESSION_SELECTION','The original acquisition differs from the prepared request, terms or snapshot.');
  const report=native.inspection;
  need(object(report)&&report.directory===native.sourceDirectory&&
    report.configurationSha256===native.configurationSha256&&typeof report.sessionId==='string'&&report.sessionId.length>0&&
    (report.snapshot==null||report.snapshot===buyer.snapshot),
    'SUPERSET_SESSION_INSPECTION','The original native acquisition identity differs.');
  return definition;
}
async function retainArchive(workspace,file,expected){
  const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  const chunks=[],hash=createHash('sha256');let offset=0;
  try{
    const before=await handle.stat({bigint:true});
    need(before.isFile()&&before.nlink===1n&&(before.mode&0o077n)===0n&&
      before.uid===BigInt(process.getuid())&&before.size===BigInt(expected.archiveBytes)&&
      before.size>0n&&before.size<=BigInt(MAX_ARCHIVE),
      'SUPERSET_SESSION_ARCHIVE_FILE','The original private session archive has changed.');
    while(offset<expected.archiveBytes){
      const buffer=Buffer.allocUnsafe(Math.min(CHUNK,expected.archiveBytes-offset));
      const {bytesRead}=await handle.read(buffer,0,buffer.length,null);
      need(bytesRead>0,'SUPERSET_SESSION_ARCHIVE_SHORT','The original session archive ended early.');
      const raw=buffer.subarray(0,bytesRead);hash.update(raw);
      chunks.push({offset,...workspace.blob(raw)});offset+=bytesRead;
    }
    need(sameFile(before,await handle.stat({bigint:true}))&&
      hash.digest('hex')===expected.archiveSha256,
      'SUPERSET_SESSION_ARCHIVE_CHANGED','The original session archive changed during capture.');
  }finally{await handle.close();}
  return{bytes:offset,sha256:expected.archiveSha256,chunks};
}

/** Every new project export selects a new frozen snapshot. Original SF88 owns
 * each stable archive operation, source lease, history and interruption state. */
export async function captureSupersetBuyerSessions(workspace,settings={}){
  settings=archiveOptions(settings);
  const captureId=randomUUID(),workspaceId=workspace.meta('workspace_id');
  const root=join(workspace.directory,'session-transfers',captureId);
  await privateDirectory(root,true);
  const buyers=[];
  for(const summary of workspace.list('buyers')){
    const buyer=workspace.get('buyers',summary.id);selectedBuyer(workspace,buyer);
    const entry={buyerId:buyer.id,buyerSha256:buyer.sha256,
      preparedConfigurationSha256:buyer.configurationSha256,relative:buyer.relative+'/session',initialized:false};
    const directory=located(workspace,buyer);
    let info;try{info=await lstat(directory);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(!info){buyers.push(entry);continue;}
    need(info.isDirectory()&&!info.isSymbolicLink(),
      'SUPERSET_SESSION_DIRECTORY','Use the original private buyer session directory.');
    const archive=join(root,buyer.id+'.zip');
    const operation='superset-export-'+identity({workspaceId,captureId,buyerId:buyer.id}).slice(0,48);
    const native=await exportDatasetSessionArchive({directory,archive,operation,...settings});
    const raw=await readPrivate(await resolveDatasetSessionPath(directory,join(native.sourceDirectory,'session.json')),262144);
    definitionBinding(workspace,buyer,raw,native);
    const archiveBytes=await retainArchive(workspace,archive,native);
    buyers.push({...entry,initialized:true,archive:archiveBytes,definition:workspace.blob(raw),
      native:{schema:native.schema,manifestSha256:native.manifestSha256,sourceDirectory:native.sourceDirectory,
        sessionSha256:native.sessionSha256,configurationSha256:native.configurationSha256,
        sessionId:native.inspection.sessionId,status:native.inspection.status,
        completedPages:native.inspection.completedPages,acquiredRows:native.inspection.acquiredRows,
        totalRows:native.inspection.totalRows,snapshot:native.inspection.snapshot,
        sourceBytes:native.sourceBytes,files:native.files,directories:native.directories}});
  }
  const value={schema:SUPERSET_SESSION_CUSTODY_SCHEMA,workspaceId,captureId,
    capturedAt:new Date().toISOString(),buyers};
  value.sha256=identity(value);validateSupersetBuyerSessions(workspace,value);
  return value;
}
function archiveBytes(workspace,archive){
  need(object(archive)&&Number.isSafeInteger(archive.bytes)&&archive.bytes>0&&archive.bytes<=MAX_ARCHIVE&&
    HASH.test(archive.sha256??'')&&Array.isArray(archive.chunks)&&archive.chunks.length>0,
    'SUPERSET_SESSION_ARCHIVE','A complete original session archive is required.');
  const hash=createHash('sha256');let offset=0;
  for(const chunk of archive.chunks){
    need(object(chunk)&&chunk.offset===offset&&Number.isSafeInteger(chunk.bytes)&&chunk.bytes>0&&chunk.bytes<=CHUNK&&
      HASH.test(chunk.sha256??'')&&offset+chunk.bytes<=archive.bytes,
      'SUPERSET_SESSION_CHUNKS','The original archive chunk sequence differs.');
    const raw=workspace.bytes(chunk.sha256);
    need(raw.length===chunk.bytes,'SUPERSET_SESSION_CHUNKS','An original archive chunk changed.');
    hash.update(raw);offset+=raw.length;
  }
  need(offset===archive.bytes&&hash.digest('hex')===archive.sha256,
    'SUPERSET_SESSION_ARCHIVE_CHANGED','The complete retained session archive failed its digest.');
}
export function validateSupersetBuyerSessions(workspace,value,{allowAdditionalBuyers=false}={}){
  if(value===null||value===undefined)return null;
  const {sha256,...unsigned}=value;
  need(value.schema===SUPERSET_SESSION_CUSTODY_SCHEMA&&value.workspaceId===workspace.meta('workspace_id')&&
    HASH.test(sha256??'')&&identity(unsigned)===sha256&&Array.isArray(value.buyers),
    'SUPERSET_SESSION_CUSTODY','The original project acquisition custody differs.');
  const ids=new Set();
  for(const entry of value.buyers){
    need(object(entry)&&ID.test(entry.buyerId??'')&&!ids.has(entry.buyerId)&&typeof entry.initialized==='boolean',
      'SUPERSET_SESSION_CUSTODY','An original buyer session selection is invalid.');
    ids.add(entry.buyerId);
    const buyer=workspace.get('buyers',entry.buyerId);
    need(buyer.sha256===entry.buyerSha256&&buyer.configurationSha256===entry.preparedConfigurationSha256&&
      entry.relative===buyer.relative+'/session',
      'SUPERSET_SESSION_BUYER_CHANGED','The retained acquisition belongs to another prepared buyer.');
    selectedBuyer(workspace,buyer);
    if(!entry.initialized)continue;
    const native=entry.native;
    need(object(native)&&native.schema==='stellar-forge.sf88.dataset-session-archive.v1'&&
      HASH.test(native.manifestSha256??'')&&HASH.test(native.sessionSha256??'')&&
      HASH.test(native.configurationSha256??'')&&object(entry.definition)&&
      entry.definition.sha256===native.sessionSha256,
      'SUPERSET_SESSION_NATIVE_IDENTITY','The original native session identities are invalid.');
    const raw=workspace.bytes(entry.definition.sha256);
    need(raw.length===entry.definition.bytes,'SUPERSET_SESSION_DEFINITION','The frozen native definition changed.');
    definitionBinding(workspace,buyer,raw,{...native,inspection:{directory:native.sourceDirectory,
      configurationSha256:native.configurationSha256,sessionId:native.sessionId,snapshot:native.snapshot}});
    archiveBytes(workspace,entry.archive);
  }
  if(!allowAdditionalBuyers)need(ids.size===workspace.list('buyers').length,
    'SUPERSET_SESSION_CUSTODY_INCOMPLETE','The complete project must account for every original buyer.');
  return value;
}
async function materializeArchive(workspace,root,archive){
  await privateDirectory(root,true);const file=join(root,archive.sha256+'.zip');
  try{
    const prior=await hashPrivate(file,MAX_ARCHIVE);
    need(prior.bytes===archive.bytes&&prior.hash===archive.sha256,
      'SUPERSET_SESSION_ARCHIVE_CHANGED','An existing received archive differs.');
    return file;
  }catch(error){if(error.code!=='ENOENT')throw error;}
  const temporary=join(root,'.archive-'+randomUUID());let handle;
  try{
    handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    for(const chunk of archive.chunks){
      const raw=workspace.bytes(chunk.sha256);let offset=0;
      while(offset<raw.length){
        const {bytesWritten}=await handle.write(raw,offset,raw.length-offset,null);
        need(bytesWritten>0,'SUPERSET_SESSION_ARCHIVE_WRITE','The received archive write made no progress.');
        offset+=bytesWritten;
      }
    }
    await handle.sync();await handle.close();handle=null;
    const actual=await hashPrivate(temporary,MAX_ARCHIVE);
    need(actual.bytes===archive.bytes&&actual.hash===archive.sha256,
      'SUPERSET_SESSION_ARCHIVE_CHANGED','The materialized original archive differs.');
    try{await link(temporary,file);}catch(error){
      if(error.code!=='EEXIST')throw error;
      const existing=await hashPrivate(file,MAX_ARCHIVE);
      need(existing.bytes===archive.bytes&&existing.hash===archive.sha256,
        'SUPERSET_SESSION_ARCHIVE_CHANGED','Another archive occupies the selected receiving path.');
    }
    await syncDirectory(root);return file;
  }finally{
    await handle?.close();
    await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
}

/** The incoming project identity selects the same original receiving operation.
 * Already received sessions reopen current state through SF88's storage map. */
export async function restoreSupersetBuyerSessions(workspace,value,{sourceArchiveSha256,...settings}={}){
  settings=archiveOptions(settings);
  validateSupersetBuyerSessions(workspace,value,{allowAdditionalBuyers:true});
  if(!value)return[];
  need(HASH.test(sourceArchiveSha256??''),'SUPERSET_SESSION_SOURCE_ARCHIVE','The incoming project archive digest is required.');
  const restored=[];
  for(const entry of value.buyers){
    if(!entry.initialized)continue;
    const buyer=workspace.get('buyers',entry.buyerId);
    const archive=await materializeArchive(workspace,join(workspace.directory,'session-transfers','received'),entry.archive);
    const inspected=await inspectDatasetSessionArchive({archive,expectedSha256:entry.archive.sha256,...settings});
    need(inspected.archiveBytes===entry.archive.bytes&&inspected.manifestSha256===entry.native.manifestSha256&&
      inspected.sessionSha256===entry.native.sessionSha256&&inspected.configurationSha256===entry.native.configurationSha256&&
      inspected.sourceDirectory===entry.native.sourceDirectory&&inspected.inspection.sessionId===entry.native.sessionId,
      'SUPERSET_SESSION_NATIVE_ARCHIVE','The original native archive metadata differs.');
    definitionBinding(workspace,buyer,workspace.bytes(entry.definition.sha256),inspected);
    const directory=located(workspace,buyer);await privateDirectory(dirname(directory),true);
    const operation='superset-receive-'+identity({workspaceId:value.workspaceId,sourceArchiveSha256,
      buyerId:buyer.id,archiveSha256:entry.archive.sha256}).slice(0,48);
    const result=await receiveDatasetSessionArchive({archive,directory,
      expectedSha256:entry.archive.sha256,operation,...settings});
    need(result.session.sessionId===entry.native.sessionId&&
      result.session.configurationSha256===entry.native.configurationSha256,
      'SUPERSET_SESSION_RECEIVING_CHANGED','The original session identity changed during receiving.');
    restored.push({buyerId:buyer.id,directory,sourceDirectory:entry.native.sourceDirectory,
      archiveSha256:entry.archive.sha256,sessionId:result.session.sessionId,
      configurationSha256:result.session.configurationSha256,status:result.session.status,
      completedPages:result.session.completedPages,acquiredRows:result.session.acquiredRows,reused:result.reused??false});
  }
  return restored;
}
