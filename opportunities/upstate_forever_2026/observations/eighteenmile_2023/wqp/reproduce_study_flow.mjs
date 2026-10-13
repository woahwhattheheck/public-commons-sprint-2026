#!/usr/bin/env node
import { readFile, open, mkdir, rename, unlink } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { parseCsv, buildStudyFlowContext } from "./flow_context.mjs";
import { originalDailyFlow } from "./flow_original_source.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
let flowPath, outputPath;
if (args.length === 2 && args[0] === "--output-dir") outputPath = args[1];
else if (args.length === 4 && args[0] === "--flow-csv" && args[2] === "--output-dir") {
  flowPath = args[1]; outputPath = args[3];
} else {
  throw new Error("Usage: node reproduce_study_flow.mjs [--flow-csv DAILY_FLOW_CSV] --output-dir OUTPUT_DIRECTORY");
}
const input = JSON.parse(await readFile(resolve(root, "flow_context_methods.public.json"), "utf8"));
const hash = data => createHash("sha256").update(data).digest("hex");
async function exact(path, source) {
  const data = await readFile(path);
  if (data.length !== source.bytes || hash(data) !== source.sha256) {
    throw new Error("Original source bytes differ: " + path);
  }
  return data;
}
let daily, inputIdentity;
if (flowPath) {
  const data = await exact(resolve(flowPath), input.inputs.daily_flow);
  daily = parseCsv(data.toString("utf8")).rows;
  inputIdentity = input.inputs.daily_flow;
} else {
  const source = input.inputs.original_daily_response;
  const data = await exact(resolve(root, source.path), source);
  daily = originalDailyFlow(JSON.parse(data.toString("utf8")), source);
  inputIdentity = source;
}
const lab = [];
for (const source of input.inputs.date_sources) {
  const data = await exact(resolve(root, source.path), source);
  lab.push(...parseCsv(data.toString("utf8")).rows.map(row => ({
    ...row, original_source_site: source.site,
  })));
}
const dates = [...new Set(lab.map(row => row.ActivityStartDate))].sort();
const result = buildStudyFlowContext(daily, dates, input.gauge);
const rows = result.rows.map(row => ({
  ...row,
  source_activity_count: lab.filter(item => item.ActivityStartDate === row.sampling_date).length,
  chla_sites: lab.filter(item => item.ActivityStartDate === row.sampling_date && item.ProjectIdentifier === "CHLA")
    .map(item => item.original_source_site).sort().join(";"),
  micro_sites: lab.filter(item => item.ActivityStartDate === row.sampling_date && item.ProjectIdentifier === "SCDHEC-MICRO")
    .map(item => item.original_source_site).sort().join(";"),
}));
if (!rows.length) throw new Error("The retained laboratory source contains no reporting dates");
const columns = Object.keys(rows[0]);
const cell = value => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
};
const body = Buffer.from([columns.join(","), ...rows.map(row => columns.map(key => cell(row[key])).join(","))].join("\n") + "\n", "utf8");
const expected = input.reproduction.output;
if (body.length !== expected.bytes || hash(body) !== expected.sha256) {
  throw new Error("Rebuilt dated-flow output differs from the retained source edition");
}
const output = resolve(outputPath);
await mkdir(output, { recursive: true });
const path = resolve(output, "study_flow_dates.csv"), pending = path + ".partial-" + process.pid;
const handle = await open(pending, "wx");
try {
  await handle.writeFile(body);
  await handle.close();
  await rename(pending, path);
} catch (error) {
  await handle.close().catch(() => {});
  await unlink(pending).catch(() => {});
  throw error;
}
console.log(JSON.stringify({
  output: path, dates: rows.length, original_lab_rows: lab.length,
  bytes: body.length, sha256: hash(body), original_flow_input: inputIdentity,
}, null, 2));
