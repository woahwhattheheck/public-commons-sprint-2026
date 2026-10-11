// MIT. Python object applications compose the original SF88 object session.
// Native queue attempts, terminal approval, recovery and assembly own all state.
import {constants} from 'node:fs';
import {open, lstat, realpath, link, unlink} from 'node:fs/promises';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {need} from '../config.mjs';
import {openWorkspace} from '../workspace.mjs';
import {selectObjectDescription} from '../object-description.mjs';
import {createObjectSession, inspectObjectSession, runObjectSession,
  recoverObjectSession, assembleObjectSession} from '../object-session.mjs';
import {renderObjectReport} from '../object-report.mjs';

const MODE = 'ORIGINAL_PYTHON_OBJECT';
const common = ['--session','--chunk-offset','--chunk-limit'];
const modes = {
  prepare:['--config','--workspace','--description','--object','--max-total-atomic','--chunk-bytes'],
  'prepare-explicit':['--config','--workspace','--bytes','--chunk-bytes','--snapshot',
    '--sha256','--content-type','--max-total-atomic'],
  inspect:[], run:['--workspace'], recover:[], assemble:['--out'],
  delivery:['--out'], download:['--out','--workspace'], report:['--out','--format'],
};
const safeCode = error => /^[A-Z0-9_]{1,120}$/.test(error?.code ?? '') ? error.code :
  /^[A-Z0-9_]{1,120}$/.test(error?.message ?? '') ? error.message : 'OBJECT_APPLICATION_FAILED';
const print = value => process.stdout.write(JSON.stringify(value) + '\n');

function options(args) {
  const action = args[0], allowed = modes[action], values = Object.create(null);
  need(allowed && args.length % 2 === 1, 'OBJECT_APPLICATION_COMMAND_INVALID');
  for (let index=1; index<args.length; index+=2) {
    const name = args[index], value = args[index+1];
    need([...common,...allowed].includes(name) && !Object.hasOwn(values,name) &&
      typeof value === 'string' && value.length > 0 && !value.startsWith('--'),
    'OBJECT_APPLICATION_OPTION_INVALID');
    values[name] = value;
  }
  need(values['--session'], 'OBJECT_SESSION_REQUIRED');
  return {action,values};
}
function integer(value, fallback, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined && fallback !== undefined) return fallback;
  need(typeof value === 'string' && /^(0|[1-9][0-9]{0,15})$/.test(value) &&
    Number.isSafeInteger(Number(value)) && Number(value) >= minimum && Number(value) <= maximum,
  'OBJECT_APPLICATION_INTEGER_INVALID');
  return Number(value);
}
function compact(report, offset, limit) {
  const {chunks,assemblies,...summary} = report;
  const items = chunks.slice(offset, offset + limit);
  const assemblyOffset = Math.max(0, assemblies.length - 25);
  return {report:summary,
    chunkPage:{offset,limit,total:chunks.length,items,
      nextOffset:offset + items.length < chunks.length ? offset + items.length : null},
    assemblyPage:{offset:assemblyOffset,total:assemblies.length,items:assemblies.slice(assemblyOffset)}};
}
function delivery(report, receipt) {
  need(report.status === 'COMPLETE', 'OBJECT_COMPLETE_SESSION_REQUIRED');
  need(receipt && ['SAVED','RECORDED'].includes(receipt.status) &&
    receipt.sessionId === report.sessionId && receipt.configurationSha256 === report.configurationSha256 &&
    receipt.snapshot === report.expectedSnapshot && receipt.bytes === report.bytes &&
    receipt.sha256 === report.objectSha256, 'OBJECT_ASSEMBLY_BINDING_INVALID');
  return {status:receipt.status, file:{path:receipt.destination,bytes:receipt.bytes,sha256:receipt.sha256},
    assembly:receipt, sessionId:report.sessionId, snapshot:report.expectedSnapshot,
    fileRevalidated:receipt.fileRevalidated === true};
}
async function newDestination(destination) {
  need(typeof destination === 'string' && isAbsolute(destination) &&
    destination === resolve(destination) && !destination.includes('\0'), 'OBJECT_OUTPUT_ABSOLUTE_REQUIRED');
  const parent = dirname(destination), info = await lstat(parent);
  need(info.isDirectory() && !info.isSymbolicLink() && await realpath(parent) === parent &&
    (process.platform === 'win32' || (info.mode & 0o077) === 0 &&
      (typeof process.getuid !== 'function' || info.uid === process.getuid())),
  'OBJECT_OUTPUT_PRIVATE_DIRECTORY_REQUIRED');
  try { await lstat(destination); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  need(false, 'OBJECT_DESTINATION_EXISTS');
}
async function saveReport(destination, bytes) {
  await newDestination(destination);
  const temporary = join(dirname(destination), '.object-report-' + randomUUID());
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL |
    (constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    await link(temporary, destination);
    if (process.platform !== 'win32') {
      const parent = await open(dirname(destination), constants.O_RDONLY);
      try { await parent.sync(); } finally { await parent.close(); }
    }
  } finally { await unlink(temporary).catch(() => {}); }
}

export async function main(args = process.argv.slice(2)) {
  const {action,values:v} = options(args), directory = v['--session'];
  const offset = integer(v['--chunk-offset'],0,0), limit = integer(v['--chunk-limit'],50,1,250);
  const controller = new AbortController();
  const interrupt = () => {process.exitCode=130; controller.abort();};
  const terminate = () => {process.exitCode=143; controller.abort();};
  let report, saved, output;
  if (action === 'prepare' || action === 'prepare-explicit') {
    need(v['--config'] || v['--workspace'], 'OBJECT_CONFIG_OR_WORKSPACE_REQUIRED');
    need(v['--max-total-atomic'], 'OBJECT_TOTAL_BUDGET_REQUIRED');
    // This original open does not read keys or import a signer in review mode.
    const configPath = v['--config'] ?? (await openWorkspace(['--dir',v['--workspace']], {execute:false})).configPath;
    let selected;
    if (action === 'prepare') {
      need(v['--description'] && v['--object'], 'OBJECT_DESCRIPTION_AND_SELECTION_REQUIRED');
      selected = await selectObjectDescription({descriptionPath:v['--description'],objectId:v['--object'],
        configPath,chunkBytes:v['--chunk-bytes'] === undefined ? undefined : integer(v['--chunk-bytes'])});
    } else selected = {bytes:integer(v['--bytes']),chunkBytes:integer(v['--chunk-bytes']),
      expectedSnapshot:v['--snapshot'],expectedSha256:v['--sha256'] ?? null,
      expectedContentType:v['--content-type'] ?? null};
    report = await createObjectSession({directory,configPath,workspace:v['--workspace'] ?? null,
      maxTotalAtomic:v['--max-total-atomic'],...selected});
  } else if (action === 'recover') report = await recoverObjectSession(directory);
  else if (action === 'assemble') {
    need(v['--out'], 'OBJECT_OUTPUT_REQUIRED');
    report = await assembleObjectSession(directory,v['--out']);
    saved = delivery(report,report.assembly);
  } else if (action === 'run' || action === 'download') {
    if (action === 'download') {
      need(v['--out'], 'OBJECT_OUTPUT_REQUIRED');
      report = await inspectObjectSession(directory);
      const previous = report.assemblies.find(value => value.destination === v['--out']);
      if (previous) saved = delivery(report,previous);
      else await newDestination(v['--out']); // Refuse a known bad destination before any request.
    }
    if (!saved) {
      process.once('SIGINT',interrupt); process.once('SIGTERM',terminate);
      try {
        report = await runObjectSession(directory,{signal:controller.signal,
          ...(v['--workspace'] === undefined ? {} : {workspace:v['--workspace']})});
        if (action === 'download' && report.status === 'COMPLETE' && !controller.signal.aborted) {
          report = await assembleObjectSession(directory,v['--out']);
          saved = delivery(report,report.assembly);
        }
      } finally {process.off('SIGINT',interrupt); process.off('SIGTERM',terminate);}
    }
  } else {
    report = await inspectObjectSession(directory);
    if (action === 'delivery') {
      const receipt = v['--out'] === undefined ? report.assembly :
        report.assemblies.find(value => value.destination === v['--out']);
      need(receipt, 'OBJECT_ASSEMBLY_NOT_RECORDED');
      saved = delivery(report,receipt);
    }
    if (action === 'report') {
      need(v['--out'], 'OBJECT_OUTPUT_REQUIRED');
      const format = v['--format'] ?? 'html';
      need(['html','json'].includes(format), 'OBJECT_REPORT_FORMAT_INVALID');
      await saveReport(v['--out'], format === 'html' ? renderObjectReport(report) : JSON.stringify(report,null,2)+'\n');
      output = {path:v['--out'],format,scope:'COMPLETE_ORIGINAL_OBJECT_REPORT'};
    }
  }
  const result = {mode:MODE,action,...compact(report,offset,limit),
    ...(saved ? {delivery:saved} : {}),...(output ? {output} : {})};
  if (!process.exitCode && ['run','download'].includes(action) &&
    ['RECONCILIATION_REQUIRED','INTERRUPTED'].includes(report.status)) process.exitCode=2;
  print(result);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => {process.stderr.write(JSON.stringify({error:safeCode(error)})+'\n'); process.exitCode ||= 1;});
