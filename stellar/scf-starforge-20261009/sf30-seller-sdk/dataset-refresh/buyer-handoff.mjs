// MIT. Actual original seller offer -> original SF88 offline preparation.
import { createHash } from 'node:crypto';
import { prepareReview } from '../../sf88-operator-buyer-cli/prepare.mjs';
import { validateDatasetQuery } from '../../sf88-operator-buyer-cli/dataset-page.mjs';

const fault = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const bytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const sha256 = value => createHash('sha256').update(value).digest('hex');

export function datasetBuyerEndpoint(seller, resource) {
  let local, remote;
  try { local = new URL(seller); remote = new URL(resource); } catch {
    throw fault('BUYER_SOURCE_REQUIRED', 'Configure the existing local seller address and its public HTTPS resource.');
  }
  if (local.protocol !== 'http:' || local.hostname !== '127.0.0.1' || !local.port ||
      local.origin !== seller || local.username || local.password || local.search || local.hash ||
      remote.protocol !== 'https:' || remote.href !== resource || remote.username || remote.password || remote.search || remote.hash)
    throw fault('BUYER_SOURCE_REQUIRED', 'Use http://127.0.0.1:PORT and the exact advertised HTTPS resource without query or credentials.');
  return { seller, resource };
}

async function originalJson(url) {
  let response;
  try {
    response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { accept: 'application/json' } });
    if (response.status !== 200 || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? ''))
      throw fault('SELLER_OFFER_UNAVAILABLE', 'The selected original seller did not return its JSON offer metadata.', 502);
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 1048576) throw fault('SELLER_OFFER_TOO_LARGE', 'The original seller metadata exceeds 1 MiB.', 502);
      chunks.push(chunk);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch (error) {
    if (error.status) throw error;
    throw fault('SELLER_OFFER_UNAVAILABLE', 'Start the selected original seller, then load its offer again.', 502);
  }
}

/** Read only the fixed original loopback health/offers endpoints. No public
 * resource request, signer, private control capability or buyer key is used. */
export async function readDatasetBuyerOffer({ seller, resource, snapshot, query }) {
  datasetBuyerEndpoint(seller, resource);
  if (!/^[a-f0-9]{64}$/.test(snapshot ?? '') || typeof query !== 'string' || query.length > 8192)
    throw fault('BUYER_SELECTION_REQUIRED', 'Select a published snapshot and run its first-page query.');
  const url = new URL(resource);
  url.search = query;
  let parameters;
  try { parameters = validateDatasetQuery(url.href, { initial: true }); }
  catch (error) { throw fault(error.code ?? 'BUYER_QUERY_INVALID', 'Run a valid query from its first page before preparing the buyer.'); }
  if (parameters.has('snapshot'))
    throw fault('BUYER_SELECTION_REQUIRED', 'Select the version in the workspace; its snapshot is added to the buyer URL.');
  const [health, offers] = await Promise.all([
    originalJson(seller + '/_seller/health'), originalJson(seller + '/_seller/offers'),
  ]);
  const routes = health?.routes?.filter(route => route.method === 'GET' && route.url === resource);
  const matches = Array.isArray(offers) ? offers.filter(offer => offer?.resource?.url === resource &&
    offer.extensions?.bazaar?.info?.input?.method === 'GET') : [];
  if (!Array.isArray(routes) || routes.length !== 1 || !routes[0].admission || matches.length !== 1 ||
      !['CHALLENGE_ONLY', 'NATIVE_X402'].includes(health.mode))
    throw fault('SELLER_DATASET_OFFER_MISMATCH', 'The selected seller must advertise exactly this GET resource with its original admission hook.', 409);
  const offer = matches[0], bazaar = offer.extensions.bazaar;
  const schema = bazaar.schema?.properties?.input?.properties?.queryParams;
  if (!object(schema?.properties) || schema.properties.snapshot?.type !== 'string' ||
      schema.required?.includes('snapshot') || Object.hasOwn(schema.properties.snapshot, 'default') ||
      !Object.hasOwn(bazaar.info.input.queryParams ?? {}, 'snapshot'))
    throw fault('SNAPSHOT_SELECTION_NOT_ADVERTISED', 'Configure the original versioned seller with --snapshot-selection, restart it, and reload its offer.', 409);
  if (!Array.isArray(offer.accepts) || !offer.accepts.length || offer.accepts.length > 32)
    throw fault('SELLER_PAYMENT_TERMS_INVALID', 'The original seller has no supported payment alternatives.', 502);
  for (const name of parameters.keys()) {
    if (!Object.hasOwn(schema.properties, name))
      throw fault('SELLER_QUERY_NOT_ADVERTISED', `The current seller does not advertise query parameter ${name}.`, 409);
  }
  parameters.set('snapshot', snapshot);
  url.search = parameters.toString();
  const discovery = bytes({ resources: [offer] });
  return { mode: health.mode, seller, resource, url: url.href, snapshot,
    query: parameters.toString(), offerSha256: sha256(discovery),
    accepts: structuredClone(offer.accepts), offer: structuredClone(offer) };
}

/** The caller reloads the offer and compares the displayed digest before this
 * pure original preparation. Output is an SF88 config, never an authorization. */
export function prepareDatasetBuyer(review, { intentId, acceptIndex, offerSha256 }) {
  if (review.offerSha256 !== offerSha256)
    throw fault('SELLER_OFFER_CHANGED', 'The seller offer changed. Load and review its current payment terms.', 409);
  let prepared;
  try {
    prepared = prepareReview(bytes({ resources: [review.offer] }), {
      rowIndex: 0, acceptIndex, intentId, method: 'GET', url: review.url,
    });
  } catch (error) {
    throw fault(error.code ?? 'BUYER_PREPARATION_FAILED', 'Choose an advertised payment alternative and a valid unique buyer intent ID.');
  }
  return { mode: 'ORIGINAL_SF88_CONFIG_PREPARED', sellerMode: review.mode,
    snapshot: review.snapshot, url: review.url, offerSha256: review.offerSha256,
    configSha256: prepared.configSha256, config: prepared.draft,
    configText: prepared.data.toString('utf8') };
}
