import type { CommandCatalog } from './catalog.mjs';
import type { OperatingPlan } from './operating-plan.mjs';
export const GRANT_REPORTING_INPUT_SCHEMA: 'stellar-forge.grant-reporting-input.v1';
export type GrantReportingRole = 'packages' | 'milestones' | 'contributors' | 'assignments';
export const GRANT_REPORTING_ROLES: readonly GrantReportingRole[];
/** A selected original reference. Generation does not read or verify the file bytes. */
export interface GrantReportingFile {
  path: string;
  sha256?: string | null;
  bytes?: number | null;
  sourceId?: string;
  note?: string;
}
export interface GrantReportingReference {
  id: string;
  revision: number;
  note?: string;
}
export interface GrantReportingTable {
  role: GrantReportingRole;
  file: GrantReportingFile;
  /** Explicit original parsing choice; existing native roles retain their saved format. */
  delimiter: 'comma' | 'tab' | 'semicolon' | 'pipe';
  header: boolean;
  binding?: GrantReportingFile | null;
  tableMapping?: GrantReportingFile | null;
}
export interface GrantReportingInput {
  schema?: typeof GRANT_REPORTING_INPUT_SCHEMA;
  id: string;
  /** Stable original UTC ISO creation time, retained when regenerating this procedure. */
  savedAt: string;
  title: string;
  customer?: string;
  purpose?: string;
  period?: string;
  /** Used for the procedure and each initial step; at most 300 characters. */
  owner?: string;
  receiving?: string;
  /** Customer notes, at most 16,000 characters. */
  notes?: string;
  case: {
    id: string;
    version: number;
    planId: string;
    planRevision: number;
    workspace: string;
    planContentSha256?: string | null;
    sourcePlanSha256?: string | null;
  };
  archive?: GrantReportingFile | null;
  installation?: GrantReportingReference | null;
  taskOutcome?: GrantReportingReference | null;
  reporting?: {
    startDate?: string | null;
    endDate: string;
    /** Omit until the original performance report supplies its actual SHA. */
    reportSha256?: string | null;
  } | null;
  sourceTables?: {
    /** Omission prepares a native snapshot of the exact selected planning revision. */
    project?: GrantReportingFile | null;
    files?: GrantReportingTable[];
    /** Omission leaves saving as an unapproved planning decision. */
    save?: {requestId: string; note: string} | null;
  };
  outputDirectory: string;
  /** Defaults to outputDirectory/grant-reporting-plan.json. */
  procedureFile?: string;
  /** Exact explicit loopback HTTP origin, including host spelling and nonzero port. */
  browserOrigin: string;
  /** Used by the original catalog comparison CLI; installed packages normally omit it. */
  sourceRoot?: string | null;
  sourceSelection?: string | null;
}
export type InspectedGrantReportingFile = Required<GrantReportingFile>;
export interface InspectedGrantReportingInput {
  schema: typeof GRANT_REPORTING_INPUT_SCHEMA;
  id: string; savedAt: string; title: string; customer: string; purpose: string;
  period: string; owner: string; receiving: string; notes: string;
  case: Required<GrantReportingInput['case']>;
  archive: InspectedGrantReportingFile | null;
  installation: Required<GrantReportingReference> | null;
  taskOutcome: Required<GrantReportingReference> | null;
  reporting: {startDate: string | null; endDate: string; reportSha256: string | null} | null;
  sourceTables: {
    project: InspectedGrantReportingFile | null;
    files: Array<{role: GrantReportingRole; file: InspectedGrantReportingFile;
      delimiter: GrantReportingTable['delimiter']; header: boolean;
      binding: InspectedGrantReportingFile | null; tableMapping: InspectedGrantReportingFile | null}>;
    save: {requestId: string; note: string} | null;
  };
  outputDirectory: string; procedureFile: string; browserOrigin: string;
  sourceRoot: string | null; sourceSelection: string | null;
}
/** Pure validation; no file read, command execution, case write, or recorded customer result. */
export function inspectGrantReportingInput(value: unknown): InspectedGrantReportingInput;
/** Original complete OperatingPlan, with every source/runtime selection taken from the supplied original catalog. */
export function createGrantReportingPlan(options: {catalog: CommandCatalog; input: GrantReportingInput}): OperatingPlan;
