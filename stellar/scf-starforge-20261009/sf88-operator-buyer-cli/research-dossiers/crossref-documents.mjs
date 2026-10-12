// MIT. Retained Crossref source documents join the original Research edition format.
import {
  EDITION_SCHEMA, SOURCE_TERMS, ORIGIN, normalizeDoi, doiList,
  sha256, need, fail, object, projectCrossrefWork
} from '../../sf30-seller-sdk/crossref/metadata.mjs';

export const CROSSREF_DOCUMENT_SCHEMA = 'stellar-forge.crossref-source-document.v1';
export const CROSSREF_DOCUMENT_EDITION_SCHEMA = 'stellar-forge.crossref-document-edition.v1';
const MAX_BODY = 16 * 1024 * 1024;
const MAX_RAW = 40 * 1024 * 1024;
const MAX_EDITION = 64 * 1024 * 1024;
const ROLES = new Set(['source', 'provenance', 'supporting-document']);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const stable = value => JSON.stringify(canonical(value));
function cloneJson(value, code = 'CROSSREF_DOCUMENT_PROVENANCE_INVALID') {
  const seen = new Set();
  function visit(item, depth) {
    need(depth <= 64, code);
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number') { need(Number.isFinite(item), code); return; }
    need((Array.isArray(item) || (object(item) && [Object.prototype, null].includes(Object.getPrototypeOf(item)))) && !seen.has(item), code);
    seen.add(item);
    for (const child of Array.isArray(item) ? item : Object.values(item)) visit(child, depth + 1);
    seen.delete(item);
  }
  visit(value, 0);
  return JSON.parse(JSON.stringify(value));
}
function filename(value) {
  need(typeof value === 'string' && value.length > 0 && value.length <= 1024 &&
    !/^[\/\\]|^[A-Za-z]:/.test(value) && !/[\\\u0000-\u001f\u007f]/.test(value) &&
    value.split('/').every(part => part && part !== '.' && part !== '..'), 'CROSSREF_DOCUMENT_FILENAME_INVALID');
  return value;
}
function sourceUrl(value, required) {
  if (value === undefined || value === null) {
    need(!required, 'CROSSREF_DOCUMENT_SOURCE_URL_REQUIRED');
    return null;
  }
  need(typeof value === 'string' && value.length <= 20000, 'CROSSREF_DOCUMENT_SOURCE_URL_INVALID');
  let url;
  try { url = new URL(value); } catch { fail('CROSSREF_DOCUMENT_SOURCE_URL_INVALID'); }
  need(url.protocol === 'https:' && !url.username && !url.password && !url.hash,
    'CROSSREF_DOCUMENT_SOURCE_URL_INVALID');
  if (required) need(url.origin === ORIGIN, 'CROSSREF_DOCUMENT_OFFICIAL_SOURCE_REQUIRED');
  return value;
}
function decodeJson(bytes, code) {
  try { return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)); }
  catch { fail(code); }
}

/** Exact bytes and documentary provenance; no HTTP-capture fields are synthesized. */
export function parseCrossrefDocument(input) {
  need(object(input), 'CROSSREF_DOCUMENT_REQUIRED');
  const role = input.role ?? 'source';
  need(ROLES.has(role), 'CROSSREF_DOCUMENT_ROLE_INVALID');
  let bytes;
  if (input.body instanceof Uint8Array) bytes = Buffer.from(input.body);
  else {
    need(typeof input.bodyBase64 === 'string' &&
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.bodyBase64),
      'CROSSREF_DOCUMENT_BYTES_REQUIRED');
    bytes = Buffer.from(input.bodyBase64, 'base64');
    need(bytes.toString('base64') === input.bodyBase64, 'CROSSREF_DOCUMENT_ENCODING_INVALID');
  }
  need(bytes.length > 0 && bytes.length <= MAX_BODY, 'CROSSREF_DOCUMENT_SIZE_LIMIT', 413);
  const bodySha256 = sha256(bytes);
  if (input.bodySha256 !== undefined) need(input.bodySha256 === bodySha256, 'CROSSREF_DOCUMENT_BODY_HASH_MISMATCH');
  if (input.bodyBytes !== undefined) need(input.bodyBytes === bytes.length, 'CROSSREF_DOCUMENT_BODY_LENGTH_MISMATCH');
  const retrievedAt = input.retrievedAt ?? null;
  need(retrievedAt === null || (typeof retrievedAt === 'string' && Number.isFinite(Date.parse(retrievedAt))),
    'CROSSREF_DOCUMENT_TIME_INVALID');
  need(object(input.provenance ?? {}), 'CROSSREF_DOCUMENT_PROVENANCE_INVALID');
  const provenance = cloneJson(input.provenance ?? {});
  need(Buffer.byteLength(JSON.stringify(provenance)) <= 256 * 1024, 'CROSSREF_DOCUMENT_PROVENANCE_SIZE_LIMIT', 413);
  const identity = {
    schema:CROSSREF_DOCUMENT_SCHEMA, filename:filename(input.filename), role,
    sourceUrl:sourceUrl(input.sourceUrl, role === 'source'), retrievedAt, provenance,
    bodyBytes:bytes.length, bodySha256
  };
  const documentSha256 = sha256(stable(identity));
  const documentId = 'crdoc_' + documentSha256;
  if (input.schema !== undefined) need(input.schema === CROSSREF_DOCUMENT_SCHEMA, 'CROSSREF_DOCUMENT_SCHEMA_INVALID');
  if (input.documentSha256 !== undefined) need(input.documentSha256 === documentSha256, 'CROSSREF_DOCUMENT_HASH_MISMATCH');
  if (input.documentId !== undefined) need(input.documentId === documentId, 'CROSSREF_DOCUMENT_ID_MISMATCH');
  const record = {...identity, documentId, documentSha256, bodyBase64:bytes.toString('base64')};
  if (role === 'provenance') {
    need(object(decodeJson(bytes, 'CROSSREF_DOCUMENT_PROVENANCE_JSON_INVALID')),
      'CROSSREF_DOCUMENT_PROVENANCE_JSON_INVALID');
  }
  if (role !== 'source') return {record, bytes, value:null, request:null};
  const value = decodeJson(bytes, 'CROSSREF_DOCUMENT_JSON_INVALID');
  need(object(value) && value.status === 'ok' && object(value.message),
    'CROSSREF_DOCUMENT_RESPONSE_CONTRACT_INVALID');
  const url = new URL(record.sourceUrl);
  let request;
  if (url.pathname.startsWith('/works/') && url.pathname.length > 7) {
    let requested;
    try { requested = normalizeDoi(decodeURIComponent(url.pathname.slice(7))); }
    catch { fail('CROSSREF_DOCUMENT_REQUEST_DOI_INVALID'); }
    need(value['message-type'] === 'work', 'CROSSREF_DOCUMENT_RESPONSE_TYPE_MISMATCH');
    need(normalizeDoi(value.message.DOI) === requested, 'CROSSREF_DOCUMENT_RESPONSE_DOI_MISMATCH');
    request = {kind:'work', doi:requested, url:record.sourceUrl};
  } else {
    need(url.pathname === '/works' || url.pathname === '/works/', 'CROSSREF_DOCUMENT_ENDPOINT_UNSUPPORTED');
    need(value['message-type'] === 'work-list' && Array.isArray(value.message.items) &&
      Number.isSafeInteger(value.message['total-results']) && value.message['total-results'] >= 0 &&
      value.message.items.every(row => { try { return object(row) && Boolean(normalizeDoi(row.DOI)); } catch { return false; } }),
      'CROSSREF_DOCUMENT_LIST_INVALID');
    for (const key of ['rows', 'cursor', 'offset', 'filter', 'select'])
      need(url.searchParams.getAll(key).length <= 1, 'CROSSREF_DOCUMENT_QUERY_AMBIGUOUS');
    const numberParam = (key, minimum, maximum) => {
      if (!url.searchParams.has(key)) return null;
      const raw = url.searchParams.get(key);
      need(/^\d+$/.test(raw), 'CROSSREF_DOCUMENT_QUERY_NUMBER_INVALID');
      const number = Number(raw);
      need(Number.isSafeInteger(number) && number >= minimum && number <= maximum, 'CROSSREF_DOCUMENT_QUERY_NUMBER_INVALID');
      return number;
    };
    const explicitRows = numberParam('rows', 0, 1000);
    const reportedRows = value.message['items-per-page'];
    const rows = explicitRows ?? (Number.isSafeInteger(reportedRows) && reportedRows >= 0 && reportedRows <= 1000 ? reportedRows : null);
    const offset = numberParam('offset', 0, Number.MAX_SAFE_INTEGER);
    const cursor = url.searchParams.get('cursor');
    need(cursor === null || (cursor.length > 0 && cursor.length <= 12000 && !/[\u0000-\u001f\u007f]/.test(cursor)),
      'CROSSREF_DOCUMENT_CURSOR_INVALID');
    need(cursor === null || offset === null, 'CROSSREF_DOCUMENT_PAGINATION_AMBIGUOUS');
    const clauses = (url.searchParams.get('filter') ?? '').split(',').filter(Boolean);
    const updateDois = [...new Set(clauses.filter(part => part.startsWith('updates:')).map(part => normalizeDoi(part.slice(8))))];
    const queryFilters = [...url.searchParams].filter(([key, val]) =>
      key.startsWith('query') && val !== '');
    const restricted = updateDois.length > 0 &&
      (clauses.some(part => !part.startsWith('updates:')) || queryFilters.length > 0 ||
        [...url.searchParams.keys()].some(key => !['filter','rows','cursor','offset','mailto','sort','order','select'].includes(key)));
    const query = [...url.searchParams].filter(([key]) => !['cursor', 'offset', 'mailto'].includes(key))
      .sort(([ak,av], [bk,bv]) => ak.localeCompare(bk) || av.localeCompare(bv));
    request = {
      kind:updateDois.length ? 'updates' : 'work-list', url:record.sourceUrl, dois:updateDois,
      rows, rowsSource:explicitRows !== null ? 'source-url' : rows !== null ? 'provider-message' : 'unknown',
      reportedRows:Number.isSafeInteger(reportedRows) ? reportedRows : null,
      cursor, offset, reportedStart:Number.isSafeInteger(value.message.query?.['start-index']) ? value.message.query['start-index'] : null,
      projectionFields:(url.searchParams.get('select') ?? '').split(',').filter(Boolean),
      restricted, query,
      collectionKey:sha256(stable({endpoint:ORIGIN + '/works', query, mode:cursor === null ? 'offset' : 'cursor'}))
    };
  }
  return {record, bytes, value, request};
}

function binding(record, request) {
  return {
    documentId:record.documentId, documentSha256:record.documentSha256,
    bodySha256:record.bodySha256, bodyBytes:record.bodyBytes,
    sourceUrl:record.sourceUrl, retrievedAt:record.retrievedAt,
    role:request.kind === 'work' ? 'metadata' : request.kind === 'updates' ? 'registered-update' : 'work-list',
    requestedDois:request.kind === 'work' ? [request.doi] : request.dois,
    provenance:structuredClone(record.provenance)
  };
}
function collectionCoverage(pages) {
  const first = pages[0], mode = first.request.cursor === null ? 'offset' : 'cursor';
  const firstOffset = first.request.offset ?? first.request.reportedStart;
  const fromBeginning = mode === 'cursor' ? first.request.cursor === '*' : firstOffset === 0;
  const totals = new Set(), seenPositions = new Set(), seenDois = new Set(), issues = new Set();
  const initialTotal = first.value.message['total-results'];
  let expected = mode === 'cursor' ? first.request.cursor : firstOffset;
  let finalPage = false, nextCursor = null, nextOffset = null, received = 0, duplicates = 0;
  for (const page of pages) {
    const {request, value} = page, message = value.message;
    const position = mode === 'cursor' ? request.cursor : request.offset ?? request.reportedStart;
    if (finalPage) issues.add('CROSSREF_DOCUMENT_AFTER_FINAL_PAGE');
    if (position === null || position !== expected || seenPositions.has(position)) issues.add('CROSSREF_DOCUMENT_PAGE_CHAIN_INVALID');
    if (request.rows !== first.request.rows) issues.add('CROSSREF_DOCUMENT_PAGE_SIZE_CHANGED');
    if (request.rows === null || request.rows === 0) issues.add('CROSSREF_DOCUMENT_PAGE_SIZE_UNAVAILABLE');
    if (request.reportedRows !== null && request.rows !== null && request.reportedRows !== request.rows)
      issues.add('CROSSREF_DOCUMENT_PAGE_SIZE_MISMATCH');
    if (mode === 'offset' && request.offset !== null && request.reportedStart !== null && request.offset !== request.reportedStart)
      issues.add('CROSSREF_DOCUMENT_OFFSET_MISMATCH');
    if (request.rows !== null && message.items.length > request.rows) issues.add('CROSSREF_DOCUMENT_PAGE_OVERFULL');
    seenPositions.add(position); totals.add(message['total-results']); received += message.items.length;
    for (const work of message.items) {
      const doi = normalizeDoi(work.DOI);
      if (seenDois.has(doi)) duplicates++; else seenDois.add(doi);
    }
    finalPage = request.rows !== null && request.rows > 0 && message.items.length < request.rows;
    nextCursor = null; nextOffset = null;
    if (!finalPage) {
      if (mode === 'cursor') {
        const next = message['next-cursor'];
        if (typeof next !== 'string' || !next) issues.add('CROSSREF_DOCUMENT_NEXT_CURSOR_MISSING');
        else if (seenPositions.has(next)) issues.add('CROSSREF_DOCUMENT_CURSOR_NOT_ADVANCING');
        else nextCursor = next;
        expected = nextCursor;
      } else {
        if (position !== null && request.rows !== null && request.rows > 0) nextOffset = position + request.rows;
        expected = nextOffset;
      }
    }
  }
  if (!fromBeginning) issues.add('CROSSREF_DOCUMENT_START_NOT_RETAINED');
  if (totals.size !== 1) issues.add('CROSSREF_DOCUMENT_TOTAL_CHANGED');
  if (duplicates) issues.add('CROSSREF_DOCUMENT_DUPLICATE_RECORDS');
  if (finalPage && (received !== initialTotal || seenDois.size !== initialTotal)) issues.add('CROSSREF_DOCUMENT_COUNT_MISMATCH');
  const complete = fromBeginning && finalPage && issues.size === 0;
  return {
    kind:first.request.kind, sourceKind:'retained-document', collectionKey:first.request.collectionKey,
    status:complete ? 'COMPLETE' : 'PARTIAL', scope:first.request.restricted ? 'FILTERED_UPDATES' :
      first.request.kind === 'updates' ? 'REGISTERED_UPDATES' : 'DOCUMENT_QUERY',
    dois:first.request.dois, query:first.request.query,
    projectionFields:first.request.projectionFields,
    pages:pages.length, records:received, uniqueRecords:seenDois.size, duplicateRecords:duplicates,
    totalResults:initialTotal, lastTotalResults:pages.at(-1).value.message['total-results'],
    fromBeginning, finalPage, nextCursor, nextOffset, issues:[...issues],
    retrievedAt:pages.at(-1).record.retrievedAt,
    documents:pages.map(({record, request}) => binding(record, request))
  };
}

/**
 * Build an edition from retained documents, in their original collection/page order.
 * documents: {filename, body:Uint8Array|bodyBase64, sourceUrl?, role?, provenance?, retrievedAt?}[].
 * dois optionally selects expected work identities; updatesDois independently selects expected
 * registered-update coverage. Their inferred defaults are recorded explicitly in usage.selection.
 */
export function buildCrossrefDocumentEdition({documents, query, label = 'Retained Crossref documents', dois, updatesDois} = {}) {
  need(typeof query === 'string' && query.trim().length > 0 && query.length <= 12000, 'CROSSREF_RESEARCH_QUESTION_REQUIRED');
  need(typeof label === 'string' && label.trim().length > 0 && label.length <= 200, 'CROSSREF_LABEL_INVALID');
  need(Array.isArray(documents) && documents.length > 0 && documents.length <= 2000, 'CROSSREF_DOCUMENTS_REQUIRED');
  const parsed = documents.map(parseCrossrefDocument);
  need(parsed.reduce((total, row) => total + row.bytes.length, 0) <= MAX_RAW, 'CROSSREF_DOCUMENT_TOTAL_SIZE_LIMIT', 413);
  need(new Set(parsed.map(row => row.record.filename)).size === parsed.length, 'CROSSREF_DOCUMENT_FILENAME_DUPLICATED');
  const sources = parsed.filter(row => row.record.role === 'source');
  need(sources.length > 0, 'CROSSREF_SOURCE_DOCUMENT_REQUIRED');
  const works = new Map(), groups = new Map(), warnings = [], metadataDois = new Set(), inferredUpdateDois = new Set();
  for (const {record, value, request} of sources) {
    if (request.kind === 'work') metadataDois.add(request.doi);
    else {
      if (!groups.has(request.collectionKey)) groups.set(request.collectionKey, []);
      groups.get(request.collectionKey).push({record, value, request});
      for (const doi of request.dois) inferredUpdateDois.add(doi);
      if (request.projectionFields.length) warnings.push({
        code:'CROSSREF_DOCUMENT_FIELDS_PROJECTED', documentId:record.documentId, fields:request.projectionFields
      });
    }
    const occurrence = binding(record, request);
    for (const work of request.kind === 'work' ? [value.message] : value.message.items) {
      const doi = normalizeDoi(work.DOI), prior = works.get(doi);
      if (prior) {
        if (stable(prior.work) !== stable(work)) warnings.push({
          code:'CROSSREF_DOCUMENT_RECORD_VARIANTS', doi, affectsCoverage:false,
          previousDocumentId:prior.occurrences.at(-1).documentId, documentId:record.documentId,
          selected:'last-retained-occurrence'
        });
        prior.work = work; prior.occurrences.push(occurrence);
      } else works.set(doi, {work, occurrences:[occurrence]});
    }
  }
  const selectedDois = dois === undefined ? null : doiList(dois);
  const selectedUpdates = updatesDois === undefined ? null : (Array.isArray(updatesDois) && updatesDois.length === 0 ? [] : doiList(updatesDois));
  const inferred = [...new Set([...metadataDois, ...inferredUpdateDois])];
  const requestedDois = selectedDois ?? (inferred.length ? inferred : [...works.keys()]).sort();
  const updateRequestedDois = selectedUpdates ?? [...inferredUpdateDois].sort();
  const collections = [...groups.values()].map(collectionCoverage), coveredUpdates = new Set();
  for (const collection of collections) {
    if (collection.status !== 'COMPLETE') warnings.push({
      code:'CROSSREF_DOCUMENT_COLLECTION_PARTIAL', collectionKey:collection.collectionKey,
      kind:collection.kind, issues:collection.issues, nextCursor:collection.nextCursor, nextOffset:collection.nextOffset
    });
    if (collection.scope === 'FILTERED_UPDATES') warnings.push({
      code:'CROSSREF_DOCUMENT_UPDATES_SCOPE_RESTRICTED', collectionKey:collection.collectionKey, dois:collection.dois
    });
    if (collection.kind === 'updates' && collection.status === 'COMPLETE' && collection.scope === 'REGISTERED_UPDATES' &&
      collection.projectionFields.length === 0) for (const doi of collection.dois) coveredUpdates.add(doi);
  }
  const missingDois = requestedDois.filter(doi => !works.has(doi));
  const missingUpdates = updateRequestedDois.filter(doi => !coveredUpdates.has(doi));
  if (missingDois.length) warnings.push({code:'CROSSREF_DOCUMENT_METADATA_INCOMPLETE', dois:missingDois});
  if (missingUpdates.length) warnings.push({code:'CROSSREF_DOCUMENT_UPDATES_INCOMPLETE', dois:missingUpdates});
  const results = [...works].sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => {
    const result = projectCrossrefWork(row.work, []);
    result.metadata.sourceDocuments = structuredClone(row.occurrences);
    return result;
  });
  const coverage = warnings.some(warning => warning.affectsCoverage !== false) ? 'PARTIAL' : 'COMPLETE';
  const envelope = {
    schema:EDITION_SCHEMA, provider:'crossref-document', query, label, sourceTerms:SOURCE_TERMS,
    success:true, status:coverage === 'COMPLETE' ? 'AVAILABLE' : 'PARTIAL', results,
    usage:{
      schema:CROSSREF_DOCUMENT_EDITION_SCHEMA, sourceKind:'retained-document', coverage, sourceCoverage:coverage,
      selection:{dois:selectedDois, updatesDois:selectedUpdates},
      requestedDois, receivedDois:[...works.keys()].sort(), metadataDois:[...metadataDois].sort(),
      missingDois, updateRequestedDois, missingUpdates,
      metadataLookup:metadataDois.size ? 'DOCUMENTS_RETAINED' : 'NOT_REQUESTED',
      updatesLookup:updateRequestedDois.length || inferredUpdateDois.size ? 'REQUESTED' : 'NOT_REQUESTED',
      updates:collections.filter(row => row.kind === 'updates'), collections,
      sourceDocuments:sources.map(({record, request}) => binding(record, request)),
      sourceRecordsReceived:results.length, sourcePages:sources.length,
      originalDocumentCount:parsed.length, originalDocumentBytes:parsed.reduce((total,row) => total + row.bytes.length, 0)
    },
    warnings, originalDocuments:parsed.map(row => row.record)
  };
  need(Buffer.byteLength(JSON.stringify(envelope)) <= MAX_EDITION, 'RESEARCH_RESPONSE_TOO_LARGE', 413);
  return envelope;
}

/** Rebuild from all retained bodies and compare the complete envelope, including provenance. */
export function validateCrossrefDocumentEdition(value) {
  need(object(value) && value.schema === EDITION_SCHEMA && value.provider === 'crossref-document' &&
    value.usage?.schema === CROSSREF_DOCUMENT_EDITION_SCHEMA && object(value.usage.selection) &&
    Array.isArray(value.originalDocuments), 'CROSSREF_DOCUMENT_EDITION_REQUIRED');
  const selected = value.usage.selection;
  need(Object.keys(selected).every(key => ['dois','updatesDois'].includes(key)) &&
    (selected.dois === null || Array.isArray(selected.dois)) &&
    (selected.updatesDois === null || Array.isArray(selected.updatesDois)), 'CROSSREF_DOCUMENT_SELECTION_INVALID');
  const rebuilt = buildCrossrefDocumentEdition({
    documents:value.originalDocuments, query:value.query, label:value.label,
    ...(selected.dois === null ? {} : {dois:selected.dois}),
    ...(selected.updatesDois === null ? {} : {updatesDois:selected.updatesDois})
  });
  need(stable(value) === stable(rebuilt), 'CROSSREF_DOCUMENT_EDITION_PROJECTION_CHANGED');
  return value;
}
