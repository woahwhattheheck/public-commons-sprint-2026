#!/usr/bin/env node
// Rebuild the complete original study, then add its paired-sensitivity companion.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseCsv, writeCsv } from "./csv.mjs";
import { analyzePairedSensitivity, writePairedSensitivityJson } from "./paired_sensitivity.mjs";
import { renderPairedSensitivity } from "./paired_sensitivity_report.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const relative = "observations/eighteenmile_stream_nutrients_2020_2025/analysis";
const argv = process.argv.slice(2);
if (argv.length !== 2 || argv[0] !== "--output" || !argv[1]) {
  throw Error("Usage: node build_paired_sensitivity.mjs --output NEW_APPLICATION_DIRECTORY");
}
const destinationApp = resolve(argv[1]);
const input = JSON.parse(await readFile(join(root, "paired-sensitivity-input.json"), "utf8"));
if (input.path !== "paired-station-contrasts.csv") throw Error("Unexpected original paired source path");
const check = data => {
  if (data.length !== input.bytes || createHash("sha256").update(data).digest("hex") !== input.sha256) {
    throw Error("Original paired source bytes differ from the retained input edition");
  }
};
const original = await readFile(join(root, input.path));
check(original);
const originalText = new TextDecoder("utf-8", {fatal: true}).decode(original);
const result = analyzePairedSensitivity(parseCsv(originalText), input);
if (result.counts.original_comparisons !== input.data_rows) throw Error("Original paired row count differs");

// The original builder verifies all twelve original source bodies and requires a
// new destination. Its complete report, tables, sources and rebuild CLI accompany
// this companion; the retained application and original input files stay in place.
const built = spawnSync(process.execPath,
  [join(root, "build_study.mjs"), "--output", destinationApp], {stdio: "inherit"});
if (built.error) throw built.error;
if (built.status !== 0) throw Error("Original study rebuild did not complete: " + (built.signal || built.status));
const destination = join(destinationApp, relative);
check(await readFile(join(destination, input.path)));

async function writeExact(name, data) {
  try {
    await writeFile(join(destination, name), data, {flag: "wx"});
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const retained = await readFile(join(destination, name));
    const expected = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    if (!retained.equals(expected)) throw Error("New study already contains a different " + name);
  }
}
const outputs = {
  "paired-sensitivity.json": writePairedSensitivityJson(result),
  "paired-sensitivity-scenarios.csv": writeCsv(result.scenarios),
  "paired-sensitivity.html": renderPairedSensitivity(result)
};
for (const [name, text] of Object.entries(outputs)) await writeExact(name, text);
for (const name of ["paired_sensitivity.mjs", "paired_sensitivity_report.mjs",
  "build_paired_sensitivity.mjs", "paired-sensitivity-input.json", "PAIRED_SENSITIVITY.md"]) {
  await writeExact(name, await readFile(join(root, name)));
}
const manifestName = "eighteenmile_paired_sensitivity.sources.json";
const sourceManifest = JSON.parse(await readFile(join(root, "../../..", manifestName), "utf8"));
async function rehash(member) {
  if (typeof member.path !== "string" || member.path.startsWith("/") ||
      member.path.split("/").some(part => part === ".." || part === "." || !part)) {
    throw Error("Invalid companion source path");
  }
  const data = await readFile(join(destinationApp, member.path));
  member.bytes = data.length;
  member.sha256 = createHash("sha256").update(data).digest("hex");
}
for (const entry of sourceManifest.entries) {
  await rehash(entry);
  for (const companion of entry.companions || []) await rehash(companion);
}
await writeFile(join(destinationApp, manifestName), JSON.stringify(sourceManifest, null, 2) + "\n", {flag: "wx"});
process.stdout.write(JSON.stringify({output: destination, counts: result.counts,
  report: join(destination, "paired-sensitivity.html"), outputs: Object.keys(outputs)}, null, 2) + "\n");
