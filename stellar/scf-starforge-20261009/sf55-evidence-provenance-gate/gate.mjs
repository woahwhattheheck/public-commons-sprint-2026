// MIT. SCF SF55: offline source provenance, NOT a claim of external acceptance.
// Usage: node gate.mjs [repo-root] [manifest.json]. No network/CI/payment calls.
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { resolve, relative, sep, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const KINDS = new Set(['source', 'focused_run', 'provider_receipt',
  'buyer_traction', 'grant_status']);
const MAX_CLAIMS = 200;
const MAX_BYTES = 8_000_000;

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function requireText(value, label) {
  if (typeof value !== 'string' || !value || value.length > 1024)
    throw new TypeError(label + ' must be bounded nonempty text');
  return value;
}
function safeRead(root, fragment) {
  requireText(fragment, 'file');
  if (fragment.includes('\\') || fragment.startsWith('/') ||
      fragment.split('/').some(p => !p || p === '.' || p === '..'))
    throw new TypeError('INVALID_RELATIVE_PATH');
  const home = realpathSync(root);
  const absolute = resolve(home, fragment);
  const rel = relative(home, absolute);
  if (!rel || rel === '..' || rel.startsWith('..' + sep))
    throw new TypeError('PATH_OUTSIDE_ROOT');
  let cursor = home;
  for (const part of fragment.split('/')) {
    cursor = join(cursor, part);
    if (lstatSync(cursor).isSymbolicLink())
      throw new TypeError('SYMLINK_NOT_ALLOWED');
  }
  if (realpathSync(absolute) !== absolute) throw new TypeError('PATH_NOT_CANONICAL');
  const buf = readFileSync(absolute);
  if (buf.length > MAX_BYTES) throw new RangeError('FILE_TOO_LARGE');
  return buf;
}
export function gitBlobSha1(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return createHash('sha1').update('blob ' + buffer.length + '\0')
    .update(buffer).digest('hex');
}
export function auditManifest(root, manifest) {
  if (!object(manifest) || manifest.schema_version !== 1 ||
      !Array.isArray(manifest.claims) || manifest.claims.length > MAX_CLAIMS)
    throw new TypeError('SCF55_SCHEMA_INVALID');
  const seen = new Set();
  const claims = manifest.claims.map((item, index) => {
    if (!object(item)) throw new TypeError('CLAIM_INVALID:' + index);
    const id = requireText(item.id, 'id');
    if (!/^[a-z][a-z0-9_-]{0,80}$/.test(id) || seen.has(id))
      throw new TypeError('CLAIM_ID_INVALID_OR_DUPLICATE:' + id);
    seen.add(id);
    if (!KINDS.has(item.kind)) throw new TypeError('UNKNOWN_CLAIM_KIND:' + id);
    if (item.kind === 'source' || item.kind === 'focused_run') {
      if (!SHA1.test(item.git_blob_sha1))
        throw new TypeError('INVALID_BLOB_SHA:' + id);
      // Never re-label a pinned test FILE as a test EXECUTION.
      let observed;
      try { observed = gitBlobSha1(safeRead(root, item.file)); }
      catch (error) {
        return { id, kind: item.kind, result: 'source_unavailable',
          reason: error.message.slice(0, 120) };
      }
      const matches = observed === item.git_blob_sha1;
      return { id, kind: item.kind, file: item.file,
        expected_git_blob_sha1: item.git_blob_sha1,
        observed_git_blob_sha1: observed,
        result: matches
          ? (item.kind === 'source' ? 'source_verified' : 'test_source_only_not_executed')
          : 'source_drift' };
    }
    // An untrusted receipt filename, URL, or claimant statement cannot attest
    // provider acceptance, real buyer traction, or SCF application status.
    // Keep those classes pending independent provider/human readback.
    return { id, kind: item.kind,
      result: 'external_acceptance_not_verified_by_source_gate' };
  });
  const sourceFailures = claims.filter(c =>
    c.result === 'source_drift' || c.result === 'source_unavailable');
  return {
    schema_version: 1,
    context: 'Offline checkout, source bytes only. No payment/testnet/customer/SCF submission assertion.',
    source_integrity_ok: sourceFailures.length === 0,
    source_verified: claims.filter(c => c.result === 'source_verified').length,
    pinned_test_files_not_executed: claims.filter(c =>
      c.result === 'test_source_only_not_executed').length,
    external_outcomes_verified: 0,
    submission_ready: false,
    claims
  };
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self) {
  try {
    const defaultRoot = resolve(dirname(self), '../../..');
    const root = resolve(process.argv[2] ?? defaultRoot);
    const manifestFile = resolve(process.argv[3] ?? join(dirname(self), 'manifest.json'));
    const raw = readFileSync(manifestFile);
    if (raw.length > 256_000) throw new RangeError('MANIFEST_TOO_LARGE');
    const report = auditManifest(root, JSON.parse(raw.toString('utf8')));
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (!report.source_integrity_ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write('SCF55 gate error: ' + error.message + '\n');
    process.exitCode = 2;
  }
}
