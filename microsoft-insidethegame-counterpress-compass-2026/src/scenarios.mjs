// Seeded synthetic match generator. Output matches the existing engine schema:
// {id:'e###', second, type, team, player, zone}. There are no coordinates or goals,
// because the engine schema does not include them. Every event is labelled synthetic upstream.
import {TEAMS, WINDOW_SECONDS, validateFixture} from './engine.mjs';

export const SEED_MAX = 999999;
export const MATCH_SECONDS = 5400;

const S = (o) => Object.freeze(o);
export const SCENARIOS = Object.freeze({
  'high-press': S({label: 'High-press derby', blurb: 'Both sides hunt the ball straight after losing it.',
    press: [0.85, 0.8], regain: [0.55, 0.5], attack: [0.45, 0.45], shot: [0.22, 0.22], passes: 4, gap: [3, 8], lateBoost: null}),
  'low-block': S({label: 'Harbor pressure vs Metro low block', blurb: 'Harbor keep the ball and counterpress; Metro sit deep and break quickly.',
    press: [0.75, 0.2], regain: [0.45, 0.3], attack: [0.55, 0.25], shot: [0.18, 0.35], passes: 6, gap: [2.5, 6], lateBoost: null}),
  'end-to-end': S({label: 'End-to-end chaos', blurb: 'Loose, fast transitions with few sustained presses.',
    press: [0.4, 0.45], regain: [0.3, 0.35], attack: [0.6, 0.6], shot: [0.35, 0.35], passes: 2, gap: [2, 5], lateBoost: null}),
  'late-siege': S({label: 'Second-half comeback push', blurb: 'A cagey first half, then Harbor push bodies forward after the break.',
    press: [0.35, 0.5], regain: [0.35, 0.4], attack: [0.35, 0.4], shot: [0.2, 0.25], passes: 4, gap: [3, 8], lateBoost: 0}),
});
export const DEFAULT_SCENARIO = 'high-press';

const badRequest = (msg) => Object.assign(new TypeError(msg), {status: 400});

export function scenarioList() {
  return Object.entries(SCENARIOS).map(([id, s]) => ({id, label: s.label, blurb: s.blurb}));
}
export function parseScenario(value) {
  if (typeof value !== 'string' || !Object.hasOwn(SCENARIOS, value)) throw badRequest('Unknown scenario');
  return value;
}
export function parseSeed(value) {
  const n = typeof value === 'string' && /^[0-9]{1,6}$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(n) || n < 1 || n > SEED_MAX) throw badRequest('Seed must be an integer 1..' + SEED_MAX);
  return n;
}

function mulberry32(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashText(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const MIRROR = {attacking: 'defensive', defensive: 'attacking', middle: 'middle'};
const cache = new Map();
const CACHE_MAX = 32;

// Deterministic: identical (scenario, seed) always yields identical events.
// Counterpress pressure/regain events are placed strictly inside the inclusive 8s window;
// a non-regained loss is always followed by an opponent event strictly after the window.
export function generateMatch(scenario, seed) {
  parseScenario(scenario); parseSeed(seed);
  const key = scenario + ':' + seed;
  if (cache.has(key)) return cache.get(key);
  const cfg = SCENARIOS[scenario];
  const r = mulberry32((hashText(scenario) ^ Math.imul(seed, 2654435761)) >>> 0);
  const events = [];
  let t = 0;
  const push = (second, ti, type, zone, player) => {
    t = Math.max(t, Math.round(second * 10) / 10);
    events.push(Object.freeze({id: 'e' + String(events.length + 1).padStart(3, '0'), second: t, type,
      team: TEAMS[ti], player: player ?? (ti ? 'M' : 'H') + (2 + Math.floor(r() * 9)), zone}));
  };
  push(0, 0, 'clock', 'middle', '');
  let poss = r() < 0.5 ? 0 : 1;
  t = 1;
  while (t < 5200 && events.length < 940) {
    const ti = poss, op = 1 - ti;
    const late = t > 2700 && cfg.lateBoost === ti;
    const k = late ? 1.6 : 1;
    const attack = Math.min(0.8, cfg.attack[ti] * k);
    const press = Math.min(0.95, cfg.press[ti] * k);
    const regain = Math.min(0.8, cfg.regain[ti] * (late ? 1.3 : 1));
    let zone = r() < attack ? 'attacking' : r() < 0.6 ? 'middle' : 'defensive';
    const passes = 1 + Math.floor(r() * cfg.passes);
    for (let i = 0; i < passes; i++) {
      push(t + cfg.gap[0] + r() * (cfg.gap[1] - cfg.gap[0]), ti, 'pass', zone);
      if (zone !== 'attacking' && r() < attack * 0.5) zone = zone === 'defensive' ? 'middle' : 'attacking';
    }
    if (zone === 'attacking' && r() < Math.min(0.7, cfg.shot[ti] * k)) {
      push(t + 1.5 + r() * 3, ti, 'shot', 'attacking');
      push(t + 8 + r() * 12, op, 'pass', 'defensive');
      poss = op;
      continue;
    }
    push(t + 1.5 + r() * 4, ti, 'loss', zone);
    const lossAt = t;
    let regained = false;
    if (r() < press) {
      const n = 1 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) push(Math.min(lossAt + WINDOW_SECONDS - 0.6, t + 0.7 + r() * 2), ti, 'pressure', zone);
      if (r() < regain) { push(Math.min(lossAt + WINDOW_SECONDS - 0.2, t + 0.5 + r() * 2.2), ti, 'regain', zone); regained = true; }
    }
    if (regained) { t += 2 + r() * 4; continue; }
    push(Math.max(t, lossAt + WINDOW_SECONDS) + 0.6 + r() * 3, op, 'pass', MIRROR[zone]);
    poss = op;
    if (r() < 0.12) t += 15 + r() * 45;
  }
  push(MATCH_SECONDS, 0, 'clock', 'middle', '');
  validateFixture(events);
  const out = Object.freeze(events);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, out);
  return out;
}
