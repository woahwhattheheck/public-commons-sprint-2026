// MIT. Deterministic decision exports from the saved CanadaBuys context only.
import { canonical, sha256, failure, plain } from './core.mjs';
import { sourceProvenance, DERIVED_SOURCE_KIND } from './source-provenance.mjs';
import { DECISION_CHOICES, compareDecisionContext, normalizeCapabilityProfile } from './bidder-desk-domain.mjs';

export const DECISION_REPORT_SCHEMA = 'starforge.canadabuys.decision-report.v1';
export const DECISION_REPORT_FORMATS = Object.freeze(['json', 'html', 'csv']);
const choiceLabels = { BID: 'Bid', NO_BID: 'No bid', INVESTIGATE: 'Investigate', PARK: 'Park' };
const has = (value, key) => Object.hasOwn(value, key);
const esc = value => String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g,
  character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const json = value => canonical(value);
const pretty = value => JSON.stringify(value, null, 2);
const shown = value => value === null || value === undefined || value === '' ? '(not recorded)' :
  typeof value === 'object' ? pretty(value) : String(value);
const titleOf = entry => entry.summary?.title?.en || entry.summary?.title?.fr || entry.summary?.referenceNumber || entry.id || 'Saved procurement decision';
function urlOf(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function link(value, label) {
  const url = urlOf(value);
  return url ? '<a href="' + esc(url) + '" rel="noopener noreferrer">' + esc(label || value) + '</a>' :
    '<span>' + esc(label || shown(value)) + '</span>';
}
function block(value, empty = '(not recorded)') {
  return '<div class="value">' + esc(value === null || value === undefined || value === '' ? empty :
    typeof value === 'object' ? pretty(value) : value) + '</div>';
}
function badge(status) { return '<span class="badge">' + esc(String(status || 'UNKNOWN').replace(/_/g, ' ')) + '</span>'; }
function list(values, empty) {
  return Array.isArray(values) && values.length ? '<ul>' + values.map(value => '<li>' + block(value) + '</li>').join('') + '</ul>' :
    '<p class="muted">' + esc(empty || 'None recorded.') + '</p>';
}
function table(headers, rows, empty) {
  return rows.length ? '<div class="table-scroll"><table><thead><tr>' +
    headers.map(header => '<th scope="col">' + esc(header) + '</th>').join('') +
    '</tr></thead><tbody>' + rows.map(row => '<tr>' + row.map(cell => '<td>' + cell + '</td>').join('') +
      '</tr>').join('') + '</tbody></table></div>' :
    '<p class="muted">' + esc(empty || 'None recorded.') + '</p>';
}
function pairs(value, labels = {}) {
  return '<dl class="pairs">' + Object.entries(value).map(([field, item]) =>
    '<dt>' + esc(labels[field] || field) + '</dt><dd>' + block(item) + '</dd>').join('') + '</dl>';
}
function humanRecorded(value) { return typeof value === 'string' && value.trim().length > 0; }

function bindEnvelope(input) {
  if (!plain(input) || !plain(input.decision) || !plain(input.context)) {
    throw failure('INVALID_DECISION_REPORT', 'A decision report requires the saved decision and frozen context');
  }
  if (!DECISION_CHOICES.includes(input.decision.choice)) throw failure('INVALID_DECISION_CHOICE', 'The saved decision must use BID, NO_BID, INVESTIGATE or PARK');
  const checked = compareDecisionContext(null, input.context);
  const contextSha256 = checked.afterSha256;
  const decision = input.decision;
  if (decision.contextSha256 !== undefined && String(decision.contextSha256).toLowerCase() !== contextSha256) {
    throw failure('DECISION_CONTEXT_CHANGED', 'The decision does not bind these exact frozen context bytes', 409);
  }
  const entry = input.context.entry;
  const profile = input.context.profile;
  const source = input.context.source;
  if (source.bodyKind === DERIVED_SOURCE_KIND || source.derivation !== undefined) {
    const provenance = sourceProvenance(source, { columns: source.columns, rows: [{ rowNumber: entry.rowNumber, row: entry.row }] }, source.stream, source.sha256);
    if (provenance.id !== source.id) throw failure('DECISION_SOURCE_CHANGED', 'The frozen derived notice differs from its complete original evidence', 409);
  }
  const identityPairs = [
    ['sourceEntryId', decision.sourceEntryId, entry.id],
    ['noticeId', decision.noticeId, entry.noticeId],
    ['profileId', decision.profileId, profile.id],
    ['profileRevision', decision.profileRevision, profile.revision]
  ];
  for (const [name, declared, observed] of identityPairs) if (declared !== undefined && observed !== undefined && declared !== observed) {
    throw failure('DECISION_IDENTITY_MISMATCH', 'Saved decision ' + name + ' differs from its frozen context', 409);
  }
  if (input.assessment !== undefined && input.assessment !== null) {
    if (!plain(input.assessment) || !plain(input.assessment.binding) || !Array.isArray(input.assessment.checks)) {
      throw failure('INVALID_FROZEN_ASSESSMENT', 'The saved fit assessment must retain its binding and checks');
    }
    const binding = input.assessment.binding;
    const actualRowSha = sha256(canonical(entry.row));
    const actualProfileSha = sha256(canonical(normalizeCapabilityProfile(profile)));
    if (binding.rowSha256 !== actualRowSha || binding.profileSha256 !== actualProfileSha ||
        (binding.entryId !== null && binding.entryId !== undefined && binding.entryId !== entry.id) ||
        (binding.profileId !== null && binding.profileId !== undefined && binding.profileId !== profile.id) ||
        (binding.profileRevision !== null && binding.profileRevision !== undefined && binding.profileRevision !== profile.revision)) {
      throw failure('FIT_CONTEXT_MISMATCH', 'The retained fit assessment belongs to a different entry or profile revision', 409);
    }
  }
  // A copy prevents any accidental report operation from altering the caller's saved objects.
  const envelope = JSON.parse(canonical(input));
  return { envelope, contextSha256, decision: envelope.decision, context: envelope.context,
    assessment: envelope.assessment || null, changes: envelope.changes || null };
}
function referenceCheck(reference, evidence, scope) {
  const base = { scope, reference };
  if (!plain(reference) || !humanRecorded(reference.evidenceId)) return { ...base, state: 'INVALID_REFERENCE', message: 'No saved evidence ID was recorded.', document: null };
  let matches = evidence.filter(document => document.id === reference.evidenceId);
  if (reference.revision !== undefined) matches = matches.filter(document => document.revision === reference.revision);
  if (reference.sha256 !== undefined) matches = matches.filter(document =>
    typeof document.sha256 === 'string' && document.sha256.toLowerCase() === String(reference.sha256).toLowerCase());
  const unique = new Map(matches.map(document => [canonical(document), document]));
  matches = [...unique.values()];
  if (matches.length === 0) return { ...base, state: 'MISSING_OR_CHANGED_EVIDENCE',
    message: 'The exact referenced document revision/hash is not present in this frozen context.', document: null };
  if (matches.length > 1) return { ...base, state: 'AMBIGUOUS_EVIDENCE_REVISION',
    message: 'This reference matches more than one retained document revision; no newer document was substituted.', document: null };
  const document = matches[0];
  if (!Number.isSafeInteger(reference.revision) || reference.revision < 1) return { ...base, state: 'UNVERSIONED_REFERENCE',
    message: 'A document is retained, but this requirement did not bind its saved revision.', document };
  if (!/^[a-fA-F0-9]{64}$/.test(String(reference.sha256 || ''))) return { ...base, state: 'UNHASHED_REFERENCE',
    message: 'The requirement reference has no exact content digest; a link or title alone cannot establish the original bytes.', document };
  if (document.accessState !== 'CAPTURED' || !/^[a-fA-F0-9]{64}$/.test(String(document.sha256 || '')) ||
      !Number.isSafeInteger(document.bytes) || document.bytes < 0 || !humanRecorded(document.capturedAt)) {
    return { ...base, state: 'DOCUMENT_NOT_CAPTURED', message: 'The referenced original document bytes have not been recorded as captured.', document };
  }
  if (document.review?.state !== 'REVIEWED' || !humanRecorded(document.review?.reviewedBy) || !humanRecorded(document.review?.reviewedAt)) {
    return { ...base, state: 'DOCUMENT_REVIEW_UNRECORDED', message: 'The exact captured document has no completed human review record.', document };
  }
  return { ...base, state: 'REFERENCE_SUPPORTED',
    message: 'The retained reference identifies the exact captured document revision and recorded human review.', document };
}
function requirementReview(context) {
  const rows = context.requirements.map(requirement => {
    const sourceChecks = (requirement.sourceEvidence || []).map(reference => referenceCheck(reference, context.evidence, 'source'));
    const supplierChecks = (requirement.supplierEvidence || []).map(reference => referenceCheck(reference, context.evidence, 'supplier'));
    const reviewed = humanRecorded(requirement.reviewedBy) && humanRecorded(requirement.reviewedAt);
    const sourceSupported = sourceChecks.length > 0 && sourceChecks.every(item => item.state === 'REFERENCE_SUPPORTED');
    const supplierSupported = supplierChecks.length > 0 && supplierChecks.every(item => item.state === 'REFERENCE_SUPPORTED');
    let state;
    if (requirement.kind === 'UNKNOWN' || requirement.applicability === 'UNKNOWN') state = 'SCOPE_UNRESOLVED';
    else if (requirement.assessment === 'NOT_MET' && requirement.applicability === 'APPLIES') state = 'RECORDED_NOT_MET';
    else if (requirement.assessment === 'NOT_APPLICABLE' && requirement.applicability === 'DOES_NOT_APPLY' &&
        reviewed && humanRecorded(requirement.applicabilityBasis) && sourceSupported) state = 'RECORDED_NOT_APPLICABLE';
    else if (requirement.assessment === 'MET' && requirement.applicability === 'APPLIES' && reviewed &&
        sourceSupported && supplierSupported) state = 'RECORDED_MET_WITH_EVIDENCE';
    else if (['MET', 'NOT_APPLICABLE'].includes(requirement.assessment)) state = 'EVIDENCE_UNRESOLVED';
    else state = 'ASSESSMENT_UNRESOLVED';
    return { requirement, state, sourceChecks, supplierChecks };
  });
  const mandatory = rows.filter(row => row.requirement.kind === 'MANDATORY');
  return {
    rows,
    counts: {
      total: rows.length,
      mandatory: mandatory.length,
      mandatoryMetWithEvidence: mandatory.filter(row => row.state === 'RECORDED_MET_WITH_EVIDENCE').length,
      mandatoryNotMet: mandatory.filter(row => row.state === 'RECORDED_NOT_MET').length,
      mandatoryNotApplicable: mandatory.filter(row => row.state === 'RECORDED_NOT_APPLICABLE').length,
      mandatoryUnresolved: mandatory.filter(row => !['RECORDED_MET_WITH_EVIDENCE', 'RECORDED_NOT_MET', 'RECORDED_NOT_APPLICABLE'].includes(row.state)).length,
      unknownKind: rows.filter(row => row.requirement.kind === 'UNKNOWN').length
    },
    completenessAttested: false,
    message: 'These counts describe recorded requirements only. They do not attest that every solicitation, annex, amendment or Q&A requirement has been identified. The saved operator choice is retained even when evidence remains unresolved.'
  };
}
function referenceHTML(item) {
  const ref = item.reference || {};
  const title = item.document?.title || ref.evidenceId || '(missing evidence ID)';
  const identity = [ref.evidenceId, ref.revision === undefined ? 'revision not bound' : 'revision ' + ref.revision].filter(Boolean).join(' · ');
  return '<div class="reference"><strong>' + esc(title) + '</strong><div class="mono">' + esc(identity) + '</div>' +
    (ref.sha256 ? '<div class="mono">' + esc(ref.sha256) + '</div>' : '') +
    (ref.pageOrSection ? '<div>Clause / page: ' + esc(ref.pageOrSection) + '</div>' : '') +
    (ref.quote ? '<blockquote>' + esc(ref.quote) + '</blockquote>' : '') +
    (ref.note ? block(ref.note) : '') + badge(item.state) + '<p class="muted">' + esc(item.message) + '</p></div>';
}
function refsHTML(items) { return items.length ? items.map(referenceHTML).join('') : '<span class="muted">No original evidence reference recorded.</span>'; }
function regionRows(values) {
  return (values || []).map(item => [esc(item.family), block(item.code, '(unknown code)'), block(item.label), block(item.note)]);
}
function codeRows(values) {
  return (values || []).map(item => [esc(item.family), block(item.code, '(unknown code)'), block(item.label)]);
}
function sourceFields(context) {
  const keys = [...new Set([...(context.source.columns || []), ...Object.keys(context.entry.row)])];
  return keys.filter(field => has(context.entry.row, field)).map(field => [field, context.entry.row[field]]);
}
function renderHTML(bound) {
  const { decision, context, contextSha256, assessment, changes } = bound;
  const { entry, source, profile, evidence } = context;
  const requirements = requirementReview(context);
  const title = titleOf(entry);
  const actions = Array.isArray(decision.nextActions) ? decision.nextActions : [];
  const decisionFacts = {
    decisionId: decision.id ?? null, revision: decision.revision ?? null, noticeId: decision.noticeId ?? entry.noticeId ?? null,
    owner: decision.owner ?? null, reviewedBy: decision.reviewedBy ?? null, reviewedAt: decision.reviewedAt ?? null,
    createdAt: decision.createdAt ?? null, updatedAt: decision.updatedAt ?? null
  };
  const noticeFacts = {
    sourceEntryId: entry.id, sourceId: entry.sourceId, sourceStream: source.stream ?? entry.summary.stream,
    rowNumber: entry.rowNumber, rowSha256: entry.rowSha256 ?? sha256(canonical(entry.row)),
    referenceNumber: entry.summary.referenceNumber ?? null, solicitationNumber: entry.summary.solicitationNumber ?? null,
    amendmentNumber: entry.summary.amendmentNumber ?? null, publisherUpdatedDate: entry.summary.updatedDate ?? null,
    sourceRetrievedAt: source.retrievedAt ?? entry.importedAt, sourceSha256: source.sha256 ?? null,
    sourceBytes: source.bytes ?? null, sourceCoverage: source.coverage ?? null,
    sourceBodyKind: source.bodyKind ?? null, derivationSha256: source.derivationSha256 ?? null,
    capturedHTMLSha256: source.derivation?.original?.sha256 ?? null
  };
  const profileFacts = { id: profile.id ?? null, revision: profile.revision ?? null,
    label: profile.label, legalName: profile.legalName, operatingNames: profile.operatingNames || [],
    profileSha256: sha256(canonical(profile)), updatedAt: profile.updatedAt ?? null };
  const profileClaims = (profile.qualificationClaims || []).map(claim => [
    block(claim.label), badge(claim.state), block(claim.expiresAt),
    block(claim.evidenceIds), block(claim.note)
  ]);
  const evidenceRows = evidence.map(document => [
    '<strong>' + esc(document.title || document.id) + '</strong><div class="mono">' + esc(document.id) +
      '</div><div>Revision ' + esc(document.revision ?? '(not recorded)') + '</div>',
    badge(document.accessState) + '<div>' + esc(document.kind) + ' · ' + esc(document.language) + '</div>',
    (document.sourceUrl ? link(document.sourceUrl) : '') +
      (document.localOrigin ? block(document.localOrigin) : '') +
      (document.pageOrSection ? '<p>Clause / page: ' + esc(document.pageOrSection) + '</p>' : ''),
    block({ sha256: document.sha256 ?? null, bytes: document.bytes ?? null, capturedAt: document.capturedAt ?? null,
      issuedAt: document.issuedAt ?? null, version: document.version ?? '', supersedes: document.supersedes ?? null }),
    badge(document.review?.state || 'UNREVIEWED') +
      block({ reviewedBy: document.review?.reviewedBy ?? null, reviewedAt: document.review?.reviewedAt ?? null,
        note: document.review?.note ?? '', accessFailure: document.accessFailure ?? '', notes: document.notes ?? '' })
  ]);
  const requirementRows = requirements.rows.map(row => [
    '<strong>' + esc(row.requirement.id || 'Requirement') + '</strong><div>Revision ' +
      esc(row.requirement.revision ?? '(not recorded)') + '</div>' + badge(row.requirement.kind) + block(row.requirement.requirementText),
    badge(row.requirement.applicability) + block(row.requirement.applicabilityBasis),
    badge(row.requirement.assessment) + '<p>' + badge(row.state) + '</p>' +
      block({ reviewedBy: row.requirement.reviewedBy, reviewedAt: row.requirement.reviewedAt }),
    refsHTML(row.sourceChecks),
    refsHTML(row.supplierChecks),
    block({ owner: row.requirement.owner, dueAt: row.requirement.dueAt,
      clarificationQuestion: row.requirement.clarificationQuestion, notes: row.requirement.notes })
  ]);
  const checkRows = (assessment?.checks || []).map(check => [
    '<strong>' + esc(check.code) + '</strong><div>' + esc(check.dimension) + '</div>',
    badge(check.status), block(check.reason), block(check.observed), block(check.declared)
  ]);
  const changeRows = (changes?.changes || []).map(change => [
    '<span class="mono">' + esc(change.path) + '</span><div>' + esc(change.category) + '</div>',
    badge(change.material ? 'REASSESS' : 'PROVENANCE'),
    change.beforePresent ? block(change.before, '(blank)') : '<span class="muted">(absent)</span>',
    change.afterPresent ? block(change.after, '(blank)') : '<span class="muted">(absent)</span>',
    block(change.reason)
  ]);
  const extraEnvelope = Object.fromEntries(Object.entries(bound.envelope).filter(([field]) =>
    !['decision', 'context', 'assessment', 'changes'].includes(field)));
  const knownDecisionFields = new Set(['id', 'noticeId', 'revision', 'sourceEntryId', 'profileId', 'profileRevision',
    'contextSha256', 'choice', 'rationale', 'owner', 'nextActions', 'unknowns', 'conditions', 'reviewedBy', 'reviewedAt',
    'createdAt', 'updatedAt', 'operator']);
  const otherDecision = Object.fromEntries(Object.entries(decision).filter(([field]) => !knownDecisionFields.has(field)));
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="referrer" content="no-referrer">' +
    '<title>' + esc(choiceLabels[decision.choice] + ' — ' + title) + '</title>' +
    '<style>' +
    ':root{color-scheme:light;--ink:#171717;--muted:#575757;--line:#d4d4d4;--paper:#fff;--wash:#f4f4f4}' +
    '*{box-sizing:border-box}body{margin:0;background:var(--wash);color:var(--ink);font:15px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}' +
    'main{max-width:1480px;margin:0 auto;background:var(--paper);padding:36px}header{border-bottom:2px solid var(--ink);padding-bottom:24px}' +
    'h1{font-size:clamp(25px,3vw,38px);line-height:1.2;margin:12px 0 16px;overflow-wrap:anywhere}h2{font-size:21px;margin:0 0 14px}' +
    'h3{font-size:16px;margin:20px 0 8px}section{margin:30px 0;border-bottom:1px solid var(--line);padding-bottom:26px}' +
    'a{color:var(--ink);text-decoration:underline;text-underline-offset:3px;overflow-wrap:anywhere}.eyebrow{font-size:12px;letter-spacing:.1em;text-transform:uppercase}' +
    '.lede{font-size:18px;max-width:1100px}.muted{color:var(--muted)}.badge{display:inline-block;border:1px solid #757575;padding:3px 8px;margin:2px 0;font-size:12px;font-weight:650;letter-spacing:.035em;white-space:normal}' +
    '.decision{display:inline-block;background:#171717;color:#fff;padding:8px 14px;font-size:18px;font-weight:700}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}' +
    '.value{white-space:pre-wrap;overflow-wrap:anywhere}.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;overflow-wrap:anywhere}' +
    '.pairs{display:grid;grid-template-columns:minmax(140px,.3fr) minmax(0,1fr);gap:8px 18px;margin:0}.pairs dt{font-weight:600}.pairs dd{margin:0;min-width:0}' +
    '.table-scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;vertical-align:top;border:1px solid var(--line);padding:10px;overflow-wrap:anywhere}' +
    'th{background:var(--wash);font-weight:650}td .value{max-height:none}ul{padding-left:22px}li{margin:8px 0}.reference+.reference{border-top:1px solid var(--line);margin-top:12px;padding-top:12px}' +
    'blockquote{white-space:pre-wrap;margin:10px 0;padding:8px 12px;border-left:3px solid #8a8a8a;background:var(--wash)}details{margin:16px 0}summary{cursor:pointer;font-weight:600}' +
    '.notice{border-left:3px solid #4b4b4b;background:var(--wash);padding:14px 18px}.counts{display:flex;flex-wrap:wrap;gap:10px}.count{border:1px solid var(--line);padding:10px 14px;min-width:150px}' +
    '.count strong{display:block;font-size:22px}footer{font-size:12px;color:var(--muted);overflow-wrap:anywhere}' +
    '@media(max-width:760px){main{padding:18px}.grid{grid-template-columns:1fr}.pairs{grid-template-columns:1fr;gap:3px}.pairs dd{margin-bottom:12px}th,td{min-width:130px}.count{min-width:120px}}' +
    '@media print{body,main{background:#fff}main{padding:0;max-width:none}a{color:#000}.table-scroll{overflow:visible}thead{display:table-header-group}tr{break-inside:avoid}.grid{display:block}.grid>div{margin-bottom:18px}details{display:block}summary{display:none}h2,h3{break-after:avoid}section{break-inside:auto}.badge{border-color:#555}footer{margin-top:24px}}' +
    '</style></head><body><main>' +
    '<header><div class="eyebrow">CanadaBuys · saved bidder decision</div><h1>' + esc(title) + '</h1>' +
    '<span class="decision">' + esc(choiceLabels[decision.choice]) + '</span>' +
    '<p class="lede">' + esc(decision.rationale || 'No rationale recorded.') + '</p>' +
    '<p class="muted">This report opens the exact saved entry, supplier profile and evidence revisions. The choice records the operator’s decision; saving it does not submit a bid or establish government acceptance.</p>' +
    pairs(decisionFacts) + '</header>' +
    '<section aria-labelledby="actions"><h2 id="actions">Decision conditions and next actions</h2><div class="grid"><div><h3>Conditions</h3>' +
    block(decision.conditions) + '<h3>Unresolved questions</h3>' + list(decision.unknowns, 'No explicit unknowns recorded. Recorded requirement evidence below may still be unresolved.') +
    '</div><div><h3>Actions</h3>' +
    table(['Task', 'Owner', 'Due', 'Status'], actions.map(action => [
      block(action.task), block(action.owner), block(action.dueAt), badge(action.status || 'UNRECORDED')
    ]), 'No next actions recorded.') + '</div></div></section>' +
    '<section aria-labelledby="selection"><h2 id="selection">Frozen source and supplier selection</h2><div class="grid"><div>' +
    pairs(noticeFacts) + '<p>Source: ' + link(source.url || entry.summary.noticeURL) + '</p>' +
    (source.bodyKind === DERIVED_SOURCE_KIND ? '<p class="callout">Separately derived notice: this row is a documented transcription of a retained HTML page, not a row from the original federal CSV feed. Blank fields remain unknown.</p>' +
      pairs({ jurisdiction: source.derivation.jurisdiction, originalHTMLBytes: source.derivation.original.bytes, originalHTMLRetrievedAt: source.derivation.original.retrievedAt, mappingNote: source.derivation.note }) +
      table(['Derived column','Value','Evidence status','Original spans and normalization note'], source.derivation.fields.map(field => [block(field.column), block(field.value), badge(field.status), block({fragments:field.fragments,note:field.note})]), '') : '') +
    (entry.summary.noticeURLs?.en ? '<p>English notice: ' + link(entry.summary.noticeURLs.en) + '</p>' : '') +
    (entry.summary.noticeURLs?.fr ? '<p>French notice: ' + link(entry.summary.noticeURLs.fr) + '</p>' : '') +
    '</div><div>' + pairs(profileFacts) + '<h3>Supplier description</h3>' + block(profile.description) + '</div></div></section>' +
    '<section aria-labelledby="fit"><h2 id="fit">Explainable capability fit</h2>' +
    (assessment ? '<p>' + badge(assessment.overall) + ' Evaluated at <span class="mono">' + esc(assessment.evaluatedAt) + '</span>.</p>' :
      '<p class="muted">No fit evaluation was saved with this decision. The report does not calculate a replacement against today’s time.</p>') +
    '<p class="notice">Code and text matches show declared relevance. Delivery and opportunity regions are compared separately, using the full published qualifiers. Blank or literal asterisk codes remain unknown. Mandatory eligibility requires the original requirement evidence below.</p>' +
    table(['Check', 'Result', 'Reason', 'Original observation', 'Saved supplier declaration'], checkRows, 'No saved fit checks.') +
    (assessment?.deadline ? '<h3>Deadline and publisher status</h3>' + block(assessment.deadline) : '') +
    '</section>' +
    '<section aria-labelledby="requirements"><h2 id="requirements">Requirement and evidence review</h2><div class="counts">' +
    [['Recorded requirements', requirements.counts.total], ['Mandatory recorded', requirements.counts.mandatory],
      ['Mandatory met with evidence', requirements.counts.mandatoryMetWithEvidence], ['Mandatory not met', requirements.counts.mandatoryNotMet],
      ['Mandatory unresolved', requirements.counts.mandatoryUnresolved], ['Requirement kind unknown', requirements.counts.unknownKind]]
      .map(([label, count]) => '<div class="count"><strong>' + count + '</strong>' + esc(label) + '</div>').join('') +
    '</div><p class="notice">' + esc(requirements.message) + '</p>' +
    table(['Original requirement', 'Applicability', 'Recorded assessment', 'Original clause evidence', 'Supplier evidence', 'Follow-through'],
      requirementRows, 'No requirement assessments were recorded. Mandatory review remains open.') + '</section>' +
    '<section aria-labelledby="profile"><h2 id="profile">Saved supplier capability</h2><div class="grid"><div><h3>Commodity codes</h3>' +
    table(['Family', 'Code', 'Label'], codeRows(profile.commodityCodes), 'No commodity code declarations.') +
    '<h3>Categories and phrases</h3>' + pairs({ categories: profile.categories || [], keywords: profile.keywords || [],
      excludedKeywords: profile.excludedKeywords || [] }) + '<h3>Capacity</h3>' + block(profile.capacity) +
    '<h3>Commercial preferences</h3>' + block(profile.commercial) +
    '</div><div><h3>Delivery coverage</h3>' + table(['Family', 'Exact code or text', 'Label', 'Scope note'], regionRows(profile.deliveryRegions), 'No delivery coverage declared.') +
    '<h3>Opportunity regions</h3>' + table(['Family', 'Exact code or text', 'Label', 'Scope note'], regionRows(profile.opportunityRegions), 'No opportunity-region preference declared.') +
    '</div></div><h3>Qualification claims</h3>' + table(['Claim', 'Declared state', 'Expiry', 'Evidence IDs', 'Note'], profileClaims, 'No qualification claims recorded.') +
    '<p class="muted">Profile claims reference evidence IDs. Requirement rows separately bind document revisions and hashes. A newer document in this frozen evidence manifest does not replace an older requirement reference.</p>' +
    '<h3>Profile evidence IDs and notes</h3>' + block({ evidenceIds: profile.evidenceIds || [], notes: profile.notes || '' }) + '</section>' +
    '<section aria-labelledby="documents"><h2 id="documents">Frozen evidence manifest</h2>' +
    table(['Document identity', 'Access and kind', 'Original origin / locator', 'Content and version', 'Human review / access issue'], evidenceRows,
      'No original documents are retained in this decision context. Links and procurement summaries do not establish complete eligibility evidence.') +
    '</section>' +
    '<section aria-labelledby="changes"><h2 id="changes">Changes compared with the prior selected context</h2>' +
    (changes ? '<p>' + badge(changes.requiresReassessment ? 'REASSESSMENT REQUIRED' : changes.initial ? 'INITIAL SELECTION' : 'NO MATERIAL CHANGE RECORDED') +
      '</p>' + pairs({ beforeSha256: changes.beforeSha256, afterSha256: changes.afterSha256,
        materialChangeCount: changes.materialChangeCount, provenanceChangeCount: changes.provenanceChangeCount }) :
      '<p class="muted">No prior-context comparison was saved with this decision.</p>') +
    table(['Changed field', 'Review', 'Before', 'After', 'Reason'], changeRows, 'No individual context changes recorded.') + '</section>' +
    '<section aria-labelledby="raw"><h2 id="raw">Original publisher row</h2><p class="muted">Every original selected row field is retained. A blank cell remains blank; zero, source status and amendment strings retain their original representation.</p>' +
    table(['Original column', 'Original value'], sourceFields(context).map(([field, value]) => [
      '<span class="mono">' + esc(field) + '</span>', block(value, '(blank)')
    ])) + '</section>' +
    (Object.keys(otherDecision).length || Object.keys(extraEnvelope).length ?
      '<section><h2>Additional saved metadata</h2>' + block({ decision: otherDecision, report: extraEnvelope }) + '</section>' : '') +
    '<footer><p>Report schema: <span class="mono">' + DECISION_REPORT_SCHEMA + '</span><br>' +
    'Frozen context SHA-256: <span class="mono">' + esc(contextSha256) + '</span><br>' +
    'The JSON export preserves the full decision envelope, including original source metadata and unknown additional fields. The CSV export provides typed sections with spreadsheet-safe cells.</p>' +
    '<p>Source semantics: ' + link('https://donnees-data.tpsgc-pwgsc.gc.ca/ba2/ac-cb/soutien-support-eng.html', 'CanadaBuys procurement data support') +
    ' · ' + link('https://donnees-data.tpsgc-pwgsc.gc.ca/ba2/ac-cb/achatscanada-canadabuys-dd.xml', 'Procurement data dictionary') +
    ' · ' + link('https://donnees-data.tpsgc-pwgsc.gc.ca/ba2/ac-cb/ocama-sosa-dd.xml', 'SOSA data dictionary') + '</p></footer>' +
    '</main></body></html>\n';
}
function csvCell(value) {
  let result = value === null || value === undefined ? '' : typeof value === 'string' ? value : canonical(value);
  // The JSON export retains exact underlying values; the CSV is safe to open interactively.
  if (/^\s*[=+\-@]/u.test(result) || /^[\t\r\n]/.test(result)) result = "'" + result;
  return '"' + result.replace(/"/g, '""') + '"';
}
function renderCSV(bound) {
  const rows = [];
  const { decision, context, assessment, changes, contextSha256 } = bound;
  const add = (section, recordId, revision, field, status, value, reason = '', source = '', evidence = '', digest = '') =>
    rows.push([section, recordId ?? '', revision ?? '', field, status, value, reason, source, evidence, digest]);
  add('report', decision.id, decision.revision, 'schema', 'SAVED', DECISION_REPORT_SCHEMA);
  add('report', decision.id, decision.revision, 'contextSha256', 'BOUND', contextSha256, '', '', '', contextSha256);
  add('report', decision.id, decision.revision, 'csvRepresentation', 'DISPLAY_SAFE',
    'UTF-8 CSV, CRLF rows, quoted cells. Formula-like cells have a leading apostrophe; exact source values remain in the complete JSON envelope.');
  add('report', decision.id, decision.revision, 'decisionAuthority', 'HUMAN_RECORDED',
    'The operator choice is preserved. Fit is relevance evidence, not automatic compliance, a submitted bid or government acceptance.');
  for (const [field, value] of Object.entries(decision)) add('decision', decision.id, decision.revision, field, decision.choice, value);
  for (const [field, value] of Object.entries(context.source)) add('source-metadata', context.source.id, '', field, 'FROZEN', value, '',
    context.source.url || '', '', context.source.sha256 || '');
  for (const [field, value] of Object.entries(context.entry)) if (field !== 'row') add('source-entry', context.entry.id, '', field, 'FROZEN',
    value, '', context.source.url || '', '', context.entry.rowSha256 || '');
  for (const [field, value] of sourceFields(context)) add(context.source.bodyKind === DERIVED_SOURCE_KIND ? 'derived-row' : 'original-row', context.entry.id, '', field, context.source.bodyKind === DERIVED_SOURCE_KIND ? 'TRANSCRIBED_VALUE' : 'ORIGINAL_VALUE', value, '',
    context.source.url || '', '', context.entry.rowSha256 || '');
  for (const [field, value] of Object.entries(context.profile)) add('supplier-profile', context.profile.id, context.profile.revision,
    field, 'FROZEN', value);
  if (assessment) {
    for (const [field, value] of Object.entries(assessment)) if (!['checks', 'matches', 'gaps', 'unknowns'].includes(field)) {
      add('fit-summary', decision.id, decision.revision, field, assessment.overall, value);
    }
    for (const check of assessment.checks) add('fit-check', check.code, '', check.dimension, check.status,
      { observed: check.observed, declared: check.declared }, check.reason);
  }
  const review = requirementReview(context);
  add('requirement-summary', decision.id, decision.revision, 'counts', 'RECORDED_ONLY', review.counts, review.message);
  for (const item of review.rows) {
    const requirement = item.requirement;
    add('requirement', requirement.id, requirement.revision, 'completeAssessment', item.state, requirement,
      'This row retains the complete saved requirement, assessment and original evidence references.', '',
      [...(requirement.sourceEvidence || []), ...(requirement.supplierEvidence || [])]);
    for (const checked of [...item.sourceChecks, ...item.supplierChecks]) {
      add('requirement-evidence', requirement.id, requirement.revision, checked.scope, checked.state, checked.reference,
        checked.message, checked.document?.sourceUrl || checked.document?.localOrigin || '',
        checked.document ? { id: checked.document.id, revision: checked.document.revision, title: checked.document.title } : '',
        checked.reference?.sha256 || '');
    }
  }
  for (const document of context.evidence) add('evidence-document', document.id, document.revision, 'completeDocument',
    document.accessState, document, '', document.sourceUrl || document.localOrigin || '', '', document.sha256 || '');
  if (changes) {
    for (const [field, value] of Object.entries(changes)) if (field !== 'changes') add('context-comparison', decision.id,
      decision.revision, field, changes.requiresReassessment ? 'REASSESSMENT_REQUIRED' : 'RECORDED', value);
    for (const change of changes.changes || []) add('context-change', decision.id, decision.revision, change.path,
      change.material ? 'REASSESSMENT_REQUIRED' : 'PROVENANCE', change, change.reason);
  }
  for (const [field, value] of Object.entries(context)) if (!['entry', 'source', 'profile', 'evidence', 'requirements'].includes(field)) {
    add('additional-context', decision.id, decision.revision, field, 'FROZEN', value);
  }
  for (const [field, value] of Object.entries(bound.envelope)) if (!['decision', 'context', 'assessment', 'changes'].includes(field)) {
    add('additional-envelope', decision.id, decision.revision, field, 'SAVED', value);
  }
  return [['section', 'record_id', 'revision', 'field', 'status', 'value', 'reason', 'source_reference', 'evidence_references', 'sha256'], ...rows]
    .map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Return a UTF-8 text report; JSON preserves the complete input envelope without adding a new timestamp. */
export function renderDecisionReport(envelope, { format = 'html' } = {}) {
  if (!DECISION_REPORT_FORMATS.includes(format)) throw failure('INVALID_REPORT_FORMAT', 'format must be json, html or csv');
  const bound = bindEnvelope(envelope);
  if (format === 'json') return JSON.stringify(bound.envelope, null, 2) + '\n';
  if (format === 'csv') return renderCSV(bound);
  return renderHTML(bound);
}
