// MIT. Exact SF47 agent contracts shared by client and lightweight tool metadata.
export const GRANT_AGENT_SCHEMA = 'stellar-forge.sf47-agent.v1';
export const GRANT_MAX_BUNDLE_BYTES = 32 * 1024 * 1024;
export const GRANT_MAX_SOURCE_BYTES = 8 * 1024 * 1024;
// Complete workbook handovers retain 128 MiB of original members plus ZIP framing.
export const GRANT_MAX_WORKBOOK_HANDOVER_BYTES = 129 * 1024 * 1024;
export const GRANT_TRANSFER_CHUNK_BYTES = 65536;

export const GRANT_COMPLETION_ACTIONS = Object.freeze([
  'completion.save', 'completion.corrections.save', 'completion.prepare', 'completion.extension', 'completion.submit', 'completion.decision',
]);

export const GRANT_EXPENSE_ACTIONS = Object.freeze([
  'expense.receive', 'expense.save', 'expense.review', 'expense.reopen', 'expense.void',
]);

export const GRANT_CASE_ACTIONS = Object.freeze([
  'work-intake.upload','work-intake.save','work-intake.apply','contributor.save', 'work.save', 'work.submit', 'work.accept', 'work.reopen', 'work.void',
  'invoice.save', 'invoice.review', 'invoice.dispute', 'invoice.reopen', 'invoice.void',
  'cash.record', 'cash.void', 'settlement.receive', 'settlement.correct', 'statement.receive', 'statement-setup.save', 'award.save', 'deployment.save', 'purchase.record', 'purchase.observe',
  'purchase.void', 'outcome.save', 'review', 'close', 'reopen',
  'cohort.prepare', 'installation.save', 'installation.return', 'installation.return-stage', 'implementation.prepare',
  'engagement.prepare', 'engagement.receiving',
  'risk-register.save',
  'amendment.save', 'amendment.review', 'amendment.apply',
  'task-outcomes.save', 'funding.save',
  ...GRANT_COMPLETION_ACTIONS,
  ...GRANT_EXPENSE_ACTIONS,
]);
