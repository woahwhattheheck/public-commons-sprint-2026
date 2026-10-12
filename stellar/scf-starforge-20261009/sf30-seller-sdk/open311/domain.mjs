// MIT. Source projections and comparisons for the original Open311 workspace.
import { createHash } from 'node:crypto';

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
function isObject(value) { return value != null && typeof value === 'object' && !Array.isArray(value); }
export function canonicalJson(value) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Source contains a nonfinite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (isObject(value)) return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  throw new TypeError('Source must contain JSON values only');
}
function copy(value) { canonicalJson(value); return structuredClone(value); }
function sha(value) { return createHash('sha256').update(canonicalJson(value)).digest('hex'); }
function identifier(value, name) {
  if (typeof value === 'number' && !Number.isSafeInteger(value))
    throw new TypeError(name + ' numeric identity is not safe; the original source must use a string');
  if (!['string', 'number'].includes(typeof value)) throw new TypeError(name + ' is missing');
  const result = String(value).trim();
  if (!result) throw new TypeError(name + ' is empty');
  return result;
}
function text(value) {
  if (value == null) return null;
  return typeof value === 'string' ? value : isObject(value) || Array.isArray(value)
    ? canonicalJson(value) : String(value);
}
function coordinate(value, min, max) {
  if (value == null || value === '' || typeof value === 'boolean' ||
      typeof value === 'object' || typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}
function boolean(value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
}
function listBody(value, plural, singular, identity) {
  if (Array.isArray(value)) return value;
  if (!isObject(value)) throw new TypeError('Open311 ' + plural + ' response must contain records');
  if (own(value, identity)) return [value];
  let nested = value[plural];
  if (isObject(nested) && own(nested, singular)) nested = nested[singular];
  if (nested == null && own(value, singular)) nested = value[singular];
  if (Array.isArray(nested)) return nested;
  if (isObject(nested) && own(nested, identity)) return [nested];
  throw new TypeError('Unrecognized Open311 ' + plural + ' response shape');
}
export function requestKey(connectionId, serviceRequestId) {
  return JSON.stringify([identifier(connectionId, 'connectionId'),
    identifier(serviceRequestId, 'service_request_id')]);
}

export function normalizeRequests(value, { connectionId, jurisdictionId = null } = {}) {
  const connection = identifier(connectionId, 'connectionId');
  const seen = new Map();
  return listBody(value, 'service_requests', 'request', 'service_request_id').map((record, index) => {
    if (!isObject(record)) throw new TypeError('Request at index ' + index + ' must be an object');
    const source = copy(record);
    const id = identifier(source.service_request_id, 'service_request_id at index ' + index);
    if (seen.has(id)) throw new TypeError('Duplicate service_request_id ' + id +
      ' at indexes ' + seen.get(id) + ' and ' + index + '; the complete capture retains both source rows');
    seen.set(id, index);
    return {
      id, key: requestKey(connection, id), connectionId: connection, jurisdictionId,
      serviceRequestId: id, serviceCode: text(source.service_code), serviceName: text(source.service_name),
      status: text(source.status), description: text(source.description), address: text(source.address),
      agency: text(source.agency_responsible), requestedAt: text(source.requested_datetime),
      updatedAt: text(source.updated_datetime), expectedAt: text(source.expected_datetime),
      latitude: coordinate(source.lat, -90, 90), longitude: coordinate(source.long, -180, 180),
      source, sourceSha256: sha(source),
    };
  });
}

export function normalizeServices(value) {
  const seen = new Set();
  return listBody(value, 'services', 'service', 'service_code').map((record, index) => {
    if (!isObject(record)) throw new TypeError('Service at index ' + index + ' must be an object');
    const source = copy(record), id = identifier(source.service_code, 'service_code at index ' + index);
    if (seen.has(id)) throw new TypeError('Duplicate service_code ' + id + ' in the original capture');
    seen.add(id);
    return {
      id, serviceCode: id, serviceName: text(source.service_name), description: text(source.description),
      group: text(source.group), metadata: boolean(source.metadata), type: text(source.type),
      keywords: text(source.keywords), source, sourceSha256: sha(source),
    };
  });
}

function rows(capture) {
  if (Array.isArray(capture)) return capture;
  if (!isObject(capture)) throw new TypeError('A capture is required');
  const result = capture.rows ?? capture.requests ?? capture.items;
  if (!Array.isArray(result)) throw new TypeError('Capture must contain its normalized rows');
  return result;
}
function values(value) {
  if (value == null || value === '') return [];
  return [...new Set((Array.isArray(value) ? value : [value])
    .flatMap(item => String(item).split(',')).map(item => item.trim()).filter(Boolean))].sort();
}
function scope(capture) {
  if (!isObject(capture)) return null;
  const query = capture.query ?? capture.scope?.query ?? capture.receipt?.query ?? {};
  const connection = capture.connectionId ?? capture.scope?.connectionId
    ?? capture.connection?.id ?? rows(capture)[0]?.connectionId;
  if (!connection) return null;
  const identity = {
    connectionId: connection,
    baseUrl: capture.scope?.baseUrl ?? capture.connection?.baseUrl ?? capture.config?.baseUrl ?? '',
    jurisdictionId: capture.scope?.jurisdictionId ?? capture.connection?.jurisdictionId
      ?? capture.config?.jurisdictionId ?? '',
  };
  const ids = values(query.service_request_id);
  if (ids.length) return { ...identity, kind: 'request-ids', ids };
  if (capture.kind === 'request' && capture.resourceId != null)
    return { ...identity, kind: 'request-ids', ids: [String(capture.resourceId)] };
  if (!query.start_date || !query.end_date) return null;
  const start = Date.parse(query.start_date), end = Date.parse(query.end_date);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const normalizedQuery = { ...query, start_date: new Date(start).toISOString(),
    end_date: new Date(end).toISOString() };
  if (own(normalizedQuery, 'service_code')) normalizedQuery.service_code = values(normalizedQuery.service_code);
  if (own(normalizedQuery, 'status')) normalizedQuery.status = values(normalizedQuery.status);
  for (const key of Object.keys(normalizedQuery))
    if (normalizedQuery[key] == null || normalizedQuery[key] === '') delete normalizedQuery[key];
  return { ...identity, kind: 'fixed-window', query: normalizedQuery };
}
function indexRows(value) {
  const result = new Map();
  for (const row of value) {
    const key = row.key ?? requestKey(row.connectionId, row.serviceRequestId ?? row.id);
    if (result.has(key)) throw new TypeError('A comparison cannot collapse duplicate request identity ' + key);
    result.set(key, row);
  }
  return result;
}
function fieldChanges(before, after) {
  const a = before.source ?? before, b = after.source ?? after;
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  return keys.filter(key => !own(a, key) || !own(b, key) || canonicalJson(a[key]) !== canonicalJson(b[key]));
}

export function compareCaptures(before, after) {
  const oldRows = indexRows(rows(before)), newRows = indexRows(rows(after));
  const oldScope = scope(before), newScope = scope(after);
  const scopeComparable = oldScope != null && newScope != null &&
    canonicalJson(oldScope) === canonicalJson(newScope);
  const added = [], changed = [], unchanged = [], missingFromCapture = [];
  for (const [key, current] of [...newRows.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const previous = oldRows.get(key);
    if (!previous) { added.push(current); continue; }
    const fields = fieldChanges(previous, current);
    if (fields.length) changed.push({ id: current.id ?? current.serviceRequestId, key,
      before: previous, after: current, fields });
    else unchanged.push(current);
  }
  if (scopeComparable) {
    for (const [key, previous] of [...oldRows.entries()].sort(([a], [b]) => a.localeCompare(b)))
      if (!newRows.has(key)) missingFromCapture.push(previous);
  }
  return { added, changed, unchanged, missingFromCapture, scopeComparable };
}

function folded(value) { return String(value ?? '').normalize('NFKC').toLowerCase(); }
function nonnegative(value, fallback, name) {
  if (value == null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(name + ' must be a nonnegative integer');
  return number;
}
export function queryRequests(input, filter = {}) {
  if (!Array.isArray(input)) throw new TypeError('Request rows must be an array');
  if (!isObject(filter)) throw new TypeError('Request filter must be an object');
  const statuses = new Set(values(filter.status).map(folded));
  const services = new Set(values(filter.service ?? filter.serviceCode));
  const terms = folded(filter.q).split(/\s+/u).filter(Boolean);
  const offset = nonnegative(filter.offset, 0, 'offset');
  const limit = nonnegative(filter.limit, 100, 'limit');
  const sort = filter.sort ?? 'requested';
  const fields = { requested: 'requestedAt', updated: 'updatedAt', expected: 'expectedAt',
    id: 'serviceRequestId', service: 'serviceName', status: 'status' };
  if (!own(fields, sort)) throw new TypeError('Unsupported request sort');
  const direction = filter.order === 'asc' ? 1 : filter.order === 'desc' || filter.order == null ? -1 : 0;
  if (!direction) throw new TypeError('Request order must be asc or desc');
  const selected = input.filter(row => {
    if (statuses.size && !statuses.has(folded(row.status))) return false;
    if (services.size && !services.has(String(row.serviceCode ?? ''))) return false;
    if (!terms.length) return true;
    const searchable = folded([row.serviceRequestId, row.serviceCode, row.serviceName, row.status,
      row.description, row.address, row.agency, row.source?.status_notes,
      canonicalJson(row.source ?? {})].filter(value => value != null).join('\n'));
    return terms.every(term => searchable.includes(term));
  });
  const field = fields[sort], dateSort = ['requested', 'updated', 'expected'].includes(sort);
  selected.sort((a, b) => {
    const av = dateSort ? Date.parse(a[field]) : folded(a[field]);
    const bv = dateSort ? Date.parse(b[field]) : folded(b[field]);
    const aMissing = dateSort ? !Number.isFinite(av) : !av;
    const bMissing = dateSort ? !Number.isFinite(bv) : !bv;
    if (aMissing !== bMissing) return aMissing ? 1 : -1;
    const order = aMissing ? 0 : dateSort ? Math.sign(av - bv) : av.localeCompare(bv);
    return order * direction || String(a.key ?? a.id).localeCompare(String(b.key ?? b.id));
  });
  return { items: selected.slice(offset, offset + limit), total: selected.length, offset, limit };
}
