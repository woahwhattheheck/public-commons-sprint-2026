import type { CommandCatalog, CatalogItem, CatalogPackage } from './catalog.mjs';
export const OPERATING_PLAN_SCHEMA: 'stellar-forge.operating-plan.v1';
export const OPERATING_DRAFT_SCHEMA: 'stellar-forge.operating-plan-draft.v1';
export const OPERATING_COMPARISON_SCHEMA: 'stellar-forge.operating-plan-comparison.v1';
export type OperatingStepState = 'planned' | 'in-progress' | 'completed' | 'skipped';
export const STEP_STATES: readonly OperatingStepState[];
export interface OperatingRegistration {
  package: CatalogPackage;
  capturedAt: string | null;
  item: CatalogItem;
  sources: CommandCatalog['sources'];
  runtimeGroups: CatalogItem[];
}
export const OPERATING_FILE_MAX_BYTES: number;
export interface OperatingFile {
  id: string; name: string; mediaType: string; bytes: number; encoding: 'base64'; content: string; note: string;
}
export type OperatingFileSummary = Omit<OperatingFile, 'content'>;
export interface OperatingFileComparison {
  orderChanged: boolean; previous: OperatingFileSummary[]; returned: OperatingFileSummary[];
  added: OperatingFileSummary[]; removed: OperatingFileSummary[];
  changed: Array<{ id: string; previous: OperatingFileSummary; returned: OperatingFileSummary; contentChanged: boolean }>;
}
export interface OperatingStep {
  id: string; title: string; instruction: string; inputs: string; expectedResult: string;
  owner: string; due: string; status: OperatingStepState; recordedResult: string;
  argv: string[]; selection: OperatingRegistration | null; files?: OperatingFile[];
}
export interface OperatingPlanContent {
  title: string; customer: string; purpose: string; period: string; owner: string;
  receiving: string; notes: string; steps: OperatingStep[];
}
export interface OperatingRevision extends OperatingPlanContent { revision: number; savedAt: string }
export interface OperatingPlan {
  schema: typeof OPERATING_PLAN_SCHEMA; id: string; createdAt: string;
  origin: { id: string; revision: number; createdAt: string } | null;
  revisions: OperatingRevision[];
}
export interface OperatingPlanDraft {
  schema: typeof OPERATING_DRAFT_SCHEMA; planId: string; baseRevision: number;
  content: OperatingPlanContent;
}
export interface OperatingComparisonStep {
  stepId: string; title: string; itemId: string | null;
  status: 'manual' | 'unchanged' | 'changed' | 'missing'; changedFields: string[];
  packageChanged?: boolean; original?: OperatingRegistration; current?: OperatingRegistration | null;
}
export interface OperatingComparison {
  schema: typeof OPERATING_COMPARISON_SCHEMA; planId: string; revision: number;
  package: CatalogPackage; capturedAt: string | null; total: number;
  counts: Record<OperatingComparisonStep['status'], number>; steps: OperatingComparisonStep[];
}
export interface OperatingPlanSummary {
  id: string; revision: number; revisions: number; title: string; customer: string; purpose: string;
  period: string; owner: string; savedAt: string; steps: number;
  counts: Record<OperatingStepState, number>; registrations: string[];
}
/** Validates the complete history and returns an independent value. */
export function inspectOperatingPlan(value: unknown): OperatingPlan;
export function operatingPlanRevision(plan: OperatingPlan, revision?: number): OperatingRevision;
/** Historical content continues against the latest saved revision. */
export function operatingPlanDraft(plan: OperatingPlan, revision?: number): OperatingPlanDraft;
export function createOperatingPlan(options: Pick<OperatingPlanContent, 'title'> &
  Partial<Omit<OperatingPlanContent, 'title'>> & { id: string; savedAt?: string }): OperatingPlan;
/** Appends a revision only if its base is current and its content changed. */
export function saveOperatingPlanRevision(plan: OperatingPlan, draft: OperatingPlanDraft,
  options?: { savedAt?: string }): OperatingPlan;
export function snapshotRegistration(catalog: CommandCatalog, itemId: string): OperatingRegistration;
export function createOperatingStep(options: { id: string } & Partial<Omit<OperatingStep, 'id'>>): OperatingStep;
export function addOperatingStep(draft: OperatingPlanDraft, step: OperatingStep, beforeId?: string | null): OperatingPlanDraft;
export function moveOperatingStep(draft: OperatingPlanDraft, stepId: string, index: number): OperatingPlanDraft;
/** Gives the complete retained history a new ID and optionally appends edited content. */
export function forkOperatingPlan(plan: OperatingPlan, options: {
  id: string; title?: string; savedAt?: string; draft?: OperatingPlanDraft;
}): OperatingPlan;
/** Replays an identical history or extends it; divergent shared revisions are rejected. */
export function receiveOperatingPlan(incoming: OperatingPlan, existing?: OperatingPlan | null):
  { plan: OperatingPlan; reused: boolean; addedRevisions: number };
export function compareOperatingPlan(plan: OperatingPlan, catalog: CommandCatalog,
  options?: { revision?: number }): OperatingComparison;
export function summarizeOperatingPlan(plan: OperatingPlan, options?: { revision?: number }): OperatingPlanSummary;
/** POSIX shell display quoting; this function does not execute a command. */
export function shellArgument(value: string): string;
export function operatingStepCommand(step: OperatingStep): string;
export function renderOperatingPlanMarkdown(plan: OperatingPlan, options?: { revision?: number }): string;
export function renderOperatingPlanHTML(plan: OperatingPlan, options?: { revision?: number }): string;

/** Retains complete original binary contents in the saved step; older steps remain unchanged. */
export function inspectOperatingFile(value: unknown): OperatingFile;
export function createOperatingFile(options: { id: string; name: string; bytes: Uint8Array; mediaType?: string; note?: string }): OperatingFile;
export function operatingFileBytes(file: OperatingFile): Uint8Array;
export function operatingFileSummary(file: OperatingFile): OperatingFileSummary;
export function addOperatingFile(draft: OperatingPlanDraft, stepId: string, file: OperatingFile): OperatingPlanDraft;
export function removeOperatingFile(draft: OperatingPlanDraft, stepId: string, fileId: string): OperatingPlanDraft;
export function compareOperatingFiles(previous?: OperatingFile[], returned?: OperatingFile[]): OperatingFileComparison;
