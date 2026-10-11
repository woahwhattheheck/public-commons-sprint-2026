// Counterpress Compass: event-time-only tactical evidence, no provider inference.
export const TEAMS = Object.freeze(['Harbor FC', 'Metro Rovers']);
export const WINDOW_SECONDS = 8;
const TYPES = new Set(['loss', 'pressure', 'regain', 'pass', 'shot', 'clock']);
const ZONES = new Set(['defensive', 'middle', 'attacking']);

export function validateFixture(events) {
  if (!Array.isArray(events) || events.length > 1000) throw new TypeError('Event array must be at most 1000 items');
  const seen = new Set();
  let last = -1;
  for (const e of events) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw new TypeError('Event must be an object');
    if (typeof e.id !== 'string' || !/^e[0-9]{3,6}$/.test(e.id) || seen.has(e.id)) throw new TypeError('Event ID invalid or repeated');
    if (typeof e.second !== 'number' || !Number.isFinite(e.second) || e.second < 0 || e.second > 5400 || e.second < last) throw new TypeError('Events must have monotone finite seconds');
    if (!TEAMS.includes(e.team) || !TYPES.has(e.type) || !ZONES.has(e.zone)) throw new TypeError('Unknown synthetic team, event type or field zone');
    if (typeof e.player !== 'string' || e.player.length > 48 || /[<>]/.test(e.player)) throw new TypeError('Player label invalid');
    seen.add(e.id); last = e.second;
  }
  return events;
}

const freezeAttempt = (attempt, status, endSecond, closingEvent) => ({
  id: attempt.loss.id,
  team: attempt.loss.team,
  fromSecond: attempt.loss.second,
  toSecond: endSecond,
  secondsToRecover: status === 'success' ? Math.round((endSecond - attempt.loss.second) * 10) / 10 : null,
  zone: attempt.loss.zone,
  status,
  pressureCount: attempt.pressures.length,
  evidenceIds: [attempt.loss.id, ...attempt.pressures.map(p => p.id), ...(closingEvent ? [closingEvent.id] : [])],
});

const newState = () => ({active: new Map(), finished: []});
const copyState = state => ({
  active: new Map([...state.active].map(([team, a]) => [team, {loss: a.loss, pressures: a.pressures.slice()}])),
  finished: state.finished.slice(),
});
const byLoss = (a, b) => a.fromSecond - b.fromSecond || a.id.localeCompare(b.id);

// One event transition is shared by stateless analysis and incremental playback.
// The strictly later watermark preserves regains at the inclusive 8s boundary.
function advance(state, e) {
  const {active, finished} = state;
  for (const [team, a] of active) {
    if (e.second > a.loss.second + WINDOW_SECONDS) {
      finished.push(freezeAttempt(a, a.pressures.length ? 'expired' : 'not_attempted', a.loss.second + WINDOW_SECONDS));
      active.delete(team);
    }
  }
  if (e.type === 'loss') {
    const old = active.get(e.team);
    if (old) finished.push(freezeAttempt(old, old.pressures.length ? 'interrupted' : 'not_attempted', e.second, e));
    active.set(e.team, {loss: e, pressures: []});
  } else if (e.type === 'pressure') {
    const a = active.get(e.team);
    if (a && e.second <= a.loss.second + WINDOW_SECONDS && e.second >= a.loss.second) a.pressures.push(e);
  } else if (e.type === 'regain') {
    const a = active.get(e.team);
    if (a && e.second <= a.loss.second + WINDOW_SECONDS && e.second >= a.loss.second) {
      finished.push(freezeAttempt(a, a.pressures.length ? 'success' : 'not_attempted', e.second, e));
      active.delete(e.team);
    }
  }
}

// Closing a window needs a real later event-time watermark; silence never implies failure.
export function derive(events) {
  validateFixture(events);
  const state = newState();
  for (const e of events) advance(state, e);
  return state.finished.sort(byLoss);
}

function parseSnapshotView({team = TEAMS[0], audience = 'casual', locale = 'en'} = {}) {
  if (!TEAMS.includes(team) || !['casual', 'analyst'].includes(audience) || !['en', 'es'].includes(locale)) throw new TypeError('Unsupported team, audience or locale');
  return {team, audience, locale};
}

function projectTeam(derived, team) {
  const actionable = [];
  let lossWindows = 0, successes = 0, resolved = 0, interrupted = 0, seconds = 0;
  for (const x of derived) {
    if (x.team !== team) continue;
    lossWindows += 1;
    if (x.status === 'not_attempted') continue;
    actionable.push(x);
    if (x.status === 'success') { successes += 1; seconds += x.secondsToRecover; }
    if (x.status === 'success' || x.status === 'expired') resolved += 1;
    if (x.status === 'interrupted') interrupted += 1;
  }
  return {actionable, pendingEvidence: lossWindows - actionable.length,
    stats: {lossWindows, counterpressAttempts: actionable.length, successes,
      resolvedCounterpressAttempts: resolved, interruptedAttempts: interrupted,
      successRatePct: resolved ? Math.round(100 * successes / resolved) : null,
      successRateBasis: 'resolved_counterpress_attempts',
      meanRecoverySeconds: successes ? Math.round((seconds / successes) * 10) / 10 : null}};
}

function renderProjection({actionable, pendingEvidence, stats}, elapsedSeconds, {team, audience, locale}) {
  const overlays = actionable.map(x => ({
    id: x.id,
    showAt: x.toSecond,
    hideAt: x.toSecond + 10,
    team,
    evidenceIds: x.evidenceIds,
    status: x.status,
    text: describe(x, audience, locale),
    metrics: {pressureCount: x.pressureCount, secondsToRecover: x.secondsToRecover, windowSeconds: WINDOW_SECONDS,
      observedSeconds: Math.round((x.toSecond - x.fromSecond) * 10) / 10, zone: x.zone},
    provenance: 'SYNTHETIC FIXTURE · DETERMINISTIC EVENT LOG',
  }));
  return {team, audience, locale, elapsedSeconds, stats: {...stats}, overlays, pendingEvidence,
    provenance: 'SYNTHETIC MATCH ONLY · NOT REAL PREMIER LEAGUE DATA'};
}

export function makeSnapshot(events, options = {}) {
  const view = parseSnapshotView(options);
  return renderProjection(projectTeam(derive(events), view.team), events.length ? events.at(-1).second : 0, view);
}

/** Incremental replay of one immutable fixture; the public snapshot shape is unchanged.
 * At most 16 saved states for the existing 1000-event limit. After a backward seek,
 * replay starts from the nearest 64-event checkpoint; an unseen prefix is consumed once.
 * Checkpoints retain active windows, so an inclusive-boundary regain is never lost.
 */
export function createReplayTimeline(events) {
  const source = validateFixture(events).map(e => Object.freeze({...e}));
  const checkpoints = new Map([[0, newState()]]);
  let state = newState(), cursor = 0, revision = -1, ordered = [];
  const teams = new Map(), views = new Map();
  function seek(count) {
    if (!Number.isInteger(count) || count < 0 || count > source.length) throw new TypeError('Invalid replay event count');
    let nearest = 0;
    for (const at of checkpoints.keys()) if (at <= count && at > nearest) nearest = at;
    if (count < cursor || nearest > cursor) {
      state = copyState(checkpoints.get(nearest)); cursor = nearest; revision = -1;
    }
    while (cursor < count) {
      advance(state, source[cursor++]);
      if (cursor % 64 === 0 && !checkpoints.has(cursor)) checkpoints.set(cursor, copyState(state));
    }
    if (revision !== state.finished.length) {
      ordered = state.finished.slice().sort(byLoss);
      teams.clear(); views.clear(); revision = state.finished.length;
    }
  }
  function projection(team) {
    if (!teams.has(team)) teams.set(team, projectTeam(ordered, team));
    return teams.get(team);
  }
  function snapshot(count, options = {}) {
    const view = parseSnapshotView(options);
    seek(count);
    const key = view.team + ':' + view.audience + ':' + view.locale;
    if (!views.has(key)) {
      const template = renderProjection(projection(view.team), 0, view);
      // Cached evidence cannot be mutated by one caller and leak into another viewer.
      for (const overlay of template.overlays) {
        Object.freeze(overlay.evidenceIds); Object.freeze(overlay.metrics); Object.freeze(overlay);
      }
      Object.freeze(template.overlays);
      views.set(key, template);
    }
    const template = views.get(key);
    return {...template, stats: {...template.stats}, elapsedSeconds: count ? source[count - 1].second : 0};
  }
  function stats(count, team) {
    if (!TEAMS.includes(team)) throw new TypeError('Unsupported team');
    seek(count);
    return {...projection(team).stats};
  }
  return Object.freeze({snapshot, stats});
}

function describe(x, audience, locale) {
  if (x.status === 'interrupted') {
    const observed = Math.round((x.toSecond - x.fromSecond) * 10) / 10;
    if (locale === 'es') return audience === 'casual'
      ? `${x.team}: observación interrumpida tras ${observed} segundos; resultado desconocido.`
      : `Contrapresión: ${x.pressureCount} acciones; observación interrumpida a los ${observed}s; resultado desconocido.`;
    return audience === 'casual'
      ? `${x.team}: observation interrupted after ${observed} seconds; outcome unknown.`
      : `Counterpress: ${x.pressureCount} pressure actions; observation interrupted at ${observed}s; outcome unknown.`;
  }
  const success = x.status === 'success';
  const duration = String(x.secondsToRecover);
  if (locale === 'es') return audience === 'casual'
    ? (success ? `${x.team} recupera el balón en ${duration} segundos tras presionar.` : `${x.team} presiona, pero no recupera en 8 segundos.`)
    : (success ? `Contrapresión: ${x.pressureCount} acciones; recuperación en ${duration}s; zona ${x.zone}.` : `Contrapresión sin recuperación: ${x.pressureCount} acciones; ventana de 8s.`);
  return audience === 'casual'
    ? (success ? `${x.team} won the ball back in ${duration} seconds after pressing.` : `${x.team} pressed but did not regain the ball within eight seconds.`)
    : (success ? `Counterpress: ${x.pressureCount} pressure actions, regained in ${duration}s, ${x.zone} third.` : `Counterpress without regain: ${x.pressureCount} pressure actions, eight-second window.`);
}

