import type { Server } from 'node:http';
import type { ODataWorkspace } from './workspace.mjs';
import type { ODataLiveRuntime } from './live-operations.mjs';
export interface ODataOperatorServer {
  url: string; server: Server; liveRuntime: ODataLiveRuntime | null;
  /** Closes live operations, the retained workspace and the original listener. */
  close(): Promise<void>;
}
export declare function startODataServer(options: {
  workspace: ODataWorkspace;
  /** Original operator port, default 8797; use 0 to select an available local port. */
  port?: number;
  /** Reopen an already prepared service in this retained workspace. */
  liveServiceId?: string;
}): Promise<ODataOperatorServer>;
