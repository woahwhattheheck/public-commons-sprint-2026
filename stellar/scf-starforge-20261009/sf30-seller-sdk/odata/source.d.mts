// MIT. Signatures of source.mjs; source bytes and counts retain their exact forms.
import type { ODataCatalog, ODataMetadata, ODataEntitySet, ODataEntitySetMetadata, ODataError,
  ODataQueryPlan, ODataCompiledQuery, ODataTransportOptions, ODataPage, ODataHeaders } from './types.mjs';
export type * from './types.mjs';
export declare function discoverService(options: ODataTransportOptions & {
  url: string; allowLoopback?: boolean; metadataUrl?: string;
}): Promise<ODataCatalog>;
export declare function compileQuery(catalog: ODataCatalog, plan: ODataQueryPlan): ODataCompiledQuery;
export declare function fetchPage(options: ODataTransportOptions & {
  catalog: ODataCatalog; query: ODataCompiledQuery; url?: string;
}): Promise<ODataPage>;
export declare function parsePage(options: {
  catalog: ODataCatalog; query: ODataCompiledQuery; raw: string | Uint8Array; url?: string;
  headers?: ODataHeaders; status?: number; receivedAt?: string;
}): ODataPage;
export declare function normalizeSourceUrl(input: string | URL, options?: { allowLoopback?: boolean }): string;
export declare function parseMetadata(input: string | Uint8Array | Record<string, unknown>, options?: { contentType?: string }): ODataMetadata;
export declare function getEntitySet(catalog: ODataCatalog, selected: string): ODataEntitySet;
export declare function getEntitySet(catalog: ODataMetadata, selected: string): ODataEntitySetMetadata;
export declare function sha256(bytes: string | Uint8Array): string;
export declare function canonical(value: unknown): string | undefined;
export declare function fail(code: string, message: string, status?: number, detail?: Record<string, unknown>): ODataError;
