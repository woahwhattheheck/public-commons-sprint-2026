// MIT. Paid Research catalogue on the existing authenticated Research attachment.
const workspace={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const uuid={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'};
const sha={type:'string',pattern:'^[a-f0-9]{64}$'};
const revision={type:'integer',minimum:1,maximum:9007199254740991};
const atomic={type:'string',pattern:'^[1-9][0-9]{0,18}$',
 description:'Exact positive native atomic amount as a string; preserve the original reviewed asset and network.'};
const environment={type:'string',pattern:'^[A-Z][A-Z0-9_]{1,64}$',
 description:'Name of the existing private claim environment variable, without its value.'};
const recordId={type:'string',pattern:'^[A-Za-z0-9._:-]{1,160}$'};
const collection={type:'string',enum:['publications','purchases']};
const part={type:'string',enum:['publication','handoff','archive','received']};
const offset={type:'integer',minimum:0},limit={type:'integer',minimum:1,maximum:100};
const read={readOnly:true,idempotent:true},write={idempotent:true};
const common={workspace},operation={...common,operationId:uuid};
const purchase={...operation,id:uuid,requestId:uuid,preparedSha256:sha};
const sourceWorkspace={type:'object',properties:{
 library:{type:'string',pattern:'^(?:original|received-[a-f0-9]{64})$'},
 actor:{type:'string',minLength:1,maxLength:200},
 requestId:{type:'string',pattern:'^[A-Za-z0-9._:-]{8,160}$'}},
 required:['library','actor','requestId'],additionalProperties:false};
export const RESEARCH_COMMERCE_PREFIX='merchant_research_commerce_';
export const RESEARCH_COMMERCE_EXPORTS=Object.freeze({
 'commerce-publication':{extension:'json'},'commerce-handoff':{extension:'json'},
 'commerce-archive':{extension:'gz'},'commerce-received':{extension:'json'},
 'commerce-operation-json':{extension:'json'},
});
export const RESEARCH_COMMERCE_EXPORT_FIELDS=Object.freeze({
 commerceKind:collection,commerceId:uuid,commerceOperationId:uuid,
});
export function researchCommerceTools(tool){
 return [
  tool('merchant_research_commerce_configuration',
   'Read the original Research host merchant and Buyer aliases, original retained native configurations and existing launch errors. These aliases belong to the same authenticated Research workspace. Payment terms and private claim environment values remain in the original host configuration.',
   common,['workspace'],read),
  tool('merchant_research_commerce_library',
   'Page original paid Research publications or purchases. Preserve the returned snapshot when requesting a later offset. Publication IDs and purchase IDs select original retained merchant orders, Buyer drafts, paid file capture and dossier receiving.',
   {...common,kind:collection,offset,limit,snapshot:sha},['workspace','kind'],read),
  tool('merchant_research_commerce_publication',
   'Reopen an original publication by its request ID: exact selected customer delivery, complete file manifest, merchant configuration binding, review and enrolled native handoff. The frozen delivered reports and source history retain their original edition.',
   {...common,id:uuid},['workspace','id'],read),
  tool('merchant_research_commerce_purchase',
   'Read an original received publication and its existing Buyer draft, prepared budgets, approval, execution, paid-file capture and editable dossier receiving. Use refresh=true to obtain the current original Buyer state while a native execution is running.',
   {...common,id:uuid,refresh:{type:'boolean'}},['workspace','id'],read),
  tool('merchant_research_commerce_file',
   'Read the exact original publication, merchant handoff, complete paid archive or received-customer file descriptor. Pass its SHA256 to merchant_research_export with the matching commerce kind; the existing file reader streams all original bytes.',
   {...common,kind:collection,id:uuid,part},['workspace','kind','id','part'],read),
  tool('merchant_research_commerce_operations',
   'Page this Research attachment’s retained complete commerce operations. This inventory survives detach/restart and includes prepared selections, native inputs and completed first replies. Pin snapshot for subsequent pages; inspect or resume the same operationId.',
   {...common,offset,limit,snapshot:sha},['workspace'],read),
  tool('merchant_research_commerce_operation',
   'Reopen one retained merchant operation and its complete original native result. Export commerce-operation-json with commerceOperationId for its full original selection/request/result, including retained publication input. An actively executing native writer can be observed through the original purchase tool.',
   operation,['workspace','operationId'],read),
  tool('merchant_research_commerce_resume',
   'Resume the same retained operation. Reuses the first complete result or dispatches its exact original native request when a reply was lost. Retained publication input survives loss of the earlier donor file. This operation may complete the original purchase or receiving action; preserve its operationId.',
   operation,['workspace','operationId'],write),
  tool('merchant_research_commerce_replay',
   'Submit the exact request from an earlier retained merchant operation again, keeping a distinct new operationId and both complete results. Uses the original native request ID and native idempotency, including an earlier operation whose first mutation never completed. Repeating the new replay operation resumes its own retained request/result.',
   {...operation,sourceOperationId:uuid},['workspace','operationId','sourceOperationId'],write),
  tool('merchant_research_commerce_publication_prepare',
   'Prepare an original merchant publication for one actual frozen customer delivery and exact dossier revision. Retains the complete four report bodies, saved work, portable dossier and optional original Europe PMC workspace in the native paid archive. Read the returned original review before enrolling its reviewSha256. The merchant alias selects existing Stellar terms.',
   {...operation,requestId:uuid,merchant:workspace,
    dossierId:{type:'string',pattern:'^d_[a-f0-9-]{36}$'},deliveryId:recordId,revision,
    title:{type:'string',minLength:1,maxLength:240},summary:{type:'string',maxLength:8000},
    usage:{type:'string',maxLength:8000},sourceWorkspace},
   ['workspace','operationId','requestId','merchant','dossierId','deliveryId','revision','title','summary','usage'],write),
  tool('merchant_research_commerce_publication_enroll',
   'Enroll the exact reviewed native publication. Supply its original publication id and reviewSha256. The existing SF101 checkout creates/reopens the original merchant order and original-recipient handoff; the complete frozen archive remains bound to that order.',
   {...operation,id:uuid,reviewSha256:sha},['workspace','operationId','id','reviewSha256'],write),
  tool('merchant_research_commerce_purchase_receive',
   'Receive a complete original paid-publication file through a host-declared commerce-publication source, or a retained commerce-publication export. Select exactly source OR exportId; fromWorkspace selects the other already-attached original Research source for an export. publicationSha256 must equal the declared source/export hash. The complete bytes are retained before native Buyer intake, so the same operation resumes after the donor moves.',
   {...operation,requestId:uuid,buyer:workspace,publicationSha256:sha,
    source:workspace,fromWorkspace:workspace,exportId:sha},
   ['workspace','operationId','requestId','buyer','publicationSha256'],write),
  tool('merchant_research_commerce_purchase_prepare',
   'Prepare the received publication using its current original Buyer paid-file revision, exact total/daily atomic budgets and existing claim environment name. Retains the full original draft/approval binding and preparedSha256. Payment and execution continue through the same original Buyer agent.',
   {...operation,id:uuid,requestId:uuid,expectedRevision:{type:'integer',minimum:0,maximum:10000},totalAtomic:atomic,dailyAtomic:atomic,claimEnv:environment},
   ['workspace','operationId','id','requestId','expectedRevision','totalAtomic','dailyAtomic','claimEnv'],write),
  tool('merchant_research_commerce_purchase_execute',
   'Execute the original approved Buyer request bound to preparedSha256. Retain both the merchant operationId and exact native requestId. The same native approval, payment budget and recipient binding govern purchase; use the purchase state to read its actual execution ID.',
   purchase,['workspace','operationId','id','requestId','preparedSha256'],write),
  tool('merchant_research_commerce_purchase_retrieve',
   'Retrieve the complete paid file from the same original Buyer execution. Verifies the complete compressed archive hash and the exact native delivery/member selection before exposing customer receiving. Reuses the original paid capture and its retained file.',
   purchase,['workspace','operationId','id','requestId','preparedSha256'],write),
  tool('merchant_research_commerce_purchase_recover',
   'Continue the original Buyer recovery action for this exact prepared request. It operates the existing execution/payment journal and original paid-file capture; merchant resume separately reopens the same retained tool request.',
   purchase,['workspace','operationId','id','requestId','preparedSha256'],write),
  tool('merchant_research_commerce_purchase_finalize',
   'Finalize the same original Buyer request using the reviewed preparedSha256 and a retained native requestId. The original Buyer action decides the valid current transition and preserves its original journal.',
   purchase,['workspace','operationId','id','requestId','preparedSha256'],write),
  tool('merchant_research_commerce_purchase_cancel',
   'Cancel the actual original Buyer execution using its executionId, original preparedSha256 and a distinct retained native requestId. This call reaches that execution while another tool is awaiting execute; use a different merchant operationId for cancellation.',
   {...purchase,executionId:uuid},
   ['workspace','operationId','id','requestId','preparedSha256','executionId'],write),
  tool('merchant_research_commerce_purchase_reconcile',
   'Reconcile one actual original Buyer request/result after an interrupted response. Preserve nativeRequestId and, when the original journal supplies it, nativeId. The native Buyer ledger remains the authority for this existing purchase.',
   {...operation,id:uuid,requestId:uuid,nativeRequestId:uuid,nativeId:recordId},
   ['workspace','operationId','id','requestId','nativeRequestId'],write),
  tool('merchant_research_commerce_purchase_receive_dossier',
   'Receive the complete verified paid archive into the original editable Research workspace. Restores original dossier identity/history, selected full native records, frozen four-format reports, saved work and optional source workspace. The same receiving request reopens its result after later customer correction.',
   {...purchase,sourceActor:{type:'string',minLength:1,maxLength:200}},
   ['workspace','operationId','id','requestId','preparedSha256'],write),
 ];
}
