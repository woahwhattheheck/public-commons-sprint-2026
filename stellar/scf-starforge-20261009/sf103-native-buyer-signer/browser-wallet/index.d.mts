export type StellarNetwork = 'stellar:testnet' | 'stellar:pubnet';
export interface WalletOptions {
  buyerConfig: string; output: string; rpcUrl?: string; requestLifetimeMs?: number;
}
export interface AuthorizationDetails {
  kind: string; network: StellarNetwork; payer: string; asset: string; recipient: string;
  amountAtomic: string; maximumAtomic: string; nonce: string;
  expirationLedger: number; payloadSha256: string;
}
export interface AuthorizationResult { signedAuthEntry: string; signerAddress: string; }
export interface AuthorizationVerifier {
  inspect(entryXdr: string): AuthorizationDetails;
  verify(entryXdr: string, result: unknown): AuthorizationResult;
}
export interface BrowserSigner {
  readonly address: string;
  signAuthEntry(entryXdr: string, options?: {
    address?: string; networkPassphrase?: string;
  }): Promise<AuthorizationResult>;
}
export declare class WalletError extends Error {
  code: string; status: number; constructor(code: string, status?: number);
}
export declare const FREIGHTER_VERSION: '6.0.1';
export declare const STELLAR_VERSION: '^16.3.0';
export declare function prepareBrowserWallet(options: WalletOptions): Promise<{
  state: 'PREPARED'; walletId: string; directory: string; sourceBuyerConfig: string;
  buyerConfig: string; signerConfig: string; network: StellarNetwork; payer: string;
  intentId: string; provider: string; buyerSha256: string; sourceBuyerSha256: string;
  command: string;
}>;
export declare function inspectWalletWorkspace(directory: string): Promise<Record<string, unknown>>;
export declare function loadWalletOperator(directory: string, operatorWorkspace: string):
  Promise<Record<string, unknown>>;
export declare function executeWalletOperation(options: {
  directory: string; operatorWorkspace: string; signal?: AbortSignal;
}): Promise<{state: string; exitCode: number; signal: string | null; walletId: string}>;
export declare function createBrowserSigner(options: {
  directory: string; network: StellarNetwork; payer: string; verifier?: AuthorizationVerifier;
}): Promise<BrowserSigner>;
export declare function inspectBrowserWallet(directory: string): Promise<{
  walletId: string; buyerSha256: string; instanceId: string;
  state: 'CONNECTED' | 'AWAITING_WALLET'; network: StellarNetwork; payer: string;
}>;
export declare function createVerifier(config: Record<string, unknown>, sdk: unknown):
  AuthorizationVerifier;
export declare function loadVerifier(config: Record<string, unknown>): Promise<AuthorizationVerifier>;
