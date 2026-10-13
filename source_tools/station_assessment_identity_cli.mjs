#!/usr/bin/env node
// Copyright TokenJunkieLabs. Reproduce the retained source identity join with Node built-ins.
import { open, mkdir, realpath, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, dirname, basename, join } from "node:path";
import { joinAssessmentIdentities } from "./station_assessment_identity.mjs";

const usage = "node source_tools/station_assessment_identity_cli.mjs --assessments ASSESSMENT_CSV --crosswalk NATIVE_CROSSWALK_CSV --output NEW_DIRECTORY";
async function readOriginal(path) {
  const handle = await open(resolve(path), "r");
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > 2 * 1024 * 1024) throw new Error("Choose a retained source file below 2 MiB");
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (bytes.length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      throw new Error("Original source changed while reading");
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } finally { await handle.close(); }
}
async function main() {
  const argv = process.argv.slice(2), args = {};
  if (!argv.length || argv.includes("--help")) { process.stdout.write(usage + "\n"); return; }
  while (argv.length) {
    const option = argv.shift(), value = argv.shift();
    if (!["--assessments", "--crosswalk", "--output"].includes(option) || !value ||
        value.startsWith("--") || args[option]) throw new Error(usage);
    args[option] = value;
  }
  if (["--assessments", "--crosswalk", "--output"].some(key => !args[key])) throw new Error(usage);
  const [assessments, crosswalk] = await Promise.all([
    readOriginal(args["--assessments"]), readOriginal(args["--crosswalk"])
  ]);
  const result = joinAssessmentIdentities(assessments, crosswalk);
  const requested = resolve(args["--output"]), parent = await realpath(dirname(requested));
  const output = join(parent, basename(requested));
  await mkdir(output, { mode: 0o700 });
  let complete = false;
  try {
    for (const [name, text] of Object.entries(result.files)) {
      const handle = await open(join(output, name), constants.O_WRONLY | constants.O_CREAT |
        constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
      try { await handle.writeFile(text, "utf8"); await handle.sync(); }
      finally { await handle.close(); }
    }
    complete = true;
  } finally { if (!complete) await rm(output, { recursive: true, force: true }); }
  process.stdout.write(JSON.stringify({ output, ...result.summary }, null, 2) + "\n");
}
main().catch(error => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
