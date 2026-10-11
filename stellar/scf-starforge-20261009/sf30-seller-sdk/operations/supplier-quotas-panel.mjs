// MIT. Explicit local snapshots; downloads preserve the displayed snapshot.
import { supplierQuotaState, supplierQuotasCsv } from '/supplier-quotas.mjs';

const $ = id => document.getElementById(id);
const counts = new Intl.NumberFormat('en-US');
const count = value => Number.isFinite(value) ? counts.format(value) : '—';
let snapshot = null, selected = null, request = null, downloads = [];
const timestamp = value => {
  if (value === null || value === undefined || value === 0) return '—';
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? date.toISOString().replace('T', ' ').replace('.000Z', ' UTC') : '—';
};
function text(tag, value, className) {
  const node = document.createElement(tag);
  node.textContent = String(value);
  if (className) node.className = className;
  return node;
}
function releaseDownloads() {
  for (const url of downloads) URL.revokeObjectURL(url);
  downloads = [];
}
function attachDownload(id, content, type, filename) {
  const link = $(id), url = URL.createObjectURL(new Blob([content], { type }));
  downloads.push(url);
  link.href = url;
  link.download = filename;
  link.removeAttribute('aria-disabled');
  link.removeAttribute('tabindex');
}
function updateDownloads() {
  releaseDownloads();
  const stamp = snapshot.capturedAt.replaceAll(':', '-');
  attachDownload('download-json', JSON.stringify(snapshot, null, 2) + '\n',
    'application/json;charset=utf-8', 'supplier-accounts-' + stamp + '.json');
  attachDownload('download-csv', supplierQuotasCsv(snapshot),
    'text/csv;charset=utf-8', 'supplier-accounts-' + stamp + '.csv');
}
function detailField(label, value) {
  const entry = document.createElement('div');
  entry.append(text('dt', label), text('dd', value));
  return entry;
}
function renderDetail() {
  const account = snapshot?.accounts.find(item => item.name === selected);
  $('detail').hidden = !account;
  if (!account) return;
  const quota = account.quota, state = supplierQuotaState(account, snapshot.capturedAt);
  $('detail-title').textContent = account.name;
  $('detail-state').textContent = state + ' · Snapshot ' + timestamp(snapshot.capturedAt);
  const entries = [
    ['Supplier account label', quota?.account ?? '—'],
    ['Calls in rolling window', count(quota?.callsInWindow)],
    ['Calls remaining', count(quota?.remainingCalls)],
    ['Window allowance', quota ? count(quota.policy.callsPerDay) + ' calls / 24 hours' : '—'],
    ['Rate allowance', quota ? count(quota.policy.requestsPerSecond) + ' calls / second' : '—'],
    ['Original dispatch reservations', count(quota?.totalDispatched)],
    ['Last dispatch, UTC', timestamp(quota?.lastDispatchAt)],
    ['Provider cooldown until, UTC', timestamp(quota?.providerCooldownUntil)],
    ['Retry at, UTC', timestamp(quota?.retryAt)],
    ['Retry delay at snapshot', quota ? count(quota.retryAfterSeconds) + ' seconds' : '—'],
    ['State revision', count(quota?.revision)],
    ['Window accounting', quota ? count(quota.windowSeconds / 3600) + ' hours · ' + count(quota.bucketSeconds) + '-second buckets' : '—'],
  ];
  if (account.errorCode) entries.push(['Account state', account.errorCode]);
  $('detail-fields').replaceChildren(...entries.map(([label, value]) => detailField(label, value)));
  $('detail-bindings').replaceChildren(...(account.bindings.length ? account.bindings : ['No routes attached']).map(binding => text('li', binding)));
  const guidance = {
    'Unavailable': 'Review this supplier account’s configuration and local state, then refresh its snapshot.',
    'Accepting calls': 'The next original supplier dispatch checks this shared account again. Routes that draw from the same allowance should keep the same configured account.',
    'Supplier cooldown': 'The original supplier response requested a wait. The shared account keeps that cooldown across routes and seller restarts.',
    'Window limit': 'The rolling 24-hour call allowance is used. Capacity returns as the original minute buckets leave that window.',
    'Rate limit': 'Calls share the configured per-second allowance. Use the displayed retry time to plan the next request.',
  };
  $('detail-guidance').textContent = guidance[state];
}
function renderRows() {
  if (!snapshot) return;
  const filter = $('filter').value.trim().toLocaleLowerCase();
  const accounts = snapshot.accounts.filter(account =>
    [account.name, account.quota?.account ?? '', ...account.bindings].join(' ').toLocaleLowerCase().includes(filter));
  const rows = accounts.map(account => {
    const row = document.createElement('tr'), quota = account.quota;
    if (selected === account.name) row.className = 'selected';
    const name = document.createElement('td');
    name.append(text('strong', account.name));
    if (quota?.account) name.append(text('small', quota.account));
    row.append(name, text('td', count(account.bindings.length)), text('td', count(quota?.callsInWindow)),
      text('td', count(quota?.remainingCalls)), text('td', count(quota?.policy.requestsPerSecond)));
    const state = supplierQuotaState(account, snapshot.capturedAt), admission = document.createElement('td');
    admission.append(text('span', state, 'state' + (state === 'Accepting calls' ? '' : ' stopped')));
    row.append(admission, text('td', timestamp(quota?.retryAt)));
    const action = document.createElement('td'), button = text('button', 'View');
    button.type = 'button';
    button.setAttribute('aria-label', 'View supplier account ' + account.name);
    button.setAttribute('aria-expanded', String(selected === account.name));
    button.setAttribute('aria-controls', 'detail');
    button.addEventListener('click', () => {
      selected = account.name;
      renderRows();
      renderDetail();
      $('detail').scrollIntoView({ block: 'nearest' });
    });
    action.append(button);
    row.append(action);
    return row;
  });
  $('accounts').replaceChildren(...rows);
  $('empty').hidden = accounts.length > 0;
  $('empty').textContent = snapshot.accounts.length
    ? 'No supplier accounts match this filter.'
    : 'No shared supplier accounts are configured for this seller.';
}
function renderSnapshot() {
  $('setup').hidden = snapshot.enabled;
  $('content').hidden = !snapshot.enabled;
  $('account-count').textContent = count(snapshot.accounts.length);
  $('allowed-count').textContent = count(snapshot.accounts.filter(account => account.status === 'AVAILABLE' && account.quota?.allowed).length);
  $('cooldown-count').textContent = count(snapshot.accounts.filter(account => account.status === 'AVAILABLE' &&
    account.quota?.providerCooldownUntil > Date.parse(snapshot.capturedAt)).length);
  $('unavailable-count').textContent = count(snapshot.accounts.filter(account => account.status !== 'AVAILABLE').length);
  $('captured').textContent = 'Snapshot ' + timestamp(snapshot.capturedAt) + ' · Refresh when you need current usage.';
  $('footer-time').textContent = 'Captured ' + timestamp(snapshot.capturedAt);
  if (!snapshot.accounts.some(account => account.name === selected)) selected = null;
  renderRows();
  renderDetail();
  updateDownloads();
}
async function refresh() {
  if (request) return;
  const controller = new AbortController();
  request = controller;
  $('refresh').disabled = true;
  $('status').textContent = 'Reading shared account state…';
  $('failure').hidden = true;
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch('/api/supplier-quotas', { cache: 'no-store', signal: controller.signal,
      headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error('unavailable');
    const next = await response.json();
    if (next.schema !== 'stellar-forge.supplier-quotas.v1' || typeof next.enabled !== 'boolean' ||
        !Array.isArray(next.accounts) || !Number.isFinite(Date.parse(next.capturedAt))) throw new Error('invalid');
    snapshot = next;
    renderSnapshot();
    $('status').textContent = snapshot.enabled
      ? count(snapshot.accounts.length) + ' supplier accounts loaded.'
      : 'Supplier account configuration is required.';
    $('refresh').textContent = 'Refresh snapshot';
  } catch {
    $('failure').hidden = false;
    $('failure').textContent = snapshot
      ? 'The current snapshot could not be read. The displayed values and downloads still belong to ' + timestamp(snapshot.capturedAt) + '. Refresh to try again.'
      : 'The supplier account snapshot could not be read. Check that the seller is running, then try again.';
    $('status').textContent = 'Snapshot read failed.';
  } finally {
    clearTimeout(timeout);
    request = null;
    $('refresh').disabled = false;
  }
}
$('refresh').addEventListener('click', refresh);
$('filter').addEventListener('input', renderRows);
$('close-detail').addEventListener('click', () => {
  selected = null;
  renderRows();
  renderDetail();
});
window.addEventListener('pagehide', () => { request?.abort(); releaseDownloads(); });
window.addEventListener('pageshow', event => { if (event.persisted && snapshot) updateDownloads(); });
