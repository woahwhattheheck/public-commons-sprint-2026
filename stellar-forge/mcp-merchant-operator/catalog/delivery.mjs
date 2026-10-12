// MIT. Metadata for the original release-store destination and receiving tools.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';
const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const transfer = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const destination = { type: 'string', pattern: '^[a-z][a-z0-9-]{0,47}$' };
const identity = { type: 'string', minLength: 1, maxLength: 128 };
export function deliveryTools(tool) {
  const settings = { type: 'object', additionalProperties: false, properties: {
    id: destination, label: { type: 'string', minLength: 1, maxLength: 100 },
    url: { type: 'string', minLength: 1, maxLength: 4096 },
    allowedHost: { type: 'string', minLength: 1, maxLength: 253 },
    secretEnv: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,64}$' },
    routeIds: { type: 'array', maxItems: 100, uniqueItems: true,
      items: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,80}$' } },
    networks: { type: 'array', maxItems: 32, uniqueItems: true,
      items: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,32}:[A-Za-z0-9:_-]{1,100}$' } },
    history: { type: 'string', enum: ['all', 'new'] }, paused: { type: 'boolean' },
    expectedRevision: { type: 'integer', minimum: 1 }, eventId: digest, expectedDeliveryRevision: digest,
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    concurrency: { type: 'integer', minimum: 1, maximum: 16 },
    destinationConcurrency: { type: 'integer', minimum: 1, maximum: 16 },
    timeoutMs: { type: 'integer', minimum: 100, maximum: 60000 },
    pollMs: { type: 'integer', minimum: 100, maximum: 60000 },
  } };
  return [
    tool('merchant_delivery_status', 'Read the configured single release store’s original settlement producer, journal warnings, destination cursors, worker and lease. Start that original seller once to initialize its retained source.',
      {}, [], { readOnly: true, idempotent: true }),
    tool('merchant_delivery_control', 'Operate that store’s original SF98 destination workspace. Enroll uses a signing environment reference and explicit all/new history; pause/requeue use inspected revisions. Sync copies original receipts. Drain/start send through the original signed HTTPS transport.',
      { action: { type: 'string', enum: ['enroll', 'pause', 'sync', 'drain', 'start', 'stop', 'requeue'] }, input: settings },
      ['action', 'input'], { openWorld: true }),
    tool('merchant_delivery_stop', 'Stop the original destination worker through its existing stop operation. This control remains callable while another host operation is awaiting delivery.',
      {}, [], { idempotent: true }),
    tool('merchant_delivery_events', 'Page one original destination’s event IDs, settlement payloads, outcomes and maintenance revisions.',
      { id: destination, state: { type: 'string', enum: ['ALL', 'PENDING', 'DELIVERED', 'RETRY', 'REQUEUE', 'EXHAUSTED'] },
        offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 200 } },
      ['id'], { readOnly: true, idempotent: true }),
    tool('merchant_delivery_handoff', 'Read the original delivery workspace handoff, source continuity, destination cursors and environment references.',
      {}, [], { readOnly: true, idempotent: true }),
    tool('merchant_delivery_transfers', 'List retained immutable SF98 exchanges. They remain available independently of the live source and include original receiving arguments.',
      { after: transfer, limit: { type: 'integer', minimum: 1, maximum: 50 } },
      [], { readOnly: true, idempotent: true }),
    tool('merchant_delivery_transfer', 'Capture the source fingerprint last reviewed in delivery status under a chosen transfer ID. After a lost response, repeat the same ID and fingerprint to reopen its exact retained capture.',
      { id: transfer, expectedSourceFingerprint: digest }, ['id', 'expectedSourceFingerprint'], { idempotent: true }),
    tool('merchant_delivery_manifest', 'Inspect the original retained exchange and each native file’s exact bytes and SHA-256. Use the exchange fingerprint for download and original receiving.',
      { id: transfer, expectedFingerprint: digest }, ['id'], { readOnly: true, idempotent: true }),
    tool('merchant_delivery_file', 'Read an original retained exchange member through the existing verified reader. Repeat its inspected fingerprint, relative name and SHA-256; use readId and offset to continue.',
      { id: transfer, expectedFingerprint: digest, expectedSha256: digest,
        name: { type: 'string', pattern: '^(?:manifest\\.json|source/(?:manifest\\.json|events\\.ndjson|deliveries\\.ndjson)|destinations/[a-z][a-z0-9-]{0,47}/(?:manifest\\.json|events\\.ndjson|deliveries\\.ndjson))$' },
        readId: identity, offset: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } },
      ['id', 'expectedFingerprint', 'name', 'expectedSha256'], { readOnly: true, idempotent: true }),
    tool('merchant_delivery_file_release', 'Close this store and transfer’s temporary file read while preserving the original exchange for receiving or resumed download.',
      { id: transfer, readId: identity }, ['id', 'readId'], { readOnly: true, idempotent: true }),
  ];
}
