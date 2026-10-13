// MIT. Recurring customer work retained with the original Console profile and runs.
import { canonical, digest, fail } from './records.mjs';
import { workflowPointer } from './workflow-records.mjs';

export const SERIES_SCHEMA = 'stellar-forge.merchant-workflow-series.v1';
export const CYCLE_SCHEMA = 'stellar-forge.merchant-workflow-cycle.v1';
export const SERIES_ARCHIVE_SCHEMA = 'stellar-forge.merchant-workflow-series-archive.v1';
export const SERIES_REVIEW_SCHEMA = 'stellar-forge.merchant-workflow-series-review.v1';
export const SERIES_MAX_BYTES = 16 * 1024 * 1024;
export const SERIES_REQUEST_BYTES = 32 * 1024 * 1024;
export const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export const clone = value => JSON.parse(canonical(value));
export const same = (left, right) => canonical(left) === canonical(right);
export const seal = value => ({ ...value, contentSha256: digest(canonical(value)) });
export const need = (value, message, code = 'CONSOLE_SERIES_INPUT', status = 400) => {
  if (!value) throw fail(code, message, status);
};
export const identifier = value => {
  need(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value), 'Use the saved series, cycle or request identifier.');
  return value;
};
export const revision = value => {
  need(Number.isSafeInteger(value) && value > 0, 'Select an exact saved revision.');
  return value;
};
export const sha = value => {
  need(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'Select the complete original SHA-256.');
  return value;
};
export const title = value => {
  need(typeof value === 'string' && value.trim() && value.length <= 160 && !/[\x00-\x1f]/.test(value), 'Use a readable name from 1 to 160 characters.');
  return value.trim();
};
export const note = (value, required = false) => {
  need(typeof value === 'string' && value.length <= 8000 && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value) && (!required || value.trim()), 'Retain the complete readable customer task or selection note.');
  return value.trim();
};
export const fields = (value, allowed) => {
  need(plain(value) && Object.keys(value).every(key => allowed.includes(key)), 'Use the supported recurring-work fields.');
  return value;
};
export function day(value) {
  need(typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value) &&
    Number.isFinite(Date.parse(value + 'T00:00:00.000Z')) &&
    new Date(value + 'T00:00:00.000Z').toISOString().slice(0, 10) === value, 'Use a real calendar date in YYYY-MM-DD form.');
  return value;
}
export function timestamp(value) {
  need(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, 'Retain the original UTC timestamp.');
  return value;
}
export function object(value) {
  need(plain(value), 'Supply the complete workflow input object.');
  const text = canonical(value);
  need(Buffer.byteLength(text) <= SERIES_MAX_BYTES, 'Keep the complete recurring input within 16 MiB.', 'CONSOLE_SERIES_SIZE', 413);
  return JSON.parse(text);
}
export function selectPointer(value, pointer) {
  for (const part of workflowPointer(pointer)) {
    need(value !== null && typeof value === 'object' && Object.hasOwn(value, part),
      'Supply the selected recurring input at ' + pointer + '.', 'CONSOLE_SERIES_INPUT_MISSING');
    value = value[part];
  }
  return clone(value);
}
export function assignPointer(value, pointer, replacement) {
  const parts = workflowPointer(pointer);
  if (!parts.length) return object(replacement);
  let parent = value;
  for (const part of parts.slice(0, -1)) {
    need(parent !== null && typeof parent === 'object' && Object.hasOwn(parent, part),
      'Retain the original input container at ' + pointer + '.', 'CONSOLE_SERIES_INPUT_TARGET');
    parent = parent[part];
  }
  need(parent !== null && typeof parent === 'object', 'Select an original object or array input container.', 'CONSOLE_SERIES_INPUT_TARGET');
  const leaf = parts.at(-1);
  if (Array.isArray(parent)) need(/^(0|[1-9][0-9]*)$/.test(leaf) && Number(leaf) < parent.length,
    'Select an existing input array position.', 'CONSOLE_SERIES_INPUT_TARGET');
  Object.defineProperty(parent, leaf, { value: clone(replacement), enumerable: true, configurable: true, writable: true });
  return value;
}
function cadence(value = { unit: 'manual' }) {
  fields(value, ['unit', 'interval', 'anchorDate']);
  need(['manual', 'day', 'week', 'month'].includes(value.unit), 'Select manual, daily, weekly or monthly calendar work.');
  if (value.unit === 'manual') {
    need(value.interval === undefined && value.anchorDate === undefined, 'Manual work selects its actual dates for each cycle.');
    return { unit: 'manual' };
  }
  need(Number.isSafeInteger(value.interval) && value.interval > 0 && value.interval <= 366, 'Use a calendar interval from 1 to 366.');
  return { unit: value.unit, interval: value.interval, anchorDate: day(value.anchorDate) };
}
const cyclePointers = new Set(['/id', '/runId', '/key', '/label', '/period/start', '/period/end', '/dueDate', '/sourceEdition', '/reason']);
function cycleBindings(values = []) {
  need(Array.isArray(values) && values.length <= 128, 'Use up to 128 explicit cycle input bindings.');
  const targets = [];
  return values.map(value => {
    fields(value, ['target', 'pointer']);
    const target = workflowPointer(value.target);
    need(cyclePointers.has(value.pointer), 'Select a named original cycle value for the input binding.');
    need(!targets.some(old => old.every((part, i) => target[i] === part) || target.every((part, i) => old[i] === part)),
      'Use separate input targets for cycle bindings.');
    targets.push(target);
    return { target: value.target, pointer: value.pointer };
  });
}
export function seriesRequest(input) {
  fields(input, ['requestId', 'id', 'profileId', 'expectedRevision', 'name', 'customer', 'task', 'workflowId', 'workflowRevision', 'baseInputs', 'cycleBindings', 'cadence', 'enabled']);
  const expectedRevision = input.expectedRevision ?? 0;
  need(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0, 'Use the current series revision, or zero for a new series.');
  need(input.enabled === undefined || typeof input.enabled === 'boolean', 'Choose whether new work is enabled.');
  return { requestId: identifier(input.requestId), id: identifier(input.id), profileId: identifier(input.profileId), expectedRevision,
    name: title(input.name), customer: title(input.customer), task: note(input.task, true),
    workflowId: identifier(input.workflowId), workflowRevision: revision(input.workflowRevision),
    baseInputs: object(input.baseInputs ?? {}), cycleBindings: cycleBindings(input.cycleBindings),
    cadence: cadence(input.cadence), enabled: input.enabled ?? true };
}
export const cycleId = (seriesId, key) => 'series-cycle-' + digest(canonical([seriesId, key])).slice(0, 40);
export const cycleRunId = (seriesId, key) => 'series-run-' + digest(canonical([seriesId, key])).slice(0, 40);
export function cycleRequest(input, series) {
  fields(input, ['seriesId', 'seriesRevision', 'key', 'label', 'period', 'dueDate', 'sourceEdition', 'reason', 'previousCycleId', 'inputs']);
  fields(input.period, ['start', 'end']);
  const period = { start: day(input.period.start), end: day(input.period.end) };
  need(period.start <= period.end, 'Choose the complete original period in chronological order.');
  const result = { seriesId: identifier(input.seriesId), seriesRevision: revision(input.seriesRevision),
    key: title(input.key), label: title(input.label), period, dueDate: day(input.dueDate),
    sourceEdition: note(input.sourceEdition ?? ''), reason: note(input.reason, true),
    previousCycleId: input.previousCycleId == null ? null : identifier(input.previousCycleId),
    inputs: object(input.inputs ?? series.baseInputs) };
  need(result.seriesId === series.id && result.seriesRevision === series.revision, 'Select the original series edition.', 'CONSOLE_SERIES_REVISION', 409);
  return result;
}
export function resolvedCycleInputs(series, request) {
  const values = { ...request, id: cycleId(series.id, request.key), runId: cycleRunId(series.id, request.key) };
  let inputs = clone(request.inputs);
  for (const binding of series.cycleBindings) inputs = assignPointer(inputs, binding.target, selectPointer(values, binding.pointer));
  return object(inputs);
}
export function installSeriesTables(db) {
  db.exec('CREATE TABLE IF NOT EXISTS workflow_series(id TEXT NOT NULL,revision INTEGER NOT NULL,profile_id TEXT NOT NULL REFERENCES profiles(id),request_id TEXT NOT NULL UNIQUE,value TEXT NOT NULL,PRIMARY KEY(id,revision));' +
    'CREATE INDEX IF NOT EXISTS workflow_series_profile ON workflow_series(profile_id,id,revision);' +
    'CREATE TABLE IF NOT EXISTS workflow_cycles(id TEXT PRIMARY KEY,series_id TEXT NOT NULL,profile_id TEXT NOT NULL REFERENCES profiles(id),cycle_key TEXT NOT NULL,value TEXT NOT NULL,UNIQUE(series_id,cycle_key));' +
    'CREATE INDEX IF NOT EXISTS workflow_cycles_profile ON workflow_cycles(profile_id,series_id);' +
    "CREATE INDEX IF NOT EXISTS workflow_cycles_due ON workflow_cycles(series_id,json_extract(value,'$.request.dueDate'),cycle_key);" +
    'CREATE TABLE IF NOT EXISTS workflow_cycle_cancellations(cycle_id TEXT PRIMARY KEY REFERENCES workflow_cycles(id),request_id TEXT NOT NULL UNIQUE,value TEXT NOT NULL);');
}
export function archiveSeriesRows(db, profileId) {
  const definitions = db.prepare('SELECT value FROM workflow_series WHERE profile_id=? ORDER BY id,revision').all(profileId).map(row => JSON.parse(row.value));
  const cycles = db.prepare('SELECT value FROM workflow_cycles WHERE profile_id=? ORDER BY series_id,cycle_key').all(profileId).map(row => JSON.parse(row.value));
  const cancellations = db.prepare('SELECT c.value FROM workflow_cycle_cancellations c JOIN workflow_cycles w ON w.id=c.cycle_id WHERE w.profile_id=? ORDER BY c.cycle_id').all(profileId).map(row => JSON.parse(row.value));
  return definitions.length || cycles.length ? { schema: SERIES_ARCHIVE_SCHEMA, definitions, cycles, cancellations } : undefined;
}
function checkSeal(value) {
  const { contentSha256, ...body } = value;
  need(digest(canonical(body)) === sha(contentSha256), 'Keep the complete original recurring-work record.', 'CONSOLE_SERIES_ARCHIVE_CHANGED');
}
export function validateSeriesRows(archive, { profile, workflowData }) {
  if (archive === undefined) return undefined;
  fields(archive, ['schema', 'definitions', 'cycles', 'cancellations']);
  need(archive.schema === SERIES_ARCHIVE_SCHEMA && Array.isArray(archive.definitions) && Array.isArray(archive.cycles) && Array.isArray(archive.cancellations) &&
    archive.definitions.length <= 10000 && archive.cycles.length <= 10000 && archive.cancellations.length <= 10000,
    'Receive the complete original series editions, cycles and cancellations.', 'CONSOLE_SERIES_ARCHIVE');
  const definitions = new Map(), requests = new Set(), cycles = new Map(), cancelled = new Set();
  const workflows = new Map((workflowData?.definitions ?? []).map(value => [value.id + ':' + value.revision, value]));
  const runs = new Map((workflowData?.runs ?? []).map(value => [value.id, value]));
  for (const value of archive.definitions) {
    fields(value, ['schema', 'id', 'revision', 'profileId', 'name', 'customer', 'task', 'workflowId', 'workflowRevision', 'workflowSha256', 'baseInputs', 'cycleBindings', 'cadence', 'enabled', 'request', 'requestSha256', 'workspaceId', 'createdAt', 'updatedAt', 'contentSha256']);
    checkSeal(value);
    const request = seriesRequest(value.request), key = value.id + ':' + value.revision;
    identifier(value.workspaceId); timestamp(value.createdAt); timestamp(value.updatedAt); revision(value.revision);
    need(value.schema === SERIES_SCHEMA && value.profileId === profile.id && !definitions.has(key) && !requests.has(request.requestId) &&
      value.revision === request.expectedRevision + 1 && digest(canonical(request)) === sha(value.requestSha256), 'Retain unique original series editions and save requests.', 'CONSOLE_SERIES_ARCHIVE');
    for (const name of ['id', 'profileId', 'name', 'customer', 'task', 'workflowId', 'workflowRevision', 'baseInputs', 'cycleBindings', 'cadence', 'enabled'])
      need(same(value[name], request[name]), 'Retain the original saved series selection.', 'CONSOLE_SERIES_ARCHIVE_CHANGED');
    const workflow = workflows.get(value.workflowId + ':' + value.workflowRevision);
    need(workflow?.profileId === profile.id && workflow.contentSha256 === sha(value.workflowSha256), 'Include the exact original workflow used by every series edition.', 'CONSOLE_SERIES_ARCHIVE');
    definitions.set(key, value); requests.add(request.requestId);
  }
  for (const value of definitions.values()) if (value.revision > 1) {
    const before = definitions.get(value.id + ':' + (value.revision - 1));
    need(before && before.createdAt === value.createdAt, 'Receive the complete series revision history.', 'CONSOLE_SERIES_ARCHIVE');
  }
  for (const value of archive.cycles) {
    fields(value, ['schema', 'id', 'runId', 'profileId', 'seriesId', 'seriesRevision', 'seriesSha256', 'workflowId', 'workflowRevision', 'workflowSha256', 'request', 'requestSha256', 'inputsJson', 'inputsSha256', 'review', 'workspaceId', 'createdAt', 'contentSha256']);
    checkSeal(value); identifier(value.workspaceId); timestamp(value.createdAt);
    const series = definitions.get(value.seriesId + ':' + value.seriesRevision);
    need(series && value.schema === CYCLE_SCHEMA && value.profileId === profile.id && value.seriesSha256 === series.contentSha256 && !cycles.has(value.id), 'Keep every cycle with its complete original series edition.', 'CONSOLE_SERIES_ARCHIVE');
    const request = cycleRequest(value.request, series), inputs = resolvedCycleInputs(series, request);
    need(value.id === cycleId(series.id, request.key) && value.runId === cycleRunId(series.id, request.key) &&
      same(value.request, request) && value.requestSha256 === digest(canonical(request)) && value.inputsJson === canonical(inputs) &&
      value.inputsSha256 === digest(value.inputsJson), 'Keep each period, source, input and original run identity.', 'CONSOLE_SERIES_ARCHIVE_CHANGED');
    for (const name of ['workflowId', 'workflowRevision', 'workflowSha256'])
      need(value[name] === series[name], 'Keep the cycle attached to its selected original workflow.', 'CONSOLE_SERIES_ARCHIVE_CHANGED');
    checkSeal(value.review);
    need(value.review.schema === SERIES_REVIEW_SCHEMA && value.review.kind === 'cycle' && value.review.canStart === true &&
      value.review.cycleId === value.id && value.review.runId === value.runId &&
      value.review.seriesSha256 === series.contentSha256 && value.review.workflowSha256 === value.workflowSha256 &&
      value.review.inputsSha256 === value.inputsSha256 && value.review.requestSha256 === value.requestSha256,
      'Retain the complete original cycle preparation review.', 'CONSOLE_SERIES_ARCHIVE_CHANGED');
    const run = runs.get(value.runId);
    if (run) need(run.profileId === profile.id && run.workflowId === value.workflowId && run.workflowRevision === value.workflowRevision &&
      run.workflowSha256 === value.workflowSha256 && run.inputsJson === value.inputsJson,
      'Keep the cycle with its original native run.', 'CONSOLE_SERIES_ARCHIVE_CHANGED');
    cycles.set(value.id, value);
  }
  for (const value of cycles.values()) if (value.request.previousCycleId !== null) {
    const previous = cycles.get(value.request.previousCycleId);
    need(previous && previous.seriesId === value.seriesId && previous.id !== value.id, 'Include the original cycle linked by this later period or source selection.', 'CONSOLE_SERIES_ARCHIVE');
  }
  for (const value of archive.cancellations) {
    fields(value, ['schema', 'cycleId', 'requestId', 'reason', 'workspaceId', 'createdAt', 'contentSha256']);
    checkSeal(value); identifier(value.requestId); identifier(value.workspaceId); timestamp(value.createdAt); note(value.reason, true);
    need(value.schema === CYCLE_SCHEMA && cycles.has(value.cycleId) && !cancelled.has(value.cycleId) && !requests.has(value.requestId) &&
      !runs.has(cycles.get(value.cycleId).runId), 'A canceled planned cycle retains no dispatched native run.', 'CONSOLE_SERIES_ARCHIVE');
    requests.add(value.requestId); cancelled.add(value.cycleId);
  }
  return clone(archive);
}
export function importSeriesRows(db, archive) {
  if (archive === undefined) return;
  for (const value of archive.definitions) {
    const rows = db.prepare('SELECT profile_id,value FROM workflow_series WHERE id=?').all(value.id);
    need(rows.every(row => row.profile_id === value.profileId), 'This series belongs to another original profile.', 'CONSOLE_SERIES_IMPORT_CONFLICT', 409);
    const old = rows.map(row => JSON.parse(row.value)).find(row => row.revision === value.revision);
    if (old) need(same(old, value), 'This series edition has different original customer or task selections.', 'CONSOLE_SERIES_IMPORT_CONFLICT', 409);
    else db.prepare('INSERT INTO workflow_series VALUES(?,?,?,?,?)').run(value.id, value.revision, value.profileId, value.request.requestId, JSON.stringify(value));
  }
  for (const value of archive.cycles) {
    const row = db.prepare('SELECT value FROM workflow_cycles WHERE id=?').get(value.id);
    if (row) need(same(JSON.parse(row.value), value), 'This cycle has different original period or input selections.', 'CONSOLE_SERIES_IMPORT_CONFLICT', 409);
    else db.prepare('INSERT INTO workflow_cycles VALUES(?,?,?,?,?)').run(value.id, value.seriesId, value.profileId, value.request.key, JSON.stringify(value));
  }
  for (const value of archive.cancellations) {
    const row = db.prepare('SELECT value FROM workflow_cycle_cancellations WHERE cycle_id=?').get(value.cycleId);
    if (row) need(same(JSON.parse(row.value), value), 'This cancellation has different original contents.', 'CONSOLE_SERIES_IMPORT_CONFLICT', 409);
    else db.prepare('INSERT INTO workflow_cycle_cancellations VALUES(?,?,?)').run(value.cycleId, value.requestId, JSON.stringify(value));
  }
}
const DAY_MS = 86400000;
const atDay = value => Date.parse(day(value) + 'T00:00:00.000Z');
function formatDay(value) {
  need(Number.isFinite(value), 'Choose dates inside the supported calendar.');
  const result = new Date(value).toISOString();
  return day(result.slice(0, 10));
}
function boundary(plan, index) {
  const origin = atDay(plan.anchorDate);
  if (plan.unit !== 'month') return origin + index * plan.interval * (plan.unit === 'week' ? 7 : 1) * DAY_MS;
  const original = new Date(origin), count = original.getUTCFullYear() * 12 + original.getUTCMonth() + index * plan.interval;
  const year = Math.floor(count / 12), month = count % 12;
  need(year >= 0 && year <= 9999, 'Choose dates inside the supported calendar.');
  const target = new Date(origin); target.setUTCFullYear(year, month + 1, 0);
  const last = target.getUTCDate(); target.setUTCFullYear(year, month, Math.min(original.getUTCDate(), last));
  return target.getTime();
}
/** Calendar planning yields complete periods. It never dispatches a native request. */
export function seriesCalendar(series, { from, to, limit = 120 } = {}) {
  day(from); day(to); need(from <= to, 'Select the calendar window in chronological order.');
  need(Number.isSafeInteger(limit) && limit > 0 && limit <= 366, 'Select up to 366 complete calendar periods.');
  const plan = cadence(series.cadence);
  if (plan.unit === 'manual') return { periods: [], nextFrom: null, manual: true };
  const start = atDay(from), end = atDay(to), origin = atDay(plan.anchorDate);
  let index;
  if (plan.unit === 'month') {
    const a = new Date(start), b = new Date(origin);
    index = Math.max(0, Math.floor(((a.getUTCFullYear() - b.getUTCFullYear()) * 12 + a.getUTCMonth() - b.getUTCMonth()) / plan.interval) - 1);
  } else index = Math.max(0, Math.floor((start - origin) / (plan.interval * (plan.unit === 'week' ? 7 : 1) * DAY_MS)) - 1);
  const periods = [];
  for (;;) {
    const first = boundary(plan, index), next = boundary(plan, index + 1);
    if (first > end) return { periods, nextFrom: null, manual: false };
    if (next > start) {
      if (periods.length === limit) return { periods, nextFrom: formatDay(first), manual: false };
      const period = { start: formatDay(first), end: formatDay(next - DAY_MS) };
      periods.push({ key: period.start + '..' + period.end, label: period.start + ' to ' + period.end, period, dueDate: period.end });
    }
    index++;
  }
}
