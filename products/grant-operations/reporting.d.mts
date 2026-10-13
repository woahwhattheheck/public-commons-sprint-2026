import type { Buffer } from 'node:buffer';
import type { GrantWorkspaceClient, GrantPerformanceReport } from '../../stellar/scf_2026/sf47_budget_model/workspace/agent-client.mjs';
import type { GrantRuntimeWorkspace, GrantHandoffBindings } from './handoff.mjs';
import type { OperatingPlan } from '../../stellar/scf-starforge-20261009/distribution/discovery/operating-plan.mjs';

export const GRANT_REPORTING_MAX_BYTES: number;
export interface GrantReportingProfile {
  schema: 'stellar-forge.grant-reporting-profile.v1';
  title: string;
  customer: string;
  owner: string;
  receiving: string;
  workspaceDirectory: string;
  workingDirectory: string;
  pythonExecutable?: string;
  command?: string[];
  notes?: string;
  dueDate?: string;
}
export interface GrantReportingFile {
  filename: string;
  mediaType: string;
  bytes: number;
  sha256: string;
  contentBase64: string;
}
export interface GrantReportingHandoff {
  schema: 'stellar-forge.grant-reporting-handoff.v1';
  id: string;
  createdAt: string;
  profile: GrantReportingProfile;
  source: Record<string, unknown>;
  report: GrantReportingFile;
  case: GrantReportingFile;
  plan: OperatingPlan;
}
export interface GrantReportingCatalog {
  schema: 'stellar-forge.operator-discovery.v1';
  package: Record<string, unknown>;
  capturedAt: string | null;
  sources: Record<string, unknown>[];
  items: Record<string, unknown>[];
  [key: string]: unknown;
}
export function inspectGrantReportingHandoff(value: GrantReportingHandoff): {
  id: string; createdAt: string; profile: GrantReportingProfile; plan: OperatingPlan;
  report: GrantPerformanceReport; reportBytes: Buffer; caseBytes: Buffer; source: Record<string, unknown>;
};
export function captureGrantReporting(options: {
  client: GrantWorkspaceClient; catalog: GrantReportingCatalog; profile: GrantReportingProfile;
  caseId: string; startDate?: string; endDate: string;
  plan?: OperatingPlan; id?: string; savedAt?: string;
}): Promise<GrantReportingHandoff>;
export function packGrantReportingPlan(packet: GrantReportingHandoff, plan: OperatingPlan): GrantReportingHandoff;
export function readGrantReportingJSON(filename: string): Promise<unknown>;
export function saveGrantReportingJSON(filename: string, value: unknown): Promise<{filename: string; bytes: number; sha256: string}>;
export function inspectGrantReportingArchive(packet: GrantReportingHandoff, pythonExecutable?: string): Record<string, unknown>;
export function unpackGrantReporting(packet: GrantReportingHandoff, directory: string, options?: {pythonExecutable?: string}): Promise<Record<string, unknown>>;
export function receiveGrantReporting(options: {
  model: GrantRuntimeWorkspace; packet: GrantReportingHandoff; catalog: GrantReportingCatalog;
  bindings: GrantHandoffBindings; profile: GrantReportingProfile; operation: string; directory: string;
}): Promise<Record<string, unknown>>;
