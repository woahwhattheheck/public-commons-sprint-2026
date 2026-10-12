// MIT. Complete eligibility operations on the original attached Research client.
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const dossierId={type:'string',pattern:'^d_[a-f0-9-]{36}$'};
const id={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
const revision={type:'integer',minimum:1,maximum:99999999};
const selected={workspace:alias,dossierId};
const read={readOnly:true,idempotent:true};
export const RESEARCH_ELIGIBILITY_PREFIX='merchant_research_eligibility';
export const RESEARCH_ELIGIBILITY_EXPORTS=Object.freeze({
  'eligibility-json':{extension:'json'},
  'eligibility-csv':{extension:'csv'}
});
export const RESEARCH_ELIGIBILITY_EXPORT_FIELDS=Object.freeze({
  reviewId:id,workSetId:id,
  section:{type:'string',enum:['queue','decisions','resolutions','studies','impact','operations','occurrences']}
});
export function researchEligibilityTools(tool){
  return [
    tool('merchant_research_eligibility',
      'Read the selected original eligibility review, protocol, work set, report occurrences, decisions, resolutions, study links, source impacts or saved operations. Keep the returned dossier revision for every later page. The overview labels report, study and assignment counting units. Read occurrences before creating a review; filter their original question IDs explicitly.',
      {...selected,revision,reviewId:id,workSetId:id,
        section:{type:'string',enum:['overview','reviews','occurrences','queue','decisions','resolutions','studies','impact','operations']},
        offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}},
      ['workspace','dossierId'],read),
    tool('merchant_research_eligibility_review',
      'Submit one complete original eligibility action. Save requestId plus the entire request before sending. create-review retains questionId/name/protocol; revise-protocol retains protocol/reason; create-workset selects exact protocolId/occurrenceIds; decide records criterionAnswers/basis/actor and supersedes for corrections; resolve binds every current decisionId; study-link requires source evidence for each report; apply-outcomes changes only explicit resolved occurrences; review-impact records the original impactId. The original ELIGIBILITY_REVIEW.md and typed contracts define each data object. Replay the unchanged request after a lost reply; a current-revision conflict needs a newly reviewed request.',
      {...selected,requestId:{type:'string',pattern:'^[A-Za-z0-9_-]{8,100}$'},
        expectedRevision:revision,
        actor:{type:'object',properties:{id,name:{type:'string',minLength:1,maxLength:200}},
          required:['id','name'],additionalProperties:false},
        action:{type:'string',enum:['create-review','revise-protocol','create-workset','decide','resolve','study-link','apply-outcomes','review-impact']},
        reviewId:id,
        data:{description:'The exact action data object, validated by the original eligibility engine. No partial edit or omitted decision basis is inferred.',
          anyOf:[{type:'object'}]}},
      ['workspace','dossierId','requestId','expectedRevision','actor','action','data'],{idempotent:true})
  ];
}
