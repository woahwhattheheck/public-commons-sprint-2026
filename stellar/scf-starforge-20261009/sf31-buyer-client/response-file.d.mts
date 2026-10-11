/** Optional expectations selected locally before purchase, not response-header claims. */
export interface BuyerResponseFileIntegrity {
  /** Expected lowercase SHA-256 of the actual response-stream bytes. */
  expectedSha256?: string;
  /** Exact byte count, including zero for an empty file; no greater than maxBytes. */
  expectedBytes?: number;
  /** Expected MIME type/subtype, matched case-insensitively without parameters. */
  expectedContentType?: string;
}

export interface BuyerResponseFileOptions extends BuyerResponseFileIntegrity {
  /** Absolute, operator-selected path in an existing trusted directory. */
  destination: string;
  /** Maximum response-stream bytes; default 64 MiB. */
  maxBytes?: number;
  /** Total stream-reading deadline; default 30 seconds. */
  timeoutMs?: number;
}

/** Raw metadata for the original object acquisition consumer, not verified claims. */
export interface BuyerResponseObjectMetadata {
  contentRange: string | null;
  contentSha256: string | null;
  snapshot: string | null;
  totalBytes: string | null;
}

export interface SavedBuyerResponse {
  path: string;
  bytes: number;
  sha256: string;
  contentType: string | null;
  /** Present only when at least one local expectation was checked successfully. */
  verifiedAgainst?: Readonly<BuyerResponseFileIntegrity>;
  /** Omitted when all four original object headers are absent. */
  objectMetadata?: BuyerResponseObjectMetadata;
  cleanupWarnings: Array<{ path: string; code: string }>;
}

export interface PreparedBuyerResponseFile {
  readonly destination: string;
  /** Consumes the original successful response body once. Does not change payment metadata. */
  save(result: { response: Response }, options?: { signal?: AbortSignal }): Promise<SavedBuyerResponse>;
  /** Release an unused destination, or cancel an active save. Never retries the buyer. */
  abort(): Promise<void>;
}

export class BuyerResponseFileError extends Error {
  constructor(code: string, detail?: string, options?: {
    cause?: unknown;
    bytes?: number;
    partialPath?: string | null;
    cleanupWarnings?: Array<{ path: string; code: string }>;
  });
  readonly code: string;
  readonly partialPath: string | null;
  readonly bytes: number;
  readonly cleanupWarnings: Array<{ path: string; code: string }>;
}

/** Validate and normalize optional local expectations without I/O or a purchase. */
export function validateResponseFileIntegrity(
  expectations?: BuyerResponseFileIntegrity, maxBytes?: number,
): Readonly<BuyerResponseFileIntegrity>;

/** Prepare local output before invoking the original buyer/payment workflow. */
export function prepareBuyerResponseFile(options: BuyerResponseFileOptions): Promise<PreparedBuyerResponseFile>;
