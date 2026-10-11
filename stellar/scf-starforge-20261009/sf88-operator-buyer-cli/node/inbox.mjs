// MIT — Node customer workflow on the original durable, exact-intent inbox.
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BuyerResult, VerifiedFile } from './result.mjs';
import { absolute, intent, digest, object, need, BuyerError, safeCode, now,
  readJson, writeJson, syncDirectory } from './store.mjs';

const SCHEMA = 'stellar-forge.node-buyer-inbox-command.v1';
const INBOX = 'stellar-forge.sf88.buyer-inbox.v1';
const worker = fileURLToPath(new URL('./inbox-worker.mjs', import.meta.url));
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

export class InboxResult {
  constructor(run, commandDirectory) {
    this.native = freeze(structuredClone(run.output?.native ?? null));
    this.process = Object.freeze({ exitCode:run.exitCode ?? null,
      exitSignal:run.exitSignal ?? null, errorCode:run.errorCode ?? run.output?.error ?? null });
    this.commandDirectory = commandDirectory;
    Object.freeze(this);
  }
}

export class InboxError extends BuyerError {
  constructor(code, result, details = {}) {
    super(code, { result, ...details });
    this.name = 'InboxError';
  }
}

async function command(buyer, commandName, input, {signal} = {}) {
  need(signal === undefined || signal instanceof AbortSignal, 'INVALID_ABORT_SIGNAL');
  need(!signal?.aborted, 'OPERATION_ABORTED_BEFORE_START');
  await buyer.ready();
  const directory = await mkdtemp(join(buyer.stateDirectory, '.inbox-command-'));
  const inputFile = join(directory, 'request.json'), resultFile = join(directory, 'native.json');
  let run;
  try {
    await writeJson(inputFile, { schema:SCHEMA, command:commandName, ...input }, { exclusive:true });
    await syncDirectory(buyer.stateDirectory);
    run = await buyer.runtime.run([buyer.runtime.directory, inputFile, resultFile], {
      directory, signal, entryFile:worker, resultFile, resultLimit:buyer.inboxReportLimit,
    });
    const output = run.output;
    need(object(output) && output.schema === SCHEMA && output.command === commandName &&
      output.root === (input.root ?? null), 'INBOX_NATIVE_RESULT_UNAVAILABLE');
    if (output.error) throw new BuyerError(output.error);
    need(object(output.native), 'INBOX_NATIVE_RESULT_INVALID');
    if (input.intentId) need(output.native.schema === INBOX &&
      output.native.operation?.intentId === input.intentId, 'INBOX_NATIVE_INTENT_MISMATCH');
    if (run.errorCode || run.exitSignal || ![0,2].includes(run.exitCode))
      throw new BuyerError(run.errorCode ?? 'INBOX_NATIVE_COMMAND_FAILED');
    let retained = null;
    try { await rm(directory, { recursive:true, force:true }); }
    catch { retained = directory; }
    // Cleanup cannot turn a known native completion into an uncertain action.
    const result = new InboxResult(run, retained);
    return { result, responseFile:output.responseFile };
  } catch (problem) {
    const result = new InboxResult(run ?? { errorCode:safeCode(problem?.code, 'INBOX_NATIVE_COMMAND_FAILED') }, directory);
    throw new InboxError(safeCode(problem?.code, 'INBOX_NATIVE_COMMAND_FAILED'), result,
      { commandDirectory:directory, ...(input.intentId ? {intentId:input.intentId} : {}),
        ...(input.root ? {inboxDirectory:input.root} : {}) });
  }
}

/** Inspect the complete private merchant packet with the installed native reader. */
export async function inspectOperationHandoff(buyer, file, {accept, signal} = {}) {
  if (accept !== undefined) need(Number.isSafeInteger(accept) && accept >= 0, 'EXPLICIT_SELECTION_INDEX_REQUIRED');
  const {result} = await command(buyer, 'inspect-packet', {file:absolute(file),
    ...(accept === undefined ? {} : {accept})}, {signal});
  need(Array.isArray(result.native.choices) && typeof result.native.intentId === 'string', 'INBOX_PACKET_VIEW_INVALID');
  return result.native;
}

export async function createInbox(buyer, {directory, signal}) {
  const inbox = new Inbox(buyer, directory);
  await inbox._command('create', {}, {signal});
  return inbox;
}

export class Inbox {
  constructor(buyer, directory) {
    this.buyer = buyer;
    this.directory = absolute(directory);
  }
  _command(name, input = {}, options = {}) {
    return command(this.buyer, name, { root:this.directory, ...input }, options).then(value => value.result);
  }
  list(options) { return this._command('list', {}, options); }
  show(intentId, options) { return this._command('show', {intentId:intent(intentId)}, options); }

  async enqueue(operation, options) {
    need(operation?.buyer === this.buyer && typeof operation._bound === 'function', 'SAME_BUYER_OPERATION_REQUIRED');
    await this._command('open', {}, options);
    const {meta} = await operation._bound();
    const binding = {schema:'stellar-forge.node-buyer.v1', intentId:operation.intentId,
      state:'INBOX_DELEGATED', kind:'INBOX_DELEGATED', inboxDirectory:this.directory,
      configSha256:meta.configSha256, bodySha256:meta.bodySha256,
      ticketSha256:meta.ticketSha256 ?? null, createdAt:now(), retry:'NO_AUTOMATIC_RETRY'};
    const attemptFile = join(operation.directory, 'attempt.json');
    try { await writeJson(attemptFile, binding, {exclusive:true}); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const saved = await readJson(attemptFile);
      need(['schema','intentId','kind','inboxDirectory','configSha256','bodySha256','ticketSha256']
        .every(key => saved[key] === binding[key]), 'OPERATION_ALREADY_ASSIGNED_OR_ATTEMPTED');
    }
    // This immutable routing marker precedes native intake. Repeating only the
    // SAME intake is safe after a crash; native enqueue owns identical-intent checks.
    return this._command('enqueue', { configFile:operation.configPath,
      expectedConfigSha256:meta.configSha256, expectedBodySha256:meta.bodySha256,
      expectedTicketSha256:meta.ticketSha256 ?? null }, options);
  }

  enqueueConfig(configFile, options) {
    return this._command('enqueue', {configFile:absolute(configFile)}, options);
  }

  async review(intentId, {signal} = {}) {
    intentId = intent(intentId);
    const before = (await this.show(intentId, {signal})).native;
    const native = await this.buyer.runtime.checked(['--review', '--config',
      join(this.directory, 'jobs', before.id, 'execution.json')], {
      stateDirectory:this.buyer.stateDirectory, mode:'OFFLINE_REVIEW', signal,
    });
    const after = (await this.show(intentId, {signal})).native;
    need(before.configSha256 === after.configSha256 && before.bodySha256 === after.bodySha256 &&
      (before.operationTicket?.sha256 ?? null) === (after.operationTicket?.sha256 ?? null) &&
      native.intentId === intentId && native.bodySha256 === (after.bodySha256 ?? digest(Buffer.alloc(0))) &&
      (native.operationTicket?.sha256 ?? null) === (after.operationTicket?.sha256 ?? null), 'INBOX_REVIEW_BINDING_MISMATCH');
    return freeze({root:this.directory, intentId, configSha256:after.configSha256,
      bodySha256:after.bodySha256, ticketSha256:after.operationTicket?.sha256 ?? null,
      reviewedAt:now(), native});
  }

  execute(intentId, {review, workspaceDirectory, signal} = {}) {
    intentId = intent(intentId);
    need(review?.root === this.directory && review.intentId === intentId, 'MATCHING_INBOX_REVIEW_REQUIRED');
    const pins = Object.fromEntries(['root','intentId','configSha256','bodySha256','ticketSha256']
      .map(key => [key, review[key]]));
    return this._command('execute', {intentId, review:pins,
      ...(workspaceDirectory === undefined ? {} : {workspaceDirectory:absolute(workspaceDirectory)})}, {signal});
  }
  cancel(intentId, options) { return this._command('cancel', {intentId:intent(intentId)}, options); }
  recover(intentId, options) { return this._command('recover', {intentId:intent(intentId)}, options); }
  finalize(intentId, {workspaceDirectory, outboxDirectory, merchantRoute, signal} = {}) {
    return this._command('finalize', {intentId:intent(intentId), workspaceDirectory:absolute(workspaceDirectory),
      ...(outboxDirectory === undefined ? {} : {outboxDirectory:absolute(outboxDirectory)}),
      ...(merchantRoute === undefined ? {} : {merchantRoute})}, {signal});
  }
  exportReport(destination, {workspaceDirectory, signal} = {}) {
    return this._command('report', {destination:absolute(destination),
      ...(workspaceDirectory === undefined ? {} : {workspaceDirectory:absolute(workspaceDirectory)})}, {signal});
  }
  async response(intentId, {signal} = {}) {
    const {result, responseFile} = await command(this.buyer, 'response', {
      root:this.directory, intentId:intent(intentId)}, {signal});
    const job = result.native;
    if (!job.outcome || !responseFile) return null;
    need(job.outcome.mode === 'ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT' &&
      job.outcome.intentId === intentId && responseFile.destination === job.responseDestination,
    'INBOX_RESPONSE_BINDING_MISMATCH');
    return new InboxResponse(job, responseFile, this.buyer.runtime.directory);
  }
}

/** Saved native response bytes. A current inbox read is not an old process exit. */
export class InboxResponse extends VerifiedFile {
  constructor(job, responseFile, runtimeDirectory) {
    super();
    this.job = freeze(structuredClone(job));
    this.responseFile = freeze(structuredClone(responseFile));
    this.runtimeDirectory = absolute(runtimeDirectory);
  }
  get native() { return this.job.outcome; }
  get status() { return this.native.status; }
  get delivery() { return this.native.responseFile ?? {status:'NOT_REQUESTED'}; }
  get stream() { return this.delivery.stream ?? null; }
  // Reuse the shipped response pin checks and original SF31 stream codec without
  // constructing an invented BuyerResult record or duplicating its parser.
  _metadata() { return BuyerResult.prototype._metadata.call(this); }
  _records(format, options) { return BuyerResult.prototype._records.call(this, format, options); }
  events(options) { return BuyerResult.prototype.events.call(this, options); }
  ndjson(options) { return BuyerResult.prototype.ndjson.call(this, options); }
}
