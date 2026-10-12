// MIT. Documents and managed Pipelines in the original Research tool catalog.
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const digest={type:'string',pattern:'^[a-f0-9]{64}$'};
const dossierId={type:'string',pattern:'^d_[a-f0-9-]{36}$'};
const questionId={type:'string',pattern:'^q_[a-f0-9-]{36}$'};
const purchaseId={type:'string',pattern:'^u_[a-f0-9]{64}$'};
const operationId={type:'string',pattern:'^up_[a-f0-9]{64}$'};
const outputId={type:'string',pattern:'^out_[a-f0-9]{64}$'};
const inputId={type:'string',pattern:'^in_[a-f0-9]{64}$'};
const editionId={type:'string',pattern:'^e_[a-f0-9]{64}$'};
const requestId={type:'string',minLength:1,maxLength:256};
const revision={type:'integer',minimum:0};
const label={type:'string',minLength:1,maxLength:240};
const offset={type:'integer',minimum:0},limit={type:'integer',minimum:1,maximum:100};
const dossier={workspace:alias,dossierId},operation={...dossier,operationId};
const documentSelection={...dossier,purchaseId,editionId};
const pipelineSelection={...dossier,operationId,outputId,editionId};
const action={...operation,requestId,expectedRevision:revision};
const elements={expectedEditionSha256:digest,offset,limit,page:{type:'string',maxLength:100},
  type:{type:'string',maxLength:200},query:{type:'string',maxLength:2000}};
const read={readOnly:true,idempotent:true},remote={openWorld:true,idempotent:true};
export const RESEARCH_DOCUMENT_EXPORT_FIELDS=Object.freeze({purchaseId,outputId,inputId,expectedEditionSha256:digest});
export const RESEARCH_DOCUMENT_EXPORTS=Object.freeze({
  'document-file':{extension:'bin',documentFile:'document'},
  'document-response':{extension:'json',documentFile:'response'},
  'document-edition':{extension:'json',documentFile:'edition'},
  'pipeline-input':{extension:'bin',pipelinePart:'input'},
  'pipeline-output':{extension:'bin',pipelinePart:'output'},
  'pipeline-received-output':{extension:'bin',pipelineFile:'output'},
  'pipeline-edition':{extension:'json',pipelineFile:'edition'},
});
export function researchDocumentTools(tool){
  return [
    tool('merchant_research_documents_list','Page original saved document purchases and retained dossier editions. Continue nextAfter through the original source; reads preserve the paid buyer and its saved output.',{
      ...dossier,after:purchaseId,limit},['workspace','dossierId'],read),
    tool('merchant_research_documents_review','Review the complete original document/Partition response binding, native result and retained edition. Select exactly one purchaseId or editionId.',documentSelection,
      ['workspace','dossierId'],read),
    tool('merchant_research_documents_elements','Read a page of original document elements by page, type or text. Use the reviewed complete edition hash and exactly one original purchase or retained edition.',{
      ...documentSelection,...elements},['workspace','dossierId','expectedEditionSha256'],read),
    tool('merchant_research_documents_receive','Receive the reviewed original saved document purchase under its research question. Uses the exact edition hash and dossier revision; native receiving reconciles a previously committed result.',{
      ...dossier,purchaseId,questionId,label,expectedEditionSha256:digest,expectedRevision:revision},
      ['workspace','dossierId','purchaseId','questionId','label','expectedEditionSha256','expectedRevision'],{idempotent:true}),
    tool('merchant_research_pipelines_list','Read configured managed profiles, actual source/upload limits and a page of original pipeline operations, with retained dossier editions. Continue nextAfter.',{
      ...dossier,after:operationId,limit},['workspace','dossierId'],read),
    tool('merchant_research_pipelines_prepare','Prepare a managed job from host-declared pipeline-input files. Verify every selected original file hash before streaming the same files to the existing Research receiver. Reuse requestId and all original values after a lost response.',{
      ...dossier,requestId,questionId,label,expectedRevision:revision,profileId:{type:'string',minLength:1,maxLength:128},
      inputSources:{type:'array',minItems:1,maxItems:32,items:alias}},
      ['workspace','dossierId','requestId','questionId','label','expectedRevision','profileId','inputSources'],{idempotent:true}),
    tool('merchant_research_pipelines_operation','Read the saved original pipeline plan, reviewed file hashes, current native operation revision, provider identity/status, retained output IDs and advertised output selections.',operation,
      ['workspace','dossierId','operationId'],read),
    tool('merchant_research_pipelines_submit','Submit the same reviewed saved managed operation. Supply its original action requestId, current OPERATION revision and plan hash. Interrupted replies keep that original operation for provider-job reconciliation.',{
      ...action,expectedPlanSha256:digest},['workspace','dossierId','operationId','requestId','expectedRevision','expectedPlanSha256'],remote),
    tool('merchant_research_pipelines_refresh','Observe the saved original provider job and retain its actual status/details. Supply the current OPERATION revision and a stable action requestId.',action,
      ['workspace','dossierId','operationId','requestId','expectedRevision'],remote),
    tool('merchant_research_pipelines_cancel','Request cancellation of the same original job with an operator reason and current OPERATION revision. Retained status distinguishes the acknowledgment from observed STOPPED.',{
      ...action,reason:{type:'string',minLength:1,maxLength:2000}},
      ['workspace','dossierId','operationId','requestId','expectedRevision','reason'],remote),
    tool('merchant_research_pipelines_provider_jobs','Read the original configured provider job inventory for this saved operation. Use actual returned IDs to review a lost-create reply before reconciliation.',{
      ...operation,workflowId:{type:'string',minLength:1,maxLength:256},status:{type:'string',minLength:1,maxLength:128}},
      ['workspace','dossierId','operationId'],{...read,openWorld:true}),
    tool('merchant_research_pipelines_reconcile','Bind the exact reviewed existing provider job to this same saved operation after a lost create reply. Uses original plan hash, action requestId, current OPERATION revision and recorded reason.',{
      ...action,expectedPlanSha256:digest,providerJobId:{type:'string',minLength:1,maxLength:256},
      reason:{type:'string',minLength:1,maxLength:2000}},
      ['workspace','dossierId','operationId','requestId','expectedRevision','expectedPlanSha256','providerJobId','reason'],remote),
    tool('merchant_research_pipelines_retain','Retain a complete advertised file/node output from the same original provider job. Use its actual fileId and optional nodeId, stable action requestId and current OPERATION revision.',{
      ...action,fileId:{type:'string',minLength:1,maxLength:1024},nodeId:{type:'string',minLength:1,maxLength:256}},
      ['workspace','dossierId','operationId','requestId','expectedRevision','fileId'],remote),
    tool('merchant_research_pipelines_review','Review the complete retained pipeline output and research edition. Select one operationId/outputId pair or one retained editionId.',pipelineSelection,
      ['workspace','dossierId'],read),
    tool('merchant_research_pipelines_elements','Read original pipeline elements with their page/type/text filters and complete reviewed edition hash. Select one original output or retained dossier edition.',{
      ...pipelineSelection,...elements},['workspace','dossierId','expectedEditionSha256'],read),
    tool('merchant_research_pipelines_receive','Receive the exact reviewed original output into its question using a stable receiving requestId, edition hash and current DOSSIER revision. Reconcile a lost reply by replaying those same saved receiving values.',{
      ...operation,outputId,requestId,questionId,label,expectedEditionSha256:digest,expectedRevision:revision},
      ['workspace','dossierId','operationId','outputId','requestId','questionId','label','expectedEditionSha256','expectedRevision'],{idempotent:true}),
  ];
}
