#!/usr/bin/env node
// MIT. One original sealed-file worker operation and complete paired-edition receiving.
import { readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { acquireStateLease } from '../../../merchant-fleet-gateway/state-lease.mjs';
import { readJobMerchant, validateJobInput } from '../../jobs/config.mjs';
import { openInputStore } from '../../jobs/inputs/store.mjs';
import { privateDirectory, readPrivateJson, writePrivateJson } from '../../jobs/inputs/files.mjs';
import { executeJob } from '../../jobs/execution.mjs';
import { openWaterQualityProject } from '../project.mjs';
import { receiveStandardizedReview, readStandardizedReview, exportStandardizedReview } from '../standardized-analysis/workflow.mjs';
import { selectPairedScientificJob, pairedScientificIdentity, PAIRED_JOB_EXPORTS,
  WQX_PAIRED_JOB_RESULT_SCHEMA, WQX_PAIRED_SOURCE_LIMIT } from './scientific.mjs';
import { metadata, immutable, stageFile, verifyArchive } from './receive.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const SCHEMA = 'starforge.wqx-paired-job-receiving.v1';
const json = value => JSON.stringify(value, null, 2) + '\n';
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw new Error(message); };
const equal = (a, b, message) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail(message); };
async function existing(path) {
  try { return await readPrivateJson(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function completeSource(path, expected) {
  let text = await readFile(path, 'utf8');
  if (Buffer.byteLength(text) !== expected.bytes || hash(text) !== expected.sha256)
    fail('The exact complete scientific input changed while it was read.');
  const value = JSON.parse(text); text = null; return value;
}
async function compareExports(project, identity, manifest, signal) {
  const members = new Map(manifest.members.map(item => [item.path, item]));
  const declarations = new Map(manifest.exports.map(item => [item.format, item]));
  if (declarations.size !== Object.keys(PAIRED_JOB_EXPORTS).length)
    fail('The paid result must retain all seven original scientific formats.');
  const verified = [];
  for (const [format, filename] of Object.entries(PAIRED_JOB_EXPORTS)) {
    signal.throwIfAborted();
    const artifact = await exportStandardizedReview({ project, reviewId: identity.reviewId, format });
    const path = 'scientific/' + filename, expected = members.get(path), declared = declarations.get(format);
    if (!expected || !declared || declared.path !== path || declared.filename !== artifact.filename ||
        declared.contentType !== artifact.mime) fail('The native scientific output declaration changed: ' + format);
    const actual = { bytes: artifact.bytes.length, sha256: hash(artifact.bytes) };
    equal(actual, { bytes: expected.bytes, sha256: expected.sha256 }, 'The received native export changed: ' + format);
    equal(actual, { bytes: declared.bytes, sha256: declared.sha256 }, 'The declared native export changed: ' + format);
    verified.push({ format, path, ...actual });
  }
  return verified;
}

/**
 * Uses the original sealed input store and executeJob worker. No provider acquisition
 * or payment submission is part of this local source-native receiving operation.
 */
export async function receivePairedScientificJob({ sourceFile, expectedSourceSha256, directory, scratch,
  configFile = join(ROOT, 'merchant.example.json'), python = 'python3',
  signal = new AbortController().signal } = {}) {
  if (!/^[0-9a-f]{64}$/.test(expectedSourceSha256 ?? ''))
    fail('Bind this operation to the exact complete source file SHA-256.');
  sourceFile = await realpath(resolve(sourceFile));
  directory = resolve(directory); scratch = resolve(scratch);
  await privateDirectory(directory); await privateDirectory(scratch);
  directory = await realpath(directory); scratch = await realpath(scratch);
  const source = await metadata(sourceFile);
  if (source.sha256 !== expectedSourceSha256 || source.bytes > WQX_PAIRED_SOURCE_LIMIT)
    fail('The selected original scientific source changed or exceeds 128 MiB.');
  const merchant = await readJobMerchant(configFile), definition = merchant.compiled.functions.waterQualityReview;
  if (!definition?.inputFiles || definition.inputFiles.slots.source.maxBytes < source.bytes)
    fail('Use the original paid Water Quality function with its declared scientific input policy.');
  const binding = { sourceFile, source, configFile: await realpath(configFile),
    configSha256: merchant.identity.configSha256, applicationSha256: merchant.identity.applicationSha256 };
  const lease = await acquireStateLease(directory), checkpointPath = join(directory, 'receiving.json');
  const save = state => writePrivateJson(checkpointPath, state, () => lease.assertHeld());
  let inputs;
  try {
    let checkpoint = await existing(checkpointPath);
    if (checkpoint) {
      if (checkpoint.schema !== SCHEMA) fail('Keep the original paired-job receiving checkpoint.');
      equal(checkpoint.binding, binding, 'Keep the original retained paired-job source and configuration.');
    }
    if (checkpoint?.completedAt) {
      equal(await metadata(checkpoint.output.path), { bytes: checkpoint.output.bytes, sha256: checkpoint.output.sha256 },
        'The retained complete paired-job result changed.');
      const result = await readPrivateJson(join(directory, 'result.json'));
      equal(result.binding, binding, 'The retained completion source changed.');
      equal(result.original, checkpoint.original, 'The retained original scientific selection changed.');
      if (result.jobId !== checkpoint.reference || result.output.sha256 !== checkpoint.output.sha256)
        fail('The retained completion result changed.');
      return result;
    }
    let envelope = await completeSource(sourceFile, source);
    const input = { mode: 'scientific', reviewId: envelope.review?.reviewId,
      expectedScientificReviewSha256: envelope.review?.reviewSha256,
      expectedCaptureSha256: envelope.review?.decision?.captureSha256,
      expectedReviewSha256: envelope.review?.decision?.sourceReviewSha256 };
    const identity = selectPairedScientificJob(input, envelope);
    envelope = null; global.gc?.();
    if (checkpoint) {
      equal(checkpoint.input, input, 'The saved scientific request changed.');
      equal(checkpoint.original, identity, 'The saved scientific selection changed.');
    } else {
      checkpoint = { schema: SCHEMA, binding, original: identity, input,
        reference: 'wqx-paired-science-' + source.sha256.slice(0,20),
        token: randomBytes(32).toString('base64url'), createdAt: new Date().toISOString(), completedAt: null };
      await save(checkpoint);
    }
    const inputsDirectory = join(directory, 'inputs');
    inputs = await openInputStore({ directory: inputsDirectory, lease, limits: merchant.compiled.inputFileStorage });
    const upload = await stageFile(inputs, definition, merchant.compiled.publicOrigin, checkpoint.reference,
      'source', sourceFile, checkpoint.token, signal);
    equal({ bytes: upload.file.bytes, sha256: upload.file.sha256 }, source, 'The original source changed during sealed upload.');
    const canonical = validateJobInput(definition, { ...input, $files: { source: upload.file } });
    await inputs.pinJob({ origin: merchant.compiled.publicOrigin, reference: checkpoint.reference,
      functionId: 'waterQualityReview', ...canonical, policy: definition.inputFiles, token: checkpoint.token, signal });
    checkpoint.upload = upload; checkpoint.inputSha256 = canonical.inputSha256; await save(checkpoint);
    const row = { id: checkpoint.reference, functionId: 'waterQualityReview', ...canonical };
    const outputPath = join(directory, 'water-quality-paired-scientific-review.zip');
    if (!checkpoint.output) {
      let bytes = await executeJob(merchant, row, { id: 'native-paired-scientific-1' },
        { env: { ...process.env, WQX_JOB_TEMP_ROOT: scratch }, signal, inputDirectory: inputsDirectory });
      await immutable(outputPath, bytes);
      checkpoint.output = { path: outputPath, bytes: bytes.length, sha256: hash(bytes) }; bytes = null;
      await save(checkpoint); global.gc?.();
    }
    equal(await metadata(outputPath), { bytes: checkpoint.output.bytes, sha256: checkpoint.output.sha256 },
      'The retained native worker result changed.');
    if (!checkpoint.replay) {
      let bytes = await executeJob(merchant, row, { id: 'native-paired-scientific-2' },
        { env: { ...process.env, WQX_JOB_TEMP_ROOT: scratch }, signal, inputDirectory: inputsDirectory });
      const actual = { bytes: bytes.length, sha256: hash(bytes) }; bytes = null;
      equal(actual, { bytes: checkpoint.output.bytes, sha256: checkpoint.output.sha256 },
        'The original same-job replay changed its full archive.');
      checkpoint.replay = { ...actual, reference: row.id, inputSha256: row.inputSha256,
        attemptId: 'native-paired-scientific-2' };
      await save(checkpoint); global.gc?.();
    }
    const extractionDirectory = join(directory, 'extracted');
    const archive = await verifyArchive(outputPath, join(directory, 'archive-verification.json'), python,
      ['scientific/complete-scientific-review.json'], extractionDirectory);
    const manifest = archive.manifest;
    if (manifest.schema !== WQX_PAIRED_JOB_RESULT_SCHEMA || manifest.functionId !== 'waterQualityReview' ||
        manifest.mode !== 'scientific' || manifest.jobId !== row.id ||
        manifest.selection !== 'COMPLETE_SAVED_SCIENTIFIC_EDITION' || manifest.sourceRecomputed !== true)
      fail('The worker did not return the original selected paired-scientific job.');
    equal(manifest.scientific, identity, 'The source-native worker changed the original scientific selection.');
    equal(manifest.request, input, 'The original paid scientific request changed.');
    const sealed = manifest.members.find(item => item.path === 'original/source-bundle.json');
    if (!sealed) fail('The complete original sealed scientific input is missing.');
    equal({ bytes: sealed.bytes, sha256: sealed.sha256 }, source, 'The exact sealed source was not retained.');
    const projectDirectory = join(directory, 'received-project');
    let project = await openWaterQualityProject(projectDirectory);
    try {
      let bundle = JSON.parse(await readFile(join(extractionDirectory, 'scientific/complete-scientific-review.json'), 'utf8'));
      let received = await receiveStandardizedReview({ project, bundle });
      bundle = null;
      equal(pairedScientificIdentity(received), identity, 'The complete buyer receiving changed an original source edition.');
      received = null; global.gc?.();
      checkpoint.exports = await compareExports(project, identity, manifest, signal);
    } finally { await project.close(); }
    project = await openWaterQualityProject(projectDirectory);
    try {
      let reopened = await readStandardizedReview({ project, reviewId: identity.reviewId });
      equal(pairedScientificIdentity(reopened), identity, 'The cold buyer workspace changed its original scientific identity.');
      reopened = null;
      checkpoint.coldExports = await compareExports(project, identity, manifest, signal);
    } finally { await project.close(); }
    checkpoint.receivedProject = { directory: projectDirectory, reviewId: identity.reviewId,
      reviewSha256: identity.reviewSha256, analysisSha256: identity.analysisSha256, reopened: true };
    checkpoint.archive = { members: archive.members, logicalBytes: archive.logicalBytes, sha256: archive.sha256 };
    checkpoint.completedAt ??= new Date().toISOString();
    const result = { schema: SCHEMA, completedAt: checkpoint.completedAt, jobId: checkpoint.reference,
      binding, original: identity, input, inputSha256: checkpoint.inputSha256,
      output: checkpoint.output, replay: checkpoint.replay, archive: checkpoint.archive,
      exports: checkpoint.exports, coldExports: checkpoint.coldExports, receivedProject: checkpoint.receivedProject,
      upload: { file: upload.file, chunks: upload.chunks, status: upload.status } };
    await writePrivateJson(join(directory, 'result.json'), result, () => lease.assertHeld());
    await save(checkpoint);
    return result;
  } finally { try { await inputs?.close(); } finally { await lease.close(); } }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { source: { type: 'string' }, 'expected-source-sha256': { type: 'string' },
    directory: { type: 'string' }, scratch: { type: 'string' }, config: { type: 'string' }, python: { type: 'string' } } });
  if (!values.source || !values.directory || !values.scratch || !values['expected-source-sha256'])
    fail('Use --source COMPLETE_SCIENTIFIC_JSON --expected-source-sha256 SHA --directory PRIVATE_RECEIVING --scratch PRIVATE_WORKER_TEMP');
  receivePairedScientificJob({ sourceFile: values.source, expectedSourceSha256: values['expected-source-sha256'],
    directory: values.directory, scratch: values.scratch, configFile: values.config, python: values.python })
    .then(result => process.stdout.write(json({ jobId: result.jobId, output: result.output,
      exports: result.exports.length, coldExports: result.coldExports.length, receivedProject: result.receivedProject })))
    .catch(error => { process.stderr.write(json({ error: error.code ?? error.name, message: error.message, stack: error.stack })); process.exitCode = 1; });
}
