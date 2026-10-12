/**
 * Explicit municipal agency calendars and date-only service targets.
 * No dependencies; source timestamps, chosen timezone and calendar remain separate.
 */
export class ServiceCalendarError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ServiceCalendarError';
    this.code = code;
  }
}
const fail = (code, message) => { throw new ServiceCalendarError(code, message); };
const DAY_MS = 86400000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;
const pad = (value, width = 2) => String(value).padStart(width, '0');
const leap = year => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
const daysInMonth = (year, month) => [31, leap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
function validParts(year, month, day) {
  return Number.isInteger(year) && year >= 1 && year <= 9999 &&
    Number.isInteger(month) && month >= 1 && month <= 12 &&
    Number.isInteger(day) && day >= 1 && day <= daysInMonth(year, month);
}
function dateParts(value, label) {
  const match = typeof value === 'string' && DATE_RE.exec(value);
  if (!match) fail('INVALID_CALENDAR_DATE', label + ' must be an exact YYYY-MM-DD date.');
  const result = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (!validParts(result.year, result.month, result.day)) {
    fail('INVALID_CALENDAR_DATE', label + ' must be a valid Gregorian date in years 0001 through 9999.');
  }
  return result;
}
function ordinal(year, month, day) {
  // setUTCFullYear avoids Date.UTC's special interpretation of years 00 through 99.
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime() / DAY_MS;
}
const MIN_ORDINAL = ordinal(1, 1, 1);
const MAX_ORDINAL = ordinal(9999, 12, 31);
function renderOrdinal(value) {
  if (!Number.isSafeInteger(value) || value < MIN_ORDINAL || value > MAX_ORDINAL) {
    fail('DUE_DATE_OUT_OF_RANGE', 'The configured target is outside years 0001 through 9999.');
  }
  const date = new Date(value * DAY_MS);
  return pad(date.getUTCFullYear(), 4) + '-' + pad(date.getUTCMonth() + 1) + '-' + pad(date.getUTCDate());
}
const weekday = value => ((value + 4) % 7 + 7) % 7;
function formatter(timeZone) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      calendar: 'gregory', numberingSystem: 'latn', timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit', era: 'short'
    });
  } catch {
    fail('INVALID_TIME_ZONE', 'agency.timeZone must name a supported IANA timezone.');
  }
}
/**
 * Validate and copy the explicitly selected timezone/calendar.
 * Returned arrays are new arrays; the caller's agency object is not mutated.
 */
export function validateCalendar(agency) {
  if (!agency || typeof agency !== 'object' || Array.isArray(agency)) {
    fail('INVALID_AGENCY_CALENDAR', 'An agency with an explicit timeZone and calendar is required.');
  }
  const timeZone = agency.timeZone;
  if (typeof timeZone !== 'string' || !/^[A-Za-z_][A-Za-z0-9_+\-]*(?:\/[A-Za-z0-9_+\-]+)*$/.test(timeZone)) {
    fail('INVALID_TIME_ZONE', 'agency.timeZone must name a supported IANA timezone, with no surrounding whitespace.');
  }
  formatter(timeZone);
  const input = agency.calendar;
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      !['calendar_days', 'business_days'].includes(input.kind)) {
    fail('INVALID_AGENCY_CALENDAR', 'agency.calendar.kind must be calendar_days or business_days.');
  }
  if (!Array.isArray(input.weekdays) || !Array.isArray(input.holidays)) {
    fail('INVALID_AGENCY_CALENDAR', 'Calendar weekdays and holidays must be explicit arrays.');
  }
  if (input.weekdays.some(value => !Number.isInteger(value) || value < 0 || value > 6)) {
    fail('INVALID_CALENDAR_WEEKDAYS', 'Weekdays must be integers Sunday=0 through Saturday=6.');
  }
  const weekdays = [...input.weekdays];
  if (new Set(weekdays).size !== weekdays.length) {
    fail('INVALID_CALENDAR_WEEKDAYS', 'Calendar weekdays must not contain duplicate selections.');
  }
  if (input.kind === 'business_days' && weekdays.length === 0) {
    fail('INVALID_CALENDAR_WEEKDAYS', 'A business-day calendar requires at least one selected weekday.');
  }
  const holidays = [...input.holidays];
  for (let index = 0; index < holidays.length; index++) {
    dateParts(holidays[index], 'agency.calendar.holidays[' + index + ']');
  }
  if (new Set(holidays).size !== holidays.length) {
    fail('INVALID_CALENDAR_HOLIDAYS', 'Calendar holidays must not contain duplicate dates.');
  }
  return { timeZone, calendar: { kind: input.kind, weekdays, holidays } };
}
function creationDate(value, timeZone) {
  if (typeof value !== 'string' || !value) {
    fail('INVALID_CREATION_DATE', 'The creation value must be a complete ISO timestamp with an explicit UTC offset.');
  }
  const match = INSTANT_RE.exec(value);
  if (!match) {
    fail('INVALID_CREATION_DATE', 'The creation value must use YYYY-MM-DDTHH:mm:ss, optional fractional seconds, and Z or an explicit ±HH:MM offset.');
  }
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const hour = Number(match[4]), minute = Number(match[5]), second = Number(match[6]);
  if (!validParts(year, month, day) || hour > 23 || minute > 59 || second > 59) {
    fail('INVALID_CREATION_DATE', 'The creation timestamp contains an invalid Gregorian date or time.');
  }
  const zone = match[8];
  if (zone === '-00:00') {
    fail('UNKNOWN_CREATION_OFFSET', 'The -00:00 source offset does not establish the creation instant.');
  }
  if (zone !== 'Z') {
    const offsetHours = Number(zone.slice(1, 3)), offsetMinutes = Number(zone.slice(4, 6));
    if (offsetHours > 23 || offsetMinutes > 59) {
      fail('INVALID_CREATION_DATE', 'The creation timestamp has an invalid UTC offset.');
    }
  }
  // Parse only after validating every civil component. Date.parse alone can normalize an invalid day.
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) fail('INVALID_CREATION_DATE', 'The creation timestamp cannot be interpreted.');
  const parts = {};
  for (const part of formatter(timeZone).formatToParts(new Date(milliseconds))) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  const local = { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
  if (parts.era !== 'AD' || !validParts(local.year, local.month, local.day)) {
    fail('DUE_DATE_OUT_OF_RANGE', 'The agency-local creation date is outside years 0001 through 9999.');
  }
  return {
    date: pad(local.year, 4) + '-' + pad(local.month) + '-' + pad(local.day),
    ordinal: ordinal(local.year, local.month, local.day)
  };
}
function upperBound(sorted, value) {
  let low = 0, high = sorted.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (sorted[middle] <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}
function businessCounter(start, calendar) {
  const eligible = new Set(calendar.weekdays);
  const holidayOrdinals = calendar.holidays.map(value => {
    const p = dateParts(value, 'Calendar holiday');
    return ordinal(p.year, p.month, p.day);
  }).filter(value => eligible.has(weekday(value))).sort((a, b) => a - b);
  const holidaysBeforeOrAtStart = upperBound(holidayOrdinals, start);
  return end => {
    const length = end - start;
    const weeks = Math.floor(length / 7);
    let count = weeks * eligible.size;
    const remaining = length % 7;
    for (let offset = 1; offset <= remaining; offset++) {
      if (eligible.has(weekday(start + weeks * 7 + offset))) count++;
    }
    return count - (upperBound(holidayOrdinals, end) - holidaysBeforeOrAtStart);
  };
}
function addBusinessDays(start, amount, calendar) {
  if (amount === 0) return start;
  const countThrough = businessCounter(start, calendar);
  if (countThrough(MAX_ORDINAL) < amount) {
    fail('DUE_DATE_OUT_OF_RANGE', 'The configured business-day target is outside years 0001 through 9999.');
  }
  // Binary search limits arithmetic even for a large configured interval.
  let low = start + 1, high = MAX_ORDINAL;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (countThrough(middle) >= amount) high = middle;
    else low = middle + 1;
  }
  return low;
}
/**
 * @param {string|null} createdAt Original offset-bearing creation timestamp.
 * @param {number|null} resolutionDays Nonnegative safe integer, or null for no target.
 * @param {object} agency Explicit IANA timezone and calendar declaration.
 * @returns {{date:string|null,timeZone:string,calendar:object,sourceCreatedAt:string|null,createdLocalDate:string|null}}
 */
export function calculateDueDate(createdAt, resolutionDays, agency) {
  const selected = validateCalendar(agency);
  if (resolutionDays !== null && (!Number.isSafeInteger(resolutionDays) || resolutionDays < 0)) {
    fail('INVALID_RESOLUTION_DAYS', 'resolutionDays must be a nonnegative safe integer or null.');
  }
  const absent = createdAt === null || createdAt === undefined || createdAt === '';
  if (absent && resolutionDays !== null) {
    fail('MISSING_CREATION_DATE', 'A source creation timestamp is required to calculate the configured target.');
  }
  const local = absent ? null : creationDate(createdAt, selected.timeZone);
  const result = {
    date: null,
    timeZone: selected.timeZone,
    calendar: selected.calendar,
    sourceCreatedAt: createdAt === undefined ? null : createdAt,
    createdLocalDate: local ? local.date : null
  };
  if (resolutionDays === null) return result;
  const end = selected.calendar.kind === 'calendar_days'
    ? local.ordinal + resolutionDays
    : addBusinessDays(local.ordinal, resolutionDays, selected.calendar);
  result.date = renderOrdinal(end);
  return result;
}
