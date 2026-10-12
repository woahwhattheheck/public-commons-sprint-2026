// MIT. Transaction operations on the original USAspending workspace and job owner.
export const USASPENDING_TRANSACTION_EXPORTS=Object.freeze({
  'transaction-json': {ext:'json',type:'application/json; charset=utf-8',required:['captureId'],optional:['includeReviews']},
  'transaction-csv': {ext:'csv',type:'text/csv; charset=utf-8',required:['captureId'],optional:[]},
  'transaction-source': {ext:'json',type:'application/json; charset=utf-8',required:['captureId','page'],optional:[]},
  'transaction-source-receipt': {ext:'json',type:'application/json; charset=utf-8',required:['captureId','page'],optional:[]},
  'transaction-comparison': {ext:'json',type:'application/json; charset=utf-8',required:['before','after'],optional:[]},
  'transaction-brief': {ext:'md',type:'text/markdown; charset=utf-8',required:['captureId'],optional:[]},
});
export function usaSpendingTransactionTools(tool,{selected,nativeId,expectedRevision,page,read,digest}) {
  const awardKey={type:'string',minLength:1,maxLength:1024};
  const inCapture={...selected,captureId:nativeId};
  const sourcePage={type:'integer',minimum:1,maximum:10000000};
  const maxRows={type:'integer',minimum:1,maximum:250000};
  const date={type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'};
  const text={type:'string',maxLength:4000};
  return [
    tool('merchant_usaspending_transaction_inventory','Page original award transaction captures or workshare reviews. Filter by the original award key and retain the returned snapshot while paging.',{
      ...selected,kind:{type:'string',enum:['captures','reviews']},awardKey,...page,
    },['workspace','kind'],read),
    tool('merchant_usaspending_transaction_capture','Start the original award transaction job using editionId plus awardKey, or resume its saved captureId. These selections are mutually exclusive. Uses the same browser job owner; merchant_usaspending_job/status/pause operate that original job.',{
      ...selected,editionId:nativeId,awardKey,captureId:nativeId,pageSize:{type:'integer',minimum:1,maximum:5000},maxRows,
    },['workspace'],{openWorld:true}),
    tool('merchant_usaspending_transaction_capacity','Change a paused transaction capture capacity using its exact current updated_at. The native capture retains every accepted page and its original provider continuation.',{
      ...inCapture,maxRows,expectedUpdatedAt:{type:'string',minLength:1,maxLength:40},
    },['workspace','captureId','maxRows','expectedUpdatedAt'],{}),
    tool('merchant_usaspending_transaction_summary','Read a transaction capture, exact decimal totals, source coverage and workshare review. Page fiscal years, source conflicts or duplicate occurrences in section; complete exports preserve every record.',{
      ...inCapture,section:{type:'string',enum:['fiscal-years','conflicts','duplicates'],default:'fiscal-years'},...page,
    },['workspace','captureId'],read),
    tool('merchant_usaspending_transaction_rows','Browse the original transaction timeline and independent funding direction. Retain snapshot as expectedSnapshot after page one so a continuing capture cannot silently change the page selection.',{
      ...inCapture,search:{type:'string',maxLength:1000},startDate:date,endDate:date,
      page:{type:'integer',minimum:1,maximum:1000000},limit:{type:'integer',minimum:1,maximum:500},expectedSnapshot:digest,
    },['workspace','captureId'],read),
    tool('merchant_usaspending_transaction_compare','Compare two captures of the same original award. Page added, changed, absent or unresolved transaction IDs and either source-conflict list; exact decimal deltas and both capture coverages retain their native semantics.',{
      ...selected,before:nativeId,after:nativeId,
      section:{type:'string',enum:['added','changed','absent_in_later_capture','unresolved','before-conflicts','after-conflicts'],default:'changed'},...page,
    },['workspace','before','after'],read),
    tool('merchant_usaspending_transaction_review_save','Save the full transaction workshare assessment against the completed original source fingerprint and current review revision. Scope-match and owner-review stages require fit, workshare, deliverables and acceptance.',{
      ...inCapture,expectedRevision,review:{type:'object',additionalProperties:false,required:['status'],properties:{
        status:{type:'string',enum:['researching','scope_match','review_with_owner','passed']},
        fit:text,fundingChange:text,proposedWorkshare:text,deliverables:text,acceptance:text,owner:text,caseUrl:text,nextAction:text,
        notes:{type:'string',maxLength:12000},
      }},
    },['workspace','captureId','expectedRevision','review'],{}),
    tool('merchant_usaspending_transaction_source','Inspect the original transaction request, HTTP receipt, observation time, response size and response SHA256. Use export kind=transaction-source and the existing file reader to receive the complete original response bytes.',{
      ...inCapture,page:sourcePage,
    },['workspace','captureId','page'],read),
  ];
}
