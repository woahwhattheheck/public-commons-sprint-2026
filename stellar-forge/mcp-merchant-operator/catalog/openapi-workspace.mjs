// MIT. Original tool metadata; provider runtimes load only when selected.
import { SF61_SHA, SF61_ALIAS } from '../sf61-connection-contracts.mjs';
import { routeWorksheetTools } from './openapi-route-worksheet.mjs';
import { operationPolicyTools } from './openapi-operation-policies.mjs';

const PACKAGE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

const alias = { type: 'string', pattern: SF61_ALIAS.source };

const digest = { type: 'string', pattern: SF61_SHA.source };

const packageName = { type: 'string', pattern: PACKAGE.source };

const uuid = { type: 'string', pattern: UUID.source };

const selection = { workspace: alias };

const selectedPackage = { ...selection, name: packageName };

const source = { specFile: alias, specText: { type: 'string', minLength: 1, maxLength: 131072 }, expectedSourceSha256: digest };

const plan = { plan: { type: 'object' }, planFile: alias };

const page = { after: { type: 'string', maxLength: 64 }, limit: { type: 'integer', minimum: 1, maximum: 200 } };

const offset = { type: 'integer', minimum: 0 };

const revision = { type: 'integer', minimum: 0 };

const read = { readOnly: true, idempotent: true };

const routeDecisions = { type: 'array', maxItems: 64, items: { type: 'object',
  properties: { routeId: { type: 'string', maxLength: 128 }, action: { type: 'string', enum: ['keep', 'remap', 'drop'] },
    method: { type: 'string', maxLength: 16 }, path: { type: 'string', maxLength: 4096 }, settings: { type: 'object' } },
  required: ['routeId', 'action'], additionalProperties: false } };

const revisionInput = { ...selection, baseName: packageName, ...source, decisions: routeDecisions,
  additions: { type: 'array', maxItems: 64, items: { type: 'object' } } };

const policy = { type: 'object', properties: Object.fromEntries(['ttlMs', 'maxEntries', 'maxBytes', 'maxEntryBytes']
  .map(key => [key, { type: 'integer', minimum: 1 }])), additionalProperties: false };

function openapiWorkspaceTools(tool) {
  return [
    ...routeWorksheetTools(tool),
    ...operationPolicyTools(tool),
    tool('merchant_openapi_workspaces', 'List original SF61 consoles, declared API/plan file handles and complete receiving directories.', {}, [], read),
    tool('merchant_openapi_status', 'Read the original console-owned merchant runtime and cache state. The console stays shared with its browser and HAR operator.', selection, ['workspace'], read),
    tool('merchant_openapi_packages', 'Page every complete original saved API package. Continue nextCursor until complete; incomplete directories do not consume the page.', { ...selection, ...page }, ['workspace'], read),
    tool('merchant_openapi_package_inspect', 'Verify a saved original package, its complete source/compiled identity and retained revision. Reopen here after an interrupted save.', selectedPackage, ['workspace', 'name'], read),
    tool('merchant_openapi_load', 'Read the original editable plan, preview and source identity. includeSource returns complete source up to 128 KiB; complete larger source travels in the package export.', { ...selectedPackage, includeSource: { type: 'boolean' } }, ['workspace', 'name'], read),
    tool('merchant_openapi_inspect', 'Inspect a complete OpenAPI JSON/YAML source through the original compiler. Choose a configured source file or complete small source text.', { ...selection, ...source }, ['workspace'], read),
    tool('merchant_openapi_preview', 'Review original routes, exact atomic payment terms, upstream bindings and current provider authorization before saving.', { ...selection, ...source, ...plan }, ['workspace'], read),
    tool('merchant_openapi_save', 'Save a complete merchant using the original compiler and atomic publisher. Exact retries reopen the same existing source and plan.', { ...selectedPackage, ...source, ...plan }, ['workspace', 'name'], { idempotent: true }),
    tool('merchant_openapi_drafts', 'List original retained source-revision drafts, including work saved in the browser.', selection, ['workspace'], read),
    tool('merchant_openapi_draft_load', 'Reopen a named original draft and recheck its base source and current provider authorization.', { ...selectedPackage, includeSource: { type: 'boolean' } }, ['workspace', 'name'], read),
    tool('merchant_openapi_revision_review', 'Review keep/remap/drop and additions through the original revision engine, preserving existing atomic prices. Returns original review hashes for save.', revisionInput, ['workspace', 'baseName'], read),
    tool('merchant_openapi_revision_draft', 'Retain a complete named source-revision draft in the original console for browser or agent continuation.', { ...revisionInput, name: packageName }, ['workspace', 'baseName', 'name'], {}),
    tool('merchant_openapi_revision_save', 'Save the exact reviewed source revision with original review hashes. A completed retry recovers the same package and source lineage.', {
      ...revisionInput, name: packageName, expectedReviewSha256: digest, expectedRefreshReviewId: digest
    }, ['workspace', 'baseName', 'name', 'expectedReviewSha256', 'expectedRefreshReviewId'], { idempotent: true }),
    tool('merchant_openapi_stage', 'Stage an initial or revised saved package into this operator’s configured original SF82 release store. Continue through merchant_compare, activate and start.', {
      ...selectedPackage, id: alias, expectedPackageManifestSha256: digest
    }, ['workspace', 'name', 'id'], {}),
    tool('merchant_openapi_start', 'Start the selected original console package in challenge mode for native source/cache operation. Its browser shares the same runtime.', selectedPackage, ['workspace', 'name'], { openWorld: true }),
    tool('merchant_openapi_stop', 'Stop the exact console-owned runtime selected by its current runtimeId. Read status after reopening or another operator change.', {
      ...selection, runtimeId: uuid
    }, ['workspace', 'runtimeId'], { destructive: true }),
    tool('merchant_openapi_cache_history', 'Page saved original cache activity, inspect one snapshot/change, or compare two snapshots.', {
      ...selectedPackage, kind: { type: 'string', enum: ['workspace', 'inspection', 'change', 'compare'] }, id: uuid, before: uuid, after: uuid, offset,
      limit: { type: 'integer', minimum: 1, maximum: 100 }
    }, ['workspace', 'name'], read),
    tool('merchant_openapi_cache_capture', 'Capture the selected running package into its original SQLite operating history at the reviewed workspace revision.', {
      ...selectedPackage, expectedRevision: revision, label: { type: 'string', maxLength: 160 }
    }, ['workspace', 'name', 'expectedRevision'], {}),
    tool('merchant_openapi_cache_prepare', 'Prepare one reviewed retention change or invalidation using the original snapshot and runtime-generation checks.', {
      ...selectedPackage, inspectionId: uuid, expectedRevision: revision, route: { type: 'string', minLength: 1, maxLength: 128 },
      action: { type: 'string', enum: ['configure', 'invalidate'] }, policy, note: { type: 'string', maxLength: 2000 }, operationId: uuid, restoreInspectionId: uuid
    }, ['workspace', 'name', 'inspectionId', 'expectedRevision', 'route', 'action', 'operationId'], { idempotent: true }),
    tool('merchant_openapi_cache_apply', 'Apply the original prepared cache operation. An already completed operation returns its same retained result.', {
      ...selectedPackage, id: uuid, expectedRevision: revision
    }, ['workspace', 'name', 'id', 'expectedRevision'], { idempotent: true }),
    tool('merchant_openapi_cache_recover', 'Recover the original interrupted cache operation by reading its retained runtime operation before continuing the same change.', {
      ...selectedPackage, id: uuid, expectedRevision: revision
    }, ['workspace', 'name', 'id', 'expectedRevision'], { idempotent: true }),
    tool('merchant_openapi_policy_reviews', 'Page retained original cache-policy revision reviews after browser, console or MCP restart.', { ...selectedPackage, offset }, ['workspace', 'name'], read),
    tool('merchant_openapi_policy_review', 'Turn selected cached routes from one original operating snapshot into a reviewed new saved-package policy; all other original settings are preserved.', {
      ...selection, baseName: packageName, inspectionId: uuid, routeIds: { type: 'array', minItems: 1, maxItems: 64, uniqueItems: true, items: { type: 'string', maxLength: 128 } },
      name: packageName, note: { type: 'string', maxLength: 2000 }
    }, ['workspace', 'baseName', 'inspectionId', 'routeIds', 'name'], {}),
    tool('merchant_openapi_policy_show', 'Reopen the original retained cache-policy review, its exact route changes and any completed saved revision.', {
      ...selectedPackage, id: uuid
    }, ['workspace', 'name', 'id'], read),
    tool('merchant_openapi_policy_save', 'Save the retained original cache-policy review through the original revision/compiler and recover its exact completed package after a lost reply.', {
      ...selectedPackage, id: uuid, expectedReviewSha256: digest
    }, ['workspace', 'name', 'id', 'expectedReviewSha256'], { idempotent: true }),
    tool('merchant_openapi_export', 'Retain every original source, compiled and revision file as an immutable complete merchant export for receiving.', {
      ...selectedPackage, expectedPackageManifestSha256: digest
    }, ['workspace', 'name'], { idempotent: true }),
    tool('merchant_openapi_exports', 'Page complete retained original package exports after a lost export response or source/console reopening.', { ...selection, ...page }, ['workspace'], read),
    tool('merchant_openapi_manifest', 'Read an original retained package export manifest and its exact complete file identities.', { ...selection, exportId: digest }, ['workspace', 'exportId'], read),
    tool('merchant_openapi_file', 'Read verified base64 chunks from an immutable original package export, including its completion manifest. Continue readId and nextOffset.', {
      ...selection, exportId: digest, file: { type: 'string', minLength: 1, maxLength: 1024 }, expectedManifestSha256: digest, expectedSha256: digest,
      readId: uuid, offset, limit: { type: 'integer', minimum: 1, maximum: 196608 }
    }, ['workspace', 'exportId', 'file', 'expectedManifestSha256', 'expectedSha256'], read),
    tool('merchant_openapi_file_release', 'Release the selected file-read continuation while preserving the complete original package export.', {
      ...selection, exportId: digest, readId: uuid
    }, ['workspace', 'exportId', 'readId'], { idempotent: true }),
    tool('merchant_openapi_receive', 'Receive a complete verified package from one host-declared download directory using the original atomic publisher. Preserves original package UUID, compiled files and revision lineage.', {
      ...selection, delivery: alias, name: packageName, expectedManifestSha256: digest
    }, ['workspace', 'delivery', 'name', 'expectedManifestSha256'], { idempotent: true })
  ];
}

export { openapiWorkspaceTools, read, selection, page, selectedPackage, source, plan, revisionInput, packageName, digest, alias, uuid, offset, revision, policy, routeDecisions, PACKAGE, UUID };
