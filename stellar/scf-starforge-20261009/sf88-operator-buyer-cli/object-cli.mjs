#!/usr/bin/env node
// MIT. Complete original SF88 object download, recovery and assembly commands.
import {constants} from 'node:fs';
import {open, lstat, realpath, unlink} from 'node:fs/promises';
import {dirname, isAbsolute, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
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
init --session ABS --config ABS --delivery-mode whole --bytes N --snapshot SHA256
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
backup-review --state ABS --state-root ABS [--profile ABS]
backup --state ABS --state-root ABS --out NEW_BUNDLE --review SHA256 --quiesced
       [--profile ABS] [--pass-env SF88_BACKUP_PASSPHRASE]
backup-verify --bundle ABS [--expect RECORD_SHA256] [--pass-env NAME] [--python ABS]
backup-restore --bundle ABS [--expect RECORD_SHA256] [--pass-env NAME] [--python ABS]
analysis-review --state ABS --session SAVED_NAME --name SOURCE --format json|csv
                [--analysis-python ABS]
analysis-open --state ABS [--session SAVED_NAME --name SOURCE --format json|csv --review SHA256]
              [--analysis-python ABS]
analysis-status --state ABS [--analysis-python ABS]

init selects one ORIGINAL SF30 S3 objects.json row, or explicit reviewed object facts.
Whole products use one GET without a query, including an empty file; chunks use exact ranges.
run uses the original buyer inbox, fresh per-request approval and configured spending ledger.
Completed responses are reused. Previously attempted uncertain requests are never sent again.
status, recover, assemble, report and export work offline without signing keys.
accounting reads saved native receipts; finalize reconciles original reservations without another purchase.
Accounting ranges are zero-based. Continue range.nextOffset and inspect any unresolved entries.
Workspace backup captures received files, native operators, original journals,
saved parts and completed objects through the existing encrypted recovery engine.
Restore publishes only to the original absent/empty state root and reopens saved
purchase records. Set its separate passphrase environment in this terminal.
All destinations are absolute and new. See OBJECTS.md for the complete journey.
Analysis commands select a saved session NAME inside the Object Buyer workspace.
Review binds its existing recorded file and target source revision. analysis-open
registers that reviewed source, or reopens saved analysis without a source file.
Keep the analysis-open terminal running; Ctrl+C stops its owned original Python
application and preserves saved tables, queries and exports in STATE/analysis.
`;
const common = ['session'];
function parse(tokens) {
  const [command,...args] = tokens;
  const additions = {
    init:['config','description','object','bytes','chunk-bytes','delivery-mode','snapshot','sha256','content-type','max-total-atomic','workspace'],
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
function wholeBytes(value) {
  need(typeof value === 'string' && /^(0|[1-9][0-9]{0,15})$/.test(value) &&
    Number.isSafeInteger(Number(value)), 'OBJECT_WHOLE_BYTE_COUNT_REQUIRED');
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
  if (['backup-review','backup','backup-verify','backup-restore'].includes(tokens[0])) {
    await recoveryCommand(tokens); return;
  }
  if (['analysis-review','analysis-open','analysis-status'].includes(tokens[0])) {
    await analysisCommand(tokens); return;
  }
  const {command,flags:f} = parse(tokens);
  let report;
  if (command === 'init') {
    need(f.config && f['max-total-atomic'], 'OBJECT_CONFIG_AND_TOTAL_CAP_REQUIRED');
    let selected;
    if (f.description !== undefined || f.object !== undefined) {
      need(f.description && f.object && ['bytes','delivery-mode','snapshot','sha256','content-type'].every(key => f[key] === undefined),
        'OBJECT_SELECT_DESCRIPTION_OR_EXPLICIT_FACTS');
      selected = await selectObjectDescription({descriptionPath:f.description, objectId:f.object,
        configPath:f.config, chunkBytes:positive(f['chunk-bytes'],true)});
    } else {
      const deliveryMode = f['delivery-mode'] ?? 'chunks';
      need(['whole','chunks'].includes(deliveryMode), 'OBJECT_DELIVERY_MODE_INVALID');
      selected = {deliveryMode, bytes:deliveryMode === 'whole' ? wholeBytes(f.bytes) : positive(f.bytes),
        chunkBytes:positive(f['chunk-bytes'],deliveryMode === 'whole'),
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
          ' requests, '+state.downloadedBytes+' bytes, '+state.status+'\n')});
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

async function analysisCommand([command,...tokens]) {
  const names = command === 'analysis-status' ? ['state','analysis-python'] :
    ['state','session','name','format','analysis-python', ...(command === 'analysis-open' ? ['review'] : [])];
  need(tokens.length % 2 === 0, 'OBJECT_FLAG_VALUE_REQUIRED');
  const options = {};
  for (let index = 0; index < tokens.length; index += 2) {
    const key = tokens[index].startsWith('--') ? tokens[index].slice(2) : '';
    need(names.includes(key) && !Object.hasOwn(options,key) && tokens[index+1] &&
      !tokens[index+1].startsWith('--'), 'OBJECT_FLAG_INVALID_OR_REPEATED');
    options[key] = tokens[index+1];
  }
  need(options.state, 'OBJECT_WORKSPACE_STATE_REQUIRED');
  const attachment = ['session','name','format','review'].some(key => options[key] !== undefined);
  if (command === 'analysis-review' || command === 'analysis-open' && attachment) {
    need(options.session && options.name && ['json','csv'].includes(options.format), 'OBJECT_ANALYSIS_SOURCE_INVALID');
    if (command === 'analysis-open') need(/^[a-f0-9]{64}$/.test(options.review ?? ''), 'OBJECT_ANALYSIS_REVIEW_REQUIRED');
  }
  const {openObjectWorkspace} = await import('./object-workspace/model.mjs');
  const model = await openObjectWorkspace({stateDirectory:options.state, analysisPython:options['analysis-python'] ?? 'python3'});
  let interrupted = null;
  const stop = code => { interrupted = code; void model.close(); };
  const interrupt = () => stop(130), terminate = () => stop(143);
  process.on('SIGINT',interrupt); process.on('SIGTERM',terminate);
  try {
    if (command === 'analysis-status') {
      process.stdout.write(JSON.stringify(await model.inspectAnalysis(),null,2)+'\n'); return;
    }
    let review;
    if (command === 'analysis-review' || attachment) {
      const current = await model.view({session:options.session});
      review = await model.reviewAnalysis({session:options.session, expectedRevision:current.selected.revision,
        name:options.name, format:options.format});
      if (command === 'analysis-review') { process.stdout.write(JSON.stringify(review,null,2)+'\n'); return; }
      need(review.reviewSha256 === options.review, 'OBJECT_WORKSPACE_REVIEW_CHANGED');
    }
    const actionId = randomUUID();
    model.startAnalysis({kind:review ? 'ATTACH' : 'OPEN',actionId,...(review ? {reviewId:review.reviewId} : {})});
    const result = await model.waitForAnalysisAction(actionId);
    if (interrupted) return;
    const state = model.analysisState();
    process.stdout.write(JSON.stringify({result,...(state.url ? {workspaceId:state.workspaceId,url:state.url} : {})},null,2)+'\n');
    if (result.state !== 'COMPLETED') { process.exitCode = 2; return; }
    process.stderr.write('Keep this terminal open. Ctrl+C stops the original analysis workspace and retains its saved work.\n');
    await model.waitForAnalysis();
  } finally {
    await model.close(); process.off('SIGINT',interrupt); process.off('SIGTERM',terminate);
    if (interrupted) process.exitCode = interrupted;
  }
}

async function recoveryCommand([command,...tokens]) {
  const quiesced=tokens.filter(value=>value==='--quiesced').length;
  need(quiesced<2&&(command==='backup'||quiesced===0),'OBJECT_FLAG_INVALID_OR_REPEATED');
  const args=tokens.filter(value=>value!=='--quiesced');
  const names=command==='backup-review'?['state','state-root','profile']:
    command==='backup'?['state','state-root','profile','out','review','pass-env']:
      ['bundle','expect','pass-env','python'];
  need(args.length%2===0,'OBJECT_FLAG_VALUE_REQUIRED');
  const options={};
  for(let index=0;index<args.length;index+=2) {
    const name=args[index].startsWith('--')?args[index].slice(2):'';
    need(names.includes(name)&&!Object.hasOwn(options,name)&&args[index+1]&&!args[index+1].startsWith('--'),
      'OBJECT_FLAG_INVALID_OR_REPEATED');options[name]=args[index+1];
  }
  const controller=new AbortController();let interrupted,model;
  const interrupt=()=>{interrupted??=130;controller.abort();};
  const terminate=()=>{interrupted??=143;controller.abort();};
  process.on('SIGINT',interrupt);process.on('SIGTERM',terminate);
  const context={signal:controller.signal,onProgress:event=>process.stderr.write(JSON.stringify(event)+'\n')};
  try {
    let result;
    if(command==='backup-review'||command==='backup') {
      need(options.state&&options['state-root'],'OBJECT_RECOVERY_STATE_AND_ROOT_REQUIRED');
      const {openObjectWorkspace}=await import('./object-workspace/model.mjs');
      model=await openObjectWorkspace({stateDirectory:options.state,profilePath:options.profile??null});
      const input={stateRoot:options['state-root'],output:options.out,expectedReviewSha256:options.review,
        passEnv:options['pass-env'],quiesced:quiesced===1};
      result=command==='backup-review'?await model.inspectRecovery(input):await model.snapshotRecovery(input,context);
    } else {
      need(options.bundle,'WORKSPACE_RECOVERY_BUNDLE_REQUIRED');
      const recovery=await import('./object-workspace/recovery.mjs');
      const action=command==='backup-verify'?recovery.verifyObjectWorkspaceRecovery:recovery.restoreObjectWorkspaceRecovery;
      result=await action({bundle:options.bundle,expected:options.expect,
        passEnv:options['pass-env'],python:options.python},context);
    }
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    if(result.reopenError||result.publicationSyncError||result.cleanupErrors?.length||result.selectionRecordError||
      result.leaseReleaseErrors?.length)process.exitCode=2;
  } finally {
    await model?.close();process.off('SIGINT',interrupt);process.off('SIGTERM',terminate);
    if(interrupted)process.exitCode=interrupted;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => {
    const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,120}$/.test(error.code)
      ? error.code : 'OBJECT_OPERATION_FAILED';
    process.stderr.write(JSON.stringify({error:code})+'\n');
    process.exitCode ||= 1;
  });
