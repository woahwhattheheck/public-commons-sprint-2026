// MIT. Complete customer acquisitions on the original native runbook.
import {mkdtemp, realpath, rm} from 'node:fs/promises';
import {dirname, join, sep} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {NativeRuntime} from './runtime.mjs';
import {absolute, object, need, BuyerError, safeCode, writeJson, readJson} from './store.mjs';

const SCHEMA = 'stellar-forge.buyer-acquisitions-command.v1';
const within = (root, path) => path === root || path.startsWith(root + sep);
function canonical(path) {
  need(absolute(path) === path && path !== sep, 'ACQUISITION_CANONICAL_PATH_REQUIRED');
  return path;
}
function clean(value) {
  return JSON.parse(JSON.stringify(value, (_key, item) => {
    need(!['function','symbol','bigint'].includes(typeof item) &&
      (typeof item !== 'number' || Number.isFinite(item)), 'ACQUISITION_JSON_VALUES_REQUIRED');
    return item;
  }));
}
function frozen(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) frozen(item);
    Object.freeze(value);
  }
  return value;
}

/** A completed native mutation and the caller process outcome are separate. */
export class AcquisitionResult {
  constructor(command, commandId, run, {started=false, errorCode=null, cleanupErrorCode=null, callerCancelled=false} = {}) {
    const record = run?.output;
    const valid = object(record) && record.schema === SCHEMA && record.command === command &&
      record.commandId === commandId && typeof record.completed === 'boolean';
    this.command = command;
    this.commandId = commandId;
    this.native = valid ? frozen(record.native) : null;
    this.completionReported = valid && record.completed;
    this.process = Object.freeze({exitCode:run?.exitCode ?? null, exitSignal:run?.exitSignal ?? null,
      started, errorCode:errorCode ?? run?.errorCode ?? (valid ? record.error : 'ACQUISITION_NATIVE_RESULT_INVALID'),
      nativeErrorCode:valid ? record.error : null,
      cleanupErrorCode:cleanupErrorCode ?? (valid ? record.cleanupError : null),
      callerCancelled, interrupted:callerCancelled || Boolean(run?.exitSignal) ||
        (valid && record.interrupted === true) ||
        ['OPERATION_ABORTED','NATIVE_TIMEOUT','NATIVE_CLEANUP_DEADLINE_EXCEEDED']
          .includes(errorCode ?? run?.errorCode)});
    this.ok = this.completionReported && this.process.exitCode === 0 &&
      !this.process.exitSignal && !this.process.errorCode && !this.process.nativeErrorCode &&
      !this.process.cleanupErrorCode && !this.process.interrupted;
    Object.freeze(this);
  }
}
export class AcquisitionError extends BuyerError {
  constructor(code, result) {
    super(code, {result}); this.name = 'AcquisitionError';
  }
}

/**
 * Construction never creates a workspace or a ledger. Methods invoke one
 * original customer bridge; verify/restore need no live receiving workspace.
 */
export class AcquisitionWorkspace {
  constructor({runtime, directory, configsDirectory, operatorSettings, paidFileClaimEnvs, temporaryDirectory,
    resultLimit=33554432, ...runtimeOptions} = {}) {
    this.runtime = runtime instanceof NativeRuntime ? runtime : new NativeRuntime(runtimeOptions);
    this.directory = directory === undefined ? null : canonical(directory);
    this.configsDirectory = configsDirectory === undefined ? null : canonical(configsDirectory);
    this.operatorSettings = operatorSettings === undefined ? null : canonical(operatorSettings);
    need(paidFileClaimEnvs === undefined || Array.isArray(paidFileClaimEnvs) &&
      paidFileClaimEnvs.length > 0 && paidFileClaimEnvs.length <= 32 &&
      paidFileClaimEnvs.every(name => typeof name === 'string' && /^[A-Z][A-Z0-9_]{1,64}$/.test(name)) &&
      new Set(paidFileClaimEnvs).size === paidFileClaimEnvs.length, 'PAID_FILE_CLAIM_ENVS_INVALID');
    this.paidFileClaimEnvs = paidFileClaimEnvs === undefined ? null : Object.freeze([...paidFileClaimEnvs]);
    this.temporaryDirectory = temporaryDirectory === undefined ? null : canonical(temporaryDirectory);
    need(Number.isSafeInteger(resultLimit) && resultLimit >= 1048576 && resultLimit <= 268435456,
      'ACQUISITION_RESULT_LIMIT_INVALID');
    this.resultLimit = resultLimit;
  }
  static fromBuyer(buyer, options = {}) {
    need(buyer?.runtime instanceof NativeRuntime, 'ORIGINAL_BUYER_RUNTIME_REQUIRED');
    return new AcquisitionWorkspace({...options, runtime:buyer.runtime});
  }
  async _command(command, parameters={}, {signal}={}) {
    need(signal === undefined || signal instanceof AbortSignal, 'INVALID_ABORT_SIGNAL');
    const commandId = randomUUID();
    const workspace = this.directory === null ? undefined : {
      directory:this.directory,
      ...(this.configsDirectory === null ? {} : {configsDirectory:this.configsDirectory}),
      ...(this.operatorSettings === null ? {} : {operatorSettings:this.operatorSettings}),
      ...(this.paidFileClaimEnvs === null ? {} : {paidFileClaimEnvs:this.paidFileClaimEnvs}),
    };
    need(['verify','restore'].includes(command) || workspace, 'ACQUISITION_WORKSPACE_REQUIRED');
    const input = clean({schema:SCHEMA, command, commandId, workspace, parameters, resultLimit:this.resultLimit});
    let directory, resultFile, run, started=false, errorCode=null, cleanupErrorCode=null;
    try {
      need(!signal?.aborted, 'OPERATION_ABORTED_BEFORE_START');
      const requestedParent = parameters.stateRoot === undefined ?
        this.temporaryDirectory ?? tmpdir() : dirname(canonical(parameters.stateRoot));
      const parent = await realpath(requestedParent);
      if (this.temporaryDirectory || parameters.stateRoot !== undefined)
        need(parent === requestedParent, 'ACQUISITION_CANONICAL_PATH_REQUIRED');
      for (const selected of [this.directory, this.configsDirectory, parameters.stateRoot].filter(Boolean))
        need(!within(selected, parent), 'ACQUISITION_TEMPORARY_DIRECTORY_INSIDE_SOURCE');
      directory = await mkdtemp(join(parent, '.sf88-acquisitions-'));
      resultFile = join(directory, 'result.json');
      const inputFile = join(directory, 'input.json');
      await writeJson(inputFile, input, {exclusive:true});
      run = await this.runtime.run([inputFile, resultFile], {directory, signal,
        entryFile:join(dirname(this.runtime.directory), 'buyer-runbook', 'customer-bridge.mjs'),
        resultFile, resultLimit:this.resultLimit, started:() => {started=true;}});
    } catch (error) {
      errorCode = safeCode(error?.code, 'ACQUISITION_NATIVE_COMMAND_FAILED');
      // A durable native result may have been written before a process/log error.
      if (resultFile) try {run = {...run, output:await readJson(resultFile, this.resultLimit)};} catch {}
    } finally {
      if (directory) try {await rm(directory, {recursive:true, force:true});}
      catch (error) {cleanupErrorCode=safeCode(error?.code, 'ACQUISITION_TEMPORARY_CLEANUP_FAILED');}
    }
    const result = new AcquisitionResult(command, commandId, run, {started,errorCode,cleanupErrorCode,
      callerCancelled:signal?.aborted === true});
    if (!result.ok) throw new AcquisitionError(errorCode ?? result.process.errorCode ??
      result.process.nativeErrorCode ?? result.process.cleanupErrorCode ?? 'ACQUISITION_NATIVE_COMMAND_FAILED', result);
    return result;
  }
  state(options) {return this._command('state', {}, options);}
  attachRun(run, options) {return this._command('attach', {run:canonical(run)}, options);}
  request(id, options) {return this._command('request', {id}, options);}
  receiveRequest(file, {filename, signal}={}) {
    return this._command('receive', {file:canonical(file), filename}, {signal});
  }
  reviewRequest(id, {acceptIndex, totalAtomic, dailyAtomic, signal}={}) {
    return this._command('review-request', {id,acceptIndex,totalAtomic,dailyAtomic}, {signal});
  }
  prepareRequest(id, {reviewSha256, signal}={}) {
    return this._command('prepare-request', {id,reviewSha256}, {signal});
  }
  paidFile(id, options) {return this._command('paid-file', {id}, options);}
  receivePaidFile(file, {filename, signal}={}) {
    return this._command('receive-paid-file', {file:canonical(file),filename}, {signal});
  }
  reviewPaidFile(id, {expectedRevision, totalAtomic, dailyAtomic, filename, claimEnv, signal}={}) {
    return this._command('review-paid-file',
      {id,expectedRevision,totalAtomic,dailyAtomic,filename,claimEnv}, {signal});
  }
  preparePaidFile(id, {reviewSha256, signal}={}) {
    return this._command('prepare-paid-file', {id,reviewSha256}, {signal});
  }
  retrievePaidFile(id, {only, configSha256, handoffSha256, signal}={}) {
    return this._command('retrieve-paid-file', {id,only,configSha256,handoffSha256}, {signal});
  }
  resetPaidFile(id, {only, configSha256, handoffSha256, signal}={}) {
    return this._command('reset-paid-file', {id,only,configSha256,handoffSha256}, {signal});
  }
  downloadPaidFile(id, operationId, destination, options) {
    return this._command('download-paid-file', {id,operationId,destination:canonical(destination)}, options);
  }
  exportPaidFile(id, {destination, signal}={}) {
    return this._command('export-paid-file', {id,destination:canonical(destination)}, {signal});
  }
  draft(id, {revision, signal}={}) {return this._command('draft', {id,revision}, {signal});}
  save({id, expectedRevision=0, manifest, signal}={}) {
    return this._command('save', {id,expectedRevision,manifest}, {signal});
  }
  initialize(id, {expectedRevision, reviewSha256, signal}={}) {
    return this._command('initialize', {id,expectedRevision,reviewSha256}, {signal});
  }
  inspect(id, options) {return this._command('inspect', {id}, options);}
  execute(id, {expectedPlanSha256, only, signal}={}) {
    return this._command('execute', {id,expectedPlanSha256,only}, {signal});
  }
  recover(id, options) {return this._command('recover', {id}, options);}
  unlock(id, {ownerPid, signal}={}) {return this._command('unlock', {id,ownerPid}, {signal});}
  finalize(id, {only, signal}={}) {return this._command('finalize', {id,only}, {signal});}
  bindAccounting(id, {only, workspace, signal}={}) {
    return this._command('bind-accounting', {id,only,workspace:canonical(workspace)}, {signal});
  }
  preview(id, operationId, options) {return this._command('preview', {id,operationId}, options);}
  download(id, operationId, destination, options) {
    return this._command('download', {id,operationId,destination:canonical(destination)}, options);
  }
  export(id, {format, destination, signal}={}) {
    return this._command('export', {id,format,destination:canonical(destination)}, {signal});
  }
  exportRequest(id, {kind, destination, signal}={}) {
    return this._command('export-request', {id,kind,destination:canonical(destination)}, {signal});
  }
  backupReview({stateRoot, signal}={}) {
    return this._command('backup-review', {stateRoot:canonical(stateRoot)}, {signal});
  }
  backup({stateRoot, output, reviewSha256, quiesced, passphraseEnv, signal}={}) {
    need(quiesced === true, 'WORKSPACE_RECOVERY_QUIESCED_SOURCE_REQUIRED');
    return this._command('backup', {stateRoot:canonical(stateRoot),output:canonical(output),
      expectedReviewSha256:reviewSha256,quiesced,passEnv:passphraseEnv}, {signal});
  }
  verify({bundle, expectedRecordSha256, passphraseEnv, python, signal}={}) {
    return this._command('verify', {bundle:canonical(bundle),expected:expectedRecordSha256,
      passEnv:passphraseEnv,python:python === undefined ? undefined : canonical(python)}, {signal});
  }
  restore({bundle, expectedRecordSha256, passphraseEnv, python, signal}={}) {
    return this._command('restore', {bundle:canonical(bundle),expected:expectedRecordSha256,
      passEnv:passphraseEnv,python:python === undefined ? undefined : canonical(python)}, {signal});
  }
}
