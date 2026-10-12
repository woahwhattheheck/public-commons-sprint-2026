export interface SetupOptions {directory:string;connection:string;name?:string;releaseStore?:string}
export interface SetupResult {
  schema:string;configuration:string;state:'INITIALIZED';open311FieldDeskWorkspacesConfigured:true;
  workspaces:{workspace:string;label:string;inputs:string[]}[];hostOwnership:'ORIGINAL_OPEN311_FIELD_DESK_WORKSPACES';
}
export function initializeFieldDeskMerchantWorkspace(options:SetupOptions):Promise<SetupResult>;
