// MIT. Review the original merchant's source and service choices without opening its writer.
import { constants } from 'node:fs';
import { open, lstat, realpath } from 'node:fs/promises';
import { resolve, isAbsolute, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJobMerchantSource } from '../source-binding.mjs';
import { canonical, digest, plain, jobError } from '../config.mjs';
import { compileJobIntake } from '../intake/config.mjs';
import { compileDeliveryConfig } from '../result-delivery/config.mjs';

export const JOB_SERVICE_SELECTION_SCHEMA = 'stellar-forge.job-service-selection.v1';
export const JOB_SERVICE_LANDINGS = Object.freeze(['jobs', 'inputs', 'resolutions', 'deliveries']);
export const JOB_SERVICE_RUNTIME = resolve(fileURLToPath(new URL('../', import.meta.url)));
const MAX_CONFIG = 1048576, MAX_MODULE = 4194304;
const fail = (code, status = 400) => { throw jobError(code, status); };
const same = (a, b) => canonical(a) === canonical(b);
const own = info => process.getuid === undefined || info.uid === process.getuid();

export function serviceAbsolute(value) {
  if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value ||
      value === '/' || /[\x00-\x1f\x7f]/.test(value)) fail('JOB_SERVICE_ABSOLUTE_PATH_REQUIRED');
  return value;
}
function port(value) {
  value ??= 0;
  if (!Number.isInteger(value) || value < 0 || value > 65535) fail('JOB_SERVICE_PORT_INVALID');
  return value;
}
function flag(value) {
  if (value !== undefined && typeof value !== 'boolean') fail('JOB_SERVICE_BOOLEAN_REQUIRED');
  return value === true;
}
export function normalizeJobServiceOptions(input = {}) {
  if (!plain(input)) fail('JOB_SERVICE_OPTIONS_REQUIRED');
  const allowed = new Set(['configPath', 'directory', 'nativeFactoryPath', 'intakeConfigPath',
    'deliveryConfigPath', 'deliveryDirectory', 'sellerPort', 'customerPort', 'operatorPort',
    'operationsPort', 'startWorker', 'startDelivery', 'landing']);
  if (Object.keys(input).some(key => !allowed.has(key))) fail('JOB_SERVICE_OPTION_UNKNOWN');
  const result = {
    configPath: serviceAbsolute(resolveRequired(input.configPath)),
    directory: serviceAbsolute(resolveRequired(input.directory)),
    nativeFactoryPath: optionalPath(input.nativeFactoryPath),
    intakeConfigPath: optionalPath(input.intakeConfigPath),
    deliveryConfigPath: optionalPath(input.deliveryConfigPath),
    deliveryDirectory: optionalPath(input.deliveryDirectory),
    sellerPort: port(input.sellerPort), customerPort: port(input.customerPort),
    operatorPort: port(input.operatorPort), operationsPort: port(input.operationsPort),
    startWorker: flag(input.startWorker), startDelivery: flag(input.startDelivery),
    landing: input.landing ?? 'jobs',
  };
  if (!JOB_SERVICE_LANDINGS.includes(result.landing)) fail('JOB_SERVICE_LANDING_INVALID');
  if (!result.deliveryConfigPath && (result.startDelivery || result.deliveryDirectory || result.landing === 'deliveries'))
    fail('JOB_SERVICE_DELIVERY_CONFIG_REQUIRED');
  const ports = [result.sellerPort, result.customerPort, result.operatorPort, result.operationsPort].filter(Boolean);
  if (new Set(ports).size !== ports.length) fail('JOB_SERVICE_PORTS_MUST_DIFFER');
  if (result.nativeFactoryPath && !result.nativeFactoryPath.endsWith('.mjs'))
    fail('JOB_SERVICE_NATIVE_FACTORY_MODULE_REQUIRED');
  if (result.deliveryDirectory && [result.directory, join(result.directory, 'outbox'),
      join(result.directory, 'records'), join(result.directory, 'results'),
      join(result.directory, 'input-files')].includes(result.deliveryDirectory))
    fail('JOB_SERVICE_DELIVERY_DIRECTORY_CONFLICT');
  return result;
}
function optionalPath(value) {
  return value === undefined || value === null ? null : serviceAbsolute(resolveRequired(value));
}
function resolveRequired(value) {
  if (typeof value !== 'string' || !value || /[\x00-\x1f\x7f]/.test(value))
    fail('JOB_SERVICE_PATH_REQUIRED');
  return resolve(value);
}
async function directory(path, missing = false) {
  let info;
  try { info = await lstat(path); } catch (error) { if (missing && error.code === 'ENOENT') return false; throw error; }
  if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o077 || !own(info) ||
      await realpath(path) !== path) fail('JOB_SERVICE_PRIVATE_DIRECTORY_REQUIRED');
  return true;
}
export async function readServiceFile(path, maximum, { privateFile = false } = {}) {
  serviceAbsolute(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maximum ||
        privateFile && (before.nlink !== 1 || before.mode & 0o077 || !own(before))) fail('JOB_SERVICE_FILE_INVALID');
    const bytes = await handle.readFile(), after = await handle.stat(), named = await lstat(path);
    if (bytes.length > maximum || bytes.length !== before.size ||
        [after, named].some(value => value.dev !== before.dev || value.ino !== before.ino ||
          value.size !== before.size || value.mtimeMs !== before.mtimeMs || value.ctimeMs !== before.ctimeMs ||
          value.mode !== before.mode || value.nlink !== before.nlink) ||
        named.isSymbolicLink() || await realpath(path) !== path) fail('JOB_SERVICE_FILE_CHANGED', 409);
    return { bytes, pin: { path, bytes: bytes.length, sha256: digest(bytes) } };
  } finally { await handle.close(); }
}
function json(bytes) {
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('JOB_SERVICE_JSON_INVALID'); }
  if (!plain(value)) fail('JOB_SERVICE_JSON_OBJECT_REQUIRED');
  return value;
}
async function optionalFile(path, maximum, options) {
  try { return await readServiceFile(path, maximum, options); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function retainedSource(directoryPath, source) {
  const retained = await optionalFile(join(directoryPath, 'source.json'), 2097152, { privateFile: true });
  if (!retained) return;
  const value = json(retained.bytes);
  if (value.schema !== 'stellar-forge.job-merchant-state.v1' || !same(value.source, source.identity))
    fail('JOB_MERCHANT_SOURCE_CHANGED', 409);
  for (const [name, expected, limit] of [
    ['config-source.json', source.identity.configSha256, MAX_CONFIG],
    ['application-source.mjs', source.identity.applicationSha256, MAX_MODULE],
  ]) {
    // The original store can complete a first initialization whose snapshot write was interrupted.
    const saved = await optionalFile(join(directoryPath, name), limit, { privateFile: true });
    if (saved && saved.pin.sha256 !== expected) fail('JOB_SOURCE_SNAPSHOT_CHANGED', 409);
  }
}

/** Uses the same SF101 physical source binding and original configuration compilers as jobs serve. */
export async function readJobServiceSelection(rawOptions = {}) {
  const options = normalizeJobServiceOptions(rawOptions);
  options.configPath = await realpath(options.configPath);
  if (options.nativeFactoryPath) options.nativeFactoryPath = await realpath(options.nativeFactoryPath);
  if (options.intakeConfigPath) options.intakeConfigPath = await realpath(options.intakeConfigPath);
  if (options.deliveryConfigPath) options.deliveryConfigPath = await realpath(options.deliveryConfigPath);
  await directory(options.directory, true);
  if (options.deliveryDirectory) await directory(options.deliveryDirectory, true);
  const source = await readJobMerchantSource({ configPath: options.configPath, directory: options.directory });
  const files = [];
  const configuration = await readServiceFile(source.configPath, MAX_CONFIG);
  const application = await readServiceFile(source.applicationPath, MAX_MODULE);
  if (configuration.pin.sha256 !== source.identity.configSha256 ||
      application.pin.sha256 !== source.identity.applicationSha256) fail('JOB_MERCHANT_SOURCE_CHANGED', 409);
  files.push(configuration.pin, application.pin);
  if (source.sourceBinding) {
    const binding = await readServiceFile(source.sourceBinding.file, 65536, { privateFile: true });
    if (binding.pin.sha256 !== source.sourceBinding.sha256) fail('JOB_SOURCE_BINDING_CHANGED', 409);
    files.push(binding.pin);
  }
  await retainedSource(options.directory, source);
  let nativeFactory = null, intakeFile = null, deliveryFile = null, delivery = null;
  let intake = source.compiled.intake;
  if (options.nativeFactoryPath) {
    nativeFactory = (await readServiceFile(options.nativeFactoryPath, MAX_MODULE)).pin;
    files.push(nativeFactory);
  }
  if (options.intakeConfigPath) {
    const original = await readServiceFile(options.intakeConfigPath, 65536);
    intake = compileJobIntake(json(original.bytes), source.compiled.functions);
    intakeFile = original.pin; files.push(intakeFile);
  }
  if (options.deliveryConfigPath) {
    const original = await readServiceFile(options.deliveryConfigPath, 262144);
    delivery = compileDeliveryConfig(json(original.bytes)); deliveryFile = original.pin;
    files.push(deliveryFile);
  }
  const runtimeDirectory = await realpath(JOB_SERVICE_RUNTIME);
  const selected = {
    schema: JOB_SERVICE_SELECTION_SCHEMA, runtimeDirectory,
    directory: options.directory, configPath: source.configPath,
    source: structuredClone(source.identity), applicationPath: source.applicationPath,
    sourceBinding: source.sourceBinding ? structuredClone(source.sourceBinding) : null,
    nativeFactory, intake: { configuration: structuredClone(intake), file: intakeFile },
    delivery: delivery ? {
      configuration: structuredClone(delivery), file: deliveryFile,
      directory: options.deliveryDirectory ?? join(options.directory, 'result-delivery'),
    } : null,
    ports: { seller: options.sellerPort, customer: options.customerPort,
      operator: options.operatorPort, operations: options.operationsPort },
    startWorker: options.startWorker, startDelivery: options.startDelivery, landing: options.landing,
    files: [...new Map(files.map(file => [file.path, file])).values()],
    summary: {
      name: source.compiled.serviceName, publicOrigin: source.compiled.publicOrigin,
      nativePayments: nativeFactory !== null,
      workerCount: source.compiled.workerCount, memoryLimitMb: source.compiled.memoryLimitMb,
      maxPending: source.compiled.maxPending, maxJobs: source.compiled.maxJobs,
      environmentReferences: [...new Set([...source.compiled.environment,
        ...(intake.accessTokenEnvironment ? [intake.accessTokenEnvironment] : []),
        ...(delivery ? delivery.destinations.map(value => value.secretEnv) : [])])].sort(),
      functions: Object.values(source.compiled.functions).map(value => ({
        id: value.id, path: value.path, description: value.description ?? '', payment: structuredClone(value.payment),
        timeoutMs: value.timeoutMs, maxInputBytes: value.maxInputBytes, maxOutputBytes: value.maxOutputBytes,
        output: structuredClone(value.output), inputFiles: value.inputFiles ? structuredClone(value.inputFiles) : null,
      })),
    },
  };
  return { ...selected, selectionSha256: digest(canonical(selected)) };
}
export function assertJobServiceSelection(value, expectedSha256) {
  if (!plain(value) || value.schema !== JOB_SERVICE_SELECTION_SCHEMA ||
      !/^[a-f0-9]{64}$/.test(value.selectionSha256 ?? '') ||
      expectedSha256 !== undefined && value.selectionSha256 !== expectedSha256)
    fail('JOB_SERVICE_SELECTION_CHANGED', 409);
  const { selectionSha256, ...selected } = value;
  if (digest(canonical(selected)) !== selectionSha256) fail('JOB_SERVICE_SELECTION_CHANGED', 409);
  return value;
}
