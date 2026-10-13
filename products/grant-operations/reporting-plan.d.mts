import type { GrantPerformanceReport } from '../../stellar/scf_2026/sf47_budget_model/workspace/agent-client.mjs';
import type { GrantHandoffReport } from './handoff.mjs';
import type { OperatingPlan } from '../../stellar/scf-starforge-20261009/distribution/discovery/operating-plan.mjs';
import type { GrantReportingProfile, GrantReportingCatalog } from './reporting.mjs';
export const GRANT_REPORTING_PROFILE_SCHEMA: 'stellar-forge.grant-reporting-profile.v1';
export const GRANT_REPORTING_HANDOFF_SCHEMA: 'stellar-forge.grant-reporting-handoff.v1';
export function inspectGrantReportingProfile(value: GrantReportingProfile): Required<GrantReportingProfile>;
export function inspectGrantReportingSource(report: GrantPerformanceReport): GrantPerformanceReport;
export function createGrantReportingPlan(options: {
  id: string; report: GrantPerformanceReport; catalog: GrantReportingCatalog;
  profile: GrantReportingProfile; savedAt?: string;
}): OperatingPlan;
export function refreshGrantReportingPlan(options: {
  plan: OperatingPlan; report: GrantPerformanceReport; catalog: GrantReportingCatalog;
  profile: GrantReportingProfile; savedAt?: string;
}): OperatingPlan;
export function receiveGrantReportingPlan(options: {
  plan: OperatingPlan; profile: GrantReportingProfile; destination: GrantReportingProfile;
  receipt: GrantHandoffReport; savedAt?: string;
}): OperatingPlan;
