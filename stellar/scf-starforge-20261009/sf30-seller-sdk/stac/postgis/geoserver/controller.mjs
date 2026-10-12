// MIT. Accepted PostGIS edition -> original GeoServer service publication and recovery.
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { readPrivate, readJson, bytes, digest, identity, atomicJson, syncDirectory } from '../../../postgres/publisher/files.mjs';
import { durableDirectory } from '../../../wfs/source.mjs';
import { normalizeProfile, normalizeSelection, validateReceipt, operationId, hash, absolute, need,
  publicProfile, REQUEST_SCHEMA, REVIEW_SCHEMA, same, MiB, parseExactJSON, nativeBytes } from './contract.mjs';
import { openPublicationJournal, optionalJson, readReceiving, verifyFile } from './journal.mjs';
import { createGeoServerService, responseJson, retryAt } from './transport.mjs';
import { readCatalog, buildReview, readStep, mutationFor, featureScope, marker,
  resourceFingerprint, assertDatastore, paths, describeGeoServerTarget } from './catalog.mjs';
import { receivePublication } from './receiving.mjs';
import { exportPublication } from './handover.mjs';
import { inspectStyle } from './xml.mjs';
import { createGeoServerArchive } from './archive.mjs';

const now=()=>new Date().toISOString();
const errorRecord=error=>({code:error.code??error.name??'GEOSERVER_OPERATION_ERROR',
  message:String(error.message??error).slice(0,4096),at:now(),...(error.status?{status:error.status}:{})});
function desiredScope(step,direction='forward'){
  const target=direction==='reverse'?step.before:step.desired;
  if(step.kind==='style')return target===null?null:{sha256:target.body.sha256,format:target.format};
  return target;
}
function createdFeatureMatches(step,observed,record){
  if(step.kind!=='feature'||step.before!==null||!observed.document||
    record.appliedEffect||record.state==='APPLIED')return false;
  if(record.createdEffect&&resourceFingerprint(observed.document)!==record.createdEffect.fingerprint)return false;
  const desired=step.desired,current=featureScope(observed.document);
  // GeoServer's original FeatureType POST initializes enabled=true. The following
  // field-scoped PUT completes an explicitly disabled selection with the same owner.
  return current.marker===desired.marker&&same({...current,enabled:desired.enabled},desired);
}
function rememberEffect(record,observed,kind='applied'){
  const key=kind==='created'?'createdEffect':'appliedEffect';
  // A later observation never becomes the deletion baseline of an existing
  // applied resource. An owned CREATED -> APPLIED transition has two baselines.
  record[key]??={postimage:structuredClone(observed.document),
    fingerprint:resourceFingerprint(observed.document),appliedScope:structuredClone(observed.value)};
  const retained=record.appliedEffect??record.createdEffect;
  if(retained){record.postimage=retained.postimage;record.fingerprint=retained.fingerprint;record.appliedScope=retained.appliedScope;}
  record.latestObservation={postimage:structuredClone(observed.document),
    fingerprint:resourceFingerprint(observed.document),scope:structuredClone(observed.value),at:now()};
}
async function layerCreatedByOperation(service,journal,step,record,observed,signal){
  if(step.kind!=='layer'||step.before!==null||!observed.document||
    record.appliedEffect||record.state==='APPLIED')return false;
  if(record.createdEffect)return resourceFingerprint(observed.document)===record.createdEffect.fingerprint;
  const response=await service.request({path:step.featurePath,signal});
  await journal.response(response);
  const feature=responseJson(response).featureType;
  const created=marker(feature)===step.owner&&observed.value.resource===step.desired.resource;
  if(created)rememberEffect(record,observed,'created');
  return created;
}
export async function openGeoServerPublisher({directory,profile:input,verifyReceiving,environment=process.env,fetchImpl,hostSources=[],nativeBinding=null}={}){
  const profile=normalizeProfile(input);
  need(typeof verifyReceiving==='function','POSTGIS_NATIVE_VERIFIER_REQUIRED',
    'Compose the original PostGIS controller receipt verifier for this selected database.');
  const journal=await openPublicationJournal(absolute(directory),profile,{hostSources,nativeBinding});
  let service;
  try{service=createGeoServerService({profile,environment,fetchImpl});}
  catch(error){try{await journal.close();}catch(cleanup){error.cleanupError=errorRecord(cleanup);}throw error;}
  const lifetime=new AbortController(),reads=new Set();let admission=true,closing=null,closed=false;
  let tail=Promise.resolve(),current=null;
  function queue(id,work,signal){
    if(!admission)return Promise.reject(Object.assign(new Error('The GeoServer operator is draining.'),{code:'GEOSERVER_CLOSED'}));
    const local=new AbortController(),combined=AbortSignal.any([lifetime.signal,local.signal,...(signal?[signal]:[])]);
    const task=tail.catch(()=>{}).then(async()=>{
      combined.throwIfAborted();current={id,controller:local,startedAt:now()};
      try{return await work(combined);}finally{current=null;}
    });
    tail=task;return task;
  }
  function read(work){
    if(!admission)return Promise.reject(Object.assign(new Error('The GeoServer operator is draining.'),{code:'GEOSERVER_CLOSED'}));
    const task=Promise.resolve().then(work);reads.add(task);
    task.then(()=>reads.delete(task),()=>reads.delete(task));return task;
  }
  async function head(){return optionalJson(join(directory,'publication.json'));}
  async function checkHead(request){
    const retained=await head();
    need(!retained||retained.projectId===request.projectId,'GEOSERVER_PROJECT_CHANGED',
      'Use the original project publication workspace.',409);
    need((retained?.operationId??null)===request.expectedPublication||retained?.operationId===request.operationId,
      'GEOSERVER_PUBLICATION_CHANGED','Review the current retained publication before changing its service.',409);
  }
  async function nativeCheck(request,state,signal,phase){
    signal.throwIfAborted();
    const receiptDirectory=join(directory,'receipts',request.manifestSha256);
    const original=await readPrivate(join(receiptDirectory,'postgis-receiving.json'),64*MiB);
    need(digest(original)===request.manifestSha256,'POSTGIS_RECEIVING_MANIFEST_CHANGED');
    const receipt=validateReceipt(parseExactJSON(new TextDecoder('utf-8',{fatal:true}).decode(original)));
    need(receipt.projectId===request.projectId,'POSTGIS_PROJECT_CHANGED');
    // This host-owned function is the original database authority. It must reject
    // stale editions, changed relations/roles, or changed receiving bytes.
    const layerIds=request.layers.map(layer=>layer.layerId);
    const native=await verifyReceiving({directory:receiptDirectory,expectedManifestSha256:request.manifestSha256,
      role:profile.database.role,requireUnchangedRows:true,layerIds,signal});
    signal.throwIfAborted();
    need(native?.verified === true && native.manifestFile?.sha256 === request.manifestSha256 &&
      native.current?.projectId === receipt.projectId && native.current.editionId === receipt.editionId &&
      native.current.revision === receipt.revision && native.current.database === profile.database.name &&
      native.current.role === profile.database.role && native.current.sessionRole === profile.database.role &&
      native.current.readOnly === true && native.observations?.allAcceptedRowsMatch === true,
      'POSTGIS_NATIVE_VERIFICATION_CHANGED', 'Use the original current edition and its verified reader session.', 409);
    const observedLayers=native.observations.layers;
    need(Array.isArray(native.selection?.layerIds)&&same([...native.selection.layerIds].sort(),[...layerIds].sort())&&
      Array.isArray(observedLayers)&&observedLayers.length===layerIds.length&&
      new Set(observedLayers.map(layer=>layer.layerId)).size===layerIds.length&&
      observedLayers.every(layer=>layerIds.includes(layer.layerId)&&layer.role===profile.database.role&&layer.matchesAcceptedRows===true),
      'POSTGIS_NATIVE_LAYER_SELECTION_CHANGED','Receive every selected original layer through the actual datastore reader.',409);
    const observation=await journal.object(nativeBytes(native),{contentType:'application/json'});
    const response=await service.request({path:paths(profile).datastore+'.json',signal});
    await journal.response(response,{private:true});
    const store=responseJson(response)?.dataStore;
    need(store,'GEOSERVER_DATASTORE_RESPONSE');assertDatastore(profile,receipt,store);
    state.databaseChecks??=[];state.databaseChecks.push({phase,at:now(),observation});
    await journal.save(state);return receipt;
  }
  async function failure(state,error){
    state.state='NEEDS_RECONCILIATION';state.error=errorRecord(error);
    state.history.push({state:state.state,...state.error});
    try{await journal.save(state);}catch(storage){error.retentionError=errorRecord(storage);}
    throw error;
  }
  async function load(id){
    operationId(id);const state=await journal.state(id);need(state,'GEOSERVER_OPERATION_NOT_FOUND',undefined,404);
    const request=await journal.request(id);need(state.profileSha256===journal.profileSha256,'GEOSERVER_PROFILE_CHANGED');
    return {state,request};
  }
  async function prepare(input,{signal}={}){
    operationId(input.operationId);absolute(input.receivingDirectory);hash(input.manifestSha256);
    return queue(input.operationId,async signal=>{
      const existing=await journal.state(input.operationId);
      const oldRequest=existing?await journal.request(input.operationId):null;
      const receiptSource=existing?join(directory,'receipts',input.manifestSha256):input.receivingDirectory;
      let originalReceipt;
      try{originalReceipt=await readReceiving(receiptSource,input.manifestSha256,{signal});}
      catch(error){if(error.code!=='ENOENT'||!existing)throw error;
        originalReceipt=await readReceiving(input.receivingDirectory,input.manifestSha256,{signal});}
      const receipt=originalReceipt.receipt;
      const selection=normalizeSelection(input.layers,receipt,profile),selectedHead=await head();
      const expectedPublication=input.expectedPublication===undefined
        ? (oldRequest?oldRequest.expectedPublication:selectedHead?.operationId??null) : input.expectedPublication;
      if(expectedPublication!==null)operationId(expectedPublication);
      const kind=input.kind??'publish';need(['publish','refresh'].includes(kind),'GEOSERVER_PUBLICATION_KIND');
      need(kind!=='refresh'||expectedPublication!==null,'GEOSERVER_REFRESH_ORIGINAL_REQUIRED');
      const request={schema:REQUEST_SCHEMA,operationId:input.operationId,kind,projectId:receipt.projectId,
        receivingDirectory:input.receivingDirectory,manifestSha256:input.manifestSha256,
        profile:publicProfile(profile),layers:selection,expectedPublication};
      const state=await journal.begin(request);
      try{
        await checkHead(request);
        const stored=await optionalJson(join(journal.operationDirectory(state.id),'review.json'));
        if(stored){need(stored.requestSha256===state.requestSha256,'GEOSERVER_REVIEW_CHANGED');
          state.reviewSha256=identity(stored);
          if(state.steps.length===0){state.steps=stored.steps.map(step=>({id:step.id,state:'READY',attempts:[]}));state.state='PREPARED';}
          need(state.steps.length===stored.steps.length&&state.steps.every((row,i)=>row.id===stored.steps[i].id),'GEOSERVER_REVIEW_STEPS_CHANGED');
          if(state.state==='PREPARING')state.state='PREPARED';
          await journal.save(state);return {state,review:stored,reviewSha256:state.reviewSha256};}
        const retained=await journal.retainReceiving(input.receivingDirectory,input.manifestSha256,{signal});
        await nativeCheck(request,state,signal,'prepare');
        const styleSources={};
        for(const selected of selection)if(selected.style.file){
          const styleObserved=await verifyFile(selected.style.file,{maximum:8*MiB,signal});
          need(styleObserved.sha256===selected.style.sha256,'GEOSERVER_STYLE_SOURCE_CHANGED');
          const styleBytes=await readFile(selected.style.file,{signal});
          need(styleBytes.length===styleObserved.bytes&&digest(styleBytes)===selected.style.sha256,'GEOSERVER_STYLE_SOURCE_CHANGED');
          const inspectedStyle=await inspectStyle(styleBytes,{python:profile.python,signal});
          need(inspectedStyle.format===selected.style.format,'GEOSERVER_STYLE_FORMAT_CHANGED');
          const key=[selected.style.workspace,selected.style.name].join(':');
          const source=await journal.object(styleBytes,{contentType:selected.style.format==='se'?
            'application/vnd.ogc.se+xml':'application/vnd.ogc.sld+xml'});
          source.inspection=await journal.object(bytes(inspectedStyle),{contentType:'application/json'});
          need(!styleSources[key]||styleSources[key].sha256===source.sha256,'GEOSERVER_STYLE_SELECTION_CONFLICT');
          styleSources[key]=source;
        }
        const snapshot=await readCatalog(service,journal,retained.receipt,selection,{signal});
        const review=buildReview(request,receipt,snapshot,styleSources);
        await journal.savePlan(state.id,review);
        state.reviewSha256=identity(review);state.state='PREPARED';state.preparedAt=now();
        state.steps=review.steps.map(step=>({id:step.id,state:'READY',attempts:[]}));
        state.history.push({state:'PREPARED',at:state.preparedAt,reviewSha256:state.reviewSha256});
        await journal.save(state);return {state,review,reviewSha256:state.reviewSha256};
      }catch(error){return failure(state,error);}
    },signal);
  }
  async function checkReview(state,input){
    hash(input.reviewSha256);const review=await journal.plan(state.id);
    need(identity(review)===state.reviewSha256&&state.reviewSha256===input.reviewSha256&&
      review.requestSha256===state.requestSha256,'GEOSERVER_REVIEW_CHANGED','Apply the exact retained reviewed request.',409);
    return review;
  }
  async function executeStep(request,state,step,record,signal,direction='forward'){
    const target=desiredScope(step,direction),source=direction==='reverse'?(step.rollbackSource??desiredScope(step)):desiredScope(step,'reverse');
    if(record.state==='SKIPPED')return;
    if(direction==='reverse'&&record.rollbackOf?.state==='UNCHANGED'){record.state='SKIPPED';await journal.save(state);return;}
    for(let phase=0;phase<3;phase++){
      signal.throwIfAborted();
      const observed=await readStep(service,journal,step,{signal});
      const nativeLayer=direction==='forward'&&await layerCreatedByOperation(service,journal,step,record,observed,signal);
      if(same(observed.value,target)){
        const wasAttempted=record.attempts.length>0||nativeLayer||record.appliedEffect||record.state==='APPLIED';
        record.state=wasAttempted?'APPLIED':'UNCHANGED';record.confirmedAt=now();
        record.observed=observed.response;
        if(wasAttempted)rememberEffect(record,observed);
        await journal.save(state);return;
      }
      const intermediate=direction==='forward'&&(createdFeatureMatches(step,observed,record)||nativeLayer);
      need(same(observed.value,source)||intermediate,'GEOSERVER_RESOURCE_CONFLICT',
        'The selected '+step.kind+' changed outside this recorded operation; inspect its current and retained fields.',409);
      if(direction==='reverse'&&target===null&&step.kind!=='rule'){
        const original=record.rollbackOf;
        need(original?.fingerprint&&resourceFingerprint(observed.document)===original.fingerprint,
          'GEOSERVER_CREATED_RESOURCE_CHANGED','A later edit changed the created resource; preserve that edit while reviewing rollback.',409);
      }
      need(!step.observedOnly,'GEOSERVER_REFERENCED_STYLE_CHANGED',
        'The retained referenced style changed after review.',409);
      if(record.retryAt)need(Date.now()>=Date.parse(record.retryAt),'GEOSERVER_PROVIDER_COOLDOWN',
        'Continue the same operation after '+record.retryAt+'.',429);
      await checkHead(request);
      const mutation=await mutationFor(journal,step,observed,{reverse:direction==='reverse'});
      signal.throwIfAborted();
      const attempt={id:record.attempts.length+1,state:'DISPATCHING',startedAt:now(),method:mutation.method,
        path:mutation.path,observedBefore:observed.response,
        ...(mutation.body?{body:await journal.object(Buffer.isBuffer(mutation.body)?mutation.body:Buffer.from(mutation.body),
          {contentType:mutation.contentType??'application/json'})}:{})};
      record.attempts.push(attempt);record.state='DISPATCHING';await journal.save(state);
      const response=await service.request({...mutation,signal});
      attempt.response=await journal.response(response);attempt.finishedAt=now();
      record.retryAt=retryAt(response);attempt.state='RESPONSE';await journal.save(state);
      need([200,201,204].includes(response.status),'GEOSERVER_HTTP_'+response.status,
        'GeoServer returned HTTP '+response.status+' for the retained resource mutation.',response.status>=400?response.status:502);
      const after=await readStep(service,journal,step,{signal});
      attempt.readback=after.response;await journal.save(state);
      if(same(after.value,target)){
        record.state='APPLIED';record.confirmedAt=now();record.observed=after.response;
        rememberEffect(record,after);
        delete record.retryAt;await journal.save(state);return;
      }
      if(direction==='forward'&&createdFeatureMatches(step,after,record)){
        record.state='CREATED';record.observed=after.response;rememberEffect(record,after,'created');
        await journal.save(state);continue;
      }
      throw Object.assign(new Error('The native resource readback differs from the recorded request.'),{code:'GEOSERVER_READBACK_CHANGED',status:409});
    }
    throw Object.assign(new Error('The native resource did not complete its recorded transition.'),{code:'GEOSERVER_TRANSITION_INCOMPLETE'});
  }
  async function finalize(request,state,review,signal){
    await nativeCheck(request,state,signal,'publication-complete');
    await checkHead(request);
    const publication={schema:'starforge.geoserver-current-publication.v1',operationId:state.id,
      projectId:request.projectId,manifestSha256:request.manifestSha256,reviewSha256:state.reviewSha256,
      kind:request.kind,previous:request.expectedPublication,updatedAt:now()};
    await atomicJson(directory,'publication.json',publication);
    state.state=request.kind==='rollback'?'ROLLED_BACK':'PUBLISHED';
    state.appliedAt??=now();delete state.error;
    state.history.push({state:state.state,at:now(),reviewSha256:state.reviewSha256});
    await journal.save(state);return {state,publication,review};
  }
  async function apply(input,{signal}={}){
    operationId(input.operationId);
    return queue(input.operationId,async signal=>{
      const {state,request}=await load(input.operationId),review=await checkReview(state,input);
      if(['PUBLISHED','RECEIVED','EXPORTED','ROLLED_BACK'].includes(state.state))return {state,review,publication:await head()};
      try{
        await checkHead(request);await nativeCheck(request,state,signal,'apply');
        state.state='APPLYING';state.history.push({state:'APPLYING',at:now()});await journal.save(state);
        for(let i=0;i<review.steps.length;i++)
          await executeStep(request,state,review.steps[i],state.steps[i],signal,review.direction??'forward');
        return await finalize(request,state,review,signal);
      }catch(error){return failure(state,error);}
    },signal);
  }
  async function reconcile(input,{signal}={}){
    operationId(input.operationId);
    return queue(input.operationId,async signal=>{
      const {state,request}=await load(input.operationId),review=await journal.plan(state.id);
      need(identity(review)===state.reviewSha256,'GEOSERVER_REVIEW_CHANGED');
      try{
        await nativeCheck(request,state,signal,'reconcile');const conflicts=[];
        for(let i=0;i<review.steps.length;i++){
          const step=review.steps[i],record=state.steps[i],observed=await readStep(service,journal,step,{signal});
          const direction=review.direction??'forward',target=desiredScope(step,direction);
          const source=direction==='reverse'?(step.rollbackSource??desiredScope(step)):desiredScope(step,'reverse');
          const nativeLayer=direction==='forward'&&await layerCreatedByOperation(service,journal,step,record,observed,signal);
          if(same(observed.value,target)){
            record.state=record.attempts.length||nativeLayer||record.appliedEffect||record.state==='APPLIED'?'APPLIED':'UNCHANGED';
            if(record.state==='APPLIED')rememberEffect(record,observed);
          }else if(same(observed.value,source))record.state='NOT_APPLIED';
          else if(direction==='forward'&&(createdFeatureMatches(step,observed,record)||nativeLayer)){
            record.state='CREATED';rememberEffect(record,observed,'created');
          }
          else{record.state='CONFLICT';conflicts.push({step:step.id,kind:step.kind,current:observed.value,expected:target,prior:source});}
          record.observed=observed.response;record.reconciledAt=now();await journal.save(state);
        }
        state.reconciliation={at:now(),conflicts};
        const complete=state.steps.every(row=>['APPLIED','UNCHANGED','SKIPPED'].includes(row.state));
        state.state=conflicts.length?'CONFLICT':complete?'RECONCILED':'PARTIAL';
        state.history.push({state:state.state,at:now()});await journal.save(state);
        return {state,review,conflicts};
      }catch(error){return failure(state,error);}
    },signal);
  }
  async function prepareRollback(input,{signal}={}){
    operationId(input.operationId);operationId(input.publicationId);
    absolute(input.receivingDirectory);hash(input.manifestSha256);
    need(input.operationId!==input.publicationId,'GEOSERVER_ROLLBACK_OPERATION_ID');
    return queue(input.operationId,async signal=>{
      const original=await load(input.publicationId),originalReview=await journal.plan(original.state.id);
      need(original.request.kind!=='rollback','GEOSERVER_ROLLBACK_SELECTION');
      need(original.state.steps.every(row=>['APPLIED','UNCHANGED','NOT_APPLIED','SKIPPED','CREATED'].includes(row.state)),
        'GEOSERVER_RECONCILE_BEFORE_ROLLBACK','Reconcile the original operation before preparing its rollback.',409);
      const retained=await journal.retainReceiving(input.receivingDirectory,input.manifestSha256,{signal});
      need(retained.receipt.projectId===original.request.projectId,'POSTGIS_PROJECT_CHANGED');
      const priorRequest=await optionalJson(join(journal.operationDirectory(input.operationId),'request.json'));
      const expectedPublication=input.expectedPublication===undefined?
        (priorRequest?priorRequest.expectedPublication:(await head())?.operationId??null):input.expectedPublication;
      if(expectedPublication!==null)operationId(expectedPublication);
      const request={schema:REQUEST_SCHEMA,operationId:input.operationId,kind:'rollback',
        projectId:retained.receipt.projectId,publicationId:input.publicationId,
        receivingDirectory:input.receivingDirectory,manifestSha256:input.manifestSha256,
        profile:publicProfile(profile),expectedPublication,
        layers:original.request.layers};
      const state=await journal.begin(request);
      try{
        await checkHead(request);
        const saved=await optionalJson(join(journal.operationDirectory(state.id),'review.json'));
        if(saved){need(saved.requestSha256===state.requestSha256,'GEOSERVER_REVIEW_CHANGED');
          state.reviewSha256=identity(saved);
          if(state.steps.length===0){state.steps=structuredClone(saved.rollbackRecords);state.state='PREPARED';}
          need(state.steps.length===saved.steps.length&&state.steps.every((row,i)=>row.id===saved.steps[i].id),'GEOSERVER_REVIEW_STEPS_CHANGED');
          if(state.state==='PREPARING')state.state='PREPARED';await journal.save(state);
          return {state,review:saved,reviewSha256:state.reviewSha256};}
        await nativeCheck(request,state,signal,'rollback-prepare');
        const steps=[],records=[];
        for(let i=originalReview.steps.length-1;i>=0;i--){
          const step=originalReview.steps[i],previous=original.state.steps[i];
          if(!['APPLIED','CREATED'].includes(previous.state))continue;
          if(step.kind==='feature'&&step.before!==null){
            const currentLayer=retained.receipt.layers.find(row=>row.id===step.layerId);
            need(currentLayer&&currentLayer.relation===step.before.nativeName&&'EPSG:'+currentLayer.srid===step.before.srs,
              'POSTGIS_ROLLBACK_LAYER_CHANGED','Complete the original database rollback before restoring this feature type.',409);
          }
          steps.push({...structuredClone(step),...(previous.state==='CREATED'?{rollbackSource:previous.appliedScope}:{})});records.push({id:step.id,state:'READY',attempts:[],
            rollbackOf:structuredClone(previous)});
        }
        need(steps.length>0,'GEOSERVER_NO_OWNED_CHANGES','The original operation has no applied changes to restore.');
        const review={schema:REVIEW_SCHEMA,operationId:state.id,requestSha256:state.requestSha256,kind:'rollback',
          direction:'reverse',createdAt:now(),originalPublication:input.publicationId,
          originalReviewSha256:original.state.reviewSha256,postgis:{projectId:retained.receipt.projectId,
            editionId:retained.receipt.editionId,revision:retained.receipt.revision,manifestSha256:input.manifestSha256},
          target:originalReview.target,steps,rollbackRecords:structuredClone(records)};
        await journal.savePlan(state.id,review);state.reviewSha256=identity(review);state.steps=records;
        state.state='PREPARED';state.preparedAt=now();await journal.save(state);
        return {state,review,reviewSha256:state.reviewSha256};
      }catch(error){return failure(state,error);}
    },signal);
  }
  async function receive(input,{signal}={}){
    operationId(input.operationId);
    return queue(input.operationId,async signal=>{
      const {state,request}=await load(input.operationId),review=await journal.plan(state.id);
      need(request.kind!=='rollback'&&['PUBLISHED','RECEIVED','EXPORTED'].includes(state.state),
        'GEOSERVER_PUBLISHED_OPERATION_REQUIRED','Complete the recorded publication before receiving its native service.',409);
      try{
        const active=await head();need(active?.operationId===state.id,'GEOSERVER_PUBLICATION_CHANGED',undefined,409);
        const receipt=await nativeCheck(request,state,signal,'before-native-receiving');
        const result=await receivePublication({journal,service,request,review,state,receipt,signal,
          verify:phase=>nativeCheck(request,state,signal,phase)});
        state.receiving=result;state.state='RECEIVED';state.receivedAt=now();
        state.history.push({state:'RECEIVED',at:state.receivedAt});await journal.save(state);return {state,receiving:result};
      }catch(error){
        state.receivingError=errorRecord(error);state.history.push({state:'RECEIVING_INTERRUPTED',...state.receivingError});
        try{await journal.save(state);}catch(storage){error.retentionError=errorRecord(storage);}throw error;
      }
    },signal);
  }
  async function exportReceiving(input,{signal}={}){
    operationId(input.operationId);absolute(input.directory);
    return queue(input.operationId,async signal=>{
      const {state,request}=await load(input.operationId),review=await journal.plan(state.id);
      need(['RECEIVED','EXPORTED','ROLLED_BACK'].includes(state.state),'GEOSERVER_RECEIVING_REQUIRED',
        'Retain the full native service receiving before exporting its operator handover.',409);
      const result=await exportPublication({journal,service,request,review,state,directory:input.directory,signal});
      if(input.archiveFile){absolute(input.archiveFile);
        need(input.archiveFile!==directory&&!input.archiveFile.startsWith(directory+'/'),'GEOSERVER_ARCHIVE_OUTSIDE_OPERATOR');
        result.archive=await createGeoServerArchive({directory:result.directory,archiveFile:input.archiveFile,
          manifestSha256:result.manifestSha256,python:profile.python,signal});}
      state.exports??=[];
      if(!state.exports.some(row=>row.manifestSha256===result.manifestSha256&&row.directory===result.directory))
        state.exports.push({directory:result.directory,manifestSha256:result.manifestSha256,at:now(),...(result.archive?{archive:result.archive}:{})});
      else if(result.archive)state.exports.find(row=>row.manifestSha256===result.manifestSha256&&row.directory===result.directory).archive=result.archive;
      if(state.state!=='ROLLED_BACK')state.state='EXPORTED';await journal.save(state);return result;
    },signal);
  }
  const close=()=>{
    if(closed)return Promise.resolve();
    if(closing)return closing;
    admission=false;lifetime.abort(Object.assign(new Error('GeoServer operator is closing.'),{code:'GEOSERVER_CLOSED'}));
    const task=(async()=>{await tail.catch(()=>{});await Promise.allSettled([...reads]);
      await service.close();await journal.close();closed=true;})();
    closing=task;void task.catch(()=>{if(closing===task)closing=null;});return task;
  };
  return {directory,profile:publicProfile(profile),prepare,apply,reconcile,prepareRollback,receive,exportReceiving,
    describe:()=>read(()=>describeGeoServerTarget(service,journal,{signal:lifetime.signal})),
    inspect:(id)=>read(async()=>id?{...(await load(id)),review:await optionalJson(join(journal.operationDirectory(id),'review.json'))}:
      {profile:publicProfile(profile),publication:await head(),running:current?{id:current.id,startedAt:current.startedAt}:null,
        operations:await journal.list()}),
    readMap:({operationId:id,readerId,layerId})=>read(async()=>{
      const {state}=await load(operationId(id));
      const layer=state.receiving?.services.find(row=>row.readerId===readerId)?.layers.find(row=>row.layerId===layerId);
      need(layer?.map?.response?.body,'GEOSERVER_MAP_NOT_FOUND',undefined,404);
      const reference=layer.map.response.body;return {bytes:await journal.objectBytes(reference),sha256:reference.sha256,contentType:'image/png'};
    }),
    exportDescriptor:({operationId:id,manifestSha256})=>read(async()=>{
      hash(manifestSha256);const {state}=await load(operationId(id));
      const item=state.exports?.find(row=>row.manifestSha256===manifestSha256);
      need(item?.archive,'GEOSERVER_EXPORT_NOT_FOUND',undefined,404);return structuredClone(item);
    }),
    cancel:({operationId:id})=>{
      operationId(id);if(current?.id===id){current.controller.abort(Object.assign(new Error('Publication cancelled by its operator.'),{code:'GEOSERVER_CANCELLED'}));return {operationId:id,state:'CANCELLING'};}
      return {operationId:id,state:'NO_ACTIVE_OPERATION'};
    },
    close};
}
