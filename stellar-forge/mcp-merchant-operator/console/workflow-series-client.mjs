// MIT. Typed recurring work client over the original merchant Console transport.
import { OpenApiWorkflowClient, writeOpenApiWorkflowFile } from './openapi-workflow-client.mjs';
import { canonical, digest } from './records.mjs';
import { SERIES_REVIEW_SCHEMA, identifier, revision, sha, need, plain, clone, seal, same, seriesRequest } from './workflow-series-records.mjs';

export const SERIES_PREPARATION_SCHEMA = 'stellar-forge.merchant-workflow-series-preparation.v1';
export { writeOpenApiWorkflowFile as writeWorkflowSeriesFile };
function original(value, schema) {
  need(plain(value) && value.schema === schema, 'Read the complete original recurring-work document.');
  const { contentSha256, ...body } = value;
  need(digest(canonical(body)) === sha(contentSha256), 'The complete selected recurring-work document changed.', 'CONSOLE_SERIES_DOCUMENT_CHANGED', 409);
  return value;
}
export function validateWorkflowSeriesPreparation(value) {
  original(value, SERIES_PREPARATION_SCHEMA);
  need(['cycle','start'].includes(value.kind), 'Choose the saved cycle preparation or original first-start review.');
  if (value.reused) {
    need(value.kind === 'start' && value.action === null && value.review === null &&
      plain(value.cycle) && value.cycle.runId === value.run?.id, 'Retain the original already-started cycle and run.');
    return value;
  }
  original(value.review, SERIES_REVIEW_SCHEMA);
  need(plain(value.action) && value.action.expectedReviewSha256 === value.review.contentSha256,
    'Retain the action attached to this complete original review.');
  if (value.kind === 'cycle') {
    need(value.review.kind === 'cycle' && same(value.action.request, value.review.request) &&
      digest(canonical(value.action.request)) === value.review.requestSha256,
      'This original cycle preparation has different inputs or source.', 'CONSOLE_SERIES_DOCUMENT_CHANGED', 409);
  } else need(value.review.kind === 'start' && value.action.id === value.review.cycleId,
    'Select the first-start review for this exact saved cycle.');
  return value;
}
export class MerchantWorkflowSeriesClient {
  constructor(options) { this.console = new OpenApiWorkflowClient(options); }
  host() { return this.console.host(); }
  profiles() { return this.console.profiles(); }
  profile(id) { return this.console.profile(identifier(id)); }
  createProfile(input) { return this.console.createProfile(input); }
  bindProfile(input) { return this.console.bindProfile(input); }
  list(profileId) { return this.console.json('workflow-series?' + new URLSearchParams({ profile: identifier(profileId) })); }
  series(id, { revision: edition, offset = 0, limit = 50 } = {}) {
    identifier(id); need(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit > 0 && limit <= 100,
      'Select a complete cycle-history page of up to 100 rows.');
    const query = new URLSearchParams({ offset: String(offset), limit: String(limit) });
    if (edition !== undefined) query.set('revision', String(revision(edition)));
    return this.console.json('workflow-series/' + encodeURIComponent(id) + '?' + query);
  }
  saveSeries(input) { return this.console.json('workflow-series-save', seriesRequest(input)); }
  calendar(input) { return this.console.json('workflow-series-calendar', clone(input)); }
  agenda(input) { return this.console.json('workflow-series-agenda', clone(input)); }
  agendaCalendar(input) { return this.console.json('workflow-series-agenda-calendar', clone(input)); }
  cycle(id) { return this.console.json('workflow-cycle/' + encodeURIComponent(identifier(id))); }
  async prepareCycle(input) {
    const packet = await this.console.json('workflow-cycle-review', clone(input));
    const value = seal({ schema: SERIES_PREPARATION_SCHEMA, kind: 'cycle', reused: false,
      action: { request: packet.request, expectedReviewSha256: packet.review?.contentSha256 }, review: packet.review,
      existing: packet.existing ?? null });
    return validateWorkflowSeriesPreparation(value);
  }
  saveCycle(preparation) {
    const value = validateWorkflowSeriesPreparation(preparation);
    need(value.kind === 'cycle', 'Use the complete saved cycle preparation.');
    return this.console.json('workflow-cycle-save', clone(value.action));
  }
  async prepareStart(id) {
    const packet = await this.console.json('workflow-cycle-start-review', { id: identifier(id) });
    const value = seal({ schema: SERIES_PREPARATION_SCHEMA, kind: 'start', reused: Boolean(packet.reused),
      action: packet.reused ? null : { id: packet.cycle.id, expectedReviewSha256: packet.review?.contentSha256 },
      review: packet.review, cycle: packet.cycle, run: packet.run ?? null });
    return validateWorkflowSeriesPreparation(value);
  }
  startCycle(preparation) {
    const value = validateWorkflowSeriesPreparation(preparation);
    need(value.kind === 'start', 'Use the complete saved first-start review.');
    if (value.reused) return this.cycle(value.cycle.id);
    return this.console.json('workflow-cycle-start', clone(value.action));
  }
  cancelCycle(input) { return this.console.json('workflow-cycle-cancel', clone(input)); }
  run(id) { return this.console.run(identifier(id)); }
  async waitCycle(id, options = {}) {
    const selected = await this.cycle(id);
    if (selected.run) await this.console.waitRun(selected.run.id, options);
    return this.cycle(id);
  }
  resume(input) { return this.console.resume(input); }
  pause(input) { return this.console.pause(input); }
  resolve(input) { return this.console.resolve(input); }
  handover(input) { return this.console.handover(input); }
  exportProfile(id) { return this.console.exportProfile(identifier(id)); }
  importProfile(archive) { return this.console.importProfile(archive); }
  async capture(input) {
    const { captureWorkflowSeriesHandover } = await import('./workflow-series-handover.mjs');
    return captureWorkflowSeriesHandover(this.console, input);
  }
  async receive(input) {
    const { receiveWorkflowSeriesHandover } = await import('./workflow-series-handover.mjs');
    return receiveWorkflowSeriesHandover(this.console, input);
  }
  close() { this.console.close(); }
}
