// MIT. Complete Python citation delivery through the original Research engine.
import {createHash} from 'node:crypto';
import {lstat,mkdtemp,rm} from 'node:fs/promises';
import {dirname,join,resolve,isAbsolute} from 'node:path';
import {openDossierStore} from '../research-dossiers/dossier.mjs';
import {citationDigest} from '../research-dossiers/citation-updates.mjs';
import {researchSummary} from '../research-dossiers/workspace-protocol.mjs';
import {readResearchHostFile,openResearchSource} from '../research-dossiers/workspace-files.mjs';
import {privateDirectory,withPrivateLock} from '../../sf30-seller-sdk/routescan/quota.mjs';
import {need,object,parseJson,writeJson,readJson} from '../node/store.mjs';

const SCHEMA='stellar-forge.citation-python-delivery.v1';
const LIMIT=256*1024*1024;
const same=(a,b)=>citationDigest(a)===citationDigest(b);
const absolute=value=>{
  need(typeof value==='string'&&isAbsolute(value)&&resolve(value)===value,'CITATION_ABSOLUTE_PATH_REQUIRED');
  return value;
};
async function exists(file){
  try{const s=await lstat(file);need(s.isFile()&&!s.isSymbolicLink(),'CITATION_FILE_TYPE_CHANGED');return true;}
  catch(error){if(error.code==='ENOENT')return false;throw error;}
}
async function pin(file){
  const source=await openResearchSource(absolute(file),LIMIT);
  try{return {file,bytes:source.bytes,sha256:source.sha256};}finally{await source.close();}
}
async function originalSelection(input){
  need(object(input)&&/^[a-f0-9]{64}$/.test(input.selectionSha256),'CITATION_SELECTION_REQUIRED');
  const raw=await readResearchHostFile(absolute(input.selectionFile),32*1024*1024,{sha256:input.selectionSha256});
  const value=parseJson(raw);
  need(value.schema===SCHEMA&&/^research_[a-f0-9]{64}$/.test(value.workspaceId)&&
    /^d_[a-f0-9-]{36}$/.test(value.dossierId)&&
    /^cu_[a-f0-9]{64}$/.test(value.noticeId)&&object(value.snapshots)&&Array.isArray(value.history),
    'CITATION_SELECTION_INVALID');
  for(const label of ['before','reviewed','current']){
    const item=value.snapshots[label];
    need(object(item)&&Number.isSafeInteger(item.revision)&&item.revision>=1&&
      item.metadata?.id===value.dossierId&&item.metadata.revision===item.revision&&
      item.detail?.dossier?.id===value.dossierId&&item.detail.dossier.revision===item.revision&&
      item.detail.detail?.noticeId===value.noticeId,'CITATION_SELECTION_INVALID');
  }
  need(value.review?.requestId===value.request?.requestId&&same(value.review.request,value.request)&&
    value.review.originalRevision===value.snapshots.before.revision&&
    value.review.revision===value.snapshots.reviewed.revision&&
    value.snapshots.current.revision>=value.snapshots.reviewed.revision,
    'CITATION_REVIEW_SELECTION_CHANGED');
  return value;
}
async function checkStore(store,selection,label){
  const selected=selection.snapshots[label],id=selection.dossierId,revision=selected.revision;
  const metadata=researchSummary(await store.getMetadata(id,{revision}));
  const history=await store.listRevisions(id,{revision});
  const detail=await store.citationUpdates(id,{revision,noticeId:selection.noticeId});
  need(same(metadata,selected.metadata),'CITATION_RECEIVED_METADATA_CHANGED');
  need(same(history,selection.history.filter(item=>item.revision<=revision)),'CITATION_RECEIVED_HISTORY_CHANGED');
  need(same(detail,selected.detail),'CITATION_RECEIVED_REVIEW_CHANGED');
  return {dossierId:id,revision,historySha256:citationDigest(history),
    detailSha256:citationDigest(detail),reviewId:selection.review.id,
    reviewPresent:detail.detail.reviews.some(item=>item.id===selection.review.id)};
}
async function importPortable(store,file,format,expected){
  need(expected&&/^[a-f0-9]{64}$/.test(expected.sha256),'CITATION_RETAINED_DIGEST_REQUIRED');
  if(format==='json'){
    const raw=await readResearchHostFile(file,LIMIT,{sha256:expected.sha256});
    need(raw.length===expected.bytes,'CITATION_EXPORT_BYTES_CHANGED');
    await store.reopen(parseJson(raw));
  }else{
    const source=await openResearchSource(file,LIMIT,{sha256:expected.sha256});
    try{need(source.bytes===expected.bytes,'CITATION_EXPORT_BYTES_CHANGED');
      await store.reopenStream(source.stream,{projection:'metadata'});}finally{await source.close();}
  }
}
async function checkPortable(file,format,selection,label,parent,expected){
  const temporary=await mkdtemp(join(parent,'.citation-inspect-'));
  try{
    const store=await openDossierStore(temporary);
    await importPortable(store,file,format,expected);
    return await checkStore(store,selection,label);
  }finally{await rm(temporary,{recursive:true,force:true});}
}
async function immutable(file,value){
  if(await exists(file)){const saved=await readJson(file,32*1024*1024);
    need(same(saved,value),'CITATION_RECEIPT_CHANGED');return saved;}
  try{await writeJson(file,value,{exclusive:true});return value;}
  catch(error){if(error.code!=='EEXIST')throw error;
    const saved=await readJson(file,32*1024*1024);need(same(saved,value),'CITATION_RECEIPT_CHANGED');return saved;}
}

/** Keep the first published bytes, including a lost original download reply. */
export async function exportCitationFile(client,input){
  const selection=await originalSelection(input),{label,format}=input;
  need(client.workspaceId===selection.workspaceId,'CITATION_WORKSPACE_CHANGED');
  need(['before','reviewed','current'].includes(label)&&['html','md','json','json.gz'].includes(format),
    'CITATION_EXPORT_SELECTION_INVALID');
  const file=absolute(input.file),parent=await privateDirectory(dirname(file));
  const root=await privateDirectory(join(parent,'.citation-exports'));
  const key=citationDigest({file}),slot=await privateDirectory(join(root,key));
  return withPrivateLock(slot,'export.lock',async()=>{
    const revision=selection.snapshots[label].revision;
    const identity={selectionSha256:input.selectionSha256,dossierId:selection.dossierId,
      label,revision,format,file};
    await immutable(join(slot,'selection.json'),identity);
    const receiptFile=join(slot,'receipt.json');
    if(await exists(receiptFile)){
      const saved=await readJson(receiptFile,65536);
      need(same(saved.identity,identity),'CITATION_EXPORT_SELECTION_CHANGED');
      need(await exists(file),'CITATION_RETAINED_EXPORT_MISSING');
      const current=await pin(file);
      need(current.bytes===saved.file.bytes&&current.sha256===saved.file.sha256,'CITATION_EXPORT_BYTES_CHANGED');
      return saved.file;
    }
    let artifact;
    if(await exists(file)){
      // Selection was retained before the original export. Validate that exact
      // published candidate against every selected history envelope; never
      // overwrite it or regenerate a portable archive with a later timestamp.
      artifact=await pin(file);
      if(format==='json'||format==='json.gz'){
        await checkPortable(file,format,selection,label,parent,artifact);
      }else{
        const temporary=await mkdtemp(join(parent,'.citation-report-'));
        try{
          const checked=await client.exportDossier(selection.dossierId,{
            revision,format,file:join(temporary,'report')});
          need(checked.revision===revision&&checked.bytes===artifact.bytes&&checked.sha256===artifact.sha256,
            'CITATION_EXPORT_BYTES_CHANGED');
        }finally{await rm(temporary,{recursive:true,force:true});}
      }
      artifact={...artifact,revision,contentType:format==='html'?'text/html; charset=utf-8':
        format==='md'?'text/markdown; charset=utf-8':format==='json'?'application/json':'application/gzip'};
    }else{
      artifact=await client.exportDossier(selection.dossierId,{revision,format,file});
      need(artifact.revision===revision,'CITATION_EXPORT_REVISION_CHANGED');
      if(format==='json'||format==='json.gz')await checkPortable(file,format,selection,label,parent,artifact);
    }
    await immutable(receiptFile,{identity,file:artifact});
    return artifact;
  });
}

/** Cold receive reuses the existing JSON or streaming portable reader. */
export async function receiveCitationFile(input){
  const selection=await originalSelection(input),{label,format}=input;
  need(['before','reviewed','current'].includes(label)&&['json','json.gz'].includes(format),
    'CITATION_RECEIVE_SELECTION_INVALID');
  const file=absolute(input.file),target=await privateDirectory(absolute(input.directory));
  need(typeof input.expectedSha256==='string'&&/^[a-f0-9]{64}$/.test(input.expectedSha256),
    'CITATION_RETAINED_DIGEST_REQUIRED');
  return withPrivateLock(target,'citation-receive.lock',async()=>{
    const actual=await pin(file);
    need(actual.sha256===input.expectedSha256&&actual.bytes===input.expectedBytes,'CITATION_EXPORT_BYTES_CHANGED');
    const identity={selectionSha256:input.selectionSha256,label,format,sha256:actual.sha256,bytes:actual.bytes};
    await immutable(join(target,'citation-selection.json'),identity);
    const store=await openDossierStore(join(target,'workspace'));
    await importPortable(store,file,format,actual);
    const selected=await checkStore(store,selection,label),reports=[];
    for(const [name,snapshot]of Object.entries(selection.snapshots)){
      if(snapshot.revision>selected.revision)continue;
      for(const reportFormat of ['html','md']){
        const report=await store.exportDossier(selection.dossierId,{revision:snapshot.revision,format:reportFormat});
        const bytes=Buffer.from(report.body);
        reports.push({label:name,revision:snapshot.revision,format:reportFormat,
          bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
      }
    }
    const result={schema:SCHEMA,identity,...selected,reports};
    await immutable(join(target,'citation-received.json'),result);
    return result;
  });
}
