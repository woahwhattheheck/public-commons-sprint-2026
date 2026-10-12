// MIT. Customer onboarding around the maintained STAC policy, analyst and delivery owners.
import {randomUUID} from 'node:crypto';
import {join,resolve,dirname,basename} from 'node:path';
import {privateDirectory,readJson,readBytes,writeJson,writeBytes,jsonBytes,exists,need}
  from '../../../sf88-operator-buyer-cli/node/store.mjs';
import {withPrivateLock} from '../../routescan/quota.mjs';
import {canonicalJson,sha256,normalizeEndpoint,normalizeQuery,stacItemKey}
  from '../provider.mjs';
import {validateDeploymentPolicyPackage} from './policy-workspace.mjs';

const SCHEMA='starforge.stac-eoapi-onboarding.v1';
const REVIEW='starforge.stac-eoapi-source-review.v1';
const DELIVERY_REVIEW='starforge.stac-eoapi-delivery-review.v1';
const HASH=/^[a-f0-9]{64}$/;
const stamp=()=>new Date().toISOString();
const copy=value=>structuredClone(value);
const hash=value=>sha256(canonicalJson(value));
const same=(left,right)=>hash(left)===hash(right);
const key=value=>{need(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value),'EOAPI_OPERATION_ID_REQUIRED');return value;};
const actor=value=>{need(typeof value==='string'&&value.trim()&&value.length<=300&&!/[\r\n\0]/.test(value),'EOAPI_OPERATOR_REQUIRED');return value.trim();};
const operationKey=(id,phase)=>'eoapi-'+sha256(id).slice(0,40)+'-'+phase;
const errorView=error=>({code:/^[A-Z0-9_]{1,160}$/.test(error?.code??'')?error.code:'EOAPI_OPERATION_FAILED',message:String(error?.message??'The operation did not complete.').slice(0,500),at:stamp()});

async function retainJSON(path,value) {
  const bytes=jsonBytes(value);
  if(await exists(path))need(sha256(await readBytes(path,bytes.length))===sha256(bytes),'EOAPI_RETAINED_FILE_CONFLICT');
  else await writeBytes(path,bytes,{exclusive:true});
  return value;
}
function sourceSnapshot(state,policy,detail=null,target='deployment') {
  need(['deployment','upstream'].includes(target),'EOAPI_SOURCE_TARGET_INVALID');
  const catalog=detail?.edition.catalog??state.catalog;
  const collections=detail?.edition.collections??state.collections;
  need(catalog&&Array.isArray(collections),'EOAPI_ORIGINAL_CATALOG_REQUIRED');
  const endpoint=normalizeEndpoint(detail?.edition.query.endpoint??state.endpoint);
  const selected=policy.collectionRights.map(right=>right.id);
  const findings=[];
  const expectedEndpoint=target==='upstream'?policy.upstream.url:policy.deployment.publicUrl;
  if(endpoint!==normalizeEndpoint(expectedEndpoint))
    findings.push({code:'CATALOG_ENDPOINT_CHANGED',expected:expectedEndpoint,actual:endpoint});
  const conformance=Array.isArray(catalog.conformsTo)?[...catalog.conformsTo]:[];
  for(const declaration of policy.upstream.conformsTo)
    if(!conformance.includes(declaration))findings.push({code:'CONFORMANCE_DECLARATION_MISSING',declaration});
  const rights=[];
  const chosenRights=detail?policy.collectionRights.filter(right=>detail.edition.query.collections.includes(right.id)):policy.collectionRights;
  for(const configured of chosenRights) {
    const collection=collections.find(item=>item.id===configured.id);
    if(!collection){findings.push({code:'COLLECTION_NOT_VISIBLE',collection:configured.id});continue;}
    const links=(collection.links??[]).filter(link=>link.rel==='license').map(link=>{
      try{return new URL(link.href,endpoint).href;}catch{return link.href;}
    }).sort();
    if(collection.license!==configured.license)
      findings.push({code:'SOURCE_LICENSE_CHANGED',collection:configured.id,expected:configured.license,actual:collection.license??null});
    for(const href of configured.licenseUrls)
      if(!links.includes(href))findings.push({code:'SOURCE_LICENSE_LINK_MISSING',collection:configured.id,href});
    rights.push({id:collection.id,sha256:hash(collection),license:collection.license??null,
      licenseUrls:links,attribution:configured.attribution,assetAccess:configured.assetAccess,
      providers:copy(collection.providers??[])});
  }
  if(detail)for(const item of detail.items)
    need(selected.includes(item.collection),'EOAPI_EDITION_COLLECTION_OUTSIDE_REVIEW');
  const sources=(detail?.edition.catalogSources??state.catalogSources??[]).filter(item=>item.status==='RECEIVED')
    .map(item=>({directory:item.directory,sha256:item.sha256,bytes:item.bytes,requestHash:item.requestHash}));
  return {workspaceId:state.id,target,endpoint,catalogSha256:hash(catalog),conformsTo:conformance,
    collections:rights.sort((a,b)=>a.id.localeCompare(b.id)),catalogSources:sources,
    ...(detail?{editionId:detail.edition.id,querySha256:hash(detail.edition.query),
      coverage:copy(detail.edition.coverage)}:{}),findings,ready:findings.length===0};
}
function sourceIdentity(value,selectedIds=null) {
  return {target:value.target??'deployment',endpoint:value.endpoint,catalogSha256:value.catalogSha256,
    collections:value.collections.filter(item=>!selectedIds||selectedIds.includes(item.id)).map(item=>({id:item.id,sha256:item.sha256}))};
}
function manifestIdentity(manifest) {
  return {id:manifest.id,digest:manifest.digest,captureId:manifest.capture.id,
    files:manifest.files.map(item=>({path:item.path,bytes:item.bytes,sha256:item.sha256,mime:item.mime})),
    assets:manifest.assets.map(item=>copy(item))};
}

/** Each business action remains in its original owner. This directory keeps
 * customer review associations and the stable IDs required to resume them. */
export async function openEoapiOnboarding({workspace,policies,directory,outputDirectory,create=true}={}) {
  need(workspace&&typeof workspace.getState==='function'&&typeof workspace.exportEdition==='function','EOAPI_ORIGINAL_WORKSPACE_REQUIRED');
  need(policies&&typeof policies.exportPackage==='function','EOAPI_ORIGINAL_POLICY_WORKSPACE_REQUIRED');
  const native=await workspace.getState();
  directory=await privateDirectory(directory??join(workspace.directory,'eoapi','onboarding'),{create});
  outputDirectory=resolve(outputDirectory??join(dirname(workspace.directory),basename(workspace.directory)+'-eoapi-deliveries'));
  need(outputDirectory!==workspace.directory&&!outputDirectory.startsWith(workspace.directory+'/'),'EOAPI_SEPARATE_DELIVERY_DIRECTORY_REQUIRED');
  const statePath=join(directory,'onboarding.json');
  await privateDirectory(join(directory,'reviews'),{create});
  await privateDirectory(join(directory,'operations'),{create});
  let queue=Promise.resolve(),closed=false,closing=false;
  const running=new Set(),idleWaiters=[],admitted=new Set();
  let closingPromise=null;
  function owned(operation) {
    return (...args)=>{
      if(closing||closed)return Promise.reject(Object.assign(new Error('EOAPI_ONBOARDING_CLOSED'),{code:'EOAPI_ONBOARDING_CLOSED'}));
      const result=Promise.resolve().then(()=>operation(...args));admitted.add(result);
      result.then(()=>admitted.delete(result),()=>admitted.delete(result));return result;
    };
  }
  async function read() {
    const value=await readJson(statePath,16*1024*1024);
    need(value.schema===SCHEMA&&value.workspaceId===native.id&&Number.isSafeInteger(value.revision)&&
      Array.isArray(value.sourceReviews)&&Array.isArray(value.deliveryReviews)&&Array.isArray(value.deliveries)&&
      value.editions&&value.operations,'EOAPI_ONBOARDING_STATE_CHANGED');
    return value;
  }
  if(!await exists(statePath)) {
    need(create,'EOAPI_ONBOARDING_NOT_FOUND');
    await withPrivateLock(directory,'onboarding.lock',async()=>{
      if(!await exists(statePath))await writeJson(statePath,{schema:SCHEMA,id:'eoapi-'+randomUUID(),
        workspaceId:native.id,revision:0,createdAt:stamp(),updatedAt:stamp(),sourceReviews:[],
        deliveryReviews:[],deliveryApprovals:[],editions:{},operations:{},deliveries:[]},{exclusive:true});
    });
  }
  async function mutate(change,expectedRevision) {
    const result=queue.then(()=>withPrivateLock(directory,'onboarding.lock',async()=>{
      need(!closed,'EOAPI_ONBOARDING_CLOSED');
      const state=await read();
      if(expectedRevision!==undefined)need(state.revision===expectedRevision,'EOAPI_ONBOARDING_REVISION_CHANGED');
      const value=await change(state);
      state.revision++;state.updatedAt=stamp();await writeJson(statePath,state);
      return copy(value);
    }));
    queue=result.catch(()=>{});return result;
  }
  async function approved(approvalId) {
    const exported=await policies.exportPackage(approvalId?{approvalId}:{});
    const checked=validateDeploymentPolicyPackage(exported.package);
    return {...checked,package:exported.package};
  }
  async function sourceReview(id) {
    key(id);const summary=(await read()).sourceReviews.find(item=>item.id===id);
    need(summary,'EOAPI_SOURCE_REVIEW_REQUIRED');
    const record=await readJson(join(directory,'reviews',id+'.json'),8*1024*1024);
    const {sha256:digest,...core}=record;
    need(record.schema===REVIEW&&digest===hash(core)&&summary.sha256===digest,'EOAPI_SOURCE_REVIEW_CHANGED');
    const checked=validateDeploymentPolicyPackage(record.policyPackage);
    need(checked.approval.id===record.approvalId&&checked.digest===record.policyPackageDigest&&
      checked.compilation.digest===record.policyDigest,'EOAPI_SOURCE_POLICY_CHANGED');
    return record;
  }
  async function deliveryReview(id) {
    key(id);const summary=(await read()).deliveryReviews.find(item=>item.id===id);
    need(summary,'EOAPI_DELIVERY_REVIEW_REQUIRED');
    const record=await readJson(join(directory,'reviews',id+'.json'),16*1024*1024);
    const {sha256:digest,...core}=record;
    need(record.schema===DELIVERY_REVIEW&&digest===hash(core)&&summary.sha256===digest,'EOAPI_DELIVERY_REVIEW_CHANGED');
    return record;
  }
  async function operate({operationId,kind,input},work) {
    operationId=key(operationId);
    const digest=hash({kind,input}),filename=sha256(operationId)+'.json';
    const path=join(directory,'operations',filename);
    need(!closed,'EOAPI_ONBOARDING_CLOSED');
    need(!running.has(operationId),'EOAPI_OPERATION_RUNNING');
    running.add(operationId);
    try {
      return await withPrivateLock(directory,'operation-'+sha256(operationId)+'.lock',async()=>{
        let operation=await exists(path)?await readJson(path,16*1024*1024):null;
        if(operation) {
          need(operation.kind===kind&&operation.inputSha256===digest,'EOAPI_OPERATION_INPUT_CHANGED');
          if(operation.status==='COMPLETE') {
            const state=await read(),summary=state.operations[operationId];
            if(!summary||summary.status!=='COMPLETE'||summary.updatedAt!==operation.updatedAt)
              await mutate(value=>{value.operations[operationId]={id:operationId,kind,inputSha256:digest,
                phase:operation.phase,status:operation.status,updatedAt:operation.updatedAt};return value.operations[operationId];});
            return copy(operation.result);
          }
        } else {
          operation={schema:'starforge.stac-eoapi-operation.v1',id:operationId,kind,input:copy(input),
            inputSha256:digest,status:'PREPARED',phase:'PREPARED',createdAt:stamp(),updatedAt:stamp(),steps:{}};
          await writeJson(path,operation,{exclusive:true});
        }
        const save=async(phase,details={})=>{
          operation.phase=phase;operation.status='RUNNING';operation.updatedAt=stamp();
          Object.assign(operation.steps,copy(details));await writeJson(path,operation);
          await mutate(state=>{state.operations[operationId]={id:operationId,kind,inputSha256:digest,
            phase,status:operation.status,updatedAt:operation.updatedAt};return state.operations[operationId];});
        };
        try {
          await save(operation.phase);
          const result=await work(operation,save);
          operation.status=result?.status==='PARTIAL'?'PARTIAL':'COMPLETE';
          operation.phase=operation.status;operation.result=copy(result);operation.updatedAt=stamp();delete operation.error;
          await writeJson(path,operation);
          await mutate(state=>{state.operations[operationId]={id:operationId,kind,inputSha256:digest,
            phase:operation.phase,status:operation.status,updatedAt:operation.updatedAt};return state.operations[operationId];});
          return result;
        }catch(error) {
          operation.status='FAILED';operation.error=errorView(error);operation.updatedAt=stamp();
          await writeJson(path,operation);
          await mutate(state=>{state.operations[operationId]={id:operationId,kind,inputSha256:digest,
            phase:operation.phase,status:operation.status,updatedAt:operation.updatedAt,error:operation.error};return state.operations[operationId];});
          throw error;
        }
      });
    }finally{running.delete(operationId);if(!running.size)for(const done of idleWaiters.splice(0))done();}
  }
  async function getOperation(operationId) {
    key(operationId);
    const state=await read();need(state.operations[operationId],'EOAPI_OPERATION_NOT_FOUND');
    const record=await readJson(join(directory,'operations',sha256(operationId)+'.json'),16*1024*1024);
    need(record.id===operationId&&hash({kind:record.kind,input:record.input})===record.inputSha256,
      'EOAPI_OPERATION_RECORD_CHANGED');return record;
  }
  async function discover({approvalId,operationId,target='deployment'}={}) {
    const selected=await approved(approvalId);
    need(['deployment','upstream'].includes(target),'EOAPI_SOURCE_TARGET_INVALID');
    const expectedEndpoint=target==='upstream'?selected.policy.upstream.url:selected.policy.deployment.publicUrl;
    need(normalizeEndpoint(expectedEndpoint)===(await workspace.getState()).endpoint,'EOAPI_WORKSPACE_ENDPOINT_CHANGED');
    return operate({operationId,kind:'DISCOVER',input:{approvalId:selected.approval.id,policyPackageDigest:selected.digest,target}},async(_operation,save)=>{
      await save('ORIGINAL_CATALOG');
      await workspace.discover({operationId:operationKey(operationId,'discover')});
      const state=await workspace.getState();
      return {approvalId:selected.approval.id,policyPackageDigest:selected.digest,source:sourceSnapshot(state,selected.policy,null,target)};
    });
  }
  async function reviewSource({approvalId,editionId,reviewer,expectedRevision,target='deployment'}={}) {
    reviewer=actor(reviewer);
    const selected=await approved(approvalId),state=await workspace.getState();
    const detail=editionId?await workspace.getEdition(key(editionId)):null;
    const source=sourceSnapshot(state,selected.policy,detail,target);
    const intent={approvalId:selected.approval.id,policyPackageDigest:selected.digest,reviewer,source};
    const id='eoapi-source-'+hash(intent).slice(0,24);
    const prior=(await read()).sourceReviews.find(item=>item.id===id);
    if(prior)return sourceReview(id);
    const core={schema:REVIEW,id,workspaceId:native.id,approvalId:selected.approval.id,
      policyDigest:selected.compilation.digest,policyPackageDigest:selected.digest,
      policyPackage:selected.package,reviewer,source,ready:source.ready,at:stamp()};
    const reviewPath=join(directory,'reviews',id+'.json');
    const record=await exists(reviewPath)?await readJson(reviewPath,8*1024*1024):{...core,sha256:hash(core)};
    const {sha256:retainedDigest,...retainedCore}=record;
    need(retainedDigest===hash(retainedCore)&&record.id===id&&record.policyPackageDigest===selected.digest&&
      record.reviewer===reviewer&&same(record.source,source),'EOAPI_SOURCE_REVIEW_CONFLICT');
    await retainJSON(reviewPath,record);
    await mutate(value=>{
      const present=value.sourceReviews.find(item=>item.id===id);
      if(present){need(present.sha256===record.sha256,'EOAPI_SOURCE_REVIEW_CONFLICT');return present;}
      const summary={id,sha256:record.sha256,approvalId:record.approvalId,policyDigest:record.policyDigest,
        policyPackageDigest:record.policyPackageDigest,ready:record.ready,reviewer,at:record.at,
        ...(editionId?{editionId}:{}),findings:source.findings};
      value.sourceReviews.push(summary);return summary;
    },expectedRevision);
    return record;
  }
  async function bindEdition({sourceReviewId,editionId,operationId}={}) {
    const record=await sourceReview(sourceReviewId);
    need(record.ready,'EOAPI_SOURCE_REVIEW_REQUIRES_CORRECTION');
    return operate({operationId,kind:'BIND_EDITION',input:{sourceReviewId,sourceReviewSha256:record.sha256,editionId}},async()=>{
      const detail=await workspace.getEdition(key(editionId)),selected=validateDeploymentPolicyPackage(record.policyPackage);
      const actual=sourceSnapshot(await workspace.getState(),selected.policy,detail,record.source.target);
      need(actual.ready&&same(sourceIdentity(record.source,actual.collections.map(item=>item.id)),sourceIdentity(actual)),'EOAPI_EDITION_SOURCE_CHANGED');
      need(detail.edition.status==='COMPLETE'&&detail.edition.coverage?.complete,'EOAPI_COMPLETE_ORIGINAL_EDITION_REQUIRED');
      const binding={editionId,sourceReviewId,sourceReviewSha256:record.sha256,
        approvalId:record.approvalId,policyPackageDigest:record.policyPackageDigest,policyDigest:record.policyDigest,
        querySha256:hash(detail.edition.query),catalogSha256:actual.catalogSha256,
        collections:actual.collections.map(item=>({id:item.id,sha256:item.sha256}))};
      await mutate(state=>{if(state.editions[editionId])need(same(state.editions[editionId],binding),'EOAPI_EDITION_BINDING_CHANGED');
        else state.editions[editionId]=binding;return binding;});
      return {status:'COMPLETE',...binding};
    });
  }
  async function capture({sourceReviewId,query,operationId}={}) {
    const record=await sourceReview(sourceReviewId);need(record.ready,'EOAPI_SOURCE_REVIEW_REQUIRES_CORRECTION');
    const selected=validateDeploymentPolicyPackage(record.policyPackage);
    const state=await workspace.getState(),normalized=normalizeQuery(query,{endpoint:state.endpoint,collections:state.collections});
    need(normalized.collections.every(id=>selected.policy.collectionRights.some(right=>right.id===id)&&
      record.source.collections.some(collection=>collection.id===id)),'EOAPI_QUERY_COLLECTION_OUTSIDE_REVIEW');
    const name=typeof query.name==='string'&&query.name.trim()?query.name.trim():'Customer scene search';
    return operate({operationId,kind:'CAPTURE',input:{sourceReviewId,sourceReviewSha256:record.sha256,query:{name,...normalized}}},async(operation,save)=>{
      const current=sourceSnapshot(await workspace.getState(),selected.policy,null,record.source.target);
      need(current.ready&&same(sourceIdentity(record.source,normalized.collections),sourceIdentity(current,normalized.collections)),
        'EOAPI_CATALOG_CHANGED_REVIEW_REQUIRED');
      const saved=await workspace.saveQuery({...normalized,name,operationId:operationKey(operationId,'query')});
      await save('QUERY_SAVED',{queryId:saved.id});
      const review=await workspace.reviewSearch({queryId:saved.id,operationId:operationKey(operationId,'review')});
      need(same(normalizeQuery(review.query,{endpoint:state.endpoint}),normalized)&&hash(review.catalog)===record.source.catalogSha256,
        'EOAPI_NATIVE_SEARCH_REVIEW_CHANGED');
      await save('SEARCH_REVIEWED',{reviewId:review.id});
      const originalOperation=(await workspace.getState()).operations[operationKey(operationId,'search')];
      let edition=await workspace.acquire({reviewId:review.id,operationId:operationKey(operationId,'search')});
      if(originalOperation&&edition.status!=='COMPLETE')edition=await workspace.resume({editionId:edition.id});
      await save('SOURCE_RECEIVED',{editionId:edition.id});
      if(edition.status!=='COMPLETE')return {status:'PARTIAL',editionId:edition.id,coverage:edition.coverage};
      const binding=await bindEdition({sourceReviewId,editionId:edition.id,operationId:operationKey(operationId,'bind')});
      return {status:'COMPLETE',editionId:edition.id,coverage:copy(edition.coverage),binding};
    });
  }
  /** Asset choices are the existing analyst's saved decisions. Review and acquisition
   * use the original owner, including its existing retained-byte recovery. */
  async function acquireSelected({editionId,operationId,maxBytes=16*1024*1024}={}) {
    key(editionId);need(Number.isSafeInteger(maxBytes)&&maxBytes>0&&maxBytes<=2*1024**3,'EOAPI_ASSET_BYTE_BUDGET_INVALID');
    const binding=(await read()).editions[editionId];need(binding,'EOAPI_BOUND_EDITION_REQUIRED');
    const review=await sourceReview(binding.sourceReviewId),policy=validateDeploymentPolicyPackage(review.policyPackage).policy;
    const detail=await workspace.getEdition(editionId);
    const choices=detail.decisions.filter(item=>item.status==='SELECTED').map(item=>{
      need(Array.isArray(item.assetKeys)&&item.assetKeys.length,'EOAPI_SELECT_EXPLICIT_ASSET_KEYS');
      return {itemId:item.itemId,assetKeys:[...item.assetKeys].sort()};
    }).sort((a,b)=>a.itemId.localeCompare(b.itemId));
    need(choices.length,'EOAPI_ANALYST_SELECTION_REQUIRED');
    return operate({operationId,kind:'ACQUIRE_SELECTED',input:{editionId,sourceReviewSha256:binding.sourceReviewSha256,choices,maxBytes}},async(_operation,save)=>{
      const assets=[];
      for(const choice of choices)for(const assetKey of choice.assetKeys) {
        const step=sha256(canonicalJson([choice.itemId,assetKey])).slice(0,20);
        const retained=await workspace.reviewAsset({editionId,itemId:choice.itemId,assetKey,maxBytes,
          operationId:operationKey(operationId,'asset-review-'+step)});
        const rights=policy.collectionRights.find(item=>item.id===retained.collection);
        need(rights,'EOAPI_ASSET_COLLECTION_OUTSIDE_REVIEW');
        const present=(await workspace.getEdition(editionId)).assets.filter(item=>item.status==='COMPLETE'&&
          item.itemId===choice.itemId&&item.assetKey===assetKey&&item.href===retained.href&&
          item.descriptor?.itemDigest===retained.itemDigest).at(-1);
        let acquired;
        if(present){await workspace.getAssetFile(present.id);acquired=present;}
        else {
          need(!['retained-files','requester-pays'].includes(rights.assetAccess),'EOAPI_RETAINED_SOURCE_ASSET_REQUIRED');
          await save('ASSET_ACQUIRING',{currentAsset:{itemId:choice.itemId,assetKey,reviewId:retained.id}});
          acquired=await workspace.acquireAsset({reviewId:retained.id,operationId:operationKey(operationId,'asset-'+step)});
        }
        assets.push({id:acquired.id,itemId:choice.itemId,assetKey,bytes:acquired.bytes,sha256:acquired.sha256,href:acquired.href});
        await save('ASSET_RETAINED',{assets});
      }
      const current=(await workspace.getEdition(editionId)).decisions.filter(item=>item.status==='SELECTED')
        .map(item=>({itemId:item.itemId,assetKeys:[...item.assetKeys].sort()})).sort((a,b)=>a.itemId.localeCompare(b.itemId));
      need(same(current,choices),'EOAPI_ANALYST_SELECTION_CHANGED');
      return {status:'COMPLETE',editionId,assets,files:assets.length,bytes:assets.reduce((sum,item)=>sum+item.bytes,0)};
    });
  }
  async function prepareDelivery({editionId,operationId,reviewer}={}) {
    reviewer=actor(reviewer);key(editionId);
    const binding=(await read()).editions[editionId];need(binding,'EOAPI_BOUND_EDITION_REQUIRED');
    const source=await sourceReview(binding.sourceReviewId);
    return operate({operationId,kind:'PREPARE_DELIVERY',input:{editionId,sourceReviewSha256:source.sha256,reviewer}},async(operation,save)=>{
      const {readStacEdition}=await import('../merchant.mjs');
      await privateDirectory(outputDirectory);
      const destination=await privateDirectory(join(outputDirectory,operationKey(operationId,'edition')));
      let exported;
      if(await exists(join(destination,'manifest.json'))) {
        // The original compiler publishes its manifest last. Recover that exact
        // completed export even when later analyst decisions have changed.
        exported=await readStacEdition(destination);
        need(exported.manifest.capture.id===editionId&&hash(exported.manifest.query)===binding.querySha256&&
          hash(exported.manifest.catalog)===binding.catalogSha256,'EOAPI_RETAINED_EDITION_CHANGED');
      } else {
        const detail=await workspace.getEdition(editionId),selected=detail.decisions.filter(item=>item.status==='SELECTED');
        need(selected.length,'EOAPI_ANALYST_SELECTION_REQUIRED');
        for(const decision of selected) {
          need(Array.isArray(decision.assetKeys)&&decision.assetKeys.length,'EOAPI_SELECT_EXPLICIT_ASSET_KEYS');
          for(const assetKey of decision.assetKeys)need(detail.assets.some(item=>
            item.status==='COMPLETE'&&item.itemId===decision.itemId&&item.assetKey===assetKey),'EOAPI_SELECTED_ASSET_NOT_ACQUIRED');
        }
        const choices=selected.map(item=>({itemId:item.itemId,assetKeys:[...item.assetKeys].sort()}))
          .sort((a,b)=>a.itemId.localeCompare(b.itemId));
        const decisionsSha256=hash(detail.decisions);
        if(operation.steps.choices)need(same(operation.steps.choices,choices)&&
          operation.steps.decisionsSha256===decisionsSha256,'EOAPI_REVIEWED_SELECTION_CHANGED');
        await save('ORIGINAL_EDITION_EXPORT',{choices,decisionsSha256});
        exported=await workspace.exportEdition({editionId,directory:destination});
      }
      need(exported.manifest.assets.length,'EOAPI_SELECTED_FILE_DELIVERY_REQUIRED');
      const retainedDecisions=await readJson(join(destination,exported.manifest.paths.decisions),16*1024*1024);
      need(operation.steps.decisionsSha256===hash(retainedDecisions.decisions),'EOAPI_EXPORTED_DECISIONS_CHANGED');
      const retainedChoices=retainedDecisions.decisions.filter(item=>item.status==='SELECTED')
        .map(item=>({itemId:item.itemId,assetKeys:[...item.assetKeys].sort()})).sort((a,b)=>a.itemId.localeCompare(b.itemId));
      need(same(retainedChoices,operation.steps.choices)&&retainedChoices.every(item=>item.assetKeys.length),'EOAPI_EXPORTED_SELECTION_CHANGED');
      const id='eoapi-delivery-review-'+sha256(operationId).slice(0,24);
      const core={schema:DELIVERY_REVIEW,id,workspaceId:native.id,sourceReviewId:source.id,sourceReviewSha256:source.sha256,
        approvalId:source.approvalId,policyDigest:source.policyDigest,policyPackageDigest:source.policyPackageDigest,
        edition:manifestIdentity(exported.manifest),reviewer,at:stamp()};
      const path=join(directory,'reviews',id+'.json');
      const existing=await exists(path)?await readJson(path,16*1024*1024):null;
      if(existing)need(existing.edition.digest===core.edition.digest&&existing.sourceReviewSha256===source.sha256&&
        existing.reviewer===reviewer,'EOAPI_DELIVERY_REVIEW_CONFLICT');
      const record=existing??{...core,sha256:hash(core)};
      await retainJSON(path,record);
      await mutate(state=>{
        const prior=state.deliveryReviews.find(item=>item.id===id);
        if(prior){need(prior.sha256===record.sha256,'EOAPI_DELIVERY_REVIEW_CONFLICT');return record;}
        state.deliveryReviews.push({id,sha256:record.sha256,editionId,nativeEditionId:record.edition.id,
          editionDigest:record.edition.digest,directory:destination,sourceReviewId:source.id,approvalId:source.approvalId,
          files:record.edition.assets.length,bytes:record.edition.assets.reduce((sum,item)=>sum+item.bytes,0),reviewer,at:record.at});
        return record;
      });
      return record;
    });
  }
  async function approveDelivery({reviewId,reviewer,expectedRevision}={}) {
    reviewer=actor(reviewer);
    const review=await deliveryReview(reviewId);
    const prior=(await read()).deliveryApprovals.find(item=>item.reviewId===reviewId&&item.reviewer===reviewer);
    if(prior)return prior;
    return mutate(state=>{
      const existing=state.deliveryApprovals.find(item=>item.reviewId===reviewId&&item.reviewer===reviewer);
      if(existing)return existing;
      const result={id:'eoapi-delivery-approval-'+randomUUID(),reviewId,reviewSha256:review.sha256,
        editionDigest:review.edition.digest,policyPackageDigest:review.policyPackageDigest,reviewer,at:stamp()};
      state.deliveryApprovals.push(result);return result;
    },expectedRevision);
  }
  async function stageMerchant({deliveryApprovalId,operationId,origin,payment,path='/stac'}={}) {
    const state=await read(),approval=state.deliveryApprovals.find(item=>item.id===deliveryApprovalId);
    need(approval,'EOAPI_DELIVERY_APPROVAL_REQUIRED');
    const review=await deliveryReview(approval.reviewId);
    const saved=state.deliveryReviews.find(item=>item.id===review.id);
    return operate({operationId,kind:'STAGE_MERCHANT',input:{deliveryApprovalId,reviewSha256:review.sha256,origin,payment,path}},async(_operation,save)=>{
      const {stageStacMerchant,readStacEdition}=await import('../merchant.mjs');
      const edition=await readStacEdition(saved.directory);
      need(approval.reviewSha256===review.sha256&&approval.editionDigest===review.edition.digest&&
        same(manifestIdentity(edition.manifest),review.edition),'EOAPI_APPROVED_EDITION_CHANGED');
      await save('ORIGINAL_MERCHANT_STAGE');
      const result=await stageStacMerchant({editionDirectory:saved.directory,
        directory:join(outputDirectory,operationKey(operationId,'merchant')),origin,payment,path});
      need(result.editionDigest===review.edition.digest,'EOAPI_MERCHANT_EDITION_CHANGED');
      return result;
    });
  }
  async function deliveryContext({deliveryApprovalId}={}) {
    const state=await read(),approval=state.deliveryApprovals.find(item=>item.id===deliveryApprovalId);
    need(approval,'EOAPI_DELIVERY_APPROVAL_REQUIRED');
    const review=await deliveryReview(approval.reviewId),source=await sourceReview(review.sourceReviewId);
    need(review.sha256===approval.reviewSha256&&review.policyPackageDigest===source.policyPackageDigest,'EOAPI_DELIVERY_APPROVAL_CHANGED');
    return {approval,review,source};
  }
  async function recordDelivery(receipt) {
    need(receipt&&HASH.test(receipt.sha256??'')&&typeof receipt.directory==='string','EOAPI_DELIVERY_RECEIPT_REQUIRED');
    return mutate(state=>{
      const prior=state.deliveries.find(item=>item.sha256===receipt.sha256);
      if(prior)return prior;
      state.deliveries.push(copy(receipt));return receipt;
    });
  }
  return Object.freeze({directory,outputDirectory,getState:owned(read),discover:owned(discover),
    reviewSource:owned(reviewSource),sourceReview:owned(sourceReview),getOperation:owned(getOperation),bindEdition:owned(bindEdition),capture:owned(capture),
    acquireSelected:owned(acquireSelected),prepareDelivery:owned(prepareDelivery),deliveryReview:owned(deliveryReview),
    approveDelivery:owned(approveDelivery),stageMerchant:owned(stageMerchant),deliveryContext:owned(deliveryContext),recordDelivery:owned(recordDelivery),
    close(){if(!closingPromise){closing=true;closingPromise=(async()=>{
      await Promise.allSettled([...admitted]);if(running.size)await new Promise(done=>idleWaiters.push(done));
      await queue;closed=true;
    })();}return closingPromise;}});
}
