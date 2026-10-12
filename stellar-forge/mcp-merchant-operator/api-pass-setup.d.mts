/** Initialize or reopen a private original merchant registration for an existing API customer. */
export interface ApiPassMerchantSetupOptions {
 directory:string;
 /** Private stellar-forge.sf101.api-pass-mcp-connection.v1 file. */
 connection:string;
 name?:string;
 /** Existing original SF82 release store; omitted creates this setup's original empty store. */
 releaseStore?:string;
}
export interface ApiPassMerchantSetupResult {
 schema:'stellar-forge.merchant-mcp.v1'; configuration:string; state:'INITIALIZED'|'REOPENED';
 apiPassWorkspacesConfigured:true; ownership:'ORIGINAL_RUNNING_API_PASS_WORKSPACE';
 workspaces:Array<{workspace:string;label:string;workspaceId:string}>;
}
export function initializeApiPassWorkspaceMerchant(options:ApiPassMerchantSetupOptions):Promise<ApiPassMerchantSetupResult>;
