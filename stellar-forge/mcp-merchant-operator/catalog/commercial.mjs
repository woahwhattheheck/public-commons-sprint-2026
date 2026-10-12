import {commercialReceivingTools} from './commercial-receiving.mjs';
// MIT. Quotation controls use the configured original SF74 case writer.
import {MAX_MATERIAL_BYTES} from '../../../stellar/scf-starforge-20261009/sf74-merchant-support-console/commissioning.mjs';
import {MAX_RETAINED_CHUNK_BYTES} from '../retained-file-contracts.mjs';
const uuid={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'};
const digest={type:'string',pattern:'^[a-f0-9]{64}$'};
const text=maxLength=>({type:'string',maxLength});
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const nullable=value=>({anyOf:[value,{type:'null'}]});
const rows=items=>({type:'array',maxItems:500,items});
const draft=object({parentId:nullable(uuid),title:text(400),customer:object({name:text(500),contact:text(2000)}),
  currency:{const:'USD'},implementationSourceId:text(200),serviceSourceId:text(200),pricingSourceId:text(200),validThrough:text(10),
  implementation:object({lines:rows(object({id:text(200),taskId:nullable(text(200)),title:text(2400),hours:text(40),rateUsd:text(40)}))}),
  service:object({period:{const:'MONTH'},lines:rows(object({id:text(200),commitmentId:nullable(text(200)),title:text(2400),quantity:text(40),unitUsd:text(40)}))}),
  pricing:object({routes:rows(object({routeId:text(200),monthlyRequests:text(24)}))}),
  terms:object({scope:text(64000),deliverables:text(64000),exclusions:text(64000),payment:text(64000),acceptance:text(64000)}),
  notes:text(16000)});
const selected={id:uuid,expectedRevision:digest},change={...selected,requestId:uuid,actor:text(200)};
export function commercialTools(tool) {
  const read={readOnly:true,idempotent:true},write={idempotent:true};
  return [
    ...commercialReceivingTools(tool),
    tool('merchant_case_commercial','Open the complete original saved quotation workspace: implementation editions, service terms, received SF97 pricing sources, unfinished draft, immutable quotes and actual customer responses. Keep its current case revision for a new change.',
      {id:uuid,revision:digest},['id'],read),
    tool('merchant_case_commercial_preview','Review explicit work hours, service fees and monthly route requests against the retained original sources. Returns exact decimal calculations, a customer-readable proposal and reviewSha256. No case write.',
      {...selected,draft},['id','expectedRevision','draft'],read),
    tool('merchant_case_commercial_save_draft','Retain the complete unfinished quotation as an original implementation material. Keep requestId, actor, original case revision and exact draft across an interrupted reply; the original event replays after later edits.',
      {...change,draft},['id','expectedRevision','requestId','actor','draft'],write),
    tool('merchant_case_commercial_publish','Save an immutable quote edition from the exact reviewed draft and source bindings. A revision names its original parent. Customer acceptance is a separate recorded response.',
      {...change,draft,reviewSha256:digest,parentId:nullable(uuid)},['id','expectedRevision','requestId','actor','draft','reviewSha256'],write),
    tool('merchant_case_commercial_receive_pricing','Receive all five exact source files exported from an existing original SF97 saved plan. The source reproduces the native scenario review and binds its original save request. Retain the complete sourceText, sourceSha256 and same request UUID after a lost reply.',
      {...change,sourceText:text(MAX_MATERIAL_BYTES),sourceSha256:digest},
      ['id','expectedRevision','requestId','actor','sourceText','sourceSha256'],write),
    tool('merchant_case_commercial_receive','Record an actual customer acceptance, requested revision or decline for the exact immutable quotation bytes. Include the original response time and source reference. This preserves the implementation and service receiving states.',
      {...change,quoteId:uuid,quoteSha256:digest,status:{enum:['ACCEPTED','REVISION_REQUESTED','DECLINED']},
        observedAt:text(24),source:text(4096),note:text(16000)},
      ['id','expectedRevision','requestId','actor','quoteId','quoteSha256','status','observedAt','source'],write),
    tool('merchant_case_commercial_compare','Compare two retained quote editions, exact decimal amounts, original source bindings, customer terms and their recorded responses.',
      {...selected,beforeId:uuid,afterId:uuid},['id','expectedRevision','beforeId','afterId'],read),
    tool('merchant_case_commercial_file','Read a complete retained customer Markdown or machine quotation through the original bounded file reader. The exact saved case revision reopens after later edits. Continue with readId, expectedSha256 and nextOffset; cold reopen uses the same selection and expectedSha256. Use merchant_case_export for the complete case.',
      {id:uuid,revision:digest,quoteId:uuid,quoteSha256:digest,kind:{enum:['QUOTE','QUOTE_JSON']},
        readId:uuid,expectedSha256:digest,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES}},
      ['id','revision','quoteId','quoteSha256','kind'],read),
    tool('merchant_case_commercial_file_reads','List current original quotation file reads for this case, including exact descriptors and continuation IDs.',
      {id:uuid},['id'],read),
    tool('merchant_case_commercial_file_release','Close an original quotation file read after partial receiving. The immutable quote stays in the saved case for later reopen.',
      {id:uuid,readId:uuid},['id','readId'],write),
  ];
}
