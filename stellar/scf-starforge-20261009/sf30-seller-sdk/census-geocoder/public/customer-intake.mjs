// MIT. Explicit customer mapping over the same retained Census workspace.
const fields = ['id', 'street', 'city', 'state', 'zip', 'urbanization'];
export function createCustomerIntake({ api, perform, download, options, node, notice, handle,
  selectPanel, openBatch, getState, isBusy, refreshControls, selection }) {
  const $ = id => document.getElementById(id), value = id => $(id).value;
  $('panel-customer').innerHTML = '<article><h2>Retain the original customer CSV</h2><p>Keep all customer columns and row identities. Map address fields explicitly; duplicate business IDs can remain in the source while stable source-row IDs identify Census requests.</p><div class="grid"><div><label>File label<input id="customer-label" maxlength="128"></label><label>Customer CSV<input id="customer-file" type="file" accept=".csv,text/csv"></label><label class="check"><input id="customer-header" type="checkbox" checked>First record contains column names</label><button id="customer-retain">Retain original file</button><p id="customer-file-note" class="subtle">UTF-8 CSV · 1–10,000 records · at most 5,000,000 bytes and 256 columns.</p></div><div><label>Retained customer file<select id="customer-source"></select></label><div id="customer-source-facts" class="facts"></div><button id="customer-download-input">Download original customer CSV</button><label>Saved mapping<select id="customer-mapping"></select></label><button id="customer-reopen-mapping">Open saved mapping and decisions</button></div></div></article>' +
    '<article><h2>Map the address columns</h2><p>Column positions are shown even when names are duplicated or blank. No source field is guessed, renamed or discarded.</p><div class="grid compact"><label>Address ID choice<select id="customer-id-mode" data-map><option value="">Choose explicitly</option value="column">Use values from an original ID column</option><option value="row">Use stable row-000001 IDs</option></select></label><label>Joined result column prefix<input id="customer-prefix" value="census_" maxlength="48" data-map></label><div id="customer-field-map" class="mapping-fields"></div></div><p id="customer-plan-note" class="subtle">Choose source columns, then preview every included address. Corrections change submitted address fields; the original customer CSV remains intact.</p><div class="actions"><button id="customer-preview">Preview current mapping</button><button id="customer-save-mapping">Save reviewed mapping</button><button id="customer-download-mapping">Download saved mapping JSON</button><button id="customer-download-submitted">Download mapped address CSV</button></div><div id="customer-summary" class="facts"></div><pre id="customer-errors" hidden></pre><div class="toolbar"><label>Show rows<select id="customer-filter"><option value="all">All original rows</option><option value="exceptions">Address exceptions</option><option value="excluded">Explicitly excluded</option><option value="corrected">Corrected addresses</option></select></label><button id="customer-previous">Previous</button><button id="customer-next">Next</button><span id="customer-page"></span></div><div class="table-wrap"><table><thead><tr><th>Source record</th><th>Original cells (preview)</th><th>Mapped ID / street</th><th>City / state / ZIP</th><th>Decision / address exceptions</th><th>Review</th></tr></thead><tbody id="customer-rows"></tbody></table></div><p class="subtle">Displayed cell values are shortened for review. Downloads retain every original field and byte. Record numbers exclude the optional header; quoted multiline cells remain one record.</p></article>' +
    '<article><h2>Correct or exclude an original row</h2><label>Source record number<input id="customer-edit-row" type="number" min="1"></label><p>Check only fields to replace. An unchecked field keeps its mapped original value; a checked empty field explicitly clears it.</p><div id="customer-corrections" class="grid compact"></div><label>Correction reason<textarea id="customer-correction-reason" rows="2" maxlength="1000"></textarea></label><div class="actions"><button id="customer-apply-correction">Apply local correction</button><button id="customer-remove-correction">Remove this correction</button><button id="customer-discard-edit">Discard unapplied editor text</button></div><label>Exclusion reason<textarea id="customer-exclusion-reason" rows="2" maxlength="1000"></textarea></label><div class="actions"><button id="customer-exclude">Exclude this row</button><button id="customer-include">Include this row again</button></div><p id="customer-edit-note" class="subtle">No row is excluded automatically. Preview and save after changing a decision.</p></article>' +
    '<article><h2>Use this mapping in the original Census batch</h2><p>A READY saved mapping can create an original batch using the benchmark/vintage selected in Address intake, or bind to a retained capture whose submitted address records match exactly. Neither action sends a provider request.</p><button id="customer-official-selection">Open official benchmark and vintage selection</button><p id="customer-official-note" class="subtle"></p><label>New batch label<input id="customer-batch-label" maxlength="128"></label><button id="customer-create-batch">Retain mapped Census batch</button><label>Or choose an existing exact batch<select id="customer-existing-batch"></select></label><button id="customer-bind">Bind mapping to existing submitted records</button><p id="customer-binding-note" class="subtle">Continue with the original match review. In Dataset editions, explicitly select this bound mapping to include the full customer results.</p></article>';
  let originalText = null, loadedFile = null, revision = 0, preview = null, previewRevision = -1;
  let sourceId = '', savedId = '', localBusy = false, offset = 0, editing = false;
  const corrections = new Map(), exclusions = new Map();
  const fact = (id, pairs) => $(id).replaceChildren(...pairs.map(([label, text]) => {
    const entry = node('div'); entry.append(node('b', label), node('span', text ?? '—')); return entry;
  }));
  for (const name of fields) {
    const label = node('label', name === 'id' ? 'Original ID column' : name[0].toUpperCase() + name.slice(1) + ' column');
    const select = node('select'); select.id = 'customer-column-' + name; select.dataset.map = ''; label.append(select); $('customer-field-map').append(label);
    const group = node('div'), choice = node('label'), check = node('input'); choice.className = 'check'; check.type = 'checkbox'; check.id = 'customer-replace-' + name;
    choice.append(check, node('span', 'Replace ' + name)); const input = node('input'); input.id = 'customer-value-' + name;
    input.setAttribute('aria-label', 'Corrected ' + name); group.append(choice, input); $('customer-corrections').append(group);
  }
  const currentSource = () => getState()?.customerSources?.find(item => item.id === value('customer-source'));
  const currentSaved = () => getState()?.customerMappings?.find(item => item.id === savedId);
  const invalidate = () => {
    revision++; preview = null; previewRevision = -1; savedId = ''; $('customer-mapping').value = '';
    $('customer-plan-note').textContent = 'The mapping or row decisions changed. Preview and save this current selection.';
    renderPreview(); refreshControls();
  };
  function resetEditor() {
    editing = false;
    for (const name of fields) { $('customer-replace-' + name).checked = false; $('customer-value-' + name).value = ''; }
    $('customer-correction-reason').value = ''; $('customer-exclusion-reason').value = '';
    $('customer-edit-note').textContent = 'No unapplied row edit. Preview and save after changing a decision.';
  }
  function displayRow(ordinal) {
    resetEditor(); $('customer-edit-row').value = String(ordinal);
    const correction = corrections.get(ordinal), exclusion = exclusions.get(ordinal);
    for (const name of fields) if (Object.hasOwn(correction?.values ?? {}, name)) {
      $('customer-replace-' + name).checked = true; $('customer-value-' + name).value = correction.values[name];
    }
    $('customer-correction-reason').value = correction?.reason ?? '';
    $('customer-exclusion-reason').value = exclusion?.reason ?? '';
    $('customer-edit-row').scrollIntoView({ block: 'center', behavior: 'smooth' }); refreshControls();
  }
  function rowNumber() {
    const row = Number(value('customer-edit-row'));
    if (!Number.isInteger(row) || row < 1 || row > (currentSource()?.rowCount ?? 0)) throw new Error('Select an original source record number.');
    return row;
  }
  function plan() {
    return { idMode: value('customer-id-mode'), outputPrefix: value('customer-prefix'),
      columns: Object.fromEntries(fields.map(name => [name, value('customer-column-' + name) === '' ? null : Number(value('customer-column-' + name))])),
      corrections: [...corrections.values()].sort((a, b) => a.row - b.row), exclusions: [...exclusions.values()].sort((a, b) => a.row - b.row) };
  }
  function mappingFields(source, selectedPlan) {
    for (const name of fields) {
      options('customer-column-' + name, (source?.columns ?? []).map(column => ({ id: column.index, label: column.label })), column => column.label, { placeholder: 'No column selected',
        selected: selectedPlan?.columns[name] == null ? '' : String(selectedPlan.columns[name]) });
    }
  }
  function applyPlan(saved) {
    mappingFields(currentSource(), saved);
    $('customer-id-mode').value = saved.idMode; $('customer-prefix').value = saved.outputPrefix;
    corrections.clear(); exclusions.clear();
    for (const item of saved.corrections) corrections.set(item.row, item);
    for (const item of saved.exclusions) exclusions.set(item.row, item);
    resetEditor();
  }
  async function run(fn) {
    if (isBusy() || localBusy) throw new Error('Wait for the current original workspace operation.');
    localBusy = true; refreshControls();
    try { return await fn(); } finally { localBusy = false; refreshControls(); }
  }
  const button = (id, fn) => $(id).addEventListener('click', () => handle(() => run(fn)));
  function requireApplied() { if (editing) throw new Error('Apply or discard the current row editor text before reviewing or using the mapping.'); }
  async function inspectCurrent() {
    requireApplied();
    const observed = revision, chosen = value('customer-source'), payload = { sourceId: chosen, plan: plan(), offset, limit: 20, filter: value('customer-filter') };
    const result = await perform('customer.preview', payload);
    if (observed !== revision || chosen !== value('customer-source')) return;
    preview = result; previewRevision = observed; renderPreview();
  }
  $('customer-file').addEventListener('change', () => handle(() => run(async () => {
    revision++; const file = $('customer-file').files[0];
    originalText = null; loadedFile = null; invalidate(); $('customer-source').value = ''; sourceId = '';
    if (!file) { $('customer-file-note').textContent = 'Choose the original CSV.'; return; }
    if (file.size > 5000000) throw new Error('The original customer CSV exceeds 5,000,000 bytes.');
    const ownRevision = revision, raw = await file.arrayBuffer();
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
    if (ownRevision !== revision || $('customer-file').files[0] !== file) return;
    originalText = text; loadedFile = file;
    if (!value('customer-label')) $('customer-label').value = file.name.slice(0, 128);
    $('customer-file-note').textContent = file.name + ' · ' + file.size + ' original UTF-8 bytes. Retain this file before mapping.';
  })));
  button('customer-retain', async () => {
    if (originalText === null || !loadedFile) throw new Error('Choose and read the original customer CSV.');
    const observed = revision;
    const result = await perform('customer.source', { label: value('customer-label'), inputText: originalText, header: $('customer-header').checked });
    if (observed !== revision) return;
    $('customer-source').value = result.id; sourceId = ''; render(); notice('Original customer CSV retained. Map its displayed columns explicitly.');
  });
  $('customer-source').addEventListener('change', () => { invalidate(); sourceId = ''; render(); });
  for (const element of $('panel-customer').querySelectorAll('[data-map]')) element.addEventListener('change', () => {
    if (element.id === 'customer-id-mode' && value('customer-id-mode') === 'row') $('customer-column-id').value = '';
    invalidate();
  });
  $('customer-prefix').addEventListener('input', invalidate);
  for (const element of [$('customer-edit-row'), $('customer-correction-reason'), $('customer-exclusion-reason'), ...$('customer-corrections').querySelectorAll('input')])
    element.addEventListener('input', () => { editing = true; $('customer-edit-note').textContent = 'Unapplied editor text. Apply the correction/exclusion or discard it before continuing.'; refreshControls(); });
  button('customer-apply-correction', () => {
    const row = rowNumber(), selected = fields.filter(name => $('customer-replace-' + name).checked);
    if (!selected.length) throw new Error('Check at least one address field to replace.');
    if (selected.includes('id') && value('customer-id-mode') === 'row') throw new Error('Stable row IDs remain fixed.');
    const reason = value('customer-correction-reason'); if (!reason.trim()) throw new Error('Enter a correction reason.');
    corrections.set(row, { row, values: Object.fromEntries(selected.map(name => [name, value('customer-value-' + name)])), reason });
    resetEditor(); invalidate(); notice('Local correction retained in the current mapping. Preview and save it.');
  });
  button('customer-remove-correction', () => { corrections.delete(rowNumber()); resetEditor(); invalidate(); });
  button('customer-exclude', () => {
    const row = rowNumber(), reason = value('customer-exclusion-reason'); if (!reason.trim()) throw new Error('Enter an exclusion reason.');
    exclusions.set(row, { row, reason }); resetEditor(); invalidate(); notice('Row explicitly excluded from submission; it will remain in the customer result.');
  });
  button('customer-include', () => { exclusions.delete(rowNumber()); resetEditor(); invalidate(); });
  button('customer-discard-edit', () => { resetEditor(); refreshControls(); });
  button('customer-preview', async () => { offset = 0; await inspectCurrent(); });
  $('customer-filter').addEventListener('change', () => handle(() => run(async () => { offset = 0; await inspectCurrent(); })));
  button('customer-previous', async () => { offset = Math.max(0, offset - 20); await inspectCurrent(); });
  button('customer-next', async () => { if (preview?.next != null) { offset = preview.next; await inspectCurrent(); } });
  button('customer-save-mapping', async () => {
    requireApplied(); if (!preview || previewRevision !== revision) throw new Error('Preview the current mapping first.');
    const observed = revision, result = await perform('customer.mapping', { sourceId: value('customer-source'), plan: plan(), expectedReviewSha256: preview.reviewSha256 });
    if (observed !== revision) return;
    savedId = result.id; $('customer-mapping').value = result.id; $('customer-plan-note').textContent = result.state + ' · mapping ' + result.id;
  });
  button('customer-reopen-mapping', async () => {
    const id = value('customer-mapping'), selectedSource = value('customer-source'), observed = ++revision;
    if (!id) throw new Error('Select a saved mapping.');
    const file = await api('/api/download?' + new URLSearchParams({ kind: 'customer-mapping', id }), {}, true);
    const saved = JSON.parse(await file.blob.text());
    if (revision !== observed || value('customer-mapping') !== id || value('customer-source') !== selectedSource) return;
    if (saved.id !== id || saved.sourceId !== selectedSource) throw new Error('The selected mapping belongs to a different original file.');
    applyPlan(saved.plan); savedId = id; offset = 0;
    const result = await perform('customer.inspect', { mappingId: id, offset: 0, limit: 20, filter: value('customer-filter') });
    if (revision !== observed || value('customer-source') !== selectedSource) return;
    preview = result; previewRevision = observed; $('customer-plan-note').textContent = 'Reopened exact saved mapping ' + id; renderPreview();
  });
  $('customer-mapping').addEventListener('change', () => { revision++; preview = null; savedId = ''; renderPreview(); refreshControls(); });
  button('customer-download-input', () => download('customer-input', value('customer-source')));
  button('customer-download-mapping', () => download('customer-mapping', savedId));
  button('customer-download-submitted', () => download('customer-submitted', savedId));
  button('customer-official-selection', () => selectPanel('intake'));
  const ready = () => {
    requireApplied(); const saved = currentSaved();
    if (!saved || saved.state !== 'READY' || saved.sourceId !== value('customer-source') || !preview ||
        previewRevision !== revision || preview.reviewSha256 !== saved.reviewSha256) throw new Error('Preview and save the current READY mapping first.');
    return saved;
  };
  button('customer-create-batch', async () => {
    const saved = ready(), result = await perform('customer.batch', { mappingId: saved.id, expectedReviewSha256: saved.reviewSha256,
      label: value('customer-batch-label'), ...selection() });
    $('customer-binding-note').textContent = 'Bound original batch ' + result.batch.id + ' · mapping ' + saved.id;
    await openBatch(result.batch.id);
  });
  button('customer-bind', async () => {
    const saved = ready(), batchId = value('customer-existing-batch');
    const result = await perform('customer.bind', { mappingId: saved.id, expectedReviewSha256: saved.reviewSha256, batchId });
    $('customer-binding-note').textContent = 'Exact submitted-record binding ' + result.id + ' retained. Select this mapping when building the reviewed edition.';
    await openBatch(batchId);
  });
  function renderPreview() {
    const summary = preview?.summary;
    fact('customer-summary', [['Original records', summary?.originalRows], ['Included addresses', summary?.includedRows],
      ['Explicit exclusions', summary?.excludedRows], ['Invalid addresses', summary?.invalidRows], ['Corrected rows', summary?.correctedRows],
      ['Current review', summary ? summary.ready ? 'READY' : 'REVIEW REQUIRED' : null]]);
    $('customer-errors').hidden = !preview?.errors?.length; $('customer-errors').textContent = JSON.stringify(preview?.errors ?? [], null, 2);
    $('customer-page').textContent = preview ? 'Records ' + (preview.rows.length ? preview.offset + 1 : 0) + '–' + (preview.offset + preview.rows.length) + ' of ' + preview.total : 'Preview the current mapping.';
    $('customer-rows').replaceChildren(...(preview?.rows ?? []).map(item => {
      const row = node('tr'); row.append(node('td', item.row), node('td', item.originalCells.join(' / ') + (item.originalCellCount > 8 ? ' / …' : '')),
        node('td', item.mapped.id + ' / ' + item.mapped.street), node('td', [item.mapped.city, item.mapped.state, item.mapped.zip].join(' / ')),
        node('td', item.excluded ? 'EXCLUDED: ' + item.exclusionReason : item.errors.length ? item.errors.map(error => error.message).join('\n') : item.correctedFields.length ? 'Corrected: ' + item.correctedFields.join(', ') : 'Address ready'));
      const cell = node('td'), edit = node('button', 'Review row'); edit.type = 'button';
      edit.addEventListener('click', () => { if (!isBusy() && !localBusy) displayRow(item.row); }); cell.append(edit); row.append(cell); return row;
    }));
  }
  function render() {
    const state = getState(); if (!state) return;
    options('customer-source', state.customerSources ?? [], item => item.label + ' · ' + item.rowCount + ' records · ' + item.state);
    const source = currentSource();
    if (sourceId !== (source?.id ?? '')) {
      sourceId = source?.id ?? ''; savedId = ''; revision++; preview = null; corrections.clear(); exclusions.clear(); resetEditor();
      $('customer-id-mode').value = ''; $('customer-prefix').value = 'census_'; mappingFields(source); renderPreview();
    }
    options('customer-mapping', (state.customerMappings ?? []).filter(item => item.sourceId === sourceId),
      item => item.state + ' · ' + item.summary.includedRows + ' addresses · ' + item.id.slice(0, 12));
    options('customer-existing-batch', [...state.batches].reverse(), item => item.label + ' · ' + item.input.count + ' addresses');
    fact('customer-source-facts', [['Original source', source?.id], ['CSV SHA-256', source?.inputSha256],
      ['Bytes', source?.inputBytes], ['Columns', source?.columns.length]]);
    const chosen = selection(); $('customer-official-note').textContent = chosen.discoveryId ?
      'Current selection: benchmark ' + chosen.benchmark + (chosen.returnType === 'geographies' ? ' / vintage ' + chosen.vintage : ' / locations only') :
      'Select retained official metadata in Address intake before creating a new batch. An existing captured batch keeps its original selection.';
    const review = state.reviews.find(item => item.id === value('review-selection'));
    const bindings = (state.customerBindings ?? []).filter(item => item.state === 'COMPLETE' && item.batchId === review?.batchId);
    const mappings = (state.customerMappings ?? []).filter(item => item.state === 'READY' && bindings.some(binding => binding.mappingId === item.id));
    options('edition-customer-mapping', mappings, item => (state.customerSources.find(source => source.id === item.sourceId)?.label ?? item.sourceId) + ' · ' + item.id.slice(0, 12),
      { placeholder: 'Dataset only; no customer record join' });
  }
  function controls() {
    const blocked = isBusy() || localBusy, source = currentSource(), saved = currentSaved(), reviewed = preview && previewRevision === revision;
    for (const element of $('panel-customer').querySelectorAll('input,select,textarea,button')) element.disabled = blocked;
    $('customer-retain').disabled = blocked || originalText === null;
    $('customer-column-id').disabled = blocked || value('customer-id-mode') === 'row';
    $('customer-replace-id').disabled = blocked || value('customer-id-mode') === 'row';
    $('customer-preview').disabled = blocked || source?.state !== 'COMPLETE' || editing;
    $('customer-save-mapping').disabled = blocked || !reviewed || editing;
    $('customer-reopen-mapping').disabled = blocked || !value('customer-mapping');
    $('customer-download-input').disabled = blocked || source?.state !== 'COMPLETE';
    $('customer-download-mapping').disabled = blocked || !saved;
    $('customer-download-submitted').disabled = blocked || saved?.state !== 'READY';
    $('customer-create-batch').disabled = blocked || editing || !reviewed || saved?.state !== 'READY';
    $('customer-bind').disabled = blocked || editing || !reviewed || saved?.state !== 'READY' || !value('customer-existing-batch');
    $('customer-previous').disabled = blocked || !preview || preview.offset === 0 || editing;
    $('customer-next').disabled = blocked || preview?.next == null || editing;
    $('edition-customer-mapping').disabled = blocked;
    const edition = getState()?.editions.find(item => item.id === value('edition-selection'));
    $('download-customer-results').disabled = blocked || edition?.state !== 'COMPLETE' || !edition.customer;
    $('download-customer-results-json').disabled = blocked || edition?.state !== 'COMPLETE' || !edition.customer;
  }
  $('customer-existing-batch').addEventListener('change', refreshControls);
  return { render, controls, mappingId: () => value('edition-customer-mapping') || undefined };
}
