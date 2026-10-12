// MIT. Material operations inside the original OpenSearch operator workspace.
import { sha256File } from '/file-sha256.mjs';
import { createSupplierController } from '/supplier.mjs';
const MAPPING_SCHEMA = 'stellar-forge.material-catalog-mapping.v1';
const FIELDS = [
  ['materialId', 'Material identifier', 'PRODUCTID'],
  ['title', 'Title', 'NAME'],
  ['description', 'Description', 'DESCRIPTION'],
  ['partNumber', 'Manufacturer part number', ''],
  ['manufacturer', 'Manufacturer', ''],
  ['category', 'Category', 'CATEGORY'],
  ['unit', 'Base quantity unit', 'QUANTITYUNIT'],
  ['salesUnit', 'Sales quantity unit', ''],
  ['numerator', 'Sales-to-base numerator', ''],
  ['denominator', 'Sales-to-base denominator', ''],
];
const pretty = value => JSON.stringify(value, null, 2);
const encoded = encodeURIComponent;
const text = value => value === null || value === undefined ? '—'
  : typeof value === 'object' ? JSON.stringify(value) : String(value);
const emptyMapping = () => ({ schema: MAPPING_SCHEMA, fields: Object.fromEntries(FIELDS.map(([key]) => [key, null])),
  references: [], attributes: {}, identifierPolicy: 'exact', unitAliases: {}, delta: null });

export function createCatalogController({ host, api, perform, refresh, recover, retry, notice, view, element, attempt }) {
  const $ = id => document.getElementById(id);
  let snapshot = { catalogs: [], sources: [], editions: [] }, catalog = null, edition = null, sourceId = '';
  let dirty = false, reading = false, pageOffset = 0, pageNext = null, rowMode = 'materials';
  let matchOffset = 0, matchNext = null, matchInput = null, matchCandidates = [], matchChosen = null, editingDecision = null;
  let decisionOffset = 0, decisionNext = null, selectedPanel = 'setup', fileNotice = '', quantityUrl = null;
  const hashes = new WeakMap();
  let supplier = null;
  const nav = element('button', 'Material catalogs', { 'data-view': 'catalog', type: 'button' });
  document.querySelector('nav[aria-label="Workspace views"]').append(nav);
  const section = element('section', undefined, { id: 'view-catalog', hidden: '' });
  section.innerHTML = [
    '<div class="section-heading"><div><h2>Material catalogs</h2><p class="muted">Retain source files, review catalog changes and keep customer material decisions with the selected edition.</p></div><button id="cat-refresh" type="button">Refresh catalogs</button></div>',
    '<div class="cat-selector"><label>Saved catalog<select id="cat-catalog"></select></label><div class="actions"><button id="cat-new" type="button">New catalog</button><button id="cat-reload" type="button">Reload saved catalog</button></div></div>',
    '<p id="cat-identity" class="summary">Create a catalog and choose its source mapping.</p>',
    '<div id="cat-pending" class="cat-banner" hidden><p id="cat-pending-description"></p><div class="actions"><button id="cat-pending-read" type="button">Read saved outcome</button><button id="cat-pending-retry" type="button">Retry original request</button></div></div>',
    '<div class="cat-tabs" role="tablist" aria-label="Material catalog work"><button type="button" role="tab" data-catalog-view="setup" aria-selected="true">Sources and mapping</button><button type="button" role="tab" data-catalog-view="review" aria-selected="false">Edition review</button><button type="button" role="tab" data-catalog-view="matches" aria-selected="false">Customer matches</button><button type="button" role="tab" data-catalog-view="handover" aria-selected="false">Search and handover</button><button type="button" role="tab" data-catalog-view="supplier" aria-selected="false">Supplier delivery</button></div>',
    '<section id="cat-panel-setup" aria-label="Catalog sources and mapping">',
    '<div class="two-column"><label>Catalog title<input id="cat-title" maxlength="120" autocomplete="off"></label><label>Tenant identifier<input id="cat-tenant" maxlength="256" autocomplete="off"><span class="help">Use the retained organization identifier for this catalog.</span></label></div>',
    '<h3>Map original material fields</h3><p class="help">Enter a CSV header or JSON Pointer. Complex fields also accept a declared constant, text join or retained lookup as JSON. Identifier values keep their original text.</p>',
    '<div class="actions"><button id="cat-sap" type="button">Map SAP product columns</button><button id="cat-xchange" type="button">Map ETIM xChange products</button><label>Identifier matching<select id="cat-policy"><option value="exact">Exact original identifiers</option><option value="casefold">Explicit case-insensitive lookup</option></select></label></div>',
    '<div id="cat-fields" class="cat-field-grid"></div>',
    '<details><summary>References, attributes, unit aliases and deltas</summary>',
    '<div class="two-column"><label>Material reference mappings<textarea id="cat-references" class="code" rows="8" spellcheck="false">[]</textarea><span class="help">Each entry declares kind, value and an optional delimiter. Supplier accounts belong in attributes.</span></label><label>Retained source attributes<textarea id="cat-attributes" class="code" rows="8" spellcheck="false">{}</textarea></label></div>',
    '<div class="two-column"><label>Explicit unit aliases<textarea id="cat-aliases" class="code" rows="6" spellcheck="false">{}</textarea><span class="help">Map an original unit to its intended label. Conversions require the original numerator and denominator.</span></label><label>Delta operation mapping<textarea id="cat-delta" class="code" rows="6" spellcheck="false">null</textarea><span class="help">Declare operation, upsertValues and deleteValues for delta sources.</span></label></div>',
    '</details>',
    '<details><summary>Join retained text or unit dictionaries</summary><p class="help">Select a source uploaded below, its exact lookup key and value, and the matching key in each product row. Declare language or client filters when the source requires them.</p>',
    '<div class="two-column"><label>Lookup source<select id="cat-lookup-source"></select></label><label>Target material field<select id="cat-lookup-target"><option value="title">Title</option><option value="description">Description</option><option value="unit">Base quantity unit</option><option value="salesUnit">Sales quantity unit</option></select></label></div>',
    '<div class="two-column"><label>Lookup key fields, one per line<textarea id="cat-lookup-key" rows="2" spellcheck="false">TEXTID</textarea></label><label>Product key fields, one per line<textarea id="cat-lookup-from" rows="2" spellcheck="false">NAMEID</textarea></label></div>',
    '<div class="two-column"><label>Lookup value field<input id="cat-lookup-value" value="TEXT"></label><label>Equality filters as JSON<textarea id="cat-lookup-where" class="code" rows="3" spellcheck="false">{}</textarea></label></div><button id="cat-use-lookup" type="button">Apply retained lookup to mapping</button></details>',
    '<div class="actions"><button id="cat-save" type="button" class="primary">Save catalog mapping</button><span id="cat-saved" class="help">New catalog</span></div>',
    '<article><h3>Retain an original source file</h3><p class="help">The workspace streams the selected bytes into a retained source. The browser keeps its size and checksum with the original request.</p>',
    '<label>Original CSV, TSV, JSONL or JSON file<input id="cat-file" type="file" accept=".csv,.tsv,.jsonl,.ndjson,.json,text/csv,application/json"></label>',
    '<div class="two-column"><label>File format<select id="cat-format"><option value="csv">CSV</option><option value="tsv">TSV</option><option value="jsonl">JSON Lines</option><option value="json">JSON document</option><option value="xchange-json">ETIM xChange 2.0 document</option></select></label><label id="cat-delimiter-label">CSV delimiter<input id="cat-delimiter" maxlength="1" value=","></label></div>',
    '<div id="cat-tabular"><label class="cat-check"><input id="cat-header" type="checkbox" checked> The first row contains field names.</label><label id="cat-columns-label" hidden>Headerless column names as a JSON array<textarea id="cat-columns" class="code" rows="3" spellcheck="false">[]</textarea></label></div>',
    '<label id="cat-rows-path-label" hidden>JSON Pointer to the rows array<input id="cat-rows-path" placeholder="/records"><span class="help">Leave empty when the document itself is the rows array.</span></label>',
    '<details><summary>Source provenance</summary><div class="two-column"><label>Original source URL<input id="cat-source-url" type="url" placeholder="https://"></label><label>Publisher<input id="cat-publisher" maxlength="240"></label></div><div class="two-column"><label>Source revision<input id="cat-source-revision" maxlength="240"></label><label>Source kind<input id="cat-source-kind" maxlength="80" placeholder="supplier-catalog"></label></div><label>Source note<textarea id="cat-source-note" rows="3" maxlength="1600"></textarea></label></details>',
    '<p id="cat-file-status" class="help">Choose an original source file.</p><div class="actions"><button id="cat-upload" type="button">Retain source file</button></div>',
    '<label>Retained source<select id="cat-source"></select></label><div id="cat-source-info" class="cat-source-info"></div>',
    '</article></section>',
    '<section id="cat-panel-review" aria-label="Catalog edition review" hidden>',
    '<h3>Create a reviewable edition</h3><div class="two-column"><label>Retained input source<select id="cat-review-source"></select></label><label>Update interpretation<select id="cat-mode"><option value="full">Full catalog replacement</option><option value="delta">Declared upserts and deletes</option></select></label></div>',
    '<label>Comparison base<select id="cat-base"></select></label><div class="actions"><button id="cat-preview" type="button" class="primary">Build edition for review</button></div><p class="help">A full source defines the complete resulting catalog. A delta applies its declared operations to the selected base edition.</p>',
    '<article><label>Retained edition<select id="cat-edition"></select></label><p id="cat-edition-summary" class="summary">Build or choose an edition.</p><div id="cat-counts" class="cat-counts"></div>',
    '<div class="actions"><button id="cat-select" type="button" class="primary">Select reviewed edition</button><button id="cat-use-edition-mapping" type="button">Use this edition\'s mapping</button><span id="cat-selection-note" class="help"></span></div>',
    '<details><summary>Edition mapping and source identity</summary><pre id="cat-edition-meta"></pre></details>',
    '<div class="cat-table-controls"><label>Rows<select id="cat-row-mode"><option value="materials">Complete resulting materials</option><option value="changes">Changes from the selected base</option></select></label><label id="cat-search-label">Find a material<input id="cat-search" type="search" placeholder="Identifier or title"></label><button id="cat-search-run" type="button">Show rows</button></div>',
    '<div id="cat-table" class="table-wrap"></div><div class="actions"><button id="cat-previous" type="button">Previous rows</button><span id="cat-page" class="help"></span><button id="cat-next" type="button">Next rows</button></div><details id="cat-row-detail" hidden><summary>Complete retained row</summary><pre id="cat-row-json"></pre></details></article>',
    '</section>',
    '<section id="cat-panel-matches" aria-label="Customer material decisions" hidden>',
    '<h3>Resolve a customer description</h3><p class="help">Search the selected catalog edition, inspect the returned material and save the operator decision against that exact material checksum.</p>',
    '<label>Customer identifier<input id="cat-customer" maxlength="256" autocomplete="off"></label><label>Customer material description<textarea id="cat-description" rows="3" maxlength="2000"></textarea></label>',
    '<div class="cat-field-grid"><label>Category<select id="cat-match-category"></select></label><label>Manufacturer<select id="cat-match-manufacturer"></select></label><label>Quantity unit<select id="cat-match-unit"></select></label></div>',
    '<div class="actions"><button id="cat-find" type="button" class="primary">Find candidate materials</button></div><p id="cat-match-summary" class="summary"></p><div id="cat-candidates" class="table-wrap"></div>',
    '<div class="actions"><button id="cat-match-previous" type="button">Previous candidates</button><button id="cat-match-next" type="button">Next candidates</button></div>',
    '<details id="cat-selected-material" hidden><summary>Selected original material</summary><pre id="cat-selected-material-json"></pre><h3>Review an exact quantity</h3><div class="cat-quantity-fields"><label>Original quantity<input id="cat-quantity" inputmode="decimal" maxlength="59" value="1" autocomplete="off"></label><label>Declared source unit<select id="cat-quantity-unit"></select></label><button id="cat-quantity-run" type="button">Calculate base quantity</button></div><p id="cat-quantity-summary" class="help">Choose a declared material unit and retain the exact conversion with the selected material.</p><pre id="cat-quantity-result" hidden></pre><a id="cat-quantity-download" hidden>Download reviewed quantity JSON</a></details>',
    '<label>Operator decision note<textarea id="cat-decision-note" rows="3" maxlength="4000"></textarea></label><div class="actions"><button id="cat-approve" type="button" class="primary">Approve selected match</button><button id="cat-reject" type="button">Reject selected match</button></div>',
    '<article><div class="section-heading"><div><h3>Retained customer decisions</h3><p class="help">A later catalog change marks affected decisions for review while retaining their original revision and material.</p></div><button id="cat-decisions-refresh" type="button">Refresh decisions</button></div>',
    '<div id="cat-decisions" class="table-wrap"></div><div class="actions"><button id="cat-decisions-previous" type="button">Previous decisions</button><span id="cat-decisions-page" class="help"></span><button id="cat-decisions-next" type="button">Next decisions</button></div></article>',
    '</section>',
    '<section id="cat-panel-handover" aria-label="Catalog search and handover" hidden>',
    '<h3>Continue through the original search workspace</h3><p class="help">Create a query draft for the selected catalog edition. The existing Draft, Result editions, Search relevance, Merchant packages and Deployment views carry it through native search and customer delivery.</p>',
    '<div class="two-column"><label>OpenSearch index<input id="cat-index" maxlength="255" placeholder="materials-reviewed"></label><label>Query variant<select id="cat-variant"><option value="baseline">Description and title baseline</option><option value="identifiers">Identifiers and material text</option></select></label></div>',
    '<label>Query draft title<input id="cat-draft-title" maxlength="120"></label><div class="actions"><button id="cat-create-draft" type="button" class="primary">Create search draft</button></div>',
    '<h3>Download selected catalog and customer files</h3><p class="help">Each download comes from the retained edition. Index and source files use the index name above.</p><div id="cat-exports" class="file-list"></div>',
    '<article><h3>Move a complete catalog</h3><p class="help">The catalog bundle carries retained catalog histories, exact original source files and customer decisions. Import its original bytes to reopen that same catalog identity in another workspace.</p>',
    '<a id="cat-bundle-download" hidden>Download complete catalog bundle</a><label>Retained catalog bundle<input id="cat-bundle-file" type="file" accept=".jsonl,.ndjson,application/x-ndjson,application/json"></label>',
    '<p id="cat-bundle-status" class="help">Choose a complete catalog-bundle JSONL file.</p><div class="actions"><button id="cat-import" type="button">Import retained catalog</button></div></article>',
    '</section>',
  ].join('');
  const supplierPanel = element('section', undefined, { id: 'cat-panel-supplier', 'aria-label': 'Supplier delivery', hidden: '' });
  section.append(supplierPanel);
  document.querySelector('main').append(section);
  supplier = createSupplierController({ container: supplierPanel, api, perform, host, notice, element, attempt });
  for (const [key, label, placeholder] of FIELDS) {
    const field = element('label', label);
    const input = element('input', undefined, { id: 'cat-field-' + key, placeholder, autocomplete: 'off', spellcheck: 'false' });
    field.append(input); $('cat-fields').append(field);
    input.addEventListener('input', changed);
  }
  function options(id, rows, label, chosen, empty = 'Choose a saved item') {
    const select = $(id), previous = chosen ?? select.value;
    select.replaceChildren(element('option', empty, { value: '' }));
    for (const row of rows) select.append(element('option', label(row), { value: row.id }));
    if (rows.some(row => row.id === previous)) select.value = previous;
    return select.value;
  }
  function panel(name) {
    selectedPanel = name;
    for (const id of ['setup', 'review', 'matches', 'handover', 'supplier']) $('cat-panel-' + id).hidden = id !== name;
    for (const button of section.querySelectorAll('[data-catalog-view]')) button.setAttribute('aria-selected', String(button.dataset.catalogView === name));
  }
  function changed() { dirty = true; buttons(); }
  function descriptor(value) {
    if (!value.trim() || value.trim() === 'null') return null;
    if (/^[{["]/.test(value.trim())) {
      try { return JSON.parse(value); } catch { throw new Error('A complex mapped field must contain complete JSON. The mapping is retained in the editor.'); }
    }
    return value;
  }
  function json(id, label) {
    try { return JSON.parse($(id).value); } catch { throw new Error(label + ' must contain complete JSON. The editor is retained.'); }
  }
  function mappingValue() {
    return { schema: MAPPING_SCHEMA, fields: Object.fromEntries(FIELDS.map(([key]) => [key, descriptor($('cat-field-' + key).value)])),
      references: json('cat-references', 'Material references'), attributes: json('cat-attributes', 'Source attributes'),
      identifierPolicy: $('cat-policy').value, unitAliases: json('cat-aliases', 'Unit aliases'), delta: json('cat-delta', 'Delta mapping') };
  }
  function fillMapping(mapping) {
    for (const [key] of FIELDS) {
      const value = mapping.fields?.[key];
      $('cat-field-' + key).value = value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
    }
    $('cat-policy').value = mapping.identifierPolicy ?? 'exact';
    for (const [id, value] of [['cat-references', mapping.references ?? []], ['cat-attributes', mapping.attributes ?? {}],
      ['cat-aliases', mapping.unitAliases ?? {}], ['cat-delta', mapping.delta ?? null]]) $(id).value = pretty(value);
  }
  function fillCatalog(value) {
    catalog = value;
    supplier?.setCatalog(value, catalogEditions());
    $('cat-title').value = value?.title ?? '';
    $('cat-tenant').value = value?.tenantId ?? '';
    fillMapping(value?.mapping ?? emptyMapping());
    dirty = !value;
    $('cat-draft-title').value = value ? (value.title + ' search').slice(0, 120) : '';
    $('cat-catalog').value = value?.id ?? '';
    $('cat-identity').textContent = value ? [value.title, 'Tenant ' + value.tenantId, 'Revision ' + value.revision,
      'Selected edition ' + (value.activeEditionId ?? 'none')].join(' · ') : 'New catalog · enter its title, tenant and material identifier mapping.';
    buttons();
  }
  function catalogEditions() { return snapshot.editions.filter(item => item.catalogId === catalog?.id); }
  function renderSelections() {
    options('cat-catalog', snapshot.catalogs, item => item.title + ' · ' + item.tenantId + ' · revision ' + item.revision, catalog?.id, 'New catalog');
    for (const id of ['cat-source', 'cat-review-source', 'cat-lookup-source'])
      options(id, snapshot.sources, item => item.name + ' · ' + item.bytes + ' bytes', id === 'cat-lookup-source' ? undefined : sourceId, 'Choose a retained source');
    const editions = catalogEditions();
    options('cat-base', editions, item => item.id + ' · ' + text(item.counts?.total) + ' materials', undefined, 'No base — first full edition');
    if (!$('cat-base').value && catalog?.activeEditionId) $('cat-base').value = catalog.activeEditionId;
    options('cat-edition', editions, item => item.id + ' · ' + (item.id === catalog?.activeEditionId ? 'selected' : item.state ?? 'retained'),
      edition?.catalogId === catalog?.id ? edition.id : catalog?.activeEditionId, 'Choose a retained edition');
    renderExports();
  }
  async function read(action) {
    if (reading) return;
    reading = true; buttons();
    try { return await action(); } finally { reading = false; buttons(); }
  }
  function clearMatches() {
    clearQuantity();
    matchInput = null; matchCandidates = []; matchChosen = null; matchOffset = 0; matchNext = null;
    $('cat-match-summary').textContent = '';
    $('cat-candidates').replaceChildren();
    $('cat-selected-material').hidden = true;
    buttons();
  }
  async function openCatalog(id) {
    const value = await api('/api/catalog/catalogs/' + encoded(id));
    const previous = catalog?.id, previousRevision = catalog?.revision;
    fillCatalog(value);
    if (previous === value.id && previousRevision !== value.revision) clearMatches();
    if (previous !== value.id) {
      edition = null; pageOffset = 0; editingDecision = null; decisionOffset = 0;
      clearMatches(); $('cat-decisions').replaceChildren(); $('cat-description').value = ''; $('cat-customer').value = ''; $('cat-decision-note').value = '';
    }
    renderSelections();
    await loadFacets();
    const chosen = $('cat-edition').value;
    if (chosen) await openEdition(chosen);
    else renderEdition(null);
    await supplier.sync(catalog, catalogEditions());
  }
  async function loadFacets() {
    const value = catalog?.activeEditionId ? await api('/api/catalog/facets?' + new URLSearchParams({ catalogId: catalog.id })) : { facets: {} };
    for (const key of ['category', 'manufacturer', 'unit']) {
      const target = $('cat-match-' + key), previous = target.value;
      target.replaceChildren(element('option', 'All ' + (key === 'unit' ? 'units' : key === 'category' ? 'categories' : 'manufacturers'), { value: '' }));
      for (const row of value.facets?.[key] ?? []) target.append(element('option', row.value + ' · ' + row.count, { value: row.value }));
      if ([...target.options].some(option => option.value === previous)) target.value = previous;
    }
  }
  async function sync() {
    snapshot = host.data?.catalog ?? await api('/api/catalog/state');
    snapshot = { catalogs: snapshot.catalogs ?? [], sources: snapshot.sources ?? [], editions: snapshot.editions ?? [] };
    const saved = snapshot.catalogs.find(item => item.id === catalog?.id);
    if (!catalog && !dirty && snapshot.catalogs.length) await openCatalog(snapshot.catalogs[0].id);
    else if (catalog && saved && saved.revision !== catalog.revision && !dirty) await openCatalog(catalog.id);
    renderSelections();
    await supplier.sync(catalog, catalogEditions());
    buttons();
  }
  async function selectSource(id) {
    sourceId = id; $('cat-source').value = id; $('cat-review-source').value = id;
    const target = $('cat-source-info'); target.replaceChildren();
    if (!id) return;
    const value = await api('/api/catalog/sources/' + encoded(id));
    target.append(element('p', value.name + ' · ' + value.bytes + ' bytes · ' + (value.format?.kind ?? 'retained file')),
      element('p', 'SHA-256 ' + value.sha256, { class: 'code' }));
    if (value.provenance?.url) target.append(element('p', 'Original source: ' + value.provenance.url));
    if (value.provenance?.publisher || value.provenance?.revision)
      target.append(element('p', [value.provenance.publisher, value.provenance.revision].filter(Boolean).join(' · ')));
    if (value.columns) target.append(element('p', 'Retained fields: ' + value.columns.join(', '), { class: 'code' }));
  }
  function renderEdition(value) {
    edition = value; pageOffset = 0; pageNext = null; $('cat-row-detail').hidden = true;
    $('cat-edition-summary').textContent = value ? ['Edition ' + value.id, value.state, 'Source ' + (value.source?.name ?? value.source?.id ?? ''),
      value.baseEditionId ? 'Compared with ' + value.baseEditionId : 'First retained edition'].filter(Boolean).join(' · ') : 'Build or choose an edition.';
    $('cat-counts').replaceChildren();
    if (value) for (const [key, title] of [['total', 'Resulting materials'], ['added', 'Added'], ['changed', 'Changed'],
      ['removed', 'Removed'], ['unchanged', 'Unchanged'], ['missingUnit', 'Without a quantity unit']]) {
      const box = element('div'); box.append(element('strong', text(value.counts?.[key])), element('span', title)); $('cat-counts').append(box);
    }
    $('cat-edition-meta').textContent = value ? pretty({ id: value.id, catalogId: value.catalogId, mapping: value.mapping,
      source: value.source, baseEditionId: value.baseEditionId, counts: value.counts, reviewSha256: value.reviewSha256 }) : '';
    $('cat-table').replaceChildren();
    $('cat-page').textContent = '';
    if (value) $('cat-edition').value = value.id;
    renderExports(); buttons();
  }
  async function openEdition(id) {
    const value = await api('/api/catalog/editions/' + encoded(id));
    if (catalog && value.catalogId !== catalog.id) throw new Error('Select an edition belonging to the open catalog.');
    renderEdition(value); await loadRows();
  }
  function table(target, columns, rows, cells, action) {
    target.replaceChildren();
    if (!rows.length) return target.append(element('p', 'No retained rows match this selection.', { class: 'empty' }));
    const result = element('table'), head = element('thead'), header = element('tr');
    for (const title of [...columns, '']) header.append(element('th', title, { scope: 'col' }));
    head.append(header); result.append(head);
    const body = element('tbody');
    for (const row of rows) {
      const tr = element('tr');
      for (const value of cells(row)) tr.append(element('td', text(value)));
      const cell = element('td'), button = element('button', action?.label ?? 'Inspect', { type: 'button' });
      button.addEventListener('click', () => attempt(() => action?.run ? action.run(row) : inspectRow(row)));
      cell.append(button); tr.append(cell); body.append(tr);
    }
    result.append(body); target.append(result);
  }
  function inspectRow(row) { $('cat-row-json').textContent = pretty(row); $('cat-row-detail').hidden = false; $('cat-row-detail').open = true; }
  async function loadRows() {
    if (!edition) return;
    const input = { editionId: edition.id, offset: String(pageOffset), limit: '50' };
    if (rowMode === 'materials' && $('cat-search').value) input.search = $('cat-search').value;
    const result = await api('/api/catalog/' + rowMode + '?' + new URLSearchParams(input));
    pageNext = result.nextOffset ?? null;
    if (rowMode === 'materials') table($('cat-table'), ['Material', 'Title', 'Part number', 'Manufacturer', 'Base unit', 'Sales unit', 'Sales-to-base ratio'],
      result.rows, row => [row.materialId, row.title, row.partNumber, row.manufacturer, row.unit, row.salesUnit,
        row.salesToBase ? row.salesToBase.numerator + '/' + row.salesToBase.denominator : null]);
    else table($('cat-table'), ['Change', 'Material', 'Changed fields'], result.rows,
      row => [row.kind, row.materialId, row.fields?.join(', ') ?? '']);
    $('cat-page').textContent = result.total ? (pageOffset + 1) + '–' + (pageOffset + result.rows.length) + ' of ' + result.total : '0 rows';
    $('cat-row-detail').hidden = true; buttons();
  }
  function selectCandidate(candidate) {
    matchChosen = candidate; clearQuantity();
    const units = [...new Set([candidate.material.unit, candidate.material.salesToBase ? candidate.material.salesUnit : null].filter(Boolean))];
    $('cat-quantity-unit').replaceChildren(...units.map(unit => element('option', unit, { value: unit })));
    $('cat-selected-material-json').textContent = pretty(candidate.material);
    $('cat-selected-material').hidden = false; $('cat-selected-material').open = true;
    $('cat-match-summary').textContent = 'Selected ' + candidate.material.materialId + ' · ' + candidate.material.title +
      (editingDecision ? ' · reviewing decision revision ' + editingDecision.revision : '');
    buttons();
  }
  function clearQuantity() {
    if (quantityUrl) { URL.revokeObjectURL(quantityUrl); quantityUrl = null; }
    $('cat-quantity-result').textContent = ''; $('cat-quantity-result').hidden = true;
    $('cat-quantity-download').hidden = true; $('cat-quantity-download').removeAttribute('href');
    $('cat-quantity-summary').textContent = 'Choose a declared material unit and retain the exact conversion with the selected material.';
  }
  async function calculateQuantity() {
    if (!matchChosen || !catalog) throw new Error('Select a current material before reviewing its quantity.');
    clearQuantity();
    const material = matchChosen.material;
    const result = await api('/api/catalog/quantity?' + new URLSearchParams({
      catalogId: catalog.id, materialKey: material.key, expectedMaterialSha256: material.sha256,
      quantity: $('cat-quantity').value, unit: $('cat-quantity-unit').value,
    }));
    const amount = result.quantity, base = amount.baseQuantity;
    $('cat-quantity-summary').textContent = amount.quantity + ' ' + amount.requestedUnit + ' = ' +
      (base.decimal ?? (base.numerator + '/' + base.denominator)) + ' ' + amount.baseUnit +
      ' · material ' + result.materialId + ' · edition ' + result.editionId;
    const content = pretty(result) + '\n';
    $('cat-quantity-result').textContent = content; $('cat-quantity-result').hidden = false;
    quantityUrl = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const link = $('cat-quantity-download');
    link.href = quantityUrl; link.download = material.materialId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100) + '-quantity.json'; link.hidden = false;
  }
  async function findMatches(reset = false) {
    if (!catalog?.activeEditionId) throw new Error('Select a reviewed catalog edition before resolving a customer description.');
    if (reset) { matchOffset = 0; editingDecision = null; }
    const input = { catalogId: catalog.id, text: $('cat-description').value, customerId: $('cat-customer').value,
      offset: matchOffset, limit: 30 };
    for (const key of ['category', 'manufacturer', 'unit']) if ($('cat-match-' + key).value) input[key] = $('cat-match-' + key).value;
    const value = await api('/api/catalog/suggest', input);
    matchInput = { catalogId: catalog.id, catalogRevision: catalog.revision, description: input.text,
      customerId: input.customerId, editionId: value.editionId };
    matchCandidates = value.candidates; matchNext = value.nextOffset ?? null; matchChosen = null;
    editingDecision = value.approved ?? editingDecision;
    table($('cat-candidates'), ['Material', 'Description', 'Part number', 'Unit', 'Matching reason'], value.candidates,
      row => [row.material.materialId, row.material.title, row.material.partNumber, row.material.unit, row.reason],
      { label: 'Select', run: selectCandidate });
    const decision = value.approved;
    $('cat-match-summary').textContent = [value.total + ' candidate materials from edition ' + value.editionId,
      decision ? 'Retained decision: ' + decision.currentStatus + ' · revision ' + decision.revision : 'Choose a candidate and record the operator decision.'].join(' · ');
    $('cat-selected-material').hidden = true;
    if (decision?.note && !$('cat-decision-note').value) $('cat-decision-note').value = decision.note;
    if (decision?.currentStatus === 'APPROVED') {
      const approved = matchCandidates.find(candidate => candidate.material.key === decision.materialKey && candidate.material.sha256 === decision.materialSha256);
      if (approved) selectCandidate(approved);
    }
    buttons();
  }
  async function saveDecision(status) {
    if (!matchChosen || !matchInput || !catalog) throw new Error('Find and select a current candidate first.');
    if (!matchInput.customerId.trim()) throw new Error('Enter the customer identifier and find candidates again before saving a customer decision.');
    const values = { action: 'decision', catalogId: matchInput.catalogId, expectedCatalogRevision: matchInput.catalogRevision,
      customerId: matchInput.customerId, description: matchInput.description, materialKey: matchChosen.material.key,
      expectedMaterialSha256: matchChosen.material.sha256, note: $('cat-decision-note').value, status };
    if (editingDecision) { values.decisionId = editingDecision.id; values.expectedRevision = editingDecision.revision; }
    await perform('catalog', values);
  }
  async function loadDecisions() {
    if (!catalog) return;
    const value = await api('/api/catalog/decisions?' + new URLSearchParams({ catalogId: catalog.id, offset: String(decisionOffset), limit: '50' }));
    decisionNext = value.nextOffset ?? null;
    table($('cat-decisions'), ['Customer', 'Description', 'Material', 'Status', 'Revision'], value.rows,
      row => [row.customerId, row.description, row.materialId, row.currentStatus, row.revision], {
        label: 'Review', run: row => read(async () => {
          $('cat-customer').value = row.customerId; $('cat-description').value = row.description;
          $('cat-decision-note').value = row.note ?? ''; editingDecision = row; matchOffset = 0;
          await findMatches(false);
          const chosen = matchCandidates.find(item => item.material.key === row.materialKey);
          if (chosen) selectCandidate(chosen);
        }),
      });
    $('cat-decisions-page').textContent = value.total ? (decisionOffset + 1) + '–' + (decisionOffset + value.rows.length) + ' of ' + value.total : '0 decisions';
    buttons();
  }
  function renderExports() {
    const target = $('cat-exports'); target.replaceChildren();
    const editionId = edition?.catalogId === catalog?.id ? edition.id : catalog?.activeEditionId;
    const index = $('cat-index').value.trim();
    const formats = [['catalog.csv', 'Catalog CSV', false], ['catalog.jsonl', 'Catalog JSON Lines', false],
      ['approved-matches.csv', 'Approved customer matches CSV', false], ['index.json', 'OpenSearch index definition', true],
      ['bulk.ndjson', 'OpenSearch bulk input', true], ['source.json', 'Original search source declaration', true],
      ['search-client.ts', 'Typed search client', true], ['facets.json', 'Retained category, manufacturer and unit facets', false],
      ['delta.ndjson', 'Reviewed OpenSearch change operations', true]];
    for (const [format, label, needsIndex] of formats) {
      const box = element('div');
      if (catalog && editionId && (!needsIndex || index)) {
        const query = { catalogId: catalog.id, format, ...(format === 'approved-matches.csv' ? {} : { editionId }),
          ...(needsIndex ? { index } : {}) };
        box.append(element('a', label, { href: '/api/catalog/export?' + new URLSearchParams(query) }));
      } else box.append(element('span', label + (needsIndex && !index ? ' · enter the index name' : ' · select a catalog edition'), { class: 'muted' }));
      target.append(box);
    }
    $('cat-bundle-download').hidden = !catalog;
    if (catalog) $('cat-bundle-download').href = '/api/catalog/export?' + new URLSearchParams({ catalogId: catalog.id, format: 'catalog-bundle.jsonl' });
  }
  function fileFor(kind) { return $(kind === 'catalog-import' ? 'cat-bundle-file' : 'cat-file').files[0]; }
  async function checksum(file) {
    if (!hashes.has(file)) hashes.set(file, sha256File(file, { onProgress({ bytes, total }) {
      fileNotice = 'Computing original checksum · ' + bytes + ' of ' + total + ' bytes';
      renderFileState();
    } }).catch(error => { hashes.delete(file); throw error; }));
    return hashes.get(file);
  }
  function formatValue() {
    const kind = $('cat-format').value;
    if (['jsonl','xchange-json'].includes(kind)) return { kind };
    if (kind === 'json') return { kind, rowsPath: $('cat-rows-path').value };
    const hasHeader = $('cat-header').checked;
    return { kind, hasHeader, ...(kind === 'csv' ? { delimiter: $('cat-delimiter').value } : {}),
      ...(!hasHeader ? { columns: json('cat-columns', 'Headerless column names') } : {}) };
  }
  function provenanceValue() {
    const result = {};
    for (const [key, id] of [['url', 'cat-source-url'], ['publisher', 'cat-publisher'], ['revision', 'cat-source-revision'],
      ['kind', 'cat-source-kind'], ['note', 'cat-source-note']]) if ($(id).value.trim()) result[key] = $(id).value;
    return result;
  }
  async function submitFile(kind) {
    const file = fileFor(kind);
    if (!file || !file.size) throw new Error('Choose a nonempty original file.');
    reading = true; fileNotice = 'Reading ' + file.name + ' and computing its checksum…'; renderFileState(); buttons();
    let sha256;
    try { sha256 = await checksum(file); } finally { reading = false; buttons(); }
    const values = { name: file.name, bytes: file.size, sha256,
      ...(kind === 'catalog-upload' ? { format: formatValue(), provenance: provenanceValue() } : {}) };
    fileNotice = 'Selected ' + file.name + ' · ' + file.size + ' bytes · SHA-256 ' + sha256;
    renderFileState(); await perform(kind, values);
  }
  async function transmitFile(pending) {
    const file = fileFor(pending.kind);
    if (!file) { panel(pending.kind === 'catalog-import' ? 'handover' : 'setup'); view('catalog');
      throw new Error('Reselect the original file ' + pending.payload.name + ' to retry this retained request. Its metadata and request ID are unchanged.'); }
    if (file.size !== pending.payload.bytes || await checksum(file) !== pending.payload.sha256)
      throw new Error('This file differs from the retained request. Select its original bytes, or read the saved outcome.');
    return api(pending.kind === 'catalog-import' ? '/api/catalog/import' : '/api/catalog/upload', pending.payload, false, file);
  }
  function renderFileState() {
    const pending = ['catalog-upload', 'catalog-import'].includes(host.pending?.kind) ? host.pending : null;
    const description = pending ? 'Retained ' + pending.payload.name + ' · ' + pending.payload.bytes + ' bytes · SHA-256 ' + pending.payload.sha256
      : fileNotice || 'Choose an original source file.';
    $('cat-file-status').textContent = pending?.kind === 'catalog-import' ? fileNotice || 'Choose an original source file.' : description;
    $('cat-bundle-status').textContent = pending?.kind === 'catalog-import' ? description : fileFor('catalog-import')?.name ?? 'Choose a complete catalog-bundle JSONL file.';
    $('cat-pending').hidden = !host.pending?.kind?.startsWith('catalog');
    $('cat-pending-description').textContent = host.pending?.kind?.startsWith('catalog')
      ? 'Original request ' + host.pending.payload.requestId + ' is retained. Read its saved outcome or retry its exact input.' : '';
  }
  function buttons() {
    const busy = reading || host.busy, held = busy || Boolean(host.pending), active = Boolean(catalog?.activeEditionId);
    for (const item of section.querySelectorAll('button,input,select,textarea')) item.disabled = held;
    for (const item of section.querySelectorAll('[data-catalog-view]')) item.disabled = busy;
    $('cat-refresh').disabled = busy;
    $('cat-file').disabled = busy || Boolean(host.pending && host.pending.kind !== 'catalog-upload');
    $('cat-bundle-file').disabled = busy || Boolean(host.pending && host.pending.kind !== 'catalog-import');
    $('cat-pending-read').disabled = busy || !host.pending;
    $('cat-pending-retry').disabled = busy || !host.pending ||
      (['catalog-upload', 'catalog-import'].includes(host.pending.kind) && !fileFor(host.pending.kind));
    $('cat-save').disabled = held || !dirty;
    $('cat-tenant').disabled = held || Boolean(catalog);
    $('cat-preview').disabled = held || !catalog || dirty || !$('cat-review-source').value;
    $('cat-reload').disabled = held || !catalog;
    const matchingMapping = edition && catalog && edition.mappingSha256 === catalog.mappingSha256;
    $('cat-select').disabled = held || !catalog || dirty || !edition || !matchingMapping || edition.id === catalog.activeEditionId;
    $('cat-use-edition-mapping').disabled = held || !edition;
    $('cat-selection-note').textContent = !edition ? '' : edition.id === catalog?.activeEditionId
      ? 'This edition is selected.' : !matchingMapping ? 'Use this edition\'s retained mapping and save it before selecting this edition.'
        : 'Selecting this reviewed edition retains the other editions for later use.';
    $('cat-saved').textContent = catalog ? 'Revision ' + catalog.revision + (dirty ? ' · unsaved mapping changes' : ' · saved') : 'New catalog · save its first mapping revision';
    for (const id of ['cat-find', 'cat-create-draft']) $(id).disabled = held || dirty || !active;
    $('cat-approve').disabled = held || dirty || !matchChosen || !matchInput || !matchInput.description.trim() || !matchInput.customerId.trim();
    $('cat-reject').disabled = $('cat-approve').disabled;
    $('cat-quantity-run').disabled = held || dirty || !matchChosen || !$('cat-quantity-unit').value;
    $('cat-search-run').disabled = held || !edition;
    $('cat-previous').disabled = held || !edition || pageOffset === 0;
    $('cat-next').disabled = held || pageNext === null;
    $('cat-match-previous').disabled = held || !matchInput || matchOffset === 0;
    $('cat-match-next').disabled = held || matchNext === null;
    $('cat-decisions-refresh').disabled = busy || !catalog;
    $('cat-decisions-previous').disabled = held || !catalog || decisionOffset === 0;
    $('cat-decisions-next').disabled = held || decisionNext === null;
    $('cat-upload').disabled = held || !fileFor('catalog-upload');
    $('cat-import').disabled = held || !fileFor('catalog-import');
    $('cat-use-lookup').disabled = held || !$('cat-lookup-source').value;
    renderFileState();
    supplier?.buttons();
  }
  function formatControls() {
    const kind = $('cat-format').value, tabular = ['csv', 'tsv'].includes(kind);
    $('cat-tabular').hidden = !tabular;
    $('cat-delimiter-label').hidden = kind !== 'csv';
    $('cat-columns-label').hidden = $('cat-header').checked;
    $('cat-rows-path-label').hidden = kind !== 'json';
  }
  for (const button of section.querySelectorAll('[data-catalog-view]')) button.addEventListener('click', () => {
    panel(button.dataset.catalogView);
    if (selectedPanel === 'matches' && catalog) attempt(() => read(loadDecisions));
    if (selectedPanel === 'supplier' && catalog) attempt(() => read(() => supplier.sync(catalog, catalogEditions())));
  });
  for (const id of ['cat-title', 'cat-tenant', 'cat-policy', 'cat-references', 'cat-attributes', 'cat-aliases', 'cat-delta'])
    $(id).addEventListener('input', changed);
  $('cat-new').addEventListener('click', () => {
    if ((dirty || supplier.hasUnsaved()) && !window.confirm('Create a new catalog and discard these unsaved mapping edits?')) return;
    fillCatalog(null); edition = null; clearMatches(); renderSelections(); renderEdition(null); panel('setup'); notice('Enter the new catalog and its original source mapping.');
  });
  $('cat-catalog').addEventListener('change', () => attempt(() => read(async () => {
    const id = $('cat-catalog').value;
    if (!id) { $('cat-catalog').value = catalog?.id ?? ''; return; }
    if ((dirty || supplier.hasUnsaved()) && !window.confirm('Open another catalog and discard these unsaved mapping edits?')) { $('cat-catalog').value = catalog?.id ?? ''; return; }
    try { await openCatalog(id); } catch (error) { $('cat-catalog').value = catalog?.id ?? ''; throw error; }
  })));
  $('cat-reload').addEventListener('click', () => attempt(() => read(async () => {
    if (!catalog) return;
    if ((dirty || supplier.hasUnsaved()) && !window.confirm('Reload the saved catalog and discard these unsaved mapping edits?')) return;
    await openCatalog(catalog.id); notice('Reopened the current saved catalog revision.');
  })));
  $('cat-save').addEventListener('click', () => attempt(() => perform('catalog', { action: 'save',
    ...(catalog ? { catalogId: catalog.id, expectedRevision: catalog.revision } : {}),
    title: $('cat-title').value, tenantId: $('cat-tenant').value, mapping: mappingValue() })));
  $('cat-sap').addEventListener('click', () => {
    const mapping = emptyMapping();
    Object.assign(mapping.fields, { materialId: 'PRODUCTID', title: 'NAME', description: 'DESCRIPTION', category: 'CATEGORY', unit: 'QUANTITYUNIT' });
    mapping.attributes = { supplier: 'SUPPLIER.PARTNERID', price: 'PRICE', currency: 'CURRENCY', weight: 'WEIGHTMEASURE',
      weightUnit: 'WEIGHTUNIT', width: 'WIDTH', depth: 'DEPTH', height: 'HEIGHT', dimensionUnit: 'DIMENSIONUNIT' };
    fillMapping(mapping); changed(); notice('SAP product columns are mapped. Review the selected source fields and save the mapping.');
  });
  $('cat-xchange').addEventListener('click', () => attempt(() => read(async () => {
    const template = await api('/api/catalog/supplier/profile?target=xchange-2.0');
    fillMapping(template.catalogMapping);$('cat-format').value='xchange-json';formatControls();changed();
    notice('The complete native xChange product and supplier context are mapped. Save this mapping, then retain and review the original document.');
  })));
  $('cat-use-lookup').addEventListener('click', () => attempt(async () => {
    const lines = id => $(id).value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    const lookup = { sourceId: $('cat-lookup-source').value, key: lines('cat-lookup-key'), from: lines('cat-lookup-from'),
      value: $('cat-lookup-value').value, where: json('cat-lookup-where', 'Lookup equality filters') };
    $('cat-field-' + $('cat-lookup-target').value).value = JSON.stringify({ lookup }); changed();
    notice('The retained lookup is in the mapping editor. Save the reviewed catalog revision.');
  }));
  $('cat-lookup-source').addEventListener('change', buttons);
  for (const id of ['cat-source', 'cat-review-source']) $(id).addEventListener('change', () => attempt(() => read(async () => { await selectSource($(id).value); buttons(); })));
  $('cat-format').addEventListener('change', formatControls); $('cat-header').addEventListener('change', formatControls);
  $('cat-file').addEventListener('change', () => { fileNotice = fileFor('catalog-upload')?.name ?? ''; renderFileState(); buttons(); });
  $('cat-bundle-file').addEventListener('change', () => { renderFileState(); buttons(); });
  $('cat-upload').addEventListener('click', () => attempt(() => submitFile('catalog-upload')));
  $('cat-import').addEventListener('click', () => attempt(() => submitFile('catalog-import')));
  $('cat-pending-read').addEventListener('click', () => attempt(recover));
  $('cat-pending-retry').addEventListener('click', () => attempt(retry));
  $('cat-preview').addEventListener('click', () => attempt(() => perform('catalog', { action: 'preview', catalogId: catalog.id,
    expectedRevision: catalog.revision, sourceId: $('cat-review-source').value, mode: $('cat-mode').value, baseEditionId: $('cat-base').value || null })));
  $('cat-edition').addEventListener('change', () => attempt(() => read(async () => {
    if ($('cat-edition').value) await openEdition($('cat-edition').value); else renderEdition(null);
  })));
  $('cat-select').addEventListener('click', () => attempt(() => perform('catalog', { action: 'select', catalogId: catalog.id,
    expectedRevision: catalog.revision, editionId: edition.id, reviewSha256: edition.reviewSha256 })));
  $('cat-use-edition-mapping').addEventListener('click', () => {
    fillMapping(edition.mapping); changed(); panel('setup');
    notice('The retained edition mapping is in the editor. Save it, then select that reviewed edition.');
  });
  $('cat-row-mode').addEventListener('change', () => attempt(() => read(async () => {
    rowMode = $('cat-row-mode').value; $('cat-search-label').hidden = rowMode !== 'materials'; pageOffset = 0; await loadRows();
  })));
  $('cat-search-run').addEventListener('click', () => attempt(() => read(async () => { pageOffset = 0; await loadRows(); })));
  $('cat-search').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); $('cat-search-run').click(); } });
  $('cat-previous').addEventListener('click', () => attempt(() => read(async () => { pageOffset = Math.max(0, pageOffset - 50); await loadRows(); })));
  $('cat-next').addEventListener('click', () => attempt(() => read(async () => { pageOffset = pageNext; await loadRows(); })));
  for (const id of ['cat-description', 'cat-customer', 'cat-match-category', 'cat-match-manufacturer', 'cat-match-unit']) $(id).addEventListener('input', () => { editingDecision = null; clearMatches(); });
  $('cat-find').addEventListener('click', () => attempt(() => read(() => findMatches(true))));
  $('cat-match-previous').addEventListener('click', () => attempt(() => read(async () => { matchOffset = Math.max(0, matchOffset - 30); await findMatches(false); })));
  $('cat-match-next').addEventListener('click', () => attempt(() => read(async () => { matchOffset = matchNext; await findMatches(false); })));
  for (const id of ['cat-quantity', 'cat-quantity-unit']) $(id).addEventListener('input', clearQuantity);
  $('cat-quantity-run').addEventListener('click', () => attempt(() => read(calculateQuantity)));
  $('cat-approve').addEventListener('click', () => attempt(() => saveDecision('APPROVED')));
  $('cat-reject').addEventListener('click', () => attempt(() => saveDecision('REJECTED')));
  $('cat-decisions-refresh').addEventListener('click', () => attempt(() => read(async () => { decisionOffset = 0; await loadDecisions(); })));
  $('cat-decisions-previous').addEventListener('click', () => attempt(() => read(async () => { decisionOffset = Math.max(0, decisionOffset - 50); await loadDecisions(); })));
  $('cat-decisions-next').addEventListener('click', () => attempt(() => read(async () => { decisionOffset = decisionNext; await loadDecisions(); })));
  $('cat-index').addEventListener('input', renderExports);
  $('cat-create-draft').addEventListener('click', () => attempt(() => perform('catalog', { action: 'create-draft', catalogId: catalog.id,
    expectedRevision: catalog.revision, index: $('cat-index').value.trim(), variant: $('cat-variant').value,
    ...($('cat-draft-title').value.trim() ? { title: $('cat-draft-title').value } : {}) })));
  $('cat-refresh').addEventListener('click', () => attempt(refresh));
  formatControls();
  return { sync, buttons, transmitFile, hasUnsaved: () => dirty || supplier.hasUnsaved(),
    restorePending(pending) {
      supplier.restorePending(pending);
      if (pending?.kind === 'catalog' && pending.payload.action === 'save') {
        const input = pending.payload;
        const selected = input.catalogId ? snapshot.catalogs.find(item => item.id === input.catalogId) : null;
        fillCatalog(input.catalogId ? { ...selected, id: input.catalogId, revision: input.expectedRevision,
          title: input.title, tenantId: input.tenantId, mapping: input.mapping } : null);
        $('cat-title').value = input.title; $('cat-tenant').value = input.tenantId;
        fillMapping(input.mapping); dirty = true; edition = null; clearMatches(); renderSelections(); renderEdition(null);
      }
      renderFileState(); buttons();
    },
    async acceptOperation(operation) {
      if (!operation.kind?.startsWith('catalog-')) return false;
      const result = operation.result ?? {};
      if (operation.kind.startsWith('catalog-supplier-')) {
        const owner = result.supplierPlan ?? result.supplierCorrection ?? result.supplierReview;
        if (owner?.catalogId && owner.catalogId !== catalog?.id) await openCatalog(owner.catalogId);
        if (await supplier.acceptOperation(operation)) { panel('supplier'); view('catalog'); return true; }
      }
      if (result.catalog) {
        await openCatalog(result.catalog.id); panel(operation.kind === 'catalog-save' && !catalog.activeEditionId ? 'setup' : 'review');
        notice('Saved catalog revision ' + catalog.revision + (catalog.activeEditionId ? ' · selected edition ' + catalog.activeEditionId : '') + '.');
      } else if (result.source) {
        await selectSource(result.source.id); panel('setup');
        notice('Retained original source ' + result.source.name + ' with its exact bytes and checksum.');
      } else if (result.edition) {
        if (catalog?.id !== result.edition.catalogId) await openCatalog(result.edition.catalogId);
        await openEdition(result.edition.id); panel('review');
        notice('The complete catalog edition is ready for review and selection.');
      } else if (result.decision) {
        editingDecision = result.decision; panel('matches'); await loadDecisions();
        notice('Saved customer decision revision ' + result.decision.revision + ' against its selected original material.');
      } else return false;
      view('catalog'); return true;
    },
  };
}
