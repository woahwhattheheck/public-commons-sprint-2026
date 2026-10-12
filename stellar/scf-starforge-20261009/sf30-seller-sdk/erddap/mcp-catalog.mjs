// MIT. Metadata for the source-owned ERDDAP operator family.
import { MAX_RETAINED_CHUNK_BYTES } from '../../../../stellar-forge/mcp-merchant-operator/retained-file-contracts.mjs';
const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const sha = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const operation = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$' };
const label = { type: 'string', minLength: 1, maxLength: 160 };
const object = { type: 'object' };
const offset = { type: 'integer', minimum: 0, maximum: 100000000 };
const limit = { type: 'integer', minimum: 1, maximum: 500 };
const sourceMember = { type: 'string', enum: ['manifest.json', 'metadata.json', 'dataset.dds', 'dataset.das', 'data.json', 'data.csv'] };
const collection = { type: 'string', enum: ['sources', 'plans', 'builds', 'comparisons', 'metadata', 'queries', 'operations', 'searches'] };
export const fileFields = { kind: { type: 'string', enum: ['source', 'packet', 'dataset'] }, sourceId: sha, buildId: sha, member: sourceMember };
export function erddapTools(tool) {
  const call = (name, description, properties = {}, required = [], flags = {}) =>
    tool('merchant_erddap_' + name, description, { workspace: alias, ...properties }, ['workspace', ...required], flags);
  const read = { readOnly: true, idempotent: true };
  return [
    tool('merchant_erddap_workspaces', 'List the host-configured original ERDDAP workspaces and input aliases, without opening a second native workspace.', {}, [], read),
    call('status', 'Inspect the actual original operator, counts, selected source/packet inputs and file-reading ownership.', {}, [], read),
    call('records', 'Page a complete original source, query, mapping, build, comparison or acquisition collection. Continue with its exact view SHA256.', { collection, offset, limit, expectedViewSha256: sha }, ['collection'], read),
    call('search', 'Acquire and retain one exact current ERDDAP catalogue page from the selected server.', { server: { type: 'string', minLength: 1, maxLength: 2048 }, text: { type: 'string', maxLength: 512 }, page: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1, maximum: 1000 } }, ['server'], { openWorld: true }),
    call('metadata_load', 'Acquire the original info JSON, DDS and DAS and review literal route/publisher identities, dimensions, units, masks and license.', { server: { type: 'string', minLength: 1, maxLength: 2048 }, datasetId: { type: 'string', minLength: 1, maxLength: 128 }, protocol: { type: 'string', enum: ['griddap', 'tabledap'] } }, ['server', 'datasetId', 'protocol'], { openWorld: true }),
    call('metadata', 'Reopen exact retained provider metadata and original response identities.', { id: sha }, ['id'], read),
    call('query_save', 'Save the complete reviewed fixed grid axes or table variables/constraints and original request URLs.', { metadataId: sha, selection: object, label, maxBytes: { type: 'integer', minimum: 1024, maximum: 268435456 } }, ['metadataId', 'selection', 'label'], { idempotent: true }),
    call('query', 'Reopen the exact saved query, decoded request and source URLs.', { id: sha }, ['id'], read),
    call('acquire', 'Acquire or recover this exact saved query and original operation ID. Complete JSON/CSV/metadata bytes and actual provider failures remain retained.', { queryId: sha, operationId: operation, label }, ['queryId', 'operationId'], { idempotent: true, openWorld: true }),
    call('operation', 'Read the original acquisition request, including the exact retained label, and its completed responses or actual error.', { operationId: operation }, ['operationId'], read),
    call('inputs', 'List the original host-pinned complete source or customer packet inputs.', {}, [], read),
    call('input_inspect', 'Hash-read a declared complete host input without importing or modifying the original operator.', { input: alias }, ['input'], read),
    call('import', 'Import the declared exact source ZIP or independently rebuild the declared customer packet in the existing operator.', { input: alias, expectedSha256: sha }, ['input', 'expectedSha256'], { idempotent: true }),
    call('source', 'Inspect the exact original source inventory, metadata, units, missing values, quality attributes and JSON/CSV agreement.', { sourceId: sha }, ['sourceId'], read),
    call('source_rows', 'Page original source rows without numeric rounding, scaling, interpolation or quality filtering.', { sourceId: sha, offset, limit }, ['sourceId'], read),
    call('mapping_propose', 'Propose the complete lexical native projection for a retained source; review it before saving.', { sourceId: sha, name: { type: 'string', minLength: 1, maxLength: 80 } }, ['sourceId'], read),
    call('mapping_save', 'Save the complete reviewed native mapping, explicit type/null/JSON-cell choices and edition keys.', { mapping: object }, ['mapping'], { idempotent: true }),
    call('mapping', 'Read one exact retained native projection.', { id: sha }, ['id'], read),
    call('build', 'Build the complete original SF30 CSV/config/snapshot from exact source and mapping identities.', { sourceId: sha, planId: sha }, ['sourceId', 'planId'], { idempotent: true }),
    call('build_read', 'Inspect one complete retained native dataset build and its original snapshot.', { buildId: sha }, ['buildId'], read),
    call('native_query', 'Query the original SF30 dataset engine with scalar string parameters, keeping its actual snapshot, cursor and response.', { buildId: sha, params: object }, ['buildId'], read),
    call('compare', 'Compare complete retained editions using the reviewed original mapping and explicit keys.', { beforeId: sha, afterId: sha }, ['beforeId', 'afterId'], { idempotent: true }),
    call('changes', 'Page the original saved added/removed/changed/unchanged comparison.', { comparisonId: sha, offset, limit }, ['comparisonId'], read),
    call('file_read', 'Receive every exact source-member, complete customer packet or native seller dataset-export byte through the original retained-file reader. Continue with SHA256 and offset.', { ...fileFields, expectedSha256: sha, readId: { type: 'string', minLength: 1, maxLength: 128 }, offset, limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } }, ['kind'], read),
    call('file_release', 'Close a temporary retained-file reader. The original source and completed export remain saved.', { readId: { type: 'string', minLength: 1, maxLength: 128 } }, ['readId'], read),
    call('disconnect', 'Drain this borrowed client and its file readers while the existing native operator continues serving its workspace.', {}, [], read),
  ];
}
