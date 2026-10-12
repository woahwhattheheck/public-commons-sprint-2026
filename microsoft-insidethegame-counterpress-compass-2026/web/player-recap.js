// Player recaps project the original observed match, including saved reviews.
import {buildPlayerRecap, playerRecapJson, playerRecapHtml} from './player_recap.mjs';

const byId = id => document.getElementById(id);
const make = (tag, text, cls = '') => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  element.className = cls;
  return element;
};
const clock = value => Number.isFinite(value)
  ? String(Math.floor(value / 60)).padStart(2, '0') + ':' + String(Math.floor(value % 60)).padStart(2, '0') : '—';
const number = value => Number.isFinite(value) ? String(value) : '—';
const rate = (value, numerator, denominator) =>
  (Number.isFinite(value) ? value + '%' : '—') + ' · ' + numerator + ' / ' + denominator;
const PAGE_SIZE = 12;
const WORDS = {
  en: {
    heading: 'Player recap and replay playlist',
    help: 'Follow a player, compare the halves and replay the original sequences. Your recap keeps the plays you have already watched when you seek backward.',
    player: 'Player', everyone: 'Whole club', period: 'Match half', all: 'All observed', first: 'First half', second: 'Second half',
    outcome: 'Sequence outcome', outcomes: 'All outcomes', success: 'Won back', expired: '8 seconds elapsed',
    interrupted: 'Interrupted', not_attempted: 'No pressure observed', pending: 'Open sequence',
    start: 'Play or advance the match to build a recap.', coverage: 'Observed source', summary: 'Recorded actions',
    through: 'Clock observed through', actionThrough: 'Last action observed', actionFrom: 'First action observed',
    sourceEvents: 'source events', actionEvents: 'actions', replayAt: 'Replay at', selected: 'Selected player',
    team: 'Club context', comparison: 'How the club changed between halves',
    metric: 'Measure', losses: 'Observed losses', pressing: 'Losses followed by pressure', frequency: 'Press frequency',
    resolved: 'Resolved attempts', regained: 'Successful regains', efficiency: 'Regain efficiency',
    unclear: 'Interrupted attempts', waiting: 'Pending windows', average: 'Mean time to regain',
    action: {loss: 'Losses', pressure: 'Pressure actions', regain: 'Regains', pass: 'Passes', shot: 'Shots'},
    involvement: 'Distinct sequence involvements', wonInvolvement: 'Successful sequences involving this player',
    roles: 'Observed roles', role: {loss: 'Lost possession', pressure: 'Applied pressure', regain: 'Won possession', interruption: 'Started the next loss'},
    sequenceHelp: 'Sequences are grouped by the half of the original loss. Press frequency uses observed losses; regain efficiency uses successful and expired attempts.',
    playlist: 'Replay playlist', noSequences: 'No sequences match this selection in the observed plays.',
    play: 'Play sequence', open: 'Open outcome', openObserved: 'Open last observation', details: 'Original plays',
    previous: 'Previous sequence', next: 'Next sequence', previousPage: 'Previous page', nextPage: 'Next page',
    save: 'Save playlist moments', downloadJson: 'Download recap JSON', downloadHtml: 'Download printable recap',
    saved: 'Playlist moments saved in this match.', saveFailed: 'The playlist could not be saved. Check Saved matches for details.',
    playback: 'Playing selected sequence', paused: 'Selected sequence', complete: 'Sequence reached its last observed play',
    seconds: 'seconds', watermark: 'Later observation establishes the elapsed window',
    noClosure: 'This sequence is still open at the observed point.', noPressure: 'No pressure action was recorded in this loss window.',
    page: (n, total, count) => 'Page ' + n + ' of ' + total + ' · ' + count + ' sequences',
    sequenceCount: count => count + ' sequences match this selection',
    sourceNote: 'The clock and action coverage are shown separately. A final clock event does not imply that every intervening play was recorded.',
    scope: player => player ? 'Actions recorded for ' + player : 'Actions recorded for the selected club',
  },
  es: {
    heading: 'Resumen por jugador y lista de repeticiones',
    help: 'Sigue a un jugador, compara las mitades y reproduce las secuencias originales. El resumen conserva las jugadas ya vistas al retroceder.',
    player: 'Jugador', everyone: 'Todo el club', period: 'Mitad del partido', all: 'Todo lo observado', first: 'Primera mitad', second: 'Segunda mitad',
    outcome: 'Resultado de la secuencia', outcomes: 'Todos los resultados', success: 'Balón recuperado', expired: '8 segundos transcurridos',
    interrupted: 'Interrumpida', not_attempted: 'Sin presión observada', pending: 'Secuencia abierta',
    start: 'Reproduce o avanza el partido para crear un resumen.', coverage: 'Fuente observada', summary: 'Acciones registradas',
    through: 'Reloj observado hasta', actionThrough: 'Última acción observada', actionFrom: 'Primera acción observada',
    sourceEvents: 'eventos originales', actionEvents: 'acciones', replayAt: 'Reproducción en', selected: 'Jugador seleccionado',
    team: 'Contexto del club', comparison: 'Cómo cambió el club entre mitades',
    metric: 'Medida', losses: 'Pérdidas observadas', pressing: 'Pérdidas seguidas de presión', frequency: 'Frecuencia de presión',
    resolved: 'Intentos resueltos', regained: 'Recuperaciones logradas', efficiency: 'Eficacia de recuperación',
    unclear: 'Intentos interrumpidos', waiting: 'Ventanas pendientes', average: 'Tiempo medio de recuperación',
    action: {loss: 'Pérdidas', pressure: 'Acciones de presión', regain: 'Recuperaciones', pass: 'Pases', shot: 'Tiros'},
    involvement: 'Participaciones en secuencias distintas', wonInvolvement: 'Secuencias exitosas con participación del jugador',
    roles: 'Funciones observadas', role: {loss: 'Perdió la posesión', pressure: 'Aplicó presión', regain: 'Recuperó la posesión', interruption: 'Inició la siguiente pérdida'},
    sequenceHelp: 'Las secuencias se agrupan por la mitad de la pérdida original. La frecuencia usa las pérdidas observadas; la eficacia usa los intentos exitosos y vencidos.',
    playlist: 'Lista de repeticiones', noSequences: 'Ninguna secuencia coincide con esta selección en las jugadas observadas.',
    play: 'Reproducir secuencia', open: 'Abrir resultado', openObserved: 'Abrir última observación', details: 'Jugadas originales',
    previous: 'Secuencia anterior', next: 'Secuencia siguiente', previousPage: 'Página anterior', nextPage: 'Página siguiente',
    save: 'Guardar momentos de la lista', downloadJson: 'Descargar resumen JSON', downloadHtml: 'Descargar resumen imprimible',
    saved: 'Los momentos de la lista se guardaron en este partido.', saveFailed: 'No se pudo guardar la lista. Consulta Partidos guardados.',
    playback: 'Reproduciendo la secuencia seleccionada', paused: 'Secuencia seleccionada', complete: 'La secuencia llegó a su última jugada observada',
    seconds: 'segundos', watermark: 'Una observación posterior confirma el vencimiento de la ventana',
    noClosure: 'La secuencia sigue abierta en el punto observado.', noPressure: 'No se registró presión en esta ventana de pérdida.',
    page: (n, total, count) => 'Página ' + n + ' de ' + total + ' · ' + count + ' secuencias',
    sequenceCount: count => count + ' secuencias coinciden con la selección',
    sourceNote: 'El reloj y la cobertura de acciones se muestran por separado. Un evento final de reloj no implica que se hayan registrado todas las jugadas intermedias.',
    scope: player => player ? 'Acciones registradas para ' + player : 'Acciones registradas para el club seleccionado',
  },
};

export function createPlayerRecapUI({snapshot, onPlay, onJump, onChanged, onSavePlaylist, momentButton}) {
  const root = byId('playerRecap');
  let observed = [], recap = null, timer = null, page = 0, busy = false;
  let prefs = {player: null, period: 'all', outcome: 'all', selectedSequenceId: null};
  let projectionStamp = '', listStamp = '', playerStamp = '', lastLocale = '';
  let retainedSession = null, bookmarkEdition = 0, lastTeam = '';
  const words = () => WORDS[snapshot().view.locale] || WORDS.en;
  const filtered = () => (recap?.sequences || []).filter(item => prefs.outcome === 'all' || item.status === prefs.outcome);
  const current = () => filtered().find(item => item.id === prefs.selectedSequenceId) || null;
  const selection = () => ({...prefs, observedCount: observed.length});
  const status = message => { byId('recapStatus').textContent = message || ''; };

  function retain(events) {
    if (!Array.isArray(events)) return;
    if (events.length > observed.length) observed = events.slice();
  }
  function reset(saved = {}) {
    clearTimeout(timer); timer = null; observed = []; recap = null; page = 0; busy = false;
    retainedSession = snapshot().sessionId;
    prefs = {
      player: saved.player ?? null,
      period: ['all', 'first', 'second'].includes(saved.period) ? saved.period : 'all',
      outcome: ['all', 'success', 'expired', 'interrupted', 'not_attempted', 'pending'].includes(saved.outcome) ? saved.outcome : 'all',
      selectedSequenceId: saved.selectedSequenceId ?? null,
    };
    projectionStamp = ''; listStamp = ''; playerStamp = '';
    byId('recapPeriod').value = prefs.period; byId('recapOutcome').value = prefs.outcome;
    status('');
  }
  function translate() {
    const locale = snapshot().view.locale;
    if (lastLocale === locale) return;
    lastLocale = locale;
    const W = words();
    for (const element of root.querySelectorAll('[data-recap-i18n]')) {
      const value = W[element.dataset.recapI18n];
      if (typeof value === 'string') element.textContent = value;
    }
    playerStamp = ''; listStamp = '';
  }
  function renderPlayerChoices() {
    const W = words(), players = recap?.players || [];
    const signature = JSON.stringify([lastLocale, players.map(item => item.player)]);
    if (signature !== playerStamp) {
      const all = make('option', W.everyone); all.value = '';
      byId('recapPlayer').replaceChildren(all, ...players.map(item => {
        const option = make('option', item.player); option.value = item.player; return option;
      }));
      playerStamp = signature;
    }
    byId('recapPlayer').value = prefs.player || '';
  }
  function statCell(label, value) {
    const row = make('div', undefined, 'recap-stat');
    row.append(make('dt', label), make('dd', value)); return row;
  }
  function renderSummary() {
    const W = words(), coverage = recap.coverage, stats = recap.selectedStats;
    byId('recapClub').textContent = recap.selection.team;
    byId('recapCoverage').textContent = coverage.eventCount + ' ' + W.sourceEvents + ' · ' +
      coverage.actionCount + ' ' + W.actionEvents + ' · ' + W.through + ' ' + clock(coverage.throughSecond) +
      ' · ' + W.actionFrom + ' ' + clock(coverage.firstActionSecond) + ' · ' + W.actionThrough + ' ' + clock(coverage.lastActionSecond);
    byId('recapScope').textContent = W.scope(prefs.player) + ' · ' + W[prefs.period];
    const items = Object.keys(W.action).map(type => statCell(W.action[type], number(stats.actions[type])));
    items.push(statCell(W.involvement, number(stats.sequenceInvolvements)));
    if (prefs.player) items.push(statCell(W.wonInvolvement, number(stats.successes)));
    byId('recapStats').replaceChildren(...items);
    byId('recapNarrative').replaceChildren(...(recap.narrative || []).map(text => make('p', text)));
    const first = recap.first.teamStats, second = recap.second.teamStats;
    const row = (label, left, right) => {
      const tr = make('tr'), th = make('th', label); th.scope = 'row'; tr.append(th, make('td', left), make('td', right)); return tr;
    };
    byId('recapComparison').replaceChildren(
      row(W.losses, number(first.observedLosses), number(second.observedLosses)),
      row(W.pressing, number(first.pressingWindows), number(second.pressingWindows)),
      row(W.frequency, rate(first.pressFrequencyPct, first.pressingWindows, first.observedLosses), rate(second.pressFrequencyPct, second.pressingWindows, second.observedLosses)),
      row(W.resolved, number(first.resolvedAttempts), number(second.resolvedAttempts)),
      row(W.regained, number(first.successes), number(second.successes)),
      row(W.efficiency, rate(first.regainEfficiencyPct, first.successes, first.resolvedAttempts), rate(second.regainEfficiencyPct, second.successes, second.resolvedAttempts)),
      row(W.unclear, number(first.interruptedAttempts), number(second.interruptedAttempts)),
      row(W.waiting, number(first.pendingWindows), number(second.pendingWindows)),
      row(W.average, number(first.meanRecoverySeconds) + (first.meanRecoverySeconds === null ? '' : ' s'), number(second.meanRecoverySeconds) + (second.meanRecoverySeconds === null ? '' : ' s')),
    );
    const explanation = recap.comparison.narrative;
    byId('recapComparisonText').textContent = Array.isArray(explanation) ? explanation.join(' ') : explanation || '';
  }
  function choose(sequence, open = false) {
    prefs.selectedSequenceId = sequence.id;
    const index = filtered().findIndex(item => item.id === sequence.id);
    page = Math.max(0, Math.floor(index / PAGE_SIZE));
    listStamp = ''; renderList(); onChanged();
    if (open) void onJump(sequence.endCount);
  }
  async function playSequence(sequence) {
    choose(sequence);
    status(words().playback + ' · ' + sequence.title);
    await onPlay(sequence);
    playback();
  }
  function button(text, key, action) {
    const item = make('button', text); item.type = 'button'; item.dataset.recapKey = key;
    item.addEventListener('click', action); return item;
  }
  function sequenceRow(sequence) {
    const W = words(), row = make('li', undefined, 'recap-sequence');
    row.dataset.sequenceId = sequence.id;
    if (sequence.id === prefs.selectedSequenceId) { row.classList.add('selected'); row.setAttribute('aria-current', 'true'); }
    const heading = make('div', undefined, 'recap-sequence-heading');
    heading.append(make('h4', sequence.title), make('span', W[sequence.status] || sequence.status, 'recap-outcome'));
    const timing = make('p', clock(sequence.fromSecond) + ' → ' + clock(sequence.toSecond) +
      (sequence.secondsToRecover === null ? '' : ' · ' + number(sequence.secondsToRecover) + ' ' + W.seconds), 'note');
    row.append(heading, timing, make('p', sequence.text, 'recap-sequence-text'));
    if (prefs.player && sequence.roles.length) row.append(make('p', W.roles + ': ' +
      sequence.roles.map(role => W.role[role] || role).join(' · '), 'note'));
    const controls = make('div', undefined, 'recap-actions');
    controls.append(button(W.play, 'play:' + sequence.id, () => { void playSequence(sequence); }),
      button(sequence.pending ? W.openObserved : W.open, 'open:' + sequence.id, () => choose(sequence, true)));
    if (sequence.endEventId && momentButton) {
      const save = momentButton({eventId: sequence.endEventId, count: sequence.endCount, label: sequence.title});
      save.dataset.recapKey = 'save:' + sequence.id; controls.append(save);
    }
    row.append(controls);
    const details = make('details'), summary = make('summary', W.details);
    details.dataset.sequenceDetails = sequence.id;
    const events = make('ol', undefined, 'recap-evidence');
    for (const event of sequence.evidence) {
      const item = make('li');
      item.append(make('time', clock(event.second)), make('span', event.player),
        make('span', W.role[event.role] || W.action[event.type] || event.type),
        make('code', event.id));
      events.append(item);
    }
    details.append(summary, events);
    if (sequence.watermark) details.append(make('p', W.watermark + ': ' +
      clock(sequence.watermark.second) + ' · ' + sequence.watermark.id, 'note'));
    if (sequence.pending) details.append(make('p', W.noClosure, 'note'));
    if (sequence.status === 'not_attempted') details.append(make('p', W.noPressure, 'note'));
    row.append(details); return row;
  }
  function renderList() {
    const W = words(), sequences = filtered(), pages = Math.max(1, Math.ceil(sequences.length / PAGE_SIZE));
    page = Math.min(page, pages - 1);
    const visible = sequences.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const signature = JSON.stringify([lastLocale, prefs.selectedSequenceId, page, bookmarkEdition, visible]);
    if (signature !== listStamp) {
      const active = root.contains(document.activeElement) ? document.activeElement?.dataset.recapKey : null;
      const open = new Set([...root.querySelectorAll('details[open][data-sequence-details]')].map(item => item.dataset.sequenceDetails));
      const rows = visible.map(sequenceRow);
      byId('recapSequences').replaceChildren(...(rows.length ? rows : [make('li', W.noSequences, 'note')]));
      for (const detail of root.querySelectorAll('details[data-sequence-details]')) detail.open = open.has(detail.dataset.sequenceDetails);
      if (active) [...root.querySelectorAll('[data-recap-key]')].find(item => item.dataset.recapKey === active)?.focus({preventScroll: true});
      listStamp = signature;
    }
    const index = sequences.findIndex(item => item.id === prefs.selectedSequenceId);
    byId('recapCount').textContent = W.sequenceCount(sequences.length);
    byId('recapPage').textContent = W.page(page + 1, pages, sequences.length);
    byId('recapPreviousPage').disabled = page === 0;
    byId('recapNextPage').disabled = page >= pages - 1;
    byId('recapPrevious').disabled = index <= 0;
    byId('recapNext').disabled = sequences.length === 0 || index >= sequences.length - 1;
    byId('recapSavePlaylist').disabled = busy || !sequences.length || !snapshot().hasFrame;
    byId('recapJson').disabled = !observed.length;
    byId('recapHtml').disabled = !observed.length;
    playback();
  }
  function render() {
    clearTimeout(timer); timer = null; translate();
    const state = snapshot();
    if (!state.hasFrame && !observed.length) {
      byId('recapNarrative').replaceChildren(make('p', words().start));
      byId('recapCoverage').textContent = ''; byId('recapScope').textContent = ''; byId('recapClub').textContent = state.view.team;
      renderPlayerChoices();
      byId('recapStats').replaceChildren(); byId('recapComparison').replaceChildren();
      byId('recapComparisonText').textContent = ''; renderList(); return;
    }
    if (prefs.player && observed.length && !observed.some(event => event.team === state.view.team && event.player === prefs.player && event.type !== 'clock')) prefs.player = null;
    const stamp = JSON.stringify([observed.length, observed.at(-1)?.id, state.view.team, state.view.locale, prefs.player, prefs.period]);
    if (stamp !== projectionStamp) {
      recap = buildPlayerRecap(observed, {...state.view, player: prefs.player, period: prefs.period});
      projectionStamp = stamp;
      if (prefs.selectedSequenceId && !filtered().some(item => item.id === prefs.selectedSequenceId)) prefs.selectedSequenceId = null;
      renderPlayerChoices(); renderSummary();
    }
    renderList();
  }
  function update({immediate = false} = {}) {
    const state = snapshot();
    if (retainedSession && state.sessionId !== retainedSession) reset();
    retainedSession = state.sessionId;
    retain(state.events);
    const changedTeam = lastTeam !== state.view.team; lastTeam = state.view.team;
    if (immediate || !state.playing || changedTeam || lastLocale !== state.view.locale) render();
    else if (!timer) timer = setTimeout(render, 240);
    playback();
  }
  function playback() {
    const sequence = current(), state = snapshot(), W = words();
    byId('recapReplayPosition').textContent = W.replayAt + ' ' + clock(state.events.at(-1)?.second ?? 0);
    byId('recapSelected').textContent = sequence
      ? (state.playing && state.cursor >= sequence.startCount && state.cursor <= sequence.endCount ? W.playback
        : state.cursor === sequence.endCount ? W.complete : W.paused) + ' · ' + sequence.title : '';
  }
  function download(content, extension, type) {
    const state = snapshot(), name = [state.match?.scenario || 'match', state.match?.seed || '', prefs.player || 'club', prefs.period]
      .join('-').replace(/[^a-zA-Z0-9_-]+/g, '-');
    const url = URL.createObjectURL(new Blob([content], {type}));
    const link = make('a'); link.href = url; link.download = 'counterpress-recap-' + name + '.' + extension;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  for (const [id, key] of [['recapPlayer', 'player'], ['recapPeriod', 'period'], ['recapOutcome', 'outcome']]) {
    byId(id).addEventListener('change', () => {
      prefs[key] = byId(id).value || null; prefs.selectedSequenceId = null; page = 0;
      projectionStamp = ''; listStamp = ''; render(); status(''); onChanged();
    });
  }
  for (const [id, delta] of [['recapPreviousPage', -1], ['recapNextPage', 1]]) byId(id).addEventListener('click', () => { page += delta; renderList(); });
  for (const [id, delta] of [['recapPrevious', -1], ['recapNext', 1]]) byId(id).addEventListener('click', () => {
    const items = filtered(), index = items.findIndex(item => item.id === prefs.selectedSequenceId);
    const item = items[Math.max(0, index + delta)]; if (item) choose(item, true);
  });
  byId('recapSavePlaylist').addEventListener('click', async () => {
    const items = filtered().filter(item => item.endEventId).map(item => ({eventId: item.endEventId, count: item.endCount, label: item.title}));
    if (!items.length || busy) return;
    busy = true; renderList();
    try {
      const saved = await onSavePlaylist(items);
      status(saved ? words().saved : words().saveFailed);
    } catch (error) { status(error.message || words().saveFailed); }
    finally { busy = false; bookmarkEdition++; renderList(); }
  });
  byId('recapJson').addEventListener('click', () => {
    render();
    if (recap) download(playerRecapJson({...recap, match: snapshot().match, playlistSelection: {...prefs}, playlist: filtered()}), 'json', 'application/json');
  });
  byId('recapHtml').addEventListener('click', () => {
    render();
    if (recap) download(playerRecapHtml({...recap, playlistSelection: {...prefs}, sequences: filtered()}, {scenario: snapshot().match?.scenario ?? null, seed: snapshot().match?.seed ?? null}), 'html', 'text/html;charset=utf-8');
  });
  return {update, reset, retain, selection, playback,
    refreshBookmarks() { bookmarkEdition++; listStamp = ''; if (recap) renderList(); }};
}
