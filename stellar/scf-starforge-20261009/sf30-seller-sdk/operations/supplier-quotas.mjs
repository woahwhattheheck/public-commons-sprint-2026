// MIT. Read-only projection of the original shared supplier-account quota.
const SCHEMA = 'stellar-forge.supplier-quotas.v1';
const QUOTA_SCHEMA = 'stellar-forge.routescan-quota.v1';
const number = value => Number.isSafeInteger(value) && value >= 0;
const iso = value => {
  if (value === null || value === undefined || value === 0) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? date.toISOString() : null;
};
const safeCode = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(value)
  ? value : 'SUPPLIER_QUOTA_UNAVAILABLE';

function accountView(account) {
  if (!account || typeof account.name !== 'string' || !Array.isArray(account.bindings) ||
      account.bindings.some(binding => typeof binding !== 'string')) throw new TypeError('Invalid supplier account snapshot');
  const base = { name: account.name, bindings: [...account.bindings], status: account.status,
    errorCode: account.errorCode === null ? null : safeCode(account.errorCode), quota: null };
  if (account.status !== 'AVAILABLE') return { ...base, status: 'UNAVAILABLE',
    errorCode: safeCode(account.errorCode) };
  const quota = account.quota;
  if (!quota || quota.schema !== QUOTA_SCHEMA || typeof quota.account !== 'string' ||
      !quota.policy || !number(quota.policy.requestsPerSecond) || quota.policy.requestsPerSecond < 1 ||
      !number(quota.policy.callsPerDay) || quota.policy.callsPerDay < 1 ||
      ['revision', 'callsInWindow', 'remainingCalls', 'windowSeconds', 'bucketSeconds',
        'lastDispatchAt', 'providerCooldownUntil', 'totalDispatched', 'retryAfterSeconds'].some(key => !number(quota[key])) ||
      typeof quota.allowed !== 'boolean' ||
      (quota.retryAt !== null && iso(quota.retryAt) === null)) {
    return { ...base, status: 'UNAVAILABLE', errorCode: 'SUPPLIER_QUOTA_SNAPSHOT_INVALID' };
  }
  return { ...base, errorCode: null, quota: {
    schema: quota.schema, account: quota.account, revision: quota.revision,
    policy: { requestsPerSecond: quota.policy.requestsPerSecond, callsPerDay: quota.policy.callsPerDay },
    callsInWindow: quota.callsInWindow, remainingCalls: quota.remainingCalls,
    windowSeconds: quota.windowSeconds, bucketSeconds: quota.bucketSeconds,
    lastDispatchAt: quota.lastDispatchAt, providerCooldownUntil: quota.providerCooldownUntil,
    totalDispatched: quota.totalDispatched, allowed: quota.allowed,
    retryAfterSeconds: quota.retryAfterSeconds, retryAt: iso(quota.retryAt),
  } };
}

export async function readSupplierQuotas(session) {
  if (typeof session?.supplierQuotaSnapshot !== 'function')
    return { schema: SCHEMA, enabled: false, capturedAt: new Date().toISOString(), accounts: [] };
  const snapshot = await session.supplierQuotaSnapshot();
  if (!snapshot || snapshot.schema !== SCHEMA || !Array.isArray(snapshot.accounts) || !iso(snapshot.capturedAt))
    throw new TypeError('Invalid supplier quota snapshot');
  return { schema: SCHEMA, enabled: true, capturedAt: iso(snapshot.capturedAt),
    accounts: snapshot.accounts.map(accountView) };
}

export function supplierQuotaState(account, capturedAt) {
  if (account.status !== 'AVAILABLE' || !account.quota) return 'Unavailable';
  const quota = account.quota;
  if (quota.allowed) return 'Accepting calls';
  if (quota.providerCooldownUntil > Date.parse(capturedAt)) return 'Supplier cooldown';
  if (quota.remainingCalls === 0) return 'Window limit';
  return 'Rate limit';
}

function cell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  // Preserve labels while keeping spreadsheet applications from executing them.
  if (/^\s*[=+\-@]/u.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function supplierQuotasCsv(snapshot) {
  const rows = [[
    'captured_at_utc', 'account_alias', 'supplier_account', 'binding_count', 'bindings',
    'status', 'admission', 'calls_in_window', 'remaining_calls', 'requests_per_second',
    'calls_per_24_hours', 'window_seconds', 'bucket_seconds', 'total_dispatched',
    'last_dispatch_at_utc', 'provider_cooldown_until_utc', 'retry_at_utc',
    'retry_after_seconds', 'revision', 'error_code',
  ]];
  for (const account of snapshot.accounts) {
    const quota = account.quota;
    rows.push([
      snapshot.capturedAt, account.name, quota?.account, account.bindings.length,
      account.bindings.join('; '), account.status, supplierQuotaState(account, snapshot.capturedAt),
      quota?.callsInWindow, quota?.remainingCalls, quota?.policy.requestsPerSecond,
      quota?.policy.callsPerDay, quota?.windowSeconds, quota?.bucketSeconds,
      quota?.totalDispatched, iso(quota?.lastDispatchAt), iso(quota?.providerCooldownUntil),
      quota?.retryAt, quota?.retryAfterSeconds, quota?.revision, account.errorCode,
    ]);
  }
  return rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
