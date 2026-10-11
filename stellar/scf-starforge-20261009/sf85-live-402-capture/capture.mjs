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
// A few managed cloud runtimes resolve *public* hosts to an OS-owned
// 198.18/15 HTTPS egress gateway. Never trust it implicitly: a caller
// must approve the exact returned gateway address for this one request.
const gatewaySubnet = new BlockList();
gatewaySubnet.addSubnet('198.18.0.0', 15, 'ipv4');
const benchmarkGatewayV4 = (address) =>
  isIP(address) === 4 && gatewaySubnet.check(address, 'ipv4');
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
  const allowed = new Set(['--url', '--allow-origin', '--out', '--method', '--timeout-ms', '--egress-gateway-ip']);
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
  const egressGatewayIP = args.get('--egress-gateway-ip') ?? null;
  if (egressGatewayIP !== null && !benchmarkGatewayV4(egressGatewayIP)) {
    throw new CaptureError('EGRESS_GATEWAY_MUST_BE_BENCHMARK_IPV4');
  }
  const out = args.get('--out');
  if (!isAbsolute(out) || out.includes('\0')) throw new CaptureError('OUTPUT_MUST_BE_ABSOLUTE_PATH');
  return { target, out, method, timeout, egressGatewayIP };
}

export async function capture({ target, method, timeout, egressGatewayIP = null }, { resolve = lookup, httpsRequest = request } = {}) {
  // Resolve the ORIGINAL hostname once. Reject mixed internal/public answers and pin
  // a public IPv4 into the TLS connection, preventing later DNS rebinding.
  let answers;
  try { answers = await resolve(target.hostname, { family: 4, all: true }); }
  catch { throw new CaptureError('PUBLIC_IPV4_RESOLUTION_FAILED'); }
  if (!Array.isArray(answers) || answers.length === 0 ||
      answers.some(a => a.family !== 4 || isIP(a.address) !== 4)) {
    throw new CaptureError('DNS_HAS_NONPUBLIC_OR_NO_IPV4');
  }
  if (egressGatewayIP === null) {
    if (answers.some(a => !publicV4(a.address))) throw new CaptureError('DNS_HAS_NONPUBLIC_OR_NO_IPV4');
  } else {
    if (!benchmarkGatewayV4(egressGatewayIP)) throw new CaptureError('EGRESS_GATEWAY_MUST_BE_BENCHMARK_IPV4');
    // A single *exact* OS DNS result, not a replacement address or a
    // broad private-range exception. A mixed result still fails closed.
    if (answers.length !== 1 || answers[0].address !== egressGatewayIP) {
      throw new CaptureError('EGRESS_GATEWAY_DNS_MISMATCH');
    }
  }
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
