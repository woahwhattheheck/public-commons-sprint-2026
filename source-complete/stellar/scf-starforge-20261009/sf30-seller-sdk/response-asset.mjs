// MIT. Immutable, digest-pinned files for the original SF30 seller lifecycle.
// No payment implementation, network client or filesystem lookup per request.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export const MAX_ASSET_BYTES = 16 * 1024 * 1024;
export const MAX_ASSET_BUDGET = 64 * 1024 * 1024;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const own = (x, k) => Object.prototype.hasOwnProperty.call(x, k);
const keys = new Set(['file', 'sha256', 'contentType', 'downloadName']);
const mime = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/;

export function responseAssetLimits(config = {}) {
  const maxResponseBytes = config.maxResponseBytes ?? 1024 * 1024;
  const assetBudgetBytes = config.assetBudgetBytes ?? 32 * 1024 * 1024;
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > MAX_ASSET_BYTES)
    throw new TypeError('maxResponseBytes must be 1–16777216');
  if (!Number.isSafeInteger(assetBudgetBytes) || assetBudgetBytes < 1 || assetBudgetBytes > MAX_ASSET_BUDGET)
    throw new TypeError('assetBudgetBytes must be 1–67108864');
  return { maxResponseBytes, assetBudgetBytes };
}

export function validateResponseAsset(input) {
  if (!object(input) || Object.keys(input).some(key => !keys.has(key)) ||
      typeof input.file !== 'string' || !input.file.trim() || input.file.length > 4096 ||
      /[\x00-\x1f\x7f]/.test(input.file) ||
      typeof input.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.sha256) ||
      typeof input.contentType !== 'string' || input.contentType.length > 127 || !mime.test(input.contentType) ||
      typeof input.downloadName !== 'string' || !input.downloadName.trim() ||
      Buffer.byteLength(input.downloadName) > 180 || /[\x00-\x1f\x7f/\\]/.test(input.downloadName) ||
      ['.', '..'].includes(input.downloadName)) {
    throw new TypeError('responseAsset requires file, lowercase sha256, MIME type and a safe downloadName');
  }
  // encodeURIComponent rejects unpaired UTF-16 surrogates rather than silently
  // advertising a different filename on the wire.
  try { encodeURIComponent(input.downloadName); }
  catch { throw new TypeError('downloadName must be valid Unicode'); }
  return input;
}

export function validateResponseAssetRoute(route) {
  validateResponseAsset(route.responseAsset);
  const method = route.definition?.method ?? route.offer?.extensions?.bazaar?.info?.input?.method;
  if (!['GET', 'HEAD'].includes(String(method).toUpperCase()) || route.path?.includes(':') ||
      route.definition?.routeTemplate !== undefined)
    throw new TypeError('responseAsset requires a fixed GET or explicitly priced HEAD route');
  if (route.definition && own(route.definition, 'outputExample'))
    throw new TypeError('A binary responseAsset must not advertise a JSON outputExample');
  if (route.offer && (route.offer.resource?.mimeType !== route.responseAsset.contentType ||
      own(route.offer.extensions?.bazaar?.info ?? {}, 'output')))
    throw new TypeError('Imported asset offer needs its exact MIME type and no JSON output declaration');
}

/** Open the actual file once; avoid following a final symlink or blocking on a FIFO.
 * Pin content, not its pathname. All reads and integrity checks precede listening. */
async function readAssetBytes(path, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_ASSET_BYTES)
    throw new TypeError('Invalid asset byte allowance');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  let bytes;
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile()) throw new TypeError('Asset must be a regular file');
    if (before.size > BigInt(maxBytes)) throw new RangeError('Asset exceeds response or remaining memory limit');
    const size = Number(before.size);
    bytes = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const part = await file.read(bytes, offset, size - offset, offset);
      if (!part.bytesRead) throw new Error('Asset changed while reading');
      offset += part.bytesRead;
    }
    const extra = await file.read(Buffer.alloc(1), 0, 1, size);
    const after = await file.stat({ bigint: true });
    if (extra.bytesRead || ['size', 'ino', 'dev', 'mtimeNs', 'ctimeNs'].some(key => before[key] !== after[key]))
      throw new Error('Asset changed while reading');
  } finally {
    await file.close();
  }
  return bytes;
}

export async function inspectResponseAsset(file, contentType, downloadName) {
  const descriptor = { file, contentType, downloadName, sha256: '0'.repeat(64) };
  validateResponseAsset(descriptor);
  const bytes = await readAssetBytes(file, MAX_ASSET_BYTES);
  return { ...descriptor, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
}

export async function readResponseAsset(input, { maxBytes = MAX_ASSET_BYTES } = {}) {
  validateResponseAsset(input);
  const bytes = await readAssetBytes(input.file, maxBytes);
  if (createHash('sha256').update(bytes).digest('hex') !== input.sha256)
    throw new Error('Asset SHA-256 does not match the configured snapshot');
  const fallback = input.downloadName.replace(/[^A-Za-z0-9._-]/g, '_');
  const encoded = encodeURIComponent(input.downloadName).replace(/[!'()*]/g,
    char => '%' + char.charCodeAt(0).toString(16).toUpperCase());
  const metadata = Object.freeze({ sha256: input.sha256, bytes: bytes.length,
    contentType: input.contentType, downloadName: input.downloadName });
  const headers = Object.freeze({ 'content-type': input.contentType,
    'content-disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`,
    'accept-ranges': 'none', etag: `"${input.sha256}"`, 'x-content-sha256': input.sha256 });
  return Object.freeze({ metadata, headers,
    copyBytes: () => Buffer.from(bytes),
    // The caller receives a copy; it cannot mutate later customers' snapshots.
    handler: async () => ({ status: 200, headers: { ...headers }, body: Buffer.from(bytes) }),
  });
}

/** Native SF30 invokes this before payment verification/settlement. No implicit
 * partial delivery, 304 response, free HEAD alias, or repeat-purchase behavior. */
export function assetRequestAdmission(context) {
  const names = new Set(Object.keys(context?.headers ?? {}).map(name => name.toLowerCase()));
  if (names.has('range')) return { status: 416, headers: { 'accept-ranges': 'none' },
    body: { error: 'ASSET_RANGE_UNSUPPORTED', message: 'Purchase the complete immutable file without Range.' } };
  if (['if-range', 'if-match', 'if-none-match', 'if-modified-since', 'if-unmodified-since'].some(name => names.has(name)))
    return { status: 400, body: { error: 'ASSET_CONDITIONAL_UNSUPPORTED',
      message: 'Conditional file requests are not supported by this paid route.' } };
  return true;
}

export function composeAssetAdmission(application) {
  if (application !== undefined && typeof application !== 'function') throw new TypeError('Admission must be a function');
  return context => {
    const decision = assetRequestAdmission(context);
    if (decision !== true) return decision;
    context.signal?.throwIfAborted();
    return application ? application(context) : true;
  };
}

/** Load all assets under ONE retained-snapshot budget. Every route counts
 * against the budget, including repeated declarations of the same file. */
export async function prepareResponseAssets(config) {
  const { maxResponseBytes, assetBudgetBytes } = responseAssetLimits(config);
  const assets = new Map(); let retainedBytes = 0;
  for (const route of config.routes ?? []) {
    if (!own(route, 'responseAsset')) continue;
    validateResponseAssetRoute(route);
    try {
      const snapshot = await readResponseAsset(route.responseAsset,
        { maxBytes: Math.min(maxResponseBytes, assetBudgetBytes - retainedBytes) });
      retainedBytes += snapshot.metadata.bytes;
      assets.set(route.id, snapshot);
    } catch (error) {
      // Do not include the filesystem path in the actionable route-level error.
      const message = error.code ? `Asset file cannot be opened (${error.code})` : error.message;
      throw new Error(`Route ${route.id} responseAsset: ${message}`, { cause: error });
    }
  }
  return { assets, retainedBytes, maxResponseBytes, assetBudgetBytes };
}

/** Keep the ORIGINAL payment terms/compiler. Binary bytes must not be falsely
 * advertised as a JSON result in Bazaar metadata. Imported offers stay exact. */
export function compileAssetRouteOffer(route, origin, compileOffer, allowLocalhost = false) {
  validateResponseAssetRoute(route);
  if (route.offer) return route.offer;
  const offer = compileOffer({ ...route.definition, url: origin + route.path }, { allowLocalhost });
  offer.resource.mimeType = route.responseAsset.contentType;
  delete offer.extensions.bazaar.info.output;
  delete offer.extensions.bazaar.schema.properties.output;
  offer.extensions.bazaar.schema.required = offer.extensions.bazaar.schema.required.filter(key => key !== 'output');
  return offer;
}
