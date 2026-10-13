#!/usr/bin/env node
// Emit the complete original assessment report recipes and ready-import archive.
import { readFile, mkdir, open, realpath, rm } from "node:fs/promises";
import { resolve, join, dirname, sep } from "node:path";
import { REPORTS, relativeMember, composeAssessmentObservedReports } from "./assessment_observed_reports.mjs";

function argumentsFor(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index], value = argv[index + 1];
    if (!["--application", "--output"].includes(option) || !value || value.startsWith("--") || values[option])
      throw Error("Use --application COMPLETE_APPLICATION --output NEW_DIRECTORY");
    values[option] = value;
  }
  if (!values["--application"] || !values["--output"])
    throw Error("Use --application COMPLETE_APPLICATION --output NEW_DIRECTORY");
  return values;
}
async function readOriginal(root, name) {
  relativeMember(name);
  const actual = await realpath(join(root, ...name.split("/")));
  if (!actual.startsWith(root + sep)) throw Error("Original source escapes its report directory: " + name);
  return new Uint8Array(await readFile(actual));
}
async function loadReport(application, kind) {
  const root = await realpath(join(application, ...REPORTS[kind].directory.split("/")));
  if (!root.startsWith(application + sep)) throw Error("Report directory leaves the application");
  const body = await readOriginal(root, "sources.json");
  const manifest = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(body));
  if (manifest.schema !== "upstate.sources/v1" || manifest.entries?.length !== 1)
    throw Error("Choose the original report's source manifest");
  const entry = manifest.entries[0], files = {"sources.json": body};
  for (const row of [entry, ...(entry.companions || [])]) {
    const name = relativeMember(row.path);
    if (files[name] !== undefined) throw Error("Original report repeats a path: " + name);
    files[name] = await readOriginal(root, name);
  }
  return files;
}
async function writeExclusive(root, name, body) {
  relativeMember(name);
  const target = join(root, ...name.split("/"));
  await mkdir(dirname(target), {recursive: true, mode: 0o700});
  const file = await open(target, "wx", 0o600);
  try { await file.writeFile(body); await file.sync(); }
  finally { await file.close(); }
}
async function main() {
  const options = argumentsFor(process.argv.slice(2));
  const application = await realpath(resolve(options["--application"]));
  const associationFiles = await loadReport(application, "association");
  const scopeFiles = await loadReport(application, "scope");
  const result = composeAssessmentObservedReports({associationFiles, scopeFiles});
  // All original byte identities and archive paths are checked before mutation.
  for (const name of Object.keys(result.files)) relativeMember(name);
  const requested = resolve(options["--output"]);
  const parent = await realpath(dirname(requested));
  const output = join(parent, requested.slice(dirname(requested).length + 1));
  await mkdir(output, {mode: 0o700}); // Existing destinations are never overwritten.
  let complete = false;
  try {
    for (const [name, body] of Object.entries(result.files)) await writeExclusive(output, name, body);
    complete = true;
  } finally {
    if (!complete) await rm(output, {recursive: true, force: true});
  }
  process.stdout.write(JSON.stringify({
    output, recipes: result.inventory.recipes, archive: result.inventory.archive,
    installable_postimages: result.inventory.generated_files.map(row => row.path),
    import_manifest_member: "sources.json",
  }, null, 2) + "\n");
}
main().catch(error => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
