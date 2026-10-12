// MIT. Recurring analyst briefings on the original private economic workspace.
const $ = id => document.getElementById(id);
const labels = { NEW_PERIOD: 'New period', EARLIER_PERIOD: 'Earlier period',
  ADDED_COMPARISON: 'Added comparison', LEFT_WINDOW: 'Left reporting window',
  REMOVED_COMPARISON: 'Removed comparison', REVISED: 'Revised', UNCHANGED: 'Unchanged' };
const kinds = new Set(['template-save', 'successor-save']);
export function mountFredRecurring({ api, download, table, select, getState, refresh, message, openBriefing }) {
  let current = null, generation = 0, working = 0, lastRevision = null;
  const state = () => getState();
  const requestKey = () => 'fred-recurring-request:' + state().id;
  const template = () => (state()?.briefingTemplates ?? []).find(item => item.id === $('recurring-template').value);
  const history = () => (state()?.briefingSuccessors ?? []).filter(item => item.templateId === template()?.id);
  const captureLabel = item => item.selection.series.join(', ') + ' · ' +
    (item.sourceMode === 'PUBLIC_TABLE' ? 'Collected ' : 'Vintage ') + item.selection.asOf + ' · ' + item.id.slice(0, 10);
  function storedRequest() {
    const raw = sessionStorage.getItem(requestKey());
    if (!raw) return null;
    try {
      const request = JSON.parse(raw);
      if (!kinds.has(request.action) || typeof request.id !== 'string' ||
        !Number.isSafeInteger(request.expectedRevision)) throw new Error();
      return request;
    } catch { throw new Error('The saved browser request is incomplete. Read current project history before clearing it.'); }
  }
  function pendingRequest() {
    const pending = state()?.pending;
    if (pending && kinds.has(pending.kind))
      return { ...pending.payload, action: pending.kind, id: pending.id, expectedRevision: pending.expectedRevision };
    return storedRequest();
  }
  function selection() {
    const selected = template();
    if (!selected) throw new Error('Choose a saved briefing template.');
    const previous = $('recurring-previous').value || null;
    const predecessor = previous ? history().find(item => item.id === previous) : null;
    if (previous && !predecessor) throw new Error('Choose a predecessor belonging to this template.');
    return { templateId: selected.id, captureId: $('recurring-capture').value,
      anchorDate: $('recurring-anchor').value || null, previousSuccessorId: previous,
      baselineReviewId: predecessor?.reviewId ?? null, note: $('recurring-note').value };
  }
  function invalidate() {
    generation++;
    if (current?.mode === 'preview') {
      current = null;
      $('recurring-status').textContent = 'Selection changed. Preview the next briefing with the current values.';
    }
    syncButtons();
  }
  function syncButtons() {
    if (!state()) return;
    const ready = Boolean(template() && $('recurring-capture').value), busy = working > 0;
    $('template-save').disabled = busy || !$('template-review').value;
    $('recurring-preview').disabled = busy || !ready;
    $('recurring-save').disabled = busy || current?.mode !== 'preview' ||
      current.value?.revision !== state().revision;
    const saved = Boolean($('recurring-history').value);
    for (const id of ['recurring-open', 'recurring-use', 'recurring-report', 'recurring-html', 'recurring-csv', 'recurring-json'])
      $(id).disabled = busy || !saved;
    const page = current?.value?.comparison;
    $('recurring-previous-page').disabled = busy || !page || page.offset === 0;
    $('recurring-next-page').disabled = busy || !page || page.nextOffset === null;
    let request;
    try { request = pendingRequest(); } catch (error) {
      $('recurring-recovery').hidden = false; $('recurring-recovery-text').textContent = error.message;
      $('recurring-resume').disabled = true; $('recurring-discard').disabled = busy; return;
    }
    $('recurring-recovery').hidden = !request;
    if (request) {
      const completed = state().operations.find(item => item.id === request.id);
      $('recurring-recovery-text').textContent = completed
        ? 'The saved request completed. Continue to reopen its result.'
        : 'A recurring briefing request is retained. Continue the same request to finish or recover its result.';
    }
    $('recurring-resume').disabled = busy || !request;
    $('recurring-discard').disabled = busy || Boolean(state().pending);
  }
  function bind(id, work, type = 'click') {
    $(id).addEventListener(type, async event => {
      event.preventDefault(); if (working && type !== 'change') return;
      working++; message(); syncButtons();
      try { await work(event); } catch (error) { message(error.message, true); }
      finally { working--; syncButtons(); }
    });
  }
  async function transmit(request) {
    sessionStorage.setItem(requestKey(), JSON.stringify(request));
    try {
      const result = await api('/api/action', request);
      sessionStorage.removeItem(requestKey()); await refresh(); return result;
    } catch (error) {
      await refresh().catch(() => {});
      const completed = state().operations.find(item => item.id === request.id);
      if (completed) { sessionStorage.removeItem(requestKey()); return completed.result; }
      throw error;
    }
  }
  async function mutate(action, payload, expectedRevision = state().revision) {
    const existing = pendingRequest();
    if (existing) throw new Error('Continue the saved recurring briefing action before starting another.');
    return transmit({ action, id: 'fred-' + action + '-' + crypto.randomUUID().replaceAll('-', ''),
      expectedRevision, ...payload });
  }
  function refreshTemplateDetails() {
    const selected = template(), successors = history();
    select('recurring-previous', [['', 'Original template briefing'], ...successors.map(item =>
      [item.id, item.materialization.window.start + ' to ' + item.materialization.window.end + ' · ' + item.id.slice(-10)])]);
    select('recurring-history', [...successors].reverse().map(item =>
      [item.id, item.materialization.window.start + ' to ' + item.materialization.window.end + ' · ' +
        item.comparison.changedCount + ' changed comparisons · ' + item.id.slice(-10)]));
    const root = $('recurring-template-detail'); root.replaceChildren();
    if (selected) {
      const text = document.createElement('p');
      text.textContent = selected.window.months + ' calendar months; ' +
        (selected.window.anchor === 'latest_all' ? 'earliest latest observation date across the selected series' :
          'latest observation date across the selected series') +
        '; omit ' + selected.window.lagMonths + ' months at the end. Series: ' +
        selected.briefing.series.map(item => item.id).join(', ') + '.';
      root.append(text);
    }
    syncButtons();
  }
  function onState() {
    if (!state()) return;
    const project = state();
    if (lastRevision !== null && lastRevision !== project.revision && current?.mode === 'preview') {
      generation++; current = null;
      $('recurring-status').textContent = 'The project changed. Preview the current selection before saving the next briefing.';
    }
    lastRevision = project.revision;
    const reviews = project.reviews.filter(item => item.briefing), templates = project.briefingTemplates ?? [];
    select('template-review', reviews.map(item => [item.id, item.briefing.title + ' · ' + item.id.slice(0, 12)]));
    if (!$('template-name').value && reviews.length) {
      const review = reviews.find(item => item.id === $('template-review').value);
      $('template-name').value = review?.briefing.title ?? '';
    }
    select('template-previous', [['', 'Create a new template'], ...templates.map(item => [item.id, item.name + ' · ' + item.id.slice(-10)])]);
    select('recurring-template', templates.map(item => [item.id, item.name + ' · ' + item.id.slice(-10)]));
    select('recurring-capture', project.captures.map(item => [item.id, captureLabel(item)]),
      $('recurring-capture').value || project.selectedCapture);
    refreshTemplateDetails(); syncButtons();
  }
  function render(value, mode) {
    const comparison = value.comparison, window = value.materialization.window;
    const summary = $('recurring-summary'); summary.replaceChildren();
    for (const [label, count] of [['Changed comparisons', comparison.changedCount],
      ['Revised values or baselines', comparison.totals.REVISED], ['New periods', comparison.totals.NEW_PERIOD],
      ['Periods leaving the window', comparison.totals.LEFT_WINDOW], ['Source context updates', comparison.contextChangedCount]]) {
      const box = document.createElement('div'), strong = document.createElement('strong'), span = document.createElement('span');
      box.className = 'metric'; strong.textContent = count; span.textContent = label; box.append(strong, span); summary.append(box);
    }
    $('recurring-status').textContent = (mode === 'saved' ? 'Saved successor' : 'Preview') + ' · ' +
      value.template.name + ' · ' + window.start + ' to ' + window.end + ' · observation anchor ' +
      window.anchorDate + (window.anchorBasis === 'explicit' ? ' (selected date)' : ' (saved template rule)');
    table('recurring-coverage', value.materialization.coverage.map(item => ({ series: item.series, frequency: item.frequency,
      units: item.units, first_source: item.firstSourceDate, latest_source: item.lastSourceDate,
      selected_rows: item.windowRows, missing_rows: item.windowMissing, first_selected: item.firstWindowDate,
      last_selected: item.lastWindowDate, later_source_rows: item.rowsAfterWindow })),
      ['series', 'frequency', 'units', 'first_source', 'latest_source', 'selected_rows', 'missing_rows',
        'first_selected', 'last_selected', 'later_source_rows']);
    table('recurring-meaning', value.materialization.meaningChanges, ['series', 'field', 'before', 'after']);
    table('recurring-source', comparison.sourceChanges, ['field', 'before', 'after']);
    table('recurring-changes', comparison.rows.map(item => ({
      change: labels[item.kind] ?? item.kind, series: item.series, date: item.date, method: item.comparison,
      earlier_value: item.before?.current?.value ?? null, current_value: item.after?.current?.value ?? null,
      value_delta: item.currentValueDelta, earlier_baseline_date: item.before?.baselineDate ?? null,
      current_baseline_date: item.after?.baselineDate ?? null, earlier_baseline: item.before?.baseline?.value ?? null,
      current_baseline: item.after?.baseline?.value ?? null, change_delta: item.absoluteChangeDelta,
      details: item.reasons.join(', '), source_context: item.contextChanges.join(', ')
    })), ['change', 'series', 'date', 'method', 'earlier_value', 'current_value', 'value_delta',
      'earlier_baseline_date', 'current_baseline_date', 'earlier_baseline', 'current_baseline', 'change_delta',
      'details', 'source_context']);
    $('recurring-page').textContent = comparison.filteredCount
      ? (comparison.offset + 1) + '–' + Math.min(comparison.offset + comparison.limit, comparison.filteredCount) +
        ' of ' + comparison.filteredCount + ' selected comparisons (' + comparison.rowCount + ' total)'
      : 'No comparisons match this filter (' + comparison.rowCount + ' total).';
    syncButtons();
  }
  async function openCurrent(offset = 0) {
    if (!current) throw new Error('Preview a selection or open a saved successor.');
    const active = current, expected = ++generation, changesOnly = $('recurring-changes-only').checked;
    const value = active.mode === 'preview'
      ? await api('/api/briefing-successor-preview', { ...active.selection, offset, limit: 100, changesOnly })
      : await api('/api/briefing-successor?' + new URLSearchParams({
        successor: active.successorId, offset: String(offset), limit: '100', changesOnly: changesOnly ? '1' : '0' }));
    if (generation !== expected || active !== current) return null;
    current.value = value; render(value, active.mode); return value;
  }
  async function openSaved(successorId = $('recurring-history').value) {
    const successor = (state().briefingSuccessors ?? []).find(item => item.id === successorId);
    if (!successor) throw new Error('Choose a saved briefing successor.');
    $('recurring-template').value = successor.templateId; refreshTemplateDetails();
    $('recurring-history').value = successorId; current = { mode: 'saved', successorId };
    return openCurrent();
  }
  async function showMutation(result) {
    if (result.successorId) {
      await openSaved(result.successorId); message('The reviewed successor and its complete briefing files are saved.');
    } else if (result.templateId) {
      $('recurring-template').value = result.templateId; refreshTemplateDetails();
      message('The briefing template is saved. Choose the retained source for its next edition.');
    }
  }
  bind('template-form', async () => {
    const result = await mutate('template-save', { reviewId: $('template-review').value, name: $('template-name').value,
      window: { months: Number($('template-months').value), anchor: $('template-anchor').value,
        lagMonths: Number($('template-lag').value) }, previousTemplateId: $('template-previous').value || null });
    await showMutation(result);
  }, 'submit');
  $('template-review').addEventListener('change', () => {
    const review = state().reviews.find(item => item.id === $('template-review').value);
    if (review?.briefing) $('template-name').value = review.briefing.title;
  });
  $('recurring-template').addEventListener('change', () => { invalidate(); refreshTemplateDetails(); });
  for (const id of ['recurring-capture', 'recurring-previous', 'recurring-anchor', 'recurring-note'])
    $(id).addEventListener(id === 'recurring-note' || id === 'recurring-anchor' ? 'input' : 'change', invalidate);
  bind('recurring-preview', async () => {
    current = { mode: 'preview', selection: selection() };
    if (await openCurrent()) $('recurring-report-panel').scrollIntoView({ block: 'start' });
  });
  bind('recurring-save', async () => {
    if (current?.mode !== 'preview' || !current.value || current.value.revision !== state().revision)
      throw new Error('Preview the current selection before saving its successor.');
    if (JSON.stringify(selection()) !== JSON.stringify(current.selection))
      throw new Error('Selection changed. Preview the current values.');
    const active = current;
    const result = await mutate('successor-save', { ...active.selection, previewId: active.value.previewId }, active.value.revision);
    await showMutation(result);
  });
  bind('recurring-open', () => openSaved());
  bind('recurring-use', async () => {
    const successor = history().find(item => item.id === $('recurring-history').value);
    if (!successor) throw new Error('Choose a saved successor.');
    $('recurring-previous').value = successor.id; invalidate();
    $('recurring-status').textContent = 'Predecessor selected. Choose the next retained source and preview its briefing.';
  });
  bind('recurring-report', async () => {
    const successor = history().find(item => item.id === $('recurring-history').value);
    if (!successor) throw new Error('Choose a saved successor.'); await openBriefing(successor.reviewId);
  });
  for (const format of ['html', 'csv', 'json']) bind('recurring-' + format, async () => {
    const successorId = $('recurring-history').value;
    if (!history().some(item => item.id === successorId)) throw new Error('Choose a saved successor.');
    await download('/api/briefing-successor?' + new URLSearchParams({ successor: successorId, format }),
      'fred-briefing-successor.' + format);
  });
  bind('recurring-previous-page', () => openCurrent(Math.max(0, (current?.value?.comparison.offset ?? 0) - 100)));
  bind('recurring-next-page', async () => {
    const offset = current?.value?.comparison.nextOffset; if (offset !== null && offset !== undefined) await openCurrent(offset);
  });
  bind('recurring-changes-only', () => current ? openCurrent(0) : undefined, 'change');
  bind('recurring-resume', async () => {
    const request = pendingRequest(); if (!request) throw new Error('No recurring briefing request is retained.');
    const completed = state().operations.find(item => item.id === request.id);
    if (completed) { sessionStorage.removeItem(requestKey()); await showMutation(completed.result); return; }
    await showMutation(await transmit(request));
  });
  bind('recurring-discard', async () => {
    const latest = await api('/api/state');
    if (latest.busy || latest.project.pending)
      throw new Error('Continue the original project action before clearing the browser request.');
    sessionStorage.removeItem(requestKey()); await refresh();
    message('Browser request cleared. The project history is available; preview a new selection to continue.');
  });
  return { onState };
}
