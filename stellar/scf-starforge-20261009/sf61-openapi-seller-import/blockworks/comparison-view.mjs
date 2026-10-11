// MIT. Complete retained comparison viewer. Filtering and paging never change export bytes.
// DOM only: the caller supplies the saved comparison and its original JSON text.
const LABELS = {
  equivalent: 'Equivalent under the reviewed mapping', different: 'Differences found',
  inconclusive: 'Values need further review', needs_review: 'Mapping review required',
  match: 'Matching recorded fields', baseline_only: 'Baseline record only', candidate_only: 'Candidate record only',
  exact: 'Exact match', within_tolerance: 'Within reviewed tolerance', presence_mismatch: 'Different field presence',
  both_null: 'Both null; no value comparison', both_absent: 'Both fields absent',
  uncomparable: 'Value could not be compared'
};
const asText = value => value === undefined ? 'Unspecified' : value === null ? 'null' :
  typeof value === 'object' ? JSON.stringify(value) : String(value);
const label = value => LABELS[value] ?? String(value ?? 'Unspecified');
const exact = value => value && typeof value === 'object' && typeof value.exact === 'string' ? value.exact : asText(value);

/**
 * Render a complete blockworks-comparison/v1.
 * onOpenSource({side,source,location}) may open the original application capture inspector.
 * sourceText is the original uncompressed readSource JSON; full export uses it unchanged.
 */
export function renderComparison(target, comparison, { sourceText, onOpenSource, pageSize = 50 } = {}) {
  if (!target?.ownerDocument || typeof target.replaceChildren !== 'function') throw new TypeError('Choose a comparison container.');
  if (!comparison || comparison.schemaVersion !== 'blockworks-comparison/v1') throw new TypeError('Open a retained blockworks-comparison/v1 result.');
  if (sourceText !== undefined && typeof sourceText !== 'string') throw new TypeError('Retain the original JSON text for full export.');
  if (![25, 50, 100, 250].includes(pageSize)) throw new TypeError('Choose a supported display page size.');
  const document = target.ownerDocument;
  const node = (tag, text, className) => {
    const result = document.createElement(tag);
    if (text !== undefined) result.textContent = asText(text);
    if (className) result.className = className;
    return result;
  };
  const pre = value => node('pre', JSON.stringify(value, null, 2));
  const statusNode = status => node('span', label(status), 'status');
  const line = (title, value) => {
    const p = node('p'); p.append(node('strong', title + ': '), node('span', value)); return p;
  };
  const error = node('p', '', 'hint'); error.setAttribute('role', 'status'); error.setAttribute('aria-live', 'polite');
  const button = (title, work) => {
    const b = node('button', title, 'small-button'); b.type = 'button';
    b.addEventListener('click', async () => {
      try { error.textContent = ''; await work(); } catch (problem) { error.textContent = problem.message; }
    });
    return b;
  };
  const actions = (...values) => { const result = node('div', undefined, 'actions'); result.append(...values); return result; };
  const table = (headings, values, caption) => {
    const wrapper = node('div', undefined, 'table-wrap'), t = node('table'), head = node('thead'), tr = node('tr'), body = node('tbody');
    if (caption) t.append(node('caption', caption));
    for (const title of headings) { const th = node('th', title); th.scope = 'col'; tr.append(th); }
    head.append(tr); t.append(head, body);
    for (const row of values) {
      const r = node('tr');
      for (const value of row) { const td = node('td'); td.append(value?.nodeType ? value : document.createTextNode(asText(value))); r.append(td); }
      body.append(r);
    }
    wrapper.append(t); return wrapper;
  };
  const details = (title, work) => {
    const result = node('details'); result.append(node('summary', title)); let loaded = false;
    result.addEventListener('toggle', () => {
      if (result.open && !loaded) { loaded = true; result.append(work()); }
    });
    return result;
  };
  const download = (filename, body, type = 'application/json;charset=utf-8') => {
    const view = document.defaultView ?? globalThis;
    const url = view.URL.createObjectURL(new view.Blob([body], { type }));
    const anchor = node('a'); anchor.href = url; anchor.download = filename;
    document.body.append(anchor); anchor.click(); anchor.remove();
    view.setTimeout(() => view.URL.revokeObjectURL(url), 1000);
  };
  const filename = (comparison.mappingId || 'comparison').replace(/[^a-zA-Z0-9._-]/g, '_') + '-comparison.json';
  const packed = (cell, recordPresent = true) => {
    const result = node('div');
    if (!recordPresent) { result.append(node('span', 'No record on this side', 'hint')); return result; }
    if (!cell || cell.state === 'absent') { result.append(node('code', 'Absent field')); return result; }
    if (cell.state === 'null') { result.append(node('code', 'null')); return result; }
    if (cell.type === 'utc-seconds') {
      result.append(node('span', 'UTC seconds: ', 'hint'), node('code', exact(cell))); return result;
    }
    result.append(node('span', (cell.type || 'value') + ': ', 'hint'));
    result.append(node('code', cell.type === 'string' ? JSON.stringify(cell.value) :
      cell.type === 'number' ? String(cell.value) : asText(cell.value)));
    return result;
  };
  const rows = Array.isArray(comparison.rows) ? comparison.rows : [];
  const measureDefinitions = new Map((comparison.measures ?? []).map(value => [value.id, value]));
  const root = node('section', undefined, 'comparison-view');
  root.setAttribute('aria-label', 'Retained result comparison');
  const summary = comparison.summary ?? {};
  root.append(node('h3', 'Result comparison'), statusNode(comparison.status), line('Mapping', comparison.mappingId));
  root.append(table(['Recorded result', 'Count'], [
    ['Retained records', rows.length], ['Matched records', summary.matchedRecords ?? 0],
    ['Baseline-only records', summary.onlyBaseline ?? 0], ['Candidate-only records', summary.onlyCandidate ?? 0],
    ['Exactly matching values', summary.exactValues ?? 0], ['Values within tolerance', summary.withinToleranceValues ?? 0],
    ['Different values', summary.differentValues ?? 0], ['Both-null values', summary.bothNullValues ?? 0],
    ['Both-absent values', summary.bothAbsentValues ?? 0], ['Uncomparable values', summary.uncomparableValues ?? 0]
  ], 'Complete recorded population'));
  root.append(node('p', 'Numbers retain their original decimal text. Strings retain their type and quotes. Null, an absent field and a missing record are shown separately.', 'hint'));
  root.append(actions(button('Download full comparison JSON', () => download(filename, sourceText ?? JSON.stringify(comparison))),
    button('Download source and calculation index', () => download(filename.replace('.json', '-sources.json'),
      JSON.stringify({ schemaVersion: comparison.schemaVersion, comparisonId: comparison.comparisonId, reviewId: comparison.reviewId,
        mappingId: comparison.mappingId, window: comparison.window, coverage: comparison.coverage, measures: comparison.measures,
        decisions: comparison.decisions, calculation: comparison.calculation }, null, 2)))));
  root.append(error);
  const sources = comparison.coverage ?? {};
  root.append(details('Original sources, window and calculation', () => {
    const view = node('div');
    view.append(table(['Side', 'Original source', 'Coverage', 'Retained / selected / excluded'], ['baseline', 'candidate'].map(side => {
      const source = sources[side] ?? {};
      return [side, source.id ?? 'Unspecified', source.coverageKind ?? 'Unspecified',
        [source.records ?? 0, source.selectedRecords ?? 0, source.excludedRecords ?? 0].join(' / ')];
    })));
    view.append(pre({ comparisonId: comparison.comparisonId, reviewId: comparison.reviewId,
      window: comparison.window, calculation: comparison.calculation, coverage: sources, measures: comparison.measures, decisions: comparison.decisions }));
    return view;
  }));
  if (comparison.issues?.length) root.append(table(['Review issue', 'Area', 'Original details'], comparison.issues.map(issue => [
    actions(statusNode(issue.severity), node('span', issue.message ?? issue.code)), issue.path ?? '',
    details('Open issue details', () => pre(issue))
  ]), 'Retained review issues'));
  const controls = node('div', undefined, 'actions');
  const inputLabel = (title, control) => { const result = node('label', title); result.append(control); return result; };
  const search = node('input'); search.type = 'search'; search.placeholder = 'Original ID, value, key, capture or pointer';
  const status = node('select'), measure = node('select'), size = node('select');
  const option = (control, value, title) => { const o = node('option', title); o.value = value; control.append(o); };
  for (const [value, title] of [
    ['all', 'All results'], ['changes', 'Differences and unmatched records'], ['match', 'Matching recorded fields'],
    ['different', 'Different values'], ['baseline_only', 'Baseline records only'], ['candidate_only', 'Candidate records only'],
    ['inconclusive', 'Inconclusive records']
  ]) option(status, value, title);
  option(measure, '', 'All measures');
  const measureIds = new Set([...measureDefinitions.keys(), ...rows.flatMap(row => (row.measures ?? []).map(value => value.id))]);
  for (const id of measureIds) option(measure, id, id);
  for (const count of [25, 50, 100, 250]) option(size, String(count), String(count));
  size.value = String(pageSize);
  controls.append(inputLabel('Find original record', search), inputLabel('Result', status), inputLabel('Measure display', measure), inputLabel('Records per page', size));
  const resultCount = node('p', '', 'hint'); resultCount.setAttribute('role', 'status'); resultCount.setAttribute('aria-live', 'polite');
  const body = node('div'); const navigation = node('div', undefined, 'actions'); const pageLabel = node('span');
  let page = 0, filtered = rows, timer = null;
  const previous = button('Previous page', () => { if (page > 0) { page--; draw(); } });
  const next = button('Next page', () => { if ((page + 1) * pageSize < filtered.length) { page++; draw(); } });
  navigation.append(previous, pageLabel, next);
  root.append(node('h4', 'Original records'), controls, resultCount, navigation, body);
  target.replaceChildren(root);
  const searchCache = new WeakMap();
  const textFor = row => {
    if (!searchCache.has(row)) searchCache.set(row, JSON.stringify({
      rowId: row.rowId, status: row.status, baseline: row.baseline, candidate: row.candidate, measures: row.measures
    }).toLowerCase());
    return searchCache.get(row);
  };
  const sourceRecord = (row, side) => {
    const record = row[side], result = node('div');
    result.append(node('h5', side === 'baseline' ? 'Baseline source record' : 'Candidate source record'));
    if (!record) { result.append(node('p', 'No record on this side.', 'hint')); return result; }
    const location = record.location ?? {}, source = sources[side] ?? {};
    result.append(line('Capture', location.captureId), line('Original JSON pointer', location.pointer));
    if (location.row !== undefined) result.append(line('Original row index', location.row));
    if (location.series !== undefined) result.append(line('Original series index', location.series));
    if (location.point !== undefined) result.append(line('Original point index', location.point));
    if (location.seriesKey) result.append(packed(location.seriesKey));
    result.append(table(['Mapped key', 'Original value', 'Canonical value', 'Retained decision'], (record.keys ?? []).map(key => [
      key.id, packed(key.original), packed(key.canonical), key.decisionId ?? ''
    ])));
    if (typeof onOpenSource === 'function') result.append(button('Open original ' + side + ' capture', () =>
      onOpenSource({ side, source, location })));
    result.append(details('Capture and record identities', () => pre({
      source: { id: source.id, digest: source.digest, request: source.request },
      capture: source.captures?.find(capture => capture.id === location.captureId), location, keys: record.keys
    })));
    return result;
  };
  const measureView = (row, value) => {
    const definition = measureDefinitions.get(value.id) ?? {}, calculation = node('div');
    const interpretation = value.interpretation ?? definition.interpretation;
    calculation.append(line('Interpretation', interpretation ?? 'Retained original value'));
    if (definition.conversion) calculation.append(line('Candidate-to-baseline calculation', 'candidate * ' + asText(definition.conversion.factor) + ' + ' + asText(definition.conversion.offset)));
    if (definition.tolerance) calculation.append(line('Reviewed tolerance', 'absolute ' + asText(definition.tolerance.absolute) + ', relative ' + asText(definition.tolerance.relative)));
    if (value.convertedCandidate) calculation.append(line('Candidate after conversion', exact(value.convertedCandidate)));
    if (value.absoluteDifference) calculation.append(line('Exact absolute difference', exact(value.absoluteDifference)));
    if (value.allowedDifference) calculation.append(line('Allowed difference', exact(value.allowedDifference)));
    for (const [title, id] of [['Conversion decision', value.conversionDecisionId], ['Tolerance decision', value.toleranceDecisionId]]) if (id) {
      calculation.append(line(title, id));
      const decision = comparison.decisions?.find(item => item.id === id);
      if (decision) calculation.append(details('Open ' + title.toLowerCase(), () => pre(decision)));
    }
    if (value.reason) calculation.append(node('p', value.reason));
    if (value.comparison) calculation.append(node('p', value.comparison, 'hint'));
    calculation.append(details('Units, dimensions and exact value objects', () => pre({
      definition, baselineNumber: value.baselineNumber, candidateNumber: value.candidateNumber,
      convertedCandidate: value.convertedCandidate, absoluteDifference: value.absoluteDifference, allowedDifference: value.allowedDifference
    })));
    const resultStatus = value.status ?? (row.baseline ? 'baseline_only' : 'candidate_only');
    const baselineCell = packed(value.baseline, Boolean(row.baseline)), candidateCell = packed(value.candidate, Boolean(row.candidate));
    baselineCell.append(node('p', 'Declared unit: ' + (definition.baselineUnit ?? 'none'), 'hint'));
    candidateCell.append(node('p', 'Declared unit: ' + (definition.candidateUnit ?? 'none'), 'hint'));
    return [value.id, baselineCell, candidateCell, statusNode(resultStatus), calculation];
  };
  function draw() {
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize)); page = Math.min(page, pages - 1);
    const start = page * pageSize, visible = filtered.slice(start, start + pageSize);
    previous.disabled = page === 0; next.disabled = page + 1 >= pages;
    pageLabel.textContent = 'Page ' + (page + 1) + ' of ' + pages;
    resultCount.textContent = filtered.length + ' of ' + rows.length + ' retained records match. Showing ' +
      (visible.length ? start + 1 : 0) + ' through ' + (start + visible.length) + '. Full export includes all ' + rows.length + ' records.';
    body.replaceChildren();
    if (!visible.length) { body.append(node('p', rows.length ? 'No records match these filters.' : 'This retained result has no comparison records.', 'hint')); return; }
    for (const [index, row] of visible.entries()) {
      const record = node('article');
      record.append(node('h4', 'Record ' + (start + index + 1)), statusNode(row.status));
      const identity = node('code', row.rowId); identity.setAttribute('aria-label', 'Comparison record identity'); const identityLine = node('p'); identityLine.append(identity); record.append(identityLine);
      const keys = row.baseline?.keys ?? row.candidate?.keys ?? [];
      record.append(table(['Mapped key', 'Canonical value'], keys.map(key => [key.id, packed(key.canonical)])));
      const values = (row.measures ?? []).filter(value => !measure.value || value.id === measure.value);
      record.append(table(['Measure', 'Original baseline', 'Original candidate', 'Value result', 'Calculation'], values.map(value => measureView(row, value))));
      record.append(details('Original record locations and identity decisions', () => {
        const original = node('div'); original.append(sourceRecord(row, 'baseline'), sourceRecord(row, 'candidate')); return original;
      }));
      record.append(button('Download this original comparison record', () => download(
        filename.replace('.json', '-' + String(row.rowId).slice(0, 16) + '.json'),
        JSON.stringify({ comparisonId: comparison.comparisonId, reviewId: comparison.reviewId, record: row }, null, 2))));
      body.append(record);
    }
  }
  function filter() {
    const query = search.value.trim().toLowerCase();
    filtered = rows.filter(row => {
      const statusMatches = status.value === 'all' || (status.value === 'changes' ?
        ['different', 'baseline_only', 'candidate_only'].includes(row.status) : row.status === status.value);
      return statusMatches && (!query || textFor(row).includes(query));
    });
    page = 0; draw();
  }
  search.addEventListener('input', () => {
    if (timer !== null) (document.defaultView ?? globalThis).clearTimeout(timer);
    timer = (document.defaultView ?? globalThis).setTimeout(() => { timer = null; if (target.contains(root)) filter(); }, 160);
  });
  status.addEventListener('change', filter);
  measure.addEventListener('change', () => { page = 0; draw(); });
  size.addEventListener('change', () => { pageSize = Number(size.value); page = 0; draw(); });
  draw();
  return { container: root, retainedRecords: rows.length, refresh: filter, dispose() {
    if (timer !== null) (document.defaultView ?? globalThis).clearTimeout(timer);
    if (target.contains(root)) root.remove();
  } };
}
