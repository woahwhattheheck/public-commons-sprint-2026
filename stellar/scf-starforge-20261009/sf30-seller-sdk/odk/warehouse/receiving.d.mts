// MIT. Complete original approved-period receiving interfaces.
import type {
  CentralPeriod, CentralWarehouseProfileInput, CentralWarehousePublicProfile,
  CentralWarehouseSqlMapping, CentralWarehouseFileReceipt, RestoreCentralResult,
  CentralCommissioningDataset, CentralCommissioningCaptureSelection
} from '../index.mjs';

export const RECEIVING_SCHEMA:'stellar-forge.central-approved-period-receiving.v1';
export const NATIVE_SELECTION_SCHEMA:'stellar-forge.central-native-warehouse-selection.v1';

export type CentralNativeWarehouseDatasetSelection=CentralCommissioningDataset;
export interface CentralNativeWarehouseSelection extends Record<string,unknown> {
  schema:typeof NATIVE_SELECTION_SCHEMA;
  operationId:string;sourceWorkspace:string;workspaceId:string;commissionId:string;deliveryId:string;
  captures:CentralCommissioningCaptureSelection[];
  datasets:CentralNativeWarehouseDatasetSelection[];
  periods:Array<{period:CentralPeriod;label:string}>;
  requestIds:{approvals:string[];reviews:string[];imports:string[];report:string};
}
export interface CentralApprovedPeriodTableExpectation {
  projectId:string;formId:string;table:string;previousRows:number;currentRows:number;
}
export interface CentralApprovedPeriodReceivingBase {
  schema:typeof RECEIVING_SCHEMA;
  operationId:string;workspaceId:string;deliveryId:string;profileId:string;
  reviewer:string;note:string;
  mappingPolicy:'native-inspected-scalars-with-original-keys';
  expectedTables?:CentralApprovedPeriodTableExpectation[];
}
/** The native selection binds its original definition; a general request supplies the full digest. */
export type CentralApprovedPeriodReceivingSpecification=CentralApprovedPeriodReceivingBase&(
  {nativeSelection:CentralNativeWarehouseSelection;commissioningDefinitionSha256?:string}|
  {nativeSelection?:undefined;commissioningDefinitionSha256:string}
);
export interface CentralApprovedPeriodFile extends CentralWarehouseFileReceipt {
  path:string;status?:number;
}
export interface CentralApprovedPeriodDataset {
  period:CentralPeriod;identity:{projectId:string;formId:string;table:string};
  approvalId:string;inspectionId:string;reviewId:string;importId:string;versionId:string;
  rowCount:number;approvalSha256:string;captureId:string;exportId:string;
  mapping:CentralWarehouseSqlMapping;originalKeys:string[];repeatParent:string|null;
}
export interface CentralApprovedPeriodReport {
  id:string;identity:CentralApprovedPeriodDataset['identity'];
  previousVersion:string;currentVersion:string;
  result:Record<string,unknown>;file:CentralApprovedPeriodFile;
}
export interface CentralApprovedPeriodReceivingResult {
  schema:typeof RECEIVING_SCHEMA;
  operationId:string;requestSha256:string;workspaceId:string;deliveryId:string;
  commissioningDefinitionSha256:string;originalDirectory:string;restoredDirectory:string;
  warehouse:CentralWarehousePublicProfile;
  datasets:CentralApprovedPeriodDataset[];reports:CentralApprovedPeriodReport[];
  received:Array<{approvalId:string;inspectionId:string;rows:number;versionId:string}>;
  archive:CentralApprovedPeriodFile&{id:string;nativePath:string};
  restored:RestoreCentralResult;files:CentralApprovedPeriodFile[];
  listenersClosed:true;completedAt:string;
}
export interface CentralApprovedPeriodReceivingStage extends Record<string,unknown> {
  stage:string;operationId:string;
}
export interface CentralApprovedPeriodReceivingOptions {
  specification:CentralApprovedPeriodReceivingSpecification;
  directory:string;profiles:CentralWarehouseProfileInput[];
  outputDirectory:string;restoreDirectory:string;
  onStage?:(observation:CentralApprovedPeriodReceivingStage)=>void|Promise<void>;
}
/** Retain every native dataset/receipt and its existing 32-hex operation IDs. */
export function nativeReceivingSelection(
  input:CentralNativeWarehouseSelection,
  options:{profileId:string;reviewer:string;note:string}
):CentralApprovedPeriodReceivingBase&{
  nativeSelection:CentralNativeWarehouseSelection;expectedTables:CentralApprovedPeriodTableExpectation[];
};
/** Own the original listener, complete SQL receiving, full archive restore and final close. */
export function receiveApprovedCentralPeriods(
  options:CentralApprovedPeriodReceivingOptions
):Promise<CentralApprovedPeriodReceivingResult>;
/** Run the original saved-request CLI and retain its interruption handlers. */
export function main(argv?:string[]):Promise<void>;
