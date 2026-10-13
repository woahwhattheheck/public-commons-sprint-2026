/** Complete original commercial terms and source-selected recurring customer work. */
const copy = value => JSON.parse(JSON.stringify(value));
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const check = (value, message) => { if (!value) throw new Error(message); };
const ordered = value => Array.isArray(value) ? value.map(ordered) : record(value) ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const same = (left, right) => JSON.stringify(ordered(left)) === JSON.stringify(ordered(right));
function decimal(value, label) {
  check(typeof value === "string" || (typeof value === "number" && Number.isFinite(value)),
    label + " needs its complete nonnegative decimal.");
  const match = String(value).trim().match(/^\+?(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/);
  check(match, label + " needs its complete nonnegative decimal.");
  const fraction = match[2] ?? match[3] ?? "";
  const exponent = Number(match[4] || "0");
  check(Number.isSafeInteger(exponent) && Math.abs(exponent) <= 10000,
    label + " exceeds the supported decimal precision.");
  let number = BigInt((match[1] || "0") + fraction), places = fraction.length - exponent;
  if (places < 0) { number *= 10n ** BigInt(-places); places = 0; }
  return {number, places};
}
function sum(values, label) {
  const parsed = values.map(value => decimal(value, label));
  const places = Math.max(0, ...parsed.map(value => value.places));
  const number = parsed.reduce((total, value) => total + value.number * 10n ** BigInt(places - value.places), 0n);
  return {number, places};
}
function equalDecimal(left, right) {
  const a = decimal(left, "Original amount"), b = decimal(right, "Selected amount");
  const places = Math.max(a.places, b.places);
  return a.number * 10n ** BigInt(places - a.places) === b.number * 10n ** BigInt(places - b.places);
}
function decimalText(value) {
  let digits = String(value.number);
  if (!value.places) return digits;
  digits = digits.padStart(value.places + 1, "0");
  return (digits.slice(0, -value.places) + "." + digits.slice(-value.places)).replace(/\.?0+$/, "");
}
function text(value, label) {
  check(typeof value === "string" && value.trim(), "Retain the original " + label + ".");
  return value;
}
function unique(rows, key, label) {
  check(Array.isArray(rows), "Retain all original " + label + " rows.");
  const found = new Map();
  for (const row of rows) {
    check(record(row), "Retain each complete " + label + " row.");
    text(row[key], label + " identity");
    check(!found.has(row[key]), "Keep each original " + label + " identity once.");
    found.set(row[key], row);
  }
  return found;
}
function html(value) { return String(value ?? "").replace(/[&<>"']/g, value => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[value])); }
function markdown(value) { return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>"); }

/** The native Workshare seed verifies the entire attached source and original plan. */
export function commercialWorkshare({seed, commissioning, profile, selection}) {
  check(record(seed) && record(seed.document) && record(seed.workshare) &&
    record(seed.source), "Receive the complete original native Workshare seed.");
  check(record(commissioning) && ["dealscout.workshare-commissioning-inputs.v1",
    "sec-workshare.commissioning-inputs.v1"].includes(commissioning.version),
    "Receive the complete original commissioning source.");
  const cases = unique(commissioning.cases, "case_id", "commissioning case");
  const caseId = seed.workshare.caseId;
  const item = cases.get(caseId);
  check(item && seed.document.workshare?.caseId === caseId, "Select this original Workshare case.");
  check(item.plan_sha256 === seed.workshare.planSha256 &&
    seed.document.workshare.planSha256 === item.plan_sha256,
    "Retain the same original Workshare plan edition.");
  const source = item.workshare_input?.source, plan = item.workshare_input?.plan;
  check(record(source) && source.case_id === caseId && record(plan) &&
    plan.version === "dealscout.workshare-plan.v1", "Retain the full original Workshare source and plan.");
  check(same(plan.commercial, seed.workshare.commercial),
    "The native seed's commercial source differs from the original selected plan.");
  const phases = unique(plan.phases, "id", "commercial phase");
  const effort = unique(item.production_effort, "phase_id", "phase effort");
  check(phases.size && phases.size === effort.size && [...phases.keys()].every(id => effort.has(id)),
    "Receive exactly one original effort estimate for every commercial phase.");
  const phaseRows = [...phases].map(([id, phase]) => {
    decimal(effort.get(id).hours, "Original phase hours");
    return {phase: copy(phase), effort: copy(effort.get(id))};
  });
  const hours = decimalText(sum(phaseRows.map(row => row.effort.hours), "Original phase hours"));
  check(equalDecimal(hours, seed.workshare.hours), "The native commercial effort total changed.");
  check(phaseRows.length === seed.workshare.phaseCount, "Retain every original commercial phase.");
  const commercial = plan.commercial;
  check(record(commercial), "Retain the complete original commercial contract.");
  const fee = commercial.amount;
  decimal(fee, "Original commercial fee");
  check(Array.isArray(commercial.milestones) && commercial.milestones.length,
    "Retain every original payment milestone.");
  const milestoneTotal = decimalText(sum(commercial.milestones.map(row => row.amount), "Original milestone amount"));
  check(equalDecimal(fee, milestoneTotal), "Original payment milestones must sum to the original fee.");
  text(commercial.currency, "commercial currency");
  const result = {
    schema: "stellar-forge.installation-commercial-workshare.v1",
    profile: profile.id, caseId, planSha256: item.plan_sha256,
    source: Object.fromEntries(Object.entries(seed.source).filter(([key]) => key !== "version")),
    workshareSource: copy(seed.document.workshare), workorder: copy(seed.document.workorder),
    commercial: copy(commercial), schedule: copy(plan.schedule),
    totalEffortHours: hours, phaseCount: phaseRows.length, phases: phaseRows,
    customer: plan.customer, title: plan.title, outcome: plan.outcome,
    originalSource: copy(source), originalPlan: copy(plan),
    originalProductionEffort: copy(item.production_effort),
    originalCommissioningCase: copy(item), recurringSelection: null
  };
  if (selection !== undefined) {
    check(record(selection) && selection.schema === "tjlabs.scf-recurring-commissioning.v1",
      "Select the complete original recurring customer selection.");
    const selected = unique(selection.selections, "id", "recurring customer").get(profile.id);
    check(selected, "The original recurring selection must include this customer profile.");
    check(commercial.currency === "USD" && equalDecimal(selected.feeUsd, fee),
      "The recurring customer's quoted fee differs from its selected original Workshare.");
    check(Number.isSafeInteger(selected.businessDays) &&
      selected.businessDays === plan.schedule?.business_days,
      "The recurring customer's quoted duration differs from its selected original Workshare.");
    check(equalDecimal(decimalText(sum([selected.baseHours, selected.allowanceHours], "Selected commercial hours")), hours),
      "The recurring customer's full base and allowance hours differ from the original phase plan.");
    check(Array.isArray(selected.milestones) &&
      selected.milestones.length === commercial.milestones.length,
      "Retain every original quoted payment stage in the recurring selection.");
    for (let index = 0; index < selected.milestones.length; index++)
      check(equalDecimal(selected.milestones[index].usd, commercial.milestones[index].amount),
        "The recurring customer's payment amount differs at original milestone " + (index + 1) + ".");
    result.recurringSelection = {operationId: selection.operationId, preparedOn: selection.preparedOn,
      status: selection.status, selection: copy(selected)};
  }
  return result;
}

export function commercialMarkdown(value) {
  const currency = value.commercial.currency;
  let body = "# " + value.title + "\n\n" + value.outcome + "\n\n";
  body += "| Original term | Selected source |\n|---|---|\n" +
    "| Customer | " + markdown(value.customer) + " |\n" +
    "| Workshare | " + markdown(value.caseId) + " |\n" +
    "| Original plan | " + markdown(value.planSha256) + " |\n" +
    "| Fee | " + markdown(currency + " " + value.commercial.amount) + " |\n" +
    "| Price status | " + markdown(value.commercial.price_status) + " |\n" +
    "| Quoted business days | " + markdown(value.schedule.business_days) + " |\n" +
    "| Complete phase effort | " + value.totalEffortHours + " hours |\n\n";
  body += "## Payment stages\n\n| Stage | " + markdown(currency) + " | Original trigger |\n|---|---:|---|\n";
  for (const row of value.commercial.milestones)
    body += "| " + markdown(row.label) + " | " + markdown(row.amount) + " | " + markdown(row.trigger) + " |\n";
  body += "\n## Commencement and original scope\n\n";
  for (const condition of value.schedule.start_conditions || []) body += "- " + condition + "\n";
  body += "\n## Complete commercial phases\n\n| Phase | Hours | Predecessors | Original acceptance |\n|---|---:|---|---|\n";
  for (const {phase, effort} of value.phases)
    body += "| " + markdown(phase.title) + " | " + markdown(effort.hours) + " | " +
      markdown((phase.depends_on || []).join(", ")) + " | " +
      markdown(typeof phase.acceptance === "string" ? phase.acceptance : JSON.stringify(phase.acceptance ?? phase.acceptance_criteria ?? "")) + " |\n";
  if (value.recurringSelection) {
    const selection = value.recurringSelection.selection;
    body += "\n## Selected customer receiving and correction\n\n" +
      selection.correction + "\n\n" + selection.receivingProposal + "\n\n" +
      "Original commercial source: " + selection.commercialSource + "\n\n" +
      "Selected full effort: " + selection.baseHours + " base hours and " + selection.allowanceHours + " integration allowance hours.\n";
  }
  body += "\n## Complete retained terms\n\n```json\n" +
    JSON.stringify({commercial: value.commercial, schedule: value.schedule,
      originalSource: value.originalSource, originalPlan: value.originalPlan}, null, 2) + "\n```\n";
  return body;
}

export function commercialHtml(value) {
  const row = (label, content) => "<tr><th>" + html(label) + "</th><td>" + html(content) + "</td></tr>";
  let body = "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<title>" + html(value.title) + "</title><style>body{font:15px system-ui,sans-serif;line-height:1.5;color:#202020;background:#fff;max-width:1100px;margin:32px auto;padding:0 20px}h1{font-size:24px}h2{font-size:19px;margin-top:30px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:8px;text-align:left;vertical-align:top}th{background:#eee}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;border:1px solid #bbb;padding:12px}p{overflow-wrap:anywhere}</style><main>" +
    "<h1>" + html(value.title) + "</h1><p>" + html(value.outcome) + "</p><table>" +
    row("Customer", value.customer) + row("Original Workshare", value.caseId) +
    row("Quoted fee", value.commercial.currency + " " + value.commercial.amount) +
    row("Original price status", value.commercial.price_status) +
    row("Quoted business days", value.schedule.business_days) +
    row("Complete commercial effort", value.totalEffortHours + " hours") + "</table>";
  body += "<h2>Original payment stages</h2><table><thead><tr><th>Stage</th><th>Amount</th><th>Trigger</th></tr></thead><tbody>";
  for (const item of value.commercial.milestones)
    body += "<tr><td>" + html(item.label) + "</td><td>" + html(value.commercial.currency + " " + item.amount) +
      "</td><td>" + html(item.trigger) + "</td></tr>";
  body += "</tbody></table><h2>Commencement</h2><ul>";
  for (const condition of value.schedule.start_conditions || []) body += "<li>" + html(condition) + "</li>";
  body += "</ul><h2>Complete commercial phases</h2><table><thead><tr><th>Phase</th><th>Hours</th><th>Predecessors</th></tr></thead><tbody>";
  for (const item of value.phases) body += "<tr><td>" + html(item.phase.title) + "</td><td>" +
    html(item.effort.hours) + "</td><td>" + html((item.phase.depends_on || []).join(", ")) + "</td></tr>";
  body += "</tbody></table>";
  if (value.recurringSelection) {
    const selected = value.recurringSelection.selection;
    body += "<h2>Selected customer receiving and correction</h2><p>" + html(selected.correction) + "</p><p>" +
      html(selected.receivingProposal) + "</p><p>" + html(selected.commercialSource) + "</p>";
  }
  body += "<h2>Complete original selected case</h2><details><summary>Original terms, phase graph and source</summary><pre>" +
    html(JSON.stringify(value.originalCommissioningCase, null, 2)) + "</pre></details></main></html>\n";
  return body;
}
