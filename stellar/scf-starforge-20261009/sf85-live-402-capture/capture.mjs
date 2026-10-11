/**
 * SF85: one explicitly approved merchant HTTP 402 acquisition for the original SF84 inspector.
 * No signer, wallet, payment, body download, redirects, cookies, or hosted services.
 * SPDX-License-Identifier: MIT
 */
import { lookup } from 'node:dns/promises';
import { writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectBytes } from '../sf84-mpp-market-intake/inspect.mjs';

class CaptureError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const denied = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10],
  ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
]) denied.addSubnet(address, prefix, 'ipv4');

const publicV4 = (address) => isIP(address) === 4 && !denied.check(address, 'ipv4');
// Some isolated VM egress resolvers intentionally map external HTTPS names into
// the 198.18/15 benchmark overlay. Never allow this range without operator opt-in.
const sandboxEgress = new BlockList();
sandboxEgress.addSubnet('198.18.0.0', 15, 'ipv4');
const sandboxV4 = (address) => isIP(address) === 4 && sandboxEgress.check(address, 'ipv4');
const CHALLENGE = new Set(['payment-required', 'www-authenticate']);
// Query parameters can carry access credentials under names beyond "token".
// Normalize separated/camel-case keys before attempting an original HTTPS capture.
const SECRET_QUERY_PART = /(?:token|secret|password|passwd|credential|signature|session|apikey|accesskey|privatekey|bearer|authorization|signedurl|oauthcode|oauthstate|accesscode)/;
const SECRET_QUERY_EXACT = new Set(['key', 'auth', 'code', 'sig', 'jwt', 'nonce']);
const JWT_VALUE = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/;
function hasCredentialQuery(target) {
  return [...target.searchParams].some(([key, value]) => {
    const normalizedKey = key.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
    return SECRET_QUERY_PART.test(normalizedKey) || SECRET_QUERY_EXACT.has(normalizedKey)
      || JWT_VALUE.test(value);
  });
}

export function parseArgs(argv) {
  const allowed = new Set(['--url', '--allow-origin', '--out', '--method', '--timeout-ms', '--sandbox-egress-range']);
  if (argv.length % 2 !== 0) throw new CaptureError('USAGE_REQUIRES_VALUE_PAIRS');
  const args = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    if (!allowed.has(argv[i]) || args.has(argv[i]) || !argv[i + 1]) throw new CaptureError('UNKNOWN_DUPLICATE_OR_EMPTY_ARGUMENT');
    args.set(argv[i], argv[i + 1]);
  }
  if (!args.get('--url') || !args.get('--allow-origin') || !args.get('--out')) throw new CaptureError('REQUIRE_URL_ALLOW_ORIGIN_AND_OUT');
  let target;
  try { target = new URL(args.get('--url')); } catch { throw new CaptureError('INVALID_TARGET_URL'); }
  if (target.protocol !== 'https:' || !target.hostname || target.username || target.password || target.hash || target.port || isIP(target.hostname)) {
    throw new CaptureError('REQUIRE_PUBLIC_HOST_HTTPS_443_WITHOUT_USERINFO_OR_FRAGMENT');
  }
  if (target.href.length > 4096 || hasCredentialQuery(target)) throw new CaptureError('URL_TOO_LONG_OR_CREDENTIAL_QUERY');
  if (args.get('--allow-origin') !== target.origin) throw new CaptureError('TARGET_ORIGIN_NOT_EXPLICITLY_APPROVED');
  const method = args.get('--method') ?? 'GET';
  if (!['GET', 'HEAD'].includes(method)) throw new CaptureError('ONLY_GET_OR_HEAD_SUPPORTED');
  const timeout = args.has('--timeout-ms') ? Number(args.get('--timeout-ms')) : 8000;
  if (!Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 30000) throw new CaptureError('TIMEOUT_OUT_OF_RANGE');
  const sandboxRange = args.get('--sandbox-egress-range');
  if (sandboxRange !== undefined && sandboxRange !== '198.18.0.0/15') {
    throw new CaptureError('UNSUPPORTED_SANDBOX_EGRESS_RANGE');
  }
  const out = args.get('--out');
  if (!isAbsolute(out) || out.includes('\0')) throw new CaptureError('OUTPUT_MUST_BE_ABSOLUTE_PATH');
  return { target, out, method, timeout, allowSandboxGateway: sandboxRange !== undefined };
}

export async function capture({ target, method, timeout, allowSandboxGateway = false }, { resolve = lookup, httpsRequest = request } = {}) {
  // Resolve the ORIGINAL hostname once, then pin it for TLS. Default is public
  // IPv4 only. Explicit sandbox opt-in permits an ALL-198.18/15 answer set,
  // not mixed public/overlay answers or any other reserved/private ranges.
  let answers;
  try { answers = await resolve(target.hostname, { family: 4, all: true }); }
  catch { throw new CaptureError('PUBLIC_IPV4_RESOLUTION_FAILED'); }
  if (!Array.isArray(answers) || answers.length === 0) throw new CaptureError('DNS_HAS_NONPUBLIC_OR_NO_IPV4');
  const allPublic = answers.every(a => a.family === 4 && publicV4(a.address));
  const allSandbox = allowSandboxGateway && answers.every(a => a.family === 4 && sandboxV4(a.address));
  if (!allPublic && !allSandbox) throw new CaptureError('DNS_HAS_NONPUBLIC_OR_NO_IPV4');
  const pinnedIP = answers[0].address;
  const raw = await new Promise((resolveResult, reject) => {
    const req = httpsRequest(target, {
      method,
      agent: false,
      maxHeaderSize: 64 * 1024,
      headers: { Accept: '*/*', 'User-Agent': 'TJLabs-SCF-merchant-capture/1.0' },
      lookup: (_host, _options, cb) => cb(null, pinnedIP, 4),
      signal: AbortSignal.timeout(timeout),
      rejectUnauthorized: true,
    }, (response) => {
      // Capturing only the two payment challenge headers preserves repeated
      // WWW-Authenticate lines without persisting incidental server headers.
      const headers = [];
      for (let i = 0; i < response.rawHeaders.length; i += 2) {
        const name = response.rawHeaders[i];
        if (CHALLENGE.has(name.toLowerCase())) headers.push([name, response.rawHeaders[i + 1]]);
      }
      const status = response.statusCode;
      response.destroy(); // No response body is read, stored or forwarded.
      resolveResult({ status, headers });
    });
    req.on('error', reject);
    req.end();
  });
  if (!Number.isInteger(raw.status)) throw new CaptureError('MISSING_HTTP_STATUS');
  return {
    schema: 'scf.sf85.capture.v1',
    collectedAtUtc: new Date().toISOString(),
    url: target.href,
    method,
    status: raw.status,
    headers: raw.headers,
  };
}

export async function run(argv) {
  const options = parseArgs(argv);
  const source = await capture(options);
  const bytes = Buffer.from(JSON.stringify(source, null, 2) + '\n', 'utf8');
  // Reuse the already-merged inspector; reject invalid/oversize captures
  // BEFORE persisting. Inspecting is not payment verification.
  const report = inspectBytes(bytes);
  writeFileSync(options.out, bytes, { flag: 'wx', mode: 0o600 });
  return {
    originalCapture: options.out,
    capturedSha256: report.capturedSha256,
    collectedAtUtc: source.collectedAtUtc,
    httpStatus: report.httpStatus,
    classification: report.classification,
    x402: { status: report.x402.status, optionCount: report.x402.offer?.optionCount ?? 0, error: report.x402.error },
    mpp: { status: report.mpp.status, challengeCount: report.mpp.challenges.length, error: report.mpp.error },
    review: report.review,
    // Never echo untrusted encoded payment payloads, caller URLs or server fields.
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run(process.argv.slice(2)).then(summary => {
    console.log(JSON.stringify(summary, null, 2));
  }).catch(error => {
    console.error(`SF85_CAPTURE_ERROR: ${error instanceof CaptureError ? error.code : (error.code ?? 'HTTPS_OR_FILE_ERROR')}`);
    process.exitCode = 2;
  });
}
