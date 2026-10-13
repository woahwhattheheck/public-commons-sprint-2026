// MIT. DCAT editions and migration decisions inside the original catalog workspace.
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { parseCkanJson } from './capture.mjs';
import { spawn } from 'node:child_process';
import { validateDcatSemanticState, validateDcatSemanticFiles } from './dcat-semantic.mjs';
import { createDcatAcquisition, validateDcatAcquisitions, validateDcatAcquisitionFiles } from './dcat-acquisition.mjs';
import { object, bytes, digest, readPrivate, createFile, privateDirectory, fault, stamp }
  from '../postgres/publisher/files.mjs';

export const DCAT_WORKSPACE_SCHEMA = 'stellar-forge.dcat-workspace.v1';
export const DCAT_MAX_CATALOG_BYTES = 134217728;
const MAX_REPORT = 536870912, UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/, HASH = /^[a-f0-9]{64}$/;
const engine = fileURLToPath(new URL('./dcat_migration.py', import.meta.url));
const jsonText = raw => new TextDecoder('utf-8', { fatal: true }).decode(raw);
const need = (condition, code, message, status = 400) => { if (!condition) throw fault(code, message, status); };
function text(value, name, max = 512) {
  need(typeof value === 'string' && value.trim() && value.length <= max,
    'DCAT_INPUT_INVALID', 'Enter ' + name + '.');
  return value.trim();
}
function profile(value = 'auto') {
  need(['auto', '1.1', '3.0'].includes(value), 'DCAT_PROFILE_INVALID', 'Choose automatic detection, DCAT-US 1.1 or DCAT-US 3.0.');
  return value;
}
function origin(value) {
  if (!value) return null;
  let url; try { url = new URL(value); } catch { throw fault('DCAT_ORIGIN_INVALID', 'Enter the source publication URL.'); }
  need(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
    !url.hash && url.href.length <= 4096, 'DCAT_ORIGIN_INVALID', 'Enter the source publication URL without credentials or a fragment.');
  return url.href;
}
function collectionItem(items, value) {
  need(typeof value === 'string' && UUID.test(value), 'DCAT_ITEM_NOT_FOUND', 'Choose a retained catalog, review or release.', 404);
  const item = items.find(item => item.id === value);
  need(item, 'DCAT_ITEM_NOT_FOUND', 'Choose a retained catalog, review or release.', 404);
  return item;
}
function emptyState() {
  return { schema: DCAT_WORKSPACE_SCHEMA, catalogs: [], reviews: [], releases: [], sources: [], acquisitions: [], activeReleaseId: null };
}
export function validateDcatState(value) {
  if (value === undefined) return;
  need(object(value) && value.schema === DCAT_WORKSPACE_SCHEMA, 'DCAT_PROJECT_INVALID');
  for (const key of ['catalogs', 'reviews', 'releases']) {
    need(Array.isArray(value[key]), 'DCAT_PROJECT_INVALID');
    const ids = new Set();
    for (const item of value[key]) {
      need(object(item) && UUID.test(item.id ?? '') && !ids.has(item.id), 'DCAT_PROJECT_INVALID');
      ids.add(item.id);
    }
  }
  for (const catalog of value.catalogs) {
    need(HASH.test(catalog.sha256 ?? '') && Number.isSafeInteger(catalog.bytes) &&
      catalog.bytes >= 2 && catalog.bytes <= DCAT_MAX_CATALOG_BYTES, 'DCAT_PROJECT_INVALID');
    profile(catalog.profile);
  }
  for (const review of value.reviews) {
    collectionItem(value.catalogs, review.sourceId);
    if (review.comparisonId) collectionItem(value.catalogs, review.comparisonId);
    if (review.candidateId) collectionItem(value.catalogs, review.candidateId);
    need(review.normalizeV3 === undefined || typeof review.normalizeV3 === 'boolean', 'DCAT_PROJECT_INVALID');
    need(review.runtimeProfile === undefined || ['original', 'portable-python312'].includes(review.runtimeProfile),
      'DCAT_PROJECT_INVALID');
    if (['READY', 'NEEDS_CORRECTION'].includes(review.status)) {
      need(HASH.test(review.reportSha256 ?? '') && HASH.test(review.reviewSha256 ?? '') &&
        Number.isSafeInteger(review.reportBytes) && review.reportBytes > 0 && review.reportBytes <= MAX_REPORT,
        'DCAT_PROJECT_INVALID');
      need(review.candidateSha256 === null && review.candidateBytes === null && review.status === 'NEEDS_CORRECTION' ||
        HASH.test(review.candidateSha256 ?? '') && Number.isSafeInteger(review.candidateBytes) &&
        review.candidateBytes >= 2 && review.candidateBytes <= DCAT_MAX_CATALOG_BYTES, 'DCAT_PROJECT_INVALID');
    }
  }
  const seen = new Set();
  for (const release of value.releases) {
    const review = collectionItem(value.reviews, release.reviewId);
    need(review.status === 'READY' && release.sha256 === review.candidateSha256 &&
      release.reviewSha256 === review.reviewSha256 && release.bytes === review.candidateBytes &&
      (release.previousReleaseId === null || seen.has(release.previousReleaseId)) &&
      (!release.restoredFromReleaseId || seen.has(release.restoredFromReleaseId)), 'DCAT_PROJECT_INVALID');
    seen.add(release.id);
  }
  need(value.activeReleaseId === null || seen.has(value.activeReleaseId), 'DCAT_PROJECT_INVALID');
  validateDcatAcquisitions(value);
  validateDcatSemanticState(value);
}
async function externalCatalog(file) {
  need(typeof file === 'string' && file.startsWith('/'), 'DCAT_FILE_REQUIRED', 'Choose an absolute catalog file path.');
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    need(before.isFile() && before.size >= 2 && before.size <= DCAT_MAX_CATALOG_BYTES,
      'DCAT_CATALOG_SIZE', 'Choose a JSON catalog no larger than 128 MiB.');
    const raw = await handle.readFile(), after = await handle.stat();
    need(raw.length === before.size && before.size === after.size && before.mtimeMs === after.mtimeMs &&
      before.ctimeMs === after.ctimeMs && before.ino === after.ino && before.dev === after.dev,
      'DCAT_INPUT_CHANGED', 'The source file changed during import. Import its current complete edition.');
    // Retain source bytes unchanged; the original engine accepts UTF-8/BOM and CP1252.
    return raw;
  } finally { await handle.close(); }
}
/** The host selects an explicit interpreter contract; catalogue JSON cannot change it. */
export function dcatRuntimeSelection(environment = process.env) {
  const runtimeProfile = environment.SCF_DCAT_RUNTIME_PROFILE ?? 'original';
  need(['original', 'portable-python312'].includes(runtimeProfile),
    'DCAT_RUNTIME_PROFILE_INVALID', 'Set SCF_DCAT_RUNTIME_PROFILE to original or portable-python312.');
  const command = environment.SCF_DCAT_PYTHON ||
    (runtimeProfile === 'portable-python312' ? 'python3.12' : 'python3.13');
  need(typeof command === 'string' && command.length <= 4096 &&
    !command.includes('\0'), 'DCAT_RUNTIME_INVALID');
  return { command, runtimeProfile };
}
function runEngine(input, environment, signal, progress) {
  const runtime = dcatRuntimeSelection(environment), executable = runtime.command;
  return new Promise((resolve, reject) => {
    let settled = false, stdoutBytes = 0, stderrBytes = 0;
    const stdout = [], stderr = [];
    const process = spawn(executable, ['-B', engine, '--runtime-profile', runtime.runtimeProfile], {
      env: { ...environment, PYTHONDONTWRITEBYTECODE: '1', PYTHONHASHSEED: '0' },
      stdio: ['pipe', 'pipe', 'pipe'], shell: false,
    });
    const finish = (error, value) => {
      if (settled) return; settled = true;
      signal?.removeEventListener('abort', cancel);
      if (error) reject(error); else resolve(value);
    };
    const cancel = () => {
      process.kill('SIGTERM');
      const timer = setTimeout(() => process.kill('SIGKILL'), 5000); timer.unref?.();
      finish(fault('DCAT_REVIEW_CANCELLED', 'The migration review was cancelled.'));
    };
    process.on('error', error => finish(fault('DCAT_RUNTIME_UNAVAILABLE',
      'Start the prepared ' + runtime.runtimeProfile + ' migration environment with SCF_DCAT_PYTHON. ' + (error.code ?? ''))));
    process.stdout.on('data', chunk => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_REPORT) {
        process.kill('SIGTERM');
        finish(fault('DCAT_REPORT_TOO_LARGE', 'The complete migration report exceeds 512 MiB.'));
      } else stdout.push(chunk);
    });
    process.stderr.on('data', chunk => {
      const keep = Math.min(chunk.length, Math.max(0, 65536 - stderrBytes));
      if (keep) stderr.push(chunk.subarray(0, keep)); stderrBytes += chunk.length;
    });
    process.on('close', code => {
      if (settled) return;
      let result;
      const raw = Buffer.concat(stdout);
      try { result = parseCkanJson(raw); }
      catch { finish(fault('DCAT_ENGINE_FAILED', 'The migration engine did not return its complete JSON result. ' +
        Buffer.concat(stderr).toString('utf8').slice(-4096))); return; }
      if (![0, 2].includes(code) || result.schema !== 'migration-review.v1') {
        finish(fault('DCAT_ENGINE_FAILED', result.error?.message ?? result.error ??
          'The original migration environment could not complete this review.')); return;
      }
      progress?.({ phase: 'REVIEW_COMPLETE', sourceRecords: result.conservation?.source_count,
        candidateRecords: result.conservation?.target_count, changes: result.field_changes?.length });
      finish(null, { result, raw });
    });
    process.stdin.on('error', error => {
      if (error.code !== 'EPIPE') finish(fault('DCAT_ENGINE_INPUT_FAILED', 'The catalog could not be passed to the migration engine.'));
    });
    if (signal?.aborted) { cancel(); return; }
    signal?.addEventListener('abort', cancel, { once: true });
    progress?.({ phase: 'VALIDATING_AND_COMPARING' });
    process.stdin.end(JSON.stringify(input));
  });
}
function reportSummary(report) {
  return { canReceive: report.can_receive === true, sourceValid: report.validation?.source?.valid === true,
    candidateValid: report.validation?.candidate?.valid === true,
    sourceRecords: report.conservation?.source_count ?? 0, candidateRecords: report.conservation?.target_count ?? 0,
    matchedRecords: report.conservation?.matched_count ?? 0,
    missingRecords: report.conservation?.missing?.length ?? 0, addedRecords: report.conservation?.added?.length ?? 0,
    validationErrors: report.validation?.candidate?.errors?.length ?? 0,
    fieldChanges: report.field_changes?.length ?? 0, catalogChanges: report.catalog_changes?.length ?? 0,
    comparisonChanges: report.comparison_changes?.field_changes?.length ?? 0,
    reviewSha256: report.review_sha256 };
}
async function retained(directory, member, expectedSha256, expectedBytes, maximum = MAX_REPORT) {
  const raw = await readPrivate(join(directory, 'dcat', member), maximum);
  need(digest(raw) === expectedSha256 && (expectedBytes === undefined || raw.length === expectedBytes),
    'DCAT_RETAINED_EDITION_CHANGED', 'The saved edition differs from its reviewed bytes.', 409);
  return raw;
}
function isReceivable(report) {
  return report.can_receive === true && report.validation?.candidate?.valid === true &&
    report.conservation?.valid === true && report.candidate !== null;
}
function validateReportBinding(report, selected, catalogs) {
  const source = collectionItem(catalogs, selected.sourceId);
  const comparison = selected.comparisonId ? collectionItem(catalogs, selected.comparisonId) : null;
  const candidate = selected.candidateId ? collectionItem(catalogs, selected.candidateId) : null;
  need(object(report) && report.schema === 'migration-review.v1' && HASH.test(report.review_sha256 ?? '') &&
    report.source?.sha256 === source.sha256 && report.source?.bytes === source.bytes,
    'DCAT_REVIEW_BINDING_CHANGED');
  if (selected.runtimeProfile !== undefined) {
    need(object(report.engine) && (selected.runtimeProfile === 'original'
      ? report.engine.runtime_profile === undefined
      : report.engine.runtime_profile?.id === 'portable-python312.v1'),
      'DCAT_REVIEW_RUNTIME_CHANGED', 'The saved review must retain its selected interpreter profile.', 409);
  }
  need(comparison ? report.comparison?.sha256 === comparison.sha256 && report.comparison?.bytes === comparison.bytes :
    report.comparison === null, 'DCAT_REVIEW_BINDING_CHANGED');
  const expectedMode = candidate ? 'review_candidate' : report.source.profile === '3.0' ?
    (selected.normalizeV3 ? 'normalize_3_0' : 'preserve_3_0') : 'convert_1_1';
  need(report.mode === expectedMode, 'DCAT_REVIEW_BINDING_CHANGED');
  if (candidate) {
    need(report.candidate?.origin === 'operator' && report.candidate?.sha256 === candidate.sha256 &&
      report.candidate?.bytes === candidate.bytes, 'DCAT_REVIEW_BINDING_CHANGED');
  } else {
    need(report.candidate === null ? report.candidate_base64 === null && !report.can_receive &&
      expectedMode !== 'preserve_3_0' :
      report.candidate.origin === (expectedMode === 'preserve_3_0' ? 'preserved' : 'converter'),
      'DCAT_REVIEW_BINDING_CHANGED');
  }
  if (selected.reviewSha256 !== undefined) {
    need(report.review_sha256 === selected.reviewSha256 &&
      (report.candidate?.sha256 ?? null) === selected.candidateSha256 &&
      (report.candidate?.bytes ?? null) === selected.candidateBytes &&
      selected.status === (isReceivable(report) ? 'READY' : 'NEEDS_CORRECTION'),
      'DCAT_REVIEW_BINDING_CHANGED');
  }
  return report;
}
export async function validateDcatWorkspaceFiles(directory, state) {
  validateDcatState(state);
  if (!state) return;
  await validateDcatAcquisitionFiles(directory, state);
  await validateDcatSemanticFiles(directory, state);
  for (const item of state.catalogs)
    await retained(directory, 'catalogs/' + item.id + '/catalog.json', item.sha256, item.bytes, DCAT_MAX_CATALOG_BYTES);
  for (const item of state.reviews) {
    if (!['READY', 'NEEDS_CORRECTION'].includes(item.status)) continue;
    const raw = await retained(directory, 'reviews/' + item.id + '/report.json', item.reportSha256, item.reportBytes);
    validateReportBinding(parseCkanJson(raw), item, state.catalogs);
    if (item.candidateSha256) await retained(directory, 'reviews/' + item.id + '/candidate.json',
      item.candidateSha256, item.candidateBytes, DCAT_MAX_CATALOG_BYTES);
  }
  for (const item of state.releases) {
    const raw = await readPrivate(join(directory, 'dcat', 'releases', item.id + '.json'), 1048576);
    need(digest(raw) === digest(bytes(item)), 'DCAT_RELEASE_CHANGED');
  }
}
export function createDcatWorkspace({ directory, state, launch, persist, environment = process.env }) {
  const executionEnvironment = { ...environment };
  if (state.dcat === undefined) state.dcat = emptyState();
  validateDcatState(state.dcat);
  const current = state.dcat;
  const item = (collection, id) => collectionItem(current[collection], id);
  const catalogBytes = selected => retained(directory, 'catalogs/' + selected.id + '/catalog.json',
    selected.sha256, selected.bytes, DCAT_MAX_CATALOG_BYTES);
  const download = (member, selected, kind, name) => ({
    id: selected.id, file: join(directory, 'dcat', member), sha256: selected.sha256, bytes: selected.bytes,
    mediaType: kind === 'report' ? 'application/json; charset=utf-8' : 'application/octet-stream',
    hashHeader: 'x-dcat-sha256', downloadName: name,
    schema: 'stellar-forge.dcat-download.v1', kind,
  });
  async function review(value) {
    const selected = item('reviews', value);
    need(['READY', 'NEEDS_CORRECTION'].includes(selected.status), 'DCAT_REVIEW_INCOMPLETE',
      'Wait for this saved review to finish.', 409);
    const raw = await retained(directory, 'reviews/' + value + '/report.json', selected.reportSha256, selected.reportBytes);
    return validateReportBinding(parseCkanJson(raw), selected, current.catalogs);
  }
  function active(expected) {
    need(expected === current.activeReleaseId, 'DCAT_ACTIVE_RELEASE_CHANGED',
      'The active catalog changed. Review the current release before selecting another.', 409);
  }
  async function releaseReview(reviewId, input, restoredFromReleaseId = null) {
    active(input.expectedActiveReleaseId);
    const selected = item('reviews', reviewId), report = await review(reviewId);
    need((input.expectedReviewSha256 === undefined || input.expectedReviewSha256 === selected.reviewSha256) &&
      (input.expectedCandidateSha256 === undefined || input.expectedCandidateSha256 === selected.candidateSha256),
      'DCAT_REVIEW_SELECTION_CHANGED', 'Refresh the selected review and its exact candidate before changing the active release.', 409);
    need(selected.status === 'READY' && isReceivable(report),
      'DCAT_CANDIDATE_REQUIRES_CORRECTION', 'Correct the validation or record-conservation issues and review the exact candidate again.', 409);
    await retained(directory, 'reviews/' + reviewId + '/candidate.json',
      selected.candidateSha256, selected.candidateBytes, DCAT_MAX_CATALOG_BYTES);
    const saved = { id: randomUUID(), reviewId, previousReleaseId: current.activeReleaseId,
      restoredFromReleaseId, createdAt: stamp(), note: text(input.note, 'the release decision', 4096),
      sha256: selected.candidateSha256, bytes: selected.candidateBytes, reviewSha256: selected.reviewSha256 };
    await privateDirectory(join(directory, 'dcat', 'releases'), true);
    await createFile(join(directory, 'dcat', 'releases', saved.id + '.json'), bytes(saved));
    current.releases.push(saved); current.activeReleaseId = saved.id;
    await persist(); return structuredClone(saved);
  }
  async function saveCatalog(raw,metadata) {
    need(Buffer.isBuffer(raw)&&raw.length>=2&&raw.length<=DCAT_MAX_CATALOG_BYTES,'DCAT_CATALOG_SIZE');
    const selected={id:randomUUID(),...metadata,receivedAt:stamp(),sha256:digest(raw),bytes:raw.length};
    const root=join(directory,'dcat','catalogs',selected.id);
    await privateDirectory(root,true);await createFile(join(root,'catalog.json'),raw);
    current.catalogs.push(selected);await persist();return selected;
  }
  async function engineInput(input) {
    const source=item('catalogs',input.sourceId),raw=await catalogBytes(source);
    const value={source_base64:raw.toString('base64'),source_profile:source.profile,
      normalize_v3:input.normalizeV3??false,identity_mappings:input.identityMappings??[]};
    if(input.comparisonId) {
      const comparison=item('catalogs',input.comparisonId);
      value.comparison_base64=(await catalogBytes(comparison)).toString('base64');value.comparison_profile=comparison.profile;
    }
    if(input.candidateId)value.candidate_base64=(await catalogBytes(item('catalogs',input.candidateId))).toString('base64');
    return value;
  }
  async function runFresh(input,signal,progress) {
    const runtime=dcatRuntimeSelection(executionEnvironment);
    const {result}=await runEngine(await engineInput(input),executionEnvironment,signal,progress);
    return validateReportBinding(result,{sourceId:input.sourceId,comparisonId:null,candidateId:input.candidateId??null,
      normalizeV3:input.normalizeV3??false,runtimeProfile:runtime.runtimeProfile},current.catalogs);
  }
  async function performReview(input,value,binding,signal,progress,prepare=null) {
    const runtime=dcatRuntimeSelection(executionEnvironment),source=item('catalogs',input.sourceId);
    const selected={id:value,sourceId:source.id,comparisonId:input.comparisonId??null,candidateId:input.candidateId??null,
      label:text(input.label??source.label+' review','a review label'),normalizeV3:input.normalizeV3??false,
      runtimeProfile:runtime.runtimeProfile,status:'PREPARING',createdAt:stamp(),summary:null,...binding};
    current.reviews.push(selected);await persist();
    try {
      if(prepare)input=await prepare();
      need(input.identityMappings===undefined||Array.isArray(input.identityMappings),'DCAT_MAPPINGS_INVALID');
      need(input.normalizeV3===undefined||typeof input.normalizeV3==='boolean','DCAT_NORMALIZATION_INVALID');
      if(input.comparisonId)item('catalogs',input.comparisonId);
      if(input.candidateId)item('catalogs',input.candidateId);
      Object.assign(selected,{comparisonId:input.comparisonId??null,candidateId:input.candidateId??null});
      await persist();
      const completed=await runEngine(await engineInput(input),executionEnvironment,signal,progress);
      const result=validateReportBinding(completed.result,selected,current.catalogs);
      need(result.source?.sha256===source.sha256&&HASH.test(result.review_sha256??'')&&
        (typeof result.candidate_base64==='string'||result.candidate_base64===null&&result.candidate===null&&!result.can_receive),
        'DCAT_ENGINE_BINDING_CHANGED');
      const candidateRaw=result.candidate_base64===null?null:Buffer.from(result.candidate_base64,'base64');
      if(candidateRaw)need(candidateRaw.length>=2&&candidateRaw.length<=DCAT_MAX_CATALOG_BYTES&&
        digest(candidateRaw)===result.candidate?.sha256&&result.candidate?.bytes===candidateRaw.length,'DCAT_ENGINE_BINDING_CHANGED');
      const reportRaw=completed.raw,root=join(directory,'dcat','reviews',value);
      await privateDirectory(root,true);
      if(candidateRaw)await createFile(join(root,'candidate.json'),candidateRaw);
      await createFile(join(root,'report.json'),reportRaw);
      Object.assign(selected,{status:isReceivable(result)?'READY':'NEEDS_CORRECTION',completedAt:stamp(),
        reportSha256:digest(reportRaw),reportBytes:reportRaw.length,reviewSha256:result.review_sha256,
        candidateSha256:candidateRaw?digest(candidateRaw):null,candidateBytes:candidateRaw?.length??null,summary:reportSummary(result)});
      await persist();return structuredClone(selected);
    } catch(error) {
      selected.status=signal.aborted?'INTERRUPTED':'FAILED';
      selected.error={code:error.code??'DCAT_REVIEW_FAILED',message:error.message};
      selected.completedAt=stamp();await persist();throw error;
    }
  }
  return {
    ...createDcatAcquisition({ directory, current, launch, persist, environment: executionEnvironment,
      catalogBytes, saveCatalog, review, runReview: performReview, runFresh, download }),
    dcatRuntime: () => dcatRuntimeSelection(executionEnvironment),
    importDcatCatalog(input) {
      const expectedSha256 = input.expectedSha256 ?? null;
      need(expectedSha256 === null || HASH.test(expectedSha256), 'DCAT_INPUT_HASH_INVALID');
      const value = randomUUID(), metadata = { label: text(input.label ?? 'Catalog edition', 'a catalog label'),
        profile: profile(input.profile), origin: origin(input.origin) };
      return { ...launch('import DCAT catalog', async () => {
        const raw = await externalCatalog(input.file), sha256 = digest(raw);
        need(expectedSha256 === null || expectedSha256 === sha256, 'DCAT_INPUT_EDITION_CHANGED',
          'The inspected catalog changed. Inspect its current complete edition before importing it.', 409);
        const selected = { id: value, ...metadata, receivedAt: stamp(), sha256, bytes: raw.length };
        const root = join(directory, 'dcat', 'catalogs', value);
        await privateDirectory(root, true); await createFile(join(root, 'catalog.json'), raw);
        current.catalogs.push(selected); await persist(); return structuredClone(selected);
      }), catalogId: value };
    },
    prepareDcatReview(input) {
      item('catalogs',input.sourceId);
      if(input.comparisonId)item('catalogs',input.comparisonId);
      if(input.candidateId)item('catalogs',input.candidateId);
      need(input.identityMappings===undefined||Array.isArray(input.identityMappings),'DCAT_MAPPINGS_INVALID');
      need(input.normalizeV3===undefined||typeof input.normalizeV3==='boolean','DCAT_NORMALIZATION_INVALID');
      const value=randomUUID();
      return {...launch('review DCAT migration',(signal,progress)=>
        performReview(input,value,{},signal,progress)),reviewId:value};
    },
    dcatReview: review,
    async dcatCatalogDownload(value) {
      const selected = item('catalogs', value); await catalogBytes(selected);
      return download('catalogs/' + value + '/catalog.json', selected, 'original', 'dcat-source-' + value + '.json');
    },
    async dcatReviewDownload(value, kind = 'report') {
      const selected = item('reviews', value); await review(value);
      need(['report', 'candidate'].includes(kind), 'DCAT_DOWNLOAD_KIND');
      const candidate = kind === 'candidate', hash = candidate ? selected.candidateSha256 : selected.reportSha256;
      need(hash, 'DCAT_NO_CANDIDATE', 'This review retains the conversion errors. Upload a corrected DCAT-US 3.0 candidate and review it with the original source.', 409);
      const count = candidate ? selected.candidateBytes : selected.reportBytes;
      const member = 'reviews/' + value + '/' + (candidate ? 'candidate' : 'report') + '.json';
      await retained(directory, member, hash, count, candidate ? DCAT_MAX_CATALOG_BYTES : MAX_REPORT);
      return download(member, { id: value, sha256: hash, bytes: count }, kind, 'dcat-' + kind + '-' + value + '.json');
    },
    async dcatCurrentDownload() {
      need(current.activeReleaseId, 'DCAT_NO_ACTIVE_RELEASE', 'Select a reviewed catalog release first.', 404);
      const selected = item('releases', current.activeReleaseId);
      const result = await this.dcatReviewDownload(selected.reviewId, 'candidate');
      return { ...result, releaseId: selected.id, downloadName: 'data.json' };
    },
    cutoverDcat(input) {
      active(input.expectedActiveReleaseId); item('reviews', input.reviewId);
      return launch('select DCAT catalog release', () => releaseReview(input.reviewId, input));
    },
    rollbackDcat(input) {
      active(input.expectedActiveReleaseId);
      const target = item('releases', input.releaseId);
      return launch('restore DCAT catalog release', () => releaseReview(target.reviewId, input, target.id));
    },
  };
}
