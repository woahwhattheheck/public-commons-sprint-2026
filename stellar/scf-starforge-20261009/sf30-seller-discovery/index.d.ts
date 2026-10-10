/** Source: x402 v2 + Bazaar 2026-10-10. `amount` is atomic units, not a display price. */
export interface JSONSchema {
  type?: string | string[];
  properties?: Record<string, JSONSchema>;
  required?: string[];
  description?: string;
  examples?: unknown[];
  example?: unknown;
  default?: unknown;
  [keyword: string]: unknown;
}
export type StellarNetwork = `stellar:${string}`;
export interface PaymentRequirement {
  scheme: 'exact' | 'upto';
  network: StellarNetwork;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}
export interface SellerResource {
  url: string;
  description?: string;
  mimeType?: string;
  serviceName?: string;
  tags?: string[];
  iconUrl?: string;
}
export interface HttpDiscovery {
  type: 'http';
  method: 'GET' | 'HEAD' | 'DELETE' | 'POST' | 'PUT' | 'PATCH';
  querySchema?: JSONSchema;
  bodySchema?: JSONSchema;
  bodyType?: 'json' | 'form-data' | 'text';
  headers?: Record<string, string>;
}
export interface McpDiscovery {
  type: 'mcp';
  toolName: string;
  inputSchema: JSONSchema;
  description?: string;
  transport?: 'sse' | 'streamable-http';
}
export interface SellerOptions {
  resource: SellerResource;
  accepts: PaymentRequirement[];
  input: HttpDiscovery | McpDiscovery;
  output?: { type: string; format?: string; example?: unknown };
  routeTemplate?: string;
  /** Only for developer-controlled HTTP loopback; NEVER on a public host. */
  allowHttpLoopback?: boolean;
}
export interface PaymentRequiredV2 {
  x402Version: 2;
  error: string;
  resource: SellerResource;
  accepts: PaymentRequirement[];
  extensions: {
    bazaar: {
      info: { input: Record<string, unknown>; output?: Record<string, unknown> };
      schema: JSONSchema;
      routeTemplate?: string;
    };
  };
}
export declare function createSellerDiscovery(options: SellerOptions): PaymentRequiredV2;
export declare function makePaymentRequiredResponse(seller: PaymentRequiredV2): {
  statusCode: 402;
  headers: Record<string, string>;
  body: string;
  paymentRequired: PaymentRequiredV2;
};
export interface CatalogIngestion {
  ingest(args: {paymentPayload: unknown; settlement: unknown; sequence: number}): {decision: string; reason: string; [field:string]:unknown};
}
export declare function verifyCatalogAcceptance(options: {
  seller: PaymentRequiredV2;
  /** Echoed by a client, and independently checked against `seller`. */
  paymentPayload: Record<string, unknown>;
  /** Trusted facilitator hook output, NEVER client-provided data. */
  settlement: Record<string, unknown>;
  sequence: number;
  catalog: CatalogIngestion;
}): {decision: string; reason: string; [field:string]:unknown};
