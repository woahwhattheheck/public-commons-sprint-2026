const $ = (selector, parent = document) => parent.querySelector(selector);
const main = $('#main');
const status = $('#status');
const dialog = $('#inspector');
const token = $('meta[name="workspace-token"]').content;
const tabs = [['setup', '1 · Setup'], ['sources', '2 · Sources'], ['coverage', '3 · Coverage'], ['plans', '4 · Plans & decisions'], ['handover', '5 · Handover']];
const pageSize = 50;
let snapshot;
let busy = false;
let needsRefresh = false;
let drawing = 0;
const view = {tab: tabs.some(([key]) => key === location.hash.slice(1)) ? location.hash.slice(1) : 'setup', dataset: null, sourceOffset: 0, selectedRows: new Set(), board: null, plan: null, shiftQuery: '', shiftOffset: 0, showContext: false, rosterQuery: '', rosterOffset: 0, issueOffset: 0, candidateOffset: 0, candidateQuery: '', candidateStatus: ''};

function node(tag, attrs = {}, children = []) {
  const result = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    if (key.startsWith('on')) result.addEventListener(key.slice(2).toLowerCase(), event => Promise.resolve(value(event)).catch(error => message(error.message, 'error')));
    else if (key === 'class') result.className = value;
    else if (key === 'text') result.textContent = value;
    else if (['value', 'checked', 'disabled', 'required', 'multiple', 'readOnly'].includes(key)) result[key] = value;
    else result.setAttribute(key, String(value));
  }
  for (const child of [children].flat(Infinity)) if (child !== null && child !== undefined && child !== false) result.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return result;
}
const text = value => value === undefined || value === null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const pretty = value => node('pre', {}, JSON.stringify(value, null, 2));
const p = (value, cls = '') => node('p', {class: cls}, value);
const button = (label, action, attrs = {}) => node('button', {type: 'button', onclick: action, ...attrs}, label);
const badge = (value, strong = false) => node('span', {class: `badge${strong ? ' strong' : ''}`}, value);
const help = value => node('span', {class: 'help'}, value);
const empty = value => node('div', {class: 'empty'}, value);
const input = (value = '', attrs = {}) => node('input', {type: 'text', value: value ?? '', ...attrs});
const textarea = (value = '', attrs = {}) => node('textarea', {value: value ?? '', ...attrs});
function select(options, value = '', attrs = {}) {
  const result = node('select', attrs, options.map(option => node('option', {value: Array.isArray(option) ? option[0] : option}, Array.isArray(option) ? option[1] : option)));
  result.value = String(value ?? '');
  return result;
}
function field(label, control, guidance, full = false) {
  const id = control.id || `field-${++field.next}`;
  control.id = id;
  return node('div', {class: `field${full ? ' full' : ''}`}, [node('label', {for: id}, label), control, guidance && help(guidance)]);
}
field.next = 0;
function checkbox(label, checked = false, attrs = {}) {
  const control = input('', {type: 'checkbox', checked, ...attrs});
  return {control, element: node('label', {class: 'check-label'}, [control, node('span', {}, label)])};
}
function panel(title, content, attrs = {}) { return node('section', {class: 'panel', ...attrs}, [node('h3', {}, title), content]); }
function heading(title, description) { return node('div', {class: 'page-heading'}, [node('h2', {}, title), p(description)]); }
function detail(title, content, open = false) { return node('details', {open: open ? '' : null}, [node('summary', {}, title), content]); }
function kv(entries) {
  return node('dl', {class: 'kv'}, entries.flatMap(([label, value]) => [node('dt', {}, label), node('dd', {}, value instanceof Node ? value : text(value))]));
}
function table(headers, rows, label, cls = '') {
  return node('div', {class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': label}, node('table', {class: cls}, [node('thead', {}, node('tr', {}, headers.map(header => node('th', {scope: 'col'}, header)))), node('tbody', {}, rows.map(row => node('tr', {}, row.map(cell => node('td', {}, cell)))))]));
}
function pager(total, offset, action, label = 'rows') {
  return node('div', {class: 'pager'}, [node('span', {}, total ? `${offset + 1}–${Math.min(offset + pageSize, total)} of ${total.toLocaleString()} ${label}` : `0 ${label}`), button('Previous', () => action(Math.max(0, offset - pageSize)), {disabled: offset === 0}), button('Next', () => action(offset + pageSize), {disabled: offset + pageSize >= total})]);
}
function message(value, level = '') { status.textContent = value; status.dataset.level = level; }
function showDialog(title, content) {
  dialog.replaceChildren(node('div', {class: 'dialog-head'}, [node('h2', {id: 'dialog-title'}, title), button('Close', () => dialog.close())]), content);
  if (!dialog.open) dialog.showModal();
}
dialog.addEventListener('click', event => { if (event.target === dialog && (event.offsetX < 0 || event.offsetX > dialog.offsetWidth || event.offsetY < 0 || event.offsetY > dialog.offsetHeight)) dialog.close(); });
function externalLink(url, label = url) {
  try { const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol)) return node('span', {}, label); }
  catch { return node('span', {}, label); }
  return node('a', {href: url, target: '_blank', rel: 'noopener noreferrer'}, label);
}
function download(url, label) { return node('a', {href: url, download: ''}, label); }
const encoded = encodeURIComponent;
function datasetName(id) { return snapshot.datasets.find(item => item.id === id)?.name || id; }
function boardName(id) { return snapshot.boards.find(item => item.id === id)?.label || id; }
function rowRefs(value) {
  const all = Array.isArray(value) ? value : value ? [value] : [];
  const links = all.filter(ref => ref && typeof ref === 'object' && ref.dataset_id).map(ref => button(`${datasetName(ref.dataset_id)} · row ${ref.row_index ?? '?'}`, () => openDataset(ref.dataset_id, Math.max(0, Math.floor(((ref.row_index || 1) - 1) / pageSize) * pageSize)), {class: 'quiet'}));
  return links.length ? node('div', {class: 'reference-links'}, links) : null;
}
function sourceEvidence(value, label = 'Exact source references') {
  return value && detail(label, [rowRefs(value), pretty(value)]);
}
async function request(path, body) {
  let response;
  try { response = await fetch(path, body === undefined ? {cache: 'no-store'} : {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Workspace-Token': token}, body: JSON.stringify(body)}); }
  catch { throw Object.assign(new Error('The connection ended before a reply. Refresh the retained workspace and inspect its current records before trying this action again.'), {uncertain: body !== undefined}); }
  let value;
  try { value = await response.json(); }
  catch { throw Object.assign(new Error('The server did not return a readable workspace response. Refresh to inspect its retained state.'), {uncertain: body !== undefined, status: response.status}); }
  if (!response.ok) throw Object.assign(new Error(value.message || value.error || `Request failed (${response.status}).`), {status: response.status, value});
  return value;
}
function refreshHeader() {
  $('#organization').textContent = snapshot.settings.organization || 'Unconfigured workspace';
  $('#revision').textContent = `Workspace revision ${snapshot.revision} · ${snapshot.boards.length} retained board${snapshot.boards.length === 1 ? '' : 's'}`;
  for (const item of $('#navigation').children) item.setAttribute('aria-current', item.dataset.tab === view.tab ? 'page' : 'false');
}
async function reload() { snapshot = await request('/api/state'); needsRefresh = false; refreshHeader(); }
async function perform(path, body, after, success = 'Saved to the retained workspace.') {
  if (busy) return;
  if (needsRefresh) { message('Refresh and inspect the retained workspace before recording another change.', 'error'); return; }
  busy = true;
  const buttons = [...document.querySelectorAll('button')].filter(item => !item.disabled);
  for (const item of buttons) item.disabled = true;
  message('Saving…');
  let result;
  try {
    result = await request(path, {expected_revision: snapshot.revision, ...body});
    await reload();
    if (after) await after(result);
    await draw();
    message(success);
    return result;
  } catch (error) {
    if (result) {
      needsRefresh = true;
      message(`The change was saved at workspace revision ${result.revision}. The following refresh failed. Use Refresh and inspect the retained record before continuing.`, 'error');
      return result;
    }
    if (error.status === 409 || error.uncertain) {
      needsRefresh = true;
      try { await reload(); await draw(); } catch { /* The original failure remains the useful message. */ }
    }
    message(error.message, 'error');
    return null;
  } finally {
    busy = false;
    for (const item of buttons) if (item.isConnected) item.disabled = false;
  }
}
function navigate(tab) {
  if (busy) return;
  view.tab = tab;
  history.replaceState(null, '', `#${tab}`);
  return draw().then(() => main.focus({preventScroll: true}));
}
function openDataset(id, offset = 0) {
  if (view.dataset !== id) view.selectedRows.clear();
  view.dataset = id; view.sourceOffset = offset;
  if (dialog.open) dialog.close();
  return navigate('sources');
}
function openPlan(id) { view.plan = id; view.candidateOffset = 0; view.candidateQuery = ''; view.candidateStatus = ''; return navigate('plans'); }
function currentBoardId() { return view.board || snapshot.active_board_id || snapshot.boards[0]?.id; }
function boardChooser() {
  const choices = snapshot.boards.map(board => [board.id, `${board.label} · revision ${board.revision}${board.id === snapshot.active_board_id ? ' · current' : ''}`]);
  return field('Retained board', select(choices, currentBoardId(), {onchange: async event => { view.board = event.target.value; view.plan = null; view.shiftOffset = 0; view.rosterOffset = 0; view.issueOffset = 0; await draw(); }}));
}
function boardToolbar() {
  return node('div', {class: 'toolbar'}, [boardChooser(), currentBoardId() !== snapshot.active_board_id && button('Set as current board', () => perform('/api/select-board', {board_id: currentBoardId()}, null, 'Selected the retained board for current review.'))]);
}

function setupView() {
  const settings = snapshot.settings;
  const controls = {
    organization: input(settings.organization, {required: true, maxlength: '200'}), label: input(settings.label, {maxlength: '200'}),
    timezone: input(settings.timezone || 'UTC', {required: true, list: 'timezones'}), week_start: input(settings.week_start, {type: 'date', required: true}),
    source_observed_at: input(settings.source_observed_at, {required: true, placeholder: '2026-10-19T09:00:00-04:00'}),
    expiry_date_inclusive: select([['', 'Choose an explicit date policy'], ['true', 'Valid through the end of the expiration date'], ['false', 'Expires at the start of the expiration date']], settings.expiry_date_inclusive === true ? 'true' : settings.expiry_date_inclusive === false ? 'false' : '', {required: true}),
    notes: textarea(settings.notes, {maxlength: '12000'})
  };
  const cohort = checkbox('I have included the roster, assignments and overlapping context shifts needed to evaluate this planning period.', settings.cohort_complete === true);
  const form = node('form', {onsubmit: event => {
    event.preventDefault();
    const values = Object.fromEntries(Object.entries(controls).map(([key, control]) => [key, control.value]));
    values.expiry_date_inclusive = controls.expiry_date_inclusive.value === 'true'; values.cohort_complete = cohort.control.checked;
    return perform('/api/settings', {settings: values}, null, 'Saved the site, planning period and source policies.');
  }}, [node('div', {class: 'fields'}, [field('Organization / site', controls.organization), field('Workspace label', controls.label), field('Site time zone', controls.timezone, 'Use an IANA time zone such as America/New_York. Original timestamps remain available.'), node('datalist', {id: 'timezones'}, ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London'].map(value => node('option', {value}))), field('First day of the seven-day planning period', controls.week_start, 'Assignments starting in this period count toward each volunteer’s weekly limit.'), field('Source observed at', controls.source_observed_at, 'Enter a timestamp with its UTC offset so the capture has one exact time.'), field('Date-only qualification expiration', controls.expiry_date_inclusive), field('Coordinator context', controls.notes, 'Record scope, missing exports, program constraints or source interpretation.', true), node('div', {class: 'field full'}, cohort.element)]), node('div', {class: 'actions'}, node('button', {type: 'submit', class: 'primary'}, 'Save setup'))]);
  const roleCards = node('div', {class: 'role-cards'}, snapshot.roles.map(role => {
    const id = snapshot.selection[role.key]; const dataset = snapshot.datasets.find(item => item.id === id);
    return node('div', {class: 'role-card'}, [node('strong', {}, role.label), badge(dataset ? 'Selected' : 'Required', !!dataset), node('span', {class: 'muted'}, dataset ? `${dataset.name} · ${dataset.row_count} rows` : 'Upload and confirm this source role.'), button(dataset ? 'Inspect selected source' : 'Choose source', () => { if (id) return openDataset(id); return navigate('sources'); }, {class: 'quiet'})]);
  }));
  const boardLabel = input('', {required: true, placeholder: 'Week of 19 October · coordinator review'});
  const parent = select([['', 'First board / independent board'], ...snapshot.boards.map(board => [board.id, board.label])], snapshot.active_board_id || '');
  const build = node('form', {onsubmit: event => { event.preventDefault(); return perform('/api/boards', {label: boardLabel.value, ...(parent.value && {parent_board_id: parent.value})}, result => { view.board = result.board_id; view.plan = null; view.tab = 'coverage'; }, 'Retained the board and its frozen source versions. Review its findings before planning.'); }}, [node('div', {class: 'fields'}, [field('New board label', boardLabel), field('Continue from a retained board', parent, 'A successor keeps the earlier board, source differences and prior plan references.')]), node('div', {class: 'actions'}, [node('button', {type: 'submit', class: 'primary'}, 'Freeze source versions and build board'), help('Source findings are retained with the board so you can inspect and correct them.')])]);
  return [heading('Set up the planning workspace', 'Define the source scope and time policy, then freeze the five selected inputs into a reviewable coverage board.'), panel('Site and planning period', form), panel('Selected source versions', [roleCards, build])];
}

async function uploadBytes(file) {
  if (file.size > 20 * 1024 * 1024) throw new Error('Choose a source file of at most 20 MiB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
function uploadForm(native = false) {
  const role = select(snapshot.roles.map(item => [item.key, item.label]));
  const file = input('', {type: 'file', accept: native ? '.json,application/json' : '.csv,.tsv,.json,text/csv,application/json'});
  const name = input('', {required: true, placeholder: native ? 'Get Connected capture · 19 October' : 'Original report filename or capture label'});
  const format = select([['csv', 'CSV / TSV'], ['json', 'JSON']], native ? 'json' : 'csv');
  const rootPath = input('', {placeholder: 'data'});
  const url = input('', {type: 'url', placeholder: 'https://…'});
  const pasted = textarea('', {spellcheck: 'false', placeholder: native ? 'Paste a complete getconnected.coverage-snapshot.v1 bundle.' : 'Paste the complete CSV or JSON when an original file is unavailable.'});
  file.addEventListener('change', () => { if (file.files[0]) { name.value ||= file.files[0].name; format.value = /\.json$/i.test(file.files[0].name) ? 'json' : 'csv'; } });
  return node('form', {onsubmit: async event => {
    event.preventDefault();
    if (!file.files[0] && !pasted.value) throw new Error('Choose an original file or paste its complete content.');
    if (file.files[0] && pasted.value) throw new Error('Choose either the original file or pasted content for this import.');
    const content = file.files[0] ? {content_b64: await uploadBytes(file.files[0])} : {text: pasted.value};
    const body = native ? {name: name.value, ...content} : {role: role.value, name: name.value, format: format.value, root_path: rootPath.value, source_url: url.value, ...content};
    return perform(native ? '/api/native-snapshot' : '/api/datasets', body, result => {
      const ids = result.dataset_ids;
      view.dataset = result.dataset_id || (Array.isArray(ids) ? (typeof ids[0] === 'string' ? ids[0] : ids[0]?.id) : ids && Object.values(ids)[0]) || snapshot.datasets[0]?.id;
      view.sourceOffset = 0; view.selectedRows.clear();
    }, native ? 'Retained the native capture. Confirm the projected source roles and coordinator inputs.' : 'Retained the exact source bytes. Inspect the rows and confirm their mapping.');
  }}, [node('div', {class: 'fields'}, [!native && field('Planning role', role), field('Source label', name), field('Original UTF-8 file', file, 'File bytes are retained exactly, including the original line endings.', true), !native && field('File format', format), !native && field('JSON array path', rootPath, 'Leave blank for a top-level array or a data array. Use dotted keys for a nested array.'), !native && field('Source URL / report location', url, 'Optional source location for the handover.', true)]), detail('Paste content instead of choosing a file', field('Complete source content', pasted)), native && p('The native bundle keeps need, shift, response, user and qualification associations. Confirm the four projected roles, then supply coordinator availability and eligibility.', 'muted'), node('div', {class: 'actions'}, node('button', {type: 'submit', class: 'primary'}, native ? 'Retain native capture' : 'Retain source file'))]);
}
function mappingEditor(dataset) {
  const role = snapshot.roles.find(item => item.key === dataset.role);
  const mapping = dataset.mapping || dataset.config?.mapping || {};
  const constants = dataset.constants || dataset.config?.constants || {};
  const maps = dataset.value_maps || dataset.config?.value_maps || {};
  const fields = [];
  const rows = role.fields.map(item => {
    const mode = select([['none', 'Unmapped'], ...dataset.headers.map((header, index) => [`h:${index}`, header]), ['constant', 'Coordinator constant']], Object.hasOwn(constants, item.key) ? 'constant' : Object.hasOwn(mapping, item.key) ? `h:${dataset.headers.indexOf(mapping[item.key])}` : 'none', {'aria-label': `Source for ${item.label}`});
    const constant = input(Object.hasOwn(constants, item.key) ? text(constants[item.key]) : '', {'aria-label': `Constant for ${item.label}`, disabled: mode.value !== 'constant'});
    mode.addEventListener('change', () => { constant.disabled = mode.value !== 'constant'; });
    fields.push({field: item.key, mode, constant});
    return node('div', {class: 'mapping-grid'}, [node('div', {class: 'mapping-label'}, [node('strong', {}, item.label), item.required && node('span', {class: 'muted'}, ' · required'), node('div', {}, node('code', {}, item.key)), item.help && help(item.help)]), mode, constant]);
  });
  const translations = node('div');
  function translation(key = role.fields[0].key, source = '', target = '') {
    const mappedField = select(role.fields.map(item => [item.key, item.label]), key);
    const original = input(source); const canonical = input(text(target) === '—' ? '' : text(target));
    const row = node('div', {class: 'translation'}, [field('Planning field', mappedField), field('Exact source value', original), field('Planning value', canonical), button('Remove', () => row.remove(), {class: 'compact'})]);
    row.read = () => ({key: mappedField.value, source: original.value, target: canonical.value});
    translations.append(row);
  }
  for (const [key, values] of Object.entries(maps)) for (const [source, target] of Object.entries(values)) translation(key, source, target);
  const datetime = input(dataset.datetime_format || dataset.config?.datetime_format || '', {placeholder: '%m/%d/%Y %I:%M %p'});
  return node('form', {onsubmit: event => {
    event.preventDefault(); const nextMapping = {}, nextConstants = {}, valueMaps = {};
    for (const item of fields) { if (item.mode.value === 'constant') nextConstants[item.field] = item.constant.value; else if (item.mode.value.startsWith('h:')) nextMapping[item.field] = dataset.headers[Number(item.mode.value.slice(2))]; }
    for (const row of translations.children) {
      const item = row.read(); valueMaps[item.key] ||= {};
      if (Object.hasOwn(valueMaps[item.key], item.source)) throw new Error(`The value map repeats ${item.key} source value “${item.source}”.`);
      valueMaps[item.key][item.source] = item.target;
    }
    return perform(`/api/datasets/${encoded(dataset.id)}/mapping`, {mapping: nextMapping, constants: nextConstants, value_maps: valueMaps, datetime_format: datetime.value}, null, 'Confirmed the mapping and selected this source version. Existing boards retain their earlier source snapshots.');
  }}, [p('Choose actual report columns or explicit coordinator constants. An empty constant for required qualification IDs declares that no qualification is required.', 'muted'), node('div', {class: 'mapping-grid head'}, ['Planning field', 'Original column / constant', 'Constant value']), rows, detail('Translate source status and other categorical values', [p('Boolean values: true / false. Assignment status: confirmed / excluded. Qualification status: active / pending / inactive / expired / rejected / resubmit.', 'muted'), translations, button('Add value translation', () => translation(), {class: 'compact'})], Object.keys(maps).length > 0), field('Source date and time format', datetime, 'Optional Python strptime format for offset-free report timestamps. Leave blank for ISO timestamps.'), node('div', {class: 'actions'}, [node('button', {type: 'submit', class: 'primary'}, 'Confirm mapping and select source'), help('Coordinator overrides remain visible beside each original row.')])]);
}
function rowInspector(row, dataset) {
  showDialog(`${dataset.name} · source row ${row.row_index}`, [kv([['Source role', dataset.role], ['Original SHA-256', node('code', {}, dataset.sha256)], ['Row index', row.row_index]]), node('h3', {}, 'Planning values'), kv(Object.entries(row.canonical || {})), node('h3', {class: 'spacer'}, 'Coordinator overrides'), Object.keys(row.overrides || {}).length ? kv(Object.entries(row.overrides)) : p('No coordinator overrides for this row.', 'muted'), node('h3', {class: 'spacer'}, 'Original source row'), pretty(row.original), sourceEvidence(row.source_ref)]);
}
function overrideEditor(dataset) {
  const role = snapshot.roles.find(item => item.key === dataset.role);
  const controls = role.fields.map(item => {
    const checked = checkbox(item.label);
    const value = input('', {disabled: true, 'aria-label': `New coordinator value for ${item.label}`});
    checked.control.addEventListener('change', () => { value.disabled = !checked.control.checked; });
    return {key: item.key, checked: checked.control, value, element: node('div', {class: 'override-grid'}, [checked.element, value])};
  });
  const actor = input('', {required: true, maxlength: '200', autocomplete: 'name'}); const note = textarea('', {required: true, maxlength: '4000'});
  const count = p(`${view.selectedRows.size} source rows selected`, 'row-counter'); count.dataset.selectionCount = '';
  return detail('Apply coordinator values to selected rows', node('form', {onsubmit: event => {
    event.preventDefault(); if (!view.selectedRows.size) throw new Error('Select the source rows that need coordinator values.');
    const values = Object.fromEntries(controls.filter(item => item.checked.checked).map(item => [item.key, item.value.value]));
    if (!Object.keys(values).length) throw new Error('Check at least one planning field to set explicitly.');
    const rows = [...view.selectedRows].sort((a, b) => a - b).map(row_index => ({row_index, fields: values}));
    return perform(`/api/datasets/${encoded(dataset.id)}/overrides`, {actor: actor.value, note: note.value, rows}, () => { view.selectedRows.clear(); }, 'Retained the named coordinator values. Build a successor board to use them in planning.');
  }}, [p('Only checked fields receive the entered value. A checked empty value sets an explicit blank. Original file bytes and already-frozen boards remain attached to their existing versions.', 'muted'), count, controls.map(item => item.element), node('div', {class: 'fields spacer'}, [field('Coordinator name', actor), field('Reason / source of these values', note)]), node('div', {class: 'actions'}, node('button', {type: 'submit'}, 'Save coordinator values'))]));
}
function sourceRows(data) {
  const dataset = data.dataset; const role = snapshot.roles.find(item => item.key === dataset.role);
  const all = input('', {type: 'checkbox', 'aria-label': 'Select all source rows on this page', checked: data.rows.length > 0 && data.rows.every(row => view.selectedRows.has(row.row_index))});
  const updateCount = () => { for (const item of main.querySelectorAll('[data-selection-count]')) item.textContent = `${view.selectedRows.size} source rows selected`; };
  const rowChecks = [];
  all.addEventListener('change', () => { for (const {row, control} of rowChecks) { control.checked = all.checked; if (all.checked) view.selectedRows.add(row.row_index); else view.selectedRows.delete(row.row_index); } updateCount(); });
  const rows = data.rows.map(row => {
    const check = input('', {type: 'checkbox', checked: view.selectedRows.has(row.row_index), 'aria-label': `Select source row ${row.row_index}`, onchange: event => { if (event.target.checked) view.selectedRows.add(row.row_index); else view.selectedRows.delete(row.row_index); all.checked = data.rows.every(item => view.selectedRows.has(item.row_index)); updateCount(); }});
    rowChecks.push({row, control: check});
    return [check, row.row_index, ...role.fields.map(item => text(row.canonical?.[item.key])), node('div', {class: 'stack'}, [button('Inspect row', () => rowInspector(row, dataset), {class: 'compact'}), Object.keys(row.overrides || {}).length > 0 && badge(`${Object.keys(row.overrides).length} override${Object.keys(row.overrides).length === 1 ? '' : 's'}`)])];
  });
  return [node('div', {class: 'inline'}, [p('Original rows and current planning values', 'muted'), button('Clear selection', () => { view.selectedRows.clear(); return draw(); }, {class: 'quiet'})]), rows.length ? table([all, 'Row', ...role.fields.map(item => item.label), 'Source'], rows, 'Original source rows and planning values', 'source-rows') : empty('This source has no records. Its header and confirmed mapping remain part of the source inventory.'), pager(data.total, data.offset, offset => { view.sourceOffset = offset; return draw(); }), overrideEditor(dataset)];
}
function findings(items = [], maximum = 20) {
  if (!items.length) return p('No source findings in this view.', 'muted');
  return node('div', {class: 'notice-list'}, items.slice(0, maximum).map(item => node('div', {class: 'finding'}, [node('div', {class: 'inline'}, [badge(item.severity || 'finding'), node('code', {}, item.code || item.field || '')]), p(item.message || text(item)), rowRefs(item.source_refs || item.source_ref || (item.dataset_id ? item : null)), item.row_index && p(`Source row ${item.row_index}${item.field ? ` · ${item.field}` : ''}`, 'muted')])));
}
async function sourcesView() {
  if (!snapshot.datasets.some(item => item.id === view.dataset)) view.dataset = snapshot.datasets[0]?.id || null;
  const data = view.dataset ? await request(`/api/datasets/${encoded(view.dataset)}?offset=${view.sourceOffset}&limit=${pageSize}`) : null;
  const list = node('div', {class: 'source-list'}, snapshot.datasets.map(dataset => button([node('strong', {}, dataset.name), node('small', {}, `${snapshot.roles.find(role => role.key === dataset.role)?.label || dataset.role} · ${dataset.row_count} rows`), badge(snapshot.selection[dataset.role] === dataset.id ? 'Selected' : dataset.confirmed ? 'Confirmed' : 'Needs mapping', snapshot.selection[dataset.role] === dataset.id)], () => openDataset(dataset.id), {'aria-current': String(dataset.id === view.dataset)})));
  const upload = panel('Bring in source data', [detail('Upload an actual report', uploadForm(), !data), detail('Import a native Get Connected capture', uploadForm(true))]);
  let selected = empty('Upload the first source to inspect its actual columns and rows.');
  if (data) {
    const dataset = data.dataset;
    selected = [panel(dataset.name, [kv([['Source role', snapshot.roles.find(role => role.key === dataset.role)?.label || dataset.role], ['Dataset ID', node('code', {}, dataset.id)], ['Retained content', `${dataset.byte_count?.toLocaleString() || '?'} bytes · ${dataset.row_count?.toLocaleString() || 0} rows · ${dataset.format}`], ['SHA-256', node('code', {}, dataset.sha256)], ['Captured / retained', dataset.created_at], ['Current mapping revision', dataset.config_revision], ['Coordinator overrides', dataset.override_count ?? Object.keys(dataset.config?.overrides || {}).length], ...(dataset.source_url ? [['Source location', externalLink(dataset.source_url)]] : [])]), node('div', {class: 'actions'}, [download(`/api/datasets/${encoded(dataset.id)}/raw`, dataset.native_source_id ? 'Download projected role data' : 'Download exact original file'), dataset.native_source_id && download(`/api/native-sources/${encoded(dataset.native_source_id)}/raw`, 'Download exact original native capture'), dataset.confirmed && snapshot.selection[dataset.role] !== dataset.id && button('Select this confirmed source', () => perform('/api/select-dataset', {dataset_id: dataset.id}, null, 'Selected the retained source version.'))]), detail('Field mapping and source value translations', mappingEditor(dataset), !dataset.confirmed), dataset.mapping_history?.length > 0 && detail('Latest mapping and coordinator changes', pretty(dataset.mapping_history)), data.errors?.length > 0 && detail(`${data.error_count ?? data.errors.length} mapping / row findings`, [data.error_count > data.errors.length && p(`Showing the first ${data.errors.length} findings. Confirm the missing field mappings, then inspect the refreshed rows.`, 'muted'), findings(data.errors, data.errors.length)], true)]), panel('Inspect and complete coordinator inputs', sourceRows(data))];
  }
  return [heading('Source files and coordinator inputs', 'Import actual report columns, preserve the original bytes and document the values used to make coverage decisions.'), upload, node('div', {class: 'split'}, [panel('Retained source versions', snapshot.datasets.length ? list : p('No sources retained yet.', 'muted')), node('div', {}, selected)])];
}

function metrics(data) {
  const coverage = data.coverage || []; const targets = coverage.filter(item => item.target !== false);
  return node('div', {class: 'metrics'}, [['Target shifts', targets.length], ['Unfilled places', targets.reduce((sum, item) => sum + Number(item.gap || 0), 0)], ['Named assignments', targets.reduce((sum, item) => sum + Number(item.named || 0), 0)], ['Reserved places', targets.reduce((sum, item) => sum + Number(item.reserved || 0), 0)], ['Roster', data.state.volunteers.length], ['Source findings', data.issues.length]].map(([label, value]) => node('div', {class: 'metric'}, [node('strong', {}, value.toLocaleString()), node('span', {}, label)])));
}
function identity(id, name) { return node('div', {class: 'id-cell'}, [node('strong', {}, name || id), node('code', {}, id)]); }
function proposeDialog(data, shiftId) {
  const shift = data.state.shifts.find(item => item.id === shiftId);
  const people = data.state.volunteers;
  const absent = select([['', 'Nobody — fill remaining places'], ...(shift.assigned || []).map(id => [id, `${people.find(person => person.id === id)?.name || id} · ${id}`])]);
  const excluded = select([['', 'No additional exclusion'], ...people.map(person => [person.id, `${person.name} · ${person.id}`])]);
  const label = input(`Coverage · ${shift.label}`, {required: true});
  showDialog(`Plan coverage · ${shift.label}`, node('form', {onsubmit: event => {
    event.preventDefault();
    return perform(`/api/boards/${encoded(data.board.id)}/plans`, {shift_id: shift.id, ...(absent.value && {absent_volunteer_id: absent.value}), ...(excluded.value && {excluded_volunteer_id: excluded.value}), label: label.value}, result => { dialog.close(); view.plan = result.plan_id; view.tab = 'plans'; }, 'Retained the original planner proposal and every candidate reason.');
  }}, [kv([['Exact shift ID', node('code', {}, shift.id)], ['Interval', `${shift.start} → ${shift.end}`], ['Required qualifications', (shift.required || []).join(' · ') || 'None'], ['Reserved places', shift.reservedSlots || 0]]), node('div', {class: 'fields'}, [field('Assigned volunteer who is absent', absent), field('Additional volunteer to exclude', excluded), field('Plan label', label, '', true)]), p('The original planner checks the full shift interval, current bookings, eligibility, qualification windows, weekly limits and available places.', 'callout'), node('div', {class: 'actions'}, node('button', {type: 'submit', class: 'primary'}, 'Retain coverage proposal'))]));
}
function coverageTable(data) {
  const query = input(view.shiftQuery, {type: 'search', placeholder: 'Shift label or exact ID'});
  const context = checkbox('Show overlapping context shifts', view.showContext, {onchange: event => { view.showContext = event.target.checked; view.shiftOffset = 0; return draw(); }});
  const form = node('form', {class: 'toolbar', onsubmit: event => { event.preventDefault(); view.shiftQuery = query.value; view.shiftOffset = 0; return draw(); }}, [field('Find a shift', query), node('button', {type: 'submit'}, 'Find'), context.element]);
  const filtered = data.coverage.filter(item => (view.showContext || item.target !== false) && `${item.id} ${item.label}`.toLowerCase().includes(view.shiftQuery.toLowerCase()));
  view.shiftOffset = filtered.length && view.shiftOffset >= filtered.length ? 0 : view.shiftOffset;
  const rows = filtered.slice(view.shiftOffset, view.shiftOffset + pageSize).map(item => [identity(item.id, item.label), node('div', {class: 'stack'}, [node('span', {}, item.start), node('span', {}, item.end)]), item.capacity, item.named, item.reserved, badge(item.gap, Number(item.gap) > 0), item.target === false ? badge('Context') : button('Plan coverage', () => proposeDialog(data, item.id), {class: 'compact', disabled: data.board.valid === false}), button('Inspect shift', () => { const shift = data.state.shifts.find(shift => shift.id === item.id); showDialog(item.label, [kv([['Shift ID', item.id], ['Capacity / reserved', `${item.capacity} / ${item.reserved}`], ['Required qualifications', (shift.required || []).join(' · ') || 'None']]), node('h3', {}, 'Current named assignments'), (shift.assigned || []).length ? (shift.assigned || []).map(id => p(`${data.state.volunteers.find(person => person.id === id)?.name || id} · ${id}`)) : p('No named assignments.', 'muted'), sourceEvidence(shift.source_refs), detail('Exact planning record', pretty(shift))]); }, {class: 'quiet'})]);
  return [form, rows.length ? table(['Shift', 'Start / end', 'Places', 'Named', 'Reserved', 'Gap', 'Planning', 'Source'], rows, 'Shift coverage and exact assignments', 'coverage-table') : empty('No shifts match this view.'), pager(filtered.length, view.shiftOffset, offset => { view.shiftOffset = offset; return draw(); }, 'shifts')];
}
function rosterView(roster) {
  const query = input(view.rosterQuery, {type: 'search', placeholder: 'Volunteer name or exact ID'});
  const form = node('form', {class: 'toolbar', onsubmit: event => { event.preventDefault(); view.rosterQuery = query.value; view.rosterOffset = 0; return draw(); }}, [field('Find a volunteer', query), node('button', {type: 'submit'}, 'Find')]);
  const rows = roster.rows.map(person => {
    const id = person.volunteer_id || person.id; const assignments = person.assignments || [];
    return [identity(id, person.name), text(person.active), text(person.weekly_limit ?? person.weeklyLimit), Array.isArray(assignments) ? assignments.length : text(assignments), button('Inspect roster and sources', () => showDialog(`${person.name || id} · roster`, [kv(Object.entries(person).filter(([key, value]) => !['source_refs', 'assignments', 'qualifications', 'availability'].includes(key) && typeof value !== 'object')), detail('Current assignments', pretty(assignments), true), detail('Availability and eligibility', pretty(person.availability || person.eligibility || {}), true), detail('Qualifications and expiration', pretty(person.qualifications || person.qualificationWindows || []), true), sourceEvidence(person.source_refs)]), {class: 'compact'})];
  });
  return [form, rows.length ? table(['Volunteer', 'Active', 'Weekly limit', 'Assignments', 'Review'], rows, 'Source-linked volunteer roster') : empty('No volunteers match this roster view.'), pager(roster.total, roster.offset, offset => { view.rosterOffset = offset; return draw(); }, 'volunteers')];
}
function continuityView(continuity) {
  if (!continuity) return p('This board starts a new planning history.', 'muted');
  const lists = Object.entries(continuity).filter(([, value]) => Array.isArray(value));
  return [kv(Object.entries(continuity).filter(([, value]) => !Array.isArray(value) && (value === null || typeof value !== 'object'))), ...lists.map(([key, values]) => detail(`${key.replaceAll('_', ' ')} · ${values.length}`, values.length ? values.slice(0, 100).map((value, index) => detail(`Change ${index + 1}${value.id ? ` · ${value.id}` : ''}`, pretty(value))) : p('No changes in this category.', 'muted'))), detail('Complete board continuity', pretty(continuity))];
}
async function coverageView() {
  const id = currentBoardId(); if (!id) return [heading('Coverage and roster', 'Build the first board from the five selected source roles.'), empty('No coverage board has been retained yet.'), node('div', {class: 'actions'}, button('Set up and build a board', () => navigate('setup'), {class: 'primary'}))];
  const [data, roster] = await Promise.all([request(`/api/boards/${encoded(id)}`), request(`/api/boards/${encoded(id)}/roster?offset=${view.rosterOffset}&limit=${pageSize}&query=${encoded(view.rosterQuery)}`)]);
  return [heading('Review coverage and the current roster', 'Inspect occupied and reserved places, resolve source findings, and ask the original planner to fill a shift or replace a named absence.'), boardToolbar(), metrics(data), data.board.valid === false && p('This board has blocking source findings. Open the exact source rows, correct the source selection or coordinator values, then build a successor board.', 'callout'), panel('Shift coverage', coverageTable(data)), detail(`Source findings · ${data.issues.length}`, [findings(data.issues.slice(view.issueOffset, view.issueOffset + pageSize), pageSize), pager(data.issues.length, view.issueOffset, offset => { view.issueOffset = offset; return draw(); }, 'findings')], data.board.valid === false), panel('Source-linked volunteer roster', rosterView(roster)), detail('Changes from the earlier board', continuityView(data.continuity)), detail('Exact frozen source inventory', sourceInventory(data.source_inventory))];
}

function sourceInventory(inventory) {
  if (!inventory) return p('No source inventory returned.', 'muted');
  const rows = Array.isArray(inventory) ? inventory : Object.entries(inventory).map(([role, item]) => typeof item === 'object' ? {role, ...item} : {role, dataset_id: item});
  return [p('These are the versions frozen with this board. Source links open the retained file and its current coordinator values; the handover includes the board’s frozen configuration.', 'muted'), table(['Role', 'Original source', 'SHA-256', 'Mapping revision', 'Inspect'], rows.map(item => { const id = item.dataset_id || item.id; return [item.role, item.name || datasetName(id), node('code', {}, item.sha256 || item.original_sha256 || '—'), text(item.config_revision), id && button('Inspect source', () => openDataset(id), {class: 'quiet'})]; }), 'Frozen source inventory'), detail('Complete frozen source records', pretty(inventory))];
}
function planList(data) {
  return data.plans.length ? table(['Plan / exact ID', 'Status', 'Board revision', 'Created', 'Review'], data.plans.map(plan => [identity(plan.id, plan.label), badge(plan.status), plan.board_revision, plan.created_at, button('Open plan', () => openPlan(plan.id), {class: 'compact'})]), 'Retained coverage plans') : empty('This board has no plans yet. Choose a target shift in Coverage to retain a proposal.');
}
function candidateView(candidate) {
  const id = candidate.volunteer_id || candidate.id;
  return node('div', {class: 'candidate'}, [node('div', {class: 'candidate-header'}, [node('h4', {}, `${candidate.name || id} · ${id}`), badge(candidate.status || 'review', candidate.status === 'chosen')]), p(candidate.reason || ''), candidate.source_rows?.length > 0 && detail('Original rows frozen for this proposal', candidate.source_rows.map(row => detail(`${row.source_ref?.role || 'Source'} · row ${row.row_index}`, [node('h4', {}, 'Planning values at this proposal'), kv(Object.entries(row.canonical || {})), Object.keys(row.overrides || {}).length > 0 && detail('Coordinator values at this proposal', pretty(row.overrides)), detail('Original source record', pretty(row.original)), sourceEvidence(row.source_ref)]))), sourceEvidence(candidate.source_refs), candidate.qualifications && detail('Qualification windows and original source rows', [pretty(candidate.qualifications)]), candidate.availability && detail('Availability and eligibility evidence', pretty(candidate.availability)), candidate.assignments && detail('Existing assignments and overlap context', pretty(candidate.assignments))]);
}
function candidateList(data) {
  const candidates = data.candidates || data.proposal.candidateReview || [];
  const query = input(view.candidateQuery, {type: 'search', placeholder: 'Name, exact ID or reason'});
  const filter = select([['', 'All candidates'], ...[...new Set(candidates.map(item => item.status))].filter(Boolean).map(value => [value, value])], view.candidateStatus);
  const form = node('form', {class: 'toolbar', onsubmit: event => { event.preventDefault(); view.candidateQuery = query.value; view.candidateStatus = filter.value; view.candidateOffset = 0; return draw(); }}, [field('Find candidate evidence', query), field('Candidate outcome', filter), node('button', {type: 'submit'}, 'Filter candidates')]);
  const filtered = candidates.filter(item => (!view.candidateStatus || item.status === view.candidateStatus) && `${item.name} ${item.volunteer_id || item.id} ${item.reason}`.toLowerCase().includes(view.candidateQuery.toLowerCase()));
  if (view.candidateOffset >= filtered.length) view.candidateOffset = 0;
  return [form, filtered.length ? filtered.slice(view.candidateOffset, view.candidateOffset + pageSize).map(candidateView) : empty('No candidate evidence matches this view.'), pager(filtered.length, view.candidateOffset, offset => { view.candidateOffset = offset; return draw(); }, 'candidates')];
}
function reviewForm(data) {
  const {plan, proposal} = data;
  const actor = input('', {required: true, autocomplete: 'name', maxlength: '200'}); const note = textarea('', {required: true, maxlength: '4000'});
  const checked = checkbox('I reviewed this exact board, the selected source versions, and the candidate evidence for this decision.', false, {required: true});
  const current = data.source_matches_current !== false && data.board_revision === plan.board_revision;
  const decision = select([['APPROVE', 'Approve this exact proposal'], ['REJECT', 'Reject this proposal']], proposal.ok && current ? 'APPROVE' : 'REJECT');
  if (!proposal.ok || !current) decision.options[0].disabled = true;
  return node('form', {onsubmit: event => {
    event.preventDefault();
    return perform(`/api/plans/${encoded(plan.id)}/review`, {decision: decision.value, actor: actor.value, note: note.value, confirmed_current_source: checked.control.checked}, null, decision.value === 'APPROVE' ? 'Applied the exact proposal and retained the named decision with its before / after roster.' : 'Retained the named rejection and its reason.');
  }}, [!current && p('The board revision or selected source versions have changed since this proposal. Replan on the current board to prepare an approval, or retain a rejection here.', 'callout'), node('div', {class: 'fields'}, [field('Decision', decision), field('Coordinator name', actor), field('Decision reason / operational context', note, '', true), node('div', {class: 'field full'}, checked.element)]), node('div', {class: 'actions'}, node('button', {type: 'submit', class: 'primary'}, 'Record decision'))]);
}
function replanForm(plan) {
  const board = select(snapshot.boards.map(item => [item.id, `${item.label} · revision ${item.revision}`]), currentBoardId());
  const label = input(`${plan.label} · current review`, {required: true});
  return node('form', {onsubmit: event => {
    event.preventDefault(); const intent = plan.intent || {};
    const shiftId = intent.shiftId || intent.shift_id;
    if (!shiftId) throw new Error('This retained plan does not contain a shift ID. Select the exact shift in Coverage.');
    const absent = intent.absentVolunteerId || intent.absent_volunteer_id; const excluded = intent.excludedVolunteerId || intent.excluded_volunteer_id;
    return perform(`/api/boards/${encoded(board.value)}/plans`, {shift_id: shiftId, ...(absent && {absent_volunteer_id: absent}), ...(excluded && {excluded_volunteer_id: excluded}), label: label.value, prior_plan_id: plan.id}, result => { view.board = board.value; view.plan = result.plan_id; }, 'Replanned the same scenario against the selected board and retained its prior review for comparison.');
  }}, [p('After importing corrected sources, freeze a successor board and run the same shift scenario there. Its earlier decision stays available for comparison.', 'muted'), node('div', {class: 'fields spacer'}, [field('Board for the new proposal', board), field('New plan label', label)]), node('div', {class: 'actions'}, node('button', {type: 'submit'}, 'Replan with prior review'))]);
}
function planDetail(data) {
  const {plan, proposal} = data;
  const decided = ['APPROVED', 'REJECTED', 'UNDONE', 'APPLIED', 'STALE', 'SUPERSEDED'].includes(String(plan.status).toUpperCase()) || !!plan.review;
  const changes = proposal.changes || [];
  return panel(plan.label, [node('div', {class: 'inline'}, [badge(plan.status, true), node('code', {}, plan.id)]), kv([['Board', boardName(plan.board_id)], ['Planned at board revision', plan.board_revision], ['Current board revision', data.board_revision], ['Selected sources', data.source_matches_current ? 'Match this board' : 'Differ from this board'], ['Created', plan.created_at], ['Prior plan', plan.prior_plan_id || 'No earlier plan']]), p(proposal.message || (proposal.ok ? 'Coverage proposal is ready for review.' : 'The planner could not fill this scenario.'), 'callout'), node('h4', {}, 'Proposed roster changes'), changes.length ? changes.map(change => node('div', {class: 'change'}, [node('strong', {}, `${String(change.action).toUpperCase()} · ${change.name || change.volunteerId}`), p(`Volunteer ${change.volunteerId} · shift ${change.shiftId}`, 'mono')])) : p('No roster changes in this proposal.', 'muted'), data.prior_review && detail('Prior review and earlier decision', pretty(data.prior_review), true), plan.review && detail('Retained coordinator decision', pretty(plan.review), true), node('h4', {}, 'Candidate reasons and source evidence'), candidateList(data), detail('Original planner trace and exclusion totals', [proposal.rejected && kv(Object.entries(proposal.rejected)), pretty(proposal.trace || [])]), detail('Source versions used for this proposal', sourceInventory(data.source_inventory)), !decided && node('section', {class: 'review-box'}, [node('h3', {}, 'Coordinator decision'), reviewForm(data)]), detail('Replan this scenario after source corrections', replanForm(plan)), detail('Exact original planner output', pretty(proposal))]);
}
function undoDialog(board, decision) {
  const actor = input('', {required: true, autocomplete: 'name'}); const note = textarea('', {required: true});
  showDialog('Reverse the latest applied decision', node('form', {onsubmit: event => {
    event.preventDefault();
    return perform(`/api/boards/${encoded(board.id)}/undo`, {decision_id: decision.id, actor: actor.value, note: note.value}, () => dialog.close(), 'Retained the reversal and restored the prior roster. Earlier proposals remain tied to their original revisions.');
  }}, [p('This records a named reversal of the board’s most recent approval. Review the resulting roster before preparing another proposal.', 'callout'), kv([['Decision', decision.id], ['Board', board.label]]), node('div', {class: 'fields'}, [field('Coordinator name', actor), field('Reason for reversal', note)]), node('div', {class: 'actions'}, node('button', {type: 'submit', class: 'primary'}, 'Record reversal'))]));
}
function decisionsView(data) {
  const decisions = data.decisions || [];
  if (!decisions.length) return p('No coordinator decisions recorded on this board.', 'muted');
  const ordered = [...decisions].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const latestApproval = decisions.find(item => item.id === data.latest_undoable_decision_id);
  return [table(['Decision', 'Coordinator', 'Recorded', 'Plan', 'Reason'], [...ordered].reverse().map(item => [badge(item.decision || item.kind || item.action || 'Decision'), item.actor, item.created_at, item.plan_id ? button(item.plan_id, () => openPlan(item.plan_id), {class: 'quiet mono'}) : '—', item.note]), 'Retained coordinator decisions'), latestApproval && node('div', {class: 'actions'}, button('Reverse latest approval', () => undoDialog(data.board, latestApproval))), detail('Complete decision history', pretty(decisions))];
}
async function plansView() {
  const id = currentBoardId(); if (!id) return [heading('Plans and coordinator decisions', 'Coverage plans remain attached to their exact board revision and source versions.'), empty('Build the first coverage board to begin planning.')];
  const data = await request(`/api/boards/${encoded(id)}`);
  const chosen = view.plan || data.plans[0]?.id;
  const plan = chosen ? await request(`/api/plans/${encoded(chosen)}`) : null;
  return [heading('Plans and coordinator decisions', 'Review the original planner’s proposed changes and candidate reasons, record the decision, and carry the scenario into a corrected source board when needed.'), boardToolbar(), panel('Retained plans', planList(data)), plan && planDetail(plan), panel('Board decision history', decisionsView(data))];
}

async function handoverView() {
  const id = currentBoardId(); const data = id ? await request(`/api/boards/${encoded(id)}`) : null;
  return [heading('Hand over the operating workspace', 'Give the next coordinator the selected board, its original inputs and decisions, and a complete backup that reopens in the same application.'), data && boardToolbar(), panel('Download the retained work', node('div', {class: 'download-list'}, [data && node('div', {}, [download(`/api/boards/${encoded(id)}/handoff`, `Download ${data.board.label} · complete handover ZIP`), p('Includes exact selected inputs, frozen mappings and settings, original and current roster, source-linked changes, plans, decisions, review HTML and the content manifest.')]), node('div', {}, [download('/api/backup', 'Download complete SQLite workspace backup'), p('Includes every source version, board and decision. Reopen the downloaded file using the same app.py --db command.')])])), data && panel('Selected board source inventory', sourceInventory(data.source_inventory)), data && panel('Continuity from earlier planning', continuityView(data.continuity)), panel('Coordinator handover sequence', [node('ol', {class: 'workflow-list'}, [node('li', {}, 'Open the selected board and review its source scope, findings, named assignments and reserved capacity.'), node('li', {}, 'Read the latest approved or rejected plans and the coordinator’s reason. Inspect candidate evidence when a staffing choice needs explanation.'), node('li', {}, 'Download the board handover ZIP and the complete workspace backup. Keep the source exports with the authorized coordinator handover.'), node('li', {}, ['Restart the application with the backed-up database: ', node('code', {}, 'python3 app.py --db /absolute/private/path/coverage.sqlite --port 8802'), '. Open the printed local address and confirm the board and decision history.']), node('li', {}, 'For a later correction, import the new original exports, confirm their mappings, retain a successor board and replan the earlier scenario before recording a new decision.')]), p('The original Get Connected assignment remains an external operational action. Use the approved roster handover to make that assignment through the organization’s established process.', 'muted')]), snapshot.source_links && detail('Source references and operating documentation', sourceLinks(snapshot.source_links))];
}
function sourceLinks(links) {
  const values = Array.isArray(links) ? links : Object.entries(links).map(([label, url]) => typeof url === 'string' ? {label, url} : url);
  return node('ul', {}, values.map(item => node('li', {}, typeof item === 'string' ? externalLink(item) : externalLink(item.url || item.href || '', item.label || item.title || item.url || text(item)))));
}
async function draw() {
  const generation = ++drawing;
  refreshHeader();
  main.setAttribute('aria-busy', 'true');
  try {
    const content = await ({setup: setupView, sources: sourcesView, coverage: coverageView, plans: plansView, handover: handoverView}[view.tab])();
    if (generation !== drawing) return;
    main.replaceChildren(...[content].flat(Infinity).filter(Boolean));
    history.replaceState(null, '', `#${view.tab}`);
  } catch (error) { if (generation === drawing) message(error.message, 'error'); }
  finally { if (generation === drawing) main.setAttribute('aria-busy', 'false'); }
}
$('#navigation').replaceChildren(...tabs.map(([key, label]) => button(label, () => navigate(key), {'data-tab': key})));
$('#refresh').addEventListener('click', async () => {
  if (busy) return;
  try { await reload(); await draw(); message('Refreshed the retained workspace.'); } catch (error) { message(error.message, 'error'); }
});
window.addEventListener('hashchange', () => { const tab = location.hash.slice(1); if (tabs.some(([key]) => key === tab)) { view.tab = tab; draw(); } });
try { await reload(); await draw(); message('Workspace ready.'); }
catch (error) { message(error.message, 'error'); main.replaceChildren(empty('The retained workspace could not be opened. Check the server message, then use Refresh.')); }
