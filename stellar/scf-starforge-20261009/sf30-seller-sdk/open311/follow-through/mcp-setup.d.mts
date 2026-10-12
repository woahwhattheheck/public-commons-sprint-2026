export interface SetupOptions {directory:string;connection:string;name?:string;releaseStore?:string}
export interface SetupResult {schema:string;configuration:string;state:'INITIALIZED';open311FollowThroughWorkspacesConfigured:true;workspaces:{workspace:string;label:string;inputs:string[]}[];hostOwnership:'ORIGINAL_OPEN311_FOLLOW_THROUGH_WORKSPACES'}
export function initializeFollowThroughMerchantWorkspace(options:SetupOptions):Promise<SetupResult>;
