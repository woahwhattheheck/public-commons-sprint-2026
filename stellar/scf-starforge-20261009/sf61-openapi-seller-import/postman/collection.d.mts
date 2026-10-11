/** Retained Postman Collection v2.1 input for the original Starforge merchant. */
export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export interface JsonObject { [key: string]: JsonValue; }
export type PublicSample = string | number | boolean;
export type MerchantMethod = 'GET' | 'HEAD' | 'DELETE' | 'POST' | 'PUT' | 'PATCH';
export type ResponseMode = 'json' | 'bytes';
export type UrlSource = 'structured' | 'raw';

export declare const POSTMAN_SOURCE_SCHEMA: 'stellar-forge.postman-source.v1';

/** Exact source JSON pointers identify requests, including requests in folders. */
export interface PostmanRequestDecision {
  pointer: string;
  urlSource?: UrlSource;
  pathVariables?: Record<string, PublicSample>;
  body?: JsonObject;
  bodySchema?: JsonObject;
  useResolvedValues?: boolean;
  responseMode?: ResponseMode;
}
export interface PostmanDecisions {
  publicVariables?: Record<string, PublicSample>;
  requests?: PostmanRequestDecision[];
}
export interface PostmanInput {
  collectionText: string;
  environmentText?: string | null;
  decisions?: PostmanDecisions;
}
export interface PreRequestScript {
  pointer: string;
  sha256: string;
  lines: number;
  externalSource: boolean;
}
export interface RequestExample {
  pathParams: Record<string, string>;
  query: Record<string, string>;
  body?: JsonObject;
}
export interface PostmanRequestReview {
  pointer: string;
  name: string;
  method: MerchantMethod;
  resolvedUrl: string;
  backend: string;
  path: string;
  urlSource: UrlSource;
  auth: 'noauth' | 'bearer' | 'basic' | 'apikey' | 'oauth2';
  backendHeaders: string[];
  requestExample: RequestExample;
  bodyMediaType: 'application/json' | 'multipart/form-data' | null;
  requestSchema: JsonObject | null;
  requestSchemaOrigin: 'operator-declared' | 'sample-derived' | null;
  bodyAdaptation: string | null;
  responseMode: ResponseMode;
  responseValidation: 'none';
  responseExamples: Array<{ status: JsonValue; bytes: number }>;
  preRequestScripts: PreRequestScript[];
  scriptsAccepted: boolean;
}
export interface SupportedPostmanRequest extends PostmanRequestReview {
  supported: true;
}
export interface UnsupportedPostmanRequest {
  pointer: string;
  name: string;
  method: string;
  preRequestScripts: PreRequestScript[];
  supported: false;
  error: string;
}
export interface PostmanInventory {
  title: string;
  collectionSha256: string;
  environment: string | null;
  environmentSha256: string | null;
  variableNames: string[];
  requests: Array<SupportedPostmanRequest | UnsupportedPostmanRequest>;
}
export interface PostmanHashes {
  collection: string;
  environment: string | null;
  decisions: string;
  document: string;
}
export interface PostmanReview extends PostmanHashes {
  title: string;
  requests: PostmanRequestReview[];
}
export interface PostmanSourcePacket {
  schema: typeof POSTMAN_SOURCE_SCHEMA;
  collectionText: string;
  environmentText: string | null;
  decisions: {
    publicVariables: Record<string, string>;
    requests: PostmanRequestDecision[];
  };
  hashes: PostmanHashes;
}
/** Row for the existing stellar-forge.api-merchant-plan.v1 operations list. */
export interface PostmanOperationPlan {
  method: MerchantMethod;
  path: string;
  id: string;
  serverIndex: 0;
  headerEnv: Record<string, string>;
  responseMode: ResponseMode;
  responseValidation: 'none';
  requestExample: RequestExample;
  oauth2?: {
    clientIdEnv: string;
    clientSecretEnv: string;
    scope?: string;
  };
}
export interface PreparedPostmanSource {
  /** Exact serialized private packet, including its final newline. */
  specText: string;
  review: PostmanReview;
  operations: PostmanOperationPlan[];
}
export interface OpenedPostmanSource {
  document: JsonObject;
  summary: PostmanReview;
  operations: PostmanOperationPlan[];
}

/** Inspect the actual source without reading environment values or making requests. */
export declare function inspectPostman(input: PostmanInput): PostmanInventory;
/** Prepare selected reviewed requests; throws when any selected request cannot compile. */
export declare function preparePostmanSource(input: PostmanInput): PreparedPostmanSource;
/** Regenerate the retained document and verify all four original source hashes. */
export declare function openPostmanSource(packet: PostmanSourcePacket): OpenedPostmanSource;
/** Enforce imported fixed backend header references in the original merchant model. */
export declare function requirePostmanHeaderReferences(
  operation: JsonObject,
  headers: Record<string, string>,
): void;
