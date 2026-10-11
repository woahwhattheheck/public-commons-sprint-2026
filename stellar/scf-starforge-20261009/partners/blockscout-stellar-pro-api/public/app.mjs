// MIT. Local provider desk; all payment controls link to the original merchant.
const $ = id => document.getElementById(id);
const json = value => JSON.stringify(value, null, 2) + '\n';
let token = location.hash.slice(1);
if (/^[a-f0-9]{64}$/.test(token)) sessionStorage.setItem('blockscout-operator-token', token);
else token = sessionStorage.getItem('blockscout-operator-token') ?? '';
history.replaceState(null, '', location.pathname);
let status, prepared, selected, backup, nextAfter = null, filter = {}, loading = false;
let formRevision = 0, selectionEpoch = 0, historyEpoch = 0;
const names = { BLOCKSCOUT_LOCAL_DAILY_BUDGET: 'Local daily budget reached', BLOCKSCOUT_LOCAL_RATE_LIMIT: 'Local rate limit active',
  BLOCKSCOUT_PROVIDER_CREDITS_LOW: 'Recent provider balance is below the configured floor', BLOCKSCOUT_PROVIDER_RATE_LIMIT: 'Provider rate window is exhausted',
  BLOCKSCOUT_RETAINED_CAPACITY_FULL: 'Retained storage limit reached', BLOCKSCOUT_PROVIDER_IN_FLIGHT_LIMIT: 'Provider request capacity is in use' };
function message(text = '') { $('message').textContent = text; }
async function request(path, value, binary = false) {
  const response = await fetch(path, { method: value === undefined ? 'GET' : 'POST', redirect: 'error', credentials: 'omit',
    headers: { 'x-blockscout-operator-token': token, ...(value === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw Error(data.error === 'BLOCKSCOUT_OPERATOR_TOKEN_REQUIRED' ? 'Open the current private provider-desk URL printed by the merchant launcher.' :
      names[data.error] ?? data.error ?? 'Request failed (' + response.status + ')');
  }
  return binary ? response : response.json();
}
async function action(button, fn) {
  button.disabled = true; message();
  try { await fn(); } catch (e) { message(e.message); } finally { button.disabled = false; }
}
function download(bytes, filename, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement('a'); link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function cell(tr, text, small) {
  const td = document.createElement('td'); td.textContent = text;
  if (small !== undefined) { const detail = document.createElement('small'); detail.textContent = small; td.append(detail); }
  tr.append(td); return td;
}
function number(value) { return value === null || value === undefined ? 'Unknown' : value.toLocaleString(); }
function showStatus(value) {
  status = value; const p = value.provider, l = p.limits, q = p.providerQuota;
  $('identity').textContent = p.accountAlias + ' · ' + (value.source === 'blockscout-pro' ? 'Blockscout PRO' : 'Loopback contract fixture') + ' · ' + value.paymentNetwork + ' payments';
  $('admission').textContent = p.admission.allowed ? 'Available for a selected read' : names[p.admission.code] ?? p.admission.code;
  $('local-usage').textContent = number(p.localUsage.attempts) + ' / ' + number(l.dayAttempts) + ' attempts';
  $('local-detail').textContent = p.day + ' UTC · ' + number(p.localUsage.configuredCredits) + ' / ' + number(l.dayCredits) +
    ' configured credits · ' + number(l.creditsPerAttempt) + ' per attempt';
  $('provider-credits').textContent = q ? number(q.creditsRemaining) + ' credits remaining' : 'No provider observation';
  $('provider-rate').textContent = q ? number(q.rateRemaining) + ' / ' + number(q.rateLimit) + ' rate-window requests · reported reset ' + number(q.resetMs) + ' ms' : 'A provider response supplies the account headers.';
  $('provider-age').textContent = q ? q.observedAt + ' · ' + (q.fresh ? 'Within the configured observation window' : 'Observation is older than the configured window') : '';
  if (p.quotaEstimates?.credits) $('provider-age').textContent += ' · local conservative availability ' + number(p.quotaEstimates.credits.available) + ' credits after ' + number(p.quotaEstimates.credits.reserved) + ' reserved credits';
  $('retention').textContent = number(p.retention.records) + ' attempts';
  $('retention-detail').textContent = number(p.retention.bodyBytes) + ' / ' + number(l.maxStoredBodyBytes) + ' response bytes · ' +
    number(p.retention.inProgress) + ' in progress · ' + number(p.states.outcome_unknown ?? 0) + ' interrupted outcomes';
  $('payment').textContent = 'Payment asset and recipient come from the original offer. Chain IDs in these routes identify EVM data.';
  $('footer').textContent = value.contract + ' · plan SHA-256 ' + p.planSha256 + ' · updated ' + p.capturedAt;
  if (!$('chain').options.length) {
    for (const chain of value.chains) {
      for (const id of ['chain', 'filter-chain']) { const option = document.createElement('option'); option.value = chain.chainId;
        option.textContent = chain.name + ' (' + chain.chainId + ')'; $(id).append(option); }
      const tr = document.createElement('tr'); cell(tr, chain.name, chain.dataNetwork);
      cell(tr, '/' + chain.chainId + '/api/v2/tokens/{address_hash}'); cell(tr, chain.amountAtomic + ' atomic units', value.paymentNetwork);
      $('routes').append(tr);
    }
  }
}
async function refresh() {
  if (loading) return; loading = true;
  try { showStatus(await request('/api/status')); } finally { loading = false; }
}
async function select(id) {
  const epoch = ++selectionEpoch, value = await request('/api/attempts/' + id);
  if (epoch !== selectionEpoch) return;
  selected = value;
  $('selected').hidden = false; $('response-json').hidden = true;
  $('selection-summary').textContent = '#' + selected.sequence + ' · ' + selected.state + ' · eip155:' + selected.chainId + ' · ' + selected.addressHash;
  $('selection-json').textContent = json(selected);
  $('download-response').disabled = !selected.response?.retained; $('show-response').disabled = !selected.response?.retained;
}
async function loadHistory(reset = false) {
  if (reset) { historyEpoch++; selectionEpoch++; $('attempts').replaceChildren(); nextAfter = 0; selected = null; $('selected').hidden = true; }
  const epoch = historyEpoch;
  const query = new URLSearchParams({ after: String(nextAfter ?? 0), limit: '50', ...filter });
  const page = await request('/api/attempts?' + query);
  if (epoch !== historyEpoch) return;
  $('history-total').textContent = number(page.total) + ' matching attempts';
  for (const row of page.rows) {
    const tr = document.createElement('tr'), td = cell(tr, '', row.startedAt);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'row-button'; button.textContent = '#' + row.sequence;
    button.addEventListener('click', () => action(button, () => select(row.id))); td.prepend(button);
    cell(tr, 'eip155:' + row.chainId, row.addressHash);
    cell(tr, row.state, 'HTTP ' + (row.upstreamStatus ?? 'unknown') + (row.error ? ' · ' + row.error : ''));
    cell(tr, String(row.localCredits)); cell(tr, row.response ? number(row.response.bytes) + ' bytes' : 'No retained body', row.purpose);
    $('attempts').append(tr);
  }
  nextAfter = page.nextAfter; $('more').hidden = nextAfter === null;
}
function selection() { return { chainId: $('chain').value, addressHash: $('address').value.trim() }; }
$('token-form').addEventListener('input', () => { formRevision++; prepared = null; $('prepared').hidden = true; });
$('token-form').addEventListener('change', () => { formRevision++; prepared = null; $('prepared').hidden = true; });
$('token-form').addEventListener('submit', event => { event.preventDefault();
  action(event.submitter, async () => {
    const revision = formRevision;
    const value = await request('/api/buyer', { ...selection(), intentId: $('intent').value.trim(), responseOut: $('response-out').value.trim() });
    if (revision !== formRevision) return;
    prepared = value;
    $('prepared').hidden = false; $('prepared-summary').textContent = prepared.token.url + ' · config SHA-256 ' + prepared.configSha256;
    $('review-json').textContent = json(prepared.config); message('The original SF88 review config is ready.');
  });
});
$('download-review').addEventListener('click', () => { if (prepared) download(json(prepared.config), 'blockscout-buyer-review.json'); });
$('diagnose').addEventListener('click', () => action($('diagnose'), async () => {
  const result = await request('/api/diagnose', selection());
  await refresh(); await loadHistory(true); if (result.observation) await select(result.observation.id);
  message(result.status === 200 ? 'Provider response retained. Inspect its exact bytes and quota observation below.' : names[result.error] ?? result.error ?? 'Provider read returned HTTP ' + result.status);
}));
$('filter-form').addEventListener('submit', event => { event.preventDefault(); action(event.submitter, async () => {
  filter = {}; if ($('filter-chain').value) filter.chainId = $('filter-chain').value;
  if ($('filter-address').value.trim()) filter.addressHash = $('filter-address').value.trim();
  await loadHistory(true);
}); });
$('more').addEventListener('click', () => action($('more'), () => loadHistory()));
$('refresh').addEventListener('click', () => action($('refresh'), async () => { await refresh(); await loadHistory(true); }));
$('download-response').addEventListener('click', () => action($('download-response'), async () => {
  const record = selected; if (!record) return;
  const response = await request('/api/attempts/' + record.id + '/response', undefined, true);
  if (response.headers.get('x-content-sha256') !== record.response.sha256) throw Error('Response identity changed.');
  download(await response.arrayBuffer(), 'blockscout-' + record.id + '.json');
}));
$('show-response').addEventListener('click', () => action($('show-response'), async () => {
  const record = selected, epoch = selectionEpoch; if (!record) return;
  const response = await request('/api/attempts/' + record.id + '/response', undefined, true);
  if (response.headers.get('x-content-sha256') !== record.response.sha256) throw Error('Response identity changed.');
  const text = await response.text(); if (epoch !== selectionEpoch) return;
  $('response-json').textContent = text; $('response-json').hidden = false;
}));
$('backup').addEventListener('click', () => action($('backup'), async () => {
  backup = await request('/api/backup', {}); $('backup-result').hidden = false;
  $('backup-summary').textContent = number(backup.bytes) + ' bytes · SHA-256 ' + backup.sha256;
  $('backup-json').textContent = json(backup); $('download-backup').disabled = backup.bytes > 67108864;
  message(backup.bytes > 67108864 ? 'The complete backup is retained at the displayed private path. Use the CLI to stream this larger database.' : 'The complete provider backup is ready.');
}));
$('download-backup').addEventListener('click', () => action($('download-backup'), async () => {
  const record = backup; if (!record) return;
  const response = await request(record.download, undefined, true);
  if (response.headers.get('x-content-sha256') !== record.sha256) throw Error('Backup identity changed.');
  download(await response.arrayBuffer(), 'blockscout-provider-' + record.id + '.sqlite', 'application/vnd.sqlite3');
}));
try {
  if (!/^[a-f0-9]{64}$/.test(token)) throw Error('Open the private provider-desk URL printed by the merchant launcher.');
  await refresh(); const links = await request('/api/navigation');
  for (const id of ['operations', 'availability', 'fulfillment']) if (links[id]) $(id).href = links[id];
  await loadHistory(true);
} catch (e) { message(e.message); }
