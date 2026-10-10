const byId = id => document.getElementById(id);
const put = (id, value) => { byId(id).textContent = String(value ?? '—'); };
const state = (id, ok, text) => {
  const el = byId(id);
  el.textContent = text;
  el.classList.toggle('good', ok);
  el.classList.toggle('bad', !ok);
};
try {
  const response = await fetch('/api/report', { cache: 'no-store', redirect: 'error' });
  if (!response.ok) throw new Error('Local report HTTP ' + response.status);
  const r = await response.json();
  if (r.schema !== 'stellar-forge.sf53.local-proof.v1') throw new Error('Unexpected local proof schema');
  put('observed', 'Observed ' + r.observedAt);
  state('smoke-status', r.commerce.status === 'PASS_LOCAL_SOURCE_SMOKE', r.commerce.status);
  state('release-status', r.release.status === 'PASS_SOURCE_CONTRACTS_ONLY', r.release.status);
  put('signed', r.commerce.signedRequests);
  put('payments', r.commerce.paidCalls);
  put('discovered', r.commerce.discovered);
  put('seller402', r.commerce.seller402);
  put('replay', r.commerce.cancelledReplay ? 'Yes' : 'Not proved');
  put('testnet', r.commerce.testnetTransactions);
  put('matching', r.release.matchingPins);
  put('changed', r.release.changedPins);
  put('missing', r.release.missingOrUnreadable);
  put('source-note', String(r.release.warnings?.length ?? 0) + ' source revision warning(s); ' + String(r.release.failures?.length ?? 0) + ' preflight error(s). Strict pin approval is a separate release act.');
  const tbody = byId('sources');
  tbody.replaceChildren();
  for (const item of r.release.sources ?? []) {
    const row = document.createElement('tr');
    for (const value of [item.id, item.status, item.actualGitBlob ?? 'Not observed']) {
      const cell = document.createElement('td'); cell.textContent = value; row.appendChild(cell);
    }
    tbody.appendChild(row);
  }
  const issues = [r.commerce.detail, r.release.detail, ...(r.release.failures ?? [])].filter(Boolean);
  if (issues.length) put('errors', 'Source check needs attention: ' + issues.join(' · '));
} catch (error) {
  state('smoke-status', false, 'REPORT UNAVAILABLE');
  state('release-status', false, 'NOT CHECKED');
  put('errors', String(error?.message ?? error));
}
