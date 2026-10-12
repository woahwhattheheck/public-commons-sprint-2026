// MIT. Original tool metadata; provider runtimes load only when selected.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';
import { openSearchDeploymentTools } from './opensearch-deployment.mjs';

const aliasSchema = { type:'string', pattern:'^[a-z0-9][a-z0-9_-]{0,63}$' };

const idSchema = { type:'string', pattern:'^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$' };

const caseSchema = { type:'string', pattern:'^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$' };

const revisionSchema = { type:'integer', minimum:1 };

const objectSchema = { type:'object', additionalProperties:true };

const limitSchema = { type:'integer', minimum:1, maximum:100 };

const offsetSchema = { type:'integer', minimum:0 };

const digestSchema = { type:'string', pattern:'^[0-9a-f]{64}$' };

function openSearchWorkspaceTools(tool) {
  const read = {readOnly:true,idempotent:true}, write = {idempotent:true};
  const fields = value => ({workspace:aliasSchema,...value});
  const saved = {id:idSchema,revision:revisionSchema};
  const run = {requestId:idSchema,draftId:idSchema,expectedRevision:revisionSchema};
  return [
    tool('merchant_opensearch_status','List host-configured OpenSearch aliases or inspect an already opened workspace, record counts and retained reads. Configuration and status never open a database or contact OpenSearch.',fields({}),[],read),
    tool('merchant_opensearch_open','Open or reopen the original saved OpenSearch workspace. Preserves its SQLite journal, revisions, native editions and prepared packages; resolves no provider connection.',fields({}),['workspace'],write),
    tool('merchant_opensearch_close','Finish accepted work and close this operator handle and retained file reads. Saved records remain in the original workspace.',fields({}),['workspace'],write),
    tool('merchant_opensearch_catalog','Page host-declared named query definitions and inspect the original payment plan template and relevance metric catalog. No provider call.',fields({offset:offsetSchema,limit:limitSchema}),['workspace'],read),
    tool('merchant_opensearch_list','Page all original saved drafts, query editions, packages, operations, relevance sets or relevance editions with an opaque keyset cursor. The operation journal is not limited to the UI recent feed.',fields({collection:{type:'string',enum:['drafts','editions','packages','operations','relevance-sets','relevance-editions']},cursor:{type:'string',maxLength:1024},limit:limitSchema}),['workspace','collection'],read),
    tool('merchant_opensearch_history','Page immutable revisions of one original draft or evaluation set, newest first.',fields({kind:{type:'string',enum:['draft','relevance-set']},id:idSchema,beforeRevision:revisionSchema,limit:limitSchema}),['workspace','kind','id'],read),
    tool('merchant_opensearch_draft','Read an original saved query/input/merchant-plan definition. An explicit revision reopens that immutable historical revision.',fields(saved),['workspace','id'],read),
    tool('merchant_opensearch_save','Save a complete named query draft in the original journal. Updates require expectedRevision; new drafts omit draftId and expectedRevision. Reuse requestId with the same complete input after a lost response.',fields({...run,title:{type:'string',minLength:1,maxLength:120},queryName:{type:'string',pattern:'^[A-Za-z_][A-Za-z0-9_]{0,63}$'},query:objectSchema,input:objectSchema,plan:objectSchema}),['workspace','requestId','title','queryName','query','input','plan'],write),
    tool('merchant_opensearch_validate','Validate the exact current draft or saved relevance revision through the original query, plan and metric validators without a native operation.',fields({kind:{type:'string',enum:['draft','relevance-set']},...saved}),['workspace','kind','id','revision'],read),
    tool('merchant_opensearch_inspect','Inspect actual native mapping/projection and server identity for this exact saved draft; retain the original request and result. Reuse requestId to recover the same operation.',fields(run),['workspace','requestId','draftId','expectedRevision'],{...write,openWorld:true}),
    tool('merchant_opensearch_capture','Capture the exact saved native query through the original PIT reader and retain an immutable result edition with original integer precision, cluster identity and scope. Reuse requestId after a lost response.',fields(run),['workspace','requestId','draftId','expectedRevision'],{...write,openWorld:true}),
    tool('merchant_opensearch_prepare','Prepare this exact draft as the original native merchant package, generated client and OpenAPI. Retains original package IDs and file hashes for deployment through the maintained deployment authority.',fields(run),['workspace','requestId','draftId','expectedRevision'],write),
    tool('merchant_opensearch_operation','Recover an original saved request and its current outcome without repeating a native call. Request definitions are optional; large original records are also available through retained file reads.',fields({requestId:idSchema,includeRequest:{type:'boolean'}}),['workspace','requestId'],read),
    tool('merchant_opensearch_edition','Read an immutable query or relevance edition summary, native source scope, scores and completion coverage.',fields({kind:{type:'string',enum:['query','relevance']},id:idSchema}),['workspace','kind','id'],read),
    tool('merchant_opensearch_hits','Page original query-edition hits, preserving [_index,_id], exactIntegerPaths and native total.relation. The retained set may be truncated.',fields({editionId:idSchema,offset:offsetSchema,limit:limitSchema}),['workspace','editionId'],read),
    tool('merchant_opensearch_compare','Compare retained query sets or relevance evaluations through the original comparison engine. Page one change category or variant; scope, metric denominators and comparability remain explicit.',fields({kind:{type:'string',enum:['query','relevance']},beforeId:idSchema,afterId:idSchema,category:{type:'string',enum:['added','removed','changed','rankingChanged']},variantId:caseSchema,offset:offsetSchema,limit:limitSchema}),['workspace','kind','beforeId','afterId'],read),
    tool('merchant_opensearch_package','Read an original prepared package manifest and exact file hashes for generated-client handoff and the maintained deployment service.',fields({packageId:idSchema}),['workspace','packageId'],read),
    tool('merchant_opensearch_relevance_set','Read an exact evaluation-set revision, with frozen query variants, native metric settings, case inputs and paged judgments. Use caseId to page one case’s original documents.',fields({...saved,caseId:caseSchema,offset:offsetSchema,limit:limitSchema}),['workspace','id'],read),
    tool('merchant_opensearch_relevance_save','Import or save a complete evaluation set with original variant declarations and judgment identities. Updates require expectedRevision. This is the original relevance journal and revision history.',fields({requestId:idSchema,setId:idSchema,expectedRevision:revisionSchema,set:objectSchema}),['workspace','requestId','set'],write),
    tool('merchant_opensearch_relevance_seed','Seed a judgment case from a retained actual query edition. Original IDs and capture provenance are retained; all new ratings are null until explicitly judged.',fields({editionId:idSchema,caseId:caseSchema,title:{type:'string',minLength:1,maxLength:120},limit:{type:'integer',minimum:1,maximum:1000}}),['workspace','editionId','caseId'],read),
    tool('merchant_opensearch_relevance_judge','Merge or replace one saved case’s judgments by exact [_index,_id], retaining original hit provenance and unchanged notes. Rating null means unjudged; zero is an explicit grade. Original revision CAS and request replay apply.',fields({requestId:idSchema,setId:idSchema,expectedRevision:revisionSchema,caseId:caseSchema,mode:{type:'string',enum:['merge','replace']},judgments:{type:'array',minItems:0,maxItems:5000,items:{type:'object',properties:{_index:{type:'string',minLength:1},_id:{type:'string',minLength:1},rating:{type:['integer','null'],minimum:0,maximum:2147483647},note:{type:'string',maxLength:2000}},required:['_index','_id','rating'],additionalProperties:false}}}),['workspace','requestId','setId','expectedRevision','caseId','judgments'],write),
    tool('merchant_opensearch_relevance_evaluate','Evaluate the exact saved relevance revision with the original native rank_eval adapter and strict same-PIT windows. Retain native aggregate denominators, failures, judgment coverage and original response bytes. Reuse requestId after a lost response.',fields({requestId:idSchema,setId:idSchema,expectedRevision:revisionSchema}),['workspace','requestId','setId','expectedRevision'],{...write,openWorld:true}),
    tool('merchant_opensearch_relevance_case','Page a retained native relevance case: original rated hit entries or strict-window hits, exact integer paths, failures and matched-window state. Does not search again.',fields({editionId:idSchema,variantId:caseSchema,caseId:caseSchema,view:{type:'string',enum:['native','strict']},offset:offsetSchema,limit:limitSchema}),['workspace','editionId','variantId','caseId'],read),
    tool('merchant_opensearch_relevance_promote','Promote one evaluated variant and case into the original merchant draft with exact query/input/plan and evaluation provenance. Continue with the original prepare tool.',fields({requestId:idSchema,editionId:idSchema,variantId:caseSchema,caseId:caseSchema,title:{type:'string',minLength:1,maxLength:120}}),['workspace','requestId','editionId','variantId','caseId'],write),
    tool('merchant_opensearch_read','Read exact original draft, operation, query/relevance result, customer report or package-file bytes through a retained SHA-256-pinned snapshot. Mutable definitions require explicit revision. Continue nextOffset with readId and expectedSha256; chunks are base64.',fields({kind:{type:'string',enum:['draft','operation','query-edition','query-result','query-csv','relevance-set','relevance-edition','relevance-native','relevance-report-json','relevance-report-html','relevance-csv','package-file']},id:idSchema,revision:revisionSchema,file:{type:'string',minLength:1,maxLength:512},readId:{type:'string',minLength:1,maxLength:160},expectedSha256:digestSchema,offset:offsetSchema,limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES}}),['workspace','kind','id'],read),
    ...openSearchDeploymentTools(tool),
    tool('merchant_opensearch_read_release','Release an unfinished original retained file read before its idle expiry.',fields({readId:{type:'string',minLength:1,maxLength:160}}),['workspace','readId'],write),
  ];
}

export { openSearchWorkspaceTools, aliasSchema, idSchema, revisionSchema, offsetSchema, limitSchema, objectSchema, caseSchema, digestSchema };
