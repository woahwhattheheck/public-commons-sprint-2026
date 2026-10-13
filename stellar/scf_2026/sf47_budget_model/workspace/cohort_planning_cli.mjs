#!/usr/bin/env node
/**
 * Local file interface to cohort_planning.mjs. No network or provider actions.
 */
import { readFile, stat, open, link, unlink } from "node:fs/promises";
import { resolve, dirname, basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  COHORT_PLAN_SCHEMA, COHORT_PLAN_REPORT_SCHEMA, COHORT_PLAN_COMPARISON_SCHEMA, CohortPlanningError,
  seedCohortPlan, evaluateCohortPlan, exportCohortPlanCsv, compareCohortPlans, exportCohortPlanComparisonCsv
} from "./cohort_planning.mjs";

import { seedCohortPlanFromCalendar } from "./cohort_planning_calendar.mjs";
import { COHORT_DELIVERY_SCHEDULE_SCHEMA, seedCohortDeliveryScheduling, scheduleCohortDelivery, reopenCohortDeliverySchedule, exportCohortDeliveryScheduleCsv } from "./cohort_planning_scheduling.mjs";

import {COHORT_RECORDED_COST_PLAN_SCHEMA,seedCohortRecordedCostPlan,planCohortFromRecordedCosts,reopenCohortRecordedCostPlan,exportCohortRecordedCostPlanCsv,inspectCohortTaskMeasurements,bindCohortRecordedCostMeasurement} from "./cohort_delivery_comparison.mjs";

const EDITION_SCHEMA = "stellar-forge.sf47-cohort-plan-edition.v1";
const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const HELP = [
  "Cohort planning — original-case calendar and economics",
  "",
  "Usage:",
  "  node cohort_planning_cli.mjs seed --native-seed seed.json [options]",
  "  node cohort_planning_cli.mjs calendar --native-seed seed.json --calendar selection.json [--group WINDOW_ID] [options]",
  "  node cohort_planning_cli.mjs evaluate --input plan.json [--native-seed seed.json] [--output report.json]",
  "  node cohort_planning_cli.mjs csv --input report.json [--output report.csv]",
  "  node cohort_planning_cli.mjs compare --baseline earlier.json --candidate later.json [--output comparison.json]",
  "  node cohort_planning_cli.mjs schedule-seed --input plan.json [--output choices.json]",
  "  node cohort_planning_cli.mjs schedule --input plan.json [--constraints choices.json] [--method first-fit|resolve-conflicts] [--name TEXT] [--output allocation.json]",
  "  node cohort_planning_cli.mjs schedule-plan --input allocation.json [--output successor.json]",
  "  node cohort_planning_cli.mjs schedule-compare --input allocation.json [--output comparison.json]",
  "",
  "  node cohort_planning_cli.mjs recorded-cost-seed --recorded delivery.json --baseline future-plan.json [--output choices.json]",
  "  node cohort_planning_cli.mjs recorded-cost-plan --recorded delivery.json --baseline future-plan.json --choices choices.json [--output cost-plan.json]",
  "  node cohort_planning_cli.mjs task-measurements --input saved-task-response.json [--output measurements.json]",
  "  node cohort_planning_cli.mjs recorded-cost-bind --choices choices.json --allocation ID --measurement saved-task-response.json --kind INSTALLED|FOLLOWUP [--observation ID] [--case RECEIVING_CASE_ID] --service-basis TEXT [--output bound-choices.json]",
  "  node cohort_planning_cli.mjs recorded-cost-reopen --input cost-plan.json [--output verified-cost-plan.json]",
  "",
  "Recorded-cost planning counts completed useful tasks and converts supplier cost to each future schedule’s underlying request units.",
  "Complete originals, task/request quantities, existing funding and purchased prices remain retained.",
  "Partial cost coverage remains unknown. CSV/evaluate accept the complete resulting cost-plan document.",
  "",
  "Seed options:",
  "  --as-of ISO_TIMESTAMP       Explicit observation time; defaults to native seed time.",
  "  --window-start YYYY-MM-DD  Start of the original consecutive calendar window.",
  "  --draft-id ID              Stable draft identity; default derives from source and seed time.",
  "  --plan-id ID               Original case plan identity when supplied by Grant Operations.",
  "  --plan-revision INTEGER    Original case plan revision.",
  "  --name TEXT               Customer-facing plan title.",
  "  --output FILE             Create a new output file; omit or use - for stdout.",
  "",
  "calendar receives the complete Customer-use Calendar and matching native customer-use-calendar-cohort response.",
  "Named funding groups remain separate from uses; missing commercial terms remain editable and unpriced.",
  "calendar accepts --as-of, --draft-id, --name and --output seed options.",
  "evaluate accepts a plan, complete planning report, or saved planning edition.",
  "compare accepts two complete plans, planning reports, or saved planning editions.",
  "csv accepts a planning report, saved planning edition, or complete plan comparison.",
  "Comparison JSON carries both original documents and recalculated reports.",
  "compare also accepts --name TEXT and --note TEXT for the retained comparison review.",
  "Use --input - to read JSON from stdin. A native seed must be a separate file.",
  "schedule uses explicit service flexibility and the original daily capacity, funding and economics.",
  "schedule --method resolve-conflicts revisits complete competing service groups.",
  "Use --max-search-steps INTEGER with resolve-conflicts; default 100000, maximum 1000000.",
  "The complete allocation retains the selected method and search result for exact reopen.",
  "schedule-seed retains existing choices and defaults new services to fixed dates.",
  "schedule-plan and schedule-compare reopen the whole calculation before producing its successor or comparison.",
  "csv also accepts a complete delivery scheduling result, including all unresolved date constraints.",
  "Files are created atomically and existing destinations are preserved.",
  "All amounts and hours in plan JSON use decimal text; atomic prices use integer text.",
  "capacityPools and schedule capacityPoolId compare shared daily active hours with recurring demand.",
  "sensitivity.minimumMarginPct optionally calculates complete-service price floors.",
  "Complete reports and CSV retain capacity, shortages, price groups and original source assumptions.",
  "The planner retains its source and rule. A supplied current seed adds a drift comparison.",
  ""
].join("\n");

function fail(code, message, path = "") { throw new CohortPlanningError(code, message, path); }

function parse(argv) {
  if (!argv.length || argv.includes("--help") || argv[0] === "help") return { command: "help", options: {} };
  const command = argv[0], options = {};
  const allowed = {
    seed: ["native-seed", "as-of", "window-start", "draft-id", "plan-id", "plan-revision", "name", "output"],
    calendar: ["native-seed", "calendar", "group", "as-of", "draft-id", "name", "output"],
    evaluate: ["input", "native-seed", "output"],
    csv: ["input", "output"],
    compare: ["baseline", "candidate", "name", "note", "output"],
    "task-measurements": ["input","output"],
    "recorded-cost-bind": ["choices","allocation","measurement","kind","observation","case","service-basis","output"],
    "recorded-cost-seed": ["recorded","baseline","output"],
    "recorded-cost-plan": ["recorded","baseline","choices","output"],
    "recorded-cost-reopen": ["input","output"],
    "schedule-seed": ["input", "output"],
    schedule: ["input", "constraints", "method", "max-search-steps", "name", "output"],
    "schedule-plan": ["input", "output"],
    "schedule-compare": ["input", "output"]
  }[command];
  if (!allowed) fail("INVALID_COMMAND", "Choose seed, calendar, evaluate, compare, schedule-seed, schedule, schedule-plan, schedule-compare or csv.", "command");
  for (let i = 1; i < argv.length; i += 2) {
    const flag = argv[i], key = flag.startsWith("--") ? flag.slice(2) : "";
    if (!allowed.includes(key)) fail("INVALID_ARGUMENT", "Unsupported argument " + flag + ".", "arguments");
    if (Object.prototype.hasOwnProperty.call(options, key)) fail("INVALID_ARGUMENT", "Repeated argument " + flag + ".", "arguments");
    if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) fail("INVALID_ARGUMENT", flag + " requires one value.", flag);
    options[key] = argv[i + 1];
  }
  const required = command === "recorded-cost-bind" ? ["choices","allocation","measurement","kind","service-basis"] : command === "recorded-cost-plan" ? ["recorded","baseline","choices"] : command === "recorded-cost-seed" ? ["recorded","baseline"] : command === "calendar" ? ["native-seed", "calendar"] : command === "seed" ? ["native-seed"] : command === "compare" ? ["baseline", "candidate"] : ["input"];
  for (const key of required) if (!options[key]) fail("INVALID_ARGUMENT", "--" + key + " is required.", key);
  if (command === "compare" && options.baseline === "-" && options.candidate === "-")
    fail("INVALID_ARGUMENT", "Read at most one comparison source from stdin; use a file for the other.", "input");
  if (["recorded","baseline","choices","measurement"].filter(key=>options[key]==="-").length>1)fail("INVALID_ARGUMENT","Read at most one complete recorded-cost input from stdin.","input");
  if (options.constraints === "-") fail("INVALID_ARGUMENT", "Use a separate file for scheduling constraints.", "constraints");
  if (options["native-seed"] === "-") fail("INVALID_ARGUMENT", "Use a separate file for the native seed.", "native-seed");
  return { command, options };
}

async function readJson(filename) {
  let body;
  if (filename === "-") {
    const chunks = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_INPUT_BYTES) fail("INPUT_TOO_LARGE", "JSON input exceeds 64 MiB.", "input");
      chunks.push(buffer);
    }
    body = Buffer.concat(chunks).toString("utf8");
  } else {
    const info = await stat(filename);
    if (!info.isFile()) fail("INVALID_INPUT", "JSON input must be a regular file.", filename);
    if (info.size > MAX_INPUT_BYTES) fail("INPUT_TOO_LARGE", "JSON input exceeds 64 MiB.", filename);
    body = await readFile(filename, "utf8");
    if (Buffer.byteLength(body, "utf8") > MAX_INPUT_BYTES) fail("INPUT_TOO_LARGE", "JSON input exceeds 64 MiB.", filename);
  }
  try { return JSON.parse(body.replace(/^\uFEFF/, "")); }
  catch { fail("INVALID_JSON", "Input must contain one complete JSON document.", filename); }
}

function planFrom(value) {
  if (value?.schema === COHORT_RECORDED_COST_PLAN_SCHEMA) return reopenCohortRecordedCostPlan(value).candidate;
  if (value?.schema === COHORT_PLAN_SCHEMA) return value;
  if (value?.schema === COHORT_PLAN_REPORT_SCHEMA && value.kind === "PLAN") return value.input;
  if (value?.schema === EDITION_SCHEMA) return value.plan;
  fail("INVALID_PLAN_SCHEMA", "Select a cohort plan, complete planning report or saved planning edition.", "input");
}

function reportFrom(value) {
  if (value?.schema === COHORT_PLAN_REPORT_SCHEMA && value.kind === "PLAN") return value;
  if (value?.schema === EDITION_SCHEMA && value.report?.schema === COHORT_PLAN_REPORT_SCHEMA) return value.report;
  fail("INVALID_PLAN_REPORT", "Select a complete planning report or saved planning edition.", "input");
}

async function output(body, filename) {
  if (!filename || filename === "-") {
    await new Promise((done, reject) => process.stdout.write(body, error => error ? reject(error) : done()));
    return;
  }
  const destination = resolve(filename);
  const temporary = join(dirname(destination), "." + basename(destination) + "." + randomUUID() + ".tmp");
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(body, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(temporary, destination);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
  process.stdout.write(JSON.stringify({ saved: destination, bytes: Buffer.byteLength(body, "utf8") }) + "\n");
}

async function main(argv) {
  const { command, options } = parse(argv);
  if (command === "help") { process.stdout.write(HELP); return; }
  let result;
  if (command === "seed" || command === "calendar") {
    const nativeSeed = await readJson(options["native-seed"]);
    const settings = {};
    for (const [flag, key] of [
      ["as-of", "asOfAt"], ["window-start", "windowStart"], ["draft-id", "draftId"],
      ["plan-id", "planId"], ["name", "name"]
    ]) if (options[flag] !== undefined) settings[key] = options[flag];
    if (options["plan-revision"] !== undefined) {
      if (!/^[1-9]\d*$/.test(options["plan-revision"])) fail("INVALID_ARGUMENT", "Plan revision must be a positive integer.", "plan-revision");
      settings.planRevision = Number(options["plan-revision"]);
      if (!Number.isSafeInteger(settings.planRevision)) fail("INVALID_ARGUMENT", "Plan revision exceeds the supported integer range.", "plan-revision");
    }
    result = command === "calendar" ? seedCohortPlanFromCalendar(nativeSeed, await readJson(options.calendar), { ...settings, ...(options.group ? { groupId: options.group } : {}) }) : seedCohortPlan(nativeSeed, settings);
  } else if (command === "recorded-cost-seed" || command === "recorded-cost-plan") {
    const recorded=await readJson(options.recorded),baseline=await readJson(options.baseline);
    result=command==="recorded-cost-seed"?seedCohortRecordedCostPlan(recorded,baseline):planCohortFromRecordedCosts(recorded,baseline,await readJson(options.choices));
  } else if (command === "task-measurements") {
    result=inspectCohortTaskMeasurements(await readJson(options.input));
  } else if (command === "recorded-cost-bind") {
    result=await readJson(options.choices);
    if(!Array.isArray(result.allocations))fail("INVALID_ARGUMENT","Open the complete recorded-cost choices.","choices");
    const found=result.allocations.filter(row=>row.id===options.allocation);
    if(found.length!==1)fail("INVALID_ARGUMENT","Select one original allocation identity.","allocation");
    const next=bindCohortRecordedCostMeasurement(found[0],await readJson(options.measurement),
      {kind:options.kind,observationId:options.observation||"",serviceBasis:options["service-basis"],...(options.case?{caseId:options.case}:{})});
    result.allocations=result.allocations.map(row=>row.id===options.allocation?next:row);
  } else if (command === "recorded-cost-reopen") {
    result=reopenCohortRecordedCostPlan(await readJson(options.input));
  } else if (command === "evaluate") {
    const input = planFrom(await readJson(options.input));
    const nativeSeed = options["native-seed"] ? await readJson(options["native-seed"]) : undefined;
    result = evaluateCohortPlan(input, { nativeSeed });
  } else if (command === "schedule-seed") {
    result = seedCohortDeliveryScheduling(await readJson(options.input));
  } else if (command === "schedule") {
    const settings = options.name === undefined ? {} : {name: options.name};
    if (options.method !== undefined) {
      const methods = {"first-fit": "FIRST_FIT", "resolve-conflicts": "RESOLVE_CONFLICTS"};
      if (!Object.hasOwn(methods, options.method)) fail("INVALID_ARGUMENT", "Choose --method first-fit or resolve-conflicts.", "method");
      settings.method = methods[options.method];
    }
    if (options["max-search-steps"] !== undefined) {
      if (!/^[1-9]\d*$/.test(options["max-search-steps"]))
        fail("INVALID_ARGUMENT", "Search effort must be a positive whole number.", "max-search-steps");
      settings.maxSearchSteps = Number(options["max-search-steps"]);
    }
    result = scheduleCohortDelivery(await readJson(options.input), options.constraints ? await readJson(options.constraints) : undefined, settings);
  } else if (command === "schedule-plan" || command === "schedule-compare") {
    const original = reopenCohortDeliverySchedule(await readJson(options.input));
    result = command === "schedule-plan" ? original.candidate :
      compareCohortPlans(original.sourceDocument, original.candidate, {title: original.candidate.name + " · delivery allocation", note: original.constraints.note});
  } else if (command === "compare") {
    const baseline = await readJson(options.baseline), candidate = await readJson(options.candidate);
    result = compareCohortPlans(baseline, candidate, { ...(options.name !== undefined ? { title: options.name } : {}), ...(options.note !== undefined ? { note: options.note } : {}) });
  } else {
    const document = await readJson(options.input);
    result = document?.schema === COHORT_RECORDED_COST_PLAN_SCHEMA ? exportCohortRecordedCostPlanCsv(document) : document?.recordedCostPlan ? exportCohortRecordedCostPlanCsv(document.recordedCostPlan)+["saved_successor","current",JSON.stringify(document)].map(v=>'"'+String(v).replaceAll('"','""')+'"').join(",")+"\r\n" : document?.schema === COHORT_PLAN_COMPARISON_SCHEMA ? exportCohortPlanComparisonCsv(document) : document?.schema === COHORT_DELIVERY_SCHEDULE_SCHEMA ? exportCohortDeliveryScheduleCsv(document) : exportCohortPlanCsv(reportFrom(document));
  }
  await output(typeof result === "string" ? result : JSON.stringify(result, null, 2) + "\n", options.output);
}

main(process.argv.slice(2)).catch(error => {
  const code = error.code === "EEXIST" ? "OUTPUT_EXISTS" : error.code || "COHORT_PLAN_FAILED";
  const message = error.code === "EEXIST" ? "The output file already exists. Choose a new edition filename." : error.message;
  process.stderr.write(JSON.stringify({ error: { code, message, path: error.path || "" } }) + "\n");
  process.exitCode = 1;
});
