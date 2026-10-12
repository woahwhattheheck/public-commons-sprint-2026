/// <reference types="node" />
import type { Writable } from 'node:stream';
export interface KafkaMerchantDownloadCliOptions {
  stdout?: Writable;
  stderr?: Writable;
  environment?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}
/** Returns 0 on completion, 1 on failure, 130 on interrupt, and 143 on SIGTERM. */
export declare function runKafkaMerchantDownloadCli(
  args?: string[], options?: KafkaMerchantDownloadCliOptions
): Promise<number>;
