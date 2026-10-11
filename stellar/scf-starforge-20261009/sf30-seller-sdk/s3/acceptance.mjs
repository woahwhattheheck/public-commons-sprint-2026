// MIT. One focused integration: official AWS SDK on loopback + ORIGINAL SF30 service.
// The local object endpoint is a controlled S3 HTTP fixture, not Amazon/MinIO or chain settlement.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createS3ObjectSource } from './source.mjs';
import { configureS3Seller } from './cli.mjs';

const sha = data => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
const encode = text => encodeURIComponent(text).replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase());
const secret = randomBytes(32).toString('hex'), access = 'LOCAL_SF30_ACCEPTANCE';
function signed(req, url) {
  const match = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/([^,]+), SignedHeaders=([^,]+), Signature=([a-f0-9]+)$/.exec(req.headers.authorization ?? '');
  if (!match || match[1] !== access) return false;
  const scope = match[2].split('/'), headerNames = match[3].split(';');
  const headers = headerNames.map(key => key + ':' + String(req.headers[key] ?? '').trim().replace(/\s+/g, ' ') + '\n').join('');
  const query = [...url.searchParams].map(([key, value]) => [encode(key), encode(value)])
    .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)
    .map(pair => pair.join('=')).join('&');
  const canonical = [req.method, url.pathname, query, headers, match[3], req.headers['x-amz-content-sha256']].join('\n');
  const string = ['AWS4-HMAC-SHA256', req.headers['x-amz-date'], match[2], sha(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac('AWS4' + secret, scope[0]), scope[1]), scope[2]), scope[3]);
  return hmac(key, string).toString('hex') === match[4];
}

const original = Buffer.from('%PDF-1.7\nmerchant-approved example\n'), archive = randomBytes(1843229);
const assets = new Map([
  ['exports/report one.pdf', { body: original }], ['exports/archive.zip', { body: archive }],
  ['exports/mutable', { body: Buffer.from('before') }], ['exports/versioned', { body: Buffer.from('version-one'), version: 'v1' }],
  ['exports/slow', { body: Buffer.from('slow content'), slow: true }],
]);
const versions = new Map([['v1', Buffer.from('version-one')]]), calls = []; let signedReads = 0;
const endpoint = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (!signed(req, url)) { res.writeHead(403); res.end('<Error><Code>AccessDenied</Code></Error>'); return; }
  signedReads++;
  const key = decodeURIComponent(url.pathname).replace(/^\/merchant-objects\//, ''), asset = assets.get(key);
  calls.push({ method: req.method, key, range: req.headers.range, version: url.searchParams.get('versionId') });
  if (!asset || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404); res.end(); return; }
  const version = url.searchParams.get('versionId') ?? asset.version;
  const body = version ? versions.get(version) : asset.body;
  if (!body) { res.writeHead(404); res.end(); return; }
  const etag = '"' + createHash('md5').update(body).digest('hex') + '"';
  if (req.headers['if-match'] && req.headers['if-match'] !== etag) {
    res.writeHead(412, { 'content-type': 'application/xml' });
    res.end('<Error><Code>PreconditionFailed</Code></Error>'); return;
  }
  let selected = body, contentRange;
  if (req.headers.range) {
    const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range);
    if (!range || Number(range[1]) >= body.length) { res.writeHead(416); res.end(); return; }
    const start = Number(range[1]), end = Math.min(Number(range[2]), body.length - 1);
    selected = body.subarray(start, end + 1); contentRange = `bytes ${start}-${end}/${body.length}`;
  }
  res.writeHead(contentRange ? 206 : 200, { etag, 'content-length': String(selected.length),
    'content-type': 'application/octet-stream', ...(version ? { 'x-amz-version-id': version } : {}),
    ...(contentRange ? { 'content-range': contentRange } : {}) });
  if (req.method === 'HEAD') { res.end(); return; }
  if (asset.slow) {
    res.flushHeaders();
    const timer = setTimeout(() => res.end(selected), 1000);
    res.once('close', () => clearTimeout(timer));
  } else res.end(selected);
});
await new Promise(resolve => endpoint.listen(0, '127.0.0.1', resolve));
const env = { ...process.env, AWS_ACCESS_KEY_ID: access, AWS_SECRET_ACCESS_KEY: secret, AWS_SESSION_TOKEN: '' };
const config = { schema: 'stellar-forge.s3-source.v1', region: 'us-east-1', bucket: 'merchant-objects',
  endpoint: `http://127.0.0.1:${endpoint.address().port}`, allowLocalEndpoint: true,
  forcePathStyle: true, credentialProvider: 'environment', timeoutMs: 300, maxInFlight: 1,
  objects: [
    { id: 'report', path: '/report', key: 'exports/report one.pdf', contentType: 'application/pdf', filename: 'report.pdf', sha256: sha(original) },
    { id: 'archive', path: '/archive', key: 'exports/archive.zip', mode: 'chunks', maxBytes: 921600 },
    { id: 'mutable', path: '/mutable', key: 'exports/mutable' },
    { id: 'versioned', path: '/versioned', key: 'exports/versioned' },
    { id: 'slow', path: '/slow', key: 'exports/slow' },
  ] };
const context = (query = {}, headers = {}) => ({ method: 'GET', query, headers, body: null });
const root = await mkdtemp(join(tmpdir(), 'sf30-s3-')); let source, child;
try {
  source = await createS3ObjectSource(config, { env });
  const report = await source.route('report').handler(context());
  assert.equal(report.status, 200); assert.deepEqual(report.body, original);
  assert.equal(report.headers['x-content-sha256'], sha(original));
  const parts = []; let offset = 0;
  while (offset < archive.length) {
    const part = await source.route('archive').handler(context({ offset: String(offset), length: '921600' }));
    assert.equal(part.status, 206); assert.equal(part.headers['x-content-sha256'], sha(part.body));
    parts.push(part.body); offset += part.body.length;
  }
  assert.deepEqual(Buffer.concat(parts), archive);
  const getsBeforeInvalid = calls.filter(call => call.method === 'GET').length;
  assert.equal(source.route('archive').admit(context({ length: '1048577' })).status, 413);
  assert.equal(source.route('archive').admit(context({ offset: String(archive.length) })).status, 416);
  assert.equal(source.route('report').admit(context({}, { range: 'bytes=0-1' })).status, 400);
  assert.equal(calls.filter(call => call.method === 'GET').length, getsBeforeInvalid);
  assets.get('exports/mutable').body = Buffer.from('changed');
  assert.equal((await source.route('mutable').handler(context())).status, 409);
  assets.get('exports/mutable').body = Buffer.from('before');
  versions.set('v2', Buffer.from('version-two')); assets.get('exports/versioned').version = 'v2';
  assert.equal((await source.route('versioned').handler(context())).body.toString(), 'version-one');
  const slow = source.route('slow').handler(context());
  assert.equal(source.route('report').admit(context()).status, 429);
  assert.equal((await slow).body.error, 'S3_REQUEST_TIMEOUT');

  const sourcePath = join(root, 'source.json');
  await writeFile(sourcePath, JSON.stringify(config), { mode: 0o600 });
  const payment = { scheme: 'exact', network: 'stellar:testnet', amount: '1000',
    asset: 'UNVERIFIED_LOCAL_ASSET', payTo: 'UNVERIFIED_LOCAL_RECIPIENT', maxTimeoutSeconds: 60 };
  const setup = await configureS3Seller({ sourcePath, source, payment,
    origin: 'https://objects.example', directory: join(root, 'seller') });
  const service = JSON.parse(await readFile(setup.service, 'utf8'));
  assert.equal(service.routes[0].offer.resource.mimeType, 'application/pdf');
  assert.equal(service.routes[0].offer.extensions.bazaar.info.output, undefined);
  const beforeChallenge = calls.filter(call => call.method === 'GET').length;
  child = spawn(process.execPath, [...setup.sellerCommand.slice(1), '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const started = await new Promise((resolve, reject) => {
    let stdout = '', stderr = '';
    const timer = setTimeout(() => reject(new Error('Original seller startup deadline')), 10000);
    child.stderr.on('data', bytes => { stderr += bytes.toString(); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Original seller exited ${code}: ${stderr}`)); });
    child.stdout.on('data', bytes => {
      stdout += bytes.toString(); const end = stdout.indexOf('\n');
      if (end >= 0) { clearTimeout(timer); try { resolve(JSON.parse(stdout.slice(0, end))); } catch (error) { reject(error); } }
    });
  });
  const challenge = await fetch(started.url + '/archive?offset=0&length=921600');
  assert.equal(challenge.status, 402);
  const terms = JSON.parse(Buffer.from(challenge.headers.get('payment-required'), 'base64').toString());
  assert.equal(terms.resource.url, 'https://objects.example/archive?offset=0&length=921600');
  assert.equal(calls.filter(call => call.method === 'GET').length, beforeChallenge);
  assert.equal((await fetch(started.url + '/_seller/health')).status, 200);
  assert.equal(signedReads, calls.length);
  process.stdout.write(JSON.stringify({ status: 'PASS', node: process.version, awsSdk: '3.1149.0',
    signedS3Reads: signedReads, reconstructedBytes: archive.length, wholeBytes: original.length,
    checks: ['official SigV4 HTTP', 'whole-file digest', 'three-chunk reassembly', 'preflight limits',
      'unversioned replacement refused', 'pinned old version', 'capacity and timeout',
      'generated original SF30 service', 'payment-bound query', 'HTTP402 with no object GET'],
    scope: 'Controlled loopback object fixture and original seller; no cloud account or payment' }) + '\n');
} finally {
  source?.close();
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    const kill = setTimeout(() => child.kill('SIGKILL'), 3000);
    await once(child, 'exit'); clearTimeout(kill);
  }
  endpoint.closeAllConnections(); await new Promise(resolve => endpoint.close(resolve));
  await rm(root, { recursive: true, force: true });
}
