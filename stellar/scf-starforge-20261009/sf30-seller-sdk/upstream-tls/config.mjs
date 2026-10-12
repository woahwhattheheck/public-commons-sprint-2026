// MIT. Certificate references for the original SF30 upstream transport.
export const UPSTREAM_TLS_SCHEMA = 'stellar-forge.upstream-tls.v1';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fields = new Set(['caFileEnv', 'certFileEnv', 'keyFileEnv', 'pfxFileEnv', 'passphraseEnv', 'minVersion']);
const referenceFields = ['caFileEnv', 'certFileEnv', 'keyFileEnv', 'pfxFileEnv', 'passphraseEnv'];
const fail = message => { throw new TypeError(message); };

/** Pure reference validation: no environment, certificate, key or network read. */
export function compileUpstreamTls(value, { origin } = {}) {
  if (value === undefined) return undefined;
  if (!plain(value) || Object.keys(value).some(key => !fields.has(key)))
    fail('TLS profile accepts certificate environment references and minVersion only');
  if (origin !== undefined) {
    let url;
    try { url = new URL(origin); } catch { fail('TLS profile requires the configured HTTPS upstream'); }
    if (url.protocol !== 'https:') fail('TLS profile requires the configured HTTPS upstream');
  }
  const result = {};
  for (const key of referenceFields) {
    if (!Object.hasOwn(value, key)) continue;
    if (typeof value[key] !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value[key]))
      fail('TLS credential fields must name environment variables');
    result[key] = value[key];
  }
  if (Boolean(result.certFileEnv) !== Boolean(result.keyFileEnv))
    fail('TLS PEM authentication requires both certFileEnv and keyFileEnv');
  if (result.pfxFileEnv && (result.certFileEnv || result.keyFileEnv))
    fail('Select PEM certificate/key or pfxFileEnv for TLS authentication');
  if (result.passphraseEnv && !result.keyFileEnv && !result.pfxFileEnv)
    fail('TLS passphraseEnv requires a private key or PKCS12 bundle');
  if (!result.caFileEnv && !result.certFileEnv && !result.pfxFileEnv)
    fail('TLS profile requires a CA bundle or client certificate');
  if (value.minVersion !== undefined && !['TLSv1.2', 'TLSv1.3'].includes(value.minVersion))
    fail('TLS minVersion must be TLSv1.2 or TLSv1.3');
  if (value.minVersion !== undefined) result.minVersion = value.minVersion;
  return Object.freeze(result);
}

export function upstreamTlsReferences(value) {
  const profile = compileUpstreamTls(value);
  return Object.freeze(profile ? [...new Set(referenceFields.flatMap(key => profile[key] ? [profile[key]] : []))].sort() : []);
}
