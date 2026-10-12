// MIT. Original tool metadata; provider runtimes load only when selected.


const shapes = {
  'status': ['limit', 'plansOffset', 'runsOffset', 'historyOffset'],
  'source': [], 'target': [], 'plan': ['planId'], 'run': ['runId', 'query'],
  'buyer-offer': ['runId', 'query'], 'buyer-handoff': ['runId', 'handoffId'],
  'schedule': ['limit', 'offset'],
  'plan-save': ['plan'],
  'extract': ['planId', 'planDigest', 'runId'],
  'cancel': ['runId'],
  'review': ['runId', 'candidateDigest', 'reviewer', 'note', 'initialize', 'expectedSnapshot', 'expectedRevision'],
  'publish': ['runId', 'reviewId'],
  'recover': ['runId'],
  'buyer-prepare': ['runId', 'query', 'offerSha256', 'acceptIndex', 'intentId'],
  'schedule-save': ['policy'],
  'schedule-enable': ['revision', 'expectedSnapshot', 'expectedRevision'],
  'schedule-pause': ['revision'],
  'schedule-run': ['revision'],
  'schedule-continue': ['revision'],
};

const BASEROW_PUBLISHER_READ_ACTIONS = Object.freeze(['status', 'source', 'target', 'plan', 'run', 'buyer-offer', 'buyer-handoff', 'schedule']);

const BASEROW_PUBLISHER_WRITE_ACTIONS = Object.freeze(Object.keys(shapes).filter(action => !BASEROW_PUBLISHER_READ_ACTIONS.includes(action)));

export { BASEROW_PUBLISHER_READ_ACTIONS, BASEROW_PUBLISHER_WRITE_ACTIONS, shapes };
