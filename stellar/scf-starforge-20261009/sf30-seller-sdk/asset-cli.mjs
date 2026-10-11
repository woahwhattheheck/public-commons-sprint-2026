// MIT. Create-only portable file products for the original SF30 seller service.
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import { dirname, resolve, join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { inspectResponseAsset, prepareResponseAssets, compileAssetRouteOffer,
  responseAssetLimits } from './response-asset.mjs';
import { compileHttpSellerOffer } from './seller.mjs';
import { compileServicePath, orderServiceRoutes } from './route-path.mjs';
import { validateAdmissionTimeout } from './admission.mjs';

const schema = 'stellar-forge.asset-bundle.v1';
const hash = value => createHash('sha256').update(value).digest('hex');
const encoded = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const own = (x, k) => Object.prototype.hasOwnProperty.call(x, k);
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const USAGE = `SF30 file products (no payments or network requests)
  node asset-cli.mjs inspect --file FILE --type MIME [--name DOWNLOAD_NAME]
  node asset-cli.mjs bundle --config SELLER_JSON --out NEW_DIRECTORY
  node asset-cli.mjs verify --directory BUNDLE_DIRECTORY
  node asset-cli.mjs catalog --directory BUNDLE_DIRECTORY --out NEW_JSON_FILE

inspect prints a pinned responseAsset descriptor and the required byte limit.
bundle copies declarative asset-only routes to a private, portable directory.
verify reads every packaged byte and checks config, route and content digests.
catalog exports content-free native offers and pinned product metadata for SF88.
Serve seller.json with the EXISTING serve.mjs; facilitator configuration stays explicit.`;

async function jsonFile(path) {
  const info = await stat(path);
  if (!info.isFile() || info.size > 1024 * 1024) throw new TypeError('Expected a JSON file no larger than 1 MiB');
  const bytes = await readFile(path);
  if (bytes.length > 1024 * 1024) throw new TypeError('JSON file exceeds 1 MiB');
  return { bytes, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) };
}

function portableConfig(input, configDir) {
  if (!object(input) || input.schema !== 'stellar-forge.seller-service.v1' ||
      !Array.isArray(input.routes) || input.routes.length < 1 || input.routes.length > 64)
    throw new TypeError('Expected seller-service.v1 with 1–64 declarative asset routes');
  responseAssetLimits(input);
  validateAdmissionTimeout(input.admissionTimeoutMs ?? 2000);
  const config = structuredClone(input), ids = new Set(), bindings = new Set(), compiledPaths = [];
  let origin = 'http://127.0.0.1:8423';
  if (config.publicOrigin !== undefined) {
    const url = new URL(config.publicOrigin);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
        url.pathname !== '/' || url.origin !== config.publicOrigin.replace(/\/$/, ''))
      throw new TypeError('publicOrigin must be a canonical HTTPS origin');
    origin = url.origin;
  }
  for (const route of config.routes) {
    if (!object(route) || !/^[A-Za-z0-9_-]{1,64}$/.test(route.id ?? '') || ids.has(route.id) ||
        !object(route.definition) || own(route.definition, 'url') ||
        !own(route, 'responseAsset') || ['response', 'responseFile', 'handler', 'admit', 'offer'].some(key => own(route, key)) ||
        (own(route, 'validateInput') && route.validateInput !== false) || typeof route.path !== 'string' || !/^\/[A-Za-z0-9_.~/-]*$/.test(route.path) ||
        route.path.startsWith('/_seller/') || route.path.includes('//') ||
        new URL(route.path, origin).pathname !== route.path)
      throw new TypeError('Bundle needs unique fixed-path asset definitions without handler/admission modules');
    const offer = compileAssetRouteOffer(route, origin, compileHttpSellerOffer, !config.publicOrigin);
    const binding = offer.extensions.bazaar.info.input.method + ' ' + route.path;
    if (bindings.has(binding)) throw new TypeError('Duplicate method/path in bundle');
    bindings.add(binding); ids.add(route.id);
    compiledPaths.push({ method: offer.extensions.bazaar.info.input.method, path: route.path,
      binding: compileServicePath(offer) });
    route.responseAsset.file = resolve(configDir, route.responseAsset.file);
  }
  orderServiceRoutes(compiledPaths); // Preserve the ORIGINAL native route ambiguity rules.
  return config;
}

async function durableFile(path, bytes) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); }
  finally { await file.close(); }
}

/** No overwrites: one mkdir reserves the exact output name for this invocation.
 * All input files are validated before reserving it. A failed own write cleans up
 * only the directory this invocation created; a peer's existing output is intact. */
export async function createAssetBundle(input, { configDir = process.cwd(), out } = {}) {
  if (typeof out !== 'string' || !out.trim()) throw new TypeError('New output directory required');
  const config = portableConfig(input, configDir);
  const prepared = await prepareResponseAssets(config);
  const directory = resolve(out);
  const output = structuredClone(config), manifest = { schema, config: 'seller.json',
    configSha256: '', assets: [], totalRouteBytes: prepared.retainedBytes };
  const unique = new Map();
  for (const route of output.routes) {
    const snapshot = prepared.assets.get(route.id), metadata = snapshot.metadata;
    const path = `assets/${metadata.sha256}.blob`;
    route.responseAsset.file = path;
    manifest.assets.push({ routeId: route.id, file: path, ...metadata });
    if (!unique.has(metadata.sha256)) unique.set(metadata.sha256, snapshot);
  }
  const configBytes = encoded(output);
  if (configBytes.length > 1024 * 1024) throw new RangeError('Portable seller config exceeds 1 MiB');
  manifest.configSha256 = hash(configBytes);
  // mkdir is exclusive. Never pre-check then rename over somebody else's path.
  await mkdir(directory, { mode: 0o700 });
  try {
    await mkdir(join(directory, 'assets'), { mode: 0o700 });
    for (const [sha, snapshot] of unique) await durableFile(join(directory, 'assets', sha + '.blob'), snapshot.copyBytes());
    await durableFile(join(directory, 'seller.json'), configBytes);
    // Last write is the completion record; interrupted bundles fail verify.
    await durableFile(join(directory, 'manifest.json'), encoded(manifest));
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return { directory, manifest, uniqueFiles: unique.size };
}

async function verifiedAssetBundle(directory) {
  const dir = resolve(directory);
  const { value: manifest } = await jsonFile(join(dir, 'manifest.json'));
  if (!object(manifest) || manifest.schema !== schema || manifest.config !== 'seller.json' ||
      !/^[a-f0-9]{64}$/.test(manifest.configSha256 ?? '') || !Array.isArray(manifest.assets))
    throw new TypeError('Invalid asset bundle manifest');
  const { value: input, bytes } = await jsonFile(join(dir, 'seller.json'));
  if (hash(bytes) !== manifest.configSha256) throw new Error('Packaged seller config digest mismatch');
  if (!Array.isArray(input.routes) || input.routes.some(route =>
      !/^assets\/[a-f0-9]{64}\.blob$/.test(route?.responseAsset?.file ?? '') ||
      route.responseAsset.file !== `assets/${route.responseAsset.sha256}.blob`))
    throw new Error('Packaged asset path must be content-addressed inside assets/');
  const config = portableConfig(input, dir);
  const prepared = await prepareResponseAssets(config);
  if (manifest.assets.length !== prepared.assets.size || manifest.totalRouteBytes !== prepared.retainedBytes)
    throw new Error('Bundle manifest route count or size mismatch');
  const seen = new Set();
  for (const entry of manifest.assets) {
    const snapshot = prepared.assets.get(entry?.routeId);
    if (!snapshot || seen.has(entry.routeId) || entry.file !== `assets/${snapshot.metadata.sha256}.blob` ||
        Object.entries(snapshot.metadata).some(([key, value]) => entry[key] !== value))
      throw new Error('Bundle manifest does not match the packaged route');
    seen.add(entry.routeId);
  }
  return { config, prepared, verification:{ verified: true, directory: dir, routes: seen.size,
    totalRouteBytes: prepared.retainedBytes, configSha256: manifest.configSha256 } };
}

export async function verifyAssetBundle(directory) {
  return (await verifiedAssetBundle(directory)).verification;
}

/** Public catalog data only: never copy asset bytes, operator configuration,
 * source paths or manifest config hashes into a buyer-facing listing. */
export async function exportAssetCatalog(directory, out) {
  if (typeof out !== 'string' || !out.trim()) throw new TypeError('New catalog output path required');
  // Use the same validated config and immutable snapshots as verification;
  // no second read, re-hash or retained copy of the merchant's file collection.
  const {config, prepared} = await verifiedAssetBundle(directory);
  if (!config.publicOrigin) throw new TypeError('Catalog export requires the real public HTTPS origin');
  const origin = new URL(config.publicOrigin).origin;
  const resources = config.routes.filter(route => route.definition.method.toUpperCase() === 'GET').map(route => {
    const offer = compileAssetRouteOffer(route, origin, compileHttpSellerOffer);
    const metadata = prepared.assets.get(route.id).metadata;
    return {...offer, type:'http', extensions:{...offer.extensions,
      'stellar-forge-asset':{schema:'stellar-forge.asset-product.v1', ...metadata}}};
  });
  if (!resources.length) throw new TypeError('A downloadable product catalog requires at least one GET route');
  const catalog = {resources};
  const output = encoded(catalog);
  if (output.length > 1024 * 1024) throw new RangeError('Catalog exceeds the original buyer discovery limit');
  const destination = resolve(out);
  // durableFile uses wx. Never delete or replace a pre-existing operator file.
  let created = false, file;
  try {
    file = await open(destination, 'wx', 0o600); created = true;
    await file.writeFile(output); await file.sync();
  } catch (error) {
    if (file) { await file.close().catch(() => {}); file = null; }
    if (created) await rm(destination, {force:true}).catch(() => {});
    throw error;
  } finally { if (file) await file.close(); }
  return {catalogPath:destination, resources:resources.length,
    catalogSha256:hash(output), contentIncluded:false};
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { console.log(USAGE); return; }
  const [command, ...rest] = args;
  const allowed = { inspect: ['--file', '--type', '--name'], bundle: ['--config', '--out'], verify: ['--directory'], catalog: ['--directory','--out'] }[command];
  if (!allowed) throw new TypeError(USAGE);
  const options = new Map();
  for (let i = 0; i < rest.length; i += 2) {
    if (!allowed.includes(rest[i]) || options.has(rest[i]) || !rest[i + 1] || rest[i + 1].startsWith('--'))
      throw new TypeError(USAGE);
    options.set(rest[i], rest[i + 1]);
  }
  let result;
  if (command === 'inspect') {
    if (!options.has('--file') || !options.has('--type')) throw new TypeError(USAGE);
    const file = resolve(options.get('--file'));
    const info = await inspectResponseAsset(file, options.get('--type'), options.get('--name') ?? basename(file));
    const { bytes, ...responseAsset } = info;
    result = { responseAsset, bytes, recommendedMaxResponseBytes: Math.max(1024 * 1024, bytes) };
  } else if (command === 'bundle') {
    if (!options.has('--config') || !options.has('--out')) throw new TypeError(USAGE);
    const path = resolve(options.get('--config'));
    result = await createAssetBundle((await jsonFile(path)).value,
      { configDir: dirname(path), out: options.get('--out') });
  } else if (command === 'catalog') {
    if (!options.has('--directory') || !options.has('--out')) throw new TypeError(USAGE);
    result = await exportAssetCatalog(options.get('--directory'), options.get('--out'));
  } else {
    if (!options.has('--directory')) throw new TypeError(USAGE);
    result = await verifyAssetBundle(options.get('--directory'));
  }
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
