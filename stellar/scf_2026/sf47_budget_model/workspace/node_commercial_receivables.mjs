/** Original ReceivablesClient bridge. The running accounting server owns its ledger. */
import {pathToFileURL} from 'node:url';
import {ReceivablesClient} from '../../../scf-starforge-20261009/merchant-settlement-accounting/receivables/client.mjs';

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);
const MAX_INPUT = 4 * 1024 * 1024;
const MAX_ARCHIVE = 256 * 1024 * 1024;

function problem(code, message, status = 422, details) {
  return Object.assign(new Error(message), {code, status, details});
}
export function endpointUrl(raw) {
  let url;
  try { url = new URL(String(raw)); } catch {
    throw problem('COMMERCIAL_ENDPOINT_INVALID', 'Enter the full local receivables API address.');
  }
  if (url.protocol !== 'http:' || !LOCAL.has(url.hostname.toLowerCase()) || url.username ||
      url.password || url.search || url.hash || url.pathname.includes('//')) {
    throw problem('COMMERCIAL_ENDPOINT_INVALID', 'Use the local accounting server address, without credentials or query parameters.');
  }
  return url.href.replace(/\/+$/, '');
}
function binding(identity) {
  if (!identity || !/^[a-f0-9]{64}$/.test(identity.workspaceId || '') ||
      !/^[a-f0-9]{64}$/.test(identity.sourcesSha256 || '')) {
    throw problem('COMMERCIAL_IDENTITY_UNAVAILABLE', 'Update the original accounting server to expose its workspace identity.', 409);
  }
  return {workspaceId: identity.workspaceId, sourcesSha256: identity.sourcesSha256};
}
async function archiveBytes(response) {
  const size = Number(response.headers.get('content-length') || 0);
  if (size > MAX_ARCHIVE) throw problem('COMMERCIAL_EXPORT_TOO_LARGE', 'Use the original accounting export for an archive exceeding the native customer export envelope.', 413);
  const chunks = []; let received = 0;
  for await (const chunk of response.body) {
    received += chunk.byteLength;
    if (received > MAX_ARCHIVE) throw problem('COMMERCIAL_EXPORT_TOO_LARGE', 'Use the original accounting export for an archive exceeding the native customer export envelope.', 413);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
export async function commercialReceivablesRequest({operation, endpoint, payload = {}}, {fetch = globalThis.fetch} = {}) {
  if (!endpoint || typeof endpoint !== 'object') throw problem('COMMERCIAL_CONNECTION_REQUIRED', 'Choose a saved accounting connection.');
  const baseUrl = endpointUrl(endpoint.baseUrl);
  const expected = operation === 'connect' ? null : binding(endpoint);
  const fetcher = async (url, options) => {
    const signal = AbortSignal.timeout(20000);
    return fetch(url, {...options, signal});
  };
  const client = new ReceivablesClient({baseUrl, fetch: fetcher,
    ...(expected ? {expectedWorkspaceId: expected.workspaceId, expectedSourcesSha256: expected.sourcesSha256} : {})});
  if (operation === 'connect' || operation === 'identity') {
    const identity = await client.identity();
    return {schema: identity.schema, ...binding(identity), baseUrl};
  }
  const {endpointId, invoiceId, customerId, ...body} = payload;
  if (operation === 'list') return client.state();
  if (operation === 'customers') {
    const state = await client.state();
    return {revision: state.revision, issuer: state.issuer, customers: state.customers};
  }
  if (operation === 'draft') return client.saveDraft({...body, customerId});
  if (operation === 'preview') return client.preview(invoiceId);
  if (operation === 'issue') return client.issue(invoiceId, body);
  if (operation === 'void') return client.voidInvoice(invoiceId, body);
  if (operation === 'credit') return client.credit(invoiceId, body);
  if (operation === 'detail') return client.detail(invoiceId);
  if (operation === 'document') {
    const response = await client.file(invoiceId, body.name);
    const bytes = await archiveBytes(response);
    return {filename: body.name, mediaType: response.headers.get('content-type') || 'application/octet-stream',
      contentBase64: bytes.toString('base64')};
  }
  if (operation === 'export') {
    // The original archive includes its own customer JSON and invoice documents.
    // One archive snapshot avoids stitching JSON from a different ledger revision.
    const response = await client.customerFile(customerId, 'account.tar');
    const bytes = await archiveBytes(response);
    return {filename: 'customer-account.tar', mediaType: 'application/x-tar',
      contentBase64: bytes.toString('base64')};
  }
  throw problem('COMMERCIAL_OPERATION_UNKNOWN', 'Choose an available commercial billing operation.', 404);
}
async function main() {
  const chunks = []; let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_INPUT) throw problem('COMMERCIAL_INPUT_TOO_LARGE', 'The billing request exceeds the input limit.', 413);
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw problem('COMMERCIAL_INPUT_INVALID', 'Send a JSON billing request.'); }
  const result = await commercialReceivablesRequest(value);
  process.stdout.write(JSON.stringify({ok: true, result}, (_, item) => typeof item === 'bigint' ? String(item) : item) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stdout.write(JSON.stringify({ok: false, error: {
      code: error?.code || 'COMMERCIAL_TRANSPORT_FAILED',
      message: error?.message || 'The accounting server response could not be read. Retry the saved billing operation.',
      status: error?.status || 502, details: error?.details || null,
    }}) + '\n');
    process.exitCode = 1;
  });
}
