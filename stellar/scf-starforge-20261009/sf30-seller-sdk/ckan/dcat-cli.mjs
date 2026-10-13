#!/usr/bin/env node
// MIT. DCAT catalog operations through the original retained workspace and loopback service.
import { resolve, dirname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { verifyDcatManagedSelection } from '../../distribution/runtime-workspace/application-dcat.mjs';
import { openCkanWorkbench } from './model.mjs';
import { semanticCliOptions, semanticCliUsage, executeDcatSemanticCommand } from './dcat-semantic-cli.mjs';
import { semanticRuntimeCliOptions, semanticRuntimeCliUsage, executeDcatSemanticRuntimeCommand } from './dcat-semantic-runtime.mjs';
import { semanticRuntimeTransferCliOptions, semanticRuntimeTransferCliUsage, executeDcatSemanticRuntimeTransferCommand } from './dcat-semantic-runtime-transfer.mjs';
import { openWorkbenchOwner, saveWorkbenchStartup } from './workbench-owner.mjs';
import { parseCkanJson } from './capture.mjs';
import { startCkanServer } from './server.mjs';
import { inspectCkanWorkspaceArchive, receiveCkanWorkspaceArchive } from './archive.mjs';
import { readPrivate, createFile, privateDirectory, digest, fault } from '../postgres/publisher/files.mjs';

const usage = [
  'DCAT catalog migration workspace',
  '  dcat init --workspace DIR --origin https://publisher.example',
  '  dcat serve --workspace DIR [--port 0] [--startup-file PRIVATE.json]',
  '  dcat status --workspace DIR',
  '  dcat source --workspace DIR --source ID',
  '  dcat save-source --workspace DIR --label TEXT --url URL [--source ID --expected-source HASH] [--profile auto|1.1|3.0] [--token-env NAME|none] [--interval-minutes 60] [--timeout-ms 30000] [--max-bytes 134217728] [--enabled true|false]',
  '  dcat acquire --workspace DIR --source ID --expected-source HASH --expected-latest none|ID [--unconditional true] [--retry-of ID]',
  '  dcat acquire-due --workspace DIR [--startup-file PRIVATE.json]',
  '  dcat review-source --workspace DIR --source ID --expected-source HASH --expected-latest ID [--baseline-release ID --baseline-sha256 HASH --baseline-review-sha256 HASH] [--reuse-mappings 0,2] [--candidate ID] [--mappings FILE.json] [--normalize-v3 true] [--label TEXT]',
  '  dcat export --workspace DIR --kind receipt|response --acquisition ID --out FILE',
  '  dcat import --workspace DIR --file FILE.json [--profile auto|1.1|3.0] [--label TEXT] [--origin URL] [--sha256 HASH]',
  '  dcat review --workspace DIR --source ID [--comparison ID] [--candidate ID] [--mappings FILE.json] [--label TEXT] [--normalize-v3 true]',
  '  dcat inspect --workspace DIR --review ID',
  '  dcat cutover --workspace DIR --review ID --expected-active none|ID --note TEXT [--review-sha256 HASH] [--candidate-sha256 HASH]',
  '  dcat rollback --workspace DIR --release ID --expected-active ID --note TEXT [--review-sha256 HASH] [--candidate-sha256 HASH]',
  '  dcat export --workspace DIR --kind candidate|report --review ID --out FILE.json',
  '  dcat export --workspace DIR --kind original --catalog ID --out FILE.json',
  '  dcat export --workspace DIR --kind current --out FILE.json',
  '  dcat archive --workspace DIR --out FILE.ckanw',
  '  dcat inspect-archive --file FILE.ckanw [--sha256 HASH]',
  '  dcat receive --file FILE.ckanw --sha256 HASH --workspace NEW_DIR',
  ...semanticCliUsage,
  ...semanticRuntimeCliUsage,
  ...semanticRuntimeTransferCliUsage,
  'Set SCF_DCAT_PYTHON to the prepared interpreter; the default profile original requires Python 3.13.',
  'For prepared Python 3.12, explicitly set SCF_DCAT_RUNTIME_PROFILE=portable-python312; see PORTABLE_RUNTIME.md.',
  'Catalog originals, corrected candidates, full reviews and release history remain in the same saved project.',
].join('\n');
const output = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
const optionsByCommand = {
  ...semanticCliOptions,
  ...semanticRuntimeCliOptions,
  ...semanticRuntimeTransferCliOptions,
  init: ['workspace', 'origin'], serve: ['workspace', 'port', 'managed-selection', 'startup-file'],
  status: ['workspace'], source: ['workspace', 'source'],
  'save-source': ['workspace', 'source', 'expected-source', 'label', 'url', 'profile', 'token-env', 'interval-minutes', 'timeout-ms', 'max-bytes', 'enabled'],
  acquire: ['workspace', 'source', 'expected-source', 'expected-latest', 'unconditional', 'retry-of'],
  'acquire-due': ['workspace', 'startup-file'],
  'review-source': ['workspace', 'source', 'expected-source', 'expected-latest', 'baseline-release', 'baseline-sha256', 'baseline-review-sha256', 'reuse-mappings', 'candidate', 'mappings', 'normalize-v3', 'label'],
  import: ['workspace', 'file', 'profile', 'label', 'origin', 'sha256'],
  review: ['workspace', 'source', 'comparison', 'candidate', 'mappings', 'label', 'normalize-v3'],
  inspect: ['workspace', 'review'], cutover: ['workspace', 'review', 'expected-active', 'note', 'review-sha256', 'candidate-sha256'],
  rollback: ['workspace', 'release', 'expected-active', 'note', 'review-sha256', 'candidate-sha256'],
  export: ['workspace', 'kind', 'review', 'catalog', 'acquisition', 'out'], archive: ['workspace', 'out'],
  'inspect-archive': ['file', 'sha256'], receive: ['file', 'sha256', 'workspace'],
};

// Operate the current authenticated owner without opening a second project lease.
async function acquireDueThroughListener(startupFile, directory) {
  const { api, listener, startupSha256 } = await openWorkbenchOwner(startupFile, directory);
  const state = await api('status'), outcomes = [];
  const result = { listener: { instanceId: listener.instanceId, pid: listener.pid, directory },
    startupSha256, checkedAt: new Date().toISOString(), sources: outcomes };
  if (state.active) return { ...result, deferred: true, reason: 'PROJECT_BUSY' };
  for (const selected of state.dcat?.sources ?? []) {
    let current;
    try {
      current = (await api('dcat/sources/' + selected.id)).source;
      const now = Date.now();
      if (current.enabled === false || current.nextCheckAt && Date.parse(current.nextCheckAt) > now ||
          current.retryNotBefore && Date.parse(current.retryNotBefore) > now) continue;
      const started = await api('dcat/sources/acquire', { sourceId: current.id,
        expectedSourceSha256: current.sourceSha256, expectedLatestCatalogId: current.latestCatalogId ?? null,
        onlyIfDue: true });
      if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(started.acquisitionId ?? ''))
        throw fault('DCAT_LISTENER_ACQUISITION_INVALID');
      const deadline = Date.now() + (current.timeoutMs ?? 30000) + 60000;
      let attempt;
      while (Date.now() < deadline) {
        const record = await api('dcat/sources/' + current.id);
        attempt = record.acquisitions.find(item => item.id === started.acquisitionId);
        if (attempt && attempt.status !== 'FETCHING') break;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (!attempt || attempt.status === 'FETCHING')
        throw fault('DCAT_ACQUISITION_STILL_RUNNING', 'Inspect the retained original acquisition before the next due dispatch.');
      outcomes.push({ sourceId: current.id, operationId: started.operationId, acquisition: attempt });
      if (!['ACQUIRED', 'UNCHANGED', 'NOT_MODIFIED'].includes(attempt.status)) process.exitCode = 1;
    } catch (error) {
      if (error.code === 'CKAN_PROJECT_BUSY') {
        outcomes.push({ sourceId: selected.id, deferred: true, reason: 'PROJECT_BUSY' }); break;
      }
      outcomes.push({ sourceId: selected.id, error: { code: error.code ?? 'DCAT_ACQUIRE_FAILED', message: error.message } });
      process.exitCode = 1;
    }
  }
  return result;
}

export async function main(supplied = process.argv.slice(2)) {
  const argv = [...supplied], command = argv.shift(), options = {};
  if (!command || ['help', '--help'].includes(command)) { process.stdout.write(usage + '\n'); return; }
  if (!optionsByCommand[command]) throw fault('DCAT_COMMAND_UNKNOWN', usage);
  for (let i = 0; i < argv.length; i += 2) {
    if (!/^--[a-z][a-z-]*$/.test(argv[i]) || argv[i + 1] === undefined || argv[i + 1].startsWith('--'))
      throw fault('DCAT_COMMAND_ARGUMENTS', 'Use named --option value arguments.\n' + usage);
    const key = argv[i].slice(2);
    if (!optionsByCommand[command].includes(key) || Object.hasOwn(options, key))
      throw fault('DCAT_COMMAND_ARGUMENTS', 'Unknown or repeated option: --' + key);
    options[key] = argv[i + 1];
  }
  const required = name => {
    if (!options[name]) throw fault('DCAT_COMMAND_ARGUMENTS', 'Supply --' + name + '.');
    return options[name];
  };
  if (Object.hasOwn(semanticRuntimeCliOptions, command) || Object.hasOwn(semanticRuntimeTransferCliOptions, command)) {
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    try {
      const execute = Object.hasOwn(semanticRuntimeTransferCliOptions, command)
        ? executeDcatSemanticRuntimeTransferCommand : executeDcatSemanticRuntimeCommand;
      const result = await execute(command, options, { signal: controller.signal });
      output(result.schema === 'stellar-forge.dcat-semantic-prepared-runtime.v1'
        ? { schema: result.schema, status: result.status, directory: result.directory, python: result.python,
            receiptSha256: result.receiptSha256, receiptBytes: result.receiptBytes,
            lockSha256: result.lockSha256, packageCount: result.packages.length,
            completeReceipt: resolve(result.directory, 'runtime.json') } : result);
      return result;
    } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
  }
  if (command === 'inspect-archive') {
    output(await inspectCkanWorkspaceArchive({ file: resolve(required('file')), expectedSha256: options.sha256 })); return;
  }
  if (command === 'receive') {
    output(await receiveCkanWorkspaceArchive({ file: resolve(required('file')), directory: resolve(required('workspace')),
      expectedSha256: required('sha256') })); return;
  }
  if (command === 'acquire-due' && options['startup-file'] !== undefined) {
    output(await acquireDueThroughListener(resolve(required('startup-file')), resolve(required('workspace')))); return;
  }
  const project = await openCkanWorkbench({ directory: resolve(required('workspace')), create: command === 'init',
    ...(command === 'init' ? { sourceKind: 'dcat-us', origin: required('origin') } : {}) });
  let served = false;
  try {
    if (command === 'serve') {
      let selection;
      if (options['managed-selection']) {
        try { selection = JSON.parse(options['managed-selection']); }
        catch { throw fault('DCAT_MANAGED_SELECTION_INVALID'); }
        await verifyDcatManagedSelection(selection, { directory: project.directory,
          sourceRoot: resolve(fileURLToPath(new URL('../../../../', import.meta.url))) });
      }
      const web = await startCkanServer({ workbench: project, port: Number(options.port ?? 0) });
      let startup;
      try { startup = await saveWorkbenchStartup({ project, web,
        schema: 'stellar-forge.dcat-workbench-startup.v1',
        ...(options['startup-file'] !== undefined ? { file: resolve(required('startup-file')) } : {}),
        extra: { dcatRuntime: project.dcatRuntime() } }); }
      catch (error) { await web.close(); throw error; }
      process.stdout.write(JSON.stringify(startup) + '\n');
      served = true; let ending = false;
      const shutdown = async () => {
        if (ending) return; ending = true;
        await web.close(); await project.close();
      };
      process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
      return { project, ...web, shutdown };
    }
    let result;
    if (Object.hasOwn(semanticCliOptions, command)) result = await executeDcatSemanticCommand(project, command, options);
    else if (command === 'init' || command === 'status') result = project.status();
    else if (command === 'source') result = await project.dcatSource(required('source'));
    else if (command === 'save-source') {
      if ((options.source === undefined) !== (options['expected-source'] === undefined))
        throw fault('DCAT_COMMAND_ARGUMENTS', 'Update a source with both --source and --expected-source.');
      const value = { label: required('label'), url: required('url') };
      if (options.profile !== undefined) value.profile = options.profile;
      else if (options.source === undefined) value.profile = 'auto';
      if (options['token-env'] !== undefined)
        value.authTokenEnv = options['token-env'] === 'none' ? null : options['token-env'];
      if (options.source !== undefined) Object.assign(value, { id: required('source'), expectedSourceSha256: required('expected-source') });
      for (const [flag, field] of [['interval-minutes', 'intervalMinutes'], ['timeout-ms', 'timeoutMs'], ['max-bytes', 'maxResponseBytes']])
        if (options[flag] !== undefined) {
          const number = Number(options[flag]);
          if (!Number.isSafeInteger(number)) throw fault('DCAT_COMMAND_ARGUMENTS', 'Use an integer for --' + flag + '.');
          value[field] = number;
        }
      if (options.enabled !== undefined) {
        if (!['true', 'false'].includes(options.enabled)) throw fault('DCAT_COMMAND_ARGUMENTS', 'Use --enabled true or false.');
        value.enabled = options.enabled === 'true';
      }
      result = project.saveDcatSource(value);
    } else if (command === 'acquire') {
      const expected = required('expected-latest');
      if (options.unconditional !== undefined && !['true', 'false'].includes(options.unconditional))
        throw fault('DCAT_COMMAND_ARGUMENTS', 'Use --unconditional true or false.');
      result = project.acquireDcatSource({ sourceId: required('source'), expectedSourceSha256: required('expected-source'),
        expectedLatestCatalogId: expected === 'none' ? null : expected,
        ...(options.unconditional === undefined ? {} : { unconditional: options.unconditional === 'true' }),
        ...(options['retry-of'] ? { retryOf: options['retry-of'] } : {}) });
    } else if (command === 'acquire-due') {
      const sources = project.status().dcat?.sources ?? [], outcomes = [];
      const now = Date.now();
      for (const source of sources) {
        if (source.enabled === false || source.nextCheckAt && Date.parse(source.nextCheckAt) > now ||
            source.retryNotBefore && Date.parse(source.retryNotBefore) > now) continue;
        try {
          const operation = project.acquireDcatSource({ sourceId: source.id,
            expectedSourceSha256: source.sourceSha256,
            expectedLatestCatalogId: source.latestCatalogId ?? null, onlyIfDue: true });
          const completed = await operation.completion;
          outcomes.push({ sourceId: source.id, operation: completed });
          if (completed.state !== 'COMPLETE') process.exitCode = 1;
        } catch (error) {
          outcomes.push({ sourceId: source.id, error: { code: error.code ?? 'DCAT_ACQUIRE_FAILED', message: error.message } });
          process.exitCode = 1;
        }
      }
      result = { checkedAt: new Date(now).toISOString(), sources: outcomes };
    } else if (command === 'review-source') {
      let identityMappings;
      if (options.mappings) {
        identityMappings = parseCkanJson(await readFile(resolve(options.mappings)));
        if (!Array.isArray(identityMappings)) throw fault('DCAT_MAPPINGS_INVALID', 'The mappings file must contain a JSON array.');
      }
      if (options['normalize-v3'] !== undefined && !['true', 'false'].includes(options['normalize-v3']))
        throw fault('DCAT_COMMAND_ARGUMENTS', 'Use --normalize-v3 true or false.');
      let reuseMappingIndexes;
      if (options['reuse-mappings'] !== undefined) {
        reuseMappingIndexes = options['reuse-mappings'].split(',').map(value => {
          if (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value)))
            throw fault('DCAT_COMMAND_ARGUMENTS', 'Use comma-separated zero-based mapping indexes from the accepted baseline review.');
          return Number(value);
        });
        if (new Set(reuseMappingIndexes).size !== reuseMappingIndexes.length)
          throw fault('DCAT_COMMAND_ARGUMENTS', 'Select each baseline mapping index once.');
      }
      result = project.prepareDcatSourceReview({
        sourceId: required('source'), expectedSourceSha256: required('expected-source'),
        expectedLatestCatalogId: required('expected-latest'),
        baselineReleaseId: options['baseline-release'] ?? null,
        ...(options['baseline-release'] ? {
          expectedBaselineSha256: required('baseline-sha256'),
          expectedBaselineReviewSha256: required('baseline-review-sha256'),
        } : {}),
        ...(reuseMappingIndexes === undefined ? {} : { reuseMappingIndexes }),
        ...(options.candidate ? { candidateId: options.candidate } : {}),
        ...(identityMappings === undefined ? {} : { identityMappings }),
        ...(options.label ? { label: options.label } : {}),
        normalizeV3: options['normalize-v3'] === 'true',
      });
    } else if (command === 'import') result = project.importDcatCatalog({ file: resolve(required('file')),
      profile: options.profile ?? 'auto', label: options.label ?? 'Catalog edition', origin: options.origin,
      expectedSha256: options.sha256 });
    else if (command === 'review') {
      let mappings;
      if (options.mappings) {
        mappings = parseCkanJson(await readFile(resolve(options.mappings)));
        if (!Array.isArray(mappings)) throw fault('DCAT_MAPPINGS_INVALID', 'The mappings file must contain a JSON array.');
      }
      if (options['normalize-v3'] !== undefined && !['true', 'false'].includes(options['normalize-v3']))
        throw fault('DCAT_COMMAND_ARGUMENTS', 'Use --normalize-v3 true or false.');
      result = project.prepareDcatReview({ sourceId: required('source'), comparisonId: options.comparison,
        candidateId: options.candidate, identityMappings: mappings, label: options.label,
        normalizeV3: options['normalize-v3'] === 'true' });
    } else if (command === 'inspect') result = await project.dcatReview(required('review'));
    else if (command === 'cutover' || command === 'rollback') {
      const expected = required('expected-active'), input = {
        expectedActiveReleaseId: expected === 'none' ? null : expected, note: required('note'),
        expectedReviewSha256: options['review-sha256'], expectedCandidateSha256: options['candidate-sha256'],
      };
      result = command === 'cutover' ? project.cutoverDcat({ ...input, reviewId: required('review') }) :
        project.rollbackDcat({ ...input, releaseId: required('release') });
    } else if (command === 'export') {
      const kind = required('kind');
      let selected;
      if (['receipt', 'response'].includes(kind)) selected = await project.dcatAcquisitionDownload(required('acquisition'), kind);
      else if (kind === 'current') selected = await project.dcatCurrentDownload();
      else if (kind === 'original') selected = await project.dcatCatalogDownload(required('catalog'));
      else if (['candidate', 'report'].includes(kind)) selected = await project.dcatReviewDownload(required('review'), kind);
      else throw fault('DCAT_DOWNLOAD_KIND', 'Choose original, candidate, report, current, receipt or response.');
      const raw = await readPrivate(selected.file, selected.bytes);
      if (raw.length !== selected.bytes || digest(raw) !== selected.sha256) throw fault('DCAT_RETAINED_EDITION_CHANGED');
      const out = resolve(required('out')); await privateDirectory(dirname(out)); await createFile(out, raw);
      result = { kind, out, bytes: raw.length, sha256: selected.sha256, id: selected.id,
        ...(selected.releaseId ? { releaseId: selected.releaseId } : {}) };
    } else if (command === 'archive') result = project.archiveWorkspace({ out: resolve(required('out')) });
    if (result?.completion) {
      result = await result.completion; output(result);
      if (result.state !== 'COMPLETE') process.exitCode = 1;
    } else output(result);
  } finally { if (!served) await project.close(); }
}
if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href)
  main().catch(error => { process.stderr.write((error.code ?? 'DCAT_COMMAND_FAILED') + ': ' + error.message + '\n'); process.exitCode = 1; });
