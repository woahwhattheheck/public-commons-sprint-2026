// MIT. ClinicalTrials Research metadata for the original source-owned provider catalog.
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const digest={type:'string',pattern:'^[a-f0-9]{64}$'};
const dossierId={type:'string',pattern:'^d_[a-f0-9-]{36}$'};
const questionId={type:'string',pattern:'^q_[a-f0-9-]{36}$'};
const operationId={type:'string',pattern:'^ct_[a-f0-9]{64}$'};
const sourceId={type:'string',pattern:'^ctsrc_[a-f0-9]{64}$'};
const editionId={type:'string',pattern:'^e_[a-f0-9]{64}$'};
const revision={type:'integer',minimum:1,maximum:99999999};
const offset={type:'integer',minimum:0},limit={type:'integer',minimum:1,maximum:200};
const dossier={workspace:alias,dossierId},operation={...dossier,operationId},retained={...dossier,editionId};
const read={readOnly:true,idempotent:true};
const values={type:'array',maxItems:200,items:{type:['string','null']}};
export const RESEARCH_CLINICALTRIALS_CRITERIA=Object.freeze({
  type:'object',additionalProperties:false,properties:{
    statuses:values,studyTypes:values,
    phaseKeys:{type:'array',maxItems:200,items:{type:'string'}},
    conditions:values,sponsors:values,
    resultsFlags:{type:'array',maxItems:3,items:{type:['boolean','null']}},
    hasResultsSections:{type:['boolean','null']},
    query:{type:'string',maxLength:2000}
  }
});
export const RESEARCH_CLINICALTRIALS_EXPORTS=Object.freeze({
  'clinicaltrials-edition':{extension:'json'},
  'clinicaltrials-input-packet':{extension:'zip'},
  'clinicaltrials-retained-edition':{extension:'json'},
  'clinicaltrials-retained-packet':{extension:'zip'},
  'clinicaltrials-analysis-csv':{extension:'csv',clinicalFormat:'csv'},
  'clinicaltrials-analysis-json':{extension:'json',clinicalFormat:'json'},
  'clinicaltrials-analysis-html':{extension:'html',clinicalFormat:'html'},
  'clinicaltrials-analysis-markdown':{extension:'md',clinicalFormat:'md'}
});
export function researchClinicalTrialsTools(tool){
  return [
    tool('merchant_research_clinicaltrials_inputs','Page complete ClinicalTrials packets already retained by the original Research listener. Each source keeps its original packet hash, capture coverage and available cohort IDs.',{
      ...dossier,after:sourceId,limit:{type:'integer',minimum:1,maximum:100}},['workspace','dossierId'],read),
    tool('merchant_research_clinicaltrials_input','Read one original retained packet and its complete capture/source identity before preparing local receiving.',{
      ...dossier,sourceId},['workspace','dossierId','sourceId'],read),
    tool('merchant_research_clinicaltrials_import_packet','Stream one host-declared clinicaltrials-packet source with its exact SHA256 into the existing Research listener. Reuses the original content-addressed packet receiver and leaves every original Clinical capture and review intact.',{
      ...dossier,source:alias},['workspace','dossierId','source'],{idempotent:true}),
    tool('merchant_research_clinicaltrials_prepare','Prepare the original saved cohort under a research question using the current dossier revision. Reuse requestId after uncertainty; review the same immutable plan hash and full capture before start. allowPartial is an explicit choice recorded by the native receiver.',{
      ...dossier,requestId:{type:'string',pattern:'^[A-Za-z0-9_-]{8,100}$'},questionId,expectedRevision:revision,
      sourceId,captureId:{type:'string',minLength:1,maxLength:160},
      label:{type:'string',minLength:1,maxLength:200},allowPartial:{type:'boolean',default:false}},
      ['workspace','dossierId','requestId','questionId','expectedRevision','sourceId','captureId'],{idempotent:true}),
    tool('merchant_research_clinicaltrials_operations','Page the original local ClinicalTrials receiving operations and retained phases. Use the returned original operation ID for review, start, stop and receive.',{
      ...dossier,after:operationId,limit:{type:'integer',minimum:1,maximum:100}},['workspace','dossierId'],read),
    tool('merchant_research_clinicaltrials_review','Read the original plan/source binding, current receiving phase, complete cohort counts and a page of original study metadata. Source pages and complete edition identity remain native.',{
      ...operation,offset,limit},['workspace','dossierId','operationId'],read),
    tool('merchant_research_clinicaltrials_start','Start or resume the same reviewed local packet receiving operation with its exact plan SHA256. The original worker reuses retained source; this does not request another registry capture.',{
      ...operation,expectedPlanSha256:digest},['workspace','dossierId','operationId','expectedPlanSha256'],{idempotent:true}),
    tool('merchant_research_clinicaltrials_stop','Stop the original local receiving worker and retain its plan, packet and completed edition for same-operation continuation.',operation,
      ['workspace','dossierId','operationId'],{idempotent:true}),
    tool('merchant_research_clinicaltrials_receive','Receive the reviewed native edition into its original question with exact plan hash, edition hash and current dossier revision. The original receiver reconciles a committed response that was lost.',{
      ...operation,expectedPlanSha256:digest,expectedEditionSha256:digest,expectedRevision:revision},
      ['workspace','dossierId','operationId','expectedPlanSha256','expectedEditionSha256','expectedRevision'],{idempotent:true}),
    tool('merchant_research_clinicaltrials_record','Read one complete original study occurrence, including full nested protocol/results and its retained page/record identity, from the selected native receiving edition.',{
      ...operation,index:offset},['workspace','dossierId','operationId','index'],read),
    tool('merchant_research_clinicaltrials_compare','Compare two original receiving editions under the same research question. Preserves retained source hashes and every added, removed or changed study occurrence.',{
      ...operation,beforeOperationId:operationId},['workspace','dossierId','operationId','beforeOperationId'],read),
    tool('merchant_research_clinicaltrials_retained','List ClinicalTrials editions already received into the original dossier with their source and question references.',dossier,['workspace','dossierId'],read),
    tool('merchant_research_clinicaltrials_retained_review','Read a page from the complete source-linked ClinicalTrials edition after receiving or portable dossier reopen.',{
      ...retained,offset,limit},['workspace','dossierId','editionId'],read),
    tool('merchant_research_clinicaltrials_retained_record','Read one complete original study occurrence through the dossier retained-edition reader after receiving or portable reopen.',{
      ...retained,index:offset},['workspace','dossierId','editionId','index'],read),
    tool('merchant_research_clinicaltrials_compare_retained','Compare two original source-linked ClinicalTrials editions retained under the same dossier/question after receiving or reopen.',{
      ...dossier,beforeEditionId:editionId,afterEditionId:editionId},['workspace','dossierId','beforeEditionId','afterEditionId'],read),
    tool('merchant_research_clinicaltrials_analysis','Review descriptive groups, source denominators, repeated occurrences and a page of the selected original study cohort. Criteria retain typed true/false/null values, exact phase keys and original labels.',{
      ...operation,criteria:RESEARCH_CLINICALTRIALS_CRITERIA,offset,limit},['workspace','dossierId','operationId'],read),
    tool('merchant_research_clinicaltrials_retained_analysis','Review the same descriptive cohort through an original retained dossier edition, including after portable reopen. Filters keep capture totals and record-level source identities unchanged.',{
      ...retained,criteria:RESEARCH_CLINICALTRIALS_CRITERIA,offset,limit},['workspace','dossierId','editionId'],read)
  ];
}
