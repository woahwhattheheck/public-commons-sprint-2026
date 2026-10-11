const form = document.querySelector('#audit-form');
const mode = document.querySelector('#mode');
const response = document.querySelector('#response');
const status = document.querySelector('#status-line');
const pill = document.querySelector('#mode-pill');
const caption = document.querySelector('#mode-caption');
const submit = form.querySelector('button');
const $ = id => document.getElementById(id);
let inputRevision = 0;
let requestNumber = 0;
let choiceButtons = [];
function invalidateChoices() {
  inputRevision++;
  for (const button of choiceButtons) button.disabled = true;
  if (choiceButtons.length) status.textContent = 'Inputs changed. Run the audit again to resolve the current anchor.';
}
form.addEventListener('input', invalidateChoices);
form.addEventListener('change', invalidateChoices);

const append = (parent, tag, value, cls = '') => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  el.textContent = value == null ? '' : String(value);
  parent.append(el);
  return el;
};
const clear = el => el.replaceChildren();
const percent = val => typeof val === 'number' && Number.isFinite(val) ? `${Math.round(val * 100)}%` : 'Not reported';

function setDataLabel() {
  caption.textContent = mode.value === 'demo'
    ? 'SYNTHETIC DEMO: every title and popularity number is invented. No Qloo requests or real audience inferences.'
    : 'LIVE QLOO: real /search and /v2/insights requests from the server. Server must have QLOO_API_KEY.';
}
mode.addEventListener('change', setDataLabel);

function renderMetric(name, num) {
  const card = append($('metrics'), 'div', '', 'metric');
  append(card, 'strong', num, 'num');
  append(card, 'span', name, 'name');
}
function renderSegment(title, hint, data) {
  const section = append($('segments'), 'section', '', 'segment');
  const header = append(section, 'header', '');
  append(header, 'h3', title);
  append(header, 'p', hint);
  if (data.status === 'unavailable') return append(section, 'p', 'Probe unavailable. No comparison should be inferred.', 'not-available');
  if (!data.results.length) return append(section, 'p', 'No entities returned under these filters.', 'not-available');
  const ul = append(section, 'ol', '', 'entity-list');
  data.results.slice(0, 9).forEach((item, idx) => {
    const li = append(ul, 'li', '');
    append(li, 'span', `${idx + 1}. ${item.name}`, 'entity-name');
    append(li, 'span', item.popularity === null ? 'P · N/A' : `P · ${percent(item.popularity)}`, 'entity-score');
  });
}
function setResponseState(state, stage, title) {
  response.dataset.state = state;
  $('response-stage').textContent = stage;
  $('response-title').textContent = title;
  $('segment-heading').hidden = state !== 'complete';
  $('actions-panel').hidden = state !== 'complete';
}
function render(data, params, revision) {
  response.hidden = false;
  const scrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  window.requestAnimationFrame(() => response.scrollIntoView({ behavior: scrollBehavior, block: 'start' }));
  status.classList.remove('error');
  clear($('metrics'));clear($('segments'));clear($('trace'));clear($('notes'));clear($('actions'));
  $('report-mode').textContent = data.provenance || 'UNVERIFIED';
  if (data.status === 'needs_selection') {
    setResponseState('selection', '02 / CONFIRM ANCHOR', 'Which entity did you mean?');
    status.textContent = 'CHOOSE AN ANCHOR · '+data.reason;
    $('summary').textContent = 'Select the intended Qloo entity. Equal names can identify different works or artists; the agent has not run an Insights audit yet.';
    $('evidence').textContent = data.evidence;
    (data.trace || []).forEach(row => append($('trace'), 'li', `${row.step}: ${row.detail}`));
    const choices = append($('segments'), 'section', '', 'segment selection-panel');
    append(choices, 'h3', 'Current search candidates');
    append(choices, 'p', 'Check the canonical ID against your intended anchor. If these choices do not identify it, refine your search.', 'selection-guidance');
    const list = append(choices, 'ul', '', 'entity-list candidate-list');
    for (const candidate of data.candidates || []) {
      const item = append(list, 'li', '', 'candidate-card');
      append(item, 'strong', candidate.name);
      append(item, 'p', `${candidate.type || 'Kind not reported'} · ID ${candidate.id}`, 'candidate-identity');
      if (candidate.description) append(item, 'p', candidate.description, 'candidate-description');
      const button = append(item, 'button', `Use ${candidate.name}`, 'candidate-choice');
      button.type = 'button';
      button.addEventListener('click', () => {
        if (revision !== inputRevision || submit.disabled) return;
        const chosen = new URLSearchParams(params);
        chosen.set('selectedEntityId', candidate.id);
        runAudit(chosen);
      });
      choiceButtons.push(button);
    }
    return;
  }
  if (data.status !== 'complete') {
    setResponseState('error', '02 / AUDIT ABSTAINED', 'The evidence stops here.');
    status.classList.add('error');
    status.textContent = `AUDIT ABSTAINED · ${data.reason || 'Insufficient evidence'}`;
    $('summary').textContent = 'No valid Qloo audit can be produced from the available evidence.';
    $('evidence').textContent = 'The agent refused to invent evidence.';
    (data.trace || []).forEach(row => append($('trace'), 'li', `${row.step}: ${row.detail}`));
    return;
  }
  setResponseState('complete', '02 / EVIDENCE REPORT', 'What changed when we filtered?');
  status.textContent = `SOURCE: ${data.seed.name} (${data.lookup}). ${data.segments.baseline.count} baseline results; ${data.notes.length} evidence caveat(s).`;
  renderMetric('Baseline results', data.metrics.baselineCount);
  renderMetric('Median popularity', percent(data.metrics.medianPopularity));
  renderMetric('Low popularity / returned', data.segments.low.status === 'ok' ? data.segments.low.count : '—');
  renderMetric('High popularity / returned', data.segments.high.status === 'ok' ? data.segments.high.count : '—');
  $('summary').textContent = data.summary;
  data.notes.forEach(t => append($('notes'), 'div', t, 'warning'));
  $('evidence').textContent = data.evidence;
  data.trace.forEach(row => append($('trace'), 'li', `${row.step.toUpperCase()} — ${row.detail}`));
  renderSegment('Baseline', 'No popularity filter; a Qloo entity-interest query', data.segments.baseline);
  renderSegment(`Less popular ≤ ${data.pivot.toFixed(2)}`, `${data.segments.low.newVsBaseline} newly surfaced entities vs baseline`, data.segments.low);
  renderSegment(`More popular ≥ ${data.pivot.toFixed(2)}`, `${data.segments.high.newVsBaseline} newly surfaced entities vs baseline`, data.segments.high);
  data.actions.forEach(t => append($('actions'), 'li', t));
}

async function runAudit(params) {
  const current = ++requestNumber, revision = inputRevision;
  for (const button of choiceButtons) button.disabled = true;
  choiceButtons = [];
  submit.disabled = true;
  submit.firstElementChild.textContent = 'AGENT ANALYZING…';
  response.hidden = false;
  setResponseState('pending', '02 / RESOLVING ANCHOR', 'Checking the current evidence…');
  status.classList.remove('error');
  status.textContent = 'RESOLVE → BASELINE → POPULARITY PROBES → EVIDENCE REVIEW…';
  clear($('metrics')); clear($('segments')); clear($('notes')); clear($('trace')); clear($('actions'));
  $('summary').textContent = '';
  $('report-mode').textContent = '';
  $('evidence').textContent = '';
  try {
    const res = await fetch(`/api/audit?${params.toString()}`, { headers: { Accept: 'application/json' } });
    const data = await res.json();
    if (current !== requestNumber) return;
    if (revision !== inputRevision) {
      setResponseState('error', '02 / INPUTS CHANGED', 'Run the audit with your current inputs.');
      status.textContent = 'Inputs changed while resolving the anchor. Run the audit again.';
      $('report-mode').textContent = 'PREVIOUS INPUT RESPONSE DISCARDED';
      $('evidence').textContent = 'No selection or result was applied to the edited inputs.';
      return;
    }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    render(data, params, revision);
  } catch (err) {
    if (current !== requestNumber) return;
    setResponseState('error', '02 / AUDIT NOT COMPLETED', 'No verified report is available.');
    status.classList.add('error');
    status.textContent = `AUDIT NOT COMPLETED · ${String(err.message || err)}`;
    $('report-mode').textContent = 'NO VERIFIED REPORT';
    $('evidence').textContent = 'No result was inferred from a failed upstream request.';
  } finally {
    if (current === requestNumber) {
      submit.disabled = false;
      submit.firstElementChild.textContent = 'RUN SIGNAL AUDIT';
    }
  }
}
form.addEventListener('submit', event => {
  event.preventDefault();
  runAudit(new URLSearchParams(new FormData(form)));
});
fetch('/api/status').then(r => r.json()).then(s => {
  pill.textContent = s.liveConfigured ? 'LIVE API READY' : 'SYNTHETIC MODE READY';
  setDataLabel();
}).catch(() => { pill.textContent = 'SERVER UNREACHABLE'; });
