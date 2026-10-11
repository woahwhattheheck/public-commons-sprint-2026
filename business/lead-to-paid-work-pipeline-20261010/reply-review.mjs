// Join the EXISTING provider-receipt triage to the EXISTING buyer -> paid-work board.
// No mailbox access, messages, network calls or mutation of commercial stage receipts.
import { triage } from './reply-triage.mjs';

const norm = v => typeof v === 'string' ? v.trim().toLowerCase().replace(/\s+/g, ' ') : '';
const sameUrl = (a, b) => {
  try {
    const left = new URL(a), right = new URL(b);
    return left.protocol === 'https:' && right.protocol === 'https:' &&
      left.href.replace(/\/$/, '') === right.href.replace(/\/$/, '');
  } catch { return false; }
};
const unique = xs => [...new Set(xs)];
// This is a sales engagement lane, NOT permission for another first introduction.
// A warm human reply is actionable even though readyForOwnerApproach is false.
const lanes = Object.freeze({
  HUMAN_INTEREST: 'ACTIVE_CUSTOMER_REPLY',
  HUMAN_REPLY_NEEDS_TRIAGE: 'REVIEW_HUMAN_REPLY',
  HUMAN_NEUTRAL: 'REVIEW_HUMAN_REPLY',
  MESSAGE_CONTENT_REQUIRED: 'READ_GMAIL_CONTENT',
  HUMAN_DECLINE: 'CLOSED_DECLINED',
  CONTACT_ROUTING_AVAILABLE: 'RECONNECT_NAMED_CONTACT',
  CONTACT_ROUTED_AWAITING_REPLY: 'AWAITING_REPLY',
  DELIVERY_FAILURE: 'FIX_DELIVERY',
  OUTBOUND_AWAITING_REPLY: 'AWAITING_REPLY',
  FOLLOWUP_REVIEW: 'REVIEW_FOLLOWUP',
  NO_VERIFIED_SEND: 'REVIEW_FIRST_CONTACT',
  NOT_EVALUATED: 'PROVIDER_DATA_REQUIRED',
  UNMAPPED: 'SOURCE_BINDING_REQUIRED'
});
export const engagementLane = status => lanes[status] || 'REVIEW_PROVIDER_RECORDS';

function hold(decision, reasons, action) {
  if (!reasons.length) return;
  decision.readyForOwnerApproach = false;
  decision.blockers.push(...reasons.filter(x => !decision.blockers.includes(x)));
  // Never leave the original cold-introduction CTA visible beside provider proof it already happened.
  decision.nextActions = decision.nextActions.filter(x =>
    !x.startsWith('Owner may authorize one tailored unsent prime approach') && !x.startsWith('Proceed with the authorized'));
  if (action && !decision.nextActions.includes(action)) decision.nextActions.unshift(action);
}

/** Pure input/output join, also usable by native owner consoles already holding triage output. */
export function attachReplyResults(opportunities, decisions, report) {
  if (!Array.isArray(opportunities) || !Array.isArray(decisions) ||
      opportunities.length !== decisions.length) throw Error('Reply join requires paired opportunities/decisions');
  if (report == null) {
    for (const d of decisions) d.replyTriage = { status: 'NOT_EVALUATED', caseId: null,
      engagementLane: engagementLane('NOT_EVALUATED'), reasons: ['NO_PROVIDER_REPLY_SNAPSHOT_SUPPLIED'] };
    return null;
  }
  if (!Array.isArray(report.cases)) throw Error('Triage output cases[] required');
  const byId = new Map(report.cases.map(c => [c.caseId, c]));
  if (byId.size !== report.cases.length) throw Error('Duplicate provider triage case');
  const counts = new Map();
  for (const op of opportunities) {
    const k = op.communication?.caseId;
    if (typeof k === 'string' && k.trim()) counts.set(k.trim(), (counts.get(k.trim()) || 0) + 1);
  }
  const mapped = new Set(), issues = [];
  for (let i = 0; i < opportunities.length; i++) {
    const op = opportunities[i], d = decisions[i];
    const caseId = typeof op.communication?.caseId === 'string' ? op.communication.caseId.trim() : '';
    const c = byId.get(caseId);
    const reasons = [];
    if (!caseId || !c) reasons.push('REPLY_CASE_MAPPING_REQUIRED');
    if (caseId && counts.get(caseId) !== 1) reasons.push('REPLY_CASE_SHARED_ACROSS_OPPORTUNITIES');
    if (c && (norm(c.owner) !== norm(d.owner) || !sameUrl(c.sourceUrl, d.buyer.sourceUrl)))
      reasons.push('REPLY_OWNER_OR_ISSUER_MISMATCH');
    if (c) mapped.add(caseId);
    // A verified SENT is already first contact, even if a subsequent DSN reports delivery failure.
    if (c && c.sentCount > 0) reasons.push('REPLY_FIRST_CONTACT_ALREADY_SENT');
    if (c && c.status === 'HUMAN_DECLINE') reasons.push('REPLY_CONTACT_DECLINED');
    if (c && c.inboundCount > 0 && c.sentCount === 0) reasons.push('REPLY_INBOUND_OWNER_REVIEW');
    const summary = c ? {
      caseId, status: c.status, engagementLane: engagementLane(c.status), sentCount: c.sentCount, inboundCount: c.inboundCount,
      humanReplyCount: c.humanReplyCount, autoReplyCount: c.autoReplyCount,
      bounceCount: c.bounceCount, contentReadCount: c.contentReadCount || 0, nextAction: c.nextAction,
      // Intentionally no raw body, address, subject, message ID, or private receipt URL on the board.
      reasons: unique(reasons)
    } : { caseId: caseId || null, status: 'UNMAPPED', engagementLane: engagementLane('UNMAPPED'), reasons: unique(reasons) };
    d.replyTriage = summary;
    if (reasons.length) {
      issues.push({ opportunityKey: d.key, caseId: caseId || null, reasons: unique(reasons) });
      hold(d, unique(reasons), c ? c.nextAction :
        'Bind the verified reply case to this opportunity before any new prospect introduction');
    } else if (c && c.status === 'NO_VERIFIED_SEND') {
      // This is NOT evidence that there was no contact in an unchecked mailbox.
      d.nextActions.unshift('Reply snapshot contains no verified send for this mapped case; confirm full history with the relationship owner');
    }
  }
  const unboundCases = report.cases.filter(c => !mapped.has(c.caseId)).map(c => c.caseId);
  report.boardJoin = { matchedCases: mapped.size, unboundCases, issues };
  return report;
}

/** One native reader; the original classifier owns message kinds and provider-ID validation. */
export function applyReplyReview(opportunities, decisions, snapshot, now = new Date()) {
  return attachReplyResults(opportunities, decisions,
    snapshot === undefined ? null : triage(snapshot, now));
}
