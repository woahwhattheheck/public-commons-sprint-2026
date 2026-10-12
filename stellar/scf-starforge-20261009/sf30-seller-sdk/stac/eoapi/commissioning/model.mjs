// MIT. Reviewed eoAPI commissioning cases; observations retain their actual source.
import { createHash } from 'node:crypto';
import { need, object, jsonBytes } from '../../../../sf88-operator-buyer-cli/node/store.mjs';
import { canonicalJson, publicURL, normalizeEndpoint } from '../../provider.mjs';
import { compileDeploymentPolicy, canonicalPolicyJSON, policyDigest } from '../deployment-policy.mjs';

export const PLAN_SCHEMA = 'scf-eoapi-commissioning-plan/v1';
export const RUN_SCHEMA = 'scf-eoapi-commissioning-run/v1';
export const PACKAGE_SCHEMA = 'scf-eoapi-commissioning-package/v1';
export const digest = policyDigest;
export const bytesDigest = value => createHash('sha256').update(value).digest('hex');
export const clone = value => JSON.parse(jsonBytes(value));
export const identifier = value => {
  need(typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value), 'EOAPI_COMMISSIONING_ID_REQUIRED');
  return value;
};
const text = (value, max=1000) => {
  need(typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value),
    'EOAPI_COMMISSIONING_TEXT_INVALID');
  return value;
};
const strings = (value, code, max=1000) => {
  need(Array.isArray(value) && value.length <= max && value.every(v=>typeof v==='string'&&v.length>0&&v.length<=2048), code);
  need(new Set(value).size===value.length, code);
  return [...value];
};
const plainKeys=(value, allowed, code)=>{
  need(object(value) && Object.keys(value).every(key=>allowed.includes(key)), code);return value;
};
const sourceIdentity = value => {
  need(object(value) && typeof value.sha256==='string' && /^[a-f0-9]{64}$/.test(value.sha256) &&
    Number.isSafeInteger(value.bytes) && value.bytes>=0, 'EOAPI_COMMISSIONING_SOURCE_IDENTITY_INVALID');
  return {bytes:value.bytes,sha256:value.sha256};
};
export function sameNamespace(url, endpoint) {
  const a=new URL(url), b=new URL(endpoint);
  if (/%(?:2f|5c)/i.test(a.pathname)) return false;
  const base=b.pathname.replace(/\/+$/,'');
  return a.origin===b.origin && (a.pathname===base || a.pathname.startsWith(base+'/'));
}
export function approvalBinding(state, approvalId) {
  identifier(approvalId);
  need(object(state) && Array.isArray(state.approvals) && Array.isArray(state.reviews), 'EOAPI_POLICY_WORKSPACE_REQUIRED');
  const approval=state.approvals.find(row=>row.id===approvalId);
  need(approval, 'EOAPI_POLICY_APPROVAL_REQUIRED');
  const review=state.reviews.find(row=>row.id===approval.reviewId);
  need(review && object(review.policy) && approval.policyDigest===review.policyDigest, 'EOAPI_POLICY_APPROVAL_CHANGED');
  const workspaceId=state.id ?? state.workspaceId;
  need(typeof workspaceId==='string' && workspaceId.length>0, 'EOAPI_POLICY_WORKSPACE_ID_REQUIRED');
  need(typeof review.policyDigest==='string'&&/^[a-f0-9]{64}$/.test(review.policyDigest), 'EOAPI_POLICY_DIGEST_INVALID');
  const compilation=compileDeploymentPolicy(review.policy);
  need(compilation.ready&&compilation.digest===review.policyDigest&&policyDigest(review.compilation)===policyDigest(compilation),
    'EOAPI_POLICY_APPROVAL_CHANGED');
  return {workspaceId, approval:clone(approval), reviewId:review.id, policyDigest:review.policyDigest,
    policy:clone(compilation.policy), compilation:clone(compilation)};
}
function requestFor(input, binding, assets, target) {
  plainKeys(input,['url','method','body','headers'],'EOAPI_COMMISSIONING_REQUEST_FIELDS_INVALID');
  const url=publicURL(input.url), method=String(input.method??'GET').toUpperCase();
  need(['GET','HEAD','POST'].includes(method),'EOAPI_COMMISSIONING_READ_ONLY_REQUIRED');
  const endpoint=normalizeEndpoint(target==='upstream'?binding.policy.upstream.url:binding.policy.deployment.publicUrl);
  const matchingAsset=assets.find(asset=>asset.href===url);
  need(sameNamespace(url,endpoint)||matchingAsset,'EOAPI_COMMISSIONING_UNREVIEWED_SOURCE');
  if(matchingAsset) need(method==='HEAD' && input.body===undefined,'EOAPI_COMMISSIONING_ASSET_HEAD_REQUIRED');
  if(method==='POST'){
    const expected=new URL(endpoint);expected.pathname=expected.pathname.replace(/\/+$/,'')+'/search';
    need(url===expected.href && object(input.body),'EOAPI_COMMISSIONING_SEARCH_ONLY_POST');
    need(Buffer.byteLength(canonicalJson(input.body))<=256*1024,'EOAPI_COMMISSIONING_SEARCH_SIZE_LIMIT');
  } else need(input.body===undefined,'EOAPI_COMMISSIONING_BODY_NOT_ALLOWED');
  const headers=new Headers(input.headers??{accept:matchingAsset?'*/*':'application/geo+json, application/json'});
  need([...headers.keys()].every(name=>['accept','content-type'].includes(name)) && [...headers.values()].every(value=>value.length<=1024), 'EOAPI_COMMISSIONING_PUBLIC_HEADERS_REQUIRED');
  const request={url,method,headers:Object.fromEntries(headers)};
  if(method==='POST'){
    need(!headers.has('content-type')||headers.get('content-type').toLowerCase()==='application/json','EOAPI_COMMISSIONING_JSON_SEARCH_REQUIRED');
    request.headers['content-type']='application/json';request.body=clone(input.body);
  }
  return {request,sourceAsset:matchingAsset?clone(matchingAsset):null};
}
function expectedFor(input) {
  plainKeys(input,['statuses','documentType','requiredConformance','allowedCollections','requiredCollections',
    'requiredItems','contentType','maxBytes'],'EOAPI_COMMISSIONING_EXPECTATION_FIELDS_INVALID');
  need(Array.isArray(input.statuses)&&input.statuses.length>0&&input.statuses.length<=10 &&
    input.statuses.every(v=>Number.isInteger(v)&&v>=200&&v<=599),'EOAPI_COMMISSIONING_STATUS_EXPECTATION_REQUIRED');
  const result={statuses:[...new Set(input.statuses)].sort((a,b)=>a-b)};
  if(input.documentType!==undefined){
    need(['Catalog','Collection','FeatureCollection','Feature','Conformance'].includes(input.documentType),'EOAPI_COMMISSIONING_DOCUMENT_TYPE_INVALID');
    result.documentType=input.documentType;
  }
  for(const field of ['requiredConformance','allowedCollections','requiredCollections','requiredItems'])
    if(input[field]!==undefined)result[field]=strings(input[field],'EOAPI_COMMISSIONING_EXPECTATION_INVALID');
  if(input.contentType!==undefined)result.contentType=text(input.contentType,200).toLowerCase();
  if(input.maxBytes!==undefined){
    need(Number.isSafeInteger(input.maxBytes)&&input.maxBytes>=0&&input.maxBytes<=64*1024*1024,'EOAPI_COMMISSIONING_SIZE_EXPECTATION_INVALID');
    result.maxBytes=input.maxBytes;
  }
  return result;
}
export function prepareCommissioningPlan(input,binding,{assets=[]}={}) {
  plainKeys(input,['title','note','approvalId','cases','minimumIntervalMs','target'],'EOAPI_COMMISSIONING_PLAN_FIELDS_INVALID');
  need(input.approvalId===binding.approval.id,'EOAPI_POLICY_APPROVAL_CHANGED');
  need(Array.isArray(input.cases)&&input.cases.length>0&&input.cases.length<=128,'EOAPI_COMMISSIONING_CASES_REQUIRED');
  const target=input.target??'deployment';need(['upstream','deployment'].includes(target),'EOAPI_COMMISSIONING_TARGET_INVALID');
  const interval=input.minimumIntervalMs??1000;
  need(Number.isSafeInteger(interval)&&interval>=0&&interval<=300000,'EOAPI_COMMISSIONING_INTERVAL_INVALID');
  const collectionIds=new Set((binding.policy.collectionRights??[]).map(row=>row.id));
  const allowedAssets=assets.filter(row=>object(row)&&collectionIds.has(row.collection)&&typeof row.href==='string');
  const cases=input.cases.map(value=>{
    plainKeys(value,['id','title','principal','request','expect'],'EOAPI_COMMISSIONING_CASE_FIELDS_INVALID');
    const id=identifier(value.id), principal=identifier(value.principal??'anonymous');
    const selected=requestFor(value.request,binding,allowedAssets,target);
    return {id,title:text(value.title??id,300),principal,...selected,expect:expectedFor(value.expect)};
  });
  need(new Set(cases.map(row=>row.id)).size===cases.length,'EOAPI_COMMISSIONING_CASE_ID_REUSED');
  const plan={schema:PLAN_SCHEMA,title:text(input.title,300),note:input.note===undefined?'':text(input.note,8000),
    policyWorkspaceId:binding.workspaceId,approvalId:binding.approval.id,policyDigest:binding.policyDigest,
    target,endpoint:normalizeEndpoint(target==='upstream'?binding.policy.upstream.url:binding.policy.deployment.publicUrl),policy:clone(binding.policy),
    approval:clone(binding.approval),policyReviewId:binding.reviewId,cases,minimumIntervalMs:interval};
  return {...plan,digest:digest(plan)};
}
export function verifyPlan(plan) {
  need(object(plan)&&plan.schema===PLAN_SCHEMA&&typeof plan.digest==='string','EOAPI_COMMISSIONING_PLAN_INVALID');
  const {digest:given,...body}=plan;
  need(digest(body)===given,'EOAPI_COMMISSIONING_PLAN_CHANGED');
  need(Array.isArray(plan.cases)&&plan.cases.length>0&&new Set(plan.cases.map(row=>row.id)).size===plan.cases.length,
    'EOAPI_COMMISSIONING_PLAN_INVALID');
  const compilation=compileDeploymentPolicy(plan.policy);
  need(compilation.ready&&compilation.digest===plan.policyDigest&&plan.approval?.policyDigest===plan.policyDigest&&plan.approval.id===plan.approvalId&&plan.approval.reviewId===plan.policyReviewId,'EOAPI_POLICY_APPROVAL_CHANGED');
  const expected=prepareCommissioningPlan({title:plan.title,...(plan.note?{note:plan.note}:{}),approvalId:plan.approvalId,target:plan.target,minimumIntervalMs:plan.minimumIntervalMs,cases:plan.cases.map(row=>({id:row.id,title:row.title,principal:row.principal,request:row.request,expect:row.expect}))},
    {workspaceId:plan.policyWorkspaceId,approval:plan.approval,reviewId:plan.policyReviewId,policyDigest:plan.policyDigest,policy:compilation.policy},
    {assets:plan.cases.map(row=>row.sourceAsset).filter(Boolean)});
  need(expected.digest===plan.digest,'EOAPI_COMMISSIONING_PLAN_CHANGED');
  return plan;
}
export function retainedRequestMatches(planned,retained) {
  const normalized=request=>{
    const method=String(request.method??'GET').toUpperCase();
    const headers=Object.fromEntries(Object.entries(request.headers??{}).map(([key,value])=>[key.toLowerCase(),String(value)]));
    need(Object.keys(headers).every(key=>['accept','content-type'].includes(key)),'EOAPI_COMMISSIONING_RETAINED_HEADERS_INVALID');
    return {url:publicURL(request.url),method,headers,body:request.body===undefined?null:request.body};
  };
  return canonicalJson(normalized(planned))===canonicalJson(normalized(retained));
}
export function inspectObservation(entry,record,raw) {
  sourceIdentity(record);
  need(Number.isInteger(record.status)&&record.status>=100&&record.status<=599,'EOAPI_COMMISSIONING_RESPONSE_STATUS_INVALID');
  need(raw.length===record.bytes&&bytesDigest(raw)===record.sha256,'EOAPI_COMMISSIONING_RESPONSE_CHANGED');
  const headers=new Headers(record.headers??{}), issues=[];
  const fail=(code,details={})=>issues.push({code,...details});
  if(!entry.expect.statuses.includes(record.status))fail('HTTP_STATUS',{expected:entry.expect.statuses,actual:record.status});
  const contentType=(headers.get('content-type')??'').split(';')[0].trim().toLowerCase();
  if(entry.expect.contentType && contentType!==entry.expect.contentType)fail('CONTENT_TYPE',{expected:entry.expect.contentType,actual:contentType});
  if(entry.expect.maxBytes!==undefined&&raw.length>entry.expect.maxBytes)fail('RESPONSE_SIZE',{expectedMax:entry.expect.maxBytes,actual:raw.length});
  let document=null,parseError=null;
  if(raw.length){try{document=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{parseError='JSON_INVALID';}}
  const collections=[],items=[],conformance=[];
  if(object(document)){
    if(Array.isArray(document.conformsTo))for(const value of document.conformsTo)if(typeof value==='string')conformance.push(value);
    if(Array.isArray(document.collections))for(const value of document.collections)if(typeof value?.id==='string')collections.push(value.id);
    if(document.type==='Collection'&&typeof document.id==='string')collections.push(document.id);
    const features=document.type==='Feature'?[document]:Array.isArray(document.features)?document.features:[];
    for(const value of features){
      if(typeof value?.collection==='string')collections.push(value.collection);
      if(typeof value?.collection==='string'&&typeof value?.id==='string')items.push(value.collection+'/'+value.id);
    }
  }
  const observedCollections=[...new Set(collections)].sort(),observedItems=[...new Set(items)].sort(),observedConformance=[...new Set(conformance)].sort();
  if(entry.expect.documentType){
    const actual=object(document)?(Array.isArray(document.conformsTo)&&!document.type?'Conformance':document.type??null):null;
    if(actual!==entry.expect.documentType)fail('DOCUMENT_TYPE',{expected:entry.expect.documentType,actual,parseError});
  }
  const missing=(wanted,actual)=>wanted.filter(value=>!actual.includes(value));
  if(entry.expect.requiredConformance){
    const absent=missing(entry.expect.requiredConformance,observedConformance);if(absent.length)fail('CONFORMANCE_MISSING',{values:absent});
  }
  if(entry.expect.allowedCollections){
    const unexpected=observedCollections.filter(value=>!entry.expect.allowedCollections.includes(value));
    if(unexpected.length)fail('COLLECTION_ACCESS',{values:unexpected});
  }
  if(entry.expect.requiredCollections){
    const absent=missing(entry.expect.requiredCollections,observedCollections);if(absent.length)fail('COLLECTIONS_MISSING',{values:absent});
  }
  if(entry.expect.requiredItems){
    const absent=missing(entry.expect.requiredItems,observedItems);if(absent.length)fail('ITEMS_MISSING',{values:absent});
  }
  return {caseId:entry.id,principal:entry.principal,passed:issues.length===0,issues,
    observed:{status:record.status,contentType,bytes:raw.length,sha256:record.sha256,
      responseAt:record.completedAt??null,conformsTo:observedConformance,collections:observedCollections,items:observedItems,
      documentType:object(document)?document.type??null:null,hasNextPage:Array.isArray(document?.links)&&document.links.some(link=>link?.rel==='next'),
      etag:headers.get('etag'),lastModified:headers.get('last-modified'),retryAfter:headers.get('retry-after')},
    request:clone(entry.request),expect:clone(entry.expect)};
}
export function compareCommissioningRuns(left,right) {
  need(left?.schema===RUN_SCHEMA&&right?.schema===RUN_SCHEMA&&left.status==='COMPLETE'&&right.status==='COMPLETE',
    'EOAPI_COMMISSIONING_COMPLETE_RUNS_REQUIRED');
  const old=new Map(left.results.map(row=>[row.caseId,row])),current=new Map(right.results.map(row=>[row.caseId,row]));
  const changes=[];
  for(const id of [...new Set([...old.keys(),...current.keys()])].sort()){
    const a=old.get(id),b=current.get(id);
    if(!a||!b){changes.push({caseId:id,kind:a?'removed':'added',before:a??null,after:b??null});continue;}
    const comparable=a.principal===b.principal&&canonicalJson(a.request)===canonicalJson(b.request)&&canonicalJson(a.expect)===canonicalJson(b.expect);
    const fields=['status','contentType','conformsTo','collections','items','documentType','hasNextPage','bytes','sha256','etag','lastModified'];
    const differences=fields.filter(key=>canonicalJson(a.observed[key])!==canonicalJson(b.observed[key]));
    if(!comparable||differences.length||a.passed!==b.passed)changes.push({caseId:id,kind:comparable?(a.passed&&!b.passed?'regression':!a.passed&&b.passed?'resolved':'changed'):'case_changed',
      fields:differences,before:a,after:b});
  }
  return {schema:'scf-eoapi-commissioning-comparison/v1',leftRunId:left.id,rightRunId:right.id,
    leftPolicyDigest:left.policyDigest,rightPolicyDigest:right.policyDigest,policyChanged:left.policyDigest!==right.policyDigest,
    unchanged:old.size-changes.filter(row=>row.kind!=='added').length,changes};
}
export function commissioningReport(run,plan) {
  verifyPlan(plan);need(run?.schema===RUN_SCHEMA&&run.planDigest===plan.digest,'EOAPI_COMMISSIONING_RUN_PLAN_CHANGED');
  return {schema:'scf-eoapi-commissioning-report/v1',run:clone(run),plan:clone(plan),
    summary:{cases:plan.cases.length,observed:run.results.length,passed:run.results.filter(row=>row.passed).length,
      failed:run.results.filter(row=>!row.passed).length,status:run.status},
    sourceScope:'Each case assesses its retained original HTTP response and selected principal. Pagination is reported on the observed response.'};
}
