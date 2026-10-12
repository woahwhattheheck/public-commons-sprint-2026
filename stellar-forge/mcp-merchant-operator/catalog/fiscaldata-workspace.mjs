// MIT. Original tool metadata; provider runtimes load only when selected.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};

const uuid={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'};

const hash={type:'string',pattern:'^[a-f0-9]{64}$'};

const payload={type:'object',additionalProperties:true};

const operationId={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'};

const read={readOnly:true,idempotent:true};

const publisherActions=new Set([
  'publisher.status','publisher.prepare','publisher.preview','publisher.reviewDraft','publisher.publish',
  'publisher.activateSnapshot','publisher.collect','publisher.release.stage','publisher.release.inspect',
  'publisher.release.activate','publisher.release.rollback','publisher.release.start','publisher.release.stop',
  'publisher.buyer.review','publisher.buyer.prepare','publisher.buyer.session','publisher.buyer.run',
  'publisher.buyer.recover','publisher.buyer.account','publisher.buyer.export'
]);

function fiscalDataWorkspaceTools(tool){
  const scope=p=>({workspace:alias,...p});
  const window={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}};
  const chunk={expectedSha256:hash,readId:uuid,offset:{type:'integer',minimum:0},
    limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES}};
  return [
    tool('merchant_fiscaldata_status','List host-declared Fiscal workspaces and operator identity, or page a section of the original opened workspace. Every history and endpoint list returns its real total and next offset.',scope({section:{enum:['overview','catalog','sources','captures','editions','comparisons','exports','packages']},...window}),[],read),
    tool('merchant_fiscaldata_open','Open the original Fiscal model under its kernel lease. Repeated calls reuse this process-owned instance. Existing captures remain idle until an explicit start or resume.',scope({}),['workspace'],{idempotent:true}),
    tool('merchant_fiscaldata_close','Drain and close this exact model and borrowed browser, retaining all originals and received customer data.',scope({instanceId:uuid}),['workspace','instanceId'],{destructive:true}),
    tool('merchant_fiscaldata_catalog','Refresh actual Treasury metadata or read the retained catalogue. Refresh makes a dated original observation.',scope({action:{enum:['refresh','get']},...window}),['workspace','action'],{openWorld:true}),
    tool('merchant_fiscaldata_source','Save a source revision or probe its actual Treasury fields. Uses the original source schema and exact revision guards.',scope({action:{enum:['save','probe']},payload}),['workspace','action','payload'],{openWorld:true}),
    tool('merchant_fiscaldata_capture','Create, read, page, pause, resume or cancel an original paged Treasury capture. Reuse requestId for creation and preserve the original source ID/revision/SHA.',scope({action:{enum:['start','get','rows','pause','resume','cancel']},payload,...window}),['workspace','action','payload'],{openWorld:true}),
    tool('merchant_fiscaldata_edition','Create, inspect, review, build or page a native Fiscal CSV edition. Decimal values and scales stay strings. The original model validates units, null markers, key fields and field review revisions.',scope({action:{enum:['create','get','review','build','rows']},payload}),['workspace','action','payload'],{}),
    tool('merchant_fiscaldata_query','Query an original READY native CSV edition with its declared query grammar and exact retained response.',scope({id:uuid,query:{type:'string',maxLength:8192}}),['workspace','id','query'],read),
    tool('merchant_fiscaldata_comparison','Create or page an original exact-decimal cohort comparison, including source units, participating rows and first/last dated stock observations.',scope({action:{enum:['create','get']},payload}),['workspace','action','payload'],{}),
    tool('merchant_fiscaldata_export','Create the original complete capture, edition or comparison delivery and immutable archive.',scope({payload}),['workspace','payload'],{}),
    tool('merchant_fiscaldata_merchant','Prepare the original edition merchant export using a declared public merchant profile, including its exact raw sourceFiles closure.',scope({editionId:uuid,profile:alias,requestId:operationId}),['workspace','editionId','profile','requestId'],{}),
    tool('merchant_fiscaldata_publisher','Operate the original publisher, SF82 release and SF88 buyer. Runtime and buyer directories come from host bindings; native purchase approval and exact retained offer/revision guards remain in the original engines.',scope({action:{enum:[...publisherActions]},payload}),['workspace','action','payload'],{openWorld:true}),
    tool('merchant_fiscaldata_checkpoint','Drain the owned model and browser, then stream its full original source/review workspace into a hashed portable package under the original lease. Reopens the same workspace with unfinished captures paused; use a stable operationId for retry.',scope({operationId}),['workspace','operationId'],{}),
    tool('merchant_fiscaldata_restore','Receive a reviewed package into an empty CLOSED declared workspace. Choose either a pinned host sourceImport or one package produced by a declared sourceWorkspace. Retains source IDs, original records, acquired delivery files and receiving lineage; unfinished captures are paused.',scope({sourceImport:alias,sourceWorkspace:alias,packageId:hash,expectedSha256:hash,operationId}),['workspace','expectedSha256','operationId'],{}),
    tool('merchant_fiscaldata_file','Read a hash-pinned original model or portable-package file through the existing bounded retained chunk reader. Continue using readId and expectedSha256 until nextOffset is null.',scope({kind:{enum:['capture','edition','comparison','export','publisher','package']},id:{type:'string'},filename:{type:'string',minLength:1,maxLength:180},...chunk}),['workspace','kind','id','filename'],read),
    tool('merchant_fiscaldata_file_release','Release an unfinished process-owned retained file read.',scope({readId:uuid}),['workspace','readId'],{idempotent:true}),
    tool('merchant_fiscaldata_browser','Open or close the original industrial browser on loopback, borrowing this same model and recording writes under the declared operator. The native HTTP cookie, origin and CSRF controls remain active.',scope({action:{enum:['open','close']},port:{type:'integer',minimum:0,maximum:65535}}),['workspace','action'],{}),
    tool('merchant_fiscaldata_history','Read retained original operator action intents and observed outcomes, including interrupted actions without a completion record.',scope({...window}),['workspace'],read)
  ];
}

export { fiscalDataWorkspaceTools, alias, hash, uuid, read, payload, operationId, publisherActions };
