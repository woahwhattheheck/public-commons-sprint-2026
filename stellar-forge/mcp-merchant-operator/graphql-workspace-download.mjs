// MIT. Original GraphQL file sets through the shared resumable merchant transport.
import { createRetainedDownload } from './retained-download.mjs';
import { GRAPHQL_EXPORT_MANIFEST, GRAPHQL_EXPORT_MAX_BYTES, readGraphqlFileManifest } from './graphql-export-manifest.mjs';

const transport = createRetainedDownload({
  manifestName: GRAPHQL_EXPORT_MANIFEST, parseManifest: readGraphqlFileManifest,
  maximumBytes: GRAPHQL_EXPORT_MAX_BYTES,
  stateSchema: 'stellar-forge.graphql-mcp-download-state.v1',
  resultSchema: 'stellar-forge.graphql-mcp-download.v1',
  toolPrefix: 'merchant_graphql_export', errorPrefix: 'GRAPHQL',
  clientName: 'starforge-graphql-workspace-download', nestedFiles: true,
  describe: manifest => ({ workspace: manifest.workspace, selection: manifest.selection, source: manifest.source }),
});
export const downloadGraphqlWorkspaceFiles = transport.download;
export const inspectGraphqlWorkspaceFiles = transport.inspect;
