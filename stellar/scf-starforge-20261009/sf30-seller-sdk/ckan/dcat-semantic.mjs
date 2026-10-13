// MIT. Immutable semantic profiles and native SHACL evidence in the original DCAT workspace.
import { join } from 'node:path';
import { lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createDcatSemanticNative } from './dcat-semantic-native.mjs';
import { createDcatSemanticComparisons, validateDcatSemanticComparisons,
  validateDcatSemanticComparisonFiles, dcatSemanticComparisonSummary } from './dcat-semantic-comparison.mjs';
import { object, bytes, digest, readPrivate, hashPrivate, createFile, privateDirectory, fault, stamp }
  from '../postgres/publisher/files.mjs';

export const DCAT_SEMANTIC_SCHEMA = 'stellar-forge.dcat-semantic-workspace.v1';
export const DCAT_SEMANTIC_MAX_FILE = 67108864;
export const DCAT_SEMANTIC_MAX_PROFILE = 134217728;
const MAX_ARTIFACT = 2147483648, MAX_RECORD = 16777216;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/, HASH = /^[a-f0-9]{64}$/;
const FORMATS = new Set(['turtle', 'nt', 'xml', 'json-ld']);
const TERMINAL = new Set(['COMPLETE', 'FAILED', 'CANCELLED', 'INTERRUPTED']);
const DECISIONS = new Set(['ACCEPT', 'CHANGES_REQUIRED', 'ACKNOWLEDGE']);
const need = (ok, code = 'DCAT_SEMANTIC_INVALID', message, status = 400) => {
  if (!ok) throw fault(code, message, status);
};
const clone = value => structuredClone(value);
const empty = () => ({ schema: DCAT_SEMANTIC_SCHEMA, profiles: [], runs: [], reviews: [] });
const uuid = value => typeof value === 'string' && UUID.test(value);
const hash = value => typeof value === 'string' && HASH.test(value);
const count = (value, maximum = MAX_ARTIFACT) => Number.isSafeInteger(value) && value >= 0 && value <= maximum;
const clean = (value, name, max = 4096) => {
  need(typeof value === 'string' && value.trim() && value.length <= max && !value.includes('\0'),
    'DCAT_SEMANTIC_INPUT_REQUIRED', 'Enter ' + name + '.');
  return value.trim();
};
const item = (values, id) => {
  need(uuid(id), 'DCAT_SEMANTIC_NOT_FOUND', 'Choose a retained semantic item.', 404);
  const selected = values.find(row => row.id === id);
  need(selected, 'DCAT_SEMANTIC_NOT_FOUND', 'Choose a retained semantic item.', 404);
  return selected;
};
function iri(value) {
  const result = clean(value, 'an explicit absolute base IRI', 4096);
  need(/^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|\\^`]*$/.test(result),
    'DCAT_SEMANTIC_IRI_INVALID', 'Use an explicit absolute IRI.');
  try { const parsed = new URL(result); need(!parsed.username && !parsed.password, 'DCAT_SEMANTIC_IRI_INVALID'); }
  catch (error) { if (error.code) throw error; throw fault('DCAT_SEMANTIC_IRI_INVALID'); }
  return result;
}
function relativeMember(path) {
  need(typeof path === 'string' && path.length <= 4096 && !path.includes('\\') &&
    !path.includes('\0') && path.split('/').every(part => part && part !== '.' && part !== '..'),
    'DCAT_SEMANTIC_ARTIFACT_PATH_INVALID');
  return path;
}
function parameters(value = {}) {
  need(object(value), 'DCAT_SEMANTIC_PARAMETERS_INVALID');
  const result = { inference: value.inference ?? 'none', allow_infos: value.allow_infos ?? false,
    allow_warnings: value.allow_warnings ?? false };
  need(['none', 'rdfs', 'owlrl', 'both'].includes(result.inference) &&
    typeof result.allow_infos === 'boolean' && typeof result.allow_warnings === 'boolean',
    'DCAT_SEMANTIC_PARAMETERS_INVALID');
  return result;
}
function resourceLimits(value = {}) {
  need(object(value), 'DCAT_SEMANTIC_LIMITS_INVALID');
  const result = { timeout_seconds: value.timeout_seconds ?? 120, memory_mib: value.memory_mib ?? 1024 };
  need(Number.isSafeInteger(result.timeout_seconds) && result.timeout_seconds >= 5 && result.timeout_seconds <= 600 &&
    Number.isSafeInteger(result.memory_mib) && result.memory_mib >= 256 && result.memory_mib <= 4096,
    'DCAT_SEMANTIC_LIMITS_INVALID');
  return result;
}
function profileFiles(profile) {
  return [profile.context, ...profile.shapes, ...profile.ontologies, ...profile.attachments];
}
function fileDescriptor(file) {
  need(object(file) && typeof file.key === 'string' && /^[a-z]+(?:-[0-9]+)?$/.test(file.key) &&
    typeof file.name === 'string' && file.name.length > 0 && file.name.length <= 512 && !/[\\/\r\n\0]/.test(file.name) &&
    hash(file.sha256) && count(file.bytes, DCAT_SEMANTIC_MAX_FILE) &&
    typeof file.mediaType === 'string' && file.mediaType.length <= 128 &&
    !/[\r\n\0]/.test(file.mediaType), 'DCAT_SEMANTIC_PROFILE_INVALID');
}
function profileRecord(profile) {
  need(object(profile) && uuid(profile.id) && typeof profile.label === 'string' &&
    typeof profile.createdAt === 'string' && hash(profile.profileSha256),
    'DCAT_SEMANTIC_PROFILE_INVALID');
  iri(profile.baseIRI);
  need(['require-absent', 'replace-root', 'preserve'].includes(profile.contextMode) &&
    Array.isArray(profile.shapes) && profile.shapes.length > 0 && Array.isArray(profile.ontologies) &&
    Array.isArray(profile.attachments) && Array.isArray(profile.coverageClasses),
    'DCAT_SEMANTIC_PROFILE_INVALID');
  parameters(profile.parameters);
  const all = profileFiles(profile);
  need(all.length <= 64 && new Set(all.map(file => file.key)).size === all.length &&
    all.reduce((total, file) => total + file.bytes, 0) <= DCAT_SEMANTIC_MAX_PROFILE,
    'DCAT_SEMANTIC_PROFILE_INVALID');
  all.forEach(fileDescriptor);
  need(profile.context.key === 'context' && profile.context.bytes > 0, 'DCAT_SEMANTIC_PROFILE_INVALID');
  for (const file of [...profile.shapes, ...profile.ontologies])
    need(FORMATS.has(file.format) && file.bytes > 0, 'DCAT_SEMANTIC_PROFILE_INVALID');
  need(profile.coverageClasses.length <= 256 && new Set(profile.coverageClasses).size === profile.coverageClasses.length,
    'DCAT_SEMANTIC_PROFILE_INVALID');
  profile.coverageClasses.forEach(iri);
}
function artifactRecord(file, runId) {
  need(object(file) && hash(file.key) && hash(file.sha256) && count(file.bytes) &&
    typeof file.mediaType === 'string' && file.mediaType.length <= 256 &&
    !/[\r\n\0]/.test(file.mediaType), 'DCAT_SEMANTIC_ARTIFACT_INVALID');
  relativeMember(file.path);
  need(file.path.startsWith(runId + '/') && digest(Buffer.from(file.path, 'utf8')) === file.key,
    'DCAT_SEMANTIC_ARTIFACT_INVALID');
}
function selectionRecord(selection, dcat) {
  need(object(selection) && ['catalog', 'candidate'].includes(selection.kind) &&
    uuid(selection.id) && hash(selection.sha256) && count(selection.bytes, 134217728),
    'DCAT_SEMANTIC_SOURCE_INVALID');
  const original = item(selection.kind === 'catalog' ? dcat.catalogs : dcat.reviews, selection.id);
  need(selection.sha256 === (selection.kind === 'catalog' ? original.sha256 : original.candidateSha256) &&
    selection.bytes === (selection.kind === 'catalog' ? original.bytes : original.candidateBytes),
    'DCAT_SEMANTIC_SOURCE_CHANGED', 'The selected original or reviewed candidate changed.', 409);
  if (selection.kind === 'candidate') need(selection.reviewSha256 === original.reviewSha256 &&
    selection.reportSha256 === original.reportSha256 && ['READY', 'NEEDS_CORRECTION'].includes(original.status),
    'DCAT_SEMANTIC_SOURCE_CHANGED');
}
export function validateDcatSemanticState(dcat) {
  const value = dcat?.semantic;
  if (value === undefined) return;
  need(object(value) && value.schema === DCAT_SEMANTIC_SCHEMA, 'DCAT_SEMANTIC_STATE_INVALID');
  for (const key of ['profiles', 'runs', 'reviews']) {
    need(Array.isArray(value[key]), 'DCAT_SEMANTIC_STATE_INVALID');
    const ids = new Set();
    for (const row of value[key]) {
      need(object(row) && uuid(row.id) && !ids.has(row.id), 'DCAT_SEMANTIC_STATE_INVALID');
      ids.add(row.id);
    }
  }
  const profiles = new Set();
  for (const profile of value.profiles) {
    profileRecord(profile);
    need(profile.supersedesProfileId === null || profiles.has(profile.supersedesProfileId),
      'DCAT_SEMANTIC_PROFILE_INVALID');
    profiles.add(profile.id);
  }
  const runs = new Set();
  for (const run of value.runs) {
    const profile = item(value.profiles, run.profileId);
    need(profile.profileSha256 === run.profileSha256 && typeof run.startedAt === 'string' &&
      (run.status === 'RUNNING' || TERMINAL.has(run.status)), 'DCAT_SEMANTIC_RUN_INVALID');
    selectionRecord(run.selection, dcat); resourceLimits(run.limits);
    need(run.retryOf === null || runs.has(run.retryOf), 'DCAT_SEMANTIC_RUN_INVALID');
    if (run.status !== 'RUNNING') {
      need(hash(run.runSha256) && typeof run.completedAt === 'string' &&
        Array.isArray(run.artifacts), 'DCAT_SEMANTIC_RUN_INVALID');
      validateNativeResult(run.result, run.id);
      need(run.result.status === run.status && digest(bytes([...(run.result.artifacts ?? []), ...(run.result.receipts ?? [])])) === digest(bytes(run.artifacts)),
        'DCAT_SEMANTIC_RUN_INVALID');
      const keys = new Set();
      for (const file of run.artifacts) {
        artifactRecord(file, run.id); need(!keys.has(file.key), 'DCAT_SEMANTIC_ARTIFACT_INVALID'); keys.add(file.key);
      }
    }
    runs.add(run.id);
  }
  const prior = new Map();
  for (const review of value.reviews) {
    const run = item(value.runs, review.runId), previous = prior.get(review.runId) ?? null;
    need(TERMINAL.has(run.status) && review.runSha256 === run.runSha256 && DECISIONS.has(review.decision) &&
      typeof review.note === 'string' && review.note.trim() && review.note.length <= 16384 &&
      hash(review.reviewSha256) && review.previousReviewId === (previous?.id ?? null) &&
      review.previousReviewSha256 === (previous?.reviewSha256 ?? null), 'DCAT_SEMANTIC_REVIEW_INVALID');
    prior.set(review.runId, review);
  }
  validateDcatSemanticComparisons(dcat);
}
function recordPath(kind, id) {
  need(['profiles', 'runs', 'reviews'].includes(kind) && uuid(id), 'DCAT_SEMANTIC_NOT_FOUND');
  return 'dcat/semantic/' + kind + '/' + id + '.json';
}
function assetPath(id, key) {
  need(uuid(id) && typeof key === 'string' && /^[a-z]+(?:-[0-9]+)?$/.test(key), 'DCAT_SEMANTIC_NOT_FOUND');
  return 'dcat/semantic/profile-files/' + id + '/' + key;
}
async function checked(directory, relative, sha256, length, max = MAX_ARTIFACT) {
  relativeMember(relative);
  const raw = await readPrivate(join(directory, relative), max);
  need(raw.length === length && digest(raw) === sha256, 'DCAT_SEMANTIC_FILE_CHANGED',
    'The retained semantic source or result differs from its recorded bytes.', 409);
  return raw;
}
async function checkedArtifact(directory, file) {
  const relative = 'dcat/semantic/native/' + relativeMember(file.path);
  const actual = await hashPrivate(join(directory, relative), MAX_ARTIFACT);
  need(actual.hash === file.sha256 && actual.bytes === file.bytes, 'DCAT_SEMANTIC_FILE_CHANGED',
    'The complete retained native artifact differs from its recorded bytes.', 409);
}
async function readRecord(directory, kind, row, field) {
  const raw = await readPrivate(join(directory, recordPath(kind, row.id)), MAX_RECORD);
  need(digest(raw) === row[field], 'DCAT_SEMANTIC_RECORD_CHANGED', 'The retained semantic record changed.', 409);
  let record; try { record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch { throw fault('DCAT_SEMANTIC_RECORD_INVALID'); }
  const expected = { ...row }; delete expected[field];
  need(digest(bytes(expected)) === digest(bytes(record)), 'DCAT_SEMANTIC_RECORD_CHANGED');
  return { ...record, [field]: row[field] };
}
async function writeExact(file, raw) {
  try { await createFile(file, raw); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = await readPrivate(file, Math.max(raw.length, 1));
    need(existing.equals(raw), 'DCAT_SEMANTIC_RECORD_EXISTS', 'A different retained record already exists.', 409);
  }
}
async function writeRecord(directory, kind, record, field) {
  const raw = bytes(record);
  need(raw.length <= MAX_RECORD, 'DCAT_SEMANTIC_RECORD_TOO_LARGE');
  await privateDirectory(join(directory, 'dcat'), true);
  await privateDirectory(join(directory, 'dcat', 'semantic'), true);
  await privateDirectory(join(directory, 'dcat', 'semantic', kind), true);
  await writeExact(join(directory, recordPath(kind, record.id)), raw);
  return { ...record, [field]: digest(raw) };
}
export async function validateDcatSemanticFiles(directory, dcat) {
  validateDcatSemanticState(dcat);
  if (!dcat?.semantic) return;
  for (const profile of dcat.semantic.profiles) {
    await readRecord(directory, 'profiles', profile, 'profileSha256');
    for (const file of profileFiles(profile))
      await checked(directory, assetPath(profile.id, file.key), file.sha256, file.bytes, DCAT_SEMANTIC_MAX_FILE);
  }
  for (const run of dcat.semantic.runs) {
    need(run.status !== 'RUNNING', 'DCAT_SEMANTIC_RUN_ACTIVE', 'Finish or interrupt the active semantic run before transfer.', 409);
    await readRecord(directory, 'runs', run, 'runSha256');
    for (const file of run.artifacts)
      await checkedArtifact(directory, file);
  }
  for (const review of dcat.semantic.reviews) await readRecord(directory, 'reviews', review, 'reviewSha256');
  await validateDcatSemanticComparisonFiles(directory, dcat);
}
export function dcatSemanticSummary(dcat) {
  if (!dcat?.semantic) return undefined;
  const value = dcat.semantic;
  return { schema: value.schema, ...dcatSemanticComparisonSummary(dcat),
    profiles: value.profiles.map(({ id, label, profileSha256, supersedesProfileId }) =>
      ({ id, label, profileSha256, supersedesProfileId })),
    runs: value.runs.map(({ id, profileId, profileSha256, selection, status, runSha256, summary }) =>
      ({ id, profileId, profileSha256, selection, status, runSha256, summary })),
    reviews: value.reviews.map(({ id, runId, runSha256, reviewSha256, decision, previousReviewId }) =>
      ({ id, runId, runSha256, reviewSha256, decision, previousReviewId })) };
}
function incomingFile(value, key, rdf = false) {
  need(object(value) && typeof value.contentBase64 === 'string' && value.contentBase64.length <=
    Math.ceil(DCAT_SEMANTIC_MAX_FILE / 3) * 4 && !/[^A-Za-z0-9+/=]/.test(value.contentBase64),
    'DCAT_SEMANTIC_FILE_INVALID', 'Supply the complete original file bytes as canonical base64.');
  const raw = Buffer.from(value.contentBase64, 'base64');
  need(raw.toString('base64') === value.contentBase64 && count(value.bytes, DCAT_SEMANTIC_MAX_FILE) &&
    raw.length === value.bytes && hash(value.sha256) && digest(raw) === value.sha256,
    'DCAT_SEMANTIC_FILE_CHANGED', 'Verify the full file size and SHA-256 before importing.');
  if (rdf) need(FORMATS.has(value.format) && raw.length > 0, 'DCAT_SEMANTIC_RDF_FORMAT_INVALID');
  const descriptor = { key, name: clean(value.name, 'a source filename', 512),
    bytes: raw.length, sha256: digest(raw),
    mediaType: value.mediaType ?? (key === 'context' ? 'application/json' : 'application/octet-stream'),
    ...(rdf ? { format: value.format } : {}) };
  fileDescriptor(descriptor);
  return { raw, descriptor };
}
function profileInput(input, id, current) {
  need(object(input) && Array.isArray(input.shapes) && input.shapes.length > 0 &&
    (input.ontologies === undefined || Array.isArray(input.ontologies)) &&
    (input.attachments === undefined || Array.isArray(input.attachments)), 'DCAT_SEMANTIC_PROFILE_INVALID');
  need(1 + input.shapes.length + (input.ontologies?.length ?? 0) + (input.attachments?.length ?? 0) <= 64,
    'DCAT_SEMANTIC_PROFILE_LIMIT');
  const sources = [incomingFile(input.context, 'context'),
    ...input.shapes.map((value, index) => incomingFile(value, 'shape-' + index, true)),
    ...(input.ontologies ?? []).map((value, index) => incomingFile(value, 'ontology-' + index, true)),
    ...(input.attachments ?? []).map((value, index) => incomingFile(value, 'attachment-' + index))];
  need(sources.length <= 64 && sources.reduce((sum, file) => sum + file.raw.length, 0) <= DCAT_SEMANTIC_MAX_PROFILE,
    'DCAT_SEMANTIC_PROFILE_LIMIT', 'Select at most 64 files and 128 MiB of complete source.');
  let context; try { context = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(sources[0].raw)); }
  catch { throw fault('DCAT_SEMANTIC_CONTEXT_INVALID', 'Choose a local JSON object containing @context.'); }
  need(object(context) && Object.keys(context).length === 1 && Object.hasOwn(context, '@context'),
    'DCAT_SEMANTIC_CONTEXT_INVALID', 'Select a local context file containing only @context; retain profile documentation as attachments.');
  need(['require-absent', 'replace-root', 'preserve'].includes(input.contextMode), 'DCAT_SEMANTIC_CONTEXT_MODE_REQUIRED');
  const supersedesProfileId = input.supersedesProfileId ?? null;
  if (supersedesProfileId !== null) item(current.profiles, supersedesProfileId);
  const coverageClasses = input.coverageClasses ?? [];
  need(Array.isArray(coverageClasses) && coverageClasses.length <= 256, 'DCAT_SEMANTIC_COVERAGE_INVALID');
  const record = { id, label: clean(input.label, 'a semantic profile label', 512), createdAt: stamp(),
    supersedesProfileId, baseIRI: iri(input.baseIRI), contextMode: input.contextMode,
    context: sources[0].descriptor,
    shapes: sources.filter(file => file.descriptor.key.startsWith('shape-')).map(file => file.descriptor),
    ontologies: sources.filter(file => file.descriptor.key.startsWith('ontology-')).map(file => file.descriptor),
    attachments: sources.filter(file => file.descriptor.key.startsWith('attachment-')).map(file => file.descriptor),
    coverageClasses: [...new Set(coverageClasses.map(iri))], parameters: parameters(input.parameters) };
  return { record, sources };
}
function nativeSummary(result) {
  return { nativeStatus: result.status, snapshot: result.snapshot ?? null,
    validation: result.validation ?? null, coverage: result.coverage ?? null,
    findingsAvailable: Boolean(result.findings), engine: result.engine ?? null,
    semanticAcceptanceChangesCatalogRelease: false };
}
function validateNativeResult(result, runId) {
  need(object(result) && result.schema === 'stellar-forge.dcat-semantic-native-result.v1' &&
    result.runId === runId && TERMINAL.has(result.status) && Array.isArray(result.artifacts),
    'DCAT_SEMANTIC_NATIVE_RESULT_INVALID');
  need((result.receipts === undefined || Array.isArray(result.receipts)) &&
    result.artifacts.length + (result.receipts?.length ?? 0) <= 10000, 'DCAT_SEMANTIC_NATIVE_RESULT_INVALID');
  const keys = new Set();
  for (const file of [...result.artifacts, ...(result.receipts ?? [])]) {
    artifactRecord(file, runId); need(!keys.has(file.key), 'DCAT_SEMANTIC_ARTIFACT_INVALID'); keys.add(file.key);
  }
  if (result.findings) need(keys.has(result.findings.key) && result.findings.schema === 'commons-semantic-findings/1',
    'DCAT_SEMANTIC_FINDINGS_INVALID');
  return result;
}
export async function createDcatSemanticWorkspace({ directory, state, dcat, launch, persist, environment = process.env }) {
  need(state.dcat && typeof dcat?.dcatCatalogDownload === 'function', 'DCAT_SEMANTIC_WORKSPACE_REQUIRED');
  const initialized = state.dcat.semantic === undefined;
  if (initialized) state.dcat.semantic = empty();
  validateDcatSemanticState(state.dcat);
  const current = state.dcat.semantic, nativeRoot = join(directory, 'dcat', 'semantic', 'native');
  // The original native bridge is lazy: ordinary catalog reopen needs no Python process.
  const native = createDcatSemanticNative({ root: nativeRoot, environment: { ...environment } });
  async function saveFinal(row, result) {
    validateNativeResult(result, row.id);
    const artifacts = [...result.artifacts, ...(result.receipts ?? [])];
    for (const file of artifacts) await checkedArtifact(directory, file);
    const record = { ...row, status: result.status, completedAt: result.completedAt ?? stamp(),
      phase: null, result, artifacts, summary: nativeSummary(result) };
    delete record.runSha256;
    const saved = await writeRecord(directory, 'runs', record, 'runSha256');
    Object.assign(row, saved); await persist(); return clone(row);
  }
  async function unstarted(row, status, error) {
    try {
      await lstat(join(nativeRoot, row.id));
      throw fault('DCAT_SEMANTIC_RECOVERY_REQUIRED',
        'The retained native directory requires its complete original interruption inventory.', 409);
    } catch (issue) { if (issue.code !== 'ENOENT') throw issue; }
    return { schema: 'stellar-forge.dcat-semantic-native-result.v1', runId: row.id, status,
      requestSha256: null, engine: null, prepared: null, snapshot: null, coverage: null, validation: null,
      artifacts: [], startedAt: row.startedAt, completedAt: stamp(),
      error: { code: 'DCAT_SEMANTIC_NATIVE_NOT_STARTED',
        message: 'The saved attempt ended before the native run directory was created.',
        cause: error?.code ?? null } };
  }
  async function inspectOrUnstarted(row, status, error) {
    let inspected;
    try { inspected = await native.inspect(row.id); }
    catch (issue) {
      if (issue.code !== 'ENOENT') {
        // An inaccessible/corrupt existing directory is never replaced by an empty receipt.
        return unstarted(row, status, issue);
      }
    }
    if (inspected?.schema === 'stellar-forge.dcat-semantic-native-result.v1' &&
        inspected.runId === row.id && TERMINAL.has(inspected.status)) return inspected;
    return unstarted(row, status, error);
  }
  async function recover(row) {
    // A final record may have reached disk before its workbench state checkpoint.
    try {
      const raw = await readPrivate(join(directory, recordPath('runs', row.id)), MAX_RECORD);
      const record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
      need(record.id === row.id && record.profileId === row.profileId &&
        record.profileSha256 === row.profileSha256 &&
        digest(bytes(record.selection)) === digest(bytes(row.selection)) && TERMINAL.has(record.status),
        'DCAT_SEMANTIC_RECOVERY_CHANGED');
      validateNativeResult(record.result, row.id);
      for (const file of record.artifacts)
        await checkedArtifact(directory, file);
      Object.assign(row, record, { runSha256: digest(raw) }); await persist(); return;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return saveFinal(row, await inspectOrUnstarted(row, 'INTERRUPTED'));
  }
  for (const row of current.runs) if (row.status === 'RUNNING') await recover(row);
  if (initialized) await persist();
  async function readProfile(id, verifyFiles = true) {
    const row = item(current.profiles, id);
    await readRecord(directory, 'profiles', row, 'profileSha256');
    if (verifyFiles) for (const file of profileFiles(row))
      await checked(directory, assetPath(row.id, file.key), file.sha256, file.bytes, DCAT_SEMANTIC_MAX_FILE);
    return clone(row);
  }
  async function readRun(id, verifyFiles = true) {
    const row = item(current.runs, id);
    if (TERMINAL.has(row.status)) {
      await readRecord(directory, 'runs', row, 'runSha256');
      if (verifyFiles) for (const file of row.artifacts)
        await checkedArtifact(directory, file);
    }
    const reviews = current.reviews.filter(review => review.runId === id);
    for (const review of reviews) await readRecord(directory, 'reviews', review, 'reviewSha256');
    return { ...clone(row), reviews: reviews.map(clone) };
  }
  function selectedSource(input) {
    need(Boolean(input.catalogId) !== Boolean(input.reviewId), 'DCAT_SEMANTIC_SOURCE_REQUIRED',
      'Select one retained original catalog or one migration review candidate.');
    need(hash(input.expectedSourceSha256), 'DCAT_SEMANTIC_SOURCE_HASH_REQUIRED');
    const kind = input.catalogId ? 'catalog' : 'candidate';
    const row = item(kind === 'catalog' ? state.dcat.catalogs : state.dcat.reviews, input.catalogId ?? input.reviewId);
    const selection = { kind, id: row.id, sha256: kind === 'catalog' ? row.sha256 : row.candidateSha256,
      bytes: kind === 'catalog' ? row.bytes : row.candidateBytes, title: row.label,
      ...(kind === 'catalog' ? { origin: row.origin } : {
        sourceCatalogId: row.sourceId, reviewSha256: row.reviewSha256, reportSha256: row.reportSha256 }) };
    selectionRecord(selection, state.dcat);
    need(selection.bytes <= DCAT_SEMANTIC_MAX_FILE, 'DCAT_SEMANTIC_SOURCE_TOO_LARGE',
      'The original semantic worker accepts complete catalogs up to 64 MiB.');
    need(selection.sha256 === input.expectedSourceSha256, 'DCAT_SEMANTIC_SOURCE_CHANGED',
      'Review the current selected bytes and hash before starting semantic validation.', 409);
    return selection;
  }
  const download = (relative, selected, kind, name, id) => ({
    schema: 'stellar-forge.dcat-download.v1', id, kind, file: join(directory, relative),
    bytes: selected.bytes, sha256: selected.sha256, mediaType: selected.mediaType ?? 'application/octet-stream',
    hashHeader: 'x-dcat-sha256', downloadName: name,
  });
  const api = {
    importDcatSemanticProfile(input) {
      const id = randomUUID(), prepared = profileInput(input, id, current);
      const started = launch('retain semantic validation profile', async () => {
        await privateDirectory(join(directory, 'dcat'), true);
        await privateDirectory(join(directory, 'dcat', 'semantic'), true);
        await privateDirectory(join(directory, 'dcat', 'semantic', 'profile-files'), true);
        await privateDirectory(join(directory, 'dcat', 'semantic', 'profile-files', id), true);
        for (const file of prepared.sources)
          await writeExact(join(directory, assetPath(id, file.descriptor.key)), file.raw);
        const row = await writeRecord(directory, 'profiles', prepared.record, 'profileSha256');
        current.profiles.push(row); await persist(); return clone(row);
      });
      return { ...started, profileId: id };
    },
    startDcatSemanticRun(input) {
      need(object(input), 'DCAT_SEMANTIC_RUN_INVALID');
      const selected = item(current.profiles, input.profileId), selection = selectedSource(input);
      need(selected.profileSha256 === input.expectedProfileSha256, 'DCAT_SEMANTIC_PROFILE_CHANGED',
        'Select the exact retained semantic profile.', 409);
      const retryOf = input.retryOf ?? null;
      if (retryOf !== null) {
        const prior = item(current.runs, retryOf);
        need(TERMINAL.has(prior.status) && prior.profileSha256 === selected.profileSha256 &&
          digest(bytes(prior.selection)) === digest(bytes(selection)), 'DCAT_SEMANTIC_RETRY_CHANGED');
      }
      const row = { id: randomUUID(), profileId: selected.id, profileSha256: selected.profileSha256,
        selection, retryOf, limits: resourceLimits(input.limits), status: 'RUNNING', startedAt: stamp(), phase: 'PREPARING' };
      const started = launch('run retained semantic validation', async (signal, progress) => {
        const profile = await readProfile(selected.id);
        const source = selection.kind === 'catalog' ? await dcat.dcatCatalogDownload(selection.id) :
          await dcat.dcatReviewDownload(selection.id, 'candidate');
        need(source.sha256 === selection.sha256 && source.bytes === selection.bytes, 'DCAT_SEMANTIC_SOURCE_CHANGED');
        current.runs.push(row); await persist();
        const descriptor = file => ({ path: join(directory, assetPath(profile.id, file.key)),
          sha256: file.sha256, bytes: file.bytes, id: file.key, title: file.name,
          sourceReference: { profileId: profile.id, profileSha256: profile.profileSha256, key: file.key },
          ...(file.format ? { format: file.format } : {}) });
        try {
          const result = await native.run({ runId: row.id,
            profile: { id: profile.id, revision: 1, sha256: profile.profileSha256 },
            catalog: { path: source.file, id: selection.id, title: selection.title, sha256: selection.sha256,
              bytes: selection.bytes, sourceReference: selection },
            context: descriptor(profile.context), shapes: profile.shapes.map(descriptor),
            ontologies: profile.ontologies.map(descriptor), baseIRI: profile.baseIRI,
            contextMode: profile.contextMode, parameters: profile.parameters,
            coverageClasses: profile.coverageClasses, limits: row.limits },
          { signal, onUpdate: async update => {
            need(update.runId === row.id, 'DCAT_SEMANTIC_NATIVE_UPDATE_CHANGED');
            row.phase = update.phase ?? null; row.updatedAt = update.updatedAt ?? stamp();
            progress(clone(update)); await persist();
          } });
          return await saveFinal(row, result);
        } catch (error) {
          // The bridge owns child draining and inventories; preserve its terminal receipt before surfacing failure.
          const retained = await inspectOrUnstarted(row, signal.aborted ? 'CANCELLED' : 'FAILED', error);
          await saveFinal(row, retained);
          throw error;
        }
      });
      return { ...started, runId: row.id };
    },
    dcatSemanticProfile: id => readProfile(id),
    dcatSemanticRun: id => readRun(id),
    async dcatSemanticFindings({ runId, offset = 0, limit = 100, severity, search } = {}) {
      const run = await readRun(runId, false);
      need(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 500 &&
        (severity === undefined || typeof severity === 'string' && severity.length <= 4096) &&
        (search === undefined || typeof search === 'string' && search.length <= 4096), 'DCAT_SEMANTIC_FINDINGS_PAGE_INVALID');
      const result = { runId, runSha256: run.runSha256 ?? null, summary: run.summary ?? null,
        availability: run.result?.findings ? 'AVAILABLE' : run.status === 'RUNNING' ? 'PENDING' : 'UNAVAILABLE',
        findings: [], page: { offset, limit, total: 0, nextOffset: null } };
      if (!run.result?.findings) return result;
      const file = run.artifacts.find(file => file.key === run.result.findings.key);
      need(file && file.sha256 === run.result.findings.sha256 && file.bytes === run.result.findings.bytes,
        'DCAT_SEMANTIC_FINDINGS_INVALID');
      const raw = await checked(directory, 'dcat/semantic/native/' + file.path, file.sha256, file.bytes);
      const findings = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
      need(findings.schema === 'commons-semantic-findings/1' && Array.isArray(findings.findings),
        'DCAT_SEMANTIC_FINDINGS_INVALID');
      const needle = search?.toLocaleLowerCase();
      const rows = findings.findings.filter(row =>
        (!severity || (row.severity ?? []).some(value => value.value === severity)) &&
        (!needle || JSON.stringify(row).toLocaleLowerCase().includes(needle)));
      result.findings = rows.slice(offset, offset + limit);
      result.page = { offset, limit, total: rows.length, nextOffset: offset + limit < rows.length ? offset + limit : null };
      result.nativeSummary = Object.fromEntries(Object.entries(findings).filter(([key]) => key !== 'findings'));
      return result;
    },
    reviewDcatSemanticRun(input) {
      need(object(input) && DECISIONS.has(input.decision), 'DCAT_SEMANTIC_DECISION_INVALID');
      const id = randomUUID(), note = clean(input.note, 'the semantic review decision and scope', 16384);
      const started = launch('record semantic validation review', async () => {
        const run = await readRun(input.runId);
        need(TERMINAL.has(run.status) && hash(input.expectedRunSha256) &&
          input.expectedRunSha256 === run.runSha256, 'DCAT_SEMANTIC_RUN_CHANGED',
          'Inspect the exact completed semantic run before recording a decision.', 409);
        need(input.decision === 'ACKNOWLEDGE' || run.status === 'COMPLETE',
          'DCAT_SEMANTIC_RUN_INCOMPLETE', 'A failed or interrupted attempt can be acknowledged; rerun it for a validation decision.', 409);
        const previous = current.reviews.filter(row => row.runId === run.id).at(-1) ?? null;
        need(input.expectedReviewSha256 === (previous?.reviewSha256 ?? null), 'DCAT_SEMANTIC_REVIEW_CHANGED',
          'A later semantic review exists. Inspect it before adding your decision.', 409);
        const record = { id, runId: run.id, runSha256: run.runSha256, decision: input.decision,
          note, createdAt: stamp(), previousReviewId: previous?.id ?? null,
          previousReviewSha256: previous?.reviewSha256 ?? null };
        const saved = await writeRecord(directory, 'reviews', record, 'reviewSha256');
        current.reviews.push(saved); await persist(); return clone(saved);
      });
      return { ...started, semanticReviewId: id };
    },
    async dcatSemanticDownload({ kind, id, key } = {}) {
      if (kind === 'profile' || kind === 'run' || kind === 'review') {
        const plural = kind === 'profile' ? 'profiles' : kind === 'run' ? 'runs' : 'reviews';
        const field = kind === 'profile' ? 'profileSha256' : kind === 'run' ? 'runSha256' : 'reviewSha256';
        const row = item(current[plural], id);
        if (kind === 'run') need(TERMINAL.has(row.status), 'DCAT_SEMANTIC_RUN_INCOMPLETE', undefined, 409);
        await readRecord(directory, plural, row, field);
        const raw = await readPrivate(join(directory, recordPath(plural, id)), MAX_RECORD);
        return download(recordPath(plural, id), { bytes: raw.length, sha256: digest(raw),
          mediaType: 'application/json' }, kind, 'semantic-' + kind + '-' + id + '.json', id);
      }
      if (kind === 'profile-file') {
        const profile = await readProfile(id, false), file = profileFiles(profile).find(file => file.key === key);
        need(file, 'DCAT_SEMANTIC_FILE_NOT_FOUND', undefined, 404);
        await checked(directory, assetPath(id, key), file.sha256, file.bytes, DCAT_SEMANTIC_MAX_FILE);
        return download(assetPath(id, key), file, kind, file.name, id);
      }
      need(kind === 'artifact', 'DCAT_SEMANTIC_DOWNLOAD_KIND_INVALID');
      const run = await readRun(id, false), file = run.artifacts?.find(file => file.key === key);
      need(file, 'DCAT_SEMANTIC_FILE_NOT_FOUND', undefined, 404);
      await checkedArtifact(directory, file);
      return download('dcat/semantic/native/' + file.path, file, kind,
        file.downloadName ?? file.path.split('/').at(-1), id);
    },
  };
  const comparisons = await createDcatSemanticComparisons({ directory, state, launch, persist,
    native, readRun, readProfile });
  return { api: { ...api, ...comparisons }, close: () => native.close() };
}
