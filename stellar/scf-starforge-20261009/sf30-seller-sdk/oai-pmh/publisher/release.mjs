// MIT. Reviewed OAI candidate -> the ORIGINAL SF82 dataset release lifecycle.
import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { buildDatasetSellerConfig } from '../../dataset-cli.mjs';
import { DATASET_SNAPSHOT_PARAMETER } from '../../dataset-refresh/versions.mjs';
import { DATASET_BINDING_SCHEMA, datasetContractSha256, prepareDatasetRelease } from '../../../sf82-seller-pilot/release-dataset.mjs';
import { absolute, privateDirectory, readPrivate, readJson, createFile, syncDirectory,
  bytes, digest, identity, fault } from '../../postgres/publisher/files.mjs';
import { readOaiSourceFile, copyOaiCapture } from '../source.mjs';
import { only, HASH } from '../declaration.mjs';
import { validateOaiExtraction } from './driver.mjs';

export const OAI_PUBLISHED_SOURCE_SCHEMA = 'stellar-forge.oai-pmh-published-source.v1';
const parse = value => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value));
const descriptor = (path, content) => ({ path, bytes: content.length, sha256: digest(content) });
const changed = message => fault('OAI_RELEASE_SOURCE_CHANGED', message, 409);
function contains(parent, child) {
  const path = relative(parent, child);
  return path === '' || path !== '..' && !path.startsWith('..' + sep) && !path.startsWith(sep);
}
async function exists(path) {
  try { await lstat(path); return true; } catch (issue) { if (issue.code === 'ENOENT') return false; throw issue; }
}
async function copyCandidateCsv(source, target, expected) {
  if (await realpath(source) !== source) throw changed('Use the original canonical candidate CSV.');
  const input = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let output;
  try {
    const before = await input.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.mode & 0o077n ||
        before.size !== BigInt(expected.csvBytes) || before.size > 256n * 1024n * 1024n)
      throw changed('The original candidate CSV no longer matches its declared size.');
    output = await open(target, 'wx', 0o600);
    const hash = createHash('sha256'), buffer = Buffer.alloc(65536); let total = 0;
    while (true) {
      const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > expected.csvBytes) throw changed('The candidate changed while copying.');
      const part = buffer.subarray(0, bytesRead); hash.update(part); await output.writeFile(part);
    }
    const after = await input.stat({ bigint: true });
    if (total !== expected.csvBytes || hash.digest('hex') !== expected.csvHash ||
        before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs)
      throw changed('The candidate changed while copying.');
    await output.sync();
  } finally { try { await output?.close(); } finally { await input.close(); } }
}
function completedRun(run, candidate) {
  if (run.state !== 'PUBLISHED' || run.data?.publication?.snapshot !== candidate.dataset.snapshot ||
      run.data?.review?.candidateDigest !== candidate.candidateDigest)
    throw fault('OAI_PUBLISHED_CANDIDATE_REQUIRED',
      'Publish or recover this exact reviewed candidate in its original version store before preparing its seller.', 409);
}
function summary(prepared, source, reused) {
  return { schema: 'stellar-forge.oai-pmh-release-package.v1', directory: prepared.directory, reused,
    runId: source.publisher.run, planId: source.publisher.plan, candidateDigest: source.publisher.candidateDigest,
    capturedSnapshot: source.build.datasetSnapshot, snapshot: prepared.description.snapshot,
    rows: prepared.description.rowCount, deletedRecords: source.edition.deletedRecords,
    sourceHash: prepared.dataset.sourceSha256, originalSourceHash: source.originalSourceSha256,
    sourceClosure: prepared.dataset.sourceClosure, datasetDirectory: prepared.binding.datasetDirectory,
    fileCount: prepared.files.length, bytes: prepared.files.reduce((total, file) => total + file.bytes, 0),
    resource: prepared.service.publicOrigin + prepared.service.routes[0].path };
}

/** Validate a portable package without opening another publisher or version store. */
export async function inspectOaiRelease(directory) {
  const prepared = await prepareDatasetRelease(absolute(resolve(directory), 'release package directory'));
  const source = parse(prepared.retained['source.json']);
  if (source.schema !== OAI_PUBLISHED_SOURCE_SCHEMA || !HASH.test(source.originalSourceSha256 ?? '') ||
      !HASH.test(source.manifestSha256 ?? '') || !source.publisher)
    throw changed('This package is not a retained OAI publication.');
  const original = await readOaiSourceFile(join(prepared.directory, 'oai-source.json'), { loadDataset: false });
  const planBytes = await readPrivate(join(prepared.directory, 'publisher-plan.json'));
  const candidateBytes = await readPrivate(join(prepared.directory, 'publisher-candidate.json'));
  const nativeConfigBytes = await readPrivate(join(prepared.directory, 'publisher-dataset.json'), 65536);
  const run = await readJson(join(prepared.directory, 'publisher-publication.json'), 1024 * 1024);
  const plan = parse(planBytes), candidate = parse(candidateBytes), config = parse(nativeConfigBytes);
  const { digest: planDigest, ...planBody } = plan;
  const { candidateDigest, ...candidateBody } = candidate;
  completedRun(run, candidate);
  const extraction = candidate.extraction, capture = original.capture;
  const expectedExtraction = { sourceHash: original.sourceHash, manifestSha256: original.config.connection.sha256,
    operationId: capture.operationId, attempt: capture.attempt, editionId: capture.edition.id,
    reviewDigest: capture.edition.review.digest, buildId: capture.build.id,
    datasetSnapshot: capture.build.datasetSnapshot, rowCount: capture.build.rowCount,
    sourceRowCount: capture.build.rowCount, deletedRecords: capture.edition.deletedRecords };
  if (plan.schema !== 'stellar-forge.oai-pmh-dataset-plan.v1' || plan.digest !== identity(planBody) ||
      candidate.schema !== 'stellar-forge.oai-pmh-dataset-candidate.v1' || candidateDigest !== identity(candidateBody) ||
      candidate.planDigest !== planDigest || candidate.sourceHash !== original.sourceHash ||
      candidate.queryHash !== plan.queryHash || plan.sourceHash !== original.sourceHash ||
      plan.runtimeSourceHash !== original.sourceHash || plan.capture?.manifestSha256 !== original.config.connection.sha256 ||
      !validateOaiExtraction(extraction) ||
      Object.entries(expectedExtraction).some(([key, value]) => extraction[key] !== value) ||
      source.originalSourceSha256 !== original.sourceHash || source.manifestSha256 !== original.config.connection.sha256 ||
      !isDeepStrictEqual(source.edition, capture.edition) || !isDeepStrictEqual(source.build, capture.build) ||
      !isDeepStrictEqual(source.selection, capture.selection) ||
      !isDeepStrictEqual(source.repository, { id: capture.repository.id, baseURL: capture.repository.baseURL }) ||
      source.publisher.run !== run.id || source.publisher.run !== candidate.run ||
      source.publisher.plan !== run.plan || source.publisher.candidateDigest !== candidateDigest ||
      source.publisher.targetDirectory !== prepared.binding.datasetDirectory ||
      run.data.review.target.directory !== prepared.binding.datasetDirectory ||
      digest(nativeConfigBytes) !== candidate.configHash || config.file !== 'data.csv' ||
      !isDeepStrictEqual({ ...config, file: 'dataset.csv' }, prepared.config) ||
      candidate.csvHash !== prepared.dataset.csvSha256 || candidate.csvBytes !== prepared.retained['dataset.csv'].length ||
      !isDeepStrictEqual(candidate.dataset, prepared.description))
    throw changed('The package differs from its original reviewed capture, candidate or version-store publication.');
  return summary(prepared, source, true);
}

/** Same completed candidate, same target store; this only prepares its serving package. */
export async function prepareOaiRelease(publisher, input) {
  only(input, ['runId', 'directory', 'payment', 'origin', 'path', 'expectedCandidateDigest'], 'OAI_RELEASE_INPUT');
  const original = await publisher.retainedSource(input.runId);
  const candidate = await publisher.candidate(input.runId), manifest = candidate.manifest;
  const run = publisher.run(input.runId), plan = publisher.plan(run.plan);
  completedRun(run, manifest);
  if (input.expectedCandidateDigest !== undefined && input.expectedCandidateDigest !== manifest.candidateDigest)
    throw changed('Reload the exact retained candidate before preparing this seller.');
  const directory = absolute(resolve(input.directory), 'release package directory');
  const targetDirectory = absolute(publisher.settings.targetDirectory, 'original version store');
  if (contains(original.root, directory) || contains(directory, original.root) ||
      contains(targetDirectory, directory) || contains(directory, targetDirectory))
    throw fault('OAI_RELEASE_DIRECTORY', 'Keep the prepared package outside the original capture and version-store directories.');
  await privateDirectory(dirname(directory));
  const planFile = join(publisher.directory, 'plans', plan.folder, 'plan.json');
  const runDirectory = join(publisher.directory, 'runs', run.id);
  const planBytes = await readPrivate(planFile), candidateBytes = await readPrivate(join(runDirectory, 'candidate.json'));
  const nativeConfigBytes = await readPrivate(candidate.configPath, 65536);
  if (!isDeepStrictEqual(parse(planBytes), plan.data) || !isDeepStrictEqual(parse(candidateBytes), manifest) ||
      digest(nativeConfigBytes) !== manifest.configHash)
    throw changed('The original plan or candidate changed before release preparation.');
  const config = { ...parse(nativeConfigBytes), file: 'dataset.csv' };
  const seller = await buildDatasetSellerConfig(candidate.dataset,
    { payment: input.payment, origin: input.origin, path: input.path ?? '/records' });
  seller.routes[0].definition.queryParameters.push(structuredClone(DATASET_SNAPSHOT_PARAMETER));
  const publicationBytes = bytes(run);
  const sourceFiles = [
    descriptor('oai-source.json', original.original),
    descriptor('publisher-plan.json', planBytes), descriptor('publisher-candidate.json', candidateBytes),
    descriptor('publisher-dataset.json', nativeConfigBytes), descriptor('publisher-publication.json', publicationBytes),
    descriptor('capture/capture.json', original.captureBytes),
    ...original.files.map(file => ({ path: 'capture/' + file.file, bytes: file.bytes, sha256: file.sha256 })),
  ].sort((a, b) => a.path.localeCompare(b.path));
  const source = { schema: OAI_PUBLISHED_SOURCE_SCHEMA, provider: 'oai-pmh', readOnly: true,
    originalSourceSha256: original.sourceHash, manifestSha256: original.config.connection.sha256,
    repository: { id: original.capture.repository.id, baseURL: original.capture.repository.baseURL },
    selection: original.capture.selection, edition: original.capture.edition, build: original.capture.build,
    publisher: { run: run.id, plan: run.plan, candidateDigest: manifest.candidateDigest, targetDirectory },
    sourceFiles };
  const sourceBytes = bytes(source);
  const binding = { schema: DATASET_BINDING_SCHEMA, datasetDirectory: targetDirectory,
    contractSha256: datasetContractSha256(manifest.dataset), baselineSnapshot: manifest.dataset.snapshot,
    sourceSha256: digest(sourceBytes) };
  const fixed = { 'dataset.json': bytes(config), 'seller.json': bytes(seller),
    'source.json': sourceBytes, 'binding.json': bytes(binding) };
  const sameRun = () => {
    if (!isDeepStrictEqual(publisher.run(run.id), run))
      throw changed('The original candidate publication changed during package preparation.');
  };
  if (await exists(directory)) {
    const prepared = await prepareDatasetRelease(directory);
    if (prepared.dataset.csvSha256 !== manifest.csvHash ||
        Object.entries(fixed).some(([file, content]) => !prepared.retained[file].equals(content)))
      throw changed('This directory retains a different publication. Reopen it or choose a new package directory.');
    sameRun();
    return { ...await inspectOaiRelease(directory), reused: true };
  }
  let created = false;
  try {
    await mkdir(directory, { mode: 0o700 }); created = true;
    await copyCandidateCsv(join(runDirectory, 'data.csv'), join(directory, 'dataset.csv'), manifest);
    for (const [file, content] of Object.entries(fixed)) await createFile(join(directory, file), content);
    await createFile(join(directory, 'oai-source.json'), original.original);
    await createFile(join(directory, 'publisher-plan.json'), planBytes);
    await createFile(join(directory, 'publisher-candidate.json'), candidateBytes);
    await createFile(join(directory, 'publisher-dataset.json'), nativeConfigBytes);
    await createFile(join(directory, 'publisher-publication.json'), publicationBytes);
    await copyOaiCapture(original, join(directory, 'capture'));
    const result = await inspectOaiRelease(directory);
    sameRun(); await syncDirectory(directory); await syncDirectory(dirname(directory)); sameRun();
    return { ...result, reused: false };
  } catch (issue) {
    if (created) await rm(directory, { recursive: true, force: true });
    throw issue;
  }
}
