// MIT. Add capture comparison to the original self-contained HAR reviewer.
import { renderReview } from './review.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
const pretty = value => escape(JSON.stringify(value, null, 2));
const statusLabel = {
  carried: 'Decisions carried forward',
  changed: 'Review changed observations',
  'not-observed': 'Not observed in this capture',
};

function operationCard(operation) {
  const changes = operation.changes.map(change => '<details><summary>' + escape(change.label) +
    '</summary><h3>Previous capture</h3><pre>' + pretty(change.previous) +
    '</pre><h3>New capture</h3><pre>' + pretty(change.candidate) + '</pre></details>').join('');
  const groups = '<p>Previous groups: <code>' + escape(operation.previousGroups.join(', ')) +
    '</code><br>New groups: <code>' + escape(operation.candidateGroups.join(', ') || 'none') + '</code></p>';
  const missing = operation.status === 'not-observed' ?
    '<p>This route is unselected in the draft. Its authored decisions remain available below for explicit source-group remapping. Absence from one capture does not establish a removed API.</p>' : '';
  const template = operation.templateMatches.length ?
    '<p>New samples matched this reviewed path template: <code>' + escape(operation.templateMatches.join(', ')) + '</code>. Review their observations and routing before keeping them selected.</p>' : '';
  return '<details><summary><strong>' + escape(operation.operationId) + '</strong> · ' +
    escape(operation.method + ' ' + operation.path) + ' · ' + escape(statusLabel[operation.status]) +
    '</summary><p>' + operation.previousEntries + ' previous requests · ' + operation.candidateEntries +
    ' new requests</p>' + groups + missing + template + changes +
    '<details><summary>Previous authored decisions</summary><pre>' + pretty(operation.previousDecisions) + '</pre></details></details>';
}

/** Keep the existing model, controls, downloads and pinned offline CSP intact. */
export async function renderRefreshReview(packet, review = packet.draft) {
  const { report, manifest, candidate } = packet;
  const s = report.summary;
  const changedFirst = [...report.operations].sort((a, b) =>
    Number(a.status === 'carried') - Number(b.status === 'carried'));
  const unassigned = report.unassigned.slice(0, 200).map(group =>
    '<li><code>' + escape(group.groupId + ' · ' + group.method + ' ' + group.origin + group.path) +
    '</code>' + (group.matchingOperationIds.length ? ' — matches ' + escape(group.matchingOperationIds.join(', ')) : '') + '</li>').join('');
  const overflow = report.unassigned.length > 200 ?
    '<p>Showing the first 200 unselected groups. The complete inventory is available in the operation list and change-report.json.</p>' : '';
  const section = '<section><h2>Capture edition changes</h2>' +
    '<p>' + s.carried + ' carried · ' + s.changed + ' changed · ' + s.notObserved +
    ' not observed · ' + s.unselectedGroups + ' additional unselected groups</p>' +
    '<p>Previous source: <code>' + escape(manifest.lineage.previousSourceSha256) +
    '</code><br>Previous review: <code>' + escape(manifest.lineage.previousReviewSha256) +
    '</code><br>New source: <code>' + escape(manifest.lineage.candidateSourceSha256) + '</code></p>' +
    '<p>Unchanged routes keep their authored decisions and acknowledgment. Changed routes keep their authored values and reopen review; new fields start unresolved. New or ambiguous groups remain unselected. Sample counts alone do not reset an unchanged contract.</p>' +
    '<p class="muted">' + escape(report.interpretation) + '</p>' +
    changedFirst.map(operationCard).join('') +
    '<details><summary>Additional and ambiguous observations (' + report.unassigned.length + ')</summary><ul>' +
    unassigned + '</ul>' + overflow + '</details>' +
    '<p>Use the original controls below to select groups, resolve new fields, author examples and acknowledge each changed operation. Download reviewed decisions when the native source model accepts the complete selection.</p></section>';
  const footer = '<footer><p>Save decisions to the same packet: <code>starforge openapi har refresh save --directory PRIVATE_PACKET --decisions har-decisions.json</code>.</p>' +
    '<p>Export the returned revision with <code>starforge openapi har refresh export --directory PRIVATE_PACKET --revision SHA256 --out NEW_DIRECTORY</code>, or use <code>har refresh package</code> with the existing merchant plan. The normal native merchant package, release and buyer workflows continue from that reviewed source.</p>' +
    '<p>Copy the whole packet with <code>starforge openapi har refresh copy --directory PRIVATE_PACKET --out NEW_PRIVATE_PACKET</code> to retain both source editions and all saved reviews.</p></footer>';
  return (await renderReview(candidate.inventory, review))
    .replace('<title>Stellar Forge · Captured API review</title>', '<title>Stellar Forge · Capture refresh review</title>')
    .replace('<h1>Captured API review</h1>', '<h1>Capture refresh review</h1>')
    .replace('<main>', () => '<main>' + section)
    .replace(/<footer>[\s\S]*?<\/footer>/, () => footer);
}
