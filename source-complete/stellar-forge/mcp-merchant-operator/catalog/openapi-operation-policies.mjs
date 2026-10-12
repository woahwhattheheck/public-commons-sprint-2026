// MIT. Original policy-authoring metadata; the native provider remains lazy.
import { SF61_ALIAS, SF61_SHA } from '../sf61-connection-contracts.mjs';
import { routeWorksheetContextSchema } from './openapi-route-worksheet.mjs';
const alias = {type:'string',pattern:SF61_ALIAS.source};
const digest = {type:'string',pattern:SF61_SHA.source};
const policyId = {type:'string',pattern:'^[A-Za-z][A-Za-z0-9_-]{0,63}$'};
const packageName = {type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'};
const route = {type:'object',properties:{method:{type:'string',enum:['GET','HEAD','POST','PUT','PATCH','DELETE']},path:{type:'string',minLength:1,maxLength:4096}},required:['method','path'],additionalProperties:false};
const selection = {type:'object',properties:{id:policyId,sha256:digest},required:['id','sha256'],additionalProperties:false};
const paging = {offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}};
const authoring = {
 ...routeWorksheetContextSchema,applicationDocument:{type:'object'},applicationFile:alias,policy:selection,policyDocument:{type:'object'},policyFile:alias,
 targets:{type:'array',minItems:1,maxItems:64,items:route},targetsFile:alias,
 overrides:{type:'array',maxItems:64,items:{type:'object',properties:{...route.properties,set:{type:'object'},unset:{type:'array',items:{type:'string'},uniqueItems:true}},required:['method','path'],additionalProperties:false}},
 overridesFile:alias,operationPlans:{type:'array',maxItems:64,items:{type:'object'}},operationPlansFile:alias
};
const read={readOnly:true,idempotent:true};
export function operationPolicyTools(tool) {
 return [
  tool('merchant_openapi_operation_policies','List every saved original operating-policy head, with exact edition identity and explicit nextOffset. Continue each page in the same host-selected SF61 library.',{workspace:alias,...paging},['workspace'],read),
  tool('merchant_openapi_operation_policy_load','Load one exact saved policy edition and page its retained edition history. Omitting policySha256 selects the current head; review and receiving use the returned immutable SHA256.',{workspace:alias,policyId,policySha256:digest,historyOffset:{type:'integer',minimum:0},historyLimit:{type:'integer',minimum:1,maximum:100}},['workspace','policyId'],read),
  tool('merchant_openapi_operation_policy_save','Save or import one complete operator-authored policy using the original library compare-and-swap. expectedHeadSha256 is required: null creates a new ID; an exact current head edits it. A declared packet file carries large policies.',{workspace:alias,policyDocument:{type:'object'},policyFile:alias,expectedHeadSha256:{anyOf:[digest,{type:'null'}]}},['workspace','expectedHeadSha256'],{idempotent:true}),
  tool('merchant_openapi_operation_policy_review','Apply an explicitly selected policy edition to original worksheet targets and per-route overrides. Reuses full source inspection, selection/pricing reconciliation, native validation and retained HAR provenance. Returns the exact review, complete candidate plan/preview and paginated changes; the file tool delivers the complete application record.',{...authoring,...paging},['workspace'],read),
  tool('merchant_openapi_operation_policy_package','Publish the exact reviewed native candidate through the original immutable package writer. Reopening the same source, choices and review recovers a completed package. Continue its ordinary package export, receiving and SF82 release workflow.',{...authoring,name:packageName,expectedReviewSha256:digest},['workspace','name','expectedReviewSha256'],{idempotent:true}),
  tool('merchant_openapi_operation_policy_file','Read a complete portable policy or application as exact SHA-pinned base64 chunks. kind=policy selects policyId and optional historical policySha256. kind=application uses a complete reviewed worksheet request, or name selects its retained package record. Receiving uses the same original policy/library/package APIs.',{...authoring,kind:{type:'string',enum:['policy','application']},policyId,policySha256:digest,name:packageName,expectedReviewSha256:digest,expectedFileSha256:digest,offset:{type:'integer',minimum:0},chunkBytes:{type:'integer',minimum:1,maximum:196608}},['workspace','kind'],read)
 ];
}
