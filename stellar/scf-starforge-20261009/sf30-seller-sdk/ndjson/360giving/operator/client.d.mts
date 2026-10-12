// MIT. Node types for the original saved 360Giving publisher client.

/**
 * Every JSON number token received from the native publisher remains its exact
 * source string, including monetary amounts, counts, timestamps and exponents.
 * No full report or review passes through JSON.parse. Convert only a known,
 * validated protocol counter when the caller actually needs a JavaScript number.
 */
export type ExactNumberToken = string;
export type ExactJSONValue =
  | null
  | boolean
  | string
  | ExactJSONObject
  | readonly ExactJSONValue[];
export interface ExactJSONObject {
  readonly [key: string]: ExactJSONValue;
}

/**
 * Original request input. Nonfinite numbers, unsafe integer numbers, undefined,
 * cyclic objects, accessors and non-JSON objects are rejected before submission.
 * The original JSON request limit is 128 KiB; source uploads may be 1 GiB.
 * Use uploadText(originalJSON) for source/decision documents whose numeric tokens
 * or byte spelling must be preserved. That operation never parses the source.
 */
export type PublisherInput =
  | null
  | boolean
  | string
  | number
  | PublisherInputObject
  | readonly PublisherInput[];
export interface PublisherInputObject {
  readonly [key: string]: PublisherInput;
}

export type PublisherAction =
  | 'intake'
  | 'decisions'
  | 'candidate'
  | 'build'
  | 'compare'
  | 'export'
  | 'receive';
export type PublisherRequestStatus = 'pending' | 'running' | 'complete' | 'interrupted';

export type PublisherRequest = ExactJSONObject & {
  readonly schema: 'stellar-forge.360giving-operator.v1.request';
  readonly id: string;
  readonly workspaceId: string;
  readonly action: PublisherAction;
  readonly input: ExactJSONObject;
  readonly status: PublisherRequestStatus;
  readonly phase: string;
  readonly createdAt: ExactNumberToken;
  readonly updatedAt?: ExactNumberToken;
  readonly programSha256: string;
  readonly result?: ExactJSONValue;
  readonly error?: ExactJSONObject & {readonly type: string; readonly message: string};
};

export type PublisherDataset = ExactJSONObject & {
  readonly schema: 'stellar-forge.360giving-operator.v1.dataset';
  readonly key: string;
  readonly label: string;
};

export type PublisherEdition = ExactJSONObject & {
  readonly schema: 'stellar-forge.360giving-operator.v1.edition';
  readonly id: string;
  readonly dataset: string;
  readonly sourceUrl: string;
  readonly inputs: ExactJSONObject;
  readonly programSha256: string;
  readonly sourceSha256: string;
  readonly grantCount: ExactNumberToken;
  readonly nativeInputReady: boolean;
  readonly preparedAt: string;
};

export type PublisherDecision = ExactJSONObject & {
  readonly schema: 'stellar-forge.360giving-operator.v1.decision';
  readonly id: string;
  readonly editionId: string;
  readonly sourceSha256: string;
  readonly reviewer: string;
  readonly reviewedAt: string;
  readonly bytes: ExactNumberToken;
};

export type PublisherCandidate = ExactJSONObject & {
  readonly schema: 'stellar-forge.360giving-operator.v1.candidate';
  readonly id: string;
  readonly editionId: string;
  readonly decisionId: string;
  readonly dataset: string;
  readonly programSha256: string;
  readonly candidateSha256: string;
  readonly grantCount: ExactNumberToken;
};

export type PublisherState = ExactJSONObject & {
  readonly schema: 'stellar-forge.360giving-operator.v1';
  readonly id: string;
  readonly createdAt: ExactNumberToken;
  readonly datasets: readonly PublisherDataset[];
  readonly editions: readonly PublisherEdition[];
  readonly decisions: readonly PublisherDecision[];
  readonly candidates: readonly PublisherCandidate[];
  readonly requests: readonly PublisherRequest[];
};

export type PublisherReview = ExactJSONObject & {
  readonly workspaceId: string;
  readonly edition: PublisherEdition;
  readonly report: ExactJSONValue;
  readonly template: ExactJSONValue;
};

export type PublisherComparison = ExactJSONObject & {
  readonly id: string;
  readonly changesSha256: string;
};

export type PublisherDatasetDescription = ExactJSONObject & {
  readonly name: string;
  readonly snapshot: string;
  readonly rowCount: ExactNumberToken;
};

export type PublisherBuild = ExactJSONObject & {
  readonly id: string;
  readonly source: string;
  readonly plan: string;
  readonly rowCount: ExactNumberToken;
  readonly keys: readonly string[];
  readonly native: PublisherDatasetDescription;
  readonly engineBlob: string;
  readonly files: ExactJSONObject;
};

export type PublisherNativeSource = ExactJSONObject & {
  readonly id: string;
  readonly label: string;
  readonly name: string;
  readonly bytes: ExactNumberToken;
  readonly created: ExactNumberToken;
};

export type PublisherNativePlan = ExactJSONObject & {
  readonly id: string;
  readonly name: string;
  readonly created: ExactNumberToken;
};

export type PublisherNativeState = ExactJSONObject & {
  readonly schema: string;
  readonly sources: readonly PublisherNativeSource[];
  readonly plans: readonly PublisherNativePlan[];
  readonly builds: readonly PublisherBuild[];
  readonly comparisons: readonly PublisherComparison[];
};

export type PublisherQueryPage = ExactJSONObject & {
  readonly schema: 'stellar-forge.dataset-page.v1';
  readonly dataset: PublisherDatasetDescription;
  readonly fields: readonly string[];
  readonly filters: ExactJSONObject;
  readonly rows: readonly ExactJSONObject[];
  readonly page: ExactJSONObject & {
    readonly limit: ExactNumberToken;
    readonly total: ExactNumberToken;
    readonly returned: ExactNumberToken;
    readonly nextCursor: string | null;
  };
};

/**
 * The original dataset engine returns its own status inside the HTTP200 JSON.
 * Narrow status === '200' before traversing rows; original query validation,
 * changed cursor/semantics and page-size failures retain their native body.
 */
export type PublisherQueryResponse =
  | (ExactJSONObject & {
      readonly status: '200';
      readonly headers: ExactJSONObject;
      readonly body: PublisherQueryPage;
    })
  | (ExactJSONObject & {
      readonly status: '400' | '409' | '413';
      readonly body: ExactJSONObject & {
        readonly error: string;
        readonly message: string;
      };
    });

export type PublisherQueryResult = ExactJSONObject & {
  readonly id: ExactNumberToken;
  readonly ok: true;
  readonly engineBlob: string;
  readonly dataset: PublisherDatasetDescription;
  readonly response: PublisherQueryResponse;
};

export type PublisherChangesPage = ExactJSONObject & {
  readonly rows: readonly ExactJSONObject[];
  readonly offset: ExactNumberToken;
  readonly nextOffset: ExactNumberToken | null;
};

export type PublisherUpload = ExactJSONObject & {
  /** The original content-addressed upload ID, identical to sha256. */
  readonly id: string;
  readonly sha256: string;
  /** Exact numeric token from the native receipt; supports zero-byte uploads. */
  readonly bytes: ExactNumberToken;
};

export type PublisherExportManifest = ExactJSONObject & {
  readonly schema: 'stellar-forge.360giving-operator.v1.handoff';
  readonly workspaceId: string;
  readonly request: string;
  readonly files: ExactJSONObject;
};

export type PublisherExportRequest = PublisherRequest & {
  readonly action: 'export';
  readonly status: 'complete';
  readonly result: ExactJSONObject & {
    readonly file: string;
    readonly sha256: string;
    readonly bytes: ExactNumberToken;
    readonly manifest: PublisherExportManifest;
  };
};

export interface PublisherDownload {
  /** Absolute path of the complete create-only file, or the matched original. */
  readonly path: string;
  readonly sha256: string;
  /** This explicitly validated file counter is a JavaScript number, at most 1 GiB. */
  readonly bytes: number;
}
export interface PublisherExportDownload extends PublisherDownload {
  readonly request: PublisherExportRequest;
}
export interface PublisherChangesDownload extends PublisherDownload {
  readonly comparison: PublisherComparison;
}

export type PublisherConnectionOptions = (
  | {
      /**
       * Private current-operator-owned nonsymlink connection file. It may contain
       * the original console URL or the saved Applications JSON record. Every
       * operation reopens and verifies a stable descriptor and its named entry.
       * A saved record must retain its original workspace and binding SHA-256.
       *
       * Select this form for managed restarts: the same workspace may update its
       * port/token/current binding while this client retains its first UUID.
       */
      readonly connectionFile: string;
      readonly consoleUrl?: never;
    }
  | {
      /**
       * Original http://127.0.0.1[:port]/#<43-character-bearer> URL. Port 80 has
       * canonical origin http://127.0.0.1. The client connects directly with
       * node:http; environment proxy settings and redirects are not followed.
       * This explicit URL remains fixed. Use connectionFile for rotating ports.
       */
      readonly consoleUrl: string;
      readonly connectionFile?: never;
    }
) & {
  readonly expectedWorkspaceId?: string;
  /** Whole-operation deadline and transport idle timeout; default 120000 ms. */
  readonly timeoutMs?: number;
};

export interface PublisherWaitOptions {
  readonly signal?: AbortSignal;
  /** Total wait deadline; default is the connection's timeoutMs. */
  readonly timeoutMs?: number;
  /** Delay between reads of this same request ID; default 500 ms. */
  readonly pollMs?: number;
}
export interface PublisherUploadOptions {
  readonly expectedSha256?: string;
  readonly signal?: AbortSignal;
}
export interface PublisherTextUploadOptions {
  readonly signal?: AbortSignal;
}
export interface PublisherDownloadOptions {
  /** The output parent directory must already exist. Existing files are verified. */
  readonly output: string;
  readonly signal?: AbortSignal;
}

export interface PublisherErrorDetails {
  readonly cause?: unknown;
  readonly operation?: string;
  readonly requestId?: string;
  /** Known selected upload identity, including when delivery was interrupted. */
  readonly objectId?: string;
  readonly statusCode?: number;
  readonly record?: PublisherRequest;
}

export class PublisherError extends Error {
  readonly name: 'PublisherError';
  readonly code: string;
  readonly operation?: string;
  /** Retain this same ID for request(), explicit resume(), or later wait(). */
  readonly requestId?: string;
  readonly objectId?: string;
  readonly statusCode?: number;
  readonly record?: PublisherRequest;
  constructor(code: string, message: string, details?: PublisherErrorDetails);
}

/**
 * Borrowed access to the original open publisher. Each method authenticates its
 * current /api/launch and retains the same workspace UUID for the client's life.
 * Responses retain all numeric source tokens as exact strings.
 */
export class PublisherClient {
  private constructor(options: PublisherConnectionOptions);
  readonly workspaceId: string;
  readonly closed: boolean;

  state(): Promise<PublisherState>;
  review(options: {readonly edition: string; readonly decision?: string}): Promise<PublisherReview>;
  nativeState(dataset: string): Promise<PublisherNativeState>;
  query(options: {
    readonly dataset: string;
    readonly build: string;
    /** Original native query parameters are scalar strings. */
    readonly query?: Readonly<Record<string, string>>;
  }): Promise<PublisherQueryResult>;
  changes(options: {
    readonly dataset: string;
    readonly comparison: string;
    /** Explicit safe integer counter; default 0. */
    readonly offset?: number;
    /** Original page size from 1 through 250; default 50. */
    readonly limit?: number;
  }): Promise<PublisherChangesPage>;

  request(id: string): Promise<PublisherRequest>;

  /**
   * Return the original HTTP202 admission immediately. A complete record may be
   * reused; an interrupted admission can be its old snapshot while the original
   * worker queues the requested continuation. This method does not call wait(),
   * choose another ID, or retry a mutation after an uncertain transport result.
   */
  submit(options: {
    readonly id: string;
    readonly action: PublisherAction;
    readonly input: PublisherInputObject;
  }): Promise<PublisherRequest>;

  /** Ask the original console to continue this ID; return its admission immediately. */
  resume(id: string): Promise<PublisherRequest>;

  /**
   * Read this same ID until complete, aborted, timed out or newly interrupted.
   * A retained interrupted admission from submit()/resume() is allowed to enter
   * its already-accepted queue before an actual new interruption is reported.
   * Errors retain requestId. This method never submits or resumes a request.
   */
  wait(id: string, options?: PublisherWaitOptions): Promise<PublisherRequest>;

  /**
   * Stream up to 1 GiB from one nonsymlink descriptor. Verify the initial hash,
   * the uploaded stream, the final descriptor/named identity and native receipt.
   */
  upload(path: string, options?: PublisherUploadOptions): Promise<PublisherUpload>;

  /**
   * Stream the original UTF-8 text without JSON parse/re-encoding. Exact decimals,
   * long integers, exponent spelling and named decisions remain original bytes.
   */
  uploadText(text: string, options?: PublisherTextUploadOptions): Promise<PublisherUpload>;

  /**
   * Select the completed original export record and its matching workspace/
   * request manifest. Stream and verify every byte and SHA-256, fsync the private
   * temporary file, then create-only publish. A different output is never replaced.
   */
  downloadExport(id: string, options: PublisherDownloadOptions): Promise<PublisherExportDownload>;

  /** Download the complete original saved comparison file with the same custody rules. */
  downloadChanges(options: {
    readonly dataset: string;
    readonly comparison: string;
    readonly output: string;
    readonly signal?: AbortSignal;
  }): Promise<PublisherChangesDownload>;

  /**
   * Abort and drain only this client's borrowed requests and file operations.
   * The original console and its accepted native jobs remain owned by the manager.
   * Repeated close calls share the same completion.
   */
  close(): Promise<void>;
}

/** Authenticate the original current connection and return its workspace-pinned client. */
export function connect360GivingPublisher(options: PublisherConnectionOptions): Promise<PublisherClient>;
