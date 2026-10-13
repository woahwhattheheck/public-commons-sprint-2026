import {
  reconcile, decide, finalize, exportCSV, exportHTML, exportSQL,
  serializeWorkspace, reopenWorkspace
} from './supplier-report.mjs';

/**
 * Mount the supplier review workspace inside an existing product shell.
 * onChange(nextReport) observes completed domain transitions.
 * onExport({kind, filename, mimeType, content, report}) may return true, or a
 * promise for true, when the host handles delivery. Otherwise a browser
 * download is started. Values are always rendered through DOM textContent.
 */
export function mountSupplierReview(container, options = {}) {
  if (!container || !container.ownerDocument || typeof container.append !== 'function') {
    throw new TypeError('A DOM container is required.');
  }
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  const uid = 'supplier-review-' + Math.random().toString(36).slice(2);
  let report = checkReport(options.report);
  let activeItemId = firstReviewItem(report);
  let query = '';
  let kind = 'all';
  let decisionFilter = 'any';
  let page = 1;
  let pageSize = 25;
  let reviewer = '';
  let tableName = 'supplier_prices';
  let rulesOpen = false;
  let rulesDraft = JSON.stringify(report.rules, null, 2);
  let drafts = new Map();
  let errorText = '';
  let statusText = '';
  let busy = false;
  let destroyed = false;
  const urls = new Set();
  const root = element('section', 'supplier-review');
  root.setAttribute('aria-label', 'Supplier feed review');
  const stylesheet = element('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = new URL('./review-ui.css', import.meta.url).href;
  container.append(root);

  function checkReport(value) {
    if (!value || !Array.isArray(value.items) || !value.rules ||
        !Array.isArray(value.rules.fields) || !value.decisions ||
        typeof value.comparisonId !== 'string' ||
        !Number.isInteger(value.revision)) {
      throw new TypeError('A complete supplier comparison report is required.');
    }
    return value;
  }

  function firstReviewItem(value) {
    const pending = value.items.find(item =>
      item.kind !== 'unchanged' && !Object.prototype.hasOwnProperty.call(value.decisions, item.id));
    return (pending || value.items[0] || {}).id || null;
  }

  function element(tag, className, text) {
    const result = doc.createElement(tag);
    if (className) result.className = className;
    if (tag === 'pre' && className === 'sr-json') result.tabIndex = 0;
    if (text !== undefined) result.textContent = String(text);
    return result;
  }

  function id(name) { return uid + '-' + name; }
  function asText(value) {
    if (value === null) return 'null';
    if (value === undefined) return 'not provided';
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
  function fieldLabel(field) { return field.label || field.name; }
  function hasDecision(item) {
    return Object.prototype.hasOwnProperty.call(report.decisions, item.id);
  }
  function needsReview(item) { return item.kind !== 'unchanged' && !hasDecision(item); }
  function decisionLabel(item) {
    const decision = report.decisions[item.id];
    if (!decision) return item.kind === 'unchanged' ? 'Unchanged' : 'Pending';
    const labels = {
      use_candidate: 'Use candidate',
      keep_baseline: 'Keep baseline',
      exclude: 'Exclude',
      replace: 'Corrected record',
      choose_source: 'Selected source'
    };
    return labels[decision.action] || asText(decision.action || 'Reviewed');
  }
  function keyLabel(item) {
    if (!Array.isArray(item.key)) return 'Key unavailable';
    return item.key.map(value => value === null ? '(null)' : value === '' ? '(empty)' : asText(value)).join(' / ');
  }
  function describeError(error) {
    const parts = [error && error.message ? error.message : String(error)];
    const details = error && error.details;
    if (details && typeof details === 'object') {
      const context = [];
      if (details.field !== undefined) context.push('Field: ' + asText(details.field));
      if (details.side !== undefined) context.push('Source: ' + asText(details.side));
      if (details.column !== undefined) context.push('Column: ' + asText(details.column));
      if (context.length) parts.push(context.join(' · '));
      if (Array.isArray(details.issues)) {
        for (const problem of details.issues) {
          if (!problem || typeof problem !== 'object') continue;
          const field = problem.field === undefined ? '' : asText(problem.field) + ': ';
          parts.push(field + asText(problem.message || problem.code || 'Requires correction'));
        }
      }
    }
    return [...new Set(parts)].join('\n');
  }
  function fail(error) {
    errorText = describeError(error);
    statusText = '';
    render({ focus: 'error' });
  }
  function clearMessage() { errorText = ''; statusText = ''; }

  function button(label, handler, className = '', disabled = false) {
    const result = element('button', 'sr-button ' + className, label);
    result.type = 'button';
    result.disabled = Boolean(disabled || busy);
    result.addEventListener('click', handler);
    return result;
  }

  function labelControl(label, control, className = '') {
    const wrapper = element('label', 'sr-control ' + className);
    wrapper.append(element('span', 'sr-label', label), control);
    return wrapper;
  }

  function selectControl(name, choices, selected, change) {
    const select = element('select', 'sr-input');
    select.id = id(name);
    for (const choice of choices) {
      const option = element('option', '', choice[1]);
      option.value = choice[0];
      option.selected = choice[0] === selected;
      select.append(option);
    }
    select.disabled = busy;
    select.addEventListener('change', () => change(select.value));
    return select;
  }

  function valueNode(value) {
    const code = element('code', 'sr-value');
    if (value === null) {
      code.textContent = 'null';
      code.classList.add('sr-value-null');
      code.setAttribute('aria-label', 'Null value');
    } else if (value === undefined) {
      code.textContent = 'not provided';
      code.classList.add('sr-value-null');
    } else if (value === '') {
      code.textContent = '""';
      code.setAttribute('aria-label', 'Empty string');
    } else {
      code.textContent = asText(value);
    }
    return code;
  }

  function tableHead(labels) {
    const head = element('thead');
    const row = element('tr');
    for (const label of labels) {
      const cell = element('th', '', label);
      cell.scope = 'col';
      row.append(cell);
    }
    head.append(row);
    return head;
  }

  function meta(label, value) {
    const wrapper = element('div', 'sr-meta');
    wrapper.append(element('dt', '', label), element('dd', '', asText(value)));
    return wrapper;
  }

  function filteredItems() {
    const needle = query.toLocaleLowerCase();
    return report.items.filter(item => {
      if (kind === 'review_required' ? !needsReview(item) : kind !== 'all' && item.kind !== kind) return false;
      if (decisionFilter === 'pending' && !needsReview(item)) return false;
      if (decisionFilter === 'resolved' && !hasDecision(item)) return false;
      if (!needle) return true;
      const searchable = JSON.stringify({
        key: item.key,
        kind: item.kind,
        differences: item.differences,
        issues: item.issues,
        baseline: item.baseline,
        candidate: item.candidate,
        decision: report.decisions[item.id]
      }).toLocaleLowerCase();
      return searchable.includes(needle);
    });
  }

  function applyReport(next, message, { nextPending = false, reset = false } = {}) {
    report = checkReport(next);
    if (reset) {
      drafts = new Map();
      rulesDraft = JSON.stringify(report.rules, null, 2);
      activeItemId = firstReviewItem(report);
      page = 1;
    } else if (nextPending) {
      const visible = filteredItems();
      const currentIndex = visible.findIndex(item => item.id === activeItemId);
      const subsequent = visible.slice(currentIndex + 1).concat(visible.slice(0, currentIndex + 1));
      const next = subsequent.find(needsReview) || report.items.find(needsReview);
      if (next) {
        activeItemId = next.id;
        const nextIndex = visible.findIndex(item => item.id === activeItemId);
        if (nextIndex >= 0) page = Math.floor(nextIndex / pageSize) + 1;
      }
    }
    errorText = '';
    statusText = message;
    render({ focus: nextPending ? 'detail-heading' : 'status' });
    if (typeof options.onChange === 'function') {
      try {
        const notification = options.onChange(report);
        if (notification && typeof notification.then === 'function') {
          notification.catch(error => {
            if (!destroyed) fail(new Error('The review was updated, but the host could not receive it: ' + asText(error.message || error)));
          });
        }
      } catch (error) {
        fail(new Error('The review was updated, but the host could not receive it: ' + asText(error.message || error)));
      }
    }
  }

  function draftFor(item) {
    if (drafts.has(item.id)) return drafts.get(item.id);
    const existing = report.decisions[item.id];
    const source = item.candidate.length === 1 ? item.candidate[0] :
      item.baseline.length === 1 ? item.baseline[0] : null;
    const originalValues = existing && existing.values ? existing.values : (source && source.values) || {};
    const values = Object.create(null);
    const nulls = Object.create(null);
    for (const field of report.rules.fields) {
      const original = originalValues[field.name];
      nulls[field.name] = original === null || original === undefined;
      values[field.name] = original === null || original === undefined ? '' : asText(original);
    }
    const sourceRows = item.baseline.map(row => ({ side: 'baseline', row }))
      .concat(item.candidate.map(row => ({ side: 'candidate', row })));
    const chosen = existing && existing.action === 'choose_source' ?
      sourceRows.findIndex(choice => choice.side === existing.side && choice.row.rowNumber === existing.rowNumber) : 0;
    const draft = {
      action: existing && existing.action ? existing.action :
        item.candidate.length === 1 ? 'use_candidate' :
        item.baseline.length === 1 ? 'keep_baseline' : 'choose_source',
      reason: existing && existing.reason ? existing.reason : '',
      sourceIndex: chosen >= 0 ? chosen : 0,
      values,
      nulls
    };
    drafts.set(item.id, draft);
    return draft;
  }

  function decisionFor(item, draft) {
    const change = { itemId: item.id, action: draft.action, reason: draft.reason.trim() };
    if (!change.reason) throw new Error('Enter the reason for this decision.');
    if (!reviewer.trim()) throw new Error('Enter the reviewer name before saving a decision.');
    if (draft.action === 'replace') {
      change.values = Object.create(null);
      for (const field of report.rules.fields) {
        change.values[field.name] = draft.nulls[field.name] ? null : draft.values[field.name];
      }
    }
    if (draft.action === 'choose_source') {
      const rows = item.baseline.map(row => ({ side: 'baseline', row }))
        .concat(item.candidate.map(row => ({ side: 'candidate', row })));
      const choice = rows[draft.sourceIndex];
      if (!choice) throw new Error('Choose an original source row.');
      change.side = choice.side;
      change.rowNumber = choice.row.rowNumber;
    }
    return change;
  }

  function saveDecision(item, nextPending) {
    try {
      const change = decisionFor(item, draftFor(item));
      const next = decide(report, change, {
        reviewer: reviewer.trim(),
        expectedRevision: report.revision
      });
      drafts.delete(item.id);
      applyReport(next, 'Decision saved for ' + keyLabel(item) + '.', { nextPending });
    } catch (error) { fail(error); }
  }

  function exportBase() {
    return String(report.requestId || report.comparisonId).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'supplier_review';
  }

  async function deliver(kind, filename, mimeType, content) {
    if (typeof content !== 'string') throw new TypeError('The exporter did not return a complete text file.');
    const payload = { kind, filename, mimeType, content, report };
    if (typeof options.onExport === 'function' && await options.onExport(payload) === true) return;
    if (destroyed) return;
    const blob = new win.Blob([content], { type: mimeType });
    const url = win.URL.createObjectURL(blob);
    urls.add(url);
    const link = element('a');
    link.href = url;
    link.download = filename;
    link.hidden = true;
    root.append(link);
    link.click();
    link.remove();
    win.setTimeout(() => {
      win.URL.revokeObjectURL(url);
      urls.delete(url);
    }, 1000);
  }

  async function runExport(kind) {
    if (busy) return;
    clearMessage();
    busy = true;
    render();
    try {
      const base = exportBase();
      if (kind === 'workspace') {
        await deliver(kind, base + '.review.json', 'application/json;charset=utf-8', serializeWorkspace(report));
      } else if (kind === 'changes') {
        await deliver(kind, base + '.changes.csv', 'text/csv;charset=utf-8', exportCSV(report, { kind: 'changes' }));
      } else if (kind === 'accepted') {
        finalize(report);
        await deliver(kind, base + '.accepted.csv', 'text/csv;charset=utf-8', exportCSV(report, { kind: 'accepted' }));
      } else if (kind === 'html') {
        await deliver(kind, base + '.review.html', 'text/html;charset=utf-8', exportHTML(report));
      } else if (kind === 'sql') {
        finalize(report);
        await deliver(kind, base + '.snapshot.sql', 'application/sql;charset=utf-8', exportSQL(report, { tableName: tableName.trim() }));
      } else {
        throw new Error('Unknown export format.');
      }
      statusText = 'Prepared ' + ({ workspace: 'the complete review workspace', changes: 'the changes CSV', accepted: 'the accepted CSV', html: 'the review HTML', sql: 'the SQLite snapshot file' })[kind] + '.';
    } catch (error) {
      errorText = describeError(error);
    } finally {
      busy = false;
      if (!destroyed) render({ focus: errorText ? 'error' : 'status' });
    }
  }

  async function openWorkspace(file) {
    if (!file || busy) return;
    clearMessage();
    busy = true;
    render();
    try {
      let retainedText;
      try {
        retainedText = new win.TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      } catch (error) {
        if (error instanceof TypeError || error.name === 'TypeError') {
          throw new Error('The review file must contain valid UTF-8 text. Open the original saved review JSON file.');
        }
        throw error;
      }
      const restored = reopenWorkspace(retainedText);
      if (destroyed) return;
      busy = false;
      applyReport(restored, 'Opened the complete retained review from ' + file.name + '.', { reset: true });
    } catch (error) {
      busy = false;
      if (!destroyed) fail(error);
    }
  }

  function renderHeader() {
    const header = element('header', 'sr-header');
    const title = element('div', 'sr-heading');
    title.append(element('p', 'sr-kicker', 'Supplier operations'), element('h2', '', 'Supplier feed review'));
    title.append(element('p', 'sr-subtitle', 'Compare retained editions, resolve each change, and export the reviewed result.'));
    const badge = element('span', 'sr-status-badge', report.status === 'reviewed' ? 'Reviewed' : 'Review required');
    title.append(badge);
    const actions = element('div', 'sr-header-actions');
    actions.append(button('Save review', () => runExport('workspace')));
    const file = element('input', 'sr-file-input');
    file.type = 'file';
    file.accept = '.json,application/json';
    file.id = id('open-review');
    file.disabled = busy;
    file.addEventListener('change', () => openWorkspace(file.files && file.files[0]));
    file.hidden = true;
    const openButton = button('Open review', () => file.click());
    actions.append(openButton, file);
    header.append(title, actions);
    const metadata = element('dl', 'sr-metadata');
    metadata.append(meta('Request', report.requestId), meta('Comparison', report.comparisonId), meta('Revision', report.revision));
    const sources = element('div', 'sr-sources');
    for (const side of ['baseline', 'candidate']) {
      const edition = report[side] || {};
      const source = element('section', 'sr-source');
      source.append(element('h3', '', side === 'baseline' ? 'Baseline edition' : 'Candidate edition'));
      const list = element('dl', 'sr-source-metadata');
      list.append(meta('Edition', edition.id), meta('Source', edition.sourceId), meta('Captured', edition.capturedAt));
      source.append(list);
      sources.append(source);
    }
    return [header, metadata, sources];
  }

  function renderMessages() {
    const holder = element('div', 'sr-messages');
    if (errorText) {
      const alert = element('div', 'sr-alert', errorText);
      alert.id = id('error');
      alert.tabIndex = -1;
      alert.setAttribute('role', 'alert');
      holder.append(alert);
    }
    if (statusText) {
      const status = element('div', 'sr-notice', statusText);
      status.id = id('status');
      status.tabIndex = -1;
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      holder.append(status);
    }
    const blocking = Array.isArray(report.blockingIssues) ? report.blockingIssues : [];
    if (blocking.length) {
      const panel = element('section', 'sr-alert');
      panel.setAttribute('aria-label', 'Accepted record conflicts');
      panel.append(element('h3', '', 'Resolve accepted record conflicts'));
      const list = element('ul');
      for (const issue of blocking) {
        list.append(element('li', '', typeof issue === 'string' ? issue :
          [issue.code, issue.field, issue.message || JSON.stringify(issue)].filter(Boolean).join(' · ')));
      }
      panel.append(list);
      holder.append(panel);
    }
    return holder;
  }

  function renderSummary() {
    const summary = report.summary || {};
    const section = element('section', 'sr-summary');
    section.setAttribute('aria-label', 'Comparison totals and review progress');
    const cards = element('dl', 'sr-counts');
    const counts = [
      ['Baseline rows', summary.baselineRows],
      ['Candidate rows', summary.candidateRows],
      ['Added', summary.addition],
      ['Removed', summary.removal],
      ['Changed', summary.change],
      ['Exceptions', summary.exception],
      ['Unchanged', summary.unchanged]
    ];
    for (const [label, count] of counts) {
      const card = element('div', 'sr-count');
      card.append(element('dt', '', label), element('dd', '', count === undefined ? '—' : count));
      cards.append(card);
    }
    const progress = element('div', 'sr-progress');
    const required = Number(summary.reviewRequired || 0);
    const resolved = Number(summary.resolved || 0);
    const pending = Number(summary.pending || 0);
    const progressLabel = element('span', '', resolved + ' of ' + required + ' decisions complete · ' + pending + ' pending');
    progressLabel.id = id('progress-label');
    const meter = element('progress');
    meter.max = Math.max(required, 1);
    meter.value = required ? Math.min(resolved, required) : 1;
    meter.setAttribute('aria-labelledby', progressLabel.id);
    progress.append(progressLabel, meter);
    const complete = button('Complete review', () => {
      try {
        const result = finalize(report);
        statusText = 'Review complete. ' + result.rows.length + ' accepted records are ready for delivery.';
        errorText = '';
        render({ focus: 'status' });
      } catch (error) { fail(error); }
    }, 'sr-button-primary', pending > 0 || Number(summary.blocking || 0) > 0);
    progress.append(complete);
    if (Number(summary.blocking || 0) > 0) {
      progress.append(element('span', 'sr-inline-note', summary.blocking + ' accepted record conflicts require correction.'));
    }
    section.append(cards, progress);
    return section;
  }

  function renderRules() {
    const details = element('details', 'sr-rules');
    details.open = rulesOpen;
    details.addEventListener('toggle', () => { rulesOpen = details.open; });
    details.append(element('summary', '', 'Mapping and comparison rules'));
    const body = element('div', 'sr-rules-body');
    body.append(element('p', 'sr-help', 'Map supplier columns to canonical fields or explicit constants. Keep decimal values as strings. Configure keys, aliases, allowed values, tolerances and currency or unit context in this retained rules document.'));
    const textarea = element('textarea', 'sr-input sr-rules-editor');
    textarea.id = id('rules');
    textarea.spellcheck = false;
    textarea.value = rulesDraft;
    textarea.disabled = busy;
    textarea.rows = 18;
    textarea.addEventListener('input', () => { rulesDraft = textarea.value; });
    body.append(labelControl('Rules JSON', textarea));
    const controls = element('div', 'sr-row-actions');
    controls.append(button('Recompare retained editions', () => {
      try {
        const rules = JSON.parse(rulesDraft);
        const next = reconcile({
          requestId: report.requestId,
          baseline: report.baseline,
          candidate: report.candidate,
          rules,
          predecessor: { comparisonId: report.comparisonId, revision: report.revision }
        });
        applyReport(next, 'Created a new comparison from the retained editions and current rules.', { reset: true });
      } catch (error) { fail(error); }
    }, 'sr-button-primary'));
    controls.append(button('Reset rules editor', () => {
      rulesDraft = JSON.stringify(report.rules, null, 2);
      render({ focus: 'rules' });
    }));
    body.append(controls, element('p', 'sr-help', 'Recompare records the predecessor comparison and revision. Review the resulting decisions before exporting accepted records.'));
    details.append(body);
    return details;
  }

  function renderFilters() {
    const toolbar = element('section', 'sr-filters');
    toolbar.setAttribute('aria-label', 'Filter comparison records');
    const search = element('input', 'sr-input');
    search.type = 'search';
    search.id = id('search');
    search.value = query;
    search.placeholder = 'Key, source value, change, issue or decision';
    search.disabled = busy;
    search.addEventListener('input', () => {
      query = search.value;
      page = 1;
      render({ focus: 'search', start: search.selectionStart, end: search.selectionEnd });
    });
    toolbar.append(labelControl('Search records', search, 'sr-search'));
    const kindSelect = selectControl('kind', [
      ['all', 'All records'],
      ['review_required', 'Needs a decision'],
      ['addition', 'Additions'],
      ['removal', 'Removals'],
      ['change', 'Changes'],
      ['exception', 'Exceptions'],
      ['unchanged', 'Unchanged']
    ], kind, value => {
      kind = value;
      page = 1;
      render({ focus: 'kind' });
    });
    toolbar.append(labelControl('Record kind', kindSelect));
    const decisions = selectControl('decision-filter', [
      ['any', 'All decision states'],
      ['pending', 'Pending'],
      ['resolved', 'Reviewed']
    ], decisionFilter, value => {
      decisionFilter = value;
      page = 1;
      render({ focus: 'decision-filter' });
    });
    toolbar.append(labelControl('Decision', decisions));
    const size = selectControl('page-size', [
      ['10', '10'], ['25', '25'], ['50', '50'], ['100', '100']
    ], String(pageSize), value => {
      pageSize = Number(value);
      page = 1;
      render({ focus: 'page-size' });
    });
    toolbar.append(labelControl('Rows per page', size));
    toolbar.append(button('Clear filters', () => {
      query = '';
      kind = 'all';
      decisionFilter = 'any';
      page = 1;
      render({ focus: 'search' });
    }));
    return toolbar;
  }

  function recordSummary(rows) {
    if (!rows.length) return 'No record';
    return rows.length + (rows.length === 1 ? ' record · row ' : ' records · rows ') +
      rows.map(row => row.rowNumber).join(', ');
  }

  function renderTable(items) {
    const wrapper = element('section', 'sr-records');
    wrapper.setAttribute('aria-label', 'Comparison records');
    const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
    page = Math.min(Math.max(page, 1), totalPages);
    const first = (page - 1) * pageSize;
    const visible = items.slice(first, first + pageSize);
    const top = element('div', 'sr-table-top');
    top.append(element('h3', '', 'Records'), element('span', 'sr-help', items.length + ' matching of ' + report.items.length));
    wrapper.append(top);
    if (!visible.length) {
      const empty = element('div', 'sr-empty');
      empty.append(element('h4', '', report.items.length ? 'No records match these filters' : 'This comparison contains no records'));
      empty.append(element('p', '', report.items.length ? 'Clear the filters or search another source value.' : 'Open a retained review or inspect the source editions and mapping rules.'));
      wrapper.append(empty);
      return wrapper;
    }
    const scroll = element('div', 'sr-table-scroll');
    scroll.tabIndex = 0;
    scroll.setAttribute('role', 'region');
    scroll.setAttribute('aria-label', 'Comparison records table. Scroll horizontally for all columns.');
    const table = element('table', 'sr-table sr-record-table');
    const caption = element('caption', 'sr-sr-only', 'Supplier comparison records. Open a record to inspect complete original and canonical values.');
    table.append(caption, tableHead(['Key', 'Kind', 'Changed fields', 'Baseline', 'Candidate', 'Decision', 'Review']));
    const body = element('tbody');
    for (const item of visible) {
      const row = element('tr', item.id === activeItemId ? 'sr-active-row' : '');
      const key = element('th', 'sr-key-cell');
      key.scope = 'row';
      key.append(valueNode(keyLabel(item)));
      row.append(key);
      const type = element('td');
      type.append(element('span', 'sr-kind', item.kind));
      row.append(type);
      const changed = (item.differences || []).map(field => field.label || field.field).join(', ');
      const differences = element('td', 'sr-change-fields', changed || (item.issues || []).map(issue => issue.code).join(', ') || '—');
      row.append(differences, element('td', '', recordSummary(item.baseline)), element('td', '', recordSummary(item.candidate)));
      row.append(element('td', '', decisionLabel(item)));
      const actionCell = element('td');
      const action = button('Open', () => {
        activeItemId = item.id;
        clearMessage();
        render({ focus: 'detail-heading' });
      });
      action.setAttribute('aria-label', 'Review ' + keyLabel(item));
      action.setAttribute('aria-expanded', String(activeItemId === item.id));
      action.setAttribute('aria-controls', id('detail'));
      actionCell.append(action);
      row.append(actionCell);
      body.append(row);
    }
    table.append(body);
    scroll.append(table);
    wrapper.append(scroll);
    const pager = element('nav', 'sr-pagination');
    pager.setAttribute('aria-label', 'Record pages');
    pager.append(button('Previous page', () => {
      page--;
      render({ focus: 'page-current' });
    }, '', page <= 1));
    const current = element('span', '', 'Page ' + page + ' of ' + totalPages + ' · records ' + (first + 1) + '–' + Math.min(first + pageSize, items.length));
    current.id = id('page-current');
    current.tabIndex = -1;
    pager.append(current);
    pager.append(button('Next page', () => {
      page++;
      render({ focus: 'page-current' });
    }, '', page >= totalPages));
    wrapper.append(pager);
    return wrapper;
  }

  function renderIssues(issues, heading) {
    const block = element('section', 'sr-issues');
    if (!issues || !issues.length) return block;
    block.append(element('h4', '', heading));
    const list = element('ul');
    for (const issue of issues) {
      list.append(element('li', '', [issue.code, issue.field, issue.message].filter(Boolean).join(' · ')));
    }
    block.append(list);
    return block;
  }

  function renderDifferences(item) {
    const block = element('section', 'sr-differences');
    block.append(element('h4', '', 'Field comparison'));
    if (!item.differences || !item.differences.length) {
      block.append(element('p', 'sr-help', item.kind === 'unchanged' ? 'The canonical records agree under these rules.' : 'Inspect the original records and exceptions below.'));
      return block;
    }
    const scroll = element('div', 'sr-table-scroll');
    scroll.tabIndex = 0;
    scroll.setAttribute('role', 'region');
    scroll.setAttribute('aria-label', 'Field comparison table');
    const table = element('table', 'sr-table');
    table.append(tableHead(['Field', 'Baseline', 'Candidate', 'Delta or basis']));
    const body = element('tbody');
    for (const difference of item.differences) {
      const row = element('tr');
      const field = element('th', '', difference.label || difference.field);
      field.scope = 'row';
      row.append(field);
      for (const value of [difference.before, difference.after]) {
        const cell = element('td');
        cell.append(valueNode(value));
        row.append(cell);
      }
      const delta = element('td');
      if (difference.delta !== undefined && difference.delta !== null) delta.append(valueNode(difference.delta));
      if (difference.deltaReason) delta.append(element('span', 'sr-basis-note', difference.deltaReason));
      if (!delta.childNodes.length) delta.append(element('span', 'sr-help', '—'));
      row.append(delta);
      body.append(row);
    }
    table.append(body);
    scroll.append(table);
    block.append(scroll);
    return block;
  }

  function renderSourceRows(item, side) {
    const section = element('section', 'sr-original-records');
    const rows = item[side];
    section.append(element('h4', '', side === 'baseline' ? 'Original baseline records' : 'Original candidate records'));
    if (!rows.length) {
      section.append(element('p', 'sr-help', 'No original record on this side.'));
      return section;
    }
    for (const row of rows) {
      const detail = element('details', 'sr-source-record');
      detail.open = rows.length === 1;
      detail.append(element('summary', '', 'Source row ' + row.rowNumber));
      const canonical = element('div', 'sr-source-record-body');
      canonical.append(renderIssues(row.issues, 'Source row issues'));
      const fieldTable = element('table', 'sr-table sr-canonical-table');
      fieldTable.append(tableHead(['Canonical field', 'Value']));
      const body = element('tbody');
      for (const field of report.rules.fields) {
        const tr = element('tr');
        const name = element('th', '', fieldLabel(field));
        name.scope = 'row';
        const value = element('td');
        value.append(valueNode((row.values || {})[field.name]));
        tr.append(name, value);
        body.append(tr);
      }
      fieldTable.append(body);
      canonical.append(fieldTable);
      const raw = element('details', 'sr-raw-record');
      raw.append(element('summary', '', 'Complete original source values'));
      raw.append(element('pre', 'sr-json', JSON.stringify(row.raw, null, 2)));
      canonical.append(raw);
      detail.append(canonical);
      section.append(detail);
    }
    return section;
  }

  function renderDecision(item) {
    const section = element('section', 'sr-decision');
    section.append(element('h4', '', hasDecision(item) ? 'Update decision' : 'Resolve record'));
    if (item.kind === 'unchanged' && !hasDecision(item)) {
      section.append(element('p', 'sr-help', 'This record already agrees under the selected rules. You may record an explicit correction or exclusion when needed.'));
    }
    const draft = draftFor(item);
    const reviewerInput = element('input', 'sr-input');
    reviewerInput.type = 'text';
    reviewerInput.id = id('reviewer');
    reviewerInput.value = reviewer;
    reviewerInput.autocomplete = 'name';
    reviewerInput.required = true;
    reviewerInput.disabled = busy;
    reviewerInput.addEventListener('input', () => { reviewer = reviewerInput.value; });
    section.append(labelControl('Reviewer', reviewerInput));
    const action = selectControl('decision-action', [
      ['use_candidate', 'Use candidate record'],
      ['keep_baseline', 'Keep baseline record'],
      ['exclude', 'Exclude this key'],
      ['replace', 'Enter complete corrected record'],
      ['choose_source', 'Choose one original source row']
    ], draft.action, value => {
      draft.action = value;
      render({ focus: 'decision-action' });
    });
    section.append(labelControl('Decision action', action));
    if (draft.action === 'choose_source') {
      const rows = item.baseline.map(row => ({ side: 'baseline', row }))
        .concat(item.candidate.map(row => ({ side: 'candidate', row })));
      const choices = rows.map((choice, index) => [
        String(index), (choice.side === 'baseline' ? 'Baseline' : 'Candidate') + ' source row ' + choice.row.rowNumber
      ]);
      const selected = selectControl('source-choice', choices, String(draft.sourceIndex), value => {
        draft.sourceIndex = Number(value);
      });
      section.append(labelControl('Original source row', selected));
      section.append(element('p', 'sr-help', 'The selected original record must satisfy the current mapping and canonical field rules.'));
    }
    if (draft.action === 'replace') {
      const fields = element('fieldset', 'sr-corrections');
      fields.append(element('legend', '', 'Complete canonical record'));
      fields.append(element('p', 'sr-help', 'Enter exact values as text. A checked null box stores null; an empty text field stores an empty string.'));
      for (const field of report.rules.fields) {
        const line = element('div', 'sr-correction-field');
        const input = element('input', 'sr-input sr-value-input');
        input.type = 'text';
        input.id = id('correct-' + field.name);
        input.value = draft.values[field.name];
        input.disabled = busy || draft.nulls[field.name];
        input.spellcheck = false;
        if (field.type === 'decimal' || field.type === 'integer') input.inputMode = 'decimal';
        input.addEventListener('input', () => { draft.values[field.name] = input.value; });
        const title = fieldLabel(field) + ' · ' + field.type + (field.required ? ' · required' : '');
        line.append(labelControl(title, input));
        const nullLabel = element('label', 'sr-null-control');
        const nullInput = element('input');
        nullInput.type = 'checkbox';
        nullInput.checked = Boolean(draft.nulls[field.name]);
        nullInput.disabled = busy;
        nullInput.setAttribute('aria-label', fieldLabel(field) + ' is null');
        nullInput.addEventListener('change', () => {
          draft.nulls[field.name] = nullInput.checked;
          input.disabled = busy || nullInput.checked;
        });
        nullLabel.append(nullInput, element('span', '', 'null'));
        line.append(nullLabel);
        fields.append(line);
      }
      section.append(fields);
    }
    const reason = element('textarea', 'sr-input');
    reason.id = id('reason');
    reason.rows = 3;
    reason.value = draft.reason;
    reason.required = true;
    reason.disabled = busy;
    reason.placeholder = 'Reason for accepting, excluding or correcting this record';
    reason.addEventListener('input', () => { draft.reason = reason.value; });
    section.append(labelControl('Decision reason', reason));
    const controls = element('div', 'sr-row-actions');
    controls.append(button('Save decision', () => saveDecision(item, false), 'sr-button-primary'));
    controls.append(button('Save and next pending', () => saveDecision(item, true)));
    section.append(controls);
    const current = report.decisions[item.id];
    if (current) {
      const retained = element('details', 'sr-retained-decision');
      retained.append(element('summary', '', 'Current retained decision'));
      retained.append(element('pre', 'sr-json', JSON.stringify(current, null, 2)));
      section.append(retained);
    }
    return section;
  }

  function renderDetail(items) {
    const section = element('aside', 'sr-detail');
    section.id = id('detail');
    section.setAttribute('aria-label', 'Selected record review');
    const item = report.items.find(record => record.id === activeItemId);
    if (!item) {
      section.append(element('h3', '', 'Record review'), element('p', 'sr-help', 'Open a comparison record to inspect its source values and record a decision.'));
      return section;
    }
    const header = element('div', 'sr-detail-header');
    const heading = element('h3', '', 'Record review');
    heading.id = id('detail-heading');
    heading.tabIndex = -1;
    header.append(heading, element('span', 'sr-kind', item.kind));
    section.append(header, element('p', 'sr-detail-key', keyLabel(item)));
    const nav = element('div', 'sr-row-actions');
    const index = items.findIndex(record => record.id === item.id);
    nav.append(button('Previous record', () => {
      activeItemId = items[index - 1].id;
      render({ focus: 'detail-heading' });
    }, '', index <= 0));
    nav.append(button('Next record', () => {
      activeItemId = items[index + 1].id;
      render({ focus: 'detail-heading' });
    }, '', index < 0 || index >= items.length - 1));
    section.append(nav);
    if (index < 0) section.append(element('p', 'sr-help', 'This open record is outside the current table filters.'));
    section.append(renderIssues(item.issues, 'Record exceptions'), renderDifferences(item));
    section.append(renderSourceRows(item, 'baseline'), renderSourceRows(item, 'candidate'));
    section.append(renderDecision(item));
    return section;
  }

  function renderExports() {
    const section = element('section', 'sr-exports');
    section.append(element('h3', '', 'Delivery files'));
    section.append(element('p', 'sr-help', 'Changes and review files include the current review state. Accepted records and SQL become available when every required decision and accepted record conflict is resolved.'));
    const controls = element('div', 'sr-export-actions');
    const summary = report.summary || {};
    const ready = report.status === 'reviewed' && !summary.pending && !summary.blocking;
    controls.append(button('Changes CSV', () => runExport('changes')));
    controls.append(button('Review HTML', () => runExport('html')));
    controls.append(button('Accepted CSV', () => runExport('accepted'), '', !ready));
    controls.append(button('Complete review JSON', () => runExport('workspace')));
    section.append(controls);
    const sql = element('div', 'sr-sql-export');
    const table = element('input', 'sr-input');
    table.type = 'text';
    table.id = id('table-name');
    table.value = tableName;
    table.spellcheck = false;
    table.disabled = busy;
    table.addEventListener('input', () => { tableName = table.value; });
    sql.append(labelControl('New SQLite table', table));
    sql.append(button('SQLite snapshot', () => runExport('sql'), '', !ready));
    section.append(sql);
    section.append(element('p', 'sr-help', 'Creates a new SQLite table with TEXT columns and a lineage transaction from the reviewed accepted records.'));
    const history = element('details', 'sr-history');
    history.append(element('summary', '', 'Complete retained decision history'));
    history.append(element('pre', 'sr-json', JSON.stringify(report.history || [], null, 2)));
    section.append(history);
    return section;
  }

  function render(focus = {}) {
    if (destroyed) return;
    root.replaceChildren(stylesheet);
    root.setAttribute('aria-busy', String(busy));
    root.append(...renderHeader(), renderMessages(), renderSummary(), renderRules(), renderFilters());
    const items = filteredItems();
    const workspace = element('div', 'sr-workspace');
    workspace.append(renderTable(items), renderDetail(items));
    root.append(workspace, renderExports());
    if (focus.focus) {
      const target = doc.getElementById(id(focus.focus));
      if (target && root.contains(target)) {
        target.focus({ preventScroll: focus.focus === 'search' });
        if (typeof target.setSelectionRange === 'function' &&
            focus.start !== undefined && focus.start !== null) {
          target.setSelectionRange(focus.start, focus.end);
        }
      }
    }
  }

  render();
  return {
    setReport(next) {
      if (destroyed) throw new Error('This supplier review workspace has been destroyed.');
      report = checkReport(next);
      drafts = new Map();
      rulesDraft = JSON.stringify(report.rules, null, 2);
      if (!report.items.some(item => item.id === activeItemId)) activeItemId = firstReviewItem(report);
      clearMessage();
      render();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const url of urls) win.URL.revokeObjectURL(url);
      urls.clear();
      root.remove();
    }
  };
}
