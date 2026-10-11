// MIT. Complete Tenderly customer lifecycle on the unchanged original SF88 Buyer.
import { readdir, lstat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { Buyer } from '../../../sf88-operator-buyer-cli/node/index.mjs';
import { absolute, digest, readBytes, readJson, parseJson, writeBytes, writeJson,
  privateDirectory, syncDirectory, exists, jsonBytes } from '../../../sf88-operator-buyer-cli/node/store.mjs';
import { REQUEST_SCHEMA, EXPORT_SCHEMA, MAX_RESULT_BYTES, plain, requireValue,
  expectedFromRequest, equalExpected, describeResult, analysisRequest } from './contract.mjs';
import { normalizeSelection } from './selection.mjs';

const BINDING_FILE = 'tenderly-request.json';
const EXPORT_FILES = ['response.json', 'request.json', 'buyer-result.json', 'request.body', 'simulation-request.json'];
const OPTIONAL_EXPORT_FILES = ['buyer-evidence.json'];
const EXPORT_INTENT = '.tenderly-export.json';
const resultLimit = value => {
  requireValue(Number.isSafeInteger(value) && value > 0 && value <= MAX_RESULT_BYTES,
    'TENDERLY_RESULT_LIMIT_INVALID');
  return value;
};

function networkSelection(networkId, expected) {
  const selected = networkId ?? expected?.networkId;
  requireValue(typeof selected === 'string' && /^[1-9][0-9]{0,19}$/.test(selected),
    'TENDERLY_EXPLICIT_NETWORK_SELECTION_REQUIRED');
  if (expected !== undefined) requireValue(selected === expected.networkId, 'TENDERLY_NETWORK_SELECTION_MISMATCH');
  return selected;
}

async function selectedMerchant(value, networkId, expected) {
  const selection = value === undefined ? null : normalizeSelection(typeof value === 'string'
    ? await readJson(absolute(value)) : value);
  const selected = networkSelection(selection?.networkId ?? networkId, expected);
  if (networkId !== undefined) requireValue(networkId === selected, 'TENDERLY_NETWORK_SELECTION_MISMATCH');
  return { networkId: selected, selection };
}

async function nativeRequest(operation, networkId) {
  const configBytes = await readBytes(operation.configPath, 65536), config = parseJson(configBytes);
  requireValue(config.operation?.intentId === operation.intentId && config.operation.method === 'POST' &&
    typeof config.operation.bodyFile === 'string', 'TENDERLY_ORIGINAL_POST_REQUIRED');
  const body = await readBytes(config.operation.bodyFile, 1048576);
  const expected = expectedFromRequest(parseJson(body), networkId);
  return { config, body, expected, configSha256: digest(configBytes), bodySha256: digest(body) };
}

export class TenderlyCustomer {
  constructor({ maxResultBytes = MAX_RESULT_BYTES, ...options }) {
    this.maxResultBytes = resultLimit(maxResultBytes);
    this.buyer = new Buyer(options);
  }
  operation(intentId) { return new TenderlyOperation(this, this.buyer.operation(intentId)); }

  async fromConfig(config, { expected, networkId, selection, ...options } = {}) {
    const selected = await selectedMerchant(selection, networkId, expected);
    const operation = await this.buyer.fromConfig(config, { ...options,
      responseFile: { ...options.responseFile, maxBytes: Math.min(this.maxResultBytes, selected.selection?.maxResponseBytes ?? this.maxResultBytes) } });
    return this._attach(operation, expected, selected);
  }
  async fromOperationHandoff(file, { expected, networkId, selection, ...options } = {}) {
    const selected = await selectedMerchant(selection, networkId, expected);
    const operation = await this.buyer.fromOperationHandoff(file, { ...options,
      responseFile: { ...options.responseFile, maxBytes: Math.min(this.maxResultBytes, selected.selection?.maxResponseBytes ?? this.maxResultBytes) } });
    return this._attach(operation, expected, selected);
  }
  async fromRequest(request, { expected, networkId, selection, ...options } = {}) {
    const selected = await selectedMerchant(selection, networkId, expected);
    const operation = await this.buyer.fromRequest(request, { ...options,
      responseFile: { ...options.responseFile, maxBytes: Math.min(this.maxResultBytes, selected.selection?.maxResponseBytes ?? this.maxResultBytes) } });
    return this._attach(operation, expected, selected);
  }
  /** Recover a prepared original operation whose customer-binding write was interrupted. */
  async attach(intentId, { expected, networkId, selection } = {}) {
    return this._attach(this.buyer.operation(intentId), expected, await selectedMerchant(selection, networkId, expected));
  }
  async _attach(operation, selectedExpected, selected) {
    const native = await nativeRequest(operation, selected.networkId);
    if (selectedExpected !== undefined) requireValue(equalExpected(selectedExpected, native.expected),
      'TENDERLY_EXPECTATION_REQUEST_MISMATCH');
    if (selected.selection) requireValue(native.config.operation.url === selected.selection.resource,
      'TENDERLY_MERCHANT_RESOURCE_MISMATCH');
    const record = { schema: REQUEST_SCHEMA, intentId: operation.intentId,
      configSha256: native.configSha256, bodySha256: native.bodySha256, expected: native.expected,
      ...(selected.selection ? { selection: selected.selection } : {}) };
    const path = join(operation.directory, BINDING_FILE);
    try { await writeJson(path, record, { exclusive: true }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      requireValue(isDeepStrictEqual(await readJson(path), record),
        'TENDERLY_EXISTING_BINDING_MISMATCH');
    }
    return new TenderlyOperation(this, operation);
  }
  async *list() {
    for await (const operation of this.buyer.list())
      if (await exists(join(operation.directory, BINDING_FILE)))
        yield new TenderlyOperation(this, operation);
  }
}

export class TenderlyOperation {
  constructor(customer, operation) {
    this.customer = customer;
    this.original = operation;
    this.intentId = operation.intentId;
    this.directory = operation.directory;
  }
  async _binding() {
    const binding = await readJson(join(this.directory, BINDING_FILE));
    const native = await nativeRequest(this.original, binding.expected?.networkId);
    requireValue(binding.schema === REQUEST_SCHEMA && binding.intentId === this.intentId &&
      binding.configSha256 === native.configSha256 && binding.bodySha256 === native.bodySha256 &&
      equalExpected(binding.expected, native.expected), 'TENDERLY_NATIVE_REQUEST_CHANGED');
    if (binding.selection) {
      const selection = normalizeSelection(binding.selection);
      requireValue(selection.networkId === binding.expected.networkId && selection.resource === native.config.operation.url,
        'TENDERLY_MERCHANT_SELECTION_CHANGED');
    }
    return { binding, native };
  }
  async review() {
    const { binding } = await this._binding();
    const reviewed = await this.original.review();
    requireValue(reviewed.configSha256 === binding.configSha256 && reviewed.bodySha256 === binding.bodySha256,
      'TENDERLY_NATIVE_REVIEW_MISMATCH');
    return { ...reviewed, tenderly: binding.expected };
  }
  async execute({ review, signal } = {}) {
    const { binding } = await this._binding();
    requireValue(review?.tenderly && equalExpected(review.tenderly, binding.expected),
      'TENDERLY_MATCHING_REVIEW_REQUIRED');
    const result = await this.original.execute({ review, signal });
    return this._result(result, binding);
  }
  async _result(result, binding) {
    return new TenderlyResult(this, result, binding, this.customer.maxResultBytes);
  }
  async recover() {
    const { binding } = await this._binding();
    const result = await this.original.recover();
    return result === null ? null : this._result(result, binding);
  }
  async inspect() {
    const { binding } = await this._binding();
    return { ...await this.original.inspect(), expected: binding.expected };
  }
}

export class TenderlyResult {
  constructor(operation, original, binding, limit) {
    this.operation = operation;
    this.original = original;
    this.binding = structuredClone(binding);
    this.limit = limit;
  }
  get native() { return this.original.native; }
  get record() { return this.original.record; }
  get delivery() { return this.original.delivery; }
  get status() { return this.original.status; }
  analysisRequest() { return analysisRequest(this.binding.expected); }
  async json() {
    const value = await this.original.json({ limit: this.limit });
    describeResult(value, this.binding.expected);
    return value;
  }
  async summary() { return describeResult(await this.json(), this.binding.expected); }
  /** Feed this same completed native result into the maintained analysis workspace. */
  async analyze({ workspace, label = '' } = {}) {
    await this.json();
    const { receiveBuyerResult } = await import('../../../sf88-operator-buyer-cli/tenderly-analysis/library.mjs');
    return receiveBuyerResult(this.original, {
      workspace: absolute(workspace), request: this.analysisRequest(), label,
    });
  }
  async saveAs(destination, options) {
    await this.json();
    return this.original.saveAs(absolute(destination), options);
  }
  /** Exact response + exact request + unchanged native result, with a final immutable manifest. */
  async export(directory, { signal } = {}) {
    directory = absolute(directory);
    await privateDirectory(dirname(directory));
    const { binding, native } = await this.operation._binding();
    requireValue(isDeepStrictEqual(binding, this.binding), 'TENDERLY_RESULT_BINDING_CHANGED');
    const simulation = await this.summary();
    if (await exists(join(directory, 'manifest.json'))) {
      const saved = await openExport(directory, { maxResultBytes: this.limit });
      requireValue(saved.request.intentId === binding.intentId && saved.request.configSha256 === binding.configSha256 &&
        saved.request.bodySha256 === binding.bodySha256 && saved.manifest.files['response.json'].sha256 === this.delivery.sha256,
        'TENDERLY_EXPORT_DESTINATION_CONFLICT');
      return { directory, manifest: saved.manifest, resumed: true };
    }
    await privateDirectory(directory);
    const marker = { schema: 'stellar-forge.tenderly-customer-export-intent.v1', intentId: binding.intentId,
      configSha256: binding.configSha256, bodySha256: binding.bodySha256,
      responseSha256: this.delivery.sha256, nativeSha256: digest(jsonBytes(this.native)) };
    if (!await exists(join(directory, EXPORT_INTENT)))
      requireValue((await readdir(directory)).length === 0, 'TENDERLY_EXPORT_DESTINATION_CONFLICT');
    await exactFile(join(directory, EXPORT_INTENT), jsonBytes(marker));
    const responsePath = join(directory, 'response.json');
    if (!await exists(responsePath)) {
      try { await this.original.saveAs(responsePath, { signal }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    const response = await readBytes(responsePath, this.limit);
    requireValue(response.length === this.delivery.bytes && digest(response) === this.delivery.sha256,
      'TENDERLY_EXPORT_SOURCE_CHANGED');
    await exactFile(join(directory, 'request.body'), native.body);
    await exactFile(join(directory, 'request.json'), jsonBytes(binding));
    await exactFile(join(directory, 'simulation-request.json'), jsonBytes(this.analysisRequest()));
    // Preserve the first complete native record when recovery changes only process-recording metadata.
    const recordPath = join(directory, 'buyer-result.json');
    if (await exists(recordPath)) {
      const saved = await readJson(recordPath, 4 * 1024 * 1024);
      requireValue(saved.intentId === this.record.intentId && saved.configSha256 === this.record.configSha256 &&
        isDeepStrictEqual(saved.native, this.native), 'TENDERLY_EXPORT_NATIVE_RESULT_CHANGED');
    } else await exactFile(recordPath, jsonBytes(this.record));
    const names = [...EXPORT_FILES];
    const evidencePath = this.native.evidencePath;
    if (typeof evidencePath === 'string' && typeof native.config.evidenceDir === 'string') {
      const child = relative(absolute(native.config.evidenceDir), absolute(evidencePath));
      requireValue(child !== '' && child !== '..' && !child.startsWith('../') && !child.startsWith('/'),
        'TENDERLY_EVIDENCE_OUTSIDE_ORIGINAL_OPERATION');
      if (await exists(evidencePath)) {
        await exactFile(join(directory, 'buyer-evidence.json'), await readBytes(evidencePath, 4 * 1024 * 1024));
        names.push('buyer-evidence.json');
      }
    }
    if (await exists(join(directory, 'buyer-evidence.json')) && !names.includes('buyer-evidence.json'))
      names.push('buyer-evidence.json');
    const files = {};
    for (const name of names) {
      const bytes = await readBytes(join(directory, name), name === 'response.json' ? this.limit : 4 * 1024 * 1024);
      files[name] = { bytes: bytes.length, sha256: digest(bytes) };
    }
    const manifest = { schema: EXPORT_SCHEMA, intentId: binding.intentId,
      expected: binding.expected, simulation, files };
    await exactFile(join(directory, 'manifest.json'), jsonBytes(manifest));
    await syncDirectory(directory);
    return { directory, manifest, resumed: false };
  }
}

async function exactFile(path, bytes) {
  try { await writeBytes(path, bytes, { exclusive: true }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = await readBytes(path, bytes.length);
    requireValue(existing.equals(bytes), 'TENDERLY_EXPORT_EXISTING_FILE_CHANGED');
  }
}

/** Open a portable completed customer export. No runtime, signer or network is used. */
export async function openExport(directory, { maxResultBytes = MAX_RESULT_BYTES } = {}) {
  directory = absolute(directory);
  resultLimit(maxResultBytes);
  const info = await lstat(directory);
  requireValue(info.isDirectory() && !info.isSymbolicLink(), 'TENDERLY_EXPORT_DIRECTORY_REQUIRED');
  const manifest = await readJson(join(directory, 'manifest.json'), 65536);
  requireValue(manifest.schema === EXPORT_SCHEMA && plain(manifest.files) &&
    EXPORT_FILES.every(name => Object.hasOwn(manifest.files, name)) &&
    Object.keys(manifest.files).every(name => [...EXPORT_FILES, ...OPTIONAL_EXPORT_FILES].includes(name)),
    'TENDERLY_EXPORT_MANIFEST_INVALID');
  const bytes = {};
  for (const name of Object.keys(manifest.files)) {
    const metadata = manifest.files[name];
    requireValue(plain(metadata) && Number.isSafeInteger(metadata.bytes) && metadata.bytes >= 0 &&
      /^[a-f0-9]{64}$/.test(metadata.sha256), 'TENDERLY_EXPORT_FILE_METADATA_INVALID');
    bytes[name] = await readBytes(join(directory, name), name === 'response.json' ? maxResultBytes : 4 * 1024 * 1024);
    requireValue(bytes[name].length === metadata.bytes && digest(bytes[name]) === metadata.sha256,
      'TENDERLY_EXPORT_FILE_CHANGED');
  }
  const request = parseJson(bytes['request.json']), record = parseJson(bytes['buyer-result.json']);
  requireValue(request.schema === REQUEST_SCHEMA && request.intentId === manifest.intentId &&
    request.bodySha256 === digest(bytes['request.body']) &&
    equalExpected(request.expected, manifest.expected) &&
    equalExpected(expectedFromRequest(parseJson(bytes['request.body']), request.expected.networkId), request.expected) &&
    isDeepStrictEqual(parseJson(bytes['simulation-request.json']), analysisRequest(request.expected)),
    'TENDERLY_EXPORT_REQUEST_MISMATCH');
  if (request.selection) {
    const selected = normalizeSelection(request.selection);
    requireValue(selected.networkId === request.expected.networkId, 'TENDERLY_EXPORT_SELECTION_MISMATCH');
  }
  const native = record.native;
  requireValue(plain(native) && record.intentId === manifest.intentId && native.intentId === manifest.intentId &&
    record.configSha256 === request.configSha256 &&
    native.responseFile?.status === 'SAVED' && native.responseFile.sha256 === manifest.files['response.json'].sha256 &&
    native.responseFile.bytes === manifest.files['response.json'].bytes,
    'TENDERLY_EXPORT_NATIVE_RESULT_MISMATCH');
  const envelope = parseJson(bytes['response.json']);
  const simulation = describeResult(envelope, request.expected);
  requireValue(isDeepStrictEqual(simulation, manifest.simulation), 'TENDERLY_EXPORT_SIMULATION_MISMATCH');
  const evidence = bytes['buyer-evidence.json'] ? parseJson(bytes['buyer-evidence.json']) : null;
  return { directory, manifest, request, record, envelope, simulation, evidence,
    analysisRequest: parseJson(bytes['simulation-request.json']) };
}
