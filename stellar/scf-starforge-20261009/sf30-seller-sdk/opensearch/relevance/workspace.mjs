// MIT. Retained relevance work in the original OpenSearch workspace and request journal.
import { randomUUID } from 'node:crypto';
import { WorkspaceError, clone, digest, canonical, identifier, now } from '../workspace/store.mjs';
import { validateRelevanceSuite, evaluateOpenSearchRankings, describeRelevanceMetrics } from './native.mjs';

export const RELEVANCE_SET_SCHEMA = 'stellar-forge.opensearch-relevance-set.v1';
const EDITION_SCHEMA = 'stellar-forge.opensearch-relevance-edition.v1';
const MAX_SET_BYTES = 786432;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message, status = 422) => { throw new WorkspaceError(code, message, status); };
function text(value, label, limit, optional = false) {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))
    fail('WORKSPACE_RELEVANCE_TEXT_INVALID', label + ' must contain ' + (optional ? 'at most ' : '1–') + limit + ' readable characters.');
  return value.trim();
}
function name(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(value) || ['__proto__','constructor','prototype'].includes(value))
    fail('WORKSPACE_RELEVANCE_ID_INVALID', label + ' must use 1–80 letters, digits, dots, underscores or hyphens.');
  return value;
}
function object(value, label) {
  if (!plain(value)) fail('WORKSPACE_RELEVANCE_OBJECT_REQUIRED', label + ' must be a JSON object.');
  return clone(value);
}
function unique(items, label, key = item => item.id) {
  const values = items.map(key);
  if (new Set(values).size !== values.length) fail('WORKSPACE_RELEVANCE_DUPLICATE', label + ' contains a repeated identity.');
}
function json(value) { return JSON.stringify(value, null, 2) + '\n'; }
function csvCell(value) {
  let result = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (typeof value === 'string' && (/^[=+\-@\t\r]/.test(result) || /^0\d/.test(result) || /^-?\d{16,}$/.test(result))) result = "'" + result;
  return '"' + result.replaceAll('"', '""') + '"';
}
function rowsCsv(rows) { return rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'; }
function nativeIdentity(value, label, limit) {
  if (typeof value !== 'string' || !value.length || Buffer.byteLength(value) > limit || value.includes('\u0000'))
    fail('WORKSPACE_RELEVANCE_DOCUMENT_ID_INVALID', label + ' must retain its nonempty original native text.');
  return value;
}
function document(value) {
  if (!plain(value)) fail('WORKSPACE_RELEVANCE_JUDGMENT_INVALID', 'Every document judgment must be an object.');
  const _index = nativeIdentity(value._index, 'Document index', 255);
  const _id = nativeIdentity(value._id, 'Document ID', 512);
  const rating = value.rating === undefined || value.rating === null || value.rating === '' ? null : value.rating;
  if (rating !== null && (!Number.isInteger(rating) || rating < 0 || rating > 2147483647))
    fail('WORKSPACE_RELEVANCE_RATING_INVALID', 'A judgment is an integer from zero, or an empty unrated value.');
  return { _index, _id, rating, note: text(value.note, 'Judgment note', 2000, true),
    ...(plain(value.hit) && value.hit._index === _index && value.hit._id === _id ? { hit: clone(value.hit) } : {}) };
}
function caseRow(value) {
  if (!plain(value)) fail('WORKSPACE_RELEVANCE_CASE_INVALID', 'Every evaluation case must be an object.');
  const documents = value.documents ?? value.ratings ?? [];
  if (!Array.isArray(documents) || documents.length > 5000)
    fail('WORKSPACE_RELEVANCE_JUDGMENT_LIMIT', 'A case supports at most 5,000 document judgments.');
  const result = { id: name(value.id, 'Case ID'), title: text(value.title ?? value.id, 'Case title', 120),
    input: object(value.input ?? {}, 'Case input'), documents: documents.map(document),
    ...(value.provenance === undefined ? {} : { provenance: object(value.provenance, 'Case provenance') }) };
  unique(result.documents, 'Case judgments', row => canonical([row._index, row._id]));
  return result;
}
function variantRow(workspace, value) {
  if (!plain(value)) fail('WORKSPACE_RELEVANCE_VARIANT_INVALID', 'Every query variant must be an object.');
  const id = name(value.id, 'Variant ID'), title = text(value.title ?? value.id, 'Variant title', 120);
  let draft;
  if (value.draftId !== undefined) {
    identifier(value.draftId, 'draft ID');
    if (!Number.isInteger(value.draftRevision) || value.draftRevision < 1)
      fail('WORKSPACE_RELEVANCE_DRAFT_REVISION_REQUIRED', 'Select the exact saved query revision.');
    draft = workspace.history(value.draftId).find(row => row.revision === value.draftRevision);
    if (!draft) fail('WORKSPACE_RELEVANCE_DRAFT_REVISION_MISSING', 'The selected saved query revision is unavailable.', 404);
  } else {
    if (!plain(value.query) || !plain(value.plan))
      fail('WORKSPACE_RELEVANCE_VARIANT_SOURCE_REQUIRED', 'Import the complete original query and merchant plan, or choose a saved draft.');
    draft = { queryName: text(value.queryName, 'Original query name', 64), query: value.query,
      plan: value.plan, input: value.input ?? {},
      ...(plain(value.draft) && typeof value.draft.id === 'string' ? {
        id: value.draft.id, revision: value.draft.revision, title: value.draft.title } : {}) };
  }
  return { id, title, queryName: draft.queryName, query: clone(draft.query),
    plan: clone(draft.plan), input: clone(draft.input ?? {}),
    ...(draft.id ? { draft: { id: draft.id, revision: draft.revision, title: draft.title } } : {}) };
}
function normalSet(workspace, value) {
  if (!plain(value)) fail('WORKSPACE_RELEVANCE_SET_REQUIRED', 'Supply an evaluation set.');
  if (value.schema !== undefined && value.schema !== RELEVANCE_SET_SCHEMA)
    fail('WORKSPACE_RELEVANCE_SCHEMA_INVALID', 'Use the original OpenSearch evaluation-set format.');
  if (!Array.isArray(value.variants) || value.variants.length > 8 || !Array.isArray(value.cases) || value.cases.length > 100)
    fail('WORKSPACE_RELEVANCE_SET_LIMIT', 'An evaluation set supports up to eight variants and 100 cases.');
  const result = { schema: RELEVANCE_SET_SCHEMA, title: text(value.title, 'Evaluation title', 120),
    description: text(value.description, 'Evaluation description', 4000, true),
    metric: object(value.metric ?? { precision: { k: 10, relevant_rating_threshold: 1, ignore_unlabeled: false } }, 'Native metric'),
    variants: value.variants.map(row => variantRow(workspace, row)), cases: value.cases.map(caseRow),
    ...(value.importedFrom === undefined ? {} : { importedFrom: object(value.importedFrom, 'Original import') }) };
  unique(result.variants, 'Query variants'); unique(result.cases, 'Evaluation cases');
  if (Buffer.byteLength(json(result)) > MAX_SET_BYTES)
    fail('WORKSPACE_RELEVANCE_SET_TOO_LARGE', 'This evaluation set exceeds 768 KiB. Keep selected judgment details or split the case collection.', 413);
  return result;
}
export function relevanceInput(set) {
  return { metric: clone(set.metric),
    variants: set.variants.map(({ id, title, queryName, query }) => ({ id, label: title, queryName, query: clone(query) })),
    cases: set.cases.map(({ id, input, documents }) => ({ id, input: clone(input),
      ratings: documents.filter(row => row.rating !== null).map(({ _index, _id, rating }) => ({ _index, _id, rating })) })) };
}
function counts(set) {
  return { variants: set.variants.length, cases: set.cases.length,
    judgments: set.cases.reduce((count, item) => count + item.documents.filter(row => row.rating !== null).length, 0),
    unrated: set.cases.reduce((count, item) => count + item.documents.filter(row => row.rating === null).length, 0) };
}
function setSummary(set) {
  return { id: set.id, title: set.title, revision: set.revision, updatedAt: set.updatedAt,
    metric: set.metric, ...counts(set) };
}
function detailCounts(response) {
  const details = Object.values(response?.details ?? {}), failures = Object.keys(response?.failures ?? {});
  return { succeeded: details.length, failed: failures.length,
    rated: details.reduce((count, row) => count + (row.hits ?? []).filter(hit => hit.rating !== null && hit.rating !== undefined).length, 0),
    unrated: details.reduce((count, row) => count + (row.unrated_docs ?? []).length, 0) };
}
function variantResults(result) {
  const rows = Array.isArray(result?.variants) ? result.variants : [];
  return rows.map(row => ({ id: row.id, title: row.label ?? row.title ?? row.id,
    queryName: row.queryName, response: row.native ?? {}, exactIntegerPaths: clone(row.exactIntegerPaths ?? []),
    cases: clone(row.cases ?? []), complete: row.complete === true, metricScore: row.metricScore ?? null,
    source: result.source ?? null }));
}
function resultSummary(result) {
  return variantResults(result).map(row => {
    const native = detailCounts(row.response);
    const confirmedCases = row.cases.filter(item => item.status === 'COMPLETE').length;
    return { id: row.id, title: row.title, queryName: row.queryName, metricScore: row.metricScore,
      complete: row.complete, source: row.source, ...native, nativeSucceeded: native.succeeded,
      nativeFailed: native.failed, confirmedCases, incompleteCases: row.cases.length - confirmedCases,
      totalCases: row.cases.length };
  });
}
export function relevanceReport(edition, { includeCases = false } = {}) {
  const set = edition.set;
  return { schema: 'stellar-forge.opensearch-relevance-report.v1', title: set.title,
    createdAt: edition.createdAt, evaluationId: edition.id, evaluationSet: { id: set.id, revision: set.revision },
    sourceProfileSha256: edition.sourceProfileSha256, resultSha256: edition.resultSha256,
    capturedAt: edition.result.capturedAt, source: clone(edition.result.source ?? null), complete: edition.result.complete === true,
    metric: clone(set.metric), counts: counts(set), variants: resultSummary(edition.result),
    cases: set.cases.map(item => ({ id: item.id, title: item.title,
      judgedDocuments: item.documents.filter(row => row.rating !== null).length,
      unjudgedDocuments: item.documents.filter(row => row.rating === null).length,
      ...(includeCases ? { input: clone(item.input), judgments: item.documents.map(({ hit, ...row }) => clone(row)) } : {}) })),
    native: variantResults(edition.result).map(({ id, response, source, cases, complete }) => ({ id, source, cases, complete,
      metric_score: response.metric_score ?? null,
      details: Object.fromEntries(Object.entries(response.details ?? {}).map(([id, item]) => [id, {
        metric_score: item.metric_score ?? null, metric_details: clone(item.metric_details ?? {}),
        unrated_docs: clone(item.unrated_docs ?? []),
        hits: (item.hits ?? []).map(({ hit, rating }) => ({
          hit: { _index: hit?._index, _id: hit?._id, _score: hit?._score ?? null }, rating: rating ?? null })) }])),
      failures: clone(response.failures ?? {}) })),
    interpretation: 'Native scores describe the saved metric, labeled document set and successful cases. Unrated results and failed cases remain visible beside every score.' };
}
export function relevanceCsv(edition) {
  const rows = [['variant_id','case_id','status','native_metric_score','returned_hits',
    'judged_returned','unrated_returned','supplied_judgments','metric_details_json','case_summary_json','failure_json']];
  for (const variant of variantResults(edition.result)) {
    const summaries = new Map(variant.cases.map(item => [item.id,item]));
    const identities = new Set([...edition.set.cases.map(item => item.id),...summaries.keys(),
      ...Object.keys(variant.response.details ?? {}),...Object.keys(variant.response.failures ?? {})]);
    for (const caseId of identities) {
      const summary = summaries.get(caseId), detail = variant.response.details?.[caseId];
      const failure = variant.response.failures?.[caseId] ?? summary?.error ?? null;
      rows.push([variant.id,caseId,summary?.status ?? (failure ? 'FAILED' : 'INCOMPLETE'),
        detail?.metric_score ?? null,summary?.hitCount ?? detail?.hits?.length ?? null,
        summary?.judgedHitCount ?? (detail ? (detail.hits ?? []).filter(item => item.rating !== null && item.rating !== undefined).length : null),
        summary?.unjudgedHitCount ?? detail?.unrated_docs?.length ?? null,
        summary?.judgmentCount ?? null,detail?.metric_details ?? null,summary ?? null,failure]);
    }
  }
  return rowsCsv(rows);
}
function html(value) {
  return String(value ?? '').replace(/[&<>"']/g, character =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
}
function htmlTable(headings, rows) {
  return '<div class="table-wrap"><table><thead><tr>' + headings.map(value => '<th scope="col">' + html(value) + '</th>').join('') +
    '</tr></thead><tbody>' + rows.map(row => '<tr>' + row.map(value => '<td>' + html(value) + '</td>').join('') + '</tr>').join('') +
    '</tbody></table></div>';
}
function htmlJson(value) { return '<pre>' + html(json(value)) + '</pre>'; }
export function relevanceHtml(edition) {
  const report = relevanceReport(edition), variants = variantResults(edition.result);
  const scores = htmlTable(['Query variant','Native score','Confirmed cases','Native failures','Judged returned','Unrated returned'],
    report.variants.map(row => [row.title,row.metricScore ?? 'Unavailable',
      row.confirmedCases + ' / ' + row.totalCases,row.nativeFailed,row.rated,row.unrated]));
  const details = variants.map(variant => {
    const definition = edition.set.variants.find(item => item.id === variant.id);
    const cases = edition.set.cases.map(item => {
      const summary = variant.cases.find(value => value.id === item.id);
      const native = variant.response.details?.[item.id];
      const failure = variant.response.failures?.[item.id] ?? summary?.error;
      const results = (native?.hits ?? []).map(({hit,rating},index) => [
        index + 1,hit?._index,hit?._id,rating === null || rating === undefined ? 'Unrated' : rating]);
      return '<article><h4>' + html(item.title) + ' <small>' + html(item.id) + '</small></h4><p>' +
        html(summary?.status ?? 'INCOMPLETE') + ' · Native score ' + html(native?.metric_score ?? 'Unavailable') + '</p>' +
        (failure ? '<h5>Case failure</h5>' + htmlJson(failure) : '') +
        htmlTable(['Rank','Index','Document ID','Judgment'],results) +
        '<details><summary>Native metric details and capture correspondence</summary>' +
        htmlJson({metricDetails:native?.metric_details ?? null,case:summary ?? null,
          unratedDocuments:native?.unrated_docs ?? []}) + '</details></article>';
    }).join('');
    return '<section><h3>' + html(variant.title) + '</h3><p>' + html(variant.queryName) +
      ' · ' + (variant.complete ? 'All cases complete' : 'Review case coverage') +
      '</p><details><summary>Frozen query definition</summary>' +
      htmlJson({id:definition?.id,queryName:definition?.queryName,query:definition?.query,draft:definition?.draft}) +
      '</details>' + cases + '</section>';
  }).join('');
  const judgments = edition.set.cases.map(item => '<article><h3>' + html(item.title) + '</h3>' +
    '<p>Case ' + html(item.id) + ' · ' + item.documents.filter(value => value.rating !== null).length + ' supplied judgments</p>' +
    '<details><summary>Input, document judgments and original capture</summary>' +
    htmlJson({input:item.input,provenance:item.provenance ?? null}) +
    htmlTable(['Index','Document ID','Rating','Judgment note'],item.documents.map(doc =>
      [doc._index,doc._id,doc.rating === null ? 'Unrated' : doc.rating,doc.note])) + '</details></article>').join('');
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">' +
    '<title>' + html(report.title) + ' · Search relevance</title><style>' +
    'html{color-scheme:light}body{font:15px/1.5 system-ui,sans-serif;color:#202124;background:#fff;margin:0;padding:32px;max-width:1120px;margin-inline:auto}' +
    'h1,h2,h3,h4,h5{line-height:1.2}h1{font-size:30px}h2{font-size:22px;border-top:1px solid #bbb;padding-top:24px;margin-top:32px}' +
    'h3{font-size:19px}h4{font-size:16px}small,.muted{color:#62666b;font-weight:400}section,article{margin-block:24px}' +
    'table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;vertical-align:top;border:1px solid #ccc;padding:8px;overflow-wrap:anywhere}' +
    'th{background:#f1f2f3}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f5f5;border:1px solid #ddd;padding:12px;font-size:12px}' +
    'summary{cursor:pointer;padding:8px 0;font-weight:600}.table-wrap{overflow:auto}header{border-bottom:2px solid #333;padding-bottom:20px}' +
    '@media print{body{padding:0;font-size:11px}details{display:block}details>*{display:block}summary{display:none}article,table{break-inside:avoid}}' +
    '</style></head><body><header><p class="muted">STELLAR FORGE · SEARCH RELEVANCE</p><h1>' + html(report.title) +
    '</h1><p>' + html(edition.set.description) + '</p><p>Captured ' + html(report.capturedAt) +
    ' · OpenSearch ' + html(report.source?.serverVersion) + ' · ' +
    (report.complete ? 'Every retained case completed' : 'Case coverage requires review') + '</p></header>' +
    '<h2>Evaluation results</h2><p>' + html(report.interpretation) + '</p>' + scores +
    '<h2>Metric and evaluation scope</h2>' + htmlJson({metric:report.metric,counts:report.counts,evaluationId:report.evaluationId,
      evaluationSet:report.evaluationSet,source:report.source,sourceProfileSha256:report.sourceProfileSha256,resultSha256:report.resultSha256}) +
    '<h2>Query variant review</h2>' + details + '<h2>Input cases and supplied judgments</h2>' + judgments +
    '<footer><p class="muted">Generated from the immutable retained evaluation. The original native result and full evaluation JSON are available from the same workspace edition.</p></footer></body></html>\n';
}
export class OpenSearchRelevanceWorkspace {
  constructor(workspace, { validateEvaluation = validateRelevanceSuite, evaluate = evaluateOpenSearchRankings } = {}) {
    this.workspace = workspace; this.store = workspace.store; this.validateEvaluation = validateEvaluation; this.evaluate = evaluate;
    this.store.db.exec(
      'CREATE TABLE IF NOT EXISTS relevance_sets (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, updated_at TEXT NOT NULL, record_json TEXT NOT NULL, summary_json TEXT NOT NULL);' +
      'CREATE TABLE IF NOT EXISTS relevance_history (set_id TEXT NOT NULL, revision INTEGER NOT NULL, record_json TEXT NOT NULL, PRIMARY KEY(set_id,revision));' +
      'CREATE TABLE IF NOT EXISTS relevance_editions (id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, set_id TEXT NOT NULL, set_revision INTEGER NOT NULL, created_at TEXT NOT NULL, result_sha256 TEXT NOT NULL, result_json TEXT NOT NULL, record_json TEXT NOT NULL);'
    );
  }
  ensureOpen() { if (this.workspace.closed) fail('WORKSPACE_CLOSING', 'Workspace is closing.', 503); }
  set(id, revision) {
    identifier(id, 'evaluation set ID');
    if (revision !== undefined && (!Number.isInteger(revision) || revision < 1))
      fail('WORKSPACE_RELEVANCE_REVISION_INVALID', 'Choose an existing positive revision number.');
    const row = revision === undefined
      ? this.store.db.prepare('SELECT record_json FROM relevance_sets WHERE id=?').get(id)
      : this.store.db.prepare('SELECT record_json FROM relevance_history WHERE set_id=? AND revision=?').get(id, revision);
    if (!row) fail('WORKSPACE_RELEVANCE_SET_NOT_FOUND', 'Evaluation set not found.', 404);
    return JSON.parse(row.record_json);
  }
  history(id) {
    this.set(id);
    return this.store.db.prepare('SELECT record_json FROM relevance_history WHERE set_id=? ORDER BY revision DESC').all(id)
      .map(row => JSON.parse(row.record_json));
  }
  state() {
    const sets = this.store.db.prepare('SELECT summary_json FROM relevance_sets ORDER BY updated_at DESC').all().map(row => JSON.parse(row.summary_json));
    const editions = this.store.db.prepare('SELECT record_json FROM relevance_editions ORDER BY created_at DESC').all().map(row => JSON.parse(row.record_json));
    return { sets, editions, metrics: describeRelevanceMetrics() };
  }
  normalize(value) { this.ensureOpen(); return normalSet(this.workspace, value); }
  save(request) {
    this.ensureOpen();
    return this.store.transaction(() => {
      const reserved = this.store.reserve('relevance-save', request);
      if (reserved.existing) return reserved.operation;
      const prior = request.setId ? this.set(request.setId) : null;
      if (prior && (!Number.isInteger(request.expectedRevision) || prior.revision !== request.expectedRevision))
        fail('WORKSPACE_RELEVANCE_REVISION_CHANGED', 'This evaluation set changed. Reopen its saved revision before saving.', 409);
      const value = normalSet(this.workspace, request.set), at = now();
      const set = { ...value, id: prior?.id ?? randomUUID(), revision: (prior?.revision ?? 0) + 1,
        sourceProfileSha256: this.store.profileHash, createdAt: prior?.createdAt ?? at, updatedAt: at };
      this.store.db.prepare('INSERT INTO relevance_sets VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,updated_at=excluded.updated_at,record_json=excluded.record_json,summary_json=excluded.summary_json')
        .run(set.id,set.revision,at,JSON.stringify(set),JSON.stringify(setSummary(set)));
      this.store.db.prepare('INSERT INTO relevance_history VALUES(?,?,?)').run(set.id,set.revision,JSON.stringify(set));
      return this.store.writeOperation({ ...reserved.operation,state:'COMPLETE',updatedAt:at,
        result:{ relevanceSetId:set.id,revision:set.revision,relevanceSet:set } });
    });
  }
  seed(editionId, { caseId = 'case-1', title, limit = 100 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
      fail('WORKSPACE_RELEVANCE_SEED_LIMIT_INVALID', 'Select 1–1,000 captured documents to judge.');
    const edition = this.workspace.edition(editionId);
    return { id: name(caseId, 'Case ID'), title: title ?? edition.title, input: clone(edition.input),
      documents: edition.result.hits.slice(0,limit).map(hit => ({ _index: hit._index, _id: hit._id, rating: null, note:'' })),
      provenance: { editionId: edition.id, resultSha256: edition.resultSha256, source: clone(edition.result.source ?? null),
        queryName: edition.queryName, query: clone(edition.query), capturedAt: edition.capturedAt,
        total: clone(edition.total), truncated: edition.truncated,
        selectedDocuments: Math.min(edition.result.hits.length,limit), capturedDocuments: edition.result.hits.length, selectionLimit: limit } };
  }
  validate(id, revision) {
    this.ensureOpen();
    const current = this.set(id);
    if (!Number.isInteger(revision) || current.revision !== revision)
      fail('WORKSPACE_RELEVANCE_REVISION_CHANGED', 'Open the current evaluation set revision before validation.', 409);
    if (!current.variants.length || !current.cases.length)
      fail('WORKSPACE_RELEVANCE_CASES_AND_VARIANTS_REQUIRED', 'Add a query variant and an input case before evaluation.');
    if (typeof this.validateEvaluation !== 'function') fail('WORKSPACE_RELEVANCE_ENGINE_UNAVAILABLE', 'The native relevance adapter is unavailable.', 503);
    const spec = relevanceInput(current);
    this.validateEvaluation({ config: this.workspace.config, ...spec });
    return { setId:id,revision:current.revision,spec,counts:counts(current) };
  }
  async run(request) {
    this.ensureOpen();
    const prior = (() => { try { return this.store.operation(request.requestId); }
      catch (error) { if (error.code !== 'WORKSPACE_OPERATION_NOT_FOUND') throw error; return null; } })();
    if (!prior && this.workspace.nativeBusy) fail('WORKSPACE_NATIVE_BUSY', 'Another native source operation is running. Its original request is retained.', 409);
    const reserved = this.store.transaction(() => {
      const row = this.store.reserve('relevance-run', request);
      if (row.existing) return row;
      const validated = this.validate(request.setId,request.expectedRevision);
      row.operation.relevanceSet = this.set(request.setId,validated.revision);
      row.operation.evaluation = validated.spec;
      this.store.writeOperation(row.operation);
      return row;
    });
    if (reserved.existing) return this.store.operation(request.requestId);
    this.workspace.nativeBusy = true;
    const task = (async () => {
      try {
        const result = await this.evaluate({ config:this.workspace.config, ...clone(reserved.operation.evaluation) }, { env:this.workspace.env });
        return this.retain(request.requestId,result);
      } catch (error) {
        return this.store.finish(request.requestId,null,this.workspace.failure(error));
      }
    })().finally(() => { this.workspace.nativeBusy = false; this.workspace.active.delete(request.requestId); });
    this.workspace.active.set(request.requestId,task);
    return task;
  }
  retain(requestId,result) {
    return this.store.transaction(() => {
      const operation = this.store.operation(requestId);
      if (operation.state !== 'RUNNING') return operation;
      if (!plain(result) || result.schema !== 'stellar-forge.opensearch-relevance-result.v1' || !Array.isArray(result.variants))
        fail('WORKSPACE_RELEVANCE_RESULT_INVALID', 'Native relevance evaluation returned no complete result envelope.');
      const resultText = json(result), at = now(), set = operation.relevanceSet;
      const id = digest('relevance:'+requestId).slice(0,32);
      const record = { schema:EDITION_SCHEMA,id,requestId,setId:set.id,setRevision:set.revision,title:set.title,
        createdAt:at,capturedAt:result.capturedAt,source:clone(result.source ?? null),complete:result.complete === true,
        metric:clone(set.metric),counts:counts(set),sourceProfileSha256:this.store.profileHash,
        resultSha256:digest(resultText),resultBytes:Buffer.byteLength(resultText),variants:resultSummary(result) };
      this.store.db.prepare('INSERT INTO relevance_editions VALUES(?,?,?,?,?,?,?,?)')
        .run(id,requestId,set.id,set.revision,at,record.resultSha256,resultText,JSON.stringify(record));
      return this.store.writeOperation({...operation,state:'COMPLETE',updatedAt:at,
        result:{relevanceEditionId:id,relevanceEdition:record}});
    });
  }
  edition(id) {
    identifier(id,'relevance result ID');
    const row = this.store.db.prepare('SELECT * FROM relevance_editions WHERE id=?').get(id);
    if (!row) fail('WORKSPACE_RELEVANCE_EDITION_NOT_FOUND','Evaluation result not found.',404);
    if (digest(row.result_json)!==row.result_sha256) fail('WORKSPACE_RELEVANCE_EDITION_CHANGED','The retained evaluation checksum no longer matches.',500);
    const record = JSON.parse(row.record_json);
    return {...record,set:this.set(record.setId,record.setRevision),result:JSON.parse(row.result_json)};
  }
  export(id,format) {
    if(format==='set.json') return {type:'application/json; charset=utf-8',filename:'opensearch-relevance-set-'+id+'.json',body:json(this.set(id))};
    const edition=this.edition(id);
    if(format==='edition.json') return {type:'application/json; charset=utf-8',filename:'opensearch-relevance-'+id+'.json',body:json(edition)};
    if(format==='native.json') return {type:'application/json; charset=utf-8',filename:'opensearch-native-relevance-'+id+'.json',
      body:this.store.db.prepare('SELECT result_json FROM relevance_editions WHERE id=?').get(id).result_json};
    if(format==='report.html') return {type:'text/html; charset=utf-8',filename:'opensearch-relevance-report-'+id+'.html',body:relevanceHtml(edition)};
    if(format==='report.json') return {type:'application/json; charset=utf-8',filename:'opensearch-relevance-report-'+id+'.json',body:json(relevanceReport(edition))};
    if(format==='cases.csv') return {type:'text/csv; charset=utf-8',filename:'opensearch-relevance-cases-'+id+'.csv',body:relevanceCsv(edition)};
    fail('WORKSPACE_EXPORT_FORMAT_INVALID','Choose an evaluation JSON, native JSON, customer HTML, report JSON or cases CSV export.');
  }
  compare(beforeId,afterId) {
    const before=this.edition(beforeId),after=this.edition(afterId);
    const caseScope=set=>set.cases.map(item=>({id:item.id,input:item.input,
      ratings:item.documents.filter(row=>row.rating!==null).map(({_index,_id,rating})=>({_index,_id,rating}))
        .sort((a,b)=>canonical([a._index,a._id]).localeCompare(canonical([b._index,b._id])))}))
      .sort((a,b)=>a.id.localeCompare(b.id));
    const scope={
      sameMetric:canonical(before.set.metric)===canonical(after.set.metric),
      sameCasesInputsAndJudgments:canonical(caseScope(before.set))===canonical(caseScope(after.set)),
      sameSourceProfile:before.sourceProfileSha256===after.sourceProfileSha256,
      sameNativeCluster:Boolean(before.result.source?.clusterFingerprint) &&
        before.result.source.clusterFingerprint===after.result.source?.clusterFingerprint,
      bothComplete:before.result.complete===true && after.result.complete===true
    };
    const comparable=Object.values(scope).every(Boolean);
    const left=new Map(variantResults(before.result).map(row=>[row.id,row]));
    const right=new Map(variantResults(after.result).map(row=>[row.id,row]));
    const variants=[];
    for(const id of new Set([...left.keys(),...right.keys()])) {
      const a=left.get(id),b=right.get(id);
      const beforeSource=before.set.variants.find(row=>row.id===id);
      const afterSource=after.set.variants.find(row=>row.id===id);
      const cases=[];
      for(const caseId of new Set([...Object.keys(a?.response.details??{}),...Object.keys(a?.response.failures??{}),
        ...Object.keys(b?.response.details??{}),...Object.keys(b?.response.failures??{})])) {
        const scoreA=a?.response.details?.[caseId]?.metric_score??null,scoreB=b?.response.details?.[caseId]?.metric_score??null;
        cases.push({id:caseId,before:scoreA,after:scoreB,
          delta:comparable&&typeof scoreA==='number'&&typeof scoreB==='number'?scoreB-scoreA:null,
          beforeFailure:clone(a?.response.failures?.[caseId]??null),afterFailure:clone(b?.response.failures?.[caseId]??null)});
      }
      variants.push({id,before:a?{label:a.title,score:a.metricScore,...detailCounts(a.response)}:null,
        after:b?{label:b.title,score:b.metricScore,...detailCounts(b.response)}:null,
        queryChanged:canonical(beforeSource?.query??null)!==canonical(afterSource?.query??null),
        delta:comparable&&typeof a?.metricScore==='number'&&typeof b?.metricScore==='number'?b.metricScore-a.metricScore:null,cases});
    }
    const summary=edition=>({id:edition.id,title:edition.title,setId:edition.setId,setRevision:edition.setRevision,
      capturedAt:edition.result.capturedAt,source:clone(edition.result.source??null),metric:clone(edition.set.metric),
      resultSha256:edition.resultSha256,complete:edition.result.complete});
    return {schema:'stellar-forge.opensearch-relevance-comparison.v1',comparedAt:now(),scope:{...scope,comparable},
      before:summary(before),after:summary(after),variants,
      interpretation:'Score differences use matching metric, case inputs, judgments and native cluster with complete cases. Each retained run keeps its own capture time and original result.'};
  }
  promote(request) {
    this.ensureOpen();
    const edition=this.edition(request.editionId);
    const variant=edition.set.variants.find(item=>item.id===request.variantId);
    const item=edition.set.cases.find(item=>item.id===request.caseId);
    if(!variant||!item) fail('WORKSPACE_RELEVANCE_SELECTION_REQUIRED','Choose an evaluated query variant and its input case.');
    const title=request.title??(variant.title+' · '+edition.set.title).slice(0,120);
    return this.workspace.save({requestId:request.requestId,title,queryName:variant.queryName,
      query:clone(variant.query),input:clone(item.input),plan:clone(variant.plan),
      relevance:{editionId:edition.id,resultSha256:edition.resultSha256,variantId:variant.id,caseId:item.id}});
  }
}
