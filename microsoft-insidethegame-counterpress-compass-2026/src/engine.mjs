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

// The first same-team regain can resolve exactly one active loss window.
// Closing a window needs a real later event-time watermark; silence never implies failure.
export function derive(events) {
  validateFixture(events);
  const active = new Map();
  const finished = [];
  for (const e of events) {
    for (const [team, a] of active.entries()) {
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
  if (events.length) {
    const watermark = events.at(-1).second;
    for (const a of active.values()) {
      // Equal timestamps can still contain an inclusive-boundary regain.
      // Only a strictly later event proves that the entire window was observed.
      if (watermark > a.loss.second + WINDOW_SECONDS) {
        finished.push(freezeAttempt(a, a.pressures.length ? 'expired' : 'not_attempted', a.loss.second + WINDOW_SECONDS));
      }
    }
  }
  finished.sort((a, b) => a.fromSecond - b.fromSecond || a.id.localeCompare(b.id));
  return finished;
}

export function makeSnapshot(events, {team = TEAMS[0], audience = 'casual', locale = 'en'} = {}) {
  if (!TEAMS.includes(team) || !['casual', 'analyst'].includes(audience) || !['en', 'es'].includes(locale)) throw new TypeError('Unsupported team, audience or locale');
  const attempts = derive(events).filter(x => x.team === team);
  const actionable = attempts.filter(x => x.status !== 'not_attempted');
  // A second loss without a recorded regain leaves the earlier outcome unknown.
  // Keep that press in the attempt count, but not in the resolved-window rate.
  const resolved = actionable.filter(x => x.status === 'success' || x.status === 'expired');
  const interrupted = actionable.filter(x => x.status === 'interrupted');
  const successes = actionable.filter(x => x.status === 'success');
  const seconds = successes.reduce((sum, s) => sum + s.secondsToRecover, 0);
  const avgSeconds = successes.length ? Math.round((seconds / successes.length) * 10) / 10 : null;
  const rate = resolved.length ? Math.round(100 * successes.length / resolved.length) : null;
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
  return {team, audience, locale, elapsedSeconds: events.length ? events.at(-1).second : 0,
    stats: {lossWindows: attempts.length, counterpressAttempts: actionable.length, successes: successes.length,
      resolvedCounterpressAttempts: resolved.length, interruptedAttempts: interrupted.length,
      successRatePct: rate, successRateBasis: 'resolved_counterpress_attempts', meanRecoverySeconds: avgSeconds},
    overlays, pendingEvidence: attempts.length - actionable.length,
    provenance: 'SYNTHETIC MATCH ONLY · NOT REAL PREMIER LEAGUE DATA'};
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
