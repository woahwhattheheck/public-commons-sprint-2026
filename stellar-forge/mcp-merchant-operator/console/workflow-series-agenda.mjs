// MIT. Cross-customer delivery planning over original series and cycle records.
import { digest, canonical } from './records.mjs';
import { fields, need, identifier, day, timestamp, seriesCalendar, cycleId } from './workflow-series-records.mjs';

export const SERIES_AGENDA_SCHEMA = 'stellar-forge.merchant-workflow-agenda.v1';
const DAY = 86400000;
const finished = state => state === 'COMPLETE' || state === 'CANCELLED';
const states = ['all', 'open', 'PROPOSED', 'PLANNED', 'READY', 'RUNNING', 'PAUSED', 'WAITING', 'COMPLETE', 'CANCELLED'];
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export function workflowAgendaRequest(input, today = new Date().toISOString().slice(0, 10)) {
  fields(input, ['profileId', 'from', 'to', 'today', 'query', 'status', 'includeOverdue', 'includeProposed', 'offset', 'limit']);
  const result = { profileId: identifier(input.profileId), from: day(input.from), to: day(input.to),
    today: day(input.today ?? today), query: input.query ?? '', status: input.status ?? 'open',
    includeOverdue: input.includeOverdue ?? true, includeProposed: input.includeProposed ?? true,
    offset: input.offset ?? 0, limit: input.limit ?? 50 };
  need(result.from <= result.to && Date.parse(result.to) - Date.parse(result.from) < 366 * DAY,
    'Choose a due-date window of up to 366 days.');
  need(typeof result.query === 'string' && result.query.length <= 160 &&
    !/[\x00-\x1f]/.test(result.query), 'Search by customer, task, series or source using up to 160 characters.');
  result.query = result.query.trim();
  need(states.includes(result.status), 'Choose a displayed work status.');
  need(typeof result.includeOverdue === 'boolean' && typeof result.includeProposed === 'boolean',
    'Choose whether to include earlier overdue work and proposed periods.');
  need(Number.isSafeInteger(result.offset) && result.offset >= 0 &&
    Number.isSafeInteger(result.limit) && result.limit > 0 && result.limit <= 100,
    'Use a work page of up to 100 rows.');
  return result;
}

function dueGroup(item, today) {
  if (item.state === 'COMPLETE') return 'complete';
  if (item.state === 'CANCELLED') return 'cancelled';
  if (item.dueDate < today) return 'overdue';
  return item.dueDate === today ? 'today' : 'upcoming';
}

/** Entries have already passed the original series and native-cycle authorization. */
export function workflowAgenda({ query, entries, generatedAt = new Date().toISOString(), complete = false }) {
  query = workflowAgendaRequest(query); timestamp(generatedAt);
  const items = [], needle = query.query.toLocaleLowerCase('en-US');
  for (const entry of entries) {
    const current = entry.series, occupied = new Set(entry.occupiedKeys ?? entry.cycles.map(value => value.status.key));
    for (const { status, series: selected = current } of entry.cycles) {
      items.push({ ...status, kind: 'saved', profileId: query.profileId,
        seriesName: selected.name, customer: selected.customer, task: selected.task,
        seriesEnabled: current.enabled, currentSeriesRevision: current.revision,
        nextAction: finished(status.state) ? 'Open period' : status.state === 'PLANNED' ?
          (current.enabled ? 'Review first start' : 'Open paused series') : 'Open original run' });
    }
    if (query.includeProposed && current.enabled) {
      const calendar = seriesCalendar(current, { from: query.from, to: query.to, limit: 366 });
      need(calendar.nextFrom === null, 'Choose a shorter calendar window to include every complete period.');
      for (const period of calendar.periods) if (!occupied.has(period.key)) {
        items.push({ ...period, id: cycleId(current.id, period.key), kind: 'proposed', state: 'PROPOSED',
          profileId: query.profileId, seriesId: current.id, seriesRevision: current.revision,
          currentSeriesRevision: current.revision, seriesName: current.name, customer: current.customer,
          task: current.task, seriesEnabled: true, runId: null, sourceEdition: '', reason: '',
          active: false, stepsComplete: 0, stepCount: null, completedAt: null,
          nextAction: 'Select source and inputs' });
      }
    }
  }
  const selected = items.filter(item => {
    const inside = item.dueDate >= query.from && item.dueDate <= query.to;
    const overdue = item.kind === 'saved' && !finished(item.state) && item.dueDate < query.today &&
      item.dueDate < query.from && query.includeOverdue;
    if (!inside && !overdue) return false;
    if (query.status === 'open' ? finished(item.state) : query.status !== 'all' && item.state !== query.status) return false;
    return !needle || [item.customer, item.task, item.seriesName, item.label, item.key, item.sourceEdition]
      .some(value => String(value ?? '').toLocaleLowerCase('en-US').includes(needle));
  }).map(item => ({ ...item, dueGroup: dueGroup(item, query.today) }));
  selected.sort((a, b) => compare(a.dueDate, b.dueDate) || compare(a.customer, b.customer) ||
    compare(a.seriesId, b.seriesId) || compare(a.key, b.key) || compare(a.id, b.id));
  const counts = { total: selected.length, saved: 0, proposed: 0, overdue: 0, today: 0,
    upcoming: 0, complete: 0, cancelled: 0, active: 0, attention: 0 };
  for (const item of selected) {
    counts[item.kind === 'saved' ? 'saved' : 'proposed']++;
    counts[item.dueGroup]++;
    if (item.active) counts.active++;
    if (['WAITING', 'PAUSED'].includes(item.state)) counts.attention++;
  }
  const offset = complete ? 0 : query.offset, limit = complete ? selected.length : query.limit;
  return { schema: SERIES_AGENDA_SCHEMA, profileId: query.profileId, generatedAt, query, counts,
    total: selected.length, offset, nextOffset: offset + limit < selected.length ? offset + limit : null,
    items: selected.slice(offset, offset + limit) };
}

function calendarText(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
}
function foldCalendarLine(line) {
  const lines = []; let part = '', bytes = 0;
  for (const character of line) {
    const length = Buffer.byteLength(character, 'utf8');
    if (bytes + length > 75) { lines.push(part); part = ' '; bytes = 1; }
    part += character; bytes += length;
  }
  lines.push(part); return lines.join('\r\n');
}

/** One all-day, transparent deadline event per original cycle or unsaved proposal. */
export function workflowAgendaCalendar(agenda) {
  need(agenda.schema === SERIES_AGENDA_SCHEMA && agenda.offset === 0 && agenda.nextOffset === null &&
    agenda.items.length === agenda.total, 'Export the complete selected work agenda.');
  timestamp(agenda.generatedAt);
  const stamp = agenda.generatedAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TokenJunkieLabs//Merchant delivery agenda//EN',
    'CALSCALE:GREGORIAN'];
  for (const item of agenda.items) {
    day(item.dueDate);
    const details = ['Customer: ' + item.customer, 'Task: ' + item.task,
      'Series: ' + item.seriesName + ' (edition ' + item.seriesRevision + ')',
      'Work period: ' + item.period.start + ' to ' + item.period.end,
      'Status: ' + item.state, 'Next action: ' + item.nextAction,
      'Period key: ' + item.key, 'Series ID: ' + item.seriesId];
    if (item.kind === 'saved') details.push('Cycle ID: ' + item.id);
    if (item.runId) details.push('Original run: ' + item.runId);
    if (item.sourceEdition) details.push('Source: ' + item.sourceEdition);
    if (item.reason) details.push('Reason: ' + item.reason);
    const identity = digest(canonical([agenda.profileId, item.seriesId, item.key]));
    lines.push('BEGIN:VEVENT', 'UID:' + identity + '@merchant.tokenjunkielabs',
      'DTSTAMP:' + stamp, 'DTSTART;VALUE=DATE:' + item.dueDate.replace(/-/g, ''),
      'DURATION:P1D', 'TRANSP:TRANSPARENT', 'CLASS:PRIVATE',
      'STATUS:' + (item.state === 'CANCELLED' ? 'CANCELLED' : item.kind === 'proposed' ? 'TENTATIVE' : 'CONFIRMED'),
      'SUMMARY:' + calendarText(item.customer + ' — ' + item.label + (item.state === 'COMPLETE' ? ' (complete)' : '')),
      'DESCRIPTION:' + calendarText(details.join('\n')), 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  const content = lines.map(foldCalendarLine).join('\r\n') + '\r\n';
  need(Buffer.byteLength(content) <= 32 * 1024 * 1024,
    'Choose a smaller date window or customer selection for the complete calendar export.', 'CONSOLE_SERIES_SIZE', 413);
  return { filename: 'customer-work-' + agenda.query.from + '-to-' + agenda.query.to + '.ics',
    mediaType: 'text/calendar; charset=utf-8', content, events: agenda.total,
    generatedAt: agenda.generatedAt, query: agenda.query };
}
