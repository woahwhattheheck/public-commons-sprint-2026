// MIT. Reviewed original Sheets publication -> the original SF82 dataset lifecycle.
import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath, readdir, rm, rmdir, link, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DATASET_BINDING_SCHEMA, datasetContractSha256, prepareDatasetRelease } from '../../sf82-seller-pilot/release-dataset.mjs';
import { buildDatasetSellerConfig } from '../dataset-cli.mjs';
import { DATASET_SNAPSHOT_PARAMETER } from '../dataset-refresh/versions.mjs';
import { object, bytes, digest, identity, readPrivate, hashPrivate, createFile,
  privateDirectory, syncDirectory, acquireWorkspace, fault } from '../postgres/publisher/files.mjs';

const MiB = 1024 * 1024, MAX_CSV = 256 * MiB, HASH = /^[a-f0-9]{64}$/;
export const SHEETS_DEPLOYMENT_SCHEMA = 'stellar-forge.sheets-dataset-deployment.v1';
export const SHEETS_DEPLOYMENT_FILES = Object.freeze(['dataset.csv', 'dataset.json', 'seller.json', 'source.json', 'binding.json']);
const STAGE = /^\.sheets-deployment-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.tmp$/;
const fail = (code, message = code, status = 409) => { throw fault(code, message, status); };
const same = (a, b) => identity(a) === identity(b);
function parse(content) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content)); }
  catch { fail('SHEETS_DEPLOYMENT_JSON_INVALID'); }
}
function selectedPublication(publisher, runId, version) {
  if (!publisher || publisher.settings?.schema !== 'stellar-forge.sheets-publisher-workspace.v1' ||
      typeof publisher.candidate !== 'function' || typeof publisher.run !== 'function')
    fail('SHEETS_DEPLOYMENT_PUBLISHER_REQUIRED', 'Use the original Sheets publisher for this source workspace.');
  if (!version || !Number.isSafeInteger(version.id) || version.id < 1 ||
      !HASH.test(version.sourceSha256 ?? '') || !HASH.test(version.observationSha256 ?? ''))
    fail('SHEETS_DEPLOYMENT_VERSION_REQUIRED', 'Select an original saved Sheets source version.');
  const saved = publisher.run(runId), plan = publisher.plan(saved.plan);
  const candidate = saved.data?.candidate, review = saved.data?.review, publication = saved.data?.publication;
  if (saved.state !== 'PUBLISHED' || !candidate || !review || !publication ||
      candidate.schema !== 'stellar-forge.sheets-dataset-candidate.v1' ||
      review.candidateDigest !== candidate.candidateDigest || publication.snapshot !== candidate.dataset?.snapshot)
    fail('SHEETS_DEPLOYMENT_PUBLISHED_RUN_REQUIRED', 'Select an originally reviewed and published Sheets extraction.');
  if (plan.data.sourceHash !== version.sourceSha256 || candidate.sourceHash !== version.sourceSha256 ||
      candidate.planDigest !== plan.data.digest)
    fail('SHEETS_DEPLOYMENT_SOURCE_VERSION_CHANGED', 'This published extraction belongs to a different saved source version.');
  return { runId: saved.id, planId: saved.plan, sourceVersion: version.id, sourceSha256: version.sourceSha256,
    candidateDigest: candidate.candidateDigest, planDigest: plan.data.digest, reviewId: review.id,
    publication: structuredClone(publication) };
}
function checkedTerms(input) {
  if (!object(input) || Object.keys(input).some(key => !['origin', 'path', 'payment'].includes(key)) ||
      typeof input.origin !== 'string' || typeof input.path !== 'string' || !object(input.payment))
    fail('SHEETS_DEPLOYMENT_TERMS_REQUIRED', 'Review the public HTTPS origin, fixed route and original payment terms.', 400);
  return structuredClone(input);
}
async function reviewedInput({ publisher, runId, version, terms }) {
  const selected = selectedPublication(publisher, runId, version), normalizedTerms = checkedTerms(terms);
  const { manifest, configPath } = await publisher.candidate(runId);
  if (manifest.candidateDigest !== selected.candidateDigest || manifest.dataset.snapshot !== selected.publication.snapshot)
    fail('SHEETS_DEPLOYMENT_PUBLICATION_CHANGED');
  const originalConfig = await readPrivate(configPath, MiB);
  if (digest(originalConfig) !== manifest.configHash) fail('SHEETS_DEPLOYMENT_CONFIG_CHANGED');
  const config = parse(originalConfig);
  if (!object(config)) fail('SHEETS_DEPLOYMENT_CONFIG_INVALID');
  const configBytes = bytes({ ...config, file: 'dataset.csv' });
  let merchant;
  try {
    merchant = await buildDatasetSellerConfig({ describe: () => structuredClone(manifest.dataset) }, normalizedTerms);
    merchant.routes[0].definition.queryParameters.push({ ...DATASET_SNAPSHOT_PARAMETER });
  } catch (issue) {
    fail('SHEETS_DEPLOYMENT_TERMS_INVALID', issue.message ?? 'Review the original public seller terms.', 400);
  }
  const merchantBytes = bytes(merchant);
  const source = {
    schema: SHEETS_DEPLOYMENT_SCHEMA,
    sourceVersion: { id: version.id, sourceSha256: version.sourceSha256,
      observationSha256: version.observationSha256, mode: version.mode,
      columns: manifest.dataset.columns.map(column => column.name) },
    candidate: { runId: selected.runId, planId: selected.planId, planDigest: manifest.planDigest,
      candidateDigest: manifest.candidateDigest, originalConfigSha256: manifest.configHash,
      releaseConfigSha256: digest(configBytes), csvSha256: manifest.csvHash, csvBytes: manifest.csvBytes,
      dataset: structuredClone(manifest.dataset) },
    publication: { reviewId: selected.reviewId, snapshot: selected.publication.snapshot,
      revision: selected.publication.revision, mode: selected.publication.mode,
      recordedAt: selected.publication.recordedAt },
    merchant: { configurationSha256: digest(merchantBytes) }
  };
  const sourceBytes = bytes(source);
  const review = {
    schema: 'stellar-forge.sheets-deployment-review.v1', sourceVersion: version.id,
    sourceSha256: version.sourceSha256, observationSha256: version.observationSha256,
    runId: selected.runId, planId: selected.planId, candidateDigest: selected.candidateDigest,
    snapshot: manifest.dataset.snapshot, rows: manifest.dataset.rowCount,
    dataset: structuredClone(manifest.dataset), terms: normalizedTerms,
    sellerSha256: digest(merchantBytes), packageSourceSha256: digest(sourceBytes),
    reviewSha256: identity({ source, config: parse(configBytes), merchant })
  };
  if (!same(selectedPublication(publisher, runId, version), selected))
    fail('SHEETS_DEPLOYMENT_PUBLICATION_CHANGED');
  return { selected, manifest, configPath, configBytes, merchantBytes, source, sourceBytes, review };
}
/** Uses the retained native candidate, never Google, a new extraction or a version writer. */
export async function reviewSheetsDeployment(options = {}) {
  return (await reviewedInput(options)).review;
}
function overlaps(a, b) {
  const inside = (parent, child) => { const tail = relative(parent, child);
    return !tail || !isAbsolute(tail) && tail !== '..' && !tail.startsWith('..' + sep); };
  return inside(a, b) || inside(b, a);
}
async function collectAbandoned(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!STAGE.test(entry.name)) continue;
    const path = join(directory, entry.name);
    await privateDirectory(path);
    for (const child of await readdir(path)) {
      const stat = await lstat(join(path, child));
      if (!SHEETS_DEPLOYMENT_FILES.includes(child) || !stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077)
        fail('SHEETS_DEPLOYMENT_STAGE_CHANGED', 'Preserve the changed staging directory and select a new package request.');
    }
    await rm(path, { recursive: true });
  }
}
async function copyCsv(source, target, expected) {
  let input, output;
  try {
    if (await realpath(source) !== resolve(source)) fail('SHEETS_DEPLOYMENT_SOURCE_SYMLINK');
    input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await input.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.mode & 0o077n ||
        before.size !== BigInt(expected.csvBytes) || before.size > BigInt(MAX_CSV))
      fail('SHEETS_DEPLOYMENT_CSV_CHANGED');
    output = await open(target, 'wx', 0o600);
    const hash = createHash('sha256'); let size = 0;
    for await (const chunk of input.createReadStream({ autoClose: false, highWaterMark: 256 * 1024 })) {
      size += chunk.length;
      if (size > expected.csvBytes || size > MAX_CSV) fail('SHEETS_DEPLOYMENT_CSV_CHANGED');
      hash.update(chunk); await output.writeFile(chunk);
    }
    const after = await input.stat({ bigint: true });
    if (size !== expected.csvBytes || hash.digest('hex') !== expected.csvHash ||
        after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs)
      fail('SHEETS_DEPLOYMENT_CSV_CHANGED');
    await output.sync();
  } finally { try { await input?.close(); } finally { await output?.close(); } }
}
async function publishFile(staging, directory, file) {
  const source = join(staging, file), target = join(directory, file), maximum = file.endsWith('.csv') ? MAX_CSV : MiB;
  const expected = await hashPrivate(source, maximum);
  try { await link(source, target); }
  catch (issue) {
    if (issue.code !== 'EEXIST') throw issue;
    const saved = await hashPrivate(target, maximum);
    if (saved.hash !== expected.hash || saved.bytes !== expected.bytes)
      fail('SHEETS_DEPLOYMENT_PACKAGE_CONFLICT', 'This request directory retains different package bytes.');
  }
  await unlink(source);
  return { file, bytes: expected.bytes, sha256: expected.hash };
}
function validateSource(source, dataset, sellerSha256) {
  const version = source?.sourceVersion, candidate = source?.candidate;
  if (source?.schema !== SHEETS_DEPLOYMENT_SCHEMA || !object(version) || !object(candidate) ||
      !Number.isSafeInteger(version.id) || version.id < 1 || !HASH.test(version.sourceSha256 ?? '') ||
      !HASH.test(version.observationSha256 ?? '') || !HASH.test(candidate.candidateDigest ?? '') ||
      !HASH.test(candidate.planDigest ?? '') || !HASH.test(candidate.originalConfigSha256 ?? '') ||
      candidate.csvSha256 !== dataset.csvSha256 || candidate.releaseConfigSha256 !== dataset.sourceConfigSha256 ||
      !same(candidate.dataset, dataset.description) || source.publication?.snapshot !== dataset.baselineSnapshot ||
      source.merchant?.configurationSha256 !== sellerSha256)
    fail('SHEETS_DEPLOYMENT_BINDING_CHANGED', 'The source, candidate or public seller terms differ from this retained native package.');
  return source;
}
function summary(directory, prepared, source, files) {
  return { schema: SHEETS_DEPLOYMENT_SCHEMA, packageDirectory: directory,
    sourceVersion: source.sourceVersion.id, sourceSha256: prepared.dataset.sourceSha256,
    candidateDigest: source.candidate.candidateDigest, runId: source.candidate.runId,
    dataset: structuredClone(prepared.dataset), files,
    sellerSha256: source.merchant.configurationSha256,
    bindingScope: 'The release uses this original host-local dataset directory; it does not create, migrate or rewind the dataset version store.' };
}
/** Identical-input recovery completes these same five files without another extraction. */
export async function prepareSheetsDeployment({ publisher, runId, version, terms, expectedReviewSha256, directory } = {}) {
  if (!HASH.test(expectedReviewSha256 ?? '')) fail('SHEETS_DEPLOYMENT_REVIEW_REQUIRED');
  const input = await reviewedInput({ publisher, runId, version, terms });
  if (input.review.reviewSha256 !== expectedReviewSha256) fail('SHEETS_DEPLOYMENT_REVIEW_CHANGED');
  if (typeof directory !== 'string' || !isAbsolute(directory)) fail('SHEETS_DEPLOYMENT_DIRECTORY_REQUIRED');
  const target = resolve(directory), datasetDirectory = resolve(publisher.settings.targetDirectory);
  if (overlaps(target, resolve(publisher.directory)) || overlaps(target, datasetDirectory))
    fail('SHEETS_DEPLOYMENT_DIRECTORY_OVERLAP');
  await privateDirectory(datasetDirectory);
  await privateDirectory(target, true);
  const release = await acquireWorkspace(target);
  let staging;
  try {
    await collectAbandoned(target);
    staging = join(target, '.sheets-deployment-' + randomUUID() + '.tmp');
    await mkdir(staging, { mode: 0o700 });
    await copyCsv(join(dirname(input.configPath), 'data.csv'), join(staging, 'dataset.csv'), input.manifest);
    await createFile(join(staging, 'dataset.json'), input.configBytes);
    await createFile(join(staging, 'seller.json'), input.merchantBytes);
    await createFile(join(staging, 'source.json'), input.sourceBytes);
    await createFile(join(staging, 'binding.json'), bytes({ schema: DATASET_BINDING_SCHEMA, datasetDirectory,
      contractSha256: datasetContractSha256(input.manifest.dataset),
      baselineSnapshot: input.manifest.dataset.snapshot, sourceSha256: digest(input.sourceBytes) }));
    await syncDirectory(staging);
    const prepared = await prepareDatasetRelease(staging);
    validateSource(input.source, prepared.dataset, digest(input.merchantBytes));
    if (!same(selectedPublication(publisher, runId, version), input.selected))
      fail('SHEETS_DEPLOYMENT_PUBLICATION_CHANGED');
    const files = [];
    for (const file of SHEETS_DEPLOYMENT_FILES) files.push(await publishFile(staging, target, file));
    await rmdir(staging); staging = null; await syncDirectory(target);
    const verified = await prepareDatasetRelease(target);
    validateSource(parse(verified.retained['source.json']), verified.dataset, digest(verified.retained['seller.json']));
    return { ...summary(target, verified, input.source, files), reviewSha256: expectedReviewSha256 };
  } finally {
    try { if (staging) await rm(staging, { recursive: true, force: true }); }
    finally { await release(); }
  }
}
export async function inspectSheetsDeployment(directory) {
  const target = resolve(directory), prepared = await prepareDatasetRelease(target);
  const source = validateSource(parse(prepared.retained['source.json']), prepared.dataset, digest(prepared.retained['seller.json']));
  return summary(target, prepared, source, prepared.files.map(item => ({ ...item, file: basename(item.file) })));
}
/** Original retained release IDs and runtime normalization remain authoritative. */
export async function stageSheetsDeployment({ packageDirectory, releaseDirectory, id, label, runtime = { port: 0 }, expectedSourceSha256 } = {}) {
  if (!HASH.test(expectedSourceSha256 ?? '')) fail('SHEETS_DEPLOYMENT_PACKAGE_REVIEW_REQUIRED');
  const { initReleaseStore, inspectRelease, stageRelease, normalizeReleaseRuntime } = await import('../../sf82-seller-pilot/releases.mjs');
  if (!object(runtime) || Object.keys(runtime).some(key => !['port', 'facilitator', 'allowLocalFacilitator'].includes(key)))
    fail('SHEETS_DEPLOYMENT_RUNTIME_INVALID', 'Use the original dataset release port and facilitator options.', 400);
  const normalizedRuntime = normalizeReleaseRuntime(runtime), selectedLabel = label ?? id;
  if (typeof selectedLabel !== 'string' || !selectedLabel.trim() || selectedLabel.length > 240 || /[\u0000-\u001f\u007f]/.test(selectedLabel))
    fail('SHEETS_DEPLOYMENT_LABEL_INVALID', 'Use a plain release label.', 400);
  const prepared = await inspectSheetsDeployment(packageDirectory), root = resolve(releaseDirectory);
  if (overlaps(root, prepared.packageDirectory) || overlaps(root, resolve(prepared.dataset.datasetDirectory)))
    fail('SHEETS_DEPLOYMENT_RELEASE_DIRECTORY_OVERLAP');
  if (prepared.sourceSha256 !== expectedSourceSha256) fail('SHEETS_DEPLOYMENT_PACKAGE_CHANGED');
  await initReleaseStore(root);
  let existing;
  try { existing = await inspectRelease(root, id); } catch (issue) { if (issue.code !== 'ENOENT') throw issue; }
  if (existing) {
    if (existing.source?.kind !== 'VERSIONED_DATASET_PACKAGE' || !same(existing.dataset, prepared.dataset) ||
        existing.label !== selectedLabel.trim() || !same(existing.runtime, normalizedRuntime))
      fail('SHEETS_DEPLOYMENT_RELEASE_ID_USED', 'This original release ID belongs to different source or runtime settings.');
    return { reused: true, release: existing };
  }
  return { reused: false, release: await stageRelease(root, {
    id, label: selectedLabel, datasetPackage: prepared.packageDirectory, runtime: normalizedRuntime }) };
}
export async function readSheetsDeploymentFile(directory, filename) {
  if (!SHEETS_DEPLOYMENT_FILES.includes(filename)) fail('SHEETS_DEPLOYMENT_FILE_UNKNOWN', 'Choose an original file in the prepared package.', 404);
  const prepared = await inspectSheetsDeployment(directory), expected = prepared.files.find(item => item.file === filename);
  const content = await readPrivate(join(prepared.packageDirectory, filename), filename.endsWith('.csv') ? MAX_CSV : MiB);
  if (content.length !== expected.bytes || digest(content) !== expected.sha256) fail('SHEETS_DEPLOYMENT_FILE_CHANGED');
  return { filename, mime: filename.endsWith('.csv') ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
    bytes: content, sha256: expected.sha256 };
}
