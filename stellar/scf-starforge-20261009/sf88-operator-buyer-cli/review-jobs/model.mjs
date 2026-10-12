// MIT — Complete review jobs on the original SF88 buyer, inbox, library and collections.
import { readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Buyer } from '../node/index.mjs';
import { readBytes, readJson, writeBytes, writeJson, now, object } from '../node/store.mjs';
import { openQueue } from '../queue.mjs';
import { prepareReview } from '../prepare.mjs';
import { openLibrary } from '../resource-library/library.mjs';
import { exportCollection } from '../resource-library/collection-package.mjs';
import { openJobStore, canonical, key, actionID } from './store.mjs';
import { retainSource, loadSource, fetchSource, retainCatalog, catalogRows,
  requireValue, plain, hash } from './source.mjs';

const runtimeDirectory=fileURLToPath(new URL('../',import.meta.url));
const nativeSummary=job=>job?{id:job.id,state:job.state,intentId:job.operation?.intentId,
  configSha256:job.configSha256,bodySha256:job.bodySha256??null,
  attempt:job.attempt?{startedAt:job.attempt.startedAt??job.attempt.at??null}:null,
  outcome:job.outcome?{status:job.outcome.status,httpStatus:job.outcome.httpStatus,
    delivery:job.outcome.responseFile?{status:job.outcome.responseFile.status,
      bytes:job.outcome.responseFile.bytes??null,sha256:job.outcome.responseFile.sha256??null}:null}:null,
  recovery:job.recovery?{observationStatus:job.recovery.observationStatus??null,
    reconciliationStatus:job.recovery.reconciliationStatus??null,evidenceSha256:job.recovery.evidenceSha256??null,
    binding:job.recovery.binding??null}:null,
  finalization:job.finalization?{outcome:job.finalization.result?.outcome??null,
    viewStatus:job.finalizationView?.status??null}:null}:null;
const errorCode=e=>typeof e?.code==='string'&&/^[A-Z0-9_]{1,120}$/.test(e.code)?e.code:'REVIEW_JOB_OPERATION_FAILED';
function exact(input,keys){
  requireValue(object(input)&&Object.keys(input).every(k=>keys.includes(k)),'REVIEW_JOB_INPUT_FIELDS_INVALID');
}
function nonempty(value,limit,code){
  plain(value,limit,code);requireValue(value.trim().length>0,code);return value;
}
function safeReview(native){
  return {intentId:native.intentId,method:native.method,sellerUrl:native.sellerUrl,
    acceptedTerms:native.acceptedTerms,bodyPresent:native.bodyPresent,bodyBytes:native.bodyBytes,
    bodySha256:native.bodySha256,headerNames:Object.keys(native.headers??{}),
    operationTicket:native.operationTicket?{sha256:native.operationTicket.sha256??null,
      expiresAt:native.operationTicket.expiresAt??null}:null,
    responseFile:native.responseFile?{maxBytes:native.responseFile.maxBytes,
      expectedBytes:native.responseFile.expectedBytes??null,
      expectedSha256:native.responseFile.expectedSha256??null,
      expectedContentType:native.responseFile.expectedContentType??null}:null};
}
export async function openReviewJobs(options){
  const store=await openJobStore(options), {state,config}=store;
  let library;
  try{
    const buyer=await new Buyer({runtimeDirectory,stateDirectory:config.buyerState,
      ...(config.profile?{operatorProfile:config.profile}:{}),
      ...(options.environment?{environment:options.environment}:{})}).ready();
    let inbox;
    try{await readJson(join(config.inbox,'inbox.json'));inbox=buyer.inbox(config.inbox);}
    catch(e){
      if(e.code!=='ENOENT')throw e;
      // Original initialize owns directory identity and refuses occupied wrong state.
      inbox=await buyer.createInbox({directory:config.inbox});
    }
    const queue=await openQueue(config.inbox);
    library=await openLibrary({state:join(state,'resources'),kind:'inbox',source:config.inbox,
      roots:[config.buyerState,config.inbox],maxFileBytes:67108864,indexBytes:4194304});
    const active=new Map();let closing=false;
    async function exclusive(id,run){
      requireValue(!closing,'REVIEW_JOBS_CLOSING',409);
      requireValue(!active.has(id),'JOB_ACTION_RUNNING',409);
      const holder={kind:'metadata',promise:null};
      active.set(id,holder);
      holder.promise=Promise.resolve().then(run);
      try{return await holder.promise;}finally{if(active.get(id)===holder)active.delete(id);}
    }
    async function nativeJob(job){
      if(!job.binding)return null;
      try{return await queue.show(job.binding.intentId);}
      catch(e){if(['ENOENT','INBOX_JOB_NOT_FOUND','QUEUE_JOB_NOT_FOUND'].includes(e.code))return null;throw e;}
    }
    function resources(intentId){
      return library.exportReview().resources.filter(r=>r.intentId===intentId).map(r=>{
        const value=library.resource(r.id);
        return {id:value.id,name:value.name,status:value.status,buyerStatus:value.buyerStatus,
          deliveryStatus:value.deliveryStatus,httpStatus:value.httpStatus,bytes:value.bytes,sha256:value.sha256,
          contentType:value.contentType,annotation:value.annotation};
      });
    }
    async function inspect(id){
      const job=await store.get(id), original=await nativeJob(job), running=active.get(id);
      return {job,original:nativeSummary(original),resources:job.binding?resources(job.binding.intentId):[],
        active:running?{kind:running.kind,operationId:running.operationId??null}:null,
        needsReconcile:!running&&job.actions.some(a=>['running','needs_reconcile'].includes(a.status)),
        canFinalize:Boolean(config.workspace)};
    }
    async function context(page={}){
      const jobs=await store.list(page),items=[];
      for(const row of jobs.items){
        const running=active.get(row.externalId), original=await nativeJob(row);
        const view={original:nativeSummary(original),active:running?{kind:running.kind,operationId:running.operationId??null}:null,
          needsReconcile:!running&&row.actions.some(a=>['running','needs_reconcile'].includes(a.status))};
        items.push({externalId:row.externalId,title:row.title,owner:row.owner,service:row.service,
          revision:row.revision,updatedAt:row.updatedAt,original:view.original,
          active:view.active,needsReconcile:view.needsReconcile,delivery:row.delivery});
      }
      const sources=[];
      for(const filename of await readdir(join(state,'sources')))if(/^[a-f0-9]{64}\.source\.json$/.test(filename))
        sources.push(await readJson(join(state,'sources',filename)));
      sources.sort((a,b)=>b.importedAt.localeCompare(a.importedAt));
      const catalogs=[];
      for(const filename of await readdir(join(state,'catalogs')))if(/^[a-f0-9]{64}\.json$/.test(filename)){
        const raw=await readBytes(join(state,'catalogs',filename),1048576);
        catalogs.push({sha256:filename.slice(0,-5),bytes:raw.length,rowCount:catalogRows(raw).length});
      }
      return {schema:'stellar-forge.review-jobs.v1',workspaceId:config.id,nativeWorkspace:Boolean(config.workspace),
        jobs:{...jobs,items},sources,catalogs,library:library.status().scan,
        active:[...active.entries()].map(([externalId,a])=>({externalId,kind:a.kind,operationId:a.operationId??null}))};
    }
    async function create(input){
      exact(input,['externalId','title','owner','objective','sourceSha256','service','sourceRow']);
      key(input.externalId);nonempty(input.title,240,'JOB_TITLE_REQUIRED');
      nonempty(input.owner,120,'JOB_OWNER_REQUIRED');nonempty(input.objective,4000,'JOB_OBJECTIVE_REQUIRED');
      const snapshot=await loadSource(state,input.sourceSha256);
      const matches=snapshot.rows.map((row,index)=>({row,index})).filter(x=>x.row.service===input.service);
      let sourceRow=input.sourceRow;
      if(sourceRow===undefined){requireValue(matches.length===1,'PUBLISHED_SERVICE_ROW_REQUIRED');sourceRow=matches[0].index;}
      requireValue(Number.isSafeInteger(sourceRow)&&sourceRow>=0&&snapshot.rows[sourceRow]?.service===input.service,
        'PUBLISHED_SERVICE_ROW_MISMATCH');
      const identity={...input,sourceRow,publishedReview:snapshot.rows[sourceRow],publishedSource:snapshot.source};
      return store.create({...identity,identitySha256:hash(Buffer.from(canonical(identity)))});
    }
    async function assign(input){
      exact(input,['externalId','revision','owner','note']);nonempty(input.owner,120,'JOB_OWNER_REQUIRED');
      plain(input.note,4000,'JOB_NOTE_INVALID');
      return store.mutate(input.externalId,input.revision,'assigned',job=>{
        job.owner=input.owner;job.assignment={owner:input.owner,note:input.note,at:now()};return job;
      });
    }
    async function prepare(input){
      exact(input,['externalId','revision','catalogSha256','rowIndex','acceptIndex','url','method',
        'headers','bodyBase64','mappingNote','intentId']);
      nonempty(input.mappingNote,4000,'NATIVE_SERVICE_MAPPING_NOTE_REQUIRED');
      return exclusive(input.externalId,async()=>{
        const before=await store.get(input.externalId);
        const intentId=input.intentId??'review-'+hash(Buffer.from(config.id+'\0'+input.externalId)).slice(0,40);
        requireValue(/^[A-Za-z0-9._:-]{1,128}$/.test(intentId),'STABLE_INTENT_ID_REQUIRED');
        // The stable intent is also checked against the complete local metadata directory.
        for(const filename of await readdir(join(state,'jobs')))if(/^[a-f0-9]{64}\.json$/.test(filename)){
          const other=await readJson(join(state,'jobs',filename),1048576);
          requireValue(other.externalId===input.externalId||other.binding?.intentId!==intentId,'INTENT_ALREADY_ASSIGNED_TO_JOB',409);
        }
        requireValue(/^[a-f0-9]{64}$/.test(input.catalogSha256),'CATALOG_HASH_REQUIRED');
        const raw=await readBytes(join(state,'catalogs',input.catalogSha256+'.json'),1048576);
        requireValue(hash(raw)===input.catalogSha256,'CATALOG_BYTES_CHANGED',409);
        let body;
        if(input.bodyBase64!==undefined){
          requireValue(typeof input.bodyBase64==='string'&&input.bodyBase64.length<=1398104&&
            /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.bodyBase64),
            'REQUEST_BODY_BASE64_INVALID');
          body=Buffer.from(input.bodyBase64,'base64');
          requireValue(body.length<=1048576,'REVIEW_JOB_BODY_LIMIT');
        }
        const requestKey=key(input.externalId),bodyPath=join(state,'requests',requestKey+'.body');
        const selection={rowIndex:input.rowIndex,acceptIndex:input.acceptIndex,intentId,
          url:input.url,method:input.method,headers:input.headers??{},
          responseOut:join(state,'requests',requestKey+'.response'),
          ...(body===undefined?{}:{bodyFile:bodyPath,bodyBytes:body.length,bodySha256:hash(body)})};
        const prepared=prepareReview(raw,selection);
        requireValue(/^stellar:/.test(prepared.draft.operation.expect.network),'NATIVE_STELLAR_OFFER_REQUIRED');
        requireValue((prepared.draft.responseFile?.expectedBytes??0)<=67108864,'REVIEW_JOB_RESPONSE_LIMIT');
        const requestIdentity={catalogSha256:input.catalogSha256,selection:{...selection,
          bodyFile:body===undefined?null:'retained-request.body',responseOut:'original-buyer-response'},
          mappingNote:input.mappingNote,bodySha256:body===undefined?null:hash(body)};
        const requestSha256=hash(Buffer.from(canonical(requestIdentity)));
        if(before.binding){
          requireValue(before.binding.requestSha256===requestSha256,'JOB_REQUEST_ALREADY_BOUND',409);
          if(before.binding.status==='prepared')return inspect(input.externalId);
        }else{
          requireValue(before.revision===input.revision,'JOB_REVISION_CHANGED',409);
        }
        if(body!==undefined){
          try{await writeBytes(bodyPath,body,{exclusive:true});}
          catch(e){if(e.code!=='EEXIST')throw e;
            requireValue(hash(await readBytes(bodyPath,1048576))===hash(body),'JOB_REQUEST_BODY_CHANGED',409);}
        }
        const requestPath=join(state,'requests',requestKey+'.json');
        try{await writeBytes(requestPath,prepared.data,{exclusive:true});}
        catch(e){if(e.code!=='EEXIST')throw e;
          requireValue(hash(await readBytes(requestPath))===hash(prepared.data),'JOB_REQUEST_CONFIG_CHANGED',409);}
        if(!before.binding)await store.mutate(input.externalId,input.revision,'request-retained',job=>{
          job.binding={status:'preparing',intentId,requestSha256,catalogSha256:input.catalogSha256,
            rowIndex:input.rowIndex,acceptIndex:input.acceptIndex,mappingNote:input.mappingNote,
            method:prepared.draft.operation.method,url:prepared.draft.operation.url,
            acceptedTerms:prepared.draft.operation.expect,bodySha256:body===undefined?null:hash(body),
            headerNames:Object.keys(prepared.draft.operation.headers??{}),preparedAt:null};return job;
        });
        let operation;
        try{
          const capture={responseFile:{maxBytes:67108864},
            requestTimeoutMs:90000};
          operation=config.workspace
            ?await buyer.fromWorkspace(config.workspace,{...capture,configuration:requestPath})
            :await buyer.fromConfig(requestPath,capture);
        }catch(e){
          if(e.code!=='INTENT_ALREADY_EXISTS_USE_RECOVER')throw e;
          operation=buyer.operation(intentId);
          const saved=await readJson(operation.configPath);
          const expected=prepared.draft.operation;
          requireValue(saved.operation?.intentId===intentId&&saved.operation.url===expected.url&&
            saved.operation.method===expected.method&&canonical(saved.operation.expect)===canonical(expected.expect)&&
            canonical(saved.operation.headers??{})===canonical(expected.headers??{})&&
            saved.preparedFrom?.discoveryFileSha256===input.catalogSha256,'RETAINED_NATIVE_OPERATION_DIFFERS',409);
        }
        await inbox.enqueue(operation);
        const original=(await inbox.show(intentId)).native;
        await store.mutate(input.externalId,undefined,'native-prepared',job=>{
          job.binding={...job.binding,status:'prepared',configSha256:original.configSha256,
            nativeBodySha256:original.bodySha256??null,ticketSha256:original.operationTicket?.sha256??null,
            queueId:original.id,preparedAt:now()};return job;
        });
        return inspect(input.externalId);
      });
    }
    async function review(input){
      exact(input,['externalId','revision']);
      return exclusive(input.externalId,async()=>{
        const job=await store.get(input.externalId);
        requireValue(job.revision===input.revision,'JOB_REVISION_CHANGED',409);
        requireValue(job.binding?.status==='prepared','NATIVE_REQUEST_NOT_PREPARED',409);
        const original=await inbox.review(job.binding.intentId),reviewId=randomUUID();
        await writeJson(join(state,'reviews',reviewId+'.json'),original,{exclusive:true});
        const view=safeReview(original.native);
        const current=await store.mutate(input.externalId,input.revision,'request-reviewed',row=>{
          row.requestReview={id:reviewId,at:now(),requestSha256:row.binding.requestSha256,view};
          row.approval=null;return row;
        });
        return {job:current,reviewId,review:view};
      });
    }
    async function approve(input){
      exact(input,['externalId','revision','reviewId','reviewer','note']);
      nonempty(input.reviewer,120,'NAMED_REVIEWER_REQUIRED');nonempty(input.note,4000,'REVIEW_NOTE_REQUIRED');
      return store.mutate(input.externalId,input.revision,'request-approved',job=>{
        requireValue(job.requestReview?.id===input.reviewId&&
          job.requestReview.requestSha256===job.binding?.requestSha256,'EXACT_NATIVE_REVIEW_REQUIRED',409);
        job.approval={id:input.reviewId,reviewer:input.reviewer,note:input.note,at:now(),
          requestSha256:job.binding.requestSha256};return job;
      });
    }
    async function action(input){
      exact(input,['externalId','revision','operationId','kind']);actionID(input.operationId);
      requireValue(['execute','recover','finalize','cancel'].includes(input.kind),'JOB_ACTION_INVALID');
      requireValue(!closing,'REVIEW_JOBS_CLOSING',409);
      const before=await store.get(input.externalId);
      requireValue(before.binding?.status==='prepared','NATIVE_REQUEST_NOT_PREPARED',409);
      const fingerprint=hash(Buffer.from(canonical({kind:input.kind,externalId:input.externalId,
        requestSha256:before.binding.requestSha256,approval:input.kind==='execute'?before.approval?.id??null:null})));
      const prior=before.actions.find(a=>a.id===input.operationId);
      if(prior){requireValue(prior.inputSha256===fingerprint,'JOB_OPERATION_ID_CONFLICT',409);return {action:prior,...await inspect(input.externalId)};}
      requireValue(!active.has(input.externalId),'JOB_ACTION_RUNNING',409);
      if(input.kind==='execute')requireValue(before.approval?.requestSha256===before.binding.requestSha256,
        'NAMED_REQUEST_APPROVAL_REQUIRED',409);
      if(input.kind==='finalize')requireValue(config.workspace,'ORIGINAL_OPERATOR_WORKSPACE_REQUIRED',409);
      const holder={kind:input.kind,operationId:input.operationId,promise:null,controller:new AbortController()};
      active.set(input.externalId,holder);
      try{
        await store.mutate(input.externalId,input.revision,'native-action-started',job=>{
          job.actions.push({id:input.operationId,kind:input.kind,inputSha256:fingerprint,status:'running',
            startedAt:now(),finishedAt:null,native:null,process:null,error:null,
            approval:input.kind==='execute'?structuredClone(before.approval):null});return job;
        });
      }catch(e){active.delete(input.externalId);throw e;}
      holder.promise=(async()=>{
        let result,error=null;
        try{
          const id=before.binding.intentId,signal=holder.controller.signal;
          if(input.kind==='execute'){
            const reviewed=await readJson(join(state,'reviews',before.approval.id+'.json'));
            result=await inbox.execute(id,{review:reviewed,signal,...(config.workspace?{workspaceDirectory:config.workspace}:{})});
          }else if(input.kind==='recover')result=await inbox.recover(id,{signal});
          else if(input.kind==='cancel')result=await inbox.cancel(id,{signal});
          else result=await inbox.finalize(id,{workspaceDirectory:config.workspace,signal});
        }catch(e){error=errorCode(e);result=e.result??null;}
        try{await library.scan();}catch(e){error??=errorCode(e);}
        try{
          await store.mutate(input.externalId,undefined,'native-action-finished',job=>{
            const item=job.actions.find(a=>a.id===input.operationId);
            requireValue(item?.inputSha256===fingerprint,'JOB_ACTION_RECORD_CHANGED',409);
            Object.assign(item,{status:error?'needs_reconcile':'completed',finishedAt:now(),error,
              native:result?.native?nativeSummary(result.native):null,process:result?.process??null});
            if(input.kind==='recover'&&!error&&result?.native?.recovery)
              for(const prior of job.actions)if(prior.id!==input.operationId&&['running','needs_reconcile'].includes(prior.status))
                Object.assign(prior,{status:'evidence_reconciled',reconciledBy:input.operationId,reconciledAt:now()});
            return job;
          });
        }finally{if(active.get(input.externalId)===holder)active.delete(input.externalId);}
      })();
      // Keep an observed rejection on the holder; never issue an automatic second attempt.
      holder.promise.catch(e=>{holder.error=errorCode(e);});
      return {operationId:input.operationId,status:'running',...await inspect(input.externalId)};
    }
    async function stop(input){
      exact(input,['externalId','operationId']);
      const running=active.get(input.externalId);
      requireValue(running?.operationId===input.operationId&&running.controller,'RUNNING_NATIVE_ACTION_NOT_FOUND',409);
      running.controller.abort();
      return {externalId:input.externalId,operationId:input.operationId,status:'stop_requested'};
    }
    async function annotate(input){
      exact(input,['externalId','revision','resourceId','resourceSha256','annotationRevision','operationId','reviewer','note']);
      actionID(input.operationId);nonempty(input.reviewer,120,'NAMED_REVIEWER_REQUIRED');nonempty(input.note,16000,'REVIEW_NOTE_REQUIRED');
      return exclusive(input.externalId,async()=>{
        const job=await store.get(input.externalId);
        if(job.resultReview?.operationId===input.operationId){
          requireValue(job.resultReview.resourceId===input.resourceId&&job.resultReview.sha256===input.resourceSha256&&
            job.resultReview.reviewer===input.reviewer&&job.resultReview.note===input.note,'RESULT_REVIEW_OPERATION_CONFLICT',409);
          return job;
        }
        requireValue(job.revision===input.revision,'JOB_REVISION_CHANGED',409);
        const resource=library.resource(input.resourceId);
        requireValue(resource.intentId===job.binding?.intentId&&resource.status==='VERIFIED'&&
          resource.sha256===input.resourceSha256,'COMPLETE_BOUND_RESULT_REQUIRED',409);
        const response=await inbox.response(job.binding.intentId);
        requireValue(response,'NATIVE_RESPONSE_NOT_RETAINED',409);
        const verified=await response.verify();
        requireValue(verified.sha256===resource.sha256&&verified.bytes===resource.bytes,'NATIVE_RESULT_CHANGED',409);
        const note='Review job '+job.externalId+'\nReviewer: '+input.reviewer+'\n\n'+input.note;
        requireValue(Buffer.byteLength(note)<=32768,'RESULT_REVIEW_NOTE_BYTE_LIMIT');
        const annotation=library.saveAnnotation(resource.id,{expectedRevision:input.annotationRevision,
          operationId:input.operationId,note,tags:resource.annotation.tags,starred:resource.annotation.starred});
        return store.mutate(input.externalId,input.revision,'result-reviewed',row=>{
          row.resultReview={resourceId:resource.id,sha256:resource.sha256,bytes:resource.bytes,
            annotationRevision:annotation.revision,reviewer:input.reviewer,note:input.note,at:now(),
            operationId:input.operationId,publishedSourceSha256:row.sourceSha256};
          return row;
        });
      });
    }
    async function deliver(input){
      exact(input,['externalId','revision','operationId','name','note']);
      actionID(input.operationId);nonempty(input.name,200,'DELIVERY_NAME_REQUIRED');plain(input.note,16000,'DELIVERY_NOTE_INVALID');
      requireValue(Buffer.byteLength(input.note)<=32768,'DELIVERY_NOTE_BYTE_LIMIT');
      return exclusive(input.externalId,async()=>{
        let job=await store.get(input.externalId);
        const inputHash=hash(Buffer.from(canonical({externalId:input.externalId,name:input.name,note:input.note})));
        if(job.delivery?.operationId===input.operationId){
          requireValue(job.delivery.inputHash===inputHash,'DELIVERY_OPERATION_CONFLICT',409);
          return inspect(input.externalId);
        }
        const old=job.deliveryAttempt;
        const unresolved=old&&job.delivery?.operationId!==old.operationId&&old.status!=='rejected';
        requireValue(!unresolved||old.operationId===input.operationId,
          'RETAINED_DELIVERY_SELECTION_REQUIRES_RECONCILIATION',409);
        if(old?.operationId===input.operationId){
          requireValue(old.status!=='rejected','DELIVERY_SELECTION_REJECTED_RESELECT',409);
          requireValue(old.inputHash===inputHash,'DELIVERY_OPERATION_CONFLICT',409);
        }else{
          requireValue(job.revision===input.revision&&job.resultReview,'REVIEWED_JOB_REVISION_REQUIRED',409);
          const reviewed=job.resultReview, resource=library.resource(reviewed.resourceId);
          requireValue(resource.sha256===reviewed.sha256&&resource.annotation.revision===reviewed.annotationRevision,
            'RESULT_REVIEW_CHANGED',409);
          const id='review-'+key(input.externalId).slice(0,40);
          let previous=0;try{previous=library.collections.show(id).revision;}
          catch(e){if(e.code!=='COLLECTION_NOT_FOUND')throw e;}
          // Retain the exact original collection CAS input before its SQLite commit.
          job=await store.mutate(input.externalId,input.revision,'delivery-intent-retained',row=>{
            row.deliveryAttempt={operationId:input.operationId,inputHash,status:'pending',error:null,
              createdAt:now(),reviewer:reviewed.reviewer,
              resultSha256:reviewed.sha256,request:{id,name:input.name,note:input.note,
                expectedRevision:previous,operationId:input.operationId,
                members:[{id:resource.id,sha256:resource.sha256,annotationRevision:reviewed.annotationRevision}]}};
            return row;
          });
        }
        const attempt=job.deliveryAttempt;let edition;
        try{edition=library.collections.save(attempt.request);}
        catch(error){
          // Original COL6 checks these conditions before any collection/receipt INSERT.
          // Unknown storage/commit errors keep the exact request pending for reconciliation.
          const rejected=new Set(['COLLECTION_REVISION_CONFLICT','COLLECTION_MEMBER_CHANGED',
            'COLLECTION_VERIFIED_MEMBER_REQUIRED','COLLECTION_DESCRIPTION_INVALID',
            'COLLECTION_MEMBER_SELECTION_INVALID','COLLECTION_REVISION_REQUIRED',
            'COLLECTION_MEMBERS_INVALID','COLLECTION_METADATA_TOO_LARGE','OPERATION_ID_CONFLICT']);
          if(rejected.has(error.code))await store.mutate(input.externalId,undefined,'delivery-selection-rejected',row=>{
            requireValue(row.deliveryAttempt?.operationId===input.operationId,'DELIVERY_INTENT_CHANGED',409);
            row.deliveryAttempt={...row.deliveryAttempt,status:'rejected',error:error.code,rejectedAt:now()};
            return row;
          });
          throw error;
        }
        await store.mutate(input.externalId,undefined,'delivery-selected',row=>{
          requireValue(row.deliveryAttempt?.operationId===input.operationId,'DELIVERY_INTENT_CHANGED',409);
          row.delivery={operationId:input.operationId,inputHash,collectionId:edition.id,collectionRevision:edition.revision,
            name:input.name,note:input.note,selectedAt:now(),reviewer:attempt.reviewer,sourceSha256:row.sourceSha256,
            requestSha256:row.binding.requestSha256,resultSha256:attempt.resultSha256};
          return row;
        });
        return inspect(input.externalId);
      });
    }
    async function exportDelivery(id,destination){
      const job=await store.get(id);requireValue(job.delivery,'JOB_DELIVERY_NOT_SELECTED',409);
      return exportCollection(library,{id:job.delivery.collectionId,revision:job.delivery.collectionRevision,destination});
    }
    async function handoff(id){
      const {job,original,resources:current}=await inspect(id);
      return {schema:'stellar-forge.review-job-handoff.v1',exportedAt:now(),
        externalId:job.externalId,title:job.title,owner:job.owner,objective:job.objective,
        service:job.service,sourceRow:job.sourceRow,publishedSource:job.publishedSource,publishedReview:job.publishedReview,
        mapping:job.binding?{intentId:job.binding.intentId,requestSha256:job.binding.requestSha256,
          catalogSha256:job.binding.catalogSha256,method:job.binding.method,url:job.binding.url,
          acceptedTerms:job.binding.acceptedTerms,mappingNote:job.binding.mappingNote,
          bodySha256:job.binding.bodySha256}:null,original,
        requestApproval:job.approval,
        executionApprovals:job.actions.filter(a=>a.kind==='execute').map(a=>({
          operationId:a.id,status:a.status,approval:a.approval??null})),
        resultReview:job.resultReview,delivery:job.delivery,
        resources:current.map(({annotation,...r})=>r)};
    }
    async function whenIdle(){for(;;){const promises=[...active.values()].map(a=>a.promise).filter(Boolean);
      if(!promises.length)return;await Promise.allSettled(promises);}}
    return {store,buyer,inbox,library,context,create,assign,prepare,review,approve,action,stop,inspect,
      annotate,deliver,exportDelivery,handoff,whenIdle,
      importSource:(raw,metadata)=>retainSource(state,raw,metadata),
      source:sha=>loadSource(state,sha),fetchSource:(input,options)=>fetchSource(state,input,options),
      importCatalog:raw=>retainCatalog(state,raw),
      async catalog(sha256){requireValue(/^[a-f0-9]{64}$/.test(sha256),'CATALOG_HASH_REQUIRED');
        const raw=await readBytes(join(state,'catalogs',sha256+'.json'),1048576);
        requireValue(hash(raw)===sha256,'CATALOG_BYTES_CHANGED',409);return {sha256,bytes:raw.length,rows:catalogRows(raw)};},
      async close(){closing=true;await whenIdle();try{await library.close();}finally{await store.close();}}};
  }catch(e){if(library)await library.close();await store.close();throw e;}
}
