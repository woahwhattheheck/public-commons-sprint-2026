// MIT. Citation-update review on the original attached Research workspace.
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const dossierId={type:'string',pattern:'^d_[a-f0-9-]{36}$'};
const noticeId={type:'string',pattern:'^cu_[a-f0-9]{64}$'};
const occurrenceId={type:'string',pattern:'^o_[a-f0-9]{64}$'};
const findingId={type:'string',pattern:'^f_[a-f0-9-]{36}$'};
const digest={type:'string',pattern:'^[a-f0-9]{64}$'};
const revision={type:'integer',minimum:1,maximum:99999999};
const text={type:'string',maxLength:100000};
const reason={type:'string',minLength:1,maxLength:20000};
const selection={workspace:alias,dossierId};
const read={readOnly:true,idempotent:true};
const object=(properties,required)=>({type:'object',properties,required,additionalProperties:false});
export const RESEARCH_CITATION_REVIEW_PREFIX='merchant_research_citation_';
export const RESEARCH_CITATION_REQUEST_FIELDS=Object.freeze([
  'requestId','noticeId','expectedFingerprint','expectedRevision','actor','decision','reason',
  'evidenceChanges','findingChanges','findingDispositions'
]);
export function researchCitationReviewTools(tool){
  return [
    tool('merchant_research_citation_updates',
      'Page registered citation updates derived from retained Research editions. Returns exact dossier revision, source coverage, notice fingerprints, affected evidence/finding counts and prior review. Keep that revision when continuing nextOffset; status pending includes follow-up and review-again.',
      {...selection,revision,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100},
        status:{type:'string',enum:['all','pending','reviewed']}},
      ['workspace','dossierId'],read),
    tool('merchant_research_citation_update',
      'Open one citation update at a saved dossier revision with all registered assertions, original document/capture bindings, affected evidence, complete findings, allowed same-question citations and full review history. Preserve the returned notice fingerprint and revision for an explicit atomic review.',
      {...selection,noticeId,revision},['workspace','dossierId','noticeId'],read),
    tool('merchant_research_citation_review',
      'Save an explicit citation-update decision, complete evidence/finding edits and a disposition for every affected finding in ONE original dossier revision. Overall decision does not imply content edits. Retain the entire requestId/payload before calling; retry those exact values after a lost reply to recover its saved review. A changed revision or fingerprint requires review of current content.',
      {...selection,requestId:{type:'string',pattern:'^[A-Za-z0-9_-]{8,100}$'},noticeId,
        expectedFingerprint:digest,expectedRevision:revision,actor:{type:'string',minLength:1,maxLength:200},
        decision:{type:'string',enum:['retain','revise','exclude','follow-up']},reason,
        evidenceChanges:{type:'array',maxItems:10000,items:object({
          occurrenceId,selected:{type:'boolean'},classification:{type:'string',enum:['supports','contradicts','background','unreviewed']},
          note:text},['occurrenceId','selected','classification'])},
        findingChanges:{type:'array',maxItems:10000,items:object({
          id:findingId,title:{type:'string',minLength:1,maxLength:240},text:{...text,minLength:1},
          occurrenceIds:{type:'array',uniqueItems:true,items:occurrenceId}},['id','title','text','occurrenceIds'])},
        findingDispositions:{type:'array',maxItems:10000,items:object({
          findingId,disposition:{type:'string',enum:['unchanged','revised','citation-removed','follow-up']},reason},
          ['findingId','disposition','reason'])}},
      ['workspace','dossierId','requestId','noticeId','expectedFingerprint','expectedRevision','actor','decision','reason'],
      {idempotent:true})
  ];
}
