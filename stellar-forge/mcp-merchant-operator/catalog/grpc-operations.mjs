// MIT. Original gRPC operational capture, incident review and full receiving tools.
const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const digest = { type: 'string', pattern: '^[0-9a-f]{64}$' };
const uuid = { type: 'string', pattern: '^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$' };
const text = maximum => ({ type: 'string', maxLength: maximum });
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const date = { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] };
const selection = object({ from: date, to: date, revisions: { type: 'array', maxItems: 500, uniqueItems: true, items: digest },
  methods: { type: 'array', maxItems: 500, uniqueItems: true, items: text(1024) }, includeHealth: { type: 'boolean' } });
const review = object({ state: { enum: ['draft', 'reviewed'] }, reviewer: text(200), note: text(4000) });
const link = object({ kind: { enum: ['call', 'health', 'revision'] }, id: { type: 'string', maxLength: 64 },
  sequence: { type: 'integer', minimum: 1 } }, ['kind', 'id']);
const action = object({ id: uuid, title: text(400), owner: text(200), state: { enum: ['planned', 'in-progress', 'completed', 'cancelled'] },
  dueAt: date, note: text(4000) }, ['id', 'title', 'state']);
const edit = object({ title: { type: 'string', minLength: 1, maxLength: 200 }, severity: { enum: ['low', 'medium', 'high', 'critical'] },
  state: { enum: ['open', 'investigating', 'monitoring', 'resolved'] }, summary: text(4000), impact: text(4000), findings: text(12000),
  review, links: { type: 'array', items: link, maxItems: 1000 }, actions: { type: 'array', items: action, maxItems: 1000 } }, ['title']);
const paging = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 250 }, expectedSnapshot: digest };
const read = { readOnly: true, idempotent: true }, write = { idempotent: true };
export function grpcOperationsTools(tool) {
  return [
    tool('merchant_grpc_operations_capture', 'Capture selected original workspace call records, exact source revisions and matching frozen health event prefixes. Save captureId before dispatch; its same selection reopens its first completed capture. This operation does not call the upstream service.',
      { workspace: alias, captureId: uuid, selection }, ['workspace', 'captureId'], write),
    tool('merchant_grpc_operations_captures', 'Page every saved original operations capture with its complete outcome counts and selection.', { workspace: alias, ...paging }, ['workspace'], read),
    tool('merchant_grpc_operations_read', 'Read captured call/health timelines, method and source-revision outcome cohorts, or one complete original record. Page with the capture SHA256; recorded elapsed includes native acquisition and persistence. Frozen health events remain point observations.',
      { workspace: alias, captureId: uuid, section: { enum: ['summary', 'calls', 'health', 'timeline', 'methods', 'revisions', 'call', 'health-observation', 'source'] },
        recordId: { type: 'string', maxLength: 64 }, search: text(1000), phase: text(80), method: text(1024), revision: digest, ...paging }, ['workspace', 'captureId'], read),
    tool('merchant_grpc_operations_cases', 'Page saved incident cases, current review and outstanding corrective actions.', { workspace: alias, state: text(30), severity: text(30), search: text(1000), ...paging }, ['workspace'], read),
    tool('merchant_grpc_operations_case', 'Open an exact retained incident revision and its complete history. Historical revisions remain available while new revisions are saved.',
      { workspace: alias, caseId: uuid, version: { type: 'integer', minimum: 1 } }, ['workspace', 'caseId'], read),
    tool('merchant_grpc_operations_save', 'Create or revise a reviewed incident over one immutable operations capture. Preserve action IDs, link original call/health/source records, and use the observed current version. Save operationId and the complete edit before dispatch; exact retries return the first saved revision.',
      { workspace: alias, operationId: uuid, caseId: uuid, captureId: uuid, expectedVersion: { type: 'integer', minimum: 0 }, edit },
      ['workspace', 'operationId', 'caseId', 'captureId', 'expectedVersion', 'edit'], write),
    tool('merchant_grpc_operations_export', 'Publish the complete selected incident revision, all predecessor revisions and its original operations capture. Receives five original files: full JSON, calls/health/actions CSV and readable HTML report through the existing retained-file transport.',
      { workspace: alias, caseId: uuid, version: { type: 'integer', minimum: 1 } }, ['workspace', 'caseId', 'version'], write),
    tool('merchant_grpc_operations_receive', 'Receive a complete operations review into this original workspace from a host-declared operations JSON file or retained operations export. Preserves the original capture, incident revisions and action IDs; accepts matching history prefixes and rejects divergent edits.',
      { workspace: alias, operationId: uuid, file: alias, exportId: digest }, ['workspace', 'operationId'], write),
  ];
}
