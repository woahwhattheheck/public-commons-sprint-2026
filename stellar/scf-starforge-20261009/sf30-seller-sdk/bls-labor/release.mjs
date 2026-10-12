// MIT. A published Bls candidate in the original SF82 dataset release format.
import { dirname, join } from 'node:path';
import { lstat } from 'node:fs/promises';
import { bytes, digest, readPrivate, createFile, privateDirectory, absolute, fault } from '../postgres/publisher/files.mjs';
import { readBlsSource } from './source.mjs';

async function exactFile(path, data) {
  try {
    await lstat(path);
    const current = await readPrivate(path, Math.max(data.length, 1));
    if (!current.equals(data)) throw fault('BLS_RELEASE_PACKAGE_CHANGED');
  } catch (issue) {
    if (issue.code !== 'ENOENT') throw issue;
    await createFile(path, data);
  }
}
/** Use a published original candidate and the operator's generated snapshot-enabled
 * seller. SF82's existing preparer verifies the five-file package and query contract. */
export async function prepareBlsRelease({ publisher, runId, sellerFile, outputDirectory } = {}) {
  if (!publisher || typeof publisher.candidate !== 'function') throw fault('BLS_PUBLISHER_REQUIRED');
  absolute(outputDirectory); absolute(sellerFile, 'seller file');
  const run = publisher.run(runId);
  if (run.state !== 'PUBLISHED') throw fault('BLS_PUBLISHED_CANDIDATE_REQUIRED');
  const candidate = await publisher.candidate(runId), plan = publisher.plan(run.plan);
  if (run.data.publication.snapshot !== candidate.manifest.dataset.snapshot)
    throw fault('BLS_PUBLICATION_BINDING_CHANGED');
  const capture = await readBlsSource(join(publisher.directory, 'plans', plan.folder, 'source.json'));
  if (capture.captureHash !== candidate.manifest.extraction.captureHash) throw fault('BLS_CANDIDATE_CAPTURE_CHANGED');
  const { prepareDatasetRelease, datasetContractSha256, DATASET_BINDING_SCHEMA } =
    await import('../../sf82-seller-pilot/release-dataset.mjs');
  const csv = await readPrivate(join(dirname(candidate.configPath), 'data.csv'), plan.data.extraction.maxBytes);
  const originalConfig = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readPrivate(candidate.configPath, 65536)));
  const config = { ...originalConfig, file: 'dataset.csv' };
  const source = bytes({ schema: 'stellar-forge.bls-labor-release-source.v1',
    captureHash: capture.captureHash, captureManifestBase64: capture.manifestBytes.toString('base64'),
    candidateDigest: candidate.manifest.candidateDigest, planDigest: candidate.manifest.planDigest,
    query: plan.data.query, sourceHash: candidate.manifest.sourceHash, csvHash: candidate.manifest.csvHash,
    extraction: candidate.manifest.extraction, publication: run.data.publication });
  if (source.length > 1048576) throw fault('BLS_RELEASE_PROVENANCE_TOO_LARGE');
  const binding = { schema: DATASET_BINDING_SCHEMA, datasetDirectory: publisher.settings.targetDirectory,
    contractSha256: datasetContractSha256(candidate.dataset.describe()),
    baselineSnapshot: candidate.dataset.describe().snapshot, sourceSha256: digest(source) };
  const seller = await readPrivate(sellerFile, 1048576);
  await privateDirectory(outputDirectory, true);
  for (const [name, data] of Object.entries({ 'dataset.csv': csv, 'dataset.json': bytes(config),
    'source.json': source, 'binding.json': bytes(binding), 'seller.json': seller }))
    await exactFile(join(outputDirectory, name), data);
  const prepared = await prepareDatasetRelease(outputDirectory);
  return { directory: outputDirectory, captureHash: capture.captureHash, snapshot: prepared.description.snapshot,
    dataset: prepared.dataset, files: prepared.files };
}
