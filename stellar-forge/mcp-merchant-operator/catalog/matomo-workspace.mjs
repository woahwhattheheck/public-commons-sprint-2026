// MIT. Typed Matomo tools delegate to the original retained source and merchant model.
import {MAX_RETAINED_CHUNK_BYTES} from '../retained-file-contracts.mjs';
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const id={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$'};
const hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const uuid={type:'string',pattern:'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$'};
const revision={type:'integer',minimum:0};
const text=(maximum=2000)=>({type:'string',minLength:1,maxLength:maximum});
const note=text(4000),reviewer=text(160),selected={workspace:alias};
const page={offset:revision,limit:{type:'integer',minimum:1,maximum:250}};
const object=(properties,required=[])=>({type:'object',additionalProperties:false,properties,required});
const scope=object({period:{enum:['day','week','month','year','range']},
  date:{type:'string',pattern:'^[0-9]{4}-[0-9]{2}-[0-9]{2}(,[0-9]{4}-[0-9]{2}-[0-9]{2})?$'},
  segment:{type:'string',maxLength:8192},language:{type:'string',pattern:'^[a-z]{2,3}(?:-[A-Z]{2})?$'}},['period','date']);
const limits={maxRows:{type:'integer',minimum:1,maximum:1000000},
  maxRequests:{type:'integer',minimum:1,maximum:10000},maxBytes:{type:'integer',minimum:1024,maximum:536870912},
  maxDepth:{type:'integer',minimum:0,maximum:128}};
const rules={type:'object',maxProperties:64,additionalProperties:text(1024)};
const selection=object({schema:{const:'stellar-forge.matomo-report-selection.v1'},catalogId:id,reportId:text(1024),scope,
  pageSize:{type:'integer',minimum:1,maximum:1000},...limits,subtables:{type:'boolean'},subtableRules:rules,note:text(2000)},
  ['schema','catalogId','reportId','scope']);
const selector=object({source:{enum:['data','metadata','path','report']},name:text(1024)},['source']);
const mapped=object({name:text(160),left:selector,right:selector,mode:{enum:['native','decimal']}},['name','left','right']);
const mapping=object({keys:{type:'array',minItems:1,maxItems:16,items:mapped},
  fields:{type:'array',maxItems:512,items:mapped},note},['keys','fields','note']);
const merchant=object({name:{type:'string',pattern:'^[\\x20-\\x7e]{1,32}$'},
  origin:text(2048),network:text(128),asset:text(512),payTo:text(512),maxTimeoutSeconds:{type:'integer',minimum:1}},
  ['name','origin','network','asset','payTo']);
const configuration=object({merchant,amount:{type:'string',pattern:'^[1-9][0-9]*$'},
  fields:{type:'array',maxItems:52,uniqueItems:true,items:text(1024)},
  path:{type:'string',pattern:'^/[A-Za-z0-9/_-]*[A-Za-z0-9_-]$'}},['merchant','amount']);
const runtime=object({port:{type:'integer',minimum:0,maximum:65535},
  facilitator:text(2048),allowLocalFacilitator:{type:'boolean'}});
function mutation(native,description,properties,required,annotations={}) {
  return Object.freeze({native,description,properties:Object.freeze(properties),required:Object.freeze(required),
    annotations:Object.freeze({idempotent:true,...annotations})});
}
export const MATOMO_MUTATIONS=Object.freeze({
  merchant_adopt_original:mutation('adopt-original-merchant','Adopt one explicitly selected saved merchant draft from this received original archive into a new editable local merchant. The original compiler validates its exact query and payment terms against the local edition; no release, publication, source request or payment is replayed.',{originalMerchantId:id},['originalMerchantId']),
  discover:mutation('discover','Discover the original report/segment/site metadata for one literal native period. This contacts only the configured Matomo source. Retain the resulting catalog ID and its actual outcomes.',{scope},['scope'],{openWorld:true}),
  discover_resume:mutation('resume-catalog','Continue the same retained incomplete catalog. Accepted responses remain authoritative; only unresolved native source reads continue.',{catalogId:id},['catalogId'],{openWorld:true}),
  capture_start:mutation('capture','Capture the explicitly selected retained catalog variant and actual native subtables. Keep source limits, unresolved child mappings and archive truncation visible; a complete archive is not a complete raw-event population.',{selection},['selection'],{openWorld:true}),
  capture_resume:mutation('resume-capture','Continue the same capture with retained accepted pages. Optional reviewed increased limits or explicit child-report rules address the actual stopped boundary; note records the decision.',{captureId:id,limits:object(limits),subtableRules:rules,note:text(2000)},['captureId'],{openWorld:true}),
  edition_build:mutation('edition','Build a source-linked immutable typed edition from one retained capture. Includes original numbers, null/absence, report hierarchy and complete source-file chunks; does not contact Matomo.',{captureId:id,label:text(160),note},['captureId','label','note']),
  edition_resume:mutation('resume-edition','Resume the same incomplete edition finalization against its retained source. No source request is repeated.',{editionId:id},['editionId']),
  edition_review:mutation('review-edition','Retain a named review of the exact immutable edition hash. Approval does not invent source rights or raw-event completeness.',{editionId:id,editionSha256:hash,reviewer,decision:{enum:['approved','changes_requested']},note},['editionId','editionSha256','reviewer','decision','note']),
  comparison_start:mutation('compare','Compare two exact editions using explicit native field/path/report keys and mapped values. Native kinds remain distinct; decimal equivalence is selected deliberately. Duplicate or invalid keys are findings, not inferred matches.',{leftEditionId:id,rightEditionId:id,mapping},['leftEditionId','rightEditionId','mapping']),
  comparison_resume:mutation('resume-comparison','Resume the original incomplete comparison without changing its edition or mapping identities.',{comparisonId:id},['comparisonId']),
  comparison_review:mutation('review-comparison','Review one exact finding or all findings (*) against the immutable comparison manifest hash. Existing decisions and source rows remain retained.',{comparisonId:id,manifestSha256:hash,findingId:{type:'string',minLength:1,maxLength:128},reviewer,decision:{enum:['accepted','follow_up','changes_requested']},note},['comparisonId','manifestSha256','reviewer','decision','note']),
  merchant_configure:mutation('configure-merchant','Compose the original three SQLite report/source-file queries for a selected edition. Native seller validation checks the full HTTPS descriptor, printable-ASCII merchant name and exact original payment terms before creating the merchant.',{editionId:id,configuration},['editionId','configuration']),
  merchant_resume:mutation('resume-merchant','Recover the existing incomplete merchant configuration with its retained original settings; it does not replace a failed reviewed draft.',{merchantId:id},['merchantId']),
  merchant_save:mutation('save-merchant','Save a deliberately corrected native SQLite draft into the same merchant using its current draft revision. Original compiler validation remains authoritative; query and payment changes are explicit.',{merchantId:id,draftRevision:hash,draft:{type:'object',description:'The complete original SQLite workbench draft, with merchant and queries. Preserve exact parameter types, public inputs, result columns and payment terms.'}},['merchantId','draftRevision','draft']),
  package_export:mutation('export-package','Export the current reviewed original SQLite merchant package once. The native manifest binds source database, queries, public offers and draft revision.',{merchantId:id,draftRevision:hash,name:{type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'}},['merchantId','draftRevision','name']),
  package_recover:mutation('recover-package','Recover the same retained package export and inspect its exact native manifest. Does not choose a new name or rerun a provider capture.',{packageId:id},['packageId']),
  release_stage:mutation('stage-release','Stage that original package through SF82, including its native SQLite snapshot. Use the same intended release identity to reconcile a known failed stage after inspecting its original action.',{packageId:id,releaseId:{type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'},label:text(160),runtime},['packageId','releaseId','label']),
  release_select:mutation('select-release','Select or explicitly roll back to an inspected original release at the current generation. Existing running processes and release history remain governed by original SF82.',{releaseId:id,expectedGeneration:revision,reason:text(2000),rollback:{type:'boolean'}},['releaseId','expectedGeneration','reason'],{destructive:true}),
  release_start:mutation('start-release','Start the selected original release at the inspected generation. The actual runtime mode, listener and original process identity are returned. Missing facilitator means CHALLENGE_ONLY, not a paid purchase.',{expectedGeneration:revision},['expectedGeneration'],{openWorld:true}),
  release_stop:mutation('stop-release','Stop only the actual owned seller instance from the original release result. This instanceId identifies the seller; workspaceInstanceId separately identifies this MCP workspace.',{instanceId:uuid},['instanceId'],{destructive:true}),
  release_console_open:mutation('open-release-console','Open the original SF82 console over the same retained release store. It does not select or start a release.',{},[]),
  delivery_prepare:mutation('prepare-delivery','Prepare the entire original named-query publication using either report rows or the complete source-file projection. API preview limits do not truncate this extraction.',{editionId:id,projection:{enum:['report-rows','source-files']},label:text(160),note},['editionId','projection','label','note']),
  delivery_recover:mutation('recover-delivery','Recover the same original incomplete publication candidate and retain the native target state.',{deliveryId:id},['deliveryId']),
  delivery_review:mutation('review-delivery','Record the original publisher review and exact current target pins. initialize:true explicitly reviews an initially absent private target; later editions retain snapshot/revision conditions.',{deliveryId:id,reviewer,note,initialize:{type:'boolean'},expectedSnapshot:hash,expectedTargetRevision:revision},['deliveryId','reviewer','note']),
  delivery_publish:mutation('publish-delivery','Publish through the original retained publisher using its exact native review ID. A prior unknown publication is reconciled by that publisher before a new effect is considered.',{deliveryId:id,reviewId:id},['deliveryId','reviewId']),
  handover_prepare:mutation('prepare-handover','Authorize local reads of the reviewed operator-owned source-file dataset through the original SF30 producer, SF100 append/finalize and exact operator request/response custody. This makes no provider request or buyer payment.',{deliveryId:id,reviewer,note,limit:{type:'integer',minimum:1,maximum:12}},['deliveryId','reviewer','note']),
  handover_resume:mutation('resume-handover','Continue the same handover and original SF100 pages. A missing local receipt is reconciled from the retained response instead of rereading the producer.',{handoverId:id},['handoverId']),
  receiving_receive:mutation('receive-handover','Receive the selected completed handover with the original Python DatasetDelivery and SourceFiles implementation. Verify archive inventory, native pages, typed chunks and exact operator evidence; preserve native payment status.',{handoverId:id,label:text(160)},['handoverId','label']),
  receiving_resume:mutation('resume-receiving','Resume the same original receiving directory and archive identity. No source capture or payment is repeated.',{receivingId:id},['receivingId']),
  receiving_reopen:mutation('reopen-receiving','Reopen and verify the existing native customer delivery and exact retained source population. It does not acquire the data again.',{receivingId:id},['receivingId'])
});
const read={readOnly:true,idempotent:true};
export const MATOMO_ARTIFACTS=Object.freeze(['capture','edition','database','comparison','delivery','handover','source','workspace-origin','workspace-archive','workspace-original']);
export function matomoWorkspaceTools(tool) {
  return [
    tool('merchant_matomo_workspaces','List host-declared Matomo aliases and exact current workspace ownership. Does not open a model or contact the provider.',{},[],read),
    tool('merchant_matomo_open','Open the original configured Matomo model and its same authenticated browser. Native workspace identity/lease is checked; no capture, publication or seller start occurs.',selected,['workspace'],{idempotent:true}),
    tool('merchant_matomo_close','Close this exact current owned Matomo workspace/browser. Original source cancellation, merchant drain and retained file readers remain together; saved records are preserved.',{...selected,instanceId:uuid},['workspace','instanceId'],{idempotent:true,destructive:true}),
    tool('merchant_matomo_original_records','Read a bounded page of the retained original authoring workspace history and records. These are provenance, not active local merchant or payment attempts.',{...selected,table:{enum:['actions','history','merchants','merchant_packages','deliveries','handovers','receivings','catalogs','captures','editions','comparisons','edition_reviews','comparison_reviews']},offset:revision,limit:{type:'integer',minimum:1,maximum:50}},['workspace'],read),
    tool('merchant_matomo_original_files','List the exact received workspace inventory. Each returned opaque id selects that original file through artifact_read with artifact workspace-original.',{...selected,offset:revision,limit:{type:'integer',minimum:1,maximum:50}},['workspace'],read),
    tool('merchant_matomo_original_merchant','Review a saved original merchant configuration and full draft, with original archive and file hashes, before explicit local adoption.',{...selected,originalMerchantId:id},['workspace','originalMerchantId'],read),
    tool('merchant_matomo_status','Read original workspace revision, active operation, retained catalogs/captures/editions/reviews and customer/merchant records. Native source numbers and statuses are preserved.',selected,['workspace'],read),
    tool('merchant_matomo_operation','Read the exact original action, immutable input and outcome alongside the current active operation. Inspect this after a lost response before selecting a native recovery command.',{...selected,operationId:id},['workspace','operationId'],read),
    tool('merchant_matomo_cancel','Request cancellation of the exact active original operation in this current workspace instance. Read the original action afterward; cancellation is not an assertion that an external effect never occurred.',{...selected,workspaceInstanceId:uuid,operationId:id},['workspace','workspaceInstanceId','operationId'],{idempotent:true,destructive:true}),
    tool('merchant_matomo_catalog','Inspect the retained catalog summary or a page of exact report/segment definitions. Native report IDs, fixed parameters, child actions and actual outcomes remain unchanged.',{...selected,catalogId:id,part:{enum:['summary','reports','segments']},...page},['workspace','catalogId'],read),
    tool('merchant_matomo_capture','Read the actual capture selection, progress, source limits, issues and retained native subtable structure. Does not fetch a page.',{...selected,captureId:id},['workspace','captureId'],read),
    tool('merchant_matomo_rows','Read an exact page of retained capture rows and native typed cells with report/source/hierarchy references. Missing/null/numeric/JSON kinds remain distinct.',{...selected,captureId:id,tableId:hash,...page},['workspace','captureId'],read),
    tool('merchant_matomo_edition','Read the immutable edition manifest, field kinds, source-file geometry and review history.',{...selected,editionId:id},['workspace','editionId'],read),
    tool('merchant_matomo_edition_rows','Read retained edition rows through the original typed SQLite reader. offset/limit/total/next are the native complete-population cursor.',{...selected,editionId:id,tableId:hash,...page},['workspace','editionId'],read),
    tool('merchant_matomo_comparison','Read a page of native comparison findings and its exact source/edition mapping. Optional kind is the original finding kind; full JSONL remains available in the same browser.',{...selected,comparisonId:id,kind:text(128),...page},['workspace','comparisonId'],read),
    tool('merchant_matomo_merchant','Read the original saved merchant draft/revision and package records. This does not start a seller.',{...selected,merchantId:id},['workspace','merchantId'],read),
    tool('merchant_matomo_preview','Execute one selected original read-only SQLite query against the retained edition, bound to its current draft revision. No Matomo request or buyer payment.',{...selected,merchantId:id,draftRevision:hash,query:text(128),input:{type:'object'}},['workspace','merchantId','draftRevision','query'],read),
    tool('merchant_matomo_releases','Read actual original SF82 catalog, generation and process status. Does not select, start or stop a release.',selected,['workspace'],read),
    tool('merchant_matomo_release_diff','Read the original difference between retained releases before selection or rollback.',{...selected,before:{anyOf:[id,{type:'null'}]},after:id},['workspace','after'],read),
    tool('merchant_matomo_delivery','Inspect the existing original publisher candidate and target, including its exact review and native publication state.',{...selected,deliveryId:id,query:text(128)},['workspace','deliveryId'],read),
    tool('merchant_matomo_handover','Read the retained complete or interrupted original SF100 handover and exact archive identity. Payment status is the native status.',{...selected,handoverId:id},['workspace','handoverId'],read),
    tool('merchant_matomo_receiving','Read the original customer receiving/reopen result and exact source population.',{...selected,receivingId:id},['workspace','receivingId'],read),
    tool('merchant_matomo_receiving_rows','Read native customer rows from the verified reopened source delivery, without acquiring it again.',{...selected,receivingId:id,...page,limit:{type:'integer',minimum:1,maximum:100}},['workspace','receivingId'],read),
    tool('merchant_matomo_source_read','Inspect one exact original source request, accepted attempt and retained response identity. Does not dispatch it.',{...selected,sourceRequestId:id},['workspace','sourceRequestId'],read),
    tool('merchant_matomo_artifact_read','Read an exact native capture/edition/database/comparison/publication/handover/source artifact through the original immutable retained-file reader. No client path. workspace-original uses its inventory opaque id; workspace-origin/archive use id original. The shared remote immutable-file ceiling is 8 GiB; larger full archives use the streaming local/browser route. Reuse hash/readId/offset; after restart omit readId and bind the same hash/offset.',{
      ...selected,artifact:{enum:MATOMO_ARTIFACTS},id,kind:{enum:['csv','config','manifest','archive','scan']},
      readId:uuid,expectedSha256:hash,offset:revision,limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES}
    },['workspace','artifact','id'],read),
    tool('merchant_matomo_artifact_release','Release one owned retained artifact read session. Original source, package and archive files remain.',{...selected,readId:uuid},['workspace','readId'],read),
    ...Object.entries(MATOMO_MUTATIONS).map(([suffix,operation])=>tool('merchant_matomo_'+suffix,
      operation.description+' Use one immutable operationId, the current expectedRevision and current workspaceInstanceId.',
      {...selected,workspaceInstanceId:uuid,operationId:id,expectedRevision:revision,...operation.properties},
      ['workspace','workspaceInstanceId','operationId','expectedRevision',...operation.required],operation.annotations))
  ];
}
