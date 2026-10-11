// MIT. Configured facilitator review over original retained SF82/SF30 releases.
import { readFile, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { inspectRelease, readReleaseState, stageRetainedRelease } from './releases.mjs';
import { compileSellerRoutes } from '../sf30-seller-sdk/resource-server.mjs';
import { createNativeSellerServer, inspectNativePaymentRequirements, NATIVE_SDK_VERSION } from '../sf30-seller-sdk/native-factory.mjs';

export const FACILITATORS_SCHEMA = 'stellar-forge.seller-facilitators.v1';
export const FACILITATOR_REVIEW_SCHEMA = 'stellar-forge.seller-facilitator-review.v1';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message) => Object.assign(new Error(message), { code });
const hash = value => createHash('sha256').update(value).digest('hex');
const normalize = value => Array.isArray(value) ? value.map(normalize) : plain(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])])) : value;
const stable = value => JSON.stringify(normalize(value));
function exact(value, keys, required = []) {
  if (!plain(value) || Object.keys(value).some(key => !keys.includes(key)) || required.some(key => !Object.hasOwn(value, key)))
    throw new TypeError('Supply only the declared facilitator fields, including all required fields.');
}
function identifier(value, label) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value))
    throw new TypeError(label + ' must use 1–64 lowercase letters, digits, underscores or hyphens.');
  return value;
}
function line(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 240 || /[\x00-\x1f\x7f]/.test(value))
    throw new TypeError(label + ' must be nonempty single-line text up to 240 characters.');
  return value.trim();
}
async function bytes(path, maximum) {
  const info = await lstat(path);
  if (!info.isFile() || info.size > maximum) throw new TypeError('Expected a regular facilitator file within its size limit.');
  const value = await readFile(path);
  if (value.length > maximum) throw new RangeError('Facilitator file grew beyond its size limit.');
  return value;
}
const parse = value => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value));

/** The host declares endpoints once; browser and MCP calls select only aliases. */
export function normalizeFacilitatorProfiles(raw) {
  exact(raw, ['schema', 'providers'], ['schema', 'providers']);
  if (raw.schema !== FACILITATORS_SCHEMA || !plain(raw.providers) ||
      Object.keys(raw.providers).length < 1 || Object.keys(raw.providers).length > 16)
    throw new TypeError('Declare between 1 and 16 named facilitator providers.');
  const providers = Object.create(null);
  for (const [alias, input] of Object.entries(raw.providers)) {
    identifier(alias, 'Provider alias'); exact(input, ['label', 'url', 'timeoutMs', 'allowLocalFacilitator'], ['url']);
    if (input.allowLocalFacilitator !== undefined && typeof input.allowLocalFacilitator !== 'boolean')
      throw new TypeError('allowLocalFacilitator must be a boolean.');
    if (typeof input.url !== 'string' || input.url.length > 2048) throw new TypeError('Supply a facilitator URL up to 2048 characters.');
    const endpoint = new URL(input.url), local = input.allowLocalFacilitator === true &&
      endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1';
    if ((!local && endpoint.protocol !== 'https:') || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
      throw new TypeError('Use a credential-free HTTPS facilitator, or explicitly enabled loopback HTTP.');
    const timeoutMs = input.timeoutMs ?? 5000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000)
      throw new TypeError('Provider read timeout must be 1000–30000 milliseconds.');
    providers[alias] = { label: line(input.label ?? alias, 'Provider label'),
      url: endpoint.href.replace(/\/+$/, ''), timeoutMs, allowLocalFacilitator: input.allowLocalFacilitator === true };
  }
  return { schema: FACILITATORS_SCHEMA, providers };
}
export async function readFacilitatorProfiles(path) {
  return normalizeFacilitatorProfiles(parse(await bytes(resolve(path), 65536)));
}
function provider(profiles, alias) {
  identifier(alias, 'Provider alias');
  const selected = profiles?.providers?.[alias];
  if (!selected) throw fail('FACILITATOR_NOT_CONFIGURED', 'Select one of the host-configured facilitator aliases.');
  return { alias, ...selected };
}
function changes(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(field => stable(before[field] ?? null) !== stable(after[field] ?? null))
    .map(field => ({ field, before: before[field] ?? null, after: after[field] ?? null }));
}
function paymentChanges(before, after) {
  return Array.from({ length: Math.max(before.length, after.length) }, (_, option) => {
    if (before[option] === undefined || after[option] === undefined) return [{ option,
      field: before[option] === undefined ? 'added alternative' : 'removed alternative',
      before: before[option] ?? null, after: after[option] ?? null }];
    return changes(before[option], after[option]).map(change => ({ option, ...change }));
  }).flat();
}

/** Use the exact SDK client, route factory and requirements builder. No handler,
 * signer, listener, verification or settlement is invoked by this read. */
export async function reviewReleaseFacilitator(root, { profiles, provider: alias, releaseId, id, label } = {}) {
  root = resolve(root);
  releaseId = identifier(releaseId, 'Retained release ID');
  id = identifier(id, 'New release ID');
  if (id === releaseId) throw new TypeError('Use a new ID for the retained facilitator release.');
  const selected = provider(profiles, alias), state = await readReleaseState(root);
  const release = await inspectRelease(root, releaseId);
  const sourceBytes = await bytes(join(root, 'releases', releaseId, 'seller-service.json'), 1024 * 1024);
  if (hash(sourceBytes) !== release.source.serviceConfigSha256)
    throw fail('RELEASE_CONFLICT', 'The retained service differs from its inspected source.');
  const service = parse(sourceBytes);
  const unusedHandler = () => { throw new Error('Facilitator review never executes a merchant handler.'); };
  const compiled = compileSellerRoutes(service.routes.map(route => ({ id: route.id, offer: route.offer,
    maxRequestBytes: route.maxRequestBytes, handler: unusedHandler })));
  const { HTTPFacilitatorClient } = await import('@x402/core/server');
  const client = new HTTPFacilitatorClient({ url: selected.url, timeoutMs: selected.timeoutMs });
  let supported = null, nativePayments = [], error = null;
  try {
    const value = await client.getSupported();
    if (Buffer.byteLength(stable(value)) > 262144) throw new RangeError('Provider capabilities exceed the 256 KiB review limit.');
    supported = value;
    // The original server consumes this exact completed native read. A second
    // request here could review different capabilities within one operation.
    client.getSupported = async () => supported;
    const native = await createNativeSellerServer(compiled, { facilitatorClient: client });
    const requirements = await inspectNativePaymentRequirements(compiled, native);
    nativePayments = requirements.map((item, index) => ({ ...item,
      storedPayment: compiled.routes[index].offer.accepts,
      changes: paymentChanges(compiled.routes[index].offer.accepts, item.nativePayment) }));
  } catch (cause) {
    error = { code: cause.code ?? cause.name ?? 'FACILITATOR_UNAVAILABLE', message: String(cause.message ?? cause).slice(0, 2000) };
  }
  const current = await readReleaseState(root);
  if (current.generation !== state.generation)
    throw fail('RELEASE_CONFLICT', 'Selection changed during the provider read. Review the current release again.');
  const content = { schema: FACILITATOR_REVIEW_SCHEMA, observedAt: new Date().toISOString(),
    nativeSdk: NATIVE_SDK_VERSION, generation: state.generation, activeRelease: state.active,
    source: { releaseId, releaseDigest: release.digest, publicOrigin: release.publicOrigin,
      source: release.source, currentFacilitator: release.runtime.facilitator ?? null,
      currentAllowLocalFacilitator: release.runtime.allowLocalFacilitator === true },
    proposed: { id, label: line(label ?? id, 'New release label'), provider: selected },
    compatible: error === null, supportedSha256: supported === null ? null : hash(stable(supported)),
    supported, nativePayments, error };
  if (Buffer.byteLength(stable(content)) > 1024 * 1024) throw new RangeError('Facilitator review exceeds 1 MiB.');
  return { ...content, id: hash(stable(content)) };
}
function checkedReview(review) {
  if (!plain(review)) throw new TypeError('Supply the original facilitator review.');
  const { id, ...content } = review;
  if (content.schema !== FACILITATOR_REVIEW_SCHEMA || typeof id !== 'string' || id !== hash(stable(content)))
    throw fail('FACILITATOR_REVIEW_CHANGED', 'The facilitator review changed. Read the original saved review.');
  if (!content.compatible || !/^[a-f0-9]{64}$/.test(content.supportedSha256))
    throw fail('FACILITATOR_NOT_COMPATIBLE', 'Review a provider that supports every retained native payment option.');
  identifier(content.source?.releaseId, 'Retained release ID'); identifier(content.proposed?.id, 'New release ID');
  return review;
}
export async function readFacilitatorReview(path) {
  return checkedReview(parse(await bytes(resolve(path), 1024 * 1024)));
}
export async function stageReleaseFacilitator(root, { profiles, review } = {}) {
  root = resolve(root); review = checkedReview(review);
  const selected = provider(profiles, review.proposed.provider.alias);
  if (stable(selected) !== stable(review.proposed.provider))
    throw fail('FACILITATOR_REVIEW_CHANGED', 'The host provider configuration changed. Review it again.');
  const options = { from: review.source.releaseId, id: review.proposed.id, label: review.proposed.label,
    expectedDigest: review.source.releaseDigest, expectedGeneration: review.generation,
    facilitator: selected.url, allowLocalFacilitator: selected.allowLocalFacilitator,
    review };
  let retained;
  try { retained = await inspectRelease(root, options.id); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (retained) {
    // The original source seam validates the full retained binding. This lets a
    // lost reply recover its committed release even if the provider is now down.
    if (retained.derivedFrom?.reviewId !== review.id)
      throw fail('RELEASE_CONFLICT', 'That release ID already belongs to another prepared change.');
    return { reviewId: review.id, ...await stageRetainedRelease(root, options) };
  }
  const fresh = await reviewReleaseFacilitator(root, { profiles, provider: selected.alias,
    releaseId: options.from, id: options.id, label: options.label });
  if (!fresh.compatible || fresh.generation !== review.generation || stable(fresh.source) !== stable(review.source) ||
      fresh.supportedSha256 !== review.supportedSha256 || stable(fresh.nativePayments) !== stable(review.nativePayments))
    throw fail('FACILITATOR_REVIEW_CHANGED', 'The retained release or provider capabilities changed. Review the current provider before staging.');
  return { reviewId: review.id, ...await stageRetainedRelease(root, options) };
}

/** Session-only review handles; committed releases remain in the original store. */
export function createReleaseFacilitatorControl(root, profiles) {
  profiles = profiles ? normalizeFacilitatorProfiles(profiles) : null;
  const reviews = new Map(), pending = new Set(); let closing = false, closed;
  const track = action => {
    if (closing) return Promise.reject(fail('FACILITATOR_CLOSING', 'The facilitator control is closing.'));
    const work = Promise.resolve().then(action); pending.add(work);
    work.then(() => pending.delete(work), () => pending.delete(work)); return work;
  };
  const status = () => ({ configured: Boolean(profiles),
    providers: Object.entries(profiles?.providers ?? {}).map(([alias, value]) => ({ alias, ...value })) });
  return { status,
    review: input => track(async () => {
      exact(input, ['provider', 'releaseId', 'id', 'label'], ['provider', 'releaseId', 'id']);
      const review = await reviewReleaseFacilitator(root, { profiles, ...input });
      if (reviews.size >= 16) reviews.delete(reviews.keys().next().value);
      reviews.set(review.id, review); return structuredClone(review);
    }),
    stage: input => track(async () => {
      exact(input, ['reviewId'], ['reviewId']);
      const review = reviews.get(input.reviewId);
      if (!review) throw fail('FACILITATOR_REVIEW_REQUIRED', 'Review this change in the current operator session first. Inspect its release ID after a lost stage reply.');
      return stageReleaseFacilitator(root, { profiles, review });
    }),
    close: () => {
      if (closed) return closed; closing = true;
      return closed = Promise.allSettled([...pending]).then(() => { reviews.clear(); });
    },
  };
}
