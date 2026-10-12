// MIT. Original SAM.gov v2 request, notice and exact source semantics.
import { createHash } from 'node:crypto';
import { canonical, sourceJSON } from '../usaspending/core.mjs';

export const SAM_SCHEMA = 'stellar-forge.samgov-workspace.v1';
export const SAM_PACKET_SCHEMA = 'stellar-forge.samgov-packet.v1';
export const SAM_ENDPOINT = 'https://api.sam.gov/opportunities/v2/search';
export const SAM_ALPHA_ENDPOINT = 'https://api-alpha.sam.gov/opportunities/v2/search';
export const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
export const MAX_PACKET_BYTES = 512 * 1024 * 1024;
export const MAX_RECORDS = 5000000;
export const SOURCE_BASIS = 'latest_api_observation';
export const COLUMNS = Object.freeze([
  'notice_id','title','solicitation_number','organization','organization_code','posted_date',
  'notice_type','base_type','active','response_deadline','archive_date','naics','classification',
  'set_aside','set_aside_description','award_amount','award_number','award_date','awardee_name',
  'awardee_uei','source_url','notice_sha256','source_sha256','observed_at','edition_id',
]);
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const copy = value => structuredClone(value);
export { canonical, sourceJSON };
export const sha = value => createHash('sha256').update(
  Buffer.isBuffer(value) || typeof value === 'string' ? value : canonical(value)).digest('hex');
export const now = () => new Date().toISOString();
export class SamError extends Error {
  constructor(code, message = code, status = 400, details = {}) {
    super(message); this.name = 'SamError'; this.code = code; this.status = status; this.details = details;
  }
  toJSON() { return {error: this.code, message: this.message, details: this.details}; }
}
export function requireThat(value, code, message = code, status = 400, details = {}) {
  if (!value) throw new SamError(code, message, status, details);
}
export function text(value, name, max = 4000, empty = false) {
  requireThat(typeof value === 'string' && value.length <= max &&
    !value.includes('\0') && (empty || value.trim()), 'FIELD_INVALID',
    name + ' must be text of at most ' + max + ' characters.');
  return value;
}
export function integer(value, name, minimum, maximum) {
  requireThat(Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    'INTEGER_INVALID', name + ' must be an integer from ' + minimum + ' to ' + maximum + '.');
  return value;
}
export function identifier(value, name = 'id') {
  text(value, name, 200);
  requireThat(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value), 'IDENTIFIER_INVALID', name + ' has invalid characters.');
  return value;
}
export function date(value, name) {
  text(value, name, 10);
  requireThat(/^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + 'T00:00:00Z')) &&
    new Date(value + 'T00:00:00Z').toISOString().slice(0,10) === value,
    'DATE_INVALID', name + ' must be a valid YYYY-MM-DD date.');
  return value;
}
export function instant(value, name = 'Timestamp') {
  text(value, name, 80);
  requireThat(/T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value)), 'TIMESTAMP_INVALID', name + ' needs an explicit UTC offset or Z.');
  date(value.slice(0,10), name + ' date');
  return value;
}
export function zone(value) {
  text(value, 'Time zone', 160);
  try { new Intl.DateTimeFormat('en', {timeZone: value}); }
  catch { throw new SamError('TIME_ZONE_INVALID', 'Select a valid IANA time zone.'); }
  return value;
}
export function endpoint(value = SAM_ENDPOINT) {
  requireThat([SAM_ENDPOINT, SAM_ALPHA_ENDPOINT].includes(value),
    'SAM_ENDPOINT_INVALID', 'Select the original production or alpha SAM.gov v2 endpoint.');
  return value;
}
const FILTERS = new Set(['postedFrom','postedTo','noticeid','solnum','title','ptype',
  'organizationCode','organizationName','ncode','ccode','typeOfSetAside','state','zip','rdlfrom','rdlto']);
const PTYPES = new Set(['u','p','a','r','s','o','g','k','i']);
function withinYear(from, to, name) {
  requireThat(to >= from, 'DATE_RANGE_INVALID', name + ' end precedes its start.');
  const limit = new Date(from + 'T00:00:00Z'); limit.setUTCFullYear(limit.getUTCFullYear() + 1);
  requireThat(Date.parse(to + 'T00:00:00Z') <= limit.getTime(),
    'DATE_RANGE_INVALID', name + ' may cover at most one year under the original SAM API.');
}
export function queryDefinition(value) {
  requireThat(plain(value) && plain(value.filters), 'QUERY_INVALID', 'A query needs explicit filters.');
  const filters = {};
  for (const key of Object.keys(value.filters))
    requireThat(FILTERS.has(key), 'QUERY_FILTER_INVALID', 'Unsupported SAM query field: ' + key);
  filters.postedFrom = date(value.filters.postedFrom, 'Posted from');
  filters.postedTo = date(value.filters.postedTo, 'Posted to');
  withinYear(filters.postedFrom, filters.postedTo, 'Posted date range');
  for (const key of FILTERS) {
    if (['postedFrom','postedTo'].includes(key)) continue;
    const v = value.filters[key];
    if (v === undefined || v === null || v === '') continue;
    if (key === 'ptype') {
      const values = Array.isArray(v) ? v : [v];
      requireThat(values.length > 0 && values.length <= PTYPES.size &&
        values.every(item => PTYPES.has(item)) && new Set(values).size === values.length,
        'PROCUREMENT_TYPE_INVALID', 'Select current SAM procurement-type codes.');
      filters[key] = [...values];
    } else if (['rdlfrom','rdlto'].includes(key)) filters[key] = date(v, key);
    else {
      filters[key] = text(v, key, key === 'title' ? 1000 : 500);
      if (key === 'ncode') requireThat(/^\d{1,6}$/.test(v), 'NAICS_INVALID', 'NAICS is at most six digits.');
    }
  }
  requireThat(Boolean(filters.rdlfrom) === Boolean(filters.rdlto),
    'DEADLINE_RANGE_INVALID', 'Supply both deadline range endpoints.');
  if (filters.rdlfrom) withinYear(filters.rdlfrom, filters.rdlto, 'Deadline date range');
  return {filters, pageSize: integer(value.pageSize ?? 1000, 'Page size', 1, 1000),
    maxRecords: integer(value.maxRecords ?? 250000, 'Capture record capacity', 1, MAX_RECORDS),
    sourceTerms: text(value.sourceTerms ?? '', 'Source terms', 20000, true)};
}
export function queryIdentity(definition, selectedEndpoint = SAM_ENDPOINT) {
  return sha({endpoint: endpoint(selectedEndpoint), filters: queryDefinition(definition).filters});
}
const apiDate = value => value.slice(5,7) + '/' + value.slice(8,10) + '/' + value.slice(0,4);
export function searchRequest(definition, offset = 0, selectedEndpoint = SAM_ENDPOINT) {
  const q = queryDefinition(definition), url = new URL(endpoint(selectedEndpoint));
  integer(offset, 'Page index', 0, MAX_RECORDS);
  for (const [key, value] of Object.entries(q.filters)) {
    if (Array.isArray(value)) for (const item of value) url.searchParams.append(key, item);
    else url.searchParams.set(key, ['postedFrom','postedTo','rdlfrom','rdlto'].includes(key) ? apiDate(value) : value);
  }
  url.searchParams.set('limit', String(q.pageSize)); url.searchParams.set('offset', String(offset));
  return {method: 'GET', url: url.href, offset, limit: q.pageSize};
}
export function cleanSourceUrl(value, name = 'Source URL') {
  text(value, name, 12000);
  let url; try { url = new URL(value); } catch { throw new SamError('SOURCE_URL_INVALID', name + ' must be an HTTPS URL.'); }
  requireThat(url.protocol === 'https:' && !url.username && !url.password && !url.hash &&
    (!url.port || url.port === '443'), 'SOURCE_URL_INVALID', name + ' must be a public HTTPS URL without credentials.');
  for (const key of url.searchParams.keys())
    requireThat(!/^(?:api[_-]?key|access[_-]?token|authorization|password|secret)$/i.test(key),
      'SOURCE_URL_CREDENTIAL', 'Retained source URLs must omit credentials.');
  return url.href;
}
export function validateDescriptionUrl(value, noticeId, selectedEndpoint = SAM_ENDPOINT) {
  const url = new URL(cleanSourceUrl(value)), target = new URL(endpoint(selectedEndpoint));
  requireThat(url.origin === target.origin &&
    /^\/(?:prod\/|prodlike\/)?opportunities\/v1\/noticedesc$/.test(url.pathname) &&
    url.searchParams.get('noticeid') === noticeId &&
    [...url.searchParams.keys()].every(key => key === 'noticeid'),
    'DESCRIPTION_SOURCE_INVALID', 'Use the exact original SAM description endpoint for this notice.');
  return url.href;
}
export function safeHeaders(headers = {}) {
  const allowed = new Set(['content-type','content-length','content-disposition','etag','last-modified',
    'date','retry-after','x-ratelimit-remaining','x-ratelimit-reset']);
  const result = {};
  const entries = headers instanceof Headers ? [...headers.entries()] : Object.entries(headers);
  for (const [key, value] of entries) if (allowed.has(key.toLowerCase()))
    result[key.toLowerCase()] = String(value).slice(0,16000);
  return result;
}
export function sourceBuffer(value, {limit = MAX_SOURCE_BYTES} = {}) {
  requireThat(plain(value), 'SOURCE_INPUT_INVALID');
  const keys = ['contentBase64','contentText'].filter(key => value[key] !== undefined);
  requireThat(keys.length === 1, 'SOURCE_INPUT_REQUIRED', 'Supply exactly one original source content field.');
  let bytes;
  if (keys[0] === 'contentText') bytes = Buffer.from(text(value.contentText, 'Source text', limit, true), 'utf8');
  else {
    text(value.contentBase64, 'Source base64', Math.ceil(limit / 3) * 4 + 4, true);
    bytes = Buffer.from(value.contentBase64, 'base64');
    requireThat(bytes.toString('base64') === value.contentBase64, 'SOURCE_BASE64_INVALID');
  }
  requireThat(bytes.length <= limit, 'SOURCE_TOO_LARGE', 'Source exceeds the selected byte capacity.');
  return bytes;
}
function count(value, name) {
  const raw = String(value);
  requireThat(/^\d+$/.test(raw), 'SOURCE_PAGINATION_INVALID', name + ' must be a nonnegative source integer.');
  return integer(Number(raw), name, 0, Number.MAX_SAFE_INTEGER);
}
export function parseSearchPage(bytes, expected) {
  const value = sourceJSON(bytes);
  requireThat(plain(value) && Array.isArray(value.opportunitiesData),
    'SAM_RESPONSE_INVALID', 'The original response must contain opportunitiesData.');
  const totalRecords = count(value.totalRecords, 'Total records'),
    offset = count(value.offset, 'Page index'), limit = count(value.limit, 'Page limit');
  requireThat(offset === expected.offset && limit === expected.limit && limit >= 1 &&
    value.opportunitiesData.length <= limit && value.opportunitiesData.every(plain),
    'SOURCE_PAGINATION_CHANGED', 'The response page index or page size differs from the requested page.');
  requireThat(totalRecords !== 0 || value.opportunitiesData.length === 0,
    'SOURCE_TOTAL_CHANGED', 'Zero total records cannot contain notice rows.');
  return {raw: value, totalRecords, offset, limit, rows: value.opportunitiesData};
}
const nullable = value => value === undefined || value === null ? null : typeof value === 'string' ? value : String(value);
function first(row, fields) {
  for (const field of fields) if (Object.hasOwn(row, field)) return row[field];
  return null;
}
function suppliedUrl(value) {
  if(typeof value!=='string' || !value.trim() || value==='null')return null;
  try{
    const url=new URL(value);
    // Public notice projections omit a credential query key. The complete
    // original bytes remain in the separately identified private source.
    for(const key of [...url.searchParams.keys()])
      if(/^(?:api[_-]?key|access[_-]?token|authorization|password|secret)$/i.test(key))url.searchParams.delete(key);
    return url.href;
  }catch{return value;}
}
export function noticeRow(raw, source, resources = []) {
  requireThat(plain(raw), 'NOTICE_INVALID');
  const noticeId = identifier(raw.noticeId, 'Original notice ID');
  const links = Array.isArray(raw.resourceLinks) ? raw.resourceLinks.filter(item => typeof item === 'string').map(suppliedUrl).filter(Boolean) : [];
  const award = plain(raw.award) ? raw.award : {};
  const awardee = plain(award.awardee) ? award.awardee : {};
  const result = {
    noticeId, title: nullable(raw.title), solicitationNumber: nullable(raw.solicitationNumber),
    fullParentPathName: nullable(first(raw,['fullParentPathName','department'])),
    fullParentPathCode: nullable(raw.fullParentPathCode), postedDate: nullable(raw.postedDate),
    type: nullable(raw.type), baseType: nullable(raw.baseType), active: nullable(raw.active),
    responseDeadLine: nullable(first(raw,['responseDeadLine','reponseDeadLine'])),
    archiveDate: nullable(raw.archiveDate), archiveType: nullable(raw.archiveType),
    naicsCode: nullable(raw.naicsCode), classificationCode: nullable(raw.classificationCode),
    setAsideCode: nullable(first(raw,['typeOfSetAside','setAsideCode'])),
    setAsideDescription: nullable(first(raw,['typeOfSetAsideDescription','setAside'])),
    descriptionUrl: suppliedUrl(raw.description), uiUrl: suppliedUrl(raw.uiLink) ||
      'https://sam.gov/workspace/contract/opp/' + encodeURIComponent(noticeId) + '/view',
    resourceLinks: links, awardAmount: nullable(award.amount), awardNumber: nullable(award.number),
    awardDate: nullable(award.date), awardeeName: nullable(awardee.name), awardeeUei: nullable(awardee.ueiSAM),
    pointOfContact: copy(raw.pointOfContact ?? null), placeOfPerformance: copy(raw.placeOfPerformance ?? null),
    raw: copy(raw), source: copy(source), resources: copy(resources),
  };
  const content = resources.map(item => ({kind:item.kind,url:item.url,sha256:item.sha256,bytes:item.bytes,status:item.status}))
    .sort((a,b) => (a.kind + a.url + a.sha256).localeCompare(b.kind + b.url + b.sha256));
  result.recordSha256 = sha({raw, resources: content});
  const rawDeadline = result.responseDeadLine;
  result.deadlineStatus = !rawDeadline ? 'absent' :
    /(?:Z|[+-]\d{2}:\d{2})$/.test(rawDeadline) && Number.isFinite(Date.parse(rawDeadline)) ?
      'explicit_offset' : 'requires_timezone_review';
  return result;
}
export function reviewDeadline(value) {
  if (value === undefined || value === null) return null;
  requireThat(plain(value), 'DEADLINE_REVIEW_INVALID');
  return {at: instant(value.at, 'Reviewed deadline'), timeZone: zone(value.timeZone),
    reason: text(value.reason, 'Deadline review reason', 10000)};
}
export function noticeDatasetRow(row, editionId) {
  const values = [row.noticeId,row.title,row.solicitationNumber,row.fullParentPathName,
    row.fullParentPathCode,row.postedDate,row.type,row.baseType,row.active,row.responseDeadLine,
    row.archiveDate,row.naicsCode,row.classificationCode,row.setAsideCode,row.setAsideDescription,
    row.awardAmount,row.awardNumber,row.awardDate,row.awardeeName,row.awardeeUei,row.uiUrl,
    row.recordSha256,row.source.sha256,row.source.capturedAt,editionId];
  return Object.fromEntries(COLUMNS.map((key,index) => [key, values[index] ?? null]));
}
export function csv(rows, columns = COLUMNS, {spreadsheet = false} = {}) {
  const cell = value => {
    let valueText = value === null || value === undefined ? '' : String(value);
    if (spreadsheet && /^[\s]*[=+@-]|^[\t\r\n]/.test(valueText)) valueText = "'" + valueText;
    return '"' + valueText.replace(/"/g,'""') + '"';
  };
  return columns.map(cell).join(',') + '\r\n' +
    rows.map(row => columns.map(key => cell(row[key])).join(',')).join('\r\n') + '\r\n';
}
export function compareNotices(before, after) {
  const left = new Map(before.map(row => [row.noticeId,row])), right = new Map(after.map(row => [row.noticeId,row]));
  const items = [], counts = {added:0,removed:0,changed:0,unchanged:0};
  for (const noticeId of [...new Set([...left.keys(),...right.keys()])].sort()) {
    const a = left.get(noticeId), b = right.get(noticeId);
    const kind = !a ? 'added' : !b ? 'removed' : a.recordSha256 === b.recordSha256 ? 'unchanged' : 'changed';
    counts[kind]++;
    const changedFields = a && b ? [...new Set([...Object.keys(a.raw),...Object.keys(b.raw)])]
      .filter(key => canonical(a.raw[key] ?? null) !== canonical(b.raw[key] ?? null)) : [];
    if(a && b)for(const field of ['documentResources','documentHistory'])
      if(canonical(a[field]??null)!==canonical(b[field]??null))changedFields.push(field);
    if (a && b && canonical(a.resources.map(x=>[x.kind,x.url,x.sha256,x.bytes,x.status]).sort((x,y)=>canonical(x).localeCompare(canonical(y)))) !==
      canonical(b.resources.map(x=>[x.kind,x.url,x.sha256,x.bytes,x.status]).sort((x,y)=>canonical(x).localeCompare(canonical(y))))) changedFields.push('retainedResources');
    items.push({noticeId,kind,title:b?.title ?? a?.title,changedFields,
      before:a ? copy(a) : null,after:b ? copy(b) : null});
  }
  return {counts,items};
}

