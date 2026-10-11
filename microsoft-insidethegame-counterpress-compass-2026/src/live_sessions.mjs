// Bounded, per-viewer match sessions for event-by-event streaming.
// A session owns one generated synthetic match; frames are computed only from
// events[0..count), so no future event can influence a frame.
import {randomUUID} from 'node:crypto';
import {createReplayTimeline, validateFixture, TEAMS} from './engine.mjs';
import {generateMatch, parseScenario, parseSeed, SCENARIOS} from './scenarios.mjs';

export const SPEEDS = Object.freeze([1, 2, 4, 8]);
const AUDIENCES = ['casual', 'analyst'];
const LOCALES = ['en', 'es'];
const err = (status, msg) => Object.assign(new Error(msg), {status});

export function parseView(src = {}) {
  const team = src.team ?? TEAMS[0], audience = src.audience ?? 'casual', locale = src.locale ?? 'en';
  if (!TEAMS.includes(team)) throw err(400, 'Unknown team');
  if (!AUDIENCES.includes(audience)) throw err(400, 'Unknown audience');
  if (!LOCALES.includes(locale)) throw err(400, 'Unknown locale');
  return {team, audience, locale};
}
export function parseSpeed(value) {
  const n = value === undefined || value === null || value === '' ? 1 : Number(value);
  if (!SPEEDS.includes(n)) throw err(400, 'Speed must be one of ' + SPEEDS.join(', '));
  return n;
}
export function parseCount(value, total) {
  const n = typeof value === 'string' && /^[0-9]{1,4}$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(n) || n < 0 || n > total) throw err(400, 'count must be 0..' + total);
  return n;
}
// EventSource reconnects send Last-Event-ID (= last delivered count); it wins over ?from.
export function resumeCursor(lastEventId, from, total) {
  const raw = lastEventId !== undefined && lastEventId !== null && lastEventId !== '' ? lastEventId : (from ?? '0');
  return parseCount(String(raw), total);
}
// Wall-clock pause before the next event, compressed from synthetic match time.
export function delayMs(gapSeconds, speed) {
  return Math.round(Math.min(1800, 240 + Math.max(0, gapSeconds) * 30) / speed);
}

export function createSessionStore({maxSessions = 64, idleMs = 20 * 60 * 1000, now = () => Date.now()} = {}) {
  if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 1000) throw new TypeError('Invalid maxSessions');
  const sessions = new Map();
  // Generated fixtures are immutable and may be shared by independent viewer sessions.
  // Weak keys let expired/evicted scenarios release their bounded replay checkpoints.
  const timelines = new WeakMap();
  const touch = (s) => { s.lastSeen = now(); sessions.delete(s.id); sessions.set(s.id, s); };
  const endStream = (s) => {
    const st = s.stream;
    if (!st) return;
    s.stream = null;
    st.active = false;
    try { st.onClose(); } catch {}
  };
  function drop(id) {
    const s = sessions.get(id);
    if (!s) return false;
    endStream(s);
    sessions.delete(id);
    return true;
  }
  function create(scenario, seed) {
    scenario = parseScenario(scenario); seed = parseSeed(seed);
    const events = generateMatch(scenario, seed);
    return register(scenario, seed, events);
  }
  // Restore retained source events before the MS15 timeline is initialized.
  // Every reopened viewer gets a distinct session and immutable event array.
  function restore({scenario, seed, events} = {}) {
    scenario = parseScenario(scenario); seed = parseSeed(seed);
    validateFixture(events);
    const retained = Object.freeze(events.map(({id, second, type, team, player, zone}) =>
      Object.freeze({id, second, type, team, player, zone})));
    return register(scenario, seed, retained);
  }
  function register(scenario, seed, events) {
    while (sessions.size >= maxSessions) drop(sessions.keys().next().value);
    const s = {id: randomUUID(), scenario, seed, events, lastSeen: now(), stream: null};
    sessions.set(s.id, s);
    return describe(s);
  }
  function describe(s) {
    const sc = SCENARIOS[s.scenario];
    return {id: s.id, scenario: s.scenario, seed: s.seed, label: sc.label, blurb: sc.blurb,
      total: s.events.length, teams: TEAMS, data: 'synthetic'};
  }
  function get(id) {
    const s = typeof id === 'string' ? sessions.get(id) : undefined;
    if (!s) throw err(404, 'Match session expired; start a new match');
    touch(s);
    return s;
  }
  // Frame at prefix `count`; includePrefix adds the observed events (for seek/step).
  function frame(id, count, view, {includePrefix = false} = {}) {
    const s = get(id);
    count = parseCount(count, s.events.length);
    view = parseView(view);
    let timeline = timelines.get(s.events);
    if (!timeline) { timeline = createReplayTimeline(s.events); timelines.set(s.events, timeline); }
    const rivalTeam = TEAMS.find((t) => t !== view.team);
    const out = {sessionId: s.id, count, total: s.events.length, event: count ? s.events[count - 1] : null,
      ...timeline.snapshot(count, view),
      rival: {team: rivalTeam, stats: timeline.stats(count, rivalTeam)}};
    if (includePrefix) out.events = s.events.slice(0, count);
    return out;
  }
  // One live stream per session: a newer attach closes the older one.
  function attachStream(id, onClose) {
    const s = get(id);
    endStream(s);
    const st = {active: true, onClose: typeof onClose === 'function' ? onClose : () => {}};
    s.stream = st;
    return {
      isCurrent: () => st.active && s.stream === st && sessions.get(s.id) === s,
      release() { if (s.stream === st) { s.stream = null; st.active = false; } },
      touch: () => touch(s),
    };
  }
  function sweep() {
    const at = now();
    for (const [id, s] of sessions) if (!s.stream && at - s.lastSeen > idleMs) drop(id);
  }
  return {create, restore, get, describe: (id) => describe(get(id)), frame, attachStream, drop, sweep,
    size: () => sessions.size, streams: () => [...sessions.values()].filter((s) => s.stream).length};
}

