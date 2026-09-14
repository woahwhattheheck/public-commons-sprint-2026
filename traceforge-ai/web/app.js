'use strict';

const $ = (id) => document.getElementById(id);
const incident = $('incident');
const analyzeButton = $('analyze');

function updateCounts() {
  const text = incident.value;
  const lines = text ? text.replace(/\r\n?/g, '\n').split('\n').filter((_, i, a) => i < a.length - 1 || a[i] !== '').length : 0;
  $('lineCount').textContent = `${lines} ${lines === 1 ? 'line' : 'lines'}`;
  $('byteCount').textContent = `${new TextEncoder().encode(text).length.toLocaleString()} bytes`;
}

function escapeText(value) {
  return String(value ?? '');
}

function metric(label, value) {
  const node = document.createElement('div');
  const small = document.createElement('span');
  const strong = document.createElement('strong');
  small.textContent = label;
  strong.textContent = value;
  node.append(small, strong);
  return node;
}

function renderFinding(finding, lineMap) {
  const card = document.createElement('article');
  card.className = `finding ${finding.status === 'PASS' ? 'pass' : 'hold'}`;

  const head = document.createElement('div');
  head.className = 'finding-head';
  const titleWrap = document.createElement('div');
  const badge = document.createElement('span');
  badge.className = `verdict ${finding.status.toLowerCase()}`;
  badge.textContent = `CLAIM ${finding.status}`;
  const title = document.createElement('h3');
  title.textContent = finding.claim;
  titleWrap.append(badge, title);
  const severity = document.createElement('span');
  severity.className = 'severity';
  severity.textContent = finding.severity.toUpperCase();
  head.append(titleWrap, severity);

  const evidence = document.createElement('div');
  evidence.className = 'cited-evidence';
  for (const citationId of finding.citations) {
    const row = document.createElement('div');
    const id = document.createElement('code');
    id.textContent = citationId;
    const text = document.createElement('span');
    text.textContent = lineMap.get(citationId) || '[missing evidence]';
    row.append(id, text);
    evidence.append(row);
  }

  const foot = document.createElement('div');
  foot.className = 'finding-foot';
  const score = document.createElement('span');
  score.textContent = `Claim support ${(finding.support_score * 100).toFixed(0)}%`;
  const skeptic = document.createElement('span');
  skeptic.textContent = `Claim skeptic ${finding.skeptic.status}`;

  const actionReview = finding.action_review || {
    status: 'REVIEW_ONLY',
    reason: 'Model-suggested action is not evidence-verified or authorized; a human operator must assess it independently.',
  };
  const actionBox = document.createElement('div');
  actionBox.className = 'model-action';
  const actionState = document.createElement('strong');
  actionState.textContent = `${actionReview.status} · MODEL SUGGESTION`;
  const action = document.createElement('p');
  action.textContent = finding.action;
  const actionReason = document.createElement('small');
  actionReason.textContent = actionReview.reason;
  actionBox.append(actionState, action, actionReason);
  foot.append(score, skeptic, actionBox);

  if (finding.status === 'HOLD' && finding.verification_reason) {
    const reasons = document.createElement('ul');
    reasons.className = 'hold-reasons';
    for (const reason of finding.verification_reason.split('; ')) {
      const li = document.createElement('li');
      li.textContent = reason;
      reasons.append(li);
    }
    card.append(head, evidence, reasons, foot);
  } else {
    card.append(head, evidence, foot);
  }
  return card;
}

function showError(message) {
  $('errorBox').textContent = message;
  $('errorBox').classList.remove('hidden');
  $('emptyState').classList.add('hidden');
  $('results').classList.add('hidden');
  $('receiptState').textContent = 'Analysis rejected';
  $('receiptState').className = 'receipt-chip hold';
}

async function analyze() {
  $('errorBox').classList.add('hidden');
  analyzeButton.disabled = true;
  analyzeButton.textContent = 'Verifying evidence…';
  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({text: incident.value, mode: $('mode').value}),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || payload.error || `HTTP ${response.status}`);

    $('emptyState').classList.add('hidden');
    $('results').classList.remove('hidden');
    $('summary').textContent = escapeText(payload.summary);
    $('metrics').replaceChildren(
      metric('Evidence SHA', payload.evidence.sha256.slice(0, 12) + '…'),
      metric('Model', payload.model),
      metric('CLAIM PASS', String(payload.findings.filter((x) => x.status === 'PASS').length)),
      metric('CLAIM HOLD', String(payload.findings.filter((x) => x.status === 'HOLD').length)),
    );
    const findings = $('findings');
    const lineMap = new Map(payload.evidence.lines.map((x) => [x.id, x.text]));
    findings.replaceChildren(...payload.findings.map((x) => renderFinding(x, lineMap)));
    $('receipt').textContent = JSON.stringify(payload.receipt, null, 2);

    const verifyResponse = await fetch('/api/verify', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload),
    });
    const verified = await verifyResponse.json();
    $('receiptState').textContent = verified.valid ? 'Receipt verified' : 'Receipt invalid';
    $('receiptState').className = `receipt-chip ${verified.valid ? 'ok' : 'hold'}`;
  } catch (error) {
    showError(error.message || String(error));
  } finally {
    analyzeButton.disabled = false;
    analyzeButton.textContent = 'Analyze incident';
  }
}

$('loadDemo').addEventListener('click', async () => {
  try {
    const response = await fetch('/api/demo');
    const payload = await response.json();
    incident.value = payload.text;
    updateCounts();
  } catch (error) {
    showError(`Unable to load demo: ${error.message}`);
  }
});
incident.addEventListener('input', updateCounts);
analyzeButton.addEventListener('click', analyze);

(async function init() {
  updateCounts();
  try {
    const [config, demo] = await Promise.all([fetch('/api/config'), fetch('/api/demo')]);
    const c = await config.json();
    $('liveDot').classList.toggle('online', c.liveConfigured);
    $('configText').textContent = c.liveConfigured ? `Live AI ready · ${c.liveModel}` : 'Demo mode ready · live AI not configured';
    const d = await demo.json();
    incident.value = d.text;
    updateCounts();
  } catch (_) {
    $('configText').textContent = 'Local UI ready';
  }
})();
