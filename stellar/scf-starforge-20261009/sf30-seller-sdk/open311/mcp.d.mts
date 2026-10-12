import type { WorkspaceHostConfiguration } from './mcp-client.mjs';
export { readOpen311WorkspaceConfiguration } from './mcp-client.mjs';
export { initializeOpen311MerchantWorkspace } from './mcp-setup.mjs';
export interface ToolSchema { [key: string]: unknown; }
export type MerchantToolFactory<T> = (name: string, description: string,
  properties: Record<string, ToolSchema>, required: string[],
  annotations: { readOnly?: boolean; idempotent?: boolean }) => T;
export function open311WorkspaceTools<T>(tool: MerchantToolFactory<T>): T[];
export class MerchantOpen311Workspaces {
  constructor(config: { open311Workspaces?: WorkspaceHostConfiguration; exportsDirectory: string });
  readonly summary: { configured: boolean; workspaces: string[]; openWorkspaces: number;
    activeFileReads: number; pendingFileCloses: number; snapshotBytes: number; immutableFileBytes: number };
  call(name: string, args?: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}
