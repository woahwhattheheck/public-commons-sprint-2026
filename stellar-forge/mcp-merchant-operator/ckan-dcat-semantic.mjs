// MIT. Native semantic validation through the original DCAT workspace owner.
import { executeCkanDcatSemanticComparison } from './ckan-dcat-semantic-comparison.mjs';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename } from 'node:path';
import { failure, plain } from './config.mjs';

export const SEMANTIC_INPUT_MAX_BYTES = 64 * 1024 * 1024;
const MAX_PROFILE_BYTES = 128 * 1024 * 1024;
const MAX_PAGE_BYTES = 64 * 1024;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const KINDS = ['profile', 'profile-file', 'run', 'review', 'artifact'];
const FORMATS = ['turtle', 'nt', 'xml', 'json-ld'];
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
function need(value, code, message) { if (!value) throw failure(code, message); }
function id(value) {
  need(typeof value === 'string' && UUID.test(value), 'INVALID_PARAMS', 'Select an original semantic item UUID.');
  return value;
}
function hash(value) {
  need(typeof value === 'string' && HASH.test(value), 'INVALID_PARAMS', 'Bind the exact retained SHA256.');
  return value;
}
function integer(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  value = value === undefined ? fallback : value;
  need(Number.isSafeInteger(value) && value >= 0 && value <= maximum,
    'INVALID_PARAMS', 'Use a nonnegative integer within the declared page limit.');
  return value;
}
function pageOptions(input) {
  const offset = integer(input.offset, 0), limit = integer(input.limit, 25, 100);
  need(limit > 0, 'INVALID_PARAMS', 'Use a page limit between 1 and 100.');
  return { offset, limit };
}
function schemaState(value) {
  if (value === undefined) return { schema: 'stellar-forge.dcat-semantic-workspace.v1', profiles: [], runs: [], reviews: [] };
  need(plain(value) && value.schema === 'stellar-forge.dcat-semantic-workspace.v1' &&
    ['profiles', 'runs', 'reviews'].every(key => Array.isArray(value[key])),
    'CKAN_DCAT_SEMANTIC_SOURCE_REQUIRED', 'Open the complete installed semantic DCAT workspace.');
  return value;
}
export function pageDcatSemanticState(value, input = {}) {
  const state = schemaState(value), result = { schema: state.schema }, paging = {};
  const { limit } = pageOptions(input);
  for (const key of ['profiles', 'runs', 'reviews']) {
    const offset = integer(input[key + 'Offset'], 0), all = state[key];
    result[key] = all.slice(offset, offset + limit);
    paging[key] = { offset, limit, total: all.length,
      nextOffset: offset + result[key].length < all.length ? offset + result[key].length : null };
  }
  return { semantic: result, paging };
}
function viewed(value, context) {
  if (!plain(value)) return context.view(value);
  const { result, findings, ...metadata } = value;
  return { ...context.view(metadata),
    ...(result === undefined ? {} : { result: context.publicData(result) }),
    ...(findings === undefined ? {} : { findings: context.publicData(findings) }) };
}
function fileSelection(input) {
  need(KINDS.includes(input.kind), 'INVALID_PARAMS', 'Choose profile, profile-file, run, review or artifact.');
  id(input.id);
  if (input.kind === 'artifact') hash(input.key);
  else if (input.kind === 'profile-file') need(typeof input.key === 'string' && /^[a-z]+(?:-[0-9]+)?$/.test(input.key),
    'INVALID_PARAMS', 'Use the original context, shape, ontology or attachment key from the retained profile.');
  else need(input.key === undefined, 'INVALID_PARAMS', 'Manifest downloads do not take an artifact key.');
  return { kind: input.kind, id: input.id, ...(input.key === undefined ? {} : { key: input.key }) };
}
async function descriptor(model, selection) {
  const file = await model.dcatSemanticDownload(selection);
  need(plain(file) && typeof file.file === 'string' && HASH.test(file.sha256 ?? '') &&
    Number.isSafeInteger(file.bytes) && file.bytes >= 0, 'CKAN_DCAT_SEMANTIC_FILE_CHANGED',
    'The original semantic owner must return a complete retained file identity.');
  return file;
}
function publicFile(file, selection) {
  return { ...selection, name: file.downloadName ?? basename(file.file),
    mediaType: file.mediaType ?? 'application/octet-stream', bytes: file.bytes, sha256: file.sha256,
    read: { ...selection, expectedSha256: file.sha256 } };
}
async function openRetained(model, selection) {
  const file = await descriptor(model, selection);
  const handle = await open(file.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat({ bigint: true });
    need(info.isFile() && info.nlink === 1n && !(info.mode & 0o077n) && info.size === BigInt(file.bytes),
      'CKAN_DCAT_SEMANTIC_FILE_CHANGED', 'Read the original private regular semantic artifact.');
    return { readonlyFileHandle: handle, bytes: file.bytes, sha256: file.sha256,
      name: file.downloadName ?? basename(file.file), type: file.mediaType ?? 'application/octet-stream' };
  } catch (error) { await handle.close(); throw error; }
}
async function profileFile(context, selected, role) {
  need(plain(selected) && Object.keys(selected).every(key => ['input', 'expectedSha256', 'name', 'format', 'mediaType'].includes(key)),
    'INVALID_PARAMS', 'Select an original host input alias and its inspected SHA256.');
  const configured = context.input(selected.input), expectedSha256 = hash(selected.expectedSha256);
  need(configured.kind === 'dcat-semantic-' + role, 'CKAN_DCAT_INPUT_KIND',
    'Select a host-declared dcat-semantic-' + role + ' input.');
  const original = await context.privateFile(configured.file, SEMANTIC_INPUT_MAX_BYTES, true);
  need(original.sha256 === expectedSha256 && (role === 'attachment' || original.bytes > 0), 'CKAN_INPUT_CHANGED',
    'Inspect the complete current profile input and use its exact SHA256.');
  const name = selected.name ?? basename(configured.file);
  need(typeof name === 'string' && name.length > 0 && name.length <= 512 && !/[\0\r\n]/.test(name),
    'INVALID_PARAMS', 'Use a nonempty retained profile filename.');
  const result = { name, contentBase64: original.content.toString('base64'),
    bytes: original.bytes, sha256: original.sha256 };
  if (role === 'shapes' || role === 'ontology') {
    need(FORMATS.includes(selected.format), 'INVALID_PARAMS', 'Choose the original RDF graph format.');
    result.format = selected.format;
  } else need(selected.format === undefined, 'INVALID_PARAMS', 'Only shapes and ontologies declare an RDF format.');
  if (role === 'attachment' && selected.mediaType !== undefined) {
    need(typeof selected.mediaType === 'string' && selected.mediaType.length > 0 &&
      selected.mediaType.length <= 128 && !/[\0\r\n]/.test(selected.mediaType),
      'INVALID_PARAMS', 'Use a valid original attachment media type.');
    result.mediaType = selected.mediaType;
  } else need(selected.mediaType === undefined, 'INVALID_PARAMS', 'Media type applies only to retained attachments.');
  return result;
}
async function importProfile(context, input) {
  need(typeof input.label === 'string' && input.label.trim().length > 0 && input.label.length <= 512,
    'INVALID_PARAMS', 'Name this exact retained semantic profile.');
  need(['require-absent', 'replace-root', 'preserve'].includes(input.contextMode),
    'INVALID_PARAMS', 'Select the explicit root-context policy.');
  need(typeof input.baseIRI === 'string' && input.baseIRI.length > 0 && input.baseIRI.length <= 4096 &&
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(input.baseIRI) && !/[\u0000-\u0020<>"]/u.test(input.baseIRI),
    'INVALID_PARAMS', 'Provide the explicit absolute base IRI for relative RDF identifiers.');
  need(Array.isArray(input.shapes) && input.shapes.length > 0 &&
    (input.ontologies === undefined || Array.isArray(input.ontologies)) &&
    (input.attachments === undefined || Array.isArray(input.attachments)), 'INVALID_PARAMS',
    'Choose complete original shapes, optional ontologies and optional audit/source attachments.');
  need(1 + input.shapes.length + (input.ontologies?.length ?? 0) + (input.attachments?.length ?? 0) <= 64,
    'INVALID_PARAMS', 'Select at most 64 complete profile files.');
  const parameters = input.parameters ?? {};
  need(plain(parameters) && Object.keys(parameters).every(key => ['inference', 'allow_infos', 'allow_warnings'].includes(key)) &&
    (parameters.inference === undefined || ['none', 'rdfs', 'owlrl', 'both'].includes(parameters.inference)) &&
    ['allow_infos', 'allow_warnings'].every(key => parameters[key] === undefined || typeof parameters[key] === 'boolean'),
    'INVALID_PARAMS', 'Keep inference and allowed severities explicit.');
  if (input.coverageClasses !== undefined) need(Array.isArray(input.coverageClasses) && input.coverageClasses.length <= 256 &&
    input.coverageClasses.every(value => typeof value === 'string' && value.length > 0 && value.length <= 4096) &&
    new Set(input.coverageClasses).size === input.coverageClasses.length,
    'INVALID_PARAMS', 'Select distinct class IRIs for the declared snapshot-presence query.');
  const value = { label: input.label, contextMode: input.contextMode, baseIRI: input.baseIRI,
    parameters: { ...parameters }, context: await profileFile(context, input.context, 'context'),
    shapes: [], ontologies: [], attachments: [] };
  let total = value.context.bytes;
  for (const [key, role] of [['shapes', 'shapes'], ['ontologies', 'ontology'], ['attachments', 'attachment']]) {
    for (const selection of input[key] ?? []) {
      const original = await profileFile(context, selection, role);
      total += original.bytes;
      need(total <= MAX_PROFILE_BYTES, 'CKAN_DCAT_SEMANTIC_PROFILE_SIZE_LIMIT',
        'The selected original profile files exceed 128 MiB.');
      value[key].push(original);
    }
  }
  if (input.coverageClasses !== undefined) value.coverageClasses = input.coverageClasses.slice();
  if (input.supersedesProfileId !== undefined) value.supersedesProfileId = id(input.supersedesProfileId);
  return context.launch(() => context.model.importDcatSemanticProfile(value));
}
function boundedFindings(value, input, context) {
  need(plain(value) && Array.isArray(value.findings) && plain(value.page), 'CKAN_DCAT_SEMANTIC_RESULT_CHANGED',
    'Use the original retained findings and page cursor.');
  const requested = pageOptions(input), rows = [], page = value.page;
  need(page.offset === requested.offset && Number.isSafeInteger(page.total) && page.total >= 0 &&
    value.findings.length <= requested.limit, 'CKAN_DCAT_SEMANTIC_RESULT_CHANGED',
    'The original findings page differs from its requested cursor.');
  let used = 0;
  for (const [index, finding] of value.findings.entries()) {
    const item = context.publicData(finding), bytes = Buffer.byteLength(JSON.stringify(item));
    const shown = bytes > MAX_PAGE_BYTES ? { oversized: true, sectionOffset: page.offset + index,
      displayBytes: bytes, completeValue: 'Download this run original findings artifact with merchant_ckan_dcat_semantic_file_read.' } : item;
    const count = bytes > MAX_PAGE_BYTES ? Buffer.byteLength(JSON.stringify(shown)) : bytes;
    if (rows.length && used + count > MAX_PAGE_BYTES) break;
    rows.push(shown); used += count;
  }
  const next = page.offset + rows.length;
  return { ...viewed({ ...value, findings: undefined, page: undefined }, context), findings: rows,
    page: { ...page, limit: requested.limit, nextOffset: rows.length < value.findings.length ? next : page.nextOffset,
      displayBytes: used } };
}

/** Uses the caller's existing mutation guard, source aliases and retained reader. */
export async function executeCkanDcatSemantic(context, name, input) {
  if (name.startsWith('merchant_ckan_dcat_semantic_comparison_'))
    return executeCkanDcatSemanticComparison(context, name, input);
  const { model, workspace } = context;
  switch (name) {
    case 'merchant_ckan_dcat_semantic_status': {
      const native = context.native(), page = pageDcatSemanticState(native.dcat?.semantic, input);
      return { workspace, instanceId: context.instanceId,
        operation: context.view(native.operation), active: context.view(native.active),
        ...context.view(page), fileReads: context.reads.status(context.scope) };
    }
    case 'merchant_ckan_dcat_semantic_profile_import': return importProfile(context, input);
    case 'merchant_ckan_dcat_semantic_profile':
      return { workspace, profile: viewed(await model.dcatSemanticProfile(id(input.profileId)), context) };
    case 'merchant_ckan_dcat_semantic_run_start': {
      need((input.catalogId === undefined) !== (input.reviewId === undefined), 'INVALID_PARAMS',
        'Choose exactly one retained catalogue or an original migration review candidate.');
      const value = { profileId: id(input.profileId), expectedProfileSha256: hash(input.expectedProfileSha256),
        expectedSourceSha256: hash(input.expectedSourceSha256),
        ...(input.catalogId === undefined ? { reviewId: id(input.reviewId) } : { catalogId: id(input.catalogId) }) };
      if (input.retryOf !== undefined) value.retryOf = id(input.retryOf);
      if (input.limits !== undefined) {
        need(plain(input.limits) && Object.keys(input.limits).every(key => ['timeout_seconds', 'memory_mib'].includes(key)) &&
          (input.limits.timeout_seconds === undefined || Number.isSafeInteger(input.limits.timeout_seconds) &&
            input.limits.timeout_seconds >= 5 && input.limits.timeout_seconds <= 600) &&
          (input.limits.memory_mib === undefined || Number.isSafeInteger(input.limits.memory_mib) &&
            input.limits.memory_mib >= 256 && input.limits.memory_mib <= 4096),
          'INVALID_PARAMS', 'Use the original worker limits:5–600 seconds and256–4096MiB.');
        value.limits = { ...input.limits };
      }
      return context.launch(() => model.startDcatSemanticRun(value));
    }
    case 'merchant_ckan_dcat_semantic_run':
      return { workspace, run: viewed(await model.dcatSemanticRun(id(input.runId)), context) };
    case 'merchant_ckan_dcat_semantic_findings': {
      const value = { runId: id(input.runId), ...pageOptions(input) };
      for (const key of ['severity', 'search']) if (input[key] !== undefined) {
        need(typeof input[key] === 'string' && input[key].length <= (key === 'search' ? 2048 : 4096),
          'INVALID_PARAMS', 'Use the declared original finding filter.');
        value[key] = input[key];
      }
      return { workspace, ...boundedFindings(await model.dcatSemanticFindings(value), input, context) };
    }
    case 'merchant_ckan_dcat_semantic_review': {
      need(['ACCEPT', 'CHANGES_REQUIRED', 'ACKNOWLEDGE'].includes(input.decision), 'INVALID_PARAMS',
        'Select an explicit semantic review decision.');
      need(typeof input.note === 'string' && input.note.trim().length > 0 && input.note.length <= 4096,
        'INVALID_PARAMS', 'Retain the reason for this semantic decision.');
      const value = { runId: id(input.runId), expectedRunSha256: hash(input.expectedRunSha256),
        decision: input.decision, note: input.note,
        expectedReviewSha256: input.expectedReviewSha256 === null ? null : hash(input.expectedReviewSha256) };
      return context.launch(() => model.reviewDcatSemanticRun(value));
    }
    case 'merchant_ckan_dcat_semantic_files': {
      const selection = fileSelection(input), file = await descriptor(model, selection);
      return { workspace, file: publicFile(file, selection) };
    }
    case 'merchant_ckan_dcat_semantic_file_read': {
      const selection = fileSelection(input); hash(input.expectedSha256);
      const chunk = await context.reads.read({ scope: context.scope,
        key: 'dcat-semantic:' + selection.kind + ':' + selection.id + ':' + (selection.key ?? ''),
        kind: 'ckan-dcat-semantic-' + selection.kind, directory: context.directory,
        expectedSha256: input.expectedSha256, readId: input.readId, offset: input.offset, limit: input.limit,
        load: () => openRetained(model, selection) });
      return { workspace, ...selection, ...chunk };
    }
    default: throw failure('TOOL_NOT_FOUND', 'Unknown original DCAT semantic operation.');
  }
}
