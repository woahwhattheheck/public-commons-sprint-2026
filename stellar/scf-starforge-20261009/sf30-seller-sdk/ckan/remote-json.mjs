// MIT. Exact JSON values and canonical identities for remote CKAN publication.
import { ExactCkanNumber, parseCkanJson } from './capture.mjs';
import { digest, fault } from '../postgres/publisher/files.mjs';

export const isRemoteNumber = value => typeof value === 'number' || value instanceof ExactCkanNumber;
function numeric(value) {
  const source = value instanceof ExactCkanNumber ? value.source :
    Object.is(value, -0) ? '-0' : String(value);
  const match = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(source);
  if (!match || typeof value === 'number' && !Number.isFinite(value))
    throw fault('CKAN_REMOTE_NUMBER_INVALID');
  const fraction = match[3] ?? '';
  let digits = (match[2] + fraction).replace(/^0+/, '');
  if (!digits) return match[1] + '0';
  const trailing = /0*$/.exec(digits)[0].length;
  if (trailing) digits = digits.slice(0, -trailing);
  return match[1] + digits + 'e' + (BigInt(match[4] ?? '0') - BigInt(fraction.length) + BigInt(trailing));
}
export function remoteNumericEqual(a, b) {
  return isRemoteNumber(a) && isRemoteNumber(b) && numeric(a) === numeric(b);
}
export function cloneRemote(value) {
  if (Object.is(value, -0)) return new ExactCkanNumber('-0');
  if (value instanceof ExactCkanNumber) { numeric(value); return new ExactCkanNumber(value.source); }
  if (Array.isArray(value)) return value.map(cloneRemote);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneRemote(item)]));
  return value;
}
function canonical(value) {
  if (isRemoteNumber(value)) return numeric(value);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return '{' + Object.keys(value).filter(key => value[key] !== undefined).sort()
      .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  throw fault('CKAN_REMOTE_JSON_REQUIRED');
}
export const remoteIdentity = value => digest(canonical(value));

export const stringifyRemote = (value, space = 2) => JSON.stringify(value, null, space);
export const parseRemote = value => parseCkanJson(typeof value === 'string' ? Buffer.from(value) : value);
