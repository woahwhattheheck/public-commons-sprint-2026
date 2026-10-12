// MIT. Agent operations over the original retained service-health workspace.
const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const digest = { type: 'string', pattern: '^[0-9a-f]{64}$' };
const uuid = { type: 'string', pattern: '^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$' };
const integer = { type: 'integer', minimum: 0 };
const selection = { workspace: alias }, operation = { ...selection, operationId: uuid };
const timeoutMs = { type: 'integer', minimum: 1, maximum: 300000 };
const service = { type: 'string', maxLength: 1024 };
const request = { oneOf: [
  { type: 'object', properties: { kind: { const: 'check' }, service, timeoutMs }, required: ['kind'], additionalProperties: false },
  { type: 'object', properties: { kind: { const: 'list' }, timeoutMs }, required: ['kind'], additionalProperties: false },
  { type: 'object', properties: { kind: { const: 'watch' }, service, timeoutMs,
    durationMs: { type: 'integer', minimum: 1, maximum: 3600000 },
    maxEvents: { type: 'integer', minimum: 1, maximum: 10000 } }, required: ['kind'], additionalProperties: false },
] };
const read = { readOnly: true, idempotent: true };
export function grpcHealthTools(tool) {
  return [
    tool('merchant_grpc_health_observations', 'Page original retained Check, List and Watch observations. Each record keeps its saved revision, endpoint, native status, original deadline and operation UUID.', { ...selection, revision: digest,
      offset: integer, limit: { type: 'integer', minimum: 1, maximum: 250 }, expectedSnapshot: digest }, ['workspace'], read),
    tool('merchant_grpc_health_start', 'Start a standard health observation on the current saved revision using its original TLS and metadata references. Save operationId before dispatch. Repeating it reopens its original observations. Check and List finish in the original workspace; Watch runs there until its original duration/event limit or explicit stop.', { ...operation, revision: digest, request }, ['workspace', 'operationId', 'revision', 'request'], { openWorld: true, idempotent: true }),
    tool('merchant_grpc_health_read', 'Read the original health operation without another native RPC. Events and List services are completely paged. Pin throughSequence plus expectedSnapshot for a stable page sequence; omit that pair to read the latest durable history. Empty service means whole-server health.', { ...operation,
      section: { type: 'string', enum: ['summary', 'events', 'services'] }, afterSequence: integer,
      throughSequence: integer, expectedSnapshot: digest, limit: { type: 'integer', minimum: 1, maximum: 250 },
      serviceFilter: { type: 'string', maxLength: 512 } }, ['workspace', 'operationId'], read),
    tool('merchant_grpc_health_stop', 'Cancel and close this exact native health observation, awaiting original channel closure and retaining its history.', operation, ['workspace', 'operationId'], { openWorld: true, idempotent: true }),
    tool('merchant_grpc_health_resume', 'Explicitly reconnect an interrupted or stopped Watch within its original deadline and remaining event budget. Select its original saved revision first and use its observed version. A completed unary probe remains its first original result.', { ...operation, expectedVersion: integer }, ['workspace', 'operationId', 'expectedVersion'], { openWorld: true, idempotent: true }),
    tool('merchant_grpc_health_export', 'Freeze a complete health observation for original resumable file delivery. A requested throughSequence and expectedSnapshot reproduce the same old event prefix after the live Watch advances. The export binds the original UUID, revision, source, protocol, full chained history and complete snapshot SHA256.', { ...operation,
      expectedVersion: integer, throughSequence: integer, expectedSnapshot: digest }, ['workspace', 'operationId'], { idempotent: true }),
  ];
}
