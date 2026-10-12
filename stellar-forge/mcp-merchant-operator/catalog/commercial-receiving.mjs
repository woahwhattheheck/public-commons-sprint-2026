// MIT. Original full pricing and quotation receiving on the configured merchant case.
const uuid={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'};
const sha={type:'string',pattern:'^[a-f0-9]{64}$'};
const text=maxLength=>({type:'string',minLength:1,maxLength});
const path=text(4096),selected={id:uuid,expectedRevision:sha};
const quoted={...selected,revision:sha,quoteId:uuid,quoteSha256:sha,archiveSha256:sha};
export function commercialReceivingTools(tool){
  const read={readOnly:true,idempotent:true},write={idempotent:true};
  return [
    tool('merchant_case_commercial_receiving_status','Read the current original case identity and actual in-process pricing/backup receiving work. Saved backup and case request IDs remain in their original native engines.',
      {id:uuid},['id'],read),
    tool('merchant_case_commercial_receiving_capture','Capture an existing saved SF97 plan and its complete original WORKSPACE_BACKUP. Supply the original private workspace/config and exactly one saved snapshot/history path. Keep backupRequestId, selected inputs and output directory after interruption. Inspect the retained source before attaching it.',
      {...selected,pricingDirectory:path,pricingConfig:path,pricingSnapshot:path,pricingHistory:path,
        planId:uuid,scenarioId:text(200),backupRequestId:uuid,directory:path},
      ['id','pricingDirectory','pricingConfig','planId','backupRequestId','directory'],write),
    tool('merchant_case_commercial_receiving_inspect','Verify the complete original retained pricing source, full workspace backup, original cost edition and supplier files. Returns exact source/file descriptors and the native pricing review; it does not append to the merchant case.',
      {...selected,directory:path,expectedSourceSha256:sha},['id','directory'],read),
    tool('merchant_case_commercial_receiving_attach','Attach the reviewed pricing source and complete original backup to this same case using the original two native request UUIDs. Record the merchant/source binding reason. Retry both original IDs, original case revision, actor, source SHA and exact input after a lost reply.',
      {...selected,directory:path,expectedSourceSha256:sha,pricingRequestId:uuid,attachmentRequestId:uuid,
        actor:text(200),bindingReason:text(4000)},
      ['id','expectedRevision','directory','expectedSourceSha256','pricingRequestId','attachmentRequestId','actor','bindingReason'],write),
    tool('merchant_case_commercial_receiving_case','Inspect one exact original quote and its retained complete pricing backup at a saved case revision. Choose archiveSha256 when the source has multiple original backups. Customer responses and source-case lineage remain unchanged.',
      quoted,['id','quoteId','quoteSha256'],read),
    tool('merchant_case_commercial_receiving_restore','Recover the original pricing TAR from the selected quote and restore its complete editable SF97 workspace through the original archive engine. Keep the retained archive outside the restore directory. Reopen verifies the same plan, pricing version, cost edition and every original supplier source.',
      {...quoted,archive:path,directory:path},['id','quoteId','quoteSha256','archive','directory'],write),
  ];
}
