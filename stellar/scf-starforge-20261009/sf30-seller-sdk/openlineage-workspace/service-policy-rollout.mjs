// MIT. Reviewed multi-job service policies use the original workspace transaction.
import { project, digest, canonical, clone, csv } from "./model.mjs";
import { normalizePolicy, servicePolicyRevision, SERVICE_LEVELS_SCHEMA, ServiceLevelError } from "./service-levels.mjs";

export const PLAN_SCHEMA = "commons.openlineage.service-policy-plan.v1";
export const PREVIEW_SCHEMA = "commons.openlineage.service-policy-preview.v1";
export const ROLLOUT_SCHEMA = "commons.openlineage.service-policy-rollout.v1";
const HASH = /^[0-9a-f]{64}$/;
const ROW = /^[A-Za-z0-9_.:-]{1,120}$/;
const record = x => x !== null && typeof x === "object" && !Array.isArray(x);
const same = (a, b) => canonical(a) === canonical(b);
const fail = (message, status = 400, details) => { throw new ServiceLevelError(message, status, details); };
function keys(value, allowed, name) {
  if (!record(value) || Object.keys(value).some(key => !allowed.includes(key))) fail("Invalid " + name);
}
function text(value, name, maximum) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || value.includes("\0")) fail("Invalid " + name);
  return value.trim();
}
function hash(value, name) { if (typeof value !== "string" || !HASH.test(value)) fail("Invalid " + name); return value; }
function version(value) { return Number.isSafeInteger(value) && value > 0; }
function checkTime(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("Invalid rollout timestamp", 409);
}
const nativePolicies = state => state.serviceLevels?.policies ?? [];
const rollouts = state => state.servicePolicyRollouts ?? [];
function savedInput(value) {
  const fields = ["id","title","jobKey","owner","runbook","enabled","effectiveFrom","maxCompletionAgeSeconds","maxDurationSeconds","failureWindowSeconds","monitorFailures"];
  return Object.fromEntries(fields.map(key => [key, value[key]]));
}
function originalVersion(policy, wanted) {
  if (!policy || !version(wanted) || wanted > policy.version) return null;
  if (wanted === policy.version) return clone(policy);
  const original = policy.history[wanted - 1];
  if (!original || original.version !== wanted) return null;
  return { ...clone(original), history: clone(policy.history.slice(0, wanted - 1)) };
}
export function normalizePolicyPlan(input) {
  keys(input, ["schema","title","reason","rows"], "policy plan");
  if (input.schema !== PLAN_SCHEMA || !Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > 200)
    fail("Choose a complete policy plan with 1 to 200 rows");
  const rowIds = new Set(), policyIds = new Set();
  const rows = input.rows.map(item => {
    keys(item, ["rowId","expectedVersion","policy"], "policy plan row");
    if (typeof item.rowId !== "string" || !ROW.test(item.rowId) || rowIds.has(item.rowId)) fail("Use unique safe row IDs");
    rowIds.add(item.rowId);
    const policy = normalizePolicy(item.policy);
    if (policy.id === null) {
      if (item.expectedVersion !== null) fail("A new policy requires expectedVersion:null");
    } else {
      if (!version(item.expectedVersion) || policyIds.has(policy.id)) fail("Select each existing policy once with its exact version");
      policyIds.add(policy.id);
    }
    return { rowId: item.rowId, expectedVersion: item.expectedVersion, policy };
  });
  return { schema: PLAN_SCHEMA, title: text(input.title, "plan title", 400),
    reason: text(input.reason, "plan reason", 8000), rows };
}
function changes(before, after) {
  return Object.keys(after).filter(field => !before || !same(before[field], after[field])).map(field => ({
    field, before: { present: before !== null, value: before ? clone(before[field]) : null },
    after: { present: true, value: clone(after[field]) }
  }));
}
export function previewPolicyRollout(state, input) {
  const plan = normalizePolicyPlan(input), projection = project(state);
  const jobs = new Map(projection.jobs.map(job => [job.key, job]));
  const policies = new Map(nativePolicies(state).map(policy => [policy.id, policy]));
  const selectedJobs = new Set();
  const rows = plan.rows.map(item => {
    const before = item.policy.id === null ? null : policies.get(item.policy.id);
    if (item.policy.id !== null && !before) fail("Selected policy is absent", 409, { rowId: item.rowId, policyId: item.policy.id });
    if (before && before.version !== item.expectedVersion) fail("Selected policy version changed", 409, { rowId: item.rowId, expectedVersion: item.expectedVersion, actualVersion: before.version });
    if (!jobs.has(item.policy.jobKey) && before?.jobKey !== item.policy.jobKey)
      fail("Select an observed job, or retain the original job of an existing policy", 409, { rowId: item.rowId, jobKey: item.policy.jobKey });
    selectedJobs.add(item.policy.jobKey);
    const previous = before ? savedInput(before) : null;
    const change = before ? (same(previous, item.policy) ? "UNCHANGED" : "UPDATE") : "CREATE";
    const after = { ...clone(item.policy), version: (before?.version ?? 0) + (change === "UNCHANGED" ? 0 : 1) };
    return { rowId: item.rowId, change, expectedVersion: item.expectedVersion, before: before ? clone(before) : null,
      after, fields: changes(previous, item.policy) };
  });
  const value = { schema: PREVIEW_SCHEMA, workspaceId: state.workspaceId, sourceRevision: state.revision, plan,
    source: { eventIds: state.events.map(event => event.id), sourceIds: state.sources.map(source => source.id),
      jobs: projection.jobs.filter(job => selectedJobs.has(job.key)) },
    rows, counts: { total: rows.length, create: rows.filter(row => row.change === "CREATE").length,
      update: rows.filter(row => row.change === "UPDATE").length, unchanged: rows.filter(row => row.change === "UNCHANGED").length } };
  return { ...value, previewSha256: digest(value) };
}
export function policyRolloutSummary(value) {
  return { id: value.id, title: value.title, reason: value.reason, createdAt: value.createdAt,
    operationId: value.operationId, sourceRevision: value.sourceRevision, committedRevision: value.committedRevision,
    previewSha256: value.previewSha256, rolloutSha256: value.rolloutSha256, counts: clone(value.preview.counts) };
}
function getRollout(state, id) {
  text(id, "rollout ID", 400);
  const value = rollouts(state).find(item => item.id === id);
  if (!value) fail("Unknown saved policy rollout", 404);
  return value;
}
export async function policyRolloutAction(workspace, action, args = {}) {
  const allowed = {
    "service-policy-rollout.read": [], "service-policy-rollout.preview": ["plan"],
    "service-policy-rollout.apply": ["operationId","expectedRevision","plan","expectedPreviewSha256"],
    "service-policy-rollout.get": ["id"], "service-policy-rollout.report": ["id","format"]
  }[action];
  if (!allowed) fail("Unknown policy-rollout action", 404);
  keys(args, allowed, "policy-rollout arguments");
  if (action === "service-policy-rollout.read") {
    const state = await workspace.read();
    return { workspaceId: state.workspaceId, revision: state.revision, jobs: project(state).jobs,
      policies: clone(nativePolicies(state)), rollouts: rollouts(state).map(policyRolloutSummary).reverse() };
  }
  if (action === "service-policy-rollout.preview") return previewPolicyRollout(await workspace.read(), args.plan);
  if (action === "service-policy-rollout.get") {
    const state = await workspace.read();
    return { workspaceId: state.workspaceId, revision: state.revision, rollout: clone(getRollout(state, args.id)) };
  }
  if (action === "service-policy-rollout.report") return policyRolloutReport(await workspace.read(), args);
  const plan = normalizePolicyPlan(args.plan);
  const operationId = text(args.operationId, "operationId", 400), expectedPreviewSha256 = hash(args.expectedPreviewSha256, "preview SHA256");
  return workspace.change(operationId, { action, plan, expectedPreviewSha256 }, args.expectedRevision, state => {
    const preview = previewPolicyRollout(state, plan);
    if (preview.previewSha256 !== expectedPreviewSha256) fail("Policy preview changed; inspect the current complete preview before saving", 409);
    if (!preview.counts.create && !preview.counts.update) fail("This plan changes no policies", 409);
    const at = new Date().toISOString();
    const service = state.serviceLevels ??= { schema: SERVICE_LEVELS_SCHEMA, policies: [], assessments: [], incidents: [] };
    const applied = preview.rows.map(row => {
      let after;
      if (row.change === "UNCHANGED") after = clone(row.before);
      else {
        const selected = plan.rows.find(item => item.rowId === row.rowId);
        after = servicePolicyRevision(row.before, selected.policy, plan.reason, operationId, state.workspaceId, {
          at, newId: digest([state.workspaceId, "service-policy-rollout-policy", operationId, row.rowId])
        });
        const index = service.policies.findIndex(policy => policy.id === after.id);
        if (row.change === "CREATE" && index >= 0) fail("The new policy identity already exists", 409);
        if (index < 0) service.policies.push(after); else service.policies[index] = after;
      }
      return { rowId: row.rowId, change: row.change, before: clone(row.before), after: clone(after) };
    });
    const value = { schema: ROLLOUT_SCHEMA, id: digest([state.workspaceId, "service-policy-rollout", operationId]),
      title: plan.title, reason: plan.reason, createdAt: at, operationId, sourceRevision: state.revision,
      committedRevision: state.revision + 1, previewSha256: preview.previewSha256, preview, policies: applied };
    const rollout = { ...value, rolloutSha256: digest(value) };
    (state.servicePolicyRollouts ??= []).push(rollout);
    return { rollout: policyRolloutSummary(rollout), policies: applied.map(row => ({
      id: row.after.id, version: row.after.version, jobKey: row.after.jobKey })) };
  });
}
export function validatePolicyRollouts(state, { deep = false } = {}) {
  if (state.servicePolicyRollouts === undefined) return;
  if (!Array.isArray(state.servicePolicyRollouts)) fail("Invalid policy-rollout history", 409);
  const ids = new Set(), operations = new Set(), policies = new Map(nativePolicies(state).map(policy => [policy.id, policy]));
  const allEvents = new Map(state.events.map(event => [event.id, event])), allSources = new Map(state.sources.map(source => [source.id, source]));
  for (const value of state.servicePolicyRollouts) {
    if (!record(value) || value.schema !== ROLLOUT_SCHEMA || ids.has(value.id) || operations.has(value.operationId)) fail("Invalid or duplicate policy rollout", 409);
    const { rolloutSha256, ...payload } = value;
    if (!HASH.test(rolloutSha256) || digest(payload) !== rolloutSha256 || value.id !== digest([state.workspaceId, "service-policy-rollout", value.operationId]))
      fail("Saved policy-rollout identity differs", 409);
    text(value.operationId, "rollout operation", 400); checkTime(value.createdAt);
    ids.add(value.id); operations.add(value.operationId);
    const p = value.preview;
    if (!record(p) || p.schema !== PREVIEW_SCHEMA || !record(p.source) || !Array.isArray(p.source.eventIds) || !Array.isArray(p.source.sourceIds) ||
        !Array.isArray(p.rows) || !Array.isArray(value.policies)) fail("Incomplete saved rollout preview", 409);
    const { previewSha256, ...previewPayload } = p;
    if (previewSha256 !== value.previewSha256 || digest(previewPayload) !== previewSha256 ||
        p.workspaceId !== state.workspaceId || p.sourceRevision !== value.sourceRevision ||
        !Number.isSafeInteger(value.sourceRevision) || value.sourceRevision < 0 ||
        value.committedRevision !== value.sourceRevision + 1 || value.committedRevision > state.revision)
      fail("Saved rollout preview or revision differs", 409);
    const plan = normalizePolicyPlan(p.plan);
    if (!same(plan, p.plan) || value.title !== plan.title || value.reason !== plan.reason ||
        p.rows.length !== plan.rows.length || value.policies.length !== plan.rows.length) fail("Saved rollout plan differs", 409);
    for (let i = 0; i < plan.rows.length; i++) {
      const selected = plan.rows[i], row = p.rows[i], applied = value.policies[i];
      if (row.rowId !== selected.rowId || applied.rowId !== selected.rowId || row.change !== applied.change ||
          !same(row.before, applied.before)) fail("Saved rollout row differs", 409);
      const prior = selected.policy.id === null ? null : originalVersion(policies.get(selected.policy.id), selected.expectedVersion);
      if (!same(prior, row.before)) fail("Original selected policy history is missing or changed", 409);
      const change = prior ? (same(savedInput(prior), selected.policy) ? "UNCHANGED" : "UPDATE") : "CREATE";
      if (row.change !== change || row.expectedVersion !== selected.expectedVersion ||
          !same(row.after, { ...selected.policy, version: (prior?.version ?? 0) + (change === "UNCHANGED" ? 0 : 1) }) ||
          !same(row.fields, changes(prior ? savedInput(prior) : null, selected.policy))) fail("Saved policy differences are inconsistent", 409);
      const expected = change === "UNCHANGED" ? prior : servicePolicyRevision(prior, selected.policy, plan.reason,
        value.operationId, state.workspaceId, { at: value.createdAt,
          newId: digest([state.workspaceId, "service-policy-rollout-policy", value.operationId, selected.rowId]) });
      if (!same(expected, applied.after) || !same(originalVersion(policies.get(expected.id), expected.version), expected))
        fail("Rollout applied policy is missing from the original history", 409);
    }
    const counts = { total: p.rows.length, create: p.rows.filter(row => row.change === "CREATE").length,
      update: p.rows.filter(row => row.change === "UPDATE").length, unchanged: p.rows.filter(row => row.change === "UNCHANGED").length };
    if (!same(counts, p.counts) || !counts.create && !counts.update) fail("Invalid rollout counts", 409);
    for (const [selected, available] of [[p.source.eventIds, allEvents], [p.source.sourceIds, allSources]])
      if (new Set(selected).size !== selected.length || selected.some(id => !available.has(id))) fail("Rollout original source selection changed", 409);
    const operation = state.operations.find(item => item.id === value.operationId);
    if (!operation || operation.requestHash !== digest({ action: "service-policy-rollout.apply", plan, expectedPreviewSha256: value.previewSha256 }) ||
        operation.result?.workspaceId !== state.workspaceId || operation.result?.revision !== value.committedRevision ||
        !same(operation.result?.rollout, policyRolloutSummary(value)) ||
        !same(operation.result?.policies, value.policies.map(row => ({ id: row.after.id, version: row.after.version, jobKey: row.after.jobKey }))))
      fail("Rollout original operation receipt differs", 409);
    if (deep) {
      const sourceIds = new Set(p.source.sourceIds);
      const snapshot = { ...state, revision: value.sourceRevision,
        events: p.source.eventIds.map(id => ({ ...clone(allEvents.get(id)), sources: allEvents.get(id).sources.filter(source => sourceIds.has(source.sourceId)) })),
        sources: p.source.sourceIds.map(id => clone(allSources.get(id))),
        serviceLevels: { schema: SERVICE_LEVELS_SCHEMA, policies: p.rows.filter(row => row.before).map(row => clone(row.before)), assessments: [], incidents: [] } };
      if (snapshot.events.some(row => !row.sources.length) || !same(previewPolicyRollout(snapshot, plan), p))
        fail("Rollout preview differs from original events and selected policy history", 409);
    }
  }
}
export function policyRolloutReport(state, { id, format = "json" } = {}) {
  if (!["json","csv","html"].includes(format)) fail("Choose json, csv or html");
  const value = getRollout(state, id);
  if (format === "json") return { mediaType: "application/json", text: JSON.stringify(value, null, 2) + "\n" };
  if (format === "csv") return { mediaType: "text/csv", text: csv(value.policies.map(row => ({
    rolloutId: value.id, title: value.title, reason: value.reason, rowId: row.rowId, change: row.change,
    policyId: row.after.id, jobKey: row.after.jobKey, beforeVersion: row.before?.version ?? null,
    afterVersion: row.after.version, before: row.before, after: row.after, previewSha256: value.previewSha256,
    rolloutSha256: value.rolloutSha256 })), ["rolloutId","title","reason","rowId","change","policyId","jobKey","beforeVersion","afterVersion","before","after","previewSha256","rolloutSha256"]) };
  return { mediaType: "text/html", text: policyRolloutHtml(value) };
}
export function policyRolloutHtml(value) {
  const escape = x => String(x ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  const details = x => "<pre>" + escape(JSON.stringify(x, null, 2)) + "</pre>";
  return "<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>" +
    "<meta http-equiv='Content-Security-Policy' content=\"default-src 'none'; style-src 'unsafe-inline'\"><title>" + escape(value.title) + " — Policy rollout</title>" +
    "<style>body{font:15px/1.55 system-ui,sans-serif;max-width:1120px;margin:32px auto;padding:0 20px;color:#17212b;background:#fff}h1{font-size:28px}h2{font-size:21px;margin-top:32px}article{border:1px solid #bac3cb;padding:18px;margin:16px 0;break-inside:avoid}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,monospace}.pair{display:grid;grid-template-columns:1fr 1fr;gap:18px}.pair>*{min-width:0}dt{font-weight:650}dd{margin:0 0 12px;overflow-wrap:anywhere}@media(max-width:650px){.pair{display:block}body{padding:0 14px}}@media print{body{margin:0;max-width:none}details{display:block}}</style></head><body><h1>" +
    escape(value.title) + "</h1><p>" + escape(value.reason) + "</p><dl><dt>Original workspace</dt><dd>" + escape(value.preview.workspaceId) +
    "</dd><dt>Saved revision</dt><dd>" + value.committedRevision + "</dd><dt>Saved at</dt><dd>" + escape(value.createdAt) +
    "</dd><dt>Original operation</dt><dd>" + escape(value.operationId) + "</dd><dt>Rollout checksum</dt><dd>" + escape(value.rolloutSha256) +
    "</dd></dl><p>This record changes only the selected policies. Original assessments, incidents and upstream jobs are unchanged. A later explicitly selected assessment uses the then-current policies.</p><h2>Selected policies</h2>" +
    value.policies.map(row => "<article><h3>" + escape(row.after.title) + " · " + escape(row.change) + "</h3><p>" + escape(row.after.jobKey) +
      "</p><div class='pair'><section><h4>Before</h4>" + details(row.before) + "</section><section><h4>Applied</h4>" + details(row.after) +
      "</section></div></article>").join("") +
    "<h2>Complete original preview and source selection</h2>" + details(value.preview) + "</body></html>";
}
