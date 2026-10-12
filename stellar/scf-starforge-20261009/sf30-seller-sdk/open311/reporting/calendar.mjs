// MIT. Named operator calendars resolved one local date at a time.
import { canonicalJson } from '../domain.mjs';
import { createHash } from 'node:crypto';

export function fail(code, message, status = 400, details = null) {
  const error = new Error(message); Object.assign(error, { code, status, details }); throw error;
}
export const copy = value => JSON.parse(canonicalJson(value));
export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonicalJson(value)).digest('hex');
export function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_INPUT', name + ' must be an object.');
  return value;
}
export function label(value, name, maximum = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || value.includes('\0')) fail('INVALID_INPUT', name + ' must contain 1–' + maximum + ' characters.');
  return value;
}
export function instant(value, name = 'Timestamp') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))
    fail('INVALID_TIMESTAMP', name + ' requires an ISO datetime with a UTC offset.');
  const day = value.slice(0, 10); dateOnly(day);
  return Date.parse(value);
}
export function maybeInstant(value) { try { return instant(value); } catch { return null; } }
export function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + 'T00:00:00Z')) ||
      new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value)
    fail('INVALID_LOCAL_DATE', 'Use a real calendar date in YYYY-MM-DD form.');
  return value;
}
const formatters = new Map();
function formatter(timeZone) {
  if (!formatters.has(timeZone)) {
    try {
      const selected = new Intl.DateTimeFormat('en-CA', { timeZone, calendar: 'iso8601',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
      selected.format(0); formatters.set(timeZone, selected);
    } catch { fail('INVALID_TIME_ZONE', 'Choose a valid IANA timezone.'); }
  }
  return formatters.get(timeZone);
}
function parts(ms, timeZone) {
  return Object.fromEntries(formatter(timeZone).formatToParts(new Date(ms)).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
}
export function localDate(ms, timeZone) {
  const p = parts(ms, timeZone); return p.year + '-' + p.month + '-' + p.day;
}
export function nextDate(date, days = 1) {
  return new Date(Date.parse(dateOnly(date) + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}
function clock(value, end = false) {
  if (end && value === '24:00') return 1440;
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) fail('INVALID_LOCAL_TIME', 'Working boundaries use HH:mm; 24:00 is allowed only for an end.');
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}
function intervals(value, name) {
  if (!Array.isArray(value)) fail('INVALID_CALENDAR', name + ' must be an interval array.');
  const found = value.map(v => {
    object(v, name + ' interval'); const a = clock(v.start), b = clock(v.end, true);
    if (b <= a) fail('INVALID_CALENDAR', 'Split overnight work into separate dated intervals.');
    return { start: v.start, end: v.end, a, b };
  }).sort((a, b) => a.a - b.a);
  for (let i = 1; i < found.length; i++) if (found[i].a < found[i - 1].b) fail('INVALID_CALENDAR', 'Working intervals cannot overlap.');
  return found.map(({ start, end }) => ({ start, end }));
}
export function normalizeCalendar(input) {
  object(input, 'Calendar'); label(input.id, 'Calendar ID', 120); label(input.name, 'Calendar name');
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) fail('INVALID_CALENDAR', 'Calendar revision must be a positive integer.');
  formatter(label(input.timeZone, 'Calendar timezone', 100));
  object(input.weeklyIntervals, 'Weekly intervals');
  if (Object.keys(input.weeklyIntervals).some(k => !/^[0-6]$/.test(k))) fail('INVALID_CALENDAR', 'Weekdays use 0=Sunday through 6=Saturday.');
  const weeklyIntervals = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [String(i), intervals(input.weeklyIntervals[i] ?? [], 'Weekday ' + i)]));
  const dateOverrides = {};
  for (const [date, selected] of Object.entries(input.dateOverrides ?? {})) dateOverrides[dateOnly(date)] = intervals(selected, date);
  const effectiveFrom = input.effectiveFrom ? dateOnly(input.effectiveFrom) : null;
  const effectiveUntil = input.effectiveUntil ? dateOnly(input.effectiveUntil) : null;
  if (effectiveFrom && effectiveUntil && effectiveUntil <= effectiveFrom) fail('INVALID_CALENDAR', 'Calendar effectiveUntil is an exclusive date after effectiveFrom.');
  if (![...Object.values(weeklyIntervals), ...Object.values(dateOverrides)].some(v => v.length)) fail('INVALID_CALENDAR', 'The calendar contains no working intervals.');
  const disambiguation = input.disambiguation ?? 'reject';
  if (!['reject', 'earlier', 'later'].includes(disambiguation)) fail('INVALID_CALENDAR', 'Repeated DST boundaries require reject, earlier or later.');
  const sourceReferences = input.sourceReferences ?? [];
  if (!Array.isArray(sourceReferences) || !sourceReferences.length || sourceReferences.some(v => typeof v !== 'string' || !v.trim()))
    fail('INVALID_CALENDAR', 'Name the operator or source that supplied this calendar.');
  return { schema: 'commons.open311.reporting-calendar.v1', id: input.id, name: input.name, revision: input.revision,
    timeZone: input.timeZone, weeklyIntervals, dateOverrides, effectiveFrom, effectiveUntil, disambiguation, sourceReferences: copy(sourceReferences) };
}
export function resolveLocal(date, time, timeZone, disambiguation = 'reject') {
  dateOnly(date); const minutes = clock(time, true);
  if (minutes === 1440) { date = nextDate(date); time = '00:00'; }
  const wall = Date.parse(date + 'T' + time + ':00Z'), offsets = new Set();
  for (let h = -48; h <= 48; h += 6) {
    const ms = wall + h * 3600000, p = parts(ms, timeZone);
    offsets.add(Date.parse(p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute + ':' + p.second + 'Z') - ms);
  }
  const candidates = [...offsets].map(offset => wall - offset).filter(ms => {
    const p = parts(ms, timeZone);
    return p.year + '-' + p.month + '-' + p.day === date && p.hour + ':' + p.minute === time && p.second === '00';
  }).sort((a, b) => a - b);
  if (!candidates.length) fail('NONEXISTENT_LOCAL_BOUNDARY', 'The local boundary ' + date + ' ' + time + ' does not exist in ' + timeZone + '. Save an explicit date override with a real boundary.');
  if (candidates.length > 1 && disambiguation === 'reject') fail('AMBIGUOUS_LOCAL_BOUNDARY', 'Choose earlier or later for repeated local boundary ' + date + ' ' + time + ' in ' + timeZone + '.');
  return disambiguation === 'later' ? candidates.at(-1) : candidates[0];
}
export function calendarResolver(calendars) {
  const byKey = new Map(calendars.map(c => [c.id + '@' + c.revision, c]));
  const resolved = new Map();
  function dateIntervals(key, date) {
    const cacheKey = key + '/' + date;
    if (resolved.has(cacheKey)) return resolved.get(cacheKey).intervals;
    const c = byKey.get(key); if (!c) fail('CALENDAR_NOT_FOUND', 'Target calendar edition ' + key + ' was not found.');
    let selected = c.dateOverrides[date] ?? c.weeklyIntervals[new Date(date + 'T00:00:00Z').getUTCDay()];
    if (c.effectiveFrom && date < c.effectiveFrom || c.effectiveUntil && date >= c.effectiveUntil) selected = [];
    const list = selected.map(v => {
      const start = resolveLocal(date, v.start, c.timeZone, c.disambiguation), end = resolveLocal(date, v.end, c.timeZone, c.disambiguation);
      if (end <= start) fail('INVALID_RESOLVED_INTERVAL', 'A working interval has no positive elapsed time after timezone conversion.');
      return { localStart: date + 'T' + v.start, localEnd: date + 'T' + v.end, start: new Date(start).toISOString(), end: new Date(end).toISOString() };
    });
    for (let i = 1; i < list.length; i++) if (Date.parse(list[i].start) < Date.parse(list[i - 1].end)) fail('INVALID_RESOLVED_INTERVAL', 'Resolved UTC intervals overlap.');
    resolved.set(cacheKey, { calendar: key, timeZone: c.timeZone, date, intervals: list });
    return list;
  }
  function add(key, origin, durationMinutes) {
    const c = byKey.get(key); if (!c) fail('CALENDAR_NOT_FOUND', 'Choose an existing calendar edition.');
    if (durationMinutes === 0) return origin;
    let date = localDate(origin, c.timeZone), remaining = durationMinutes * 60000;
    for (let day = 0; day < 3660; day++, date = nextDate(date)) {
      if (c.effectiveUntil && date >= c.effectiveUntil) break;
      for (const span of dateIntervals(key, date)) {
        const start = Math.max(origin, Date.parse(span.start)), end = Date.parse(span.end);
        if (end <= start) continue;
        if (remaining <= end - start) return start + remaining;
        remaining -= end - start;
      }
    }
    fail('NO_REACHABLE_WORKING_TIME', 'The selected calendar cannot supply this target within its effective dates and the ten-year calculation horizon.');
  }
  function between(key, start, end) {
    if (end < start) fail('REVERSED_INTERVAL', 'The interval ends before its origin.');
    const c = byKey.get(key); if (!c) fail('CALENDAR_NOT_FOUND', 'Choose an existing calendar edition.');
    let date = localDate(start, c.timeZone), final = localDate(end, c.timeZone), minutes = 0, days = 0;
    for (; date <= final; date = nextDate(date)) {
      if (++days > 3660) fail('CALENDAR_HORIZON', 'The calculation exceeds the ten-year calendar horizon.');
      for (const span of dateIntervals(key, date)) minutes += Math.max(0, Math.min(end, Date.parse(span.end)) - Math.max(start, Date.parse(span.start))) / 60000;
    }
    return minutes;
  }
  return { add, between, intervals: () => [...resolved.values()].sort((a, b) => (a.calendar + a.date).localeCompare(b.calendar + b.date)) };
}
