// SPDX-License-Identifier: MIT
// Organizer annotations remain separate from the original ranked observation.
const $ = id => document.getElementById(id);
const labels = { undecided: 'Undecided', priority: 'Priority', deferred: 'Defer' };
let session = null, busy = false;

function node(tag, text, className) {
  const value = document.createElement(tag);
  if (text !== undefined) value.textContent = String(text);
  if (className) value.className = className;
  return value;
}
function brief() {
  return {
    location: $('location').value.trim(),
    seeds: $('seeds').value.split(',').map(s => s.trim()).filter(Boolean),
    slots: Number($('slots').value), mode: $('mode').value, source: $('source').value,
    ...($('categoryCap').value ? { categoryCap: Number($('categoryCap').value) } : {}),
    exclusions: $('exclusions').value.split(',').map(s => s.trim()).filter(Boolean)
  };
}
function isCurrent() { return session !== null && JSON.stringify(brief()) === session.briefKey; }
function annotations() { return session ? [...session.decisions.values()] : []; }
function updateControls() {
  const current = isCurrent();
  $('briefFields').disabled = busy;
  $('submit').disabled = busy;
  $('reviewPanel').hidden = !session;
  $('reviewFilter').disabled = busy || !session;
  $('exportJson').disabled = busy || !current;
  $('exportCsv').disabled = busy || !current;
  $('restoreBrief').disabled = busy || !session || current;
  $('planStatus').classList.toggle('stale', Boolean(session && !current));
  for (const input of $('result').querySelectorAll('select, textarea')) input.disabled = busy || !current;
  $('result').dataset.state = busy ? 'pending' : session ? current ? 'current' : 'stale' : 'empty';
  if (!session) return;
  const counts = annotations().reduce((all, row) => { all[row.decision]++; return all; },
    { undecided: 0, priority: 0, deferred: 0 });
  $('reviewSummary').textContent = `${counts.priority} priority · ${counts.undecided} undecided · ${counts.deferred} deferred. Organizer choices do not change the recommended mix.`;
  $('planStatus').textContent = busy ? 'Designing a new lineup. The previous review is locked while the request is pending.'
    : current ? `Reviewing the plan generated ${session.plan.generatedAt}. Notes and choices are kept in this tab until you design another lineup or reload.`
      : 'Brief changed. The displayed plan and notes belong to the saved brief. Restore it to continue reviewing or download, or design a new lineup.';
}
function applyFilter() {
  const filter = $('reviewFilter').value;
  let shown = 0, hiddenFocus = false;
  for (const card of $('result').querySelectorAll('.candidate-card')) {
    const selected = filter === 'all' || card.dataset.review === filter;
    if (!selected && card.contains(document.activeElement)) hiddenFocus = true;
    card.hidden = !selected;
    if (selected) shown++;
  }
  if (hiddenFocus) $('reviewFilter').focus();
  $('reviewStatus').textContent = session ? `${shown} of ${session.decisions.size} candidate rows shown. No contacts or bookings have been made by this app.` : '';
}
function candidateCard(candidate, group, index) {
  // Group and position bind decisions to the exact returned row, even if aliases share an ID.
  const key = `${group}:${index}`;
  const record = { group, index, id: candidate.id, decision: 'undecided', note: '' };
  session.decisions.set(key, record);
  const card = node('article', undefined, 'candidate-card');
  card.dataset.review = record.decision;
  const top = node('div', undefined, 'candidate-top');
  top.append(node('h4', candidate.name), node('span', candidate.category, 'candidate-category'));
  card.append(top,
    node('p', `${group === 'selected' ? 'Recommended' : 'Alternative'} · source ID ${candidate.id} · original result position ${candidate.ordinal}`, 'candidate-meta'),
    node('p', candidate.explanation || candidate.evidence, 'candidate-evidence'),
    node('p', `Signal kind: ${candidate.signalKind}. Planner input: ${candidate.signal}. These are retained source values, not booking confidence.`, 'candidate-meta'));
  const controls = node('div', undefined, 'review-controls');
  const decisionLabel = node('label', 'Organizer decision');
  const decision = node('select');
  decision.id = 'decision-' + group + '-' + index;
  decision.setAttribute('aria-label', 'Organizer decision for ' + candidate.name);
  for (const [value, text] of Object.entries(labels)) {
    const option = node('option', text); option.value = value; decision.append(option);
  }
  decisionLabel.append(decision);
  const noteLabel = node('label', 'Organizer note');
  const note = node('textarea');
  note.id = 'note-' + group + '-' + index; note.maxLength = 1000; note.rows = 3;
  note.placeholder = 'Questions or next steps to discuss independently (up to 1,000 characters).';
  note.setAttribute('aria-label', 'Organizer note for ' + candidate.name);
  noteLabel.append(note);
  decision.addEventListener('change', () => {
    if (busy || !isCurrent()) return;
    record.decision = decision.value; card.dataset.review = decision.value;
    updateControls(); applyFilter();
  });
  note.addEventListener('input', () => {
    if (busy || !isCurrent()) return;
    record.note = note.value.slice(0, 1000);
  });
  controls.append(decisionLabel, noteLabel); card.append(controls);
  return card;
}
function show(plan, request) {
  session = { plan, brief: request, briefKey: JSON.stringify(request), decisions: new Map() };
  $('reviewFilter').value = 'all';
  const result = $('result'); result.replaceChildren();
  result.append(node('p', plan.source, 'status'),
    node('p', `${plan.location} · seeds: ${plan.seeds.join(', ')} · generated ${plan.generatedAt}`, 'source-brief'));
  const metrics = node('div', undefined, 'metrics');
  for (const [title, value] of [['Vendor slots', `${plan.summary.filled} / ${plan.summary.requested}`],
    ['Observed categories', plan.summary.observedCategories], ['Candidates analyzed', plan.summary.analyzed]]) {
    const metric = node('div', undefined, 'metric');
    metric.append(node('strong', value), node('span', title)); metrics.append(metric);
  }
  result.append(metrics);
  for (const [group, title] of [['selected', 'Recommended mix'], ['alternatives', 'Alternatives kept in view']]) {
    const section = node('section', undefined, 'candidate-section'); section.append(node('h3', title));
    const cards = node('div', undefined, 'cards');
    plan[group].forEach((candidate, index) => cards.append(candidateCard(candidate, group, index)));
    if (!plan[group].length) cards.append(node('p', 'No candidates in this group.', 'empty-note'));
    section.append(cards); result.append(section);
  }
  if (plan.summary.categoryCap !== null) result.append(node('p', `Hard limit: ${plan.summary.categoryCap} per observed category.`, 'notice'));
  if (plan.summary.shortfallNote) result.append(node('p', plan.summary.shortfallNote, 'notice'));
  result.append(node('p', plan.summary.warning, 'notice'));
  const steps = node('section', undefined, 'alternates');
  steps.append(node('h3', 'Human verification before booking'));
  const list = node('ul'); plan.nextSteps.forEach(text => list.append(node('li', text)));
  steps.append(list); result.append(steps);
  updateControls(); applyFilter();
}
function download(text, extension, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = node('a'); link.href = url;
  link.download = 'vendormix-review-' + session.plan.generatedAt.replace(/[^0-9T]/g, '-') + '.' + extension;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $('reviewStatus').textContent = `Downloaded ${extension.toUpperCase()} for all ${session.decisions.size} candidate rows, including hidden rows. Source observations and organizer decisions stay separate; nothing was sent to a vendor.`;
}
function csvCell(value) {
  let text = String(value ?? '');
  // Quote every field and neutralize spreadsheet formulas, including leading whitespace.
  if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
$('exportJson').addEventListener('click', () => {
  if (busy || !isCurrent()) return;
  download(JSON.stringify({ schema: 'vendormix-organizer-review/v1', exportedAt: new Date().toISOString(),
    brief: session.brief, originalPlan: session.plan, organizerReview: annotations(),
    scope: 'Local planning notes only. No contact, booking, availability or consent is established.' }, null, 2) + '\n',
    'json', 'application/json');
});
$('exportCsv').addEventListener('click', () => {
  if (busy || !isCurrent()) return;
  const plan = session.plan;
  const rows = [['source', 'generated_at', 'location', 'seeds', 'brief_json', 'group', 'group_position',
    'source_id', 'name', 'observed_category', 'source_position', 'signal_kind', 'planner_signal',
    'source_evidence', 'ranking_rationale', 'organizer_decision', 'organizer_note', 'limitations']];
  for (const record of annotations()) {
    const c = plan[record.group][record.index];
    rows.push([plan.source, plan.generatedAt, plan.location, plan.seeds.join(' | '), JSON.stringify(session.brief),
      record.group, record.index + 1, c.id, c.name, c.category, c.ordinal, c.signalKind, c.signal,
      c.evidence, c.explanation || '', record.decision, record.note, plan.summary.warning]);
  }
  download('\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n', 'csv', 'text/csv;charset=utf-8');
});
$('reviewFilter').addEventListener('change', applyFilter);
$('restoreBrief').addEventListener('click', () => {
  if (busy || !session) return;
  const saved = session.brief;
  for (const name of ['location', 'slots', 'mode', 'source']) $(name).value = String(saved[name]);
  $('seeds').value = saved.seeds.join(', '); $('exclusions').value = saved.exclusions.join(', ');
  $('categoryCap').value = saved.categoryCap === undefined ? '' : String(saved.categoryCap);
  updateControls(); $('reviewStatus').textContent = 'Saved brief restored locally. Existing organizer notes are available; no new plan or provider request was made.';
});
$('form').addEventListener('input', updateControls);
$('form').addEventListener('change', updateControls);
$('form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  const request = brief(); busy = true; $('error').textContent = ''; updateControls();
  if (!session) $('planStatus').textContent = 'Designing the requested lineup…';
  try {
    const response = await fetch('/api/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
    const plan = await response.json();
    if (!response.ok) throw new Error(plan.error || 'Planning failed');
    show(plan, request);
  } catch (error) {
    $('error').textContent = (error.message || 'Planning failed') + ' No automatic retry was made.';
    if (!session) $('planStatus').textContent = 'No lineup was returned. Review the error before trying again.';
  } finally { busy = false; updateControls(); }
});
updateControls();
