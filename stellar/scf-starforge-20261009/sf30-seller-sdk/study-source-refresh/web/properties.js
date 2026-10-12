'use strict';
(() => {
  const pr = { data: null, packet: null, edition: null, raw: null, property: null, review: null, chosen: new Set(), choices: [], selection: null };
  const panel = h('section', { id: 'view-properties', hidden: true });
  panel.innerHTML = [
    '<div class="heading"><div><h1>Property research</h1><p>Retain survey sources, review revised records and select comparable supply for each study purpose.</p></div></div>',
    '<div class="property-toolbar"><label>Operator<input id="pr-operator" placeholder="Name or team" autocomplete="name"></label><div id="pr-counts" class="muted"></div></div>',
    '<nav class="property-tabs" aria-label="Property research"><button data-pr-view="intake">Source intake</button><button data-pr-view="survey">Study &amp; surveys</button><button data-pr-view="review">Change review</button><button data-pr-view="selection">Comparables</button><button data-pr-view="delivery">Delivery</button></nav>',
    '<div id="pr-view-intake">',
      '<div class="panel"><h2>Load a survey intake</h2><p>Select the original structured intake. Its document references, study area and property schedules will be shown before you freeze an edition.</p>',
      '<label>Survey intake JSON<input id="pr-intake-file" type="file" accept=".json,application/json"></label><div id="pr-intake-preview" class="property-space"></div>',
      '<div id="pr-document-bindings"></div><label>Edition label<input id="pr-intake-label" placeholder="Survey source and observation period"></label><button id="pr-freeze-intake">Freeze survey edition</button></div>',
      '<div class="panel"><h2>Retain an original source document</h2><p>The complete original file stays attached to its source description and page references.</p><form id="pr-document-form" class="form-grid">',
      '<label>Document from loaded intake<select id="pr-document-template"><option value="">Enter source description</option></select></label><label>Source key<input name="key" required placeholder="publisher-study-edition"></label>',
      '<label class="wide">Document title<input name="title" required></label><label>Publisher<input name="publisher"></label><label>Original URL<input name="url" type="url" required></label>',
      '<label>Publication date, if given<input name="published_date" type="date"></label><label>PDF pages<input name="pages" type="number" min="1"></label>',
      '<label>Observation start, if exact<input name="observation_start" type="date"></label><label>Observation end, if exact<input name="observation_end" type="date"></label>',
      '<label class="wide">Published observation label<input name="observation_label" placeholder="Retain month or research window exactly as described"></label>',
      '<label class="wide">Original file<input id="pr-document-file" type="file" required accept=".pdf,.csv,.json,.txt,.html,.xlsx,.geojson,.zip"></label><div><button>Retain original document</button></div></form></div>',
      '<div class="panel"><h2>Retained source documents</h2><div id="pr-document-list"></div></div>',
    '</div>',
    '<div id="pr-view-survey" hidden>',
      '<div class="panel"><div class="heading"><h2>Frozen survey editions</h2><select id="pr-edition"></select></div><div id="pr-study"></div>',
      '<form id="pr-survey-search" class="inline"><label>Find property<input id="pr-search" placeholder="Property, address or programme"></label><button>Find</button></form><div id="pr-property-list"></div><div class="pager"><button id="pr-prev">Previous</button><span id="pr-page"></span><button id="pr-next">Next</button></div></div>',
      '<div id="pr-editor" class="panel" hidden><div class="heading"><h2 id="pr-editor-title">Property survey</h2><button id="pr-close-editor" class="secondary">Close editor</button></div><form id="pr-property-form">',
      '<div class="form-grid"><label>Property name<input name="name" required></label><label>Address<input name="address"></label><label>City<input name="city"></label><label>State / region<input name="state"></label>',
      '<label>Postal code<input name="postal_code"></label><label>Target population<input name="target_population"></label><label>Status as observed<input name="status"></label><label>Supply status<select name="status_kind"><option value="operating">Operating</option><option value="under_construction">Under construction</option><option value="planned">Planned</option><option value="proposed">Proposed</option><option value="unknown">Unspecified</option></select></label><label>Market area membership<input name="market_area_membership"></label>',
      '<label>Year built<input name="year_built" type="number" min="1000" max="9999"></label><label>Year renovated<input name="year_renovated" type="number" min="1000" max="9999"></label>',
      '<label>Operating units<input name="unit_count" type="number" min="0"></label><label>Vacant units<input name="vacant_units" type="number" min="0"></label>',
      '<label>Reported occupancy %<input name="occupancy_pct_reported" inputmode="decimal"></label><label>Waitlist as reported<input name="waitlist"></label>',
      '<label>Observation start, if exact<input name="observation_start" type="date"></label><label>Observation end, if exact<input name="observation_end" type="date"></label>',
      '<label class="wide">Observation label<input name="observation_label"></label><label>Programmes, one per line<textarea name="programs" rows="3"></textarea></label><label>Amenities, one per line<textarea name="amenities" rows="3"></textarea></label></div>',
      '<h3>Unit and rent schedules</h3><p>Keep rent and floor-area ranges in separate endpoints. Source statuses, AMHI and utility responsibility stay with each schedule.</p><div id="pr-unit-editor"></div>',
      '<details><summary>Source references and original fields</summary><label>Property citations JSON<textarea id="pr-citations" rows="7" spellcheck="false"></textarea></label><label>Retained original fields JSON<textarea id="pr-original-fields" rows="7" spellcheck="false"></textarea></label></details>',
      '<div class="form-grid property-space"><label>New edition label<input id="pr-revision-label" required></label><label class="wide">Source reconciliation note<textarea id="pr-revision-note" rows="3" required placeholder="Identify the source change and pages that support this revision"></textarea></label></div>',
      '<button>Freeze revised survey edition</button></form></div>',
      '<details class="panel"><summary>Revise the study area or several properties together</summary><p>Load the complete retained intake, amend the study basis or source-backed records, and freeze another edition.</p><button id="pr-load-packet" class="secondary">Load retained intake</button>',
      '<label>Complete revised intake JSON<textarea id="pr-packet-editor" rows="14" spellcheck="false"></textarea></label><div class="form-grid"><label>New edition label<input id="pr-packet-label"></label><label class="wide">Revision note<textarea id="pr-packet-note" rows="3"></textarea></label></div><button id="pr-revise-packet">Freeze complete revision</button></details>',
    '</div>',
    '<div id="pr-view-review" hidden>',
      '<div class="panel"><h2>Compare survey editions</h2><form id="pr-compare-form" class="form-grid"><label>Baseline<select id="pr-baseline"><option value="">Initial survey</option></select></label><label>Candidate<select id="pr-candidate" required></select></label>',
      '<label>Review label<input name="label" required></label><label>Unchanged records<select name="unchanged"><option value="review">Review each record</option><option value="accept">Accept unchanged records; retain source notes</option></select></label><label class="wide">Comparison note<textarea name="note" rows="3"></textarea></label><div><button>Create change review</button></div></form></div>',
      '<div class="panel"><div class="heading"><h2>Source and revision review</h2><select id="pr-review"></select></div><div id="pr-review-summary"></div><div class="actions"><button id="pr-pick-page" class="secondary">Select this page</button><button id="pr-clear-picks" class="secondary">Clear selection</button></div><div id="pr-review-list"></div>',
      '<div class="pager"><button id="pr-review-prev">Previous</button><span id="pr-review-page"></span><button id="pr-review-next">Next</button></div><label>Review note<textarea id="pr-review-note" rows="3" placeholder="Record the source interpretation or exclusion"></textarea></label><div class="actions"><button id="pr-review-accept">Accept selected source records</button><button id="pr-review-exclude" class="secondary">Exclude selected records</button><span id="pr-review-picked"></span></div></div>',
    '</div>',
    '<div id="pr-view-selection" hidden>',
      '<div class="panel"><h2>Prepare a comparable selection</h2><p>Each selection covers one purpose. A property can be a comparable for one purpose and contextual supply for another.</p>',
      '<div class="form-grid"><label>Completed source review<select id="pr-select-review"></select></label><label>Comparison purpose<input id="pr-purpose" list="pr-purposes" placeholder="For example: market-rate rent comparison"><datalist id="pr-purposes"></datalist></label>',
      '<label>Selection label<input id="pr-select-label"></label><label class="wide">Selection basis<textarea id="pr-select-note" rows="3"></textarea></label></div><div class="actions"><button id="pr-selection-draft">Load properties for this purpose</button><button id="pr-published-draft" class="secondary">Use published comparison as draft</button></div>',
      '<div id="pr-selection-basis"></div><div id="pr-selection-items"></div><button id="pr-freeze-selection">Freeze reviewed selection</button></div>',
      '<div class="panel"><h2>Retained purpose-specific selections</h2><div id="pr-selection-list"></div></div>',
    '</div>',
    '<div id="pr-view-delivery" hidden>',
      '<div class="panel"><h2>Analyst report and complete delivery</h2><div class="form-grid"><label>Frozen selection<select id="pr-delivery-selection"></select></label><label>Delivery label<input id="pr-delivery-label"></label></div>',
      '<div class="actions"><button id="pr-preview-report">Read analyst report</button><button id="pr-export">Create complete retained package</button><button id="pr-go-receive" class="secondary">Receive a package</button></div></div>',
      '<div class="panel"><h2>Property research packages</h2><div id="pr-exports"></div></div><div id="pr-report-preview"></div>',
    '</div>'
  ].join('');
  document.querySelector('main').append(panel);
  const nav = h('button', { 'data-view': 'properties', onclick: () => { view('properties'); } }, 'Property research');
  document.querySelector('aside nav').append(nav);
  function section(name) {
    for (const element of panel.querySelectorAll('[id^="pr-view-"]')) element.hidden = element.id !== 'pr-view-' + name;
    for (const element of panel.querySelectorAll('[data-pr-view]')) element.classList.toggle('active', element.dataset.prView === name);
  }
  for (const element of panel.querySelectorAll('[data-pr-view]')) element.onclick = () => section(element.dataset.prView);
  function operator() {
    const name = $('pr-operator').value.trim();
    if (!name) throw new Error('Enter the operator name for this saved action.');
    return name;
  }
  const cloneValue = value => JSON.parse(JSON.stringify(value));
  const nullable = value => String(value).trim() === '' ? null : String(value).trim();
  const countValue = value => nullable(value) === null ? null : Number(value);
  const showValue = value => value === null || value === undefined ? '—' : Array.isArray(value) ? value.join(', ') : typeof value === 'object' ? JSON.stringify(value) : String(value);
  function setOptions(id, values, label, empty = null) { options(id, values, label, empty); }
  function period(value) { return value.observation_label || [value.observation_start, value.observation_end].filter(Boolean).join(' – ') || 'Observation period unspecified'; }
  function rangeValue(a, b) { return a === b ? showValue(a) : showValue(a) + ' – ' + showValue(b); }
  function citeText(values) { return values.map(c => c.document_key + ' · PDF ' + showValue(c.pdf_page) + ' / ' + showValue(c.printed_page) + ' · ' + c.locator).join('\n'); }
  function sourceButtons(values) {
    return values.map(c => {
      const doc = pr.data.documents.find(d => d.key === c.document_key && pr.edition && pr.edition.document_ids[c.document_key] === d.id);
      return doc ? button(c.document_key + ' · PDF ' + showValue(c.pdf_page), () => download({ kind: 'property_document', id: doc.id, path: doc.files[0].path }, doc.key + '.pdf'), true) : h('span', {}, citeText([c]));
    });
  }
  async function refreshProperty() {
    pr.data = await api('property.status');
    $('pr-counts').textContent = pr.data.documents.length + ' originals · ' + pr.data.editions.length + ' survey editions · ' + pr.data.selections.length + ' selections';
    setOptions('pr-edition', pr.data.editions, x => x.label);
    setOptions('pr-baseline', pr.data.editions, x => x.label, 'Initial survey — no baseline');
    setOptions('pr-candidate', pr.data.editions, x => x.label);
    setOptions('pr-review', pr.data.reviews, x => x.label + ' · review ' + x.version);
    setOptions('pr-select-review', pr.data.reviews, x => x.label + ' · review ' + x.version);
    setOptions('pr-delivery-selection', pr.data.selections, x => x.label + ' · ' + x.purpose);
    $('pr-document-list').replaceChildren(table(['Source', 'Observation period', 'Original file', 'Details'], pr.data.documents.map(d => [
      d.label, period(d.metadata), button('Download original', () => download({ kind: 'property_document', id: d.id, path: d.files[0].path }, d.key + '.' + d.files[0].path.split('.').pop()), true),
      button('Source description', () => show(d.label, d.metadata), true),
    ])));
    $('pr-selection-list').replaceChildren(table(['Selection', 'Purpose', 'Comparables', 'Context', 'Open'], pr.data.selections.map(item => [
      item.label, item.purpose, item.counts.comparable, item.counts.context, button('Read report', async () => {
        $('pr-delivery-selection').value = item.id; section('delivery'); await previewReport();
      }, true),
    ])));
    const packages = (state.data ? state.data.exports : []).filter(x => x.kind === 'property-research');
    $('pr-exports').replaceChildren(table(['Delivery', 'Schedules', 'Report', 'Mapped rows', 'Complete package'], packages.map(item => [
      item.label, item.rows,
      button('HTML report', () => download({ kind: 'export', id: item.id, path: 'report/report.html' }, 'property-report.html'), true),
      button('CSV', () => download({ kind: 'export', id: item.id, path: 'mapped-export/table.csv' }, 'property-schedules.csv'), true),
      button('Download ZIP', async () => { await api('export.archive', { export_id: item.id }); await download({ kind: 'archive', id: item.id }, 'property-research-' + short(item.id) + '.zip'); }),
    ])));
    renderBindings();
    if ($('pr-edition').value && (!pr.edition || pr.edition.id !== $('pr-edition').value)) await readEdition(0);
    const currentReview = pr.data.reviews.find(x => x.id === $('pr-review').value);
    if (currentReview && (!pr.review || pr.review.id !== currentReview.id || pr.review.version !== currentReview.version)) await readReview(0);
  }
  function renderBindings() {
    if (!pr.packet) return;
    const sources = pr.packet.documents || [];
    $('pr-document-bindings').replaceChildren(h('h3', {}, 'Bind retained originals referenced by source citations'), table(['Source document', 'Retained original'], sources.map(doc => {
      const matching = pr.data ? pr.data.documents.filter(d => d.key === doc.key && d.metadata.url === doc.url && d.label === doc.title) : [];
      const select = h('select', { 'data-document-key': doc.key }, h('option', { value: '' }, 'Choose original when referenced'),
        matching.map(d => h('option', { value: d.id }, d.label + ' · ' + short(d.id))));
      if (matching.length === 1) select.value = matching[0].id;
      return [doc.title, select];
    })));
  }
  $('pr-intake-file').onchange = () => run('Load original survey intake', async () => {
    const file = $('pr-intake-file').files[0];
    if (!file) return;
    pr.packet = JSON.parse(await file.text());
    if (pr.packet.schema !== 'stellar-forge.property-survey-intake.v1') throw new Error('Choose a property-survey-intake.v1 packet.');
    $('pr-intake-preview').replaceChildren(h('h3', {}, pr.packet.study.name),
      h('p', {}, pr.packet.properties.length + ' properties · ' + pr.packet.properties.reduce((n, p) => n + (p.units || []).length, 0) + ' unit schedules'),
      h('p', {}, 'Study effective date: ' + showValue(pr.packet.study.effective_date)),
      h('p', {}, pr.packet.study.market_area.boundary_description));
    $('pr-intake-label').value = pr.packet.study.name;
    $('pr-document-template').replaceChildren(h('option', { value: '' }, 'Enter source description'), pr.packet.documents.map(d => h('option', { value: d.key }, d.title)));
    renderBindings();
  });
  $('pr-document-template').onchange = () => {
    const doc = pr.packet && pr.packet.documents.find(d => d.key === $('pr-document-template').value);
    if (!doc) return;
    for (const element of $('pr-document-form').elements) if (element.name) element.value = doc[element.name] === null || doc[element.name] === undefined ? '' : doc[element.name];
  };
  $('pr-document-form').onsubmit = event => {
    event.preventDefault();
    run('Retain complete original document', async () => {
      const fields = Object.fromEntries(new FormData(event.target));
      const original = pr.packet && pr.packet.documents.find(d => d.key === $('pr-document-template').value);
      const metadata = { ...(original ? cloneValue(original) : {}), ...fields };
      for (const key of ['published_date', 'observation_start', 'observation_end', 'observation_label', 'publisher']) metadata[key] = nullable(metadata[key] || '');
      metadata.pages = countValue(fields.pages);
      delete metadata.local_path;
      const file = $('pr-document-file').files[0];
      const response = await fetch('/property-source?name=' + encodeURIComponent(file.name), {
        method: 'POST', headers: { Authorization: 'Bearer ' + state.token, 'Content-Type': 'application/octet-stream',
          'X-Property-Metadata': encodeURIComponent(JSON.stringify(metadata)) }, body: file,
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(readable(result.code) + ' ' + JSON.stringify(result.details || {}));
      await load();
      $('pr-document-file').value = '';
    });
  };
  $('pr-freeze-intake').onclick = () => run('Freeze original survey edition', async () => {
    if (!pr.packet) throw new Error('Load a survey intake first.');
    const document_ids = Object.fromEntries([...$('pr-document-bindings').querySelectorAll('[data-document-key]')].filter(e => e.value).map(e => [e.dataset.documentKey, e.value]));
    const result = await api('property.intake', { packet: pr.packet, document_ids, operator: operator(), label: $('pr-intake-label').value });
    await load(); $('pr-edition').value = result.id; await readEdition(0); section('survey');
  });

  async function readEdition(offset = 0) {
    const edition_id = $('pr-edition').value;
    if (!edition_id) return;
    pr.edition = await api('property.edition.read', { edition_id, search: $('pr-search').value, offset, limit: 25 });
    const study = pr.edition.study;
    $('pr-study').replaceChildren(h('h3', {}, study.name), h('p', {}, study.market_area.name + ' · effective ' + showValue(study.effective_date)),
      h('p', {}, study.market_area.boundary_description), h('p', { className: 'muted' }, study.market_area.selection_notes || ''),
      h('p', {}, study.notes || ''), h('div', { className: 'actions' }, sourceButtons(study.market_area.citations || [])));
    $('pr-property-list').replaceChildren(table(['Property', 'Programme', 'Units', 'Vacant', 'Reported occupancy %', 'Observation period', 'Survey'], pr.edition.properties.map(prop => [
      prop.name, showValue(prop.programs), showValue(prop.unit_count), showValue(prop.vacant_units), showValue(prop.occupancy_pct_reported), period(prop),
      button('Open survey', () => editProperty(prop), true),
    ])));
    $('pr-page').textContent = (pr.edition.total ? offset + 1 : 0) + '–' + Math.min(offset + 25, pr.edition.total) + ' of ' + pr.edition.total;
    $('pr-prev').disabled = offset === 0; $('pr-next').disabled = pr.edition.next === null;
  }
  $('pr-edition').onchange = () => run('Read survey edition', () => { $('pr-editor').hidden = true; return readEdition(0); });
  $('pr-survey-search').onsubmit = event => { event.preventDefault(); run('Find property', () => readEdition(0)); };
  $('pr-prev').onclick = () => run('Read previous properties', () => readEdition(Math.max(0, pr.edition.offset - 25)));
  $('pr-next').onclick = () => run('Read next properties', () => readEdition(pr.edition.next || 0));
  async function editProperty(prop) {
    pr.raw = await api('property.edition.packet', { edition_id: pr.edition.id });
    pr.property = cloneValue(prop);
    const form = $('pr-property-form');
    for (const element of form.elements) {
      if (!element.name) continue;
      const value = prop[element.name];
      element.value = value === null || value === undefined ? '' : Array.isArray(value) ? value.join('\n') : typeof value === 'object' ? JSON.stringify(value) : String(value);
    }
    $('pr-editor-title').textContent = prop.name;
    $('pr-citations').value = pretty(prop.citations);
    $('pr-original-fields').value = pretty(prop.original_fields || {});
    $('pr-revision-label').value = pr.edition.label + ' · source reconciliation';
    $('pr-revision-note').value = '';
    const fields = [
      ['bedrooms', 'Bedrooms'], ['bathrooms', 'Baths'], ['unit_count', 'Units'], ['vacant_units', 'Vacant'],
      ['sqft_min', 'Sq ft min'], ['sqft_max', 'Sq ft max'], ['rent_min', 'Rent min'], ['rent_max', 'Rent max'],
      ['rent_raw', 'Original rent expression'], ['rent_basis', 'Rent basis'], ['rent_period', 'Period'], ['currency', 'Currency'],
      ['ami_percent', 'AMHI %'], ['ami_raw', 'Original AMHI'], ['utility_note', 'Utilities'],
    ];
    $('pr-unit-editor').replaceChildren(...pr.property.units.map(unit => {
      const card = h('details', { className: 'property-unit' }, h('summary', {}, unit.key + ' · ' + showValue(unit.bedrooms) + ' bed · ' + (unit.rent_raw || rangeValue(unit.rent_min, unit.rent_max)) + ' · ' + showValue(unit.ami_raw)));
      const grid = h('div', { className: 'form-grid' });
      for (const [field, label] of fields) {
        grid.append(h('label', {}, label, h('input', { value: unit[field] === null || unit[field] === undefined ? '' : unit[field], 'data-unit-key': unit.key, 'data-unit-field': field })));
      }
      for (const [field, label] of [['utilities_owner', 'Owner-paid utilities, one per line'], ['utilities_tenant', 'Tenant-paid utilities, one per line']]) {
        grid.append(h('label', {}, label, h('textarea', { rows: 2, value: (unit[field] || []).join('\n'), 'data-unit-key': unit.key, 'data-unit-field': field })));
      }
      card.append(grid, h('p', { className: 'muted' }, citeText(unit.citations)), h('div', { className: 'actions' }, sourceButtons(unit.citations)));
      card.append(h('details', {}, h('summary', {}, 'Schedule references and original fields'),
        h('label', {}, 'Citations JSON', h('textarea', { rows: 5, value: pretty(unit.citations), 'data-unit-key': unit.key, 'data-unit-field': 'citations' })),
        h('label', {}, 'Original fields JSON', h('textarea', { rows: 5, value: pretty(unit.original_fields || {}), 'data-unit-key': unit.key, 'data-unit-field': 'original_fields' }))));
      return card;
    }));
    $('pr-editor').hidden = false;
    $('pr-editor').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  $('pr-close-editor').onclick = () => { $('pr-editor').hidden = true; };
  $('pr-property-form').onsubmit = event => {
    event.preventDefault();
    run('Freeze source-backed property revision', async () => {
      if (!pr.property || !pr.raw) throw new Error('Open the property survey first.');
      const prop = cloneValue(pr.property), values = Object.fromEntries(new FormData(event.target));
      for (const [field, value] of Object.entries(values)) {
        if (['programs', 'amenities'].includes(field)) prop[field] = value.split('\n').map(x => x.trim()).filter(Boolean);
        else if (['unit_count', 'vacant_units', 'year_built', 'year_renovated'].includes(field)) prop[field] = countValue(value);
        else if (field === 'waitlist' && typeof pr.property.waitlist === 'object' && pr.property.waitlist !== null) prop[field] = JSON.parse(value);
        else prop[field] = nullable(value);
      }
      prop.citations = JSON.parse($('pr-citations').value);
      prop.original_fields = JSON.parse($('pr-original-fields').value);
      for (const element of $('pr-unit-editor').querySelectorAll('[data-unit-field]')) {
        const unit = prop.units.find(u => u.key === element.dataset.unitKey), field = element.dataset.unitField;
        if (['citations', 'original_fields'].includes(field)) unit[field] = JSON.parse(element.value);
        else if (['utilities_owner', 'utilities_tenant'].includes(field)) unit[field] = element.value.split('\n').map(x => x.trim()).filter(Boolean);
        else if (['unit_count', 'vacant_units'].includes(field)) unit[field] = countValue(element.value);
        else unit[field] = nullable(element.value);
      }
      const packet = cloneValue(pr.raw);
      packet.properties = packet.properties.map(p => p.key === prop.key ? prop : p);
      await saveRevision(packet, $('pr-revision-label').value, $('pr-revision-note').value);
    });
  };
  async function saveRevision(packet, label, note) {
    const result = await api('property.edition.revise', { edition_id: pr.edition.id, packet, label, note, operator: operator() });
    $('pr-editor').hidden = true;
    await load(); $('pr-edition').value = result.id; await readEdition(0);
    $('pr-candidate').value = result.id;
    if (result.previous_id) $('pr-baseline').value = result.previous_id;
  }
  $('pr-load-packet').onclick = () => run('Read retained survey intake', async () => {
    if (!pr.edition) throw new Error('Choose a survey edition.');
    const packet = await api('property.edition.packet', { edition_id: pr.edition.id });
    $('pr-packet-editor').value = pretty(packet);
    $('pr-packet-label').value = pr.edition.label + ' · revised study';
  });
  $('pr-revise-packet').onclick = () => run('Freeze complete survey revision', async () => {
    await saveRevision(JSON.parse($('pr-packet-editor').value), $('pr-packet-label').value, $('pr-packet-note').value);
  });
  $('pr-compare-form').onsubmit = event => {
    event.preventDefault();
    run('Compare survey editions', async () => {
      const result = await api('property.comparison.create', { ...Object.fromEntries(new FormData(event.target)),
        operator: operator(), baseline_id: $('pr-baseline').value || null, candidate_id: $('pr-candidate').value });
      await load(); $('pr-review').value = result.id; await readReview(0);
    });
  };
  async function readReview(offset = 0) {
    if (!$('pr-review').value) return;
    const previous = pr.review && pr.review.id;
    pr.review = await api('property.comparison.read', { review_id: $('pr-review').value, offset, limit: 25 });
    if (previous !== pr.review.id) pr.chosen.clear();
    $('pr-review-summary').replaceChildren(h('h3', {}, pr.review.label),
      h('p', {}, pr.review.total + ' source records · ' + pr.review.pending + ' awaiting review · saved review ' + pr.review.version),
      h('p', {}, pr.review.note || ''));
    $('pr-review-list').replaceChildren(table(['Select', 'Property or study basis', 'Change', 'Source details', 'Saved decision'], pr.review.rows.map(row => [
      h('input', { type: 'checkbox', checked: pr.chosen.has(row.key), 'aria-label': 'Select ' + row.name, onchange: event => {
        if (event.target.checked) pr.chosen.add(row.key); else pr.chosen.delete(row.key); picked();
      } }),
      row.name, row.kind,
      h('div', {}, row.changed_paths.slice(0, 6).join(', '), row.issues.length ? h('p', {}, row.issues.length + ' source notes') : null,
        button('Read before and after', () => show(row.name, { before: row.before, after: row.after, changed_fields: row.changed_paths, source_notes: row.issues }), true)),
      row.decision ? row.decision.action + ' · ' + row.decision.operator : 'Awaiting review',
    ])));
    $('pr-review-page').textContent = (pr.review.total ? offset + 1 : 0) + '–' + Math.min(offset + 25, pr.review.total) + ' of ' + pr.review.total;
    $('pr-review-prev').disabled = offset === 0; $('pr-review-next').disabled = pr.review.next === null;
    picked();
  }
  function picked() { $('pr-review-picked').textContent = pr.chosen.size + ' selected'; }
  $('pr-review').onchange = () => run('Read source review', () => readReview(0));
  $('pr-review-prev').onclick = () => run('Read previous review records', () => readReview(Math.max(0, pr.review.offset - 25)));
  $('pr-review-next').onclick = () => run('Read next review records', () => readReview(pr.review.next || 0));
  $('pr-pick-page').onclick = () => { for (const row of pr.review ? pr.review.rows : []) pr.chosen.add(row.key); run('Select displayed records', () => readReview(pr.review.offset)); };
  $('pr-clear-picks').onclick = () => { pr.chosen.clear(); if (pr.review) run('Clear selection', () => readReview(pr.review.offset)); };
  async function applyReview(action) {
    if (!pr.review || !pr.chosen.size) throw new Error('Select source records to review.');
    const result = await api('property.review.apply', { review_id: pr.review.id, expected_version: pr.review.version,
      keys: [...pr.chosen], action, operator: operator(), note: $('pr-review-note').value });
    pr.chosen.clear(); await load(); $('pr-review').value = result.id; await readReview(0);
    $('pr-select-review').value = result.id;
  }
  $('pr-review-accept').onclick = () => run('Save source review', () => applyReview('accept'));
  $('pr-review-exclude').onclick = () => run('Save source exclusions', () => applyReview('exclude'));

  async function prepareSelection(published) {
    const review_id = $('pr-select-review').value;
    if (!review_id) throw new Error('Choose a completed source review.');
    const review = await api('property.comparison.read', { review_id, limit: 10000 });
    if (review.pending) throw new Error('Complete the ' + review.pending + ' remaining source reviews first.');
    const edition = await api('property.edition.read', { edition_id: review.candidate_id, limit: 10000 });
    const purposes = [...new Set(edition.source_comparables.map(x => x.purpose))];
    $('pr-purposes').replaceChildren(purposes.map(p => h('option', { value: p })));
    if (!$('pr-purpose').value && purposes.length) $('pr-purpose').value = purposes[0];
    const purpose = $('pr-purpose').value.trim();
    if (!purpose) throw new Error('Enter the comparison purpose.');
    const originals = edition.source_comparables.filter(x => x.purpose === purpose);
    if (published && !originals.length) throw new Error('The retained report has no published set for this purpose. Load the properties and record your selection basis.');
    pr.selectReview = review; pr.selectEdition = edition; pr.choicePurpose = purpose;
    pr.choices = edition.properties.map(property => {
      const original = originals.find(x => x.property_key === property.key);
      const excluded = review.decisions[property.key].action === 'exclude';
      return { property, original, choice: {
        property_key: property.key, decision: excluded ? 'exclude' : published && original && original.selected ? 'comparable' : 'context',
        reason: excluded ? review.decisions[property.key].note : published && original ? original.reason : '',
        assessments: {}, unit_keys: property.units.map(u => u.key),
      } };
    });
    $('pr-select-label').value = edition.study.name + ' · ' + purpose;
    $('pr-selection-basis').replaceChildren(h('p', {}, edition.study.market_area.name + ' · source review ' + review.version),
      h('p', {}, 'Review the original unit schedules and choose the schedules relevant to this purpose.'),
      published ? h('p', {}, 'The published set is loaded as a draft. Your saved selection records its operator, reasons and schedule choices.') : null);
    renderChoices();
  }
  function renderChoices() {
    $('pr-selection-items').replaceChildren(...pr.choices.map(({ property, original, choice }) => {
      const decision = h('select', { value: choice.decision, 'data-selection-property': property.key, 'aria-label': property.name + ' use',
        onchange: event => { choice.decision = event.target.value; } },
        ['comparable', 'context', 'exclude'].map(value => h('option', { value }, readable(value))));
      decision.value = choice.decision;
      const reasons = h('textarea', { rows: 3, value: choice.reason, 'data-selection-reason': property.key,
        oninput: event => { choice.reason = event.target.value; } });
      const item = h('div', { className: 'property-choice' }, h('div', { className: 'heading' }, h('h3', {}, property.name), decision),
        h('p', {}, property.address + ' · ' + showValue(property.programs) + ' · ' + period(property)),
        h('p', {}, 'Quality ' + showValue(property.quality) + ' · neighborhood ' + showValue(property.neighborhood) + ' · year built ' + showValue(property.year_built) + ' · renovated ' + showValue(property.year_renovated)),
        h('label', {}, 'Reason for this purpose', reasons));
      if (original) item.append(h('details', {}, h('summary', {}, 'Published selection for ' + original.purpose),
        h('p', {}, (original.selected ? 'Selected. ' : 'Outside this published set. ') + original.reason), h('p', { className: 'muted' }, citeText(original.citations))));
      const units = table(['Include schedule', 'Bedrooms / baths', 'Units / vacant', 'Area sq ft', 'Rent as reported', 'Basis', 'AMHI', 'Utilities'], property.units.map(unit => [
        h('input', { type: 'checkbox', checked: choice.unit_keys.includes(unit.key), 'data-selection-unit': unit.key, 'aria-label': 'Include ' + unit.key,
          onchange: event => { choice.unit_keys = event.target.checked ? [...new Set([...choice.unit_keys, unit.key])] : choice.unit_keys.filter(k => k !== unit.key); } }),
        showValue(unit.bedrooms) + ' / ' + showValue(unit.bathrooms), showValue(unit.unit_count) + ' / ' + showValue(unit.vacant_units),
        rangeValue(unit.sqft_min, unit.sqft_max), unit.rent_raw || rangeValue(unit.rent_min, unit.rent_max),
        [unit.currency, unit.rent_period, unit.rent_basis].filter(Boolean).join(' / '), showValue(unit.ami_raw), showValue(unit.utility_note),
      ]));
      item.append(h('details', { open: choice.decision === 'comparable' }, h('summary', {}, 'Included unit schedules'), units));
      const assessments = h('div', { className: 'form-grid' });
      for (const criterion of pr.data.criteria) assessments.append(h('label', {}, criterion.label, h('textarea', {
        rows: 2, value: choice.assessments[criterion.key] || '', 'data-criterion-property': property.key, 'data-criterion': criterion.key,
        oninput: event => { if (event.target.value.trim()) choice.assessments[criterion.key] = event.target.value; else delete choice.assessments[criterion.key]; },
      })));
      item.append(h('details', {}, h('summary', {}, 'Criterion assessments'), assessments));
      return item;
    }));
  }
  $('pr-selection-draft').onclick = () => run('Prepare comparable selection', () => prepareSelection(false));
  $('pr-published-draft').onclick = () => run('Load published comparison draft', () => prepareSelection(true));
  $('pr-freeze-selection').onclick = () => run('Freeze purpose-specific comparable selection', async () => {
    if (!pr.selectReview || !pr.choices.length) throw new Error('Load properties for this selection first.');
    if ($('pr-select-review').value !== pr.selectReview.id || $('pr-purpose').value.trim() !== pr.choicePurpose) throw new Error('Reload the draft for the selected source review and comparison purpose.');
    const result = await api('property.selection.freeze', { review_id: pr.selectReview.id, expected_version: pr.selectReview.version,
      operator: operator(), purpose: pr.choicePurpose, label: $('pr-select-label').value, note: $('pr-select-note').value,
      criteria: pr.data.criteria, items: pr.choices.map(x => cloneValue(x.choice)) });
    await load(); $('pr-delivery-selection').value = result.id; $('pr-delivery-label').value = result.label;
    section('delivery'); await previewReport();
  });
  async function previewReport() {
    const selection_id = $('pr-delivery-selection').value;
    if (!selection_id) throw new Error('Choose a frozen comparable selection.');
    const result = await api('property.selection.report', { selection_id });
    $('pr-report-preview').replaceChildren(h('div', { className: 'panel' }, h('h2', {}, 'Analyst report'),
      h('h3', {}, result.study.name), h('p', {}, result.summary.comparison_purpose),
      table(['Summary', 'Value'], Object.entries(result.summary).map(([key, value]) => [readable(key), showValue(value)]))),
      result.sections.map(([title, headers, rows]) => h('div', { className: 'panel' }, h('h2', {}, title), table(headers, rows.map(row => row.map(showValue))))));
  }
  $('pr-preview-report').onclick = () => run('Read frozen analyst report', previewReport);
  $('pr-export').onclick = () => run('Create complete property research package', async () => {
    const selection_id = $('pr-delivery-selection').value;
    if (!selection_id) throw new Error('Choose a frozen selection.');
    const selected = pr.data.selections.find(x => x.id === selection_id);
    await api('property.selection.export', { selection_id, operator: operator(), label: $('pr-delivery-label').value || selected.label });
    await load(); section('delivery');
  });
  $('pr-go-receive').onclick = () => view('delivery');
  window.propertyResearch = {
    load: refreshProperty,
    received: async selection => {
      view('properties'); section('delivery'); $('pr-delivery-selection').value = selection.id;
      $('pr-delivery-label').value = selection.label; await previewReport();
    },
  };
  section('intake');
})();
