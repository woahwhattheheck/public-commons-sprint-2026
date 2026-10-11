// MIT. Local authoring UI over the original Python and release lifecycle.
import { createReleasePanel } from './release-panel.mjs';
import { createDraftStore } from './local-draft-store.mjs';
const $ = selector => document.querySelector(selector);
const enc = new TextEncoder();
const clone = value => structuredClone(value);
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else if (['value', 'checked', 'disabled', 'selected', 'readOnly'].includes(key)) node[key] = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child !== undefined && child !== null && child !== false)
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
const text = (tag, value, attrs = {}) => el(tag, attrs, value);
const row = (...children) => el('div', { class: 'button-row' }, children);
const card = (...children) => el('div', { class: 'card' }, children);
const empty = message => text('div', message, { class: 'empty' });
const badge = (value, strong = false) => text('span', value, { class: 'badge' + (strong ? ' strong' : '') });
const small = value => text('small', value);
const mono = value => text('code', value ?? '—');
const fmt = value => value === undefined || value === null ? '—' : String(value);
const short = value => value ? String(value).slice(0, 12) : '—';
const when = value => value ? new Date(value).toLocaleString() : '—';
const bytes = value => {
  if (!Number.isFinite(value)) return '—';
  if (value < 1024) return value + ' B';
  if (value < 1048576) return (value / 1024).toFixed(1) + ' KiB';
  return (value / 1048576).toFixed(2) + ' MiB';
};
const json = value => JSON.stringify(value, null, 2);
function field(label, control, hint, full = false) {
  const id = control.id || 'field-' + crypto.randomUUID();
  control.id = id;
  return el('div', { class: 'form-field' + (full ? ' full' : '') },
    text('label', label, { for: id }), control, hint ? small(hint) : null);
}
function input(value, attrs = {}) { return el('input', { type: 'text', value: value ?? '', ...attrs }); }
function area(value, attrs = {}) { return el('textarea', { class: 'code', value: value ?? '', spellcheck: 'false', ...attrs }); }
function select(options, value, attrs = {}) {
  return el('select', attrs, options.map(option => {
    const pair = Array.isArray(option) ? option : [option, option];
    return el('option', { value: pair[0], selected: pair[0] === value }, pair[1]);
  }));
}
function action(label, fn, { primary = false, disabled = false, quiet = false } = {}) {
  return el('button', { type: 'button', class: primary ? 'primary' : quiet ? 'quiet' : '',
    'data-mutation': 'true', disabled: disabled || busy, onclick: () => guarded(fn) }, label);
}
function button(label, fn, attrs = {}) {
  return el('button', { type: 'button', onclick: () => guarded(fn), ...attrs }, label);
}
function section(title, description, controls) {
  return el('div', { class: 'section-head' }, el('div', {}, text('h2', title), text('p', description)), controls);
}
function table(headers, rows) {
  return el('div', { class: 'table-wrap' }, el('table', {},
    el('thead', {}, el('tr', {}, headers.map(label => text('th', label, { scope: 'col' })))),
    el('tbody', {}, rows.map(cells => el('tr', {}, cells.map(cell => el('td', {}, cell)))))));
}
function details(title, value) {
  return el('details', {}, text('summary', title), el('div', { class: 'details-body' }, text('pre', typeof value === 'string' ? value : json(value))));
}
function definitions(values) {
  return el('dl', { class: 'definition' }, values.flatMap(([key, value]) => [text('dt', key), el('dd', {}, value)]));
}

const storageKey = 'python-merchant-workspace:' + location.origin;
const fragment = new URLSearchParams(location.hash.slice(1));
const bareToken = /^[0-9a-f]{64}$/.test(location.hash.slice(1)) ? location.hash.slice(1) : '';
const sessionToken = (() => { try { return sessionStorage.getItem(storageKey + ':token'); } catch { return ''; } })();
let token = fragment.get('token') || bareToken || sessionToken || '';
if (token) { try { sessionStorage.setItem(storageKey + ':token', token); } catch {} }
if (fragment.has('token') || bareToken) history.replaceState(null, '', location.pathname + location.search);
let state = null, draft = null, busy = false, tab = 'overview', sourcePath = null, functionName = null;
let historical = null, previewDetail = null, selectedRelease = null, compareResult = null, customerExport = null;
let editVersion = 0, previewTimer = null, noticeTimer = null, draftStorageFailure = false;
const fileCache = new Map();
let draftStore = null, pendingRecord = null, draftWrite = Promise.resolve();

function showNotice(message, issue = false) {
  clearTimeout(noticeTimer);
  $('#notice').replaceChildren(text('div', message));
  $('#notice').className = 'notice' + (issue ? ' issue' : '');
  $('#notice').hidden = false;
}
function clearNotice() { $('#notice').hidden = true; }
async function guarded(fn) {
  try { await fn(); } catch (error) { showNotice(error.message || String(error), true); }
}
async function api(path, body) {
  const options = { headers: { 'X-Python-Workspace-Token': token }, cache: 'no-store' };
  if (body !== undefined) {
    options.method = 'POST';
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  let response;
  try { response = await fetch(path, options); }
  catch (cause) {
    const error = new Error('The local server did not return a response. Your draft is preserved.');
    error.cause = cause; error.unknownOutcome = body !== undefined; throw error;
  }
  let value;
  try { value = await response.json(); }
  catch {
    const error = new Error('The local server response was incomplete or unreadable. Refresh the retained outcome before repeating this action.');
    error.unknownOutcome = body !== undefined;
    throw error;
  }
  if (!response.ok) {
    const detail = value.error;
    const message = value.message || (typeof detail === 'string' ? detail : detail?.message || detail?.code);
    const error = new Error(message || 'The server returned HTTP ' + response.status + '.');
    error.status = response.status; error.details = value; error.unknownOutcome = body !== undefined && response.status >= 500;
    throw error;
  }
  return value;
}
async function download(path, fallback) {
  const response = await fetch(path, { headers: { 'X-Python-Workspace-Token': token }, cache: 'no-store' });
  if (!response.ok) {
    let detail = {}; try { detail = await response.json(); } catch {}
    throw new Error(detail.message || detail.error?.message || detail.error || 'Download failed with HTTP ' + response.status + '.');
  }
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const match = /filename="([^"]+)"/.exec(disposition);
  saveBlob(blob, match?.[1] || fallback);
}
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename, hidden: true });
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function parseDeclaration(revision = draft) {
  try {
    const parsed = JSON.parse(revision.declarationText.replace(/^\uFEFF/, ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}
function dirty() {
  if (!draft || !state) return false;
  return draft.declarationText !== draft.base.declarationText || draft.entry !== draft.base.entry ||
    Object.keys(draft.changed).length > 0 || draft.removed.length > 0 || Boolean(draft.note.trim());
}
function persistDraft() {
  if (!draft || !state || !draftStore) return;
  draftWrite = draftStore.writeDraft({
    workspaceId: state.workspace.id, base: draft.base, declarationText: draft.declarationText,
    entry: draft.entry, changed: draft.changed, removed: draft.removed, note: draft.note,
    sourcePath, functionName, tab,
  }).then(() => {
    draftStorageFailure = false;
  }).catch(error => {
    if (!draftStorageFailure) showNotice(error.message + ' Current edits remain in memory and can be downloaded from History & handoff.', true);
    draftStorageFailure = true;
  });
}
function changed() { editVersion++; persistDraft(); updateToolbar(); }
function loadDraft(revision) {
  draft = { base: clone(revision), entry: revision.entry, declarationText: revision.declarationText,
    changed: {}, removed: [], note: '' };
  sourcePath = revision.files.some(file => file.path === sourcePath) ? sourcePath : revision.entry;
  const declaration = parseDeclaration();
  functionName = declaration?.functions?.[functionName] ? functionName : Object.keys(declaration?.functions || {})[0] || null;
  editVersion++; persistDraft(); updateToolbar();
}
function draftFiles() {
  if (!draft) return [];
  const files = new Map(draft.base.files.map(file => [file.path, clone(file)]));
  for (const [path, value] of Object.entries(draft.changed)) {
    files.set(path, { ...files.get(path), path, bytes: value.text !== undefined ? enc.encode(value.text).length : null,
      editable: value.text !== undefined && enc.encode(value.text).length <= 2097152, changed: true, ...value });
  }
  for (const path of draft.removed) files.delete(path);
  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
}
function updateToolbar() {
  if (!state) return;
  $('#workspace-name').textContent = state.workspace.label || state.workspace.id;
  $('#revision-label').textContent = 'Revision ' + short(state.workspace.head);
  const isDirty = dirty();
  const concurrent = draft && draft.base.id !== state.workspace.head;
  $('#save-state').textContent = busy ? 'Working with the retained application…' :
    concurrent ? 'A newer saved revision is available. Your draft remains based on ' + short(draft.base.id) + '.' :
    isDirty ? 'Unsaved local changes' : 'All current changes are saved';
  $('#save-draft').disabled = busy || !isDirty;
  $('#refresh-workspace').disabled = busy;
  $('#connection-state').textContent = 'Connected · ' + (state.workspace.label || 'Local workspace');
}
function setDeclarationText(value) {
  draft.declarationText = value;
  const path = draft.base.declarationSourcePath;
  if (path && !draft.removed.includes(path)) {
    if (value === draft.base.declarationText) delete draft.changed[path];
    else draft.changed[path] = { text: value };
  }
  changed();
}
function updateDeclaration(value) { setDeclarationText(json(value) + '\n'); }
function pending() {
  return pendingRecord?.workspaceId === state?.workspace?.id ? pendingRecord : null;
}
async function clearPending() {
  await draftStore.deletePending();
  pendingRecord = null;
}
function showPending() {
  const record = pending();
  if (!record || record.workspaceId !== state?.workspace?.id) { $('#recovery').hidden = true; return; }
  const controls = row(
    button('Refresh saved outcome', async () => { await refreshState(); showPending(); }),
    button('Download retained request', () => saveBlob(new Blob([json(record) + '\n'], { type: 'application/json' }), 'python-workspace-request.json')),
    button('Dismiss after review', async () => { await clearPending(); showPending(); })
  );
  if (record.path === '/api/preview') controls.prepend(button('Recover same preview', () => mutate(record.path, record.body, { recovered: true })));
  $('#recovery').replaceChildren(text('strong', 'A previous action needs its saved outcome checked.'),
    text('p', record.path + ' · ' + when(record.createdAt) + '. The exact submitted request is retained here.'),
    controls);
  $('#recovery').hidden = false;
}
async function mutate(path, body, { adopt = false, recovered = false } = {}) {
  if (busy) return;
  if (pending() && !recovered) throw new Error('Review the previous action in the recovery panel before submitting another mutation.');
  busy = true; updateToolbar();
  const version = editVersion;
  const editors = [...document.querySelectorAll('[data-editor]')].map(node => [node, node.disabled]);
  for (const [node] of editors) if (adopt) node.disabled = true;
  document.querySelectorAll('[data-mutation]').forEach(node => { node.disabled = true; });
  const record = { workspaceId: state.workspace.id, path, body: clone(body), createdAt: new Date().toISOString() };
  try { await draftStore.writePending(record); pendingRecord = record; }
  catch (error) { busy = false; for (const [node, disabled] of editors) node.disabled = disabled; updateToolbar(); renderCurrent(); throw error; }
  let acknowledged = false;
  try {
    const result = await api(path, body);
    acknowledged = true;
    await refreshState({ adopt: adopt && editVersion === version });
    await clearPending();
    showPending();
    return result;
  } catch (error) {
    if (!error.unknownOutcome && !acknowledged) await clearPending();
    if (acknowledged) error.message = 'The action returned successfully, but its refreshed state could not be retained. ' + error.message;
    if (error.status === 409) {
      try { await refreshState(); } catch {}
      showNotice(error.message + ' Your local draft has been retained.', true);
    }
    showPending(); throw error;
  } finally {
    busy = false;
    for (const [node, disabled] of editors) if (node.isConnected) node.disabled = disabled;
    updateToolbar(); renderCurrent();
  }
}
async function refreshState({ adopt = false } = {}) {
  const wasClean = !dirty();
  const next = await api('/api/state');
  state = next;
  if (!draft || adopt || wasClean && draft.base.id !== state.workspace.head) loadDraft(state.revision);
  updateToolbar(); renderCurrent(); schedulePreviews(); showPending();
}
async function confirmDiscard() {
  if (!dirty()) return true;
  const dialog = $('#discard-dialog');
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'discard'), { once: true });
    dialog.showModal();
  });
}
async function saveDraft() {
  if (!dirty()) return;
  const files = Object.entries(draft.changed).map(([path, value]) => ({ path, ...value }));
  await mutate('/api/revisions', { expectedHead: draft.base.id, baseRevision: draft.base.id,
    entry: draft.entry, declarationText: draft.declarationText, note: draft.note,
    files, remove: draft.removed }, { adopt: true });
  historical = null; showNotice('Application revision saved with its original declaration and retained source files.');
}
async function openFile(path, revisionId = draft.base.id) {
  const key = revisionId + ':' + path;
  if (!fileCache.has(key)) fileCache.set(key, await api('/api/file?revision=' + encodeURIComponent(revisionId) + '&path=' + encodeURIComponent(path)));
  return fileCache.get(key);
}
function switchTab(name) {
  tab = name;
  for (const node of document.querySelectorAll('[data-tab]')) {
    if (node.dataset.tab === name) node.setAttribute('aria-current', 'page');
    else node.removeAttribute('aria-current');
  }
  for (const panel of document.querySelectorAll('.panel')) panel.hidden = panel.id !== 'panel-' + name;
  persistDraft(); renderCurrent();
}
function renderCurrent() {
  if (!state || !draft) return;
  const panel = $('#panel-' + tab);
  const renderers = { overview: renderOverview, source: renderSource, functions: renderFunctions,
    preview: renderPreviews, releases: renderReleases, history: renderHistory };
  panel.replaceChildren(renderers[tab]());
  updateToolbar();
}
function overviewMetric(label, value, detail) {
  return el('div', { class: 'metric' }, text('span', label, { class: 'label' }),
    text('span', value, { class: 'value' }), text('span', detail, { class: 'detail' }));
}
function renderSource() {
  const files = draftFiles();
  const selected = files.find(file => file.path === sourcePath) || files[0];
  if (selected) sourcePath = selected.path;
  const list = el('ul', { class: 'file-list' }, files.map(file => el('li', {},
    button(file.path, async () => {
      sourcePath = file.path;
      if (!draft.changed[sourcePath]) await openFile(sourcePath);
      persistDraft(); renderCurrent();
    }, { 'aria-current': file.path === sourcePath ? 'true' : 'false' }),
    small(bytes(file.bytes) + (file.changed ? ' · edited locally' : ' · ' + short(file.sha256))))));
  const newName = input('', { placeholder: 'helpers/report.py', 'data-editor': 'true' });
  const addFile = () => {
    const name = newName.value.trim();
    if (!name || files.some(file => file.path === name)) throw new Error('Choose a new source filename.');
    draft.changed[name] = { text: '' }; draft.removed = draft.removed.filter(path => path !== name);
    if (name === draft.base.declarationSourcePath) draft.declarationText = '';
    sourcePath = name; changed(); renderCurrent();
  };
  const chooseEntry = select(files.filter(file => file.path.endsWith('.py')).map(file => file.path),
    draft.entry, { 'data-editor': 'true', onchange: event => { draft.entry = event.target.value; changed(); } });
  const sidebar = card(text('h3', 'Retained source files'), files.length ? list : empty('No retained files.'),
    el('hr', { class: 'rule' }), field('Entry module', chooseEntry, 'The saved runnable declaration uses this retained Python module.'),
    el('hr', { class: 'rule' }), field('New text file', newName, 'Use a relative path inside this application.'),
    button('Add text file', addFile));
  const editor = card();
  if (!selected) editor.append(empty('Add a text file or recapture the original source.'));
  else {
    const change = draft.changed[selected.path];
    const original = fileCache.get(draft.base.id + ':' + selected.path);
    const known = change || original;
    editor.append(el('div', { class: 'card-head' },
      el('div', {}, text('h3', selected.path), small(selected.changed ? 'Local draft' : 'Saved source · ' + short(selected.sha256))),
      row(button('Download file', async () => {
        const value = draft.changed[selected.path] || await openFile(selected.path);
        const content = value.text !== null && value.text !== undefined ? value.text : Uint8Array.from(atob(value.base64), ch => ch.charCodeAt(0));
        saveBlob(new Blob([content], { type: 'application/octet-stream' }), selected.path.split('/').pop());
      }), button('Remove from draft', () => {
        const path = selected.path;
        delete draft.changed[path];
        if (draft.base.files.some(file => file.path === path)) draft.removed.push(path);
        sourcePath = null; changed(); renderCurrent();
      }))));
    if (!known) {
      editor.append(empty('Opening the exact retained source…'));
      openFile(selected.path).then(() => {
        if (tab === 'source' && sourcePath === selected.path) renderCurrent();
      }).catch(error => showNotice(error.message, true));
    } else if (known.text !== null && known.text !== undefined && (known.editable ?? selected.editable) !== false) {
      const code = area(known.text, { class: 'code application-code', 'aria-label': 'Source for ' + selected.path,
        'data-editor': 'true', oninput: event => {
          const value = event.target.value;
          const base = fileCache.get(draft.base.id + ':' + selected.path);
          if (base && value === base.text) delete draft.changed[selected.path];
          else draft.changed[selected.path] = { text: value };
          if (selected.path === draft.base.declarationSourcePath) draft.declarationText = value;
          changed();
        } });
      editor.append(code, small('Saved revisions retain the original bytes. Edits are executed only by an explicit preview or merchant run.'));
      if (change && draft.base.files.some(file => file.path === selected.path))
        editor.append(row(button('Revert this local file', () => {
          delete draft.changed[selected.path];
          if (selected.path === draft.base.declarationSourcePath) draft.declarationText = draft.base.declarationText;
          changed(); renderCurrent();
        })));
    } else editor.append(empty('This retained resource is read-only in the editor. Its original bytes remain in the application and can be downloaded.'));
  }
  return el('div', {},
    section('Application source', 'Edit the retained application and helper files. Saving creates a new immutable working revision.',
      action('Recapture original files', async () => {
        if (!await confirmDiscard()) return;
        await mutate('/api/refresh-source', { expectedHead: state.workspace.head, note: 'Recaptured original local files' }, { adopt: true });
        showNotice('Original files recaptured as a new saved revision.');
      })),
    el('div', { class: 'grid aside-main' }, sidebar, editor),
    card(field('Revision note', input(draft.note, { 'data-editor': 'true', placeholder: 'Describe the change',
      oninput: event => { draft.note = event.target.value; changed(); } }),
      'This note will accompany the next saved application revision.', true)));
}


function declarationWithFunction(base, name, functionText) {
  return '{\n' + Object.entries(base).map(([key, value]) => {
    if (key !== 'functions') return JSON.stringify(key) + ': ' + json(value);
    return '"functions": {\n' + Object.entries(value).map(([id, fn]) =>
      JSON.stringify(id) + ': ' + (id === name ? functionText : json(fn))).join(',\n') + '\n}';
  }).join(',\n') + '\n}\n';
}
function syncDeclarationEditor() {
  const editor = $('#full-declaration');
  if (editor && document.activeElement !== editor) editor.value = draft.declarationText;
}
function renderFunctions() {
  const declaration = parseDeclaration();
  const raw = area(draft.declarationText, { id: 'full-declaration', class: 'code declaration-code',
    'data-editor': 'true', 'aria-label': 'Complete merchant declaration',
    oninput: event => setDeclarationText(event.target.value) });
  const rawCard = card(text('h3', 'Complete merchant declaration'), raw,
    small('This is the retained declaration. Saving also preserves intermediate JSON that still needs correction. Preview and release use the original compiler.'),
    row(button('Refresh structured view', () => renderCurrent())));
  if (!declaration) return el('div', {},
    section('Functions & terms', 'Correct the complete JSON declaration to reopen its structured settings.'),
    rawCard);
  const setProperty = (key, value) => {
    const current = parseDeclaration();
    if (!current) throw new Error('Correct the complete declaration JSON before editing structured settings.');
    current[key] = value; updateDeclaration(current); syncDeclarationEditor();
  };
  const settings = el('div', { class: 'form-grid' },
    field('Service name', input(declaration.serviceName, { 'data-editor': 'true',
      onchange: event => guarded(() => setProperty('serviceName', event.target.value)) })),
    field('Public origin', input(declaration.publicOrigin, { 'data-editor': 'true',
      onchange: event => guarded(() => setProperty('publicOrigin', event.target.value)) }),
      'The public HTTPS origin retained in the merchant declaration.'),
    field('Python executable', input(declaration.python || 'python3', { 'data-editor': 'true',
      onchange: event => guarded(() => setProperty('python', event.target.value)) }),
      'Use the executable available to the operator environment.'),
    field('Worker processes', input(declaration.workerCount ?? 1, { type: 'number', min: 1, max: 8,
      'data-editor': 'true', onchange: event => guarded(() => setProperty('workerCount', Number(event.target.value))) }),
      'The existing persistent worker pool supports 1–8 processes.'),
    field('Pending capacity', input(declaration.maxPending ?? 32, { type: 'number', min: 1, max: 256,
      'data-editor': 'true', onchange: event => guarded(() => setProperty('maxPending', Number(event.target.value))) })),
    field('Environment names', input(Array.isArray(declaration.environment) ? declaration.environment.join(', ') : '', { 'data-editor': 'true',
      onchange: event => guarded(() => setProperty('environment', event.target.value.split(',').map(value => value.trim()).filter(Boolean))) }),
      'Names only. Values stay in the operator environment.'));
  const nativeFunctions = declaration.functions && typeof declaration.functions === 'object' && !Array.isArray(declaration.functions) ?
    declaration.functions : {};
  const names = Object.keys(nativeFunctions);
  if (!names.includes(functionName)) functionName = names[0] || null;
  const choose = select(names, functionName, { 'aria-label': 'Public function', onchange: event => {
    functionName = event.target.value; persistDraft(); renderCurrent();
  } });
  const newName = input('', { placeholder: 'summarize', 'aria-label': 'New function name', 'data-editor': 'true' });
  const add = () => {
    const name = newName.value.trim();
    const current = parseDeclaration();
    if (!current) throw new Error('Correct the complete declaration JSON before adding a function.');
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || current.functions?.[name])
      throw new Error('Choose an unused function name beginning with a letter and using letters, numbers or underscores.');
    current.functions ||= {};
    const example = Object.values(current.functions)[0];
    current.functions[name] = { method: 'POST', path: '/' + name,
      description: 'Describe the result returned by this function.',
      ...(example?.payment ? { payment: clone(example.payment) } : {}),
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }, example: {},
      output: { format: 'json' } };
    functionName = name; updateDeclaration(current); renderCurrent();
  };
  const functionsCard = card(el('div', { class: 'card-head' }, text('h3', 'Public function'),
    names.length ? choose : null), row(newName, button('Add function', add)));
  if (functionName) {
    const functionBase = clone(declaration);
    functionsCard.append(field('Native function declaration',
      area(json(nativeFunctions[functionName]), { class: 'code function-code',
        'aria-label': 'Declaration for ' + functionName, 'data-editor': 'true',
        oninput: event => {
          const current = parseDeclaration() || clone(functionBase);
          setDeclarationText(declarationWithFunction(current, functionName, event.target.value));
          syncDeclarationEditor();
        } }),
      'Edit the method, route, input schema, example, payment, limits and output using the original function declaration.', true),
      row(button('Remove function', () => {
        const current = parseDeclaration();
        if (!current) throw new Error('Correct the declaration JSON before removing a function.');
        delete current.functions[functionName]; functionName = null; updateDeclaration(current); renderCurrent();
      }), button('Open source', () => switchTab('source'))));
  } else functionsCard.append(empty('Add a function, then complete its payment and input declaration.'));
  return el('div', {}, section('Functions & terms', 'Keep the public API, its input contract and its payment terms with the saved application.'),
    card(text('h3', 'Merchant settings'), settings), functionsCard, rawCard);
}


let previewRevision = null, previewFunction = null;
const previewInputs = new Map();
const runningPreview = item => ['QUEUED', 'RUNNING'].includes(item.status);
function previewKey(revision, name) { return revision.id + ':' + name; }
function renderPreviewDetail() {
  if (!previewDetail) return empty('Open a retained preview to inspect its input, returned bytes and worker outcome.');
  const value = previewDetail;
  return el('div', {},
    el('div', { class: 'card-head' }, text('h3', 'Selected preview'), badge(value.status, value.status === 'COMPLETED')),
    definitions([['Function', mono(value.function)], ['Source revision', mono(value.revisionId)],
      ['Operation', mono(value.operationId)], ['Started', when(value.startedAt)],
      ['Ended', when(value.endedAt)], ['Returned bytes', bytes(value.result?.bytes)]]),
    details('Submitted input', value.input),
    value.error ? el('div', { class: 'inline-note' }, text('strong', value.error.code), text('p', value.error.message)) : null,
    value.result ? el('div', {}, text('h4', 'Original returned output'),
      value.result.text !== null && value.result.text !== undefined ?
        text('pre', value.result.text, { class: 'result-output', tabindex: '0' }) :
        empty('Binary output is retained unchanged. Download it to open in its native application.'),
      definitions([['Content type', mono(value.result.contentType)], ['SHA-256', mono(value.result.sha256)]]),
      row(button('Download exact output', () => download('/api/preview-output?id=' + encodeURIComponent(value.id), value.id + '.bin')))) : null,
    value.pool ? details('Original worker pool outcome', value.pool) : null,
    value.shutdown ? details('Original shutdown outcome', value.shutdown) : null);
}
function renderPreviewJobs() {
  const jobs = [...state.previews].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return jobs.length ? table(['Function', 'Revision', 'Status', 'Created', 'Output', 'Actions'], jobs.map(job => [
    mono(job.function), mono(short(job.revisionId)), badge(job.status, job.status === 'COMPLETED'),
    when(job.createdAt), job.result ? bytes(job.result.bytes) : job.error?.code || '—',
    row(button('Open', async () => {
      previewDetail = await api('/api/preview?id=' + encodeURIComponent(job.id)); renderCurrent();
    }), runningPreview(job) ? action(job.cancelRequestedAt ? 'Cancelling…' : 'Cancel preview', async () => {
      previewDetail = await mutate('/api/preview/cancel', { id: job.id });
      renderCurrent();
    }, { disabled: Boolean(job.cancelRequestedAt) }) : null)
  ])) : empty('No private previews have been requested.');
}
function renderPreviews() {
  const revision = previewRevision || state.revision;
  const declaration = parseDeclaration(revision) || {};
  const functions = declaration.functions || {};
  const names = Object.keys(functions);
  if (!names.includes(previewFunction)) previewFunction = names[0] || null;
  const key = previewKey(revision, previewFunction);
  if (!previewInputs.has(key)) previewInputs.set(key, json(functions[previewFunction]?.example || {}));
  const revisionOptions = [...state.revisions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(value => [value.id, short(value.id) + (value.id === state.workspace.head ? ' · current saved' : '') + ' · ' + (value.note || when(value.createdAt))]);
  const chooseRevision = select(revisionOptions, revision.id, { id: 'preview-revision', onchange: event => guarded(async () => {
    const id = event.target.value;
    previewRevision = id === state.workspace.head ? null : await api('/api/revision?id=' + encodeURIComponent(id));
    previewFunction = null; renderCurrent();
  }) });
  const chooseFunction = select(names, previewFunction, { id: 'preview-function', onchange: event => {
    previewFunction = event.target.value; renderCurrent();
  } });
  const previewInput = area(previewInputs.get(key), { id: 'preview-input', class: 'code preview-input',
    'aria-label': 'Private preview JSON input', oninput: event => previewInputs.set(key, event.target.value) });
  const run = async () => {
    let value;
    try { value = JSON.parse(previewInputs.get(key)); } catch { throw new Error('Private preview input must be valid JSON.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Private preview input must be a JSON object.');
    const result = await mutate('/api/preview', { revisionId: revision.id, function: previewFunction,
      input: value, operationId: crypto.randomUUID() });
    if (result) previewDetail = await api('/api/preview?id=' + encodeURIComponent(result.id));
    renderCurrent();
  };
  return el('div', {},
    section('Private previews', 'Execute a selected saved function with explicit input. Each operation retains its exact source revision and result.'),
    card(text('h3', 'Request a preview'),
      el('div', { class: 'form-grid' }, field('Saved source revision', chooseRevision),
        field('Public function', chooseFunction)),
      !revision.validation.ok ? el('div', { class: 'inline-note' }, revision.validation.error?.message || 'Correct this saved declaration before execution.') : null,
      field('JSON input', previewInput, 'The original function schema and byte limits apply.', true),
      row(action('Run saved function privately', run, { primary: true, disabled: !previewFunction || !revision.validation.ok }),
        button('Use declared example', () => { previewInputs.set(key, json(functions[previewFunction]?.example || {})); renderCurrent(); })),
      small('This executes the saved Python application on the local operator machine. Unsaved editor changes are excluded from this request.')),
    card(text('h3', 'Retained preview operations'), el('div', { id: 'preview-jobs' }, renderPreviewJobs())),
    el('div', { class: 'card', id: 'preview-detail' }, renderPreviewDetail()));
}
function schedulePreviews() {
  clearTimeout(previewTimer);
  if (!state?.previews?.some(runningPreview)) return;
  previewTimer = setTimeout(async () => {
    if (busy) { schedulePreviews(); return; }
    try {
      state = await api('/api/state'); updateToolbar();
      if (previewDetail) {
        const current = state.previews.find(item => item.id === previewDetail.id);
        if (current && (current.status !== previewDetail.status || current.endedAt !== previewDetail.endedAt))
          previewDetail = await api('/api/preview?id=' + encodeURIComponent(current.id));
      }
      if (tab === 'preview') {
        $('#preview-jobs')?.replaceChildren(renderPreviewJobs());
        $('#preview-detail')?.replaceChildren(renderPreviewDetail());
      } else if (tab === 'overview') renderCurrent();
      schedulePreviews();
    } catch (error) { showNotice(error.message + ' Use Refresh to read the retained outcome.', true); }
  }, 1000);
}

let historicalPath = null, releasePanel = null;
function renderReleases() {
  releasePanel ||= createReleasePanel({
    getState: () => state,
    el, text, row, card, empty, badge, small, mono, fmt, short, when, bytes, json,
    field, input, area, select, action, button, section, table, details, definitions,
    api, mutate, download, showNotice, refreshState, renderCurrent,
  });
  return releasePanel.render();
}
function renderHistory() {
  const revisions = [...state.revisions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const list = card(text('h3', 'Saved application revisions'),
    table(['Revision', 'Saved at', 'Note', 'Source', 'Actions'], revisions.map(revision => [
      row(mono(short(revision.id)), revision.id === state.workspace.head ? badge('Current') : null),
      when(revision.createdAt), revision.note || '—',
      revision.files + ' files · ' + bytes(revision.bytes),
      button('Inspect revision', async () => {
        historical = await api('/api/revision?id=' + encodeURIComponent(revision.id));
        historicalPath = historical.entry; renderCurrent();
      })
    ])));
  const inspection = card();
  if (historical) {
    const value = historical;
    const path = historicalPath && value.files.some(file => file.path === historicalPath) ? historicalPath : value.entry;
    historicalPath = path;
    const note = input('Restored revision ' + short(value.id), { 'aria-label': 'Restoration note' });
    inspection.append(el('div', { class: 'card-head' }, text('h3', 'Retained revision ' + short(value.id)),
      badge(value.validation.ok ? 'Valid declaration' : 'Declaration needs correction', value.validation.ok)),
      definitions([['Entry module', mono(value.entry)], ['Saved at', when(value.createdAt)],
        ['Parent revision', mono(value.parent)], ['Note', value.note || '—']]),
      row(note, action('Restore as a new revision', async () => {
        if (!await confirmDiscard()) return;
        await mutate('/api/restore', { expectedHead: state.workspace.head, revisionId: value.id,
          note: note.value.trim() || 'Restored revision ' + short(value.id) }, { adopt: true });
        historical = null; showNotice('The selected application was restored as a new saved revision.'); renderCurrent();
      })),
      details('Retained declaration', value.declarationText),
      text('h4', 'Original source files'),
      table(['File', 'Size', 'SHA-256', 'Action'], value.files.map(file => [
        mono(file.path), bytes(file.bytes), mono(short(file.sha256)),
        button('View source', async () => { historicalPath = file.path; await openFile(file.path, value.id); renderCurrent(); })
      ])));
    if (path) {
      const retained = fileCache.get(value.id + ':' + path);
      inspection.append(text('h4', path));
      if (!retained) {
        inspection.append(empty('Opening the selected retained source…'));
        openFile(path, value.id).then(() => {
          if (tab === 'history' && historical?.id === value.id && historicalPath === path) renderCurrent();
        }).catch(error => showNotice(error.message, true));
      } else {
        inspection.append(retained.text !== null ?
          area(retained.text, { class: 'code history-code', readOnly: true, 'aria-label': 'Historical source for ' + path }) :
          empty('This source member is binary. Its exact bytes are available to download.'),
          row(button('Download retained file', () => {
            const content = retained.text !== null ? retained.text : Uint8Array.from(atob(retained.base64), char => char.charCodeAt(0));
            saveBlob(new Blob([content], { type: 'application/octet-stream' }), path.split('/').pop());
          })));
      }
    }
  } else inspection.append(text('h3', 'Inspect an earlier revision'), empty('Select a saved revision to open its declaration and original files, or restore it as a new working revision.'));
  return el('div', {},
    section('History & handoff', 'Reopen prior application sources and preserve the complete local workspace for another operator.'),
    card(text('h3', 'Complete workspace handoff'),
      text('p', 'Download saved source revisions, retained previews and original output bytes, staged release history and customer client exports together.'),
      row(button('Download complete workspace', () => download('/api/export', 'python-workspace.json'), { class: 'primary' }),
        button('Download current local draft', () => saveBlob(new Blob([json({ schema: 'stellar-forge.python-workspace-local-draft.v1',
          workspaceId: state.workspace.id, exportedAt: new Date().toISOString(), ...draft }) + '\n'],
          { type: 'application/json' }), 'python-workspace-local-draft.json'))),
      small('The complete handoff contains saved work. Save local edits first to include them in its application history.'),
      details('Reopen the handoff from the original CLI',
        'node ./stellar/scf-starforge-20261009/sf30-seller-sdk/python/workspace/cli.mjs import --workspace ./restored-workspace --bundle ./python-workspace.json\n' +
        'node ./stellar/scf-starforge-20261009/sf30-seller-sdk/python/workspace/cli.mjs serve --workspace ./restored-workspace --port 0\n\n' +
        'Import creates a new directory. It retains the original release selection in the stopped state. The local Python interpreter and environment values remain operator supplied.'),
      state.workspace.origin ? details('Original selected source', state.workspace.origin) : null),
    list, inspection);
}
async function boot() {
  $('#refresh-workspace').addEventListener('click', () => guarded(async () => {
    await refreshState(); showNotice('Saved workspace state refreshed. Local edits remain available.');
  }));
  $('#save-draft').addEventListener('click', () => guarded(saveDraft));
  for (const node of document.querySelectorAll('[data-tab]')) node.addEventListener('click', () => guarded(() => switchTab(node.dataset.tab)));
  window.addEventListener('beforeunload', event => {
    if (dirty() || pending()) { event.preventDefault(); event.returnValue = ''; }
  });
  try {
    state = await api('/api/state');
    draftStore = createDraftStore(state.workspace.id);
    let saved = null;
    try { [saved, pendingRecord] = await Promise.all([draftStore.readDraft(), draftStore.readPending()]); }
    catch (error) { showNotice(error.message, true); }
    const knownBase = saved?.workspaceId === state.workspace.id && saved?.base?.id &&
      state.revisions.some(revision => revision.id === saved.base.id) &&
      typeof saved.declarationText === 'string' && typeof saved.entry === 'string' &&
      saved.changed && typeof saved.changed === 'object' && Array.isArray(saved.removed);
    if (knownBase) {
      draft = { base: saved.base, entry: saved.entry, declarationText: saved.declarationText,
        changed: saved.changed, removed: saved.removed, note: typeof saved.note === 'string' ? saved.note : '' };
      sourcePath = saved.sourcePath || draft.entry; functionName = saved.functionName || null;
      tab = ['overview', 'source', 'functions', 'preview', 'releases', 'history'].includes(saved.tab) ? saved.tab : 'overview';
      editVersion++;
      if (dirty()) showNotice('Your local editing draft has been restored.');
    } else loadDraft(state.revision);
    if (!dirty() && draft.base.id !== state.workspace.head) loadDraft(state.revision);
    switchTab(tab); schedulePreviews(); showPending();
  } catch (error) {
    $('#connection-state').textContent = 'Connection unavailable';
    showNotice(error.message + ' Open the operator URL printed by the original workspace CLI.', true);
  }
}
boot();

function renderOverview() {
  const revision = state.revision;
  const declaration = parseDeclaration(revision) || {};
  const functions = Object.entries(declaration.functions || {});
  const completed = state.previews.filter(item => item.status === 'COMPLETED').length;
  return el('div', {},
    section('Application overview', 'Author locally, retain source revisions, and operate the original Python merchant release.'),
    el('div', { class: 'metrics' },
      overviewMetric('Source files', revision.files.length, 'Original and edited files retained'),
      overviewMetric('Public functions', functions.length, 'Declared routes and payment terms'),
      overviewMetric('Completed previews', completed, 'Explicit private application calls'),
      overviewMetric('Staged versions', state.staged.length, 'Original merchant releases')),
    el('div', { class: 'grid main-aside' },
      card(text('h3', 'Current saved application'), definitions([
        ['Name', declaration.serviceName || state.workspace.label],
        ['Saved revision', mono(revision.id)], ['Entry module', mono(revision.entry)],
        ['Saved at', when(revision.createdAt)], ['Public origin', mono(declaration.publicOrigin)],
        ['Declaration', badge(revision.validation.ok ? 'Valid' : 'Needs correction', revision.validation.ok)],
        ['Worker processes', fmt(revision.validation.options?.workerCount)],
        ['Pending capacity', fmt(revision.validation.options?.maxPending)],
      ]), revision.validation.error ? el('div', { class: 'inline-note' }, fmt(revision.validation.error.message || revision.validation.error)) : null,
      el('hr', { class: 'rule' }), row(button('Edit application', () => switchTab('source')),
        button('Review functions', () => switchTab('functions')), button('Try saved function', () => switchTab('preview')))),
      card(text('h3', 'Working sequence'),
        text('p', '1. Edit the retained application and its declaration. Save intermediate work whenever useful.'),
        text('p', '2. Run a saved function privately and inspect the exact returned bytes and worker outcome.'),
        text('p', '3. Stage a saved revision, compare versions, then activate and run through the existing release lifecycle.'),
        text('p', '4. Export the customer client or complete workspace, and reopen the retained version.'),
        small('Private previews execute the selected Python code. Public customer requests follow the configured seller payment mode.'))),
    el('div', { class: 'card' }, text('h3', 'Saved public functions'),
      functions.length ? table(['Function', 'Method and path', 'Output', 'Atomic payment amount'], functions.map(([name, value]) => [
        button(name, () => { functionName = name; switchTab('functions'); }, { class: 'link-button' }),
        mono((value?.method || '—') + ' ' + (value?.path || '—')), value?.output?.format || 'json',
        typeof value?.payment?.amount === 'string' ? mono(value.payment.amount) : 'Review declared choices'
      ])) : empty('The saved declaration has no readable function list. Open Functions & terms to correct it.')));
}

