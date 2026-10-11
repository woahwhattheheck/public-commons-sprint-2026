// MIT. Durable forecast work, staff decisions and original source recovery.
import { readdir, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { privateDirectory, readBytes, readJson, writeBytes, writeJson, jsonBytes, exists } from '../../sf88-operator-buyer-cli/node/store.mjs';
import { compileWeatherPlan, normalizeWork, requestsFor, ATTRIBUTION, CONTRACT, object, id, text, need, fail } from './config.mjs';
import { createTomorrowSource, readTimeline, readPng, digest } from './source.mjs';

export const WORKSPACE_SCHEMA = 'stellar-forge.tomorrow-workspace.v1';
export const HANDOVER_SCHEMA = 'stellar-forge.tomorrow-handover.v1';
const copy = value => structuredClone(value);
const freshId = prefix => prefix + '-' + randomUUID().replaceAll('-', '').slice(0, 16);
const filename = (kind, resource) => resource?.attemptId
  ? (kind === 'timeline' ? 'timeline-' : 'map-') + id(resource.attemptId) + (kind === 'timeline' ? '.json' : '.png')
  : kind === 'timeline' ? 'timeline.json' : 'map.png';
const captureName = (kind, attemptId) => kind + '-capture' + (attemptId ? '-' + id(attemptId) : '') + '.json';
const clean = value => JSON.parse(JSON.stringify(value));
const operators = { gte: (a,b) => a >= b, gt: (a,b) => a > b, lte: (a,b) => a <= b, lt: (a,b) => a < b };

export class WeatherWorkspace {
  constructor(directory, options = {}) {
    this.directory = resolve(directory); this.options = options; this.memory = new Map();
  }
  static async create(directory, { title = 'Weather operations', plan, ...options } = {}) {
    directory = await privateDirectory(resolve(directory));
    await privateDirectory(join(directory, 'versions'));
    await privateDirectory(join(directory, 'editions'));
    const state = { schema: WORKSPACE_SCHEMA, workspaceId: freshId('weather'), revision: 0, title: text(title, 'WEATHER_WORKSPACE_TITLE'),
      plan: compileWeatherPlan(plan), workOrders: [], editions: [], decisions: [], commands: {} };
    await writeJson(join(directory, 'versions', '000000000000.json'), state, { exclusive: true });
    return new WeatherWorkspace(directory, options);
  }
  static async open(directory, options = {}) {
    await privateDirectory(resolve(directory), { create: false });
    const workspace = new WeatherWorkspace(directory, options); await workspace._state(); return workspace;
  }
  async _state() {
    const files = (await readdir(join(this.directory, 'versions'))).filter(name => /^\d{12}\.json$/.test(name)).sort();
    need(files.length, 'WEATHER_WORKSPACE_MISSING');
    const state = await readJson(join(this.directory, 'versions', files.at(-1)), 16777216);
    need(state.schema === WORKSPACE_SCHEMA && Number.isSafeInteger(state.revision), 'WEATHER_WORKSPACE_INVALID');
    state.workspaceId ??= 'weather-' + digest(await readBytes(join(this.directory, 'versions', files[0]), 16777216)).slice(0, 24);
    this.plan = state.plan;
    return state;
  }
  async _change(kind, input, apply) {
    input = clean(input ?? {}); const requestId = input.requestId ? id(input.requestId) : null;
    const inputSha256 = digest(jsonBytes(input));
    for (;;) {
      const state = await this._state();
      if (requestId && state.commands[requestId]) {
        const command = state.commands[requestId];
        need(command.kind === kind && command.inputSha256 === inputSha256, 'WEATHER_REQUEST_ID_REUSED');
        return copy(command.result);
      }
      if (input.expectedRevision !== undefined) need(input.expectedRevision === state.revision, 'WEATHER_REVISION_CHANGED');
      const result = clean(apply(state)); state.revision++;
      if (requestId) state.commands[requestId] = { kind, inputSha256, result };
      try {
        await writeJson(join(this.directory, 'versions', String(state.revision).padStart(12, '0') + '.json'), state, { exclusive: true });
        return copy(result);
      } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
  }
  _edition(state, editionId) {
    const edition = state.editions.find(value => value.id === id(editionId));
    need(edition, 'WEATHER_EDITION_UNKNOWN'); return edition;
  }
  _availability(edition, kind = 'timeline') {
    if (edition.resources[kind]?.state !== 'COMPLETE') return 'NOT_CAPTURED';
    if (edition.rawExpiresAt && Date.now() >= this._expiry(edition)) return 'RETENTION_EXPIRED';
    if (!this.memory.has(edition.id + '/' + kind)) {
      if (edition.usage.mode === 'keyless-evaluation') return 'EPHEMERAL_EXPIRED';
      if (!existsSync(join(this.directory, 'editions', edition.id, filename(kind, edition.resources[kind])))) return 'METADATA_ONLY';
    }
    return 'AVAILABLE';
  }
  async view() {
    await this.purgeExpired();
    const state = await this._state();
    const { commands, ...publicState } = state;
    publicState.editions = state.editions.map(edition => ({ ...edition, rawAvailability: this._availability(edition),
      resourceAvailability: Object.fromEntries(edition.requests.map(request => [request.kind, this._availability(edition, request.kind)])) }));
    return { ...publicState, attribution: ATTRIBUTION };
  }
  async saveWork(input) {
    const state = await this._state(), work = normalizeWork(input, state.plan);
    work.id ??= freshId('work');
    return this._change('save-work', input, current => {
      const previous = current.workOrders.find(value => value.id === work.id);
      const next = { ...work, version: (previous?.version ?? 0) + 1, updatedAt: new Date().toISOString() };
      if (previous) current.workOrders[current.workOrders.indexOf(previous)] = next; else current.workOrders.push(next);
      return next;
    });
  }
  async prepareEdition(workId, options = {}) {
    const editionId = freshId('edition');
    return this._change('prepare-edition', { workId, ...options }, state => {
      const work = state.workOrders.find(value => value.id === id(workId)); need(work, 'WEATHER_WORK_UNKNOWN');
      const edition = { id: editionId, workId, label: text(options.label ?? 'Forecast edition', 'WEATHER_EDITION_LABEL'),
        createdAt: new Date().toISOString(), state: 'PREPARED', work: copy(work),
        usage: copy(state.plan.usage), fieldUnits: copy(state.plan.fieldUnits), requests: requestsFor(work),
        resources: {}, rawExpiresAt: null, reviewSha256: null };
      state.editions.push(edition); return edition;
    });
  }
  async reviewEdition(editionId) {
    const state = await this._state(), edition = this._edition(state, editionId);
    need(['PREPARED', 'REVIEWED'].includes(edition.state), 'WEATHER_EDITION_ALREADY_ATTEMPTED');
    const review = { editionId, workId: edition.workId, requests: edition.requests, usage: edition.usage,
      providerCalls: edition.requests.length, attribution: ATTRIBUTION,
      semantics: { timezone: 'Request offsets select the window; timezone formats returned time.',
        dailyStartHour: edition.work.window.dailyStartHour, thresholdSource: 'Operator-selected rules',
        quotaRemaining: null, retention: edition.usage.mode === 'keyless-evaluation' ? 'Current process memory' : 'Configured customer license' } };
    const reviewSha256 = digest(jsonBytes(review));
    await this._change('review-edition', { editionId, reviewSha256 }, current => {
      const target = this._edition(current, editionId);
      need(['PREPARED', 'REVIEWED'].includes(target.state), 'WEATHER_EDITION_ALREADY_ATTEMPTED');
      target.state = 'REVIEWED'; target.reviewSha256 = reviewSha256; return { editionId, reviewSha256 };
    });
    return { ...review, reviewSha256 };
  }
  async _recordCapture(editionId, kind, resource, attemptId = null) {
    return this._change('record-capture', { editionId, kind, attemptId }, state => {
      const target = this._edition(state, editionId);
      if (attemptId) {
        const attempt = target.resourceAttempts?.find(value => value.id === attemptId);
        need(attempt?.kind === kind && attempt.state === 'ACQUIRING' &&
          resource.requestSha256 === digest(jsonBytes(attempt.request)), 'WEATHER_RETRY_IDENTITY_CHANGED');
        attempt.state = resource.state; attempt.finishedAt = resource.receivedAt;
        attempt.resource = copy(resource);
      }
      target.resources[kind] = resource;
      if (resource.state === 'COMPLETE' && target.usage.mode === 'licensed-service') {
        const expiry = Math.min(Date.parse(resource.receivedAt) + target.usage.retentionSeconds * 1000,
          target.usage.expiresAt ? Date.parse(target.usage.expiresAt) : Infinity,
          target.rawExpiresAt ? Date.parse(target.rawExpiresAt) : Infinity);
        target.rawExpiresAt = new Date(expiry).toISOString();
      }
      return resource;
    });
  }
  async _retain(edition, kind, result, { attemptId = null, request } = {}) {
    const directory = await privateDirectory(join(this.directory, 'editions', edition.id));
    request ??= edition.requests.find(value => value.kind === kind);
    const requestSha256 = digest(jsonBytes(request));
    const resource = { ...result.observation, requestSha256, state: result.bytes ? 'COMPLETE' : 'FAILED',
      ...(attemptId ? { attemptId } : {}), error: result.error ?? null,
      ...(kind === 'timeline' && result.interpreted ? {
        returnedIntervals: result.interpreted.returnedIntervals, returnedExtent: result.interpreted.returnedExtent,
        requestedTimestepsAbsent: result.interpreted.requestedTimestepsAbsent,
      } : {}), ...(kind === 'tile' && result.interpreted ? result.interpreted : {}) };
    if (result.bytes) {
      this.memory.set(edition.id + '/' + kind, Buffer.from(result.bytes));
      if (edition.usage.mode === 'licensed-service')
        await writeBytes(join(directory, filename(kind, resource)), result.bytes, { exclusive: true });
    }
    await writeJson(join(directory, captureName(kind, attemptId)), { editionId: edition.id, kind, resource }, { exclusive: true });
    await this._recordCapture(edition.id, kind, resource, attemptId);
  }
  /** Prepare one explicit read of a failed resource, retaining the successful resources and staff decisions. */
  async reviewResourceRetry(editionId, kind, { tileTimeFormat = 'original' } = {}) {
    const state = await this._state(), edition = this._edition(state, editionId);
    need(['PARTIAL', 'FAILED', 'INTERRUPTED', 'COMPLETE'].includes(edition.state), 'WEATHER_RECOVERY_REQUIRED');
    need(['timeline', 'tile'].includes(kind) && edition.requests.some(value => value.kind === kind), 'WEATHER_REQUEST_NOT_SELECTED');
    need(edition.resources[kind]?.state !== 'COMPLETE', 'WEATHER_RESOURCE_ALREADY_COMPLETE');
    const request = requestsFor(edition.work, { tileTimeFormat }).find(value => value.kind === kind);
    const review = { editionId, kind, request, usage: edition.usage, tileTimeFormat, providerCalls: 1,
      previousFailure: edition.resources[kind] ?? null,
      priorAttempts: (edition.resourceAttempts ?? []).filter(value => value.kind === kind).map(value => ({ id: value.id, state: value.state })),
      attribution: ATTRIBUTION };
    const reviewSha256 = digest(jsonBytes(review));
    await this._change('review-resource-retry', { editionId, kind, reviewSha256 }, current => {
      const target = this._edition(current, editionId);
      need(!['ACQUIRING', 'RETRYING'].includes(target.state) &&
        digest(jsonBytes(target.resources[kind] ?? null)) === digest(jsonBytes(review.previousFailure)), 'WEATHER_RESOURCE_CHANGED');
      target.retryReviews ??= {}; target.retryReviews[kind] = { ...copy(review), reviewSha256 };
      return { editionId, kind, reviewSha256 };
    });
    return { ...review, reviewSha256 };
  }
  async retryResource(editionId, kind, { reviewSha256, signal } = {}) {
    const configuration = await this._state();
    this.source ??= this.options.source ?? createTomorrowSource(configuration.plan, this.options);
    const attemptId = freshId('retry');
    const edition = await this._change('start-resource-retry', { editionId, kind, reviewSha256 }, state => {
      const target = this._edition(state, editionId), review = target.retryReviews?.[kind];
      need(review && review.reviewSha256 === reviewSha256 && !['ACQUIRING', 'RETRYING'].includes(target.state), 'WEATHER_RETRY_REVIEW_REQUIRED');
      const { reviewSha256: ignored, ...reviewBody } = review;
      need(digest(jsonBytes(reviewBody)) === reviewSha256 &&
        digest(jsonBytes(target.resources[kind] ?? null)) === digest(jsonBytes(review.previousFailure)), 'WEATHER_RESOURCE_CHANGED');
      need(target.resources[kind]?.state !== 'COMPLETE', 'WEATHER_RESOURCE_ALREADY_COMPLETE');
      if (target.usage.expiresAt) need(Date.now() < Date.parse(target.usage.expiresAt), 'WEATHER_LICENSE_EXPIRED');
      target.resourceAttempts ??= [];
      target.resourceAttempts.push({ id: attemptId, kind, request: copy(review.request), reviewSha256,
        previousResource: copy(target.resources[kind] ?? null), state: 'ACQUIRING', startedAt: new Date().toISOString() });
      delete target.retryReviews[kind]; target.state = 'RETRYING'; return target;
    });
    const attempt = edition.resourceAttempts.find(value => value.id === attemptId);
    let result;
    try {
      need(!signal?.aborted, 'WEATHER_ACQUISITION_CANCELLED');
      result = await this.source.capture(kind, edition.work, { signal, request: attempt.request });
    } catch (error) {
      result = { observation: { kind, method: attempt.request.method, url: attempt.request.url, status: null,
        receivedAt: new Date().toISOString(), contentType: null, sha256: null, bytes: 0 }, bytes: null,
        error: /^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'WEATHER_SOURCE_FAILED' };
    }
    await this._retain(edition, kind, result, { attemptId, request: attempt.request });
    await this._finish(editionId); return this.editionView(editionId);
  }
  async acquireEdition(editionId, { reviewSha256, signal } = {}) {
    const configuration = await this._state();
    this.source ??= this.options.source ?? createTomorrowSource(configuration.plan, this.options);
    const edition = await this._change('start-acquisition', { editionId, reviewSha256 }, state => {
      const target = this._edition(state, editionId);
      need(target.state === 'REVIEWED' && target.reviewSha256 === reviewSha256, 'WEATHER_REVIEW_REQUIRED');
      if (target.usage.expiresAt) need(Date.now() < Date.parse(target.usage.expiresAt), 'WEATHER_LICENSE_EXPIRED');
      target.state = 'ACQUIRING'; target.startedAt = new Date().toISOString(); return target;
    });
    for (const request of edition.requests) {
      let result;
      try {
        need(!signal?.aborted, 'WEATHER_ACQUISITION_CANCELLED');
        result = await this.source.capture(request.kind, edition.work, { signal });
      } catch (error) {
        result = { observation: { kind: request.kind, method: request.method, url: request.url, status: null,
          receivedAt: new Date().toISOString(), contentType: null, sha256: null, bytes: 0 },
          bytes: null, error: /^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'WEATHER_SOURCE_FAILED' };
      }
      await this._retain(edition, request.kind, result);
    }
    await this._finish(editionId); return this.editionView(editionId);
  }
  async _finish(editionId, interrupted = false) {
    return this._change('finish-acquisition', { editionId, interrupted }, state => {
      const target = this._edition(state, editionId), count = target.requests.filter(request => target.resources[request.kind]?.state === 'COMPLETE').length;
      target.state = count === target.requests.length ? 'COMPLETE' : count ? 'PARTIAL' : interrupted ? 'INTERRUPTED' : 'FAILED';
      target.finishedAt ??= new Date().toISOString(); return target;
    });
  }
  async recoverEdition(editionId) {
    const state = await this._state(), edition = this._edition(state, editionId);
    const pending = edition.requests.filter(request => !edition.resources[request.kind])
      .map(request => ({ kind: request.kind, request, attemptId: null }));
    pending.push(...(edition.resourceAttempts ?? []).filter(attempt => attempt.state === 'ACQUIRING')
      .map(attempt => ({ kind: attempt.kind, request: attempt.request, attemptId: attempt.id })));
    for (const { kind, request, attemptId } of pending) {
      const path = join(this.directory, 'editions', edition.id, captureName(kind, attemptId));
      if (!await exists(path)) continue;
      const capture = await readJson(path, 1048576);
      need(capture.editionId === editionId && capture.kind === kind && (capture.resource.attemptId ?? null) === attemptId &&
        capture.resource.requestSha256 === digest(jsonBytes(request)), 'WEATHER_CAPTURE_IDENTITY_CHANGED');
      await this._recordCapture(editionId, kind, capture.resource, attemptId);
    }
    if (['ACQUIRING', 'RETRYING'].includes(edition.state)) {
      await this._change('recover-interrupted-retries', { editionId }, current => {
        const target = this._edition(current, editionId);
        for (const attempt of target.resourceAttempts ?? []) if (attempt.state === 'ACQUIRING') {
          attempt.state = 'INTERRUPTED'; attempt.finishedAt = new Date().toISOString();
        }
        return { editionId };
      });
      await this._finish(editionId, true);
    }
    return this.editionView(editionId);
  }
  async _asset(edition, kind) {
    need(!edition.rawExpiresAt || Date.now() < this._expiry(edition), 'WEATHER_RETENTION_EXPIRED');
    const expected = edition.resources[kind]; need(expected?.state === 'COMPLETE', 'WEATHER_RESOURCE_UNAVAILABLE');
    let bytes = this.memory.get(edition.id + '/' + kind);
    if (!bytes && edition.usage.mode === 'licensed-service')
      bytes = await readBytes(join(this.directory, 'editions', edition.id, filename(kind, expected)), 1048576);
    need(bytes, 'WEATHER_EPHEMERAL_SOURCE_EXPIRED');
    need(bytes.length === expected.bytes && digest(bytes) === expected.sha256, 'WEATHER_SOURCE_BYTES_CHANGED');
    return Buffer.from(bytes);
  }
  async editionView(editionId) {
    const state = await this._state(), edition = this._edition(state, editionId);
    const rawAvailability = this._availability(edition);
    let rows = [], sourceError = null;
    if (rawAvailability === 'AVAILABLE') {
      try {
        const parsed = readTimeline(await this._asset(edition, 'timeline'), edition.requests.find(request => request.kind === 'timeline').body);
        rows = parsed.timelines.flatMap(timeline => timeline.intervals.map(interval => {
          const rowId = digest(jsonBytes([edition.id, timeline.timestep, interval.startTime])).slice(0, 24);
          const fields = edition.work.fields.map(field => {
            const present = Object.hasOwn(interval.values, field), value = present ? interval.values[field] : null;
            const selected = edition.work.thresholds.filter(rule => rule.field === field);
            const rules = selected.map(rule => ({ ...rule, triggered: typeof value === 'number' ? operators[rule.operator](value, rule.value) : null }));
            return { field, present, value, unit: edition.fieldUnits[field][edition.work.units], rules,
              exposure: !present || value === null || typeof value !== 'number' && selected.length ? 'MISSING' :
                rules.some(rule => rule.triggered) ? 'TRIGGERED' : selected.length ? 'CLEAR' : 'UNCONFIGURED' };
          });
          return { id: rowId, timestep: timeline.timestep, startTime: interval.startTime,
            withinWindow: Date.parse(interval.startTime) >= Date.parse(edition.work.window.startTime) && Date.parse(interval.startTime) < Date.parse(edition.work.window.endTime), fields };
        }));
      } catch (error) { sourceError = error.code ?? 'WEATHER_SOURCE_UNAVAILABLE'; }
    }
    return { edition: { ...edition, rawAvailability }, work: edition.work, rows, sourceError,
      decisions: state.decisions.filter(decision => decision.editionId === editionId),
      tile: { available: this._availability(edition, 'tile') === 'AVAILABLE',
        width: edition.resources.tile?.width ?? null, height: edition.resources.tile?.height ?? null, mime: 'image/png' },
      attribution: ATTRIBUTION };
  }
  async tile(editionId) {
    const state = await this._state(), edition = this._edition(state, editionId), bytes = await this._asset(edition, 'tile');
    readPng(bytes, edition.resources.tile.contentType); return { bytes, mime: 'image/png' };
  }
  async decide(input) {
    if (input.requestId) {
      const command = (await this._state()).commands[id(input.requestId)];
      if (command) {
        need(command.kind === 'staff-decision' && command.inputSha256 === digest(jsonBytes(clean(input))), 'WEATHER_REQUEST_ID_REUSED');
        return copy(command.result);
      }
    }
    const view = await this.editionView(input.editionId), row = view.rows.find(value => value.id === input.intervalId);
    need(row, 'WEATHER_SOURCE_INTERVAL_REQUIRED');
    need(['PROCEED', 'RESCHEDULE', 'REVIEW', 'CANCEL'].includes(input.decision), 'WEATHER_DECISION_REQUIRED');
    const record = { id: freshId('decision'), editionId: input.editionId, intervalId: row.id,
      assignee: text(input.assignee, 'WEATHER_ASSIGNEE_REQUIRED'), decision: input.decision,
      note: typeof input.note === 'string' ? input.note.trim() : '', sourceSha256: view.edition.resources.timeline.sha256,
      timestep: row.timestep, startTime: row.startTime, rulesTriggered: row.fields.flatMap(field => field.rules.filter(rule => rule.triggered).map(rule => rule.id)),
      createdAt: new Date().toISOString() };
    need(record.note.length <= 10000, 'WEATHER_DECISION_NOTE_TOO_LONG');
    return this._change('staff-decision', input, state => {
      const previous = state.decisions.filter(value => value.editionId === record.editionId && value.intervalId === record.intervalId);
      record.revision = previous.length + 1; state.decisions.push(record); return record;
    });
  }
  async compare(beforeId, afterId) {
    const before = await this.editionView(beforeId), after = await this.editionView(afterId);
    const same = ['latitude', 'longitude'].every(key => before.work.location[key] === after.work.location[key]) &&
      before.work.units === after.work.units && before.work.window.dailyStartHour === after.work.window.dailyStartHour &&
      before.work.window.timezone === after.work.window.timezone;
    if (!same) return { beforeId, afterId, comparable: false, reason: 'LOCATION_UNITS_OR_TIME_SEMANTICS_DIFFER', rows: [] };
    if (before.sourceError || after.sourceError || before.edition.rawAvailability !== 'AVAILABLE' || after.edition.rawAvailability !== 'AVAILABLE')
      return { beforeId, afterId, comparable: false, reason: 'SOURCE_NOT_AVAILABLE', rows: [] };
    const cells = view => new Map(view.rows.flatMap(row => row.fields.map(field => [
      row.timestep + '/' + Date.parse(row.startTime) + '/' + field.field,
      { timestep: row.timestep, startTime: row.startTime, field: field.field, ...field },
    ])));
    const a = cells(before), b = cells(after), keys = new Set([...a.keys(), ...b.keys()]);
    const rows = [...keys].map(key => {
      const old = a.get(key), next = b.get(key), selected = next ?? old;
      const matched = old && next && old.unit === next.unit && old.present && next.present && old.value !== null && next.value !== null;
      return { timestep: selected.timestep, startTime: selected.startTime, field: selected.field, unit: selected.unit,
        before: old?.present ? old.value : null, after: next?.present ? next.value : null,
        beforePresent: old?.present ?? false, afterPresent: next?.present ?? false,
        change: matched && typeof old.value === 'number' && typeof next.value === 'number' ? next.value - old.value : null,
        status: !old ? 'ADDED_INTERVAL' : !next ? 'REMOVED_INTERVAL' : !matched ? 'MISSING_OR_DIFFERENT_UNIT' : old.value === next.value ? 'UNCHANGED' : 'CHANGED' };
    });
    return { beforeId, afterId, comparable: true, rows, attribution: ATTRIBUTION };
  }
  async handover({ editionIds, includeRaw = false } = {}) {
    const state = await this._state();
    const editions = editionIds ? editionIds.map(editionId => this._edition(state, editionId)) : state.editions;
    const selected = new Set(editions.map(edition => edition.id)), raw = [];
    if (includeRaw) for (const edition of editions) {
      need(edition.usage.mode === 'licensed-service' && edition.usage.exportRaw, 'WEATHER_RAW_EXPORT_NOT_ENABLED');
      for (const request of edition.requests) if (edition.resources[request.kind]?.state === 'COMPLETE')
        raw.push({ editionId: edition.id, kind: request.kind, encoding: 'base64', data: (await this._asset(edition, request.kind)).toString('base64') });
    }
    const payload = { schema: HANDOVER_SCHEMA, sourceWorkspaceId: state.workspaceId, createdAt: new Date().toISOString(), title: state.title,
      plan: state.plan, editions: copy(editions), decisions: state.decisions.filter(value => selected.has(value.editionId)),
      raw, attribution: ATTRIBUTION, sources: CONTRACT };
    return { payload, sha256: digest(jsonBytes(payload)) };
  }
  async importHandover(bundle) {
    need(object(bundle?.payload) && bundle.payload.schema === HANDOVER_SCHEMA && bundle.sha256 === digest(jsonBytes(bundle.payload)), 'WEATHER_HANDOVER_INVALID');
    const incoming = bundle.payload;
    need(Array.isArray(incoming.editions) && Array.isArray(incoming.decisions) && Array.isArray(incoming.raw), 'WEATHER_HANDOVER_INVALID');
    const currentState = await this._state();
    const imported = incoming.editions.map(edition => {
      id(edition.id); normalizeWork(edition.work, compileWeatherPlan(incoming.plan));
      need(edition.workId === edition.work.id && object(edition.resources), 'WEATHER_HANDOVER_EDITION_INVALID');
      const existing = currentState.editions.find(value => value.id === edition.id);
      if (existing) need(digest(jsonBytes(existing)) === digest(jsonBytes(edition)), 'WEATHER_IMPORT_COLLISION');
      need(digest(jsonBytes(requestsFor(edition.work))) === digest(jsonBytes(edition.requests)), 'WEATHER_HANDOVER_REQUEST_CHANGED');
      for (const [kind, resource] of Object.entries(edition.resources)) if (resource.attemptId) {
        id(resource.attemptId);
        const attempt = edition.resourceAttempts?.find(value => value.id === resource.attemptId);
        const allowed = [requestsFor(edition.work), requestsFor(edition.work, { tileTimeFormat: 'whole-seconds' })]
          .flat().filter(value => value.kind === kind);
        need(attempt?.kind === kind && allowed.some(value => digest(jsonBytes(value)) === digest(jsonBytes(attempt.request))) &&
          resource.requestSha256 === digest(jsonBytes(attempt.request)), 'WEATHER_HANDOVER_RETRY_CHANGED');
      }
      return copy(edition);
    });
    for (const entry of incoming.raw) {
      const edition = imported.find(value => value.id === entry.editionId);
      need(edition && edition.usage.mode === 'licensed-service' && edition.usage.exportRaw && entry.encoding === 'base64' &&
        ['timeline', 'tile'].includes(entry.kind), 'WEATHER_HANDOVER_ATTACHMENT_INVALID');
      need(currentState.plan.usage.mode === 'licensed-service' && currentState.plan.usage.exportRaw &&
        currentState.plan.usage.licenseReference === edition.usage.licenseReference, 'WEATHER_IMPORT_LICENSE_CONFIGURATION_REQUIRED');
      need(edition.rawExpiresAt && Date.now() < this._expiry(edition), 'WEATHER_RETENTION_EXPIRED');
      const bytes = Buffer.from(entry.data, 'base64'), expected = edition.resources[entry.kind];
      need(bytes.length <= 1048576 && expected?.sha256 === digest(bytes) && expected.bytes === bytes.length, 'WEATHER_HANDOVER_ATTACHMENT_CHANGED');
      if (entry.kind === 'timeline') readTimeline(bytes, edition.requests.find(request => request.kind === 'timeline').body);
      else readPng(bytes, expected.contentType);
      await privateDirectory(join(this.directory, 'editions', edition.id));
      const path = join(this.directory, 'editions', edition.id, filename(entry.kind, expected));
      if (await exists(path)) need(digest(await readBytes(path, 1048576)) === expected.sha256, 'WEATHER_IMPORT_COLLISION');
      else await writeBytes(path, bytes, { exclusive: true });
    }
    await this._change('import-handover', { requestId: 'import-' + bundle.sha256.slice(0, 64), sha256: bundle.sha256 }, state => {
      for (const edition of imported) {
        const existing = state.editions.find(value => value.id === edition.id);
        if (existing) need(digest(jsonBytes(existing)) === digest(jsonBytes(edition)), 'WEATHER_IMPORT_COLLISION');
        else state.editions.push(edition);
        if (!state.workOrders.some(work => work.id === edition.workId)) state.workOrders.push(copy(edition.work));
      }
      for (const decision of incoming.decisions) {
        need(imported.some(edition => edition.id === decision.editionId), 'WEATHER_HANDOVER_DECISION_INVALID');
        if (!state.decisions.some(value => value.id === decision.id)) state.decisions.push(copy(decision));
      }
      return { imported: imported.map(edition => edition.id) };
    });
    return this.view();
  }
  /** Original SF88 verified bytes populate a metadata handover without a provider call. */
  async adoptBuyerResult(editionId, kind, result, { intentId, productSha256 } = {}) {
    const state = await this._state(), edition = this._edition(state, editionId);
    need(['timeline', 'tile'].includes(kind) && edition.usage.mode === 'licensed-service' && edition.usage.exportRaw &&
      state.plan.usage.mode === 'licensed-service' && state.plan.usage.exportRaw &&
      state.plan.usage.licenseReference === edition.usage.licenseReference, 'WEATHER_IMPORT_LICENSE_CONFIGURATION_REQUIRED');
    need(edition.rawExpiresAt && Date.now() < this._expiry(edition), 'WEATHER_RETENTION_EXPIRED');
    need(result && typeof result.raiseForStatus === 'function' && typeof result.bytes === 'function' && object(result.native), 'WEATHER_ORIGINAL_BUYER_RESULT_REQUIRED');
    const recoveredResponse = result.record.recovered === true && result.record.runtimeError === 'PROCESS_EXIT_NOT_RECORDED' &&
      result.delivery.status === 'SAVED' && result.native.httpStatus >= 200 && result.native.httpStatus < 300 &&
      !result.native.error && !result.native.evidenceError && !result.native.responseCleanupError;
    if (!recoveredResponse) result.raiseForStatus();
    const bytes = await result.bytes({ limit: 1048576 }), expected = edition.resources[kind];
    need(expected?.state === 'COMPLETE' && expected.sha256 === digest(bytes) && expected.bytes === bytes.length &&
      result.delivery.sha256 === expected.sha256, 'WEATHER_BUYER_SOURCE_CHANGED');
    if (kind === 'timeline') readTimeline(bytes, edition.requests.find(request => request.kind === kind).body);
    else readPng(bytes, result.delivery.contentType);
    const directory = await privateDirectory(join(this.directory, 'editions', edition.id)), path = join(directory, filename(kind, expected));
    if (await exists(path)) need(digest(await readBytes(path, 1048576)) === expected.sha256, 'WEATHER_IMPORT_COLLISION');
    else await writeBytes(path, bytes, { exclusive: true });
    const delivery = { kind: 'ORIGINAL_SF88_BUYER_RESULT', intentId: id(intentId), editionId, resourceKind: kind,
      productSha256, nativeResultSha256: digest(jsonBytes(result.record)), responseSha256: expected.sha256,
      nativeStatus: result.status, httpStatus: result.native.httpStatus, receivedAt: new Date().toISOString(),
      exitCode: result.record.exitCode, runtimeError: result.record.runtimeError ?? null, recovered: result.record.recovered === true };
    await writeJson(join(directory, kind + '-buyer.json'), delivery);
    return delivery;
  }
  /** Private file inputs for the original asset publisher. */
  async exportableEdition(editionId) {
    const state = await this._state(), edition = this._edition(state, editionId);
    need(edition.state === 'COMPLETE' && edition.usage.mode === 'licensed-service' && edition.usage.exportRaw, 'WEATHER_RAW_EXPORT_NOT_ENABLED');
    const assets = [];
    for (const request of edition.requests) {
      await this._asset(edition, request.kind);
      assets.push({ kind: request.kind, file: join(this.directory, 'editions', edition.id, filename(request.kind, edition.resources[request.kind])),
        ...edition.resources[request.kind] });
    }
    return { edition: copy(edition), assets };
  }
  _expiry(edition) {
    let expiry = edition.rawExpiresAt ? Date.parse(edition.rawExpiresAt) : Infinity;
    if (this.plan?.usage.mode === 'licensed-service') {
      if (this.plan.usage.expiresAt) expiry = Math.min(expiry, Date.parse(this.plan.usage.expiresAt));
      for (const resource of Object.values(edition.resources)) if (resource.state === 'COMPLETE')
        expiry = Math.min(expiry, Date.parse(resource.receivedAt) + this.plan.usage.retentionSeconds * 1000);
    }
    return expiry;
  }
  async purgeExpired() {
    const state = await this._state();
    for (const edition of state.editions) if (edition.rawExpiresAt && Date.now() >= this._expiry(edition)) {
      for (const kind of ['timeline', 'tile']) {
        this.memory.delete(edition.id + '/' + kind);
        const paths = new Set([filename(kind), filename(kind, edition.resources[kind]),
          ...(edition.resourceAttempts ?? []).filter(attempt => attempt.kind === kind).map(attempt => filename(kind, { attemptId: attempt.id }))]);
        for (const path of paths) await unlink(join(this.directory, 'editions', edition.id, path)).catch(error => { if (error.code !== 'ENOENT') throw error; });
      }
    }
  }
  async close() { this.memory.clear(); if (this.source?.close) await this.source.close(); }
}
