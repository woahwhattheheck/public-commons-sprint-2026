// MIT. Retain and open the original SF30 HTTP backend in the existing commerce session.
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { readPrivateFile, absolute, parseJson } from '../sf103-native-buyer-signer/operator.mjs';
import { inspectUpstreamConfiguration } from '../sf82-seller-pilot/release-upstreams.mjs';
import { createUpstreamApplication } from '../sf30-seller-sdk/upstream.mjs';
import { loadOperationTicket, operationTicketView } from '../sf88-operator-buyer-cli/operation-ticket.mjs';

const LIMIT = 1048576;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const need = (ok, code) => {
  if (!ok) throw Object.assign(new Error(code), {code});
};

/** Original compiler inspection, without resolving credentials or opening a ledger. */
export async function readUpstreamCommerce(file, sellerConfig,
  {allowLoopback = false, expectedSha256} = {}) {
  need(typeof allowLoopback === 'boolean', 'COMMERCE_UPSTREAM_LOOPBACK_INVALID');
  const bytes = await readPrivateFile(file, LIMIT);
  const sha256 = sha(bytes);
  need(expectedSha256 === undefined || /^[a-f0-9]{64}$/.test(expectedSha256),
    'COMMERCE_UPSTREAM_SNAPSHOT_INVALID');
  need(expectedSha256 === undefined || sha256 === expectedSha256,
    'COMMERCE_UPSTREAM_CONFIG_CHANGED');
  let review;
  try { review = inspectUpstreamConfiguration(bytes, sellerConfig, allowLoopback); }
  catch { throw Object.assign(new Error('COMMERCE_UPSTREAM_CONFIG_INVALID'),
    {code:'COMMERCE_UPSTREAM_CONFIG_INVALID'}); }
  const configuration = parseJson(bytes);
  const result = {file, sha256, bytes:bytes.length, allowLoopback, configuration, review};
  Object.defineProperty(result, 'sourceBytes', {value:bytes});
  return Object.freeze(result);
}

/** Metadata projection shared by setup, saved-session inspection and the UI. */
export function describeUpstreamCommerce(reviewed) {
  return reviewed ? {file:reviewed.file, sha256:reviewed.sha256, bytes:reviewed.bytes,
    allowLoopback:reviewed.allowLoopback, ...reviewed.review} : null;
}

/** Copy the reviewed declaration exactly into a newly created private session. */
export async function retainUpstreamCommerce(file, reviewed) {
  absolute(file);
  need(Buffer.isBuffer(reviewed?.sourceBytes) &&
    reviewed.sourceBytes.length <= LIMIT && sha(reviewed.sourceBytes) === reviewed.sha256,
    'COMMERCE_UPSTREAM_SNAPSHOT_INVALID');
  const handle = await open(file, 'wx', 0o600);
  try { await handle.writeFile(reviewed.sourceBytes); await handle.sync(); }
  finally { await handle.close(); }
  return {file, sha256:reviewed.sha256, bytes:reviewed.bytes};
}

/** Capture actual configured values once, using the original handler and policy. */
export async function openUpstreamCommerce(file, sellerConfig,
  {allowLoopback = false, expectedSha256, environment = process.env} = {}) {
  const reviewed = await readUpstreamCommerce(file, sellerConfig,
    {allowLoopback, expectedSha256});
  const application = createUpstreamApplication(sellerConfig, reviewed.configuration,
    {allowLoopback, env:{...environment}});
  return {application, review:reviewed.review};
}

/** Use the original SF88 ticket reader and the original binding's header contract. */
export async function readUpstreamPurchaseTicket(selected, operation, upstream, route) {
  const binding = upstream?.review.bindings[route.handler];
  const idempotency = binding?.idempotency;
  need(!idempotency || selected.ticketFile !== undefined,
    'COMMERCE_UPSTREAM_OPERATION_TICKET_REQUIRED');
  const ticket = await loadOperationTicket({...operation,
    ...(selected.ticketFile === undefined ? {} : {ticketFile:selected.ticketFile}),
    ...(selected.ticketHeader === undefined ? {} : {ticketHeader:selected.ticketHeader})},
  {requireCurrent:true});
  need(!idempotency || ticket?.requestHeader ===
    (idempotency.requestHeader ?? 'x-merchant-operation'),
  'COMMERCE_UPSTREAM_OPERATION_HEADER_MISMATCH');
  return ticket;
}

/** Public review data contains the original reader's metadata, never the bearer. */
export { operationTicketView as upstreamPurchaseTicketView };
