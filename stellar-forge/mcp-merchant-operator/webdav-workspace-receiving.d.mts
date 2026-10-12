import type {
  WebDavWorkspaceClient, MutationToolName, ToolArguments, NativeResponse, Uuid, Sha256, JsonObject, RequestOptions
} from './webdav-workspace-client.mjs';
export interface WebDavOperationRecord {
  directory: string; schema: 'stellar-forge.webdav-client-operation.v1'; id: Uuid;
  endpoint: string; workspace: string; workspaceId: Uuid; tool: MutationToolName;
  args: ToolArguments[MutationToolName]; requestSha256: Sha256; createdAt: string; state: string;
  profileBinding: null | { kind: 'source'|'merchant'; profile: string; sha256: Sha256; value: JsonObject };
  observations: Array<JsonObject & { at: string; phase: string }>; lastNative: NativeResponse | null;
}
type OptionalReview<A> = A extends unknown
  ? Omit<A, 'operationId'|'expectedRevision'> & { operationId?: Uuid; expectedRevision?: number } : never;
type ReviewedArgs<N extends MutationToolName> = OptionalReview<ToolArguments[N]>;
export function prepareWebDavOperation<N extends MutationToolName>(input: {
  client: WebDavWorkspaceClient; directory: string; tool: N; args: ReviewedArgs<N>;
}, options?: RequestOptions): Promise<WebDavOperationRecord>;
export function inspectWebDavOperation(input: { directory: string }): Promise<WebDavOperationRecord>;
export function reconcileWebDavOperation(input: {
  client: WebDavWorkspaceClient; directory: string;
}, options?: RequestOptions): Promise<WebDavOperationRecord>;
export function runWebDavOperation(input: {
  client: WebDavWorkspaceClient; directory: string; resume?: boolean; reviewedRevision?: number;
}, options?: RequestOptions): Promise<WebDavOperationRecord>;
