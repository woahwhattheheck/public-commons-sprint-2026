import type { Server } from 'node:http';
import type { ODataWorkspace } from './workspace.mjs';
export interface ODataOperatorServer {
  url: string; server: Server;
  /** Closes live operations, the retained workspace and the original listener. */
  close(): Promise<void>;
}
export declare function startODataServer(options: { workspace: ODataWorkspace; port?: number }): Promise<ODataOperatorServer>;
