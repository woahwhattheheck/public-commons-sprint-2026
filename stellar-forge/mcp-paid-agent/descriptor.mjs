/** SF32 read-only projection of one cached discovery record. MIT. */
import { requiredQueryKeys } from './query-requirements.mjs';
import { prepareMcpInvocation, MCP_ARGUMENT_BYTES } from './remote-mcp.mjs';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function immutableCopy(value) {
  const copy = structuredClone(value);
  const pending = [copy], seen = new WeakSet();
  while (pending.length) {
    const current = pending.pop();
    if (current === null || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    for (const child of Object.values(current)) pending.push(child);
    Object.freeze(current);
  }
  return copy;
}

/** The broker owns handle lookup/expiry. This function never fetches a seller,
 * creates a quote, validates a payment option, approves or executes a call. */
export function describeDiscoveredResource(record, { handle, allowedOrigin, expiresAt, remoteMcpPolicies = [] }) {
  const advertisedKeys = plain(record.input?.queryParams) ? Object.keys(record.input.queryParams) : [];
  let requiredKeys=null, requiredKeysError=null;
  try { requiredKeys=requiredQueryKeys(record.bazaar?.schema); }
  catch(error) { requiredKeysError={code:error.code,message:error.message}; }
  let remote = null, remoteError = null;
  if (record.type === 'mcp') {
    try { remote = prepareMcpInvocation(record, {arguments:{}}, remoteMcpPolicies); }
    catch(error) { remoteError = {code:error.code, message:error.message}; }
  }
  return immutableCopy({
    handle,
    resource: record.resource,
    bazaar: record.bazaar,
    // Preserve each complete eligible option and its original preview index.
    // Describing metadata does not make an option valid or authorize payment.
    accepts: record.accepts,
    source: record.source,
    expiresAt,
    preview: {
      allowedOrigin,
      resourceType: record.type,
      method: record.type === 'mcp' ? 'tools/call' : record.input?.method ?? null,
      resourceTypeSupported: ['http', 'mcp'].includes(record.type),
      methodSupported: record.type === 'mcp' ? remote !== null : ['GET', 'HEAD'].includes(record.input?.method),
      supportedResourceType: record.type === 'mcp' ? 'mcp' : 'http',
      supportedResourceTypes: ['http', 'mcp'],
      supportedMethods: record.type === 'mcp' ? ['tools/call'] : ['GET', 'HEAD'],
      ...(record.type === 'mcp' ? {remoteMcp: remote ? {transport:remote.transport,
        endpoint:remote.endpoint, toolName:remote.toolName, paymentResourceUrl:remote.paymentResourceUrl,
        inputSchemaSha256:remote.inputSchemaSha256} : null, remoteMcpError:remoteError} : {}),
      input: record.type === 'mcp' ? {
        container:'arguments', valueType:'JSON object', maxBytes:MCP_ARGUMENT_BYTES,
        schemaSource:'bazaar.info.input.inputSchema', additionalContainers:false,
        validation:'The live tool schema must match the original advertisement; the server validates argument values.',
      } : {
        container: 'query',
        advertisedKeys,
        requiredKeys,
        requiredKeysError,
        requiredKeysSource: 'bazaar.schema.properties.input.properties.queryParams.required',
        requiredKeysCheck: 'Presence in the final request URL only; fixed query values count. No defaults, type checks, refs or conditional schema evaluation.',
        valueType: 'string',
        maxKeys: 30,
        maxKeyLength: 100,
        maxValueLength: 1024,
        lengthUnit: 'UTF-16 code units',
        disallowedControlCharacters: 'U+0000–U+001F and U+007F',
        additionalContainers: false,
      },
    },
  });
}

