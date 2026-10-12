import type { Writable } from 'node:stream';
export const FEEDS_WORKSPACE_CLIENT_HELP: string;
export function runFeedsWorkspaceCli(argv?: string[], options?: {
  environment?: Record<string, string | undefined>; stdout?: Writable; stderr?: Writable;
}): Promise<number>;
