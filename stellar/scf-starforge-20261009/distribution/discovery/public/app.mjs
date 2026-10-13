// MIT. Browser projection of the same catalog and search implementation as the CLI.
import { exportCommandCatalog, findCatalogItem, searchCommandCatalog } from '/catalog.mjs';

const $ = id => document.getElementById(id);
const names = { command: 'Command', source: 'Source', feature: 'Runtime group',
  export: 'Package export', application: 'Applications provider', merchant: 'Merchant MCP provider' };
let catalog, result, selectedId = '', currentPage = 1, inputTimer;
const filters = () => ({ query: $('query').value, kind: $('kind').value,
  source: $('source').value, feature: $('feature').value, page: currentPage, pageSize: 40 });
const node = (tag, text, className) => {
  const value = document.createElement(tag);
  if (text !== undefined) value.textContent = text;
  if (className) value.className = className;
  return value;
};
function showError(error) {
  $('error').hidden = !error;
  $('error').textContent = error?.message ?? '';
}
function writeUrl() {
  const values = filters(), url = new URL(location.href);
  url.search = '';
  for (const [name, value] of Object.entries({ q: values.query, kind: values.kind === 'all' ? '' : values.kind,
    source: values.source, feature: values.feature, page: currentPage > 1 ? currentPage : '' }))
    if (value) url.searchParams.set(name, String(value));
  url.hash = selectedId ? encodeURIComponent(selectedId) : '';
  history.replaceState(null, '', url);
}
function selectSource(id) {
  $('source').value = id;
  currentPage = 1;
  render();
}
function itemButton(id, label = id) {
  const button = node('button', label);
  button.type = 'button';
  button.addEventListener('click', () => selectItem(id, true));
  return button;
}
function heading(parent, text) { parent.append(node('h3', text)); }
function list(parent, values, kind) {
  if (!values?.length) return;
  const ul = node('ul');
  for (const value of values) {
    const li = node('li');
    li.append(kind ? itemButton(kind + ':' + value, value) : node('code', value));
    ul.append(li);
  }
  parent.append(ul);
}
async function copy(text, button) {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = original; }, 1500);
  } catch {
    button.textContent = 'Select and copy the text below';
    setTimeout(() => { button.textContent = original; }, 3500);
  }
}
function selectItem(id, focus = false) {
  try {
    const item = findCatalogItem(catalog, id);
    selectedId = item.id;
    const panel = $('details');
    panel.replaceChildren(node('p', names[item.kind], 'eyebrow'), node('h2', item.name), node('p', item.description));
    const actions = node('div', undefined, 'detail-actions');
    const copyLink = node('button', 'Copy result link'); copyLink.type = 'button';
    copyLink.addEventListener('click', () => copy(location.href, copyLink)); actions.append(copyLink);
    const planLink = node('a', 'Add to operating plan');
    planLink.href = '/operating-plan.html?add=' + encodeURIComponent(item.id);
    actions.append(planLink);
    const supportLink = node('a', 'Select for Support procedure');
    supportLink.href = '/operating-plan.html?prepare=support&supportRegistration=' + encodeURIComponent(item.id);
    actions.append(supportLink);
    panel.append(actions);
    if (item.helpArgv) {
      heading(panel, 'Open native command help');
      const command = item.helpArgv.join(' '), button = node('button', 'Copy command'); button.type = 'button';
      button.addEventListener('click', () => copy(command, button));
      panel.append(node('pre', command), button);
    }
    if (item.aliases?.length) { heading(panel, 'Same entrypoint aliases'); list(panel, item.aliases, 'command'); }
    heading(panel, 'Registration sources');
    for (const id of item.sourceIds) {
      const source = catalog.sources.find(value => value.id === id);
      const button = node('button', source?.id ?? id, 'source-button');
      button.type = 'button';
      button.append(node('small', source?.description ?? ''));
      button.addEventListener('click', () => selectSource(id));
      panel.append(button);
    }
    if (item.kind !== 'feature' && item.featureIds.length) {
      heading(panel, 'Runtime groups declared by these sources');
      list(panel, item.featureIds, 'feature');
    }
    if (item.kind === 'feature') {
      heading(panel, 'Declared package versions');
      const table = node('table', undefined, 'detail-table');
      const thead = node('thead'), tr = node('tr');
      for (const label of ['Package', 'Version', 'Import probe']) { const th = node('th', label); th.scope = 'col'; tr.append(th); }
      thead.append(tr); table.append(thead);
      const tbody = node('tbody');
      for (const dependency of item.dependencies) {
        const row = node('tr');
        for (const value of [dependency.name, dependency.version, dependency.probe]) row.append(node('td', value));
        tbody.append(row);
      }
      table.append(tbody); panel.append(table);
      if (item.packagePath) panel.append(node('p', 'Package manifest: ' + item.packagePath));
      if (item.error) panel.append(node('p', item.error));
    }
    for (const [key, title, kind] of [['commands', 'Commands', 'command'], ['exports', 'Package exports', 'export'],
      ['applications', 'Applications providers', 'application'], ['merchantProviders', 'Merchant MCP providers', 'merchant']]) {
      if (item[key]?.length) { heading(panel, title); list(panel, item[key], kind); }
    }
    if (item.target) { heading(panel, 'Package export target'); panel.append(node('pre',
      typeof item.target === 'string' ? item.target : JSON.stringify(item.target, null, 2))); }
    const technical = node('details');
    technical.append(node('summary', 'Original source details'), node('pre', JSON.stringify(item, null, 2)));
    panel.append(technical);
    for (const row of $('rows').children) row.classList.toggle('selected', row.dataset.itemId === selectedId);
    writeUrl();
    if (focus) panel.focus();
  } catch (error) { showError(error); }
}
function render() {
  if (!catalog) return;
  try {
    result = searchCommandCatalog(catalog, filters()); currentPage = result.page;
    const rows = $('rows'); rows.replaceChildren();
    for (const item of result.items) {
      const row = node('tr'); row.dataset.itemId = item.id; row.classList.toggle('selected', item.id === selectedId);
      const name = node('td'), button = itemButton(item.id, item.name); button.className = 'result-name';
      name.append(button, node('small', item.sourceIds.join(', ')));
      row.append(name, node('td', names[item.kind], 'kind'), node('td', item.description)); rows.append(row);
    }
    if (!result.items.length) {
      const row = node('tr'), cell = node('td', 'No matching registrations. Try a broader phrase or clear a filter.', 'empty');
      cell.colSpan = 3; row.append(cell); rows.append(row);
    }
    const start = result.total ? (result.page - 1) * result.pageSize + 1 : 0;
    $('status').textContent = result.total + ' matches · ' + result.counts.command + ' commands · ' +
      result.counts.source + ' sources · ' + result.counts.feature + ' runtime groups';
    $('page').textContent = start + '–' + Math.min(result.page * result.pageSize, result.total) + ' of ' + result.total;
    $('previous').disabled = result.page <= 1; $('next').disabled = result.page >= result.pages;
    $('export').disabled = false;
    showError(null); writeUrl();
  } catch (error) { $('export').disabled = true; showError(error); }
}
function downloadSelection() {
  try {
    const value = exportCommandCatalog(catalog, filters());
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
    const link = node('a'); link.href = url; link.download = 'starforge-command-catalog.json';
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (error) { showError(error); }
}
function populateSelect(element, entries, selected) {
  const first = element.options[0].cloneNode(true); element.replaceChildren(first);
  for (const [value, label] of entries) { const option = node('option', label); option.value = value; element.append(option); }
  element.value = entries.some(([value]) => value === selected) ? selected : '';
}
async function refresh() {
  $('refresh').disabled = true; $('status').textContent = 'Reading selected package…';
  try {
    const response = await fetch('/api/catalog', { cache: 'no-store' });
    const value = await response.json(); if (!response.ok) throw new Error(value.error ?? response.statusText);
    catalog = value;
    const source = $('source').value || new URL(location.href).searchParams.get('source') || '';
    const feature = $('feature').value || new URL(location.href).searchParams.get('feature') || '';
    populateSelect($('source'), catalog.sources.map(item => [item.id, item.id]), source);
    populateSelect($('feature'), catalog.featureNames.map(name => [name, name]), feature);
    $('package').textContent = catalog.package.name + ' · ' + catalog.package.version;
    $('edition').textContent = catalog.package.sourceSelection?.title ?? 'Complete selected toolkit';
    $('captured').textContent = 'Read ' + new Date(catalog.capturedAt).toLocaleString();
    render();
    if (selectedId) {
      if (catalog.items.some(item => item.id === selectedId)) selectItem(selectedId);
      else { selectedId = ''; $('details').replaceChildren(node('h2', 'Choose a result'), node('p', 'The previous result is absent from this selected package.')); writeUrl(); }
    }
  } catch (error) { showError(error); $('status').textContent = catalog ? 'Source refresh failed; the previous catalog remains open.' : 'Catalog could not be read.'; }
  finally { $('refresh').disabled = false; }
}
const params = new URL(location.href).searchParams;
$('query').value = params.get('q') ?? '';
$('kind').value = params.get('kind') ?? 'all';
if (!$('kind').value) $('kind').value = 'all';
currentPage = Math.max(1, Number(params.get('page')) || 1);
try { selectedId = decodeURIComponent(location.hash.slice(1)); } catch {}
$('search-form').addEventListener('submit', event => { event.preventDefault(); clearTimeout(inputTimer); currentPage = 1; render(); });
$('query').addEventListener('input', () => { clearTimeout(inputTimer); inputTimer = setTimeout(() => { currentPage = 1; render(); }, 150); });
for (const id of ['kind', 'source', 'feature']) $(id).addEventListener('change', () => { currentPage = 1; render(); });
$('clear').addEventListener('click', () => {
  clearTimeout(inputTimer); $('query').value = ''; $('kind').value = 'all'; $('source').value = ''; $('feature').value = ''; currentPage = 1; render();
});
$('previous').addEventListener('click', () => { currentPage--; render(); });
$('next').addEventListener('click', () => { currentPage++; render(); });
$('refresh').addEventListener('click', refresh);
$('export').addEventListener('click', downloadSelection);
window.addEventListener('hashchange', () => {
  try { const id = decodeURIComponent(location.hash.slice(1)); if (id) selectItem(id); } catch (error) { showError(error); }
});
await refresh();
