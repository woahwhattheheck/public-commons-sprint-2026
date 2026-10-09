/** Offline, resumable review workspace layered on the existing Studio extractor. */
import {createHash} from 'node:crypto';
import {extract} from './app.mjs';
export const SCHEMA = 'academic-evidence-workspace/v1';
const hash = text => createHash('sha256').update(text, 'utf8').digest('hex');
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const decisions = new Set(['pending', 'supported', 'contradicted', 'insufficient']);
const identifier = s => typeof s === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(s);
function text(v, name, max, required = true) {
  if (typeof v !== 'string' || v.length > max || (required && !v.trim())) throw Error(`${name} is invalid`);
  return v.trim();
}
function review(value, evidence) {
  if (!object(value) || !decisions.has(value.decision)) throw Error('review decision is invalid');
  const reviewer = text(value.reviewer ?? '', 'reviewer', 100, false);
  const note = text(value.note ?? '', 'review note', 2000, false);
  if (!Array.isArray(value.evidence_ids) || value.evidence_ids.length > 8) throw Error('review evidence IDs are invalid');
  const allowed = new Set(evidence.map(e => e.id));
  if (value.evidence_ids.some(id => typeof id !== 'string' || !allowed.has(id))) throw Error('review references unknown evidence');
  const ids = [...new Set(value.evidence_ids)];
  if (value.decision !== 'pending' && (!reviewer || !note)) throw Error('record a reviewer and reason for a decision');
  if (['supported', 'contradicted'].includes(value.decision) && !ids.length) throw Error('select evidence for a supported or contradicted decision');
  return {decision:value.decision, reviewer, note, evidence_ids:ids, origin:'user-entered'};
}
export function createWorkspace(input) {
  if (!object(input)) throw Error('workspace input must be an object');
  const title = text(input.title ?? 'Research review', 'title', 150);
  if (!Array.isArray(input.claims) || input.claims.length < 1 || input.claims.length > 20) throw Error('provide 1–20 claims');
  const seen = new Set(); let sources;
  const claims = input.claims.map((value, i) => {
    const c = typeof value === 'string' ? {text:value} : value;
    if (!object(c)) throw Error('claim must be a string or object');
    const id = c.id ?? `claim-${i + 1}`;
    if (!identifier(id) || seen.has(id)) throw Error('claim IDs must be unique simple identifiers');
    seen.add(id);
    const claim = text(c.text, 'claim text', 1000);
    const result = extract({claim, sources:input.sources, mode:'offline'});
    sources ??= result.sources;
    // Store offsets instead of duplicating source quotations across every claim.
    const evidence = result.evidence.map(({quote, title, ...record}) => record);
    const basis_sha256 = hash(JSON.stringify({claim, sources:sources.map(s => ({id:s.id, title:s.title, sha256:s.sha256}))}));
    return {id, text:claim, basis_sha256, evidence,
      review:{decision:'pending', reviewer:'', note:'', evidence_ids:[], origin:'user-entered'}};
  });
  return {schema:SCHEMA, title, mode:'offline', sources, claims};
}
export function restoreWorkspace(saved) {
  if (!object(saved) || saved.schema !== SCHEMA || saved.mode !== 'offline') throw Error('unsupported workspace schema or mode');
  const rebuilt = createWorkspace(saved);
  for (let i = 0; i < rebuilt.sources.length; i++) {
    if (saved.sources[i].sha256 !== rebuilt.sources[i].sha256) throw Error('source content checksum changed');
  }
  rebuilt.claims.forEach((claim, i) => {
    const prior = saved.claims[i];
    if (claim.basis_sha256 !== prior.basis_sha256) throw Error('claim or source basis changed; create a new workspace to re-review');
    // Recompute evidence from the original corpus, never trust imported offsets.
    claim.review = review(prior.review, claim.evidence);
  });
  return rebuilt;
}
export function applyReview(saved, id, value) {
  const workspace = restoreWorkspace(saved);
  const claim = workspace.claims.find(c => c.id === id);
  if (!claim) throw Error('unknown claim ID');
  claim.review = review(value, claim.evidence);
  return workspace;
}
const md = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_{}\[\]()#+.!|\-]/g, '\\$&');
export function exportReport(saved) {
  const workspace = restoreWorkspace(saved);
  const completed = workspace.claims.filter(c => c.review.decision !== 'pending').length;
  const lines = [`# ${md(workspace.title)}`, '',
    'Offline evidence retrieval. Decisions below are user-entered research judgments, not model verification or authenticated signatures.', '',
    `${completed} of ${workspace.claims.length} claims reviewed. Offsets are zero-based, end-exclusive UTF-16 code units in the unmodified source body.`, '',
    '## Source corpus', ''];
  for (const s of workspace.sources) lines.push(`- **${md(s.id)} — ${md(s.title)}**; SHA-256: \`${s.sha256}\``);
  for (const c of workspace.claims) {
    lines.push('', `## ${md(c.id)}: ${md(c.text)}`, '', `**Decision:** ${c.review.decision}`, '',
      `**Reviewer (user-entered):** ${md(c.review.reviewer || 'Not recorded')}`, '', `**Reason:** ${md(c.review.note || 'Pending review')}`, '',
      `Claim/source basis SHA-256: \`${c.basis_sha256}\``, '', '### Retrieved evidence', '');
    if (!c.evidence.length) lines.push('No matching excerpts. This does not establish that the claim is false.');
    for (const e of c.evidence) {
      const s = workspace.sources.find(source => source.id === e.source_id);
      const quote = s.body.slice(e.start, e.end);
      lines.push(`**${e.id} · ${md(e.source_id)} [${e.start}, ${e.end})${c.review.evidence_ids.includes(e.id) ? ' · SELECTED BY REVIEWER' : ''}**`, '',
        ...quote.split('\n').map(line => `> ${md(line)}`), '', `Quote SHA-256: \`${e.quote_sha256}\``, '');
    }
  }
  return lines.join('\n') + '\n';
}
