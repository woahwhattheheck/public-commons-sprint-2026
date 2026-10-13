#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { assembleEpaTables, csvString } from "./echo_dmr_source.mjs";
function option(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  if (!process.argv[index + 1] || process.argv[index + 1].startsWith("--")) throw new Error("Missing value for " + name);
  return process.argv[index + 1];
}
const modelRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.resolve(option("--capture-manifest", path.join(modelRoot, "source/echo_dmr/20261013/capture-manifest.json")));
const destination = path.resolve(option("--out", path.dirname(manifestPath)));
const captureRoot = path.dirname(manifestPath);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.schema !== "upstate.echo-captures/v1" || !Array.isArray(manifest.entries)) throw new Error("Unsupported capture manifest");
const sha256 = body => crypto.createHash("sha256").update(body).digest("hex");
const captures = manifest.entries.map(entry => {
  const file = path.resolve(captureRoot, entry.path);
  if (!file.startsWith(captureRoot + path.sep)) throw new Error("Source path must remain inside the capture directory");
  const body = fs.readFileSync(file);
  if (body.length !== entry.bytes || sha256(body) !== entry.sha256) throw new Error("Original response differs: " + entry.path);
  return { ...entry, data: JSON.parse(body.toString("utf8")) };
});
const tables = assembleEpaTables(captures, manifest.captured_at);
fs.mkdirSync(path.join(destination, "tables"), { recursive: true });
const written = Object.entries(tables).map(([name, rows]) => {
  const body = csvString(rows), file = path.join(destination, "tables", name);
  fs.writeFileSync(file, body, "utf8");
  return { path: file, rows: rows.length, bytes: Buffer.byteLength(body), sha256: sha256(body) };
});
process.stdout.write(JSON.stringify({ captured_at: manifest.captured_at, original_responses: captures.length, files: written }, null, 2) + "\n");
