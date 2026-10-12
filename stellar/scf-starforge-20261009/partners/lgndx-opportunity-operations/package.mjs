// MIT. Complete procurement handoff files and portable original-store packages.
import { digest, jsonBytes, object } from '../../sf88-operator-buyer-cli/node/store.mjs';

export const OPPORTUNITY_PACKAGE_SCHEMA = 'stellar-forge.opportunity-package.v1';
export const OPPORTUNITY_SNAPSHOT_SCHEMA = 'stellar-forge.opportunity-handoff.v1';
export const MAX_PACKAGE_BYTES = 256 * 1024 * 1024;
const clone = value => structuredClone(value);
const esc = value => String(value ?? '').replace(/[&<>"']/g,
  character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const md = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
const listText = values => Array.isArray(values) ? values.join('; ') : String(values ?? '');
function demand(ok, code) {
  if (!ok) { const error = new Error(code); error.code = code; error.status = 400; throw error; }
}
const sourceMap = project => new Map((project.sources ?? []).map(row => [row.id, row]));
function evidenceText(project, evidence = []) {
  const sources = sourceMap(project);
  return evidence.map(row => {
    const source = sources.get(row.sourceId);
    return [source?.title ?? row.sourceId, row.locator, source?.url,
      'SHA-256 ' + row.sha256, 'dossier revision ' + row.dossierRevision].filter(Boolean).join(' — ');
  }).join('\n');
}
function selectionEvidenceText(project, decision) {
  if (!decision) return '';
  const lines = [];
  for (const [kind, idsKey, versionsKey, collection] of [
    ['Capability', 'capabilityIds', 'capabilityVersions', 'capabilities'],
    ['Team', 'teamIds', 'teamVersions', 'teaming'],
  ]) for (const id of decision[idsKey] ?? []) {
    const record = (project[collection] ?? []).find(row => row.id === id);
    const binding = (decision[versionsKey] ?? []).find(row => row.id === id);
    const selectedVersion = binding?.version;
    const sameVersion = record && selectedVersion === record.version;
    lines.push(kind + ': ' + (record?.title || record?.name || id) + ' [' + id + ']' +
      ' · reviewed version ' + (selectedVersion ?? 'not recorded') +
      (sameVersion ? '' : ' · current version ' + (record?.version ?? 'unavailable') + ' requires review'));
    if (sameVersion) {
      lines.push(kind === 'Capability' ?
        'Record: ' + record.status + ' · delivery ' + record.deliveryStatus :
        'Role: ' + record.role + ' · decision ' + record.decision);
      const evidence = evidenceText(project, record.evidence);
      if (evidence) lines.push(evidence);
    }
  }
  return lines.join('\n');
}
function requirementEvidenceText(project, requirement, decision) {
  const parts = ['Issued requirement:\n' + (evidenceText(project, requirement.evidence) || 'No source selected')];
  if (decision) {
    parts.push('Response evidence:\n' + (evidenceText(project, decision.evidence) || 'No direct response source selected'));
    const selected = selectionEvidenceText(project, decision);
    if (selected) parts.push('Selected records:\n' + selected);
  }
  return parts.join('\n\n');
}
function sections(project) {
  const coverage = new Map((project.coverage ?? []).map(row => [row.requirementId, row]));
  return [
    {title: 'Requirements and responses', columns: ['Number', 'Requirement', 'Disposition', 'Coverage', 'Owner', 'Response', 'Review', 'Sources and response bindings'],
      rows: (project.requirements ?? []).map(row => {
        const decision = coverage.get(row.id);
        return [row.number, row.title + '\n' + row.text, row.responseDisposition,
          decision?.decision ?? 'unreviewed', decision?.owner || row.owner, decision?.response ?? '',
          [decision?.reviewNote, row.reviewRequired || decision?.reviewRequired ? 'Source update requires review' : ''].filter(Boolean).join('\n'),
          requirementEvidenceText(project, row, decision)];
      })},
    {title: 'Company capabilities and past performance', columns: ['Title', 'Kind', 'Delivery', 'Status', 'Owner', 'Description', 'Source'],
      rows: (project.capabilities ?? []).map(row => [row.title, row.kind, row.deliveryStatus,
        row.status, row.owner, row.description, evidenceText(project, row.evidence)])},
    {title: 'Teaming decisions', columns: ['Organization / team', 'Role', 'Decision', 'Owner', 'Scope', 'Note', 'Source'],
      rows: (project.teaming ?? []).map(row => [row.name, row.role, row.decision, row.owner,
        row.scope, row.note, evidenceText(project, row.evidence)])},
    {title: 'Milestones and dependencies', columns: ['Title', 'Owner', 'Due', 'Time zone', 'Status', 'Dependencies', 'Source'],
      rows: (project.milestones ?? []).map(row => [row.title, row.owner, row.dueAt,
        row.timeZone, row.status, listText(row.dependsOn), evidenceText(project, row.evidence)])},
    {title: 'Questions and answers', columns: ['Number', 'Question', 'Owner', 'Due', 'Status', 'Answer', 'Source'],
      rows: (project.questions ?? []).map(row => [row.number, row.text, row.owner, row.dueAt,
        row.status, row.answer, evidenceText(project, row.evidence)])},
    {title: 'Source change decisions', columns: ['Change', 'Before', 'After', 'Status', 'Decision', 'Review note', 'Affected records'],
      rows: (project.changes ?? []).map(row => [row.id, row.beforeSourceId, row.afterSourceId,
        row.status, row.decision, row.note, listText(row.affectedIds)])},
    {title: 'Retained source register', columns: ['Title', 'Role', 'Captured', 'Publisher / location', 'SHA-256', 'Bytes', 'Dossier revision'],
      rows: (project.sources ?? []).map(row => [row.title, row.role, row.capturedAt,
        row.url || row.filename, row.sha256, row.bytes, row.dossierRevision])},
  ];
}
function readiness(project) {
  const coverage = new Map((project.coverage ?? []).map(row => [row.requirementId, row]));
  const issues = [];
  for (const requirement of project.requirements ?? []) {
    if (requirement.status === 'retired') continue;
    const decision = coverage.get(requirement.id);
    if (requirement.mandatory && requirement.responseDisposition === 'unanswered')
      issues.push(requirement.number + ': record an answer or N/A disposition.');
    if (requirement.responseDisposition === 'answer' && !decision?.response?.trim())
      issues.push(requirement.number + ': response text is empty.');
    if (requirement.responseDisposition === 'not_applicable' && !decision?.reviewNote?.trim())
      issues.push(requirement.number + ': record the N/A rationale in the review note.');
    if (requirement.reviewRequired || decision?.reviewRequired)
      issues.push(requirement.number + ': review the changed source binding.');
  }
  for (const milestone of project.milestones ?? []) if (milestone.blocked && milestone.status !== 'cancelled')
    issues.push('Milestone ' + milestone.title + ': predecessor work is incomplete.');
  for (const change of project.changes ?? []) if (change.status !== 'reviewed')
    issues.push('Source change ' + change.id + ': review is pending.');
  return issues;
}
export function opportunityHandoffReadiness(project) {
  const issues = readiness(project);
  return {issues, unresolvedItems: issues.length, status: issues.length ? 'review_required' : 'recorded',
    responseRules: clone(project.responseRules ?? {}),
    pageReview: 'Recorded page limits remain subject to review of the final formatted submission.'};
}
export function renderOpportunityMarkdown(project) {
  const lines = ['# ' + md(project.title), '',
    'Project: ' + md(project.id) + ' · Revision: ' + project.revision, '',
    md(project.description), '',
    '## Company', '',
    '**' + md(project.company?.name) + '**  ',
    [project.company?.website, project.company?.uei, listText(project.company?.naics)].filter(Boolean).map(md).join(' · '), '',
    md(project.company?.description), '',
    '## Opportunity', '',
    '**' + md(project.opportunity?.title) + '**  ',
    [project.opportunity?.buyer, project.opportunity?.reference, project.opportunity?.documentKind, project.opportunity?.stage]
      .filter(Boolean).map(md).join(' · '), '',
    'Response due: ' + md(project.opportunity?.dueAt || 'Not recorded') + ' ' + md(project.opportunity?.timeZone), '',
    md(project.opportunity?.url), '', md(project.opportunity?.notes), '',
    '## Response rules', '',
    'Total page limit: ' + md(project.responseRules?.maxPages ?? 'Not recorded') + '  ',
    'Capability statement page limit: ' + md(project.responseRules?.capabilityMaxPages ?? 'Not recorded') + '  ',
    'Excluded sections: ' + md(listText(project.responseRules?.excludedSections)), '',
    md(project.responseRules?.notes), '', md(evidenceText(project, project.responseRules?.evidence)), '',
    '## Preparation review', ''];
  const review = readiness(project);
  lines.push(...(review.length ? review.map(item => '- ' + md(item)) : ['All required response dispositions and response text are recorded.']));
  lines.push('', 'Review the final formatted submission against the retained source page rules.', '');
  for (const section of sections(project)) {
    lines.push('## ' + section.title, '', '| ' + section.columns.map(md).join(' | ') + ' |',
      '| ' + section.columns.map(() => '---').join(' | ') + ' |');
    for (const row of section.rows) lines.push('| ' + row.map(md).join(' | ') + ' |');
    if (!section.rows.length) lines.push('| ' + section.columns.map((_, index) => index ? '' : 'No records').join(' | ') + ' |');
    lines.push('');
  }
  lines.push('## Revision history', '', '| Revision | Time | Operator | Action | State SHA-256 |',
    '| --- | --- | --- | --- | --- |');
  for (const row of project.history ?? []) lines.push('| ' +
    [row.revision, row.createdAt, row.operator, row.action, row.sha256].map(md).join(' | ') + ' |');
  return lines.join('\n') + '\n';
}
export function renderOpportunityHtml(project) {
  const table = (columns, rows) => '<div class="table"><table><thead><tr>' +
    columns.map(value => '<th>' + esc(value) + '</th>').join('') +
    '</tr></thead><tbody>' + (rows.length ? rows.map(row => '<tr>' +
      row.map(value => '<td>' + esc(value) + '</td>').join('') + '</tr>').join('') :
      '<tr><td colspan="' + columns.length + '">No records</td></tr>') + '</tbody></table></div>';
  const review = readiness(project);
  const summary = [
    ['Company', project.company?.name], ['Company identifier', project.company?.uei],
    ['Opportunity', project.opportunity?.title], ['Buyer', project.opportunity?.buyer],
    ['Reference', project.opportunity?.reference], ['Document kind', project.opportunity?.documentKind],
    ['Stage', project.opportunity?.stage], ['Due', project.opportunity?.dueAt],
    ['Time zone', project.opportunity?.timeZone], ['Total page limit', project.responseRules?.maxPages],
    ['Capability page limit', project.responseRules?.capabilityMaxPages],
    ['Excluded sections', listText(project.responseRules?.excludedSections)],
  ];
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"><title>' + esc(project.title) +
    '</title><style>body{font:14px/1.5 system-ui,sans-serif;color:#171717;background:#fff;max-width:1500px;margin:32px auto;padding:0 24px}h1{font-size:26px}h2{font-size:19px;margin-top:32px}p,td{white-space:pre-wrap;overflow-wrap:anywhere}header{border-bottom:2px solid #333;padding-bottom:18px}.muted{color:#555}.table{overflow:auto}table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;vertical-align:top;border:1px solid #bbb;padding:9px}th{background:#eee}dl{display:grid;grid-template-columns:minmax(150px,220px) 1fr;gap:6px 16px}dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}code{font-family:ui-monospace,monospace}@media print{body{margin:0;padding:0;max-width:none;font-size:10pt}th{background:#eee!important}thead{display:table-header-group}tr{break-inside:avoid}h2{break-after:avoid}.table{overflow:visible}table{font-size:8pt}a{color:inherit}}</style></head><body><header><h1>' +
    esc(project.title) + '</h1><p class="muted">' + esc(project.id) + ' · Revision ' + project.revision +
    ' · Dossier ' + esc(project.dossier?.id) + ' / ' + esc(project.dossier?.revision) +
    '</p><p>' + esc(project.description) + '</p></header><h2>Opportunity and company</h2><dl>' +
    summary.map(([key, value]) => '<dt>' + esc(key) + '</dt><dd>' + esc(value || 'Not recorded') + '</dd>').join('') +
    '</dl><p>' + esc(project.opportunity?.notes) + '</p><h2>Response rules</h2><p>' +
    esc(project.responseRules?.notes) + '</p><p>' + esc(evidenceText(project, project.responseRules?.evidence)) +
    '</p><h2>Preparation review</h2>' + (review.length ? '<ul>' +
      review.map(value => '<li>' + esc(value) + '</li>').join('') + '</ul>' :
      '<p>All required response dispositions and response text are recorded.</p>') +
    '<p>Review the final formatted submission against the retained source page rules.</p>' +
    sections(project).map(section => '<h2>' + section.title + '</h2>' + table(section.columns, section.rows)).join('') +
    '<h2>Revision history</h2>' + table(['Revision', 'Time', 'Operator', 'Action', 'State SHA-256'],
      (project.history ?? []).map(row => [row.revision, row.createdAt, row.operator, row.action, row.sha256])) +
    '</body></html>\n';
}
const CSV_COLUMNS = Object.freeze({
  requirements: ['id', 'number', 'title', 'text', 'category', 'mandatory', 'evidenceRule', 'responseDisposition',
    'status', 'owner', 'decision', 'coverageOwner', 'response', 'reviewNote', 'capabilityIds', 'capabilityVersions',
    'teamIds', 'teamVersions', 'reviewRequired', 'reviewReasons', 'evidence', 'coverageEvidence', 'selectionEvidence'],
  capabilities: ['id', 'title', 'kind', 'deliveryStatus', 'status', 'owner', 'description', 'tags', 'reviewRequired', 'evidence'],
  teaming: ['id', 'name', 'role', 'decision', 'owner', 'scope', 'note', 'capabilityIds', 'requirementIds', 'evidence'],
  milestones: ['id', 'title', 'owner', 'dueAt', 'timeZone', 'status', 'dependsOn', 'requirementIds', 'blocked', 'note', 'evidence'],
  questions: ['id', 'number', 'text', 'owner', 'dueAt', 'status', 'answer', 'requirementIds', 'evidence'],
});
function csv(value) {
  let text = value === null || value === undefined ? '' :
    typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
export function renderOpportunityCsv(project, kind) {
  const columns = CSV_COLUMNS[kind]; demand(columns, 'CSV_KIND_INVALID');
  const decisions = new Map((project.coverage ?? []).map(row => [row.requirementId, row]));
  const rows = (project[kind] ?? []).map(row => {
    if (kind !== 'requirements') return row;
    const decision = decisions.get(row.id);
    return {...row, ...(decision ? Object.fromEntries(['decision', 'response', 'reviewNote',
      'capabilityIds', 'capabilityVersions', 'teamIds', 'teamVersions']
      .map(key => [key, decision[key]])) : {}), coverageOwner: decision?.owner ?? '',
      reviewRequired: Boolean(row.reviewRequired || decision?.reviewRequired),
      reviewReasons: decision?.reviewReasons ?? [],
      coverageEvidence: decision?.evidence ?? [], selectionEvidence: selectionEvidenceText(project, decision)};
  });
  return columns.map(csv).join(',') + '\r\n' + rows.map(row =>
    columns.map(key => csv(['evidence', 'coverageEvidence'].includes(key) ?
      evidenceText(project, row[key]) : row[key])).join(',')).join('\r\n') + '\r\n';
}
export function opportunityReportFiles(project) {
  const raw = [
    ['handoff.html', 'text/html; charset=utf-8', renderOpportunityHtml(project)],
    ['handoff.md', 'text/markdown; charset=utf-8', renderOpportunityMarkdown(project)],
    ...Object.keys(CSV_COLUMNS).map(kind => [kind + '.csv', 'text/csv; charset=utf-8', renderOpportunityCsv(project, kind)]),
  ];
  return raw.map(([path, mediaType, text]) => {
    const body = Buffer.from(text, 'utf8');
    return {path, mediaType, bytes: body.length, sha256: digest(body), contentBase64: body.toString('base64')};
  });
}
export function createOpportunitySnapshot(project, {id, title, status, note, operator, createdAt, sourceStateSha256, dossierExportedAt}) {
  const unsigned = {schema: OPPORTUNITY_SNAPSHOT_SCHEMA, id, projectId: project.id,
    sourceRevision: project.revision, sourceStateSha256, title, status, note, operator, createdAt, dossierExportedAt,
    project: clone(project), readiness: opportunityHandoffReadiness(project), files: opportunityReportFiles(project)};
  return {...unsigned, sha256: digest(jsonBytes(unsigned))};
}
export function assembleOpportunityPackage({project, versions, dossier, sealedPackages = [], selectedPackageId = null}) {
  const selected = selectedPackageId ? sealedPackages.find(row => row.id === selectedPackageId) : null;
  demand(!selectedPackageId || selected, 'HANDOFF_PACKAGE_NOT_FOUND');
  const unsigned = {schema: OPPORTUNITY_PACKAGE_SCHEMA, projectId: project.id, revision: project.revision,
    createdAt: selected ? selected.createdAt : new Date().toISOString(), selectedPackageId, project: clone(project),
    versions: clone(versions), dossier: clone(dossier), sealedPackages: clone(sealedPackages),
    files: selected ? clone(selected.files) : opportunityReportFiles(project)};
  const result = {...unsigned, sha256: digest(jsonBytes(unsigned))};
  demand(jsonBytes(result).length <= MAX_PACKAGE_BYTES, 'OPPORTUNITY_PACKAGE_TOO_LARGE');
  return result;
}
function validateFiles(files) {
  demand(Array.isArray(files), 'HANDOFF_FILES_INVALID');
  const names = new Set();
  for (const file of files) {
    demand(object(file) && typeof file.path === 'string' && /^[a-z][a-z0-9._-]{0,99}$/.test(file.path) &&
      !names.has(file.path) && typeof file.mediaType === 'string' &&
      typeof file.contentBase64 === 'string', 'HANDOFF_FILE_INVALID');
    names.add(file.path);
    const bytes = Buffer.from(file.contentBase64, 'base64');
    demand(bytes.toString('base64') === file.contentBase64 && bytes.length === file.bytes &&
      digest(bytes) === file.sha256, 'HANDOFF_FILE_CHANGED');
  }
}
export function validateOpportunitySnapshot(snapshot) {
  demand(object(snapshot) && snapshot.schema === OPPORTUNITY_SNAPSHOT_SCHEMA, 'HANDOFF_SNAPSHOT_INVALID');
  const {sha256, ...unsigned} = snapshot;
  demand(sha256 === digest(jsonBytes(unsigned)), 'HANDOFF_SNAPSHOT_CHANGED');
  validateFiles(snapshot.files);
  demand(typeof snapshot.dossierExportedAt === 'string' && Number.isFinite(Date.parse(snapshot.dossierExportedAt)),
    'HANDOFF_DOSSIER_EXPORT_TIME_INVALID');
  const generated = opportunityReportFiles(snapshot.project);
  demand(JSON.stringify(generated) === JSON.stringify(snapshot.files), 'HANDOFF_RENDERED_FILES_CHANGED');
  demand(snapshot.project?.id === snapshot.projectId && snapshot.project?.revision === snapshot.sourceRevision,
    'HANDOFF_PROJECT_CHANGED');
  return snapshot;
}
export function validateOpportunityPackage(packet) {
  demand(object(packet) && packet.schema === OPPORTUNITY_PACKAGE_SCHEMA &&
    typeof packet.projectId === 'string' && Number.isSafeInteger(packet.revision) &&
    Array.isArray(packet.versions) && packet.versions.length === packet.revision &&
    Array.isArray(packet.sealedPackages) && object(packet.project) && object(packet.dossier),
    'OPPORTUNITY_PACKAGE_INVALID');
  demand(jsonBytes(packet).length <= MAX_PACKAGE_BYTES, 'OPPORTUNITY_PACKAGE_TOO_LARGE');
  const {sha256, ...unsigned} = packet;
  demand(sha256 === digest(jsonBytes(unsigned)), 'OPPORTUNITY_PACKAGE_CHANGED');
  demand(packet.project.id === packet.projectId && packet.project.revision === packet.revision,
    'OPPORTUNITY_PACKAGE_PROJECT_CHANGED');
  validateFiles(packet.files);
  const seen = new Set();
  for (const snapshot of packet.sealedPackages) {
    validateOpportunitySnapshot(snapshot);
    demand(snapshot.projectId === packet.projectId && !seen.has(snapshot.id), 'HANDOFF_PACKAGE_IDENTITY_CHANGED');
    seen.add(snapshot.id);
  }
  demand(packet.selectedPackageId === null || seen.has(packet.selectedPackageId), 'HANDOFF_PACKAGE_NOT_FOUND');
  const selected = packet.selectedPackageId ? packet.sealedPackages.find(row => row.id === packet.selectedPackageId) : null;
  const generated = selected ? selected.files : opportunityReportFiles(packet.project);
  demand(JSON.stringify(generated) === JSON.stringify(packet.files), 'PORTABLE_RENDERED_FILES_CHANGED');
  return packet;
}
