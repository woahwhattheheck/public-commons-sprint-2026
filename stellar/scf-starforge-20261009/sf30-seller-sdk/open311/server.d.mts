import type { Server } from 'node:http';
import type { Open311Client, Open311Connection } from './index.mjs';
import type { Open311Workspace } from './workspace.mjs';
export const STARTUP_SCHEMA: 'stellar-forge.open311-workspace-startup.v1';
export interface WorkspaceBinding {
  schema: 'stellar-forge.open311-workspace-binding.v1'; directory: string; workspaceId: string; sha256: string;
}
export interface WorkspaceStartup {
  schema: typeof STARTUP_SCHEMA; state: 'LISTENING'; url: string; workspaceId: string;
  binding: WorkspaceBinding; instanceId: string; startedAt: string;
}
export function workspaceBinding(directory: string, workspaceId: string): WorkspaceBinding;
export function startOpen311Server(options: {
  workspace: string; host?: '127.0.0.1' | '::1' | 'localhost'; port?: number; maxBodyBytes?: number;
  expectedWorkspaceId?: string; expectedBindingSha256?: string;
  clientFactory?: (connection: Open311Connection) => Open311Client;
}): Promise<{ url: string; workspace: Open311Workspace; server: Server; startup: WorkspaceStartup; close(): Promise<void> }>;
