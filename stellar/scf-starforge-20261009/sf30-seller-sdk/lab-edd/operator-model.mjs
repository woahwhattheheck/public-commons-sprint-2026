// MIT. Laboratory operator views compose the installed source, field and correspondence models.
import { normalizeLaboratoryRequest } from './application.mjs';
import { canonicalJson, sha256, normalizeDecisions, previewDelivery, compareDeliveries } from './model.mjs';
import { reconcileDeliveries, normalizeReconciliation, previewReconciliation } from './reconciliation.mjs';
import { labProfile } from './profiles.mjs';
import { labError } from './table.mjs';

export const LAB_OPERATOR_BINDING_SCHEMA = 'starforge.lab-edd-operator-source.v1';
export const LAB_OPERATOR_PREVIEW_SCHEMA = 'starforge.lab-edd-operator-preview.v1';
export const LAB_OPERATOR_REVIEW_SCHEMA = 'starforge.lab-edd-operator-review.v1';
export const laboratoryJson = value => JSON.stringify(value, null, 2) + '\n';
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function laboratoryParameters(input) {
  normalizeLaboratoryRequest(input);
  const { $files, ...parameters } = input;
  labProfile(parameters.profile);
  if (parameters.baselineProfile) labProfile(parameters.baselineProfile);
  return structuredClone(parameters);
}
export function laboratoryBinding(selection, current, baseline = null) {
  const parameters = laboratoryParameters(selection.input);
  const file = slot => selection.files[slot]?.descriptor ?? null;
  const value = {
    schema: LAB_OPERATOR_BINDING_SCHEMA, requestId: selection.requestId, reference: selection.reference,
    merchant: structuredClone(selection.merchant), parameters,
    originals: { source: file('source'), baseline: file('baseline') },
    current: current.source, baseline: baseline?.source ?? null,
  };
  return { ...value, bindingSha256: sha256(canonicalJson(value)) };
}
export function previewLaboratoryReview({ binding, current, baseline = null }, documents = {}) {
  if (!plain(documents) || Object.keys(documents).some(key => !['current', 'baseline', 'correspondence'].includes(key)))
    labError('OPERATOR_DOCUMENTS', 'Choose current field, baseline field and correspondence documents.');
  const currentReview = previewDelivery(current, documents.current);
  const cross = baseline && baseline.source.profile.id !== current.source.profile.id;
  if (!cross && (documents.baseline != null || documents.correspondence != null))
    labError('CROSS_PROFILE_REQUIRED', 'Separate baseline and correspondence decisions require the explicit different-profile source pair.');
  const baselineReview = cross ? previewDelivery(baseline, documents.baseline) : null;
  const comparison = baseline ? cross ? reconcileDeliveries(current, baseline) : compareDeliveries(current, baseline) : null;
  const correspondence = cross ? previewReconciliation(comparison, documents.correspondence) : null;
  const outputComparison = cross ? reconcileDeliveries(current, baseline, { currentReview, baselineReview }) : null;
  const normalized = { current: currentReview.document,
    ...(cross ? { baseline: baselineReview.document, correspondence: correspondence.document } : {}) };
  const identity = {
    bindingSha256: binding.bindingSha256, currentSourceSha256: current.source.sourceSha256,
    currentDocumentSha256: currentReview.documentSha256, currentReviewSha256: currentReview.reviewSha256,
    baselineSourceSha256: baseline?.source.sourceSha256 ?? null,
    baselineDocumentSha256: baselineReview?.documentSha256 ?? null, baselineReviewSha256: baselineReview?.reviewSha256 ?? null,
    comparisonSha256: comparison?.comparisonSha256 ?? null,
    correspondenceDocumentSha256: correspondence?.documentSha256 ?? null,
    correspondenceReviewSha256: correspondence?.reviewSha256 ?? null,
    outputComparisonSha256: outputComparison?.comparisonSha256 ?? null,
  };
  return {
    schema: LAB_OPERATOR_PREVIEW_SCHEMA, binding, documents: normalized, identity,
    previewSha256: sha256(canonicalJson(identity)), current: currentReview,
    baseline: baselineReview, comparison, correspondence, outputComparison,
    summary: {
      current: { source: current.source.profile, report: currentReview.report.summary,
        counts: currentReview.report.counts, disposition: currentReview.report.disposition, changes: currentReview.changes },
      baseline: baselineReview ? { source: baseline.source.profile, report: baselineReview.report.summary,
        counts: baselineReview.report.counts, disposition: baselineReview.report.disposition, changes: baselineReview.changes } : null,
      comparison: comparison ? { counts: comparison.counts, mapping: comparison.mapping ?? null } : null,
      correspondence: correspondence?.counts ?? null,
    },
  };
}
export function normalizeLaboratoryDocuments(source, documents = {}) {
  const cross = source.baseline && source.baseline.source.profile.id !== source.current.source.profile.id;
  if (!cross && (documents.baseline != null || documents.correspondence != null))
    labError('CROSS_PROFILE_REQUIRED', 'Use only current field decisions for this source selection.');
  return { current: normalizeDecisions(source.current, documents.current),
    ...(cross ? { baseline: normalizeDecisions(source.baseline, documents.baseline),
      correspondence: normalizeReconciliation(reconcileDeliveries(source.current, source.baseline), documents.correspondence) } : {}) };
}
export function assertLaboratoryBinding(actual, expected) {
  if (!same(actual, expected)) labError('OPERATOR_SOURCE_CHANGED', 'The original request, source pair or selected profile has changed.');
  return actual;
}
export function laboratorySourceView(source) {
  const view = delivery => delivery ? { source: delivery.source, tables: delivery.tables,
    report: delivery.report, unassigned: delivery.unassigned } : null;
  return { schema: LAB_OPERATOR_BINDING_SCHEMA, binding: source.binding,
    current: view(source.current), baseline: view(source.baseline) };
}
export function laboratoryRows(source, { side = 'current', section, field, q = '', recordId } = {}) {
  if (!['current', 'baseline'].includes(side) || typeof q !== 'string' || q.length > 1000)
    labError('OPERATOR_ROWS', 'Choose the current or baseline source and a bounded search.');
  const delivery = source[side];
  if (!delivery) labError('BASELINE_REQUIRED', 'This source selection has no original baseline.');
  const needle = q.toLocaleLowerCase(), rows = [];
  for (const table of delivery.tables) {
    if (section && table.id !== section) continue;
    if (field && !table.keys.includes(field)) continue;
    for (const row of table.rows) {
      if (recordId && row.recordId !== recordId) continue;
      if (needle && ![table.filename, table.id, row.recordId, ...row.fields].join(' ').toLocaleLowerCase().includes(needle)) continue;
      rows.push({ side, sourceSha256: delivery.source.sourceSha256, section: table.id, filename: table.filename,
        headers: table.headers, keys: table.keys, origin: table.origin,
        ...row, ...(field ? { selectedField: { field, value: row.values[field] } } : {}) });
    }
  }
  return rows;
}
export function laboratoryIssues(source, { side = 'current', severity, code, q = '' } = {}) {
  if (!['current', 'baseline'].includes(side) || typeof q !== 'string' || q.length > 1000)
    labError('OPERATOR_ISSUES', 'Choose the current or baseline source and a bounded search.');
  const delivery = source[side]; if (!delivery) labError('BASELINE_REQUIRED', 'The original baseline is absent.');
  return delivery.report.issues.filter(issue => (!severity || issue.severity === severity) &&
    (!code || issue.code === code) && (!q || canonicalJson(issue).toLocaleLowerCase().includes(q.toLocaleLowerCase())));
}
export function laboratoryGroups(comparison, { status, kind, groupId, q = '' } = {}) {
  if (!comparison?.groups) labError('CROSS_PROFILE_REQUIRED', 'Select the explicit source pair with native correspondence groups.');
  if (typeof q !== 'string' || q.length > 1000) labError('OPERATOR_GROUPS', 'Use a bounded source search.');
  return comparison.groups.filter(group => (!status || group.status === status) && (!kind || group.kind === kind) &&
    (!groupId || group.groupId === groupId) && (!q || canonicalJson(group).toLocaleLowerCase().includes(q.toLocaleLowerCase())));
}
