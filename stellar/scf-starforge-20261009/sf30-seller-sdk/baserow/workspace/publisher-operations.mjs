import { BASEROW_PUBLISHER_READ_ACTIONS, BASEROW_PUBLISHER_WRITE_ACTIONS, shapes } from './publisher-contracts.mjs';
export { BASEROW_PUBLISHER_READ_ACTIONS, BASEROW_PUBLISHER_WRITE_ACTIONS } from './publisher-contracts.mjs';
// MIT. Original publisher actions inside the Baserow source request journal.
import { basename, join } from 'node:path';
import { object, digest, readPrivate, fault } from '../../postgres/publisher/files.mjs';
import { openPostgresSchedule } from '../../postgres/publisher/schedule.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;

const required = {
  plan: ['planId'], run: ['runId'], 'buyer-offer': ['runId'], 'buyer-handoff': ['runId', 'handoffId'],
  'plan-save': ['plan'], extract: ['planId', 'planDigest', 'runId'], cancel: ['runId'],
  review: ['runId', 'candidateDigest', 'reviewer', 'note'], publish: ['runId', 'reviewId'], recover: ['runId'],
  'buyer-prepare': ['runId', 'offerSha256', 'acceptIndex', 'intentId'],
  'schedule-save': ['policy'], 'schedule-enable': ['revision', 'expectedSnapshot', 'expectedRevision'],
  'schedule-pause': ['revision'], 'schedule-run': ['revision'], 'schedule-continue': ['revision'],
};


function checkId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw fault('BASEROW_PUBLISHER_ID_REQUIRED');
  return value;
}
export function publisherRequest(action, input = {}, write = false) {
  const allowed = write ? BASEROW_PUBLISHER_WRITE_ACTIONS : BASEROW_PUBLISHER_READ_ACTIONS;
  if (!allowed.includes(action) || !object(input) || Object.keys(input).some(key => !shapes[action].includes(key)) ||
      (required[action] ?? []).some(key => !Object.hasOwn(input, key)))
    throw fault('BASEROW_PUBLISHER_ACTION_INVALID', 'Use an original publisher action and its declared fields.');
  for (const key of ['runId', 'reviewId', 'handoffId']) if (input[key] !== undefined) checkId(input[key]);
  for (const key of ['planDigest', 'candidateDigest', 'expectedSnapshot', 'offerSha256'])
    if (input[key] !== undefined && (typeof input[key] !== 'string' || !HASH.test(input[key])))
      throw fault('BASEROW_PUBLISHER_HASH_REQUIRED', 'Use the inspected original SHA256.');
  for (const key of ['planId', 'revision', 'expectedRevision', 'acceptIndex', 'offset', 'plansOffset', 'runsOffset', 'historyOffset'])
    if (input[key] !== undefined && (!Number.isSafeInteger(input[key]) || input[key] < (key === 'planId' ? 1 : 0)))
      throw fault('BASEROW_PUBLISHER_INTEGER_INVALID');
  if (input.query !== undefined && (typeof input.query !== 'string' || input.query.length > 8192))
    throw fault('BASEROW_PUBLISHER_QUERY_INVALID');
  if (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100))
    throw fault('BASEROW_PUBLISHER_PAGE_INVALID');
  if (action === 'plan-save' && (!object(input.plan) || !HASH.test(input.plan.sourceHash ?? '') || typeof input.plan.title !== 'string' ||
      !input.plan.title.trim() || input.plan.title.length > 128 || typeof input.plan.query !== 'string'))
    throw fault('BASEROW_PUBLISHER_PLAN_REQUIRED');
  return structuredClone(input);
}
async function scheduleRead(publisher, schedule, input) {
  if (schedule) return schedule.status(input);
  const original = await openPostgresSchedule({ publisher });
  try { return original.status(input); } finally { await original.close(); }
}
async function handoff(publisher, runId, handoffId) {
  const path = join(publisher.directory, 'runs', checkId(runId), 'buyer-' + checkId(handoffId) + '.json');
  publisher.run(runId);
  let offset = 0, record;
  do {
    const status = publisher.status({ limit: 100, historyOffset: offset });
    record = status.history.find(row => row.kind === 'BUYER_HANDOFF_PREPARED' && row.run === runId && row.data.path === path);
    offset = status.pages.history.next;
  } while (!record && offset !== null);
  if (!record) throw fault('BASEROW_PUBLISHER_HANDOFF_NOT_FOUND', 'Select an original handoff recorded by this run.', 404);
  const content = await readPrivate(path, 65536);
  if (digest(content) !== record.data.configSha256) throw fault('BASEROW_PUBLISHER_HANDOFF_CHANGED');
  const configText = new TextDecoder('utf-8', { fatal: true }).decode(content);
  return { runId, handoffId, eventId: record.id, preparedAt: record.created,
    snapshot: record.data.snapshot, offerSha256: record.data.offerSha256,
    configSha256: record.data.configSha256, intentId: record.data.intentId,
    configText, config: JSON.parse(configText) };
}
export async function readBaserowPublisher({ publisher, schedule = null }, action, input = {}) {
  input = publisherRequest(action, input);
  switch (action) {
    case 'status': return publisher.status(input);
    case 'source': return publisher.source();
    case 'target': return publisher.target();
    case 'plan': return publisher.plan(input.planId);
    case 'run': return publisher.inspect(input.runId, input.query);
    case 'buyer-offer': return publisher.buyerOffer(input.runId, input.query ?? '');
    case 'buyer-handoff': return handoff(publisher, input.runId, input.handoffId);
    case 'schedule': return scheduleRead(publisher, schedule, input);
  }
}
export async function executeBaserowPublisher({ publisher, schedule }, action, input, requestId) {
  input = publisherRequest(action, input, true); checkId(requestId);
  if (action.startsWith('schedule-') && !schedule) throw fault('BASEROW_PUBLISHER_OPEN_REQUIRED');
  switch (action) {
    case 'plan-save': return publisher.savePlan(input.plan);
    case 'extract': {
      const plan = publisher.plan(input.planId);
      if (plan.data.digest !== input.planDigest) throw fault('BASEROW_PUBLISHER_PLAN_CHANGED');
      let existing;
      try { existing = publisher.run(input.runId); } catch (issue) { if (issue.code !== 'RUN_NOT_FOUND') throw issue; }
      if (existing) {
        if (existing.plan !== plan.id || existing.data.planDigest !== input.planDigest)
          throw fault('BASEROW_PUBLISHER_RUN_REUSED');
        return { run: existing, replayed: true };
      }
      const operation = publisher.startExtraction(plan.id, { id: input.runId });
      operation.completion.catch(() => {});
      return { run: publisher.run(operation.id), replayed: false };
    }
    case 'cancel': return publisher.cancel(input.runId);
    case 'review': {
      const candidate = await publisher.candidate(input.runId);
      if (candidate.manifest.candidateDigest !== input.candidateDigest)
        throw fault('BASEROW_PUBLISHER_CANDIDATE_CHANGED');
      const { runId, candidateDigest, ...review } = input;
      return publisher.review(runId, review);
    }
    case 'publish': {
      const current = publisher.run(input.runId);
      if (current.state === 'PUBLISHED' && current.data.review?.id === input.reviewId)
        return current;
      return publisher.publish(input.runId, input.reviewId);
    }
    case 'recover': return publisher.recover(input.runId);
    case 'buyer-prepare': {
      const { runId, ...choice } = input;
      const result = await publisher.prepareBuyer(runId, choice);
      const match = /^buyer-([a-f0-9-]{36})\.json$/.exec(basename(result.path));
      if (!match) throw fault('BASEROW_PUBLISHER_HANDOFF_INVALID');
      return handoff(publisher, runId, match[1]);
    }
    case 'schedule-save': return schedule.configure(input.policy);
    case 'schedule-enable': return schedule.enable(input);
    case 'schedule-pause': return schedule.pause(input);
    case 'schedule-run': {
      const operation = schedule.runNow({ ...input, requestId });
      operation.completion.catch(() => {});
      return { occurrenceId: operation.id, schedule: schedule.status() };
    }
    case 'schedule-continue': {
      const operation = schedule.continueRun(input);
      operation.completion.catch(() => {});
      return { occurrenceId: operation.id, schedule: schedule.status() };
    }
  }
}
/** A pending source request is reconciled against the native journal after
 * process recovery. Extraction UUIDs, review IDs, schedules and handoff events
 * remain native identities; this observer does not repeat provider effects. */
export async function observeBaserowPublisher(context, action, input, before) {
  input = publisherRequest(action, input, true);
  const { publisher, schedule } = context;
  const observed = { mode: 'OBSERVED_ORIGINAL_STATE', action };
  if (action.startsWith('schedule-')) return { ...observed, schedule: await scheduleRead(publisher, schedule, { limit: 100 }) };
  if (action === 'plan-save') {
    const plans = []; let offset = 0;
    do {
      const page = publisher.status({ limit: 100, plansOffset: offset });
      plans.push(...page.plans.filter(plan => plan.id > (before?.latestPlanId ?? 0) &&
        plan.data.sourceHash === input.plan.sourceHash && plan.data.query === input.plan.query &&
        plan.data.title === input.plan.title.trim()));
      offset = page.pages.plans.next;
    } while (offset !== null);
    return { ...observed, originalPlans: plans, plansObserved: plans.length, beforePlanId: before?.latestPlanId ?? 0 };
  }
  let run;
  try { run = publisher.run(input.runId); }
  catch (issue) { if (issue.code !== 'RUN_NOT_FOUND') throw issue; }
  if (!run) return { ...observed, runId: input.runId, run: null };
  if (action === 'extract' && (run.plan !== input.planId || run.data.planDigest !== input.planDigest))
    throw fault('BASEROW_PUBLISHER_RUN_REUSED');
  if (action === 'publish' && run.data.review?.id !== input.reviewId)
    return { ...observed, run, reviewChanged: true };
  if (action === 'publish' && run.state === 'PUBLICATION_UNKNOWN')
    return { ...observed, run: await publisher.recover(run.id) };
  if (action === 'buyer-prepare') {
    const handoffs = []; let offset = 0;
    do {
      const page = publisher.status({ limit: 100, historyOffset: offset });
      for (const row of page.history) if (row.id > (before?.latestHistoryId ?? 0) &&
          row.kind === 'BUYER_HANDOFF_PREPARED' && row.run === run.id &&
          row.data.intentId === input.intentId && row.data.offerSha256 === input.offerSha256) {
        const match = /^buyer-([a-f0-9-]{36})\.json$/.exec(basename(row.data.path));
        if (match) handoffs.push(await handoff(publisher, run.id, match[1]));
      }
      offset = page.pages.history.next;
    } while (offset !== null);
    return { ...observed, run, originalHandoffs: handoffs };
  }
  return { ...observed, run };
}
export function baserowPublisherBefore(publisher) {
  const status = publisher.status({ limit: 1 });
  return { schema: 'stellar-forge.baserow-publisher-before.v1',
    latestPlanId: status.plans[0]?.id ?? 0, latestHistoryId: status.history[0]?.id ?? 0,
    active: status.active };
}
