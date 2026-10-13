// Retained process-time capabilities for the production-current boundary.
//
// These references are captured during trusted module initialization. Later caller
// mutation of globalThis.Date, Date.now/parse, or Date.prototype methods cannot
// change currentness/admission semantics in this product generation.
const RetainedDate = globalThis.Date;
const retainedDateNow = RetainedDate.now.bind(RetainedDate);
const retainedDateParse = RetainedDate.parse.bind(RetainedDate);
const retainedGetTime = Function.prototype.call.bind(RetainedDate.prototype.getTime);
const retainedToISOString = Function.prototype.call.bind(RetainedDate.prototype.toISOString);
const retainedFloor = Math.floor;
const retainedIsFinite = Number.isFinite;

export function parseRetainedDateMs(value) {
  return retainedDateParse(value);
}

export function isCanonicalDateString(value) {
  const date = new RetainedDate(`${value}T00:00:00Z`);
  return retainedIsFinite(retainedGetTime(date)) && retainedToISOString(date).slice(0, 10) === value;
}

export function isCanonicalUtcString(value) {
  const date = new RetainedDate(value);
  return retainedIsFinite(retainedGetTime(date)) && retainedToISOString(date).replace('.000Z', 'Z') === value;
}

export function processUtcNow() {
  const ms = retainedFloor(retainedDateNow() / 1000) * 1000;
  return retainedToISOString(new RetainedDate(ms)).replace('.000Z', 'Z');
}
