// MIT. Original live offer selection and original SF88 buyer configuration.
import { prepareReview } from '../../sf88-operator-buyer-cli/prepare.mjs';
import { compileMongoQueries, bindMongoParameters } from './declaration.mjs';
import { encode, digest, fail, integer } from './common.mjs';

async function originalJson(url) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000), headers: { accept: 'application/json' } });
  if (response.status !== 200) fail('MONGODB_SELLER_METADATA_UNAVAILABLE', 502);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length; if (size > 1048576) fail('MONGODB_SELLER_METADATA_TOO_LARGE', 502); chunks.push(chunk);
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}
export async function readMongoBuyerOffer({ seller, service, source, routeId, input } = {}) {
  let local;
  try { local = new URL(seller); } catch { fail('MONGODB_LOCAL_SELLER_REQUIRED'); }
  if (local.protocol !== 'http:' || local.hostname !== '127.0.0.1' || !local.port || local.origin !== seller)
    fail('MONGODB_LOCAL_SELLER_REQUIRED');
  const route = service?.routes?.find(value => value.id === routeId), binding = source?.bindings?.[routeId];
  if (!route || !binding) fail('MONGODB_ROUTE_BINDING_REQUIRED');
  const compiled = compileMongoQueries(source.queries); bindMongoParameters(compiled[binding.query], input);
  const [health, offers] = await Promise.all([originalJson(seller + '/_seller/health'), originalJson(seller + '/_seller/offers')]);
  const method = route.offer.extensions.bazaar.info.input.method, resource = route.offer.resource.url;
  const matches = Array.isArray(offers) ? offers.filter(offer => offer.resource?.url === resource && offer.extensions?.bazaar?.info?.input?.method === method) : [];
  if (matches.length !== 1 || !health.routes?.some(value => value.url === resource && value.method === method && value.admission))
    fail('MONGODB_SELLER_OFFER_CHANGED', 409);
  const offer = matches[0];
  if (JSON.stringify(offer.accepts) !== JSON.stringify(route.offer.accepts)) fail('MONGODB_SELLER_PAYMENT_TERMS_CHANGED', 409);
  const url = new URL(resource);
  if (binding.input === 'query') for (const [key, value] of Object.entries(input)) {
    if (value === null) fail('MONGODB_QUERY_CANNOT_TRANSMIT_NULL');
    url.searchParams.set(key, String(value));
  }
  const discovery = encode({ resources: [offer] });
  return { schema: 'stellar-forge.mongodb-buyer-review.v1', sellerMode: health.mode, routeId, query: binding.query,
    method, url: url.href, input: structuredClone(input), inputLocation: binding.input,
    offer, accepts: structuredClone(offer.accepts), offerSha256: digest(discovery),
    ...(binding.input === 'body' ? { bodyText: encode(input).toString('utf8') } : {}) };
}
export function prepareMongoBuyer(review, { intentId, acceptIndex, offerSha256, bodyFile, responseOut } = {}) {
  if (offerSha256 !== review?.offerSha256) fail('MONGODB_SELLER_OFFER_CHANGED', 409);
  integer(acceptIndex, 0, review.accepts.length - 1, 'MONGODB_PAYMENT_SELECTION_REQUIRED');
  if (review.inputLocation === 'body' && typeof bodyFile !== 'string') fail('MONGODB_BUYER_BODY_FILE_REQUIRED');
  if (review.inputLocation === 'query' && bodyFile !== undefined) fail('MONGODB_BUYER_BODY_NOT_USED');
  const prepared = prepareReview(encode({ resources: [review.offer] }), {
    rowIndex: 0, acceptIndex, intentId, method: review.method, url: review.url,
    ...(bodyFile === undefined ? {} : { bodyFile, headers: { 'Content-Type': 'application/json' } }),
    ...(responseOut === undefined ? {} : { responseOut }),
  });
  return { schema: 'stellar-forge.mongodb-buyer-prepared.v1', sellerMode: review.sellerMode,
    config: prepared.draft, configText: prepared.data.toString('utf8'), configSha256: prepared.configSha256,
    offerSha256, ...(review.bodyText ? { bodyText: review.bodyText } : {}) };
}
