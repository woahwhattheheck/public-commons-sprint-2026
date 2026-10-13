// MIT. Existing operation history, complete original receiving and recovery navigation.
import { operationHistory } from './operation-history-model.mjs';
const make = (tag, text, className) => {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text;
  if (className) node.className = className; return node;
};
const stable = value => JSON.stringify(value, (key, item) => key === 'checkedAt' ? undefined : item);
const queryURL = (path, value) => path + '?' + new URLSearchParams(value);
export function createOperationHistoryView({ root, count, api, getState, renderCards, openLog, error }) {
  let workspaceId = null, scope = 0, sequence = 0, options = { query: '', filter: 'all', runtimeId: null, limit: 20, cursor: null };
  let trail = [], selectedId = null, detail = null, selectedVersion = null, rendered = '', pending = null;
  let preferenceError = false, detailNotice = '', lastLogSelection = null, requestedVersion = null;
  const form = make('form', undefined, 'panel'), fields = make('div', undefined, 'columns');
  const queryLabel = make('label', 'Find an operation'), search = make('input'); search.type = 'search'; search.maxLength = 500;
  search.placeholder = 'Operation, original request, runtime or application';
  queryLabel.append(search);
  const phaseLabel = make('label', 'Status'), filter = make('select');
  for (const [value, label] of [['all', 'All operations'], ['active', 'Active or queued'], ['attention', 'Needs attention'], ['completed', 'Completed']])
    filter.append(new Option(label, value));
  phaseLabel.append(filter);
  const runtimeLabel = make('label', 'Runtime'), runtime = make('select'); runtimeLabel.append(runtime);
  fields.append(queryLabel, phaseLabel, runtimeLabel); form.append(fields);
  const submit = make('button', 'Find operations'); submit.type = 'submit';
  const clear = make('button', 'Clear filters'); clear.type = 'button';
  const formActions = make('div', undefined, 'actions'); formActions.append(submit, clear); form.append(formActions);
  const status = make('p', '', 'muted'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const cards = make('div', undefined, 'operation-list'), navigation = make('div', undefined, 'actions');
  const detailPanel = make('section', undefined, 'panel'); detailPanel.setAttribute('aria-label', 'Complete original operation');
  detailPanel.hidden = true;
  root.replaceChildren(form, status, cards, navigation, detailPanel);
  const key = () => 'starforge-runtime-operation-history-' + workspaceId;
  function preferences() {
    if (!workspaceId) return;
    try {
      localStorage.setItem(key(), JSON.stringify({ options, trail, selectedId }));
      preferenceError = false;
    } catch { preferenceError = true; }
  }
  function button(label, action, disabled = false) {
    const node = make('button', label); node.type = 'button'; node.disabled = disabled;
    node.addEventListener('click', () => Promise.resolve().then(action).catch(error)); return node;
  }
  function renderDetail(note = detailNotice) {
    detailPanel.hidden = !selectedId;
    if (!selectedId) return;
    const heading = make('div', undefined, 'section-title');
    heading.append(make('h3', 'Complete original operation'), make('span', detail?.displayPhase ?? (pending ? 'Loading' : 'Unavailable'), 'status'));
    const actions = make('div', undefined, 'actions');
    actions.append(button('Refresh selected operation', () => readSelected(true), Boolean(pending)),
      button('Open original worker output', () => openLog({ operationId: selectedId })),
      button('Download complete operation JSON', () => {
        if (!detail || detail.id !== selectedId) return;
        const url = URL.createObjectURL(new Blob([JSON.stringify(detail, null, 2) + '\n'], { type: 'application/json' }));
        const link = make('a'); link.href = url; link.download = 'runtime-operation-' + selectedId + '.json'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, !detail || detail.id !== selectedId),
      button('Close selected operation', () => {
        sequence++; pending = null; selectedId = null; detail = null; selectedVersion = null; preferences(); render();
      }));
    detailPanel.replaceChildren(heading, make('p', selectedId, 'muted'), actions);
    if (note) detailPanel.append(make('p', note, 'note'));
    if (detail) {
      const record = make('details'), summary = make('summary', 'Complete original fields, result and observation');
      record.open = true; record.append(summary, make('pre', JSON.stringify(detail, null, 2))); detailPanel.append(record);
    }
  }
  function readSelected(force = false) {
    if (!workspaceId || !selectedId) return Promise.resolve();
    if (pending && !force) return pending;
    const ownScope = scope, ownId = selectedId, ticket = ++sequence, ownWorkspace = workspaceId;
    const version = stable(getState()?.operations.find(item => item.id === ownId) ?? null);
    requestedVersion = version;
    detailNotice = detail ? 'Refreshing the same original operation.' : 'Reading the original operation.';
    const current = () => scope === ownScope && sequence === ticket && selectedId === ownId &&
      workspaceId === ownWorkspace && getState()?.workspaceId === ownWorkspace;
    const work = (async () => {
      try {
        const value = await api(queryURL('/api/operation-status', { operationId: ownId }));
        if (!current()) return;
        if (value.id !== ownId) throw new Error('The operation read returned a different original request.');
        detail = value; selectedVersion = version; detailNotice = ''; renderDetail();
      } catch (failure) {
        if (current()) { selectedVersion = version; detailNotice = 'The current read failed. Any previously opened complete operation remains available below.'; renderDetail(); error(failure); }
      } finally {
        if (current()) {
          pending = null; renderDetail();
          const latest = stable(getState()?.operations.find(item => item.id === ownId) ?? null);
          if (latest !== requestedVersion) readSelected().catch(error);
        }
      }
    })();
    pending = work; renderDetail();
    return work;
  }
  function choose(id) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Choose an original retained operation.');
    if (selectedId !== id) {
      sequence++; pending = null; selectedId = id; detail = null; detailNotice = ''; requestedVersion = null;
      selectedVersion = null;
    }
    preferences(); render(); detailPanel.scrollIntoView({ block: 'nearest' }); return readSelected();
  }
  function reset() {
    scope++; sequence++; workspaceId = null; pending = null;
    options = { query: '', filter: 'all', runtimeId: null, limit: 20, cursor: null };
    trail = []; selectedId = null; detail = null; selectedVersion = null; rendered = ''; preferenceError = false;
    detailNotice = ''; lastLogSelection = null; requestedVersion = null;
    search.value = ''; filter.value = 'all'; runtime.replaceChildren(new Option('All runtimes', ''));
    cards.replaceChildren(); navigation.replaceChildren(); status.textContent = ''; count.textContent = '0'; renderDetail();
  }
  function initialize() {
    const state = getState();
    if (!state?.workspaceId) return false;
    if (workspaceId === state.workspaceId) return true;
    reset(); workspaceId = state.workspaceId;
    try {
      const saved = JSON.parse(localStorage.getItem(key()) ?? 'null');
      if (saved) {
        operationHistory(workspaceId, state.operations, saved.options);
        options = { query: saved.options?.query ?? '', filter: saved.options?.filter ?? 'all',
          runtimeId: saved.options?.runtimeId ?? null, limit: saved.options?.limit ?? 20, cursor: saved.options?.cursor ?? null };
        trail = Array.isArray(saved.trail) && saved.trail.length <= 10000 &&
          saved.trail.every(value => value === null || typeof value === 'string' && value.length <= 8192) ? saved.trail : [];
        selectedId = typeof saved.selectedId === 'string' && /^[a-f0-9-]{36}$/.test(saved.selectedId) ? saved.selectedId : null;
      }
    } catch { options = { query: '', filter: 'all', runtimeId: null, limit: 20, cursor: null }; trail = []; selectedId = null; }
    search.value = options.query; filter.value = options.filter;
    return true;
  }
  function render(logSelection = lastLogSelection) {
    if (!initialize()) return;
    lastLogSelection = logSelection;
    const state = getState(), page = operationHistory(workspaceId, state.operations, options);
    const runtimeValues = (state.runtimes ?? []).map(item => [item.id, item.label]);
    if (options.runtimeId && !runtimeValues.some(([id]) => id === options.runtimeId))
      runtimeValues.push([options.runtimeId, 'Retained runtime ' + options.runtimeId]);
    const runtimeSignature = JSON.stringify(runtimeValues);
    if (runtime.dataset.rendered !== runtimeSignature) {
      runtime.replaceChildren(new Option('All runtimes', ''), ...runtimeValues.map(([id, label]) => new Option(label, id)));
      runtime.dataset.rendered = runtimeSignature;
    }
    runtime.value = options.runtimeId ?? '';
    count.textContent = String(page.total);
    status.textContent = page.matched + ' matching of ' + page.total + ' retained operations · ' +
      page.counts.active + ' active or queued · ' + page.counts.attention + ' need attention · ' + page.counts.completed + ' completed' +
      (preferenceError ? ' · View preferences could not be saved in this browser.' : '');
    const signature = stable([page.items, page.nextCursor, page.matched, selectedId, logSelection?.operationId]);
    if (signature !== rendered) {
      rendered = signature; renderCards(page.items, cards, selectedId);
      if (!page.items.length && page.total) cards.replaceChildren(make('p',
        options.cursor ? 'No current matches remain after this page boundary. Choose Latest results to refresh the selection.' :
          'No retained operation matches these filters.', 'empty'));
      navigation.replaceChildren(
        button('Previous page', () => { options.cursor = trail.pop() ?? null; preferences(); render(); }, !trail.length),
        button('Older operations', () => { trail.push(options.cursor); options.cursor = page.nextCursor; preferences(); render(); }, !page.hasMore),
        button('Latest results', () => { options.cursor = null; trail = []; preferences(); render(); }));
    }
    if (selectedId) {
      const version = stable(state.operations.find(item => item.id === selectedId) ?? null);
      if (selectedVersion === null || version !== selectedVersion) {
        if (!pending) readSelected().catch(error);
      }
    } else renderDetail();
  }
  function apply() {
    options = { query: search.value, filter: filter.value, runtimeId: runtime.value || null, limit: 20, cursor: null };
    trail = []; preferences(); render();
  }
  form.addEventListener('submit', event => { event.preventDefault(); try { apply(); } catch (failure) { error(failure); } });
  filter.addEventListener('change', () => { try { apply(); } catch (failure) { error(failure); } });
  runtime.addEventListener('change', () => { try { apply(); } catch (failure) { error(failure); } });
  clear.addEventListener('click', () => { search.value = ''; filter.value = 'all'; runtime.value = ''; apply(); });
  return { update: render, choose, reset };
}
