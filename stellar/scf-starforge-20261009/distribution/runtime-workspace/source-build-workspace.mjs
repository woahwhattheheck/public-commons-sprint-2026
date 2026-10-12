// MIT. Product source selection and receiving through the original distribution engines.
import { constants } from 'node:fs';
import { lstat, realpath, readdir, open } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { openGitSource } from '../git-source.mjs';
import { distributionPath, contributionPaths, composeDistribution } from '../specification.mjs';
import { sourceSelectionDirectory, sourceSelectionPath, validateSourceSelection,
  selectedContributionPaths } from '../source-selection.mjs';
import { productPackageMetadata } from '../product-package.mjs';
import { buildDistribution } from '../build.mjs';
import { recoverCompletedDistribution } from '../build-state.mjs';
import { prepareRuntimeInstall, recoverRuntime, inspectRuntimeInstall } from '../runtime-install.mjs';
import { plain, need, now, digest, canonical, json, recordId, operationId, absolute,
  privateDirectory, makePrivate, readJSON, saveJSON, operationLease, operationRunning } from './storage.mjs';

const SCHEMA = 'stellar-forge.runtime-source-build-review.v1';
const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const identity = value => digest(json(canonical(value)));
const errorView = error => ({ code: error.code ?? 'SOURCE_BUILD_ERROR',
  message: String(error.message ?? error).slice(0, 2000) });
export const sourceBuildOperationFields = Object.freeze({
  'source-build': ['reviewId', 'selectionSha256'],
});

async function exists(path) {
  try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function optionalRecord(path) {
  try { return await readJSON(path); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}
function validBuildState(value) {
  need(plain(value) && ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'].includes(value.phase),
    'SOURCE_BUILD_OPERATION_STATE_INVALID');
  return value;
}
function sameBuildRequest(value, expected) {
  need(plain(value), 'SOURCE_BUILD_REQUEST_CHANGED');
  const { requestHash, createdAt, ...definition } = value;
  need(value.operation === 'source-build' && identity(definition) === requestHash &&
    requestHash === expected.requestHash, 'SOURCE_BUILD_REQUEST_CHANGED');
}
/** Finish only absent original records after a crash during request publication. */
export async function initializeSourceBuildRequest(root, id, value) {
  operationId(id); sameBuildRequest(value, value);
  const review = await readSourceBuildReview(root, value.reviewId);
  need(id === review.requestId && value.selectionSha256 === review.selectionSha256,
    'SOURCE_BUILD_REVIEW_CHANGED');
  const directory = await ensurePrivate(jobPath(root, id));
  const requestFile = join(directory, 'request.json'), stateFile = join(directory, 'state.json');
  const previousRequest = await optionalRecord(requestFile), previousState = await optionalRecord(stateFile);
  if (previousRequest !== undefined) sameBuildRequest(previousRequest, value);
  if (previousState !== undefined) validBuildState(previousState);
  if (previousRequest !== undefined && previousState !== undefined)
    return { reopened: true, needsSpawn: false };
  const lease = await operationLease(join(directory, 'worker.lock'));
  try {
    const saved = await optionalRecord(requestFile), state = await optionalRecord(stateFile);
    if (saved !== undefined) sameBuildRequest(saved, value);
    if (state !== undefined) {
      validBuildState(state);
      need(saved !== undefined, 'SOURCE_BUILD_REQUEST_MISSING');
      return { reopened: true, needsSpawn: false };
    }
    if (saved === undefined) await saveJSON(requestFile, value);
    await saveJSON(stateFile, { phase: 'QUEUED', updatedAt: now() });
    return { reopened: saved !== undefined, needsSpawn: true };
  } finally { await lease.close(); }
}

async function ensurePrivate(path) {
  try { return await makePrivate(path); }
  catch (error) { if (error.code !== 'EEXIST') throw error; return privateDirectory(path); }
}
export async function initializeSourceBuildWorkspace(root) {
  await privateDirectory(root);
  const base = await ensurePrivate(join(root, 'source-builds'));
  await ensurePrivate(join(base, 'reviews'));
  await ensurePrivate(join(base, 'builds'));
  return base;
}
const reviewPath = (base, id) => join(base, 'reviews', recordId(id) + '.json');
const buildPath = (base, id) => join(base, 'builds', recordId(id));
const jobPath = (root, id) => join(root, 'operations', operationId(id));
function program(value = 'python3') {
  need(typeof value === 'string' && value && value.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(value),
    'SOURCE_BUILD_PYTHON_REQUIRED');
  if (value.includes('/')) absolute(value);
  else need(/^[A-Za-z0-9_.+-]+$/.test(value), 'SOURCE_BUILD_PYTHON_REQUIRED');
  return value;
}
async function selectedSource(input) {
  need(plain(input), 'SOURCE_BUILD_INPUT_REQUIRED');
  const repository = absolute(input.repository), actual = await realpath(repository);
  need(actual === repository && (await lstat(actual)).isDirectory(),
    'SOURCE_BUILD_REAL_REPOSITORY_REQUIRED', 'Choose the actual absolute path of an existing Git repository.');
  const ref = input.ref ?? 'HEAD', offline = input.offline ?? true;
  need(typeof ref === 'string' && ref.length > 0 && ref.length <= 512 && !/[\u0000-\u001f\u007f]/.test(ref),
    'SOURCE_BUILD_REF_REQUIRED');
  need(typeof offline === 'boolean', 'SOURCE_BUILD_OFFLINE_BOOLEAN_REQUIRED');
  return { repository, offline, source: openGitSource({ repository, ref, offline }) };
}
function readInputs(source, paths) {
  const byPath = new Map(source.tree.map(item => [item.path, item]));
  const entries = paths.map(path => {
    const value = byPath.get(path);
    need(value, 'SOURCE_BUILD_INPUT_MISSING', 'Missing committed source: ' + path);
    return value;
  });
  const bytes = source.readFiles(entries);
  return {
    bytes,
    records: entries.map(item => ({ path: item.path, gitBlob: item.blob,
      bytes: bytes.get(item.path).length, sha256: digest(bytes.get(item.path)) })),
  };
}

/** Uses the same Git reader, recipe validator and composer as buildDistribution. */
export function describeProductSource(source, { repository, selection = 'all', offline = true, python = 'python3' }) {
  sourceSelectionPath(selection);
  const path = sourceSelectionPath(selection);
  const recipeInput = path ? readInputs(source, [path]) : null;
  const recipe = recipeInput ? validateSourceSelection(JSON.parse(recipeInput.bytes.get(path)), path) : undefined;
  const available = contributionPaths(source.tree.map(item => item.path));
  const paths = recipe ? selectedContributionPaths(available, recipe) : available;
  const inputPaths = [distributionPath, ...paths, ...(path ? [path] : [])];
  const original = readInputs(source, inputPaths);
  const composed = composeDistribution({
    base: JSON.parse(original.bytes.get(distributionPath)),
    contributions: paths.map(path => ({ path, data: JSON.parse(original.bytes.get(path)) })),
    selection: recipe,
  });
  const spec = composed.spec, product = productPackageMetadata(spec.product);
  need(spec.schema === 'stellar-forge.merchant-distribution.v1', 'SOURCE_BUILD_DISTRIBUTION_REQUIRED');
  const supporting = readInputs(source, ['LICENSE', product.readme]);
  return {
    schema: SCHEMA, repository, sourceCommit: source.commit, selection,
    title: recipe?.title ?? 'Complete toolkit', description: recipe?.description ?? product.description,
    offline, python: program(python), packageName: spec.name,
    packageVersion: spec.version + '-source.g' + source.commit.slice(0, 12) +
      (recipe ? '.selection.' + recipe.id : ''),
    product, distributionInputs: original.records, supportingInputs: supporting.records,
    commands: spec.commands, exports: spec.exports, components: spec.components,
    applications: Object.keys(spec.applicationProviders ?? {}).sort(),
    merchantProviders: Object.keys(spec.merchantProviders ?? {}).sort(),
    features: Object.keys(spec.featurePeers ?? {}).sort(),
    contributions: composed.contributions.map(({ id, path }) => ({ id, path })),
  };
}
export async function sourceBuildCatalog(input) {
  need(plain(input) && Object.keys(input).every(key => ['repository', 'ref', 'offline'].includes(key)),
    'SOURCE_BUILD_CATALOG_FIELDS_INVALID');
  const { repository, offline, source } = await selectedSource(input);
  const paths = source.tree.map(item => item.path)
    .filter(path => path.startsWith(sourceSelectionDirectory + '/') && path.endsWith('.json') &&
      !path.slice(sourceSelectionDirectory.length + 1).includes('/')).sort();
  const original = readInputs(source, [distributionPath, ...paths]);
  const base = JSON.parse(original.bytes.get(distributionPath));
  need(base.schema === 'stellar-forge.merchant-distribution.v1', 'SOURCE_BUILD_DISTRIBUTION_REQUIRED');
  const products = [{ id: 'all', title: 'Complete toolkit',
    description: productPackageMetadata(base.product).description, path: null, available: true }];
  for (const path of paths) {
    try {
      const recipe = validateSourceSelection(JSON.parse(original.bytes.get(path)), path);
      const record = original.records.find(item => item.path === path);
      products.push({ id: recipe.id, title: recipe.title, description: recipe.description ?? '',
        path, gitBlob: record.gitBlob, sha256: record.sha256, available: true });
    } catch (error) {
      products.push({ id: null, title: basename(path), path, available: false, error: errorView(error) });
    }
  }
  return { repository, sourceCommit: source.commit, offline, products };
}
function validateReview(value, id) {
  need(plain(value) && value.schema === SCHEMA && value.reviewId === id &&
    OID.test(value.sourceCommit ?? '') && typeof value.selectionSha256 === 'string',
  'SOURCE_BUILD_REVIEW_INVALID');
  const { reviewId, selectionSha256, requestId, reviewedAt, ...definition } = value;
  operationId(requestId);
  need(identity(definition) === selectionSha256 && selectionSha256.slice(0, 24) === reviewId,
    'SOURCE_BUILD_REVIEW_CHANGED');
  sourceSelectionPath(value.selection);
  absolute(value.repository); program(value.python);
  return value;
}
export async function readSourceBuildReview(root, id) {
  const base = await initializeSourceBuildWorkspace(root);
  return validateReview(await readJSON(reviewPath(base, id)), id);
}
export async function reviewSourceBuild(root, input) {
  need(plain(input) && Object.keys(input).every(key =>
    ['repository', 'ref', 'selection', 'offline', 'python'].includes(key)), 'SOURCE_BUILD_REVIEW_FIELDS_INVALID');
  need(OID.test(input.ref ?? ''), 'SOURCE_BUILD_COMMIT_REVIEW_REQUIRED',
    'Load the committed products, then review the resolved source commit.');
  const { repository, offline, source } = await selectedSource(input);
  const definition = describeProductSource(source, { repository, offline,
    selection: input.selection, python: input.python });
  const selectionSha256 = identity(definition), reviewId = selectionSha256.slice(0, 24);
  const base = await initializeSourceBuildWorkspace(root), file = reviewPath(base, reviewId);
  const value = { ...definition, selectionSha256, reviewId, requestId: randomUUID(), reviewedAt: now() };
  try { await saveJSON(file, value); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const saved = validateReview(await readJSON(file), reviewId);
  need(saved.selectionSha256 === selectionSha256, 'SOURCE_BUILD_REVIEW_COLLISION');
  return saved;
}
export async function sourceBuildWorkspaceState(root) {
  const base = await initializeSourceBuildWorkspace(root);
  const names = (await readdir(join(base, 'reviews'))).filter(name => /^[a-f0-9]{24}\.json$/.test(name));
  const builds = await Promise.all(names.map(async name => {
    const id = name.slice(0, -5), review = await readSourceBuildReview(root, id);
    const state = await optionalRecord(join(jobPath(root, review.requestId), 'state.json'));
    if (state !== undefined) validBuildState(state);
    const receipt = state?.result?.build ?? state?.sourceBuildReceipt ?? null;
    return { reviewId: id, selectionSha256: review.selectionSha256, requestId: review.requestId,
      title: review.title, selection: review.selection, repository: review.repository,
      sourceCommit: review.sourceCommit, packageName: review.packageName,
      packageVersion: review.packageVersion, reviewedAt: review.reviewedAt,
      output: join(buildPath(base, id), 'output'), phase: state?.phase ?? 'REVIEWED',
      stage: state?.sourceBuildStage ?? null, catalogDirectory: state?.sourceBuildCatalogDirectory ?? null,
      archiveId: state?.result?.archive?.id ?? null,
      archive: receipt ? { file: basename(receipt.archive), bytes: receipt.archiveBytes, sha256: receipt.sha256 } : null,
      error: state?.error ?? null };
  }));
  builds.sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt));
  return { builds };
}
export async function normalizeSourceBuildOperation(root, request, id) {
  const review = await readSourceBuildReview(root, request.reviewId);
  need(request.selectionSha256 === review.selectionSha256, 'SOURCE_BUILD_REVIEW_CHANGED');
  need(id === review.requestId, 'SOURCE_BUILD_ORIGINAL_REQUEST_REQUIRED',
    'Continue this product with the request returned by its saved review.');
  request.sourceBuildId = review.reviewId;
  request.sourceBuildOutput = join(buildPath(join(root, 'source-builds'), review.reviewId), 'output');
}
function checkReceipt(review, receipt, manifest) {
  need(receipt?.status === 'PACKAGED' && receipt.sourceCommit === review.sourceCommit &&
    receipt.packageName === review.packageName && receipt.packageVersion === review.packageVersion &&
    (receipt.sourceSelection?.id ?? 'all') === review.selection &&
    manifest?.sourceCommit === review.sourceCommit &&
    manifest.packageName === review.packageName && manifest.packageVersion === review.packageVersion &&
    (manifest.sourceSelection?.id ?? 'all') === review.selection &&
    identity(manifest.distributionInputs) === identity(review.distributionInputs),
  'SOURCE_BUILD_SELECTED_OUTPUT_CHANGED');
  for (const expected of review.supportingInputs) {
    if (expected.path === 'LICENSE') continue;
    const observed = manifest.files?.find(item => item.path === expected.path);
    need(observed?.sha256 === expected.sha256 && observed?.gitBlob === expected.gitBlob &&
      observed?.bytes === expected.bytes, 'SOURCE_BUILD_SUPPORTING_INPUT_CHANGED');
  }
  const license = review.supportingInputs.find(item => item.path === 'LICENSE');
  need(manifest.packageFiles?.LICENSE === license?.sha256, 'SOURCE_BUILD_LICENSE_CHANGED');
}
async function inspectCatalog(directory, review, receipt) {
  const plan = await readJSON(join(directory, 'runtime-install.json'));
  need(plan.archiveSha256 === receipt.sha256 && plan.source?.sourceCommit === review.sourceCommit &&
    plan.source?.packageVersion === review.packageVersion, 'SOURCE_BUILD_CATALOG_CHANGED');
  await inspectRuntimeInstall({ directory, load: false, source: true });
  return plan;
}
export async function executeSourceBuildOperation({ root, request, state, checkpoint, retainArchive }) {
  const review = await readSourceBuildReview(root, request.reviewId);
  need(request.selectionSha256 === review.selectionSha256, 'SOURCE_BUILD_REVIEW_CHANGED');
  const base = await initializeSourceBuildWorkspace(root), directory = await ensurePrivate(buildPath(base, review.reviewId));
  const output = join(directory, 'output');
  need(request.sourceBuildOutput === output && request.sourceBuildId === review.reviewId, 'SOURCE_BUILD_OUTPUT_CHANGED');
  await checkpoint({ sourceBuildStage: 'BUILDING', sourceBuildOutput: output });
  const build = await buildDistribution({
    repository: review.repository, ref: review.sourceCommit, selection: review.selection,
    output, offline: review.offline, python: review.python, resume: Boolean(await exists(output)),
    onProgress: event => process.stdout.write('[source build] ' + JSON.stringify(event) + '\n'),
  });
  need(build.archive && basename(build.archive).endsWith('.tgz'), 'SOURCE_BUILD_ARCHIVE_REQUIRED');
  checkReceipt(review, build, await readJSON(join(output, 'package', 'manifest.json')));
  await checkpoint({ sourceBuildStage: 'RECEIVING_SOURCE', sourceBuildReceipt: build });
  let attempt = state.sourceBuildCatalogAttempt ?? 1;
  need(Number.isSafeInteger(attempt) && attempt >= 1, 'SOURCE_BUILD_CATALOG_ATTEMPT_INVALID');
  let catalogDirectory = join(directory, 'catalog-' + attempt), previous = null, inspected = false;
  if (state.sourceBuildCatalogDirectory !== undefined)
    need(state.sourceBuildCatalogDirectory === catalogDirectory, 'SOURCE_BUILD_CATALOG_PATH_CHANGED');
  if (await exists(catalogDirectory)) {
    try { await inspectCatalog(catalogDirectory, review, build); inspected = true; }
    catch (error) {
      previous = catalogDirectory;
      catalogDirectory = join(directory, 'catalog-' + ++attempt);
      await checkpoint({ sourceBuildCatalogRecovery: { from: previous, error: errorView(error) } });
    }
  }
  await checkpoint({ sourceBuildCatalogAttempt: attempt, sourceBuildCatalogDirectory: catalogDirectory });
  if (!await exists(catalogDirectory)) {
    const preparation = previous ? await readJSON(join(previous, 'preparation.json'), true) : null;
    if (preparation) {
      need(preparation.archiveSha256 === build.sha256 && preparation.selection?.native === false &&
        preparation.selection?.operator === false && preparation.selection?.features?.length === 0 &&
        plain(preparation.selection?.pins) && Object.keys(preparation.selection.pins).length === 0,
      'SOURCE_BUILD_CATALOG_PREPARATION_CHANGED');
      await recoverRuntime({ from: previous, directory: catalogDirectory, install: false, python: review.python });
    } else {
      await prepareRuntimeInstall({ directory: catalogDirectory, archive: build.archive, sha256: build.sha256,
        python: review.python, ...(previous ? { from: previous } : {}) });
    }
  }
  if (!inspected) await inspectCatalog(catalogDirectory, review, build);
  const archive = await retainArchive(catalogDirectory, review.title);
  need(archive.sha256 === build.sha256 && archive.sourceCommit === review.sourceCommit, 'SOURCE_BUILD_RECEIVED_ARCHIVE_CHANGED');
  await checkpoint({ sourceBuildStage: 'SOURCE_READY' });
  return { status: 'SOURCE_READY', reviewId: review.reviewId, selectionSha256: review.selectionSha256,
    build, catalogDirectory, archive };
}
export async function recoverSourceBuildOperation(root, id) {
  operationId(id);
  const directory = jobPath(root, id), lease = await operationLease(join(directory, 'worker.lock'));
  try {
    const request = await readJSON(join(directory, 'request.json'));
    const { requestHash, createdAt, ...definition } = request;
    need(request.operation === 'source-build' && identity(definition) === requestHash, 'SOURCE_BUILD_REQUEST_CHANGED');
    const review = await readSourceBuildReview(root, request.reviewId);
    need(review.requestId === id && request.selectionSha256 === review.selectionSha256, 'SOURCE_BUILD_REVIEW_CHANGED');
    const output = join(buildPath(join(root, 'source-builds'), review.reviewId), 'output');
    if (await exists(output)) need(!await operationRunning(join(output, 'build.lock')),
      'DISTRIBUTION_BUILD_ALREADY_RUNNING', 'The original package worker still owns this build.', 409);
    let state = await optionalRecord(join(directory, 'state.json'));
    if (state === undefined) {
      state = { phase: 'QUEUED', updatedAt: now() };
      await saveJSON(join(directory, 'state.json'), state);
    }
    validBuildState(state);
    if (state.phase === 'SUCCEEDED') return { operationId: id, completed: true, result: state.result };
    need(['FAILED', 'RUNNING', 'QUEUED'].includes(state.phase), 'SOURCE_BUILD_OPERATION_STATE_INVALID');
    if (state.phase !== 'QUEUED') {
      const history = [...(state.sourceBuildRecoveryHistory ?? []), {
        attempt: state.attempt ?? 1, phase: state.phase, stage: state.sourceBuildStage ?? null,
        error: state.error ?? null, catalogDirectory: state.sourceBuildCatalogDirectory ?? null, recoveredAt: now(),
      }];
      await saveJSON(join(directory, 'state.json'), { ...state, phase: 'QUEUED', updatedAt: now(),
        attempt: (state.attempt ?? 1) + 1, sourceBuildRecoveryHistory: history }, true);
    }
    return { operationId: id, reviewId: review.reviewId, resume: true };
  } finally { await lease.close(); }
}
export async function openSourceBuildArchive(root, id) {
  const review = await readSourceBuildReview(root, id), output = join(buildPath(join(root, 'source-builds'), id), 'output');
  const receipt = await recoverCompletedDistribution(output, review.sourceCommit, review.selection);
  need(receipt, 'SOURCE_BUILD_ARCHIVE_NOT_READY');
  checkReceipt(review, receipt, await readJSON(join(output, 'package', 'manifest.json')));
  const handle = await open(receipt.archive, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    need(before.isFile() && before.size === receipt.archiveBytes && before.size <= 64 * 1024 * 1024,
      'SOURCE_BUILD_ARCHIVE_CHANGED');
    const hash = createHash('sha256'), buffer = Buffer.alloc(256 * 1024); let position = 0;
    while (position < before.size) {
      const part = await handle.read(buffer, 0, Math.min(buffer.length, before.size - position), position);
      need(part.bytesRead > 0, 'SOURCE_BUILD_ARCHIVE_CHANGED');
      hash.update(buffer.subarray(0, part.bytesRead)); position += part.bytesRead;
    }
    const after = await handle.stat();
    need(before.size === after.size && before.mtimeMs === after.mtimeMs &&
      before.ctimeMs === after.ctimeMs && hash.digest('hex') === receipt.sha256, 'SOURCE_BUILD_ARCHIVE_CHANGED');
    return { handle, bytes: before.size, sha256: receipt.sha256, file: basename(receipt.archive), type: 'application/gzip' };
  } catch (error) { await handle.close(); throw error; }
}
