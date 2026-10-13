// MIT. Structured Python application boundary for the original durable dataset APIs.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { need } from '../config.mjs';
import { createDatasetSession, inspectDatasetSession, runDatasetSession,
  recoverDatasetSession, exportDatasetManifest, deliverDatasetSession, accountDatasetSession } from '../dataset-session.mjs';

const mode = 'ORIGINAL_PYTHON_DATASET';
const commands = {
  init:['session','config','workspace','max-pages','max-total-atomic','max-rows','max-page-bytes','snapshot'],
  status:['session'], run:['session'], recover:['session'],
  export:['session','out'], deliver:['session','out'],
  accounting:['session','workspace','offset','limit'],
  finalize:['session','workspace','offset','limit','outbox','merchant-route'],
};
const partial = new Set(['RECONCILIATION_REQUIRED','PAGE_LIMIT_REACHED','TOTAL_CAP_REACHED']);
const print = result => process.stdout.write(JSON.stringify(result) + '\n');
const safeCode = error => /^[A-Z0-9_]{1,120}$/.test(error?.code ?? '')
  ? error.code : 'ORIGINAL_DATASET_OPERATION_FAILED';

function integer(value) {
  if (value === undefined) return undefined;
  need(/^[1-9][0-9]{0,9}$/.test(value), 'DATASET_INTEGER_REQUIRED');
  return Number(value);
}
function offset(value) {
  if(value===undefined)return 0;
  need(/^(0|[1-9][0-9]{0,9})$/.test(value),'DATASET_INTEGER_REQUIRED');
  return Number(value);
}

export async function main(args = process.argv.slice(2)) {
  const command = args[0], allowed = commands[command], options = {};
  need(allowed && args.length % 2 === 1, 'DATASET_COMMAND_INVALID');
  for (let i = 1; i < args.length; i += 2) {
    need(args[i].startsWith('--') && allowed.includes(args[i].slice(2)) &&
      options[args[i].slice(2)] === undefined && args[i+1] && !args[i+1].startsWith('--'),
    'DATASET_OPTION_INVALID');
    options[args[i].slice(2)] = args[i+1];
  }
  need(options.session, 'DATASET_SESSION_REQUIRED');
  let report;
  if (command === 'init') report = await createDatasetSession({
    directory:options.session, configPath:options.config, workspaceDirectory:options.workspace,
    maxPages:integer(options['max-pages']), maxTotalAtomic:options['max-total-atomic'],
    maxRows:integer(options['max-rows']), maxPageBytes:integer(options['max-page-bytes']),
    expectedSnapshot:options.snapshot ?? null,
  });
  if (command === 'status') report = await inspectDatasetSession(options.session);
  if (command === 'recover') report = await recoverDatasetSession(options.session);
  if (command === 'export') report = await exportDatasetManifest(options.session, options.out);
  if (command === 'deliver') report = await deliverDatasetSession(options.session, options.out);
  if (command === 'accounting') report = await accountDatasetSession(options.session,{
    workspace:options.workspace,offset:offset(options.offset),limit:integer(options.limit)});
  if (command === 'run' || command === 'finalize') {
    const controller = new AbortController();
    const interrupt = () => { process.exitCode = 130; controller.abort(); };
    const terminate = () => { process.exitCode = 143; controller.abort(); };
    process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
    try {
      // Keep the ORIGINAL execute function, including its workspace/key preflight.
      // Its existing output option leaves exactly one application JSON envelope.
      report = command === 'finalize' ? await accountDatasetSession(options.session,{
        workspace:options.workspace,offset:offset(options.offset),limit:integer(options.limit),
        finalize:true,signal:controller.signal,outbox:options.outbox,merchantRoute:options['merchant-route']})
        : await runDatasetSession(options.session, {
        signal:controller.signal, emitPageSummaries:false,
      });
    } finally {
      process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);
    }
  }
  print({mode, command, report});
  if (!process.exitCode && partial.has(report.status)) process.exitCode = 2;
  if (!process.exitCode && command==='finalize' && report.entries.some(entry=>
    !['FINALIZED','IDEMPOTENT_FINALIZED','NO_PAYMENT_REQUIRED','NOT_ATTEMPTED'].includes(entry.outcome)))
    process.exitCode=2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => {
    const code = safeCode(error);
    print({mode, error:code,
      ...(typeof error.outputDirectory === 'string' ? {outputDirectory:error.outputDirectory} : {}),
      ...(error.partialWorkPreserved === true ? {partialWorkPreserved:true} : {}),
    });
    process.stderr.write(JSON.stringify({error:code}) + '\n');
    process.exitCode ||= 1;
  });
