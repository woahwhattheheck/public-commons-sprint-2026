// MIT. Original tool metadata; provider runtimes load only when selected.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

const HASH = /^[a-f0-9]{64}$/;

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

const ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const alias = { type: 'string', pattern: ALIAS.source };

const hash = { type: 'string', pattern: HASH.source };

const uuid = { type: 'string', pattern: UUID.source };

const edition = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$' };

const revision = { type: 'integer', minimum: 0 };

const object = { type: 'object', additionalProperties: true };

const readonly = { readOnly: true, idempotent: true };

function edgarWorkspaceTools(tool) {
  const scoped = properties => ({ workspace: alias, ...properties });
  const chunk = { expectedSha256: hash, readId: uuid, offset: { type: 'integer', minimum: 0 },
    limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } };
  const page = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } };
  const saved = { expectedRevision: revision };
  return [
    tool('merchant_edgar_status', 'List configured original SEC workspaces and retained input aliases, or page the open workspace state and process-owned merchant.', scoped(page), [], readonly),
    tool('merchant_edgar_open', 'Open the original retained SEC workspace and its local browser in one owned instance; reuse the same saved sources and revisions.', scoped({}), ['workspace'], { idempotent: true }),
    tool('merchant_edgar_close', 'Cancel active source acquisition, drain the original merchant and close this exact workspace/browser instance.', scoped({ instanceId: uuid }), ['workspace', 'instanceId'], { destructive: true }),
    tool('merchant_edgar_import', 'Import a host-declared original SEC capture with its pinned source digest, original edition identifier and capture time.', scoped({ capture: alias, expectedSha256: hash }), ['workspace', 'capture', 'expectedSha256'], { idempotent: true }),
    tool('merchant_edgar_acquire', 'Acquire a stable edition through the original SEC transport and configured shared supplier quota. Repeat the same edition to recover an already retained capture.', scoped({ profile: alias, editionId: edition, operationId: uuid }), ['workspace', 'profile', 'editionId', 'operationId'], { idempotent: true, openWorld: true }),
    tool('merchant_edgar_cancel', 'Cancel this workspace’s active original acquisition by the operation UUID shown in status.', scoped({ operationId: uuid }), ['workspace', 'operationId'], { idempotent: true }),
    tool('merchant_edgar_edition', 'Inspect a selected original source and page its actual concepts, filing forms or named history files. Concept search retains original taxonomy and unit metadata.', scoped({ editionId: edition, collection: { enum: ['concepts', 'forms', 'history'] }, search: { type: 'string', maxLength: 300 }, ...page }), ['workspace', 'editionId'], readonly),
    tool('merchant_edgar_save', 'Save the full original merchant config or a declared merchant profile with its native expected revision; exact source and payment compilation remain authoritative.', scoped({ ...saved, config: object, profile: alias }), ['workspace', 'expectedRevision']),
    tool('merchant_edgar_product', 'Add, replace or remove one product in the full native merchant draft. Upsert binds kind, company and source SHA directly from the selected original edition.', scoped({ ...saved, action: { enum: ['upsert', 'remove'] }, productId: { type: 'string', maxLength: 64 }, editionId: edition, product: object, title: { type: 'string', maxLength: 120 }, publicOrigin: { type: 'string', maxLength: 2048 } }), ['workspace', 'expectedRevision', 'action', 'productId']),
    tool('merchant_edgar_preview', 'Query the original saved product and exact source-bound continuation cursor; oversized complete results remain downloadable by their returned SHA.', scoped({ productId: { type: 'string', maxLength: 64 }, query: object, config: object, expectedRevision: revision }), ['workspace', 'productId'], readonly),
    tool('merchant_edgar_revisions', 'Inspect the original saved revision history, including native total and hasMore. An exact older revision can be restored directly.', scoped({ limit: { type: 'integer', minimum: 1, maximum: 200 } }), ['workspace'], readonly),
    tool('merchant_edgar_restore', 'Restore an original nonempty merchant revision into a new native revision while preserving the complete existing history.', scoped({ revision, expectedRevision: revision }), ['workspace', 'revision', 'expectedRevision']),
    tool('merchant_edgar_handoff', 'Export the original saved buyer handoff, OpenAPI or merchant configuration from a selected current revision.', scoped({ kind: { enum: ['handoff', 'config', 'openapi'] }, expectedRevision: revision }), ['workspace'], readonly),
    tool('merchant_edgar_export', 'Produce or recover a complete native merchant export: original configuration, generated buyer client, selected raw sources and source metadata. Retain a complete transport manifest for every file.', scoped({ exportId: alias, expectedRevision: revision }), ['workspace', 'exportId', 'expectedRevision'], { idempotent: true }),
    tool('merchant_edgar_exports', 'Page the retained complete merchant exports and any original output awaiting manifest completion.', scoped(page), ['workspace'], readonly),
    tool('merchant_edgar_export_manifest', 'Inspect the exact complete export manifest and page its file inventory; the manifest itself is downloadable in full.', scoped({ exportId: alias, ...page }), ['workspace', 'exportId'], readonly),
    tool('merchant_edgar_export_file', 'Read verified bytes from the complete export, including its original nested client and source files, with resumable retained-file snapshots.', scoped({ exportId: alias, file: { type: 'string', minLength: 1, maxLength: 180 }, expectedManifestSha256: hash, ...chunk }), ['workspace', 'exportId', 'file', 'expectedManifestSha256'], readonly),
    tool('merchant_edgar_export_file_release', 'Release this export’s retained read descriptor after the receiver has saved its bytes.', scoped({ exportId: alias, readId: uuid }), ['workspace', 'exportId', 'readId'], readonly),
    tool('merchant_edgar_source_file', 'Download the unchanged original JSON of a selected edition with its source SHA and resumable byte offset.', scoped({ editionId: edition, ...chunk }), ['workspace', 'editionId'], readonly),
    tool('merchant_edgar_result_file', 'Download a complete retained operator result, including a large preview, config or handoff, after reopen.', scoped({ resultId: hash, ...chunk }), ['workspace', 'resultId'], readonly),
    tool('merchant_edgar_file_release', 'Release an original source or complete-result read descriptor.', scoped({ readId: uuid }), ['workspace', 'readId'], readonly),
    tool('merchant_edgar_receive', 'Inspect or receive a host-declared complete original merchant export. Preserve original edition IDs, timestamps and bytes, then save through the native workspace revision check.', scoped({ package: alias, expectedManifestSha256: hash, action: { enum: ['inspect', 'receive'] }, expectedRevision: revision }), ['workspace', 'package', 'expectedManifestSha256', 'action'], { idempotent: true }),
    tool('merchant_edgar_merchant', 'Start, inspect or stop the original SF30/native Stellar merchant for a saved revision using only the host’s configured runtime and facilitator.', scoped({ action: { enum: ['start', 'status', 'stop'] }, expectedRevision: revision, instanceId: uuid }), ['workspace', 'action'], { openWorld: true }),
  ];
}

export { edgarWorkspaceTools, alias, hash, uuid, revision, readonly, edition, object, ALIAS, HASH, UUID };
