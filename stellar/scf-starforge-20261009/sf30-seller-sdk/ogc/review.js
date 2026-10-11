'use strict';
(() => {
  const data = JSON.parse(document.getElementById('inspection').textContent);
  const $ = id => document.getElementById(id), rows = [];
  const element = (name, text, parent) => { const item = document.createElement(name); if (text !== undefined) item.textContent = text; parent?.append(item); return item; };
  const input = (type, value, parent, label) => { const node = element('input', undefined, parent); node.type = type; if (type === 'checkbox') node.checked = Boolean(value); else node.value = value; node.setAttribute('aria-label', label); return node; };
  const select = (values, selected, parent, label) => { const node = element('select', undefined, parent); for (const value of values) { const option = element('option', value, node); option.value = value; } node.value = selected; node.setAttribute('aria-label', label); return node; };
  const status = message => { $('status').textContent = message; };
  $('source-title').textContent = data.name; $('name').value = data.name;
  for (const [key, value] of [['Rows', data.rows], ['Pages', data.pages], ['Source bytes', data.bytes.toLocaleString()], ['Traversal', data.complete ? 'Terminal next link reached' : 'Capture still has a next page']]) {
    element('dt', key, $('source')); element('dd', String(value), $('source'));
  }
  $('identity').textContent = data.itemsUrl + '\nSource ID: ' + data.sourceId + '\nCaptured: ' + data.capturedAt + '\n' + data.coordinates + '\nSource license / operator note: ' + (data.license || 'Not supplied');
  $('coverage').textContent = 'Provider matched counts: ' + (data.matchedCounts.join(', ') || 'Not supplied') + '. Retained duplicate ID occurrences: ' + data.duplicateIds + '. Features without IDs: ' + data.absentIds + '. Every captured occurrence is preserved.';
  const usedNames = new Set();
  function makeRow(property, index) {
    const row = element('tr', undefined, $('fields'));
    const cell = () => element('td', undefined, row);
    const use = input('checkbox', false, cell(), 'Publish ' + property.pointer);
    const detail = cell(); element('code', property.pointer, detail);
    element('small', Object.entries(property.types).map(([type, count]) => type + ': ' + count).join(' · ') + ' · missing: ' + property.missing, detail);
    if (property.unsafeIntegers) element('strong', property.unsafeIntegers + ' large integer values — use string', detail);
    if (property.emptyStrings) element('small', property.emptyStrings + ' empty strings', detail);
    const examples = element('details', undefined, detail); element('summary', 'Source examples', examples); element('pre', property.examples.join('\n'), examples);
    let proposed = property.pointer === '/id' ? 'feature_id' : property.pointer.split('/').at(-1).replace(/~1/g, '_').replace(/~0/g, '_').replace(/[^A-Za-z0-9_]/g, '_');
    if (!/^[A-Za-z]/.test(proposed)) proposed = 'field_' + proposed;
    proposed = proposed.slice(0, 40) || 'field';
    if (['constructor','prototype','__proto__'].includes(proposed) || usedNames.has(proposed)) proposed += '_' + index;
    usedNames.add(proposed);
    const name = input('text', proposed, cell(), 'Published name for ' + property.pointer); name.maxLength = 48;
    const type = select(['string','integer','number','boolean'], 'string', cell(), 'Type for ' + property.pointer);
    const format = select(['scalar','json'], property.types.object || property.types.array ? 'json' : 'scalar', cell(), 'Format for ' + property.pointer);
    const nullable = input('checkbox', Boolean(property.missing || property.types.null), cell(), 'Nullable ' + property.pointer);
    const filter = input('checkbox', false, cell(), 'Enable equality for ' + property.pointer);
    const range = input('checkbox', false, cell(), 'Enable range for ' + property.pointer);
    const sort = input('checkbox', false, cell(), 'Enable sorting for ' + property.pointer);
    const record = { row, property, use, name, type, format, nullable, filter, range, sort };
    rows.push(record); return record;
  }
  data.properties.forEach(makeRow);
  function plan() {
    const chosen = rows.filter(row => row.use.checked);
    return { schema: 'stellar-forge.ogc-plan.v1', sourceId: data.sourceId, name: $('name').value,
      columns: chosen.map(r => ({ name: r.name.value, pointer: r.property.pointer, type: r.type.value, nullable: r.nullable.checked, format: r.format.value })),
      filters: chosen.filter(r => r.filter.checked).map(r => r.name.value),
      ranges: chosen.filter(r => r.range.checked).map(r => r.name.value),
      sorts: chosen.filter(r => r.sort.checked).map(r => r.name.value),
      defaultLimit: Number($('defaultLimit').value), maxLimit: Number($('maxLimit').value), maxCellChars: Number($('maxCellChars').value),
      nullEmptyPolicy: $('null-policy').checked ? 'native-empty-is-null' : '', notes: $('notes').value };
  }
  function error(p) {
    if (!data.complete) return 'Continue the capture before exporting a complete dataset.';
    if (!p.name.trim() || p.name.length > 128) return 'Enter a dataset name.';
    if (!p.columns.length || p.columns.length > 64) return 'Select 1–64 published columns.';
    if (new Set(p.columns.map(c => c.name)).size !== p.columns.length || p.columns.some(c => !/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(c.name) || ['constructor','prototype','__proto__'].includes(c.name))) return 'Use unique column names beginning with a letter.';
    if (p.columns.some(c => c.format === 'json' && c.type !== 'string')) return 'JSON projection requires the string type.';
    if (p.ranges.some(name => p.columns.find(c => c.name === name)?.type === 'boolean')) return 'Boolean columns do not support native ranges.';
    if ([p.filters,p.ranges,p.sorts].some(a => a.length > 8) || 3+p.filters.length+4*p.ranges.length+(p.sorts.length ? 1 : 0) > 32) return 'The native offer supports eight of each capability and 32 total query parameters.';
    if (!Number.isInteger(p.defaultLimit) || !Number.isInteger(p.maxLimit) || p.defaultLimit < 1 || p.defaultLimit > p.maxLimit || p.maxLimit > 1000) return 'Choose page limits from 1–1000, with default no larger than maximum.';
    if (!Number.isInteger(p.maxCellChars) || p.maxCellChars < 1 || p.maxCellChars > 1048576) return 'Choose a cell limit from 1–1048576 characters.';
    if (!p.nullEmptyPolicy) return 'Review and accept the native nullable CSV rule.';
    return '';
  }
  function update() {
    const p = plan(); $('selection').textContent = p.columns.length + ' published columns · ' + (3+p.filters.length+4*p.ranges.length+(p.sorts.length ? 1 : 0)) + '/32 native query parameters';
    for (const r of rows) r.row.classList.toggle('selected', r.use.checked);
    try { localStorage.setItem('starforge-ogc:' + data.sourceId, JSON.stringify(p)); } catch { /* File-mode persistence may be disabled; explicit export remains available. */ }
  }
  function apply(p) {
    if (!p || p.schema !== 'stellar-forge.ogc-plan.v1' || p.sourceId !== data.sourceId || !Array.isArray(p.columns)) throw new Error('Choose a plan bound to this exact source capture.');
    if (p.columns.some(c => !data.properties.some(r => r.pointer === c.pointer))) throw new Error('Plan contains unavailable source properties.');
    for (const r of rows) r.use.checked = false;
    const selectedRows = [];
    for (const c of p.columns) {
      const r = rows.find(r => r.property.pointer === c.pointer && !selectedRows.includes(r)) ??
        makeRow(data.properties.find(r => r.pointer === c.pointer), rows.length);
      r.use.checked = true; r.name.value = c.name; r.type.value = c.type; r.format.value = c.format; r.nullable.checked = c.nullable;
      r.filter.checked = Boolean(p.filters?.includes(c.name)); r.range.checked = Boolean(p.ranges?.includes(c.name)); r.sort.checked = Boolean(p.sorts?.includes(c.name));
      selectedRows.push(r);
    }
    rows.splice(0, rows.length, ...selectedRows, ...rows.filter(r => !selectedRows.includes(r)));
    for (const r of rows) $('fields').append(r.row);
    $('name').value = p.name; $('defaultLimit').value = p.defaultLimit ?? 50; $('maxLimit').value = p.maxLimit ?? 250; $('maxCellChars').value = p.maxCellChars ?? 65536;
    $('notes').value = p.notes ?? ''; $('null-policy').checked = p.nullEmptyPolicy === 'native-empty-is-null'; update();
  }
  document.addEventListener('change', event => { if (event.target.id !== 'import') update(); });
  $('filter').addEventListener('input', () => { const term = $('filter').value.toLowerCase(); for (const r of rows) r.row.hidden = !r.property.pointer.toLowerCase().includes(term) && !r.name.value.toLowerCase().includes(term); });
  $('clear').onclick = () => { for (const r of rows) r.use.checked = false; update(); status('Selection cleared. Captured source is unchanged.'); };
  $('save').onclick = () => {
    const p = plan(), issue = error(p); if (issue) { status(issue); return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify(p, null, 2) + '\n'], {type:'application/json'}));
    const a = element('a', ''); a.href = url; a.download = 'reviewed-plan.json'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    update(); status('Reviewed plan saved. The export command validates every source row through the original dataset engine.');
  };
  $('import').onchange = async () => { try { const file = $('import').files[0]; if (!file) return; if (file.size > 262144) throw new Error('Plan exceeds 256 KiB.'); apply(JSON.parse(await file.text())); status('Saved source-bound plan reopened.'); } catch (e) { status(e.message); } };
  let selected = 0;
  function sample() {
    const s = data.samples[selected]; $('sample-index').textContent = data.samples.length ? 'Retained feature ' + (selected+1) + ' of ' + data.samples.length + ' shown' : 'Empty collection';
    $('sample').textContent = s ? s.featureJson : 'No features were returned.'; $('previous').disabled = selected === 0; $('next').disabled = selected >= data.samples.length-1;
  }
  $('previous').onclick = () => { selected--; sample(); }; $('next').onclick = () => { selected++; sample(); };
  try { const saved = localStorage.getItem('starforge-ogc:' + data.sourceId); if (saved) { apply(JSON.parse(saved)); status('Local source-bound draft restored.'); } } catch { /* Explicit import is the portable path. */ }
  update(); sample();
})();
