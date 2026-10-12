// MIT. Human-readable analyst workshare handover from a retained award and review.
import { money, now, requireThat } from './core.mjs';
const label=v=>v===null||v===undefined||v===''?'—':String(v);
const cell=v=>label(v).replaceAll('|','\\|').replaceAll('\n',' ');
export function workshareBrief(workspace,editionId,key){
  const edition=workspace.edition(editionId),award=workspace.row(editionId,key),record=workspace.state().reviews.find(r=>r.award_key===key);
  requireThat(record,'REVIEW_NOT_FOUND','Save an analyst workshare record for this award',404);
  const r=record.data,lines=[
    '# '+(award.recipient_name??award.piid??key)+' — workshare brief','',
    'Prepared '+now()+'. Analyst: '+record.operator+'. Research state: '+r.status+'.','',
    '## Original public award','',
    '| Field | Retained value |','| --- | --- |',
    ...[
      ['Award',award.piid],['Award identity',award.award_key],['Recipient',award.recipient_name],['Recipient UEI',award.recipient_uei],
      ['Parent recipient',award.parent_recipient_name],['Parent UEI',award.parent_recipient_uei],['Parent award',award.parent_piid],
      ['Awarding agency',award.awarding_agency],['Funding agency',award.funding_agency],['Signed',award.signed_date],
      ['Performance period',label(award.performance_start)+' → '+label(award.performance_end)],['Potential end',award.potential_end],
      ['Award amount / obligations',money(award.award_amount_usd)],['Exercised value',money(award.exercised_usd)],['All-options value',money(award.potential_usd)],['Outlays',money(award.outlays_usd)],
      ['NAICS',award.naics],['PSC',award.psc],['Set aside',award.set_aside],['Subcontracting plan',award.subcontracting_plan],
      ['Observed',award.source_observed_at]
    ].map(([k,v])=>'| '+k+' | '+cell(v)+' |'),
    '','[Original USAspending award]('+award.source_url+')','',
    award.description??'','',
    '## Business fit','',r.fit||'—','',
    ...r.businessFitUrls.map(s=>'- ['+(s.title||s.url).replaceAll(']','\\]')+']('+s.url+')'+(s.observedAt?' — observed '+s.observedAt:'')+(s.notes?'\n  '+s.notes.replaceAll('\n',' '):'')),
    '','## Proposed workshare','',r.workshare||'—','',
    '### Deliverables','',r.deliverables||'—','',
    '### Acceptance','',r.acceptance||'—','',
    '### Commercial terms and inputs','',
    'Proposed fee: '+(r.feeUsd?money(r.feeUsd):'To be specified')+'. Delivery period: '+(r.durationDays?r.durationDays+' business days after agreed input handoff':'To be specified')+'.','',
    r.constraints||'—','',
    '## Relationship continuity','',
    'Owner: '+(r.owner||'—')+'. Contact: '+(r.primeContact||'—')+'.','',
    r.caseUrl?'Original case: '+r.caseUrl:'',r.nextAction||'',r.nextActionDate?'Action date: '+r.nextActionDate:'',r.notes||'',
    '','## Retained edition','',
    'Edition: '+edition.id+' / '+edition.sha256+'. Review revision: '+record.revision+'. Source row: '+award.row_sha256+'.','',
    record.row_sha256===award.row_sha256?'This review references the selected retained source row.':'The selected source row has changed since this review. Reopen the analyst record against this edition before sending the workshare.',''
  ];
  return lines.join('\n');
}
