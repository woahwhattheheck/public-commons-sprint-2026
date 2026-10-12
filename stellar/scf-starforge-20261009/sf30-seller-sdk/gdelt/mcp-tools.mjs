// MIT. Static tool contracts; the original application and buyer are lazy-owned.
import { MAX_RETAINED_CHUNK_BYTES } from '../../../../stellar-forge/mcp-merchant-operator/retained-file-contracts.mjs';
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const op={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$'};
const hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const format={type:'string',enum:['events-mentions','gkg']};
const workspace={workspace:alias},recorded={...workspace,id:op,expectedRevision:{type:'integer',minimum:1}};
const publication={...workspace,publicationId:hash};
const object={type:'object'},text={type:'string',maxLength:8000},read={readOnly:true,idempotent:true},change={idempotent:true};
export const gdeltFileSelection={kind:{type:'string',enum:['source','project','comparison','customer','dataset']},
  captureId:hash,before:hash,after:hash,publicationId:hash,intentId:op,id:op,
  file:{type:'string',enum:['dataset.csv','dataset.jsonl','review.html','manifest.json','semantics.json']}};
export function gdeltWorkspaceTools(tool){return[
  tool('merchant_gdelt_workspaces','List configured original GDELT article/event desks, source aliases and merchant profiles.',{},[],read),
  tool('merchant_gdelt_status','Read the original project identity, revision, pending action, buyer and merchant state.',workspace,['workspace'],read),
  tool('merchant_gdelt_records','Page captures, reviews, publications or operations at the original pinned revision. Follow nextOffset.',{
    ...workspace,kind:{type:'string',enum:['captures','reviews','publications','operations']},
    expectedRevision:{type:'integer',minimum:1},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}},
    ['workspace','kind','expectedRevision'],read),
  tool('merchant_gdelt_record','Read one complete original capture metadata, review, publication or operation at its current revision.',{
    ...workspace,kind:{type:'string',enum:['captures','reviews','publications','operations']},id:{type:'string',minLength:1,maxLength:96},
    expectedRevision:{type:'integer',minimum:1}},['workspace','kind','id','expectedRevision'],read),
  tool('merchant_gdelt_query','Read fields, native paginated rows, source metadata, comparison, publication or original dataset preview. Row views use captureIds, policy, offset and limit; follow original offsets.',{
    ...workspace,kind:{type:'string',enum:['fields','rows','source-summary','compare','publication','preview']},input:object},['workspace','kind'],read),
  tool('merchant_gdelt_discover','Read the current official update or recent index once; retain its full manifest in the original project and use returned discoveryId for acquisition.',{
    ...workspace,history:{type:'boolean'},format},['workspace'],change),
  tool('merchant_gdelt_discovery','Recover the existing full manifest selection without a new provider request.',{
    ...workspace,id:hash,format},['workspace','id'],read),
  tool('merchant_gdelt_capture','Acquire the selected Events/Mentions pair or complete GKG article ZIP under the same operation, revision and retained discovery. Retry the same ID after interruption.',{
    ...recorded,batch:{type:'string',pattern:'^[0-9]{14}$'},discoveryId:hash,format},['workspace','id','expectedRevision','batch','discoveryId'],change),
  tool('merchant_gdelt_input','Inspect one complete host-pinned capture or project file before import.',{...workspace,input:alias},['workspace','input'],read),
  tool('merchant_gdelt_import','Import the exact configured capture under its original operation, or receive a complete project in the original workspace owner.',{
    ...recorded,input:alias,expectedSha256:hash},['workspace','id','expectedRevision','input','expectedSha256'],change),
  tool('merchant_gdelt_review','Save the full reviewed customer projection with exact source fields, coverage, nullable values and decimal/code text. Keep all original capture IDs.',{
    ...recorded,captureIds:{type:'array',items:hash,minItems:1,maxItems:32,uniqueItems:true},policy:object,
    note:text,name:{type:'string',minLength:1,maxLength:128}},['workspace','id','expectedRevision','captureIds','policy','name'],change),
  tool('merchant_gdelt_select','Select an original retained capture; does not acquire a new update.',{
    ...recorded,captureId:hash},['workspace','id','expectedRevision','captureId'],change),
  tool('merchant_gdelt_abandon','Record explicit abandonment of the original unfinished source mutation with an operator note.',{
    ...recorded,pendingId:op,note:text},['workspace','id','expectedRevision','pendingId','note'],change),
  tool('merchant_gdelt_publish','Publish a complete saved review using one host-configured public merchant/payment profile.',{
    ...recorded,reviewId:hash,profile:alias},['workspace','id','expectedRevision','reviewId','profile'],change),
  tool('merchant_gdelt_merchant','Start or stop the original selected merchant edition in the same application owner.',{
    ...publication,action:{type:'string',enum:['start','stop']}},['workspace','publicationId','action'],change),
  tool('merchant_gdelt_purchase','Prepare, execute or recover the same original paid request. Preserve the previous page snapshot/cursor for continuation; file names must be advertised by the publication.',{
    ...publication,action:{type:'string',enum:['prepare','buy','recover']},intentId:op,
    query:{type:'string',maxLength:8192},kind:{type:'string',enum:['rows','sources']},
    file:{type:'string',maxLength:128},previous:object,acceptIndex:{type:'integer',minimum:0}},
    ['workspace','publicationId','action','intentId'],change),
  tool('merchant_gdelt_dataset','Carry the original full paginated Dataset through prepare/create/run/inspect/recover/accounting/finalize/deliver/source receive/offline project reopen. Prepare requires explicit page and atomic-unit spending limits; every continuation retains the same ID.',{
    ...publication,id:op,action:{type:'string',enum:['prepare','create','run','inspect','recover','accounting','finalize','deliver','receive','reopen','open']},
    kind:{type:'string',enum:['rows','sources']},query:{type:'string',maxLength:8192},maxPages:{type:'integer',minimum:1,maximum:4096},
    maxRows:{type:'integer',minimum:1,maximum:1000000},maxTotalAtomic:{type:'string',pattern:'^[1-9][0-9]{0,38}$'},
    acceptIndex:{type:'integer',minimum:0}},['workspace','publicationId','id','action'],change),
  tool('merchant_gdelt_cancel','Request cancellation of the exact currently running application action. The original record remains available for recovery.',{
    ...workspace,id:op},['workspace','id'],change),
  tool('merchant_gdelt_file_read','Read a complete original capture, project, comparison, purchase or delivered output through verified retained chunks. Repeat full expectedSha256 and offset after process restart; readId belongs to its original selection.',{
    ...workspace,...gdeltFileSelection,readId:{type:'string',minLength:1,maxLength:128},
    expectedSha256:hash,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES}},
    ['workspace','kind'],read),
  tool('merchant_gdelt_file_release','Release one existing retained read without changing its original file.',{
    ...workspace,readId:{type:'string',minLength:1,maxLength:128}},['workspace','readId'],change)
];}
