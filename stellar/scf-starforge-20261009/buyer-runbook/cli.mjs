#!/usr/bin/env node
// MIT. No shell commands or payment approval replacements are accepted as input.
import { initializeRunbook, saveRunbookReport, executeRunbook, recoverRunbook, unlockRunbook } from './runbook.mjs';
import { need } from '../sf88-operator-buyer-cli/config.mjs';

const USAGE = `Buyer runbook — compose original SF88 operations

  node cli.mjs init --manifest /absolute/jobs.json --out /absolute/new-run
  node cli.mjs status --run /absolute/existing-run
  node cli.mjs execute --run /absolute/existing-run [--only JOB_ID]
  node cli.mjs recover --run /absolute/existing-run
  node cli.mjs unlock --run /absolute/existing-run --owner-pid PID
  node cli.mjs workspace --state /absolute/private-workspace --configs /absolute/buyer-configs
                        [--operator-settings /absolute/private-operator.json]
                        [--run /absolute/existing-run] [--port 8460]

init snapshots explicit complete SF88 configs and request bodies without loading
a signer or making a network call. Optional saveAs names reserve a download path
inside the runbook. execute invokes the original buyer serially with its original
controlling-terminal approval. Only previously untouched jobs are executed.
recover imports complete retained original output and never starts a buyer.
status rewrites only derived status.json/report.html, not plans or attempts.
unlock releases an exact dead local process lease; it preserves every attempt.
workspace opens the private browser planner and original run controls. Start it
in the same controlling terminal used for SF81 approval. Existing workspaces can
omit --configs to reuse their saved source directory.
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
function compact({state, reportPath, statusPath}) {
  return {id:state.plan.id, reportPath, statusPath, executionLock:state.executionLock,
    operations:state.operations.map(row => ({id:row.id, state:row.state, integrity:row.integrity,
      buyerStatus:row.result?.summary?.status ?? null, responseFile:row.result?.summary?.responseFile?.status ?? null,
      ...(row.lastError ? {localError:row.lastError.code} : {})}))};
}

export async function main(args = process.argv.slice(2)) {
  const [command, ...tail] = args;
  if (!command || command === '--help' || command === 'help') { process.stdout.write(USAGE); return; }
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
  need(['status','execute','recover','unlock'].includes(command), 'UNKNOWN_COMMAND');
  const opts = options(tail, command === 'execute' ? ['--run','--only'] : command === 'unlock' ? ['--run','--owner-pid'] : ['--run']);
  need(opts['--run'], 'RUN_DIRECTORY_REQUIRED');
  let action;
  if (command === 'unlock') {
    need(/^[1-9][0-9]{0,9}$/.test(opts['--owner-pid'] ?? ''), 'EXACT_OWNER_PID_REQUIRED');
    action = await unlockRunbook(opts['--run'], Number(opts['--owner-pid']));
  } else if (command === 'recover') action = await recoverRunbook(opts['--run']);
  else if (command === 'execute') {
    const controller = new AbortController();
    let interruptedCode;
    const interrupt = () => { interruptedCode ??= 130; controller.abort(); };
    const terminate = () => { interruptedCode ??= 143; controller.abort(); };
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    try {
      action = await executeRunbook(opts['--run'], {only:opts['--only'], signal:controller.signal,
        onProgress:event => process.stderr.write(JSON.stringify(event) + '\n')});
    } finally {
      process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);
      if (interruptedCode) process.exitCode = interruptedCode;
    }
    if (!process.exitCode && action.results.some(result =>
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
