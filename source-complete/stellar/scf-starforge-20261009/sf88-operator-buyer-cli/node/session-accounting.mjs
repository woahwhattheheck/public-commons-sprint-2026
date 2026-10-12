// MIT. Customer continuation of original session accounting, never another ledger.
import { mkdtemp, readdir, open, link, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { absolute, privateDirectory, digest, now, object, need, BuyerError,
  jsonBytes, readJson, writeJson, exists, syncDirectory, safeCode } from './store.mjs';

const SCHEMA = 'stellar-forge.node-session-accounting-command.v1';
const NATIVE = 'stellar-forge.sf88.session-accounting.v1';
const COMMAND = /^(accounting|finalize)-[A-Za-z0-9]{6}$/;
const freeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const clone = value => JSON.parse(jsonBytes(value));
const same = (left, right) => jsonBytes(left).equals(jsonBytes(right));
const unknownProcess = () => ({exitCode:null, exitSignal:null, errorCode:'PROCESS_EXIT_NOT_RECORDED'});

export function accountingOptions({workspaceDirectory, offset = 0, limit = 100, signal,
  outboxDirectory, merchantRoute} = {}, finalize = false) {
  need(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) &&
    limit >= 1 && limit <= 250, 'SESSION_ACCOUNTING_RANGE_INVALID');
  need(signal === undefined || signal instanceof AbortSignal, 'INVALID_ABORT_SIGNAL');
  need(finalize || outboxDirectory === undefined && merchantRoute === undefined,
    'ACCOUNTING_VIEW_HAS_NO_OUTBOX');
  need((outboxDirectory !== undefined) === (merchantRoute !== undefined),
    'OUTBOX_AND_ORIGINAL_MERCHANT_ROUTE_REQUIRED_TOGETHER');
  if (merchantRoute !== undefined) need(typeof merchantRoute === 'string' &&
    /^[A-Za-z0-9._:-]{1,160}$/.test(merchantRoute), 'ACCOUNTING_MERCHANT_ROUTE_INVALID');
  return {offset, limit, signal,
    workspaceDirectory:workspaceDirectory === undefined ? null : absolute(workspaceDirectory),
    outboxDirectory:outboxDirectory === undefined ? null : absolute(outboxDirectory),
    merchantRoute:merchantRoute ?? null};
}

function nativeRecord(context, output) {
  const native = context.identity.kind === 'object' ? output?.report : output?.result;
  if (context.identity.kind === 'object') need(output?.mode === 'ORIGINAL_PYTHON_OBJECT' &&
    output.action === context.action, 'SESSION_ACCOUNTING_NATIVE_RESULT_INVALID');
  else need(output?.schema === 'stellar-forge.node-dataset-command.v1' &&
    output.id === context.identity.id && output.command === context.action,
  'SESSION_ACCOUNTING_NATIVE_RESULT_INVALID');
  const identity = context.identity, range = native?.range, request = context.request;
  need(native?.schema === NATIVE && native.kind === identity.kind &&
    native.directory === identity.sessionDirectory && native.sessionId === identity.sessionId &&
    native.configurationSha256 === identity.configurationSha256 &&
    native.mode === (context.action === 'finalize' ? 'FINALIZE' : 'VIEW') &&
    (request.workspaceDirectory === null || native.workspace === request.workspaceDirectory) &&
    (identity.workspace === null || native.workspace === identity.workspace) &&
    object(range) && range.offset === request.offset && range.limit === request.limit &&
    Number.isSafeInteger(range.total) && range.total >= range.offset &&
    Array.isArray(native.entries) && native.entries.length <= range.limit &&
    native.entries.length <= range.total - range.offset && typeof native.interrupted === 'boolean',
  'SESSION_ACCOUNTING_BINDING_CHANGED');
  const next = range.offset + native.entries.length;
  need(range.nextOffset === (next < range.total ? next : null) &&
    native.entries.every((entry, index) => object(entry) &&
      entry.index === range.offset + index + (identity.kind === 'dataset' ? 1 : 0) &&
      typeof entry.outcome === 'string'), 'SESSION_ACCOUNTING_RANGE_CHANGED');
  return {native:clone(native), record:clone(output)};
}

function commandResult(context, output, process, extra = {}) {
  return {...nativeRecord(context, output), process:clone(process), commandId:context.commandId,
    commandDirectory:context.commandDirectory, startedAt:context.startedAt, ...extra};
}

/** Retain the exact native output even if the calling process dies before its reply. */
export async function runAccounting(target, identity, action, options, {outputFile, invoke,
  resultLimit = target.buyer.datasetReportLimit}) {
  need(['accounting','finalize'].includes(action), 'SESSION_ACCOUNTING_ACTION_INVALID');
  need(!options.signal?.aborted, 'OPERATION_ABORTED_BEFORE_START');
  const parent = await privateDirectory(join(target.directory, 'commands'));
  const directory = await mkdtemp(join(parent, action + '-'));
  const {signal, ...request} = options;
  const context = {schema:SCHEMA, identity, action, request, startedAt:now(),
    commandId:basename(directory), commandDirectory:directory, outputFile,
    resultLimit};
  await writeJson(join(directory, 'context.json'), context, {exclusive:true});
  // Persist the named command entry before its original financial action starts.
  await syncDirectory(parent);
  let run;
  try { run = await invoke({directory, signal, resultFile:join(directory, outputFile)}); }
  catch (error) {
    run = {output:null, exitCode:null, exitSignal:null,
      errorCode:safeCode(error.code, 'ACCOUNTING_PROCESS_RESULT_UNAVAILABLE')};
  }
  const process = {exitCode:run.exitCode, exitSignal:run.exitSignal, errorCode:run.errorCode};
  let result = null;
  try { if (run.output) result = commandResult(context, run.output, process); }
  catch (error) { process.errorCode = error.code; }
  let viewStatus = 'SAVED';
  try {
    await writeJson(join(directory, 'completion.json'), {schema:SCHEMA,
      contextSha256:digest(jsonBytes(context)), completedAt:now(), process,
      output:result ? run.output : null}, {exclusive:true});
    if (result) await writeJson(join(target.directory, 'last-accounting.json'),
      {completedAt:now(), ...result});
  } catch { viewStatus = 'SAVE_FAILED'; }
  if (!result) throw new BuyerError(process.errorCode ?? 'SESSION_ACCOUNTING_NATIVE_RESULT_UNAVAILABLE',
    {commandId:context.commandId, commandDirectory:directory, exitCode:process.exitCode,
      ...(identity.kind === 'object' ? {acquisition:target} : {dataset:target})});
  const returned = freeze({...result, viewStatus});
  target.lastAccounting = returned;
  return returned;
}

async function readCommand(target, identity, name) {
  need(COMMAND.test(name), 'SESSION_ACCOUNTING_COMMAND_ID_INVALID');
  const directory = join(target.directory, 'commands', name);
  await privateDirectory(directory, {create:false});
  const context = await readJson(join(directory, 'context.json'));
  need(context.schema === SCHEMA && context.commandId === name &&
    context.commandDirectory === directory && same(context.identity, identity) &&
    ['accounting','finalize'].includes(context.action) && name.startsWith(context.action + '-') &&
    ['stdout.json','native.json'].includes(context.outputFile) &&
    Number.isSafeInteger(context.resultLimit) && context.resultLimit > 0 &&
    context.resultLimit <= 268435456 && Number.isFinite(Date.parse(context.startedAt)),
  'SESSION_ACCOUNTING_COMMAND_BINDING_CHANGED');
  const request = accountingOptions({...context.request,
    workspaceDirectory:context.request.workspaceDirectory ?? undefined,
    outboxDirectory:context.request.outboxDirectory ?? undefined,
    merchantRoute:context.request.merchantRoute ?? undefined}, context.action === 'finalize');
  delete request.signal;
  need(same(context.request, request), 'SESSION_ACCOUNTING_COMMAND_BINDING_CHANGED');
  let process = unknownProcess(), result = null, status = 'NO_COMPLETE_OUTPUT';
  const completionPath = join(directory, 'completion.json');
  if (await exists(completionPath)) {
    const completed = await readJson(completionPath, context.resultLimit + 65536);
    need(completed.schema === SCHEMA && completed.contextSha256 === digest(jsonBytes(context)) &&
      object(completed.process), 'SESSION_ACCOUNTING_COMPLETION_CHANGED');
    process = completed.process;
    if (completed.output) {
      result = commandResult(context, completed.output, process, {viewStatus:'SAVED', recovered:false});
      status = 'RECORDED';
    }
  }
  if (!result) {
    try {
      const output = await readJson(join(directory, context.outputFile), context.resultLimit);
      result = commandResult(context, output, process, {viewStatus:'RECOVERED_NATIVE_OUTPUT', recovered:true});
      status = 'OUTPUT_RECOVERED';
    } catch (error) {
      if (!['ENOENT','JSON_INVALID','JSON_OBJECT_REQUIRED','FILE_SIZE_OR_TYPE_INVALID'].includes(error.code)) throw error;
    }
  }
  return {commandId:name, commandDirectory:directory, action:context.action,
    startedAt:context.startedAt, status, process, result};
}

/** Local read only: no process, provider request, finalizer or buyer is started. */
export async function recoverAccounting(target, identity, {commandId} = {}) {
  const parent = join(target.directory, 'commands');
  if (!await exists(parent)) return null;
  await privateDirectory(parent, {create:false});
  if (commandId !== undefined) {
    const selected = await readCommand(target, identity, commandId);
    return freeze({...selected, lastComplete:selected.result});
  }
  const candidates = [];
  for (const item of await readdir(parent, {withFileTypes:true})) {
    if (!item.isDirectory() || !COMMAND.test(item.name) ||
      !await exists(join(parent, item.name, 'context.json'))) continue;
    const context = await readJson(join(parent, item.name, 'context.json'));
    need(typeof context.startedAt === 'string', 'SESSION_ACCOUNTING_COMMAND_BINDING_CHANGED');
    candidates.push({name:item.name, startedAt:context.startedAt});
  }
  candidates.sort((a,b) => b.startedAt.localeCompare(a.startedAt) || b.name.localeCompare(a.name));
  if (!candidates.length) return null;
  const latest = await readCommand(target, identity, candidates[0].name);
  let lastComplete = latest.result;
  // Read only as far back as the latest complete original response, not every
  // historical report into memory when an application reopens its account.
  for (let index = 1; !lastComplete && index < candidates.length; index++)
    lastComplete = (await readCommand(target, identity, candidates[index].name)).result;
  // A later interrupted command cannot erase the earlier original response.
  return freeze({...latest, lastComplete});
}

/** Yield each unchanged native range; a caller break or cancellation starts no next range. */
export async function* accountingPages(target, options = {}, finalize = false) {
  const selected = accountingOptions(options, finalize);
  const identity = await target._accountingIdentity();
  let offset = selected.offset, total = null;
  while (true) {
    need(!selected.signal?.aborted, 'OPERATION_ABORTED_BEFORE_START');
    need(same(identity, await target._accountingIdentity()), 'SESSION_ACCOUNTING_BINDING_CHANGED');
    const input = {offset, limit:selected.limit, signal:selected.signal,
      ...(selected.workspaceDirectory === null ? {} : {workspaceDirectory:selected.workspaceDirectory}),
      ...(selected.outboxDirectory === null ? {} : {outboxDirectory:selected.outboxDirectory, merchantRoute:selected.merchantRoute})};
    const result = await target[finalize ? 'finalize' : 'accounting'](input);
    need(result.native.sessionId === identity.sessionId &&
      result.native.configurationSha256 === identity.configurationSha256 &&
      result.native.directory === identity.sessionDirectory, 'SESSION_ACCOUNTING_BINDING_CHANGED');
    total ??= result.native.range.total;
    yield result;
    if (result.native.range.total !== total) throw new BuyerError('ACCOUNTING_SESSION_LENGTH_CHANGED',
      {lastResult:result, nextOffset:result.native.range.nextOffset});
    if (result.native.interrupted || result.process.errorCode || ![0,2].includes(result.process.exitCode) ||
      selected.signal?.aborted || result.native.range.nextOffset === null) return;
    need(result.native.range.nextOffset > offset, 'SESSION_ACCOUNTING_RANGE_DID_NOT_ADVANCE');
    offset = result.native.range.nextOffset;
  }
}

/** Stream complete original VIEW ranges to a new private JSONL file. */
export async function exportAccounting(target, destination, options = {}) {
  need(options.offset === undefined || options.offset === 0, 'ACCOUNTING_EXPORT_REQUIRES_FIRST_RANGE');
  accountingOptions(options);
  destination = absolute(destination);
  const parent = await privateDirectory(dirname(destination), {create:false});
  need(!await exists(destination), 'ACCOUNTING_EXPORT_DESTINATION_EXISTS');
  const temporary = join(parent, '.accounting-export-' + randomUUID());
  const handle = await open(temporary, 'wx', 0o600);
  const hash = createHash('sha256');
  let bytes = 0, entries = 0, ranges = 0, last = null, closed = false, published = false;
  try {
    for await (const result of accountingPages(target, {...options, offset:0})) {
      const chunk = Buffer.from(JSON.stringify(result.native) + '\n');
      await handle.writeFile(chunk); hash.update(chunk);
      bytes += chunk.length; entries += result.native.entries.length; ranges++; last = result;
    }
    need(last && last.native.range.nextOffset === null && !last.native.interrupted &&
      !last.process.errorCode && last.process.exitCode === 0 && !options.signal?.aborted,
    'ACCOUNTING_EXPORT_INCOMPLETE');
    await handle.sync(); await handle.close(); closed = true;
    await link(temporary, destination); published = true;
    await syncDirectory(parent); await unlink(temporary); await syncDirectory(parent);
    return freeze({path:destination, bytes, sha256:hash.digest('hex'), ranges, entries,
      kind:last.native.kind, sessionId:last.native.sessionId,
      configurationSha256:last.native.configurationSha256, format:'jsonl', scope:'COMPLETE_ORIGINAL_ACCOUNTING_VIEW'});
  } catch (error) {
    throw new BuyerError(safeCode(error.code, 'ACCOUNTING_EXPORT_FAILED'),
      {partialPath:temporary, destination, destinationPublished:published,
        nextOffset:last?.native.range.nextOffset ?? 0, lastResult:last});
  } finally { if (!closed) await handle.close(); }
}
