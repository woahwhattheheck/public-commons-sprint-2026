// MIT. Analyst authoring and full retained report controls on the original private workspace.
const $ = id => document.getElementById(id), periods = new Set(['Monthly', 'Quarterly', 'Semiannual', 'Annual']);
const names = { previous_period: 'Previous period', year_earlier: 'Year earlier', previous_observation: 'Previous observation' };
export function mountFredBriefing({ api, download, event, table, select, getState, getCaptureId, chooseCapture, message }) {
  let captureId = null, metadata = [], generation = 0, current = null;
  const drafts = new Map(), controls = new Map();
  function chosenSpec() {
    if (!captureId) throw new Error('Select an original economic capture for this briefing.');
    return { schema: 'stellar-forge.fred-briefing-spec.v1', title: $('briefing-title').value,
      start: $('briefing-start').value, end: $('briefing-end').value,
      decimalPlaces: Number($('briefing-decimals').value), notes: $('briefing-notes').value,
      series: metadata.filter(item => controls.get(item.id)?.selected.checked).map(item => {
        const choice = controls.get(item.id);
        return { id: item.id, comparisons: Object.keys(names).filter(name => choice[name].checked && !choice[name].disabled),
          relativeChange: choice.relative.checked };
      }) };
  }
  function remember() {
    if (captureId) drafts.set(captureId, { enabled: $('briefing-enabled').checked, spec: chosenSpec() });
  }
  function invalidate() {
    generation++; remember();
    if (current?.mode === 'preview') {
      current = null; $('briefing-view-state').textContent = 'Selection changed. Preview the current original source selection.';
      $('briefing-previous').disabled = true; $('briefing-next').disabled = true;
    }
  }
  function checkbox(label, checked, disabled = false) {
    const holder = document.createElement('label'), input = document.createElement('input'), text = document.createElement('span');
    holder.className = 'check'; input.type = 'checkbox'; input.checked = checked; input.disabled = disabled; text.textContent = label;
    holder.append(input, text); input.addEventListener('change', invalidate); return { holder, input };
  }
  function applySpec(spec, enabled = true) {
    $('briefing-enabled').checked = enabled; $('briefing-controls').hidden = !enabled;
    $('briefing-title').value = spec.title ?? 'Economic briefing'; $('briefing-start').value = spec.start ?? '';
    $('briefing-end').value = spec.end ?? ''; $('briefing-decimals').value = spec.decimalPlaces ?? 6;
    $('briefing-notes').value = spec.notes ?? ''; controls.clear();
    const root = $('briefing-series'); root.replaceChildren();
    const grid = document.createElement('table'), head = document.createElement('thead'), row = document.createElement('tr'), body = document.createElement('tbody');
    for (const title of ['Original series', 'Previous period', 'Year earlier', 'Previous observation', 'Relative percent']) {
      const th = document.createElement('th'); th.textContent = title; row.append(th);
    }
    head.append(row);
    for (const item of metadata) {
      const wanted = spec.series?.find(value => value.id === item.id), line = document.createElement('tr'), cell = document.createElement('td');
      const primary = checkbox(item.id + ' · ' + item.title, Boolean(wanted)), detail = document.createElement('small');
      detail.textContent = item.frequency + ' · ' + item.units + ' · ' + item.seasonalAdjustment;
      cell.append(primary.holder, detail); line.append(cell);
      const chosen = { selected: primary.input }, regular = periods.has(item.frequency),
        prior = regular || item.frequency === 'Daily' || /^(?:Weekly|Biweekly)(?:,|$)/.test(item.frequency);
      for (const name of Object.keys(names)) {
        const td = document.createElement('td'), control = checkbox(names[name], Boolean(wanted?.comparisons?.includes(name)),
          name === 'previous_period' ? !prior : name === 'year_earlier' ? !regular : false);
        if (control.input.disabled) control.holder.title = 'This exact calendar comparison is not defined for the original source frequency.';
        chosen[name] = control.input; td.append(control.holder); line.append(td);
      }
      const td = document.createElement('td'), relative = checkbox('Include relative %', wanted?.relativeChange === true);
      chosen.relative = relative.input; td.append(relative.holder); line.append(td); body.append(line); controls.set(item.id, chosen);
    }
    grid.append(head, body); root.append(grid); generation++; remember();
  }
  function onCapture(id, series) {
    if (!id || id !== getCaptureId()) return;
    if (captureId === id) return;
    remember(); captureId = id;
    metadata = series ?? getState()?.captures.find(item => item.id === id)?.series ?? [];
    const original = getState().captures.find(item => item.id === id), retained = drafts.get(id);
    const spec = retained?.spec ?? { title: 'Economic briefing', start: original.selection.start, end: original.selection.end,
      decimalPlaces: 6, notes: '', series: metadata.map(item => ({ id: item.id,
        comparisons: periods.has(item.frequency) ? ['previous_period', 'year_earlier'] : ['previous_observation'], relativeChange: false })) };
    applySpec(spec, retained?.enabled ?? false);
    if (current?.mode === 'preview') { current = null; $('briefing-view-state').textContent = 'Original capture changed. Preview its current briefing selection.'; }
  }
  function onState() {
    const state = getState(), reviews = state.reviews.filter(item => item.briefing);
    select('briefing-saved', reviews.map(item => [item.id, item.briefing.title + ' · ' + item.id.slice(0, 12)]));
    const enabled = reviews.length > 0;
    for (const id of ['briefing-open', 'briefing-copy', 'briefing-html', 'briefing-csv', 'briefing-json', 'briefing-manifest']) $(id).disabled = !enabled;
    const id = getCaptureId(), original = state.captures.find(item => item.id === id);
    if (original) onCapture(id, original.series);
  }
  function render(value, mode) {
    const summary = $('briefing-summary'); summary.replaceChildren();
    for (const [label, count] of [['Series', value.series.length], ['Selected observations', value.selectedRows], ['Missing observations', value.missing], ['Period comparisons', value.measureCount]]) {
      const box = document.createElement('div'), strong = document.createElement('strong'), text = document.createElement('span');
      box.className = 'metric'; strong.textContent = count; text.textContent = label; box.append(strong, text); summary.append(box);
    }
    table('briefing-series-summary', value.series.map(item => ({ series: item.id, title: item.title,
      frequency: item.frequency, units: item.units, latest_date: item.latest?.date ?? null, latest_value: item.latest?.value ?? null,
      missing: item.selectedMissing, selected: item.selectedRows, source_updated: item.lastUpdated ?? null })),
    ['series', 'title', 'frequency', 'units', 'latest_date', 'latest_value', 'missing', 'selected', 'source_updated']);
    table('briefing-measures', value.measures.map(item => ({ series: item.series, date: item.date, value: item.current.value,
      comparison: names[item.comparison], baseline_date: item.baselineDate, baseline_value: item.baseline?.value ?? null,
      state: item.state, absolute_change: item.absoluteChange, change_units: item.changeUnits, relative_percent: item.relativePercent,
      relative_state: item.relativeState, source_as_of: item.current.as_of, time_basis: item.current.time_basis })),
    ['series', 'date', 'value', 'comparison', 'baseline_date', 'baseline_value', 'state', 'absolute_change', 'change_units', 'relative_percent', 'relative_state', 'source_as_of', 'time_basis']);
    $('briefing-view-state').textContent = (mode === 'saved' ? 'Saved briefing' : 'Preview') + ' · ' + value.title + ' · ' +
      (value.measureCount ? value.offset + 1 : 0) + '–' + Math.min(value.offset + value.limit, value.measureCount) + ' of ' +
      value.measureCount + ' comparisons · ' + (value.reportId ?? value.previewId);
    $('briefing-method-summary').textContent = 'Exact decimal subtraction; relative change = ' + value.calculation.relativeFormula +
      '. Relative results use ' + value.calculation.relativeDecimalPlaces + ' decimal places and half-even rounding. ' +
      value.calculation.baselineSource + '. ' + value.calculation.previousObservation + '.';
    $('briefing-previous').disabled = value.offset === 0; $('briefing-next').disabled = value.nextOffset === null;
  }
  async function openCurrent(offset = 0) {
    if (!current) throw new Error('Preview a selection or open a saved briefing first.');
    const active = current, expectedGeneration = ++generation;
    const value = active.mode === 'saved'
      ? await api('/api/briefing?' + new URLSearchParams({ review: active.reviewId, offset: String(offset) }))
      : await api('/api/briefing-preview', { captureId: active.captureId, briefing: active.spec, offset });
    if (expectedGeneration !== generation || active !== current) return null;
    active.value = value; render(value, active.mode); return value;
  }
  async function openSaved(reviewId = $('briefing-saved').value) {
    const review = getState().reviews.find(item => item.id === reviewId);
    if (!review?.briefing) throw new Error('Select an original saved analyst briefing.');
    $('briefing-saved').value = reviewId; current = { mode: 'saved', reviewId };
    return openCurrent(0);
  }
  $('briefing-enabled').addEventListener('change', () => { $('briefing-controls').hidden = !$('briefing-enabled').checked; invalidate(); });
  for (const id of ['briefing-title', 'briefing-start', 'briefing-end', 'briefing-decimals', 'briefing-notes'])
    $(id).addEventListener('input', invalidate);
  event('briefing-preview', async () => {
    current = { mode: 'preview', captureId: getCaptureId(), spec: chosenSpec() };
    const result = await openCurrent(0);
    if (result) { $('briefing-report-panel').scrollIntoView({ block: 'start' }); message('Original-source briefing preview is ready. Save the reviewed edition to retain its complete files.'); }
  });
  event('briefing-open', () => openSaved());
  event('briefing-saved', () => openSaved(), 'change');
  event('briefing-previous', () => openCurrent(Math.max(0, (current?.value?.offset ?? 0) - 100)));
  event('briefing-next', () => {
    if (current?.value?.nextOffset !== null && current?.value?.nextOffset !== undefined) return openCurrent(current.value.nextOffset);
  });
  event('briefing-copy', async () => {
    const review = getState().reviews.find(item => item.id === $('briefing-saved').value);
    if (!review?.briefing) throw new Error('Select an original saved analyst briefing.');
    await chooseCapture(review.captureId); applySpec(review.briefing, true);
    $('policy').value = JSON.stringify(review.policy, null, 2); $('review-note').value = review.note;
    $('briefing-editor').scrollIntoView({ block: 'start' }); message('The saved original source, projection and briefing selection are loaded for review.');
  });
  for (const format of ['html', 'csv', 'json', 'manifest']) event('briefing-' + format, () => {
    const reviewId = $('briefing-saved').value;
    if (!getState().reviews.some(item => item.id === reviewId && item.briefing)) throw new Error('Select a saved briefing.');
    return download('/api/briefing?' + new URLSearchParams({ review: reviewId, format }), 'briefing.' + format);
  });
  return { onState, onCapture, selection: () => {
    if (!$('briefing-enabled').checked) return null;
    if (captureId !== getCaptureId()) throw new Error('Open the selected source before saving its briefing.');
    return chosenSpec();
  }, afterSave: async result => { if (result.briefing) await openSaved(result.reviewId); } };
}
