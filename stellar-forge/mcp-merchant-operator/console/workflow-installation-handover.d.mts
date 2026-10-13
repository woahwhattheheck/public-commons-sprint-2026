import type { Json } from './workflow-series-client.mjs';
export declare const WORKFLOW_INSTALLATION_SOURCE: 'stellar-forge.workflow-installation-source.v1';
export interface InstallationPeriodSelection { cycleId: string; deliveryIds: string[] }
export interface InstallationSourceExport {
  directory: string;
  input: { periods: InstallationPeriodSelection[] };
  output: string;
  python?: string;
  signal?: AbortSignal;
}
export declare function exportWorkflowInstallation(input: InstallationSourceExport): Promise<{
  schema: typeof WORKFLOW_INSTALLATION_SOURCE;
  output: { path: string; bytes: number; sha256: string; existing?: boolean; durabilityWarning?: string };
  profileId: string;
  periods: Array<InstallationPeriodSelection & Record<string, Json>>;
  files: number;
  expandedBytes: number;
}>;
