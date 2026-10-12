// MIT. Exact SF47 agent contracts shared by client and lightweight tool metadata.
export const GRANT_AGENT_SCHEMA = 'stellar-forge.sf47-agent.v1';
export const GRANT_MAX_BUNDLE_BYTES = 32 * 1024 * 1024;
export const GRANT_MAX_SOURCE_BYTES = 8 * 1024 * 1024;
export const GRANT_TRANSFER_CHUNK_BYTES = 65536;

export const GRANT_COMPLETION_ACTIONS = Object.freeze([
  'completion.save', 'completion.prepare', 'completion.extension', 'completion.submit', 'completion.decision',
]);

export const GRANT_CASE_ACTIONS = Object.freeze([
  'contributor.save', 'work.save', 'work.submit', 'work.accept', 'work.reopen', 'work.void',
  'invoice.save', 'invoice.review', 'invoice.dispute', 'invoice.reopen', 'invoice.void',
  'cash.record', 'cash.void', 'award.save', 'deployment.save', 'purchase.record', 'purchase.observe',
  'purchase.void', 'outcome.save', 'review', 'close', 'reopen',
  ...GRANT_COMPLETION_ACTIONS,
]);
