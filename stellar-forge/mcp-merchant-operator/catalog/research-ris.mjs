// MIT. Native RIS source-review tools on the existing Research attachment.
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const nativeId={type:'string',minLength:1,maxLength:240};
const revision={type:'integer',minimum:1,maximum:99999999};
const offset={type:'integer',minimum:0,maximum:99999999};
const limit={type:'integer',minimum:1,maximum:100};
const nativeInput={type:'object',additionalProperties:true};
const dossier={workspace:alias,dossierId:nativeId};
const page={revision,offset,limit};
const read={readOnly:true,idempotent:true};
export const RESEARCH_RIS_EXPORTS=Object.freeze({
  'ris-edition':{extension:'json',risFormat:'edition',representation:'original-reviewed-edition'},
  'ris-source':{extension:'json',risFormat:'source',representation:'original-prepared-source'},
  'ris-document':{extension:'ris',risFormat:'document',representation:'original-ris-document'},
  'ris-record':{extension:'ris',risFormat:'record',representation:'original-record-byte-span'},
  'ris-selected':{extension:'ris',risFormat:'selected-ris',representation:'derived-selected-utf8'},
  'ris-csv':{extension:'csv',risFormat:'csv',representation:'derived-review-csv'},
  'ris-html':{extension:'html',risFormat:'html',representation:'derived-full-review-report'},
  'ris-markdown':{extension:'md',risFormat:'md',representation:'derived-full-review-report'},
  'ris-comparison':{extension:'json',risFormat:'json',comparison:true},
  'ris-comparison-html':{extension:'html',risFormat:'html',comparison:true},
  'ris-comparison-markdown':{extension:'md',risFormat:'md',comparison:true},
});
export const RESEARCH_RIS_EXPORT_FIELDS={
  documentId:nativeId,recordId:nativeId,beforeRisEditionId:nativeId,afterRisEditionId:nativeId
};
export function researchRisTools(tool){
  return [
    tool('merchant_research_ris_prepare','Prepare a host-declared exact original RIS source file. Retains complete documents, provenance, byte spans and unknown fields. Return the source descriptor, native field/duplicate candidates, diagnostics, full review and current dossier revision.',{
      ...dossier,source:alias,review:nativeInput,offset,limit,recordId:nativeId},
      ['workspace','dossierId','source','review'],{idempotent:true}),
    tool('merchant_research_ris_preview','Preview the unchanged complete native source/review input. Incomplete duplicate or field choices remain explicit. A previously received request can be reconstructed readonly; an accepted receipt is returned only after its full source/review/plan matches.',{
      ...dossier,input:nativeInput},['workspace','dossierId','input'],read),
    tool('merchant_research_ris_receive','Receive the complete reviewed source in one original dossier revision. input includes source, review, expectedPlanSha256 and expectedRevision. Every original record survives; selected evidence and an explicit prior-edition choice are applied atomically. Retry the same request/source/review after an unknown reply; the receipt binds its original input digest.',{
      ...dossier,input:nativeInput},['workspace','dossierId','input'],{idempotent:true}),
    tool('merchant_research_ris_list','Page all retained RIS editions at an original dossier revision. Continue with returned revision and nextOffset.',{
      ...dossier,...page},['workspace','dossierId'],read),
    tool('merchant_research_ris_review','Inspect one original RIS edition, full saved mapping and duplicate choices, source documents and paged original record metadata. Select recordId for ordered tags, continuations, diagnostics and exact byte span.',{
      ...dossier,editionId:nativeId,...page,recordId:nativeId},['workspace','dossierId','editionId'],read),
    tool('merchant_research_ris_request','Read the original saved request receipt after an interrupted reply. The result retains exact source, question, plan, input SHA and original/current revision; compare these with the unchanged pending input before marking it complete.',{
      ...dossier,requestId:nativeId,revision},['workspace','dossierId','requestId'],read),
    tool('merchant_research_ris_compare','Compare two retained editions under the same original question. Review complete source identities, changed field values and import choices. An absent record is a source comparison result; it does not imply retraction. Page the selected difference section at the returned revision.',{
      ...dossier,before:nativeId,after:nativeId,...page,section:{type:'string',enum:['added','absent','changed','unchanged']}},
      ['workspace','dossierId','before','after'],read),
  ];
}
