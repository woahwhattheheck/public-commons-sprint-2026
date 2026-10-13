#!/usr/bin/env node
// Compose retained native assessment geography through the existing report workflow.
import { readFile, realpath, mkdir, open, rm } from "node:fs/promises";
import { resolve, dirname, basename, join, sep } from "node:path";
import { spawnSync } from "node:child_process";
import {
  composeNativeAssessmentDelivery, nativeDeliveryPath, NATIVE_SOURCE_DIRECTORY,
  STATION_SOURCE_DIRECTORY, ORIGINAL_ASSESSMENT_FILES, ANNUAL_SOURCE_FILES,
} from "./native_assessment_delivery.mjs";
import { MICROBIAL_ORIGINAL_FILES } from "./native_assessment_microbiology.mjs";

const HELP = `Usage:
  node source_tools/native_assessment_delivery_cli.mjs --application APP --output NEW_DIRECTORY
  node source_tools/native_assessment_delivery_cli.mjs --application APP --output NEW_DIRECTORY --workspace WORKSPACE [--python python3]

Reads the completed native geography edition and its original station, assessment
and annual-reference sources from APP. Writes a complete scientific report,
interactive report, source manifest and portable ZIP into a new directory.
Add --microbial to include the complete original measured E. coli source edition,
its observation explorer and all four additional typed sources.
Add BOTH --national-inventory ORIGINAL_INVENTORY.json and --national-source-root DIR
from the maintained usgs_annual inventory operation to retain original national
archives, sampling/flow periods and estimator errors beside unchanged regional targets.
Optional --workspace imports the completed source manifest through model.cli.
`;

function argumentsFor(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === "--help" || key === "-h") return {help:true};
    if (key === "--microbial") { if (options[key]) throw Error("Supply --microbial once"); options[key]=true; continue; }
    if (!["--application", "--output", "--workspace", "--python", "--national-inventory", "--national-source-root"].includes(key))
      throw Error("Unknown option: " + key);
    if (key in options || !argv[i + 1] || argv[i + 1].startsWith("--"))
      throw Error("Supply one value for " + key);
    options[key] = argv[++i];
  }
  if (!options["--application"] || !options["--output"])
    throw Error("Supply --application and --output");
  if (options["--python"] && !options["--workspace"])
    throw Error("--python requires --workspace");
  if(Boolean(options["--national-inventory"])!==Boolean(options["--national-source-root"]))
    throw Error("Supply both --national-inventory and --national-source-root");
  return options;
}
async function sourceText(application, relative) {
  nativeDeliveryPath(relative);
  const actual = await realpath(join(application, ...relative.split("/")));
  if (!actual.startsWith(application + sep)) throw Error("Source is outside the application: " + relative);
  return readFile(actual, "utf8");
}
async function sourceEdition(application, directory, manifestName) {
  const manifestBody = await sourceText(application, directory + "/" + manifestName);
  const manifest = JSON.parse(manifestBody);
  if (manifest.schema !== "upstate.sources/v1" || !Array.isArray(manifest.entries))
    throw Error("Expected a retained upstate.sources/v1 manifest: " + manifestName);
  const names = new Set([manifestName]);
  for (const entry of manifest.entries) {
    for (const row of [entry, ...(entry.companions || [])]) names.add(nativeDeliveryPath(row.path));
  }
  const files = {};
  for (const name of names) files[name] = name === manifestName ? manifestBody
    : await sourceText(application, directory + "/" + name);
  return files;
}
async function writeReport(outputPath, files) {
  const names = Object.keys(files), canonical = new Set();
  for (const name of names) {
    nativeDeliveryPath(name);
    const key = name.normalize("NFC").toLowerCase();
    if (canonical.has(key)) throw Error("Output member names collide: " + name);
    canonical.add(key);
  }
  for (const key of canonical) {
    const pieces = key.split("/");
    for (let i = 1; i < pieces.length; i++)
      if (canonical.has(pieces.slice(0, i).join("/"))) throw Error("Output file conflicts with a directory");
  }
  const requested = resolve(outputPath), parent = await realpath(dirname(requested));
  const name = basename(requested);
  if (!name || name === "." || name === "..") throw Error("Choose a new report directory");
  const output = join(parent, name);
  await mkdir(output, {mode:0o700});
  let complete = false;
  try {
    for (const relative of names) {
      const target = join(output, ...relative.split("/"));
      await mkdir(dirname(target), {recursive:true, mode:0o700});
      const handle = await open(target, "wx", 0o600);
      try {
        await handle.writeFile(files[relative]);
        await handle.sync();
      } finally { await handle.close(); }
    }
    complete = true;
  } finally {
    if (!complete) await rm(output, {recursive:true, force:true});
  }
  return output;
}

async function main() {
  const options = argumentsFor(process.argv.slice(2));
  if (options.help) { process.stdout.write(HELP); return; }
  const application = await realpath(resolve(options["--application"]));
  const nativeFiles = await sourceEdition(application, NATIVE_SOURCE_DIRECTORY, "sources.json");
  const stationSourceFiles = await sourceEdition(application, STATION_SOURCE_DIRECTORY, "sources-complete.json");
  const originalAssessmentFiles = {};
  for (const [name, info] of Object.entries(ORIGINAL_ASSESSMENT_FILES))
    originalAssessmentFiles[name] = await sourceText(application, info.application_path);
  const annualSourceFiles = {};
  for (const info of ANNUAL_SOURCE_FILES)
    annualSourceFiles[info.path] = await sourceText(application, info.path);
  const assessmentInputs = {
    assessments: await sourceText(application, "results/assessment-association-review-20261013/inputs/assessment-records-domain217.csv"),
    identityCrosswalk: await sourceText(application, "results/assessment-association-review-20261013/inputs/assessment159-native-identity-crosswalk.csv"),
    priorities: await sourceText(application, "results/assessment-association-review-20261013/inputs/source-priority-assessment-domain217.json"),
  };
  const measured = {};
  if (options["--microbial"]) {
    measured.microbialFiles=await sourceEdition(application,NATIVE_SOURCE_DIRECTORY,"microbial-assessment-sources.json");
    measured.microbialOriginalFiles={};
    for (const row of MICROBIAL_ORIGINAL_FILES)
      measured.microbialOriginalFiles[row.path]=await sourceText(application,row.application_path || row.path);
  }
  const national={};
  if(options["--national-inventory"]){
    national.nationalInventory=await readFile(resolve(options["--national-inventory"]),"utf8");
    const inventory=JSON.parse(national.nationalInventory);
    if(inventory.schema!=="upstate.usgs-annual2012-inventory/v1"||!inventory.source?.files)
      throw Error("Use the complete maintained USGS annual inventory");
    const root=await realpath(resolve(options["--national-source-root"]));
    const names=new Set(Object.keys(inventory.source.files));
    for(const entry of Object.values(inventory.source.files))if(entry.http_receipt)names.add(entry.http_receipt.path);
    national.nationalOriginalFiles={};
    for(const name of names){
      nativeDeliveryPath(name);
      const path=await realpath(join(root,...name.split("/")));
      if(!path.startsWith(root+sep))throw Error("Original national source is outside its retained root");
      national.nationalOriginalFiles[name]=await readFile(path);
    }
  }
  const result = composeNativeAssessmentDelivery({
    nativeFiles, stationSourceFiles, originalAssessmentFiles, annualSourceFiles, assessmentInputs,...measured,...national,
  });
  const output = await writeReport(options["--output"], result.files);
  const receipt = {directory:output, source_manifest:join(output,"sources.json"),
    interactive_report:join(output,"association","OPEN_ASSESSMENT_ASSOCIATIONS.html"),
    source_ids:result.manifest.entries.map(entry=>entry.id), archive:result.archive};
  if (options["--workspace"]) {
    const run = spawnSync(options["--python"] || "python3",
      ["-B","-m","model.cli","--workspace",resolve(options["--workspace"]),
        "source-import",receipt.source_manifest],
      {cwd:application, stdio:"inherit"});
    if (run.error) throw Error("Report is saved at " + output + "; source import could not start: " + run.error.message);
    if (run.status !== 0) throw Error("Report is saved at " + output + "; source import exited " + run.status);
    receipt.workspace = resolve(options["--workspace"]);
  }
  process.stdout.write(JSON.stringify(receipt, null, 2) + "\n");
}
main().catch(error => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
