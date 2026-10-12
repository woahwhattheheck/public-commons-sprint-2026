// MIT. Original tariff-to-quotation lifecycle, source receiving and complete retained file reads.
import {MAX_RETAINED_CHUNK_BYTES} from '../retained-file-contracts.mjs';
const uuid={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'};
const sha={type:'string',pattern:'^[a-f0-9]{64}$'};
const text=maxLength=>({type:'string',minLength:1,maxLength});
const path=text(4096),selected={id:uuid,expectedRevision:sha};
const authoring={pricingDirectory:path,pricingConfig:path,pricingSnapshot:path,pricingHistory:path};
const quoted={...selected,revision:sha,sourceId:sha,quoteId:uuid,quoteSha256:sha};
export function commercialTariffTools(tool){
  const read={readOnly:true,idempotent:true},write={idempotent:true};
  return [
    tool('merchant_case_commercial_tariff_status','Read this saved case, attached original tariff sources and active original listener requests. Recovery stays with the native selection, backup and case UUIDs.',
      {id:uuid},['id'],read),
    tool('merchant_case_commercial_tariff_catalog','Open original pricing and tariff history from its private directory/configuration and exactly one saved snapshot or history file. Lists original completed and pending selection requests without saving a new pricing selection.',
      {...selected,...authoring},['id','pricingDirectory','pricingConfig'],read),
    tool('merchant_case_commercial_tariff_selection','Inspect one exact original tariff portfolio and retained scenario/pricing result using the original portfolio validator. Pending original pricing operations remain with their existing UUIDs.',
      {...selected,...authoring,selectionRequestId:uuid},['id','pricingDirectory','pricingConfig','selectionRequestId'],read),
    tool('merchant_case_commercial_tariff_capture','Capture a completed original tariff selection, its two saved native results and matching complete pricing backup. Retain backupRequestId, selectionRequestId, exact input and destination for recovery. A completed capture can reopen after the authoring paths move.',
      {...selected,...authoring,selectionRequestId:uuid,backupRequestId:uuid,directory:path},
      ['id','selectionRequestId','backupRequestId','directory'],write),
    tool('merchant_case_commercial_tariff_inspect','Verify the retained tariff source and full pricing backup, including every file in the later completed native pricing version. Returns original tier, quantity, uniform rate, rounding and file descriptors.',
      {...selected,directory:path,expectedSourceSha256:sha},['id','directory'],read),
    tool('merchant_case_commercial_tariff_attach','Attach the reviewed source to the current case using three original requests: pricing receive, backup attachment and tariff material. Keep all three UUIDs, original revision, actor, source hash and merchant/source reason after an interrupted response.',
      {...selected,directory:path,expectedSourceSha256:sha,pricingRequestId:uuid,backupAttachmentRequestId:uuid,
        tariffAttachmentRequestId:uuid,actor:text(200),bindingReason:text(4000)},
      ['id','expectedRevision','directory','expectedSourceSha256','pricingRequestId','backupAttachmentRequestId','tariffAttachmentRequestId','actor','bindingReason'],write),
    tool('merchant_case_commercial_tariff_case','Inspect an attached tariff or the exact saved quote tariff. Optional explicit monthlyRequests invokes the original tariff calculator and original saved-rate usage calculation side by side; it does not change the saved unit price.',
      {...quoted,monthlyRequests:{type:'string',pattern:'^(0|[1-9][0-9]*)$',maxLength:16}},['id'],read),
    tool('merchant_case_commercial_tariff_restore','Restore the original full pricing backup belonging to the exact quote, then receive and reopen its original selected tariff portfolio. Keep the archive outside the separate restore directory. Original native source/request identities are retained.',
      {...quoted,archive:path,directory:path},['id','quoteId','quoteSha256','archive','directory'],write),
    tool('merchant_case_commercial_tariff_file','Read the exact retained tariff source or original selected portfolio through the existing bounded file reader. Continue with readId, expectedSha256 and nextOffset. Existing merchant_case_commercial_file_reads/file_release manage these same reads; full case delivery uses merchant_case_export.',
      {id:uuid,revision:sha,sourceId:sha,kind:{enum:['SOURCE','PORTFOLIO']},readId:uuid,expectedSha256:sha,
        offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES}},
      ['id','revision','sourceId','kind'],read),
  ];
}
