// MIT. Original tool metadata; provider runtimes load only when selected.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

const aliasSchema = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };

const uuidSchema = { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' };

const shaSchema = { type: 'string', pattern: '^[a-f0-9]{64}$' };

function graphqlFileTools(tool) {
  const read = { readOnly: true, idempotent: true };
  return [
    tool('merchant_graphql_export_prepare', 'Retain one exact original project/file-set identity for transfer. Use a caller-chosen exportId and the native saved IDs. Keeps original files in place; the same intent/id reuses its immutable descriptor.',
      { workspace: aliasSchema, exportId: aliasSchema, project: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' },
        revision: { type: 'integer', minimum: 1 }, kind: { enum: ['draft', 'preview', 'merchant', 'evolution', 'deployment', 'host'] },
        merchantExportId: uuidSchema, deploymentId: uuidSchema, previewId: uuidSchema,
        hostId: { type: 'string', pattern: '^host-[1-9][0-9]*-[a-f0-9]{8}$' } },
      ['workspace', 'exportId', 'project', 'revision', 'kind'], { idempotent: true }),
    tool('merchant_graphql_export_manifest', 'Inspect the pinned transfer manifest of an already retained native GraphQL file set, including after its writer or MCP process has reopened.',
      { exportId: aliasSchema }, ['exportId'], read),
    tool('merchant_graphql_export_file', 'Read exact original source, response, merchant/buyer, evolution, deployment or host bytes using the same bounded retained snapshot reader. Select file names from the manifest; preserve its hash and returned readId when continuing.',
      { exportId: aliasSchema, file: { type: 'string', minLength: 1, maxLength: 4096 },
        expectedManifestSha256: shaSchema, expectedSha256: shaSchema, readId: uuidSchema,
        offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } },
      ['exportId', 'file', 'expectedManifestSha256'], read),
    tool('merchant_graphql_export_file_release', 'Release one original read snapshot early. Completed or already released read IDs are harmless to repeat.',
      { exportId: aliasSchema, readId: uuidSchema }, ['exportId', 'readId'], { idempotent: true }),
  ];
}

export { graphqlFileTools, aliasSchema, uuidSchema, shaSchema };
