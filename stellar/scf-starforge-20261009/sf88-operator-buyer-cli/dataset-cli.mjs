#!/usr/bin/env node
// MIT. Original SF88 paginated dataset acquisition, with per-page operator approval.
import { createDatasetSession, inspectDatasetSession, runDatasetSession,
  recoverDatasetSession, exportDatasetManifest, deliverDatasetSession, accountDatasetSession } from './dataset-session.mjs';
import { InputError, need } from './config.mjs';
import { pathToFileURL } from 'node:url';

const help = [
  'SF88 dataset acquisition',
  '',
  'init --session /private/session --config /private/buyer.json --max-pages 20 --max-total-atomic 20000',
  '     [--max-rows 1000000] [--max-page-bytes 1048576] [--snapshot ORIGINAL_SHA256]',
  '     Use --workspace /private/existing-buyer instead of --config to attach its original operator keys.',
  'status --session /private/session',
  'run --session /private/session [--workspace /private/existing-buyer]',
  'recover --session /private/session',
  'export --session /private/session --out /private/dataset-manifest.json',
  'deliver --session /private/session --out /private/dataset-data-room',
  'accounting --session /private/session [--offset 0] [--limit 100]',
  'finalize --session /private/session [--workspace /private/operator] [--offset 0] [--limit 100]',
  '         [--outbox /private/outbox --merchant-route /private/route.json]',
  '',
  'init, status, recover, export and deliver are offline.',
  'run uses the original SF88 buyer for each new page, including its current quote review and durable reservation.',
  'Completed pages are reused. An incomplete attempted page is never sent again.',
  'accounting reads original saved receipts; finalize reconciles those original reservations without buying again.',
  'Accounting ranges are zero-based; continue from range.nextOffset and review unresolved entries.',
].join('\n') + '\n';
function parse(args) {
  const command = args.shift();
  need(['init','status','run','recover','export','deliver','accounting','finalize'].includes(command), 'DATASET_COMMAND_REQUIRED');
  const allowed = command === 'init'
    ? new Set(['session','config','workspace','max-pages','max-total-atomic','max-rows','max-page-bytes','snapshot'])
    : new Set(['accounting','finalize'].includes(command)
      ? ['session','workspace','offset','limit',...(command==='finalize'?['outbox','merchant-route']:[])]
      : ['export','deliver'].includes(command) ? ['session','out'] : command === 'run' ? ['session','workspace'] : ['session']);
  const flags = {};
  need(args.length % 2 === 0, 'DATASET_FLAG_VALUE_REQUIRED');
  for (let i = 0; i < args.length; i += 2) {
    need(args[i].startsWith('--') && args[i+1] && !args[i+1].startsWith('--'), 'DATASET_FLAG_VALUE_REQUIRED');
    const name = args[i].slice(2);
    need(allowed.has(name) && flags[name] === undefined, 'DATASET_FLAG_INVALID_OR_REPEATED');
    flags[name] = args[i+1];
  }
  need(flags.session, 'DATASET_SESSION_REQUIRED');
  return {command, flags};
}
function number(value, required) {
  if (value === undefined && !required) return undefined;
  need(typeof value === 'string' && /^[1-9][0-9]{0,9}$/.test(value), 'DATASET_INTEGER_REQUIRED');
  return Number(value);
}
function offset(value) {
  if(value===undefined)return 0;
  need(/^(0|[1-9][0-9]{0,9})$/.test(value),'DATASET_INTEGER_REQUIRED');
  return Number(value);
}
export async function main(args = process.argv.slice(2)) {
  if (args.length === 0 || args.length === 1 && ['help','--help'].includes(args[0])) {
    process.stdout.write(help); return;
  }
  const {command, flags:f} = parse([...args]);
  let report;
  if (command === 'init') report = await createDatasetSession({
    directory:f.session, configPath:f.config, workspaceDirectory:f.workspace,
    maxPages:number(f['max-pages'],true),
    maxTotalAtomic:f['max-total-atomic'], maxRows:number(f['max-rows']),
    maxPageBytes:number(f['max-page-bytes']), expectedSnapshot:f.snapshot ?? null,
  });
  if (command === 'status') report = await inspectDatasetSession(f.session);
  if (command === 'recover') report = await recoverDatasetSession(f.session);
  if (command === 'export') report = await exportDatasetManifest(f.session, f.out);
  if (command === 'deliver') report = await deliverDatasetSession(f.session, f.out);
  if (command === 'accounting') report = await accountDatasetSession(f.session,{
    workspace:f.workspace,offset:offset(f.offset),limit:number(f.limit)});
  if (command === 'run' || command === 'finalize') {
    const controller = new AbortController();
    let exit;
    const interrupt = () => { exit = 130; controller.abort(); };
    const terminate = () => { exit = 143; controller.abort(); };
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    try {
      report = command === 'finalize' ? await accountDatasetSession(f.session,{
        workspace:f.workspace,offset:offset(f.offset),limit:number(f.limit),finalize:true,
        signal:controller.signal,outbox:f.outbox,merchantRoute:f['merchant-route']})
        : await runDatasetSession(f.session, {signal:controller.signal, workspace:f.workspace,
        onPage:state => process.stderr.write('Dataset: ' + state.completedPages + ' pages, ' +
          state.acquiredRows + ' rows, ' + state.status + '\n')});
    } finally {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
      if (exit) process.exitCode = exit;
    }
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (!process.exitCode && ['RECONCILIATION_REQUIRED','PAGE_LIMIT_REACHED','TOTAL_CAP_REACHED'].includes(report.status))
    process.exitCode = 2;
  if (!process.exitCode && command==='finalize' && report.entries.some(entry=>
    !['FINALIZED','IDEMPOTENT_FINALIZED','NO_PAYMENT_REQUIRED','NOT_ATTEMPTED'].includes(entry.outcome)))
    process.exitCode=2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => {
    const code = error instanceof InputError ? error.code :
      typeof error?.code === 'string' && /^[A-Z0-9_]{1,120}$/.test(error.code) ? error.code : 'DATASET_OPERATION_FAILED';
    process.stderr.write(JSON.stringify({error:code}) + '\n');
    process.exitCode ||= 1;
  });
