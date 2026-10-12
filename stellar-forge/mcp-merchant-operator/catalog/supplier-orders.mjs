// MIT. Metadata for the original configured supplier-order workspace.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

export const supplierOrderAlias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
export const supplierOrderRecordId={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$'};
export const supplierOrderBusinessId={type:'string',minLength:1,maxLength:21};
export const supplierOrderHash={type:'string',pattern:'^[0-9a-f]{64}$'};
export const supplierOrderRevision={type:'integer',minimum:1};
export const supplierOrderObject={type:'object',additionalProperties:true};
export const supplierOrderRevisions={type:'object',additionalProperties:{type:'integer',minimum:0}};
export const supplierOrderRounding={type:['null','object'],properties:{scale:{type:'integer',minimum:0,maximum:100},mode:{type:'string',enum:['half-up','half-even','toward-zero']},taxBasis:{type:'string',enum:['line','document']}},required:['scale','mode'],additionalProperties:false};
const offset={type:'integer',minimum:0},limit={type:'integer',minimum:1,maximum:100};
const orderIds={type:'array',items:supplierOrderBusinessId,minItems:1,maxItems:10000,uniqueItems:true};
const kind={type:'string',enum:['ORDER','ORDERRESPONSE','DISPATCHNOTIFICATION','INVOICE']};
const draftKind={type:'string',enum:['ORDERRESPONSE','DISPATCHNOTIFICATION','INVOICE']};
const reason={type:'string',minLength:1,maxLength:4000};
const draftFields={draftId:supplierOrderRecordId,expectedRevision:supplierOrderRevision,kind:draftKind,orderIds,
  expectedOrderRevisions:supplierOrderRevisions,sourceOrderDocuments:{type:'array',items:{type:'object',properties:{orderId:supplierOrderBusinessId,id:supplierOrderRecordId,sha256:supplierOrderHash},required:['orderId','id','sha256'],additionalProperties:false},minItems:1,maxItems:10000},expectedOrderStateSha256:{type:'object',additionalProperties:supplierOrderHash},
  document:supplierOrderObject,reason,title:{type:'string',minLength:1,maxLength:240},roundingPolicy:supplierOrderRounding};

export function supplierOrderTools(tool){
  const read={readOnly:true,idempotent:true},write={idempotent:true},fields=value=>({workspace:supplierOrderAlias,...value});
  return[
    tool('merchant_supplier_order_status','Inspect configured original supplier-order aliases and already-opened handles. This does not open a workspace.',fields({}),[],read),
    tool('merchant_supplier_order_open','Open the existing original supplier-order workspace selected by its host alias.',fields({}),['workspace'],write),
    tool('merchant_supplier_order_close','Drain this process’s accepted work and retained file reads, then close its original workspace handle.',fields({}),['workspace'],write),
    tool('merchant_supplier_order_inputs','List complete host-selected original XML, customer-package and draft-input identities without exposing host paths.',fields({}),['workspace'],read),
    tool('merchant_supplier_order_state','Inspect the original workspace state, current order revisions and saved draft summaries. Larger collections can be read through paged methods.',fields({}),['workspace'],read),
    tool('merchant_supplier_order_orders','Page original orders with exact business IDs and current reconciliation status.',fields({query:{type:'string',maxLength:2000},status:{type:'string',enum:['AWAITING_CONFIRMATION','IN_PROGRESS','REVIEW','COMPLETE']},offset,limit}),['workspace'],read),
    tool('merchant_supplier_order_order','Read one complete original order and its current selected document contributions. Original business IDs may contain punctuation.',fields({orderId:supplierOrderBusinessId}),['workspace','orderId'],read),
    tool('merchant_supplier_order_order_items','Page complete reconciled original order lines, quantities, packages, serials and selected document references.',fields({orderId:supplierOrderBusinessId,offset,limit}),['workspace','orderId'],read),
    tool('merchant_supplier_order_order_history','Page the original order revision and explicit document-selection history.',fields({orderId:supplierOrderBusinessId,offset,limit}),['workspace','orderId'],read),
    tool('merchant_supplier_order_documents','Page original immutable document records. Direct document reads and original file downloads retain full content.',fields({orderId:supplierOrderBusinessId,kind,offset,limit}),['workspace'],read),
    tool('merchant_supplier_order_document','Read the complete normalized source document, original XML tree and saved review.',fields({id:supplierOrderRecordId}),['workspace','id'],read),
    tool('merchant_supplier_order_document_lines','Page full original normalized document lines, including order/delivery references and original numeric strings.',fields({id:supplierOrderRecordId,offset,limit}),['workspace','id'],read),
    tool('merchant_supplier_order_drafts','Page saved working drafts for all orders or one original business order.',fields({orderId:supplierOrderBusinessId,offset,limit}),['workspace'],read),
    tool('merchant_supplier_order_draft','Read the complete saved working draft and its original order/source lineage.',fields({draftId:supplierOrderRecordId}),['workspace','draftId'],read),
    tool('merchant_supplier_order_draft_lines','Page full lines in the selected saved draft without changing its revision.',fields({draftId:supplierOrderRecordId,offset,limit}),['workspace','draftId'],read),
    tool('merchant_supplier_order_new_draft','Create an editable full confirmation, dispatch or invoice from actual current orders. Compatible orders may share a dispatch/invoice; this read does not save a revision.',fields({kind:draftKind,orderIds}),['workspace','kind','orderIds'],read),
    tool('merchant_supplier_order_save_draft','Save a complete reasoned draft revision in the original request journal. Retain requestId, exact numeric strings, current order revisions and original source lineage.',fields({requestId:supplierOrderRecordId,...draftFields}),['workspace','requestId','kind','orderIds','document','reason','expectedOrderRevisions','sourceOrderDocuments','expectedOrderStateSha256'],write),
    tool('merchant_supplier_order_save_draft_input','Save the complete native draft request selected by a pinned host JSON input. The input contains original saveDraft fields; requestId is supplied here and must match if retained in that input.',fields({requestId:supplierOrderRecordId,inputId:supplierOrderAlias}),['workspace','requestId','inputId'],write),
    tool('merchant_supplier_order_prepare','Prepare complete original openTRANS XML from the selected saved draft revision. The output remains an immutable document until explicitly selected.',fields({requestId:supplierOrderRecordId,draftId:supplierOrderRecordId,expectedRevision:supplierOrderRevision}),['workspace','requestId','draftId','expectedRevision'],write),
    tool('merchant_supplier_order_select','Select one immutable document revision for the original order’s current reconciliation. Retain the expected order revision and the reason.',fields({requestId:supplierOrderRecordId,id:supplierOrderRecordId,orderId:supplierOrderBusinessId,expectedOrderRevision:supplierOrderRevision,reason}),['workspace','requestId','id','orderId','expectedOrderRevision','reason'],write),
    tool('merchant_supplier_order_receive','Receive exact original XML from a host-selected input into the same document store and request journal. Known current orders require their reviewed revision pins.',fields({requestId:supplierOrderRecordId,inputId:supplierOrderAlias,selection:{type:'string',enum:['current','history']},expectedOrderRevisions:supplierOrderRevisions,expectedOrderRevision:{type:'integer',minimum:0}}),['workspace','requestId','inputId','selection'],write),
    tool('merchant_supplier_order_receive_workspace','Inspect or merge a complete original customer package selected by a host input. Merge preserves current customer heads and retains incoming history.',fields({requestId:supplierOrderRecordId,inputId:supplierOrderAlias,mode:{type:'string',enum:['inspect','merge']}}),['workspace','requestId','inputId','mode'],write),
    tool('merchant_supplier_order_export_workspace','Retain one complete original customer ZIP through the native workspace exporter. Reuse this requestId after an interrupted response.',fields({requestId:supplierOrderRecordId}),['workspace','requestId'],write),
    tool('merchant_supplier_order_operation','Reopen the original durable operation by the same requestId, including its failure or completed result. Large responses keep exact operation identity and expose full-result retention.',fields({requestId:supplierOrderRecordId,includeRequest:{type:'boolean'}}),['workspace','requestId'],read),
    tool('merchant_supplier_order_export_manifest','Inspect the deterministic complete retained-file manifest for an original XML or customer ZIP file ID.',fields({exportId:supplierOrderRecordId}),['workspace','exportId'],read),
    tool('merchant_supplier_order_export_file','Read exact original manifest or file bytes through the maintained retained-file reader. Keep readId, SHA-256 and byte offset for continuation.',fields({exportId:supplierOrderRecordId,file:{type:'string',minLength:1,maxLength:512},expectedManifestSha256:supplierOrderHash,expectedSha256:supplierOrderHash,readId:{type:'string',minLength:1,maxLength:160},offset,limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES}}),['workspace','exportId','file','expectedManifestSha256','expectedSha256'],read),
    tool('merchant_supplier_order_export_file_release','Release the original retained read handle when a complete download is interrupted or no longer needed.',fields({exportId:supplierOrderRecordId,readId:{type:'string',minLength:1,maxLength:160}}),['workspace','exportId','readId'],write)
  ];
}
