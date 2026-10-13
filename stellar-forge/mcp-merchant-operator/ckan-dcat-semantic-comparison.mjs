// MIT. Retained RDF snapshot comparison through the original DCAT workspace owner.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename } from 'node:path';
import { failure, plain } from './config.mjs';

const PREFIX = 'merchant_ckan_dcat_semantic_comparison_';
const MAX_PAGE_BYTES = 64 * 1024;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const SECTIONS = ['changes', 'nodes', 'relationships'];
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
function need(value, code, message) { if (!value) throw failure(code, message); }
function id(value) {
  need(typeof value === 'string' && UUID.test(value), 'INVALID_PARAMS', 'Select the saved semantic item UUID.');
  return value;
}
function hash(value) {
  need(typeof value === 'string' && HASH.test(value), 'INVALID_PARAMS', 'Bind the exact inspected SHA256.');
  return value;
}
function integer(value, fallback, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const selected = value === undefined ? fallback : value;
  need(Number.isSafeInteger(selected) && selected >= minimum && selected <= maximum,
    'INVALID_PARAMS', 'Use a whole number within the declared range.');
  return selected;
}
function pageOptions(input) {
  return { offset: integer(input.offset, 0), limit: integer(input.limit, 25, 1, 100) };
}
function absoluteIri(value) {
  need(typeof value === 'string' && value.length > 0 && value.length <= 4096 &&
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) && !/[\u0000-\u0020<>"{}|\\^`]/u.test(value),
    'INVALID_PARAMS', 'Select an explicit absolute predicate IRI.');
  try {
    const parsed = new URL(value);
    need(!parsed.username && !parsed.password, 'INVALID_PARAMS', 'A predicate IRI cannot contain credentials.');
  } catch (error) {
    if (error.code) throw error;
    throw failure('INVALID_PARAMS', 'Select an explicit absolute predicate IRI.');
  }
  return value;
}
function parameters(value = {}) {
  need(plain(value) && Object.keys(value).every(key => ['edge_predicates', 'depth', 'node_limit'].includes(key)),
    'INVALID_PARAMS', 'Use the original graph-impact parameters.');
  const edges = value.edge_predicates ?? [];
  need(Array.isArray(edges) && edges.length <= 256 && new Set(edges).size === edges.length,
    'INVALID_PARAMS', 'Choose at most 256 distinct predicate IRIs; an empty list selects all resource edges.');
  return { edge_predicates: edges.map(absoluteIri), depth: integer(value.depth, 2, 0, 20),
    node_limit: integer(value.node_limit, 100000, 1, 100000) };
}
function limits(value) {
  need(plain(value) && Object.keys(value).every(key => ['timeout_seconds', 'memory_mib'].includes(key)),
    'INVALID_PARAMS', 'Select the original worker limits.');
  return { timeout_seconds: integer(value.timeout_seconds, 120, 5, 600),
    memory_mib: integer(value.memory_mib, 1024, 256, 4096) };
}
function fileSelection(input) {
  need(['comparison', 'review', 'artifact'].includes(input.kind), 'INVALID_PARAMS',
    'Select a retained comparison, comparison review or original artifact.');
  const selected = { kind: input.kind, id: id(input.id) };
  if (input.kind === 'artifact') selected.key = hash(input.key);
  else need(input.key === undefined, 'INVALID_PARAMS', 'Manifest downloads do not take an artifact key.');
  return selected;
}
async function descriptor(model, selected) {
  const file = await model.dcatSemanticComparisonDownload(selected);
  need(plain(file) && typeof file.file === 'string' && HASH.test(file.sha256 ?? '') &&
    Number.isSafeInteger(file.bytes) && file.bytes >= 0 && file.bytes <= 2147483648,
    'CKAN_DCAT_COMPARISON_FILE_CHANGED', 'Read the complete original retained comparison file.');
  return file;
}
function publicFile(file, selected) {
  return { ...selected, name: file.downloadName ?? (file.file ? basename(file.file) : file.path ? basename(file.path) : selected.kind),
    mediaType: file.mediaType ?? file.media_type ?? 'application/octet-stream',
    bytes: file.bytes, sha256: file.sha256,
    read: { ...selected, expectedSha256: file.sha256 } };
}
async function openRetained(model, selected) {
  const file = await descriptor(model, selected);
  const handle = await open(file.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat({ bigint: true });
    need(info.isFile() && info.nlink === 1n && !(info.mode & 0o077n) && info.size === BigInt(file.bytes),
      'CKAN_DCAT_COMPARISON_FILE_CHANGED', 'Read the original private regular comparison artifact.');
    return { readonlyFileHandle: handle, bytes: file.bytes, sha256: file.sha256,
      name: file.downloadName ?? basename(file.file), type: file.mediaType ?? 'application/octet-stream' };
  } catch (error) { await handle.close(); throw error; }
}
function viewed(value, context) {
  if (!plain(value)) return context.view(value);
  const { result, summary, ...metadata } = value;
  return { ...context.view(metadata),
    ...(result === undefined ? {} : { result: context.publicData(result) }),
    ...(summary === undefined ? {} : { summary: context.publicData(summary) }) };
}
export function pageDcatSemanticComparisons(value, input = {}) {
  need(value === undefined || plain(value) && value.schema === 'stellar-forge.dcat-semantic-workspace.v1',
    'CKAN_DCAT_COMPARISON_SOURCE_REQUIRED', 'Open the existing semantic DCAT workspace.');
  const state = value ?? {}, result = { schema: 'stellar-forge.dcat-semantic-workspace.v1' }, paging = {};
  const { limit } = pageOptions(input);
  for (const [key, parameter] of [['comparisons', 'comparisonsOffset'], ['comparisonReviews', 'reviewsOffset']]) {
    const all = state[key] ?? [];
    need(Array.isArray(all), 'CKAN_DCAT_COMPARISON_SOURCE_REQUIRED', 'The saved comparison inventory changed.');
    const offset = integer(input[parameter], 0);
    result[key] = all.slice(offset, offset + limit);
    paging[key] = { offset, limit, total: all.length,
      nextOffset: offset + result[key].length < all.length ? offset + result[key].length : null };
  }
  return { semantic: result, paging };
}
function rowOptions(input) {
  need(SECTIONS.includes(input.section), 'INVALID_PARAMS', 'Select changes, nodes or relationships.');
  const value = { comparisonId: id(input.comparisonId), section: input.section, ...pageOptions(input) };
  if (input.search !== undefined) {
    need(typeof input.search === 'string' && input.search.length <= 4096, 'INVALID_PARAMS', 'Use a bounded text filter.');
    value.search = input.search;
  }
  if (input.change !== undefined) {
    need(input.section === 'changes' && ['added', 'removed'].includes(input.change), 'INVALID_PARAMS',
      'The added/removed filter applies to original changed statements.');
    value.change = input.change;
  }
  if (input.snapshot !== undefined) {
    need(input.section !== 'nodes' && ['before', 'after'].includes(input.snapshot), 'INVALID_PARAMS',
      'Snapshot filtering applies to changed statements and traversed relationships; nodes retain their original scope.');
    value.snapshot = input.snapshot;
  }
  return value;
}
function boundedRows(value, requested, context) {
  need(plain(value) && value.comparisonId === requested.comparisonId && value.section === requested.section &&
    (value.comparisonSha256 === null || HASH.test(value.comparisonSha256 ?? '')) &&
    Array.isArray(value.rows) && plain(value.page) &&
    ['AVAILABLE', 'PENDING', 'UNAVAILABLE', 'DOWNLOAD_REQUIRED'].includes(value.availability),
    'CKAN_DCAT_COMPARISON_RESULT_CHANGED', 'Use the exact original saved comparison rows.');
  const page = value.page;
  need(page.offset === requested.offset && page.limit === requested.limit &&
    value.rows.length <= requested.limit &&
    (page.total === null || Number.isSafeInteger(page.total) && page.total >= 0) &&
    (page.nextOffset === null || Number.isSafeInteger(page.nextOffset) && page.nextOffset > page.offset),
    'CKAN_DCAT_COMPARISON_RESULT_CHANGED', 'The original comparison page differs from its requested cursor.');
  if (value.availability === 'AVAILABLE') need(Number.isSafeInteger(page.total) &&
    page.offset + value.rows.length <= Math.max(page.total, page.offset),
    'CKAN_DCAT_COMPARISON_RESULT_CHANGED', 'The complete filtered row count is required.');
  else need(value.rows.length === 0 && page.nextOffset === null,
    'CKAN_DCAT_COMPARISON_RESULT_CHANGED', 'An unavailable display cannot claim rows or another page.');
  let completeFile = null;
  if (value.artifact) {
    need(plain(value.artifact) && HASH.test(value.artifact.key ?? '') && HASH.test(value.artifact.sha256 ?? '') &&
      Number.isSafeInteger(value.artifact.bytes) && value.artifact.bytes >= 0,
      'CKAN_DCAT_COMPARISON_FILE_CHANGED', 'Keep the full original row artifact available.');
    completeFile = publicFile(value.artifact, { kind: 'artifact', id: requested.comparisonId, key: value.artifact.key });
  }
  need(value.availability !== 'DOWNLOAD_REQUIRED' || completeFile,
    'CKAN_DCAT_COMPARISON_FILE_CHANGED', 'A display-size limit must identify the complete original file.');
  const rows = []; let used = 0;
  for (const [index, original] of value.rows.entries()) {
    const row = context.publicData(original), size = Buffer.byteLength(JSON.stringify(row));
    need(size <= MAX_PAGE_BYTES || completeFile, 'CKAN_DCAT_COMPARISON_FILE_CHANGED',
      'An oversized row must identify the full original artifact.');
    const shown = size > MAX_PAGE_BYTES ? { oversized: true, sectionOffset: page.offset + index,
      displayBytes: size, completeFile } : row;
    const count = Buffer.byteLength(JSON.stringify(shown));
    if (rows.length && used + count > MAX_PAGE_BYTES) break;
    rows.push(shown); used += count;
  }
  const { rows: ignoredRows, page: ignoredPage, artifact: ignoredArtifact, ...metadata } = value;
  return { ...viewed(metadata, context), rows, completeFile,
    page: { ...page, nextOffset: rows.length < value.rows.length ? page.offset + rows.length : page.nextOffset,
      displayBytes: used } };
}

/** Reuses the original lease, mutation guard, native owner and retained-file reader. */
export async function executeCkanDcatSemanticComparison(context, name, input) {
  const { model, workspace } = context;
  switch (name) {
    case PREFIX + 'status': {
      const native = context.native(), page = pageDcatSemanticComparisons(native.dcat?.semantic, input);
      return { workspace, instanceId: context.instanceId, operation: context.view(native.operation),
        active: context.view(native.active), ...context.view(page), fileReads: context.reads.status(context.scope) };
    }
    case PREFIX + 'start': {
      const value = { beforeRunId: id(input.beforeRunId), expectedBeforeRunSha256: hash(input.expectedBeforeRunSha256),
        afterRunId: id(input.afterRunId), expectedAfterRunSha256: hash(input.expectedAfterRunSha256),
        parameters: parameters(input.parameters) };
      if (input.limits !== undefined) value.limits = limits(input.limits);
      if (input.retryOf !== undefined) value.retryOf = id(input.retryOf);
      return context.launch(() => model.startDcatSemanticComparison(value));
    }
    case PREFIX + 'inspect':
      return { workspace, comparison: viewed(await model.dcatSemanticComparison(id(input.comparisonId)), context) };
    case PREFIX + 'rows': {
      const selection = rowOptions(input);
      return { workspace, ...boundedRows(await model.dcatSemanticComparisonRows(selection), selection, context) };
    }
    case PREFIX + 'review': {
      need(['ACCEPT', 'CHANGES_REQUIRED', 'ACKNOWLEDGE'].includes(input.decision), 'INVALID_PARAMS',
        'Select an explicit comparison review decision.');
      need(typeof input.note === 'string' && input.note.trim().length > 0 && input.note.length <= 4096,
        'INVALID_PARAMS', 'Retain the decision reason and impact scope.');
      need(own(input, 'expectedReviewSha256'), 'INVALID_PARAMS', 'Use null for the first decision or the latest inspected review SHA256.');
      const value = { comparisonId: id(input.comparisonId), expectedComparisonSha256: hash(input.expectedComparisonSha256),
        expectedReviewSha256: input.expectedReviewSha256 === null ? null : hash(input.expectedReviewSha256),
        decision: input.decision, note: input.note };
      return context.launch(() => model.reviewDcatSemanticComparison(value));
    }
    case PREFIX + 'files': {
      const selected = fileSelection(input), file = await descriptor(model, selected);
      return { workspace, file: publicFile(file, selected) };
    }
    case PREFIX + 'file_read': {
      const selected = fileSelection(input); hash(input.expectedSha256);
      const chunk = await context.reads.read({ scope: context.scope,
        key: 'dcat-semantic-comparison:' + selected.kind + ':' + selected.id + ':' + (selected.key ?? ''),
        kind: 'ckan-dcat-semantic-comparison-' + selected.kind, directory: context.directory,
        expectedSha256: input.expectedSha256, readId: input.readId, offset: input.offset, limit: input.limit,
        load: () => openRetained(model, selected) });
      return { workspace, ...selected, ...chunk };
    }
    default: throw failure('TOOL_NOT_FOUND', 'Unknown saved semantic comparison operation.');
  }
}
