const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const show = value => value == null ? '—' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
const title = value => String(value || '').replaceAll('_', ' ').replace(/\b[a-z]/g, c => c.toUpperCase());
const date = value => value ? new Date(value).toLocaleString() : '—';
const option = (value, label, selected) => '<option value="' + h(value) + '"' + (String(value) === String(selected) ? ' selected' : '') + '>' + h(label) + '</option>';
const badge = (value, strong = false) => '<span class="pill' + (strong ? ' strong' : '') + '">' + h(title(value)) + '</span>';
const empty = message => '<div class="empty">' + h(message) + '</div>';
const token = $('meta[name="workspace-token"]').content;
const main = $('#main');
const drafts = new Map();
let state, view = 'inputs', busy = false, epoch = 0, model = {}, setupDraft = null;
let selectedDataset = '', selectedRun = '', selectedFinding = '', selectedCase = '';
let previewOffset = 0, normalizedPreview = true, reviewMode = 'findings', reviewOffset = 0, caseOffset = 0;
let findingFilters = {query:'', code:'', status:''}, caseFilters = {query:'', type:''};
const runCache = new Map();
const fieldLabels = {
  id:'Case identifier', type:'Record type', department:'Owning department', status:'Case status',
  relatedIds:'Related case identifiers', reviewStates:'Department review states',
  reviewAssignments:'Assigned reviewers by department', reviewDueAt:'Review due dates by department',
  attachments:'Attachment count', paymentMinor:'Case payment amount', links:'Related case identifiers', reviews:'Department review states'
};
const canonicalFields = ['id','type','department','status','relatedIds','reviewStates','reviewAssignments','reviewDueAt','attachments','paymentMinor'];
try { $('#reviewer').value = localStorage.getItem('permitting-reviewer') || ''; } catch {}
const reviewer = () => $('#reviewer').value.trim();

function notice(message, kind = 'success') {
  const node = $('#notice');
  node.textContent = message; node.dataset.kind = kind; node.hidden = !message;
}
function setBusy(value) {
  busy = value; main.setAttribute('aria-busy', String(value));
  $$('[data-write]').forEach(node => { node.disabled = value; });
  $('#refresh').disabled = value;
}
async function api(path, payload) {
  const response = await fetch(path, payload === undefined ? {cache:'no-store'} : {
    method:'POST', headers:{'Content-Type':'application/json','X-Workspace-Token':token},
    body:JSON.stringify({...payload, revision:state.revision})
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.message || result.error || 'Workspace request failed.');
    error.status = response.status; throw error;
  }
  return result;
}
function formValues(form) {
  return Object.fromEntries($$('input[name],select[name],textarea[name]', form)
    .filter(node => node.type !== 'file')
    .map(node => [node.name, node.type === 'checkbox' ? node.checked : node.value]));
}
function captureDrafts() {
  $$('form[data-draft]', main).forEach(form => drafts.set(form.dataset.draft, formValues(form)));
  if ($('#setup-form')) setupDraft = readSetup($('#setup-form'));
}
function restoreDrafts() {
  $$('form[data-draft]', main).forEach(form => {
    const values = drafts.get(form.dataset.draft);
    if (!values) return;
    $$('[name]', form).forEach(node => {
      if (node.type === 'file' || !(node.name in values)) return;
      if (node.type === 'checkbox') node.checked = values[node.name]; else node.value = values[node.name];
    });
  });
}
function updateHeader() {
  $('#revision').textContent = 'Revision ' + state.revision;
  $('#cohort-label').textContent = state.settings.cohort || 'Name the cohort and define its export scope in Project setup';
  $$('nav [data-view]').forEach(button => {
    if (button.dataset.view === view) button.setAttribute('aria-current','page');
    else button.removeAttribute('aria-current');
  });
}
async function refreshState() {
  state = await api('/api/state');
  if (!state.datasets.some(row => row.id === selectedDataset)) selectedDataset = state.datasets.find(row => row.current && row.side === 'source')?.id || state.datasets[0]?.id || '';
  if (!state.runs.some(row => row.id === selectedRun)) selectedRun = state.runs[0]?.id || '';
  updateHeader();
}
async function mutate(path, payload, options = {}) {
  if (busy) return;
  captureDrafts(); setBusy(true); notice('');
  try {
    const result = await api(path, payload);
    (options.clear || []).forEach(key => drafts.delete(key));
    if (options.clearSetup) setupDraft = null;
    if (options.after) options.after(result);
    await refreshState();
    await render(false);
    notice(options.message || 'Saved to the retained workspace.');
    return result;
  } catch (error) {
    if (error.status === 409) {
      await refreshState();
      await render(false);
      notice('Another change was saved. Your draft is retained. Review the refreshed workspace and save again. ' + error.message, 'error');
    } else notice(error.message, 'error');
  } finally { setBusy(false); }
}
async function runDetail() {
  const key = selectedRun + ':' + state.revision;
  if (!runCache.has(key)) {
    const result = await api('/api/runs/' + encodeURIComponent(selectedRun) + '?summary=1');
    runCache.clear(); runCache.set(key, result);
  }
  return runCache.get(key);
}
function pager(kind, data) {
  const from = data.total ? data.offset + 1 : 0, to = Math.min(data.total, data.offset + data.limit);
  return '<div class="pager"><span>' + from.toLocaleString() + '–' + to.toLocaleString() + ' of ' + data.total.toLocaleString() + '</span>' +
    '<button type="button" data-page="' + kind + '" data-offset="' + Math.max(0,data.offset-data.limit) + '"' + (data.offset === 0 ? ' disabled' : '') + '>Previous</button>' +
    '<button type="button" data-page="' + kind + '" data-offset="' + (data.offset+data.limit) + '"' + (to >= data.total ? ' disabled' : '') + '>Next</button></div>';
}
function fileLink(id, label) {
  return '<a href="/api/datasets/' + encodeURIComponent(id) + '/download" download>' + h(label || 'Download original export') + '</a>';
}
function rawDetails(label, value) {
  return '<details><summary>' + h(label) + '</summary><pre>' + h(show(value)) + '</pre></details>';
}
function compare(source, target) {
  const keys = [...new Set([...canonicalFields.filter(key => key in (source || {}) || key in (target || {})), ...Object.keys(source || {}), ...Object.keys(target || {})])];
  return '<div class="table-wrap"><table class="comparison"><thead><tr><th>Field</th><th>Source</th><th>Target</th></tr></thead><tbody>' +
    keys.map(key => '<tr' + (JSON.stringify(source?.[key]) !== JSON.stringify(target?.[key]) ? ' class="changed"' : '') + '><th>' + h(fieldLabels[key] || key) + '</th><td>' + h(show(source?.[key])) + '</td><td>' + h(show(target?.[key])) + '</td></tr>').join('') +
    '</tbody></table></div>';
}
function contextBlock(label, context) {
  if (!context) return '<div><h3>' + h(label) + '</h3><p class="muted">No corresponding export row.</p></div>';
  const dataset = state.datasets.find(item => item.id === context.dataset_id);
  return '<div><h3>' + h(label) + '</h3><p class="small">' + h(dataset?.filename || context.dataset_id) + ' · original row ' + h(context.line) + '</p>' +
    fileLink(context.dataset_id) + rawDetails('Original values', context.values) + '</div>';
}
function pairs(value) { return Object.entries(value || {}).map(([key,item]) => key + ' = ' + item).join('\n'); }
function parsePairs(value, label) {
  const result = Object.create(null);
  for (const line of String(value || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const equal = line.indexOf('=');
    if (equal < 1 || !line.slice(equal+1).trim()) throw new Error(label + ': use one original = mapped pair per line.');
    const key = line.slice(0,equal).trim();
    if (Object.hasOwn(result,key)) throw new Error(label + ': repeated entry ' + key + '.');
    result[key] = line.slice(equal+1).trim();
  }
  return result;
}
async function base64File(input) {
  const file = input.files[0];
  if (!file) throw new Error('Choose an original export file.');
  if (file.size > 25*1024*1024) throw new Error('Each export must be at most 25 MiB.');
  const value = await new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.readAsDataURL(file);
  });
  return {filename:file.name, base64:value};
}
function uploadForm(side) {
  return '<form class="panel" id="upload-' + side + '" data-kind="upload" data-side="' + side + '" data-draft="upload-' + side + '"><h3>' + (side === 'source' ? 'Source export' : 'Target export') + '</h3>' +
    '<div class="stack"><label>Original CSV or JSON<input type="file" name="file" accept=".csv,.json" required></label>' +
    '<label>Export captured at<input name="captured_at" value="' + h(new Date().toISOString()) + '" required spellcheck="false"></label></div>' +
    '<p class="help">Use an ISO date/time with a UTC offset. Retain the source system’s export observation time.</p>' +
    '<button type="submit" class="primary" data-write>Retain ' + side + ' export</button></form>';
}
function mappingForm(dataset) {
  const mapping = dataset.mapping || {}, fields = state.fields || canonicalFields, required = state.required_fields || ['id','type','department','status','attachments'];
  const advanced = [
    ['reviews','Department review columns','Department = original status column'],
    ...(fields.includes('reviewAssignments') ? [['reviewers','Assigned reviewer columns','Department = original assigned-reviewer column'],['review_due_dates','Review due-date columns','Department = original due-date column']] : []),
    ['type_aliases','Record type translations','Original = permit, license, inspection or special_event'],
    ['department_aliases','Department translations','Original department = agreed department'],
    ['status_aliases','Case status translations','Original status = agreed status'],
    ['review_aliases','Review status translations','Original review state = agreed review state'],
    ['reviewer_aliases','Reviewer name translations','Original reviewer name = agreed reviewer name']
  ];
  return '<form id="mapping-form" data-kind="mapping" data-dataset="' + h(dataset.id) + '" data-draft="mapping-' + h(dataset.id) + '">' +
    '<datalist id="export-columns">' + dataset.headers.map(column => '<option value="' + h(column) + '"></option>').join('') + '</datalist>' +
    '<div class="form-grid">' + fields.map(field => '<label>' + h(fieldLabels[field] || field) + (required.includes(field) ? ' *' : ' (optional)') +
      '<input name="field_' + h(field) + '" list="export-columns" value="' + h(mapping.fields?.[field] || '') + '"' + (required.includes(field) ? ' required' : '') + '></label>').join('') +
    '<label>Related identifiers format<select name="related_separator">' + option('json','JSON array',mapping.related_separator) + option('|','Pipe-separated',mapping.related_separator) + option(';','Semicolon-separated',mapping.related_separator) + '</select></label>' +
    '<label>Payment format<select name="payment_format">' + option('minor','Exact minor units',mapping.payment_format) + option('decimal','Dot-decimal major units',mapping.payment_format) + '</select></label></div>' +
    '<p class="help">Columns and JSON paths refer to the original export. Attachment count is required. Payment amounts remain exact text; decimal conversion uses the project currency scale. Department objects use JSON when mapped directly.</p>' +
    '<details><summary>Department columns and explicit value translations</summary><div class="form-grid">' +
    advanced.map(([name,label,placeholder]) => '<label>' + h(label) + '<textarea name="' + h(name) + '" placeholder="' + h(placeholder) + '" rows="3" spellcheck="false">' + h(pairs(mapping[name])) + '</textarea><span class="help">' + h(placeholder) + ' · one pair per line</span></label>').join('') +
    '</div></details><div class="actions"><button class="primary" type="submit" data-write>Confirm field mapping</button><span class="muted small">Saved runs retain their original mapping.</span></div></form>';
}
async function inputsView() {
  const dataset = state.datasets.find(item => item.id === selectedDataset);
  let preview = null, previewError = '';
  if (dataset) {
    try { preview = await api('/api/datasets/' + encodeURIComponent(dataset.id) + '/preview?offset=' + previewOffset + '&limit=25&normalized=' + (normalizedPreview && dataset.side !== 'crosswalk' ? '1':'0')); }
    catch (error) { previewError = error.message; }
  }
  const crosswalk = state.datasets.find(item => item.side === 'crosswalk' && item.current);
  const exports = state.datasets.map(item => '<div class="export-card"><button type="button" data-dataset="' + h(item.id) + '" aria-pressed="' + (item.id === selectedDataset) + '"><strong>' + h(item.filename) + '</strong><br>' + badge(item.side) + (item.current ? badge('selected',true) : '') + badge(item.confirmed ? 'mapping confirmed':'mapping needed') + '</button><div class="export-meta">' + item.rows.toLocaleString() + ' rows · captured ' + h(date(item.captured_at)) + '</div></div>').join('');
  let detail = empty('Retain the first source and target exports to inspect and map their original fields.');
  if (dataset) {
    detail = '<section class="panel"><div class="section-head"><div><h2>' + h(dataset.filename) + '</h2><p>' + badge(dataset.side) + badge(dataset.current ? 'selected for next run':'retained export') + '</p></div><div class="actions">' + fileLink(dataset.id) + (!dataset.current ? '<button type="button" data-action="select-dataset" data-id="' + h(dataset.id) + '" data-write>Use for next run</button>' : '') + '</div></div>' +
      '<p class="small muted">Captured ' + h(date(dataset.captured_at)) + ' · retained ' + h(date(dataset.created_at)) + ' · ' + dataset.rows.toLocaleString() + ' original rows</p><details><summary>Original file identity</summary><p class="mono">' + h(dataset.sha256) + '</p></details>' +
      (dataset.side === 'crosswalk' ? '<p>Each source_id maps to one target_id. The selected mapping applies to target case identifiers and target related identifiers.</p>' : mappingForm(dataset)) + '</section>' +
      '<section class="panel"><div class="section-head"><div><h2>Export preview</h2><p class="muted small">Original values remain available for every retained row.</p></div><label class="inline"><input type="checkbox" id="normalized-preview"' + (normalizedPreview ? ' checked':'') + (dataset.side === 'crosswalk' ? ' disabled':'') + '>Show normalized fields</label></div>' +
      (previewError ? '<p>' + h(previewError) + '</p><button type="button" data-action="raw-preview">View original rows</button>' : previewTable(preview)) + '</section>';
  }
  return {html:'<div class="section-head"><div><h2>Inputs &amp; mapping</h2><p class="muted">Retain both observations of the same case cohort, then confirm how each export maps to the comparison.</p></div></div>' +
    (!state.settings.cohort ? '<section class="panel"><p>Start with the cohort, export scope and required operational scenarios.</p><button type="button" data-view="setup" class="primary">Set up project</button></section>' : '') +
    '<div class="grid">' + uploadForm('source') + uploadForm('target') + '</div>' +
    '<section class="panel"><div class="section-head"><div><h3>Identifier crosswalk</h3><p class="small muted">Use when authoritative case identifiers change. CSV columns: source_id,target_id.</p></div>' +
    (crosswalk ? '<div>' + h(crosswalk.filename) + ' · ' + crosswalk.rows.toLocaleString() + ' pairs <button type="button" data-action="remove-crosswalk" data-write>Remove from next run</button></div>' : '<span class="muted">No crosswalk selected</span>') +
    '</div><form data-kind="crosswalk"><div class="filters"><label>Original mapping CSV<input type="file" name="file" accept=".csv" required></label><button type="submit" data-write>Retain crosswalk</button></div></form></section>' +
    '<div class="split"><aside class="panel"><h2>Retained exports</h2>' + (exports || '<p class="muted">No exports yet.</p>') + '</aside><div>' + detail + '</div></div>',
    data:{dataset,preview}};
}
function previewTable(preview) {
  if (!preview || !preview.rows.length) return empty('This export contains no rows.');
  return pager('preview',preview) + '<div class="table-wrap"><table><thead><tr><th>Original row</th><th>Original values</th><th>Normalized values / input review</th></tr></thead><tbody>' +
    preview.rows.map(row => '<tr><td>' + h(row.line) + '</td><td class="long"><details><summary>' + h(Object.entries(row.data || {}).slice(0,3).map(([key,value]) => key + ': ' + show(value)).join(' · ').slice(0,190)) + '</summary><pre>' + h(show(row.data)) + '</pre></details></td><td class="long">' +
      (row.errors?.length ? '<ul>' + row.errors.map(error => '<li>' + h(error) + '</li>').join('') + '</ul>' : row.normalized ? '<details><summary>' + h(row.normalized.id) + ' · ' + h(row.normalized.status) + '</summary><pre>' + h(show(row.normalized)) + '</pre></details>' : '<span class="muted">Original values</span>') + '</td></tr>').join('') +
    '</tbody></table></div>' + pager('preview',preview);
}
function runSelector() {
  return '<label>Retained comparison<select id="run-select">' + state.runs.map(run => option(run.id,run.label + ' · ' + date(run.created_at),selectedRun)).join('') + '</select></label>';
}
function runMetrics(run) {
  return '<div class="metrics">' + [
    [run.public_report.sourceRecords,'Source records'],[run.public_report.targetRecords,'Target records'],
    [run.counts?.total ?? run.public_report.totalFindings,'Findings'],[(run.counts?.open || 0)+(run.counts?.needs_fix || 0),'Unresolved findings']
  ].map(([number,label]) => '<div class="metric"><strong>' + h(Number(number || 0).toLocaleString()) + '</strong><span>' + h(label) + '</span></div>').join('') + '</div>';
}
function inputErrors(run) {
  if (!run.input_errors?.length) return '';
  return '<section class="panel"><h3>Input review required · ' + run.input_errors.length.toLocaleString() + '</h3><p>Correct the original export or field mapping and create a new comparison. This run retains the rejected input context.</p><div class="table-wrap"><table><thead><tr><th>Original export</th><th>Row</th><th>Issue</th></tr></thead><tbody>' +
    run.input_errors.slice(0,100).map(error => '<tr><td>' + (error.dataset_id ? fileLink(error.dataset_id,state.datasets.find(row => row.id === error.dataset_id)?.filename || 'Original export'):'Comparison input') + '</td><td>' + h(error.line) + '</td><td class="long">' + h(error.message) + (error.values ? rawDetails('Original values',error.values):'') + '</td></tr>').join('') +
    '</tbody></table></div>' + (run.input_errors.length > 100 ? '<p class="help">Showing the first 100 input errors. The full handoff contains every input error.</p>':'') + '</section>';
}
function continuityBlock(run) {
  const prior = run.continuity;
  if (!prior?.previous_run_id) return '';
  return '<section class="panel"><h3>Correction continuity</h3><p>Previous comparison: <button type="button" data-run="' + h(prior.previous_run_id) + '">' + h(prior.previous_run_label) + '</button></p>' +
    (prior.comparison_valid ? '<p><strong>' + h(prior.no_longer_present) + '</strong> prior findings no longer present · <strong>' + h(prior.unchanged_findings) + '</strong> unchanged findings · <strong>' + h(prior.new_or_changed_findings) + '</strong> new or changed findings</p><p class="help">Unchanged findings carry the previous review as context. Save the applicable decision for this comparison.</p>' :
      '<p class="help">Resolve the current input errors before assessing correction continuity.</p>') + '</section>';
}
function priorReviewBlock(finding) {
  const prior = finding.prior_review;
  if (!prior) return '';
  return '<section class="panel compact"><h3>Previous review of this unchanged finding</h3><p>' + badge(prior.status) + ' ' + h(prior.owner) + ' · ' + h(date(prior.updated_at)) + '</p><p>' + h(prior.note || 'No note') + '</p><p class="small muted">' + h(prior.run_label) + '</p><button type="button" data-action="use-prior-review" data-id="' + h(finding.id) + '">Use this review as a draft</button><p class="help">Review the current exports, then save the current-run decision below.</p></section>';
}
function reviewForm(finding, run) {
  const decision = finding.review || run.reviews?.[finding.id] || {};
  return '<form data-kind="review" data-id="' + h(finding.id) + '" data-draft="review-' + h(run.id) + '-' + h(finding.id) + '"><div class="form-grid">' +
    '<label>Review decision<select name="status">' + option('open','Open',decision.status || 'open') + option('needs_fix','Correction required',decision.status) + option('accepted_difference','Accept this difference',decision.status) + '</select></label>' +
    '<label>Assigned reviewer<input name="owner" value="' + h(decision.owner || reviewer()) + '" maxlength="200" required></label>' +
    '<label class="wide">Reason and correction instructions<textarea name="note" rows="3" maxlength="12000">' + h(decision.note || '') + '</textarea></label></div><div class="actions"><button type="submit" class="primary" data-write>Save review decision</button>' +
    (decision.updated_at ? '<span class="small muted">Last saved ' + h(date(decision.updated_at)) + '</span>' : '') + '</div></form>';
}
function findingDetails(finding, run) {
  if (!finding) return empty('Select a finding to inspect the exact case fields, original export rows and review decision.');
  return '<section class="panel" id="case-detail"><div class="section-head"><div><h2>Case ' + h(finding.case_id) + '</h2><p>' + badge(finding.code,true) + '</p></div><button type="button" data-action="case-findings" data-case="' + h(finding.case_id) + '">All findings for this case</button></div>' +
    compare(finding.source,finding.target) +
    (finding.details && Object.keys(finding.details).length ? rawDetails('Comparison detail',finding.details) : '') +
    '<div class="grid" style="margin-top:1rem">' + contextBlock('Source row',finding.source_context) + contextBlock('Target row',finding.target_context) + '</div><hr>' + priorReviewBlock(finding) + reviewForm(finding,run) + '</section>';
}
async function reviewView() {
  const create = '<section class="panel"><form data-kind="run" data-draft="new-run"><div class="section-head"><div><h2>Compare selected exports</h2><p class="muted small">Each run freezes the selected exports, mappings, scope and operational scenarios.</p></div></div><div class="filters"><label>Comparison label<input name="label" maxlength="240" placeholder="Cutover rehearsal — corrected target export" required></label><button type="submit" class="primary" data-write>Create comparison</button></div><p class="small">' +
    ['source','target','crosswalk'].map(side => {const row=state.datasets.find(item=>item.side===side&&item.current); return '<strong>' + title(side) + ':</strong> ' + h(row?.filename || 'none selected') + (row&&!row.confirmed ? ' (mapping needed)':'');}).join(' · ') + '</p></form></section>';
  if (!selectedRun) return {html:create + empty('Create the first retained comparison after confirming both export mappings.'),data:{}};
  const run = await runDetail();
  const filter = reviewMode === 'findings' ? findingFilters : caseFilters;
  const offset = reviewMode === 'findings' ? reviewOffset : caseOffset;
  const params = new URLSearchParams({...filter,offset:String(offset),limit:'50'});
  const page = await api('/api/runs/' + encodeURIComponent(run.id) + '/' + reviewMode + '?' + params);
  let list, detail;
  if (reviewMode === 'findings') {
    list = '<form data-kind="finding-filters"><div class="filters"><label>Case or issue code<input name="query" value="' + h(filter.query) + '" placeholder="Search exact case or issue"></label><label class="narrow">Issue<select name="code">' + option('','All issues',filter.code) +
      Object.keys(run.public_report.issues || {}).map(code => option(code,title(code),filter.code)).join('') + '</select></label><label class="narrow">Review<select name="status">' + option('','All reviews',filter.status) + ['open','needs_fix','accepted_difference'].map(value=>option(value,title(value),filter.status)).join('') + '</select></label><button type="submit">Filter findings</button></div></form>' +
      (page.rows.length ? '<div class="table-wrap"><table><thead><tr><th>Case</th><th>Finding</th><th>Review</th><th>Assigned reviewer</th><th></th></tr></thead><tbody>' +
      page.rows.map(item => '<tr' + (item.id === selectedFinding ? ' class="selected"':'') + '><td class="mono">' + h(item.case_id) + '</td><td>' + h(title(item.code)) + '</td><td>' + badge(item.review.status) + '</td><td>' + h(item.review.owner || 'Unassigned') + '</td><td><button type="button" data-finding="' + h(item.id) + '">Review</button></td></tr>').join('') +
      '</tbody></table></div>' : empty(run.input_errors.length ? 'Correct the input errors to produce case findings.' : 'No findings match this view.')) +
      pager('findings',page);
    const finding = page.rows.find(item => item.id === selectedFinding);
    detail = findingDetails(finding,run);
  } else {
    list = '<form data-kind="case-filters"><div class="filters"><label>Case identifier<input name="query" value="' + h(filter.query) + '" placeholder="Search the complete normalized cohort"></label><label class="narrow">Record type<select name="type">' + option('','All record types',filter.type) + ['permit','license','inspection','special_event'].map(value=>option(value,title(value),filter.type)).join('') + '</select></label><button type="submit">Filter cases</button></div></form>' +
      (page.rows.length ? '<div class="table-wrap"><table><thead><tr><th>Case</th><th>Type / department</th><th>Source status</th><th>Target status</th><th>Findings</th><th></th></tr></thead><tbody>' +
      page.rows.map(item => '<tr' + (item.case_id === selectedCase ? ' class="selected"':'') + '><td class="mono">' + h(item.case_id) + '</td><td>' + h(title((item.source || item.target).type)) + '<br><span class="muted">' + h((item.source || item.target).department) + '</span></td><td>' + h(item.source?.status || 'Absent') + '</td><td>' + h(item.target?.status || 'Absent') + '</td><td>' + item.finding_ids.length + ' ' + badge(item.review_status) + '</td><td><button type="button" data-case="' + h(item.case_id) + '">Inspect</button></td></tr>').join('') +
      '</tbody></table></div>' : empty('No cases match this view.')) + pager('cases',page);
    const item = page.rows.find(row=>row.case_id===selectedCase);
    detail = item ? '<section class="panel" id="case-detail"><div class="section-head"><div><h2>Case ' + h(item.case_id) + '</h2><p>' + badge(item.review_status,true) + '</p></div><button type="button" data-action="case-findings" data-case="' + h(item.case_id) + '">Review case findings</button></div>' + compare(item.source,item.target) + '<p class="help">Exact original exports and mappings for this comparison are retained in the run manifest under Acceptance &amp; handoff.</p></section>' : empty('Select any case, including cases with no findings, to inspect both normalized records.');
  }
  return {html:create + '<section class="panel">' + runSelector() + runMetrics(run) + '<div class="actions"><button type="button" data-mode="findings"' + (reviewMode==='findings'?' class="primary"':'') + '>Findings &amp; assignments</button><button type="button" data-mode="cases"' + (reviewMode==='cases'?' class="primary"':'') + '>Complete case cohort</button><button type="button" data-view="acceptance">Acceptance &amp; handoff</button></div></section>' +
    inputErrors(run) + continuityBlock(run) + '<section class="panel"><h2>' + (reviewMode==='findings'?'Finding queue':'All cases') + '</h2>' + list + '</section>' + detail,
    data:{run,page}};
}
function decisionForm(kind, id, current, run) {
  const choices = kind === 'scenario' ? [['pending','Pending'],['passed','Passed'],['failed','Failed']] : [['pending','Pending'],['ready','Ready for cutover'],['deferred','Deferred']];
  return '<form data-kind="' + kind + '" data-id="' + h(id) + '" data-draft="' + kind + '-' + h(run.id) + '-' + h(id) + '"><div class="form-grid"><label>Decision<select name="status">' +
    choices.map(([value,label])=>option(value,label,current?.status || 'pending')).join('') + '</select></label><label>Reviewer / accountable owner<input name="owner" maxlength="200" value="' + h(current?.owner || reviewer()) + '" required></label><label class="wide">Observed result and reason<textarea name="note" maxlength="12000" rows="3">' +
    h(current?.note || '') + '</textarea></label></div><div class="actions"><button type="submit" data-write' + (kind==='cutover'?' class="primary"':'') + '>Save ' + (kind==='cutover'?'cutover decision':'scenario result') + '</button>' +
    (current?.updated_at?'<span class="small muted">Saved ' + h(date(current.updated_at)) + '</span>':'') + '</div></form>';
}
function sourceLink(scenario) {
  try {
    const url = new URL(scenario.source_url);
    if (!['http:','https:'].includes(url.protocol)) return '';
    return '<p class="small"><a href="' + h(url.href) + '" target="_blank" rel="noopener noreferrer">Original workflow source</a>' + (scenario.source_locator ? ' · ' + h(scenario.source_locator) : '') + '</p>';
  } catch { return ''; }
}
function scenarioResult(scenario, run) {
  if (!scenario.check) return '';
  const result = run.scenario_results?.find(item => item.scenario_id === scenario.id);
  if (!result) return '<p class="help">The configured candidate check has no result for this comparison. Review the run input errors.</p>';
  return '<div class="panel compact"><h3>Candidate snapshot check</h3><p>' + badge(result.status,true) + ' · ' + h(result.checked) + ' applicable cases or reviews · ' + h(result.violation_count) + ' violations</p>' +
    (result.status === 'not_exercised' ? '<p>The selected cohort contains no applicable records. Select the relevant cohort or adjust the documented department and status vocabulary in a new comparison.</p>' : '') +
    (result.violations?.length ? '<details><summary>Inspect ' + result.violations.length + ' retained violations</summary><div class="table-wrap"><table><thead><tr><th>Case</th><th>Related case / department</th><th>Observed result</th><th></th></tr></thead><tbody>' +
      result.violations.map(item => '<tr><td class="mono">' + h(item.case_id) + '</td><td>' + h(item.related_id || item.department) + '</td><td class="long">' + h(item.reason || '') + '<br>' +
        h(item.missing_fields?.map(field=>fieldLabels[field] || field).join(', ') || [item.parent_status,item.related_status].filter(Boolean).join(' → ')) +
        '</td><td><button type="button" data-action="inspect-scenario-case" data-case="' + h(item.case_id) + '">Inspect case</button></td></tr>').join('') +
      '</tbody></table></div></details>' : '') +
    (result.violations_truncated ? '<p class="help">The complete violation count is shown above; the first 1,000 violation details are retained. Use the complete case cohort to inspect additional cases.</p>' : '') + '</div>';
}
async function acceptanceView() {
  if (!selectedRun) return {html:empty('Create a retained comparison to review its operational scenarios and assemble the handoff.'),data:{}};
  const run = await runDetail();
  const links = [['handoff','Full review handoff'],['summary','Aggregate comparison summary'],['findings.csv','Finding queue CSV']];
  const downloads = links.map(([path,label]) => '<a class="button" href="/api/runs/' + encodeURIComponent(run.id) + '/' + path + '" download>' + label + '</a>').join('');
  const scenarios = run.settings.scenarios || [];
  return {html:'<section class="panel"><div class="section-head"><div><h2>Acceptance &amp; handoff</h2><p class="muted">Operational results and cutover decisions belong to this exact comparison.</p></div></div>' + runSelector() + runMetrics(run) +
    '<p><strong>Export scope:</strong> ' + h(run.settings.scope_note) + '</p><p class="small muted">Cohort ' + h(run.settings.cohort) + ' · ' + h(run.settings.currency) + ' / ' + h(run.settings.currency_scale) + ' decimal places · created ' + h(date(run.created_at)) + '</p></section>' +
    inputErrors(run) + '<section class="panel"><h2>Operational scenarios</h2>' +
    (scenarios.length ? scenarios.map(item => '<article class="scenario"><div class="scenario-title"><h3>' + h(item.title) + '</h3>' + badge(item.required?'required':'optional') + badge(run.scenario_reviews?.[item.id]?.status || 'pending') + '</div><p>' + h(item.criterion) + '</p>' + sourceLink(item) + scenarioResult(item,run) + decisionForm('scenario',item.id,run.scenario_reviews?.[item.id],run) + '</article>').join('') :
      '<p>Define operational scenarios in Project setup, then create a new comparison to capture them.</p>') +
    '</section><section class="panel"><div class="section-head"><div><h2>Cutover decision</h2><p>' + badge(run.cutover?.status || 'pending',true) + '</p></div></div>' +
    (run.cutover_blockers?.length ? '<p>Remaining acceptance work for this run:</p><ul class="blockers">' + run.cutover_blockers.map(item=>'<li>'+h(item)+'</li>').join('') + '</ul>' : '<p>The comparison and required scenario results satisfy the configured readiness criteria. Record the accountable cutover decision below.</p>') +
    decisionForm('cutover','main',run.cutover,run) + '<p class="help">Changing a finding or scenario decision after Ready reopens the cutover decision and retains its earlier history.</p></section>' +
    '<section class="panel"><h2>Retained handoff</h2><p>The full handoff includes the exact run, case records, input findings and all review history. The aggregate summary uses the original comparator’s publication format. A workspace backup additionally retains original uploaded files and every comparison.</p><div class="actions">' + downloads + '<a class="button" href="/api/backup" download>Complete workspace backup</a></div>' +
    '<details><summary>Original exports and mapping manifest</summary>' + run.manifest.map(item => '<div class="scenario"><h3>' + h(title(item.side)) + ' · ' + h(item.filename) + '</h3><p class="small">Captured ' + h(date(item.captured_at)) + ' · ' + h(item.bytes) + ' bytes</p><p class="mono">' + h(item.sha256) + '</p>' + fileLink(item.dataset_id || item.id) + rawDetails('Saved field mapping',item.mapping) + '</div>').join('') + '</details></section>' +
    '<section class="panel"><h2>Recent decision history</h2>' + (run.review_history?.length ? '<ol class="history">' + [...run.review_history].reverse().map(item=>'<li><strong>' + h(title(item.kind)) + ' · ' + h(title(item.status)) + '</strong> — ' + h(item.owner) + ' · ' + h(date(item.updated_at)) + '<br>' + h(item.note || 'No note') + '</li>').join('') + '</ol><p class="help">The full handoff contains the complete history.</p>' : '<p class="muted">No saved decisions yet.</p>') + '</section>',
    data:{run}};
}
function listValues(value) { return String(value || '').split(/\r?\n/).map(item=>item.trim()).filter(Boolean); }
function readSetup(form) {
  const values = new FormData(form), previous=setupDraft || state.settings;
  const scenarios=$$('.scenario-edit',form).map((row,index)=>{
    const prior=previous.scenarios?.[index] || {};
    const value=name=>$('[name="'+name+'"]',row)?.value;
    const scenario={...prior,id:value('scenario_id'),title:value('scenario_title'),criterion:value('scenario_criterion'),required:$('[name="scenario_required"]',row).checked};
    const kind=value('check_kind') || '';
    if (kind==='linked_finalization') {
      scenario.check={kind,parent_type:value('parent_type') || prior.check?.parent_type || 'permit',parent_department:value('parent_department') ?? prior.check?.parent_department ?? 'Building',
        child_type:value('child_type') || prior.check?.child_type || 'permit',child_department:value('child_department') ?? prior.check?.child_department ?? 'Fire',
        finalized_statuses:value('finalized_statuses') === undefined ? prior.check?.finalized_statuses || ['Finalized'] : listValues(value('finalized_statuses'))};
    } else if (kind==='required_review_fields') {
      scenario.check={kind,departments:value('check_departments')===undefined ? prior.check?.departments || ['Fire','Public Works','Land Use'] : listValues(value('check_departments')),
        open_states:value('open_states')===undefined ? prior.check?.open_states || ['Open','In Review'] : listValues(value('open_states'))};
    } else delete scenario.check;
    return scenario;
  });
  return {cohort:String(values.get('cohort')||''),currency:String(values.get('currency')||''),currency_scale:Number(values.get('currency_scale')),scope_note:String(values.get('scope_note')||''),scenarios};
}
function scenarioCheckEditor(scenario) {
  const check=scenario.check || {};
  let fields='';
  if(check.kind==='linked_finalization') {
    fields='<div class="form-grid">' + [['parent_type','Parent record type'],['child_type','Linked record type']].map(([name,label])=>'<label>' + label + '<select name="'+name+'">'+['permit','license','inspection','special_event'].map(value=>option(value,title(value),check[name])).join('')+'</select></label>').join('') +
      [['parent_department','Parent department'],['child_department','Linked department']].map(([name,label])=>'<label>'+label+'<input name="'+name+'" value="'+h(check[name])+'" required></label>').join('') +
      '<label class="wide">Finalized statuses — one normalized value per line<textarea name="finalized_statuses" rows="2" required>'+h((check.finalized_statuses || []).join('\n'))+'</textarea></label></div>';
  } else if(check.kind==='required_review_fields') {
    fields='<div class="form-grid"><label>Selected departments — one per line<textarea name="check_departments" rows="3" required>'+h((check.departments || []).join('\n'))+'</textarea></label><label>Open review states — one per line<textarea name="open_states" rows="3" required>'+h((check.open_states || []).join('\n'))+'</textarea></label></div>';
  }
  return '<div class="stack"><label>Candidate snapshot check<select name="check_kind" class="check-kind">'+option('','Manual operational observation',check.kind || '')+option('linked_finalization','Linked-record finalization',check.kind)+option('required_review_fields','Open review ownership and due dates',check.kind)+'</select></label>'+fields+'</div>'+sourceLink(scenario);
}
function setupView() {
  const settings = setupDraft || state.settings;
  return {html:'<form id="setup-form" data-kind="setup"><section class="panel"><div class="section-head"><div><h2>Project setup</h2><p class="muted">Define the authoritative cohort, observation point and acceptance criteria before comparing exports.</p></div></div><div class="form-grid">' +
    '<label>Cohort identifier<input name="cohort" value="' + h(settings.cohort) + '" pattern="[A-Za-z0-9][A-Za-z0-9._:-]{0,127}" maxlength="128" required placeholder="permit-cutover-2026-10"></label>' +
    '<label>Currency<input name="currency" value="' + h(settings.currency || 'USD') + '" pattern="[A-Za-z]{3}" maxlength="3" required></label>' +
    '<label>Currency decimal places<input name="currency_scale" type="number" min="0" max="6" step="1" value="' + h(settings.currency_scale ?? 2) + '" required></label>' +
    '<label class="wide">Included population, observation point and export scope<textarea name="scope_note" maxlength="12000" rows="4" required placeholder="Name the original systems and capture point; define included case types, related-case population, review fields and payment meaning.">' + h(settings.scope_note) + '</textarea></label></div><p class="help">Capture matching observations of the same population. Related target identifiers must belong to the declared cohort or appear as comparison findings. Case payment fields use the declared currency; define finance-ledger reconciliation separately when required by the engagement.</p></section>' +
    '<section class="panel"><div class="section-head"><div><h2>Operational acceptance scenarios</h2><p class="muted small">Each scenario records an observable result and an accountable reviewer. Every comparison freezes the current list.</p></div><button type="button" data-action="add-scenario">Add scenario</button></div>' +
    (state.scenario_recipes?.length ? '<div class="filters"><label>Source-derived workflow recipe<select id="recipe-select">'+state.scenario_recipes.map((item,index)=>option(index,item.title,0)).join('')+'</select></label><button type="button" data-action="add-recipe">Add editable recipe</button></div><p class="help">Adjust the normalized department names, statuses and acceptance criterion to the actual export population before saving.</p>' : '') +
    (settings.scenarios || []).map((item,index)=>'<article class="scenario scenario-edit"><div class="form-grid"><label>Scenario identifier<input name="scenario_id" value="' + h(item.id) + '" pattern="[A-Za-z0-9][A-Za-z0-9._:-]{0,127}" required></label><label>Title<input name="scenario_title" value="' + h(item.title) + '" required></label><label class="wide">Observable acceptance criterion<textarea name="scenario_criterion" rows="3" required>' + h(item.criterion) + '</textarea></label></div>' + scenarioCheckEditor(item) + '<div class="actions"><label class="inline"><input type="checkbox" name="scenario_required"' + (item.required?' checked':'') + '>Required for cutover</label><button type="button" data-action="remove-scenario" data-index="' + index + '">Remove scenario</button></div></article>').join('') +
    (!(settings.scenarios || []).length ? '<p class="muted">Add at least one required operational scenario to support a Ready decision.</p>' : '') +
    '</section><section class="panel"><div class="actions"><button class="primary" type="submit" data-write>Save project setup</button><button type="button" data-action="reset-setup">Reload saved setup</button><span class="small muted">Existing runs retain their original settings and decisions.</span></div></section></form>',data:{}};
}
async function render(capture = true) {
  if (capture) captureDrafts();
  const generation = ++epoch;
  updateHeader();
  main.innerHTML = '<p class="loading">Loading ' + h(view === 'review' ? 'case review' : view) + '…</p>';
  try {
    const output = view === 'inputs' ? await inputsView() : view === 'review' ? await reviewView() : view === 'acceptance' ? await acceptanceView() : setupView();
    if (generation !== epoch) return;
    model = output.data; main.innerHTML = output.html; restoreDrafts(); setBusy(busy);
  } catch (error) {
    if (generation !== epoch) return;
    main.innerHTML = empty('Could not load this workspace view. Refresh to try again.');
    notice(error.message,'error');
  }
}
document.addEventListener('input', event => {
  if (event.target.id === 'reviewer') { try { localStorage.setItem('permitting-reviewer',event.target.value); } catch {} return; }
  const form = event.target.closest('form');
  if (form?.id === 'setup-form') setupDraft = readSetup(form);
  else if (form?.dataset.draft) drafts.set(form.dataset.draft,formValues(form));
});
document.addEventListener('change', async event => {
  if (event.target.classList.contains('check-kind')) { setupDraft=readSetup($('#setup-form')); await render(false); return; }
  if (event.target.id === 'run-select') {
    captureDrafts(); selectedRun = event.target.value; selectedFinding=''; selectedCase=''; reviewOffset=caseOffset=0; await render(false);
  } else if (event.target.id === 'normalized-preview') {
    normalizedPreview = event.target.checked; previewOffset=0; await render();
  }
});
document.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  try {
    if (button.dataset.view) { view=button.dataset.view; await render(); return; }
    if (button.id === 'refresh') { captureDrafts(); await refreshState(); await render(false); notice('Refreshed. Unsaved form drafts are retained.'); return; }
    if (button.dataset.run) { selectedRun=button.dataset.run; selectedFinding='';selectedCase='';reviewOffset=caseOffset=0;view='review';await render();return; }
    if (button.dataset.dataset) { selectedDataset=button.dataset.dataset; previewOffset=0; await render(); return; }
    if (button.dataset.page) {
      const offset=Number(button.dataset.offset);
      if (button.dataset.page==='preview') previewOffset=offset;
      if (button.dataset.page==='findings') { reviewOffset=offset; selectedFinding=''; }
      if (button.dataset.page==='cases') { caseOffset=offset; selectedCase=''; }
      await render(); return;
    }
    if (button.dataset.mode) { reviewMode=button.dataset.mode; await render(); return; }
    if (button.dataset.finding) { selectedFinding=button.dataset.finding; await render(); $('#case-detail')?.scrollIntoView({block:'start'}); return; }
    if (button.dataset.case && !button.dataset.action) { selectedCase=button.dataset.case; await render(); $('#case-detail')?.scrollIntoView({block:'start'}); return; }
    const action=button.dataset.action;
    if (action==='select-dataset') await mutate('/api/select-dataset',{dataset_id:button.dataset.id},{message:'Retained export selected for the next comparison.'});
    if (action==='remove-crosswalk') await mutate('/api/crosswalk/remove',{}, {message:'Crosswalk removed from the next comparison. Its original file remains retained.'});
    if (action==='raw-preview') { normalizedPreview=false; previewOffset=0; await render(); }
    if (action==='case-findings') {
      findingFilters={query:button.dataset.case,code:'',status:''}; reviewMode='findings'; reviewOffset=0; selectedFinding=''; await render();
    }
    if (action==='inspect-scenario-case') {
      caseFilters={query:button.dataset.case,type:''}; selectedCase=button.dataset.case;caseOffset=0;reviewMode='cases';view='review';await render();
      $('#case-detail')?.scrollIntoView({block:'start'});
    }
    if (action==='use-prior-review') {
      const finding=model.page?.rows.find(item=>item.id===button.dataset.id), prior=finding?.prior_review;
      const form=$('form[data-kind="review"]');
      if(prior && form) {
        $('[name="status"]',form).value=prior.status;
        $('[name="owner"]',form).value=reviewer() || prior.owner;
        $('[name="note"]',form).value=prior.note;
        drafts.set(form.dataset.draft,formValues(form));
        notice('Previous review copied into the current draft. Review the current case and save its decision.');
      }
    }
    if (['add-scenario','remove-scenario','reset-setup','add-recipe'].includes(action)) {
      setupDraft=readSetup($('#setup-form'));
      if (action==='add-scenario') setupDraft.scenarios.push({id:'scenario-'+Date.now().toString(36),title:'',criterion:'',required:true});
      if (action==='add-recipe') {
        const recipe=state.scenario_recipes?.[Number($('#recipe-select').value)];
        if(recipe) {
          const copy=structuredClone(recipe), ids=new Set(setupDraft.scenarios.map(item=>item.id));
          if(ids.has(copy.id)) copy.id += '-'+Date.now().toString(36);
          setupDraft.scenarios.push(copy);
        }
      }
      if (action==='remove-scenario') setupDraft.scenarios.splice(Number(button.dataset.index),1);
      if (action==='reset-setup') setupDraft=null;
      await render(false);
    }
  } catch(error) { notice(error.message,'error'); }
});
document.addEventListener('submit', async event => {
  const form=event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  if (busy) return;
  const kind=form.dataset.kind, values=formValues(form);
  try {
    if (kind==='upload') {
      const original=await base64File($('[name="file"]',form));
      await mutate('/api/upload',{side:form.dataset.side,captured_at:values.captured_at,...original},{
        clear:[form.dataset.draft],after:result=>{selectedDataset=result.dataset_id; previewOffset=0; normalizedPreview=false;},
        message:'Original export retained. Confirm its field mapping before comparison.'
      });
    } else if (kind==='crosswalk') {
      const original=await base64File($('[name="file"]',form));
      await mutate('/api/crosswalk',original,{after:result=>{selectedDataset=result.dataset_id;previewOffset=0;},message:'Identifier crosswalk retained and selected for the next comparison.'});
    } else if (kind==='mapping') {
      const fields=Object.fromEntries((state.fields || canonicalFields).map(field=>[field,values['field_'+field] || '']));
      const mapping={fields,related_separator:values.related_separator,payment_format:values.payment_format};
      for (const name of ['reviews','reviewers','review_due_dates','type_aliases','department_aliases','status_aliases','review_aliases','reviewer_aliases']) {
        if (name in values) mapping[name]=parsePairs(values[name],title(name));
      }
      await mutate('/api/mapping',{dataset_id:form.dataset.dataset,mapping},{clear:[form.dataset.draft],after:()=>{normalizedPreview=true;previewOffset=0;},message:'Field mapping confirmed. Review the normalized rows before creating a comparison.'});
    } else if (kind==='setup') {
      await mutate('/api/settings',{settings:readSetup(form)},{clearSetup:true,message:'Project scope and operational scenarios saved for future comparisons.'});
    } else if (kind==='run') {
      await mutate('/api/run',{label:values.label},{clear:[form.dataset.draft],after:result=>{selectedRun=result.run_id;selectedFinding='';selectedCase='';reviewOffset=caseOffset=0;findingFilters={query:'',code:'',status:''};caseFilters={query:'',type:''};},message:'Comparison retained. Review its inputs, findings and operational scenarios.'});
    } else if (kind==='finding-filters') {
      findingFilters={query:values.query.trim(),code:values.code,status:values.status};reviewOffset=0;selectedFinding='';await render();
    } else if (kind==='case-filters') {
      caseFilters={query:values.query.trim(),type:values.type};caseOffset=0;selectedCase='';await render();
    } else if (['review','scenario','cutover'].includes(kind)) {
      const route=kind==='review'?'review':kind==='scenario'?'scenario-review':'cutover';
      const payload={run_id:selectedRun,status:values.status,owner:values.owner,note:values.note};
      if(kind==='review') payload.finding_id=form.dataset.id;
      if(kind==='scenario') payload.scenario_id=form.dataset.id;
      await mutate('/api/'+route,payload,{clear:[form.dataset.draft],message:'Decision saved with its reviewer, reason and history.'});
    }
  } catch(error) { notice(error.message,'error'); }
});
window.addEventListener('beforeunload',event=>{
  const active=$$('form[data-draft]',main).some(form=>drafts.has(form.dataset.draft)) || !!setupDraft;
  if (active && busy) { event.preventDefault(); event.returnValue=''; }
});
(async()=>{
  try {
    await refreshState();
    if (!state.settings.cohort) view='setup';
    await render(false);
  } catch(error) { main.innerHTML=empty('The local workspace could not be opened. Reload after the server is available.');notice(error.message,'error'); }
})();

