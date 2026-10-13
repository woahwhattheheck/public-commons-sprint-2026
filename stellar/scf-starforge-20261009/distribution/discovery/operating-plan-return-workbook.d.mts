import type { OperatingPlanReturn } from './operating-plan-return.mjs';
export const OPERATING_RETURN_WORKING_SCHEMA: 'stellar-forge.operating-plan-return-working.v1';
export const OPERATING_RETURN_WORKBOOK_SCHEMA: 'stellar-forge.operating-plan-return-workbook.v1';
export const OPERATING_RETURN_WORKING_MAX_BYTES: number;
export const OPERATING_RETURN_WORKBOOK_MAX_BYTES: number;
export interface OperatingReturnWorking {
  schema: typeof OPERATING_RETURN_WORKING_SCHEMA;
  review: OperatingPlanReturn;
  details: { reviewer: string; notes: string };
  /** Exact unfinished editor text; custom JSON need not yet parse. */
  buffers: Record<string, { take: 'automatic' | 'current' | 'incoming' | 'base' | 'custom'; note: string; custom: string }>;
}
export type OperatingReturnWorkbookSources = Record<
  'catalog' | 'plan' | 'review' | 'workbook' | 'editor' | 'html' | 'css' | 'guide', string>;
export const OPERATING_RETURN_WORKBOOK_ASSETS: readonly Readonly<{
  key: keyof OperatingReturnWorkbookSources; route: string; file: string;
}>[];
/** Normalize a complete review or original working-review envelope without interpreting unfinished text. */
export function inspectOperatingReturnWorking(value: unknown): OperatingReturnWorking;
/** Application sources must be the complete trusted maintained source edition. */
export function renderOperatingReturnWorkbook(value: unknown, sources: OperatingReturnWorkbookSources,
  options?: { id?: string }): string;
