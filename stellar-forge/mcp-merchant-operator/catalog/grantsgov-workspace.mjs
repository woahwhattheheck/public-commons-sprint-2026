// MIT. Original tool metadata; provider runtimes load only when selected.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

const HASH=/^[a-f0-9]{64}$/;

const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;

const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};

const nativeId={type:'string',pattern:ID.source};

const hash={type:'string',pattern:HASH.source};

const shortText={type:'string',minLength:1,maxLength:240};

const string={type:'string'};

const strings={type:'array',maxItems:100,uniqueItems:true,items:{type:'string',maxLength:250}};

const expectedRevision={type:'integer',minimum:0};

const requestId=nativeId;

const page={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:250},expectedSnapshot:hash};

const read={readOnly:true,idempotent:true};

const fields=['status','owner','fit','eligibilityAssessment','partner','workshare','deliverables','acceptance','schedule','fee','nextAction','notes'];

const exportKinds=['workspace','edition','capture','merchant','comparison','workshare-md','workshare-html'];

const publisherExportKinds=['draft-csv','draft-review','buyer-config','session-manifest','session-csv','session-jsonl','session-review'];

const query={type:'object',additionalProperties:false,properties:{
  keyword:{type:'string',maxLength:1000},opportunityNumber:{type:'string',maxLength:250},
  statuses:{type:'array',minItems:1,maxItems:4,uniqueItems:true,items:{enum:['posted','forecasted','closed','archived']}},
  agencies:strings,eligibilities:strings,fundingCategories:strings,fundingInstruments:strings,
  aln:{type:'string',maxLength:250},pageSize:{type:'integer',minimum:1,maximum:100},
}};

function grantsWorkspaceTools(tool){
  const scoped=properties=>({workspace:alias,...properties});
  const inEdition=properties=>scoped({editionId:nativeId,...properties});
  const queryText={anyOf:[{type:'object'}, {type:'string',maxLength:16384}]};
  const chunk={exportId:hash,file:{type:'string',minLength:1,maxLength:180},
    expectedManifestSha256:hash,expectedSha256:hash,readId:{type:'string',pattern:UUID.source},
    offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES}};
  return [
    tool('merchant_grants_workspaces','List configured Grants.gov research aliases, retained source handles, merchant profiles and original buyer aliases.',{},[],read),
    tool('merchant_grants_open','Open the original Grants.gov workspace and its browser under the same native writer. Repeated opens reuse this owned instance.',scoped({}),['workspace'],{idempotent:true}),
    tool('merchant_grants_close','Drain this exact owned instance and its original source jobs, publisher and browser. Saved research and complete exports reopen with their original identities.',scoped({instanceId:{type:'string',pattern:UUID.source}}),['workspace','instanceId'],{destructive:true}),
    tool('merchant_grants_status','Read workspace identity, revision, counts, active source jobs and the original private browser URL.',scoped({}),['workspace'],read),
    tool('merchant_grants_inventory','Page saved queries, captures, immutable editions, reviews, merchants or exports. Continue with nextOffset and the original expectedSnapshot.',scoped({kind:{enum:['queries','captures','editions','reviews','merchants','exports']},...page}),['workspace','kind'],read),
    tool('merchant_grants_query_save','Save a complete native Grants.gov search, or revise the same query ID. Revision zero creates a query; requestId replays exactly the same original mutation.',scoped({requestId,id:nativeId,expectedRevision,name:shortText,definition:query}),['workspace','requestId','expectedRevision','name','definition'],{idempotent:true}),
    tool('merchant_grants_query','Read the original query definition and current revision before capture or editing.',scoped({queryId:nativeId}),['workspace','queryId'],read),
    tool('merchant_grants_capture','Start a full native page/detail capture using queryId, expectedRevision and operationId, or resume the original captureId. Status retains the acquisition after a lost reply.',scoped({requestId,queryId:nativeId,expectedRevision,operationId:nativeId,captureId:nativeId}),['workspace','requestId'],{openWorld:true,idempotent:true}),
    tool('merchant_grants_capture_status','Read the original provider journal, coverage, progress and continuation of one capture.',scoped({captureId:nativeId}),['workspace','captureId'],read),
    tool('merchant_grants_pause','Pause the original capture and retain all acquired pages and details for its same-ID continuation.',scoped({captureId:nativeId}),['workspace','captureId'],{idempotent:true}),
    tool('merchant_grants_source_import','Receive a host-declared original capture, complete edition package or workspace backup. The native reader verifies every retained source body and binding.',scoped({requestId,source:alias,name:shortText}),['workspace','requestId','source'],{idempotent:true}),
    tool('merchant_grants_edition_create','Create an immutable complete or selected opportunity edition from captureId or sourceEditionId. Preserve selected opportunity IDs and optional parent edition.',scoped({requestId,captureId:nativeId,sourceEditionId:nativeId,parentId:nativeId,name:shortText,opportunityIds:{type:'array',minItems:1,maxItems:100000,uniqueItems:true,items:nativeId}}),['workspace','requestId','name'],{idempotent:true}),
    tool('merchant_grants_edition','Read an immutable edition summary and its original source coverage. Use opportunity paging or a complete edition export for its rows.',inEdition({}),['workspace','editionId'],read),
    tool('merchant_grants_opportunities','Page and filter original opportunities by title, agency, status, retained closing date, with the saved qualification shown alongside each row. Continue with the same immutable edition and returned snapshot.',inEdition({search:{type:'string',maxLength:1000},status:{type:'string',maxLength:40},agency:{type:'string',maxLength:250},closingFrom:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'},closingTo:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'},sort:{type:'string',maxLength:80},direction:{enum:['asc','desc']},...page}),['workspace','editionId'],read),
    tool('merchant_grants_opportunity','Read one original full opportunity, active synopsis and retained forecast, attachments, revisions, qualification and history.',inEdition({opportunityId:nativeId}),['workspace','editionId','opportunityId'],read),
    tool('merchant_grants_review_save','Save the full qualification and workshare against the original opportunity, edition and current review revision.',inEdition({requestId,opportunityId:nativeId,expectedRevision,review:{type:'object',additionalProperties:false,properties:Object.fromEntries(fields.map(name=>[name,name==='status'?{enum:['researching','qualified','preparing','ready','passed']}:{type:'string',maxLength:32000}]))}}),['workspace','requestId','editionId','opportunityId','expectedRevision','review'],{idempotent:true}),
    tool('merchant_grants_compare','Compare two original immutable editions using native source fields and exact retained values. Page every change or export the complete comparison.',scoped({before:nativeId,after:nativeId,...page}),['workspace','before','after'],read),
    tool('merchant_grants_workshare','Read the complete native workshare for one source-backed qualification as Markdown or HTML.',inEdition({opportunityId:nativeId,format:{enum:['md','html']}}),['workspace','editionId','opportunityId'],read),
    tool('merchant_grants_merchant','Prepare an original SF30 dataset from one immutable edition, optionally using a host-selected profile of public payment terms.',inEdition({requestId,profile:alias}),['workspace','requestId','editionId'],{idempotent:true}),
    tool('merchant_grants_preview','Preview the prepared merchant through its original dataset handler, typed filters, sorts and cursor.',scoped({merchantId:nativeId,query:{type:'object'}}),['workspace','merchantId'],read),
    tool('merchant_grants_export','Retain a complete workspace, source, edition, merchant, comparison or workshare file. The returned content digest selects its full resumable download.',scoped({kind:{enum:exportKinds},editionId:nativeId,captureId:nativeId,merchantId:nativeId,opportunityId:nativeId,before:nativeId,after:nativeId,includeReviews:{type:'boolean'}}),['workspace','kind'],{idempotent:false}),
    tool('merchant_grants_manifest','Inspect the exact completion manifest for a retained original export. The native file remains in its original workspace.',scoped({exportId:hash}),['workspace','exportId'],read),
    tool('merchant_grants_file','Read a complete original export or its receiving manifest as pinned base64 chunks. Continue with readId, both expected hashes and nextOffset; reopen the same export after a process restart.',scoped(chunk),['workspace','exportId','file'],read),
    tool('merchant_grants_file_release','Release an unfinished read snapshot for this original export. The saved native export remains available.',scoped({exportId:hash,readId:{type:'string',pattern:UUID.source}}),['workspace','exportId','readId'],{idempotent:true}),
    tool('merchant_grants_publisher_status','Read original dataset drafts, versions, SF82 release and SF88 buyer sessions, including interrupted publication or payment continuation.',scoped({}),['workspace'],read),
    tool('merchant_grants_publisher_prepare','Prepare the configured merchant in the maintained dataset publisher. Reuses its original matching draft and source package.',scoped({merchantId:nativeId}),['workspace','merchantId'],{idempotent:true}),
    tool('merchant_grants_publisher_preview','Preview an original draft:ID or retained dataset snapshot using the same native query engine.',scoped({target:string,query:queryText}),['workspace','target'],read),
    tool('merchant_grants_publisher_review','Review a draft against the original current snapshot and revision after retained publication changes.',scoped({draftId:nativeId,expectedSnapshot:hash,expectedRevision}),['workspace','draftId','expectedSnapshot','expectedRevision'],{}),
    tool('merchant_grants_publish','Publish the reviewed draft through the original running version controller with its exact snapshot and revision.',scoped({draftId:nativeId,expectedSnapshot:hash,expectedRevision}),['workspace','draftId','expectedSnapshot','expectedRevision'],{}),
    tool('merchant_grants_snapshot','Activate an original retained snapshot or collect unreferenced native versions. Activation uses the original current snapshot/revision.',scoped({action:{enum:['activate','collect']},snapshot:hash,expectedSnapshot:hash,expectedRevision}),['workspace','action'],{destructive:true}),
    tool('merchant_grants_release','Stage, inspect, activate, roll back, start or stop the original SF82 release. Staging uses the host-declared runtime. Generation checks preserve the original release selection.',scoped({action:{enum:['stage','inspect','activate','rollback','start','stop']},draftId:nativeId,id:alias,label:shortText,expectedGeneration:{type:'integer',minimum:0}}),['workspace','action'],{openWorld:true}),
    tool('merchant_grants_buyer_review','Load the actual seller offer and first-page preview for the selected original snapshot.',scoped({snapshot:hash,query:queryText}),['workspace','snapshot'],{readOnly:true,openWorld:true}),
    tool('merchant_grants_buyer_prepare','Prepare the original buyer intent from the actual reviewed offer, exact offer digest and selected payment option.',scoped({review:{type:'object'},intentId:nativeId,acceptIndex:{type:'integer',minimum:0},offerSha256:hash}),['workspace','review','intentId','acceptIndex','offerSha256'],{}),
    tool('merchant_grants_buyer_session','Join the prepared buyer to its host-declared existing payer workspace and explicit page, row and aggregate amount limits.',scoped({buyerId:nativeId,workspaceId:alias,maxPages:{type:'integer',minimum:1},maxTotalAtomic:{type:'string',pattern:'^[0-9]+$'},maxRows:{type:'integer',minimum:1},maxPageBytes:{type:'integer',minimum:1}}),['workspace','buyerId','workspaceId','maxPages','maxTotalAtomic'],{}),
    tool('merchant_grants_buyer','Run, recover, finalize accounting or export the original buyer session. Unpaid retry passes the existing retryUnpaid and exact expectedAttemptSha256 to the original SF88 engine.',scoped({action:{enum:['run','recover','account','export']},id:nativeId,retryUnpaid:{type:'boolean'},expectedAttemptSha256:hash}),['workspace','action','id'],{openWorld:true}),
    tool('merchant_grants_publisher_export','Retain a complete native publisher draft, buyer configuration or actual customer manifest/CSV/JSONL/review for the same exact export download tools.',scoped({kind:{enum:publisherExportKinds},id:nativeId}),['workspace','kind','id'],{}),
  ];
}

export { grantsWorkspaceTools, alias, nativeId, hash, UUID, read, page, requestId, expectedRevision, shortText, query, fields, exportKinds, string, publisherExportKinds, ID, HASH, strings };
