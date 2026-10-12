// MIT. Receive both real scientific input families through original sealed files and native workers.
import { createReadStream } from 'node:fs';
import { readFile, open, realpath } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import { acquireStateLease } from '../../../merchant-fleet-gateway/state-lease.mjs';
import { readJobMerchant, validateJobInput } from '../../jobs/config.mjs';
import { openInputStore } from '../../jobs/inputs/store.mjs';
import { CHUNK_BYTES, FILE_SCHEMA, PLAN_SCHEMA } from '../../jobs/inputs/protocol.mjs';
import { privateDirectory, readPrivateJson, writePrivateJson } from '../../jobs/inputs/files.mjs';
import { executeJob } from '../../jobs/execution.mjs';
import { writeBytes } from '../../../sf88-operator-buyer-cli/node/store.mjs';
import { openWaterQualityProject } from '../project.mjs';

const json = value => JSON.stringify(value, null, 2) + '\n';
const hash = value => createHash('sha256').update(value).digest('hex');
const run = promisify(execFile);
const fail = message => { throw new Error(message); };
const equal = (left, right, message) => { if (JSON.stringify(left) !== JSON.stringify(right)) fail(message); };
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const SOURCE_SCHEMA = 'starforge.wqx-open-waters-bundle.v1';
const RESULT_SCHEMA = 'starforge.wqx-scientific-job-receiving.v1';
async function metadata(path) {
  const digest = createHash('sha256'); let bytes = 0;
  for await (const part of createReadStream(path, { highWaterMark: CHUNK_BYTES })) { digest.update(part); bytes += part.length; }
  return { bytes, sha256: digest.digest('hex') };
}
async function immutable(path, bytes) {
  try { await writeBytes(path, bytes, { exclusive: true }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const observed = await metadata(path);
    if (observed.bytes !== bytes.length || observed.sha256 !== hash(bytes)) fail('A retained receiving output differs: ' + path);
  }
}
async function existing(path) {
  try { return await readPrivateJson(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function stageFile(store, definition, origin, reference, slot, path, token, signal) {
  const whole = createHash('sha256'), chunks = []; let bytes = 0;
  for await (const part of createReadStream(path, { highWaterMark: CHUNK_BYTES })) {
    signal.throwIfAborted(); whole.update(part); bytes += part.length; chunks.push(hash(part));
  }
  const file = { schema: FILE_SCHEMA, filename: basename(path), contentType: 'application/json',
    bytes, sha256: whole.digest('hex'), policySha256: definition.inputFiles.policySha256 };
  const plan = { schema: PLAN_SCHEMA, origin, reference, functionId: 'waterQualityReview', slot, file, chunkBytes: CHUNK_BYTES, chunks };
  let status = await store.begin({ plan, token });
  const handle = await open(path, 'r');
  try {
    for (const index of status.missing) {
      const length = Math.min(CHUNK_BYTES, bytes - index * CHUNK_BYTES), body = Buffer.alloc(length);
      let read = 0;
      while (read < length) {
        const part = await handle.read(body, read, length - read, index * CHUNK_BYTES + read);
        if (!part.bytesRead) fail('An original source file ended during upload');
        read += part.bytesRead;
      }
      status = await store.writeChunk({ id: status.id, token, index, body, signal });
    }
  } finally { await handle.close(); }
  status = await store.finish({ id: status.id, token, signal });
  if (status.state !== 'SEALED') fail('The original input was not sealed');
  return { file, id: status.id, chunks: chunks.length, status: status.state };
}
async function verifyArchive(path, output, python, kinds) {
  const args = [join(ROOT, 'verify-result.py'), path, '--out', output];
  for (const name of kinds) args.push('--extract', name);
  const result = await run(python, args, { maxBuffer: 1048576 });
  return JSON.parse(result.stdout);
}
async function compareExports(project, manifest, openWaters) {
  const members = new Map(manifest.members.map(item => [item.path, item])), verified = [];
  const reviewNames = { json: 'review.json', html: 'report.html', csv: 'observations.csv', geojson: 'observations.geojson' };
  for (const [format, filename] of Object.entries(reviewNames)) {
    const output = await project.exportReview({ reviewId: manifest.review.reviewId, format });
    const expected = members.get('review/' + filename), actual = { bytes: output.bytes.length, sha256: hash(output.bytes) };
    equal(actual, { bytes: expected.bytes, sha256: expected.sha256 }, 'Native review export changed: ' + format);
    verified.push({ format: 'review/' + format, ...actual });
  }
  const complete = await project.exportReviewBundle({ reviewId: manifest.review.reviewId });
  const expectedComplete = members.get('review/complete-review.json');
  equal({ bytes: complete.bytes.length, sha256: hash(complete.bytes) },
    { bytes: expectedComplete.bytes, sha256: expectedComplete.sha256 }, 'The native complete review changed after receiving');
  verified.push({ format: 'review/bundle', bytes: complete.bytes.length, sha256: hash(complete.bytes) });
  if (openWaters) {
    const names = { locations: 'locations.tsv', results: 'results.tsv', crosswalk: 'crosswalk.json',
      report: 'receiving.html', references: 'references.csv', bundle: 'complete-open-waters.json' };
    for (const [format, filename] of Object.entries(names)) {
      const output = await project.exportOpenWaters({ planId: manifest.openWaters.planId, format });
      const expected = members.get('open-waters/' + filename), actual = { bytes: output.bytes.length, sha256: hash(output.bytes) };
      equal(actual, { bytes: expected.bytes, sha256: expected.sha256 }, 'Native Open Waters export changed: ' + format);
      verified.push({ format: 'open-waters/' + format, ...actual });
    }
  }
  return verified;
}

/** The source file is the original complete Open Waters bundle. The caller owns directory and scratch. */
export async function receiveScientificJobs({ sourceFile, directory, scratch, choicesFile = join(ROOT, 'choices.example.json'),
  configFile = join(ROOT, 'merchant.example.json'), python = 'python3', signal = new AbortController().signal } = {}) {
  sourceFile = await realpath(resolve(sourceFile)); directory = resolve(directory); scratch = resolve(scratch);
  await privateDirectory(directory); await privateDirectory(scratch);
  directory = await realpath(directory); scratch = await realpath(scratch);
  const lease = await acquireStateLease(directory);
  let inputs;
  const checkpointPath = join(directory, 'receiving.json');
  const save = value => writePrivateJson(checkpointPath, value, () => lease.assertHeld());
  const inputsDirectory = join(directory, 'inputs');
  try {
    const sourceMetadata = await metadata(sourceFile);
    let envelope = JSON.parse(await readFile(sourceFile, 'utf8'));
    if (envelope.schema !== SOURCE_SCHEMA) fail('Supply the original complete Open Waters bundle');
    const original = { source: sourceMetadata, captureSha256: envelope.plan.captureSha256,
      reviewId: envelope.plan.reviewId, reviewSha256: envelope.plan.reviewSha256,
      planId: envelope.plan.planId, planSha256: envelope.plan.planSha256,
      options: envelope.plan.options, sourceReviewArchiveSha256: envelope.reviewBundle.archiveSha256 };
    const choices = JSON.parse(await readFile(choicesFile, 'utf8'));
    if (choices.schema !== 'starforge.wqx-job-choices.v1' || choices.sourceReviewSha256 !== original.reviewSha256)
      fail('The scientific choices must name this original review SHA-256');
    await privateDirectory(join(directory, 'sources'));
    const reviewSource = join(directory, 'sources', 'complete-original-review.json');
    await immutable(reviewSource, Buffer.from(json(envelope.reviewBundle)));
    envelope = null; global.gc?.();
    const merchant = await readJobMerchant(configFile), definition = merchant.compiled.functions.waterQualityReview;
    if (!definition?.inputFiles) fail('The scientific function requires its original declared input-file policy');
    const identity = { original, sourceFile, choicesFile: await realpath(choicesFile),
      choices: await metadata(choicesFile), applicationSha256: merchant.identity.applicationSha256,
      configSha256: merchant.identity.configSha256 };
    let checkpoint = await existing(checkpointPath);
    if (checkpoint) equal(checkpoint.identity, identity, 'The retained receiving operation belongs to different inputs or source');
    else {
      checkpoint = { schema: RESULT_SCHEMA, identity, createdAt: new Date().toISOString(), completedAt: null,
        families: {
          review: { reference: 'wqx-review-' + sourceMetadata.sha256.slice(0,20), token: randomBytes(32).toString('base64url') },
          openWaters: { reference: 'wqx-open-waters-' + sourceMetadata.sha256.slice(0,20), token: randomBytes(32).toString('base64url') },
        } };
      await save(checkpoint);
    }
    inputs = await openInputStore({ directory: inputsDirectory, lease, limits: merchant.compiled.inputFileStorage });
    for (const kind of ['review', 'openWaters']) {
      signal.throwIfAborted();
      const state = checkpoint.families[kind], receivingRoot = join(directory, kind);
      await privateDirectory(receivingRoot);
      const familySource = kind === 'review' ? reviewSource : sourceFile, upload = {};
      upload.source = await stageFile(inputs, definition, merchant.compiled.publicOrigin, state.reference, 'source', familySource, state.token, signal);
      if (kind === 'review')
        upload.choices = await stageFile(inputs, definition, merchant.compiled.publicOrigin, state.reference, 'choices', choicesFile, state.token, signal);
      const input = { reviewId: kind === 'review' ? 'potomac-job-march-review' : 'potomac-job-original-review',
        expectedCaptureSha256: original.captureSha256, expectedReviewSha256: original.reviewSha256,
        ...(kind === 'openWaters' ? { planId: 'potomac-job-open-waters' } : {}),
        $files: Object.fromEntries(Object.entries(upload).map(([slot, value]) => [slot, value.file])) };
      const canonical = validateJobInput(definition, input);
      await inputs.pinJob({ origin: merchant.compiled.publicOrigin, reference: state.reference, functionId: 'waterQualityReview',
        ...canonical, policy: definition.inputFiles, token: state.token, signal });
      state.inputSha256 = canonical.inputSha256; state.uploads = upload; await save(checkpoint);
      const row = { id: state.reference, functionId: 'waterQualityReview', ...canonical };
      const resultPath = join(receivingRoot, 'water-quality-scientific-review.zip');
      if (!state.output) {
        let bytes = await executeJob(merchant, row, { id: 'native-scientific-1' },
          { env: { ...process.env, WQX_JOB_TEMP_ROOT: scratch }, signal, inputDirectory: inputsDirectory });
        const output = { path: resultPath, bytes: bytes.length, sha256: hash(bytes) };
        await immutable(resultPath, bytes); bytes = null;
        state.output = output; await save(checkpoint); global.gc?.();
      }
      equal(await metadata(resultPath), { bytes: state.output.bytes, sha256: state.output.sha256 }, 'The retained worker result changed');
      if (kind === 'openWaters' && !state.replay) {
        let replay = await executeJob(merchant, row, { id: 'native-scientific-2' },
          { env: { ...process.env, WQX_JOB_TEMP_ROOT: scratch }, signal, inputDirectory: inputsDirectory });
        const actual = { bytes: replay.length, sha256: hash(replay) }; replay = null;
        equal(actual, { bytes: state.output.bytes, sha256: state.output.sha256 }, 'Same-job native worker replay changed the result');
        state.replay = { ...actual, sameReference: row.id, sameInputSha256: row.inputSha256, attemptId: 'native-scientific-2' };
        await save(checkpoint); global.gc?.();
      }
      const selected = ['review/complete-review.json'];
      if (kind === 'openWaters') selected.push('open-waters/complete-open-waters.json');
      const archive = await verifyArchive(resultPath, join(receivingRoot, 'archive-verification.json'), python, selected);
      const manifest = archive.manifest;
      equal(manifest.sourceDecision.captureSha256, original.captureSha256, 'Source capture identity changed');
      equal(manifest.sourceDecision.reviewSha256, original.reviewSha256, 'Source review identity changed');
      equal(manifest.review.captureSha256, original.captureSha256, 'Result capture identity changed');
      if (kind === 'review') {
        equal(manifest.review.requestedOptions, choices.analysisOptions, 'Explicit scientific choices were not retained');
        equal(manifest.review.note, choices.note, 'Explicit reviewer note was not retained');
        if (manifest.openWaters !== null) fail('A plain scientific review unexpectedly selected an Open Waters plan');
      } else {
        equal(manifest.openWaters.options, original.options, 'Original Open Waters receiver choices changed');
        equal(manifest.decisionSelection.scientificOptions, 'ORIGINAL_REVIEW', 'Original scientific choice was not inherited');
        equal(manifest.decisionSelection.openWatersOptions, 'ORIGINAL_PLAN', 'Original receiving choice was not inherited');
      }
      const projectDirectory = join(receivingRoot, 'received-project');
      let project = await openWaterQualityProject(projectDirectory);
      let resultIdentity;
      try {
        const member = kind === 'openWaters' ? 'open-waters/complete-open-waters.json' : 'review/complete-review.json';
        let bundle = JSON.parse(await readFile(join(receivingRoot, 'extracted', member), 'utf8'));
        let received = kind === 'openWaters' ? await project.receiveOpenWaters({ bundle }) :
          (await project.receiveReviewBundle({ bundle })).review;
        resultIdentity = kind === 'openWaters' ? { planId: received.planId, planSha256: received.planSha256,
          reviewId: received.reviewId, reviewSha256: received.reviewSha256, captureSha256: received.captureSha256 } :
          { reviewId: received.reviewId, reviewSha256: received.reviewSha256, captureSha256: received.captureSha256 };
        received = null; bundle = null; global.gc?.();
        state.exports = await compareExports(project, manifest, kind === 'openWaters');
      } finally { await project.close(); }
      project = await openWaterQualityProject(projectDirectory);
      try {
        let reopened = kind === 'openWaters' ? await project.readOpenWaters(resultIdentity.planId) : await project.readReview(resultIdentity.reviewId);
        equal(reopened.reviewSha256, resultIdentity.reviewSha256, 'The same received project did not reopen its review');
        equal(reopened.captureSha256, original.captureSha256, 'The reopened project changed its original capture');
        if (kind === 'openWaters') equal(reopened.planSha256, resultIdentity.planSha256, 'The reopened plan changed');
        reopened = null;
      } finally { await project.close(); }
      state.archive = { members: archive.members, logicalBytes: archive.logicalBytes, sha256: archive.sha256 };
      state.receivedProject = { directory: projectDirectory, ...resultIdentity, reopened: true };
      state.decisionSelection = manifest.decisionSelection; state.completedAt ??= new Date().toISOString();
      await save(checkpoint); global.gc?.();
      process.stdout.write(json({ family: kind, output: state.output, receivedProject: state.receivedProject,
        exports: state.exports.length, replay: state.replay ?? null }));
    }
    checkpoint.completedAt ??= new Date().toISOString();
    await save(checkpoint);
    const result = { schema: RESULT_SCHEMA, completedAt: checkpoint.completedAt, original: checkpoint.identity.original,
      applicationSha256: checkpoint.identity.applicationSha256, configSha256: checkpoint.identity.configSha256,
      families: Object.fromEntries(Object.entries(checkpoint.families).map(([name, value]) => {
        const { token, ...publicResult } = value; return [name, publicResult];
      })) };
    await writePrivateJson(join(directory, 'result.json'), result, () => lease.assertHeld());
    return result;
  } finally { try { await inputs?.close(); } finally { await lease.close(); } }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { source: { type: 'string' }, directory: { type: 'string' },
    scratch: { type: 'string' }, choices: { type: 'string' }, config: { type: 'string' }, python: { type: 'string' } } });
  if (!values.source || !values.directory || !values.scratch)
    fail('Use --source COMPLETE_OPEN_WATERS_JSON --directory PRIVATE_RECEIVING --scratch PRIVATE_WORKER_TEMP');
  receiveScientificJobs({ sourceFile: values.source, directory: values.directory, scratch: values.scratch,
    choicesFile: values.choices, configFile: values.config, python: values.python }).then(result => {
    process.stdout.write(json({ completedAt: result.completedAt, families: Object.keys(result.families) }));
  }).catch(error => { process.stderr.write(json({ error: error.code ?? error.name, message: error.message, stack: error.stack })); process.exitCode = 1; });
}
