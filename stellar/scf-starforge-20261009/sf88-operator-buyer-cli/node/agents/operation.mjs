// MIT — Framework state points to the original operation; it never owns an attempt.
import { join } from 'node:path';
import { Operation } from '../client.mjs';
import { BuyerError, need, readJson } from '../store.mjs';

const BINDING_SCHEMA = 'stellar-forge.node-agent-binding.v1';
const bindingKeys = ['schema', 'intentId', 'operationDirectory', 'configSha256', 'bodySha256', 'ticketSha256'];
const formats = new Set(['file', 'json', 'text', 'base64', 'csv', 'sse', 'ndjson']);

export function summarizeResult(result) {
  if (!result) return null;
  const saved = result.delivery;
  return {
    intentId: result.record.intentId,
    nativeStatus: result.status ?? null,
    httpStatus: result.native.httpStatus ?? null,
    ok: result.ok,
    exitCode: result.record.exitCode,
    runtimeError: result.record.runtimeError,
    recoveredFromNativeOutput: result.record.recovered,
    recordedAt: result.record.recordedAt,
    deliveryStatus: saved.status,
    file: saved.status === 'SAVED' ? {
      path: saved.path, bytes: saved.bytes, sha256: saved.sha256,
      contentType: saved.contentType ?? null,
    } : saved.partialPath ? {
      path: saved.partialPath, bytes: saved.bytes, sha256: saved.partialSha256,
      contentType: saved.contentType ?? null,
    } : null,
    stream: result.stream,
  };
}

export function summarizeOutcome(outcome) {
  return { binding: outcome.binding, phase: outcome.phase, source: outcome.source,
    operation: outcome.operation, result: summarizeResult(outcome.result) };
}

/** One application-selected immutable Operation, shared by every graph and tool. */
export class BuyerAgent {
  constructor(operation) {
    need(operation instanceof Operation, 'ORIGINAL_NODE_OPERATION_REQUIRED');
    this.operation = operation;
  }

  async binding(expected) {
    // _bound is the maintained SDK's original input/body/ticket validation.
    const { meta } = await this.operation._bound();
    const binding = { schema: BINDING_SCHEMA, intentId: this.operation.intentId,
      operationDirectory: this.operation.directory, configSha256: meta.configSha256,
      bodySha256: meta.bodySha256, ticketSha256: meta.ticketSha256 ?? null };
    if (expected !== undefined && expected !== null)
      need(bindingKeys.every(key => expected[key] === binding[key]), 'AGENT_OPERATION_BINDING_MISMATCH');
    return Object.freeze(binding);
  }

  async review({ binding } = {}) {
    await this.binding(binding);
    const review = await this.operation.review();
    await this.binding(binding);
    return review;
  }

  async savedReview({ binding } = {}) {
    const current = await this.binding(binding);
    let review;
    try { review = await readJson(join(this.operation.directory, 'review.json')); }
    catch (error) {
      if (error.code === 'ENOENT') throw new BuyerError('MATCHING_REVIEW_REQUIRED');
      throw error;
    }
    need(review.intentId === current.intentId && review.configSha256 === current.configSha256 &&
      review.bodySha256 === current.bodySha256 && (review.ticketSha256 ?? null) === current.ticketSha256,
    'MATCHING_REVIEW_REQUIRED');
    return review;
  }

  async recover({ binding } = {}) {
    const current = await this.binding(binding);
    const result = await this.operation.recover();
    const operation = await this.operation.inspect();
    return { binding: current, phase: result ? 'result' :
      operation.state === 'PREPARED' ? 'prepared' : 'awaiting_result',
    source: result ? 'recovered' : 'inspection', operation, result };
  }

  async execute({ review, binding, signal } = {}) {
    // Graph retries, ToolCall retries, and process restarts all enter here.
    // The native attempt marker remains the only concurrency authority.
    const previous = await this.recover({ binding });
    if (previous.phase !== 'prepared') return previous;
    const selectedReview = review ?? await this.savedReview({ binding: previous.binding });
    let result;
    try { result = await this.operation.execute({ review: selectedReview, signal }); }
    catch (error) {
      if (error.code === 'ATTEMPT_ALREADY_RECORDED_USE_RECOVER')
        return this.recover({ binding: previous.binding });
      throw error;
    }
    return { binding: previous.binding, phase: 'result', source: 'executed',
      operation: await this.operation.inspect(), result };
  }

  async read({ format = 'file', limitBytes = 8388608, offset = 0, limitRecords = 100,
    allowPartial = false, maxRecordBytes, maxRecords, headers = true, binding, signal } = {}) {
    need(formats.has(format), 'AGENT_READ_FORMAT_INVALID');
    need(Number.isSafeInteger(limitBytes) && limitBytes >= 0 &&
      Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limitRecords) &&
      limitRecords >= 0 && Number.isSafeInteger(offset + limitRecords), 'AGENT_READ_LIMIT_INVALID');
    need(typeof allowPartial === 'boolean' && typeof headers === 'boolean', 'AGENT_READ_OPTIONS_INVALID');
    const outcome = await this.recover({ binding });
    const result = outcome.result;
    if (!result) throw new BuyerError('RESULT_NOT_AVAILABLE', { operation: this.operation,
      state: outcome.operation.state });
    let data = null, records = null;
    if (format === 'file') await result.verify({ signal });
    else if (format === 'json') data = await result.json({ limit: limitBytes, signal });
    else if (format === 'text' || format === 'base64') {
      const raw = await result.bytes({ limit: limitBytes, signal });
      if (format === 'base64') data = raw.toString('base64');
      else {
        try { data = new TextDecoder('utf-8', { fatal: true }).decode(raw); }
        catch { throw new BuyerError('RESPONSE_TEXT_UTF8_INVALID'); }
      }
    } else {
      const options = { allowPartial, signal,
        ...(maxRecordBytes === undefined ? {} : { maxRecordBytes }),
        ...(maxRecords === undefined ? {} : { maxRecords }) };
      const source = format === 'sse' ? result.events(options) : format === 'ndjson'
        ? result.ndjson(options) : result.csvRows({ headers, signal });
      data = []; let total = 0, retainedBytes = 0;
      // Exhaust the original verified iterator before publishing selected records.
      // Paging limits retained application data, never digest verification.
      for await (const record of source) {
        if (total >= offset && data.length < limitRecords) {
          retainedBytes += Buffer.byteLength(JSON.stringify(record), 'utf8');
          need(retainedBytes <= limitBytes, 'AGENT_RECORD_SELECTION_LIMIT');
          data.push(record);
        }
        total += 1;
      }
      records = { total, offset, returned: data.length,
        nextOffset: offset + data.length < total ? offset + data.length : null };
    }
    return { schema: 'stellar-forge.node-agent-artifact.v1', binding: outcome.binding,
      result: summarizeResult(result), format, partial: result.delivery.status !== 'SAVED',
      records, data };
  }

  async saveAs(destination, { binding, signal } = {}) {
    const outcome = await this.recover({ binding });
    if (!outcome.result) throw new BuyerError('RESULT_NOT_AVAILABLE', { operation: this.operation });
    return outcome.result.saveAs(destination, { signal });
  }
}
