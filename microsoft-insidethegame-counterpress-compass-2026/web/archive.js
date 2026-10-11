// Saved-match collection, portable reviews and original-event bookmarks.
const el = id => document.getElementById(id);
const make = (tag, text, className = '') => {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  result.className = className;
  return result;
};
const ID = /^[0-9a-f]{16}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const WORDS = {
  en: {heading: 'Saved matches', help: 'Keep the original match, review and replay position. Shared match links include saved notes.',
    choose: 'Choose a saved match', open: 'Open match', save: 'Save match', saveCopy: 'Save a copy', saveReview: 'Save review',
    download: 'Download match', import: 'Import match', remove: 'Remove saved match', confirmRemove: 'Confirm removal',
    title: 'Match title', notes: 'Coach notes', moments: 'Saved moments', current: 'Save current event', moment: 'Save this moment',
    already: 'Moment saved', momentTitle: 'Moment title', momentNote: 'Moment note', deleteMoment: 'Remove moment',
    empty: 'Save a match to keep your review here.', noBookmarks: 'Save a moment from the film room or the current event.',
    saving: 'Saving…', saved: 'Saved', dirty: 'Saving your changes…', shared: 'Shared review. Save a copy to add your own notes.',
    autosave: 'Changes save automatically. Downloads also contain your original match events.',
    ready: 'Choose a saved match or save the match you are watching.', imported: 'Match imported into your collection.',
    deleted: 'Saved match removed. The current replay remains available.', loadError: 'Could not load saved matches.',
    fileError: 'Choose a Counterpress match JSON file smaller than 512KB.', saveError: 'Changes could not be saved. Retry Save review or download this match.',
    conflict: 'This review changed in another tab. Your edits remain here; save a copy to keep them.',
    browserKey: 'Browser storage is unavailable. Download saved matches before closing this browser.',
    openEvent: n => 'Open event ' + n, progress: (n, total) => 'Event ' + n + ' / ' + total,
    count: n => n + ' saved moment' + (n === 1 ? '' : 's'), error: 'Saved match unavailable',
  },
  es: {heading: 'Partidos guardados', help: 'Conserva el partido original, el análisis y la posición. Los enlaces compartidos incluyen las notas guardadas.',
    choose: 'Elegir un partido guardado', open: 'Abrir partido', save: 'Guardar partido', saveCopy: 'Guardar una copia', saveReview: 'Guardar análisis',
    download: 'Descargar partido', import: 'Importar partido', remove: 'Eliminar partido guardado', confirmRemove: 'Confirmar eliminación',
    title: 'Título del partido', notes: 'Notas del entrenador', moments: 'Momentos guardados', current: 'Guardar jugada actual', moment: 'Guardar este momento',
    already: 'Momento guardado', momentTitle: 'Título del momento', momentNote: 'Nota del momento', deleteMoment: 'Eliminar momento',
    empty: 'Guarda un partido para conservar tu análisis aquí.', noBookmarks: 'Guarda un momento del análisis táctico o la jugada actual.',
    saving: 'Guardando…', saved: 'Guardado', dirty: 'Guardando los cambios…', shared: 'Análisis compartido. Guarda una copia para añadir tus notas.',
    autosave: 'Los cambios se guardan automáticamente. La descarga incluye las jugadas originales.',
    ready: 'Abre un partido guardado o guarda el que estás viendo.', imported: 'Partido importado a tu colección.',
    deleted: 'Partido guardado eliminado. La reproducción actual sigue disponible.', loadError: 'No se pudieron cargar los partidos guardados.',
    fileError: 'Elige un archivo JSON de Counterpress de menos de 512KB.', saveError: 'No se pudieron guardar los cambios. Reintenta guardar o descarga el partido.',
    conflict: 'El análisis cambió en otra pestaña. Tus cambios siguen aquí; guarda una copia para conservarlos.',
    browserKey: 'El almacenamiento del navegador no está disponible. Descarga los partidos antes de cerrar.',
    openEvent: n => 'Abrir jugada ' + n, progress: (n, total) => 'Jugada ' + n + ' / ' + total,
    count: n => n + ' momento' + (n === 1 ? '' : 's') + ' guardado' + (n === 1 ? '' : 's'), error: 'Partido guardado no disponible',
  },
};

export const ArchiveLink = {
  keys: ['saved', 'archive', 'event', 'team', 'audience', 'locale'],
  read(hash) {
    const query = new URLSearchParams(hash.replace(/^#/, ''));
    if (!query.has('saved')) return null;
    if (query.get('saved') !== '1' || this.keys.some(key => query.getAll(key).length !== 1) ||
        [...query.keys()].some(key => !this.keys.includes(key)) || !ID.test(query.get('archive') || '') ||
        !/^(0|[1-9][0-9]{0,3})$/.test(query.get('event') || '') ||
        !['Harbor FC', 'Metro Rovers'].includes(query.get('team')) ||
        !['casual', 'analyst'].includes(query.get('audience')) || !['en', 'es'].includes(query.get('locale')))
      throw new Error('Invalid saved-match link');
    return {id: query.get('archive'), count: Number(query.get('event')),
      settings: {team: query.get('team'), audience: query.get('audience'), locale: query.get('locale')}};
  },
  url(id, count, view, href) {
    const url = new URL(href);
    url.username = ''; url.password = ''; url.search = '';
    url.hash = new URLSearchParams({saved: '1', archive: id, event: String(count), ...view}).toString();
    return url.href;
  },
};

export function createArchiveUI({snapshot, onSaved, onDeleted, onOpen, onJump, onPause, onReviewChanged}) {
  let libraryKey, persistentKey = true;
  try { libraryKey = localStorage.getItem('counterpress.library.v1'); } catch { persistentKey = false; }
  if (!/^[0-9a-f]{64}$/.test(libraryKey || '')) {
    libraryKey = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem('counterpress.library.v1', libraryKey); } catch { persistentKey = false; }
  }
  let current = null, bookmarks = [], collection = [], version = 0, savedVersion = 0;
  let editVersion = 0, savedEditVersion = 0;
  let generation = 0, saving = null, timer = null, deadline = null, viewStamp = '', lastLocale = null;
  let conflict = false, removing = false, failure = '', busy = false;
  const words = () => WORDS[snapshot().view.locale] || WORDS.en;
  const dirty = () => version !== savedVersion;
  const notify = message => { el('archiveStatus').textContent = message; };
  function clearTimers() { clearTimeout(timer); clearTimeout(deadline); timer = null; deadline = null; }
  async function request(url, method = 'GET', body, {keepalive = false} = {}) {
    const headers = {'X-Counterpress-Library': libraryKey};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(url, {method, headers, ...(body === undefined ? {} : {body: JSON.stringify(body)}), keepalive});
    const value = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(value?.error || words().error), {status: response.status});
    return value;
  }
  function review() {
    const state = snapshot();
    return {title: current ? el('archiveTitle').value : (state.label || state.match.scenario) + ' · ' + state.match.seed,
      notes: current ? el('archiveNotes').value : '', bookmarks: structuredClone(bookmarks),
      cursor: state.cursor, view: state.view, selectedMomentId: state.selectedMomentId, filters: state.filters};
  }
  function stamp() {
    const state = snapshot();
    return JSON.stringify({cursor: state.cursor, view: state.view, selectedMomentId: state.selectedMomentId, filters: state.filters});
  }
  function schedule() {
    if (!current?.canEdit || conflict) return;
    clearTimeout(timer);
    timer = setTimeout(() => { void save(); }, 700);
    if (!deadline) deadline = setTimeout(() => { void save(); }, 2500);
  }
  function markDirty(authored = false) {
    if (!current?.canEdit) return;
    version++; removing = false; failure = '';
    if (authored) editVersion++;
    schedule(); render();
  }
  function renderCollection() {
    const selected = el('archiveSelect').value || (current?.canEdit ? current.id : '');
    const placeholder = make('option', words().choose); placeholder.value = '';
    el('archiveSelect').replaceChildren(placeholder, ...collection.map(item => {
      const option = make('option', item.title + ' · ' + words().progress(item.cursor, item.total));
      option.value = item.id; return option;
    }));
    el('archiveSelect').value = collection.some(item => item.id === selected) ? selected : '';
    el('archiveOpen').disabled = busy || !el('archiveSelect').value;
  }
  function updateCollection(record) {
    if (!record.canEdit) return;
    collection = [record, ...collection.filter(item => item.id !== record.id)];
    renderCollection();
  }
  function renderBookmarks() {
    const W = words();
    const rows = bookmarks.map(item => {
      const row = make('li', undefined, 'archive-moment');
      const jump = make('button', item.label || item.eventId, 'archive-jump');
      jump.type = 'button'; jump.title = W.openEvent(item.count);
      jump.addEventListener('click', () => { void onJump(item.count); });
      const meta = make('span', item.eventId + ' · ' + W.openEvent(item.count), 'note');
      const detail = make('details');
      const summary = make('summary', W.momentNote + (item.note ? ' · ' + item.note.slice(0, 60) : ''));
      const label = make('label', W.momentTitle);
      const title = make('input'); title.type = 'text'; title.maxLength = 100; title.value = item.label; title.disabled = !current?.canEdit;
      title.addEventListener('input', () => { item.label = title.value; jump.textContent = item.label || item.eventId; markDirty(true); });
      label.append(title);
      const noteLabel = make('label', W.momentNote);
      const note = make('textarea'); note.rows = 2; note.maxLength = 1000; note.value = item.note; note.disabled = !current?.canEdit;
      note.addEventListener('input', () => { item.note = note.value; summary.textContent = W.momentNote + (item.note ? ' · ' + item.note.slice(0, 60) : ''); markDirty(true); });
      noteLabel.append(note);
      detail.append(summary, label, noteLabel);
      const remove = make('button', W.deleteMoment); remove.type = 'button'; remove.disabled = !current?.canEdit;
      remove.addEventListener('click', () => { bookmarks = bookmarks.filter(value => value.eventId !== item.eventId); markDirty(true); renderBookmarks(); onReviewChanged(); });
      row.append(jump, meta, detail, remove);
      return row;
    });
    el('archiveBookmarks').replaceChildren(...(rows.length ? rows : [make('li', W.noBookmarks, 'note')]));
  }
  function render() {
    const state = snapshot(), W = words(), locale = state.view.locale;
    if (locale !== lastLocale) {
      lastLocale = locale;
      for (const element of document.querySelectorAll('[data-archive-i18n]')) {
        const value = W[element.dataset.archiveI18n]; if (typeof value === 'string') element.textContent = value;
      }
      renderCollection(); renderBookmarks();
    }
    el('archiveSave').textContent = !current ? W.save : current.canEdit && !conflict ? W.saveReview : W.saveCopy;
    el('archiveSave').disabled = busy || !!saving || !state.sessionId || !state.hasFrame;
    el('archiveExport').disabled = busy || !current;
    el('archiveImport').disabled = busy || !!saving;
    el('archiveOpen').disabled = busy || !!saving || !el('archiveSelect').value;
    el('archiveRemove').hidden = !current?.canEdit;
    el('archiveRemove').textContent = removing ? W.confirmRemove : W.remove;
    el('archiveRemove').disabled = busy || !!saving;
    el('archiveEditor').hidden = !current;
    el('archiveEmpty').hidden = !!current;
    el('archiveTitle').disabled = !current?.canEdit;
    el('archiveNotes').disabled = !current?.canEdit;
    el('archiveBookmarkCurrent').disabled = busy || !!saving || !state.cursor || !state.hasFrame;
    el('archiveMode').textContent = current && !current.canEdit ? W.shared : !persistentKey ? W.browserKey : W.autosave;
    if (failure) notify(failure);
    else if (conflict) notify(W.conflict);
    else if (saving || busy) notify(W.saving);
    else if (dirty()) notify(W.dirty);
    else if (current) notify(W.saved + ' · ' + W.count(bookmarks.length));
  }
  function load(record) {
    clearTimers(); generation++;
    current = record; bookmarks = structuredClone(record.review.bookmarks);
    version = 0; savedVersion = 0; editVersion = 0; savedEditVersion = 0; conflict = false; failure = ''; removing = false;
    el('archiveTitle').value = record.review.title;
    el('archiveNotes').value = record.review.notes;
    viewStamp = JSON.stringify({cursor: record.review.cursor, view: record.review.view,
      selectedMomentId: record.review.selectedMomentId, filters: record.review.filters});
    updateCollection(record); renderBookmarks(); render();
  }
  async function save({copy = false, keepalive = false} = {}) {
    clearTimers();
    if (saving) { const ok = await saving; if (!ok) return false; return save({copy, keepalive}); }
    const state = snapshot();
    if (!state.sessionId || !state.hasFrame) return false;
    if (current?.canEdit && !copy && !dirty()) return true;
    if (conflict && !copy) { render(); return false; }
    const own = current?.canEdit && !copy, prior = current;
    const sentVersion = version, sentEditVersion = editVersion, sentGeneration = generation, body = review();
    const operation = (async () => {
      try {
        const record = own
          ? await request('/api/archives/' + prior.id, 'PUT', {revision: prior.revision, review: body}, {keepalive})
          : await request('/api/archives', 'POST', {sessionId: state.sessionId, review: body}, {keepalive});
        if (sentGeneration !== generation) return true;
        current = record; savedVersion = sentVersion; savedEditVersion = sentEditVersion; conflict = false; failure = '';
        if (!prior) { bookmarks = structuredClone(record.review.bookmarks); el('archiveTitle').value = record.review.title; el('archiveNotes').value = record.review.notes; }
        onSaved(record.id); updateCollection(record);
        return true;
      } catch (error) {
        if (sentGeneration === generation) {
          if (error.status === 409 && own) conflict = true;
          failure = conflict ? words().conflict : error.message || words().saveError;
        }
        return false;
      }
    })();
    saving = operation; render();
    const ok = await operation;
    saving = null; render(); onReviewChanged();
    if (ok && dirty() && !keepalive) schedule();
    return ok;
  }
  async function beforeSwitch() {
    clearTimers();
    while (saving || current?.canEdit && dirty()) {
      if (!await save()) return false;
    }
    return true;
  }
  function reset() {
    clearTimers(); generation++;
    current = null; bookmarks = []; version = 0; savedVersion = 0; editVersion = 0; savedEditVersion = 0; conflict = false; failure = ''; removing = false; viewStamp = '';
    el('archiveTitle').value = ''; el('archiveNotes').value = '';
    renderBookmarks(); render(); notify(words().ready);
  }
  async function addBookmark(item) {
    const original = snapshot().sessionId;
    if (!current?.canEdit || conflict) { if (!await save({copy: !!current})) return; }
    if (snapshot().sessionId !== original) return;
    if (!bookmarks.some(value => value.eventId === item.eventId)) {
      if (bookmarks.length >= 64) { failure = '64 ' + words().moments; render(); return; }
      bookmarks.push({...item, label: item.label.slice(0, 100), note: ''});
      bookmarks.sort((a, b) => a.count - b.count);
      markDirty(true); renderBookmarks(); onReviewChanged(); await save();
    }
  }
  el('archiveSave').addEventListener('click', () => { void save({copy: !!current && (!current.canEdit || conflict)}); });
  for (const id of ['archiveTitle', 'archiveNotes']) el(id).addEventListener('input', () => markDirty(true));
  el('archiveSelect').addEventListener('change', render);
  el('archiveOpen').addEventListener('click', () => { if (el('archiveSelect').value) void onOpen(el('archiveSelect').value); });
  el('archiveBookmarkCurrent').addEventListener('click', () => {
    const state = snapshot();
    if (state.event) void addBookmark({eventId: state.event.id, count: state.cursor, label: state.event.id + ' · ' + state.eventLabel});
  });
  el('archiveRemove').addEventListener('click', async () => {
    if (!current?.canEdit) return;
    if (!removing) { removing = true; render(); return; }
    onPause();
    if (!await beforeSwitch()) return;
    busy = true; render();
    try {
      await request('/api/archives/' + current.id, 'DELETE', {revision: current.revision});
      collection = collection.filter(item => item.id !== current.id);
      onDeleted(); reset(); renderCollection(); notify(words().deleted);
    } catch (error) { failure = error.message; }
    finally { busy = false; render(); }
  });
  el('archiveExport').addEventListener('click', async () => {
    if (!current) return;
    const selectedReview = review(), selectedId = current.id;
    busy = true; render();
    try {
      const data = await request('/api/archives/' + selectedId + '/export');
      // A download also preserves local edits when another tab won a revision
      // race. It never overwrites that other tab's stored review.
      data.review = selectedReview;
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], {type: 'application/json'}));
      const anchor = make('a'); anchor.href = url; anchor.download = 'counterpress-match-' + selectedId + '.json';
      document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { failure = error.message; }
    finally { busy = false; render(); }
  });
  el('archiveImport').addEventListener('click', () => el('archiveFile').click());
  el('archiveFile').addEventListener('change', async () => {
    const file = el('archiveFile').files[0]; el('archiveFile').value = '';
    if (!file) return;
    if (file.size > 512 * 1024) { failure = words().fileError; render(); return; }
    onPause();
    if (!await beforeSwitch()) return;
    busy = true; render();
    try {
      let data; try { data = JSON.parse(await file.text()); } catch { throw new Error(words().fileError); }
      const record = await request('/api/archives/import', 'POST', data);
      updateCollection(record);
      await onOpen(record.id);
      notify(words().imported);
    } catch (error) { failure = error.message; }
    finally { busy = false; render(); }
  });
  addEventListener('beforeunload', event => {
    if (editVersion === savedEditVersion) return;
    event.preventDefault(); event.returnValue = '';
  });
  addEventListener('pagehide', () => { clearTimers(); if (current?.canEdit && dirty() && !saving) void save({keepalive: true}); });
  render(); notify(words().ready);
  return {
    load, reset, beforeSwitch,
    requestOpen: id => request('/api/archives/' + id + '/open', 'POST', {}),
    async refreshCollection() {
      try { const data = await request('/api/archives'); collection = data.archives; renderCollection(); }
      catch (error) { failure = error.message || words().loadError; render(); }
    },
    changed() {
      if (current?.canEdit && snapshot().hasFrame) { const next = stamp(); if (next !== viewStamp) { viewStamp = next; markDirty(); } }
      render();
    },
    momentButton(item) {
      const saved = bookmarks.some(value => value.eventId === item.eventId);
      const button = make('button', saved ? words().already : words().moment, 'review-jump');
      button.type = 'button'; button.disabled = saved || busy || !!saving;
      button.addEventListener('click', () => { void addBookmark(item); });
      return button;
    },
  };
}
