// MIT. SF102: portable recovery for the existing SF30 static Stellar x402 seller.
// Runs offline except explicit loopback-only live-vs-standby offer comparison.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, realpath, stat, lstat, readdir, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA = 'stellar-forge.sf102.seller-recovery.v1';
const CONFIG_SCHEMA = 'stellar-forge.seller-service.v1';
const MAX_CONFIG = 1024 * 1024, MAX_ASSET = 1024 * 1024, MAX_REMOTE = 2 * 1024 * 1024;
const LIMIT_ROUTES = 64;
const own = (x, k) => Object.prototype.hasOwnProperty.call(x, k);
const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const utf8 = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const stable = x => JSON.stringify(x, (_, v) => obj(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const bad = message => { throw new Error(message); };
const usage = `Usage:
  node recovery.mjs pack --config ORIGINAL/seller.json --out NEW_PRIVATE_BUNDLE
  node recovery.mjs verify --bundle EXISTING_BUNDLE
  node recovery.mjs restore --bundle EXISTING_BUNDLE --to NEW_PRIVATE_DIRECTORY
  node recovery.mjs probe --bundle EXISTING_BUNDLE --current http://127.0.0.1:PORT --standby http://127.0.0.1:PORT

Works with existing SF30 static inline JSON and responseFile JSON routes. Full payment
identity and publicOrigin remain unchanged. Live probe compares the ORIGINAL seller
/_seller/offers and /_seller/health on two loopback hosts; it sends no paid request.
Dynamic handler routes need their original application code and are deliberately not packaged.`;

function argumentsOf(args) {
  const [command, ...rest] = args;
  if (command === '--help' || !command) return { command: 'help', options: {} };
  if (!['pack', 'verify', 'restore', 'probe'].includes(command)) bad(usage);
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!/^--[a-z-]+$/.test(rest[i]) || options[rest[i]] !== undefined || !rest[i + 1] || rest[i + 1].startsWith('--')) bad(usage);
    options[rest[i]] = rest[i + 1];
  }
  const allowed = {
    pack: ['--config', '--out'], verify: ['--bundle'],
    restore: ['--bundle', '--to'], probe: ['--bundle', '--current', '--standby'],
  }[command];
  if (Object.keys(options).length !== allowed.length || allowed.some(k => !options[k]) ||
      Object.keys(options).some(k => !allowed.includes(k))) bad(usage);
  return { command, options };
}

async function regularBytes(path, max) {
  const link = await lstat(path);
  if (!link.isFile() || link.isSymbolicLink() || link.size > max) bad(`Unsafe, missing or oversized regular file: ${path}`);
  const h = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const st = await h.stat();
    if (!st.isFile() || st.size > max) bad(`Changed or oversized file: ${path}`);
    const bytes = await h.readFile();
    if (bytes.length > max) bad(`Oversized file: ${path}`);
    return bytes;
  } finally { await h.close(); }
}
function parseJson(bytes, name) {
  try { return JSON.parse(utf8(bytes)); }
  catch { bad(`Invalid UTF-8 JSON in ${name}`); }
}
function validateConfig(config) {
  if (!obj(config) || config.schema !== CONFIG_SCHEMA || !Array.isArray(config.routes) ||
      !config.routes.length || config.routes.length > LIMIT_ROUTES) bad('Original SF30 seller-service.v1 config required');
  const ids = new Set();
  for (const route of config.routes) {
    if (!obj(route) || typeof route.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(route.id) ||
        ids.has(route.id) || typeof route.path !== 'string' || !route.path.startsWith('/') ||
        route.path.startsWith('/_seller/') ||
        (own(route, 'definition') === own(route, 'offer')) ||
        ['response', 'responseFile', 'handler'].filter(k => own(route, k)).length !== 1) bad('Unsupported or invalid SF30 route');
    if (own(route, 'handler')) bad(`Route ${route.id} uses an application handler; package its trusted app separately, not as a static snapshot`);
    ids.add(route.id);
  }
  if (config.publicOrigin !== undefined &&
      (typeof config.publicOrigin !== 'string' || !config.publicOrigin.startsWith('https://'))) bad('Invalid original publicOrigin');
  return config;
}
function safeDirName(path) {
  if (typeof path !== 'string' || !path || path === '.' || path === '..' || path.includes('/') || path.includes('\\')) bad('Invalid bundle member name');
  return path;
}
function isInside(root, path) {
  const rel = relative(root, path);
  return rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
async function createPrivateDir(dir) {
  await mkdir(dir, { recursive: false, mode: 0o700 });
  await mkdir(join(dir, 'assets'), { mode: 0o700 });
}
async function privateFile(path, bytes) {
  const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW || 0), 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
}
function routeBrief(config) {
  return config.routes.map(route => ({ id: route.id, path: route.path,
    method: (route.offer?.extensions?.bazaar?.info?.input?.method ?? route.definition?.method ?? null),
    paymentHash: hash(Buffer.from(stable(route.offer?.accepts?.[0] ?? route.definition?.payment ?? null))),
  }));
}

export async function pack(configPath, outputPath) {
  const source = resolve(configPath), root = await realpath(dirname(source)), dest = resolve(outputPath);
  if (isInside(root, dest) && dirname(dest) === root) { /* Creating a sibling private folder is fine. */ }
  if (dest === root || dest === source) bad('Bundle cannot replace its input');
  const raw = await regularBytes(source, MAX_CONFIG);
  const config = validateConfig(parseJson(raw, 'seller config'));
  const rebased = structuredClone(config), assets = [];
  const staged = new Map();
  for (const route of rebased.routes) {
    if (!own(route, 'responseFile')) continue;
    const file = route.responseFile;
    if (typeof file !== 'string' || !file) bad(`Missing responseFile for ${route.id}`);
    const absolute = resolve(root, file), original = await realpath(absolute);
    if (!isInside(root, original)) bad(`Route ${route.id} points outside the config directory: stage data inside this directory first`);
    const bytes = await regularBytes(absolute, MAX_ASSET);
    parseJson(bytes, route.id);
    const member = safeDirName(route.id) + '.json';
    const relativeFile = `assets/${member}`;
    route.responseFile = `./${relativeFile}`;
    staged.set(relativeFile, bytes);
    assets.push({ routeId: route.id, file: relativeFile, sha256: hash(bytes), bytes: bytes.length });
  }
  const sellerBytes = Buffer.from(JSON.stringify(rebased, null, 2) + '\n');
  if (sellerBytes.length > MAX_CONFIG) bad('Staged seller config too large');
  const manifest = {
    schema: SCHEMA, createdAt: new Date().toISOString(),
    sellerSchema: CONFIG_SCHEMA, originalConfigSha256: hash(raw),
    sellerConfigSha256: hash(sellerBytes), publicOrigin: config.publicOrigin ?? null,
    routes: routeBrief(config), assets,
    note: 'Only the original SF30 seller may validate/pay/settle. No wallet or facilitator state included.',
  };
  const entries = new Map([['seller.json', sellerBytes],
    ['manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n')], ...staged]);
  // Stage in a private adjacent temporary directory; creation is exclusive, never replace an existing target.
  await createPrivateDir(dest);
  try {
    for (const [member, bytes] of entries) await privateFile(join(dest, member), bytes);
  } catch (e) {
    await rm(dest, { recursive: true, force: true });
    throw e;
  }
  return { bundle: dest, routes: manifest.routes.length, assets: assets.length, configSha256: manifest.sellerConfigSha256 };
}

export async function verify(bundlePath) {
  const root = await realpath(resolve(bundlePath));
  if (!(await stat(root)).isDirectory()) bad('Bundle is not a directory');
  const manifest = parseJson(await regularBytes(join(root, 'manifest.json'), MAX_CONFIG), 'manifest');
  if (!obj(manifest) || manifest.schema !== SCHEMA || manifest.sellerSchema !== CONFIG_SCHEMA ||
      typeof manifest.sellerConfigSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.sellerConfigSha256) ||
      !Array.isArray(manifest.assets) || !Array.isArray(manifest.routes)) bad('Invalid SF102 manifest');
  const sellerBytes = await regularBytes(join(root, 'seller.json'), MAX_CONFIG);
  if (hash(sellerBytes) !== manifest.sellerConfigSha256) bad('Seller config hash mismatch');
  const config = validateConfig(parseJson(sellerBytes, 'seller.json'));
  if (stable(routeBrief(config)) !== stable(manifest.routes) ||
      (config.publicOrigin ?? null) !== manifest.publicOrigin) bad('Seller terms or route identity drift');
  if (!(await lstat(join(root, 'assets'))).isDirectory()) bad('Unsafe assets directory');
  const expected = new Set(['seller.json', 'manifest.json']), assetIds = new Set();
  for (const entry of manifest.assets) {
    if (!obj(entry) || typeof entry.routeId !== 'string' || assetIds.has(entry.routeId) ||
        typeof entry.file !== 'string' || entry.file !== `assets/${safeDirName(entry.routeId)}.json` ||
        !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '') || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > MAX_ASSET) bad('Invalid asset manifest');
    const route = config.routes.find(r => r.id === entry.routeId);
    if (!route || route.responseFile !== `./${entry.file}`) bad('Asset not bound to original route');
    assetIds.add(entry.routeId); expected.add(entry.file);
    const bytes = await regularBytes(join(root, entry.file), MAX_ASSET);
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) bad(`Dataset hash mismatch: ${entry.routeId}`);
    parseJson(bytes, entry.file);
  }
  for (const route of config.routes) {
    if (own(route, 'responseFile') && !assetIds.has(route.id)) bad(`Missing dataset for ${route.id}`);
  }
  // Explicitly refuse undeclared files/symlinks; otherwise an untrusted handoff could smuggle content.
  for (const file of await readdir(root)) {
    if (file === 'assets') continue;
    if (!expected.has(file)) bad(`Unexpected root member: ${file}`);
  }
  for (const file of await readdir(join(root, 'assets'))) {
    if (!expected.has(`assets/${file}`)) bad(`Unexpected asset: ${file}`);
  }
  return { root, manifest, config, routes: config.routes.length, assets: manifest.assets.length };
}

export async function restore(bundlePath, destPath) {
  const { root, manifest } = await verify(bundlePath), dest = resolve(destPath);
  if (dest === root || isInside(root, dest) || isInside(dest, root)) bad('Restore destination must be separate from bundle');
  await createPrivateDir(dest);
  try {
    await privateFile(join(dest, 'seller.json'), await regularBytes(join(root, 'seller.json'), MAX_CONFIG));
    for (const item of manifest.assets) await privateFile(join(dest, item.file), await regularBytes(join(root, item.file), MAX_ASSET));
    await privateFile(join(dest, 'RECOVERY-SOURCE.json'), Buffer.from(JSON.stringify({
      schema: 'stellar-forge.sf102.restored-source.v1',
      recoveredAt: new Date().toISOString(), sellerConfigSha256: manifest.sellerConfigSha256,
      note: 'Use the original SF30 server with this config. HTTPS proxy, facilitator, wallet and app deployment are managed separately.',
    }, null, 2) + '\n'));
  } catch (e) { await rm(dest, { recursive: true, force: true }); throw e; }
  return { restored: dest, config: join(dest, 'seller.json'), assets: manifest.assets.length,
    publicOrigin: manifest.publicOrigin };
}

function loopbackUrl(value) {
  const u = new URL(value);
  if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1' || !u.port || u.username || u.password ||
      u.pathname !== '/' || u.search || u.hash || u.origin !== value.replace(/\/$/, '')) bad('Only exact http://127.0.0.1:PORT loopback origins permitted');
  return u.origin;
}
async function getJson(origin, path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(origin + path, { redirect: 'manual', headers: { accept: 'application/json' }, signal: controller.signal });
    if (response.status !== 200 || !(response.headers.get('content-type') ?? '').includes('application/json')) bad(`Original seller ${path}: status/type mismatch`);
    if (Number(response.headers.get('content-length') || 0) > MAX_REMOTE) bad('Oversized original seller response');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_REMOTE) bad('Oversized original seller response');
    return parseJson(bytes, path);
  } finally { clearTimeout(timer); }
}
function simplifyHealth(health) {
  if (!obj(health) || typeof health.mode !== 'string' || !Array.isArray(health.routes)) bad('Invalid original SF30 health response');
  return { mode: health.mode, routes: health.routes.map(route => ({
    id: route.id, url: route.url, method: route.method,
  })).sort((a,b) => String(a.id).localeCompare(String(b.id))) };
}
export async function probe(bundlePath, currentUrl, standbyUrl) {
  const { config, manifest } = await verify(bundlePath);
  const current = loopbackUrl(currentUrl), standby = loopbackUrl(standbyUrl);
  if (current === standby) bad('Current and standby must be different listeners');
  const [aH, aO, bH, bO] = await Promise.all([
    getJson(current, '/_seller/health'), getJson(current, '/_seller/offers'),
    getJson(standby, '/_seller/health'), getJson(standby, '/_seller/offers'),
  ]);
  const hA = simplifyHealth(aH), hB = simplifyHealth(bH);
  if (!Array.isArray(aO) || !Array.isArray(bO) || aO.length !== config.routes.length ||
      bO.length !== config.routes.length) bad('Route count differs from recovered config');
  if (stable(hA) !== stable(hB)) bad('Current and standby original seller route/health mismatch');
  if (stable(aO) !== stable(bO)) bad('Original native offer/payment identity differs at standby');
  const routeIds = hA.routes.map(x => x.id).sort();
  if (stable(routeIds) !== stable(manifest.routes.map(x => x.id).sort())) bad('Live route identities differ from recovered bundle');
  if (!['CHALLENGE_ONLY', 'NATIVE_X402'].includes(hA.mode)) bad('Unrecognized original SF30 payment mode');
  if (manifest.publicOrigin) {
    for (const route of config.routes) {
      const expectedUrl = manifest.publicOrigin + route.path;
      if (!hA.routes.some(x => x.id === route.id && x.url === expectedUrl)) bad(`Live seller URL differs from packaged payment identity: ${route.id}`);
    }
  }
  return { cutoverParity: true, mode: hA.mode, routeCount: routeIds.length,
    offersSha256: hash(Buffer.from(stable(aO))), sellerConfigSha256: manifest.sellerConfigSha256,
    publicOrigin: manifest.publicOrigin, note: 'Metadata parity only; proxy, settlement, backend and data cutover remain operator tasks.' };
}

export async function main(args = process.argv.slice(2)) {
  const { command, options } = argumentsOf(args);
  if (command === 'help') { console.log(usage); return; }
  const result = command === 'pack' ? await pack(options['--config'], options['--out']) :
    command === 'verify' ? (() => verify(options['--bundle']).then(r => ({
      verified: true, routes: r.routes, assets: r.assets, configSha256: r.manifest.sellerConfigSha256,
    })))() :
    command === 'restore' ? restore(options['--bundle'], options['--to']) :
    probe(options['--bundle'], options['--current'], options['--standby']);
  console.log(JSON.stringify(await result));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e.message); process.exitCode = 1; });
}
