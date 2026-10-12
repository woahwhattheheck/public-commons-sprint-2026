// MIT. Retain a published DBnomics edition in the original SF82 dataset release.
import { lstat, mkdir, realpath, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, posix, relative, sep } from 'node:path';
import { buildDatasetSellerConfig } from '../dataset-cli.mjs';
import { readDbnomicsCapture } from './source.mjs';
import { DATASET_SNAPSHOT_PARAMETER } from '../dataset-refresh/versions.mjs';
import { absolute, object, bytes, digest, identity, readPrivate, createFile,
  privateDirectory, syncDirectory, fault } from '../postgres/publisher/files.mjs';

const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MiB = 1024 * 1024;
const SOURCE_SCHEMA = 'stellar-forge.dbnomics-dataset-source.v1';

async function absent(path) {
  try { await lstat(path); return false; }
  catch (error) { if (error.code === 'ENOENT') return true; throw error; }
}
function memberPath(value) {
  if (typeof value !== 'string' || !value || value.length > 1024 ||
      /[\\\u0000-\u001f\u007f]/.test(value) || posix.isAbsolute(value) ||
      posix.normalize(value) !== value || value.split('/').some(part => !part || part === '.' || part === '..'))
    throw fault('DBNOMICS_CAPTURE_MEMBER_INVALID');
  return value;
}
function parsed(content) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content)); }
  catch { throw fault('DBNOMICS_RELEASE_JSON_INVALID'); }
}
function descriptor(path, content) {
  return { path, bytes: content.length, sha256: digest(content) };
}
function equal(left, right) { return identity(left) === identity(right); }

/** Retain one original published extraction, exact response, query/reuse review,
 * candidate and publication through the maintained SF82 sourceFiles contract. */
export async function prepareDbnomicsRelease({
  publisher, runId, outputDirectory, payment, origin, path = '/data',
} = {}) {
  if (!publisher || publisher.settings?.schema !== 'stellar-forge.dbnomics-publisher-workspace.v1' ||
      typeof publisher.candidate !== 'function' || !UUID.test(runId ?? ''))
    throw fault('DBNOMICS_PUBLISHER_REQUIRED', 'Choose the open DBnomics publisher and its original extraction.');
  const directory = absolute(publisher.directory, 'publisher directory');
  const targetDirectory = absolute(publisher.settings.targetDirectory, 'dataset directory');
  outputDirectory = absolute(outputDirectory, 'release package directory');
  await privateDirectory(directory);
  await privateDirectory(targetDirectory);
  // A package cannot replace any part of its source workspace or target store.
  for (const protectedDirectory of [directory, targetDirectory]) {
    for (const relation of [relative(outputDirectory, protectedDirectory), relative(protectedDirectory, outputDirectory)]) {
      if (!relation || relation !== '..' && !relation.startsWith('..' + sep))
        throw fault('DBNOMICS_RELEASE_LOCATION', 'Keep the release package outside its source workspace and dataset store.');
    }
  }
  const saved = publisher.run(runId), selected = publisher.plan(saved.plan);
  const candidate = await publisher.candidate(runId), description = candidate.dataset.describe();
  if (saved.state !== 'PUBLISHED' || saved.data?.publication?.snapshot !== description.snapshot)
    throw fault('DBNOMICS_EDITION_NOT_PUBLISHED', 'Publish this retained edition through its original dataset publisher first.', 409);
  if (!UUID.test(selected.folder ?? '') || selected.data?.schema !== 'stellar-forge.dbnomics-dataset-plan.v1' ||
      !object(selected.data.sourceQuery) || identity(selected.data.sourceQuery) !== selected.data.queryHash)
    throw fault('DBNOMICS_RELEASE_PLAN_CHANGED');

  const planBase = 'plans/' + selected.folder, runBase = 'runs/' + runId;
  const capturePath = planBase + '/capture/capture.json';
  const retained=await readDbnomicsCapture(join(directory,capturePath));
  const {capture,captureBytes,captureSha256}=retained;
  if(captureSha256!==selected.data.retainedCapture?.manifestSha256||
    captureSha256!==candidate.manifest.extraction.captureSha256||
    capture.captureId!==candidate.manifest.extraction.captureId||
    !equal(capture.responses.map(row=>row.receipt.sha256),candidate.manifest.extraction.responseSha256s))
    throw fault('DBNOMICS_RELEASE_CAPTURE_CHANGED');
  const sourceFiles=[];
  for(const [name,maximum] of [
    [planBase+'/plan.json',8*MiB],[planBase+'/source.json',8*MiB],
    [planBase+'/original-source.json',8*MiB],[runBase+'/candidate.json',8*MiB],
    [runBase+'/dataset.json',MiB]])
    sourceFiles.push(descriptor(name,await readPrivate(join(directory,name),maximum)));
  sourceFiles.push(descriptor(capturePath,captureBytes));
  const guidePath=planBase+'/'+memberPath(selected.data.sourceGuide?.file),guideBytes=await readPrivate(join(directory,guidePath),128*1024);
  if(guideBytes.length!==selected.data.sourceGuide.bytes||digest(guideBytes)!==selected.data.sourceGuide.sha256)throw fault('DBNOMICS_RELEASE_GUIDE_CHANGED');
  sourceFiles.push(descriptor(guidePath,guideBytes));
  for(const original of selected.data.retainedCapture.originalResponses){
    const sourcePath=planBase+'/'+memberPath(original.file),content=await readPrivate(join(directory,sourcePath),32*MiB);
    if(content.length!==original.bytes||digest(content)!==original.sha256)throw fault('DBNOMICS_RELEASE_RESPONSE_CHANGED');
    sourceFiles.push(descriptor(sourcePath,content));
  }
  sourceFiles.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const originalConfigBytes = await readPrivate(candidate.configPath, MiB);
  if (digest(originalConfigBytes) !== candidate.manifest.configHash)
    throw fault('DBNOMICS_RELEASE_CONFIG_CHANGED');
  const originalConfig = parsed(originalConfigBytes);
  const configBytes = bytes({ ...originalConfig, file: 'dataset.csv' });
  const seller = await buildDatasetSellerConfig(candidate.dataset, { payment, origin, path });
  seller.routes[0].definition.queryParameters.push(DATASET_SNAPSHOT_PARAMETER);
  const sellerBytes = bytes(seller);
  const source = {
    schema: SOURCE_SCHEMA,
    sourceType:'DBnomics v22 economic series',sourceGuide:descriptor(guidePath,guideBytes),
    selection:capture.selection,sourceMode:capture.sourceMode,terms:capture.terms,
    sourceSeries:retained.model.series.map(({metadata,...row})=>row),
    metadataSha256:identity(retained.model.metadata),
    retrievalWindow:retained.model.retrievalWindow,
    capture:{path:capturePath,sha256:captureSha256,bytes:captureBytes.length,id:capture.captureId},
    originalResponses:capture.responses.map((row,index)=>({path:planBase+'/'+selected.data.retainedCapture.originalResponses[index].file,
      receipt:row.receipt})),
    plan: { id: selected.id, path: planBase + '/plan.json', digest: selected.data.digest,
      sourceHash: selected.data.sourceHash, queryHash: selected.data.queryHash },
    query: selected.data.query,
    sourceQuery: selected.data.sourceQuery,
    extraction: candidate.manifest.extraction,
    candidate: { run: runId, path: runBase + '/candidate.json',
      digest: candidate.manifest.candidateDigest, csvSha256: candidate.manifest.csvHash,
      csvBytes: candidate.manifest.csvBytes, snapshot: description.snapshot },
    review: saved.data.review,
    publication: saved.data.publication,
    sourceFiles,
  };
  const sourceBytes = bytes(source);
  const { DATASET_BINDING_SCHEMA, DATASET_SOURCE_FILE_LIMITS, datasetContractSha256,
    prepareDatasetRelease, copyDatasetSourceFiles } = await import('../../sf82-seller-pilot/release-dataset.mjs');
  if (sourceBytes.length > DATASET_SOURCE_FILE_LIMITS.sourceBytes)
    throw fault('DBNOMICS_RELEASE_PROVENANCE_TOO_LARGE', 'The retained source index exceeds the dataset release limit.', 413);
  const binding = { schema: DATASET_BINDING_SCHEMA, datasetDirectory: targetDirectory,
    contractSha256: datasetContractSha256(description), baselineSnapshot: description.snapshot,
    sourceSha256: digest(sourceBytes) };
  const bindingBytes = bytes(binding);
  const expected = { 'dataset.json': configBytes, 'seller.json': sellerBytes,
    'source.json': sourceBytes, 'binding.json': bindingBytes };
  const reused = !await absent(outputDirectory);
  if (!reused) {
    await mkdir(dirname(outputDirectory), { recursive: true, mode: 0o700 });
    if (await realpath(dirname(outputDirectory)) !== dirname(outputDirectory))
      throw fault('DBNOMICS_RELEASE_LOCATION', 'Use a canonical parent directory for the release package.');
    const temporary = outputDirectory + '.stage-' + randomUUID();
    await mkdir(temporary, { mode: 0o700 });
    try {
      // The original copier verifies sizes/hashes, uses exclusive private writes,
      // fsyncs every member and owns cleanup of only the files it created.
      await copyDatasetSourceFiles(directory, temporary, { sourceFiles: [...sourceFiles,
        { path: runBase + '/data.csv', bytes: candidate.manifest.csvBytes, sha256: candidate.manifest.csvHash }] });
      await rename(join(temporary, runBase, 'data.csv'), join(temporary, 'dataset.csv'));
      await syncDirectory(join(temporary, runBase));
      for (const [name, content] of Object.entries(expected)) await createFile(join(temporary, name), content);
      await prepareDatasetRelease(temporary);
      await syncDirectory(temporary);
      await rename(temporary, outputDirectory);
      await syncDirectory(dirname(outputDirectory));
    } catch (error) { await rm(temporary, { recursive: true, force: true }); throw error; }
  }
  const prepared = await prepareDatasetRelease(outputDirectory);
  for (const [name, content] of Object.entries(expected)) {
    if (!prepared.retained[name].equals(content))
      throw fault('DBNOMICS_RELEASE_EXISTS_CHANGED', 'This package directory contains a different original edition or seller.', 409);
  }
  if (prepared.dataset.csvSha256 !== candidate.manifest.csvHash ||
      prepared.description.snapshot !== description.snapshot || !equal(prepared.sourceFiles, sourceFiles))
    throw fault('DBNOMICS_RELEASE_EXISTS_CHANGED', 'The release package differs from the selected extraction.', 409);
  return { schema: 'stellar-forge.dbnomics-release-preparation.v1',
    directory: outputDirectory, runId, planId: selected.id, query: selected.data.query,
    snapshot: description.snapshot, rowCount: description.rowCount, binding: prepared.binding,
    dataset: prepared.dataset, sourceFiles: prepared.sourceFiles, offers: prepared.offers, reused };
}

/** Stage the exact prepared package through the maintained SF82 release store.
 * Repeating the same ID is safe only when source, payment terms and runtime match.
 */
export async function stageDbnomicsRelease({
  packageDirectory, releaseDirectory, id, label = id, runtime = { port: 0 },
} = {}) {
  packageDirectory = absolute(packageDirectory, 'prepared release package directory');
  releaseDirectory = absolute(releaseDirectory, 'release store directory');
  const [{ prepareDatasetRelease }, {
    initReleaseStore, readReleaseState, inspectRelease, stageRelease, normalizeReleaseRuntime,
  }] = await Promise.all([
    import('../../sf82-seller-pilot/release-dataset.mjs'),
    import('../../sf82-seller-pilot/releases.mjs'),
  ]);
  const prepared = await prepareDatasetRelease(packageDirectory);
  if (parsed(prepared.retained['source.json']).schema !== SOURCE_SCHEMA)
    throw fault('DBNOMICS_RELEASE_SOURCE_REQUIRED', 'Choose an original DBnomics dataset release package.');
  if (!object(runtime) || Object.keys(runtime).some(key => !['port', 'facilitator', 'allowLocalFacilitator'].includes(key)))
    throw fault('DBNOMICS_RELEASE_RUNTIME', 'The original dataset owns the seller query handler and version controller.');
  const selectedRuntime = normalizeReleaseRuntime(runtime);
  if (await absent(releaseDirectory)) {
    await mkdir(dirname(releaseDirectory), { recursive: true, mode: 0o700 });
    if (await realpath(dirname(releaseDirectory)) !== dirname(releaseDirectory))
      throw fault('DBNOMICS_RELEASE_LOCATION', 'Use a canonical parent directory for the release store.');
    await initReleaseStore(releaseDirectory);
  } else await readReleaseState(releaseDirectory);
  let previous;
  try { previous = await inspectRelease(releaseDirectory, id); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous) {
    if (!equal(previous.dataset, prepared.dataset) || previous.label !== label ||
        !equal(previous.runtime, selectedRuntime) || previous.publicOrigin !== prepared.service.publicOrigin ||
        previous.source?.serviceConfigSha256 !== digest(prepared.serviceBytes))
      throw fault('DBNOMICS_RELEASE_ID_CHANGED', 'This release ID already contains another source, seller or runtime.', 409);
    return { ...previous, reused: true };
  }
  return { ...await stageRelease(releaseDirectory, { id, label, datasetPackage: packageDirectory,
    runtime: selectedRuntime }), reused: false };
}

// Activation, rollback and the supervised merchant remain original SF82 actions.
export async function activateDbnomicsRelease(releaseDirectory, id, options) {
  return (await import('../../sf82-seller-pilot/releases.mjs')).activateRelease(releaseDirectory, id, options);
}
export async function rollbackDbnomicsRelease(releaseDirectory, options) {
  return (await import('../../sf82-seller-pilot/releases.mjs')).rollbackRelease(releaseDirectory, options);
}
export async function runDbnomicsRelease(releaseDirectory, options) {
  return (await import('../../sf82-seller-pilot/releases.mjs')).runActiveRelease(releaseDirectory, options);
}
