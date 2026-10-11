#!/usr/bin/env node
// MIT. Complete original SF88 object download, recovery and assembly commands.
import {constants} from 'node:fs';
import {open, lstat, realpath, unlink} from 'node:fs/promises';
import {dirname, isAbsolute, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createObjectSession, inspectObjectSession, runObjectSession,
  recoverObjectSession, assembleObjectSession, accountObjectSession} from './object-session.mjs';
import {selectObjectDescription} from './object-description.mjs';
import {renderObjectReport} from './object-report.mjs';
import {need} from './config.mjs';

const HELP = `Starforge object downloads

init --session ABS --config ABS --description ABS --object ID --max-total-atomic UNITS
     [--chunk-bytes N] [--workspace ABS]
init --session ABS --config ABS --bytes N --chunk-bytes N --snapshot SHA256
     --max-total-atomic UNITS [--sha256 SHA256] [--content-type MIME] [--workspace ABS]
status --session ABS
run --session ABS [--workspace ABS]
recover --session ABS
assemble --session ABS --out ABS
report --session ABS --out ABS
export --session ABS --out ABS
accounting --session ABS [--offset 0] [--limit 100]
finalize --session ABS [--workspace ABS] [--offset 0] [--limit 100]
         [--outbox ABS --merchant-route ABS]

init selects one ORIGINAL SF30 S3 objects.json row, or explicit reviewed object facts.
run uses the original buyer inbox, fresh per-chunk approval and configured spending ledger.
Completed chunks are reused. Previously attempted uncertain chunks are never sent again.
status, recover, assemble, report and export work offline without signing keys.
accounting reads saved native receipts; finalize reconciles original reservations without another purchase.
Accounting ranges are zero-based. Continue range.nextOffset and inspect any unresolved entries.
All destinations are absolute and new. See OBJECTS.md for the complete journey.
`;
const common = ['session'];
function parse(tokens) {
  const [command,...args] = tokens;
  const additions = {
    init:['config','description','object','bytes','chunk-bytes','snapshot','sha256','content-type','max-total-atomic','workspace'],
    status:[], run:['workspace'], recover:[], assemble:['out'], report:['out'], export:['out'],
    accounting:['workspace','offset','limit'], finalize:['workspace','offset','limit','outbox','merchant-route'],
  }[command];
  need(additions !== undefined, 'OBJECT_COMMAND_REQUIRED');
  const allowed = new Set([...common,...additions]), flags = Object.create(null);
  need(args.length % 2 === 0, 'OBJECT_FLAG_VALUE_REQUIRED');
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i].startsWith('--') ? args[i].slice(2) : '';
    need(allowed.has(name) && !Object.hasOwn(flags,name) && args[i+1] &&
      !args[i+1].startsWith('--'), 'OBJECT_FLAG_INVALID_OR_REPEATED');
    flags[name] = args[i+1];
  }
  need(flags.session, 'OBJECT_SESSION_REQUIRED');
  if (['assemble','report','export'].includes(command)) need(flags.out, 'OBJECT_OUTPUT_REQUIRED');
  return {command,flags};
}
function positive(value, optional = false) {
  if (value === undefined && optional) return undefined;
  need(typeof value === 'string' && /^[1-9][0-9]{0,15}$/.test(value) &&
    Number.isSafeInteger(Number(value)), 'OBJECT_POSITIVE_INTEGER_REQUIRED');
  return Number(value);
}
function offset(value) {
  if(value===undefined)return 0;
  need(/^(0|[1-9][0-9]{0,15})$/.test(value)&&Number.isSafeInteger(Number(value)),
    'OBJECT_ACCOUNTING_RANGE_INVALID');
  return Number(value);
}

/** Create-only private report/export. Never overwrite another operator file. */
async function saveNew(destination, content) {
  need(typeof destination === 'string' && isAbsolute(destination) &&
    destination === resolve(destination) && !destination.includes('\0'), 'OBJECT_OUTPUT_ABSOLUTE_REQUIRED');
  const parent = dirname(destination), info = await lstat(parent);
  need(info.isDirectory() && !info.isSymbolicLink() && await realpath(parent) === parent &&
    (process.platform === 'win32' || (info.mode & 0o077) === 0 &&
      (typeof process.getuid !== 'function' || info.uid === process.getuid())), 'OBJECT_OUTPUT_PRIVATE_DIRECTORY_REQUIRED');
  const file = await open(destination, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY |
    (constants.O_NOFOLLOW ?? 0), 0o600);
  let complete = false;
  try { await file.writeFile(content); await file.sync(); complete = true; }
  finally {
    await file.close();
    if (!complete) await unlink(destination).catch(() => {});
  }
}

export async function main(tokens = process.argv.slice(2)) {
  if (tokens.length === 0 || tokens.length === 1 && ['help','--help'].includes(tokens[0])) {
    process.stdout.write(HELP); return;
  }
  const {command,flags:f} = parse(tokens);
  let report;
  if (command === 'init') {
    need(f.config && f['max-total-atomic'], 'OBJECT_CONFIG_AND_TOTAL_CAP_REQUIRED');
    let selected;
    if (f.description !== undefined || f.object !== undefined) {
      need(f.description && f.object && ['bytes','snapshot','sha256','content-type'].every(key => f[key] === undefined),
        'OBJECT_SELECT_DESCRIPTION_OR_EXPLICIT_FACTS');
      selected = await selectObjectDescription({descriptionPath:f.description, objectId:f.object,
        configPath:f.config, chunkBytes:positive(f['chunk-bytes'],true)});
    } else {
      selected = {bytes:positive(f.bytes), chunkBytes:positive(f['chunk-bytes']),
        expectedSnapshot:f.snapshot, expectedSha256:f.sha256 ?? null,
        expectedContentType:f['content-type'] ?? null};
    }
    report = await createObjectSession({directory:f.session,configPath:f.config,
      maxTotalAtomic:f['max-total-atomic'],workspace:f.workspace ?? null,...selected});
  }
  if (command === 'status') report = await inspectObjectSession(f.session);
  if (command === 'recover') report = await recoverObjectSession(f.session);
  if (command === 'accounting') report = await accountObjectSession(f.session,{
    workspace:f.workspace,offset:offset(f.offset),limit:positive(f.limit,true)});
  if (command === 'assemble') report = await assembleObjectSession(f.session,f.out);
  if (command === 'report' || command === 'export') {
    report = await inspectObjectSession(f.session);
    await saveNew(f.out, command === 'report' ? renderObjectReport(report) : JSON.stringify(report,null,2)+'\n');
    report = {...report,output:{path:f.out,kind:command === 'report' ? 'OFFLINE_OBJECT_REPORT' : 'OBJECT_STATE_JSON'}};
  }
  if (command === 'run' || command === 'finalize') {
    const controller = new AbortController();
    let signalExit;
    const interrupt = () => {signalExit = 130; controller.abort();};
    const terminate = () => {signalExit = 143; controller.abort();};
    process.on('SIGINT',interrupt); process.on('SIGTERM',terminate);
    try {
      report = command === 'finalize' ? await accountObjectSession(f.session,{
        workspace:f.workspace,offset:offset(f.offset),limit:positive(f.limit,true),finalize:true,
        signal:controller.signal,outbox:f.outbox,merchantRoute:f['merchant-route']})
        : await runObjectSession(f.session,{signal:controller.signal,
        ...(f.workspace === undefined ? {} : {workspace:f.workspace}),
        onChunk:state => process.stderr.write('Object: '+state.completeChunks+'/'+state.chunkCount+
          ' chunks, '+state.downloadedBytes+' bytes, '+state.status+'\n')});
    } finally {
      process.off('SIGINT',interrupt); process.off('SIGTERM',terminate);
      if (signalExit) process.exitCode = signalExit;
    }
  }
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  if (!process.exitCode && ['RECONCILIATION_REQUIRED','INTERRUPTED'].includes(report.status)) process.exitCode = 2;
  if (!process.exitCode && command==='finalize' && report.entries.some(entry=>
    !['FINALIZED','IDEMPOTENT_FINALIZED','NO_PAYMENT_REQUIRED','NOT_ATTEMPTED'].includes(entry.outcome)))
    process.exitCode=2;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => {
    const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,120}$/.test(error.code)
      ? error.code : 'OBJECT_OPERATION_FAILED';
    process.stderr.write(JSON.stringify({error:code})+'\n');
    process.exitCode ||= 1;
  });
