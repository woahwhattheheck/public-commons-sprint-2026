// MIT. Complete service case operator contract; original SF74/SF93 modules execute.
const uuid={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'};
const digest={type:'string',pattern:'^[a-f0-9]{64}$'};
const alias={type:'string',pattern:'^[A-Za-z0-9_-]{1,64}$'};
const text=maxLength=>({type:'string',maxLength});
const integer=(minimum=0,maximum=Number.MAX_SAFE_INTEGER)=>({type:'integer',minimum,maximum});
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const nullable=value=>({anyOf:[value,{type:'null'}]});
const utc={type:'string',pattern:'^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d\\.\\d{3}Z$'};
const date={type:'string',pattern:'^\\d{4}-\\d\\d-\\d\\d$'};
const windows={type:'array',maxItems:12,items:object({start:text(5),end:text(5)})};
const calendar=object({mode:{enum:['always','business']},timeZone:text(100),
  week:{type:'array',maxItems:7,items:object({day:integer(1,7),windows})},
  exceptions:{type:'array',maxItems:1000,items:object({date,windows})}});
const kinds=['ENDPOINT_UNAVAILABLE','OBSERVER_INCOMPLETE','HTTP_5XX','DISCONNECTED','DELIVERY_UNAVAILABLE','DELIVERY_BACKLOG','DELIVERY_EXHAUSTED'];
const terms=object({id:uuid,expectedRevision:nullable(integer(1)),title:text(500),customer:text(500),owner:text(240),reference:text(4000),
  status:{enum:['proposed','active','ended']},incidentSourceId:alias,merchantId:alias,merchantBinding:digest,
  effectiveFrom:utc,effectiveUntil:nullable(utc),calendar,
  targets:{type:'array',minItems:1,maxItems:7,items:object({kind:{enum:kinds},responseMinutes:integer(1,527040),recoveryMinutes:integer(1,527040)})},
  reviewedBy:text(240),note:text(8000)});
const capture=object({incidentSource:{type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'},merchantId:alias,
  expectedSourceRevision:integer(1),expectedConfigHash:digest,expectedMerchantBinding:digest},
  ['merchantId','expectedSourceRevision','expectedConfigHash','expectedMerchantBinding']);
const exclusion=object({id:uuid,incidentId:uuid,captureSha256:digest,from:utc,through:utc,
  scope:{enum:['response','recovery','both']},reason:text(4000),reference:text(4000),reviewedBy:text(240)});
const selection=object({termsId:uuid,termsRevision:integer(1),from:date,through:date,asOf:utc,
  captureSha256s:{type:'array',minItems:1,maxItems:1000,items:digest},
  exclusionIds:{type:'array',maxItems:1000,items:uuid}});
const report=object({...selection.properties,expectedPreviewSha256:digest,reviewedBy:text(240),note:text(8000)});
export function serviceTools(tool){
  const read={readOnly:true,idempotent:true};
  return [
    tool('merchant_support_service_snapshot','Read one complete original merchant incident history in its configured SF93 store transaction. Includes current or retired registration, source/config revisions and exact merchant binding for the next capture. Starts no watcher.',
      {incidentSource:capture.properties.incidentSource,merchantId:alias},['merchantId'],read),
    tool('merchant_service_read','Read the original saved case service summary or page through terms, captures, exclusions, reports and operator changes. recordId returns the complete selected original record; use its SHA to select one terms edition. Complete case exports preserve every source and unfinished form.',
      {id:uuid,revision:digest,section:{enum:['summary','terms','captures','exclusions','reports','operations']},
        recordId:text(64),offset:integer(),limit:integer(1,100)},['id'],read),
    tool('merchant_service_change','Save a reviewed service change through the original case writer. action selects terms, capture, exclusion or report and the matching input object. Capture guards the inspected source/config/merchant binding. Retain the same requestId, expectedRevision and input after a lost response; exact replay returns the original result even after later case changes.',
      {id:uuid,expectedRevision:digest,requestId:uuid,action:{enum:['terms','capture','exclusion','report']},
        input:{anyOf:[terms,capture,exclusion,report]}},
      ['id','expectedRevision','requestId','action','input'],{idempotent:true}),
    tool('merchant_service_preview','Calculate a complete service report from an exact current case, terms history, selected original incident captures, named calendar and explicitly reviewed exclusions. Its previewSha256 binds the subsequent retained report.',
      {id:uuid,expectedRevision:digest,selection},['id','expectedRevision','selection'],read),
    tool('merchant_service_report','Render one retained original service report as complete JSON, incident CSV or printable HTML. Returns exact UTF-8 bytes/hash and filename; original reports and all selected sources stay in the case export.',
      {id:uuid,revision:digest,reportId:uuid,format:{enum:['json','csv','html']}},['id','reportId'],read)
  ];
}
