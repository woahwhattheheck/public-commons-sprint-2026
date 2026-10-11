// MIT. Named Node downloads compose the original object application and file reader.
import { mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { VerifiedFile } from './result.mjs';
import { absolute, privateDirectory, digest, now, intent, object, need, BuyerError,
  jsonBytes, readBytes, readJson, writeBytes, writeJson, exists, syncDirectory } from './store.mjs';

const SCHEMA = 'stellar-forge.node-object.v1';
const REPORT = 'stellar-forge.sf88.object-acquisition.v1';
const BINDING_FIELDS = ['directory','sessionId','sourceIntentId','createdAt','configurationSha256',
  'sourceUrl','workspace','bytes','chunkBytes','chunkCount','expectedSnapshot','expectedSha256',
  'expectedContentType','selection','limits'];
const clone = value => JSON.parse(jsonBytes(value));
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function binding(report) {
  need(report?.schema === REPORT, 'OBJECT_NATIVE_REPORT_INVALID');
  return Object.fromEntries(BINDING_FIELDS.map(key => [key, report[key]]));
}
const equal = (left, right) => jsonBytes(left).equals(jsonBytes(right));

export class ObjectReport {
  constructor(record, process) {
    need(record?.mode === 'ORIGINAL_PYTHON_OBJECT' && record.report?.schema === REPORT &&
      object(record.chunkPage) && Array.isArray(record.chunkPage.items) &&
      object(record.assemblyPage) && Array.isArray(record.assemblyPage.items), 'OBJECT_NATIVE_REPORT_INVALID');
    this.record = freeze(clone(record));
    this.process = freeze(clone(process));
  }
  get native() { return this.record.report; }
  get status() { return this.native.status; }
  get chunks() { return this.record.chunkPage.items; }
  get chunkPage() { return this.record.chunkPage; }
  get assemblyPage() { return this.record.assemblyPage; }
}

export class ObjectDownloadError extends BuyerError {
  constructor(code, acquisition, progress) {
    super(code, {acquisition, progress, exitCode:progress?.process.exitCode});
    this.name = 'ObjectDownloadError';
  }
}

export class ObjectAcquisition {
  constructor(buyer, id) {
    this.buyer = buyer;
    this.id = intent(id);
    this.directory = join(buyer.stateDirectory, 'objects', digest(this.id));
  }
  async _metadata() {
    await privateDirectory(this.directory, {create:false});
    const value = await readJson(join(this.directory, 'object.json'));
    need(value.schema === SCHEMA && value.id === this.id && value.entryDirectory === this.directory &&
      object(value.source) && ['attached','prepared'].includes(value.source.kind) && object(value.inputs),
    'OBJECT_APPLICATION_STATE_INVALID');
    absolute(value.sessionDirectory);
    for (const [name, expected] of Object.entries(value.inputs)) {
      need(['config.json','description.json'].includes(name) && /^[a-f0-9]{64}$/.test(expected),
        'OBJECT_APPLICATION_INPUT_INVALID');
      need(digest(await readBytes(join(this.directory, name), name === 'description.json' ? 8388608 : 65536)) === expected,
        'OBJECT_APPLICATION_INPUT_CHANGED');
    }
    return value;
  }
  async _verifyBinding(meta) {
    const saved = await readJson(join(this.directory, 'binding.json'));
    // This is only the application's identity join. The original command validates
    // the full session, configs, queue outcomes, ranges and bytes before acting.
    const native = await readJson(join(meta.sessionDirectory, 'session.json'), 131072);
    need(native.directory === meta.sessionDirectory && object(native.config?.operation),
      'OBJECT_APPLICATION_SESSION_CHANGED');
    const current = binding({...native, schema:REPORT, sourceIntentId:native.config.operation.intentId,
      sourceUrl:native.config.operation.url});
    need(equal(saved, current), 'OBJECT_APPLICATION_SESSION_CHANGED');
    return saved;
  }
  async _command(action, args = [], {signal, chunkOffset = 0, chunkLimit = 50} = {}, {initialize = false} = {}) {
    need(Number.isSafeInteger(chunkOffset) && chunkOffset >= 0 &&
      Number.isSafeInteger(chunkLimit) && chunkLimit >= 1 && chunkLimit <= 250, 'OBJECT_CHUNK_PAGE_INVALID');
    const meta = await this._metadata();
    const previous = initialize ? null : await this._verifyBinding(meta);
    const parent = await privateDirectory(join(this.directory, 'commands'));
    const directory = await mkdtemp(join(parent, action + '-'));
    // Reuse the released JavaScript bridge. Its path does not require Python;
    // this is the same original native object application used by that client.
    const run = await this.buyer.runtime.run([action, '--session', meta.sessionDirectory,
      '--chunk-offset', String(chunkOffset), '--chunk-limit', String(chunkLimit), ...args],
    {directory, signal, entryFile:join(this.buyer.runtime.directory, 'python', 'object-bridge.mjs')});
    const financial = ['accounting','finalize'].includes(action);
    if (run.output?.mode !== 'ORIGINAL_PYTHON_OBJECT' || run.output.action !== action ||
      run.output.report?.schema !== (financial ? 'stellar-forge.sf88.session-accounting.v1' : REPORT) ||
      run.output.report.directory !== meta.sessionDirectory) {
      throw new BuyerError(run.errorCode ?? 'OBJECT_NATIVE_RESULT_UNAVAILABLE',
        {acquisition:this, exitCode:run.exitCode, commandDirectory:directory});
    }
    const process = {exitCode:run.exitCode, exitSignal:run.exitSignal, errorCode:run.errorCode};
    if (financial) {
      const report = run.output.report;
      need(previous && report.kind === 'object' && report.sessionId === previous.sessionId &&
        report.configurationSha256 === previous.configurationSha256 && object(report.range) &&
        Array.isArray(report.entries), 'OBJECT_ACCOUNTING_BINDING_CHANGED');
      const record = freeze(clone(run.output));
      const result = freeze({native:record.report, record, process});
      await writeJson(join(this.directory, 'last-accounting.json'), {completedAt:now(), ...result});
      if (run.exitCode === 0 && !run.errorCode) await rm(directory, {recursive:true, force:true});
      this.lastAccounting = result;
      return result;
    }
    const result = new ObjectReport(run.output, process);
    const current = binding(result.native);
    if (meta.inputs['config.json']) need(current.configurationSha256 === meta.inputs['config.json'],
      'OBJECT_APPLICATION_CONFIG_CHANGED');
    if (meta.source.workspaceDirectory) need(current.workspace === meta.source.workspaceDirectory,
      'OBJECT_APPLICATION_WORKSPACE_CHANGED');
    if (meta.inputs['description.json']) need(current.selection?.descriptionSha256 === meta.inputs['description.json'] &&
      current.selection?.objectId === meta.plan.objectId, 'OBJECT_APPLICATION_SELECTION_CHANGED');
    if (meta.plan) {
      need(current.limits.maxTotalAtomic === meta.plan.maxTotalAtomic &&
        (meta.plan.chunkBytes === undefined || current.chunkBytes === meta.plan.chunkBytes),
      'OBJECT_APPLICATION_PLAN_CHANGED');
      if (!meta.inputs['description.json']) need(current.bytes === meta.plan.bytes &&
        current.expectedSnapshot === meta.plan.expectedSnapshot &&
        current.expectedSha256 === (meta.plan.expectedSha256 ?? null) &&
        current.expectedContentType === (meta.plan.expectedContentType ?? null), 'OBJECT_APPLICATION_PLAN_CHANGED');
    }
    if (previous) need(equal(previous, current), 'OBJECT_APPLICATION_SESSION_CHANGED');
    else {
      const path = join(this.directory, 'binding.json');
      try { await writeJson(path, current, {exclusive:true}); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        need(equal(await readJson(path), current), 'OBJECT_APPLICATION_SESSION_CHANGED');
      }
    }
    await writeJson(join(this.directory, 'last-command.json'), {completedAt:now(),
      record:result.record, process:result.process});
    if (run.exitCode === 0 && !run.errorCode) await rm(directory, {recursive:true, force:true});
    this.lastReport = result;
    return result;
  }
  async initialize(options) {
    const meta = await this._metadata();
    if (meta.source.kind === 'attached' || await exists(join(meta.sessionDirectory, 'session.json')))
      return this._command('inspect', [], options, {initialize:true});
    if (await exists(meta.sessionDirectory)) throw new BuyerError('OBJECT_NATIVE_PREPARATION_INCOMPLETE',
      {acquisition:this, sessionDirectory:meta.sessionDirectory});
    const args = ['--max-total-atomic', meta.plan.maxTotalAtomic];
    if (meta.inputs['config.json']) args.push('--config', join(this.directory, 'config.json'));
    if (meta.source.workspaceDirectory) args.push('--workspace', meta.source.workspaceDirectory);
    if (meta.plan.chunkBytes !== undefined) args.push('--chunk-bytes', String(meta.plan.chunkBytes));
    let action;
    if (meta.inputs['description.json']) {
      action = 'prepare';
      args.push('--description', join(this.directory, 'description.json'), '--object', meta.plan.objectId);
    } else {
      action = 'prepare-explicit';
      args.push('--bytes', String(meta.plan.bytes), '--snapshot', meta.plan.expectedSnapshot);
      if (meta.plan.expectedSha256) args.push('--sha256', meta.plan.expectedSha256);
      if (meta.plan.expectedContentType) args.push('--content-type', meta.plan.expectedContentType);
    }
    return this._command(action, args, options, {initialize:true});
  }
  inspect(options) { return this._command('inspect', [], options); }
  run(options) { return this._command('run', [], options); }
  recover(options) { return this._command('recover', [], options); }
  _accounting(action, {workspaceDirectory, offset = 0, limit = 100, signal,
    outboxDirectory, merchantRoute} = {}) {
    need(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) &&
      limit >= 1 && limit <= 250, 'OBJECT_ACCOUNTING_RANGE_INVALID');
    const args = ['--offset',String(offset),'--limit',String(limit)];
    if (workspaceDirectory !== undefined) args.push('--workspace',absolute(workspaceDirectory));
    if (outboxDirectory !== undefined) args.push('--outbox',absolute(outboxDirectory));
    if (merchantRoute !== undefined) args.push('--merchant-route',merchantRoute);
    return this._command(action,args,{signal});
  }
  /** Read the original per-chunk reservation/finalization views, without product reads. */
  accounting(options) { return this._accounting('accounting',options); }
  /** Explicit original SF36/SF86 continuation; never obtains another object chunk. */
  finalize(options) { return this._accounting('finalize',options); }
  async _delivery(action, destination, options) {
    const result = await this._command(action, destination === undefined ? [] : ['--out', absolute(destination)], options);
    if (!result.record.delivery) throw new ObjectDownloadError(result.process.errorCode ?? 'OBJECT_DOWNLOAD_INCOMPLETE', this, result);
    const delivery = new ObjectDelivery(result);
    // Reopened native receipts describe a prior assembly. Verify its current file
    // before returning it to application code, preserving the original receipt.
    try { await delivery.verify({signal:options?.signal}); }
    catch (error) {
      Object.assign(error, {acquisition:this, progress:result, delivery});
      throw error;
    }
    return delivery;
  }
  /** The original command preflights a new destination before requesting any chunk. */
  download(destination, options) { return this._delivery('download', absolute(destination), options); }
  /** Offline assembly into a new private path, through the original native engine. */
  assemble(destination, options) { return this._delivery('assemble', absolute(destination), options); }
  /** Offline reopen of an existing native assembly, latest unless a path is selected. */
  delivery(destination, options) { return this._delivery('delivery', destination, options); }
  exportReport(destination, {format = 'html', ...options} = {}) {
    need(['html','json'].includes(format), 'OBJECT_REPORT_FORMAT_INVALID');
    return this._command('report', ['--out', absolute(destination), '--format', format], options);
  }
}

export async function createObject(buyer, options, attached = false) {
  need(object(options), 'OBJECT_OPTIONS_REQUIRED');
  const {id, directory, config, workspaceDirectory, operatorProfile, descriptionFile,
    objectId, maxTotalAtomic, bytes, chunkBytes, expectedSnapshot, expectedSha256, expectedContentType} = options;
  const acquisition = new ObjectAcquisition(buyer, id);
  const meta = {schema:SCHEMA, id:acquisition.id, entryDirectory:acquisition.directory,
    sessionDirectory:attached ? absolute(directory) : join(acquisition.directory, 'session'),
    createdAt:now(), source:{kind:attached ? 'attached' : 'prepared'}, inputs:{}};
  const inputs = {};
  if (!attached) {
    need(config !== undefined || workspaceDirectory !== undefined, 'OBJECT_CONFIG_OR_WORKSPACE_REQUIRED');
    need(config !== undefined || operatorProfile === undefined, 'OBJECT_WORKSPACE_PROFILE_UNSUPPORTED');
    need(typeof maxTotalAtomic === 'string' && /^(0|[1-9][0-9]{0,38})$/.test(maxTotalAtomic), 'OBJECT_TOTAL_BUDGET_REQUIRED');
    meta.plan = {maxTotalAtomic};
    if (workspaceDirectory !== undefined) meta.source.workspaceDirectory = absolute(workspaceDirectory);
    if (config !== undefined) {
      inputs['config.json'] = jsonBytes(await buyer._profile(typeof config === 'string'
        ? await readJson(absolute(config)) : clone(config), operatorProfile));
      need(inputs['config.json'].length <= 65536, 'CONFIG_SIZE_LIMIT');
    }
    if (descriptionFile !== undefined) {
      need(typeof objectId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(objectId), 'OBJECT_EXPLICIT_SELECTION_REQUIRED');
      need([bytes,expectedSnapshot,expectedSha256,expectedContentType].every(value => value === undefined),
        'OBJECT_DESCRIPTION_OR_EXPLICIT_PLAN_REQUIRED');
      inputs['description.json'] = await readBytes(absolute(descriptionFile), 8388608);
      meta.plan.objectId = objectId;
    } else {
      need(objectId === undefined && Number.isSafeInteger(bytes) && bytes > 0 &&
        Number.isSafeInteger(chunkBytes) && chunkBytes > 0 &&
        typeof expectedSnapshot === 'string' && /^[a-f0-9]{64}$/.test(expectedSnapshot), 'OBJECT_EXPLICIT_PLAN_REQUIRED');
      Object.assign(meta.plan, {bytes, expectedSnapshot});
      if (expectedSha256 !== undefined) meta.plan.expectedSha256 = expectedSha256;
      if (expectedContentType !== undefined) meta.plan.expectedContentType = expectedContentType;
    }
    if (chunkBytes !== undefined) {
      need(Number.isSafeInteger(chunkBytes) && chunkBytes > 0, 'OBJECT_CHUNK_BYTES_INVALID');
      meta.plan.chunkBytes = chunkBytes;
    }
    for (const [name, value] of Object.entries(inputs)) meta.inputs[name] = digest(value);
  }
  jsonBytes(meta);
  await buyer.ready();
  const parent = await privateDirectory(join(buyer.stateDirectory, 'objects'));
  if (await exists(acquisition.directory)) throw new BuyerError('OBJECT_ALREADY_EXISTS_USE_OPEN', {acquisition});
  const stage = await mkdtemp(join(parent, '.object-stage-'));
  for (const [name, value] of Object.entries(inputs)) await writeBytes(join(stage, name), value, {exclusive:true});
  await writeJson(join(stage, 'object.json'), meta, {exclusive:true});
  await syncDirectory(stage);
  try { await rename(stage, acquisition.directory); }
  catch (error) {
    if (['EEXIST','ENOTEMPTY'].includes(error.code))
      throw new BuyerError('OBJECT_ALREADY_EXISTS_USE_OPEN', {acquisition, stagingDirectory:stage});
    throw error;
  }
  await syncDirectory(parent);
  const result = await acquisition.initialize();
  if (result.process.exitCode !== 0 || result.process.errorCode)
    throw new BuyerError(result.process.errorCode ?? 'OBJECT_INITIALIZATION_INCOMPLETE', {acquisition, progress:result});
  return acquisition;
}

export async function* listObjects(buyer) {
  await buyer.ready();
  const parent = join(buyer.stateDirectory, 'objects');
  if (!await exists(parent)) return;
  await privateDirectory(parent, {create:false});
  for (const entry of await readdir(parent, {withFileTypes:true})) {
    if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
    const value = await readJson(join(parent, entry.name, 'object.json'));
    need(value.schema === SCHEMA && digest(intent(value.id)) === entry.name, 'OBJECT_APPLICATION_STATE_INVALID');
    yield new ObjectAcquisition(buyer, value.id);
  }
}

export class ObjectDelivery extends VerifiedFile {
  constructor(report) {
    super();
    need(report instanceof ObjectReport, 'OBJECT_DELIVERY_REPORT_REQUIRED');
    this.report = report;
    this._metadata();
  }
  get path() { return this._metadata().path; }
  get assembly() { return this.report.record.delivery.assembly; }
  get receiptRecorded() { return this.assembly.receiptStatus !== 'NOT_RECORDED'; }
  _metadata() {
    const {native, record} = this.report, delivery = record.delivery;
    need(native.status === 'COMPLETE' && object(delivery) && object(delivery.file) &&
      object(delivery.assembly), 'OBJECT_COMPLETE_DELIVERY_REQUIRED');
    const file = delivery.file, assembly = delivery.assembly;
    need(['SAVED','RECORDED'].includes(assembly.status) &&
      assembly.sessionId === native.sessionId && assembly.configurationSha256 === native.configurationSha256 &&
      assembly.snapshot === native.expectedSnapshot && assembly.destination === absolute(file.path) &&
      assembly.bytes === file.bytes && file.bytes === native.bytes &&
      Number.isSafeInteger(file.bytes) && file.bytes > 0 &&
      assembly.sha256 === file.sha256 && file.sha256 === native.objectSha256 &&
      typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/.test(file.sha256), 'OBJECT_ASSEMBLY_BINDING_INVALID');
    return file;
  }
}
