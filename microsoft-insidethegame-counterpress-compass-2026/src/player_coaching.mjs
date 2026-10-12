// Player coaching across retained matches. All event and window accounting comes
// from the existing recap core; comparison choices do not change source events.
import {buildPlayerRecap, recapTime} from './player_recap.mjs';

export const PLAYER_COACHING_FORMAT = 'counterpress.player-coaching.v1';
const ACTIONS = ['loss', 'pressure', 'regain', 'pass', 'shot'];
const OUTCOMES = ['all', 'success', 'expired', 'interrupted', 'not_attempted', 'pending'];
const COUNTS = ['observedLosses', 'closedLossWindows', 'pressingWindows', 'successes',
  'expiredAttempts', 'interruptedAttempts', 'notAttemptedWindows', 'pendingWindows',
  'pendingPressingWindows', 'resolvedAttempts', 'actionCount', 'sequenceInvolvements',
  'successfulRegainActions'];
const fail = message => Object.assign(new TypeError(message), {status: 400});
const copy = value => JSON.parse(JSON.stringify(value));
const percent = (n, d) => d ? Math.round(n * 1000 / d) / 10 : null;

export function parsePlayerCoachingFocus(value = {}) {
  if (value === null) value = {};
  if (typeof value !== 'object' || Array.isArray(value)) throw fail('Choose a player coaching selection');
  const player = value.player == null || value.player === '' ? null : value.player;
  if (player !== null && (typeof player !== 'string' || !player.trim() || player.length > 48 || /[<>]/.test(player)))
    throw fail('Choose a player label from the original events');
  const outcome = value.outcome ?? 'all';
  if (!OUTCOMES.includes(outcome)) throw fail('Choose an observed sequence outcome');
  return {player, outcome};
}

function pooled(matches, field) {
  const rows = matches.map(match => match[field]);
  const result = Object.fromEntries(COUNTS.map(key => [key, rows.reduce((n, row) => n + row[key], 0)]));
  result.actions = Object.fromEntries(ACTIONS.map(key => [key, rows.reduce((n, row) => n + row.actions[key], 0)]));
  const roleNames = [...new Set(rows.flatMap(row => Object.keys(row.roles)))];
  result.roles = Object.fromEntries(roleNames.map(key => [key, rows.reduce((n, row) => n + (row.roles[key] || 0), 0)]));
  result.pressFrequencyNumerator = result.pressingWindows;
  result.pressFrequencyDenominator = result.observedLosses;
  result.pressFrequencyPct = percent(result.pressingWindows, result.observedLosses);
  result.regainEfficiencyNumerator = result.successes;
  result.regainEfficiencyDenominator = result.resolvedAttempts;
  result.regainEfficiencyPct = percent(result.successes, result.resolvedAttempts);
  result.rateBasis = 'sum_original_numerators_and_denominators';
  return result;
}

/**
 * documents contain an original saved-match identity and its selected event
 * prefix, already read through the normal archive. Cutoffs remain per match.
 */
export function buildPlayerCoaching(documents, {view, period = 'all', focus = {}, generatedAt = null, includeSource = true} = {}) {
  if (!Array.isArray(documents) || documents.length < 2 || documents.length > 4 ||
      documents.some(item => !item || typeof item.id !== 'string' || !Array.isArray(item.events)) ||
      new Set(documents.map(item => item.id)).size !== documents.length)
    throw fail('Choose two to four distinct saved matches for player coaching');
  if (!view || !['all', 'first', 'second'].includes(period)) throw fail('Choose the coaching view and half');
  if (typeof includeSource !== 'boolean') throw fail('Choose whether to include original source events');
  focus = parsePlayerCoachingFocus(focus);
  const players = new Map();
  const matches = documents.map(document => {
    const recap = buildPlayerRecap(document.events, {team: view.team, player: focus.player, period, locale: view.locale});
    if (!Number.isInteger(document.total) || document.total < document.events.length ||
        !/^[0-9a-f]{64}$/.test(document.sourceSha256 || ''))
      throw fail('Use the complete original match identity and selected event prefix');
    for (const item of recap.players) {
      const row = players.get(item.player) || {player: item.player, matches: 0, actionCount: 0};
      row.matches++; row.actionCount += item.actionCount; players.set(item.player, row);
    }
    return {
      id: document.id, title: document.title, revision: document.revision,
      scenario: document.scenario, seed: document.seed, sourceSha256: document.sourceSha256,
      count: document.events.length, total: document.total,
      observedThroughSecond: recap.coverage.throughSecond,
      playerObserved: recap.selection.playerObserved, coverage: recap.coverage,
      selectedStats: recap.selectedStats, teamStats: recap.teamStats,
      first: recap.first, second: recap.second, narrative: recap.narrative,
      sequences: recap.sequences, windowSeconds: recap.windowSeconds,
      ...(includeSource ? {sourceEvents: recap.sourceEvents} : {}),
      notes: typeof document.notes === 'string' ? document.notes : '',
    };
  });
  const playlist = matches.flatMap((match, matchIndex) => match.sequences
    .filter(sequence => focus.outcome === 'all' || sequence.status === focus.outcome)
    .map(sequence => ({
      // A sequence ID can recur in another match. Keep the complete identity.
      key: JSON.stringify([match.id, match.sourceSha256, sequence.id]),
      matchIndex, matchId: match.id, sourceSha256: match.sourceSha256,
      sequenceId: sequence.id, status: sequence.status,
      startCount: sequence.startCount, lossCount: sequence.lossCount,
      endCount: sequence.endCount, endEventId: sequence.endEventId,
      fromSecond: sequence.fromSecond, observedThroughSecond: sequence.observedThroughSecond,
    })));
  const sources = new Map();
  for (const match of matches) sources.set(match.sourceSha256, [...(sources.get(match.sourceSha256) || []), match.id]);
  return {
    format: PLAYER_COACHING_FORMAT, generatedAt: generatedAt || new Date().toISOString(),
    view: copy(view), period, focus, windowSeconds: matches[0].windowSeconds, sourceIncluded: includeSource,
    players: [...players.values()].sort((a, b) => a.player.localeCompare(b.player, 'en', {numeric: true})),
    matches, playlist,
    totals: {matches: matches.length, uniqueSources: sources.size,
      matchesWithPlayerActions: matches.filter(match => match.selectedStats.actionCount > 0).length,
      selected: pooled(matches, 'selectedStats'), team: pooled(matches, 'teamStats')},
    duplicateSources: [...sources].filter(([, ids]) => ids.length > 1).map(([sourceSha256, matchIds]) => ({sourceSha256, matchIds})),
    accounting: {
      actions: 'original_player_event_rows_in_selected_half',
      sequenceInvolvement: 'distinct_original_loss_windows_grouped_by_loss_half',
      rates: 'pooled_original_counts',
      outcome: 'playlist_filter_only',
      exposure: 'selected_event_prefixes; no minutes-played estimate',
    },
  };
}

export const PLAYER_COACHING_WORDS = {
  en: {
    heading: 'Player coaching', teamHeading: 'Team coaching', source: 'SYNTHETIC MATCH REVIEW',
    player: 'Player', team: 'Team', allPlayers: 'Whole team', all: 'All outcomes',
    first: 'First half', second: 'Second half', whole: 'Whole observed match',
    success: 'Successful team sequence', expired: 'Expired window', interrupted: 'Interrupted observation',
    not_attempted: 'Without a qualifying press', pending: 'Open window',
    matches: 'Saved matches', sources: 'Distinct event sources', actionCount: 'Performed actions',
    pressure: 'Pressure actions', regain: 'Regain actions', loss: 'Loss actions', pass: 'Pass actions', shot: 'Shot actions',
    sequenceInvolvements: 'Distinct sequence involvements', successes: 'Successful involved team sequences',
    expiredAttempts: 'Expired involved windows', interruptedAttempts: 'Interrupted involved windows',
    pendingWindows: 'Open involved windows', notAttemptedWindows: 'Involved windows without a qualifying press',
    pressFrequency: 'Club press frequency', regainEfficiency: 'Club regain efficiency',
    involvedRate: 'Regains in resolved involved sequences', coverage: 'Observed event prefix',
    periodActions: 'Player actions in this half', noActions: 'No player actions recorded in this selection',
    method: 'Actions use their event time. Sequences use the original loss time, including plays that cross halftime. Rates pool the original counts. Outcome selection filters the playlist; summary counts cover the selected player and half.',
    context: 'Sequence results describe club outcomes involving the selected player. Performed actions and sequence involvements are counted separately.',
    exposure: 'Each match keeps its selected event cutoff and observed clock. These records do not supply player minutes.',
    duplicates: 'Some selected saved matches share the same original event source.',
    playlist: 'Review playlist', match: 'Match', start: 'Loss', end: 'Observed end', outcome: 'Outcome',
    replay: 'Replay original events', previous: 'Previous event', next: 'Next event', play: 'Play events', pause: 'Pause',
    choose: 'Choose a sequence', empty: 'No sequences match this player, half and outcome.',
    notes: 'Coach notes', noNotes: 'No saved coach notes.', halves: 'Both half contexts', half: 'Half',
    saved: 'Saved comparison', print: 'Print brief', sourceDetails: 'Original source',
    events: 'Events in this sequence', event: 'Event', clock: 'Match clock', zone: 'Pitch third',
    action: 'Action', sourcePlayer: 'Player', sourceTeam: 'Club', frame: 'Event prefix',
    closing: 'The highlighted range ends at the original observed closing event.',
    open: 'This window remains open at the selected observation cutoff.',
    report: 'Coaching brief', unknown: '—', originalReview: 'Open saved match',
    selectedThrough: 'Observed through', firstAction: 'First player action', lastAction: 'Last player action',
    defensive: 'Defensive third', middle: 'Middle third', attacking: 'Attacking third', clockEvent: 'Clock observation',
  },
  es: {
    heading: 'Análisis del jugador', teamHeading: 'Análisis del equipo', source: 'ANÁLISIS DE PARTIDOS SINTÉTICOS',
    player: 'Jugador', team: 'Equipo', allPlayers: 'Todo el equipo', all: 'Todos los resultados',
    first: 'Primera parte', second: 'Segunda parte', whole: 'Todo el partido observado',
    success: 'Secuencia del equipo recuperada', expired: 'Ventana agotada', interrupted: 'Observación interrumpida',
    not_attempted: 'Sin presión válida', pending: 'Ventana abierta',
    matches: 'Partidos guardados', sources: 'Orígenes de jugadas distintos', actionCount: 'Acciones realizadas',
    pressure: 'Acciones de presión', regain: 'Acciones de recuperación', loss: 'Pérdidas', pass: 'Pases', shot: 'Disparos',
    sequenceInvolvements: 'Secuencias distintas con participación', successes: 'Secuencias recuperadas con participación',
    expiredAttempts: 'Ventanas agotadas con participación', interruptedAttempts: 'Ventanas interrumpidas con participación',
    pendingWindows: 'Ventanas abiertas con participación', notAttemptedWindows: 'Ventanas sin presión válida con participación',
    pressFrequency: 'Frecuencia de presión del equipo', regainEfficiency: 'Eficacia de recuperación del equipo',
    involvedRate: 'Recuperaciones en secuencias resueltas con participación', coverage: 'Prefijo de jugadas observado',
    periodActions: 'Acciones del jugador en esta parte', noActions: 'Sin acciones del jugador en esta selección',
    method: 'Las acciones usan su propio momento. Las secuencias usan el momento de la pérdida, incluso al cruzar el descanso. Las tasas agrupan los recuentos originales. El resultado filtra la lista; los totales corresponden al jugador y la parte seleccionados.',
    context: 'Los resultados describen secuencias del equipo en las que participa el jugador. Las acciones y las secuencias se cuentan por separado.',
    exposure: 'Cada partido conserva su límite de jugadas y reloj observado. Estos registros no incluyen minutos jugados por el futbolista.',
    duplicates: 'Algunos partidos guardados seleccionados comparten el mismo origen de jugadas.',
    playlist: 'Lista de revisión', match: 'Partido', start: 'Pérdida', end: 'Final observado', outcome: 'Resultado',
    replay: 'Reproducir jugadas originales', previous: 'Jugada anterior', next: 'Jugada siguiente', play: 'Reproducir', pause: 'Pausar',
    choose: 'Elige una secuencia', empty: 'No hay secuencias para este jugador, parte y resultado.',
    notes: 'Notas del entrenador', noNotes: 'Sin notas guardadas.', halves: 'Contexto de ambas partes', half: 'Parte',
    saved: 'Comparación guardada', print: 'Imprimir informe', sourceDetails: 'Origen original',
    events: 'Jugadas de esta secuencia', event: 'Jugada', clock: 'Reloj del partido', zone: 'Tercio del campo',
    action: 'Acción', sourcePlayer: 'Jugador', sourceTeam: 'Equipo', frame: 'Prefijo de jugadas',
    closing: 'El intervalo termina en la jugada de cierre observada original.',
    open: 'Esta ventana sigue abierta en el límite de observación seleccionado.',
    report: 'Informe del entrenador', unknown: '—', originalReview: 'Abrir partido guardado',
    selectedThrough: 'Observado hasta', firstAction: 'Primera acción del jugador', lastAction: 'Última acción del jugador',
    defensive: 'Tercio defensivo', middle: 'Tercio central', attacking: 'Tercio ofensivo', clockEvent: 'Observación del reloj',
  },
};

export function playerCoachingJson(review) {
  if (review?.format !== PLAYER_COACHING_FORMAT || !review.sourceIncluded) throw fail('Export a complete player coaching review');
  return JSON.stringify(review, null, 2) + '\n';
}
const html = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const ratio = (n, d) => n + '/' + d + (d ? ' · ' + percent(n, d) + '%' : ' · —');
const rowsHtml = rows => rows.map(row => '<tr>' + row.map((cell, i) => '<' + (i ? 'td' : 'th scope="row"') + '>' + html(cell) + '</' + (i ? 'td' : 'th') + '>').join('') + '</tr>').join('');
function tableHtml(headers, rows) {
  return '<div class="table-scroll"><table><thead><tr>' + headers.map(value => '<th scope="col">' + html(value) + '</th>').join('') +
    '</tr></thead><tbody>' + rowsHtml(rows) + '</tbody></table></div>';
}

// The portable report keeps every selected original event and plays only an
// explicitly selected original sequence. It needs no server or provider call.
function offlinePlayer() {
  const review = JSON.parse(document.getElementById('review-data').textContent);
  const W = review.words, $ = id => document.getElementById(id);
  const make = (tag, text) => {const item = document.createElement(tag); if (text !== undefined) item.textContent = text; return item;};
  const clock = second => second == null ? '—' : String(Math.floor(second / 60)).padStart(2, '0') + ':' + (Math.round((second % 60) * 10) / 10).toFixed(1).padStart(4, '0');
  let selected = null, position = 0, timer = null;
  function stop() {if (timer !== null) clearInterval(timer); timer = null; $('play').textContent = W.play;}
  function render() {
    if (!selected) return;
    const match = review.matches[selected.matchIndex], sequence = match.sequences.find(item => item.id === selected.sequenceId);
    const event = position ? match.sourceEvents[position - 1] : null;
    $('clip-title').textContent = match.title + ' · ' + (review.focus.player || review.view.team) + ' · ' + W[sequence.status];
    $('clip-context').textContent = clock(sequence.fromSecond) + ' → ' + clock(sequence.observedThroughSecond) + ' · ' + W.frame + ' ' + sequence.startCount + ' → ' + sequence.endCount;
    $('clip-progress').textContent = W.frame + ' ' + position + '/' + match.count + (event ? ' · ' + clock(event.second) : '');
    $('clip-event').textContent = event ? [event.team, event.player || '—', W[event.type] || event.type, W[event.zone] || event.zone].join(' · ') : '—';
    $('clip-status').textContent = sequence.pending ? W.open : W.closing;
    $('previous').disabled = position <= sequence.startCount;
    $('next').disabled = position >= sequence.endCount;
    $('play').disabled = sequence.endCount <= sequence.startCount;
    const body = $('clip-events'); body.replaceChildren();
    const first = Math.max(0, sequence.startCount - 1);
    match.sourceEvents.slice(first, sequence.endCount).forEach((item, offset) => {
      const count = first + offset + 1, row = make('tr'); row.dataset.current = String(count === position);
      [count, item.id, clock(item.second), item.team, item.player || '—', W[item.type] || item.type, W[item.zone] || item.zone].forEach(value => row.append(make('td', String(value))));
      body.append(row);
    });
  }
  function open(index) {
    stop(); selected = review.playlist[index] || null;
    $('clip').hidden = !selected;
    if (!selected) return;
    $('sequence-choice').value = String(index); position = selected.startCount; render();
  }
  review.playlist.forEach((item, index) => {
    const match = review.matches[item.matchIndex], option = make('option', match.title + ' · ' + clock(item.fromSecond) + ' · ' + W[item.status]);
    option.value = String(index); $('sequence-choice').append(option);
  });
  $('sequence-choice').addEventListener('change', event => open(Number(event.target.value)));
  document.querySelectorAll('[data-open-sequence]').forEach(button => button.addEventListener('click', () => {open(Number(button.dataset.openSequence)); $('clip').scrollIntoView({block: 'nearest'});}));
  $('previous').addEventListener('click', () => {stop(); if (selected) position = Math.max(selected.startCount, position - 1); render();});
  $('next').addEventListener('click', () => {stop(); if (selected) position = Math.min(selected.endCount, position + 1); render();});
  $('play').addEventListener('click', () => {
    if (timer !== null) {stop(); return;}
    if (!selected) return;
    if (position >= selected.endCount) position = selected.startCount;
    $('play').textContent = W.pause;
    timer = setInterval(() => {position++; render(); if (position >= selected.endCount) stop();}, 650);
  });
  $('print').addEventListener('click', () => window.print());
  window.addEventListener('pagehide', stop);
  if (review.playlist.length) open(0);
}

export function playerCoachingHtml(review, {title = null, baseUrl = null} = {}) {
  if (review?.format !== PLAYER_COACHING_FORMAT || !review.sourceIncluded ||
      review.matches.some(match => !Array.isArray(match.sourceEvents) || match.sourceEvents.length !== match.count))
    throw fail('Export a complete player coaching review with its original event prefixes');
  const W = PLAYER_COACHING_WORDS[review.view.locale] || PLAYER_COACHING_WORDS.en;
  const heading = title || (review.focus.player ? W.heading + ' · ' + review.focus.player : W.teamHeading + ' · ' + review.view.team);
  const headers = [W.saved, ...review.matches.map(match => match.title)];
  const statRows = ['actionCount', ...ACTIONS, 'sequenceInvolvements', 'successes', 'expiredAttempts', 'interruptedAttempts', 'pendingWindows'].map(key => [
    W[key], ...review.matches.map(match => ACTIONS.includes(key) ? match.selectedStats.actions[key] : match.selectedStats[key]),
  ]);
  statRows.unshift([W.coverage, ...review.matches.map(match => match.count + '/' + match.total + ' · ' + recapTime(match.observedThroughSecond))]);
  statRows.push(
    [W.pressFrequency, ...review.matches.map(match => ratio(match.teamStats.pressingWindows, match.teamStats.observedLosses))],
    [W.regainEfficiency, ...review.matches.map(match => ratio(match.teamStats.successes, match.teamStats.resolvedAttempts))],
  );
  const totals = review.totals.selected;
  const summary = [
    [W.matches, review.totals.matches], [W.actionCount, totals.actionCount],
    [W.pressure, totals.actions.pressure], [W.regain, totals.actions.regain],
    [W.sequenceInvolvements, totals.sequenceInvolvements], [W.successes, totals.successes],
    [W.involvedRate, ratio(totals.successes, totals.resolvedAttempts)],
  ];
  const notes = review.matches.map(match => {
    const halfRows = ['first', 'second'].map(key => [W[key], match[key].selectedStats.actionCount, match[key].selectedStats.actions.regain,
      match[key].selectedStats.sequenceInvolvements, match[key].selectedStats.successes,
      ratio(match[key].teamStats.successes, match[key].teamStats.resolvedAttempts)]);
    const link = typeof baseUrl === 'string' && /^https?:\/\/[^<>\s]+$/.test(baseUrl) ? baseUrl.split(/[?#]/)[0] +
      '#saved=1&archive=' + encodeURIComponent(match.id) + '&event=' + match.count + '&team=' + encodeURIComponent(review.view.team) +
      '&audience=' + encodeURIComponent(review.view.audience) + '&locale=' + encodeURIComponent(review.view.locale) : null;
    return '<section class="panel"><h2>' + html(match.title) + '</h2><p class="meta">' + html(W.coverage + ': ' + match.count + '/' + match.total + ' · ' + recapTime(match.observedThroughSecond)) +
      '</p><h3>' + html(W.notes) + '</h3><p class="notes">' + html(match.notes || W.noNotes) + '</p><h3>' + html(W.halves) + '</h3>' +
      tableHtml([W.half, W.actionCount, W.regain, W.sequenceInvolvements, W.successes, W.regainEfficiency], halfRows) +
      '<details class="source"><summary>' + html(W.sourceDetails) + '</summary><p>' + html(match.scenario + ' · ' + match.seed) +
      '</p><p>' + html(match.sourceSha256) + '</p>' + (link ? '<a href="' + html(link) + '">' + html(W.originalReview) + '</a>' : '') + '</details></section>';
  }).join('');
  const playlistRows = review.playlist.map((item, i) => {
    const match = review.matches[item.matchIndex];
    return '<tr><th scope="row">' + html(match.title) + '</th><td>' + html(recapTime(item.fromSecond)) + '</td><td>' +
      html(recapTime(item.observedThroughSecond)) + '</td><td>' + html(W[item.status]) + '</td><td><button type="button" data-open-sequence="' + i + '">' + html(W.replay) + '</button></td></tr>';
  }).join('');
  const packed = JSON.stringify({...review, words: W}).replace(/[<>&\u2028\u2029]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
  return '<!doctype html><html lang="' + html(review.view.locale) + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
    html(heading) + '</title><style>' +
    ':root{font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#222;background:#f3f3f1;color-scheme:light}*{box-sizing:border-box}body{margin:0}main{max-width:1200px;margin:auto;padding:24px}h1{line-height:1.15;font-size:2rem}h2{font-size:1.25rem}h3{font-size:1rem}header{display:flex;justify-content:space-between;align-items:start;gap:1rem}.eyebrow,.meta,.method{color:#5e605b;font-size:.85rem}.eyebrow{letter-spacing:.08em;font-weight:650}.panel{background:white;border:1px solid #ccc;border-radius:3px;padding:20px;margin:18px 0}.metrics{display:flex;flex-wrap:wrap;gap:12px;margin:18px 0}.metric{background:white;border:1px solid #ccc;padding:12px;flex:1 1 145px}.metric strong{display:block;font-size:1.3rem}.metric span{font-size:.8rem;color:#555}button,select{font:inherit;color:inherit;background:white;border:1px solid #999;border-radius:3px;padding:.5rem .7rem}button{cursor:pointer}button:hover{background:#e9e9e5}button:disabled{opacity:.45;cursor:default}select{width:100%;max-width:100%}.table-scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:.87rem;font-variant-numeric:tabular-nums}th,td{text-align:left;border-bottom:1px solid #ddd;padding:.65rem;vertical-align:top}th{background:#f3f3f1}thead th{min-width:105px}.notes{white-space:pre-wrap;overflow-wrap:anywhere}.source{margin-top:1rem;font-size:.8rem;overflow-wrap:anywhere}.actions{display:flex;gap:.5rem;flex-wrap:wrap;margin:1rem 0}#clip-event{font-size:1.2rem;font-weight:600}tr[data-current=true] td{font-weight:700;background:#ecece8}a{color:inherit}:focus-visible{outline:3px solid #666;outline-offset:3px}[hidden]{display:none!important}@media(max-width:600px){main{padding:12px}.panel{padding:14px}header{display:block}h1{font-size:1.65rem}.metric{flex-basis:120px}}@media print{:root{font-size:11px;background:white}main{padding:0;max-width:none}header button,.actions,select,[data-open-sequence]{display:none!important}.panel{border-color:#aaa;break-inside:avoid}.table-scroll{overflow:visible}thead{display:table-header-group}thead th{min-width:0}th,td{padding:.35rem}.source{display:none}.metrics{gap:5px}.metric{padding:7px;flex-basis:100px}#clip{break-before:auto}.notes{break-inside:auto}}' +
    '</style></head><body><main><header><div><p class="eyebrow">' + html(W.source) + '</p><h1>' + html(heading) + '</h1><p class="meta">' +
    html(review.view.team + ' · ' + W[review.period === 'all' ? 'whole' : review.period] + ' · ' + W[review.focus.outcome]) + '</p></div><button id="print" type="button">' + html(W.print) + '</button></header>' +
    '<div class="metrics">' + summary.map(([label, value]) => '<div class="metric"><strong>' + html(value) + '</strong><span>' + html(label) + '</span></div>').join('') + '</div>' +
    '<p class="method">' + html(W.context + ' ' + W.exposure) + '</p>' +
    (review.duplicateSources.length ? '<p class="method">' + html(W.duplicates) + '</p>' : '') +
    '<section class="panel"><h2>' + html(W.saved) + '</h2>' + tableHtml(headers, statRows) + '<p class="method">' + html(W.method) + '</p></section>' +
    '<section class="panel"><h2>' + html(W.playlist) + '</h2><label for="sequence-choice">' + html(W.choose) + '</label><select id="sequence-choice"></select>' +
    (review.playlist.length ? '<div class="table-scroll"><table><thead><tr>' + [W.match, W.start, W.end, W.outcome, W.replay].map(value => '<th scope="col">' + html(value) + '</th>').join('') + '</tr></thead><tbody>' + playlistRows + '</tbody></table></div>' : '<p>' + html(W.empty) + '</p>') + '</section>' +
    '<section class="panel" id="clip" hidden><h2 id="clip-title"></h2><p id="clip-context" class="meta"></p><p id="clip-progress" aria-live="polite"></p><p id="clip-event"></p><div class="actions"><button type="button" id="previous">' +
    html(W.previous) + '</button><button type="button" id="play">' + html(W.play) + '</button><button type="button" id="next">' + html(W.next) + '</button></div><p id="clip-status" class="method"></p><h3>' +
    html(W.events) + '</h3><div class="table-scroll"><table><thead><tr>' + [W.frame, W.event, W.clock, W.sourceTeam, W.sourcePlayer, W.action, W.zone].map(value => '<th scope="col">' + html(value) + '</th>').join('') +
    '</tr></thead><tbody id="clip-events"></tbody></table></div></section>' + notes +
    '<script type="application/json" id="review-data">' + packed + '</script><script>(' + offlinePlayer.toString() + ')();</script></main></body></html>\n';
}
