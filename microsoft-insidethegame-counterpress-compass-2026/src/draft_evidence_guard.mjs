// Conservative pre-display quantitative guard for optional LLM copy.
// This is NOT a semantic entailment checker. The deterministic source overlay
// remains authoritative even if a draft passes every check.
const EVIDENCE_ID = /\be\d{3,6}\b/gi;
const NUMERIC = /(?<![A-Za-z0-9])\d+(?:[.,]\d+)?(?![A-Za-z0-9])/g;
const UNSUPPORTED_CATEGORIES = /\b(?:scores?|goals?|shots?|penalt(?:y|ies)|red cards?|yellow cards?|offsides?|xg|expected goals?)\b/i;
const PERCENT = /\d+(?:[.,]\d+)?\s*%/;

const numericValues = (text) =>
  [...String(text).matchAll(NUMERIC)].map((m) => Number(m[0].replace(',', '.')));

export function validateDraftGrounding(draft, overlay) {
  if (typeof draft !== 'string' || !draft.trim() || draft.length > 135 ||
      /[\x00-\x1f<>]|https?:\/\/|www\.|\[[^\]]+\]\(/i.test(draft)) {
    return {ok: false, reason: 'invalid_draft_shape'};
  }
  if (!overlay || !Array.isArray(overlay.evidenceIds) || !overlay.evidenceIds.length ||
      typeof overlay.text !== 'string' || !overlay.metrics || typeof overlay.metrics !== 'object') {
    return {ok: false, reason: 'missing_canonical_evidence'};
  }
  const evidence = new Set(overlay.evidenceIds.map((id) => id.toLowerCase()));
  if ([...draft.matchAll(EVIDENCE_ID)].some(([id]) => !evidence.has(id.toLowerCase()))) {
    return {ok: false, reason: 'unverified_evidence_id'};
  }
  // Neither goals nor scorelines nor percentages are supported by this particular
  // counterpress overlay, even if their numbers happen to match a window metric.
  if (UNSUPPORTED_CATEGORIES.test(draft) || PERCENT.test(draft)) {
    return {ok: false, reason: 'unsupported_statistic'};
  }
  const allowed = [
    ...numericValues(overlay.text),
    ...Object.values(overlay.metrics).filter(Number.isFinite),
  ];
  if (numericValues(draft).some((num) => !allowed.some((v) => Math.abs(v - num) < 1e-9))) {
    return {ok: false, reason: 'unobserved_quantity'};
  }
  const status = overlay.status;
  if (status === 'interrupted' &&
      /\b(?:regain(?:ed)?|recover(?:ed|y)?|won (?:it|the ball) back|failed|unsuccessful|timed out|expired|did not regain|never recovered)\b/i.test(draft)) {
    return {ok: false, reason: 'unknown_outcome_contradiction'};
  }
  if (status === 'expired' &&
      /\b(?:regain(?:ed)?|recover(?:ed|y)?|won (?:it|the ball) back|successful)\b/i.test(draft)) {
    return {ok: false, reason: 'expired_outcome_contradiction'};
  }
  if (status === 'success' &&
      /\b(?:failed|unsuccessful|did not regain|never recovered|timed out|expired)\b/i.test(draft)) {
    return {ok: false, reason: 'successful_outcome_contradiction'};
  }
  return {ok: true, reason: 'quantitatively_consistent_only'};
}
