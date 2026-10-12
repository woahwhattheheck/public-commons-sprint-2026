// MIT. Research tool metadata; the selected provider loads its runtime on demand.
import {MAX_RETAINED_CHUNK_BYTES} from '../retained-file-contracts.mjs';
import {researchCitationReviewTools} from './research-citation-updates.mjs';
import {researchDocumentTools,RESEARCH_DOCUMENT_EXPORTS,RESEARCH_DOCUMENT_EXPORT_FIELDS} from './research-documents.mjs';
import {researchClinicalTrialsTools,RESEARCH_CLINICALTRIALS_EXPORTS,RESEARCH_CLINICALTRIALS_CRITERIA} from './research-clinicaltrials.mjs';
import {RESEARCH_SECTIONS,RESEARCH_COMPARISON_SECTIONS} from '../../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/workspace-contracts.mjs';

const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const nativeId={type:'string',minLength:1,maxLength:160};
const digest={type:'string',pattern:'^[a-f0-9]{64}$'};
const revision={type:'integer',minimum:1,maximum:99999999};
const label={type:'string',minLength:1,maxLength:240};
const offset={type:'integer',minimum:0},limit={type:'integer',minimum:1,maximum:100};
const read={readOnly:true,idempotent:true};
const workspace={workspace:alias},dossier={...workspace,dossierId:nativeId};
const operation={...dossier,operationId:{type:'string',pattern:'^cr_[a-f0-9]{64}$'}};
const sourceIds={type:'array',maxItems:10000,uniqueItems:true,items:nativeId};
const text={type:'string',maxLength:100000};
export const RESEARCH_EXPORTS=Object.freeze({
  'portable-json':{format:'json',extension:'json'},
  'portable-gzip':{format:'json.gz',extension:'json.gz'},
  markdown:{format:'md',extension:'md'},html:{format:'html',extension:'html'},
  'crossref-edition':{extension:'json'},'retained-edition':{extension:'json'},comparison:{extension:'json'},
  'source-content':{extension:'bin'},'source-record':{extension:'json'},'source-file':{extension:'bin'},
  ...RESEARCH_CLINICALTRIALS_EXPORTS,
  ...RESEARCH_DOCUMENT_EXPORTS,
});
const exportKind={type:'string',enum:Object.keys(RESEARCH_EXPORTS)};
export function researchWorkspaceTools(tool){
  return [
    tool('merchant_research_workspaces','List host-declared existing Research attachments, source handles and owned export reads.',{},[],read),
    tool('merchant_research_attach','Attach to the original authenticated Research listener and verify its host-selected workspace identity. Reuses its current browser, saved dossiers and Crossref operations.',workspace,['workspace'],{idempotent:true}),
    tool('merchant_research_detach','Drain and release this merchant attachment and its temporary file reads. The original Research listener and saved acquisition operations keep their original owner.',{
      ...workspace,attachmentId:nativeId},['workspace','attachmentId'],{idempotent:true}),
    tool('merchant_research_status','Read the same listener identity, configured sources and dossier count. The private managed startup record is reread after an original Applications restart.',workspace,['workspace'],read),
    tool('merchant_research_list','Page original dossier summaries. Continue with next.offset and next.snapshot; a changed inventory requires page zero.',{
      ...workspace,offset,limit,snapshot:digest},['workspace'],read),
    tool('merchant_research_dossier','Read original dossier metadata and counts, optionally at a retained revision. Use sections for complete question, source, finding and history records.',{
      ...dossier,revision},['workspace','dossierId'],read),
    tool('merchant_research_section','Read a page from the exact original dossier revision. Continue with returned revision and offset. Sources carry compact previews, complete descriptive metadata and exact occurrence selectors. Original content and files are downloaded explicitly; reference handles remain in editions.',{
      ...dossier,section:{type:'string',enum:RESEARCH_SECTIONS},revision,offset,limit,questionId:nativeId,
      query:{type:'string',maxLength:1000},selected:{type:'boolean'}},['workspace','dossierId','section'],read),
    tool('merchant_research_source','Inspect one retained source occurrence at the selected saved revision. Use the original citation editionId and key; returns content/file sizes and SHA256 selectors with its descriptive metadata and saved review.',{
      ...dossier,editionId:nativeId,key:{type:'string',pattern:'^(0|[1-9][0-9]{0,8})$'},revision},
      ['workspace','dossierId','editionId','key'],read),
    tool('merchant_research_create','Create a research dossier through the original server and return its saved identity.',{
      ...workspace,title:label,description:{type:'string',maxLength:20000}},['workspace','title'],{}),
    tool('merchant_research_update','Update the original dossier title or description using the reviewed current revision.',{
      ...dossier,expectedRevision:revision,title:label,description:{type:'string',maxLength:20000}},
      ['workspace','dossierId','expectedRevision'],{}),
    tool('merchant_research_question','Add an original research question, or edit its saved questionId, notes and open/answered/parked state. Uses the original dossier revision.',{
      ...dossier,expectedRevision:revision,questionId:nativeId,text:{type:'string',minLength:1,maxLength:4000},
      notes:text,status:{type:'string',enum:['open','answered','parked']}},
      ['workspace','dossierId','expectedRevision'],{}),
    tool('merchant_research_evidence','Select and annotate an original cited source or edit one saved question-specific occurrence. Supply exactly one sourceId or occurrenceId and the reviewed revision.',{
      ...dossier,expectedRevision:revision,sourceId:nativeId,occurrenceId:nativeId,selected:{type:'boolean'},
      note:text,classification:{type:'string',enum:['supports','contradicts','background','unreviewed']}},
      ['workspace','dossierId','expectedRevision'],{}),
    tool('merchant_research_finding','Add a cited analyst finding under its original question or edit an existing findingId. The native engine binds source IDs to that same question.',{
      ...dossier,expectedRevision:revision,questionId:nativeId,findingId:nativeId,title:label,text,sourceIds},
      ['workspace','dossierId','expectedRevision'],{}),
    tool('merchant_research_compare','Review original revision differences by summary or a complete page of changes. A comparison export retains all changed records.',{
      ...dossier,before:revision,after:revision,section:{type:'string',enum:['overview',...RESEARCH_COMPARISON_SECTIONS]},offset,limit},
      ['workspace','dossierId','before','after'],read),
    tool('merchant_research_receive_source','Receive a host-declared complete original research response or provider-edition reference under the selected question. Reads the declared source hash before the original receive operation.',{
      ...dossier,source:alias,questionId:nativeId,label,expectedRevision:revision},
      ['workspace','dossierId','source','questionId','label','expectedRevision'],{idempotent:true}),
    tool('merchant_research_source_bundle_preview','Preview a host-declared original source bundle under one saved question. Returns its exact byte hash, source terms, files, selected source decisions, authored findings and current dossier revision without changing the dossier.',{
      ...dossier,source:alias,questionId:nativeId},['workspace','dossierId','source','questionId'],read),
    tool('merchant_research_source_bundle_receive','Receive that same SHA-pinned source bundle, source decisions and findings under its original question in one atomic dossier revision. Use the preview revision and bundle hash; exact-byte retry returns the saved current result after a lost response.',{
      ...dossier,source:alias,questionId:nativeId,expectedRevision:revision,expectedBundleSha256:digest},
      ['workspace','dossierId','source','questionId','expectedRevision'],{idempotent:true}),
    tool('merchant_research_openalex_editions','List complete saved OpenAlex work editions from the source already configured on this original Research listener.',workspace,['workspace'],read),
    tool('merchant_research_receive_openalex','Receive a complete existing OpenAlex edition under the original research question through the maintained bridge.',{
      ...dossier,editionId:nativeId,questionId:nativeId,label,expectedRevision:revision},
      ['workspace','dossierId','editionId','questionId','expectedRevision'],{idempotent:true}),
    tool('merchant_research_crossref_prepare','Prepare a saved Crossref acquisition from DOI-bearing sources under the chosen original question. Reuse the same requestId after an interrupted reply; review DOI pages and plan hash before start.',{
      ...dossier,requestId:{type:'string',pattern:'^[A-Za-z0-9_-]{8,100}$'},questionId:nativeId,expectedRevision:revision,
      selectedOnly:{type:'boolean',default:true},includeUpdates:{type:'boolean',default:true},refresh:{type:'boolean',default:false},
      maxUpdatePages:{type:'integer',minimum:1,maximum:10000},label:{...label,maxLength:200}},
      ['workspace','dossierId','requestId','questionId','expectedRevision'],{idempotent:true}),
    tool('merchant_research_crossref_operations','Page saved original Crossref operation IDs and current phases. Start/resume and receive use these same immutable plan IDs.',{
      ...dossier,after:{type:'string',pattern:'^cr_[a-f0-9]{64}$'},limit},['workspace','dossierId'],read),
    tool('merchant_research_crossref_review','Read the original plan, current phase, source/configuration binding, coverage and proposed metadata changes. Page exact DOI scope, records or changes without losing the complete retained edition.',{
      ...operation,section:{type:'string',enum:['overview','dois','records','added','removed','changed','warnings']},offset,limit},
      ['workspace','dossierId','operationId'],read),
    tool('merchant_research_crossref_start','Start or resume this same saved Crossref acquisition with its reviewed plan hash. Original retained responses are reused; status distinguishes running, stopped, ready and imported.',{
      ...operation,expectedPlanSha256:digest},['workspace','dossierId','operationId','expectedPlanSha256'],{openWorld:true,idempotent:true}),
    tool('merchant_research_crossref_stop','Stop the original acquisition while retaining its plan and completed responses. Later start resumes the same operation ID.',operation,
      ['workspace','dossierId','operationId'],{idempotent:true}),
    tool('merchant_research_crossref_receive','Receive the exact reviewed Crossref edition into the original question using its plan hash, edition hash and current dossier revision. The native receiver reconciles a lost committed reply.',{
      ...operation,expectedRevision:revision,expectedPlanSha256:digest,expectedEditionSha256:digest},
      ['workspace','dossierId','operationId','expectedRevision','expectedPlanSha256','expectedEditionSha256'],{idempotent:true}),
    tool('merchant_research_export','Stream and retain a complete portable dossier, report, edition, comparison, original occurrence content/record or selected bundle file. Select revision for exact previous/reviewed/current HTML, Markdown or portable history. Source kinds bind editionId/key; source-file also requires original fileName and expectedSha256. Returns the same content-addressed export ID for reads and restart recovery.',{
      ...dossier,kind:exportKind,operationId:nativeId,editionId:nativeId,before:revision,after:revision,
      ...RESEARCH_DOCUMENT_EXPORT_FIELDS,revision,
      key:{type:'string',pattern:'^(0|[1-9][0-9]{0,8})$'},fileName:{type:'string',minLength:1,maxLength:1024},
      sourceId:{type:'string',pattern:'^ctsrc_[a-f0-9]{64}$'},criteria:RESEARCH_CLINICALTRIALS_CRITERIA,expectedSha256:digest},
      ['workspace','dossierId','kind'],{}),
    tool('merchant_research_exports','Page complete exports already retained by this attachment. Recover a lost export reply by its original dossier ID, content hash and saved export receipt.',{
      ...workspace,dossierId:nativeId,offset,limit,snapshot:digest},['workspace'],read),
    tool('merchant_research_file_read','Read a retained complete export as SHA-pinned base64 chunks. Continue with the same kind/exportId/readId and nextOffset; after expiry or restart omit readId and retain exportId plus offset.',{
      ...workspace,kind:exportKind,exportId:digest,readId:nativeId,offset,
      limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES}},
      ['workspace','kind','exportId'],read),
    tool('merchant_research_file_release','Release one owned temporary export read. The complete original export remains retained.',{
      ...workspace,readId:nativeId},['workspace','readId'],read),
    tool('merchant_research_reopen','Reopen one complete host-declared portable source or retained portable export through the original streamed reader. Preserves the package dossier ID, verified history, notes, selections and findings.',{
      ...workspace,source:alias,kind:{type:'string',enum:['portable-json','portable-gzip']},exportId:digest},
      ['workspace'],{idempotent:true}),
    ...researchClinicalTrialsTools(tool),
    ...researchDocumentTools(tool),
    ...researchCitationReviewTools(tool)
  ];
}
