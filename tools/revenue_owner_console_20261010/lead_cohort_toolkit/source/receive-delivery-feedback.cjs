'use strict';
/** Complete original delivery reports joined to one retained customer programme. */
const defaultCore=require('../runtime/tools/revenue_owner_console_20261010/lead_fulfillment_core.cjs');
const portable=require('../runtime/tools/revenue_owner_console_20261010/lead_delivery_portable_gmail.cjs');
const recorder=require('./delivery-recorder.cjs');
const hashes=require('../runtime/host/connected_sha256.cjs');
const renderer=require('./customer-renderer.cjs');
const markdown=require('./customer-markdown.cjs');
const json=value=>JSON.stringify(value,null,2)+'\n';
function receiveFeedback(original,input,{binaries={},core=defaultCore,customerRenderer=renderer,customerMarkdown=markdown}={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Supply a complete original feedback request');
 const allowed=['operation_id','recorded_at','mailbox','pack_id','reports','sent_messages','history_path'];
 if(Object.keys(input).some(k=>!allowed.includes(k)))throw Error('Unknown original feedback request field');
 if(typeof input.operation_id!=='string'||!input.operation_id.trim())throw Error('Retain one original operation_id');
 if(typeof input.recorded_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(input.recorded_at)||!Number.isFinite(Date.parse(input.recorded_at)))throw Error('Retain the original UTC recorded_at');
 const files={...original},gmail=portable.createPortableGmail({core}),coreOptions={deliveryFeedback:gmail.feedback.previewLeadDeliveryFeedback};
 const deps={core,renderer:customerRenderer,markdown:customerMarkdown,hash:hashes.sha256Utf8,binaries,coreOptions};
 recorder.verifyReceipts(files,deps);
 const before=recorder.replay(files,core,input.history_path,coreOptions);
 if(input.pack_id!==before.record.pack.id)throw Error('Select the same original customer programme');
 const source={mailbox:input.mailbox,pack_id:input.pack_id,reports:input.reports,sent_messages:input.sent_messages??[]};
 const previous=before.operations.find(op=>op.body.operation_id===input.operation_id);
 if(previous&&(previous.body.kind!=='delivery-feedback-receive'||core.hash(previous.body.input)!==core.hash(source)||previous.at!==input.recorded_at))throw Error('The original feedback operation already selects different work');
 const preview=gmail.feedback.previewLeadDeliveryFeedback(before.ledger,source);
 if(!preview.feedback.length||preview.unmatched.length||preview.review.some(row=>row.requires_review!==false))throw Object.assign(Error('Resolve the concrete original-message association before receiving this report'),{preview});
 if(preview.feedback.some(row=>Date.parse(row.occurred_at)>Date.parse(input.recorded_at)))throw Error('Recording cannot precede the actual report');
 const body=previous?.body??{operation_id:input.operation_id,kind:'delivery-feedback-receive',expected_root_sha256:core.leadFulfillmentState(before.ledger).root_sha256,input:source};
 const applied=core.applyLeadFulfillment(before.ledger,body,input.recorded_at,coreOptions);
 const operations=previous?before.operations:[...before.operations,{body,at:input.recorded_at}];
 const record=core.leadFulfillmentExport(applied.ledger,{packId:input.pack_id,format:'working-record'}).value;
 const path='internal/delivery-status/'+hashes.sha256Utf8(json(input)).sha256+'.json';
 if(files[path]!==undefined&&files[path]!==json(input))throw Error('Original feedback source collision');
 files[path]=json(input);files['internal/working-record.json']=json(record);files[before.history_path]=json(operations);
 recorder.verifyReceipts(files,deps);const customer_files=recorder.exportedFiles(files,record,deps);
 return {files,record,operations,history_path:before.history_path,source_path:path,preview,
   received:!previous,customer_files,delivery_states:core.leadFulfillmentState(applied.ledger,{packId:input.pack_id}).selected.delivery_states};
}
module.exports={receiveFeedback};
