'use strict';

const $ = (id) => document.getElementById(id);
const incident = $('incident');
const analyzeButton = $('analyze');
// Matches the native receipt_io.MAX_RECEIPT_BYTES ceiling.
const MAX_PACKET_BYTES = 2_496_000;
let savedPacket = null;
let busy = false;
let editorGeneration = 0;

function setBusy(value) {
  busy = value;
  for (const id of ['analyze', 'loadDemo', 'openPacket', 'packetFile', 'mode', 'incident']) {
    $(id).disabled = value;
  }
  $('savePacket').disabled = value || !savedPacket;
}

function canonicalEvidence(value) {
  const lines = value.replace(/\r\n?/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n') + '\n';
}

function updatePacketStatus() {
  if (!savedPacket) return;
  const same = canonicalEvidence(incident.value) === savedPacket.evidenceText;
  $('packetStatus').textContent = `Saved analysis ${savedPacket.payload.receipt.run_id}. ` +
    (same ? 'The editor matches its evidence.' : 'The editor has different evidence; download still saves the displayed analysis.');
}

async function verifyPacket(raw) {
  if (new TextEncoder().encode(raw).length > MAX_PACKET_BYTES) {
    throw new Error('Analysis packet exceeds the supported file size.');
  }
  // Send original text before JSON.parse so duplicate keys reach the strict native parser.
  const response = await fetch('/api/verify', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: raw,
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok || result.valid !== true) {
    throw new Error(result.detail || result.error || 'Packet integrity invalid; current work was kept.');
  }
  const payload = JSON.parse(raw);
  return {raw, payload, evidenceText: payload.evidence.lines.map((line) => line.text).join('\n') + '\n'};
}

function updateCounts() {
  const text = incident.value;
  const lines = text ? text.replace(/\r\n?/g, '\n').split('\n').filter((_, i, a) => i < a.length - 1 || a[i] !== '').length : 0;
  $('lineCount').textContent = `${lines} ${lines === 1 ? 'line' : 'lines'}`;
  $('byteCount').textContent = `${new TextEncoder().encode(text).length.toLocaleString()} bytes`;
  updatePacketStatus();
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
  if (!savedPacket) {
    $('receiptState').textContent = 'No verified packet';
    $('receiptState').className = 'receipt-chip hold';
  }
}

function renderPacket(packet) {
  const payload = packet.payload;
  $('emptyState').classList.add('hidden');
  $('results').classList.remove('hidden');
  $('summaryState').textContent = `${payload.summary_review.status} · MODEL SUMMARY`;
  $('summary').textContent = escapeText(payload.summary);
  $('summaryReason').textContent = payload.summary_review.reason;
  $('metrics').replaceChildren(
    metric('Evidence SHA', payload.evidence.sha256.slice(0, 12) + '…'),
    metric('Model', payload.model),
    metric('CLAIM PASS', String(payload.findings.filter((x) => x.status === 'PASS').length)),
    metric('CLAIM HOLD', String(payload.findings.filter((x) => x.status === 'HOLD').length)),
  );
  const lineMap = new Map(payload.evidence.lines.map((x) => [x.id, x.text]));
  $('findings').replaceChildren(...payload.findings.map((x) => renderFinding(x, lineMap)));
  $('receipt').textContent = JSON.stringify(payload.receipt, null, 2);
  $('receiptState').textContent = 'Packet integrity verified · model summary/actions remain review-only';
  $('receiptState').className = 'receipt-chip ok';
  savedPacket = packet;
  updatePacketStatus();
}

async function analyze() {
  if (busy) return;
  const request = {text: incident.value, mode: $('mode').value};
  editorGeneration += 1;
  $('errorBox').classList.add('hidden');
  setBusy(true);
  analyzeButton.textContent = 'Verifying evidence…';
  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(request),
    });
    const raw = await response.text();
    if (!response.ok) {
      const error = JSON.parse(raw);
      throw new Error(error.detail || error.error || `HTTP ${response.status}`);
    }
    renderPacket(await verifyPacket(raw));
  } catch (error) {
    showError(error.message || String(error));
  } finally {
    setBusy(false);
    analyzeButton.textContent = 'Analyze incident';
  }
}

$('openPacket').addEventListener('click', () => {
  if (!busy) $('packetFile').click();
});
$('packetFile').addEventListener('change', async () => {
  const file = $('packetFile').files[0];
  $('packetFile').value = '';
  if (!file || busy) return;
  editorGeneration += 1;
  $('errorBox').classList.add('hidden');
  setBusy(true);
  try {
    if (file.size > MAX_PACKET_BYTES) throw new Error('Analysis packet exceeds the supported file size.');
    const raw = new TextDecoder('utf-8', {fatal: true}).decode(await file.arrayBuffer());
    const candidate = await verifyPacket(raw);
    if ((savedPacket || incident.value.trim()) && !window.confirm('Replace the displayed analysis and incident editor with this verified packet? Download current analysis first if you need to keep it.')) return;
    incident.value = candidate.evidenceText;
    renderPacket(candidate);
    updateCounts();
  } catch (error) {
    showError(`Unable to open packet: ${error.message || String(error)}`);
  } finally {
    setBusy(false);
  }
});
$('savePacket').addEventListener('click', () => {
  if (busy || !savedPacket) return;
  const url = URL.createObjectURL(new Blob([savedPacket.raw], {type: 'application/json;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = `traceforge-${savedPacket.payload.receipt.run_id}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$('loadDemo').addEventListener('click', async () => {
  if (busy) return;
  editorGeneration += 1;
  setBusy(true);
  try {
    const response = await fetch('/api/demo');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    incident.value = payload.text;
    updateCounts();
  } catch (error) {
    showError(`Unable to load demo: ${error.message}`);
  } finally {
    setBusy(false);
  }
});
incident.addEventListener('input', () => { editorGeneration += 1; updateCounts(); });
analyzeButton.addEventListener('click', analyze);

(async function init() {
  updateCounts();
  try {
    const [config, demo] = await Promise.all([fetch('/api/config'), fetch('/api/demo')]);
    const c = await config.json();
    const liveOption = $('mode').querySelector('option[value="live"]');
    if (liveOption) liveOption.disabled = !c.liveConfigured;
    if (!c.liveConfigured && $('mode').value === 'live') $('mode').value = 'demo';
    $('liveDot').classList.toggle('online', c.liveConfigured);
    if (c.liveConfigured) {
      $('configText').textContent = `Public live AI enabled · ${c.liveModel}`;
    } else if (c.providerConfigured) {
      $('configText').textContent = 'Demo mode ready · provider configured, public live opt-in off';
    } else {
      $('configText').textContent = 'Demo mode ready · live AI not configured';
    }
    const d = await demo.json();
    if (editorGeneration === 0 && !incident.value) {
      incident.value = d.text;
      updateCounts();
    }
  } catch (_) {
    $('configText').textContent = 'Local UI ready';
  }
})();

