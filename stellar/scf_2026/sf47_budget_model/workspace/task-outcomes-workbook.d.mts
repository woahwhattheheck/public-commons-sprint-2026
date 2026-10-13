import type {
  GrantTaskOutcomeInputs, GrantWorkbookUpload, GrantWorkbookSource,
  GrantWorkbookProjection, GrantWorkbookInspectionInput, GrantWorkbookInspection,
  GrantWorkbookProjectionInput, GrantWorkbookSelection
} from './agent-client.mjs';

export const OUTCOMES_WORKBOOK_SCHEMA: 'stellar-forge.customer-outcomes-workbook.v1';
export const OUTCOMES_WORKBOOK_RETURN_SCHEMA: 'stellar-forge.customer-outcomes-workbook.v1.return';
export const MAX_OUTCOMES_WORKBOOK_BYTES: number;
export const OUTCOMES_WORKBOOK_SHEETS: ReadonlyArray<{name: string; headers: string[]}>;

export interface OutcomeWorkbookOptions {
  caseId: string;
  originCaseId?: string;
  planContentSha256: string;
  createdAt?: string;
  receivedAt?: string;
  unsavedFollowupIds?: string[];
}
export interface OutcomeWorkbookOrigin {
  schema: typeof OUTCOMES_WORKBOOK_SCHEMA;
  caseId: string;
  planContentSha256: string;
  inputs: GrantTaskOutcomeInputs;
  inputsSha256: string;
  unsavedFollowupIds: string[];
  createdAt: string;
}
export interface OutcomeWorkbookTable {name: string; headers: string[]; rows: string[][]}
export interface OutcomeWorkbookReturn {
  schema: typeof OUTCOMES_WORKBOOK_RETURN_SCHEMA;
  origin: OutcomeWorkbookOrigin;
  baseInputs: GrantTaskOutcomeInputs;
  returnedInputs: GrantTaskOutcomeInputs;
  unsavedFollowupIds: string[];
  tables: OutcomeWorkbookTable[];
}
export interface CompleteOutcomeWorkbookReturn extends OutcomeWorkbookReturn {
  source: GrantWorkbookSource;
  projections: Array<{sheet: string; projection: GrantWorkbookProjection}>;
  receivedAt: string;
}
export interface OutcomeWorkbookNativeOptions extends OutcomeWorkbookOptions {
  inspectWorkbook(input: GrantWorkbookInspectionInput): Promise<GrantWorkbookInspection>;
  projectWorkbook(input: GrantWorkbookProjectionInput): Promise<GrantWorkbookSelection>;
}
export type OutcomeWorkbookChoice = 'current' | 'returned';
export interface OutcomeWorkbookValue {present: boolean; value?: unknown}
export interface OutcomeWorkbookConflict {
  path: string; original: OutcomeWorkbookValue; current: OutcomeWorkbookValue;
  returned: OutcomeWorkbookValue; choice: OutcomeWorkbookChoice | null;
}
export interface OutcomeWorkbookReconciliation {
  schema: typeof OUTCOMES_WORKBOOK_RETURN_SCHEMA;
  inputs: GrantTaskOutcomeInputs;
  changes: Array<{path: string; before: OutcomeWorkbookValue; after: OutcomeWorkbookValue; resolved?: boolean}>;
  conflicts: OutcomeWorkbookConflict[];
  unresolved: number;
  currentSignature: string;
  returnedSignature: string;
  originalRevision: number;
  currentRevision: number;
  unsavedFollowupIds: string[];
}
export function outcomeWorkbookTables(inputs: GrantTaskOutcomeInputs, options: OutcomeWorkbookOptions):
  Promise<{origin: OutcomeWorkbookOrigin; tables: OutcomeWorkbookTable[]}>;
export function receiveOutcomeWorkbookTables(tables: OutcomeWorkbookTable[], options: OutcomeWorkbookOptions):
  Promise<OutcomeWorkbookReturn>;
export function reconcileOutcomeWorkbook(received: OutcomeWorkbookReturn, currentInputs: GrantTaskOutcomeInputs,
  choices?: Record<string, OutcomeWorkbookChoice>): OutcomeWorkbookReconciliation;
export function outcomeWorkbookGuide(origin: OutcomeWorkbookOrigin): string;
export function createOutcomeWorkbook(inputs: GrantTaskOutcomeInputs, options: OutcomeWorkbookOptions): Promise<{
  schema: typeof OUTCOMES_WORKBOOK_SCHEMA; origin: OutcomeWorkbookOrigin; tables: OutcomeWorkbookTable[];
  parts: Array<{path: string; content: string}>;
  workbook: {filename: string; data: Uint8Array; bytes: number; sha256: string};
  guide: string; kit: {filename: string; data: Uint8Array};
  files: Array<{path: string; content: string | Uint8Array}>;
}>;
export function receiveOutcomeWorkbook(upload: GrantWorkbookUpload | GrantWorkbookSource,
  options: OutcomeWorkbookNativeOptions): Promise<CompleteOutcomeWorkbookReturn>;
export function validateOutcomeWorkbookReturn(value: CompleteOutcomeWorkbookReturn,
  options: OutcomeWorkbookOptions): Promise<CompleteOutcomeWorkbookReturn>;
export function workbookUpload(filename: string, bytes: Uint8Array): Promise<GrantWorkbookUpload>;
export function decodeWorkbookBytes(value: string): Uint8Array;
