import type { OperatingPlan, OperatingPlanDraft } from './operating-plan.mjs';
export const OPERATING_RETURN_SCHEMA: 'stellar-forge.operating-plan-return.v1';
export const OPERATING_RETURN_COMPARISON_SCHEMA: 'stellar-forge.operating-plan-return-comparison.v1';
export const OPERATING_RETURN_MAX_BYTES: number;
export const OPERATING_RETURN_PLAN_MAX_BYTES: number;
export type OperatingReturnChoice = 'current' | 'incoming' | 'base' | 'custom';
export const OPERATING_RETURN_CHOICES: readonly OperatingReturnChoice[];
export type OperatingReturnJSON = null | boolean | number | string | OperatingReturnJSON[] |
  { [key: string]: OperatingReturnJSON };
export interface OperatingReturnDecision {
  key: string; take: OperatingReturnChoice; note: string;
  /** Present only for a custom choice. */
  value?: OperatingReturnJSON;
  /** Captured exact projected order for a base/current/incoming order choice. */
  order?: string[];
}
export interface OperatingPlanReturn {
  schema: typeof OPERATING_RETURN_SCHEMA; id: string; createdAt: string;
  /** New reviews group complete result files with progress. Unversioned reviews retain compatible maintained comparisons or their validated original historical interpretation. */
  reportingVersion?: 2;
  current: OperatingPlan; incoming: OperatingPlan; reviewer: string; notes: string;
  decisions: OperatingReturnDecision[];
  completion: { savedAt: string; plan: OperatingPlan } | null;
}
export interface OperatingReturnRow {
  key: string; kind: 'plan-field' | 'step-field' | 'step-presence' | 'step-context' |
    'step-command' | 'step-progress' | 'step-order';
  label: string; stepId: string | null;
  base: OperatingReturnJSON; current: OperatingReturnJSON; incoming: OperatingReturnJSON;
  automatic: 'current' | 'incoming' | null; conflict: boolean; reason?: string;
  take: OperatingReturnChoice; value: OperatingReturnJSON; reviewed: boolean; note: string;
  alternatives?: Record<'base' | 'current' | 'incoming', string[]>;
  stale?: boolean; reviewedOrder?: string[];
}
export interface OperatingReturnComparison {
  schema: typeof OPERATING_RETURN_COMPARISON_SCHEMA; reviewId: string; planId: string;
  incomingPlanId: string; relationship: 'same-plan' | 'returned-copy';
  commonRevision: number; currentRevision: number; incomingRevision: number;
  rows: OperatingReturnRow[]; unresolved: string[];
  issues: Array<{ key: string; message: string }>; ready: boolean; draft: OperatingPlanDraft;
  summary: { changes: number; conflicts: number; decisions: number; steps: number; unresolved: number };
}
/** Validates complete source histories, decisions and a recomputed original-format completed result. */
export function inspectOperatingPlanReturn(value: unknown): OperatingPlanReturn;
export function createOperatingPlanReturn(current: OperatingPlan, incoming: OperatingPlan, options: {
  id: string; reviewer?: string; notes?: string; createdAt?: string;
}): OperatingPlanReturn;
export function compareOperatingPlanReturn(value: OperatingPlanReturn): OperatingReturnComparison;
export function reviseOperatingPlanReturn(value: OperatingPlanReturn,
  updates: { reviewer?: string; notes?: string }): OperatingPlanReturn;
/** null removes the explicit choice; source order choices capture their current complete projected order. */
export function decideOperatingPlanReturn(value: OperatingPlanReturn, key: string,
  decision?: { take: OperatingReturnChoice; value?: OperatingReturnJSON; note?: string } | null): OperatingPlanReturn;
/**
 * Keeps an unchanged current history or appends through the original saver.
 * Exact forward histories use the original receiver, retaining intermediate revisions.
 * An already represented result returns the actual later plan unchanged, with addedRevisions zero.
 * Persist review before a destination transaction writes plan.
 */
export function applyOperatingPlanReturn(value: OperatingPlanReturn,
  options?: { current?: OperatingPlan; savedAt?: string }):
  { review: OperatingPlanReturn; plan: OperatingPlan; alreadyPresent: boolean;
    addedRevisions: number; reviewedRevisions: number };
export function renderOperatingPlanReturnHTML(value: OperatingPlanReturn): string;
