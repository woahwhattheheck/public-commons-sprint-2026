export interface SetupOptions {directory:string;connection:string;name?:string;releaseStore?:string}
export interface SetupResult {
  schema:string;configuration:string;state:'INITIALIZED';open311ServiceConfigurationWorkspacesConfigured:true;
  workspaces:{workspace:string;label:string;inputs:string[]}[];hostOwnership:'ORIGINAL_OPEN311_SERVICE_CONFIGURATION_WORKSPACES';
}
export function initializeServiceConfigurationMerchantWorkspace(options:SetupOptions):Promise<SetupResult>;
