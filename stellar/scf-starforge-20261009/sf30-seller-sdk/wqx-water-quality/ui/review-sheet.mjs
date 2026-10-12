import { mountConcentrations } from './concentrations.mjs';
// MIT. Complete bulk receiving decisions over the original Open Waters project.
const $ = id => document.getElementById(id);
const SCHEMA = 'starforge.wqx-review-sheet.v1';
const PAGE = 50;
const SELECTION_PAGE = 1000;
const KINDS = [['settings', 'Receiving settings'], ['location', 'Locations'], ['activity', 'Activities'],
  ['result', 'Results'], ['translation', 'Exact value translations'], ['limit', 'Detection limits'],
  ['reference', 'Receiving reference lists']];
const show = value => value === null || value === undefined ? '—' : value === '' ? '(empty)' :
  typeof value === 'object' ? JSON.stringify(value) : String(value);
const clone = value => structuredClone(value);
const make = (tag, value, attributes = {}) => {
  const node = document.createElement(tag);
  if (value !== null && value !== undefined) node.textContent = String(value);
  for (const [key, item] of Object.entries(attributes)) if (item !== null && item !== undefined) node.setAttribute(key, String(item));
  return node;
};
const option = (node, value, label) => node.append(make('option', label, { value }));
const shortName = prefix => prefix + '-' + new Date().toISOString().slice(0, 10).replaceAll('-', '') + '-' + crypto.randomUUID().slice(0, 8);
const human = value => String(value).replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replace(/^./, text => text.toUpperCase());
const cell = (row, value, className) => {
  const node = make('td', value, className ? { class: className } : {}); row.append(node); return node;
};
function download(text, filename, mime = 'application/json;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = make('a', null, { href: url, download: filename }); document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function documentInput(value) {
  if (!value || value.schema !== SCHEMA || typeof value.sourcePlanId !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.sourcePlanSha256 ?? '') || !Array.isArray(value.decisions))
    throw new Error('Choose a complete source-bound decision sheet exported by this workspace.');
  return clone(value);
}
export function mountReviewSheets({ api, notice, refresh, openPlan }) {
  let workspace = null, source = null, document = null, page = null, offset = 0, busy = false, searchTimer;
  let version = 0, previewVersion = -1, preview = null, saved = null, dirty = false, sequence = 0;
  const selected = new Map(), targets = new Map(), edits = new Map();
  let concentrations = null;
  const active = () => Boolean(source && document);
  function currentDocument() {
    if (!active()) throw new Error('Open a saved source plan first.');
    return { schema: SCHEMA, sourcePlanId: document.sourcePlanId, sourcePlanSha256: document.sourcePlanSha256,
      decisions: [...edits.values()].map(clone) };
  }
  function currentPreview() { return preview && previewVersion === version; }
  function markChanged() {
    version++; dirty = true; saved = null; $('rs-exports').hidden = true; renderStatus(); renderDraft();
  }
  function renderStatus() {
    $('rs-controls').disabled = busy;
    $('tab-review-sheets').setAttribute('aria-busy', String(busy));
    $('rs-load').disabled = busy || !$('rs-source-plan').value;
    $('rs-target-controls').disabled = busy || !active();
    $('rs-edit-controls').disabled = busy || !active() || Boolean(saved);
    $('rs-preview').disabled = busy || !active();
    $('rs-save').disabled = busy || !currentPreview() || Boolean(saved);
    $('rs-show-preview').disabled = busy || !currentPreview();
    $('rs-export-json').disabled = busy || !active();
    $('rs-export-table').disabled = busy || !active();
    $('rs-open-saved').disabled = busy || !$('rs-saved-review').value;
    $('rs-clear-selection').disabled = busy || !selected.size || Boolean(saved);
    $('rs-new-plan').readOnly = Boolean(saved); $('rs-review-id').readOnly = Boolean(saved);
    $('rs-apply-bulk').disabled = busy || !selected.size || Boolean(saved);
    $('rs-selection-count').textContent = selected.size.toLocaleString() + ' selected across pages';
    $('rs-draft-count').textContent = edits.size.toLocaleString() + ' recorded decisions';
    $('rs-state').textContent = busy ? 'Working' : saved ? 'Saved review' : currentPreview() ? 'Preview current' :
      !active() ? 'Choose a source plan' : dirty ? 'Draft has changes' : 'Source plan opened';
    $('rs-preview-state').textContent = currentPreview() ? 'Preview matches this draft and new plan name.' :
      preview ? 'Update the preview to use the current decisions and plan name.' : 'Preview the full native receiving plan before saving.';
    $('rs-preview-output').classList.toggle('rs-stale', Boolean(preview && !currentPreview()));
    concentrations?.update();
    const set = $('rs-bulk-action').value === 'set';
    $('rs-bulk-value').disabled = !set || busy; $('rs-bulk-reason').required = $('rs-bulk-action').value !== 'keep';
  }
  async function run(work, event) {
    event?.preventDefault(); if (busy) return;
    busy = true; renderStatus();
    try { await work(); } catch (error) { notice(error.message, true); }
    finally { busy = false; renderStatus(); }
  }
  function query(start = offset, limit = PAGE) {
    const params = new URLSearchParams({ offset: String(start), limit: String(limit),
      attentionOnly: String($('rs-attention').checked) });
    for (const [name, id] of [['kind', 'rs-kind'], ['field', 'rs-field'], ['search', 'rs-search']])
      if ($(id).value) params.set(name, $(id).value);
    return params;
  }
  async function requestPage(start = offset, limit = PAGE) {
    const value = await api('/api/review-sheets/source/' + encodeURIComponent(document.sourcePlanId) + '/targets?' + query(start, limit));
    if (!Array.isArray(value.rows) || !Number.isSafeInteger(value.total) || value.total < 0)
      throw new Error('The complete source target table could not be read.');
    return value;
  }
  async function loadPage(reset = false) {
    if (!active()) return;
    if (reset) offset = 0;
    const ticket = ++sequence, sourceId = document.sourcePlanId, result = await requestPage();
    if (ticket !== sequence || sourceId !== document.sourcePlanId) return;
    if (offset >= result.total && offset > 0) { offset = Math.max(0, Math.ceil(result.total / PAGE) - 1) * PAGE; return loadPage(); }
    page = result;
    for (const row of page.rows) targets.set(row.targetId, row);
    const fields = Array.isArray(result.fields) ? result.fields : [...new Set(page.rows.map(row => row.field))];
    $('rs-field-values').replaceChildren();
    for (const field of fields) option($('rs-field-values'), typeof field === 'string' ? field : field.field, typeof field === 'string' ? field : field.field);
    renderTargets();
  }
  function decision(targetId) { return edits.get(targetId) ?? { targetId, action: 'keep' }; }
  function setDecision(target, action, value, reason) {
    if (saved) return;
    if (!['keep', 'set', 'clear'].includes(action)) throw new Error('Choose keep, set, or remove the saved choice.');
    if (action === 'keep') {
      if (reason) edits.set(target.targetId, { targetId: target.targetId, action, reason }); else edits.delete(target.targetId);
    } else edits.set(target.targetId, { targetId: target.targetId, action, ...(action === 'set' ? { value } : {}), reason });
    targets.set(target.targetId, target); markChanged();
  }
  function renderTargets() {
    const body = $('rs-targets'); body.replaceChildren();
    for (const target of page?.rows ?? []) {
      const tr = make('tr'), pick = make('input', null, { type: 'checkbox', 'aria-label': 'Select ' + target.field + ' for ' + show(target.sourceKey) });
      pick.checked = selected.has(target.targetId); pick.disabled = Boolean(saved);
      pick.addEventListener('change', () => { if (pick.checked) selected.set(target.targetId, target); else selected.delete(target.targetId); renderStatus(); });
      cell(tr, null, 'rs-pick').append(pick);
      const identity = cell(tr, KINDS.find(([kind]) => kind === target.kind)?.[1] ?? human(target.kind), 'rs-identity');
      identity.append(make('small', target.label ?? target.sourceId ?? target.sourceKey ?? 'Receiving plan'));
      const field = cell(tr, target.field, 'rs-field'); if (target.matchValue !== undefined && target.matchValue !== null) field.append(make('small', 'Exact match: ' + show(target.matchValue)));
      const base = cell(tr, show(target.currentValue), 'rs-base');
      if (target.savedChoice?.present === true) base.append(make('small', 'A saved choice is present'));
      const controls = cell(tr, null, 'rs-row-editor'), action = make('select', null, { 'aria-label': 'Decision for ' + target.field });
      option(action, 'keep', 'Keep current choice'); option(action, 'set', 'Set exact value'); option(action, 'clear', 'Remove saved choice');
      const existing = decision(target.targetId); action.value = existing.action; action.disabled = Boolean(saved);
      const value = make('textarea', null, { rows: target.kind === 'reference' ? 3 : 2, spellcheck: 'false', 'aria-label': 'New value for ' + target.field });
      value.value = existing.action === 'set' ? existing.value ?? '' : ''; value.disabled = existing.action !== 'set' || Boolean(saved);
      value.placeholder = target.kind === 'reference' ? 'Exact JSON array of receiving values' : 'Empty is an explicit empty value';
      const reason = make('input', null, { type: 'text', autocomplete: 'off', 'aria-label': 'Reason for ' + target.field, placeholder: 'Reason for the changed choice' });
      reason.value = existing.reason ?? ''; reason.disabled = Boolean(saved);
      const update = () => { if (saved) return; value.disabled = action.value !== 'set'; setDecision(target, action.value, value.value, reason.value); };
      action.addEventListener('change', update); value.addEventListener('input', update); reason.addEventListener('input', update);
      controls.append(action, value, reason);
      const issues = cell(tr, (target.issueCodes ?? []).join('\n') || 'No linked issue', 'rs-issues');
      if (Array.isArray(target.allowedValues) && target.allowedValues.length) {
        const detail = make('details'), summary = make('summary', 'Available values');
        detail.append(summary, make('p', target.allowedValues.map(show).join(' · '))); issues.append(detail);
      }
      body.append(tr);
    }
    if (!body.children.length) { const row = make('tr'); row.append(make('td', 'No targets match this filter.', { colspan: 6 })); body.append(row); }
    const total = page?.total ?? 0, end = Math.min(total, offset + (page?.rows.length ?? 0));
    $('rs-page').textContent = total ? (offset + 1) + '–' + end + ' of ' + total.toLocaleString() + ' targets' : '0 targets';
    $('rs-previous').disabled = !offset; $('rs-next').disabled = offset + PAGE >= total;
    $('rs-select-page').disabled = !page?.rows.length || Boolean(saved); $('rs-select-filtered').disabled = !total || Boolean(saved);
    renderStatus();
  }
  function renderDraft() {
    const body = $('rs-decisions'); body.replaceChildren();
    let shown = 0;
    for (const value of edits.values()) {
      if (shown++ >= 100) break;
      const target = targets.get(value.targetId), tr = make('tr');
      cell(tr, target ? human(target.kind) + ' · ' + show(target.sourceKey) : value.targetId, 'rs-identity');
      cell(tr, target?.field ?? 'Source-bound target', 'rs-field');
      cell(tr, value.action === 'set' ? 'Set: ' + show(value.value) : value.action === 'clear' ? 'Remove saved choice' : 'Keep current choice', 'rs-base');
      cell(tr, value.reason || 'Enter a reason in the target table', 'rs-issues');
      const remove = make('button', 'Remove decision', { type: 'button' }); remove.disabled = Boolean(saved);
      remove.addEventListener('click', () => { if (saved) return; edits.delete(value.targetId); markChanged(); renderTargets(); }); cell(tr, null).append(remove);
      body.append(tr);
    }
    if (!body.children.length) { const row = make('tr'); row.append(make('td', 'Changed decisions will appear here.', { colspan: 5 })); body.append(row); }
    $('rs-decisions-summary').textContent = edits.size > 100 ? 'Showing the first 100 decisions. The full draft, editable table, preview and exports contain all ' + edits.size.toLocaleString() + '.' : 'All recorded decisions are shown.';
  }
  function resetDraft(value) {
    concentrations?.discardReport();
    document = documentInput(value); edits.clear(); selected.clear(); targets.clear(); page = null;
    for (const row of document.decisions) if (row.action !== 'keep' || row.reason) edits.set(row.targetId, clone(row));
    preview = null; saved = null; previewVersion = -1; version++; dirty = edits.size > 0; offset = 0; sequence++;
    $('rs-preview-output').hidden = true; $('rs-exports').hidden = true;
    $('rs-new-plan').value = shortName('receiving-plan'); $('rs-review-id').value = shortName('receiving-review');
    renderSource(); renderDraft(); renderStatus();
  }
  function renderSource() {
    $('rs-source-details').replaceChildren();
    for (const [label, value] of [['Source plan', document?.sourcePlanId], ['Source plan SHA-256', document?.sourcePlanSha256],
      ['Original review', source?.reviewId], ['Original capture', source?.captureId]])
      if (value) $('rs-source-details').append(make('dt', label), make('dd', value));
    $('rs-source-heading').textContent = document ? 'Decisions for ' + document.sourcePlanId : 'Choose an immutable source plan';
  }
  async function openSource(planId, imported = null) {
    const found = await api('/api/review-sheets/source/' + encodeURIComponent(planId));
    const sourceHash = found.sourcePlanSha256 ?? found.planSha256;
    if (!/^[a-f0-9]{64}$/.test(sourceHash ?? '')) throw new Error('The source plan identity could not be read.');
    if (imported && (imported.sourcePlanId !== planId || imported.sourcePlanSha256 !== sourceHash))
      throw new Error('This sheet belongs to a different edition of its source plan.');
    source = found;
    resetDraft(imported ?? { schema: SCHEMA, sourcePlanId: planId, sourcePlanSha256: sourceHash, decisions: [] });
    $('rs-source-plan').value = planId; await loadPage(true); await concentrations.loadSource(planId);
  }
  function previewPlan(value) { return value?.plan ?? value?.proposedPlan ?? value?.preview; }
  function renderPreview(value) {
    const proposed = previewPlan(value);
    if (!proposed || !Array.isArray(proposed.results)) throw new Error('The native preview did not return its complete plan.');
    $('rs-preview-output').hidden = false; $('rs-impact').replaceChildren();
    const before = value.before ?? value.beforeSummary ?? {}, after = value.after ?? value.afterSummary ?? proposed.summary ?? {};
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => typeof before[key] === 'number' || typeof after[key] === 'number');
    const table = make('table', null, { class: 'ow-table' }), head = make('thead'), heading = make('tr'), body = make('tbody');
    for (const label of ['Complete plan', 'Before', 'After']) heading.append(make('th', label)); head.append(heading);
    for (const key of keys) { const row = make('tr'); cell(row, human(key)); cell(row, show(before[key])); cell(row, show(after[key])); body.append(row); }
    table.append(head, body); $('rs-impact').append(table);
    const changes = value.changes ?? [], list = $('rs-changes'); list.replaceChildren();
    for (const change of changes.slice(0,100)) {
      const row = make('li');
      row.append(make('strong', change.field ?? change.targetId ?? 'Receiving choice'),
        make('span', ' · ' + (change.beforeChoice?.present ? show(change.beforeChoice.value) : 'Native default') + ' → ' +
          (change.afterChoice?.present ? show(change.afterChoice.value) : 'Native default')),
        make('small', change.reason ?? ''));
      list.append(row);
    }
    $('rs-change-summary').textContent = changes.length.toLocaleString() + ' source-bound choice changes; ' + proposed.results.length.toLocaleString() + ' original selected results remain in the native preview.' + (changes.length > 100 ? ' The first 100 changes are listed here; the full review exports retain every change.' : '');
    const issueCounts = proposed.summary?.issueCounts ?? {};
    $('rs-remaining-issues').textContent = Object.keys(issueCounts).length ? Object.entries(issueCounts).map(([key, count]) => key + ': ' + count).join(' · ') : 'No remaining native receiving issues.';
    renderStatus();
  }
  function renderExports(record) {
    const id = record.reviewId;
    if (!id) throw new Error('The saved decision review did not return its original identifier.');
    const target = $('rs-downloads'); target.replaceChildren();
    const formats = [['csv', 'Editable decision CSV'], ['tsv', 'Editable decision TSV'], ['json', 'Source-bound decision JSON'], ['report', 'Decision review'],
      ['native-locations', 'Location import'], ['native-results', 'Result import'], ['native-crosswalk', 'Complete identity crosswalk'],
      ['native-report', 'Complete receiving report'], ['native-references', 'Receiving reference requirements'],
      ['native-bundle', 'Complete Open Waters project'], ['bundle', 'Portable decision review and full project']];
    for (const [format, label] of formats) target.append(make('a', label, { class: 'download',
      href: '/api/review-sheets/' + encodeURIComponent(id) + '/' + format }));
    $('rs-exports').hidden = false; $('rs-saved-heading').textContent = 'Saved decision review ' + id;
  }
  async function openSaved(reviewId) {
    const record = await api('/api/review-sheets/' + encodeURIComponent(reviewId));
    if (!['COMPLETE', 'PREPARED'].includes(record.status)) throw new Error('This review has no saved or prepared decisions to reopen.');
    await openSource(record.document.sourcePlanId, record.document);
    $('rs-review-id').value = record.reviewId; $('rs-new-plan').value = record.newPlanId;
    if (record.status === 'PREPARED') {
      preview = await api('/api/review-sheets/preview', { document: currentDocument(), newPlanId: record.newPlanId });
      if (preview.previewSha256 !== record.previewSha256) throw new Error('The prepared review no longer matches its original preview. Reopen its source and revise the decisions under new names.');
      previewVersion = version; renderPreview(preview); renderDraft(); renderTargets(); renderStatus();
      notice('Prepared decisions reopened with their original review and plan names. Save resumes the original receiving work.');
      return;
    }
    preview = { ...record, plan: await api('/api/open-waters/' + encodeURIComponent(record.newPlanId)) };
    saved = record; dirty = false; previewVersion = version;
    renderPreview(preview); renderDraft(); renderTargets(); renderExports(record); renderStatus();
    await concentrations.reopen(record);
    notice('Saved decisions, reasons and complete project exports reopened.');
  }
  $('rs-load-form').addEventListener('submit', event => run(async () => { await openSource($('rs-source-plan').value); notice('Source-bound receiving targets opened.'); }, event));
  $('rs-source-plan').addEventListener('change', renderStatus);
  $('rs-source-plan').addEventListener('change', () => { $('rs-load').textContent = active() ? 'Open selected plan as a new draft' : 'Open source plan'; });
  for (const id of ['rs-kind', 'rs-attention']) $(id).addEventListener('change', event => run(() => loadPage(true), event));
  for (const id of ['rs-field', 'rs-search']) $(id).addEventListener('input', () => {
    clearTimeout(searchTimer); searchTimer = setTimeout(() => run(() => loadPage(true)), 220);
  });
  $('rs-previous').addEventListener('click', event => run(async () => { offset = Math.max(0, offset - PAGE); await loadPage(); }, event));
  $('rs-next').addEventListener('click', event => run(async () => { offset += PAGE; await loadPage(); }, event));
  $('rs-select-page').addEventListener('click', () => { for (const row of page?.rows ?? []) selected.set(row.targetId, row); renderTargets(); });
  $('rs-select-filtered').addEventListener('click', event => run(async () => {
    const first = await requestPage(0, SELECTION_PAGE), rows = [...first.rows], signature = query(0, SELECTION_PAGE).toString();
    for (let start = SELECTION_PAGE; start < first.total; start += SELECTION_PAGE) {
      const next = await requestPage(start, SELECTION_PAGE);
      if (next.total !== first.total || query(0, SELECTION_PAGE).toString() !== signature) throw new Error('The filtered source changed. Open it again before selecting all matching targets.');
      rows.push(...next.rows); $('rs-selection-count').textContent = rows.length.toLocaleString() + ' of ' + first.total.toLocaleString() + ' targets read';
    }
    if (rows.length !== first.total || new Set(rows.map(row => row.targetId)).size !== first.total)
      throw new Error('The complete filtered source target set could not be read.');
    for (const row of rows) { selected.set(row.targetId, row); targets.set(row.targetId, row); } renderTargets();
    notice('Selected all ' + rows.length.toLocaleString() + ' matching targets across every page.');
  }, event));
  $('rs-clear-selection').addEventListener('click', () => { selected.clear(); renderTargets(); });
  $('rs-bulk-action').addEventListener('change', renderStatus);
  $('rs-bulk-form').addEventListener('submit', event => run(async () => {
    if (!selected.size) throw new Error('Select the receiving targets to change.');
    const action = $('rs-bulk-action').value, value = $('rs-bulk-value').value, reason = $('rs-bulk-reason').value;
    if (action !== 'keep' && !reason.trim()) throw new Error('Enter the reason for this group of changed choices.');
    if (action === 'set' && new Set([...selected.values()].map(row => row.kind + ':' + row.field)).size !== 1)
      throw new Error('Filter and select one kind of receiving field before setting a common exact value.');
    for (const target of selected.values()) {
      if (action === 'keep') {
        if (reason) edits.set(target.targetId, { targetId: target.targetId, action, reason }); else edits.delete(target.targetId);
      } else edits.set(target.targetId, { targetId: target.targetId, action, ...(action === 'set' ? { value } : {}), reason });
    }
    markChanged(); renderTargets(); notice('Applied the decision to ' + selected.size.toLocaleString() + ' selected targets. Preview checks the complete native plan.');
  }, event));
  $('rs-export-json').addEventListener('click', () => download(JSON.stringify(currentDocument(), null, 2) + '\n', document.sourcePlanId + '-decisions.json'));
  $('rs-export-table').addEventListener('click', event => run(async () => {
    const result = await api('/api/review-sheets/table', { document: currentDocument(), format: $('rs-table-format').value });
    download(result.text, result.filename, result.mime); notice('Complete editable receiving table downloaded with this source plan and current decisions.');
  }, event));
  $('rs-import-form').addEventListener('submit', event => run(async () => {
    const file = $('rs-import-file').files[0]; if (!file) throw new Error('Choose a complete decision JSON, CSV or TSV table.');
    if (file.size > 64 * 1024 * 1024) throw new Error('This editable decision file exceeds 64 MiB.');
    const text = await file.text();
    const tabular = /\.(csv|tsv)$/i.exec(file.name);
    const imported = documentInput(tabular ? await api('/api/review-sheets/import-table', { text, format: tabular[1].toLowerCase() }) : JSON.parse(text));
    await openSource(imported.sourcePlanId, imported); notice('The complete decision file is loaded against its original source plan. Preview checks every changed choice.');
  }, event));
  $('rs-new-plan').addEventListener('input', markChanged);
  $('rs-preview-form').addEventListener('submit', event => run(async () => {
    const requested = version, value = await api('/api/review-sheets/preview', { document: currentDocument(), newPlanId: $('rs-new-plan').value });
    preview = value; previewVersion = requested; renderPreview(value); notice('Complete native receiving preview generated from the original plan and every recorded decision.');
  }, event));
  $('rs-show-preview').addEventListener('click', event => run(async () => {
    if (!currentPreview()) throw new Error('Update the preview before opening it.');
    await openPlan(previewPlan(preview));
  }, event));
  $('rs-save').addEventListener('click', event => run(async () => {
    if (!currentPreview()) throw new Error('Update the full receiving preview before saving.');
    const record = await api('/api/review-sheets', { reviewId: $('rs-review-id').value, document: currentDocument(),
      newPlanId: $('rs-new-plan').value, expectedPreviewSha256: preview.previewSha256 });
    saved = record; dirty = false; renderDraft(); renderTargets(); renderExports(record); await refresh(); await concentrations.reopen(record); notice('Saved the original decisions, reasons and complete new receiving plan as ' + record.reviewId + '.');
  }, event));
  $('rs-revise').addEventListener('click', event => run(async () => {
    const original = currentDocument(); resetDraft(original); await loadPage(true); notice('A new decision draft retains the saved choices and has fresh review and plan names.');
  }, event));
  $('rs-open-saved').addEventListener('click', event => run(() => openSaved($('rs-saved-review').value), event));
  $('rs-saved-review').addEventListener('change', renderStatus);
  $('rs-receive-form').addEventListener('submit', event => run(async () => {
    const file = $('rs-receive-file').files[0]; if (!file) throw new Error('Choose a complete portable decision-review bundle.');
    if (file.size > 128 * 1024 * 1024) throw new Error('This full receiving bundle exceeds 128 MiB.');
    const record = await api('/api/review-sheets/receive', { bundle: JSON.parse(await file.text()) });
    await refresh(true); await openSaved(record.reviewId); notice('The complete source project, decision review and resulting plan have been received and reopened.');
  }, event));
  concentrations = mountConcentrations({ api, notice, run,
    context: (fullDocument = false) => ({ document: active() ? (fullDocument ? currentDocument() : {sourcePlanId:document.sourcePlanId, sourcePlanSha256:document.sourcePlanSha256}) : null, version, busy, saved: Boolean(saved),
      selectedResultIds: [...new Set([...selected.values()].filter(row => row.kind === 'result').map(row => row.sourceKey))] }),
    applyDocument: async value => {
      if (saved) throw new Error('Revise the saved review in a new plan before changing units.');
      const next = documentInput(value);
      if (next.sourcePlanId !== document.sourcePlanId || next.sourcePlanSha256 !== document.sourcePlanSha256)
        throw new Error('The unit choices belong to another source plan.');
      edits.clear(); for (const row of next.decisions) edits.set(row.targetId, clone(row));
      markChanged(); await loadPage();
    }
  });
  for (const [value, label] of KINDS) option($('rs-kind'), value, label);
  renderStatus(); renderDraft();
  return { update(next) {
    workspace = next;
    const planId = $('rs-source-plan').value, reviewId = $('rs-saved-review').value;
    $('rs-source-plan').replaceChildren(); option($('rs-source-plan'), '', 'Select an immutable receiving plan');
    for (const plan of workspace.openWaters ?? []) option($('rs-source-plan'), plan.planId, plan.planId + ' · ' + plan.reviewId);
    if ([...$('rs-source-plan').options].some(row => row.value === planId)) $('rs-source-plan').value = planId;
    else if (!active() && workspace.openWaters?.length === 1) $('rs-source-plan').value = workspace.openWaters[0].planId;
    $('rs-saved-review').replaceChildren(); option($('rs-saved-review'), '', 'Select a saved decision review');
    for (const review of workspace.reviewSheets ?? []) option($('rs-saved-review'), review.reviewId, review.reviewId + ' · ' + (review.newPlanId ?? review.planId ?? ''));
    if ([...$('rs-saved-review').options].some(row => row.value === reviewId)) $('rs-saved-review').value = reviewId;
    else if (saved) $('rs-saved-review').value = saved.reviewId;
    renderStatus();
  }};
}
