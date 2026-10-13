import type { CommandCatalog } from '../../stellar/scf-starforge-20261009/distribution/discovery/catalog.mjs';
import type { OperatingPlan, OperatingFile } from '../../stellar/scf-starforge-20261009/distribution/discovery/operating-plan.mjs';
export const WORLD_BANK_BRIEF_SCHEMA: 'stellar-forge.worldbank-commissioning-brief.v1';
export const COMMISSIONING_STEP_IDS: readonly string[];
export interface WorldBankCommissioningBrief {
  schema: typeof WORLD_BANK_BRIEF_SCHEMA;
  id: string; createdAt: string; title: string; customer: string; purpose: string;
  period: string; owner: string; receiving: string; operationId: string; prefix: string; python: string;
  paths: { sourceWorkspace: string; analysisWorkspace: string; handover: string; customerWorkspace: string };
  scope: { source: string; countries: string[]; indicators: string[]; periods: string[];
    rights: string; missingValues: string; review: string; calculations: string; workbook: string;
    acceptance: string; care: string; recurrence: string };
  assignments?: Record<string, { owner?: string; due?: string }>;
  attachments?: Array<{ id: string; step: string; path: string; name: string; mediaType: string; note: string }>;
}
export function inspectWorldBankCommissioningBrief(value: unknown): WorldBankCommissioningBrief;
export function createWorldBankCommissioningPlan(input: {
  brief: WorldBankCommissioningBrief; catalog: CommandCatalog; briefBytes: Uint8Array;
  files?: Array<{ step: string; file: OperatingFile }>;
}): OperatingPlan;
