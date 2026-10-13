// MIT. Shared CanadaBuys values and explicit revision handling.
import { createHash } from 'node:crypto';
export const LEGACY_WORKSPACE_SCHEMA = 'starforge.canadabuys.workspace.v1';
export const LEGACY_PACKAGE_SCHEMA = 'starforge.canadabuys.package.v1';
export const WORKSPACE_SCHEMA = 'starforge.canadabuys.workspace.v2';
export const PACKAGE_SCHEMA = 'starforge.canadabuys.package.v2';
export const STREAMS = ['open-tenders', 'new-tenders', 'complete-tenders', 'awards', 'supply-arrangements'];
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const canonical = value => {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).filter(key => value[key] !== undefined).sort()
    .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
};
export function failure(code, message, status = 400, details) {
  const error = new Error(message); error.code = code; error.status = status;
  if (details !== undefined) error.details = details;
  return error;
}
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function text(value, name, maximum = 32768) {
  if (typeof value !== 'string' || value.length > maximum)
    throw failure('INVALID_FIELD', name + ' must be text of at most ' + maximum + ' characters');
  return value;
}
export function revision(expected, current, name = 'workspace') {
  if (!Number.isSafeInteger(expected) || expected < 0)
    throw failure('REVISION_REQUIRED', 'Read the current ' + name + ' and pass its revision', 428);
  if (expected !== current)
    throw failure('REVISION_CONFLICT', 'The ' + name + ' changed; reload before saving', 409,
      { expectedRevision: expected, currentRevision: current });
}
export function timestamp(value, name = 'retrievedAt') {
  const chosen = value === undefined ? new Date().toISOString() : text(value, name, 80);
  const parsed = Date.parse(chosen);
  if (!Number.isFinite(parsed) || !/[Tt].*(?:[Zz]|[+-]\d\d:\d\d)$/.test(chosen))
    throw failure('INVALID_TIMESTAMP', name + ' must be an ISO timestamp with an explicit offset');
  return new Date(parsed).toISOString();
}
export function selection(value, name = 'stream') {
  if (!STREAMS.includes(value)) throw failure('INVALID_STREAM', 'Choose a supported CanadaBuys stream', 400, { field: name, streams: STREAMS });
  return value;
}
export function safeURL(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export function compareRows(before, after) {
  const changes = [];
  for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const a = Object.hasOwn(before, key), b = Object.hasOwn(after, key);
    if (a !== b || canonical(before[key]) !== canonical(after[key])) changes.push({
      field: key, beforePresent: a, afterPresent: b,
      before: a ? before[key] : null, after: b ? after[key] : null
    });
  }
  return changes;
}
export const emptyReview = () => ({ revision: 0, disposition: 'unreviewed', owner: '', nextAction: '',
  note: '', shortlisted: false, qualification: { requirements: [], capability: '', eligibility: '', commercial: '', timing: '' },
  updatedAt: null, operator: null });
