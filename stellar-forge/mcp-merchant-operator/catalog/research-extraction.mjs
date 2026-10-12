// MIT. Study extraction uses the original Research attachment and native engine.
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const id={type:'string',minLength:1,maxLength:180};
const revision={type:'integer',minimum:1,maximum:99999999};
const offset={type:'integer',minimum:0},limit={type:'integer',minimum:1,maximum:100};
const dossier={workspace:alias,dossierId:id};
const actor={type:'object',properties:{id:{type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,179}$'},name:{type:'string',minLength:1,maxLength:200}},required:['id','name'],additionalProperties:false};
const requestId={type:'string',pattern:'^[A-Za-z0-9_-]{8,100}$'};
const read={readOnly:true,idempotent:true};
export const RESEARCH_EXTRACTION_PREFIX='merchant_research_extraction';
export const RESEARCH_EXTRACTION_SECTIONS=Object.freeze([
  'overview','forms','formEditions','resultSets','extractions','submissions','results','resolutions','impact','operations','occurrences','studies'
]);
export const RESEARCH_EXTRACTION_PUBLICATION_SECTIONS=Object.freeze([
  'overview','tables','table-editions','results','publications','rows','impact','reviews','withdrawals','operations','comparison'
]);
export const RESEARCH_EXTRACTION_ACTIONS=Object.freeze([
  'create-form','revise-form','create-result-set','save-extraction','submit-extraction','resolve-result','review-impact'
]);
export const RESEARCH_EXTRACTION_PUBLICATION_ACTIONS=Object.freeze([
  'create-table','revise-table','publish-table','review-impact','withdraw-publication'
]);
export const RESEARCH_EXTRACTION_REQUEST_FIELDS=Object.freeze([
  'requestId','expectedRevision','actor','action','data'
]);
export const RESEARCH_EXTRACTION_EXPORTS=Object.freeze({
  'extraction-json':{format:'json',extension:'json'},
  'extraction-md':{format:'md',extension:'md'},
  'extraction-html':{format:'html',extension:'html'},
  'extraction-publication-json':{format:'json',extension:'json'},
  'extraction-publication-csv':{format:'csv',extension:'csv'},
  'extraction-publication-md':{format:'md',extension:'md'},
  'extraction-publication-html':{format:'html',extension:'html'}
});
export const RESEARCH_EXTRACTION_EXPORT_FIELDS=Object.freeze({
  formId:id,resultSetId:id,tableId:id,publicationId:id,againstPublicationId:id
});
const mutation=actions=>({...dossier,requestId,expectedRevision:revision,actor,
  action:{type:'string',enum:actions},
  data:{type:'object',additionalProperties:true,
    description:'Complete action data from the original study-extraction/publication contract. Preserve typed values as tagged arrays and exact strings; the original engine validates its fields and source bindings.'}
});
export function researchExtractionTools(tool){
  return [
    tool('merchant_research_extraction',
      'Read original forms, result sets, independent extraction drafts/submissions, resolved result editions, source impact or operations. Continue pages with the exact returned revision.',
      {...dossier,revision,formId:id,resultSetId:id,
        section:{type:'string',enum:RESEARCH_EXTRACTION_SECTIONS},offset,limit},
      ['workspace','dossierId'],read),
    tool('merchant_research_extraction_source_values',
      'Read a batch of JSON pointers from one exact retained occurrence at a selected dossier revision. Uses the maintained Decimal parser; source strings, numeric zero, null and missing values remain distinct. No provider read or dossier write.',
      {...dossier,revision,occurrenceId:id,fileName:{type:'string',minLength:1,maxLength:2048},
        pointers:{type:'array',minItems:1,maxItems:512,uniqueItems:true,items:{type:'string',maxLength:4096}}},
      ['workspace','dossierId','revision','occurrenceId','pointers'],read),
    tool('merchant_research_extraction_review',
      'Commit one complete original extraction action: form, result set, independent draft/submission, source-bound resolution or impact review. Save the entire requestId/expectedRevision/actor/action/data before calling; exact replay returns the original committed outcome after a lost reply.',
      mutation(RESEARCH_EXTRACTION_ACTIONS),
      ['workspace','dossierId',...RESEARCH_EXTRACTION_REQUEST_FIELDS],{idempotent:true}),
    tool('merchant_research_extraction_publications',
      'Read authored table definitions, exact immutable published editions, complete paged rows, publication comparisons/impact and original operations. Later pages retain the same dossier revision and selected table/publication.',
      {...dossier,revision,tableId:id,publicationId:id,fromPublicationId:id,toPublicationId:id,
        currentOnly:{type:'boolean'},changeType:{type:'string',enum:['all','added','removed','changed','unchanged']},
        section:{type:'string',enum:RESEARCH_EXTRACTION_PUBLICATION_SECTIONS},offset,limit},
      ['workspace','dossierId'],read),
    tool('merchant_research_extraction_publication_review',
      'Create or revise an evidence table, publish its exact selected result editions, review publication impact, or record withdrawal while retaining prior editions. The original engine supplies result records; replay only the complete saved request.',
      mutation(RESEARCH_EXTRACTION_PUBLICATION_ACTIONS),
      ['workspace','dossierId',...RESEARCH_EXTRACTION_REQUEST_FIELDS],{idempotent:true})
  ];
}
