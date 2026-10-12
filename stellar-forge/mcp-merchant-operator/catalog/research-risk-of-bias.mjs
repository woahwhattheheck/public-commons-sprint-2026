// MIT. Appraisal operations on the existing Research attachment.
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const nativeId={type:'string',minLength:1,maxLength:512};
const dossierId={type:'string',pattern:'^d_[a-f0-9-]{36}$'};
const digest={type:'string',pattern:'^[a-f0-9]{64}$'};
const revision={type:'integer',minimum:1,maximum:99999999};
const section={type:'string',enum:[
  'overview','reviews','protocols','studies','results','assessments','drafts',
  'submissions','comparisons','adjudications','impact','operations','sources',
]};
const selection={reviewId:nativeId,assessmentId:nativeId,assessmentEditionId:nativeId,actorId:nativeId,revision};
export const RESEARCH_RISK_PREFIX='merchant_research_risk_';
export const RESEARCH_RISK_EXPORTS=Object.freeze({
  'risk-json':{extension:'json',riskFormat:'json'},
  'risk-csv':{extension:'csv',riskFormat:'csv'},
  'risk-markdown':{extension:'md',riskFormat:'md'},
  'risk-html':{extension:'html',riskFormat:'html'},
});
export const RESEARCH_RISK_EXPORT_FIELDS=Object.freeze({...selection,riskSection:section});
export const RESEARCH_RISK_REQUEST_FIELDS=Object.freeze([
  'requestId','expectedRevision','actor','action','reviewId','dataJson',
]);
export function researchRiskOfBiasTools(tool){
  return [
    tool('merchant_research_risk_view',
      'Read a complete page of the original appraisal programme, exact study/result selectors, protocol/form editions, independent drafts/submissions, comparisons, adjudications or changed-source impact. Use the returned revision on all later pages and copy source/record digests from the original selector rows. actorId selects that reviewer draft; prior submitted decisions remain attributed.',
      {workspace:alias,dossierId,...selection,section,
        offset:{type:'integer',minimum:0,maximum:99999999},
        limit:{type:'integer',minimum:1,maximum:100}},
      ['workspace','dossierId'],{readOnly:true,idempotent:true}),
    tool('merchant_research_risk_review',
      'Apply one complete retained appraisal request through the original dossier transaction. dataJson is the complete JSON object for the selected action, including exact source/protocol/assessment editions, answer and judgment evidence, or superseded draft/submission IDs. Retain this entire request ID, expected revision, actor and body before calling. Retry the unchanged original request after an interrupted reply to recover its immutable result.',
      {workspace:alias,dossierId,
        requestId:{type:'string',minLength:8,maxLength:100,pattern:'^[A-Za-z0-9_-]+$'},
        expectedRevision:revision,
        actor:{type:'object',additionalProperties:false,properties:{
          id:{type:'string',minLength:1,maxLength:200},name:{type:'string',minLength:1,maxLength:240},
        },required:['id','name']},
        action:{type:'string',enum:[
          'create-review','revise-protocol','create-assessment','revise-assessment',
          'save-draft','submit-review','adjudicate','review-impact',
        ]},
        reviewId:nativeId,
        dataJson:{type:'string',minLength:2,maxLength:16*1024*1024,
          description:'The complete action data object serialized as JSON; the original domain validates all nested fields and exact source identities.'}},
      ['workspace','dossierId','requestId','expectedRevision','actor','action','dataJson'],
      {idempotent:true}),
  ];
}
