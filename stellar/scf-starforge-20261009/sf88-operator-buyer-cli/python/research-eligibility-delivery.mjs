// MIT. Eligibility customer delivery through original exports and portable readers.
import {lstat,mkdtemp,rm} from 'node:fs/promises';
import {dirname,join,resolve,isAbsolute} from 'node:path';
import {openDossierStore} from '../research-dossiers/dossier.mjs';
import {eligibilityDigest} from '../research-dossiers/eligibility-review.mjs';
import {ELIGIBILITY_EXPORT_SECTIONS,exportEligibility,validateEligibilityPage}
  from '../research-dossiers/eligibility-consumer.mjs';
import {researchSummary} from '../research-dossiers/workspace-protocol.mjs';
import {readResearchHostFile,openResearchSource} from '../research-dossiers/workspace-files.mjs';
import {privateDirectory,withPrivateLock} from '../../sf30-seller-sdk/routescan/quota.mjs';
import {need,object,parseJson,writeJson,readJson,digest} from '../node/store.mjs';

export const ELIGIBILITY_DELIVERY_SCHEMA='stellar-forge.research-eligibility-delivery.v1';
const LIMIT=256*1024*1024;
const sections=['reviews',...ELIGIBILITY_EXPORT_SECTIONS];
const same=(a,b)=>eligibilityDigest(a)===eligibilityDigest(b);
const absolute=value=>{
  need(typeof value==='string'&&isAbsolute(value)&&resolve(value)===value,
    'ELIGIBILITY_ABSOLUTE_PATH_REQUIRED');return value;
};
async function exists(file){
  try{const s=await lstat(file);need(s.isFile()&&!s.isSymbolicLink(),'ELIGIBILITY_FILE_TYPE_CHANGED');return true;}
  catch(error){if(error.code==='ENOENT')return false;throw error;}
}
async function pin(file){
  const source=await openResearchSource(absolute(file),LIMIT);
  try{return {file,bytes:source.bytes,sha256:source.sha256};}finally{await source.close();}
}
async function immutable(file,value){
  if(await exists(file)){
    const saved=await readJson(file,32*1024*1024);need(same(saved,value),'ELIGIBILITY_DELIVERY_RECORD_CHANGED');return saved;
  }
  try{await writeJson(file,value,{exclusive:true});return value;}
  catch(error){
    if(error.code!=='EEXIST')throw error;
    const saved=await readJson(file,32*1024*1024);need(same(saved,value),'ELIGIBILITY_DELIVERY_RECORD_CHANGED');return saved;
  }
}
async function originalSelection(input){
  need(object(input)&&/^[a-f0-9]{64}$/.test(input.selectionSha256),'ELIGIBILITY_DELIVERY_SELECTION_REQUIRED');
  const raw=await readResearchHostFile(absolute(input.selectionFile),32*1024*1024,{sha256:input.selectionSha256});
  const value=parseJson(raw);
  need(value.schema===ELIGIBILITY_DELIVERY_SCHEMA&&/^research_[a-f0-9]{64}$/.test(value.workspaceId)&&
    /^d_[a-f0-9-]{36}$/.test(value.dossierId)&&typeof value.reviewId==='string'&&
    Number.isSafeInteger(value.revision)&&value.revision>=1&&
    value.metadata?.id===value.dossierId&&value.metadata.revision===value.revision&&
    Array.isArray(value.history)&&object(value.sections)&&sections.every(key=>Array.isArray(value.sections[key]))&&
    Object.keys(value.sections).length===sections.length,'ELIGIBILITY_DELIVERY_SELECTION_INVALID');
  validateEligibilityPage(value.overview,value.dossierId,{revision:value.revision,reviewId:value.reviewId,
    ...(value.workSetId?{workSetId:value.workSetId}:{}),section:'overview'});
  return value;
}
function options(selection){
  return {revision:selection.revision,reviewId:selection.reviewId,
    ...(selection.workSetId?{workSetId:selection.workSetId}:{})};
}
async function checkStore(store,selection){
  const id=selection.dossierId,opt=options(selection);
  need(same(researchSummary(await store.getMetadata(id,opt)),selection.metadata),'ELIGIBILITY_RECEIVED_METADATA_CHANGED');
  const history=await store.listRevisions(id,opt);
  need(same(history,selection.history),'ELIGIBILITY_RECEIVED_HISTORY_CHANGED');
  const overview=await store.eligibility(id,{...opt,section:'overview'});
  need(same(overview,selection.overview),'ELIGIBILITY_RECEIVED_OVERVIEW_CHANGED');
  for(const section of sections){
    let offset=0,rows=[];
    for(;;){
      const page=await store.eligibility(id,{...opt,section,offset,limit:100});
      validateEligibilityPage(page,id,{...opt,section,offset,limit:100});
      rows.push(...page.items);
      if(page.nextOffset===null)break;
      offset=page.nextOffset;
    }
    need(same(rows,selection.sections[section]),'ELIGIBILITY_RECEIVED_SECTION_CHANGED');
  }
  return {dossierId:id,reviewId:selection.reviewId,workSetId:selection.workSetId??null,
    revision:selection.revision,historySha256:eligibilityDigest(history),
    overviewSha256:eligibilityDigest(overview),sectionsSha256:eligibilityDigest(selection.sections),
    operationIds:selection.sections.operations.map(item=>item.id),
    originalSourceEditions:selection.sections.occurrences.map(item=>({occurrenceId:item.occurrenceId,
      editionId:item.editionId,sourceSha256:item.sourceSha256,contentDigest:item.contentDigest}))};
}
async function importPortable(store,file,format,expected){
  if(format==='json'){
    const raw=await readResearchHostFile(file,LIMIT,{sha256:expected.sha256});
    need(raw.length===expected.bytes,'ELIGIBILITY_PORTABLE_BYTES_CHANGED');
    await store.reopen(parseJson(raw));
  }else{
    const source=await openResearchSource(file,LIMIT,{sha256:expected.sha256});
    try{
      need(source.bytes===expected.bytes,'ELIGIBILITY_PORTABLE_BYTES_CHANGED');
      await store.reopenStream(source.stream,{projection:'metadata'});
    }finally{await source.close();}
  }
}
async function checkPortable(file,format,selection,parent,expected){
  const temporary=await mkdtemp(join(parent,'.eligibility-inspect-'));
  try{
    const store=await openDossierStore(temporary);
    await importPortable(store,file,format,expected);
    return await checkStore(store,selection);
  }finally{await rm(temporary,{recursive:true,force:true});}
}
function exportSelection(input){
  need(['portable-json','portable-gzip','dossier-html','dossier-md','eligibility-json','eligibility-csv'].includes(input.kind),
    'ELIGIBILITY_DELIVERY_EXPORT_INVALID');
  if(input.kind==='eligibility-csv')
    need(ELIGIBILITY_EXPORT_SECTIONS.includes(input.section),'ELIGIBILITY_EXPORT_SECTION_INVALID');
  else need(input.section===undefined,'ELIGIBILITY_DELIVERY_EXPORT_FIELDS_INVALID');
  return {kind:input.kind,...(input.section?{section:input.section}:{})};
}
async function originalExport(client,selection,selected,file){
  const opt={...options(selection),file};
  if(selected.kind.startsWith('eligibility-'))
    return exportEligibility(client,selection.dossierId,{...opt,
      format:selected.kind==='eligibility-json'?'json':'csv',section:selected.section??'queue'});
  const format=({'portable-json':'json','portable-gzip':'json.gz','dossier-html':'html','dossier-md':'md'})[selected.kind];
  return client.exportDossier(selection.dossierId,{file,revision:selection.revision,format});
}

/** Preserve the first complete file even if its original download reply was lost. */
export async function exportEligibilityDeliveryFile(client,input){
  const selection=await originalSelection(input),selected=exportSelection(input);
  need(client.workspaceId===selection.workspaceId,'ELIGIBILITY_WORKSPACE_CHANGED');
  const file=absolute(input.file),parent=await privateDirectory(dirname(file));
  const root=await privateDirectory(join(parent,'.eligibility-exports'));
  const slot=await privateDirectory(join(root,eligibilityDigest({file})));
  return withPrivateLock(slot,'export.lock',async()=>{
    const identity={selectionSha256:input.selectionSha256,dossierId:selection.dossierId,
      revision:selection.revision,...selected,file};
    await immutable(join(slot,'selection.json'),identity);
    const receiptFile=join(slot,'receipt.json');
    if(await exists(receiptFile)){
      const saved=await readJson(receiptFile,65536);
      need(same(saved.identity,identity),'ELIGIBILITY_EXPORT_SELECTION_CHANGED');
      const actual=await pin(file);
      need(actual.bytes===saved.file.bytes&&actual.sha256===saved.file.sha256,'ELIGIBILITY_EXPORT_BYTES_CHANGED');
      return saved.file;
    }
    let artifact;
    if(await exists(file)){
      artifact=await pin(file);
      if(selected.kind.startsWith('portable-')){
        await checkPortable(file,selected.kind==='portable-json'?'json':'json.gz',selection,parent,artifact);
      }else{
        const temporary=await mkdtemp(join(parent,'.eligibility-report-'));
        try{
          const checked=await originalExport(client,selection,selected,join(temporary,'report'));
          need(checked.revision===selection.revision&&checked.bytes===artifact.bytes&&checked.sha256===artifact.sha256,
            'ELIGIBILITY_EXPORT_BYTES_CHANGED');
          artifact.contentType=checked.contentType;
        }finally{await rm(temporary,{recursive:true,force:true});}
      }
      artifact={...artifact,revision:selection.revision,
        contentType:artifact.contentType??(selected.kind==='portable-json'?'application/json':'application/gzip')};
    }else{
      artifact=await originalExport(client,selection,selected,file);
      need(artifact.revision===selection.revision,'ELIGIBILITY_EXPORT_REVISION_CHANGED');
      if(selected.kind.startsWith('portable-'))
        await checkPortable(file,selected.kind==='portable-json'?'json':'json.gz',selection,parent,artifact);
    }
    await immutable(receiptFile,{identity,file:artifact});
    return artifact;
  });
}

/** Original JSON/gzip readers validate complete source and immutable history. */
export async function receiveEligibilityFile(input){
  const selection=await originalSelection(input),format=input.format;
  need(['json','json.gz'].includes(format),'ELIGIBILITY_RECEIVE_FORMAT_INVALID');
  need(/^[a-f0-9]{64}$/.test(input.expectedSha256)&&Number.isSafeInteger(input.expectedBytes)&&input.expectedBytes>=0,
    'ELIGIBILITY_PORTABLE_IDENTITY_REQUIRED');
  const file=absolute(input.file),target=await privateDirectory(absolute(input.directory));
  return withPrivateLock(target,'eligibility-receive.lock',async()=>{
    const actual=await pin(file);
    need(actual.sha256===input.expectedSha256&&actual.bytes===input.expectedBytes,'ELIGIBILITY_PORTABLE_BYTES_CHANGED');
    const identity={selectionSha256:input.selectionSha256,format,sha256:actual.sha256,bytes:actual.bytes};
    await immutable(join(target,'eligibility-selection.json'),identity);
    const directory=join(target,'workspace'),store=await openDossierStore(directory);
    // Original receiving reconciles an existing immutable prefix and preserves
    // subsequent local revisions; it never resets a receiver to this snapshot.
    await importPortable(store,file,format,actual);
    const checked=await checkStore(store,selection),reports=[];
    for(const kind of ['dossier-html','dossier-md','eligibility-json',...ELIGIBILITY_EXPORT_SECTIONS.map(section=>'eligibility-csv:'+section)]){
      const [family,section]=kind.split(':');
      const report=family.startsWith('eligibility-')?
        await store.exportEligibility(selection.dossierId,{...options(selection),
          format:family==='eligibility-json'?'json':'csv',section:section??'queue'}):
        await store.exportDossier(selection.dossierId,{revision:selection.revision,format:family==='dossier-html'?'html':'md'});
      const bytes=Buffer.from(report.body);
      reports.push({kind:family,...(section?{section}:{}),revision:selection.revision,bytes:bytes.length,sha256:digest(bytes)});
    }
    const receipt={schema:ELIGIBILITY_DELIVERY_SCHEMA,identity,...checked,reports};
    await immutable(join(target,'eligibility-received.json'),receipt);
    return {...receipt,directory,currentRevision:(await store.getMetadata(selection.dossierId)).revision};
  });
}
