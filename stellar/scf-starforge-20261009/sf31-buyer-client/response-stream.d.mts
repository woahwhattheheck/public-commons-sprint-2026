export interface BuyerResponseStreamOptions {
  format: 'sse' | 'ndjson';
  /** Wire bytes in one framed record, including line delimiters. Default 1 MiB. */
  maxRecordBytes?: number;
  /** Complete dispatched records. Default 100,000. */
  maxRecords?: number;
}
export interface BuyerStreamSummary {
  readonly format: 'sse' | 'ndjson';
  readonly records: number;
  readonly bytes: number;
  readonly complete: boolean;
  readonly pendingRecord: boolean;
  readonly lastCompleteByte: number;
  readonly lastEventId?: string;
  readonly retryMilliseconds?: number | null;
  readonly emptyLines?: number;
  readonly error?: string;
}
export interface BuyerStreamEvent {
  readonly index: number;
  readonly format: 'sse';
  readonly event: string;
  readonly data: string;
  readonly id: string;
  readonly retry?: number;
}
export interface BuyerJsonRecord<T = unknown> {
  readonly index: number;
  readonly format: 'ndjson';
  readonly value: T;
}
export type BuyerStreamRecord = BuyerStreamEvent | BuyerJsonRecord;
export class BuyerResponseStreamError extends Error {
  readonly code: string;
  readonly stream?: BuyerStreamSummary;
  constructor(code: string);
}
export function normalizeResponseStream(options: BuyerResponseStreamOptions): Readonly<Required<BuyerResponseStreamOptions>>;
export function responseStreamContentType(format: 'sse' | 'ndjson', contentType: string | null): boolean;
export function createResponseStreamParser(options: BuyerResponseStreamOptions): {
  readonly options: Readonly<Required<BuyerResponseStreamOptions>>;
  push(chunk: Uint8Array): BuyerStreamRecord[];
  finish(): BuyerStreamRecord[];
  summary(): BuyerStreamSummary;
};
export function parseResponseStream(chunks: AsyncIterable<Uint8Array>,
  options: BuyerResponseStreamOptions & { signal?: AbortSignal }): AsyncIterable<BuyerStreamRecord>;
