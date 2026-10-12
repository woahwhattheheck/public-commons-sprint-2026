// MIT. Complete original commissioning operations over the Timescale owner.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';
const uuid={type:'string',pattern:'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$'},hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const title={type:'string',minLength:1,maxLength:128},text={type:'string',minLength:1,maxLength:8000},name={type:'string',minLength:1,maxLength:256};
const scope={workspace:{type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'},workspaceId:uuid};
const page={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}};
const request={requestId:uuid,expectedVersion:{type:'integer',minimum:0}},pin={commissioningId:uuid,revision:{type:'integer',minimum:1},digest:hash};
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const originalFile=object({filename:{type:'string',minLength:1,maxLength:240},content:{type:'string',maxLength:6291456},tableName:{type:['string','null'],maxLength:256}},['filename','content']);
const nativeWindow=object({editionId:uuid,editionDigest:hash,aggregateKey:hash,
  columns:{type:'array',minItems:1,maxItems:64,uniqueItems:true,items:{type:'string',minLength:1,maxLength:63}},
  timeColumn:{type:'string',minLength:1,maxLength:63},
  timeType:{enum:['timestamptz','timestamp','date','smallint','integer','bigint','timestamp with time zone','timestamp without time zone']},
  start:{type:'string',minLength:1,maxLength:128},end:{type:'string',minLength:1,maxLength:128},timezone:{type:'string',maxLength:128},
  title,owner:title,note:{type:'string',minLength:1,maxLength:2000}},
  ['editionId','editionDigest','aggregateKey','columns','timeColumn','timeType','start','end','title','owner','note']);
const omitted={type:'array',items:object({column:name,reason:{type:'string',minLength:1,maxLength:2000}},['column','reason'])};
const mapping=object({columns:{type:'array',minItems:1,maxItems:512,items:object({name,expected:name,observed:name,key:{type:'boolean'}},['name','expected','observed'])},
  ignoredExpected:omitted,ignoredObserved:omitted},['columns','ignoredExpected','ignoredObserved']);
const decision={enum:['NOT_RUN','PASS','FAIL','DEFERRED','NOT_APPLICABLE']};
const read={readOnly:true,idempotent:true},write={idempotent:true,openWorld:true};
const source={commissioningId:uuid,kind:{enum:['intake','source','comparison']},sourceId:uuid,comparisonId:uuid};
const chunk={expectedSha256:hash,offset:page.offset,limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES},readId:uuid};
export function timescaleCommissioningTools(tool){
  const selected=(name,description,properties={},required=[],annotations=read)=>
    tool('merchant_timescale_commissioning_'+name,description,{...scope,...properties},['workspace','workspaceId',...required],annotations);
  return[
    selected('list','Page complete commissioning projects retained in the original Timescale operation journal.',{...page,q:text,status:{enum:['OPEN','HANDED_OVER']}}),
    selected('item','Inspect a project summary or page every source-contract field, source, comparison, native observation, acceptance decision and revision. Pin revision and digest when paging.',{
      ...pin,...page,section:{enum:['summary','contract','sources','comparisons','observations','acceptance','history']}},['commissioningId']),
    selected('context','Page the original native editions, saved plans and operation outcomes. Operation digests refer to the complete original operation and can be recorded as observations.',{
      ...pin,...page,kind:{type:'string',pattern:'^[a-z][a-z0-9-]{0,79}$'}},['commissioningId','revision','digest']),
    selected('source','Inspect the complete original intake/source/comparison file identity and page exact source string/null rows. Retrieve every original byte through commissioning_file.',{
      ...source,...page},['commissioningId','kind']),
    selected('comparison','Page the complete retained multiset comparison. All original rows, duplicate counts, exact strings and NULLs participate; named keys group differences.',{
      commissioningId:uuid,comparisonId:uuid,...page},['commissioningId','comparisonId']),
    selected('command','Apply a complete commissioning command through the original workspace. Full input files are retained once; the original request binds their complete digest and byte count. Source changes retain earlier decisions and start a new contract revision.',{
      ...request,action:{enum:['create','edit','bind-source','import-table','compare','observe','decide','complete','reopen']},
      actor:title,note:text,commissioningId:uuid,expectedRevision:{type:'integer',minimum:1},intake:originalFile,title,owner:title,
      contract:{type:'object',minProperties:1,maxProperties:256,additionalProperties:object({value:{},disposition:{enum:['PENDING','PROVIDED','NOT_APPLICABLE']},reason:{type:'string',maxLength:4000}},['value','disposition','reason'])},
      selection:nativeWindow,source:originalFile,role:{enum:['BASELINE','OBSERVED']},expectedSourceId:uuid,observedSourceId:uuid,mapping,
      operationId:uuid,operationDigest:hash,relevance:text,criterionId:{type:'string',minLength:1,maxLength:128},decision,
      assessment:text,references:{type:'array',maxItems:64,items:object({kind:{enum:['source','comparison','observation']},id:uuid},['kind','id'])},
      disposition:{enum:['ACCEPTED','WITH_OPEN_ITEMS']},statement:text,followUpOwner:{type:'string',maxLength:128}},
      ['requestId','expectedVersion','action','actor','note'],write),
    selected('reports','Page every frozen report for the original project, with its exact revision and complete file identities.',{commissioningId:uuid,...page},['commissioningId']),
    selected('report','Freeze complete commissioning JSON and printable HTML for the selected project revision in the existing journal. JSON includes original source text, every retained comparison/outcome and all original revisions.',{
      ...request,commissioningId:uuid,expectedRevision:{type:'integer',minimum:1},expectedDigest:hash},
      ['requestId','expectedVersion','commissioningId','expectedRevision','expectedDigest'],write),
    selected('file','Read exact original source/intake/comparison bytes using the existing immutable descriptor reader, complete file hash and byte offset.',{
      ...source,...chunk},['commissioningId','kind','expectedSha256']),
    selected('file_release','Release the original commissioning source read.',{readId:uuid},['readId'],{idempotent:true}),
    selected('report_manifest','Inspect the complete original frozen report manifest. This does not generate another report.',{exportId:uuid},['exportId']),
    selected('report_file','Read every original JSON, HTML or manifest byte through its exact complete report manifest and file hashes.',{
      exportId:uuid,file:{enum:['Timescale_Commissioning_Manifest.json','report.json','report.html']},expectedManifestSha256:hash,...chunk},
      ['exportId','file','expectedManifestSha256','expectedSha256']),
    selected('report_file_release','Release this exact original report descriptor.',{exportId:uuid,readId:uuid},['exportId','readId'],{idempotent:true}),
  ];
}
