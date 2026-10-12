// MIT. Retained customer operating files use the original Research readers/publisher.
import {lstat,readdir,realpath,unlink} from 'node:fs/promises';
import {join,resolve,dirname,basename} from 'node:path';
import {privateDirectory,writeBytes,jsonBytes,digest,parseJson,exists,syncDirectory,matchingWriteTemporaries}
  from '../../node/store.mjs';
import {withPrivateLock} from '../../../sf30-seller-sdk/routescan/quota.mjs';
import {readResearchHostFile,openResearchSource} from '../workspace-files.mjs';
import {writePortableFile,portableEntries,PORTABLE_LIMIT} from '../portable.mjs';
import {customerFields,customerHash,customerIdentifier,requireCustomerUpdate as need} from './contracts.mjs';
import {customerUpdateSame,customerUpdateRecords,customerUpdateDigest} from './context.mjs';
import {customerUpdateBlobMetadata} from './model.mjs';
export const CUSTOMER_FILE_LIMIT=64*1024*1024;
export async function customerDirectory(value,{create=true}={}){
  const directory=await privateDirectory(resolve(value),{create});
  need(directory!=='/'&&await realpath(directory)===directory,'CUSTOMER_UPDATE_DIRECTORY_CHANGED');return directory;
}
export function customerFilename(value){
  need(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(value),'CUSTOMER_UPDATE_FILENAME_INVALID');return value;
}
export async function withCustomerOperation(directory,work){
  const root=await customerDirectory(directory);
  return withPrivateLock(root,'customer-update.lock',()=>work(root));
}
export async function readCustomerJson(path,limit=CUSTOMER_FILE_LIMIT){
  const body=await readResearchHostFile(resolve(path),limit),value=parseJson(body);
  return {value,bytes:body.length,sha256:digest(body),body};
}
async function finishOriginalPublication(path,body){
  const target=await lstat(path);
  for(const name of await matchingWriteTemporaries(dirname(path),[body])){
    const file=join(dirname(path),name),entry=await lstat(file);
    // Only a stopped hard-link publication of this exact original destination.
    if(entry.dev===target.dev&&entry.ino===target.ino)await unlink(file);
  }
  await syncDirectory(dirname(path));
}
export async function retainCustomerBytes(directory,name,body){
  customerFilename(name);need(body instanceof Uint8Array,'CUSTOMER_UPDATE_FILE_BYTES_REQUIRED');
  const path=join(directory,name),bytes=Buffer.from(body);
  try{await writeBytes(path,bytes,{exclusive:true});}
  catch(error){if(error.code!=='EEXIST')throw error;}
  const saved=await readResearchHostFile(path,Math.max(bytes.length,1));
  need(saved.equals(bytes),'CUSTOMER_UPDATE_RETAINED_FILE_CHANGED');
  await finishOriginalPublication(path,bytes);return {name,bytes:bytes.length,sha256:digest(bytes),path};
}
export async function retainCustomerJson(directory,name,value){return retainCustomerBytes(directory,name,jsonBytes(value));}
export async function describeCustomerFile(path,{sha256,bytes,maximum=PORTABLE_LIMIT}={}){
  if(sha256!==undefined)customerHash(sha256);
  const source=await openResearchSource(resolve(path),maximum,{sha256});
  try{
    need(bytes===undefined||source.bytes===bytes,'CUSTOMER_UPDATE_RETAINED_FILE_CHANGED');
    return {name:basename(path),path:resolve(path),bytes:source.bytes,sha256:source.sha256};
  }finally{await source.close();}
}
export async function copyCustomerFile(sourceFile,destination,{sha256,bytes,maximum=PORTABLE_LIMIT}={}){
  const file=resolve(destination);
  if(await exists(file))return {...await describeCustomerFile(file,{sha256,bytes,maximum}),reused:true};
  const source=await openResearchSource(resolve(sourceFile),maximum,{sha256});
  try{
    need(bytes===undefined||source.bytes===bytes,'CUSTOMER_UPDATE_SOURCE_FILE_CHANGED');
    try{await writePortableFile(file,{filename:basename(file),contentType:'application/octet-stream',body:source.stream});}
    catch(error){if(error.code!=='EEXIST')throw error;}
    return {...await describeCustomerFile(file,{sha256:source.sha256,bytes:source.bytes,maximum}),reused:false};
  }finally{await source.close();}
}
export async function inspectCustomerPortable(path,{dossierId,delivery,expectedWork,expectedSha256,expectedBytes}={}){
  const source=await openResearchSource(resolve(path),PORTABLE_LIMIT,{sha256:expectedSha256});
  try{
    need(expectedBytes===undefined||source.bytes===expectedBytes,'CUSTOMER_UPDATE_PORTABLE_CHANGED');
    const fields={},required=new Map(),blobs=new Map();let previous=null,last=null,versionCount=0,blobCount=0;
    const retain=metadata=>{
      customerHash(metadata.sha256);need(Number.isSafeInteger(metadata.bytes)&&metadata.bytes>=0&&metadata.bytes<=CUSTOMER_FILE_LIMIT,
        'CUSTOMER_UPDATE_PORTABLE_BLOB_INVALID');
      const old=required.get(metadata.sha256);need(!old||old.bytes===metadata.bytes,'CUSTOMER_UPDATE_PORTABLE_BLOB_CHANGED');
      required.set(metadata.sha256,metadata);
    };
    for await(const record of portableEntries(source.stream)){
      if(record.kind==='field'){fields[record.key]=record.value;continue;}
      if(record.kind==='array'){fields[record.key]=record.count;continue;}
      if(record.kind==='versions'){
        const {state,sha256}=record.value;
        need(state?.id===dossierId&&state.revision===versionCount+1&&state.previous===previous&&digest(jsonBytes(state))===sha256,
          'CUSTOMER_UPDATE_PORTABLE_HISTORY_CHANGED');
        need(Array.isArray(state.editions),'CUSTOMER_UPDATE_PORTABLE_EDITIONS_INVALID');
        for(const edition of state.editions)if(edition.mode==='retained')retain(edition.raw);
        for(const file of customerUpdateBlobMetadata(state))retain(file);
        previous=sha256;last=state;versionCount++;continue;
      }
      if(record.kind==='blobs'){
        const value=record.value;customerHash(value.sha256);
        need(typeof value.bodyBase64==='string','CUSTOMER_UPDATE_PORTABLE_BLOB_INVALID');
        const bytes=Buffer.from(value.bodyBase64,'base64');
        need(bytes.toString('base64')===value.bodyBase64&&bytes.length===value.bytes&&bytes.length<=CUSTOMER_FILE_LIMIT&&
          digest(bytes)===value.sha256,'CUSTOMER_UPDATE_PORTABLE_BLOB_CHANGED');
        const old=blobs.get(value.sha256);need(old===undefined||old===value.bytes,'CUSTOMER_UPDATE_PORTABLE_BLOB_CHANGED');
        blobs.set(value.sha256,value.bytes);blobCount++;
      }
    }
    need(fields.schema==='sf88-research-dossier-portable-v1'&&fields.id===dossierId&&fields.versions===versionCount&&
      fields.blobs===blobCount&&last&&versionCount>0,'CUSTOMER_UPDATE_PORTABLE_INVALID');
    for(const file of required.values())need(blobs.get(file.sha256)===file.bytes,'CUSTOMER_UPDATE_PORTABLE_BLOB_MISSING');
    const selected=customerUpdateRecords(last).deliveries.find(row=>row.id===delivery?.id);
    need(selected&&customerUpdateSame(selected,delivery)&&last.revision===delivery.revision,'CUSTOMER_UPDATE_PORTABLE_DELIVERY_CHANGED');
    const work=customerUpdateRecords(last).work.find(row=>row.id===selected.workId);
    need(work&&work.sha256===selected.workSha256&&(!expectedWork||customerUpdateSame(work,expectedWork)),
      'CUSTOMER_UPDATE_PORTABLE_WORK_CHANGED');
    return {dossierId,revision:last.revision,headSha256:previous,versions:versionCount,blobs:blobs.size,
      projectId:selected.projectId,deliveryId:selected.id,bytes:source.bytes,sha256:source.sha256};
  }finally{await source.close();}
}
export async function inspectCustomerFiles(directory,manifest){
  customerFields(manifest,['schema','createdAt','selection','files'],'CUSTOMER_UPDATE_HANDOVER_MANIFEST_INVALID');
  need(manifest.schema==='sf88-research-customer-handover/v1'&&Array.isArray(manifest.files)&&
    manifest.files.length>=6&&manifest.files.length<=7,'CUSTOMER_UPDATE_HANDOVER_MANIFEST_INVALID');
  customerFields(manifest.selection,['workspaceId','dossierId','revision','projectId','delivery','work','sourceWorkspace'],
    'CUSTOMER_UPDATE_HANDOVER_SELECTION_INVALID');
  const selected=manifest.selection;
  need(/^research_[a-f0-9]{64}$/.test(selected.workspaceId)&&/^d_[a-f0-9-]{36}$/.test(selected.dossierId)&&
    selected.delivery?.revision===selected.revision&&selected.delivery?.projectId===selected.projectId&&
    selected.work?.id===selected.delivery.workId&&selected.work?.sha256===selected.delivery.workSha256,
    'CUSTOMER_UPDATE_HANDOVER_SELECTION_CHANGED');
  need(Array.isArray(selected.delivery.files)&&selected.delivery.files.length===4,
    'CUSTOMER_UPDATE_HANDOVER_REPORTS_INVALID');
  const {sha256:workSha,...workBody}=selected.work;
  need(customerUpdateDigest(workBody)===workSha,'CUSTOMER_UPDATE_HANDOVER_WORK_CHANGED');
  const expected=new Map([['dossier.research.json.gz',{kind:'dossier'}],
    ['work.review.json',{kind:'work',...selected.work.snapshot}],
    ...selected.delivery.files.map(row=>[row.name,{kind:'report',format:row.format,sha256:row.sha256,bytes:row.bytes}]),
    ...(selected.sourceWorkspace?[['europe-pmc.workspace.json.gz',{kind:'europe-pmc'}]]:[])]);
  need(expected.size===manifest.files.length&&new Set(manifest.files.map(row=>row.name)).size===manifest.files.length,
    'CUSTOMER_UPDATE_HANDOVER_FILES_CHANGED');
  const files=[];
  for(const file of manifest.files){
    customerFields(file,['name','kind','format','bytes','sha256','contentType'],'CUSTOMER_UPDATE_HANDOVER_FILE_INVALID');
    customerFilename(file.name);const match=expected.get(file.name);
    need(match&&match.kind===file.kind&&(match.format===undefined||match.format===file.format)&&
      (match.sha256===undefined||match.sha256===file.sha256)&&(match.bytes===undefined||match.bytes===file.bytes),
      'CUSTOMER_UPDATE_HANDOVER_FILE_CHANGED');
    files.push({...file,...await describeCustomerFile(join(directory,file.name),{sha256:file.sha256,bytes:file.bytes,
      maximum:file.kind==='europe-pmc'?128*1024*1024:file.kind==='dossier'?PORTABLE_LIMIT:CUSTOMER_FILE_LIMIT})});
  }
  const dossier=files.find(row=>row.kind==='dossier'),portable=await inspectCustomerPortable(dossier.path,{
    dossierId:selected.dossierId,delivery:selected.delivery,expectedWork:selected.work,expectedSha256:dossier.sha256,expectedBytes:dossier.bytes});
  return {selection:structuredClone(selected),files,portable};
}
export async function inspectCustomerHandover(directory,{manifestSha256}={}){
  const root=await customerDirectory(directory,{create:false}),manifest=await readCustomerJson(join(root,'handover.json'));
  need(manifestSha256===undefined||manifest.sha256===manifestSha256,'CUSTOMER_UPDATE_HANDOVER_CHANGED');
  return {schema:'sf88-research-customer-handover-inspected/v1',directory:root,
    manifestSha256:manifest.sha256,manifestBytes:manifest.bytes,manifest:manifest.value,
    ...await inspectCustomerFiles(root,manifest.value)};
}
