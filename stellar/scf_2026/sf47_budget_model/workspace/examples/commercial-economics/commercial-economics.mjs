import { selectCohortPlanningRule, seedCohortPlan, evaluateCohortPlan, exportCohortPlanCsv } from "../../cohort_planning.mjs";

const copy = value => JSON.parse(JSON.stringify(value));
function need(ok, message) { if (!ok) throw new Error(message); }
function count(value, name, min = 0, max = 1000) {
  need(Number.isSafeInteger(value) && value >= min && value <= max, name + " must be an integer in " + min + ".." + max);
  return value;
}
function fraction(numerator, denominator) {
  need(Number.isSafeInteger(numerator) && Number.isSafeInteger(denominator) && denominator > 0, "Invalid exact coefficient");
  let a = Math.abs(numerator), b = denominator;
  while (b) { const r = a % b; a = b; b = r; }
  return { numerator: numerator / (a || 1), denominator: denominator / (a || 1) };
}
function isoDay(value) {
  need(/^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value + "T00:00:00Z").toISOString().slice(0,10) === value, "Invalid date");
  return value;
}
function dayAfter(value, days) { return new Date(Date.parse(isoDay(value) + "T00:00:00Z") + days * 86400000).toISOString().slice(0,10); }
function nullableMoney(value, label) {
  need(value === null || typeof value === "string" && /^(0|[1-9]\d*)(\.\d{1,12})?$/.test(value), label + " requires a nonnegative decimal string or null");
  return value;
}
export function runCommercialEconomics(input, candidate, candidateSha256) {
  need(input?.schema === "stellar-forge.sf47-commercial-economics-input.v1", "Wrong commercial input schema");
  need(/^[0-9a-f]{64}$/.test(candidateSha256), "Retain the complete original scenario SHA-256");
  const rule = selectCohortPlanningRule(candidate.deployment_acceptance_plan, 3);
  const days = rule.target.proposed_window.consecutive_calendar_days;
  const billingDays = count(input.billingPeriodDays, "billingPeriodDays", days, 366);
  const date = isoDay(input.windowStart);
  const asOfDate = isoDay(input.asOfDate);
  need(date > asOfDate, "Use an explicitly future planning window");
  const originalRequests = count(input.requestsPerOutput, "requestsPerOutput", 1, 100);
  const supportCents = count(input.monthlyPurchasedCareCents, "monthlyPurchasedCareCents", 0, 10000000);
  need(input.outputCountsPerDay.length > 0 && input.outputCountsPerDay.length <= 6, "Select 1..6 output-volume cases");
  const seed = { source: { programId: "source-sf10-current-candidate", version: 1, planContentSha256: candidateSha256 },
    rule, inventory: { deployments: [] }, inputs: { asOfAt: asOfDate + "T12:00:00Z", windowStart: date } };
  const base = seedCohortPlan(seed, { draftId: input.id, name: input.name });
  base.calendar.weekdays = [1,2,3,4,5,6,7];
  base.note = "Explicit planning inputs only. No assigned independent operator, agreed API tariff, native payment, customer demand observation or awarded grant. The original tranche rule is unchanged. Rebind with the receiving case's cohort-seed before saving a case plan.";
  base.sensitivity = { minimumMarginPct: null, effortIncreasesPct: ["0","20","25"], completionSharesPct: ["100","90","75"] };
  const workshareInput = { ...copy(base), workshares: copy(input.workshares) };
  const workshareReport = evaluateCohortPlan(workshareInput);
  const cases = [];
  for (const perDayValue of input.outputCountsPerDay) {
    const perDay = count(perDayValue, "outputsPerDay", 1, 10), outputs = perDay * days;
    for (const stress of input.stressCases) {
      const extra = count(stress.extraRequestsPerOutput, "extraRequestsPerOutput", 0, 100);
      const refundEvery = count(stress.refundEveryOutputs, "refundEveryOutputs", 0, 1000);
      // This is an explicit integer workload assumption, not a sampled failure rate.
      const refundedOutputs = refundEvery ? Math.floor(outputs / refundEvery) : 0;
      for (const mode of ["COMPLETE_OUTPUT", "ORIGINAL_REQUEST"]) {
        const plan = copy(base), caseId = perDay + "-per-day-" + stress.id + "-" + mode.toLowerCase();
        plan.draftId = input.id + ":" + caseId;
        plan.name = input.name + " / " + caseId;
        const participant = { operatorId: "", participantClass: "UNKNOWN", environment: "UNKNOWN", deploymentId: null, sourceIds: [], sourceNote: "Unassigned planning role; no customer acceptance or independence asserted." };
        plan.buyers = [{ ...participant, id:"buyer-unassigned", label:"Unassigned future buyer" }];
        plan.merchants = [{ ...participant, id:"merchant-unassigned", label:"Unassigned future merchant" }];
        plan.operations = [{ id:"complete-output", label:"One complete customer-selected output", merchantId:"merchant-unassigned",
          scope: input.outputScope, expectedOutput: input.expectedOutput, sourcePeriod: input.sourcePeriod,
          sourceIds: [], sourceNote:"Scope is an editable planning specification; the buyer and useful recurring requirement remain to be selected." }];
        plan.schedules = []; plan.fundingGroups = []; plan.workshares = [];
        const groupsPerOutput = mode === "COMPLETE_OUTPUT" ? 1 : originalRequests;
        for (let n = 0; n < outputs; n++) {
          const day = dayAfter(date, Math.floor(n / perDay)), ids = [];
          for (let g = 0; g < groupsPerOutput; g++) {
            const id = "funding-" + n + "-" + g; ids.push(id);
            plan.fundingGroups.push({ id, label:"Original planned charge " + n + "/" + g, kind:"DIRECT", date:day,
              buyerId:"buyer-unassigned", operationId:"complete-output", facilitatorId:null,
              atomicUnitPrice:null, network:"", asset:"",
              economics:{ currency:"USD", unitRevenue:null, feePerPayment:nullableMoney(input.costs.paymentFeePerOriginalChargeUsd, "payment fee") },
              origin:null, sourceIds:[], sourceNote:"No agreed asset, native price or USD tariff. Refund sensitivity retains this original charge and is reported separately." });
          }
          plan.schedules.push({ id:"output-" + n, label:"Complete output " + (n+1), operationId:"complete-output", buyerId:"buyer-unassigned",
            facilitatorId:null, cadence:{kind:"EXPLICIT_DATES",dates:[day]}, tasksPerDate:1,
            requestsPerTask:originalRequests + extra, timeUtc:"12:00", deliveryDelayMinutes:0, excludedDates:[],
            payment:{kind:"FUNDED",atomicUnitPrice:null,network:"",asset:""}, fundingGroupIds:ids,
            economics:{currency:"USD",unitRevenue:null,unitCost:nullableMoney(input.costs.providerAndNetworkCostPerAttemptUsd, "attempt cost"),
              feePerPayment:"0",activeHoursPerTask:nullableMoney(input.costs.activeHoursPerOutput, "active hours"),
              hourlyCost:nullableMoney(input.costs.actualCashLaborRateUsd, "cash labor rate")},
            note:extra + " extra underlying requests per output are retries without new charges. Original request charges remain " + groupsPerOutput + "; output count stays one." });
        }
        const report = evaluateCohortPlan(plan), requests = outputs * (originalRequests + extra);
        const originalCharges = outputs * groupsPerOutput, refundedCharges = refundedOutputs * groupsPerOutput;
        const retainedChargeEquivalent = originalCharges - refundedCharges;
        need(report.summary.scheduledTasks === outputs && report.summary.scheduledRequests === requests
          && report.summary.plannedPaymentRequests === originalCharges, "Original engine did not retain the intended task/request/charge relationship");
        need(report.summary.plannedPaidPurchases === 0 && report.summary.independentPurchaseOpportunities === 0, "Unpriced unassigned study must not claim paid adoption");
        const denominators = retainedChargeEquivalent || 1;
        const coefficients = retainedChargeEquivalent ? {
          monthlyFixedUsd: fraction(days, billingDays * denominators),
          providerAndNetworkUsdPerAttempt: fraction(requests, denominators),
          paymentFeeUsdPerOriginalCharge: fraction(originalCharges, denominators),
          refundHandlingUsdPerRefundedCharge: fraction(refundedCharges, denominators),
          cashLaborUsdPerOutput: fraction(outputs, denominators),
          knownPurchasedCareUsd: fraction(supportCents * days, 100 * billingDays * denominators)
        } : null;
        cases.push({ id:caseId, billingMode:mode, outputsPerDay:perDay, outputs, requests, originalCharges, refundedOutputs,
          refundedCharges, retainedChargeEquivalent, extraRequestsPerOutput:extra,
          refundBasis:"Full-price refund of every " + (refundEvery || "no") + " outputs, including all original request charges for those outputs; original settlements and nonrefundable payment fees are retained.",
          input:plan, report, csv:exportCohortPlanCsv(report),
          pricing:{status:"INCOMPLETE", coefficients, formula:"gross quote per original charge >= knownPurchasedCareUsd + monthlyFixedUsd * other monthly fixed USD + providerAndNetworkUsdPerAttempt * attempt cost + paymentFeeUsdPerOriginalCharge * fee + refundHandlingUsdPerRefundedCharge * refund handling + cashLaborUsdPerOutput * cash labor per output",
            scope:"Zero-margin allocation for the explicit planning period. Coefficients are exact rational numbers. Purchased care is a conditional quoted cost to the merchant; the separate care workshare describes its seller's economics. Do not count the same care hours again as per-output support. Taxes, percentage-based charges and any other omitted cost need explicit additional terms; no complete price recommendation is made.",
            knownCareFloorOnly:coefficients?.knownPurchasedCareUsd ?? null,
            missingInputs:Object.entries(input.costs).filter(([,v])=>v===null).map(([k])=>k),
            revenue:null, fullCost:null, fullBreakEvenQuote:null } });
      }
    }
  }
  return { schema:"stellar-forge.sf47-commercial-economics-result.v1", kind:"SOURCE_MODEL_PLANNING_ONLY",
    asOfDate, source:{candidateSha256, cohortEngineGitBlob:input.cohortEngineGitBlob},
    assumptions:copy(input), window:{start:date,end:dayAfter(date,days-1),days,billingPeriodEnd:dayAfter(date,billingDays-1),billingPeriodDays:billingDays},
    workshare:{input:workshareInput,report:workshareReport,csv:exportCohortPlanCsv(workshareReport)}, forecast:forecastCommercialTemplates(input), cases };
}
export function compactCommercialResult(result) {
  return { ...result, workshare:{workshares:result.workshare.report.workshares, findings:result.workshare.report.findings},
    cases:result.cases.map(({input,report,csv,...row})=>({...row,
      originalModel:{summary:report.summary,currencies:report.currencies,
        servicePricingStatusCounts:Object.fromEntries([...new Set(report.servicePricing.map(x=>x.status))].map(status=>[status,report.servicePricing.filter(x=>x.status===status).length])),
        findingCounts:Object.fromEntries([...new Set(report.findings.map(x=>x.code))].map(code=>[code,report.findings.filter(x=>x.code===code).length]))}})) };
}

export function forecastCommercialTemplates(input) {
  const f = input.forecast;
  need(f && typeof f === "object", "Retain the Forecast cash and date inputs");
  const cash = (value, label) => { nullableMoney(value, label); need(value === null || /^(0|[1-9]\d*)(\.\d{1,2})?$/.test(value), label + " needs USD cent precision"); return value; };
  const cashCosts = [cash(f.implementationCashCostUsd, "implementation cash cost"), cash(f.careCashCostUsd, "care cash cost")];
  const date = value => { isoDay(value); need(value > input.asOfDate, "Forecast dates must be after the as-of date"); return value; };
  const common = { sourceUrl:"", sourceIds:[], stage:"QUOTED", selected:false, paymentMode:"accrual", cashIds:[],invoiceIds:[],directCashIds:[] };
  const rows = [
    { ...common, id:"cocart-implementation-planning",title:"Proposed direct-customer implementation",
      caseRef:"Original CoCart October 12 implementation proposal; customer selection and acceptance remain open.",
      priceUsd:"7200.00",totalDeliveryCostUsd:cashCosts[0],remainingHours:"60",startDate:date(f.implementationStart),endDate:date(f.implementationFinish),
      receipts:[{id:"implementation-start",label:"Conditional first half",amountUsd:"3600.00",date:date(f.implementationReceipts[0])},{id:"implementation-handover",label:"Conditional accepted handover",amountUsd:"3600.00",date:date(f.implementationReceipts[1])}],
      scope:"Original proposed 60-hour / 15-business-day implementation and 5% referral on collected initial implementation fees.",
      note:"Unselected dated planning scenario. These dates are not an agreement or collection. Enter the full actual cash-cost estimate, including any agreed contributor payments, the proposed referral and other cash obligations. The $95 economic planning valuation is not automatically a cash wage." },
    { ...common, id:"cocart-care-planning",title:"Proposed optional monthly care",
      caseRef:"Original CoCart October 12 optional $600/month care proposal; no accepted care subscription.",
      priceUsd:"600.00",totalDeliveryCostUsd:cashCosts[1],remainingHours:"5",startDate:date(f.careStart),endDate:date(f.careFinish),
      receipts:[{id:"care-month",label:"Conditional full monthly care receipt",amountUsd:"600.00",date:date(f.careReceipt)}],
      scope:"Original optional monthly care for up to five hours; actual support and hosting responsibility require agreement.",
      note:"Unselected dated planning scenario. Full monthly receipt is $600; the separate 14/30 service allocation does not change invoice cash timing. Enter actual cash costs. Do not assume the implementation referral applies to care." }
  ];
  for (const row of rows) need(row.startDate <= row.endDate, "Forecast finish precedes start");
  const ready = rows.filter(row=>row.totalDeliveryCostUsd !== null);
  return { asOfDate:input.asOfDate, status:ready.length===rows.length?"READY_FOR_ORIGINAL_FORECAST_REVIEW":"CASH_COST_INPUTS_REQUIRED",
    templateRows:rows, readyCommercialRows:ready, missingCashCostRowIds:rows.filter(row=>row.totalDeliveryCostUsd===null).map(row=>row.id),
    use:"Merge reviewed readyCommercialRows into the current case's existing Forecast input; preserve original package, opening cash, grant timing and peer commercial rows. Re-select dates, source attachments and actual cash costs, then use original forecast-preview and its reviewed save. No native Forecast validation, case save or cash transaction is represented by this caller." };
}
