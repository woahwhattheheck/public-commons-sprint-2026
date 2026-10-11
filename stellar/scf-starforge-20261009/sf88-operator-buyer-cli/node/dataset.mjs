// MIT — Node application access to the original SF88 acquisition and SF100 outputs.
import { mkdtemp, readdir, rm, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VerifiedFile } from './result.mjs';
import { absolute, privateDirectory, digest, now, intent, object, need, BuyerError,
  readJson, writeJson, exists, jsonBytes, syncDirectory } from './store.mjs';

const SCHEMA = 'stellar-forge.node-dataset.v1';
const WORKER = fileURLToPath(new URL('./dataset-worker.mjs', import.meta.url));
const OUTPUTS = new Set(['dataset.jsonl','dataset.csv','review.html','manifest.json']);
const MAX_OUTPUT = 256 * 1024 * 1024;
const clone = value => JSON.parse(jsonBytes(value));
const freeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

export class Dataset {
  constructor(buyer, id) {
    this.buyer = buyer;
    this.id = intent(id);
    this.directory = join(buyer.stateDirectory, 'datasets', digest(this.id));
  }
  async _metadata() {
    await privateDirectory(this.directory, {create:false});
    const metadata = await readJson(join(this.directory, 'dataset.json'));
    need(metadata.schema === SCHEMA && metadata.id === this.id &&
      metadata.entryDirectory === this.directory && object(metadata.source), 'DATASET_APPLICATION_STATE_INVALID');
    absolute(metadata.sessionDirectory);
    return metadata;
  }
  async _command(command, request = {}, {signal} = {}) {
    await this._metadata();
    const jobs = await privateDirectory(join(this.directory, 'commands'));
    const directory = await mkdtemp(join(jobs, command + '-'));
    const requestPath = join(directory, 'request.json'), resultFile = join(directory, 'result.json');
    await writeJson(requestPath, {...request, reportLimit:this.buyer.datasetReportLimit}, {exclusive:true});
    const run = await this.buyer.runtime.run(
      [this.buyer.runtime.directory, this.directory, command, requestPath, resultFile],
      {directory, signal, entryFile:WORKER, resultFile, resultLimit:this.buyer.datasetReportLimit});
    const output = run.output;
    if (!output || output.schema !== 'stellar-forge.node-dataset-command.v1' ||
      output.id !== this.id || output.command !== command || !object(output.result)) {
      throw new BuyerError(run.errorCode ?? 'DATASET_NATIVE_RESULT_UNAVAILABLE',
        {dataset:this, exitCode:run.exitCode, commandDirectory:directory});
    }
    const process = {exitCode:run.exitCode, exitSignal:run.exitSignal, errorCode:run.errorCode};
    // The original native session is the recovery authority. Keep only the latest
    // complete command receipt; a failed/uncertain command retains its private logs.
    await writeJson(join(this.directory, 'last-command.json'), {command, completedAt:now(), process,
      result:output.result});
    if (run.exitCode === 0 && !run.errorCode) await rm(directory, {recursive:true, force:true});
    return {native:freeze(output.result), process:freeze(process)};
  }
  /** Offline initialization can be repeated after a lost creation response. */
  async initialize(options) {
    const metadata = await this._metadata();
    return this._command(metadata.source.kind === 'attached' ? 'attach' : 'initialize', {}, options);
  }
  inspect(options) { return this._command('inspect', {}, options); }
  /** Original recovery only reads native files and removes a proven-dead native lock. */
  recover(options) { return this._command('recover', {}, options); }
  /** Only this method can acquire new pages. Completed/marked pages are never replayed. */
  run(options) { return this._command('run', {}, options); }
  async exportManifest(destination, options) {
    return this._command('manifest', {destination:absolute(destination)}, options);
  }
  /** Builds or reopens the original SF100 data room, entirely offline. */
  async deliver(destination = join(this.directory, 'delivery'), options) {
    const result = await this._command('deliver', {destination:absolute(destination)}, options);
    need(result.process.exitCode === 0 && !result.process.errorCode,
      result.process.errorCode ?? 'DATASET_DELIVERY_NOT_COMPLETE');
    return DatasetDelivery.open(result.native);
  }
}

export async function createDataset(buyer, options, attached = false) {
  need(object(options), 'DATASET_OPTIONS_REQUIRED');
  const {id, config, workspaceDirectory, directory, operatorProfile,
    maxPages, maxTotalAtomic, maxRows = 1000000, maxPageBytes = 1048576, expectedSnapshot = null} = options;
  const dataset = new Dataset(buyer, id);
  await buyer.ready();
  await privateDirectory(join(buyer.stateDirectory, 'datasets'));
  const metadata = {schema:SCHEMA, id:dataset.id, entryDirectory:dataset.directory,
    sessionDirectory:attached ? absolute(directory) : join(dataset.directory, 'session'),
    createdAt:now(), source:attached ? {kind:'attached'} : workspaceDirectory !== undefined
      ? {kind:'workspace', directory:absolute(workspaceDirectory)} : {kind:'config'}};
  let input;
  if (!attached) {
    need((config !== undefined) !== (workspaceDirectory !== undefined), 'DATASET_ONE_CONFIG_SOURCE_REQUIRED');
    if (workspaceDirectory !== undefined) need(operatorProfile === undefined, 'DATASET_WORKSPACE_PROFILE_UNSUPPORTED');
    metadata.limits = {maxPages,maxTotalAtomic,maxRows,maxPageBytes};
    metadata.expectedSnapshot = expectedSnapshot;
    // Reject non-JSON values before allocating a named application entry.
    jsonBytes(metadata);
    if (config !== undefined) input = await buyer._profile(typeof config === 'string'
      ? await readJson(absolute(config)) : clone(config), operatorProfile);
  }
  if (await exists(dataset.directory)) throw new BuyerError('DATASET_ALREADY_EXISTS_USE_OPEN', {dataset});
  const parent = join(buyer.stateDirectory, 'datasets');
  // Publish a complete entry once. A crash while writing the private stage cannot
  // reserve the stable name or make listDatasets encounter half-written metadata.
  const stage = await mkdtemp(join(parent, '.dataset-stage-'));
  if (input) await writeJson(join(stage, 'config.json'), input, {exclusive:true});
  await writeJson(join(stage, 'dataset.json'), metadata, {exclusive:true});
  await syncDirectory(stage);
  try { await rename(stage, dataset.directory); }
  catch (error) {
    // A concurrently published entry is nonempty and cannot be replaced by rename.
    if (['EEXIST','ENOTEMPTY'].includes(error.code))
      throw new BuyerError('DATASET_ALREADY_EXISTS_USE_OPEN', {dataset, stagingDirectory:stage});
    throw error;
  }
  await syncDirectory(parent);
  await dataset.initialize();
  return dataset;
}

export async function* listDatasets(buyer) {
  await buyer.ready();
  const directory = join(buyer.stateDirectory, 'datasets');
  if (!await exists(directory)) return;
  await privateDirectory(directory, {create:false});
  for (const entry of await readdir(directory, {withFileTypes:true})) {
    if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
    const metadata = await readJson(join(directory, entry.name, 'dataset.json'));
    need(metadata.schema === SCHEMA && digest(intent(metadata.id)) === entry.name,
      'DATASET_APPLICATION_STATE_INVALID');
    yield new Dataset(buyer, metadata.id);
  }
}

/** A file from an original, verified SF100 export. No native purchase summary is fabricated. */
export class DatasetFile extends VerifiedFile {
  constructor(metadata, directory) {
    super();
    this.metadata = freeze(clone(metadata));
    this.directory = absolute(directory);
  }
  _metadata() {
    const saved = this.metadata;
    need(object(saved) && OUTPUTS.has(saved.name) && saved.path === join(this.directory, saved.name) &&
      Number.isSafeInteger(saved.bytes) && saved.bytes >= 0 && saved.bytes <= MAX_OUTPUT &&
      typeof saved.sha256 === 'string' && /^[a-f0-9]{64}$/.test(saved.sha256),
    'DATASET_OUTPUT_METADATA_INVALID');
    return saved;
  }
}

export class DatasetDelivery {
  constructor(report, manifest) {
    this.report = freeze(clone(report));
    this.manifest = freeze(clone(manifest));
  }
  static async open(report) {
    need(report?.schema === 'stellar-forge.sf88.dataset-delivery.v1' &&
      report.nativeStatus?.finalized === true && object(report.outputs), 'DATASET_NATIVE_DELIVERY_INVALID');
    const file = new DatasetFile({name:'manifest.json', ...report.outputs['manifest.json']}, report.directory);
    const manifest = await file.json({limit:4 * 1024 * 1024});
    need(manifest?.schema === 'stellar-forge.buyer-delivery-manifest.v1' &&
      manifest.dataset?.snapshot === report.nativeStatus.snapshot &&
      manifest.dataset.rows === report.nativeStatus.rows && Array.isArray(manifest.dataset.projectedFields) &&
      object(manifest.outputs), 'DATASET_NATIVE_MANIFEST_INVALID');
    for (const name of ['dataset.jsonl','dataset.csv','review.html'])
      need(manifest.outputs[name]?.sha256 === report.outputs[name]?.sha256 &&
        manifest.outputs[name]?.bytes === report.outputs[name]?.bytes, 'DATASET_OUTPUT_METADATA_INVALID');
    return new DatasetDelivery(report, manifest);
  }
  file(name) {
    need(OUTPUTS.has(name), 'DATASET_OUTPUT_NAME_INVALID');
    return new DatasetFile({name, ...this.report.outputs[name]}, this.report.directory);
  }
  _row(text) {
    let value;
    try { value = JSON.parse(text); } catch { throw new BuyerError('DATASET_ROW_JSON_INVALID'); }
    const fields = this.manifest.dataset.projectedFields;
    need(object(value) && Object.keys(value).length === fields.length && fields.every(field =>
      Object.hasOwn(value, field) && (value[field] === null || ['string','number','boolean'].includes(typeof value[field]))),
    'DATASET_ROW_SHAPE_INVALID');
    return value;
  }
  /** Values retain the original SF100 JSON scalar types; no numeric/date coercion. */
  async *rows({signal, maxRowCharacters = 16777216} = {}) {
    need(Number.isSafeInteger(maxRowCharacters) && maxRowCharacters > 0 && maxRowCharacters <= MAX_OUTPUT,
      'DATASET_ROW_LIMIT_INVALID');
    const decoder = new TextDecoder('utf-8', {fatal:true});
    let pending = '', count = 0;
    for await (const chunk of this.file('dataset.jsonl').chunks({signal})) {
      pending += decoder.decode(chunk, {stream:true});
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        need(newline <= maxRowCharacters, 'DATASET_ROW_LIMIT');
        const text = pending.slice(0, newline); pending = pending.slice(newline + 1);
        need(text.length > 0, 'DATASET_EMPTY_ROW');
        need(++count <= this.manifest.dataset.rows, 'DATASET_ROW_COUNT_CHANGED');
        yield this._row(text);
      }
      need(pending.length <= maxRowCharacters, 'DATASET_ROW_LIMIT');
    }
    pending += decoder.decode();
    if (pending) { count++; yield this._row(pending); }
    need(count === this.manifest.dataset.rows, 'DATASET_ROW_COUNT_CHANGED');
  }
  /** Returns only after the entire output has passed its saved size/hash check. */
  async readRows({limit = 8388608, maxRows = 100000, signal} = {}) {
    need(Number.isSafeInteger(maxRows) && maxRows >= 0 && this.manifest.dataset.rows <= maxRows,
      'DATASET_ROW_LIMIT_EXCEEDED_USE_ROWS');
    const bytes = await this.file('dataset.jsonl').bytes({limit, signal});
    const text = new TextDecoder('utf-8', {fatal:true}).decode(bytes);
    const lines = text.length ? text.replace(/\n$/, '').split('\n') : [];
    need(lines.length === this.manifest.dataset.rows, 'DATASET_ROW_COUNT_CHANGED');
    return lines.map(line => this._row(line));
  }
}
