'use strict';
const $ = id => document.getElementById(id);
const state = {
  token: sessionStorage.getItem('study-operator-token') || '', data: null, busy: 0,
  geoPage: { offset: 0, next: null }, samplePage: { offset: 0, next: null },
  reviewPage: { offset: 0, next: null }, review: null, selectedReview: new Set(),
  geographies: [], selectedMeasures: new Set(), columns: [], units: new Map(), availableUnits: new Map(), fields: {},
};
const familyNames = { acs: 'ACS', laus: 'LAUS', qcew: 'QCEW', hud_income_limits: 'HUD' };
const keyOf = value => JSON.stringify(value);
const short = value => String(value || '').slice(0, 12);
const pretty = value => JSON.stringify(value, null, 2);
const readable = value => String(value || '').replaceAll('_', ' ');
function h(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'className') node.className = value;
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child !== null && child !== undefined) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
function table(headers, rows) {
  if (!rows.length) return h('div', { className: 'empty' }, 'No records in this selection.');
  return h('div', { className: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, headers.map(value => h('th', {}, value)))),
    h('tbody', {}, rows.map(cells => h('tr', {}, cells.map(value => h('td', {}, value)))))));
}
function show(title, value, actions = []) {
  $('detail-title').textContent = title;
  $('detail-body').textContent = pretty(value);
  $('detail-actions').replaceChildren(...actions);
  if (!$('detail').open) $('detail').showModal();
}
function button(label, action, secondary = false) {
  return h('button', { type: 'button', className: secondary ? 'secondary' : '', onclick: () => run(label, action) }, label);
}
function notice(message, error = false) {
  $('notice').textContent = message;
  $('notice').dataset.error = String(error);
}
async function api(operation, args = {}) {
  const response = await fetch('/api', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.token },
    body: JSON.stringify({ operation, arguments: args }),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    const detail = result.details && Object.keys(result.details).length ? ' · ' + JSON.stringify(result.details) : '';
    throw new Error(readable(result.code || 'Operation failed') + detail);
  }
  return result.result;
}
async function run(label, action) {
  state.busy++;
  document.body.dataset.busy = 'true';
  $('notice').dataset.busy = 'true';
  notice(label + '…');
  try {
    const value = await action();
    notice(label + ' completed.');
    return value;
  } catch (error) {
    notice(error.message, true);
    return null;
  } finally {
    state.busy--;
    if (!state.busy) {
      document.body.dataset.busy = 'false';
      $('notice').dataset.busy = 'false';
    }
  }
}
function view(name) {
  for (const section of document.querySelectorAll('main>section')) section.hidden = section.id !== 'view-' + name;
  for (const item of document.querySelectorAll('aside nav button')) item.classList.toggle('active', item.dataset.view === name);
}
function options(id, values, label = value => value.label || value.name || short(value.id), empty = null) {
  const select = $(id), previous = select.value;
  select.replaceChildren(...(empty === null ? [] : [h('option', { value: '' }, empty)]),
    ...values.map(value => h('option', { value: value.id }, label(value) + ' · ' + short(value.id))));
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
}
function revisions(kind) {
  return state.data.revisions.filter(value => value.schema === 'stellar-forge.study-' + kind + '.v1');
}
function setColumns(mapping) {
  $('mapping-name').value = mapping.name;
  state.columns = mapping.columns.map(column => ({ ...column, key: mapping.key_fields.includes(column.name) }));
  state.units = new Map(mapping.units.map(unit => [keyOf([unit.family, unit.measure_id]), { ...unit }]));
  renderColumns();
  renderUnits();
}
function mappingDraft() {
  return {
    schema: 'stellar-forge.study-mapping.v1', name: $('mapping-name').value,
    columns: state.columns.map(({ key, ...column }) => column),
    key_fields: state.columns.filter(column => column.key).map(column => column.name),
    units: [...state.units.values()].filter(rule => rule.unit.trim() && rule.output_unit.trim()),
  };
}
function portfolioDraft() {
  return { schema: 'stellar-forge.study-portfolio.v1', name: $('portfolio-name').value,
    geographies: state.geographies.map(({ rows, ...geo }) => geo),
    measures: [...state.selectedMeasures].map(key => { const [family, measure_id] = JSON.parse(key); return { family, measure_id }; }) };
}
async function load() {
  const [data, catalog, fields, template] = await Promise.all([
    api('status'), api('catalog', { search: $('geo-search').value, offset: state.geoPage.offset, limit: 50 }),
    api('mapping.fields'), api('mapping.template'),
  ]);
  state.data = data;
  state.fields = fields;
  state.catalog = catalog;
  for (const item of catalog.measures) {
    const key = keyOf([item.family, item.measure_id]);
    state.availableUnits.set(key, {
      family: item.family, measure_id: item.measure_id, unit: item.unit,
      output_unit: item.unit, factor: '1', decimal_places: null,
    });
  }
  if (!state.columns.length) setColumns(template);
  renderAll();
  if (window.propertyResearch) await window.propertyResearch.load();
}
function renderAll() {
  $('workspace-path').textContent = state.data.workspace;
  $('metrics').replaceChildren(...[
    ['Sources', state.data.sources.length], ['Frozen portfolios', revisions('portfolio').length],
    ['Editions', state.data.editions.length], ['Comparisons', state.data.comparisons.length],
    ['Packages', state.data.exports.length],
  ].map(([label, count]) => h('div', { className: 'metric' }, h('strong', {}, count), h('span', {}, label))));
  $('overview-items').replaceChildren(table(['Edition', 'Selected rows', 'Mapping issues', 'Content identity'],
    state.data.editions.slice(0, 8).map(item => [item.label, item.counts.selected, item.counts.rows_with_mapping_issues,
      button(short(item.id), () => show('Frozen edition', item), true)])));
  $('events').replaceChildren(table(['Time', 'Operation', 'Reference', 'Details'], state.data.events.slice(0, 15).map(item => [
    item.time.slice(0, 19).replace('T', ' '), item.operation, short(item.reference), JSON.stringify(item.body),
  ])));
  $('source-list').replaceChildren(table(['Source', 'Capture', 'Rows', 'Original files', 'Inspect'], state.data.sources.map(item => [
    item.label, short(item.capture_id), item.rows, item.descriptor.files.length,
    button('Open inventory', () => show('Source inventory · ' + item.label, item, [
      button('Read observation records', async () => { $('sample-source').value = item.id; $('detail').close(); await readSamples(0); }),
    ]), true),
  ])));
  for (const id of ['sample-source', 'acquisition-source']) options(id, state.data.sources);
  for (const id of ['portfolio-load', 'edition-portfolio']) options(id, revisions('portfolio'));
  for (const id of ['mapping-load', 'edition-mapping']) options(id, revisions('mapping'));
  options('compare-baseline', state.data.editions, item => item.label, 'Initial edition — no baseline');
  options('compare-candidate', state.data.editions);
  for (const id of ['review-comparison', 'export-comparison']) options(id, state.data.comparisons, item => {
    const edition = state.data.editions.find(value => value.id === item.candidate_id);
    return (edition?.label || short(item.candidate_id)) + ' / ' + readable(item.mode);
  });
  const checked = new Set([...document.querySelectorAll('#edition-source-list input:checked')].map(node => node.value));
  $('edition-source-list').replaceChildren(...state.data.sources.map(item => h('label', { className: 'check-label' },
    h('input', { type: 'checkbox', value: item.id, checked: checked.has(item.id) }),
    h('span', {}, item.label, h('small', {}, item.rows + ' original observations · ' + short(item.capture_id))))));
  $('edition-list').replaceChildren(table(['Edition', 'Selected / outside scope', 'Mapping / scope issues', 'Inspect'],
    state.data.editions.map(item => [item.label, item.counts.selected + ' / ' + item.counts.outside_portfolio,
      item.counts.rows_with_mapping_issues + ' / ' + item.global_issues.length,
      button('Open edition', () => show('Frozen edition · ' + item.label, item), true)])));
  $('export-list').replaceChildren(table(['Package', 'Origin', 'Mapped rows', 'Excluded rows', 'Actions'], state.data.exports.map(item => [
    item.label, item.origin === 'received' ? 'Received' : 'Produced', item.rows, item.excluded_rows, h('div', { className: 'actions' },
      button('Verify', async () => show('Verified package', await api('export.verify', { directory: item.directory })), true),
      button('Download ZIP', async () => { await api('export.archive', { export_id: item.id }); await download({ kind: 'archive', id: item.id }, 'study-source-refresh-' + short(item.id) + '.zip'); })),
  ])));
  renderGeographies();
  renderPortfolio();
  renderMeasures();
  renderColumns();
  renderUnits();
}
function addGeography(item) {
  const key = keyOf([item.family, item.source_geography_id, item.source_geography_vintage]);
  if (!state.geographies.some(geo => keyOf([geo.family, geo.source_geography_id, geo.source_geography_vintage]) === key)) {
    state.geographies.push({ ...item, client_geography_id: item.source_geography_id, comparison_group: '', crosswalk_note: '' });
  }
}
function renderGeographies() {
  const catalog = state.catalog;
  state.geoPage.next = catalog.next;
  $('geo-table').replaceChildren(table(['Select', 'Family', 'Native geography', 'Definition edition', 'Basis', 'Name', 'Rows'],
    catalog.geographies.map(item => [button('Add', async () => { addGeography(item); renderPortfolio(); }, true),
      familyNames[item.family], item.source_geography_id, item.source_geography_vintage, item.geography_basis, item.display_name, item.rows])));
  $('geo-page').textContent = (catalog.offset + 1) + '–' + Math.min(catalog.offset + catalog.geographies.length, catalog.total) + ' of ' + catalog.total;
  $('geo-prev').disabled = catalog.offset === 0;
  $('geo-next').disabled = catalog.next === null;
}
function input(value, change, extra = {}) {
  return h('input', { value: value ?? '', oninput: event => change(event.target.value), ...extra });
}
function renderPortfolio() {
  $('portfolio-count').textContent = state.geographies.length + ' geography definitions selected';
  $('portfolio-table').replaceChildren(table(['Family / native geography', 'Definition edition', 'Receiving identifier', 'Comparison group', 'Crosswalk explanation', ''],
    state.geographies.map((geo, index) => [
      familyNames[geo.family] + ' / ' + geo.source_geography_id, geo.source_geography_vintage,
      input(geo.client_geography_id, value => { geo.client_geography_id = value; }),
      input(geo.comparison_group, value => { geo.comparison_group = value; }),
      h('textarea', { value: geo.crosswalk_note, rows: 2, oninput: event => { geo.crosswalk_note = event.target.value; } }),
      button('Remove', async () => { state.geographies.splice(index, 1); renderPortfolio(); }, true),
    ])));
}
function renderMeasures() {
  $('measure-table').replaceChildren(table(['Select', 'Family', 'Measure', 'Native unit', 'Rows'],
    state.catalog.measures.map(item => {
      const key = keyOf([item.family, item.measure_id]);
      return [h('input', { type: 'checkbox', checked: state.selectedMeasures.has(key), onchange: event => {
        if (event.target.checked) state.selectedMeasures.add(key); else state.selectedMeasures.delete(key); renderUnits();
      } }), familyNames[item.family], item.measure_id, item.unit || 'Explicit mapping required', item.rows];
    })));
}
function selector(values, current, change) {
  const select = h('select', { onchange: event => change(event.target.value) },
    values.map(value => h('option', { value }, readable(value))));
  select.value = current;
  return select;
}
function renderColumns() {
  $('column-table').replaceChildren(table(['Key', 'Output column', 'Native field', 'Type', 'Null allowed', ''],
    state.columns.map((column, index) => [
      h('input', { type: 'checkbox', checked: column.key, onchange: event => { column.key = event.target.checked; } }),
      input(column.name, value => { column.name = value; }),
      selector(Object.keys(state.fields), column.field, value => { column.field = value; }),
      selector(['text', 'decimal', 'integer', 'json'], column.type, value => { column.type = value; }),
      h('input', { type: 'checkbox', checked: column.nullable, onchange: event => { column.nullable = event.target.checked; } }),
      button('Remove', async () => { state.columns.splice(index, 1); renderColumns(); }, true),
    ])));
}
function visibleUnits() {
  const query = $('unit-search').value.trim().toLowerCase();
  return [...new Map([...state.availableUnits, ...state.units]).values()].filter(rule => (!state.selectedMeasures.size || state.selectedMeasures.has(keyOf([rule.family, rule.measure_id]))) &&
    (rule.family + ' ' + rule.measure_id).toLowerCase().includes(query)).slice(0, 100);
}
function updateUnit(rule, changes) {
  const key = keyOf([rule.family, rule.measure_id]);
  state.units.set(key, { ...(state.units.get(key) || rule), ...changes });
}
function renderUnits() {
  const units = visibleUnits();
  $('unit-table').replaceChildren(h('p', { className: 'muted' }, 'Showing ' + units.length + ' measures. Filter to work through larger selections.'),
    table(['Family', 'Measure', 'Source unit', 'Output unit', 'Multiply by', 'Decimal places'],
      units.map(rule => [familyNames[rule.family], rule.measure_id,
        input(rule.unit, value => updateUnit(rule, { unit: value })),
        input(rule.output_unit, value => updateUnit(rule, { output_unit: value })),
        input(rule.factor, value => updateUnit(rule, { factor: value })),
        input(rule.decimal_places, value => updateUnit(rule, { decimal_places: value === '' ? null : Number(value) }), { type: 'number', min: 0, max: 18 }),
      ])));
}
async function geoPage(offset) {
  state.geoPage.offset = offset;
  state.catalog = await api('catalog', { search: $('geo-search').value, offset, limit: 50 });
  renderGeographies();
}
async function readSamples(offset) {
  const source_id = $('sample-source').value;
  if (!source_id) return;
  const result = await api('source.rows', { source_id, geography: $('sample-geo').value, measure: $('sample-measure').value, offset, limit: 25 });
  state.samplePage = { offset, next: result.next };
  $('sample-table').replaceChildren(table(['Family', 'Geography', 'Measure', 'Reference period', 'Raw value', 'Status', 'Record'],
    result.rows.map(row => [familyNames[row.source_family], row.source_geography_id, row.source_measure_id,
      row.reference_period.label, row.raw_value, JSON.stringify(row.status),
      button('Open', () => show('Original source observation', row, [
        button('Download source file', () => download({ kind: 'source', id: source_id, path: 'capture/' + row.source_locator.file }, PathName(row.source_locator.file))),
      ]), true)])));
  $('sample-page').textContent = (offset + 1) + '–' + Math.min(offset + result.rows.length, result.total) + ' of ' + result.total;
  $('sample-prev').disabled = offset === 0;
  $('sample-next').disabled = result.next === null;
}
function PathName(path) { return String(path).split('/').pop(); }
function rowLabel(rows) {
  if (!rows.length) return '—';
  const row = rows[0];
  return familyNames[row.source_family] + ' / ' + row.client_geography_id + ' / ' + row.source_measure_id +
    (rows.length > 1 ? ' (' + rows.length + ' rows)' : '');
}
function rawLabel(rows) { return rows.length ? rows.map(row => row.raw_value + (row.raw_moe === null ? '' : ' ± ' + row.raw_moe)).join('; ') : '—'; }
async function readComparison(offset = 0) {
  const comparison_id = $('review-comparison').value;
  if (!comparison_id) return;
  state.review = await api('comparison.read', { comparison_id, kind: $('review-kind').value, offset, limit: 25 });
  state.reviewPage = { offset, next: state.review.next };
  renderReview();
}
function renderReview() {
  const review = state.review;
  if (!review) return;
  $('review-summary').replaceChildren(
    h('div', { className: 'heading' }, h('h2', {}, readable(review.mode)), h('code', {}, short(review.id) + ' / review ' + review.review_version)),
    h('p', {}, review.period_note), h('p', {}, review.note),
    h('div', { className: 'inline' }, Object.entries(review.counts).map(([name, count]) => h('span', { className: 'badge' }, readable(name) + ': ' + count))),
    h('p', {}, 'Baseline rows: ' + review.before_rows + ' · Candidate rows: ' + review.after_rows + ' · Pending reviews: ' + review.pending),
    ...(review.global_issues.length ? [h('div', { className: 'issue' }, 'Update the frozen selection to resolve: ' + pretty(review.global_issues))] : []));
  $('review-table').replaceChildren(table(['Select', 'Change', 'Mapped identity', 'Period before → after', 'Raw before', 'Raw after', 'Delta', 'Review / reason', 'Inspect'],
    review.rows.map(row => [
      h('input', { type: 'checkbox', checked: state.selectedReview.has(row.key), onchange: event => {
        if (event.target.checked) state.selectedReview.add(row.key); else state.selectedReview.delete(row.key); renderSelectedReview();
      } }),
      h('span', { className: 'badge' }, row.kind), rowLabel(row.after.length ? row.after : row.before),
      (row.before[0]?.reference_period.label || '—') + ' → ' + (row.after[0]?.reference_period.label || '—'),
      rawLabel(row.before), rawLabel(row.after), row.delta === null ? '—' : row.delta,
      readable(row.decision.action) + (row.reasons.length ? ' · ' + row.reasons.map(readable).join(', ') : ''),
      button('Open', () => {
        const current = row.after[0] || row.before[0];
        const eid = row.after.length ? review.candidate_id : review.baseline_id;
        return show('Comparison record', row, current ? [
          button('Read original row', async () => {
            const original = await api('observation.read', { edition_id: eid, row_id: current.row_id });
            show('Native provider row and retained interpretation', original, [
              button('Download original source', () => download({ kind: 'source', id: original.source_id, path: 'capture/' + current.source_locator.file }, PathName(current.source_locator.file))),
            ]);
          }),
        ] : []);
      }, true),
    ])));
  $('review-page').textContent = (review.offset + 1) + '–' + Math.min(review.offset + review.rows.length, review.total) + ' of ' + review.total;
  $('review-prev').disabled = review.offset === 0;
  $('review-next').disabled = review.next === null;
  renderSelectedReview();
}
function renderSelectedReview() {
  $('review-selected').textContent = state.selectedReview.size + ' immutable comparison records selected';
}
async function saveReview(action) {
  if (!state.review) throw new Error('Select a comparison.');
  if (!state.selectedReview.size) throw new Error('Select records for review.');
  await api('review.apply', {
    comparison_id: state.review.id, keys: [...state.selectedReview], action,
    operator: $('review-operator').value, note: $('review-note').value,
    expected_version: state.review.review_version,
  });
  state.selectedReview.clear();
  await readComparison(state.reviewPage.offset);
  await load();
}
async function download(parameters, filename) {
  const response = await fetch('/download?' + new URLSearchParams(parameters), { headers: { Authorization: 'Bearer ' + state.token } });
  if (!response.ok) {
    const result = await response.json();
    throw new Error(readable(result.code));
  }
  const url = URL.createObjectURL(await response.blob()), link = h('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

for (const element of document.querySelectorAll('nav button')) element.onclick = () => view(element.dataset.view);
$('detail-close').onclick = () => $('detail').close();
$('refresh').onclick = () => run('Refresh workspace', async () => { await load(); if (state.review) await readComparison(state.reviewPage.offset); });
$('source-form').onsubmit = event => {
  event.preventDefault(); const args = Object.fromEntries(new FormData(event.target));
  run('Import original source', async () => { const result = await api('source.import', args); await load(); show('Retained source edition', result); });
};
$('acquisition-form').onsubmit = event => {
  event.preventDefault(); const values = Object.fromEntries(new FormData(event.target));
  const args = values.format === 'scan' ? { scan_file: values.session } : { checkout: state.data.checkout, session: values.session };
  const operation = values.format === 'scan' ? 'source.receive_scan' : values.mode === 'files' ? 'source.receive_files' : 'source.receive_rows';
  if (values.mode === 'files') args.provider = values.provider;
  else { args.source_id = values.source_id; args.projection = values.projection; }
  run('Receive completed original acquisition', async () => { const result = await api(operation, args); await load(); show('Received original delivery', result); });
};
$('sample-form').onsubmit = event => { event.preventDefault(); run('Read original records', () => readSamples(0)); };
$('sample-prev').onclick = () => run('Read previous records', () => readSamples(Math.max(0, state.samplePage.offset - 25)));
$('sample-next').onclick = () => run('Read next records', () => readSamples(state.samplePage.next));
$('geo-filter').onsubmit = event => { event.preventDefault(); run('Find source geographies', () => geoPage(0)); };
$('geo-prev').onclick = () => run('Read previous geographies', () => geoPage(Math.max(0, state.geoPage.offset - 50)));
$('geo-next').onclick = () => run('Read next geographies', () => geoPage(state.geoPage.next));
$('geo-add-page').onclick = () => { state.catalog.geographies.forEach(addGeography); renderPortfolio(); };
$('clear-portfolio').onclick = () => { state.geographies = []; state.selectedMeasures.clear(); renderPortfolio(); renderMeasures(); renderUnits(); };
$('load-portfolio').onclick = () => run('Load portfolio draft', async () => {
  const selected = revisions('portfolio').find(value => value.id === $('portfolio-load').value);
  if (!selected) throw new Error('Choose a frozen portfolio.');
  $('portfolio-name').value = selected.name;
  state.geographies = structuredClone(selected.geographies);
  state.selectedMeasures = new Set(selected.measures.map(item => keyOf([item.family, item.measure_id])));
  renderPortfolio(); renderMeasures(); renderUnits();
});
$('freeze-portfolio').onclick = () => run('Freeze portfolio', async () => {
  const result = await api('portfolio.freeze', { value: portfolioDraft() });
  await load(); $('edition-portfolio').value = result.id; show('Frozen portfolio', result);
});
$('default-mapping').onclick = () => run('Load canonical export template', async () => setColumns(await api('mapping.template')));
$('load-mapping').onclick = () => run('Load export mapping', async () => {
  const selected = revisions('mapping').find(value => value.id === $('mapping-load').value);
  if (!selected) throw new Error('Choose a frozen mapping.');
  setColumns(selected);
});
$('add-column').onclick = () => { state.columns.push({ name: 'field_' + (state.columns.length + 1), field: 'raw_value', type: 'text', nullable: false, key: false }); renderColumns(); };
$('unit-search').oninput = renderUnits;
$('set-unit').onclick = () => {
  const value = $('bulk-unit').value.trim();
  if (!value) return notice('Enter an explicit unit for the displayed measures.', true);
  for (const rule of visibleUnits()) updateUnit(rule, { unit: value, output_unit: value, factor: '1' });
  renderUnits();
};
$('freeze-mapping').onclick = () => run('Freeze export mapping', async () => {
  const result = await api('mapping.freeze', { value: mappingDraft() });
  await load(); $('edition-mapping').value = result.id; $('mapping-result').textContent = 'Frozen ' + short(result.id); show('Frozen export mapping', result);
});
$('edition-form').onsubmit = event => {
  event.preventDefault();
  const args = { label: new FormData(event.target).get('label'),
    source_ids: [...document.querySelectorAll('#edition-source-list input:checked')].map(input => input.value),
    portfolio_id: $('edition-portfolio').value, mapping_id: $('edition-mapping').value };
  run('Freeze selected edition', async () => { const result = await api('edition.freeze', args); await load(); $('compare-candidate').value = result.id; show('Frozen edition', result); });
};
$('comparison-form').onsubmit = event => {
  event.preventDefault();
  const args = { ...Object.fromEntries(new FormData(event.target)), candidate_id: $('compare-candidate').value,
    baseline_id: $('compare-baseline').value || null };
  run('Create retained comparison', async () => {
    const result = await api('comparison.create', args); await load();
    $('review-comparison').value = result.id; $('export-comparison').value = result.id;
    state.selectedReview.clear(); await readComparison(0); view('review');
  });
};
$('review-comparison').onchange = () => run('Read comparison', async () => { state.selectedReview.clear(); await readComparison(0); });
$('review-kind').onchange = () => run('Read comparison selection', () => readComparison(0));
$('review-prev').onclick = () => run('Read previous differences', () => readComparison(Math.max(0, state.reviewPage.offset - 25)));
$('review-next').onclick = () => run('Read next differences', () => readComparison(state.reviewPage.next));
$('select-review-page').onclick = () => { for (const row of state.review?.rows || []) state.selectedReview.add(row.key); renderReview(); };
$('select-review-kind').onclick = () => run('Select matching comparison records', async () => {
  if (!state.review) throw new Error('Choose a comparison.');
  const keys = await api('review.keys', { comparison_id: state.review.id, kind: $('review-kind').value });
  keys.forEach(key => state.selectedReview.add(key)); renderReview();
});
$('clear-review').onclick = () => { state.selectedReview.clear(); if (state.review) renderReview(); };
$('review-accept').onclick = () => run('Save acceptance decisions', () => saveReview('accept'));
$('review-exclude').onclick = () => run('Save exclusion decisions', () => saveReview('exclude'));
$('export-form').onsubmit = event => {
  event.preventDefault();
  const args = Object.fromEntries(new FormData(event.target));
  run('Create complete retained package', async () => {
    const comparison_id = $('export-comparison').value;
    const review = await api('comparison.read', { comparison_id, limit: 1 });
    const result = await api('export.create', { ...args, comparison_id, expected_version: review.review_version });
    await load(); show('Retained delivery package', result);
  });
};
$('receive-form').onsubmit = event => {
  event.preventDefault();
  run('Import retained study package', async () => {
    const result = await api('package.import', Object.fromEntries(new FormData(event.target)));
    await load();
    if (result.selection && window.propertyResearch) await window.propertyResearch.received(result.selection);
    else { $('review-comparison').value = result.comparison.id; await readComparison(0); show('Reopened source and review state', result); }
  });
};
$('upload-form').onsubmit = event => {
  event.preventDefault();
  run('Receive retained ZIP package', async () => {
    const file = $('package-zip').files[0];
    if (!file) throw new Error('Choose a package ZIP.');
    const response = await fetch('/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + state.token, 'Content-Type': 'application/zip' }, body: file });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(readable(result.code) + ' ' + JSON.stringify(result.details || {}));
    await load();
    if (result.result.selection && window.propertyResearch) await window.propertyResearch.received(result.result.selection);
    else { $('review-comparison').value = result.result.comparison.id; await readComparison(0); show('Received retained ZIP', result.result); }
  });
};
async function connect() {
  if (!state.token) { $('connect').hidden = false; $('shell').hidden = true; return; }
  $('connect').hidden = true; $('shell').hidden = false;
  const result = await run('Open retained workspace', async () => { await load(); return true; });
  if (!result) { $('connect').hidden = false; $('shell').hidden = true; }
}
$('connect-button').onclick = () => {
  state.token = $('token').value.trim();
  sessionStorage.setItem('study-operator-token', state.token);
  $('token').value = '';
  connect();
};
const fragment = location.hash.slice(1);
if (/^[A-Za-z0-9_-]{40,}$/.test(fragment)) {
  state.token = fragment;
  sessionStorage.setItem('study-operator-token', fragment);
  history.replaceState(null, '', location.pathname + location.search);
}
connect();
