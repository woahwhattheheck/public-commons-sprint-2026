/** Prepare complete input for the original SF47 Installation desk. No provider calls. */
const SCHEMA = "stellar-forge.installation-workorder-bindings.v1";
const PROFILE = "stellar-forge.installation-workorder-profile.v1";
const clone = value => JSON.parse(JSON.stringify(value));
const ordered = value => Array.isArray(value) ? value.map(ordered) : record(value) ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const same = (a, b) => JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
const requireValue = (ok, message) => { if (!ok) throw new Error(message); };
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const sections = {
  task: ["name", "purpose", "request", "completeOutput", "repeatTrigger", "pricedUnit"],
  source: ["sourceIds", "reference", "mode", "population", "meaning", "authority", "changePolicy"],
  payment: ["network", "asset", "recipient", "priceAtomic", "taskBudgetAtomic", "taskUnits", "authority", "termsSourceIds", "facilitators"],
  receiving: ["application", "host", "operator", "acceptanceRule", "changeAndWithdraw", "recovery", "maintenance", "sourceIds"]
};
const unique = values => [...new Set(values)];
function inspectSeed(seed) {
  requireValue(record(seed) && record(seed.source) && record(seed.document),
    "Use the complete original installation-seed or installation-workshare-seed result.");
  for (const key of ["caseId", "version", "planId", "planRevision", "planContentSha256", "planSourceSha256"])
    requireValue(own(seed.source, key), "The original seed is missing source." + key);
  requireValue((seed.installationId ?? null) === null && (seed.expectedRevision ?? 0) === 0,
    "This prepares a new installation. Edit a retained installation through its original current draft.");
  requireValue(seed.document.stage === "PLANNED" && Array.isArray(seed.document.checks),
    "Select the fresh planned document from the original case.");
  for (const check of seed.document.checks)
    requireValue(check.state === "OPEN" && !check.observedAt && !check.operator &&
      ["workIds", "purchaseIds", "outcomeIds"].every(key => Array.isArray(check[key]) && !check[key].length),
      "Keep operated acceptance in its original installation; this input must be a fresh planned seed.");
  for (const key of ["workorder", "assignments", ...Object.keys(sections)])
    requireValue(record(seed.document[key]), "The native seed is missing document." + key);
}
function inspectProfile(profile) {
  requireValue(record(profile) && profile.schema === PROFILE && /^[a-z][a-z0-9-]+$/.test(profile.id),
    "Select a complete maintained workorder profile.");
  for (const key of ["task", "source", "receiving"])
    requireValue(record(profile[key]), "The workorder profile is missing " + key);
  requireValue(Array.isArray(profile.steps) && Array.isArray(profile.inputs) && Array.isArray(profile.sourceFiles),
    "Retain the profile's complete implementation and source guide.");
}
export function bindingTemplate(seed, profile) {
  inspectSeed(seed); inspectProfile(profile);
  return {
    schema: SCHEMA, profile: profile.id, selection: clone(seed.source),
    workshareCaseId: seed.document.workshare?.caseId ?? null,
    merchantDeploymentId: seed.document.merchantDeploymentId,
    buyerDeploymentIds: clone(seed.document.buyerDeploymentIds),
    task: {},
    source: {sourceIds: [], reference: "", authority: ""},
    payment: clone(seed.document.payment),
    receiving: {host: "", operator: "", sourceIds: []}
  };
}
function sectionInput(input, section) {
  const value = input[section] ?? {};
  requireValue(record(value), "Use an object for bindings." + section);
  for (const key of Object.keys(value))
    requireValue(sections[section].includes(key), "Unknown binding: " + section + "." + key);
  return value;
}
function explicitValues(value) {
  // Blank template text leaves the maintained technical instruction in place.
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== ""));
}
function mergeIds(original, supplied, label) {
  requireValue(Array.isArray(original) && Array.isArray(supplied) &&
    [...original, ...supplied].every(id => typeof id === "string" && id.length > 0),
    "Use the original case source IDs for " + label);
  return unique([...original, ...supplied]);
}
function paymentCheck(value) {
  for (const key of ["priceAtomic", "taskBudgetAtomic"])
    requireValue(value[key] === null || typeof value[key] === "string" && /^(0|[1-9][0-9]{0,29})$/.test(value[key]),
      key + " must retain the selected integer atomic amount or null.");
  requireValue(value.taskUnits === null || Number.isSafeInteger(value.taskUnits) && value.taskUnits >= 0 && value.taskUnits <= 1e12,
    "Use the selected whole task-unit count or null.");
  if (value.priceAtomic !== null && value.taskUnits !== null && value.taskBudgetAtomic !== null)
    requireValue(BigInt(value.priceAtomic) * BigInt(value.taskUnits) <= BigInt(value.taskBudgetAtomic),
      "The selected task count exceeds the approved atomic task budget.");
}
export function prepareInstallation(seed, profile, bindings) {
  inspectSeed(seed); inspectProfile(profile);
  requireValue(record(bindings) && bindings.schema === SCHEMA && bindings.profile === profile.id,
    "Use bindings prepared for this profile.");
  const allowed = ["schema", "profile", "selection", "workshareCaseId", "merchantDeploymentId", "buyerDeploymentIds", ...Object.keys(sections)];
  requireValue(Object.keys(bindings).every(key => allowed.includes(key)), "Use the declared binding fields.");
  requireValue(same(bindings.selection, seed.source),
    "The original case or pinned plan changed. Prepare bindings from the fresh original seed.");
  requireValue(bindings.workshareCaseId === (seed.document.workshare?.caseId ?? null),
    "Retain this installation's original commercial Workshare case.");
  const document = clone(seed.document);
  for (const section of Object.keys(sections)) {
    const supplied = sectionInput(bindings, section);
    document[section] = {...document[section], ...(profile[section] ?? {}), ...explicitValues(supplied)};
    const ids = section === "payment" ? "termsSourceIds" : "sourceIds";
    if (own(seed.document[section], ids))
      document[section][ids] = mergeIds(seed.document[section][ids], supplied[ids] ?? [], section + "." + ids);
  }
  if (own(bindings, "merchantDeploymentId")) {
    requireValue(bindings.merchantDeploymentId === null || typeof bindings.merchantDeploymentId === "string",
      "Select the original merchant deployment ID or null.");
    document.merchantDeploymentId = bindings.merchantDeploymentId;
  }
  if (own(bindings, "buyerDeploymentIds")) {
    requireValue(Array.isArray(bindings.buyerDeploymentIds) && bindings.buyerDeploymentIds.length <= 20 &&
      bindings.buyerDeploymentIds.every(id => typeof id === "string" && id.length > 0),
      "Select the original buyer deployment IDs.");
    document.buyerDeploymentIds = unique(bindings.buyerDeploymentIds);
  }
  paymentCheck(document.payment);
  for (const section of Object.keys(sections))
    for (const [key, value] of Object.entries(document[section]))
      if (typeof value === "string")
        requireValue(value.length <= (key === "request" ? 8000 : key === "network" ? 200 : ["asset", "recipient"].includes(key) ? 500 : 4000),
          "The complete native field is too long: " + section + "." + key);
  // Source-backed commercial terms, funded packages, phases, observations and
  // newer native extensions stay exactly as returned by the maintained seed.
  for (const key of ["workorder", "assignments", "checks", "workshare", "workflowPeriods", "coordination"])
    requireValue(same(document[key], seed.document[key]), "The original native " + key + " changed.");
  const selections = [];
  const needed = (ok, key, purpose) => { if (!ok) selections.push({field: key, purpose}); };
  needed(document.workshare, "original Workshare", "Receive the complete retained customer case through installation-workshare-seed.");
  needed(document.merchantDeploymentId, "merchantDeploymentId", "Select the accountable merchant already recorded in this operating case.");
  needed(document.buyerDeploymentIds.length, "buyerDeploymentIds", "Select the actual independent customer operator's existing deployment.");
  needed(bindings.source?.reference, "source.reference", "Record the actual customer source/edition or approved live connection.");
  needed(bindings.source?.authority, "source.authority", "Retain the selected customer's actual source-use authority.");
  for (const key of ["network", "asset", "recipient", "authority"])
    needed(document.payment[key], "payment." + key, "Use the merchant's approved payment selection.");
  needed(document.payment.priceAtomic !== null, "payment.priceAtomic", "Record the approved atomic unit price.");
  needed(document.payment.taskUnits !== null, "payment.taskUnits", "Record the selected useful task count.");
  needed(document.payment.taskBudgetAtomic !== null, "payment.taskBudgetAtomic", "Record the approved task budget.");
  for (const key of ["host", "operator"])
    needed(document.receiving[key], "receiving." + key, "Bind the actual receiving host and named receiving engineer.");
  return {
    schema: "stellar-forge.installation-workorder-preparation.v1", profile: profile.id,
    source: clone(seed.source), workshareCaseId: bindings.workshareCaseId,
    document, selections, implementation: clone(profile.steps), inputs: clone(profile.inputs),
    sourceFiles: clone(profile.sourceFiles),
    preview: {expectedVersion: seed.source.version, installationId: null, expectedRevision: 0, document: clone(document)}
  };
}
export function renderWorkorder(prepared) {
  const d = prepared.document;
  const shown = value => value === null || value === undefined || value === "" ?
    "To be selected in the original case." : Array.isArray(value) ?
      value.length ? value.join(", ") : "None selected." : String(value);
  const cell = value => shown(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  const table = (headers, rows) => "| " + headers.map(cell).join(" | ") + " |\n| " +
    headers.map(() => "---").join(" | ") + " |\n" +
    rows.map(row => "| " + row.map(cell).join(" | ") + " |").join("\n") + "\n";
  const section = (title, rows) => "## " + title + "\n\n" + rows.map(([label, value]) =>
    "### " + label + "\n\n" + shown(value) + "\n").join("\n");
  const referenceRows = [
    ["Operating case", prepared.source.caseId],
    ["Case version", prepared.source.version],
    ["Pinned grant plan", prepared.source.planId],
    ["Plan edition", prepared.source.planRevision],
    ["Plan content SHA-256", prepared.source.planContentSha256],
    ["Plan source SHA-256", prepared.source.planSourceSha256],
    ["Original commercial case", prepared.workshareCaseId],
    ["Installation stage", d.stage],
    ["Accountable merchant deployment", d.merchantDeploymentId],
    ["Customer buyer deployments", d.buyerDeploymentIds]
  ];
  const text = [
    "# " + d.name + "\n",
    "## Original installation selection\n",
    table(["Selection", "Original value"], referenceRows),
    section("Customer task", [
      ["Useful task", d.task.name], ["Customer purpose", d.task.purpose],
      ["Complete request", d.task.request], ["Whole useful output", d.task.completeOutput],
      ["Reason for another purchase", d.task.repeatTrigger], ["Merchant-priced unit", d.task.pricedUnit]
    ]),
    section("Authorized source", [
      ["Selected edition or live connection", d.source.reference], ["Source behavior", d.source.mode],
      ["Complete source population", d.source.population], ["Keys, types, units and time", d.source.meaning],
      ["Source rights and authority", d.source.authority], ["Source change and withdrawal", d.source.changePolicy],
      ["Original source attachments", d.source.sourceIds]
    ]),
    "## Payment and whole-task budget\n",
    table(["Payment selection", "Original value"], [
      ["Stellar payment network", d.payment.network], ["Payment asset", d.payment.asset],
      ["Merchant recipient", d.payment.recipient], ["Price per unit, atomic units", d.payment.priceAtomic],
      ["Priced task-unit count", d.payment.taskUnits], ["Approved task budget, atomic units", d.payment.taskBudgetAtomic]
    ]),
    "### Buyer approval and spending authority\n\n" + shown(d.payment.authority) + "\n",
    "### Original payment terms files\n\n" + shown(d.payment.termsSourceIds) + "\n",
    "### Selected facilitators\n\n" + (d.payment.facilitators.length ?
      table(["Operator", "Endpoint", "Source files", "Selection basis"], d.payment.facilitators.map(provider =>
        [provider.operatorId, provider.endpoint, provider.sourceIds, provider.note])) :
      "Receive the actual operator and endpoint selections in the original case.\n"),
    section("Complete receiving and operation", [
      ["Application and version", d.receiving.application], ["Authorized receiving host", d.receiving.host],
      ["Named receiving engineer", d.receiving.operator], ["Useful-output acceptance", d.receiving.acceptanceRule],
      ["Independent change or withdrawal", d.receiving.changeAndWithdraw],
      ["Original interruption recovery", d.receiving.recovery], ["Maintenance and support ownership", d.receiving.maintenance],
      ["Complete receiving source files", d.receiving.sourceIds]
    ]),
    section("Retained commercial workorder", [
      ["Original commissioning source", d.workorder.sourceId], ["Workorder reference", d.workorder.reference],
      ["Commissioning payer", d.workorder.payer], ["Complete implementation scope", d.workorder.scope],
      ["Original commercial terms", d.workorder.terms]
    ]),
    "## Delivery and funding assignments\n",
    "### Original funded packages\n\n" + (d.assignments.costIds.length ?
      d.assignments.costIds.map(id => "- " + id).join("\n") : "Use the original selected funding assignment.") + "\n",
    "### Separate commercial assignment\n\n" + shown(d.assignments.commercialRef) + "\n",
    "### Actual work allocation\n\n" + shown(d.assignments.note) + "\n",
    "## Complete implementation\n",
    prepared.implementation.map((step, index) => (index + 1) + ". **" + step.title + ".** " + step.result).join("\n\n") + "\n",
    "## Every original acceptance phase and criterion\n",
    d.checks.map((check, index) => {
      const rows = [
        ["Original step", check.id], ["Original tranche", check.tranche ?? "Commercial / unassigned"],
        ["Required", check.required ? "Yes" : "No"], ["Current state", check.state],
        ["Observing operator", check.operator], ["Observation time", check.observedAt],
        ["Source attachments", check.sourceIds], ["Original work records", check.workIds],
        ["Original purchases", check.purchaseIds], ["Original outcomes", check.outcomeIds]
      ];
      return "### " + (index + 1) + ". " + check.title + "\n\n" +
        "**Original acceptance criterion**\n\n" + shown(check.criterion) + "\n\n" +
        "**Phase owner, effort, dependencies and retained result note**\n\n" + shown(check.note) + "\n\n" +
        table(["Original step field", "Value"], rows);
    }).join("\n"),
    "## Complete customer input list\n",
    prepared.inputs.map(input => "- " + input).join("\n") + "\n",
    "## Actual selections to receive\n",
    (prepared.selections.length ? prepared.selections.map(item =>
      "- **" + item.field + ":** " + item.purpose).join("\n") :
      "All preparation fields are populated. The original native preview resolves their case ownership and source.") + "\n",
    "## Maintained implementation source\n",
    prepared.sourceFiles.map(item => "- " + item.path + " · Git blob " + item.blob).join("\n") + "\n"
  ];
  if (d.workshare) text.push(
    "## Original Workshare source binding\n",
    table(["Binding", "Original value"], [
      ["Commercial case", d.workshare.caseId], ["Plan SHA-256", d.workshare.planSha256],
      ["Commissioning source", d.workshare.sourceId], ["Commissioning source SHA-256", d.workshare.sourceSha256],
      ["Complete packet source", d.workshare.packetSourceId], ["Complete packet SHA-256", d.workshare.packetSha256]
    ]),
    table(["Original commercial phase", "Native acceptance step"],
      d.workshare.phaseChecks.map(phase => [phase.phaseId, phase.checkId]))
  );
  return text.join("\n");
}
