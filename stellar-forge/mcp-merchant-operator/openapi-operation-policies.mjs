// MIT. Reusable policies through the original SF61 store and worksheet context.
import { stageRouteWorksheet, routeWorksheetStageView, readRouteWorksheetValue, requireRouteWorksheetReconciled } from './openapi-route-worksheet.mjs';
import { parseOperationPolicyFile } from './openapi-operation-policy-file-format.mjs';
import { operationPolicyTools } from './catalog/openapi-operation-policies.mjs';
import { SF61_SHA, sf61Hash as hash, sf61Plain as plain, sf61Failure as fail, sf61Checked as checked } from './sf61-connection.mjs';
import { OPERATION_POLICY_SCHEMA, OPERATION_POLICY_BYTES, OPERATION_POLICY_APPLICATION_BYTES, normalizeOperationPolicy, operationPolicyText, operationPolicyCanonical } from '../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/operation-policy-model.mjs';
import { OPERATION_POLICY_APPLICATION_SCHEMA, operationPolicyRecordText, verifyOperationPolicyRecord, prepareOperationPolicyApplication } from '../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/operation-policy-record.mjs';
const tools = new Set(operationPolicyTools(name=>name));
export const isOperationPolicyTool = name=>tools.has(name);
export const OPERATION_POLICY_FILE_SCHEMA='stellar-forge.api-operation-policy-file.v1';
const ID=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const PACKAGE=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const ROOT='/api/operation-policies/';
const own=(value,key)=>Object.hasOwn(value,key);
function integer(value,min,max,label) {
 if(!Number.isSafeInteger(value)||value<min||value>max)throw fail('INVALID_PARAMS','Choose '+label+' from '+min+' to '+max+'.');
 return value;
}
function query(path,values) {
 const entries=Object.entries(values).filter(([,value])=>value!==undefined);
 return path+'?'+new URLSearchParams(entries.map(([key,value])=>[key,String(value)]));
}
function exactPin(expected,actual,label) {
 if(expected!==undefined&&checked(expected,SF61_SHA,label)!==actual)
  throw fail('OPENAPI_OPERATION_POLICY_CHANGED','The original '+label+' differs. Reopen the selected complete source and edition.');
}
function selection(input) {
 return {id:checked(input.policyId,ID,'policy ID'),
  ...(input.policySha256===undefined?{}:{sha256:checked(input.policySha256,SF61_SHA,'policy edition SHA256')})};
}
async function document(client,input) {
 const value=await readRouteWorksheetValue(client,input,'policyDocument','policyFile');
 if(value===undefined)throw fail('INVALID_PARAMS','Supply one complete policyDocument or its host-declared packet file.');
 return normalizeOperationPolicy(value);
}
function policyView(value) {
 if(!plain(value)||!SF61_SHA.test(value.sha256??'')||!plain(value.policy))
  throw fail('OPENAPI_OPERATION_POLICY_REPLY_INVALID','The native policy library returned an incomplete edition.');
 const policy=normalizeOperationPolicy(value.policy);
 if(hash(operationPolicyText(policy))!==value.sha256)
  throw fail('OPENAPI_OPERATION_POLICY_REPLY_INVALID','The retained policy bytes differ from their original edition identity.');
 return {...value,policy};
}
function page(items,input) {
 if(!Array.isArray(items))throw fail('OPENAPI_OPERATION_POLICY_REPLY_INVALID','The native review omitted its complete operation changes.');
 const offset=integer(input.offset??0,0,items.length,'change offset'),limit=integer(input.limit??100,1,100,'change page size');
 const selected=items.slice(offset,offset+limit),next=offset+selected.length;
 return {items:selected,total:items.length,offset,limit,nextOffset:next<items.length?next:null};
}
async function application(options) {
 let input=options.input,portable;
 if(input.applicationDocument!==undefined||input.applicationFile!==undefined) {
  portable=await readRouteWorksheetValue(options.client,input,'applicationDocument','applicationFile');
  if(!plain(portable)||portable.schema!==OPERATION_POLICY_APPLICATION_SCHEMA)
   throw fail('INVALID_PARAMS','Receive a complete original operating-policy application record.');
  const mixed=['baseName','plan','planFile','worksheet','worksheetFile','baseWorksheet','baseWorksheetFile','choices','actions','policy','policyDocument','policyFile','targets','targetsFile','overrides','overridesFile','operationPlans','operationPlansFile','capturedSource'];
  if(mixed.some(key=>input[key]!==undefined))
   throw fail('INVALID_PARAMS','Keep the complete retained application input intact; select only its original source and destination controls.');
  exactPin(input.expectedSourceSha256,portable.sourceSha256,'application source SHA256');
  input={...input,expectedSourceSha256:portable.sourceSha256,plan:portable.basePlan,worksheet:portable.worksheet,
   policyDocument:portable.policy,targets:portable.targets,overrides:portable.overrides,operationPlans:portable.operationPlans,
   ...(portable.capturedSource===undefined?{}:{capturedSource:portable.capturedSource})};
 }
 const value=await stageRouteWorksheet({...options,input});requireRouteWorksheetReconciled(value);
 // A received record carries its original capture choice, including absence.
 if(portable)value.capturedSource=portable.capturedSource;
 const reference=input.policy;
 const policyDocument=input.policyDocument===undefined&&input.policyFile===undefined?undefined:await document(value.client,input);
 if((reference===undefined)===(policyDocument===undefined))
  throw fail('INVALID_PARAMS','Select one exact saved policy reference or one complete portable policy document.');
 if(reference!==undefined&&(!plain(reference)||Object.keys(reference).some(key=>!['id','sha256'].includes(key))))
  throw fail('INVALID_PARAMS','A saved policy reference contains only id and sha256.');
 const targets=await readRouteWorksheetValue(value.client,input,'targets','targetsFile');
 if(!Array.isArray(targets))throw fail('INVALID_PARAMS','Choose explicit target routes or a declared complete target file.');
 const overrides=await readRouteWorksheetValue(value.client,input,'overrides','overridesFile')??[];
 const operationPlans=await readRouteWorksheetValue(value.client,input,'operationPlans','operationPlansFile','plan')??[];
 const body={specText:value.source.text,plan:value.plan,worksheet:value.sheet,targets,overrides,operationPlans,
  ...(reference===undefined?{policyDocument}:{policy:{id:checked(reference.id,ID,'policy ID'),sha256:checked(reference.sha256,SF61_SHA,'policy edition SHA256')}}),
  ...(value.capturedSource===undefined?{}:{capturedSource:value.capturedSource})};
 return {value,body,portable};
}
function applicationView(native,value,body) {
 if(!plain(native)||!plain(native.operationPolicy)||!plain(native.review)||!plain(native.preview))
  throw fail('OPENAPI_OPERATION_POLICY_REPLY_INVALID','The native workspace omitted its complete policy review.');
 const record=native.operationPolicy;
 if(body.policy&&(record.policy.id!==body.policy.id||record.policySha256!==body.policy.sha256))
  throw fail('OPENAPI_OPERATION_POLICY_REPLY_INVALID','The native review selected another immutable policy edition.');
 const submitted=prepareOperationPolicyApplication({
  specText:body.specText,plan:body.plan,worksheet:body.worksheet,policy:body.policyDocument??record.policy,
  targets:body.targets,overrides:body.overrides,operationPlans:body.operationPlans,
  ...(body.capturedSource===undefined?{}:{capturedSource:body.capturedSource}),inspection:value.inspection
 });
 const {schema,policySha256,review,...retainedInput}=record;
 if(operationPolicyCanonical(submitted.input)!==operationPolicyCanonical(retainedInput)||
  native.plan!==undefined&&operationPolicyCanonical(native.plan)!==operationPolicyCanonical(submitted.plan))
  throw fail('OPENAPI_OPERATION_POLICY_REPLY_INVALID','The native review differs from the complete submitted source, worksheet, targets, settings or capture.');
 const plan=submitted.plan;
 verifyOperationPolicyRecord(record,{specText:value.source.text,plan,inspection:value.inspection,preview:native.preview});
 if(operationPolicyCanonical(native.review)!==operationPolicyCanonical(record.review)||
  record.review.sourceSha256!==value.source.sha256||record.review.basePlanSha256!==value.planSha256||
  record.review.worksheetSha256!==value.file.metadata.sha256)
  throw fail('OPENAPI_OPERATION_POLICY_REPLY_INVALID','The native review names a different source, base plan or complete worksheet.');
 const bytes=Buffer.from(operationPolicyRecordText(record));
 return {record,plan,bytes,file:fileInfo('application',bytes,record.policy,{policySha256:record.policySha256,
  sourceSha256:record.sourceSha256,reviewSha256:record.review.sha256})};
}
function fileInfo(kind,bytes,policy,extra={}) {
 return {schema:OPERATION_POLICY_FILE_SCHEMA,kind,
  documentSchema:kind==='policy'?OPERATION_POLICY_SCHEMA:OPERATION_POLICY_APPLICATION_SCHEMA,
  filename:kind==='policy'?'api-operation-policy.json':'api-operation-policy-application.json',
  bytes:bytes.length,sha256:hash(bytes),policyId:policy.id,...extra};
}
function chunk(workspace,bytes,file,input) {
 exactPin(input.expectedFileSha256,file.sha256,'complete policy file SHA256');
 exactPin(input.expectedReviewSha256,file.reviewSha256,'policy review SHA256');
 const offset=integer(input.offset??0,0,bytes.length,'file byte offset');
 const amount=integer(input.chunkBytes??196608,1,196608,'chunk size'),part=bytes.subarray(offset,offset+amount),next=offset+part.length;
 return {workspace,file,offset,bytes:part.length,encoding:'base64',data:part.toString('base64'),
  nextOffset:next<bytes.length?next:null,complete:next===bytes.length};
}
async function retainedApplication(client,input) {
 const name=checked(input.name,PACKAGE,'original package name'),saved=await client.json(query('/api/load',{name}));
 if(!plain(saved.operationPolicy)||typeof saved.specText!=='string'||!plain(saved.plan))
  throw fail('OPENAPI_OPERATION_POLICY_ABSENT','The selected original package has no retained operating-policy application.');
 const record=saved.operationPolicy,bytes=Buffer.from(operationPolicyRecordText(record));
 if(saved.manifest?.files?.['operation-policy.json']!==hash(bytes))
  throw fail('OPENAPI_OPERATION_POLICY_REPLY_INVALID','The original package policy member differs from its manifest.');
 exactPin(input.expectedReviewSha256,record.review?.sha256,'policy review SHA256');
 return {bytes,file:fileInfo('application',bytes,record.policy,{policySha256:record.policySha256,
  sourceSha256:record.sourceSha256,reviewSha256:record.review.sha256,packageName:name})};
}
export async function executeOperationPolicies(options) {
 const {name,workspace,client}=options,input=structuredClone(options.input),scoped={...options,input};
 try {
  if(name==='merchant_openapi_operation_policies') {
   const offset=integer(input.offset??0,0,Number.MAX_SAFE_INTEGER,'library offset'),limit=integer(input.limit??50,1,100,'library page size');
   return {workspace,native:await client.json(query(ROOT+'list',{offset,limit}))};
  }
  if(name==='merchant_openapi_operation_policy_load') {
   const native=await client.json(query(ROOT+'load',{...selection(input),
    historyOffset:integer(input.historyOffset??0,0,Number.MAX_SAFE_INTEGER,'history offset'),
    historyLimit:integer(input.historyLimit??25,1,100,'history page size')}));
   return {workspace,native:policyView(native)};
  }
  if(name==='merchant_openapi_operation_policy_save') {
   if(!own(input,'expectedHeadSha256')||input.expectedHeadSha256!==null&&!SF61_SHA.test(input.expectedHeadSha256??''))
    throw fail('INVALID_PARAMS','Provide expectedHeadSha256:null for creation or the exact current head for an edit.');
   const policy=await document(client,input),body={policy,expectedHeadSha256:input.expectedHeadSha256};
   return {workspace,native:policyView(await client.json(ROOT+'save',body))};
  }
  if(name==='merchant_openapi_operation_policy_file'&&input.kind==='policy') {
   if(Object.keys(input).some(key=>!['kind','policyId','policySha256','expectedFileSha256','offset','chunkBytes'].includes(key)))
    throw fail('INVALID_PARAMS','Select only the original policy ID, edition and byte-transfer controls.');
   const exported=policyView(await client.json(query(ROOT+'export',selection(input))));
   const text=exported.file?.text;
   if(typeof text!=='string'||Buffer.byteLength(text)>OPERATION_POLICY_BYTES||text!==operationPolicyText(exported.policy)||
    exported.file.bytes!==Buffer.byteLength(text)||exported.file.sha256!==hash(text))
    throw fail('OPENAPI_OPERATION_POLICY_REPLY_INVALID','Read the exact complete exported policy bytes from the native library.');
   const bytes=Buffer.from(text),file=fileInfo('policy',bytes,exported.policy,{policySha256:exported.sha256});
   return chunk(workspace,bytes,file,input);
  }
  if(name==='merchant_openapi_operation_policy_file'&&input.kind==='application'&&input.name!==undefined) {
   if(['applicationDocument','applicationFile','baseName','specText','specFile','plan','planFile','policy','policyDocument','policyFile','targets','targetsFile','overrides','overridesFile','worksheet','worksheetFile','baseWorksheet','baseWorksheetFile','choices','actions','operationPlans','operationPlansFile','capturedSource','expectedSourceSha256','expectedPlanSha256','policyId','policySha256'].some(key=>input[key]!==undefined))
    throw fail('INVALID_PARAMS','Select the saved package alone to export its retained policy application.');
   const selected=await retainedApplication(client,input);return chunk(workspace,selected.bytes,selected.file,input);
  }
  if(name==='merchant_openapi_operation_policy_file'&&input.kind!=='application')
   throw fail('INVALID_PARAMS','Select policy or application file bytes.');
  const prepared=await application(scoped),{value,body}=prepared;
  const writing=name==='merchant_openapi_operation_policy_package';
  if(writing&&prepared.portable) {
   // Verify complete portable identity before publishing, while allowing the
   // original package endpoint to recover without mutable host authorization.
   const portable=parseOperationPolicyFile(Buffer.from(operationPolicyRecordText(prepared.portable)),'application');
   if(checked(input.expectedReviewSha256,SF61_SHA,'review SHA256')!==portable.reviewSha256)
    throw fail('OPENAPI_OPERATION_POLICY_CHANGED','Use the complete received application and its exact original review SHA256.');
  }
  if(writing){body.name=checked(input.name,PACKAGE,'new package name');body.expectedReviewSha256=checked(input.expectedReviewSha256,SF61_SHA,'review SHA256');}
  const native=await client.json(ROOT+(writing?'package':'review'),body),checkedView=applicationView(native,value,body);
  if(prepared.portable)verifyOperationPolicyRecord(prepared.portable,{specText:value.source.text,plan:checkedView.plan,inspection:value.inspection,preview:native.preview});
  exactPin(input.expectedReviewSha256,native.review.sha256,'policy review SHA256');
  if(name==='merchant_openapi_operation_policy_file')return chunk(workspace,checkedView.bytes,checkedView.file,input);
  const common={workspace,...routeWorksheetStageView(value),review:native.review,application:checkedView.file};
  if(writing)return {...common,native:{state:native.state,name:native.name,preview:native.preview},
   package:{name:native.name,operationPolicySha256:checkedView.file.sha256}};
  if(name==='merchant_openapi_operation_policy_review')
   return {...common,plan:checkedView.plan,preview:native.preview,changes:page(native.changes,input)};
  throw fail('TOOL_NOT_FOUND','Unknown original operating-policy operation.');
 } catch(error) {
  if(!error.code&&!error.status)error.code='OPENAPI_OPERATION_POLICY_INVALID';
  throw error;
 }
}
