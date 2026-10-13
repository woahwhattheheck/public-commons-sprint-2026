// MIT. Saved DCAT migration operations through the original CKAN owner.
import { executeCkanDcatSemantic, pageDcatSemanticState } from './ckan-dcat-semantic.mjs';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { failure, plain } from './config.mjs';
import { parseCkanJson } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/capture.mjs';

export const DCAT_INPUT_MAX_BYTES = 128 * 1024 * 1024;
const MAX_REPORT_BYTES = 512 * 1024 * 1024;
const MAX_PAGE_BYTES = 64 * 1024;
const MAX_CACHED_REPORT_BYTES = 16 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const collections = ['catalogs', 'reviews', 'releases'];
const sourceCollections = ['sources', 'acquisitions'];
const reports = new WeakMap();
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function need(value, code, message) {
  if (!value) throw failure(code, message);
}
function id(value) {
  need(typeof value === 'string' && UUID.test(value), 'INVALID_PARAMS', 'Use the original saved catalog, review or release UUID.');
  return value;
}
function sha(value) {
  need(typeof value === 'string' && SHA256.test(value), 'INVALID_PARAMS', 'Use the exact inspected SHA256.');
  return value;
}
function integer(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  value = value === undefined ? fallback : value;
  need(Number.isSafeInteger(value) && value >= 0 && value <= maximum,
    'INVALID_PARAMS', 'Use a nonnegative offset and the declared page limit.');
  return value;
}
function pageOptions(input) {
  const offset = integer(input.offset, 0), limit = integer(input.limit, 25, 100);
  need(limit > 0, 'INVALID_PARAMS', 'Use a page limit between 1 and 100.');
  return { offset, limit };
}
function dcatState(native) {
  const value = native.dcat;
  need(plain(value) && collections.every(key => Array.isArray(value[key])),
    'CKAN_DCAT_SOURCE_REQUIRED', 'Use the installed CKAN workspace with its complete DCAT migration source.');
  return value;
}
function selected(native, collection, value) {
  id(value);
  const item = dcatState(native)[collection].find(row => row.id === value);
  need(item, 'CKAN_DCAT_ITEM_NOT_FOUND', 'Select an original retained item from merchant_ckan_dcat_status.');
  return item;
}
export function pageDcatState(value, input = {}) {
  const limit = integer(input.limit, 25, 100), result = { ...value }, paging = {};
  need(limit > 0, 'INVALID_PARAMS', 'Use a page limit between 1 and 100.');
  for (const key of [...collections, ...sourceCollections.filter(key => value[key] !== undefined)]) {
    need(Array.isArray(value[key]), 'CKAN_DCAT_SOURCE_REQUIRED', 'The original DCAT collection shape changed.');
    const offset = integer(input[key + 'Offset'], 0), all = value[key];
    result[key] = all.slice(offset, offset + limit);
    paging[key] = { offset, limit, total: all.length,
      nextOffset: offset + result[key].length < all.length ? offset + result[key].length : null };
  }
  if (value.semantic !== undefined) {
    const selected = pageDcatSemanticState(value.semantic, { limit,
      profilesOffset: input.semanticProfilesOffset, runsOffset: input.semanticRunsOffset,
      reviewsOffset: input.semanticReviewsOffset });
    result.semantic = selected.semantic; paging.semantic = selected.paging;
  }
  return { dcat: result, paging };
}
export function forgetDcatReview(model) { reports.delete(model); }

function fileSelection(kind, itemId) {
  need(['catalog', 'report', 'candidate', 'current', 'acquisition-receipt', 'acquisition-response'].includes(kind), 'INVALID_PARAMS',
    'Select a retained catalog, report, candidate, current release or original acquisition receipt/response.');
  if (kind === 'current') need(itemId === undefined, 'INVALID_PARAMS', 'The current release selects its own original candidate.');
  else id(itemId);
  return { kind, itemId };
}
async function descriptor(model, kind, itemId) {
  fileSelection(kind, itemId);
  const result = kind.startsWith('acquisition-') ? await model.dcatAcquisitionDownload(itemId, kind.slice('acquisition-'.length))
    : kind === 'catalog' ? await model.dcatCatalogDownload(itemId)
    : kind === 'current' ? await model.dcatCurrentDownload()
    : await model.dcatReviewDownload(itemId, kind);
  need(plain(result) && typeof result.file === 'string' && SHA256.test(result.sha256 ?? '') &&
    Number.isSafeInteger(result.bytes) && result.bytes >= 0 &&
    result.bytes <= (kind === 'report' ? MAX_REPORT_BYTES : DCAT_INPUT_MAX_BYTES),
    'CKAN_DCAT_FILE_CHANGED', 'The original owner must return a complete retained file identity.');
  return result;
}
function publicFile(value, kind, itemId) {
  const stableKind = kind === 'current' ? 'candidate' : kind;
  const stableId = kind === 'current' ? id(value.id) : id(itemId);
  return { kind: stableKind, itemId: stableId, name: value.downloadName,
    mediaType: value.mediaType ?? 'application/json', bytes: value.bytes, sha256: value.sha256,
    ...(value.releaseId ? { releaseId: value.releaseId } : {}),
    read: { kind: stableKind, itemId: stableId, expectedSha256: value.sha256 } };
}
async function reportDocument(context, reviewId, expectedReviewSha256) {
  const metadata = selected(context.native(), 'reviews', reviewId);
  need(['READY', 'NEEDS_CORRECTION'].includes(metadata.status),
    'DCAT_REVIEW_INCOMPLETE', 'Follow the original operation until the complete review is retained.');
  sha(metadata.reportSha256); sha(metadata.reviewSha256);
  if (expectedReviewSha256 !== undefined)
    need(sha(expectedReviewSha256) === metadata.reviewSha256, 'CKAN_DCAT_REVIEW_CHANGED',
      'Choose the exact retained review hash returned by its summary.');
  const key = reviewId + ':' + metadata.reportSha256 + ':' + metadata.reviewSha256;
  const cached = reports.get(context.model);
  if (cached?.key === key) return cached;
  const file = await descriptor(context.model, 'report', reviewId);
  need(file.sha256 === metadata.reportSha256 && file.bytes === metadata.reportBytes,
    'CKAN_DCAT_REVIEW_CHANGED', 'The retained report differs from its original review identity.');
  const raw = await context.privateFile(file.file, MAX_REPORT_BYTES, true);
  need(raw.sha256 === file.sha256 && raw.bytes === file.bytes,
    'CKAN_DCAT_REVIEW_CHANGED', 'The complete report changed while being received.');
  // The original parser retains large integers, decimal tokens and negative zero.
  const report = parseCkanJson(raw.content);
  need(report.schema === 'migration-review.v1' && report.review_sha256 === metadata.reviewSha256,
    'CKAN_DCAT_REVIEW_CHANGED', 'Use the complete original engine review.');
  const value = { key, report, metadata, file };
  if (raw.bytes <= MAX_CACHED_REPORT_BYTES) reports.set(context.model, value);
  else reports.delete(context.model);
  return value;
}
function rowsAt(value, pointer) {
  return Array.isArray(value) ? value.map((data, index) => ({ reportPath: pointer + '/' + index, value: data })) : [];
}
function validationRows(report, edition) {
  const validation = report.validation?.[edition];
  if (!validation) return [];
  const root = '/validation/' + edition, rows = rowsAt(validation.errors, root + '/errors');
  for (const [index, record] of (validation.records ?? []).entries()) {
    for (const [errorIndex, error] of (record.errors ?? []).entries())
      rows.push({ reportPath: root + '/records/' + index + '/errors/' + errorIndex,
        value: error, owner: { kind: 'record', path: record.path, identifier: record.identifier,
          role: record.role, schema_id: record.schema_id } });
  }
  for (const [index, catalog] of (validation.catalogs ?? []).entries()) {
    for (const [errorIndex, error] of (catalog.errors ?? []).entries())
      rows.push({ reportPath: root + '/catalogs/' + index + '/errors/' + errorIndex,
        value: error, owner: { kind: 'catalog', path: catalog.path, profile: catalog.profile } });
  }
  if (validation.exception !== null && validation.exception !== undefined)
    rows.push({ reportPath: root + '/exception', value: validation.exception,
      owner: { kind: 'original_catalog_validation' } });
  return rows;
}
function conservationRows(report) {
  const value = report.conservation ?? {}, rows = [];
  for (const name of ['missing', 'added'])
    rows.push(...rowsAt(value[name], '/conservation/' + name).map(row => ({ ...row, finding: name })));
  for (const name of ['duplicates', 'unidentified', 'inventory_issues']) {
    for (const edition of ['source', 'candidate'])
      rows.push(...rowsAt(value[name]?.[edition], '/conservation/' + name + '/' + edition)
        .map(row => ({ ...row, finding: name, edition })));
  }
  return rows;
}
const listSections = {
  mappings: ['conservation', 'mappings'],
  relationships: ['conservation', 'relationships'],
  field_changes: ['field_changes'], catalog_changes: ['catalog_changes'],
  comparison_field_changes: ['comparison_changes', 'field_changes'],
  comparison_catalog_changes: ['comparison_changes', 'catalog_changes'],
  candidate_comparison_field_changes: ['comparison_changes', 'candidate_to_comparison', 'field_changes'],
  candidate_comparison_catalog_changes: ['comparison_changes', 'candidate_to_comparison', 'catalog_changes'],
  operator_field_changes: ['operator_changes', 'field_changes'],
  operator_catalog_changes: ['operator_changes', 'catalog_changes'],
  issues: ['issues'], conversion_messages: ['conversion', 'messages'],
};
function sectionRows(report, section, edition) {
  if (section === 'validation') return validationRows(report, edition);
  if (section === 'conservation') return conservationRows(report);
  if (section === 'inventory') return rowsAt(report[edition + '_inventory']?.records, '/' + edition + '_inventory/records');
  const parts = listSections[section];
  need(parts, 'INVALID_PARAMS', 'Choose a declared review section.');
  return rowsAt(parts.reduce((value, key) => value?.[key], report), '/' + parts.join('/'));
}
function pageReportRows(rows, input, publicData) {
  const { offset, limit } = pageOptions(input), result = [];
  let used = 0;
  for (let index = offset; index < rows.length && result.length < limit; index++) {
    const complete = publicData(rows[index]);
    const displayBytes = Buffer.byteLength(JSON.stringify(complete));
    const row = displayBytes > MAX_PAGE_BYTES
      ? { oversized: true, sectionOffset: index, displayBytes,
          reportPath: rows[index].reportPath.length <= 2048 ? rows[index].reportPath : null,
          reportPathCharacters: rows[index].reportPath.length,
          completeValue: 'Read this review original report with merchant_ckan_dcat_file_read.' }
      : complete;
    const count = displayBytes > MAX_PAGE_BYTES ? Buffer.byteLength(JSON.stringify(row)) : displayBytes;
    if (result.length && used + count > MAX_PAGE_BYTES) break;
    result.push(row); used += count;
  }
  const next = offset + result.length;
  return { rows: result, page: { offset, limit, total: rows.length,
    nextOffset: next < rows.length ? next : null, displayBytes: used } };
}
const pick = (value, keys) => value === null || value === undefined ? null
  : Object.fromEntries(keys.filter(key => own(value, key)).map(key => [key, value[key]]));
function reportSummary(report) {
  const validation = {};
  for (const edition of ['source', 'candidate', 'comparison']) {
    const value = report.validation?.[edition];
    validation[edition] = value ? { valid: value.valid, state: value.state, schema_id: value.schema_id,
      catalogErrors: value.errors?.length ?? 0, originalException: Boolean(value.exception),
      recordCount: value.records?.length ?? 0,
      invalidRecords: (value.records ?? []).filter(row => row.valid === false).length,
      nestedCatalogs: value.catalogs?.length ?? 0, rows: validationRows(report, edition).length } : null;
  }
  const sections = Object.fromEntries(Object.keys(listSections).map(key => [key, sectionRows(report, key, 'candidate').length]));
  sections.conservation = conservationRows(report).length;
  sections.validation = Object.fromEntries(['source', 'candidate', 'comparison'].map(key => [key, validation[key]?.rows ?? 0]));
  sections.inventory = Object.fromEntries(['source', 'candidate', 'comparison']
    .map(key => [key, report[key + '_inventory']?.records?.length ?? 0]));
  const editionKeys = ['sha256', 'bytes', 'profile', 'declared_profile', 'encoding', 'origin'];
  return { schema: report.schema, mode: report.mode, engine: report.engine,
    source: pick(report.source, editionKeys), candidate: pick(report.candidate, editionKeys),
    comparison: pick(report.comparison, editionKeys), can_receive: report.can_receive,
    requires_review: report.requires_review, summary: report.summary, validation,
    conservation: pick(report.conservation, ['valid', 'source_count', 'target_count', 'matched_count',
      'changed_count', 'unchanged_count', 'relocated_count', 'relationship_change_count']),
    conversion: { state: report.conversion?.state, messages: report.conversion?.messages?.length ?? 0,
      error: report.conversion?.error ? { type: report.conversion.error.type } : null,
      transformedCatalogs: report.conversion?.transformed_catalogs?.length ?? 0,
      preservedStructures: report.conversion?.preserved_structures?.length ?? 0 },
    comparisonChanges: report.comparison_changes ? {
      sourceSha256: report.comparison_changes.source_sha256,
      comparisonSha256: report.comparison_changes.comparison_sha256,
      conservation: pick(report.comparison_changes.conservation, ['valid', 'source_count', 'target_count', 'matched_count']) } : null,
    operatorChanges: report.operator_changes ? {
      sourceSha256: report.operator_changes.source_sha256,
      comparisonSha256: report.operator_changes.comparison_sha256 } : null,
    sections };
}
function checkedMappings(value) {
  need(Array.isArray(value), 'INVALID_PARAMS', 'Use the complete original JSON array of identity mappings.');
  const fields = ['source_path', 'target_path', 'source_identifier', 'target_identifier'];
  for (const row of value)
    need(plain(row) && Object.keys(row).length === fields.length && fields.every(key => own(row, key)) &&
      typeof row.source_path === 'string' && typeof row.target_path === 'string',
      'INVALID_PARAMS', 'Bind each mapping to its exact source/target JSON pointers and typed original identifiers.');
  return value;
}
async function openRetained(model, kind, itemId) {
  const file = await descriptor(model, kind, itemId);
  const handle = await open(file.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const value = await handle.stat({ bigint: true });
    need(value.isFile() && value.nlink === 1n && !(value.mode & 0o077n) && value.size === BigInt(file.bytes),
      'CKAN_DCAT_FILE_CHANGED', 'Receive the original private regular catalog file.');
    return { readonlyFileHandle: handle, bytes: file.bytes, sha256: file.sha256,
      name: file.downloadName, type: file.mediaType ?? 'application/json' };
  } catch (error) { await handle.close(); throw error; }
}

/** The caller owns the original lease, native mutation guard and retained reader. */
export async function executeCkanDcat(context, name, input) {
  const { model, workspace, launch } = context;
  if (name.startsWith('merchant_ckan_dcat_semantic_')) return executeCkanDcatSemantic(context, name, input);
  switch (name) {
    case 'merchant_ckan_dcat_status': {
      const native = context.native(), page = pageDcatState(dcatState(native), input);
      return { workspace, instanceId: context.instanceId, browserUrl: context.browserUrl,
        operation: context.view(native.operation), active: context.view(native.active),
        ...context.view(page), fileReads: context.reads.status(context.scope) };
    }
    case 'merchant_ckan_dcat_source': {
      const source = await model.dcatSource(id(input.sourceId)), paging = {};
      const limit = integer(input.limit, 25, 100);
      need(limit > 0, 'INVALID_PARAMS', 'Use a page limit between 1 and 100.');
      for (const key of ['acquisitions', 'reviews']) if (Array.isArray(source[key])) {
        const offset = integer(input[key + 'Offset'], 0), all = source[key];
        source[key] = all.slice(offset, offset + limit);
        paging[key] = { offset, limit, total: all.length,
          nextOffset: offset + source[key].length < all.length ? offset + source[key].length : null };
      }
      return { workspace, ...context.view(source), paging };
    }
    case 'merchant_ckan_dcat_source_save': {
      need((input.sourceId === undefined) === (input.expectedSourceSha256 === undefined),
        'INVALID_PARAMS', 'Bind a source update to its exact current configuration.');
      const value = {};
      for (const key of ['label', 'url', 'profile', 'authTokenEnv', 'intervalMinutes', 'timeoutMs', 'maxResponseBytes', 'enabled'])
        if (input[key] !== undefined) value[key] = input[key];
      if (input.sourceId !== undefined) Object.assign(value, { id: id(input.sourceId),
        expectedSourceSha256: sha(input.expectedSourceSha256) });
      return launch(() => model.saveDcatSource(value));
    }
    case 'merchant_ckan_dcat_source_acquire': {
      const value = { sourceId: id(input.sourceId), expectedSourceSha256: sha(input.expectedSourceSha256),
        expectedLatestCatalogId: input.expectedLatestCatalogId === null ? null : id(input.expectedLatestCatalogId),
        ...(input.unconditional === undefined ? {} : { unconditional: input.unconditional }),
        ...(input.onlyIfDue === undefined ? {} : { onlyIfDue: input.onlyIfDue }),
        ...(input.retryOf === undefined ? {} : { retryOf: id(input.retryOf) }) };
      for (const key of ['unconditional', 'onlyIfDue']) need(input[key] === undefined || typeof input[key] === 'boolean',
        'INVALID_PARAMS', 'Use a boolean for ' + key + '.');
      return launch(() => model.acquireDcatSource(value));
    }
    case 'merchant_ckan_dcat_import': {
      const configured = context.input(input.input);
      need(configured.kind === 'dcat-catalog', 'CKAN_DCAT_INPUT_KIND',
        'Select a host-declared dcat-catalog input containing the entire original catalog.');
      const expectedSha256 = sha(input.expectedSha256);
      const current = await context.privateFile(configured.file, DCAT_INPUT_MAX_BYTES);
      need(current.sha256 === expectedSha256, 'CKAN_INPUT_CHANGED',
        'Inspect the complete current input and use its exact SHA256.');
      if (input.profile !== undefined)
        need(['auto', '1.1', '3.0'].includes(input.profile), 'INVALID_PARAMS', 'Choose auto, 1.1 or 3.0.');
      return launch(() => model.importDcatCatalog({ file: configured.file, expectedSha256,
        ...(input.label === undefined ? {} : { label: input.label }),
        ...(input.profile === undefined ? {} : { profile: input.profile }),
        ...(input.origin === undefined ? {} : { origin: input.origin }) }));
    }
    case 'merchant_ckan_dcat_source_review_prepare':
    case 'merchant_ckan_dcat_review_prepare': {
      const fromSource = name === 'merchant_ckan_dcat_source_review_prepare';
      const value = { sourceId: id(input.sourceId) };
      if (fromSource) Object.assign(value, {
        expectedSourceSha256: sha(input.expectedSourceSha256), expectedLatestCatalogId: id(input.expectedLatestCatalogId),
        baselineReleaseId: input.baselineReleaseId === null ? null : id(input.baselineReleaseId),
        ...(input.baselineReleaseId === null ? {} : {
          expectedBaselineSha256: sha(input.expectedBaselineSha256),
          expectedBaselineReviewSha256: sha(input.expectedBaselineReviewSha256),
        }),
        ...(input.reuseMappingIndexes === undefined ? {} : { reuseMappingIndexes: input.reuseMappingIndexes }),
      });
      if (input.reuseMappingIndexes !== undefined) need(Array.isArray(input.reuseMappingIndexes) &&
        input.reuseMappingIndexes.every(value => Number.isSafeInteger(value) && value >= 0) &&
        new Set(input.reuseMappingIndexes).size === input.reuseMappingIndexes.length,
        'INVALID_PARAMS', 'Select distinct zero-based mapping indexes from the accepted baseline.');
      for (const key of ['comparisonId', 'candidateId']) if (input[key] !== undefined) value[key] = id(input[key]);
      for (const key of ['label', 'normalizeV3']) if (input[key] !== undefined) value[key] = input[key];
      need(input.normalizeV3 === undefined || typeof input.normalizeV3 === 'boolean',
        'INVALID_PARAMS', 'Use a boolean for explicit DCAT 3.0 normalization.');
      need(!(input.identityMappings !== undefined && input.mappingsInput !== undefined),
        'INVALID_PARAMS', 'Choose inline identity mappings or one original host mapping input.');
      need((input.mappingsInput === undefined) === (input.expectedMappingsSha256 === undefined),
        'INVALID_PARAMS', 'Bind the selected mapping input to its exact SHA256.');
      if (input.mappingsInput !== undefined) {
        const configured = context.input(input.mappingsInput);
        need(configured.kind === 'dcat-mappings', 'CKAN_DCAT_INPUT_KIND',
          'Select a host-declared dcat-mappings input containing the complete mapping array.');
        const current = await context.privateFile(configured.file, DCAT_INPUT_MAX_BYTES, true);
        need(current.sha256 === sha(input.expectedMappingsSha256), 'CKAN_INPUT_CHANGED',
          'Inspect the exact current mapping file before preparing the review.');
        value.identityMappings = checkedMappings(parseCkanJson(current.content));
      } else if (input.identityMappings !== undefined) value.identityMappings = checkedMappings(input.identityMappings);
      return launch(() => fromSource ? model.prepareDcatSourceReview(value) : model.prepareDcatReview(value));
    }
    case 'merchant_ckan_dcat_review': {
      const value = await reportDocument(context, id(input.reviewId), input.expectedReviewSha256);
      const section = input.section ?? 'summary', edition = input.edition ?? 'candidate';
      need(['source', 'candidate', 'comparison'].includes(edition), 'INVALID_PARAMS', 'Choose source, candidate or comparison.');
      const result = { workspace, reviewId: input.reviewId, reviewSha256: value.metadata.reviewSha256,
        status: value.metadata.status, report: publicFile(value.file, 'report', input.reviewId) };
      if (section === 'summary') return { ...result, summary: context.publicData(reportSummary(value.report)) };
      return { ...result, section, edition,
        ...pageReportRows(sectionRows(value.report, section, edition), input, context.publicData) };
    }
    case 'merchant_ckan_dcat_files': {
      fileSelection(input.kind, input.itemId);
      const current = await descriptor(model, input.kind, input.itemId);
      return { workspace, file: publicFile(current, input.kind, input.itemId) };
    }
    case 'merchant_ckan_dcat_file_read': {
      need(input.kind !== 'current', 'INVALID_PARAMS', 'Use the stable candidate selection returned by dcat_files.');
      fileSelection(input.kind, input.itemId); sha(input.expectedSha256);
      const chunk = await context.reads.read({ scope: context.scope,
        key: 'dcat:' + input.kind + ':' + input.itemId, kind: 'ckan-dcat-' + input.kind,
        directory: context.directory, expectedSha256: input.expectedSha256,
        readId: input.readId, offset: input.offset, limit: input.limit,
        // On resumed chunks the original reader keeps its verified descriptor.
        load: () => openRetained(model, input.kind, input.itemId) });
      return { workspace, kind: input.kind, itemId: input.itemId, ...chunk };
    }
    case 'merchant_ckan_dcat_cutover':
    case 'merchant_ckan_dcat_rollback': {
      const expectedActiveReleaseId = input.expectedActiveReleaseId === null ? null : id(input.expectedActiveReleaseId);
      const expectedReviewSha256 = sha(input.expectedReviewSha256), expectedCandidateSha256 = sha(input.expectedCandidateSha256);
      const native = context.native(), state = dcatState(native);
      need(state.activeReleaseId === expectedActiveReleaseId, 'DCAT_ACTIVE_RELEASE_CHANGED',
        'Read the same workspace active release before selecting another catalog.');
      const rollback = name === 'merchant_ckan_dcat_rollback';
      const saved = selected(native, rollback ? 'releases' : 'reviews', rollback ? input.releaseId : input.reviewId);
      need(saved.reviewSha256 === expectedReviewSha256 &&
        (rollback ? saved.sha256 : saved.candidateSha256) === expectedCandidateSha256,
        'CKAN_DCAT_REVIEW_CHANGED', 'Use the exact selected release candidate and review hashes.');
      need(typeof input.note === 'string' && input.note.trim().length > 0 && input.note.length <= 4096,
        'INVALID_PARAMS', 'Record the reason for this retained release decision.');
      const value = { expectedActiveReleaseId, expectedReviewSha256, expectedCandidateSha256, note: input.note };
      return launch(() => rollback
        ? model.rollbackDcat({ ...value, releaseId: saved.id })
        : model.cutoverDcat({ ...value, reviewId: saved.id }));
    }
    default: throw failure('TOOL_NOT_FOUND', 'Unknown original DCAT migration operation.');
  }
}
