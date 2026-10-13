/**
 * Calendar and economics planning for a source-pinned SF47 operating case.
 * Pure ESM: the browser and Node CLI use the same deterministic implementation.
 */
export const COHORT_PLAN_SCHEMA = "stellar-forge.sf47-cohort-plan.v1";
export const COHORT_PLAN_REPORT_SCHEMA = "stellar-forge.sf47-cohort-plan-report.v1";
const ORIGINAL_RULE_SCHEMA = "stellar-forge.scf-deployment-outcomes.v1";
const DAY_MS = 86400000;
const EXTERNAL = new Set(["INDEPENDENT_OPERATOR", "CUSTOMER"]);
const PARTICIPATION = ["INDEPENDENT_OPERATOR", "CUSTOMER", "TEAM_OPERATED", "UNKNOWN"];
const ENVIRONMENTS = ["LOCAL", "TESTNET", "MAINNET", "OTHER", "UNKNOWN"];
const MAX_ITEMS = 5000;
const MAX_DAILY_ROWS = 100000;
const ZERO = Object.freeze({ n: 0n, s: 0 });
const ONE = Object.freeze({ n: 1n, s: 0 });
const POWERS = [1n];

export class CohortPlanningError extends Error {
  constructor(code, message, path = "") {
    super(message);
    this.name = "CohortPlanningError";
    this.code = code;
    this.path = path;
  }
}
function fail(code, message, path = "") { throw new CohortPlanningError(code, message, path); }
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype)
    fail("INVALID_PLAN", label + " must be a plain JSON object.", label);
  return value;
}
function fields(value, allowed, label) {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length) fail("UNKNOWN_PLAN_FIELD", label + " contains unsupported field(s): " + unknown.join(", ") + ". Preserve the original JSON and review its schema before editing.", label);
  return value;
}
function array(value, label, maximum = MAX_ITEMS) {
  if (!Array.isArray(value) || value.length > maximum)
    fail("INVALID_PLAN", label + " must be an array with at most " + maximum + " entries.", label);
  return value;
}
function textValue(value, label, required = false, maximum = 20000) {
  if (typeof value !== "string" || (value.length > maximum && [...value].length > maximum) || (required && !value.trim()))
    fail("INVALID_PLAN", label + " must be " + (required ? "nonempty " : "") + "text.", label);
  return value;
}
function optionalText(value, label, maximum = 20000) { return textValue(value ?? "", label, false, maximum); }
function id(value, label) {
  const result = textValue(value, label, true, 200);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(result))
    fail("INVALID_PLAN_ID", label + " must be an explicit stable identifier.", label);
  return result;
}
function integer(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    fail("INVALID_PLAN_NUMBER", label + " must be an integer from " + minimum + " to " + maximum + ".", label);
  return value;
}
function addCount(a, b, label = "Planned count") { return integer(a + b, label); }
function multiplyCount(a, b, label = "Planned count") { return integer(a * b, label); }
function enumValue(value, allowed, label) {
  if (!allowed.includes(value)) fail("INVALID_PLAN", label + " must be one of: " + allowed.join(", ") + ".", label);
  return value;
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
  return JSON.stringify(value);
}
function distinct(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value.id)) fail("DUPLICATE_PLAN_ID", label + " repeats " + value.id + ".", label);
    seen.add(value.id);
  }
  return values;
}
function references(value, label) {
  return [...new Set(array(value ?? [], label).map((x, i) => id(x, label + "[" + i + "]")))];
}
function evidence(value, label) {
  return {
    sourceIds: references(value.sourceIds, label + ".sourceIds"),
    sourceNote: optionalText(value.sourceNote, label + ".sourceNote")
  };
}
function power(n) {
  while (POWERS.length <= n) POWERS.push(POWERS[POWERS.length - 1] * 10n);
  return POWERS[n];
}
function decimal(value, label, allowNegative = false, calculated = false) {
  const pattern = calculated ? /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/ : /^-?(?:0|[1-9]\d*)(?:\.\d{1,24})?$/;
  if (typeof value !== "string" || value.length > (calculated ? 2000 : 100) || !pattern.test(value))
    fail("INVALID_PLAN_DECIMAL", label + " must be ordinary decimal text with at most 24 fractional digits.", label);
  const negative = value.startsWith("-");
  if (negative && !allowNegative) fail("INVALID_PLAN_DECIMAL", label + " must be nonnegative.", label);
  const parts = (negative ? value.slice(1) : value).split(".");
  return { n: BigInt(parts[0] + (parts[1] || "")) * (negative ? -1n : 1n), s: (parts[1] || "").length };
}
function computedDecimal(value, label, allowNegative = false) { return decimal(value, label, allowNegative, true); }
function decimalText(value) {
  if (!value.n) return "0";
  const negative = value.n < 0n;
  let digits = (negative ? -value.n : value.n).toString();
  if (value.s) {
    digits = digits.padStart(value.s + 1, "0");
    digits = digits.slice(0, -value.s) + "." + digits.slice(-value.s);
    digits = digits.replace(/0+$/, "").replace(/\.$/, "");
  }
  return (negative ? "-" : "") + digits;
}
function decimalAdd(a, b) {
  const s = Math.max(a.s, b.s);
  return { n: a.n * power(s - a.s) + b.n * power(s - b.s), s };
}
function decimalSubtract(a, b) { return decimalAdd(a, { n: -b.n, s: b.s }); }
function decimalMultiply(a, b) { return { n: a.n * b.n, s: a.s + b.s }; }
function decimalCount(a, count) { return { n: a.n * BigInt(count), s: a.s }; }
function decimalDivide(a, b, precision = 12) {
  if (!b.n) return null;
  const negative = (a.n < 0n) !== (b.n < 0n);
  const numerator = (a.n < 0n ? -a.n : a.n) * power(b.s + precision);
  const denominator = (b.n < 0n ? -b.n : b.n) * power(a.s);
  const quotient = numerator / denominator;
  const rounded = quotient + ((numerator % denominator) * 2n >= denominator ? 1n : 0n);
  return { n: negative ? -rounded : rounded, s: precision };
}
function nullableDecimal(value, label) {
  return value === null || value === undefined || value === "" ? null : decimalText(decimal(value, label));
}
function percentage(value, label) {
  const d = decimal(value, label);
  if (d.n > 100n * power(d.s)) fail("INVALID_PLAN_DECIMAL", label + " cannot exceed 100.", label);
  return decimalText(d);
}
function moneyCurrency(value, label) {
  const result = textValue(value, label, true, 16);
  if (!/^[A-Z][A-Z0-9._-]{0,15}$/.test(result))
    fail("INVALID_PLAN_CURRENCY", label + " must use one explicit uppercase currency code.", label);
  return result;
}
function atomic(value, label) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,99})$/.test(value))
    fail("INVALID_PLAN_AMOUNT", label + " must be canonical nonnegative integer text.", label);
  return value;
}
function dateValue(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    fail("INVALID_PLAN_DATE", label + " must be YYYY-MM-DD.", label);
  const epoch = Date.parse(value + "T00:00:00Z");
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString().slice(0, 10) !== value)
    fail("INVALID_PLAN_DATE", label + " is not a valid calendar date.", label);
  return value;
}
function dateEpoch(value) { return Date.parse(value + "T00:00:00Z"); }
function dateAfter(value, count) {
  const result = new Date(dateEpoch(value) + count * DAY_MS).toISOString().slice(0, 10);
  return dateValue(result, "Derived calendar date");
}
function clockEpoch(value) {
  // Keep the original timestamp text. Only UTC calendar classification uses milliseconds.
  const milliseconds = value.replace(/\.(\d+)(?=Z$|[+-]\d{2}:\d{2}$)/, (_, digits) => "." + digits.slice(0, 3).padEnd(3, "0"));
  return Date.parse(milliseconds);
}
function stamp(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,30})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))
    fail("INVALID_PLAN_CLOCK", label + " must be an ISO timestamp with seconds and an explicit timezone.", label);
  dateValue(value.slice(0, 10), label);
  const hour = Number(value.slice(11, 13)), minute = Number(value.slice(14, 16)), second = Number(value.slice(17, 19));
  const zone = value.match(/([+-])(\d{2}):(\d{2})$/);
  if (hour > 23 || minute > 59 || second > 59 || (zone && (Number(zone[2]) > 23 || Number(zone[3]) > 59)) || !Number.isFinite(clockEpoch(value)))
    fail("INVALID_PLAN_CLOCK", label + " is not a valid timestamp.", label);
  return value;
}
function timeValue(value, label) {
  const result = value ?? "12:00";
  if (typeof result !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(result))
    fail("INVALID_PLAN_CLOCK", label + " must be a UTC HH:MM time.", label);
  return result;
}
function weekdays(value, label, fallback = [1, 2, 3, 4, 5]) {
  return [...new Set(array(value ?? fallback, label, 7).map(x => integer(x, label, 1, 7)))].sort((a, b) => a - b);
}
function exclusionDates(value, label) {
  const seen = new Set();
  return array(value ?? [], label).map((raw, i) => {
    const row = fields(object(raw, label + "[" + i + "]"), ["date", "label"], label + "[" + i + "]");
    const date = dateValue(row.date, label + ".date");
    if (seen.has(date)) fail("DUPLICATE_PLAN_DATE", label + " repeats " + date + ".", label);
    seen.add(date);
    return { date, label: optionalText(row.label, label + ".label", 500) };
  }).sort((a, b) => a.date.localeCompare(b.date));
}
function validateRule(raw) {
  const value = object(raw, "rule");
  if (value.schema !== ORIGINAL_RULE_SCHEMA)
    fail("COHORT_PLAN_RULE_MISSING", "Use the original deployment acceptance rule from this case.", "rule");
  const target = object(value.target, "rule.target");
  integer(target.tranche, "rule.target.tranche", 2, 3);
  const window = object(target.proposed_window, "rule.target.proposed_window");
  integer(window.consecutive_calendar_days, "rule.target.proposed_window.consecutive_calendar_days", 1, 366);
  const counts = object(target.target_counts, "rule.target.target_counts");
  for (const [key, count] of Object.entries(counts)) integer(count, "rule.target.target_counts." + key, 0, MAX_ITEMS);
  return clone(value);
}
export function selectCohortPlanningRule(original, tranche) {
  object(original, "deployment_acceptance_plan");
  integer(tranche, "tranche", 2, 3);
  if (original.schema !== ORIGINAL_RULE_SCHEMA || !Array.isArray(original.targets))
    fail("COHORT_PLAN_RULE_MISSING", "The selected scenario has no original deployment acceptance proposal.", "deployment_acceptance_plan");
  const target = original.targets.find(x => x.tranche === tranche);
  if (!target) fail("COHORT_PLAN_RULE_MISSING", "The selected scenario has no proposal for tranche " + tranche + ".", "tranche");
  return validateRule({
    schema: original.schema, status: original.status ?? null,
    preparedOn: original.prepared_on ?? null, sourceBaselineCommit: original.source_baseline_commit ?? null,
    relationToBudget: original.relation_to_budget ?? null, timing: original.timing ?? null,
    independence: clone(original.independence ?? {}), reporting: clone(original.reporting ?? {}), target: clone(target)
  });
}
function sourceValue(raw) {
  const value = fields(object(raw, "source"), ["programId", "version", "planContentSha256", "planId", "planRevision"], "source");
  const hash = textValue(value.planContentSha256, "source.planContentSha256", true, 64);
  if (!/^[0-9a-f]{64}$/.test(hash)) fail("INVALID_PLAN_SOURCE", "Use the original plan content SHA-256.", "source.planContentSha256");
  const result = {
    programId: id(value.programId, "source.programId"),
    version: integer(value.version, "source.version", 1),
    planContentSha256: hash
  };
  if (value.planId !== undefined && value.planId !== null && value.planId !== "") result.planId = id(value.planId, "source.planId");
  if (value.planRevision !== undefined && value.planRevision !== null) result.planRevision = integer(value.planRevision, "source.planRevision", 1);
  return result;
}
function participant(raw, label, facilitator = false) {
  const value = fields(object(raw, label), ["id", "label", "operatorId", "participantClass", "sourceIds", "sourceNote",
    ...(facilitator ? ["serviceUrl"] : ["environment", "deploymentId"])], label);
  const result = {
    id: id(value.id, label + ".id"), label: textValue(value.label, label + ".label", true, 500),
    operatorId: optionalText(value.operatorId, label + ".operatorId", 500).trim(),
    participantClass: enumValue(value.participantClass ?? "UNKNOWN", PARTICIPATION, label + ".participantClass"),
    ...evidence(value, label)
  };
  if (facilitator) {
    result.serviceUrl = optionalText(value.serviceUrl, label + ".serviceUrl", 4000);
    if (result.serviceUrl && !/^https?:\/\/[^\s]+$/.test(result.serviceUrl))
      fail("INVALID_PLAN_URL", label + ".serviceUrl must be an HTTP or HTTPS URL.", label + ".serviceUrl");
  } else {
    result.environment = enumValue(value.environment ?? "UNKNOWN", ENVIRONMENTS, label + ".environment");
    result.deploymentId = value.deploymentId ? id(value.deploymentId, label + ".deploymentId") : null;
  }
  return result;
}
function economics(raw, label) {
  if (raw === undefined || raw === null) return null;
  const value = fields(object(raw, label), ["currency", "unitRevenue", "unitCost", "feePerPayment", "activeHoursPerTask", "hourlyCost"], label);
  const result = { currency: moneyCurrency(value.currency, label + ".currency") };
  for (const key of ["unitRevenue", "unitCost", "feePerPayment", "activeHoursPerTask", "hourlyCost"])
    result[key] = nullableDecimal(value[key], label + "." + key);
  return result;
}
function payment(raw, label) {
  const value = object(raw, label);
  const kind = enumValue(value.kind, ["PER_REQUEST", "PREPAID", "UNPAID", "FUNDED"], label + ".kind");
  fields(value, ["kind", "atomicUnitPrice", "network", "asset", ...(kind === "PREPAID" ? ["passCapacity", "openingUnits", "allowanceUnitsPerRequest", "passGroupId"] : [])], label);
  if (kind === "FUNDED") {
    if (value.atomicUnitPrice != null || (value.network ?? "") !== "" || (value.asset ?? "") !== "")
      fail("EXPLICIT_FUNDING_TERMS", "Enter commercial terms on the named funding groups.", label);
    return { kind, atomicUnitPrice: null, network: "", asset: "" };
  }
  const result = {
    kind, atomicUnitPrice: atomic(value.atomicUnitPrice ?? (kind === "UNPAID" ? "0" : undefined), label + ".atomicUnitPrice"),
    network: optionalText(value.network, label + ".network", 500),
    asset: optionalText(value.asset, label + ".asset", 500)
  };
  if (kind !== "UNPAID" && (!result.network.trim() || !result.asset.trim()))
    fail("INVALID_PLAN_PAYMENT", "A priced operation needs its explicit network and asset.", label);
  if (kind === "UNPAID" && result.atomicUnitPrice !== "0")
    fail("INVALID_PLAN_PAYMENT", "An unpaid operation must use zero atomic payment price.", label + ".atomicUnitPrice");
  if (kind === "PREPAID") {
    result.passCapacity = integer(value.passCapacity, label + ".passCapacity", 1);
    result.openingUnits = integer(value.openingUnits ?? 0, label + ".openingUnits", 0, result.passCapacity);
    result.allowanceUnitsPerRequest = integer(value.allowanceUnitsPerRequest, label + ".allowanceUnitsPerRequest", 1, result.passCapacity);
    result.passGroupId = value.passGroupId ? id(value.passGroupId, label + ".passGroupId") : null;
  }
  return result;
}

function fundingOrigin(raw, label) {
  if (raw === undefined || raw === null) return null;
  const row = fields(object(raw, label), ["installationId", "revision", "sha256", "taskId", "fundingId", "entryId", "mode", "state"], label);
  const hash = textValue(row.sha256, label + ".sha256", true, 64);
  if (!/^[0-9a-f]{64}$/.test(hash)) fail("INVALID_PLAN_SOURCE", "Retain the selected Installation edition SHA-256.", label);
  const result = { installationId: id(row.installationId, label + ".installationId"), revision: integer(row.revision, label + ".revision", 1), sha256: hash };
  for (const key of ["taskId", "fundingId", "entryId"]) if (row[key] !== undefined) result[key] = id(row[key], label + "." + key);
  if (row.mode !== undefined) result.mode = enumValue(row.mode, ["PURCHASE", "ALLOWANCE_USE", "REOPEN", "FREE_USE"], label + ".mode");
  if (row.state !== undefined) result.state = enumValue(row.state, ["PLANNED", "CANCELLED"], label + ".state");
  return result;
}
function explicitFunding(raw, label) {
  const row = fields(object(raw, label), ["id", "label", "kind", "date", "buyerId", "operationId", "facilitatorId", "atomicUnitPrice", "network", "asset", "economics", "origin", "sourceIds", "sourceNote"], label);
  let estimate = null;
  if (row.economics != null) {
    const value = fields(object(row.economics, label + ".economics"), ["currency", "unitRevenue", "feePerPayment"], label + ".economics");
    estimate = { currency: moneyCurrency(value.currency, label + ".economics.currency"),
      unitRevenue: nullableDecimal(value.unitRevenue, label + ".economics.unitRevenue"),
      feePerPayment: nullableDecimal(value.feePerPayment, label + ".economics.feePerPayment") };
  }
  return { id: id(row.id, label + ".id"), label: textValue(row.label, label + ".label", true, 500),
    kind: enumValue(row.kind, ["DIRECT", "PREPAID"], label + ".kind"), date: dateValue(row.date, label + ".date"),
    buyerId: id(row.buyerId, label + ".buyerId"), operationId: id(row.operationId, label + ".operationId"),
    facilitatorId: row.facilitatorId ? id(row.facilitatorId, label + ".facilitatorId") : null,
    atomicUnitPrice: row.atomicUnitPrice == null || row.atomicUnitPrice === "" ? null : atomic(row.atomicUnitPrice, label + ".atomicUnitPrice"),
    network: optionalText(row.network, label + ".network", 500), asset: optionalText(row.asset, label + ".asset", 500),
    economics: estimate, origin: fundingOrigin(row.origin, label + ".origin"), ...evidence(row, label) };
}
function calendarSource(raw) {
  if (raw === undefined || raw === null) return null;
  const row = fields(object(raw, "calendarSource"), ["schema", "groupId", "selection", "cohortSeed"], "calendarSource");
  if (row.schema !== "stellar-forge.sf47-cohort-plan-calendar-source.v1" ||
      row.selection?.schema !== "stellar-forge.sf47-customer-use-calendar.v1.selection" ||
      row.cohortSeed?.customerUse?.groupId !== row.groupId)
    fail("INVALID_PLAN_SOURCE", "Retain the complete original calendar selection and matching native Cohort seed.", "calendarSource");
  id(row.groupId, "calendarSource.groupId");
  object(row.selection, "calendarSource.selection"); object(row.cohortSeed, "calendarSource.cohortSeed");
  return clone(row);
}

function capacityPool(raw, label) {
  const row = fields(object(raw, label), ["id", "label", "hoursByWeekday", "dateOverrides", "sourceIds", "sourceNote"], label);
  const weekly = fields(object(row.hoursByWeekday ?? {}, label + ".hoursByWeekday"), ["1", "2", "3", "4", "5", "6", "7"], label + ".hoursByWeekday");
  const hoursByWeekday = {};
  for (let day = 1; day <= 7; day++)
    hoursByWeekday[day] = nullableDecimal(weekly[day], label + ".hoursByWeekday." + day);
  const seen = new Set();
  const dateOverrides = array(row.dateOverrides ?? [], label + ".dateOverrides").map((rawOverride, i) => {
    const key = label + ".dateOverrides[" + i + "]";
    const entry = fields(object(rawOverride, key), ["date", "availableHours", "label"], key);
    const date = dateValue(entry.date, key + ".date");
    if (seen.has(date)) fail("DUPLICATE_PLAN_DATE", label + " repeats override " + date + ".", key);
    seen.add(date);
    return { date, availableHours: nullableDecimal(entry.availableHours, key + ".availableHours"), label: optionalText(entry.label, key + ".label", 500) };
  }).sort((a, b) => a.date.localeCompare(b.date));
  return { id: id(row.id, label + ".id"), label: textValue(row.label, label + ".label", true, 500), hoursByWeekday, dateOverrides, ...evidence(row, label) };
}
function cadence(raw, label, globalWeekdays) {
  const value = object(raw, label);
  const kind = enumValue(value.kind, ["WEEKDAYS", "EVERY_N_DAYS", "EXPLICIT_DATES"], label + ".kind");
  fields(value, ["kind", ...(kind === "WEEKDAYS" ? ["weekdays"] : kind === "EVERY_N_DAYS" ? ["intervalDays", "anchorDate"] : ["dates"])], label);
  if (kind === "WEEKDAYS") return { kind, weekdays: weekdays(value.weekdays, label + ".weekdays", globalWeekdays) };
  if (kind === "EVERY_N_DAYS") return {
    kind, intervalDays: integer(value.intervalDays, label + ".intervalDays", 1, 366000),
    anchorDate: dateValue(value.anchorDate, label + ".anchorDate")
  };
  return {
    kind, dates: [...new Set(array(value.dates, label + ".dates").map(x => dateValue(x, label + ".dates")))].sort()
  };
}

export const COHORT_SCHEDULING_SCHEMA = "stellar-forge.sf47-delivery-scheduling.v1";
export function normalizeCohortScheduling(raw, schedules) {
  const value = fields(object(raw, "deliveryScheduling"), ["schema", "strategy", "schedules", "note"], "deliveryScheduling");
  if (value.schema !== COHORT_SCHEDULING_SCHEMA) fail("INVALID_SCHEDULING_SCHEMA", "Use " + COHORT_SCHEDULING_SCHEMA + ".", "deliveryScheduling.schema");
  const scheduleIds = new Set(schedules.map(row => row.id)), seen = new Set();
  const policies = array(value.schedules, "deliveryScheduling.schedules", 1000).map((rawPolicy, index) => {
    const path = "deliveryScheduling.schedules[" + index + "]";
    const row = fields(object(rawPolicy, path), ["scheduleId", "flexible", "advanceDays", "delayDays", "releaseDate", "dueDate", "weekdays", "minimumGapDays", "priority", "note"], path);
    const scheduleId = id(row.scheduleId, path + ".scheduleId");
    if (!scheduleIds.has(scheduleId) || seen.has(scheduleId)) fail("SCHEDULING_REFERENCE", "Select each original schedule at most once.", path);
    seen.add(scheduleId);
    if (typeof row.flexible !== "boolean") fail("SCHEDULING_FLEXIBILITY", "Choose fixed or flexible service dates.", path + ".flexible");
    const releaseDate = row.releaseDate == null || row.releaseDate === "" ? null : dateValue(row.releaseDate, path + ".releaseDate");
    const dueDate = row.dueDate == null || row.dueDate === "" ? null : dateValue(row.dueDate, path + ".dueDate");
    if (releaseDate && dueDate && releaseDate > dueDate) fail("SCHEDULING_WINDOW", "The release date must not follow the completion deadline.", path);
    return { scheduleId, flexible: row.flexible,
      advanceDays: integer(row.advanceDays ?? 0, path + ".advanceDays", 0, 366000),
      delayDays: integer(row.delayDays ?? 0, path + ".delayDays", 0, 366000), releaseDate, dueDate,
      weekdays: weekdays(row.weekdays, path + ".weekdays", [1, 2, 3, 4, 5, 6, 7]),
      minimumGapDays: integer(row.minimumGapDays ?? 0, path + ".minimumGapDays", 0, 366000),
      priority: integer(row.priority ?? 0, path + ".priority", 0, 1000000),
      note: optionalText(row.note, path + ".note") };
  });
  return { schema: COHORT_SCHEDULING_SCHEMA,
    strategy: enumValue(value.strategy ?? "NEAREST", ["NEAREST", "EARLIEST"], "deliveryScheduling.strategy"),
    schedules: policies, note: optionalText(value.note, "deliveryScheduling.note") };
}
function dateAllocations(raw, label) {
  const seen = new Set();
  return array(raw, label, MAX_DAILY_ROWS).map((value, index) => {
    const path = label + "[" + index + "]", row = fields(object(value, path), ["sourceDate", "date"], path);
    const sourceDate = dateValue(row.sourceDate, path + ".sourceDate");
    if (seen.has(sourceDate)) fail("DUPLICATE_DATE_ALLOCATION", "Allocate each original occurrence once.", path);
    seen.add(sourceDate);
    return { sourceDate, date: dateValue(row.date, path + ".date") };
  }).sort((a, b) => a.sourceDate.localeCompare(b.sourceDate));
}

export function normalizeCohortPlan(raw) {
  const value = fields(object(raw, "plan"), ["schema", "draftId", "name", "source", "rule", "asOfAt", "windowStart", "calendar",
    "buyers", "merchants", "facilitators", "operations", "schedules", "workshares", "capacityPools", "fundingGroups", "calendarSource", "deliveryScheduling", "sensitivity", "note"], "plan");
  if (value.schema !== COHORT_PLAN_SCHEMA) fail("INVALID_PLAN_SCHEMA", "Use " + COHORT_PLAN_SCHEMA + ".", "schema");
  const rule = validateRule(value.rule), source = sourceValue(value.source);
  const cal = fields(object(value.calendar ?? {}, "calendar"), ["timezone", "weekdays", "excludedDates"], "calendar");
  const calendar = { timezone: "UTC", weekdays: weekdays(cal.weekdays, "calendar.weekdays"), excludedDates: exclusionDates(cal.excludedDates, "calendar.excludedDates") };
  if (cal.timezone !== undefined && cal.timezone !== "UTC") fail("INVALID_PLAN_CALENDAR", "The pinned cohort windows use UTC calendar dates.", "calendar.timezone");
  const buyers = distinct(array(value.buyers ?? [], "buyers").map((x, i) => participant(x, "buyers[" + i + "]")), "buyers");
  const merchants = distinct(array(value.merchants ?? [], "merchants").map((x, i) => participant(x, "merchants[" + i + "]")), "merchants");
  const facilitators = distinct(array(value.facilitators ?? [], "facilitators").map((x, i) => participant(x, "facilitators[" + i + "]", true)), "facilitators");
  const buyerIds = new Set(buyers.map(x => x.id)), merchantIds = new Set(merchants.map(x => x.id)), facilitatorIds = new Set(facilitators.map(x => x.id));
  const operations = distinct(array(value.operations ?? [], "operations").map((rawOperation, i) => {
    const label = "operations[" + i + "]", row = fields(object(rawOperation, label), ["id", "label", "merchantId", "scope", "expectedOutput", "sourcePeriod", "sourceIds", "sourceNote"], label), merchantId = id(row.merchantId, label + ".merchantId");
    if (!merchantIds.has(merchantId)) fail("UNKNOWN_PLAN_REFERENCE", "Select the operation's original or planned merchant.", label + ".merchantId");
    return {
      id: id(row.id, label + ".id"), label: textValue(row.label, label + ".label", true, 500), merchantId,
      scope: optionalText(row.scope, label + ".scope"), expectedOutput: optionalText(row.expectedOutput, label + ".expectedOutput"),
      sourcePeriod: optionalText(row.sourcePeriod, label + ".sourcePeriod"), ...evidence(row, label)
    };
  }), "operations");
  const operationIds = new Set(operations.map(x => x.id));
  const capacityPools = distinct(array(value.capacityPools ?? [], "capacityPools", 1000).map((x, i) => capacityPool(x, "capacityPools[" + i + "]")), "capacityPools");
  const capacityPoolIds = new Set(capacityPools.map(x => x.id));
  const fundingGroups = distinct(array(value.fundingGroups ?? [], "fundingGroups").map((row, i) => explicitFunding(row, "fundingGroups[" + i + "]")), "fundingGroups");
  const fundingById = new Map(fundingGroups.map(row => [row.id, row]));
  const fundingOrigins = new Set();
  for (const row of fundingGroups) {
    if (!buyerIds.has(row.buyerId) || !operationIds.has(row.operationId) || (row.facilitatorId && !facilitatorIds.has(row.facilitatorId)))
      fail("UNKNOWN_PLAN_REFERENCE", "Select the explicit funding group's original buyer, operation and facilitator.", "fundingGroups." + row.id);
    if (row.origin?.fundingId) {
      const key = canonical([row.origin.installationId, row.origin.revision, row.origin.fundingId]);
      if (fundingOrigins.has(key)) fail("DUPLICATE_FUNDING_ORIGIN", "One saved funding group can occur only once in this plan.", "fundingGroups." + row.id);
      fundingOrigins.add(key);
    }
  }
  const operationsById = new Map(operations.map(row => [row.id, row]));
  const schedules = distinct(array(value.schedules ?? [], "schedules", 1000).map((rawSchedule, i) => {
    const label = "schedules[" + i + "]", row = fields(object(rawSchedule, label), ["id", "label", "operationId", "buyerId", "facilitatorId", "cadence", "tasksPerDate", "requestsPerTask", "timeUtc", "deliveryDelayMinutes", "excludedDates", "payment", "economics", "capacityPoolId", "fundingGroupIds", "origin", "dateAllocations", "note"], label);
    const operationId = id(row.operationId, label + ".operationId"), buyerId = id(row.buyerId, label + ".buyerId");
    const facilitatorId = row.facilitatorId ? id(row.facilitatorId, label + ".facilitatorId") : null;
    if (!operationIds.has(operationId) || !buyerIds.has(buyerId) || (facilitatorId && !facilitatorIds.has(facilitatorId)))
      fail("UNKNOWN_PLAN_REFERENCE", "Select existing plan operation, buyer and facilitator identities.", label);
    const capacityPoolId = row.capacityPoolId ? id(row.capacityPoolId, label + ".capacityPoolId") : null;
    if (capacityPoolId && !capacityPoolIds.has(capacityPoolId)) fail("UNKNOWN_PLAN_REFERENCE", "Select an existing delivery capacity pool.", label + ".capacityPoolId");
    const paymentValue = payment(row.payment, label + ".payment"), fundingGroupIds = references(row.fundingGroupIds, label + ".fundingGroupIds");
    if ((paymentValue.kind === "FUNDED") !== (fundingGroupIds.length > 0))
      fail("EXPLICIT_FUNDING_REFERENCE", "A funded use needs its named funding groups; other payment modes carry no explicit funding references.", label);
    for (const key of fundingGroupIds) {
      const funding = fundingById.get(key);
      if (!funding || funding.buyerId !== buyerId || operationsById.get(funding.operationId).merchantId !== operationsById.get(operationId).merchantId)
        fail("EXPLICIT_FUNDING_REFERENCE", "A useful result and its funding must select the same buyer and merchant.", label);
    }
    return {
      id: id(row.id, label + ".id"), label: optionalText(row.label, label + ".label", 500), operationId, buyerId, facilitatorId, capacityPoolId,
      fundingGroupIds, origin: fundingOrigin(row.origin, label + ".origin"),
      cadence: cadence(row.cadence, label + ".cadence", calendar.weekdays),
      ...(row.dateAllocations === undefined ? {} : { dateAllocations: dateAllocations(row.dateAllocations, label + ".dateAllocations") }),
      tasksPerDate: integer(row.tasksPerDate, label + ".tasksPerDate", 0),
      requestsPerTask: integer(row.requestsPerTask, label + ".requestsPerTask", 1),
      timeUtc: timeValue(row.timeUtc, label + ".timeUtc"),
      deliveryDelayMinutes: integer(row.deliveryDelayMinutes ?? 0, label + ".deliveryDelayMinutes", 0, 527040),
      excludedDates: exclusionDates(row.excludedDates, label + ".excludedDates"),
      payment: paymentValue, economics: economics(row.economics, label + ".economics"),
      note: optionalText(row.note, label + ".note")
    };
  }), "schedules");
  const workshares = distinct(array(value.workshares ?? [], "workshares").map((rawWorkshare, i) => {
    const label = "workshares[" + i + "]", row = fields(object(rawWorkshare, label), ["id", "label", "currency", "fee", "hours", "hourlyCost", "otherCosts", "sourceIds", "sourceNote"], label);
    const result = { id: id(row.id, label + ".id"), label: textValue(row.label, label + ".label", true, 500), currency: moneyCurrency(row.currency, label + ".currency"), ...evidence(row, label) };
    for (const key of ["fee", "hours", "hourlyCost", "otherCosts"]) result[key] = nullableDecimal(row[key], label + "." + key);
    return result;
  }), "workshares");
  const sensitivity = fields(object(value.sensitivity ?? {}, "sensitivity"), ["effortIncreasesPct", "completionSharesPct", "minimumMarginPct"], "sensitivity");
  const minimumMarginPct = sensitivity.minimumMarginPct === undefined || sensitivity.minimumMarginPct === null || sensitivity.minimumMarginPct === "" ? null : percentage(sensitivity.minimumMarginPct, "sensitivity.minimumMarginPct");
  if (minimumMarginPct === "100") fail("INVALID_PLAN_DECIMAL", "A service price margin must be below 100 percent.", "sensitivity.minimumMarginPct");
  return {
    schema: COHORT_PLAN_SCHEMA, draftId: id(value.draftId, "draftId"), name: textValue(value.name, "name", true, 500), source, rule,
    asOfAt: stamp(value.asOfAt, "asOfAt"), windowStart: dateValue(value.windowStart, "windowStart"), calendar,
    buyers, merchants, facilitators, operations, schedules, workshares, capacityPools, fundingGroups, calendarSource: calendarSource(value.calendarSource),
    ...(value.deliveryScheduling === undefined ? {} : { deliveryScheduling: normalizeCohortScheduling(value.deliveryScheduling, schedules) }),
    sensitivity: {
      minimumMarginPct,
      effortIncreasesPct: [...new Set(array(sensitivity.effortIncreasesPct ?? ["0", "20", "25"], "sensitivity.effortIncreasesPct", 30).map(x => decimalText(decimal(x, "Effort increase"))))],
      completionSharesPct: [...new Set(array(sensitivity.completionSharesPct ?? ["100", "90", "75"], "sensitivity.completionSharesPct", 30).map(x => percentage(x, "Completion share")))]
    },
    note: optionalText(value.note, "note")
  };
}
export function seedCohortPlan(nativeSeed, options = {}) {
  const seed = object(nativeSeed, "nativeSeed"), rule = validateRule(seed.rule);
  const asOfAt = stamp(options.asOfAt ?? seed.inputs?.asOfAt, "asOfAt");
  const source = { ...sourceValue(seed.source) };
  if (options.planId !== undefined) source.planId = options.planId;
  if (options.planRevision !== undefined) source.planRevision = options.planRevision;
  const deployments = array(seed.inventory?.deployments ?? [], "nativeSeed.inventory.deployments");
  const mapDeployment = row => ({
    id: row.id, deploymentId: row.id, label: row.label || row.name || row.id, operatorId: row.operatorId || "",
    participantClass: row.participantClass || "UNKNOWN", environment: row.environment || "UNKNOWN",
    sourceIds: row.sourceIds || [], sourceNote: row.sourceNote || ""
  });
  const buyers = deployments.filter(x => ["BUYER", "BOTH"].includes(x.role)).map(mapDeployment);
  const merchants = deployments.filter(x => ["MERCHANT", "BOTH"].includes(x.role)).map(mapDeployment);
  return normalizeCohortPlan({
    schema: COHORT_PLAN_SCHEMA,
    draftId: options.draftId ?? "cohortplan:" + source.planContentSha256.slice(0, 16) + ":T" + rule.target.tranche + ":" + asOfAt.replace(/[^0-9]/g, ""),
    name: options.name ?? "Tranche " + rule.target.tranche + " customer cohort plan",
    source, rule, asOfAt, windowStart: options.windowStart ?? seed.inputs?.windowStart ?? new Date(clockEpoch(asOfAt)).toISOString().slice(0, 10),
    calendar: { timezone: "UTC", weekdays: [1, 2, 3, 4, 5], excludedDates: [] },
    buyers, merchants, facilitators: [], operations: [], schedules: [], workshares: [],
    sensitivity: { effortIncreasesPct: ["0", "20", "25"], completionSharesPct: ["100", "90", "75"] }, note: ""
  });
}
function makeMetrics() {
  return { scheduledTasks: 0, scheduledRequests: 0, plannedPaymentRequests: 0, plannedPaidPurchases: 0, plannedCompleteTasks: 0, plannedCompletePurchases: 0, independentPurchaseOpportunities: 0, allowanceUnits: 0 };
}
function sumMetrics(target, value) {
  for (const key of Object.keys(makeMetrics())) target[key] = addCount(target[key], value[key] ?? 0, key);
}
function isExternal(value, environment) { return !!(value && EXTERNAL.has(value.participantClass) && value.operatorId.trim() && (environment === undefined || value.environment === environment)); }
function cadenceMatches(cadenceValue, date, weekday) {
  if (cadenceValue.kind === "WEEKDAYS") return cadenceValue.weekdays.includes(weekday);
  if (cadenceValue.kind === "EXPLICIT_DATES") return cadenceValue.dates.includes(date);
  const elapsed = (dateEpoch(date) - dateEpoch(cadenceValue.anchorDate)) / DAY_MS;
  return elapsed >= 0 && elapsed % cadenceValue.intervalDays === 0;
}
function moneyForOccurrence(row, terms) {
  if (!terms) return null;
  const read = key => terms[key] === null ? null : decimal(terms[key], key);
  const unitRevenue = read("unitRevenue"), unitCost = read("unitCost"), fee = read("feePerPayment"), hours = read("activeHoursPerTask"), rate = read("hourlyCost");
  const revenue = row.plannedPaymentRequests === 0 ? ZERO : unitRevenue === null ? null : decimalCount(unitRevenue, row.plannedPaymentRequests);
  const supplier = row.scheduledRequests === 0 ? ZERO : unitCost === null ? null : decimalCount(unitCost, row.scheduledRequests);
  const fees = row.plannedPaymentRequests === 0 ? ZERO : fee === null ? null : decimalCount(fee, row.plannedPaymentRequests);
  const activeHours = row.scheduledTasks === 0 ? ZERO : hours === null ? null : decimalCount(hours, row.scheduledTasks);
  const labor = activeHours?.n === 0n ? ZERO : activeHours === null || rate === null ? null : decimalMultiply(activeHours, rate);
  const costs = supplier === null || fees === null || labor === null ? null : decimalAdd(decimalAdd(supplier, fees), labor);
  const contribution = revenue === null || costs === null ? null : decimalSubtract(revenue, costs);
  const fields = { revenue, supplierCost: supplier, paymentFees: fees, activeHours, laborCost: labor, totalCost: costs, contribution };
  return { currency: terms.currency, ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v === null ? null : decimalText(v)])) };
}
function sumMoney(target, row) {
  target.records++;
  for (const key of ["revenue", "supplierCost", "paymentFees", "activeHours", "laborCost"]) {
    if (row[key] === null) target.unknown[key]++;
    else target.known[key] = decimalAdd(target.known[key], computedDecimal(row[key], key, true));
  }
}
function finishMoney(value) {
  const result = { currency: value.currency, records: value.records, knownSubtotals: {}, unknownRecordCounts: { ...value.unknown }, complete: true };
  for (const key of Object.keys(value.known)) {
    result.knownSubtotals[key] = decimalText(value.known[key]);
    result[key] = value.unknown[key] ? null : result.knownSubtotals[key];
    if (value.unknown[key]) result.complete = false;
  }
  result.totalCost = ["supplierCost", "paymentFees", "laborCost"].some(k => result[k] === null) ? null :
    decimalText(decimalAdd(decimalAdd(value.known.supplierCost, value.known.paymentFees), value.known.laborCost));
  result.contribution = result.revenue === null || result.totalCost === null ? null :
    decimalText(decimalSubtract(value.known.revenue, computedDecimal(result.totalCost, "totalCost")));
  const margin = result.contribution === null ? null : decimalDivide(decimalCount(computedDecimal(result.contribution, "contribution", true), 100), value.known.revenue, 6);
  result.marginPercent = margin === null ? null : decimalText(margin);
  return result;
}
function workshareResult(row, increases) {
  const fee = row.fee === null ? null : decimal(row.fee, "fee"), hours = row.hours === null ? null : decimal(row.hours, "hours");
  const rate = row.hourlyCost === null ? null : decimal(row.hourlyCost, "hourlyCost"), other = row.otherCosts === null ? null : decimal(row.otherCosts, "otherCosts");
  const cases = increases.map(increase => {
    const pct = decimal(increase, "increase"), factor = decimalAdd(ONE, { n: pct.n, s: pct.s + 2 });
    const adjustedHours = hours === null ? null : decimalMultiply(hours, factor);
    const labor = adjustedHours?.n === 0n ? ZERO : adjustedHours === null || rate === null ? null : decimalMultiply(adjustedHours, rate);
    const cost = labor === null || other === null ? null : decimalAdd(labor, other);
    const contribution = fee === null || cost === null ? null : decimalSubtract(fee, cost);
    const margin = contribution === null || fee === null ? null : decimalDivide(decimalCount(contribution, 100), fee, 6);
    return {
      effortIncreasePct: increase, hours: adjustedHours === null ? null : decimalText(adjustedHours),
      laborCost: labor === null ? null : decimalText(labor), totalCost: cost === null ? null : decimalText(cost),
      contribution: contribution === null ? null : decimalText(contribution), marginPercent: margin === null ? null : decimalText(margin)
    };
  });
  const available = fee === null || other === null ? null : decimalSubtract(fee, other);
  const breakEven = available === null || rate === null ? null : decimalDivide(available, rate);
  return { ...row, cases, breakEvenHours: breakEven === null ? null : decimalText(breakEven) };
}
function compareSource(input, nativeSeed) {
  if (!nativeSeed) return { status: "NOT_COMPARED", fields: [], ruleMatches: null, currentSource: null, currentRule: null };
  const original = object(nativeSeed, "nativeSeed");
  const currentSource = sourceValue(original.source), currentRule = validateRule(original.rule);
  const compared = ["programId", "version", "planContentSha256"].map(key => ({
    key, planned: input.source[key], current: currentSource[key], match: input.source[key] === currentSource[key]
  }));
  for (const key of ["planId", "planRevision"]) if (input.source[key] !== undefined && currentSource[key] !== undefined)
    compared.push({ key, planned: input.source[key], current: currentSource[key], match: input.source[key] === currentSource[key] });
  const ruleMatches = canonical(input.rule) === canonical(currentRule);
  return { status: ruleMatches && compared.every(row => row.match) ? "MATCH" : "CHANGED", fields: compared,
    ruleMatches, currentSource, currentRule };
}
function positive(value) { return value.n > 0n ? value : ZERO; }
function decimalCeilingDivide(a, b, precision = 12) {
  if (!b.n) return null;
  const numerator = a.n * power(b.s + precision), denominator = b.n * power(a.s);
  return { n: (numerator + denominator - 1n) / denominator, s: precision };
}
function capacitySummary(rows) {
  let available = ZERO, required = ZERO, minimumExtra = ZERO, unknownAvailabilityDates = 0, unknownEffortOccurrences = 0;
  const overloadedDates = [];
  for (const row of rows) {
    if (row.availableHours === null) unknownAvailabilityDates++; else available = decimalAdd(available, computedDecimal(row.availableHours, "Available hours"));
    required = decimalAdd(required, computedDecimal(row.knownRequiredHours, "Known required hours"));
    minimumExtra = decimalAdd(minimumExtra, computedDecimal(row.additionalHoursKnownMinimum, "Additional hours"));
    unknownEffortOccurrences += row.unknownEffortOccurrences;
    if (row.status === "OVERALLOCATED") overloadedDates.push(row.date);
  }
  const complete = unknownAvailabilityDates === 0 && unknownEffortOccurrences === 0;
  return {
    availableHours: unknownAvailabilityDates ? null : decimalText(available), knownAvailableHours: decimalText(available),
    requiredHours: unknownEffortOccurrences ? null : decimalText(required), knownRequiredHours: decimalText(required),
    headroomHours: complete ? decimalText(decimalSubtract(available, required)) : null,
    additionalHoursKnownMinimum: decimalText(minimumExtra), overloadedDates, unknownAvailabilityDates, unknownEffortOccurrences,
    status: overloadedDates.length ? "OVERALLOCATED" : complete ? "WITHIN_CAPACITY" : "INCOMPLETE"
  };
}
function planDeliveryCapacity(input, days, occurrences, finding) {
  const configured = input.capacityPools.length > 0, schedules = new Map(input.schedules.map(row => [row.id, row]));
  const poolDays = new Map(), pools = [];
  for (const pool of input.capacityPools) {
    const overrides = new Map(pool.dateOverrides.map(row => [row.date, row]));
    const rows = days.map(day => {
      const override = overrides.get(day.date);
      const result = {
        poolId: pool.id, date: day.date, weekday: day.weekday,
        weekStart: dateAfter(day.date, 1 - day.weekday),
        availableHours: override ? override.availableHours : pool.hoursByWeekday[day.weekday],
        availabilityBasis: override ? "DATE_OVERRIDE" : "WEEKDAY", availabilityNote: override?.label || "",
        scheduledTasks: 0, scheduleIds: [], knownHours: ZERO, unknownEffortOccurrences: 0
      };
      poolDays.set(canonical([pool.id, day.date]), result);
      return result;
    });
    pools.push({ ...clone(pool), rows });
  }
  const unassigned = [];
  for (const occurrence of occurrences) {
    const schedule = schedules.get(occurrence.scheduleId);
    const rawHours = schedule.economics?.activeHoursPerTask ?? null;
    const required = occurrence.scheduledTasks === 0 ? ZERO : rawHours === null ? null : decimalCount(decimal(rawHours, "Task effort"), occurrence.scheduledTasks);
    if (!schedule.capacityPoolId) {
      if (occurrence.scheduledTasks && (required === null || required.n > 0n))
        unassigned.push({ scheduleId: schedule.id, date: occurrence.date, scheduledTasks: occurrence.scheduledTasks, requiredHours: required === null ? null : decimalText(required) });
      continue;
    }
    const row = poolDays.get(canonical([schedule.capacityPoolId, occurrence.date]));
    row.scheduledTasks = addCount(row.scheduledTasks, occurrence.scheduledTasks);
    row.scheduleIds.push(schedule.id);
    if (required === null) row.unknownEffortOccurrences++; else row.knownHours = decimalAdd(row.knownHours, required);
  }
  const resultPools = pools.map(pool => {
    const rows = pool.rows.map(({ knownHours, ...row }) => {
      const available = row.availableHours === null ? null : decimal(row.availableHours, "Available hours");
      const minimumExtra = available === null ? ZERO : positive(decimalSubtract(knownHours, available));
      const complete = available !== null && row.unknownEffortOccurrences === 0;
      return { ...row, scheduleIds: [...new Set(row.scheduleIds)], knownRequiredHours: decimalText(knownHours),
        requiredHours: row.unknownEffortOccurrences ? null : decimalText(knownHours),
        headroomHours: complete ? decimalText(decimalSubtract(available, knownHours)) : null,
        additionalHoursKnownMinimum: decimalText(minimumExtra),
        utilizationPercent: complete && available.n ? decimalText(decimalDivide(decimalCount(knownHours, 100), available, 6)) : null,
        status: minimumExtra.n > 0n ? "OVERALLOCATED" : complete ? "WITHIN_CAPACITY" : "INCOMPLETE"
      };
    });
    const weeks = [...new Set(rows.map(row => row.weekStart))].map(weekStart => {
      const selected = rows.filter(row => row.weekStart === weekStart);
      return { poolId: pool.id, weekStart, start: selected[0].date, end: selected.at(-1).date, includedCalendarDays: selected.length, ...capacitySummary(selected) };
    });
    const { rows: ignored, ...definition } = pool;
    const summary = capacitySummary(rows);
    if (summary.overloadedDates.length) finding("DELIVERY_CAPACITY_SHORTFALL", pool.label + " needs at least " + summary.additionalHoursKnownMinimum + " additional active hours across " + summary.overloadedDates.length + " overloaded UTC date(s).", "capacityPool", pool.id);
    if (summary.unknownAvailabilityDates || summary.unknownEffortOccurrences) finding("DELIVERY_CAPACITY_INCOMPLETE", "Complete " + pool.label + "'s daily availability and assigned task effort to evaluate its full workload.", "capacityPool", pool.id);
    return { ...definition, ...summary, days: rows, weeks };
  });
  if (configured && unassigned.length) finding("DELIVERY_CAPACITY_UNASSIGNED", unassigned.length + " scheduled occurrence(s) with positive or unknown effort have no delivery pool.", "capacity");
  return {
    status: !configured ? "NOT_CONFIGURED" : resultPools.some(row => row.status === "OVERALLOCATED") ? "OVERALLOCATED" : unassigned.length || resultPools.some(row => row.status === "INCOMPLETE") ? "INCOMPLETE" : "WITHIN_CAPACITY",
    basis: "Active effort is required on each scheduled UTC date. Capacity is shared across all schedules assigned to a pool; unused hours on another date do not erase a daily deficit.",
    pools: resultPools, unassigned,
    sensitivity: input.sensitivity.effortIncreasesPct.flatMap(increase => {
      const pct = decimal(increase, "Effort increase"), factor = decimalAdd(ONE, { n: pct.n, s: pct.s + 2 });
      return resultPools.map(pool => {
        const scaled = pool.days.map(row => {
          const hours = decimalMultiply(computedDecimal(row.knownRequiredHours, "Known hours"), factor);
          const extra = row.availableHours === null ? ZERO : positive(decimalSubtract(hours, decimal(row.availableHours, "Available hours")));
          return { ...row, knownRequiredHours: decimalText(hours), additionalHoursKnownMinimum: decimalText(extra), status: extra.n > 0n ? "OVERALLOCATED" : row.unknownEffortOccurrences || row.availableHours === null ? "INCOMPLETE" : "WITHIN_CAPACITY" };
        });
        return { poolId: pool.id, label: pool.label, effortIncreasePct: increase, ...capacitySummary(scaled) };
      });
    })
  };
}
function planServicePricing(input, occurrences, finding, explicitGroups = []) {
  const schedules = new Map(input.schedules.map(row => [row.id, row])), groups = new Map();
  for (const occurrence of occurrences) {
    const schedule = schedules.get(occurrence.scheduleId), terms = schedule.payment;
    if (terms.kind === "FUNDED") continue;
    const key = terms.kind === "PREPAID" && terms.passGroupId ? "shared:" + terms.passGroupId : "schedule:" + schedule.id;
    if (!groups.has(key)) groups.set(key, {
      id: key, label: terms.kind === "PREPAID" && terms.passGroupId ? terms.passGroupId : schedule.label || schedule.id,
      scheduleIds: new Set(), currency: schedule.economics?.currency ?? null, paymentKind: terms.kind,
      unitRevenue: schedule.economics?.unitRevenue ?? null, chargeUnits: 0, scheduledTasks: 0, known: { revenue: ZERO, supplierCost: ZERO, paymentFees: ZERO, laborCost: ZERO },
      unknown: { revenue: 0, supplierCost: 0, paymentFees: 0, laborCost: 0 }
    });
    const group = groups.get(key); group.scheduleIds.add(schedule.id);
    group.chargeUnits = addCount(group.chargeUnits, occurrence.plannedPaymentRequests);
    group.scheduledTasks = addCount(group.scheduledTasks, occurrence.scheduledTasks);
    for (const name of Object.keys(group.known)) {
      const value = occurrence.economics?.[name] ?? null;
      if (value === null) group.unknown[name]++; else group.known[name] = decimalAdd(group.known[name], computedDecimal(value, name));
    }
  }

  // Connected funding/use components keep one useful result's costs once when
  // several explicit groups fund it. We never divide a shared cost arbitrarily.
  const parents = new Map(explicitGroups.map(row => [row.id, row.id]));
  const parent = id => { let current = id; while (parents.get(current) !== current) current = parents.get(current); return current; };
  for (const schedule of input.schedules.filter(row => row.payment.kind === "FUNDED"))
    for (const id of schedule.fundingGroupIds.slice(1)) parents.set(parent(id), parent(schedule.fundingGroupIds[0]));
  const components = new Map();
  for (const occurrence of occurrences.filter(row => row.paymentKind === "FUNDED")) {
    const schedule = schedules.get(occurrence.scheduleId), key = "funded:" + parent(schedule.fundingGroupIds[0]);
    if (!components.has(key)) components.set(key, { id: key, scheduleIds: new Set(), occurrences: [], fundingGroups: [], currencies: new Set(), missingCurrency: false });
    const component = components.get(key); component.scheduleIds.add(schedule.id); component.occurrences.push(occurrence);
    if (schedule.economics) component.currencies.add(schedule.economics.currency); else if (occurrence.scheduledTasks) component.missingCurrency = true;
  }
  for (const funding of explicitGroups) {
    const component = components.get("funded:" + parent(funding.id)); if (!component) continue;
    component.fundingGroups.push(funding);
    if (funding.plannedPaymentRequests) {
      if (funding.economics) component.currencies.add(funding.economics.currency); else component.missingCurrency = true;
    }
  }
  for (const component of components.values()) {
    const currencies = [...component.currencies].sort(), compatible = currencies.length === 1 && !component.missingCurrency;
    const charged = component.fundingGroups.filter(row => row.plannedPaymentRequests);
    const prices = new Set(charged.map(row => row.sourceEconomics?.unitRevenue ?? null));
    const group = { id: component.id, label: component.fundingGroups.map(row => row.label).join(" + "),
      scheduleIds: component.scheduleIds, currency: compatible ? currencies[0] : null, currencies,
      fundingGroupIds: component.fundingGroups.map(row => row.id), paymentKind: "FUNDED",
      unitRevenue: compatible && prices.size === 1 ? [...prices][0] : null,
      chargeUnits: charged.length, scheduledTasks: 0,
      known: { revenue: ZERO, supplierCost: ZERO, paymentFees: ZERO, laborCost: ZERO },
      unknown: { revenue: 0, supplierCost: 0, paymentFees: 0, laborCost: 0 } };
    for (const occurrence of component.occurrences) {
      group.scheduledTasks = addCount(group.scheduledTasks, occurrence.scheduledTasks);
      for (const key of ["supplierCost", "laborCost"]) {
        const value = occurrence.economics?.[key] ?? (occurrence.scheduledTasks ? null : "0");
        if (value === null || !compatible) group.unknown[key]++; else group.known[key] = decimalAdd(group.known[key], computedDecimal(value, key));
      }
    }
    for (const funding of component.fundingGroups) for (const key of ["revenue", "paymentFees"]) {
      const value = funding.plannedPaymentRequests ? funding.economics?.[key] ?? null : "0";
      if (value === null || !compatible) group.unknown[key]++; else group.known[key] = decimalAdd(group.known[key], computedDecimal(value, key));
    }
    if (!compatible) {
      group.unknown.supplierCost++; group.unknown.laborCost++;
      finding("FUNDING_COST_CURRENCY", "Complete the named funding and delivery estimate currencies for " + group.label + ". Differing currencies remain separate and require an explicit priced basis before a combined service floor.", "servicePricing", group.id, "info");
    }
    groups.set(group.id, group);
  }

  return [...groups.values()].map(group => {
    const costsKnown = !["supplierCost", "paymentFees", "laborCost"].some(key => group.unknown[key]);
    const cost = costsKnown ? decimalAdd(decimalAdd(group.known.supplierCost, group.known.paymentFees), group.known.laborCost) : null;
    const revenue = group.unknown.revenue ? null : group.known.revenue;
    const units = { n: BigInt(group.chargeUnits), s: 0 };
    const breakEven = cost === null || !units.n ? null : decimalCeilingDivide(cost, units);
    const target = input.sensitivity.minimumMarginPct;
    const margin = target === null ? null : decimal(target, "Minimum margin");
    const targetShare = margin === null ? null : decimalSubtract(ONE, { n: margin.n, s: margin.s + 2 });
    const targetPrice = breakEven === null || targetShare === null ? null : decimalCeilingDivide(cost, decimalMultiply(units, targetShare));
    const shortfall = cost === null || revenue === null ? null : positive(decimalSubtract(cost, revenue));
    const status = cost === null ? "INCOMPLETE" : !units.n ? cost.n ? "NO_NEW_CHARGES" : "NO_COST" : shortfall?.n > 0n ? "BELOW_COST" : revenue === null ? "UNVALUED_REVENUE" : "COVERS_COST";
    if (status === "BELOW_COST" || status === "NO_NEW_CHARGES") finding("SERVICE_COST_UNCOVERED", group.label + " has " + (shortfall === null ? decimalText(cost) : decimalText(shortfall)) + " " + (group.currency || "") + " of modeled cost outside this window's new-charge revenue.", "servicePricing", group.id);
    return {
      id: group.id, label: group.label, scheduleIds: [...group.scheduleIds], currency: group.currency, paymentKind: group.paymentKind,
      scheduledTasks: group.scheduledTasks, chargeUnits: group.chargeUnits, unitRevenue: group.unitRevenue,
      totalCost: cost === null ? null : decimalText(cost), revenue: revenue === null ? null : decimalText(revenue),
      uncoveredCost: shortfall === null ? null : decimalText(shortfall), minimumMarginPct: target,
      breakEvenUnitRevenue: breakEven === null ? null : decimalText(breakEven), targetUnitRevenue: targetPrice === null ? null : decimalText(targetPrice),
      unitRevenueIncrease: group.unitRevenue === null || (targetPrice ?? breakEven) === null ? null : decimalText(positive(decimalSubtract(targetPrice ?? breakEven, decimal(group.unitRevenue, "Unit revenue")))),
      unknownRecordCounts: group.unknown, status,
      ...(group.fundingGroupIds ? { fundingGroupIds: group.fundingGroupIds, currencies: group.currencies } : {}),
      priceBasis: group.fundingGroupIds ?
        "Average currency value per new explicit funding group across the complete linked useful results. Shared result costs enter once; individual group prices remain separately editable. Ceiling rounded to 12 decimal places." :
        "Currency value per newly charged request or acquired prepaid pass over this complete selected service group; ceiling rounded to 12 decimal places."
    };
  });
}

export function evaluateCohortPlan(raw, options = {}) {
  const input = normalizeCohortPlan(raw);
  const sourceComparison = compareSource(input, options.nativeSeed);
  const { rule } = input, tranche = rule.target.tranche;
  const calendarDays = rule.target.proposed_window.consecutive_calendar_days;
  const windowEnd = dateAfter(input.windowStart, calendarDays - 1), endExclusive = dateEpoch(windowEnd) + DAY_MS;
  const asOfDay = new Date(clockEpoch(input.asOfAt)).toISOString().slice(0, 10);
  const expectedEnvironment = tranche === 2 ? "TESTNET" : "MAINNET";
  const buyersById = new Map(input.buyers.map(x => [x.id, x])), merchantsById = new Map(input.merchants.map(x => [x.id, x]));
  const facilitatorsById = new Map(input.facilitators.map(x => [x.id, x])), operationsById = new Map(input.operations.map(x => [x.id, x]));
  const globalExclusions = new Map(input.calendar.excludedDates.map(x => [x.date, x.label]));
  const findings = [], findingKeys = new Set();
  function finding(code, message, scope = "plan", ref = null, severity = "warning") {
    const key = canonical([code, scope, ref, message]);
    if (!findingKeys.has(key)) { findingKeys.add(key); findings.push({ code, severity, scope, id: ref, message }); }
  }
  for (const row of sourceComparison.fields) if (!row.match)
    finding("COHORT_PLAN_SOURCE_CHANGED", "This plan retains " + row.key + " " + row.planned + "; the supplied current case has " + row.current + ". Review the selected source before a new edition.", "source", row.key);
  if (sourceComparison.ruleMatches === false)
    finding("COHORT_PLAN_RULE_CHANGED", "The supplied current case has a different original deployment rule. This report uses the complete rule retained by this plan.", "rule");
  if (!input.schedules.length) finding("SCHEDULES_EMPTY", "Add the customer's useful operations and normal operating calendar.");
  for (const [kind, values] of [["buyer", input.buyers], ["merchant", input.merchants], ["facilitator", input.facilitators]]) {
    const seen = new Map();
    for (const value of values) {
      if (!value.operatorId.trim()) finding("OPERATOR_UNSPECIFIED", "Enter the accountable " + kind + " operator for independence planning.", kind, value.id);
      else if (seen.has(value.operatorId)) finding("SHARED_OPERATOR", "These " + kind + " entries share one accountable operator and count once.", kind, value.operatorId, "info");
      else seen.set(value.operatorId, value.id);
    }
  }
  const days = [];
  for (let index = 0; index < calendarDays; index++) {
    const date = dateAfter(input.windowStart, index), weekday = new Date(dateEpoch(date)).getUTCDay() || 7;
    days.push({
      date, weekday, isWorkingDay: input.calendar.weekdays.includes(weekday) && !globalExclusions.has(date),
      exclusionLabels: globalExclusions.has(date) ? [globalExclusions.get(date) || "Calendar exclusion"] : [],
      asOfPosition: date < asOfDay ? "PAST" : date === asOfDay ? "AS_OF_DAY" : "FUTURE", ...makeMetrics()
    });
  }
  const dayMap = new Map(days.map(x => [x.date, x])), prepared = [], excluded = [];
  for (const schedule of input.schedules) {
    const ownExclusions = new Map(schedule.excludedDates.map(x => [x.date, x.label]));
    const allocated = new Map((schedule.dateAllocations || []).map(row => [row.sourceDate, row.date])), usedAllocations = new Set();
    if (!schedule.economics) finding("ECONOMICS_UNSPECIFIED", "Add this schedule's explicit revenue, supplier cost, payment fee and effort assumptions to compare its contribution.", "schedule", schedule.id, "info");
    if (!["UNPAID", "FUNDED"].includes(schedule.payment.kind) && schedule.payment.atomicUnitPrice === "0")
      finding("ZERO_PAYMENT_PRICE", "A zero atomic price contributes tasks and payment requests, with zero paid purchase opportunities.", "schedule", schedule.id);
    for (const sourceDay of days) {
      let dateRow = sourceDay;
      if (!cadenceMatches(schedule.cadence, dateRow.date, dateRow.weekday)) continue;
      const reasons = [];
      if (!input.calendar.weekdays.includes(dateRow.weekday)) reasons.push("Closed calendar weekday");
      if (globalExclusions.has(dateRow.date)) reasons.push(globalExclusions.get(dateRow.date) || "Calendar exclusion");
      if (ownExclusions.has(dateRow.date)) reasons.push(ownExclusions.get(dateRow.date) || "Schedule exclusion");
      if (reasons.length) { excluded.push({ scheduleId: schedule.id, date: dateRow.date, reasons }); continue; }
      if (allocated.has(sourceDay.date)) {
        const selected = allocated.get(sourceDay.date);
        dateRow = dayMap.get(selected);
        if (!dateRow) fail("ALLOCATION_OUTSIDE_WINDOW", "Keep allocated work inside its original complete rule window.", "schedules." + schedule.id);
        if (!dateRow.isWorkingDay || ownExclusions.has(selected))
          fail("ALLOCATION_CLOSED_DATE", "Allocated date " + selected + " is closed by the plan or service calendar.", "schedules." + schedule.id);
        usedAllocations.add(sourceDay.date);
      }
      if (prepared.length >= MAX_DAILY_ROWS) fail("PLAN_TOO_LARGE", "The selected plan exceeds " + MAX_DAILY_ROWS + " schedule-date rows. Keep the complete selected cohort in a smaller set of aggregate schedules.", "schedules");
      const scheduledAt = dateRow.date + "T" + schedule.timeUtc + ":00.000Z";
      const completeEpoch = Date.parse(scheduledAt) + schedule.deliveryDelayMinutes * 60000;
      if (!Number.isFinite(completeEpoch) || new Date(completeEpoch).toISOString().length > 24)
        fail("INVALID_PLAN_CLOCK", "The planned completion exceeds the supported calendar.", "schedules." + schedule.id);
      prepared.push({ schedule, dateRow, sourceDay, allocated: allocated.has(sourceDay.date),
        scheduledAt, plannedCompleteAt: new Date(completeEpoch).toISOString(), completeEpoch });
    }
    if (usedAllocations.size !== allocated.size)
      fail("ALLOCATION_SOURCE_MISSING", "Every date allocation must name an active occurrence in the retained original cadence and calendar.", "schedules." + schedule.id);
  }
  prepared.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt) || a.schedule.id.localeCompare(b.schedule.id) || a.sourceDay.date.localeCompare(b.sourceDay.date));
  const passGroups = new Map(), occurrences = [], summary = makeMetrics(), assetMap = new Map(), currencyMap = new Map();
  const explicitFundingUses = new Map(input.fundingGroups.map(row => [row.id, []])), fundingGroups = [];
  const buyerGroups = new Map(), merchantGroups = new Map(), operationGroups = new Map(), facilitatorGroups = new Map(), seenSlots = new Map();
  function group(map, key, seed) { if (!map.has(key)) map.set(key, { ...seed, ...makeMetrics() }); return map.get(key); }
  for (const preparedRow of prepared) {
    const { schedule, dateRow, sourceDay, scheduledAt, plannedCompleteAt, completeEpoch } = preparedRow;
    const operation = operationsById.get(schedule.operationId), buyer = buyersById.get(schedule.buyerId), merchant = merchantsById.get(operation.merchantId);
    const facilitator = facilitatorsById.get(schedule.facilitatorId), terms = schedule.payment;
    const requests = multiplyCount(schedule.tasksPerDate, schedule.requestsPerTask, "Scheduled requests");
    let paymentRequests = terms.kind === "PER_REQUEST" ? requests : 0, allowance = null;
    if (terms.kind === "PREPAID") {
      const groupId = terms.passGroupId ? "shared:" + terms.passGroupId : "schedule:" + schedule.id;
      const signature = canonical({ buyerId: buyer.id, merchantId: merchant.id, network: terms.network, asset: terms.asset,
        atomicUnitPrice: terms.atomicUnitPrice, passCapacity: terms.passCapacity, openingUnits: terms.openingUnits,
        unitRevenue: schedule.economics?.unitRevenue ?? null, feePerPayment: schedule.economics?.feePerPayment ?? null, currency: schedule.economics?.currency ?? null });
      if (!passGroups.has(groupId)) passGroups.set(groupId, {
        id: groupId, signature, buyerId: buyer.id, merchantId: merchant.id, network: terms.network, asset: terms.asset,
        passCapacity: terms.passCapacity, openingUnits: terms.openingUnits, remainingActiveUnits: terms.openingUnits,
        retainedUnusedPreviousUnits: 0, consumedUnits: 0, plannedNewPasses: 0, scheduleIds: new Set()
      });
      const pass = passGroups.get(groupId);
      if (pass.signature !== signature) fail("PREPAID_TERMS_CONFLICT", "Schedules sharing " + groupId + " must retain the same buyer, merchant, allowance and acquisition-price assumptions.", "schedules." + schedule.id);
      pass.scheduleIds.add(schedule.id);
      const before = pass.remainingActiveUnits, unitDemand = terms.allowanceUnitsPerRequest;
      const currentRequests = Math.min(requests, Math.floor(before / unitDemand));
      let remaining = requests - currentRequests, balance = before - currentRequests * unitDemand, unused = 0;
      if (remaining > 0) {
        const perPass = Math.floor(terms.passCapacity / unitDemand);
        paymentRequests = Math.floor((remaining - 1) / perPass) + 1;
        unused = addCount(balance, multiplyCount(paymentRequests - 1, terms.passCapacity - perPass * unitDemand));
        const lastRequests = remaining - (paymentRequests - 1) * perPass;
        balance = terms.passCapacity - lastRequests * unitDemand;
      }
      const consumed = multiplyCount(requests, unitDemand, "Consumed allowance units");
      pass.remainingActiveUnits = balance;
      pass.retainedUnusedPreviousUnits = addCount(pass.retainedUnusedPreviousUnits, unused);
      pass.consumedUnits = addCount(pass.consumedUnits, consumed);
      pass.plannedNewPasses = addCount(pass.plannedNewPasses, paymentRequests);
      allowance = { groupId, openingActiveUnits: before, consumedUnits: consumed, plannedNewPasses: paymentRequests, retainedUnusedPreviousUnits: unused, remainingActiveUnits: balance };
    }
    const withinWindow = completeEpoch < endExclusive;
    const paid = !["UNPAID", "FUNDED"].includes(terms.kind) && BigInt(terms.atomicUnitPrice) > 0n ? paymentRequests : 0;
    const gaps = [];
    if (!isExternal(buyer, expectedEnvironment)) gaps.push("BUYER_OPERATOR_OR_ENVIRONMENT");
    if (!isExternal(merchant, expectedEnvironment)) gaps.push("MERCHANT_OPERATOR_OR_ENVIRONMENT");
    if (!operation.scope.trim() || !operation.expectedOutput.trim()) gaps.push("USEFUL_TASK_DEFINITION");
    if (!withinWindow) gaps.push("COMPLETION_AFTER_WINDOW");
    const potential = !gaps.length ? paid : 0;
    if (gaps.includes("USEFUL_TASK_DEFINITION")) finding("USEFUL_TASK_UNSPECIFIED", "Describe the selected scope and complete useful output for this operation.", "operation", operation.id);
    if (!withinWindow && requests) finding("COMPLETION_AFTER_WINDOW", "This schedule's planned useful output completes after the original cohort window.", "schedule", schedule.id);
    if (buyer.operatorId && buyer.operatorId === merchant.operatorId)
      finding("BUYER_MERCHANT_SHARED_OPERATOR", "The planned buyer and merchant share one operator. Review their real relationship and intended useful task.", "schedule", schedule.id);
    const slot = canonical([buyer.operatorId || buyer.id, operation.id, scheduledAt]);
    if (schedule.tasksPerDate && seenSlots.has(slot))
      finding("OVERLAPPING_TASK_SLOT", "This buyer and operation also appear at the same planned time in schedule " + seenSlots.get(slot) + ". Review the separate useful task before retaining both schedules.", "schedule", schedule.id);
    if (schedule.tasksPerDate) seenSlots.set(slot, schedule.id);
    const row = {
      id: schedule.id + ":" + sourceDay.date, scheduleId: schedule.id, label: schedule.label || operation.label,
      ...(preparedRow.allocated ? { sourceDate: sourceDay.date, originalScheduledAt: sourceDay.date + "T" + schedule.timeUtc + ":00.000Z" } : {}),
      operationId: operation.id, buyerId: buyer.id, merchantId: merchant.id, facilitatorId: facilitator?.id ?? null,
      buyerOperatorId: buyer.operatorId, merchantOperatorId: merchant.operatorId, facilitatorOperatorId: facilitator?.operatorId ?? null,
      date: dateRow.date, scheduledAt, plannedCompleteAt, completionDate: plannedCompleteAt.slice(0, 10), withinWindow,
      asOfPosition: dateRow.asOfPosition, paymentKind: terms.kind, network: terms.network, asset: terms.asset,
      scheduledTasks: schedule.tasksPerDate, scheduledRequests: requests, plannedPaymentRequests: paymentRequests,
      plannedPaidPurchases: paid, plannedCompleteTasks: withinWindow ? schedule.tasksPerDate : 0,
      plannedCompletePurchases: withinWindow ? paid : 0, independentPurchaseOpportunities: potential,
      allowanceUnits: allowance?.consumedUnits ?? 0, allowance, qualificationGaps: gaps,
      atomicAmount: (BigInt(terms.atomicUnitPrice ?? "0") * BigInt(paymentRequests)).toString()
    };
    row.economics = moneyForOccurrence(row, schedule.economics);
    if (terms.kind === "FUNDED") {
      row.fundingGroupIds = [...schedule.fundingGroupIds];
      if (row.scheduledTasks) for (const id of schedule.fundingGroupIds) explicitFundingUses.get(id).push(row);
    }
    occurrences.push(row); sumMetrics(summary, row); sumMetrics(dateRow, row);
    if (!["UNPAID", "FUNDED"].includes(terms.kind)) {
      const key = canonical([terms.network, terms.asset]);
      if (!assetMap.has(key)) assetMap.set(key, { network: terms.network, asset: terms.asset, atomicAmount: 0n, plannedPaymentRequests: 0, plannedPaidPurchases: 0 });
      const asset = assetMap.get(key); asset.atomicAmount += BigInt(row.atomicAmount);
      asset.plannedPaymentRequests = addCount(asset.plannedPaymentRequests, paymentRequests);
      asset.plannedPaidPurchases = addCount(asset.plannedPaidPurchases, paid);
    }
    if (row.economics) {
      const currency = row.economics.currency;
      if (!currencyMap.has(currency)) currencyMap.set(currency, { currency, records: 0, known: Object.fromEntries(["revenue", "supplierCost", "paymentFees", "activeHours", "laborCost"].map(k => [k, ZERO])), unknown: { revenue: 0, supplierCost: 0, paymentFees: 0, activeHours: 0, laborCost: 0 } });
      sumMoney(currencyMap.get(currency), row.economics);
    }
    const buyerKey = buyer.operatorId.trim() ? buyer.operatorId : "unassigned:" + buyer.id;
    const buyerGroup = group(buyerGroups, buyerKey, { operatorId: buyer.operatorId || null, label: buyer.label, buyerIds: new Set(), completionDates: new Set() });
    buyerGroup.buyerIds.add(buyer.id); sumMetrics(buyerGroup, row);
    if (potential) buyerGroup.completionDates.add(row.completionDate);
    const merchantKey = merchant.operatorId.trim() ? merchant.operatorId : "unassigned:" + merchant.id;
    const merchantGroup = group(merchantGroups, merchantKey, { operatorId: merchant.operatorId || null, label: merchant.label, merchantIds: new Set(), buyerOperatorIds: new Set() });
    merchantGroup.merchantIds.add(merchant.id); sumMetrics(merchantGroup, row);
    if (potential) merchantGroup.buyerOperatorIds.add(buyer.operatorId);
    const operationGroup = group(operationGroups, operation.id, { id: operation.id, label: operation.label, merchantId: merchant.id, facilitatorOperatorIds: new Set(), buyerOperatorIds: new Set() });
    sumMetrics(operationGroup, row);
    if (potential) {
      operationGroup.buyerOperatorIds.add(buyer.operatorId);
      if (facilitator && isExternal(facilitator)) operationGroup.facilitatorOperatorIds.add(facilitator.operatorId);
    }
    if (facilitator) {
      const facilitatorKey = facilitator.operatorId.trim() ? facilitator.operatorId : "unassigned:" + facilitator.id;
      const facilitatorGroup = group(facilitatorGroups, facilitatorKey, { operatorId: facilitator.operatorId || null, label: facilitator.label, serviceIds: new Set(), operationIds: new Set() });
      facilitatorGroup.serviceIds.add(facilitator.id); sumMetrics(facilitatorGroup, row);
      if (potential && isExternal(facilitator)) facilitatorGroup.operationIds.add(operation.id);
    }
  }

  // A saved settlement is a separate commercial unit. Its useful results carry
  // workload only; this pass contributes the funding once, at its first result.
  for (const funding of input.fundingGroups) {
    const uses = explicitFundingUses.get(funding.id);
    if (uses.some(row => row.date < funding.date))
      fail("FUNDING_AFTER_USE", "Funding " + funding.id + " is later than one of its selected useful tasks.", "fundingGroups." + funding.id);
    const first = uses.slice().sort((a, b) => a.plannedCompleteAt.localeCompare(b.plannedCompleteAt) || a.id.localeCompare(b.id))[0] ?? null;
    const operation = operationsById.get(funding.operationId), buyer = buyersById.get(funding.buyerId), merchant = merchantsById.get(operation.merchantId);
    const facilitator = facilitatorsById.get(funding.facilitatorId);
    const newCharge = first && funding.date >= input.windowStart && funding.date <= windowEnd ? 1 : 0;
    const zeroPrice = funding.atomicUnitPrice === "0";
    const priced = funding.atomicUnitPrice !== null && funding.network.trim() && funding.asset.trim();
    const paid = newCharge && priced && !zeroPrice ? 1 : 0;
    const unpriced = newCharge && !zeroPrice && !priced ? 1 : 0;
    const gaps = [];
    if (!isExternal(buyer, expectedEnvironment)) gaps.push("BUYER_OPERATOR_OR_ENVIRONMENT");
    if (!isExternal(merchant, expectedEnvironment)) gaps.push("MERCHANT_OPERATOR_OR_ENVIRONMENT");
    if (!operation.scope.trim() || !operation.expectedOutput.trim() || first?.qualificationGaps.includes("USEFUL_TASK_DEFINITION")) gaps.push("USEFUL_TASK_DEFINITION");
    if (first && !first.withinWindow) gaps.push("COMPLETION_AFTER_WINDOW");
    const potential = first && !gaps.length ? paid : 0;
    const metrics = { ...makeMetrics(), plannedPaymentRequests: newCharge, plannedPaidPurchases: paid,
      plannedCompletePurchases: first?.withinWindow ? paid : 0, independentPurchaseOpportunities: potential };
    const row = { ...clone(funding), ...metrics, merchantId: merchant.id, buyerOperatorId: buyer.operatorId,
      merchantOperatorId: merchant.operatorId, facilitatorOperatorId: facilitator?.operatorId ?? null,
      scheduleIds: [...new Set(uses.map(use => use.scheduleId))].sort(), useOccurrenceIds: uses.map(use => use.id),
      scheduledTasks: uses.reduce((count, use) => addCount(count, use.scheduledTasks), 0),
      firstUsefulResultAt: first?.plannedCompleteAt ?? null, firstUsefulResultDate: first?.completionDate ?? null,
      firstUseOccurrenceId: first?.id ?? null, withinWindow: first?.withinWindow ?? null,
      unpricedPaymentRequests: unpriced, unpricedIndependentOpportunities: first && !gaps.length ? unpriced : 0,
      qualificationGaps: gaps, atomicAmount: !newCharge ? "0" : funding.atomicUnitPrice,
      status: !first ? "UNUSED" : !newCharge ? "EXISTING_FUNDING" : unpriced ? "UNPRICED" : zeroPrice ? "ZERO_PRICE" : "PLANNED",
      sourceEconomics: clone(funding.economics) };
    if (unpriced) finding("FUNDING_PRICE_UNSPECIFIED", funding.label + " is one planned settlement with commercial terms still unpriced. Enter its original asset, network and atomic price in Funding groups.", "fundingGroups", funding.id);
    if (!first) finding("FUNDING_WITHOUT_USE", funding.label + " has no active useful result in the selected calendar and contributes no new payment.", "fundingGroups", funding.id, "info");
    if (first && !first.withinWindow) finding("COMPLETION_AFTER_WINDOW", funding.label + "'s first whole useful result completes after the original cohort window.", "fundingGroups", funding.id);
    if (newCharge && !funding.economics) finding("FUNDING_ECONOMICS_UNSPECIFIED", funding.label + " has no currency revenue or payment-fee estimate.", "fundingGroups", funding.id, "info");
    row.economics = funding.economics ? moneyForOccurrence({ ...makeMetrics(), plannedPaymentRequests: newCharge },
      { ...funding.economics, unitCost: "0", activeHoursPerTask: "0", hourlyCost: "0" }) : null;
    fundingGroups.push(row);
    sumMetrics(summary, metrics);
    if (first) sumMetrics(dayMap.get(first.date), metrics);
    if (funding.network.trim() && funding.asset.trim() && newCharge) {
      const key = canonical([funding.network, funding.asset]);
      if (!assetMap.has(key)) assetMap.set(key, { network: funding.network, asset: funding.asset, atomicAmount: 0n, plannedPaymentRequests: 0, plannedPaidPurchases: 0 });
      const asset = assetMap.get(key); asset.atomicAmount += BigInt(funding.atomicUnitPrice ?? "0");
      asset.plannedPaymentRequests = addCount(asset.plannedPaymentRequests, newCharge); asset.plannedPaidPurchases = addCount(asset.plannedPaidPurchases, paid);
      if (funding.atomicUnitPrice === null) asset.unpricedPaymentRequests = addCount(asset.unpricedPaymentRequests ?? 0, 1);
    }
    if (row.economics) {
      const currency = row.economics.currency;
      if (!currencyMap.has(currency)) currencyMap.set(currency, { currency, records: 0, known: Object.fromEntries(["revenue", "supplierCost", "paymentFees", "activeHours", "laborCost"].map(k => [k, ZERO])), unknown: { revenue: 0, supplierCost: 0, paymentFees: 0, activeHours: 0, laborCost: 0 } });
      sumMoney(currencyMap.get(currency), row.economics);
    }
    if (newCharge && !funding.economics) for (const currency of new Set(uses.map(use => use.economics?.currency).filter(Boolean))) {
      const amounts = currencyMap.get(currency);
      amounts.unallocatedFundingIds ??= new Set(); amounts.unallocatedFundingIds.add(funding.id);
    }
    if (funding.economics) {
      const amounts = currencyMap.get(funding.economics.currency);
      amounts.unallocatedDeliveryIds ??= new Set();
      for (const use of uses) if (use.scheduledTasks && !use.economics) amounts.unallocatedDeliveryIds.add(use.id);
    }
    if (!first) continue;
    const buyerKey = buyer.operatorId.trim() ? buyer.operatorId : "unassigned:" + buyer.id;
    const buyerGroup = group(buyerGroups, buyerKey, { operatorId: buyer.operatorId || null, label: buyer.label, buyerIds: new Set(), completionDates: new Set() });
    buyerGroup.buyerIds.add(buyer.id); sumMetrics(buyerGroup, metrics); if (potential) buyerGroup.completionDates.add(first.completionDate);
    const merchantKey = merchant.operatorId.trim() ? merchant.operatorId : "unassigned:" + merchant.id;
    const merchantGroup = group(merchantGroups, merchantKey, { operatorId: merchant.operatorId || null, label: merchant.label, merchantIds: new Set(), buyerOperatorIds: new Set() });
    merchantGroup.merchantIds.add(merchant.id); sumMetrics(merchantGroup, metrics); if (potential) merchantGroup.buyerOperatorIds.add(buyer.operatorId);
    const operationGroup = group(operationGroups, operation.id, { id: operation.id, label: operation.label, merchantId: merchant.id, facilitatorOperatorIds: new Set(), buyerOperatorIds: new Set() });
    sumMetrics(operationGroup, metrics);
    if (potential) {
      operationGroup.buyerOperatorIds.add(buyer.operatorId);
      if (facilitator && isExternal(facilitator)) operationGroup.facilitatorOperatorIds.add(facilitator.operatorId);
    }
    if (facilitator) {
      const facilitatorKey = facilitator.operatorId.trim() ? facilitator.operatorId : "unassigned:" + facilitator.id;
      const facilitatorGroup = group(facilitatorGroups, facilitatorKey, { operatorId: facilitator.operatorId || null, label: facilitator.label, serviceIds: new Set(), operationIds: new Set() });
      facilitatorGroup.serviceIds.add(facilitator.id); sumMetrics(facilitatorGroup, metrics);
      if (potential && isExternal(facilitator)) facilitatorGroup.operationIds.add(operation.id);
    }
  }

  const buyerRows = [...buyerGroups.values()].map(row => ({ ...row, buyerIds: [...row.buyerIds].sort(), completionDates: [...row.completionDates].sort(),
    returningPotential: row.independentPurchaseOpportunities >= 2 && row.completionDates.size >= 2 }));
  const merchantRows = [...merchantGroups.values()].map(row => ({ ...row, merchantIds: [...row.merchantIds].sort(), buyerOperatorIds: [...row.buyerOperatorIds].sort() }));
  const operationRows = [...operationGroups.values()].map(row => ({ ...row, facilitatorOperatorIds: [...row.facilitatorOperatorIds].sort(), buyerOperatorIds: [...row.buyerOperatorIds].sort(), independentFacilitatorCount: row.facilitatorOperatorIds.size }));
  const facilitatorRows = [...facilitatorGroups.values()].map(row => ({ ...row, serviceIds: [...row.serviceIds].sort(), operationIds: [...row.operationIds].sort() }));
  summary.independentBuyerOperators = buyerRows.filter(x => x.independentPurchaseOpportunities > 0).length;
  summary.independentMerchantOperators = merchantRows.filter(x => x.independentPurchaseOpportunities > 0).length;
  summary.returningBuyerOperators = buyerRows.filter(x => x.returningPotential).length;
  summary.sameOperationFacilitatorOperators = Math.max(0, ...operationRows.map(x => x.independentFacilitatorCount));
  summary.excludedScheduleDates = excluded.length;
  summary.completionOutsideWindow = [...occurrences, ...fundingGroups].filter(x => x.withinWindow === false).reduce((sum, x) => addCount(sum, x.plannedPaidPurchases), 0);
  summary.elapsedScheduledDates = new Set(occurrences.filter(x => x.asOfPosition === "PAST" && x.scheduledTasks).map(x => x.date)).size;
  const availableTargets = {
    external_buyer_operators: summary.independentBuyerOperators,
    completed_testnet_purchases: tranche === 2 ? summary.independentPurchaseOpportunities : 0,
    completed_mainnet_purchases: tranche === 3 ? summary.independentPurchaseOpportunities : 0,
    same_operation_facilitator_operators: summary.sameOperationFacilitatorOperators,
    external_mainnet_merchant_operators: tranche === 3 ? summary.independentMerchantOperators : 0,
    repeat_external_buyer_operators: summary.returningBuyerOperators
  };

  const unpriced = fundingGroups.filter(row => row.unpricedIndependentOpportunities > 0);
  const maximumBuyers = new Set(buyerRows.filter(row => row.independentPurchaseOpportunities > 0).map(row => row.operatorId));
  const maximumMerchants = new Set(merchantRows.filter(row => row.independentPurchaseOpportunities > 0).map(row => row.operatorId));
  const maximumReturns = new Map(buyerRows.map(row => [row.operatorId, { count: row.independentPurchaseOpportunities, dates: new Set(row.completionDates) }]));
  const maximumFacilitators = new Map(operationRows.map(row => [row.id, new Set(row.facilitatorOperatorIds)]));
  for (const row of unpriced) {
    maximumBuyers.add(row.buyerOperatorId); maximumMerchants.add(row.merchantOperatorId);
    if (!maximumReturns.has(row.buyerOperatorId)) maximumReturns.set(row.buyerOperatorId, { count: 0, dates: new Set() });
    const buyer = maximumReturns.get(row.buyerOperatorId); buyer.count++; buyer.dates.add(row.firstUsefulResultDate);
    if (!maximumFacilitators.has(row.operationId)) maximumFacilitators.set(row.operationId, new Set());
    if (row.facilitatorId && isExternal(facilitatorsById.get(row.facilitatorId))) maximumFacilitators.get(row.operationId).add(row.facilitatorOperatorId);
  }
  const unpricedAdditional = {
    external_buyer_operators: maximumBuyers.size - summary.independentBuyerOperators,
    completed_testnet_purchases: tranche === 2 ? unpriced.length : 0,
    completed_mainnet_purchases: tranche === 3 ? unpriced.length : 0,
    same_operation_facilitator_operators: Math.max(0, ...[...maximumFacilitators.values()].map(values => values.size)) - summary.sameOperationFacilitatorOperators,
    external_mainnet_merchant_operators: tranche === 3 ? maximumMerchants.size - summary.independentMerchantOperators : 0,
    repeat_external_buyer_operators: [...maximumReturns.values()].filter(row => row.count >= 2 && row.dates.size >= 2).length - summary.returningBuyerOperators
  };
  if (fundingGroups.length) {
    summary.unpricedPaymentRequests = fundingGroups.reduce((total, row) => addCount(total, row.unpricedPaymentRequests), 0);
    summary.unpricedIndependentOpportunities = unpriced.length;
  }

  const targets = Object.entries(rule.target.target_counts).map(([key, expected]) => {
    const planned = Object.prototype.hasOwnProperty.call(availableTargets, key) ? availableTargets[key] : null;
    const additional = unpricedAdditional[key] ?? 0;
    const status = planned === null ? "OUTSIDE_SCHEDULE_SCOPE" : planned >= expected ? "PLANNED_CAPACITY" : planned + additional >= expected ? "PRICE_UNSPECIFIED" : "SHORTFALL";
    if (status === "SHORTFALL") finding("PLANNED_TARGET_SHORTFALL", key + " needs " + expected + "; the selected normal-use calendar provides " + planned + " planned opportunities.", "target", key);
    return { key, expected, planned, gap: planned === null || status === "PRICE_UNSPECIFIED" ? null : Math.max(0, expected - planned), status,
      ...(additional ? { unpricedAdditional: additional } : {}) };
  });
  const purchaseKey = tranche === 2 ? "completed_testnet_purchases" : "completed_mainnet_purchases";
  const purchaseTarget = rule.target.target_counts[purchaseKey] ?? null;
  const completionSensitivity = input.sensitivity.completionSharesPct.map(share => {
    const pct = decimal(share, "completion share");
    const numerator = BigInt(summary.independentPurchaseOpportunities) * pct.n;
    const denominator = power(pct.s) * 100n;
    const potential = Number(numerator / denominator);
    const required = purchaseTarget === null || pct.n === 0n ? null :
      Number((BigInt(purchaseTarget) * denominator + pct.n - 1n) / pct.n);
    return { completionSharePct: share, baseOpportunities: summary.independentPurchaseOpportunities,
      potentialCompletedWholePurchases: potential, purchaseTarget,
      requiredOpportunities: required === null ? null : integer(required, "Required opportunities"),
      shortfall: purchaseTarget === null ? null : Math.max(0, purchaseTarget - potential) };
  });
  for (const amounts of currencyMap.values()) {
    const fundingUnknown = amounts.unallocatedFundingIds?.size ?? 0, deliveryUnknown = amounts.unallocatedDeliveryIds?.size ?? 0;
    amounts.records += fundingUnknown + deliveryUnknown;
    amounts.unknown.revenue += fundingUnknown; amounts.unknown.paymentFees += fundingUnknown;
    amounts.unknown.supplierCost += deliveryUnknown; amounts.unknown.activeHours += deliveryUnknown; amounts.unknown.laborCost += deliveryUnknown;
  }
  const currencies = [...currencyMap.values()].map(amounts => ({ ...finishMoney(amounts),
    ...(amounts.unallocatedFundingIds?.size ? { unallocatedFundingIds: [...amounts.unallocatedFundingIds].sort() } : {}),
    ...(amounts.unallocatedDeliveryIds?.size ? { unallocatedDeliveryIds: [...amounts.unallocatedDeliveryIds].sort() } : {})
  })).sort((a, b) => a.currency.localeCompare(b.currency));
  const effortSensitivity = [];
  for (const currency of currencies) for (const increase of input.sensitivity.effortIncreasesPct) {
    const pct = decimal(increase, "effort increase"), factor = decimalAdd(ONE, { n: pct.n, s: pct.s + 2 });
    const adjustedLabor = currency.laborCost === null ? null : decimalMultiply(computedDecimal(currency.laborCost, "laborCost"), factor);
    const totalCost = adjustedLabor === null || currency.supplierCost === null || currency.paymentFees === null ? null :
      decimalAdd(decimalAdd(computedDecimal(currency.supplierCost, "supplierCost"), computedDecimal(currency.paymentFees, "paymentFees")), adjustedLabor);
    const contribution = totalCost === null || currency.revenue === null ? null : decimalSubtract(computedDecimal(currency.revenue, "revenue"), totalCost);
    effortSensitivity.push({ currency: currency.currency, effortIncreasePct: increase,
      activeHours: currency.activeHours === null ? null : decimalText(decimalMultiply(computedDecimal(currency.activeHours, "activeHours"), factor)),
      laborCost: adjustedLabor === null ? null : decimalText(adjustedLabor), totalCost: totalCost === null ? null : decimalText(totalCost),
      contribution: contribution === null ? null : decimalText(contribution) });
  }
  const capacity = planDeliveryCapacity(input, days, occurrences, finding);
  const servicePricing = planServicePricing(input, occurrences, finding, fundingGroups);
  const result = {
    capacity, servicePricing, fundingGroups,
    schema: COHORT_PLAN_REPORT_SCHEMA, kind: "PLAN", source: clone(input.source), rule: clone(rule), input, sourceComparison,
    window: { start: input.windowStart, end: windowEnd, calendarDays, requiredCalendarDays: calendarDays, tranche, expectedEnvironment, asOfAt: input.asOfAt, asOfDay },
    summary, days, occurrences, excluded, buyers: buyerRows, merchants: merchantRows, operations: operationRows, facilitators: facilitatorRows,
    targets, currencies, assets: [...assetMap.values()].map(x => ({ ...x, atomicAmount: x.unpricedPaymentRequests ? null : x.atomicAmount.toString(), ...(x.unpricedPaymentRequests ? { knownAtomicAmount: x.atomicAmount.toString() } : {}) })),
    passGroups: [...passGroups.values()].map(({ signature, ...row }) => ({ ...row, scheduleIds: [...row.scheduleIds].sort() })),
    workshares: input.workshares.map(x => workshareResult(x, input.sensitivity.effortIncreasesPct)),
    sensitivity: { completion: completionSensitivity, effort: effortSensitivity }, findings
  };
  return result;
}
function csvCell(raw) {
  if (raw === null || raw === undefined) return "";
  let value = String(raw);
  if (/^\s*[=+@]/.test(value) || /^[\t\r\n]/.test(value) || (/^\s*-/.test(value) && !/^-?\d+(?:\.\d+)?$/.test(value))) value = "'" + value;
  return /[",\r\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
}
export function exportCohortPlanCsv(report) {
  if (!report || report.schema !== COHORT_PLAN_REPORT_SCHEMA || report.kind !== "PLAN")
    fail("INVALID_PLAN_REPORT", "Export a complete cohort planning report.", "report");
  const output = [["rowType", "id", "date", "metric", "value", "currency", "network", "asset", "detail"]];
  const add = (type, ref, date, metric, value, detail = "", currency = "", network = "", asset = "") =>
    output.push([type, ref, date, metric, value, currency, network, asset, detail]);
  add("PLAN", report.input.draftId, "", "name", report.input.name, JSON.stringify(report.source));
  add("PLAN", report.input.draftId, "", "sourceComparison", report.sourceComparison.status, JSON.stringify(report.sourceComparison.fields));
  if (report.input.deliveryScheduling) add("SCHEDULING", report.input.draftId, "", "constraints", report.input.deliveryScheduling.strategy, JSON.stringify(report.input.deliveryScheduling));
  for (const [key, value] of Object.entries(report.summary)) add("SUMMARY", report.source.programId, "", key, value);
  for (const row of report.targets) add("TARGET", row.key, "", "planned", row.planned, JSON.stringify({ expected: row.expected, gap: row.gap, status: row.status, ...(row.unpricedAdditional ? { unpricedAdditional: row.unpricedAdditional } : {}) }));
  for (const row of report.days) for (const key of Object.keys(makeMetrics())) add("DAY", "", row.date, key, row[key], row.asOfPosition);
  for (const row of report.occurrences) {
    if (row.sourceDate) add("DATE_ALLOCATION", row.id, row.date, "sourceDate", row.sourceDate, row.originalScheduledAt);
    for (const key of Object.keys(makeMetrics())) add("SCHEDULE_DATE", row.scheduleId, row.date, key, row[key], row.operationId);
    add("SCHEDULE_DATE", row.scheduleId, row.date, "plannedCompleteAt", row.plannedCompleteAt, row.qualificationGaps.join("; "));
    add("SCHEDULE_DATE", row.scheduleId, row.date, "atomicAmount", row.atomicAmount, row.paymentKind, "", row.network, row.asset);
    if (row.economics) for (const [key, value] of Object.entries(row.economics)) if (key !== "currency") add("SCHEDULE_ECONOMICS", row.scheduleId, row.date, key, value, "", row.economics.currency);
  }
  for (const [kind, rows] of [["BUYER", report.buyers], ["MERCHANT", report.merchants], ["OPERATION", report.operations], ["FACILITATOR", report.facilitators]])
    for (const row of rows) {
      const ref = row.operatorId || row.id || row.label;
      for (const key of Object.keys(makeMetrics())) add(kind, ref, "", key, row[key]);
      for (const key of ["buyerIds", "merchantIds", "serviceIds", "operationIds", "completionDates", "buyerOperatorIds", "facilitatorOperatorIds", "returningPotential", "independentFacilitatorCount"])
        if (row[key] !== undefined) add(kind, ref, "", key, Array.isArray(row[key]) ? JSON.stringify(row[key]) : row[key]);
    }
  for (const row of report.excluded) add("EXCLUDED_DATE", row.scheduleId, row.date, "excluded", true, row.reasons.join("; "));
  for (const row of report.assets) add("ASSET", "", "", "atomicAmount", row.atomicAmount, "", "", row.network, row.asset);
  for (const row of report.currencies) for (const key of ["revenue", "supplierCost", "paymentFees", "activeHours", "laborCost", "totalCost", "contribution", "marginPercent"])
    add("CURRENCY", "", "", key, row[key], JSON.stringify(row.unknownRecordCounts), row.currency);
  for (const row of report.workshares) for (const item of row.cases)
    add("WORKSHARE", row.id, "", "contribution", item.contribution, JSON.stringify(item), row.currency);
  for (const row of report.fundingGroups || []) {
    for (const key of ["status", "plannedPaymentRequests", "plannedPaidPurchases", "unpricedPaymentRequests", "firstUsefulResultAt", "atomicAmount"])
      add("EXPLICIT_FUNDING", row.id, row.date, key, row[key], JSON.stringify({ kind: row.kind, origin: row.origin, scheduleIds: row.scheduleIds, operationId: row.operationId, buyerId: row.buyerId }), "", row.network, row.asset);
    if (row.economics) for (const key of ["revenue", "paymentFees"])
      add("FUNDING_ECONOMICS", row.id, row.date, key, row.economics[key], "", row.economics.currency);
  }
  for (const row of report.passGroups) for (const key of ["openingUnits", "consumedUnits", "plannedNewPasses", "remainingActiveUnits", "retainedUnusedPreviousUnits"])
    add("PREPAID", row.id, "", key, row[key], "", "", row.network, row.asset);
  for (const row of report.sensitivity.completion) add("COMPLETION_SENSITIVITY", row.completionSharePct, "", "potentialCompletedWholePurchases", row.potentialCompletedWholePurchases, JSON.stringify(row));
  for (const row of report.sensitivity.effort) add("EFFORT_SENSITIVITY", row.effortIncreasePct, "", "contribution", row.contribution, JSON.stringify(row), row.currency);
  if (report.capacity) {
    add("CAPACITY", "", "", "status", report.capacity.status, report.capacity.basis);
    for (const pool of report.capacity.pools) {
      for (const row of pool.days) for (const key of ["availableHours", "requiredHours", "knownRequiredHours", "headroomHours", "additionalHoursKnownMinimum", "utilizationPercent", "status"])
        add("CAPACITY_DAY", pool.id, row.date, key, row[key], JSON.stringify({ label: pool.label, scheduleIds: row.scheduleIds, availabilityBasis: row.availabilityBasis, availabilityNote: row.availabilityNote, unknownEffortOccurrences: row.unknownEffortOccurrences }));
      for (const row of pool.weeks) for (const key of ["availableHours", "requiredHours", "headroomHours", "additionalHoursKnownMinimum", "status"])
        add("CAPACITY_WEEK", pool.id, row.weekStart, key, row[key], JSON.stringify({ start: row.start, end: row.end, includedCalendarDays: row.includedCalendarDays }));
    }
    for (const row of report.capacity.unassigned) add("CAPACITY_UNASSIGNED", row.scheduleId, row.date, "requiredHours", row.requiredHours, JSON.stringify(row));
    for (const row of report.capacity.sensitivity) add("CAPACITY_SENSITIVITY", row.poolId, "", "additionalHoursKnownMinimum", row.additionalHoursKnownMinimum, JSON.stringify(row));
  }
  for (const row of report.servicePricing || []) for (const key of ["chargeUnits", "totalCost", "revenue", "uncoveredCost", "breakEvenUnitRevenue", "targetUnitRevenue", "unitRevenueIncrease", "status"])
    add("SERVICE_PRICING", row.id, "", key, row[key], JSON.stringify({ scheduleIds: row.scheduleIds, minimumMarginPct: row.minimumMarginPct, priceBasis: row.priceBasis, unknownRecordCounts: row.unknownRecordCounts, ...(row.fundingGroupIds ? { fundingGroupIds: row.fundingGroupIds, currencies: row.currencies } : {}) }), row.currency || "");
  for (const row of report.findings) add("FINDING", row.id, "", row.code, row.severity, row.message);
  return output.map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}


/** Complete alternatives retain both source documents and use the same original-rule evaluator. */
export const COHORT_PLAN_COMPARISON_SCHEMA = "stellar-forge.sf47-cohort-plan-comparison.v1";
const COMPARISON_COLLECTIONS = ["buyers", "merchants", "facilitators", "operations", "schedules", "workshares", "capacityPools", "fundingGroups"];
const COMPARISON_MONEY_FIELDS = ["revenue", "supplierCost", "paymentFees", "activeHours", "laborCost", "totalCost", "contribution", "marginPercent"];
const COMPARISON_WORKSHARE_FIELDS = ["fee", "hours", "otherCosts", "laborCost", "totalCost", "contribution"];

function comparisonPlan(document, label) {
  object(document, label);
  if (document.schema === "stellar-forge.sf47-cohort-recorded-cost-plan.v1") return document.candidate;
  if (document.schema === COHORT_PLAN_SCHEMA) return document;
  if (document.schema === COHORT_PLAN_REPORT_SCHEMA && document.kind === "PLAN") return document.input;
  if (document.schema === "stellar-forge.sf47-delivery-schedule-report.v1") return document.candidate;
  if (document.schema === "stellar-forge.sf47-cohort-plan-edition.v1") return document.plan;
  fail("INVALID_COMPARISON_SOURCE", label + " must be a complete plan, planning report or saved edition.", label);
}
function comparisonNumber(before, after) {
  return { before: before ?? null, after: after ?? null,
    delta: before === null || before === undefined || after === null || after === undefined ? null : after - before };
}
function comparisonDecimal(before, after, comparable = true) {
  return { before: before ?? null, after: after ?? null,
    delta: !comparable || before === null || before === undefined || after === null || after === undefined ? null :
      decimalText(decimalSubtract(computedDecimal(after, "Candidate amount", true), computedDecimal(before, "Baseline amount", true))) };
}
function comparisonFields(before, after) {
  const left = before ?? {}, right = after ?? {};
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort().flatMap(key => {
    const beforePresent = Object.prototype.hasOwnProperty.call(left, key), afterPresent = Object.prototype.hasOwnProperty.call(right, key);
    return beforePresent === afterPresent && canonical(left[key]) === canonical(right[key]) ? [] :
      [{ key, beforePresent, afterPresent, before: beforePresent ? clone(left[key]) : null, after: afterPresent ? clone(right[key]) : null }];
  });
}
function comparisonRows(before, after, keyOf = row => row.id) {
  const left = new Map(before.map((row, index) => [keyOf(row), { row, index }]));
  const right = new Map(after.map((row, index) => [keyOf(row), { row, index }]));
  return [...new Set([...left.keys(), ...right.keys()])].flatMap(id => {
    const a = left.get(id), b = right.get(id);
    const changes = comparisonFields(a?.row, b?.row);
    const status = !a ? "ADDED" : !b ? "REMOVED" : changes.length ? "CHANGED" : a.index !== b.index ? "MOVED" : "UNCHANGED";
    return status === "UNCHANGED" ? [] : [{ id, status, beforeIndex: a?.index ?? null, afterIndex: b?.index ?? null,
      before: a ? clone(a.row) : null, after: b ? clone(b.row) : null, changes }];
  });
}
function comparisonAmounts(before, after, keys) {
  return Object.fromEntries(keys.map(key => [key, comparisonDecimal(before?.[key], after?.[key])]));
}
function comparisonWorkshareTotals(input) {
  const totals = new Map();
  for (const workshare of input.workshares) {
    const calculated = workshareResult(workshare, ["0"]), base = calculated.cases[0];
    const amounts = { fee: workshare.fee, hours: workshare.hours, otherCosts: workshare.otherCosts,
      laborCost: base.laborCost, totalCost: base.totalCost, contribution: base.contribution };
    if (!totals.has(workshare.currency)) totals.set(workshare.currency, { currency: workshare.currency, records: 0,
      known: Object.fromEntries(COMPARISON_WORKSHARE_FIELDS.map(key => [key, ZERO])),
      unknownRecordCounts: Object.fromEntries(COMPARISON_WORKSHARE_FIELDS.map(key => [key, 0])) });
    const group = totals.get(workshare.currency); group.records++;
    for (const key of COMPARISON_WORKSHARE_FIELDS) {
      if (amounts[key] === null) group.unknownRecordCounts[key]++;
      else group.known[key] = decimalAdd(group.known[key], computedDecimal(amounts[key], key, true));
    }
  }
  return [...totals.values()].map(({ known, ...group }) => {
    const knownSubtotals = Object.fromEntries(COMPARISON_WORKSHARE_FIELDS.map(key => [key, decimalText(known[key])]));
    return { ...group, knownSubtotals, complete: !Object.values(group.unknownRecordCounts).some(Boolean),
      ...Object.fromEntries(COMPARISON_WORKSHARE_FIELDS.map(key => [key, group.unknownRecordCounts[key] ? null : knownSubtotals[key]])) };
  }).sort((a, b) => a.currency.localeCompare(b.currency));
}
function comparisonCurrencyRows(before, after, keys) {
  const left = new Map(before.map(row => [row.currency, row])), right = new Map(after.map(row => [row.currency, row]));
  return [...new Set([...left.keys(), ...right.keys()])].sort().map(currency => {
    const a = left.get(currency) ?? null, b = right.get(currency) ?? null;
    return { currency, before: a, after: b, amounts: comparisonAmounts(a, b, keys) };
  });
}

const COMPARISON_CAPACITY_FIELDS = ["availableHours", "knownAvailableHours", "requiredHours", "knownRequiredHours", "headroomHours", "additionalHoursKnownMinimum"];
const COMPARISON_PRICE_FIELDS = ["unitRevenue", "totalCost", "revenue", "uncoveredCost", "breakEvenUnitRevenue", "targetUnitRevenue", "unitRevenueIncrease"];
function comparisonNamedAmounts(before, after, keys, keyOf = row => row.id, comparable = () => true) {
  const left = new Map(before.map(row => [keyOf(row), row])), right = new Map(after.map(row => [keyOf(row), row]));
  return [...new Set([...left.keys(), ...right.keys()])].map(id => {
    const a = left.get(id) ?? null, b = right.get(id) ?? null;
    return { id, before: a, after: b, amounts: Object.fromEntries(keys.map(key => [key, comparisonDecimal(a?.[key], b?.[key], comparable(a, b))])) };
  });
}
function comparisonDelivery(before, after) {
  const a = before.capacity, b = after.capacity, dayKey = row => canonical([row.poolId, row.date]), weekKey = row => canonical([row.poolId, row.weekStart]);
  const leftDays = a.pools.flatMap(pool => pool.days), rightDays = b.pools.flatMap(pool => pool.days);
  const leftWeeks = a.pools.flatMap(pool => pool.weeks), rightWeeks = b.pools.flatMap(pool => pool.weeks);
  return {
    status: { before: a.status, after: b.status },
    pools: comparisonNamedAmounts(a.pools, b.pools, COMPARISON_CAPACITY_FIELDS),
    days: comparisonNamedAmounts(leftDays, rightDays, ["availableHours", "requiredHours", "knownRequiredHours", "headroomHours", "additionalHoursKnownMinimum", "utilizationPercent"], dayKey),
    weeks: comparisonNamedAmounts(leftWeeks, rightWeeks, COMPARISON_CAPACITY_FIELDS, weekKey),
    dayChanges: comparisonRows(leftDays, rightDays, dayKey),
    weekChanges: comparisonRows(leftWeeks, rightWeeks, weekKey),
    unassigned: comparisonRows(a.unassigned, b.unassigned, row => canonical([row.scheduleId, row.date])),
    sensitivity: comparisonRows(a.sensitivity, b.sensitivity, row => canonical([row.poolId, row.effortIncreasePct]))
  };
}
function comparisonPrices(before, after) {
  return comparisonNamedAmounts(before.servicePricing, after.servicePricing, COMPARISON_PRICE_FIELDS, row => row.id,
    (a, b) => !!a?.currency && a.currency === b?.currency).map(row => ({
      ...row, counts: Object.fromEntries(["chargeUnits", "scheduledTasks"].map(key => [key, comparisonNumber(row.before?.[key], row.after?.[key])])),
      minimumMarginPct: comparisonDecimal(row.before?.minimumMarginPct, row.after?.minimumMarginPct)
    }));
}

function comparisonReview(raw, before, after) {
  const value = fields(object(raw, "comparison review"), ["title", "note", "origins"], "comparison review");
  const origins = fields(object(value.origins ?? {}, "comparison origins"), ["before", "after"], "comparison origins");
  const origin = (entry, label) => {
    if (entry === null || entry === undefined) return null;
    fields(object(entry, label), ["label", "caseId", "sourceId", "filename", "sha256", "bytes", "capturedAt"], label);
    const result = {};
    for (const key of ["label", "filename"]) if (entry[key] !== undefined) result[key] = textValue(entry[key], label + "." + key, false, 500);
    for (const key of ["caseId", "sourceId"]) if (entry[key] !== undefined && entry[key] !== null) result[key] = id(entry[key], label + "." + key);
    if (entry.sha256 !== undefined) {
      if (typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)) fail("INVALID_COMPARISON_SOURCE", "Retain the original source SHA-256.", label + ".sha256");
      result.sha256 = entry.sha256;
    }
    if (entry.bytes !== undefined) result.bytes = integer(entry.bytes, label + ".bytes");
    if (entry.capturedAt !== undefined) result.capturedAt = stamp(entry.capturedAt, label + ".capturedAt");
    return result;
  };
  return {
    title: textValue(value.title ?? (after.input.name + " compared with " + before.input.name), "comparison title", true, 1100),
    note: optionalText(value.note, "comparison note"),
    origins: { before: origin(origins.before, "baseline origin"), after: origin(origins.after, "candidate origin") }
  };
}

/**
 * Compare complete alternatives without changing either input or selecting a winner.
 * Deltas mean candidate minus baseline; unvalued amounts and absent currency/window
 * groups have null deltas. Schedule costs and one-time workshares remain separate.
 */
export function compareCohortPlans(beforeDocument, afterDocument, options = {}) {
  const before = evaluateCohortPlan(comparisonPlan(beforeDocument, "baseline"));
  const after = evaluateCohortPlan(comparisonPlan(afterDocument, "candidate"));
  const basis = [
    ["programId", before.source.programId, after.source.programId],
    ["planId", before.source.planId ?? null, after.source.planId ?? null],
    ["sourceVersion", before.source.version, after.source.version],
    ["planContentSha256", before.source.planContentSha256, after.source.planContentSha256],
    ["tranche", before.window.tranche, after.window.tranche],
    ["environment", before.window.expectedEnvironment, after.window.expectedEnvironment],
    ["windowStart", before.window.start, after.window.start],
    ["windowEnd", before.window.end, after.window.end],
    ["calendarDays", before.window.calendarDays, after.window.calendarDays],
    ["asOfAt", before.window.asOfAt, after.window.asOfAt],
    ["rule", before.rule, after.rule]
  ].map(([key, a, b]) => ({ key, before: clone(a), after: clone(b), match: canonical(a) === canonical(b) }));
  const leftTargets = new Map(before.targets.map(row => [row.key, row])), rightTargets = new Map(after.targets.map(row => [row.key, row]));
  const targets = [...new Set([...leftTargets.keys(), ...rightTargets.keys()])].map(key => {
    const a = leftTargets.get(key) ?? null, b = rightTargets.get(key) ?? null;
    return { key, before: a, after: b, expected: comparisonNumber(a?.expected, b?.expected),
      planned: comparisonNumber(a?.planned, b?.planned), gap: comparisonNumber(a?.gap, b?.gap) };
  });
  const leftDays = new Map(before.days.map(row => [row.date, row])), rightDays = new Map(after.days.map(row => [row.date, row]));
  const days = [...new Set([...leftDays.keys(), ...rightDays.keys()])].sort().map(date => {
    const a = leftDays.get(date) ?? null, b = rightDays.get(date) ?? null;
    return { date, before: a, after: b, metrics: Object.fromEntries(Object.keys(makeMetrics()).map(key => [key, comparisonNumber(a?.[key], b?.[key])])) };
  });
  const settings = input => Object.fromEntries(Object.entries(input).filter(([key]) => !COMPARISON_COLLECTIONS.includes(key)));
  const inputChanges = {
    settings: comparisonFields(settings(before.input), settings(after.input)),
    collections: COMPARISON_COLLECTIONS.map(kind => ({ kind,
      beforeOrder: before.input[kind].map(row => row.id), afterOrder: after.input[kind].map(row => row.id),
      rows: comparisonRows(before.input[kind], after.input[kind]) }))
  };
  const currencies = comparisonCurrencyRows(before.currencies, after.currencies, COMPARISON_MONEY_FIELDS);
  const workshareTotals = comparisonCurrencyRows(comparisonWorkshareTotals(before.input), comparisonWorkshareTotals(after.input), COMPARISON_WORKSHARE_FIELDS);
  const assetKey = row => canonical([row.network, row.asset]), leftAssets = new Map(before.assets.map(row => [assetKey(row), row])), rightAssets = new Map(after.assets.map(row => [assetKey(row), row]));
  const assets = [...new Set([...leftAssets.keys(), ...rightAssets.keys()])].map(key => {
    const a = leftAssets.get(key) ?? null, b = rightAssets.get(key) ?? null, row = a || b;
    return { network: row.network, asset: row.asset, before: a, after: b,
      atomicAmount: comparisonDecimal(a?.atomicAmount, b?.atomicAmount),
      plannedPaymentRequests: comparisonNumber(a?.plannedPaymentRequests, b?.plannedPaymentRequests),
      plannedPaidPurchases: comparisonNumber(a?.plannedPaidPurchases, b?.plannedPaidPurchases) };
  });
  const reportGroups = ["buyers", "merchants", "operations", "facilitators"].map(kind => ({
    kind, rows: comparisonRows(before[kind], after[kind], row => row.id || row.operatorId || canonical(row.buyerIds || row.merchantIds || row.serviceIds))
  }));
  const findingKey = row => canonical([row.code, row.scope, row.id, row.message]);
  const leftFindings = new Set(before.findings.map(findingKey)), rightFindings = new Set(after.findings.map(findingKey));
  return {
    schema: COHORT_PLAN_COMPARISON_SCHEMA, kind: "PLAN_COMPARISON",
    documents: { before: clone(beforeDocument), after: clone(afterDocument) }, before, after, basis,
    review: comparisonReview(options, before, after),
    summary: [...new Set([...Object.keys(before.summary), ...Object.keys(after.summary)])].map(key => ({ key, ...comparisonNumber(before.summary[key] ?? (key.startsWith("unpriced") ? 0 : undefined), after.summary[key] ?? (key.startsWith("unpriced") ? 0 : undefined)) })),
    targets, currencies, workshareTotals, assets, days, inputChanges,
    capacity: comparisonDelivery(before, after), servicePricing: comparisonPrices(before, after),
    economicsCoverage: Object.fromEntries([["before", before], ["after", after]].map(([side, report]) => [side, {
      occurrences: report.occurrences.length,
      withEconomics: report.occurrences.filter(row => row.economics !== null).length,
      withoutEconomics: report.occurrences.filter(row => row.economics === null).length,
      schedulesWithoutEconomics: report.input.schedules.filter(row => row.economics === null).map(row => row.id)
    }])),
    occurrences: comparisonRows(before.occurrences, after.occurrences),
    participants: reportGroups,
    passGroups: comparisonRows(before.passGroups, after.passGroups),
    fundingGroups: comparisonRows(before.fundingGroups, after.fundingGroups),
    workshares: comparisonRows(before.workshares, after.workshares),
    sensitivity: {
      completion: comparisonRows(before.sensitivity.completion, after.sensitivity.completion, row => row.completionSharePct),
      effort: comparisonRows(before.sensitivity.effort, after.sensitivity.effort, row => canonical([row.currency, row.effortIncreasePct]))
    },
    findings: {
      added: after.findings.filter(row => !leftFindings.has(findingKey(row))),
      removed: before.findings.filter(row => !rightFindings.has(findingKey(row)))
    }
  };
}

/** Recalculate carried sources before displaying or exporting an imported comparison. */
export function reopenCohortPlanComparison(document) {
  fields(object(document, "comparison"), ["schema", "kind", "documents", "before", "after", "basis", "review",
    "summary", "targets", "currencies", "workshareTotals", "assets", "days", "inputChanges", "economicsCoverage",
    "occurrences", "participants", "passGroups", "fundingGroups", "workshares", "sensitivity", "findings", "capacity", "servicePricing"], "comparison");
  if (document.schema !== COHORT_PLAN_COMPARISON_SCHEMA || document.kind !== "PLAN_COMPARISON" || !document.documents)
    fail("INVALID_PLAN_COMPARISON", "Open a complete cohort plan comparison with both original documents.", "comparison");
  fields(object(document.documents, "comparison documents"), ["before", "after"], "comparison documents");
  return compareCohortPlans(document.documents.before, document.documents.after, document.review ?? {});
}

/** Complete comparison rows; full editable source documents travel in comparison JSON. */
export function exportCohortPlanComparisonCsv(comparison) {
  const report = reopenCohortPlanComparison(comparison);
  const rows = [["section", "identity", "field", "baseline", "candidate", "change", "units", "detail"]];
  const cell = value => value && typeof value === "object" ? JSON.stringify(value) : value;
  const add = (section, identity, field, value, units = "", detail = "") =>
    rows.push([section, identity, field, cell(value.before), cell(value.after), value.delta ?? "", units, cell(detail)]);
  add("REVIEW", "", "title", { before: null, after: report.review.title });
  add("REVIEW", "", "note", { before: null, after: report.review.note });
  add("REVIEW", "", "origins", report.review.origins);
  for (const row of report.basis) add("BASIS", "", row.key, row, "", row.match ? "Same" : "Changed");
  for (const row of report.summary) add("SUMMARY", "", row.key, row, "count");
  for (const key of ["occurrences", "withEconomics", "withoutEconomics"]) add("ECONOMICS_COVERAGE", "", key, comparisonNumber(report.economicsCoverage.before[key], report.economicsCoverage.after[key]), "schedule-date rows");
  for (const row of report.targets) for (const key of ["expected", "planned", "gap"])
    add("TARGET", row.key, key, row[key], "count", { baselineStatus: row.before?.status ?? null, candidateStatus: row.after?.status ?? null });
  for (const [section, groups] of [["SCHEDULE_ECONOMICS", report.currencies], ["ONE_TIME_WORKSHARES", report.workshareTotals]])
    for (const group of groups) for (const [key, amounts] of Object.entries(group.amounts))
      add(section, group.currency, key, amounts, key === "hours" || key === "activeHours" ? "hours" : key === "marginPercent" ? "percentage points" : group.currency,
        { baselineUnknown: group.before?.unknownRecordCounts ?? null, candidateUnknown: group.after?.unknownRecordCounts ?? null });
  for (const row of report.assets) for (const key of ["atomicAmount", "plannedPaymentRequests", "plannedPaidPurchases"])
    add("ASSET", row.network + " / " + row.asset, key, row[key], key === "atomicAmount" ? "atomic units" : "count");
  for (const day of report.days) for (const [key, values] of Object.entries(day.metrics))
    add("DAY", day.date, key, values, "count", { baselineInWindow: !!day.before, candidateInWindow: !!day.after });

  add("CAPACITY_STATUS", "", "status", report.capacity.status);
  for (const [section, groups] of [["CAPACITY_POOL", report.capacity.pools], ["CAPACITY_DAY", report.capacity.days], ["CAPACITY_WEEK", report.capacity.weeks]])
    for (const group of groups) for (const [key, values] of Object.entries(group.amounts))
      add(section, group.id, key, values, key === "utilizationPercent" ? "percentage points" : "hours",
        { baselineStatus: group.before?.status ?? null, candidateStatus: group.after?.status ?? null,
          baselineUnknownEffort: group.before?.unknownEffortOccurrences ?? null, candidateUnknownEffort: group.after?.unknownEffortOccurrences ?? null });
  for (const group of report.servicePricing) {
    const detail = { baselineCurrency: group.before?.currency ?? null, candidateCurrency: group.after?.currency ?? null,
      baselineStatus: group.before?.status ?? null, candidateStatus: group.after?.status ?? null,
      baseline: group.before, candidate: group.after };
    for (const [key, values] of Object.entries(group.amounts)) add("SERVICE_PRICING", group.id, key, values, group.before?.currency === group.after?.currency ? group.before?.currency || "" : "different currencies", detail);
    for (const [key, values] of Object.entries(group.counts)) add("SERVICE_PRICING", group.id, key, values, "count", detail);
    add("SERVICE_PRICING", group.id, "minimumMarginPct", group.minimumMarginPct, "percentage points", detail);
  }

  for (const row of report.inputChanges.settings) add("PLAN_INPUT", "", row.key, row, "", { beforePresent: row.beforePresent, afterPresent: row.afterPresent });
  const changes = (section, values) => {
    for (const row of values) {
      add(section, row.id, "position", comparisonNumber(row.beforeIndex, row.afterIndex), "zero-based index", row.status);
      for (const change of row.changes) add(section, row.id, change.key, change, "", row.status);
    }
  };
  for (const group of report.inputChanges.collections) changes("INPUT_" + group.kind.toUpperCase(), group.rows);
  changes("SCHEDULE_OCCURRENCE", report.occurrences);
  for (const group of report.participants) changes("RESULT_" + group.kind.toUpperCase(), group.rows);
  changes("PREPAID", report.passGroups); changes("EXPLICIT_FUNDING", report.fundingGroups); changes("WORKSHARE", report.workshares);
  changes("CAPACITY_DAY_CHANGE", report.capacity.dayChanges); changes("CAPACITY_WEEK_CHANGE", report.capacity.weekChanges);
  changes("CAPACITY_UNASSIGNED", report.capacity.unassigned); changes("CAPACITY_SENSITIVITY", report.capacity.sensitivity);
  changes("COMPLETION_SENSITIVITY", report.sensitivity.completion); changes("EFFORT_SENSITIVITY", report.sensitivity.effort);
  for (const [kind, findings] of Object.entries(report.findings)) for (const row of findings)
    add("FINDING_" + kind.toUpperCase(), row.id ?? "", row.code, { before: kind === "removed" ? row.message : null, after: kind === "added" ? row.message : null }, "", row.scope);
  return rows.map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/**
 * Evaluate one quoted workshare through the original exact-decimal engine.
 * This has no cohort admission, purchase, Forecast or cash-record side effect.
 */
export function evaluateWorkshareEconomics(raw, options = {}) {
  const label = "workshare";
  const row = fields(object(raw, label), ["id", "label", "currency", "fee", "hours", "hourlyCost", "otherCosts", "sourceIds", "sourceNote"], label);
  const normalized = {id:id(row.id,label+".id"),label:textValue(row.label,label+".label",true,500),
    currency:moneyCurrency(row.currency,label+".currency"),...evidence(row,label)};
  for (const key of ["fee","hours","hourlyCost","otherCosts"])
    normalized[key] = nullableDecimal(row[key],label+"."+key);
  fields(object(options,"workshare options"),["effortIncreasesPct","costs","costCoverage","availableHours","committedHours"],"workshare options");
  const increases = [...new Set(["0",...array(options.effortIncreasesPct ?? ["0","20","25"],"effortIncreasesPct",30)
    .map(value=>decimalText(decimal(value,"Effort increase")))])];
  let otherCostCoverage = null;
  if (options.costs !== undefined) {
    const costs = array(options.costs,"costs",500).map((value,i)=>nullableDecimal(value,"costs["+i+"]"));
    const coverage = enumValue(options.costCoverage,["INCOMPLETE","COMPLETE"],"costCoverage");
    let known = ZERO;
    for (const value of costs) if (value !== null) known = decimalAdd(known,decimal(value,"cost"));
    const unknownCount = costs.filter(value=>value===null).length;
    const complete = coverage === "COMPLETE" && unknownCount === 0;
    otherCostCoverage = {knownSubtotal:decimalText(known),unknownCount,complete};
    normalized.otherCosts = complete ? decimalText(known) : null;
  }
  const result = workshareResult(normalized,increases);
  const available = nullableDecimal(options.availableHours,"availableHours");
  const committed = nullableDecimal(options.committedHours,"committedHours");
  function capacityFor(hoursValue) {
    const capacity={availableHours:available,committedHours:committed,remainingHours:null,maxWholeWorkshares:null,status:"UNKNOWN"};
    if (available !== null && committed !== null) {
      const remaining=decimalSubtract(decimal(available,"availableHours"),decimal(committed,"committedHours"));
      capacity.remainingHours=decimalText(remaining);
      if (remaining.n<0n) {capacity.maxWholeWorkshares="0";capacity.status="OVERCOMMITTED";}
      else if (hoursValue!==null) {
        const hours=computedDecimal(hoursValue,"hours");
        if(hours.n===0n)capacity.status="ZERO_HOURS_UNBOUNDED";
        else{capacity.maxWholeWorkshares=String(remaining.n*power(hours.s)/(hours.n*power(remaining.s)));capacity.status="CALCULATED";}
      }
    }
    return capacity;
  }
  const capacity=capacityFor(normalized.hours);
  const capacityCases=result.cases.map(row=>({effortIncreasePct:row.effortIncreasePct,hours:row.hours,...capacityFor(row.hours)}));
  return {...result,otherCostCoverage,capacity,capacityCases};
}
