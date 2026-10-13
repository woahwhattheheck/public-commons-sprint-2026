/** Regional watershed desk for the existing Upper Savannah operator. */
const esc = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const human = value => String(value ?? '').replace(/_/g, ' ');
const number = (value, digits = 0) => value === null || value === undefined ||
  !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString(undefined, {maximumFractionDigits: digits});
const list = value => Array.isArray(value) ? value : [];
const sum = (rows, key) => rows.reduce((total, row) => total + (Number.isFinite(Number(row[key])) ? Number(row[key]) : 0), 0);
const option = (value, label, chosen) => '<option value="' + esc(value) + '"' +
  (String(chosen) === String(value) ? ' selected' : '') + '>' + esc(label) + '</option>';
const metric = (value, label) => '<div class="wc-metric"><strong>' + esc(value) + '</strong><span>' + esc(label) + '</span></div>';
const field = (label, input) => '<label><span>' + esc(label) + '</span>' + input + '</label>';
const pretty = value => JSON.stringify(value, null, 2);
const safeUrl = value => {
  try {
    const url = new URL(String(value));
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch (_) { return null; }
};

export function filterWatersheds(rows, filters = {}) {
  const needle = String(filters.search || '').trim().toLocaleLowerCase();
  return list(rows).filter(row =>
    (!needle || [row.huc12, row.name, row.huc8, ...list(row.states)].join(' ').toLocaleLowerCase().includes(needle)) &&
    (!filters.huc8 || row.huc8 === filters.huc8) &&
    (!filters.state || list(row.states).includes(filters.state)) &&
    (!filters.priority || (filters.priority === 'yes') === Boolean(row.priority)) &&
    (!filters.classification || list(row.selected_classes).includes(filters.classification)) &&
    (!filters.coverage || row.classification_coverage === filters.coverage)
  );
}

export function createWatershedContextDesk(host) {
  const document = host.document || globalThis.document;
  let root = null, listeners = null, epoch = 0, workspace = null;
  let catalog = null, saved = null, selectedId = '', focusHuc = '';
  let savedExport = null, selectedExportId = '', selectedHucs = [], selectionRequest = 0, catalogRequest = 0;
  let lastTaskSignature = '', busy = false, errorText = '', reportRequest = 0;
  let filters = emptyFilters();
  const currentWorkspace = () => host.getState()?.workspace_key ?? host.getWorkspace?.() ?? null;
  const rows = () => list(saved?.report?.hucs);
  const filtered = () => {
    const matching = filterWatersheds(rows(), filters);
    if (!selectedExportId) return matching;
    const membership = new Set(selectedHucs);
    return matching.filter(row => membership.has(row.huc12));
  };
  const selectedSource = () => {
    const select = root?.querySelector('[name="wc-source"]');
    return catalog?.sources?.[Number(select?.value || 0)];
  };
  function emptyFilters() { return {search:'', huc8:'', state:'', priority:'', classification:'', coverage:''}; }
  function remember() {
    if (!workspace) return;
    try {
      globalThis.sessionStorage?.setItem('upstate-watershed-context:' + workspace, JSON.stringify({
        report_id:selectedId, export_id:selectedExportId, focus_huc:focusHuc, filters,
      }));
    } catch (_) {}
  }
  function clearSelection() {
    savedExport = null;
    selectedExportId = '';
    selectedHucs = [];
  }
  function resetForWorkspace(key) {
    if (workspace === key) return;
    workspace = key;
    catalog = null;
    saved = null;
    selectedId = '';
    focusHuc = '';
    filters = emptyFilters();
    clearSelection();
    selectionRequest += 1;
    reportRequest += 1;
    lastTaskSignature = '';
    errorText = '';
    try {
      const stored = globalThis.sessionStorage?.getItem('upstate-watershed-context:' + workspace) || '';
      if (stored.startsWith('{')) {
        const previous = JSON.parse(stored);
        selectedId = typeof previous.report_id === 'string' ? previous.report_id : '';
        selectedExportId = typeof previous.export_id === 'string' ? previous.export_id : '';
        focusHuc = typeof previous.focus_huc === 'string' ? previous.focus_huc : '';
        for (const name of Object.keys(filters)) {
          if (typeof previous.filters?.[name] === 'string') filters[name] = previous.filters[name];
        }
      } else selectedId = stored;
    } catch (_) {}
  }
  function url(path, params = {}) {
    const query = new URLSearchParams({...params, workspace:String(workspace || '')});
    return path + '?' + query.toString();
  }
  async function read(operation, params = {}) {
    return host.api(url('/api/watershed-context/' + operation, params));
  }
  function fail(error) {
    errorText = error?.message || String(error);
    if (root) {
      const node = root.querySelector('[data-wc-status]');
      if (node) {
        node.textContent = errorText;
        node.hidden = false;
        node.setAttribute('role', 'alert');
      }
    }
    host.toast?.(errorText);
  }
  function guard(version, key) { return Boolean(root) && version === epoch && key === currentWorkspace(); }
  function downloadsHtml(downloads) {
    if (typeof host.fileList === 'function') return host.fileList(downloads || []);
    return list(downloads).map(file => {
      const href = String(file.url || file.href || '');
      if (!href.startsWith('/api/') && !safeUrl(href)) return '';
      return '<a href="' + esc(href) + '">' + esc(file.title || file.name || file.path || 'Download') + '</a>';
    }).join(' ');
  }
  function taskSignature(state) {
    return list(state?.tasks).filter(task => task.action?.startsWith('watershed.context.'))
      .map(task => task.id + ':' + task.state).join('|');
  }
  function taskHtml() {
    const tasks = list(host.getState()?.tasks).filter(task =>
      task.action?.startsWith('watershed.context.') &&
      ['queued', 'running', 'failed', 'interrupted'].includes(task.state));
    if (!tasks.length) return '';
    return '<section class="wc-task-list" aria-label="Regional operations">' + tasks.map(task =>
      '<button type="button" data-wc-task="' + esc(task.id) + '">' +
      esc(task.action === 'watershed.context.export' ? 'Export watershed selection' : 'Build regional context') +
      ' · ' + esc(human(task.state)) + '</button>').join('') + '</section>';
  }
  function sourceHtml() {
    const choices = list(catalog?.sources);
    if (!choices.length) return '<p class="wc-note">Register the regional source edition in Prepare study inputs to build a watershed report.</p>';
    return '<div class="wc-source-form">' + field('Regional source edition',
      '<select name="wc-source">' + choices.map((source, index) =>
        option(index, source.title || source.member_path, 0)).join('') + '</select>') +
      '<button type="button" data-wc-build' + (busy ? ' disabled' : '') + '>Build regional context</button>' +
      '<p class="wc-note">Use the retained watershed context and complete classification query from the same original source edition.</p></div>';
  }
  function reportSelector() {
    const reports = list(catalog?.reports);
    if (!reports.length) return '';
    return field('Saved regional report', '<select name="wc-report">' +
      reports.map(report => option(report.id,
        (report.title || 'Regional watershed context') + ' / ' + String(report.created_at || '').slice(0, 16).replace('T', ' '),
        selectedId)).join('') + '</select>');
  }
  function selectionSelector() {
    const exports = list(catalog?.exports);
    if (!exports.length) return '';
    return field('Saved watershed selection', '<select name="wc-selection">' +
      option('', 'Full regional report', selectedExportId) +
      exports.map(record => {
        const count = Number(record.watershed_count || list(record.huc12s).length);
        const label = number(count) + (count === 1 ? ' watershed' : ' watersheds') +
          (count === 1 ? ' / ' + list(record.huc12s)[0] : '') + ' / ' +
          String(record.created_at || '').slice(0, 16).replace('T', ' ');
        return option(record.id, label, selectedExportId);
      }).join('') + '</select>');
  }
  function selectionDownloads() {
    if (!savedExport) return '';
    return '<section class="wc-downloads"><h2>Saved watershed selection</h2>' +
      '<p>' + esc(number(selectedHucs.length)) +
      (selectedHucs.length === 1 ? ' watershed is' : ' watersheds are') +
      ' retained in this selection. Additional table filters refine the view; these downloads contain the complete saved selection.</p>' +
      downloadsHtml(savedExport._downloads) +
      '<details><summary>Selected HUC12s and saved report</summary><pre>' +
      esc(pretty({huc12s:selectedHucs, report_id:savedExport.report_id,
        report_sha256:savedExport.report_sha256, source_fingerprint:savedExport.source_fingerprint})) +
      '</pre></details></section>';
  }
  function coverageHtml(report) {
    const coverage = report.classification_coverage || {};
    const completed = coverage.complete_domain_query === true;
    const fetched = coverage.membership_source?.unique_ids ?? coverage.membership_source?.count ?? coverage.selected_feature_count;
    const extra = coverage.additional_huc8_response;
    let text = completed
      ? 'The complete selected-class query covers every watershed in this model domain.'
      : 'Query coverage is recorded with this source edition; inspect its source detail for the captured extent.';
    if (fetched !== undefined) text += ' The response contains ' + number(fetched) + ' unique classified-water records.';
    if (extra && extra.count === 0 && list(extra.huc8).length)
      text += ' HUC8 areas ' + extra.huc8.join(', ') + ' returned zero records for the selected classes.';
    return '<section class="wc-coverage"><h2>Source coverage</h2><p>' + esc(text) +
      '</p><p class="wc-note">Selected source classes: ' + esc(list(coverage.selected_classes).join(', ') || 'See retained query') + '. Reach counts use the publisher’s HUC12 attributes. The receiving-water workflow calculates geometric intersections and upstream contributing areas from the original drainage network.</p>' +
      '<details><summary>Classification query and source scope</summary><pre>' + esc(pretty(coverage)) + '</pre></details></section>';
  }
  function filtersHtml() {
    const all = rows();
    const huc8s = [...new Set(all.map(row => row.huc8).filter(Boolean))].sort();
    const states = [...new Set(all.flatMap(row => list(row.states)))].sort();
    const classes = [...new Set([...list(saved?.report?.classification_coverage?.selected_classes), ...all.flatMap(row => list(row.selected_classes))])].sort();
    const coverage = [...new Set(all.map(row => row.classification_coverage).filter(Boolean))].sort();
    const select = (name, options, empty) => '<select name="wc-' + name + '">' + option('', empty, filters[name]) +
      options.map(([value, label]) => option(value, label, filters[name])).join('') + '</select>';
    return '<div class="wc-filters">' +
      field('Find a watershed', '<input type="search" name="wc-search" value="' + esc(filters.search) + '" placeholder="Watershed name or HUC12">') +
      field('HUC8 basin', select('huc8', huc8s.map(value => [value, value]), 'All basins')) +
      field('State', select('state', states.map(value => [value, value]), 'All states')) +
      field('NRCS priority (any state)', select('priority', [['yes','Priority watersheds'], ['no','Other model watersheds']], 'All priorities')) +
      field('Selected source class', select('classification', classes.map(value => [value, value]), 'All classes')) +
      field('Classification coverage', select('coverage', coverage.map(value => [value, human(value)]), 'All coverage')) +
      '</div>';
  }
  function render() {
    if (!root) return;
    const report = saved?.report;
    const all = rows();
    root.innerHTML = '<div class="wc-desk"><header class="wc-heading"><div><p class="wc-eyebrow">UPPER SAVANNAH WATERSHED WORKSPACE</p>' +
      '<h1>Regional watershed context</h1><p>Review watershed coverage, drinking-water priorities, and the original classified-water records across the full model domain.</p></div>' +
      '<div class="wc-actions"><button type="button" data-wc-refresh>Refresh reports</button><button type="button" data-wc-receiving>Open receiving waters</button></div></header>' +
      '<p data-wc-status class="wc-status" aria-live="polite"' + (errorText ? '' : ' hidden') + '>' + esc(errorText) + '</p>' +
      '<div data-wc-tasks>' + taskHtml() + '</div>' +
      '<section class="wc-report-controls">' + reportSelector() + selectionSelector() +
      '<details' + (report ? '' : ' open') + '><summary>Build from a regional source edition</summary>' + sourceHtml() + '</details></section>' +
      (report ? '<section class="wc-metrics" aria-label="Full model domain">' +
        metric(number(all.length), 'Model watersheds') +
        metric(number(sum(all, 'area_km2'), 1), 'Unique watershed area · km²') +
        metric(number(all.filter(row => row.priority).length), 'NRCS priority watersheds') +
        metric(number(sum(all, 'selected_classification_count')), 'Selected-class reach records') +
        '</section>' + coverageHtml(report) +
        '<section class="wc-watersheds"><header class="wc-section-heading"><h2>Watersheds</h2>' +
        '<div class="wc-actions"><button type="button" data-wc-clear>' + (selectedExportId ? 'Show all watersheds' : 'Clear filters') + '</button><button type="button" data-wc-export>Export matching watersheds</button></div></header>' +
        filtersHtml() + '<p data-wc-count class="wc-note" aria-live="polite"></p>' +
        '<div class="wc-table-scroll"><table><thead><tr>' +
        ['Watershed', 'HUC8 / states', 'Area km²', 'NRCS priority', 'Selected reaches', 'Source classes', 'Coverage', ''].map(label => '<th scope="col">' + esc(label) + '</th>').join('') +
        '</tr></thead><tbody data-wc-rows></tbody></table></div></section>' +
        '<section data-wc-detail class="wc-detail" tabindex="-1" aria-label="Watershed detail"></section>' +
        selectionDownloads() + '<section class="wc-downloads"><h2>Regional report and original sources</h2>' +
        '<p class="wc-note">The saved report includes source references and exact source-byte hashes. Selection exports preserve the same report identity.</p>' +
        downloadsHtml(saved._downloads) +
        '<details><summary>Methods and retained source identity</summary><pre>' +
        esc(pretty({methods:report.methods, sources:report.sources, source_inputs:saved.source_inputs, source_fingerprint:saved.source_fingerprint})) +
        '</pre></details></section>'
      : '<section class="wc-empty"><h2>' + (catalog ? 'Build the regional watershed context' : 'Opening regional reports…') +
        '</h2><p>Choose a retained source edition above. The result remains in this scientific workspace and appears in the existing task history.</p></section>') +
      '</div>';
    if (report) { renderRows(); renderDetail(); }
  }
  function renderRows() {
    const node = root?.querySelector('[data-wc-rows]');
    if (!node) return;
    const matching = filtered();
    root.querySelector('[data-wc-count]').textContent = (selectedExportId ? 'Saved selection · ' : '') + number(matching.length) + ' of ' + number(rows().length) +
      ' watersheds · ' + number(sum(matching, 'area_km2'), 1) + ' whole-watershed km² · ' +
      number(matching.filter(row => row.priority).length) + ' NRCS priority watersheds';
    node.innerHTML = matching.length ? matching.map(row =>
      '<tr' + (row.huc12 === focusHuc ? ' class="wc-active-row"' : '') + '><th scope="row"><strong>' + esc(row.name || row.huc12) +
      '</strong><small>' + esc(row.huc12) + '</small></th><td>' + esc(row.huc8) + '<small>' + esc(list(row.states).join(' / ')) +
      '</small></td><td class="wc-number">' + esc(number(row.area_km2, 2)) + '</td><td>' +
      (row.priority ? '<span class="wc-tag">Priority</span><small>' + esc(list(row.priority_states).join(' / ')) + '</small>' : '—') +
      '</td><td class="wc-number">' + esc(number(row.selected_classification_count)) + '</td><td>' +
      esc(list(row.selected_classes).join(', ') || '—') + '</td><td>' + esc(human(row.classification_coverage)) +
      '</td><td><button type="button" data-wc-huc="' + esc(row.huc12) + '" aria-label="Open ' +
      esc(row.name || row.huc12) + '">Details</button></td></tr>'
    ).join('') : '<tr><td colspan="8" class="wc-empty-cell">No watersheds match these filters.</td></tr>';
    root.querySelector('[data-wc-export]').disabled = busy || matching.length === 0;
  }
  function sourceReferences(references) {
    return list(references).map(reference => {
      if (typeof reference === 'string') {
        const href = safeUrl(reference);
        return '<li>' + (href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' +
          esc(reference) + '</a>' : esc(reference)) + '</li>';
      }
      const href = safeUrl(reference.url || reference.reference);
      const label = reference.title || reference.source_id || reference.reference || 'Original source record';
      return '<li>' + (href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' +
        esc(label) + '</a>' : esc(label)) + '<pre>' + esc(pretty(reference)) + '</pre></li>';
    }).join('');
  }
  function renderDetail() {
    const node = root?.querySelector('[data-wc-detail]');
    if (!node) return;
    const row = rows().find(row => row.huc12 === focusHuc);
    if (!row) {
      node.innerHTML = '<h2>Watershed detail</h2><p class="wc-note">Open a watershed to review the original state rows, priority reasons, classified-water assignments, and source references.</p>';
      return;
    }
    const reasons = list(row.priority_reasons);
    const classCounts = row.class_counts || {};
    const stateAreas = row.state_portions_acres || {};
    node.innerHTML = '<header class="wc-section-heading"><div><p class="wc-eyebrow">' + esc(row.huc12) +
      ' / ' + esc(row.huc8) + '</p><h2>' + esc(row.name || row.huc12) + '</h2></div><button type="button" data-wc-export-one="' +
      esc(row.huc12) + '">Export this watershed</button></header>' +
      '<dl class="wc-facts"><div><dt>States</dt><dd>' + esc(list(row.states).join(' / ')) +
      '</dd></div><div><dt>Watershed area</dt><dd>' + esc(number(row.area_km2, 2)) + ' km² / ' + esc(number(row.area_acres, 1)) +
      ' acres</dd></div><div><dt>Model role</dt><dd>' + esc(human(row.role || 'model_domain')) +
      '</dd></div><div><dt>NRCS priority</dt><dd>' + esc(row.priority ? 'Priority in ' + list(row.priority_states).join(', ') : 'No priority flag in these source rows') +
      '</dd></div><div><dt>Downstream watershed</dt><dd>' + (row.downstream_huc12 ?
        '<button type="button" data-wc-huc="' + esc(row.downstream_huc12) + '">' + esc(row.downstream_huc12) + '</button>' :
        'No original downstream attribute supplied') +
      '</dd></div><div><dt>Reach assignment</dt><dd>' + esc(human(row.classification_assignment || 'publisher_huc12_attribute')) +
      '</dd></div></dl>' +
      '<div class="wc-detail-grid"><section><h3>Priority reasons</h3>' +
      (reasons.length ? '<ul>' + reasons.map(reason => '<li>' + esc(typeof reason === 'string' ? reason : pretty(reason)) + '</li>').join('') + '</ul>' :
        '<p class="wc-note">The source contains no priority reason for this watershed.</p>') +
      '<h3>Original state area records</h3><p class="wc-note">The regional total counts each watershed once. State rows retain their original area values.</p><dl class="wc-class-counts">' + Object.entries(stateAreas).map(([state, acres]) => '<div><dt>' + esc(state) + '</dt><dd>' + esc(number(acres, 1)) + ' acres</dd></div>').join('') + '</dl></section>' +
      '<section><h3>Classified-water source</h3><p>' + esc(number(row.selected_classification_count)) +
      ' selected-class reach records · ' + esc(human(row.classification_coverage)) + '</p>' +
      '<dl class="wc-class-counts">' + Object.entries(classCounts).map(([key, count]) =>
        '<div><dt>' + esc(key) + '</dt><dd>' + esc(number(count)) + '</dd></div>').join('') +
      '</dl><p class="wc-note">Jurisdiction: ' + esc(human(row.classification_scope)) + '. Source classes: ' +
      esc(list(row.selected_classes).join(', ') || 'No selected class records') + '.</p></section></div>' +
      '<details><summary>Original NRCS state rows</summary><pre>' + esc(pretty(row.nrcs_state_rows || [])) + '</pre></details>' +
      '<details><summary>Original watershed and source references</summary><ul class="wc-source-references">' +
      sourceReferences(row.source_references) + '</ul><pre>' + esc(pretty(row)) + '</pre></details>';
  }
  async function loadReport(id, version = epoch) {
    const key = workspace, request = ++reportRequest;
    const result = await read('report', {report_id:id});
    if (!guard(version, key) || request !== reportRequest) return;
    if (savedExport && savedExport.report_id !== result.id) clearSelection();
    saved = result;
    selectedId = result.id;
    errorText = '';
    if (!rows().some(row => row.huc12 === focusHuc)) focusHuc = '';
    remember();
    render();
    return result;
  }
  async function loadExport(id, version = epoch, preserveFilters = false) {
    const key = workspace, request = ++selectionRequest, reportToken = ++reportRequest;
    const result = await read('export', {export_id:id});
    if (!guard(version, key) || request !== selectionRequest || reportToken !== reportRequest) return;
    const loaded = await read('report', {report_id:result.report_id});
    if (!guard(version, key) || request !== selectionRequest || reportToken !== reportRequest) return;
    if (loaded.id !== result.report_id ||
        loaded.files?.['watershed-context.json']?.sha256 !== result.report_sha256)
      throw new Error('The saved selection belongs to different regional report bytes.');
    const chosen = list(result.huc12s);
    const available = new Set(list(loaded.report?.hucs).map(row => row.huc12));
    if (!chosen.length || chosen.some(huc => typeof huc !== 'string' || !available.has(huc)))
      throw new Error('The saved selection contains an unavailable watershed.');
    saved = loaded;
    selectedId = loaded.id;
    savedExport = result;
    selectedExportId = result.id;
    selectedHucs = [...new Set(chosen)].sort();
    if (!preserveFilters) { filters = emptyFilters(); focusHuc = ''; }
    if (!available.has(focusHuc) || !selectedHucs.includes(focusHuc))
      focusHuc = selectedHucs.length === 1 ? selectedHucs[0] : '';
    errorText = '';
    remember();
    render();
  }
  async function refresh() {
    const version = epoch, key = workspace, request = ++catalogRequest, selectionToken = selectionRequest;
    try {
      const result = await read('catalog');
      if (!guard(version, key) || request !== catalogRequest) return;
      catalog = result;
      if (selectionToken !== selectionRequest) { render(); return; }
      const reports = list(catalog.reports);
      const retained = list(catalog.exports).find(record => record.id === selectedExportId &&
        reports.some(report => report.id === record.report_id));
      if (retained) await loadExport(retained.id, version, true);
      else {
        clearSelection();
        if (!reports.some(report => report.id === selectedId)) selectedId = reports[0]?.id || '';
        if (selectedId) await loadReport(selectedId, version);
        else { saved = null; remember(); render(); }
      }
    } catch (error) { if (guard(version, key)) fail(error); }
  }
  async function build() {
    if (busy) return;
    const source = selectedSource();
    if (!source) throw new Error('Choose a registered regional source edition.');
    const selection = {...source};
    delete selection.title;
    busy = true;
    const button = root?.querySelector('[data-wc-build]');
    if (button) button.disabled = true;
    try {
      await host.submitAction('watershed.context.analyze', {selection, title:'Regional watershed context'});
      await host.refresh?.({force:true});
      if (root) await refresh();
    } finally { busy = false; if (root) { const node = root.querySelector('[data-wc-build]'); if (node) node.disabled = false; renderRows(); } }
  }
  async function exportRows(huc12s) {
    if (busy) return;
    if (!saved || !huc12s.length) throw new Error('Choose watershed records to export.');
    busy = true;
    renderRows();
    try {
      await host.submitAction('watershed.context.export', {report_id:saved.id, huc12s});
      await host.refresh?.({force:true});
      if (root) await refresh();
    } finally { busy = false; if (root) renderRows(); }
  }
  async function click(event) {
    const button = event.target.closest('button');
    if (!button || !root?.contains(button)) return;
    try {
      if (button.hasAttribute('data-wc-refresh')) return refresh();
      if (button.hasAttribute('data-wc-build')) return await build();
      if (button.hasAttribute('data-wc-receiving')) return await host.navigate?.('receiving-waters');
      if (button.hasAttribute('data-wc-clear')) {
        selectionRequest += 1;
        reportRequest += 1;
        clearSelection();
        filters = emptyFilters();
        remember();
        render();
        return;
      }
      if (button.hasAttribute('data-wc-export')) return await exportRows(filtered().map(row => row.huc12));
      if (button.dataset.wcExportOne) return await exportRows([button.dataset.wcExportOne]);
      if (button.dataset.wcTask) return host.showTask?.(button.dataset.wcTask);
      if (button.dataset.wcHuc) {
        if (!rows().some(row => row.huc12 === button.dataset.wcHuc))
          throw new Error('This downstream watershed is outside the retained model domain.');
        focusHuc = button.dataset.wcHuc;
        if (selectedExportId && !selectedHucs.includes(focusHuc)) {
          selectionRequest += 1;
          clearSelection();
          filters = emptyFilters();
        }
        remember();
        render();
        root.querySelector('[data-wc-detail]')?.focus({preventScroll:true});
        root.querySelector('[data-wc-detail]')?.scrollIntoView({block:'nearest', behavior:'smooth'});
      }
    } catch (error) { fail(error); }
  }
  function input(event) {
    const name = event.target.name;
    if (!name?.startsWith('wc-')) return;
    const key = name.slice(3);
    if (key in filters) { filters[key] = event.target.value; remember(); renderRows(); }
    else if (key === 'selection') {
      if (event.target.value) loadExport(event.target.value).catch(fail);
      else {
        selectionRequest += 1;
        reportRequest += 1;
        clearSelection();
        filters = emptyFilters();
        remember();
        render();
      }
    } else if (key === 'report') {
      selectionRequest += 1;
      clearSelection();
      focusHuc = '';
      filters = emptyFilters();
      loadReport(event.target.value).catch(fail);
    }
  }
  async function mount(node, state = host.getState()) {
    detach();
    resetForWorkspace(state?.workspace_key ?? currentWorkspace());
    root = node;
    listeners = new AbortController();
    root.addEventListener('click', click, {signal:listeners.signal});
    root.addEventListener('input', input, {signal:listeners.signal});
    lastTaskSignature = taskSignature(state);
    render();
    await refresh();
  }
  function update(state = host.getState()) {
    if (state?.workspace_key !== workspace) {
      if (root) detach();
      resetForWorkspace(state?.workspace_key);
      return;
    }
    if (!root) return;
    const signature = taskSignature(state);
    if (signature !== lastTaskSignature) {
      lastTaskSignature = signature;
      const node = root.querySelector('[data-wc-tasks]');
      if (node) node.innerHTML = taskHtml();
      refresh();
    }
  }
  function detach() {
    epoch += 1;
    listeners?.abort();
    listeners = null;
    root = null;
  }
  async function openWatershed(huc12, reportId = selectedId) {
    await host.navigate?.('watershed-context');
    if (reportId && reportId !== selectedId) {
      selectionRequest += 1;
      clearSelection();
      await loadReport(reportId);
    }
    focusHuc = String(huc12);
    if (selectedExportId && !selectedHucs.includes(focusHuc)) {
      selectionRequest += 1;
      clearSelection();
      filters = emptyFilters();
    }
    remember();
    render();
  }
  return {mount, update, detach, refresh, openWatershed};
}
