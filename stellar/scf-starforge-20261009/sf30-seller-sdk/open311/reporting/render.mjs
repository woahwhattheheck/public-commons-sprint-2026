// MIT. Management exports share one immutable report edition.
import { canonicalJson } from '../domain.mjs';

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const text = value => value == null ? '' : typeof value === 'object' ? canonicalJson(value) : String(value);
function csvCell(value) {
  let s = text(value);
  if (typeof value !== 'number' && (/^[\u0000-\u0020]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s))) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
export function reportCsv(report) {
  const fields = ['reportId', 'reportSha256', 'periodStart', 'periodEndExclusive', 'asOf', 'key', 'serviceRequestId',
    'sourceId', 'captureId', 'sourceSha256', 'observedAt', 'serviceCode', 'serviceName', 'sourceStatus', 'reportingStatus',
    'group', 'priority', 'mappingId', 'agency', 'address', 'description', 'requestedAt', 'updatedAt', 'sourceExpectedAt',
    'reviewStatus', 'assignee', 'reviewDueDate', 'reviewDueAt', 'reviewNeedsRebase', 'policyId', 'policyDueAt',
    'targetBasis', 'targetState', 'targetDueAt', 'targetCompletedAt', 'targetReason', 'ageMinutes', 'resolutionMinutes',
    'businessMinutes', 'observationCount', 'versionCount', 'calculationIssues', 'reportComment', 'requestComment'];
  const rows = report.rows.map(row => ({ ...row, reportId: report.id, reportSha256: report.sha256,
    periodStart: report.definition.period.start, periodEndExclusive: report.definition.period.end, asOf: report.definition.asOf,
    targetBasis: row.target.basis, targetState: row.target.state, targetDueAt: row.target.dueAt,
    targetCompletedAt: row.target.completedAt, targetReason: row.target.reason, calculationIssues: row.issues,
    reportComment: report.commentary, requestComment: report.requestComments[row.key]?.comment ?? '' }));
  return [fields.map(csvCell).join(','), ...rows.map(row => fields.map(field => csvCell(row[field])).join(','))].join('\r\n') + '\r\n';
}
const e = escapeHtml;
const table = (headers, rows) => '<table><thead><tr>' + headers.map(h => '<th>' + e(h) + '</th>').join('') +
  '</tr></thead><tbody>' + rows.map(row => '<tr>' + row.map(c => '<td>' + e(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
const number = v => typeof v === 'number' ? new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(v) : 'Unassessed';
const rate = v => v.percentage === null ? 'Unassessed (0 eligible)' : number(v.percentage) + '% (' + v.numerator + '/' + v.denominator + ')';
function sourceLink(value, title) {
  try { const url = new URL(value); if (!['https:', 'http:'].includes(url.protocol)) return e(value); return '<a href="' + e(url.href) + '">' + e(title ?? value) + '</a>'; }
  catch { return e(value); }
}
export function reportHtml(report) {
  const d = report.definition, t = report.totals, profile = report.profile;
  const local = value => {
    if (!value || !Number.isFinite(Date.parse(value))) return value ?? '';
    return new Intl.DateTimeFormat('en-GB', { timeZone: d.displayTimeZone, dateStyle: 'medium', timeStyle: 'long' }).format(new Date(value));
  };
  const grouping = (title, values) => '<section><h2>' + e(title) + '</h2>' + table(['Group', 'Requests'], values.map(v => [v.name, v.count])) + '</section>';
  const coverage = report.coverage.map(c => '<section class="source"><h3>' + e(c.connection.name ?? c.collectionId) + '</h3>' +
    table(['Source selection', 'Value'], [
      ['Collection / source edition', c.collectionId + ' / ' + c.sourceId],
      ['Original workspace / revision', c.originalWorkspaceId + ' / ' + c.originalRevision],
      ['Original full-file SHA-256', c.sha256], ['Original bytes', c.bytes],
      ['First retained observation', c.summary.firstObservedAt], ['Last retained observation', c.summary.lastObservedAt],
      ['Source state', c.summary.state], ['All terminal source windows below cap', c.summary.capResolved ? 'Yes' : 'No'],
      ['Unique source requests', c.summary.counts.uniqueRequests], ['Returned row occurrences', c.summary.counts.returnedRows],
      ['Unresolved capped windows', c.summary.counts.limitedWindows], ['Failed windows', c.summary.counts.failedWindows],
      ['Source rows outside requested windows', c.summary.counts.outOfWindowRows], ['Source rows without a usable creation date', c.summary.counts.unknownDateRows]
    ]) + '<h4>Exact retained provider filters</h4><pre>' + e(JSON.stringify(c.query, null, 2)) + '</pre>' +
    (c.unresolvedWindows.length ? '<h4>Unresolved source intervals</h4>' + table(['Window', 'Start', 'End', 'State', 'Problem'],
      c.unresolvedWindows.map(n => [n.id, n.startDate, n.endDate, n.state, n.problem ?? n.error?.message ?? ''])) : '') +
    '<p>Publisher: ' + e(c.connection.attribution?.publisher) + '. Dataset: ' + e(c.connection.attribution?.title) +
    '. License: ' + sourceLink(c.connection.attribution?.licenseUrl, c.connection.attribution?.license) + '. ' +
    sourceLink(c.connection.attribution?.sourceUrl, 'Source catalogue') + '</p></section>').join('');
  const requests = report.rows.map(r => '<tr><td><strong>' + e(r.serviceRequestId) + '</strong><br>' + e(local(r.requestedAt)) +
    '</td><td>' + e(r.group) + '<br><span class="muted">' + e(r.serviceCode ?? 'Missing service code') + '</span><br>' + e(r.priority) +
    '</td><td>' + e(r.sourceStatus) + '<br><span class="muted">Reporting group: ' + e(r.reportingStatus) + '</span><br>' +
    e(r.reviewStatus) + ' · ' + e(r.assignee || 'Unassigned') + (r.reviewNeedsRebase ? '<p>Review references an earlier source version.</p>' : '') +
    '</td><td>' + e(r.target.state) + '<br>' + e(local(r.target.dueAt)) + '<br><span class="muted">' + e(r.target.reason) + '</span>' +
    '<p>Age: ' + e(number(r.ageMinutes)) + ' min<br>Resolution: ' + e(number(r.resolutionMinutes)) + ' min</p></td><td>' +
    '<details><summary>Request details and original source</summary><p>' + e(r.description) + '</p><p>' + e(r.address) + '</p>' +
    table(['Field', 'Retained value'], [['Request key', r.key], ['Source edition', r.sourceId], ['Capture', r.captureId],
      ['Original version SHA-256', r.sourceSha256], ['Observed at', r.observedAt], ['Source last update', r.updatedAt],
      ['Provider expected datetime', r.sourceExpectedAt], ['Internal review due date', r.reviewDueDate], ['Interpreted review cutoff', r.reviewDueAt],
      ['Operator policy deadline', r.policyDueAt], ['Policy edition', r.policyId], ['Selected target basis', r.target.basis],
      ['Target completion time', r.target.completedAt], ['Observed original versions', r.versionCount], ['Distinct observations', r.observationCount],
      ['Business-clock minutes', r.businessMinutes], ['Reviewer commentary', report.requestComments[r.key]?.comment ?? '']]) +
    (r.issues.length ? '<h4>Calculation issues</h4>' + table(['Issue', 'Explanation'], r.issues.map(i => [i.code, i.message])) : '') +
    '<h4>Complete selected provider object</h4><pre>' + e(JSON.stringify(r.source, null, 2)) + '</pre></details></td></tr>').join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + e(d.name) + ' — Service report</title><style>' +
    'body{margin:32px;max-width:1500px;color:#171717;background:#fff;font:14px/1.5 system-ui,sans-serif}h1,h2,h3{line-height:1.2}h1{font-size:30px}' +
    'h2{border-bottom:1px solid #aaa;padding-bottom:8px;margin-top:32px}h3{margin-top:24px}table{border-collapse:collapse;width:100%;margin:14px 0}' +
    'th,td{border:1px solid #bbb;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#ededed}' +
    '.muted{color:#555}.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.kpi{border:1px solid #aaa;padding:16px}' +
    '.kpi strong{display:block;font-size:25px}.meta{font:12px/1.6 ui-monospace,monospace;overflow-wrap:anywhere}.columns{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}' +
    'pre{white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #ccc;background:#f7f7f7;padding:12px;font:12px/1.5 ui-monospace,monospace}details{min-width:220px}' +
    'summary{cursor:pointer;font-weight:600}p{max-width:110ch}.comment{white-space:pre-wrap;border-left:3px solid #777;padding:12px 18px}a{color:inherit}' +
    '@media print{body{margin:10mm;max-width:none;font-size:10px}.kpis{grid-template-columns:repeat(4,1fr)}thead{display:table-header-group}tr{break-inside:avoid}' +
    'h2,h3{break-after:avoid}details{display:block}details>*{display:block}summary{display:none}pre{font-size:8px}}' +
    '</style></head><body><header><p>OPEN311 · SERVICE REPORTING</p><h1>' + e(d.name) + '</h1><p>' +
    e(local(d.period.start)) + ' through ' + e(local(d.period.end)) + ' (end exclusive)</p><p>Creation-period cohort. Observation cutoff: ' +
    e(local(d.asOf)) + '. Display timezone: ' + e(d.displayTimeZone) + '.</p><p class="meta">Report ' + e(report.id) + '<br>SHA-256 ' + e(report.sha256) +
    '<br>Profile ' + e(report.profileId) + ' · ' + e(profile.provider) + ' · Created ' + e(report.createdAt) + '</p></header>' +
    '<div class="kpis">' + [['Requests in period', t.intake], ['Reviewed requests', t.reviewedRequests],
      ['Unmapped services', t.unmappedServices], ['Unassessed targets', t.unassessedTargets]].map(([name, value]) =>
      '<div class="kpi">' + e(name) + '<strong>' + e(value) + '</strong></div>').join('') + '</div>' +
    '<h2>Management commentary</h2><div class="comment">' + e(report.commentary || 'No commentary saved for this edition.') + '</div>' +
    '<h2>Selected target performance</h2><p>Comparison basis: ' + e(d.targetBasis) + '. Completed-on-time uses completed requests with a valid target. ' +
    'Open-overdue uses requests with a valid target and no supported completion event. Each percentage carries its eligible denominator.</p>' +
    table(['Metric', 'Result'], [['Completed on time', rate(t.completedOnTime)], ['Open requests overdue', rate(t.openOverdue)],
      ['Currently within selected target', rate(t.currentlyWithinTarget)], ['Requests assessed against a valid target', t.assessedTargets],
      ['Requests with an unassessed target', t.unassessedTargets], ['Requests with a calculation issue', t.calculationIssues],
      ['Median age at observation cutoff, minutes', number(t.age.medianMinutes)], ['Valid source resolution durations', t.resolution.count],
      ['Median valid resolution duration, minutes', number(t.resolution.medianMinutes)]]) +
    '<div class="columns">' + grouping('Source status', report.groups.sourceStatus) + grouping('Mapped service groups', report.groups.service) +
    grouping('Internal review workload', report.groups.review) + grouping('Assigned workload', report.groups.assignee) + '</div>' +
    '<h2>Population and time interpretation</h2><p>' + e(report.interpretation) + '</p>' +
    table(['Selection result', 'Requests'], [['Known original request keys across selected sources', t.totalKnownRequests],
      ['Observed by the selected cutoff', t.observedUniqueRequests], ['First observed after the selected cutoff', t.unobservedAtCutoff],
      ['Missing usable creation time', t.missingCreationDate], ['Outside the half-open creation period', t.outsidePeriod],
      ['Excluded by saved report filters', t.filtered], ['Included in the report', t.intake]]) +
    '<p>' + (profile.provider === 'helsinki' ? 'Helsinki READY and PROCESSING remain source processing states. Its last-update datetime does not establish physical resolution. ' :
      'The GeoReport v2 profile uses updated_datetime as closure time only for a source request whose status is closed. ') +
    'Operator calendars, review cutoffs and target policies are saved with this report. Provider values remain in each original object.</p>' +
    '<h2>Request drilldown</h2><table><thead><tr><th>Request / creation</th><th>Service / priority</th><th>Source / review</th><th>Selected target</th><th>Original detail</th>' +
    '</tr></thead><tbody>' + requests + '</tbody></table>' +
    '<h2>Source coverage and attribution</h2>' + coverage +
    '<h2>Retained calendar and target policy editions</h2><pre>' + e(JSON.stringify(profile, null, 2)) + '</pre>' +
    '<h2>Resolved working intervals</h2><p>These UTC intervals are the actual boundaries used by this edition. The report retains them independently of later timezone database changes.</p>' +
    table(['Calendar edition', 'Local date', 'Timezone', 'Resolved intervals'], report.resolvedCalendarIntervals.map(v =>
      [v.calendar, v.date, v.timeZone, v.intervals.map(i => i.localStart + ' → ' + i.localEnd + ' | ' + i.start + ' → ' + i.end).join('\n')])) +
    '<h2>Review incorporation history</h2>' + table(['Reviewer', 'Original base', 'Prior edition', 'Incorporated changes', 'Time'],
      report.reviewerHistory.map(h => [h.reviewer, h.baseReportId, h.incorporatedInto, h.changeIds.join(', '), h.incorporatedAt])) +
    '<footer><p>The complete JSON package carries the original collection files, all source bodies, saved editions, report calculations and original operation histories into a new reporting workspace.</p>' +
    '<p class="meta">Calculation runtime: ' + e(canonicalJson(report.calculationRuntime)) + '</p></footer></body></html>';
}
