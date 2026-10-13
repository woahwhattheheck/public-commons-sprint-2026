// SPDX-License-Identifier: MIT
const string=(maxLength=4000)=>({type:'string',minLength:1,maxLength});
const id={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$'},alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'},hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const bound={workspace:alias,instanceId:string(80)},required=['workspace','instanceId'],read={idempotent:true,readOnly:true};
export const ACTION_TOOLS=Object.freeze({merchant_gleif_capture:'capture',merchant_gleif_resume_capture:'capture.resume',merchant_gleif_import_source:'source.import',merchant_gleif_review:'review.save',
  merchant_gleif_review_batch:'review.batch',merchant_gleif_report:'report.prepare',merchant_gleif_dataset:'dataset.prepare',merchant_gleif_monitoring:'monitoring.prepare'});
export function gleifMerchantTools(tool) {
  const result=[
    tool('merchant_gleif_workspaces','List configured company research projects.',{},[],read),
    tool('merchant_gleif_connect','Connect to the existing project and retain its current instance identity.',{workspace:alias},['workspace'],{idempotent:true}),
    tool('merchant_gleif_disconnect','Close this client connection.',bound,required,{idempotent:true}),
    tool('merchant_gleif_status','Read saved source editions, shortlists, reports, datasets and operation history.',bound,required,read),
    tool('merchant_gleif_rows','Read a page of original company records and current source-specific review.',{...bound,captureId:id,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:250},search:string(500)},[...required,'captureId'],read),
    tool('merchant_gleif_compare','Compare two complete original editions of the same source query.',{...bound,before:id,after:id},[...required,'before','after'],read),
    tool('merchant_gleif_monitoring_preview','Review the exact original company-to-LegalEntity mapping without preparing or dispatching.',{...bound,...{title:string(160),portfolioKey:string(128),captureIds:{type:'array',items:id,minItems:1,maxItems:1},selection:{enum:['all','included']},fields:{type:'array',uniqueItems:true,items:{enum:['aliases','registrationNumber','entityStatus','addresses']}}}},[...required,'title','portfolioKey','captureIds','selection','fields'],read),
    tool('merchant_gleif_operation','Read the original request and outcome after an uncertain response.',{...bound,id},[...required,'id'],read),
    tool('merchant_gleif_resume','Resume a saved operation with its unchanged original input.',{...bound,id},[...required,'id'],{idempotent:true}),
    tool('merchant_gleif_pause','Pause source acquisition and retain its completed pages.',{...bound,id},[...required,'id'],{idempotent:true}),
    tool('merchant_gleif_query','Query the original retained native SF30 dataset.',{...bound,id,query:string(8192)},[...required,'id'],read),
    tool('merchant_gleif_project_file','Prepare the complete project JSON file for chunked independent receiving.',bound,required,{idempotent:true}),
    tool('merchant_gleif_file','Read exact original file bytes by immutable hash and byte offset.',{...bound,sha256:hash,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:65536}},[...required,'sha256'],read)
  ];
  const specs={
    merchant_gleif_resume_capture:{description:'Continue the next original pages of an imported or paused source capture.',properties:{captureId:id},required:['captureId']},
    merchant_gleif_capture:{description:'Capture all official pages for an exact LEI or legal-name search; preserve this request ID for recovery.',properties:{plan:{type:'object',properties:{kind:{enum:['name','lei']},query:string(500),pageSize:{type:'integer',minimum:1,maximum:100},country:string(2),entityStatus:string(64),registrationStatus:string(64)},required:['kind','query']}},required:['plan']},
    merchant_gleif_import_source:{description:'Receive already acquired original source response envelopes without repeating acquisition.',properties:{plan:{type:'object'},pages:{type:'array',minItems:1,items:{type:'object',properties:{url:string(16000),observedAt:string(100),status:{enum:[200,null]},headers:{type:['object','null']},acquisition:{type:'object'},body:string(16777216)},required:['url','observedAt','status','body']}}},required:['plan','pages']},
    merchant_gleif_review:{description:'Save a source-bound company shortlist decision with reviewer, rationale and next research work.',properties:{id,title:string(200),captureId:id,lei:string(20),expectedVersion:{type:'integer',minimum:0},decision:{enum:['include','exclude','research']},reviewer:string(200),rationale:{type:'string',maxLength:8000},useCase:{type:'string',maxLength:4000},nextWork:{type:'string',maxLength:4000}},required:['id','title','captureId','lei','expectedVersion','decision','reviewer','rationale']},
    merchant_gleif_review_batch:{description:'Save the complete selected set of company reviews together against their original versions.',properties:{items:{type:'array',minItems:1,items:{type:'object'}}},required:['items']},
    merchant_gleif_report:{description:'Produce the complete selected company report, original records, CSV and JSONL.',properties:{title:string(200),captureIds:{type:'array',items:id,minItems:1,uniqueItems:true},selection:{enum:['all','included']},compare:{type:'object',properties:{before:id,after:id},required:['before','after']}},required:['title','captureIds','selection']},
    merchant_gleif_monitoring:{description:'Prepare the complete reviewed source, editable project and original Monitoring portfolio handover.',properties:{...{title:string(160),portfolioKey:string(128),captureIds:{type:'array',items:id,minItems:1,maxItems:1},selection:{enum:['all','included']},fields:{type:'array',uniqueItems:true,items:{enum:['aliases','registrationNumber','entityStatus','addresses']}}},expectedPreviewSha256:hash},required:['title','portfolioKey','captureIds','selection','fields','expectedPreviewSha256']},
    merchant_gleif_dataset:{description:'Prepare the original SF30 CSV dataset from the complete selected company records.',properties:{name:string(128),captureIds:{type:'array',items:id,minItems:1,uniqueItems:true},selection:{enum:['all','included']}},required:['name','captureIds','selection']}
  };
  for(const[name,spec]of Object.entries(specs))result.push(tool(name,spec.description,{...bound,requestId:id,expectedRevision:{type:'integer',minimum:0},...spec.properties},[...required,'requestId',...spec.required],{idempotent:true,...(name==='merchant_gleif_capture'?{openWorld:true}:{})}));
  return result;
}
