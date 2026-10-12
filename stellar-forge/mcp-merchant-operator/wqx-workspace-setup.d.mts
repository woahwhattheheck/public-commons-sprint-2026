/// <reference types="node" />
export interface WqxWorkspaceSetupOptions {
  directory: string;
  connection: string;
  name?: string;
  releaseStore?: string;
}
export interface WqxWorkspaceSetupResult {
  schema: 'stellar-forge.merchant-mcp.v1';
  configuration: string;
  configurationSha256: string;
  state: 'INITIALIZED' | 'REOPENED';
  wqxWorkspacesConfigured: true;
  workspaces: Array<{workspace: string; label: string; projectBindingId: string}>;
  ownership: 'ORIGINAL_MANAGED_WQX_HOST';
}
export function initializeWqxWorkspaceMerchant(options: WqxWorkspaceSetupOptions): Promise<WqxWorkspaceSetupResult>;
