// MIT. Saved native graph comparisons and operator decisions in the original DCAT workspace.
import { join } from 'node:path';
import { lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { object, bytes, digest, readPrivate, hashPrivate, createFile, privateDirectory, fault, stamp }
  from '../postgres/publisher/files.mjs';

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/, HASH = /^[a-f0-9]{64}$/;
const TERMINAL = new Set(['COMPLETE', 'FAILED', 'CANCELLED', 'INTERRUPTED']);
const DECISIONS = new Set(['ACCEPT', 'CHANGES_REQUIRED', 'ACKNOWLEDGE']);
const MAX_RECORD = 16777216, MAX_ARTIFACT = 2147483648, MAX_PRESENT = 67108864;
const need = (ok, code = 'DCAT_SEMANTIC_COMPARISON_INVALID', message, status = 400) => {
  if (!ok) throw fault(code, message, status);
};
const clone = value => structuredClone(value);
const hash = value => typeof value === 'string' && HASH.test(value);
const uuid = value => typeof value === 'string' && UUID.test(value);
const same = (a, b) => digest(bytes(a)) === digest(bytes(b));
const count = (value, maximum = MAX_ARTIFACT) => Number.isSafeInteger(value) && value >= 0 && value <= maximum;
const item = (rows, id) => {
  need(uuid(id), 'DCAT_SEMANTIC_COMPARISON_NOT_FOUND', undefined, 404);
  const row = rows.find(value => value.id === id);
  need(row, 'DCAT_SEMANTIC_COMPARISON_NOT_FOUND', undefined, 404);
  return row;
};
function relative(path) {
  need(typeof path === 'string' && path.length <= 4096 && !path.includes('\\') && !path.includes('\0') &&
    path.split('/').every(piece => piece && piece !== '.' && piece !== '..'),
    'DCAT_SEMANTIC_COMPARISON_PATH_INVALID');
  return path;
}
function absoluteIRI(value) {
  need(typeof value === 'string' && value.length > 0 && value.length <= 4096 &&
    /^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|\\^`]*$/.test(value),
    'DCAT_SEMANTIC_COMPARISON_PREDICATE_INVALID');
  let parsed; try { parsed = new URL(value); } catch { throw fault('DCAT_SEMANTIC_COMPARISON_PREDICATE_INVALID'); }
  need(!parsed.username && !parsed.password, 'DCAT_SEMANTIC_COMPARISON_PREDICATE_INVALID');
  return value;
}
function parameters(value = {}) {
  need(object(value), 'DCAT_SEMANTIC_COMPARISON_PARAMETERS_INVALID');
  const result = { edge_predicates: value.edge_predicates ?? [], depth: value.depth ?? 2,
    node_limit: value.node_limit ?? 100000 };
  need(Array.isArray(result.edge_predicates) && result.edge_predicates.length <= 256 &&
    new Set(result.edge_predicates).size === result.edge_predicates.length &&
    Number.isSafeInteger(result.depth) && result.depth >= 0 && result.depth <= 20 &&
    Number.isSafeInteger(result.node_limit) && result.node_limit >= 1 && result.node_limit <= 100000,
    'DCAT_SEMANTIC_COMPARISON_PARAMETERS_INVALID');
  result.edge_predicates.forEach(absoluteIRI);
  return { ...result, edge_predicates: [...result.edge_predicates].sort() };
}
function limits(value = {}) {
  need(object(value), 'DCAT_SEMANTIC_COMPARISON_LIMITS_INVALID');
  const result = { timeout_seconds: value.timeout_seconds ?? 120, memory_mib: value.memory_mib ?? 1024 };
  need(Number.isSafeInteger(result.timeout_seconds) && result.timeout_seconds >= 5 && result.timeout_seconds <= 600 &&
    Number.isSafeInteger(result.memory_mib) && result.memory_mib >= 256 && result.memory_mib <= 4096,
    'DCAT_SEMANTIC_COMPARISON_LIMITS_INVALID');
  return result;
}
function artifact(file, id) {
  need(object(file) && hash(file.key) && hash(file.sha256) && count(file.bytes) &&
    typeof file.mediaType === 'string' && file.mediaType.length <= 256 && !/[\r\n\0]/.test(file.mediaType),
    'DCAT_SEMANTIC_COMPARISON_ARTIFACT_INVALID');
  relative(file.path);
  need(file.path.startsWith(id + '/') && digest(Buffer.from(file.path, 'utf8')) === file.key,
    'DCAT_SEMANTIC_COMPARISON_ARTIFACT_INVALID');
}
function snapshotReceipt(receipt, id, action) {
  need(object(receipt) && receipt.schema === 'commons-semantic-native-result/1' &&
    receipt.action === action && receipt.job_id === id + '-' + action &&
    Number.isSafeInteger(receipt.generation) && receipt.generation > 0 &&
    Array.isArray(receipt.files) && object(receipt.summary),
    'DCAT_SEMANTIC_COMPARISON_SNAPSHOT_INVALID', 'Choose an original completed snapshot and its full provenance.', 409);
  return receipt;
}
function selectedOutput(row, receipt, name, action) {
  const selected = receipt.files.filter(value => value.path === name);
  need(selected.length === 1, 'DCAT_SEMANTIC_COMPARISON_OUTPUT_INVALID');
  const source = selected[0];
  need(hash(source.sha256) && count(source.bytes), 'DCAT_SEMANTIC_COMPARISON_OUTPUT_INVALID');
  const path = row.id + '/native-jobs/' + action + '/attempts/' + receipt.generation + '/outputs/' + name;
  const matches = (row.artifacts ?? []).filter(value => value.path === path);
  need(matches.length === 1 && matches[0].sha256 === source.sha256 && matches[0].bytes === source.bytes,
    'DCAT_SEMANTIC_COMPARISON_OUTPUT_INVALID', 'The original output must match its complete native receipt.', 409);
  artifact(matches[0], row.id);
  return matches[0];
}
function sideRecord(side, semantic) {
  need(object(side) && uuid(side.runId) && hash(side.runSha256) && hash(side.profileSha256) &&
    hash(side.nativeResultSha256) && object(side.snapshot), 'DCAT_SEMANTIC_COMPARISON_SOURCE_INVALID');
  const run = item(semantic.runs, side.runId), profile = item(semantic.profiles, side.profileId);
  need(TERMINAL.has(run.status) && run.runSha256 === side.runSha256 && run.profileId === profile.id &&
    run.profileSha256 === side.profileSha256 && profile.profileSha256 === side.profileSha256 &&
    same(run.selection, side.selection) && profile.baseIRI === side.baseIRI &&
    run.result?.resultSha256 === side.nativeResultSha256,
    'DCAT_SEMANTIC_COMPARISON_SOURCE_CHANGED', 'Inspect both exact retained runs before comparing.', 409);
  const receipt = snapshotReceipt(run.result?.snapshot, run.id, 'snapshot');
  for (const [key, name] of [['graph', 'graph.nt'], ['provenance', 'provenance.json']]) {
    const original = selectedOutput(run, receipt, name, 'snapshot'), selected = side.snapshot[key];
    const nativeFile = receipt.files.find(file => file.path === name);
    need(nativeFile.role === (key === 'graph' ? 'graph' : 'provenance') &&
      (key !== 'graph' || receipt.summary.provenance_complete === true &&
        receipt.summary.graph_sha256 === original.sha256), 'DCAT_SEMANTIC_COMPARISON_SNAPSHOT_INVALID');
    need(object(selected) && selected.path === original.path && selected.key === original.key &&
      selected.bytes === original.bytes && selected.sha256 === original.sha256 &&
      selected.bytes <= MAX_PRESENT, 'DCAT_SEMANTIC_COMPARISON_SOURCE_CHANGED');
  }
}
function immutableSide(value) {
  if (!object(value) || !object(value.snapshot)) return null;
  return { runId: value.runId, runSha256: value.runSha256, profileId: value.profileId,
    profileSha256: value.profileSha256, selection: value.selection, baseIRI: value.baseIRI,
    nativeResultSha256: value.nativeResultSha256,
    snapshot: Object.fromEntries(['graph', 'provenance'].map(key => [key, {
      key: value.snapshot[key]?.key, sha256: value.snapshot[key]?.sha256, bytes: value.snapshot[key]?.bytes }])) };
}
function nativeResult(result, row) {
  need(object(result) && result.schema === 'stellar-forge.dcat-semantic-native-result.v1' &&
    result.runId === row.id && TERMINAL.has(result.status) && Array.isArray(result.artifacts) &&
    (result.receipts === undefined || Array.isArray(result.receipts)), 'DCAT_SEMANTIC_COMPARISON_NATIVE_INVALID');
  const files = [...result.artifacts, ...(result.receipts ?? [])];
  need(files.length <= 10000 && new Set(files.map(file => file.key)).size === files.length,
    'DCAT_SEMANTIC_COMPARISON_NATIVE_INVALID');
  files.forEach(file => artifact(file, row.id));
  if (result.kind === 'comparison') {
    need(same(immutableSide(result.before), immutableSide(row.before)) &&
      same(immutableSide(result.after), immutableSide(row.after)), 'DCAT_SEMANTIC_COMPARISON_NATIVE_CHANGED');
  } else {
    // The unchanged native inspector can retain an interrupted attempt before its request was written.
    need(result.status !== 'COMPLETE' && result.kind === undefined && !result.comparison &&
      !result.snapshot && !result.validation, 'DCAT_SEMANTIC_COMPARISON_NATIVE_INVALID');
  }
  if (result.status === 'COMPLETE') {
    const receipt = snapshotReceipt(result.comparison, row.id, 'compare');
    need(receipt.summary.before_sha256 === row.before.snapshot.graph.sha256 &&
      receipt.summary.after_sha256 === row.after.snapshot.graph.sha256 &&
      receipt.summary.graph_difference_complete === true && receipt.summary.provenance_complete === true &&
      receipt.summary.impact_depth === row.parameters.depth &&
      receipt.summary.impact_node_limit === row.parameters.node_limit &&
      same(receipt.summary.edge_predicates, row.parameters.edge_predicates),
      'DCAT_SEMANTIC_COMPARISON_NATIVE_CHANGED');
    const holder = { id: row.id, artifacts: files };
    for (const name of ['changes.jsonl', 'impact-relationships.jsonl', 'impact.json'])
      selectedOutput(holder, receipt, name, 'compare');
  }
  return files;
}
function recordPath(kind, id) {
  need(['comparisons', 'comparison-reviews'].includes(kind) && uuid(id));
  return 'dcat/semantic/' + kind + '/' + id + '.json';
}
async function readRecord(directory, kind, row, field) {
  const raw = await readPrivate(join(directory, recordPath(kind, row.id)), MAX_RECORD);
  need(digest(raw) === row[field], 'DCAT_SEMANTIC_COMPARISON_RECORD_CHANGED', undefined, 409);
  let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch { throw fault('DCAT_SEMANTIC_COMPARISON_RECORD_INVALID'); }
  const expected = { ...row }; delete expected[field];
  need(same(value, expected), 'DCAT_SEMANTIC_COMPARISON_RECORD_CHANGED', undefined, 409);
  return { ...value, [field]: row[field] };
}
async function writeRecord(directory, kind, row, field) {
  const raw = bytes(row); need(raw.length <= MAX_RECORD, 'DCAT_SEMANTIC_COMPARISON_RECORD_TOO_LARGE');
  await privateDirectory(join(directory, 'dcat'), true);
  await privateDirectory(join(directory, 'dcat', 'semantic'), true);
  await privateDirectory(join(directory, 'dcat', 'semantic', kind), true);
  const path = join(directory, recordPath(kind, row.id));
  try { await createFile(path, raw); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    need((await readPrivate(path, MAX_RECORD)).equals(raw), 'DCAT_SEMANTIC_COMPARISON_RECORD_EXISTS', undefined, 409);
  }
  return { ...row, [field]: digest(raw) };
}
async function checkedArtifact(directory, file) {
  const actual = await hashPrivate(join(directory, 'dcat', 'semantic', 'native', relative(file.path)), MAX_ARTIFACT);
  need(actual.hash === file.sha256 && actual.bytes === file.bytes,
    'DCAT_SEMANTIC_COMPARISON_FILE_CHANGED', 'The retained native file differs from its complete receipt.', 409);
}
function summary(result) {
  return { nativeStatus: result.status, comparison: result.comparison?.summary ?? null,
    impact: result.impact ?? null, engine: result.engine ?? null,
    graphDifferenceComplete: result.comparison?.summary?.graph_difference_complete === true,
    impactTruncated: result.comparison?.summary?.impact_truncated ?? null,
    operatorAcceptanceChangesCatalogRelease: false };
}
export function validateDcatSemanticComparisons(dcat) {
  const value = dcat?.semantic;
  if (!value) return;
  for (const key of ['comparisons', 'comparisonReviews']) {
    need(value[key] === undefined || Array.isArray(value[key]), 'DCAT_SEMANTIC_COMPARISON_STATE_INVALID');
    const ids = new Set();
    for (const row of value[key] ?? []) {
      need(object(row) && uuid(row.id) && !ids.has(row.id), 'DCAT_SEMANTIC_COMPARISON_STATE_INVALID');
      ids.add(row.id);
    }
  }
  const prior = new Set();
  for (const row of value.comparisons ?? []) {
    sideRecord(row.before, value); sideRecord(row.after, value); parameters(row.parameters); limits(row.limits);
    need(typeof row.startedAt === 'string' && (row.status === 'RUNNING' || TERMINAL.has(row.status)) &&
      (row.retryOf === null || prior.has(row.retryOf)), 'DCAT_SEMANTIC_COMPARISON_STATE_INVALID');
    if (TERMINAL.has(row.status)) {
      need(hash(row.comparisonSha256) && typeof row.completedAt === 'string' && Array.isArray(row.artifacts),
        'DCAT_SEMANTIC_COMPARISON_STATE_INVALID');
      need(row.status === row.result?.status && same(nativeResult(row.result, row), row.artifacts),
        'DCAT_SEMANTIC_COMPARISON_STATE_INVALID');
    }
    prior.add(row.id);
  }
  const reviews = new Map();
  for (const row of value.comparisonReviews ?? []) {
    const selected = item(value.comparisons ?? [], row.comparisonId), previous = reviews.get(row.comparisonId) ?? null;
    need(TERMINAL.has(selected.status) && row.comparisonSha256 === selected.comparisonSha256 &&
      DECISIONS.has(row.decision) && typeof row.note === 'string' && row.note.trim() && row.note.length <= 16384 &&
      typeof row.createdAt === 'string' && hash(row.reviewSha256) &&
      (row.decision === 'ACKNOWLEDGE' || selected.status === 'COMPLETE') &&
      row.previousReviewId === (previous?.id ?? null) &&
      row.previousReviewSha256 === (previous?.reviewSha256 ?? null), 'DCAT_SEMANTIC_COMPARISON_REVIEW_INVALID');
    reviews.set(row.comparisonId, row);
  }
}
export async function validateDcatSemanticComparisonFiles(directory, dcat) {
  validateDcatSemanticComparisons(dcat);
  for (const row of dcat?.semantic?.comparisons ?? []) {
    need(TERMINAL.has(row.status), 'DCAT_SEMANTIC_COMPARISON_ACTIVE',
      'Finish or interrupt the active comparison before transferring the workspace.', 409);
    await readRecord(directory, 'comparisons', row, 'comparisonSha256');
    for (const file of row.artifacts) await checkedArtifact(directory, file);
  }
  for (const row of dcat?.semantic?.comparisonReviews ?? [])
    await readRecord(directory, 'comparison-reviews', row, 'reviewSha256');
}
export function dcatSemanticComparisonSummary(dcat) {
  const value = dcat?.semantic;
  return {
    comparisons: (value?.comparisons ?? []).map(({ id, before, after, status, comparisonSha256, summary, startedAt, completedAt }) =>
      ({ id, before, after, status, comparisonSha256, summary, startedAt, completedAt })),
    comparisonReviews: (value?.comparisonReviews ?? []).map(({ id, comparisonId, comparisonSha256, reviewSha256, decision, previousReviewId }) =>
      ({ id, comparisonId, comparisonSha256, reviewSha256, decision, previousReviewId })),
  };
}
export async function createDcatSemanticComparisons({
  directory, state, launch, persist, native, readRun, readProfile,
}) {
  const current = state.dcat.semantic, nativeRoot = join(directory, 'dcat', 'semantic', 'native');
  const initialized = current.comparisons === undefined || current.comparisonReviews === undefined;
  current.comparisons ??= []; current.comparisonReviews ??= [];
  validateDcatSemanticComparisons(state.dcat);
  async function final(row, result) {
    const artifacts = nativeResult(result, row);
    for (const file of artifacts) await checkedArtifact(directory, file);
    const record = { ...row, status: result.status, completedAt: result.completedAt ?? stamp(), phase: null,
      result, artifacts, summary: summary(result) };
    delete record.comparisonSha256;
    Object.assign(row, await writeRecord(directory, 'comparisons', record, 'comparisonSha256'));
    await persist(); return clone(row);
  }
  async function interrupted(row, status, error) {
    let result;
    try { result = await native.inspect(row.id); }
    catch (issue) {
      try {
        await lstat(join(nativeRoot, row.id));
        throw fault('DCAT_SEMANTIC_COMPARISON_RECOVERY_REQUIRED',
          'Preserve and inspect the complete existing native comparison directory before reopening.', 409);
      } catch (missing) { if (missing.code !== 'ENOENT') throw missing; }
      error = issue;
    }
    if (result?.schema === 'stellar-forge.dcat-semantic-native-result.v1' &&
        result.runId === row.id && TERMINAL.has(result.status)) return result;
    try {
      await lstat(join(nativeRoot, row.id));
      throw fault('DCAT_SEMANTIC_COMPARISON_RECOVERY_REQUIRED', undefined, 409);
    } catch (missing) { if (missing.code !== 'ENOENT') throw missing; }
    return { schema: 'stellar-forge.dcat-semantic-native-result.v1', runId: row.id, kind: 'comparison', status,
      before: clone(row.before), after: clone(row.after), requestSha256: null, comparison: null, impact: null,
      engine: null, artifacts: [], receipts: [], startedAt: row.startedAt, completedAt: stamp(),
      error: { code: 'DCAT_SEMANTIC_NATIVE_NOT_STARTED', cause: error?.code ?? null,
        message: 'The saved comparison ended before its native directory was created.' } };
  }
  for (const row of current.comparisons) if (row.status === 'RUNNING') {
    let recovered = false;
    try {
      const raw = await readPrivate(join(directory, recordPath('comparisons', row.id)), MAX_RECORD);
      const record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
      need(record.id === row.id && same(record.before, row.before) && same(record.after, row.after) &&
        same(record.parameters, row.parameters) && same(record.limits, row.limits) &&
        record.retryOf === row.retryOf && record.startedAt === row.startedAt &&
        TERMINAL.has(record.status) && record.status === record.result?.status,
        'DCAT_SEMANTIC_COMPARISON_RECOVERY_CHANGED');
      need(same(nativeResult(record.result, row), record.artifacts), 'DCAT_SEMANTIC_COMPARISON_RECOVERY_CHANGED');
      for (const file of record.artifacts) await checkedArtifact(directory, file);
      Object.assign(row, record, { comparisonSha256: digest(raw) }); await persist(); recovered = true;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!recovered) await final(row, await interrupted(row, 'INTERRUPTED'));
  }
  if (initialized) await persist();
  async function read(id, verifyFiles = true) {
    const row = item(current.comparisons, id);
    if (TERMINAL.has(row.status)) {
      await readRecord(directory, 'comparisons', row, 'comparisonSha256');
      if (verifyFiles) for (const file of row.artifacts) await checkedArtifact(directory, file);
    }
    const reviews = current.comparisonReviews.filter(value => value.comparisonId === id);
    for (const review of reviews) await readRecord(directory, 'comparison-reviews', review, 'reviewSha256');
    return { ...clone(row), reviews: reviews.map(clone), currentReview: clone(reviews.at(-1) ?? null) };
  }
  function select(id, expected) {
    const run = item(current.runs, id), profile = item(current.profiles, run.profileId);
    need(hash(expected) && run.runSha256 === expected && TERMINAL.has(run.status),
      'DCAT_SEMANTIC_COMPARISON_SOURCE_CHANGED', 'Select both exact terminal snapshot runs.', 409);
    const receipt = snapshotReceipt(run.result?.snapshot, id, 'snapshot');
    const descriptor = name => {
      const file = selectedOutput(run, receipt, name, 'snapshot');
      return { path: file.path, key: file.key, bytes: file.bytes, sha256: file.sha256 };
    };
    const side = { runId: id, runSha256: run.runSha256, profileId: profile.id,
      profileSha256: profile.profileSha256, selection: clone(run.selection), baseIRI: profile.baseIRI,
      nativeResultSha256: run.result?.resultSha256,
      snapshot: { graph: descriptor('graph.nt'), provenance: descriptor('provenance.json') } };
    sideRecord(side, current); return side;
  }
  async function nativeSide(side) {
    await readRun(side.runId); await readProfile(side.profileId);
    sideRecord(side, current);
    return { ...clone(side), snapshot: Object.fromEntries(Object.entries(side.snapshot).map(([key, file]) =>
      [key, { ...file, path: join(nativeRoot, file.path) }])) };
  }
  const download = (path, file, kind, id, name) => ({
    schema: 'stellar-forge.dcat-download.v1', id, kind, file: join(directory, path),
    bytes: file.bytes, sha256: file.sha256, mediaType: file.mediaType ?? 'application/json',
    hashHeader: 'x-dcat-sha256', downloadName: name,
  });
  return {
    startDcatSemanticComparison(input) {
      need(object(input));
      const before = select(input.beforeRunId, input.expectedBeforeRunSha256),
        after = select(input.afterRunId, input.expectedAfterRunSha256), chosen = parameters(input.parameters),
        resources = limits(input.limits), retryOf = input.retryOf ?? null;
      if (retryOf !== null) {
        const prior = item(current.comparisons, retryOf);
        need(TERMINAL.has(prior.status) && same(prior.before, before) && same(prior.after, after) &&
          same(prior.parameters, chosen), 'DCAT_SEMANTIC_COMPARISON_RETRY_CHANGED');
      }
      const row = { id: randomUUID(), before, after, parameters: chosen, limits: resources, retryOf,
        status: 'RUNNING', startedAt: stamp(), phase: 'PREPARING' };
      const started = launch('compare retained semantic snapshots', async (signal, progress) => {
        const selectedBefore = await nativeSide(before), selectedAfter = await nativeSide(after);
        current.comparisons.push(row); await persist();
        try {
          const result = await native.compare({ runId: row.id, before: selectedBefore, after: selectedAfter,
            parameters: row.parameters, limits: row.limits }, {
            signal, onUpdate: async update => {
              need(update.runId === row.id, 'DCAT_SEMANTIC_COMPARISON_UPDATE_CHANGED');
              row.phase = update.phase ?? null; row.updatedAt = update.updatedAt ?? stamp();
              progress(clone(update)); await persist();
            },
          });
          return await final(row, result);
        } catch (error) {
          await final(row, await interrupted(row, signal.aborted ? 'CANCELLED' : 'FAILED', error));
          throw error;
        }
      });
      return { ...started, comparisonId: row.id };
    },
    dcatSemanticComparison: id => read(id),
    async dcatSemanticComparisonRows({ comparisonId, section, offset = 0, limit = 100, search, change, snapshot } = {}) {
      need(['changes', 'nodes', 'relationships'].includes(section) &&
        Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 500 &&
        (search === undefined || typeof search === 'string' && search.length <= 4096) &&
        (change === undefined || section === 'changes' && ['added', 'removed'].includes(change)) &&
        (snapshot === undefined || section !== 'nodes' && ['before', 'after'].includes(snapshot)),
        'DCAT_SEMANTIC_COMPARISON_PAGE_INVALID');
      const row = await read(comparisonId, false), result = {
        comparisonId, comparisonSha256: row.comparisonSha256 ?? null, section,
        rows: [], page: { offset, limit, total: null, nextOffset: null }, summary: row.summary ?? null,
        availability: row.status === 'RUNNING' ? 'PENDING' : 'UNAVAILABLE', artifact: null,
      };
      if (!row.result?.comparison) return result;
      const receipt = snapshotReceipt(row.result.comparison, row.id, 'compare');
      const name = section === 'changes' ? 'changes.jsonl' : section === 'nodes' ? 'impact.json' : 'impact-relationships.jsonl';
      const file = selectedOutput(row, receipt, name, 'compare');
      result.artifact = clone(file);
      if (file.bytes > MAX_PRESENT) {
        await checkedArtifact(directory, file); result.availability = 'DOWNLOAD_REQUIRED'; return result;
      }
      const raw = await readPrivate(join(nativeRoot, file.path), MAX_PRESENT);
      need(raw.length === file.bytes && digest(raw) === file.sha256, 'DCAT_SEMANTIC_COMPARISON_FILE_CHANGED', undefined, 409);
      let parsed;
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
        if (section === 'nodes') {
          const document = JSON.parse(text);
          need(document.schema === 'commons-semantic-impact/1' && Array.isArray(document.nodes),
            'DCAT_SEMANTIC_COMPARISON_ROWS_INVALID');
          parsed = document.nodes;
        } else parsed = text.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
      } catch (error) {
        if (error.code) throw error;
        throw fault('DCAT_SEMANTIC_COMPARISON_ROWS_INVALID', 'Inspect the retained original comparison file.');
      }
      need(parsed.every(object), 'DCAT_SEMANTIC_COMPARISON_ROWS_INVALID');
      const needle = search?.toLowerCase(), selected = parsed.filter(value =>
        (change === undefined || value.change === change) && (snapshot === undefined || value.snapshot === snapshot) &&
        (!needle || JSON.stringify(value).toLowerCase().includes(needle)));
      result.availability = 'AVAILABLE'; result.rows = selected.slice(offset, offset + limit);
      result.page = { offset, limit, total: selected.length,
        nextOffset: offset + limit < selected.length ? offset + limit : null };
      return result;
    },
    reviewDcatSemanticComparison(input) {
      need(object(input) && DECISIONS.has(input.decision) && typeof input.note === 'string' &&
        input.note.trim() && input.note.length <= 16384 && !input.note.includes('\0'),
        'DCAT_SEMANTIC_COMPARISON_DECISION_INVALID');
      const id = randomUUID(), note = input.note.trim();
      const started = launch('record semantic comparison review', async () => {
        const selected = await read(input.comparisonId);
        need(TERMINAL.has(selected.status) && hash(input.expectedComparisonSha256) &&
          input.expectedComparisonSha256 === selected.comparisonSha256,
          'DCAT_SEMANTIC_COMPARISON_CHANGED', 'Inspect the complete saved comparison before recording its review.', 409);
        need(input.decision === 'ACKNOWLEDGE' || selected.status === 'COMPLETE',
          'DCAT_SEMANTIC_COMPARISON_INCOMPLETE', 'A failed or interrupted attempt can be acknowledged.', 409);
        const previous = current.comparisonReviews.filter(value => value.comparisonId === selected.id).at(-1) ?? null;
        need(input.expectedReviewSha256 === (previous?.reviewSha256 ?? null),
          'DCAT_SEMANTIC_COMPARISON_REVIEW_CHANGED', 'Inspect the latest comparison decision before adding a review.', 409);
        const saved = await writeRecord(directory, 'comparison-reviews', { id,
          comparisonId: selected.id, comparisonSha256: selected.comparisonSha256, decision: input.decision,
          note, createdAt: stamp(), previousReviewId: previous?.id ?? null,
          previousReviewSha256: previous?.reviewSha256 ?? null }, 'reviewSha256');
        current.comparisonReviews.push(saved); await persist(); return clone(saved);
      });
      return { ...started, semanticComparisonReviewId: id };
    },
    async dcatSemanticComparisonDownload({ kind, id, key } = {}) {
      if (kind === 'comparison' || kind === 'review') {
        const plural = kind === 'comparison' ? 'comparisons' : 'comparison-reviews',
          field = kind === 'comparison' ? 'comparisonSha256' : 'reviewSha256',
          row = item(kind === 'comparison' ? current.comparisons : current.comparisonReviews, id);
        if (kind === 'comparison') need(TERMINAL.has(row.status), 'DCAT_SEMANTIC_COMPARISON_INCOMPLETE', undefined, 409);
        await readRecord(directory, plural, row, field);
        const path = recordPath(plural, id), raw = await readPrivate(join(directory, path), MAX_RECORD);
        return download(path, { bytes: raw.length, sha256: digest(raw) }, kind, id, 'semantic-' + kind + '-' + id + '.json');
      }
      need(kind === 'artifact', 'DCAT_SEMANTIC_COMPARISON_DOWNLOAD_INVALID');
      const row = await read(id, false), file = row.artifacts?.find(value => value.key === key);
      need(file, 'DCAT_SEMANTIC_COMPARISON_FILE_NOT_FOUND', undefined, 404);
      await checkedArtifact(directory, file);
      return download('dcat/semantic/native/' + file.path, file, kind, id,
        file.downloadName ?? file.path.split('/').at(-1));
    },
  };
}
