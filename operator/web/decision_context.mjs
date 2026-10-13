/** Source-linked decision reports inside the original Upper Savannah operator. */
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rows = value => Array.isArray(value) ? value : [];
const short = value => value ? String(value).slice(0, 12) : '—';
const number = value => value === null || value === undefined ? '—' : typeof value === 'number'
  ? value.toLocaleString(undefined, {maximumFractionDigits: 6}) : String(value);
const human = value => String(value ?? '').replaceAll('_', ' ');
const date = value => value ? new Date(value).toLocaleString() : '—';
const button = (action, label, id = '', extra = '') => '<button type="button" data-action="decision-context-' +
  esc(action) + '" data-id="' + esc(id) + '" ' + extra + '>' + esc(label) + '</button>';
const table = (heads, body) => '<div class="decision-table"><table><thead><tr>' + heads.map(x => '<th scope="col">' +
  esc(x) + '</th>').join('') + '</tr></thead><tbody>' + body.join('') + '</tbody></table></div>';
const cells = values => '<tr>' + values.map(x => '<td>' + esc(x) + '</td>').join('') + '</tr>';
const option = (value, title, selected = '') => '<option value="' + esc(value) + '"' +
  (value === selected ? ' selected' : '') + '>' + esc(title) + '</option>';
const field = (title, control, help = '') => '<label class="decision-field"><span>' + esc(title) + '</span>' +
  control + (help ? '<small>' + esc(help) + '</small>' : '') + '</label>';
const sourceKey = row => row.source_collection_id + '/' + row.source_id;
const sourceChoice = value => {
  const split = value.indexOf('/');
  if (split < 0) return null;
  return {source_collection_id: value.slice(0, split), source_id: value.slice(split + 1)};
};
const sourceLabel = row => row.title + ' · ' + row.vintage + ' · ' + short(row.source_collection_id);
const publicLink = value => /^https?:\/\//i.test(value || '') ? '<a href="' + esc(value) +
  '" target="_blank" rel="noopener noreferrer">' + esc(value) + '</a>' : esc(value);
const runLabel = row => row.alternative_title || row.scenario_title || short(row.alternative_run_id);

export function attachDecisionContext(context) {
  const {api, endpoint, getState, openForm, submitAction, detail, fileList} = context;
  const document = context.document || globalThis.document;
  let host = null, workspace = null, catalogue = null, record = null, selected = null;
  let generation = 0, request = null, pending = false, error = '', signature = '';
  let selectedSubject = '', pollutant = '', alternative = '', classScope = 'priority', classStatus = '', classifiedPage = 0;
  const remembered = new Map();

  const workspaceKey = () => context.getWorkspace?.() || getState()?.workspace_key;
  const query = (path, values = {}) => endpoint('/api/decision-context/' + path, values);
  const current = (key, epoch) => Boolean(host) && workspaceKey() === key && workspace === key && generation === epoch;
  const subjectRows = name => rows(record?.[name]).filter(row => !selectedSubject || row.subject_id === selectedSubject);
  function announce(problem) {
    error = problem?.message || String(problem);
    if (host) draw();
  }
  function selectedName() {
    return rows(record?.subjects).find(row => row.id === selectedSubject)?.title || 'Selected receiving water';
  }
  function downloadsHTML(downloads) {
    const list = rows(downloads).filter(row => /\.(zip|html|csv|json)$/i.test(row.filename || ''));
    return '<div class="decision-downloads">' + list.map(row => '<a href="' + esc(row.url) +
      '?download=1" download>' + esc(row.filename?.endsWith('.html') ? 'Portable report' :
      row.filename?.endsWith('.zip') ? (row.filename === 'decision-context.zip' ? 'Decision report package' : 'Map delivery package') : row.filename) + '</a>').join('') + '</div>';
  }

  function catalogHTML() {
    const saved = rows(catalogue?.reports);
    return '<section class="decision-section"><header><div><h2>Saved reports</h2><p>Reopen the selected sources and original scenario results.</p></div>' +
      button('new', 'Create report') + '</header>' +
      (saved.length ? table(['Report', 'Contents', 'Saved', ''], saved.map(row => '<tr' +
        (row.id === selected ? ' class="decision-selected"' : '') + '><td><strong>' + esc(row.title) +
        '</strong><small>' + esc(short(row.id)) + '</small></td><td>' +
        esc(row.analysis_id ? 'Receiving-water quantities and source context' : 'Receiving-water plan and source context') +
        '</td><td>' + esc(date(row.created_at)) + '</td><td>' + button('open', 'Open', row.id) + '</td></tr>')) :
        '<div class="decision-empty"><h3>Bring the regional evidence together</h3><p>Select a completed receiving-water analysis or a saved plan, then choose the retained NRCS or classified-water context.</p>' +
        button('new', 'Create report') + '</div>') + '</section>';
  }

  function physicalHTML() {
    let values = subjectRows('physical_rows');
    if (pollutant) values = values.filter(row => row.pollutant === pollutant);
    if (alternative) values = values.filter(row => row.alternative_run_id === alternative);
    return '<section class="decision-section"><header><div><h3>Original physical quantities</h3><p>Changes use the same valid cells for baseline and alternative. A positive net reduction means less export.</p></div></header>' +
      (values.length ? table(
        ['Pollutant / units', 'Alternative', 'Baseline (paired when comparing)', 'Alternative on paired cells', 'Net reduction', 'Reduction %', 'Valid cells', 'Coverage'],
        values.map(row => cells([
          human(row.pollutant) + ' · ' + (row.units || ''),
          row.alternative_run_id ? runLabel(row) : 'Baseline',
          number(row.baseline_paired_sum ?? (!row.alternative_run_id ? row.baseline_original_sum : null)),
          number(row.alternative_paired_sum), number(row.net_reduction),
          row.reduction_percent === null || row.reduction_percent === undefined ? '—' : number(row.reduction_percent) + '%',
          number(row.alternative_run_id ? row.paired_valid_cells : row.baseline_valid_cells),
          ((row.alternative_run_id ? row.paired_coverage_fraction : row.baseline_coverage_fraction) == null ? '—' :
            number(100 * (row.alternative_run_id ? row.paired_coverage_fraction : row.baseline_coverage_fraction)) + '%') +
            ' · ' + human(row.status),
        ]))) : '<p class="decision-empty">This report contains the saved plan and its source context. Select a completed receiving-water analysis when creating the next report to include the model quantities.</p>') +
      '<p class="decision-note">Per-receptor areas may overlap. The family union is the retained geometric union; its quantities are already deduplicated. Source-water priorities and water classifications remain categorical context.</p></section>';
  }

  function geographyHTML() {
    const contextRows = subjectRows('huc_context_rows'), priorities = subjectRows('nrcs_rows');
    return '<section class="decision-section"><header><div><h3>Contributing HUCs and NRCS context</h3><p>The saved hydrologic relationship determines which HUCs appear here.</p></div></header>' +
      (contextRows.length ? table(['HUC12', 'Relationship', 'Source coverage', 'Classified reach context'], contextRows.map(row => cells([
        row.huc12, human(row.huc_relation || row.relation || row.relationship),
        human(row.nrcs_coverage), row.classified_feature_count ?? row.classified_count ?? '—',
      ]))) : '<p class="decision-empty">The selected receptor uses ' + esc(human(rows(record?.subjects).find(row => row.id === selectedSubject)?.relationship_precision || 'its saved geometry')) +
        '. HUC source membership is available when the original plan declares an upstream HUC relationship.</p>') +
      (priorities.length ? table(
        ['HUC12', 'State', 'Edition', 'Priority status', 'System', 'Concern', 'State area (acres)', 'Whole HUC area (acres)'],
        priorities.map(row => cells([row.huc12 || row.huc12_code, row.st_usps, row.nrcs_edition || row.edition,
          row.fy26_status, row.system_type || '—', row.resource_concern || '—', number(row.st_ac), number(row.huc12_ac)]))) : '') +
      '<p class="decision-note">A missing source row and “Not Selected” are different source states. Ground, Surface and Both retain the publisher’s meaning. Whole-HUC acreage repeats on cross-state rows.</p></section>';
  }

  function classifiedHTML() {
    const allCover = subjectRows('coverage_rows'), regional = rows(record?.regional_coverage_rows);
    const allScopes = [...new Set([...allCover, ...regional].map(row => row.class_scope))].sort();
    if (!allScopes.includes(classScope)) classScope = allScopes.includes('all') ? 'all' : allScopes[0] || '';
    const matching = row => (!classScope || row.class_scope === classScope) && (!classStatus || row.status === classStatus);
    const cover = allCover.filter(matching), regionalCover = regional.filter(matching);
    const values = subjectRows('classified_rows').filter(row => !classStatus || row.status === classStatus);
    const pages = Math.max(1, Math.ceil(values.length / 100));
    classifiedPage = Math.max(0, Math.min(classifiedPage, pages - 1));
    const first = classifiedPage * 100, page = values.slice(first, first + 100);
    const measureTable = values => table(
      ['Region', 'Edition status', 'Class scope', 'Geometry', 'Feature count', 'Unique geometric measure', 'Unit'],
      values.map(row => cells([row.huc12 || row.region_id, row.status, row.class_scope, row.geometry_kind,
        row.positive_feature_count, number(row.unique_geometry_measure), row.measure_unit])));
    const statusValues = [...new Set([...allCover, ...regional, ...values].map(row => row.status).filter(Boolean))];
    return '<section class="decision-section"><header><div><h3>Classified-water context</h3><p>Geographic membership, mapped classification and legal reach association retain their original source roles.</p></div></header>' +
      '<div class="decision-filters">' +
      field('Coverage class scope', '<select data-decision-filter="class-scope">' + allScopes.map(value =>
        option(value, human(value), classScope)).join('') + '</select>') +
      field('Source edition status', '<select data-decision-filter="class-status">' + option('', 'All retained edition statuses', classStatus) +
        statusValues.map(value => option(value, human(value), classStatus)).join('') + '</select>') +
      '</div>' + (cover.length ? measureTable(cover) : '') +
      (regionalCover.length ? '<details><summary>Original reporting-region and loaded-domain unions</summary>' +
        measureTable(regionalCover) + '</details>' : '') +
      (values.length ? '<details open><summary>' + esc(number(values.length)) + ' retained reach associations</summary>' +
        table(['HUC / association', 'Member receptors', 'Original feature', 'Waterbody', 'Mapped class', 'Edition status', 'Coextensive legal records', 'Partial legal records', 'Candidate legal records', 'Association precision'],
          page.map(row => cells([row.huc12 || row.region_id, rows(row.member_receptor_ids).join(', ') || '—', row.feature_id, row.waterbody_name,
            row.class_code || row.class_label, row.status,
            rows(row.coextensive_registry_ids).join(', ') || '—',
            rows(row.partial_registry_ids).join(', ') || '—',
            rows(row.candidate_registry_ids).join(', ') || '—',
            row.association_role || row.legal_edition_status]))) +
        '<div class="decision-pagination"><span>Rows ' + number(first + 1) + '–' + number(first + page.length) + ' of ' + number(values.length) + '</span>' +
        button('class-page', 'Previous', String(classifiedPage - 1), classifiedPage === 0 ? 'disabled' : '') +
        button('class-page', 'Next', String(classifiedPage + 1), classifiedPage + 1 === pages ? 'disabled' : '') +
        '</div></details>' : '<p class="decision-empty">The retained crosswalk has no reach association for this selected context.</p>') +
      '<p class="decision-note">HUC and reporting regions overlap. Use each retained union measure in its own region; class rows and HUC rows are separate views of the same geography. The CSV download contains the complete association table.</p></section>';
  }

  function deliveryHTML() {
    const compatible = rows(record?.compatible_deliveries), linked = rows(record?.delivery_links);
    return '<section class="decision-section"><header><div><h3>Map delivery</h3><p>Link this report to a complete delivery using the same baseline and reviewed alternatives.</p></div>' +
      (compatible.length ? button('delivery', 'Link to map delivery', record.id) : '') + '</header>' +
      (linked.length ? linked.map(row => '<div class="decision-delivery"><strong>Delivery ' +
        esc(short(row.delivery_id)) + '</strong>' + downloadsHTML(row._downloads) + '</div>').join('') :
        '<p class="decision-empty">' + (compatible.length ? 'Choose a compatible map delivery to save the report alongside its original release.' :
        record.analysis_id ? 'Complete a map delivery with the report’s baseline and alternatives; it will appear here.' :
        'Create a report from a completed receiving-water analysis to connect it to a map delivery.') + '</p>') + '</section>';
  }

  function reportHTML() {
    if (!selected) return '';
    if (!record) return '<section class="decision-section" aria-live="polite"><h2>Opening report…</h2></section>';
    const subjects = rows(record.subjects);
    const selectedRow = subjects.find(row => row.id === selectedSubject);
    const physical = subjectRows('physical_rows');
    const alternatives = [...new Set(physical.map(row => row.alternative_run_id).filter(Boolean))];
    const pollutants = [...new Set(physical.map(row => row.pollutant).filter(Boolean))];
    return '<article class="decision-report"><header class="decision-report-header"><div><h2>' + esc(record.title) +
      '</h2><p>' + esc(record.analysis_id ? human(record.quantity_scope) + ' · Original analysis ' + short(record.analysis_id) :
      'Original receiving-water plan ' + short(record.plan_id)) + '</p></div>' + button('files', 'All report files', record.id) +
      '</header>' + downloadsHTML(record._downloads?.filter(row => /\.(zip|html)$/i.test(row.filename))) +
      '<div class="decision-filters">' +
      field('Receiving water', '<select data-decision-filter="subject">' + subjects.map(row => option(row.id,
        row.title + (row.kind === 'family_union' ? ' · family union' : ''), selectedSubject)).join('') + '</select>') +
      field('Pollutant', '<select data-decision-filter="pollutant">' + option('', 'All pollutants', pollutant) +
        pollutants.map(value => option(value, human(value), pollutant)).join('') + '</select>') +
      field('Alternative', '<select data-decision-filter="alternative">' + option('', 'All alternatives', alternative) +
        alternatives.map(value => option(value, runLabel(physical.find(row => row.alternative_run_id === value)), alternative)).join('') + '</select>') +
      '</div><p class="decision-note"><strong>' + esc(selectedName()) + '.</strong> ' +
      esc(selectedRow?.interpretation || selectedRow?.relationship_precision || '') + '</p>' +
      physicalHTML() + geographyHTML() + classifiedHTML() + deliveryHTML() +
      '<section class="decision-section"><h3>Selected source editions</h3>' +
      rows(record.references).map(row => '<p><strong>' + esc(row.title || row.role || row.source_id) +
        '</strong><br>' + esc(row.vintage || row.edition || '') + '<br>' + publicLink(row.uri || row.url) + '</p>').join('') +
      '</section></article>';
  }

  function draw() {
    if (!host) return;
    host.classList.add('decision-context-desk');
    host.innerHTML = '<header class="decision-heading"><div><h1>Regional decision context</h1><p>Model quantities, receiving waters and the retained source-water programme context.</p></div>' +
      button('refresh', pending ? 'Refreshing…' : 'Refresh', '', pending ? 'disabled' : '') + '</header>' +
      (error ? '<div class="decision-error" role="alert">' + esc(error) + '</div>' : '') +
      (!catalogue ? '<section class="decision-section" aria-live="polite"><p>Opening the workspace sources and completed analyses…</p></section>' :
      catalogHTML() + reportHTML());
  }

  async function refresh() {
    const key = workspaceKey();
    if (!key) return;
    const epoch = ++generation;
    request?.abort();
    request = new AbortController();
    pending = true; error = ''; draw();
    try {
      const loaded = await api(query('catalog'), {signal: request.signal});
      if (!current(key, epoch)) return;
      catalogue = loaded;
      if (selected && !rows(catalogue.reports).some(row => row.id === selected)) {
        selected = null; record = null; selectedSubject = '';
      }
      if (selected) {
        const detail = await api(query('detail', {decision_id: selected}), {signal: request.signal});
        if (!current(key, epoch)) return;
        record = detail;
        if (!rows(record.subjects).some(row => row.id === selectedSubject))
          selectedSubject = rows(record.subjects).find(row => row.kind === 'family_union')?.id || record.subjects?.[0]?.id || '';
      }
    } catch (problem) {
      if (current(key, epoch) && problem.name !== 'AbortError') error = problem.message || String(problem);
    } finally {
      if (current(key, epoch)) { pending = false; draw(); }
    }
  }

  async function open(id) {
    const key = workspaceKey();
    selected = id; remembered.set(key, id); record = null;
    selectedSubject = ''; pollutant = ''; alternative = ''; classStatus = ''; classScope = 'priority'; classifiedPage = 0;
    context.closeDetail?.();
    if (!host) { await context.navigate?.('decision-context'); return; }
    await refresh();
  }

  async function create() {
    const key = workspaceKey();
    const cat = await api(query('catalog'));
    if (workspaceKey() !== key) return;
    const analyses = rows(cat.analyses), plans = rows(cat.plans);
    if (!analyses.length && !plans.length) throw new Error('Save a receiving-water plan in this workspace, then create its decision report.');
    const water = rows(cat.source_water_contexts), crosswalks = rows(cat.classified_crosswalks);
    const options = (analyses.length ? '<optgroup label="Completed analysis">' + analyses.map(row =>
      option('analysis:' + row.id, row.title + ' · ' + human(row.quantity_scope) + ' · ' +
      row.alternative_run_ids.length + ' alternatives · ' + short(row.id))).join('') + '</optgroup>' : '') +
      '<optgroup label="Source plan">' + plans.map(row => option('plan:' + row.id, row.title + ' · ' + row.receptor_count + ' receptors')).join('') + '</optgroup>';
    const sourceSelect = (name, values) => '<select name="' + name + '">' + option('', 'Choose a retained source') +
      values.map(row => option(sourceKey(row), sourceLabel(row), values.length === 1 ? sourceKey(row) : '')).join('') + '</select>';
    openForm('Create regional decision report',
      'Choose the original receiving-water result and the retained source editions that explain its regional context.',
      '<div class="decision-form">' +
      field('Report title', '<input name="decision_title" required maxlength="160" value="Regional receiving-water decision report">') +
      field('Saved analysis or plan', '<select name="decision_result" required>' + options + '</select>') +
      field('NRCS source-water context', sourceSelect('decision_water', water),
        water.length ? 'Keeps each state, system type and resource concern together.' :
        'Import the SOURCE_WATER_CONTEXT entry prepared from the retained NRCS source.') +
      field('Classified-water crosswalk', sourceSelect('decision_crosswalk', crosswalks),
        crosswalks.length ? 'Uses the crosswalk’s geographic and original feature identities.' :
        'Import the classified-water-crosswalk source entry to include its mapped reaches and legal associations.') +
      field('Classified-source edition status', '<select name="decision_status">' +
        option('current', 'Current editions', 'current') + option('current,proposed', 'Current and proposed editions, shown separately') +
        option('proposed', 'Proposed editions') + '</select>') + '</div>',
      'Save report', async () => {
        const root = document.querySelector('#form-body');
        const value = name => root.querySelector('[name="' + name + '"]').value;
        const result = value('decision_result').split(':');
        const selection = {title: value('decision_title').trim(), statuses: value('decision_status').split(',')};
        selection[result[0] === 'analysis' ? 'analysis_id' : 'plan_id'] = result[1];
        const waterSource = sourceChoice(value('decision_water')), crosswalkSource = sourceChoice(value('decision_crosswalk'));
        if (!waterSource && !crosswalkSource) throw new Error('Choose at least one retained source-water context or classified-water crosswalk.');
        if (waterSource) selection.water_context = waterSource;
        if (crosswalkSource) selection.crosswalk = crosswalkSource;
        await submitAction('decision.context.build', {selection});
      });
  }

  function deliveryForm(id) {
    if (!record || record.id !== id) throw new Error('Open the saved report before linking its map delivery.');
    const compatible = rows(record.compatible_deliveries);
    if (!compatible.length) throw new Error('Complete a map delivery with this report’s baseline and alternatives.');
    openForm('Link report to map delivery',
      'The saved link retains this decision report and the original compatible seven-map delivery.',
      field('Map delivery', '<select name="decision_delivery" required>' + compatible.map(row => option(
        row.id, row.title || row.selection?.title || short(row.id))).join('') + '</select>'),
      'Save delivery link', async () => {
        const delivery = document.querySelector('#form-body [name="decision_delivery"]').value;
        await submitAction('decision.context.delivery', {decision_id: id, delivery_id: delivery});
      });
  }

  async function dispatch(node) {
    const action = node.dataset.action?.replace('decision-context-', '');
    if (action === 'refresh') return refresh();
    if (action === 'new') return create();
    if (action === 'open') return open(node.dataset.id);
    if (action === 'delivery') return deliveryForm(node.dataset.id);
    if (action === 'class-page') { classifiedPage = Number(node.dataset.id); draw(); return; }
    if (action === 'files') {
      const key = workspaceKey(), result = await api(query('detail', {decision_id: node.dataset.id}));
      if (key !== workspaceKey()) return;
      return detail(result.title, fileList(result._downloads), {kind: 'decision_contexts', id: result.id, state: result.state});
    }
  }
  function filters(event) {
    const name = event.target.dataset.decisionFilter;
    if (name === 'subject') { selectedSubject = event.target.value; pollutant = ''; alternative = ''; classifiedPage = 0; }
    else if (name === 'pollutant') pollutant = event.target.value;
    else if (name === 'alternative') alternative = event.target.value;
    else if (name === 'class-scope') classScope = event.target.value;
    else if (name === 'class-status') { classStatus = event.target.value; classifiedPage = 0; }
    else return;
    draw();
    host?.querySelector('[data-decision-filter="' + name + '"]')?.focus();
  }
  function stateSignature(state) {
    return JSON.stringify({
      reports: state?.data?.decision_contexts || [],
      sources: rows(state?.data?.sources).map(row => row.id),
      tasks: rows(state?.tasks).filter(row => row.action?.startsWith('decision.context.')).map(row => [row.id, row.state]),
    });
  }
  function mount(node, state) {
    host = node; workspace = workspaceKey(); selected = remembered.get(workspace) || null;
    catalogue = null; record = null; signature = stateSignature(state);
    host.addEventListener('change', filters);
    return refresh();
  }
  function update(state) {
    if (!host) return;
    if (workspace !== workspaceKey()) { detach(); return; }
    const next = stateSignature(state);
    if (next !== signature) { signature = next; return refresh(); }
  }
  function detach() {
    generation++; request?.abort(); request = null;
    host?.removeEventListener('change', filters);
    host?.classList.remove('decision-context-desk');
    host = null; pending = false; workspace = null;
  }
  return {mount, update, detach, dispatch, open, create, refresh};
}
