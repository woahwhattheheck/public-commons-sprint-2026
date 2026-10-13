/** Find current original destinations without loading their scientific records. */
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase().trim();
const itemID = /^[0-9a-f]{64}$/;
const deskID = /^[a-z][a-z0-9-]*$/;
const pageSize = 25;
const recentLimit = 12;
const kinds = Object.freeze({
  sources: 'Source editions', profiles: 'Parameter profiles', scenarios: 'Land-cover scenarios',
  grids: 'Model grids', runs: 'Native model runs', observations: 'Observed water quality',
  comparisons: 'Run comparisons', observation_comparisons: 'Observation comparisons',
  deliveries: 'Deliveries', spatial_reviews: 'Spatial reviews', spatial_exports: 'Spatial exports',
  community_tables: 'Community tables', community_plans: 'Community plans',
  community_reports: 'Community reports', planning_inventories: 'Planning inventories',
  portfolios: 'Conservation portfolios', portfolio_reports: 'Portfolio reports',
  'parameter-studies': 'Parameter studies'
});
const scalar = value => ['string', 'number', 'boolean'].includes(typeof value) ? String(value) : '';
const titleOf = row => [row.title, row.name, row.metadata?.title, row.spec?.title,
  row.selection?.title, row.scope?.title].map(scalar).find(Boolean);
const references = row => {
  const values = [];
  for (const record of [row, row.metadata, row.spec, row.selection, row.payload]) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
    for (const name of ['title', 'name', 'kind', 'action', 'grid_id', 'profile_id', 'scenario_id',
      'run_id', 'baseline_run_id', 'source_collection_id', 'observation_id', 'station_id', 'programme_id']) {
      if (scalar(record[name])) values.push(scalar(record[name]));
    }
  }
  return values;
};

/** Index only known original item routes, actual desks and this workspace's tasks. */
export function buildWorkspaceFinderIndex(snapshot, desks, taskLabel = value => value) {
  const workspace = snapshot?.workspace_key;
  if (!workspace || !snapshot.data) return [];
  const entries = new Map(), titles = new Map();
  for (const kind of Object.keys(kinds)) {
    for (const row of Array.isArray(snapshot.data[kind]) ? snapshot.data[kind] : []) {
      if (row && itemID.test(row.id || '')) titles.set(row.id, titleOf(row) || kinds[kind] + ' · ' + row.id.slice(0, 12));
    }
  }
  for (const run of Array.isArray(snapshot.data.runs) ? snapshot.data.runs : []) {
    if (!run || !itemID.test(run.id || '') || titleOf(run)) continue;
    const selected = run.selection || {};
    const names = selected.models === undefined ? ['ndr', 'sdr'] : selected.models;
    const models = Array.isArray(names) ? names.filter(name => ['ndr', 'sdr'].includes(name)).map(name => name.toUpperCase()).join(' + ') : '';
    titles.set(run.id, [titles.get(selected.scenario_id), titles.get(selected.profile_id), models].filter(Boolean).join(' · ') ||
      'Native model run · ' + run.id.slice(0, 12));
  }
  const linkedReferences = record => {
    const original = references(record);
    for (const container of [record, record.selection, record.payload]) {
      if (!container || typeof container !== 'object') continue;
      for (const name of ['scenario_run_ids']) {
        if (Array.isArray(container[name])) original.push(...container[name].filter(id => typeof id === 'string'));
      }
    }
    if (Array.isArray(record.alternatives)) {
      original.push(...record.alternatives.map(row => scalar(row?.run_id)).filter(Boolean));
    }
    return [...original, ...original.map(value => titles.get(value)).filter(Boolean)];
  };
  const add = row => {
    row.search = normalize([row.id, row.title, row.label, row.state, ...row.references].join(' '));
    row.normalTitle = normalize(row.title);
    entries.set(row.key, row);
  };
  for (const desk of Array.isArray(desks) ? desks : []) {
    if (!deskID.test(desk?.id || '') || typeof desk.title !== 'string') continue;
    add({key: 'desk:' + desk.id, type: 'desk', id: desk.id, title: desk.title,
      label: 'Workspace desk', state: '', date: '', references: [], destination: {view: desk.id}});
  }
  for (const [kind, label] of Object.entries(kinds)) {
    const records = snapshot.data[kind];
    if (!Array.isArray(records)) continue;
    for (const record of records) {
      if (!record || !itemID.test(record.id || '')) continue;
      add({key: 'item:' + kind + ':' + record.id, type: kind, id: record.id,
        title: titleOf(record) || (kind === 'runs' ? titles.get(record.id) :
          record.baseline_run_id ? label + ' · ' + (titles.get(record.baseline_run_id) || record.baseline_run_id.slice(0, 12)) :
          label + ' · ' + record.id.slice(0, 12)), label,
        state: scalar(record.state), date: scalar(record.updated_at || record.created_at || record.captured_at),
        references: linkedReferences(record), destination: {kind, id: record.id}});
    }
  }
  for (const task of Array.isArray(snapshot.tasks) ? snapshot.tasks : []) {
    if (!task || !itemID.test(task.id || '') || task.workspace !== workspace) continue;
    add({key: 'task:' + task.id, type: 'task', id: task.id,
      title: scalar(taskLabel(task.action)) || scalar(task.action) || 'Retained operation',
      label: 'Operation', state: scalar(task.state),
      date: scalar(task.updated_at || task.ended_at || task.started_at || task.created_at),
      references: [scalar(task.operation_id), ...linkedReferences(task)], destination: {task: task.id}});
  }
  return [...entries.values()];
}

/** Prefer exact original identity, then title and metadata matches. */
export function searchWorkspaceFinder(index, {query = '', type = '', state = '', recent = []} = {}) {
  const text = normalize(query), words = text.split(/\s+/).filter(Boolean);
  const recentRank = new Map(recent.map((key, position) => [key, position]));
  const ranked = [];
  for (const row of index) {
    if ((type && row.type !== type) || (state && row.state !== state)) continue;
    let rank = 0;
    if (text) {
      if (normalize(row.id) === text || normalize(row.key) === text) rank = 1000;
      else if (!words.every(word => row.search.includes(word))) continue;
      else if (normalize(row.id).startsWith(text)) rank = 800;
      else if (row.normalTitle === text) rank = 700;
      else if (row.normalTitle.startsWith(text)) rank = 600;
      else if (row.normalTitle.includes(text)) rank = 500;
      else rank = 100;
    } else if (recentRank.has(row.key)) rank = 1000 - recentRank.get(row.key);
    else if (row.type === 'desk') rank = 500;
    ranked.push({row, rank});
  }
  ranked.sort((left, right) => right.rank - left.rank ||
    (text ? 0 : String(right.row.date).localeCompare(String(left.row.date))) ||
    left.row.title.localeCompare(right.row.title) || left.row.key.localeCompare(right.row.key));
  return ranked.map(value => value.row);
}

export function attachWorkspaceFinder({
  getState, getWorkspace, getDesks, navigate, openItem, showTask,
  taskLabel = value => value, canOpen = () => true, reportError = () => {}
}) {
  const prefix = 'workspace-finder';
  let destroyed = false, busy = false, workspace = null, snapshot = null, index = [], byKey = new Map();
  let recent = [], matches = [], shown = [], page = 0, activeKey = '', previousFocus = null;
  let restoreFocus = true, debounce = null, focusTimer = null, cachedState = null, cachedDesks = '', stateChoices = '';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'workspace-finder-launch';
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-controls', prefix);
  button.setAttribute('aria-keyshortcuts', 'Control+k Meta+k');
  button.title = 'Find desks, records and operations in this workspace (Ctrl or Command + K)';
  button.textContent = 'Find in workspace';
  const actionRoot = document.querySelector('.top-actions');
  if (!actionRoot) throw Error('The original operator header is unavailable.');
  actionRoot.prepend(button);

  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = '/web/workspace_finder.css';
  document.head.append(style);
  const dialog = document.createElement('dialog');
  dialog.id = prefix;
  dialog.className = 'workspace-finder';
  dialog.setAttribute('aria-labelledby', prefix + '-title');
  dialog.innerHTML = '<header class="dialog-header"><div><h2 id="' + prefix + '-title">Find in workspace</h2>' +
    '<p data-finder-workspace></p></div><button type="button" data-finder-close>Close</button></header>' +
    '<div class="dialog-body"><label class="finder-query"><span>Find by name or original ID</span>' +
    '<input type="search" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" ' +
    'aria-controls="' + prefix + '-results" aria-describedby="' + prefix + '-help" data-finder-query></label>' +
    '<div class="finder-filters"><label><span>Type</span><select data-finder-type><option value="">All types</option>' +
    '<option value="desk">Workspace desks</option><option value="task">Operations</option>' +
    Object.entries(kinds).map(([key, label]) => '<option value="' + key + '">' + label + '</option>').join('') +
    '</select></label><label><span>State</span><select data-finder-state><option value="">All states</option></select></label></div>' +
    '<p id="' + prefix + '-help" class="note">Arrow keys select a result. Enter opens it. Escape closes Find. ' +
    'Results use the current retained workspace catalogue.</p>' +
    '<p class="finder-count" role="status" aria-live="polite" data-finder-count></p>' +
    '<p class="notice error" role="alert" data-finder-error hidden></p>' +
    '<div id="' + prefix + '-results" class="finder-results" role="listbox" aria-label="Matching workspace destinations"></div>' +
    '<p class="empty" data-finder-empty hidden>No matching destination. Try an original ID, a shorter name or different filters.</p>' +
    '</div><footer class="dialog-footer"><button type="button" data-finder-clear-recent>Clear recent destinations</button>' +
    '<div class="finder-paging"><button type="button" data-finder-previous>Previous</button>' +
    '<span data-finder-page></span><button type="button" data-finder-next>Next</button></div></footer>';
  document.body.append(dialog);
  const q = selector => dialog.querySelector(selector);
  const input = q('[data-finder-query]'), typeField = q('[data-finder-type]'), stateField = q('[data-finder-state]');
  const list = q('[role="listbox"]'), errorBox = q('[data-finder-error]');
  const storageKey = key => 'upstate-workspace-finder-v1:' + encodeURIComponent(key);

  function loadRecent(key) {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey(key)) || '[]');
      if (!Array.isArray(value)) return [];
      return value.filter(row => row && typeof row.key === 'string' &&
        /^(desk:[a-z][a-z0-9-]*|task:[0-9a-f]{64}|item:[a-z_-]+:[0-9a-f]{64})$/.test(row.key) &&
        Number.isFinite(row.opened_at)).slice(0, recentLimit);
    } catch { return []; }
  }
  function saveRecent(row, target) {
    if (getWorkspace() !== target || workspace !== target) return;
    recent = [{key: row.key, opened_at: Date.now()}, ...recent.filter(value => value.key !== row.key)].slice(0, recentLimit);
    try { localStorage.setItem(storageKey(target), JSON.stringify(recent)); } catch {}
  }
  function validSnapshot() {
    const value = getState();
    return value?.workspace_key && value.workspace_key === getWorkspace() && value.data ? value : null;
  }
  function rebuild() {
    snapshot = validSnapshot();
    if (!snapshot || snapshot.workspace_key !== workspace) return false;
    const desks = getDesks(), signature = JSON.stringify(desks);
    if (cachedState === snapshot && cachedDesks === signature) return true;
    index = buildWorkspaceFinderIndex(snapshot, desks, taskLabel);
    byKey = new Map(index.map(row => [row.key, row]));
    cachedState = snapshot; cachedDesks = signature;
    const selectedState = stateField.value;
    const states = [...new Set(index.map(row => row.state).filter(Boolean))].sort();
    if (selectedState && !states.includes(selectedState)) states.push(selectedState);
    const choices = JSON.stringify(states);
    if (choices !== stateChoices) {
      stateField.innerHTML = '<option value="">All states</option>' +
        states.map(value => '<option value="' + escapeHTML(value) + '">' + escapeHTML(value.replaceAll('_', ' ')) + '</option>').join('');
      stateField.value = selectedState; stateChoices = choices;
    }
    q('[data-finder-workspace]').textContent = snapshot.data.project?.title || 'Selected scientific workspace';
    return true;
  }
  function selectActive(key, scroll = false) {
    activeKey = key;
    for (const node of list.querySelectorAll('[data-finder-key]')) {
      const selected = node.dataset.finderKey === key;
      node.setAttribute('aria-selected', String(selected));
      if (selected) {
        input.setAttribute('aria-activedescendant', node.id);
        if (scroll) node.scrollIntoView({block: 'nearest'});
      }
    }
    if (!key) input.removeAttribute('aria-activedescendant');
  }
  function draw({preserve = true} = {}) {
    if (!dialog.open || !rebuild()) return;
    const focusedKey = list.contains(document.activeElement) ? document.activeElement.dataset.finderKey : null;
    const oldKey = preserve ? activeKey : '';
    matches = searchWorkspaceFinder(index, {
      query: input.value, type: typeField.value, state: stateField.value, recent: recent.map(row => row.key)
    });
    const position = oldKey ? matches.findIndex(row => row.key === oldKey) : -1;
    const pages = Math.max(1, Math.ceil(matches.length / pageSize));
    if (position >= 0) page = Math.floor(position / pageSize);
    page = Math.min(Math.max(0, page), pages - 1);
    shown = matches.slice(page * pageSize, (page + 1) * pageSize);
    const selected = shown.find(row => row.key === oldKey) || shown[0];
    const recentKeys = new Set(recent.map(row => row.key));
    list.innerHTML = shown.map((row, offset) =>
      '<button type="button" role="option" tabindex="-1" id="' + prefix + '-result-' + offset +
      '" data-finder-key="' + escapeHTML(row.key) + '" aria-selected="false">' +
      '<span class="finder-result-title">' + escapeHTML(row.title) + '</span><span class="finder-result-meta">' +
      escapeHTML(row.label) + (row.state ? ' · ' + escapeHTML(row.state.replaceAll('_', ' ')) : '') +
      (recentKeys.has(row.key) ? ' · Recently opened' : '') + '</span>' +
      '<span class="finder-result-id">' + escapeHTML(row.id) + '</span></button>').join('');
    selectActive(selected?.key || '');
    q('[data-finder-count]').textContent = matches.length + ' matching destinations' +
      (matches.length ? ' · showing ' + (page * pageSize + 1) + '–' + (page * pageSize + shown.length) : '');
    q('[data-finder-page]').textContent = 'Page ' + (page + 1) + ' of ' + pages;
    q('[data-finder-previous]').disabled = page === 0;
    q('[data-finder-next]').disabled = page + 1 >= pages;
    q('[data-finder-empty]').hidden = matches.length > 0;
    q('[data-finder-clear-recent]').disabled = recent.length === 0;
    if (focusedKey) {
      const retained = [...list.querySelectorAll('[data-finder-key]')].find(node => node.dataset.finderKey === focusedKey);
      (retained || input).focus();
    }
  }
  function close(restore = true) {
    clearTimeout(debounce); debounce = null;
    restoreFocus = restore;
    if (dialog.open) dialog.close();
    input.setAttribute('aria-expanded', 'false');
    snapshot = null; cachedState = null;
  }
  function reset() {
    clearTimeout(focusTimer); focusTimer = null;
    close(false); workspace = null; snapshot = null; cachedState = null; cachedDesks = ''; stateChoices = '';
    index = []; byKey.clear(); matches = []; shown = []; recent = []; page = 0; activeKey = '';
    input.value = ''; typeField.value = ''; stateField.innerHTML = '<option value="">All states</option>';
    list.replaceChildren(); input.removeAttribute('aria-activedescendant');
    previousFocus = null; errorBox.hidden = true;
  }
  function open() {
    if (destroyed || busy) return;
    clearTimeout(focusTimer); focusTimer = null;
    if (!canOpen()) { reportError(Error('Close the current operation form before finding another destination.')); return; }
    const value = validSnapshot();
    if (!value) { reportError(Error('Open a scientific workspace before using Find in workspace.')); return; }
    if (workspace !== value.workspace_key) {
      reset(); workspace = value.workspace_key; recent = loadRecent(workspace);
    }
    if (!dialog.open) {
      previousFocus = document.activeElement;
      errorBox.hidden = true; restoreFocus = true; dialog.showModal();
    }
    input.setAttribute('aria-expanded', 'true');
    draw(); input.focus(); input.select();
  }
  async function follow(key) {
    if (busy || !dialog.open) return;
    clearTimeout(debounce); debounce = null;
    if (!rebuild()) { reset(); return; }
    const row = byKey.get(key), target = workspace;
    if (!row) { errorBox.textContent = 'That destination is no longer in the current workspace catalogue.'; errorBox.hidden = false; draw(); return; }
    busy = true; close(false);
    try {
      if (getWorkspace() !== target) return;
      if (row.type === 'desk') await navigate(row.destination.view);
      else if (row.type === 'task') await showTask(row.destination.task);
      else await openItem(row.destination.kind, row.destination.id);
      if (getWorkspace() === target) saveRecent(row, target);
    } catch (error) {
      if (getWorkspace() === target && !destroyed) {
        busy = false; open();
        errorBox.textContent = error.message || String(error); errorBox.hidden = false;
      }
    } finally { busy = false; }
  }
  function move(offset) {
    clearTimeout(debounce); debounce = null; draw();
    if (!matches.length) return;
    const current = matches.findIndex(row => row.key === activeKey);
    const next = Math.max(0, Math.min(matches.length - 1, Math.max(0, current) + offset));
    page = Math.floor(next / pageSize); activeKey = matches[next].key;
    draw(); selectActive(activeKey, true);
  }
  function changePage(offset) {
    page += offset; activeKey = ''; draw({preserve: false});
    input.focus();
  }
  function filterChanged() {
    page = 0; activeKey = ''; errorBox.hidden = true; draw({preserve: false});
  }
  function keyboard(event) {
    if (event.isComposing || event.altKey || event.repeat || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
    event.preventDefault(); open();
  }
  function panelKey(event) {
    if (event.isComposing || (event.target !== input && !list.contains(event.target))) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'PageDown' || event.key === 'PageUp') {
      event.preventDefault(); move(event.key === 'PageDown' ? pageSize : -pageSize);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      clearTimeout(debounce); debounce = null; draw();
      if (activeKey) void follow(activeKey);
    }
  }
  function onClose() {
    input.setAttribute('aria-expanded', 'false');
    if (!restoreFocus || destroyed) return;
    const target = previousFocus;
    clearTimeout(focusTimer);
    focusTimer = setTimeout(() => {
      if (!destroyed && !dialog.open && target?.isConnected) target.focus();
    }, 0);
  }
  button.addEventListener('click', open);
  q('[data-finder-close]').addEventListener('click', () => close());
  q('[data-finder-previous]').addEventListener('click', () => changePage(-1));
  q('[data-finder-next]').addEventListener('click', () => changePage(1));
  q('[data-finder-clear-recent]').addEventListener('click', () => {
    recent = []; try { localStorage.removeItem(storageKey(workspace)); } catch {}
    draw();
  });
  input.addEventListener('input', () => {
    page = 0; activeKey = ''; errorBox.hidden = true;
    clearTimeout(debounce); debounce = setTimeout(() => { debounce = null; filterChanged(); }, 80);
  });
  typeField.addEventListener('change', filterChanged);
  stateField.addEventListener('change', filterChanged);
  list.addEventListener('click', event => {
    const node = event.target.closest('[data-finder-key]');
    if (node && list.contains(node)) void follow(node.dataset.finderKey);
  });
  list.addEventListener('focusin', event => {
    if (event.target.dataset.finderKey) selectActive(event.target.dataset.finderKey);
  });
  dialog.addEventListener('keydown', panelKey);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', onClose);
  document.addEventListener('keydown', keyboard);

  return {
    open, reset,
    update(value) {
      if (destroyed) return;
      if (workspace && (value?.workspace_key !== workspace || getWorkspace() !== workspace)) { reset(); return; }
      if (dialog.open) draw();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true; close(false); clearTimeout(focusTimer);
      document.removeEventListener('keydown', keyboard);
      button.remove(); dialog.remove(); style.remove();
      index = []; byKey.clear();
    }
  };
}
