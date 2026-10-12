// MIT. Original SF98 signed notices into the original accounting workspace.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { openOutbox, SCHEMA as EVENT_SCHEMA } from '../../sf98-merchant-delivery/outbox.mjs';
import { nativeWebhookPayload } from '../../sf98-merchant-delivery/deliver.mjs';
import { privateDirectory } from '../../sf98-merchant-delivery/destinations/storage.mjs';
import { WorkspaceError } from '../workspace/store.mjs';

export const DELIVERY_SCHEMA = 'stellar-forge.accounting-delivery.v1';
export const SIGNED_NOTICE_PATH = '/sf98/accounting-events';
export const NOTICE_BYTES = 8192;
const HEX = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ENV = /^[A-Z][A-Z0-9_]{1,64}$/;
const digest = value => createHash('sha256').update(value).digest('hex');
const clone = value => structuredClone(value);
const encoded = value => JSON.stringify(value);
const need = (ok, code, message, status = 400) => {
  if (!ok) throw new WorkspaceError(code, message, status);
};
const field = (value, label, max = 160) => {
  need(typeof value === 'string' && value.trim() && value.length <= max &&
    !/[\x00-\x1f\x7f]/.test(value), 'INVALID_DELIVERY_FIELD', 'Check ' + label + '.');
  return value.trim();
};
const hex = value => typeof value === 'string' && HEX.test(value);
function selection(workspace) {
  return {
    sources: clone(workspace.state.sources),
    termsSelection: workspace.state.termsSelection,
    proofIds: workspace.state.proofs.filter(row => row.included).map(row => row.id).sort(),
    periodSelection: clone(workspace.state.periodSelection),
    period: workspace.periods.selection(),
  };
}
export function oneNoticeHeader(headers, name) {
  const values = [];
  if (Array.isArray(headers)) {
    need(headers.length % 2 === 0, 'INVALID_NOTICE_HEADERS', 'The signed request headers are incomplete.', 400);
    for (let index = 0; index < headers.length; index += 2)
      if (String(headers[index]).toLowerCase() === name.toLowerCase()) values.push(headers[index + 1]);
  } else if (headers && typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers))
      if (key.toLowerCase() === name.toLowerCase()) values.push(...(Array.isArray(value) ? value : [value]));
  }
  return values.length === 1 && typeof values[0] === 'string' ? values[0] : null;
}

export class AccountingDeliveryWorkspace {
  constructor(workspace, { secretEnv, environment = process.env, clock = Date.now } = {}) {
    need(secretEnv === undefined || typeof secretEnv === 'string' && ENV.test(secretEnv),
      'INVALID_DELIVERY_SECRET_ENV', 'Choose an existing uppercase signing-key environment name.');
    this.workspace = workspace;
    this.secretEnv = secretEnv ?? null;
    this.environment = environment;
    this.clock = clock;
  }
  async init() {
    return this.workspace.serial(async () => {
      if (this.workspace.state.accountingDeliveries === undefined) {
        this.workspace.state.accountingDeliveries = { schema: DELIVERY_SCHEMA, notices: [], captures: [] };
        await this.workspace.commit('accounting_delivery_enabled', 'workspace startup');
      }
      const data = this.data();
      need(data.schema === DELIVERY_SCHEMA && Array.isArray(data.notices) && Array.isArray(data.captures),
        'INVALID_ACCOUNTING_DELIVERY_STATE', 'The retained delivery workspace has an unsupported format.', 409);
      need(new Set(data.notices.map(row => row.eventId)).size === data.notices.length &&
        new Set(data.captures.map(row => row.requestId)).size === data.captures.length,
        'CONFLICTING_ACCOUNTING_DELIVERY_STATE', 'The retained delivery identities conflict.', 409);
      return this.view();
    });
  }
  data() {
    this.workspace.lease.assertHeld();
    return this.workspace.state.accountingDeliveries;
  }
  secret() {
    const value = this.secretEnv && this.environment[this.secretEnv];
    need(typeof value === 'string' && Buffer.byteLength(value) >= 32 && Buffer.byteLength(value) <= 1024,
      'ACCOUNTING_DELIVERY_KEY_UNAVAILABLE',
      'Configure the selected accounting delivery signing key in the original server environment.', 503);
    return value;
  }
  signing() {
    let available = false;
    try { this.secret(); available = true; } catch {}
    return { environment: this.secretEnv, available };
  }
  notice(id) {
    need(hex(id), 'INVALID_NOTICE_ID', 'Choose an original event identifier.');
    const row = this.data().notices.find(item => item.eventId === id);
    need(row, 'DELIVERY_NOTICE_NOT_FOUND', 'This original delivery notice was not found.', 404);
    return row;
  }
  captureView(row) {
    const matching = this.workspace.state.runs.filter(run => run.requestId === row.requestId);
    need(matching.length <= 1, 'DELIVERY_CAPTURE_CONFLICT', 'More than one original run uses this capture identity.', 409);
    const run = matching[0];
    need(!row.runId || run?.id === row.runId, 'DELIVERY_CAPTURE_CONFLICT',
      'The retained notice no longer identifies its original accounting run.', 409);
    return {
      requestId: row.requestId, name: row.name, actor: row.actor, createdAt: row.createdAt,
      preparedRevision: row.preparedRevision,
      runId: run?.id ?? null, status: run?.status ?? 'prepared',
      error: run?.error ?? row.lastError?.message ?? null,
      code: row.lastError?.code ?? null,
      sourceSelection: clone(row.selection), eventSha256: row.eventSha256,
      completedAt: run?.completedAt ?? null,
    };
  }
  noticeView(row) {
    return { ...clone(row), captures: this.data().captures.filter(item => item.eventId === row.eventId)
      .map(item => this.captureView(item)).reverse() };
  }
  view({ offset = 0, limit = 50, state = 'all' } = {}) {
    offset = Number(offset); limit = Number(limit);
    need(Number.isSafeInteger(offset) && offset >= 0 && Number.isInteger(limit) && limit >= 1 && limit <= 200 &&
      ['all', 'pending', 'captured'].includes(state), 'INVALID_DELIVERY_PAGE', 'Choose a supported delivery page.');
    const data = this.data(), captures = new Map();
    for (const row of data.captures) {
      const complete = this.captureView(row).status === 'complete';
      captures.set(row.eventId, (captures.get(row.eventId) ?? false) || complete);
    }
    const rows = [...data.notices].reverse().filter(row => state === 'all' ||
      (state === 'captured') === Boolean(captures.get(row.eventId)));
    const captured = data.notices.filter(row => captures.get(row.eventId)).length;
    return {
      schema: DELIVERY_SCHEMA, revision: this.workspace.state.revision,
      source: { workspaceDir: this.workspace.directory, outboxDir: this.workspace.state.sources.outboxDir }, signing: this.signing(),
      summary: { notices: data.notices.length, captured, pending: data.notices.length - captured },
      notices: rows.slice(offset, offset + limit).map(row => this.noticeView(row)),
      offset, limit, total: rows.length, nextOffset: offset + limit < rows.length ? offset + limit : null,
    };
  }
  async state(query = {}) {
    return this.workspace.serial(async () => this.view(query));
  }
  async detail(eventId) {
    return this.workspace.serial(async () => {
      const notice = this.noticeView(this.notice(eventId));
      return { revision: this.workspace.state.revision, notice, captures: notice.captures };
    });
  }
  async sourceEvent(eventId) {
    const directory = this.workspace.state.sources.outboxDir;
    await privateDirectory(directory);
    const rows = await (await openOutbox(directory)).rows();
    const row = rows.find(item => item.event.id === eventId);
    need(row, 'NOTICE_NATIVE_EVENT_NOT_AVAILABLE',
      'Synchronize this accounting destination with its original source before accepting the notice.', 409);
    const event = row.event;
    need(event.schema === EVENT_SCHEMA && event.authority === 'ORIGINAL_NATIVE_PROCESS_SETTLEMENT_SUCCESS' &&
      hex(event.receiptFingerprint) && (event.transactionFingerprint == null || hex(event.transactionFingerprint)),
      'INVALID_ORIGINAL_NATIVE_EVENT', 'The configured journal does not contain a complete original SF98 event.', 409);
    return { event, eventSha256: digest(encoded(event)), body: nativeWebhookPayload(event) };
  }
  async acceptSigned({ rawBody, headers }) {
    need(Buffer.isBuffer(rawBody) && rawBody.length > 0 && rawBody.length <= NOTICE_BYTES,
      'INVALID_NOTICE_BODY', 'The signed notice body has an unsupported size.', 413);
    const timestamp = oneNoticeHeader(headers, 'x-sf98-timestamp');
    const signature = oneNoticeHeader(headers, 'x-sf98-signature');
    const identity = oneNoticeHeader(headers, 'idempotency-key');
    need(timestamp && /^[1-9][0-9]{9,10}$/.test(timestamp) &&
      Math.abs(this.clock() / 1000 - Number(timestamp)) <= 300 &&
      signature && /^sha256=[a-f0-9]{64}$/.test(signature) && hex(identity),
      'INVALID_NOTICE_SIGNATURE', 'The signed notice identity or timestamp is invalid.', 401);
    const expected = createHmac('sha256', this.secret()).update(timestamp + '.').update(rawBody).digest();
    need(timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex')),
      'INVALID_NOTICE_SIGNATURE', 'The signed notice could not be authenticated.', 401);
    let payload;
    try { payload = JSON.parse(rawBody.toString('utf8')); }
    catch { throw new WorkspaceError('INVALID_NOTICE_JSON', 'The signed notice is not valid JSON.', 422); }
    need(payload && payload.eventId === identity, 'NOTICE_IDENTITY_CONFLICT',
      'The signed body and original idempotency key disagree.', 409);
    return this.workspace.serial(async () => {
      const source = await this.sourceEvent(identity), bodySha256 = digest(rawBody);
      need(source.body === rawBody.toString('utf8'), 'NOTICE_NATIVE_EVENT_MISMATCH',
        'This signed notice differs from the exact original event in the configured destination journal.', 409);
      const data = this.data(), existing = data.notices.find(row => row.eventId === identity);
      if (existing) {
        need(existing.bodySha256 === bodySha256 && existing.eventSha256 === source.eventSha256,
          'NOTICE_REPLAY_CONFLICT', 'This original event already has a different retained notice.', 409);
        return { status: 'ALREADY_ACCEPTED', duplicate: true, eventId: identity,
          revision: this.workspace.state.revision, notice: this.noticeView(existing) };
      }
      need(data.notices.length < 10000, 'DELIVERY_NOTICE_LIMIT',
        'Archive this complete accounting workspace before retaining more delivery notices.', 409);
      const event = source.event, row = {
        eventId: identity, receivedAt: new Date(this.clock()).toISOString(), signedAt: timestamp,
        occurredAt: event.at, routeId: event.routeId, method: event.method, network: event.network,
        amountAtomic: event.amountAtomic, assetDigest: event.assetDigest,
        recipientDigest: event.recipientDigest ?? null, orderReference: event.orderReference,
        eventSha256: source.eventSha256, bodySha256,
      };
      data.notices.push(row);
      await this.workspace.commit('accounting_delivery_accepted', 'signed SF98 receiver',
        { eventId: identity, eventSha256: row.eventSha256, bodySha256 });
      return { status: 'ACCEPTED', duplicate: false, eventId: identity,
        revision: this.workspace.state.revision, notice: this.noticeView(row) };
    });
  }
  async capture(eventId, value) {
    need(value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).every(key => ['revision', 'actor', 'requestId', 'name'].includes(key)),
      'INVALID_CAPTURE_FIELDS', 'Use the original notice capture fields.');
    need(typeof value.requestId === 'string' && UUID.test(value.requestId),
      'CAPTURE_REQUEST_ID_REQUIRED', 'Retain one UUID for this accounting capture and reuse it after an interrupted reply.');
    const actor = field(value.actor, 'operator'), name = field(value.name, 'capture name');
    const intentSha256 = digest(encoded({ eventId, requestId: value.requestId, actor, name }));
    const prepared = await this.workspace.serial(async () => {
      const notice = this.notice(eventId), data = this.data();
      const existing = data.captures.find(row => row.requestId === value.requestId);
      if (existing) {
        need(existing.intentSha256 === intentSha256, 'CAPTURE_REQUEST_CONFLICT',
          'This capture request identifier belongs to a different original request.', 409);
        return clone(existing);
      }
      this.workspace.expected(value.revision);
      const source = await this.sourceEvent(eventId);
      need(source.eventSha256 === notice.eventSha256 && digest(source.body) === notice.bodySha256,
        'NOTICE_SOURCE_CHANGED', 'Restore the original native event before capturing its accounting report.', 409);
      need(data.captures.length < 5000, 'DELIVERY_CAPTURE_LIMIT',
        'Archive this complete accounting workspace before retaining more capture requests.', 409);
      const selected = selection(this.workspace), row = {
        requestId: value.requestId, eventId, actor, name, intentSha256,
        eventSha256: notice.eventSha256, createdAt: new Date(this.clock()).toISOString(),
        selection: selected, selectionSha256: digest(encoded(selected)),
        preparedRevision: this.workspace.state.revision, runId: null, lastError: null,
      };
      data.captures.push(row);
      await this.workspace.commit('accounting_delivery_capture_prepared', actor,
        { eventId, requestId: row.requestId, eventSha256: row.eventSha256, selectionSha256: row.selectionSha256 });
      return clone(row);
    });
    try {
      const launch = await this.workspace.serial(async () => {
        const existing = this.workspace.state.runs.find(row => row.requestId === prepared.requestId);
        if (existing) return { existing: clone(existing) };
        const current = selection(this.workspace);
        need(digest(encoded(current)) === prepared.selectionSha256,
          'DELIVERY_CAPTURE_SELECTION_CHANGED',
          'The accounting source, terms, proof selection or period changed. Keep this prepared request and start a new capture after reviewing the current selections.', 409);
        const source = await this.sourceEvent(eventId);
        need(source.eventSha256 === prepared.eventSha256, 'NOTICE_SOURCE_CHANGED',
          'Restore the original native event before continuing this prepared capture.', 409);
        return { revision: this.workspace.state.revision };
      });
      let run = launch.existing;
      if (!run) {
        const result = await this.workspace.begin({
          revision: launch.revision, name: prepared.name, actor: prepared.actor,
          requestId: prepared.requestId,
          expectedTermsSelection: prepared.selection.termsSelection,
          expectedPeriodSelection: prepared.selection.periodSelection,
          expectedNativeEvent: { id: prepared.eventId, sha256: prepared.eventSha256 },
        });
        run = result.run;
      }
      await this.workspace.serial(async () => {
        const row = this.data().captures.find(item => item.requestId === prepared.requestId);
        need(row && row.intentSha256 === intentSha256, 'CAPTURE_REQUEST_CONFLICT',
          'The retained capture request changed.', 409);
        need(run.expectedNativeEvent?.id === prepared.eventId &&
          run.expectedNativeEvent?.sha256 === prepared.eventSha256,
          'DELIVERY_CAPTURE_CONFLICT', 'The original run is bound to a different native event.', 409);
        if (row.runId !== run.id || row.lastError) {
          row.runId = run.id; row.lastError = null;
          await this.workspace.commit('accounting_delivery_capture_linked', prepared.actor,
            { eventId, requestId: prepared.requestId, runId: run.id });
        }
      });
      const detail = await this.detail(eventId);
      return { ...detail, capture: detail.captures.find(row => row.requestId === prepared.requestId),
        run: (await this.workspace.run(run.id)).run };
    } catch (error) {
      await this.workspace.serial(async () => {
        const row = this.data().captures.find(item => item.requestId === prepared.requestId);
        if (row && !row.runId) {
          const lastError = { code: error.code ?? 'ACCOUNTING_CAPTURE_FAILED',
            message: String(error.message ?? error).slice(0,1200) };
          if (encoded(row.lastError) !== encoded(lastError)) {
            row.lastError = lastError;
            await this.workspace.commit('accounting_delivery_capture_waiting', prepared.actor,
              { eventId, requestId: prepared.requestId, code: lastError.code });
          }
        }
      }).catch(() => {});
      throw error;
    }
  }
}
