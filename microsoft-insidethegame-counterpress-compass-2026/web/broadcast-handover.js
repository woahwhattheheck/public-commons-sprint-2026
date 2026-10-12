import {ArchiveLink} from './archive.js';

const el = id => document.getElementById(id);
const node = (tag, value, className = '') => {
  const item = document.createElement(tag);
  if (value !== undefined) item.textContent = value;
  item.className = className;
  return item;
};
const clone = value => structuredClone(value);
const equal = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const KEY = 'counterpress.library.v1', DRAFT = 'counterpress.broadcast.draft.v1.';
const WORDS = {
  en: {
    player:'Match player', coach:'Coach review', language:'Language', eyebrow:'BROADCAST WORKSPACE',
    heading:'Prepare a match handover', intro:'Choose the original plays, edit the captions, and map them to your recording.',
    collection:'Saved match', choose:'Choose a saved match', open:'Open match', refresh:'Refresh', import:'Import match',
    empty:'Save a match in the player or import its downloaded package to prepare captions here.',
    details:'Handover details', title:'Handover title', team:'Team', audience:'Audience', casual:'Fan', analyst:'Analyst',
    through:'Through event', fullMatch:'Use full match', updateSources:'Update source choices', notes:'Production notes',
    save:'Save handover', saveCopy:'Save a copy', reload:'Reload saved version', openPlayer:'Open selected match in player',
    sourcePlays:'Source plays', sourceType:'Show', pressSequences:'Press sequences', shots:'Shots', regains:'Regains',
    pressures:'Pressure actions', passes:'Passes', losses:'Possession losses', savedMoments:'Saved moments', focus:'Player',
    allPlayers:'All players', recording:'Recording',
    recordingHelp:'Open your video to choose caption in and out points. The video stays on this device; the handover retains its name, duration and your timing choices.',
    videoFile:'Open local recording', recordingName:'Recording name', duration:'Duration in seconds',
    timingHelp:'Match time identifies the original play. Video time locates your caption in the edited recording. Leave both video fields empty until a caption has been placed.',
    captions:'Caption rundown', delivery:'Deliver the handover',
    deliveryHelp:'The editable match includes the complete original events, review, saved insights and captions. The HTML handover opens on its own with an event replay. WebVTT includes captions with video timing.',
    downloadMatch:'Editable match · JSON', downloadHtml:'Readable handover · HTML', downloadVtt:'Timed captions · WebVTT',
    footer:'Match review and broadcast preparation.', working:'Working…', ready:'Ready.', saved:'Handover saved.',
    local:'Edits retained in this browser. Save the handover to keep them with the match.',
    shared:'Shared review. Save a copy to keep an editable handover in your collection.',
    conflict:'Another tab changed this handover. Your edits remain here; save a copy or download them.',
    updated:'Source choices updated.', add:'Add caption', viewPlay:'Open original play', noSources:'No matching plays in this selection.',
    noCues:'Add a source play to start the caption rundown.', caption:'Caption', text:'Caption text',
    in:'Video in · seconds', out:'Video out · seconds', useIn:'Use playhead', useOut:'Use playhead',
    previewVideo:'Preview video position', up:'Move up', down:'Move down', remove:'Remove caption',
    evidence:'Original events', watermark:'Result becomes available at', untimed:'Unscheduled', timed:'timed',
    matchTime:'Match clock', event:'Event', original:'Original synthetic match', sources:'source choices',
    imported:'Match imported.', exported:'Handover downloaded.', noFile:'Choose a Counterpress match JSON file under 512KB.',
    savedDraft:'Your retained editing draft has been restored.', clipFirst:'Open a recording to use its playhead.',
    videoReady:'Recording opened. Review the caption positions for this file.', noClip:'Open a recording or enter video times directly.',
    maximum:'A handover supports up to 64 captions.', reloadAsk:'Reload the saved handover and discard these local changes?',
    sourceError:'The original match is unavailable.', storage:'Browser storage is unavailable. Download the handover before closing.',
    changedTeam:'Source choices changed. Authored caption text is preserved.', loaded:'Match opened.',
  },
  es: {
    player:'Reproductor', coach:'Análisis del entrenador', language:'Idioma', eyebrow:'ESPACIO DE EMISIÓN',
    heading:'Prepara un guion del partido', intro:'Elige jugadas originales, edita los subtítulos y sitúalos en tu grabación.',
    collection:'Partido guardado', choose:'Elegir partido guardado', open:'Abrir partido', refresh:'Actualizar', import:'Importar partido',
    empty:'Guarda un partido en el reproductor o importa su archivo para preparar subtítulos aquí.',
    details:'Datos del guion', title:'Título del guion', team:'Equipo', audience:'Público', casual:'Aficionado', analyst:'Analista',
    through:'Hasta la jugada', fullMatch:'Usar partido completo', updateSources:'Actualizar jugadas', notes:'Notas de producción',
    save:'Guardar guion', saveCopy:'Guardar una copia', reload:'Recargar versión guardada', openPlayer:'Abrir partido seleccionado',
    sourcePlays:'Jugadas de origen', sourceType:'Mostrar', pressSequences:'Secuencias de presión', shots:'Disparos', regains:'Recuperaciones',
    pressures:'Acciones de presión', passes:'Pases', losses:'Pérdidas de posesión', savedMoments:'Momentos guardados', focus:'Jugador',
    allPlayers:'Todos los jugadores', recording:'Grabación',
    recordingHelp:'Abre tu vídeo para elegir la entrada y salida de cada subtítulo. El vídeo permanece en este dispositivo; el guion conserva su nombre, duración y tiempos.',
    videoFile:'Abrir grabación local', recordingName:'Nombre de la grabación', duration:'Duración en segundos',
    timingHelp:'El reloj del partido identifica la jugada. El tiempo del vídeo sitúa el subtítulo en la grabación editada. Deja ambos campos vacíos hasta situarlo.',
    captions:'Guion de subtítulos', delivery:'Entregar el guion',
    deliveryHelp:'El partido editable incluye todas las jugadas originales, análisis, explicaciones guardadas y subtítulos. El HTML se abre por sí solo con una reproducción de jugadas. WebVTT incluye los subtítulos temporizados.',
    downloadMatch:'Partido editable · JSON', downloadHtml:'Guion legible · HTML', downloadVtt:'Subtítulos · WebVTT',
    footer:'Análisis de partidos y preparación de emisiones.', working:'Procesando…', ready:'Listo.', saved:'Guion guardado.',
    local:'Cambios conservados en este navegador. Guarda el guion para conservarlos con el partido.',
    shared:'Análisis compartido. Guarda una copia editable en tu colección.',
    conflict:'Otra pestaña cambió este guion. Tus cambios siguen aquí; guarda una copia o descárgalos.',
    updated:'Jugadas actualizadas.', add:'Añadir subtítulo', viewPlay:'Abrir jugada original', noSources:'No hay jugadas en esta selección.',
    noCues:'Añade una jugada para comenzar el guion.', caption:'Subtítulo', text:'Texto del subtítulo',
    in:'Entrada del vídeo · segundos', out:'Salida del vídeo · segundos', useIn:'Usar posición', useOut:'Usar posición',
    previewVideo:'Ver posición del vídeo', up:'Subir', down:'Bajar', remove:'Eliminar subtítulo',
    evidence:'Jugadas originales', watermark:'Resultado disponible en', untimed:'Sin programar', timed:'temporizados',
    matchTime:'Reloj del partido', event:'Jugada', original:'Partido sintético original', sources:'jugadas disponibles',
    imported:'Partido importado.', exported:'Guion descargado.', noFile:'Elige un JSON de Counterpress de menos de 512KB.',
    savedDraft:'Se ha restaurado tu borrador de edición.', clipFirst:'Abre una grabación para usar su posición.',
    videoReady:'Grabación abierta. Revisa las posiciones de los subtítulos para este archivo.', noClip:'Abre una grabación o introduce sus tiempos.',
    maximum:'Un guion admite hasta 64 subtítulos.', reloadAsk:'¿Recargar el guion guardado y descartar estos cambios locales?',
    sourceError:'El partido original no está disponible.', storage:'El almacenamiento no está disponible. Descarga el guion antes de cerrar.',
    changedTeam:'Selección actualizada. Se conserva el texto editado.', loaded:'Partido abierto.',
  },
};
let libraryKey, persistent = true;
try { libraryKey = localStorage.getItem(KEY); } catch { persistent = false; }
if (!/^[0-9a-f]{64}$/.test(libraryKey || '')) {
  libraryKey = [...crypto.getRandomValues(new Uint8Array(32))].map(v => v.toString(16).padStart(2, '0')).join('');
  try { localStorage.setItem(KEY, libraryKey); } catch { persistent = false; }
}
let current = null, draft = null, baseBroadcast = null, collection = [];
let dirty = false, conflict = false, busy = false, editVersion = 0, generation = 0;
let videoUrl = null, sourceGeneration = 0;
const words = () => WORDS[el('locale').value] || WORDS.en;
const clock = second => {
  const tenths = Math.round(second * 10);
  return String(Math.floor(tenths / 600)).padStart(2, '0') + ':' +
    String(Math.floor(tenths / 10) % 60).padStart(2, '0') + '.' + tenths % 10;
};
const nullableNumber = value => value === '' ? null : Number(value);
const notify = (message, target = 'status') => { el(target).textContent = message; };
function remember() {
  if (!current || !dirty) return;
  try { localStorage.setItem(DRAFT + current.archive.id, JSON.stringify({
    broadcast: draft, baseBroadcast, revision: current.archive.revision, editedAt: new Date().toISOString(),
  })); } catch { persistent = false; }
}
function forget(id) { try { localStorage.removeItem(DRAFT + id); } catch {} }
function status() {
  if (busy) return notify(words().working);
  notify(conflict ? words().conflict : !persistent ? words().storage :
    dirty ? words().local : current && !current.archive.canEdit ? words().shared : words().saved);
}
function changed() { dirty = true; conflict = false; editVersion++; remember(); status(); updateCounts(); }
async function request(path, method = 'GET', body) {
  const headers = {'X-Counterpress-Library': libraryKey};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, {method, headers, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(value.error || words().sourceError), {status: response.status});
  return value;
}
function setBusy(value) {
  busy = value;
  for (const control of document.querySelectorAll('main button, main input, main textarea, main select')) control.disabled = value;
  if (!value) {
    el('open').disabled = !el('archiveSelect').value;
    el('save').disabled = !current?.archive.canEdit;
    el('downloadVtt').disabled = !draft?.cues.some(cue => cue.videoStart !== null && cue.videoEnd !== null);
    renderSources(); renderCues();
  }
  status();
}
function localize() {
  const W = words();
  document.documentElement.lang = el('locale').value;
  document.title = 'Counterpress Compass — ' + W.heading;
  for (const item of document.querySelectorAll('[data-i18n]')) {
    if (W[item.dataset.i18n]) item.textContent = W[item.dataset.i18n];
  }
  renderCollection();
}
function renderCollection() {
  const selected = el('archiveSelect').value || current?.archive.id || '';
  const placeholder = node('option', words().choose); placeholder.value = '';
  el('archiveSelect').replaceChildren(placeholder, ...collection.map(archive => {
    const item = node('option', archive.title + ' · ' + archive.cursor + '/' + archive.total);
    item.value = archive.id; return item;
  }));
  if (collection.some(item => item.id === selected)) el('archiveSelect').value = selected;
  el('open').disabled = busy || !el('archiveSelect').value;
}
async function refresh() {
  const value = await request('/api/archives');
  collection = value.archives; renderCollection();
  notify(collection.length ? collection.length + ' · ' + words().collection : words().empty, 'collectionStatus');
}
function updateCollection(archive) {
  if (archive.canEdit) collection = [archive, ...collection.filter(item => item.id !== archive.id)];
  renderCollection();
  if (archive.canEdit) el('archiveSelect').value = archive.id;
}
function urlFor(count, team = draft?.view.team) {
  return ArchiveLink.url(current.archive.id, count, {...draft.view, team}, new URL('/', location.href).href);
}
function updateCounts() {
  if (!draft) return;
  const timed = draft.cues.filter(cue => cue.videoStart !== null && cue.videoEnd !== null).length;
  el('cueCount').textContent = draft.cues.length + '/64 · ' + timed + ' ' + words().timed;
  el('downloadVtt').disabled = busy || !timed;
  el('openPlayer').href = urlFor(draft.count);
}
function sourceFor(cue) {
  const key = cue.momentId ? 'moment:' + cue.momentId : 'event:' + cue.eventId;
  return [...(current.candidates?.moments || []), ...(current.candidates?.events || [])].find(item => item.key === key) ||
    current.report.cues.find(item => item.id === cue.id);
}
function renderSources() {
  if (!current || !draft) return;
  const W = words(), type = el('sourceType').value, focus = el('focus').value;
  const saved = new Set(current.package.review.bookmarks.map(item => item.eventId));
  const candidates = type === 'sequence' ? current.candidates.moments :
    current.candidates.events.filter(item => type === 'saved' ? saved.has(item.eventId) : item.eventType === type);
  const selected = candidates.filter(item => !focus || item.players.includes(focus));
  el('sourceCount').textContent = selected.length + ' ' + W.sources;
  el('sourceList').replaceChildren(...(selected.length ? selected.map(item => {
    const row = node('li'), caption = node('p', item.caption);
    const meta = node('p', clock(item.matchSecond) + ' · ' + item.team + ' · ' +
      W.event + ' ' + item.count + ' · ' + item.eventId, 'meta metric');
    const actions = node('div', undefined, 'source-actions');
    const add = node('button', W.add); add.type = 'button'; add.disabled = busy || draft.cues.length >= 64;
    add.addEventListener('click', () => {
      if (draft.cues.length >= 64) return notify(W.maximum);
      draft.cues.push({id: 'cue_' + crypto.randomUUID().replaceAll('-', ''), eventId: item.eventId,
        count: item.count, momentId: item.momentId, caption: item.caption, videoStart: null, videoEnd: null});
      changed(); renderCues(); renderSources();
    });
    const link = node('a', W.viewPlay); link.href = urlFor(item.count, item.team); link.target = '_blank'; link.rel = 'noopener';
    actions.append(add, link); row.append(caption, meta, actions); return row;
  }) : [node('li', W.noSources, 'note')]));
}
function renderCues() {
  if (!draft) return;
  const W = words();
  el('cues').replaceChildren(...(draft.cues.length ? draft.cues.map((cue, i) => {
    const source = sourceFor(cue), event = current.package.match.events[cue.count - 1];
    const row = node('li', undefined, 'cue'), header = node('div', undefined, 'cue-head');
    const meta = node('div'), heading = node('h3', W.caption + ' ' + (i + 1));
    meta.append(heading, node('p', W.matchTime + ' ' + clock(source?.matchSecond ?? event.second) +
      ' · ' + event.team + ' · ' + W.event + ' ' + cue.count + ' · ' + cue.eventId, 'note metric'));
    const tools = node('div', undefined, 'cue-tools');
    for (const [label, delta] of [[W.up, -1], [W.down, 1]]) {
      const move = node('button', label); move.type = 'button';
      move.disabled = busy || i + delta < 0 || i + delta >= draft.cues.length;
      move.onclick = () => {
        const other = draft.cues[i + delta]; draft.cues[i + delta] = cue; draft.cues[i] = other;
        changed(); renderCues();
      }; tools.append(move);
    }
    const remove = node('button', W.remove); remove.type = 'button'; remove.disabled = busy;
    remove.onclick = () => { draft.cues = draft.cues.filter(item => item.id !== cue.id); changed(); renderCues(); renderSources(); };
    tools.append(remove); header.append(meta, tools);
    const captionLabel = node('label', W.text), caption = node('textarea'); caption.rows = 3; caption.maxLength = 500;
    caption.value = cue.caption; caption.disabled = busy;
    caption.oninput = () => { cue.caption = caption.value; changed(); updateVideo(); };
    captionLabel.append(caption);
    const fields = node('div', undefined, 'fields');
    for (const [field, label, useLabel] of [['videoStart', W.in, W.useIn], ['videoEnd', W.out, W.useOut]]) {
      const group = node('div', undefined, 'time-controls'), labelNode = node('label', label);
      const input = node('input'); input.type = 'number'; input.min = '0'; input.max = '86400'; input.step = '0.001';
      input.inputMode = 'decimal'; input.value = cue[field] ?? ''; input.disabled = busy;
      input.oninput = () => { cue[field] = nullableNumber(input.value); changed(); updateVideo(); };
      labelNode.append(input);
      const use = node('button', useLabel); use.type = 'button'; use.disabled = busy || el('video').hidden;
      use.onclick = () => {
        if (el('video').hidden || !Number.isFinite(el('video').currentTime)) return notify(W.clipFirst);
        cue[field] = Math.round(el('video').currentTime * 1000) / 1000;
        input.value = cue[field]; changed(); updateVideo();
      }; group.append(labelNode, use); fields.append(group);
    }
    const actions = node('div', undefined, 'source-actions');
    const replay = node('a', W.viewPlay); replay.href = urlFor(cue.count, source?.team ?? event.team); replay.target = '_blank'; replay.rel = 'noopener';
    const preview = node('button', W.previewVideo); preview.type = 'button'; preview.disabled = busy || el('video').hidden || cue.videoStart === null;
    preview.onclick = () => { el('video').currentTime = cue.videoStart; el('video').scrollIntoView({block: 'center'}); updateVideo(); };
    actions.append(replay, preview);
    row.append(header, captionLabel, fields, actions);
    if (source) {
      const detail = node('details'), summary = node('summary', W.evidence), list = node('ol', undefined, 'evidence');
      for (const item of source.evidence || []) list.append(node('li',
        clock(item.second) + ' · ' + item.id + ' · ' + item.team + ' · ' + item.player + ' · ' + item.type));
      if (source.watermark) list.append(node('li', W.watermark + ' ' + clock(source.watermark.second) + ' · ' + source.watermark.id));
      detail.append(summary, list); row.append(detail);
    }
    return row;
  }) : [node('li', W.noCues, 'note')]));
  updateCounts();
}
function renderEditor() {
  if (!current || !draft) return;
  el('empty').hidden = true; el('editor').hidden = false;
  el('locale').value = draft.view.locale; localize();
  el('title').value = draft.title; el('notes').value = draft.notes;
  el('team').value = draft.view.team; el('audience').value = draft.view.audience;
  el('count').value = draft.count; el('count').max = current.package.match.events.length;
  el('recordingName').value = draft.recording.label; el('duration').value = draft.recording.durationSeconds ?? '';
  el('source').textContent = words().original + ' · ' + current.archive.title + ' · ' +
    words().event + ' ' + draft.count + '/' + current.package.match.events.length;
  const selected = el('focus').value, placeholder = node('option', words().allPlayers); placeholder.value = '';
  el('focus').replaceChildren(placeholder, ...current.candidates.players.map(name => {
    const option = node('option', name); option.value = name; return option;
  }));
  if (current.candidates.players.includes(selected)) el('focus').value = selected;
  renderSources(); renderCues(); updateVideo(); setBusy(busy);
}
function clearVideo() {
  el('video').pause(); el('video').removeAttribute('src'); el('video').load(); el('video').hidden = true;
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = null; el('videoFile').value = '';
}
function updateVideo() {
  if (!draft) return;
  const video = el('video'), time = video.currentTime || 0;
  el('videoPosition').textContent = video.hidden ? words().noClip :
    time.toFixed(3) + ' / ' + (Number.isFinite(video.duration) ? video.duration.toFixed(3) : '—') + ' s';
  el('videoCaption').textContent = video.hidden ? '' : draft.cues.filter(cue =>
    cue.videoStart !== null && cue.videoEnd !== null && time >= cue.videoStart && time < cue.videoEnd).map(cue => cue.caption).join('\n');
}
async function openMatch(id, {restoreDraft = true} = {}) {
  const own = ++generation;
  setBusy(true);
  try {
    const value = await request('/api/broadcast-handover', 'POST', {id});
    if (own !== generation) return false;
    clearVideo(); current = value; draft = clone(value.report.broadcast);
    baseBroadcast = clone(value.archive.review.broadcast ?? null); dirty = false; conflict = false; editVersion = 0;
    let retained = null;
    if (restoreDraft) {
      try { retained = JSON.parse(localStorage.getItem(DRAFT + id)); } catch {}
      if (retained?.broadcast?.format === 'counterpress.broadcast.v1') {
        draft = retained.broadcast; baseBroadcast = retained.baseBroadcast ?? null; dirty = true;
        conflict = !equal(baseBroadcast, value.archive.review.broadcast);
      }
    }
    updateCollection(value.archive);
    history.replaceState(null, '', '/broadcast-handover#' + new URLSearchParams({archive: id}));
    renderEditor();
    if (dirty) {
      try {
        const projected = await request('/api/broadcast-handover', 'POST', {id, broadcast: draft});
        if (own === generation) { current.report = projected.report; current.candidates = projected.candidates; renderEditor(); }
      } catch (error) { notify(error.message); }
    }
    notify(retained ? words().savedDraft : words().loaded, 'deliveryStatus');
    return true;
  } catch (error) { notify(error.message, current ? 'status' : 'collectionStatus'); return false; }
  finally { if (own === generation) setBusy(false); }
}
async function save({copy = false} = {}) {
  if (!current || !draft || busy) return false;
  if (!dirty && !copy && current.archive.review.broadcast) return true;
  const selected = current, sent = clone(draft), sentVersion = editVersion, oldId = selected.archive.id;
  if (!copy && !selected.archive.canEdit) { notify(words().shared); return false; }
  setBusy(true);
  try {
    let record, originalPackage;
    if (copy) {
      originalPackage = await request('/api/archives/' + oldId + '/export');
      originalPackage.review = {...originalPackage.review, broadcast: sent};
      record = await request('/api/archives/import', 'POST', originalPackage);
    } else {
      try {
        record = await request('/api/archives/' + oldId, 'PUT', {
          revision: selected.archive.revision, review: {...selected.archive.review, broadcast: sent},
        });
      } catch (error) {
        if (error.status !== 409) throw error;
        // Compose other-tab notes/recap changes only when the broadcast field
        // itself still matches the base that this editor actually opened.
        const latest = await request('/api/archives/' + oldId);
        if (!equal(latest.review.broadcast, baseBroadcast)) throw error;
        record = await request('/api/archives/' + oldId, 'PUT', {
          revision: latest.revision, review: {...latest.review, broadcast: sent},
        });
      }
    }
    current.archive = record;
    current.package = originalPackage || current.package;
    current.package.review = record.review;
    baseBroadcast = clone(record.review.broadcast);
    if (sentVersion === editVersion) {
      draft = clone(record.review.broadcast); dirty = false; forget(oldId); forget(record.id);
    } else remember();
    conflict = false; updateCollection(record);
    history.replaceState(null, '', '/broadcast-handover#' + new URLSearchParams({archive: record.id}));
    const projected = await request('/api/broadcast-handover', 'POST', {id: record.id, broadcast: draft});
    current.report = projected.report; current.candidates = projected.candidates;
    renderEditor(); notify(words().saved, 'deliveryStatus'); return true;
  } catch (error) {
    if (error.status === 409) conflict = true;
    remember(); notify(conflict ? words().conflict : error.message, 'deliveryStatus'); return false;
  } finally { setBusy(false); }
}
async function beforeSwitch() {
  if (busy) return false;
  if (dirty && !await save()) return false;
  return true;
}
async function refreshSources() {
  if (!current || busy) return;
  const own = ++sourceGeneration, selected = current.archive.id, version = editVersion;
  setBusy(true);
  try {
    const value = await request('/api/broadcast-handover', 'POST', {id: selected, broadcast: draft});
    if (own !== sourceGeneration || current.archive.id !== selected || version !== editVersion) return;
    current.report = value.report; current.candidates = value.candidates; draft = value.report.broadcast;
    renderEditor(); remember(); notify(words().updated, 'deliveryStatus');
  } catch (error) { notify(error.message, 'deliveryStatus'); }
  finally { setBusy(false); }
}
async function download(format) {
  if (!current || busy) return;
  setBusy(true);
  try {
    const response = await fetch('/api/broadcast-handover', {method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-Counterpress-Library': libraryKey},
      body: JSON.stringify({id: current.archive.id, broadcast: draft, format})});
    if (!response.ok) throw new Error((await response.json()).error || words().sourceError);
    const blob = await response.blob(), url = URL.createObjectURL(blob), anchor = node('a');
    anchor.href = url; anchor.download = 'counterpress-broadcast.' + ({match:'json', html:'html', vtt:'vtt'})[format];
    document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify(words().exported, 'deliveryStatus');
  } catch (error) { notify(error.message, 'deliveryStatus'); }
  finally { setBusy(false); }
}

el('archiveSelect').onchange = () => { el('open').disabled = busy || !el('archiveSelect').value; };
el('open').onclick = async () => {
  const id = el('archiveSelect').value;
  if (id && await beforeSwitch()) await openMatch(id);
};
el('refresh').onclick = async () => { if (busy) return; setBusy(true); try { await refresh(); } catch (error) { notify(error.message, 'collectionStatus'); } finally { setBusy(false); } };
el('save').onclick = () => void save();
el('saveCopy').onclick = () => void save({copy: true});
el('reload').onclick = () => {
  if (!current || busy) return;
  if (dirty && !confirm(words().reloadAsk)) return;
  forget(current.archive.id); void openMatch(current.archive.id, {restoreDraft: false});
};
for (const [id, key] of [['title','title'], ['notes','notes']])
  el(id).oninput = () => { draft[key] = el(id).value; changed(); };
el('recordingName').oninput = () => { draft.recording.label = el('recordingName').value; changed(); };
el('duration').oninput = () => { draft.recording.durationSeconds = nullableNumber(el('duration').value); changed(); };
el('count').oninput = () => { draft.count = Number(el('count').value); changed(); };
for (const [id, key] of [['team','team'], ['audience','audience']])
  el(id).onchange = () => { draft.view[key] = el(id).value; changed(); void refreshSources(); };
el('locale').onchange = () => {
  localize();
  if (draft) { draft.view.locale = el('locale').value; changed(); void refreshSources(); }
};
el('fullMatch').onclick = () => {
  if (!draft || busy) return;
  draft.count = current.package.match.events.length; el('count').value = draft.count; changed(); void refreshSources();
};
el('preview').onclick = () => void refreshSources();
el('sourceType').onchange = renderSources; el('focus').onchange = renderSources;
el('videoFile').onchange = () => {
  const file = el('videoFile').files[0];
  if (!file || !draft) return;
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = URL.createObjectURL(file); el('video').src = videoUrl; el('video').hidden = false;
  draft.recording.label = file.name.slice(0, 200); el('recordingName').value = draft.recording.label;
  changed(); renderCues();
};
el('video').onloadedmetadata = () => {
  if (!draft || !Number.isFinite(el('video').duration)) return;
  draft.recording.durationSeconds = Math.round(el('video').duration * 1000) / 1000;
  el('duration').value = draft.recording.durationSeconds; changed(); updateVideo(); notify(words().videoReady, 'deliveryStatus');
};
el('video').ontimeupdate = updateVideo;
el('video').onerror = () => { if (!el('video').hidden) notify('The browser could not open this recording.', 'deliveryStatus'); };
el('downloadMatch').onclick = () => void download('match');
el('downloadHtml').onclick = () => void download('html');
el('downloadVtt').onclick = () => void download('vtt');
el('import').onclick = () => el('importFile').click();
el('importFile').onchange = async () => {
  const file = el('importFile').files[0]; el('importFile').value = '';
  if (!file) return;
  if (file.size > 512 * 1024) return notify(words().noFile, 'collectionStatus');
  if (!await beforeSwitch()) return;
  setBusy(true);
  let imported = null;
  try {
    let value; try { value = JSON.parse(await file.text()); } catch { throw new Error(words().noFile); }
    imported = await request('/api/archives/import', 'POST', value);
    updateCollection(imported);
  } catch (error) { notify(error.message, 'collectionStatus'); }
  finally { setBusy(false); }
  if (imported) { await openMatch(imported.id); notify(words().imported, 'collectionStatus'); }
};
addEventListener('beforeunload', event => { if (dirty) { remember(); event.preventDefault(); event.returnValue = ''; } });
addEventListener('pagehide', () => { remember(); el('video').pause(); if (videoUrl) URL.revokeObjectURL(videoUrl); });
localize();
await refresh().catch(error => notify(error.message, 'collectionStatus'));
const requested = new URLSearchParams(location.hash.slice(1)).get('archive');
if (requested) await openMatch(requested);
else { el('editor').hidden = true; el('empty').hidden = false; el('open').disabled = !el('archiveSelect').value; }
