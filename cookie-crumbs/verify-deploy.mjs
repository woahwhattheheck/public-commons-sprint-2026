import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const SOURCE = Object.freeze({
  repository: 'woahwhattheheck/public-commons-sprint-2026',
  directory: 'cookie-crumbs',
  generation: 'cookie-crumbs/source-hardening-v2',
});

export const VENDOR_CONTRACT = Object.freeze({
  lockPath: 'vendor-lock.json',
  bundlePath: 'vendor/solana-web3.iife.min.js',
  package: '@solana/web3.js@1.98.4',
  tarballSha512: 'beff657e7be352c462abfffe8f9a417578a0d0841db730340516776d710fe0a688c85d4271ac9d5aa832cd081f64c348b16356986f80507c0fcb8007383ea0a7',
});

export const FILE_CONTRACT = Object.freeze({
  'index.html': Object.freeze({
    gitBlobSha1: '066cda664bc1e317beaf62bd6530605f54aba60d',
    mediaTypes: Object.freeze(['text/html']),
    markers: Object.freeze([
      '<title>Cookie Crumbs',
      'id="connect-wallet"',
      'Content-Security-Policy',
      "script-src 'self'",
      'src="./vendor/solana-web3.iife.min.js"',
      'src="./app.js"',
    ]),
  }),
  'app.js': Object.freeze({
    gitBlobSha1: '36abb9290cc4693ddcf81ac7c6d1d895a1e580f5',
    mediaTypes: Object.freeze(['application/javascript', 'text/javascript', 'application/x-javascript']),
    markers: Object.freeze([
      "from './receipt.mjs'",
      "from './provenance.mjs'",
      'https://rpc.cookiescan.io',
      'window.nightly?.solana',
      'transactionSignedBy(tx, expectedSigner)',
      'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
    ]),
  }),
  'provenance.mjs': Object.freeze({
    gitBlobSha1: '8d6691b4b5002f963c42076fead68d9f1b6ecdc5',
    mediaTypes: Object.freeze(['application/javascript', 'text/javascript', 'application/x-javascript']),
    markers: Object.freeze([
      'transactionSignedBy',
      'entry.signer !== true',
      'publicKeyText(entry.pubkey) === expected',
    ]),
  }),
  'receipt.mjs': Object.freeze({
    gitBlobSha1: 'befbf85080201ed458b1555bf77442f85fcfe442',
    mediaTypes: Object.freeze(['application/javascript', 'text/javascript', 'application/x-javascript']),
    markers: Object.freeze([
      'cookie-crumbs:v1',
      'MAX_MEMO_BYTES = 480',
      'Duplicate Cookie Crumbs field',
    ]),
  }),
  'styles.css': Object.freeze({
    gitBlobSha1: '63e8dbc8c6c7cb4efea6dfc2a7135cff435c3d74',
    mediaTypes: Object.freeze(['text/css']),
    markers: Object.freeze([
      '.wallet-card, .panel',
      '@media (max-width: 760px)',
    ]),
  }),
});

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 1_000_000;

export class DeploymentVerificationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DeploymentVerificationError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new DeploymentVerificationError(code, message, details);
}

export function normalizeBaseUrl(input) {
  let url;
  try {
    url = new URL(String(input));
  } catch (error) {
    fail('INVALID_URL', 'Deployment URL must be an absolute HTTP(S) URL.', { input: String(input), cause: error.message });
  }
  if (!['http:', 'https:'].includes(url.protocol)) fail('INVALID_PROTOCOL', 'Deployment URL must use HTTP or HTTPS.', { protocol: url.protocol });
  if (url.username || url.password) fail('CREDENTIALS_FORBIDDEN', 'Deployment URL must not contain embedded credentials.');
  url.hash = '';
  url.search = '';
  if (url.pathname.endsWith('/index.html')) url.pathname = url.pathname.slice(0, -'index.html'.length);
  else if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

function mediaTypeOf(value) {
  return String(value ?? '').split(';', 1)[0].trim().toLowerCase();
}

export function gitBlobSha1(bytes) {
  const body = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return createHash('sha1').update(Buffer.from(`blob ${body.byteLength}\0`, 'utf8')).update(body).digest('hex');
}

async function readBodyLimited(response, maxBytes, path) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) fail('BODY_TOO_LARGE', `${path} exceeds the deployment verifier byte limit.`, { path, declaredLength: declared, maxBytes });
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('deployment verifier byte limit exceeded');
        fail('BODY_TOO_LARGE', `${path} exceeds the deployment verifier byte limit.`, { path, observedLength: total, maxBytes });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function fetchBytes(baseUrl, path, mediaTypes, options) {
  const requestedUrl = new URL(path, baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  let response;
  try {
    response = await options.fetchImpl(requestedUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { accept: mediaTypes.join(', '), 'user-agent': 'cookie-crumbs-deployment-verifier/2' },
    });
  } catch (error) {
    fail(error?.name === 'AbortError' ? 'FETCH_TIMEOUT' : 'FETCH_FAILED', `Unable to fetch ${path}.`, { path, requestedUrl: requestedUrl.href, cause: String(error?.message ?? error) });
  } finally {
    clearTimeout(timer);
  }
  if (response.status !== 200) fail('HTTP_STATUS', `${path} returned HTTP ${response.status}; expected 200.`, { path, status: response.status });
  const contentType = response.headers.get('content-type') ?? '';
  const mediaType = mediaTypeOf(contentType);
  if (!mediaTypes.includes(mediaType)) fail('CONTENT_TYPE_MISMATCH', `${path} has an unsafe or incorrect Content-Type.`, { path, contentType, expected: mediaTypes });
  const bytes = await readBodyLimited(response, options.maxBytes, path);
  return { path, requestedUrl: requestedUrl.href, finalUrl: response.url || requestedUrl.href, status: response.status, contentType, bytes };
}

function decodeUtf8(bytes, path) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    fail('INVALID_UTF8', `${path} is not valid UTF-8.`, { path, cause: error.message });
  }
}

async function fetchContractFile(baseUrl, path, contract, options) {
  const fetched = await fetchBytes(baseUrl, path, contract.mediaTypes, options);
  const observedGitBlobSha1 = gitBlobSha1(fetched.bytes);
  if (observedGitBlobSha1 !== contract.gitBlobSha1) {
    fail('SOURCE_BLOB_MISMATCH', `${path} does not match the source-bound Git blob.`, { path, expectedGitBlobSha1: contract.gitBlobSha1, observedGitBlobSha1 });
  }
  const text = decodeUtf8(fetched.bytes, path);
  for (const marker of contract.markers) if (!text.includes(marker)) fail('MARKER_MISSING', `${path} is missing a required source marker.`, { path, marker });
  return Object.freeze({
    path,
    requestedUrl: fetched.requestedUrl,
    finalUrl: fetched.finalUrl,
    status: fetched.status,
    contentType: fetched.contentType,
    bytes: fetched.bytes.byteLength,
    expectedGitBlobSha1: contract.gitBlobSha1,
    observedGitBlobSha1,
    sha256: createHash('sha256').update(fetched.bytes).digest('hex'),
  });
}

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const got = Object.keys(value).sort();
  const expected = [...keys].sort();
  return got.length === expected.length && got.every((key, index) => key === expected[index]);
}

async function verifyVendor(baseUrl, options) {
  const lockFetch = await fetchBytes(baseUrl, VENDOR_CONTRACT.lockPath, ['application/json', 'text/json'], options);
  let lock;
  try {
    lock = JSON.parse(decodeUtf8(lockFetch.bytes, VENDOR_CONTRACT.lockPath));
  } catch (error) {
    fail('VENDOR_LOCK_INVALID', 'vendor-lock.json is not valid JSON.', { cause: error.message });
  }
  const keys = ['schema', 'package', 'tarballSha512', 'bundlePath', 'bundleBytes', 'bundleSri'];
  if (!exactKeys(lock, keys) || lock.schema !== 'cookie-crumbs/vendor-lock/v1') fail('VENDOR_LOCK_SHAPE', 'Vendor lock does not match the expected closed schema.');
  if (lock.package !== VENDOR_CONTRACT.package || lock.tarballSha512 !== VENDOR_CONTRACT.tarballSha512 || lock.bundlePath !== VENDOR_CONTRACT.bundlePath) {
    fail('VENDOR_SOURCE_MISMATCH', 'Vendor lock is not bound to the approved package generation.', { observed: lock });
  }
  if (!Number.isSafeInteger(lock.bundleBytes) || lock.bundleBytes < 100_000 || lock.bundleBytes > options.maxBytes) fail('VENDOR_SIZE_INVALID', 'Vendor bundle size is outside the expected range.', { bundleBytes: lock.bundleBytes });
  if (typeof lock.bundleSri !== 'string' || !/^sha384-[A-Za-z0-9+/]+={0,2}$/.test(lock.bundleSri)) fail('VENDOR_SRI_INVALID', 'Vendor lock has an invalid SHA-384 SRI value.');

  const bundle = await fetchBytes(baseUrl, VENDOR_CONTRACT.bundlePath, ['application/javascript', 'text/javascript', 'application/x-javascript'], options);
  if (bundle.bytes.byteLength !== lock.bundleBytes) fail('VENDOR_SIZE_MISMATCH', 'Served vendor bundle size does not match the build lock.', { expected: lock.bundleBytes, observed: bundle.bytes.byteLength });
  const observedSri = `sha384-${createHash('sha384').update(bundle.bytes).digest('base64')}`;
  if (observedSri !== lock.bundleSri) fail('VENDOR_SRI_MISMATCH', 'Served vendor bundle does not match the build lock.', { expected: lock.bundleSri, observed: observedSri });
  const prefix = decodeUtf8(bundle.bytes.slice(0, Math.min(bundle.bytes.byteLength, 96)), VENDOR_CONTRACT.bundlePath);
  if (!prefix.includes('solanaWeb3')) fail('VENDOR_MARKER_MISSING', 'Served vendor bundle is not the expected Solana browser bundle.');

  return Object.freeze({
    package: lock.package,
    tarballSha512: lock.tarballSha512,
    path: VENDOR_CONTRACT.bundlePath,
    bytes: bundle.bytes.byteLength,
    sri: observedSri,
    sha256: createHash('sha256').update(bundle.bytes).digest('hex'),
  });
}

export async function verifyDeployment(input, options = {}) {
  const baseUrl = normalizeBaseUrl(input);
  const timeoutMs = Number(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxBytes = Number(options.maxBytes ?? DEFAULT_MAX_BYTES);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const fileContract = options.fileContract ?? FILE_CONTRACT;
  if (typeof fetchImpl !== 'function') fail('FETCH_UNAVAILABLE', 'This verifier requires a standards-compatible fetch implementation.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) fail('INVALID_TIMEOUT', 'timeoutMs must be an integer between 1 and 120000.', { timeoutMs });
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 20_000_000) fail('INVALID_MAX_BYTES', 'maxBytes must be an integer between 1 and 20000000.', { maxBytes });
  if (!fileContract || typeof fileContract !== 'object' || Array.isArray(fileContract)) fail('INVALID_FILE_CONTRACT', 'fileContract must be an object keyed by deployment path.');

  const fetchOptions = { timeoutMs, maxBytes, fetchImpl };
  const files = [];
  for (const [path, contract] of Object.entries(fileContract)) files.push(await fetchContractFile(baseUrl, path, contract, fetchOptions));
  const vendor = await verifyVendor(baseUrl, fetchOptions);

  const checkedAtValue = now();
  const checkedAt = checkedAtValue instanceof Date ? checkedAtValue : new Date(checkedAtValue);
  if (Number.isNaN(checkedAt.getTime())) fail('INVALID_CLOCK', 'Verifier clock returned an invalid timestamp.');
  return Object.freeze({ schema: 'cookie-crumbs/deployment-receipt/v2', ok: true, checkedAt: checkedAt.toISOString(), baseUrl: baseUrl.href, source: SOURCE, files: Object.freeze(files), vendor });
}

function usage() {
  return ['Usage: node verify-deploy.mjs <deployment-base-url> [options]', '', 'Options:', '  --out <path>          Write the successful JSON receipt to a file.', '  --timeout-ms <n>      Per-request timeout (default: 15000).', '  --max-bytes <n>       Per-file byte limit (default: 1000000).', '  --help                Show this help.'].join('\n');
}

function parseArgs(argv) {
  const parsed = { url: null, out: null, timeoutMs: DEFAULT_TIMEOUT_MS, maxBytes: DEFAULT_MAX_BYTES };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help') return { help: true };
    if (arg === '--out' || arg === '--timeout-ms' || arg === '--max-bytes') {
      const value = argv[index + 1];
      if (value === undefined) fail('CLI_ARGUMENT', `${arg} requires a value.`);
      index += 1;
      if (arg === '--out') parsed.out = value;
      if (arg === '--timeout-ms') parsed.timeoutMs = Number(value);
      if (arg === '--max-bytes') parsed.maxBytes = Number(value);
      continue;
    }
    if (arg.startsWith('--')) fail('CLI_ARGUMENT', `Unknown option: ${arg}`);
    if (parsed.url !== null) fail('CLI_ARGUMENT', 'Only one deployment URL may be supplied.');
    parsed.url = arg;
  }
  if (!parsed.url) fail('CLI_ARGUMENT', 'A deployment base URL is required.');
  return parsed;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    const receipt = await verifyDeployment(args.url, args);
    const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
    if (args.out) await writeFile(args.out, serialized, { encoding: 'utf8', flag: 'w' });
    process.stdout.write(serialized);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ schema: 'cookie-crumbs/deployment-error/v2', ok: false, error: { name: error?.name ?? 'Error', code: error?.code ?? 'UNEXPECTED_ERROR', message: String(error?.message ?? error), details: error?.details ?? {} } }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

const invokedAsScript = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) await main();
