// Assemble editable broadcast stories from the existing canonical player recap.
import {buildPlayerRecap, recapTime} from './player_recap.mjs';
import {normalizeBroadcast, MAX_BROADCAST_CUES} from './broadcast_handover.mjs';

export const RUNDOWN_FORMAT = 'counterpress.broadcast-rundown.v1';
const fail = message => Object.assign(new Error(message), {status: 400});
const PERIODS = ['all', 'first', 'second'];
const FOCUSES = ['balanced', 'recoveries'];
const COMPLETE = new Set(['success', 'expired', 'interrupted']);
const text = {
  en: {
    all: 'Whole observed match', first: 'First half', second: 'Second half',
    balanced: 'Match story', recoveries: 'Recovery highlights', allPlayers: 'All players',
    firstReason: 'First-half coverage', secondReason: 'Second-half coverage',
    successReason: 'Recovery example', expiredReason: 'Expired-window example',
    interruptedReason: 'Interrupted sequence', spreadReason: 'Coverage across the observed match',
    openingReason: 'Opening selection', source: 'Original synthetic match',
    scope: 'Selected plays are shown in match order. Team rates describe the full chosen period.',
    method: 'The draft combines period coverage and observed outcomes, then spreads additional plays across the available match.',
    recoveryMethod: 'The draft uses completed recoveries, covers both observed halves when possible, and spreads additional plays across the available match.',
  },
  es: {
    all: 'Partido observado completo', first: 'Primera parte', second: 'Segunda parte',
    balanced: 'Historia del partido', recoveries: 'Recuperaciones destacadas', allPlayers: 'Todos los jugadores',
    firstReason: 'Cobertura de la primera parte', secondReason: 'Cobertura de la segunda parte',
    successReason: 'Ejemplo de recuperación', expiredReason: 'Ejemplo de ventana agotada',
    interruptedReason: 'Secuencia interrumpida', spreadReason: 'Cobertura del partido observado',
    openingReason: 'Selección inicial', source: 'Partido sintético original',
    scope: 'Las jugadas seleccionadas siguen el orden del partido. Las tasas del equipo describen todo el periodo elegido.',
    method: 'El borrador combina la cobertura de cada parte y los resultados observados; después distribuye las jugadas adicionales por el partido disponible.',
    recoveryMethod: 'El borrador usa recuperaciones resueltas, cubre ambas partes observadas cuando es posible y distribuye las jugadas adicionales por el partido disponible.',
  },
};
const chronology = (a, b) => a.fromSecond - b.fromSecond || a.id.localeCompare(b.id);
function quality(player) {
  const personalRegain = item => player !== null && item.evidence.some(event => event.player === player && event.role === 'regain');
  return (a, b) => Number(personalRegain(b)) - Number(personalRegain(a)) ||
    Number(b.status === 'success') - Number(a.status === 'success') ||
    b.pressureCount - a.pressureCount ||
    (a.secondsToRecover ?? Infinity) - (b.secondsToRecover ?? Infinity) || chronology(a, b);
}

/**
 * This chooses an editorial subset; all football classifications, half boundaries,
 * player roles, captions and exact closure prefixes come from buildPlayerRecap().
 * Existing cues are excluded by original moment ID and never rewritten here.
 */
export function createBroadcastRundown(match, rawBroadcast, options = {}) {
  const broadcast = normalizeBroadcast(rawBroadcast, match);
  if (!broadcast) throw fail('Open a broadcast handover before building its rundown');
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw fail('Rundown selection must be an object');
  const player = options.player ?? null, period = options.period ?? 'all';
  const focus = options.focus ?? 'balanced', limit = options.limit ?? 5;
  if (!PERIODS.includes(period) || !FOCUSES.includes(focus) || !Number.isInteger(limit) || limit < 1 || limit > 12)
    throw fail('Choose a match period, story focus and 1 to 12 plays');
  let recap;
  try {
    recap = buildPlayerRecap(match.events.slice(0, broadcast.count), {
      team: broadcast.view.team, player, period, locale: broadcast.view.locale,
    });
  } catch (error) { throw Object.assign(error, {status: 400}); }
  const W = text[broadcast.view.locale], existing = new Set(broadcast.cues.map(cue => cue.momentId).filter(Boolean));
  const eligible = recap.sequences.filter(item => COMPLETE.has(item.status) && item.pressureCount > 0 &&
    (focus !== 'recoveries' || item.status === 'success'));
  const available = eligible.filter(item => !existing.has(item.id));
  const remainingSlots = MAX_BROADCAST_CUES - broadcast.cues.length;
  const target = Math.min(limit, remainingSlots, available.length), rank = quality(player);
  const chosen = new Map();
  const add = (items, reason) => {
    if (chosen.size >= target) return;
    const item = items.filter(item => !chosen.has(item.id)).slice().sort(rank)[0];
    if (item) chosen.set(item.id, {item, reason});
  };
  // Cover both halves when they each contain an available play and two slots exist.
  if (period === 'all' && target >= 2 &&
      available.some(item => item.period === 'first') && available.some(item => item.period === 'second')) {
    add(available.filter(item => item.period === 'first'), W.firstReason);
    add(available.filter(item => item.period === 'second'), W.secondReason);
  }
  if (focus === 'balanced') {
    for (const [outcome, reason] of [['success', W.successReason], ['expired', W.expiredReason], ['interrupted', W.interruptedReason]]) {
      if (![...chosen.values()].some(({item}) => item.status === outcome))
        add(available.filter(item => item.status === outcome), reason);
    }
  }
  if (!chosen.size) add(available, W.openingReason);
  while (chosen.size < target) {
    const distance = item => Math.min(...[...chosen.values()].map(({item: selected}) => Math.abs(item.fromSecond - selected.fromSecond)));
    const rest = available.filter(item => !chosen.has(item.id)).sort((a, b) => distance(b) - distance(a) || rank(a, b));
    if (!rest.length) break;
    chosen.set(rest[0].id, {item: rest[0], reason: W.spreadReason});
  }
  const cues = [...chosen.values()].sort((a, b) => chronology(a.item, b.item)).map(({item, reason}) => {
    const personal = player !== null && item.evidence.some(event => event.player === player && event.role === 'regain');
    const detail = personal ? (broadcast.view.locale === 'es' ? player + ' recuperó el balón' : player + ' regained the ball') : '';
    const at = recapTime(item.fromSecond) +
      (broadcast.view.audience === 'analyst' ? '–' + recapTime(item.toSecond) : '');
    return {
      key: 'moment:' + item.id, momentId: item.id, eventId: item.closureEventId, count: item.endCount,
      startCount: item.startCount, team: item.team, period: item.period, status: item.status,
      fromSecond: item.fromSecond, toSecond: item.toSecond, availableAtSecond: item.observedThroughSecond,
      title: item.title, caption: item.team + ' · ' + at + '. ' + item.text,
      reason: reason + (detail ? ' · ' + detail : ''),
      evidence: item.evidence, watermark: item.watermark, roles: item.roles,
      videoStart: null, videoEnd: null,
    };
  });
  const title = (W[focus] + ' · ' + (player || broadcast.view.team)).slice(0, 100);
  const brief = [...recap.narrative, W.scope].join('\n\n');
  return {
    format: RUNDOWN_FORMAT,
    selection: {...recap.selection, audience: broadcast.view.audience, focus, limit},
    source: {count: broadcast.count, total: match.events.length, scenario: match.scenario, seed: match.seed,
      observedThroughSecond: recap.coverage.throughSecond, lastActionSecond: recap.coverage.lastActionSecond},
    title, brief, narrative: recap.narrative, method: focus === 'recoveries' ? W.recoveryMethod : W.method,
    coverage: recap.coverage, teamStats: recap.teamStats, selectedStats: recap.selectedStats,
    counts: {eligible: eligible.length, available: available.length, alreadyIncluded: eligible.length - available.length,
      remainingSlots, selected: cues.length, requested: limit},
    eligibleMomentIds: eligible.map(item => item.id), cues,
  };
}
