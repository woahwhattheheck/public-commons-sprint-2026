#!/usr/bin/env node
// MIT. No shell commands or payment approval replacements are accepted as input.
import { initializeRunbook, saveRunbookReport, executeRunbook, recoverRunbook, unlockRunbook,
  finalizeRunbook,bindRunbookWorkspace } from './runbook.mjs';
import { need } from '../sf88-operator-buyer-cli/config.mjs';

const USAGE = `Buyer runbook — compose original SF88 operations

  node cli.mjs init --manifest /absolute/jobs.json --out /absolute/new-run
  node cli.mjs status --run /absolute/existing-run
  node cli.mjs execute --run /absolute/existing-run [--only JOB_ID]
  node cli.mjs recover --run /absolute/existing-run
  node cli.mjs accounting-workspace --run /absolute/existing-run --only JOB_ID
                                   --workspace /absolute/original-sf88-workspace
  node cli.mjs finalize --run /absolute/existing-run [--only JOB_ID]
                       [--workspace /absolute/original-sf88-workspace]
                       [--outbox /absolute/original-outbox --merchant-route ORIGINAL_ROUTE_ID]
  node cli.mjs unlock --run /absolute/existing-run --owner-pid PID
  node cli.mjs backup-review --state /absolute/workspace --state-root /absolute/private-parent
  node cli.mjs backup --state /absolute/workspace --state-root /absolute/private-parent
                     --out /absolute/new-backup --review REVIEW_SHA256 --quiesced [--pass-env NAME]
  node cli.mjs backup-verify --bundle /absolute/backup [--expect RECORD_SHA256]
                            [--pass-env NAME] [--python /absolute/current-python]
  node cli.mjs backup-restore --bundle /absolute/backup [--expect RECORD_SHA256]
                             [--pass-env NAME] [--python /absolute/current-python]
  node cli.mjs workspace --state /absolute/private-workspace --configs /absolute/buyer-configs
                        [--operator-settings /absolute/private-operator.json]
                        [--run /absolute/existing-run] [--port 8460]

init snapshots explicit complete SF88 configs and request bodies without loading
a signer or making a network call. Optional saveAs names reserve a download path
inside the runbook. execute invokes the original buyer serially with its original
controlling-terminal approval. Only previously untouched jobs are executed.
recover imports complete retained original output and never starts a buyer.
finalize completes existing attempts through the original SF88/SF36 ledger. It
retains receipts and per-asset totals without a signer, payment or terminal prompt.
accounting-workspace binds one operation to its existing original operator; later
finalize calls reuse that selection. Optional outbox arguments require --only.
status rewrites only derived status.json/report.html, not plans or attempts.
unlock releases an exact dead local process lease; it preserves every attempt.
workspace opens the private browser planner and original run controls. Start it
in the same controlling terminal used for SF81 approval. Existing workspaces can
omit --configs to reuse their saved source directory.
backup-review resolves every original operator and retained acquisition under one
private state root. backup requires the exact reviewed selection and stopped
external writers. Its encrypted archive checkpoints every native ledger.
backup-verify authenticates all files and original journals. backup-restore uses
the original absent-or-empty state root and reopens saved acquisitions without
executing purchases. Set the passphrase environment variable before launching.
--operator-settings declares this machine's payer, signer source and maximum
budgets for receiving private merchant requests. Its path is retained for reopen.
`;
const print = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
function options(args, names) {
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    need(names.includes(args[i]) && !Object.hasOwn(result, args[i]) && typeof args[i + 1] === 'string' &&
      !args[i + 1].startsWith('--'), 'INVALID_CLI_OPTIONS');
    result[args[i]] = args[i + 1];
  }
  return result;
}
function compact({state, reportPath, statusPath,accountingPath}) {
  return {id:state.plan.id, reportPath, statusPath,accountingPath, executionLock:state.executionLock,
    accounting:state.accounting,
    operations:state.operations.map(row => ({id:row.id, state:row.state, integrity:row.integrity,
      buyerStatus:row.result?.summary?.status ?? null, responseFile:row.result?.summary?.responseFile?.status ?? null,
      accounting:row.accounting,
      ...(row.lastError ? {localError:row.lastError.code} : {})}))};
}

export async function main(args = process.argv.slice(2)) {
  const [command, ...tail] = args;
  if (!command || command === '--help' || command === 'help') { process.stdout.write(USAGE); return; }
  if (['backup-review','backup','backup-verify','backup-restore'].includes(command)) {
    const quiesced=tail.filter(value=>value==='--quiesced').length;
    need(quiesced<2&&(command==='backup'||quiesced===0),'INVALID_CLI_OPTIONS');
    const names=command==='backup-review'?['--state','--state-root']:
      command==='backup'?['--state','--state-root','--out','--review','--pass-env']:
        ['--bundle','--expect','--pass-env','--python'];
    const opts=options(tail.filter(value=>value!=='--quiesced'),names);
    const controller=new AbortController();let interruptedCode,model;
    const interrupt=()=>{interruptedCode??=130;controller.abort();};
    const terminate=()=>{interruptedCode??=143;controller.abort();};
    process.on('SIGINT',interrupt);process.on('SIGTERM',terminate);
    const context={signal:controller.signal,onProgress:event=>process.stderr.write(JSON.stringify(event)+'\n')};
    try {
      let result;
      if(command==='backup-review'||command==='backup') {
        need(opts['--state']&&opts['--state-root'],'WORKSPACE_STATE_AND_ROOT_REQUIRED');
        const {openRunbookWorkspace}=await import('./workspace-model.mjs');
        model=await openRunbookWorkspace({directory:opts['--state']});
        const input={stateRoot:opts['--state-root'],output:opts['--out'],
          expectedReviewSha256:opts['--review'],passEnv:opts['--pass-env'],quiesced:quiesced===1};
        result=command==='backup-review'?await model.inspectRecovery(input):await model.snapshotRecovery(input,context);
      } else {
        need(opts['--bundle'],'WORKSPACE_RECOVERY_BUNDLE_REQUIRED');
        const recovery=await import('./recovery.mjs');
        const action=command==='backup-restore'?recovery.restoreRunbookRecovery:recovery.verifyRunbookRecovery;
        result=await action({bundle:opts['--bundle'],expected:opts['--expect'],passEnv:opts['--pass-env'],python:opts['--python']},context);
      }
      print(result);
      if(result.reopenError||result.publicationSyncError||result.cleanupErrors?.length||result.selectionRecordError||result.leaseReleaseErrors?.length)process.exitCode=2;
    } finally {
      await model?.close();
      process.off('SIGINT',interrupt);process.off('SIGTERM',terminate);
      if(interruptedCode)process.exitCode=interruptedCode;
    }
    return;
  }
  if (command === 'workspace') {
    const opts = options(tail, ['--state','--configs','--operator-settings','--run','--port']);
    need(opts['--state'], 'WORKSPACE_STATE_DIRECTORY_REQUIRED');
    const {startRunbookWorkspace} = await import('./workspace.mjs');
    const service = await startRunbookWorkspace({directory:opts['--state'], configsDirectory:opts['--configs'],
      operatorSettings:opts['--operator-settings'],
      runs:opts['--run'] ? [opts['--run']] : [], port:Number(opts['--port'] ?? 8460)});
    const state = await service.model.state();
    print({mode:'BUYER_RUNBOOK_WORKSPACE', url:service.url, directory:service.model.directory,
      terminalAvailable:state.terminalAvailable});
    let stopping;
    const stop = code => { stopping ??= service.close().then(() => {process.exitCode = code;}, error => {
      process.stderr.write(JSON.stringify({error:error.code ?? 'WORKSPACE_SHUTDOWN_FAILED'}) + '\n'); process.exitCode = 1;
    }); };
    process.once('SIGINT',() => stop(130)); process.once('SIGTERM',() => stop(143));
    return;
  }
  if (command === 'init') {
    const opts = options(tail, ['--manifest','--out']);
    need(opts['--manifest'] && opts['--out'], 'MANIFEST_AND_OUTPUT_REQUIRED');
    await initializeRunbook({manifest:opts['--manifest'], output:opts['--out']});
    print(compact(await saveRunbookReport(opts['--out']))); return;
  }
  need(['status','execute','recover','unlock','finalize','accounting-workspace'].includes(command), 'UNKNOWN_COMMAND');
  const opts = options(tail, command === 'execute' ? ['--run','--only'] : command === 'unlock' ? ['--run','--owner-pid'] :
    command==='finalize'?['--run','--only','--workspace','--outbox','--merchant-route']:
      command==='accounting-workspace'?['--run','--only','--workspace']:['--run']);
  need(opts['--run'], 'RUN_DIRECTORY_REQUIRED');
  let action;
  if(command==='accounting-workspace') {
    need(opts['--only']&&opts['--workspace'],'RUNBOOK_ACCOUNTING_SELECTION_REQUIRED');
    action=await bindRunbookWorkspace(opts['--run'],{only:opts['--only'],workspace:opts['--workspace']});
  } else if (command === 'unlock') {
    need(/^[1-9][0-9]{0,9}$/.test(opts['--owner-pid'] ?? ''), 'EXACT_OWNER_PID_REQUIRED');
    action = await unlockRunbook(opts['--run'], Number(opts['--owner-pid']));
  } else if (command === 'recover') action = await recoverRunbook(opts['--run']);
  else if (command === 'execute'||command==='finalize') {
    const controller = new AbortController();
    let interruptedCode;
    const interrupt = () => { interruptedCode ??= 130; controller.abort(); };
    const terminate = () => { interruptedCode ??= 143; controller.abort(); };
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    try {
      const run=command==='finalize'?finalizeRunbook:executeRunbook;
      action = await run(opts['--run'], {only:opts['--only'], signal:controller.signal,
        ...(command==='finalize'?{workspace:opts['--workspace'],outbox:opts['--outbox'],merchantRoute:opts['--merchant-route']}:{}),
        onProgress:event => process.stderr.write(JSON.stringify(event) + '\n')});
    } finally {
      process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);
      if (interruptedCode) process.exitCode = interruptedCode;
    }
    if (!process.exitCode && action.results.some(result => command==='finalize'?
      !['FINALIZED','IDEMPOTENT_FINALIZED','NO_PAYMENT_REQUIRED','UNATTEMPTED'].includes(result.status)||result.viewStatus==='SAVE_FAILED':
      !['RESULT_RECORDED','ALREADY_ATTEMPTED'].includes(result.status) ||
      result.exitCode !== undefined && result.exitCode !== 0)) process.exitCode = 2;
  }
  print({...compact(await saveRunbookReport(opts['--run'])), ...(action ? {action} : {})});
}
main().catch(error => {
  const code = /^[A-Z0-9_]{1,120}$/.test(error?.code ?? '') ? error.code : 'RUNBOOK_LOCAL_ERROR';
  process.stderr.write(JSON.stringify({error:code}) + '\n');
  process.exitCode ||= 1;
});
