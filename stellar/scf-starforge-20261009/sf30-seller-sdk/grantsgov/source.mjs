// MIT. Official Grants.gov public source records and lossless opportunity normalization.
import { canonical, sha, sourceJSON, decimal } from '../usaspending/core.mjs';

export { canonical, sha, sourceJSON };
export const SOURCE_VERSION = 'stellar-forge.grantsgov-source.v1';
export const API_ORIGIN = 'https://api.grants.gov';
export const SEARCH_PATH = '/v1/api/search2';
export const DETAIL_PATH = '/v1/api/fetchOpportunity';
export const ATTRIBUTION = 'This product uses the Grants.gov API but is not endorsed or certified by the U.S. Department of Health and Human Services.';
export const SOURCE_DOCUMENTATION = Object.freeze([
  'https://grants.gov/api/common/search2',
  'https://grants.gov/api/common/fetchopportunity',
  'https://grants.gov/api/terms-conditions'
]);
export const DATASET_COLUMNS = Object.freeze([
  'opportunity_id','opportunity_number','title','status','document_type',
  'agency_code','agency_name','top_agency_code','top_agency_name','revision',
  'synopsis_version','forecast_version','posting_date','posting_date_raw',
  'closing_date','closing_date_raw','closing_date_timezone','closing_date_description',
  'original_due_date','original_due_date_raw','archive_date','forecast_posting_date',
  'forecast_response_date','forecast_response_date_raw','forecast_award_date',
  'forecast_project_start_date','award_ceiling_raw','award_ceiling_usd',
  'award_floor_raw','award_floor_usd','estimated_funding_raw','estimated_funding_usd',
  'number_of_awards_raw','cost_sharing','eligibility_codes','funding_instrument_codes',
  'funding_category_codes','assistance_listing_numbers','attachment_count','package_count',
  'history_count','source_url','source_observed_at','source_data_sha256'
]);
export const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export const copy = v => JSON.parse(JSON.stringify(v));
export const stringOrNull = v => v === null || v === undefined ? null : String(v);
export function fault(code, message = code, status = 400, details = {}) {
  return Object.assign(new Error(message), {code, status, ...details});
}
export function need(value, code, message = code, status = 400) {
  if (!value) throw fault(code, message, status);
}
export function safeInteger(value, name, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  need(Number.isSafeInteger(number) && number >= minimum && number <= maximum,
    'GRANTS_INTEGER_INVALID', name + ' must be an integer from ' + minimum + ' to ' + maximum);
  return number;
}
export function opportunityId(value) {
  const text = String(value ?? '');
  need(/^[1-9]\d{0,14}$/.test(text) && Number.isSafeInteger(Number(text)),
    'GRANTS_ID_INVALID', 'Use the original numeric Grants.gov opportunity ID.');
  return text;
}
export const opportunityURL = value => 'https://www.grants.gov/search-results-detail/' + opportunityId(value);
function shortText(value, label, maximum, empty = true) {
  need(typeof value === 'string' && value.length <= maximum && !value.includes('\0') &&
    (empty || value.trim().length), 'GRANTS_QUERY_INVALID', label + ' is invalid.');
  return value.trim();
}
function codes(value, name, maximum = 100) {
  if (typeof value === 'string') value = value ? value.split('|') : [];
  need(Array.isArray(value) && value.length <= maximum, 'GRANTS_QUERY_INVALID', name + ' must be an array.');
  const result = value.map(v => {
    const s = shortText(v, name, 100, false);
    need(!s.includes('|') && !/[\r\n]/.test(s), 'GRANTS_QUERY_INVALID', name + ' contains a delimiter.');
    return s;
  });
  return [...new Set(result)].sort();
}
export function normalizeQuery(input = {}) {
  need(object(input), 'GRANTS_QUERY_INVALID', 'A Grants.gov query object is required.');
  const allowed = new Set(['keyword','opportunityNumber','statuses','agencies','eligibilities',
    'fundingCategories','fundingInstruments','aln','pageSize']);
  for (const key of Object.keys(input)) need(allowed.has(key), 'GRANTS_QUERY_FIELD_UNKNOWN', 'Unsupported query field: ' + key);
  const statuses = codes(input.statuses ?? ['posted','forecasted'], 'statuses', 4);
  need(statuses.length && statuses.every(v => ['posted','forecasted','closed','archived'].includes(v)),
    'GRANTS_QUERY_INVALID', 'Choose posted, forecasted, closed, or archived statuses.');
  return {
    keyword: shortText(input.keyword ?? '', 'keyword', 1000),
    opportunityNumber: shortText(input.opportunityNumber ?? '', 'opportunityNumber', 250),
    statuses, agencies: codes(input.agencies ?? [], 'agencies'),
    eligibilities: codes(input.eligibilities ?? [], 'eligibilities'),
    fundingCategories: codes(input.fundingCategories ?? [], 'fundingCategories'),
    fundingInstruments: codes(input.fundingInstruments ?? [], 'fundingInstruments'),
    aln: shortText(input.aln ?? '', 'aln', 250),
    pageSize: safeInteger(input.pageSize ?? 25, 'pageSize', 1, 100)
  };
}
export function buildSearchRequest(input, startRecord = 0) {
  const query = normalizeQuery(input);
  const body = {rows: query.pageSize, startRecordNum: safeInteger(startRecord, 'startRecord'),
    keyword: query.keyword, oppStatuses: query.statuses.join('|')};
  for (const [key, value] of [['oppNum', query.opportunityNumber], ['agencies', query.agencies.join('|')],
    ['eligibilities', query.eligibilities.join('|')], ['fundingCategories', query.fundingCategories.join('|')],
    ['fundingInstruments', query.fundingInstruments.join('|')], ['cfda', query.aln]]) if (value) body[key] = value;
  return body;
}
export function queryFromRequest(body) {
  need(object(body), 'GRANTS_REQUEST_INVALID');
  need(body.aln === undefined || body.cfda === undefined || body.aln === body.cfda,
    'GRANTS_REQUEST_FILTER_CONFLICT', 'Conflicting assistance listing filters.');
  return normalizeQuery({
    keyword: body.keyword ?? '', opportunityNumber: body.oppNum ?? '',
    statuses: body.oppStatuses ?? ['posted','forecasted'], agencies: body.agencies ?? [],
    eligibilities: body.eligibilities ?? [], fundingCategories: body.fundingCategories ?? [],
    fundingInstruments: body.fundingInstruments ?? [], aln: body.cfda ?? body.aln ?? '',
    pageSize: Number(body.rows ?? 25)
  });
}
export function queryEchoWarnings(query, payload) {
  const expected = normalizeQuery(query), echo = payload.searchParams;
  if (!object(echo)) return [{code:'SEARCH_FILTER_ECHO_ABSENT'}];
  const issues = [];
  const checkText = (field, current, expectedValue) => {
    if (current !== undefined && String(current ?? '') !== expectedValue)
      issues.push({code:'SEARCH_FILTER_ECHO_MISMATCH',field,requested:expectedValue,observed:String(current ?? '')});
  };
  checkText('keyword', echo.keyword, expected.keyword);
  checkText('oppNum', echo.oppNum, expected.opportunityNumber);
  checkText('aln', echo.aln ?? echo.cfda, expected.aln);
  for (const [field, requested] of [['oppStatuses',expected.statuses],['agencies',expected.agencies],
    ['eligibilities',expected.eligibilities],['fundingCategories',expected.fundingCategories],
    ['fundingInstruments',expected.fundingInstruments]]) {
    if (echo[field] !== undefined && canonical(codes(echo[field] ?? '', field)) !== canonical(requested))
      issues.push({code:'SEARCH_FILTER_ECHO_MISMATCH',field,requested,observed:echo[field]});
  }
  return issues;
}
// Find a top-level JSON value without reserializing public data or retaining the token envelope.
export function jsonMemberSlice(text, member) {
  need(typeof text === 'string', 'GRANTS_SOURCE_JSON_INVALID');
  let at = 0, found = null;
  const whitespace = () => { while (/\s/.test(text[at] ?? '') && at < text.length) at++; };
  const endString = start => {
    let i = start + 1;
    for (; i < text.length; i++) {
      if (text[i] === '\\') { i++; continue; }
      if (text[i] === '"') return i + 1;
    }
    throw fault('GRANTS_SOURCE_JSON_INVALID', 'Unterminated source string.');
  };
  const endValue = start => {
    if (text[start] === '"') return endString(start);
    if (text[start] === '{' || text[start] === '[') {
      let depth = 0, i = start;
      for (; i < text.length; i++) {
        if (text[i] === '"') { i = endString(i) - 1; continue; }
        if (text[i] === '{' || text[i] === '[') depth++;
        else if (text[i] === '}' || text[i] === ']') { depth--; if (!depth) return i + 1; }
      }
      throw fault('GRANTS_SOURCE_JSON_INVALID', 'Unterminated source object.');
    }
    let i = start;
    while (i < text.length && !/[\s,}]/.test(text[i])) i++;
    return i;
  };
  whitespace(); need(text[at++] === '{', 'GRANTS_SOURCE_JSON_INVALID', 'Expected the provider JSON envelope.');
  while (at < text.length) {
    whitespace(); if (text[at] === '}') break;
    need(text[at] === '"', 'GRANTS_SOURCE_JSON_INVALID');
    const endKey = endString(at), key = JSON.parse(text.slice(at, endKey)); at = endKey;
    whitespace(); need(text[at++] === ':', 'GRANTS_SOURCE_JSON_INVALID'); whitespace();
    const start = at, end = endValue(start); at = end;
    if (key === member) {
      need(found === null, 'GRANTS_SOURCE_JSON_DUPLICATE', 'Duplicate provider envelope member: ' + member);
      found = {start,end,text:text.slice(start,end)};
    }
    whitespace(); if (text[at] === ',') { at++; continue; }
    need(text[at] === '}', 'GRANTS_SOURCE_JSON_INVALID'); break;
  }
  return found;
}
export function decodeSourceRecord(record) {
  need(object(record) && record.schema === SOURCE_VERSION && ['search','detail'].includes(record.kind),
    'GRANTS_SOURCE_RECORD_INVALID');
  need(object(record.data) && typeof record.data.base64 === 'string', 'GRANTS_SOURCE_DATA_REQUIRED');
  need(Number.isSafeInteger(record.data.bytes) && record.data.bytes >= 0 && record.data.bytes <= 16 * 1024 * 1024 &&
    record.data.base64.length <= 4 * Math.ceil(16 * 1024 * 1024 / 3), 'GRANTS_SOURCE_TOO_LARGE');
  const data = Buffer.from(record.data.base64, 'base64');
  need(data.toString('base64') === record.data.base64 && data.length === record.data.bytes &&
    sha(data) === record.data.sha256, 'GRANTS_SOURCE_DIGEST_MISMATCH', 'The retained public data bytes changed.');
  need(data.length <= 16 * 1024 * 1024, 'GRANTS_SOURCE_TOO_LARGE');
  need(object(record.request) && record.request.method === 'POST' &&
    record.request.url === API_ORIGIN + (record.kind === 'search' ? SEARCH_PATH : DETAIL_PATH),
    'GRANTS_SOURCE_TARGET_INVALID');
  const requestBytes = Buffer.from(record.request.base64 ?? '', 'base64');
  need(requestBytes.toString('base64') === record.request.base64 && sha(requestBytes) === record.request.sha256,
    'GRANTS_REQUEST_DIGEST_MISMATCH');
  const request = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(requestBytes));
  need(canonical(request) === canonical(record.request.body), 'GRANTS_REQUEST_BODY_MISMATCH');
  need(/^[a-f0-9]{64}$/.test(record.response?.bodySha256 ?? '') &&
    Number.isSafeInteger(record.response?.bytes) && record.response.bytes >= data.length,
    'GRANTS_RESPONSE_RECEIPT_INVALID');
  need(record.response.status === 200 && Number(record.envelope?.errorcode) === 0,
    'GRANTS_SOURCE_NOT_SUCCESS', 'Only successful provider data can enter a capture.');
  const payload = sourceJSON(data);
  need(object(payload), 'GRANTS_SOURCE_PAYLOAD_INVALID', 'The provider returned no opportunity data.');
  need(!payload.accessKey && !payload.token, 'GRANTS_SOURCE_CREDENTIAL_FIELD',
    'Portable source contains public data only.');
  if (record.kind === 'search') {
    need(Array.isArray(payload.oppHits), 'GRANTS_SEARCH_ROWS_INVALID');
    safeInteger(payload.hitCount, 'hitCount');
    safeInteger(payload.startRecord, 'startRecord');
  } else {
    need(opportunityId(payload.id) === opportunityId(record.request.body.opportunityId),
      'GRANTS_DETAIL_ID_MISMATCH');
  }
  return payload;
}
const MONTHS = Object.freeze({Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
  Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'});
export function dateFields(raw, companion = null, description = null) {
  raw = stringOrNull(raw); companion = stringOrNull(companion); description = stringOrNull(description);
  let value = null;
  for (const source of [companion, raw]) {
    if (!source) continue;
    let match = /^(\d{4})-(\d{2})-(\d{2})(?:$|[-T ])/.exec(source);
    if (match) value = match[1] + '-' + match[2] + '-' + match[3];
    else if ((match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(source))) value = match[3] + '-' + match[1] + '-' + match[2];
    else if ((match = /^([A-Za-z]{3}) (\d{1,2}), (\d{4})(?: |$)/.exec(source)) && MONTHS[match[1]])
      value = match[3] + '-' + MONTHS[match[1]] + '-' + match[2].padStart(2,'0');
    if (value) {
      const parsed = new Date(value + 'T00:00:00Z');
      if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0,10) !== value) value = null;
      else break;
    }
  }
  return {raw, companion, date:value, timezone:raw?.match(/\b(EDT|EST|UTC|GMT|CDT|CST|MDT|MST|PDT|PST)\b/)?.[1] ?? null,
    description, precision:value ? 'calendar-date' : 'unspecified'};
}
export function amountFields(value) {
  const raw = stringOrNull(value);
  if (raw === null || raw === '') return {raw,decimal:null,kind:'not-reported'};
  try { return {raw,decimal:decimal(raw),kind:'decimal'}; }
  catch { return {raw,decimal:null,kind:/^(none|n\/a|not applicable)$/i.test(raw.trim()) ? 'unspecified' : 'source-text'}; }
}
function textContent(value) {
  if (value === null || value === undefined) return null;
  return String(value).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]*>/g,' ')
    .replace(/&(?:nbsp|amp|lt|gt|quot|apos|rsquo|lsquo|rdquo|ldquo|ndash|mdash|sect);/g,
      x => ({'&nbsp;':' ','&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",
        '&rsquo;':"'",'&lsquo;':"'",'&rdquo;':'"','&ldquo;':'"','&ndash;':'–','&mdash;':'—','&sect;':'§'})[x])
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (all, number) => {
      const n = number[0].toLowerCase() === 'x' ? parseInt(number.slice(1),16) : Number(number);
      return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
    }).replace(/[ \t]+\n/g,'\n').replace(/[ \t]{2,}/g,' ').trim();
}
function sourceRef(record, pointer) {
  if (!record) return null;
  return {
    url:record.request.url, method:record.request.method, request_sha256:record.request.sha256,
    response_sha256:record.response.bodySha256, data_sha256:record.data.sha256,
    captured_at:record.response.capturedAt, pointer, data_byte_exact:record.data.byteExact !== false
  };
}
function summarizedHistory(detail) {
  return (Array.isArray(detail?.opportunityHistoryDetails) ? detail.opportunityHistoryDetails : []).map((v,index) => {
    const active = v.synopsis ?? v.forecast ?? {};
    return {
      revision:stringOrNull(v.revision), opportunity_number:stringOrNull(v.opportunityNumber),
      title:stringOrNull(v.opportunityTitle), document_type:v.synopsis ? 'synopsis' : v.forecast ? 'forecast' : null,
      posted:dateFields(active.postingDate,active.postingDateStr),
      closing:dateFields(active.responseDate,active.responseDateStr,active.responseDateDesc),
      forecast_response:dateFields(active.estApplicationResponseDate,active.estApplicationResponseDateStr,active.estApplicationResponseDateDesc),
      original_updated_raw:stringOrNull(active.lastUpdatedDate), action_date_raw:stringOrNull(active.actionDate),
      synopsis_modified_fields:copy(v.synopsisModifiedFields ?? []), forecast_modified_fields:copy(v.forecastModifiedFields ?? []),
      comments:stringOrNull(v.modifiedComments ?? active.modComments),
      source_pointer:'/opportunityHistoryDetails/' + index
    };
  });
}
export function normalizeOpportunity({hit, detail = null, source = {}}) {
  need(object(hit) || object(detail), 'GRANTS_OPPORTUNITY_REQUIRED');
  hit ??= {};
  const identifier = opportunityId(detail?.id ?? hit.id);
  if (detail && hit.id !== undefined) need(identifier === opportunityId(hit.id), 'GRANTS_DETAIL_ID_MISMATCH');
  const synopsis = object(detail?.synopsis) ? detail.synopsis : null;
  const forecast = object(detail?.forecast) ? detail.forecast : null;
  const documentType = stringOrNull(detail?.docType ?? hit.docType);
  const active = documentType === 'forecast' ? (forecast ?? {}) : (synopsis ?? forecast ?? {});
  const agency = active.agencyDetails ?? detail?.agencyDetails ?? {};
  const topAgency = active.topAgencyDetails ?? detail?.topAgencyDetails ?? {};
  const dates = {
    posting:dateFields(active.postingDate ?? hit.openDate, active.postingDateStr),
    closing:dateFields(synopsis?.responseDate ?? (documentType !== 'forecast' ? hit.closeDate : null),
      synopsis?.responseDateStr, synopsis?.responseDateDesc),
    original_due:dateFields(detail?.originalDueDate,null,detail?.originalDueDateDesc),
    archive:dateFields(active.archiveDate,active.archiveDateStr),
    forecast_posting:dateFields(forecast?.estSynopsisPostingDate,forecast?.estSynopsisPostingDateStr,forecast?.estSynopsisPostingDateDesc),
    forecast_response:dateFields(forecast?.estApplicationResponseDate,forecast?.estApplicationResponseDateStr,forecast?.estApplicationResponseDateDesc),
    forecast_award:dateFields(forecast?.estAwardDate,forecast?.estAwardDateStr,forecast?.estAwardDateDesc),
    forecast_project_start:dateFields(forecast?.estProjectStartDate,forecast?.estProjectStartDateStr,forecast?.estProjectStartDateDesc),
    last_updated:dateFields(active.lastUpdatedDate),
    created:dateFields(active.createdDate),
    search_open:dateFields(hit.openDate), search_close:dateFields(hit.closeDate)
  };
  const funding = {
    ceiling:amountFields(active.awardCeiling),floor:amountFields(active.awardFloor),
    estimated:amountFields(active.estimatedFunding),number_of_awards:amountFields(active.numberOfAwards),
    cost_sharing:typeof active.costSharing === 'boolean' ? active.costSharing : null,
    cost_sharing_raw:active.costSharing ?? null,
    instruments:copy(active.fundingInstruments ?? []),categories:copy(active.fundingActivityCategories ?? [])
  };
  const eligibility = {types:copy(active.applicantTypes ?? []),narrative:stringOrNull(active.applicantEligibilityDesc)};
  const listings = copy(detail?.alns ?? detail?.cfdas ??
    (hit.alnist ?? hit.alnList ?? hit.cfdaList ?? []).map(number => ({alnNumber:number})));
  const listingNumbers = listings.map(v => v.alnNumber ?? v.cfdaNumber).filter(v => v !== null && v !== undefined).map(String);
  const folders = copy(detail?.synopsisAttachmentFolders ?? []);
  const documentURLs = copy(detail?.synopsisDocumentURLs ?? []);
  const packages = copy(detail?.opportunityPkgs ?? []);
  const closedPackages = copy(detail?.closedOpportunityPkgs ?? []);
  const history = summarizedHistory(detail);
  const descriptionHTML = stringOrNull(active.synopsisDesc ?? active.forecastDesc);
  const warnings = [];
  if (!detail) warnings.push({code:'DETAIL_NOT_CAPTURED'});
  if (documentType === 'forecast') warnings.push({code:'FORECAST_ESTIMATE',message:'This record is a forecast.'});
  if (!dates.closing.date && documentType !== 'forecast') warnings.push({code:'CLOSING_DATE_NOT_REPORTED'});
  if (detail && hit.title && detail.opportunityTitle && hit.title !== detail.opportunityTitle)
    warnings.push({code:'SEARCH_DETAIL_TITLE_DIFFERS'});
  for (const [name, field] of Object.entries(funding).filter(([,v]) => object(v) && 'kind' in v)) {
    if (field.kind === 'source-text') warnings.push({code:'AMOUNT_SOURCE_TEXT',field:name,raw:field.raw});
  }
  if (eligibility.types.some(v => String(v.id) === '25'))
    warnings.push({code:'ELIGIBILITY_NARRATIVE_REQUIRED',message:'The provider uses Other; read its eligibility narrative.'});
  const searchRef = sourceRef(source.search,source.searchPointer ?? '/oppHits');
  const detailRef = sourceRef(source.detail,'');
  const row = {
    opportunity_id:identifier,
    opportunity_number:stringOrNull(detail?.opportunityNumber ?? hit.number),
    title:textContent(detail?.opportunityTitle ?? hit.title),
    title_raw:stringOrNull(detail?.opportunityTitle ?? hit.title),
    status:stringOrNull(hit.oppStatus ?? (documentType === 'forecast' ? 'forecasted' : null)),
    document_type:documentType,
    agency_code:stringOrNull(active.agencyCode ?? detail?.owningAgencyCode ?? hit.agencyCode),
    agency_name:stringOrNull(active.agencyName ?? agency.agencyName ?? hit.agency ?? hit.agencyName),
    top_agency_code:stringOrNull(topAgency.agencyCode ?? topAgency.topAgencyCode),
    top_agency_name:stringOrNull(topAgency.agencyName),
    revision:stringOrNull(detail?.revision),synopsis_version:stringOrNull(synopsis?.version),
    forecast_version:stringOrNull(forecast?.version),
    posting_date:dates.posting.date,posting_date_raw:dates.posting.raw,
    closing_date:dates.closing.date,closing_date_raw:dates.closing.raw,
    closing_date_timezone:dates.closing.timezone,closing_date_description:dates.closing.description,
    original_due_date:dates.original_due.date,original_due_date_raw:dates.original_due.raw,
    archive_date:dates.archive.date,
    forecast_posting_date:dates.forecast_posting.date,
    forecast_response_date:dates.forecast_response.date,forecast_response_date_raw:dates.forecast_response.raw,
    forecast_award_date:dates.forecast_award.date,forecast_project_start_date:dates.forecast_project_start.date,
    award_ceiling_raw:funding.ceiling.raw,award_ceiling_usd:funding.ceiling.decimal,
    award_floor_raw:funding.floor.raw,award_floor_usd:funding.floor.decimal,
    estimated_funding_raw:funding.estimated.raw,estimated_funding_usd:funding.estimated.decimal,
    number_of_awards_raw:funding.number_of_awards.raw,cost_sharing:funding.cost_sharing,
    eligibility_codes:eligibility.types.map(v => String(v.id ?? '')).filter(Boolean).join('|'),
    funding_instrument_codes:funding.instruments.map(v => String(v.id ?? '')).filter(Boolean).join('|'),
    funding_category_codes:funding.categories.map(v => String(v.id ?? '')).filter(Boolean).join('|'),
    assistance_listing_numbers:listingNumbers.join('|'),
    attachment_count:folders.reduce((n,v) => n + (v.synopsisAttachments?.length ?? 0),0),
    package_count:packages.length,history_count:history.length,
    source_url:opportunityURL(identifier),
    source_observed_at:detailRef?.captured_at ?? searchRef?.captured_at ?? null,
    source_data_sha256:detailRef?.data_sha256 ?? searchRef?.data_sha256 ?? null,
    description_html:descriptionHTML,description:textContent(descriptionHTML),
    eligibility,funding,dates,assistance_listings:listings,
    attachment_manifest:{folders,document_urls:documentURLs},
    package_manifest:{open:packages,closed:closedPackages},
    revision_history:history,
    forecast_object_state:forecast ? (documentType === 'forecast' ? 'active' : 'superseded') : 'absent',
    source:{search:searchRef,detail:detailRef,pointers:{
      eligibility:documentType === 'forecast' ? '/forecast/applicantEligibilityDesc' : '/synopsis/applicantEligibilityDesc',
      funding:documentType === 'forecast' ? '/forecast' : '/synopsis',
      attachments:'/synopsisAttachmentFolders',packages:'/opportunityPkgs',history:'/opportunityHistoryDetails'
    }},
    warnings
  };
  row.row_sha256 = sha(publicOpportunity(row));
  return row;
}
export function publicOpportunity(row) {
  return Object.fromEntries(DATASET_COLUMNS.map(key => [key,row[key] ?? null]));
}
export function compareOpportunities(before, after) {
  const left = new Map(before.map(row => [opportunityId(row.opportunity_id),row]));
  const right = new Map(after.map(row => [opportunityId(row.opportunity_id),row]));
  const added = [], removed = [], changed = [];
  for (const [id,row] of right) {
    if (!left.has(id)) { added.push({opportunity_id:id,after:publicOpportunity(row)}); continue; }
    const a = publicOpportunity(left.get(id)), b = publicOpportunity(row);
    const fields = DATASET_COLUMNS.filter(key => !['source_observed_at','source_data_sha256'].includes(key) &&
      canonical(a[key]) !== canonical(b[key])).map(key => ({field:key,before:a[key],after:b[key]}));
    if (fields.length) changed.push({opportunity_id:id,fields});
  }
  for (const [id,row] of left) if (!right.has(id)) removed.push({opportunity_id:id,before:publicOpportunity(row)});
  return {added,removed,changed,unchanged:right.size-added.length-changed.length};
}
