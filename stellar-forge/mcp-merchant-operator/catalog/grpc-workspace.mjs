// MIT. Original tool metadata; provider runtimes load only when selected.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

const SHA = /^[0-9a-f]{64}$/;

const ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

const alias = { type: 'string', pattern: ALIAS.source };

const digest = { type: 'string', pattern: SHA.source };

const uuid = { type: 'string', pattern: UUID.source };

const selection = { workspace: alias };

const revision = { ...selection, revision: digest };

const generation = { type: 'integer', minimum: 0 };

const baseRevision = { anyOf: [digest, { type: 'null' }] };

const page = { offset: generation, limit: { type: 'integer', minimum: 1, maximum: 250 }, expectedSnapshot: digest };

const methodName = { type: 'string', minLength: 1, maxLength: 1024 };

const reason = { type: 'string', minLength: 1, maxLength: 240 };

const instance = { type: 'string', minLength: 1, maxLength: 160 };

const read = { readOnly: true, idempotent: true };

function grpcWorkspaceTools(tool) {
  return [
    tool('merchant_grpc_workspaces', 'List original gRPC workspaces and host-declared capture/request/receiving handles.', {}, [], read),
    tool('merchant_grpc_status', 'Read the original current revision, generation, native runtime and complete inventory counts. Recover here after an interrupted action.', selection, ['workspace'], read),
    tool('merchant_grpc_inventory', 'Page every original revision, preparation, intent or retained call, or complete delivery exports. Continue with the returned snapshot and nextOffset.', { ...selection, kind: { type: 'string', enum: ['revisions', 'prepared', 'intents', 'attempts', 'exports'] }, ...page }, ['workspace', 'kind'], read),
    tool('merchant_grpc_revision', 'Inspect an exact saved revision. Source and plan preserve complete values; methods and routes are paged. The complete captured protobuf closure is available through revision export.', { ...revision, section: { type: 'string', enum: ['summary', 'source', 'plan', 'methods', 'routes'] }, ...page }, ['workspace', 'revision'], read),
    tool('merchant_grpc_capture', 'Capture a host-declared proto/import closure, connection and merchant plan through the original operator. baseRevision is the currently selected revision, or null for a new workspace.', { ...selection, capture: alias, baseRevision, title: { type: 'string', minLength: 1, maxLength: 120 } }, ['workspace', 'capture', 'baseRevision'], {}),
    tool('merchant_grpc_save', 'Save edited connection, exact payment terms or typed requests while preserving the specified revision’s original protobuf closure. Supply the current baseRevision; omitted fields retain the source revision’s values.', { ...revision, baseRevision, source: { type: 'object' }, plan: { type: 'object' }, title: { type: 'string', minLength: 1, maxLength: 120 } }, ['workspace', 'revision', 'baseRevision'], {}),
    tool('merchant_grpc_import', 'Receive a complete original revision from one host file handle or retained revision export into this native workspace. Native validation and baseRevision apply to the imported closure and plan.', { ...selection, file: alias, exportId: digest, baseRevision, title: { type: 'string', minLength: 1, maxLength: 120 } }, ['workspace', 'baseRevision'], {}),
    tool('merchant_grpc_checkout', 'Select an existing saved revision using the original current-revision check. This preserves its original source and history.', { ...revision, baseRevision }, ['workspace', 'revision', 'baseRevision'], {}),
    tool('merchant_grpc_method', 'Read the native exact request/response schema for one method, including presence, enums, bytes and decimal 64-bit values. Large schemas are retained as complete downloadable JSON.', { ...revision, method: methodName }, ['workspace', 'revision', 'method'], read),
    tool('merchant_grpc_review', 'Run the original contract/channel readiness review for the selected saved revision and retain its native review.', revision, ['workspace', 'revision'], { openWorld: true }),
    tool('merchant_grpc_call', 'Intentionally call one selected unary method through the original native service. Choose a stable UUID operationId and exactly one input object or host request file. Repeating the same ID recovers its original outcome.', { ...revision, operationId: uuid, method: methodName, input: { type: 'object' }, file: alias }, ['workspace', 'revision', 'operationId', 'method'], { openWorld: true, idempotent: true }),
    tool('merchant_grpc_attempt', 'Recover the original retained call by its operationId. This reads its exact input/output and completes an already-durable native outcome; it does not dispatch another application RPC.', { ...selection, operationId: uuid }, ['workspace', 'operationId'], { idempotent: true }),
    tool('merchant_grpc_prepare', 'Prepare the selected original merchant and complete generated customer files. Keep the same UUID operationId to recover its preparation intent after interruption.', { ...revision, operationId: uuid }, ['workspace', 'revision', 'operationId'], { idempotent: true }),
    tool('merchant_grpc_run', 'Start the specified original prepared merchant in its native workspace, retaining the native run and Operations identities.', { ...selection, preparation: uuid }, ['workspace', 'preparation'], { openWorld: true }),
    tool('merchant_grpc_stop', 'Drain and stop the original merchant owned by this gRPC workspace.', selection, ['workspace'], { openWorld: true, idempotent: true }),
    tool('merchant_grpc_stage', 'Stage the exact original preparation in this workspace’s existing SF82 release store. Stop its direct merchant first.', { ...selection, preparation: uuid, releaseId: alias }, ['workspace', 'preparation', 'releaseId'], {}),
    tool('merchant_grpc_release_open', 'Open or recover the original gRPC-owned SF82 release console and its retained selection/runtime status.', selection, ['workspace'], { idempotent: true }),
    tool('merchant_grpc_release_status', 'Read the already-open original release console, selection generation and running instance.', selection, ['workspace'], read),
    tool('merchant_grpc_release_diff', 'Compare two original staged releases before selecting them. Omit from to use the currently selected release.', { ...selection, from: alias, to: alias }, ['workspace', 'to'], read),
    tool('merchant_grpc_release_activate', 'Activate an original staged release at the observed selection generation.', { ...selection, id: alias, expectedGeneration: generation, reason }, ['workspace', 'id', 'expectedGeneration', 'reason'], {}),
    tool('merchant_grpc_release_rollback', 'Roll back through the original release controller at the observed generation. Omit to to select its recorded previous release.', { ...selection, to: alias, expectedGeneration: generation, reason }, ['workspace', 'expectedGeneration', 'reason'], {}),
    tool('merchant_grpc_release_run', 'Run the original selected release at the observed generation using the original release console.', { ...selection, expectedGeneration: generation }, ['workspace', 'expectedGeneration'], { openWorld: true }),
    tool('merchant_grpc_release_stop', 'Drain the exact seller instance owned by the original release console.', { ...selection, instanceId: instance }, ['workspace', 'instanceId'], { openWorld: true }),
    tool('merchant_grpc_release_restart', 'Drain the exact original instance and start the selected release at the observed generation.', { ...selection, instanceId: instance, expectedGeneration: generation }, ['workspace', 'instanceId', 'expectedGeneration'], { openWorld: true }),
    tool('merchant_grpc_release_close', 'Close the original workspace-owned release console and drain its managed merchant.', selection, ['workspace'], { openWorld: true, idempotent: true }),
    tool('merchant_grpc_export', 'Retain all seven original customer files, the complete captured revision, or the exact retained call for resumable delivery. Native revision/preparation/operation identities and complete SHA256s travel with the files.', { ...selection, kind: { type: 'string', enum: ['customer', 'revision', 'attempt'] }, revision: digest, preparation: uuid, operationId: uuid }, ['workspace', 'kind'], {}),
    tool('merchant_grpc_export_manifest', 'Inspect a completed immutable gRPC export, its original identities and all file hashes. This is the first receiving step.', { exportId: digest }, ['exportId'], read),
    tool('merchant_grpc_export_file', 'Read the exact manifest or an original export file in verified resumable byte chunks. Pin both the reviewed manifest and file hashes.', { exportId: digest, file: { type: 'string', minLength: 1, maxLength: 128 }, expectedManifestSha256: digest, expectedSha256: digest, readId: uuid, offset: generation, limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } }, ['exportId', 'file', 'expectedManifestSha256', 'expectedSha256'], read),
    tool('merchant_grpc_export_file_release', 'Release one temporary file-read snapshot while retaining its complete original export for future receiving.', { exportId: digest, readId: uuid }, ['exportId', 'readId'], { idempotent: true }),
  ];
}

export { grpcWorkspaceTools, read, selection, page, revision, alias, baseRevision, digest, methodName, uuid, generation, reason, instance, ALIAS, SHA, UUID };
