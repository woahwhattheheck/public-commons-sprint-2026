// MIT. Merchant release adoption through the original live catalog operator.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { inspectRelease, releaseStatus } from './releases.mjs';
import { requestCatalogOperator, SIGNED_BATCH_SCHEMA } from '../sf60-durable-catalog-transaction/operator.mjs';
import { createChallenge, signProof } from '../sf50-seller-proof/proof.mjs';
import { signWithdrawal } from '../sf95-signed-seller-withdrawal/proof.mjs';
import { validateCatalogEntry } from '../../../scf46-stellar-bazaar/src/catalog.mjs';

export const RELEASE_CATALOG_CONFIG = 'stellar-forge.seller-release-catalog.v1';
const REVIEW = 'stellar-forge.seller-release-catalog-review.v1';
const LIMIT = 1024 * 1024;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : plain(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const stable = value => JSON.stringify(canonical(value));
const fail = (code, message) => { throw Object.assign(new Error(message ?? code), { code, status: 409 }); };

async function readBytes(path, limit = LIMIT, privateKey = false) {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > limit || (privateKey &&
        ((info.mode & 0o077) !== 0 || info.nlink !== 1 || (process.getuid && info.uid !== process.getuid()))))
      fail('CATALOG_FILE_INVALID', privateKey ? 'Use an owned private Ed25519 key file.' : 'Use a bounded regular catalog input file.');
    const bytes = Buffer.alloc(limit + 1); let used = 0;
    while (used < bytes.length) {
      const { bytesRead } = await file.read(bytes, used, bytes.length - used, null);
      if (!bytesRead) break;
      used += bytesRead;
    }
    if (used > limit) { bytes.fill(0); fail('CATALOG_FILE_TOO_LARGE'); }
    return bytes.subarray(0, used);
  } finally { await file.close(); }
}

function configuration(input, base = process.cwd()) {
  const fields = ['schema', 'directory', 'sellerId', 'sourceURL', 'keyFile'];
  if (!plain(input) || Object.keys(input).some(key => !fields.includes(key)) ||
      fields.some(key => typeof input[key] !== 'string' || !input[key].trim()) ||
      input.schema !== RELEASE_CATALOG_CONFIG || !/^[A-Za-z0-9_.:-]{1,128}$/.test(input.sellerId))
    fail('RELEASE_CATALOG_CONFIG_INVALID', 'Supply catalog directory, approved seller ID, HTTPS source URL and the existing Ed25519 key file.');
  let source;
  try { source = new URL(input.sourceURL); } catch { fail('RELEASE_CATALOG_SOURCE_INVALID'); }
  if (source.protocol !== 'https:' || source.username || source.password || source.hash || source.href !== input.sourceURL)
    fail('RELEASE_CATALOG_SOURCE_INVALID', 'Use the exact credential-free HTTPS offer export URL.');
  return { ...input, directory: resolve(base, input.directory), keyFile: resolve(base, input.keyFile) };
}

/** Reads configuration references only. Key bytes are read just before signing. */
export async function readReleaseCatalogConfig(path) {
  const filename = resolve(path);
  return configuration(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(filename, 16384))), dirname(filename));
}

export async function readReleaseCatalogReview(path) {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(resolve(path))));
}

async function originalOffers(root, releaseId) {
  const release = await inspectRelease(root, releaseId);
  // Match the original Python release reader's service bound as well as SF61.
  const bytes = await readBytes(join(resolve(root), 'releases', release.id, 'seller-service.json'), 4 * LIMIT);
  if (hash(bytes) !== release.source.serviceConfigSha256) fail('RELEASE_SOURCE_CHANGED');
  const service = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!Array.isArray(service.routes) || !service.routes.length || service.routes.length > 1000)
    fail('RELEASE_CATALOG_ROUTE_LIMIT');
  const seen = new Set();
  const offers = service.routes.map(route => {
    const entry = route.offer, sourceBytes = Buffer.from(JSON.stringify(entry) + '\n');
    const { id: catalogKey } = validateCatalogEntry(entry);
    if (seen.has(catalogKey)) fail('RELEASE_CATALOG_DUPLICATE_RESOURCE');
    seen.add(catalogKey);
    if (sourceBytes.length > 65536) fail('RELEASE_CATALOG_OFFER_TOO_LARGE');
    return { routeId: route.id, method: entry.extensions.bazaar.info.input.method,
      url: entry.resource.url, catalogKey, sourceSha256: hash(sourceBytes), entry, sourceBytes };
  });
  return { release, offers };
}

// Setup and publication consume the same retained source and catalog validator.
export { originalOffers as inspectReleaseCatalogOffers };

async function collect(root, input, releaseId) {
  const config = configuration(input), original = await originalOffers(root, releaseId);
  if (new URL(config.sourceURL).origin !== original.release.publicOrigin)
    fail('RELEASE_CATALOG_ORIGIN_MISMATCH', 'The configured export URL must use this release’s public origin.');
  const command = (operation, args = {}) => requestCatalogOperator({ directory: config.directory, operation, input: args });
  const status = await command('status');
  const pin = status.sellers.find(seller => seller.sellerId === config.sellerId);
  if (!pin) fail('RELEASE_CATALOG_SELLER_UNKNOWN', 'Configure this merchant in the existing catalog operator’s seller policy.');
  const { runtime } = await releaseStatus(root);
  const running = ['RUNNING', 'RESTART_REQUIRED'].includes(runtime.state) && runtime.observed?.releaseId === original.release.id;
  const head = status.journalHead;
  const rows = [];
  for (const offer of original.offers) {
    const lookup = await command('lookup', { catalogKey: offer.catalogKey });
    if (lookup.journalHead !== head) fail('RELEASE_CATALOG_CHANGED', 'The catalog changed during review. Refresh its current state.');
    const current = lookup.current;
    let revision;
    if (current) {
      const result = await command('history', { lifecycleId: current.lifecycleId });
      if (result.journalHead !== head) fail('RELEASE_CATALOG_CHANGED', 'The catalog changed during review. Refresh its current state.');
      revision = result.history.at(-1);
      if (!revision || revision.sequence !== current.sequence) fail('RELEASE_CATALOG_HISTORY_MISMATCH');
    }
    const owned = !current || current.sellerId === config.sellerId;
    const pinned = !current || hash(Buffer.from(current.signer, 'base64url')) === pin.publicKeySha256;
    const matches = Boolean(current && !current.retired && owned && pinned &&
      revision.record.provenance.sourceSha256 === offer.sourceSha256 &&
      revision.record.provenance.sourceURL === config.sourceURL);
    const state = !current ? 'NOT_LISTED' : !owned ? 'OTHER_SELLER' : !pinned ? 'SIGNER_CHANGED'
      : current.retired ? 'WITHDRAWN' : matches ? 'MATCHES' : 'DIFFERS';
    rows.push({ routeId: offer.routeId, method: offer.method, url: offer.url, catalogKey: offer.catalogKey,
      sourceSha256: offer.sourceSha256, state, payment: structuredClone(offer.entry.accepts),
      before: current ? { ...current, state: current.retired ? 'WITHDRAWN' : 'ACTIVE',
        sourceSha256: revision.record.provenance.sourceSha256, payment: revision.record.accepts,
        sourceURL: revision.record.provenance.sourceURL } : null });
  }
  const view = { schema: 'stellar-forge.seller-release-catalog-status.v1',
    release: { id: original.release.id, digest: original.release.digest, mode: original.release.mode,
      serviceConfigSha256: original.release.source.serviceConfigSha256 },
    runtime: { state: runtime.state, running, instanceId: running ? runtime.observed.instanceId : null },
    catalog: { directory: config.directory, sellerId: config.sellerId, sourceURL: config.sourceURL,
      configurationSha256: hash(stable(config)), policySha256: status.policySha256,
      publicKeySha256: pin.publicKeySha256, journalHead: head, discoveryOrigin: status.discoveryOrigin }, rows };
  return { config, original, command, view };
}

/** The original writer and lifecycle history are the publication record. */
export async function releaseCatalogStatus(root, { config, releaseId }) {
  return (await collect(root, config, releaseId)).view;
}

function reviewOf(view, { action = 'publish', routeId, reason } = {}) {
  if (!['publish', 'withdraw'].includes(action)) fail('RELEASE_CATALOG_ACTION_INVALID');
  let changes;
  if (action === 'publish') {
    if (routeId !== undefined || reason !== undefined) fail('RELEASE_CATALOG_PUBLISH_ARGUMENTS');
    if (!view.runtime.running) fail('RELEASE_CATALOG_NOT_RUNNING', 'Start this original release before reviewing publication.');
    changes = view.rows.filter(row => row.state !== 'MATCHES');
  } else {
    const row = view.rows.find(item => item.routeId === routeId);
    if (!row?.before || row.before.retired) fail('RELEASE_CATALOG_NOT_LISTED', 'Choose a currently listed route to withdraw.');
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 256 || /[\x00-\x1f\x7f]/.test(reason))
      fail('RELEASE_CATALOG_REASON_REQUIRED', 'Supply a short reason for withdrawing this listing.');
    changes = [row];
  }
  if (changes.some(row => row.state === 'OTHER_SELLER'))
    fail('RELEASE_CATALOG_OTHER_SELLER', 'The existing listing belongs to a different catalog seller.');
  if (changes.some(row => row.state === 'SIGNER_CHANGED'))
    fail('RELEASE_CATALOG_SIGNER_CHANGED', 'The catalog pin differs from this listing’s original signer. Use its existing seller authority to update or withdraw it.');
  if (changes.some(row => row.before && row.before.sequence >= Number.MAX_SAFE_INTEGER))
    fail('RELEASE_CATALOG_SEQUENCE_LIMIT');
  const content = { schema: REVIEW, action, release: view.release, catalog: view.catalog,
    runtime: action === 'publish' ? view.runtime : null,
    ...(action === 'withdraw' ? { routeId, reason: reason.trim() } : {}),
    changes: changes.map(row => ({ ...row, nextSequence: (row.before?.sequence ?? 0) + 1 })) };
  return { ...content, id: hash(stable(content)) };
}

/** No key access or signatures during review; the exact source and head are retained. */
export async function reviewReleaseCatalog(root, { config, releaseId, action, routeId, reason }) {
  return reviewOf((await collect(root, config, releaseId)).view, { action, routeId, reason });
}

async function readSigningKey(config, expectedFingerprint) {
  const bytes = await readBytes(config.keyFile, 16384, true);
  try {
    const key = createPrivateKey(bytes);
    if (key.asymmetricKeyType !== 'ed25519') fail('RELEASE_CATALOG_KEY_TYPE');
    const publicKey = createPublicKey(key).export({ format: 'der', type: 'spki' });
    if (hash(publicKey) !== expectedFingerprint)
      fail('RELEASE_CATALOG_KEY_MISMATCH', 'The configured signing key differs from the catalog operator’s independently pinned key.');
    return bytes;
  } catch (error) { bytes.fill(0); throw error; }
}

/** Fresh original signatures; original batch/withdrawal head checks own every write. */
export async function applyReleaseCatalog(root, { config, review }) {
  if (!plain(review) || review.schema !== REVIEW || !/^[a-f0-9]{64}$/.test(review.id ?? ''))
    fail('RELEASE_CATALOG_REVIEW_REQUIRED');
  const { id: expected, ...reviewed } = review;
  if (hash(stable(reviewed)) !== expected) fail('RELEASE_CATALOG_REVIEW_CHANGED');
  const source = await collect(root, config, review.release?.id);
  const current = reviewOf(source.view, review);
  if (current.id !== expected) fail('RELEASE_CATALOG_REVIEW_STALE', 'Release, running instance, catalog or configured policy changed. Review the current offer differences.');
  if (!current.changes.length) return { schema: 'stellar-forge.seller-release-catalog-result.v1',
    decision: 'UNCHANGED', reviewId: expected, signaturesIssued: 0, status: source.view };
  const key = await readSigningKey(source.config, current.catalog.publicKeySha256);
  let receipt, signaturesIssued = 0;
  try {
    if (current.action === 'publish') {
      const now = Date.now(), observedAt = new Date(now).toISOString();
      const byRoute = new Map(source.original.offers.map(offer => [offer.routeId, offer]));
      const batch = { schema: SIGNED_BATCH_SCHEMA, admissions: current.changes.map(row => {
        const offer = byRoute.get(row.routeId);
        const proofs = offer.entry.accepts.map((_, selectedAccept) => {
          const nonce = createChallenge(); signaturesIssued++;
          return { nonce, proof: signProof(offer.entry, { nonce, privateKeyPem: key, selectedAccept, now }) };
        });
        return { sellerId: source.config.sellerId, sequence: row.nextSequence,
          sourceURL: source.config.sourceURL, observedAt, sourceBase64: offer.sourceBytes.toString('base64'), proofs };
      }) };
      const prepared = await source.command('preview-batch', { batch });
      if (prepared.review.baseHead !== current.catalog.journalHead || prepared.policySha256 !== current.catalog.policySha256)
        fail('RELEASE_CATALOG_CHANGED', 'The catalog changed before publication. Review its current state.');
      receipt = await source.command('apply-batch', { batch, expectedHead: prepared.review.baseHead,
        expectedPlan: prepared.review.planId, expectedBatch: prepared.batchSha256, expectedPolicy: prepared.policySha256 });
    } else {
      const row = current.changes[0];
      const request = await source.command('prepare-withdrawal', { sellerId: source.config.sellerId,
        catalogKey: row.catalogKey, sourceURL: source.config.sourceURL, reason: current.reason });
      if (request.previousHead !== current.catalog.journalHead || request.sequence !== row.nextSequence ||
          request.catalogKey !== row.catalogKey || request.signer !== row.before.signer)
        fail('RELEASE_CATALOG_CHANGED', 'The current listing changed before withdrawal. Review it again.');
      const envelope = signWithdrawal(request, key); signaturesIssued++;
      receipt = await source.command('apply-withdrawal', { envelope });
    }
  } catch (error) {
    // No automatic write retry. Status reconciles original source hashes/history
    // after a transport failure, including a response lost after durable commit.
    error.reviewId = expected;
    throw error;
  } finally { key.fill(0); }
  const result = { schema: 'stellar-forge.seller-release-catalog-result.v1', action: current.action,
    decision: 'COMMITTED', reviewId: expected, releaseId: current.release.id,
    signaturesIssued, paymentCalls: 0, receipt };
  try { result.status = await releaseCatalogStatus(root, { config: source.config, releaseId: current.release.id }); }
  catch (error) { result.observation = { state: 'REFRESH_REQUIRED', error: error.code ?? 'CATALOG_READBACK_UNAVAILABLE' }; }
  return result;
}
