// MIT. One retained operating surface over the original SQL Server model and seller.
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createMssqlWorkspace } from './model.mjs';
import { createMssqlTransfers } from './transfer.mjs';
import { stageRelease, readReleaseState } from '../../../sf82-seller-pilot/releases.mjs';
import { UUID, SHA, exact, checked, need, canonical, digest, readJSON, readBytes, publish, exists,
  privateDirectory, operatorLease, initializeMssqlOperator, readMssqlOperatorIdentity, pageJSON, absolute } from './operator-store.mjs';

const REQUEST='stellar-forge.mssql-operator-request.v1';
export async function createMssqlOperator(options={}) {
  const root=absolute(options.stateDirectory);
  if(!await exists(join(root,'operator','workspace.json')))
    await initializeMssqlOperator({sourceFile:options.sourceFile,stateDirectory:root});
  const identity=await readMssqlOperatorIdentity(root),lease=await operatorLease(identity.directory);
  let model,transfers,pending=Promise.resolve(),closing=false,closePromise;
  const cachedReviews=new Map();
  try {
    for(const name of ['requests','results','reviews','exports','staging'])
      await privateDirectory(join(identity.directory,name),true);
    if(options.expectedWorkspaceId!==undefined)
      need(identity.workspaceId===options.expectedWorkspaceId,'MSSQL_WORKSPACE_IDENTITY_CHANGED',undefined,409);
    model=await createMssqlWorkspace(options);
    const current=await model.info();
    if(options.expectedProfileId!==undefined)
      need(current.profileId===options.expectedProfileId,'SOURCE_PROFILE_CHANGED',undefined,409);
    transfers=createMssqlTransfers({model,identity});
  } catch(error) {await model?.close().catch(()=>{});await lease.close();throw error;}
  const serialize=fn=>{
    if(closing)return Promise.reject(Object.assign(new Error('MSSQL_WORKSPACE_CLOSING'),{code:'MSSQL_WORKSPACE_CLOSING',status:503}));
    const call=pending.then(()=>{lease.assertHeld();return fn();});pending=call.catch(()=>{});return call;
  };
  async function request(kind,operationId,input) {
    const id=operationId===undefined?randomUUID():checked(operationId,UUID,'operation UUID');
    const path=join(identity.directory,'requests',id+'.json'),inputSha256=digest(canonical(input));
    let saved;
    if(await exists(path)) {
      saved=await readJSON(path,1048576);
      need(saved.schema===REQUEST && saved.operationId===id && saved.workspaceId===identity.workspaceId &&
        saved.kind===kind && saved.inputSha256===inputSha256 && canonical(saved.input)===canonical(input),
        'MSSQL_OPERATION_CONFLICT','The original operation UUID belongs to different choices.',409);
    } else {
      saved={schema:REQUEST,operationId:id,workspaceId:identity.workspaceId,kind,inputSha256,
        createdAt:new Date().toISOString(),input};
      lease.assertHeld();await publish(path,saved);
    }
    const resultPath=join(identity.directory,'results',id+'.json');
    return {saved,resultPath,result:await exists(resultPath)?await readJSON(resultPath,4*1024*1024):null};
  }
  async function completed(operation,result) {
    lease.assertHeld();await publish(operation.resultPath,result);return result;
  }
  async function retainedReview(id,planId) {
    checked(id,UUID,'review UUID');
    const saved=await readJSON(join(identity.directory,'reviews',id+'.json'),1048576);
    need(saved.schema==='stellar-forge.mssql-retained-review.v1' && saved.review.reviewId===id &&
      saved.workspaceId===identity.workspaceId && SHA.test(saved.review.planId ?? '') &&
      (planId===undefined || saved.review.planId===planId),'MSSQL_REVIEW_CHANGED',undefined,409);
    return saved;
  }
  async function nativeReview(saved) {
    need(Date.now()<=Date.parse(saved.review.expiresAt),'REVIEW_CURRENT_CHOICES_REQUIRED',undefined,409);
    let current=cachedReviews.get(saved.review.reviewId);
    if(!current || Date.now()>Date.parse(current.expiresAt)) {
      current=await model.review(saved.choices);
      need(current.planId===saved.review.planId && current.profileId===saved.review.profileId,
        'SOURCE_SCHEMA_CHANGED',undefined,409);
      cachedReviews.set(saved.review.reviewId,current);
    }
    return current;
  }
  async function review(input) {
    let choices=input,operationId;
    if(Object.hasOwn(input??{},'choices')) {
      exact(input,['choices','operationId'],['choices','operationId']);
      choices=input.choices;operationId=input.operationId;
    }
    const operation=await request('review',operationId,choices);
    if(operation.result)return operation.result;
    const path=join(identity.directory,'reviews',operation.saved.operationId+'.json');
    if(await exists(path))return completed(operation,(await retainedReview(operation.saved.operationId)).review);
    const current=await model.review(choices);
    const reviewed={...current,reviewId:operation.saved.operationId,workspaceId:identity.workspaceId};
    await publish(path,{schema:'stellar-forge.mssql-retained-review.v1',workspaceId:identity.workspaceId,
      review:reviewed,choices:structuredClone(choices)});
    cachedReviews.set(reviewed.reviewId,current);
    return completed(operation,reviewed);
  }
  async function preview(input) {
    exact(input,['reviewId','planId','endpointId','operationId'],['reviewId','planId','endpointId']);
    const {operationId,...selection}=input;
    const operation=operationId===undefined?null:await request('preview',operationId,selection);
    if(operation?.result)return operation.result;
    const saved=await retainedReview(input.reviewId,input.planId),current=await nativeReview(saved);
    const result=await model.preview({...selection,reviewId:current.reviewId});
    const value={...result,workspaceId:identity.workspaceId,reviewId:input.reviewId,
      ...(operation?{operationId:operation.saved.operationId,capturedAt:new Date().toISOString()}:{})};
    return operation?completed(operation,value):value;
  }
  async function prepare(input) {
    exact(input,['reviewId','planId','operationId'],['reviewId','planId']);
    const {operationId,...selection}=input;
    const operation=operationId===undefined?null:await request('prepare',operationId,selection);
    if(operation?.result) {
      const current=await model.open(operation.result.releaseId);
      need(current.manifestSha256===operation.result.manifestSha256,'RELEASE_CHANGED',undefined,409);
      return {...current,workspaceId:identity.workspaceId,reopened:true};
    }
    const saved=await retainedReview(input.reviewId,input.planId);
    let prepared;
    try {prepared=await model.open(saved.review.releaseId);}
    catch(error){if(error.code!=='ENOENT')throw error;}
    if(prepared)need(prepared.planId===input.planId,'RELEASE_ID_ALREADY_USED',undefined,409);
    else {
      const current=await nativeReview(saved);
      prepared=await model.prepare({reviewId:current.reviewId,planId:current.planId});
    }
    const result={...prepared,workspaceId:identity.workspaceId};
    return operation?completed(operation,result):result;
  }
  async function operationLoad(id) {
    checked(id,UUID,'operation UUID');
    const saved=await readJSON(join(identity.directory,'requests',id+'.json'),1048576);
    need(saved.schema===REQUEST&&saved.operationId===id&&saved.workspaceId===identity.workspaceId&&
      saved.inputSha256===digest(canonical(saved.input)),'MSSQL_OPERATION_CHANGED',undefined,409);
    const resultPath=join(identity.directory,'results',id+'.json');
    return {workspaceId:identity.workspaceId,operationId:id,request:saved,
      state:await exists(resultPath)?'COMPLETED':'RETAINED_REQUEST',
      result:await exists(resultPath)?await readJSON(resultPath,4*1024*1024):null};
  }
  async function info() {
    return {...await model.info(),workspaceId:identity.workspaceId,workspaceCreatedAt:identity.createdAt,
      workspaceIdentitySha256:identity.sha256,stageAvailable:Boolean(options.releaseStore)};
  }
  return {
    ...model,stateDirectory:root,workspaceId:identity.workspaceId,
    info:()=>serialize(info),
    review:input=>serialize(()=>review(input)),
    preview:input=>serialize(()=>preview(input)),
    prepare:input=>serialize(()=>prepare(input)),
    reviewLoad:id=>serialize(async()=>retainedReview(id)),
    operationLoad:id=>serialize(()=>operationLoad(id)),
    operationList:(input={})=>serialize(()=>pageJSON(join(identity.directory,'requests'),input,async id=>{
      const saved=await operationLoad(id);
      return {operationId:id,workspaceId:identity.workspaceId,kind:saved.request.kind,
        createdAt:saved.request.createdAt,inputSha256:saved.request.inputSha256,state:saved.state};
    })),
    reviewList:(input={})=>serialize(()=>pageJSON(join(identity.directory,'reviews'),input,
      async id=>{const saved=await retainedReview(id);return {...saved.review,expired:Date.now()>Date.parse(saved.review.expiresAt)};})),
    exportSource:input=>serialize(async()=>{
      exact(input,['releaseId','manifestSha256','kind','operationId'],['releaseId','manifestSha256','kind','operationId']);
      const {operationId,...selection}=input,operation=await request('export',operationId,selection);
      if(operation.result)return transfers.manifest(operationId);
      return completed(operation,await transfers.exportSource(selection,operation.saved));
    }),
    exports:(input={})=>serialize(()=>transfers.exports(input)),
    exportManifest:id=>serialize(()=>transfers.manifest(id)),
    exportFile:input=>serialize(()=>transfers.file(input)),
    exportFileRelease:input=>serialize(()=>transfers.release(input)),
    receiveSource:input=>serialize(async()=>{
      exact(input,['directory','expectedManifestSha256','operationId'],['directory','expectedManifestSha256','operationId']);
      const {operationId,...selection}=input,operation=await request('receive',operationId,selection);
      if(operation.result) {
        const original=await model.open(operation.result.releaseId);
        need(original.manifestSha256===operation.result.manifestSha256,'RELEASE_CHANGED',undefined,409);
        return {...original,workspaceId:identity.workspaceId,reopened:true};
      }
      return completed(operation,{...await transfers.receive(selection),workspaceId:identity.workspaceId});
    }),
    stage:input=>serialize(async()=>{
      exact(input,['releaseId','manifestSha256','id','store'],['releaseId','manifestSha256','id']);
      checked(input.manifestSha256,SHA,'prepared digest');
      need(options.releaseStore && (input.store===undefined || absolute(input.store)===absolute(options.releaseStore)),
        'MSSQL_RELEASE_STORE_NOT_SELECTED','Start this original workspace with the same --release-store as its merchant host.');
      await readReleaseState(options.releaseStore);
      const original=await model.open(input.releaseId);
      need(original.manifestSha256===input.manifestSha256,'RELEASE_CHANGED',undefined,409);
      return stageRelease(options.releaseStore,{id:input.id,mssqlPackage:original.directory});
    }),
    close() {
      closing=true;
      if(!closePromise)closePromise=(async()=>{
        await pending;
        await transfers.close();await model.close();cachedReviews.clear();await lease.close();
      })().catch(error=>{closePromise=null;throw error;});
      return closePromise;
    }
  };
}
