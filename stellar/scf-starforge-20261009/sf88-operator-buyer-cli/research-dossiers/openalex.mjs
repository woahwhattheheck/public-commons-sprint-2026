// MIT — Receive one original saved OpenAlex cohort into the existing research dossier.
import { need, object, parseJson, jsonBytes, digest } from '../node/store.mjs';
import { normalizeResponse, SCHEMA } from './normalize.mjs';

export const OPENALEX_SAVED_EDITION_CONTRACT = Object.freeze({
  schema: 'stellar-forge.research-export.v1',
  repository: 'woahwhattheheck/public-commons-sprint-2026',
  commit: 'f69556b7b5857437697f2c5617c69e79d8df12ff',
  path: 'stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research/workspace.mjs',
  blob: '6415fa90ca9d0c67a17be0b6b122b8989cd3ca5a',
});
const MAX_RESPONSE = 64 * 1024 * 1024;
const META_PROVIDER = 'openalex-cohort';
const META_MODE = 'ORIGINAL_OPENALEX_COHORT';
const PAGE_MODE = 'ORIGINAL_OPENALEX_EDITION_PAGE';
const HASH = /^[a-f0-9]{64}$/;
const WORK = /^https:\/\/openalex[.]org\/W[1-9][0-9]*$/;
const canonical = value => JSON.stringify(value, (_key, item) => object(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const equal = (a, b) => canonical(a) === canonical(b);
const count = value => Number.isSafeInteger(value) && value >= 0;
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const named = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value);
const originalBytes = value => {
  need(value instanceof Uint8Array, 'OPENALEX_EXPORT_BYTES_REQUIRED');
  return Buffer.isBuffer(value) ? value : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
};
const dossierEditionId = (questionId, provider, bytes, identity) =>
  'e_' + digest(Buffer.from(questionId + '\n' + provider + '\n' + digest(bytes) + '\n' + identity));

function sourceLink(source) {
  need(object(source) && typeof source.url === 'string' && validTime(source.retrievedAt),
    'OPENALEX_PAGE_SOURCE_INVALID');
  const url = new URL(source.url);
  need(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
    !url.searchParams.has('api_key'), 'OPENALEX_SOURCE_URL_INVALID');
  // The full original URL remains in the retained page metadata.
  const link = source.url.length <= 4000 ? source.url : url.origin + url.pathname;
  need(link.length <= 4000, 'OPENALEX_SOURCE_REFERENCE_TOO_LONG');
  return link;
}

/** Validate the complete export before its first dossier write. No source is fetched. */
function inspectExport(exported, editionId) {
  need(object(exported) && object(exported.files) && object(exported.manifest),
    'OPENALEX_SAVED_EXPORT_REQUIRED');
  const files = new Map(Object.entries(exported.files).map(([name, bytes]) => [name, originalBytes(bytes)]));
  const manifestBytes = files.get('manifest.json');
  need(manifestBytes && manifestBytes.length <= MAX_RESPONSE, 'OPENALEX_EXPORT_MANIFEST_REQUIRED');
  const manifest = parseJson(manifestBytes);
  need(object(manifest) && manifest.schema === OPENALEX_SAVED_EDITION_CONTRACT.schema &&
    manifest.editionId === editionId && object(manifest.files) && equal(manifest, exported.manifest),
  'OPENALEX_EXPORT_MANIFEST_INVALID');
  for (const [name, entry] of Object.entries(manifest.files)) {
    const bytes = files.get(name);
    need(object(entry) && count(entry.bytes) && HASH.test(entry.sha256) &&
      bytes && bytes.length === entry.bytes && digest(bytes) === entry.sha256,
    'OPENALEX_EXPORT_FILE_CHANGED');
  }
  const original = new Map();
  const take = name => {
    const bytes = files.get(name);
    need(bytes && Object.hasOwn(manifest.files, name), 'OPENALEX_ORIGINAL_FILE_REQUIRED');
    original.set(name, bytes); return bytes;
  };
  const read = name => parseJson(take(name));
  const record = read('edition.json'), query = read('query.json');
  const coverage = read('coverage.json'), decisions = read('decisions.json'), index = read('page-index.json');
  need(object(record) && record.schema === 'stellar-forge.research-edition.v1' &&
    record.id === editionId && named(record.id) && named(record.queryId) &&
    typeof record.label === 'string' && record.label.trim() && record.label.length <= 200 &&
    validTime(record.createdAt), 'OPENALEX_EDITION_RECORD_INVALID');
  need(object(query) && query.schema === 'stellar-forge.research-query.v1' &&
    query.id === record.queryId && query.entity === 'works' && object(query.parameters) &&
    typeof query.label === 'string' && Number.isSafeInteger(query.revision) && query.revision > 0 &&
    query.revision === record.queryRevision && query.sha256 === record.querySha256 &&
    query.sha256 === digest(canonical({label:query.label,entity:query.entity,parameters:query.parameters})) &&
    query.sha256 === manifest.querySha256, 'OPENALEX_SAVED_WORKS_QUERY_REQUIRED');
  need(object(coverage) && ['EMPTY','PARTIAL','COMPLETE','INTERRUPTED'].includes(coverage.state) &&
    count(coverage.pages) && count(coverage.recordsReceived) &&
    (coverage.totalReported === null || count(coverage.totalReported)) &&
    Array.isArray(coverage.reportedCounts) && coverage.reportedCounts.every(count) &&
    Array.isArray(coverage.warnings) && typeof coverage.reason === 'string' &&
    coverage.reason.length > 0, 'OPENALEX_COVERAGE_INVALID');
  need(object(decisions) && count(decisions.revision) && decisions.revision === manifest.decisionsRevision &&
    object(decisions.items), 'OPENALEX_DECISIONS_INVALID');
  for (const [id, decision] of Object.entries(decisions.items)) {
    need(WORK.test(id) && object(decision) && ['include','exclude','undecided'].includes(decision.status) &&
      typeof decision.notes === 'string' && Array.isArray(decision.tags) &&
      decision.tags.every(tag => typeof tag === 'string') &&
      (decision.updatedAt === undefined || validTime(decision.updatedAt)), 'OPENALEX_DECISION_INVALID');
  }
  need(object(index) && Array.isArray(index.pages) && index.pages.length === coverage.pages,
    'OPENALEX_PAGE_INDEX_INVALID');

  let nextCursor = '*', interrupted = false;
  const seen = new Set(), pages = [];
  for (const [position, indexed] of index.pages.entries()) {
    const number = position + 1, prefix = 'pages/' + String(number).padStart(8, '0');
    const page = read(prefix + '/page.json'), request = read(prefix + '/request.json');
    need(object(page) && equal(page, indexed) && page.schema === 'stellar-forge.research-page.v1' &&
      page.editionId === editionId && page.index === number && page.querySha256 === query.sha256 &&
      count(page.records) && count(page.totalReported) && count(page.bytes) && page.bytes > 0 &&
      HASH.test(page.sha256) && (page.nextCursor === null ||
        typeof page.nextCursor === 'string' && page.nextCursor.length > 0), 'OPENALEX_PAGE_RECORD_INVALID');
    need(equal(request, page.request) &&
      equal(request, {entity:query.entity,parameters:{...query.parameters,cursor:nextCursor}}) &&
      page.requestSha256 === digest(canonical(request)), 'OPENALEX_PAGE_REQUEST_CHANGED');
    const bytes = take(prefix + '/response.json');
    need(bytes.length <= MAX_RESPONSE && page.bytes === bytes.length && page.sha256 === digest(bytes),
      'OPENALEX_PAGE_RESPONSE_CHANGED');
    const normalized = normalizeResponse(bytes, 'openalex'), response = normalized.raw;
    need(response.results.length === page.records && response.meta.count === page.totalReported &&
      response.meta.next_cursor === page.nextCursor &&
      response.results.every(row => object(row) && WORK.test(row.id)), 'OPENALEX_PAGE_RESPONSE_INVALID');
    const sourceReference = sourceLink(page.source);
    let native = null, nativePath = null;
    if (page.nativeSha256 !== null && page.nativeSha256 !== undefined) {
      nativePath = prefix + '/buyer-result.json';
      const nativeBytes = take(nativePath), nativeRecord = parseJson(nativeBytes);
      native = object(nativeRecord?.native) ? nativeRecord.native : nativeRecord;
      need(digest(nativeBytes) === page.nativeSha256 && object(native) &&
        native.mode === 'ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT' &&
        typeof native.intentId === 'string' && native.intentId.length > 0 &&
        native.intentId === page.nativeIntentId &&
        native.responseFile?.status === 'SAVED' &&
        native.responseFile.bytes === bytes.length && native.responseFile.sha256 === page.sha256,
      'OPENALEX_NATIVE_RESULT_CHANGED');
    } else need(page.nativeIntentId === null || page.nativeIntentId === undefined,
      'OPENALEX_NATIVE_RECORD_REQUIRED');
    const identity = native?.intentId ?? 'openalex-page-' + digest(canonical({
      edition:record,querySha256:query.sha256,index:number,requestSha256:page.requestSha256,
    }));
    pages.push({page,bytes,prefix,sourceReference,identity,nativePath,
      nativeIntentId:native?.intentId ?? null});
    seen.add(nextCursor); nextCursor = page.nextCursor;
    if (nextCursor !== null && seen.has(nextCursor)) interrupted = true;
    need((!interrupted && nextCursor !== null) || number === index.pages.length,
      'OPENALEX_PAGE_CHAIN_INVALID');
  }
  const state = !pages.length ? 'EMPTY' : interrupted ? 'INTERRUPTED' : nextCursor === null ? 'COMPLETE' : 'PARTIAL';
  // The provider can end a cursor chain with records in its terminal page. Preserve
  // old saved workspace classifications as written while accepting corrected COMPLETE
  // editions. The original reason text is retained, not rewritten by this consumer.
  const legacyTerminal = pages.length > 0 && nextCursor === null &&
    pages.at(-1).page.records > 0 && coverage.state === 'INTERRUPTED' &&
    coverage.reason === 'TERMINAL_CURSOR_WITH_RECORDS';
  const reportedCounts = [...new Set(pages.map(item => item.page.totalReported))];
  need((coverage.state === state || legacyTerminal) && coverage.nextCursor === nextCursor &&
    coverage.recordsReceived === pages.reduce((sum, item) => sum + item.page.records, 0) &&
    coverage.totalReported === (pages.at(-1)?.page.totalReported ?? null) &&
    equal(coverage.reportedCounts, reportedCounts) &&
    coverage.firstRetrievedAt === (pages[0]?.page.source.retrievedAt ?? null) &&
    coverage.lastRetrievedAt === (pages.at(-1)?.page.source.retrievedAt ?? null), 'OPENALEX_COVERAGE_CHANGED');

  // Only original saved inputs affect retry identity. Generated reports and export timestamps do not.
  const signatureFiles = [...original.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([path, bytes]) => ({path,bytes:bytes.length,sha256:digest(bytes)}));
  const signature = {algorithm:'sha256',scope:'original_saved_edition_files',
    sha256:digest(canonical(signatureFiles)),files:signatureFiles};
  return {record,query,coverage,decisions,pages,original,signature,manifest,manifestBytes};
}

/**
 * Receive the original workspace's current saved cohort through exportFiles exactly once.
 * The original workspace owns its lifetime, collection, native buyer and review decisions.
 * Each page is retained unchanged; one metadata edition holds the complete source snapshot.
 * A retry preserves the first snapshot for the same source signature and resumes missing pages.
 */
export async function receiveOpenAlexEdition(dossierStore, dossierId, {
  workspace, editionId, questionId, label, expectedRevision, signal, onPage,
} = {}) {
  need(dossierStore && typeof dossierStore.get === 'function' && typeof dossierStore.receive === 'function',
    'DOSSIER_STORE_REQUIRED');
  need(workspace && typeof workspace.exportFiles === 'function', 'OPENALEX_WORKSPACE_REQUIRED');
  need(named(editionId) && typeof questionId === 'string', 'OPENALEX_IMPORT_TARGET_REQUIRED');
  need(onPage === undefined || typeof onPage === 'function', 'OPENALEX_IMPORT_CALLBACK_INVALID');
  signal?.throwIfAborted();
  let dossier = await dossierStore.get(dossierId);
  need(Number.isSafeInteger(expectedRevision) && dossier.revision === expectedRevision, 'REVISION_CONFLICT');
  need(dossier.questions.some(question => question.id === questionId), 'QUESTION_NOT_FOUND');
  const exported = await workspace.exportFiles(editionId, {includePages:true,includeNative:true});
  signal?.throwIfAborted();
  const source = inspectExport(exported, editionId);
  label ??= source.record.label;
  need(typeof label === 'string' && label.trim() && label.length <= 200, 'OPENALEX_IMPORT_LABEL_INVALID');
  const metadataIdentity = 'openalex-cohort-' + source.signature.sha256;
  const prior = dossier.editions.filter(item => item.questionId === questionId &&
    item.provider === META_PROVIDER && item.mode === 'retained' &&
    item.origin?.mode === META_MODE && item.origin.intentId === metadataIdentity &&
    item.origin.sourceFingerprint === source.signature.sha256);
  need(prior.length <= 1, 'OPENALEX_COHORT_IDENTITY_CONFLICT');
  const bindings = source.pages.map(item => ({
    pageIndex:item.page.index,sourceFile:item.prefix + '/response.json',
    dossierEditionId:dossierEditionId(questionId, 'openalex', item.bytes, item.identity),
    sha256:item.page.sha256,bytes:item.page.bytes,intentId:item.identity,
    intentKind:item.nativeIntentId ? 'ORIGINAL_NATIVE_INTENT' : 'SAVED_EDITION_PAGE_IDENTITY',
    nativeIntentId:item.nativeIntentId,
  }));
  const originalFiles = Object.fromEntries([...source.original.entries()]
    .filter(([name]) => !name.endsWith('/response.json'))
    .map(([name, bytes]) => [name, {encoding:'base64',bytes:bytes.length,sha256:digest(bytes),body:bytes.toString('base64')}]));
  originalFiles['manifest.json'] = {encoding:'base64',bytes:source.manifestBytes.length,
    sha256:digest(source.manifestBytes),body:source.manifestBytes.toString('base64')};
  const metadataBytes = jsonBytes({
    schema:SCHEMA,provider:META_PROVIDER,query:source.query.label,success:true,results:[],
    sourceTerms:'OpenAlex metadata is CC0. Saved queries, review decisions and acquisition records retain their original workspace authorship and access. Linked full text retains its own licence.',
    usage:{sourceEditionId:editionId,queryId:source.query.id,queryRevision:source.query.revision,
      sourceCoverage:source.coverage.state,sourcePages:source.coverage.pages,
      sourceRecordsReceived:source.coverage.recordsReceived,totalReported:source.coverage.totalReported,
      sourceDecisionsRevision:source.decisions.revision},
    warnings:source.coverage.warnings,
    savedCohort:{schema:'sf88-openalex-saved-cohort-v1',contractSource:OPENALEX_SAVED_EDITION_CONTRACT,
      sourceSignature:source.signature,edition:source.record,query:source.query,coverage:source.coverage,
      decisions:source.decisions,pageBindings:bindings,originalFiles},
  });
  need(metadataBytes.length <= MAX_RESPONSE, 'OPENALEX_COHORT_METADATA_TOO_LARGE');
  normalizeResponse(metadataBytes, META_PROVIDER);
  const metadataId = prior[0]?.id ?? dossierEditionId(questionId, META_PROVIDER, metadataBytes, metadataIdentity);
  const result = {
    schema:'sf88-openalex-dossier-import-v1',dossierId,questionId,sourceEditionId:editionId,
    sourceSignature:source.signature,metadataEditionId:metadataId,metadataReused:Boolean(prior.length),
    retainedExportManifestSha256:prior[0]?.origin.manifestSha256 ?? digest(source.manifestBytes),
    currentExportManifestSha256:digest(source.manifestBytes),
    coverage:source.coverage,decisions:source.decisions,query:source.query,edition:source.record,
    expectedPages:source.pages.length,pages:[],importedPages:0,reusedPages:0,complete:false,
    revision:dossier.revision,
  };
  try {
    signal?.throwIfAborted();
    if (!prior.length) {
      dossier = await dossierStore.receive(dossierId, {
        questionId,label:label + ' · source cohort',provider:META_PROVIDER,rawBytes:metadataBytes,
        sourceReference:source.pages[0]?.sourceReference ?? 'https://api.openalex.org/works',
        expectedRevision:dossier.revision,
        origin:{mode:META_MODE,intentId:metadataIdentity,sourceFingerprint:source.signature.sha256,
          sourceEditionId:editionId,querySha256:source.query.sha256,decisionsRevision:source.decisions.revision,
          sourceCoverage:source.coverage.state,sourcePages:source.coverage.pages,
          manifestSha256:digest(source.manifestBytes)},
      });
      result.revision = dossier.revision;
    }
    for (const [position, item] of source.pages.entries()) {
      signal?.throwIfAborted();
      const binding = bindings[position], existing = dossier.editions.find(entry => entry.id === binding.dossierEditionId);
      if (existing) {
        need(existing.mode === 'retained' && existing.questionId === questionId && existing.provider === 'openalex' &&
          existing.raw.sha256 === binding.sha256 && existing.raw.bytes === binding.bytes &&
          existing.origin?.intentId === item.identity, 'OPENALEX_PAGE_IDENTITY_CONFLICT');
        result.reusedPages++;
      } else {
        dossier = await dossierStore.receive(dossierId, {
          questionId,label:label + ' · page ' + item.page.index,
          provider:'openalex',rawBytes:item.bytes,sourceReference:item.sourceReference,expectedRevision:dossier.revision,
          origin:{mode:PAGE_MODE,intentId:item.identity,intentKind:binding.intentKind,
            nativeIntentId:item.nativeIntentId,sourceEditionId:editionId,queryId:source.query.id,
            queryRevision:source.query.revision,querySha256:source.query.sha256,pageIndex:item.page.index,
            requestSha256:item.page.requestSha256,responseSha256:item.page.sha256,responseBytes:item.page.bytes,
            sourceRetrievedAt:item.page.source.retrievedAt,metadataEditionId:metadataId,
            sourceFingerprint:source.signature.sha256,nativeRecordFile:item.nativePath,
            nativeRecordSha256:item.page.nativeSha256 ?? null},
        });
        result.importedPages++;
      }
      result.revision = dossier.revision;
      const received = {...binding,reused:Boolean(existing)};
      result.pages.push(received);
      if (onPage) await onPage(structuredClone(received), {
        revision:result.revision,metadataEditionId:metadataId,receivedPages:result.pages.length,
        expectedPages:result.expectedPages,sourceCoverage:source.coverage.state,
      });
    }
    result.complete = true;
    return {...result,dossier};
  } catch (error) {
    // CAS, interruption, or I/O failures retain already committed pages for the same retry.
    if (error && typeof error === 'object') error.openAlexImport = structuredClone(result);
    throw error;
  }
}
