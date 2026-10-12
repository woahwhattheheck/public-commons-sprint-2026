#!/usr/bin/env node
// MIT — Exact-intent operator commands; no automatic scheduling or paid retry.
import { initializeQueue, openQueue, saveQueueReport } from './queue.mjs';
import { need } from './config.mjs';

const print = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
const commands = {init:[], enqueue:['--config'], list:[], show:['--intent'],
  execute:['--intent'], recover:['--intent'], finalize:['--intent','--workspace'], cancel:['--intent'], report:['--out'],
  'inspect-lost-output':['--intent','--workspace','--approved-request'],
  'read-lost-output':['--intent','--workspace'],
  'export-lost-output':['--intent','--workspace','--out'],
  'recover-lost-output':['--intent','--workspace','--transaction','--request-sha','--approved-request'],
  'inspect-missing-receipt':['--intent','--workspace'],
  'read-missing-receipt':['--intent','--workspace'],
  'recover-missing-receipt':['--intent','--workspace','--transaction','--request-sha']};
let signalExit;
async function main(args) {
  if (args[0] === 'review-jobs') {
    const {main: reviewJobs} = await import('./review-jobs/cli.mjs');
    return reviewJobs(args.slice(1));
  }
  if (args[0] === 'library') {
    const {main: resourceLibrary} = await import('./resource-library/cli.mjs');
    return resourceLibrary(args.slice(1));
  }
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Usage: node queue-cli.mjs COMMAND --root /absolute/inbox [OPTION VALUE]\n' +
      'Commands: init | enqueue --config ABS | list | show --intent ID | execute --intent ID [--workspace ABS] | recover --intent ID | finalize --intent ID --workspace ABS [--outbox ABS --merchant-route ID] | cancel --intent ID | report --out ABS [--workspace ABS]\n' +
      'Missing receipt: inspect-missing-receipt | read-missing-receipt | recover-missing-receipt --transaction HASH --request-sha HASH; each requires --intent ID --workspace ABS. Read/recover accept --attempt ID --config-sha HASH --node ABS.\n' +
      'Lost local output: inspect-lost-output --approved-request ABS | read-lost-output | recover-lost-output --transaction HASH --request-sha HASH --approved-request ABS; each requires --intent ID --workspace ABS.\n' +
      'Delivered resources: library --help (search, preview, download and retain analyst reviews).\n' +
      'Customer review jobs: review-jobs --help (source, native request, review, delivery and recovery).\n' +
      'Execute invokes the original SF88 operator approval for one exact intent. An attempted intent is never replayed.\n');
    return;
  }
  const [command, ...rest] = args;
  need(Object.hasOwn(commands, command), 'INBOX_COMMAND_REQUIRED');
  const required = ['--root', ...commands[command]];
  const allowed = [...required, ...(['execute','report'].includes(command) ? ['--workspace'] : []),
    ...(command === 'finalize' ? ['--outbox','--merchant-route'] : []),
    ...(['read-missing-receipt','recover-missing-receipt','read-lost-output','recover-lost-output'].includes(command)?['--attempt','--config-sha','--node']:[]),
    ...(['read-missing-receipt','read-lost-output'].includes(command)?['--request-sha']:[])], flags = new Map();
  need(rest.length % 2 === 0 && rest.length >= required.length * 2 &&
    rest.length <= allowed.length * 2, 'INBOX_EXPLICIT_ARGUMENTS_REQUIRED');
  for (let i=0; i<rest.length; i+=2) {
    need(allowed.includes(rest[i]) && !flags.has(rest[i]) && typeof rest[i+1] === 'string', 'INBOX_ARGUMENT_INVALID');
    flags.set(rest[i], rest[i+1]);
  }
  need(required.every(flag => flags.has(flag)), 'INBOX_EXPLICIT_ARGUMENTS_REQUIRED');
  if (command === 'init') return print(await initializeQueue(flags.get('--root')));
  const queue = await openQueue(flags.get('--root'));
  if (command === 'enqueue') return print(await queue.enqueue(flags.get('--config')));
  if (command === 'list') return print(await queue.list());
  if (command === 'show') return print(await queue.show(flags.get('--intent')));
  if (command === 'recover') return print(await queue.recover(flags.get('--intent')));
  if (command === 'cancel') return print(await queue.cancel(flags.get('--intent')));
  if (command === 'inspect-lost-output') {
    const {inspectLostOutputAttempt}=await import('./lost-output.mjs');
    return print(await inspectLostOutputAttempt({root:queue.root,intentId:flags.get('--intent'),
      workspace:flags.get('--workspace'),approvedRequestFile:flags.get('--approved-request')}));
  }
  if (command === 'inspect-missing-receipt') {
    const {inspectMissingReceiptAttempt}=await import('./missing-receipt.mjs');
    return print(await inspectMissingReceiptAttempt({root:queue.root,intentId:flags.get('--intent'),
      workspace:flags.get('--workspace')}));
  }
  if (command === 'report') {
    const {renderQueueReport} = await import('./queue-report.mjs');
    const {readLostOutputQueueViews} = await import('./lost-output.mjs');
    return print(await saveQueueReport(flags.get('--out'), renderQueueReport({
      jobs:await readLostOutputQueueViews({root:queue.root,workspace:flags.get('--workspace')}),
      queueRoot:queue.root, accountingWorkspace:flags.get('--workspace'),
    })));
  }
  const controller = new AbortController();
  const interrupt = () => { signalExit = 130; controller.abort(); };
  const terminate = () => { signalExit = 143; controller.abort(); };
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
  try {
    let result;
    if(['read-lost-output','recover-lost-output','export-lost-output'].includes(command)) {
      const api=await import('./lost-output.mjs');
      const operation=command==='read-lost-output'?api.readLostOutputRecovery:
        command==='export-lost-output'?api.exportLostOutputProof:api.recoverLostOutput;
      result=await operation({root:queue.root,intentId:flags.get('--intent'),workspace:flags.get('--workspace'),
        transaction:flags.get('--transaction'),expectedRequestSha256:flags.get('--request-sha'),
        approvedRequestFile:flags.get('--approved-request'),output:flags.get('--out'),expectedAttemptId:flags.get('--attempt'),
        expectedConfigSha256:flags.get('--config-sha'),node:flags.get('--node'),signal:controller.signal});
    } else if(['read-missing-receipt','recover-missing-receipt'].includes(command)) {
      const api=await import('./missing-receipt.mjs');
      const operation=command==='read-missing-receipt'?api.readMissingReceiptRecovery:api.recoverMissingReceipt;
      result=await operation({root:queue.root,intentId:flags.get('--intent'),workspace:flags.get('--workspace'),
        transaction:flags.get('--transaction'),expectedRequestSha256:flags.get('--request-sha'),
        expectedAttemptId:flags.get('--attempt'),expectedConfigSha256:flags.get('--config-sha'),
        node:flags.get('--node'),signal:controller.signal});
    } else if(command === 'finalize') {
      const {finalizeQueueIntent}=await import('./finalization.mjs');
      result=await finalizeQueueIntent({root:queue.root,intentId:flags.get('--intent'),
        workspace:flags.get('--workspace'),outbox:flags.get('--outbox'),
        merchantRoute:flags.get('--merchant-route'),signal:controller.signal});
      if(!['FINALIZED','IDEMPOTENT_FINALIZED'].includes(result.finalization?.result?.outcome)||
        result.finalizationView?.status!=='SAVED')process.exitCode=2;
    } else result = await queue.run(flags.get('--intent'), {signal:controller.signal,
      ...(flags.has('--workspace') ? {workspace:flags.get('--workspace')} : {})});
    print(result);
    if (!command.endsWith('-missing-receipt')&&!command.endsWith('-lost-output')&&result?.lastError) process.exitCode = 2;
  } finally {
    process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);
    if (signalExit !== undefined) process.exitCode = signalExit;
  }
}
main(process.argv.slice(2)).catch(error => {
  const code = /^[A-Z0-9_]{1,120}$/.test(error?.code ?? '') ? error.code : 'INBOX_OPERATION_FAILED';
  process.stderr.write(JSON.stringify({error:code, retry:'NO_AUTOMATIC_RETRY'}) + '\n');
  process.exitCode = signalExit ?? 1;
});
