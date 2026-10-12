export declare function initializeFredWorkspaceMerchant(options: { directory: string; connection: string; name?: string }):
  Promise<{ schema: string; configuration: string; state: 'INITIALIZED'; fredWorkspacesConfigured: true;
    workspaces: Array<{ workspace: string; label: string; projectId: string | null }>; hostOwnership: 'ORIGINAL_FRED_WORKSPACE' }>;
