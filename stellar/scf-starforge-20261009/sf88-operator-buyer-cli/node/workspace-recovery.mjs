// MIT — Customer API for the original SF88/SF101 workspace recovery commands.
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { NativeRuntime } from './runtime.mjs';
import { absolute, object, need, BuyerError, safeCode } from './store.mjs';

const SCHEMA = 'stellar-forge.sf88.workspace-recovery.v1';
const STATUSES = {
  snapshot: 'BUYER_STATE_BACKUP_CREATED',
  verify: 'BUYER_STATE_BACKUP_VERIFIED',
  restore: 'BUYER_STATE_RESTORED',
};
const frozen = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
};
function canonical(value) {
  need(absolute(value) === value && value !== sep, 'WORKSPACE_RECOVERY_CANONICAL_PATH_REQUIRED');
  return value;
}
function selection({ directory, stateRoot, inboxes = [], include = [] }) {
  canonical(directory); canonical(stateRoot);
  need(Array.isArray(inboxes) && Array.isArray(include) && inboxes.length <= 64 && include.length <= 64,
    'WORKSPACE_RECOVERY_ROOT_LIST_INVALID');
  return ['--dir', directory, '--state-root', stateRoot,
    ...inboxes.flatMap(path => ['--inbox', canonical(path)]),
    ...include.flatMap(path => ['--include', canonical(path)])];
}
function passphraseName(value) {
  need(typeof value === 'string' && /^[A-Z][A-Z0-9_]{4,63}$/.test(value),
    'WORKSPACE_RECOVERY_PASSPHRASE_NAME_INVALID');
  return value;
}
function archiveOptions({ bundle, passphraseEnv = 'SF88_BACKUP_PASSPHRASE',
  python = '/usr/bin/python3', expectedRecordSha256 }) {
  const args = ['--bundle', canonical(bundle), '--pass-env', passphraseName(passphraseEnv),
    '--python', canonical(python)];
  if (expectedRecordSha256 !== undefined) {
    need(typeof expectedRecordSha256 === 'string' && /^[a-f0-9]{64}$/.test(expectedRecordSha256),
      'WORKSPACE_RECOVERY_EXPECTED_RECORD_INVALID');
    args.push('--expect', expectedRecordSha256);
  }
  return args;
}
function completion(operation, native) {
  if (!native || native.schema !== SCHEMA || typeof native.stateRoot !== 'string' ||
      typeof native.directory !== 'string') return false;
  if (operation === 'inspect') return native.restoreMode === 'ORIGINAL_CANONICAL_STATE_ROOT' &&
    Array.isArray(native.selected) && Array.isArray(native.inboxes);
  return native.status === STATUSES[operation] &&
    /^[a-f0-9]{64}$/.test(native.recordSha256 ?? '');
}

/** Original completion metadata and subprocess outcome remain separate facts. */
export class WorkspaceRecoveryResult {
  constructor(operation, run, { started = false, errorCode = null, cleanupErrorCode = null } = {}) {
    this.operation = operation;
    this.native = object(run?.output) && run.output.schema === SCHEMA ? frozen(run.output) : null;
    this.process = Object.freeze({
      exitCode: run?.exitCode ?? null,
      exitSignal: run?.exitSignal ?? null,
      errorCode: run?.errorCode ?? errorCode,
      started,
      cleanupErrorCode,
    });
    this.completionReported = completion(operation, this.native);
    this.ok = this.completionReported && this.process.exitCode === 0 &&
      !this.process.exitSignal && !this.process.errorCode && !cleanupErrorCode;
    Object.freeze(this);
  }
}

/** An interrupted restore can already be published; inspect result, never retry blindly. */
export class WorkspaceRecoveryError extends BuyerError {
  constructor(code, result) {
    super(code, { result });
    this.name = 'WorkspaceRecoveryError';
  }
}

async function runRecoveryCommand(runtime, operation, args, parent, signal,
  {ResultType=WorkspaceRecoveryResult,ErrorType=WorkspaceRecoveryError,entryFile,fullResult=false}={}) {
    let directory, run, problem = null, cleanupErrorCode = null, started = false;
    try {
      // Capture logs remain outside the quiesced source. Archive operations use
      // OS temporary storage, so a read-only mounted bundle stays usable.
      const canonicalParent = await realpath(parent);
      need(operation === 'verify' || operation === 'restore' || operation === 'compare' || canonicalParent === parent,
        'WORKSPACE_RECOVERY_OPERATION_PARENT_INVALID');
      directory = await mkdtemp(join(canonicalParent, '.sf88-sdk-recovery-'));
      const resultFile = fullResult ? join(directory, 'comparison.json') : undefined;
      run = await runtime.run(fullResult ? [...args,'--result-file',resultFile] : args,
        { directory, signal, entryFile, ...(fullResult ? {resultFile,resultLimit:267386880} : {}),
          started: () => { started = true; } });
    } catch (error) {
      problem = safeCode(error?.code, 'WORKSPACE_RECOVERY_NATIVE_COMMAND_FAILED');
    } finally {
      if (directory) {
        try { await rm(directory, { recursive: true, force: true }); }
        catch (error) { cleanupErrorCode = safeCode(error?.code, 'WORKSPACE_RECOVERY_LOG_CLEANUP_FAILED'); }
      }
    }
    const result = new ResultType(operation, run,
      { started, errorCode: problem, cleanupErrorCode });
    if (!result.ok) throw new ErrorType(problem ?? result.process.errorCode ??
      cleanupErrorCode ?? (result.process.exitCode !== 0 || result.process.exitSignal ?
        'WORKSPACE_RECOVERY_NATIVE_COMMAND_FAILED' : 'WORKSPACE_RECOVERY_NATIVE_RESULT_INVALID'), result);
    return result;
  }


/** Does not create a Buyer, initialize a ledger, or create any buyer state directory. */
export class WorkspaceRecovery {
  constructor(options) {
    this.runtime = options instanceof NativeRuntime ? options : new NativeRuntime(options);
    this.applicationDirectory = null;
  }

  static fromBuyer(buyer) {
    need(buyer?.runtime instanceof NativeRuntime, 'ORIGINAL_BUYER_RUNTIME_REQUIRED');
    const recovery = new WorkspaceRecovery(buyer.runtime);
    recovery.applicationDirectory = canonical(buyer.stateDirectory);
    return recovery;
  }

  _selection(options) {
    need(Array.isArray(options.include), 'WORKSPACE_RECOVERY_ROOT_LIST_INVALID');
    return selection({ ...options, include: [...new Set([...options.include,
      ...(this.applicationDirectory ? [this.applicationDirectory] : [])])] });
  }

  _command(operation, args, parent, signal) {
    return runRecoveryCommand(this.runtime, operation, args, parent, signal);
  }

  inspect({ directory, stateRoot, inboxes = [], include = [], signal } = {}) {
    const args = this._selection({ directory, stateRoot, inboxes, include });
    return this._command('inspect', ['--inspect-workspace-backup', ...args], dirname(stateRoot), signal);
  }

  snapshot({ directory, stateRoot, inboxes = [], include = [], output, quiesced,
    passphraseEnv = 'SF88_BACKUP_PASSPHRASE', signal } = {}) {
    need(quiesced === true, 'WORKSPACE_RECOVERY_QUIESCED_SOURCE_REQUIRED');
    const args = this._selection({ directory, stateRoot, inboxes, include });
    args.push('--out', canonical(output), '--quiesced', '--pass-env', passphraseName(passphraseEnv));
    return this._command('snapshot', ['--backup-workspace', ...args], dirname(stateRoot), signal);
  }

  verify({ bundle, passphraseEnv, python, expectedRecordSha256, signal } = {}) {
    const args = archiveOptions({ bundle, passphraseEnv, python, expectedRecordSha256 });
    return this._command('verify', ['--verify-workspace-backup', ...args], tmpdir(), signal);
  }

  restore({ bundle, passphraseEnv, python, expectedRecordSha256, signal } = {}) {
    const args = archiveOptions({ bundle, passphraseEnv, python, expectedRecordSha256 });
    // The authenticated native record chooses the original root. No target
    // override, original-state deletion, rewrite, retry, or purchase is performed.
    return this._command('restore', ['--restore-workspace', ...args], tmpdir(), signal);
  }
}


const OBJECT_SCHEMA='stellar-forge.sf88.object-session-recovery.v1';
const OBJECT_STATUSES={snapshot:'OBJECT_SESSION_BACKUP_CREATED',verify:'OBJECT_SESSION_BACKUP_VERIFIED',
  restore:'OBJECT_SESSION_STATE_RESTORED'};
function objectCompletion(operation,native) {
  if(!native||native.schema!==OBJECT_SCHEMA||typeof native.stateRoot!=='string'||
    typeof native.directory!=='string'||!/^[a-f0-9]{64}$/.test(native.reviewSha256??''))return false;
  if(operation==='inspect')return native.restoreMode==='ORIGINAL_CANONICAL_STATE_ROOT'&&
    Array.isArray(native.selected)&&Array.isArray(native.sourceFiles)&&native.absentLedger?.state==='ABSENT';
  return native.status===OBJECT_STATUSES[operation]&&/^[a-f0-9]{64}$/.test(native.recordSha256??'');
}

/** A published backup/restore and a clean native exit are separate facts. */
export class ObjectSessionRecoveryResult {
  constructor(operation,run,{started=false,errorCode=null,cleanupErrorCode=null}={}) {
    this.operation=operation;
    this.native=object(run?.output)&&run.output.schema===OBJECT_SCHEMA?frozen(run.output):null;
    this.process=Object.freeze({exitCode:run?.exitCode??null,exitSignal:run?.exitSignal??null,
      errorCode:run?.errorCode??errorCode,started,cleanupErrorCode});
    this.completionReported=objectCompletion(operation,this.native);
    this.ok=this.completionReported&&this.process.exitCode===0&&!this.process.exitSignal&&
      !this.process.errorCode&&!cleanupErrorCode&&!this.native.publicationSyncError&&
      !this.native.nativeReopenErrors?.length&&!this.native.cleanupErrors?.length&&!this.native.leaseReleaseErrors?.length;
    Object.freeze(this);
  }
}
export class ObjectSessionRecoveryError extends BuyerError {
  constructor(code,result){super(code,{result});this.name='ObjectSessionRecoveryError';}
}

const COMPARISON_SCHEMA='stellar-forge.sf88.object-session-comparison.v1';
/** Full native comparison (or completed partial sides) and the process outcome are retained separately. */
export class ObjectSessionComparisonResult {
  constructor(operation,run,{started=false,errorCode=null,cleanupErrorCode=null}={}) {
    this.operation=operation;
    this.native=object(run?.output)&&run.output.schema===COMPARISON_SCHEMA?frozen(run.output):null;
    this.partialComparison=this.native?.partialComparison??null;
    this.process=Object.freeze({exitCode:run?.exitCode??null,exitSignal:run?.exitSignal??null,
      errorCode:run?.errorCode??errorCode,started,cleanupErrorCode});
    this.completionReported=this.native?.status==='OBJECT_SESSION_BACKUPS_COMPARED'&&
      this.native.authenticated===true&&/^[a-f0-9]{64}$/.test(this.native.comparisonSha256??'');
    this.ok=this.completionReported&&this.process.exitCode===0&&!this.process.exitSignal&&
      !this.process.errorCode&&!cleanupErrorCode;
    Object.freeze(this);
  }
}
export class ObjectSessionComparisonError extends BuyerError {
  constructor(code,result){super(code,{result});this.name='ObjectSessionComparisonError';}
}

/** The same SF88/SF101 engine, with a native standalone zero-cap session selection. */
export class ObjectSessionRecovery {
  constructor(options) {
    this.runtime=options instanceof NativeRuntime?options:new NativeRuntime({outputLimit:8388608,...options});
  }
  _command(operation,args,parent,signal) {
    return runRecoveryCommand(this.runtime,operation,args,parent,signal,{
      ResultType:ObjectSessionRecoveryResult,ErrorType:ObjectSessionRecoveryError,
      entryFile:join(this.runtime.directory,'object-cli.mjs')});
  }
  _selection({directory,stateRoot,include=[]}) {
    canonical(directory);canonical(stateRoot);
    need(Array.isArray(include)&&include.length<=64,'WORKSPACE_RECOVERY_ROOT_LIST_INVALID');
    return ['--session',directory,'--state-root',stateRoot,...include.flatMap(path=>['--include',canonical(path)])];
  }
  inspect({directory,stateRoot,include=[],signal}={}) {
    return this._command('inspect',['session-backup-review',...this._selection({directory,stateRoot,include})],
      dirname(stateRoot),signal);
  }
  snapshot({directory,stateRoot,include=[],output,expectedReviewSha256,quiesced,
    passphraseEnv='SF88_BACKUP_PASSPHRASE',signal}={}) {
    need(quiesced===true,'WORKSPACE_RECOVERY_QUIESCED_SOURCE_REQUIRED');
    need(typeof expectedReviewSha256==='string'&&/^[a-f0-9]{64}$/.test(expectedReviewSha256),
      'OBJECT_RECOVERY_EXACT_REVIEW_REQUIRED');
    return this._command('snapshot',['session-backup',...this._selection({directory,stateRoot,include}),
      '--out',canonical(output),'--review',expectedReviewSha256,'--quiesced','--pass-env',passphraseName(passphraseEnv)],
      dirname(stateRoot),signal);
  }
  _archive({bundle,passphraseEnv='SF88_BACKUP_PASSPHRASE',expectedRecordSha256}) {
    const args=['--bundle',canonical(bundle),'--pass-env',passphraseName(passphraseEnv)];
    if(expectedRecordSha256!==undefined) {
      need(typeof expectedRecordSha256==='string'&&/^[a-f0-9]{64}$/.test(expectedRecordSha256),
        'WORKSPACE_RECOVERY_EXPECTED_RECORD_INVALID');args.push('--expect',expectedRecordSha256);
    }
    return args;
  }
  verify({signal,...options}={}) {
    return this._command('verify',['session-backup-verify',...this._archive(options)],tmpdir(),signal);
  }
  compare({before,after,signal}={}) {
    const args=['session-backup-compare'];
    for(const [side,value] of [['before',before],['after',after]]) {
      need(object(value),'OBJECT_COMPARISON_SELECTION_REQUIRED');
      need(typeof value.expectedRecordSha256==='string'&&/^[a-f0-9]{64}$/.test(value.expectedRecordSha256),
        'OBJECT_COMPARISON_EXACT_RECORD_REQUIRED');
      args.push('--'+side+'-bundle',canonical(value.bundle),'--'+side+'-expect',value.expectedRecordSha256,
        '--'+side+'-pass-env',passphraseName(value.passphraseEnv??'SF88_BACKUP_PASSPHRASE'));
    }
    return runRecoveryCommand(this.runtime,'compare',args,tmpdir(),signal,{
      ResultType:ObjectSessionComparisonResult,ErrorType:ObjectSessionComparisonError,
      entryFile:join(this.runtime.directory,'object-cli.mjs'),fullResult:true});
  }

  restore({signal,...options}={}) {
    return this._command('restore',['session-backup-restore',...this._archive(options)],tmpdir(),signal);
  }
}
