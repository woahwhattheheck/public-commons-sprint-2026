#!/usr/bin/env node
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { runCommercialEconomics, compactCommercialResult } from "./commercial-economics.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (args.length !== 2) throw new Error("Usage: node run.mjs INPUT.json NEW_OUTPUT_DIRECTORY");
const inputPath = resolve(args[0]), output = resolve(args[1]);
const inputBytes = await readFile(inputPath);
const engineBytes = await readFile(resolve(here, "../../cohort_planning.mjs"));
const engineBlob = createHash("sha1").update("blob " + engineBytes.length + "\0").update(engineBytes).digest("hex");
const input = JSON.parse(inputBytes);
if (engineBlob !== input.cohortEngineGitBlob) throw new Error("Selected original cohort model differs; review and pin that complete source before rerunning.");
const scenarioBytes = await readFile(resolve(here, "../../../sf10_current_candidate.json"));
const candidateSha256 = createHash("sha256").update(scenarioBytes).digest("hex");
const result = runCommercialEconomics(input, JSON.parse(scenarioBytes), candidateSha256);
const metadata = { inputSha256:createHash("sha256").update(inputBytes).digest("hex"), candidateSha256, engineGitBlob:engineBlob,
  scope:"Planning calculation using the unchanged original model. No native merchant/buyer execution, case mutation, granted award or observed customer cash." };
await mkdir(output, { recursive:false, mode:0o700 });
async function save(name, body) { await writeFile(resolve(output, name), body, { flag:"wx", mode:0o600 }); }
await save("inputs.json", inputBytes);
await save("source.json", JSON.stringify(metadata, null, 2) + "\n");
await save("summary.json", JSON.stringify(compactCommercialResult(result), null, 2) + "\n");
await save("forecast-commercial-templates.json", JSON.stringify(result.forecast, null, 2) + "\n");
await save("workshares.plan.json", JSON.stringify(result.workshare.input, null, 2) + "\n");
await save("workshares.report.json", JSON.stringify(result.workshare.report, null, 2) + "\n");
await save("workshares.csv", result.workshare.csv);
for (const row of result.cases) {
  await save(row.id + ".plan.json", JSON.stringify(row.input, null, 2) + "\n");
  await save(row.id + ".report.json", JSON.stringify(row.report, null, 2) + "\n");
  await save(row.id + ".csv", row.csv);
}
console.log(JSON.stringify({ ...metadata, output, cases:result.cases.length, status:"PLANNING_COMPLETE" }));
