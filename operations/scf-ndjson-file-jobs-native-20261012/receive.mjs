// MIT. Actual SCVO files through original sealed intake, native jobs and cold receiving.
import { constants } from 'node:fs';
import { readFile, writeFile, mkdir, lstat, open, realpath, readdir } from 'node:fs/promises';
import { resolve, join, isAbsolute, dirname, basename } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';

const need = (value, message) => { if (!value) throw new Error(message); };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
async function json(path) { return JSON.parse(await readFile(path, 'utf8')); }
async function save(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
async function child(command, args, options = {}) {
  const process = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', failure = null;
  process.stdout.on('data', chunk => {
    stdout += chunk.toString('utf8');
    if (Buffer.byteLength(stdout) > 4194304) { failure = new Error('Native operation output exceeds 4 MiB'); process.kill('SIGTERM'); }
  });
  process.stderr.on('data', chunk => {
    stderr += chunk.toString('utf8');
    if (Buffer.byteLength(stderr) > 1048576) { failure = new Error('Native operation diagnostics exceed 1 MiB'); process.kill('SIGTERM'); }
  });
  return new Promise((resolveChild, reject) => {
    process.once('error', reject);
    process.once('close', (code, signal) => {
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error('Native command failed: ' + JSON.stringify({ command, code, signal, stderr })));
      else resolveChild({ stdout, stderr, code, signal });
    });
  });
}
export async function receiveDatasetFileJobs(input) {
  need(input?.schema === 'scf.ndjson-file-jobs-native-input.v1' &&
    input.operationId === 'SCF-NDJSON-FILE-JOBS-3AD791-20261012',
    'Select the original complete native operation input');
  const sourceRoot = await realpath(input.sourceRoot);
  const domain = await realpath(input.publisherProfileRoot);
  const output = resolve(input.outputDirectory), python = input.pythonExecutable;
  need(isAbsolute(python) && /^[a-f0-9]{40}$/.test(input.sourceCommit) &&
    /^[a-f0-9]{40}$/.test(input.publisherSourceCommit), 'Retain exact source pins and Python executable');
  await mkdir(output, { mode: 0o700 });
  const info = await lstat(output);
  need(info.isDirectory() && !(info.mode & 0o077), 'Native output directory must be private');
  const sdk = join(sourceRoot, 'stellar/scf-starforge-20261009/sf30-seller-sdk');
  const load = path => import(pathToFileURL(path).href);
  const [{ readJobMerchant, validateJobInput }, { executeJob }, { openInputStore },
    { planFromHandle, openAllowedInput }, { readChunk }, { CHUNK_BYTES },
    { acquireStateLease }, { runDatasetJobCommand }] = await Promise.all([
    load(join(sdk, 'jobs/config.mjs')), load(join(sdk, 'jobs/execution.mjs')),
    load(join(sdk, 'jobs/inputs/store.mjs')), load(join(sdk, 'jobs/inputs/source.mjs')),
    load(join(sdk, 'jobs/inputs/files.mjs')), load(join(sdk, 'jobs/inputs/protocol.mjs')),
    load(join(sdk, '../merchant-fleet-gateway/state-lease.mjs')),
    load(join(sdk, 'ndjson/jobs/cli.mjs')),
  ]);
  const preparedDirectory = join(output, 'prepared-inputs');
  await mkdir(preparedDirectory, { mode: 0o700 });
  const preparedResult = await child(python, ['-B', '-I',
    fileURLToPath(new URL('./prepare-inputs.py', import.meta.url)),
    '--profile', domain, '--out', preparedDirectory], { cwd: output });
  const prepared = JSON.parse(preparedResult.stdout);
  need(prepared.editions.length === 2, 'Both complete original publisher packages are required');
  await save(join(output, 'input-acquisition.json'), prepared);
  const source = await readJobMerchant(join(sdk, 'ndjson/jobs/example-merchant.json'));
  const functionId = 'prepareDataset', definition = source.compiled.functions[functionId];
  const environment = { ...process.env, SF30_NDJSON_PYTHON: python, SF30_XML_NODE: process.execPath };
  const priorNode = process.env.SF30_XML_NODE;
  process.env.SF30_XML_NODE = process.execPath;
  const originalStore = join(output, 'merchant-inputs');
  await mkdir(originalStore, { mode: 0o700 });
  const lease = await acquireStateLease(originalStore);
  let store = null;
  const outcome = { schema: 'scf.ndjson-file-jobs-native.v1', operationId: input.operationId,
    sourceCommit: input.sourceCommit, publisherSourceCommit: input.publisherSourceCommit,
    node: process.version, python: (await child(python, ['--version'])).stdout.trim(),
    application: source.identity, jobs: [], lifecycle: null, complete: false };
  try {
    store = await openInputStore({ directory: join(originalStore, 'files'), lease,
      limits: source.compiled.inputFileStorage });
    const token = randomBytes(32).toString('base64url');
    await writeFile(join(originalStore, 'original-private-claim.txt'), token, { flag: 'wx', mode: 0o600 });
    for (const edition of prepared.editions) {
      const reference = 'dataset:' + edition.id;
      const descriptors = {}, uploads = [];
      const selections = { source: edition.source, mapping: edition.mapping,
        ...(edition.baseline ? { baseline: edition.source } : {}) };
      for (const [slot, path] of Object.entries(selections)) {
        const selected = await openAllowedInput(path, [preparedDirectory]);
        try {
          const { plan } = await planFromHandle({ file: selected.file, origin: source.compiled.publicOrigin,
            reference, functionId, slot, policy: definition.inputFiles,
            filename: basename(path), contentType: 'application/json' });
          let received = await store.begin({ plan, token });
          for (const index of received.missing) {
            const bytes = await readChunk(selected.file,
              Math.min(CHUNK_BYTES, plan.file.bytes - index * CHUNK_BYTES), index * CHUNK_BYTES);
            received = await store.writeChunk({ id: received.id, token, index, body: bytes });
          }
          const sealed = await store.finish({ id: received.id, token });
          need(sealed.state === 'SEALED' && sealed.file.sha256 === plan.file.sha256,
            'Original file store must seal the complete selected bytes');
          descriptors[slot] = sealed.file;
          uploads.push({ slot, id: sealed.id, descriptor: sealed.file, chunks: sealed.totalChunks });
        } finally { await selected.close(); }
      }
      const ordinary = { reportName: edition.title, sourceLabel: edition.title,
        sourceFormat: 'json-array', sourceArrayPointer: '/grants',
        queryJson: '{"limit":"50"}', ...(edition.baseline ? {
          baselineLabel: edition.title + ' — same original edition',
          baselineFormat: 'json-array', baselineArrayPointer: '/grants',
        } : {}), $files: descriptors };
      const validated = validateJobInput(definition, ordinary);
      await store.pinJob({ origin: source.compiled.publicOrigin, reference, functionId,
        input: validated.input, policy: definition.inputFiles, inputSha256: validated.inputSha256, token });
      const body = await executeJob(source, { id: reference, functionId, ...validated },
        { id: reference + ':native-01' }, { env: environment, inputDirectory: store.directory });
      const resultPath = join(output, edition.id + '-dataset-project.zip');
      await writeFile(resultPath, body, { flag: 'wx', mode: 0o600 });
      const resultIdentity = { file: resultPath, bytes: body.length, sha256: sha256(body) };
      const customer = join(output, edition.id + '-customer');
      let received;
      const argv = ['receive', '--file', resultPath, '--out', customer,
        '--python', python, '--sha256', resultIdentity.sha256];
      await runDatasetJobCommand(argv, { print: value => { received = value; } });
      need(received.status === 'COMPLETE' && received.workspaceReopened &&
        received.editions.source.rows === edition.rows && received.issues.length === 0,
        'The customer must receive every original grant and reopen its native workspace');
      need(received.source.sha256 === resultIdentity.sha256 &&
        received.source.jobId === reference, 'Receiving must keep the selected original result identity');
      if (edition.baseline) {
        const counts = received.comparison?.counts;
        need(counts && counts.unchanged === edition.rows && counts.added === 0 &&
          counts.removed === 0 && counts.changed === 0,
          'The identical original baseline must compare unchanged for every grant');
      } else need(received.comparison === null, 'Independent publisher funds are separate datasets');
      let repeated;
      await runDatasetJobCommand(argv, { print: value => { repeated = value; } });
      need(isDeepStrictEqual(received, repeated), 'Repeated receiving must preserve the same complete result');
      const detail = await json(join(customer, 'result.json'));
      need(detail.sourceFiles.source.sha256 === edition.sourceSha256 &&
        detail.editions.source.build.columns.length === 26,
        'Complete original bytes and the production 26-column mapping must survive the job');
      outcome.jobs.push({ id: reference, original: edition, inputSha256: validated.inputSha256,
        uploads, result: resultIdentity, received, repeatReceiving: true });
      await save(join(output, edition.id + '-outcome.json'), outcome.jobs.at(-1));
      process.stdout.write(JSON.stringify({ edition: edition.id, rows: edition.rows,
        result: resultIdentity, customerReopened: true }) + '\n');
    }
  } finally {
    await store?.close(); await lease.close();
    if (priorNode === undefined) delete process.env.SF30_XML_NODE; else process.env.SF30_XML_NODE = priorNode;
  }
  if (input.lifecycleCompanion) {
    const companion = await load(resolve(input.lifecycleCompanion));
    outcome.lifecycle = await companion.runLifecycle({ sourceRoot, outputDirectory: join(output, 'lifecycle'),
      pythonExecutable: python });
  }
  outcome.complete = true;
  await save(join(output, 'native-outcome.json'), outcome);
  return outcome;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  receiveDatasetFileJobs(await json(resolve(process.argv[2]))).then(value => {
    process.stdout.write(JSON.stringify({ operationId: value.operationId, complete: value.complete,
      jobs: value.jobs.map(job => ({ id: job.id, rows: job.received.editions.source.rows,
        result: job.result, customerReopened: job.received.workspaceReopened })) }) + '\n');
  }).catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
}
