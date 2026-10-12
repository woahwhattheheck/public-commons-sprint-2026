import type {Buffer} from 'node:buffer';
import type {AuthorizationVerifier} from './index.mjs';
export interface BrowserWalletServer {
  readonly url: string; readonly origin: string; readonly instanceId: string; readonly walletId: string;
  close(): Promise<void>;
}
export declare function startWalletServer(options: {
  directory: string; port?: number; verifier?: AuthorizationVerifier;
  vendor?: {bytes: Buffer; version: string; sha256: string};
  inspectBound?: (config: Record<string, unknown>) => Promise<void>;
}): Promise<BrowserWalletServer>;
export declare function recoverWalletLock(directory: string, expectedInstanceId: string):
  Promise<{state: 'RECOVERED'; walletId: string; previousInstanceId: string}>;
