// MIT. One private GDELT project, explicit reviewed editions and replayable actions.
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJson, readPrivateJson, withPrivateLock } from '../routescan/quota.mjs';
import { PROJECT, BUNDLE, LIMITS, ATTRIBUTION, NOTICE, need, plain, canonical, clone, hash, digest,
  jsonBytes, isHash, operationId, projectionPolicy, selectedRows, schemaDocument, collectionRows, compareModels } from './model.mjs';
import { durableDirectory, exactFile, optionalJson, captureGdelt, inspectGdeltCapture, verifyGdeltCapture,
  readGdeltCapture, storeGdeltCapture } from './source.mjs';
import { GKG_TABLES, GKG_NOTICE, isGkgTable, gkgCoverage } from './gkg.mjs';

const STATE_BYTES=8*1024*1024;
function validState(state) {
  need(state?.schema===PROJECT&&typeof state.id==='string'&&/^[a-f0-9-]{36}$/.test(state.id)&&
    typeof state.title==='string'&&Number.isSafeInteger(state.revision)&&state.revision>=1&&
    ['captures','reviews','publications','operations'].every(name=>Array.isArray(state[name]))&&
    (state.pending===null||plain(state.pending)),'Retained GDELT project state changed.');
  return state;
}
export async function readGdeltProject(directory) {
  return validState(await readPrivateJson(join(resolve(directory),'project.json'),STATE_BYTES));
}
export async function initializeGdeltProject({directory,title='GDELT event desk'}={}) {
  directory=await durableDirectory(directory);
  need(typeof title==='string'&&title.trim()&&title.length<=128&&!/[\x00-\x1f\x7f]/.test(title),'Give the project a plain title up to128 characters.');
  return withPrivateLock(directory,'project.lock',async()=>{
    const existing=await optionalJson(join(directory,'project.json'),STATE_BYTES);
    if(existing) { validState(existing);need(existing.title===title,'This directory already retains another project title.','GDELT_PROJECT_EXISTS',409);return existing; }
    const receiving=await optionalJson(join(directory,'receiving.json'));
    const prepared=await optionalJson(join(directory,'received-prepared.json'));
    const received=await optionalJson(join(directory,'received.json'));
    need(receiving===null&&prepared===null&&received===null,
      'This directory retains an original project receiving operation. Resume receive with the same complete bundle before opening the workspace.',
      'GDELT_RECEIVING_PENDING',409);
    const state={schema:PROJECT,id:randomUUID(),title,revision:1,createdAt:new Date().toISOString(),
      selectedCapture:null,selectedReview:null,captures:[],reviews:[],publications:[],operations:[],pending:null};
    await atomicJson(directory,'project.json',state);return state;
  });
}
async function transact(directory,{id,expectedRevision,kind,payload},apply) {
  directory=await durableDirectory(directory);operationId(id);
  need(Number.isSafeInteger(expectedRevision)&&expectedRevision>=1,'Use the project revision being reviewed.');
  const fingerprint=digest({kind,payload});
  return withPrivateLock(directory,'project.lock',async()=>{
    const state=await readGdeltProject(directory),previous=state.operations.find(item=>item.id===id);
    if(previous) {
      need(previous.fingerprint===fingerprint,'This operation ID retains another action.','GDELT_OPERATION_CONFLICT',409);
      return {...clone(previous.result),replayed:true,currentRevision:state.revision};
    }
    need(state.revision===expectedRevision,'The project changed; read its current revision.','GDELT_REVISION_CONFLICT',409);
    if(state.pending)need(state.pending.id===id&&state.pending.fingerprint===fingerprint,'Resume the retained operation or record its abandonment before another mutation.','GDELT_OPERATION_PENDING',409);
    else {
      need(state.operations.length<10000,'This project has reached its retained operation capacity; export the full project.');
      state.pending={id,kind,fingerprint,payload:clone(payload),expectedRevision,startedAt:new Date().toISOString(),lastError:null};
      await atomicJson(directory,'project.json',state);
    }
    try {
      const outcome=await apply(state,directory),revision=state.revision+1;
      const result={...outcome,revision};
      state.revision=revision;state.pending=null;
      state.operations.push({id,kind,fingerprint,completedAt:new Date().toISOString(),result});
      need(jsonBytes(state).length<=STATE_BYTES,'Project history exceeds its8 MiB index capacity.');
      await atomicJson(directory,'project.json',state);return result;
    } catch(error) {
      const saved=await readGdeltProject(directory);
      if(saved.pending?.id===id) {
        saved.pending.lastError={code:error.code??'GDELT_OPERATION_INTERRUPTED',message:String(error.message).slice(0,2048),
          at:new Date().toISOString(),retryAt:error.retryAt??null};
        await atomicJson(directory,'project.json',saved);
      }
      throw error;
    }
  });
}
function captureDirectory(directory,id) {
  need(isHash(id),'Select a retained source capture ID.');
  return join(resolve(directory),'captures',id);
}
export async function getGdeltCapture(directory,id) {
  const state=await readGdeltProject(directory);
  need(state.captures.some(item=>item.id===id),'Capture does not belong to this project.','GDELT_CAPTURE_UNKNOWN',404);
  const capture=await readGdeltCapture(captureDirectory(directory,id));
  need(capture.captureId===id,'Retained source capture changed.');return capture;
}
async function adopt(state,directory,capture,options={}) {
  const model=await verifyGdeltCapture(capture,options);
  if(!state.captures.some(item=>item.id===capture.captureId)) {
    need(state.captures.length<LIMITS.captures,'A project supports32 complete source editions; export this project before extending it.');
    const bytes=jsonBytes(capture).length;
    need(state.captures.reduce((sum,item)=>sum+item.bytes,0)+bytes<=LIMITS.projectBytes,'Retained original captures exceed256 MiB.');
    await storeGdeltCapture(captureDirectory(directory,capture.captureId),capture,{verified:true});
    state.captures.push({id:capture.captureId,batch:model.batch,counts:model.counts,bytes,sources:model.sources,
      ...(model.format==='gkg'?{format:'gkg'}:{})});
  }
  state.selectedCapture=capture.captureId;
  return {captureId:capture.captureId,batch:model.batch,counts:model.counts,...(model.format==='gkg'?{format:'gkg'}:{})};
}
export async function acquireGdeltCapture({directory,id,expectedRevision,batch,manifest,format='events-mentions',signal,fetchImpl,python,onProgress}={}) {
  need(['events-mentions','gkg'].includes(format),'Choose the original source family.');
  return transact(directory,{id,expectedRevision,kind:'capture',payload:{batch:batch??null,manifest:manifest??null,...(format==='gkg'?{format}:{})}},
    async(state,root)=>{
      const acquired=await captureGdelt({directory:join(root,'acquisitions',id),batch,manifest,format,signal,fetchImpl,python,onProgress});
      // The same capture() invocation already decoded every selected original archive.
      const model=inspectGdeltCapture(acquired.capture);
      if(!state.captures.some(item=>item.id===acquired.capture.captureId)) {
        const bytes=jsonBytes(acquired.capture).length;
        need(state.captures.length<LIMITS.captures&&state.captures.reduce((sum,item)=>sum+item.bytes,0)+bytes<=LIMITS.projectBytes,'Project source capacity is full.');
        await storeGdeltCapture(captureDirectory(root,acquired.capture.captureId),acquired.capture,{verified:true});
        state.captures.push({id:acquired.capture.captureId,batch:model.batch,counts:model.counts,bytes,sources:model.sources,
          ...(model.format==='gkg'?{format:'gkg'}:{})});
      }
      state.selectedCapture=acquired.capture.captureId;
      return {captureId:acquired.capture.captureId,batch:model.batch,counts:model.counts,acquisitionId:id,reusedSource:acquired.reused,
        ...(model.format==='gkg'?{format:'gkg'}:{})};
    });
}
export async function importGdeltCapture({directory,id,expectedRevision,capture,signal,python}={}) {
  inspectGdeltCapture(capture);
  return transact(directory,{id,expectedRevision,kind:'import',payload:{captureId:capture.captureId}},
    (state,root)=>adopt(state,root,capture,{signal,python}));
}
export async function selectGdeltCapture({directory,id,expectedRevision,captureId}={}) {
  return transact(directory,{id,expectedRevision,kind:'select',payload:{captureId}},async state=>{
    need(state.captures.some(item=>item.id===captureId),'Choose an original retained source.');
    state.selectedCapture=captureId;return {captureId};
  });
}
export async function selectedCaptures(directory,captureIds) {
  need(Array.isArray(captureIds)&&captureIds.length>=1&&captureIds.length<=LIMITS.captures&&
    captureIds.every(isHash)&&new Set(captureIds).size===captureIds.length,'Select one to32 distinct original source captures.');
  const captures=[];
  for(const id of captureIds)captures.push(await getGdeltCapture(directory,id));
  captures.sort((a,b)=>a.batch.localeCompare(b.batch)||a.captureId.localeCompare(b.captureId));
  need(new Set(captures.map(item=>item.batch)).size===captures.length,'Choose exactly one source edition per update timestamp.');
  return captures;
}
export async function gdeltRows({directory,captureIds,policy,offset=0,limit=100}={}) {
  need(Number.isSafeInteger(offset)&&offset>=0&&Number.isInteger(limit)&&limit>=1&&limit<=1000,'Choose a valid row page.');
  const captures=await selectedCaptures(directory,captureIds),models=captures.map(inspectGdeltCapture);
  const selected=selectedRows(models,policy);
  return {schema:'stellar-forge.gdelt-row-view.v1',captureIds:captures.map(item=>item.captureId),policy:selected.policy,
    sourceRows:selected.sourceRows,total:selected.rows.length,offset,limit,rows:selected.rows.slice(offset,offset+limit),
    attribution:ATTRIBUTION,notice:isGkgTable(selected.policy.table)?GKG_NOTICE:NOTICE};
}
export async function reviewGdeltCapture({directory,id,expectedRevision,captureIds,policy={},note='',name='GDELT event dataset'}={}) {
  policy=projectionPolicy(policy);
  need(typeof note==='string'&&note.length<=8000&&typeof name==='string'&&name.trim()&&name.length<=128&&!/[\x00-\x1f\x7f]/.test(name),'Give the review a plain dataset name and note up to8000 characters.');
  need(Array.isArray(captureIds)&&captureIds.length>=1&&captureIds.length<=LIMITS.captures&&
    captureIds.every(isHash)&&new Set(captureIds).size===captureIds.length,'Choose distinct original source captures.');
  const sorted=[...captureIds].sort();
  return transact(directory,{id,expectedRevision,kind:'review',payload:{captureIds:sorted,policy,note,name}},async(state,root)=>{
    const captures=await selectedCaptures(root,sorted),ids=captures.map(item=>item.captureId),models=captures.map(inspectGdeltCapture);
    const selected=selectedRows(models,policy),related=isGkgTable(policy.table)?null:collectionRows(models,'related-mentions');
    const coverage=isGkgTable(policy.table)?gkgCoverage(models):{
      events:models.reduce((sum,item)=>sum+item.events.length,0),mentions:related.length,
      matchedMentions:related.filter(row=>row.event_match==='MATCHED').length,
      unrepresentedMentions:related.filter(row=>row.event_match==='NOT_IN_COLLECTION').length,
      ambiguousMentions:related.filter(row=>row.event_match==='AMBIGUOUS').length};
    const reviewId=digest({captureIds:ids,policy,note,name});
    let review=state.reviews.find(item=>item.id===reviewId);
    if(!review) {
      review={schema:'stellar-forge.gdelt-review.v1',id:reviewId,captureIds:ids,policy,note,name,
        reviewedAt:new Date().toISOString(),rowCount:selected.rows.length,sourceRows:selected.sourceRows,
        batches:captures.map(item=>item.batch),coverage,
        semantics:schemaDocument(policy,ids),attribution:ATTRIBUTION};
      const reviews=await durableDirectory(join(root,'reviews'));
      const prior=await optionalJson(join(reviews,reviewId+'.json'),2*1024*1024);
      if(prior) {
        need(prior.id===reviewId&&canonical({...prior,reviewedAt:null})===canonical({...review,reviewedAt:null}),'Retained review content changed.');
        review=prior;
      } else await exactFile(reviews,reviewId+'.json',jsonBytes(review));
      state.reviews.push(review);
    }
    state.selectedReview=reviewId;return {reviewId,captureIds:ids,rowCount:review.rowCount,coverage:review.coverage};
  });
}
export async function getGdeltReview(directory,reviewId) {
  const state=await readGdeltProject(directory),review=state.reviews.find(item=>item.id===reviewId);
  need(review&&review.id===digest({captureIds:review.captureIds,policy:projectionPolicy(review.policy),note:review.note,name:review.name}),
    'Select an unchanged retained source review.','GDELT_REVIEW_UNKNOWN',404);
  const file=await readPrivateJson(join(resolve(directory),'reviews',reviewId+'.json'),2*1024*1024);
  need(canonical(file)===canonical(review),'Project review differs from its original source file.');return review;
}
export async function compareGdeltCaptures({directory,before,after}={}) {
  const a=await getGdeltCapture(directory,before),b=await getGdeltCapture(directory,after);
  return {...compareModels(inspectGdeltCapture(a),inspectGdeltCapture(b)),beforeCapture:before,afterCapture:after};
}
export async function publishGdeltReview({directory,id,expectedRevision,reviewId,origin,path='/gdelt',payment}={}) {
  const parsed=new URL(origin);
  need(parsed.protocol==='https:'&&!parsed.username&&!parsed.password&&!parsed.search&&!parsed.hash&&
    parsed.pathname==='/'&&origin.replace(/\/$/,'')===parsed.origin,'Choose the merchant’s public HTTPS origin.');
  origin=parsed.origin;
  return transact(directory,{id,expectedRevision,kind:'publish',payload:{reviewId,origin,path,payment}},async(state,root)=>{
    const review=await getGdeltReview(root,reviewId),captures=await selectedCaptures(root,review.captureIds);
    const publicationId=digest({reviewId,origin,path,payment}),location=join(root,'publications',publicationId);
    const {prepareGdeltEdition,stageGdeltMerchant}=await import('./merchant.mjs');
    const edition=await prepareGdeltEdition({directory:location,captures,review});
    const plan=await stageGdeltMerchant({directory:location,origin,path,payment});
    const result={publicationId,reviewId,captureIds:review.captureIds,editionId:edition.editionId,
      snapshot:edition.snapshot,sourceSnapshot:edition.sourceSnapshot,resource:plan.resource,sourceResource:plan.sourceResource};
    if(!state.publications.some(item=>item.id===publicationId))state.publications.push({id:publicationId,...result});
    return result;
  });
}
export async function selectGdeltPublication(directory,id) {
  need(isHash(id),'Select a publication ID.');
  const state=await readGdeltProject(directory);
  need(state.publications.some(item=>item.id===id),'Publication does not belong to this project.','GDELT_PUBLICATION_UNKNOWN',404);
  return join(resolve(directory),'publications',id);
}
export async function abandonGdeltOperation({directory,id,expectedRevision,pendingId,note=''}={}) {
  directory=await durableDirectory(directory);operationId(id);operationId(pendingId);
  need(typeof note==='string'&&note.length<=8000,'Use a plain abandonment note.');
  return withPrivateLock(directory,'project.lock',async()=>{
    const state=await readGdeltProject(directory),old=state.operations.find(item=>item.id===id);
    const fingerprint=digest({kind:'abandon',pendingId,note});
    if(old){need(old.fingerprint===fingerprint,'Operation ID belongs to another action.');return {...old.result,replayed:true};}
    need(state.revision===expectedRevision&&state.pending?.id===pendingId,'Select the current pending operation.','GDELT_REVISION_CONFLICT',409);
    const abandoned=clone(state.pending);state.pending=null;state.revision++;
    const result={state:'ABANDONED',pendingId,note,revision:state.revision};
    state.operations.push({id,kind:'abandon',fingerprint,abandoned,completedAt:new Date().toISOString(),result});
    await atomicJson(directory,'project.json',state);return result;
  });
}
export async function exportGdeltProject({directory}={}) {
  directory=resolve(directory);
  return withPrivateLock(directory,'project.lock',async()=>{
    const state=await readGdeltProject(directory);
    need(state.pending===null,'Finish or explicitly abandon the original pending operation before exporting.','GDELT_OPERATION_PENDING',409);
    const captures=[];
    for(const item of state.captures)captures.push(await getGdeltCapture(directory,item.id));
    const publications=[];
    for(const item of state.publications) {
      const location=await selectGdeltPublication(directory,item.id);
      const plan=await readPrivateJson(join(location,'merchant-plan.json'),4*1024*1024);
      publications.push({id:item.id,reviewId:item.reviewId,origin:plan.origin,path:plan.path,payment:plan.payment});
    }
    const body={schema:BUNDLE,state,captures,publications,attribution:ATTRIBUTION};
    const bundle={...body,bundleSha256:digest(body)};
    need(jsonBytes(bundle).length<=LIMITS.projectBytes,'Complete project bundle exceeds256 MiB.','GDELT_PROJECT_TOO_LARGE',413);
    return bundle;
  });
}
function receivedLineage(current,state) {
  validState(current);
  const inherited=['captures','reviews','publications','operations'].every(name=>
    state[name].every(original=>current[name].some(value=>value.id===original.id&&canonical(value)===canonical(original))));
  need(current.id===state.id&&current.createdAt===state.createdAt&&current.revision>=state.revision&&inherited,
    'This destination does not retain the original received project lineage.','GDELT_RECEIVING_CONFLICT',409);
}
async function inspectReceivedClosure(directory,state,body,{signal}={}) {
  for(const original of body.captures) {
    signal?.throwIfAborted();
    need(state.captures.some(item=>item.id===original.captureId),'Unexpected capture in project bundle.');
    const capture=await getGdeltCapture(directory,original.captureId);
    need(canonical(capture)===canonical(original),'The original received source capture changed.','GDELT_RECEIVING_CONFLICT',409);
  }
  for(const original of state.reviews) {
    signal?.throwIfAborted();
    const review=await getGdeltReview(directory,original.id);
    need(canonical(review)===canonical(original),'The original received review changed.','GDELT_RECEIVING_CONFLICT',409);
  }
  if(body.publications.length) {
    const {readGdeltMerchant}=await import('./merchant.mjs');
    for(const publication of body.publications) {
      signal?.throwIfAborted();
      const expected=state.publications.find(item=>item.id===publication.id);
      const review=state.reviews.find(item=>item.id===publication.reviewId);
      need(expected&&review&&publication.id===digest({reviewId:review.id,origin:publication.origin,path:publication.path,payment:publication.payment}),
        'Original publication identity changed.');
      const {edition,plan}=await readGdeltMerchant(join(directory,'publications',publication.id));
      need(edition.editionId===expected.editionId&&edition.reviewId===review.id&&
        canonical(edition.captureIds)===canonical(review.captureIds)&&edition.snapshot===expected.snapshot&&
        edition.sourceSnapshot===expected.sourceSnapshot&&plan.resource===expected.resource&&plan.sourceResource===expected.sourceResource&&
        plan.origin===publication.origin&&plan.path===publication.path&&canonical(plan.payment)===canonical(publication.payment),
        'The original received merchant edition changed.','GDELT_RECEIVING_CONFLICT',409);
    }
  }
}
export async function receiveGdeltProject({directory,bundle,signal,python}={}) {
  const {bundleSha256,...body}=bundle??{};
  need(body.schema===BUNDLE&&isHash(bundleSha256)&&bundleSha256===digest(body)&&Array.isArray(body.captures)&&
    Array.isArray(body.publications),'Select a complete original GDELT project bundle.');
  const state=validState(clone(body.state));
  need(state.pending===null&&body.captures.length===state.captures.length&&new Set(body.captures.map(item=>item.captureId)).size===body.captures.length,
    'Receiving source inventory differs from the completed project.');
  need(body.publications.length===state.publications.length&&new Set(body.publications.map(item=>item.id)).size===body.publications.length,
    'Receiving publication plans differ from the project.');
  directory=await durableDirectory(directory);
  return withPrivateLock(directory,'project.lock',async()=>{
    const receipt=await optionalJson(join(directory,'received.json'));
    if(receipt) {
      need(receipt.schema==='stellar-forge.gdelt-project-receipt.v1'&&receipt.bundleSha256===bundleSha256&&receipt.projectId===state.id,
        'This destination already received another project.','GDELT_RECEIVING_CONFLICT',409);
      const current=await readGdeltProject(directory);
      receivedLineage(current,state);
      need(receipt.captures===state.captures.length&&receipt.reviews===state.reviews.length&&
        receipt.publications===state.publications.length&&receipt.revision===state.revision&&
        (receipt.originalIndexSha256===undefined||receipt.originalIndexSha256===digest(state)),
        'The original receiving receipt changed.','GDELT_RECEIVING_CONFLICT',409);
      await inspectReceivedClosure(directory,state,body,{signal});
      return {...receipt,revision:current.revision,reused:true};
    }
    const current=await optionalJson(join(directory,'project.json'),STATE_BYTES);
    const intent={schema:'stellar-forge.gdelt-receiving-intent.v1',bundleSha256,projectId:state.id};
    const prior=await optionalJson(join(directory,'receiving.json'));
    need(prior===null||canonical(prior)===canonical(intent),'Another original bundle owns this receiving operation.','GDELT_RECEIVING_CONFLICT',409);
    if(current!==null){
      // A published index is usable immediately. A lost final receipt must not
      // roll back its later legitimate customer operations on same-bundle retry.
      receivedLineage(current,state);
      need(prior!==null||canonical(current)===canonical(state),
        'This destination does not retain the original receiving binding.','GDELT_RECEIVING_CONFLICT',409);
    }
    if(prior===null)await atomicJson(directory,'receiving.json',intent);
    for(const capture of body.captures) {
      need(state.captures.some(item=>item.id===capture.captureId),'Unexpected capture in project bundle.');
      await storeGdeltCapture(captureDirectory(directory,capture.captureId),capture,{signal,python});
    }
    const reviews=await durableDirectory(join(directory,'reviews'));
    for(const review of state.reviews) {
      need(review.id===digest({captureIds:review.captureIds,policy:projectionPolicy(review.policy),note:review.note,name:review.name}),
        'An original reviewed edition changed.');
      await exactFile(reviews,review.id+'.json',jsonBytes(review));
    }
    const {prepareGdeltEdition,stageGdeltMerchant}=await import('./merchant.mjs');
    for(const publication of body.publications) {
      const expected=state.publications.find(item=>item.id===publication.id),review=state.reviews.find(item=>item.id===publication.reviewId);
      need(expected&&review&&publication.id===digest({reviewId:review.id,origin:publication.origin,path:publication.path,payment:publication.payment}),
        'Original publication identity changed.');
      const location=join(directory,'publications',publication.id);
      const captures=review.captureIds.map(id=>{const found=body.captures.find(item=>item.captureId===id);need(found,'Review source is missing.');return found;});
      const edition=await prepareGdeltEdition({directory:location,captures,review});
      const plan=await stageGdeltMerchant({directory:location,origin:publication.origin,path:publication.path,payment:publication.payment});
      need(edition.editionId===expected.editionId&&edition.snapshot===expected.snapshot&&edition.sourceSnapshot===expected.sourceSnapshot&&
        plan.resource===expected.resource&&plan.sourceResource===expected.sourceResource,'Original merchant edition changed during offline receiving.');
    }
    const identity={schema:'stellar-forge.gdelt-project-receipt.v1',bundleSha256,projectId:state.id,
      captures:state.captures.length,reviews:state.reviews.length,publications:state.publications.length,
      revision:state.revision,originalIndexSha256:digest(state)};
    let result=await optionalJson(join(directory,'received-prepared.json'));
    if(result){
      need(Object.entries(identity).every(([key,value])=>result[key]===value)&&
        typeof result.receivedAt==='string'&&Number.isFinite(Date.parse(result.receivedAt)),
        'The original receiving publication record changed.','GDELT_RECEIVING_CONFLICT',409);
    }else{
      result={...identity,receivedAt:new Date().toISOString()};
      // Complete source closure and its binding precede the normally openable
      // index. Atomic rename+directory fsync preserves this publication boundary.
      await atomicJson(directory,'received-prepared.json',result);
    }
    if(current===null)await atomicJson(directory,'project.json',state);
    await atomicJson(directory,'received.json',result);
    return {...result,revision:current?.revision??state.revision,reused:current!==null};
  });
}
export async function gdeltProjectView(directory) {
  const state=await readGdeltProject(directory);
  return {...clone(state),attribution:ATTRIBUTION,notice:NOTICE,
    capabilities:{tables:['events','mentions','related-mentions',...GKG_TABLES],sourceFormats:['events-mentions','gkg'],maxCaptures:LIMITS.captures,
      maxRows:LIMITS.rows,standardZipDecoder:'Python3.11+',sourceFiles:'Original paginated dataset transport'}};
}
