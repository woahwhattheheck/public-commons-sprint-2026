/**
 * Validate the actual Gregorian date/time fields of an RFC3339 timestamp.
 *
 * Date.parse() normalizes invalid civil dates (for example February 30 and
 * 24:00), so successful parsing alone cannot validate signed deadlines.
 * Browser and server import this same dependency-free predicate to avoid
 * disagreeing about which timestamps are admissible.
 */
export function isValidRfc3339(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = Number(match[7] ?? 0);
  const offsetMinute = Number(match[8] ?? 0);
  if (year < 1 || month < 1 || month > 12 || hour > 23 ||
      minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) {
    return false;
  }

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > daysInMonth[month - 1]) return false;

  return Number.isFinite(Date.parse(value));
}
