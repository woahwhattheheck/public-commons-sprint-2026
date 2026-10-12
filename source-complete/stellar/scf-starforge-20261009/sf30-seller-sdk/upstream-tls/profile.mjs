// MIT. Load one launch-time credential snapshot into Node's original TLS engine.
import { constants, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { createHash, createPrivateKey, X509Certificate, randomBytes } from 'node:crypto';
import { createSecureContext, checkServerIdentity, DEFAULT_MIN_VERSION } from 'node:tls';
import { compileUpstreamTls, upstreamTlsReferences, UPSTREAM_TLS_SCHEMA } from './config.mjs';

const contexts = new WeakMap();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export class UpstreamTlsError extends Error {
  constructor(code, reference) {
    super(code); this.name = 'UpstreamTlsError'; this.code = code;
    if (reference !== undefined) this.reference = reference;
  }
}
const fail = (code, reference) => { throw new UpstreamTlsError(code, reference); };

function envValue(env, reference, max) {
  const value = Object.hasOwn(env, reference) ? env[reference] : undefined;
  if (typeof value !== 'string' || !value || value.length > max || value.includes('\0'))
    fail('UPSTREAM_TLS_ENVIRONMENT_UNAVAILABLE', reference);
  return value;
}

function material(env, reference, { privateMaterial = false, max = 1048576 } = {}) {
  const path = envValue(env, reference, 4096);
  if (!isAbsolute(path) || resolve(path) !== path) fail('UPSTREAM_TLS_PATH_INVALID', reference);
  let descriptor, bytes;
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.size < 1 || before.size > max) fail('UPSTREAM_TLS_FILE_INVALID', reference);
    if (privateMaterial && process.platform !== 'win32' && (before.mode & 0o077))
      fail('UPSTREAM_TLS_KEY_PERMISSIONS', reference);
    bytes = Buffer.alloc(before.size + 1);
    let count = 0;
    while (count < bytes.length) {
      const read = readSync(descriptor, bytes, count, bytes.length - count, null);
      if (!read) break;
      count += read;
    }
    const after = fstatSync(descriptor);
    if (count !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs) fail('UPSTREAM_TLS_FILE_CHANGED', reference);
    return bytes.subarray(0, count);
  } catch (error) {
    bytes?.fill(0);
    if (error instanceof UpstreamTlsError) throw error;
    fail('UPSTREAM_TLS_FILE_UNAVAILABLE', reference);
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}

function certificates(bytes, reference) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const blocks = text.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
    if (!blocks?.length || blocks.length > 64 || text.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, '').trim())
      fail('UPSTREAM_TLS_CERTIFICATE_INVALID', reference);
    return blocks.map(block => new X509Certificate(block));
  } catch (error) {
    if (error instanceof UpstreamTlsError) throw error;
    fail('UPSTREAM_TLS_CERTIFICATE_INVALID', reference);
  }
}

function certificateSummary(certificate) {
  return Object.freeze({ sha256: sha(certificate.raw),
    validFrom: new Date(certificate.validFrom).toISOString(), validTo: new Date(certificate.validTo).toISOString() });
}

/** Synchronous construction matches original SF30 launch. Material is read once;
 * the returned handle and snapshots cannot serialize the key or private paths. */
export function loadUpstreamTls(value, { env = process.env, origin, now = Date.now() } = {}) {
  const profile = compileUpstreamTls(value, { origin });
  if (profile === undefined) return undefined;
  if (!env || typeof env !== 'object' || Array.isArray(env) || !Number.isFinite(now))
    throw new TypeError('TLS loading requires a host environment and time');
  // Node HTTPS Agent keys pools and resumptions by sessionIdContext, but not by
  // secureContext. Isolate each loaded identity when a host shares its agent.
  const sessionIdContext = randomBytes(16).toString('hex');
  const buffers = [], options = { minVersion: profile.minVersion ?? DEFAULT_MIN_VERSION, sessionIdContext };
  let certificate = null, caCertificates = [], bundleSha256 = null;
  const read = (reference, privateMaterial = false, max) => {
    const bytes = material(env, reference, { privateMaterial, ...(max === undefined ? {} : { max }) });
    buffers.push(bytes); return bytes;
  };
  try {
    if (profile.caFileEnv) {
      options.ca = read(profile.caFileEnv);
      caCertificates = certificates(options.ca, profile.caFileEnv).map(certificateSummary);
    }
    if (profile.certFileEnv) {
      options.cert = read(profile.certFileEnv);
      options.key = read(profile.keyFileEnv, true, 262144);
      certificate = certificates(options.cert, profile.certFileEnv)[0];
      const start = Date.parse(certificate.validFrom), end = Date.parse(certificate.validTo);
      if (!Number.isFinite(start) || !Number.isFinite(end) || now < start || now >= end)
        fail('UPSTREAM_TLS_CERTIFICATE_TIME_INVALID', profile.certFileEnv);
    }
    if (profile.pfxFileEnv) {
      options.pfx = read(profile.pfxFileEnv, true);
      bundleSha256 = sha(options.pfx);
    }
    if (profile.passphraseEnv) options.passphrase = envValue(env, profile.passphraseEnv, 4096);
    if (certificate) {
      let key;
      try { key = createPrivateKey({ key: options.key, format: 'pem', passphrase: options.passphrase }); }
      catch { fail('UPSTREAM_TLS_PRIVATE_KEY_INVALID', profile.keyFileEnv); }
      if (!certificate.checkPrivateKey(key)) fail('UPSTREAM_TLS_KEY_CERTIFICATE_MISMATCH', profile.keyFileEnv);
    }
    let secureContext;
    try { secureContext = createSecureContext(options); }
    catch { fail('UPSTREAM_TLS_CONTEXT_INVALID'); }
    const snapshot = Object.freeze({ schema: UPSTREAM_TLS_SCHEMA, state: 'LOADED',
      loadedAt: new Date(now).toISOString(), authentication: profile.pfxFileEnv ? 'PKCS12' : certificate ? 'PEM' : 'SERVER_ONLY',
      trust: profile.caFileEnv ? 'CUSTOM_CA_ONLY' : 'NODE_DEFAULT', minVersion: options.minVersion,
      references: upstreamTlsReferences(profile), certificate: certificate ? certificateSummary(certificate) : null,
      caCertificates: Object.freeze(caCertificates), bundleSha256 });
    const handle = Object.freeze({ snapshot: () => snapshot, toJSON: () => snapshot });
    contexts.set(handle, Object.freeze({ secureContext, sessionIdContext, rejectUnauthorized: true, checkServerIdentity }));
    return handle;
  } finally {
    // OpenSSL owns its native copy. Do not retain JavaScript key buffers or the
    // passphrase in a serializable runtime descriptor.
    for (const bytes of buffers) bytes.fill(0);
    options.passphrase = undefined;
  }
}

/** The original challenge-only launcher can retain references until an admitted
 * supplier attempt. Once loaded, this handle uses that same fixed context. */
export function deferUpstreamTls(value, { env = process.env, origin } = {}) {
  const declaration = compileUpstreamTls(value, { origin });
  if (declaration === undefined) return undefined;
  let loaded;
  const pending = Object.freeze({ schema: UPSTREAM_TLS_SCHEMA, state: 'DEFERRED', loadedAt: null,
    authentication: declaration.pfxFileEnv ? 'PKCS12' : declaration.certFileEnv ? 'PEM' : 'SERVER_ONLY',
    trust: declaration.caFileEnv ? 'CUSTOM_CA_ONLY' : 'NODE_DEFAULT',
    minVersion: declaration.minVersion ?? DEFAULT_MIN_VERSION, references: upstreamTlsReferences(declaration),
    certificate: null, caCertificates: Object.freeze([]), bundleSha256: null });
  const snapshot = () => loaded ? loaded.snapshot() : pending;
  const handle = Object.freeze({ snapshot, toJSON: snapshot });
  contexts.set(handle, () => {
    loaded ??= loadUpstreamTls(declaration, { env, origin });
    return contexts.get(loaded);
  });
  return handle;
}

/** Validate an opaque handle without opening deferred credential files. */
export function assertUpstreamTlsProfile(profile) {
  if (profile !== undefined && !contexts.has(profile))
    throw new TypeError('Use a loaded or deferred original upstream TLS profile');
}

/** Only a profile constructed above can supply Node transport options. */
export function upstreamTlsRequestOptions(profile) {
  if (profile === undefined) return Object.freeze({});
  assertUpstreamTlsProfile(profile);
  const options = contexts.get(profile);
  return typeof options === 'function' ? options() : options;
}
