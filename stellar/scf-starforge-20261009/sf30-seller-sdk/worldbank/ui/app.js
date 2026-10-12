// MIT. Plain browser controls for the original World Bank operator.
const $ = id => document.getElementById(id);
const COLUMNS = ['source_id','country_id','country_iso3','country_name','indicator_id','indicator_name','period','value','value_state','unit','obs_status','decimal','footnote','region','aggregate','source_page','source_row'];
const MANDATORY = new Set(['source_id','country_id','country_iso3','indicator_id','period','value','value_state']);
const titles = { selections:'Selections', captures:'Captures', review:'Edition review', exports:'Exports', merchant:'Merchant', activity:'Activity' };
const model = {
  state: { selections:[], captures:[], reviews:[], exports:[], catalogs:[], jobs:[] },
  tab:'selections', currentCapture:null, export:null, reviewCapture:null,
  excluded:new Set(), choices:{}, reviewDirty:false, buyerReview:null, buyer:null,
  observations:null, reviewRows:null, comparison:null, activity:[], refreshing:false
};
let token = location.hash.slice(1);
if (token) { sessionStorage.setItem('worldbank.session', token); history.replaceState(null, '', location.pathname); }
else token = sessionStorage.getItem('worldbank.session') || '';

function element(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (['checked','disabled','selected','readOnly'].includes(key)) node[key] = Boolean(value);
    else if (value !== null && value !== undefined) node.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) if (child !== null && child !== undefined)
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
function button(label, action, attrs = {}) {
  return element('button', { type:'button', ...attrs, onclick:event => guarded(action, event.currentTarget) }, label);
}
function clear(id, ...children) { $(id).replaceChildren(...children.flat()); }
function showNotice(message, level = 'info') {
  $('notice').textContent = message; $('notice').dataset.level = level; $('notice').hidden = false;
}
function failure(error) {
  showNotice((error.code ? error.code + ' · ' : '') + error.message, 'error');
  if (error.conflicts) guarded(() => showConflicts(error.conflicts));
}
async function guarded(action, control) {
  if (control) control.disabled = true;
  try { return await action(); } catch (error) { failure(error); }
  finally { if (control) control.disabled = false; }
}
function on(id, event, action) {
  $(id).addEventListener(event, e => {
    if (event === 'submit') e.preventDefault();
    const control = event === 'submit' ? e.currentTarget.querySelector('button[type=submit]') : e.currentTarget.tagName === 'BUTTON' ? e.currentTarget : null;
    guarded(() => action(e), control);
  });
}
function value(id) { return $(id).value.trim(); }
function number(id) {
  const input = value(id), parsed = Number(input);
  if (!input || !Number.isSafeInteger(parsed)) throw new Error('Enter a whole number for ' + $(id).closest('label').firstChild.textContent.trim() + '.');
  return parsed;
}
function set(id, text) { $(id).value = text ?? ''; }
function json(value) { return JSON.stringify(value, null, 2); }
function date(value) { return value ? value.replace('T', ' ').replace('Z', ' UTC') : '—'; }
function short(value) { return typeof value === 'string' && value.length > 18 ? value.slice(0, 12) + '…' : value ?? '—'; }
function identifier(prefix) { return (prefix || 'worldbank').slice(0, 55) + '-' + new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14); }
function codes(text) { return text.split(/[\s,;]+/).filter(Boolean); }
function record(kind, id) { return (model.state[kind] || []).find(item => item.id === id); }
function tag(text) { return element('span', { class:'tag' + (text === 'COMPLETE' || text === 'RUNNING' ? ' complete' : '') }, text); }
function cells(primary, secondary) { return element('div', {}, primary, secondary ? element('small', {}, secondary) : null); }

async function request(path, init = {}) {
  let response;
  try { response = await fetch(path, { ...init, headers:{ Authorization:'Bearer ' + token, ...(init.headers || {}) } }); }
  catch { throw Object.assign(new Error('The local workspace is unavailable. Reopen its printed session URL.'), { code:'WORKSPACE_CONNECTION' }); }
  let body;
  try { body = await response.json(); } catch { throw new Error('The workspace returned an unreadable response.'); }
  if (!response.ok || body?.error) {
    const detail = body?.error || { code:'HTTP_' + response.status, message:'The workspace could not complete this action.' };
    throw Object.assign(new Error(detail.message), detail);
  }
  return body;
}
async function act(action, payload = {}) {
  const startedAt = new Date().toISOString();
  $('connection').textContent = 'Working…';
  try {
    const response = await request('/api/action', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ action, payload }) });
    if (response.state) renderState(response.state);
    if (response.stateError) showNotice('Action completed. State refresh: ' + response.stateError.message);
    log(action, 'Complete', startedAt, response.result);
    return response.result;
  } catch (error) { log(action, 'Failed', startedAt, { error:{ code:error.code, message:error.message, ...error } }); throw error; }
  finally { $('connection').textContent = 'Local workspace'; }
}
async function refresh() {
  if (model.refreshing) return;
  model.refreshing = true;
  try { renderState(await request('/api/state')); $('connection').textContent = 'Local workspace'; }
  finally { model.refreshing = false; }
}
function log(action, status, time, result) {
  model.activity.unshift({ action, status, time });
  model.activity.length = Math.min(model.activity.length, 50);
  $('action-result').textContent = json(result);
  renderActivity();
}
function renderActivity() {
  table('activity-list', ['Time','Action','Result'], model.activity.map(item => [
    date(item.time), item.action, item.status
  ]), 'No actions in this browser session.');
}
function table(target, headings, rows, empty = 'No records yet.') {
  if (!rows.length) { clear(target, element('div', { class:'empty' }, empty)); return; }
  clear(target, element('table', {},
    element('thead', {}, element('tr', {}, headings.map(text => element('th', { scope:'col' }, text)))),
    element('tbody', {}, rows.map(row => element('tr', {}, row.map(cell => cell instanceof HTMLTableCellElement ? cell : element('td', {}, cell)))))));
}
function pager(target, result, load) {
  const { total, offset, limit } = result;
  clear(target,
    element('span', {}, total ? (offset + 1) + '–' + Math.min(offset + limit, total) + ' of ' + total : '0 rows'),
    button('Previous', () => load(Math.max(0, offset - limit)), { disabled:offset === 0 }),
    button('Next', () => load(offset + limit), { disabled:offset + limit >= total }));
}
function options(id, items, placeholder, selected) {
  const prior = selected ?? $(id).value;
  const entries = items.map(item => typeof item === 'string' ? [item,item] : item);
  $(id).replaceChildren(...(placeholder === undefined ? [] : [element('option', { value:'' }, placeholder)]),
    ...entries.map(([key, label]) => element('option', { value:key }, label)));
  if (entries.some(([key]) => key === prior) || prior === '' && placeholder !== undefined) $(id).value = prior;
}
function stats(target, values) {
  clear(target, values.map(([label, count, hint]) => element('div', { class:'stat', title:hint ?? String(count) },
    element('span', {}, label), element('strong', {}, count))));
}
function renderState(state) {
  model.state = state;
  const { selections = [], captures = [], reviews = [], exports: exported = [] } = state;
  stats('stats', [['Selections', selections.length], ['Complete captures', captures.filter(item => item.status === 'COMPLETE').length],
    ['Saved reviews', reviews.length], ['Prepared exports', exported.length]]);
  $('workspace-directory').textContent = state.directory || 'Local workspace';
  const selected = selections.map(item => [item.id, item.title + ' · r' + item.revision]);
  options('capture-selection', selected);
  options('pages-selection', selected);
  const complete = captures.filter(item => item.status === 'COMPLETE').map(item => [item.id, item.id + ' · ' + item.summary.observations + ' rows']);
  options('review-capture', complete, 'Choose a complete capture');
  options('review-baseline', complete, 'No comparison');
  const reviewed = reviews.map(item => [item.id, item.title + ' · r' + item.revision]);
  options('review-existing', reviewed, 'Open a saved review');
  options('export-review', reviewed);
  options('merchant-export', exported.map(item => [item.id, item.title + ' · ' + item.observations + ' rows']));
  renderSelections(); renderCaptures(); renderExports(); renderPublisher();
}
function switchTab(name) {
  model.tab = name;
  for (const key of Object.keys(titles)) $('tab-' + key).hidden = key !== name;
  document.querySelectorAll('[data-tab]').forEach(node => {
    if (node.dataset.tab === name) node.setAttribute('aria-current','page'); else node.removeAttribute('aria-current');
  });
  $('page-title').textContent = titles[name];
  if (name === 'review' && value('review-capture') && model.reviewCapture !== value('review-capture'))
    guarded(() => openReviewCapture(value('review-capture')));
  window.scrollTo({ top:0, behavior:'instant' });
}
document.querySelectorAll('[data-tab]').forEach(node => node.addEventListener('click', () => switchTab(node.dataset.tab)));
on('refresh', 'click', refresh);

function renderSelections() {
  table('selection-list', ['Selection','Source and population','Period','Revision',''], model.state.selections.map(item => [
    cells(item.title, item.id), cells('Source ' + item.spec.sourceId, item.spec.countries.join(', ') + ' · ' + item.spec.indicators.join(', ')),
    item.spec.date, item.revision, element('div', { class:'actions' },
      button('Edit', () => editSelection(item)), button('Capture', () => {
        set('capture-selection', item.id); set('capture-id', identifier(item.id)); switchTab('captures');
      }))
  ]));
}
function editSelection(item) {
  set('selection-id', item.id); $('selection-id').readOnly = true; set('selection-title', item.title);
  set('selection-source', item.spec.sourceId); set('selection-date', item.spec.date);
  set('selection-countries', item.spec.countries.join(', ')); set('selection-indicators', item.spec.indicators.join('\n'));
  set('selection-per-page', item.spec.perPage); set('selection-revision', item.revision); switchTab('selections');
}
on('new-selection', 'click', () => {
  $('selection-form').reset(); $('selection-id').readOnly = false; set('selection-id', identifier('worldbank')); set('selection-revision', 0);
});
on('selection-form', 'submit', async () => {
  const saved = await act('save-selection', { id:value('selection-id'), title:value('selection-title'), expectedRevision:number('selection-revision'),
    spec:{ sourceId:value('selection-source'), countries:codes(value('selection-countries')),
      indicators:codes(value('selection-indicators')), date:value('selection-date'), perPage:number('selection-per-page') } });
  editSelection(saved); set('capture-selection', saved.id); set('capture-id', identifier(saved.id));
  showNotice('Saved selection ' + saved.id + ' at revision ' + saved.revision + '.');
});
async function catalogue(offset = 0, refreshSource = false) {
  const kind = value('catalog-kind');
  const result = await act('catalog', { kind, sourceId:value('selection-source'), search:value('catalog-search'),
    offset, limit:50, refresh:refreshSource });
  $('catalog-summary').textContent = result.total + ' matching records from ' + result.sourceTotal + ' original records · captured ' + date(result.capturedAt);
  table('catalog-results', ['Code','Name','Source / region',''], result.rows.map(item => [
    item.id, item.name || item.value || item.id, item.source?.value || item.region?.value || item.lastupdated || '',
    button('Use', () => {
      if (kind === 'sources') set('selection-source', item.id);
      else {
        const target = kind === 'countries' ? 'selection-countries' : 'selection-indicators';
        const previous = codes(value(target)).filter(code => code.toLowerCase() !== 'all');
        set(target, [...new Set([...previous, item.id])].join(kind === 'countries' ? ', ' : '\n'));
      }
      showNotice('Added ' + item.id + ' to the selection form.');
    })
  ]), 'No catalogue records match this search.');
  pager('catalog-pager', result, next => catalogue(next));
}
on('catalog-form', 'submit', () => catalogue());
on('catalog-refresh', 'click', () => catalogue(0, true));

function renderCaptures() {
  table('capture-list', ['Capture','Status','Progress','Observations',''], model.state.captures.map(item => {
    const progress = Object.values(item.collections || {});
    const job = (model.state.jobs || []).find(job => job.id === item.id && ['RUNNING','CANCELLING'].includes(job.status));
    const controls = [button('Open', () => openCapture(item.id))];
    if (job) controls.push(button('Cancel', async () => {
      await act('capture-cancel', { id:item.id }); showNotice('Stopping capture ' + item.id + '; retained pages can be resumed.');
    }, { disabled:job.status === 'CANCELLING' }));
    else if (item.status !== 'COMPLETE' && item.acquisition === 'ORIGINAL_HTTP')
      controls.push(button('Resume', async () => { await act('capture', { id:item.id, selectionId:item.selectionId }); }));
    return [cells(item.id, item.selectionTitle + ' · selection r' + item.selectionRevision),
      cells(tag(job?.status || item.status), item.error?.message),
      progress.length ? progress.reduce((n, part) => n + (part.pages || 0), 0) + ' required pages · ' + progress.filter(part => part.complete).length + '/' + progress.length + ' collections complete' : 'Prepared',
      item.summary?.observations ?? item.collections?.data?.rows ?? 0, element('div', { class:'actions' }, controls)];
  }));
}
on('capture-form', 'submit', async () => {
  const result = await act('capture', { id:value('capture-id'), selectionId:value('capture-selection') });
  showNotice('Capture ' + result.id + ' is ' + result.status.toLowerCase() + '.');
});
on('capture-selection', 'change', () => set('capture-id', identifier(value('capture-selection'))));
async function openCapture(id) {
  const detail = await act('capture-detail', { id });
  model.currentCapture = id;
  $('observation-heading').textContent = 'Observations · ' + id;
  $('capture-detail').textContent = json(detail);
  $('capture-to-review').disabled = detail.status !== 'COMPLETE';
  set('observation-search', '');
  await observations();
  switchTab('captures');
}
function observationCells(row) {
  return [
    cells(row.country_iso3 || row.country_id, row.country_name + (row.aggregate ? ' · aggregate' : '')),
    cells(row.indicator_id, row.indicator_name), row.period,
    element('td', { class:'exact' + (row.value === null ? ' value-missing' : ''), title:row.value === null ? 'Original source null' : 'Original JSON number token' },
      row.value === null ? 'Missing' : row.value),
    row.unit || '—', row.obs_status || '—',
    cells(row.footnote || '—', 'Source ' + row.source_id + ' · page ' + row.source_page + ', row ' + row.source_row)
  ];
}
async function observations(offset = 0) {
  if (!model.currentCapture) return;
  const result = await act('observations', { captureId:model.currentCapture, search:value('observation-search'), offset, limit:100 });
  model.observations = result;
  $('observation-summary').textContent = result.total + ' matching observations · ' + result.status + ' · exact values and source nulls retained';
  table('observation-table', ['Country','Indicator','Period','Value','Unit','Status','Footnote / source'], result.rows.map(observationCells));
  pager('observation-pager', result, observations);
}
on('observation-form', 'submit', () => observations());
on('capture-to-review', 'click', async () => {
  set('review-capture', model.currentCapture); await openReviewCapture(model.currentCapture); switchTab('review');
});
async function selectedFile(id, maximum = 180 * 1024 * 1024) {
  const file = $(id).files[0];
  if (!file) throw new Error('Choose the original file.');
  if (file.size > maximum) throw new Error('This file exceeds the supported 180 MiB browser import. Use the native CLI for the configured input capacity.');
  return file;
}
async function base64File(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result.slice(reader.result.indexOf(',') + 1));
    reader.onerror = () => reject(new Error('The selected file could not be read.')); reader.readAsDataURL(file);
  });
}
on('pages-form', 'submit', async () => {
  const incoming = JSON.parse(await (await selectedFile('pages-file')).text());
  const result = await act('import-pages', { id:value('pages-id'), selectionId:value('pages-selection'), pages:Array.isArray(incoming) ? incoming : incoming.pages });
  showNotice('Received original capture ' + result.id + ' · ' + result.status + '.'); await openCapture(result.id);
});

for (const column of COLUMNS) $('review-columns').append(element('label', {},
  element('input', { type:'checkbox', value:column, checked:true, disabled:MANDATORY.has(column), onchange:() => { model.reviewDirty = true; } }),
  column.replaceAll('_', ' ')));
function reviewCount() {
  const capture = record('captures', model.reviewCapture);
  $('review-count').textContent = model.excluded.size + ' identities excluded · ' + Object.keys(model.choices).length + ' explicit row choices' +
    (capture?.summary.duplicateKeys ? ' · ' + capture.summary.duplicateKeys + ' repeated identities in source' : '');
}
async function openReviewCapture(id, preserve = false) {
  if (!id) { model.reviewCapture = null; return; }
  const capture = record('captures', id);
  if (!capture) throw new Error('Refresh the retained capture list.');
  if (!preserve) {
    model.excluded = new Set(); model.choices = {}; model.reviewDirty = false;
    set('review-id', identifier(id + '-review')); set('review-title', capture.selectionTitle);
    set('review-revision', 0); set('review-note', ''); set('review-search', '');
    document.querySelectorAll('#review-columns input').forEach(node => { node.checked = true; });
    clear('duplicate-choices'); $('comparison-panel').hidden = true;
  }
  model.reviewCapture = id; set('review-capture', id); reviewCount(); await reviewObservations();
}
on('review-capture', 'change', async () => {
  if (model.reviewDirty && !window.confirm('Open another capture and discard the unsaved review changes?')) {
    set('review-capture', model.reviewCapture); return;
  }
  await openReviewCapture(value('review-capture'));
});
on('review-form', 'input', () => { model.reviewDirty = true; });
function keepControl(row) {
  return element('input', { type:'checkbox', checked:!model.excluded.has(row.key), 'data-observation-key':row.key,
    'aria-label':'Keep ' + row.country_name + ' ' + row.indicator_id + ' ' + row.period,
    onchange:event => {
      if (event.target.checked) model.excluded.delete(row.key); else model.excluded.add(row.key);
      document.querySelectorAll('[data-observation-key="' + row.key + '"]').forEach(node => { node.checked = !model.excluded.has(row.key); });
      model.reviewDirty = true; reviewCount();
    }
  });
}
async function reviewObservations(offset = 0) {
  if (!model.reviewCapture) return;
  const result = await act('observations', { captureId:model.reviewCapture, search:value('review-search'), offset, limit:100 });
  model.reviewRows = result;
  $('review-observation-summary').textContent = result.total + ' matching original rows. Choices apply across every page of this capture.';
  table('review-table', ['Keep','Country','Indicator','Period','Value','Unit','Status','Footnote / source'],
    result.rows.map(row => [keepControl(row), ...observationCells(row)]));
  pager('review-pager', result, reviewObservations);
}
on('review-search-form', 'submit', () => reviewObservations());
async function showConflicts(conflicts) {
  clear('duplicate-choices', element('p', { class:'help' }, 'Select one original row or exclude each repeated identity below, then save again.'));
  for (const conflict of conflicts) {
    const result = await act('observations', { captureId:model.reviewCapture, search:conflict.key, offset:0, limit:1000 });
    const first = result.rows[0];
    const selector = element('select', { 'aria-label':'Original row choice', onchange:event => {
      const selected = event.target.value;
      if (selected === 'exclude') { model.excluded.add(conflict.key); delete model.choices[conflict.key]; }
      else if (selected) { model.excluded.delete(conflict.key); model.choices[conflict.key] = selected; }
      else { delete model.choices[conflict.key]; model.excluded.delete(conflict.key); }
      model.reviewDirty = true; reviewCount();
    } },
    element('option', { value:'' }, 'Choose an original row'),
    element('option', { value:'exclude', selected:model.excluded.has(conflict.key) }, 'Exclude this observation identity'),
    ...conflict.rows.map(rowId => {
      const row = result.rows.find(item => item.rowId === rowId);
      return element('option', { value:rowId, selected:model.choices[conflict.key] === rowId },
        row ? 'Page ' + row.source_page + ', row ' + row.source_row + ' · ' + (row.value ?? 'Missing') + (row.obs_status ? ' · ' + row.obs_status : '') : 'Original source row ' + rowId);
    }));
    $('duplicate-choices').append(element('div', { class:'conflict' },
      element('p', {}, first ? first.country_name + ' · ' + first.indicator_id + ' · ' + first.period : conflict.key), selector));
  }
}
on('review-form', 'submit', async () => {
  if (!model.reviewCapture || model.reviewCapture !== value('review-capture')) throw new Error('Open the complete capture before saving its review.');
  const saved = await act('review', { id:value('review-id'), captureId:model.reviewCapture,
    baselineId:value('review-baseline') || null, title:value('review-title'), note:value('review-note'),
    expectedRevision:number('review-revision'), excludedKeys:[...model.excluded], choices:model.choices,
    columns:[...document.querySelectorAll('#review-columns input:checked')].map(node => node.value) });
  set('review-revision', saved.revision); set('review-existing', saved.id); set('export-review', saved.id);
  set('export-id', identifier(saved.id + '-export')); model.reviewDirty = false; clear('duplicate-choices');
  showNotice('Saved edition ' + saved.id + ' · revision ' + saved.revision + ' · ' + saved.includedObservations + ' included observations.');
});
on('open-review', 'click', async () => {
  const id = value('review-existing'); if (!id) throw new Error('Choose a saved review.');
  if (model.reviewDirty && !window.confirm('Open the saved review and discard unsaved changes?')) return;
  const saved = await act('review-read', { id });
  model.excluded = new Set(saved.excludedKeys); model.choices = { ...saved.choices };
  set('review-id', saved.id); set('review-title', saved.title); set('review-note', saved.note);
  set('review-revision', saved.revision); set('review-baseline', saved.baselineId || '');
  document.querySelectorAll('#review-columns input').forEach(node => { node.checked = saved.columns.includes(node.value); });
  clear('duplicate-choices'); await openReviewCapture(saved.captureId, true); model.reviewDirty = false;
  showNotice('Opened ' + saved.id + ' revision ' + saved.revision + '.');
});
async function compare(offset = 0) {
  if (!model.reviewCapture || !value('review-baseline')) throw new Error('Choose the complete capture and its baseline.');
  const result = await act('compare', { captureId:model.reviewCapture, baselineId:value('review-baseline'), offset, limit:100 });
  model.comparison = result; $('comparison-panel').hidden = false;
  const count = result.counts;
  $('comparison-summary').textContent = count.added + ' added · ' + count.absent + ' absent · ' + count.changed + ' changed · ' + count.unchanged + ' unchanged.' +
    (result.sameSelection ? ' Both editions use the same source population.' : ' Selections differ; counts reflect both population choices and source revisions.');
  const values = rows => rows.length ? rows.map(row => row.value === null ? 'Missing' : row.value).join(' | ') : 'Absent';
  table('comparison-table', ['Change','Observation','Before','After'], result.rows.map(item => {
    const row = item.after[0] || item.before[0];
    return [tag(item.status), cells(row.country_name + ' · ' + row.period, row.indicator_id),
      element('td', { class:'exact' }, values(item.before)), element('td', { class:'exact' }, values(item.after))];
  }), 'No changed observation identities in these editions.');
  pager('comparison-pager', result, compare);
}
on('compare', 'click', () => compare());

function renderExports() {
  table('export-list', ['Export','Review','Observations','Created',''], model.state.exports.map(item => [
    cells(item.title, item.id), item.reviewId + ' · r' + item.reviewRevision, item.observations, date(item.createdAt),
    element('div', { class:'actions' }, button('Open', () => openExport(item.id)),
      button('Handover ZIP', () => downloadExport(item.id, 'handover.zip')),
      button('CSV', () => downloadExport(item.id, 'dataset.csv')))
  ]));
}
on('export-review', 'change', () => set('export-id', identifier(value('export-review') + '-export')));
on('export-form', 'submit', async () => {
  const review = record('reviews', value('export-review')); if (!review) throw new Error('Choose a saved edition review.');
  const result = await act('export', { id:value('export-id'), reviewId:review.id, expectedRevision:review.revision });
  showNotice('Prepared ' + result.observations + ' observations in ' + result.id + '.'); await openExport(result.id);
});
async function openExport(id) {
  const result = await act('export-read', { id }); model.export = result;
  $('export-detail-panel').hidden = false; $('export-detail-title').textContent = 'Export · ' + id;
  $('export-detail-summary').textContent = result.observations + ' observations · review ' + result.reviewId + ' r' + result.reviewRevision + ' · ' + result.manifest.files.length + ' retained files';
  table('export-files', ['File','Bytes','SHA-256',''], result.manifest.files.map(item => [
    item.path, item.bytes, element('span', { title:item.sha256 }, short(item.sha256)),
    button('Download', () => downloadExport(id, item.path))
  ])); switchTab('exports');
}
async function download(path, filename) {
  const response = await fetch(path, { headers:{ Authorization:'Bearer ' + token } });
  if (!response.ok) {
    const detail = (await response.json()).error; throw Object.assign(new Error(detail?.message || 'Download failed.'), detail);
  }
  const blob = await response.blob(), url = URL.createObjectURL(blob);
  const link = element('a', { href:url, download:filename }); document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadExport(id, path) { return download('/api/exports/' + encodeURIComponent(id) + '/' + encodeURIComponent(path), path.split('/').at(-1)); }
function downloadPublisher(kind, id, filename) { return download('/api/publisher/exports/' + encodeURIComponent(kind) + '/' + encodeURIComponent(id), filename); }
on('export-to-merchant', 'click', () => { set('merchant-export', model.export.id); switchTab('merchant'); });
on('package-form', 'submit', async () => {
  const file = await selectedFile('package-file');
  const result = await act('import-package', { id:value('package-id'), archiveBase64:await base64File(file) });
  showNotice('Opened original handover as ' + result.capture.id + ' and review ' + result.review.id + '.');
  set('review-existing', result.review.id); set('export-review', result.review.id); await openCapture(result.capture.id);
});

function publisher() {
  if (!model.state.publisher) throw new Error('Prepare a merchant or read publisher status first.');
  return model.state.publisher;
}
function generation() {
  const result = publisher().releases?.state?.generation;
  if (!Number.isSafeInteger(result)) throw new Error('Refresh the original release generation.');
  return result;
}
function publication() {
  const versions = publisher().target?.versions;
  if (!versions) throw new Error('Prepare the original dataset publisher.');
  return { expectedSnapshot:versions.current, expectedRevision:versions.revision };
}
function renderPublisher() {
  const p = model.state.publisher;
  if (!p) { stats('publisher-summary', [['Publisher','Not opened'],['Dataset','—'],['Release','—'],['Seller','—']]); return; }
  const versions = p.target?.versions, releases = p.releases, candidates = p.drafts?.candidates || [], buyers = p.drafts?.buyers || [];
  stats('publisher-summary', [['Snapshot', short(versions?.current), versions?.current],['Revision', versions?.revision ?? '—'],
    ['Active release', releases?.state?.active || '—'],['Seller', releases?.runtime?.state || 'STOPPED']]);
  options('publisher-draft', candidates.map(item => [item.id, (item.filename || item.id) + ' · ' + short(item.dataset?.snapshot)]));
  const targets = candidates.map(item => ['draft:' + item.id, 'Draft · ' + (item.filename || short(item.id))]);
  for (const item of versions?.versions || []) targets.push([item.snapshot, 'Snapshot · ' + short(item.snapshot)]);
  options('preview-target', targets);
  options('buyer-id', buyers.map(item => [item.id, (item.intentId || item.id) + ' · ' + short(item.snapshot)]));
  options('buyer-session', (p.sessions || []).map(item => [item.id, item.id + ' · ' + (item.report?.status || item.error?.code || 'Retained')]));
  $('release-generation').textContent = 'Release generation ' + (releases?.state?.generation ?? '—') +
    (releases?.runtime?.observed?.listener ? ' · listener ' + releases.runtime.observed.listener : '') +
    (p.ownsRelease ? ' · this workspace owns the seller' : '');
  $('publisher-state').textContent = json(p);
}
on('merchant-form', 'submit', async () => {
  const result = await act('merchant-prepare', { exportId:value('merchant-export'), origin:value('merchant-origin'), path:value('merchant-path'),
    payment:{ scheme:'exact', network:value('merchant-network'), asset:value('merchant-asset'), amount:value('merchant-amount'),
      payTo:value('merchant-pay-to'), maxTimeoutSeconds:number('merchant-timeout') } });
  set('publisher-draft', result.draft.id); set('preview-target', 'draft:' + result.draft.id);
  set('release-id', ('worldbank-' + value('merchant-export')).toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 64));
  showNotice('Prepared native merchant draft ' + result.draft.id + '.');
});
on('publisher-refresh', 'click', () => act('publisher.status'));
on('release-stage', 'click', async () => {
  const runtime = { port:number('release-port') };
  if (value('release-facilitator')) runtime.facilitator = value('release-facilitator');
  if ($('release-local-facilitator').checked) runtime.allowLocalFacilitator = true;
  const result = await act('publisher.release.stage', { draftId:value('publisher-draft'), id:value('release-id'), runtime });
  showNotice('Staged native release ' + (result.id || value('release-id')) + '.');
});
on('release-inspect', 'click', async () => {
  const result = await act('publisher.release.inspect', { id:value('release-id') });
  $('publisher-state').textContent = json(result);
});
on('release-activate', 'click', async () => { await act('publisher.release.activate', { id:value('release-id'), expectedGeneration:generation() }); showNotice('Selected release ' + value('release-id') + '.'); });
on('release-start', 'click', async () => { const result = await act('publisher.release.start', { expectedGeneration:generation() }); showNotice('Seller ' + result.state.toLowerCase() + '.'); });
on('release-stop', 'click', async () => { const result = await act('publisher.release.stop'); showNotice(result.state === 'STOPPED' ? 'Seller stopped.' : 'This workspace has no owned seller process.'); });
on('release-rollback', 'click', () => act('publisher.release.rollback', { expectedGeneration:generation() }));
on('draft-review', 'click', () => act('publisher.reviewDraft', { draftId:value('publisher-draft'), ...publication() }));
on('draft-publish', 'click', () => act('publisher.publish', { draftId:value('publisher-draft'), ...publication() }));
on('preview-form', 'submit', async () => {
  const result = await act('publisher.preview', { target:value('preview-target'), query:value('preview-query') });
  $('query-result').textContent = json(result);
  if (result.status >= 400) throw Object.assign(new Error(result.body?.message || 'The dataset could not execute this query.'), { code:result.body?.error || 'DATASET_QUERY' });
  showNotice((result.body?.rows?.length ?? 0) + ' rows returned from the original dataset.');
});
on('buyer-review', 'click', async () => {
  const target = value('preview-target');
  if (target.startsWith('draft:') || !target) throw new Error('Select a published snapshot and start its seller before reading the customer offer.');
  const result = await act('publisher.buyer.review', { snapshot:target, query:value('preview-query') });
  model.buyerReview = result; $('query-result').textContent = json(result); $('buyer-prepare').disabled = false;
  set('buyer-intent', crypto.randomUUID()); showNotice('Loaded the current seller offer and query preview.');
});
on('preview-query', 'input', () => { model.buyerReview = null; $('buyer-prepare').disabled = true; });
on('preview-target', 'change', () => { model.buyerReview = null; $('buyer-prepare').disabled = true; });
on('buyer-prepare', 'click', async () => {
  if (!model.buyerReview) throw new Error('Read the seller offer for this exact query first.');
  const result = await act('publisher.buyer.prepare', { review:model.buyerReview, intentId:value('buyer-intent'),
    acceptIndex:number('buyer-accept'), offerSha256:model.buyerReview.offerSha256 });
  model.buyer = result.buyer; const buyerId = result.buyer.id || result.buyer.record?.id;
  set('buyer-id', buyerId); $('buyer-download').disabled = false; $('buyer-result').textContent = json(result);
  showNotice('Prepared customer request ' + buyerId + '.');
});
on('buyer-download', 'click', () => {
  const id = model.buyer?.id || model.buyer?.record?.id;
  if (!id) throw new Error('Prepare a customer request first.');
  return downloadPublisher('buyer-config', id, 'buyer-request.json');
});
on('buyer-session-form', 'submit', async () => {
  const result = await act('publisher.buyer.session', { buyerId:value('buyer-id'), workspaceDirectory:value('buyer-workspace'),
    maxPages:number('buyer-max-pages'), maxTotalAtomic:value('buyer-max-total'), maxRows:number('buyer-max-rows'), maxPageBytes:900 * 1024 });
  set('buyer-session', result.id); $('buyer-result').textContent = json(result);
});
for (const action of ['run','recover','account','export']) on('buyer-' + action, 'click', async () => {
  const id = value('buyer-session'); if (!id) throw new Error('Choose the retained buyer session.');
  const result = await act('publisher.buyer.' + action, { id }); $('buyer-result').textContent = json(result);
  if (action === 'export') clear('buyer-delivery',
    button('Delivered CSV', () => downloadPublisher('session-csv', id, 'dataset.csv')),
    button('Delivered JSONL', () => downloadPublisher('session-jsonl', id, 'dataset.jsonl')),
    button('Customer review', () => downloadPublisher('session-review', id, 'review.html')),
    button('Acquisition manifest', () => downloadPublisher('session-manifest', id, 'acquisition-manifest.json')));
});
on('clear-activity', 'click', () => { model.activity = []; renderActivity(); $('action-result').textContent = 'No actions yet.'; });

set('capture-id', identifier('worldbank')); set('pages-id', identifier('received'));
set('package-id', identifier('handover')); set('export-id', identifier('worldbank-export'));
set('buyer-intent', crypto.randomUUID());
guarded(async () => {
  if (!token) throw Object.assign(new Error('Open the private session URL printed by the workspace command.'), { code:'WORKSPACE_SESSION' });
  await refresh();
});
setInterval(() => {
  const active = (model.state.jobs || []).some(job => ['RUNNING','CANCELLING'].includes(job.status));
  if (!document.hidden && active && !model.refreshing) guarded(refresh);
}, 3000);
