import type { CommandCatalog } from './catalog.mjs';
import type { OperatingPlan } from './operating-plan.mjs';

export const GRANT_REPORTING_PREPARATION_SCHEMA: 'stellar-forge.grant-reporting-preparation.v1';
export class GrantReportingInputError extends TypeError {
  code: string;
  details: Record<string, unknown>;
  constructor(code: string, message: string, details?: Record<string, unknown>);
}
export interface GrantReportingPaths {
  workspace: string;
  sourceProject: string;
  outputDirectory: string;
  receivingWorkspace: string;
  /** Original loopback HTTP address with its explicit port, including :80. */
  commandFinderUrl: string;
}
export interface GrantReportingValues {
  title: string;
  customer?: string;
  period?: string;
  /** The original step owner accepts at most 300 characters. */
  owner?: string;
  receiving?: string;
  startDate?: string | null;
  asOfDate: string;
  paths: GrantReportingPaths;
  /** Optional original checkout and recipe retained by native capture and portable receiving. */
  sourceRoot?: string | null;
  sourceSelection?: string | null;
}
export interface GrantReportingFullInput extends GrantReportingValues {
  id: string;
  savedAt?: string;
  catalog: CommandCatalog;
  /** Complete native case/show response, including program, plan, records and sources. */
  case: Record<string, unknown> | string;
  /** Complete original book, retained book wrapper or Source Tables agent response; original file bytes stay retained. */
  sourceProject: Record<string, unknown> | string;
  sourceRoot?: string | null;
  sourceSelection?: string | null;
}
export interface GrantReportingOriginalFile {
  name: string;
  kind: 'case' | 'sourceProject' | 'catalog';
  /** Exact decoded UTF-8, including any original BOM and line endings. */
  text: string;
  bytes: number;
  sha256: string;
}
export interface GrantReportingPreparation {
  schema: typeof GRANT_REPORTING_PREPARATION_SCHEMA;
  id: string;
  planId: string;
  createdAt: string;
  updatedAt: string;
  /** Original clock. Legacy input uses the saved preview or original preparation creation time. */
  planCreatedAt?: string;
  values: GrantReportingValues;
  files: { case: GrantReportingOriginalFile; sourceProject: GrantReportingOriginalFile; catalog: GrantReportingOriginalFile };
  plan?: OperatingPlan | null;
}
export interface GrantReportingTableSelection {
  role: string;
  documentId: string;
  resourceId: string;
  label: string;
  filename: string;
  editionId: string;
  sha256: string;
  bytes: number;
  reviewId: string | null;
  reviewCurrent: boolean;
  mappingSha256: string;
  bindingSha256: string;
  mode: string;
  workbook?: { sourceId: string; filename: string; sha256: string; bytes: number; selectionId: string; selectionSha256: string };
}
export interface GrantReportingSelection {
  case: { id: string; name: string; version: number; mode: string; state: string; contentSha256: string };
  plan: { id: string; revision: number; contentSha256: string };
  sourceProject: {
    id: string; name: string; contentSha256: string;
    baseline: { id: string; revision: number; contentSha256: string };
    sameSelectedPlan: boolean;
    tables: GrantReportingTableSelection[];
  };
  reporting: { startDate: string | null; asOfDate: string };
  paths: GrantReportingPaths;
  browserOrigin: string;
  originalFiles?: Record<'case' | 'sourceProject' | 'catalog', Omit<GrantReportingOriginalFile, 'text'>>;
}
export interface InspectedGrantReportingFullInput {
  input: GrantReportingFullInput & { savedAt: string; sourceRoot: string | null; sourceSelection: string | null };
  selection: GrantReportingSelection;
  preview: OperatingPlan | null;
}
export function grantReportingPreparationInput(value: unknown): Promise<{
  input: GrantReportingFullInput;
  preview: OperatingPlan | null;
  retainedFiles: GrantReportingSelection['originalFiles'] | null;
}>;
export function inspectGrantReportingInput(value: unknown): Promise<InspectedGrantReportingFullInput>;
export function requireSameGrantReportingPreview(preview: OperatingPlan | null | undefined, generated: OperatingPlan): OperatingPlan;

/** Complete-input names retained by the joined source adapter. */
export type GrantReportingObject = Record<string, unknown>;
export type GrantReportingFields = GrantReportingValues;
export type GrantReportingInput = GrantReportingFullInput;
export type GrantReportingRetainedFile = GrantReportingOriginalFile;
export type InspectedGrantReportingInput = InspectedGrantReportingFullInput;
export type GrantReportingPlanSelection = GrantReportingSelection['plan'];
