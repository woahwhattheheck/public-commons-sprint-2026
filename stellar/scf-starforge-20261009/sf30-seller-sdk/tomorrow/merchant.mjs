// MIT. Publish licensed forecast editions through original SF30 file products.
import { join, resolve } from 'node:path';
import { unlink } from 'node:fs/promises';
import { inspectResponseAsset } from '../response-asset.mjs';
import { createAssetBundle, exportAssetCatalog, verifyAssetBundle } from '../asset-cli.mjs';
import { readSellerConfig, startSellerService } from '../serve.mjs';
import { readBytes, readJson, writeJson, jsonBytes, exists } from '../../sf88-operator-buyer-cli/node/store.mjs';
import { compileWeatherPlan, normalizeWork, requestsFor, object, need, id, ATTRIBUTION } from './config.mjs';
import { digest } from './source.mjs';
import { HANDOVER_SCHEMA } from './workspace.mjs';

export const PRODUCT_SCHEMA = 'stellar-forge.tomorrow-product.v1';
const copy = value => structuredClone(value);
const same = (a, b) => digest(jsonBytes(a)) === digest(jsonBytes(b));

export function readWeatherProduct(input) {
  const value = input instanceof Uint8Array
    ? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(input)) : copy(input);
  const p = value?.payload;
  need(object(p) && p.schema === PRODUCT_SCHEMA && value.sha256 === digest(jsonBytes(p)), 'WEATHER_PRODUCT_INVALID');
  need(object(p.handover?.payload) && p.handover.payload.schema === HANDOVER_SCHEMA &&
    p.handover.sha256 === digest(jsonBytes(p.handover.payload)) &&
    Array.isArray(p.handover.payload.raw) && p.handover.payload.raw.length === 0, 'WEATHER_PRODUCT_HANDOVER_INVALID');
  const plan = compileWeatherPlan(p.handover.payload.plan), editions = p.handover.payload.editions;
  need(Array.isArray(editions) && editions.length === 1 && Array.isArray(p.items) &&
    /^[a-f0-9]{64}$/.test(p.catalogSha256), 'WEATHER_PRODUCT_RESOURCES_INVALID');
  const edition = editions[0]; id(edition.id); normalizeWork(edition.work, plan);
  need(edition.state === 'COMPLETE' && same(requestsFor(edition.work), edition.requests) &&
    edition.usage.mode === 'licensed-service' && edition.usage.exportRaw &&
    Number.isFinite(Date.parse(edition.rawExpiresAt)), 'WEATHER_PRODUCT_EDITION_INVALID');
  const kinds = new Set();
  for (const item of p.items) {
    const expected = edition.resources[item.kind]; id(item.routeId);
    const url = new URL(item.url);
    need(item.editionId === edition.id && ['timeline', 'tile'].includes(item.kind) && !kinds.has(item.kind) &&
      url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash &&
      expected?.state === 'COMPLETE' && item.sha256 === expected.sha256 && item.bytes === expected.bytes &&
      item.contentType === (item.kind === 'tile' ? 'image/png' : 'application/json'), 'WEATHER_PRODUCT_RESOURCE_CHANGED');
    kinds.add(item.kind);
  }
  need(p.items.length === edition.requests.length && edition.requests.every(r => kinds.has(r.kind)), 'WEATHER_PRODUCT_RESOURCE_MISSING');
  return value;
}

/** Compare only native advertised products; no payment option is inferred. */
export function verifyWeatherCatalog(product, bytes) {
  product = readWeatherProduct(product);
  need(bytes instanceof Uint8Array && bytes.length <= 1048576 && digest(bytes) === product.payload.catalogSha256, 'WEATHER_CATALOG_CHANGED');
  const catalog = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  need(Array.isArray(catalog.resources), 'WEATHER_CATALOG_INVALID');
  const rows = product.payload.items.map(item => {
    const matches = catalog.resources.map((resource, rowIndex) => ({ resource, rowIndex }))
      .filter(({ resource }) => resource.resource?.url === item.url);
    need(matches.length === 1, 'WEATHER_CATALOG_PRODUCT_MISSING');
    const { resource, rowIndex } = matches[0], asset = resource.extensions?.['stellar-forge-asset'];
    need(asset?.schema === 'stellar-forge.asset-product.v1' && asset.sha256 === item.sha256 &&
      asset.bytes === item.bytes && asset.contentType === item.contentType, 'WEATHER_CATALOG_ASSET_CHANGED');
    return { ...copy(item), rowIndex };
  });
  return { product, catalog, rows };
}

/** Reuses native immutable asset bundles and native pinned buyer catalogs. */
export async function packageWeatherEdition({ workspace, editionId, directory, publicOrigin, paymentOptions } = {}) {
  need(Array.isArray(paymentOptions) && paymentOptions.length > 0, 'WEATHER_EXPLICIT_PAYMENT_OPTIONS_REQUIRED');
  const { edition, assets } = await workspace.exportableEdition(editionId);
  const routes = [];
  for (const asset of assets) {
    const contentType = asset.kind === 'tile' ? 'image/png' : 'application/json';
    const downloadName = edition.id + (asset.kind === 'tile' ? '-map.png' : '-timeline.json');
    const { bytes, ...responseAsset } = await inspectResponseAsset(asset.file, contentType, downloadName);
    need(bytes === asset.bytes && responseAsset.sha256 === asset.sha256, 'WEATHER_SOURCE_BYTES_CHANGED');
    routes.push({ id: asset.kind + '_' + edition.id,
      path: '/weather/editions/' + edition.id + (asset.kind === 'tile' ? '/map.png' : '/timeline.json'),
      definition: { method: 'GET', description: edition.label + ' — ' + (asset.kind === 'tile' ? 'native map tile' : 'native Timeline JSON'),
        paymentOptions: copy(paymentOptions) }, responseAsset });
  }
  directory = resolve(directory);
  const config = { schema: 'stellar-forge.seller-service.v1', publicOrigin,
    maxResponseBytes: 1048576, assetBudgetBytes: Math.max(1, assets.reduce((n, a) => n + a.bytes, 0)), routes };
  if (await exists(join(directory, 'manifest.json'))) {
    await verifyAssetBundle(directory);
    const retained = await readSellerConfig(join(directory, 'seller.json'));
    const semantic = c => ({ ...c, routes: c.routes.map(r => ({ ...r, responseAsset: { ...r.responseAsset, file: null } })) });
    need(same(semantic(retained), semantic(config)), 'WEATHER_PACKAGE_DESTINATION_DIFFERENT');
  } else await createAssetBundle(config, { out: directory });
  const catalogPath = join(directory, 'catalog.json');
  if (!await exists(catalogPath)) await exportAssetCatalog(directory, catalogPath);
  const catalogBytes = await readBytes(catalogPath, 1048576), productPath = join(directory, 'weather-product.json');
  if (await exists(productPath)) {
    const product = readWeatherProduct(await readBytes(productPath, 16777216));
    verifyWeatherCatalog(product, catalogBytes);
    need(same(product.payload.handover.payload.editions[0], edition), 'WEATHER_PACKAGE_EDITION_CHANGED');
    return { directory, productPath, catalogPath, productSha256: product.sha256, resources: product.payload.items.length };
  }
  const handover = await workspace.handover({ editionIds: [edition.id] });
  const payload = { schema: PRODUCT_SCHEMA, createdAt: new Date().toISOString(),
    handover, catalogSha256: digest(catalogBytes), attribution: ATTRIBUTION,
    items: assets.map((asset, index) => ({ kind: asset.kind, editionId: edition.id, routeId: routes[index].id,
      url: new URL(routes[index].path, publicOrigin).href, sha256: asset.sha256, bytes: asset.bytes,
      contentType: asset.kind === 'tile' ? 'image/png' : 'application/json' })) };
  const product = { payload, sha256: digest(jsonBytes(payload)) };
  verifyWeatherCatalog(product, catalogBytes);
  await writeJson(productPath, product, { exclusive: true });
  return { directory, productPath, catalogPath, productSha256: product.sha256, resources: assets.length };
}

export async function openWeatherPackage(directory) {
  directory = resolve(directory);
  const product = readWeatherProduct(await readBytes(join(directory, 'weather-product.json'), 16777216));
  verifyWeatherCatalog(product, await readBytes(join(directory, 'catalog.json'), 1048576));
  const verified = await verifyAssetBundle(directory), config = await readSellerConfig(join(directory, 'seller.json'));
  need(config.routes.length === product.payload.items.length, 'WEATHER_PACKAGE_ROUTE_CHANGED');
  for (const item of product.payload.items) {
    const route = config.routes.find(r => r.id === item.routeId);
    need(route && new URL(route.path, config.publicOrigin).href === item.url &&
      route.responseAsset.sha256 === item.sha256 && route.responseAsset.contentType === item.contentType, 'WEATHER_PACKAGE_ROUTE_CHANGED');
  }
  return { directory, product, config, verified };
}

/** Expiry is evaluated before original native payment admission. */
export async function serveWeatherPackage({ directory, port = 0, nativeFactory = null, ...options } = {}) {
  const bundle = await openWeatherPackage(directory), edition = bundle.product.payload.handover.payload.editions[0];
  const expires = Date.parse(edition.rawExpiresAt);
  need(Date.now() < expires, 'WEATHER_RETENTION_EXPIRED');
  const config = { ...bundle.config, routes: bundle.config.routes.map(route => ({ ...route, admit: 'weatherLicenseActive' })) };
  const service = await startSellerService({ ...options, config, port, nativeFactory,
    handlers: { weatherLicenseActive: () => Date.now() < expires ? true : {
      status: 410, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      body: { error: 'WEATHER_RETENTION_EXPIRED' } } } });
  let timer, closing;
  const close = () => closing ??= (async () => { clearTimeout(timer); return service.close(); })();
  const schedule = () => {
    const remaining = expires - Date.now();
    if (remaining <= 0) { close().catch(() => {}); return; }
    timer = setTimeout(schedule, Math.min(remaining, 2147483647)); timer.unref();
  };
  schedule();
  return { ...service, close, productSha256: bundle.product.sha256, expiresAt: edition.rawExpiresAt };
}

/** Remove only hash-verified owned package payloads; preserve its accounting metadata. */
export async function purgeExpiredWeatherPackage(directory) {
  directory = resolve(directory);
  const marker = join(directory, 'weather-expired.json');
  if (await exists(marker)) return readJson(marker);
  const bundle = await openWeatherPackage(directory), edition = bundle.product.payload.handover.payload.editions[0];
  need(Date.now() >= Date.parse(edition.rawExpiresAt), 'WEATHER_RETENTION_ACTIVE');
  const files = [...new Set(bundle.config.routes.map(route => route.responseAsset.file))];
  for (const file of files) await unlink(file);
  const result = { schema: 'stellar-forge.tomorrow-expired-package.v1', productSha256: bundle.product.sha256,
    expiredAt: edition.rawExpiresAt, removedAt: new Date().toISOString(), files: files.length };
  await writeJson(marker, result, { exclusive: true });
  return result;
}
