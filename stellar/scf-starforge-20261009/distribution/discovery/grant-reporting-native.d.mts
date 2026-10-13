import type { CommandCatalog } from './catalog.mjs';
import type { OperatingPlan } from './operating-plan.mjs';
import type { GrantReportingValues, GrantReportingPreparation, GrantReportingSelection } from './grant-reporting-input.mjs';
import type { GrantResponseSource } from '../../../scf_2026/sf47_budget_model/workspace/agent-client.mjs';
import type { GrantProcedure, ProcedureVerification, ProcedureStepLinks } from '../../../scf_2026/sf47_budget_model/workspace/grant_procedures.mjs';

export const GRANT_REPORTING_CAPTURE_SCHEMA: 'stellar-forge.grant-reporting-capture.v1';
export class GrantReportingCaptureError extends Error {
  code: string;
  details: Record<string, unknown>;
  constructor(code: string, message: string, details?: Record<string, unknown>);
}
export interface GrantReportingCaptureBinding {
  directory: string;
  scenarioFile?: string;
  pythonExecutable?: string;
  /** Explicit original-client startup selection. Omission borrows the existing service. */
  allowStart?: boolean;
  label?: string;
}
export interface GrantReportingCaptureFields extends Omit<GrantReportingValues, 'paths'> {
  id: string;
  savedAt?: string;
  receivingWorkspace: string;
  commandFinderUrl: string;
}
export type GrantReportingCaptureTable =
  | {key:string; origin:'case-plan'}
  | {key:string; origin:'case-source'; sourceId:string}
  | {key:string; origin:'local-original'; file:string}
  | {key:string; origin:'preceding-procedure'};
/** The existing grant-procedures prepare selection; original local files are read in full. */
export interface GrantReportingCaptureProcedureSelection {
  actor: string;
  note?: string;
  selectedRevision?: number;
  parentSourceId?: string | null;
  sourceIds?: string[];
  tables?: GrantReportingCaptureTable[];
  editions?: {kind:'installation' | 'task-outcome'; id:string; revision:number}[];
  stepLinks?: ProcedureStepLinks[];
}
export type GrantReportingCaptureInput = {
  binding: GrantReportingCaptureBinding;
  caseId: string;
  expectedVersion?: number;
  sourceProjectFile: string;
  /** A new directory under an existing ordinary parent. */
  directory: string;
  fields: GrantReportingCaptureFields;
  procedureSelection?: GrantReportingCaptureProcedureSelection;
  sourceRoot?: string | null;
  sourceSelection?: string | null;
} & (
  | {catalog:CommandCatalog; catalogFile?:never}
  | {catalog?:never; catalogFile:string}
);
export interface GrantReportingCaptureMember {
  name:'reporting-preparation.json' | 'grant-reporting-plan.json' |
    'grant-reporting-plan.html' | 'grant-reporting-plan.md' | 'grant-procedure.json';
  bytes:number;
  sha256:string;
}
export interface GrantReportingCaptureReceipt {
  schema:typeof GRANT_REPORTING_CAPTURE_SCHEMA;
  capturedAt:string;
  /** Original publication location; a moved capture retains its original command paths. */
  directory:string;
  preparationId:string;
  planId:string;
  planCreatedAt:string;
  selection:GrantReportingSelection;
  files:GrantReportingCaptureMember[];
  catalogOrigin:({kind:'file';path:string} | {kind:'selected-toolkit'}) &
    {sourceRoot?:string;sourceSelection?:string};
  native:{
    selectionSha256:string;
    source:GrantResponseSource;
    before:{bytes:number;sha256:string};
    after:{bytes:number;sha256:string};
    opened:Record<string,unknown>;
    closed:{
      schema:string;
      state:'BORROWED_CONNECTION_RELEASED' | 'OWNED_ORIGINAL_SERVICE_CLOSED';
      originalInstanceId:string | null;
      result?:Record<string,unknown>;
    };
  };
  procedure:null | {
    editionId:string;
    caseId:string;
    caseVersion:number;
    selectedRevision:number;
    verification:ProcedureVerification;
  };
}
export interface GrantReportingCaptureResult {
  directory:string;
  receipt:GrantReportingCaptureReceipt;
  preparation:GrantReportingPreparation;
  plan:OperatingPlan;
  procedure?:GrantProcedure;
}
/** Capture and check the original case and source file, close the original connection, then publish all members. */
export function captureGrantReportingPlan(input:GrantReportingCaptureInput):Promise<GrantReportingCaptureResult>;
/** Read complete retained members and regenerate the same canonical plan without opening a native case. */
export function readGrantReportingCapture(directory:string):Promise<GrantReportingCaptureResult>;
