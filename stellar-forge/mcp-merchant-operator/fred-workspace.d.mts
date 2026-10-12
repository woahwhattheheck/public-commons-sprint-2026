import type { FredWorkspaceConfiguration, FredClientRuntime } from './fred-workspace-client.mjs';
export { readFredWorkspaceConfiguration, FRED_WORKSPACE_CONNECTION_SCHEMA } from './fred-workspace-client.mjs';
export declare function fredWorkspaceTools<T>(tool: (name: string, description: string, properties: Record<string, unknown>,
  required: string[], annotations: Record<string, boolean>) => T): T[];
export declare class MerchantFredWorkspaces {
  constructor(config: { fredWorkspaces?: FredWorkspaceConfiguration | null; exportsDirectory: string }, runtime?: FredClientRuntime);
  readonly summary: { configured: boolean; workspaces: string[]; attachedClients: number;
    activeFileReads: number; snapshotBytes: number; immutableFileBytes: number };
  call(name: string, args?: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}
