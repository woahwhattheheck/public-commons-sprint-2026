// MIT. Original Europe PMC core search pages, complete source editions and metadata review.
import {createHash} from 'node:crypto';

export const EUROPE_PMC_ORIGIN = 'https://www.ebi.ac.uk';
export const EUROPE_PMC_SEARCH = EUROPE_PMC_ORIGIN + '/europepmc/webservices/rest/search';
export const EUROPE_PMC_FIELDS = EUROPE_PMC_ORIGIN + '/europepmc/webservices/rest/fields?format=json';
export const EUROPE_PMC_EDITION = 'stellar-forge.europe-pmc-edition.v1';
export const EUROPE_PMC_DOCUMENT = 'stellar-forge.europe-pmc-source-document.v1';
export const MAX_PAGE_BYTES = 16 * 1024 * 1024;
export const MAX_RAW_BYTES = 24 * 1024 * 1024;
export const MAX_EDITION_BYTES = 64 * 1024 * 1024;
export const SOURCE_TERMS = 'Europe PMC REST API: https://europepmc.org/RestfulWebService . Original provider, bibliographic, abstract and linked full-text rights remain with their respective sources; retain each record licence and attribution. Public availability does not grant a blanket licence for every record or linked document.';
export class EuropePmcError extends Error {
  constructor(code, details = {}) { super(code); this.name = 'EuropePmcError'; this.code = code; this.details = details; }
}
export function need(value, code, details) { if (!value) throw new EuropePmcError(code, details); }
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  need(value === null || ['string','boolean'].includes(typeof value) || typeof value === 'number' && Number.isFinite(value), 'EUROPE_PMC_JSON_VALUE_INVALID');
  return JSON.stringify(value);
}
export const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export function parseJson(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
  catch { throw new EuropePmcError('EUROPE_PMC_JSON_INVALID'); }
}
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const plainString = (value, maximum) => typeof value === 'string' && value.length <= maximum && !value.includes('\0');
export function searchSelection(input = {}) {
  need(object(input), 'EUROPE_PMC_SEARCH_REQUIRED');
  need(Object.keys(input).every(key => ['query','pageSize','maxPages','synonym'].includes(key)), 'EUROPE_PMC_SEARCH_FIELDS_INVALID');
  const selection = {query: input.query?.trim(), pageSize: input.pageSize ?? 100, maxPages: input.maxPages ?? 1000, synonym: input.synonym ?? false};
  need(plainString(selection.query, 12000) && selection.query.length > 0, 'EUROPE_PMC_QUERY_REQUIRED');
  need(Number.isSafeInteger(selection.pageSize) && selection.pageSize >= 1 && selection.pageSize <= 1000, 'EUROPE_PMC_PAGE_SIZE_INVALID');
  need(Number.isSafeInteger(selection.maxPages) && selection.maxPages >= 1 && selection.maxPages <= 10000, 'EUROPE_PMC_PAGE_LIMIT_INVALID');
  need(typeof selection.synonym === 'boolean', 'EUROPE_PMC_SYNONYM_INVALID');
  return selection;
}
export function requestFor(input, cursorMark = '*') {
  const selection = searchSelection(input);
  need(plainString(cursorMark, 32000) && cursorMark.length > 0, 'EUROPE_PMC_CURSOR_INVALID');
  const url = new URL(EUROPE_PMC_SEARCH);
  url.searchParams.set('query', selection.query); url.searchParams.set('format', 'json');
  url.searchParams.set('resultType', 'core'); url.searchParams.set('cursorMark', cursorMark);
  url.searchParams.set('pageSize', String(selection.pageSize));
  if (selection.synonym) url.searchParams.set('synonym', 'true');
  return {method: 'GET', url: url.href, query: selection.query, pageSize: selection.pageSize, synonym: selection.synonym, cursorMark};
}
export function requestFromUrl(value, {maxPages = 1000} = {}) {
  let url; try { url = new URL(value); } catch { throw new EuropePmcError('EUROPE_PMC_SOURCE_URL_INVALID'); }
  need(url.origin === EUROPE_PMC_ORIGIN && url.pathname === '/europepmc/webservices/rest/search' &&
    !url.username && !url.password && !url.hash, 'EUROPE_PMC_SOURCE_URL_INVALID');
  const allowed = new Set(['query','format','resultType','cursorMark','pageSize','synonym']);
  for (const key of url.searchParams.keys()) need(allowed.has(key) && url.searchParams.getAll(key).length === 1, 'EUROPE_PMC_REQUEST_FIELDS_INVALID');
  need(url.searchParams.get('format') === 'json' && url.searchParams.get('resultType') === 'core', 'EUROPE_PMC_CORE_JSON_REQUIRED');
  const synonym = url.searchParams.get('synonym');
  need(synonym === null || ['true','false','TRUE','FALSE'].includes(synonym), 'EUROPE_PMC_SYNONYM_INVALID');
  const selection = searchSelection({query: url.searchParams.get('query'), pageSize: Number(url.searchParams.get('pageSize')),
    maxPages, synonym: synonym?.toLowerCase() === 'true'});
  return {...requestFor(selection, url.searchParams.get('cursorMark')), originalUrl: value, selection};
}
function bytesOf(value) {
  need(typeof value === 'string' && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value), 'EUROPE_PMC_BASE64_INVALID');
  const bytes = Buffer.from(value, 'base64'); need(bytes.toString('base64') === value, 'EUROPE_PMC_BASE64_INVALID'); return bytes;
}
export function sourceDocument({url, bytes, kind = 'retained-document', observation, provenance = {}}) {
  requestFromUrl(url);
  need(bytes instanceof Uint8Array && bytes.byteLength <= MAX_PAGE_BYTES, 'EUROPE_PMC_PAGE_SIZE_EXCEEDED');
  need(['retained-document','http-response'].includes(kind) && object(observation) && object(provenance), 'EUROPE_PMC_DOCUMENT_PROVENANCE_REQUIRED');
  if (kind === 'retained-document') {
    need(observation.status === null && observation.headers === null && observation.retrievedAt === null && iso(observation.retainedAt),
      'EUROPE_PMC_DOCUMENT_HTTP_METADATA_UNAVAILABLE');
  } else {
    need(Number.isInteger(observation.status) && observation.status >= 100 && observation.status <= 599 &&
      object(observation.headers) && iso(observation.retrievedAt), 'EUROPE_PMC_HTTP_OBSERVATION_INVALID');
    for (const [name,value] of Object.entries(observation.headers))
      need(['content-type','date','etag','last-modified','retry-after','content-length','content-encoding'].includes(name) &&
        typeof value === 'string', 'EUROPE_PMC_HTTP_HEADERS_INVALID');
  }
  canonical(observation); canonical(provenance);
  const body = Buffer.from(bytes);
  const selected = {schema: EUROPE_PMC_DOCUMENT, kind, url, bodyBytes: body.length, bodySha256: sha256(body),
    observation, provenance};
  return {...selected, documentId: 'epdoc_' + sha256(Buffer.from(canonical(selected))), bodyBase64: body.toString('base64')};
}
export function validateDocument(value) {
  need(object(value) && value.schema === EUROPE_PMC_DOCUMENT, 'EUROPE_PMC_DOCUMENT_INVALID');
  const bytes = bytesOf(value.bodyBase64);
  const rebuilt = sourceDocument({url: value.url, bytes, kind: value.kind, observation: value.observation, provenance: value.provenance});
  need(canonical(rebuilt) === canonical(value), 'EUROPE_PMC_DOCUMENT_CHANGED'); return {document: value, bytes};
}
export function readSearchPage(value, selection, cursorMark) {
  selection = searchSelection(selection);
  const {document, bytes} = validateDocument(value);
  const requested = requestFromUrl(document.url, {maxPages: selection.maxPages}), expected = requestFor(selection, cursorMark);
  need(requested.url === expected.url, 'EUROPE_PMC_SOURCE_REQUEST_MISMATCH');
  if (document.kind === 'http-response') need(document.observation.status >= 200 && document.observation.status < 300,
    'EUROPE_PMC_PROVIDER_HTTP_ERROR', {status: document.observation.status, documentId: document.documentId});
  const page = parseJson(bytes);
  need(object(page) && object(page.request) && object(page.resultList) && Array.isArray(page.resultList.result) &&
    Number.isSafeInteger(page.hitCount) && page.hitCount >= 0 && plainString(page.version, 100), 'EUROPE_PMC_SEARCH_RESPONSE_INVALID');
  const echo = page.request;
  need(echo.queryString === selection.query && echo.resultType === 'core' && echo.cursorMark === cursorMark &&
    echo.pageSize === selection.pageSize && echo.synonym === selection.synonym &&
    (echo.sort === '' || echo.sort === undefined), 'EUROPE_PMC_REQUEST_ECHO_MISMATCH');
  need(page.resultList.result.length <= selection.pageSize, 'EUROPE_PMC_PAGE_RECORD_COUNT_INVALID');
  for (const record of page.resultList.result) {
    need(object(record) && plainString(record.id, 512) && record.id.length > 0 &&
      typeof record.source === 'string' && /^[A-Z0-9_-]{1,40}$/.test(record.source), 'EUROPE_PMC_RECORD_ID_INVALID');
    canonical(record);
  }
  const next = page.nextCursorMark ?? null;
  need(next === null || plainString(next, 32000) && next.length > 0, 'EUROPE_PMC_NEXT_CURSOR_INVALID');
  if (page.nextPageUrl !== undefined) {
    need(next !== null, 'EUROPE_PMC_NEXT_CURSOR_MISSING');
    const nextRequest = requestFromUrl(page.nextPageUrl, {maxPages: selection.maxPages});
    need(nextRequest.url === requestFor(selection, next).url, 'EUROPE_PMC_NEXT_PAGE_REQUEST_CHANGED');
  }
  return {page, records: page.resultList.result, nextCursorMark: next, document};
}
export const recordKey = row => row.source + ':' + row.id;
function authors(row) {
  return Array.isArray(row.authorList?.author) ? row.authorList.author.map(author => author.fullName ?? author.collectiveName ??
    [author.firstName,author.lastName].filter(Boolean).join(' ')).filter(Boolean) :
    typeof row.authorString === 'string' && row.authorString ? [row.authorString] : [];
}
function resultFor(entry) {
  const selected = entry.variants.find(value => value.sha256 === entry.occurrences.at(-1).recordSha256);
  need(selected, 'EUROPE_PMC_LATEST_OCCURRENCE_MISSING');
  const native = selected.record, key = recordKey(native);
  const doi = typeof native.doi === 'string' ? native.doi.trim().toLowerCase() : null;
  const url = 'https://europepmc.org/article/' + encodeURIComponent(native.source) + '/' + encodeURIComponent(native.id);
  return {id: key, title: native.title ?? key, url, doi, content: native.abstractText ?? '',
    publishedAt: native.firstPublicationDate ?? native.electronicPublicationDate ?? native.pubYear ?? null,
    authors: authors(native), citation: {provider: 'europe-pmc', source: native.source, id: native.id, doi, url},
    references: native.commentCorrectionList?.commentCorrection ?? [],
    metadata: {europePmc: native, sourceKey: key, sourceOccurrences: entry.occurrences,
      variants: entry.variants.map(value => ({recordSha256: value.sha256, record: value.record, documentIds: value.documentIds})),
      nativeIdentity: {source: native.source, id: native.id, pmid: native.pmid ?? null, pmcid: native.pmcid ?? null, doi},
      licence: native.license ?? null, openAccess: native.isOpenAccess ?? null}};
}
export function editionPagination(value = {startCursorMark:'*',parent:null}) {
  need(object(value) && Object.keys(value).every(key=>['startCursorMark','parent'].includes(key)) &&
    plainString(value.startCursorMark,32000) && value.startCursorMark.length>0,'EUROPE_PMC_PAGINATION_SELECTION_INVALID');
  if(value.parent===null) need(value.startCursorMark==='*','EUROPE_PMC_ORIGINAL_CURSOR_REQUIRED');
  else {
    const parent=value.parent;
    need(object(parent) && Object.keys(parent).sort().join(',')===
      'boundaryDocumentId,cursorMark,editionSha256,operationId,planSha256' &&
      /^epop_[a-f0-9]{64}$/.test(parent.operationId) && /^[a-f0-9]{64}$/.test(parent.editionSha256) &&
      /^[a-f0-9]{64}$/.test(parent.planSha256) && parent.cursorMark===value.startCursorMark &&
      (parent.boundaryDocumentId===null || /^epdoc_[a-f0-9]{64}$/.test(parent.boundaryDocumentId)),
      'EUROPE_PMC_CONTINUATION_BINDING_INVALID');
  }
  return structuredClone(value);
}
// A conservative incremental serialization bound. Each native occurrence is
// counted as its own complete normalized record, so deduplication can only
// reduce this contribution. The final edition still receives an exact build.
export function estimatePageBytes(parsed, pageIndex = 0) {
  const contribution=(value,indent)=>{const body=JSON.stringify(value,null,2);return Buffer.byteLength(body)+
    (body.match(/\n/g)?.length??0)*indent+indent+4;};
  const {document,page,records,nextCursorMark}=parsed,{bodyBase64,...descriptor}=document;
  let bytes=contribution(document,4)+contribution(descriptor,6)+contribution({index:pageIndex,documentId:document.documentId,
    bodySha256:document.bodySha256,bodyBytes:document.bodyBytes,url:document.url,kind:document.kind,
    observation:document.observation,providerVersion:page.version,cursorMark:page.request.cursorMark,
    nextCursorMark,hitCount:page.hitCount,records:records.length},6)+8192;
  for(let rowIndex=0;rowIndex<records.length;rowIndex++) {
    const record=records[rowIndex],hash=sha256(Buffer.from(canonical(record)));
    const entry={occurrences:[{documentId:document.documentId,bodySha256:document.bodySha256,pageIndex,rowIndex,recordSha256:hash}],
      variants:[{sha256:hash,record,documentIds:[document.documentId]}]};
    bytes+=contribution(resultFor(entry),4)+2048+2*Buffer.byteLength(JSON.stringify(recordKey(record)));
  }
  return bytes;
}
export function buildEdition({selection, documents, label, createdAt, sourceTerms = SOURCE_TERMS, stopReason = null,
  pagination = {startCursorMark:'*',parent:null}}) {
  selection = searchSelection(selection); pagination = editionPagination(pagination);
  need(Array.isArray(documents) && documents.length > 0 && documents.length <= selection.maxPages, 'EUROPE_PMC_SOURCE_PAGES_REQUIRED');
  need(plainString(label, 300) && label.trim() && iso(createdAt) && plainString(sourceTerms, 16000) && sourceTerms.trim(),
    'EUROPE_PMC_EDITION_METADATA_REQUIRED');
  need(stopReason === null || ['page-limit','byte-limit','operator-stop'].includes(stopReason), 'EUROPE_PMC_STOP_REASON_INVALID');
  const entries = new Map(), pages = [], seen = new Set(); let cursor = pagination.startCursorMark, terminal = null, rawBytes = 0, returned = 0;
  const issues = [];
  for (let index = 0; index < documents.length; index++) {
    need(terminal === null && !seen.has(cursor), 'EUROPE_PMC_CURSOR_CHAIN_INVALID');
    seen.add(cursor);
    const parsed = readSearchPage(documents[index], selection, cursor), page = parsed.page;
    rawBytes += parsed.document.bodyBytes; need(rawBytes <= MAX_RAW_BYTES, 'EUROPE_PMC_RAW_SOURCE_BUDGET_EXCEEDED');
    pages.push({index, documentId: parsed.document.documentId, bodySha256: parsed.document.bodySha256, bodyBytes: parsed.document.bodyBytes,
      url: parsed.document.url, kind: parsed.document.kind, observation: parsed.document.observation,
      providerVersion: page.version, cursorMark: cursor, nextCursorMark: parsed.nextCursorMark, hitCount: page.hitCount, records: parsed.records.length});
    for (let rowIndex = 0; rowIndex < parsed.records.length; rowIndex++) {
      const record = parsed.records[rowIndex], key = recordKey(record), sha = sha256(Buffer.from(canonical(record)));
      let entry = entries.get(key); if (!entry) {entry = {occurrences: [], variants: []}; entries.set(key, entry);}
      entry.occurrences.push({documentId: parsed.document.documentId, bodySha256: parsed.document.bodySha256, pageIndex: index, rowIndex, recordSha256: sha});
      let variant = entry.variants.find(value => value.sha256 === sha);
      if (!variant) {variant = {sha256: sha, record, documentIds: []}; entry.variants.push(variant);}
      if (!variant.documentIds.includes(parsed.document.documentId)) variant.documentIds.push(parsed.document.documentId);
      returned++;
    }
    if (parsed.records.length === 0) terminal = 'empty-page';
    else if (!parsed.nextCursorMark || parsed.nextCursorMark === cursor) terminal = 'no-next-cursor';
    else {need(!seen.has(parsed.nextCursorMark), 'EUROPE_PMC_CURSOR_CYCLE'); cursor = parsed.nextCursorMark;}
  }
  const totals = [...new Set(pages.map(page => page.hitCount))];
  if (totals.length > 1) issues.push({code: 'REPORTED_TOTAL_CHANGED_DURING_PAGING', values: totals});
  if (terminal && pagination.parent === null && totals.some(total => total !== entries.size))
    issues.push({code: 'REPORTED_TOTAL_DIFFERS_FROM_RETAINED_UNIQUE_RECORDS', values: totals, retained: entries.size});
  const variants = [...entries].filter(([,value]) => value.variants.length > 1).map(([key,value]) => ({key, variants: value.variants.length}));
  if (variants.length) issues.push({code: 'NATIVE_RECORD_CHANGED_WITHIN_ACQUISITION', records: variants});
  if (returned > entries.size) issues.push({code: 'REPEATED_NATIVE_RECORDS', occurrences: returned - entries.size});
  if (!terminal) need(stopReason !== null || documents.length === selection.maxPages, 'EUROPE_PMC_PAGINATION_INCOMPLETE');
  const boundary = terminal ?? stopReason ?? 'page-limit';
  if (pagination.parent !== null) issues.push({code:'CONTINUATION_PART',parent:pagination.parent});
  const complete = pagination.parent === null && terminal !== null && issues.every(issue => issue.code === 'REPEATED_NATIVE_RECORDS');
  const results = [...entries].map(([,entry]) => resultFor(entry));
  const coverage = {complete, startCursorMark:pagination.startCursorMark, parent:pagination.parent, terminal: terminal !== null, stopReason: boundary, pages: pages.length,
    reportedTotals: totals, returnedOccurrences: returned, uniqueRecords: results.length, rawBytes,
    nextCursorMark: terminal ? null : cursor, issues,
    consistency: 'Provider cursor paging is a live search, not a transactionally frozen database snapshot.'};
  const sourceDocuments = documents.map(({bodyBase64, ...document}) => document);
  const output = {schema: 'sf88-research-results-v1', provider: 'europe-pmc', status: complete ? 'AVAILABLE' : 'PARTIAL',
    query: selection.query, sourceTerms, results, warnings: issues.map(issue => issue.code),
    metadata: {europePmcEdition: EUROPE_PMC_EDITION, label, createdAt, selection, pagination, sourceDocuments},
    usage: {provider: 'europe-pmc', coverage, pages, acquisition: {sourceKinds: [...new Set(documents.map(value => value.kind))],
      selectedPageLimit: selection.maxPages, selectedPageSize: selection.pageSize, bodyBytes: rawBytes}},
    originalDocuments: documents};
  need(jsonBytes(output).length <= MAX_EDITION_BYTES, 'EUROPE_PMC_EDITION_SIZE_EXCEEDED');
  return output;
}
export function validateEdition(value) {
  need(object(value) && value.schema === 'sf88-research-results-v1' && value.provider === 'europe-pmc' &&
    value.metadata?.europePmcEdition === EUROPE_PMC_EDITION, 'EUROPE_PMC_EDITION_INVALID');
  const rebuilt = buildEdition({selection: value.metadata.selection, documents: value.originalDocuments,
    label: value.metadata.label, createdAt: value.metadata.createdAt, sourceTerms: value.sourceTerms, pagination:value.metadata.pagination,
    stopReason: ['page-limit','byte-limit','operator-stop'].includes(value.usage?.coverage?.stopReason) ? value.usage.coverage.stopReason : null});
  need(canonical(rebuilt) === canonical(value), 'EUROPE_PMC_EDITION_CHANGED'); return value;
}
const escapePointer = value => value.replaceAll('~','~0').replaceAll('/','~1');
function changes(left, right, pointer = '', output = []) {
  if (canonical(left) === canonical(right)) return output;
  if (object(left) && object(right)) {
    for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
      const path = pointer + '/' + escapePointer(key);
      if (!(key in left)) output.push({path, kind: 'added', after: right[key]});
      else if (!(key in right)) output.push({path, kind: 'removed', before: left[key]});
      else changes(left[key], right[key], path, output);
    }
  } else if (Array.isArray(left) && Array.isArray(right)) {
    for (let index = 0; index < Math.max(left.length, right.length); index++) {
      const path = pointer + '/' + index;
      if (index >= left.length) output.push({path, kind: 'added', after: right[index]});
      else if (index >= right.length) output.push({path, kind: 'removed', before: left[index]});
      else changes(left[index], right[index], path, output);
    }
  } else output.push({path: pointer || '/', kind: 'changed', before: left, after: right});
  return output;
}
export function compareEditions(before, after) {
  validateEdition(before); validateEdition(after);
  const old = new Map(before.results.map(record => [record.id,record])), current = new Map(after.results.map(record => [record.id,record]));
  const items = [];
  for (const key of [...new Set([...old.keys(), ...current.keys()])].sort()) {
    const a = old.get(key), b = current.get(key);
    if (!a) items.push({key, status: 'ADDED', title: b.title, after: b.metadata.europePmc, changes: []});
    else if (!b) items.push({key, status: 'ABSENT_FROM_NEW_EDITION', title: a.title, before: a.metadata.europePmc, changes: []});
    else {const fields = changes(a.metadata.europePmc, b.metadata.europePmc);
      items.push({key, status: fields.length ? 'METADATA_CHANGED' : 'UNCHANGED', title: b.title, changes: fields,
        beforeRecordSha256: sha256(Buffer.from(canonical(a.metadata.europePmc))), afterRecordSha256: sha256(Buffer.from(canonical(b.metadata.europePmc)))});}
  }
  return {schema: 'stellar-forge.europe-pmc-comparison.v1',
    before: {sha256: sha256(jsonBytes(before)), label: before.metadata.label, selection: before.metadata.selection, coverage: before.usage.coverage},
    after: {sha256: sha256(jsonBytes(after)), label: after.metadata.label, selection: after.metadata.selection, coverage: after.usage.coverage},
    queryScopeChanged: before.query !== after.query || before.metadata.selection.synonym !== after.metadata.selection.synonym,
    meaning: 'Absence refers only to these retained editions; it is not evidence that a publication was withdrawn or deleted.',
    counts: Object.fromEntries(['ADDED','ABSENT_FROM_NEW_EDITION','METADATA_CHANGED','UNCHANGED'].map(status => [status,items.filter(row => row.status === status).length])),
    items};
}
const risValue = value => String(value ?? '').replaceAll(/\r?\n/g, ' ').replaceAll('\r', ' ');
function risType(native) {
  const values = Array.isArray(native.pubTypeList?.pubType) ? native.pubTypeList.pubType.map(value => String(value).toLowerCase()) : [];
  if (values.some(value => value === 'preprint' || value === 'unpublished work')) return 'UNPB';
  if (values.some(value => value === 'book chapter' || value === 'chapter')) return 'CHAP';
  if (values.some(value => value === 'book' || value === 'monograph')) return 'BOOK';
  if (values.some(value => value === 'thesis' || value === 'dissertation')) return 'THES';
  if (values.some(value => value === 'conference paper' || value === 'conference proceedings')) return 'CONF';
  if (values.some(value => value === 'dataset' || value === 'data set')) return 'DATA';
  if (values.some(value => value === 'journal article' || value === 'review' || value === 'editorial' || value === 'letter')) return 'JOUR';
  return 'GEN';
}
export function exportRIS(edition) {
  validateEdition(edition);
  return Buffer.from(edition.results.map(record => {
    const native = record.metadata.europePmc, lines = ['TY  - ' + risType(native),'ID  - ' + risValue(record.id),'TI  - ' + risValue(record.title)];
    for (const author of record.authors) lines.push('AU  - ' + risValue(author));
    const mapping = {PY: native.pubYear, DA: native.firstPublicationDate, JO: native.journalInfo?.journal?.title,
      J2: native.journalInfo?.journal?.medlineAbbreviation, VL: native.journalInfo?.volume, IS: native.journalInfo?.issue,
      SP: native.pageInfo, DO: record.doi, UR: record.url, AB: record.content, LA: native.language};
    for (const [tag,value] of Object.entries(mapping)) if (value !== undefined && value !== null && value !== '') lines.push(tag + '  - ' + risValue(value));
    lines.push('N1  - Original publication types ' + risValue(JSON.stringify(native.pubTypeList ?? {})));
    lines.push('N1  - Native Europe PMC identity ' + risValue(record.id) + '; retained licence: ' + risValue(native.license ?? 'not supplied'));
    lines.push('ER  -',''); return lines.join('\r\n');
  }).join('\r\n'));
}
const csvCell = value => '"' + String(value ?? '').replaceAll('"','""') + '"';
export function exportCSV(edition) {
  validateEdition(edition);
  const fields = ['source_key','source','id','pmid','pmcid','doi','title','authors','publication_date','year','journal','licence','open_access','url','abstract','native_metadata_json','source_occurrences_json'];
  const rows = edition.results.map(row => {const n = row.metadata.europePmc;
    return [row.id,n.source,n.id,n.pmid,n.pmcid,row.doi,row.title,JSON.stringify(row.authors),row.publishedAt,n.pubYear,n.journalInfo?.journal?.title,
      n.license,n.isOpenAccess,row.url,row.content,JSON.stringify(n),JSON.stringify(row.metadata.sourceOccurrences)];});
  return Buffer.from([fields,...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n');
}
export async function fetchSearchDocument(selection, cursorMark, {signal, timeoutMs = 30000, fetchImpl = globalThis.fetch} = {}) {
  const request = requestFor(selection, cursorMark);
  need(typeof fetchImpl === 'function' && Number.isInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 120000, 'EUROPE_PMC_TRANSPORT_INVALID');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort(); if (signal?.aborted) controller.abort(); else signal?.addEventListener('abort', onAbort, {once: true});
  let response, reader;
  try {
    response = await fetchImpl(request.url, {method: 'GET', redirect: 'error', credentials: 'omit',
      headers: {Accept: 'application/json'}, signal: controller.signal});
    need(response && Number.isInteger(response.status) && response.body?.getReader, 'EUROPE_PMC_HTTP_RESPONSE_INVALID');
    need(!response.url || requestFromUrl(response.url, {maxPages: selection.maxPages}).url === request.url, 'EUROPE_PMC_HTTP_SOURCE_CHANGED');
    const parts = []; let length = 0; reader = response.body.getReader();
    for (;;) {const {done,value} = await reader.read(); if (done) break;
      length += value.byteLength; need(length <= MAX_PAGE_BYTES, 'EUROPE_PMC_PAGE_SIZE_EXCEEDED'); parts.push(Buffer.from(value));}
    const headers = {};
    for (const name of ['content-type','date','etag','last-modified','retry-after','content-length','content-encoding']) {
      const value = response.headers.get(name); if (value !== null) headers[name] = value;
    }
    return sourceDocument({url: request.url, bytes: Buffer.concat(parts), kind: 'http-response',
      observation: {status: response.status, headers, retrievedAt: new Date().toISOString()},
      provenance: {transport: 'native-fetch', request: {method: 'GET', url: request.url}, responseBodyRepresentation: 'fetch-decoded body bytes'}});
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
    if (reader) try {await reader.cancel();} catch {}
  }
}
