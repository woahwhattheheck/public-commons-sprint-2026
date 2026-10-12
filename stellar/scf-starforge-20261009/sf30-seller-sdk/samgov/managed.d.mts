/// <reference types="node" />
import type {SamServer, SamServerOptions} from './server.mjs';
import type {SamConnectionDocument} from './connection.mjs';

export interface ManagedSamServer extends SamServer {
  connection: {path: string; sha256: string; bytes: number; value: SamConnectionDocument};
  instanceId: string;
  /** Retire this connection under the original lease, then drain the original server. */
  close(): Promise<void>;
}
export interface ManagedSamStartup {
  schema: 'stellar-forge.samgov-workspace-startup.v1'; status: 'SAM_WORKSPACE_READY';
  directory: string; operator: string; workspaceId: string | null; instanceId: string;
  pid: number; connectionFile: string; connectionSha256: string; origin: string;
  /** Private operator launch URL, also retained by the existing Applications process. */
  url: string;
}
export interface ManagedSamCliOptions {stdout?: Pick<NodeJS.WriteStream, 'write'>; waitForClose?: boolean}
export function samManagedOptions(argv: string[]): SamServerOptions;
export function startManagedSamWorkspace(options: SamServerOptions): Promise<ManagedSamServer>;
export function samStartup(service: ManagedSamServer): ManagedSamStartup;
export function runManagedSamCli(argv: string[] | undefined,
  options: ManagedSamCliOptions & {waitForClose: false}): Promise<ManagedSamServer | {help: true}>;
export function runManagedSamCli(argv?: string[], options?: ManagedSamCliOptions):
  Promise<ManagedSamServer | {help: true} | {status: 'CLOSED'; instanceId: string}>;
