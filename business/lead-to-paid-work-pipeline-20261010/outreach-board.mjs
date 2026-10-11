// Connect the existing offline collision checker to the existing decision board.
import { review, mailbox } from './outreach-preflight.mjs';
const canonical = s => typeof s === 'string' ? s.trim().toLowerCase().replace(/\s+/g,' ') : '';

export function applyOutreachReview(opportunities, decisions, snapshot, now) {
  if (snapshot === undefined) {
    for (const decision of decisions) decision.outreachPreflight = { decision:'NOT_EVALUATED', reasons:['NO_MAILBOX_SNAPSHOT_SUPPLIED'], intentId:null };
    return null;
  }
  // The existing checker owns history, freshness and collision decisions.
  const result = review(snapshot, now);
  const mappingCounts = new Map();
  for (const op of opportunities) {
    const id = op.communication?.intentId;
    if (typeof id === 'string' && id.trim()) mappingCounts.set(id, (mappingCounts.get(id) || 0) + 1);
  }
  for (const [i, op] of opportunities.entries()) {
    const decision = decisions[i], communication = op.communication || {};
    const intentId = communication.intentId;
    const intent = snapshot.intents.find(x => x.id === intentId);
    const reasons = [];
    if (!intent) reasons.push('OUTREACH_INTENT_MAPPING_REQUIRED');
    if (mappingCounts.get(intentId) > 1) reasons.push('OUTREACH_INTENT_SHARED_BY_OPPORTUNITIES');
    if (intent) {
      if (canonical(intent.buyerId) !== canonical(op.buyer.name) || canonical(intent.solicitationId) !== canonical(op.buyer.opportunityId)) reasons.push('OUTREACH_BUYER_OR_SOLICITATION_MISMATCH');
      if (canonical(intent.owner) !== canonical(op.owner)) reasons.push('OUTREACH_OWNER_MISMATCH');
      if (!decision.selectedPrime || canonical(intent.primeId) !== canonical(decision.selectedPrime)) reasons.push('OUTREACH_SELECTED_PRIME_MISMATCH');
      try {
        if (!Array.isArray(communication.to) || !communication.to.length) throw Error('No intended recipients');
        const expected = communication.to.map(mailbox).sort(), actual = intent.to.map(mailbox).sort();
        if (new Set(expected).size !== expected.length || JSON.stringify(expected) !== JSON.stringify(actual)) reasons.push('OUTREACH_RECIPIENT_MISMATCH');
      } catch { reasons.push('OUTREACH_RECIPIENT_MAPPING_REQUIRED'); }
    }
    const candidates = result.candidates.filter(x => x.intentId === intentId);
    if (intent && !candidates.length) reasons.push('OUTREACH_PREFLIGHT_RESULT_MISSING');
    for (const candidate of candidates) if (candidate.decision !== 'NO_COLLISION_OBSERVED') reasons.push(...candidate.reasons);
    const held = [...new Set(reasons)];
    decision.outreachPreflight = {intentId: typeof intentId === 'string' ? intentId : null,
      decision:held.length?'HOLD':'NO_COLLISION_OBSERVED',reasons:held,
      checkedAt:result.coverage.checkedAt,matchingSent:candidates.flatMap(x=>x.matchingSent)};
    if (held.length) {
      decision.readyForOwnerApproach = false;
      decision.blockers.push(...held.map(reason=>reason.startsWith('OUTREACH_')?reason:'OUTREACH_'+reason));
      decision.nextActions = decision.nextActions.filter(x=>!x.startsWith('Owner may authorize one tailored unsent prime approach') && !x.startsWith('Proceed with the authorized'));
      decision.nextActions.unshift('Resolve the recorded outreach preflight hold with the existing relationship owner; do not create another first contact');
    }
  }
  return result;
}
