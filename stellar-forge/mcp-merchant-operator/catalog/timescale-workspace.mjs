// MIT. Metadata for the original Timescale project, publisher and receiving workflow.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';
export const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const HASH = /^[a-f0-9]{64}$/;
const alias = { type:'string', pattern:'^[a-z0-9][a-z0-9_-]{0,63}$' };
const uuid = { type:'string', pattern:UUID.source }, hash = { type:'string', pattern:HASH.source };
const integer = { type:'integer', minimum:0 }, text = { type:'string', minLength:1, maxLength:2000 };
const title = { type:'string', minLength:1, maxLength:128 }, identifier = { type:'string', minLength:1, maxLength:63 };
const object = (properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const read = { readOnly:true, idempotent:true }, retained = { idempotent:true, openWorld:true };
const scope = {workspace:alias,workspaceId:uuid};
const page = {offset:integer,limit:{type:'integer',minimum:1,maximum:100}};
const request = {requestId:uuid,expectedVersion:integer};
const window = {editionId:uuid,editionDigest:hash,aggregateKey:hash,timeColumn:identifier,
  timeType:{enum:['timestamptz','timestamp','date','smallint','integer','bigint','timestamp with time zone','timestamp without time zone']},
  start:{type:'string',minLength:1,maxLength:128},end:{type:'string',minLength:1,maxLength:128},
  timezone:{type:'string',minLength:1,maxLength:128},title,owner:title,note:text};
const windowRequired=['editionId','editionDigest','aggregateKey','timeColumn','timeType','start','end','title','owner','note'];
const prepared = {planId:uuid,planDigest:hash,timeoutMs:{type:'integer',minimum:1,maximum:3600000}};
const chunk = {expectedSha256:hash,offset:integer,limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES},readId:uuid};
const workText={type:'string',minLength:1,maxLength:8000};
const workState={enum:['OPEN','IN_PROGRESS','DEFERRED']};
const itemPin={workItemId:uuid,itemRevision:{type:'integer',minimum:1},itemDigest:hash};
const source=object({reviewId:uuid,comparisonDigest:hash,changeKey:hash,digest:hash},
  ['reviewId','comparisonDigest','changeKey','digest']);
const workFields=object({title,owner:title,dueDate:{type:'string',pattern:'^(?:|[0-9]{4}-[0-9]{2}-[0-9]{2})$'},
  priority:{enum:['NORMAL','HIGH','URGENT']},intent:workText,acceptance:workText,status:workState},
  ['title','owner','priority','intent','acceptance','status']);
const resolution=object({editionId:uuid,editionDigest:hash,comparisonDigest:hash,
  mode:{enum:['CURRENT_STATE_REVIEW','COMPLETE_AGGREGATE_VERIFICATION']},verificationOperationId:uuid,
  verificationOperationDigest:hash,outcome:{enum:['REMEDIATED','ACCEPTED_CURRENT_STATE','SUPERSEDED']},statement:workText},
  ['editionId','editionDigest','comparisonDigest','mode','outcome','statement']);
export function timescaleWorkspaceTools(tool) {
  const selected=(name,description,properties,required=[],annotations=read)=>
    tool('merchant_timescale_'+name,description,{...scope,...properties},['workspace','workspaceId',...required],annotations);
  return [
    tool('merchant_timescale_status','List declared Timescale projects without opening them, or page the original open project history. One publisher, scheduler and native operation journal are shared with the browser.',
      {...scope,...page},[],read),
    tool('merchant_timescale_open','Open or reuse the configured original Timescale project and its merchant publisher. Returns persistent workspaceId and current adapter/publisher instance IDs; enabled original schedules resume.',
      {workspace:alias},['workspace'],retained),
    selected('close','Drain the borrowed browser and file reads for these exact process instances. The original MerchantPublisher retains the Timescale project and scheduler until merchant_publisher_close closes that owner.',
      {instanceId:uuid,publisherInstanceId:uuid},['instanceId','publisherInstanceId'],{destructive:true}),
    selected('capture','Start or explicitly continue the original metadata capture. It retains one complete source edition under this request UUID. Inspect the same operation after a lost response; no automatic replay.',
      {...request,title,note:text,timeoutMs:prepared.timeoutMs},['requestId','expectedVersion','title','note'],retained),
    selected('edition','Inspect an immutable source edition. Page its aggregate catalog, or select a native table and page exact string/null rows. The complete original JSON remains available through merchant_timescale_file.',
      {editionId:uuid,table:{type:'string',minLength:1,maxLength:80},...page},['editionId']),
    selected('compare','Compare two complete editions of the same original database. Returns a digest of the complete comparison and a page of changes; the review must account for every change, including pages not displayed.',
      {beforeId:uuid,afterId:uuid,...page},['beforeId','afterId']),
    selected('review','Retain an independent decision for every change in the exact complete comparison. Original reviewer, owner, reason and ACCEPT/REMEDIATE/DEFER meanings are preserved.',
      {...request,beforeId:uuid,afterId:uuid,comparisonDigest:hash,reviewer:title,note:text,
        decisions:{type:'array',items:object({changeKey:hash,decision:{enum:['ACCEPT','REMEDIATE','DEFER']},owner:title,note:text},['changeKey','decision','owner','note'])}},
      ['requestId','expectedVersion','beforeId','afterId','comparisonDigest','reviewer','note','decisions'],retained),
    selected('refresh','Prepare the original exact-window refresh plan, or run a previously inspected plan by its full digest. The native maintenance connection, original aggregate identity and saved batch options control the call. OUTCOME_UNKNOWN never replays automatically.',
      {action:{enum:['prepare','run']},...request,plan:object({...window,force:{type:'boolean'},bucketsPerBatch:{type:'integer',minimum:0,maximum:2147483647},
        maxBatches:{type:'integer',minimum:0,maximum:2147483647},newestFirst:{type:'boolean'}},windowRequired),...prepared},
      ['action','requestId','expectedVersion'],retained),
    selected('verify','Verify a saved refresh or projection plan against the original database in one read-only repeatable-read snapshot. Exact native row counts and EXCEPT ALL comparisons are retained, rather than sampled.',
      {...request,...prepared},['requestId','expectedVersion','planId','planDigest'],retained),
    selected('job','Prepare a job change from the exact source edition and original native job fields, or apply its retained plan. It uses the host maintenance role and the original job API; no arbitrary SQL is accepted.',
      {action:{enum:['prepare','apply']},...request,editionId:uuid,editionDigest:hash,jobId:{type:'string',pattern:'^[0-9]+$'},
        changes:object({config:{type:'string',minLength:1,maxLength:1048576},scheduled:{type:'boolean'},schedule_interval:text,max_runtime:text,max_retries:{type:'integer',minimum:-1,maximum:2147483647},
          retry_period:text,next_start:text,initial_start:text,timezone:text,fixed_schedule:{type:'boolean'}}),title,owner:title,note:text,planId:uuid,planDigest:hash},
      ['action','requestId','expectedVersion'],retained),
    selected('publication','Select exact aggregate columns and time window into the original Postgres publisher, or start its saved projection extraction. Use merchant_publisher_* afterward for original candidate review, publication and buyer preparation.',
      {action:{enum:['select','extract']},...request,selection:object({...window,columns:{type:'array',minItems:1,maxItems:64,uniqueItems:true,items:identifier}},[...windowRequired,'columns']),
        extraction:object({maxRows:{type:'integer',minimum:1},maxBytes:{type:'integer',minimum:1},maxRowBytes:{type:'integer',minimum:1},timeoutMs:prepared.timeoutMs}),
        planId:uuid,planDigest:hash},['action','requestId','expectedVersion'],retained),
    selected('operation','Inspect the retained original operation, or explicitly cancel its current native work. Inspect returns the same accepted request/result identity, including any unknown dispatch outcome.',
      {action:{enum:['inspect','cancel']},requestId:uuid},['action','requestId'],retained),
    selected('plan','Read an exact retained refresh, job or publication plan and its complete digest. Select one of those saved plans for native execution.',
      {planId:uuid},['planId']),
    selected('record','Read a page from an original operation’s retained native result or pre-dispatch capture. Select a named native table; complete bytes are available through the original file reader.',
      {requestId:uuid,record:{enum:['result','before']},table:{type:'string',minLength:1,maxLength:80},...page},['requestId','record']),
    selected('file','Read exact immutable source-edition or native-result bytes with SHA256, readId and offset. All data is returned through the existing descriptor reader; clients cannot select a path.',
      {kind:{enum:['edition','result','before']},id:uuid,...chunk},['kind','id','expectedSha256']),
    selected('file_release','Release this workspace’s original retained file descriptor.',
      {readId:uuid},['readId'],{idempotent:true}),
    selected('browser','Open or close the original Timescale browser over the SAME publisher, model and scheduler. Closing the browser closes only its listener.',
      {action:{enum:['open','close']},port:{type:'integer',minimum:0,maximum:65535}},['action'],retained),
    selected('export','Export the complete original workspace, all retained histories/editions/results and referenced dataset generations to the host-owned export root. It uses the original native export operation and stable request UUID.',
      {...request},['requestId','expectedVersion'],retained),
    selected('export_manifest','Inspect the immutable complete native package as a retained file download. The manifest includes native manifest.json and EVERY original declared file; this call creates no new database export.',
      {exportId:uuid},['exportId']),
    selected('export_file','Read a manifest or original nested package file through its immutable descriptor. Both the complete download manifest digest and exact file digest must match.',
      {exportId:uuid,file:{type:'string',minLength:1,maxLength:4096},expectedManifestSha256:hash,...chunk},
      ['exportId','file','expectedManifestSha256','expectedSha256']),
    selected('export_file_release','Release an original retained package descriptor for this export.',
      {exportId:uuid,readId:uuid},['exportId','readId'],{idempotent:true}),
    selected('remediation_list','Page the original assigned work, ownership, due dates and current states. Every item remains in the existing Timescale journal.',
      {...page,status:{enum:['OPEN','IN_PROGRESS','DEFERRED','RESOLVED']},owner:title,q:text}),
    selected('remediation_sources','Page original Remediate/Defer review choices with exact source/comparison references and changed field names. Complete before/after values remain in the original edition files and retained report JSON.',
      {...page}),
    selected('remediation_item','Inspect the current original item and digest; page every plan binding, observed outcome or revision using that exact item revision/digest. Complete source values and operation bodies remain in the full retained report.',
      {...itemPin,section:{enum:['summary','plans','observations','history']},...page},['workItemId']),
    selected('remediation_context','Read the original applicable plans, bound native operation identities and editions. Select a later edition for its exact comparison digest and paged change identities; catalog stability alone asserts no aggregate coverage.',
      {...itemPin,editionId:uuid,...page,changeOffset:integer,changeLimit:page.limit},['workItemId','itemRevision','itemDigest']),
    selected('remediation_command','Apply one original source-bound work command through workspace.exclusive. Preserve requestId and exact input after response loss; actor, reason, current item revision and original source/plan/outcome digests control changes.',
      {...request,action:{enum:['create','edit','rebase','bind-plan','observe','resolve','reopen']},actor:title,note:workText,
        workItemId:uuid,expectedRevision:{type:'integer',minimum:1},source,fields:workFields,planId:uuid,planDigest:hash,
        relevance:workText,operationId:uuid,operationDigest:hash,resolution,status:workState},
      ['requestId','expectedVersion','action','actor','note'],retained),
    selected('remediation_report','Retain the original complete JSON and printable HTML for the exact selected item revision through the same workspace journal. Stable request recovery returns the same bytes after owner restart; full project export includes these reports.',
      {...request,...itemPin},['requestId','expectedVersion','workItemId','itemRevision','itemDigest'],retained),
    selected('remediation_report_manifest','Inspect the completed original remediation report manifest without generating another report or reading the database source.',
      {exportId:uuid},['exportId']),
    selected('remediation_report_file','Read complete retained report JSON, HTML or manifest by exact original digest and byte offset, using the existing immutable descriptor reader.',
      {exportId:uuid,file:{enum:['Timescale_Remediation_Manifest.json','report.json','report.html']},expectedManifestSha256:hash,...chunk},
      ['exportId','file','expectedManifestSha256','expectedSha256']),
    selected('remediation_report_file_release','Release this original remediation report descriptor.',
      {exportId:uuid,readId:uuid},['exportId','readId'],{idempotent:true}),
  ];
}
