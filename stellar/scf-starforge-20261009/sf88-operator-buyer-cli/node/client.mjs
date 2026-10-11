// MIT — Durable Node applications on the original SF88 CLI.
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { NativeRuntime } from './runtime.mjs';
import { BuyerResult } from './result.mjs';
import { Dataset, createDataset, listDatasets } from './dataset.mjs';
import { ObjectAcquisition, createObject, listObjects } from './object.mjs';
import { absolute, privateDirectory, digest, now, intent, object, need, BuyerError,
  jsonBytes, parseJson, readBytes, readJson, exists, writeBytes, writeJson, syncDirectory } from './store.mjs';

const SCHEMA = 'stellar-forge.node-buyer.v1';
const NATIVE_RESULT = 'ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT';
const copy = value => parseJson(jsonBytes(value));
const profileKeys = new Set(['operator', 'signerModule', 'trustedPayer', 'bodyCaptureTimeoutMs', 'buyerTransport', 'requestTimeoutMs']);

export class Buyer {
  constructor({ runtimeDirectory, stateDirectory, operatorProfile, datasetReportLimit = 33554432, ...runtimeOptions }) {
    this.runtime = new NativeRuntime({ runtimeDirectory, ...runtimeOptions });
    this.stateDirectory = absolute(stateDirectory);
    this.operatorProfile = operatorProfile;
    need(Number.isSafeInteger(datasetReportLimit) && datasetReportLimit >= 1048576 &&
      datasetReportLimit <= 268435456, 'DATASET_REPORT_LIMIT_INVALID');
    this.datasetReportLimit = datasetReportLimit;
  }
  dataset(id) { return new Dataset(this, id); }
  createDataset(options) { return createDataset(this, options); }
  attachDataset(options) { return createDataset(this, options, true); }
  listDatasets() { return listDatasets(this); }
  object(id) { return new ObjectAcquisition(this, id); }
  createObject(options) { return createObject(this, options); }
  attachObject(options) { return createObject(this, options, true); }
  listObjects() { return listObjects(this); }

  async ready() { await privateDirectory(this.stateDirectory); return this; }
  operation(intentId) { return new Operation(this, intent(intentId)); }

  async _profile(config, override) {
    let profile = override ?? this.operatorProfile;
    if (profile === undefined) return config;
    if (typeof profile === 'string') profile = await readJson(absolute(profile));
    need(object(profile) && Object.keys(profile).every(key => profileKeys.has(key)), 'OPERATOR_PROFILE_FIELDS_INVALID');
    return { ...config, ...copy(profile) };
  }

  async _create(input, { body, operatorProfile, responseFile, requestTimeoutMs } = {}) {
    await this.ready();
    const config = await this._profile(copy(input), operatorProfile);
    need(object(config.operation), 'OPERATION_REQUIRED');
    const op = this.operation(config.operation.intentId);
    try { await mkdir(op.directory, { mode: 0o700 }); }
    catch (error) {
      if (error.code === 'EEXIST') throw new BuyerError('INTENT_ALREADY_EXISTS_USE_RECOVER', { operation: op });
      throw error;
    }
    await syncDirectory(this.stateDirectory);
    try {
      await writeJson(join(op.directory, 'operation.json'), { schema: SCHEMA,
        intentId: op.intentId, state: 'PREPARING', createdAt: now() }, { exclusive: true });
      if (body === undefined && config.operation.bodyFile !== undefined)
        body = await readBytes(config.operation.bodyFile, 1048576);
      if (body !== undefined) {
        need(typeof body === 'string' || body instanceof Uint8Array, 'BODY_BYTES_OR_STRING_REQUIRED');
        body = Buffer.from(body);
        need(body.length <= 1048576, 'REQUEST_BODY_LIMIT');
        config.operation.bodyFile = join(op.directory, 'request.body');
        await writeBytes(config.operation.bodyFile, body, { exclusive: true });
      }
      config.evidenceDir = await privateDirectory(join(op.directory, 'evidence'));
      config.captureBody = false;
      // Original native review validates every retained option. The application
      // owns the destination; expected bytes/type/digest and stream framing survive.
      need(config.responseFile === undefined || object(config.responseFile), 'APPLICATION_RESPONSE_OPTIONS_INVALID');
      if (responseFile !== undefined) need(object(responseFile) &&
        !Object.hasOwn(responseFile, 'destination'), 'APPLICATION_RESPONSE_OPTIONS_INVALID');
      const output = { ...config.responseFile, ...responseFile };
      config.responseFile = { ...output, destination: join(op.directory, 'response.bin'),
        maxBytes: output.maxBytes === undefined ? 67108864 : output.maxBytes,
        timeoutMs: output.timeoutMs === undefined ? 30000 : output.timeoutMs };
      if (requestTimeoutMs !== undefined) config.requestTimeoutMs = requestTimeoutMs;
      let raw = jsonBytes(config);
      need(raw.length <= 65536, 'CONFIG_SIZE_LIMIT');
      await writeBytes(op.configPath, raw, { exclusive: true });
      let native = await this.runtime.checked(['--review', '--config', op.configPath],
        { stateDirectory: this.stateDirectory, mode: 'OFFLINE_REVIEW' });
      let ticketSha256 = null;
      if (config.operation.ticketFile !== undefined) {
        // Original native review validates ownership, schema and header policy.
        // Copy only those exact validated bytes, never bearer data into metadata.
        const ticket = await readBytes(config.operation.ticketFile, 16384);
        ticketSha256 = digest(ticket);
        need(ticketSha256 === native.operationTicket?.sha256, 'OPERATION_TICKET_CHANGED');
        config.operation.ticketFile = join(op.directory, 'operation-ticket.json');
        await writeBytes(config.operation.ticketFile, ticket, { exclusive: true });
        raw = jsonBytes(config);
        need(raw.length <= 65536, 'CONFIG_SIZE_LIMIT');
        await writeBytes(op.configPath, raw);
        native = await this.runtime.checked(['--review', '--config', op.configPath],
          { stateDirectory: this.stateDirectory, mode: 'OFFLINE_REVIEW' });
        need(ticketSha256 === native.operationTicket?.sha256, 'OPERATION_TICKET_CHANGED');
      }
      const hashes = { configSha256: digest(raw), bodySha256: digest(body ?? Buffer.alloc(0)), ticketSha256 };
      need(native.intentId === op.intentId && native.bodySha256 === hashes.bodySha256, 'NATIVE_REVIEW_MISMATCH');
      await writeJson(join(op.directory, 'operation.json'), { schema: SCHEMA,
        intentId: op.intentId, state: 'PREPARED', createdAt: now(),
        runtimeDirectory: this.runtime.directory, ...hashes });
      await writeJson(join(op.directory, 'review.json'), { intentId: op.intentId,
        ...hashes, native, reviewedAt: now() }, { exclusive: true });
      return op;
    } catch (error) {
      // This creating call has not returned an operation or launched a purchase.
      await rm(op.directory, { recursive: true, force: true });
      await syncDirectory(this.stateDirectory);
      throw error;
    }
  }

  async fromConfig(input, options) {
    const config = typeof input === 'string' ? await readJson(absolute(input)) : input;
    return this._create(config, options);
  }

  async fromOperationHandoff(file, { accept, operatorProfile, signal, responseFile, requestTimeoutMs } = {}) {
    need(Number.isSafeInteger(accept) && accept >= 0, 'EXPLICIT_SELECTION_INDEX_REQUIRED');
    await this.ready();
    const temporary=await mkdtemp(join(this.stateDirectory,'.operation-import-'));
    try {
      const imported=await this.runtime.checked(['--import-operation','--file',absolute(file),
        '--dir',join(temporary,'request'),'--accept',String(accept)],
      {stateDirectory:this.stateDirectory,mode:'OFFLINE_OPERATION_IMPORTED',signal});
      // _create retains the exact body and original validated ticket before
      // removing the import directory. Operator settings come from this buyer.
      return await this._create(await readJson(imported.configPath),{operatorProfile,responseFile,requestTimeoutMs});
    } finally { await rm(temporary,{recursive:true,force:true}); }
  }

  async fromRequest(request, options) {
    need(object(request) && Object.keys(request).every(key =>
      ['intentId', 'url', 'method', 'expect', 'headers', 'body', 'signal', 'approve', 'sign', 'orderReference', 'ticketFile', 'ticketHeader'].includes(key)),
    'GENERATED_REQUEST_FIELDS_INVALID');
    need(request.approve === undefined && request.sign === undefined, 'USE_NATIVE_OPERATOR_PROFILE_NOT_CALLBACKS');
    const operation = {};
    for (const key of ['intentId', 'url', 'method', 'expect', 'headers', 'orderReference', 'ticketFile', 'ticketHeader'])
      if (request[key] !== undefined) operation[key] = request[key];
    // The installed original runtime validates and canonicalizes ordinary
    // headers during _create's mandatory native review. Keep this standalone
    // package independent of files outside its own published directory.
    return this._create({ operation }, { ...options, body: request.body });
  }

  // Directly fits the original SF30 createSellerClient({buyer}) interface.
  // Native SF62 approval and SF36 policy still run; no callback is fabricated.
  async call(request, options) {
    need(object(request), 'GENERATED_REQUEST_FIELDS_INVALID');
    need(!request.signal?.aborted, 'OPERATION_ABORTED_BEFORE_START');
    const operation = await this.fromRequest(request, options);
    return operation.execute({ review: await operation.review(), signal: request.signal });
  }

  async discover(catalog, { destination, signal } = {}) {
    await this.ready();
    const directory = await mkdtemp(join(this.stateDirectory, '.catalog-'));
    try {
      const config = join(directory, 'config.json');
      await writeJson(config, { catalog }, { exclusive: true });
      const output = await this.runtime.checked(['--discover', '--config', config],
        { stateDirectory: this.stateDirectory, mode: 'ORIGINAL_UNSIGNED_CATALOG', signal });
      if (destination) await writeJson(absolute(destination), output, { exclusive: true });
      return output;
    } finally { await rm(directory, { recursive: true, force: true }); }
  }

  async prepare({ discoveryFile, row, accept, intentId, url, method = 'GET',
    headers, body, operatorProfile, signal, ticketFile, ticketHeader, responseFile, requestTimeoutMs }) {
    need(Number.isSafeInteger(row) && row >= 0 && Number.isSafeInteger(accept) && accept >= 0,
      'EXPLICIT_SELECTION_INDEX_REQUIRED');
    intent(intentId);
    await this.ready();
    const directory = await mkdtemp(join(this.stateDirectory, '.prepare-'));
    try {
      const source = join(directory, 'catalog.json'), output = join(directory, 'config.json');
      await writeBytes(source, await readBytes(absolute(discoveryFile), 1048576), { exclusive: true });
      const headersFile = join(directory, 'request.headers.json');
      if (headers !== undefined) await writeJson(headersFile, headers, { exclusive: true });
      await this.runtime.checked(['--prepare', '--discovery', source, '--row', String(row),
        '--accept', String(accept), '--intent-id', intentId, '--url', url,
        '--method', method, '--out', output,
        ...(headers === undefined ? [] : ['--headers-file', headersFile]),
        ...(ticketFile === undefined ? [] : ['--ticket-file', absolute(ticketFile)]),
        ...(ticketHeader === undefined ? [] : ['--ticket-header', ticketHeader])],
      { stateDirectory: this.stateDirectory, mode: 'OFFLINE_CONFIG_PREPARED', signal });
      const config = await readJson(output);
      return await this._create(config, { body, operatorProfile, responseFile, requestTimeoutMs });
    } finally { await rm(directory, { recursive: true, force: true }); }
  }

  async *list() {
    await this.ready();
    for (const name of (await readdir(this.stateDirectory)).sort()) {
      if (!/^[a-f0-9]{64}$/.test(name)) continue;
      const meta = await readJson(join(this.stateDirectory, name, 'operation.json'));
      need(meta.schema === SCHEMA && digest(intent(meta.intentId)) === name, 'OPERATION_ID_MISMATCH');
      yield this.operation(meta.intentId);
    }
  }
}

export class Operation {
  constructor(buyer, intentId) {
    this.buyer = buyer;
    this.intentId = intentId;
    this.directory = join(buyer.stateDirectory, digest(intentId));
    this.configPath = join(this.directory, 'config.json');
  }
  async _bound() {
    await privateDirectory(this.directory, { create: false });
    const meta = await readJson(join(this.directory, 'operation.json'));
    need(meta.schema === SCHEMA && meta.intentId === this.intentId, 'OPERATION_ID_MISMATCH');
    need(meta.state === 'PREPARED', 'OPERATION_PREPARATION_INCOMPLETE');
    const raw = await readBytes(this.configPath), config = parseJson(raw);
    const body = config.operation.bodyFile ? await readBytes(config.operation.bodyFile, 1048576) : Buffer.alloc(0);
    need(digest(raw) === meta.configSha256 && digest(body) === meta.bodySha256, 'OPERATION_INPUT_CHANGED');
    const ticketHash = config.operation.ticketFile
      ? digest(await readBytes(config.operation.ticketFile, 16384)) : null;
    need(ticketHash === (meta.ticketSha256 ?? null), 'OPERATION_TICKET_CHANGED');
    return { meta, config };
  }
  async review() {
    const { meta } = await this._bound();
    const native = await this.buyer.runtime.checked(['--review', '--config', this.configPath],
      { stateDirectory: this.buyer.stateDirectory, mode: 'OFFLINE_REVIEW' });
    await this._bound();
    need(native.intentId === this.intentId && native.bodySha256 === meta.bodySha256 &&
      (native.operationTicket?.sha256 ?? null) === (meta.ticketSha256 ?? null), 'NATIVE_REVIEW_MISMATCH');
    const review = { intentId: this.intentId, configSha256: meta.configSha256,
      bodySha256: meta.bodySha256, ticketSha256: meta.ticketSha256 ?? null, native, reviewedAt: now() };
    await writeJson(join(this.directory, 'review.json'), review);
    return copy(review);
  }
  async execute({ review, signal } = {}) {
    need(signal === undefined || signal instanceof AbortSignal, 'INVALID_ABORT_SIGNAL');
    need(!signal?.aborted, 'OPERATION_ABORTED_BEFORE_START');
    const { meta, config } = await this._bound();
    need(review?.intentId === this.intentId && review.configSha256 === meta.configSha256 &&
      review.bodySha256 === meta.bodySha256 && (review.ticketSha256 ?? null) === (meta.ticketSha256 ?? null),
      'MATCHING_REVIEW_REQUIRED');
    need(config.operator && config.signerModule, 'ORIGINAL_OPERATOR_CONFIGURATION_REQUIRED');
    let attempt = { schema: SCHEMA, intentId: this.intentId, state: 'STARTING', createdAt: now(),
      configSha256: meta.configSha256, bodySha256: meta.bodySha256, retry: 'NO_AUTOMATIC_RETRY' };
    const attemptPath = join(this.directory, 'attempt.json');
    // Atomic hard-link publication: all processes contend for one nonreplaceable
    // attempt marker. A crash cannot expire it or authorize another purchase.
    try { await writeJson(attemptPath, attempt, { exclusive: true }); }
    catch (error) {
      if (error.code === 'EEXIST') throw new BuyerError('ATTEMPT_ALREADY_RECORDED_USE_RECOVER', { operation: this });
      throw error;
    }
    let run;
    try {
      run = await this.buyer.runtime.run(['--execute', '--config', this.configPath], {
        directory: this.directory, signal,
        started: async pid => {
          attempt = { ...attempt, state: 'STARTED', pid, startedAt: now() };
          await writeJson(attemptPath, attempt);
        },
      });
    } catch (error) {
      await writeJson(attemptPath, { ...attempt, state: 'INTERRUPTED_OR_START_FAILED', endedAt: now() });
      throw error;
    }
    if (run.output?.mode !== NATIVE_RESULT || run.output.intentId !== this.intentId) {
      await writeJson(attemptPath, { ...attempt, state: 'NATIVE_RESULT_UNAVAILABLE', endedAt: now(),
        exitCode: run.exitCode, errorCode: run.errorCode ?? 'NATIVE_RESULT_INVALID' });
      throw new BuyerError(run.errorCode ?? 'NATIVE_RESULT_INVALID', { operation: this, exitCode: run.exitCode });
    }
    const record = { schema: SCHEMA, intentId: this.intentId, configSha256: meta.configSha256,
      native: run.output, exitCode: run.exitCode, exitSignal: run.exitSignal,
      runtimeError: run.errorCode, recovered: false, recordedAt: now() };
    await writeJson(join(this.directory, 'result.json'), record, { exclusive: true });
    await writeJson(attemptPath, { ...attempt, state: 'RECORDED', exitCode: run.exitCode, endedAt: now() });
    return this._result(record);
  }
  async _result(record) {
    const { meta, config } = await this._bound();
    need(record.schema === SCHEMA && record.intentId === this.intentId && record.configSha256 === meta.configSha256 &&
      record.native?.mode === NATIVE_RESULT && record.native.intentId === this.intentId, 'RESULT_BINDING_MISMATCH');
    return new BuyerResult(record, config.responseFile, this.buyer.runtime.directory);
  }
  async recover() {
    const { meta } = await this._bound();
    if (await exists(join(this.directory, 'result.json')))
      return this._result(await readJson(join(this.directory, 'result.json'), this.buyer.runtime.outputLimit));
    if (!await exists(join(this.directory, 'attempt.json'))) return null;
    const attempt = await readJson(join(this.directory, 'attempt.json'));
    need(attempt.intentId === this.intentId && attempt.configSha256 === meta.configSha256, 'ATTEMPT_BINDING_MISMATCH');
    let native;
    try { native = await readJson(join(this.directory, 'stdout.json'), this.buyer.runtime.outputLimit); }
    catch (error) { if (['ENOENT', 'JSON_INVALID'].includes(error.code)) return null; throw error; }
    if (native.mode !== NATIVE_RESULT || native.intentId !== this.intentId) return null;
    return this._result({ schema: SCHEMA, intentId: this.intentId, configSha256: meta.configSha256,
      native, exitCode: null, exitSignal: null, runtimeError: 'PROCESS_EXIT_NOT_RECORDED',
      recovered: true, recordedAt: now() });
  }
  async inspect() {
    const { meta } = await this._bound();
    const attemptPath = join(this.directory, 'attempt.json');
    const attempt = await exists(attemptPath) ? await readJson(attemptPath) : null;
    const result = await this.recover();
    return { intentId: this.intentId, directory: this.directory, state: attempt?.state ?? meta.state,
      resultRecoverable: result !== null, nativeStatus: result?.status ?? null,
      deliveryStatus: result?.delivery.status ?? null, retry: 'NO_AUTOMATIC_RETRY' };
  }
}
