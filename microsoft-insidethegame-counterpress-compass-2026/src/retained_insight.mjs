// Original model results carried with the exact observed match and saved review.
// The provider owns inference, tool calls, budget reservations and their receipts.
import {createHash, randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat, mkdir, open, readdir, rename, unlink} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {makeSnapshot} from './engine.mjs';
import {parseCount, parseView} from './live_sessions.mjs';
import {parseScenario, parseSeed} from './scenarios.mjs';

export const INSIGHT_FORMAT = 'counterpress.retained-insight.v1';
export const MAX_RETAINED_INSIGHTS = 24;
const CACHE_FORMAT = 'counterpress.commentary-continuity.v1';
const MAX_CACHE_BYTES = 16384;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (status, message) => Object.assign(new Error(message), {status});
const object = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(400, label + ' must be an object');
  return value;
};
const text = (value, limit, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > limit ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw fail(400, label + ' is invalid');
  return value;
};
const eventValues = events => events.map(({id, second, type, team, player, zone}) =>
  ({id, second, type, team, player, zone}));

export function insightScope({match, count, snapshot, events}) {
  if (!match || !Array.isArray(events)) throw fail(400, 'Original match and event prefix required');
  count = parseCount(count, match.events.length);
  if (!count || events.length !== count) throw fail(400, 'An observed match moment is required');
  const view = parseView(snapshot);
  const latest = snapshot.overlays?.at(-1);
  if (!latest) throw fail(400, 'No counterpress moment at this event');
  return {
    scenario: parseScenario(match.scenario), seed: parseSeed(match.seed),
    count, eventId: events.at(-1).id, frameSecond: snapshot.elapsedSeconds,
    momentId: latest.id, ...view, prefixSha256: hash(eventValues(events)),
  };
}

function responseValues(raw) {
  object(raw, 'Saved insight response');
  return {
    operation: text(raw.operation, 160, 'Insight operation'),
    originalSessionId: text(raw.originalSessionId, 160, 'Original insight session'),
    promptVersion: text(raw.promptVersion, 160, 'Insight prompt edition'),
    provider: text(raw.provider, 160, 'Insight provider'),
    model: text(raw.model, 160, 'Insight model'),
    caption: text(raw.caption, 200, 'Insight caption'),
    text: text(raw.text, 2000, 'Insight text'),
  };
}

export function normalizeRetainedInsight(raw, match) {
  object(raw, 'Saved insight');
  if (raw.format !== INSIGHT_FORMAT) throw fail(400, 'Unsupported saved insight');
  const source = object(raw.source, 'Insight source');
  const count = parseCount(source.count, match.events.length);
  const events = match.events.slice(0, count);
  const snapshot = makeSnapshot(events, parseView(source));
  const expected = insightScope({match, count, snapshot, events});
  if (JSON.stringify(expected) !== JSON.stringify({
    scenario: source.scenario, seed: source.seed, count: source.count, eventId: source.eventId,
    frameSecond: source.frameSecond, momentId: source.momentId,
    team: source.team, audience: source.audience, locale: source.locale, prefixSha256: source.prefixSha256,
  })) throw fail(400, 'Saved insight does not match the original event prefix and view');
  const response = responseValues(raw.response);
  if (!Number.isFinite(Date.parse(raw.capturedAt))) throw fail(400, 'Invalid insight capture time');
  const body = {format: INSIGHT_FORMAT, source: expected, response, capturedAt: new Date(raw.capturedAt).toISOString()};
  const id = 'insight-' + hash(body);
  if (raw.id !== id) throw fail(400, 'Saved insight content changed');
  return {id, ...body};
}

export function normalizeRetainedInsights(raw, match) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_RETAINED_INSIGHTS) throw fail(400, 'A review supports up to 24 retained insights');
  const seen = new Set();
  return raw.map(value => {
    const record = normalizeRetainedInsight(value, match);
    if (seen.has(record.id)) throw fail(400, 'Duplicate saved insight');
    seen.add(record.id);
    return record;
  });
}

export function findRetainedInsight(records, input) {
  const scope = insightScope(input);
  return (records || []).find(record => JSON.stringify(record.source) === JSON.stringify(scope)) || null;
}

export function presentRetainedInsight(record, sessionId, {retained = true, durable = true} = {}) {
  const source = record.source, response = record.response;
  return {state: 'ready', ...response, sessionId, recordedCount: source.count,
    frameSecond: source.frameSecond, momentId: source.momentId,
    team: source.team, audience: source.audience, locale: source.locale,
    retained, durable, insight: record};
}

function capture(input, output, originalSessionId) {
  const source = insightScope(input);
  if (output.state !== 'ready' || output.sessionId !== originalSessionId ||
      output.recordedCount !== source.count || output.frameSecond !== source.frameSecond ||
      output.momentId !== source.momentId || output.team !== source.team ||
      output.audience !== source.audience || output.locale !== source.locale)
    throw fail(502, 'Insight result does not identify the requested original moment');
  const response = responseValues({...output, originalSessionId});
  const body = {format: INSIGHT_FORMAT, source, response, capturedAt: new Date().toISOString()};
  return {id: 'insight-' + hash(body), ...body};
}

// One server owns its private directory, as with the existing match archive.
// A durable source key carries the original provider session through reopening.
// lookup() is read-only and never calls a model or starts a worker.
export function createCommentaryContinuity({provider, directory, edition, maxRecords = 500}) {
  if (!provider || typeof provider.request !== 'function' || typeof provider.configured !== 'function')
    throw new TypeError('Original commentary provider required');
  text(edition, 160, 'Commentary edition');
  if (typeof directory !== 'string' || !directory.trim()) throw new TypeError('Private commentary directory required');
  const root = resolve(directory), tails = new Map(), completed = new Map();
  let initialized;
  async function initialize() {
    if (!initialized) initialized = (async () => {
      await mkdir(root, {recursive: true, mode: 0o700});
      const info = await lstat(root);
      if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o077)
        throw fail(503, 'Commentary storage must be a private directory');
    })().catch(error => { initialized = null; throw error; });
    return initialized;
  }
  const identify = input => { const scope = insightScope(input); return {scope, key: hash({edition, source: scope})}; };
  function serial(key, operation) {
    const previous = tails.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    tails.set(key, next);
    next.finally(() => { if (tails.get(key) === next) tails.delete(key); }).catch(() => {});
    return next;
  }
  async function read(key, scope, match) {
    if (completed.has(key)) return completed.get(key);
    await initialize();
    let handle;
    try {
      handle = await open(join(root, key + '.json'), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const info = await handle.stat();
      if (!info.isFile() || info.mode & 0o077 || info.size > MAX_CACHE_BYTES)
        throw fail(503, 'Original insight storage needs recovery');
      const raw = JSON.parse(await handle.readFile('utf8'));
      if (raw.format !== CACHE_FORMAT || raw.edition !== edition || raw.key !== key ||
          JSON.stringify(raw.scope) !== JSON.stringify(scope))
        throw fail(503, 'Original insight source does not match');
      text(raw.originalSessionId, 160, 'Original insight session');
      if (raw.insight) raw.insight = normalizeRetainedInsight(raw.insight, match);
      return raw;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      if (error.status === 503) throw error;
      throw fail(503, 'Original insight storage needs recovery');
    } finally { if (handle) await handle.close(); }
  }
  async function write(record) {
    await initialize();
    // Durability reports the outcome of this save; it is not retained source.
    const {durable, ...saved} = record;
    const bytes = Buffer.from(JSON.stringify(saved) + '\n');
    if (bytes.length > MAX_CACHE_BYTES) throw fail(503, 'Insight result exceeds local storage capacity');
    const temporary = join(root, '.' + randomUUID() + '.tmp');
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
      await rename(temporary, join(root, record.key + '.json'));
      const folder = await open(root, constants.O_RDONLY);
      try { await folder.sync(); } finally { await folder.close(); }
    } finally {
      if (handle) await handle.close();
      await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  async function existing(input) {
    const {key, scope} = identify(input);
    const record = await read(key, scope, input.match);
    return {key, scope, record};
  }
  return {
    configured: () => provider.configured(),
    async lookup(input) {
      const {record} = await existing(input);
      if (!record) return {state: 'missing'};
      if (record.insight) return presentRetainedInsight(record.insight, input.sessionId, {durable: record.durable !== false});
      return {state: 'pending', sessionId: input.sessionId, recordedCount: input.count,
        originalSessionId: record.originalSessionId};
    },
    async request(input) {
      const {key, scope} = identify(input);
      return serial(key, async () => {
        let record = await read(key, scope, input.match);
        if (record?.insight) {
          if (record.durable === false) { try { await write(record); record.durable = true; } catch {} }
          return presentRetainedInsight(record.insight, input.sessionId, {durable: record.durable !== false});
        }
        if (!provider.configured()) return {state: 'unavailable'};
        if (!record) {
          const count = (await readdir(root)).filter(name => /^[0-9a-f]{64}\.json$/.test(name)).length;
          if (count >= maxRecords) throw fail(503, 'Commentary store is full; preserve and move the original store before adding work');
          record = {format: CACHE_FORMAT, edition, key, scope,
            originalSessionId: text(input.sessionId, 160, 'Original insight session'),
            createdAt: new Date().toISOString(), insight: null};
          // Commit identity before invoking the original provider. A reopened
          // player reuses this identity instead of deriving a new paid job.
          await write(record);
        }
        const output = await provider.request({sessionId: record.originalSessionId, count: input.count,
          snapshot: input.snapshot, events: input.events});
        if (output.state !== 'ready') return {...output, sessionId: input.sessionId,
          originalSessionId: record.originalSessionId};
        record.insight = capture(input, output, record.originalSessionId);
        completed.set(key, record);
        let durable = true;
        try { await write(record); } catch { durable = false; }
        record.durable = durable;
        // The ready result remains usable and can enter the original archive
        // even if storage fills after the provider's own durable completion.
        return presentRetainedInsight(record.insight, input.sessionId, {retained: false, durable});
      });
    },
  };
}
