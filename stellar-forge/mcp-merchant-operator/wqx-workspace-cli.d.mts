/// <reference types="node" />
import type { WqxNativeClient } from './wqx-workspace-client.mjs';
export declare const WQX_WORKSPACE_HELP: string;
export interface WqxCLIOptions {
  stdout?: (value: string) => void; stderr?: (value: string) => void;
  environment?: NodeJS.ProcessEnv; client?: WqxNativeClient;
}
/** Returns 0 on a successful original response or completed local transfer; native queued state remains in the returned JSON. Returns 2 on usage/native/transfer error. */
export declare function runWqxWorkspaceCLI(argv?: string[], options?: WqxCLIOptions): Promise<number>;
