export function initializeOpen311MerchantWorkspace(options: {
  directory: string; connection: string; name?: string; releaseStore?: string;
}): Promise<{ schema: string; configuration: string; state: 'INITIALIZED'; open311WorkspacesConfigured: true;
  workspaces: { workspace: string; label: string; connectionProfiles: string[]; inputs: string[] }[];
  hostOwnership: 'ORIGINAL_OPEN311_WORKSPACES' }>;
