// MIT. Original tool metadata; provider runtimes load only when selected.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

const SHA = /^[0-9a-f]{64}$/;

const ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const alias = { type: 'string', pattern: ALIAS.source };

const digest = { type: 'string', pattern: SHA.source };

const selection = { workspace: alias };

const page = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 250 }, expectedSnapshot: digest };

const read = { readOnly: true, idempotent: true };

function sourceWorkspaceTools(tool) {
  return [
    tool('merchant_source_workspaces', 'List configured original XML/NDJSON/IATI consoles, source-file handles and retained download sessions.', {}, [], read),
    tool('merchant_source_status', 'Read original saved source, mapping, build and comparison counts. Recover completed work here and through inventory after an interrupted reply.', selection, ['workspace'], read),
    tool('merchant_source_inventory', 'Page saved sources, plans, builds or comparisons from the original workspace. Continue its snapshot with expectedSnapshot.', { ...selection, kind: { type: 'string', enum: ['sources', 'plans', 'builds', 'comparisons', 'portfolios'] }, ...page }, ['workspace', 'kind'], read),
    tool('merchant_source_inspect', 'Read the complete retained source inventory, original byte hash, label and shape.', { ...selection, source: digest }, ['workspace', 'source'], read),
    tool('merchant_source_ingest', 'Ingest a host-declared complete source file through the existing console. Returns its original content-addressed source and inventory.', { ...selection, file: alias }, ['workspace', 'file'], { idempotent: true }),
    tool('merchant_source_ingest_text', 'Retain a small complete XML, NDJSON or IATI document through the original console. Use a configured file handle for larger source.', { ...selection, text: { type: 'string', minLength: 1, maxLength: 131072 }, label: { type: 'string', maxLength: 160 }, name: { type: 'string', maxLength: 160 } }, ['workspace', 'text'], { idempotent: true }),
    tool('merchant_source_plan', 'Read one complete original saved mapping.', { ...selection, plan: digest }, ['workspace', 'plan'], read),
    tool('merchant_source_plan_save', 'Validate and save a complete mapping using the original selected format parser. Returned hash identifies the exact mapping.', { ...selection, definition: { type: 'object' } }, ['workspace', 'definition'], { idempotent: true }),
    tool('merchant_source_build', 'Build the exact source and mapping with the original SF30 dataset engine, retaining lineage, dataset files and complete review.', { ...selection, source: digest, plan: digest }, ['workspace', 'source', 'plan'], { idempotent: true }),
    tool('merchant_source_query', 'Query the exact retained build through the native dataset engine. Pass original query parameters as strings.', { ...selection, build: digest, query: { type: 'object', additionalProperties: { type: 'string' } } }, ['workspace', 'build'], read),
    tool('merchant_source_compare', 'Compare two editions using their original shared mapping and explicit unique keys. Retains the complete keyed changes file.', { ...selection, before: digest, after: digest }, ['workspace', 'before', 'after'], { idempotent: true }),
    tool('merchant_source_changes', 'Page original retained comparison changes. Continue nextOffset until null, or export the full change file.', { ...selection, comparison: digest, offset: page.offset, limit: page.limit }, ['workspace', 'comparison'], read),
    tool('merchant_source_export', 'Retain the complete original project packet, native dataset package, edition changes or complete IATI portfolio/report for resumable delivery. The native console creates the export once.', { ...selection, kind: { type: 'string', enum: ['project', 'dataset', 'changes', 'portfolio', 'report'] }, build: digest, comparison: digest, portfolio: digest, revision: { type: 'integer', minimum: 1 } }, ['workspace', 'kind'], {}),
    tool('merchant_source_merchant_prepare', 'Prepare the original NDJSON merchant package with reviewed public payment terms, source, mapping, native dataset, seller, OpenAPI and generated customer SDK.', { ...selection, build: digest, payment: { type: 'object' }, origin: { type: 'string' }, path: { type: 'string' } }, ['workspace', 'build', 'payment', 'origin', 'path'], {}),
    tool('merchant_source_exports', 'Page retained complete exports, including results whose initial reply was interrupted. Files remain available after MCP or console restart.', { ...selection, ...page }, ['workspace'], read),
    tool('merchant_source_file_read', 'Read the exact retained export in verified base64 byte chunks. Repeat exportId and readId with nextOffset; completed reads release their temporary snapshot.', { ...selection, exportId: digest, readId: { type: 'string', pattern: UUID.source }, offset: page.offset, limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } }, ['workspace', 'exportId'], read),
    tool('merchant_source_file_release', 'Release an original temporary download snapshot while preserving its complete retained export.', { ...selection, readId: { type: 'string', pattern: UUID.source } }, ['workspace', 'readId'], { idempotent: true }),
    tool('merchant_source_import', 'Import a complete source project or IATI portfolio packet through the original receiving console. Select one configured packet file or a retained project or portfolio export from a declared workspace.', { ...selection, file: alias, exportId: digest, fromWorkspace: alias }, ['workspace'], { idempotent: true }),
    tool('merchant_source_iati_presets', 'Read the original IATI 2.03 mapping presets, exact field names and financial category labels.', selection, ['workspace'], read),
    tool('merchant_source_iati_profile', 'Inspect the original publisher XML, complete association-preserving inventory and financial review findings.', { ...selection, source: digest }, ['workspace', 'source'], read),
    tool('merchant_source_iati_portfolios', 'Page the original latest saved portfolio revisions. Continue the returned exact inventory snapshot.', { ...selection, ...page }, ['workspace'], read),
    tool('merchant_source_iati_portfolio', 'Read an exact saved portfolio revision, its named review, selection and all three original dataset editions.', { ...selection, portfolio: digest, revision: { type: 'integer', minimum: 1 } }, ['workspace', 'portfolio'], read),
    tool('merchant_source_iati_history', 'Page every original revision of one saved IATI portfolio with the returned inventory snapshot.', { ...selection, portfolio: digest, ...page }, ['workspace', 'portfolio'], read),
    tool('merchant_source_iati_portfolio_save', 'Save and build an original IATI portfolio. The complete definition requires requestId/name/sources; edits require id plus expectedRevision. Review retains status/reviewer/note. An exact request replay returns its original revision.', { ...selection, definition: { type: 'object' } }, ['workspace', 'definition'], { idempotent: true }),
    tool('merchant_source_iati_report', 'Read the full original report with separate reporting organisation, hierarchy, currency, financial type and date groups. Amounts remain exact strings; complete report/source archives use merchant_source_export.', { ...selection, portfolio: digest, revision: { type: 'integer', minimum: 1 } }, ['workspace', 'portfolio'], read),
    tool('merchant_source_iati_compare', 'Compare original portfolio revisions and retain full native keyed field changes. Definition selects id/beforeRevision/afterRevision and optional explicit before/after source pairs; source coverage and changed selection remain separate.', { ...selection, definition: { type: 'object' } }, ['workspace', 'definition'], { idempotent: true }),
  ];
}

export { sourceWorkspaceTools, read, selection, page, digest, alias, UUID, SHA, ALIAS };
