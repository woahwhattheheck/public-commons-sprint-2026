// MIT. The original review identity, with an explicit retained analyst selection.
import { need, plain, projectionPolicy, canonical, clone } from './model.mjs';
import { digest } from './source.mjs';
import { normalizeFredBriefing } from './briefing/model.mjs';

export function fredReviewIdentity({ captureId, policy, note, briefing } = {}) {
  return { captureId, policy: projectionPolicy(policy), note,
    ...(briefing === undefined || briefing === null ? {} : { briefing: clone(briefing) }) };
}
export function validateFredReview(review, model) {
  need(plain(review) && typeof review.captureId === 'string' && /^[a-f0-9]{64}$/.test(review.captureId) &&
    typeof review.note === 'string' && review.note.length <= 8000, 'Select the original complete economic source review.');
  const identity = fredReviewIdentity(review);
  if (review.briefing !== undefined && review.briefing !== null) {
    need(model && canonical(review.briefing) === canonical(normalizeFredBriefing(review.briefing, model)),
      'The retained analyst selection differs from its source.');
  }
  need(review.id === digest(identity), 'The original economic review identity changed.');
  return identity;
}
