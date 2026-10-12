import {ArchiveLink} from './archive.js';
import {PLAYER_COACHING_WORDS, parsePlayerCoachingFocus, playerCoachingHtml} from './player_coaching.mjs';

const el = id => document.getElementById(id);
const node = (tag, text, className = '') => {
  const item = document.createElement(tag);
  if (text !== undefined) item.textContent = text;
  item.className = className;
  return item;
};
const FORMAT = 'counterpress.coach-review.v1';
const KEYS = {current: 'counterpress.coach.current.v1', sets: 'counterpress.coach.sets.v1',
  imports: 'counterpress.coach.imports.v1', drafts: 'counterpress.coach.drafts.v1', library: 'counterpress.library.v1'};
const WORDS = {
  en: {
    source: 'SYNTHETIC MATCH REVIEW', eyebrow: 'COACH WORKSPACE', heading: 'Review matches together',
    intro: 'Compare your saved matches, follow each outcome to its original play, and keep a useful coaching review.',
    player: 'Open match player', collection: 'Your saved matches', chooseHelp: 'Choose two to four. The first match is the comparison baseline.',
    refresh: 'Refresh collection', demo: 'Save two demonstration matches', view: 'Comparison view', team: 'Team',
    period: 'Period', whole: 'Whole observed match', first: 'First half', second: 'Second half',
    audience: 'View', analyst: 'Coach / analyst', casual: 'Fan', language: 'Language', compare: 'Compare selected matches',
    savedSets: 'Saved comparisons', name: 'Comparison name', saveSet: 'Save comparison', reopen: 'Reopen a comparison',
    openSet: 'Open saved comparison', saveHelp: 'Match notes stay in the original archive. Comparison selections are saved in this browser; export to take them with you.',
    portable: 'Portable review', export: 'Save and download complete review', importLabel: 'Counterpress review or match package',
    import: 'Import selected file', ready: 'Choose the matches to review',
    emptyHelp: 'Save matches from the player or import their packages. The demonstration button saves two complete matches from the original scenario generator.',
    footer: 'Counterpress outcomes come from the original eight-second event engine. Halves are grouped by the loss event; every comparison shows its observed event cutoff.',
    cutoff: 'Observed event cutoff', allEvents: 'All events', noMatches: 'Your saved collection is empty.',
    selected: 'selected', comparison: 'Match comparison', baseline: 'Baseline', against: 'vs baseline',
    lossWindows: 'Closed loss windows', counterpressAttempts: 'Press attempts', successes: 'Successful regains',
    resolvedCounterpressAttempts: 'Resolved attempts', interruptedAttempts: 'Interrupted attempts',
    successRatePct: 'Regain rate', meanRecoverySeconds: 'Mean recovery', expiredAttempts: 'Expired attempts',
    unattemptedWindows: 'Without a qualifying press', unsettledLossWindows: 'Unsettled loss windows',
    unknown: '—', savedInsights: 'Saved match insights', originalMoment: 'Open original moment', notes: 'Coach notes', saveNotes: 'Save notes', reloadNotes: 'Reload saved notes', saved: 'Saved in the match archive.',
    shared: 'This shared match is read-only. Import its exported package to create an editable copy.',
    reviewConflict: 'The saved review changed. Your draft is retained; reload saved notes or download your draft before replacing it.',
    draft: 'Download note draft', draftKept: 'Draft retained in this browser.', moments: 'Press moments', anyOutcome: 'Every press outcome',
    success: 'Successful regain', expired: 'Expired window', interrupted: 'Interrupted observation',
    noMoments: 'No closed press moments in this selection. Change the team, half or event cutoff.',
    events: 'Original events', replay: 'Replay this outcome', bookmark: 'Save moment', bookmarked: 'Moment saved',
    next: 'Next observed event', watermark: 'Window closed by the later event-time watermark',
    showMore: 'Show more moments', refreshDone: 'Collection refreshed.', working: 'Working…', compareDone: 'Comparison ready.',
    saveDone: 'Comparison saved in this browser.', exported: 'Complete review downloaded.', importDone: 'Review imported into your saved matches.',
    partialImport: 'Import paused. Select Import again to resume; completed matches remain in your collection.',
    nameRequired: 'Give the comparison a name.', chooseTwo: 'Choose two to four saved matches.',
    missing: 'A selected saved match is unavailable. Refresh the collection and choose its replacement.',
    noFile: 'Choose a Counterpress JSON package.', size: 'The review package must be smaller than 2.5MB.',
    noStorage: 'Browser storage is unavailable. Export this review to keep the comparison selection.',
    method: 'Regain rate uses successful plus expired attempts as its denominator. Interrupted and unsettled windows stay separate. Half selection follows the original loss time.',
    coverage: 'Events observed', sourceDetails: 'Source details', sourceDigest: 'Original match SHA-256', copyState: 'Comparison selections restored.',
  },
  es: {
    source: 'ANÁLISIS DE PARTIDOS SINTÉTICOS', eyebrow: 'ESPACIO DEL ENTRENADOR', heading: 'Analiza varios partidos',
    intro: 'Compara partidos guardados, abre la jugada original de cada resultado y conserva tus notas.',
    player: 'Abrir el partido', collection: 'Tus partidos guardados', chooseHelp: 'Elige entre dos y cuatro. El primero es la referencia.',
    refresh: 'Actualizar colección', demo: 'Guardar dos partidos de demostración', view: 'Vista de comparación', team: 'Equipo',
    period: 'Período', whole: 'Todo el partido observado', first: 'Primera parte', second: 'Segunda parte',
    audience: 'Vista', analyst: 'Entrenador / analista', casual: 'Aficionado', language: 'Idioma', compare: 'Comparar partidos',
    savedSets: 'Comparaciones guardadas', name: 'Nombre de la comparación', saveSet: 'Guardar comparación', reopen: 'Reabrir una comparación',
    openSet: 'Abrir comparación', saveHelp: 'Las notas se conservan en el archivo original. La selección queda en este navegador; expórtala para llevarla a otro dispositivo.',
    portable: 'Análisis portátil', export: 'Guardar y descargar análisis completo', importLabel: 'Paquete de análisis o partido de Counterpress',
    import: 'Importar archivo', ready: 'Elige los partidos', emptyHelp: 'Guarda partidos desde el reproductor o importa sus paquetes. La demostración guarda dos partidos completos del generador original.',
    footer: 'Los resultados proceden del motor original de ocho segundos. Las partes se agrupan por el momento de la pérdida y cada comparación indica el límite de jugadas observado.',
    cutoff: 'Límite de jugadas observado', allEvents: 'Todas', noMatches: 'La colección está vacía.',
    selected: 'seleccionados', comparison: 'Comparación de partidos', baseline: 'Referencia', against: 'respecto a la referencia',
    lossWindows: 'Ventanas de pérdida cerradas', counterpressAttempts: 'Intentos de presión', successes: 'Recuperaciones',
    resolvedCounterpressAttempts: 'Intentos resueltos', interruptedAttempts: 'Intentos interrumpidos',
    successRatePct: 'Tasa de recuperación', meanRecoverySeconds: 'Tiempo medio', expiredAttempts: 'Ventanas agotadas',
    unattemptedWindows: 'Sin presión válida', unsettledLossWindows: 'Ventanas sin resolver', unknown: '—',
    savedInsights: 'Análisis guardados del partido', originalMoment: 'Abrir momento original', notes: 'Notas del entrenador', saveNotes: 'Guardar notas', reloadNotes: 'Cargar notas guardadas', saved: 'Guardado en el archivo del partido.',
    shared: 'Este partido compartido es de solo lectura. Importa su paquete para crear una copia editable.',
    reviewConflict: 'El análisis guardado cambió. Tu borrador se conserva; carga las notas guardadas o descarga el borrador antes de sustituirlo.',
    draft: 'Descargar borrador', draftKept: 'Borrador conservado en este navegador.', moments: 'Momentos de presión', anyOutcome: 'Todos los resultados',
    success: 'Recuperación', expired: 'Ventana agotada', interrupted: 'Observación interrumpida',
    noMoments: 'No hay momentos de presión cerrados en esta selección. Cambia el equipo, la parte o el límite de jugadas.',
    events: 'Jugadas originales', replay: 'Repetir este resultado', bookmark: 'Guardar momento', bookmarked: 'Momento guardado',
    next: 'Siguiente jugada observada', watermark: 'Ventana cerrada por una jugada posterior',
    showMore: 'Mostrar más momentos', refreshDone: 'Colección actualizada.', working: 'Procesando…', compareDone: 'Comparación preparada.',
    saveDone: 'Comparación guardada en este navegador.', exported: 'Análisis completo descargado.', importDone: 'Análisis importado en tus partidos.',
    partialImport: 'Importación pausada. Pulsa Importar para continuar; los partidos completados siguen guardados.',
    nameRequired: 'Asigna un nombre a la comparación.', chooseTwo: 'Elige entre dos y cuatro partidos.',
    missing: 'Un partido seleccionado no está disponible. Actualiza la colección y elige otro.',
    noFile: 'Elige un paquete JSON de Counterpress.', size: 'El paquete debe ocupar menos de 2,5MB.',
    noStorage: 'El almacenamiento del navegador no está disponible. Exporta el análisis para conservar la selección.',
    method: 'La tasa usa recuperaciones y ventanas agotadas como denominador. Las observaciones interrumpidas y sin resolver se muestran aparte. La parte corresponde a la pérdida original.',
    coverage: 'Jugadas observadas', sourceDetails: 'Detalles del origen', sourceDigest: 'SHA-256 del partido original', copyState: 'Selección de comparación recuperada.',
  },
};

Object.assign(WORDS.en, {
  focusPlayer: 'Follow a player', wholeTeam: 'Whole team', focusOutcome: 'Playlist outcome',
  focusAll: 'All outcomes', focusSuccess: 'Successful team sequence', notAttempted: 'Without a qualifying press',
  not_attempted: 'Without a qualifying press', pending: 'Open window',
  downloadBrief: 'Save and download coaching brief', briefDownloaded: 'Coaching brief downloaded with original event replay.',
  playerSummary: 'Player coaching', playerHelp: 'Choose a player to compare actions and distinct sequence involvement across these original matches.',
  noPlayerActions: 'No recorded actions in the selected prefixes', matchedSources: 'matches with recorded actions',
  savePlaylist: 'Save player playlist moments', playlistCapacity: 'This playlist would exceed 64 saved moments in this match. Choose an outcome filter or remove saved moments first.',
  playlistSaved: 'Player playlist and recap selection saved in the original match.',
  playlistCount: 'selected sequences', openStart: 'Open sequence start', openEnd: 'Open observed end',
  emptyPlaylist: 'No sequences match this player, half and outcome.', bothHalves: 'Both half contexts',
});
Object.assign(WORDS.es, {
  focusPlayer: 'Seguir a un jugador', wholeTeam: 'Todo el equipo', focusOutcome: 'Resultado de la lista',
  focusAll: 'Todos los resultados', focusSuccess: 'Secuencia del equipo recuperada', notAttempted: 'Sin presión válida',
  not_attempted: 'Sin presión válida', pending: 'Ventana abierta',
  downloadBrief: 'Guardar y descargar informe del entrenador', briefDownloaded: 'Informe descargado con reproducción de las jugadas originales.',
  playerSummary: 'Análisis del jugador', playerHelp: 'Elige un jugador para comparar acciones y participación en secuencias distintas de estos partidos.',
  noPlayerActions: 'Sin acciones registradas en los prefijos seleccionados', matchedSources: 'partidos con acciones registradas',
  savePlaylist: 'Guardar momentos de la lista del jugador', playlistCapacity: 'La lista superaría 64 momentos guardados en este partido. Filtra por resultado o elimina momentos guardados.',
  playlistSaved: 'Lista del jugador y selección guardadas en el partido original.',
  playlistCount: 'secuencias seleccionadas', openStart: 'Abrir inicio de la secuencia', openEnd: 'Abrir final observado',
  emptyPlaylist: 'No hay secuencias para este jugador, parte y resultado.', bothHalves: 'Contexto de ambas partes',
});

let collection = [], selected = [], comparison = null, busy = false, storageAvailable = true;
let libraryKey, sets = [], activeImport = null;
const drafts = new Map();
const words = () => WORDS[el('locale').value] || WORDS.en;
function readLocal(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function writeLocal(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { storageAvailable = false; return false; }
}
try { libraryKey = localStorage.getItem(KEYS.library); } catch { storageAvailable = false; }
if (!/^[0-9a-f]{64}$/.test(libraryKey || '')) {
  libraryKey = [...crypto.getRandomValues(new Uint8Array(32))].map(value => value.toString(16).padStart(2, '0')).join('');
  try { localStorage.setItem(KEYS.library, libraryKey); } catch { storageAvailable = false; }
}
function notify(message, error = false) {
  el('status').textContent = message; el('status').dataset.error = String(error);
}
function setBusy(value) {
  busy = value;
  document.querySelectorAll('button,input,select,textarea').forEach(item => { item.disabled = value || item.dataset.readonly === 'true'; });
  document.body.setAttribute('aria-busy', String(value));
}
async function request(url, method = 'GET', body) {
  const response = await fetch(url, {method, headers: {'X-Counterpress-Library': libraryKey,
    ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
    ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) throw Object.assign(new Error(result?.error || 'Request failed'), {status: response.status});
  return result;
}
async function action(operation) {
  if (busy) return;
  setBusy(true); notify(words().working);
  try { await operation(); } catch (error) { notify(error.message, true); }
  finally { setBusy(false); }
}
function config() {
  return {title: el('setTitle').value.trim(), matches: selected.map(item => ({...item})),
    view: {team: el('team').value, audience: el('audience').value, locale: el('locale').value}, period: el('period').value,
    focus: {player: el('focusPlayer').value || null, outcome: el('focusOutcome').value}};
}
function remember() { writeLocal(KEYS.current, config()); }
function applyConfig(value) {
  if (!value || typeof value !== 'object') return;
  selected = Array.isArray(value.matches) ? value.matches.filter(item => typeof item?.id === 'string' && Number.isInteger(item.count)).slice(0, 4) : [];
  for (const key of ['team', 'audience', 'locale']) {
    if ([...el(key).options].some(option => option.value === value.view?.[key])) el(key).value = value.view[key];
  }
  if (['all', 'first', 'second'].includes(value.period)) el('period').value = value.period;
  el('setTitle').value = typeof value.title === 'string' ? value.title.slice(0, 100) : '';
  let focus; try { focus = parsePlayerCoachingFocus(value.focus); } catch { focus = {player: null, outcome: 'all'}; }
  setPlayerChoice(focus.player); el('focusOutcome').value = focus.outcome;
}
function localize() {
  document.documentElement.lang = el('locale').value;
  document.querySelectorAll('[data-word]').forEach(item => { item.textContent = words()[item.dataset.word]; });
  renderCollection(); renderSets();
  if (comparison) renderComparison();
}
const time = second => second === null ? '—' : String(Math.floor(second / 60)).padStart(2, '0') + ':' + String(Math.floor(second % 60)).padStart(2, '0');
function replay(id, count) {
  return ArchiveLink.url(id, count, comparison.view, new URL('/', location.href).href);
}
function renderCollection() {
  const fragment = document.createDocumentFragment();
  if (!collection.length) fragment.append(node('p', words().noMatches, 'muted'));
  for (const match of collection) {
    const chosen = selected.find(item => item.id === match.id);
    const row = node('div', undefined, 'match-choice');
    const checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.checked = Boolean(chosen);
    checkbox.setAttribute('aria-label', match.title); checkbox.dataset.archiveId = match.id;
    const heading = node('label'); const strong = node('strong', match.title);
    heading.append(strong, node('span', match.scenario + ' · ' + match.seed + ' · ' + match.total + ' events'));
    checkbox.id = 'select-' + match.id; heading.htmlFor = checkbox.id; row.append(checkbox, heading);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked && selected.length >= 4) { checkbox.checked = false; notify(words().chooseTwo, true); return; }
      selected = checkbox.checked ? [...selected, {id: match.id, count: match.cursor}] : selected.filter(item => item.id !== match.id);
      remember(); renderCollection();
    });
    if (chosen) {
      const cutoff = node('div', undefined, 'cutoff'), label = node('label', words().cutoff);
      const input = node('input'); input.type = 'number'; input.min = '0'; input.max = String(match.total); input.value = String(chosen.count);
      input.setAttribute('aria-label', words().cutoff + ' · ' + match.title);
      input.addEventListener('change', () => {
        const count = Number(input.value);
        if (!Number.isInteger(count) || count < 0 || count > match.total) { input.value = String(chosen.count); return; }
        chosen.count = count; remember();
      });
      label.append(input);
      const all = node('button', words().allEvents); all.type = 'button';
      all.addEventListener('click', () => { chosen.count = match.total; remember(); renderCollection(); });
      cutoff.append(label, all); row.append(cutoff);
    }
    fragment.append(row);
  }
  const missing = selected.filter(item => !collection.some(match => match.id === item.id));
  for (const item of missing) {
    const row = node('p', words().missing + ' ' + item.id, 'muted'), remove = node('button', '×');
    remove.setAttribute('aria-label', 'Remove ' + item.id);
    remove.addEventListener('click', () => { selected = selected.filter(value => value.id !== item.id); remember(); renderCollection(); });
    row.append(remove); fragment.append(row);
  }
  el('collection').replaceChildren(fragment);
}
async function refresh() {
  collection = (await request('/api/archives')).archives;
  renderCollection();
}
function renderSets() {
  const prior = el('sets').value;
  const placeholder = node('option', '—'); placeholder.value = '';
  el('sets').replaceChildren(placeholder, ...sets.map((set, i) => {
    const option = node('option', set.title); option.value = String(i); return option;
  }));
  el('sets').value = prior;
}
function number(value, key) {
  if (value === null || value === undefined) return words().unknown;
  return value + (key === 'successRatePct' ? '%' : key === 'meanRecoverySeconds' ? ' s' : '');
}
function renderTable(parent) {
  const wrap = node('div', undefined, 'table-scroll'), table = node('table'), head = node('thead'), row = node('tr');
  row.append(node('th', words().comparison));
  comparison.matches.forEach((match, i) => {
    const th = node('th', match.title); th.scope = 'col';
    th.append(node('small', (i ? '' : words().baseline + ' · ') + match.count + '/' + match.total + ' · ' + time(match.observedThroughSecond)));
    row.append(th);
  });
  head.append(row); table.append(head);
  const body = node('tbody');
  const keys = ['lossWindows', 'counterpressAttempts', 'successes', 'expiredAttempts', 'interruptedAttempts',
    'successRatePct', 'meanRecoverySeconds', 'unattemptedWindows', 'unsettledLossWindows'];
  for (const key of keys) {
    const tr = node('tr'), label = node('th', words()[key]); label.scope = 'row'; tr.append(label);
    comparison.matches.forEach((match, index) => {
      const value = Object.hasOwn(match.stats, key) ? match.stats[key] : match[key];
      const td = node('td', number(value, key));
      if (index && Object.hasOwn(match.delta, key) && match.delta[key] !== null) {
        const delta = match.delta[key];
        td.append(node('div', (delta > 0 ? '+' : '') + delta +
          (key === 'successRatePct' ? ' pp' : key === 'meanRecoverySeconds' ? ' s' : '') + ' ' + words().against, 'delta'));
      }
      tr.append(td);
    });
    body.append(tr);
  }
  table.append(body); wrap.append(table); parent.append(wrap, node('p', words().method, 'method'));
}
function draftFor(match) {
  if (!drafts.has(match.id)) drafts.set(match.id, {revision: match.revision, review: structuredClone(match.archive.review)});
  return drafts.get(match.id);
}
function keepDrafts() { writeLocal(KEYS.drafts, Object.fromEntries(drafts)); }
async function saveOriginalReview(match, status) {
  const draft = draftFor(match);
  try {
    const updated = await request('/api/archives/' + match.id, 'PUT', {revision: draft.revision, review: draft.review});
    match.archive = updated; match.revision = updated.revision; match.title = updated.title;
    drafts.delete(match.id); keepDrafts(); status.textContent = words().saved;
    await refresh(); renderComparison(); notify(words().saved);
  } catch (error) {
    status.textContent = error.status === 409 ? words().reviewConflict : error.message;
    throw error.status === 409 ? new Error(words().reviewConflict) : error;
  }
}
function notesPanel(match) {
  const box = node('div', undefined, 'notes'), label = node('label', words().notes);
  const input = node('textarea'); input.maxLength = 6000; input.rows = 4;
  input.id = 'notes-' + match.id; label.htmlFor = input.id;
  input.value = drafts.get(match.id)?.review.notes ?? match.archive.review.notes;
  input.disabled = !match.archive.canEdit; input.dataset.readonly = String(!match.archive.canEdit);
  input.addEventListener('input', () => {
    draftFor(match).review.notes = input.value; keepDrafts();
    status.textContent = storageAvailable ? words().draftKept : words().noStorage;
  });
  const status = node('p', drafts.has(match.id) ? words().draftKept : '', 'review-status'); status.setAttribute('role', 'status');
  box.append(label, input);
  const actions = node('div', undefined, 'actions');
  const save = node('button', words().saveNotes); save.dataset.readonly = String(!match.archive.canEdit); save.disabled = !match.archive.canEdit;
  save.addEventListener('click', () => action(() => saveOriginalReview(match, status)));
  const reload = node('button', words().reloadNotes);
  reload.addEventListener('click', () => action(async () => {
    const saved = await request('/api/archives/' + match.id);
    drafts.delete(match.id); keepDrafts(); match.archive = saved; match.revision = saved.revision;
    renderComparison(); notify(words().saved);
  }));
  const download = node('button', words().draft);
  download.addEventListener('click', () => downloadJSON({archiveId: match.id, sourceSha256: match.sourceSha256,
    ...(drafts.get(match.id) ?? {revision: match.revision, review: match.archive.review})}, 'counterpress-note-draft.json'));
  actions.append(save, reload, download); box.append(actions, status);
  if (!match.archive.canEdit) box.append(node('p', words().shared, 'muted'));
  return box;
}
function momentCard(match, moment) {
  const details = node('details', undefined, 'moment');
  details.append(node('summary', time(moment.fromSecond) + ' · ' + words()[moment.status] + ' · ' + moment.id));
  const body = node('div', undefined, 'moment-body');
  body.append(node('p', moment.text));
  const chain = node('div', undefined, 'chain'); chain.setAttribute('aria-label', words().events);
  for (const event of moment.evidence) {
    const link = node('a', event.id + ' ' + (coachingWords()[event.type] || event.type) + ' ' + time(event.second));
    link.href = replay(match.id, event.count); chain.append(link);
  }
  body.append(chain);
  for (const [field, label] of [['watermark', 'watermark'], ['nextObserved', 'next']]) {
    const event = moment[field];
    if (event) body.append(node('p', words()[label] + ': ' + event.id + ' · ' + time(event.second) + ' · ' + event.team + ' · ' + event.type, 'muted'));
  }
  const actions = node('div', undefined, 'actions'), link = node('a', words().openEnd, 'button');
  link.href = replay(match.id, moment.count); actions.append(link);
  if (Number.isInteger(moment.startCount)) {
    const start = node('a', words().openStart, 'button'); start.href = replay(match.id, moment.startCount); actions.prepend(start);
  }
  const saved = (drafts.get(match.id)?.review ?? match.archive.review).bookmarks.some(item => item.eventId === moment.eventId);
  const bookmark = node('button', saved ? words().bookmarked : words().bookmark);
  bookmark.dataset.readonly = String(!match.archive.canEdit || saved); bookmark.disabled = !match.archive.canEdit || saved;
  bookmark.addEventListener('click', () => action(async () => {
    const draft = draftFor(match);
    if (draft.review.bookmarks.length >= 64) throw new Error('64 saved moments per original match');
    if (!draft.review.bookmarks.some(item => item.eventId === moment.eventId))
      draft.review.bookmarks.push({eventId: moment.eventId, count: moment.count,
        label: (words()[moment.status] + ' · ' + time(moment.fromSecond) + ' · ' + moment.id).slice(0, 100), note: ''});
    retainPlayerSelection(draft.review, match, [moment]); keepDrafts();
    await saveOriginalReview(match, node('p'));
  }));
  actions.append(bookmark); body.append(actions); details.append(body); return details;
}
function matchPanel(match) {
  const panel = node('section', undefined, 'panel match-detail');
  panel.dataset.matchId = match.id; panel.append(node('h2', match.title));
  const meta = node('div', undefined, 'meta');
  meta.append(node('span', match.scenario + ' · seed ' + match.seed),
    node('span', words().coverage + ': ' + match.count + '/' + match.total + ' · ' + time(match.observedThroughSecond)),
    node('span', 'revision ' + match.revision));
  panel.append(meta);
  const halfContext = playerHalfContext(match); if (halfContext) panel.append(halfContext);
  const grid = node('div', undefined, 'detail-grid');
  grid.append(notesPanel(match));
  const source = node('div'); source.append(node('h3', words().events));
  source.append(node('p', Object.entries(match.eventCounts).map(([key, value]) => key + ' ' + value).join(' · ')));
  const identity = node('details'); identity.append(node('summary', words().sourceDetails),
    node('p', words().sourceDigest, 'muted'), node('p', match.sourceSha256, 'source-id'), node('p', match.id, 'source-id'));
  source.append(identity);
  const replayLink = node('a', words().player, 'button'); replayLink.href = replay(match.id, match.count); source.append(replayLink);
  grid.append(source); panel.append(grid);
  if (match.insights?.length) {
    const retained = node('section', undefined, 'notes');
    retained.append(node('h3', words().savedInsights));
    for (const record of match.insights) {
      const item = node('details');
      item.append(node('summary', time(record.source.frameSecond) + ' · ' + record.response.caption),
        node('p', record.response.text),
        node('p', record.response.provider + ' · ' + record.response.model, 'muted'));
      const link = node('a', words().originalMoment, 'button');
      link.href = replay(match.id, record.source.count);
      item.append(link); retained.append(item);
    }
    panel.append(retained);
  }
  const controls = node('div', undefined, 'moment-filter'), sequences = coachingSequences(match);
  controls.append(node('strong', coachingWords().playlist), node('span', sequences.length + ' ' + words().playlistCount, 'muted'));
  if (comparison.coaching?.focus.player) {
    const save = node('button', words().savePlaylist);
    save.disabled = !match.archive.canEdit || !sequences.length;
    save.dataset.readonly = String(save.disabled);
    save.addEventListener('click', () => action(() => savePlayerPlaylist(match, sequences))); controls.append(save);
  }
  panel.append(controls);
  const rows = node('div', undefined, 'moments'), more = node('button', words().showMore); let shown = 20;
  function draw() {
    rows.replaceChildren(...sequences.slice(0, shown).map(moment => momentCard(match, moment)));
    if (!sequences.length) rows.append(node('p', words().emptyPlaylist, 'muted'));
    more.hidden = sequences.length <= shown;
  }
  more.addEventListener('click', () => { shown += 20; draw(); });
  draw(); panel.append(rows, more); return panel;
}

function coachingWords() { return PLAYER_COACHING_WORDS[el('locale').value] || PLAYER_COACHING_WORDS.en; }
function setPlayerChoice(player) {
  const value = player || '';
  if (value && ![...el('focusPlayer').options].some(option => option.value === value)) {
    const option = node('option', value); option.value = value; el('focusPlayer').append(option);
  }
  el('focusPlayer').value = value;
}
function renderPlayerChoices() {
  const value = el('focusPlayer').value;
  const all = node('option', words().wholeTeam); all.value = '';
  const options = (comparison?.coaching?.players || []).map(player => {
    const option = node('option', player.player + ' · ' + player.matches + '/' + comparison.matches.length);
    option.value = player.player; return option;
  });
  if (value && !options.some(option => option.value === value)) {
    const option = node('option', value + ' · ' + words().noPlayerActions); option.value = value; options.push(option);
  }
  el('focusPlayer').replaceChildren(all, ...options); el('focusPlayer').value = value;
}
function coachingMatch(match) { return comparison?.coaching?.matches.find(item => item.id === match.id); }
function coachingSequences(match) {
  const source = coachingMatch(match);
  if (!source) return match.moments;
  const outcome = comparison.coaching.focus.outcome;
  return source.sequences.filter(item => outcome === 'all' || item.status === outcome)
    .map(item => ({...item, count: item.endCount, eventId: item.endEventId}));
}
function coachingRatio(n, d) {
  return n + '/' + d + (d ? ' · ' + Math.round(n * 1000 / d) / 10 + '%' : ' · —');
}
function coachingTable(headers, rows) {
  const wrap = node('div', undefined, 'table-scroll'), table = node('table'), head = node('thead'), title = node('tr');
  for (const text of headers) {const th = node('th', text); th.scope = 'col'; title.append(th);}
  head.append(title); table.append(head);
  const body = node('tbody');
  for (const values of rows) {
    const row = node('tr');
    values.forEach((text, index) => {const cell = node(index ? 'td' : 'th', String(text)); if (!index) cell.scope = 'row'; row.append(cell);});
    body.append(row);
  }
  table.append(body); wrap.append(table); return wrap;
}
function playerCoachingPanel() {
  const review = comparison.coaching, W = coachingWords(), totals = review.totals.selected;
  const panel = node('section', undefined, 'panel player-coaching');
  panel.append(node('h2', W.heading + ' · ' + review.focus.player),
    node('p', comparison.view.team + ' · ' + words()[comparison.period === 'all' ? 'whole' : comparison.period], 'muted'));
  const metrics = node('div', undefined, 'coaching-metrics');
  for (const [label, value] of [[W.actionCount, totals.actionCount], [W.regain, totals.actions.regain],
    [W.sequenceInvolvements, totals.sequenceInvolvements], [W.successes, totals.successes]]) {
    const card = node('div', undefined, 'coaching-metric'); card.append(node('strong', String(value)), node('span', label)); metrics.append(card);
  }
  panel.append(metrics, node('p', W.context, 'method'));
  const rows = [['coverage'], ['actionCount'], ['pressure'], ['regain'], ['sequenceInvolvements'], ['successes'],
    ['expiredAttempts'], ['interruptedAttempts'], ['pendingWindows']].map(([key]) => [
      W[key], ...review.matches.map(match => key === 'coverage' ? match.count + '/' + match.total + ' · ' + time(match.observedThroughSecond) :
        ['pressure', 'regain'].includes(key) ? match.selectedStats.actions[key] : match.selectedStats[key]),
    ]);
  rows.push([W.involvedRate, ...review.matches.map(match => coachingRatio(match.selectedStats.successes, match.selectedStats.resolvedAttempts))]);
  panel.append(coachingTable([W.match, ...review.matches.map(match => match.title)], rows));
  panel.append(node('p', W.involvedRate + ': ' + coachingRatio(totals.successes, totals.resolvedAttempts) + ' · ' +
    W.pressFrequency + ': ' + coachingRatio(review.totals.team.pressingWindows, review.totals.team.observedLosses) + ' · ' +
    W.regainEfficiency + ': ' + coachingRatio(review.totals.team.successes, review.totals.team.resolvedAttempts), 'method'));
  panel.append(node('p', W.method + ' ' + W.exposure, 'method'));
  if (review.duplicateSources.length) panel.append(node('p', W.duplicates, 'method'));
  return panel;
}
function playerHalfContext(match) {
  const source = coachingMatch(match), W = coachingWords();
  if (!source || !comparison.coaching.focus.player) return null;
  const details = node('details', undefined, 'coaching-halves');
  details.append(node('summary', words().bothHalves + ' · ' + comparison.coaching.focus.player));
  const rows = ['first', 'second'].map(key => {
    const stats = source[key].selectedStats;
    return [W[key], stats.actionCount, stats.actions.regain, stats.sequenceInvolvements, stats.successes];
  });
  details.append(coachingTable([W.half, W.actionCount, W.regain, W.sequenceInvolvements, W.successes], rows),
    node('p', W.method, 'method'));
  return details;
}
function retainPlayerSelection(review, match, sequences) {
  if (!comparison.coaching?.focus.player || !sequences.length) return;
  if (review.view.team !== comparison.view.team) review.selectedMomentId = null;
  review.view = {...comparison.view};
  review.recap = {...(review.recap || {}),
    player: comparison.coaching.focus.player, period: comparison.period, outcome: comparison.coaching.focus.outcome,
    observedCount: Math.max(review.cursor, review.recap?.observedCount || 0, match.count),
    selectedSequenceId: sequences[0].id};
}
async function savePlayerPlaylist(match, sequences) {
  const draft = draftFor(match), seen = new Set(draft.review.bookmarks.map(item => item.eventId));
  const additions = [];
  for (const sequence of sequences) if (!seen.has(sequence.eventId)) {
    seen.add(sequence.eventId);
    additions.push({eventId: sequence.eventId, count: sequence.count,
      label: (comparison.coaching.focus.player + ' · ' + words()[sequence.status] + ' · ' + time(sequence.fromSecond)).slice(0, 100),
      note: ''});
  }
  if (draft.review.bookmarks.length + additions.length > 64) throw new Error(words().playlistCapacity);
  draft.review.bookmarks.push(...additions); retainPlayerSelection(draft.review, match, sequences); keepDrafts();
  await saveOriginalReview(match, node('p')); notify(words().playlistSaved);
}

function renderComparison() {
  el('empty').hidden = Boolean(comparison);
  if (!comparison) { el('result').replaceChildren(); return; }
  const summary = node('section', undefined, 'panel');
  summary.append(node('h2', el('setTitle').value.trim() || words().comparison),
    node('p', comparison.view.team + ' · ' + words()[comparison.period === 'all' ? 'whole' : comparison.period], 'muted'));
  renderTable(summary); renderPlayerChoices();
  const panels = comparison.coaching?.focus.player ? [playerCoachingPanel(), summary] : [summary];
  el('result').replaceChildren(...panels, ...comparison.matches.map(matchPanel));
}
async function compare() {
  if (selected.length < 2 || selected.length > 4) throw new Error(words().chooseTwo);
  comparison = await request('/api/coach-review', 'POST', config());
  remember(); renderComparison(); notify(words().compareDone);
}
function downloadJSON(value, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], {type: 'application/json'}));
  const link = node('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const packageIdentity = value => JSON.stringify(canonical({match: value.match, review: value.review}));
async function recoverImportedMatch(pending, item) {
  // Reconcile an interrupted response against the existing archive. The portable
  // match and review must both match; a scenario/seed alone never identifies it.
  const candidates = collection.filter(match => !pending.beforeIds?.includes(match.id) &&
    match.scenario === item.package.match.scenario && match.seed === item.package.match.seed &&
    match.total === item.package.match.events.length);
  const expected = packageIdentity(item.package);
  for (const candidate of candidates) {
    const retained = await request('/api/archives/' + candidate.id + '/export');
    if (packageIdentity(retained) === expected) return {id: candidate.id, count: item.count};
  }
  return null;
}
el('compare').addEventListener('click', () => action(compare));
el('refresh').addEventListener('click', () => action(async () => { await refresh(); notify(words().refreshDone); }));
for (const key of ['team', 'period', 'audience', 'locale', 'focusPlayer', 'focusOutcome']) el(key).addEventListener('change', () => {
  if (key === 'team') setPlayerChoice(null);
  remember();
  if (key === 'locale') localize();
  if (selected.length >= 2) void action(compare);
});
el('setTitle').addEventListener('input', remember);
el('saveSet').addEventListener('click', () => {
  const value = config();
  if (!value.title) { notify(words().nameRequired, true); return; }
  if (selected.length < 2) { notify(words().chooseTwo, true); return; }
  sets = [value, ...sets.filter(item => item.title !== value.title)].slice(0, 24);
  if (!writeLocal(KEYS.sets, sets)) { notify(words().noStorage, true); return; }
  renderSets(); el('sets').value = '0'; notify(words().saveDone);
});
el('openSet').addEventListener('click', () => action(async () => {
  if (el('sets').value === '') return;
  const value = sets[Number(el('sets').value)];
  if (!value) return;
  applyConfig(value); localize(); remember(); await refresh(); await compare();
}));

async function savedComparisonForExport() {
  if (selected.length < 2) throw new Error(words().chooseTwo);
  for (const item of selected) {
    if (!drafts.has(item.id)) continue;
    if (!comparison?.matches.some(match => match.id === item.id)) await compare();
    await saveOriginalReview(comparison.matches.find(match => match.id === item.id), node('p'));
  }
  const result = await request('/api/coach-review', 'POST', {...config(), export: true});
  comparison = result; remember(); renderComparison(); return result;
}
function downloadBriefFile(content) {
  const url = URL.createObjectURL(new Blob([content], {type: 'text/html;charset=utf-8'}));
  const link = node('a'); link.href = url; link.download = 'counterpress-player-coaching.html'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

el('export').addEventListener('click', () => action(async () => {
  const result = await savedComparisonForExport();
  downloadJSON(result.bundle, 'counterpress-coach-review.json'); notify(words().exported);
}));
el('downloadBrief').addEventListener('click', () => action(async () => {
  const result = await savedComparisonForExport();
  const content = playerCoachingHtml(result.coaching, {title: el('setTitle').value.trim() || null, baseUrl: new URL('/', location.href).href});
  downloadBriefFile(content); notify(words().briefDownloaded);
}));
el('demo').addEventListener('click', () => action(async () => {
  const added = [];
  for (const scenario of ['high-press', 'low-block']) {
    const session = await request('/api/sessions', 'POST', {scenario, seed: 2026});
    try {
      const saved = await request('/api/archives', 'POST', {sessionId: session.id,
        review: {title: scenario + ' · 2026', cursor: session.total, view: config().view}});
      added.push({id: saved.id, count: saved.total});
    } finally { await request('/api/sessions/' + session.id, 'DELETE').catch(() => {}); }
  }
  selected = added; el('setTitle').value = el('locale').value === 'es' ? 'Comparación de presión' : 'Pressing comparison';
  await refresh(); await compare();
}));
el('import').addEventListener('click', () => action(async () => {
  const file = el('importFile').files[0];
  if (!file) throw new Error(words().noFile);
  if (file.size > 2.5 * 1024 * 1024) throw new Error(words().size);
  const text = await file.text(); let bundle;
  try { bundle = JSON.parse(text); } catch { throw new Error(words().noFile); }
  if (bundle.format === 'counterpress.match.v1')
    bundle = {format: FORMAT, title: bundle.review?.title || '', view: bundle.review?.view,
      period: bundle.review?.recap?.period || 'all',
      focus: {player: bundle.review?.recap?.player || null, outcome: bundle.review?.recap?.outcome || 'all'},
      matches: [{count: bundle.review?.cursor ?? 0, package: bundle}]};
  if (bundle.format !== FORMAT || !Array.isArray(bundle.matches) || bundle.matches.length < 1 || bundle.matches.length > 4 ||
      bundle.matches.some(item => item?.package?.format !== 'counterpress.match.v1' || !Number.isInteger(item.count) ||
        item.count < 0 || item.count > (item.package.match?.events?.length ?? -1))) throw new Error(words().noFile);
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(value => value.toString(16).padStart(2, '0')).join('');
  let history = readLocal(KEYS.imports, {});
  if (!history || typeof history !== 'object' || Array.isArray(history)) history = {};
  activeImport = activeImport?.hash === hash ? activeImport : history[hash] ?? {completed: [], pending: null};
  activeImport.hash = hash;
  const checkpoint = () => {
    history[hash] = activeImport;
    const entries = Object.entries(history).filter(([key]) => key !== hash).slice(-23);
    history = Object.fromEntries([...entries, [hash, activeImport]]); writeLocal(KEYS.imports, history);
  };
  try {
    await refresh();
    if (activeImport.pending) {
      const i = activeImport.pending.index ?? activeImport.completed.length;
      const retained = await recoverImportedMatch(activeImport.pending, bundle.matches[i]);
      if (retained) activeImport.completed[i] = retained;
      activeImport.pending = null; checkpoint();
    }
    for (let i = 0; i < bundle.matches.length; i++) {
      if (activeImport.completed[i] && collection.some(match => match.id === activeImport.completed[i].id)) continue;
      await refresh();
      activeImport.pending = {index: i, beforeIds: collection.map(match => match.id)}; checkpoint();
      const saved = await request('/api/archives/import', 'POST', bundle.matches[i].package);
      activeImport.completed[i] = {id: saved.id, count: bundle.matches[i].count}; activeImport.pending = null;
      checkpoint();
      el('importProgress').textContent = activeImport.completed.filter(Boolean).length + ' / ' + bundle.matches.length;
    }
  } catch (error) {
    if (error.status) { activeImport.pending = null; checkpoint(); }
    await refresh().catch(() => {});
    throw new Error(error.message + ' ' + words().partialImport);
  }
  applyConfig({...bundle, matches: activeImport.completed}); localize(); remember(); await refresh();
  if (selected.length >= 2) await compare();
  notify(words().importDone);
}));

sets = readLocal(KEYS.sets, []);
if (!Array.isArray(sets)) sets = [];
sets = sets.filter(item => item && typeof item.title === 'string' && Array.isArray(item.matches)).slice(0, 24);
const retainedDrafts = readLocal(KEYS.drafts, {});
if (retainedDrafts && typeof retainedDrafts === 'object' && !Array.isArray(retainedDrafts)) {
  for (const [id, draft] of Object.entries(retainedDrafts).slice(0, 64)) {
    if (draft && Number.isInteger(draft.revision) && typeof draft.review?.notes === 'string' && Array.isArray(draft.review?.bookmarks)) drafts.set(id, draft);
  }
}
applyConfig(readLocal(KEYS.current, null)); localize();
void action(async () => {
  await refresh();
  if (selected.length >= 2) await compare();
  else notify(storageAvailable ? '' : words().noStorage, !storageAvailable);
});
