// MIT. Search and navigation over the original Applications catalog and saved records.
const node = (tag, text, className) => {
  const value = document.createElement(tag);
  if (text !== undefined) value.textContent = text;
  if (className) value.className = className;
  return value;
};
const action = (text, callback) => {
  const value = node('button', text); value.type = 'button';
  value.addEventListener('click', callback); return value;
};
const field = (text, input) => { const value = node('label', text); value.append(input); return value; };
const normalized = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase();
const matches = (text, query) => normalized(query).trim().split(/\s+/u).filter(Boolean)
  .every(part => normalized(text).includes(part));
const PAGE = 12;
function options(select, rows, empty) {
  const selected = select.value;
  const signature = JSON.stringify(rows);
  if (select.dataset.signature === signature) return;
  select.dataset.signature = signature;
  select.replaceChildren(new Option(empty, ''), ...rows.map(row => new Option(row.label, row.id)));
  if (selected && !rows.some(row => row.id === selected)) select.append(new Option('Saved filter: ' + selected, selected));
  select.value = selected;
}
function pager(previous, next, summary, count, page, noun) {
  const start = count ? page * PAGE + 1 : 0, end = Math.min(count, (page + 1) * PAGE);
  previous.disabled = page === 0; next.disabled = end >= count;
  summary.textContent = count ? start + '–' + end + ' of ' + count + ' ' + noun : 'No matching ' + noun;
}
export function createApplicationLibrary({
  root, readSaved, saveSaved, getWorkspaceId, openApplication, configureApplication,
}) {
  let data = { catalog: [], applications: [] }, selectedId = null, workspaceId = null;
  let savedPage = 0, catalogPage = 0, initialized = false;
  const saved = node('section', undefined, 'panel');
  const title = node('div', undefined, 'section-title'), count = node('span', '0', 'count');
  title.append(node('h3', 'Saved applications'), count);
  const search = node('input'); search.type = 'search'; search.maxLength = 250;
  search.id = 'application-library-search'; search.autocomplete = 'off';
  search.placeholder = 'Name, application, command, runtime or status';
  const filters = node('div', undefined, 'columns');
  const runtime = node('select'); runtime.id = 'application-library-runtime';
  const phase = node('select'); phase.id = 'application-library-phase';
  filters.append(field('Runtime', runtime), field('Status', phase));
  const list = node('div', undefined, 'runtime-list'); list.id = 'application-library-results';
  const selected = node('div', undefined, 'actions'), selectedText = node('span', '', 'note');
  const showSelected = action('Show selected application', () => {
    search.value = runtime.value = phase.value = '';
    const index = savedRows().findIndex(row => row.id === selectedId);
    savedPage = index < 0 ? 0 : Math.floor(index / PAGE);
    persist(); renderSaved();
  });
  selected.append(selectedText, showSelected);
  const savedControls = node('div', undefined, 'actions'), savedSummary = node('span', '', 'note');
  savedSummary.setAttribute('aria-live', 'polite');
  const previousSaved = action('Previous applications', () => { savedPage--; persist(); renderSaved(); });
  const nextSaved = action('Next applications', () => { savedPage++; persist(); renderSaved(); });
  const clear = action('Clear filters', () => {
    search.value = runtime.value = phase.value = ''; savedPage = 0; persist(); renderSaved();
  });
  savedControls.append(previousSaved, nextSaved, clear, savedSummary);
  saved.append(title, field('Find a saved application', search), filters, selected, list, savedControls);

  const catalog = node('details', undefined, 'panel'); catalog.id = 'application-catalog';
  const catalogTitle = node('summary', 'Available application tools');
  const catalogSearch = node('input'); catalogSearch.type = 'search'; catalogSearch.maxLength = 250;
  catalogSearch.id = 'application-catalog-search'; catalogSearch.autocomplete = 'off';
  catalogSearch.placeholder = 'Application name, purpose or command';
  const catalogList = node('div'); catalogList.id = 'application-catalog-results';
  const catalogControls = node('div', undefined, 'actions'), catalogSummary = node('span', '', 'note');
  catalogSummary.setAttribute('aria-live', 'polite');
  const previousCatalog = action('Previous tools', () => { catalogPage--; persist(); renderCatalog(); });
  const nextCatalog = action('Next tools', () => { catalogPage++; persist(); renderCatalog(); });
  const clearCatalog = action('Clear tool search', () => {
    catalogSearch.value = ''; catalogPage = 0; persist(); renderCatalog();
  });
  catalogControls.append(previousCatalog, nextCatalog, clearCatalog, catalogSummary);
  catalog.append(catalogTitle,
    node('p', 'Choose a tool to configure a new application. Its saved runtime and source are checked by the existing application review.', 'note'),
    field('Find an application tool', catalogSearch), catalogList, catalogControls);
  const sourceProblems = node('section', undefined, 'panel'); sourceProblems.hidden = true;
  sourceProblems.id = 'application-provider-problems';
  root.replaceChildren(saved, sourceProblems, catalog);

  function persist() {
    if (!initialized) return;
    saveSaved('library', { search: search.value, runtime: runtime.value, phase: phase.value,
      catalogSearch: catalogSearch.value, savedPage, catalogPage, catalogOpen: catalog.open });
  }
  function savedRows() {
    return [...(data.applications ?? [])].sort((a, b) =>
      String(a.label ?? a.id).localeCompare(String(b.label ?? b.id)) || String(a.id).localeCompare(String(b.id)));
  }
  function savedText(app) {
    const type = data.catalog.find(item => item.id === app.kind);
    return [app.label, app.id, app.kind, type?.title, type?.description, type?.command,
      app.phase, app.runtimeId, app.runtime?.directory, app.release?.sourceCommit].filter(Boolean).join(' ');
  }
  function renderSaved() {
    const all = savedRows(), rows = all.filter(app => matches(savedText(app), search.value) &&
      (!runtime.value || app.runtimeId === runtime.value) && (!phase.value || app.phase === phase.value));
    savedPage = Math.max(0, Math.min(savedPage, Math.max(0, Math.ceil(rows.length / PAGE) - 1)));
    count.textContent = rows.length + ' / ' + all.length;
    const current = all.find(app => app.id === selectedId);
    selected.hidden = !current;
    selectedText.textContent = current ? 'Selected: ' + (current.label ?? current.id) : '';
    showSelected.hidden = !current || rows.slice(savedPage * PAGE, (savedPage + 1) * PAGE).some(app => app.id === current.id);
    const signature = JSON.stringify([rows.slice(savedPage * PAGE, (savedPage + 1) * PAGE).map(app =>
      [app.id, app.label, app.kind, app.phase, app.runtimeId, app.runtime?.directory,
        data.catalog.find(item => item.id === app.kind)?.title]), selectedId, all.length]);
    if (list.dataset.signature !== signature) {
      list.dataset.signature = signature;
      list.replaceChildren(...rows.slice(savedPage * PAGE, (savedPage + 1) * PAGE).map(app => {
        const type = data.catalog.find(item => item.id === app.kind);
        const entry = action('', () => openApplication(app.id));
        entry.className = 'runtime-entry' + (app.id === selectedId ? ' selected' : '');
        entry.dataset.applicationId = app.id;
        if (app.id === selectedId) entry.setAttribute('aria-current', 'true');
        entry.append(node('strong', app.label ?? app.id),
          node('small', [app.phase, type?.title ?? app.kind, app.runtime?.directory ?? app.runtimeId].filter(Boolean).join(' · ')));
        return entry;
      }));
      if (!rows.length) list.append(node('p', all.length ?
        'No applications match these filters. Clear the filters to see the complete saved library.' :
        'No applications have been saved. Choose an available tool below to prepare the first one.', 'empty'));
    }
    pager(previousSaved, nextSaved, savedSummary, rows.length, savedPage, 'applications');
  }
  function renderSourceProblems() {
    const signature = JSON.stringify([data.catalogError ?? null, data.unavailableProviders ?? []]);
    if (sourceProblems.dataset.signature === signature) return;
    sourceProblems.dataset.signature = signature; sourceProblems.replaceChildren();
    const missing = data.unavailableProviders ?? [];
    sourceProblems.hidden = !data.catalogError && !missing.length;
    if (sourceProblems.hidden) return;
    sourceProblems.append(node('h3', data.catalogError ? 'Application catalog needs source recovery' : 'Some application tools need their source'));
    if (data.catalogError) {
      sourceProblems.append(node('p', data.catalogError.message, 'note'),
        node('code', data.catalogError.code),
        node('p', 'Saved application history and running application controls are available above. Restore the declared source before using this catalog.', 'note'));
    } else {
      sourceProblems.append(node('p', 'The available tools below can be used. These additional providers have a missing source file or dependency; receive their original source and reopen the Applications host.', 'note'));
      for (const provider of missing) {
        const details = node('details'), summary = node('summary', provider.id);
        details.append(summary, node('p', provider.path, 'note'),
          node('p', provider.error?.message ?? 'Original provider source is unavailable.', 'note'));
        if (provider.error?.code) details.append(node('code', provider.error.code));
        sourceProblems.append(details);
      }
    }
  }
  function renderCatalog() {
    const all = [...(data.catalog ?? [])].sort((a, b) =>
      a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    const rows = all.filter(type => matches([type.id, type.title, type.description, type.command,
      ...(type.fields ?? []).map(item => item.label)].filter(Boolean).join(' '), catalogSearch.value));
    catalogPage = Math.max(0, Math.min(catalogPage, Math.max(0, Math.ceil(rows.length / PAGE) - 1)));
    catalogTitle.textContent = 'Available application tools · ' + all.length;
    const page = rows.slice(catalogPage * PAGE, (catalogPage + 1) * PAGE);
    const signature = JSON.stringify([page, all.length]);
    if (catalogList.dataset.signature !== signature) {
      catalogList.dataset.signature = signature;
      catalogList.replaceChildren(...page.map(type => {
        const item = node('article', undefined, 'operation');
        item.dataset.applicationKind = type.id;
        const title = node('h3', type.title), command = node('p');
        command.append(node('code', type.command));
        const required = (type.fields ?? []).filter(value => value.required).map(value => value.label);
        item.append(title, node('p', type.description ?? '', 'note'), command,
          node('p', required.length ? 'Required setup: ' + required.join('; ') : 'Review the setup options for this tool.', 'note'));
        const controls = node('div', undefined, 'actions');
        controls.append(action('Configure ' + type.title, () => configureApplication(type.id)));
        item.append(controls); return item;
      }));
      if (!rows.length) catalogList.append(node('p', 'No tools match this search. Clear the search to browse the complete current catalog.', 'empty'));
    }
    pager(previousCatalog, nextCatalog, catalogSummary, rows.length, catalogPage, 'tools');
  }
  search.addEventListener('input', () => { savedPage = 0; persist(); renderSaved(); });
  runtime.addEventListener('change', () => { savedPage = 0; persist(); renderSaved(); });
  phase.addEventListener('change', () => { savedPage = 0; persist(); renderSaved(); });
  catalogSearch.addEventListener('input', () => { catalogPage = 0; persist(); renderCatalog(); });
  catalog.addEventListener('toggle', persist);
  return {
    update(value, selection) {
      data = value; selectedId = selection;
      const nextWorkspace = getWorkspaceId();
      if (!initialized || workspaceId !== nextWorkspace) {
        workspaceId = nextWorkspace;
        const saved = readSaved('library') ?? {};
        search.value = typeof saved.search === 'string' ? saved.search.slice(0, 250) : '';
        catalogSearch.value = typeof saved.catalogSearch === 'string' ? saved.catalogSearch.slice(0, 250) : '';
        savedPage = Number.isSafeInteger(saved.savedPage) && saved.savedPage >= 0 ? saved.savedPage : 0;
        catalogPage = Number.isSafeInteger(saved.catalogPage) && saved.catalogPage >= 0 ? saved.catalogPage : 0;
        runtime.replaceChildren(new Option('All runtimes', '')); phase.replaceChildren(new Option('All statuses', ''));
        for (const [control, value] of [[runtime, saved.runtime], [phase, saved.phase]]) {
          if (typeof value === 'string' && value) control.append(new Option(value, value));
          control.value = typeof value === 'string' ? value : '';
          delete control.dataset.signature;
        }
        catalog.open = typeof saved.catalogOpen === 'boolean' ? saved.catalogOpen : !data.applications.length;
        initialized = true;
      }
      const runtimeMap = new Map();
      for (const app of data.applications ?? []) if (app.runtimeId)
        runtimeMap.set(app.runtimeId, app.runtime?.directory ?? app.runtimeId);
      options(runtime, [...runtimeMap].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)), 'All runtimes');
      options(phase, [...new Set((data.applications ?? []).map(app => app.phase).filter(Boolean))]
        .sort().map(id => ({ id, label: id })), 'All statuses');
      renderSaved(); renderSourceProblems(); renderCatalog();
    },
    select(id) { selectedId = id; renderSaved(); },
    reset() {
      initialized = false; workspaceId = null; data = { catalog: [], applications: [] }; selectedId = null;
      delete list.dataset.signature; delete catalogList.dataset.signature;
      list.replaceChildren(); catalogList.replaceChildren(); sourceProblems.replaceChildren();
      sourceProblems.hidden = true; delete sourceProblems.dataset.signature;
    },
  };
}
