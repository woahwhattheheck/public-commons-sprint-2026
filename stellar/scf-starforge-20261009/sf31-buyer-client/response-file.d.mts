export interface BuyerResponseFileOptions {
  /** Absolute, operator-selected path in an existing trusted directory. */
  destination: string;
  /** Maximum response-stream bytes; default 64 MiB. */
  maxBytes?: number;
  /** Total stream-reading deadline; default 30 seconds. */
  timeoutMs?: number;
}

export interface SavedBuyerResponse {
  path: string;
  bytes: number;
  sha256: string;
  contentType: string | null;
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

/** Prepare local output before invoking the original buyer/payment workflow. */
export function prepareBuyerResponseFile(options: BuyerResponseFileOptions): Promise<PreparedBuyerResponseFile>;
