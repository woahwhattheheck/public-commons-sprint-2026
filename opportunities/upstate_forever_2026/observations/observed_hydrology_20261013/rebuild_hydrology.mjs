#!/usr/bin/env node
import {readFile, writeFile, mkdir, rename} from "node:fs/promises";
import {resolve, dirname, isAbsolute, relative, sep} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {flowBuild} from "./hydrology_core.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--output-dir") {
  throw new Error("Usage: node rebuild_hydrology.mjs --output-dir OUTPUT_DIRECTORY");
}
const output = resolve(args[1]);
const digest = data => createHash("sha256").update(data).digest("hex");
const inside = (base, name) => {
  if (isAbsolute(name) || name.includes("\\") || name.includes("\0")) throw new Error("Use a relative source path");
  const path = resolve(base, name), rel = relative(base, path);
  if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) throw new Error("Source path leaves its edition");
  return path;
};
const index = JSON.parse(await readFile(resolve(root, "inputs.json"), "utf8"));
if (index.schema !== "upstate.observed-hydrology-inputs/v1") throw new Error("Select the observed hydrology input index");
const originals = [];
for (const source of index.originals) {
  const data = await readFile(inside(root, source.path));
  if (data.length !== source.bytes || digest(data) !== source.sha256) throw new Error("Original source changed: " + source.path);
  originals.push({...source, text: data.toString("utf8")});
}
const result = flowBuild({...index, originals});
const expected = new Map(index.derived_files.map(x => [x.path, x]));
if (result.files.length !== expected.size) throw new Error("Generated file set differs");
const ready = [];
for (const file of result.files) {
  const data = Buffer.from(file.text, "utf8"), reference = expected.get("derived/" + file.path);
  if (!reference || data.length !== reference.bytes || digest(data) !== reference.sha256) throw new Error("Derived output differs: " + file.path);
  ready.push({path: inside(output, file.path), data});
}
for (const item of ready) {
  await mkdir(dirname(item.path), {recursive: true});
  const temp = item.path + ".partial-" + process.pid;
  await writeFile(temp, item.data);
  await rename(temp, item.path);
}
console.log(JSON.stringify({output, original_files: originals.length, generated_files: ready.length, coverage: result.coverage}, null, 2));
