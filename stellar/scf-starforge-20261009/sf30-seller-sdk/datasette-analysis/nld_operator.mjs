// MIT. NLD commissioning controls on the original Datasette operator and writer.
export function mountNld({api, startAction, el, definition, jsonDetails, table, display, bytes,
                          notice, download, workspaceScope}) {
  const $ = id => document.getElementById(id);
  const local = {snapshot: null, scope: null, sourceRows: null, sourceGeneration: 0,
    rowGeneration: 0, offset: 0, next: null, page: null, mapping: [], loadedSource: null,
    definitionsKey: null, selectedProject: '', selectedDefinition: '', selectedRun: ''};
  const id = () => crypto.randomUUID().replaceAll('-', '');
  const current = () => local.snapshot?.state || {};
  const projects = () => current().nld?.projects || [];
  const project = () => projects().find(p => p.id === $('nld-project').value);
  const sourceEdition = () => (current().editions || []).find(e => e.edition_id === $('nld-source').value);
  const selectedDefinition = () => project()?.definitions.find(d => d.id === $('nld-definition').value);
  const selectedRun = () => project()?.runs.find(r => r.id === $('nld-completed-run').value);
  const failure = error => notice(error.message, true);
  const assertScope = scope => {if (scope !== workspaceScope()) throw new Error('Reopen the original workspace before continuing this selection.');};
  function select(control, choices, preferred = null) {
    const previous = control.value;
    control.replaceChildren(...choices.map(({value, text}) => {
      const option = el('option', text); option.value = value; return option;
    }));
    const value = preferred ?? previous;
    if (choices.some(item => item.value === value)) control.value = value;
    else if (choices.length) control.value = choices[0].value;
  }
  function resetRows() {
    local.rowGeneration++; local.offset = 0; local.next = null; local.page = null;
    $('nld-table').replaceChildren(); $('nld-page-label').textContent = '';
    $('nld-previous').disabled = true; $('nld-next').disabled = true;
  }
  function addInput(cell, type, value = '', label = '') {
    const input = el('input'); input.type = type;
    if (type === 'checkbox') input.checked = Boolean(value); else input.value = value ?? '';
    if (label) input.setAttribute('aria-label', label);
    cell.append(input); return input;
  }
  function mappingRows(columns, spec = null) {
    const root = $('nld-mapping');
    const grid = el('table', undefined, 'nld-mapping'), head = el('thead'), header = el('tr'), body = el('tbody');
    for (const label of ['Write', 'Original field', 'Target field', 'Key', 'Unit', 'Time basis', 'Known subtotal']) header.append(el('th', label));
    head.append(header);
    const selected = new Map((spec?.mapping || []).map(b => [b.source, b]));
    const measures = new Map((spec?.measures || []).map(m => [m.target, m]));
    const source = sourceEdition()?.source || {};
    local.mapping = [];
    for (const column of columns) {
      const binding = selected.get(column), fallback = /^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(column)
        ? column : 'field_' + String(local.mapping.length + 1);
      const internal = column === source.type_column || /^(?:rowid|_rowid_|oid)$/i.test(column);
      const row = el('tr'), enabledCell = el('td'), targetCell = el('td'), keyCell = el('td');
      const enabled = addInput(enabledCell, 'checkbox', spec ? Boolean(binding) : !internal, 'Write ' + column);
      const target = addInput(targetCell, 'text', binding?.target || fallback, 'Target name for ' + column);
      target.pattern = '[A-Za-z][A-Za-z0-9_]{0,47}'; target.maxLength = 48;
      const key = addInput(keyCell, 'checkbox', spec?.keys?.includes(column), 'Business key ' + column);
      const unitCell = el('td'), timeCell = el('td'), measureCell = el('td');
      const unit = addInput(unitCell, 'text', binding?.unit || '', 'Unit for ' + column);
      const time = addInput(timeCell, 'text', binding?.time_basis || '', 'Time basis for ' + column);
      const measure = addInput(measureCell, 'checkbox', measures.has(binding?.target), 'Known subtotal for ' + column);
      const detail = el('details'), note = el('textarea'); note.rows = 2;
      note.setAttribute('aria-label', 'Subtotal interpretation for ' + column);
      note.value = measures.get(binding?.target)?.note || '';
      detail.append(el('summary', 'Interpretation'), note); measureCell.append(detail);
      row.append(enabledCell, el('td', column), targetCell, keyCell, unitCell, timeCell, measureCell); body.append(row);
      local.mapping.push({column, enabled, target, key, unit, time, measure, note,
        description: binding?.description, nonnegative: measures.get(binding?.target)?.nonnegative || false});
    }
    grid.append(head, body); root.replaceChildren(grid);
  }
  function specification() {
    const mapping = [], keys = [], measures = [];
    for (const row of local.mapping) {
      if (!row.enabled.checked) {
        if (row.key.checked || row.measure.checked) throw new Error('A key or subtotal must be included in the selected mapping.');
        continue;
      }
      const binding = {source: row.column, target: row.target.value.trim(),
        unit: row.unit.value.trim(), time_basis: row.time.value.trim()};
      if (row.description !== undefined) binding.description = row.description;
      if (!/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(binding.target)) throw new Error('Use a valid native target field name for ' + row.column + '.');
      mapping.push(binding);
      if (row.key.checked) keys.push(row.column);
      if (row.measure.checked) {
        if (!binding.unit || !binding.time_basis || !row.note.value.trim())
          throw new Error('State the unit, time basis and subtotal interpretation for ' + row.column + '.');
        measures.push({target: binding.target, unit: binding.unit, time_basis: binding.time_basis,
          note: row.note.value.trim(), nonnegative: row.nonnegative});
      }
    }
    if (!keys.length) throw new Error('Review at least one actual business key. The local row locator is not a business key.');
    if (new Set(mapping.map(v => v.target.toLowerCase())).size !== mapping.length)
      throw new Error('Each target field name must be unique.');
    const targetName = $('nld-name').value.trim();
    if (targetName.toLowerCase() === 'retained_input')
      throw new Error('Choose a target name distinct from the internal retained_input staging table.');
    return {schema: 'stellar-forge.datasette-nld.v1/specification',
      name: targetName, title: $('nld-title').value.trim(),
      namespace: $('nld-namespace').value.trim(), reviewer: $('nld-reviewer').value.trim(),
      note: $('nld-note').value.trim(), keys, mapping, measures};
  }
  async function loadSource(spec = null) {
    const edition = sourceEdition(), generation = ++local.sourceGeneration, scope = workspaceScope();
    if (!edition) return;
    const source = edition.source || {};
    $('nld-source-context').replaceChildren(definition({
      publisher: source.publisher, license: source.license, source: source.url,
      selected_rows: edition.row_count, original_edition: edition.edition_id,
      analysis_version: edition.version_id,
      meaning: 'Retained historical/source observations. Retrieval time is not a source update watermark.'
    }));
    const page = await api('/api/datasette/rows?' + new URLSearchParams({edition_id: edition.edition_id, offset: '0', limit: '1'}));
    assertScope(scope);
    if (generation !== local.sourceGeneration || sourceEdition()?.edition_id !== edition.edition_id) return;
    if (page.edition_id !== edition.edition_id || page.offset !== 0) throw new Error('The returned schema differs from the selected original edition.');
    local.sourceRows = page; local.loadedSource = edition.edition_id;
    const columns = page.columns.map(v => typeof v === 'string' ? v : v.name);
    if (spec && spec.mapping.some(b => !columns.includes(b.source))) throw new Error('The specification contains fields absent from this original version.');
    mappingRows(columns, spec);
    if (!$('nld-title').value) $('nld-title').value = edition.title || 'Retained source commissioning';
  }
  async function loadSpec(spec) {
    if (spec?.schema !== 'stellar-forge.datasette-nld.v1/specification' || !Array.isArray(spec.mapping) || !Array.isArray(spec.keys))
      throw new Error('Select the complete reviewed NLD specification.');
    for (const field of ['name', 'title', 'namespace', 'reviewer', 'note']) $('nld-' + field).value = spec[field] || (field === 'namespace' ? 'datasette' : '');
    await loadSource(spec);
  }
  function renderCoverage() {
    const run = selectedRun(), root = $('nld-coverage'), files = $('nld-report-files');
    root.replaceChildren(); files.replaceChildren();
    if (!run) {root.append(el('p', 'No completed native run is selected.', 'empty')); return;}
    root.append(definition({native_uid: run.completed.native_uid, native_status: run.completed.native_status,
      ...run.completed.coverage}));
    root.append(el('p', 'Matching values and whole-source coverage are separate from native flow success. Rows retained from earlier selections are not treated as deleted. Missing native counts remain unknown.', 'hint'));
    const report = project()?.reports.find(r => r.run_id === run.id && r.status === 'COMPLETE');
    if (!report) {files.append(el('p', 'The original report/workbook production has not completed.', 'empty')); return;}
    const list = el('table'), body = el('tbody');
    for (const file of report.files || []) {
      const row = el('tr'), cell = el('td'), button = el('button', 'Download');
      button.type = 'button'; button.addEventListener('click', async () => {
        button.disabled = true;
        try {await download(file);} catch (error) {failure(error);} finally {button.disabled = false;}
      });
      cell.append(button); row.append(el('td', file.filename), el('td', bytes(file.bytes)),
        el('td', file.sha256), cell); body.append(row);
    }
    list.append(body); files.append(list, jsonDetails('Original report and workbook bindings', report));
  }
  function renderProject() {
    const p = project();
    const priorDefinition = $('nld-definition').value;
    select($('nld-definition'), (p?.definitions || []).map(d => ({value: d.id,
      text: d.title + ' · ' + d.row_count + ' rows · ' + d.id.slice(0, 12)})),
      p?.definitions.some(d => d.id === priorDefinition) ? priorDefinition : p?.current_definition);
    select($('nld-completed-run'), (p?.runs || []).filter(r => r.status === 'COMPLETE').map(r => ({value: r.id,
      text: r.request.strategy + ' · ' + r.completed.native_status + ' · ' + r.id.slice(0, 12)})));
    const history = $('nld-run-history'); history.replaceChildren();
    for (const run of p?.runs || []) {
      const row = el('article', undefined, 'activity');
      row.append(el('span', run.status, 'state'), definition({native_uid: run.id, strategy: run.request.strategy,
        reason: run.request.note, definition: run.definition_id}));
      row.append(jsonDetails('Original request, invocation and native receipt', run)); history.append(row);
    }
    const checkpoints = $('nld-checkpoints'); checkpoints.replaceChildren();
    for (const checkpoint of (p?.checkpoints || []).slice().reverse())
      checkpoints.append(jsonDetails(checkpoint.reason + ' · ' + bytes(checkpoint.archive.bytes), checkpoint));
    $('nld-load-mapping').disabled = !p;
    if (p) $('nld-project-id').value = p.id;
    renderCoverage();
  }
  async function rows(offset = 0) {
    const p = project(), kind = $('nld-row-kind').value, run = selectedRun(), d = selectedDefinition();
    if (!p || !d) throw new Error('Select a retained project and definition.');
    if (kind !== 'source' && !run) throw new Error('Select an actual completed native run.');
    const generation = ++local.rowGeneration, scope = workspaceScope();
    const query = {project_id: p.id, kind, offset: String(offset), limit: '25'};
    if (kind === 'source') query.definition_id = d.id; else query.run_id = run.id;
    const result = await api('/api/datasette/nld/rows?' + new URLSearchParams(query));
    assertScope(scope);
    if (generation !== local.rowGeneration) return;
    if (result.project_id !== p.id || result.kind !== kind || result.offset !== offset
        || kind === 'source' && result.definition_id !== d.id || kind !== 'source' && result.run_id !== run.id)
      throw new Error('The returned page differs from its original source/run selection.');
    local.page = result; local.offset = offset; local.next = result.next_offset;
    $('nld-table').replaceChildren(table(result.columns, result.rows, {className: 'source-table'}));
    $('nld-page-label').textContent = (result.rows.length ? offset + 1 : 0) + '–' + (offset + result.rows.length) + ' of ' + result.total;
    $('nld-previous').disabled = offset === 0; $('nld-next').disabled = result.next_offset === null;
  }
  function render(snapshot) {
    const scope = snapshot.workspace_id + ':' + snapshot.operation_id;
    if (local.scope !== null && local.scope !== scope) throw new Error('NLD controls belong to another original workspace.');
    local.scope = scope; local.snapshot = snapshot;
    const oldSource = $('nld-source').value, oldProject = $('nld-project').value;
    select($('nld-source'), (current().editions || []).filter(e => e.status === 'COMPLETE').map(e => ({
      value: e.edition_id, text: (e.title || e.name) + ' · ' + e.row_count + ' rows · ' + e.edition_id.slice(0, 12)
    })));
    select($('nld-project'), [{value: '', text: 'New reviewed project'}, ...projects().map(p => ({
      value: p.id, text: p.title + ' · ' + p.id.slice(0, 12)}))]);
    if (!$('nld-project-id').value) $('nld-project-id').value = id();
    if (oldSource !== $('nld-source').value || !local.loadedSource)
      loadSource().catch(failure);
    const beforeDefinition = $('nld-definition').value, beforeRun = $('nld-completed-run').value;
    renderProject();
    if (oldProject !== $('nld-project').value || beforeDefinition !== $('nld-definition').value || beforeRun !== $('nld-completed-run').value) resetRows();
  }
  $('nld-source').addEventListener('change', () => {
    local.loadedSource = null; resetRows(); loadSource().catch(failure);
  });
  $('nld-project').addEventListener('change', () => {
    if (!project()) $('nld-project-id').value = id();
    resetRows(); renderProject();
  });
  $('nld-load-mapping').addEventListener('click', () => {
    const d = selectedDefinition(); if (!d) return;
    $('nld-source').value = d.edition_id;
    loadSpec(d.specification).catch(failure);
  });
  $('nld-spec-file').addEventListener('change', async () => {
    const file = $('nld-spec-file').files[0], scope = workspaceScope(); if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error('The specification must be at most 1 MiB.');
      const text = await file.text(); assertScope(scope); await loadSpec(JSON.parse(text));
    } catch (error) {failure(error);}
  });
  $('nld-save-spec').addEventListener('click', () => {
    try {
      const content = JSON.stringify(specification(), null, 2) + '\n';
      const url = URL.createObjectURL(new Blob([content], {type: 'application/json'}));
      const link = el('a'); link.href = url; link.download = 'nld-reviewed-specification.json';
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (error) {failure(error);}
  });
  $('nld-prepare-form').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const edition = sourceEdition();
      if (!edition || local.loadedSource !== edition.edition_id) throw new Error('Wait for the complete original schema.');
      const projectId = $('nld-project-id').value;
      if (!/^[a-f0-9]{32}$/.test(projectId)) throw new Error('Use the retained 32-character project ID.');
      await startAction('nld.prepare', {project_id: projectId, edition_id: edition.edition_id, specification: specification()});
      const p = projects().find(p => p.id === projectId);
      if (p) {$('nld-project').value = p.id; renderProject();}
    } catch (error) {failure(error);}
  });
  $('nld-run-form').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const p = project(), d = selectedDefinition(); if (!p || !d) throw new Error('Select a retained project and definition.');
      const strategy = $('nld-strategy').value;
      const keys = $('nld-keys').value.split(/\s+/).filter(Boolean), limitText = $('nld-limit').value;
      const backfill = strategy.startsWith('BACKFILL');
      if (!backfill && (keys.length || limitText)) throw new Error('Only a backfill strategy accepts an explicit selection.');
      if (backfill && Boolean(keys.length) === Boolean(limitText)) throw new Error('Choose exact keys or a positive limit for backfill.');
      if (keys.some(k => !/^[a-f0-9]{64}$/.test(k))) throw new Error('Use the exact retained content keys from the source rows.');
      const body = {project_id: p.id, definition_id: d.id, run_id: id(), strategy,
        operator: $('nld-run-operator').value.trim(), note: $('nld-run-note').value.trim(),
        keys: keys.length ? keys : null, limit: limitText ? Number(limitText) : null};
      if ($('nld-python').value.trim()) body.python = $('nld-python').value.trim();
      await startAction('nld.execute', body);
    } catch (error) {failure(error);}
  });
  for (const control of ['nld-definition', 'nld-completed-run', 'nld-row-kind'])
    $(control).addEventListener('change', () => {resetRows(); renderCoverage();});
  $('nld-read-rows').addEventListener('click', () => rows(0).catch(failure));
  $('nld-previous').addEventListener('click', () => rows(Math.max(0, local.offset - 25)).catch(failure));
  $('nld-next').addEventListener('click', () => rows(local.next).catch(failure));
  $('nld-report-resume').addEventListener('click', async () => {
    try {
      const p = project(), run = selectedRun(); if (!p || !run) throw new Error('Select a completed native run.');
      await startAction('nld.report', {project_id: p.id, run_id: run.id, resume: true});
    } catch (error) {failure(error);}
  });
  $('nld-pack').addEventListener('click', () => {
    const p = project(); if (!p) return failure(new Error('Select a retained project.'));
    startAction('nld.pack', {project_id: p.id}).catch(failure);
  });
  $('nld-restore').addEventListener('click', () => {
    const p = project(); if (!p) return failure(new Error('Select the original retained project.'));
    startAction('nld.restore', {project_id: p.id}).catch(failure);
  });
  return {render};
}
