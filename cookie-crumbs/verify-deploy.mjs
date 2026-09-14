import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const SOURCE = Object.freeze({
  repository: 'woahwhattheheck/public-commons-sprint-2026',
  commit: '446b66260e35535b35b3d68becf4c7f3462e60b0',
  directory: 'cookie-crumbs',
});

export const FILE_CONTRACT = Object.freeze({
  'index.html': Object.freeze({
    gitBlobSha1: 'af4d1a0ce8ae835092d480c319f2ba2234bf97a4',
    mediaTypes: Object.freeze(['text/html']),
    markers: Object.freeze([
      '<title>Cookie Crumbs',
      'id="connect-wallet"',
      'href="./styles.css"',
      'src="./app.js"',
    ]),
  }),
  'app.js': Object.freeze({
    gitBlobSha1: '31e2ca50c8d02a4f0bd390687337835c45d65d27',
    mediaTypes: Object.freeze(['application/javascript', 'text/javascript', 'application/x-javascript']),
    markers: Object.freeze([
      "from './receipt.mjs'",
      'https://rpc.cookiescan.io',
      'window.nightly?.solana',
      'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
    ]),
  }),
  'receipt.mjs': Object.freeze({
    gitBlobSha1: 'befbf85080201ed458b1555bf77442f85fcfe442',
    mediaTypes: Object.freeze(['application/javascript', 'text/javascript', 'application/x-javascript']),
    markers: Object.freeze([
      "cookie-crumbs:v1",
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

  if (!['http:', 'https:'].includes(url.protocol)) {
    fail('INVALID_PROTOCOL', 'Deployment URL must use HTTP or HTTPS.', { protocol: url.protocol });
  }
  if (url.username || url.password) {
    fail('CREDENTIALS_FORBIDDEN', 'Deployment URL must not contain embedded credentials.');
  }

  url.hash = '';
  url.search = '';
  if (url.pathname.endsWith('/index.html')) {
    url.pathname = url.pathname.slice(0, -'index.html'.length);
  } else if (!url.pathname.endsWith('/')) {
    url.pathname += '/';
  }
  return url;
}

function mediaTypeOf(headerValue) {
  return String(headerValue ?? '').split(';', 1)[0].trim().toLowerCase();
}

export function gitBlobSha1(bytes) {
  const body = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const header = Buffer.from(`blob ${body.byteLength}\0`, 'utf8');
  return createHash('sha1').update(header).update(body).digest('hex');
}

async function readBodyLimited(response, maxBytes, path) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    fail('BODY_TOO_LARGE', `${path} exceeds the deployment verifier byte limit.`, {
      path,
      declaredLength,
      maxBytes,
    });
  }

  if (!response.body) {
    return new Uint8Array(await response.arrayBuffer());
  }

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
        fail('BODY_TOO_LARGE', `${path} exceeds the deployment verifier byte limit.`, {
          path,
          observedLength: total,
          maxBytes,
        });
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

async function fetchContractFile(baseUrl, path, contract, options) {
  const requestedUrl = new URL(path, baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  let response;
  try {
    response = await options.fetchImpl(requestedUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        accept: contract.mediaTypes.join(', '),
        'user-agent': 'cookie-crumbs-deployment-verifier/1',
      },
    });
  } catch (error) {
    const code = error?.name === 'AbortError' ? 'FETCH_TIMEOUT' : 'FETCH_FAILED';
    fail(code, `Unable to fetch ${path}.`, {
      path,
      requestedUrl: requestedUrl.href,
      cause: String(error?.message ?? error),
    });
  } finally {
    clearTimeout(timer);
  }

  if (response.status !== 200) {
    fail('HTTP_STATUS', `${path} returned HTTP ${response.status}; expected 200.`, {
      path,
      requestedUrl: requestedUrl.href,
      finalUrl: response.url || requestedUrl.href,
      status: response.status,
    });
  }

  const contentType = response.headers.get('content-type') ?? '';
  const mediaType = mediaTypeOf(contentType);
  if (!contract.mediaTypes.includes(mediaType)) {
    fail('CONTENT_TYPE_MISMATCH', `${path} has an unsafe or incorrect Content-Type.`, {
      path,
      contentType,
      expected: contract.mediaTypes,
    });
  }

  const bytes = await readBodyLimited(response, options.maxBytes, path);
  const observedGitBlobSha1 = gitBlobSha1(bytes);
  if (contract.gitBlobSha1 && observedGitBlobSha1 !== contract.gitBlobSha1) {
    fail('SOURCE_BLOB_MISMATCH', `${path} does not match the source-bound Git blob.`, {
      path,
      expectedGitBlobSha1: contract.gitBlobSha1,
      observedGitBlobSha1,
    });
  }

  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    fail('INVALID_UTF8', `${path} is not valid UTF-8.`, { path, cause: error.message });
  }

  for (const marker of contract.markers) {
    if (!text.includes(marker)) {
      fail('MARKER_MISSING', `${path} is missing a required source marker.`, { path, marker });
    }
  }

  return Object.freeze({
    path,
    requestedUrl: requestedUrl.href,
    finalUrl: response.url || requestedUrl.href,
    status: response.status,
    contentType,
    bytes: bytes.byteLength,
    expectedGitBlobSha1: contract.gitBlobSha1 ?? null,
    observedGitBlobSha1,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}

export async function verifyDeployment(input, options = {}) {
  const baseUrl = normalizeBaseUrl(input);
  const timeoutMs = Number(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxBytes = Number(options.maxBytes ?? DEFAULT_MAX_BYTES);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const fileContract = options.fileContract ?? FILE_CONTRACT;

  if (typeof fetchImpl !== 'function') {
    fail('FETCH_UNAVAILABLE', 'This verifier requires a standards-compatible fetch implementation.');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    fail('INVALID_TIMEOUT', 'timeoutMs must be an integer between 1 and 120000.', { timeoutMs });
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 20_000_000) {
    fail('INVALID_MAX_BYTES', 'maxBytes must be an integer between 1 and 20000000.', { maxBytes });
  }

  if (!fileContract || typeof fileContract !== 'object' || Array.isArray(fileContract)) {
    fail('INVALID_FILE_CONTRACT', 'fileContract must be an object keyed by deployment path.');
  }

  const files = [];
  for (const [path, contract] of Object.entries(fileContract)) {
    files.push(await fetchContractFile(baseUrl, path, contract, { timeoutMs, maxBytes, fetchImpl }));
  }

  const checkedAtValue = now();
  const checkedAt = checkedAtValue instanceof Date ? checkedAtValue : new Date(checkedAtValue);
  if (Number.isNaN(checkedAt.getTime())) {
    fail('INVALID_CLOCK', 'Verifier clock returned an invalid timestamp.');
  }

  return Object.freeze({
    schema: 'cookie-crumbs/deployment-receipt/v1',
    ok: true,
    checkedAt: checkedAt.toISOString(),
    baseUrl: baseUrl.href,
    source: SOURCE,
    files: Object.freeze(files),
  });
}

function usage() {
  return [
    'Usage: node verify-deploy.mjs <deployment-base-url> [options]',
    '',
    'Options:',
    '  --out <path>          Write the successful JSON receipt to a file.',
    '  --timeout-ms <n>      Per-request timeout (default: 15000).',
    '  --max-bytes <n>       Per-file byte limit (default: 1000000).',
    '  --help                Show this help.',
  ].join('\n');
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
    const serialized = {
      schema: 'cookie-crumbs/deployment-error/v1',
      ok: false,
      error: {
        name: error?.name ?? 'Error',
        code: error?.code ?? 'UNEXPECTED_ERROR',
        message: String(error?.message ?? error),
        details: error?.details ?? {},
      },
    };
    process.stderr.write(`${JSON.stringify(serialized, null, 2)}\n`);
    process.exitCode = 1;
  }
}

const invokedAsScript = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) await main();
