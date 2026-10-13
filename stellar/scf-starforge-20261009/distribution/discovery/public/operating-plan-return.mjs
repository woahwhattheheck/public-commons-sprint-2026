// MIT. Review original saved procedure returns and receive the selected result in the same plans store.
import { inspectOperatingPlan } from '/operating-return-core/operating-plan.mjs';
import { createOperatingPlanReturn, inspectOperatingPlanReturn, compareOperatingPlanReturn,
  reviseOperatingPlanReturn, decideOperatingPlanReturn, applyOperatingPlanReturn,
  renderOperatingPlanReturnHTML, OPERATING_RETURN_MAX_BYTES, OPERATING_RETURN_PLAN_MAX_BYTES } from '/operating-return-core/operating-plan-return.mjs';

import { inspectOperatingReturnWorking, renderOperatingReturnWorkbook, OPERATING_RETURN_WORKBOOK_ASSETS,
  OPERATING_RETURN_WORKING_SCHEMA, OPERATING_RETURN_WORKING_MAX_BYTES } from '/operating-return-core/operating-plan-return-workbook.mjs';

const $ = id => document.getElementById(id), clone = value => JSON.parse(JSON.stringify(value));
const WORKING_SCHEMA = OPERATING_RETURN_WORKING_SCHEMA;
const WORKING_MAX_BYTES = OPERATING_RETURN_WORKING_MAX_BYTES, PAGE_SIZE = 20;
const offline = globalThis.__operatingReturnWorkbook ?? null;
let memoryOnly = false, workbookAssets = offline?.sources ?? null, lastPortable = null;
const memoryReviews = new Map();
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const display = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
let plansDB, reviewsDB, ready = false, busy = false, currentSource = null, incomingSource = null;
let sourceDestination = { kind: 'file' }, state = null, report = null, page = 1;
let saveTimer, saveChain = Promise.resolve(), pendingSaves = 0, lastSaveFailed = false;
const broadcast = !offline && typeof BroadcastChannel === 'function' ? new BroadcastChannel('starforge-operating-plans-v1') : null;
function node(tag, content, className) {
  const result = document.createElement(tag);
  if (content !== undefined) result.textContent = content;
  if (className) result.className = className;
  return result;
}
function message(value) { $('return-status').textContent = value; }
function error(value) {
  $('return-error').hidden = !value;
  $('return-error').textContent = value ? (value.code ? value.code + ': ' : '') + value.message : '';
}
function openDB(name, configure) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onupgradeneeded = () => configure(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => message('Close an older workspace tab to finish opening saved work.');
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        if (offline) useMemoryStorage(); else ready = false;
        renderControls();
        error(new Error('Saved storage changed. Download the working review, then reopen this page.'));
      };
      resolve(request.result);
    };
  });
}
function transaction(database, stores, mode, action) {
  if (!database) return Promise.reject(new Error('Saved browser storage is unavailable.'));
  return new Promise((resolve, reject) => {
    const tx = database.transaction(stores, mode);
    let result, failure;
    const abort = value => { failure = value; try { tx.abort(); } catch {} };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('The storage operation was interrupted.'));
    tx.onerror = () => {};
    try { action(tx, value => { result = value; }, abort); } catch (value) { abort(value); }
  });
}
function getPlan(id) {
  return transaction(plansDB, ['plans'], 'readonly', (tx, done) => {
    tx.objectStore('plans').get(id).onsuccess = event => done(event.target.result ?? null);
  });
}
function useMemoryStorage() {
  if (!offline) return;
  if (state) memoryReviews.set(state.persistence.key, {
    ...snapshot(), key: state.persistence.key, version: state.persistence.version,
  });
  memoryOnly = true;
  try { reviewsDB?.close(); } catch {}
  reviewsDB = null;
  $('draft-status').textContent = 'Browser storage is unavailable. Download the editable workbook or Working review JSON to retain current work.';
}
function saveMemoryReview(captured, persistence) {
  const existing = memoryReviews.get(persistence.key), version = existing?.version ?? null;
  const forked = version !== persistence.version || !existing && persistence.version !== null;
  const key = forked ? crypto.randomUUID() : persistence.key, nextVersion = crypto.randomUUID();
  memoryReviews.set(key, { ...clone(captured), key, version: nextVersion });
  return { key, version: nextVersion, forked };
}
function getReview(key) {
  if (memoryOnly) return Promise.resolve(clone(memoryReviews.get(key) ?? null));
  return transaction(reviewsDB, ['reviews'], 'readonly', (tx, done) => {
    tx.objectStore('reviews').get(key).onsuccess = event => done(event.target.result ?? null);
  }).then(value => {
    if (value) memoryReviews.set(value.key, clone(value)); return value;
  }).catch(value => {
    if (!offline) throw value;
    useMemoryStorage(); return clone(memoryReviews.get(key) ?? null);
  });
}
async function reviewRecords() {
  if (memoryOnly) return [...memoryReviews.values()].map(clone);
  return transaction(reviewsDB, ['reviews'], 'readonly', (tx, done) => {
    const rows = []; tx.objectStore('reviews').openCursor().onsuccess = event => {
      const cursor = event.target.result; if (!cursor) { done(rows); return; }
      rows.push(cursor.value); cursor.continue();
    };
  }).then(rows => {
    for (const value of rows) memoryReviews.set(value.key, clone(value)); return rows;
  }).catch(value => {
    if (!offline) throw value;
    useMemoryStorage(); return [...memoryReviews.values()].map(clone);
  });
}
async function refreshShelves() {
  const planRows = offline ? [] : await transaction(plansDB, ['plans'], 'readonly', (tx, done) => {
    const rows = [];
    tx.objectStore('plans').openCursor().onsuccess = event => {
      const cursor = event.target.result;
      if (!cursor) { done(rows); return; }
      const value = cursor.value, last = value?.revisions?.at(-1);
      if (typeof value?.id === 'string' && last) rows.push({ id: value.id,
        label: last.title + ' · ' + (last.customer || 'Customer procedure') + ' · r' + value.revisions.length,
        savedAt: last.savedAt });
      cursor.continue();
    };
  });
  const reviewRows = (await reviewRecords()).map(value => ({
    key: value.key, title: value.title, updatedAt: value.updatedAt,
    completed: Boolean(value.review?.completion), pending: Object.keys(value.buffers ?? {}).length,
  }));
  const selectedPlan = $('saved-plan').value, selectedReview = state?.key ?? $('saved-review').value;
  $('saved-plan').replaceChildren(new Option('Choose a saved procedure', ''));
  for (const row of planRows.sort((a, b) => b.savedAt.localeCompare(a.savedAt)))
    $('saved-plan').append(new Option(row.label, row.id));
  if (planRows.some(row => row.id === selectedPlan)) $('saved-plan').value = selectedPlan;
  $('saved-review').replaceChildren(new Option('Choose a retained review', ''));
  for (const row of reviewRows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
    $('saved-review').append(new Option(row.title + ' · ' + (row.completed ? 'completed' : 'working') +
      (row.pending ? ' · unfinished choices' : '') + ' · ' + new Date(row.updatedAt).toLocaleString(), row.key));
  if (reviewRows.some(row => row.key === selectedReview)) $('saved-review').value = selectedReview;
  renderControls();
}
function portableWorking() {
  if (!state) throw new Error('Prepare or open a review first.');
  return { schema: WORKING_SCHEMA, review: clone(state.review), details: clone(state.details), buffers: clone(state.buffers) };
}
function serialized(value, maximum = WORKING_MAX_BYTES) {
  const body = JSON.stringify(value, null, 2) + '\n';
  if (new Blob([body]).size > maximum) throw new TypeError('The complete document exceeds its file size limit.');
  return body;
}
function snapshot() {
  const work = portableWorking(); serialized(work);
  return { ...work, key: state.key, reviewId: state.review.id,
    title: state.review.current.revisions.at(-1).title, updatedAt: new Date().toISOString(),
    destination: clone(state.destination), applied: state.applied,
    ...(offline ? { workbookId: offline.id } : {}) };
}
async function saveNow() {
  clearTimeout(saveTimer); saveTimer = undefined;
  if (!state) return saveChain;
  const captured = snapshot(), persistence = state.persistence;
  pendingSaves++; $('draft-status').textContent = 'Saving working review…';
  const pending = saveChain.catch(() => {}).then(async () => {
    const saved = memoryOnly ? saveMemoryReview(captured, persistence) : await transaction(reviewsDB, ['reviews'], 'readwrite', (tx, done) => {
      const records = tx.objectStore('reviews'), request = records.get(persistence.key);
      request.onsuccess = () => {
        const existing = request.result, version = existing?.version ?? null;
        const forked = version !== persistence.version || !existing && persistence.version !== null;
        const key = forked ? crypto.randomUUID() : persistence.key, nextVersion = crypto.randomUUID();
        records.put({ ...captured, key, version: nextVersion });
        done({ key, version: nextVersion, forked });
      };
    }).catch(value => {
      if (!offline) throw value;
      useMemoryStorage(); return saveMemoryReview(captured, persistence);
    });
    memoryReviews.set(saved.key, { ...clone(captured), key: saved.key, version: saved.version });
    persistence.key = saved.key; persistence.version = saved.version;
    if (state?.persistence === persistence) state.key = saved.key;
    if (saved.forked) {
      message('Another tab saved this review. Both versions are retained separately; continue your working copy here.');
      await refreshShelves();
    }
    return saved;
  });
  saveChain = pending;
  pending.then(() => {
    lastSaveFailed = false;
    if (state?.persistence === persistence && pendingSaves === 1)
      $('draft-status').textContent = memoryOnly
        ? 'Working review is open in this tab. Download the editable workbook or Working review JSON before closing.'
        : 'Working review retained at ' + new Date(captured.updatedAt).toLocaleTimeString() + '.';
  }, value => {
    lastSaveFailed = true;
    $('draft-status').textContent = 'This latest work is still open. Download Working review JSON to retain it.';
    error(value);
  }).finally(() => { pendingSaves--; });
  return pending;
}
function queueSave() {
  clearTimeout(saveTimer);
  $('draft-status').textContent = 'Working changes waiting to save…';
  saveTimer = setTimeout(() => { saveTimer = undefined; saveNow().catch(() => {}); }, 220);
}
async function run(action) {
  if (busy) return;
  busy = true; error(null); renderControls();
  try { await action(); }
  catch (value) { error(value); }
  finally { busy = false; renderControls(); }
}
function blankView() {
  report = null;
  $('review-identity').textContent = 'Prepare or open a review to continue.';
  $('reviewer').value = ''; $('review-notes').value = '';
  $('comparison-summary').textContent = '';
  $('review-issues').replaceChildren(); $('change-rows').replaceChildren();
  $('proposed-procedure').replaceChildren(); $('proposal-state').textContent = '';
  $('destination').textContent = ''; $('completion-status').textContent = '';
  $('change-page').textContent = '';
}
function renderSources() {
  $('current-source').textContent = currentSource
    ? currentSource.revisions.at(-1).title + ' · ' + currentSource.id + ' · r' + currentSource.revisions.length +
      (sourceDestination.kind === 'saved-plan' ? ' · saved at this browser address' : ' · complete file')
    : 'Select the procedure you are continuing.';
  $('incoming-source').textContent = incomingSource
    ? incomingSource.revisions.at(-1).title + ' · ' + incomingSource.id + ' · r' + incomingSource.revisions.length
    : 'Select the other operator’s complete saved plan.';
}
function filteredRows() {
  if (!report) return [];
  const filter = $('change-filter').value, query = $('change-search').value.trim().toLocaleLowerCase();
  return report.rows.filter(row =>
    (filter !== 'unresolved' || report.unresolved.includes(row.key) || report.issues.some(issue => issue.key === row.key)) &&
    (filter !== 'conflicts' || row.conflict) && (filter !== 'edited' || Object.hasOwn(state.buffers, row.key)) &&
    (!query || (row.label + ' ' + row.key).toLocaleLowerCase().includes(query)));
}
function renderControls() {
  document.querySelectorAll('button,input,select,textarea').forEach(element => { element.disabled = busy || !ready; });
  const editable = Boolean(state && !state.review.completion);
  $('load-current').disabled ||= Boolean(offline) || !$('saved-plan').value;
  $('saved-plan').disabled ||= Boolean(offline);
  $('prepare-return').disabled ||= !currentSource || !incomingSource;
  $('open-review').disabled ||= !$('saved-review').value;
  $('refresh-current').disabled ||= Boolean(offline) || !state;
  for (const id of ['reviewer', 'review-notes', 'save-details']) $(id).disabled ||= !editable;
  for (const id of ['download-working', 'download-review', 'download-html', 'change-filter', 'change-search'])
    $(id).disabled ||= !state;
  const pending = state ? Object.keys(state.buffers).length : 0;
  $('download-workbook').disabled = busy || !state;
  if ($('recover-embedded-working')) $('recover-embedded-working').disabled = false;
  $('download-working').disabled = busy || !state; // Memory recovery remains available if saved storage closes.
  $('download-review').disabled ||= Boolean(pending);
  $('download-html').disabled ||= Boolean(pending);
  document.querySelectorAll('[data-choice-editor]').forEach(element => { element.disabled ||= !editable; });
  $('download-plan').disabled ||= !state?.review.completion;
  const canComplete = state && (state.review.completion || report && report.unresolved.length === 0 &&
    report.issues.every(issue => issue.key === '/reviewer') && state.details.reviewer.trim() && pending === 0);
  $('complete-return').disabled ||= !canComplete;
  const total = filteredRows().length, pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  $('previous-page').disabled ||= !state || page <= 1;
  $('next-page').disabled ||= !state || page >= pages;
}
function editorBuffer(row) {
  if (state.buffers[row.key]) return state.buffers[row.key];
  const decision = state.review.decisions.find(item => item.key === row.key);
  return { take: decision?.take ?? 'automatic', note: decision?.note ?? '',
    custom: display(decision?.take === 'custom' ? decision.value : row.value) };
}
function setBuffer(key, patch) {
  const row = report.rows.find(item => item.key === key);
  state.buffers[key] = { ...editorBuffer(row), ...patch };
  queueSave(); renderControls();
}
function parseCustom(row, raw) {
  if (typeof row.current === 'string' && typeof row.base === 'string' && typeof row.incoming === 'string') return raw;
  return JSON.parse(raw);
}
function renderRows() {
  const openKeys = new Set([...document.querySelectorAll('.change[open]')].map(element => element.dataset.key));
  const matching = filteredRows(), pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  page = Math.min(Math.max(1, page), pages);
  $('change-page').textContent = matching.length + ' displayed changes · page ' + page + ' of ' + pages;
  const content = document.createDocumentFragment();
  for (const row of matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)) {
    const item = node('details', undefined, 'change'); item.dataset.key = row.key; item.dataset.conflict = String(row.conflict);
    item.open = openKeys.has(row.key) || report.unresolved.includes(row.key) || Object.hasOwn(state.buffers, row.key);
    const summary = node('summary', row.label);
    summary.append(node('span', report.unresolved.includes(row.key) ? 'Review required' :
      row.reviewed ? 'Reviewed' : 'Proposed', 'badge'));
    item.append(summary, node('p', row.key, 'key'));
    if (row.reason) item.append(node('p', row.reason, 'text'));
    const values = node('div', undefined, 'values');
    for (const [key, title] of [['base', 'Shared saved revision'], ['current', 'Current work'], ['incoming', 'Returned work']]) {
      const section = node('section'); section.append(node('h3', title), node('pre', display(row[key]))); values.append(section);
    }
    item.append(values);
    if (row.kind === 'step-order') {
      item.append(node('p', 'A source order keeps its listed positions, then places other included steps at the end. The complete proposed sequence below must include every selected step.', 'hint'));
      for (const [key, title] of [['current', 'Current order with all included work'], ['incoming', 'Returned order with all included work'], ['base', 'Shared order with all included work']]) {
        const detail = node('details'); detail.append(node('summary', title), node('pre', display(row.alternatives[key]))); item.append(detail);
      }
    }
    if (row.stale) item.append(node('p', 'The included work changed after this order was reviewed. Choose its complete sequence again.', 'text'),
      node('pre', 'Previously reviewed:\n' + display(row.reviewedOrder)));
    const buffer = editorBuffer(row), choiceLabel = node('label', 'Selected change'), choice = node('select');
    choice.dataset.choiceEditor = 'true';
    for (const [value, title] of [['automatic', 'Use proposal · remove recorded decision'], ['current', 'Keep current work'],
      ['incoming', 'Use returned work'], ['base', 'Use shared saved value'], ['custom', 'Enter a reviewed value']])
      choice.append(new Option(title, value));
    choice.value = buffer.take; choiceLabel.append(choice); item.append(choiceLabel);
    const customLabel = node('label', typeof row.current === 'string' && typeof row.base === 'string' && typeof row.incoming === 'string'
      ? 'Reviewed text' : 'Reviewed JSON value');
    const custom = node('textarea', undefined, 'custom'); custom.dataset.choiceEditor = 'true';
    custom.value = buffer.custom; custom.spellcheck = false; custom.maxLength = OPERATING_RETURN_PLAN_MAX_BYTES; customLabel.append(custom);
    customLabel.hidden = buffer.take !== 'custom'; item.append(customLabel);
    const noteLabel = node('label', 'Decision note'), note = node('textarea'); note.dataset.choiceEditor = 'true';
    note.rows = 3; note.maxLength = 32000; note.value = buffer.note; noteLabel.append(note); item.append(noteLabel);
    const actions = node('div', undefined, 'actions'), record = node('button', 'Record this choice'), discard = node('button', 'Discard pending edits');
    record.type = discard.type = 'button'; record.dataset.choiceEditor = discard.dataset.choiceEditor = 'true';
    actions.append(record, discard); item.append(actions);
    choice.addEventListener('change', () => {
      setBuffer(row.key, { take: choice.value }); customLabel.hidden = choice.value !== 'custom';
    });
    custom.addEventListener('input', () => setBuffer(row.key, { custom: custom.value }));
    note.addEventListener('input', () => setBuffer(row.key, { note: note.value }));
    record.addEventListener('click', () => run(async () => {
      const edited = editorBuffer(row);
      if (edited.take === 'automatic' && edited.note.trim())
        throw new TypeError('Choose a source or custom value to retain this decision note. Use an empty note when removing the recorded choice.');
      const decision = edited.take === 'automatic' ? null : { take: edited.take, note: edited.note,
        ...(edited.take === 'custom' ? { value: parseCustom(row, edited.custom) } : {}) };
      state.review = decideOperatingPlanReturn(state.review, row.key, decision);
      delete state.buffers[row.key]; await saveNow(); renderReview(); await refreshShelves();
      message('Choice recorded with this review’s original sources.');
    }));
    discard.addEventListener('click', () => run(async () => {
      delete state.buffers[row.key]; await saveNow(); renderReview(); message('Pending edits for this choice were discarded.');
    }));
    const result = node('div', undefined, 'recorded');
    result.append(node('h3', row.reviewed ? 'Recorded choice: ' + row.take : 'Proposed choice: ' + row.take),
      node('pre', display(row.value)));
    if (row.note) result.append(node('p', row.note, 'text'));
    const rowIssues = report.issues.filter(issue => issue.key === row.key);
    for (const issue of rowIssues) result.append(node('p', issue.message, 'text'));
    item.append(result); content.append(item);
  }
  if (!matching.length) content.append(node('p', report.rows.length ? 'No changes match this view.' : 'Both procedures have identical selected content.'));
  $('change-rows').replaceChildren(content);
}
function renderProcedure() {
  const content = report.draft.content, fragment = document.createDocumentFragment(), metadata = node('dl', undefined, 'procedure-meta');
  for (const [key, label] of [['title', 'Procedure'], ['customer', 'Customer'], ['purpose', 'Useful result'], ['period', 'Period'],
    ['owner', 'Owner'], ['receiving', 'Receiving'], ['notes', 'Notes']]) {
    metadata.append(node('dt', label), node('dd', display(content[key])));
  }
  fragment.append(metadata);
  content.steps.forEach((step, index) => {
    const item = node('details', undefined, 'proposed-step');
    item.append(node('summary', (index + 1) + '. ' + step.title + ' · ' + step.status));
    const data = node('dl', undefined, 'procedure-meta');
    for (const [key, label] of [['owner', 'Owner'], ['due', 'Due'], ['instruction', 'Work'], ['inputs', 'Inputs'],
      ['expectedResult', 'Expected result'], ['recordedResult', 'Recorded result']])
      data.append(node('dt', label), node('dd', display(step[key])));
    item.append(data, node('h3', 'Selected arguments'), node('pre', display(step.argv)));
    if (step.selection) item.append(node('h3', 'Complete original registration'), node('pre', display(step.selection)));
    fragment.append(item);
  });
  $('proposed-procedure').replaceChildren(fragment);
  $('proposal-state').textContent = report.ready ? 'Every conflicting change is resolved. Review the complete operating order and work before receiving it.' :
    'This preview includes provisional values for unresolved changes. The recorded review retains every original value.';
}
function renderReview() {
  renderSources();
  if (!state) { blankView(); renderControls(); return; }
  report = compareOperatingPlanReturn(state.review);
  $('review-identity').textContent = 'Review ' + state.review.id + ' · Shared revision ' + report.commonRevision +
    ' · Current r' + report.currentRevision + ' · Returned r' + report.incomingRevision +
    (report.relationship === 'returned-copy' ? ' · returned copy of the original procedure' : '');
  $('reviewer').value = state.details.reviewer; $('review-notes').value = state.details.notes;
  $('comparison-summary').textContent = report.summary.changes + ' changed items · ' + report.summary.conflicts +
    ' conflicts · ' + report.unresolved.length + ' unresolved choices · ' + report.summary.steps + ' proposed steps';
  const issues = report.issues.map(issue => node('li', issue.message));
  if (Object.keys(state.buffers).length) issues.unshift(node('li', Object.keys(state.buffers).length +
    ' choices have pending edits. Record them or retain the full Working review JSON.'));
  $('review-issues').replaceChildren(...issues);
  renderRows(); renderProcedure();
  const saved = state.destination.kind === 'saved-plan';
  $('destination').textContent = saved
    ? 'The result continues the saved original procedure at this browser address. Its complete review is retained before the plan transaction. Other editor drafts stay available in Operating plans.'
    : 'The result downloads as the original complete operating-plan JSON. Receive it through Operating plans or the original Grant Operations workflow, and keep the complete review alongside it.';
  $('complete-return').textContent = state.review.completion
    ? saved ? 'Resume save to Operating plans' : 'Download reviewed plan'
    : saved ? 'Complete review and save procedure' : 'Complete review and download plan';
  $('completion-status').textContent = state.review.completion
    ? 'Completed review retained · result revision ' + state.review.completion.plan.revisions.length +
      (state.applied ? ' · saved in the original procedure' : '') : '';
  renderControls();
}
function commitDetails() {
  if (!state || state.review.completion) return;
  state.review = reviseOperatingPlanReturn(state.review, clone(state.details));
}
async function activate(review, { buffers = {}, details, destination = { kind: 'file' }, key = crypto.randomUUID(), applied = false, version = null } = {}) {
  state = { key, persistence: { key, version }, review: inspectOperatingPlanReturn(review), buffers: clone(buffers),
    details: details ? clone(details) : { reviewer: review.reviewer, notes: review.notes }, destination: clone(destination), applied };
  currentSource = clone(state.review.current); incomingSource = clone(state.review.incoming);
  sourceDestination = clone(destination); page = 1; $('change-filter').value = 'all'; $('change-search').value = '';
  renderReview(); await saveNow(); await refreshShelves();
}
async function readJSON(file, maximum) {
  if (!file || file.size > maximum) throw new TypeError('Choose a complete JSON file within the stated size limit.');
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > maximum) throw new TypeError('The selected JSON exceeds its size limit.');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
function working(value) { return inspectOperatingReturnWorking(value); }
async function loadWorkbookAssets() {
  if (workbookAssets) return workbookAssets;
  const entries = await Promise.all(OPERATING_RETURN_WORKBOOK_ASSETS.map(async asset => {
    const response = await fetch(asset.route, { cache: 'no-store', redirect: 'error', credentials: 'same-origin' });
    if (!response.ok) throw new Error('The installed workbook source is unavailable: ' + asset.file);
    const body = await response.text();
    if (new Blob([body]).size > 4 * 1024 * 1024) throw new Error('The installed workbook source exceeds its complete-file limit.');
    return [asset.key, body];
  }));
  workbookAssets = Object.fromEntries(entries); return workbookAssets;
}
function download(filename, value, type = 'application/json') {
  const body = typeof value === 'string' ? value : serialized(value);
  const url = URL.createObjectURL(new Blob([body], { type: type + ';charset=utf-8' }));
  const link = node('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function filename(suffix) { return state.review.id + '-' + suffix; }
async function resetSources(current, incoming, destination) {
  await saveNow();
  state = null; currentSource = current; incomingSource = incoming; sourceDestination = destination;
  clearTimeout(saveTimer); renderReview(); message('Sources selected. Prepare the complete comparison to begin a new review.');
}
$('load-current').addEventListener('click', () => {
  const id = $('saved-plan').value;
  run(async () => {
    const saved = await getPlan(id);
    if (!saved) throw new Error('The selected saved procedure is unavailable.');
    await resetSources(inspectOperatingPlan(saved), incomingSource, { kind: 'saved-plan', id });
  });
});
$('current-file').addEventListener('change', event => {
  const file = event.target.files[0]; event.target.value = '';
  if (file) run(async () => resetSources(inspectOperatingPlan(await readJSON(file, OPERATING_RETURN_PLAN_MAX_BYTES)),
    incomingSource, { kind: 'file' }));
});
$('incoming-file').addEventListener('change', event => {
  const file = event.target.files[0]; event.target.value = '';
  if (file) run(async () => resetSources(currentSource,
    inspectOperatingPlan(await readJSON(file, OPERATING_RETURN_PLAN_MAX_BYTES)), clone(sourceDestination)));
});
$('prepare-return').addEventListener('click', () => run(async () => {
  await saveNow();
  const review = createOperatingPlanReturn(currentSource, incomingSource, { id: crypto.randomUUID() });
  await activate(review, { destination: sourceDestination });
  message('Both complete histories are retained. Review compatible and conflicting changes below.');
}));
$('saved-plan').addEventListener('change', renderControls);
$('saved-review').addEventListener('change', renderControls);
$('open-review').addEventListener('click', () => {
  const key = $('saved-review').value;
  run(async () => {
    await saveNow(); const saved = await getReview(key);
    if (!saved) throw new Error('The retained review is unavailable.');
    const selected = working({ schema: WORKING_SCHEMA, review: saved.review, buffers: saved.buffers, details: saved.details });
    await activate(selected.review, { ...selected, destination: saved.destination, key: saved.key, applied: saved.applied, version: saved.version ?? null });
    message('Retained review reopened with its complete original sources and pending editors.');
  });
});
$('review-file').addEventListener('change', event => {
  const file = event.target.files[0]; event.target.value = '';
  if (file) run(async () => {
    const selected = working(await readJSON(file, WORKING_MAX_BYTES));
    await saveNow();
    await activate(selected.review, selected);
    message('The complete imported review is retained as a separate local review. Its original review identity stays intact.');
  });
});
$('refresh-current').addEventListener('click', () => run(async () => {
  await saveNow();
  const previous = clone(state), actual = await getPlan(state.review.current.id);
  if (!actual) throw new Error('This browser has no saved original procedure with that identity. Choose the latest complete current-plan file to prepare a new review.');
  const review = createOperatingPlanReturn(inspectOperatingPlan(actual), previous.review.incoming, {
    id: crypto.randomUUID(), reviewer: previous.details.reviewer,
    notes: previous.details.notes,
  });
  await activate(review, { destination: { kind: 'saved-plan', id: actual.id } });
  message('A new comparison uses the latest saved procedure. The previous complete review and pending choices remain in Retained reviews.');
}));
for (const [id, field] of [['reviewer', 'reviewer'], ['review-notes', 'notes']])
  $(id).addEventListener('input', () => { if (state) { state.details[field] = $(id).value; queueSave(); renderControls(); } });
$('save-details').addEventListener('click', () => run(async () => {
  commitDetails(); await saveNow(); renderReview(); await refreshShelves(); message('Review details recorded.');
}));
for (const id of ['change-filter', 'change-search'])
  $(id).addEventListener(id === 'change-search' ? 'input' : 'change', () => { page = 1; renderRows(); renderControls(); });
$('previous-page').addEventListener('click', () => { page--; renderRows(); renderControls(); });
$('next-page').addEventListener('click', () => { page++; renderRows(); renderControls(); });
$('download-working').addEventListener('click', () => run(async () => {
  const work = portableWorking(); download(filename('working.json'), work); lastPortable = JSON.stringify(work);
  message('Working review downloaded with every unfinished choice editor.');
}));
$('download-workbook').addEventListener('click', () => run(async () => {
  const work = portableWorking(), sources = await loadWorkbookAssets();
  download(filename('workbook.html'), renderOperatingReturnWorkbook(work, sources), 'text/html');
  lastPortable = JSON.stringify(work);
  message('Editable offline workbook downloaded with the complete review, all file bytes and unfinished choice editors.');
}));
$('download-review').addEventListener('click', () => run(async () => {
  if (Object.keys(state.buffers).length) throw new Error('Record pending choices first, or download the full Working review JSON.');
  commitDetails(); await saveNow(); download(filename('review.json'), state.review);
  renderReview(); message('Complete editable review downloaded with both original histories.');
}));
$('download-html').addEventListener('click', () => run(async () => {
  if (Object.keys(state.buffers).length) throw new Error('Record pending choices first, or download the full Working review JSON.');
  commitDetails(); await saveNow(); download(filename('review.html'), renderOperatingPlanReturnHTML(state.review), 'text/html');
  renderReview(); message('Readable review downloaded with the complete editable source document.');
}));
$('download-plan').addEventListener('click', () => run(async () => {
  const review = inspectOperatingPlanReturn(state.review);
  if (!review.completion) throw new Error('Complete the review before downloading the reviewed procedure.');
  download(filename('plan.json'), review.completion.plan);
  message('Reviewed operating plan downloaded in its original complete format.');
}));
$('complete-return').addEventListener('click', () => run(async () => {
  if (Object.keys(state.buffers).length) throw new Error('Record or discard each pending choice before completing this review.');
  commitDetails();
  const intended = applyOperatingPlanReturn(state.review);
  state.review = intended.review; state.details = { reviewer: intended.review.reviewer, notes: intended.review.notes };
  await saveNow(); // The complete intended result is durable before touching the original plan store.
  if (state.destination.kind === 'saved-plan') {
    const completed = clone(state.review);
    const received = await transaction(plansDB, ['plans'], 'readwrite', (tx, done, abort) => {
      const store = tx.objectStore('plans'), request = store.get(completed.current.id);
      request.onsuccess = () => {
        try {
          if (!request.result) throw new Error('The saved original procedure is unavailable. The complete review and result remain retained.');
          const result = applyOperatingPlanReturn(completed, { current: request.result });
          if (!result.alreadyPresent) store.put(result.plan);
          done(result);
        } catch (value) { abort(value); }
      };
    });
    state.applied = true; await saveNow();
    broadcast?.postMessage({ id: received.plan.id, revision: received.plan.revisions.length });
    message(received.alreadyPresent ? 'The reviewed result is already included in current revision ' + received.plan.revisions.length + '.' :
      'Reviewed work saved as original procedure revision ' + received.plan.revisions.length + '.');
  } else {
    download(filename('plan.json'), state.review.completion.plan);
    message('Review completed and retained. The original-format operating plan was downloaded.');
  }
  renderReview(); await refreshShelves();
}));
window.addEventListener('beforeunload', event => {
  if (pendingSaves || saveTimer || lastSaveFailed || memoryOnly && state && JSON.stringify(portableWorking()) !== lastPortable) { event.preventDefault(); event.returnValue = ''; }
});
if (broadcast) broadcast.onmessage = event => {
  if (state && event.data?.id === state.review.current.id) {
    message('The saved original procedure changed in another tab. Complete reviews compare the actual saved history before receiving work.');
    if (!busy) refreshShelves().catch(error);
  }
};
(async () => {
  try {
    if (offline) {
      $('saved-plan').closest('section').querySelector('label[for="saved-plan"]').hidden = true;
      for (const id of ['saved-plan', 'load-current', 'refresh-current']) $(id).hidden = true;
      let storageError = null;
      try {
        reviewsDB = await openDB('starforge-operating-plan-return-workbooks-v1', db => {
          const reviews = db.createObjectStore('reviews', { keyPath: 'key' }); reviews.createIndex('reviewId', 'reviewId');
        });
      } catch (value) { useMemoryStorage(); storageError = value; }
      ready = true;
      const candidates = (await reviewRecords()).filter(row => row.workbookId === offline.id)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const saved = candidates[0], selected = working(saved
        ? { schema: WORKING_SCHEMA, review: saved.review, buffers: saved.buffers, details: saved.details }
        : offline.working);
      await activate(selected.review, { ...selected, destination: { kind: 'file' },
        ...(saved ? { key: saved.key, version: saved.version ?? null } : {}) });
      lastPortable = JSON.stringify(portableWorking());
      message(memoryOnly
        ? 'Offline workbook opened. Browser storage is unavailable; download the editable workbook to keep each working edition.'
        : saved ? 'Your latest retained work for this workbook is open.' +
          (candidates.length > 1 ? ' Other saved copies remain in Retained reviews.' : '')
        : 'Offline workbook opened with both complete histories. Download an updated workbook to keep the current file edition.');
      if (storageError) $('draft-status').textContent = 'Local saving is unavailable. Complete editing and file downloads remain available.';
    } else {
      [plansDB, reviewsDB] = await Promise.all([
        openDB('starforge-operating-plans-v1', db => {
          db.createObjectStore('plans', { keyPath: 'id' });
          const drafts = db.createObjectStore('drafts', { keyPath: 'key' }); drafts.createIndex('planId', 'planId');
        }),
        openDB('starforge-operating-plan-returns-v1', db => {
          const reviews = db.createObjectStore('reviews', { keyPath: 'key' }); reviews.createIndex('reviewId', 'reviewId');
        }),
      ]);
      ready = true; await refreshShelves(); renderReview();
      message('Saved procedures and retained reviews are ready.');
    }
  } catch (value) { error(value); renderControls(); }
})();
