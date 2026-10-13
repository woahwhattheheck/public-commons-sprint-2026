#!/usr/bin/env node
// Reproduce the paired study from complete original agency CSVs.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { buildWqpTables, parseCsv, writeCsv } from "./originals/normalize_core.mjs";
import { analyzePairedStudy } from "./paired_analysis.mjs";
import { renderPairedStudy } from "./paired_report.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--output") {
  throw new Error("Usage: node build_paired_analysis.mjs --output OUTPUT_DIRECTORY");
}
const output = resolve(args[1]);
const input = JSON.parse(await readFile(join(root, "input-manifest.json"), "utf8"));
const digest = body => createHash("sha256").update(body).digest("hex");
async function original(entry) {
  if (!/^(originals\/[A-Za-z0-9_.-]+)$/.test(entry.path)) throw new Error("Unexpected input path");
  const body = await readFile(join(root, entry.path));
  if (body.length !== entry.bytes || digest(body) !== entry.sha256) throw new Error("Original source identity mismatch: " + entry.path);
  return body.toString("utf8");
}
await original(input.normalizer);
const captures = [];
for (const entry of input.originals) captures.push({ ...entry, rows: parseCsv(await original(entry)) });
const tables = buildWqpTables(captures);
const result = analyzePairedStudy(tables.selected_chlorophyll, tables.measurements);
if (JSON.stringify(result.coverage) !== JSON.stringify(input.coverage)) throw new Error("Source cohort coverage changed");
const files = renderPairedStudy(result, writeCsv);
await mkdir(output, { recursive: true });
for (const [name, content] of Object.entries(files)) {
  const path = join(output, name);
  try {
    const previous = await readFile(path, "utf8");
    if (previous !== content) throw new Error("Existing output differs: " + path + "; choose a new output directory");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(path, content, { encoding: "utf8", flag: "wx" });
  }
}
process.stdout.write(JSON.stringify({ output, coverage: result.coverage, files: Object.entries(files).map(([path, content]) => ({
  path, bytes: Buffer.byteLength(content, "utf8"), sha256: digest(Buffer.from(content, "utf8"))
})) }, null, 2) + "\n");
