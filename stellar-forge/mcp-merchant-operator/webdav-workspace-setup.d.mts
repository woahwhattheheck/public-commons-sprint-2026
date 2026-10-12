import type { JsonObject } from './webdav-workspace-client.mjs';
export function readWebDavWorkspaceConfiguration(path: string): Promise<{ workspaces: Record<string, JsonObject> }>;
export function initializeWebDavWorkspaceMerchant(input: {
  directory: string; connection: string; name?: string;
}): Promise<JsonObject & { configuration: string; state: 'INITIALIZED' }>;
export function prepareWebDavMerchantHost(input: {
  directory: string; connection: string; name?: string; hostName?: string;
  nodePath?: string; entryPath?: string; existingConfiguration?: JsonObject;
}): Promise<JsonObject & { configuration: string; state: 'INITIALIZED'; hostConfiguration: JsonObject }>;
