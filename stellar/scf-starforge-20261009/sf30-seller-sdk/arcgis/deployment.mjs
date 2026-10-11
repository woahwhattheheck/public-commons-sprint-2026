// MIT. Reviewed ArcGIS publication -> the original SF82 dataset release lifecycle.
import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath, readdir, rm, link, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DATASET_BINDING_SCHEMA, datasetContractSha256, prepareDatasetRelease } from '../../sf82-seller-pilot/release-dataset.mjs';
import { prepareArcgisReceiving } from './receiving.mjs';
import { object, bytes, digest, identity, readPrivate, hashPrivate, createFile,
  privateDirectory, syncDirectory, acquireWorkspace, fault } from '../postgres/publisher/files.mjs';

const MiB = 1024 * 1024, MAX_CSV = 256 * MiB, HASH = /^[a-f0-9]{64}$/;
const SOURCE_SCHEMA = 'stellar-forge.arcgis-dataset-deployment.v1';
const FILES = ['source.json', 'dataset.csv', 'dataset.json', 'seller.json', 'binding.json', 'arcgis-receiving.json'];
const STAGE = /^\.arcgis-deployment-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.tmp$/;
const fail = (code, message = code) => { throw fault(code, message); };
const same = (a, b) => identity(a) === identity(b);
function parse(content) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content)); }
  catch { fail('ARCGIS_DEPLOYMENT_JSON_INVALID'); }
}
function selectedPublication(publisher, run) {
  if (!publisher || typeof publisher.candidate !== 'function' || typeof publisher.run !== 'function' ||
      typeof publisher.directory !== 'string' || !publisher.settings?.targetDirectory)
    fail('ARCGIS_PUBLISHER_REQUIRED');
  const saved = publisher.run(run), candidate = saved.data?.candidate, review = saved.data?.review, publication = saved.data?.publication;
  if (saved.state !== 'PUBLISHED' || !candidate || !review || !publication ||
      review.candidateDigest !== candidate.candidateDigest || publication.snapshot !== candidate.dataset?.snapshot)
    fail('ARCGIS_PUBLISHED_CANDIDATE_REQUIRED', 'Select an originally reviewed and published ArcGIS extraction.');
  return { run: saved.id, plan: saved.plan, candidateDigest: candidate.candidateDigest,
    reviewId: review.id, publication: structuredClone(publication) };
}
function overlaps(a, b) {
  const inside = (parent, child) => { const tail = relative(parent, child); return !tail ||
    !isAbsolute(tail) && tail !== '..' && !tail.startsWith('..' + sep); };
  return inside(a, b) || inside(b, a);
}
async function collectAbandoned(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!STAGE.test(entry.name)) continue;
    const path = join(directory, entry.name);
    await privateDirectory(path);
    for (const child of await readdir(path)) {
      const stat = await lstat(join(path, child));
      if (!FILES.includes(child) || !stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077)
        fail('ARCGIS_DEPLOYMENT_STAGE_CHANGED', 'Preserve the changed temporary package and select a fresh export directory.');
    }
    await rm(path, { recursive: true });
  }
}
async function copyCsv(source, target, expected) {
  let input, output;
  try {
    if (await realpath(source) !== resolve(source)) fail('ARCGIS_DEPLOYMENT_SOURCE_SYMLINK');
    input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await input.stat();
    if (!before.isFile() || before.nlink !== 1 || before.mode & 0o077 ||
        before.size !== expected.csvBytes || before.size > MAX_CSV) fail('ARCGIS_DEPLOYMENT_CSV_CHANGED');
    output = await open(target, 'wx', 0o600);
    const hash = createHash('sha256'); let size = 0;
    for await (const chunk of input.createReadStream({ autoClose: false, highWaterMark: 256 * 1024 })) {
      size += chunk.length;
      if (size > expected.csvBytes || size > MAX_CSV) fail('ARCGIS_DEPLOYMENT_CSV_CHANGED');
      hash.update(chunk); await output.writeFile(chunk);
    }
    const after = await input.stat();
    if (size !== expected.csvBytes || hash.digest('hex') !== expected.csvHash ||
        after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
      fail('ARCGIS_DEPLOYMENT_CSV_CHANGED');
    await output.sync();
  } finally { try { await input?.close(); } finally { await output?.close(); } }
}
async function publishFile(staging, directory, file) {
  const source = join(staging, file), target = join(directory, file), maximum = file.endsWith('.csv') ? MAX_CSV : MiB;
  const expected = await hashPrivate(source, maximum);
  try { await link(source, target); }
  catch (issue) {
    if (issue.code !== 'EEXIST') throw issue;
    const retained = await hashPrivate(target, maximum);
    if (retained.hash !== expected.hash || retained.bytes !== expected.bytes)
      fail('ARCGIS_DEPLOYMENT_EXISTS', 'This package directory belongs to different retained inputs. Use a new directory.');
  }
  await unlink(source);
  return { file, bytes: expected.bytes, sha256: expected.hash };
}
function validateSource(source, dataset, sellerSha256) {
  const candidate = source?.candidate, receiving = source?.receiving, declaration = receiving?.declaration;
  if (!object(source) || source.schema !== SOURCE_SCHEMA || !object(candidate) ||
      !HASH.test(candidate.candidateDigest ?? '') || !HASH.test(candidate.planDigest ?? '') ||
      !HASH.test(candidate.originalConfigSha256 ?? '') || candidate.csvSha256 !== dataset.csvSha256 ||
      candidate.releaseConfigSha256 !== dataset.sourceConfigSha256 ||
      !same(candidate.dataset, dataset.description) || !object(source.publication) ||
      source.publication.snapshot !== dataset.baselineSnapshot ||
      !object(source.merchant) || !HASH.test(source.merchant.configurationSha256 ?? '') ||
      sellerSha256 !== undefined && source.merchant.configurationSha256 !== sellerSha256 ||
      !object(receiving) || receiving.sha256 !== digest(bytes(declaration)) ||
      declaration?.schema !== 'stellar-forge.arcgis-receiving.v1' ||
      !same(declaration.dataset, { name: dataset.description.name, snapshot: dataset.baselineSnapshot }))
    fail('ARCGIS_DEPLOYMENT_BINDING_CHANGED', 'The ArcGIS candidate, merchant or receiving declaration differs from this original release.');
  return source;
}
function summary(directory, prepared, source, files) {
  return { schema: SOURCE_SCHEMA, packageDirectory: directory, sourceSha256: prepared.dataset.sourceSha256,
    candidateDigest: source.candidate.candidateDigest, run: source.candidate.run,
    dataset: structuredClone(prepared.dataset), files,
    receiving: { sha256: source.receiving.sha256, dataset: source.receiving.declaration.dataset },
    bindingScope: 'The release reopens this existing host-local dataset directory. It does not initialize or migrate a version store.' };
}

/** Export only a native published candidate. Repeating identical inputs completes the same package. */
export async function exportArcgisDeployment({ publisher, run, sellerFile, directory } = {}) {
  const selected = selectedPublication(publisher, run);
  const target = resolve(directory), datasetDirectory = resolve(publisher.settings.targetDirectory), merchantFile = resolve(sellerFile);
  if (overlaps(target, resolve(publisher.directory)) || overlaps(target, datasetDirectory))
    fail('ARCGIS_DEPLOYMENT_DIRECTORY_OVERLAP', 'Keep the prepared package outside the publisher and original dataset store.');
  await privateDirectory(datasetDirectory);
  if (await realpath(merchantFile) !== merchantFile) fail('ARCGIS_DEPLOYMENT_SELLER_SYMLINK');
  await privateDirectory(target, true);
  const release = await acquireWorkspace(target);
  let staging;
  try {
    await collectAbandoned(target);
    staging = join(target, '.arcgis-deployment-' + randomUUID() + '.tmp');
    await mkdir(staging, { mode: 0o700 });
    // Keep only immutable descriptions, never a second retained in-memory dataset.
    const { manifest, configPath } = await publisher.candidate(run);
    if (manifest.candidateDigest !== selected.candidateDigest ||
        manifest.dataset.snapshot !== selected.publication.snapshot)
      fail('ARCGIS_PUBLICATION_CHANGED');
    const originalConfig = await readPrivate(configPath, MiB), merchant = await readPrivate(merchantFile, MiB);
    if (digest(originalConfig) !== manifest.configHash) fail('ARCGIS_DEPLOYMENT_CONFIG_CHANGED');
    const config = parse(originalConfig);
    if (!object(config)) fail('ARCGIS_DEPLOYMENT_CONFIG_INVALID');
    const configBytes = bytes({ ...config, file: 'dataset.csv' });
    await copyCsv(join(dirname(configPath), 'data.csv'), join(staging, 'dataset.csv'), manifest);
    await createFile(join(staging, 'dataset.json'), configBytes);
    await createFile(join(staging, 'seller.json'), merchant);
    const receiving = await prepareArcgisReceiving({ publisher, run, output: join(staging, 'arcgis-receiving.json') });
    const declaration = parse(await readPrivate(receiving.path, MiB));
    const source = {
      schema: SOURCE_SCHEMA,
      candidate: { run: selected.run, plan: selected.plan, planDigest: manifest.planDigest,
        candidateDigest: manifest.candidateDigest, originalConfigSha256: manifest.configHash,
        releaseConfigSha256: digest(configBytes), csvSha256: manifest.csvHash, csvBytes: manifest.csvBytes,
        dataset: structuredClone(manifest.dataset) },
      publication: { reviewId: selected.reviewId, snapshot: selected.publication.snapshot,
        revision: selected.publication.revision, mode: selected.publication.mode,
        recordedAt: selected.publication.recordedAt },
      merchant: { configurationSha256: digest(merchant) },
      receiving: { sha256: receiving.sha256, declaration }
    };
    const sourceBytes = bytes(source);
    if (sourceBytes.length > MiB) fail('ARCGIS_DEPLOYMENT_SOURCE_TOO_LARGE', 'The original dataset release supports a source declaration up to 1 MiB.');
    await createFile(join(staging, 'source.json'), sourceBytes);
    await createFile(join(staging, 'binding.json'), bytes({
      schema: DATASET_BINDING_SCHEMA, datasetDirectory,
      contractSha256: datasetContractSha256(manifest.dataset),
      baselineSnapshot: manifest.dataset.snapshot, sourceSha256: digest(sourceBytes)
    }));
    await syncDirectory(staging);
    const prepared = await prepareDatasetRelease(staging);
    validateSource(source, prepared.dataset, digest(merchant));
    if (!same(selectedPublication(publisher, run), selected)) fail('ARCGIS_PUBLICATION_CHANGED');
    const files = [];
    for (const file of FILES) files.push(await publishFile(staging, target, file));
    await rm(staging); staging = null; await syncDirectory(target);
    return summary(target, prepared, source, files);
  } finally {
    try { if (staging) await rm(staging, { recursive: true, force: true }); }
    finally { await release(); }
  }
}

/** Inspect the same immutable prepared package without opening a publisher or version writer. */
export async function inspectArcgisDeployment(directory) {
  const target = resolve(directory), prepared = await prepareDatasetRelease(target);
  const source = validateSource(parse(prepared.retained['source.json']), prepared.dataset, digest(prepared.retained['seller.json']));
  return summary(target, prepared, source, prepared.files.map(item => ({ ...item, file: basename(item.file) })));
}

/** Stage through the original SF82 engine; an identical retained release ID is safe to reopen. */
export async function stageArcgisDeployment({ packageDirectory, releaseDirectory, id, label, runtime = { port: 0 } } = {}) {
  const { initReleaseStore, readReleaseState, inspectRelease, stageRelease, normalizeReleaseRuntime } =
    await import('../../sf82-seller-pilot/releases.mjs');
  if (!object(runtime) || Object.keys(runtime).some(key => !['port', 'facilitator', 'allowLocalFacilitator'].includes(key)))
    fail('ARCGIS_DEPLOYMENT_RUNTIME_INVALID', 'Use the original dataset release port and facilitator options.');
  const normalizedRuntime = normalizeReleaseRuntime(runtime), selectedLabel = label ?? id;
  if (typeof selectedLabel !== 'string' || selectedLabel.length > 240 ||
      !selectedLabel.trim() || /[\u0000-\u001f\u007f]/.test(selectedLabel))
    fail('ARCGIS_DEPLOYMENT_LABEL_INVALID');
  const prepared = await inspectArcgisDeployment(packageDirectory), root = resolve(releaseDirectory);
  try { await readReleaseState(root); }
  catch (issue) {
    if (issue.code !== 'ENOENT') throw issue;
    const present = await lstat(root).then(() => true, error => {
      if (error.code !== 'ENOENT') throw error; return false;
    });
    if (present) fail('ARCGIS_RELEASE_STORE_INCOMPLETE',
      'This existing release directory has no readable native state. Preserve it and reopen the original store.');
    try { await initReleaseStore(root); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // Another original owner may have initialized it after our missing-root read.
      await readReleaseState(root);
    }
  }
  let existing;
  try { existing = await inspectRelease(root, id); }
  catch (issue) { if (issue.code !== 'ENOENT') throw issue; }
  if (existing) {
    if (existing.source?.kind !== 'VERSIONED_DATASET_PACKAGE' ||
        !same(existing.dataset, prepared.dataset) ||
        existing.label !== selectedLabel.trim() || !same(existing.runtime, normalizedRuntime))
      fail('ARCGIS_DEPLOYMENT_RELEASE_ID_USED', 'This release ID belongs to different source or runtime settings. Retain it and choose a new ID.');
    return { reused: true, release: existing };
  }
  return { reused: false, release: await stageRelease(root, {
    id, label: selectedLabel, datasetPackage: prepared.packageDirectory, runtime: normalizedRuntime
  }) };
}

async function writeExactOutput(output, content) {
  const target = resolve(output), parent = dirname(target);
  await privateDirectory(parent, true);
  const release = await acquireWorkspace(parent);
  const prefix = '.arcgis-release-receiving-' + digest(Buffer.from(basename(target))) + '-';
  const temporary = join(parent, prefix + randomUUID() + '.tmp');
  try {
    // A crash between link and unlink leaves two names for a complete file.
    // Collect only this target's reserved staging names before exact-file reuse.
    for (const name of await readdir(parent)) {
      if (!name.startsWith(prefix) || !/^[a-f0-9-]{36}\.tmp$/.test(name.slice(prefix.length))) continue;
      const path = join(parent, name), stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077) fail('ARCGIS_RECEIVING_STAGE_CHANGED');
      await unlink(path);
    }
    await createFile(temporary, content);
    try { await link(temporary, target); }
    catch (issue) {
      if (issue.code !== 'EEXIST') throw issue;
      if (!(await readPrivate(target, MiB)).equals(content))
        fail('ARCGIS_RECEIVING_OUTPUT_EXISTS', 'Retain the existing receiving plan and choose a new output file.');
    }
    await unlink(temporary); await syncDirectory(parent);
    return { path: target, sha256: digest(content), bytes: content.length };
  } finally {
    try { await unlink(temporary).catch(issue => { if (issue.code !== 'ENOENT') throw issue; }); }
    finally { await release(); }
  }
}

/** Recover the original GIS declaration from an inspected retained SF82 release. */
export async function prepareArcgisReleaseReceiving({ releaseDirectory, releaseId, output } = {}) {
  const { inspectRelease } = await import('../../sf82-seller-pilot/releases.mjs');
  const root = resolve(releaseDirectory), release = await inspectRelease(root, releaseId);
  if (release.source?.kind !== 'VERSIONED_DATASET_PACKAGE') fail('ARCGIS_DATASET_RELEASE_REQUIRED');
  const directory = join(root, 'releases', releaseId, 'dataset');
  const [sourceBytes, merchant] = await Promise.all([
    readPrivate(join(directory, 'source.json'), MiB), readPrivate(join(directory, 'seller.json'), MiB)
  ]);
  if (digest(sourceBytes) !== release.dataset.sourceSha256) fail('ARCGIS_DEPLOYMENT_SOURCE_CHANGED');
  const source = validateSource(parse(sourceBytes), release.dataset, digest(merchant));
  const content = bytes(source.receiving.declaration);
  return { ...(await writeExactOutput(output, content)), releaseId: release.id,
    releaseDigest: release.digest, sourceSha256: release.dataset.sourceSha256,
    dataset: source.receiving.declaration.dataset, requiredFields: Object.values(source.receiving.declaration.columns) };
}
