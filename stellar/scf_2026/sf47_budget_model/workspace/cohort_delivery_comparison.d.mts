export type JsonValue = null | boolean | number | string | JsonValue[] | {[key:string]:JsonValue};
export type JsonObject = {[key:string]:JsonValue};
export type IdentityKind = 'buyer' | 'merchant' | 'operation' | 'facilitator';
export interface DeliveryIdentityLink { kind:IdentityKind; plannedId:string; observedId:string; note:string }
export interface DeliveryIntentAssignment { intentId:string; targetId:string; note:string }
export interface DeliveryRecording { editionId:string; createdAt:string; actor:string; planSourceId:string }
export interface CohortDeliveryInput {
  schema:'stellar-forge.sf47-cohort-delivery-input.v1';planDocument:JsonObject;review:JsonObject;
  links:DeliveryIdentityLink[];assignments:DeliveryIntentAssignment[];title:string;note:string;recording:DeliveryRecording;commercial?:CohortCommercialChoices;
}
export interface DeliveryJoin {
  kind:IdentityKind;plannedId:string;plannedLabel:string;observedId:string|null;observedLabel:string|null;
  basis:'ORIGINAL_IDENTITY'|'OPERATOR_ASSOCIATION'|'UNMATCHED';note:string;
  plannedOperatorId:string|null;observedOperatorId:string|null;sourceIds:string[];
}
export interface DeliveryRecord {
  id:string;intentId:string|null;purchaseIds:string[];buyerOperatorId:string|null;
  buyerDeploymentId:string|null;operationId:string|null;merchantDeploymentId:string|null;facilitatorId:string|null;
  network:string;asset:string|null;firstAttemptAt:string|null;firstAttemptDate:string|null;
  currentCompletedAt:string|null;completionDate:string|null;targetId:string|null;
  placement:'OPERATOR_ASSIGNMENT'|'ORIGINAL_IDENTITIES_AND_UTC_DATE'|'AMBIGUOUS_DATE'|'DATE_UNMATCHED'|'IDENTITY_UNMATCHED';
  candidateGroupId:string|null;assignmentNote:string;attempted:boolean;settled:boolean;inWindow:boolean;unplaced:boolean;
  completeInWindow:boolean;independentCompleteInWindow:boolean;grossCompleteInWindow:boolean;laterCompletion:boolean;
  refundedAfterSettlement:boolean;cancelledAfterSettlement:boolean;teamOperated:boolean;lateAfterPlan:boolean;
  latenessSeconds:string|null;sourceIssues:string[];sourceIds:string[];
}
export interface DeliveryOpportunity {
  id:string;kind:'OCCURRENCE'|'FUNDING_GROUP';sourceId:string;label:string;scheduleId:string|null;
  operationId:string;buyerId:string;merchantId:string;facilitatorId:string|null;date:string;scheduledAt:string;
  plannedCompleteAt:string|null;paymentKind:string;network:string;asset:string;
  plannedPaymentRequests:number;plannedPaidPurchases:number;plannedCompletePurchases:number;independentPurchaseOpportunities:number;
  plannedUsefulTasks:number;atomicAmount:string|null;sourceOccurrenceIds:string[];
  observedOperationId:string|null;observedBuyerId:string|null;observedMerchantId:string|null;observedFacilitatorId:string|null;
  dueAtCutoff:boolean;intentIds:string[];observedIntents:number;observedAttempted:number;observedComplete:number;
  observedIndependentComplete:number;grossComplete:number;refunded:number;cancelledAfterSettlement:number;lateAfterPlan:number;
  completionDelta:number;remainingDue:number;additionalIntents:number;state:string;note:string;
}
export interface DeliveryDay {date:string;plannedPaymentRequests:number;plannedCompletePurchases:number;plannedUsefulTasks:number;
  observedIntents:number;completedFromAttempts:number;completedOnDate:number;independentCompletedOnDate:number;lateAfterPlan:number;unmatchedIntents:number}
export interface DeliveryOperator {operatorId:string|null;labels:string[];plannedBuyerIds:string[];observedBuyerIds:string[];
  plannedPaidPurchases:number;plannedIndependentOpportunities:number;observedIntents:number;observedComplete:number;observedIndependentComplete:number;unmatchedIntents:number}
export interface DeliveryTarget {key:string;plannedRequirement:number|null;observedRequirement:number|null;planned:number|null;observed:number|null;observedMet:boolean|null;delta:number|null;planningStatus:string|null}
export interface DeliveryFinding {code:string;message:string;id?:string;kind?:string;blocking?:boolean}
export interface DeliverySource {programId:string;plan:JsonObject;reviewId:string;reviewVersion:number;measurementSha256:string;previewSha256:string;observed:JsonObject;plannedWindow:JsonObject;observedWindow:JsonObject;nativeMode:string}
export interface CohortDeliveryComparison {
  schema:'stellar-forge.sf47-cohort-delivery-comparison.v1';engineVersion:1;title:string;input:CohortDeliveryInput;
  summary:{[key:string]:number|boolean};source:DeliverySource;planReport:JsonObject;joins:DeliveryJoin[];rows:DeliveryOpportunity[];
  records:DeliveryRecord[];unmatched:DeliveryRecord[];candidateGroups:Array<{id:string;targetIds:string[]}>;days:DeliveryDay[];operators:DeliveryOperator[];targets:DeliveryTarget[];
  commercial?:CohortCommercialReport;issues:DeliveryFinding[];nativeMetrics:JsonObject;nativeIssues:DeliveryFinding[];amounts:JsonObject[];outcomes:JsonObject[];products:JsonObject[];
}
export const COHORT_DELIVERY_INPUT_SCHEMA:'stellar-forge.sf47-cohort-delivery-input.v1';
export const COHORT_DELIVERY_COMPARISON_SCHEMA:'stellar-forge.sf47-cohort-delivery-comparison.v1';
export class CohortDeliveryError extends Error {code:string;path:string;constructor(code:string,message:string,path?:string)}
export function seedCohortDeliveryComparison(planDocument:unknown,review:unknown,options?:Partial<DeliveryRecording>&{title?:string;note?:string}):CohortDeliveryInput;
export function compareCohortDelivery(input:CohortDeliveryInput):CohortDeliveryComparison;
export function reopenCohortDeliveryComparison(document:unknown):CohortDeliveryComparison;
export function exportCohortDeliveryCsv(document:CohortDeliveryComparison):string;
export function exportCohortDeliveryHtml(document:CohortDeliveryComparison):string;

export const COHORT_COMMERCIAL_SCHEMA:'stellar-forge.sf47-cohort-commercial.v1';
export interface CohortCommercialValuation {network:string;asset:string;atomicDecimals:number;unitValue:string;asOfAt:string;sourceReference:string}
export interface CohortCommercialCost {id:string;label:string;serviceId:string;costType:'SUPPLIER'|'LABOR'|'PAYMENT_FEE'|'OTHER';amount:string|null;activeHours:string|null;hourlyCost:string|null;occurredAt:string;sourceReference:string}
export interface CohortCommercialAdjustment {id:string;label:string;kind:'REFUND'|'OTHER_REVENUE';amount:string;occurredAt:string;sourceReference:string;refundCashId:string;intentIds:string[]}
export interface CohortCommercialAllocation {network:string;transactionHash:string;parts:Array<{targetId:string;amountAtomic:string}>;note:string}
export interface CohortCommercialChoices {
  schema:typeof COHORT_COMMERCIAL_SCHEMA;currency:string;
  transactionScope:'SETTLED_IN_WINDOW'|'FIRST_ATTEMPT_IN_WINDOW';feeTreatment:'SEPARATE'|'INCLUDE_AS_COST';
  costCoverage:'PARTIAL'|'COMPLETE';coverageNote:string;valuations:CohortCommercialValuation[];costs:CohortCommercialCost[];
  adjustments:CohortCommercialAdjustment[];transactionAllocations:CohortCommercialAllocation[];note:string;originalCosts?:CohortOriginalCostSelection;
}
export interface CohortCommercialReport {
  schema:'stellar-forge.sf47-cohort-commercial-report.v1';currency:string;
  transactionScope:CohortCommercialChoices['transactionScope'];feeTreatment:CohortCommercialChoices['feeTreatment'];
  window:JsonObject;choices:CohortCommercialChoices;planned:JsonObject|null;plannedCurrencies:JsonObject[];
  actual:{grossSettlementValue:string|null;refunds:string;otherRevenue:string;adjustedRevenue:string|null;networkFeeValue:string|null;recordedCost:string|null;totalCost:string|null;contribution:string|null};
  differences:{revenue:string|null;totalCost:string|null;contribution:string|null};
  knownSubtotals:{grossSettlementValue:string;networkFeeValue:string;recordedCost:string;totalCost:string};
  coverage:{costCoverage:'PARTIAL'|'COMPLETE';costCoverageNote:string;unvaluedTransactions:number;unvaluedFeeTransactions:number;unresolvedCosts:number;unreviewedRefundCashIds:string[];unreviewedRefundIntentIds:string[];unallocatedTransactionIds:string[]};
  assets:JsonObject[];opportunities:JsonObject[];transactions:JsonObject[];costs:Array<CohortCommercialCost & {calculatedAmount:string|null;service:JsonObject|null}>;
  adjustments:Array<CohortCommercialAdjustment & {originalRefund:JsonObject|null}>;originalRefundCash:JsonObject[];services:JsonObject[];issues:DeliveryFinding[];note:string;originalCostIntake?:CohortOriginalCostReport;
}
export function seedCohortCommercialChoices(document:CohortDeliveryInput|CohortDeliveryComparison,options?:{currency?:string}):CohortCommercialChoices;

export const COHORT_ORIGINAL_COSTS_SCHEMA:'stellar-forge.sf47-cohort-original-costs.v1';
export interface CohortOriginalCostSource {
  record:JsonObject;contributor:JsonObject|null;linkedWork:JsonObject[];attachments:JsonObject[];
}
export interface CohortOriginalCostRow {
  sourceKey:string;kind:'WORK'|'INVOICE_LINE';recordId:string;lineId:string;label:string;
  contributorId:string;contributorName:string;state:string;costId:string;fundingBasis:string;
  unit:'HOURS'|'USD';quantity:string;periodStart:string;periodEnd:string;workIds:string[];source:CohortOriginalCostSource;
}
export interface CohortOriginalCostPortion {
  id:string;sourceKey:string;serviceId:string;quantity:string;unitCost:string|null;
  valuationAt:string;valuationSource:string;periodStart:string;periodEnd:string;allocationNote:string;source:CohortOriginalCostSource;
}
export interface CohortOriginalCostOverlapReview {workId:string;invoiceId:string;lineId:string;note:string}
export interface CohortOriginalCostSelection {
  schema:typeof COHORT_ORIGINAL_COSTS_SCHEMA;selections:CohortOriginalCostPortion[];
  overlapReviews:CohortOriginalCostOverlapReview[];note:string;
}
/** Existing IDs retain their whole source witness unless explicitly included in acceptSourceIds. */
export interface CohortOriginalCostReceive {
  selections:Array<Omit<CohortOriginalCostPortion,'source'> & {source?:CohortOriginalCostSource}>;
  overlapReviews?:CohortOriginalCostOverlapReview[];note?:string;acceptSourceIds?:string[];
}
export interface CohortOriginalCostCatalog {
  schema:'stellar-forge.sf47-cohort-original-cost-catalog.v1';reviewId:string;businessSha256:string;
  programId:string;window:JsonObject;rows:CohortOriginalCostRow[];note:string;
}
export interface CohortOriginalCostInspection extends CohortOriginalCostCatalog {
  selection:CohortOriginalCostSelection;
  sourceReviews:Array<{selectionId:string;sourceKey:string;status:'UNCHANGED'|'CHANGED'|'MISSING';retainedSource:CohortOriginalCostSource;currentSource:CohortOriginalCostSource|null}>;
}
export interface CohortOriginalCostCalculated extends CohortCommercialCost {
  calculatedAmount:string|null;service:JsonObject|null;periodStart:string;periodEnd:string;
  dateBasis:'ENTERED_PORTION_OF_ORIGINAL_WORK_INTERVAL'|'ORIGINAL_INVOICE_ISSUE_DATE';
  originalCost:{selectionId:string;sourceKey:string;kind:'WORK'|'INVOICE_LINE';recordId:string;lineId:string;
    unit:'HOURS'|'USD';quantity:string;unitCost:string|null;valuationAt:string;valuationSource:string;state:string;
    contributorId:string;contributorName:string;workIds:string[];source:CohortOriginalCostSource};
}
export interface CohortOriginalCostOverlap extends CohortOriginalCostOverlapReview {
  workSelectionIds:string[];invoiceSelectionIds:string[];reviewedDistinctCosts:boolean;
}
export interface CohortOriginalCostReport extends CohortOriginalCostCatalog {
  rows:Array<CohortOriginalCostRow & {selectedQuantity:string;unselectedQuantity:string}>;
  costs:CohortOriginalCostCalculated[];overlaps:CohortOriginalCostOverlap[];
  unusedOverlapReviews:CohortOriginalCostOverlapReview[];unreviewedOverlaps:CohortOriginalCostOverlap[];selection:CohortOriginalCostSelection;
}
export function inspectCohortOriginalCosts(document:CohortDeliveryInput|CohortDeliveryComparison):CohortOriginalCostInspection;
/** Returns the full editable successor; compareCohortDelivery reports any remaining source/quantity/date constraint. */
export function selectCohortOriginalCosts(document:CohortDeliveryInput|CohortDeliveryComparison,selection:CohortOriginalCostReceive):CohortDeliveryInput;
export function receiveCohortOriginalCosts(document:CohortDeliveryInput|CohortDeliveryComparison,selection:CohortOriginalCostReceive):CohortDeliveryComparison;

/** Full original actual-cost basis applied only to explicitly selected future schedules. */
export const COHORT_RECORDED_COST_PLAN_SCHEMA:'stellar-forge.sf47-cohort-recorded-cost-plan.v1';
export interface CohortRecordedCostAllocation {
  id:string;targetScheduleId:string;sourceServiceId:string;
  outputQuantity:string;outputUnit:string;outputSource:string;
  measurement?:CohortTaskMeasurementSelection;
  measurementHistory?:Array<{measurement:CohortTaskMeasurementSelection;outputQuantity:string;outputUnit:string;outputSource:string}>;
  supplierCoverage:'PARTIAL'|'COMPLETE';laborCoverage:'PARTIAL'|'COMPLETE';coverageNote:string;
  costs:Array<{costId:string;share:string}>;
}
/** New calculations count completed useful tasks; absent only in retained historical documents. */
export interface CohortRecordedCostChoices {name:string;note:string;quantityBasis?:'COMPLETED_TASKS';allocations:CohortRecordedCostAllocation[];}
export interface CohortRecordedCostPlan {
  schema:typeof COHORT_RECORDED_COST_PLAN_SCHEMA;
  sourceDocument:CohortDeliveryComparison;
  planDocument:import('./cohort_planning.mjs').CohortPlanDocument;
  choices:CohortRecordedCostChoices;
  candidate:import('./cohort_planning.mjs').CohortPlan;
  report:import('./cohort_planning.mjs').CohortPlanReport;
  comparison:import('./cohort_planning.mjs').CohortPlanComparison;
  derivations:Array<{
    id:string;targetScheduleId:string;sourceServiceId:string;outputQuantity:string;outputUnit:string;outputSource:string;
    measurement?:CohortTaskMeasurementObservation & {comparisonId:string;revision:number;sourceId:string;sourceSha256:string;customer:string;task:string;serviceBasis:string;originCaseId?:string;selectedCaseId?:string};
    quantityBasis?:{kind:'COMPLETED_TASKS';completedTasks:string;requestsPerTask:number;correspondingRequests:string;supplierCostPerTask:string|null;interpretation:string};
    sourceService:Record<string,unknown>;originalEconomics:Record<string,unknown>|null;
    derivedEconomics:{unitCost:string|null;activeHoursPerTask:string|null;hourlyCost:string|null};
    supplierCoverage:'PARTIAL'|'COMPLETE';laborCoverage:'PARTIAL'|'COMPLETE';coverageNote:string;
    knownSupplierCost:string;knownLaborCost:string;knownActiveHours:string;
    supplierComplete:boolean;laborComplete:boolean;hoursComplete:boolean;
    contributions:Array<{costId:string;costType:string;share:string;amount:string|null;activeHours:string|null;originalCost:Record<string,unknown>}>;
    rounding:string;
  }>;
  costBalances:Array<{costId:string;costType:string;serviceId:string;selectedShare:string;unselectedShare:string}>;
}
export function seedCohortRecordedCostPlan(recordedDocument:CohortDeliveryInput|CohortDeliveryComparison,planDocument:import('./cohort_planning.mjs').CohortPlanDocument):CohortRecordedCostChoices;
export function planCohortFromRecordedCosts(recordedDocument:CohortDeliveryInput|CohortDeliveryComparison,planDocument:import('./cohort_planning.mjs').CohortPlanDocument,choices:CohortRecordedCostChoices):CohortRecordedCostPlan;
export function reopenCohortRecordedCostPlan(document:CohortRecordedCostPlan):CohortRecordedCostPlan;
export function exportCohortRecordedCostPlanCsv(document:CohortRecordedCostPlan):string;

/** Complete native Task Outcomes source, selected without changing its original writer. */
export const COHORT_TASK_MEASUREMENT_SCHEMA:'stellar-forge.sf47-cohort-task-measurement.v1';
export interface CohortTaskMeasurementOriginal {
  source:Record<string,unknown>&{id:string;sha256:string;bytes:number;mediaType:string;customerTaskOutcomes:Record<string,unknown>};
  edition:Record<string,unknown>&{schema:'stellar-forge.sf47-customer-task-outcomes.v1';id:string;revision:number;document:Record<string,unknown>;source:Record<string,unknown>};
  history?:Record<string,unknown>[];
}
export interface CohortTaskMeasurementObservation {
  kind:'INSTALLED'|'FOLLOWUP';observationId:string;label:string;quantity:string|null;unit:string;
  basis:'OBSERVED'|'ESTIMATED'|'MIXED'|'UNRECORDED';observedAt:string|null;status:'DRAFT'|'REVIEWED';
  comparison:Record<string,unknown>;acceptance:Record<string,unknown>|null;conclusion:string;
  method:Record<string,unknown>;deploymentIds:string[];purchaseIds:string[];usable:boolean;unavailable:string[];
}
export interface CohortTaskMeasurementSelection {
  schema:typeof COHORT_TASK_MEASUREMENT_SCHEMA;original:CohortTaskMeasurementOriginal;
  kind:'INSTALLED'|'FOLLOWUP';observationId:string;serviceBasis:string;caseId?:string;
}
export interface CohortTaskMeasurementCatalog {
  schema:'stellar-forge.sf47-cohort-task-measurement.v1.catalog';original:CohortTaskMeasurementOriginal;
  caseId:string;comparisonId:string;revision:number;sourceId:string;sourceSha256:string;
  title:string;customer:string;task:string;unit:string;installation:Record<string,unknown>|null;
  observations:CohortTaskMeasurementObservation[];
}
export function inspectCohortTaskMeasurements(original:CohortTaskMeasurementOriginal|{value:CohortTaskMeasurementOriginal}):CohortTaskMeasurementCatalog;
export function bindCohortRecordedCostMeasurement(allocation:CohortRecordedCostAllocation|Record<string,unknown>,original:CohortTaskMeasurementOriginal,
  selection:{kind:'INSTALLED'|'FOLLOWUP';observationId?:string;serviceBasis:string;caseId?:string}):CohortRecordedCostAllocation;
