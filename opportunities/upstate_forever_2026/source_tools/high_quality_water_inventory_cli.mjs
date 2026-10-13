#!/usr/bin/env node
import {createHash} from "node:crypto";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {resolve, dirname, basename, join} from "node:path";
import {buildInventory} from "./high_quality_water_inventory.mjs";

const sha = value => createHash("sha256").update(value).digest("hex");
const json = value => Buffer.from(JSON.stringify(value, null, 2) + "\n");
function argumentsFor(argv) {
  const value = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith("--") || !argv[i + 1] || argv[i + 1].startsWith("--"))
      throw new Error("Supply --source-csv, --registry, --mapping, --selection and --out");
    if (value[argv[i]]) throw new Error("Repeated option " + argv[i]);
    value[argv[i]] = argv[i + 1];
  }
  for (const key of ["--source-csv", "--registry", "--mapping", "--selection", "--out"])
    if (!value[key]) throw new Error("Missing " + key);
  for (const key of Object.keys(value))
    if (!["--source-csv", "--registry", "--mapping", "--selection", "--out", "--expected-csv-sha256"].includes(key))
      throw new Error("Unknown option " + key);
  return value;
}
async function exactWrite(path, body) {
  await mkdir(dirname(path), {recursive: true});
  try { await writeFile(path, body, {flag: "wx"}); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const retained = await readFile(path);
    if (!retained.equals(Buffer.from(body)))
      throw new Error("Existing output belongs to different source bytes; use another output directory: " + path);
  }
}
async function main() {
  const args = argumentsFor(process.argv.slice(2));
  const inputNames = {
    classified_csv: "--source-csv", legal_registry: "--registry",
    native_mapping: "--mapping", retained_selection: "--selection"
  };
  const original = {};
  for (const [key, option] of Object.entries(inputNames)) {
    const path = resolve(args[option]), body = await readFile(path);
    original[key] = {body, item: {path: "inputs/" + key + "/" + basename(path),
      bytes: body.byteLength, sha256: sha(body)}};
  }
  if (args["--expected-csv-sha256"] && original.classified_csv.item.sha256 !== args["--expected-csv-sha256"])
    throw new Error("The original classified CSV differs from the expected source edition");
  const selection = JSON.parse(original.retained_selection.body);
  const mapping = JSON.parse(original.native_mapping.body);
  const registry = JSON.parse(original.legal_registry.body);
  const inputs = Object.fromEntries(Object.entries(original).map(([name, value]) => [name, value.item]));
  const result = buildInventory(original.classified_csv.body.toString("utf8"), registry, mapping, selection, inputs);
  const out = resolve(args["--out"]);
  const profileName = "scdes-schydroclass-20261012.attribute-profile.json";
  const indexName = "scdes-schydroclass-20261012.feature-index.csv";
  const profileBody = json(result.profile), indexBody = Buffer.from(result.featureIndexCsv);
  const item = (path, body) => ({path, bytes: body.byteLength, sha256: sha(body)});
  const files = [item(profileName, profileBody), item(indexName, indexBody),
    ...Object.values(original).map(value => value.item)];
  const manifest = {
    schema: "upstate.sources/v1", title: "Retained classified-water source inventory",
    entries: [{
      id: selection.source_id + "-attribute-inventory",
      title: "Classified source linework types and source-review associations",
      kind: "table", role: "HIGH_QUALITY_WATER_SOURCE_INVENTORY",
      uri: selection.layer_url, vintage: selection.original_capture_date,
      ...files[0], data_status: mapping.layers[result.profile.layer_id].data_status,
      source_id: selection.source_id, source_layer_id: result.profile.layer_id,
      feature_index: indexName, feature_count: result.featureIndex.length,
      source_selection: result.profile.source_selection,
      companions: files.slice(1)
    }],
    notes: [
      "Original source CSV, selected legal registry, native mapping and capture selection are retained as exact companions.",
      "Source-review predicates do not create legal geometry bindings or remove classified geometry."
    ]
  };
  for (const value of Object.values(original)) await exactWrite(join(out, value.item.path), value.body);
  await exactWrite(join(out, indexName), indexBody);
  await exactWrite(join(out, profileName), profileBody);
  await exactWrite(join(out, "sources.json"), json(manifest));
  process.stdout.write(JSON.stringify({
    output: out, source_manifest: join(out, "sources.json"), source_id: selection.source_id,
    layer_id: result.profile.layer_id, feature_count: result.featureIndex.length,
    class_counts: result.profile.class_counts, hydro_type_counts: result.profile.hydro_type_counts,
    literal_join_counts: result.profile.literal_join_counts
  }, null, 2) + "\n");
}
main().catch(error => { process.stderr.write(error.stack + "\n"); process.exitCode = 1; });
