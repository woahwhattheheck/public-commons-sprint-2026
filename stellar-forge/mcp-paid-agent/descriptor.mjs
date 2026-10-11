/** SF32 read-only projection of one cached discovery record. MIT. */
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
export function describeDiscoveredResource(record, { handle, allowedOrigin, expiresAt }) {
  const advertisedKeys = plain(record.input?.queryParams) ? Object.keys(record.input.queryParams) : [];
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
      method: record.input?.method ?? null,
      resourceTypeSupported: record.type === 'http',
      methodSupported: record.type === 'http' && ['GET', 'HEAD'].includes(record.input?.method),
      supportedResourceType: 'http',
      supportedMethods: ['GET', 'HEAD'],
      input: {
        container: 'query',
        advertisedKeys,
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
