import type {SamWorkspace} from './workspace.mjs';
import type {Server} from 'node:http';

export interface SamServerOptions {
  directory: string;
  operator?: string;
  apiKeyEnv?: string;
  endpoint?: string;
  opportunityDirectory?: string;
  port?: number;
  store?: SamWorkspace;
}
export interface SamServer {
  directory: string;
  operator: string;
  origin: string;
  /** Private launch address. Its fragment authenticates only this local operator tab. */
  url: string;
  server: Server;
  store: SamWorkspace;
  /** Drain active requests, pause owned captures, close prepared sellers and the owned store. */
  close(): Promise<void>;
}
export function startSamWorkspace(options: SamServerOptions): Promise<SamServer>;
