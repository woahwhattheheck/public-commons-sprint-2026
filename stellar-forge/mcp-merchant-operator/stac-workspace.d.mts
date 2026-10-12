import type { StacWorkspaceConfiguration, NativeObject } from './stac-workspace-client.mjs';
export { readStacWorkspaceConfiguration, STAC_WORKSPACE_CONNECTION_SCHEMA } from './stac-workspace-client.mjs';
export declare function stacWorkspaceTools<T>(tool: (name: string, description: string, properties: NativeObject, required: string[], annotations: NativeObject) => T): T[];
export declare class MerchantStacWorkspaces {
  constructor(config: { stacWorkspaces?: StacWorkspaceConfiguration | null; exportsDirectory: string }, options?: { environment?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch });
  readonly summary: NativeObject;
  call(name: string, args?: NativeObject): Promise<unknown>;
  close(): Promise<void>;
}
