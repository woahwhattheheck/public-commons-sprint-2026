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

const rfpFocusHuc12s = Object.freeze(['030601010703', '030601010704', '030601020502', '030601020507']);

export function rfpFocusWatersheds(rows) {
  const available = new Set(list(rows).map(row => row.huc12));
  return rfpFocusHuc12s.every(huc => available.has(huc)) ? [...rfpFocusHuc12s] : [];
}


export function utilityWatershedChoicesHtml(choices, busy = false, observed = null) {
  if (!list(choices).length) return '';
  return '<section class="wc-coverage"><h2>Utility contributing watersheds</h2>' +
    '<p class="wc-note">Choose a utility to save its original focus anchors and distinct upstream model-domain HUC12s. ' +
    'Whole-HUC planning footprints, published intake-protection polygons and native reporting masks keep separate boundaries.</p>' +
    list(choices).map(choice => {
      const summary = choice.summary || {};
      const status = choice.available ? '<dl class="wc-facts"><div><dt>Whole HUC12s</dt><dd>' +
        esc(number(summary.huc_count)) + '</dd></div><div><dt>NRCS whole-HUC area</dt><dd>' +
        esc(number(summary.area_acres, 2)) + ' acres</dd></div><div><dt>Original state–HUC rows</dt><dd>' +
        esc(number(summary.state_row_count)) + '</dd></div><div><dt>Outside SC jurisdiction</dt><dd>' +
        esc(number(summary.outside_south_carolina_huc_count)) + ' HUC12s</dd></div><div><dt>Selected SC source features</dt><dd>' +
        esc(number(summary.selected_classification_count)) + '</dd></div></dl>' +
        '<div class="wc-table-scroll"><table><caption>Original NRCS high-priority programme designations</caption>' +
        '<thead><tr><th scope="col">System type</th><th scope="col">State–HUC rows</th><th scope="col">Designated state-portion acres</th></tr></thead><tbody>' +
        list(choice.programme_designations).map(row => '<tr><th scope="row">' + esc(row.system_type) +
          '</th><td>' + esc(number(row.state_row_count)) + '</td><td>' + esc(number(row.state_portion_acres, 2)) +
          (row.missing_area_count ? ' · ' + esc(number(row.missing_area_count)) + ' missing source areas' : '') + '</td></tr>').join('') +
        '</tbody></table></div>' : '<p class="wc-note">' + esc(choice.reason) + '</p>';
      const observations = observed?.profile_sha256 === choice.profile_source?.sha256
        ? list(observed.utilities).find(row => row.utility_id === choice.utility_id &&
          JSON.stringify([...list(row.huc12s)].sort()) === JSON.stringify([...list(choice.huc12s)].sort())) : null;
      const observationHtml = observations ? '<h4>Original microbial sampling context</h4><p class="wc-note">' +
        esc(number(observations.summary.records)) + ' E. coli records at ' + esc(number(observations.summary.stations)) +
        ' stations on ' + esc(number(observations.summary.unique_dates)) + ' distinct dates; original MPN per 100 mL. ' +
        esc(number(observations.summary.information_only_records)) + ' records carry the original Information Only comment. ' +
        'The saved report includes station/year/method coverage, original source tables and separately located regional nutrient/flow context.</p>' : '';
      return '<section><h3>' + esc(choice.title || choice.utility_id) + '</h3>' + status + observationHtml +
        '<p class="wc-note">Ground, Surface and Both retain the original programme labels. Feature counts use publisher HUC attributes; the SCDES jurisdiction is South Carolina.</p>' +
        '<button type="button" data-wc-utility="' + esc(choice.key) + '"' +
        (busy || !choice.available ? ' disabled' : '') + '>Save and export ' + esc(choice.utility_id) + ' contributing watersheds</button>' +
        '<details><summary>Original profile and membership</summary><pre>' +
        esc(pretty({anchor_huc12s:choice.anchor_huc12s, huc12s:choice.huc12s,
          known_external_upstream_huc12s:choice.known_external_upstream_huc12s,
          profile_source:choice.profile_source,reference:choice.reference,area_basis:choice.area_basis})) +
        '</pre></details></section>';
    }).join('') + '</section>';
}

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

function watershedHucLink(huc12, domain) {
  const key = String(huc12 ?? '');
  return domain.has(key)
    ? '<button type="button" data-wc-huc="' + esc(key) + '">' + esc(key) + '</button>'
    : '<span>' + esc(key) + ' · outside model domain</span>';
}

export function watershedDownstreamHtml(row, domainHuc12s = []) {
  const domain = new Set(domainHuc12s);
  if (row.downstream_huc12) return watershedHucLink(row.downstream_huc12, domain);
  const state = row.network?.downstream_state;
  if (state === 'terminal') return 'Terminal outlet in the original network';
  if (state === 'unknown') return 'Unknown in the original downstream record';
  if (state === 'missing_native_record') return 'No original network row for this watershed';
  return 'Original drainage network is not attached to this report';
}

export function watershedNetworkHtml(row, domainHuc12s = []) {
  const network = row.network;
  if (!network) return '';
  const domain = new Set(domainHuc12s);
  const hucList = values => list(values).map(key => watershedHucLink(key, domain)).join(' · ');
  const upstream = list(network.known_upstream_domain_huc12s);
  const path = list(network.downstream_huc12s);
  const external = list(network.known_external_upstream_huc12s);
  const pathStates = {
    terminal: 'Terminal outlet',
    unknown: 'Unknown downstream attribute',
    missing_native_record: 'Original network row unavailable',
    exits_supplied_network: 'Leaves the supplied original network',
    cycle_in_source: 'Cycle in the original downstream records',
  };
  return '<section class="wc-coverage"><h3>Original drainage network</h3>' +
    '<p class="wc-note">Known upstream totals count distinct connected model watersheds and exclude this watershed. Areas use the published watershed records.</p>' +
    '<dl class="wc-facts"><div><dt>Known upstream model watersheds</dt><dd>' +
    esc(number(network.known_upstream_domain_huc_count)) +
    '</dd></div><div><dt>Upstream NRCS priority watersheds</dt><dd>' +
    esc(number(network.known_upstream_priority_huc_count)) +
    '</dd></div><div><dt>Known upstream area</dt><dd>' +
    esc(number(network.known_upstream_area_acres, 2)) + ' acres' +
    (network.known_upstream_area_huc_count === undefined ? '' :
      ' / ' + esc(number(network.known_upstream_area_huc_count)) + ' area records') +
    '</dd></div><div><dt>Upstream selected-class records</dt><dd>' +
    esc(number(network.known_upstream_selected_classification_count)) +
    '</dd></div><div><dt>Downstream path</dt><dd>' +
    esc(pathStates[network.downstream_path_status] || human(network.downstream_path_status)) +
    '</dd></div><div><dt>Original outgoing records</dt><dd>' +
    (network.outgoing_records_complete_for_model_domain === true
      ? 'All model watersheds have an original outgoing value'
      : 'Some model watersheds have missing or unknown outgoing values') +
    '</dd></div></dl>' +
    (path.length ? '<details><summary>Original downstream path</summary><p>' + hucList(path) + '</p></details>' : '') +
    (upstream.length ? '<details><summary>Known upstream model watersheds (' + esc(number(upstream.length)) +
      ')</summary><p>' + hucList(upstream) + '</p></details>' : '') +
    (external.length ? '<details><summary>Additional upstream records outside the model domain (' +
      esc(number(external.length)) + ')</summary><p>' + hucList(external) + '</p></details>' : '') +
    '</section>';
}

export function createWatershedContextDesk(host) {
  const document = host.document || globalThis.document;
  let root = null, listeners = null, epoch = 0, workspace = null;
  let catalog = null, saved = null, selectedId = '', focusHuc = '';
  let savedExport = null, selectedExportId = '', selectedHucs = [], selectionRequest = 0, catalogRequest = 0;
  let lastTaskSignature = '', busy = false, errorText = '', reportRequest = 0;
  let sourceChoice = 0, networkChoice = '';
  let filters = emptyFilters();
  const receivingTasks = new Map();
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
    sourceChoice = 0;
    networkChoice = '';
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
      esc(task.action === 'watershed.context.export' ? 'Export watershed selection' :
        task.action === 'watershed.context.receive' ? 'Receive completed regional run' : 'Build regional context') +
      ' · ' + esc(human(task.state)) + '</button>').join('') + '</section>';
  }
  function sourceHtml() {
    const choices = list(catalog?.sources);
    if (!choices.length) return '<p class="wc-note">Register the regional source edition in Prepare study inputs to build a watershed report.</p>';
    return '<div class="wc-source-form">' + field('Regional source edition',
      '<select name="wc-source">' + choices.map((source, index) =>
        option(index, source.title || source.member_path, sourceChoice)).join('') + '</select>') +
      field('Original HUC12 / ToHUC network', '<select name="wc-network">' + option('', 'Use the source edition’s retained network', networkChoice) + list(catalog?.networks).map((network, index) => option(index, network.title, networkChoice)).join('') + '</select>') +
      '<button type="button" data-wc-build' + (busy ? ' disabled' : '') + '>Build regional context</button>' +
      '<p class="wc-note">Use the retained watershed context and complete classification query from the same original source edition. A selected native network is copied with its exact original bytes into this saved report.</p></div>';
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
      (savedExport.files?.['watershed-selection-brief.html']
        ? '<p class="wc-note">Open the HTML planning brief to review or print this selection. The Markdown brief and original JSON and CSV are also available below.</p>' : '') +
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
      '</p><p class="wc-note">Selected source classes: ' + esc(list(coverage.selected_classes).join(', ') || 'See retained query') + '. Source-feature counts use the publisher’s HUC12 attributes. The receiving-water workflow calculates geometric intersections and upstream contributing areas from the original drainage network.</p>' +
      '<details><summary>Classification query and source scope</summary><pre>' + esc(pretty(coverage)) + '</pre></details></section>';
  }
  function networkHtml(report) {
    const network = report?.network || {};
    if (network.status === 'not_supplied' || !network.status) return '<section class="wc-coverage"><h2>Native watershed network</h2><p>Select the original HUC12 / ToHUC network when building the regional context to open upstream and downstream watershed relationships.</p></section>';
    return '<section class="wc-coverage"><h2>Native watershed network</h2><p>' + esc(human(network.status)) + ' · ' + esc(number(network.model_domain_native_row_count)) + ' model watersheds in ' + esc(number(network.input_row_count)) + ' original network records.</p><div class="wc-metrics">' +
      metric(number(list(network.domain_exit_edges).length), 'Links leaving the model domain') +
      metric(number(list(network.cycles).length), 'Cycles in the original source') +
      metric(number(list(network.missing_model_domain_huc12s).length), 'Model watersheds missing from the network') +
      '</div><p class="wc-note">' + esc(network.interpretation || '') + '</p><details><summary>Original network scope and domain exits</summary><pre>' + esc(pretty(network)) + '</pre></details></section>';
  }
  function completedConnectivityHtml() {
    const graph = saved?.connectivity;
    if (!graph || graph.source_context_id !== saved?.id) return '';
    const exits = list(graph.distinct_domain_exit_catchments);
    return '<section class="wc-coverage"><h2>Completed original connectivity analysis</h2>' +
      '<p>' + esc(graph.method) + '</p><div class="wc-metrics">' +
      metric(number(graph.domain_huc_count), 'Retained domain watersheds') +
      metric(number(graph.headwater_huc_count), 'Domain headwater watersheds') +
      metric(number(graph.native_source_record_count), 'Original network records') +
      metric(number(exits.length), 'Distinct domain exit catchments') +
      '</div><div class="wc-table-scroll"><table><thead><tr><th>Domain exit</th>' +
      '<th>Downstream watershed</th><th>Watersheds</th><th>Distinct acres</th>' +
      '<th>Priority watersheds</th><th>South Carolina selected-class records</th></tr></thead><tbody>' +
      exits.map(exit => '<tr><th scope="row">' + watershedHucLink(exit.from, new Set(rows().map(row => row.huc12))) +
        '</th><td>' + esc(exit.to) + '</td><td>' + esc(number(exit.huc_count)) +
        '</td><td>' + esc(number(exit.area_acres, 2)) + '</td><td>' +
        esc(number(exit.priority_huc_count)) + '</td><td>' +
        esc(number(exit.selected_classifications)) + '</td></tr>').join('') +
      '</tbody></table></div><p class="wc-note">The full connectivity report, all watershed rows, ' +
      'original source summary and source manifest are included in this saved report’s downloads. ' +
      'Exit catchments are disjoint; upstream memberships of different focal watersheds may overlap.</p></section>';
  }
  function upstreamHtml(row) {
    const network = row.network;
    if (!network) return '';
    const upstream = list(network.known_upstream_domain_huc12s);
    const downstream = list(network.downstream_domain_huc12s);
    return watershedNetworkHtml(row, rows().map(item => item.huc12)) +
      '<div class="wc-actions"><button type="button" data-wc-network-export="upstream"' +
      (upstream.length && !busy ? '' : ' disabled') + '>Export upstream watersheds</button>' +
      '<button type="button" data-wc-network-export="downstream"' +
      (downstream.length && !busy ? '' : ' disabled') +
      '>Export downstream model watersheds</button></div>';
  }
  function downstreamHtml(row) {
    return watershedDownstreamHtml(row, rows().map(item => item.huc12));
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
      '<div class="wc-actions"><button type="button" data-wc-refresh>Refresh reports</button>' +
      '<button type="button" data-wc-receive' + (busy ? ' disabled' : '') + '>Receive completed run</button>' +
      '<input type="file" name="wc-completed-run" accept=".zip,application/zip" hidden>' +
      '<button type="button" data-wc-receiving>Open receiving waters</button></div></header>' +
      '<p data-wc-status class="wc-status" aria-live="polite"' + (errorText ? '' : ' hidden') + '>' + esc(errorText) + '</p>' +
      '<div data-wc-tasks>' + taskHtml() + '</div>' +
      '<section class="wc-report-controls">' + reportSelector() + selectionSelector() +
      '<details' + (report ? '' : ' open') + '><summary>Build from a regional source edition</summary>' + sourceHtml() + '</details></section>' +
      (report ? '<section class="wc-metrics" aria-label="Full model domain">' +
        metric(number(all.length), 'Model watersheds') +
        metric(number(sum(all, 'area_km2'), 1), 'Unique watershed area · km²') +
        metric(number(all.filter(row => row.priority).length), 'NRCS priority watersheds') +
        metric(number(sum(all, 'selected_classification_count')), 'Selected-class source features') +
        '</section>' + coverageHtml(report) + completedConnectivityHtml() + networkHtml(report) +
        utilityWatershedChoicesHtml(saved._utility_selections, busy, saved._observed_context) +
        '<section class="wc-watersheds"><header class="wc-section-heading"><h2>Watersheds</h2>' +
        '<div class="wc-actions"><button type="button" data-wc-clear>' + (selectedExportId ? 'Show all watersheds' : 'Clear filters') + '</button><button type="button" data-wc-export>Export matching watersheds</button>' +
        (rfpFocusWatersheds(all).length ? '<button type="button" data-wc-export-rfp>Export four RFP anchor watersheds</button>' : '') +
        '</div></header>' +
        filtersHtml() + '<p data-wc-count class="wc-note" aria-live="polite"></p>' +
        '<div class="wc-table-scroll"><table><thead><tr>' +
        ['Watershed', 'HUC8 / states', 'Area km²', 'NRCS priority', 'Selected source features', 'Source classes', 'Coverage', ''].map(label => '<th scope="col">' + esc(label) + '</th>').join('') +
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
    const focusExport = root.querySelector('[data-wc-export-rfp]');
    if (focusExport) focusExport.disabled = busy || rfpFocusWatersheds(rows()).length === 0;
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
      '</dd></div><div><dt>Downstream watershed</dt><dd>' + downstreamHtml(row) +
      '</dd></div><div><dt>Source-feature assignment</dt><dd>' + esc(human(row.classification_assignment || 'publisher_huc12_attribute')) +
      '</dd></div></dl>' +
      '<div class="wc-detail-grid"><section><h3>Priority reasons</h3>' +
      (reasons.length ? '<ul>' + reasons.map(reason => '<li>' + esc(typeof reason === 'string' ? reason : pretty(reason)) + '</li>').join('') + '</ul>' :
        '<p class="wc-note">The source contains no priority reason for this watershed.</p>') +
      '<h3>Original state area records</h3><p class="wc-note">The regional total counts each watershed once. State rows retain their original area values.</p><dl class="wc-class-counts">' + Object.entries(stateAreas).map(([state, acres]) => '<div><dt>' + esc(state) + '</dt><dd>' + esc(number(acres, 1)) + ' acres</dd></div>').join('') + '</dl></section>' +
      '<section><h3>Classified-water source</h3><p>' + esc(number(row.selected_classification_count)) +
      ' selected-class source features · ' + esc(human(row.classification_coverage)) + '</p>' +
      '<dl class="wc-class-counts">' + Object.entries(classCounts).map(([key, count]) =>
        '<div><dt>' + esc(key) + '</dt><dd>' + esc(number(count)) + '</dd></div>').join('') +
      '</dl><p class="wc-note">Jurisdiction: ' + esc(human(row.classification_scope)) + '. Source classes: ' +
      esc(list(row.selected_classes).join(', ') || 'No selected class records') + '.</p></section></div>' +
      upstreamHtml(row) + '<details><summary>Original NRCS state rows</summary><pre>' + esc(pretty(row.nrcs_state_rows || [])) + '</pre></details>' +
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
    if (!rows().some(row => row.huc12 === focusHuc)) {
      const original = list(result.selection?.huc12s || result.report?.selection?.huc12s);
      focusHuc = original.find(huc => rows().some(row => row.huc12 === huc)) || '';
    }
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
    const pending = receivingTasks.get(workspace);
    const completed = list(host.getState()?.tasks).find(task =>
      task.id === pending && task.action === 'watershed.context.receive' &&
      task.state === 'complete' && task.result?.id);
    if (completed) {
      selectedId = completed.result.id;
      clearSelection();
      focusHuc = '';
      filters = emptyFilters();
      selectionRequest += 1;
      receivingTasks.delete(workspace);
      remember();
    }
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
  async function receive(file) {
    if (!file || busy) return;
    const key = workspace;
    if (!key || currentWorkspace() !== key)
      throw new Error('Choose the project receiving this regional run.');
    busy = true;
    if (root) render();
    try {
      const uploaded = await host.uploadFile(file);
      if (currentWorkspace() !== key)
        throw new Error('The selected project changed. Choose the receiving project and archive again.');
      const task = await host.submitAction('watershed.context.receive', {upload_id:uploaded.id});
      receivingTasks.set(key, task.id);
      await host.refresh?.({force:true});
      if (root && workspace === key) await refresh();
    } finally {
      busy = false;
      if (root) render();
    }
  }
  async function build() {
    if (busy) return;
    const source = selectedSource();
    if (!source) throw new Error('Choose a registered regional source edition.');
    const selection = {...source};
    delete selection.title;
    const networkIndex = root?.querySelector('[name="wc-network"]')?.value;
    if (networkIndex !== undefined && networkIndex !== '') {
      const selectedNetwork = catalog?.networks?.[Number(networkIndex)];
      if (!selectedNetwork) throw new Error('Refresh the catalogue and choose the original network.');
      selection.network = {...selectedNetwork};
    }
    busy = true;
    const button = root?.querySelector('[data-wc-build]');
    if (button) button.disabled = true;
    try {
      await host.submitAction('watershed.context.analyze', {selection, title:'Regional watershed context'});
      await host.refresh?.({force:true});
      if (root) await refresh();
    } finally { busy = false; if (root) { const node = root.querySelector('[data-wc-build]'); if (node) node.disabled = false; renderRows(); } }
  }
  async function exportRows(huc12s, utilityKey = null) {
    if (busy) return;
    if (!saved || !huc12s.length) throw new Error('Choose watershed records to export.');
    busy = true;
    render();
    try {
      await host.submitAction('watershed.context.export', {report_id:saved.id, huc12s,
        ...(utilityKey ? {utility_key:utilityKey} : {})});
      await host.refresh?.({force:true});
      if (root) await refresh();
    } finally { busy = false; if (root) render(); }
  }
  async function click(event) {
    const button = event.target.closest('button');
    if (!button || !root?.contains(button)) return;
    try {
      if (button.hasAttribute('data-wc-refresh')) return refresh();
      if (button.hasAttribute('data-wc-build')) return await build();
      if (button.hasAttribute('data-wc-receive')) {
        if (!busy) root.querySelector('[name="wc-completed-run"]')?.click();
        return;
      }
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
      if (button.dataset.wcUtility) {
        const choice = list(saved?._utility_selections).find(row => row.key === button.dataset.wcUtility);
        if (!choice?.available) throw new Error('Choose an available utility footprint from the original profile.');
        return await exportRows(choice.huc12s, choice.key);
      }
      if (button.hasAttribute('data-wc-export')) return await exportRows(filtered().map(row => row.huc12));
      if (button.hasAttribute('data-wc-export-rfp')) return await exportRows(rfpFocusWatersheds(rows()));
      if (button.dataset.wcExportOne) return await exportRows([button.dataset.wcExportOne]);
      if (button.dataset.wcNetworkExport) {
        const network = rows().find(row => row.huc12 === focusHuc)?.network;
        const selected = button.dataset.wcNetworkExport === 'upstream' ? network?.known_upstream_domain_huc12s : network?.downstream_domain_huc12s;
        return await exportRows(list(selected));
      }
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
    if (key === 'completed-run') {
      const file = event.target.files?.[0];
      event.target.value = '';
      receive(file).catch(fail);
      return;
    }
    if (key === 'source') { sourceChoice = Number(event.target.value); return; }
    if (key === 'network') { networkChoice = event.target.value; return; }
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
  async function openSelection(exportId) {
    if (!root) throw new Error('Open Regional watersheds before selecting its retained export.');
    await loadExport(exportId);
    if (root) root.querySelector('[data-wc-detail]')?.scrollIntoView({block:'nearest'});
  }
  return {mount, update, detach, refresh, openWatershed, openSelection};
}
