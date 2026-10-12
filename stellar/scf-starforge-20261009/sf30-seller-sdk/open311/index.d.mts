export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface Open311Connection {
  id?: string; name?: string; label?: string; baseUrl: string; jurisdictionId?: string | null;
  discoveryUrl?: string | null; allowHttp?: boolean;
  attribution?: { publisher?: string; title?: string; license?: string; licenseUrl?: string; sourceUrl?: string };
  apiKey?: string; apiKeyEnv?: string; apiKeyParameter?: string;
  timeoutMs?: number; maxResponseBytes?: number; responseLimit?: number;
  pagination?: boolean; extendedAttributes?: boolean;
  statusValues?: string[]; queryExtensions?: string[];
}
export interface RequestQuery {
  service_request_id?: string | number | (string | number)[] | null;
  service_code?: string | number | (string | number)[] | null;
  status?: string | string[] | null;
  start_date?: string | null; end_date?: string | null;
  page?: string | number | null; page_size?: string | number | null;
  extensions?: boolean | 'true' | 'false' | null;
  [key: string]: string | number | boolean | null | undefined | (string | number)[];
}
export type ProviderQuery = Record<string, string | number | boolean | null | undefined>;
export interface RequestOptions { signal?: AbortSignal; }
export interface RawResponse {
  encoding: 'base64'; body: string; sha256: string; bytes: number;
  complete: boolean; contentType: string | null;
}
export interface Coverage {
  returned: number | null; documentedLimit: number; mayBeTruncated: boolean | null;
  singlePage: true; paginationDeclared: boolean; page: number | null;
  rollingDateWindow: boolean; defaultWindowDays: 90;
}
export interface ResponseReceipt {
  method: 'GET'; url: string; status: number | null; statusText: string;
  headers: Record<string, string>; startedAt: string; observedAt: string;
  durationMs: number; kind: string; query: Record<string, string>; state: string;
  coverage?: Coverage;
}
export interface SourceResult<T = Json> {
  value: T | null; raw: RawResponse | null; receipt: ResponseReceipt;
}
export class Open311Error extends Error {
  constructor(code: string, message: string, result?: SourceResult | null);
  code: string; result: SourceResult | null; receipt: ResponseReceipt | null; raw: RawResponse | null;
  toJSON(): { name: string; code: string; message: string; result: SourceResult | null; receipt: ResponseReceipt | null };
}
export interface Open311Client {
  services(query?: ProviderQuery, options?: RequestOptions): Promise<SourceResult>;
  service(code: string | number, query?: ProviderQuery, options?: RequestOptions): Promise<SourceResult>;
  requests(query?: RequestQuery, options?: RequestOptions): Promise<SourceResult>;
  request(id: string | number, query?: ProviderQuery, options?: RequestOptions): Promise<SourceResult>;
  token(id: string | number, query?: ProviderQuery, options?: RequestOptions): Promise<SourceResult>;
  discovery(options?: RequestOptions): Promise<SourceResult>;
}
export function createClient(config: Open311Connection, options?: { fetchImpl?: typeof fetch }): Open311Client;
export interface RequestRow {
  id: string; key: string; connectionId: string; jurisdictionId: string | null;
  serviceRequestId: string; serviceCode: string | null; serviceName: string | null;
  status: string | null; description: string | null; address: string | null; agency: string | null;
  requestedAt: string | null; updatedAt: string | null; expectedAt: string | null;
  latitude: number | null; longitude: number | null; source: Record<string, Json>; sourceSha256: string;
}
export interface ServiceRow {
  id: string; serviceCode: string; serviceName: string | null; description: string | null;
  group: string | null; metadata: boolean | null; type: string | null; keywords: string | null;
  source: Record<string, Json>; sourceSha256: string;
}
export function canonicalJson(value: Json): string;
export function requestKey(connectionId: string, serviceRequestId: string | number): string;
export function normalizeRequests(value: Json, options: { connectionId: string; jurisdictionId?: string | null }): RequestRow[];
export function normalizeServices(value: Json): ServiceRow[];
export interface Capture {
  id?: string; kind?: string; resourceId?: string | number; connectionId?: string; query?: RequestQuery;
  config?: Open311Connection; connection?: Open311Connection; receipt?: ResponseReceipt;
  scope?: { connectionId?: string; baseUrl?: string; jurisdictionId?: string; query?: RequestQuery };
  rows: RequestRow[];
}
export interface CaptureComparison {
  added: RequestRow[];
  changed: { id: string; key: string; before: RequestRow; after: RequestRow; fields: string[] }[];
  unchanged: RequestRow[]; missingFromCapture: RequestRow[]; scopeComparable: boolean;
}
export function compareCaptures(before: Capture, after: Capture): CaptureComparison;
export interface RequestFilter {
  status?: string | string[]; service?: string | string[]; serviceCode?: string | string[];
  q?: string; offset?: number | string; limit?: number | string;
  sort?: 'requested' | 'updated' | 'expected' | 'id' | 'service' | 'status'; order?: 'asc' | 'desc';
}
export interface RequestPage { items: RequestRow[]; total: number; offset: number; limit: number; }
export function queryRequests(rows: RequestRow[], filter?: RequestFilter): RequestPage;
