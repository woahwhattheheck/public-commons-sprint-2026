export interface StellarSdkRuntimeOptions {
  /** Complete unchanged pinned npm-published UMD JavaScript file. */
  bundle: string;
  /** Complete original npm publication JSON. */
  metadata: string;
  /** New private directory for the original source and thin ESM adapter. */
  output: string;
  importedAt?: string;
}
export interface StellarSdkRuntimeFile {
  file: string;
  bytes: number;
  sha256: string;
  gitBlobSha1: string;
  sourceUrl?: string;
  originalDownload?: string;
  transformation?: string;
}
export interface StellarSdkRuntimeReceipt {
  schema: 'stellar-forge.sdk-runtime.v1';
  status: 'ready';
  source: Readonly<Record<string, string | number>>;
  startedAt: string;
  importedAt: string;
  completedAt: string;
  runtime: { node: string; platform: string; architecture: string };
  output: string;
  sdkModule: string;
  originalFiles: StellarSdkRuntimeFile[];
  sourceCompanions: StellarSdkRuntimeFile[];
  adapter: StellarSdkRuntimeFile;
  preparer: StellarSdkRuntimeFile;
  npmPackageDistribution: Record<string, unknown>;
  identityNote: string;
  operations: string[];
  exports: Array<{ name: string; type: string }>;
  receiptPath: string;
}
export const SDK_RUNTIME_SOURCE: Readonly<{
  package: '@stellar/stellar-sdk'; version: '16.3.1'; nodeMajorMinimum: 22;
  bundleBytes: 487628; metadataBytes: 8764; bundleUrl: string;
  bundleIntegrity: string; distributionMetadataUrl: string;
  metadataUrl: string; repository: string; gitHead: string;
  buildSource: string; buildSourceGitBlob: string;
}>;
export const SDK_RUNTIME_EXPORTS: readonly string[];
/** Preserves originals, creates the ESM adapter and loads the actual required SDK exports. */
export function prepareSdkRuntime(options: StellarSdkRuntimeOptions): Promise<StellarSdkRuntimeReceipt>;
