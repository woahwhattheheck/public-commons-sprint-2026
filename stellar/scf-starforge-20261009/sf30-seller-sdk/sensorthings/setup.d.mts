/** MIT. Source-owned SensorThings setup; normal provider/runtime ownership is unchanged. */
export type SensorThingsWorkspaceReference = {
  workspaceId: string;
  label?: string;
} & (
  { consoleUrlFile: string; consoleUrlEnv?: never; applicationUrlFile?: never } |
  { consoleUrlEnv: string; consoleUrlFile?: never; applicationUrlFile?: never } |
  { applicationUrlFile: string; consoleUrlFile?: never; consoleUrlEnv?: never }
);
export type SensorThingsConnectionOptions = {
  file: string;
  workspaces: Record<string, SensorThingsWorkspaceReference>;
};
export type SensorThingsMerchantSetupOptions = {
  directory: string;
  connection: string;
  name?: string;
  /** Select an existing original SF82 store; omission creates the private host store. */
  releaseStore?: string;
};
export type SensorThingsWorkspaceBinding = {
  workspace: string;
  label: string;
  workspaceId: string;
  connection: 'ORIGINAL_APPLICATIONS_RECORD' | 'ORIGINAL_PRIVATE_URL_FILE' | 'ORIGINAL_PRIVATE_URL_ENV';
};
export type SensorThingsConnectionResult = {
  schema: 'stellar-forge.sensorthings-workspace-connection.v1';
  file: string;
  reused: boolean;
  sha256: string;
  bytes: number;
  bindingSha256: string;
  workspaces: SensorThingsWorkspaceBinding[];
  sessionChecked: false;
};
export type SensorThingsMerchantSetupResult = {
  schema: 'stellar-forge.sensorthings-merchant-setup-complete.v1';
  setupSchema: 'stellar-forge.sensorthings-merchant-setup.v1';
  provider: 'sensorthings-workspaces';
  configuration: string;
  configurationSha256: string;
  connection: string;
  connectionBindingSha256: string;
  clientConfiguration: string;
  clientConfigurationSha256: string;
  releaseStore: string;
  workspaceIds: { workspace: string; workspaceId: string }[];
  ownership: 'EXISTING_SENSORTHINGS_WORKSPACE';
  sessionChecked: false;
  completedAt: string;
  state: 'INITIALIZED' | 'RESUMED' | 'REOPENED';
  reused: boolean;
  workspaces: SensorThingsWorkspaceBinding[];
  clientSourceMatchesCurrentInstallation: boolean;
  next: string;
};
export const SENSORTHINGS_SETUP_SCHEMA: 'stellar-forge.sensorthings-merchant-setup.v1';
export function createSensorThingsWorkspaceConnection(options: SensorThingsConnectionOptions): Promise<SensorThingsConnectionResult>;
export function initializeSensorThingsWorkspaceMerchant(options: SensorThingsMerchantSetupOptions): Promise<SensorThingsMerchantSetupResult>;
export function main(args?: string[]): Promise<SensorThingsConnectionResult | SensorThingsMerchantSetupResult | undefined>;
