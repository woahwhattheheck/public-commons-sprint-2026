// MIT. One original IATI release, publisher workspace, installed operator and customer handover.
import { constants } from 'node:fs';
import { open, lstat, realpath, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { operationLease, saveJSON, canonical, need } from '../../../distribution/runtime-workspace/storage.mjs';
import { prepareIatiOperatorRuntime } from './runtime.mjs';

const SCHEMA = 'stellar-forge.iati-complete-receiving.v1';
const IATI = 'stellar/scf-starforge-20261009/sf30-seller-sdk/iati/';
const DISTRIBUTION = 'stellar/scf-starforge-20261009/distribution/';
const SHA = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const ownRoot = resolve(fileURLToPath(new URL('../../../../../', import.meta.url)));
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const json = value => JSON.stringify(value, null, 2) + '\n';
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const inside = (path, root) => path === root || path.startsWith(root + '/');
const missing = error => error.code === 'ENOENT';

function absolute(value, name) {
  need(typeof value === 'string' && value === resolve(value) && value !== '/' && !value.includes('\0'),
    'IATI_COMPLETE_ABSOLUTE_PATH_REQUIRED', name);
  return value;
}
async function exists(path) {
  try { return await lstat(path); } catch (error) { if (missing(error)) return null; throw error; }
}
async function directory(path, create = false) {
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() && await realpath(path) === path &&
    !(info.mode & 0o077) && (!process.getuid || info.uid === process.getuid()),
  'IATI_COMPLETE_PRIVATE_DIRECTORY_REQUIRED', path);
  return path;
}
async function bytes(path, maximum = 64 * 1024 * 1024) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    need(before.isFile() && before.size <= BigInt(maximum), 'IATI_COMPLETE_REGULAR_FILE_REQUIRED', path);
    const value = await handle.readFile(), after = await handle.stat({ bigint: true }), named = await lstat(path, { bigint: true });
    need(BigInt(value.length) === before.size && before.dev === named.dev && before.ino === named.ino &&
      ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => before[key] === after[key]),
    'IATI_COMPLETE_FILE_CHANGED', path);
    return value;
  } finally { await handle.close(); }
}
async function record(path, optional = false) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bytes(path))); }
  catch (error) { if (optional && missing(error)) return null; throw error; }
}
async function identity(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    need(before.isFile() && before.size <= BigInt(Number.MAX_SAFE_INTEGER), 'IATI_COMPLETE_REGULAR_FILE_REQUIRED', path);
    const hash = createHash('sha256');
    let count = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) { count += chunk.length; hash.update(chunk); }
    const after = await handle.stat({ bigint: true }), named = await lstat(path, { bigint: true });
    need(BigInt(count) === before.size && before.dev === named.dev && before.ino === named.ino &&
      ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => before[key] === after[key]),
    'IATI_COMPLETE_FILE_CHANGED', path);
    return { path, bytes: count, sha256: hash.digest('hex') };
  } finally { await handle.close(); }
}
async function verifyFile(expected) {
  need(plain(expected) && SHA.test(expected.sha256 ?? '') && Number.isSafeInteger(expected.bytes) && expected.bytes >= 0,
    'IATI_COMPLETE_FILE_IDENTITY_REQUIRED');
  const actual = await identity(absolute(expected.path, 'file.path'));
  need(actual.sha256 === expected.sha256 && actual.bytes === expected.bytes, 'IATI_COMPLETE_FILE_CHANGED', expected.path);
  return actual;
}
async function immutable(path, value) {
  const prior = await record(path, true);
  if (prior !== null) { need(same(prior, value), 'IATI_COMPLETE_SELECTION_CHANGED', path); return prior; }
  await saveJSON(path, value, true);
  need(same(await record(path), value), 'IATI_COMPLETE_SELECTION_CHANGED', path);
  return value;
}
function configuration(value) {
  need(plain(value) && value.schema === SCHEMA, 'IATI_COMPLETE_CONFIGURATION_REQUIRED');
  const required = ['schema', 'operationId', 'sourceRoot', 'repository', 'sourceCommit',
    'directory', 'outputDirectory', 'publisher', 'publisherNotice', 'actor',
    'pythonExecutable', 'npmExecutable', 'chromiumExecutable', 'playwrightModule'];
  const allowed = new Set([...required, 'sourceOffline', 'dependencyOffline', 'sourceReceiving', 'publisherFiles']);
  need(required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => allowed.has(key)),
    'IATI_COMPLETE_CONFIGURATION_FIELDS');
  need(typeof value.operationId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(value.operationId) &&
    COMMIT.test(value.sourceCommit ?? ''), 'IATI_COMPLETE_ORIGINAL_OPERATION_REQUIRED');
  for (const key of ['sourceRoot', 'repository', 'directory', 'outputDirectory', 'pythonExecutable',
    'npmExecutable', 'chromiumExecutable', 'playwrightModule']) absolute(value[key], key);
  need(plain(value.actor) && same(Object.keys(value.actor).sort(), ['id', 'label']) &&
    Object.values(value.actor).every(text => typeof text === 'string' && text.trim() && text.length <= 160),
  'IATI_COMPLETE_NAMED_OPERATOR_REQUIRED');
  need(plain(value.publisher) && same(Object.keys(value.publisher).sort(), ['bytes', 'fetchedAt', 'label', 'path', 'sha256', 'url']) &&
    SHA.test(value.publisher.sha256 ?? '') && Number.isSafeInteger(value.publisher.bytes) && value.publisher.bytes > 0 &&
    value.publisher.bytes <= 256 * 1024 * 1024 && typeof value.publisher.label === 'string' &&
    value.publisher.label.length > 0 && value.publisher.label.length <= 160 &&
    typeof value.publisher.url === 'string' && value.publisher.url.startsWith('https://') &&
    typeof value.publisher.fetchedAt === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value.publisher.fetchedAt) &&
    Number.isFinite(Date.parse(value.publisher.fetchedAt)), 'IATI_COMPLETE_ORIGINAL_PUBLISHER_REQUIRED');
  absolute(value.publisher.path, 'publisher.path');
  if (value.publisherFiles !== undefined) {
    need(Array.isArray(value.publisherFiles) && value.publisherFiles.length <= 32,
      'IATI_COMPLETE_PUBLISHER_FILES_INVALID');
    const names = new Set(), paths = new Set([value.publisher.path]);
    for (const file of value.publisherFiles) {
      need(plain(file) && same(Object.keys(file).sort(), ['bytes', 'name', 'path', 'sha256']) &&
        typeof file.name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.(?:json|md|txt)$/.test(file.name) &&
        SHA.test(file.sha256 ?? '') && Number.isSafeInteger(file.bytes) && file.bytes >= 0 &&
        file.bytes <= 64 * 1024 * 1024, 'IATI_COMPLETE_PUBLISHER_FILE_IDENTITY_REQUIRED');
      absolute(file.path, 'publisherFiles.path');
      need(!names.has(file.name.toLowerCase()) && !paths.has(file.path) &&
        !inside(file.path, value.directory) && !inside(file.path, value.outputDirectory),
      'IATI_COMPLETE_PUBLISHER_FILES_DISTINCT_SOURCE_REQUIRED');
      names.add(file.name.toLowerCase()); paths.add(file.path);
    }
  }
  need(typeof value.publisherNotice === 'string' && value.publisherNotice.trim() && value.publisherNotice.length <= 32000,
    'IATI_COMPLETE_PUBLISHER_ATTRIBUTION_REQUIRED');
  for (const key of ['sourceOffline', 'dependencyOffline'])
    need(value[key] === undefined || typeof value[key] === 'boolean', 'IATI_COMPLETE_SOURCE_OPTIONS_INVALID');
  for (const path of [value.directory, value.sourceRoot, value.repository])
    need(!inside(path, value.outputDirectory) && !inside(value.outputDirectory, path),
      'IATI_COMPLETE_SEPARATE_OUTPUT_REQUIRED', path);
  need(!inside(value.publisher.path, value.directory) && !inside(value.publisher.path, value.outputDirectory),
    'IATI_COMPLETE_ORIGINAL_PUBLISHER_LOCATION_REQUIRED');
  return { ...value, sourceOffline: value.sourceOffline ?? true, dependencyOffline: value.dependencyOffline ?? true };
}

/** The caller owns the original admitted native operation. This function creates no scheduler. */
export async function runCompleteIatiReceiving(input, { onProgress = () => {} } = {}) {
  process.umask(0o077);
  const selected = configuration(input);
  need(typeof onProgress === 'function', 'IATI_COMPLETE_PROGRESS_CALLBACK_REQUIRED');
  need(await realpath(ownRoot) === selected.sourceRoot, 'IATI_COMPLETE_BOOTSTRAP_LOCATION_CHANGED');
  const output = await directory(selected.outputDirectory, true);
  const lease = await operationLease(join(output, 'receiving.lock'));
  const progressPath = join(output, 'progress.json');
  let stage = 'SOURCE', progress;
  const signal = value => onProgress({ operationId: selected.operationId, stage, ...value });
  async function checkpoint(value) {
    progress.stages[stage] = value;
    progress.updatedAt = new Date().toISOString();
    await saveJSON(progressPath, progress, true);
    signal({ phase: value.state ?? 'COMPLETE' });
  }
  async function runPython(name, script, inputFile, resultFile) {
    const attemptsDirectory = await directory(join(output, 'commands', name), true);
    const request = { executable: selected.pythonExecutable, argv: [script, '--input', inputFile],
      cwd: output, node: process.execPath };
    await immutable(join(attemptsDirectory, 'request.json'), request);
    const attemptsFile = join(attemptsDirectory, 'attempts.json');
    const attempts = await record(attemptsFile, true) ?? [];
    need(Array.isArray(attempts) && attempts.length < 1024, 'IATI_COMPLETE_COMMAND_ATTEMPTS_INVALID');
    const index = attempts.length;
    const attempt = { index, selectedAt: new Date().toISOString(),
      stdout: join(attemptsDirectory, 'stdout-' + index + '.json'),
      stderr: join(attemptsDirectory, 'stderr-' + index + '.log') };
    attempts.push(attempt);
    await saveJSON(attemptsFile, attempts, true);
    const stdout = await open(attempt.stdout, 'wx', 0o600), stderr = await open(attempt.stderr, 'wx', 0o600);
    let child, ended = false, interrupted = null;
    const forward = value => { interrupted = value; if (child && !ended) child.kill(value); };
    const term = () => forward('SIGTERM'), interrupt = () => forward('SIGINT');
    try {
      child = spawn(request.executable, request.argv, { shell: false, cwd: output,
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', SF30_XML_NODE: process.execPath },
        stdio: ['ignore', stdout.fd, stderr.fd] });
      process.on('SIGTERM', term); process.on('SIGINT', interrupt);
      const observed = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, childSignal) => { ended = true; resolve({ exitCode: code, signal: childSignal }); });
      });
      await stdout.sync(); await stderr.sync();
      Object.assign(attempt, observed, { pid: child.pid, endedAt: new Date().toISOString(),
        stdoutFile: await identity(attempt.stdout), stderrFile: await identity(attempt.stderr) });
      await saveJSON(attemptsFile, attempts, true);
      need(!interrupted && observed.exitCode === 0, 'IATI_COMPLETE_ORIGINAL_COMMAND_FAILED', attempt.stderr);
      return await record(resultFile);
    } finally {
      process.off('SIGTERM', term); process.off('SIGINT', interrupt);
      if (child && !ended && child.pid) child.kill('SIGTERM');
      await stdout.close(); await stderr.close();
    }
  }
  try {
    await immutable(join(output, 'input.json'), selected);
    await verifyFile(selected.publisher);
    for (const file of selected.publisherFiles ?? []) await verifyFile(file);
    progress = await record(progressPath, true) ?? { schema: SCHEMA, operationId: selected.operationId,
      createdAt: new Date().toISOString(), stages: {} };
    need(progress.schema === SCHEMA && progress.operationId === selected.operationId && plain(progress.stages),
      'IATI_COMPLETE_PROGRESS_CHANGED');
    await directory(join(output, 'commands'), true);

    stage = 'RUNTIME';
    const prepared = await prepareIatiOperatorRuntime({
      repository: selected.repository, sourceRoot: selected.sourceRoot, sourceCommit: selected.sourceCommit,
      outputDirectory: join(output, 'runtime'), operationId: selected.operationId,
      pythonExecutable: selected.pythonExecutable, npmExecutable: selected.npmExecutable,
      sourceOffline: selected.sourceOffline, dependencyOffline: selected.dependencyOffline,
      sourceReceiving: selected.sourceReceiving, onProgress: signal,
    });
    need(prepared.state === 'READY' && prepared.sourceCommit === selected.sourceCommit,
      'IATI_COMPLETE_RUNTIME_NOT_READY');
    for (const name of ['runtime.mjs', 'publisher.py', 'operator.mjs', 'browser.mjs', 'complete.mjs', 'handover.py']) {
      const before = await identity(join(selected.sourceRoot, IATI, 'receiving', name));
      const installed = await identity(join(prepared.sourceRoot, IATI, 'receiving', name));
      need(before.bytes === installed.bytes && before.sha256 === installed.sha256,
        'IATI_COMPLETE_INSTALLED_WORKFLOW_CHANGED', name);
    }
    await checkpoint({ state: 'READY', installationId: prepared.installationId, runtimeDirectory: prepared.runtimeDirectory,
      sourceRoot: prepared.sourceRoot, sourceManifestSha256: prepared.sourceManifestSha256 });
    const previous = await record(join(output, 'result.json'), true);
    if (previous) {
      need(previous.schema === SCHEMA && previous.state === 'COMPLETE' &&
        previous.operationId === selected.operationId && previous.sourceCommit === selected.sourceCommit &&
        same(previous.publisher, selected.publisher), 'IATI_COMPLETE_COMPLETION_CHANGED');
      for (const file of previous.files) await verifyFile(file);
      return { ...previous, reused: true };
    }

    stage = 'PUBLISHER';
    const coreDirectory = await directory(join(output, 'publisher'), true);
    const coreInput = { schema: 'stellar-forge.iati-publisher-receiving.v1',
      sourceRoot: prepared.sourceRoot, directory: selected.directory, outputDirectory: coreDirectory,
      operationId: selected.operationId, actor: selected.actor, publisher: selected.publisher };
    const coreInputFile = join(coreDirectory, 'input.json'), coreResultFile = join(coreDirectory, 'result.json');
    await immutable(coreInputFile, coreInput);
    // Once the core checkpoint is complete, Applications may have added its next
    // named review. Continue the installed operator; do not rewrite the old cohort.
    const core = await record(coreResultFile, true) ??
      await runPython('publisher', join(prepared.sourceRoot, IATI, 'receiving/publisher.py'), coreInputFile, coreResultFile);
    need(core.schema === coreInput.schema && core.operationId === selected.operationId &&
      core.directory === selected.directory && core.sourceRoot === prepared.sourceRoot &&
      same(core.publisher, selected.publisher) && core.source === selected.publisher.sha256 &&
      SHA.test(core.expected?.portfolioId ?? '') && core.expected.revision === 4 &&
      core.expected.portfolioId === core.portfolio?.id && core.expected.definitionSha256 === core.portfolio.definitionSha256 &&
      same(core.expected.counts, core.portfolio.report.counts) &&
      same(core.expected.financialGroups, core.portfolio.report.financialGroups),
    'IATI_COMPLETE_CORE_SELECTION_CHANGED');
    for (const file of [core.report, core.packet, ...core.datasets.flatMap(dataset => Object.values(dataset.files))])
      await verifyFile(file);
    await checkpoint({ state: 'COMPLETE', source: core.source, portfolio: core.expected.portfolioId,
      revision: core.expected.revision, result: await identity(coreResultFile) });

    stage = 'OPERATOR';
    const { runIatiOperatorReceiving } = await import(pathToFileURL(join(prepared.sourceRoot, IATI, 'receiving/operator.mjs')).href);
    const operated = await runIatiOperatorReceiving({
      directory: selected.directory, outputDirectory: join(output, 'operator'), sourceRoot: prepared.sourceRoot,
      runtimeDirectory: prepared.runtimeDirectory, operationId: selected.operationId, actor: selected.actor,
      expected: core.expected, pythonExecutable: selected.pythonExecutable,
      chromiumExecutable: selected.chromiumExecutable, playwrightModule: selected.playwrightModule,
    });
    need(operated.state === 'COMPLETE' && operated.operationId === selected.operationId &&
      operated.source.portfolio === core.expected.portfolioId && operated.source.reviewedRevision === core.expected.revision + 1 &&
      same(operated.source.counts, core.expected.counts) && same(operated.source.financialGroups, core.expected.financialGroups) &&
      operated.received.portfolio === operated.source.portfolio &&
      operated.received.revision === operated.source.reviewedRevision &&
      operated.applications.length === 2 && operated.applications.every(application => application.phase === 'STOPPED'),
    'IATI_COMPLETE_OPERATOR_SELECTION_CHANGED');
    for (const file of operated.files) await verifyFile(file);
    await checkpoint({ state: 'COMPLETE', portfolio: operated.received.portfolio, revision: operated.received.revision,
      historyRevisions: operated.received.historyRevisions,
      result: await identity(join(output, 'operator/result.json')) });

    stage = 'HANDOVER';
    const packet = operated.files.find(file => file.path === join(output, 'operator/downloads/mcp-portfolio.zip'));
    const report = operated.files.find(file => file.path === join(output, 'operator/downloads/mcp-report.zip'));
    need(packet && report, 'IATI_COMPLETE_FINAL_CUSTOMER_FILES_REQUIRED');
    const customerFiles = [
      { ...await verifyFile(prepared.archive), name: 'runtime/' + basename(prepared.archive.path) },
      { ...await verifyFile(selected.publisher), name: 'publisher/publisher.xml' },
      { ...await verifyFile(packet), name: 'portfolio/iati-portfolio.zip' },
      { ...await verifyFile(report), name: 'reports/iati-report.zip' },
    ];
    for (const file of selected.publisherFiles ?? [])
      customerFiles.push({ ...await verifyFile(file), name: 'publisher/metadata/' + file.name });
    for (const dataset of core.datasets)
      for (const [name, file] of Object.entries(dataset.files))
        customerFiles.push({ ...await verifyFile(file), name: 'merchant-datasets/' + dataset.collection + '/' + name });
    for (const [path, name] of [
      [IATI + 'README.md', 'guides/IATI.md'], [IATI + 'DOMAIN.md', 'guides/DOMAIN.md'],
      [IATI + 'OPERATIONS.md', 'guides/OPERATIONS.md'], [IATI + 'receiving/RUNTIME.md', 'guides/RUNTIME.md'],
      [IATI + 'receiving/HANDOVER.md', 'guides/HANDOVER.md'],
      [DISTRIBUTION + 'selections/IATI_OPERATOR.md', 'guides/INSTALLATION.md'],
    ]) customerFiles.push({ ...await identity(join(prepared.sourceRoot, path)), name });
    const researchMetadata = await record(join(prepared.sourceRoot, IATI, 'receiving/aiddata-nigeria.json'), true);
    if (researchMetadata?.source?.sha256 === selected.publisher.sha256 &&
        researchMetadata.source.bytes === selected.publisher.bytes) {
      for (const name of ['AIDDATA_NIGERIA.md', 'aiddata-nigeria.json'])
        customerFiles.push({ ...await identity(join(prepared.sourceRoot, IATI, 'receiving', name)), name: 'publisher/' + name });
    }
    const handoverDirectory = await directory(join(output, 'handover'), true);
    const customerInput = { schema: 'stellar-forge.iati-customer-handover.v1', operationId: selected.operationId,
      output: join(handoverDirectory, 'IATI_Customer_Handover.zip'), sourceCommit: selected.sourceCommit,
      publisher: Object.fromEntries(['label', 'url', 'fetchedAt', 'bytes', 'sha256'].map(key => [key, selected.publisher[key]])),
      portfolio: { id: operated.source.portfolio, revision: operated.source.reviewedRevision,
        definitionSha256: operated.source.definitionSha256, counts: operated.source.counts,
        financialGroups: operated.source.financialGroups },
      files: customerFiles, notice: selected.publisherNotice };
    const customerInputFile = join(handoverDirectory, 'input.json');
    await immutable(customerInputFile, customerInput);
    const customerResultFile = join(handoverDirectory, 'result.json');
    const handover = await record(customerResultFile, true) ??
      await runPython('handover', join(prepared.sourceRoot, IATI, 'receiving/handover.py'), customerInputFile, customerResultFile);
    const customerArchive = await verifyFile({ path: customerInput.output, bytes: handover.bytes, sha256: handover.sha256 });
    need(handover.schema === customerInput.schema && handover.operationId === selected.operationId &&
      handover.sourceCommit === selected.sourceCommit, 'IATI_COMPLETE_CUSTOMER_HANDOVER_CHANGED');
    await checkpoint({ state: 'COMPLETE', archive: customerArchive });
    stage = 'COMPLETE';
    const files = [...new Map([customerArchive, prepared.archive, core.report, core.packet,
      ...operated.files, ...core.datasets.flatMap(dataset => Object.values(dataset.files))]
      .concat(selected.publisherFiles ?? [])
      .map(file => [file.path, { path: file.path, bytes: file.bytes, sha256: file.sha256 }])).values()];
    const result = { schema: SCHEMA, state: 'COMPLETE', operationId: selected.operationId,
      sourceCommit: selected.sourceCommit, completedAt: new Date().toISOString(), actor: selected.actor,
      publisher: selected.publisher, publisherNotice: selected.publisherNotice,
      ...(selected.publisherFiles === undefined ? {} : { publisherFiles: selected.publisherFiles }),
      runtime: prepared, core, operator: operated, handover, customerArchive, files };
    await immutable(join(output, 'result.json'), result);
    await checkpoint({ state: 'COMPLETE', customerArchive, portfolio: customerInput.portfolio });
    return result;
  } catch (error) {
    await saveJSON(join(output, 'error.json'), { schema: SCHEMA, operationId: selected.operationId,
      stage, at: new Date().toISOString(), code: error.code ?? 'IATI_COMPLETE_FAILED',
      message: String(error.message), ...(error.missingObjectsFile ? { missingObjectsFile: error.missingObjectsFile } : {}) }, true).catch(() => {});
    throw error;
  } finally { await lease.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length === 3 && ['--help', '-h', 'help'].includes(process.argv[2])) {
    process.stdout.write('node complete.mjs /absolute/iati-complete-input.json\n' +
      'Run the original committed installation, full publisher workspace, actual Applications receiving and complete customer handover.\n');
  } else {
    need(process.argv.length === 3, 'IATI_COMPLETE_INPUT_FILE_REQUIRED');
    const input = await record(absolute(process.argv[2], 'input file'));
    const result = await runCompleteIatiReceiving(input, { onProgress: value => process.stderr.write(json(value)) });
    process.stdout.write(json({ schema: result.schema, state: result.state, operationId: result.operationId,
      sourceCommit: result.sourceCommit, portfolio: result.operator.received, customerArchive: result.customerArchive,
      result: join(input.outputDirectory, 'result.json'), reused: result.reused ?? false }));
  }
}
