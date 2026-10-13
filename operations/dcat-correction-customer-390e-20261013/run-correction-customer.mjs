// MIT. Continue the actual saved GSA comparison case through correction and independent receiving.
import { readFile, mkdir, open, lstat, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { runDcatCorrectionBrowser, inspectDcatCorrectionBrowser } from './run-correction-browser.mjs';
const PREFIX = 'stellar/scf-starforge-20261009/sf30-seller-sdk/ckan';
const OPERATION = 'SCF-DCAT-CORRECTION-WORKBENCH-390E-20261013';
const HASH = /^[a-f0-9]{64}$/, UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const sha = raw => createHash('sha256').update(raw).digest('hex');
const encoded = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const same = (a, b) => encoded(a).equals(encoded(b));
const need = (value, code, message = code) => { if (!value) throw Object.assign(new Error(message), { code }); };
const safeError = error => ({ code: error?.code ?? error?.name ?? 'CORRECTION_CUSTOMER_FAILED',
  message: String(error?.message ?? error).replace(/https?:\/\/127\.0\.0\.1:\d+\/?#[^\s"']+/g, '[private listener]').slice(0, 4000) });
async function exists(path) {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function executableIdentity(selected) {
  const path = await realpath(selected), handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    need(before.isFile() && before.size <= 2147483648, 'CORRECTION_CUSTOMER_RUNTIME_FILE_REQUIRED');
    const hash = createHash('sha256'), buffer = Buffer.alloc(1048576); let bytes = 0;
    for (;;) {
      const next = await handle.read(buffer, 0, buffer.length, bytes);
      if (!next.bytesRead) break;
      bytes += next.bytesRead; need(bytes <= 2147483648, 'CORRECTION_CUSTOMER_RUNTIME_FILE_SIZE');
      hash.update(buffer.subarray(0, next.bytesRead));
    }
    const after = await handle.stat();
    need(bytes === before.size && before.size === after.size && before.mtimeMs === after.mtimeMs &&
      before.ctimeMs === after.ctimeMs && await realpath(selected) === path, 'CORRECTION_CUSTOMER_RUNTIME_FILE_CHANGED');
    return { selected, path, bytes, sha256: hash.digest('hex') };
  } finally { await handle.close(); }
}

function normalized(value) {
  const result = structuredClone(value);
  result.corrections ??= { schema: 'stellar-forge.dcat-corrections.v1', drafts: [] };
  result.corrections.pending ??= [];
  return result;
}
function stripOwned(value, correctionId, catalogId, reviewId) {
  const result = normalized(value);
  if (correctionId) result.corrections.drafts = result.corrections.drafts.filter(row => row.id !== correctionId);
  if (catalogId) result.catalogs = result.catalogs.filter(row => row.id !== catalogId);
  if (reviewId) result.reviews = result.reviews.filter(row => row.id !== reviewId);
  return result;
}
/**
 * Receives the exact following archive of the completed semantic comparison course.
 * The original comparison project remains unchanged. No migration or RDF job is repeated.
 * One new review compares the original current catalogue with its byte-identical restored candidate.
 */
export async function runDcatCorrectionCustomer({
  sourceRoot, comparisonOutputDirectory, expectedComparisonResultSha256, outputDirectory,
  archiveFile, python, runtimeProfile = 'original', playwrightModule, chromiumPath,
  author, sourceCommit = null, timeoutMs = 120000, signal, playwright,
} = {}) {
  for (const path of [sourceRoot, comparisonOutputDirectory, outputDirectory, python, chromiumPath])
    need(typeof path === 'string' && isAbsolute(path), 'CORRECTION_CUSTOMER_ABSOLUTE_PATH_REQUIRED');
  need(playwright || typeof playwrightModule === 'string' && isAbsolute(playwrightModule), 'CORRECTION_CUSTOMER_PLAYWRIGHT_REQUIRED');
  need(archiveFile === undefined || typeof archiveFile === 'string' && isAbsolute(archiveFile), 'CORRECTION_CUSTOMER_ARCHIVE_PATH_REQUIRED');
  need(HASH.test(expectedComparisonResultSha256 ?? ''), 'CORRECTION_CUSTOMER_COMPARISON_HASH_REQUIRED');
  need(['original', 'portable-python312'].includes(runtimeProfile), 'CORRECTION_CUSTOMER_RUNTIME_PROFILE');
  need(typeof author === 'string' && author.trim() && author.length <= 160, 'CORRECTION_CUSTOMER_AUTHOR_REQUIRED');
  author = author.trim();
  need(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 600000, 'CORRECTION_CUSTOMER_TIMEOUT');
  for (const path of [sourceRoot, comparisonOutputDirectory, outputDirectory]) need(resolve(path) === path, 'CORRECTION_CUSTOMER_CANONICAL_PATH_REQUIRED');
  need(outputDirectory !== comparisonOutputDirectory && !outputDirectory.startsWith(comparisonOutputDirectory + '/') &&
    !comparisonOutputDirectory.startsWith(outputDirectory + '/'), 'CORRECTION_CUSTOMER_SEPARATE_OUTPUT_REQUIRED');
  signal?.throwIfAborted();
  const ckan = join(sourceRoot, PREFIX);
  const files = await import(pathToFileURL(join(ckan, '../postgres/publisher/files.mjs')).href);
  const { openCkanWorkbench } = await import(pathToFileURL(join(ckan, 'model.mjs')).href);
  const { startCkanServer } = await import(pathToFileURL(join(ckan, 'server.mjs')).href);
  const { receiveCkanWorkspaceArchive } = await import(pathToFileURL(join(ckan, 'archive.mjs')).href);
  const { validateDcatSemanticFiles } = await import(pathToFileURL(join(ckan, 'dcat-semantic.mjs')).href);
  const { validateDcatCorrectionFiles } = await import(pathToFileURL(join(ckan, 'dcat-corrections.mjs')).href);
  const { parseCkanJson } = await import(pathToFileURL(join(ckan, 'capture.mjs')).href);
  const rawResult = await files.readPrivate(join(comparisonOutputDirectory, 'result.json'), 67108864);
  need(sha(rawResult) === expectedComparisonResultSha256, 'CORRECTION_CUSTOMER_COMPARISON_RESULT_CHANGED');
  const comparison = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawResult));
  need(comparison.schema === 'commons.dcat-semantic-comparison-customer-result.v1' &&
    comparison.operation === 'DCAT-SEMANTIC-COMPARISON-390E-20261013' && comparison.complete === true &&
    comparison.scenarios?.length === 3 && comparison.scenarios.every(row => row.status === 'COMPLETE') &&
    comparison.cleanup?.length && comparison.cleanup.every(row => row.closed === true), 'CORRECTION_CUSTOMER_COMPLETED_COMPARISON_REQUIRED');
  const ordered = comparison.scenarios.find(row => row.name === 'ordered-editions');
  need(ordered && UUID.test(ordered.comparisonId) && HASH.test(ordered.comparisonSha256) &&
    UUID.test(ordered.after?.runId) && HASH.test(ordered.after?.runSha256), 'CORRECTION_CUSTOMER_ORIGINAL_CURRENT_RUN_REQUIRED');
  const previousArchive = comparison.followingArchive;
  need(previousArchive && UUID.test(previousArchive.id) && HASH.test(previousArchive.sha256) &&
    Number.isSafeInteger(previousArchive.bytes) && previousArchive.bytes > 0, 'CORRECTION_CUSTOMER_FOLLOWING_ARCHIVE_REQUIRED');
  const selectedArchiveFile = resolve(archiveFile ?? previousArchive.file);
  const selectedArchiveHash = await files.hashPrivate(selectedArchiveFile, 8589934592);
  need(selectedArchiveHash.hash === previousArchive.sha256 && selectedArchiveHash.bytes === previousArchive.bytes,
    'CORRECTION_CUSTOMER_ORIGINAL_ARCHIVE_CHANGED');
  const environment = { ...process.env, SCF_DCAT_PYTHON: python, SCF_DCAT_RUNTIME_PROFILE: runtimeProfile };
  await files.privateDirectory(outputDirectory, true);
  const out = outputDirectory, producerDirectory = join(out, 'producer'), recipientDirectory = join(out, 'recipient');
  const declared = { schema: 'commons.dcat-correction-customer-selection.v1', operation: OPERATION,
    sourceRoot, sourceCommit, comparisonOutputDirectory, expectedComparisonResultSha256,
    archive: { id: previousArchive.id, file: selectedArchiveFile, sha256: previousArchive.sha256, bytes: previousArchive.bytes },
    outputDirectory, producerDirectory, recipientDirectory, python, runtimeProfile,
    playwrightModule: playwrightModule ?? null, chromiumPath, author, timeoutMs,
    currentRun: { id: ordered.after.runId, sha256: ordered.after.runSha256 },
    originalComparison: { id: ordered.comparisonId, sha256: ordered.comparisonSha256 } };
  async function retain(path, raw) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const h = await open(path, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    try {
      const s = await h.stat();
      need(s.isFile() && s.nlink === 1 && !(s.mode & 0o077) && s.size <= raw.length, 'CORRECTION_CUSTOMER_OUTPUT_CHANGED', path);
      const old = Buffer.alloc(s.size); let at = 0;
      while (at < old.length) {
        const part = await h.read(old, at, old.length - at, at);
        need(part.bytesRead > 0, 'CORRECTION_CUSTOMER_OUTPUT_CHANGED'); at += part.bytesRead;
      }
      need(old.equals(raw.subarray(0, old.length)), 'CORRECTION_CUSTOMER_OUTPUT_CHANGED', path);
      while (at < raw.length) {
        const part = await h.write(raw, at, raw.length - at, at);
        need(part.bytesWritten > 0, 'CORRECTION_CUSTOMER_OUTPUT_WRITE_FAILED'); at += part.bytesWritten;
      }
      await h.sync();
    } finally { await h.close(); }
  }
  await retain(join(out, 'selection.json'), encoded(declared));
  await retain(join(out, 'original-comparison-result.json'), rawResult);
  let ledger = { schema: 'commons.dcat-correction-customer-progress.v1', operation: OPERATION, phases: {} };
  if (await exists(join(out, 'progress.json'))) ledger = await files.readJson(join(out, 'progress.json'), 67108864);
  else need(!(await exists(join(out, 'producer-before-corrections.json'))), 'CORRECTION_CUSTOMER_PROGRESS_MISSING',
    'Restore the original progress journal before continuing this output directory.');
  need(ledger.schema === 'commons.dcat-correction-customer-progress.v1' && ledger.operation === OPERATION, 'CORRECTION_CUSTOMER_PROGRESS_CHANGED');
  const save = (name, value) => files.atomicJson(out, name, value), persist = () => save('progress.json', ledger);
  await persist();
  const result = { schema: 'commons.dcat-correction-customer-result.v1', operation: OPERATION,
    startedAt: new Date().toISOString(), complete: false, comparisonResultSha256: expectedComparisonResultSha256,
    originalArchive: declared.archive, source: [], runtime: null, producerReceiving: null, catalog: null,
    browser: null, correction: null, review: null, downloads: [], archive: null, receiving: null,
    coldReopen: null, reopenedBrowser: null, followingArchive: null, errors: [], cleanup: [],
    presentation: { ready: false, reason: 'The producing operator must actually inspect the recorded desktop/narrow images and every delivered attachment before client-ready presentation.' } };
  const owners = { producer: { model: null, listener: null }, recipient: { model: null, listener: null } };
  async function closeOwner(name) {
    const owned = owners[name];
    if (owned.listener) {
      try { await owned.listener.close(); owned.listener = null; result.cleanup.push({ owner: name + '-listener', closed: true }); }
      catch (error) { result.cleanup.push({ owner: name + '-listener', closed: false, error: safeError(error) }); throw error; }
    }
    if (owned.model) {
      try { await owned.model.close(); owned.model = null; result.cleanup.push({ owner: name + '-workspace', closed: true }); }
      catch (error) { result.cleanup.push({ owner: name + '-workspace', closed: false, error: safeError(error) }); throw error; }
    }
  }
  async function openOwner(name, withListener = false) {
    need(!owners[name].model && !owners[name].listener, 'CORRECTION_CUSTOMER_OWNER_ALREADY_OPEN');
    const directory = name === 'producer' ? producerDirectory : recipientDirectory;
    owners[name].model = await openCkanWorkbench({ directory, sourceKind: 'dcat-us', environment });
    need(!owners[name].model.status().active, 'CORRECTION_CUSTOMER_OWNER_BUSY');
    if (withListener) owners[name].listener = await startCkanServer({ workbench: owners[name].model, port: 0 });
    return owners[name].model;
  }
  async function phase({ name, model, kind, request, collection, selectionKey, start, get, matches }) {
    signal?.throwIfAborted();
    let entry = ledger.phases[name];
    if (!entry) {
      need(!model.status().active, 'CORRECTION_CUSTOMER_OWNER_BUSY');
      const rows = collection === 'archives' ? await model.workspaceArchives() : model.status().dcat[collection];
      entry = { kind, request, requestSha256: sha(encoded(request)), collection, selectionKey,
        priorIds: rows.map(row => row.id), beforeOperationId: model.status().operation?.id ?? null,
        preparedAt: new Date().toISOString(), complete: false };
      ledger.phases[name] = entry; await persist();
      const started = start(request);
      need(started && UUID.test(started.id) && started.completion, 'CORRECTION_CUSTOMER_LAUNCH_REQUIRED');
      entry.selection = Object.fromEntries(Object.entries(started).filter(([key]) => key !== 'completion'));
      await persist();
      const abort = () => { if (model.status().active === started.id) model.cancel(); };
      signal?.addEventListener('abort', abort, { once: true });
      try { if (signal?.aborted) abort(); entry.operation = await started.completion; }
      finally { signal?.removeEventListener('abort', abort); }
      await save('operation-' + entry.operation.id + '.json', entry.operation); await persist();
    }
    need(entry.kind === kind && entry.collection === collection && entry.selectionKey === selectionKey &&
      same(entry.request, request) && entry.requestSha256 === sha(encoded(entry.request)), 'CORRECTION_CUSTOMER_PHASE_CHANGED');
    let id = entry.result?.id ?? (selectionKey ? entry.selection?.[selectionKey] : null);
    if (!id) {
      const operation = entry.operation ?? model.status().operation, candidate = operation?.result?.id;
      need(operation && operation.id !== entry.beforeOperationId && (!entry.selection || operation.id === entry.selection.id) &&
        operation.kind === kind && operation.state === 'COMPLETE' && UUID.test(candidate) && !entry.priorIds.includes(candidate),
        'CORRECTION_CUSTOMER_ADMISSION_UNCERTAIN',
        'The original phase has no authoritative returned item ID. Preserve its intent and original operation; do not create a replacement.');
      id = candidate; entry.operation = operation;
      entry.selection = { ...(entry.selection ?? {}), id: operation.id, ...(selectionKey ? { [selectionKey]: id } : {}) };
      await persist();
    }
    need(UUID.test(id) && !entry.priorIds.includes(id), 'CORRECTION_CUSTOMER_PHASE_ID_CHANGED');
    const actual = await get(id);
    need(actual?.id === id && matches(actual, request), 'CORRECTION_CUSTOMER_PHASE_INCOMPLETE_OR_CHANGED');
    if (entry.result) need(same(entry.result, actual), 'CORRECTION_CUSTOMER_PHASE_RESULT_CHANGED');
    entry.result = actual; entry.complete = true; await persist(); return actual;
  }
  async function copyDescriptor(descriptor, scope, name) {
    need(HASH.test(descriptor.sha256 ?? '') && Number.isSafeInteger(descriptor.bytes) && descriptor.bytes >= 0,
      'CORRECTION_CUSTOMER_DESCRIPTOR_INVALID');
    const checked = await files.hashPrivate(descriptor.file, 8589934592);
    need(checked.hash === descriptor.sha256 && checked.bytes === descriptor.bytes, 'CORRECTION_CUSTOMER_SOURCE_FILE_CHANGED');
    const target = join(out, 'downloads', scope, name);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    const source = await open(descriptor.file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const output = await open(target, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    try {
      const before = await source.stat(), prior = await output.stat();
      need(before.isFile() && before.nlink === 1 && !(before.mode & 0o077) && before.size === descriptor.bytes &&
        prior.isFile() && prior.nlink === 1 && !(prior.mode & 0o077) && prior.size <= descriptor.bytes, 'CORRECTION_CUSTOMER_DOWNLOAD_FILE_CHANGED');
      const left = Buffer.alloc(1048576), right = Buffer.alloc(1048576); let offset = 0;
      while (offset < prior.size) {
        const count = Math.min(left.length, prior.size - offset);
        const a = await source.read(left, 0, count, offset), b = await output.read(right, 0, count, offset);
        need(a.bytesRead === count && b.bytesRead === count && left.subarray(0, count).equals(right.subarray(0, count)),
          'CORRECTION_CUSTOMER_DOWNLOAD_PREFIX_CHANGED'); offset += count;
      }
      while (offset < descriptor.bytes) {
        const part = await source.read(left, 0, Math.min(left.length, descriptor.bytes - offset), offset);
        need(part.bytesRead > 0, 'CORRECTION_CUSTOMER_DOWNLOAD_SOURCE_SHORT');
        let written = 0;
        while (written < part.bytesRead) {
          const next = await output.write(left, written, part.bytesRead - written, offset + written);
          need(next.bytesWritten > 0, 'CORRECTION_CUSTOMER_DOWNLOAD_WRITE_FAILED'); written += next.bytesWritten;
        }
        offset += part.bytesRead;
      }
      await output.sync();
      const after = await source.stat();
      need(before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs,
        'CORRECTION_CUSTOMER_DOWNLOAD_SOURCE_CHANGED');
    } finally { await source.close(); await output.close(); }
    const actual = await files.hashPrivate(target, 8589934592);
    need(actual.hash === descriptor.sha256 && actual.bytes === descriptor.bytes, 'CORRECTION_CUSTOMER_DOWNLOAD_COPY_CHANGED');
    const receipt = { scope, name, file: target, bytes: actual.bytes, sha256: actual.hash, kind: descriptor.kind ?? null, id: descriptor.id ?? null };
    result.downloads.push(receipt); return receipt;
  }
  async function verifyBrowser(value, directory, inspectOnly) {
    need(value?.schema === 'commons.dcat-correction-browser.v1' && value.operation === OPERATION && value.complete === true &&
      value.mode === (inspectOnly ? 'received-inspection' : 'correction-course') && same(value.catalog, result.catalog) &&
      UUID.test(value.correctionId) && value.errors?.length === 0 && value.pageErrors?.length === 0 &&
      value.cleanup?.some(row => row.owner === 'browser' && row.closed), 'CORRECTION_CUSTOMER_BROWSER_INCOMPLETE');
    for (const rows of [value.downloads, value.screenshots]) {
      need(Array.isArray(rows) && rows.length > 0, 'CORRECTION_CUSTOMER_BROWSER_ARTIFACTS_MISSING');
      for (const row of rows) {
        need(isAbsolute(row.file ?? '') && resolve(row.file).startsWith(resolve(directory) + '/') &&
          HASH.test(row.sha256 ?? '') && Number.isSafeInteger(row.bytes), 'CORRECTION_CUSTOMER_BROWSER_ARTIFACT_INVALID');
        const actual = await files.hashPrivate(row.file, 268435456);
        need(actual.hash === row.sha256 && actual.bytes === row.bytes, 'CORRECTION_CUSTOMER_BROWSER_ARTIFACT_CHANGED');
      }
    }
    need(value.observations.some(row => row.kind === 'layout' && row.viewport === 390) &&
      value.observations.some(row => row.kind === 'layout' && row.viewport === 1365), 'CORRECTION_CUSTOMER_BROWSER_LAYOUTS_MISSING');
    return value;
  }
  async function originalBindings(model) {
    const pair = await model.dcatSemanticComparison(ordered.comparisonId);
    need(pair.comparisonSha256 === ordered.comparisonSha256 && pair.after.runId === ordered.after.runId &&
      pair.after.runSha256 === ordered.after.runSha256, 'CORRECTION_CUSTOMER_COMPARISON_BINDING_CHANGED');
    const run = await model.dcatSemanticRun(ordered.after.runId);
    need(run.runSha256 === ordered.after.runSha256 && run.selection.kind === 'catalog' && UUID.test(run.selection.id),
      'CORRECTION_CUSTOMER_CURRENT_CATALOG_CHANGED');
    const catalog = model.status().dcat.catalogs.find(row => row.id === run.selection.id);
    need(catalog && catalog.sha256 === run.selection.sha256 && catalog.bytes === run.selection.bytes,
      'CORRECTION_CUSTOMER_CATALOG_BINDING_CHANGED');
    const download = await model.dcatCatalogDownload(catalog.id), raw = await files.readPrivate(download.file, 134217728);
    need(sha(raw) === catalog.sha256 && raw.length === catalog.bytes, 'CORRECTION_CUSTOMER_CATALOG_CHANGED');
    const parsed = parseCkanJson(raw);
    need(Array.isArray(parsed.dataset) && parsed.dataset.length === 344 &&
      parsed.dataset[0]?.identifier === 'GSA-2015-02-26-1' && parsed.dataset[0]?.dataQuality === true,
      'CORRECTION_CUSTOMER_ORIGINAL_344_CATALOG_REQUIRED');
    return { catalog: { id: catalog.id, sha256: catalog.sha256, bytes: catalog.bytes }, download };
  }
  async function validateCorrection(model, browser, scope, baseline) {
    const draft = await model.dcatCorrection(browser.correctionId);
    need(draft.source.kind === 'catalog' && draft.source.id === result.catalog.id &&
      draft.source.sha256 === result.catalog.sha256 && draft.source.bytes === result.catalog.bytes &&
      draft.source.migrationSourceId === result.catalog.id && draft.revisions.length === 3 && draft.materializations.length === 1,
      'CORRECTION_CUSTOMER_DRAFT_BINDING_CHANGED');
    const [first, edited, restored] = draft.revisions;
    need(first.kind === 'source' && edited.kind === 'edit' && restored.kind === 'restore' &&
      first.id === result.browser.initialRevisionId && edited.id === result.browser.editedRevisionId &&
      restored.id === result.browser.restoredRevisionId && draft.headRevisionId === restored.id &&
      first.documentSha256 === result.catalog.sha256 && restored.documentSha256 === result.catalog.sha256 &&
      first.documentBytes === result.catalog.bytes && restored.documentBytes === result.catalog.bytes &&
      edited.documentSha256 !== first.documentSha256, 'CORRECTION_CUSTOMER_REVISION_HISTORY_CHANGED');
    const materialization = draft.materializations[0];
    need(same(materialization, result.browser.materialization) && materialization.revisionId === restored.id &&
      materialization.sha256 === restored.documentSha256 && materialization.bytes === restored.documentBytes &&
      materialization.profile === '3.0' && materialization.migrationSourceId === result.catalog.id, 'CORRECTION_CUSTOMER_MATERIALIZATION_CHANGED');
    await validateDcatCorrectionFiles(model.directory, model.status().dcat);
    const records = [];
    for (const revision of draft.revisions) {
      const document = await copyDescriptor(await model.dcatCorrectionDownload({
        correctionId: draft.id, revisionId: revision.id, kind: 'document' }), scope, revision.id + '-document.json');
      const record = await copyDescriptor(await model.dcatCorrectionDownload({
        correctionId: draft.id, revisionId: revision.id, kind: 'revision' }), scope, revision.id + '-revision.json');
      const full = JSON.parse(await files.readPrivate(record.file, 33554432));
      need(full.id === revision.id && full.documentSha256 === document.sha256 && full.author === author, 'CORRECTION_CUSTOMER_ATTRIBUTION_CHANGED');
      if (revision.kind === 'edit') {
        need(full.operations.length === 4 && full.changes.length === 4 &&
          full.operations[0].op === 'replace' && full.operations[0].path === '/dataset/0/title' &&
          full.operations[1].valueText === 'false' &&
          full.operations[2].valueText.includes('"exactInteger":900719925474099312345') &&
          full.operations[2].valueText.includes('"exactDecimal":1.2300000000000000001') &&
          full.operations[3].op === 'move' && full.operations[3].from === '/dataset/0' && full.operations[3].path === '/dataset/1',
          'CORRECTION_CUSTOMER_EXACT_OPERATION_RECORD_CHANGED');
        const editedRaw = await files.readPrivate(document.file, 134217728);
        need(editedRaw.includes(Buffer.from('900719925474099312345')) && editedRaw.includes(Buffer.from('1.2300000000000000001')),
          'CORRECTION_CUSTOMER_EXACT_NUMBER_CHANGED');
      }
      records.push({ revision, document, record });
    }
    const materialized = await copyDescriptor(await model.dcatCatalogDownload(materialization.catalogId), scope, 'materialized-restored-catalog.json');
    need(materialized.sha256 === result.catalog.sha256 && materialized.bytes === result.catalog.bytes, 'CORRECTION_CUSTOMER_MATERIALIZED_BYTES_CHANGED');
    const reviewId = ledger.phases['preserve-restored-review']?.result?.id ?? ledger.phases['preserve-restored-review']?.selection?.reviewId;
    need(same(stripOwned(model.status().dcat, draft.id, materialization.catalogId, reviewId), baseline.dcat),
      'CORRECTION_CUSTOMER_UNOWNED_HISTORY_CHANGED');
    return { id: draft.id, headRevisionId: draft.headRevisionId, source: draft.source,
      revisions: draft.revisions, materialization, downloads: records };
  }
  async function collectReview(model, id, scope) {
    const saved = model.status().dcat.reviews.find(row => row.id === id);
    need(saved && ['READY', 'NEEDS_CORRECTION'].includes(saved.status), 'CORRECTION_CUSTOMER_REVIEW_INCOMPLETE');
    const report = await model.dcatReview(id), materialization = result.browser.materialization;
    need(saved.sourceId === result.catalog.id && saved.candidateId === materialization.catalogId &&
      saved.comparisonId === null && saved.normalizeV3 === false && report.source.sha256 === result.catalog.sha256 &&
      report.candidate?.sha256 === result.catalog.sha256 && report.candidate.bytes === result.catalog.bytes &&
      report.review_sha256 === saved.reviewSha256 && report.conservation.source_count === 344 &&
      report.conservation.target_count === 344, 'CORRECTION_CUSTOMER_REVIEW_BINDING_CHANGED');
    const fullReport = await copyDescriptor(await model.dcatReviewDownload(id, 'report'), scope, 'report.json');
    const candidate = await copyDescriptor(await model.dcatReviewDownload(id, 'candidate'), scope, 'candidate.json');
    need(candidate.sha256 === result.catalog.sha256 && candidate.bytes === result.catalog.bytes, 'CORRECTION_CUSTOMER_REVIEW_CHANGED_RESTORED_BYTES');
    return { id, status: saved.status, reviewSha256: saved.reviewSha256, reportSha256: saved.reportSha256,
      candidateSha256: candidate.sha256, summary: saved.summary, canReceive: report.can_receive, report: fullReport, candidate,
      qualification: 'The new review retains original validation and conservation outcomes for the exact restored current catalogue. No release or semantic decision is inferred.' };
  }
  async function archive(model, name, file) {
    const selected = await phase({ name, model, kind: 'export complete workspace', collection: 'archives',
      selectionKey: null, request: { out: file }, start: input => model.archiveWorkspace(input),
      get: async id => (await model.workspaceArchives()).find(row => row.id === id),
      matches: (row, request) => row.file === request.out && HASH.test(row.sha256) && row.bytes > 0 });
    const actual = await files.hashPrivate(selected.file, 8589934592);
    need(actual.hash === selected.sha256 && actual.bytes === selected.bytes, 'CORRECTION_CUSTOMER_ARCHIVE_CHANGED');
    return selected;
  }
  try {
    for (const name of ['model.mjs', 'server.mjs', 'archive.mjs', 'capture.mjs', 'dcat-workspace.mjs',
      'dcat-corrections.mjs', 'public/dcat-corrections.mjs', 'public/dcat-correction-json.mjs',
      'dcat-semantic.mjs', 'dcat-semantic-comparison.mjs', 'dcat_migration.py', 'CORRECTION_WORKBENCH.md', 'CORRECTIONS_AGENT.md']) {
      const raw = await readFile(join(ckan, name)); result.source.push({ path: PREFIX + '/' + name, bytes: raw.length, sha256: sha(raw) });
    }
    for (const name of ['run-correction-customer.mjs', 'run-correction-browser.mjs']) {
      const raw = await readFile(new URL(name, import.meta.url));
      result.source.push({ path: 'operations/dcat-correction-customer-390e-20261013/' + name, bytes: raw.length, sha256: sha(raw) });
    }
    await retain(join(out, 'actual-source.json'), encoded(result.source));
    result.runtime = { node: process.version, python, runtimeProfile, playwrightModule: playwrightModule ?? null,
      chromiumPath, chromium: await executableIdentity(chromiumPath),
      pythonIdentity: await executableIdentity(python),
      playwrightIdentity: playwrightModule ? await executableIdentity(playwrightModule) : { injected: true } };
    await retain(join(out, 'actual-runtime.json'), encoded(result.runtime));
    result.producerReceiving = await receiveCkanWorkspaceArchive({
      file: selectedArchiveFile, directory: producerDirectory, expectedSha256: previousArchive.sha256, signal });
    const producer = await openOwner('producer', true), original = await originalBindings(producer);
    result.catalog = original.catalog;
    const baselineFile = join(out, 'producer-before-corrections.json');
    let baseline;
    if (await exists(baselineFile)) baseline = await files.readJson(baselineFile, 67108864);
    else {
      baseline = { projectCreatedAt: producer.status().createdAt, catalogOrigin: producer.status().catalogOrigin,
        dcat: normalized(producer.status().dcat) };
      await retain(baselineFile, encoded(baseline));
    }
    need(baseline.projectCreatedAt === producer.status().createdAt && baseline.catalogOrigin === producer.status().catalogOrigin,
      'CORRECTION_CUSTOMER_PROJECT_BINDING_CHANGED');
    await copyDescriptor(original.download, 'original', 'complete-current-gsa-catalog.json');
    const imported = playwright ?? await import(pathToFileURL(playwrightModule).href);
    const browserRuntime = imported.chromium ? imported : imported.default;
    need(browserRuntime?.chromium, 'CORRECTION_CUSTOMER_PLAYWRIGHT_EXPORT_REQUIRED');
    const browserOutput = join(out, 'browser-producer');
    try {
      result.browser = await runDcatCorrectionBrowser({ playwright: browserRuntime,
        listener: { url: owners.producer.listener.url, origin: owners.producer.listener.origin },
        outputDirectory: browserOutput, catalog: result.catalog, baselineDocumentPath: original.download.file,
        author, signal, timeoutMs, executablePath: chromiumPath });
    } catch (error) {
      if (await exists(join(browserOutput, 'result.json'))) result.browser = await files.readJson(join(browserOutput, 'result.json'), 67108864);
      throw error;
    }
    await verifyBrowser(result.browser, browserOutput, false);
    const reviewRequest = { sourceId: result.catalog.id, candidateId: result.browser.materialization.catalogId,
      normalizeV3: false, label: 'GSA restored original — correction course preservation review' };
    const reviewPhase = () => phase({ name: 'preserve-restored-review', model: producer, kind: 'review DCAT migration',
      collection: 'reviews', selectionKey: 'reviewId', request: reviewRequest, start: input => producer.prepareDcatReview(input),
      get: async id => producer.status().dcat.reviews.find(row => row.id === id),
      matches: (row, request) => ['READY', 'NEEDS_CORRECTION'].includes(row.status) && row.sourceId === request.sourceId &&
        row.candidateId === request.candidateId && row.normalizeV3 === false && row.comparisonId === null && HASH.test(row.reportSha256) });
    // Resolve a retained lost-reply phase before excluding only its authoritative
    // review ID from the original-history comparison. Never infer an extra row by similarity.
    let reviewed = ledger.phases['preserve-restored-review'] ? await reviewPhase() : null;
    result.correction = await validateCorrection(producer, result.browser, 'producer-corrections', baseline);
    reviewed ??= await reviewPhase();
    result.review = await collectReview(producer, reviewed.id, 'producer-review');
    await validateCorrection(producer, result.browser, 'producer-final-corrections', baseline);
    const producerState = normalized(producer.status().dcat);
    await validateDcatSemanticFiles(producerDirectory, producerState);
    await retain(join(out, 'producer-before-transfer.json'), encoded(producerState));
    result.archive = await archive(producer, 'archive-producer', join(out, 'complete-gsa-corrections.ckanw'));
    await save('customer-progress-result.json', result);
    await closeOwner('producer');
    result.receiving = await receiveCkanWorkspaceArchive({ file: result.archive.file, directory: recipientDirectory,
      expectedSha256: result.archive.sha256, signal });
    let recipient = await openOwner('recipient');
    need(same(normalized(recipient.status().dcat), producerState), 'CORRECTION_CUSTOMER_RECEIVED_HISTORY_CHANGED');
    await originalBindings(recipient);
    await validateDcatSemanticFiles(recipientDirectory, recipient.status().dcat);
    await validateCorrection(recipient, result.browser, 'recipient-corrections', baseline);
    await collectReview(recipient, reviewed.id, 'recipient-review');
    await save('recipient-before-cold-reopen.json', normalized(recipient.status().dcat));
    await closeOwner('recipient');
    recipient = await openOwner('recipient', true);
    need(same(normalized(recipient.status().dcat), producerState), 'CORRECTION_CUSTOMER_COLD_REOPEN_CHANGED');
    result.coldReopen = { projectCreatedAt: recipient.status().createdAt, catalogOrigin: recipient.status().catalogOrigin,
      dcatSha256: sha(encoded(producerState)), correctionId: result.correction.id,
      revisionCount: result.correction.revisions.length, materializationCount: 1, reviewId: reviewed.id };
    const receivingBrowserOutput = join(out, 'browser-recipient');
    try {
      result.reopenedBrowser = await inspectDcatCorrectionBrowser({ playwright: browserRuntime,
        listener: { url: owners.recipient.listener.url, origin: owners.recipient.listener.origin },
        outputDirectory: receivingBrowserOutput, catalog: result.catalog, author, signal, timeoutMs,
        executablePath: chromiumPath, correctionId: result.correction.id });
    } catch (error) {
      if (await exists(join(receivingBrowserOutput, 'result.json'))) result.reopenedBrowser = await files.readJson(join(receivingBrowserOutput, 'result.json'), 67108864);
      throw error;
    }
    await verifyBrowser(result.reopenedBrowser, receivingBrowserOutput, true);
    need(result.reopenedBrowser.correctionId === result.correction.id &&
      same(result.reopenedBrowser.materialization, result.browser.materialization) &&
      same(normalized(recipient.status().dcat), producerState), 'CORRECTION_CUSTOMER_READONLY_BROWSER_CHANGED_STATE');
    result.followingArchive = await archive(recipient, 'archive-recipient', join(out, 'received-gsa-corrections-following.ckanw'));
    await closeOwner('recipient');
    const reopenedProducer = await openOwner('producer');
    need(same(normalized(reopenedProducer.status().dcat), producerState), 'CORRECTION_CUSTOMER_SENDER_CHANGED');
    await closeOwner('producer');
    result.complete = Boolean(result.browser.complete && result.reopenedBrowser.complete &&
      result.coldReopen && result.followingArchive && result.cleanup.every(row => row.closed));
  } catch (error) { result.errors.push(safeError(error)); result.complete = false; }
  finally {
    for (const name of ['recipient', 'producer']) {
      try { await closeOwner(name); } catch (error) { result.errors.push(safeError(error)); result.complete = false; }
    }
    result.finishedAt = new Date().toISOString(); await save('result.json', result);
  }
  return result;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  need(args.length === 2 && args[0] === '--input', 'CORRECTION_CUSTOMER_INPUT_REQUIRED',
    'Use node run-correction-customer.mjs --input /absolute/private/config.json');
  const path = resolve(args[1]), info = await lstat(path);
  need(info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && !(info.mode & 0o077), 'CORRECTION_CUSTOMER_PRIVATE_INPUT_REQUIRED');
  const input = JSON.parse(await readFile(path, 'utf8'));
  const controller = new AbortController(), stop = () => controller.abort(new Error('The original customer operation was interrupted.'));
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  let result;
  try { result = await runDcatCorrectionCustomer({ ...input, signal: controller.signal }); }
  finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
  console.log(JSON.stringify({ schema: result.schema, operation: result.operation, complete: result.complete,
    correctionId: result.correction?.id ?? null, reviewId: result.review?.id ?? null,
    resultFile: join(resolve(input.outputDirectory), 'result.json'), errors: result.errors }));
  process.exitCode = result.complete ? 0 : 2;
}
