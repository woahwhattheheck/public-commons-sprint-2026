// MIT. Browser operations over the original SF88 object sessions and inbox.
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { config, execution } from '../config.mjs';
import { selectObjectDescription } from '../object-description.mjs';
import { createObjectSession, inspectObjectSession, runObjectSession,
  recoverObjectSession, assembleObjectSession, accountObjectSession } from '../object-session.mjs';
import { renderObjectReport } from '../object-report.mjs';
import { openObjectReceiving } from './intake.mjs';
import { createObjectWorkspaceRecovery } from './recovery.mjs';
import { acquireRunbookMetadataLease } from '../../buyer-runbook/runbook.mjs';

const PROFILE = 'stellar-forge.sf88.object-workspace.v1';
const SESSION = 'stellar-forge.sf88.object-session.v1';
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const MAX_ATOMIC = 170141183460469231731687303715884105727n;
const FINALIZED = new Set(['FINALIZED', 'IDEMPOTENT_FINALIZED']);
const ACCOUNTING_PAGE = 50;
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const sha = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const workspaceError = error => /^[A-Z0-9_]{1,120}$/.test(error?.code ?? '') ? error.code :
  /^[A-Z0-9_]{1,120}$/.test(error?.message ?? '') ? error.message : 'OBJECT_WORKSPACE_FAILED';
export function fail(code, status = 400) { throw Object.assign(new Error(code), { code, status }); }
const need = (condition, code, status = 400) => { if (!condition) fail(code, status); };
const privateInfo = info => process.platform === 'win32' || ((info.mode & 0o077) === 0 &&
  (typeof process.getuid !== 'function' || info.uid === process.getuid()));

function absolute(value) {
  need(typeof value === 'string' && isAbsolute(value) && resolve(value) === value &&
    !value.includes('\0') && value !== '/', 'OBJECT_WORKSPACE_ABSOLUTE_PATH_REQUIRED');
  return value;
}
async function privateDirectory(path, create = false) {
  absolute(path);
  if (create) {
    need(await realpath(dirname(path)) === dirname(path), 'OBJECT_WORKSPACE_REAL_PARENT_REQUIRED');
    try { await mkdir(path, { mode: 0o700 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const info = await lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() && privateInfo(info) &&
    await realpath(path) === path, 'OBJECT_WORKSPACE_PRIVATE_DIRECTORY_REQUIRED');
}
async function read(path, maxBytes, isPrivate = true) {
  const handle = await open(absolute(path), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) |
    (constants.O_NONBLOCK ?? 0));
  try {
    const before = await handle.stat({ bigint: true });
    need(before.isFile() && before.size <= BigInt(maxBytes), 'OBJECT_WORKSPACE_INPUT_SIZE');
    if (isPrivate) need(privateInfo(await handle.stat()), 'OBJECT_WORKSPACE_PRIVATE_FILE_REQUIRED');
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    need(bytes.length <= maxBytes && ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs']
      .every(key => before[key] === after[key]), 'OBJECT_WORKSPACE_INPUT_CHANGED');
    return bytes;
  } finally { await handle.close(); }
}
function json(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('OBJECT_WORKSPACE_JSON_INVALID'); }
}
function positive(value) {
  need(Number.isSafeInteger(value) && value > 0, 'OBJECT_WORKSPACE_CHUNK_SIZE_INVALID');
  return value;
}
function atomic(value) {
  need(typeof value === 'string' && /^(0|[1-9][0-9]{0,38})$/.test(value) &&
    BigInt(value) <= MAX_ATOMIC, 'OBJECT_WORKSPACE_ATOMIC_LIMIT_INVALID');
  return value;
}
function slug(value) {
  need(typeof value === 'string' && ID.test(value), 'OBJECT_WORKSPACE_SESSION_NAME_INVALID');
  return value;
}
function revision(report) {
  return sha(JSON.stringify([report.sessionId, report.configurationSha256, report.status,
    report.deliveryMode ?? 'chunks',
    report.completeChunks, report.attemptedChunks, report.objectSha256, report.lock ?? null,
    report.stoppedChunk ?? null, report.chunks.map(row => [row.index, row.state, row.attemptId,
      row.sha256, row.evidenceSha256, row.originalOutcome, row.code]),
    report.assemblies.map(row => [row.destination, row.sha256, row.chunkManifestSha256])]));
}
function summary(id, report) {
  return { id, sessionId: report.sessionId, name: report.selection?.filename ?? id,
    objectId: report.selection?.objectId ?? null, createdAt: report.createdAt, status: report.status,
    deliveryMode: report.deliveryMode ?? 'chunks',
    sourceUrl: report.sourceUrl,
    bytes: report.bytes, completeChunks: report.completeChunks, chunkCount: report.chunkCount,
    downloadedBytes: report.downloadedBytes, inspectedAt: report.inspectedAt ?? null };
}
function accountingRevision(record) {
  return sha(JSON.stringify([record.sessionId, record.configurationSha256,
    record.workspace, record.terms, record.range.total, record.deliveryMode ?? 'chunks']));
}
function accountingTotals(entries) {
  const value = { finalized: 0, unpaid: 0, unattempted: 0, attention: 0, actualAtomicUnits: '0' };
  let actual = 0n;
  for (const entry of entries) {
    if (FINALIZED.has(entry.outcome)) { value.finalized++; actual += BigInt(entry.actualAtomicUnits); }
    else if (entry.outcome === 'NO_PAYMENT_REQUIRED') value.unpaid++;
    else if (entry.outcome === 'NOT_ATTEMPTED') value.unattempted++;
    else value.attention++;
    if (FINALIZED.has(entry.outcome) && entry.viewStatus === 'SAVE_FAILED') value.attention++;
  }
  value.actualAtomicUnits = actual.toString(); return value;
}
const accountingIssue = entry => entry.viewStatus === 'SAVE_FAILED' ||
  !FINALIZED.has(entry.outcome) && !['NO_PAYMENT_REQUIRED', 'NOT_ATTEMPTED'].includes(entry.outcome);

/** The profile contains trusted local references. Browser actions select IDs only. */
export async function openObjectWorkspace({ stateDirectory, profilePath = null, operatorSettings } = {}) {
  const root = absolute(stateDirectory);
  await privateDirectory(root, true);
  const sessionsRoot = join(root, 'sessions'), outputsRoot = join(root, 'downloads'), inputsRoot = join(root, 'preparations');
  for (const path of [sessionsRoot, outputsRoot, inputsRoot]) await privateDirectory(path, true);
  const receiving = await openObjectReceiving({ directory: join(root, 'received'), operatorSettings });
  let profiles = [], profileSha256 = null;
  if (profilePath !== null) {
    const rawProfile = await read(profilePath, 262144), profile = json(rawProfile);
    profileSha256 = sha(rawProfile);
    need(object(profile) && profile.schema === PROFILE && Array.isArray(profile.products) &&
      profile.products.length <= 64 && Object.keys(profile).every(key => ['schema', 'products'].includes(key)),
    'OBJECT_WORKSPACE_PROFILE_INVALID');
    const ids = new Set();
    profiles = profile.products.map(product => {
      need(object(product) && Object.keys(product).every(key =>
        ['id', 'label', 'descriptionFile', 'objectId', 'configFile', 'workspace'].includes(key)),
      'OBJECT_WORKSPACE_PRODUCT_INVALID');
      slug(product.id); slug(product.objectId);
      need(!ids.has(product.id), 'OBJECT_WORKSPACE_PRODUCT_DUPLICATE'); ids.add(product.id);
      need(typeof product.label === 'string' && product.label.length > 0 && product.label.length <= 160 &&
        !/[\x00-\x1f\x7f]/.test(product.label), 'OBJECT_WORKSPACE_LABEL_INVALID');
      absolute(product.descriptionFile); absolute(product.configFile);
      need(product.workspace === undefined || product.workspace === null || typeof product.workspace === 'string',
        'OBJECT_WORKSPACE_OPERATOR_REFERENCE_INVALID');
      if (product.workspace) absolute(product.workspace);
      return { ...product, workspace: product.workspace ?? null };
    });
  }
  const index = new Map(), reports = new Map(), reviews = new Map(), dispatches = new Map(), finalizations = new Map();
  const finalizationIssues = new Map(), fileTransfers = new Map();
  let active = null, mutation = null, closed = false, closePromise, lastRecovery = null;
  const sessionPath = id => join(sessionsRoot, slug(id));
  const allProfiles = async () => {
    const values = [...profiles, ...await receiving.products()], counts = new Map();
    for (const value of values) counts.set(value.id, (counts.get(value.id) ?? 0) + 1);
    return values.map(value => counts.get(value.id) === 1 ? value :
      { ...value, error: 'OBJECT_WORKSPACE_PRODUCT_DUPLICATE' });
  };
  const chooseProfile = async id => (await allProfiles()).find(product => product.id === id) ?? fail('OBJECT_WORKSPACE_PRODUCT_NOT_FOUND', 404);
  const recovery = createObjectWorkspaceRecovery({ directory: root, profilePath, profileSha256,
    products: allProfiles, receiving });
  const assertOpen = () => need(!closed, 'OBJECT_WORKSPACE_CLOSED', 409);
  const assertIdle = () => { assertOpen(); need(!active && !mutation, 'OBJECT_WORKSPACE_BUSY', 409); };
  const retain = (id, report) => {
    reports.delete(id); reports.set(id, report); index.set(id, summary(id, report));
    while (reports.size > 8) {
      const candidate = reports.keys().next().value;
      if (candidate === active?.session) { const value = reports.get(candidate); reports.delete(candidate); reports.set(candidate, value); }
      else reports.delete(candidate);
    }
    return report;
  };
  async function scan() {
    const entries = await readdir(sessionsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!ID.test(entry.name)) continue;
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (index.has(entry.name)) continue;
      try {
        const definition = json(await read(join(sessionsRoot, entry.name, 'session.json'), 131072));
        need(definition.schema === SESSION && definition.directory === sessionPath(entry.name), 'OBJECT_SESSION_INVALID');
        index.set(entry.name, { id: entry.name, sessionId: definition.sessionId,
          name: definition.selection?.filename ?? entry.name, objectId: definition.selection?.objectId ?? null,
          sourceUrl: execution(definition.config).op.url,
          deliveryMode: definition.deliveryMode ?? 'chunks',
          createdAt: definition.createdAt, status: 'NEEDS_INSPECTION', bytes: definition.bytes,
          chunkCount: definition.chunkCount, completeChunks: null, downloadedBytes: null, inspectedAt: null });
      } catch (error) {
        index.set(entry.name, { id: entry.name, name: entry.name, status: 'INCOMPLETE_SETUP', error: workspaceError(error) });
      }
    }
  }
  async function inspect(id) {
    slug(id); need(index.has(id), 'OBJECT_WORKSPACE_SESSION_NOT_FOUND', 404);
    if (active?.session === id && active.kind === 'DOWNLOAD') return reports.get(id);
    return retain(id, await inspectObjectSession(sessionPath(id)));
  }
  async function original(id) { return reports.get(id) ?? inspect(id); }
  async function checked(id, expectedRevision) {
    const report = await inspect(id);
    need(typeof expectedRevision === 'string' && revision(report) === expectedRevision,
      'OBJECT_WORKSPACE_REVIEW_CHANGED', 409);
    return report;
  }
  async function selected(product, chunkBytes) {
    if (product.error) fail(product.error, 409);
    const before = await read(product.configFile, 65536);
    const source = await config(product.configFile), { op } = execution(source);
    const selection = await selectObjectDescription({ descriptionPath: product.descriptionFile,
      objectId: product.objectId, configPath: product.configFile, ...(chunkBytes ? { chunkBytes } : {}) });
    const after = await read(product.configFile, 65536);
    need(before.equals(after), 'OBJECT_WORKSPACE_INPUT_CHANGED', 409);
    const chunks = selection.deliveryMode === 'whole' ? 1 :
      Number((BigInt(selection.bytes) + BigInt(selection.chunkBytes) - 1n) / BigInt(selection.chunkBytes));
    need(chunks <= 100000, 'OBJECT_BYTE_PLAN_INVALID');
    return { product, source, selection, configurationSha256: sha(encode(source)), sourceSha256: sha(before),
      chunks, plannedMaxAtomic: (BigInt(op.expect.maxAtomic) * BigInt(chunks)).toString(),
      public: { id: product.id, label: product.label, objectId: product.objectId,
        deliveryMode: selection.deliveryMode ?? 'chunks',
        filename: selection.selection.filename, bytes: selection.bytes, chunkBytes: selection.chunkBytes,
        chunkCount: chunks, snapshot: selection.expectedSnapshot, expectedSha256: selection.expectedSha256,
        contentType: selection.expectedContentType, sourceUrl: op.url, terms: op.expect,
        operatorWorkspace: product.workspace !== null, descriptionSha256: selection.selection.descriptionSha256 } };
  }
  async function products() {
    return Promise.all((await allProfiles()).map(async product => {
      try { const value = await selected(product); return { ...value.public, plannedMaxAtomic: value.plannedMaxAtomic }; }
      catch (error) { return { id: product.id, label: product.label, error: workspaceError(error) }; }
    }));
  }
  function trimReviews() {
    for (const [id, review] of reviews) if (review.expires < Date.now()) reviews.delete(id);
    while (reviews.size >= 64) reviews.delete(reviews.keys().next().value);
  }
  async function reviewSelection({ productId, sessionName, chunkBytes, maxTotalAtomic } = {}) {
    assertIdle(); slug(sessionName); if (chunkBytes !== undefined) positive(chunkBytes);
    atomic(maxTotalAtomic); trimReviews();
    const value = await selected(await chooseProfile(productId), chunkBytes);
    need(BigInt(value.plannedMaxAtomic) <= BigInt(maxTotalAtomic), 'OBJECT_TOTAL_BUDGET_INSUFFICIENT');
    const reviewId = randomUUID(), expires = Date.now() + 15 * 60 * 1000;
    reviews.set(reviewId, { ...value, sessionName, maxTotalAtomic, expires });
    return { ...value.public, plannedMaxAtomic: value.plannedMaxAtomic, maxTotalAtomic, sessionName,
      reviewId, expiresAt: new Date(expires).toISOString(), configurationSha256: value.configurationSha256,
      firstRange: value.selection.deliveryMode === 'whole' ? null :
        { offset: 0, length: Math.min(value.selection.chunkBytes, value.selection.bytes) },
      lastRange: value.selection.deliveryMode === 'whole' ? null :
        { offset: (value.chunks - 1) * value.selection.chunkBytes,
          length: value.selection.bytes - (value.chunks - 1) * value.selection.chunkBytes } };
  }
  function matchesReview(report, review) {
    return report.configurationSha256 === review.configurationSha256 &&
      report.workspace === review.product.workspace && report.bytes === review.selection.bytes &&
      report.deliveryMode === (review.selection.deliveryMode ?? 'chunks') &&
      report.chunkBytes === review.selection.chunkBytes && report.expectedSnapshot === review.selection.expectedSnapshot &&
      report.expectedSha256 === review.selection.expectedSha256 &&
      report.expectedContentType === review.selection.expectedContentType &&
      report.maxTotalAtomic === review.maxTotalAtomic &&
      JSON.stringify(report.selection) === JSON.stringify(review.selection.selection);
  }
  async function create({ reviewId } = {}) {
    assertIdle(); const review = reviews.get(reviewId);
    need(review && review.expires > Date.now(), 'OBJECT_WORKSPACE_REVIEW_EXPIRED', 409);
    mutation = { kind: 'CREATE', session: review.sessionName };
    let release;
    try { release = await acquireRunbookMetadataLease(root); return await createReviewed(review); }
    finally { try { await release?.(); } finally { mutation = null; } }
  }
  async function createReviewed(review) {
    let temporary;
    try {
      // A lost successful response resolves to the same original directory.
      try {
        const existing = await inspectObjectSession(sessionPath(review.sessionName));
        need(matchesReview(existing, review), 'OBJECT_WORKSPACE_SESSION_NAME_OCCUPIED', 409);
        retain(review.sessionName, existing); return { session: review.sessionName, recoveredCreate: true };
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const fresh = await selected(review.product, review.selection.chunkBytes);
      need(fresh.sourceSha256 === review.sourceSha256 && fresh.configurationSha256 === review.configurationSha256 &&
        JSON.stringify(fresh.selection) === JSON.stringify(review.selection), 'OBJECT_WORKSPACE_REVIEW_CHANGED', 409);
      // The original initializer consumes this exact reviewed configuration;
      // later edits to the source path cannot change an already reviewed create.
      temporary = join(inputsRoot, randomUUID() + '.json');
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(encode(review.source)); await handle.sync(); } finally { await handle.close(); }
      const report = await createObjectSession({ directory: sessionPath(review.sessionName), configPath: temporary,
        workspace: review.product.workspace, maxTotalAtomic: review.maxTotalAtomic, ...review.selection });
      need(matchesReview(report, review), 'OBJECT_WORKSPACE_CREATED_PLAN_MISMATCH', 409);
      retain(review.sessionName, report); return { session: review.sessionName, recoveredCreate: false };
    } finally {
      if (temporary) await unlink(temporary).catch(() => {});
      await scan();
    }
  }
  async function receivingMutation(kind, action) {
    assertIdle(); mutation = { kind };
    let release;
    try { release = await acquireRunbookMetadataLease(root); return await action(); }
    finally { try { await release?.(); } finally { mutation = null; } }
  }
  async function createReceived(value) {
    return receivingMutation('CREATE_RECEIVED_OBJECT', async () => {
      const prepared = await receiving.provision(value), input = prepared.review;
      const reviewed = await selected(prepared.product, input.chunkBytes);
      need(JSON.stringify(reviewed.selection) === JSON.stringify(input.selected) &&
        JSON.stringify(reviewed.public.terms) === JSON.stringify(input.terms) &&
        reviewed.public.sourceUrl === input.sourceUrl, 'OBJECT_RECEIVING_REVIEW_CHANGED', 409);
      const result = await createReviewed({ ...reviewed, sessionName: input.sessionName, maxTotalAtomic: input.maxTotalAtomic });
      return { ...result, productId: prepared.product.id, nativeWorkspaceReopened: prepared.reopened };
    });
  }
  function runView(work) {
    if (!work) return null;
    return { id: work.id, session: work.session, kind: work.kind ?? 'DOWNLOAD', state: work.stopping ? 'STOPPING' : 'RUNNING',
      startedAt: work.startedAt, progressAt: work.progressAt, completeChunks: work.report?.completeChunks,
      chunkCount: work.report?.chunkCount ?? work.total, processedChunks: work.processed,
      totals: work.totals, currentOffset: work.offset, phase: work.phase,
      verifiedBytes: work.verifiedBytes, streamedBytes: work.streamedBytes, totalBytes: work.totalBytes };
  }
  function recoveryResult(result) {
    return { status: result.status, bundle: result.bundle, recordSha256: result.recordSha256,
      stateRoot: result.stateRoot, files: result.files, bytes: result.bytes, createdAt: result.createdAt,
      operators: result.operators?.length ?? 0, sessions: result.application?.sessions.length ?? 0,
      selectionRecord: result.selectionRecord, selectionRecordError: result.selectionRecordError,
      leaseReleaseErrors: result.leaseReleaseErrors };
  }
  async function inspectRecovery(input) {
    assertIdle(); mutation = { kind: 'REVIEW_BACKUP' };
    try { return await recovery.inspect(input); } finally { mutation = null; }
  }
  async function snapshotRecovery(input, context = {}) {
    assertIdle(); mutation = { kind: 'BACKUP' };
    try { return await recovery.snapshot(input, context); } finally { mutation = null; }
  }
  function startRecovery({ kind, actionId, ...input } = {}) {
    assertOpen(); need(['BACKUP', 'VERIFY_BACKUP'].includes(kind), 'OBJECT_RECOVERY_ACTION_REQUIRED');
    need(typeof actionId === 'string' && /^[a-f0-9-]{36}$/.test(actionId), 'OBJECT_WORKSPACE_ACTION_ID_REQUIRED');
    if (lastRecovery?.id === actionId) return lastRecovery;
    assertIdle();
    const controller = new AbortController(), work = { id: actionId, kind, session: null, controller,
      startedAt: now(), stopping: false, events: [] };
    active = work;
    const retainProgress = (status, extra = {}) => { lastRecovery = { ...runView(work), state: status,
      events: [...work.events], ...extra }; };
    retainProgress('RUNNING');
    const operation = kind === 'BACKUP' ? recovery.snapshot : recovery.verify;
    work.promise = operation(input, { signal: controller.signal, onProgress: event => {
      work.events.push({ ...event, at: now() }); if (work.events.length > 64) work.events.shift();
      work.progressAt = now(); work.phase = event.stage; retainProgress(work.stopping ? 'STOPPING' : 'RUNNING');
    } }).then(result => retainProgress('COMPLETED', { result: recoveryResult(result), endedAt: now() }),
      error => retainProgress(controller.signal.aborted ? 'STOPPED' : 'FAILED',
        { error: workspaceError(error), endedAt: now() }))
      .finally(() => { reports.clear(); if (active === work) active = null; });
    return runView(work);
  }
  async function recoveryState() {
    assertOpen(); return { directory: root, suggestedStateRoot: dirname(root),
      active: active && ['BACKUP', 'VERIFY_BACKUP'].includes(active.kind) ? runView(active) : null,
      last: lastRecovery, history: await recovery.history(), available: !active && !mutation };
  }
  async function readAccounting(session, offset = 0, limit = ACCOUNTING_PAGE) {
    slug(session); need(index.has(session), 'OBJECT_WORKSPACE_SESSION_NOT_FOUND', 404);
    const record = await accountObjectSession(sessionPath(session), { offset, limit });
    need(record.sessionId === index.get(session).sessionId, 'OBJECT_WORKSPACE_SESSION_CHANGED', 409);
    return record;
  }
  async function view({ session = null, page = 0, filter = 'all', query = '', section = 'delivery' } = {}) {
    assertOpen(); need(Number.isInteger(page) && page >= 0 && page <= 2000, 'OBJECT_WORKSPACE_PAGE_INVALID');
    need(['delivery', 'accounting'].includes(section), 'OBJECT_WORKSPACE_SECTION_INVALID');
    need(['all', 'QUEUED', 'VERIFIED', 'RECONCILIATION_REQUIRED'].includes(filter), 'OBJECT_WORKSPACE_FILTER_INVALID');
    need(typeof query === 'string' && query.length <= 160, 'OBJECT_WORKSPACE_QUERY_INVALID');
    const state = { sessions: [...index.values()].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || a.id.localeCompare(b.id)),
      selected: null, section, active: runView(active), mutation, updatedAt: now() };
    if (!session) return state;
    if (section === 'accounting') {
      // This path never inspects or hashes a delivered object. The native
      // accounting reader validates the saved plan, inbox and original views.
      const metadata = index.get(slug(session));
      need(metadata, 'OBJECT_WORKSPACE_SESSION_NOT_FOUND', 404);
      const pages = Math.max(1, Math.ceil((metadata.chunkCount ?? 0) / ACCOUNTING_PAGE));
      const selectedPage = Math.min(page, pages - 1), record = await readAccounting(session, selectedPage * ACCOUNTING_PAGE);
      const issues = finalizationIssues.get(session), checks = record.entries.flatMap(entry =>
        issues?.has(entry.index) ? [{ index: entry.index, ...issues.get(entry.index) }] : []);
      const totals = accountingTotals(record.entries);
      totals.attention += record.entries.filter(entry => issues?.has(entry.index) && !accountingIssue(entry)).length;
      state.selected = { ...metadata, section, status: 'PURCHASE_RECORDS',
        revision: accountingRevision(record), accounting: record, totals, lastCheckIssues: checks,
        lastFinalization: finalizations.get(session) ?? null,
        pagination: { page: selectedPage, pages: Math.max(1, Math.ceil(record.range.total / ACCOUNTING_PAGE)),
          total: record.range.total, pageSize: ACCOUNTING_PAGE },
        controls: { finalize: !active && !mutation && record.workspace !== null,
          stop: active?.session === session && ['FINALIZE', 'EXPORT'].includes(active.kind) && !active.stopping,
          refresh: !mutation, export: !active && !mutation } };
      state.active = runView(active); state.mutation = mutation; state.updatedAt = now();
      return state;
    }
    const report = await original(session), search = query.toLowerCase();
    const chunks = report.chunks.filter(chunk => (filter === 'all' || chunk.state === filter) &&
      (!search || [chunk.index, chunk.offset, chunk.length, chunk.intentId, chunk.state, chunk.code,
        chunk.sha256, chunk.originalOutcome?.status].some(value => String(value ?? '').toLowerCase().includes(search))));
    const pages = Math.max(1, Math.ceil(chunks.length / 50)), selectedPage = Math.min(page, pages - 1);
    const status = active?.session === session && active.kind === 'DOWNLOAD' ? (active.stopping ? 'STOPPING' : 'RUNNING') : report.status;
    const ownedOutput = assemblyRecord(session, report);
    state.selected = { ...summary(session, report), section, status, revision: revision(report),
      sourceUrl: report.sourceUrl, snapshot: report.expectedSnapshot, expectedSha256: report.expectedSha256,
      contentType: report.expectedContentType, limits: report.limits, terms: report.terms,
      capAllocatedAtomic: report.capAllocatedAtomic, attemptedChunks: report.attemptedChunks,
      objectSha256: report.objectSha256, selection: report.selection, lock: report.lock ?? null,
      stoppedChunk: report.stoppedChunk ? { index: report.stoppedChunk.index, code: report.stoppedChunk.code,
        intentId: report.stoppedChunk.intentId } : null,
      lastRun: dispatches.get(session) ?? null, lastFileTransfer: fileTransfers.get(session) ?? null,
      assembly: ownedOutput ? { name: basename(ownedOutput.destination), bytes: ownedOutput.bytes,
        sha256: ownedOutput.sha256, createdAt: ownedOutput.createdAt, status: 'RECORDED' } : null,
      chunks: chunks.slice(selectedPage * 50, selectedPage * 50 + 50).map(chunk => ({ index: chunk.index,
        offset: chunk.offset, length: chunk.length, intentId: chunk.intentId, state: chunk.state,
        sha256: chunk.sha256, code: chunk.code ?? null, outcome: chunk.originalOutcome?.status ?? null })),
      pagination: { page: selectedPage, pages, total: chunks.length, pageSize: 50 },
      controls: { run: !active && !mutation && ['READY', 'INTERRUPTED'].includes(report.status) && !report.lock,
        stop: active?.session === session && ['DOWNLOAD', 'FILE_DOWNLOAD'].includes(active.kind) && !active.stopping,
        recover: !active && !mutation && report.lock?.state !== 'ACTIVE' && report.lock?.state !== 'OTHER_HOST',
        assemble: !active && !mutation && report.status === 'COMPLETE' && !report.lock && !ownedOutput,
        download: Boolean(ownedOutput) && !active && !mutation,
        refresh: active?.session !== session && !mutation } };
    state.active = runView(active); state.mutation = mutation; state.updatedAt = now();
    return state;
  }
  async function refresh(session = null, section = 'delivery') {
    assertOpen(); need(!mutation, 'OBJECT_WORKSPACE_BUSY', 409);
    need(['delivery', 'accounting'].includes(section), 'OBJECT_WORKSPACE_SECTION_INVALID');
    await scan();
    if (session && section === 'delivery' && active?.session !== session) await inspect(session);
  }
  async function run({ session, expectedRevision, actionId } = {}) {
    assertOpen(); need(typeof actionId === 'string' && /^[a-f0-9-]{36}$/.test(actionId), 'OBJECT_WORKSPACE_ACTION_ID_REQUIRED');
    const previous = dispatches.get(session);
    if (previous?.id === actionId) return previous;
    assertIdle(); mutation = { kind: 'REVIEW_RUN', session };
    try {
      const report = await checked(session, expectedRevision);
      need(['READY', 'INTERRUPTED'].includes(report.status) && !report.lock, 'OBJECT_WORKSPACE_RUN_UNAVAILABLE', 409);
      const controller = new AbortController();
      const work = { id: actionId, kind: 'DOWNLOAD', session, controller, startedAt: now(), stopping: false, report };
      active = work; dispatches.set(session, { id: actionId, startedAt: work.startedAt, state: 'RUNNING' });
      work.promise = runObjectSession(sessionPath(session), { signal: controller.signal, onChunk: update => {
        const current = reports.get(session);
        current.chunks[update.chunk.index] = update.chunk;
        for (const key of ['status', 'completeChunks', 'completedChunks', 'attemptedChunks', 'downloadedBytes',
          'capAllocatedAtomic', 'nextChunk', 'stoppedChunk']) if (key in update) current[key] = update[key];
        current.inspectedAt = now(); work.progressAt = current.inspectedAt; work.report = current;
        retain(session, current);
      } }).then(result => {
        retain(session, result);
        dispatches.set(session, { id: actionId, startedAt: work.startedAt, endedAt: now(),
          state: result.status, interrupted: result.interrupted === true });
      }, async error => {
        let refreshed;
        try { refreshed = await inspectObjectSession(sessionPath(session)); retain(session, refreshed); } catch {}
        dispatches.set(session, { id: actionId, startedAt: work.startedAt, endedAt: now(),
          state: refreshed?.attemptedChunks ? 'RECONCILIATION_REQUIRED' : 'SETUP_REQUIRED', error: workspaceError(error) });
      }).finally(() => { if (active === work) active = null; });
      return { id: actionId, state: 'RUNNING', session };
    } finally { mutation = null; }
  }
  function stop({ session, runId } = {}) {
    assertOpen();
    if (!active && dispatches.get(session)?.id === runId) return dispatches.get(session);
    if (!active && finalizations.get(session)?.id === runId) return finalizations.get(session);
    if (!active && fileTransfers.get(session)?.id === runId) return fileTransfers.get(session);
    if (!active && session === null && lastRecovery?.id === runId) return lastRecovery;
    need(active?.session === session && active.id === runId, 'OBJECT_WORKSPACE_RUN_CHANGED', 409);
    active.stopping = true; active.controller.abort(); return runView(active);
  }
  async function finalize({ session, expectedRevision, actionId } = {}) {
    assertOpen(); need(typeof actionId === 'string' && /^[a-f0-9-]{36}$/.test(actionId), 'OBJECT_WORKSPACE_ACTION_ID_REQUIRED');
    const previous = finalizations.get(session);
    if (previous?.id === actionId) return previous;
    assertIdle(); mutation = { kind: 'REVIEW_FINALIZATION', session };
    try {
      const reviewed = await readAccounting(session, 0, 1), binding = accountingRevision(reviewed);
      need(binding === expectedRevision, 'OBJECT_WORKSPACE_REVIEW_CHANGED', 409);
      need(reviewed.workspace !== null, 'OBJECT_WORKSPACE_ACCOUNTING_WORKSPACE_REQUIRED', 409);
      const controller = new AbortController(), work = { id: actionId, kind: 'FINALIZE', session, controller,
        startedAt: now(), stopping: false, processed: 0, total: reviewed.range.total, offset: 0,
        totals: accountingTotals([]) };
      const issues = new Map(); finalizations.delete(session); finalizationIssues.delete(session);
      finalizationIssues.set(session, issues);
      while (finalizationIssues.size > 8) {
        const oldest = finalizationIssues.keys().next().value;
        finalizationIssues.delete(oldest); finalizations.delete(oldest);
      }
      const retainProgress = (state, extra = {}) => finalizations.set(session,
        { ...runView(work), state, ...extra });
      active = work; retainProgress('RUNNING');
      work.promise = (async () => {
        do {
          const record = await accountObjectSession(sessionPath(session), { finalize: true,
            offset: work.offset, limit: 10, signal: controller.signal });
          need(accountingRevision(record) === binding, 'OBJECT_WORKSPACE_REVIEW_CHANGED', 409);
          const counts = accountingTotals(record.entries);
          for (const entry of record.entries) if (accountingIssue(entry)) issues.set(entry.index,
            { outcome: entry.outcome, code: entry.code ?? entry.reason ?? entry.viewStatus,
              observedAt: record.observedAt });
          for (const key of ['finalized', 'unpaid', 'unattempted', 'attention']) work.totals[key] += counts[key];
          work.totals.actualAtomicUnits = (BigInt(work.totals.actualAtomicUnits) + BigInt(counts.actualAtomicUnits)).toString();
          work.processed += record.entries.length; work.offset = record.range.nextOffset; work.progressAt = now();
          retainProgress(controller.signal.aborted ? 'STOPPING' : 'RUNNING');
        } while (work.offset !== null && !controller.signal.aborted);
        retainProgress(controller.signal.aborted ? 'STOPPED' : work.totals.attention ? 'NEEDS_ATTENTION' : 'COMPLETE', { endedAt: now() });
      })().catch(error => retainProgress(controller.signal.aborted ? 'STOPPED' : 'NEEDS_ATTENTION',
        { error: workspaceError(error), endedAt: now() })).finally(() => { if (active === work) active = null; });
      return { id: actionId, kind: work.kind, state: 'RUNNING', session };
    } finally { mutation = null; }
  }
  async function openAccountingExport(session) {
    assertIdle(); mutation = { kind: 'PREPARE_ACCOUNTING_EXPORT', session };
    try {
      const first = await readAccounting(session), binding = accountingRevision(first);
      const controller = new AbortController(), work = { id: randomUUID(), kind: 'EXPORT', session, controller,
        startedAt: now(), stopping: false, processed: 0, total: first.range.total };
      let resolveFinished, finished = false;
      work.promise = new Promise(resolve => { resolveFinished = resolve; });
      const finish = () => { if (!finished) { finished = true; if (active === work) active = null; resolveFinished(); } };
      active = work;
      async function* records() {
        let record = first;
        try {
          while (true) {
            need(!controller.signal.aborted, 'OBJECT_WORKSPACE_EXPORT_INTERRUPTED');
            need(accountingRevision(record) === binding, 'OBJECT_WORKSPACE_SESSION_CHANGED', 409);
            yield Buffer.from(JSON.stringify(record) + '\n');
            work.processed += record.entries.length; work.progressAt = now();
            if (record.range.nextOffset === null) break;
            record = await readAccounting(session, record.range.nextOffset);
          }
        } finally { finish(); }
      }
      return { name: slug(session) + '.accounting.jsonl', body: records(), signal: controller.signal, finish };
    } finally { mutation = null; }
  }
  async function recover({ session, expectedRevision } = {}) {
    assertIdle(); mutation = { kind: 'RECOVER', session };
    try { await checked(session, expectedRevision); retain(session, await recoverObjectSession(sessionPath(session))); }
    finally { mutation = null; }
  }
  function destination(id, report) {
    const name = report.selection?.filename ?? 'object.bin';
    need(typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9_. -]{0,119}$/.test(name) &&
      !/[. ]$/.test(name), 'OBJECT_WORKSPACE_FILENAME_INVALID');
    return join(outputsRoot, slug(id), name);
  }
  function assemblyRecord(id, report) {
    const target = destination(id, report);
    return report.assemblies.find(item => item.destination === target) ??
      (report.assembly?.destination === target && report.assembly?.status === 'SAVED' ? report.assembly : null);
  }
  async function assemble({ session, expectedRevision } = {}) {
    assertIdle(); mutation = { kind: 'ASSEMBLE', session };
    try {
      const report = await checked(session, expectedRevision);
      if (assemblyRecord(session, report)) return;
      const target = destination(session, report); await privateDirectory(dirname(target), true);
      retain(session, await assembleObjectSession(sessionPath(session), target));
    } finally { mutation = null; }
  }
  async function exportReport(session, kind) {
    need(['json', 'html'].includes(kind), 'OBJECT_WORKSPACE_EXPORT_INVALID');
    need(!active && !mutation, 'OBJECT_WORKSPACE_BUSY', 409);
    const report = await inspect(session);
    return { bytes: kind === 'html' ? Buffer.from(renderObjectReport(report)) : encode(report),
      name: slug(session) + (kind === 'html' ? '.html' : '.json'),
      type: kind === 'html' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8' };
  }
  async function openDownload(session, { signal } = {}) {
    assertIdle(); slug(session); need(index.has(session), 'OBJECT_WORKSPACE_SESSION_NOT_FOUND', 404);
    const controller = new AbortController(), work = { id: randomUUID(), kind: 'FILE_DOWNLOAD', session,
      controller, startedAt: now(), stopping: false, phase: 'VERIFYING', verifiedBytes: 0, streamedBytes: 0 };
    let handle, handleClose, finishPromise, prepared = false, release;
    work.promise = new Promise(resolveFinished => { release = resolveFinished; });
    // Reserve before the first awaited read. Two live download links cannot
    // both start hashing, and close() owns preparation as well as the stream.
    active = work;
    const closeHandle = () => handle ? handleClose ??= handle.close() : Promise.resolve();
    const stopped = () => Object.assign(new Error('OBJECT_WORKSPACE_DOWNLOAD_STOPPED'),
      { code: 'OBJECT_WORKSPACE_DOWNLOAD_STOPPED', status: 409 });
    const check = () => { if (controller.signal.aborted) throw stopped(); };
    const abortFromRequest = () => controller.abort();
    const finish = error => {
      if (finishPromise) return finishPromise;
      finishPromise = (async () => {
        let failure = error;
        try { await closeHandle(); } catch (closeError) { failure ??= closeError; }
        signal?.removeEventListener('abort', abortFromRequest);
        controller.signal.removeEventListener('abort', abortRead);
        const result = { ...runView(work), endedAt: now(),
          state: controller.signal.aborted ? 'STOPPED' : failure ? 'FAILED' : 'COMPLETED',
          ...(failure && !controller.signal.aborted ? { error: workspaceError(failure) } : {}) };
        fileTransfers.delete(session); fileTransfers.set(session, result);
        while (fileTransfers.size > 8) fileTransfers.delete(fileTransfers.keys().next().value);
        if (active === work) active = null;
        release(); return result;
      })();
      return finishPromise;
    };
    function abortRead() {
      work.stopping = true;
      // FileHandle.close waits only for an in-flight bounded read. The next
      // read checks cancellation; a suspended consumer cannot retain the fd.
      void closeHandle().catch(() => {});
      if (prepared) void finish(stopped());
    }
    controller.signal.addEventListener('abort', abortRead, { once: true });
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', abortFromRequest, { once: true });
    try {
      check(); const report = await original(session); check();
      const record = assemblyRecord(session, report);
      need(record && HASH.test(record.sha256), 'OBJECT_WORKSPACE_ASSEMBLY_REQUIRED', 409);
      work.totalBytes = record.bytes;
      const path = destination(session, report); await privateDirectory(dirname(path)); check();
      handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)); check();
      const before = await handle.stat({ bigint: true }), info = await handle.stat();
      check();
      need(info.isFile() && info.nlink === 1 && info.size === record.bytes && privateInfo(info),
        'OBJECT_WORKSPACE_SAVED_FILE_CHANGED', 409);
      const unchanged = after => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => before[key] === after[key]);
      const hash = createHash('sha256'), buffer = Buffer.alloc(65536); let offset = 0;
      while (offset < record.bytes) {
        check();
        const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, record.bytes - offset), offset);
        check();
        need(bytesRead > 0, 'OBJECT_WORKSPACE_SAVED_FILE_CHANGED', 409);
        hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
        work.verifiedBytes = offset; work.progressAt = now();
      }
      const after = await handle.stat({ bigint: true }); check();
      need(hash.digest('hex') === record.sha256 && unchanged(after), 'OBJECT_WORKSPACE_SAVED_FILE_CHANGED', 409);
      work.phase = 'STREAMING'; work.progressAt = now(); prepared = true;
      const body = (async function* () {
        const streamedHash = createHash('sha256'); let position = 0, complete = false;
        try {
          while (position < record.bytes) {
            check();
            // A distinct bounded buffer keeps a yielded block stable while
            // the HTTP pipeline applies backpressure to the next read.
            const block = Buffer.allocUnsafe(Math.min(65536, record.bytes - position));
            const { bytesRead } = await handle.read(block, 0, block.length, position); check();
            need(bytesRead > 0, 'OBJECT_WORKSPACE_SAVED_FILE_CHANGED', 409);
            position += bytesRead; streamedHash.update(block.subarray(0, bytesRead));
            if (position === record.bytes) {
              const finalInfo = await handle.stat({ bigint: true }); check();
              // Retain the final block until the bytes actually streamed
              // match the recorded file. A changed file ends incomplete.
              need(streamedHash.digest('hex') === record.sha256 && unchanged(finalInfo),
                'OBJECT_WORKSPACE_SAVED_FILE_CHANGED', 409);
            }
            work.streamedBytes = position; work.progressAt = now();
            yield block.subarray(0, bytesRead);
          }
          complete = true;
        } catch (error) {
          const failure = controller.signal.aborted ? stopped() : error;
          await finish(failure); throw failure;
        } finally {
          if (!complete) await finish(Object.assign(new Error('OBJECT_WORKSPACE_DOWNLOAD_INTERRUPTED'),
            { code: 'OBJECT_WORKSPACE_DOWNLOAD_INTERRUPTED' }));
        }
      })();
      // The HTTP owner calls finish after pipeline completion, including when
      // a disconnected request never starts consuming the body.
      return { body, signal: controller.signal, finish, bytes: record.bytes, sha256: record.sha256, name: basename(path) };
    } catch (error) {
      const failure = controller.signal.aborted ? stopped() : error;
      await finish(failure); throw failure;
    }
  }
  async function close() {
    if (closePromise) return closePromise;
    closed = true;
    closePromise = (async () => {
      while (active || mutation) {
        if (active) { active.stopping = true; active.controller.abort(); await active.promise; }
        else await new Promise(resolve => setTimeout(resolve, 20));
      }
      reviews.clear();
    })();
    return closePromise;
  }
  await scan();
  return { products, reviewSelection, create, view, refresh, run, stop, recover, assemble,
    finalize, openAccountingExport, exportReport, openDownload, close,
    inspectRecovery, snapshotRecovery, startRecovery, recoveryState,
    receivingState: () => { assertOpen(); return receiving.state(); },
    receivingOptions: (id, objectId) => { assertOpen(); return receiving.options(id, objectId); },
    receive: value => receivingMutation('RECEIVE_OBJECT', () => receiving.receive(value)),
    reviewReceived: value => receivingMutation('REVIEW_RECEIVED_OBJECT', () => receiving.review(value)), createReceived };
}
