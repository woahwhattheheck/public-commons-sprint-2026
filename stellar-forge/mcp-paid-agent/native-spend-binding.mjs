/** MIT. Original native MCP request identity, usable without opening a buyer. */
import {createHash} from 'node:crypto';
import {mcpJson, validateMcpInvocation} from './remote-mcp.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ID = /^[A-Za-z0-9._:-]{1,160}$/;
const digest = value => createHash('sha256').update(value).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function fail(code, reason) {
  const error = Object.assign(new Error(code), {code});
  if (reason !== undefined) error.operatorReason = String(reason).slice(0,256);
  throw error;
}
function quoteId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) fail('MCP_SPENDING_QUOTE_REQUIRED');
  return value;
}

/**
 * Bind the complete logical MCP operation. These body bytes describe the
 * approved invocation, not the SDK's JSON-RPC envelope or dynamic session ID.
 * The original native operator separately binds the actual signed MCP resource.
 */
export function mcpSpendingBinding(quote, {actor, service, payer} = {}) {
  quoteId(quote?.quoteId);
  if (!ID.test(actor ?? '') || !ID.test(service ?? '') ||
      typeof payer !== 'string' || !/^[GC][A-Z2-7]{55}$/.test(payer) ||
      quote.method !== 'tools/call') fail('MCP_SPENDING_BINDING_INVALID');
  const invocation = validateMcpInvocation(quote.invocation);
  if (quote.requestUrl !== invocation.endpoint) fail('MCP_SPENDING_ENDPOINT_MISMATCH');
  const accepted = quote.accepted;
  if (!plain(accepted) || accepted.scheme !== 'exact' ||
      !['stellar:testnet','stellar:pubnet'].includes(accepted.network) ||
      typeof accepted.amount !== 'string' || !/^[1-9][0-9]{0,18}$/.test(accepted.amount) ||
      BigInt(accepted.amount) > 9223372036854775807n ||
      !Number.isInteger(accepted.maxTimeoutSeconds) ||
      accepted.maxTimeoutSeconds < 1 || accepted.maxTimeoutSeconds > 86400)
    fail('MCP_SPENDING_TERMS_INVALID');
  const invocationJson = mcpJson({
    endpoint:invocation.endpoint, transport:invocation.transport,
    toolName:invocation.toolName, paymentResourceUrl:invocation.paymentResourceUrl,
    arguments:invocation.arguments, inputSchemaSha256:invocation.inputSchemaSha256,
  }, 128 * 1024);
  const acceptedJson = mcpJson(accepted, 128 * 1024);
  const request = {
    request_id:quote.quoteId, actor, service, network:accepted.network,
    asset:accepted.asset, scheme:accepted.scheme, max_amount:accepted.amount,
    resource:invocation.endpoint, pay_to:accepted.payTo,
    max_timeout_seconds:accepted.maxTimeoutSeconds, method:'POST',
    body_present:true, body_bytes:Buffer.byteLength(invocationJson),
    body_sha256:digest(invocationJson), accepted_terms_sha256:digest(acceptedJson),
  };
  return {quoteId:quote.quoteId, payer, invocationJson, acceptedJson, request};
}

