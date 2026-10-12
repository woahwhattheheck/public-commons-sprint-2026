// MIT. Original complete OData collection tool metadata; native sources load with their provider.
const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const record = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$' };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const page = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } };
const read = { readOnly: true, idempotent: true };
const fields = { type: 'array', minItems: 1, maxItems: 32, uniqueItems: true,
  items: { type: 'string', minLength: 1, maxLength: 240 } };
const pages = { type: 'array', minItems: 1, maxItems: 500, items: { type: 'object', additionalProperties: false,
  required: ['receivedId'], properties: { receivedId: hash, buyerId: hash } } };
const limits = { type: 'object', additionalProperties: false, properties: {
  maxPages: { type: 'integer', minimum: 1, maximum: 10000 },
  maxRows: { type: 'integer', minimum: 1, maximum: 1000000 },
  maxSourceBytes: { type: 'integer', minimum: 1, maximum: 134217728 },
  maxOutputBytes: { type: 'integer', minimum: 1, maximum: 134217728 },
} };
export function odataCollectionTools(tool) {
  const scoped = properties => ({ workspace: alias, liveServiceId: record, ...properties });
  const collection = properties => scoped({ collectionId: record, ...properties });
  const required = ['workspace', 'liveServiceId', 'collectionId'];
  return [
    tool('merchant_odata_collections', 'Page this live service’s original complete and interrupted collections. Each complete record preserves source/query identity, row/page count, completion and its exact Analysis source digest.',
      scoped(page), ['workspace', 'liveServiceId'], read),
    tool('merchant_odata_collection', 'Inspect and page the original saved collection, complete cursor-chain/page metadata, source files and exact downloadable inventory. Each array has its own nextOffset; the original full manifest remains available through merchant_odata_file.',
      collection(page), required, read),
    tool('merchant_odata_collect', 'Assemble one complete collection from ordered original receivedId pages and optional original buyerId request bindings. Retain collectionId across interruptions. Up to500 pages can be inline; a host-declared selection supports the full10000-page native limit without oversized MCP arguments. Original keys, scalar states, cursor continuity and complete Analysis projection limits are enforced.',
      collection({ pages, fields, title: { type: 'string', minLength: 1, maxLength: 240 }, limits, selection: alias }),
      required, { idempotent: true }),
    tool('merchant_odata_collection_rows', 'Read a page of original typed entities from a complete collection. Returns exact collection/source identity and nextOffset; does not repeat a provider request, purchase or projection.',
      collection(page), required, read),
    tool('merchant_odata_collection_source', 'Read the complete original Analysis source document and every required download identity. Its file references use the existing chunk reader. Supply the actual registered Analysis source name and sourceRevision together to obtain the original response-preview mapping, preserving Decimal/Int64 text, native scalar types and explicit state columns.',
      collection({ expectedSha256: hash, source: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
        sourceRevision: { type: 'integer', minimum: 1 } }), required, read),
    tool('merchant_odata_collection_restore', 'Restore the complete original collection from a host-declared collectionSources document or a named collection under another declared workspace. Cross-workspace receiving requires its inspected Analysis source SHA256. The original service binding, complete source files, immutable output and same-collection lease govern receiving.',
      collection({ sourceDocument: alias, sourceWorkspace: alias, sourceLiveServiceId: record,
        sourceCollectionId: record, expectedSha256: hash }), required, { idempotent: true }),
  ];
}
