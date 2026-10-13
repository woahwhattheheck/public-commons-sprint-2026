// MIT. Complete KiWIS commissioning lives in the original private Water Quality project.
import {join} from 'node:path';
import {readdir} from 'node:fs/promises';
import {privateDirectory,atomicJson,readPrivateJson,withPrivateLock} from '../../routescan/quota.mjs';
import {openWaterQualityProject,operationId} from '../project.mjs';
import {joinCapture} from '../samples.mjs';
import {readStandardizedReview,receiveStandardizedReview} from '../standardized-analysis/workflow.mjs';
import {readLabResult} from '../../lab-edd/result.mjs';
import {canonical,digest,fail,same,captureKiWIS,projectCapture,captureSelection,importKiWISResponses} from './source.mjs';
import {commissioningSource,previewCommissioning,compareCommissioningSources,compareCommissioningReviews} from './model.mjs';
import {commissioningFile} from './formats.mjs';
import {wqmCounterpartIdentity,projectWqmCounterpart} from './wqm.mjs';
const LIMIT=256*1024*1024;
const json=value=>JSON.stringify(value)+'\n';
async function directory(project){if(!project||typeof project.root!=='string'||typeof project.close!=='function')fail('KIWIS_PROJECT','Open the original Water Quality project.');return privateDirectory(join(project.root,'kiwis-commissioning'));}
async function maybe(path){try{return await readPrivateJson(path,LIMIT);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function immutable(folder,name,value){
  if(Buffer.byteLength(JSON.stringify(value,null,2)+'\n')>LIMIT)fail('KIWIS_SIZE','The complete selected edition exceeds the declared 256 MiB receiving allowance.');
  try{await atomicJson(folder,name,value,{exclusive:true});return value;}
  catch(error){if(error.code!=='EEXIST')throw error;const previous=await readPrivateJson(join(folder,name),LIMIT);
    if(!same(previous,value))fail('KIWIS_OPERATION_CHANGED','This saved operation name already contains different work.');return previous;}
}
export async function acquireCommissioningSource({project,sourceId,selection,fetch,signal,onProgress=()=>{}}){
  operationId(sourceId);const folder=await privateDirectory(join(await directory(project),'captures'));
  return withPrivateLock(folder,sourceId+'.lock',async()=>{
    const finished=await maybe(join(folder,sourceId+'.json'));
    if(finished){if(!same(finished.selection,captureSelection(selection)))fail('KIWIS_OPERATION_CHANGED','Reopen the original selected capture.');projectCapture(finished);return finished;}
    const checkpoint=await maybe(join(folder,sourceId+'.progress.json'));
    const capture=await captureKiWIS(selection,{fetch,signal,checkpoint,onCheckpoint:async value=>{await atomicJson(folder,sourceId+'.progress.json',value);await onProgress({completed:value.responses.length,requests:value.totalRequests??null,lastRequest:value.responses.at(-1)?.key});}});
    await immutable(folder,sourceId+'.json',capture);return capture;
  });
}
export async function importCommissioningCapture({project,sourceId,packet}){
  operationId(sourceId);
  const capture=importKiWISResponses(packet);
  projectCapture(capture);
  const folder=await privateDirectory(join(await directory(project),'captures'));
  return withPrivateLock(folder,sourceId+'.lock',()=>immutable(folder,sourceId+'.json',capture));
}
export async function readCommissioningCapture({project,sourceId}){
  operationId(sourceId);
  const capture=await readPrivateJson(join(await directory(project),'captures',sourceId+'.json'),LIMIT);
  projectCapture(capture);return capture;
}
function counterpartIdentity(input){
  if(!input||!['wqx-review','wqx-scientific','lab-edd-result','kiwis-wqm'].includes(input.kind))fail('KIWIS_COUNTERPART','Select the complete native WQX, Laboratory or KiWIS WQM receiving source.');
  if(input.kind==='kiwis-wqm')return wqmCounterpartIdentity(input);
  if(input.kind==='lab-edd-result'){
    const bytes=Buffer.from(input.base64??'','base64');
    if(bytes.toString('base64')!==input.base64||bytes.length!==input.bytes||digest(bytes)!==input.sha256)
      fail('KIWIS_COUNTERPART_CHANGED','The complete original laboratory archive changed.');
    return {sourceSha256:digest(canonical({kind:input.kind,sha256:input.sha256,bytes:input.bytes})),bytes};
  }
  if(!input.bundle||typeof input.bundle!=='object')fail('KIWIS_COUNTERPART','Retain the complete original native receiving bundle.');
  return {sourceSha256:digest(canonical({kind:input.kind,bundle:input.bundle}))};
}
async function projectCounterpart(project,input){
  const identity=counterpartIdentity(input);
  if(input.kind==='kiwis-wqm')return projectWqmCounterpart(input);
  if(input.kind==='lab-edd-result'){
    const result=readLabResult(identity.bytes);
    const records=result.review.tables.flatMap(table=>table.rows.map(row=>({
      recordId:row.recordId,fields:row.values,rowSha256:digest(canonical(row.values)),
      original:{filename:table.filename,section:table.id,origin:table.origin,rowNumber:row.rowNumber,
        sourceRowSha256:row.sourceRowSha256??row.rowSha256,sourceFields:result.document.decisions.filter(d=>d.recordId===row.recordId),
        cells:row.cells??null,changes:row.changes??[]}
    })));
    return {kind:input.kind,sourceSha256:identity.sourceSha256,profile:result.source.profile,
      nativeReviewSha256:result.review.reviewSha256,records};
  }
  const sourceRoot=join(await directory(project),'counterparts',identity.sourceSha256),native=await openWaterQualityProject(sourceRoot);
  try{
    let review,captureId;
    if(input.kind==='wqx-scientific'){
      await receiveStandardizedReview({project:native,bundle:input.bundle});
      review=await readStandardizedReview({project:native,reviewId:input.bundle.review.reviewId});
      captureId=review.decision.captureId;
    }else{
      await native.receiveReviewBundle({bundle:input.bundle});
      review=await native.readReview(input.bundle.reviewId);captureId=review.captureId;
    }
    const capture=await native.capture(captureId),model=await joinCapture(capture);
    const records=model.rows.map(row=>{
      // The original native row remains whole; source pointers are independent of field decisions.
      const fields={result:row.record,stations:row.stationRecords.map(item=>item.record),
        activities:row.activityRecords.map(item=>item.record),limits:row.limits.map(({type,value,valueState,unit,comment,origin,record})=>({type,value,valueState,unit,comment,origin,record}))};
      return {recordId:row.id+'-'+digest(canonical([row.source.sha256,row.source.index])).slice(0,24),fields,rowSha256:digest(canonical(fields)),original:row};
    });
    return {kind:input.kind,sourceSha256:identity.sourceSha256,nativeReviewSha256:review.reviewSha256,records};
  }finally{await native.close();}
}
export async function saveCommissioningSource({project,sourceId,capture,counterpart}){
  operationId(sourceId);
  if(capture&&!capture.schema)capture=importKiWISResponses(capture);
  projectCapture(capture);counterpartIdentity(counterpart);
  const folder=await privateDirectory(join(await directory(project),'sources'));
  return withPrivateLock(folder,sourceId+'.lock',async()=>{
    const previous=await maybe(join(folder,sourceId+'.json'));
    const input={schema:'starforge.kiwis-commissioning-input.v1',sourceId,capture,counterpart};
    const source=commissioningSource({capture,counterpart:await projectCounterpart(project,counterpart)});
    const saved={...input,sourceSha256:source.sourceSha256,inputSha256:digest(canonical(input))};
    if(previous&&!same(previous,saved))fail('KIWIS_OPERATION_CHANGED','This original source name contains another complete edition.');
    await immutable(folder,sourceId+'.json',saved);return {sourceId,sourceSha256:source.sourceSha256,inputSha256:saved.inputSha256,
      series:source.kiwis.series.length,observations:source.kiwis.observations.length,counterpartRecords:source.counterpart.records.length};
  });
}
export async function readCommissioningSource({project,sourceId}){
  operationId(sourceId);const folder=await privateDirectory(join(await directory(project),'sources'));
  const saved=await readPrivateJson(join(folder,sourceId+'.json'),LIMIT);
  const {inputSha256,sourceSha256,...input}=saved;
  if(input.schema!=='starforge.kiwis-commissioning-input.v1'||input.sourceId!==sourceId||digest(canonical(input))!==inputSha256)
    fail('KIWIS_SOURCE_CHANGED','The retained complete source input changed.');
  const source=commissioningSource({capture:saved.capture,counterpart:await projectCounterpart(project,saved.counterpart)});
  if(source.sourceSha256!==sourceSha256)fail('KIWIS_SOURCE_CHANGED','The original receiving graph differs from this source edition.');
  return {sourceId,input:saved,source};
}
function reviewed(record){
  if(record?.schema!=='starforge.kiwis-commissioning-saved.v1')fail('KIWIS_REVIEW','Open a complete saved commissioning review.');
  const {savedSha256,...content}=record;
  if(digest(canonical(content))!==savedSha256)fail('KIWIS_REVIEW_CHANGED','The complete saved review changed.');
  return record;
}
export async function previewCommissioningReview({project,sourceId,document}){
  const {source}=await readCommissioningSource({project,sourceId});
  return previewCommissioning(source,document);
}
export async function saveCommissioningReview({project,sourceId,reviewId,title,document,expectedReviewSha256}){
  operationId(reviewId);operationId(sourceId);
  if(typeof title!=='string'||!title.trim()||title.length>240)fail('KIWIS_TITLE','Give the commissioning review a title up to 240 characters.');
  const folder=await privateDirectory(join(await directory(project),'reviews'));
  return withPrivateLock(folder,reviewId+'.lock',async()=>{
    const preview=await previewCommissioningReview({project,sourceId,document});
    if(preview.reviewSha256!==expectedReviewSha256)fail('KIWIS_PREVIEW_CHANGED','Preview the selected complete source and decisions before saving this edition.');
    const content={schema:'starforge.kiwis-commissioning-saved.v1',reviewId,sourceId,title,review:preview},
      record={...content,savedSha256:digest(canonical(content))};
    return reviewed(await immutable(folder,reviewId+'.json',record));
  });
}
async function readSavedCommissioningReview({project,reviewId}){
  operationId(reviewId);const record=reviewed(await readPrivateJson(join(await directory(project),'reviews',reviewId+'.json'),LIMIT));
  if(record.reviewId!==reviewId)fail('KIWIS_REVIEW_CHANGED','The saved review name differs from its original edition.');
  return record;
}
function reproduceCommissioningReview(record,source){
  const actual=previewCommissioning(source,record.review.document);
  if(!same(actual,record.review))fail('KIWIS_REVIEW_CHANGED','The original sources and decisions do not reproduce this commissioning edition.');
  return record;
}
export async function readCommissioningReview({project,reviewId}){
  const record=await readSavedCommissioningReview({project,reviewId}),{source}=await readCommissioningSource({project,sourceId:record.sourceId});
  return reproduceCommissioningReview(record,source);
}
export async function listCommissioning({project}){
  const folder=await directory(project),sources=[],reviews=[];
  for(const [kind,target]of [['sources',sources],['reviews',reviews]]){
    const dir=await privateDirectory(join(folder,kind));
    for(const name of (await readdir(dir)).sort()){
      if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}\.json$/.test(name))continue;
      const record=await readPrivateJson(join(dir,name),LIMIT);
      if(kind==='sources'){
        const {inputSha256,sourceSha256,...input}=record;
        if(inputSha256!==digest(canonical(input)))fail('KIWIS_SOURCE_CHANGED','The saved source inventory changed.');
        target.push({sourceId:record.sourceId,sourceSha256,inputSha256,counterpart:record.counterpart.kind,
          series:record.capture.selection.series});
      }else{reviewed(record);target.push({reviewId:record.reviewId,sourceId:record.sourceId,title:record.title,
        savedSha256:record.savedSha256,reviewSha256:record.review.reviewSha256,counts:record.review.counts});}
    }
  }
  return {sources,reviews};
}
export async function compareCommissioningEditions({project,sourceId,reviewId,previousReviewId}){
  const prior=await readSavedCommissioningReview({project,reviewId:previousReviewId}),
    current=reviewId?(reviewId===previousReviewId?prior:await readSavedCommissioningReview({project,reviewId})):null;
  if(current&&sourceId&&sourceId!==current.sourceId)fail('KIWIS_SOURCE_CHANGED','Compare the current saved review against its exact source edition.');
  const currentSourceId=current?.sourceId??sourceId,{source}=await readCommissioningSource({project,sourceId:currentSourceId}),
    previous=currentSourceId===prior.sourceId?source:(await readCommissioningSource({project,sourceId:prior.sourceId})).source;
  reproduceCommissioningReview(prior,previous);
  if(current){if(current!==prior)reproduceCommissioningReview(current,source);return compareCommissioningReviews(source,previous,current,prior);}
  return compareCommissioningSources(source,previous,prior.review.document);
}
export async function exportCommissioningReview({project,reviewId,format}){
  const saved=await readCommissioningReview({project,reviewId}),{source,input}=await readCommissioningSource({project,sourceId:saved.sourceId});
  if(format==='bundle'){
    const body={schema:'starforge.kiwis-commissioning-bundle.v1',input,review:saved};
    const bytes=Buffer.from(json({...body,bundleSha256:digest(canonical(body))}));
    if(bytes.length>LIMIT)fail('KIWIS_SIZE','The complete source/decision transfer exceeds the declared 256 MiB receiving allowance.');
    return {filename:reviewId+'-complete-commissioning.json',mime:'application/json',bytes};
  }
  return commissioningFile({source,saved,format});
}
export async function receiveCommissioningReview({project,bundle}){
  if(bundle?.schema!=='starforge.kiwis-commissioning-bundle.v1')fail('KIWIS_BUNDLE','Open the complete original commissioning bundle.');
  const {bundleSha256,...body}=bundle;
  if(Buffer.byteLength(json(bundle))>LIMIT||digest(canonical(body))!==bundleSha256)fail('KIWIS_BUNDLE_CHANGED','The complete original source and review bundle changed.');
  if(!same(Object.keys(bundle).sort(),['bundleSha256','input','review','schema']))
    fail('KIWIS_BUNDLE_CHANGED','Retain exactly the complete version-one commissioning envelope.');
  const saved=reviewed(bundle.review),input=bundle.input;
  if(!input||typeof input!=='object'||Array.isArray(input)||input.schema!=='starforge.kiwis-commissioning-input.v1'||
    !same(Object.keys(input).sort(),['capture','counterpart','inputSha256','schema','sourceId','sourceSha256']))
    fail('KIWIS_BUNDLE_CHANGED','Retain exactly the complete original source input and its bindings.');
  if(input.sourceId!==saved.sourceId)fail('KIWIS_BUNDLE_CHANGED','The review and original source names differ.');
  const {inputSha256,sourceSha256,...original}=input;
  if(digest(canonical(original))!==inputSha256||sourceSha256!==saved.review.sourceSha256)fail('KIWIS_BUNDLE_CHANGED','The complete source binding changed.');
  const receivedSource=await saveCommissioningSource({project,sourceId:input.sourceId,capture:input.capture,counterpart:input.counterpart});
  if(receivedSource.inputSha256!==inputSha256||receivedSource.sourceSha256!==sourceSha256)
    fail('KIWIS_BUNDLE_CHANGED','The receiving project did not preserve this exact complete source input.');
  const received=await saveCommissioningReview({project,sourceId:saved.sourceId,reviewId:saved.reviewId,title:saved.title,
    document:saved.review.document,expectedReviewSha256:saved.review.reviewSha256});
  if(received.savedSha256!==saved.savedSha256)fail('KIWIS_BUNDLE_CHANGED','The receiving project did not reproduce this complete review.');
  return received;
}
