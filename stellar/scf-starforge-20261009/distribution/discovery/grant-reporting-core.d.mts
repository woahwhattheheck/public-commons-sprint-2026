import type { OperatingPlan } from './operating-plan.mjs';
import type { GrantReportingFullInput, GrantReportingPreparation, GrantReportingSelection } from './grant-reporting-input.mjs';

/** Validates full original native inputs and creates only planned operating work. */
export function prepareGrantReportingPlan(input: GrantReportingFullInput | GrantReportingPreparation): Promise<{
  plan: OperatingPlan;
  selection: GrantReportingSelection;
  /** The retained command path, outputDirectory/grant-reporting-plan.json. */
  procedureFile: string;
}>;
/** Same complete original OperatingPlan used by the browser and command-line creator. */
export function createGrantReportingPlan(input: GrantReportingFullInput | GrantReportingPreparation): Promise<OperatingPlan>;

/** Exact original output filename shared by browser and CLI. */
export function grantReportingProcedureFile(outputDirectory: string): string;
export { GRANT_REPORTING_PREPARATION_SCHEMA, GrantReportingInputError,
  grantReportingPreparationInput, inspectGrantReportingInput, requireSameGrantReportingPreview } from './grant-reporting-input.mjs';
