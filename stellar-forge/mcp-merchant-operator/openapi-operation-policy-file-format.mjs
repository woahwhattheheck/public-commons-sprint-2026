// MIT. Complete original policy file identities shared by merchant receiving paths.
import {SF61_SHA,sf61Hash as hash,sf61Plain as plain,sf61Failure as fail} from './sf61-connection.mjs';
import {normalizeOperationPolicy,operationPolicyText,operationPolicyCanonical} from '../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/operation-policy-model.mjs';
import {routeSheetText} from '../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/route-sheet-model.mjs';
import {OPERATION_POLICY_APPLICATION_SCHEMA,OPERATION_POLICY_REVIEW_SCHEMA,operationPolicyRecordText} from '../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/operation-policy-record.mjs';
const decode=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
function reviewCore(review) {
 if(!plain(review)||review.schema!==OPERATION_POLICY_REVIEW_SCHEMA)
  throw fail('OPENAPI_OPERATION_POLICY_FILE_INVALID','The application omitted its original complete review.');
 const {sha256,...core}=review;
 if(!SF61_SHA.test(sha256??'')||hash(operationPolicyCanonical(core))!==sha256)
  throw fail('OPENAPI_OPERATION_POLICY_FILE_INVALID','The complete native review identity differs.');
 for(const field of ['sourceSha256','basePlanSha256','candidatePlanSha256','worksheetSha256','policySha256','inputSha256','nativePreviewSha256'])
  if(!SF61_SHA.test(review[field]??''))throw fail('OPENAPI_OPERATION_POLICY_FILE_INVALID','The original review omitted '+field+'.');
 if(review.capturedSourceSha256!==null&&!SF61_SHA.test(review.capturedSourceSha256??''))
  throw fail('OPENAPI_OPERATION_POLICY_FILE_INVALID','The original capture identity differs.');
 return review;
}
export function parseOperationPolicyFile(bytes,kind) {
 let value;try{value=JSON.parse(decode(bytes));}catch{throw fail('OPENAPI_OPERATION_POLICY_FILE_INVALID','Read complete original UTF-8 policy JSON bytes.');}
 if(kind==='policy') {
  const policy=normalizeOperationPolicy(value);
  if(!Buffer.from(operationPolicyText(policy)).equals(bytes))
   throw fail('OPENAPI_OPERATION_POLICY_FILE_INVALID','The portable policy is not its complete original normalized edition.');
  return {policy,policySha256:hash(bytes)};
 }
 if(kind!=='application'||!plain(value)||value.schema!==OPERATION_POLICY_APPLICATION_SCHEMA)
  throw fail('OPENAPI_OPERATION_POLICY_FILE_INVALID','Choose the original policy or application document.');
 const required=['schema','sourceSha256','basePlan','worksheet','policy','targets','overrides','operationPlans','policySha256','review'];
 if(required.some(key=>!Object.hasOwn(value,key))||Object.keys(value).some(key=>![...required,'capturedSource'].includes(key)))
  throw fail('OPENAPI_OPERATION_POLICY_FILE_INVALID','Keep the complete original application fields.');
 const policy=normalizeOperationPolicy(value.policy),review=reviewCore(value.review);
 const {schema,policySha256,review:ignored,...input}=value;
 if(!SF61_SHA.test(value.sourceSha256??'')||value.sourceSha256!==review.sourceSha256||
  hash(operationPolicyText(policy))!==policySha256||policySha256!==review.policySha256||
  hash(operationPolicyCanonical(value.basePlan))!==review.basePlanSha256||
  hash(routeSheetText(value.worksheet))!==review.worksheetSha256||
  hash(operationPolicyCanonical(input))!==review.inputSha256||
  (value.capturedSource===undefined?null:hash(operationPolicyCanonical(value.capturedSource)))!==review.capturedSourceSha256||
  !Buffer.from(operationPolicyRecordText(value)).equals(bytes))
  throw fail('OPENAPI_OPERATION_POLICY_FILE_INVALID','The full application differs from its retained source, policy or input identity.');
 return {record:value,policy,policySha256,reviewSha256:review.sha256,sourceSha256:value.sourceSha256};
}
