// MIT. Explicit Blockscout provider connection; credential values stay in the caller environment.
export const CONNECTION_SCHEMA = 'stellar-forge.blockscout-connection.v1';
export const PRO_ORIGIN = 'https://api.blockscout.com';
export const PRO_SOURCE = 'https://docs.blockscout.com/api-reference/tokens/retrieve-detailed-information-about-a-specific-token';
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(x));
const fail = code => { throw Object.assign(new Error(code), { code, status: 400 }); };
const fields = (value, keys) => {
  if (!plain(value) || Object.keys(value).some(key => !keys.includes(key))) fail('BLOCKSCOUT_CONNECTION_INVALID');
};
const label = (value, max) => {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > max ||
      /[\u0000-\u001f\u007f]/.test(value)) fail('BLOCKSCOUT_CONNECTION_LABEL_INVALID');
  return value;
};
export function connectionSource(value) {
  let url;
  try { url = new URL(value); } catch { fail('BLOCKSCOUT_CONNECTION_SOURCE_REQUIRED'); }
  if (typeof value !== 'string' || value.length > 2000 || url.protocol !== 'https:' ||
      url.username || url.password || url.hash || url.port ||
      [...url.searchParams.keys()].some(key => /^(?:api[-_]?key|key|token|access[-_]?token|signature|secret|password)$/i.test(key)))
    fail('BLOCKSCOUT_CONNECTION_SOURCE_REQUIRED');
  return url.href;
}
export function normalizeConnection(value, plan) {
  fields(value, ['schema', 'mode', 'origin', 'chainId', 'authentication', 'providerName', 'sourceUrl', 'reviewedAt']);
  if (value.schema !== CONNECTION_SCHEMA || !['pro', 'instance'].includes(value.mode))
    fail('BLOCKSCOUT_CONNECTION_SCHEMA_INVALID');
  let url;
  try { url = new URL(value.origin); } catch { fail('BLOCKSCOUT_CONNECTION_ORIGIN_INVALID'); }
  if (typeof value.origin !== 'string' || value.origin.length > 2048 || url.protocol !== 'https:' ||
      url.origin !== value.origin || url.username || url.password || url.port ||
      ['localhost', 'localhost.localdomain'].includes(url.hostname.toLowerCase()) ||
      url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local'))
    fail('BLOCKSCOUT_CONNECTION_ORIGIN_INVALID');
  if (url.origin === plan.publicOrigin) fail('BLOCKSCOUT_CONNECTION_MERCHANT_LOOP');
  fields(value.authentication, ['kind', 'header']);
  const auth = value.authentication;
  if (!['bearer', 'api-key-header', 'none'].includes(auth.kind) ||
      auth.kind !== 'api-key-header' && Object.hasOwn(auth, 'header') ||
      auth.kind === 'api-key-header' && auth.header !== 'x-api-key')
    fail('BLOCKSCOUT_CONNECTION_AUTH_INVALID');
  if (value.mode === 'pro') {
    if (url.origin !== PRO_ORIGIN || auth.kind !== 'bearer' || Object.hasOwn(value, 'chainId'))
      fail('BLOCKSCOUT_PRO_CONNECTION_INVALID');
  } else {
    if (url.origin === PRO_ORIGIN || typeof value.chainId !== 'string' ||
        !Array.isArray(plan.chains) || plan.chains.length !== 1 || plan.chains[0].chainId !== value.chainId)
      fail('BLOCKSCOUT_INSTANCE_CHAIN_REQUIRED');
    // Instance tariffs are explicit local request units. PRO credit observations
    // cannot be carried into a separately operated instance account.
    if (plan.limits?.creditsPerAttempt !== 1 || plan.limits?.minProviderCredits !== 0 ||
        plan.limits?.dayCredits !== plan.limits?.dayAttempts)
      fail('BLOCKSCOUT_INSTANCE_REQUEST_BUDGET_REQUIRED');
  }
  const reviewedAt = value.reviewedAt;
  if (typeof reviewedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(reviewedAt) ||
      !Number.isFinite(Date.parse(reviewedAt)) || new Date(reviewedAt).toISOString() !== reviewedAt)
    fail('BLOCKSCOUT_CONNECTION_REVIEW_TIME_REQUIRED');
  return { schema: CONNECTION_SCHEMA, mode: value.mode, origin: url.origin,
    ...(value.mode === 'instance' ? { chainId: value.chainId } : {}),
    authentication: { kind: auth.kind, ...(auth.kind === 'api-key-header' ? { header: auth.header } : {}) },
    providerName: label(value.providerName, 120), sourceUrl: connectionSource(value.sourceUrl), reviewedAt };
}
export function connectionForPlan(plan) {
  if (plan.connection !== undefined) return normalizeConnection(plan.connection, plan);
  return { schema: CONNECTION_SCHEMA, mode: 'pro', origin: PRO_ORIGIN,
    authentication: { kind: 'bearer' }, providerName: 'Blockscout PRO', sourceUrl: PRO_SOURCE,
    reviewedAt: null };
}
export function connectionIdentity(plan) {
  const c = connectionForPlan(plan);
  return { mode: c.mode, origin: c.origin, ...(c.mode === 'instance' ? { chainId: c.chainId } : {}),
    authentication: { ...c.authentication } };
}
export function connectionPath(plan, chainId, address = ':address_hash') {
  const c = connectionForPlan(plan);
  if (!plan.chains.some(row => row.chainId === chainId) || c.mode === 'instance' && c.chainId !== chainId)
    fail('BLOCKSCOUT_CONNECTION_CHAIN_INVALID');
  if (address !== ':address_hash' && !/^0x[A-Fa-f0-9]{40}$/.test(address))
    fail('BLOCKSCOUT_CONNECTION_TOKEN_INVALID');
  return (c.mode === 'pro' ? '/' + chainId : '') + '/api/v2/tokens/' + address;
}
export function connectionSummary(plan) {
  const c = connectionForPlan(plan);
  return { ...c, accountAlias: plan.accountAlias,
    credentialEnvironment: c.authentication.kind === 'none' ? null : plan.apiKeyEnv,
    budgetUnit: c.mode === 'pro' ? 'credits' : 'requests',
    routes: plan.chains.map(row => ({ chainId: row.chainId, name: row.name,
      providerTemplate: c.origin + connectionPath(plan, row.chainId),
      merchantTemplate: plan.publicOrigin + '/' + row.chainId + '/api/v2/tokens/:address_hash' })) };
}
export function connectionRuntime(plan, env = process.env, { deferCredentials = false } = {}) {
  if (typeof deferCredentials !== 'boolean') fail('BLOCKSCOUT_DEFER_CREDENTIALS_INVALID');
  const c = connectionForPlan(plan);
  if (c.authentication.kind === 'none') return { connection: c, headerEnv: {}, env: {}, secret: null };
  const name = c.authentication.kind === 'bearer' ? 'authorization' : 'x-api-key';
  const secret = env?.[plan.apiKeyEnv];
  if (deferCredentials && (secret === undefined || secret === null || secret === ''))
    return { connection: c, headerEnv: { [name]: 'BLOCKSCOUT_RUNTIME_AUTHORIZATION' }, env: {}, secret: null };
  if (typeof secret !== 'string' || secret.length < 16 || secret.length > 4096 ||
      !/^[A-Za-z0-9._~+\/-]+=*$/.test(secret))
    fail('BLOCKSCOUT_PRIVATE_API_KEY_REQUIRED');
  return { connection: c, headerEnv: { [name]: 'BLOCKSCOUT_RUNTIME_AUTHORIZATION' },
    env: { BLOCKSCOUT_RUNTIME_AUTHORIZATION: c.authentication.kind === 'bearer' ? 'Bearer ' + secret : secret }, secret };
}
