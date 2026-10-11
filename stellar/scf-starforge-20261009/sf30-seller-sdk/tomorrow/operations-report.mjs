import { OPERATIONS_SCHEMA, OperationsReviewError } from './operations-analysis.mjs';

const clone = value => JSON.parse(JSON.stringify(value));
const str = value => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const esc = value => str(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const anchor = (kind, value) => kind + '-' + encodeURIComponent(str(value));
const list = value => Array.isArray(value) ? value : [];
const fmt = value => value == null ? 'Not recorded' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const label = value => str(value).replaceAll('_', ' ').toLowerCase();
const csvCell = value => {
  let result = str(value);
  if (typeof value === 'string' && /^[\s\u0000-\u001f]*[=+@-]/.test(result)) result = "'" + result;
  return '"' + result.replaceAll('"', '""') + '"';
};

function licensedValues(edition, now) {
  const expiry = Date.parse(edition.rawExpiresAt);
  const licenseExpiry = edition.usage?.expiresAt ? Date.parse(edition.usage.expiresAt) : Infinity;
  return edition.usage?.mode === 'licensed-service' && edition.usage.exportRaw === true &&
    edition.rawAvailability === 'AVAILABLE' && Number.isFinite(expiry) && now < expiry &&
    (licenseExpiry === Infinity || Number.isFinite(licenseExpiry) && now < licenseExpiry);
}

/**
 * A fresh export guard, separate from the live no-store view. Expired and
 * keyless values are never serialized into report JSON, CSV or HTML.
 */
export function retainedOperationsReview(review) {
  if (review?.schema !== OPERATIONS_SCHEMA) throw new OperationsReviewError('Unsupported operations review schema');
  const result = clone(review), now = Date.now(), permissions = new Map();
  for (const edition of list(result.editions)) {
    const permitted = licensedValues(edition, now);
    permissions.set(edition.id, permitted);
    edition.reportValues = permitted ? 'LICENSED_VALUES_INCLUDED' : 'DERIVED_METADATA_ONLY';
  }
  const redactChange = change => {
    const before = permissions.get(change.beforeEditionId ?? change.beforeId) === true;
    const after = permissions.get(change.afterEditionId ?? change.afterId) === true;
    if (!before) { change.before = null; change.beforeValueState = 'NOT_RETAINABLE'; }
    else change.beforeValueState = 'RETAINED';
    if (!after) { change.after = null; change.afterValueState = 'NOT_RETAINABLE'; }
    else change.afterValueState = 'RETAINED';
    if (!(before && after)) { change.change = null; change.changeValueState = 'NOT_RETAINABLE'; }
    else change.changeValueState = 'RETAINED';
  };
  for (const row of [...list(result.intervals), ...list(result.queue)]) {
    const permitted = permissions.get(row.editionId) === true;
    for (const field of list(row.fields)) {
      field.valueState = permitted ? field.present && field.value !== null ? 'RETAINED' : 'SOURCE_UNAVAILABLE' : 'NOT_RETAINABLE';
      if (!permitted) field.value = null;
    }
    for (const change of list(row.changes)) redactChange(change);
  }
  for (const comparison of list(result.comparisons)) {
    for (const row of list(comparison.rows)) {
      row.beforeEditionId = comparison.beforeId;
      row.afterEditionId = comparison.afterId;
      redactChange(row);
    }
  }
  result.report = {
    schema: 'stellar-forge.tomorrow.operations-report.v1',
    generatedAt: new Date(now).toISOString(),
    licensedEditionsWithValues: [...permissions.values()].filter(Boolean).length,
    derivedOnlyEditions: [...permissions.values()].filter(value => !value).length,
    sourceReviewId: result.id,
    retention: 'Provider values are included only for currently available licensed-service editions with exportRaw enabled and unexpired configured retention. Other editions retain source hashes, work rules and derived staff review metadata.',
    attribution: { label: 'Powered by Tomorrow.io', url: 'https://www.tomorrow.io/' },
  };
  return result;
}

function csvReport(review) {
  const headers = ['record_type','work_id','edition_id','interval_id','timestep','start_time','source_sha256',
    'assignee','decision','revision','applicability','field','unit','value_json','value_state','exposure',
    'rule_id','operator','threshold_json','triggered','before_edition_id','before_json','after_json','change_json',
    'comparison_status','note','detail_json'];
  const rows = [], add = (type, fields) => rows.push({ record_type: type, ...fields });
  add('summary', { detail_json: JSON.stringify({ reviewId: review.id, summary: review.summary, report: review.report }) });
  for (const work of review.workPlans) add('work_plan', { work_id: work.id, edition_id: work.activeEditionId,
    source_sha256: work.sourceSha256, detail_json: JSON.stringify(work) });
  for (const assignment of review.assignments) add('assignment', { assignee: assignment.assignee, detail_json: JSON.stringify(assignment) });
  for (const edition of review.editions) add('source_edition', { work_id: edition.workId, edition_id: edition.id,
    source_sha256: edition.sourceSha256, detail_json: JSON.stringify(edition) });
  for (const row of review.intervals) {
    const common = { work_id: row.workId, edition_id: row.editionId, interval_id: row.id, timestep: row.timestep,
      start_time: row.startTime, source_sha256: row.sourceSha256, assignee: row.assignee };
    add('interval', { ...common, decision: row.latestDecision?.decision, revision: row.latestDecision?.revision,
      detail_json: JSON.stringify({ withinWindow: row.withinWindow, activeEdition: row.isActiveEdition,
        observationAvailability: row.observationAvailability, needsReview: row.needsReview, reasons: row.reasonCodes }) });
    for (const field of row.fields) add('source_field', { ...common, field: field.field, unit: field.unit,
      value_json: field.valueState === 'NOT_RETAINABLE' ? '' : JSON.stringify(field.value), value_state: field.valueState,
      exposure: field.exposure, detail_json: JSON.stringify({ present: field.present, quality: field.quality, source: field.source }) });
    for (const rule of row.rules) add('rule_result', { ...common, field: rule.field, unit: rule.unit, rule_id: rule.id,
      operator: rule.operator, threshold_json: JSON.stringify(rule.value), triggered: rule.triggered,
      note: rule.explanation });
  }
  for (const record of review.decisions) add('decision_revision', { work_id: record.workId, edition_id: record.editionId,
    interval_id: record.intervalId, timestep: record.timestep, start_time: record.startTime,
    source_sha256: record.sourceSha256, assignee: record.assignee, decision: record.decision,
    revision: record.revision, applicability: record.applicability, note: record.note,
    detail_json: JSON.stringify({ id: record.id, createdAt: record.createdAt, rulesTriggered: record.rulesTriggered }) });
  for (const comparison of review.comparisons) {
    add('comparison', { before_edition_id: comparison.beforeId, edition_id: comparison.afterId,
      comparison_status: comparison.comparable ? 'COMPARABLE' : comparison.reason, detail_json: JSON.stringify({ attribution: comparison.attribution }) });
    for (const row of list(comparison.rows)) add('comparison_field', { before_edition_id: comparison.beforeId,
      edition_id: comparison.afterId, timestep: row.timestep, start_time: row.startTime, field: row.field, unit: row.unit,
      before_json: row.beforeValueState === 'NOT_RETAINABLE' ? '' : JSON.stringify(row.before),
      after_json: row.afterValueState === 'NOT_RETAINABLE' ? '' : JSON.stringify(row.after),
      change_json: row.changeValueState === 'NOT_RETAINABLE' ? '' : JSON.stringify(row.change),
      comparison_status: row.status,
      detail_json: JSON.stringify({ beforePresent: row.beforePresent, afterPresent: row.afterPresent,
        beforeValueState: row.beforeValueState, afterValueState: row.afterValueState, changeValueState: row.changeValueState }) });
  }
  for (const item of review.issues) add('source_note', { work_id: item.workId, edition_id: item.editionId,
    interval_id: item.intervalId, note: item.message, detail_json: JSON.stringify(item) });
  return headers.map(csvCell).join(',') + '\r\n' + rows.map(row => headers.map(header => csvCell(row[header] ?? '')).join(',')).join('\r\n') + '\r\n';
}

const CSS = [
  ':root{color-scheme:light;font-family:Arial,Helvetica,sans-serif;color:#202428;background:#f3f4f5;font-size:14px;line-height:1.5}',
  '*{box-sizing:border-box}body{margin:0}main{max-width:1440px;margin:0 auto;padding:32px}h1,h2,h3,p{margin-top:0}',
  'h1{font-size:28px;line-height:1.2;margin-bottom:8px}h2{font-size:20px;margin-bottom:16px}h3{font-size:16px;margin-bottom:10px}',
  'header{border-bottom:2px solid #30363b;padding-bottom:20px;margin-bottom:24px}a{color:inherit;text-decoration:underline;text-underline-offset:3px}',
  'nav{display:flex;flex-wrap:wrap;gap:10px 20px;margin-top:16px}section{background:#fff;border:1px solid #cbd0d5;padding:22px;margin:20px 0;border-radius:2px}',
  '.muted{color:#535c63}.small{font-size:12px}.mono,code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}',
  '.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:20px 0}.metric{border:1px solid #cbd0d5;background:#fff;padding:14px}.metric strong{display:block;font-size:26px}',
  '.toolbar{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin:16px 0}input,button{font:inherit;border:1px solid #879198;background:white;padding:8px 12px;border-radius:2px}input{flex:1;min-width:180px}button{cursor:pointer}button:hover{background:#eef0f2}',
  '.table-wrap{overflow-x:auto;max-width:100%;border:1px solid #d6dadf}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:9px 11px;border-bottom:1px solid #e0e3e6;text-align:left;vertical-align:top}th{background:#eef0f2;font-weight:600;white-space:nowrap}tr:last-child td{border-bottom:0}',
  '.tag{display:inline-block;border:1px solid #aeb6bd;border-radius:2px;padding:1px 6px;margin:2px 4px 2px 0;font-size:11px;white-space:normal}.emphasis{font-weight:700;background:#e9ecef}',
  '.notice{border-left:3px solid #59636c;padding:10px 14px;background:#f3f4f5;margin:12px 0}.empty{padding:12px;color:#535c63}',
  '.plan-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.plan{border:1px solid #d6dadf;padding:16px}dl{margin:0;display:grid;grid-template-columns:minmax(90px,auto) 1fr;gap:5px 14px}dt{color:#535c63}dd{margin:0;min-width:0;overflow-wrap:anywhere}',
  'details{border-top:1px solid #d6dadf;padding:14px 0}summary{cursor:pointer;font-weight:600;overflow-wrap:anywhere}details[open]>summary{margin-bottom:12px}.detail-head{display:flex;flex-wrap:wrap;gap:8px 20px;margin-bottom:14px}',
  'ul{margin:6px 0 12px;padding-left:20px}.notes{white-space:pre-wrap;overflow-wrap:anywhere}.source{overflow-wrap:anywhere}footer{border-top:1px solid #cbd0d5;padding-top:18px;margin-top:24px}',
  '[hidden]{display:none!important}@media(max-width:700px){main{padding:16px}section{padding:14px}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.plan-grid{grid-template-columns:1fr}h1{font-size:24px}th,td{padding:8px}dl{grid-template-columns:1fr}dd{margin-bottom:6px}}',
  '@media print{body{background:#fff}main{max-width:none;padding:0;font-size:10pt}section{border:0;border-top:1px solid #aaa;padding:12px 0;break-inside:auto}.toolbar,nav{display:none}.metrics{grid-template-columns:repeat(4,1fr)}.table-wrap{overflow:visible;border:0}table{font-size:9pt;table-layout:fixed}th,td{white-space:normal;overflow-wrap:anywhere;padding:5px}thead{display:table-header-group}tr,.plan{break-inside:avoid}details{break-inside:auto}a{text-decoration:none}h2,h3{break-after:avoid}header{margin-bottom:12px}}',
].join('\n');

function htmlReport(review) {
  const tags = values => list(values).map(value => '<span class="tag">' + esc(label(value)) + '</span>').join('');
  const table = (headings, rows, empty = 'No records in this selection.') => !rows.length ? '<p class="empty">' + esc(empty) + '</p>' :
    '<div class="table-wrap"><table><thead><tr>' + headings.map(h => '<th scope="col">' + esc(h) + '</th>').join('') +
    '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  const tr = cells => '<tr data-search-row>' + cells.map(cell => '<td>' + cell + '</td>').join('') + '</tr>';
  const source = editionId => '<a class="mono small" href="#' + esc(anchor('edition', editionId)) + '">' + esc(editionId) + '</a>';
  const rowLink = row => '<a href="#' + esc(anchor('interval', row.editionId + '/' + row.id)) + '">' + esc(row.startTime) + '</a><br><span class="small muted">' + esc(row.timestep) + '</span>';
  const value = (original, state) => state === 'NOT_RETAINABLE' ? '<span class="muted">Derived report only</span>' :
    original == null ? '<span class="muted">Not available in source</span>' : esc(fmt(original));
  const workNames = new Map(review.workPlans.map(work => [work.id, work.title]));
  const cards = [
    ['Needs staff review', review.summary.needsReview], ['Current staff decisions', review.summary.reviewed],
    ['Threshold matches', review.summary.thresholdMatches], ['Intervals with missing values', review.summary.unavailableValues],
    ['Changed intervals', review.summary.changedIntervals], ['Unassigned intervals', review.summary.unassigned],
    ['Selected editions', review.summary.selectedEditions], ['Decision revisions', review.summary.decisionRevisions],
  ].map(([name, number]) => '<div class="metric"><strong>' + esc(number) + '</strong>' + esc(name) + '</div>').join('');
  const plans = review.workPlans.map(work => '<article class="plan" data-search-row><h3>' + esc(work.title) + '</h3><dl>' +
    '<dt>Location</dt><dd>' + esc(fmt(work.location)) + '</dd><dt>Window</dt><dd>' + esc(work.window?.startTime) + ' → ' + esc(work.window?.endTime) + '</dd>' +
    '<dt>Time display</dt><dd>' + esc(work.window?.timezone) + '; daily start ' + esc(work.window?.dailyStartHour) + ':00</dd>' +
    '<dt>Selected edition</dt><dd>' + source(work.activeEditionId) + '</dd><dt>Work status</dt><dd>' +
    esc(work.needsReview) + ' need review / ' + esc(work.intervals) + ' selected intervals</dd>' +
    '<dt>Source values</dt><dd>' + (work.sourceAvailable ? 'Available in the live workspace' : 'Unavailable; retained decisions remain') + '</dd></dl></article>').join('');
  const queue = table(['Work / interval','Review status','Current assignment','Source edition'], review.queue.map(row =>
    tr(['<strong>' + esc(workNames.get(row.workId) ?? row.workId) + '</strong><br>' + rowLink(row),
      (row.needsReview ? '<span class="tag emphasis">Needs review</span>' : '<span class="tag">Staff reviewed</span>') + '<br>' + tags(row.reasonCodes),
      esc(row.assignee || 'Unassigned') + (row.latestDecision ? '<br><strong>' + esc(row.latestDecision.decision) + '</strong><br><span class="small">Revision ' + esc(row.latestDecision.revision) + '</span>' : ''),
      source(row.editionId)])), 'No intervals require triage in the selected active editions.');
  const assignments = table(['Assignee','Intervals','Needs review','Threshold matches','Forecast changes','Current decisions'],
    review.assignments.map(row => tr([esc(row.assignee || 'Unassigned'),esc(row.intervals),esc(row.needsReview),esc(row.triggered),esc(row.changed),
      esc(Object.entries(row.decisionCounts).map(([name,count]) => name + ': ' + count).join('; ') || 'No current decision')])));
  const details = review.intervals.map(row => '<details id="' + esc(anchor('interval', row.editionId + '/' + row.id)) + '" data-search-row>' +
    '<summary>' + esc(row.startTime) + ' · ' + esc(row.timestep) + ' · ' + esc(workNames.get(row.workId) ?? row.workId) +
    ' · ' + (row.isActiveEdition ? 'Active edition' : 'Earlier edition') + '</summary>' +
    '<div class="detail-head"><span>' + source(row.editionId) + '</span><span>Interval <code>' + esc(row.id) + '</code></span>' +
    '<span>' + esc(row.withinWindow ? 'Inside work window' : 'Outside work window') + '</span></div>' +
    (row.observationAvailability === 'RETAINED_DECISION_ONLY' ? '<p class="notice">This interval is retained through its staff decision. Provider values are no longer available; it is not counted as a current weather observation.</p>' : '') +
    tags(row.reasonCodes) +
    table(['Field','Source value','Unit','Original rule result'], row.fields.map(field => tr([
      esc(field.field),value(field.value,field.valueState),esc(field.unit),
      esc(label(field.exposure)) + (field.present ? '' : '<br><span class="small">Field absent in source</span>')])), 'No provider values retained for this interval.') +
    (row.rules.length ? '<h3 style="margin-top:16px">Selected staff rules</h3><ul>' + row.rules.map(rule =>
      '<li>' + esc(rule.explanation) + ' — ' + esc(rule.triggered === true ? 'Matched' : rule.triggered === false ? 'Did not match' : 'Cannot evaluate from source') + '</li>').join('') + '</ul>' : '') +
    (row.latestDecision ? '<p class="notice"><strong>' + esc(row.latestDecision.decision) + '</strong> · ' + esc(row.latestDecision.assignee) +
      ' · revision ' + esc(row.latestDecision.revision) + '<br><span class="notes">' + esc(row.latestDecision.note) + '</span></p>' : '<p class="muted">No current source-bound staff decision.</p>') +
    '<p class="small source">Source SHA-256 <code>' + esc(row.sourceSha256) + '</code>. Original identity: ' +
    esc(row.timestep) + ' / ' + esc(row.startTime) + ' / the field named above.</p></details>').join('');
  const comparisons = review.comparisons.map(comparison => '<article><h3>' + source(comparison.beforeId) + ' → ' + source(comparison.afterId) + '</h3>' +
    (!comparison.comparable ? '<p class="notice">' + esc(label(comparison.reason)) + '</p>' :
    table(['Interval / field','Unit','Earlier value','Refreshed value','Original change','Comparison'], list(comparison.rows).map(row => tr([
      esc(row.startTime) + '<br><strong>' + esc(row.field) + '</strong><br><span class="small">' + esc(row.timestep) + '</span>',
      esc(row.unit),value(row.before,row.beforeValueState),value(row.after,row.afterValueState),value(row.change,row.changeValueState),esc(label(row.status))])))) + '</article>').join('');
  const decisionRows = table(['Interval / source','Revision','Assignee / decision','Recorded','Staff note'], review.decisions.map(record =>
    tr([esc(record.startTime) + '<br>' + source(record.editionId) + '<br><span class="mono small">' + esc(record.intervalId) + '</span>',
      '<strong>' + esc(record.revision) + '</strong><br>' + esc(label(record.applicability)),
      esc(record.assignee) + '<br><strong>' + esc(record.decision) + '</strong>',esc(record.createdAt),'<span class="notes">' + esc(record.note) + '</span>'])));
  const sources = review.editions.map(edition => '<details id="' + esc(anchor('edition', edition.id)) + '" data-search-row><summary>' + esc(edition.id) + ' · ' + esc(edition.state) + '</summary><dl>' +
    '<dt>Acquired</dt><dd>' + esc(fmt(edition.receivedAt)) + '</dd><dt>SHA-256</dt><dd><code>' + esc(fmt(edition.sourceSha256)) + '</code></dd>' +
    '<dt>Source response</dt><dd>' + esc(fmt(edition.resource?.status)) + ' · ' + esc(fmt(edition.resource?.bytes)) + ' bytes</dd>' +
    '<dt>Source extent</dt><dd>' + esc(fmt(edition.sourceExtent)) + '</dd><dt>Availability</dt><dd>' + esc(edition.rawAvailability) + '</dd>' +
    '<dt>Report values</dt><dd>' + esc(label(edition.reportValues)) + '</dd><dt>Usage</dt><dd>' + esc(edition.usage?.mode) + '</dd>' +
    '<dt>Raw retention ends</dt><dd>' + esc(fmt(edition.rawExpiresAt)) + '</dd><dt>Captured source intervals</dt><dd>' + esc(fmt(edition.resource?.returnedIntervals)) + '</dd><dt>Available source rows</dt><dd>' + esc(edition.intervalCount) +
    '; retained decision identities: ' + esc(edition.retainedDecisionIntervals) + '</dd></dl></details>').join('');
  const notes = review.issues.length ? '<ul>' + review.issues.map(item => '<li data-search-row><strong>' + esc(item.code) + '</strong> — ' + esc(item.message) +
    (item.editionId ? ' (' + source(item.editionId) + ')' : '') + '</li>').join('') + '</ul>' : '<p class="muted">No additional source notes.</p>';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Weather operations review</title><style>' + CSS + '</style></head><body><main>' +
    '<header><p class="small muted">WEATHER OPERATIONS</p><h1>Work plan and forecast review</h1><p class="muted">Source-bound assignments, staff decisions and forecast changes.</p>' +
    '<p class="small">Report created ' + esc(review.report.generatedAt) + ' · Review <code>' + esc(review.id) + '</code></p>' +
    '<nav><a href="#work">Work plans</a><a href="#queue">Review queue</a><a href="#assignments">Assignments</a><a href="#intervals">Intervals</a><a href="#changes">Forecast changes</a><a href="#decisions">Decision history</a><a href="#sources">Sources</a></nav></header>' +
    '<div class="metrics">' + cards + '</div>' +
    '<div class="toolbar"><label for="search">Find in report</label><input id="search" type="search" placeholder="Work, person, source or interval"><button type="button" id="print">Print report</button><span id="search-result" class="small muted" aria-live="polite"></span></div>' +
    '<p class="notice">' + esc(review.report.retention) + '</p>' +
    '<section id="work"><h2>Work plans</h2><p class="muted">' + esc(review.definitions.selection) + '</p><div class="plan-grid">' + plans + '</div></section>' +
    '<section id="queue"><h2>Review queue</h2><p class="muted">' + esc(review.definitions.queue) + '</p>' + queue + '</section>' +
    '<section id="assignments"><h2>Assignments</h2><p class="muted">' + esc(review.definitions.assignment) + '</p>' + assignments + '</section>' +
    '<section id="intervals"><h2>Original intervals and selected rules</h2><p class="muted">' + esc(review.definitions.coverage) + '</p>' + (details || '<p class="empty">No source intervals or retained decision identities available.</p>') + '</section>' +
    '<section id="changes"><h2>Forecast changes</h2><p class="muted">Values and differences below are the original workspace comparison. Earlier staff decisions remain attached to their earlier edition.</p>' + (comparisons || '<p class="empty">No edition comparison selected.</p>') + '</section>' +
    '<section id="decisions"><h2>Decision history</h2><p class="muted">' + esc(review.definitions.decisions) + '</p>' + decisionRows + '</section>' +
    '<section id="sources"><h2>Source register</h2>' + sources + '<h3>Source notes</h3>' + notes + '</section>' +
    '<footer><p><a href="https://www.tomorrow.io/" rel="noreferrer">Powered by Tomorrow.io</a></p><p class="small muted">' + esc(review.definitions.thresholds) + '</p></footer></main>' +
    '<script>(()=>{const input=document.getElementById("search"),rows=[...document.querySelectorAll("[data-search-row]")],result=document.getElementById("search-result");input.addEventListener("input",()=>{const q=input.value.trim().toLocaleLowerCase();let shown=0;for(const row of rows){const match=!q||row.textContent.toLocaleLowerCase().includes(q);row.hidden=!match;if(match)shown++;}result.textContent=q?shown+" matching records":"";});document.getElementById("print").addEventListener("click",()=>{const prior=rows.map(row=>row.hidden),details=[...document.querySelectorAll("details")],opened=details.map(d=>d.open);for(const row of rows)row.hidden=false;for(const d of details)d.open=true;window.print();rows.forEach((row,i)=>row.hidden=prior[i]);details.forEach((d,i)=>d.open=opened[i]);});})();</script></body></html>';
}

export function createOperationsReport(review, { format = 'html' } = {}) {
  if (!['json','csv','html'].includes(format)) throw new OperationsReviewError('Report format must be json, csv or html');
  const retained = retainedOperationsReview(review);
  const content = format === 'json' ? JSON.stringify(retained, null, 2) + '\n' : format === 'csv' ? csvReport(retained) : htmlReport(retained);
  const id = /^[A-Za-z0-9_-]+$/.test(review.id) ? review.id : 'selected';
  return {
    filename: 'weather-operations-' + id + '.' + format,
    mime: { json: 'application/json', csv: 'text/csv; charset=utf-8', html: 'text/html; charset=utf-8' }[format],
    bytes: Buffer.from(content, 'utf8'),
  };
}

