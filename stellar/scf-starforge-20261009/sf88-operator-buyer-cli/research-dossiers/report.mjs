// MIT — Reports contain retained source material and the analyst's own work.
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const md = value => String(value ?? '').replace(/[\\\x60*_{}\[\]<>#+!|]/g, '\\$&');
const rendered = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
const url = value => { try { const parsed = new URL(value); return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : ''; } catch { return ''; } };
const link = (label, target) => { const href = url(target); return href ? '<a href="' + escape(href) + '" rel="noreferrer">' + escape(label) + '</a>' : escape(label); };
const occurrenceRecords = source => source.citations.map(citation => ({
  occurrenceId: citation.occurrenceId, editionId: citation.editionId,
  questionId: citation.questionId, key: citation.key, original: citation.original,
}));
function includedSources(view) {
  const references = new Set(view.findings.flatMap(finding => finding.sourceIds));
  return view.sources.filter(source => source.selected || references.has(source.id));
}
function analystNotes(view) {
  const unique = new Map();
  for (const selection of view.unavailableSelections ?? []) {
    if (!selection.note && !selection.selected) continue;
    const key = selection.questionId + '\n' + selection.editionId + '\n' + selection.note;
    if (!unique.has(key)) unique.set(key, selection);
  }
  return [...unique.values()];
}
function fence(value) {
  const content = rendered(value);
  const runs = content.match(/\x60+/g) ?? [];
  const marker = '\x60'.repeat(Math.max(3, ...runs.map(run => run.length + 1)));
  return marker + (typeof value === 'string' ? 'text' : 'json') + '\n' + content + '\n' + marker;
}

export function markdownReport(view) {
  const sources = includedSources(view), numbering = new Map(sources.map((source, index) => [source.id, index + 1]));
  const lines = ['# ' + md(view.title), '', view.description, '',
    'Revision ' + view.revision + ' · ' + view.updatedAt, '', '## Research questions', ''];
  for (const question of view.questions) {
    lines.push('### ' + md(question.text), '', 'Status: ' + question.status, '');
    if (question.notes) lines.push(question.notes, '');
    for (const finding of view.findings.filter(row => row.questionId === question.id)) {
      const references = finding.sourceIds.map(id => numbering.get(id)).filter(Boolean).map(number => '[' + number + ']').join(' ');
      lines.push('#### ' + md(finding.title), '', finding.text, '', references, '');
      if (finding.unavailableSources) lines.push('Original edition references: ' + finding.occurrenceIds.join(', '), '');
    }
  }
  lines.push('## Selected sources', '');
  if (!sources.length) lines.push('No retained sources selected for this report.', '');
  for (const [index, source] of sources.entries()) {
    lines.push('### [' + (index + 1) + '] ' + md(source.title), '');
    if (url(source.url)) lines.push('<' + url(source.url).replace(/>/g, '%3E') + '>', '');
    if (source.authors.length) lines.push('Authors: ' + source.authors.map(md).join('; '), '');
    lines.push('Provider: ' + md(source.provider) + (source.publishedAt ? ' · Published: ' + md(source.publishedAt) : ''), '');
    lines.push('Assessment: ' + source.classification, '');
    if (source.note) lines.push(source.note, '');
    for (const variant of source.variants) {
      lines.push('Edition ' + variant.editionId, '', fence(variant.content), '');
    }
    lines.push('Original occurrences: ' + source.citations.map(citation => citation.editionId + '/' + citation.key).join(', '), '');
    lines.push('Original source records:', '', fence(occurrenceRecords(source)), '');
  }
  const notes = analystNotes(view);
  if (notes.length) {
    lines.push('## Notes attached to original edition references', '');
    for (const note of notes) lines.push('- ' + md(note.editionId + '/' + note.key) + ' · ' + note.classification +
      (note.note ? '\n\n' + note.note : ''), '');
  }
  lines.push('## Editions and source usage', '',
    '| Edition | Provider | Storage | Status | Source observations |',
    '| --- | --- | --- | --- | --- |');
  for (const edition of view.editions) lines.push('| ' + [edition.label, edition.provider, edition.mode,
    edition.status, JSON.stringify(edition.usage)].map(value => md(value).replace(/\n/g, ' ')).join(' | ') + ' |');
  lines.push('', '## Source terms and original operation references', '');
  for (const edition of view.editions) {
    lines.push('- ' + md(edition.label) + ': ' + md(edition.sourceTerms ?? 'Original edition access') +
      (edition.sourceReference ? ' · ' + md(edition.sourceReference) : ''), '');
    if (edition.reference) lines.push(fence(edition.reference), '');
    if (edition.origin) lines.push(fence(edition.origin), '');
  }
  return lines.join('\n') + '\n';
}

export function htmlReport(view) {
  const sources = includedSources(view), numbers = new Map(sources.map((source, index) => [source.id, index + 1]));
  const questions = view.questions.map(question => '<section><h2>' + escape(question.text) +
    '</h2><p class="muted">Status: ' + escape(question.status) + '</p>' +
    (question.notes ? '<div class="prose">' + escape(question.notes) + '</div>' : '') +
    view.findings.filter(row => row.questionId === question.id).map(finding =>
      '<article><h3>' + escape(finding.title) + '</h3><div class="prose">' + escape(finding.text) +
      '</div><p>' + finding.sourceIds.filter(id => numbers.has(id)).map(id =>
        '<a href="#source-' + numbers.get(id) + '">[' + numbers.get(id) + ']</a>').join(' ') + '</p>' +
      (finding.unavailableSources ? '<details><summary>Original edition references</summary><pre>' +
        escape(finding.occurrenceIds.join('\n')) + '</pre></details>' : '') + '</article>').join('') + '</section>').join('');
  const sourceHtml = sources.map((source, index) => '<article id="source-' + (index + 1) + '"><h3>[' +
    (index + 1) + '] ' + link(source.title, source.url) + '</h3><p class="muted">' +
    escape([source.provider, source.publishedAt, source.authors.join('; ')].filter(Boolean).join(' · ')) +
    '</p><p>Assessment: ' + escape(source.classification) + '</p>' +
    (source.note ? '<div class="prose">' + escape(source.note) + '</div>' : '') +
    source.variants.map(variant => '<details open><summary>Edition ' + escape(variant.editionId) +
      '</summary><pre>' + escape(rendered(variant.content)) + '</pre></details>').join('') +
    '<details><summary>Original source records</summary><pre>' +
    escape(JSON.stringify(occurrenceRecords(source), null, 2)) + '</pre></details></article>').join('');
  const notes = analystNotes(view).map(note => '<article><h3>' + escape(note.editionId + '/' + note.key) +
    '</h3><p>' + escape(note.classification) + '</p><div class="prose">' + escape(note.note) + '</div></article>').join('');
  const editions = view.editions.map(edition => '<tr><td>' + escape(edition.label) + '</td><td>' +
    escape(edition.provider) + '</td><td>' + escape(edition.mode) + '</td><td>' + escape(edition.status) +
    '</td><td><pre>' + escape(JSON.stringify(edition.usage, null, 2)) + '</pre></td></tr>').join('');
  const origins = view.editions.map(edition => '<details><summary>' + escape(edition.label) +
    '</summary><p>' + escape(edition.sourceTerms ?? 'Original edition access') + '</p>' +
    (edition.sourceReference ? '<p>' + link(edition.sourceReference, edition.sourceReference) + '</p>' : '') +
    '<pre>' + escape(JSON.stringify(edition.reference ?? edition.origin ?? {}, null, 2)) + '</pre></details>').join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src \'none\'; base-uri \'none\'; form-action \'none\'">' +
    '<title>' + escape(view.title) + '</title><style>' +
    '*{box-sizing:border-box}body{margin:0;background:#f5f5f4;color:#202020;font:15px/1.6 system-ui,sans-serif}' +
    'main{max-width:1060px;margin:0 auto;padding:48px 32px 80px;background:#fff}h1{font-size:32px;line-height:1.2}h2{font-size:22px;margin-top:40px}' +
    'h3{font-size:17px}section,article{break-inside:avoid}article{border-top:1px solid #d5d5d2;padding:18px 0}.muted{color:#62625e}' +
    '.prose{white-space:pre-wrap;overflow-wrap:anywhere;margin:12px 0}a{color:#202020;text-underline-offset:3px}' +
    'pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 ui-monospace,monospace;background:#f3f3f0;padding:12px;border:1px solid #deded8}' +
    'table{border-collapse:collapse;width:100%}th,td{text-align:left;border:1px solid #d5d5d2;padding:8px;vertical-align:top}td pre{margin:0;padding:0;border:0;background:none}' +
    'details{margin:10px 0}summary{cursor:pointer}.table{overflow-x:auto}footer{margin-top:40px;border-top:1px solid #ddd;padding-top:16px;font-size:12px}' +
    '@media(max-width:600px){main{padding:24px 16px}h1{font-size:26px}}@media print{body{background:#fff}main{max-width:none;padding:0}a{text-decoration:none}details{break-inside:avoid}}' +
    '</style></head><body><main><header><p class="muted">RESEARCH DOSSIER</p><h1>' + escape(view.title) +
    '</h1><div class="prose">' + escape(view.description) + '</div><p class="muted">Revision ' + view.revision +
    ' · ' + escape(view.updatedAt) + '</p></header>' + questions + '<section><h2>Selected sources</h2>' +
    (sourceHtml || '<p>No retained sources selected for this report.</p>') + '</section>' +
    (notes ? '<section><h2>Notes attached to original edition references</h2>' + notes + '</section>' : '') +
    '<section><h2>Editions and source usage</h2><div class="table"><table><thead><tr><th>Edition</th><th>Provider</th><th>Storage</th><th>Status</th><th>Source observations</th></tr></thead><tbody>' +
    editions + '</tbody></table></div></section><section><h2>Source terms and original operations</h2>' + origins +
    '</section><footer>' + escape(view.id) + ' · Revision ' + view.revision +
    ' · Portable JSON preserves retained source bytes and the complete project history.</footer></main></body></html>\n';
}

