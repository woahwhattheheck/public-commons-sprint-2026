// MIT. Join one retained USAspending edition to the original SF88 dossier.
import {
  VERSION, COLUMNS, ORIGIN, SEARCH_PATH, plain, requireThat, canonical, sha,
  decimal, publicRow, awardURL,
} from './core.mjs';

export const DOSSIER_IMPORT_SCHEMA = 'stellar-forge.usaspending-dossier-import.v1';
const RESEARCH_SCHEMA = 'sf88-research-results-v1';
const COMPONENT_SCHEMA = 'stellar-forge.usaspending-dossier-component.v1';
const MODE = 'ORIGINAL_USASPENDING_EDITION';
const PROVIDER = 'usaspending';
const HASH = /^[a-f0-9]{64}$/;
const MAX_RESPONSE = 64 * 1024 * 1024;
const COMPONENT_BUDGET = 48 * 1024 * 1024;
const COMPONENTS = ['rows', 'sourcePages', 'details'];
const RETAINED_COMPONENTS = [...COMPONENTS, 'buyerArchives'];
const SOURCE_TERMS = 'Original public USAspending federal award data from https://api.usaspending.gov/. Saved queries, acquisition records and analyst reviews retain their original workspace authorship. The source API is documented at https://api.usaspending.gov/docs/.';
const moneyFields = COLUMNS.filter(name => name.endsWith('_usd'));
const equal = (a, b) => canonical(a) === canonical(b);
const bytes = value => Buffer.from(JSON.stringify(value) + '\n');
const nonnegative = value => Number.isSafeInteger(value) && value >= 0;

function originalBytes(encoded, expected, name) {
  requireThat(typeof encoded === 'string' && HASH.test(expected), 'ORIGINAL_SOURCE_BYTES_REQUIRED', name);
  const value = Buffer.from(encoded, 'base64');
  requireThat(value.toString('base64') === encoded && sha(value) === expected,
    'ORIGINAL_SOURCE_CHANGED', name);
  return value;
}

/** Validate the existing export. Acquisition and row normalization stay in AwardWorkspace. */
export function inspectUSAspendingEdition(packet, {editionId} = {}) {
  requireThat(plain(packet) && packet.schema === VERSION + '.edition',
    'USASPENDING_EDITION_PACKET_REQUIRED');
  const {sha256, ...unsigned} = packet;
  requireThat(HASH.test(sha256) && sha(unsigned) === sha256, 'EDITION_PACKET_CHANGED');
  const edition = packet.edition;
  requireThat(plain(edition) && typeof edition.id === 'string' &&
    (!editionId || edition.id === editionId) && plain(edition.meta) &&
    typeof edition.name === 'string' && typeof edition.kind === 'string',
    'USASPENDING_EDITION_IDENTITY_INVALID');
  requireThat(equal(packet.columns, [...COLUMNS]) && COMPONENTS.every(name => Array.isArray(packet[name])),
    'USASPENDING_EDITION_COMPONENTS_INVALID');
  requireThat(plain(packet.coverage) && packet.coverage.rowCount === packet.rows.length &&
    typeof packet.coverage.completeCapture === 'boolean' &&
    Array.isArray(packet.warnings), 'USASPENDING_COVERAGE_INVALID');
  requireThat(edition.row_count === packet.rows.length &&
    edition.sha256 === sha({kind: edition.kind, meta: edition.meta, rows: packet.rows.map(row => row.row_sha256)}),
    'USASPENDING_EDITION_CHANGED');
  const keys = new Set();
  for (const row of packet.rows) {
    requireThat(plain(row) && COLUMNS.every(name => Object.hasOwn(row, name)) &&
      typeof row.award_key === 'string' && !keys.has(row.award_key),
      'USASPENDING_AWARD_IDENTITY_INVALID');
    keys.add(row.award_key);
    const projectionSha256 = sha(publicRow(row));
    let expectedRowSha256 = projectionSha256;
    if (Object.hasOwn(row, 'search_source')) {
      requireThat(row.source_kind === 'award_detail' && plain(row.search_source) &&
        HASH.test(row.search_source.rowSha256), 'USASPENDING_SEARCH_PROVENANCE_INVALID');
      expectedRowSha256 = sha({detail: projectionSha256, search: row.search_source.rowSha256});
    }
    requireThat(row.source_url === awardURL(row.award_key) &&
      row.row_sha256 === expectedRowSha256, 'USASPENDING_TYPED_ROW_CHANGED');
    for (const field of moneyFields) requireThat(row[field] === null ||
      typeof row[field] === 'string' && decimal(row[field]) === row[field],
      'USASPENDING_EXACT_AMOUNT_REQUIRED', field);
    requireThat(['award_detail', 'award_search', 'original_buyer_delivery'].includes(row.source_kind),
      'USASPENDING_SOURCE_KIND_INVALID');
    if (row.source_kind !== 'original_buyer_delivery') {
      requireThat(plain(row.raw) && row.source_record_sha256 === sha(row.raw),
        'USASPENDING_ORIGINAL_RECORD_CHANGED');
    }
  }
  const pages = new Set();
  for (const page of packet.sourcePages) {
    requireThat(plain(page) && typeof page.captureId === 'string' &&
      Number.isSafeInteger(page.page) && page.page >= 1 && plain(page.request) && plain(page.receipt),
      'USASPENDING_SOURCE_PAGE_INVALID');
    const key = page.captureId + ':' + page.page;
    requireThat(!pages.has(key), 'USASPENDING_SOURCE_PAGE_DUPLICATE'); pages.add(key);
    originalBytes(page.responseBase64, page.responseSha256, key);
  }
  requireThat(packet.coverage.sourcePageCount === packet.sourcePages.length,
    'USASPENDING_SOURCE_PAGE_COUNT_CHANGED');
  const details = new Set();
  for (const detail of packet.details) {
    requireThat(plain(detail) && typeof detail.id === 'string' && typeof detail.awardKey === 'string' &&
      plain(detail.receipt) && !details.has(detail.id), 'USASPENDING_DETAIL_INVALID');
    details.add(detail.id);
    originalBytes(detail.responseBase64, detail.sha256, detail.id);
  }
  if (packet.buyerDelivery !== null && packet.buyerDelivery !== undefined) {
    const native = packet.buyerDelivery;
    requireThat(plain(native) && Array.isArray(native.archives) && nonnegative(native.manifestBytes),
      'USASPENDING_BUYER_DELIVERY_INVALID');
    const manifest = originalBytes(native.manifestBase64, native.manifestSha256, 'Native delivery manifest');
    requireThat(manifest.length === native.manifestBytes, 'USASPENDING_BUYER_MANIFEST_CHANGED');
    if (plain(edition.meta.deliveryManifest)) requireThat(
      equal(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(manifest)), edition.meta.deliveryManifest),
      'USASPENDING_BUYER_MANIFEST_CHANGED');
    const indexes = new Set();
    for (const archive of native.archives) {
      requireThat(plain(archive) && nonnegative(archive.index) &&
        nonnegative(archive.bytes) && !indexes.has(archive.index),
        'USASPENDING_BUYER_ARCHIVE_INVALID');
      indexes.add(archive.index);
      requireThat(originalBytes(archive.bytesBase64, archive.sha256, 'Native archive ' + archive.index).length ===
        archive.bytes, 'USASPENDING_BUYER_ARCHIVE_CHANGED');
    }
  }
  const {exportedAt, ...stable} = unsigned;
  requireThat(typeof exportedAt === 'string' && Number.isFinite(Date.parse(exportedAt)),
    'USASPENDING_EXPORT_TIME_INVALID');
  const sourceSignature = sha(stable);
  return {
    sourceSignature, editionId: edition.id, editionSha256: edition.sha256,
    packetSha256: sha256, rowCount: packet.rows.length, sourcePageCount: packet.sourcePages.length,
    detailCount: packet.details.length, buyerArchiveCount: packet.buyerDelivery?.archives.length ?? 0,
    reviewCount: packet.reviews?.length ?? 0,
    coverage: packet.coverage, warnings: packet.warnings,
  };
}

function awardItem(row) {
  return {
    id: row.award_key,
    title: [row.recipient_name || 'Recipient unavailable', row.piid || row.award_key].join(' · '),
    url: row.source_url, publication_date: row.signed_date || '',
    description: row.description || '',
    // Every amount remains an exact decimal string. The original row is also retained below.
    content: publicRow(row), authors: [row.awarding_agency].filter(Boolean),
    citation: {provider: 'USAspending', awardKey: row.award_key, piid: row.piid,
      recipientUEI: row.recipient_uei, observedAt: row.source_observed_at, url: row.source_url},
    references: row.parent_award_key ? [awardURL(row.parent_award_key)] : [],
    metadata: {sourceKind: row.source_kind, rowSha256: row.row_sha256,
      sourceRecordSha256: row.source_record_sha256 ?? null,
      searchSource: row.search_source ?? null, original: row.raw ?? null},
  };
}

function status(packet) {
  if (packet.coverage.state === 'PARTIAL' || packet.edition.meta.detailFailures?.length) return 'PARTIAL';
  if (['COMPLETE_COHORT', 'RECEIVED_VIEW', 'DETAIL_VIEW'].includes(packet.coverage.state)) return 'AVAILABLE';
  return packet.coverage.completeCapture ? 'AVAILABLE' : 'PARTIAL';
}
function envelope(packet, sourceSignature, component, index, records, manifest) {
  return {
    schema: RESEARCH_SCHEMA, provider: PROVIDER,
    query: packet.coverage.definition?.name ?? packet.edition.name,
    success: true, status: status(packet), sourceTerms: SOURCE_TERMS,
    results: component === 'rows' ? records.map(awardItem) : [],
    usage: {sourceEditionId: packet.edition.id, sourceEditionKind: packet.edition.kind,
      sourceRows: packet.rows.length, sourcePages: packet.sourcePages.length,
      detailedRows: packet.coverage.detailedRows, completeCapture: packet.coverage.completeCapture,
      coverage: packet.coverage},
    warnings: packet.warnings,
    savedEdition: {schema: COMPONENT_SCHEMA, sourceSignature, component, index, records,
      ...(manifest ? {manifest} : {})},
  };
}

/** One metadata record plus size-aware chunks preserve all packet fields and original bytes. */
function componentPlan(packet, source) {
  const units = [];
  const header = Object.fromEntries(Object.entries(packet).filter(([name]) => !COMPONENTS.includes(name)));
  if (packet.buyerDelivery) header.buyerDelivery = {...packet.buyerDelivery, archives: []};
  for (const component of RETAINED_COMPONENTS) {
    const originalRecords = component === 'buyerArchives' ? packet.buyerDelivery?.archives ?? [] : packet[component];
    let records = [], size = 0, index = 0;
    const flush = () => {
      if (!records.length) return;
      const raw = bytes(envelope(packet, source.sourceSignature, component, index, records));
      requireThat(raw.length <= MAX_RESPONSE, 'USASPENDING_DOSSIER_COMPONENT_TOO_LARGE');
      units.push({component, index, records: records.length, raw});
      records = []; size = 0; index += 1;
    };
    for (const record of originalRecords) {
      const cost = bytes(record).length +
        (component === 'rows' ? bytes(awardItem(record)).length : 0) + 2;
      if (records.length && size + cost > COMPONENT_BUDGET) flush();
      records.push(record); size += cost;
      if (size >= COMPONENT_BUDGET) flush();
    }
    flush();
  }
  const manifest = {header, components: units.map(unit => ({
    component: unit.component, index: unit.index, records: unit.records,
    bytes: unit.raw.length, sha256: sha(unit.raw),
  }))};
  const raw = bytes(envelope(packet, source.sourceSignature, 'manifest', 0, [], manifest));
  requireThat(raw.length <= MAX_RESPONSE, 'USASPENDING_DOSSIER_MANIFEST_TOO_LARGE');
  return [{component: 'manifest', index: 0, records: 0, raw}, ...units];
}

/**
 * Receive a saved workspace edition OR its original export, exactly once.
 * Retry with the current dossier revision; completed components are reused.
 */
export async function receiveUSAspendingEdition(dossierStore, dossierId, {
  workspace, packet, editionId, questionId, label, expectedRevision,
  includeReviews = false, signal, onComponent,
} = {}) {
  requireThat(dossierStore && typeof dossierStore.get === 'function' &&
    typeof dossierStore.receive === 'function', 'DOSSIER_STORE_REQUIRED');
  requireThat(Boolean(workspace) !== Boolean(packet), 'ONE_USASPENDING_SOURCE_REQUIRED');
  requireThat(typeof includeReviews === 'boolean' &&
    (onComponent === undefined || typeof onComponent === 'function'),
    'USASPENDING_IMPORT_OPTIONS_INVALID');
  signal?.throwIfAborted();
  let dossier = await dossierStore.get(dossierId);
  requireThat(Number.isSafeInteger(expectedRevision) && dossier.revision === expectedRevision,
    'REVISION_CONFLICT', 'Read the current dossier revision before receiving', 409);
  requireThat(dossier.questions.some(question => question.id === questionId), 'QUESTION_NOT_FOUND');
  if (workspace) {
    requireThat(typeof workspace.exportEdition === 'function' && typeof editionId === 'string',
      'USASPENDING_WORKSPACE_REQUIRED');
    packet = await workspace.exportEdition(editionId, {includeSourceBytes: true, includeReviews});
  }
  requireThat(includeReviews || !Object.hasOwn(packet, 'reviews'), 'ANALYST_REVIEW_IMPORT_REQUIRES_OPT_IN');
  const source = inspectUSAspendingEdition(packet, {editionId});
  label ??= packet.edition.name;
  requireThat(typeof label === 'string' && label.trim() && label.length <= 200,
    'USASPENDING_DOSSIER_LABEL_INVALID');
  const units = componentPlan(packet, source);
  const result = {
    schema: DOSSIER_IMPORT_SCHEMA, dossierId, questionId, ...source,
    metadataEditionId: null, firstPacketSha256: packet.sha256,
    componentCount: units.length, components: [], importedComponents: 0,
    reusedComponents: 0, revision: dossier.revision, complete: false,
  };
  try {
    for (const unit of units) {
      signal?.throwIfAborted();
      const identity = 'usaspending-' + source.sourceSignature + '-' + unit.component + '-' + unit.index;
      const prior = dossier.editions.filter(edition => edition.questionId === questionId &&
        edition.provider === PROVIDER && edition.origin?.mode === MODE &&
        edition.origin.intentId === identity);
      requireThat(prior.length <= 1, 'USASPENDING_DOSSIER_IDENTITY_CONFLICT');
      let retained;
      if (prior.length) {
        retained = prior[0];
        requireThat(retained.mode === 'retained' &&
          retained.origin.sourceSignature === source.sourceSignature,
          'USASPENDING_DOSSIER_IDENTITY_CONFLICT');
        // Only the first manifest carries the variable export timestamp.
        if (unit.component !== 'manifest') requireThat(retained.raw.sha256 === sha(unit.raw) &&
          retained.raw.bytes === unit.raw.length, 'USASPENDING_DOSSIER_COMPONENT_CHANGED');
        result.reusedComponents += 1;
      } else {
        dossier = await dossierStore.receive(dossierId, {
          questionId, label: label + ' · ' + unit.component + ' ' + (unit.index + 1),
          provider: PROVIDER, rawBytes: unit.raw, expectedRevision: dossier.revision,
          sourceReference: ORIGIN + SEARCH_PATH,
          origin: {mode: MODE, intentId: identity, sourceSignature: source.sourceSignature,
            sourceEditionId: source.editionId, sourceEditionSha256: source.editionSha256,
            sourcePacketSha256: packet.sha256, component: unit.component, componentIndex: unit.index},
        });
        const matches = dossier.editions.filter(edition => edition.questionId === questionId &&
          edition.provider === PROVIDER && edition.origin?.mode === MODE &&
          edition.origin.sourceSignature === source.sourceSignature && edition.origin.intentId === identity);
        requireThat(matches.length === 1, 'USASPENDING_DOSSIER_RECEIVE_INCOMPLETE');
        retained = matches[0];
        result.importedComponents += 1;
      }
      if (unit.component === 'manifest') {
        result.metadataEditionId = retained.id;
        result.firstPacketSha256 = retained.origin.sourcePacketSha256;
      }
      result.revision = dossier.revision;
      const binding = {component: unit.component, index: unit.index, records: unit.records,
        dossierEditionId: retained.id, bytes: retained.raw.bytes, sha256: retained.raw.sha256,
        reused: Boolean(prior.length)};
      result.components.push(binding);
      if (onComponent) await onComponent(binding, structuredClone(result));
    }
    result.complete = result.components.length === result.componentCount;
    return result;
  } catch (error) {
    error.usaSpendingImport = structuredClone(result);
    throw error;
  }
}

/** Original provider preview in the existing dossier UI; source acquisition stays with its owner. */
export function createUSAspendingEditionProvider(workspace) {
  requireThat(workspace && typeof workspace.exportEdition === 'function', 'USASPENDING_WORKSPACE_REQUIRED');
  return {
    async read(reference) {
      requireThat(plain(reference) && typeof (reference.editionId ?? reference.id) === 'string',
        'USASPENDING_EDITION_REFERENCE_REQUIRED');
      const packet = await workspace.exportEdition(reference.editionId ?? reference.id,
        {includeSourceBytes: true, includeReviews: false});
      const inspected = inspectUSAspendingEdition(packet);
      return {
        status: status(packet), items: packet.rows.map(row => ({...awardItem(row),
          key: row.award_key, original: row.raw ?? publicRow(row)})),
        usage: {sourceEditionId: inspected.editionId, rowCount: inspected.rowCount,
          detailedRows: packet.coverage.detailedRows, completeCapture: packet.coverage.completeCapture},
        warnings: packet.warnings, retention: 'ORIGINAL_SAVED_EDITION_ACCESS',
      };
    },
  };
}

/** Reconstruct the exact first retained edition export from the existing portable dossier. */
export function recoverUSAspendingEdition(portable, sourceSignature, {questionId} = {}) {
  requireThat(plain(portable) && portable.schema === 'sf88-research-dossier-portable-v1' &&
    Array.isArray(portable.versions) && portable.versions.length &&
    Array.isArray(portable.blobs) && HASH.test(sourceSignature), 'PORTABLE_DOSSIER_REQUIRED');
  const state = portable.versions.at(-1)?.state;
  requireThat(plain(state) && Array.isArray(state.editions), 'PORTABLE_DOSSIER_STATE_INVALID');
  const editions = state.editions.filter(edition => edition.mode === 'retained' &&
    edition.origin?.mode === MODE && edition.origin.sourceSignature === sourceSignature &&
    (!questionId || edition.questionId === questionId));
  const questions = new Set(editions.map(edition => edition.questionId));
  requireThat(questions.size === 1, 'USASPENDING_RECOVERY_QUESTION_REQUIRED');
  const blobMap = new Map(portable.blobs.map(blob => [blob.sha256, blob]));
  const read = edition => {
    const blob = blobMap.get(edition.raw.sha256);
    requireThat(blob && blob.bytes === edition.raw.bytes, 'USASPENDING_DOSSIER_BLOB_MISSING');
    const raw = originalBytes(blob.bodyBase64, edition.raw.sha256, edition.id);
    requireThat(raw.length === edition.raw.bytes, 'USASPENDING_DOSSIER_BLOB_CHANGED');
    const record = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(raw));
    requireThat(record.savedEdition?.schema === COMPONENT_SCHEMA &&
      record.savedEdition.sourceSignature === sourceSignature, 'USASPENDING_DOSSIER_COMPONENT_CHANGED');
    return record.savedEdition;
  };
  const manifests = editions.filter(edition => edition.origin.component === 'manifest');
  requireThat(manifests.length === 1, 'USASPENDING_DOSSIER_MANIFEST_REQUIRED');
  const saved = read(manifests[0]), manifest = saved.manifest;
  requireThat(plain(manifest) && plain(manifest.header) && Array.isArray(manifest.components),
    'USASPENDING_DOSSIER_MANIFEST_INVALID');
  const packet = {...manifest.header, rows: [], sourcePages: [], details: []};
  const seen = new Set();
  for (const entry of manifest.components) {
    requireThat(RETAINED_COMPONENTS.includes(entry.component) && nonnegative(entry.index) &&
      nonnegative(entry.records), 'USASPENDING_DOSSIER_COMPONENT_INVALID');
    const key = entry.component + ':' + entry.index;
    requireThat(!seen.has(key), 'USASPENDING_DOSSIER_COMPONENT_DUPLICATE'); seen.add(key);
    const matches = editions.filter(edition => edition.origin.component === entry.component &&
      edition.origin.componentIndex === entry.index);
    requireThat(matches.length === 1 && matches[0].raw.sha256 === entry.sha256 &&
      matches[0].raw.bytes === entry.bytes, 'USASPENDING_DOSSIER_COMPONENT_MISSING');
    const component = read(matches[0]);
    requireThat(component.component === entry.component && component.index === entry.index &&
      Array.isArray(component.records) && component.records.length === entry.records,
      'USASPENDING_DOSSIER_COMPONENT_CHANGED');
    const target = entry.component === 'buyerArchives' ? packet.buyerDelivery?.archives : packet[entry.component];
    requireThat(Array.isArray(target), 'USASPENDING_DOSSIER_COMPONENT_TARGET_INVALID');
    for (const record of component.records) target.push(record);
  }
  const inspected = inspectUSAspendingEdition(packet);
  requireThat(inspected.sourceSignature === sourceSignature, 'USASPENDING_DOSSIER_SOURCE_CHANGED');
  return packet;
}
