import { ContractError } from './canonical.mjs';
import { fetchLiveAgentEvidence } from './live_graph.mjs';

// The purchase policy interprets feedback/validation counts and averages as the
// complete evidence set. The Graph relation query is bounded, so the live path
// must not silently treat a full page as proof that no older rows exist.
export const LIVE_EVIDENCE_ROW_LIMIT = 100;

export async function fetchCompleteLiveAgentEvidence(options = {}) {
  const { feedbackFirst, validationFirst, ...request } = options;
  if (feedbackFirst !== undefined || validationFirst !== undefined) {
    throw new ContractError('GRAPH_COMPLETENESS_LIMIT_OVERRIDE_FORBIDDEN');
  }

  const evidence = await fetchLiveAgentEvidence({
    ...request,
    feedbackFirst: LIVE_EVIDENCE_ROW_LIMIT,
    validationFirst: LIVE_EVIDENCE_ROW_LIMIT,
  });

  if (evidence.agent.feedback.length >= LIVE_EVIDENCE_ROW_LIMIT) {
    throw new ContractError('GRAPH_FEEDBACK_COMPLETENESS_UNPROVEN');
  }
  if (evidence.agent.validations.length >= LIVE_EVIDENCE_ROW_LIMIT) {
    throw new ContractError('GRAPH_VALIDATION_COMPLETENESS_UNPROVEN');
  }
  return evidence;
}
