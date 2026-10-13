// MIT. Complete IATI case handover through the maintained Operating Plans model.
import { createOperatingPlan, createOperatingStep, snapshotRegistration,
  inspectOperatingPlan, renderOperatingPlanMarkdown, renderOperatingPlanHTML
} from '../../../distribution/discovery/operating-plan.mjs';

export const IATI_OPERATING_SOURCE_SCHEMA = 'stellar-forge.iati-document-operating-source.v1';
export const IATI_OPERATING_PROCEDURE_SCHEMA = 'stellar-forge.iati-document-operating-procedure.v1';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = value => JSON.parse(JSON.stringify(value));
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const canonical = value => Array.isArray(value) ? value.map(canonical) : plain(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const need = (condition, message) => {
  if (!condition) throw Object.assign(new TypeError(message), { code: 'IATI_OPERATING_SOURCE_INVALID' });
};
const asText = value => value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
const json = value => JSON.stringify(value, null, 2);
const label = row => row.titles?.map(item => asText(item.text)).filter(Boolean).join(' · ') || 'Document ' + row.id.slice(0,12);
const selectedFields = p => ({ id: p.id, revision: p.revision, recordSha256: p.recordSha256 });

/** Preserve every original record. Validate cross-record identity and completeness;
 * the original native models remain responsible for their evidence semantics. */
export function inspectDocumentOperatingSource(input) {
  need(plain(input) && input.schema === IATI_OPERATING_SOURCE_SCHEMA, 'Choose the complete IATI operating source.');
  need(typeof input.capturedAt === 'string' && Number.isFinite(Date.parse(input.capturedAt)), 'Keep the source capture time.');
  need(sha(input.workspaceSha256), 'Keep the original workspace identity.');
  const p = input.plan;
  need(plain(p) && p.schema === 'stellar-forge.iati-document-evidence.v1' && sha(p.id) &&
    sha(p.recordSha256) && Number.isSafeInteger(p.revision) && p.revision > 0 &&
    Array.isArray(p.documents) && p.documents.length > 0 && p.documents.length <= 500 &&
    Array.isArray(p.observationIds), 'Keep one complete saved document-evidence revision.');
  need(input.snapshotSha256 === p.recordSha256, 'The row snapshot must be the selected saved revision.');
  need(Array.isArray(input.history) && input.history.length === p.revision, 'Keep the complete source revision history.');
  input.history.forEach((item, index) => {
    need(plain(item) && item.schema === p.schema && item.id === p.id && item.revision === index + 1 &&
      sha(item.recordSha256) && item.previousRecordSha256 === (index ? input.history[index - 1].recordSha256 : null),
    'The source history must retain its original sequence and predecessor records.');
  });
  need(same(input.history.at(-1), p), 'The selected plan must match the last retained source revision.');
  need(plain(input.organisation) && plain(p.selection) &&
    input.organisation.id === p.selection.id && input.organisation.revision === p.selection.revision &&
    input.organisation.recordSha256 === p.selection.recordSha256,
  'Keep the complete original organisation plan selected by this evidence case.');
  const documentIds = p.documents.map(row => row.id);
  need(documentIds.every(sha) && new Set(documentIds).size === documentIds.length, 'Keep each selected document once.');
  need(Array.isArray(input.rows) && input.rows.length === p.documents.length &&
    input.rows.every((row, index) => plain(row) && row.id === documentIds[index]), 'Keep all selected rows in their original order.');
  need(Array.isArray(input.observations) && input.observations.length === p.observationIds.length &&
    new Set(p.observationIds).size === p.observationIds.length, 'Keep every retained observation exactly once.');
  const observations = new Map();
  input.observations.forEach((o, index) => {
    need(plain(o) && o.schema === 'stellar-forge.iati-document-observation.v1' &&
      o.id === p.observationIds[index] && sha(o.id) && sha(o.recordSha256) &&
      o.planId === p.id && Array.isArray(o.rowIds) && o.rowIds.length > 0 &&
      new Set(o.rowIds).size === o.rowIds.length && o.rowIds.every(id => documentIds.includes(id)) &&
      typeof o.documentComplete === 'boolean', 'An observation differs from its original case selection.');
    observations.set(o.id, o);
  });
  const decisions = new Map((p.review?.decisions ?? []).map(item => [item.rowId, item]));
  if (p.review) need(Array.isArray(p.review.decisions) && decisions.size === documentIds.length &&
    p.review.decisions.length === documentIds.length && [...decisions.keys()].every(id => documentIds.includes(id)),
  'The named review must retain its decision for every selected document.');
  input.rows.forEach((row, index) => {
    const original = p.documents[index];
    need(Object.keys(original).every(key => same(original[key], row[key])), 'The original document row changed.');
    const related = input.observations.filter(o => o.rowIds.includes(row.id));
    need(same(row.observationIds, related.map(o => o.id)) && same(row.decision, decisions.get(row.id) ?? null),
      'The row must retain its exact observation sequence and named decision.');
    const last = related.at(-1);
    const summary = last ? { id: last.id, state: last.state, outcome: last.outcome,
      finishedAt: last.finishedAt, body: last.body, documentComplete: last.documentComplete,
      status: last.fetch?.status ?? null } : null;
    need(same(row.latestObservationSummary, summary), 'The displayed observation must match its complete retained record.');
    if (row.decision?.observationId) need(related.some(o => o.id === row.decision.observationId),
      'A named decision references an observation outside this document.');
    if (row.decision?.decision === 'usable') need(observations.get(row.decision.observationId)?.documentComplete === true,
      'A usable decision must retain its original complete-document observation.');
  });
  need(Array.isArray(input.comparisons), 'Keep the existing case comparisons, including an empty collection.');
  for (const comparison of input.comparisons) {
    need(plain(comparison) && sha(comparison.id) && sha(comparison.recordSha256) &&
      [comparison.before, comparison.after].every(side => plain(side) && side.id === p.id &&
        Number.isInteger(side.revision) && side.revision > 0 && side.revision <= p.revision &&
        input.history[side.revision - 1].recordSha256 === side.recordSha256),
    'Keep only complete comparisons belonging to the selected original history.');
  }
  need(plain(input.correction) && input.correction.schema === 'stellar-forge.iati-document-correction-draft.v1' &&
    input.correction.evidence?.id === p.id && input.correction.evidence?.revision === p.revision &&
    input.correction.evidence?.recordSha256 === p.recordSha256 && Array.isArray(input.correction.changes),
  'Keep the exact correction draft for this saved evidence revision.');
  return copy(input);
}

export function summarizeDocumentOperatingSource(input) {
  const source = inspectDocumentOperatingSource(input), p = source.plan;
  return { ...selectedFields(p), name: p.name, state: p.state, documents: source.rows.length,
    observations: source.observations.length, completeDocuments: source.observations.filter(o => o.documentComplete).length,
    decisions: Object.fromEntries(['usable','needs_correction','not_applicable','deferred','unreviewed'].map(value =>
      [value, source.rows.filter(row => (row.decision?.decision ?? 'unreviewed') === value).length])),
    sourceRevisions: source.history.length, comparisons: source.comparisons.length,
    proposedCorrections: source.correction.changes.length };
}

function commandSelection(catalog) {
  const selection = snapshotRegistration(catalog, 'command:iati-document-evidence');
  need(selection.item.kind === 'command' && Array.isArray(selection.item.helpArgv),
    'Use a selected toolkit containing the maintained iati-document-evidence command.');
  return selection;
}
function rowResult(source, row) {
  const observations = source.observations.filter(o => row.observationIds.includes(o.id));
  return json({
    publishedUrl: row.url,
    observations: observations.map(o => ({ ...selectedFields(o), requestId: o.requestId, actor: o.actor,
      finishedAt: o.finishedAt, state: o.state, outcome: o.outcome, httpStatus: o.fetch?.status ?? null,
      documentComplete: o.documentComplete, body: o.body })),
    review: row.decision ? { actor: source.plan.review.actor, at: source.plan.review.at,
      reviewId: source.plan.review.id, ...row.decision } : null
  });
}

/** Create an editable procedure plus all original source material. It never runs
 * a command, advances a native case, or infers customer delivery from an export. */
export function createDocumentOperatingProcedure(input, catalog, options = {}) {
  const source = inspectDocumentOperatingSource(input), p = source.plan, selection = commandSelection(catalog);
  const owner = options.owner ?? p.actor ?? '', connectionFile = options.connectionFile ?? '';
  const savedAt = options.savedAt ?? new Date().toISOString();
  const command = args => connectionFile
    ? ['starforge', 'iati-document-evidence', '--connection-file', connectionFile, ...args]
    : copy(selection.item.helpArgv);
  const commonInputs = 'Evidence ' + p.id + ', saved revision ' + p.revision + '.\n' +
    'Keep the complete IATI procedure package and original document-evidence ZIP with this plan.' +
    (connectionFile ? '\nOriginal private connection file: ' + connectionFile :
      '\nSet the existing private connection file when preparing terminal arguments. The selected command opens maintained help.');
  const step = (id, title, values = {}) => createOperatingStep({
    id, title, owner, selection, inputs: commonInputs, ...values
  });
  const steps = [
    step('iati-source-selection', 'Retain the original organisation and document selection', {
      instruction: 'Open the saved evidence revision and its original organisation plan. Review the selected source or candidate and document register before continuing customer work.',
      expectedResult: 'The operator is working from the exact retained publisher selection.',
      status: 'completed', argv: command(['plan','--id',p.id,'--revision',String(p.revision)]),
      recordedResult: json({ evidence: selectedFields(p), organisation: selectedFields(source.organisation),
        selection: p.selection, documents: source.rows.length, sourceRevisions: source.history.length })
    }),
    step('iati-review-history', 'Retain the complete case history and previous observations', {
      instruction: 'Read the complete source history in this package. Reuse original observations and request identities when recovering existing work. A later document observation is an explicit action in the original evidence workspace.',
      expectedResult: 'The operator can explain the saved decisions and continue the same case.',
      status: 'completed', argv: command(['history','--id',p.id]),
      recordedResult: json(source.history.map(item => ({ ...selectedFields(item), state: item.state,
        updatedAt: item.updatedAt, actor: item.actor, event: item.event })))
    })
  ];
  for (const row of source.rows) {
    const decision = row.decision?.decision;
    const state = decision === 'usable' ? 'completed' : decision === 'not_applicable' ? 'skipped'
      : row.observationIds.length || decision ? 'in-progress' : 'planned';
    steps.push(step('iati-document-' + row.id, label(row).slice(0,300), {
      instruction: 'Inspect the literal publisher URL, complete original observations and any retained body. Record the relevant named decision in the original Document evidence review. Continue correction or deferred work from its saved note.',
      inputs: commonInputs + '\nDocument row: ' + row.id + '\nLiteral published URL: ' + JSON.stringify(row.url),
      expectedResult: 'A named decision identifies a usable complete document, a precise publisher correction, an explicit exclusion, or the work still required.',
      status: state, argv: command(['detail','--id',p.id,'--revision',String(p.revision),'--row-id',row.id,'--expected-snapshot',p.recordSha256]),
      recordedResult: rowResult(source, row)
    }));
  }
  const correctionNeeded = source.rows.some(row => row.decision?.decision === 'needs_correction');
  steps.push(step('iati-publisher-correction', 'Continue the exact publisher correction', {
    instruction: source.correction.rebaseRequired
      ? 'Open the current organisation plan and reconcile the original correction draft against that saved revision. Preserve its cumulative edits and named review, then use the existing organisation workflow.'
      : 'Review the complete saved correction draft. Apply chosen URL changes through the existing Organisation planner, then review its saved candidate. Retain the original published source and evidence.',
    expectedResult: 'Chosen corrections reach a saved and reviewed organisation candidate with the original source retained.',
    status: p.review && !correctionNeeded && !source.correction.changes.length ? 'skipped' : 'planned',
    argv: command(['correction','--id',p.id,'--revision',String(p.revision)]),
    recordedResult: json({ evidence: source.correction.evidence, organisation: source.correction.organisation,
      currentOrganisationRevision: source.correction.currentOrganisationRevision,
      rebaseRequired: source.correction.rebaseRequired, changes: source.correction.changes,
      requestSha256: source.correction.requestSha256, semantics: source.correction.semantics })
  }));
  steps.push(step('iati-compare-editions', 'Retain comparisons between saved evidence editions', {
    instruction: 'Open the retained comparison when one covers the intended before and after revisions. Otherwise select those exact saved revisions and compare them in Document evidence. Read changed, unchanged and indeterminate results with their original observations.',
    expectedResult: 'The handover explains what changed between the selected source editions.',
    status: source.comparisons.length ? 'completed' : 'planned',
    argv: source.comparisons.length
      ? command(['comparison','--id',source.comparisons.at(-1).id]) : copy(selection.item.helpArgv),
    recordedResult: json(source.comparisons.map(value => ({ id: value.id, recordSha256: value.recordSha256,
      before: value.before, after: value.after, summary: value.summary, actor: value.actor, notes: value.notes })))
  }));
  steps.push(step('iati-complete-package', 'Export the complete customer workspace and reports', {
    instruction: 'Use the original Document evidence export for the selected revision. Keep the full workspace ZIP, readable report, document register, original retained bodies, this procedure package and any publisher correction with the customer files.',
    expectedResult: 'The receiving operator has the complete source and editable history for the reporting period.',
    argv: options.packetFile && connectionFile
      ? command(['export','--id',p.id,'--revision',String(p.revision),'--out',options.packetFile])
      : copy(selection.item.helpArgv),
    recordedResult: 'The saved source input ends at evidence revision ' + p.revision + '. Record the actual exported file and delivery destination here after performing that operation.'
  }));
  steps.push(createOperatingStep({
    id: 'iati-independent-receiving', title: 'Receive and reopen the customer work', owner,
    instruction: 'Receive the complete original document-evidence ZIP into the customer’s existing receiving workspace. Reopen its selected revision, full observations, decisions, correction and later receiving notes. Import the editable operating plan into Operating Plans and record the receiving person and location.',
    inputs: options.receiving ?? '', expectedResult: 'The receiving operator can continue the complete customer work from the saved files.',
    recordedResult: 'Record actual receiving and reopened results when performed.'
  }));
  steps.push(createOperatingStep({
    id: 'iati-following-period', title: 'Prepare the following reporting period', owner,
    instruction: 'Confirm the next reporting date with the operating owner. Continue the existing case and retained source history. Identify the exact next publisher edition or document observation and record the completed result before the next handover.',
    inputs: options.period ?? '', expectedResult: 'The next operator has a named task, original case location and clear reporting date.'
  }));
  const plan = createOperatingPlan({
    id: options.id, savedAt, title: options.title ?? ('Document evidence — ' + p.name).slice(0,300),
    customer: options.customer ?? '', purpose: options.purpose ?? 'Review publisher documents, prepare precise corrections and deliver the complete customer history.',
    period: options.period ?? '', owner, receiving: options.receiving ?? '',
    notes: 'Original IATI evidence case: ' + p.id + '\nSelected native revision: ' + p.revision +
      '\nSelected native record SHA-256: ' + p.recordSha256 + '\nOriginal workspace: ' + source.workspaceSha256 +
      '\nSource capture: ' + source.capturedAt + '\nNative case state: ' + p.state +
      '\nThe complete IATI procedure package retains every selected source record, observation, comparison and correction draft.',
    steps
  });
  return { schema: IATI_OPERATING_PROCEDURE_SCHEMA, createdAt: savedAt,
    source, catalog: copy(catalog), plan };
}

/** Accept a later complete edited plan while retaining the original case package. */
export function receiveDocumentOperatingProcedure(input, editedPlan) {
  const bundle = inspectDocumentOperatingProcedure(input);
  if (editedPlan === undefined) return bundle;
  const incoming = inspectOperatingPlan(editedPlan);
  need(incoming.id === bundle.plan.id && incoming.createdAt === bundle.plan.createdAt &&
    same(incoming.origin, bundle.plan.origin), 'Use the edited plan from this original procedure package.');
  const shared = Math.min(incoming.revisions.length, bundle.plan.revisions.length);
  for (let i = 0; i < shared; i++) need(same(incoming.revisions[i], bundle.plan.revisions[i]),
    'The edited procedure history diverges. Keep each complete plan as its own copy.');
  if (incoming.revisions.length > bundle.plan.revisions.length) bundle.plan = incoming;
  return bundle;
}
export function inspectDocumentOperatingProcedure(input) {
  need(plain(input) && input.schema === IATI_OPERATING_PROCEDURE_SCHEMA, 'Choose a complete IATI procedure package.');
  const source = inspectDocumentOperatingSource(input.source), plan = inspectOperatingPlan(input.plan);
  need(typeof input.createdAt === 'string' && input.createdAt === plan.createdAt, 'Keep the original procedure creation time.');
  commandSelection(input.catalog);
  return { ...copy(input), source, plan };
}
export function renderDocumentOperatingProcedure(input, format = 'package') {
  const bundle = inspectDocumentOperatingProcedure(input);
  if (format === 'package') return bundle;
  if (format === 'plan') return bundle.plan;
  if (format === 'source') return bundle.source;
  if (format === 'catalog') return bundle.catalog;
  if (format === 'markdown') return renderOperatingPlanMarkdown(bundle.plan);
  if (format === 'html') return renderOperatingPlanHTML(bundle.plan);
  throw new TypeError('Choose package, plan, source, catalog, markdown or html.');
}
