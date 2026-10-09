const byId = id => document.getElementById(id);
let lastEvidence = null;
async function init() {
  const response = await fetch('/api/info', { cache: 'no-store' });
  if (!response.ok) throw new Error('Local server unavailable');
  const info = await response.json();
  const demo = info.mode === 'SYNTHETIC_DEMO';
  byId('mode').textContent = demo ? 'SYNTHETIC DEMO · NO NETWORK' : `LIVE READ-ONLY · ${info.providerCount} RPC`;
  byId('mode').classList.toggle('live', !demo);
  byId('demo-controls').hidden = !demo;
  if (demo) byId('signature').value = info.signature;
  byId('form').addEventListener('submit', event => { event.preventDefault(); void inspect(demo); });
  byId('download').addEventListener('click', () => {
    if (!lastEvidence) return;
    const blob = new Blob([JSON.stringify(lastEvidence, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'finalitylens-evidence.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
  });
}
function cell(row, value, className = '') { const td = document.createElement('td'); td.textContent = value; td.className = className; row.append(td); }
async function inspect(demo) {
  const button = byId('check'); const error = byId('error');
  error.hidden = true; button.disabled = true; button.textContent = 'Checking…';
  try {
    const params = new URLSearchParams({ signature: byId('signature').value.trim() });
    if (demo) params.set('scenario', byId('scenario').value);
    const response = await fetch('/api/check?' + params.toString(), { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Request failed');
    lastEvidence = result;
    byId('result').hidden = false;
    byId('observed').textContent = result.observedAt + (demo ? ' · SYNTHETIC' : ' · LIVE');
    byId('verdict').textContent = result.assessment.verdict.replaceAll('_', ' ');
    byId('verdict').className = 'verdict ' + (result.assessment.verdict === 'AGREED_FINALIZED' ? 'good' : result.assessment.verdict === 'CONFLICT' ? 'bad' : '');
    byId('reason').textContent = result.assessment.reason;
    byId('caveat').textContent = result.caveat;
    const rows = byId('rows'); rows.replaceChildren();
    for (const provider of result.providers) {
      const tr = document.createElement('tr');
      cell(tr, provider.label); cell(tr, provider.verdict.replaceAll('_', ' '), provider.verdict === 'VERIFIED' ? 'status' : 'status bad');
      cell(tr, provider.slot == null ? '—' : String(provider.slot));
      cell(tr, provider.blockhash ? provider.blockhash.slice(0, 14) + '…' : '—');
      tr.title = provider.detail;
      rows.append(tr);
    }
    byId('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) { error.textContent = err.message || 'Unable to check evidence'; error.hidden = false; }
  finally { button.disabled = false; button.textContent = 'Check evidence ↗'; }
}
init().catch(err => { byId('error').textContent = err.message; byId('error').hidden = false; });
