// MIT. Document setup and service lifetime over the original managed paid Jobs owner.
import {realpath} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  canonical, digest, plain, compileJobMerchant
} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/config.mjs';
import {
  JOB_SERVICE_RUNTIME, normalizeJobServiceOptions, readServiceFile,
  readJobServiceSelection, assertJobServiceSelection
} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/managed/selection.mjs';
import {
  readJobServiceLaunch, jobServiceLaunchPath, JOB_SERVICE_LAUNCH_SCHEMA
} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/managed/launch.mjs';
import {
  openJobService, jobServiceAnnouncement
} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/managed/service.mjs';
import {compileJobIntake} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/intake/config.mjs';
import {compileDeliveryConfig} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/result-delivery/config.mjs';
import {absolute} from '../../stellar/scf-starforge-20261009/sf101-merchant-receiver/api-application/workspace/configuration.mjs';
import {documentError, requireDocument} from './contracts.mjs';
import {
  reviewDocumentMerchant, prepareDocumentMerchant
} from './setup.mjs';

export const DOCUMENT_SERVICE_SELECTION_SCHEMA = 'stellar-forge.document-service-selection.v1';
export const DOCUMENT_SERVICE_SOURCE = 'products/document-merchant';
export const DOCUMENT_SERVICE_SOURCE_FILES = Object.freeze([
  'commissioning.mjs','commissioning-facilitator.mjs','commissioning-cli.mjs','commissioning-application.mjs','application-provider.mjs',
  'assembly.mjs','assembly-archive.mjs','assembly-cli.mjs','assembly-workspace.mjs','composition-public/pdf-bundles.mjs','examples/ordered-pdfs.json','cli.mjs', 'launch.mjs', 'setup.mjs', 'contracts.mjs', 'renderer.mjs',
  'batch.mjs', 'batch-cli.mjs', 'batch-render.mjs', 'composition.mjs', 'composition-cli.mjs',
  'composition-service.mjs',
  'composition-workspace.mjs',
  'composition-server.mjs',
  'composition-browser-assets.json',
  'composition-public/index.html',
  'composition-public/app.mjs',
  'composition-public/style.css',
  'examples/report.html',
  'examples/report.md',
  'examples/composition/orders.json',
  'examples/composition/invoice.html',
  'examples/composition/greeting.html',
  'examples/composition/order-documents.json',
  'examples/composition/order-lines.csv',
  'examples/composition/grouped-order-documents.json',
  'examples/composition/reports.csv',
  'examples/composition/report.md',
  'examples/composition/report-documents.json'
]);
const ROOT = dirname(fileURLToPath(import.meta.url));
const JOB_FILES = Object.freeze([
  'cli.mjs', 'config.mjs', 'source-binding.mjs', 'model.mjs', 'store.mjs', 'merchant.mjs',
  'customer.mjs', 'execution.mjs', 'runner.mjs', 'workspace/server.mjs', 'workspace/identity.mjs',
  'managed/selection.mjs', 'managed/launch.mjs', 'managed/service.mjs',
  'intake/config.mjs', 'intake/service.mjs', 'result-delivery/config.mjs', 'result-delivery/dispatcher.mjs'
]);
const FIELDS = new Set([
  'directory', 'configurationFile', 'nativeFactoryPath', 'intakeConfigPath',
  'deliveryConfigPath', 'deliveryDirectory', 'sellerPort', 'customerPort',
  'operatorPort', 'operationsPort', 'startWorker', 'startDelivery', 'landing'
]);
const HASH = /^[a-f0-9]{64}$/;
const same = (left, right) => canonical(left) === canonical(right);
const json = bytes => {
  let result;
  try {result = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));}
  catch {throw documentError('DOCUMENT_SERVICE_JSON_REQUIRED', 'Use complete UTF-8 JSON for the selected service file.');}
  requireDocument(plain(result), 'DOCUMENT_SERVICE_JSON_REQUIRED');
  return result;
};

/** The document directory always selects its original generated Jobs configuration and state. */
export function normalizeDocumentServiceOptions(value = {}) {
  requireDocument(plain(value) && Object.keys(value).every(key => FIELDS.has(key)),
    'DOCUMENT_SERVICE_OPTIONS_REQUIRED', 'Select the document service options from its original contract.');
  const directory = absolute(value.directory);
  const configurationFile = value.configurationFile === undefined || value.configurationFile === null
    ? null : absolute(value.configurationFile);
  const native = normalizeJobServiceOptions({
    configPath: join(directory, 'jobs.json'), directory: join(directory, 'merchant-state'),
    ...Object.fromEntries(Object.entries(value).filter(([key]) => !['directory', 'configurationFile'].includes(key)))
  });
  return {directory, configurationFile, service: native};
}

export async function readDocumentServiceSources() {
  const files = [];
  requireDocument(await realpath(ROOT) === ROOT && await realpath(JOB_SERVICE_RUNTIME) === JOB_SERVICE_RUNTIME,
    'DOCUMENT_SERVICE_SOURCE_CHANGED', 'Use the selected installed document and original Jobs source.');
  for (const [root, names] of [[ROOT, DOCUMENT_SERVICE_SOURCE_FILES], [JOB_SERVICE_RUNTIME, JOB_FILES]]) {
    for (const name of names) files.push((await readServiceFile(join(root, name), 4194304)).pin);
  }
  return files;
}

/** Compare the installed command that was launched with the selected original document source. */
export async function assertDocumentServiceSource(launchSourceDirectory = ROOT) {
  launchSourceDirectory = absolute(launchSourceDirectory);
  requireDocument(await realpath(launchSourceDirectory) === launchSourceDirectory,
    'DOCUMENT_SERVICE_SOURCE_CHANGED', 'Use the physical original installed command source.');
  for (const name of DOCUMENT_SERVICE_SOURCE_FILES) {
    const selected = await readServiceFile(join(ROOT, name), 4194304);
    const launched = await readServiceFile(join(launchSourceDirectory, name), 4194304);
    requireDocument(selected.bytes.equals(launched.bytes), 'DOCUMENT_SERVICE_SOURCE_CHANGED',
      'The managed document command differs from the selected source: ' + name);
  }
  return {sourceDirectory: ROOT, launchSourceDirectory};
}

/**
 * Read the whole source, provider plan, native price and service choices without
 * opening a writer or consuming a supplier render. Its hash is stable across
 * first preparation because mutable setup state is not a service selection.
 */
export async function readDocumentServiceSelection(rawOptions = {}) {
  const normalized = normalizeDocumentServiceOptions(rawOptions);
  let configuration = null, input;
  if (normalized.configurationFile) {
    const original = await readServiceFile(normalized.configurationFile, 65536, {privateFile: true});
    configuration = original.pin;
    input = json(original.bytes);
  }
  const review = await reviewDocumentMerchant({directory: normalized.directory,
    ...(input === undefined ? {} : {request: input})});
  const compiled = compileJobMerchant(review.configuration, {baseDir: review.directory});
  const optionalFiles = [];
  let intake = compiled.intake, delivery = null;
  for (const [name, limit] of [
    ['nativeFactoryPath', 4194304], ['intakeConfigPath', 65536], ['deliveryConfigPath', 262144]
  ]) {
    const path = normalized.service[name];
    if (!path) continue;
    const selected = await readServiceFile(path, limit);
    optionalFiles.push(selected.pin);
    if (name === 'intakeConfigPath') intake = compileJobIntake(json(selected.bytes), compiled.functions);
    if (name === 'deliveryConfigPath') delivery = compileDeliveryConfig(json(selected.bytes));
  }
  const selected = {
    schema: DOCUMENT_SERVICE_SELECTION_SCHEMA, sourceDirectory: ROOT,
    runtimeDirectory: JOB_SERVICE_RUNTIME, directory: review.directory,
    configurationFile: configuration, options: normalized.service,
    setup: {
      input: review.input, inputSha256: review.inputSha256,
      jobsConfig: review.jobsConfig, merchantState: review.merchantState,
      providerConfig: review.providerConfig, customerSetup: review.customerSetup,
      files: review.files
    },
    sourceFiles: await readDocumentServiceSources(), optionalFiles,
    summary: {
      name: compiled.serviceName, publicOrigin: compiled.publicOrigin,
      provider: review.request.provider, formats: review.request.formats,
      nativePayments: normalized.service.nativeFactoryPath !== null,
      paymentPerDocument: structuredClone(review.request.payment), supplierPrice: review.supplierPrice,
      workerCount: compiled.workerCount, memoryLimitMb: compiled.memoryLimitMb,
      maxPending: compiled.maxPending, maxJobs: compiled.maxJobs,
      environmentReferences: [...new Set([
        ...compiled.environment, ...(intake.accessTokenEnvironment ? [intake.accessTokenEnvironment] : []),
        ...(delivery ? delivery.destinations.map(value => value.secretEnv) : [])
      ])].sort(),
      functions: Object.values(compiled.functions).map(value => ({
        id: value.id, path: value.path, description: value.description ?? '',
        payment: structuredClone(value.payment), inputFiles: structuredClone(value.inputFiles),
        output: structuredClone(value.output)
      })),
      intake: structuredClone(intake), delivery: delivery ? structuredClone(delivery) : null
    }
  };
  return {...selected, selectionSha256: digest(canonical(selected))};
}

export function assertDocumentServiceSelection(value, expectedSha256) {
  requireDocument(plain(value) && value.schema === DOCUMENT_SERVICE_SELECTION_SCHEMA &&
    HASH.test(value.selectionSha256 ?? '') &&
    (expectedSha256 === undefined || value.selectionSha256 === expectedSha256),
  'DOCUMENT_SERVICE_SELECTION_CHANGED', 'Review the current original document service selection.');
  const {selectionSha256, ...selected} = value;
  requireDocument(digest(canonical(selected)) === selectionSha256,
    'DOCUMENT_SERVICE_SELECTION_CHANGED', 'Keep the complete reviewed document service selection.');
  return value;
}

async function nativeSelection(selected) {
  const native = assertJobServiceSelection(await readJobServiceSelection(selected.options));
  const application = selected.setup.files.find(file => file.name === 'application.mjs');
  const configuration = selected.setup.files.find(file => file.name === 'jobs.json');
  requireDocument(native.directory === selected.setup.merchantState &&
    native.configPath === selected.setup.jobsConfig && native.runtimeDirectory === selected.runtimeDirectory &&
    native.source.applicationSha256 === application?.sha256 &&
    native.source.configSha256 === configuration?.sha256 &&
    native.startWorker === selected.options.startWorker && native.startDelivery === selected.options.startDelivery &&
    native.landing === selected.options.landing,
  'DOCUMENT_SERVICE_NATIVE_SELECTION_CHANGED', 'Open the original prepared document application and Jobs service.');
  for (const chosen of selected.optionalFiles) {
    requireDocument(native.files.some(file => file.path === chosen.path && file.bytes === chosen.bytes &&
      file.sha256 === chosen.sha256), 'DOCUMENT_SERVICE_NATIVE_SELECTION_CHANGED',
    'Use the same original factory, intake and destination files reviewed for this service.');
  }
  return native;
}

/**
 * Prepare or reopen the original setup, then acquire the existing Jobs lifetime.
 * Job state, settlement, worker shutdown, listeners and launch records remain
 * owned by openJobService. No additional service journal or job store is created.
 */
export async function openDocumentService(rawOptions, {
  env = process.env, signal, expectedSelection, launchSourceDirectory = ROOT, launchFile = null
} = {}) {
  if (signal !== undefined) requireDocument(signal instanceof AbortSignal, 'DOCUMENT_SERVICE_SIGNAL_INVALID');
  signal?.throwIfAborted();
  await assertDocumentServiceSource(launchSourceDirectory);
  const selected = assertDocumentServiceSelection(await readDocumentServiceSelection(rawOptions), expectedSelection);
  signal?.throwIfAborted();
  await prepareDocumentMerchant({directory: selected.directory, request: selected.setup.input});
  signal?.throwIfAborted();
  const current = assertDocumentServiceSelection(await readDocumentServiceSelection(rawOptions), selected.selectionSha256);
  const native = await nativeSelection(current);
  signal?.throwIfAborted();
  const service = await openJobService(current.options, {
    env, signal, expectedSelection: native.selectionSha256,
    expectedRuntime: current.runtimeDirectory, launchFile
  });
  return {...service, documentSelection: current};
}

/** Foreground original owner; signal handling begins before preparation. */
export async function runDocumentServiceCommand(rawOptions, {
  print = value => console.log(value), signal, expectedSelection,
  launchSourceDirectory = ROOT, launchFile = null
} = {}) {
  const stop = new AbortController();
  const selected = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
  const interrupt = () => stop.abort(documentError('DOCUMENT_SERVICE_STOPPED'));
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  let service;
  try {
    service = await openDocumentService(rawOptions, {
      signal: selected, expectedSelection, launchSourceDirectory, launchFile
    });
    selected.throwIfAborted();
    print(JSON.stringify(jobServiceAnnouncement(service.launch, launchFile)));
    return await service.closed;
  } catch (error) {
    if (selected.aborted && (error === selected.reason || error?.name === 'AbortError')) return;
    throw error;
  } finally {
    process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
    await service?.close();
  }
}

/** Read the same private managed launch and the authenticated original live Jobs workspace. */
export async function readDocumentServiceLaunch({options, file, expectedSelection, expected = {}, signal} = {}) {
  requireDocument(plain(expected) && Object.keys(expected).every(key => ['pid', 'instanceId'].includes(key)),
    'DOCUMENT_SERVICE_LAUNCH_EXPECTATION_INVALID');
  const selected = assertDocumentServiceSelection(await readDocumentServiceSelection(options), expectedSelection);
  const native = await nativeSelection(selected);
  file = absolute(file);
  requireDocument(file === jobServiceLaunchPath(dirname(file)), 'DOCUMENT_SERVICE_LAUNCH_PATH_INVALID');
  const launch = await readJobServiceLaunch({file, signal, expected: {
    directory: native.directory, configPath: native.configPath, runtimeDirectory: native.runtimeDirectory,
    source: native.source, selectionSha256: native.selectionSha256, ...expected
  }});
  requireDocument(launch.schema === JOB_SERVICE_LAUNCH_SCHEMA &&
    launch.landing === selected.options.landing &&
    same(launch.requestedPorts, native.ports),
  'DOCUMENT_SERVICE_LAUNCH_CHANGED', 'Reopen the current original document service.');
  return {documentSelection: selected, nativeSelection: native, launch};
}
